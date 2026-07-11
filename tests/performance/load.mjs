import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const virtualUsers = Number(
  process.env.LOAD_VIRTUAL_USERS ?? process.env.LOAD_CONCURRENCY ?? 1_000,
);
const maxInFlight = Number(process.env.LOAD_MAX_IN_FLIGHT ?? 100);
const autosaveIterations = Number(process.env.AUTOSAVE_ITERATIONS ?? 40);
const apiP95TargetMs = Number(process.env.API_P95_TARGET_MS ?? 500);
const autosaveP95TargetMs = Number(process.env.AUTOSAVE_P95_TARGET_MS ?? 300);

class Client {
  cookies = new Map();
  csrf = '';

  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (this.cookies.size) headers.set('cookie', this.cookieHeader());
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.mutate) {
      headers.set('x-csrf-token', this.csrf);
      headers.set('origin', webOrigin);
      headers.set('sec-fetch-site', 'same-site');
    }
    const started = performance.now();
    const response = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const elapsedMs = performance.now() - started;
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
    }
    return { response, body, elapsedMs };
  }

  async login() {
    const csrf = await this.request('/api/v1/auth/csrf');
    this.csrf = csrf.body.token;
    await this.request('/api/v1/auth/login', {
      method: 'POST',
      mutate: true,
      body: { email: 'student@example.test', password: 'Demo123!' },
    });
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function runVirtualUsers(total, inFlightLimit, operation) {
  assert.ok(Number.isInteger(total) && total > 0, 'LOAD_VIRTUAL_USERS must be positive');
  assert.ok(
    Number.isInteger(inFlightLimit) && inFlightLimit > 0,
    'LOAD_MAX_IN_FLIGHT must be positive',
  );
  let nextUser = 0;
  const results = new Array(total);
  const workers = Array.from({ length: Math.min(total, inFlightLimit) }, async () => {
    while (true) {
      const userIndex = nextUser;
      nextUser += 1;
      if (userIndex >= total) return;
      results[userIndex] = await operation(userIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

const client = new Client();
await client.login();
const tenants = await client.request('/api/v1/me/tenants');
const tenantId = tenants.body.data[0]?.tenant.id;
assert.ok(tenantId);
const taskPath = `/api/v1/tenants/${tenantId}/student/task-items`;

const listLatencies = [];
const listStatuses = await runVirtualUsers(virtualUsers, maxInFlight, async () => {
  const result = await client.request(`${taskPath}?pageSize=20`);
  listLatencies.push(result.elapsedMs);
  return result.response.status;
});
assert.ok(listStatuses.every((status) => status === 200));

const tasks = await client.request(taskPath);
const objective = tasks.body.data.find((item) => item.kind !== 'writing');
assert.ok(objective);
let detail = (await client.request(`${taskPath}/${objective.id}`)).body;
let attempt = detail.currentAttempt;
if (!attempt) {
  attempt = (
    await client.request(`${taskPath}/${objective.id}/attempts`, {
      method: 'POST',
      mutate: true,
      headers: { 'idempotency-key': randomUUID() },
      body: { intent: 'start', clientStartedAt: new Date().toISOString() },
    })
  ).body;
} else if (['completed', 'cancelled'].includes(attempt.state)) {
  attempt = (
    await client.request(`${taskPath}/${objective.id}/attempts`, {
      method: 'POST',
      mutate: true,
      headers: { 'idempotency-key': randomUUID() },
      body: { intent: 'retry', clientStartedAt: new Date().toISOString() },
    })
  ).body;
}
assert.equal(attempt.state, 'in_progress');
detail = (await client.request(`${taskPath}/${objective.id}`)).body;
const questionVersionId = detail.taskSnapshot.questions[0]?.questionVersionId;
assert.ok(questionVersionId);

const attemptPath = `/api/v1/tenants/${tenantId}/student/attempts/${attempt.id}`;
let current = await client.request(attemptPath);
let etag = current.response.headers.get('etag');
let revision = Number(current.body.attempt.revision);
assert.ok(etag);
const autosaveLatencies = [];
for (let index = 0; index < autosaveIterations; index += 1) {
  const saved = await client.request(`${attemptPath}/draft`, {
    method: 'PATCH',
    mutate: true,
    headers: { 'if-match': etag },
    body: {
      baseRevision: revision,
      answers: [{ questionVersionId, value: index % 2 === 0 ? 'a' : 'b' }],
    },
  });
  autosaveLatencies.push(saved.elapsedMs);
  revision = Number(saved.body.revision);
  etag = saved.response.headers.get('etag');
  assert.ok(etag);
}

const metrics = {
  virtualUsers,
  maxInFlightRequests: Math.min(virtualUsers, maxInFlight),
  api: {
    successfulRequests: listStatuses.length,
    p50Ms: Number(percentile(listLatencies, 0.5).toFixed(1)),
    p95Ms: Number(percentile(listLatencies, 0.95).toFixed(1)),
    targetP95Ms: apiP95TargetMs,
  },
  autosave: {
    iterations: autosaveLatencies.length,
    p50Ms: Number(percentile(autosaveLatencies, 0.5).toFixed(1)),
    p95Ms: Number(percentile(autosaveLatencies, 0.95).toFixed(1)),
    targetP95Ms: autosaveP95TargetMs,
  },
};

console.log(JSON.stringify(metrics, null, 2));
assert.ok(metrics.api.p95Ms < apiP95TargetMs, `API P95 ${metrics.api.p95Ms}ms exceeded target`);
assert.ok(
  metrics.autosave.p95Ms < autosaveP95TargetMs,
  `Autosave P95 ${metrics.autosave.p95Ms}ms exceeded target`,
);
