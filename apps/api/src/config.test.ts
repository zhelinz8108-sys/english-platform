import { describe, expect, it } from 'vitest';
import { environmentSchema, resolveS3PublicEndpoint } from './config.js';

const base = {
  DATABASE_URL: 'postgres://app:secret@postgres:5432/english',
  JWT_ACCESS_SECRET: 'a-secret-that-is-at-least-thirty-two-characters',
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'english-platform-private',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

describe('S3 endpoint configuration', () => {
  it('uses bounded operational database defaults and accepts explicit overrides', () => {
    const defaults = environmentSchema.parse(base);
    expect(defaults.DATABASE_POOL_MAX).toBe(20);
    expect(defaults.DATABASE_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(defaults.VOCABULARY_ASSESSMENT_SCORING_MODE).toBe('beta');

    const configured = environmentSchema.parse({
      ...base,
      DATABASE_POOL_MAX: '40',
      DATABASE_STATEMENT_TIMEOUT_MS: '30000',
    });
    expect(configured.DATABASE_POOL_MAX).toBe(40);
    expect(configured.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(environmentSchema.safeParse({ ...base, DATABASE_POOL_MAX: '0' }).success).toBe(false);
    expect(environmentSchema.safeParse({ ...base, DATABASE_POOL_MAX: '101' }).success).toBe(false);
    expect(
      environmentSchema.safeParse({ ...base, DATABASE_STATEMENT_TIMEOUT_MS: '0' }).success,
    ).toBe(false);
  });

  it('only accepts the staged vocabulary-scoring feature modes', () => {
    expect(
      environmentSchema.parse({ ...base, VOCABULARY_ASSESSMENT_SCORING_MODE: 'shadow' })
        .VOCABULARY_ASSESSMENT_SCORING_MODE,
    ).toBe('shadow');
    expect(
      environmentSchema.parse({ ...base, VOCABULARY_ASSESSMENT_SCORING_MODE: 'calibrated' })
        .VOCABULARY_ASSESSMENT_SCORING_MODE,
    ).toBe('calibrated');
    expect(
      environmentSchema.safeParse({ ...base, VOCABULARY_ASSESSMENT_SCORING_MODE: 'cat' }).success,
    ).toBe(false);
  });

  it('falls back to the internal endpoint when a public endpoint is omitted', () => {
    const environment = environmentSchema.parse(base);
    expect(resolveS3PublicEndpoint(environment)).toBe('http://minio:9000');
    expect(
      resolveS3PublicEndpoint(environmentSchema.parse({ ...base, S3_PUBLIC_ENDPOINT: '' })),
    ).toBe('http://minio:9000');
  });

  it('accepts a browser-visible public endpoint independently', () => {
    const environment = environmentSchema.parse({
      ...base,
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    });
    expect(resolveS3PublicEndpoint(environment)).toBe('http://localhost:9000');
    expect(environmentSchema.safeParse({ ...base, S3_PUBLIC_ENDPOINT: 'not-a-url' }).success).toBe(
      false,
    );
  });

  it('keeps cookies host-only unless an explicit valid domain is configured', () => {
    expect(environmentSchema.parse(base).COOKIE_DOMAIN).toBeUndefined();
    expect(environmentSchema.parse({ ...base, COOKIE_DOMAIN: '' }).COOKIE_DOMAIN).toBeUndefined();
    expect(environmentSchema.parse({ ...base, COOKIE_DOMAIN: '.example.cn' }).COOKIE_DOMAIN).toBe(
      '.example.cn',
    );
    expect(
      environmentSchema.safeParse({ ...base, COOKIE_DOMAIN: 'https://example.cn' }).success,
    ).toBe(false);
  });

  it('fails fast on unsafe production cookie and placeholder-secret settings', () => {
    expect(
      environmentSchema.safeParse({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })
        .success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters',
      }).success,
    ).toBe(false);
    expect(
      environmentSchema.safeParse({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' })
        .success,
    ).toBe(true);
  });
});
