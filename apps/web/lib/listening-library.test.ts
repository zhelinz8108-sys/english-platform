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
  vocabulary: Array<{
    word: string;
    partOfSpeech: string;
    definition: string;
    context: string;
    contextTranslation: string;
  }>;
}

interface LibraryDocument {
  collections: Array<{ id: string; count: number }>;
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

    expect(bbc.filter((item) => item.vocabulary.length > 0).length).toBeGreaterThan(800);
    expect(bbc.find((item) => item.title === 'Cost of living')?.vocabulary).toHaveLength(10);
    expect(bbc.find((item) => item.title === 'Our Love Of Pets')?.vocabulary).toHaveLength(6);

    const vocabulary = bbc.flatMap((item) => item.vocabulary);
    const normalizedWords = vocabulary.map((entry) =>
      entry.word.trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '),
    );
    expect(vocabulary).toHaveLength(5660);
    expect(new Set(normalizedWords).size).toBe(vocabulary.length);
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
});
