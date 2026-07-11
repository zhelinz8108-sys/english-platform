import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  createDatabase,
  withUserContext,
  withTenantContext,
  withTrustedTenantContext,
  type Database,
  type DatabaseClient,
} from '@english/database';
import type { Kysely, Transaction } from 'kysely';
import { AppConfig } from '../config.js';

export interface TenantTransactionContext {
  tenantId: string;
  userId: string;
  membershipId: string;
}

export type TenantTransaction = Transaction<Database>;

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: DatabaseClient;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.client = createDatabase({
      connectionString: config.values.DATABASE_URL,
      maxConnections: config.values.DATABASE_POOL_MAX,
      statementTimeoutMillis: config.values.DATABASE_STATEMENT_TIMEOUT_MS,
    });
  }

  get db(): Kysely<Database> {
    return this.client.db;
  }

  withTenant<T>(
    context: TenantTransactionContext,
    callback: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return withTrustedTenantContext(
      this.client.db,
      {
        tenantId: context.tenantId,
        userId: context.userId,
        membershipId: context.membershipId,
      },
      callback,
    );
  }

  withTenantForUser<T>(
    tenantId: string,
    userId: string,
    callback: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return withTenantContext(this.client.db, { tenantId, userId }, callback);
  }

  withGlobal<T>(callback: (transaction: TenantTransaction) => Promise<T>): Promise<T> {
    return this.client.db.transaction().execute(callback);
  }

  withUser<T>(
    userId: string,
    callback: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return withUserContext(this.client.db, { userId }, callback);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.destroy();
  }
}
