import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { autoGrade } from './auto-grading.js';
import {
  reconcileAssignment,
  reconcileClassRoster,
  reconcileNewPathEnrollment,
  reconcilePathEnrollment,
} from './task-materializer.js';

export interface DomainEventJob {
  eventId: string;
  tenantId: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function processDomainEvent(
  client: PoolClient,
  job: Job<DomainEventJob>,
): Promise<Record<string, unknown>> {
  const event = job.data;
  switch (event.eventType) {
    case 'assignment.published.v1':
    case 'task.assignment.published.v1':
    case 'assignment.changed.v1':
    case 'task.assignment.changed.v1': {
      const students = await reconcileAssignment(
        client,
        String(event.payload.assignmentId ?? event.aggregateId),
      );
      return { students };
    }
    case 'assignment.cancelled.v1':
    case 'assignment.canceled.v1':
    case 'task.assignment.cancelled.v1':
    case 'task.assignment.canceled.v1': {
      const students = await reconcileAssignment(
        client,
        String(event.payload.assignmentId ?? event.aggregateId),
      );
      return { students, cancelled: true };
    }
    case 'path.enrollment_status_changed.v1': {
      const students = await reconcilePathEnrollment(
        client,
        String(event.payload.enrollmentId ?? event.aggregateId),
      );
      return { students };
    }
    case 'path.enrolled.v1': {
      const assignments = await reconcileNewPathEnrollment(
        client,
        String(event.payload.enrollmentId ?? event.aggregateId),
      );
      return { assignments };
    }
    case 'class.roster_changed.v1': {
      const assignments = await reconcileClassRoster(
        client,
        String(event.payload.classId ?? event.aggregateId),
      );
      return { assignments };
    }
    case 'task.submitted.v1':
      return processSubmission(
        client,
        String(event.payload.submissionSnapshotId ?? event.aggregateId),
      );
    case 'progress.rebuild.requested.v1':
      return rebuildProgress(
        client,
        String(event.payload.studentProfileId ?? event.aggregateId),
        event.eventId,
      );
    default:
      return { ignored: true, eventType: event.eventType };
  }
}

async function processSubmission(
  client: PoolClient,
  submissionSnapshotId: string,
): Promise<Record<string, unknown>> {
  const submission = await client.query<{
    id: string;
    task_attempt_id: string;
    responses: Record<string, unknown>;
  }>('SELECT id, task_attempt_id, responses FROM submission_snapshots WHERE id=$1 FOR SHARE', [
    submissionSnapshotId,
  ]);
  const snapshot = submission.rows[0];
  if (!snapshot) return { missing: true };
  await client.query('SELECT id FROM task_attempts WHERE id=$1 FOR UPDATE', [
    snapshot.task_attempt_id,
  ]);
  const latestSubmission = await client.query<{ id: string }>(
    `SELECT id FROM submission_snapshots
     WHERE task_attempt_id=$1 ORDER BY submission_revision DESC, id DESC LIMIT 1`,
    [snapshot.task_attempt_id],
  );
  if (latestSubmission.rows[0]?.id !== snapshot.id) {
    return { staleSubmission: true, submissionSnapshotId: snapshot.id };
  }
  const questions = await client.query<{
    id: string;
    questionVersionId: string;
    answerKey: unknown;
    maxScore: string;
    scoringRule: Record<string, unknown>;
  }>(
    `SELECT id, question_version_id AS "questionVersionId", answer_key_snapshot AS "answerKey",
            max_score AS "maxScore", scoring_rule_snapshot AS "scoringRule"
     FROM attempt_item_snapshots WHERE task_attempt_id=$1 ORDER BY position`,
    [snapshot.task_attempt_id],
  );
  const result = autoGrade(
    questions.rows.map((row) => ({ ...row, maxScore: Number(row.maxScore) })),
    snapshot.responses,
  );
  if (result.components.length === 0) return { graded: false };

  if (result.fullyAutoGradable) {
    await client.query(
      `
        INSERT INTO score_decisions (
          tenant_id, task_attempt_id, submission_snapshot_id, decision_type,
          score, max_score, component_scores, rubric_result
        )
        SELECT tenant_id, task_attempt_id, id, 'auto_scored', $2, $3, $4::jsonb, '{}'::jsonb
        FROM submission_snapshots submission WHERE id=$1
          AND NOT EXISTS (
            SELECT 1 FROM score_decisions decision
            WHERE decision.tenant_id=submission.tenant_id
              AND decision.submission_snapshot_id=submission.id
              AND decision.decision_type='auto_scored'
              AND decision.supersedes_score_decision_id IS NULL
          )
      `,
      [snapshot.id, result.score, result.maxScore, JSON.stringify(result.components)],
    );
  }
  await client.query(
    `UPDATE task_attempts SET state=$2::attempt_state,
       completed_at=CASE WHEN $2::attempt_state='completed'::attempt_state THEN now() ELSE NULL END,
       updated_at=now() WHERE id=$1`,
    [snapshot.task_attempt_id, result.fullyAutoGradable ? 'completed' : 'grading'],
  );
  await client.query(
    `UPDATE student_task_items i SET workflow_state=$2::workflow_state, updated_at=now()
     FROM task_attempts a WHERE a.id=$1 AND i.id=a.student_task_item_id`,
    [snapshot.task_attempt_id, result.fullyAutoGradable ? 'completed' : 'grading'],
  );
  return {
    graded: result.fullyAutoGradable,
    fullyAutoGradable: result.fullyAutoGradable,
    requiresTeacher: !result.fullyAutoGradable,
    ...(result.fullyAutoGradable ? { score: result.score } : {}),
  };
}

async function rebuildProgress(
  client: PoolClient,
  studentProfileId: string,
  eventId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<{
    assigned: string;
    completed: string;
    average_score: string | null;
  }>(
    `
      SELECT COUNT(DISTINCT i.id)::text AS assigned,
        COUNT(DISTINCT i.id) FILTER (WHERE i.workflow_state='completed')::text AS completed,
        AVG(latest.score)::text AS average_score
      FROM student_task_items i
      LEFT JOIN task_attempts a ON a.student_task_item_id=i.id
      LEFT JOIN LATERAL (
        SELECT sd.score FROM score_decisions sd
        JOIN submission_snapshots ss ON ss.id=sd.submission_snapshot_id
        WHERE sd.task_attempt_id=a.id
        ORDER BY ss.submission_revision DESC,
          CASE sd.decision_type WHEN 'admin_override' THEN 300 WHEN 'teacher_confirmed' THEN 200 ELSE 100 END DESC,
          sd.created_at DESC, sd.id DESC LIMIT 1
      ) latest ON true
      WHERE i.student_profile_id=$1
    `,
    [studentProfileId],
  );
  const row = result.rows[0] ?? { assigned: '0', completed: '0', average_score: null };
  const assigned = Number(row.assigned);
  const completed = Number(row.completed);
  const metrics = {
    assigned,
    completed,
    completionRate: assigned === 0 ? 0 : completed / assigned,
    averageScore: row.average_score === null ? null : Number(row.average_score),
  };
  await client.query(
    `
      INSERT INTO progress_projections (
        tenant_id, student_profile_id, projection_type, projection_key,
        metrics, source_event_cursor, as_of
      ) SELECT tenant_id, id, 'overall', 'overall', $2::jsonb, $3, now()
        FROM student_profiles WHERE id=$1
      ON CONFLICT (tenant_id, student_profile_id, projection_type, projection_key)
      DO UPDATE SET metrics=EXCLUDED.metrics, source_event_cursor=EXCLUDED.source_event_cursor,
        as_of=EXCLUDED.as_of, updated_at=now()
    `,
    [studentProfileId, JSON.stringify(metrics), eventId],
  );
  return metrics;
}
