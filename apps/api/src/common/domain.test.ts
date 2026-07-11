import { describe, expect, it } from 'vitest';
import {
  attemptEtagHash,
  canonicalJson,
  createOpaqueRefreshToken,
  nextSubmissionRevision,
  parseOpaqueRefreshToken,
  signCsrfToken,
  strongAttemptEtag,
  verifyCsrfToken,
} from './domain.js';

describe('domain security primitives', () => {
  it('canonicalizes object keys recursively', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });

  it('creates an opaque refresh token whose secret is never the stored value', () => {
    const sessionId = '0198a352-01be-75a6-8e96-8ce78921799a';
    const issued = createOpaqueRefreshToken(sessionId);
    const parsed = parseOpaqueRefreshToken(issued.token);
    expect(parsed).toEqual({ sessionId, hash: issued.hash });
    expect(issued.hash).not.toContain(sessionId);
    expect(parseOpaqueRefreshToken('invalid')).toBeNull();
  });

  it('signs expiring CSRF values and detects tampering', () => {
    const secret = 'x'.repeat(32);
    const issued = signCsrfToken(secret, 60);
    expect(verifyCsrfToken(secret, issued.token)).toBe(true);
    expect(verifyCsrfToken(secret, `${issued.token}x`)).toBe(false);
    expect(verifyCsrfToken(secret, issued.token, issued.expiresAt.getTime() + 1)).toBe(false);
  });

  it('uses strong SHA-256 attempt ETags', () => {
    const attemptId = '0198a352-01be-75a6-8e96-8ce78921799a';
    const hash = attemptEtagHash(attemptId, 4, 'a'.repeat(64));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(strongAttemptEtag(attemptId, 4, 'a'.repeat(64))).toBe(`"${hash}"`);
  });
});

describe('returned-attempt submission revisions', () => {
  it('increments only immutable submission revision', () => {
    const attemptNumber = 2;
    const submissionRevision = nextSubmissionRevision(3);
    expect(attemptNumber).toBe(2);
    expect(submissionRevision).toBe(4);
  });

  it('rejects invalid revision input', () => {
    expect(() => nextSubmissionRevision(-1)).toThrow(RangeError);
  });
});
