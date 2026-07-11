import { describe, expect, it } from 'vitest';
import { compareTaskSources, SCORE_DECISION_WEIGHT, TASK_SOURCE_WEIGHT } from './index.js';

describe('domain invariants', () => {
  it('keeps the fixed task-source precedence', () => {
    expect(TASK_SOURCE_WEIGHT).toEqual({
      admin_forced: 500,
      individual: 400,
      class: 300,
      exam_path: 200,
      general: 100,
    });
  });

  it('sorts a higher source before a lower source', () => {
    const common = { explicitPriority: 0, publishedAt: '2026-07-11T00:00:00Z' };
    const sorted = [
      { ...common, id: 'a', sourceType: 'general' as const },
      { ...common, id: 'b', sourceType: 'individual' as const },
    ].sort(compareTaskSources);
    expect(sorted.map((item) => item.sourceType)).toEqual(['individual', 'general']);
  });

  it('keeps final-score precedence', () => {
    expect(SCORE_DECISION_WEIGHT.admin_override).toBeGreaterThan(
      SCORE_DECISION_WEIGHT.teacher_confirmed,
    );
    expect(SCORE_DECISION_WEIGHT.teacher_confirmed).toBeGreaterThan(
      SCORE_DECISION_WEIGHT.auto_scored,
    );
  });
});
