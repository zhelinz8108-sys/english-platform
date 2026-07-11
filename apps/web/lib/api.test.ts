import { describe, expect, it } from 'vitest';
import { createIdempotencyKey, normalizeProblem, tenantPath } from './api';

describe('API client contract helpers', () => {
  it('normalizes RFC 7807 payloads without losing request identity', () => {
    const problem = normalizeProblem({
      type: 'https://example.com/problems/conflict',
      title: '版本冲突',
      status: 409,
      detail: '草稿已在其他位置更新。',
      code: 'DRAFT_REVISION_CONFLICT',
      requestId: 'req-0190',
    });

    expect(problem).toMatchObject({
      title: '版本冲突',
      status: 409,
      code: 'DRAFT_REVISION_CONFLICT',
      requestId: 'req-0190',
    });
  });

  it('creates tenant-scoped paths and command keys', () => {
    expect(tenantPath('tenant id', '/student/dashboard')).toBe(
      '/api/v1/tenants/tenant%20id/student/dashboard',
    );
    expect(createIdempotencyKey('submit')).toMatch(/^submit:/);
  });
});
