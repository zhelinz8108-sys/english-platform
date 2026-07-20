import { describe, expect, it } from 'vitest';
import {
  createVocabularyAnswerFeedback,
  estimateRaschAbility,
  estimateVocabulary,
  mapThetaToVocabulary,
  raschPersonOutfit,
  smoothDecreasing,
  vocabularyAbilityBand,
  type BandObservation,
} from './vocabulary-assessment.js';

describe('vocabulary answer feedback', () => {
  const delivery = {
    deliveryId: 'delivery-1',
    optionOrder: [2, 0, 3, 1],
    correctOptionIndex: 1,
  } as const;

  it('maps a shuffled correct answer back to its delivered option', () => {
    expect(createVocabularyAnswerFeedback({ ...delivery, selectedOptionId: 'choice-4' })).toEqual({
      deliveryId: 'delivery-1',
      selectedOptionId: 'choice-4',
      correctOptionId: 'choice-4',
      correct: true,
    });
  });

  it('returns the correct delivered option after a wrong or unknown response', () => {
    expect(
      createVocabularyAnswerFeedback({ ...delivery, selectedOptionId: 'choice-1' }),
    ).toMatchObject({ correctOptionId: 'choice-4', correct: false });
    expect(
      createVocabularyAnswerFeedback({ ...delivery, selectedOptionId: 'unknown' }),
    ).toMatchObject({ correctOptionId: 'choice-4', correct: false });
  });
});

function observations(correctByBand: number[], attempted = 3): BandObservation[] {
  return Array.from({ length: 14 }, (_, index) => ({
    band: index + 1,
    attempted,
    correct: correctByBand[index] ?? 0,
    unknown: 0,
  }));
}

describe('Beta vocabulary assessment safeguards', () => {
  it('treats honest unknown responses as ability evidence, not invalid behavior', () => {
    const result = estimateVocabulary({
      observations: Array.from({ length: 14 }, (_, index) => ({
        band: index + 1,
        attempted: 3,
        correct: 0,
        unknown: 3,
      })),
      rapidResponseCount: 0,
      mode: 'quick',
      scoreStatus: 'beta',
      seed: 'all-unknown',
    });
    expect(result.unknownRate).toBe(100);
    expect(result.reliability).not.toBe('INVALID');
    expect(result.qualityFlags).not.toContain('STRAIGHTLINING');
  });

  it('flags fixed-option responding without relying on unknown rate', () => {
    const result = estimateVocabulary({
      observations: observations(Array.from({ length: 14 }, () => 1)),
      rapidResponseCount: 0,
      selectedOptionPositions: Array.from({ length: 42 }, () => 0),
      mode: 'quick',
      seed: 'straight-line',
    });
    expect(result.qualityFlags).toContain('STRAIGHTLINING');
    expect(result.reliability).toBe('INVALID');
  });

  it('flags a low-frequency-perfect / high-frequency-failed inversion', () => {
    const result = estimateVocabulary({
      observations: observations([0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 3]),
      rapidResponseCount: 0,
      selectedOptionPositions: Array.from({ length: 42 }, (_, index) => index % 4),
      mode: 'quick',
      seed: 'inversion',
    });
    expect(result.qualityFlags).toContain('NON_MONOTONIC_PROFILE');
    expect(result.reliability).toBe('LOW');
  });

  it('never labels an uncalibrated Beta result high confidence', () => {
    const result = estimateVocabulary({
      observations: observations([3, 3, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0, 0, 0], 10),
      rapidResponseCount: 0,
      selectedOptionPositions: Array.from({ length: 140 }, (_, index) => index % 4),
      mode: 'standard',
      scoreStatus: 'beta',
      seed: 'beta-cap',
    });
    expect(result.reliability).not.toBe('HIGH');
    expect(result.calibrationVersion).toContain('unvalidated');
  });
});

describe('calibrated latent-score utilities', () => {
  const mapping = [
    { theta: -4, vocabulary: 0 },
    { theta: 0, vocabulary: 7000 },
    { theta: 4, vocabulary: 14000 },
  ];

  it('produces a strictly increasing estimate as calibrated response strength increases', () => {
    const difficulties = Array.from({ length: 40 }, (_, index) => -2.5 + (index / 39) * 5);
    const estimates = [8, 16, 24, 32].map(
      (correctCount) =>
        estimateRaschAbility(
          difficulties.map((difficulty, index) => ({ difficulty, correct: index < correctCount })),
        ).theta,
    );
    expect(estimates[0]).toBeLessThan(estimates[1]!);
    expect(estimates[1]).toBeLessThan(estimates[2]!);
    expect(estimates[2]).toBeLessThan(estimates[3]!);
  });

  it('interpolates only on the frozen calibrated word-family mapping', () => {
    expect(mapThetaToVocabulary(-4, mapping)).toBe(0);
    expect(mapThetaToVocabulary(0, mapping)).toBe(7000);
    expect(mapThetaToVocabulary(2, mapping)).toBe(10500);
    expect(mapThetaToVocabulary(9, mapping)).toBe(14000);
  });

  it('computes person-fit evidence separately from ability', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      difficulty: -2 + (index / 29) * 4,
      correct: index % 2 === 0,
    }));
    const ability = estimateRaschAbility(rows);
    expect(raschPersonOutfit(rows, ability.theta)).not.toBeNull();
  });

  it('keeps isotonic band mastery non-increasing and ability labels bounded', () => {
    expect(smoothDecreasing([0.9, 0.3, 0.7, 0.2], [1, 1, 1, 1])).toEqual([0.9, 0.5, 0.5, 0.2]);
    expect(vocabularyAbilityBand(-100).id).toBe('foundation');
    expect(vocabularyAbilityBand(99_000).id).toBe('extensive');
  });
});
