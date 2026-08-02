import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SAT_GRAMMAR_RANDOM_SESSION_SIZE,
  selectSatGrammarSessionItems,
  type SatGrammarPracticeLibrary,
} from './sat-grammar';

const practice = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-practice.json', import.meta.url), 'utf8'),
) as SatGrammarPracticeLibrary;

describe('SAT grammar interactive practice library', () => {
  it('publishes every complete question and excludes source pages that are not questions', () => {
    expect(practice.summary).toMatchObject({
      sourceItemCount: 985,
      interactiveItemCount: 980,
      excludedItemCount: 5,
      gradableItemCount: 448,
      pendingVerificationCount: 531,
      conflictReviewCount: 1,
      embeddedItemCount: 980,
      imageItemCount: 0,
      textItemCount: 980,
    });
    expect(practice.items).toHaveLength(980);
    expect(new Set(practice.items.map((item) => item.id)).size).toBe(980);
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

  it('ships every question as selectable native text with four complete choices', () => {
    expect(
      practice.items.every(
        (item) =>
          item.questionText.length >= 45 &&
          item.questionText.includes('Which choice completes the text') &&
          item.choiceTexts.length === 4 &&
          item.choiceTexts.every((choice) => choice.trim().length > 0) &&
          !('asset' in item),
      ),
    ).toBe(true);
  });

  it('opens the full library by default and limits only explicit random sessions', () => {
    expect(selectSatGrammarSessionItems(practice.items, 'full')).toHaveLength(980);
    expect(selectSatGrammarSessionItems(practice.items, 'random')).toHaveLength(
      SAT_GRAMMAR_RANDOM_SESSION_SIZE,
    );
  });
});
