import { Inject, Injectable } from '@nestjs/common';
import {
  createVocabularyAnswerFeedback,
  estimateRaschAbility,
  estimateVocabulary,
  mapThetaToVocabulary,
  raschItemInformation,
  raschPersonOutfit,
  vocabularyAbilityBand,
  vocabularyAssessmentVersions,
  type BandObservation,
  type VocabularyAssessmentMode,
  type VocabularyAssessmentResult,
  type VocabularyAssessmentStage,
  type VocabularyQuestion,
  type VocabularyQualityFlag,
  type VocabularyScoreStatus,
  type VocabularySessionEnvelope,
  type VocabularyScalePoint,
} from '@english/shared';
import { sql } from 'kysely';
import { v7 as uuidv7, validate as validateUuid } from 'uuid';
import { ProblemException } from '../common/problem.js';
import { requirePrincipal, requireTenant, type ApiRequest } from '../common/request.js';
import { AppConfig } from '../config.js';
import {
  DatabaseService,
  type TenantTransaction,
  type TenantTransactionContext,
} from '../infrastructure/database.service.js';
import { IdempotencyService } from '../infrastructure/idempotency.service.js';

interface CreateInput {
  mode: VocabularyAssessmentMode;
  targetTrack: 'general' | 'toefl';
}

interface AnswerInput {
  deliveryId: string;
  selectedOptionId: 'unknown' | 'choice-1' | 'choice-2' | 'choice-3' | 'choice-4';
  responseTimeMs: number;
  focusLossCount: number;
}

interface SessionRow {
  id: string;
  mode: VocabularyAssessmentMode;
  target_track: 'general' | 'toefl';
  status: 'created' | 'active' | 'paused' | 'scoring' | 'completed' | 'abandoned' | 'invalid';
  stage: VocabularyAssessmentStage;
  scoring_mode: VocabularyScoreStatus;
  content_version: string;
  algorithm_version: string;
  calibration_version: string;
  interpretation_version: string;
  source_list_version: string;
  routing_item_ids: string[];
  answered_count: number;
  rapid_response_count: number;
  focus_loss_count: number;
  form_id: string | null;
  started_at: Date | null;
  updated_at: Date;
  completed_at: Date | null;
}

interface ItemRow {
  id: string;
  band: number;
  target_word: string;
  sentence: string;
  options: unknown;
  correct_option_index: number;
  content_version: string;
  source_list_version: string;
  lexical_unit_key: string | null;
  part_of_speech: string | null;
  difficulty: number | null;
  discrimination: number | null;
}

interface ResponseRow {
  band: number;
  is_correct: boolean;
  was_unknown: boolean;
  selected_option_position: number | null;
  response_time_ms: number;
  difficulty: number | null;
  discrimination: number | null;
}

interface DeliveryRow {
  id: string;
  item_id: string;
  option_order: number[];
  position: number;
  target_word: string;
  sentence: string;
  options: unknown;
}

interface CalibrationRow {
  id: string;
  version: string;
  status: 'draft' | 'shadow' | 'active' | 'retired';
  model: 'rasch' | '2pl' | '3pl';
  sample_size: number;
  external_validation_size: number;
  fit_summary: Record<string, unknown>;
  acceptance_gates: Record<string, unknown>;
}

interface FixedFormSelection {
  formId: string;
  itemIds: string[];
}

interface ResultRow {
  id: string;
  session_id: string;
  mode: VocabularyAssessmentMode;
  estimate: number;
  interval_lower: number;
  interval_upper: number;
  confidence: number;
  reliability: VocabularyAssessmentResult['reliability'];
  band_profile: VocabularyAssessmentResult['bandProfile'];
  metrics: Record<string, unknown>;
  score_status: VocabularyScoreStatus;
  scale: 'word-family-1k-14k';
  theta: number | null;
  standard_error: number | null;
  display_precision: 100 | 500 | 1000;
  ability_band: VocabularyAssessmentResult['abilityBand']['id'];
  quality_flags: VocabularyQualityFlag[];
  content_version: string;
  algorithm_version: string;
  calibration_version: string;
  interpretation_version: string;
  source_list_version: string;
  completed_at: Date;
}

const FORMAL_BANK_PER_BAND = 20;
const FIXED_ITEMS_PER_BAND: Record<VocabularyAssessmentMode, number> = {
  quick: 3,
  standard: 10,
  calibration: 20,
};
const CAT_LIMITS = {
  quick: { minimum: 28, maximum: 40, targetSe: 0.45 },
  standard: { minimum: 40, maximum: 60, targetSe: 0.3 },
  calibration: { minimum: 280, maximum: 280, targetSe: 0 },
} as const;

function contextFor(request: ApiRequest): TenantTransactionContext {
  const principal = requirePrincipal(request);
  const tenant = requireTenant(request);
  return { tenantId: tenant.tenantId, membershipId: tenant.membershipId, userId: principal.userId };
}

function assertUuid(value: string): void {
  if (!validateUuid(value)) throw ProblemException.notFound();
}

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
  for (let index = result.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const swap = Math.floor(((state >>> 0) / 4294967296) * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

function optionLabels(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== 4)
    throw new Error('Invalid vocabulary option payload.');
  return raw.map((option) => {
    if (typeof option === 'string') return option;
    if (
      option &&
      typeof option === 'object' &&
      typeof (option as { label?: unknown }).label === 'string'
    ) {
      return (option as { label: string }).label;
    }
    throw new Error('Invalid vocabulary option label.');
  });
}

export function toPublicVocabularyQuestion(input: {
  deliveryId: string;
  itemId: string;
  targetWord: string;
  sentence: string;
  options: unknown;
  optionOrder: number[];
}): VocabularyQuestion {
  const labels = optionLabels(input.options);
  return {
    deliveryId: input.deliveryId,
    itemId: input.itemId,
    targetWord: input.targetWord,
    sentence: input.sentence,
    options: input.optionOrder.map((originalIndex, position) => ({
      id: `choice-${position + 1}`,
      label: labels[originalIndex]!,
    })),
  };
}

function vocabularyMapping(calibration: CalibrationRow | null): VocabularyScalePoint[] | null {
  const raw = calibration?.fit_summary.vocabularyMapping;
  if (!Array.isArray(raw)) return null;
  const points = raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const theta = Number((value as { theta?: unknown }).theta);
    const vocabulary = Number((value as { vocabulary?: unknown }).vocabulary);
    return Number.isFinite(theta) && Number.isFinite(vocabulary) ? [{ theta, vocabulary }] : [];
  });
  return points.length >= 2 ? points : null;
}

function calibrationReady(
  calibration: CalibrationRow | undefined,
  scoreStatus: Exclude<VocabularyScoreStatus, 'beta'>,
): calibration is CalibrationRow {
  if (
    scoreStatus === 'shadow' &&
    calibration &&
    calibration.sample_size >= 500 &&
    calibration.fit_summary.shadowReady === true &&
    vocabularyMapping(calibration)
  ) {
    return true;
  }
  const gates = calibration?.acceptance_gates;
  return Boolean(
    calibration &&
    calibration.sample_size >= 500 &&
    calibration.external_validation_size >= 200 &&
    calibration.fit_summary.releaseReady === true &&
    gates?.passed === true &&
    gates.monotonic === true &&
    Number(gates.intervalCoverage) >= 0.9 &&
    Number(gates.intervalCoverage) <= 0.98 &&
    Number(gates.standardMeanAbsoluteError) <= 800 &&
    Number(gates.externalCorrelation) >= 0.75 &&
    Number(gates.retestCorrelation) >= 0.85 &&
    Number(gates.standardWithin60) >= 0.9 &&
    gates.itemFitReviewComplete === true &&
    gates.difPassed === true &&
    vocabularyMapping(calibration),
  );
}

function observationsFor(rows: ResponseRow[]): BandObservation[] {
  return Array.from({ length: 14 }, (_, index) => {
    const band = index + 1;
    const responses = rows.filter((row) => row.band === band);
    return {
      band,
      attempted: responses.length,
      correct: responses.filter((row) => row.is_correct).length,
      unknown: responses.filter((row) => row.was_unknown).length,
    };
  });
}

@Injectable()
export class VocabularyAssessmentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  create(request: ApiRequest, key: string | undefined, input: CreateInput) {
    const context = contextFor(request);
    if (
      input.mode === 'calibration' &&
      requireTenant(request).roles.every((role) => role === 'student')
    ) {
      throw ProblemException.forbidden(
        'calibration_mode_forbidden',
        '校准卷仅供获授权的教研和试测流程使用。',
      );
    }
    return this.idempotency.execute(
      context,
      'vocabulary-assessment.create',
      key,
      input,
      async (transaction) => {
        const existing = await this.activeSession(transaction, context);
        if (existing)
          return { body: await this.envelope(transaction, context, existing), status: 200 };

        const resolved = await this.resolveScoringMode(transaction, context);
        const sessionId = uuidv7();
        const bank = await this.loadFormalBank(
          transaction,
          context,
          resolved.scoreStatus,
          resolved.calibration,
        );
        const contentVersion = bank[0]!.content_version;
        const sourceListVersion = bank[0]!.source_list_version;
        const fixedForm =
          resolved.scoreStatus === 'beta'
            ? await this.fixedForm(transaction, context, input.mode, contentVersion, bank)
            : null;
        if (resolved.scoreStatus === 'beta' && input.mode !== 'quick' && fixedForm === null) {
          throw ProblemException.conflict(
            'vocabulary_parallel_form_not_ready',
            input.mode === 'calibration'
              ? '校准模式必须先发布280题平衡不完全区组试测卷。'
              : '标准Beta必须先发布每频段10题的140题平行卷。',
          );
        }
        const itemIds =
          fixedForm?.itemIds ??
          this.initialItemIds(bank, input.mode, resolved.scoreStatus, sessionId);
        const formId =
          fixedForm?.formId ??
          (resolved.scoreStatus === 'beta'
            ? null
            : await this.anchorFormId(transaction, context, contentVersion));
        const stage: VocabularyAssessmentStage =
          input.mode === 'calibration' ? 'calibration' : 'routing';
        const now = new Date();
        await sql`
        insert into vocabulary_assessment_sessions (
          id, tenant_id, learner_membership_id, mode, target_track, status, stage,
          scoring_mode, form_id, content_version, algorithm_version, calibration_version,
          interpretation_version, source_list_version, routing_item_ids, started_at, created_at, updated_at
        ) values (
          ${sessionId}::uuid, ${context.tenantId}::uuid, ${context.membershipId}::uuid,
          ${input.mode}, ${input.targetTrack}, 'active', ${stage}, ${resolved.scoreStatus},
          ${formId}::uuid, ${contentVersion}, ${vocabularyAssessmentVersions.algorithm},
          ${resolved.calibration?.version ?? vocabularyAssessmentVersions.calibration},
          ${vocabularyAssessmentVersions.interpretation}, ${sourceListVersion},
          ${JSON.stringify(itemIds)}::jsonb, ${now}, ${now}, ${now}
        )
      `.execute(transaction);
        const session = await this.session(transaction, context, sessionId, true);
        await this.ensureDelivery(transaction, context, session, resolved.calibration);
        return { body: await this.envelope(transaction, context, session), status: 201 };
      },
    );
  }

  async get(request: ApiRequest, sessionId: string): Promise<VocabularySessionEnvelope> {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.database.withTenant(context, async (transaction) => {
      const session = await this.session(transaction, context, sessionId);
      return this.envelope(transaction, context, session);
    });
  }

  pause(request: ApiRequest, sessionId: string, key: string | undefined) {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.idempotency.execute(
      context,
      `vocabulary-assessment.pause:${sessionId}`,
      key,
      {},
      async (transaction) => {
        const session = await this.session(transaction, context, sessionId, true);
        if (session.status === 'completed')
          return { body: await this.envelope(transaction, context, session), status: 200 };
        if (session.status !== 'active')
          throw ProblemException.conflict('assessment_not_active', '只有进行中的测评可以暂停。');
        await sql`
        update vocabulary_assessment_sessions
        set status = 'paused', paused_at = now(), updated_at = now()
        where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
      `.execute(transaction);
        return {
          body: await this.envelope(transaction, context, {
            ...session,
            status: 'paused',
            updated_at: new Date(),
          }),
          status: 200,
        };
      },
    );
  }

  resume(request: ApiRequest, sessionId: string, key: string | undefined) {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.idempotency.execute(
      context,
      `vocabulary-assessment.resume:${sessionId}`,
      key,
      {},
      async (transaction) => {
        let session = await this.session(transaction, context, sessionId, true);
        if (session.status === 'completed')
          return { body: await this.envelope(transaction, context, session), status: 200 };
        if (session.status !== 'paused')
          throw ProblemException.conflict('assessment_not_paused', '当前测评不是暂停状态。');
        await sql`
        update vocabulary_assessment_sessions
        set status = 'active', paused_at = null, updated_at = now()
        where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
      `.execute(transaction);
        session = { ...session, status: 'active', updated_at: new Date() };
        await this.ensureDelivery(
          transaction,
          context,
          session,
          await this.calibrationForSession(transaction, context, session),
        );
        return { body: await this.envelope(transaction, context, session), status: 200 };
      },
    );
  }

  answer(request: ApiRequest, sessionId: string, key: string | undefined, input: AnswerInput) {
    assertUuid(sessionId);
    const context = contextFor(request);
    return this.idempotency.execute(
      context,
      `vocabulary-assessment.answer:${sessionId}`,
      key,
      input,
      async (transaction) => {
        let session = await this.session(transaction, context, sessionId, true);
        if (session.status !== 'active')
          throw ProblemException.conflict('assessment_not_active', '当前测评不能提交答案。');
        const deliveryResult = await sql<DeliveryRow & { correct_option_index: number }>`
          select d.id, d.item_id, d.option_order, d.position,
                 i.target_word, i.sentence, i.options, i.correct_option_index
          from vocabulary_assessment_deliveries d
          join vocabulary_assessment_items i
            on i.tenant_id = d.tenant_id and i.id = d.item_id
          where d.tenant_id = ${context.tenantId}::uuid
            and d.session_id = ${sessionId}::uuid and d.id = ${input.deliveryId}::uuid
            and d.answered_at is null
          for update of d
        `.execute(transaction);
        const delivery = deliveryResult.rows[0];
        if (!delivery)
          throw ProblemException.conflict(
            'delivery_already_answered',
            '该题已提交或不属于当前测评。',
          );
        const wasUnknown = input.selectedOptionId === 'unknown';
        const selectedPosition = wasUnknown ? null : Number(input.selectedOptionId.slice(-1)) - 1;
        const originalIndex =
          selectedPosition === null ? null : delivery.option_order[selectedPosition];
        const isCorrect = originalIndex === delivery.correct_option_index;
        const feedback = createVocabularyAnswerFeedback({
          deliveryId: input.deliveryId,
          selectedOptionId: input.selectedOptionId,
          optionOrder: delivery.option_order,
          correctOptionIndex: delivery.correct_option_index,
        });
        if (!feedback) {
          throw ProblemException.conflict(
            'assessment_delivery_invalid',
            '本题的选项顺序无效，请重新开始测评。',
          );
        }
        await sql`
          insert into vocabulary_assessment_responses (
            id, tenant_id, session_id, delivery_id, selected_option_position,
            was_unknown, is_correct, response_time_ms, idempotency_key
          ) values (
            ${uuidv7()}::uuid, ${context.tenantId}::uuid, ${sessionId}::uuid,
            ${input.deliveryId}::uuid, ${selectedPosition}, ${wasUnknown}, ${isCorrect},
            ${Math.round(input.responseTimeMs)}, ${key!}
          )
        `.execute(transaction);
        await sql`
          update vocabulary_assessment_deliveries set answered_at = now()
          where tenant_id = ${context.tenantId}::uuid and id = ${input.deliveryId}::uuid
        `.execute(transaction);
        await sql`
          update vocabulary_assessment_sessions
          set answered_count = answered_count + 1,
              rapid_response_count = rapid_response_count + case when ${input.responseTimeMs} < 700 then 1 else 0 end,
              focus_loss_count = greatest(focus_loss_count, ${input.focusLossCount}),
              stage = case
                when mode = 'calibration' then 'calibration'
                when answered_count + 1 >= 14 then 'precision'
                else stage end,
              updated_at = now()
          where tenant_id = ${context.tenantId}::uuid and id = ${sessionId}::uuid
        `.execute(transaction);
        session = await this.session(transaction, context, sessionId, true);
        const calibration = await this.calibrationForSession(transaction, context, session);
        const responses = await this.responses(transaction, context, sessionId);
        if (this.shouldComplete(session, responses)) {
          await this.complete(transaction, context, session, responses, calibration);
          session = await this.session(transaction, context, sessionId, true);
        } else {
          await this.ensureDelivery(transaction, context, session, calibration, responses);
        }
        const body = await this.envelope(transaction, context, session);
        body.feedback = feedback;
        return { body, status: 200 };
      },
    );
  }

  async result(request: ApiRequest, resultId: string): Promise<VocabularyAssessmentResult> {
    assertUuid(resultId);
    const context = contextFor(request);
    return this.database.withTenant(context, async (transaction) => {
      const query = await sql<ResultRow>`
      select r.*, r.theta::float8 as theta, r.standard_error::float8 as standard_error,
             r.confidence::float8 as confidence, s.mode
        from vocabulary_assessment_results r
        join vocabulary_assessment_sessions s
          on s.tenant_id = r.tenant_id and s.id = r.session_id
        where r.tenant_id = ${context.tenantId}::uuid
          and r.learner_membership_id = ${context.membershipId}::uuid
          and r.id = ${resultId}::uuid
      `.execute(transaction);
      const row = query.rows[0];
      if (!row) throw ProblemException.notFound();
      return this.resultFromRow(row);
    });
  }

  private async activeSession(transaction: TenantTransaction, context: TenantTransactionContext) {
    const result = await sql<SessionRow>`
      select * from vocabulary_assessment_sessions
      where tenant_id = ${context.tenantId}::uuid
        and learner_membership_id = ${context.membershipId}::uuid
        and status in ('created', 'active', 'paused', 'scoring')
      order by created_at desc limit 1 for update
    `.execute(transaction);
    return result.rows[0];
  }

  private async session(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    sessionId: string,
    lock = false,
  ): Promise<SessionRow> {
    const result = await sql<SessionRow>`
      select * from vocabulary_assessment_sessions
      where tenant_id = ${context.tenantId}::uuid
        and learner_membership_id = ${context.membershipId}::uuid
        and id = ${sessionId}::uuid
      ${lock ? sql`for update` : sql``}
    `.execute(transaction);
    const row = result.rows[0];
    if (!row) throw ProblemException.notFound();
    return row;
  }

  private async resolveScoringMode(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
  ) {
    const desired = this.config.values.VOCABULARY_ASSESSMENT_SCORING_MODE;
    if (desired === 'beta') return { scoreStatus: 'beta' as const, calibration: null };
    const result = await sql<CalibrationRow>`
      select id, version, status, model, sample_size, external_validation_size,
             fit_summary, acceptance_gates
      from vocabulary_assessment_calibrations
      where tenant_id = ${context.tenantId}::uuid
        and status ${desired === 'calibrated' ? sql`= 'active'` : sql`in ('shadow', 'active')`}
      order by case when status = 'active' then 0 else 1 end, created_at desc
      limit 1
    `.execute(transaction);
    const calibration = result.rows[0];
    if (!calibrationReady(calibration, desired))
      return { scoreStatus: 'beta' as const, calibration: null };
    return { scoreStatus: desired, calibration };
  }

  private async calibrationForSession(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
  ): Promise<CalibrationRow | null> {
    if (session.scoring_mode === 'beta') return null;
    const result = await sql<CalibrationRow>`
      select id, version, status, model, sample_size, external_validation_size,
             fit_summary, acceptance_gates
      from vocabulary_assessment_calibrations
      where tenant_id = ${context.tenantId}::uuid and version = ${session.calibration_version}
      limit 1
    `.execute(transaction);
    const row = result.rows[0];
    return row && calibrationReady(row, session.scoring_mode) ? row : null;
  }

  private async loadFormalBank(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    scoreStatus: VocabularyScoreStatus,
    calibration: CalibrationRow | null,
  ): Promise<ItemRow[]> {
    const result = await sql<ItemRow>`
      select distinct on (coalesce(i.lexical_unit_key, i.item_key))
        i.id, i.band, i.target_word, i.sentence, i.options, i.correct_option_index,
        i.content_version, i.source_list_version, i.lexical_unit_key, i.part_of_speech,
        p.difficulty::float8 as difficulty, p.discrimination::float8 as discrimination
      from vocabulary_assessment_items i
      left join vocabulary_assessment_item_parameters p
        on p.tenant_id = i.tenant_id and p.item_id = i.id
       and p.calibration_id = ${calibration?.id ?? null}::uuid
      where i.tenant_id = ${context.tenantId}::uuid
        and i.status ${scoreStatus === 'beta' ? sql`in ('pilot', 'active')` : sql`= 'active'`}
        and i.item_format = 'receptive-recognition'
        and i.language_version = 'zh-CN'
        and nullif(btrim(i.lexical_unit_key), '') is not null
        and nullif(btrim(i.lemma), '') is not null
        and nullif(btrim(i.word_family), '') is not null
        and nullif(btrim(i.sense_key), '') is not null
        and nullif(btrim(i.part_of_speech), '') is not null
        and nullif(btrim(i.corpus_source), '') is not null
        and i.corpus_rank is not null
        and i.masked_context_reviewed = true
        and i.calibration_eligible = true
        and (
          select count(*) from vocabulary_assessment_item_reviews review
          where review.tenant_id = i.tenant_id and review.item_id = i.id
            and review.decision = 'approve' and review.target_sense_valid
            and review.single_best_answer and review.distractors_balanced
            and review.context_nondefining and not review.masked_context_leak
            and review.language_natural
        ) >= 2
        and (${scoreStatus === 'beta'} or p.item_id is not null)
      order by coalesce(i.lexical_unit_key, i.item_key), i.content_version desc, i.id
    `.execute(transaction);
    const byVersion = new Map<string, ItemRow[]>();
    for (const item of result.rows) {
      const list = byVersion.get(item.content_version) ?? [];
      list.push(item);
      byVersion.set(item.content_version, list);
    }
    const bank = [...byVersion.values()]
      .filter((items) =>
        Array.from(
          { length: 14 },
          (_, index) => items.filter((item) => item.band === index + 1).length,
        ).every((count) => count >= FORMAL_BANK_PER_BAND),
      )
      .sort((left, right) => right.length - left.length)[0];
    const minimum = scoreStatus === 'beta' ? 280 : 700;
    if (!bank || bank.length < minimum) {
      throw ProblemException.conflict(
        'vocabulary_bank_not_ready',
        scoreStatus === 'beta'
          ? '正式试测题库尚未达到每频段至少20题、总计至少280题并完成双人审核的门槛。当前56题仅供本地演示。'
          : '校准题库尚未达到700题、有效参数和内容审核门槛，系统已禁止启用正式CAT。',
      );
    }
    return bank;
  }

  private initialItemIds(
    bank: ItemRow[],
    mode: VocabularyAssessmentMode,
    scoreStatus: VocabularyScoreStatus,
    seed: string,
  ): string[] {
    if (scoreStatus !== 'beta')
      return shuffled(
        bank.map((item) => item.id),
        `${seed}:cat-pool`,
      );
    const perBand = FIXED_ITEMS_PER_BAND[mode];
    const selected = Array.from({ length: 14 }, (_, index) =>
      shuffled(
        bank.filter((item) => item.band === index + 1),
        `${seed}:band:${index + 1}`,
      )
        .slice(0, perBand)
        .map((item) => item.id),
    ).flat();
    return shuffled(selected, `${seed}:fixed-form`);
  }

  private async fixedForm(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    mode: VocabularyAssessmentMode,
    contentVersion: string,
    bank: ItemRow[],
  ): Promise<FixedFormSelection | null> {
    const purpose = mode === 'quick' ? 'screening' : mode === 'standard' ? 'parallel' : 'pilot';
    const forms = await sql<{ id: string }>`
      select id from vocabulary_assessment_forms
      where tenant_id = ${context.tenantId}::uuid and status = 'active'
        and mode = ${mode} and purpose = ${purpose}
        and content_version = ${contentVersion} and language_version = 'zh-CN'
      order by form_key, version
    `.execute(transaction);
    if (!forms.rows.length) return null;
    const expectedPerBand = FIXED_ITEMS_PER_BAND[mode];
    const expectedCount = expectedPerBand * 14;
    const bankIds = new Set(bank.map((item) => item.id));
    const bankById = new Map(bank.map((item) => [item.id, item]));
    const valid: FixedFormSelection[] = [];
    for (const form of forms.rows) {
      const formItems = await sql<{ item_id: string }>`
        select item_id from vocabulary_assessment_form_items
        where tenant_id = ${context.tenantId}::uuid and form_id = ${form.id}::uuid
        order by position
      `.execute(transaction);
      const itemIds = formItems.rows.map((row) => row.item_id);
      if (itemIds.length !== expectedCount || itemIds.some((id) => !bankIds.has(id))) continue;
      const counts = Array.from({ length: 14 }, () => 0);
      for (const id of itemIds) {
        const bandIndex = bankById.get(id)!.band - 1;
        counts[bandIndex] = (counts[bandIndex] ?? 0) + 1;
      }
      if (counts.every((count) => count === expectedPerBand)) {
        valid.push({ formId: form.id, itemIds });
      }
    }
    if (!valid.length) return null;
    return valid[hash(`${context.membershipId}:${mode}:${contentVersion}`) % valid.length]!;
  }

  private async anchorFormId(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    contentVersion: string,
  ): Promise<string | null> {
    const result = await sql<{ id: string }>`
      select id from vocabulary_assessment_forms
      where tenant_id = ${context.tenantId}::uuid and status = 'active'
        and purpose = 'anchor' and content_version = ${contentVersion}
        and language_version = 'zh-CN'
      order by version desc limit 1
    `.execute(transaction);
    return result.rows[0]?.id ?? null;
  }

  private async responses(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    sessionId: string,
  ): Promise<ResponseRow[]> {
    const result = await sql<ResponseRow>`
      select i.band, r.is_correct, r.was_unknown, r.selected_option_position,
             r.response_time_ms, p.difficulty::float8 as difficulty,
             p.discrimination::float8 as discrimination
      from vocabulary_assessment_responses r
      join vocabulary_assessment_deliveries d
        on d.tenant_id = r.tenant_id and d.id = r.delivery_id
      join vocabulary_assessment_items i
        on i.tenant_id = d.tenant_id and i.id = d.item_id
      join vocabulary_assessment_sessions s
        on s.tenant_id = r.tenant_id and s.id = r.session_id
      left join vocabulary_assessment_calibrations c
        on c.tenant_id = s.tenant_id and c.version = s.calibration_version
      left join vocabulary_assessment_item_parameters p
        on p.tenant_id = i.tenant_id and p.item_id = i.id and p.calibration_id = c.id
      where r.tenant_id = ${context.tenantId}::uuid and r.session_id = ${sessionId}::uuid
      order by r.created_at
    `.execute(transaction);
    return result.rows;
  }

  private shouldComplete(session: SessionRow, responses: ResponseRow[]): boolean {
    if (session.scoring_mode === 'beta') return responses.length >= session.routing_item_ids.length;
    const limits = CAT_LIMITS[session.mode];
    if (responses.length >= limits.maximum) return true;
    if (responses.length < limits.minimum) return false;
    const coveredBands = new Set(responses.map((response) => response.band)).size;
    if (coveredBands < 12) return false;
    const calibrated = responses.filter((response) => response.difficulty !== null);
    if (calibrated.length !== responses.length) return false;
    const ability = estimateRaschAbility(
      calibrated.map((response) => ({
        difficulty: response.difficulty!,
        discrimination: response.discrimination ?? 1,
        correct: response.is_correct,
      })),
    );
    return ability.standardError <= limits.targetSe;
  }

  private async ensureDelivery(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
    calibration: CalibrationRow | null,
    responseRows?: ResponseRow[],
  ): Promise<void> {
    if (session.status !== 'active') return;
    const existing = await sql<{ id: string }>`
      select id from vocabulary_assessment_deliveries
      where tenant_id = ${context.tenantId}::uuid and session_id = ${session.id}::uuid
        and answered_at is null limit 1
    `.execute(transaction);
    if (existing.rows[0]) return;
    const usedResult = await sql<{ item_id: string }>`
      select item_id from vocabulary_assessment_deliveries
      where tenant_id = ${context.tenantId}::uuid and session_id = ${session.id}::uuid
    `.execute(transaction);
    const used = new Set(usedResult.rows.map((row) => row.item_id));
    let itemId: string | undefined;
    if (session.scoring_mode === 'beta') {
      itemId = session.routing_item_ids.find((id) => !used.has(id));
    } else {
      itemId = await this.adaptiveItemId(
        transaction,
        context,
        session,
        calibration,
        used,
        responseRows ?? (await this.responses(transaction, context, session.id)),
      );
    }
    if (!itemId)
      throw ProblemException.conflict(
        'assessment_item_pool_exhausted',
        '当前测评没有满足内容约束的可用题目。',
      );
    const itemResult = await sql<ItemRow>`
      select i.id, i.band, i.target_word, i.sentence, i.options, i.correct_option_index,
             i.content_version, i.source_list_version, i.lexical_unit_key, i.part_of_speech,
             null::numeric as difficulty, null::numeric as discrimination
      from vocabulary_assessment_items i
      where i.tenant_id = ${context.tenantId}::uuid and i.id = ${itemId}::uuid
    `.execute(transaction);
    const item = itemResult.rows[0];
    if (!item) throw ProblemException.notFound();
    const position = used.size + 1;
    const deliveryId = uuidv7();
    const order = shuffled([0, 1, 2, 3], `${session.id}:${deliveryId}:options`);
    await sql`
      insert into vocabulary_assessment_deliveries (
        id, tenant_id, session_id, item_id, stage, position, option_order
      ) values (
        ${deliveryId}::uuid, ${context.tenantId}::uuid, ${session.id}::uuid,
        ${item.id}::uuid, ${session.stage}, ${position}, ${JSON.stringify(order)}::jsonb
      )
    `.execute(transaction);
    if (calibration) {
      await sql`
        update vocabulary_assessment_item_parameters
        set exposure_count = exposure_count + 1
        where tenant_id = ${context.tenantId}::uuid and item_id = ${item.id}::uuid
          and calibration_id = ${calibration.id}::uuid
      `.execute(transaction);
    }
  }

  private async adaptiveItemId(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
    calibration: CalibrationRow | null,
    used: Set<string>,
    responses: ResponseRow[],
  ): Promise<string | undefined> {
    if (!calibration)
      throw ProblemException.conflict(
        'calibration_unavailable',
        '当前校准版本已不可用，测评已停止以保护分数版本。',
      );
    const position = used.size + 1;
    if (session.form_id && [1, 8, 15, 22, 29, 36, 43, 50, 57].includes(position)) {
      const anchors = await sql<{ item_id: string }>`
        select fi.item_id from vocabulary_assessment_form_items fi
        join vocabulary_assessment_item_parameters p
          on p.tenant_id = fi.tenant_id and p.item_id = fi.item_id
        where fi.tenant_id = ${context.tenantId}::uuid and fi.form_id = ${session.form_id}::uuid
          and fi.is_anchor = true and p.calibration_id = ${calibration.id}::uuid
        order by fi.position
      `.execute(transaction);
      const anchor = anchors.rows.find((row) => !used.has(row.item_id));
      if (anchor) return anchor.item_id;
    }
    const candidates = await sql<ItemRow>`
      select i.id, i.band, i.target_word, i.sentence, i.options, i.correct_option_index,
             i.content_version, i.source_list_version, i.lexical_unit_key, i.part_of_speech,
             p.difficulty::float8 as difficulty, p.discrimination::float8 as discrimination
      from vocabulary_assessment_items i
      join vocabulary_assessment_item_parameters p
        on p.tenant_id = i.tenant_id and p.item_id = i.id
      where i.tenant_id = ${context.tenantId}::uuid and p.calibration_id = ${calibration.id}::uuid
        and i.id in (${sql.join(session.routing_item_ids.map((id) => sql`${id}::uuid`))})
    `.execute(transaction);
    const ability = estimateRaschAbility(
      responses.flatMap((response) =>
        response.difficulty === null
          ? []
          : [
              {
                difficulty: response.difficulty,
                discrimination: response.discrimination ?? 1,
                correct: response.is_correct,
              },
            ],
      ),
    );
    const bandCounts = new Map<number, number>();
    for (const response of responses)
      bandCounts.set(response.band, (bandCounts.get(response.band) ?? 0) + 1);
    const uncovered = Array.from({ length: 14 }, (_, index) => index + 1).filter(
      (band) => !bandCounts.has(band),
    );
    let eligible = candidates.rows.filter((item) => !used.has(item.id));
    if (uncovered.length && responses.length < 28)
      eligible = eligible.filter((item) => uncovered.includes(item.band));
    const ranked = eligible
      .map((item) => ({
        item,
        score:
          raschItemInformation(ability.theta, item.difficulty ?? 0, item.discrimination ?? 1) -
          (bandCounts.get(item.band) ?? 0) * 0.015,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    return ranked[hash(`${session.id}:${position}:top-five`) % ranked.length]?.item.id;
  }

  private async complete(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
    responses: ResponseRow[],
    calibration: CalibrationRow | null,
  ): Promise<void> {
    const raschResponses = responses.flatMap((response) =>
      response.difficulty === null
        ? []
        : [
            {
              difficulty: response.difficulty,
              discrimination: response.discrimination ?? 1,
              correct: response.is_correct,
            },
          ],
    );
    const ability =
      raschResponses.length === responses.length && responses.length > 0
        ? estimateRaschAbility(raschResponses)
        : null;
    const personFit = ability ? raschPersonOutfit(raschResponses, ability.theta) : null;
    const beta = estimateVocabulary({
      observations: observationsFor(responses),
      rapidResponseCount: responses.filter((row) => row.response_time_ms < 700).length,
      selectedOptionPositions: responses.flatMap((row) =>
        row.selected_option_position === null ? [] : [row.selected_option_position],
      ),
      focusLossCount: session.focus_loss_count,
      mode: session.mode,
      scoreStatus: session.scoring_mode,
      theta: ability?.theta ?? null,
      standardError: ability?.standardError ?? null,
      calibrationVersion: session.calibration_version,
      personFit,
      seed: session.id,
    });
    let result = beta;
    const mapping = vocabularyMapping(calibration);
    if (session.scoring_mode === 'calibrated' && ability && mapping) {
      const estimate = Math.round(mapThetaToVocabulary(ability.theta, mapping) / 100) * 100;
      const lower = Math.round(mapThetaToVocabulary(ability.lowerTheta, mapping) / 100) * 100;
      const upper = Math.round(mapThetaToVocabulary(ability.upperTheta, mapping) / 100) * 100;
      const abilityBand = vocabularyAbilityBand(estimate);
      const qualityFlags: VocabularyQualityFlag[] = beta.qualityFlags.filter(
        (flag): flag is Exclude<VocabularyQualityFlag, 'WIDE_ESTIMATE_RANGE'> =>
          flag !== 'WIDE_ESTIMATE_RANGE',
      );
      if (upper - lower > (session.mode === 'quick' ? 2400 : 1600))
        qualityFlags.push('WIDE_ESTIMATE_RANGE');
      const reliability =
        beta.reliability === 'INVALID'
          ? 'INVALID'
          : beta.reliability === 'LOW' || qualityFlags.includes('WIDE_ESTIMATE_RANGE')
            ? 'LOW'
            : ability.standardError <= CAT_LIMITS[session.mode].targetSe
              ? 'HIGH'
              : 'MEDIUM';
      result = {
        ...beta,
        estimate,
        interval: {
          lower: Math.min(lower, estimate),
          upper: Math.max(upper, estimate),
          confidence: 0.95,
        },
        abilityBand,
        interpretation: abilityBand.description,
        scoreStatus: 'calibrated',
        theta: ability.theta,
        standardError: ability.standardError,
        displayPrecision: 100,
        qualityFlags,
        reliability,
        reliabilityLabel: {
          HIGH: '高可信度',
          MEDIUM: '中等可信度',
          LOW: '低可信度',
          INVALID: '结果无效',
        }[reliability],
      };
    }
    const resultId = uuidv7();
    const metrics = {
      reliabilityLabel: result.reliabilityLabel,
      interpretation: result.interpretation,
      questionCount: result.questionCount,
      unknownRate: result.unknownRate,
      toeflCoverage: result.toeflCoverage,
      dailyWordTarget: result.dailyWordTarget,
      weakBands: result.weakBands,
    };
    await sql`
      update vocabulary_assessment_sessions
      set status = 'scoring', updated_at = now()
      where tenant_id = ${context.tenantId}::uuid and id = ${session.id}::uuid
    `.execute(transaction);
    await sql`
      insert into vocabulary_assessment_results (
        id, tenant_id, session_id, learner_membership_id,
        estimate, interval_lower, interval_upper, confidence, reliability,
        band_profile, metrics, score_status, scale, theta, standard_error,
        display_precision, ability_band, quality_flags,
        content_version, algorithm_version, calibration_version,
        interpretation_version, source_list_version
      ) values (
        ${resultId}::uuid, ${context.tenantId}::uuid, ${session.id}::uuid,
        ${context.membershipId}::uuid, ${result.estimate}, ${result.interval.lower},
        ${result.interval.upper}, 0.95, ${result.reliability},
        ${JSON.stringify(result.bandProfile)}::jsonb, ${JSON.stringify(metrics)}::jsonb,
        ${result.scoreStatus}, ${result.scale}, ${result.theta}, ${result.standardError},
        ${result.displayPrecision}, ${result.abilityBand.id}, ${JSON.stringify(result.qualityFlags)}::jsonb,
        ${session.content_version}, ${session.algorithm_version}, ${session.calibration_version},
        ${session.interpretation_version}, ${session.source_list_version}
      )
    `.execute(transaction);
    await sql`
      update vocabulary_assessment_sessions
      set status = 'completed', completed_at = now(), updated_at = now()
      where tenant_id = ${context.tenantId}::uuid and id = ${session.id}::uuid
    `.execute(transaction);
  }

  private async envelope(
    transaction: TenantTransaction,
    context: TenantTransactionContext,
    session: SessionRow,
  ): Promise<VocabularySessionEnvelope> {
    const deliveryResult = await sql<DeliveryRow>`
      select d.id, d.item_id, d.option_order, d.position,
             i.target_word, i.sentence, i.options
      from vocabulary_assessment_deliveries d
      join vocabulary_assessment_items i
        on i.tenant_id = d.tenant_id and i.id = d.item_id
      where d.tenant_id = ${context.tenantId}::uuid and d.session_id = ${session.id}::uuid
        and d.answered_at is null
      order by d.position limit 1
    `.execute(transaction);
    const delivery = deliveryResult.rows[0];
    let question: VocabularyQuestion | null = null;
    if (delivery) {
      question = toPublicVocabularyQuestion({
        deliveryId: delivery.id,
        itemId: delivery.item_id,
        targetWord: delivery.target_word,
        sentence: delivery.sentence,
        options: delivery.options,
        optionOrder: delivery.option_order,
      });
    }
    const result = await sql<{ id: string }>`
      select id from vocabulary_assessment_results
      where tenant_id = ${context.tenantId}::uuid and session_id = ${session.id}::uuid
    `.execute(transaction);
    const maximum =
      session.scoring_mode === 'beta'
        ? session.routing_item_ids.length
        : CAT_LIMITS[session.mode].maximum;
    const stageProgress =
      session.status === 'completed'
        ? 100
        : Math.min(99, Math.round((session.answered_count / Math.max(1, maximum)) * 100));
    return {
      sessionId: session.id,
      mode: session.mode,
      status:
        session.status === 'paused'
          ? 'paused'
          : session.status === 'completed'
            ? 'completed'
            : 'active',
      stage: session.stage,
      answeredCount: session.answered_count,
      stageProgress,
      startedAt: (session.started_at ?? session.updated_at).toISOString(),
      updatedAt: session.updated_at.toISOString(),
      question,
      feedback: null,
      resultId: result.rows[0]?.id ?? null,
    };
  }

  private resultFromRow(row: ResultRow): VocabularyAssessmentResult {
    const metrics = row.metrics;
    const abilityBand = vocabularyAbilityBand(row.estimate);
    return {
      id: row.id,
      sessionId: row.session_id,
      mode: row.mode,
      completedAt: row.completed_at.toISOString(),
      estimate: row.estimate,
      interval: { lower: row.interval_lower, upper: row.interval_upper, confidence: 0.95 },
      abilityBand,
      scoreStatus: row.score_status,
      scale: row.scale,
      theta: row.theta,
      standardError: row.standard_error,
      displayPrecision: row.display_precision,
      qualityFlags: row.quality_flags,
      calibrationVersion: row.calibration_version,
      reliability: row.reliability,
      reliabilityLabel: String(metrics.reliabilityLabel ?? ''),
      interpretation: String(metrics.interpretation ?? abilityBand.description),
      questionCount: Number(metrics.questionCount ?? 0),
      unknownRate: Number(metrics.unknownRate ?? 0),
      toeflCoverage: Number(metrics.toeflCoverage ?? 0),
      dailyWordTarget: Number(metrics.dailyWordTarget ?? 4),
      weakBands: Array.isArray(metrics.weakBands) ? metrics.weakBands.map(String) : [],
      bandProfile: row.band_profile,
      versions: {
        content: row.content_version,
        algorithm: row.algorithm_version,
        calibration: row.calibration_version,
        interpretation: row.interpretation_version,
        sourceList: row.source_list_version,
      },
    };
  }
}
