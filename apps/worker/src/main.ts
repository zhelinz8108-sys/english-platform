import { Worker, type ConnectionOptions } from 'bullmq';
import { config } from './config.js';
import { pool, withTenant } from './db.js';
import { processEventExactlyOnce } from './event-handler.js';
import { logger } from './logger.js';
import { OutboxDispatcher } from './outbox.js';
import type { DomainEventJob } from './processors.js';

const redisUrl = new URL(config.redisUrl);
const connection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  ...(redisUrl.pathname.length > 1 ? { db: Number(redisUrl.pathname.slice(1)) } : {}),
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
};
const dispatcher = new OutboxDispatcher(connection);
const worker = new Worker<DomainEventJob>(
  config.queueName,
  async (job) =>
    withTenant(job.data.tenantId, async (client) => processEventExactlyOnce(client, job)),
  { connection, concurrency: config.concurrency },
);

worker.on('completed', (job) =>
  logger.info({ jobId: job.id, eventType: job.name }, 'job completed'),
);
worker.on('failed', (job, error) =>
  logger.error({ err: error, jobId: job?.id, eventType: job?.name }, 'job failed'),
);
worker.on('error', (error) => logger.error({ err: error }, 'worker error'));

dispatcher.start();
logger.info(
  { queue: config.queueName, concurrency: config.concurrency, workerId: config.workerId },
  'worker started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  await dispatcher.stop();
  await worker.close();
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.fatal({ err: error }, 'worker shutdown failed');
        process.exit(1);
      });
  });
}
