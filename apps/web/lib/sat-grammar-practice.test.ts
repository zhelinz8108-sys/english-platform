import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SatGrammarPracticeLibrary } from './sat-grammar';

const practice = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-practice.json', import.meta.url), 'utf8'),
) as SatGrammarPracticeLibrary;

describe('SAT grammar interactive practice library', () => {
  it('publishes 275 complete, source-answered questions', () => {
    expect(practice.summary).toMatchObject({
      sourceItemCount: 985,
      interactiveItemCount: 275,
      excludedItemCount: 710,
    });
    expect(practice.items).toHaveLength(275);
    expect(new Set(practice.items.map((item) => item.id)).size).toBe(275);
  });

  it('contains only gradable four-choice records with chapter mappings', () => {
    expect(
      practice.items.every(
        (item) =>
          ['A', 'B', 'C', 'D'].includes(item.answer) &&
          ['original_answer', 'inferred_duplicate'].includes(item.answerStatus) &&
          item.chapterId.length > 0 &&
          item.explanation.length > 0 &&
          item.assetWidth > 0 &&
          item.assetHeight > 0,
      ),
    ).toBe(true);
  });

  it('ships every safe question image referenced by the catalog', () => {
    const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));
    expect(
      practice.items.every((item) =>
        existsSync(resolve(publicDirectory, item.asset.replace(/^\//, ''))),
      ),
    ).toBe(true);
  });
});
