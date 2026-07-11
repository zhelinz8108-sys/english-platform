import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { TenantTransaction } from './database.service.js';

export interface EventActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId: string;
}

@Injectable()
export class EventsService {
  async append(
    transaction: TenantTransaction,
    actor: EventActor,
    input: {
      action: string;
      resourceType: string;
      resourceId?: string;
      details?: Record<string, unknown>;
      eventType: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = new Date();
    const auditId = uuidv7();
    const outboxId = uuidv7();
    const details = JSON.stringify(input.details ?? {});
    const payload = JSON.stringify(input.payload ?? {});
    await sql`
      insert into audit_logs (
        id, tenant_id, actor_user_id, actor_membership_id, actor_type, action,
        resource_type, resource_id, details, correlation_id, request_id, created_at
      ) values (
        ${auditId}::uuid, ${actor.tenantId}::uuid, ${actor.userId}::uuid,
        ${actor.membershipId}::uuid, 'user', ${input.action}, ${input.resourceType},
        ${input.resourceId ?? null}::uuid, ${details}::jsonb, ${actor.requestId}::uuid,
        ${actor.requestId}::uuid, ${now}
      )
    `.execute(transaction);
    await sql`
      insert into outbox_events (
        id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status,
        occurred_at, available_at, attempt_count, created_at
      ) values (
        ${outboxId}::uuid, ${actor.tenantId}::uuid, ${input.resourceType},
        ${input.resourceId ?? actor.membershipId}::uuid, ${input.eventType}, ${payload}::jsonb,
        'pending', ${now}, ${now}, 0, ${now}
      )
    `.execute(transaction);
  }
}
