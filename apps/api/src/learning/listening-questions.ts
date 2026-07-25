import { createHash } from 'node:crypto';

export type ListeningOptionId = 'a' | 'b' | 'c' | 'd';
export type ListeningQuestionType =
  'main_idea' | 'detail' | 'rhetorical_purpose' | 'inference' | 'organization' | 'prediction';

export interface ListeningQuestionOption {
  id: ListeningOptionId;
  text: string;
}

export interface ListeningEvidenceSpan {
  start: number;
  end: number;
  quote: string;
}

export interface ListeningQuestion {
  id: string;
  position: number;
  type: ListeningQuestionType;
  difficulty: 'low' | 'medium' | 'high';
  public: {
    prompt: string;
    options: ListeningQuestionOption[];
  };
  private: {
    answer: ListeningOptionId;
    evidence: ListeningEvidenceSpan[];
    explanationZh: string;
    optionRationalesZh: Record<ListeningOptionId, string>;
  };
}

export interface ReadyListeningQuestionSet {
  sourceId: string;
  label: string;
  exactSimulation: boolean;
  reviewStatus: 'reviewed' | 'adjudicated' | 'approved';
  questions: ListeningQuestion[];
}

interface ListeningSource {
  sourceId: string;
  collection: string;
  title: string;
  durationSeconds: number | null;
  transcript: string;
}

interface StoredListeningQuestionSet {
  sourceHash: string;
  label: string;
  exactSimulation: boolean;
  reviewStatus: string;
  questions: unknown;
}

const optionIds = new Set<ListeningOptionId>(['a', 'b', 'c', 'd']);
const questionTypes = new Set<ListeningQuestionType>([
  'main_idea',
  'detail',
  'rhetorical_purpose',
  'inference',
  'organization',
  'prediction',
]);
const difficulties = new Set(['low', 'medium', 'high']);
const readyStatuses = new Set(['reviewed', 'adjudicated', 'approved']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseQuestion(value: unknown): ListeningQuestion | null {
  if (!isRecord(value) || !isRecord(value.public) || !isRecord(value.private)) return null;
  const publicBlock = value.public;
  const privateBlock = value.private;
  if (
    !nonemptyString(value.id) ||
    !Number.isInteger(value.position) ||
    !questionTypes.has(value.type as ListeningQuestionType) ||
    !difficulties.has(value.difficulty as string) ||
    !nonemptyString(publicBlock.prompt) ||
    !Array.isArray(publicBlock.options) ||
    publicBlock.options.length !== 4 ||
    !optionIds.has(privateBlock.answer as ListeningOptionId) ||
    !Array.isArray(privateBlock.evidence) ||
    !nonemptyString(privateBlock.explanationZh) ||
    !isRecord(privateBlock.optionRationalesZh)
  ) {
    return null;
  }

  const options = publicBlock.options;
  const parsedOptions: ListeningQuestionOption[] = [];
  for (const option of options) {
    if (
      !isRecord(option) ||
      !optionIds.has(option.id as ListeningOptionId) ||
      !nonemptyString(option.text)
    ) {
      return null;
    }
    parsedOptions.push({ id: option.id as ListeningOptionId, text: option.text });
  }
  if (new Set(parsedOptions.map((option) => option.id)).size !== 4) return null;

  const evidence: ListeningEvidenceSpan[] = [];
  for (const span of privateBlock.evidence) {
    if (
      !isRecord(span) ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      (span.start as number) < 0 ||
      (span.end as number) <= (span.start as number) ||
      !nonemptyString(span.quote)
    ) {
      return null;
    }
    evidence.push({ start: span.start as number, end: span.end as number, quote: span.quote });
  }
  if (evidence.length === 0) return null;

  const rationales = privateBlock.optionRationalesZh;
  if (![...optionIds].every((id) => nonemptyString(rationales[id]))) return null;

  return {
    id: value.id,
    position: value.position as number,
    type: value.type as ListeningQuestionType,
    difficulty: value.difficulty as 'low' | 'medium' | 'high',
    public: { prompt: publicBlock.prompt, options: parsedOptions },
    private: {
      answer: privateBlock.answer as ListeningOptionId,
      evidence,
      explanationZh: privateBlock.explanationZh,
      optionRationalesZh: {
        a: rationales.a as string,
        b: rationales.b as string,
        c: rationales.c as string,
        d: rationales.d as string,
      },
    },
  };
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function listeningSourceHash(source: ListeningSource): string {
  const canonical = JSON.stringify({
    collection: compactText(source.collection),
    durationSeconds: source.durationSeconds,
    sourceId: compactText(source.sourceId),
    title: compactText(source.title),
    transcript: source.transcript,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function readyListeningQuestionSet(
  source: ListeningSource,
  stored: StoredListeningQuestionSet | null,
): ReadyListeningQuestionSet | null {
  if (
    !stored ||
    !readyStatuses.has(stored.reviewStatus) ||
    stored.sourceHash !== listeningSourceHash(source) ||
    !Array.isArray(stored.questions) ||
    stored.questions.length !== 4
  ) {
    return null;
  }
  const questions = stored.questions.map(parseQuestion);
  if (questions.some((question) => question === null)) return null;
  return {
    sourceId: source.sourceId,
    label: stored.label,
    exactSimulation: stored.exactSimulation,
    reviewStatus: stored.reviewStatus as ReadyListeningQuestionSet['reviewStatus'],
    questions: questions as ListeningQuestion[],
  };
}

export function publicListeningQuestionSet(questionSet: ReadyListeningQuestionSet) {
  return {
    sourceId: questionSet.sourceId,
    label: questionSet.label,
    exactSimulation: questionSet.exactSimulation,
    reviewStatus: questionSet.reviewStatus,
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

function evidenceRegion(start: number, transcriptLength: number): '开头' | '中段' | '结尾' {
  const ratio = transcriptLength > 0 ? start / transcriptLength : 0;
  if (ratio < 1 / 3) return '开头';
  if (ratio < 2 / 3) return '中段';
  return '结尾';
}

export function scoreListeningAnswers(
  questionSet: ReadyListeningQuestionSet,
  answers: Record<string, string>,
  transcript: string,
) {
  const results = questionSet.questions.map((question) => {
    const selectedOptionId = answers[question.id]?.trim().toLocaleLowerCase('en') ?? null;
    return {
      questionId: question.id,
      selectedOptionId,
      correctOptionId: question.private.answer,
      correct: selectedOptionId === question.private.answer,
      explanationZh: question.private.explanationZh,
      optionRationalesZh: question.private.optionRationalesZh,
      evidence: question.private.evidence.map((span) => ({
        ...span,
        region: evidenceRegion(span.start, transcript.length),
        progressPercent: transcript.length ? Math.round((span.start / transcript.length) * 100) : 0,
      })),
    };
  });
  const answeredCount = results.filter((result) => result.selectedOptionId !== null).length;
  const correctCount = results.filter((result) => result.correct).length;
  return {
    answeredCount,
    correctCount,
    totalCount: results.length,
    percentage: results.length ? Math.round((correctCount / results.length) * 100) : 0,
    results,
  };
}
