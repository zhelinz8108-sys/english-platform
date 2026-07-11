import type { PlatformRole, TenantRole } from '@english/shared';
import type { Request } from 'express';

export interface AccessPrincipal {
  userId: string;
  sessionId: string;
  platformRole: PlatformRole;
}

export interface ActiveTenant {
  tenantId: string;
  membershipId: string;
  roles: TenantRole[];
}

export interface ApiRequest extends Request {
  requestId: string;
  principal?: AccessPrincipal;
  activeTenant?: ActiveTenant;
}

export function requirePrincipal(request: ApiRequest): AccessPrincipal {
  if (!request.principal) throw new Error('AccessGuard did not populate principal');
  return request.principal;
}

export function requireTenant(request: ApiRequest): ActiveTenant {
  if (!request.activeTenant) throw new Error('TenantGuard did not populate active tenant');
  return request.activeTenant;
}
