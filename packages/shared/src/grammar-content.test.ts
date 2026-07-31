import { describe, expect, it } from 'vitest';
import {
  getGrammarQuestionDefinitions,
  getGrammarLesson,
  grammarContentVersion,
  grammarTopicIds,
  validateGrammarContent,
} from './grammar-content.js';

describe('SAT grammar reading content', () => {
  it('publishes 27 chapters and removes all old practice stages', () => {
    expect(grammarContentVersion).toBe('sat-grammar-3000-v1');
    expect(validateGrammarContent()).toEqual({
      lessonCount: 27,
      stageCount: 27,
      questionCount: 0,
    });
    expect(new Set(grammarTopicIds).size).toBe(27);
  });

  it('gives every chapter one reading-only SAT core stage', () => {
    for (const topicId of grammarTopicIds) {
      const lesson = getGrammarLesson(topicId);
      expect(lesson?.stages).toHaveLength(1);
      expect(lesson?.stages[0]).toEqual(
        expect.objectContaining({
          level: 'beginner',
          label: 'SAT核心',
          questionCount: 0,
          practiceAvailable: false,
        }),
      );
      expect(lesson?.stages[0]?.rules.length).toBeGreaterThanOrEqual(1);
      expect(getGrammarQuestionDefinitions(topicId, 'beginner')).toEqual([]);
    }
  });

  it('does not expose any removed topic from the old curriculum', () => {
    expect(getGrammarLesson('present-contrast')).toBeNull();
    expect(getGrammarLesson('conditionals-basic')).toBeNull();
    expect(getGrammarLesson('inversion')).toBeNull();
  });
});
