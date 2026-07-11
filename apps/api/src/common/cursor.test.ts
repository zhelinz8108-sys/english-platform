import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { CursorService, cursorKey } from './cursor.js';

function service(): CursorService {
  return new CursorService({
    csrfSecret: 'test-secret-with-at-least-thirty-two-characters',
  } as AppConfig);
}

describe('CursorService', () => {
  it('creates a stable signed keyset cursor and reads it in the same query context', () => {
    const cursors = service();
    const context = { scope: 'student.tasks:t1:m1', filters: { workflowState: 'grading' } };
    const page = cursors.page(
      [
        { createdAt: '2026-01-02T00:00:00.000Z', id: 'b' },
        { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' },
      ],
      1,
      context,
      (row) => [row.createdAt, row.id],
    );
    expect(page.items).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    expect(cursors.read(page.page.nextCursor!, context, cursorKey.strings(2))).toEqual([
      '2026-01-02T00:00:00.000Z',
      'b',
    ]);
  });

  it('rejects tampering, a changed scope, and changed filters', () => {
    const cursors = service();
    const context = { scope: 'audit:t1', filters: { action: null } };
    const raw = cursors.page(
      [
        { at: '2026-01-01T00:00:00.000Z', id: 'a' },
        { at: '0', id: 'b' },
      ],
      1,
      context,
      (row) => [row.at, row.id],
    ).page.nextCursor!;
    expect(() => cursors.read(`${raw.slice(0, -1)}x`, context, cursorKey.strings(2))).toThrow();
    expect(() =>
      cursors.read(raw, { ...context, scope: 'audit:t2' }, cursorKey.strings(2)),
    ).toThrow();
    expect(() =>
      cursors.read(raw, { ...context, filters: { action: 'login' } }, cursorKey.strings(2)),
    ).toThrow();
  });

  it('enforces the OpenAPI page-size bounds', () => {
    const cursors = service();
    expect(cursors.pageSize(undefined)).toBe(20);
    expect(cursors.pageSize('100')).toBe(100);
    for (const invalid of ['0', '101', '1.5', '-1', 'abc', '']) {
      expect(() => cursors.pageSize(invalid)).toThrow();
    }
  });
});
