import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantRole } from '@english/shared';
import { sql } from 'kysely';
import { validate as validateUuid } from 'uuid';
import { constantTimeEqual, verifyCsrfToken } from '../common/domain.js';
import { ProblemException } from '../common/problem.js';
import type { ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import { DatabaseService } from '../infrastructure/database.service.js';
import { AuthService } from './auth.service.js';

const PUBLIC_KEY = 'api.public';
const CSRF_KEY = 'api.csrf';
const ROLES_KEY = 'api.roles';

export const Public = (): CustomDecorator => SetMetadata(PUBLIC_KEY, true);
export const RequiresCsrf = (): CustomDecorator => SetMetadata(CSRF_KEY, true);
export const Roles = (...roles: TenantRole[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    request.principal = await this.auth.verifyAccess(
      request.cookies?.access_token as string | undefined,
    );
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      !this.reflector.getAllAndOverride<boolean>(CSRF_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const header = request.header('X-CSRF-Token');
    const cookie = request.cookies?.csrf_token as string | undefined;
    const origin = request.header('Origin');
    const fetchSite = request.header('Sec-Fetch-Site');
    if (
      !header ||
      !cookie ||
      !constantTimeEqual(header, cookie) ||
      !verifyCsrfToken(this.config.csrfSecret, header) ||
      origin !== this.config.values.WEB_ORIGIN ||
      (fetchSite !== undefined && !['same-origin', 'same-site'].includes(fetchSite))
    ) {
      throw ProblemException.forbidden('csrf_failed', 'CSRF、Origin 或 Fetch Metadata 校验失败。');
    }
    return true;
  }
}

interface MembershipRoleRow {
  membership_id: string;
  role: TenantRole | null;
}

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly membershipLookups = new Map<string, Promise<MembershipRoleRow[]>>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const tenantParam = request.params.tenantId;
    const tenantId = Array.isArray(tenantParam) ? tenantParam[0] : tenantParam;
    if (!tenantId) return true;
    if (!validateUuid(tenantId) || !request.principal) throw ProblemException.notFound();
    try {
      const rows = await this.membershipRoles(tenantId, request.principal.userId);
      const membershipId = rows[0]?.membership_id;
      if (!membershipId) throw ProblemException.notFound();
      request.activeTenant = {
        tenantId,
        membershipId,
        roles: rows.flatMap((row) => (row.role ? [row.role] : [])),
      };
      return true;
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      throw ProblemException.notFound();
    }
  }

  private membershipRoles(tenantId: string, userId: string): Promise<MembershipRoleRow[]> {
    const key = `${tenantId}:${userId}`;
    const existing = this.membershipLookups.get(key);
    if (existing) return existing;
    const lookup = this.database
      .withTenantForUser<MembershipRoleRow[]>(tenantId, userId, async (transaction) => {
        return (
          await sql<MembershipRoleRow>`
            select tm.id as membership_id, mr.code as role
            from tenant_memberships tm
            left join membership_role_assignments mra
              on mra.tenant_id = tm.tenant_id and mra.membership_id = tm.id
            left join membership_roles mr on mr.tenant_id = mra.tenant_id and mr.id = mra.role_id
            where tm.tenant_id = ${tenantId}::uuid
              and tm.user_id = ${userId}::uuid and tm.status = 'active'
          `.execute(transaction)
        ).rows;
      })
      .finally(() => {
        if (this.membershipLookups.get(key) === lookup) this.membershipLookups.delete(key);
      });
    this.membershipLookups.set(key, lookup);
    return lookup;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (!request.activeTenant) throw ProblemException.notFound();
    if (!required.some((role) => request.activeTenant!.roles.includes(role)))
      throw ProblemException.forbidden();
    return true;
  }
}
