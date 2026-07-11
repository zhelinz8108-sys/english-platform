import { describe, expect, it } from 'vitest';
import { teacherQuestionSnapshot } from './teacher.service.js';

describe('teacher assessment detail projection', () => {
  it('never exposes an answer key from an attempt snapshot', () => {
    const projected = teacherQuestionSnapshot({
      question_version_id: 'q1',
      question_kind: 'essay',
      prompt_snapshot: { text: 'Write' },
      options_snapshot: null,
      position: 0,
      max_score: 30,
    });
    expect(projected).toEqual({
      questionVersionId: 'q1',
      kind: 'essay',
      prompt: { text: 'Write' },
      options: null,
      position: 0,
      maxScore: 30,
    });
    expect(projected).not.toHaveProperty('answerKey');
  });
});
