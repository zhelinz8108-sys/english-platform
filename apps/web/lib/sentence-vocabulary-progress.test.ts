import { describe, expect, it } from 'vitest';
import type { SentenceVocabularyAssessmentPayload } from './sentence-vocabulary-assessment';
import {
  clearSentenceVocabularyProgress,
  createSentenceVocabularyProgress,
  loadSentenceVocabularyProgress,
  saveSentenceVocabularyProgress,
  sentenceVocabularyProgressKey,
  SENTENCE_VOCABULARY_PROGRESS_MAX_AGE_MS,
} from './sentence-vocabulary-progress';

class MemoryStorage {
  values = new Map<string, string>();
  removed: string[] = [];

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.removed.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function assessment(): SentenceVocabularyAssessmentPayload {
  const questions = Array.from({ length: 4 }, (_, index) => ({
    id: `q-${index}`,
    unitId: 'unit-1',
    unitTitle: 'Unit 1',
    word: `word${index}`,
    pronunciation: '',
    partOfSpeech: 'n',
    options: Array.from({ length: 4 }, (__, optionIndex) => ({
      id: `q-${index}-o-${optionIndex}`,
      label: `释义${optionIndex}`,
    })),
    correctOptionId: `q-${index}-o-0`,
  }));
  return {
    bookId: 'book-1',
    mode: 'sample-300',
    selectedUnitIds: ['unit-1'],
    sourceWordCount: 4,
    questionCount: 4,
    questions,
  };
}

describe('sentence vocabulary progress', () => {
  it('uses separate keys for student and workspace routes', () => {
    expect(sentenceVocabularyProgressKey('book-1', true)).not.toBe(
      sentenceVocabularyProgressKey('book-1', false),
    );
  });

  it('saves and restores valid unfinished progress', () => {
    const storage = new MemoryStorage();
    const key = sentenceVocabularyProgressKey('book-1', true);
    const progress = createSentenceVocabularyProgress(
      {
        bookId: 'book-1',
        mode: 'sample-300',
        selectedUnitIds: ['unit-1'],
        assessment: assessment(),
        answers: { 'q-0': 'q-0-o-0' },
        currentIndex: 1,
      },
      1_000,
    );

    saveSentenceVocabularyProgress(storage, key, progress);
    expect(loadSentenceVocabularyProgress(storage, key, 'book-1', ['unit-1'], 2_000)).toEqual(
      progress,
    );
  });

  it('clears expired, damaged and incompatible progress', () => {
    const storage = new MemoryStorage();
    const key = sentenceVocabularyProgressKey('book-1', false);
    const progress = createSentenceVocabularyProgress(
      {
        bookId: 'book-1',
        mode: 'sample-300',
        selectedUnitIds: ['unit-1'],
        assessment: assessment(),
        answers: {},
        currentIndex: 0,
      },
      1_000,
    );

    storage.setItem(key, JSON.stringify(progress));
    expect(
      loadSentenceVocabularyProgress(
        storage,
        key,
        'book-1',
        ['unit-1'],
        1_000 + SENTENCE_VOCABULARY_PROGRESS_MAX_AGE_MS + 1,
      ),
    ).toBeNull();

    storage.setItem(key, '{broken');
    expect(loadSentenceVocabularyProgress(storage, key, 'book-1', ['unit-1'], 2_000)).toBeNull();

    storage.setItem(key, JSON.stringify({ ...progress, version: 2 }));
    expect(loadSentenceVocabularyProgress(storage, key, 'book-1', ['unit-1'], 2_000)).toBeNull();
    expect(storage.removed).toEqual([key, key, key]);
  });

  it('clears progress when an assessment is restarted or completed', () => {
    const storage = new MemoryStorage();
    const key = sentenceVocabularyProgressKey('book-1', false);
    storage.setItem(key, '{}');
    clearSentenceVocabularyProgress(storage, key);
    expect(storage.getItem(key)).toBeNull();
  });
});
