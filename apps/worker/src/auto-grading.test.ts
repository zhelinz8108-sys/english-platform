import { describe, expect, it } from 'vitest';
import { autoGrade } from './auto-grading.js';

describe('autoGrade', () => {
  it('grades scalar and order-insensitive multi-select answers', () => {
    const result = autoGrade(
      [
        { id: 'one', questionVersionId: 'q1', answerKey: 'B', maxScore: 1 },
        { id: 'two', questionVersionId: 'q2', answerKey: ['A', 'C'], maxScore: 2 },
      ],
      { one: ' b ', two: ['C', 'A'] },
    );
    expect(result).toMatchObject({ score: 3, maxScore: 3, fullyAutoGradable: true });
  });

  it('leaves writing for a teacher', () => {
    const result = autoGrade(
      [{ id: 'essay', questionVersionId: 'q3', answerKey: null, maxScore: 5 }],
      { essay: 'My essay' },
    );
    expect(result.fullyAutoGradable).toBe(false);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(5);
    expect(result.components.every((component) => component.correct === null)).toBe(true);
    expect(result.components[0]?.correct).toBeNull();
  });

  it('understands the published answer-key snapshot shape', () => {
    const result = autoGrade(
      [
        {
          id: 'one',
          questionVersionId: 'q1',
          answerKey: { correct_option_ids: ['b'] },
          maxScore: 1,
        },
      ],
      { q1: 'b' },
    );
    expect(result).toMatchObject({ score: 1, maxScore: 1, fullyAutoGradable: true });
  });
});
