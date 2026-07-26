import { describe, expect, it } from 'vitest';
import {
  getGrammarQuestionDefinitions,
  getGrammarLesson,
  grammarCorrectAnswerLabel,
  grammarTopicIds,
  isGrammarAnswerCorrect,
  toPublicGrammarQuestion,
  validateGrammarContent,
} from './grammar-content.js';

describe('complete grammar content', () => {
  it('publishes 86 lessons, 258 stages and 2580 questions', () => {
    expect(validateGrammarContent()).toEqual({
      lessonCount: 86,
      stageCount: 258,
      questionCount: 2580,
    });
    expect(new Set(grammarTopicIds).size).toBe(86);
  });

  it('gives every stage the required lesson structure', () => {
    for (const topicId of grammarTopicIds) {
      const lesson = getGrammarLesson(topicId);
      expect(lesson?.stages.map((stage) => stage.level)).toEqual([
        'beginner',
        'intermediate',
        'advanced',
      ]);
      for (const stage of lesson?.stages ?? []) {
        expect(stage.rules.length).toBeGreaterThanOrEqual(3);
        expect(stage.examples.length).toBeGreaterThanOrEqual(6);
        expect(stage.mistakes.length).toBeGreaterThanOrEqual(2);
        expect(stage.questionCount).toBe(10);
        expect(stage.practiceAvailable).toBe(true);
      }
    }
  });

  it('never exposes answer keys in the public question payload', () => {
    const privateQuestion = getGrammarQuestionDefinitions('present-contrast', 'beginner')[0]!;
    const publicQuestion = toPublicGrammarQuestion(privateQuestion);
    expect(publicQuestion).not.toHaveProperty('correctAnswer');
    expect(publicQuestion).not.toHaveProperty('acceptedAnswers');
    expect(publicQuestion).not.toHaveProperty('explanation');
    expect(grammarCorrectAnswerLabel(privateQuestion)).not.toBe('');
  });

  it('keeps every generated question answerable and unambiguous at the payload level', () => {
    for (const topicId of grammarTopicIds) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
        for (const question of getGrammarQuestionDefinitions(topicId, level)) {
          expect(question.prompt.trim()).not.toBe('');
          expect(question.explanation.trim()).not.toBe('');
          if (question.options) {
            expect(question.options.length).toBeGreaterThanOrEqual(2);
            expect(new Set(question.options.map((option) => option.label)).size).toBe(
              question.options.length,
            );
            expect(question.options.some((option) => option.id === question.correctAnswer)).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it('scores choice and fill-in answers with normalized text', () => {
    const questions = getGrammarQuestionDefinitions('present-contrast', 'beginner');
    const choice = questions.find((question) => question.kind === 'single_choice')!;
    const fill = questions.find((question) => question.kind === 'fill_blank')!;
    expect(isGrammarAnswerCorrect(choice, choice.correctAnswer)).toBe(true);
    expect(isGrammarAnswerCorrect(choice, 'not-an-option')).toBe(false);
    expect(isGrammarAnswerCorrect(fill, `  ${fill.correctAnswer.toUpperCase()}. `)).toBe(true);
  });
});
