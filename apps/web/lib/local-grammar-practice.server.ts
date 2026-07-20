import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  GrammarLevelId,
  GrammarPracticeResult,
  GrammarPracticeSessionEnvelope,
  GrammarProgressEnvelope,
} from '@english/shared';
import { grammarLevelIds } from '@english/shared';
import {
  getGrammarQuestionDefinition,
  getGrammarQuestionDefinitions,
  grammarCorrectAnswerLabel,
  isGrammarAnswerCorrect,
  pilotGrammarTopicIds,
  toPublicGrammarQuestion,
} from '@english/shared/grammar-content';

interface LocalSession {
  id: string;
  topicId: string;
  level: GrammarLevelId;
  status: 'active' | 'completed';
  revision: number;
  questionIds: string[];
  answers: Record<string, string>;
  startedAt: string;
  updatedAt: string;
  result: GrammarPracticeResult | null;
}

interface LocalStore {
  sessions: Map<string, LocalSession>;
  idempotent: Map<string, GrammarPracticeSessionEnvelope | GrammarPracticeResult>;
}

const globalStore = globalThis as typeof globalThis & {
  __aurelisGrammarPracticeStore?: LocalStore;
};

const store: LocalStore =
  globalStore.__aurelisGrammarPracticeStore ??
  (globalStore.__aurelisGrammarPracticeStore = {
    sessions: new Map<string, LocalSession>(),
    idempotent: new Map<string, GrammarPracticeSessionEnvelope | GrammarPracticeResult>(),
  });

function answerLabel(questionId: string, value: string): string {
  const question = getGrammarQuestionDefinition(questionId);
  if (!question || question.kind === 'fill_blank') return value;
  return question.options?.find((option) => option.id === value)?.label ?? value;
}

function envelope(session: LocalSession): GrammarPracticeSessionEnvelope {
  const definitions = session.questionIds.map((id) => getGrammarQuestionDefinition(id)!);
  return {
    sessionId: session.id,
    topicId: session.topicId,
    level: session.level,
    status: session.status,
    revision: session.revision,
    answeredCount: Object.values(session.answers).filter((value) => value.trim()).length,
    questionCount: session.questionIds.length,
    answers: session.answers,
    questions: definitions.map(toPublicGrammarQuestion),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    result: session.result,
  };
}

function bestAccuracy(topicId: string, level: GrammarLevelId): number {
  return Math.max(
    0,
    ...[...store.sessions.values()]
      .filter((session) => session.topicId === topicId && session.level === level)
      .flatMap((session) => (session.result ? [session.result.accuracy] : [])),
  );
}

export function localGrammarPracticeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ||
    process.env.ENABLE_LOCAL_GRAMMAR_PRACTICE === 'true'
  );
}

export function getLocalGrammarProgress(): GrammarProgressEnvelope {
  const entries = pilotGrammarTopicIds.flatMap((topicId) =>
    grammarLevelIds.map((level) => {
      const sessions = [...store.sessions.values()]
        .filter((session) => session.topicId === topicId && session.level === level)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const completed = sessions.filter((session) => session.result);
      const active = sessions.find((session) => session.status === 'active') ?? null;
      const best = completed.length ? bestAccuracy(topicId, level) : null;
      return {
        topicId,
        level,
        status:
          best !== null && best >= 80
            ? ('mastered' as const)
            : completed.length
              ? ('practiced' as const)
              : active
                ? ('in_progress' as const)
                : ('not_started' as const),
        attemptCount: completed.length,
        bestAccuracy: best,
        lastAccuracy: completed[0]?.result?.accuracy ?? null,
        activeSessionId: active?.id ?? null,
        updatedAt: sessions[0]?.updatedAt ?? null,
      };
    }),
  );
  return {
    entries,
    summary: {
      startedStageCount: entries.filter((entry) => entry.status !== 'not_started').length,
      practicedStageCount: entries.filter(
        (entry) => entry.status === 'practiced' || entry.status === 'mastered',
      ).length,
      masteredStageCount: entries.filter((entry) => entry.status === 'mastered').length,
      publishedStageCount: pilotGrammarTopicIds.length * grammarLevelIds.length,
    },
  };
}

export function createLocalGrammarSession(
  topicId: string,
  level: GrammarLevelId,
): GrammarPracticeSessionEnvelope | null {
  const questions = getGrammarQuestionDefinitions(topicId, level);
  if (questions.length !== 10) return null;
  const existing = [...store.sessions.values()].find(
    (session) =>
      session.topicId === topicId && session.level === level && session.status === 'active',
  );
  if (existing) return envelope(existing);
  const now = new Date().toISOString();
  const session: LocalSession = {
    id: randomUUID(),
    topicId,
    level,
    status: 'active',
    revision: 1,
    questionIds: questions.map((question) => question.id),
    answers: {},
    startedAt: now,
    updatedAt: now,
    result: null,
  };
  store.sessions.set(session.id, session);
  return envelope(session);
}

export function getLocalGrammarSession(sessionId: string): GrammarPracticeSessionEnvelope | null {
  const session = store.sessions.get(sessionId);
  return session ? envelope(session) : null;
}

export function answerLocalGrammarQuestion(input: {
  sessionId: string;
  questionId: string;
  value: string;
  idempotencyKey: string;
}): GrammarPracticeSessionEnvelope | null {
  const cacheKey = `answer:${input.sessionId}:${input.idempotencyKey}`;
  const cached = store.idempotent.get(cacheKey);
  if (cached && 'questions' in cached) return cached;
  const session = store.sessions.get(input.sessionId);
  if (!session || session.status !== 'active' || !session.questionIds.includes(input.questionId)) {
    return null;
  }
  session.answers = { ...session.answers, [input.questionId]: input.value };
  session.revision += 1;
  session.updatedAt = new Date().toISOString();
  const result = envelope(session);
  store.idempotent.set(cacheKey, result);
  return result;
}

export function submitLocalGrammarSession(
  sessionId: string,
  idempotencyKey: string,
): GrammarPracticeResult | null {
  const cacheKey = `submit:${sessionId}:${idempotencyKey}`;
  const cached = store.idempotent.get(cacheKey);
  if (cached && !('questions' in cached)) return cached;
  const session = store.sessions.get(sessionId);
  if (!session) return null;
  if (session.result) return session.result;
  if (session.questionIds.some((id) => !session.answers[id]?.trim())) return null;
  const correctCount = session.questionIds.reduce((total, questionId) => {
    const question = getGrammarQuestionDefinition(questionId)!;
    return total + (isGrammarAnswerCorrect(question, session.answers[questionId] ?? '') ? 1 : 0);
  }, 0);
  const accuracy = Math.round((correctCount / session.questionIds.length) * 100);
  const historicalBest = Math.max(bestAccuracy(session.topicId, session.level), accuracy);
  const completedAt = new Date().toISOString();
  session.status = 'completed';
  session.revision += 1;
  session.updatedAt = completedAt;
  session.result = {
    sessionId,
    topicId: session.topicId,
    level: session.level,
    correctCount,
    questionCount: session.questionIds.length,
    accuracy,
    bestAccuracy: historicalBest,
    mastered: historicalBest >= 80,
    completedAt,
    review: session.questionIds.map((questionId) => {
      const question = getGrammarQuestionDefinition(questionId)!;
      const answer = session.answers[questionId] ?? '';
      return {
        questionId,
        kind: question.kind,
        prompt: question.prompt,
        selectedAnswer: answerLabel(questionId, answer),
        correctAnswer: grammarCorrectAnswerLabel(question),
        correct: isGrammarAnswerCorrect(question, answer),
        explanation: question.explanation,
      };
    }),
  };
  store.idempotent.set(cacheKey, session.result);
  return session.result;
}
