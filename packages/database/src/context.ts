import { sql, type Transaction } from 'kysely';

import type { DatabaseConnection } from './client.js';
import type { Database } from './types.js';

export type TenantTransaction = Transaction<Database>;

export interface TenantRequestContext {
  tenantId: string;
  userId: string;
  expectedMembershipId?: string;
}

export interface UserRequestContext {
  userId: string;
}

export interface ActiveTenantContext {
  tenantId: string;
  userId: string;
  membershipId: string;
}

export interface TrustedTenantContext {
  tenantId: string;
  userId: string;
  membershipId: string;
}

export interface WorkerTenantContext {
  tenantId: string;
  workerId: string;
}

export class TenantContextError extends Error {
  readonly code: 'membership_not_found' | 'membership_mismatch';

  constructor(code: TenantContextError['code']) {
    super(code);
    this.name = 'TenantContextError';
    this.code = code;
  }
}

async function setLocal(
  trx: TenantTransaction,
  key: 'app.tenant_id' | 'app.user_id' | 'app.membership_id' | 'app.worker_id',
  value: string,
): Promise<void> {
  await sql`select set_config(${key}, ${value}, true)`.execute(trx);
}

async function setTenantAndUserLocal(
  trx: TenantTransaction,
  tenantId: string,
  userId: string,
): Promise<void> {
  await sql`select
    set_config('app.tenant_id', ${tenantId}, true),
    set_config('app.user_id', ${userId}, true)`.execute(trx);
}

async function setTrustedTenantLocal(
  trx: TenantTransaction,
  context: TrustedTenantContext,
): Promise<void> {
  await sql`select
    set_config('app.tenant_id', ${context.tenantId}, true),
    set_config('app.user_id', ${context.userId}, true),
    set_config('app.membership_id', ${context.membershipId}, true)`.execute(trx);
}

export async function withUserContext<T>(
  db: DatabaseConnection,
  context: UserRequestContext,
  callback: (trx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await setLocal(trx, 'app.user_id', context.userId);
    return callback(trx);
  });
}

export async function withTenantContext<T>(
  db: DatabaseConnection,
  context: TenantRequestContext,
  callback: (trx: TenantTransaction, context: ActiveTenantContext) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await setTenantAndUserLocal(trx, context.tenantId, context.userId);

    const membership = await trx
      .selectFrom('tenant_memberships')
      .select('id')
      .where('tenant_id', '=', context.tenantId)
      .where('user_id', '=', context.userId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!membership) {
      throw new TenantContextError('membership_not_found');
    }
    if (context.expectedMembershipId && context.expectedMembershipId !== membership.id) {
      throw new TenantContextError('membership_mismatch');
    }

    await setLocal(trx, 'app.membership_id', membership.id);
    return callback(trx, {
      tenantId: context.tenantId,
      userId: context.userId,
      membershipId: membership.id,
    });
  });
}

export async function withTrustedTenantContext<T>(
  db: DatabaseConnection,
  context: TrustedTenantContext,
  callback: (trx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await setTrustedTenantLocal(trx, context);
    return callback(trx);
  });
}

export async function withWorkerTenantContext<T>(
  db: DatabaseConnection,
  context: WorkerTenantContext,
  callback: (trx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select
      set_config('app.tenant_id', ${context.tenantId}, true),
      set_config('app.worker_id', ${context.workerId}, true)`.execute(trx);
    return callback(trx);
  });
}
