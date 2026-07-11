import type { ResolutionState, TaskSourceType } from './index.js';

const sourceWeight: Readonly<Record<TaskSourceType, number>> = {
  admin_forced: 500,
  individual: 400,
  class: 300,
  exam_path: 200,
  general: 100,
};

function compareSources(
  left: Pick<ResolvableSource, 'id' | 'sourceType' | 'explicitPriority' | 'publishedAt'>,
  right: Pick<ResolvableSource, 'id' | 'sourceType' | 'explicitPriority' | 'publishedAt'>,
): number {
  return (
    sourceWeight[right.sourceType] - sourceWeight[left.sourceType] ||
    right.explicitPriority - left.explicitPriority ||
    right.publishedAt.localeCompare(left.publishedAt) ||
    right.id.localeCompare(left.id)
  );
}

export interface ResolvableSource {
  id: string;
  sourceType: TaskSourceType;
  explicitPriority: number;
  publishedAt: string;
  active: boolean;
  slotKey: string;
  availableAt: string;
  dueAt: string | null;
  closeAt: string | null;
}

export interface ResolvableOverride {
  id: string;
  action: 'hide' | 'restore' | 'replace' | 'reschedule' | 'require_redo';
  createdAt: string;
  reversesOverrideId?: string | null;
  slotKey?: string | null;
  availableAt?: string | null;
  dueAt?: string | null;
  closeAt?: string | null;
}

export interface ResolvableTaskItem {
  id: string;
  sources: ResolvableSource[];
  overrides: ResolvableOverride[];
}

export interface ResolvedTaskItem {
  itemId: string;
  winningSourceId: string | null;
  resolutionState: ResolutionState;
  resolutionReason: 'winner' | 'override_hidden' | 'source_inactive' | 'slot_conflict' | 'replaced';
  slotKey: string | null;
  availableAt: string | null;
  dueAt: string | null;
  closeAt: string | null;
}

interface EffectiveItem extends ResolvedTaskItem {
  winningSource: ResolvableSource | null;
  hidden: boolean;
}

function effectiveOverrideState(item: ResolvableTaskItem, source: ResolvableSource): EffectiveItem {
  let hidden = false;
  let replaced = false;
  let slotKey = source.slotKey;
  let availableAt = source.availableAt;
  let dueAt = source.dueAt;
  let closeAt = source.closeAt;
  const applied = new Map<string, ResolvableOverride>();
  const reversed = new Set<string>();
  const overrides = [...item.overrides].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );

  for (const override of overrides) {
    if (override.action === 'restore' && override.reversesOverrideId) {
      reversed.add(override.reversesOverrideId);
      const target = applied.get(override.reversesOverrideId);
      if (target?.action === 'hide') hidden = false;
      if (target?.action === 'replace') replaced = false;
      continue;
    }
    if (reversed.has(override.id)) continue;
    applied.set(override.id, override);
    if (override.action === 'hide') hidden = true;
    if (override.action === 'replace') replaced = true;
    if (override.action === 'reschedule') {
      slotKey = override.slotKey ?? slotKey;
      availableAt = override.availableAt ?? availableAt;
      dueAt = override.dueAt ?? dueAt;
      closeAt = override.closeAt ?? closeAt;
    }
  }

  return {
    itemId: item.id,
    winningSourceId: source.id,
    resolutionState: hidden ? 'hidden' : replaced ? 'superseded' : 'superseded',
    resolutionReason: hidden ? 'override_hidden' : replaced ? 'replaced' : 'slot_conflict',
    slotKey,
    availableAt,
    dueAt,
    closeAt,
    winningSource: source,
    hidden: hidden || replaced,
  };
}

export function resolveStudentTaskItems(items: ResolvableTaskItem[]): ResolvedTaskItem[] {
  const effective: EffectiveItem[] = items.map((item) => {
    const winningSource = item.sources.filter((source) => source.active).sort(compareSources)[0];
    if (!winningSource) {
      return {
        itemId: item.id,
        winningSourceId: null,
        resolutionState: 'hidden',
        resolutionReason: 'source_inactive',
        slotKey: null,
        availableAt: null,
        dueAt: null,
        closeAt: null,
        winningSource: null,
        hidden: true,
      };
    }
    return effectiveOverrideState(item, winningSource);
  });

  const slots = new Map<string, EffectiveItem[]>();
  for (const item of effective) {
    if (item.hidden || !item.slotKey || !item.winningSource) continue;
    const candidates = slots.get(item.slotKey) ?? [];
    candidates.push(item);
    slots.set(item.slotKey, candidates);
  }

  for (const candidates of slots.values()) {
    candidates.sort((left, right) => {
      if (!left.winningSource || !right.winningSource) return 0;
      return compareSources(left.winningSource, right.winningSource);
    });
    const winner = candidates[0];
    if (winner) {
      winner.resolutionState = 'active';
      winner.resolutionReason = 'winner';
    }
  }

  return effective.map(({ winningSource: _winningSource, hidden: _hidden, ...result }) => result);
}
