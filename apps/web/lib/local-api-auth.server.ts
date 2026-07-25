const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

type FetchLike = typeof fetch;

function problem(status: number, title: string, detail: string): Response {
  return Response.json(
    {
      type: 'about:blank',
      title,
      status,
      detail,
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

function validateSameOrigin(request: Request): Response | null {
  if (safeMethods.has(request.method.toUpperCase())) return null;

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    (origin !== null && origin !== requestOrigin) ||
    (fetchSite !== null && !['same-origin', 'same-site'].includes(fetchSite))
  ) {
    return problem(403, '请求被拒绝', '写入请求未通过同源校验。');
  }
  return null;
}

export async function authorizeLocalApiRequest(
  request: Request,
  fetcher: FetchLike = fetch,
  apiOrigin = process.env.API_ORIGIN?.replace(/\/$/, '') ?? 'http://localhost:4000',
): Promise<Response | null> {
  const originProblem = validateSameOrigin(request);
  if (originProblem) return originProblem;

  const cookie = request.headers.get('cookie');
  if (!cookie?.includes('access_token=')) {
    return problem(401, '需要登录', '请登录后再访问学习内容。');
  }

  try {
    const response = await fetcher(`${apiOrigin}/api/v1/me`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: cookie,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return null;
    if (response.status === 401 || response.status === 403) {
      return problem(401, '登录已过期', '请重新登录后再访问学习内容。');
    }
    return problem(503, '认证服务暂时不可用', '请稍后重试。');
  } catch {
    return problem(503, '认证服务暂时不可用', '请稍后重试。');
  }
}
