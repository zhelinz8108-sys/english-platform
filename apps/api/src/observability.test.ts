import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getObservabilityState,
  initializeObservability,
  shutdownObservability,
} from './observability.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await shutdownObservability();
});

describe('observability configuration', () => {
  it('does not start an SDK when neither destination is configured', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const state = await initializeObservability({});

    expect(state).toEqual({
      sentryConfigured: false,
      otelConfigured: false,
      serviceName: 'english-platform-api',
      environment: 'development',
    });
    expect(write).toHaveBeenCalledOnce();
  });

  it('recognizes standard trace and deployment settings without exposing destinations', () => {
    const state = getObservabilityState({
      SENTRY_DSN: 'https://public@example.invalid/1',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example.invalid/v1/traces',
      OTEL_SERVICE_NAME: 'custom-api',
      SENTRY_ENVIRONMENT: 'staging',
    });

    expect(state).toEqual({
      sentryConfigured: true,
      otelConfigured: true,
      serviceName: 'custom-api',
      environment: 'staging',
    });
    expect(JSON.stringify(state)).not.toContain('example.invalid');
  });

  it('treats blank destinations as disabled', () => {
    expect(
      getObservabilityState({
        SENTRY_DSN: '   ',
        OTEL_EXPORTER_OTLP_ENDPOINT: ' ',
      }),
    ).toMatchObject({ sentryConfigured: false, otelConfigured: false });
  });
});
