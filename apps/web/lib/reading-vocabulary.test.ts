import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface VocabularyEntry {
  word: string;
  contextTerm: string;
  ipa: string;
  partOfSpeech: string;
  definition: string;
  context: string;
  contextTranslation: string;
}

interface VocabularyArticle {
  articleId: string;
  vocabulary: VocabularyEntry[];
}

interface VocabularyGradeDocument {
  grade: number;
  articles: VocabularyArticle[];
}

interface VocabularyIndex {
  articleCount: number;
  articlesWithVocabulary: number;
  totalVocabulary: number;
  items: Array<{ articleId: string; vocabularyCount: number }>;
}

interface ReadingIndex {
  items: Array<{ id: string }>;
}

const vocabularyIndex = JSON.parse(
  readFileSync(new URL('../data/commonlit-reading-vocabulary/index.json', import.meta.url), 'utf8'),
) as VocabularyIndex;
const readingIndex = JSON.parse(
  readFileSync(new URL('../data/commonlit-reading/index.json', import.meta.url), 'utf8'),
) as ReadingIndex;
const grades = Array.from({ length: 10 }, (_, index) => index + 3).map((grade) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../data/commonlit-reading-vocabulary/grade-${String(grade).padStart(2, '0')}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ),
) as VocabularyGradeDocument[];
const articles = grades.flatMap((grade) => grade.articles);
const vocabulary = articles.flatMap((article) => article.vocabulary);

describe('CommonLit reading vocabulary library', () => {
  it('adds vocabulary to every reading article', () => {
    expect(vocabularyIndex.articleCount).toBe(2448);
    expect(vocabularyIndex.articlesWithVocabulary).toBe(2448);
    expect(articles).toHaveLength(2448);
    expect(articles.every((article) => article.vocabulary.length > 0)).toBe(true);
    expect(new Set(articles.map((article) => article.articleId))).toEqual(
      new Set(readingIndex.items.map((item) => item.id)),
    );
  });

  it('deduplicates displayed dictionary headwords across the full library', () => {
    const normalizedWords = vocabulary.map((entry) =>
      entry.word.trim().toLocaleLowerCase('en').replace(/\s+/gu, ' '),
    );
    expect(vocabulary.length).toBeGreaterThan(20_000);
    expect(new Set(normalizedWords).size).toBe(vocabulary.length);
    expect(vocabularyIndex.totalVocabulary).toBe(vocabulary.length);
  });

  it('keeps every listening-style card complete and bilingual', () => {
    expect(
      vocabulary.every(
        (entry) =>
          entry.word &&
          entry.partOfSpeech &&
          /[\u3400-\u9fff]/u.test(entry.definition) &&
          entry.context &&
          new RegExp(`\\b${entry.contextTerm}\\b`, 'iu').test(entry.context) &&
          /[\u3400-\u9fff]/u.test(entry.contextTranslation),
      ),
    ).toBe(true);
  });

  it('keeps index counts aligned with per-grade documents', () => {
    const countByArticle = new Map(
      vocabularyIndex.items.map((item) => [item.articleId, item.vocabularyCount]),
    );
    expect(countByArticle.size).toBe(2448);
    expect(
      articles.every(
        (article) => countByArticle.get(article.articleId) === article.vocabulary.length,
      ),
    ).toBe(true);
  });
});
