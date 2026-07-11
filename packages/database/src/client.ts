import { Kysely, PostgresDialect } from 'kysely';
import { Pool, type PoolConfig } from 'pg';

import type { Database } from './types.js';

export type DatabaseConnection = Kysely<Database>;

export interface CreateDatabaseOptions {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  ssl?: PoolConfig['ssl'];
}

export class DatabaseClient {
  readonly pool: Pool;
  readonly db: DatabaseConnection;

  constructor(options: CreateDatabaseOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      application_name: options.applicationName ?? 'english-platform',
      max: options.maxConnections ?? 10,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      statement_timeout: options.statementTimeoutMillis ?? 15_000,
      ssl: options.ssl,
    });
    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
  }

  async destroy(): Promise<void> {
    await this.db.destroy();
  }
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseClient {
  return new DatabaseClient(options);
}
