import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { DatabaseService } from '../infrastructure/database.service.js';

export interface SelfStudyProgressInput {
  module: 'vocabulary' | 'grammar' | 'listening' | 'reading';
  activityType: 'study' | 'practice' | 'assessment';
  contentKey: string;
  contentTitle: string;
  clientEventId: string;
  questionCount?: number | null | undefined;
  correctCount?: number | null | undefined;
  scorePercent?: number | null | undefined;
  durationSeconds?: number | null | undefined;
  metadata: Record<string, unknown>;
}

function requestContext(request: ApiRequest) {
  const principal = requirePrincipal(request);
  const tenant = requireTenant(request);
  return {
    tenantId: tenant.tenantId,
    userId: principal.userId,
    membershipId: tenant.membershipId,
  };
}

function attemptJson(row: any) {
  return {
    id: row.id,
    module: row.module,
    activityType: row.activity_type,
    contentKey: row.content_key,
    contentTitle: row.content_title,
    questionCount: row.question_count,
    correctCount: row.correct_count,
    scorePercent: row.score_percent === null ? null : Number(row.score_percent),
    durationSeconds: row.duration_seconds,
    completedAt: new Date(row.completed_at).toISOString(),
  };
}

export interface ModuleSummary {
  module: 'vocabulary' | 'grammar' | 'listening' | 'reading';
  attemptCount: number;
  contentCount: number;
  averageScorePercent: number | null;
  durationSeconds: number;
  lastCompletedAt: string | null;
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function mergeModule(modules: Map<string, ModuleSummary>, incoming: ModuleSummary) {
  const existing = modules.get(incoming.module);
  if (!existing) {
    modules.set(incoming.module, incoming);
    return;
  }
  const existingScoredAttempts = existing.averageScorePercent === null ? 0 : existing.attemptCount;
  const incomingScoredAttempts = incoming.averageScorePercent === null ? 0 : incoming.attemptCount;
  const scoredAttempts = existingScoredAttempts + incomingScoredAttempts;
  modules.set(incoming.module, {
    module: incoming.module,
    attemptCount: existing.attemptCount + incoming.attemptCount,
    contentCount: existing.contentCount + incoming.contentCount,
    averageScorePercent:
      scoredAttempts === 0
        ? null
        : ((existing.averageScorePercent ?? 0) * existingScoredAttempts +
            (incoming.averageScorePercent ?? 0) * incomingScoredAttempts) /
          scoredAttempts,
    durationSeconds: existing.durationSeconds + incoming.durationSeconds,
    lastCompletedAt: latestTimestamp(existing.lastCompletedAt, incoming.lastCompletedAt),
  });
}

@Injectable()
export class SelfStudyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  record(request: ApiRequest, input: SelfStudyProgressInput) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const id = uuidv7();
      const metadata = JSON.stringify(input.metadata);
      const inserted = await sql<any>`
        insert into self_study_attempts (
          id, tenant_id, learner_membership_id, module, activity_type,
          content_key, content_title, client_event_id, question_count, correct_count,
          score_percent, duration_seconds, metadata, completed_at, created_at
        ) values (
          ${id}::uuid, ${context.tenantId}::uuid, ${context.membershipId}::uuid,
          ${input.module}, ${input.activityType}, ${input.contentKey}, ${input.contentTitle},
          ${input.clientEventId}, ${input.questionCount ?? null}, ${input.correctCount ?? null},
          ${input.scorePercent ?? null}, ${input.durationSeconds ?? null},
          ${metadata}::jsonb, now(), now()
        )
        on conflict (tenant_id, learner_membership_id, client_event_id) do nothing
        returning *
      `.execute(transaction);
      const row =
        inserted.rows[0] ??
        (
          await sql<any>`
            select * from self_study_attempts
            where learner_membership_id = ${context.membershipId}::uuid
              and client_event_id = ${input.clientEventId}
          `.execute(transaction)
        ).rows[0];
      return { data: attemptJson(row) };
    });
  }

  summary(request: ApiRequest) {
    const context = requestContext(request);
    return this.database.withTenant(context, async (transaction) => {
      const [selfStudy, grammar, vocabulary] = await Promise.all([
        sql<any>`
          select module, count(*)::int attempt_count,
            count(distinct content_key)::int content_count,
            round(avg(score_percent), 2)::float8 average_score_percent,
            coalesce(sum(duration_seconds), 0)::int duration_seconds,
            max(completed_at) last_completed_at
          from self_study_attempts
          where learner_membership_id = ${context.membershipId}::uuid
          group by module
          order by module
        `.execute(transaction),
        sql<any>`
          select count(*) filter(where status='completed')::int attempt_count,
            count(distinct topic_id) filter(where status='completed')::int content_count,
            round(avg(accuracy) filter(where status='completed'), 2)::float8 average_score_percent,
            max(completed_at) last_completed_at
          from grammar_practice_sessions
          where learner_membership_id = ${context.membershipId}::uuid
        `.execute(transaction),
        sql<any>`
          select count(*)::int attempt_count,
            count(distinct session.mode)::int content_count,
            max(result.completed_at) last_completed_at,
            (array_agg(result.estimate order by result.completed_at desc))[1]::int latest_estimate
          from vocabulary_assessment_results result
          join vocabulary_assessment_sessions session
            on session.tenant_id = result.tenant_id and session.id = result.session_id
          where result.learner_membership_id = ${context.membershipId}::uuid
        `.execute(transaction),
      ]);
      const modules = new Map<string, ModuleSummary>();
      for (const row of selfStudy.rows) {
        mergeModule(modules, {
          module: row.module,
          attemptCount: row.attempt_count,
          contentCount: row.content_count,
          averageScorePercent: row.average_score_percent,
          durationSeconds: row.duration_seconds,
          lastCompletedAt: row.last_completed_at
            ? new Date(row.last_completed_at).toISOString()
            : null,
        });
      }
      const grammarRow = grammar.rows[0];
      if (grammarRow?.attempt_count) {
        mergeModule(modules, {
          module: 'grammar',
          attemptCount: grammarRow.attempt_count,
          contentCount: grammarRow.content_count,
          averageScorePercent: grammarRow.average_score_percent,
          durationSeconds: 0,
          lastCompletedAt: grammarRow.last_completed_at
            ? new Date(grammarRow.last_completed_at).toISOString()
            : null,
        });
      }
      const vocabularyRow = vocabulary.rows[0];
      if (vocabularyRow?.attempt_count) {
        mergeModule(modules, {
          module: 'vocabulary',
          attemptCount: vocabularyRow.attempt_count,
          contentCount: vocabularyRow.content_count,
          averageScorePercent: null,
          durationSeconds: 0,
          lastCompletedAt: vocabularyRow.last_completed_at
            ? new Date(vocabularyRow.last_completed_at).toISOString()
            : null,
        });
      }
      return {
        modules: [...modules.values()].sort((left, right) =>
          left.module.localeCompare(right.module),
        ),
        latestVocabularyEstimate: vocabularyRow?.latest_estimate ?? null,
        latestVocabularyAssessmentAt: vocabularyRow?.last_completed_at
          ? new Date(vocabularyRow.last_completed_at).toISOString()
          : null,
      };
    });
  }
}
