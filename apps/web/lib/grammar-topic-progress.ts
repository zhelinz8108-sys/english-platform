import {
  grammarLevelIds,
  type GrammarLevelId,
  type GrammarProgressEntry,
  type GrammarProgressStatus,
} from '@english/shared';

export interface GrammarTopicProgressSummary {
  status: GrammarProgressStatus;
  mastered: boolean;
  started: boolean;
  bestAccuracy: number | null;
  attemptCount: number;
  activeSessionId: string | null;
  nextLevel: GrammarLevelId | null;
}

export function summarizeGrammarTopicProgress(
  entries: readonly GrammarProgressEntry[],
  topicId: string,
): GrammarTopicProgressSummary {
  const topicEntries = grammarLevelIds.map((level) =>
    entries.find((entry) => entry.topicId === topicId && entry.level === level),
  );
  const mastered = topicEntries.every((entry) => entry?.status === 'mastered');
  const started = topicEntries.some((entry) => entry && entry.status !== 'not_started');
  const nextIndex = topicEntries.findIndex((entry) => entry?.status !== 'mastered');
  const nextLevel = nextIndex < 0 ? null : grammarLevelIds[nextIndex]!;
  const bestScores = topicEntries.flatMap((entry) =>
    entry?.bestAccuracy === null || entry?.bestAccuracy === undefined ? [] : [entry.bestAccuracy],
  );
  const nextEntry = topicEntries[nextIndex];

  return {
    status: mastered ? 'mastered' : started ? 'in_progress' : 'not_started',
    mastered,
    started,
    bestAccuracy: bestScores.length ? Math.max(...bestScores) : null,
    attemptCount: topicEntries.reduce((total, entry) => total + (entry?.attemptCount ?? 0), 0),
    activeSessionId: nextEntry?.activeSessionId ?? null,
    nextLevel,
  };
}
