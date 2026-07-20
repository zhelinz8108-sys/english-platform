import { describe, expect, it } from 'vitest';
import type { VocabularyBookUnitContent } from '@/data/vocabulary-library';
import {
  createSentenceVocabularyQuestions,
  extractSentenceVocabularyEntries,
  type SentenceVocabularyEntry,
} from './sentence-vocabulary-assessment';

describe('sentence vocabulary assessment', () => {
  it('extracts the headword, pronunciation, part of speech and Chinese definition', () => {
    const content: VocabularyBookUnitContent = {
      schemaVersion: 1,
      bookId: 'toefl-sentences',
      unitId: 'sentence-001',
      title: 'Sentence 01',
      sectionId: 'sentences-001',
      sectionTitle: 'Sentence 01-10',
      pageStart: 15,
      pageEnd: 15,
      extractionMethod: 'text-layer',
      wordEntryCount: 1,
      duplicateEntryCount: 0,
      pages: [
        {
          number: 15,
          blocks: [
            {
              type: 'entry',
              text: 'essentially /ɪˈsenʃəli/ ad. 本质上；基本上',
              headword: 'essentially',
            },
            {
              type: 'entry',
              text: 'bilingual /ˌbaɪˈlɪŋɡwəl/ a. （说）两种语言的',
              headword: 'bilingual',
            },
          ],
        },
      ],
    };

    expect(extractSentenceVocabularyEntries(content)).toEqual([
      expect.objectContaining({
        definition: '本质上；基本上',
        partOfSpeech: 'adv',
        pronunciation: '/ɪˈsenʃəli/',
        word: 'essentially',
      }),
      expect.objectContaining({ definition: '（说）两种语言的', word: 'bilingual' }),
    ]);
  });

  it('creates four unique Chinese options and limits sample mode to 100 questions', () => {
    const entries: SentenceVocabularyEntry[] = Array.from({ length: 120 }, (_, index) => ({
      id: `sentence-001:word-${index}`,
      unitId: 'sentence-001',
      unitTitle: 'Sentence 01',
      word: `word${index}`,
      pronunciation: `/word${index}/`,
      partOfSpeech: index % 2 === 0 ? 'n' : 'v',
      definition: `释义${index}`,
    }));
    const questions = createSentenceVocabularyQuestions(entries, 'sample-100', () => 0.25);

    expect(questions).toHaveLength(100);
    expect(questions.every((question) => question.options.length === 4)).toBe(true);
    expect(
      questions.every(
        (question) => new Set(question.options.map((option) => option.label)).size === 4,
      ),
    ).toBe(true);
    expect(
      questions.every((question) =>
        question.options.some((option) => option.id === question.correctOptionId),
      ),
    ).toBe(true);
    expect(createSentenceVocabularyQuestions(entries, 'all', () => 0.25)).toHaveLength(120);
  });
});
