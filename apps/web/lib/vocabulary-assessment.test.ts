import { describe, expect, it } from 'vitest';
import { estimateVocabulary, smoothDecreasing, type BandObservation } from './vocabulary-assessment';

function observations(threshold: number): BandObservation[] {
  return Array.from({ length: 14 }, (_, index) => {
    const band = index + 1;
    const correct = band <= threshold ? 3 : band === threshold + 1 ? 1 : 0;
    return { band, attempted: 4, correct, unknown: band > threshold + 2 ? 2 : 0 };
  });
}

describe('vocabulary assessment estimation', () => {
  it('enforces a non-increasing profile without changing the number of bands', () => {
    const smoothed = smoothDecreasing([0.9, 0.7, 0.75, 0.3, 0.4], [2, 2, 2, 2, 2]);
    expect(smoothed).toHaveLength(5);
    for (let index = 1; index < smoothed.length; index += 1) {
      expect(smoothed[index]).toBeLessThanOrEqual(smoothed[index - 1]!);
    }
  });

  it('produces a larger estimate for a higher observed threshold', () => {
    const lower = estimateVocabulary({
      observations: observations(4),
      rapidResponseCount: 0,
      seed: 'lower-learner',
    });
    const higher = estimateVocabulary({
      observations: observations(9),
      rapidResponseCount: 0,
      seed: 'higher-learner',
    });
    expect(higher.estimate).toBeGreaterThan(lower.estimate);
  });

  it('returns a bounded 95% interval and all fourteen frequency bands', () => {
    const result = estimateVocabulary({
      observations: observations(7),
      rapidResponseCount: 1,
      seed: 'deterministic-session',
    });
    expect(result.interval.confidence).toBe(0.95);
    expect(result.interval.lower).toBeLessThanOrEqual(result.estimate);
    expect(result.interval.upper).toBeGreaterThanOrEqual(result.estimate);
    expect(result.interval.lower).toBeGreaterThanOrEqual(0);
    expect(result.interval.upper).toBeLessThanOrEqual(14000);
    expect(result.bandProfile).toHaveLength(14);
    expect(result.bandProfile.map((band) => band.label)).toEqual(
      Array.from({ length: 14 }, (_, index) => `${index + 1}K`),
    );
  });

  it('flags implausibly rapid responding as invalid', () => {
    const result = estimateVocabulary({
      observations: observations(7),
      rapidResponseCount: 40,
      seed: 'rapid-session',
    });
    expect(result.reliability).toBe('INVALID');
  });
});
