import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface GrammarLibraryDocument {
  summary: {
    partCount: number;
    topicCount: number;
    levelLessonCount: number;
    sourceUnitCount: number;
  };
  sources: Array<{ level: string; unitCount: number }>;
  parts: Array<{
    id: string;
    topics: Array<{
      id: string;
      patterns: string[];
      levels: Array<{ id: string; content: string[] }>;
      examples: Array<{ english: string; chinese: string }>;
      mistakes: Array<{ wrong: string; right: string; explanation: string }>;
    }>;
  }>;
  sourceMappings: Array<{ book: string; unit: number; topicId: string }>;
}

const library = JSON.parse(
  readFileSync(new URL('../data/grammar-library.json', import.meta.url), 'utf8'),
) as GrammarLibraryDocument;
const topics = library.parts.flatMap((part) => part.topics);

describe('three-book grammar learning path', () => {
  it('builds the complete deduplicated curriculum', () => {
    expect(library.summary).toEqual({
      partCount: 12,
      topicCount: 86,
      levelLessonCount: 258,
      sourceUnitCount: 360,
    });
    expect(library.parts).toHaveLength(12);
    expect(topics).toHaveLength(86);
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(86);
  });

  it('gives every topic a complete beginner, intermediate and advanced path', () => {
    expect(
      topics.every(
        (topic) =>
          topic.patterns.length > 0 &&
          topic.levels.map((level) => level.id).join(',') ===
            'beginner,intermediate,advanced' &&
          topic.levels.every((level) => level.content.length >= 3),
      ),
    ).toBe(true);
  });

  it('keeps examples bilingual and mistakes fully explained', () => {
    expect(
      topics.every(
        (topic) =>
          topic.examples.length >= 6 &&
          topic.examples.every(
            (example) => example.english && /[\u3400-\u9fff]/u.test(example.chinese),
          ) &&
          topic.mistakes.length >= 2 &&
          topic.mistakes.every(
            (mistake) => mistake.wrong && mistake.right && mistake.explanation,
          ),
      ),
    ).toBe(true);
  });

  it('maps every source unit exactly once', () => {
    expect(library.sources.map((source) => [source.level, source.unitCount])).toEqual([
      ['初级', 115],
      ['中级', 145],
      ['高级', 100],
    ]);
    expect(library.sourceMappings).toHaveLength(360);
    expect(
      new Set(library.sourceMappings.map((mapping) => `${mapping.book}:${mapping.unit}`)).size,
    ).toBe(360);
    expect(
      library.sourceMappings.every((mapping) => topics.some((topic) => topic.id === mapping.topicId)),
    ).toBe(true);
  });
});
