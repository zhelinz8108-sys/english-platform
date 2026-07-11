import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Math.max(config.concurrency + 2, 10),
  application_name: 'english-platform-worker',
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
});

export async function withTenant<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.actor_type', 'worker', true)");
    await client.query("SELECT set_config('app.worker_id', $1, true)", [config.workerId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await client.query<T>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error('Expected one row, received none');
  return row;
}
