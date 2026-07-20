import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);
const integerFromEnvironment = (minimum: number, maximum: number, defaultValue: number) =>
  z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(minimum).max(maximum).default(defaultValue),
  );
const optionalUrl = z.preprocess(emptyAsUndefined, z.url().optional());
const optionalCookieDomain = z.preprocess(
  emptyAsUndefined,
  z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^\.?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i)
    .optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: integerFromEnvironment(1, 100, 20),
    DATABASE_STATEMENT_TIMEOUT_MS: integerFromEnvironment(1, 300_000, 15_000),
    JWT_ACCESS_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: booleanFromString,
    COOKIE_DOMAIN: optionalCookieDomain,
    CSRF_SECRET: z.string().min(32).optional(),
    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: optionalUrl,
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: booleanFromString,
    VOCABULARY_ASSESSMENT_SCORING_MODE: z.enum(['beta', 'shadow', 'calibrated']).default('beta'),
  })
  .superRefine((environment, ctx) => {
    if (environment.NODE_ENV !== 'production') return;
    if (!environment.COOKIE_SECURE)
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', environment.JWT_ACCESS_SECRET],
      ['CSRF_SECRET', environment.CSRF_SECRET],
    ] as const) {
      if (value && /(replace-with|change-?me|example|default)/i.test(value))
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'placeholder secrets are forbidden in production',
        });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function resolveS3PublicEndpoint(
  environment: Pick<Environment, 'S3_ENDPOINT' | 'S3_PUBLIC_ENDPOINT'>,
): string {
  return environment.S3_PUBLIC_ENDPOINT ?? environment.S3_ENDPOINT;
}

@Injectable()
export class AppConfig {
  readonly values: Environment;

  constructor() {
    const parsed = environmentSchema.safeParse(process.env);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid API configuration: ${fields}`);
    }
    this.values = parsed.data;
  }

  get csrfSecret(): string {
    return this.values.CSRF_SECRET ?? this.values.JWT_ACCESS_SECRET;
  }

  get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }

  get s3PublicEndpoint(): string {
    return resolveS3PublicEndpoint(this.values);
  }
}

export { environmentSchema };
