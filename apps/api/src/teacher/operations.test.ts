import { describe, expect, it } from 'vitest';
import { assignmentCommandSpec } from './operations.service.js';

describe('assignment command orchestration', () => {
  it('publishes only through an outbox event and never materializes in the API transaction', () => {
    expect(assignmentCommandSpec('publish')).toEqual({
      eventType: 'assignment.published.v1',
      materializeSynchronously: false,
    });
  });

  it('delegates cancellation reconciliation to the worker too', () => {
    expect(assignmentCommandSpec('cancel').materializeSynchronously).toBe(false);
  });
});
