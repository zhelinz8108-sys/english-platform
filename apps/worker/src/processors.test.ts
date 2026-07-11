import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DomainEventJob } from './processors.js';

const reconcileAssignment = vi.fn();
const reconcilePathEnrollment = vi.fn();

vi.mock('./task-materializer.js', () => ({
  reconcileAssignment,
  reconcilePathEnrollment,
}));

const { processDomainEvent } = await import('./processors.js');

function job(eventType: string, aggregateId = 'aggregate', payload: Record<string, unknown> = {}) {
  return {
    data: {
      eventId: 'event',
      tenantId: 'tenant',
      aggregateId,
      eventType,
      payload,
    },
  } as Job<DomainEventJob>;
}

describe('domain event routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileAssignment.mockResolvedValue(2);
    reconcilePathEnrollment.mockResolvedValue(1);
  });

  it.each(['assignment.published.v1', 'assignment.changed.v1', 'task.assignment.changed.v1'])(
    'reconciles assignment event %s',
    async (eventType) => {
      await expect(
        processDomainEvent({} as PoolClient, job(eventType, 'assignment-1')),
      ).resolves.toEqual({ students: 2 });
      expect(reconcileAssignment).toHaveBeenCalledWith(expect.anything(), 'assignment-1');
    },
  );

  it.each(['assignment.cancelled.v1', 'assignment.canceled.v1', 'task.assignment.cancelled.v1'])(
    'reconciles cancellation event %s without deleting history',
    async (eventType) => {
      await expect(
        processDomainEvent({} as PoolClient, job(eventType, 'assignment-1')),
      ).resolves.toEqual({ students: 2, cancelled: true });
      expect(reconcileAssignment).toHaveBeenCalledWith(expect.anything(), 'assignment-1');
    },
  );

  it('reconciles the enrollment from a path status event', async () => {
    await expect(
      processDomainEvent(
        {} as PoolClient,
        job('path.enrollment_status_changed.v1', 'enrollment-1'),
      ),
    ).resolves.toEqual({ students: 1 });
    expect(reconcilePathEnrollment).toHaveBeenCalledWith(expect.anything(), 'enrollment-1');
  });

  it('prefers explicit payload identifiers over the aggregate ID', async () => {
    await processDomainEvent(
      {} as PoolClient,
      job('assignment.changed.v1', 'aggregate', { assignmentId: 'payload-assignment' }),
    );
    await processDomainEvent(
      {} as PoolClient,
      job('path.enrollment_status_changed.v1', 'aggregate', {
        enrollmentId: 'payload-enrollment',
      }),
    );
    expect(reconcileAssignment).toHaveBeenCalledWith(expect.anything(), 'payload-assignment');
    expect(reconcilePathEnrollment).toHaveBeenCalledWith(expect.anything(), 'payload-enrollment');
  });

  it('does not create an automatic score decision for a teacher-only submission', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('SELECT id, task_attempt_id, responses FROM submission_snapshots')) {
        return { rows: [{ id: 'submission-1', task_attempt_id: 'attempt-1', responses: {} }] };
      }
      if (statement.includes('ORDER BY submission_revision')) {
        return { rows: [{ id: 'submission-1' }] };
      }
      if (statement.includes('FROM attempt_item_snapshots')) {
        return {
          rows: [
            {
              id: 'essay-snapshot',
              questionVersionId: 'writing-version',
              answerKey: null,
              maxScore: '30',
              scoringRule: {},
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      processDomainEvent(
        { query } as unknown as PoolClient,
        job('task.submitted.v1', 'submission-1'),
      ),
    ).resolves.toEqual({
      graded: false,
      fullyAutoGradable: false,
      requiresTeacher: true,
    });
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes('INSERT INTO score_decisions'),
      ),
    ).toBe(false);
  });
});
