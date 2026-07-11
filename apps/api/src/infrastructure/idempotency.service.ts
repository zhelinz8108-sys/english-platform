import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { requestHash } from '../common/domain.js';
import { ProblemException } from '../common/problem.js';
import {
  DatabaseService,
  type TenantTransaction,
  type TenantTransactionContext,
} from './database.service.js';

export interface IdempotentCommandResult<T> {
  body: T;
  status: number;
  headers?: Record<string, string>;
  replayed: boolean;
}

interface IdempotencyRow {
  request_hash: string;
  status: 'in_progress' | 'succeeded' | 'failed';
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: unknown;
  locked_until: Date;
}

function validateKey(key: string | undefined): string {
  if (!key || key.length < 16 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw ProblemException.badRequest(
      'invalid_idempotency_key',
      'Idempotency-Key 必须为 16–128 个安全字符。',
    );
  }
  return key;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async execute<T>(
    context: TenantTransactionContext,
    operation: string,
    keyInput: string | undefined,
    body: unknown,
    command: (
      transaction: TenantTransaction,
    ) => Promise<Omit<IdempotentCommandResult<T>, 'replayed'>>,
  ): Promise<IdempotentCommandResult<T>> {
    const key = validateKey(keyInput);
    const hash = requestHash('POST', operation, body);
    let deferredProblem: ProblemException | undefined;
    const result = await this.database.withTenant(context, async (transaction) => {
      const existingResult = await sql<IdempotencyRow>`
        select request_hash, status, response_status, response_headers, response_body, locked_until
        from idempotency_records
        where tenant_id = ${context.tenantId}::uuid
          and membership_id = ${context.membershipId}::uuid
          and operation = ${operation}
          and idempotency_key = ${key}
        for update
      `.execute(transaction);
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) {
          throw ProblemException.conflict('idempotency_key_reused', '同一幂等键已用于不同请求体。');
        }
        if (existing.status === 'in_progress') {
          const seconds = Math.max(
            1,
            Math.ceil((existing.locked_until.getTime() - Date.now()) / 1_000),
          );
          throw ProblemException.conflict(
            'idempotency_in_progress',
            '相同命令仍在处理中。',
            seconds,
          );
        }
        if (existing.status === 'failed') {
          const stored = existing.response_body as {
            code?: string;
            title?: string;
            detail?: string;
          } | null;
          throw new ProblemException(
            existing.response_status ?? 409,
            stored?.code ?? 'idempotent_command_failed',
            stored?.title ?? '命令失败',
            stored?.detail,
            existing.response_headers ?? {},
          );
        }
        return {
          body: existing.response_body as T,
          status: existing.response_status ?? 200,
          ...(existing.response_headers === null ? {} : { headers: existing.response_headers }),
          replayed: true,
        };
      }

      const now = new Date();
      await sql`
        insert into idempotency_records (
          id, tenant_id, membership_id, operation, idempotency_key, request_hash, status,
          locked_until, expires_at, created_at, updated_at
        ) values (
          ${uuidv7()}::uuid, ${context.tenantId}::uuid, ${context.membershipId}::uuid,
          ${operation}, ${key}, ${hash}, 'in_progress', ${new Date(now.getTime() + 30_000)},
          ${new Date(now.getTime() + 7 * 86_400_000)}, ${now}, ${now}
        )
      `.execute(transaction);
      await sql`savepoint idempotent_business`.execute(transaction);
      try {
        const completed = await command(transaction);
        await sql`
          update idempotency_records
          set status = 'succeeded', response_status = ${completed.status},
              response_headers = ${JSON.stringify(completed.headers ?? {})}::jsonb,
              response_body = ${JSON.stringify(completed.body)}::jsonb, updated_at = now()
          where tenant_id = ${context.tenantId}::uuid
            and membership_id = ${context.membershipId}::uuid
            and operation = ${operation} and idempotency_key = ${key}
        `.execute(transaction);
        await sql`release savepoint idempotent_business`.execute(transaction);
        return { ...completed, replayed: false };
      } catch (error) {
        if (!(error instanceof ProblemException)) throw error;
        await sql`rollback to savepoint idempotent_business`.execute(transaction);
        await sql`
          update idempotency_records
          set status = 'failed', response_status = ${error.problem.status},
              response_headers = ${JSON.stringify(error.headers)}::jsonb,
              response_body = ${JSON.stringify(error.problem)}::jsonb, updated_at = now()
          where tenant_id = ${context.tenantId}::uuid
            and membership_id = ${context.membershipId}::uuid
            and operation = ${operation} and idempotency_key = ${key}
        `.execute(transaction);
        deferredProblem = error;
        return { body: undefined as T, status: error.problem.status, replayed: false };
      }
    });
    if (deferredProblem) throw deferredProblem;
    return result;
  }
}
