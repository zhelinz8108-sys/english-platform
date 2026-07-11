import { describe, expect, it } from 'vitest';
import {
  resolveStudentTaskItems,
  type ResolvableSource,
  type ResolvableTaskItem,
} from './task-resolution.js';

type SourceType = ResolvableSource['sourceType'];

const source = (
  id: string,
  sourceType: SourceType,
  slotKey = '2026-w28-reading',
  patch: Partial<ResolvableSource> = {},
): ResolvableSource => ({
  id,
  sourceType,
  explicitPriority: 0,
  publishedAt: '2026-07-11T00:00:00Z',
  active: true,
  slotKey,
  availableAt: '2026-07-11T00:00:00Z',
  dueAt: '2026-07-18T00:00:00Z',
  closeAt: null,
  ...patch,
});

const item = (
  id: string,
  sources: ResolvableSource[],
  overrides: ResolvableTaskItem['overrides'] = [],
): ResolvableTaskItem => ({ id, sources, overrides });

describe('task resolution precedence', () => {
  it('applies all five source levels in the fixed 500→100 order', () => {
    const result = resolveStudentTaskItems([
      item('one-occurrence', [
        source('general', 'general'),
        source('exam', 'exam_path'),
        source('class', 'class'),
        source('individual', 'individual'),
        source('admin', 'admin_forced'),
      ]),
    ]);
    expect(result[0]).toMatchObject({
      winningSourceId: 'admin',
      resolutionState: 'active',
      resolutionReason: 'winner',
    });
  });

  it('uses explicit priority before publication time and ID at the same source level', () => {
    const result = resolveStudentTaskItems([
      item('same-level', [
        source('newer', 'class', 'slot', {
          explicitPriority: 1,
          publishedAt: '2026-07-12T00:00:00Z',
        }),
        source('priority', 'class', 'slot', {
          explicitPriority: 2,
          publishedAt: '2026-07-10T00:00:00Z',
        }),
      ]),
    ]);
    expect(result[0]?.winningSourceId).toBe('priority');
  });

  it('uses later publishedAt and then descending ID as stable same-level tie breakers', () => {
    const later = resolveStudentTaskItems([
      item('later', [
        source('z-old', 'class', 'slot', { publishedAt: '2026-07-10T00:00:00Z' }),
        source('a-new', 'class', 'slot', { publishedAt: '2026-07-12T00:00:00Z' }),
      ]),
    ]);
    const idTie = resolveStudentTaskItems([
      item('id-tie', [source('a', 'class'), source('z', 'class')]),
    ]);
    expect(later[0]?.winningSourceId).toBe('a-new');
    expect(idTie[0]?.winningSourceId).toBe('z');
  });

  it('merges multiple sources on one materialized occurrence', () => {
    const result = resolveStudentTaskItems([
      item('same-occurrence', [
        source('general-source', 'general'),
        source('class-source', 'class'),
      ]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      itemId: 'same-occurrence',
      winningSourceId: 'class-source',
      resolutionState: 'active',
    });
  });
});

describe('task resolution overrides and source lifecycle', () => {
  it('replays hide then restore append-only overrides', () => {
    const result = resolveStudentTaskItems([
      item(
        'item',
        [source('s', 'class')],
        [
          { id: 'h', action: 'hide', createdAt: '2026-07-11T00:00:00Z' },
          {
            id: 'r',
            action: 'restore',
            reversesOverrideId: 'h',
            createdAt: '2026-07-11T01:00:00Z',
          },
        ],
      ),
    ]);
    expect(result[0]).toMatchObject({ resolutionState: 'active', resolutionReason: 'winner' });
  });

  it('keeps a non-restored hide hidden', () => {
    const result = resolveStudentTaskItems([
      item(
        'item',
        [source('s', 'class')],
        [{ id: 'h', action: 'hide', createdAt: '2026-07-11T00:00:00Z' }],
      ),
    ]);
    expect(result[0]).toMatchObject({
      resolutionState: 'hidden',
      resolutionReason: 'override_hidden',
    });
  });

  it('marks replace as superseded and can restore the original item', () => {
    const replaced = resolveStudentTaskItems([
      item(
        'item',
        [source('s', 'individual')],
        [{ id: 'replace', action: 'replace', createdAt: '2026-07-11T00:00:00Z' }],
      ),
    ]);
    const restored = resolveStudentTaskItems([
      item(
        'item',
        [source('s', 'individual')],
        [
          { id: 'replace', action: 'replace', createdAt: '2026-07-11T00:00:00Z' },
          {
            id: 'restore',
            action: 'restore',
            reversesOverrideId: 'replace',
            createdAt: '2026-07-11T01:00:00Z',
          },
        ],
      ),
    ]);
    expect(replaced[0]).toMatchObject({
      resolutionState: 'superseded',
      resolutionReason: 'replaced',
    });
    expect(restored[0]).toMatchObject({ resolutionState: 'active', resolutionReason: 'winner' });
  });

  it('applies reschedule values before slot conflict resolution', () => {
    const result = resolveStudentTaskItems([
      item(
        'rescheduled',
        [source('class', 'class', 'old-slot')],
        [
          {
            id: 'move',
            action: 'reschedule',
            createdAt: '2026-07-11T00:00:00Z',
            slotKey: 'new-slot',
            availableAt: '2026-07-20T00:00:00Z',
            dueAt: '2026-07-27T00:00:00Z',
            closeAt: '2026-07-28T00:00:00Z',
          },
        ],
      ),
    ]);
    expect(result[0]).toMatchObject({
      resolutionState: 'active',
      slotKey: 'new-slot',
      availableAt: '2026-07-20T00:00:00Z',
      dueAt: '2026-07-27T00:00:00Z',
      closeAt: '2026-07-28T00:00:00Z',
    });
  });

  it('falls back to the next source when a higher source becomes inactive', () => {
    const result = resolveStudentTaskItems([
      item('item', [
        source('individual-paused', 'individual', 'slot', { active: false }),
        source('class-active', 'class', 'slot'),
      ]),
    ]);
    expect(result[0]).toMatchObject({
      winningSourceId: 'class-active',
      resolutionState: 'active',
    });
  });

  it('hides an item when every source is inactive', () => {
    const result = resolveStudentTaskItems([
      item('item', [source('path-paused', 'exam_path', 'slot', { active: false })]),
    ]);
    expect(result[0]).toMatchObject({
      winningSourceId: null,
      resolutionState: 'hidden',
      resolutionReason: 'source_inactive',
    });
  });
});

describe('task resolution slot isolation', () => {
  it('only conflicts inside the same slot', () => {
    const result = resolveStudentTaskItems([
      item('general-item', [source('g', 'general')]),
      item('personal-item', [source('p', 'individual')]),
      item('other-slot', [source('o', 'general', 'listening')]),
    ]);
    expect(result.find((entry) => entry.itemId === 'personal-item')?.resolutionState).toBe(
      'active',
    );
    expect(result.find((entry) => entry.itemId === 'general-item')).toMatchObject({
      resolutionState: 'superseded',
      resolutionReason: 'slot_conflict',
    });
    expect(result.find((entry) => entry.itemId === 'other-slot')?.resolutionState).toBe('active');
  });
});
