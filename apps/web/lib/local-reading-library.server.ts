import 'server-only';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import indexDocument from '@/data/commonlit-reading/index.json';
import vocabularyIndexDocument from '@/data/commonlit-reading-vocabulary/index.json';

export interface LocalReadingOption {
  id: string;
  label: string;
}

export interface LocalReadingQuestion {
  id: string;
  number: number;
  prompt: string;
  options: LocalReadingOption[];
  kind: 'multiple-choice' | 'short-answer';
  sourceKind?: 'multiple-choice' | 'short-answer' | 'discussion';
  rewritten?: boolean;
}

export interface LocalReadingBlock {
  number: number;
  tag: 'p' | 'blockquote' | 'h2' | 'h3' | 'li';
  text: string;
}

export interface LocalReadingVocabularyEntry {
  word: string;
  contextTerm: string;
  ipa: string;
  partOfSpeech: string;
  definition: string;
  englishDefinition: string;
  context: string;
  contextTranslation: string;
}

export interface LocalReadingArticle {
  id: string;
  grade: number;
  sequence: number;
  title: string;
  subtitle: string;
  author: string;
  publicationYear: string;
  description: string;
  lexile: number | null;
  category: string;
  slug: string;
  intro: string;
  annotationTask: string;
  permissions: string;
  isPoem: boolean;
  wordCount: number;
  blocks: LocalReadingBlock[];
  pageCount: number;
  questions: LocalReadingQuestion[];
  discussionQuestions: LocalReadingQuestion[];
  vocabulary: LocalReadingVocabularyEntry[];
  vocabularyCount: number;
  answerBankStatus?: 'ready' | 'missing';
  answerBankReviewed?: boolean;
  pdfRelativePath: string;
  pdfSizeBytes: number;
  sourceUrl: string;
}

export interface LocalReadingIndexItem {
  id: string;
  grade: number;
  sequence: number;
  title: string;
  author: string;
  publicationYear: string;
  description: string;
  lexile: number | null;
  category: string;
  wordCount: number;
  pageCount: number;
  questionCount: number;
  discussionQuestionCount: number;
  vocabularyCount: number;
}

interface LocalReadingGradeSummary {
  grade: number;
  label: string;
  count: number;
  pageCount: number;
  questionCount: number;
}

interface LocalReadingIndex {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  totalCount: number;
  totalPages: number;
  totalQuestions: number;
  totalDiscussionQuestions: number;
  grades: LocalReadingGradeSummary[];
  items: LocalReadingIndexItem[];
}

interface LocalReadingGradeDocument {
  schemaVersion: number;
  grade: number;
  articles: LocalReadingArticle[];
}

interface LocalReadingVocabularyArticle {
  articleId: string;
  vocabulary: LocalReadingVocabularyEntry[];
}

interface LocalReadingVocabularyGradeDocument {
  schemaVersion: number;
  generatedAt: string;
  grade: number;
  articles: LocalReadingVocabularyArticle[];
}

interface LocalReadingVocabularyIndex {
  generatedAt: string;
  totalVocabulary: number;
  items: Array<{ articleId: string; vocabularyCount: number }>;
}

interface LocalReadingAnswerQuestion {
  id: string;
  sourceKind: 'multiple-choice' | 'short-answer' | 'discussion';
  rewritten: boolean;
  prompt?: string;
  options?: LocalReadingOption[];
  answer: string;
  evidence: number[];
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

interface LocalReadingAnswerArticle {
  articleId: string;
  reviewed: boolean;
  questions: LocalReadingAnswerQuestion[];
}

interface LocalReadingAnswerGradeDocument {
  schemaVersion: number;
  grade: number;
  articles: LocalReadingAnswerArticle[];
}

export interface LocalReadingAnswerResult {
  questionId: string;
  selectedOptionId: string | null;
  correctOptionId: string;
  correct: boolean;
  evidence: number[];
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  rewritten: boolean;
  sourceKind: 'multiple-choice' | 'short-answer' | 'discussion';
}

export interface LocalReadingCheckResult {
  articleId: string;
  answeredCount: number;
  correctCount: number;
  totalCount: number;
  percentage: number;
  reviewed: boolean;
  results: LocalReadingAnswerResult[];
}

const libraryIndex = indexDocument as LocalReadingIndex;
const vocabularyIndex = vocabularyIndexDocument as LocalReadingVocabularyIndex;
const itemById = new Map(libraryIndex.items.map((item) => [item.id, item]));
const vocabularyCountById = new Map(
  vocabularyIndex.items.map((item) => [item.articleId, item.vocabularyCount]),
);
const gradeCache = new Map<number, Promise<LocalReadingGradeDocument>>();
const vocabularyGradeCache = new Map<number, Promise<LocalReadingVocabularyGradeDocument>>();

const sourceRoot =
  process.env.COMMONLIT_READING_SOURCE_DIR ?? 'D:\\留学\\托福\\阅读\\output\\pdf\\CommonLit';

function dataRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? path.join(cwd, 'data', 'commonlit-reading')
    : path.join(cwd, 'apps', 'web', 'data', 'commonlit-reading');
}

function answerDataRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? path.join(cwd, 'data', 'commonlit-reading-answers')
    : path.join(cwd, 'apps', 'web', 'data', 'commonlit-reading-answers');
}

function vocabularyDataRoot(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? path.join(cwd, 'data', 'commonlit-reading-vocabulary')
    : path.join(cwd, 'apps', 'web', 'data', 'commonlit-reading-vocabulary');
}

async function readGrade(grade: number): Promise<LocalReadingGradeDocument> {
  const existing = gradeCache.get(grade);
  if (existing) return existing;
  const pending = readFile(
    path.join(dataRoot(), `grade-${String(grade).padStart(2, '0')}.json`),
    'utf8',
  )
    .then((content) => JSON.parse(content) as LocalReadingGradeDocument)
    .catch((error: unknown) => {
      gradeCache.delete(grade);
      throw error;
    });
  gradeCache.set(grade, pending);
  return pending;
}

async function readAnswerGrade(grade: number): Promise<LocalReadingAnswerGradeDocument | null> {
  return readFile(
    path.join(answerDataRoot(), `grade-${String(grade).padStart(2, '0')}.json`),
    'utf8',
  )
    .then((content) => JSON.parse(content) as LocalReadingAnswerGradeDocument)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
}

async function readVocabularyGrade(grade: number): Promise<LocalReadingVocabularyGradeDocument> {
  const existing = vocabularyGradeCache.get(grade);
  if (existing) return existing;
  const pending = readFile(
    path.join(vocabularyDataRoot(), `grade-${String(grade).padStart(2, '0')}.json`),
    'utf8',
  )
    .then((content) => JSON.parse(content) as LocalReadingVocabularyGradeDocument)
    .catch((error: unknown) => {
      vocabularyGradeCache.delete(grade);
      throw error;
    });
  vocabularyGradeCache.set(grade, pending);
  return pending;
}

function findSourceQuestion(
  article: LocalReadingArticle,
  questionId: string,
): LocalReadingQuestion | undefined {
  return [...article.questions, ...article.discussionQuestions].find(
    (question) => question.id === questionId,
  );
}

function mergeAnswerBank(
  article: LocalReadingArticle,
  answerArticle: LocalReadingAnswerArticle | undefined,
): LocalReadingArticle {
  if (!answerArticle) return { ...article, answerBankStatus: 'missing' };
  const questions = answerArticle.questions.map((answerQuestion, index) => {
    const source = findSourceQuestion(article, answerQuestion.id);
    if (!source) {
      throw new Error(`Answer bank references missing question ${article.id}/${answerQuestion.id}`);
    }
    return {
      id: answerQuestion.id,
      number: index + 1,
      prompt: answerQuestion.rewritten ? (answerQuestion.prompt ?? '') : source.prompt,
      options: answerQuestion.rewritten ? (answerQuestion.options ?? []) : source.options,
      kind: 'multiple-choice' as const,
      sourceKind: answerQuestion.sourceKind,
      rewritten: answerQuestion.rewritten,
    };
  });
  return {
    ...article,
    questions,
    discussionQuestions: [],
    answerBankStatus: 'ready',
    answerBankReviewed: answerArticle.reviewed,
  };
}

function mergeVocabulary(
  article: LocalReadingArticle,
  vocabularyArticle: LocalReadingVocabularyArticle | undefined,
): LocalReadingArticle {
  const vocabulary = vocabularyArticle?.vocabulary ?? [];
  return {
    ...article,
    vocabulary,
    vocabularyCount: vocabulary.length,
  };
}

export function localReadingEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.ENABLE_LOCAL_READING === 'true'
  );
}

export function getLocalReadingSummary() {
  const totalQuestions = libraryIndex.totalQuestions + libraryIndex.totalDiscussionQuestions;
  const questionCountByGrade = new Map<number, number>();
  for (const item of libraryIndex.items) {
    questionCountByGrade.set(
      item.grade,
      (questionCountByGrade.get(item.grade) ?? 0) +
        item.questionCount +
        item.discussionQuestionCount,
    );
  }
  return {
    generatedAt: libraryIndex.generatedAt,
    totalCount: libraryIndex.totalCount,
    totalPages: libraryIndex.totalPages,
    totalQuestions,
    totalDiscussionQuestions: 0,
    totalVocabulary: vocabularyIndex.totalVocabulary,
    grades: libraryIndex.grades.map((grade) => ({
      ...grade,
      questionCount: questionCountByGrade.get(grade.grade) ?? grade.questionCount,
    })),
  };
}

export function listLocalReadingItems(grade: number, query: string): LocalReadingIndexItem[] {
  const normalized = query.trim().toLocaleLowerCase('en');
  return libraryIndex.items
    .filter(
    (item) =>
      item.grade === grade &&
      (!normalized ||
        item.title.toLocaleLowerCase('en').includes(normalized) ||
        item.author.toLocaleLowerCase('en').includes(normalized) ||
        item.category.toLocaleLowerCase('en').includes(normalized) ||
        String(item.sequence).includes(normalized) ||
        String(item.lexile ?? '').includes(normalized)),
    )
    .map((item) => ({
      ...item,
      questionCount: item.questionCount + item.discussionQuestionCount,
      discussionQuestionCount: 0,
      vocabularyCount: vocabularyCountById.get(item.id) ?? 0,
    }));
}

export async function getLocalReadingArticle(id: string): Promise<LocalReadingArticle | null> {
  const indexItem = itemById.get(id);
  if (!indexItem) return null;
  const document = await readGrade(indexItem.grade);
  const article = document.articles.find((candidate) => candidate.id === id);
  if (!article) return null;
  const [answerDocument, vocabularyDocument] = await Promise.all([
    readAnswerGrade(indexItem.grade),
    readVocabularyGrade(indexItem.grade),
  ]);
  const answerArticle = answerDocument?.articles.find((candidate) => candidate.articleId === id);
  const vocabularyArticle = vocabularyDocument.articles.find(
    (candidate) => candidate.articleId === id,
  );
  return mergeVocabulary(mergeAnswerBank(article, answerArticle), vocabularyArticle);
}

export async function checkLocalReadingAnswers(
  id: string,
  submittedAnswers: Record<string, string>,
): Promise<LocalReadingCheckResult | null> {
  const indexItem = itemById.get(id);
  if (!indexItem) return null;
  const answerDocument = await readAnswerGrade(indexItem.grade);
  const answerArticle = answerDocument?.articles.find((candidate) => candidate.articleId === id);
  if (!answerArticle) return null;
  const results = answerArticle.questions.map((question): LocalReadingAnswerResult => {
    const selectedOptionId = submittedAnswers[question.id]?.trim().toLocaleLowerCase('en') || null;
    return {
      questionId: question.id,
      selectedOptionId,
      correctOptionId: question.answer,
      correct: selectedOptionId === question.answer,
      evidence: question.evidence,
      explanation: question.explanation,
      confidence: question.confidence,
      rewritten: question.rewritten,
      sourceKind: question.sourceKind,
    };
  });
  const correctCount = results.filter((result) => result.correct).length;
  const answeredCount = results.filter((result) => result.selectedOptionId !== null).length;
  return {
    articleId: id,
    answeredCount,
    correctCount,
    totalCount: results.length,
    percentage: results.length ? Math.round((correctCount / results.length) * 100) : 0,
    reviewed: answerArticle.reviewed,
    results,
  };
}

export async function resolveLocalReadingPdf(
  article: LocalReadingArticle,
): Promise<{ path: string; size: number } | null> {
  const root = path.resolve(/* turbopackIgnore: true */ sourceRoot);
  const candidate = path.resolve(root, ...article.pdfRelativePath.split('/'));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(candidate);
    return info.isFile() ? { path: candidate, size: info.size } : null;
  } catch {
    return null;
  }
}
