import type { TenantRole } from '@english/shared';
import { apiRequest } from './api';
import type { AppTenant, AppUser } from './types';

export const tenantStorageKey = 'english-platform:tenant';

interface CurrentUserResponse {
  id: string;
  email: string;
  displayName: string;
  platformRole: 'none' | 'super_admin';
  createdAt: string;
}

interface TenantMembershipResponse {
  membershipId: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  roles: readonly TenantRole[];
  status: 'invited' | 'active' | 'suspended' | 'left';
}

interface TenantMembershipPageResponse {
  data: TenantMembershipResponse[];
  page: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface WorkspaceSession {
  user: AppUser;
  tenants: AppTenant[];
}

export function normalizeTenantMemberships(memberships: TenantMembershipResponse[]): AppTenant[] {
  return memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => ({
      id: membership.tenant.id,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      membershipId: membership.membershipId,
      roles: [...membership.roles],
    }));
}

export function chooseTenantId(
  tenants: AppTenant[],
  persistedTenantId: string | null,
): string | null {
  if (persistedTenantId && tenants.some((tenant) => tenant.id === persistedTenantId)) {
    return persistedTenantId;
  }
  return tenants[0]?.id ?? null;
}

export function landingRouteForRoles(roles: TenantRole[]): string {
  if (roles.includes('owner') || roles.includes('admin')) {
    return '/admin';
  }
  if (roles.includes('content_editor')) {
    return '/admin/content';
  }
  if (roles.includes('teacher')) {
    return '/teacher';
  }
  if (roles.includes('student')) {
    return '/student';
  }
  return '/login?reason=no-workspace';
}

export async function loadWorkspaceSession(): Promise<WorkspaceSession> {
  // Deliberately sequential: if access cookies expire, a single refresh rotation
  // completes before the second request and avoids a refresh-token reuse race.
  const userResponse = await apiRequest<CurrentUserResponse>('/api/v1/me');
  const memberships = await apiRequest<TenantMembershipPageResponse>(
    '/api/v1/me/tenants?pageSize=100',
  );

  return {
    user: {
      id: userResponse.id,
      displayName: userResponse.displayName,
      email: userResponse.email,
    },
    tenants: normalizeTenantMemberships(memberships.data),
  };
}

export function persistTenantSelection(tenantId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (tenantId) {
    window.localStorage.setItem(tenantStorageKey, tenantId);
  } else {
    window.localStorage.removeItem(tenantStorageKey);
  }
}
