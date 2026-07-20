import 'server-only';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import libraryDocument from '@/data/listening-library.json';

export type LocalListeningCollectionId = 'minute-earth' | 'bbc-6-minute-english';

export interface LocalVocabularyEntry {
  word: string;
  ipa: string;
  partOfSpeech: string;
  definition: string;
  englishDefinition: string;
  context: string;
  contextTranslation: string;
}

export interface LocalListeningItem {
  id: string;
  collection: LocalListeningCollectionId;
  sequence: number;
  title: string;
  year: number | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  audioPath: string | null;
  documentPath: string | null;
  transcriptWordCount: number;
  transcript: string;
  vocabulary: LocalVocabularyEntry[];
}

export type LocalListeningQuestionType =
  'main_idea' | 'detail' | 'rhetorical_purpose' | 'inference' | 'organization' | 'prediction';

export interface LocalListeningQuestionOption {
  id: 'a' | 'b' | 'c' | 'd';
  text: string;
}

export interface LocalListeningPublicQuestion {
  id: string;
  position: number;
  type: LocalListeningQuestionType;
  difficulty: 'low' | 'medium' | 'high';
  prompt: string;
  options: LocalListeningQuestionOption[];
}

export interface LocalListeningPublicQuestionSet {
  sourceId: string;
  label: string;
  exactSimulation: boolean;
  reviewStatus: 'reviewed' | 'adjudicated' | 'approved';
  questions: LocalListeningPublicQuestion[];
}

interface LocalListeningEvidenceSpan {
  start: number;
  end: number;
  quote: string;
}

interface LocalListeningPrivateQuestion {
  answer: 'a' | 'b' | 'c' | 'd';
  evidence: LocalListeningEvidenceSpan[];
  explanationZh: string;
  optionRationalesZh: Record<'a' | 'b' | 'c' | 'd', string>;
}

interface LocalListeningQuestionBankQuestion {
  id: string;
  position: number;
  type: LocalListeningQuestionType;
  difficulty: 'low' | 'medium' | 'high';
  public: {
    prompt: string;
    options: LocalListeningQuestionOption[];
  };
  private: LocalListeningPrivateQuestion;
}

interface LocalListeningQuestionBankSet {
  sourceId: string;
  sourceHash: string;
  label: string;
  exactSimulation: boolean;
  status: 'draft' | 'reviewed' | 'needs_adjudication' | 'adjudicated' | 'approved';
  questions: LocalListeningQuestionBankQuestion[];
}

interface LocalListeningQuestionBankDocument {
  schemaVersion: number;
  skillVersion: string;
  sets: LocalListeningQuestionBankSet[];
}

export type LocalListeningQuestionBankStatus = 'ready' | 'generating' | 'missing-transcript';

export interface LocalListeningAnswerEvidence extends LocalListeningEvidenceSpan {
  region: '开头' | '中段' | '结尾';
  progressPercent: number;
}

export interface LocalListeningAnswerResult {
  questionId: string;
  selectedOptionId: string | null;
  correctOptionId: 'a' | 'b' | 'c' | 'd';
  correct: boolean;
  explanationZh: string;
  optionRationalesZh: Record<'a' | 'b' | 'c' | 'd', string>;
  evidence: LocalListeningAnswerEvidence[];
}

export interface LocalListeningCheckResult {
  sourceId: string;
  answeredCount: number;
  correctCount: number;
  totalCount: number;
  percentage: number;
  reviewStatus: 'reviewed' | 'adjudicated' | 'approved';
  results: LocalListeningAnswerResult[];
  studyAids: {
    transcriptWordCount: number;
    transcript: string;
    vocabulary: LocalVocabularyEntry[];
  };
}

interface LocalListeningCollection {
  id: LocalListeningCollectionId;
  label: string;
  description: string;
  count: number;
}

interface LocalListeningLibrary {
  schemaVersion: number;
  generatedAt: string;
  collections: LocalListeningCollection[];
  items: LocalListeningItem[];
}

const library = libraryDocument as LocalListeningLibrary;
const itemById = new Map(library.items.map((item) => [item.id, item]));
let questionBankCache: {
  modifiedAtMs: number;
  document: LocalListeningQuestionBankDocument;
} | null = null;

const sourceRoots: Record<LocalListeningCollectionId, string> = {
  'minute-earth':
    process.env.MINUTE_EARTH_SOURCE_DIR ?? 'D:\\留学\\托福\\听力\\Minute Earth_仅讲话',
  'bbc-6-minute-english':
    process.env.BBC_LISTENING_SOURCE_DIR ??
    'D:\\留学\\托福\\听力\\【BBC】08-23年+bbc+6分钟英语等多个文件',
};

function questionBankPath(): string {
  const cwd = process.cwd();
  return cwd.endsWith(`${path.sep}apps${path.sep}web`)
    ? path.join(cwd, 'data', 'toefl-academic-listening-questions', 'question-bank.json')
    : path.join(
        cwd,
        'apps',
        'web',
        'data',
        'toefl-academic-listening-questions',
        'question-bank.json',
      );
}

async function readQuestionBank(): Promise<LocalListeningQuestionBankDocument> {
  const filePath = questionBankPath();
  try {
    const info = await stat(filePath);
    if (questionBankCache?.modifiedAtMs === info.mtimeMs) return questionBankCache.document;
    const document = JSON.parse(
      await readFile(filePath, 'utf8'),
    ) as LocalListeningQuestionBankDocument;
    questionBankCache = { modifiedAtMs: info.mtimeMs, document };
    return document;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, skillVersion: '1.0.0', sets: [] };
    }
    throw error;
  }
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function listeningSourceHash(item: LocalListeningItem): string {
  const canonical = JSON.stringify({
    collection: compactText(item.collection),
    durationSeconds: item.durationSeconds,
    sourceId: compactText(item.id),
    title: compactText(item.title),
    transcript: item.transcript,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

async function readyQuestionSet(id: string): Promise<LocalListeningQuestionBankSet | null> {
  const item = itemById.get(id);
  if (!item) return null;
  const bank = await readQuestionBank();
  const questionSet = bank.sets.find((candidate) => candidate.sourceId === id);
  if (!questionSet) return null;
  if (!['reviewed', 'adjudicated', 'approved'].includes(questionSet.status)) return null;
  if (questionSet.sourceHash !== listeningSourceHash(item)) return null;
  if (questionSet.questions.length !== 4) return null;
  return questionSet;
}

function evidenceRegion(start: number, transcriptLength: number): '开头' | '中段' | '结尾' {
  const ratio = transcriptLength > 0 ? start / transcriptLength : 0;
  if (ratio < 1 / 3) return '开头';
  if (ratio < 2 / 3) return '中段';
  return '结尾';
}

export function localListeningEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || process.env.ENABLE_LOCAL_LISTENING === 'true'
  );
}

export function getLocalListeningCollections(): LocalListeningCollection[] {
  return library.collections;
}

export function getLocalListeningItem(id: string): LocalListeningItem | null {
  return itemById.get(id) ?? null;
}

export async function getLocalListeningQuestionSet(
  id: string,
): Promise<LocalListeningPublicQuestionSet | null> {
  const questionSet = await readyQuestionSet(id);
  if (!questionSet) return null;
  return {
    sourceId: questionSet.sourceId,
    label: questionSet.label,
    exactSimulation: questionSet.exactSimulation,
    reviewStatus: questionSet.status as 'reviewed' | 'adjudicated' | 'approved',
    questions: questionSet.questions.map((question) => ({
      id: question.id,
      position: question.position,
      type: question.type,
      difficulty: question.difficulty,
      prompt: question.public.prompt,
      options: question.public.options,
    })),
  };
}

export async function getLocalListeningQuestionBankStatus(
  id: string,
): Promise<LocalListeningQuestionBankStatus> {
  const item = itemById.get(id);
  if (!item || item.transcriptWordCount < 20) return 'missing-transcript';
  return (await readyQuestionSet(id)) ? 'ready' : 'generating';
}

export async function checkLocalListeningAnswers(
  id: string,
  submittedAnswers: Record<string, string>,
): Promise<LocalListeningCheckResult | null> {
  const item = itemById.get(id);
  const questionSet = await readyQuestionSet(id);
  if (!item || !questionSet) return null;
  const results = questionSet.questions.map((question): LocalListeningAnswerResult => {
    const selectedOptionId = submittedAnswers[question.id]?.trim().toLocaleLowerCase('en') || null;
    return {
      questionId: question.id,
      selectedOptionId,
      correctOptionId: question.private.answer,
      correct: selectedOptionId === question.private.answer,
      explanationZh: question.private.explanationZh,
      optionRationalesZh: question.private.optionRationalesZh,
      evidence: question.private.evidence.map((span) => ({
        ...span,
        region: evidenceRegion(span.start, item.transcript.length),
        progressPercent: item.transcript.length
          ? Math.round((span.start / item.transcript.length) * 100)
          : 0,
      })),
    };
  });
  const answeredCount = results.filter((result) => result.selectedOptionId !== null).length;
  const correctCount = results.filter((result) => result.correct).length;
  return {
    sourceId: id,
    answeredCount,
    correctCount,
    totalCount: results.length,
    percentage: results.length ? Math.round((correctCount / results.length) * 100) : 0,
    reviewStatus: questionSet.status as 'reviewed' | 'adjudicated' | 'approved',
    results,
    studyAids: {
      transcriptWordCount: item.transcriptWordCount,
      transcript: item.transcript,
      vocabulary: item.vocabulary,
    },
  };
}

export function listLocalListeningItems(
  collection: LocalListeningCollectionId,
  query: string,
): LocalListeningItem[] {
  const normalized = query.trim().toLocaleLowerCase('en');
  return library.items.filter(
    (item) =>
      item.collection === collection &&
      (!normalized ||
        item.title.toLocaleLowerCase('en').includes(normalized) ||
        String(item.sequence).includes(normalized) ||
        String(item.year ?? '').includes(normalized) ||
        (item.publishedAt?.includes(normalized) ?? false)),
  );
}

export async function resolveLocalListeningMedia(
  item: LocalListeningItem,
  type: 'audio' | 'document',
): Promise<{ path: string; size: number; contentType: string } | null> {
  const relativePath = type === 'audio' ? item.audioPath : item.documentPath;
  if (!relativePath) return null;
  const root = path.resolve(/* turbopackIgnore: true */ sourceRoots[item.collection]);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return null;
    const extension = path.extname(candidate).toLowerCase();
    const contentType =
      type === 'document'
        ? extension === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf'
        : extension === '.wav'
          ? 'audio/wav'
          : extension === '.m4a'
            ? 'audio/mp4'
            : 'audio/mpeg';
    return { path: candidate, size: info.size, contentType };
  } catch {
    return null;
  }
}
