import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { reconcileAssignment, reconcilePathEnrollment } from './task-materializer.js';

const activeSource = {
  id: 'source-1',
  sourceType: 'exam_path',
  explicitPriority: 0,
  publishedAt: '2026-07-11T00:00:00Z',
  active: true,
  slotKey: 'slot',
  availableAt: '2026-07-11T00:00:00Z',
  dueAt: null,
  closeAt: null,
};

function result(rows: unknown[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

describe('assignment source reconciliation', () => {
  it('cancellation inactivates sources, hides orphaned items, and never deletes history', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      statements.push(text);
      if (text.includes('SELECT * FROM task_assignments')) {
        return result([
          {
            id: 'assignment-1',
            tenant_id: 'tenant-1',
            task_version_id: 'task-version-1',
            source_type: 'class',
            occurrence_key: 'occurrence',
            slot_key: 'slot',
            explicit_priority: 0,
            schedule_mode: 'absolute',
            available_at: new Date(),
            due_at: null,
            close_at: null,
            published_at: new Date(),
            status: 'cancelled',
          },
        ]);
      }
      if (text.includes('SELECT DISTINCT student_profile_id')) {
        return result([{ student_profile_id: 'student-1' }]);
      }
      if (text.includes('SELECT i.id,')) {
        return result([
          {
            id: 'item-1',
            sources: [{ ...activeSource, active: false }],
            overrides: [],
          },
        ]);
      }
      if (text.includes('winning_source_id=$2')) {
        expect(values).toEqual([
          'item-1',
          null,
          'hidden',
          'source_inactive',
          null,
          null,
          null,
          null,
        ]);
      }
      return result();
    });

    await expect(
      reconcileAssignment({ query } as unknown as PoolClient, 'assignment-1'),
    ).resolves.toBe(1);
    expect(
      statements.some((statement) =>
        /\bdelete\s+from\s+(task_attempts|submission_snapshots)/iu.test(statement),
      ),
    ).toBe(false);
    expect(
      statements.some(
        (statement) =>
          statement.includes('UPDATE student_task_sources') &&
          statement.includes('inactive_reason=$3::source_inactive_reason'),
      ),
    ).toBe(true);
  });

  it('a published assignment reactivates an existing source before resolving', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
      statements.push(text);
      if (text.includes('SELECT * FROM task_assignments')) {
        return result([
          {
            id: 'assignment-1',
            tenant_id: 'tenant-1',
            task_version_id: 'task-version-1',
            source_type: 'exam_path',
            occurrence_key: 'path:{enrollment_id}',
            slot_key: 'fallback',
            explicit_priority: 0,
            schedule_mode: 'path_relative',
            available_at: null,
            due_at: null,
            close_at: null,
            published_at: new Date('2026-07-11T00:00:00Z'),
            status: 'published',
          },
        ]);
      }
      if (text.includes('SELECT DISTINCT student_profile_id')) {
        return result([{ student_profile_id: 'student-1' }]);
      }
      if (text.includes('FROM task_assignment_student_targets st')) {
        return result([
          {
            studentProfileId: 'student-1',
            targetKind: 'path',
            targetId: 'path-target-1',
            classId: null,
            classStudentId: null,
            pathVersionId: 'path-version-1',
            pathEnrollmentId: 'enrollment-1',
            occurrenceKey: 'path:enrollment-1',
            slotKey: 'slot',
            availableAt: new Date('2026-07-11T00:00:00Z'),
            dueAt: null,
            closeAt: null,
          },
        ]);
      }
      if (text.includes('INSERT INTO student_task_items')) return result([{ id: 'item-1' }]);
      if (text.includes('SELECT id FROM student_task_sources')) {
        return result([{ id: 'source-1' }]);
      }
      if (text.includes('SELECT i.id,')) {
        return result([{ id: 'item-1', sources: [activeSource], overrides: [] }]);
      }
      return result();
    });

    await expect(
      reconcileAssignment({ query } as unknown as PoolClient, 'assignment-1'),
    ).resolves.toBe(1);
    expect(
      statements.some(
        (statement) =>
          statement.includes('UPDATE student_task_sources SET') &&
          statement.includes('inactive_at=NULL, inactive_reason=NULL'),
      ),
    ).toBe(true);
  });
});

describe('path enrollment reconciliation', () => {
  it('paused enrollment inactivates and recalculates only not-started path items', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      calls.push(values ? { text, values } : { text });
      if (text.includes('FROM student_path_enrollments')) {
        return result([
          {
            id: 'enrollment-1',
            student_profile_id: 'student-1',
            learning_path_version_id: 'path-version-1',
            status: 'paused',
          },
        ]);
      }
      if (text.includes('SELECT i.id,')) {
        return result([
          {
            id: 'item-1',
            sources: [{ ...activeSource, active: false }],
            overrides: [],
          },
        ]);
      }
      return result();
    });

    await expect(
      reconcilePathEnrollment({ query } as unknown as PoolClient, 'enrollment-1'),
    ).resolves.toBe(1);
    expect(
      calls.some(
        (call) =>
          call.text.includes('FROM student_task_items item') &&
          call.text.includes('source.student_path_enrollment_id=$1') &&
          call.text.includes("item.workflow_state='not_started'") &&
          call.values?.[1] === 'enrollment_paused',
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.text.includes('WHERE i.student_profile_id = $1') &&
          call.text.includes("i.workflow_state='not_started'") &&
          call.values?.[1] === false,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.text.includes("resolution_state='active'") &&
          call.text.includes("workflow_state='not_started'") &&
          call.values?.[1] === false,
      ),
    ).toBe(true);
  });

  it('active enrollment restores only enrollment-caused inactive not-started sources', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      calls.push(values ? { text, values } : { text });
      if (text.includes('FROM student_path_enrollments')) {
        return result([
          {
            id: 'enrollment-1',
            student_profile_id: 'student-1',
            learning_path_version_id: 'path-version-1',
            status: 'active',
          },
        ]);
      }
      if (text.includes('SELECT i.id,')) {
        return result([{ id: 'item-1', sources: [activeSource], overrides: [] }]);
      }
      return result();
    });

    await expect(
      reconcilePathEnrollment({ query } as unknown as PoolClient, 'enrollment-1'),
    ).resolves.toBe(1);

    expect(
      calls.some(
        (call) =>
          call.text.includes('SET inactive_at=NULL, inactive_reason=NULL') &&
          call.text.includes("item.workflow_state='not_started'") &&
          call.text.includes(
            "source.inactive_reason IN ('enrollment_paused','left_target','path_completed')",
          ),
      ),
    ).toBe(true);
    expect(calls.some((call) => call.text.includes('SELECT DISTINCT id FROM'))).toBe(false);
  });
});
