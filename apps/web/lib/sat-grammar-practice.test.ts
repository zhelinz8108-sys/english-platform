import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SatGrammarPracticeLibrary } from './sat-grammar';

const practice = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-practice.json', import.meta.url), 'utf8'),
) as SatGrammarPracticeLibrary;

describe('SAT grammar interactive practice library', () => {
  it('publishes all 985 deduplicated source questions', () => {
    expect(practice.summary).toMatchObject({
      sourceItemCount: 985,
      interactiveItemCount: 985,
      excludedItemCount: 0,
      gradableItemCount: 449,
      pendingVerificationCount: 535,
      conflictReviewCount: 1,
      imageItemCount: 955,
      textItemCount: 30,
    });
    expect(practice.items).toHaveLength(985);
    expect(new Set(practice.items.map((item) => item.id)).size).toBe(985);
  });

  it('grades only source-backed answers and labels every record', () => {
    expect(
      practice.items.every(
        (item) =>
          item.chapterId.length > 0 &&
          item.explanation.length > 0 &&
          (item.gradable
            ? item.answer !== null &&
              ['A', 'B', 'C', 'D'].includes(item.answer) &&
              ['original_answer', 'inferred_duplicate'].includes(item.answerStatus)
            : item.answer === null &&
              ['pending_verification', 'conflict_review'].includes(item.answerStatus)),
      ),
    ).toBe(true);
  });

  it('ships an answer-free image or a native text surface for every question', () => {
    const publicDirectory = fileURLToPath(new URL('../public', import.meta.url));
    expect(
      practice.items.every((item) => {
        if (item.asset) {
          return (
            item.assetWidth !== null &&
            item.assetWidth > 0 &&
            item.assetHeight !== null &&
            item.assetHeight > 0 &&
            existsSync(resolve(publicDirectory, item.asset.replace(/^\//, '')))
          );
        }
        return item.questionText !== null && item.questionText.length > 0;
      }),
    ).toBe(true);
  });
});
