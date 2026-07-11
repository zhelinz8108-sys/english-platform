import type { Job } from 'bullmq';
import type { PoolClient } from 'pg';

import { processDomainEvent, type DomainEventJob } from './processors.js';

export type DomainEventProcessor = (
  client: PoolClient,
  job: Job<DomainEventJob>,
) => Promise<Record<string, unknown>>;

export async function processEventExactlyOnce(
  client: PoolClient,
  job: Job<DomainEventJob>,
  processor: DomainEventProcessor = processDomainEvent,
): Promise<Record<string, unknown>> {
  const sourceEvent = await client.query(
    'SELECT id FROM outbox_events WHERE tenant_id=$1 AND id=$2',
    [job.data.tenantId, job.data.eventId],
  );
  if (sourceEvent.rowCount === 0) return { orphanedAfterReset: true };

  const receipt = await client.query(
    `INSERT INTO worker_event_receipts (tenant_id, event_id, consumer_name, processed_at)
     VALUES ($1,$2,'domain-worker',now()) ON CONFLICT DO NOTHING RETURNING event_id`,
    [job.data.tenantId, job.data.eventId],
  );
  if (receipt.rowCount === 0) return { replayed: true };

  return processor(client, job);
}
