import { Inject, Injectable } from '@nestjs/common';
import { createAttemptSnapshots } from '@english/database';
import type { AttemptState, WorkflowState } from '@english/shared';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import {
  assertAttemptMaySubmit,
  attemptEtagHash,
  canonicalJson,
  nextSubmissionRevision,
  sha256,
  strongAttemptEtag,
} from '../common/domain.js';
import { CursorService, cursorKey } from '../common/cursor.js';
import { ProblemException } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { requirePrincipal, requireTenant } from '../common/request.js';
import { DatabaseService, type TenantTransaction } from '../infrastructure/database.service.js';
import { EventsService, type EventActor } from '../infrastructure/events.service.js';
import {
  IdempotencyService,
  type IdempotentCommandResult,
} from '../infrastructure/idempotency.service.js';

export interface AttemptAnswer {
  questionVersionId: string;
  value: unknown;
}

export interface StudentTaskListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  resolutionState?: 'active' | 'hidden' | 'superseded' | undefined;
  workflowState?: WorkflowState | undefined;
  availability?: 'locked' | 'upcoming' | 'available' | undefined;
  dueBefore?: string | undefined;
}

export interface StudentPathListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  track?: 'general' | 'toefl' | undefined;
}

export interface StudentFeedbackListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  unreadOnly?: boolean | undefined;
}

interface TaskItemRow {
  id: string;
  task_version_id: string;
  occurrence_key: string;
  slot_key: string;
  resolution_state: 'active' | 'hidden' | 'superseded';
  resolution_reason: string;
  workflow_state: WorkflowState;
  available_at: Date;
  due_at: Date | null;
  close_at: Date | null;
  title: string;
  task_kind: string;
  version_no: number;
  instructions: unknown;
  task_content_hash: string;
  max_attempts: number;
  late_policy: 'deny' | 'allow' | 'allow_with_penalty';
  source_count: number;
  is_late: boolean;
  created_at: Date;
}

interface AttemptRow {
  id: string;
  student_task_item_id: string;
  attempt_no: number;
  state: AttemptState;
  snapshot_hash: string;
  started_at: Date;
  last_submitted_at: Date | null;
}

interface DraftRow {
  attempt_id: string;
  attempt_no: number;
  state: AttemptState;
  revision: number;
  etag: string;
  responses: Record<string, unknown>;
  item_id: string;
  due_at: Date | null;
  close_at: Date | null;
  late_policy: 'deny' | 'allow' | 'allow_with_penalty';
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

function transactionContext(actor: EventActor) {
  return { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId };
}

function headerEtag(stored: string): string {
  return `"${stored}"`;
}

@Injectable()
export class StudentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}

  async dashboard(request: ApiRequest) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const counts = await sql<{
        available: number;
        due_soon: number;
        overdue: number;
        awaiting_feedback: number;
      }>`
        select
          count(*) filter (where sti.resolution_state = 'active' and sti.available_at <= now()
            and sti.workflow_state in ('not_started','in_progress','returned'))::int as available,
          count(*) filter (where sti.due_at between now() and now() + interval '3 days'
            and sti.workflow_state in ('not_started','in_progress','returned'))::int as due_soon,
          count(*) filter (where sti.due_at < now()
            and sti.workflow_state in ('not_started','in_progress','returned'))::int as overdue,
          count(*) filter (where sti.workflow_state in ('submitted','grading'))::int as awaiting_feedback
        from student_task_items sti
        join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
        where sp.membership_id = ${actor.membershipId}::uuid
      `.execute(transaction);
      const items = await this.listTaskRows(transaction, actor.membershipId, 10);
      const paths = await sql<{
        id: string;
        learning_path_version_id: string;
        title: string;
        track: string;
        status: string;
        enrolled_at: Date;
        target_completion_date: string | null;
        completed_count: number;
        total_count: number;
      }>`
        select enrollment.id,enrollment.learning_path_version_id,version.title,path.track,enrollment.status,
          enrollment.enrolled_at,enrollment.target_completion_date::text,
          count(distinct item.id) filter(where item.workflow_state='completed')::int completed_count,
          count(distinct item.id)::int total_count
        from student_path_enrollments enrollment
        join student_profiles profile on profile.tenant_id=enrollment.tenant_id and profile.id=enrollment.student_profile_id
        join learning_path_versions version on version.tenant_id=enrollment.tenant_id and version.id=enrollment.learning_path_version_id
        join learning_paths path on path.tenant_id=version.tenant_id and path.id=version.learning_path_id
        left join student_task_sources source on source.tenant_id=enrollment.tenant_id and source.student_path_enrollment_id=enrollment.id
        left join student_task_items item on item.tenant_id=source.tenant_id and item.id=source.student_task_item_id
        where profile.membership_id=${actor.membershipId}::uuid and enrollment.status in('active','paused')
        group by enrollment.id,version.title,path.track order by enrollment.enrolled_at desc,enrollment.id desc limit 5
      `.execute(transaction);
      return {
        generatedAt: new Date().toISOString(),
        counts: {
          available: counts.rows[0]?.available ?? 0,
          dueSoon: counts.rows[0]?.due_soon ?? 0,
          overdue: counts.rows[0]?.overdue ?? 0,
          awaitingFeedback: counts.rows[0]?.awaiting_feedback ?? 0,
        },
        nextTaskItems: items.map((item) =>
          this.taskItemJson(item, actor.tenantId, actor.membershipId),
        ),
        activePaths: paths.rows.map((path) => ({
          id: path.id,
          pathVersionId: path.learning_path_version_id,
          title: path.title,
          track: path.track,
          status: path.status,
          progressPercent: path.total_count ? (path.completed_count * 100) / path.total_count : 0,
          enrolledAt: path.enrolled_at.toISOString(),
          targetCompletionDate: path.target_completion_date,
        })),
      };
    });
  }

  async listTaskItems(request: ApiRequest, input: StudentTaskListQuery) {
    const actor = actorFrom(request);
    const pageSize = this.cursors.pageSize(input.pageSize);
    const filters = {
      resolutionState: input.resolutionState ?? null,
      workflowState: input.workflowState ?? null,
      availability: input.availability ?? null,
      dueBefore: input.dueBefore ?? null,
    };
    const cursorContext = {
      scope: `student.task-items:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.taskDueOrder);
    const dueBefore = input.dueBefore ? new Date(input.dueBefore) : null;
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const result = await sql<TaskItemRow>`
        select sti.id, sti.task_version_id, sti.occurrence_key, sti.slot_key,
               sti.resolution_state, sti.resolution_reason, sti.workflow_state,
               sti.available_at, sti.due_at, sti.close_at, tv.title, tv.task_kind,
               tv.version_no, tv.instructions, tv.content_hash as task_content_hash,
               coalesce(ta.max_attempts, 1)::int as max_attempts,
               coalesce(ta.late_policy, 'allow') as late_policy,
               (select count(*)::int from student_task_sources sts
                 where sts.tenant_id = sti.tenant_id and sts.student_task_item_id = sti.id) as source_count,
               coalesce((select submission.is_late from task_attempts attempt
                 join submission_snapshots submission on submission.tenant_id=attempt.tenant_id and submission.task_attempt_id=attempt.id
                 where attempt.tenant_id=sti.tenant_id and attempt.student_task_item_id=sti.id
                 order by submission.submitted_at desc,submission.id desc limit 1),false) as is_late,
               sti.created_at
        from student_task_items sti
        join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
        join task_versions tv on tv.tenant_id = sti.tenant_id and tv.id = sti.task_version_id
        left join student_task_sources ws on ws.tenant_id = sti.tenant_id and ws.id = sti.winning_source_id
        left join task_assignments ta on ta.tenant_id = ws.tenant_id and ta.id = ws.task_assignment_id
        where sp.membership_id = ${actor.membershipId}::uuid
          and (${input.resolutionState ?? null}::resolution_state is null
            or sti.resolution_state = ${input.resolutionState ?? null}::resolution_state)
          and (${input.workflowState ?? null}::workflow_state is null
            or sti.workflow_state = ${input.workflowState ?? null}::workflow_state)
          and (${dueBefore}::timestamptz is null or sti.due_at < ${dueBefore})
          and (
            ${input.availability ?? null}::text is null
            or (${input.availability ?? null} = 'locked' and sti.resolution_state <> 'active')
            or (${input.availability ?? null} = 'upcoming' and sti.resolution_state = 'active' and sti.available_at > now())
            or (${input.availability ?? null} = 'available' and sti.resolution_state = 'active' and sti.available_at <= now())
          )
          and (${after?.[0] ?? null}::int is null or (
            (case when sti.due_at is null then 1 else 0 end) > ${after?.[0] ?? null}
            or ((case when sti.due_at is null then 1 else 0 end) = ${after?.[0] ?? null} and (
              (${after?.[0] ?? null}=0 and (date_trunc('milliseconds',sti.due_at),date_trunc('milliseconds',sti.created_at),sti.id) > (${after?.[1] ? new Date(after[1]) : null},${after?.[2] ? new Date(after[2]) : null},${after?.[3] ?? null}::uuid))
              or (${after?.[0] ?? null}=1 and (date_trunc('milliseconds',sti.created_at),sti.id) > (${after?.[2] ? new Date(after[2]) : null},${after?.[3] ?? null}::uuid))
            ))
          ))
        order by date_trunc('milliseconds',sti.due_at) asc nulls last,
          date_trunc('milliseconds',sti.created_at) asc, sti.id asc
        limit ${pageSize + 1}
      `.execute(transaction);
      const page = this.cursors.page(result.rows, pageSize, cursorContext, (item) => [
        item.due_at ? 0 : 1,
        item.due_at?.toISOString() ?? null,
        item.created_at.toISOString(),
        item.id,
      ]);
      return {
        data: page.items.map((item) => this.taskItemJson(item, actor.tenantId, actor.membershipId)),
        page: page.page,
      };
    });
  }

  async getTaskItem(request: ApiRequest, itemId: string) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const item = await this.requireTaskItem(transaction, actor.membershipId, itemId, false);
      const attempts = await sql<AttemptRow>`
        select id, student_task_item_id, attempt_no::int as attempt_no, state, snapshot_hash, started_at, last_submitted_at
        from task_attempts where tenant_id = ${actor.tenantId}::uuid
          and student_task_item_id = ${item.id}::uuid order by attempt_no desc limit 1
      `.execute(transaction);
      const questions = await sql<{
        question_version_id: string;
        question_kind: string;
        prompt: unknown;
        options: unknown;
        position: number;
        max_score: number;
      }>`
        select ais.question_version_id, q.kind as question_kind, ais.prompt_snapshot as prompt,
               coalesce(ais.options_snapshot, '[]'::jsonb) as options, ais.position,
               ais.max_score::float8 as max_score
        from attempt_item_snapshots ais
        join question_versions qv on qv.tenant_id = ais.tenant_id and qv.id = ais.question_version_id
        join questions q on q.tenant_id = qv.tenant_id and q.id = qv.question_id
        where ais.tenant_id = ${actor.tenantId}::uuid
          and ais.task_attempt_id = ${attempts.rows[0]?.id ?? null}::uuid
        order by ais.position
      `.execute(transaction);
      const sources = await sql<{
        id: string;
        source_type: string;
        task_assignment_id: string;
        occurrence_key: string;
        slot_key: string;
        source_weight: number;
        explicit_priority: number;
        published_at: Date;
        active: boolean;
      }>`
        select sts.id, sts.source_type, sts.task_assignment_id, sts.occurrence_key,
               sts.slot_key, sts.source_weight, sts.explicit_priority, sts.published_at,
               (sti.winning_source_id = sts.id) as active
        from student_task_sources sts
        join student_task_items sti
          on sti.tenant_id = sts.tenant_id and sti.id = sts.student_task_item_id
        where sts.tenant_id = ${actor.tenantId}::uuid
          and sts.student_task_item_id = ${item.id}::uuid
        order by sts.source_weight desc, sts.explicit_priority desc,
                 sts.published_at desc, sts.id desc
      `.execute(transaction);
      return {
        item: this.taskItemJson(item, actor.tenantId, actor.membershipId),
        taskSnapshot: {
          id: item.task_version_id,
          versionNumber: item.version_no,
          title: item.title,
          instructions: item.instructions,
          kind: item.task_kind,
          contentHash: attempts.rows[0]?.snapshot_hash ?? item.task_content_hash,
          questions: questions.rows.map((question) => ({
            questionVersionId: question.question_version_id,
            kind: question.question_kind,
            prompt: question.prompt,
            options: question.options,
            position: question.position,
            maxScore: question.max_score,
          })),
        },
        sources: sources.rows.map((source) => ({
          id: source.id,
          sourceType: source.source_type,
          sourceRefId: source.task_assignment_id,
          occurrenceKey: source.occurrence_key,
          slotKey: source.slot_key,
          precedenceScore: source.source_weight,
          explicitPriority: source.explicit_priority,
          publishedAt: source.published_at.toISOString(),
          active: source.active,
        })),
        currentAttempt: attempts.rows[0]
          ? await this.attemptJson(transaction, attempts.rows[0])
          : null,
      };
    });
  }

  startAttempt(
    request: ApiRequest,
    itemId: string,
    idempotencyKey: string | undefined,
    input: { intent: 'start' | 'retry'; clientStartedAt: string },
  ): Promise<IdempotentCommandResult<Record<string, unknown>>> {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      transactionContext(actor),
      'student.attempt.start',
      idempotencyKey,
      { itemId, ...input },
      async (transaction) => {
        const item = await this.requireTaskItem(transaction, actor.membershipId, itemId, true);
        const attempts = await sql<AttemptRow>`
          select id, student_task_item_id, attempt_no::int as attempt_no, state, snapshot_hash, started_at, last_submitted_at
          from task_attempts where tenant_id = ${actor.tenantId}::uuid
            and student_task_item_id = ${item.id}::uuid order by attempt_no desc for update
        `.execute(transaction);
        const latest = attempts.rows[0];
        if (input.intent === 'start' && latest) {
          throw ProblemException.conflict('attempt_already_started', '该任务已存在 Attempt。');
        }
        if (input.intent === 'retry') {
          if (!latest || !['completed', 'cancelled'].includes(latest.state)) {
            throw ProblemException.conflict(
              'retry_not_allowed',
              '只有已完成或已取消的 Attempt 可由学生显式 retry。',
            );
          }
          if (latest.attempt_no >= item.max_attempts) {
            throw ProblemException.conflict('max_attempts_exhausted', '已达到最大尝试次数。');
          }
        }
        if (item.resolution_state !== 'active' || item.available_at.getTime() > Date.now()) {
          throw ProblemException.conflict('task_unavailable', '任务当前不可开始。');
        }
        if (item.close_at && item.close_at.getTime() < Date.now()) {
          throw ProblemException.conflict('task_closed', '任务已关闭。');
        }
        const attemptId = uuidv7();
        const startedAt = new Date();
        const attemptNo = (latest?.attempt_no ?? 0) + 1;
        await sql`
          insert into task_attempts (
            id, tenant_id, student_task_item_id, attempt_no, state, snapshot_hash,
            started_at, created_at, updated_at
          ) values (
            ${attemptId}::uuid, ${actor.tenantId}::uuid, ${item.id}::uuid, ${attemptNo},
            'in_progress', ${'0'.repeat(64)}, ${startedAt}, ${startedAt}, ${startedAt}
          )
        `.execute(transaction);
        const snapshot = await createAttemptSnapshots(transaction, attemptId);
        const snapshotHash = snapshot.snapshotHash.trim();
        const responseHash = sha256('{}');
        const etagHash = attemptEtagHash(attemptId, 1, responseHash);
        await sql`
          insert into attempt_drafts (
            id, tenant_id, task_attempt_id, revision, etag, responses, saved_at, updated_at
          ) values (
            ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${attemptId}::uuid, 1,
            ${etagHash}, '{}'::jsonb, ${startedAt}, ${startedAt}
          )
        `.execute(transaction);
        await sql`
          update student_task_items set workflow_state = 'in_progress', updated_at = ${startedAt}
          where tenant_id = ${actor.tenantId}::uuid and id = ${item.id}::uuid
        `.execute(transaction);
        await this.events.append(transaction, actor, {
          action: input.intent === 'retry' ? 'attempt.retry' : 'attempt.start',
          resourceType: 'task_attempt',
          resourceId: attemptId,
          eventType: input.intent === 'retry' ? 'attempt.retried.v1' : 'attempt.started.v1',
          payload: { taskItemId: item.id, attemptNo, snapshotItemCount: snapshot.itemCount },
        });
        return {
          status: 201,
          headers: { ETag: headerEtag(etagHash) },
          body: {
            id: attemptId,
            tenantId: actor.tenantId,
            taskItemId: item.id,
            attemptNumber: attemptNo,
            state: 'in_progress',
            revision: 1,
            submissionRevision: 0,
            latestSubmissionSnapshotId: null,
            snapshotHash,
            startedAt: startedAt.toISOString(),
            submittedAt: null,
          },
        };
      },
    );
  }

  async saveDraft(
    request: ApiRequest,
    attemptId: string,
    ifMatch: string | undefined,
    input: { baseRevision: number; answers: AttemptAnswer[] },
  ) {
    if (!ifMatch) throw ProblemException.preconditionRequired();
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const draft = await this.requireDraft(transaction, actor.membershipId, attemptId);
      const currentEtag = headerEtag(draft.etag);
      if (ifMatch !== currentEtag || input.baseRevision !== draft.revision) {
        throw ProblemException.preconditionFailed(currentEtag);
      }
      if (!['in_progress', 'returned'].includes(draft.state)) {
        throw ProblemException.conflict('attempt_not_editable', 'Attempt 当前不可编辑。');
      }
      const allowed = await sql<{ question_version_id: string }>`
        select question_version_id from attempt_item_snapshots
        where tenant_id = ${actor.tenantId}::uuid and task_attempt_id = ${attemptId}::uuid
      `.execute(transaction);
      const allowedIds = new Set(allowed.rows.map((row) => row.question_version_id));
      if (input.answers.some((answer) => !allowedIds.has(answer.questionVersionId))) {
        throw ProblemException.badRequest(
          'answer_question_mismatch',
          '答案包含不属于该 Attempt 快照的题目。',
        );
      }
      const responses = Object.fromEntries(
        input.answers.map((answer) => [answer.questionVersionId, answer.value]),
      );
      const revision = draft.revision + 1;
      const responseHash = sha256(canonicalJson(responses));
      const etagHash = attemptEtagHash(attemptId, revision, responseHash);
      const now = new Date();
      const updated = await sql<{ id: string }>`
        update attempt_drafts set revision = ${revision}, etag = ${etagHash},
          responses = ${JSON.stringify(responses)}::jsonb, saved_at = ${now}, updated_at = ${now}
        where tenant_id = ${actor.tenantId}::uuid and task_attempt_id = ${attemptId}::uuid
          and revision = ${draft.revision} and etag = ${draft.etag}
        returning id
      `.execute(transaction);
      if (!updated.rows.length) throw ProblemException.preconditionFailed();
      if (draft.state === 'returned') {
        await sql`
          update task_attempts set state = 'in_progress', returned_at = null, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${attemptId}::uuid and state = 'returned'
        `.execute(transaction);
        await sql`
          update student_task_items set workflow_state = 'in_progress', updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${draft.item_id}::uuid
        `.execute(transaction);
      }
      return {
        body: { attemptId, revision, savedAt: now.toISOString() },
        etag: strongAttemptEtag(attemptId, revision, responseHash),
      };
    });
  }

  submit(
    request: ApiRequest,
    attemptId: string,
    idempotencyKey: string | undefined,
    ifMatch: string | undefined,
    input: { baseRevision: number; clientSubmittedAt: string },
  ): Promise<IdempotentCommandResult<Record<string, unknown>>> {
    if (!ifMatch) throw ProblemException.preconditionRequired();
    const actor = actorFrom(request);
    return this.idempotency.execute(
      transactionContext(actor),
      'student.attempt.submit',
      idempotencyKey,
      { attemptId, ifMatch, ...input },
      async (transaction) => {
        const draft = await this.requireDraft(transaction, actor.membershipId, attemptId);
        const currentEtag = headerEtag(draft.etag);
        if (ifMatch !== currentEtag || input.baseRevision !== draft.revision) {
          throw ProblemException.preconditionFailed(currentEtag);
        }
        try {
          assertAttemptMaySubmit(draft.state);
        } catch {
          throw ProblemException.conflict('attempt_not_submittable', 'Attempt 当前状态不可提交。');
        }
        const now = new Date();
        if (draft.close_at && now > draft.close_at) {
          throw ProblemException.conflict('task_closed', '任务提交窗口已关闭。');
        }
        const isLate = Boolean(draft.due_at && now > draft.due_at);
        if (isLate && draft.late_policy === 'deny') {
          throw ProblemException.conflict('late_submission_denied', '该任务不允许逾期提交。');
        }
        const previous = await sql<{ id: string; submission_revision: number }>`
          select id, submission_revision::int as submission_revision from submission_snapshots
          where tenant_id = ${actor.tenantId}::uuid and task_attempt_id = ${attemptId}::uuid
          order by submission_revision desc limit 1 for update
        `.execute(transaction);
        const submissionRevision = nextSubmissionRevision(
          previous.rows[0]?.submission_revision ?? 0,
        );
        const submissionId = uuidv7();
        const snapshotHash = sha256(
          canonicalJson({ responses: draft.responses, revision: submissionRevision }),
        );
        await sql`
          insert into submission_snapshots (
            id, tenant_id, task_attempt_id, submission_revision,
            previous_submission_snapshot_id, draft_revision, responses, submitted_at,
            client_submitted_at, is_late, snapshot_hash, created_at
          ) values (
            ${submissionId}::uuid, ${actor.tenantId}::uuid, ${attemptId}::uuid,
            ${submissionRevision}, ${previous.rows[0]?.id ?? null}::uuid, ${draft.revision},
            ${JSON.stringify(draft.responses)}::jsonb, ${now}, ${new Date(input.clientSubmittedAt)},
            ${isLate}, ${snapshotHash}, ${now}
          )
        `.execute(transaction);
        const grading = await this.autoGrade(
          transaction,
          actor,
          attemptId,
          submissionId,
          draft.responses,
          now,
        );
        const nextState: AttemptState = grading.needsTeacher ? 'grading' : 'completed';
        await sql`
          update task_attempts set state = ${nextState}, last_submitted_at = ${now},
            completed_at = ${grading.needsTeacher ? null : now}, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${attemptId}::uuid
        `.execute(transaction);
        const workflow: WorkflowState = grading.needsTeacher ? 'grading' : 'completed';
        await sql`
          update student_task_items set workflow_state = ${workflow}, updated_at = ${now}
          where tenant_id = ${actor.tenantId}::uuid and id = ${draft.item_id}::uuid
        `.execute(transaction);
        await this.events.append(transaction, actor, {
          action: 'attempt.submit',
          resourceType: 'submission_snapshot',
          resourceId: submissionId,
          eventType: 'task.submitted.v1',
          payload: { attemptId, taskItemId: draft.item_id, submissionRevision, isLate },
        });
        return {
          status: 200,
          body: {
            attemptId,
            taskItemId: draft.item_id,
            submissionSnapshotId: submissionId,
            previousSubmissionSnapshotId: previous.rows[0]?.id ?? null,
            workflowState: workflow,
            submissionRevision,
            submissionHash: snapshotHash,
            serverSubmittedAt: now.toISOString(),
            isLate,
          },
        };
      },
    );
  }

  async attempt(request: ApiRequest, attemptId: string) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const draft = await this.requireDraft(transaction, actor.membershipId, attemptId);
      const attempt = await sql<AttemptRow>`
        select id, student_task_item_id, attempt_no::int as attempt_no, state, snapshot_hash, started_at, last_submitted_at
        from task_attempts where tenant_id = ${actor.tenantId}::uuid and id = ${attemptId}::uuid
      `.execute(transaction);
      const grade = await sql<{
        id: string;
        submission_snapshot_id: string;
        submission_revision: number;
        decision_type: string;
        score: number;
        max_score: number;
        rubric_result: unknown;
        decided_by_membership_id: string | null;
        created_at: Date;
        feedback_body: unknown;
      }>`select decision.id,submission.id submission_snapshot_id,
          submission.submission_revision::int submission_revision,decision.decision_type,
          decision.score::float8 score,decision.max_score::float8 max_score,
          decision.rubric_result,decision.decided_by_membership_id,decision.created_at,
          visible.body feedback_body
        from submission_snapshots submission
        join score_decisions decision on decision.tenant_id=submission.tenant_id
          and decision.submission_snapshot_id=submission.id
        left join lateral(
          select feedback.body from feedback
          where feedback.submission_snapshot_id=submission.id
            and feedback.score_decision_id=decision.id and feedback.visibility='student'
          order by feedback.created_at desc,feedback.id desc limit 1
        ) visible on true
        where submission.task_attempt_id=${attemptId}::uuid
          and submission.submission_revision=(select max(latest.submission_revision)
            from submission_snapshots latest where latest.task_attempt_id=${attemptId}::uuid)
          and not exists(select 1 from score_decisions newer
            where newer.supersedes_score_decision_id=decision.id)
        order by case decision.decision_type when 'admin_override' then 300
          when 'teacher_confirmed' then 200 else 100 end desc,
          decision.created_at desc,decision.id desc limit 1`.execute(transaction);
      const gradeRow = grade.rows[0];
      return {
        body: {
          attempt: await this.attemptJson(transaction, attempt.rows[0]!),
          answers: Object.entries(draft.responses).map(([questionVersionId, value]) => ({
            questionVersionId,
            value,
          })),
          grade: gradeRow
            ? this.gradeJson(attemptId, gradeRow, gradeRow.feedback_body)
            : null,
        },
        etag: headerEtag(draft.etag),
      };
    });
  }

  async profile(request: ApiRequest) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const result = await sql<{
        profile_id: string;
        user_id: string;
        display_name: string;
        student_no: string | null;
        locale: string;
        timezone: string;
        created_at: Date;
        updated_at: Date;
      }>`
        select sp.id as profile_id, tm.user_id, u.display_name, sp.student_no,
               sp.locale, sp.timezone, sp.created_at, sp.updated_at
        from student_profiles sp
        join tenant_memberships tm on tm.tenant_id = sp.tenant_id and tm.id = sp.membership_id
        join users u on u.id = tm.user_id
        where sp.tenant_id = ${actor.tenantId}::uuid and sp.membership_id = ${actor.membershipId}::uuid
      `.execute(transaction);
      const row = result.rows[0];
      if (!row) throw ProblemException.notFound();
      const goals = await sql<{
        id: string;
        exam_code: string;
        target_score: number | null;
        target_date: string | null;
        status: string;
      }>`
        select seg.id, pe.code as exam_code, seg.target_score::float8 as target_score,
               seg.target_date::text as target_date, seg.status
        from student_exam_goals seg
        join platform.published_exams pe on pe.id = seg.exam_id
        where seg.tenant_id = ${actor.tenantId}::uuid and seg.student_profile_id = ${row.profile_id}::uuid
        order by seg.is_primary desc, seg.created_at
      `.execute(transaction);
      return {
        membershipId: actor.membershipId,
        userId: row.user_id,
        displayName: row.display_name,
        studentNumber: row.student_no,
        locale: row.locale,
        timezone: row.timezone,
        examGoals: goals.rows.map((goal) => ({
          id: goal.id,
          exam: goal.exam_code.toLowerCase(),
          targetScore: goal.target_score,
          targetDate: goal.target_date,
          status: goal.status,
        })),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
  }

  async updateProfile(
    request: ApiRequest,
    input: {
      displayName?: string | undefined;
      locale?: 'zh-CN' | 'en-US' | undefined;
      timezone?: string | undefined;
      examGoals?:
        | Array<{
            id?: string | null | undefined;
            exam: 'toefl';
            targetScore: number;
            targetDate?: string | null | undefined;
            status?: 'active' | 'achieved' | 'cancelled' | undefined;
          }>
        | undefined;
    },
  ) {
    const actor = actorFrom(request);
    await this.database.withTenant(transactionContext(actor), async (transaction) => {
      const profile = await sql<{ id: string }>`
        select id from student_profiles where tenant_id = ${actor.tenantId}::uuid
          and membership_id = ${actor.membershipId}::uuid for update
      `.execute(transaction);
      const profileId = profile.rows[0]?.id;
      if (!profileId) throw ProblemException.notFound();
      if (input.displayName !== undefined) {
        await sql`update users set display_name = ${input.displayName}, updated_at = now() where id = ${actor.userId}::uuid`.execute(
          transaction,
        );
      }
      if (input.locale !== undefined || input.timezone !== undefined) {
        await sql`
          update student_profiles set locale = coalesce(${input.locale ?? null}, locale),
            timezone = coalesce(${input.timezone ?? null}, timezone), updated_at = now()
          where tenant_id = ${actor.tenantId}::uuid and id = ${profileId}::uuid
        `.execute(transaction);
      }
      for (const goal of input.examGoals ?? []) {
        const exam = await sql<{
          id: string;
        }>`select id from platform.published_exams where lower(code) = ${goal.exam}`.execute(
          transaction,
        );
        const examId = exam.rows[0]?.id;
        if (!examId)
          throw ProblemException.badRequest('exam_not_supported', `不支持考试 ${goal.exam}。`);
        if (goal.id) {
          const updated = await sql<{ id: string }>`
            update student_exam_goals set target_score = ${goal.targetScore},
              target_date = ${goal.targetDate ?? null}::date,
              status = ${goal.status ?? 'active'}, updated_at = now()
            where tenant_id = ${actor.tenantId}::uuid and id = ${goal.id}::uuid
              and student_profile_id = ${profileId}::uuid returning id
          `.execute(transaction);
          if (!updated.rows[0]) throw ProblemException.notFound();
        } else {
          await sql`
            insert into student_exam_goals (
              id, tenant_id, student_profile_id, exam_id, target_score, target_components,
              target_date, is_primary, status, created_at, updated_at
            ) values (
              ${uuidv7()}::uuid, ${actor.tenantId}::uuid, ${profileId}::uuid, ${examId}::uuid,
              ${goal.targetScore}, '{}'::jsonb, ${goal.targetDate ?? null}::date, false,
              ${goal.status ?? 'active'}, now(), now()
            )
          `.execute(transaction);
        }
      }
      await this.events.append(transaction, actor, {
        action: 'student.profile.update',
        resourceType: 'student_profile',
        resourceId: profileId,
        eventType: 'student.profile.updated.v1',
        payload: { fields: Object.keys(input) },
      });
    });
    return this.profile(request);
  }

  async paths(request: ApiRequest, input: StudentPathListQuery = {}) {
    const actor = actorFrom(request);
    const pageSize = this.cursors.pageSize(input.pageSize);
    const filters = { track: input.track ?? null };
    const cursorContext = {
      scope: `student.paths:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.dateAndUuid);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const result = await sql<{
        id: string;
        learning_path_version_id: string;
        title: string;
        track: string;
        status: string;
        enrolled_at: Date;
        target_completion_date: string | null;
        completed_count: number;
        total_count: number;
      }>`
        select spe.id, spe.learning_path_version_id, lpv.title, lp.track, spe.status,
          spe.enrolled_at, spe.target_completion_date::text,
          count(distinct sti.id) filter (where sti.workflow_state = 'completed')::int as completed_count,
          count(distinct sti.id)::int as total_count
        from student_path_enrollments spe
        join student_profiles sp on sp.tenant_id = spe.tenant_id and sp.id = spe.student_profile_id
        join learning_path_versions lpv on lpv.tenant_id = spe.tenant_id and lpv.id = spe.learning_path_version_id
        join learning_paths lp on lp.tenant_id = lpv.tenant_id and lp.id = lpv.learning_path_id
        left join student_task_sources sts on sts.tenant_id = spe.tenant_id and sts.student_path_enrollment_id = spe.id
        left join student_task_items sti on sti.tenant_id = sts.tenant_id and sti.id = sts.student_task_item_id
        where sp.membership_id = ${actor.membershipId}::uuid
          and (${input.track ?? null}::learning_track is null or lp.track = ${input.track ?? null}::learning_track)
          and (${after?.[0] ? new Date(after[0]) : null}::timestamptz is null
            or (date_trunc('milliseconds',spe.enrolled_at), spe.id) < (${after?.[0] ? new Date(after[0]) : null}, ${after?.[1] ?? null}::uuid))
        group by spe.id, lpv.title, lp.track
        order by date_trunc('milliseconds',spe.enrolled_at) desc, spe.id desc
        limit ${pageSize + 1}
      `.execute(transaction);
      const page = this.cursors.page(result.rows, pageSize, cursorContext, (row) => [
        row.enrolled_at.toISOString(),
        row.id,
      ]);
      return {
        data: page.items.map((row) => ({
          id: row.id,
          pathVersionId: row.learning_path_version_id,
          title: row.title,
          track: row.track,
          status: row.status,
          progressPercent: row.total_count ? (row.completed_count * 100) / row.total_count : 0,
          enrolledAt: row.enrolled_at.toISOString(),
          targetCompletionDate: row.target_completion_date,
        })),
        page: page.page,
      };
    });
  }

  async path(request: ApiRequest, enrollmentId: string) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const summary = await sql<{
        id: string;
        learning_path_version_id: string;
        title: string;
        track: string;
        status: string;
        enrolled_at: Date;
        target_completion_date: string | null;
        completed_count: number;
        total_count: number;
      }>`
        select spe.id, spe.learning_path_version_id, lpv.title, lp.track, spe.status,
          spe.enrolled_at, spe.target_completion_date::text,
          count(distinct sti.id) filter (where sti.workflow_state = 'completed')::int as completed_count,
          count(distinct sti.id)::int as total_count
        from student_path_enrollments spe
        join student_profiles sp on sp.tenant_id = spe.tenant_id and sp.id = spe.student_profile_id
        join learning_path_versions lpv on lpv.tenant_id = spe.tenant_id and lpv.id = spe.learning_path_version_id
        join learning_paths lp on lp.tenant_id = lpv.tenant_id and lp.id = lpv.learning_path_id
        left join student_task_sources sts on sts.tenant_id = spe.tenant_id and sts.student_path_enrollment_id = spe.id
        left join student_task_items sti on sti.tenant_id = sts.tenant_id and sti.id = sts.student_task_item_id
        where spe.id = ${enrollmentId}::uuid and sp.membership_id = ${actor.membershipId}::uuid
        group by spe.id, lpv.title, lp.track
      `.execute(transaction);
      const row = summary.rows[0];
      if (!row) throw ProblemException.notFound();
      const enrollment = {
        id: row.id,
        pathVersionId: row.learning_path_version_id,
        title: row.title,
        track: row.track,
        status: row.status,
        progressPercent: row.total_count ? (row.completed_count * 100) / row.total_count : 0,
        enrolledAt: row.enrolled_at.toISOString(),
        targetCompletionDate: row.target_completion_date,
      };
      const result = await sql<{
        node_key: string;
        title: string;
        position: number;
        workflow_state: WorkflowState | null;
      }>`
        select pn.node_key, tv.title, pn.position,
          case when bool_or(sti.workflow_state = 'completed') then 'completed'::workflow_state else null end as workflow_state
        from student_path_enrollments spe
        join path_nodes pn on pn.tenant_id = spe.tenant_id and pn.learning_path_version_id = spe.learning_path_version_id
        join task_versions tv on tv.tenant_id = pn.tenant_id and tv.id = pn.task_version_id
        left join student_task_sources sts on sts.tenant_id = spe.tenant_id
          and sts.student_path_enrollment_id = spe.id
        left join student_task_items sti on sti.tenant_id = sts.tenant_id
          and sti.id = sts.student_task_item_id and sti.task_version_id = pn.task_version_id
        where spe.id = ${enrollmentId}::uuid
        group by pn.node_key, tv.title, pn.position
        order by pn.position
      `.execute(transaction);
      const milestones = result.rows.map((row) => ({
        key: row.node_key,
        title: row.title,
        position: row.position,
        state: row.workflow_state === 'completed' ? 'completed' : 'active',
        completedTaskCount: row.workflow_state === 'completed' ? 1 : 0,
        totalTaskCount: 1,
      }));
      return { enrollment, milestones };
    });
  }

  async progress(request: ApiRequest, from: string, to: string) {
    const actor = actorFrom(request);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const result = await sql<{
        task_kind: string;
        assigned: number;
        completed: number;
        late: number;
        on_time: number;
        average_score: number | null;
      }>`
        with item_base as(
          select item.*,version.task_kind from student_task_items item
          join student_profiles profile on profile.tenant_id=item.tenant_id and profile.id=item.student_profile_id
          join task_versions version on version.tenant_id=item.tenant_id and version.id=item.task_version_id
          where profile.membership_id=${actor.membershipId}::uuid
            and item.created_at>=${from}::date and item.created_at<(${to}::date+interval '1 day')
        )
        select base.task_kind,count(*)::int assigned,
          count(*) filter(where base.workflow_state='completed')::int completed,
          count(latest_submission.id) filter(where latest_submission.is_late)::int late,
          count(latest_submission.id) filter(where not latest_submission.is_late)::int on_time,
          avg(final_score.score/nullif(final_score.max_score,0)*100)::float8 average_score
        from item_base base
        left join lateral(select attempt.id from task_attempts attempt where attempt.student_task_item_id=base.id order by attempt.attempt_no desc,attempt.id desc limit 1) latest_attempt on true
        left join lateral(select submission.id,submission.is_late from submission_snapshots submission where submission.task_attempt_id=latest_attempt.id order by submission.submission_revision desc,submission.id desc limit 1) latest_submission on true
        left join lateral(select decision.score::float8 score,decision.max_score::float8 max_score from score_decisions decision where decision.submission_snapshot_id=latest_submission.id and not exists(select 1 from score_decisions newer where newer.supersedes_score_decision_id=decision.id) order by case decision.decision_type when 'admin_override' then 300 when 'teacher_confirmed' then 200 else 100 end desc,decision.created_at desc,decision.id desc limit 1) final_score on true
        group by base.task_kind order by base.task_kind
      `.execute(transaction);
      const byKind = result.rows.map((row) => ({
        kind: row.task_kind,
        assigned: row.assigned,
        completed: row.completed,
        averageScorePercent: row.average_score,
      }));
      return {
        from,
        to,
        assignedCount: byKind.reduce((total, row) => total + row.assigned, 0),
        completedCount: byKind.reduce((total, row) => total + row.completed, 0),
        onTimeCount: result.rows.reduce((total, row) => total + row.on_time, 0),
        lateCount: result.rows.reduce((total, row) => total + row.late, 0),
        byKind,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  async feedback(request: ApiRequest, input: StudentFeedbackListQuery = {}) {
    const actor = actorFrom(request);
    const pageSize = this.cursors.pageSize(input.pageSize);
    const filters = { unreadOnly: input.unreadOnly ?? false };
    const cursorContext = {
      scope: `student.feedback:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.dateAndUuid);
    return this.database.withTenant(transactionContext(actor), async (transaction) => {
      const result = await sql<{
        id: string;
        task_item_id: string;
        attempt_id: string;
        title: string;
        body: unknown;
        returned_at: Date;
        score_id: string | null;
        score: number | null;
        max_score: number | null;
        decision_type: string | null;
        submission_id: string;
        submission_revision: number;
      }>`
        select f.id, sti.id as task_item_id, ta.id as attempt_id, tv.title, f.body,
          f.created_at as returned_at, sd.id as score_id, sd.score::float8 as score,
          sd.max_score::float8 as max_score, sd.decision_type, ss.id as submission_id,
          ss.submission_revision::int as submission_revision
        from feedback f
        join task_attempts ta on ta.tenant_id = f.tenant_id and ta.id = f.task_attempt_id
        join student_task_items sti on sti.tenant_id = ta.tenant_id and sti.id = ta.student_task_item_id
        join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
        join task_versions tv on tv.tenant_id = sti.tenant_id and tv.id = sti.task_version_id
        join submission_snapshots ss on ss.tenant_id = f.tenant_id and ss.id = f.submission_snapshot_id
        join score_decisions sd on sd.tenant_id = f.tenant_id and sd.id = f.score_decision_id
        where sp.membership_id = ${actor.membershipId}::uuid and f.visibility = 'student'
          and not exists(select 1 from score_decisions newer
            where newer.tenant_id=sd.tenant_id and newer.supersedes_score_decision_id=sd.id)
          and (${after?.[0] ? new Date(after[0]) : null}::timestamptz is null
            or (date_trunc('milliseconds',f.created_at), f.id) < (${after?.[0] ? new Date(after[0]) : null}, ${after?.[1] ?? null}::uuid))
        order by date_trunc('milliseconds',f.created_at) desc, f.id desc limit ${pageSize + 1}
      `.execute(transaction);
      const page = this.cursors.page(result.rows, pageSize, cursorContext, (row) => [
        row.returned_at.toISOString(),
        row.id,
      ]);
      return {
        data: page.items.map((row) => ({
          id: row.id,
          taskItemId: row.task_item_id,
          attemptId: row.attempt_id,
          taskTitle: row.title,
          grade: this.gradeJson(row.attempt_id, {
            id: row.score_id!,
            submission_snapshot_id: row.submission_id,
            submission_revision: row.submission_revision,
            decision_type: row.decision_type!,
            score: row.score!,
            max_score: row.max_score!,
            rubric_result: this.feedbackRubricScores(row.body),
            decided_by_membership_id: null,
            created_at: row.returned_at,
          }, row.body),
          returnedAt: row.returned_at.toISOString(),
          readAt: null,
        })),
        page: page.page,
      };
    });
  }

  private async listTaskRows(
    transaction: TenantTransaction,
    membershipId: string,
    limit: number,
  ): Promise<TaskItemRow[]> {
    const result = await sql<TaskItemRow>`
      select sti.id, sti.task_version_id, sti.occurrence_key, sti.slot_key,
             sti.resolution_state, sti.resolution_reason, sti.workflow_state,
             sti.available_at, sti.due_at, sti.close_at, tv.title, tv.task_kind,
             tv.version_no, tv.instructions, tv.content_hash as task_content_hash,
             coalesce(ta.max_attempts, 1)::int as max_attempts,
             coalesce(ta.late_policy, 'allow') as late_policy,
             (select count(*)::int from student_task_sources sts
               where sts.tenant_id = sti.tenant_id and sts.student_task_item_id = sti.id) as source_count,
             coalesce((select submission.is_late from task_attempts attempt
               join submission_snapshots submission on submission.tenant_id=attempt.tenant_id and submission.task_attempt_id=attempt.id
               where attempt.tenant_id=sti.tenant_id and attempt.student_task_item_id=sti.id
               order by submission.submitted_at desc,submission.id desc limit 1),false) as is_late,
             sti.created_at
      from student_task_items sti
      join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
      join task_versions tv on tv.tenant_id = sti.tenant_id and tv.id = sti.task_version_id
      left join student_task_sources ws on ws.tenant_id = sti.tenant_id and ws.id = sti.winning_source_id
      left join task_assignments ta on ta.tenant_id = ws.tenant_id and ta.id = ws.task_assignment_id
      where sp.membership_id = ${membershipId}::uuid
      order by sti.due_at nulls last, sti.created_at, sti.id
      limit ${limit}
    `.execute(transaction);
    return result.rows;
  }

  private gradeJson(
    attemptId: string,
    row: {
      id: string;
      submission_snapshot_id: string;
      submission_revision: number;
      decision_type: string;
      score: number;
      max_score: number;
      rubric_result: unknown;
      decided_by_membership_id: string | null;
      created_at: Date;
    },
    feedbackBody: unknown,
  ) {
    const body =
      feedbackBody && typeof feedbackBody === 'object' && !Array.isArray(feedbackBody)
        ? (feedbackBody as Record<string, unknown>)
        : {};
    const rubricScores = Array.isArray(row.rubric_result)
      ? row.rubric_result
      : this.feedbackRubricScores(feedbackBody);
    return {
      id: row.id,
      attemptId,
      submissionSnapshotId: row.submission_snapshot_id,
      submissionRevision: row.submission_revision,
      source: row.decision_type,
      score: row.score,
      maxScore: row.max_score,
      feedback: typeof body['message'] === 'string' ? body['message'] : null,
      rubricScores,
      createdByMembershipId: row.decided_by_membership_id,
      createdAt: row.created_at.toISOString(),
      snapshotHash: sha256(
        canonicalJson({
          id: row.id,
          submissionSnapshotId: row.submission_snapshot_id,
          score: row.score,
          maxScore: row.max_score,
          feedback: body['message'] ?? null,
          rubricScores,
        }),
      ),
    };
  }

  private feedbackRubricScores(body: unknown): unknown[] {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
    const scores = (body as Record<string, unknown>)['rubricScores'];
    return Array.isArray(scores) ? scores : [];
  }

  private async requireTaskItem(
    transaction: TenantTransaction,
    membershipId: string,
    itemId: string,
    lock: boolean,
  ): Promise<TaskItemRow> {
    const suffix = lock ? sql`for update of sti` : sql``;
    const result = await sql<TaskItemRow>`
      select sti.id, sti.task_version_id, sti.occurrence_key, sti.slot_key,
             sti.resolution_state, sti.resolution_reason, sti.workflow_state,
             sti.available_at, sti.due_at, sti.close_at, tv.title, tv.task_kind,
             tv.version_no, tv.instructions, tv.content_hash as task_content_hash,
             coalesce(ta.max_attempts, 1)::int as max_attempts,
             coalesce(ta.late_policy, 'allow') as late_policy,
             (select count(*)::int from student_task_sources sts
               where sts.tenant_id = sti.tenant_id and sts.student_task_item_id = sti.id) as source_count,
             coalesce((select submission.is_late from task_attempts attempt
               join submission_snapshots submission on submission.tenant_id=attempt.tenant_id and submission.task_attempt_id=attempt.id
               where attempt.tenant_id=sti.tenant_id and attempt.student_task_item_id=sti.id
               order by submission.submitted_at desc,submission.id desc limit 1),false) as is_late,
             sti.created_at
      from student_task_items sti
      join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
      join task_versions tv on tv.tenant_id = sti.tenant_id and tv.id = sti.task_version_id
      left join student_task_sources ws on ws.tenant_id = sti.tenant_id and ws.id = sti.winning_source_id
      left join task_assignments ta on ta.tenant_id = ws.tenant_id and ta.id = ws.task_assignment_id
      where sti.id = ${itemId}::uuid and sp.membership_id = ${membershipId}::uuid
      ${suffix}
    `.execute(transaction);
    const row = result.rows[0];
    if (!row) throw ProblemException.notFound();
    return row;
  }

  private async requireDraft(
    transaction: TenantTransaction,
    membershipId: string,
    attemptId: string,
  ): Promise<DraftRow> {
    const result = await sql<DraftRow>`
      select ta.id as attempt_id, ta.attempt_no::int as attempt_no, ta.state,
             ad.revision::int as revision, ad.etag,
             ad.responses, sti.id as item_id, sti.due_at, sti.close_at,
             coalesce(assign.late_policy, 'allow') as late_policy
      from task_attempts ta
      join attempt_drafts ad on ad.tenant_id = ta.tenant_id and ad.task_attempt_id = ta.id
      join student_task_items sti on sti.tenant_id = ta.tenant_id and sti.id = ta.student_task_item_id
      join student_profiles sp on sp.tenant_id = sti.tenant_id and sp.id = sti.student_profile_id
      left join student_task_sources ws on ws.tenant_id = sti.tenant_id and ws.id = sti.winning_source_id
      left join task_assignments assign on assign.tenant_id = ws.tenant_id and assign.id = ws.task_assignment_id
      where ta.id = ${attemptId}::uuid and sp.membership_id = ${membershipId}::uuid
      for update of ta, ad
    `.execute(transaction);
    const row = result.rows[0];
    if (!row) throw ProblemException.notFound();
    return row;
  }

  private async autoGrade(
    transaction: TenantTransaction,
    actor: EventActor,
    attemptId: string,
    submissionId: string,
    responses: Record<string, unknown>,
    now: Date,
  ): Promise<{ needsTeacher: boolean }> {
    // Answer keys are deliberately not readable by the english_app role. The grading
    // worker consumes task.submitted.v1 under its narrower privileged path and appends
    // auto_scored decisions. API submissions remain in grading until that event settles.
    void transaction;
    void actor;
    void attemptId;
    void submissionId;
    void responses;
    void now;
    return { needsTeacher: true };
  }

  private taskItemJson(item: TaskItemRow, tenantId: string, membershipId: string) {
    const now = Date.now();
    const availability =
      item.resolution_state !== 'active'
        ? 'locked'
        : item.available_at.getTime() > now
          ? 'upcoming'
          : 'available';
    return {
      id: item.id,
      tenantId,
      studentMembershipId: membershipId,
      taskVersionId: item.task_version_id,
      occurrenceKey: item.occurrence_key,
      slotKey: item.slot_key,
      title: item.title,
      kind: item.task_kind,
      resolutionState: item.resolution_state,
      resolutionReason: item.resolution_reason,
      workflowState: item.workflow_state,
      availability,
      availableAt: item.available_at.toISOString(),
      dueAt: item.due_at?.toISOString() ?? null,
      closeAt: item.close_at?.toISOString() ?? null,
      isOverdue: Boolean(
        item.due_at &&
        item.due_at.getTime() < now &&
        !['completed', 'cancelled'].includes(item.workflow_state),
      ),
      isLate: item.is_late,
      sourceCount: item.source_count,
      createdAt: item.created_at.toISOString(),
    };
  }

  private async attemptJson(transaction: TenantTransaction, attempt: AttemptRow) {
    const submissions = await sql<{ id: string; submission_revision: number }>`
      select id, submission_revision::int as submission_revision from submission_snapshots
      where task_attempt_id = ${attempt.id}::uuid order by submission_revision desc limit 1
    `.execute(transaction);
    const draft = await sql<{ revision: number }>`
      select revision::int as revision from attempt_drafts where task_attempt_id = ${attempt.id}::uuid
    `.execute(transaction);
    return {
      id: attempt.id,
      taskItemId: attempt.student_task_item_id,
      attemptNumber: attempt.attempt_no,
      state: attempt.state,
      revision: draft.rows[0]?.revision ?? 1,
      submissionRevision: submissions.rows[0]?.submission_revision ?? 0,
      latestSubmissionSnapshotId: submissions.rows[0]?.id ?? null,
      snapshotHash: attempt.snapshot_hash,
      startedAt: attempt.started_at.toISOString(),
      submittedAt: attempt.last_submitted_at?.toISOString() ?? null,
    };
  }
}
