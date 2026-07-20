'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  Check,
  CheckCircle2,
  Clock3,
  Gauge,
  Keyboard,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui';
import { useWorkspace } from '@/components/workspace-provider';
import {
  ApiProblemError,
  apiRequest,
  createIdempotencyKey,
  isDemoMode,
  normalizeProblem,
  tenantPath,
} from '@/lib/api';
import type {
  VocabularyAssessmentMode,
  VocabularySessionEnvelope,
} from '@/lib/vocabulary-assessment';
import styles from './vocabulary-assessment.module.css';

const resumeStoragePrefix = 'aurelis:vocabulary-assessment:session:';

function modeLabel(mode: VocabularyAssessmentMode): string {
  return mode === 'quick' ? '快速测评' : '标准测评';
}

async function localRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (body) headers.set('Content-Type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  const response = await fetch(path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // The normalized fallback below is enough for non-JSON errors.
    }
    throw new ApiProblemError(normalizeProblem(payload, response.status));
  }
  return (await response.json()) as T;
}

function useAssessmentApi() {
  const { currentTenant } = useWorkspace();
  const demo = isDemoMode();
  const base = tenantPath(currentTenant.id, '/learning/vocabulary/assessments');

  return useMemo(
    () => ({
      create(mode: VocabularyAssessmentMode) {
        return demo
          ? localRequest<VocabularySessionEnvelope>('POST', '/api/local-vocabulary-assessment', {
              action: 'create',
              mode,
            })
          : apiRequest<VocabularySessionEnvelope>(base, {
              method: 'POST',
              json: { mode, targetTrack: 'toefl' },
              idempotencyKey: createIdempotencyKey('vocabulary-assessment-create'),
            });
      },
      get(sessionId: string) {
        return demo
          ? localRequest<VocabularySessionEnvelope>(
              'GET',
              `/api/local-vocabulary-assessment?sessionId=${encodeURIComponent(sessionId)}`,
            )
          : apiRequest<VocabularySessionEnvelope>(`${base}/${encodeURIComponent(sessionId)}`);
      },
      pause(sessionId: string) {
        return demo
          ? localRequest<VocabularySessionEnvelope>('POST', '/api/local-vocabulary-assessment', {
              action: 'pause',
              sessionId,
            })
          : apiRequest<VocabularySessionEnvelope>(
              `${base}/${encodeURIComponent(sessionId)}/pause`,
              { method: 'POST', idempotencyKey: createIdempotencyKey('vocabulary-pause') },
            );
      },
      resume(sessionId: string) {
        return demo
          ? localRequest<VocabularySessionEnvelope>('POST', '/api/local-vocabulary-assessment', {
              action: 'resume',
              sessionId,
            })
          : apiRequest<VocabularySessionEnvelope>(
              `${base}/${encodeURIComponent(sessionId)}/resume`,
              { method: 'POST', idempotencyKey: createIdempotencyKey('vocabulary-resume') },
            );
      },
      answer(
        sessionId: string,
        deliveryId: string,
        selectedOptionId: string,
        responseTimeMs: number,
        focusLossCount: number,
        idempotencyKey: string,
      ) {
        return demo
          ? localRequest<VocabularySessionEnvelope>(
              'POST',
              '/api/local-vocabulary-assessment',
              {
                action: 'answer',
                sessionId,
                deliveryId,
                selectedOptionId,
                responseTimeMs,
                focusLossCount,
              },
              idempotencyKey,
            )
          : apiRequest<VocabularySessionEnvelope>(
              `${base}/${encodeURIComponent(sessionId)}/responses`,
              {
                method: 'POST',
                json: { deliveryId, selectedOptionId, responseTimeMs, focusLossCount },
                idempotencyKey,
              },
            );
      },
    }),
    [base, demo],
  );
}

function HighlightedSentence({ sentence, word }: { sentence: string; word: string }) {
  const start = sentence.toLocaleLowerCase('en').indexOf(word.toLocaleLowerCase('en'));
  if (start < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, start)}
      <strong>{sentence.slice(start, start + word.length)}</strong>
      {sentence.slice(start + word.length)}
    </>
  );
}

function AssessmentLanding({
  busy,
  error,
  resumeSession,
  selectedMode,
  onModeChange,
  onStart,
  onResume,
  onDiscard,
}: {
  busy: boolean;
  error: string | null;
  resumeSession: VocabularySessionEnvelope | null;
  selectedMode: VocabularyAssessmentMode;
  onModeChange: (mode: VocabularyAssessmentMode) => void;
  onStart: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className={styles.pageWrap}>
      <PageHeader
        description="用分层题目估计你的书面接受性词族范围；当前为内部 Beta，正式校准完成前只作学习定位参考。"
        eyebrow="英语 · 词汇"
        title="Aurelis 词汇量测评"
        actions={<span className={styles.betaBadge}>Beta · 估计值</span>}
      />

      {resumeSession ? (
        <section className={styles.resumeCard} aria-label="继续上次测评">
          <span className={styles.resumeIcon}>
            <RotateCcw size={21} />
          </span>
          <div>
            <strong>上次的{modeLabel(resumeSession.mode)}还没有完成</strong>
            <p>已完成 {resumeSession.answeredCount} 题。继续后会从当前题目接着进行。</p>
          </div>
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={onDiscard}
            type="button"
          >
            放弃本次
          </button>
          <button className={styles.primaryButton} disabled={busy} onClick={onResume} type="button">
            <Play size={17} /> 继续测评
          </button>
        </section>
      ) : null}

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>
            <Sparkles size={15} /> 先定位，再给出范围
          </span>
          <h2>知道自己的词汇边界，才能把力气用在真正需要的地方。</h2>
          <p>
            测评会用不同词频段的题目定位，再把题目集中到能力边界附近。结果以词族为单位；
            当前演示题库尚未经过真人校准，不等同于托福分数，也不测口语表达与拼写能力。
          </p>
          <ul className={styles.heroFacts}>
            <li>
              <Target size={18} />
              <span>
                <strong>1K–14K</strong> 分频段估计
              </span>
            </li>
            <li>
              <Gauge size={18} />
              <span>
                <strong>区间</strong> 优先于点估值
              </span>
            </li>
            <li>
              <LockKeyhole size={18} />
              <span>答案仅用于本次测量</span>
            </li>
          </ul>
        </div>
        <div className={styles.estimatePreview} aria-hidden="true">
          <span>能力范围示例</span>
          <strong>6K–8K</strong>
          <small>学术阅读准备 · 内部 Beta</small>
          <div className={styles.previewBands}>
            {[96, 91, 84, 78, 69, 61, 52, 43, 35, 29, 22, 17, 12, 8].map((value) => (
              <i key={value} style={{ height: `${value}%` }} />
            ))}
          </div>
          <em>示意图 · 你的结果会因作答而变化</em>
        </div>
      </section>

      <section className={styles.modeSection} aria-labelledby="assessment-mode-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>STEP 01</span>
            <h2 id="assessment-mode-title">选择测评模式</h2>
          </div>
          <p>快速模式只作粗筛；标准模式题量更多，但校准前仍不是正式诊断分数。</p>
        </div>
        <div className={styles.modeGrid}>
          <button
            aria-pressed={selectedMode === 'quick'}
            className={`${styles.modeCard} ${selectedMode === 'quick' ? styles.modeCardSelected : ''}`}
            onClick={() => onModeChange('quick')}
            type="button"
          >
            <span className={styles.modeCheck}>
              {selectedMode === 'quick' ? <Check size={15} /> : null}
            </span>
            <Clock3 size={24} />
            <strong>快速测评</strong>
            <span>约 6–9 分钟 · 42–56 题</span>
            <p>低风险快速筛查，只输出粗略能力等级和较宽范围。</p>
          </button>
          <button
            aria-pressed={selectedMode === 'standard'}
            className={`${styles.modeCard} ${selectedMode === 'standard' ? styles.modeCardSelected : ''}`}
            onClick={() => onModeChange('standard')}
            type="button"
          >
            <span className={styles.recommended}>推荐</span>
            <span className={styles.modeCheck}>
              {selectedMode === 'standard' ? <Check size={15} /> : null}
            </span>
            <Brain size={24} />
            <strong>标准测评</strong>
            <span>Beta 固定卷 140 题 · 本地演示 56 题</span>
            <p>校准前用每频段 10 题的平行卷；校准达标后切换为 40–60 题正式 CAT。</p>
          </button>
        </div>
      </section>

      <section className={styles.rulesCard}>
        <div>
          <span className={styles.rulesIcon}>
            <BookOpenCheck size={22} />
          </span>
          <div>
            <h2>开始前请确认</h2>
            <p>自然作答比“尽量猜对”更能得到有用的结果。</p>
          </div>
        </div>
        <ul>
          <li>不查词典、不使用翻译软件，也不要让别人提示。</li>
          <li>不认识或拿不准时请选择“不认识 / 不确定”，不要盲猜。</li>
          <li>每题提交后不能返回修改；测评中途可以暂停并继续。</li>
          <li>测评估计书面词义识别广度，不代表完整英语能力或托福分数。</li>
        </ul>
        <div className={styles.startRow}>
          <span>
            <ShieldCheck size={18} /> 仅保存测评所需的作答数据与版本信息
          </span>
          <button className={styles.startButton} disabled={busy} onClick={onStart} type="button">
            {busy ? '正在准备题目…' : `开始${modeLabel(selectedMode)}`} <ArrowRight size={18} />
          </button>
        </div>
        {error ? (
          <p className={styles.errorMessage} role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function AssessmentRunner({
  session,
  busy,
  error,
  onAnswer,
  onAdvance,
  onPause,
  vocabularyBase,
}: {
  session: VocabularySessionEnvelope;
  busy: boolean;
  error: string | null;
  onAnswer: (
    optionId: string,
    responseTimeMs: number,
    focusLossCount: number,
  ) => Promise<VocabularySessionEnvelope | null>;
  onAdvance: (session: VocabularySessionEnvelope) => void;
  onPause: () => void;
  vocabularyBase: string;
}) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<VocabularySessionEnvelope['feedback']>(null);
  const [pendingSession, setPendingSession] = useState<VocabularySessionEnvelope | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(() => performance.now());
  const [focusLossCount, setFocusLossCount] = useState(0);
  const submittingRef = useRef(false);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const question = session.question;

  useEffect(() => {
    setSelectedOptionId(null);
    setFeedback(null);
    setPendingSession(null);
    setQuestionStartedAt(performance.now());
  }, [question?.deliveryId]);

  useEffect(
    () => () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    },
    [],
  );

  const advance = useCallback(() => {
    if (!pendingSession) return;
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setFeedback(null);
    onAdvance(pendingSession);
  }, [onAdvance, pendingSession]);

  const submitOption = useCallback(
    async (optionId: string) => {
      if (!question || busy || feedback || submittingRef.current) return;
      submittingRef.current = true;
      setSelectedOptionId(optionId);
      const updated = await onAnswer(
        optionId,
        performance.now() - questionStartedAt,
        focusLossCount,
      );
      submittingRef.current = false;
      if (!updated?.feedback || updated.feedback.deliveryId !== question.deliveryId) {
        setSelectedOptionId(null);
        return;
      }
      setFeedback(updated.feedback);
      setPendingSession(updated);
      if (updated.feedback.correct) {
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          onAdvance(updated);
        }, 800);
      }
    },
    [busy, feedback, focusLossCount, onAdvance, onAnswer, question, questionStartedAt],
  );

  useEffect(() => {
    function trackFocusLoss() {
      if (document.visibilityState === 'hidden') setFocusLossCount((count) => count + 1);
    }
    document.addEventListener('visibilitychange', trackFocusLoss);
    return () => document.removeEventListener('visibilitychange', trackFocusLoss);
  }, []);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if (!question || busy) return;
      if (['1', '2', '3', '4'].includes(event.key)) {
        const option = question.options[Number(event.key) - 1];
        if (option) void submitOption(option.id);
      } else if (event.key === '5') {
        void submitOption('unknown');
      } else if (event.key === 'Enter' && feedback && !feedback.correct) {
        event.preventDefault();
        advance();
      }
    }
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [advance, busy, feedback, question, submitOption]);

  useEffect(() => {
    function warnBeforeLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, []);

  if (!question) return null;
  const displaySession = pendingSession ?? session;
  const stageTitle = displaySession.stage === 'routing' ? '定位阶段' : '精测阶段';
  const stageDescription =
    displaySession.stage === 'routing' ? '正在扫描不同词频段' : '正在缩小你的估计区间';

  return (
    <div className={styles.runnerPage}>
      <header className={styles.runnerHeader}>
        <Link className={styles.runnerBrand} href={`${vocabularyBase}/assessment`}>
          Aurelis <span>AVA</span>
        </Link>
        <div className={styles.stageCopy}>
          <strong>{stageTitle}</strong>
          <span>{stageDescription}</span>
        </div>
        <button
          className={styles.pauseButton}
          disabled={busy || Boolean(feedback)}
          onClick={onPause}
          type="button"
        >
          <Pause size={16} /> 暂停并保存
        </button>
      </header>
      <div
        className={styles.runnerProgress}
        aria-label="测评阶段进度"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displaySession.stageProgress}
      >
        <span style={{ width: `${displaySession.stageProgress}%` }} />
      </div>

      <main className={styles.questionArea}>
        <div className={styles.questionMeta}>
          <span>自适应词义识别</span>
          <span>已作答 {displaySession.answeredCount} 题</span>
        </div>
        <section className={styles.questionCard} aria-labelledby="target-word">
          <p>选择最符合这个词在句中意思的中文释义</p>
          <h1 id="target-word">{question.targetWord}</h1>
          <blockquote>
            <HighlightedSentence sentence={question.sentence} word={question.targetWord} />
          </blockquote>
          <div className={styles.optionList} role="radiogroup" aria-label="中文释义选项">
            {question.options.map((option, index) => {
              const selected = selectedOptionId === option.id;
              const correct = feedback?.correctOptionId === option.id;
              const incorrect = Boolean(feedback && selected && !correct);
              return (
                <button
                  aria-checked={selected}
                  className={`${styles.optionButton} ${
                    correct
                      ? styles.optionCorrect
                      : incorrect
                        ? styles.optionIncorrect
                        : selected
                          ? styles.optionSelected
                          : ''
                  }`}
                  disabled={busy || Boolean(feedback)}
                  key={option.id}
                  onClick={() => void submitOption(option.id)}
                  role="radio"
                  type="button"
                >
                  <kbd>{index + 1}</kbd>
                  <span>{option.label}</span>
                  <i>
                    {correct ? (
                      <CheckCircle2 size={16} />
                    ) : incorrect ? (
                      <XCircle size={16} />
                    ) : selected ? (
                      <Check size={15} />
                    ) : null}
                  </i>
                </button>
              );
            })}
            <button
              aria-checked={selectedOptionId === 'unknown'}
              className={`${styles.optionButton} ${styles.unknownOption} ${
                feedback && selectedOptionId === 'unknown'
                  ? styles.optionIncorrect
                  : selectedOptionId === 'unknown'
                    ? styles.optionSelected
                    : ''
              }`}
              disabled={busy || Boolean(feedback)}
              onClick={() => void submitOption('unknown')}
              role="radio"
              type="button"
            >
              <kbd>5</kbd>
              <span>不认识 / 不确定</span>
              <i>
                {feedback && selectedOptionId === 'unknown' ? (
                  <XCircle size={16} />
                ) : selectedOptionId === 'unknown' ? (
                  <Check size={15} />
                ) : null}
              </i>
            </button>
          </div>
          {feedback ? (
            <div
              aria-live="polite"
              className={`${styles.answerFeedback} ${
                feedback.correct ? styles.feedbackCorrect : styles.feedbackIncorrect
              }`}
              role="status"
            >
              {feedback.correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
              <div>
                <strong>{feedback.correct ? '回答正确' : '回答错误'}</strong>
                <span>
                  {feedback.correct
                    ? '正在自动进入下一题…'
                    : `正确答案：${
                        question.options.find((option) => option.id === feedback.correctOptionId)
                          ?.label ?? '—'
                      }`}
                </span>
              </div>
            </div>
          ) : null}
          <div className={styles.questionFooter}>
            <span>
              <Keyboard size={17} />{' '}
              {feedback && !feedback.correct
                ? '已显示正确答案，Enter 继续'
                : '数字键选择后立即判定'}
            </span>
            <button
              disabled={!feedback || feedback.correct || busy}
              onClick={advance}
              type="button"
            >
              {busy
                ? '正在判定…'
                : feedback?.correct
                  ? '自动进入下一题…'
                  : feedback
                    ? '知道了，下一题'
                    : '请选择答案'}{' '}
              <ArrowRight size={17} />
            </button>
          </div>
          {error ? (
            <p className={styles.errorMessage} role="alert">
              {error}
            </p>
          ) : null}
        </section>
        <p className={styles.runnerNote}>
          选择后立即显示对错；答对自动进入下一题，答错会显示正确答案并停留复习。
        </p>
      </main>
    </div>
  );
}

export function VocabularyAssessment() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentTenant } = useWorkspace();
  const assessmentApi = useAssessmentApi();
  const storageKey = `${resumeStoragePrefix}${currentTenant.id}`;
  const vocabularyBase = pathname.startsWith('/student/')
    ? '/student/learning/english/vocabulary'
    : '/learning/english/vocabulary';
  const [mode, setMode] = useState<VocabularyAssessmentMode>('standard');
  const [session, setSession] = useState<VocabularySessionEnvelope | null>(null);
  const [resumeSession, setResumeSession] = useState<VocabularySessionEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = window.localStorage.getItem(storageKey);
    if (!sessionId) return;
    assessmentApi
      .get(sessionId)
      .then((saved) => {
        if (saved.status === 'completed' && saved.resultId) {
          window.localStorage.removeItem(storageKey);
          return;
        }
        setResumeSession(saved);
      })
      .catch(() => window.localStorage.removeItem(storageKey));
  }, [assessmentApi, storageKey]);

  const handleFailure = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : '请求未完成，请稍后重试。');
  };

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await assessmentApi.create(mode);
      window.localStorage.setItem(storageKey, created.sessionId);
      setSession(created);
      setResumeSession(null);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!resumeSession) return;
    setBusy(true);
    setError(null);
    try {
      const resumed = await assessmentApi.resume(resumeSession.sessionId);
      setSession(resumed);
      setResumeSession(null);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const paused = await assessmentApi.pause(session.sessionId);
      setSession(null);
      setResumeSession(paused);
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  async function answer(
    optionId: string,
    responseTimeMs: number,
    focusLossCount: number,
  ): Promise<VocabularySessionEnvelope | null> {
    if (!session?.question) return null;
    setBusy(true);
    setError(null);
    const deliveryId = session.question.deliveryId;
    try {
      const updated = await assessmentApi.answer(
        session.sessionId,
        deliveryId,
        optionId,
        responseTimeMs,
        focusLossCount,
        createIdempotencyKey(`vocabulary-answer-${deliveryId}`),
      );
      return updated;
    } catch (cause) {
      handleFailure(cause);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function advanceAfterFeedback(updated: VocabularySessionEnvelope) {
    if (updated.status === 'completed' && updated.resultId) {
      window.localStorage.removeItem(storageKey);
      router.push(`${vocabularyBase}/results/${updated.resultId}`);
      return;
    }
    setSession(updated);
  }

  if (session?.status === 'active') {
    return (
      <AssessmentRunner
        busy={busy}
        error={error}
        onAnswer={answer}
        onAdvance={advanceAfterFeedback}
        onPause={pause}
        session={session}
        vocabularyBase={vocabularyBase}
      />
    );
  }

  return (
    <AssessmentLanding
      busy={busy}
      error={error}
      onDiscard={() => {
        window.localStorage.removeItem(storageKey);
        setResumeSession(null);
      }}
      onModeChange={setMode}
      onResume={resume}
      onStart={start}
      resumeSession={resumeSession}
      selectedMode={mode}
    />
  );
}
