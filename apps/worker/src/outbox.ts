import { Queue, type ConnectionOptions } from 'bullmq';
import { pool, withTenant } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import type { DomainEventJob } from './processors.js';

interface ClaimedEvent {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export class OutboxDispatcher {
  readonly #queue: ReturnType<typeof createQueue>;
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(connection: ConnectionOptions) {
    this.#queue = createQueue(connection);
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.poll(), config.outboxPollMs);
    this.#timer.unref();
    void this.poll();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    while (this.#running) await new Promise((resolve) => setTimeout(resolve, 25));
    await this.#queue.close();
  }

  async poll(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const claimed = await pool.query<ClaimedEvent>(
        'SELECT * FROM platform.claim_outbox_batch($1, $2)',
        [config.workerId, config.outboxBatchSize],
      );
      for (const event of claimed.rows) await this.enqueue(event);
    } catch (error) {
      logger.error({ err: error }, 'outbox polling failed');
    } finally {
      this.#running = false;
    }
  }

  private async enqueue(event: ClaimedEvent): Promise<void> {
    try {
      await this.#queue.add(
        event.event_type,
        {
          eventId: event.id,
          tenantId: event.tenant_id,
          aggregateId: event.aggregate_id,
          eventType: event.event_type,
          payload: event.payload,
        },
        {
          jobId: event.id,
          attempts: 8,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 604_800, count: 20_000 },
        },
      );
      await withTenant(event.tenant_id, async (client) => {
        await client.query(
          `UPDATE outbox_events SET status='published', published_at=now(), locked_at=NULL
           WHERE id=$1 AND status='processing'`,
          [event.id],
        );
      });
    } catch (error) {
      await withTenant(event.tenant_id, async (client) => {
        await client.query(
          `UPDATE outbox_events SET status='pending', locked_at=NULL,
             available_at=now()+make_interval(secs => LEAST(300, power(2, attempt_count)::int)),
             last_error_code='queue_enqueue_failed'
           WHERE id=$1`,
          [event.id],
        );
      }).catch(() => undefined);
      throw error;
    }
  }
}

function createQueue(connection: ConnectionOptions) {
  return new Queue<DomainEventJob>(config.queueName, { connection });
}
