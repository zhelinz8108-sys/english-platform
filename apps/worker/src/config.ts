import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required(
    'WORKER_DATABASE_URL',
    process.env.DATABASE_URL ??
      'postgresql://english_worker:english_worker@localhost:5432/english_platform',
  ),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  queueName: process.env.WORKER_QUEUE_NAME ?? 'english-platform-domain-events',
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8),
  outboxBatchSize: Number(process.env.OUTBOX_BATCH_SIZE ?? 50),
  outboxPollMs: Number(process.env.OUTBOX_POLL_MS ?? 1000),
};
