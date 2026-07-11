import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { ProblemDetails } from '@english/shared';
import type { Response } from 'express';
import type { ZodType } from 'zod';
import { captureUnexpectedError } from '../observability.js';
import type { ApiRequest } from './request.js';

export class ProblemException extends HttpException {
  readonly problem: ProblemDetails;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: string,
    title: string,
    detail?: string,
    headers: Readonly<Record<string, string>> = {},
  ) {
    const problem: ProblemDetails = {
      type: `https://api.example.cn/problems/${code.replaceAll('_', '-')}`,
      title,
      status,
      code,
      ...(detail === undefined ? {} : { detail }),
    };
    super(problem, status);
    this.problem = problem;
    this.headers = headers;
  }

  static badRequest(code: string, detail: string): ProblemException {
    return new ProblemException(400, code, '请求参数无效', detail);
  }

  static unauthorized(code = 'unauthorized', detail = '身份凭证无效或已过期。'): ProblemException {
    return new ProblemException(401, code, '未认证', detail);
  }

  static forbidden(code = 'forbidden', detail = '当前成员无权执行此操作。'): ProblemException {
    return new ProblemException(403, code, '禁止访问', detail);
  }

  static notFound(detail = '请求的资源不存在或不可访问。'): ProblemException {
    return new ProblemException(404, 'not_found', '未找到资源', detail);
  }

  static conflict(code: string, detail: string, retryAfter?: number): ProblemException {
    return new ProblemException(
      409,
      code,
      '请求与当前状态冲突',
      detail,
      retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) },
    );
  }

  static preconditionFailed(currentEtag?: string): ProblemException {
    return new ProblemException(
      412,
      'etag_mismatch',
      '草稿版本已变化',
      'If-Match 与当前草稿版本不一致，请加载最新草稿后合并。',
      currentEtag === undefined ? {} : { ETag: currentEtag },
    );
  }

  static preconditionRequired(): ProblemException {
    return new ProblemException(428, 'if_match_required', '缺少前置条件', '必须提供 If-Match。');
  }
}

export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw ProblemException.badRequest('validation_error', detail);
  }
  return result.data;
}

export function mapDatabaseProblem(exception: unknown): ProblemException | undefined {
  if (!exception || typeof exception !== 'object') return undefined;
  const code = (exception as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  if (code === '23505')
    return ProblemException.conflict('unique_conflict', '资源已存在或与现有记录冲突。');
  if (code === '23503')
    return ProblemException.conflict(
      'relationship_conflict',
      '资源关系不存在或当前状态不允许该引用。',
    );
  if (code === '23514' || code === '22007')
    return ProblemException.badRequest('constraint_violation', '请求数据不符合业务约束。');
  if (code === '22P02' || code === '02000' || code === '42501') return ProblemException.notFound();
  if (code === '40001' || code === '40P01')
    return ProblemException.conflict('transaction_retry', '并发事务冲突，请稍后重试。', 1);
  if (code === '55000')
    return ProblemException.conflict('immutable_resource', '已发布或已终止的资源不可修改。');
  return undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<ApiRequest>();
    const normalized =
      exception instanceof ProblemException
        ? exception
        : (mapDatabaseProblem(exception) ?? exception);
    const status =
      normalized instanceof HttpException
        ? normalized.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const unexpected = !(normalized instanceof HttpException);
    if (unexpected) {
      captureUnexpectedError(exception, {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: status,
      });
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          event: 'http.exception',
          request_id: request.requestId,
          status_code: status,
          error: normalized instanceof Error ? normalized.message : String(normalized),
          stack: normalized instanceof Error ? normalized.stack : undefined,
        })}\n`,
      );
    }
    const source = normalized instanceof ProblemException ? normalized.problem : undefined;
    const problem: ProblemDetails = source ?? {
      type: 'https://api.example.cn/problems/internal-error',
      title: status === 500 ? '服务器内部错误' : '请求失败',
      status,
      code: status === 500 ? 'internal_error' : 'http_error',
      ...(status === 500
        ? {}
        : { detail: normalized instanceof Error ? normalized.message : String(normalized) }),
    };
    if (normalized instanceof ProblemException) {
      for (const [name, value] of Object.entries(normalized.headers))
        response.setHeader(name, value);
    }
    response
      .status(status)
      .type('application/problem+json')
      .send({ ...problem, instance: request.originalUrl, requestId: request.requestId });
  }
}
