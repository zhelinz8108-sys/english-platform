import {
  captureUnexpectedError,
  initializeObservability,
  shutdownObservability,
} from './observability.js';

async function bootstrap(): Promise<void> {
  await initializeObservability(process.env);
  await import('reflect-metadata');
  const [
    { NestFactory },
    { AppModule },
    { AppConfig },
    { default: cookieParser },
    { default: helmet },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./config.js'),
    import('cookie-parser'),
    import('helmet'),
  ]);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfig);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.values.WEB_ORIGIN, credentials: true });
  await app.listen(config.values.PORT, '0.0.0.0');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'api.stopping',
        signal,
      })}\n`,
    );
    await app.close();
    await shutdownObservability();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'api.started',
      port: config.values.PORT,
    })}\n`,
  );
}

void bootstrap().catch(async (error: unknown) => {
  captureUnexpectedError(error, { statusCode: 500 });
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'api.start_failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    })}\n`,
  );
  await shutdownObservability();
  process.exitCode = 1;
});
