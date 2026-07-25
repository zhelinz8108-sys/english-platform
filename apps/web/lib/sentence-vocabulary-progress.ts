import {
  isSentenceVocabularyAssessmentMode,
  type SentenceVocabularyAssessmentMode,
  type SentenceVocabularyAssessmentPayload,
  type SentenceVocabularyQuestion,
} from './sentence-vocabulary-assessment';

export const SENTENCE_VOCABULARY_PROGRESS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const PROGRESS_VERSION = 1;

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface SentenceVocabularyProgress {
  version: typeof PROGRESS_VERSION;
  savedAt: number;
  bookId: string;
  mode: SentenceVocabularyAssessmentMode;
  selectedUnitIds: string[];
  assessment: SentenceVocabularyAssessmentPayload;
  answers: Record<string, string>;
  currentIndex: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuestion(value: unknown): value is SentenceVocabularyQuestion {
  if (!isRecord(value) || !Array.isArray(value.options) || value.options.length !== 4) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.unitId !== 'string' ||
    typeof value.unitTitle !== 'string' ||
    typeof value.word !== 'string' ||
    typeof value.pronunciation !== 'string' ||
    typeof value.partOfSpeech !== 'string' ||
    typeof value.correctOptionId !== 'string'
  ) {
    return false;
  }
  const optionsValid = value.options.every(
    (option) =>
      isRecord(option) && typeof option.id === 'string' && typeof option.label === 'string',
  );
  return optionsValid && value.options.some((option) => option.id === value.correctOptionId);
}

function parseProgress(
  raw: string,
  bookId: string,
  allowedUnitIds: readonly string[],
  now: number,
): SentenceVocabularyProgress | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== PROGRESS_VERSION) return null;
  if (
    typeof value.savedAt !== 'number' ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt > now + 60_000 ||
    now - value.savedAt > SENTENCE_VOCABULARY_PROGRESS_MAX_AGE_MS ||
    value.bookId !== bookId ||
    !isSentenceVocabularyAssessmentMode(value.mode) ||
    !Array.isArray(value.selectedUnitIds) ||
    !value.selectedUnitIds.every((unitId) => typeof unitId === 'string') ||
    !Number.isInteger(value.currentIndex) ||
    !isRecord(value.assessment) ||
    !isRecord(value.answers)
  ) {
    return null;
  }

  const selectedUnitIds = value.selectedUnitIds as string[];
  const allowedUnitIdSet = new Set(allowedUnitIds);
  if (!selectedUnitIds.length || selectedUnitIds.some((unitId) => !allowedUnitIdSet.has(unitId))) {
    return null;
  }

  const assessment = value.assessment;
  if (
    assessment.bookId !== bookId ||
    assessment.mode !== value.mode ||
    !Array.isArray(assessment.selectedUnitIds) ||
    assessment.selectedUnitIds.length !== selectedUnitIds.length ||
    !assessment.selectedUnitIds.every((unitId, index) => unitId === selectedUnitIds[index]) ||
    typeof assessment.sourceWordCount !== 'number' ||
    typeof assessment.questionCount !== 'number' ||
    !Array.isArray(assessment.questions) ||
    assessment.questionCount !== assessment.questions.length ||
    assessment.questionCount < 4 ||
    !assessment.questions.every(isQuestion) ||
    (value.currentIndex as number) < 0 ||
    (value.currentIndex as number) >= assessment.questionCount
  ) {
    return null;
  }

  const questionById = new Map(
    (assessment.questions as SentenceVocabularyQuestion[]).map((question) => [
      question.id,
      question,
    ]),
  );
  const answers = value.answers as Record<string, unknown>;
  if (
    !Object.entries(answers).every(([questionId, optionId]) => {
      const question = questionById.get(questionId);
      return (
        question !== undefined &&
        typeof optionId === 'string' &&
        question.options.some((option) => option.id === optionId)
      );
    })
  ) {
    return null;
  }

  return value as unknown as SentenceVocabularyProgress;
}

export function sentenceVocabularyProgressKey(bookId: string, studentRoute: boolean) {
  const scope = studentRoute ? 'student' : 'workspace';
  return `aurelis:vocabulary-check:${scope}:${bookId}:v1`;
}

export function createSentenceVocabularyProgress(
  value: Omit<SentenceVocabularyProgress, 'savedAt' | 'version'>,
  now: number = Date.now(),
): SentenceVocabularyProgress {
  return { ...value, savedAt: now, version: PROGRESS_VERSION };
}

export function loadSentenceVocabularyProgress(
  storage: StorageLike,
  key: string,
  bookId: string,
  allowedUnitIds: readonly string[],
  now: number = Date.now(),
): SentenceVocabularyProgress | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const progress = parseProgress(raw, bookId, allowedUnitIds, now);
    if (!progress) storage.removeItem(key);
    return progress;
  } catch {
    return null;
  }
}

export function saveSentenceVocabularyProgress(
  storage: StorageLike,
  key: string,
  progress: SentenceVocabularyProgress,
) {
  try {
    storage.setItem(key, JSON.stringify(progress));
  } catch {
    // Storage may be unavailable or full; the assessment remains usable in memory.
  }
}

export function clearSentenceVocabularyProgress(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore unavailable storage; there is no server-side progress to clear.
  }
}
