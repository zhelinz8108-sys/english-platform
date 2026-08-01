import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SatGrammarLibrary } from './sat-grammar';

const library = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-library.json', import.meta.url), 'utf8'),
) as SatGrammarLibrary;
const entries = [...library.chapters, ...library.appendices];
const rules = entries.flatMap((entry) => entry.sections.flatMap((section) => section.rules));

describe('complete SAT grammar course', () => {
  it('publishes the Word document as 14 chapters and 2 appendices', () => {
    expect(library.version).toBe('sat-grammar-complete-v1');
    expect(library.summary).toEqual({
      chapterCount: 14,
      appendixCount: 2,
      ruleCount: 129,
      examplePairCount: 129,
    });
    expect(library.chapters).toHaveLength(14);
    expect(library.appendices).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(16);
  });

  it('keeps the source chapter order', () => {
    expect(library.chapters.map((chapter) => chapter.title)).toEqual([
      '语法题总解题框架',
      '分句、句界与连接方式',
      '逗号、插入语与补充成分',
      '分号、冒号、破折号与综合标点',
      '主谓一致',
      '代词指代与格',
      '修饰语',
      '动词形式与非谓语',
      '动词时态、语态与语气',
      '句法与语意完整性',
      '平行结构',
      '所有格与撇号',
      '比较结构',
      '综合易错点与考场检查表',
    ]);
  });

  it('keeps every rule explanation and its correct/incorrect example pair', () => {
    expect(rules).toHaveLength(129);
    expect(
      rules.every(
        (rule) =>
          rule.core.length > 0 &&
          rule.method.length > 0 &&
          rule.trap.length > 0 &&
          rule.examples.length === 1 &&
          rule.examples[0]?.correct.length &&
          rule.examples[0]?.incorrect.length,
      ),
    ).toBe(true);
  });

  it('retains the exam checklist and appendix reference tables', () => {
    const checklist = library.chapters.at(-1);
    expect(checklist?.sections.flatMap((section) => section.lists)).not.toHaveLength(0);
    expect(
      library.appendices.every((appendix) =>
        appendix.sections.some((section) => section.tables.length > 0),
      ),
    ).toBe(true);
  });
});
