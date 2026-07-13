import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LibraryItem {
  id: string;
  collection: string;
  title: string;
  audioPath: string | null;
  documentPath: string | null;
  transcriptWordCount: number;
  vocabulary: unknown[];
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
    expect(minuteEarth.filter((item) => item.vocabulary.length > 0).length).toBeGreaterThan(260);
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
