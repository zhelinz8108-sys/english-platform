import { Inject, Injectable } from '@nestjs/common';
import type { TaskSourceType } from '@english/shared';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { CursorService, cursorKey } from '../common/cursor.js';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { DatabaseService, type TenantTransaction } from '../infrastructure/database.service.js';
import { EventsService, type EventActor } from '../infrastructure/events.service.js';
import { IdempotencyService } from '../infrastructure/idempotency.service.js';

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
function context(actor: EventActor) {
  return { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId };
}

export function assignmentCommandSpec(action: 'publish' | 'cancel') {
  return action === 'publish'
    ? { eventType: 'assignment.published.v1' as const, materializeSynchronously: false as const }
    : { eventType: 'assignment.cancelled.v1' as const, materializeSynchronously: false as const };
}

export interface AssignmentInput {
  taskVersionId: string;
  sourceType: TaskSourceType;
  occurrenceKey: string;
  slotKey: string;
  explicitPriority: number;
  scheduleMode: 'absolute' | 'path_relative';
  availableAt: string | null;
  dueAt: string | null;
  closeAt: string | null;
  maxAttempts: number;
  latePolicy: 'deny' | 'allow' | 'allow_with_penalty';
  targets: { studentMembershipIds: string[]; classIds: string[]; pathNodeIds: string[] };
}

export interface TeacherStudentListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  classId?: string | undefined;
  query?: string | undefined;
}

export interface TeacherClassListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  status?: 'draft' | 'active' | 'archived' | undefined;
}

export interface TeacherAssignmentListQuery {
  cursor?: string | undefined;
  pageSize?: string | undefined;
  status?: 'draft' | 'published' | 'cancelled' | undefined;
}

@Injectable()
export class TeacherOperationsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}

  async students(request: ApiRequest, input: TeacherStudentListQuery = {}) {
    const actor = actorFrom(request);
    const unrestricted = requireTenant(request).roles.some((r) => r === 'owner' || r === 'admin');
    const pageSize = this.cursors.pageSize(input.pageSize);
    const search = input.query?.trim() || null;
    const filters = { classId: input.classId ?? null, query: search?.toLocaleLowerCase() ?? null };
    const cursorContext = {
      scope: `teacher.students:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.stringAndUuid);
    return this.database.withTenant(context(actor), async (trx) => {
      const rows = await sql<{
        student_profile_id: string;
        membership_id: string;
        display_name: string;
        student_no: string | null;
        class_ids: string[];
        path_count: number;
        overdue: number;
      }>`
        select sp.id as student_profile_id, sp.membership_id, u.display_name, sp.student_no,
          coalesce(array_agg(distinct cs.class_id) filter (where cs.class_id is not null), '{}') as class_ids,
          (select count(*)::int from student_path_enrollments spe where spe.tenant_id=sp.tenant_id and spe.student_profile_id=sp.id and spe.status in ('active','paused')) as path_count,
          (select count(*)::int from student_task_items sti where sti.tenant_id=sp.tenant_id and sti.student_profile_id=sp.id and sti.due_at<now() and sti.workflow_state in ('not_started','in_progress','returned')) as overdue
        from student_profiles sp join tenant_memberships tm on tm.tenant_id=sp.tenant_id and tm.id=sp.membership_id and tm.status='active'
        join users u on u.id=tm.user_id
        left join class_students cs on cs.tenant_id=sp.tenant_id and cs.student_profile_id=sp.id and cs.left_at is null
        where sp.status='active'
          and (${input.classId ?? null}::uuid is null or exists (
            select 1 from class_students filter_cs where filter_cs.tenant_id=sp.tenant_id
              and filter_cs.student_profile_id=sp.id and filter_cs.class_id=${input.classId ?? null}::uuid
              and filter_cs.left_at is null
          ))
          and (${search}::text is null or u.display_name ilike ${search ? `%${search}%` : null}
            or sp.student_no ilike ${search ? `%${search}%` : null})
          and (${after?.[0] ?? null}::text is null
            or (u.display_name,sp.id) > (${after?.[0] ?? null},${after?.[1] ?? null}::uuid))
          and (${unrestricted} or exists (
          select 1 from teacher_profiles tp where tp.tenant_id=sp.tenant_id and tp.membership_id=${actor.membershipId}::uuid and (
            exists(select 1 from student_teacher_links stl where stl.tenant_id=sp.tenant_id and stl.teacher_profile_id=tp.id and stl.student_profile_id=sp.id and stl.valid_to is null)
            or exists(select 1 from class_teachers ct join class_students owncs on owncs.tenant_id=ct.tenant_id and owncs.class_id=ct.class_id where ct.tenant_id=sp.tenant_id and ct.teacher_profile_id=tp.id and owncs.student_profile_id=sp.id and ct.left_at is null and owncs.left_at is null)
          )))
        group by sp.id,u.display_name order by u.display_name,sp.id limit ${pageSize + 1}
      `.execute(trx);
      const page = this.cursors.page(rows.rows, pageSize, cursorContext, (row) => [
        row.display_name,
        row.student_profile_id,
      ]);
      return {
        data: page.items.map((r) => ({
          membershipId: r.membership_id,
          displayName: r.display_name,
          studentNumber: r.student_no,
          classIds: r.class_ids,
          activePathCount: r.path_count,
          overdueTaskCount: r.overdue,
        })),
        page: page.page,
      };
    });
  }

  async student(request: ApiRequest, membershipId: string) {
    const actor = actorFrom(request),
      to = new Date().toISOString().slice(0, 10),
      from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    return this.database.withTenant(context(actor), async (trx) => {
      const studentProfileId = await this.requireStudentProfile(trx, request, membershipId);
      const summary = await sql<any>`select sp.membership_id,u.display_name,sp.student_no,
        coalesce(array_agg(distinct cs.class_id) filter(where cs.class_id is not null),'{}') class_ids,
        (select count(*)::int from student_path_enrollments enrollment where enrollment.student_profile_id=sp.id and enrollment.status in('active','paused')) path_count,
        (select count(*)::int from student_task_items item where item.student_profile_id=sp.id and item.due_at<now() and item.workflow_state in('not_started','in_progress','returned')) overdue
        from student_profiles sp join tenant_memberships tm on tm.tenant_id=sp.tenant_id and tm.id=sp.membership_id and tm.status='active'
        join users u on u.id=tm.user_id left join class_students cs on cs.tenant_id=sp.tenant_id and cs.student_profile_id=sp.id and cs.left_at is null
        where sp.id=${studentProfileId}::uuid group by sp.id,u.display_name`.execute(trx);
      const row = summary.rows[0];
      if (!row) throw ProblemException.notFound();
      const student = {
        membershipId: row.membership_id,
        displayName: row.display_name,
        studentNumber: row.student_no,
        classIds: row.class_ids,
        activePathCount: row.path_count,
        overdueTaskCount: row.overdue,
      };
      const goals =
        await sql<any>`select goal.id,lower(exam.code) exam,goal.target_score::float8 target_score,goal.target_date::text target_date,goal.status
        from student_exam_goals goal join platform.published_exams exam on exam.id=goal.exam_id
        where goal.student_profile_id=${studentProfileId}::uuid order by goal.is_primary desc,goal.created_at`.execute(
          trx,
        );
      const progressRows = await sql<any>`
        with item_base as(
          select item.*,version.task_kind from student_task_items item
          join task_versions version on version.tenant_id=item.tenant_id and version.id=item.task_version_id
          where item.student_profile_id=${studentProfileId}::uuid and item.created_at>=${from}::date and item.created_at<(${to}::date+interval '1 day')
        )
        select base.task_kind,count(*)::int assigned,
          count(*) filter(where base.workflow_state='completed')::int completed,
          count(latest_submission.id) filter(where not latest_submission.is_late)::int on_time,
          count(latest_submission.id) filter(where latest_submission.is_late)::int late,
          avg(final_score.score/nullif(final_score.max_score,0)*100)::float8 average_score
        from item_base base
        left join lateral(select attempt.id from task_attempts attempt where attempt.student_task_item_id=base.id order by attempt.attempt_no desc,attempt.id desc limit 1) latest_attempt on true
        left join lateral(select submission.id,submission.is_late from submission_snapshots submission where submission.task_attempt_id=latest_attempt.id order by submission.submission_revision desc,submission.id desc limit 1) latest_submission on true
        left join lateral(select decision.score::float8 score,decision.max_score::float8 max_score from score_decisions decision where decision.submission_snapshot_id=latest_submission.id and not exists(select 1 from score_decisions newer where newer.supersedes_score_decision_id=decision.id) order by case decision.decision_type when 'admin_override' then 300 when 'teacher_confirmed' then 200 else 100 end desc,decision.created_at desc,decision.id desc limit 1) final_score on true
        group by base.task_kind order by base.task_kind
      `.execute(trx);
      const byKind = progressRows.rows.map((kind: any) => ({
        kind: kind.task_kind,
        assigned: kind.assigned,
        completed: kind.completed,
        averageScorePercent: kind.average_score,
      }));
      const progress = {
        from,
        to,
        assignedCount: byKind.reduce((n: number, x: any) => n + x.assigned, 0),
        completedCount: byKind.reduce((n: number, x: any) => n + x.completed, 0),
        onTimeCount: progressRows.rows.reduce((n: number, x: any) => n + x.on_time, 0),
        lateCount: progressRows.rows.reduce((n: number, x: any) => n + x.late, 0),
        byKind,
        generatedAt: new Date().toISOString(),
      };
      const tasks =
        await sql<any>`select item.id,item.task_version_id,item.occurrence_key,item.slot_key,item.resolution_state,item.resolution_reason,item.workflow_state,item.available_at,item.due_at,item.close_at,item.created_at,version.title,version.task_kind,
        (select count(*)::int from student_task_sources source where source.student_task_item_id=item.id) source_count,
        coalesce((select submission.is_late from task_attempts attempt join submission_snapshots submission on submission.task_attempt_id=attempt.id where attempt.student_task_item_id=item.id order by submission.submitted_at desc,submission.id desc limit 1),false) is_late
        from student_task_items item join task_versions version on version.tenant_id=item.tenant_id and version.id=item.task_version_id
        where item.student_profile_id=${studentProfileId}::uuid order by item.updated_at desc,item.id desc limit 20`.execute(
          trx,
        );
      const now = Date.now();
      const recentTaskItems = tasks.rows.map((task: any) => ({
        id: task.id,
        tenantId: actor.tenantId,
        studentMembershipId: membershipId,
        taskVersionId: task.task_version_id,
        occurrenceKey: task.occurrence_key,
        slotKey: task.slot_key,
        title: task.title,
        kind: task.task_kind,
        resolutionState: task.resolution_state,
        resolutionReason: task.resolution_reason,
        workflowState: task.workflow_state,
        availability:
          task.resolution_state !== 'active'
            ? 'locked'
            : new Date(task.available_at).getTime() > now
              ? 'upcoming'
              : 'available',
        availableAt: new Date(task.available_at).toISOString(),
        dueAt: task.due_at ? new Date(task.due_at).toISOString() : null,
        closeAt: task.close_at ? new Date(task.close_at).toISOString() : null,
        isOverdue: Boolean(
          task.due_at &&
          new Date(task.due_at).getTime() < now &&
          !['completed', 'cancelled'].includes(task.workflow_state),
        ),
        isLate: task.is_late,
        sourceCount: task.source_count,
        createdAt: new Date(task.created_at).toISOString(),
      }));
      return {
        student,
        examGoals: goals.rows.map((goal: any) => ({
          id: goal.id,
          exam: goal.exam,
          targetScore: goal.target_score,
          targetDate: goal.target_date,
          status: goal.status,
        })),
        progress,
        recentTaskItems,
      };
    });
  }

  enroll(
    request: ApiRequest,
    studentMembershipId: string,
    key: string | undefined,
    input: { pathVersionId: string; targetCompletionDate: string | null },
  ) {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      context(actor),
      'teacher.path.enroll',
      key,
      { studentMembershipId, ...input },
      async (trx) => {
        const student = await this.requireStudentProfile(trx, request, studentMembershipId);
        const path = await sql<{
          title: string;
          track: string;
        }>`select lpv.title,lp.track from learning_path_versions lpv join learning_paths lp on lp.tenant_id=lpv.tenant_id and lp.id=lpv.learning_path_id where lpv.id=${input.pathVersionId}::uuid and lpv.publication_state='published'`.execute(
          trx,
        );
        if (!path.rows[0]) throw ProblemException.notFound();
        const id = uuidv7();
        const now = new Date();
        await sql`insert into student_path_enrollments(id,tenant_id,student_profile_id,learning_path_version_id,student_exam_goal_id,source,status,enrolled_at,target_completion_date,assigned_by_membership_id,created_at,updated_at) values(${id}::uuid,${actor.tenantId}::uuid,${student}::uuid,${input.pathVersionId}::uuid,null,'manual','active',${now},${input.targetCompletionDate}::date,${actor.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
        await this.events.append(trx, actor, {
          action: 'path.enroll',
          resourceType: 'student_path_enrollment',
          resourceId: id,
          eventType: 'path.enrolled.v1',
          payload: { studentProfileId: student, pathVersionId: input.pathVersionId },
        });
        return {
          status: 201,
          body: {
            id,
            pathVersionId: input.pathVersionId,
            title: path.rows[0].title,
            track: path.rows[0].track,
            status: 'active',
            progressPercent: 0,
            enrolledAt: now.toISOString(),
            targetCompletionDate: input.targetCompletionDate,
          },
        };
      },
    );
  }

  async updateEnrollment(
    request: ApiRequest,
    studentMembershipId: string,
    enrollmentId: string,
    input: { status: 'active' | 'paused' | 'completed' | 'cancelled'; reason: string },
  ) {
    const actor = actorFrom(request);
    return this.database.withTenant(context(actor), async (trx) => {
      const student = await this.requireStudentProfile(trx, request, studentMembershipId);
      const now = new Date();
      const updated = await sql<{
        learning_path_version_id: string;
        enrolled_at: Date;
        target_completion_date: string | null;
      }>`update student_path_enrollments
          set status=${input.status}::enrollment_status,
              paused_at=case when ${input.status}::text='paused' then ${now}::timestamptz else null::timestamptz end,
              completed_at=case when ${input.status}::text='completed' then ${now}::timestamptz else completed_at end,
              cancelled_at=case when ${input.status}::text='cancelled' then ${now}::timestamptz else null::timestamptz end,
              updated_at=${now}::timestamptz
          where id=${enrollmentId}::uuid and student_profile_id=${student}::uuid
          returning learning_path_version_id,enrolled_at,target_completion_date::text`.execute(trx);
      const row = updated.rows[0];
      if (!row) throw ProblemException.notFound();
      const path = await sql<{
        title: string;
        track: string;
      }>`select version.title,path.track from learning_path_versions version join learning_paths path on path.tenant_id=version.tenant_id and path.id=version.learning_path_id where version.id=${row.learning_path_version_id}::uuid`.execute(
        trx,
      );
      if (input.status === 'paused' || input.status === 'cancelled')
        await sql`
        update student_task_sources source set inactive_at=${now},
          inactive_reason=${input.status === 'paused' ? 'enrollment_paused' : 'other'}
        from student_task_items item
        where source.student_path_enrollment_id=${enrollmentId}::uuid
          and source.student_task_item_id=item.id and source.tenant_id=item.tenant_id
          and item.workflow_state='not_started' and source.inactive_at is null
      `.execute(trx);
      if (input.status === 'active')
        await sql`
        update student_task_sources source set inactive_at=null,inactive_reason=null
        from student_task_items item
        where source.student_path_enrollment_id=${enrollmentId}::uuid
          and source.student_task_item_id=item.id and source.tenant_id=item.tenant_id
          and item.workflow_state='not_started'
          and source.inactive_reason in ('enrollment_paused','other')
      `.execute(trx);
      await this.events.append(trx, actor, {
        action: 'path.enrollment.status',
        resourceType: 'student_path_enrollment',
        resourceId: enrollmentId,
        eventType: 'path.enrollment_status_changed.v1',
        payload: { status: input.status, reason: input.reason, reconcileTaskSources: true },
      });
      const progress = await sql<{
        completed: number;
        total: number;
      }>`select count(distinct item.id) filter(where item.workflow_state='completed')::int completed,count(distinct item.id)::int total from student_task_sources source join student_task_items item on item.tenant_id=source.tenant_id and item.id=source.student_task_item_id where source.student_path_enrollment_id=${enrollmentId}::uuid`.execute(
        trx,
      );
      const counts = progress.rows[0];
      return {
        id: enrollmentId,
        pathVersionId: row.learning_path_version_id,
        title: path.rows[0]?.title ?? '',
        track: path.rows[0]?.track ?? 'general',
        status: input.status,
        progressPercent: counts?.total ? (counts.completed * 100) / counts.total : 0,
        enrolledAt: row.enrolled_at.toISOString(),
        targetCompletionDate: row.target_completion_date,
      };
    });
  }

  async classes(request: ApiRequest, input: TeacherClassListQuery = {}) {
    const actor = actorFrom(request),
      unrestricted = requireTenant(request).roles.some((x) => x === 'owner' || x === 'admin');
    const pageSize = this.cursors.pageSize(input.pageSize);
    const filters = { status: input.status ?? null };
    const cursorContext = {
      scope: `teacher.classes:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.stringAndUuid);
    return this.database.withTenant(context(actor), async (trx) => {
      const r = await sql<any>`
        select c.id,c.name,c.code,c.status,c.created_at,c.updated_at,
          count(distinct ct.id)::int teacher_count,count(distinct cs.id)::int student_count
        from classes c
        left join class_teachers ct on ct.tenant_id=c.tenant_id and ct.class_id=c.id and ct.left_at is null
        left join class_students cs on cs.tenant_id=c.tenant_id and cs.class_id=c.id and cs.left_at is null
        where (${input.status ?? null}::class_status is null or c.status=${input.status ?? null}::class_status)
          and (${after?.[0] ?? null}::text is null or (c.name,c.id)>(${after?.[0] ?? null},${after?.[1] ?? null}::uuid))
          and (${unrestricted} or exists(
            select 1 from teacher_profiles tp where tp.tenant_id=c.tenant_id
              and tp.membership_id=${actor.membershipId}::uuid and exists(
                select 1 from class_teachers mine where mine.tenant_id=c.tenant_id
                  and mine.class_id=c.id and mine.teacher_profile_id=tp.id and mine.left_at is null
              )
          ))
        group by c.id order by c.name,c.id limit ${pageSize + 1}
      `.execute(trx);
      const page = this.cursors.page(r.rows, pageSize, cursorContext, (row: any) => [
        row.name,
        row.id,
      ]);
      return { data: page.items.map(this.classJson), page: page.page };
    });
  }

  createClass(
    request: ApiRequest,
    key: string | undefined,
    input: { name: string; code: string; teacherMembershipIds: string[] },
  ) {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      context(actor),
      'teacher.class.create',
      key,
      input,
      async (trx) => {
        const id = uuidv7(),
          now = new Date();
        await sql`insert into classes(id,tenant_id,code,name,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${actor.tenantId}::uuid,${input.code},${input.name},'active',${actor.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
        const ids = new Set([actor.membershipId, ...input.teacherMembershipIds]);
        for (const mid of ids) {
          const tp = await sql<{
            id: string;
          }>`select id from teacher_profiles where membership_id=${mid}::uuid and status='active'`.execute(
            trx,
          );
          if (!tp.rows[0]) throw ProblemException.notFound();
          await sql`insert into class_teachers(id,tenant_id,class_id,teacher_profile_id,role,joined_at,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${id}::uuid,${tp.rows[0].id}::uuid,${mid === actor.membershipId ? 'lead' : 'assistant'},${now},${now})`.execute(
            trx,
          );
        }
        await this.events.append(trx, actor, {
          action: 'class.create',
          resourceType: 'class',
          resourceId: id,
          eventType: 'class.created.v1',
        });
        return {
          status: 201,
          body: {
            id,
            tenantId: actor.tenantId,
            name: input.name,
            code: input.code,
            status: 'active',
            teacherCount: ids.size,
            studentCount: 0,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        };
      },
    );
  }

  async classDetail(request: ApiRequest, classId: string) {
    const actor = actorFrom(request),
      unrestricted = requireTenant(request).roles.some((x) => x === 'owner' || x === 'admin');
    return this.database.withTenant(context(actor), async (trx) => {
      const selected =
        await sql<any>`select c.id,c.tenant_id,c.name,c.code,c.status,c.created_at,c.updated_at,count(distinct ct.id)::int teacher_count,count(distinct cs.id)::int student_count from classes c left join class_teachers ct on ct.tenant_id=c.tenant_id and ct.class_id=c.id and ct.left_at is null left join class_students cs on cs.tenant_id=c.tenant_id and cs.class_id=c.id and cs.left_at is null where c.id=${classId}::uuid and (${unrestricted} or exists(select 1 from teacher_profiles tp join class_teachers mine on mine.tenant_id=tp.tenant_id and mine.teacher_profile_id=tp.id where tp.membership_id=${actor.membershipId}::uuid and mine.class_id=c.id and mine.left_at is null)) group by c.id`.execute(
          trx,
        );
      if (!selected.rows[0]) throw ProblemException.notFound();
      const item = this.classJson(selected.rows[0]);
      const r = await sql<{
        membership_id: string;
        display_name: string;
        kind: string;
      }>`select tm.id membership_id,u.display_name,'teacher' kind from class_teachers ct join teacher_profiles tp on tp.tenant_id=ct.tenant_id and tp.id=ct.teacher_profile_id join tenant_memberships tm on tm.tenant_id=tp.tenant_id and tm.id=tp.membership_id and tm.status='active' join users u on u.id=tm.user_id where ct.class_id=${classId}::uuid and ct.left_at is null union all select tm.id,u.display_name,'student' from class_students cs join student_profiles sp on sp.tenant_id=cs.tenant_id and sp.id=cs.student_profile_id join tenant_memberships tm on tm.tenant_id=sp.tenant_id and tm.id=sp.membership_id and tm.status='active' join users u on u.id=tm.user_id where cs.class_id=${classId}::uuid and cs.left_at is null`.execute(
        trx,
      );
      return {
        class: item,
        teachers: r.rows
          .filter((x) => x.kind === 'teacher')
          .map((x) => ({ membershipId: x.membership_id, displayName: x.display_name })),
        students: r.rows
          .filter((x) => x.kind === 'student')
          .map((x) => ({ membershipId: x.membership_id, displayName: x.display_name })),
      };
    });
  }

  async updateClass(
    request: ApiRequest,
    classId: string,
    input: { name?: string | undefined; status?: 'draft' | 'active' | 'archived' | undefined },
  ) {
    const actor = actorFrom(request);
    return this.database.withTenant(context(actor), async (trx) => {
      await this.requireClassAccess(trx, request, classId);
      const r =
        await sql<any>`update classes set name=coalesce(${input.name ?? null},name),status=coalesce(${input.status ?? null},status),updated_at=now() where id=${classId}::uuid returning id,tenant_id,name,code,status,created_at,updated_at`.execute(
          trx,
        );
      if (!r.rows[0]) throw ProblemException.notFound();
      return { ...this.classJson(r.rows[0]), teacherCount: 0, studentCount: 0 };
    });
  }

  async classMember(
    request: ApiRequest,
    classId: string,
    membershipId: string,
    kind: 'student' | 'teacher',
    add: boolean,
  ) {
    const actor = actorFrom(request);
    return this.database.withTenant(context(actor), async (trx) => {
      await this.requireClassAccess(trx, request, classId);
      const table = kind === 'student' ? 'student_profiles' : 'teacher_profiles';
      const p = await sql<{
        id: string;
      }>`select id from ${sql.raw(table)} where membership_id=${membershipId}::uuid and status='active'`.execute(
        trx,
      );
      if (!p.rows[0]) throw ProblemException.notFound();
      const now = new Date();
      let changed = false;
      if (kind === 'student') {
        if (add) {
          const result = await sql<{ id: string }>`insert into class_students(id,tenant_id,class_id,student_profile_id,joined_at,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${classId}::uuid,${p.rows[0].id}::uuid,${now},${now}) on conflict do nothing returning id`.execute(
            trx,
          );
          changed = result.rows.length > 0;
        } else {
          const result = await sql<{ id: string }>`update class_students set left_at=${now} where class_id=${classId}::uuid and student_profile_id=${p.rows[0].id}::uuid and left_at is null returning id`.execute(
            trx,
          );
          changed = result.rows.length > 0;
        }
      } else {
        if (add)
          await sql`insert into class_teachers(id,tenant_id,class_id,teacher_profile_id,role,joined_at,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${classId}::uuid,${p.rows[0].id}::uuid,'assistant',${now},${now}) on conflict do nothing`.execute(
            trx,
          );
        else
          await sql`update class_teachers set left_at=${now} where class_id=${classId}::uuid and teacher_profile_id=${p.rows[0].id}::uuid and left_at is null`.execute(
            trx,
          );
      }
      if (kind === 'student' && changed)
        await this.events.append(trx, actor, {
          action: add ? 'class.student.add' : 'class.student.remove',
          resourceType: 'class',
          resourceId: classId,
          eventType: 'class.roster_changed.v1',
          payload: {
            classId,
            studentProfileId: p.rows[0].id,
            action: add ? 'joined' : 'left',
          },
        });
      return;
    });
  }

  async assignments(request: ApiRequest, input: TeacherAssignmentListQuery = {}) {
    const actor = actorFrom(request),
      unrestricted = requireTenant(request).roles.some((x) => x === 'owner' || x === 'admin');
    const pageSize = this.cursors.pageSize(input.pageSize);
    const filters = { status: input.status ?? null };
    const cursorContext = {
      scope: `teacher.assignments:${actor.tenantId}:${actor.membershipId}`,
      filters,
    };
    const after = this.cursors.read(input.cursor, cursorContext, cursorKey.dateAndUuid);
    return this.database.withTenant(context(actor), async (trx) => {
      const r = await sql<any>`select * from task_assignments
        where (created_by_membership_id=${actor.membershipId}::uuid or ${unrestricted})
          and (${input.status ?? null}::assignment_status is null or status=${input.status ?? null}::assignment_status)
          and (${after?.[0] ? new Date(after[0]) : null}::timestamptz is null
            or (date_trunc('milliseconds',created_at),id)<(${after?.[0] ? new Date(after[0]) : null},${after?.[1] ?? null}::uuid))
        order by date_trunc('milliseconds',created_at) desc,id desc limit ${pageSize + 1}`.execute(
        trx,
      );
      const page = this.cursors.page(r.rows, pageSize, cursorContext, (row: any) => [
        new Date(row.created_at).toISOString(),
        row.id,
      ]);
      return {
        data: page.items.map((x: any) =>
          this.assignmentJson(x, { studentMembershipIds: [], classIds: [], pathNodeIds: [] }),
        ),
        page: page.page,
      };
    });
  }

  createAssignment(request: ApiRequest, key: string | undefined, input: AssignmentInput) {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      context(actor),
      'teacher.assignment.create',
      key,
      input,
      async (trx) => {
        this.validateAssignment(request, input);
        const id = uuidv7(),
          now = new Date();
        await sql`insert into task_assignments(id,tenant_id,task_version_id,source_type,occurrence_key,slot_key,explicit_priority,schedule_mode,available_at,due_at,close_at,max_attempts,late_policy,status,created_by_membership_id,created_at,updated_at) values(${id}::uuid,${actor.tenantId}::uuid,${input.taskVersionId}::uuid,${input.sourceType},${input.occurrenceKey},${input.slotKey},${input.explicitPriority},${input.scheduleMode},${input.availableAt ? new Date(input.availableAt) : null},${input.dueAt ? new Date(input.dueAt) : null},${input.closeAt ? new Date(input.closeAt) : null},${input.maxAttempts},${input.latePolicy},'draft',${actor.membershipId}::uuid,${now},${now})`.execute(
          trx,
        );
        await this.replaceTargets(trx, actor, id, input.targets);
        await this.events.append(trx, actor, {
          action: 'assignment.create',
          resourceType: 'task_assignment',
          resourceId: id,
          eventType: 'assignment.created.v1',
        });
        return {
          status: 201,
          body: this.assignmentJson(
            {
              id,
              tenant_id: actor.tenantId,
              ...this.dbAssignmentInput(input),
              status: 'draft',
              created_by_membership_id: actor.membershipId,
              created_at: now,
              updated_at: now,
              published_at: null,
              cancelled_at: null,
            },
            input.targets,
          ),
        };
      },
    );
  }

  async assignment(request: ApiRequest, id: string) {
    const actor = actorFrom(request);
    return this.database.withTenant(context(actor), async (trx) => {
      await this.requireAssignmentAccess(trx, request, id);
      const r = await sql<any>`select * from task_assignments where id=${id}::uuid`.execute(trx);
      if (!r.rows[0]) throw ProblemException.notFound();
      const targets = await this.readTargets(trx, id);
      const counts = await sql<{
        active: number;
        hidden: number;
        superseded: number;
        materialized: number;
        expected: number;
      }>`select count(distinct item.id) filter(where item.resolution_state='active')::int active,count(distinct item.id) filter(where item.resolution_state='hidden')::int hidden,count(distinct item.id) filter(where item.resolution_state='superseded')::int superseded,count(distinct source.id)::int materialized,((select count(*) from task_assignment_student_targets target where target.task_assignment_id=${id}::uuid)+(select count(*) from task_assignment_class_targets target join class_students roster on roster.tenant_id=target.tenant_id and roster.class_id=target.class_id and roster.left_at is null where target.task_assignment_id=${id}::uuid)+(select count(*) from task_assignment_path_targets target join student_path_enrollments enrollment on enrollment.tenant_id=target.tenant_id and enrollment.learning_path_version_id=target.learning_path_version_id and enrollment.status in('active','paused') where target.task_assignment_id=${id}::uuid))::int expected from task_assignments assignment left join student_task_sources source on source.tenant_id=assignment.tenant_id and source.task_assignment_id=assignment.id left join student_task_items item on item.tenant_id=source.tenant_id and item.id=source.student_task_item_id where assignment.id=${id}::uuid`.execute(
        trx,
      );
      const summary = counts.rows[0] ?? {
        active: 0,
        hidden: 0,
        superseded: 0,
        materialized: 0,
        expected: 0,
      };
      return {
        assignment: this.assignmentJson(r.rows[0], targets),
        materialization: {
          pending:
            r.rows[0].status === 'published'
              ? Math.max(summary.expected - summary.materialized, 0)
              : 0,
          active: summary.active,
          hidden: summary.hidden,
          superseded: summary.superseded,
          failed: 0,
        },
      };
    });
  }

  async updateAssignment(
    request: ApiRequest,
    id: string,
    input: { [K in keyof AssignmentInput]?: AssignmentInput[K] | undefined },
  ) {
    const actor = actorFrom(request);
    return this.database.withTenant(context(actor), async (trx) => {
      await this.requireAssignmentAccess(trx, request, id);
      const current =
        await sql<any>`select * from task_assignments where id=${id}::uuid and status='draft' for update`.execute(
          trx,
        );
      if (!current.rows[0])
        throw ProblemException.conflict(
          'assignment_not_editable',
          '只有 draft Assignment 可编辑。',
        );
      const existing = current.rows[0],
        targets = input.targets ?? (await this.readTargets(trx, id));
      this.validateAssignment(request, {
        taskVersionId: existing.task_version_id,
        sourceType: existing.source_type,
        occurrenceKey: existing.occurrence_key,
        slotKey: existing.slot_key,
        explicitPriority: input.explicitPriority ?? existing.explicit_priority,
        scheduleMode: existing.schedule_mode,
        availableAt:
          input.availableAt ??
          (existing.available_at ? new Date(existing.available_at).toISOString() : null),
        dueAt: input.dueAt ?? (existing.due_at ? new Date(existing.due_at).toISOString() : null),
        closeAt:
          input.closeAt ?? (existing.close_at ? new Date(existing.close_at).toISOString() : null),
        maxAttempts: input.maxAttempts ?? existing.max_attempts,
        latePolicy: input.latePolicy ?? existing.late_policy,
        targets,
      });
      const r =
        await sql<any>`update task_assignments set explicit_priority=coalesce(${input.explicitPriority ?? null},explicit_priority),available_at=coalesce(${input.availableAt ? new Date(input.availableAt) : null},available_at),due_at=coalesce(${input.dueAt ? new Date(input.dueAt) : null},due_at),close_at=coalesce(${input.closeAt ? new Date(input.closeAt) : null},close_at),max_attempts=coalesce(${input.maxAttempts ?? null},max_attempts),late_policy=coalesce(${input.latePolicy ?? null},late_policy),updated_at=now() where id=${id}::uuid and status='draft' returning *`.execute(
          trx,
        );
      if (input.targets) await this.replaceTargets(trx, actor, id, input.targets);
      return this.assignmentJson(r.rows[0], input.targets ?? (await this.readTargets(trx, id)));
    });
  }

  commandAssignment(
    request: ApiRequest,
    id: string,
    key: string | undefined,
    action: 'publish' | 'cancel',
    reason?: string,
  ) {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      context(actor),
      `teacher.assignment.${action}`,
      key,
      { id, reason },
      async (trx) => {
        await this.requireAssignmentAccess(trx, request, id);
        const row =
          await sql<any>`select * from task_assignments where id=${id}::uuid for update`.execute(
            trx,
          );
        const a = row.rows[0];
        if (!a) throw ProblemException.notFound();
        if (
          a.source_type === 'admin_forced' &&
          !requireTenant(request).roles.some((role) => role === 'owner' || role === 'admin') &&
          requirePrincipal(request).platformRole !== 'super_admin'
        )
          throw ProblemException.forbidden(
            'admin_forced_forbidden',
            'admin_forced 任务仅允许 owner/admin/super_admin 操作。',
          );
        if (action === 'publish') {
          if (a.status !== 'draft')
            throw ProblemException.conflict(
              'assignment_not_publishable',
              'Assignment 不是 draft。',
            );
          await sql`update task_assignments set status='published',published_at=now(),updated_at=now() where id=${id}::uuid`.execute(
            trx,
          );
        } else {
          if (a.status !== 'published')
            throw ProblemException.conflict(
              'assignment_not_cancellable',
              'Assignment 不是 published。',
            );
          await sql`update task_assignments set status='cancelled',cancelled_at=now(),updated_at=now() where id=${id}::uuid`.execute(
            trx,
          );
          await sql`update student_task_sources set inactive_at=now(),inactive_reason='assignment_cancelled' where task_assignment_id=${id}::uuid and inactive_at is null`.execute(
            trx,
          );
        }
        const spec = assignmentCommandSpec(action);
        await this.events.append(trx, actor, {
          action: `assignment.${action}`,
          resourceType: 'task_assignment',
          resourceId: id,
          eventType: spec.eventType,
          payload: { reason, materialization: 'worker' },
        });
        return {
          status: 202,
          body: { commandId: uuidv7(), status: 'accepted', acceptedAt: new Date().toISOString() },
        };
      },
    );
  }

  override(request: ApiRequest, itemId: string, key: string | undefined, input: any) {
    const actor = actorFrom(request);
    return this.idempotency.execute(
      context(actor),
      'teacher.task.override',
      key,
      { itemId, ...input },
      async (trx) => {
        const identity = await sql<{
          student_profile_id: string;
        }>`select student_profile_id from student_task_items where id=${itemId}::uuid`.execute(trx);
        if (!identity.rows[0]) throw ProblemException.notFound();
        await this.requireStudentAccess(trx, request, identity.rows[0].student_profile_id);
        await sql`select pg_advisory_xact_lock(hashtextextended(${identity.rows[0].student_profile_id}::text, 0))`.execute(
          trx,
        );
        const selected =
          await sql<any>`select * from student_task_items where id=${itemId}::uuid for update`.execute(
            trx,
          );
        const item = selected.rows[0];
        if (!item) throw ProblemException.notFound();
        const id = uuidv7(),
          now = new Date(),
          replacementItemId = input.action === 'replace' ? uuidv7() : null;
        let reversed: any = null;
        if (input.action === 'restore') {
          const result =
            await sql<any>`select target.action,target.metadata from student_task_overrides target
          where target.id=${input.reversesOverrideId}::uuid and target.student_task_item_id=${itemId}::uuid
            and target.action in ('hide','replace') and not exists(
              select 1 from student_task_overrides reversal where reversal.reverses_override_id=target.id
            ) for update`.execute(trx);
          reversed = result.rows[0];
          if (!reversed)
            throw ProblemException.conflict(
              'override_not_restorable',
              '目标 override 不存在、已恢复或不可恢复。',
            );
        }
        if (input.action === 'replace') {
          const version = await sql<{
            id: string;
          }>`select id from task_versions where id=${input.replacementTaskVersionId}::uuid and publication_state='published'`.execute(
            trx,
          );
          if (!version.rows[0])
            throw ProblemException.conflict(
              'replacement_task_unavailable',
              '替换任务版本不存在或未发布。',
            );
          const source =
            await sql<any>`select * from student_task_sources where student_task_item_id=${itemId}::uuid
          and inactive_at is null order by source_weight desc,explicit_priority desc,published_at desc,id desc limit 1`.execute(
              trx,
            );
          if (!source.rows[0])
            throw ProblemException.conflict(
              'replacement_source_missing',
              '原任务没有可继承的活动来源。',
            );
          const occurrenceKey = `replace:${id}`;
          await sql`insert into student_task_items(id,tenant_id,student_profile_id,task_version_id,occurrence_key,slot_key,resolution_state,resolution_reason,workflow_state,available_at,due_at,close_at,resolution_revision,resolved_at,created_at,updated_at) values(${replacementItemId}::uuid,${actor.tenantId}::uuid,${item.student_profile_id}::uuid,${input.replacementTaskVersionId}::uuid,${occurrenceKey},${item.slot_key},'superseded','slot_conflict','not_started',${item.available_at},${item.due_at},${item.close_at},1,${now},${now},${now})`.execute(
            trx,
          );
          const replacementSourceId = uuidv7(),
            sourceRow = source.rows[0];
          await sql`insert into student_task_sources(id,tenant_id,student_task_item_id,student_profile_id,task_assignment_id,student_target_id,class_target_id,path_target_id,class_id,learning_path_version_id,class_student_id,student_path_enrollment_id,source_type,source_weight,explicit_priority,published_at,occurrence_key,slot_key,available_at,due_at,close_at,inactive_at,inactive_reason,created_at) values(${replacementSourceId}::uuid,${actor.tenantId}::uuid,${replacementItemId}::uuid,${item.student_profile_id}::uuid,${sourceRow.task_assignment_id}::uuid,${sourceRow.student_target_id}::uuid,${sourceRow.class_target_id}::uuid,${sourceRow.path_target_id}::uuid,${sourceRow.class_id}::uuid,${sourceRow.learning_path_version_id}::uuid,${sourceRow.class_student_id}::uuid,${sourceRow.student_path_enrollment_id}::uuid,${sourceRow.source_type},${sourceRow.source_weight},${sourceRow.explicit_priority},${sourceRow.published_at},${occurrenceKey},${item.slot_key},${item.available_at},${item.due_at},${item.close_at},null,null,${now})`.execute(
            trx,
          );
          await sql`update student_task_items set winning_source_id=${replacementSourceId}::uuid where id=${replacementItemId}::uuid`.execute(
            trx,
          );
        }
        const metadata = {
          ...(replacementItemId ? { replacementTaskItemId: replacementItemId } : {}),
          ...(reversed ? { restoredAction: reversed.action } : {}),
          slotKey: item.slot_key,
        };
        await sql`insert into student_task_overrides(id,tenant_id,student_task_item_id,action,replacement_task_version_id,available_at,due_at,close_at,reverses_override_id,reason,metadata,created_by_membership_id,created_at) values(${id}::uuid,${actor.tenantId}::uuid,${itemId}::uuid,${input.action},${input.replacementTaskVersionId ?? null}::uuid,${input.availableAt ? new Date(input.availableAt) : null},${input.dueAt ? new Date(input.dueAt) : null},${input.closeAt ? new Date(input.closeAt) : null},${input.reversesOverrideId ?? null}::uuid,${input.reason},${JSON.stringify(metadata)}::jsonb,${actor.membershipId}::uuid,${now})`.execute(
          trx,
        );
        let state = item.resolution_state,
          reason = item.resolution_reason;
        if (input.action === 'hide') {
          state = 'hidden';
          reason = 'override_hidden';
        }
        if (input.action === 'replace') {
          state = 'superseded';
          reason = 'replaced';
        }
        if (input.action === 'restore') {
          state = 'superseded';
          reason = 'slot_conflict';
        }
        const availableAt = input.availableAt ? new Date(input.availableAt) : item.available_at;
        const dueAt = input.dueAt ? new Date(input.dueAt) : item.due_at;
        const closeAt = input.closeAt ? new Date(input.closeAt) : item.close_at;
        if ((dueAt && dueAt < availableAt) || (closeAt && closeAt < (dueAt ?? availableAt)))
          throw ProblemException.badRequest(
            'override_schedule_invalid',
            '覆盖后的时间窗口顺序无效。',
          );
        await sql`update student_task_items set resolution_state=${state},resolution_reason=${reason},available_at=${availableAt},due_at=${dueAt},close_at=${closeAt},resolution_revision=resolution_revision+1,resolved_at=${now},updated_at=${now} where id=${itemId}::uuid`.execute(
          trx,
        );
        if (['hide', 'replace', 'restore'].includes(input.action))
          await this.resolveStudentSlot(trx, item.student_profile_id, item.slot_key);
        const resulting = await sql<{
          resolution_state: string;
          resolution_reason: string;
        }>`select resolution_state,resolution_reason from student_task_items where id=${itemId}::uuid`.execute(
          trx,
        );
        state = resulting.rows[0]?.resolution_state ?? state;
        reason = resulting.rows[0]?.resolution_reason ?? reason;
        await this.events.append(trx, actor, {
          action: 'task.override',
          resourceType: 'student_task_override',
          resourceId: id,
          eventType: 'task.override_applied.v1',
          payload: {
            itemId,
            action: input.action,
            replacementTaskItemId: replacementItemId,
            requiresExplicitRetry: input.action === 'require_redo',
          },
        });
        return {
          status: 201,
          body: {
            id,
            taskItemId: itemId,
            action: input.action,
            replacementTaskVersionId: input.replacementTaskVersionId ?? null,
            availableAt: input.availableAt ?? null,
            dueAt: input.dueAt ?? null,
            closeAt: input.closeAt ?? null,
            reversesOverrideId: input.reversesOverrideId ?? null,
            reason: input.reason,
            createdByMembershipId: actor.membershipId,
            createdAt: now.toISOString(),
            resultingResolutionState: state,
            resultingResolutionReason: reason,
          },
        };
      },
    );
  }

  private async resolveStudentSlot(
    trx: TenantTransaction,
    studentProfileId: string,
    slotKey: string,
  ) {
    await sql`select id from student_task_items where student_profile_id=${studentProfileId}::uuid and slot_key=${slotKey} for update`.execute(
      trx,
    );
    await sql`update student_task_items set resolution_state='superseded',resolution_reason='slot_conflict',resolution_revision=resolution_revision+1,resolved_at=now(),updated_at=now() where student_profile_id=${studentProfileId}::uuid and slot_key=${slotKey} and resolution_state='active'`.execute(
      trx,
    );
    const winner = await sql<{ item_id: string; source_id: string }>`
      select item.id as item_id,source.id as source_id
      from student_task_items item
      join lateral(
        select candidate.* from student_task_sources candidate
        where candidate.student_task_item_id=item.id and candidate.inactive_at is null
        order by candidate.source_weight desc,candidate.explicit_priority desc,candidate.published_at desc,candidate.id desc
        limit 1
      ) source on true
      where item.student_profile_id=${studentProfileId}::uuid and item.slot_key=${slotKey}
        and not exists(
          select 1 from student_task_overrides blocking
          where blocking.student_task_item_id=item.id and blocking.action in('hide','replace')
            and not exists(select 1 from student_task_overrides reversal where reversal.reverses_override_id=blocking.id)
        )
        and not exists(
          select 1 from student_task_overrides replaced
          join student_task_overrides restored on restored.reverses_override_id=replaced.id
          where replaced.action='replace' and replaced.metadata->>'replacementTaskItemId'=item.id::text
        )
      order by source.source_weight desc,source.explicit_priority desc,source.published_at desc,source.id desc,item.id desc
      limit 1
    `.execute(trx);
    if (winner.rows[0])
      await sql`update student_task_items set winning_source_id=${winner.rows[0].source_id}::uuid,resolution_state='active',resolution_reason='winner',resolution_revision=resolution_revision+1,resolved_at=now(),updated_at=now() where id=${winner.rows[0].item_id}::uuid`.execute(
        trx,
      );
    return winner.rows[0] ?? null;
  }

  private async requireStudentProfile(
    trx: TenantTransaction,
    request: ApiRequest,
    membershipId: string,
  ) {
    const unrestricted = requireTenant(request).roles.some((x) => x === 'owner' || x === 'admin');
    const r = await sql<{
      id: string;
    }>`select sp.id from student_profiles sp join tenant_memberships tm on tm.tenant_id=sp.tenant_id and tm.id=sp.membership_id and tm.status='active' where sp.membership_id=${membershipId}::uuid and sp.status='active' and (${unrestricted} or exists(select 1 from teacher_profiles tp where tp.membership_id=${requireTenant(request).membershipId}::uuid and tp.status='active' and (exists(select 1 from student_teacher_links l where l.teacher_profile_id=tp.id and l.student_profile_id=sp.id and l.valid_to is null) or exists(select 1 from class_teachers ct join class_students cs on cs.tenant_id=ct.tenant_id and cs.class_id=ct.class_id where ct.teacher_profile_id=tp.id and cs.student_profile_id=sp.id and ct.left_at is null and cs.left_at is null))))`.execute(
      trx,
    );
    if (!r.rows[0]) throw ProblemException.notFound();
    return r.rows[0].id;
  }
  private async requireClassAccess(
    trx: TenantTransaction,
    request: ApiRequest,
    classId: string,
  ) {
    const tenant = requireTenant(request);
    const unrestricted = tenant.roles.some((role) => role === 'owner' || role === 'admin');
    const result = await sql<{ id: string }>`select class.id from classes class
      where class.id=${classId}::uuid and (${unrestricted} or exists(
        select 1 from teacher_profiles teacher
        join class_teachers link on link.tenant_id=teacher.tenant_id and link.teacher_profile_id=teacher.id
        where teacher.membership_id=${tenant.membershipId}::uuid and teacher.status='active'
          and link.class_id=class.id and link.left_at is null
      ))`.execute(trx);
    if (!result.rows[0]) throw ProblemException.notFound();
  }
  private async requireAssignmentAccess(
    trx: TenantTransaction,
    request: ApiRequest,
    assignmentId: string,
  ) {
    const tenant = requireTenant(request);
    const unrestricted = tenant.roles.some((role) => role === 'owner' || role === 'admin');
    const result = await sql<{ id: string }>`select id from task_assignments
      where id=${assignmentId}::uuid
        and (${unrestricted} or created_by_membership_id=${tenant.membershipId}::uuid)`.execute(trx);
    if (!result.rows[0]) throw ProblemException.notFound();
  }
  private async requireStudentAccess(
    trx: TenantTransaction,
    request: ApiRequest,
    studentProfileId: string,
  ) {
    const tenant = requireTenant(request);
    const unrestricted = tenant.roles.some((role) => role === 'owner' || role === 'admin');
    const result = await sql<{ id: string }>`select profile.id from student_profiles profile
      where profile.id=${studentProfileId}::uuid and (${unrestricted} or exists(
        select 1 from teacher_profiles teacher where teacher.membership_id=${tenant.membershipId}::uuid
          and teacher.status='active' and (
            exists(select 1 from student_teacher_links link where link.teacher_profile_id=teacher.id
              and link.student_profile_id=profile.id and link.valid_to is null)
            or exists(select 1 from class_teachers teaching join class_students roster
              on roster.tenant_id=teaching.tenant_id and roster.class_id=teaching.class_id
              where teaching.teacher_profile_id=teacher.id and roster.student_profile_id=profile.id
                and teaching.left_at is null and roster.left_at is null)
          )
      ))`.execute(trx);
    if (!result.rows[0]) throw ProblemException.notFound();
  }
  private classJson = (r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    code: r.code,
    status: r.status,
    teacherCount: r.teacher_count ?? 0,
    studentCount: r.student_count ?? 0,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  });
  private validateTargets(input: AssignmentInput) {
    const nonempty = [
      input.targets.studentMembershipIds.length,
      input.targets.classIds.length,
      input.targets.pathNodeIds.length,
    ].filter((x) => x > 0).length;
    if (nonempty !== 1)
      throw ProblemException.badRequest(
        'assignment_targets_invalid',
        '必须且只能提供一种目标集合。',
      );
    if (
      (input.sourceType === 'individual' && !input.targets.studentMembershipIds.length) ||
      (input.sourceType === 'class' && !input.targets.classIds.length) ||
      ((input.sourceType === 'general' || input.sourceType === 'exam_path') &&
        !input.targets.pathNodeIds.length)
    )
      throw ProblemException.badRequest(
        'assignment_source_target_mismatch',
        'sourceType 与 target 不匹配。',
      );
  }
  private validateAssignment(request: ApiRequest, input: AssignmentInput) {
    this.validateTargets(input);
    const privileged =
      requireTenant(request).roles.some((role) => role === 'owner' || role === 'admin') ||
      requirePrincipal(request).platformRole === 'super_admin';
    if (input.sourceType === 'admin_forced' && !privileged)
      throw ProblemException.forbidden(
        'admin_forced_forbidden',
        'admin_forced 任务仅允许 owner/admin/super_admin 操作。',
      );
    if (input.scheduleMode === 'absolute' && !input.availableAt)
      throw ProblemException.badRequest(
        'assignment_schedule_invalid',
        'absolute 排期必须提供 availableAt。',
      );
    if (
      input.scheduleMode === 'path_relative' &&
      (input.availableAt || input.dueAt || input.closeAt)
    )
      throw ProblemException.badRequest(
        'assignment_schedule_invalid',
        'path_relative 不能携带绝对时间。',
      );
    if (input.scheduleMode === 'path_relative' && !input.occurrenceKey.includes('{enrollment_id}'))
      throw ProblemException.badRequest(
        'assignment_occurrence_placeholder_required',
        'path_relative occurrenceKey 必须包含 {enrollment_id}。',
      );
    if (input.scheduleMode === 'absolute' && input.occurrenceKey.includes('{enrollment_id}'))
      throw ProblemException.badRequest(
        'assignment_occurrence_placeholder_invalid',
        'absolute occurrenceKey 不应包含 {enrollment_id}。',
      );
    const available = input.availableAt ? new Date(input.availableAt) : null,
      due = input.dueAt ? new Date(input.dueAt) : null,
      close = input.closeAt ? new Date(input.closeAt) : null;
    if ((available && due && due < available) || (close && close < (due ?? available!)))
      throw ProblemException.badRequest(
        'assignment_schedule_invalid',
        'Assignment 时间窗口顺序无效。',
      );
  }
  private dbAssignmentInput(i: AssignmentInput) {
    return {
      task_version_id: i.taskVersionId,
      source_type: i.sourceType,
      occurrence_key: i.occurrenceKey,
      slot_key: i.slotKey,
      explicit_priority: i.explicitPriority,
      schedule_mode: i.scheduleMode,
      available_at: i.availableAt,
      due_at: i.dueAt,
      close_at: i.closeAt,
      max_attempts: i.maxAttempts,
      late_policy: i.latePolicy,
    };
  }
  private assignmentJson(a: any, t: any) {
    return {
      id: a.id,
      tenantId: a.tenant_id,
      taskVersionId: a.task_version_id,
      sourceType: a.source_type,
      occurrenceKey: a.occurrence_key,
      slotKey: a.slot_key,
      explicitPriority: a.explicit_priority,
      scheduleMode: a.schedule_mode,
      availableAt: a.available_at ? new Date(a.available_at).toISOString() : null,
      dueAt: a.due_at ? new Date(a.due_at).toISOString() : null,
      closeAt: a.close_at ? new Date(a.close_at).toISOString() : null,
      maxAttempts: a.max_attempts,
      latePolicy: a.late_policy,
      status: a.status,
      targets: t,
      createdByMembershipId: a.created_by_membership_id,
      createdAt: new Date(a.created_at).toISOString(),
      updatedAt: new Date(a.updated_at).toISOString(),
      publishedAt: a.published_at ? new Date(a.published_at).toISOString() : null,
      cancelledAt: a.cancelled_at ? new Date(a.cancelled_at).toISOString() : null,
    };
  }
  private async replaceTargets(trx: TenantTransaction, actor: EventActor, id: string, t: any) {
    await sql`delete from task_assignment_student_targets where task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    await sql`delete from task_assignment_class_targets where task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    await sql`delete from task_assignment_path_targets where task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    for (const m of t.studentMembershipIds) {
      const p = await sql<{
        id: string;
      }>`select id from student_profiles where membership_id=${m}::uuid`.execute(trx);
      if (!p.rows[0]) throw ProblemException.notFound();
      await sql`insert into task_assignment_student_targets(id,tenant_id,task_assignment_id,student_profile_id,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${id}::uuid,${p.rows[0].id}::uuid,now())`.execute(
        trx,
      );
    }
    for (const c of t.classIds)
      await sql`insert into task_assignment_class_targets(id,tenant_id,task_assignment_id,class_id,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${id}::uuid,${c}::uuid,now())`.execute(
        trx,
      );
    for (const n of t.pathNodeIds) {
      const p = await sql<{
        learning_path_version_id: string;
      }>`select learning_path_version_id from path_nodes where id=${n}::uuid`.execute(trx);
      if (!p.rows[0]) throw ProblemException.notFound();
      await sql`insert into task_assignment_path_targets(id,tenant_id,task_assignment_id,path_node_id,learning_path_version_id,created_at) values(${uuidv7()}::uuid,${actor.tenantId}::uuid,${id}::uuid,${n}::uuid,${p.rows[0].learning_path_version_id}::uuid,now())`.execute(
        trx,
      );
    }
  }
  private async readTargets(trx: TenantTransaction, id: string) {
    const s = await sql<{
      membership_id: string;
    }>`select sp.membership_id from task_assignment_student_targets t join student_profiles sp on sp.tenant_id=t.tenant_id and sp.id=t.student_profile_id where t.task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    const c = await sql<{
      class_id: string;
    }>`select class_id from task_assignment_class_targets where task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    const p = await sql<{
      path_node_id: string;
    }>`select path_node_id from task_assignment_path_targets where task_assignment_id=${id}::uuid`.execute(
      trx,
    );
    return {
      studentMembershipIds: s.rows.map((x) => x.membership_id),
      classIds: c.rows.map((x) => x.class_id),
      pathNodeIds: p.rows.map((x) => x.path_node_id),
    };
  }
}
