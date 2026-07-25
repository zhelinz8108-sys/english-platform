import { describe, expect, it } from 'vitest';
import type { GrammarProgressEntry } from '@english/shared';
import { summarizeGrammarTopicProgress } from './grammar-topic-progress';

function entry(
  level: GrammarProgressEntry['level'],
  status: GrammarProgressEntry['status'],
  bestAccuracy: number | null = null,
): GrammarProgressEntry {
  return {
    topicId: 'topic-1',
    level,
    status,
    attemptCount: status === 'not_started' ? 0 : 1,
    bestAccuracy,
    lastAccuracy: bestAccuracy,
    activeSessionId: status === 'in_progress' ? `session-${level}` : null,
    updatedAt: null,
  };
}

describe('grammar topic progress', () => {
  it('starts with the first internal question group without exposing a learner level', () => {
    expect(summarizeGrammarTopicProgress([], 'topic-1')).toEqual({
      status: 'not_started',
      mastered: false,
      started: false,
      bestAccuracy: null,
      attemptCount: 0,
      activeSessionId: null,
      nextLevel: 'beginner',
    });
  });

  it('advances through question groups in simple-to-complex order', () => {
    const summary = summarizeGrammarTopicProgress(
      [entry('beginner', 'mastered', 90), entry('intermediate', 'in_progress')],
      'topic-1',
    );
    expect(summary).toEqual({
      status: 'in_progress',
      mastered: false,
      started: true,
      bestAccuracy: 90,
      attemptCount: 2,
      activeSessionId: 'session-intermediate',
      nextLevel: 'intermediate',
    });
  });

  it('marks the topic mastered only after all question groups are mastered', () => {
    const summary = summarizeGrammarTopicProgress(
      [
        entry('beginner', 'mastered', 90),
        entry('intermediate', 'mastered', 85),
        entry('advanced', 'mastered', 80),
      ],
      'topic-1',
    );
    expect(summary.status).toBe('mastered');
    expect(summary.mastered).toBe(true);
    expect(summary.nextLevel).toBeNull();
    expect(summary.bestAccuracy).toBe(90);
  });
});
