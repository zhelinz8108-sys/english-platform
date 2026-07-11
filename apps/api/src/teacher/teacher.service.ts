import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { attemptEtagHash, canonicalJson, sha256 } from '../common/domain.js';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { DatabaseService, type TenantTransaction } from '../infrastructure/database.service.js';
import { EventsService, type EventActor } from '../infrastructure/events.service.js';
import {
  IdempotencyService,
  type IdempotentCommandResult,
} from '../infrastructure/idempotency.service.js';

interface AssessmentTarget {
  attempt_id: string;
  attempt_no: number;
  attempt_state: string;
  task_item_id: string;
  student_profile_id: string;
  submission_id: string;
  submission_revision: number;
  responses: Record<string, unknown>;
  draft_revision: number;
  snapshot_hash: string;
  started_at: Date;
  last_submitted_at: Date | null;
}

export interface GradeInput {
  submissionSnapshotId: string;
  score: number;
  maxScore: number;
  feedback: string | null;
  rubricScores: Array<{
    criterionKey: string;
    score: number;
    maxScore: number;
    comment: string | null;
  }>;
}

export function teacherQuestionSnapshot(row: {
  question_version_id: string;
  question_kind: string;
  prompt_snapshot: unknown;
  options_snapshot: unknown;
  position: number;
  max_score: number;
}) {
  return {
    questionVersionId: row.question_version_id,
    kind: row.question_kind,
    prompt: row.prompt_snapshot,
    options: row.options_snapshot,
    position: row.position,
    maxScore: row.max_score,
  };
}

function actorFrom(request: ApiRequest): EventActor {
  const principal = requirePrincipal(request);
  const tenant = requireTenant(request);
  return {
    tenantId: tenant.tenantId,
    userId: principal.userId,
    membershipId: tenant.membershipId,
    requestId: request.requestId,
  };
}

@Injectable()
export class TeacherService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async attemptDetail(request: ApiRequest, attemptId: string) {
    const actor = actorFrom(request),
      unrestricted = requireTenant(request).roles.some(
        (role) => role === 'owner' || role === 'admin',
      );
    return this.database.withTenant(
      { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId },
      async (transaction) => {
        const result =
          await sql<any>`select attempt.id attempt_id,attempt.attempt_no::int attempt_no,attempt.state attempt_state,attempt.started_at,attempt.last_submitted_at,item.id task_item_id,item.student_profile_id,profile.membership_id student_membership_id,student.display_name student_display_name,version.id task_version_id,version.title task_title,version.task_kind,submission.id submission_id,submission.submission_revision::int submission_revision,submission.submitted_at,submission.is_late,submission.responses
        from task_attempts attempt join student_task_items item on item.tenant_id=attempt.tenant_id and item.id=attempt.student_task_item_id
        join student_profiles profile on profile.tenant_id=item.tenant_id and profile.id=item.student_profile_id
        join tenant_memberships membership on membership.tenant_id=profile.tenant_id and membership.id=profile.membership_id and membership.status='active'
        join users student on student.id=membership.user_id join task_versions version on version.tenant_id=item.tenant_id and version.id=item.task_version_id
        join lateral(select snapshot.* from submission_snapshots snapshot where snapshot.tenant_id=attempt.tenant_id and snapshot.task_attempt_id=attempt.id order by snapshot.submission_revision desc,snapshot.id desc limit 1) submission on true
        where attempt.id=${attemptId}::uuid and ${this.visibleStudentSql(actor.membershipId, unrestricted, 'item.student_profile_id')}`.execute(
            transaction,
          );
        const target = result.rows[0];
        if (!target) throw ProblemException.notFound();
        const questions = await sql<{
          question_version_id: string;
          question_kind: string;
          prompt_snapshot: unknown;
          options_snapshot: unknown;
          position: number;
          max_score: number;
        }>`select snapshot.question_version_id,question.kind question_kind,snapshot.prompt_snapshot,snapshot.options_snapshot,snapshot.position,snapshot.max_score::float8 max_score from attempt_item_snapshots snapshot join question_versions version on version.tenant_id=snapshot.tenant_id and version.id=snapshot.question_version_id join questions question on question.tenant_id=version.tenant_id and question.id=version.question_id where snapshot.task_attempt_id=${attemptId}::uuid order by snapshot.position,snapshot.id`.execute(
          transaction,
        );
        const score =
          await sql<any>`select decision.id,decision.decision_type,decision.score::float8 score,decision.max_score::float8 max_score,decision.component_scores,decision.rubric_result,decision.decided_by_membership_id,decision.created_at from score_decisions decision where decision.submission_snapshot_id=${target.submission_id}::uuid and not exists(select 1 from score_decisions newer where newer.supersedes_score_decision_id=decision.id) order by case decision.decision_type when 'admin_override' then 300 when 'teacher_confirmed' then 200 else 100 end desc,decision.created_at desc,decision.id desc limit 1`.execute(
            transaction,
          );
        const feedback =
          await sql<any>`select id,feedback_type,visibility,body,authored_by_membership_id,created_at from feedback where submission_snapshot_id=${target.submission_id}::uuid order by created_at desc,id desc`.execute(
            transaction,
          );
        const grade = score.rows[0]
          ? {
              id: score.rows[0].id,
              source: score.rows[0].decision_type,
              score: score.rows[0].score,
              maxScore: score.rows[0].max_score,
              componentScores: score.rows[0].component_scores,
              rubricResult: score.rows[0].rubric_result,
              createdByMembershipId: score.rows[0].decided_by_membership_id,
              createdAt: new Date(score.rows[0].created_at).toISOString(),
            }
          : null;
        return {
          attempt: {
            id: target.attempt_id,
            attemptNumber: target.attempt_no,
            state: target.attempt_state,
            startedAt: new Date(target.started_at).toISOString(),
            submittedAt: target.last_submitted_at
              ? new Date(target.last_submitted_at).toISOString()
              : null,
          },
          student: {
            membershipId: target.student_membership_id,
            displayName: target.student_display_name,
          },
          task: {
            taskItemId: target.task_item_id,
            taskVersionId: target.task_version_id,
            title: target.task_title,
            kind: target.task_kind,
          },
          submission: {
            id: target.submission_id,
            revision: target.submission_revision,
            submittedAt: new Date(target.submitted_at).toISOString(),
            isLate: target.is_late,
            responses: target.responses,
          },
          questions: questions.rows.map(teacherQuestionSnapshot),
          grade,
          feedback: feedback.rows.map((entry: any) => ({
            id: entry.id,
            type: entry.feedback_type,
            visibility: entry.visibility,
            body: entry.body,
            authoredByMembershipId: entry.authored_by_membership_id,
            createdAt: new Date(entry.created_at).toISOString(),
          })),
        };
      },
    );
  }

  grade(
    request: ApiRequest,
    attemptId: string,
    key: string | undefined,
    input: GradeInput,
  ): Promise<IdempotentCommandResult<Record<string, unknown>>> {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId },
      'teacher.attempt.grade',
      key,
      { attemptId, ...input },
      async (transaction) => {
        const target = await this.requireAssessmentTarget(transaction, request, attemptId);
        if (target.submission_id !== input.submissionSnapshotId) {
          throw ProblemException.conflict(
            'submission_revision_changed',
            '该 Attempt 已产生更新的提交 revision。',
          );
        }
        if (!['submitted', 'grading', 'completed'].includes(target.attempt_state)) {
          throw ProblemException.conflict('attempt_not_gradable', 'Attempt 当前状态不可评分。');
        }
        if (input.score > input.maxScore) {
          throw ProblemException.badRequest('score_out_of_range', 'score 不得大于 maxScore。');
        }
        const previous = await sql<{ id: string }>`
          select sd.id from score_decisions sd
          where sd.tenant_id = ${actor.tenantId}::uuid
            and sd.submission_snapshot_id = ${target.submission_id}::uuid
            and sd.decision_type = 'teacher_confirmed'
            and not exists (
              select 1 from score_decisions newer
              where newer.tenant_id = sd.tenant_id and newer.supersedes_score_decision_id = sd.id
            )
          order by sd.created_at desc, sd.id desc limit 1
        `.execute(transaction);
        const decisionId = uuidv7();
        const feedbackId = uuidv7();
        const now = new Date();
        await sql`
          insert into score_decisions (
            id, tenant_id, task_attempt_id, submission_snapshot_id, decision_type,
            score, max_score, component_scores, rubric_result,
            supersedes_score_decision_id, decided_by_membership_id, created_at
          ) values (
            ${decisionId}::uuid, ${actor.tenantId}::uuid, ${attemptId}::uuid,
            ${target.submission_id}::uuid, 'teacher_confirmed', ${input.score}, ${input.maxScore},
            '{}'::jsonb, ${JSON.stringify(input.rubricScores)}::jsonb,
            ${previous.rows[0]?.id ?? null}::uuid, ${actor.membershipId}::uuid, ${now}
          )
        `.execute(transaction);
        await sql`
          insert into feedback (
            id, tenant_id, task_attempt_id, submission_snapshot_id, score_decision_id,
            feedback_type, visibility, body, authored_by_membership_id, created_at
          ) values (
            ${feedbackId}::uuid, ${actor.tenantId}::uuid, ${attemptId}::uuid,
            ${target.submission_id}::uuid, ${decisionId}::uuid, 'teacher', 'student',
            ${JSON.stringify({ message: input.feedback, rubricScores: input.rubricScores })}::jsonb,
            ${actor.membershipId}::uuid, ${now}
          )
        `.execute(transaction);
        await sql`
          update task_attempts set state = 'completed', completed_at = ${now}, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${attemptId}::uuid
        `.execute(transaction);
        await sql`
          update student_task_items set workflow_state = 'completed', updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${target.task_item_id}::uuid
        `.execute(transaction);
        await this.events.append(transaction, actor, {
          action: 'attempt.grade',
          resourceType: 'score_decision',
          resourceId: decisionId,
          eventType: 'attempt.graded.v1',
          payload: {
            attemptId,
            submissionSnapshotId: target.submission_id,
            decisionType: 'teacher_confirmed',
          },
        });
        return {
          status: 201,
          body: {
            id: decisionId,
            attemptId,
            submissionSnapshotId: target.submission_id,
            submissionRevision: target.submission_revision,
            source: 'teacher_confirmed',
            score: input.score,
            maxScore: input.maxScore,
            feedback: input.feedback,
            rubricScores: input.rubricScores,
            createdByMembershipId: actor.membershipId,
            createdAt: now.toISOString(),
            snapshotHash: sha256(canonicalJson(input)),
          },
        };
      },
    );
  }

  returnAttempt(
    request: ApiRequest,
    attemptId: string,
    key: string | undefined,
    input: { submissionSnapshotId: string; message: string },
  ): Promise<IdempotentCommandResult<Record<string, unknown>>> {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId },
      'teacher.attempt.return',
      key,
      { attemptId, ...input },
      async (transaction) => {
        const target = await this.requireAssessmentTarget(transaction, request, attemptId);
        if (target.submission_id !== input.submissionSnapshotId) {
          throw ProblemException.conflict(
            'submission_revision_changed',
            '该 Attempt 已产生更新的提交 revision。',
          );
        }
        if (!['completed', 'grading'].includes(target.attempt_state)) {
          throw ProblemException.conflict(
            'attempt_not_returnable',
            'Attempt 必须已评分或处于 grading。',
          );
        }
        const score = await sql<{ id: string }>`
          select id from score_decisions
          where tenant_id = ${actor.tenantId}::uuid
            and submission_snapshot_id = ${target.submission_id}::uuid
            and decision_type = 'teacher_confirmed'
          order by created_at desc, id desc limit 1
        `.execute(transaction);
        if (!score.rows[0])
          throw ProblemException.conflict('grade_required', '退回前必须完成教师评分。');
        const now = new Date();
        const nextDraftRevision = target.draft_revision + 1;
        const responseHash = sha256(canonicalJson(target.responses));
        const etag = attemptEtagHash(attemptId, nextDraftRevision, responseHash);
        await sql`
          update attempt_drafts set responses = ${JSON.stringify(target.responses)}::jsonb,
            revision = ${nextDraftRevision}, etag = ${etag}, saved_at = ${now}, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and task_attempt_id = ${attemptId}::uuid
        `.execute(transaction);
        await sql`
          insert into feedback (
            id, tenant_id, task_attempt_id, submission_snapshot_id, score_decision_id,
            feedback_type, visibility, body, authored_by_membership_id, created_at
          ) values (
            ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${attemptId}::uuid,
            ${target.submission_id}::uuid, ${score.rows[0].id}::uuid, 'teacher', 'student',
            ${JSON.stringify({ message: input.message, action: 'return_for_edit' })}::jsonb,
            ${actor.membershipId}::uuid, ${now}
          )
        `.execute(transaction);
        await sql`
          update task_attempts set state = 'returned', returned_at = ${now}, completed_at = null, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${attemptId}::uuid
        `.execute(transaction);
        await sql`
          update student_task_items set workflow_state = 'returned', updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${target.task_item_id}::uuid
        `.execute(transaction);
        await this.events.append(transaction, actor, {
          action: 'attempt.return',
          resourceType: 'task_attempt',
          resourceId: attemptId,
          eventType: 'attempt.returned.v1',
          payload: {
            submissionSnapshotId: target.submission_id,
            submissionRevision: target.submission_revision,
          },
        });
        return {
          status: 200,
          headers: { ETag: `"${etag}"` },
          body: {
            id: attemptId,
            tenantId: actor.tenantId,
            taskItemId: target.task_item_id,
            attemptNumber: target.attempt_no,
            state: 'returned',
            revision: nextDraftRevision,
            submissionRevision: target.submission_revision,
            latestSubmissionSnapshotId: target.submission_id,
            snapshotHash: target.snapshot_hash,
            startedAt: target.started_at.toISOString(),
            submittedAt: target.last_submitted_at?.toISOString() ?? null,
          },
        };
      },
    );
  }

  async dashboard(request: ApiRequest) {
    const actor = actorFrom(request);
    const unrestricted = requireTenant(request).roles.some(
      (role) => role === 'owner' || role === 'admin',
    );
    return this.database.withTenant(
      { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId },
      async (transaction) => {
        const result = await sql<{
          awaiting: number;
          students: number;
          classes: number;
          returned: number;
        }>`
          select
            (select count(*)::int from task_attempts attempt
              join student_task_items item on item.tenant_id=attempt.tenant_id and item.id=attempt.student_task_item_id
              where attempt.state='grading' and ${this.visibleStudentSql(actor.membershipId, unrestricted, 'item.student_profile_id')}) as awaiting,
            (select count(*)::int from student_profiles profile
              join tenant_memberships membership on membership.tenant_id=profile.tenant_id and membership.id=profile.membership_id
              where profile.status='active' and membership.status='active'
                and ${this.visibleStudentSql(actor.membershipId, unrestricted, 'profile.id')}) as students,
            (select count(*)::int from classes class
              where class.status='active' and (${unrestricted} or exists(
                select 1 from teacher_profiles teacher join class_teachers link
                  on link.tenant_id=teacher.tenant_id and link.teacher_profile_id=teacher.id
                where teacher.membership_id=${actor.membershipId}::uuid and link.class_id=class.id and link.left_at is null
              ))) as classes,
            (select count(*)::int from feedback returned_feedback
              join task_attempts attempt on attempt.tenant_id=returned_feedback.tenant_id
                and attempt.id=returned_feedback.task_attempt_id
              join student_task_items item on item.tenant_id=attempt.tenant_id and item.id=attempt.student_task_item_id
              where returned_feedback.visibility='student'
                and returned_feedback.body->>'action'='return_for_edit'
                and returned_feedback.created_at>=date_trunc('week',now())
                and ${this.visibleStudentSql(actor.membershipId, unrestricted, 'item.student_profile_id')}) as returned
        `.execute(transaction);
        const recent = await sql<{
          attempt_id: string;
          task_item_id: string;
          student_membership_id: string;
          student_display_name: string;
          task_title: string;
          task_kind: string;
          submitted_at: Date;
          is_late: boolean;
          submission_snapshot_id: string;
        }>`
          select attempt.id as attempt_id,item.id as task_item_id,profile.membership_id as student_membership_id,
            student.display_name as student_display_name,version.title as task_title,version.task_kind,
            submission.submitted_at,submission.is_late,submission.id as submission_snapshot_id
          from task_attempts attempt
          join student_task_items item on item.tenant_id=attempt.tenant_id and item.id=attempt.student_task_item_id
          join student_profiles profile on profile.tenant_id=item.tenant_id and profile.id=item.student_profile_id
          join tenant_memberships membership on membership.tenant_id=profile.tenant_id and membership.id=profile.membership_id and membership.status='active'
          join users student on student.id=membership.user_id
          join task_versions version on version.tenant_id=item.tenant_id and version.id=item.task_version_id
          join lateral(select snapshot.id,snapshot.submitted_at,snapshot.is_late from submission_snapshots snapshot
            where snapshot.tenant_id=attempt.tenant_id and snapshot.task_attempt_id=attempt.id
            order by snapshot.submission_revision desc,snapshot.id desc limit 1) submission on true
          where attempt.state='grading' and ${this.visibleStudentSql(actor.membershipId, unrestricted, 'item.student_profile_id')}
          order by submission.submitted_at desc,submission.id desc limit 20
        `.execute(transaction);
        return {
          generatedAt: new Date().toISOString(),
          classCount: result.rows[0]?.classes ?? 0,
          studentCount: result.rows[0]?.students ?? 0,
          awaitingGradeCount: result.rows[0]?.awaiting ?? 0,
          returnedThisWeekCount: result.rows[0]?.returned ?? 0,
          recentSubmissions: recent.rows.map((row) => ({
            attemptId: row.attempt_id,
            taskItemId: row.task_item_id,
            studentMembershipId: row.student_membership_id,
            studentDisplayName: row.student_display_name,
            taskTitle: row.task_title,
            kind: row.task_kind,
            submittedAt: row.submitted_at.toISOString(),
            isLate: row.is_late,
            submissionSnapshotId: row.submission_snapshot_id,
          })),
        };
      },
    );
  }

  private visibleStudentSql(
    membershipId: string,
    unrestricted: boolean,
    studentExpression: string,
  ) {
    if (unrestricted) return sql<boolean>`true`;
    return sql<boolean>`exists(
      select 1 from teacher_profiles teacher
      where teacher.membership_id=${membershipId}::uuid and teacher.status='active' and (
        exists(select 1 from student_teacher_links direct
          where direct.tenant_id=teacher.tenant_id and direct.teacher_profile_id=teacher.id
            and direct.student_profile_id=${sql.raw(studentExpression)} and direct.valid_to is null)
        or exists(select 1 from class_teachers teaching join class_students roster
          on roster.tenant_id=teaching.tenant_id and roster.class_id=teaching.class_id
          where teaching.tenant_id=teacher.tenant_id and teaching.teacher_profile_id=teacher.id
            and roster.student_profile_id=${sql.raw(studentExpression)}
            and teaching.left_at is null and roster.left_at is null)
      )
    )`;
  }

  private async requireAssessmentTarget(
    transaction: TenantTransaction,
    request: ApiRequest,
    attemptId: string,
  ): Promise<AssessmentTarget> {
    const tenant = requireTenant(request);
    const unrestricted = tenant.roles.some((role) => role === 'owner' || role === 'admin');
    const result = await sql<AssessmentTarget>`
      select ta.id as attempt_id, ta.attempt_no::int as attempt_no, ta.state as attempt_state,
             sti.id as task_item_id, sti.student_profile_id, ss.id as submission_id,
             ss.submission_revision::int as submission_revision, ss.responses,
             ad.revision::int as draft_revision,
             ta.snapshot_hash, ta.started_at, ta.last_submitted_at
      from task_attempts ta
      join student_task_items sti on sti.tenant_id = ta.tenant_id and sti.id = ta.student_task_item_id
      join submission_snapshots ss on ss.tenant_id = ta.tenant_id and ss.task_attempt_id = ta.id
      join attempt_drafts ad on ad.tenant_id = ta.tenant_id and ad.task_attempt_id = ta.id
      where ta.tenant_id = ${tenant.tenantId}::uuid and ta.id = ${attemptId}::uuid
        and ss.submission_revision = (
          select max(latest.submission_revision) from submission_snapshots latest
          where latest.tenant_id = ta.tenant_id and latest.task_attempt_id = ta.id
        )
        and (
          ${unrestricted}
          or exists (
            select 1 from teacher_profiles tp
            where tp.tenant_id = ta.tenant_id and tp.membership_id = ${tenant.membershipId}::uuid
              and (
                exists (select 1 from student_teacher_links stl
                  where stl.tenant_id = tp.tenant_id and stl.teacher_profile_id = tp.id
                    and stl.student_profile_id = sti.student_profile_id and stl.valid_to is null)
                or exists (select 1 from class_teachers ct
                  join class_students cs on cs.tenant_id = ct.tenant_id and cs.class_id = ct.class_id
                  where ct.tenant_id = tp.tenant_id and ct.teacher_profile_id = tp.id
                    and cs.student_profile_id = sti.student_profile_id
                    and ct.left_at is null and cs.left_at is null)
              )
          )
        )
      for update of ta
    `.execute(transaction);
    const row = result.rows[0];
    if (!row) throw ProblemException.notFound();
    return row;
  }
}
