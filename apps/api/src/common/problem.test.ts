import { HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureUnexpectedError } from '../observability.js';
import { mapDatabaseProblem, ProblemDetailsFilter, ProblemException } from './problem.js';

vi.mock('../observability.js', () => ({ captureUnexpectedError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PostgreSQL problem mapping', () => {
  it.each([
    ['23505', 409, 'unique_conflict'],
    ['23503', 409, 'relationship_conflict'],
    ['23514', 400, 'constraint_violation'],
    ['22007', 400, 'constraint_violation'],
    ['22P02', 404, 'not_found'],
    ['40001', 409, 'transaction_retry'],
    ['40P01', 409, 'transaction_retry'],
    ['55000', 409, 'immutable_resource'],
  ] as const)('maps SQLSTATE %s without exposing database details', (code, status, problemCode) => {
    const problem = mapDatabaseProblem({
      code,
      constraint: 'sensitive_constraint',
      detail: 'sensitive SQL detail',
    });
    expect(problem?.getStatus()).toBe(status);
    expect(problem?.problem.code).toBe(problemCode);
    expect(JSON.stringify(problem?.problem)).not.toContain('sensitive');
  });
});

describe('ProblemDetailsFilter error capture', () => {
  function createHost(): ArgumentsHost {
    const response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const request = {
      requestId: 'request-1',
      method: 'GET',
      path: '/test',
      originalUrl: '/test?redacted=true',
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
        getNext: vi.fn(),
      }),
    } as unknown as ArgumentsHost;
  }

  it('does not capture expected application, database, or HTTP errors', () => {
    const filter = new ProblemDetailsFilter();
    filter.catch(ProblemException.badRequest('invalid', 'invalid request'), createHost());
    filter.catch({ code: '23505', detail: 'database detail' }, createHost());
    filter.catch(new HttpException('bad request', 400), createHost());

    expect(captureUnexpectedError).not.toHaveBeenCalled();
  });

  it('captures an unexpected exception with query-free request context', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const error = new Error('unexpected');
    new ProblemDetailsFilter().catch(error, createHost());

    expect(captureUnexpectedError).toHaveBeenCalledWith(error, {
      requestId: 'request-1',
      method: 'GET',
      path: '/test',
      statusCode: 500,
    });
  });
});
