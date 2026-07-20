'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Gauge,
  Info,
  Layers3,
  RotateCcw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/workspace-provider';
import { PageHeader } from '@/components/ui';
import { apiRequest, isDemoMode, tenantPath } from '@/lib/api';
import type { VocabularyAssessmentResult } from '@/lib/vocabulary-assessment';
import styles from './vocabulary-assessment.module.css';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const qualityFlagLabels: Record<VocabularyAssessmentResult['qualityFlags'][number], string> = {
  RAPID_RESPONSES: '作答速度异常',
  STRAIGHTLINING: '连续选择同一位置',
  NON_MONOTONIC_PROFILE: '高低频表现明显倒置',
  PERSON_FIT_MISFIT: '作答序列与能力模型不一致',
  FOCUS_LOSS: '测评期间多次离开页面',
  INSUFFICIENT_BAND_COVERAGE: '频段覆盖不足',
  WIDE_ESTIMATE_RANGE: '内部估计范围较宽',
};

function modeLabel(mode: VocabularyAssessmentResult['mode']) {
  if (mode === 'quick') return '快速测评';
  if (mode === 'calibration') return '校准测评';
  return '标准测评';
}

async function getLocalResult(resultId: string): Promise<VocabularyAssessmentResult> {
  const response = await fetch(
    `/api/local-vocabulary-assessment?resultId=${encodeURIComponent(resultId)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error('无法读取本次测评结果。本地服务重启后，演示结果可能已被清除。');
  return (await response.json()) as VocabularyAssessmentResult;
}

export function VocabularyResult() {
  const params = useParams<{ resultId: string }>();
  const pathname = usePathname();
  const resultId = params.resultId;
  const studentRoute = pathname.startsWith('/student/');
  const vocabularyBase = studentRoute
    ? '/student/learning/english/vocabulary'
    : '/learning/english/vocabulary';
  const listeningRoute = studentRoute
    ? '/student/learning/toefl/listening#vocabulary'
    : '/learning/toefl/listening#vocabulary';
  const { currentTenant } = useWorkspace();
  const [result, setResult] = useState<VocabularyAssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const request = isDemoMode()
      ? getLocalResult(resultId)
      : apiRequest<VocabularyAssessmentResult>(
          tenantPath(
            currentTenant.id,
            `/learning/vocabulary/assessment-results/${encodeURIComponent(resultId)}`,
          ),
        );
    request.then(setResult).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '测评结果加载失败。');
    });
  }, [currentTenant.id, resultId]);

  if (error) {
    return (
      <div className={styles.resultState} role="alert">
        <Info size={28} />
        <h1>暂时无法显示结果</h1>
        <p>{error}</p>
        <Link href={`${vocabularyBase}/assessment`}>返回词汇量测评</Link>
      </div>
    );
  }

  if (!result) {
    return (
      <div className={styles.resultState} aria-busy="true" role="status">
        <span className={styles.resultSpinner} />
        <h1>正在计算词汇画像</h1>
        <p>正在汇总频段后验分布与可信区间…</p>
      </div>
    );
  }

  const reliabilityClass = {
    HIGH: styles.reliabilityHigh,
    MEDIUM: styles.reliabilityMedium,
    LOW: styles.reliabilityLow,
    INVALID: styles.reliabilityInvalid,
  }[result.reliability];

  return (
    <div className={`${styles.pageWrap} ${styles.resultPage}`}>
      <PageHeader
        description={`完成于 ${formatDate(result.completedAt)} · ${modeLabel(result.mode)} · ${result.questionCount} 题`}
        eyebrow="英语 · 词汇 · 测评结果"
        title="你的词汇广度画像"
        actions={
          <Link className={styles.secondaryButton} href={`${vocabularyBase}/assessment`}>
            <RotateCcw size={16} /> 重新测评
          </Link>
        }
      />

      <section className={styles.resultHero}>
        <div className={styles.resultEstimate}>
          <span>书面接受性词族能力等级</span>
          <strong>{result.abilityBand.label}</strong>
          <em>
            {formatNumber(result.abilityBand.lower)}–{formatNumber(result.abilityBand.upper)}{' '}
            词族能力带
          </em>
          <p>
            {result.scoreStatus === 'calibrated' ? '95% 置信区间' : '内部估计范围'}{' '}
            <b>
              {formatNumber(result.interval.lower)}–{formatNumber(result.interval.upper)}
            </b>
            {result.scoreStatus === 'calibrated' ? (
              <> · 正式估计 {formatNumber(result.estimate)}</>
            ) : result.mode === 'standard' ? (
              <> · Beta 点估值约 {formatNumber(result.estimate)}</>
            ) : null}
          </p>
        </div>
        <div className={styles.resultSummary}>
          <span className={`${styles.reliabilityBadge} ${reliabilityClass}`}>
            <ShieldCheck size={16} /> {result.reliabilityLabel}
          </span>
          <h2>这个数字应当如何理解？</h2>
          <p>{result.interpretation}</p>
          <small>
            {result.scoreStatus === 'calibrated'
              ? '本结果使用已冻结的校准版本与词族量尺；仍然只测书面接受性词义识别，不能直接换算成托福分数。'
              : '当前结果尚未完成人真校准，只能用于学习定位，不是正式心理测量分数，也不能直接换算成托福分数。'}
          </small>
        </div>
      </section>

      {result.scoreStatus !== 'calibrated' ? (
        <div className={styles.betaNotice}>
          <Info size={19} />
          <div>
            <strong>
              {result.scoreStatus === 'shadow'
                ? '影子计分 · 正式分数尚未展示'
                : '内部 Beta · 区间与等级优先'}
            </strong>
            <p>
              {result.scoreStatus === 'shadow'
                ? '系统正在并行验证 CAT 与当前 Beta 的稳定性；页面仍以 Beta 能力带和内部范围作为正式展示结果。'
                : '题库完成真人试测、Rasch 校准和外部效度验证前，系统不会把本次点估值标记为正式或高可信度结果。'}
            </p>
          </div>
        </div>
      ) : null}

      {result.reliability === 'LOW' || result.reliability === 'INVALID' ? (
        <div className={styles.resultNotice}>
          <Info size={19} />
          <div>
            <strong>本次结果的稳定性有限</strong>
            <p>
              {result.qualityFlags.length
                ? `检测到：${result.qualityFlags.map((flag) => qualityFlagLabels[flag]).join('、')}。`
                : '本次估计范围较宽。'}
              建议休息后完成一次标准测评；诚实选择“不认识”本身不会降低可信度。
            </p>
          </div>
        </div>
      ) : null}

      <section className={styles.profileCard} aria-labelledby="band-profile-title">
        <div className={styles.resultSectionHeading}>
          <div>
            <span>
              <Layers3 size={19} />
            </span>
            <div>
              <h2 id="band-profile-title">1K–14K 词频段画像</h2>
              <p>越靠左越高频；色条表示该频段的估计认识比例，细线范围表示不确定性。</p>
            </div>
          </div>
          <span>
            {result.scoreStatus === 'calibrated'
              ? '正式校准'
              : result.scoreStatus === 'shadow'
                ? '影子 CAT / Beta 展示'
                : 'Beta 后验'}
          </span>
        </div>
        <div className={styles.bandChart}>
          {result.bandProfile.map((band) => (
            <div className={styles.bandRow} key={band.band}>
              <strong>{band.label}</strong>
              <div className={styles.bandTrack}>
                <span style={{ width: `${band.knownRate}%` }} />
                <i
                  style={{
                    left: `${Math.min(band.lowerRate, band.upperRate)}%`,
                    width: `${Math.max(2, Math.abs(band.upperRate - band.lowerRate))}%`,
                  }}
                />
              </div>
              <b>{band.knownRate}%</b>
            </div>
          ))}
        </div>
        <p className={styles.chartNote}>
          频段百分比来自分层样本与弱单调平滑，不表示该频段每个词都被逐一测试；认识基础词也不代表掌握全部派生词。
        </p>
      </section>

      <section className={styles.resultGrid}>
        <article className={styles.insightCard}>
          <span className={styles.insightIcon}>
            <Target size={21} />
          </span>
          <small>托福学习参考范围</small>
          <strong>{result.toeflCoverage}%</strong>
          <p>3K–10K 频段的综合覆盖参考，用于安排学术词汇学习，不是托福成绩预测。</p>
        </article>
        <article className={styles.insightCard}>
          <span className={styles.insightIcon}>
            <CalendarDays size={21} />
          </span>
          <small>建议每日新词负荷</small>
          <strong>
            {result.dailyWordTarget} <em>词 / 天</em>
          </strong>
          <p>在保证复习与语境学习的前提下，先连续执行两周，再根据记忆保持率调整。</p>
        </article>
        <article className={styles.insightCard}>
          <span className={styles.insightIcon}>
            <Gauge size={21} />
          </span>
          <small>优先补强频段</small>
          <strong className={styles.weakBandValue}>
            {result.weakBands.length ? result.weakBands.join(' · ') : '巩固现有边界'}
          </strong>
          <p>优先学习接近能力边界、又会在学术材料中反复遇到的词，而不是追求生僻词数量。</p>
        </article>
      </section>

      <section className={styles.strengthCard}>
        <div>
          <span>
            <BarChart3 size={22} />
          </span>
          <div>
            <h2>词汇掌握强度</h2>
            <p>本次广度测评没有把一次选择题表现伪装成“掌握强度”分数。</p>
          </div>
        </div>
        <p>
          掌握强度需要通过词义回忆、搭配辨析、语境迁移与间隔复测单独测量。完成后续词汇学习任务，
          Aurelis 才会逐步建立这一维度的画像。
        </p>
        <span className={styles.pendingBadge}>独立维度 · 待积累学习证据</span>
      </section>

      <section className={styles.nextStepCard}>
        <span className={styles.nextStepIcon}>
          <BookOpen size={24} />
        </span>
        <div>
          <span>NEXT STEP</span>
          <h2>从边界附近开始，而不是从最难的词开始。</h2>
          <p>
            下一步建议先用每天 {result.dailyWordTarget} 个词建立小规模学习任务，并在语境中反复复现。
          </p>
        </div>
        <Link href={listeningRoute}>
          进入语境词汇学习 <ArrowRight size={17} />
        </Link>
      </section>

      <details className={styles.methodDetails}>
        <summary>
          <CheckCircle2 size={16} /> 查看本次测评方法与版本
        </summary>
        <div>
          <p>
            {result.scoreStatus === 'calibrated'
              ? '本次结果使用已冻结的 Rasch/IRT 题目参数、受约束 CAT 选题和校准后的完整词族参考域映射；区间由能力标准误传播得到。'
              : '当前 Beta 采用分层抽样、正确／错误／不认识三状态证据、四选一猜测校正与弱单调平滑，并通过 Monte Carlo 抽样生成内部估计范围。正式 Rasch/IRT 参数只会在真人校准达到验收门槛后启用。'}
          </p>
          <dl>
            <div>
              <dt>内容版本</dt>
              <dd>{result.versions.content}</dd>
            </div>
            <div>
              <dt>算法版本</dt>
              <dd>{result.versions.algorithm}</dd>
            </div>
            <div>
              <dt>校准版本</dt>
              <dd>{result.versions.calibration}</dd>
            </div>
            <div>
              <dt>计分状态</dt>
              <dd>{result.scoreStatus}</dd>
            </div>
            <div>
              <dt>计量尺度</dt>
              <dd>{result.scale}</dd>
            </div>
            {result.theta === null ? null : (
              <div>
                <dt>能力值 θ</dt>
                <dd>{result.theta.toFixed(3)}</dd>
              </div>
            )}
            {result.standardError === null ? null : (
              <div>
                <dt>标准误 SE</dt>
                <dd>{result.standardError.toFixed(3)}</dd>
              </div>
            )}
            <div>
              <dt>解释版本</dt>
              <dd>{result.versions.interpretation}</dd>
            </div>
            <div>
              <dt>词表版本</dt>
              <dd>{result.versions.sourceList}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  );
}
