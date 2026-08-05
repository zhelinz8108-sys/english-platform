import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LibraryItem {
  id: string;
  collection: string;
  title: string;
  year: number | null;
  audioPath: string | null;
  documentPath: string | null;
  transcriptWordCount: number;
  transcript: string;
  vocabulary: Array<{
    word: string;
    ipa: string;
    partOfSpeech: string;
    definition: string;
    context: string;
    contextTranslation: string;
  }>;
}

interface LibraryDocument {
  collections: Array<{
    id: string;
    difficulty: string;
    audience: string;
    rank: number;
    count: number;
  }>;
  items: LibraryItem[];
}

const library = JSON.parse(
  readFileSync(new URL('../data/listening-library.json', import.meta.url), 'utf8'),
) as LibraryDocument;

describe('local listening library', () => {
  it('restores all Minute Earth study content', () => {
    const minuteEarth = library.items.filter((item) => item.collection === 'minute-earth');
    expect(minuteEarth).toHaveLength(270);
    expect(minuteEarth.every((item) => item.audioPath && item.transcriptWordCount > 0)).toBe(true);
    expect(
      minuteEarth.every((item) => /^第(?:001集-200集|201集-376集)\//u.test(item.audioPath ?? '')),
    ).toBe(true);
    expect(minuteEarth.filter((item) => item.vocabulary.length > 0).length).toBeGreaterThan(260);
    const vocabulary = minuteEarth.flatMap((item) => item.vocabulary);
    expect(
      vocabulary.every(
        (entry) =>
          entry.partOfSpeech && entry.context && /[\u3400-\u9fff]/u.test(entry.contextTranslation),
      ),
    ).toBe(true);
  });

  it('deduplicates and pairs the BBC library', () => {
    const bbc = library.items.filter((item) => item.collection === 'bbc-6-minute-english');
    expect(bbc).toHaveLength(863);
    expect(bbc.every((item) => item.audioPath && !/\(1\)\.[^.]+$/u.test(item.audioPath))).toBe(
      true,
    );
    expect(bbc.filter((item) => item.documentPath && item.transcriptWordCount > 0).length).toBe(
      859,
    );

    const peruvianHero = bbc.find((item) => item.title === "A Peruvian 'hero'");
    expect(peruvianHero?.documentPath).toBeTruthy();
    expect(peruvianHero?.transcriptWordCount).toBeGreaterThan(1000);

    const vocabulary = bbc.flatMap((item) => item.vocabulary);
    expect(bbc.every((item) => item.vocabulary.length > 0)).toBe(true);
    expect(
      vocabulary.every(
        (entry) =>
          entry.partOfSpeech &&
          /[\u3400-\u9fff]/u.test(entry.definition) &&
          !entry.definition.startsWith('原文语境：'),
      ),
    ).toBe(true);
    expect(
      vocabulary.every(
        (entry) => entry.context && /[\u3400-\u9fff]/u.test(entry.contextTranslation),
      ),
    ).toBe(true);

    const years = new Set(bbc.map((item) => item.year));
    expect(years.has(null)).toBe(false);
    expect(Math.min(...([...years] as number[]))).toBe(2008);
    expect(Math.max(...([...years] as number[]))).toBe(2026);
    expect(bbc.filter((item) => item.year === 2020)).toHaveLength(51);
    expect(bbc.filter((item) => item.year === 2021)).toHaveLength(56);
  });

  it('keeps collection counts and item identifiers consistent', () => {
    expect(new Set(library.items.map((item) => item.id)).size).toBe(library.items.length);
    for (const collection of library.collections) {
      expect(library.items.filter((item) => item.collection === collection.id)).toHaveLength(
        collection.count,
      );
    }
  });

  it('adds the remaining local listening sources in difficulty order', () => {
    expect(library.collections.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 'bbc-english-in-a-minute', count: 268 },
      { id: 'bbc-6-minute-english', count: 863 },
      { id: 'voa-standard-english', count: 1546 },
      { id: 'minute-earth', count: 270 },
      { id: 'scientific-american-60-second', count: 773 },
      { id: 'short-wave', count: 699 },
    ]);
    expect(library.collections.map((collection) => collection.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      library.collections.every((collection) => collection.difficulty && collection.audience),
    ).toBe(true);

    const newlyAdded = library.items.filter((item) =>
      [
        'bbc-english-in-a-minute',
        'voa-standard-english',
        'scientific-american-60-second',
        'short-wave',
      ].includes(item.collection),
    );
    expect(newlyAdded).toHaveLength(3286);
    expect(
      newlyAdded.every(
        (item) =>
          item.audioPath &&
          item.documentPath &&
          item.transcriptWordCount >= 8 &&
          !/[\u3400-\u9fff]/u.test(item.transcript),
      ),
    ).toBe(true);
  });

  it('supplies ordered, per-episode deduplicated vocabulary', () => {
    const silentMinuteEarthItem = 'minute-earth-007';
    for (const item of library.items) {
      if (item.id === silentMinuteEarthItem) {
        expect(item.transcript.trim()).toBe('you');
        expect(item.vocabulary).toHaveLength(0);
        continue;
      }

      expect(item.vocabulary.length).toBeGreaterThan(0);
      const normalizedWords = item.vocabulary.map((entry) =>
        entry.word.trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '),
      );
      expect(new Set(normalizedWords).size).toBe(normalizedWords.length);
      expect(
        item.vocabulary.every(
          (entry) =>
            entry.word &&
            entry.partOfSpeech &&
            /[\u3400-\u9fff]/u.test(entry.definition) &&
            entry.context &&
            /[\u3400-\u9fff]/u.test(entry.contextTranslation),
        ),
      ).toBe(true);
    }
  });
});
