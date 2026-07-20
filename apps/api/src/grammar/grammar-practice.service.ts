import { Inject, Injectable } from '@nestjs/common';
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
  grammarContentVersion,
  grammarCorrectAnswerLabel,
  isGrammarAnswerCorrect,
  pilotGrammarTopicIds,
  toPublicGrammarQuestion,
} from '@english/shared/grammar-content';
import { sql } from 'kysely';
import { v7 as uuidv7, validate as validateUuid } from 'uuid';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import {
  DatabaseService,
  type TenantTransaction,
  type TenantTransactionContext,
} from '../infrastructure/database.service.js';
import { IdempotencyService } from '../infrastructure/idempotency.service.js';

interface SessionRow {
  id: string;
  topic_id: string;
  level: GrammarLevelId;
  status: 'active' | 'completed';
  content_version: string;
  question_ids: string[];
  answers: Record<string, string>;
  revision: number;
  question_count: number;
  correct_count: number | null;
  accuracy: number | null;
  mastered: boolean;
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface AnswerInput {
  questionId: string;
  value: string;
}

function contextFor(request: ApiRequest): TenantTransactionContext {
  const principal = requirePrincipal(request);
  const tenant = requireTenant(request);
  return { tenantId: tenant.tenantId, membershipId: tenant.membershipId, userId: principal.userId };
}

function assertUuid(value: string): void {
  if (!validateUuid(value)) throw ProblemException.notFound();
}

function selectedAnswerLabel(questionId: string, answer: string): string {
  const question = getGrammarQuestionDefinition(questionId);
  if (!question || question.kind === 'fill_blank') return answer;
  return question.options?.find((option) => option.id === answer)?.label ?? answer;
}

@Injectable()
export class GrammarPracticeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async progress(request: ApiRequest): Promise<GrammarProgressEnvelope> {
    const context = contextFor(request);
    return this.database.withTenant(context, async (transaction) => {
      const result = await sql<SessionRow>`
        select id, topic_id, level, status, content_version, question_ids, answers, revision,
               question_count, correct_count, accuracy, mastered, started_at, updated_at, completed_at
        from grammar_practice_sessions
        where tenant_id = ${context.tenantId}::uuid
          and learner_membership_id = ${context.membershipId}::uuid
          and topic_id in (${sql.join(pilotGrammarTopicIds.map((id) => sql`${id}`))})
        order by updated_at desc
      `.execute(transaction);
      const entries = pilotGrammarTopicIds.flatMap((topicId) =>
        grammarLevelIds.map((level) => {
          const rows = result.rows.filter((row) => row.topic_id === topicId && row.level === level);
          const completed = rows.filter((row) => row.status === 'completed');
          const active = rows.find((row) => row.status === 'active') ?? null;
          const last = completed[0] ?? null;
          const bestAccuracy = completed.length
            ? Math.max(...completed.map((row) => row.accuracy ?? 0))
            : null;
          return {
            topicId,
            level,
            status:
              bestAccuracy !== null && bestAccuracy >= 80
                ? ('mastered' as const)
                : completed.length
                  ? ('practiced' as const)
                  : active
                    ? ('in_progress' as const)
                    : ('not_started' as const),
            attemptCount: completed.length,
            bestAccuracy,
            lastAccuracy: last?.accuracy ?? null,
            activeSessionId: active?.id ?? null,
            updatedAt: (active ?? last)?.updated_at.toISOString() ?? null,
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
    });
  }

  create(
    request: ApiRequest,
    key: string | undefined,
    input: { topicId: string; level: GrammarLevelId },
  ) {
    const context = contextFor(request);
    const questions = getGrammarQuestionDefinitions(input.topicId, input.level);
    if (questions.length !== 10) {
      throw ProblemException.notFound('该知识点阶段尚未开放练习。');
    }
    return this.idempotency.execute(
      context,
      'grammar-practice.create',
      key,
      input,
      async (transaction) => {
        const existing = await sql<SessionRow>`
          select id, topic_id, level, status, content_version, question_ids, answers, revision,
                 question_count, correct_count, accuracy, mastered, started_at, updated_at, completed_at
          from grammar_practice_sessions
          where tenant_id = ${context.tenantId}::uuid
            and learner_membership_id = ${context.membershipId}::uuid
            and topic_id = ${input.topicId} and level = ${input.level} and status = 'active'
          for update
        `.execute(transaction);
        if (existing.rows[0]) {
          return { body: await this.envelope(transaction, context, existing.rows[0]), status: 200 };
        }
        const id = uuidv7();
        const now = new Date();
        const questionIds = questions.map((question) => question.id);
        await sql`
          insert into grammar_practice_sessions (
            id, tenant_id, learner_membership_id, topic_id, level, status, content_version,
            question_ids, answers, revision, question_count, started_at, updated_at
          ) values (
            ${id}::uuid, ${context.tenantId}::uuid, ${context.membershipId}::uuid,
            ${input.topicId}, ${input.level}, 'active', ${grammarContentVersion},
            ${JSON.stringify(questionIds)}::jsonb, '{}'::jsonb, 1, 10, ${now}, ${now}
          )
        `.execute(transaction);
        const session = await this.session(transaction, context, id);
        return { body: await this.envelope(transaction, context, session), status: 201 };
      },
    );
  }

  async get(request: ApiRequest, sessionId: string): Promise<GrammarPracticeSessionEnvelope> {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.database.withTenant(context, async (transaction) =>
      this.envelope(transaction, context, await this.session(transaction, context, sessionId)),
    );
  }

  answer(request: ApiRequest, sessionId: string, key: string | undefined, input: AnswerInput) {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.idempotency.execute(
      context,
      `grammar-practice.answer:${sessionId}`,
      key,
      input,
      async (transaction) => {
        const session = await this.session(transaction, context, sessionId, true);
        if (session.status !== 'active') {
          throw ProblemException.conflict('grammar_session_completed', '该练习已经提交。');
        }
        if (!session.question_ids.includes(input.questionId)) {
          throw ProblemException.badRequest('grammar_question_invalid', '题目不属于当前练习。');
        }
        const question = getGrammarQuestionDefinition(input.questionId);
        if (
          !question ||
          question.topicId !== session.topic_id ||
          question.level !== session.level
        ) {
          throw ProblemException.badRequest('grammar_question_invalid', '题目版本无效。');
        }
        if (
          input.value.length > 500 ||
          (question.kind !== 'fill_blank' &&
            !question.options?.some((option) => option.id === input.value))
        ) {
          throw ProblemException.badRequest('grammar_answer_invalid', '答案格式无效。');
        }
        const answers = { ...session.answers, [input.questionId]: input.value };
        await sql`
          update grammar_practice_sessions
          set answers = ${JSON.stringify(answers)}::jsonb, revision = revision + 1, updated_at = now()
          where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
            and learner_membership_id = ${context.membershipId}::uuid
        `.execute(transaction);
        const updated = await this.session(transaction, context, sessionId);
        return { body: await this.envelope(transaction, context, updated), status: 200 };
      },
    );
  }

  submit(request: ApiRequest, sessionId: string, key: string | undefined) {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.idempotency.execute(
      context,
      `grammar-practice.submit:${sessionId}`,
      key,
      {},
      async (transaction) => {
        const session = await this.session(transaction, context, sessionId, true);
        if (session.status === 'completed') {
          return { body: await this.result(transaction, context, session), status: 200 };
        }
        if (session.question_ids.some((questionId) => !session.answers[questionId]?.trim())) {
          throw ProblemException.conflict(
            'grammar_answers_incomplete',
            '请完成全部10道题后再提交。',
          );
        }
        const correctCount = session.question_ids.reduce((count, questionId) => {
          const question = getGrammarQuestionDefinition(questionId);
          return question && isGrammarAnswerCorrect(question, session.answers[questionId] ?? '')
            ? count + 1
            : count;
        }, 0);
        const accuracy = Math.round((correctCount / session.question_count) * 100);
        const completedAt = new Date();
        await sql`
          update grammar_practice_sessions
          set status = 'completed', correct_count = ${correctCount}, accuracy = ${accuracy},
              mastered = ${accuracy >= 80}, completed_at = ${completedAt},
              revision = revision + 1, updated_at = ${completedAt}
          where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
            and learner_membership_id = ${context.membershipId}::uuid
        `.execute(transaction);
        const completed = await this.session(transaction, context, sessionId);
        return { body: await this.result(transaction, context, completed), status: 200 };
      },
    );
  }

  private async session(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    sessionId: string,
    lock = false,
  ): Promise<SessionRow> {
    const result = await sql<SessionRow>`
      select id, topic_id, level, status, content_version, question_ids, answers, revision,
             question_count, correct_count, accuracy, mastered, started_at, updated_at, completed_at
      from grammar_practice_sessions
      where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
        and learner_membership_id = ${context.membershipId}::uuid
      ${lock ? sql`for update` : sql``}
    `.execute(transaction);
    const session = result.rows[0];
    if (!session) throw ProblemException.notFound();
    return session;
  }

  private async envelope(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
  ): Promise<GrammarPracticeSessionEnvelope> {
    const definitions = session.question_ids.map((questionId) => {
      const question = getGrammarQuestionDefinition(questionId);
      if (!question)
        throw ProblemException.conflict('grammar_content_changed', '练习内容版本已不可用。');
      return question;
    });
    return {
      sessionId: session.id,
      topicId: session.topic_id,
      level: session.level,
      status: session.status,
      revision: session.revision,
      answeredCount: Object.keys(session.answers).filter((id) => session.answers[id]?.trim())
        .length,
      questionCount: session.question_count,
      answers: session.answers,
      questions: definitions.map(toPublicGrammarQuestion),
      startedAt: session.started_at.toISOString(),
      updatedAt: session.updated_at.toISOString(),
      result:
        session.status === 'completed' ? await this.result(transaction, context, session) : null,
    };
  }

  private async result(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
  ): Promise<GrammarPracticeResult> {
    if (
      session.status !== 'completed' ||
      session.correct_count === null ||
      session.accuracy === null ||
      session.completed_at === null
    ) {
      throw ProblemException.conflict('grammar_result_unavailable', '练习尚未提交。');
    }
    const best = await sql<{ best_accuracy: number }>`
      select coalesce(max(accuracy), 0)::int as best_accuracy
      from grammar_practice_sessions
      where tenant_id = ${context.tenantId}::uuid
        and learner_membership_id = ${context.membershipId}::uuid
        and topic_id = ${session.topic_id} and level = ${session.level} and status = 'completed'
    `.execute(transaction);
    const bestAccuracy = best.rows[0]?.best_accuracy ?? session.accuracy;
    return {
      sessionId: session.id,
      topicId: session.topic_id,
      level: session.level,
      correctCount: session.correct_count,
      questionCount: session.question_count,
      accuracy: session.accuracy,
      bestAccuracy,
      mastered: bestAccuracy >= 80,
      completedAt: session.completed_at.toISOString(),
      review: session.question_ids.map((questionId) => {
        const question = getGrammarQuestionDefinition(questionId);
        if (!question)
          throw ProblemException.conflict('grammar_content_changed', '练习内容版本已不可用。');
        const answer = session.answers[questionId] ?? '';
        return {
          questionId,
          kind: question.kind,
          prompt: question.prompt,
          selectedAnswer: selectedAnswerLabel(questionId, answer),
          correctAnswer: grammarCorrectAnswerLabel(question),
          correct: isGrammarAnswerCorrect(question, answer),
          explanation: question.explanation,
        };
      }),
    };
  }
}
