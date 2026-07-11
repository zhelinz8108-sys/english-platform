import pino from 'pino';
import { config } from './config.js';

const developmentTransport =
  config.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : null;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'english-platform-worker', environment: config.nodeEnv },
  redact: {
    paths: ['password', 'token', 'refreshToken', '*.password', '*.token', '*.responses'],
    censor: '[REDACTED]',
  },
  ...(developmentTransport ? { transport: developmentTransport } : {}),
});
