import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, sha256 } from './domain.js';
import { ProblemException } from './problem.js';
import { AppConfig } from '../config.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 512;

type CursorKey = string | number | boolean | null | CursorKey[] | { [key: string]: CursorKey };

interface CursorEnvelope {
  v: 1;
  scope: string;
  filters: string;
  key: CursorKey;
}

export interface CursorContext {
  scope: string;
  filters: Record<string, unknown>;
}

export interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

function invalidCursor(): ProblemException {
  return ProblemException.badRequest('invalid_cursor', '游标无效、已过期或与当前查询条件不匹配。');
}

@Injectable()
export class CursorService {
  private readonly secret: string;

  constructor(@Inject(AppConfig) config: AppConfig) {
    this.secret = config.csrfSecret;
  }

  pageSize(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_PAGE_SIZE;
    if (!/^[1-9]\d*$/.test(raw)) {
      throw ProblemException.badRequest('invalid_page_size', 'pageSize 必须是 1 到 100 的整数。');
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > MAX_PAGE_SIZE) {
      throw ProblemException.badRequest('invalid_page_size', 'pageSize 必须是 1 到 100 的整数。');
    }
    return value;
  }

  read<T>(
    raw: string | undefined,
    context: CursorContext,
    validate: (key: unknown) => key is T,
  ): T | null {
    if (raw === undefined) return null;
    if (!raw || raw.length > MAX_CURSOR_LENGTH) throw invalidCursor();
    const parts = raw.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidCursor();
    const [encoded, signature] = parts;
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature))
      throw invalidCursor();
    const expected = this.sign(encoded);
    const actualBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw invalidCursor();
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    } catch {
      throw invalidCursor();
    }
    if (!this.isEnvelope(envelope)) throw invalidCursor();
    if (envelope.scope !== context.scope || envelope.filters !== this.filterHash(context.filters)) {
      throw invalidCursor();
    }
    if (!validate(envelope.key)) throw invalidCursor();
    return envelope.key;
  }

  page<T>(
    rows: T[],
    pageSize: number,
    context: CursorContext,
    keyOf: (row: T) => CursorKey,
  ): CursorPage<T> {
    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    const last = items.at(-1);
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore && last ? this.write(context, keyOf(last)) : null,
      },
    };
  }

  private write(context: CursorContext, key: CursorKey): string {
    const envelope: CursorEnvelope = {
      v: 1,
      scope: context.scope,
      filters: this.filterHash(context.filters),
      key,
    };
    const encoded = Buffer.from(canonicalJson(envelope), 'utf8').toString('base64url');
    const cursor = `${encoded}.${this.sign(encoded)}`;
    if (cursor.length > MAX_CURSOR_LENGTH)
      throw new Error('Cursor payload exceeds the OpenAPI maximum length');
    return cursor;
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.secret).update(encoded).digest('base64url');
  }

  private filterHash(filters: Record<string, unknown>): string {
    return sha256(canonicalJson(filters));
  }

  private isEnvelope(value: unknown): value is CursorEnvelope {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<CursorEnvelope>;
    return (
      candidate.v === 1 &&
      typeof candidate.scope === 'string' &&
      typeof candidate.filters === 'string' &&
      candidate.filters.length === 64 &&
      Object.hasOwn(candidate, 'key')
    );
  }
}

export const cursorKey = {
  strings(length: number) {
    return (value: unknown): value is string[] =>
      Array.isArray(value) &&
      value.length === length &&
      value.every((item) => typeof item === 'string');
  },
  dateAndUuid(value: unknown): value is [string, string] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Number.isFinite(Date.parse(value[0])) &&
      typeof value[1] === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[1])
    );
  },
  stringAndUuid(value: unknown): value is [string, string] {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[1])
    );
  },
  taskDueOrder(value: unknown): value is [0 | 1, string | null, string, string] {
    return (
      Array.isArray(value) &&
      value.length === 4 &&
      (value[0] === 0 || value[0] === 1) &&
      ((value[0] === 0 && typeof value[1] === 'string' && Number.isFinite(Date.parse(value[1]))) ||
        (value[0] === 1 && value[1] === null)) &&
      typeof value[2] === 'string' &&
      Number.isFinite(Date.parse(value[2])) &&
      typeof value[3] === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[3])
    );
  },
};
