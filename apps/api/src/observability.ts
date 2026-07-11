type SentrySdk = typeof import('@sentry/node');
type OpenTelemetrySdk = import('@opentelemetry/sdk-node').NodeSDK;

const DEFAULT_SERVICE_NAME = 'english-platform-api';
const DEFAULT_ENVIRONMENT = 'development';
const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

let sentrySdk: SentrySdk | undefined;
let openTelemetrySdk: OpenTelemetrySdk | undefined;

export interface ObservabilityState {
  sentryConfigured: boolean;
  otelConfigured: boolean;
  serviceName: string;
  environment: string;
}

export interface UnexpectedErrorContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function getObservabilityState(environment: NodeJS.ProcessEnv): ObservabilityState {
  return {
    sentryConfigured: nonEmpty(environment.SENTRY_DSN) !== undefined,
    otelConfigured:
      nonEmpty(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) !== undefined ||
      nonEmpty(environment.OTEL_EXPORTER_OTLP_ENDPOINT) !== undefined,
    serviceName: nonEmpty(environment.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    environment:
      nonEmpty(environment.SENTRY_ENVIRONMENT) ??
      nonEmpty(environment.APP_ENV) ??
      nonEmpty(environment.NODE_ENV) ??
      DEFAULT_ENVIRONMENT,
  };
}

function getTraceEndpoint(environment: NodeJS.ProcessEnv): string | undefined {
  const explicit = nonEmpty(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (explicit) return explicit;
  const base = nonEmpty(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/v1/traces`;
}

/** Must run before importing Nest, AppModule, or instrumented libraries. */
export async function initializeObservability(
  environment: NodeJS.ProcessEnv,
): Promise<ObservabilityState> {
  const state = getObservabilityState(environment);

  if (state.sentryConfigured) {
    const sdk = await import('@sentry/node');
    sdk.init({
      dsn: nonEmpty(environment.SENTRY_DSN),
      environment: state.environment,
      release: nonEmpty(environment.SENTRY_RELEASE),
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
    });
    sentrySdk = sdk;
  }

  const traceEndpoint = getTraceEndpoint(environment);
  if (traceEndpoint) {
    const [sdkModule, exporterModule, instrumentationModule, resourcesModule, conventionsModule] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/auto-instrumentations-node'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
      ]);
    const sdk = new sdkModule.NodeSDK({
      resource: resourcesModule.resourceFromAttributes({
        [conventionsModule.ATTR_SERVICE_NAME]: state.serviceName,
        [conventionsModule.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: state.environment,
      }),
      traceExporter: new exporterModule.OTLPTraceExporter({ url: traceEndpoint }),
      instrumentations: [
        instrumentationModule.getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });
    sdk.start();
    openTelemetrySdk = sdk;
  }

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'observability.initialized',
      sentry_configured: state.sentryConfigured,
      otel_configured: state.otelConfigured,
      service_name: state.serviceName,
      environment: state.environment,
    })}\n`,
  );
  return state;
}

export function captureUnexpectedError(error: unknown, context: UnexpectedErrorContext): void {
  if (!sentrySdk) return;
  sentrySdk.withScope((scope) => {
    if (context.requestId) scope.setTag('request_id', context.requestId);
    if (context.method) scope.setTag('http.request.method', context.method);
    if (context.statusCode) scope.setTag('http.response.status_code', String(context.statusCode));
    if (context.path) scope.setContext('request', { path: context.path });
    sentrySdk?.captureException(error);
  });
}

export async function shutdownObservability(): Promise<void> {
  const telemetry = openTelemetrySdk;
  const sentry = sentrySdk;
  openTelemetrySdk = undefined;
  sentrySdk = undefined;
  const results = await Promise.allSettled([
    telemetry?.shutdown() ?? Promise.resolve(),
    sentry?.flush(SENTRY_FLUSH_TIMEOUT_MS) ?? Promise.resolve(true),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'observability.shutdown_failed',
          error: result.reason instanceof Error ? result.reason.message : 'unknown_error',
        })}\n`,
      );
    }
  }
}
