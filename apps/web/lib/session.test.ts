import { describe, expect, it } from 'vitest';
import { chooseTenantId, landingRouteForRoles, normalizeTenantMemberships } from './session';

describe('workspace session bootstrap', () => {
  const memberships = [
    {
      membershipId: 'membership-active',
      tenant: { id: 'tenant-real', name: '真实机构', slug: 'real-tenant' },
      roles: ['teacher'] as const,
      status: 'active' as const,
    },
    {
      membershipId: 'membership-suspended',
      tenant: { id: 'tenant-disabled', name: '停用机构', slug: 'disabled-tenant' },
      roles: ['student'] as const,
      status: 'suspended' as const,
    },
  ];

  it('maps only active API memberships and never injects demo tenants', () => {
    const tenants = normalizeTenantMemberships(memberships);
    expect(tenants).toEqual([
      {
        id: 'tenant-real',
        name: '真实机构',
        slug: 'real-tenant',
        membershipId: 'membership-active',
        roles: ['teacher'],
      },
    ]);
  });

  it('keeps a valid persisted tenant and rejects stale tenant ids', () => {
    const tenants = normalizeTenantMemberships(memberships);
    expect(chooseTenantId(tenants, 'tenant-real')).toBe('tenant-real');
    expect(chooseTenantId(tenants, 'demo-tenant')).toBe('tenant-real');
  });

  it('routes seed roles to the correct workspace', () => {
    expect(landingRouteForRoles(['student'])).toBe('/student');
    expect(landingRouteForRoles(['teacher'])).toBe('/teacher');
    expect(landingRouteForRoles(['owner'])).toBe('/admin');
    expect(landingRouteForRoles(['content_editor'])).toBe('/admin/content');
    expect(landingRouteForRoles(['owner', 'teacher'])).toBe('/admin');
  });
});
