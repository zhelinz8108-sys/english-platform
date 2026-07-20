import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  createVocabularyAnswerFeedback,
  estimateVocabulary,
  vocabularyAssessmentVersions,
  type BandObservation,
  type VocabularyAssessmentMode,
  type VocabularyAssessmentResult,
  type VocabularyQuestion,
  type VocabularySessionEnvelope,
} from '@/lib/vocabulary-assessment';
import {
  vocabularyAssessmentBank,
  vocabularyBankById,
  type AssessmentBankItem,
} from '@/lib/vocabulary-assessment-bank.server';

interface AssessmentResponse {
  itemId: string;
  band: number;
  correct: boolean;
  unknown: boolean;
  selectedOptionPosition: number | null;
  responseTimeMs: number;
}

interface CurrentDelivery {
  question: VocabularyQuestion;
  optionIndexById: Record<string, number>;
}

interface LocalAssessmentSession {
  id: string;
  mode: VocabularyAssessmentMode;
  status: 'active' | 'paused' | 'completed';
  stage: 'routing' | 'precision';
  startedAt: string;
  updatedAt: string;
  routingItemIds: string[];
  responses: AssessmentResponse[];
  currentDelivery: CurrentDelivery | null;
  focusLossCount: number;
  resultId: string | null;
}

interface LocalAssessmentStore {
  sessions: Map<string, LocalAssessmentSession>;
  results: Map<string, VocabularyAssessmentResult>;
  idempotentResponses: Map<string, VocabularySessionEnvelope>;
}

const globalStore = globalThis as typeof globalThis & {
  __aurelisVocabularyAssessmentStore?: LocalAssessmentStore;
};

const store =
  globalStore.__aurelisVocabularyAssessmentStore ??
  (globalStore.__aurelisVocabularyAssessmentStore = {
    sessions: new Map(),
    results: new Map(),
    idempotentResponses: new Map(),
  });

const routingCount = 16;
const modeLimits = {
  quick: { minimum: 42, maximum: 48, targetWidth: 2400 },
  standard: { minimum: 56, maximum: 56, targetWidth: 1600 },
  calibration: { minimum: 56, maximum: 56, targetWidth: 1600 },
} as const;

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function shuffled<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  let state = hash(seed) || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function buildRoutingItems(sessionId: string): string[] {
  const primary = Array.from({ length: 14 }, (_, index) => {
    const band = index + 1;
    const candidates = vocabularyAssessmentBank.filter((item) => item.band === band);
    return candidates[hash(`${sessionId}:${band}`) % candidates.length]!.id;
  });
  const extras = [5, 9].map((band) => {
    const candidates = vocabularyAssessmentBank.filter(
      (item) => item.band === band && !primary.includes(item.id),
    );
    return candidates[hash(`${sessionId}:extra:${band}`) % candidates.length]!.id;
  });
  return shuffled([...primary, ...extras], `${sessionId}:routing`);
}

function buildDelivery(
  session: LocalAssessmentSession,
  bankItem: AssessmentBankItem,
): CurrentDelivery {
  const deliveryId = randomUUID();
  const optionIndexes = shuffled([0, 1, 2, 3] as const, `${session.id}:${deliveryId}`);
  const optionIndexById: Record<string, number> = {};
  const options = optionIndexes.map((optionIndex, position) => {
    const id = `choice-${position + 1}`;
    optionIndexById[id] = optionIndex;
    return { id, label: bankItem.options[optionIndex] };
  });
  return {
    question: {
      deliveryId,
      itemId: bankItem.id,
      targetWord: bankItem.targetWord,
      sentence: bankItem.sentence,
      options,
    },
    optionIndexById,
  };
}

function observationsFor(session: LocalAssessmentSession): BandObservation[] {
  return Array.from({ length: 14 }, (_, index) => {
    const band = index + 1;
    const responses = session.responses.filter((response) => response.band === band);
    return {
      band,
      attempted: responses.length,
      correct: responses.filter((response) => response.correct).length,
      unknown: responses.filter((response) => response.unknown).length,
    };
  });
}

function thresholdBand(session: LocalAssessmentSession): number {
  const knownBands = session.responses
    .filter((response) => response.correct)
    .map((response) => response.band);
  const missedBands = session.responses
    .filter((response) => !response.correct)
    .map((response) => response.band);
  const highestKnown = knownBands.length ? Math.max(...knownBands) : 1;
  const higherMisses = missedBands.filter((band) => band > highestKnown);
  const lowestHigherMiss = higherMisses.length ? Math.min(...higherMisses) : 14;
  return Math.max(1, Math.min(14, Math.round((highestKnown + lowestHigherMiss) / 2)));
}

function nextBankItem(session: LocalAssessmentSession): AssessmentBankItem | null {
  const usedIds = new Set(session.responses.map((response) => response.itemId));
  if (session.responses.length < routingCount) {
    const itemId = session.routingItemIds[session.responses.length];
    return itemId ? (vocabularyBankById.get(itemId) ?? null) : null;
  }

  session.stage = 'precision';
  const threshold = thresholdBand(session);
  const attemptsByBand = new Map<number, number>();
  for (const response of session.responses) {
    attemptsByBand.set(response.band, (attemptsByBand.get(response.band) ?? 0) + 1);
  }
  const candidates = vocabularyAssessmentBank.filter((item) => !usedIds.has(item.id));
  candidates.sort((left, right) => {
    const leftScore =
      Math.abs(left.band - threshold) * 20 +
      (attemptsByBand.get(left.band) ?? 0) * 5 +
      (hash(`${session.id}:${left.id}`) % 100) / 100;
    const rightScore =
      Math.abs(right.band - threshold) * 20 +
      (attemptsByBand.get(right.band) ?? 0) * 5 +
      (hash(`${session.id}:${right.id}`) % 100) / 100;
    return leftScore - rightScore;
  });
  return candidates[0] ?? null;
}

function estimateFor(session: LocalAssessmentSession) {
  return estimateVocabulary({
    observations: observationsFor(session),
    rapidResponseCount: session.responses.filter((response) => response.responseTimeMs < 700)
      .length,
    selectedOptionPositions: session.responses.flatMap((response) =>
      response.selectedOptionPosition === null ? [] : [response.selectedOptionPosition],
    ),
    mode: session.mode,
    scoreStatus: 'beta',
    focusLossCount: session.focusLossCount,
    seed: session.id,
  });
}

function shouldComplete(session: LocalAssessmentSession): boolean {
  const limits = modeLimits[session.mode];
  if (session.responses.length < limits.minimum) return false;
  if (session.responses.length >= limits.maximum) return true;
  const estimate = estimateFor(session);
  return estimate.interval.upper - estimate.interval.lower <= limits.targetWidth;
}

function completeSession(session: LocalAssessmentSession): VocabularyAssessmentResult {
  const now = new Date().toISOString();
  const result: VocabularyAssessmentResult = {
    id: randomUUID(),
    sessionId: session.id,
    mode: session.mode,
    completedAt: now,
    ...estimateFor(session),
    versions: vocabularyAssessmentVersions,
  };
  session.status = 'completed';
  session.updatedAt = now;
  session.currentDelivery = null;
  session.resultId = result.id;
  store.results.set(result.id, result);
  return result;
}

function envelopeFor(session: LocalAssessmentSession): VocabularySessionEnvelope {
  const stageProgress =
    session.stage === 'routing'
      ? Math.min(48, Math.round((session.responses.length / routingCount) * 48))
      : Math.min(
          96,
          50 +
            Math.round(
              ((session.responses.length - routingCount) /
                Math.max(1, modeLimits[session.mode].maximum - routingCount)) *
                46,
            ),
        );
  return {
    sessionId: session.id,
    mode: session.mode,
    status: session.status,
    stage: session.stage,
    answeredCount: session.responses.length,
    stageProgress: session.status === 'completed' ? 100 : stageProgress,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    question: session.currentDelivery?.question ?? null,
    feedback: null,
    resultId: session.resultId,
  };
}

function ensureCurrentQuestion(session: LocalAssessmentSession): void {
  if (session.status !== 'active' || session.currentDelivery) return;
  const bankItem = nextBankItem(session);
  if (!bankItem) {
    completeSession(session);
    return;
  }
  session.currentDelivery = buildDelivery(session, bankItem);
}

export function localVocabularyAssessmentEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
    process.env.ENABLE_LOCAL_VOCABULARY_ASSESSMENT === 'true'
  );
}

export function createLocalVocabularySession(
  mode: VocabularyAssessmentMode,
): VocabularySessionEnvelope {
  const now = new Date().toISOString();
  const id = randomUUID();
  const session: LocalAssessmentSession = {
    id,
    mode,
    status: 'active',
    stage: 'routing',
    startedAt: now,
    updatedAt: now,
    routingItemIds: buildRoutingItems(id),
    responses: [],
    currentDelivery: null,
    focusLossCount: 0,
    resultId: null,
  };
  store.sessions.set(id, session);
  ensureCurrentQuestion(session);
  return envelopeFor(session);
}

export function getLocalVocabularySession(sessionId: string): VocabularySessionEnvelope | null {
  const session = store.sessions.get(sessionId);
  return session ? envelopeFor(session) : null;
}

export function resumeLocalVocabularySession(sessionId: string): VocabularySessionEnvelope | null {
  const session = store.sessions.get(sessionId);
  if (!session || session.status === 'completed') return session ? envelopeFor(session) : null;
  session.status = 'active';
  session.updatedAt = new Date().toISOString();
  ensureCurrentQuestion(session);
  return envelopeFor(session);
}

export function pauseLocalVocabularySession(sessionId: string): VocabularySessionEnvelope | null {
  const session = store.sessions.get(sessionId);
  if (!session || session.status === 'completed') return session ? envelopeFor(session) : null;
  session.status = 'paused';
  session.updatedAt = new Date().toISOString();
  return envelopeFor(session);
}

export function answerLocalVocabularyQuestion(input: {
  sessionId: string;
  deliveryId: string;
  selectedOptionId: string;
  responseTimeMs: number;
  focusLossCount?: number;
  idempotencyKey: string;
}): VocabularySessionEnvelope | null {
  const cacheKey = `${input.sessionId}:${input.idempotencyKey}`;
  const cached = store.idempotentResponses.get(cacheKey);
  if (cached) return cached;
  const session = store.sessions.get(input.sessionId);
  if (!session || session.status !== 'active' || !session.currentDelivery) return null;
  if (session.currentDelivery.question.deliveryId !== input.deliveryId) return null;

  const bankItem = vocabularyBankById.get(session.currentDelivery.question.itemId);
  if (!bankItem) return null;
  const unknown = input.selectedOptionId === 'unknown';
  const optionOrder = session.currentDelivery.question.options.map(
    (option: VocabularyQuestion['options'][number]) =>
      session.currentDelivery!.optionIndexById[option.id] ?? -1,
  );
  const feedback = createVocabularyAnswerFeedback({
    deliveryId: input.deliveryId,
    selectedOptionId: input.selectedOptionId,
    optionOrder,
    correctOptionIndex: bankItem.correctIndex,
  });
  if (!feedback) return null;
  session.responses.push({
    itemId: bankItem.id,
    band: bankItem.band,
    correct: feedback.correct,
    unknown,
    selectedOptionPosition: unknown
      ? null
      : session.currentDelivery.question.options.findIndex(
          (option: { id: string }) => option.id === input.selectedOptionId,
        ),
    responseTimeMs: Math.max(0, Math.min(120000, Math.round(input.responseTimeMs))),
  });
  session.focusLossCount = Math.max(
    session.focusLossCount,
    Math.max(0, Math.round(input.focusLossCount ?? 0)),
  );
  session.currentDelivery = null;
  session.updatedAt = new Date().toISOString();

  if (shouldComplete(session)) completeSession(session);
  else ensureCurrentQuestion(session);
  const envelope: VocabularySessionEnvelope = {
    ...envelopeFor(session),
    feedback,
  };
  store.idempotentResponses.set(cacheKey, envelope);
  return envelope;
}

export function getLocalVocabularyResult(resultId: string): VocabularyAssessmentResult | null {
  return store.results.get(resultId) ?? null;
}
