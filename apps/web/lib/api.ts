import type { ProblemDetails } from '@english/shared';

const publicOrigin = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, '') ?? '';
let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;
let refreshPromise: Promise<boolean> | null = null;

export class ApiProblemError extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiProblemError';
    this.problem = problem;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  retryAuthentication?: boolean;
  onResponse?: (response: Response) => void;
}

export function isDemoMode(): boolean {
  const configured = process.env.NEXT_PUBLIC_DEMO_MODE;
  return configured === 'true';
}

export function normalizeProblem(value: unknown, status = 500): ProblemDetails {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.title === 'string') {
      const problem: ProblemDetails = {
        type: typeof candidate.type === 'string' ? candidate.type : 'about:blank',
        title: candidate.title,
        status: typeof candidate.status === 'number' ? candidate.status : status,
      };
      if (typeof candidate.detail === 'string') {
        problem.detail = candidate.detail;
      }
      if (typeof candidate.code === 'string') {
        problem.code = candidate.code;
      }
      if (typeof candidate.requestId === 'string') {
        problem.requestId = candidate.requestId;
      }
      return problem;
    }
  }

  return {
    type: 'about:blank',
    title: '请求未完成',
    status,
    detail: status >= 500 ? '服务暂时不可用，请稍后重试。' : '请检查输入后重试。',
  };
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  const contentType = response.headers.get('content-type') ?? '';
  if (
    contentType.includes('application/problem+json') ||
    contentType.includes('application/json')
  ) {
    try {
      return normalizeProblem(await response.json(), response.status);
    } catch {
      return normalizeProblem(null, response.status);
    }
  }
  return normalizeProblem(null, response.status);
}

async function bootstrapCsrf(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }
  if (csrfPromise) {
    return csrfPromise;
  }

  csrfPromise = fetch(publicOrigin + '/api/v1/auth/csrf', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new ApiProblemError(await readProblem(response));
      }
      const payload = (await response.json()) as { token: string };
      csrfToken = payload.token;
      return payload.token;
    })
    .finally(() => {
      csrfPromise = null;
    });

  return csrfPromise;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const token = await bootstrapCsrf();
        const response = await fetch(publicOrigin + '/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'X-CSRF-Token': token,
          },
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRF-Token', await bootstrapCsrf());
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  if (options.ifMatch) {
    headers.set('If-Match', options.ifMatch);
  }

  const requestInit: RequestInit = {
    ...options,
    method,
    credentials: 'include',
    headers,
  };
  delete (requestInit as Partial<ApiRequestOptions>).json;
  delete (requestInit as Partial<ApiRequestOptions>).idempotencyKey;
  delete (requestInit as Partial<ApiRequestOptions>).ifMatch;
  delete (requestInit as Partial<ApiRequestOptions>).retryAuthentication;
  delete (requestInit as Partial<ApiRequestOptions>).onResponse;
  if (options.json !== undefined) {
    requestInit.body = JSON.stringify(options.json);
  }

  let response = await fetch(publicOrigin + path, requestInit);
  if (
    response.status === 401 &&
    options.retryAuthentication !== false &&
    !path.startsWith('/api/v1/auth/')
  ) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await fetch(publicOrigin + path, requestInit);
    }
  }

  if (!response.ok) {
    throw new ApiProblemError(await readProblem(response));
  }
  options.onResponse?.(response);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function createIdempotencyKey(scope: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return scope + ':' + randomPart;
}

export function tenantPath(tenantId: string, suffix: string): string {
  return '/api/v1/tenants/' + encodeURIComponent(tenantId) + suffix;
}

export const authApi = {
  async login(email: string, password: string): Promise<void> {
    await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      json: { email, password },
      retryAuthentication: false,
    });
  },
  async logout(): Promise<void> {
    await apiRequest('/api/v1/auth/session', {
      method: 'DELETE',
      retryAuthentication: false,
    });
  },
};
