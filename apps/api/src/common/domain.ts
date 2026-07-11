import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AttemptState } from '@english/shared';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestHash(method: string, operation: string, body: unknown): string {
  return sha256(`${method.toUpperCase()}\n${operation}\n${canonicalJson(body)}`);
}

export function createOpaqueRefreshToken(sessionId: string): { token: string; hash: string } {
  const token = `${sessionId}.${randomBytes(48).toString('base64url')}`;
  return { token, hash: sha256(token) };
}

export function parseOpaqueRefreshToken(token: string): { sessionId: string; hash: string } | null {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  return { sessionId: token.slice(0, separator), hash: sha256(token) };
}

export function signCsrfToken(
  secret: string,
  lifetimeSeconds = 3_600,
): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(Date.now() + lifetimeSeconds * 1_000);
  const payload = `${expiresAt.getTime()}.${randomBytes(32).toString('base64url')}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifyCsrfToken(secret: string, token: string, now = Date.now()): boolean {
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return false;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!constantTimeEqual(signature, expected)) return false;
  const expiresAt = Number(payload.slice(0, payload.indexOf('.')));
  return Number.isFinite(expiresAt) && expiresAt >= now;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function strongAttemptEtag(
  attemptId: string,
  revision: number,
  responseHash: string,
): string {
  return `"${attemptEtagHash(attemptId, revision, responseHash)}"`;
}

export function attemptEtagHash(attemptId: string, revision: number, responseHash: string): string {
  return sha256(`${attemptId}:${revision}:${responseHash}`);
}

export function nextSubmissionRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0)
    throw new RangeError('invalid submission revision');
  return current + 1;
}

export function canResumeReturnedAttempt(state: AttemptState): boolean {
  return state === 'returned';
}

export function assertAttemptMaySubmit(state: AttemptState): void {
  if (state !== 'in_progress') throw new Error(`attempt in ${state} cannot be submitted`);
}
