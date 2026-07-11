import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { reconcileAssignment, reconcilePathEnrollment } from './task-materializer.js';

const integration = process.env['RUN_WORKER_INTEGRATION'] === '1' ? describe : describe.skip;
const demoTenantId = '0194a000-0000-7000-8000-000000000001';

integration('worker reliability against PostgreSQL', () => {
  it('pauses and restores path sources without changing workflow history', async () => {
    const connectionString = process.env['WORKER_DATABASE_URL'];
    if (!connectionString) throw new Error('WORKER_DATABASE_URL is required');
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `select set_config('app.tenant_id',$1,true),
                set_config('app.worker_id','reliability-check',true)`,
        [demoTenantId],
      );
      const enrollment = await client.query<{ id: string }>(
        `select enrollment.id
         from student_path_enrollments enrollment
         where enrollment.id=(
           select source.student_path_enrollment_id
           from student_task_sources source
           where source.student_path_enrollment_id is not null
           group by source.student_path_enrollment_id
           having count(distinct source.student_task_item_id)>=2
           order by source.student_path_enrollment_id limit 1
         )
         for update of enrollment`,
      );
      const enrollmentId = enrollment.rows[0]?.id;
      if (!enrollmentId) {
        throw new Error('No enrollment with at least two materialized path sources');
      }

      const fixtures = await client.query<{ source_id: string; item_id: string }>(
        `select distinct on (item.id) source.id as source_id,item.id as item_id
         from student_task_sources source
         join student_task_items item on item.id=source.student_task_item_id
         where source.student_path_enrollment_id=$1
         order by item.id,source.id limit 2`,
        [enrollmentId],
      );
      const [notStartedFixture, startedFixture] = fixtures.rows;
      if (!notStartedFixture || !startedFixture) {
        throw new Error('Unable to prepare two distinct path source fixtures');
      }
      await client.query(
        `update student_path_enrollments set status='active',paused_at=null where id=$1`,
        [enrollmentId],
      );
      await client.query(
        `update student_task_sources set inactive_at=null,inactive_reason=null
         where id=any($1::uuid[])`,
        [[notStartedFixture.source_id, startedFixture.source_id]],
      );
      await client.query(
        `update student_task_items
         set workflow_state=case when id=$1 then 'not_started'::workflow_state
                                 else 'in_progress'::workflow_state end,
             resolution_state='active',resolution_reason='winner',updated_at=now()
         where id=any($2::uuid[])`,
        [notStartedFixture.item_id, [notStartedFixture.item_id, startedFixture.item_id]],
      );

      interface PathSourceState {
        source_id: string;
        item_id: string;
        workflow_state: string;
        resolution_state: string;
        inactive_at: Date | null;
      }
      const selectStates = `select source.id as source_id,item.id as item_id,
           item.workflow_state,item.resolution_state,source.inactive_at
         from student_task_items item
         join student_task_sources source on source.student_task_item_id=item.id
         where source.student_path_enrollment_id=$1 order by source.id`;
      const before = await client.query<PathSourceState>(selectStates, [enrollmentId]);
      const notStartedBefore = before.rows.find(
        (row) => row.workflow_state === 'not_started' && row.inactive_at === null,
      );
      const startedBefore = before.rows.filter((row) => row.workflow_state !== 'not_started');
      expect(notStartedBefore).toBeDefined();
      expect(startedBefore.length).toBeGreaterThan(0);

      await client.query(
        `update student_path_enrollments
         set status='paused',paused_at=now() where id=$1`,
        [enrollmentId],
      );
      await reconcilePathEnrollment(client, enrollmentId);
      const paused = await client.query<PathSourceState>(selectStates, [enrollmentId]);
      const pausedBySource = new Map(paused.rows.map((row) => [row.source_id, row]));
      const pausedNotStarted = notStartedBefore
        ? pausedBySource.get(notStartedBefore.source_id)
        : undefined;
      expect(pausedNotStarted?.inactive_at).not.toBeNull();
      expect(pausedNotStarted?.resolution_state).toBe('hidden');
      for (const original of startedBefore) {
        expect(pausedBySource.get(original.source_id)).toEqual(original);
      }

      await client.query(
        `update student_path_enrollments
         set status='active',paused_at=null where id=$1`,
        [enrollmentId],
      );
      await reconcilePathEnrollment(client, enrollmentId);
      const restored = await client.query<PathSourceState>(selectStates, [enrollmentId]);
      expect(restored.rows).toEqual(before.rows);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it('cancels assignment sources without deleting attempt or submission history', async () => {
    const connectionString = process.env['WORKER_DATABASE_URL'];
    if (!connectionString) throw new Error('WORKER_DATABASE_URL is required');
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `select set_config('app.tenant_id',$1,true),
                set_config('app.worker_id','reliability-check',true)`,
        [demoTenantId],
      );
      const assignment = await client.query<{ id: string }>(
        `select assignment.id
         from task_assignments assignment
         where assignment.status='published'
           and exists (
             select 1 from student_task_sources source
             where source.task_assignment_id=assignment.id
           )
         order by assignment.id limit 1 for update`,
      );
      const assignmentId = assignment.rows[0]?.id;
      if (!assignmentId) throw new Error('No published assignment with materialized sources');

      const before = await client.query<{
        item_id: string;
        workflow_state: string;
        attempt_count: number;
        submission_count: number;
      }>(
        `select item.id as item_id,item.workflow_state,
           count(distinct attempt.id)::int as attempt_count,
           count(distinct submission.id)::int as submission_count
         from student_task_sources source
         join student_task_items item on item.id=source.student_task_item_id
         left join task_attempts attempt on attempt.student_task_item_id=item.id
         left join submission_snapshots submission on submission.task_attempt_id=attempt.id
         where source.task_assignment_id=$1
         group by item.id,item.workflow_state order by item.id`,
        [assignmentId],
      );

      await client.query(
        `update task_assignments
         set status='cancelled',cancelled_at=now(),updated_at=now()
         where id=$1`,
        [assignmentId],
      );
      await reconcileAssignment(client, assignmentId);

      const sources = await client.query<{ all_inactive: boolean }>(
        `select bool_and(inactive_at is not null) as all_inactive
         from student_task_sources where task_assignment_id=$1`,
        [assignmentId],
      );
      const after = await client.query<{
        item_id: string;
        workflow_state: string;
        attempt_count: number;
        submission_count: number;
        resolution_correct: boolean;
      }>(
        `select item.id as item_id,item.workflow_state,
           count(distinct attempt.id)::int as attempt_count,
           count(distinct submission.id)::int as submission_count,
           case when not exists (
             select 1 from student_task_sources active
             where active.student_task_item_id=item.id and active.inactive_at is null
           ) then item.resolution_state='hidden' else true end as resolution_correct
         from student_task_sources source
         join student_task_items item on item.id=source.student_task_item_id
         left join task_attempts attempt on attempt.student_task_item_id=item.id
         left join submission_snapshots submission on submission.task_attempt_id=attempt.id
         where source.task_assignment_id=$1
         group by item.id,item.workflow_state,item.resolution_state order by item.id`,
        [assignmentId],
      );

      expect(sources.rows[0]?.all_inactive).toBe(true);
      expect(after.rows.every((row) => row.resolution_correct)).toBe(true);
      expect(after.rows.map(({ resolution_correct: _resolutionCorrect, ...row }) => row)).toEqual(
        before.rows,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
