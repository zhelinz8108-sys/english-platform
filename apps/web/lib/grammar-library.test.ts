import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface GrammarLibraryDocument {
  version: string;
  summary: {
    partCount: number;
    topicCount: number;
    levelLessonCount: number;
    sourceUnitCount: number;
  };
  sources: Array<{ id: string; level: string; unitCount: number }>;
  parts: Array<{
    id: string;
    sequence: number;
    title: string;
    topics: Array<{
      id: string;
      globalSequence: number;
      levels: Array<{ id: string; content: string[] }>;
      guide: { goals: string[]; steps: string[]; traps: string[] };
      sections: Array<{ title: string; lines: string[]; details: string[] }>;
    }>;
  }>;
  sourceMappings: Array<{ book: string; unit: number; topicId: string }>;
}

const library = JSON.parse(
  readFileSync(new URL('../data/grammar-library.json', import.meta.url), 'utf8'),
) as GrammarLibraryDocument;
const topics = library.parts.flatMap((part) => part.topics);

describe('SAT 3000-word grammar curriculum', () => {
  it('replaces the old three-book path with 27 SAT chapters', () => {
    expect(library.version).toBe('sat-grammar-3000-v2');
    expect(library.summary).toEqual({
      partCount: 5,
      topicCount: 27,
      levelLessonCount: 27,
      sourceUnitCount: 27,
    });
    expect(library.parts).toHaveLength(5);
    expect(topics).toHaveLength(27);
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(27);
  });

  it('uses the five-stage order from the source PDF', () => {
    expect(library.parts.map((part) => part.title)).toEqual([
      '句子基础',
      '标点与句子边界',
      '动词系统',
      '句子细节',
      '逻辑与做题策略',
    ]);
    expect(topics.map((topic) => topic.globalSequence)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
  });

  it('publishes one reading chapter without the old difficulty levels', () => {
    expect(
      topics.every(
        (topic) =>
          topic.levels.length === 1 &&
          topic.levels[0]?.id === 'beginner' &&
          topic.levels[0].content.length >= 1 &&
          topic.sections.length >= 1 &&
          topic.sections.every((section) => section.title && section.lines.length >= 1),
      ),
    ).toBe(true);
  });

  it('adds a complete analysis path to every chapter and explains sparse sections', () => {
    expect(
      topics.every(
        (topic) =>
          topic.guide.goals.length >= 3 &&
          topic.guide.steps.length >= 3 &&
          topic.guide.traps.length >= 3,
      ),
    ).toBe(true);

    const sections = topics.flatMap((topic) => topic.sections);
    expect(sections.filter((section) => section.details.length > 0).length).toBeGreaterThan(90);

    const dash = topics.find((topic) => topic.id === 'dashes');
    expect(dash?.guide.steps).toHaveLength(4);
    expect(dash?.sections).toHaveLength(3);
    expect(dash?.sections.every((section) => section.details.length === 4)).toBe(true);
  });

  it('maps all chapters only to the selected SAT PDF', () => {
    expect(library.sources).toEqual([
      expect.objectContaining({
        id: 'sat-grammar-3000',
        level: 'SAT 3000词汇量版',
        unitCount: 27,
      }),
    ]);
    expect(library.sourceMappings).toHaveLength(27);
    expect(new Set(library.sourceMappings.map((mapping) => mapping.unit)).size).toBe(27);
    expect(library.sourceMappings.every((mapping) => mapping.book === 'sat-grammar-3000')).toBe(
      true,
    );
  });
});
