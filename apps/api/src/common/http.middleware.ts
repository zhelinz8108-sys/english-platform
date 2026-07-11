import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { v7 as uuidv7, validate as validateUuid } from 'uuid';
import type { ApiRequest } from './request.js';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: ApiRequest, response: Response, next: NextFunction): void {
    const incoming = request.header('X-Request-Id');
    request.requestId = incoming && validateUuid(incoming) ? incoming : uuidv7();
    response.setHeader('X-Request-Id', request.requestId);
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      process.stdout.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: response.statusCode >= 500 ? 'error' : 'info',
          event: 'http.request.completed',
          request_id: request.requestId,
          method: request.method,
          path: request.originalUrl.split('?')[0],
          status_code: response.statusCode,
          duration_ms: Number(durationMs.toFixed(2)),
        })}\n`,
      );
    });
    next();
  }
}
