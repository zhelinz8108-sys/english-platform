import type { PoolClient } from 'pg';
import { TASK_SOURCE_WEIGHT, resolveStudentTaskItems, type TaskSourceType } from '@english/shared';
import { logger } from './logger.js';

interface AssignmentRow {
  id: string;
  tenant_id: string;
  task_version_id: string;
  source_type: TaskSourceType;
  occurrence_key: string;
  slot_key: string;
  explicit_priority: number;
  schedule_mode: 'absolute' | 'path_relative';
  available_at: Date | null;
  due_at: Date | null;
  close_at: Date | null;
  published_at: Date;
  status: 'draft' | 'published' | 'cancelled';
}

interface ExpandedTarget {
  studentProfileId: string;
  targetKind: 'student' | 'class' | 'path';
  targetId: string;
  classId: string | null;
  classStudentId: string | null;
  pathVersionId: string | null;
  pathEnrollmentId: string | null;
  occurrenceKey: string;
  slotKey: string;
  availableAt: Date;
  dueAt: Date | null;
  closeAt: Date | null;
}

export async function materializeAssignment(
  client: PoolClient,
  assignmentId: string,
): Promise<number> {
  return reconcileAssignment(client, assignmentId);
}

export async function reconcileAssignment(
  client: PoolClient,
  assignmentId: string,
): Promise<number> {
  const assignmentResult = await client.query<AssignmentRow>(
    `SELECT * FROM task_assignments WHERE id = $1 FOR SHARE`,
    [assignmentId],
  );
  const assignment = assignmentResult.rows[0];
  if (!assignment) return 0;

  const previousStudents = await client.query<{ student_profile_id: string }>(
    `SELECT DISTINCT student_profile_id
     FROM student_task_sources WHERE task_assignment_id = $1`,
    [assignmentId],
  );
  const expanded = assignment.status === 'published' ? await expandTargets(client, assignment) : [];
  const targetsByStudent = new Map<string, ExpandedTarget[]>();
  for (const target of expanded) {
    const targets = targetsByStudent.get(target.studentProfileId) ?? [];
    targets.push(target);
    targetsByStudent.set(target.studentProfileId, targets);
  }
  const affectedStudents = new Set(previousStudents.rows.map((row) => row.student_profile_id));
  for (const studentId of targetsByStudent.keys()) affectedStudents.add(studentId);

  for (const studentId of [...affectedStudents].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [studentId]);
    await client.query(
      `UPDATE student_task_sources
       SET inactive_at=COALESCE(inactive_at, now()),
           inactive_reason=$3::source_inactive_reason
       WHERE task_assignment_id=$1 AND student_profile_id=$2`,
      [
        assignment.id,
        studentId,
        assignment.status === 'cancelled' ? 'assignment_cancelled' : 'left_target',
      ],
    );
    for (const target of targetsByStudent.get(studentId) ?? []) {
      await upsertMaterializedSource(client, assignment, target);
    }
    await resolveStudent(client, studentId, true);
  }
  logger.info(
    { assignmentId, status: assignment.status, students: affectedStudents.size },
    'assignment reconciled',
  );
  return affectedStudents.size;
}

export async function reconcilePathEnrollment(
  client: PoolClient,
  enrollmentId: string,
): Promise<number> {
  const enrollmentResult = await client.query<{
    id: string;
    student_profile_id: string;
    learning_path_version_id: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
  }>(
    `SELECT id, student_profile_id, learning_path_version_id, status
     FROM student_path_enrollments WHERE id=$1 FOR SHARE`,
    [enrollmentId],
  );
  const enrollment = enrollmentResult.rows[0];
  if (!enrollment) return 0;

  if (enrollment.status !== 'active') {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      enrollment.student_profile_id,
    ]);
    const reason =
      enrollment.status === 'paused'
        ? 'enrollment_paused'
        : enrollment.status === 'completed'
          ? 'path_completed'
          : 'left_target';
    await client.query(
      `UPDATE student_task_sources source
       SET inactive_at=COALESCE(source.inactive_at, now()),
           inactive_reason=$2::source_inactive_reason
       FROM student_task_items item
       WHERE source.student_path_enrollment_id=$1
         AND item.id=source.student_task_item_id
         AND item.workflow_state='not_started'
         AND (
           source.inactive_at IS NULL OR
           source.inactive_reason IN ('enrollment_paused','left_target','path_completed')
         )`,
      [enrollment.id, reason],
    );
    await resolveStudent(client, enrollment.student_profile_id, true, 'not_started');
    return 1;
  }

  await reconcilePublishedPathAssignments(client, enrollment.learning_path_version_id);

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    enrollment.student_profile_id,
  ]);
  await client.query(
    `UPDATE student_task_sources source
     SET inactive_at=NULL, inactive_reason=NULL
     FROM student_task_items item
     WHERE source.student_path_enrollment_id=$1
       AND item.id=source.student_task_item_id
       AND item.workflow_state='not_started'
       AND source.inactive_reason IN ('enrollment_paused','left_target','path_completed')`,
    [enrollment.id],
  );
  await resolveStudent(client, enrollment.student_profile_id, true, 'not_started');
  return 1;
}

export async function reconcileNewPathEnrollment(
  client: PoolClient,
  enrollmentId: string,
): Promise<number> {
  const enrollment = await client.query<{
    learning_path_version_id: string;
    status: string;
  }>(
    `SELECT learning_path_version_id,status
     FROM student_path_enrollments WHERE id=$1 FOR SHARE`,
    [enrollmentId],
  );
  const row = enrollment.rows[0];
  if (!row || row.status !== 'active') return 0;
  return reconcilePublishedPathAssignments(client, row.learning_path_version_id);
}

export async function reconcileClassRoster(
  client: PoolClient,
  classId: string,
): Promise<number> {
  const assignments = await client.query<{ id: string }>(
    `SELECT DISTINCT assignment.id
     FROM task_assignments assignment
     JOIN task_assignment_class_targets target
       ON (target.tenant_id,target.task_assignment_id)=(assignment.tenant_id,assignment.id)
     WHERE target.class_id=$1 AND assignment.status='published'
     ORDER BY assignment.id`,
    [classId],
  );
  for (const assignment of assignments.rows) await reconcileAssignment(client, assignment.id);
  return assignments.rowCount ?? assignments.rows.length;
}

async function reconcilePublishedPathAssignments(
  client: PoolClient,
  learningPathVersionId: string,
): Promise<number> {
  const assignments = await client.query<{ id: string }>(
    `SELECT DISTINCT assignment.id
     FROM task_assignments assignment
     JOIN task_assignment_path_targets target
       ON (target.tenant_id,target.task_assignment_id)=(assignment.tenant_id,assignment.id)
     WHERE target.learning_path_version_id=$1 AND assignment.status='published'
     ORDER BY assignment.id`,
    [learningPathVersionId],
  );
  for (const assignment of assignments.rows) await reconcileAssignment(client, assignment.id);
  return assignments.rowCount ?? assignments.rows.length;
}

async function expandTargets(
  client: PoolClient,
  assignment: AssignmentRow,
): Promise<ExpandedTarget[]> {
  const rows = await client.query<ExpandedTarget>(
    `
      SELECT
        st.student_profile_id AS "studentProfileId",
        'student'::text AS "targetKind",
        st.id AS "targetId",
        NULL::uuid AS "classId",
        NULL::uuid AS "classStudentId",
        NULL::uuid AS "pathVersionId",
        NULL::uuid AS "pathEnrollmentId",
        a.occurrence_key AS "occurrenceKey",
        a.slot_key AS "slotKey",
        COALESCE(a.available_at, a.published_at) AS "availableAt",
        a.due_at AS "dueAt",
        a.close_at AS "closeAt"
      FROM task_assignment_student_targets st
      JOIN task_assignments a ON (a.tenant_id, a.id) = (st.tenant_id, st.task_assignment_id)
      WHERE st.task_assignment_id = $1
      UNION ALL
      SELECT
        cs.student_profile_id,
        'class', ct.id, ct.class_id, cs.id, NULL::uuid, NULL::uuid,
        a.occurrence_key, a.slot_key, COALESCE(a.available_at, a.published_at), a.due_at, a.close_at
      FROM task_assignment_class_targets ct
      JOIN task_assignments a ON (a.tenant_id, a.id) = (ct.tenant_id, ct.task_assignment_id)
      JOIN class_students cs ON (cs.tenant_id, cs.class_id) = (ct.tenant_id, ct.class_id)
      WHERE ct.task_assignment_id = $1 AND cs.left_at IS NULL
      UNION ALL
      SELECT
        pe.student_profile_id,
        'path', pt.id, NULL::uuid, NULL::uuid, pt.learning_path_version_id, pe.id,
        replace(a.occurrence_key, '{enrollment_id}', pe.id::text),
        replace(COALESCE(pn.slot_key_template, a.slot_key), '{enrollment_id}', pe.id::text),
        pe.enrolled_at + make_interval(days => COALESCE(pn.available_offset_days, 0)),
        CASE WHEN pn.due_offset_days IS NULL THEN NULL ELSE pe.enrolled_at + make_interval(days => pn.due_offset_days) END,
        CASE WHEN pn.close_offset_days IS NULL THEN NULL ELSE pe.enrolled_at + make_interval(days => pn.close_offset_days) END
      FROM task_assignment_path_targets pt
      JOIN task_assignments a ON (a.tenant_id, a.id) = (pt.tenant_id, pt.task_assignment_id)
      JOIN path_nodes pn ON (pn.tenant_id, pn.id) = (pt.tenant_id, pt.path_node_id)
      JOIN student_path_enrollments pe
        ON (pe.tenant_id, pe.learning_path_version_id) = (pt.tenant_id, pt.learning_path_version_id)
      WHERE pt.task_assignment_id = $1 AND pe.status = 'active'
    `,
    [assignment.id],
  );
  return rows.rows;
}

async function upsertMaterializedSource(
  client: PoolClient,
  assignment: AssignmentRow,
  target: ExpandedTarget,
): Promise<void> {
  const item = await client.query<{ id: string }>(
    `
      INSERT INTO student_task_items (
        tenant_id, student_profile_id, task_version_id, occurrence_key, slot_key,
        resolution_state, resolution_reason, workflow_state, available_at, due_at, close_at,
        resolution_revision, resolved_at
      ) VALUES ($1,$2,$3,$4,$5,'superseded','slot_conflict','not_started',$6,$7,$8,1,now())
      ON CONFLICT (tenant_id, student_profile_id, task_version_id, occurrence_key)
      DO UPDATE SET updated_at = now()
      RETURNING id
    `,
    [
      assignment.tenant_id,
      target.studentProfileId,
      assignment.task_version_id,
      target.occurrenceKey,
      target.slotKey,
      target.availableAt,
      target.dueAt,
      target.closeAt,
    ],
  );
  const itemId = item.rows[0]?.id;
  if (!itemId) throw new Error('StudentTaskItem upsert failed');

  const existing = await client.query<{ id: string }>(
    `
      SELECT id FROM student_task_sources
      WHERE student_task_item_id = $1 AND task_assignment_id = $2
        AND COALESCE(student_target_id, '00000000-0000-0000-0000-000000000000') = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')
        AND COALESCE(class_student_id, '00000000-0000-0000-0000-000000000000') = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000')
        AND COALESCE(student_path_enrollment_id, '00000000-0000-0000-0000-000000000000') = COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000')
      LIMIT 1
    `,
    [
      itemId,
      assignment.id,
      target.targetKind === 'student' ? target.targetId : null,
      target.classStudentId,
      target.pathEnrollmentId,
    ],
  );
  const existingSource = existing.rows[0];
  if (existingSource) {
    await client.query(
      `UPDATE student_task_sources SET
         source_type=$2, source_weight=$3, explicit_priority=$4, published_at=$5,
         occurrence_key=$6, slot_key=$7, available_at=$8, due_at=$9, close_at=$10,
         inactive_at=NULL, inactive_reason=NULL
       WHERE id=$1`,
      [
        existingSource.id,
        assignment.source_type,
        TASK_SOURCE_WEIGHT[assignment.source_type],
        assignment.explicit_priority,
        assignment.published_at,
        target.occurrenceKey,
        target.slotKey,
        target.availableAt,
        target.dueAt,
        target.closeAt,
      ],
    );
    return;
  }

  await client.query(
    `
      INSERT INTO student_task_sources (
        tenant_id, student_task_item_id, student_profile_id, task_assignment_id,
        student_target_id, class_target_id, path_target_id, class_id,
        learning_path_version_id, class_student_id, student_path_enrollment_id,
        source_type, source_weight, explicit_priority, published_at,
        occurrence_key, slot_key, available_at, due_at, close_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `,
    [
      assignment.tenant_id,
      itemId,
      target.studentProfileId,
      assignment.id,
      target.targetKind === 'student' ? target.targetId : null,
      target.targetKind === 'class' ? target.targetId : null,
      target.targetKind === 'path' ? target.targetId : null,
      target.classId,
      target.pathVersionId,
      target.classStudentId,
      target.pathEnrollmentId,
      assignment.source_type,
      TASK_SOURCE_WEIGHT[assignment.source_type],
      assignment.explicit_priority,
      assignment.published_at,
      target.occurrenceKey,
      target.slotKey,
      target.availableAt,
      target.dueAt,
      target.closeAt,
    ],
  );
}

export async function resolveStudent(
  client: PoolClient,
  studentProfileId: string,
  lockAlreadyHeld = false,
  workflowScope: 'all' | 'not_started' = 'all',
): Promise<void> {
  if (!lockAlreadyHeld) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [studentProfileId]);
  }
  const occupiedSlots =
    workflowScope === 'not_started'
      ? new Set(
          (
            await client.query<{ slot_key: string }>(
              `SELECT slot_key
               FROM student_task_items
               WHERE student_profile_id=$1
                 AND workflow_state<>'not_started'
                 AND resolution_state='active'`,
              [studentProfileId],
            )
          ).rows.map((row) => row.slot_key),
        )
      : new Set<string>();
  const items = await client.query<{
    id: string;
    sources: Array<{
      id: string;
      sourceType: TaskSourceType;
      explicitPriority: number;
      publishedAt: string;
      active: boolean;
      slotKey: string;
      availableAt: string;
      dueAt: string | null;
      closeAt: string | null;
    }>;
    overrides: Array<{
      id: string;
      action: 'hide' | 'restore' | 'replace' | 'reschedule' | 'require_redo';
      createdAt: string;
      reversesOverrideId: string | null;
      slotKey: string | null;
      availableAt: string | null;
      dueAt: string | null;
      closeAt: string | null;
    }>;
  }>(
    `
      SELECT i.id,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', s.id, 'sourceType', s.source_type, 'explicitPriority', s.explicit_priority,
            'publishedAt', s.published_at, 'active', s.inactive_at IS NULL,
            'slotKey', s.slot_key, 'availableAt', s.available_at,
            'dueAt', s.due_at, 'closeAt', s.close_at
          )) FROM student_task_sources s WHERE s.student_task_item_id = i.id
        ), '[]'::jsonb) AS sources,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', o.id, 'action', o.action, 'createdAt', o.created_at,
            'reversesOverrideId', o.reverses_override_id, 'slotKey', o.metadata->>'slotKey',
            'availableAt', o.available_at, 'dueAt', o.due_at, 'closeAt', o.close_at
          ) ORDER BY o.created_at, o.id)
          FROM student_task_overrides o WHERE o.student_task_item_id = i.id
        ), '[]'::jsonb) AS overrides
      FROM student_task_items i
      WHERE i.student_profile_id = $1
        AND ($2::boolean OR i.workflow_state='not_started')
      FOR UPDATE
    `,
    [studentProfileId, workflowScope === 'all'],
  );
  const resolved = resolveStudentTaskItems(items.rows);
  await client.query(
    `UPDATE student_task_items SET resolution_state='superseded', resolution_reason='slot_conflict', updated_at=now()
     WHERE student_profile_id=$1 AND resolution_state='active'
       AND ($2::boolean OR workflow_state='not_started')`,
    [studentProfileId, workflowScope === 'all'],
  );
  for (const item of resolved) {
    const state =
      item.resolutionState === 'active' && item.slotKey && occupiedSlots.has(item.slotKey)
        ? {
            resolutionState: 'superseded' as const,
            resolutionReason: 'slot_conflict' as const,
          }
        : item;
    await client.query(
      `
        UPDATE student_task_items SET
          winning_source_id=$2, resolution_state=$3, resolution_reason=$4,
          slot_key=COALESCE($5, slot_key), available_at=COALESCE($6, available_at),
          due_at=$7, close_at=$8, resolution_revision=resolution_revision+1,
          resolved_at=now(), updated_at=now()
        WHERE id=$1
      `,
      [
        item.itemId,
        item.winningSourceId,
        state.resolutionState,
        state.resolutionReason,
        item.slotKey,
        item.availableAt,
        item.dueAt,
        item.closeAt,
      ],
    );
  }
}
