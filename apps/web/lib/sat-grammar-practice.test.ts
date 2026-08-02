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
const library = JSON.parse(
  readFileSync(new URL('../data/sat-grammar-library.json', import.meta.url), 'utf8'),
) as {
  chapters: Array<{
    id: string;
    sections: Array<{ rules: Array<{ id: string }> }>;
  }>;
};

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

  it('classifies every question into a valid chapter and knowledge point', () => {
    const pointToChapter = new Map(
      library.chapters.flatMap((chapter) =>
        chapter.sections.flatMap((section) =>
          section.rules.map((rule) => [rule.id, chapter.id] as const),
        ),
      ),
    );
    expect(
      practice.items.every(
        (item) =>
          item.knowledgePointTitle.length > 0 &&
          pointToChapter.get(item.knowledgePointId) === item.chapterId,
      ),
    ).toBe(true);
    expect(
      Object.values(practice.summary.chapterCounts).reduce((sum, count) => sum + count, 0),
    ).toBe(980);
    expect(
      Object.values(practice.summary.knowledgePointCounts).reduce((sum, count) => sum + count, 0),
    ).toBe(980);
    for (const chapterId of [
      'clause-boundaries',
      'commas-parentheticals',
      'semicolons-colons-dashes',
      'subject-verb-agreement',
      'pronouns',
      'modifiers',
      'verb-forms',
      'tense-voice-mood',
      'syntax-completeness',
      'parallelism',
      'possessives-apostrophes',
      'comparisons',
    ]) {
      expect(practice.summary.chapterCounts[chapterId]).toBeGreaterThan(0);
    }
  });
});
