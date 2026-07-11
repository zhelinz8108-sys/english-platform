import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { processEventExactlyOnce, type DomainEventProcessor } from './event-handler.js';
import type { DomainEventJob } from './processors.js';

function job(): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      tenantId: 'tenant-1',
      aggregateId: 'aggregate-1',
      eventType: 'assignment.changed.v1',
      payload: {},
    },
  } as Job<DomainEventJob>;
}

function clientWith(...results: Array<{ rowCount: number; rows?: unknown[] }>): PoolClient {
  const query = vi.fn();
  for (const result of results) {
    query.mockResolvedValueOnce({ ...result, rows: result.rows ?? [] });
  }
  return { query } as unknown as PoolClient;
}

describe('event receipt replay protection', () => {
  it('processes a first delivery after writing its receipt', async () => {
    const client = clientWith({ rowCount: 1 }, { rowCount: 1, rows: [{ event_id: 'event-1' }] });
    const processor = vi.fn(async () => ({ handled: true })) as DomainEventProcessor;

    await expect(processEventExactlyOnce(client, job(), processor)).resolves.toEqual({
      handled: true,
    });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the processor when a receipt already exists', async () => {
    const client = clientWith({ rowCount: 1 }, { rowCount: 0 });
    const processor = vi.fn(async () => ({ handled: true })) as DomainEventProcessor;

    await expect(processEventExactlyOnce(client, job(), processor)).resolves.toEqual({
      replayed: true,
    });
    expect(processor).not.toHaveBeenCalled();
  });

  it('ignores jobs whose source event no longer exists', async () => {
    const client = clientWith({ rowCount: 0 });
    const processor = vi.fn(async () => ({ handled: true })) as DomainEventProcessor;

    await expect(processEventExactlyOnce(client, job(), processor)).resolves.toEqual({
      orphanedAfterReset: true,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(processor).not.toHaveBeenCalled();
  });

  it('propagates processor failure so the surrounding transaction rolls back the receipt', async () => {
    const client = clientWith({ rowCount: 1 }, { rowCount: 1 });
    const processor = vi.fn(async () => {
      throw new Error('transient');
    }) as DomainEventProcessor;

    await expect(processEventExactlyOnce(client, job(), processor)).rejects.toThrow('transient');
    expect(processor).toHaveBeenCalledTimes(1);
  });
});
