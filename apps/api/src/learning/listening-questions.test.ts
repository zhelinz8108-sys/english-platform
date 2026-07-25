import { describe, expect, it } from 'vitest';
import {
  listeningSourceHash,
  publicListeningQuestionSet,
  readyListeningQuestionSet,
  scoreListeningAnswers,
} from './listening-questions.js';

const source = {
  sourceId: 'minute-earth-001',
  collection: 'minute-earth',
  title: 'A short talk',
  durationSeconds: 120,
  transcript: 'Beginning evidence. Middle evidence. Ending evidence.',
};

function storedSet() {
  return {
    sourceHash: listeningSourceHash(source),
    label: 'TOEFL Academic Listening Practice',
    exactSimulation: true,
    reviewStatus: 'reviewed',
    questions: [1, 2, 3, 4].map((position) => ({
      id: `minute-earth-001-q0${position}`,
      position,
      type: position === 1 ? 'main_idea' : 'detail',
      difficulty: 'medium',
      public: {
        prompt: `Question ${position}`,
        options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Option ${id}` })),
      },
      private: {
        answer: 'a',
        evidence: [{ start: 0, end: 18, quote: 'Beginning evidence.' }],
        explanationZh: '解析',
        optionRationalesZh: { a: '正确', b: '错误', c: '错误', d: '错误' },
      },
    })),
  };
}

describe('listening questions', () => {
  it('only exposes public fields before submission', () => {
    const ready = readyListeningQuestionSet(source, storedSet());
    expect(ready).not.toBeNull();
    const publicSet = publicListeningQuestionSet(ready!);
    expect(publicSet.questions).toHaveLength(4);
    expect(publicSet.questions[0]).not.toHaveProperty('private');
    expect(JSON.stringify(publicSet)).not.toContain('正确');
  });

  it('rejects a stale source hash', () => {
    expect(
      readyListeningQuestionSet(source, { ...storedSet(), sourceHash: '0'.repeat(64) }),
    ).toBeNull();
  });

  it('scores all four questions and reveals evidence after submission', () => {
    const ready = readyListeningQuestionSet(source, storedSet())!;
    const answers = Object.fromEntries(ready.questions.map((question) => [question.id, 'a']));
    const result = scoreListeningAnswers(ready, answers, source.transcript);
    expect(result).toMatchObject({ answeredCount: 4, correctCount: 4, totalCount: 4 });
    expect(result.results[0]?.evidence[0]).toMatchObject({ region: '开头', progressPercent: 0 });
  });
});
