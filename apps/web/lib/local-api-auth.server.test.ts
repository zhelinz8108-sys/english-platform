import { describe, expect, it, vi } from 'vitest';
import { authorizeLocalApiRequest } from './local-api-auth.server';

function request(method = 'GET', headers: Record<string, string> = {}): Request {
  return new Request('https://learn.example.com/api/local-reading?grade=3', {
    method,
    headers,
  });
}

describe('authorizeLocalApiRequest', () => {
  it('rejects anonymous access without calling the API', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await authorizeLocalApiRequest(request(), fetcher);

    expect(response?.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows a session accepted by the API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const response = await authorizeLocalApiRequest(
      request('GET', { cookie: 'access_token=valid' }),
      fetcher,
      'http://api:4000',
    );

    expect(response).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      'http://api:4000/api/v1/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Cookie: 'access_token=valid' }),
      }),
    );
  });

  it('fails closed when the API rejects or cannot verify the session', async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));

    expect(
      (await authorizeLocalApiRequest(request('GET', { cookie: 'access_token=expired' }), rejected))
        ?.status,
    ).toBe(401);
    expect(
      (
        await authorizeLocalApiRequest(
          request('GET', { cookie: 'access_token=unknown' }),
          unavailable,
        )
      )?.status,
    ).toBe(503);
  });

  it('rejects cross-origin write requests before session validation', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await authorizeLocalApiRequest(
      request('POST', {
        cookie: 'access_token=valid',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      fetcher,
    );

    expect(response?.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the configured public origin behind a reverse proxy', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const proxiedRequest = new Request(
      'http://web:3000/api/local-vocabulary-books/toefl-sentences/sentence-assessment',
      {
        method: 'POST',
        headers: {
          cookie: 'access_token=valid',
          origin: 'https://learn.example.com',
          'sec-fetch-site': 'same-origin',
        },
      },
    );

    const response = await authorizeLocalApiRequest(
      proxiedRequest,
      fetcher,
      'http://api:4000',
      'https://learn.example.com/',
    );

    expect(response).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('still rejects a foreign origin when a public origin is configured', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const proxiedRequest = new Request(
      'http://web:3000/api/local-vocabulary-books/toefl-sentences/sentence-assessment',
      {
        method: 'POST',
        headers: {
          cookie: 'access_token=valid',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      },
    );

    const response = await authorizeLocalApiRequest(
      proxiedRequest,
      fetcher,
      'http://api:4000',
      'https://learn.example.com',
    );

    expect(response?.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
