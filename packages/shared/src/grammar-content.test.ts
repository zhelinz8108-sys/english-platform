import { describe, expect, it } from 'vitest';
import {
  getGrammarQuestionDefinitions,
  getPilotGrammarLesson,
  grammarCorrectAnswerLabel,
  isGrammarAnswerCorrect,
  pilotGrammarTopicIds,
  toPublicGrammarQuestion,
  validateGrammarPilotContent,
} from './grammar-content.js';

describe('pilot grammar content', () => {
  it('publishes five lessons, fifteen stages and 150 original questions', () => {
    expect(validateGrammarPilotContent()).toEqual({
      lessonCount: 5,
      stageCount: 15,
      questionCount: 150,
    });
    expect(new Set(pilotGrammarTopicIds).size).toBe(5);
  });

  it('gives every stage the required lesson structure', () => {
    for (const topicId of pilotGrammarTopicIds) {
      const lesson = getPilotGrammarLesson(topicId);
      expect(lesson?.stages.map((stage) => stage.level)).toEqual([
        'beginner',
        'intermediate',
        'advanced',
      ]);
      for (const stage of lesson?.stages ?? []) {
        expect(stage.rules.length).toBeGreaterThanOrEqual(3);
        expect(stage.examples).toHaveLength(6);
        expect(stage.mistakes).toHaveLength(3);
        expect(stage.questionCount).toBe(10);
        expect(stage.sources).toHaveLength(1);
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

  it('scores choice and fill-in answers with normalized text', () => {
    const questions = getGrammarQuestionDefinitions('present-contrast', 'beginner');
    const choice = questions.find((question) => question.kind === 'single_choice')!;
    const fill = questions.find((question) => question.kind === 'fill_blank')!;
    expect(isGrammarAnswerCorrect(choice, choice.correctAnswer)).toBe(true);
    expect(isGrammarAnswerCorrect(choice, 'not-an-option')).toBe(false);
    expect(isGrammarAnswerCorrect(fill, `  ${fill.correctAnswer.toUpperCase()}. `)).toBe(true);
  });
});
