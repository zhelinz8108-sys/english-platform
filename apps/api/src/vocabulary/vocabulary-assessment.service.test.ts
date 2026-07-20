import { describe, expect, it } from 'vitest';
import { toPublicVocabularyQuestion } from './vocabulary-assessment.service.js';

describe('vocabulary assessment response secrecy', () => {
  it('serializes only the delivered prompt and shuffled labels', () => {
    const privateItem = {
      deliveryId: '019f62c1-0123-7000-8000-000000000001',
      itemId: '019f62c1-0123-7000-8000-000000000002',
      targetWord: 'abate',
      sentence: 'The storm began to abate before dawn.',
      options: ['增强', '减弱', '测量', '拒绝'],
      optionOrder: [2, 1, 3, 0],
      correctOptionIndex: 1,
      difficulty: 0.48,
      discrimination: 1.12,
      completeBank: ['forbidden'],
    };
    const publicQuestion = toPublicVocabularyQuestion(privateItem);
    expect(publicQuestion.options.map((option) => option.label)).toEqual([
      '测量',
      '减弱',
      '拒绝',
      '增强',
    ]);
    expect(publicQuestion).not.toHaveProperty('correctOptionIndex');
    expect(publicQuestion).not.toHaveProperty('difficulty');
    expect(publicQuestion).not.toHaveProperty('discrimination');
    expect(publicQuestion).not.toHaveProperty('completeBank');
    expect(JSON.stringify(publicQuestion)).not.toContain('0.48');
  });
});
