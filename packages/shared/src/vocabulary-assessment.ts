export const vocabularyAssessmentVersions = {
  content: 'ava-content-demo56-2026.07',
  algorithm: 'ava-beta-tristate-isotonic-2.0.0',
  calibration: 'unvalidated-beta-2',
  interpretation: 'ava-interpretation-2.0.0',
  sourceList: 'aurelis-original-14k-beta-1',
} as const;

export type VocabularyAssessmentMode = 'quick' | 'standard' | 'calibration';
export type VocabularyAssessmentStage = 'routing' | 'precision' | 'calibration';
export type VocabularyAssessmentStatus = 'active' | 'paused' | 'completed';
export type VocabularyReliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
export type VocabularyScoreStatus = 'beta' | 'shadow' | 'calibrated';
export type VocabularyScale = 'word-family-1k-14k';
export type VocabularyQualityFlag =
  | 'RAPID_RESPONSES'
  | 'STRAIGHTLINING'
  | 'NON_MONOTONIC_PROFILE'
  | 'PERSON_FIT_MISFIT'
  | 'FOCUS_LOSS'
  | 'INSUFFICIENT_BAND_COVERAGE'
  | 'WIDE_ESTIMATE_RANGE';

export interface VocabularyOption {
  id: string;
  label: string;
}

export interface VocabularyQuestion {
  deliveryId: string;
  itemId: string;
  targetWord: string;
  sentence: string;
  options: VocabularyOption[];
}

export interface VocabularyAnswerFeedback {
  deliveryId: string;
  selectedOptionId: string;
  correctOptionId: string;
  correct: boolean;
}

export function createVocabularyAnswerFeedback(input: {
  deliveryId: string;
  selectedOptionId: string;
  optionOrder: readonly number[];
  correctOptionIndex: number;
}): VocabularyAnswerFeedback | null {
  const correctPosition = input.optionOrder.findIndex(
    (optionIndex) => optionIndex === input.correctOptionIndex,
  );
  if (correctPosition < 0) return null;
  const selectedPosition =
    input.selectedOptionId === 'unknown'
      ? -1
      : Number(input.selectedOptionId.replace('choice-', '')) - 1;
  const selectedOriginalIndex = input.optionOrder[selectedPosition];
  return {
    deliveryId: input.deliveryId,
    selectedOptionId: input.selectedOptionId,
    correctOptionId: `choice-${correctPosition + 1}`,
    correct: selectedOriginalIndex === input.correctOptionIndex,
  };
}

export interface VocabularySessionEnvelope {
  sessionId: string;
  mode: VocabularyAssessmentMode;
  status: VocabularyAssessmentStatus;
  stage: VocabularyAssessmentStage;
  answeredCount: number;
  stageProgress: number;
  startedAt: string;
  updatedAt: string;
  question: VocabularyQuestion | null;
  feedback: VocabularyAnswerFeedback | null;
  resultId: string | null;
}

export interface VocabularyBandResult {
  band: number;
  label: string;
  knownRate: number;
  lowerRate: number;
  upperRate: number;
  attempted: number;
}

export interface VocabularyAbilityBand {
  id: 'foundation' | 'everyday' | 'independent' | 'academic-ready' | 'advanced' | 'extensive';
  label: string;
  lower: number;
  upper: number;
  description: string;
}

export interface VocabularyAssessmentVersionSnapshot {
  content: string;
  algorithm: string;
  calibration: string;
  interpretation: string;
  sourceList: string;
}

export interface VocabularyAssessmentResult {
  id: string;
  sessionId: string;
  mode: VocabularyAssessmentMode;
  completedAt: string;
  estimate: number;
  interval: { lower: number; upper: number; confidence: 0.95 };
  abilityBand: VocabularyAbilityBand;
  scoreStatus: VocabularyScoreStatus;
  scale: VocabularyScale;
  theta: number | null;
  standardError: number | null;
  displayPrecision: 100 | 500 | 1000;
  qualityFlags: VocabularyQualityFlag[];
  calibrationVersion: string;
  reliability: VocabularyReliability;
  reliabilityLabel: string;
  interpretation: string;
  questionCount: number;
  unknownRate: number;
  toeflCoverage: number;
  dailyWordTarget: number;
  weakBands: string[];
  bandProfile: VocabularyBandResult[];
  versions: VocabularyAssessmentVersionSnapshot;
}

export interface BandObservation {
  band: number;
  attempted: number;
  correct: number;
  unknown: number;
}

export interface VocabularyEstimateInput {
  observations: BandObservation[];
  rapidResponseCount: number;
  seed: string;
  mode?: VocabularyAssessmentMode;
  selectedOptionPositions?: number[];
  focusLossCount?: number;
  scoreStatus?: VocabularyScoreStatus;
  theta?: number | null;
  standardError?: number | null;
  calibrationVersion?: string;
  personFit?: number | null;
}

export interface RaschObservation {
  difficulty: number;
  correct: boolean;
  discrimination?: number;
}

export interface RaschAbilityEstimate {
  theta: number;
  standardError: number;
  lowerTheta: number;
  upperTheta: number;
}

export interface VocabularyScalePoint {
  theta: number;
  vocabulary: number;
}

interface PosteriorBand {
  band: number;
  attempted: number;
  alpha: number;
  beta: number;
}

const GUESSING_PROBABILITY = 0.25;
const WEAK_PRIOR = 0.25;
const MODE_TARGET_WIDTH: Record<VocabularyAssessmentMode, number> = {
  quick: 2400,
  standard: 1600,
  calibration: 1600,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function logistic(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

/**
 * EAP estimate for a calibrated Rasch/2PL bank. Unknown and wrong responses are
 * both scored as zero in the receptive-recognition construct; only the Beta
 * demonstration scorer applies a four-option chance correction.
 */
export function estimateRaschAbility(observations: RaschObservation[]): RaschAbilityEstimate {
  if (observations.length === 0) {
    return { theta: 0, standardError: 1, lowerTheta: -1.96, upperTheta: 1.96 };
  }
  const grid = Array.from({ length: 161 }, (_, index) => -4 + index * 0.05);
  const logWeights = grid.map((theta) => {
    let logWeight = -0.5 * theta * theta;
    for (const observation of observations) {
      const discrimination = clamp(observation.discrimination ?? 1, 0.2, 3);
      const probability = clamp(
        logistic(discrimination * (theta - observation.difficulty)),
        1e-9,
        1 - 1e-9,
      );
      logWeight += observation.correct ? Math.log(probability) : Math.log(1 - probability);
    }
    return logWeight;
  });
  const maximum = Math.max(...logWeights);
  const weights = logWeights.map((value) => Math.exp(value - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const theta = grid.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / total;
  const variance =
    grid.reduce((sum, value, index) => sum + (value - theta) ** 2 * (weights[index] ?? 0), 0) /
    total;
  const standardError = Math.sqrt(Math.max(variance, 0.0001));
  return {
    theta,
    standardError,
    lowerTheta: clamp(theta - 1.96 * standardError, -4, 4),
    upperTheta: clamp(theta + 1.96 * standardError, -4, 4),
  };
}

export function raschItemInformation(
  theta: number,
  difficulty: number,
  discrimination = 1,
): number {
  const boundedDiscrimination = clamp(discrimination, 0.2, 3);
  const probability = logistic(boundedDiscrimination * (theta - difficulty));
  return boundedDiscrimination ** 2 * probability * (1 - probability);
}

/** Mean-square person outfit; values far from 1 indicate an internally inconsistent response string. */
export function raschPersonOutfit(observations: RaschObservation[], theta: number): number | null {
  if (observations.length < 20) return null;
  const total = observations.reduce((sum, observation) => {
    const discrimination = clamp(observation.discrimination ?? 1, 0.2, 3);
    const probability = clamp(
      logistic(discrimination * (theta - observation.difficulty)),
      0.02,
      0.98,
    );
    const response = observation.correct ? 1 : 0;
    return sum + (response - probability) ** 2 / (probability * (1 - probability));
  }, 0);
  return total / observations.length;
}

/** Maps a calibrated latent score onto the frozen 1K-14K reference-domain scale. */
export function mapThetaToVocabulary(theta: number, points: VocabularyScalePoint[]): number {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.theta) && Number.isFinite(point.vocabulary))
    .sort((left, right) => left.theta - right.theta);
  if (ordered.length < 2)
    throw new Error('A calibrated vocabulary mapping needs at least two points.');
  if (theta <= ordered[0]!.theta) return clamp(ordered[0]!.vocabulary, 0, 14000);
  if (theta >= ordered.at(-1)!.theta) return clamp(ordered.at(-1)!.vocabulary, 0, 14000);
  const upperIndex = ordered.findIndex((point) => point.theta >= theta);
  const lower = ordered[upperIndex - 1]!;
  const upper = ordered[upperIndex]!;
  const fraction = (theta - lower.theta) / (upper.theta - lower.theta);
  return clamp(lower.vocabulary + fraction * (upper.vocabulary - lower.vocabulary), 0, 14000);
}

function roundTo(value: number, precision: number): number {
  return Math.round(value / precision) * precision;
}

function stringSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = stringSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(random: () => number): number {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function gammaSample(shape: number, random: () => number): number {
  if (shape < 1) {
    return gammaSample(shape + 1, random) * Math.pow(Math.max(random(), Number.EPSILON), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const normal = normalSample(random);
    const candidate = 1 + c * normal;
    if (candidate <= 0) continue;
    const cubed = candidate * candidate * candidate;
    const uniform = random();
    if (
      uniform < 1 - 0.0331 * normal ** 4 ||
      Math.log(uniform) < 0.5 * normal * normal + d * (1 - cubed + Math.log(cubed))
    ) {
      return d * cubed;
    }
  }
}

function betaSample(alpha: number, beta: number, random: () => number): number {
  const left = gammaSample(alpha, random);
  const right = gammaSample(beta, random);
  return left / (left + right);
}

export function smoothDecreasing(values: number[], weights: number[]): number[] {
  const blocks = values.map((value, index) => ({
    start: index,
    end: index,
    value,
    weight: Math.max(weights[index] ?? 1, 0.001),
  }));
  let cursor = 0;
  while (cursor < blocks.length - 1) {
    const left = blocks[cursor]!;
    const right = blocks[cursor + 1]!;
    if (left.value >= right.value) {
      cursor += 1;
      continue;
    }
    const weight = left.weight + right.weight;
    blocks.splice(cursor, 2, {
      start: left.start,
      end: right.end,
      weight,
      value: (left.value * left.weight + right.value * right.weight) / weight,
    });
    cursor = Math.max(0, cursor - 1);
  }
  const result = Array.from({ length: values.length }, () => 0);
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index += 1) result[index] = block.value;
  }
  return result;
}

function posteriorBands(observations: BandObservation[]): PosteriorBand[] {
  const byBand = new Map(observations.map((item) => [item.band, item]));
  return Array.from({ length: 14 }, (_, index) => {
    const band = index + 1;
    const observation = byBand.get(band) ?? { band, attempted: 0, correct: 0, unknown: 0 };
    const attempted = Math.max(0, observation.attempted);
    const unknown = clamp(observation.unknown, 0, attempted);
    const answered = Math.max(0, attempted - unknown);
    // “不认识”直接作为未掌握证据；对实际选择的四选一答案才做25%猜测校正。
    const inferredKnown = clamp(
      (observation.correct - answered * GUESSING_PROBABILITY) / (1 - GUESSING_PROBABILITY),
      0,
      attempted,
    );
    return {
      band,
      attempted,
      alpha: WEAK_PRIOR + inferredKnown,
      beta: WEAK_PRIOR + attempted - inferredKnown,
    };
  });
}

function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return (sorted[lower] ?? 0) * (1 - fraction) + (sorted[upper] ?? 0) * fraction;
}

function reliabilityLabel(
  reliability: VocabularyReliability,
  scoreStatus: VocabularyScoreStatus,
): string {
  if (scoreStatus !== 'calibrated' && reliability === 'MEDIUM') return 'Beta · 可作范围参考';
  return {
    HIGH: '高可信度',
    MEDIUM: '中等可信度',
    LOW: '低可信度',
    INVALID: '结果无效',
  }[reliability];
}

export function vocabularyAbilityBand(estimate: number): VocabularyAbilityBand {
  if (estimate < 3000) {
    return {
      id: 'foundation',
      label: '基础筑基',
      lower: 0,
      upper: 3000,
      description: '基础高频词仍有较大提升空间，适合先建立稳定的日常与校园词汇底座。',
    };
  }
  if (estimate < 5000) {
    return {
      id: 'everyday',
      label: '常用词汇基础',
      lower: 3000,
      upper: 5000,
      description: '已具备常用英语词汇基础，下一阶段可集中补齐学术高频词和常见派生词。',
    };
  }
  if (estimate < 7000) {
    return {
      id: 'independent',
      label: '独立阅读进阶',
      lower: 5000,
      upper: 7000,
      description: '词汇广度已能支持多数一般材料，应重点加强学术语境下的精确辨义。',
    };
  }
  if (estimate < 9000) {
    return {
      id: 'academic-ready',
      label: '学术阅读准备',
      lower: 7000,
      upper: 9000,
      description: '具备较好的学术阅读词汇基础，可把重点转向低频学术词、搭配和多义词。',
    };
  }
  if (estimate < 11000) {
    return {
      id: 'advanced',
      label: '高阶学术广度',
      lower: 9000,
      upper: 11000,
      description: '词汇广度较强，适合通过长篇学术材料巩固低频词识别与语境稳定性。',
    };
  }
  return {
    id: 'extensive',
    label: '广泛高阶词汇',
    lower: 11000,
    upper: 14000,
    description: '词汇广度很强，建议减少机械扩词，更多训练专业语域、多义辨析与主动运用。',
  };
}

function fixedOptionRate(positions: number[] | undefined): number {
  if (!positions?.length) return 0;
  const counts = new Map<number, number>();
  for (const position of positions) counts.set(position, (counts.get(position) ?? 0) + 1);
  return Math.max(...counts.values()) / positions.length;
}

function qualityFlagsFor(
  input: VocabularyEstimateInput,
  rawMeans: number[],
  intervalWidth: number,
) {
  const flags = new Set<VocabularyQualityFlag>();
  const attempted = input.observations.reduce((total, item) => total + item.attempted, 0);
  const rapidRate = attempted ? input.rapidResponseCount / attempted : 0;
  const coveredBands = input.observations.filter((item) => item.attempted > 0).length;
  const lowMean = rawMeans.slice(0, 5).reduce((sum, value) => sum + value, 0) / 5;
  const highMean = rawMeans.slice(9, 14).reduce((sum, value) => sum + value, 0) / 5;
  const adjacentJumps = rawMeans.reduce(
    (count, value, index) =>
      index > 0 && value > (rawMeans[index - 1] ?? 1) + 0.25 ? count + 1 : count,
    0,
  );

  if (rapidRate > 0.35) flags.add('RAPID_RESPONSES');
  if (attempted >= 20 && fixedOptionRate(input.selectedOptionPositions) >= 0.8) {
    flags.add('STRAIGHTLINING');
  }
  if (highMean > lowMean + 0.3 || adjacentJumps >= 2) flags.add('NON_MONOTONIC_PROFILE');
  if (
    input.personFit !== null &&
    input.personFit !== undefined &&
    (input.personFit < 0.5 || input.personFit > 1.5)
  ) {
    flags.add('PERSON_FIT_MISFIT');
  }
  if ((input.focusLossCount ?? 0) >= 4) flags.add('FOCUS_LOSS');
  if (coveredBands < 12) flags.add('INSUFFICIENT_BAND_COVERAGE');
  if (intervalWidth > MODE_TARGET_WIDTH[input.mode ?? 'standard']) {
    flags.add('WIDE_ESTIMATE_RANGE');
  }
  return [...flags];
}

export function estimateVocabulary(
  input: VocabularyEstimateInput,
): Omit<VocabularyAssessmentResult, 'id' | 'sessionId' | 'mode' | 'completedAt' | 'versions'> {
  const mode = input.mode ?? 'standard';
  const scoreStatus = input.scoreStatus ?? 'beta';
  const posterior = posteriorBands(input.observations);
  const rawMeans = posterior.map((item) => item.alpha / (item.alpha + item.beta));
  const weights = posterior.map((item) => Math.max(0.25, item.attempted));
  const smoothedMeans = smoothDecreasing(rawMeans, weights);
  const random = createRandom(input.seed);
  const samples = 3200;
  const totals: number[] = [];
  const bandSamples = posterior.map(() => [] as number[]);

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const draw = smoothDecreasing(
      posterior.map((item) => betaSample(item.alpha, item.beta, random)),
      weights,
    );
    totals.push(draw.reduce((total, rate) => total + rate * 1000, 0));
    draw.forEach((rate, bandIndex) => bandSamples[bandIndex]!.push(rate));
  }
  totals.sort((left, right) => left - right);
  bandSamples.forEach((values) => values.sort((left, right) => left - right));

  const attempted = input.observations.reduce((total, item) => total + item.attempted, 0);
  const unknown = input.observations.reduce((total, item) => total + item.unknown, 0);
  const unknownRate = attempted ? unknown / attempted : 0;
  const displayPrecision: 100 | 500 | 1000 =
    scoreStatus === 'calibrated' ? 100 : mode === 'quick' ? 1000 : 500;
  const lower = roundTo(quantile(totals, 0.025), displayPrecision);
  const upper = roundTo(quantile(totals, 0.975), displayPrecision);
  const estimate = roundTo(
    smoothedMeans.reduce((total, rate) => total + rate * 1000, 0),
    displayPrecision,
  );
  const intervalWidth = upper - lower;
  const qualityFlags = qualityFlagsFor(input, rawMeans, intervalWidth);
  const rapidRate = attempted ? input.rapidResponseCount / attempted : 0;
  const severeInvalid =
    attempted < 20 ||
    rapidRate > 0.65 ||
    qualityFlags.includes('STRAIGHTLINING') ||
    qualityFlags.includes('INSUFFICIENT_BAND_COVERAGE');
  const severeLow =
    qualityFlags.includes('NON_MONOTONIC_PROFILE') ||
    qualityFlags.includes('PERSON_FIT_MISFIT') ||
    qualityFlags.includes('FOCUS_LOSS') ||
    qualityFlags.includes('RAPID_RESPONSES');
  const targetWidth = MODE_TARGET_WIDTH[mode];
  let reliability: VocabularyReliability = severeInvalid
    ? 'INVALID'
    : severeLow
      ? 'LOW'
      : intervalWidth <= targetWidth
        ? 'HIGH'
        : intervalWidth <= targetWidth * 1.6
          ? 'MEDIUM'
          : 'LOW';
  // 未经真人校准的Beta结果不得被标为“高可信度”。
  if (scoreStatus !== 'calibrated' && reliability === 'HIGH') reliability = 'MEDIUM';

  const bandProfile = posterior.map((item, index) => ({
    band: item.band,
    label: `${item.band}K`,
    knownRate: Math.round((smoothedMeans[index] ?? 0) * 100),
    lowerRate: Math.round(quantile(bandSamples[index] ?? [], 0.1) * 100),
    upperRate: Math.round(quantile(bandSamples[index] ?? [], 0.9) * 100),
    attempted: item.attempted,
  }));
  const toeflRates = smoothedMeans.slice(2, 10);
  const toeflCoverage = Math.round(
    (toeflRates.reduce((total, rate) => total + rate, 0) / Math.max(1, toeflRates.length)) * 100,
  );
  const weakBands = bandProfile
    .filter((item) => item.band >= 3 && item.band <= 10 && item.knownRate < 60)
    .slice(0, 3)
    .map((item) => item.label);
  const safeEstimate = clamp(estimate, 0, 14000);
  const abilityBand = vocabularyAbilityBand(safeEstimate);

  return {
    estimate: safeEstimate,
    interval: {
      lower: clamp(Math.min(lower, safeEstimate), 0, 14000),
      upper: clamp(Math.max(upper, safeEstimate), 0, 14000),
      confidence: 0.95,
    },
    abilityBand,
    scoreStatus,
    scale: 'word-family-1k-14k',
    theta: input.theta ?? null,
    standardError: input.standardError ?? null,
    displayPrecision,
    qualityFlags,
    calibrationVersion: input.calibrationVersion ?? vocabularyAssessmentVersions.calibration,
    reliability,
    reliabilityLabel: reliabilityLabel(reliability, scoreStatus),
    interpretation: abilityBand.description,
    questionCount: attempted,
    unknownRate: Math.round(unknownRate * 100),
    toeflCoverage,
    dailyWordTarget: reliability === 'INVALID' || reliability === 'LOW' ? 4 : 6,
    weakBands,
    bandProfile,
  };
}
