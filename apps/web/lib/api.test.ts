import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  createIdempotencyKey,
  normalizeProblem,
  resolveApiRequestUrl,
  tenantPath,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('keeps local Next.js routes on the web origin', () => {
    expect(resolveApiRequestUrl('/api/local-reading?grade=6', 'http://localhost:4000')).toBe(
      '/api/local-reading?grade=6',
    );
    expect(resolveApiRequestUrl('/api/v1/auth/session', 'http://localhost:4000')).toBe(
      'http://localhost:4000/api/v1/auth/session',
    );
  });

  it('refreshes an expired CSRF token once and retries the write request', async () => {
    const responses = [
      Response.json({ token: 'stale-token' }, { headers: { 'Set-Cookie': 'csrf_token=stale' } }),
      Response.json(
        {
          type: 'https://example.com/problems/csrf-failed',
          title: '禁止访问',
          status: 403,
          code: 'csrf_failed',
        },
        { status: 403 },
      ),
      Response.json({ token: 'fresh-token' }, { headers: { 'Set-Cookie': 'csrf_token=fresh' } }),
      new Response(null, { status: 204 }),
    ];
    const observedCsrfTokens: Array<string | null> = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        observedCsrfTokens.push(new Headers(init.headers).get('X-CSRF-Token'));
      }
      const response = responses.shift();
      if (!response) throw new Error('Unexpected fetch call');
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/api/v1/auth/login', {
        method: 'POST',
        json: { identifier: 'learner@example.com', password: 'not-a-real-password' },
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(observedCsrfTokens).toEqual(['stale-token', 'fresh-token']);
  });
});
