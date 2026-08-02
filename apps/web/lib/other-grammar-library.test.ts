import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import otherGrammarLibrary from '@/data/other-grammar-library';
import type { SatGrammarLibrary } from './sat-grammar';

const satLibrary = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-library.json', import.meta.url), 'utf8'),
) as SatGrammarLibrary;
const chapters = otherGrammarLibrary.chapters;
const rules = chapters.flatMap((chapter) => chapter.sections.flatMap((section) => section.rules));
const satRuleTitles = new Set(
  satLibrary.chapters.flatMap((chapter) =>
    chapter.sections.flatMap((section) => section.rules.map((rule) => rule.title)),
  ),
);

describe('Cambridge grammar complement course', () => {
  it('publishes 13 top-to-bottom chapters with 92 non-duplicate knowledge points', () => {
    expect(otherGrammarLibrary.version).toBe('cambridge-grammar-complement-v1');
    expect(otherGrammarLibrary.summary).toEqual({
      chapterCount: 13,
      appendixCount: 0,
      ruleCount: 92,
      examplePairCount: 92,
    });
    expect(chapters).toHaveLength(13);
    expect(chapters.every((chapter) => chapter.sections.length === 1)).toBe(true);
  });

  it('does not repeat any SAT rule title', () => {
    expect(rules.filter((rule) => satRuleTitles.has(rule.title))).toEqual([]);
  });

  it('gives every knowledge point an explanation, method, reminder, and example pair', () => {
    expect(rules).toHaveLength(92);
    expect(
      rules.every(
        (rule) =>
          rule.core.length > 0 &&
          rule.method.length > 0 &&
          rule.trap.length > 0 &&
          rule.examples.length === 1 &&
          Boolean(rule.examples[0]?.correct) &&
          Boolean(rule.examples[0]?.incorrect),
      ),
    ).toBe(true);
  });

  it('attributes the three Cambridge levels and records the SAT deduplication scope', () => {
    expect(otherGrammarLibrary.source.fileName).toContain('剑桥初级英语语法');
    expect(otherGrammarLibrary.source.fileName).toContain('剑桥中级英语语法');
    expect(otherGrammarLibrary.source.fileName).toContain('剑桥高级英语语法');
    expect(otherGrammarLibrary.source.scope).toContain('SAT 的 129 条规则');
  });
});
