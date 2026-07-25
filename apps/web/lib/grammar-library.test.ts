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
    sequence: number;
    title: string;
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

  it('orders the curriculum by practical learning dependencies', () => {
    expect(library.parts.map((part) => part.title)).toEqual([
      '句子骨架、be/do/have',
      '名词、代词、冠词与基础介词',
      '一般现在时和过去时、否定与疑问',
      '进行时、完成时与时态对比',
      '情态动词、祈使句与基本语气',
      '将来表达与时间关系',
      '形容词、副词、比较与修饰',
      '动词配价、不定式、动名词与分词',
      '被动语态、使役与报告结构',
      '名词性、定语与状语从句',
      '条件句、愿望与虚拟语气',
      '倒装、省略、强调与信息结构',
    ]);

    const moduleByTopic = new Map(
      library.parts.flatMap((part) =>
        part.topics.map((topic) => [topic.id, part.sequence] as const),
      ),
    );
    expect({
      basicPrepositions: moduleByTopic.get('prepositions'),
      conditionals: moduleByTopic.get('conditionals-basic'),
      future: moduleByTopic.get('will-shall'),
      gerunds: moduleByTopic.get('gerunds'),
      inversion: moduleByTopic.get('inversion'),
      negation: moduleByTopic.get('negation'),
      passive: moduleByTopic.get('passive-forms'),
      presentProgressive: moduleByTopic.get('present-progressive'),
      relativeClauses: moduleByTopic.get('defining-relatives'),
    }).toEqual({
      basicPrepositions: 2,
      conditionals: 11,
      future: 6,
      gerunds: 8,
      inversion: 12,
      negation: 3,
      passive: 9,
      presentProgressive: 4,
      relativeClauses: 10,
    });
  });

  it('gives every topic a complete beginner, intermediate and advanced path', () => {
    expect(
      topics.every(
        (topic) =>
          topic.patterns.length > 0 &&
          topic.levels.map((level) => level.id).join(',') === 'beginner,intermediate,advanced' &&
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
          topic.mistakes.every((mistake) => mistake.wrong && mistake.right && mistake.explanation),
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
      library.sourceMappings.every((mapping) =>
        topics.some((topic) => topic.id === mapping.topicId),
      ),
    ).toBe(true);
  });
});
