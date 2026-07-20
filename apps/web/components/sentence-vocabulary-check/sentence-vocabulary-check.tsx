'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  Volume2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui';
import type { VocabularyBook } from '@/data/vocabulary-library';
import type {
  SentenceVocabularyAssessmentMode,
  SentenceVocabularyAssessmentPayload,
} from '@/lib/sentence-vocabulary-assessment';
import styles from './sentence-vocabulary-check.module.css';

type CheckStage = 'selection' | 'running' | 'result';

const AMERICAN_VOICE_PREFERENCES = [
  /Microsoft Aria/iu,
  /Microsoft Jenny/iu,
  /Google US English/iu,
  /Samantha/iu,
  /Alex/iu,
  /Microsoft David/iu,
];

function chooseAmericanVoice(voices: SpeechSynthesisVoice[]) {
  const americanVoices = voices.filter(
    (voice) => voice.lang.replace('_', '-').toLowerCase() === 'en-us',
  );
  for (const preference of AMERICAN_VOICE_PREFERENCES) {
    const preferred = americanVoices.find((voice) => preference.test(voice.name));
    if (preferred) return preferred;
  }
  return americanVoices[0] ?? voices.find((voice) => voice.lang.toLowerCase().startsWith('en'));
}

function modeLabel(mode: SentenceVocabularyAssessmentMode) {
  return mode === 'sample-100' ? '随机抽取 100 词' : '检测全部词汇';
}

export function SentenceVocabularyCheck({
  book,
  initialUnitId,
  studentRoute,
}: {
  book: VocabularyBook;
  initialUnitId?: string | undefined;
  studentRoute: boolean;
}) {
  const bookPath = `${studentRoute ? '/student' : ''}/learning/english/vocabulary/books/${book.id}`;
  const allUnitIds = useMemo(
    () => book.sections.flatMap((section) => section.items.map((item) => item.id)),
    [book.sections],
  );
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(
    () => new Set(initialUnitId && allUnitIds.includes(initialUnitId) ? [initialUnitId] : []),
  );
  const [mode, setMode] = useState<SentenceVocabularyAssessmentMode>('sample-100');
  const [stage, setStage] = useState<CheckStage>('selection');
  const [assessment, setAssessment] = useState<SentenceVocabularyAssessmentPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audioSupported, setAudioSupported] = useState(true);
  const [speakingQuestionId, setSpeakingQuestionId] = useState<string | null>(null);
  const [autoAdvanceQuestionId, setAutoAdvanceQuestionId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);

  const currentQuestion = assessment?.questions[currentIndex] ?? null;
  const selectedOptionId = currentQuestion ? answers[currentQuestion.id] : undefined;
  const currentAnswerCorrect = Boolean(
    currentQuestion && selectedOptionId === currentQuestion.correctOptionId,
  );
  const currentQuestionAnswered = Boolean(selectedOptionId);
  const isAutoAdvancing = autoAdvanceQuestionId === currentQuestion?.id;
  const correctOption = currentQuestion?.options.find(
    (option) => option.id === currentQuestion.correctOptionId,
  );
  const answeredCount = Object.keys(answers).length;
  const liveCorrectCount = assessment
    ? assessment.questions.filter((question) => answers[question.id] === question.correctOptionId)
        .length
    : 0;
  const liveAccuracy = answeredCount ? Math.round((liveCorrectCount / answeredCount) * 100) : null;

  useEffect(() => {
    setAudioSupported('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
    return () => {
      window.speechSynthesis?.cancel();
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.speechSynthesis?.cancel();
    utteranceRef.current = null;
    setSpeakingQuestionId(null);
  }, [currentQuestion?.id]);

  const playCurrentWord = useCallback(() => {
    if (
      !currentQuestion ||
      !('speechSynthesis' in window) ||
      !('SpeechSynthesisUtterance' in window)
    )
      return;

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    if (speakingQuestionId === currentQuestion.id) {
      utteranceRef.current = null;
      setSpeakingQuestionId(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(currentQuestion.word);
    utterance.lang = 'en-US';
    utterance.rate = 0.76;
    utterance.pitch = 1;
    const voice = chooseAmericanVoice(synthesis.getVoices());
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      utteranceRef.current = null;
      setSpeakingQuestionId((current) => (current === currentQuestion.id ? null : current));
    };
    utterance.onerror = utterance.onend;
    utteranceRef.current = utterance;
    setSpeakingQuestionId(currentQuestion.id);
    synthesis.speak(utterance);
  }, [currentQuestion, speakingQuestionId]);

  const result = useMemo(() => {
    if (!assessment) return null;
    const wrong = assessment.questions.filter(
      (question) => answers[question.id] !== question.correctOptionId,
    );
    const correctCount = assessment.questions.length - wrong.length;
    return {
      correctCount,
      percentage: Math.round((correctCount / assessment.questions.length) * 100),
      wrong,
    };
  }, [answers, assessment]);

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }

  function toggleSection(unitIds: string[]) {
    setSelectedUnitIds((current) => {
      const next = new Set(current);
      const sectionSelected = unitIds.every((unitId) => next.has(unitId));
      unitIds.forEach((unitId) => (sectionSelected ? next.delete(unitId) : next.add(unitId)));
      return next;
    });
  }

  async function startAssessment() {
    if (selectedUnitIds.size === 0 || loading) return;
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/local-vocabulary-books/${encodeURIComponent(book.id)}/sentence-assessment`,
        {
          body: JSON.stringify({ mode, unitIds: [...selectedUnitIds] }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      const payload = (await response.json()) as SentenceVocabularyAssessmentPayload & {
        detail?: string;
        title?: string;
      };
      if (!response.ok) throw new Error(payload.detail ?? payload.title ?? '检测题生成失败');
      setAssessment(payload);
      setAnswers({});
      setCurrentIndex(0);
      setAutoAdvanceQuestionId(null);
      setStage('running');
      window.scrollTo({ behavior: 'smooth', top: 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '检测题生成失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  const finishAssessment = useCallback(() => {
    if (!assessment) return;
    setAutoAdvanceQuestionId(null);
    setStage('result');
    window.scrollTo({ behavior: 'smooth', top: 0 });
  }, [assessment]);

  const moveNext = useCallback(() => {
    if (!assessment || !currentQuestion || !selectedOptionId) return;
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setAutoAdvanceQuestionId(null);
    if (currentIndex === assessment.questionCount - 1) finishAssessment();
    else setCurrentIndex((index) => index + 1);
  }, [assessment, currentIndex, currentQuestion, finishAssessment, selectedOptionId]);

  const answerCurrentQuestion = useCallback(
    (optionId: string) => {
      if (!assessment || !currentQuestion || selectedOptionId) return;
      setAnswers((current) => ({ ...current, [currentQuestion.id]: optionId }));
      if (optionId !== currentQuestion.correctOptionId) return;

      setAutoAdvanceQuestionId(currentQuestion.id);
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        setAutoAdvanceQuestionId(null);
        if (currentIndex === assessment.questionCount - 1) {
          setStage('result');
          window.scrollTo({ behavior: 'smooth', top: 0 });
        } else {
          setCurrentIndex((index) => index + 1);
        }
      }, 800);
    },
    [assessment, currentIndex, currentQuestion, selectedOptionId],
  );

  useEffect(() => {
    if (stage !== 'running' || !currentQuestion) return;
    const question = currentQuestion;
    function handleKeyboard(event: KeyboardEvent) {
      if (['1', '2', '3', '4'].includes(event.key)) {
        const option = question.options[Number(event.key) - 1];
        if (option) answerCurrentQuestion(option.id);
      }
      if (event.key === 'Enter' && answers[question.id] && !isAutoAdvancing) moveNext();
    }
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [answerCurrentQuestion, answers, currentQuestion, isAutoAdvancing, moveNext, stage]);

  if (stage === 'running' && assessment && currentQuestion) {
    return (
      <div className={styles.runnerPage}>
        <header className={styles.runnerHeader}>
          <button
            className={styles.exitButton}
            onClick={() => {
              if (autoAdvanceTimerRef.current !== null) {
                window.clearTimeout(autoAdvanceTimerRef.current);
                autoAdvanceTimerRef.current = null;
              }
              setAutoAdvanceQuestionId(null);
              setStage('selection');
            }}
            type="button"
          >
            <ArrowLeft size={17} /> 返回选择
          </button>
          <div>
            <strong>句子词汇检测</strong>
            <span>{modeLabel(assessment.mode)}</span>
          </div>
          <div className={styles.runnerMetrics}>
            <span className={styles.runnerAccuracy}>
              正确率 {liveAccuracy === null ? '--' : `${liveAccuracy}%`}
            </span>
            <span className={styles.runnerCount}>
              {currentIndex + 1} / {assessment.questionCount}
            </span>
          </div>
        </header>
        <div className={styles.progressTrack}>
          <span style={{ width: `${((currentIndex + 1) / assessment.questionCount) * 100}%` }} />
        </div>

        <div className={styles.questionArea}>
          <div className={styles.questionContext}>
            <span>{currentQuestion.unitTitle}</span>
            <span>
              答对 {liveCorrectCount} / 已作答 {answeredCount} 题
            </span>
          </div>
          <section className={styles.questionCard} aria-labelledby="sentence-vocabulary-word">
            <p>选择与这个单词最匹配的中文释义</p>
            <div className={styles.wordHeading}>
              <h1 id="sentence-vocabulary-word">{currentQuestion.word}</h1>
              <button
                aria-label={`${
                  speakingQuestionId === currentQuestion.id ? '停止' : '播放'
                }单词美式发音：${currentQuestion.word}`}
                aria-pressed={speakingQuestionId === currentQuestion.id}
                className={`${styles.audioButton} ${
                  speakingQuestionId === currentQuestion.id ? styles.audioButtonPlaying : ''
                }`}
                disabled={!audioSupported}
                onClick={playCurrentWord}
                title={
                  audioSupported
                    ? `${speakingQuestionId === currentQuestion.id ? '停止' : '播放'}美式发音`
                    : '当前浏览器不支持语音播放'
                }
                type="button"
              >
                {speakingQuestionId === currentQuestion.id ? (
                  <Square fill="currentColor" size={12} />
                ) : (
                  <Volume2 size={17} />
                )}
              </button>
            </div>
            <div className={styles.wordMeta}>
              {currentQuestion.pronunciation ? <span>{currentQuestion.pronunciation}</span> : null}
              {currentQuestion.partOfSpeech ? <span>{currentQuestion.partOfSpeech}.</span> : null}
            </div>
            <div className={styles.optionList} role="radiogroup" aria-label="中文释义选项">
              {currentQuestion.options.map((option, index) => {
                const selected = selectedOptionId === option.id;
                const correct =
                  currentQuestionAnswered && option.id === currentQuestion.correctOptionId;
                const incorrect = currentQuestionAnswered && selected && !correct;
                const optionClassName = correct
                  ? styles.optionCorrect
                  : incorrect
                    ? styles.optionIncorrect
                    : selected
                      ? styles.optionSelected
                      : undefined;
                return (
                  <button
                    aria-checked={selected}
                    className={optionClassName}
                    disabled={currentQuestionAnswered}
                    key={option.id}
                    onClick={() => answerCurrentQuestion(option.id)}
                    role="radio"
                    type="button"
                  >
                    <kbd>{index + 1}</kbd>
                    <span>{option.label}</span>
                    <i>
                      {correct ? (
                        <CheckCircle2 size={17} />
                      ) : incorrect ? (
                        <XCircle size={17} />
                      ) : selected ? (
                        <Check size={16} />
                      ) : null}
                    </i>
                  </button>
                );
              })}
            </div>
            {currentQuestionAnswered ? (
              <div
                aria-live="polite"
                className={`${styles.answerFeedback} ${
                  currentAnswerCorrect ? styles.feedbackCorrect : styles.feedbackIncorrect
                }`}
                role="status"
              >
                {currentAnswerCorrect ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                <div>
                  <strong>{currentAnswerCorrect ? '回答正确' : '回答错误'}</strong>
                  <span>
                    {currentAnswerCorrect
                      ? isAutoAdvancing
                        ? '正在自动进入下一题…'
                        : '这道题已经答对。'
                      : `正确答案：${correctOption?.label ?? '—'}`}
                  </span>
                </div>
              </div>
            ) : null}
            <footer className={styles.questionFooter}>
              <button
                disabled={currentIndex === 0 || isAutoAdvancing}
                onClick={() => {
                  setAutoAdvanceQuestionId(null);
                  setCurrentIndex((index) => Math.max(0, index - 1));
                }}
                type="button"
              >
                <ArrowLeft size={16} /> 上一题
              </button>
              <span>
                {currentQuestionAnswered
                  ? currentAnswerCorrect
                    ? '回答正确后自动继续'
                    : '已显示正确答案，Enter 继续'
                  : '数字键 1–4 选择后立即判定'}
              </span>
              <button
                disabled={!currentQuestionAnswered || isAutoAdvancing}
                onClick={moveNext}
                type="button"
              >
                {isAutoAdvancing
                  ? '自动进入下一题…'
                  : currentIndex === assessment.questionCount - 1
                    ? '查看检测结果'
                    : currentQuestionAnswered
                      ? '知道了，下一题'
                      : '请选择答案'}
                <ArrowRight size={16} />
              </button>
            </footer>
          </section>
        </div>
      </div>
    );
  }

  if (stage === 'result' && assessment && result) {
    return (
      <div className={styles.page}>
        <PageHeader
          actions={
            <Link className={styles.backLink} href={bookPath}>
              <ArrowLeft size={17} /> 返回词汇书
            </Link>
          }
          description={`本次检测来自 ${assessment.selectedUnitIds.length} 个句子，共 ${assessment.questionCount} 个词。`}
          eyebrow="英语 · 词汇 · 检测结果"
          title="句子词汇检测结果"
        />
        <section className={styles.resultHero}>
          <div className={styles.resultScore}>
            <span>正确率</span>
            <strong>{result.percentage}%</strong>
            <small>
              答对 {result.correctCount} / {assessment.questionCount} 题
            </small>
          </div>
          <div className={styles.resultCopy}>
            <CheckCircle2 size={26} />
            <div>
              <h2>{result.percentage >= 80 ? '掌握得不错' : '已经定位到需要复习的词'}</h2>
              <p>下面列出错题及正确释义；返回句子阅读页后可以针对这些词继续复习。</p>
            </div>
          </div>
          <button
            onClick={() => {
              setAssessment(null);
              setAnswers({});
              setStage('selection');
            }}
            type="button"
          >
            <RotateCcw size={17} /> 重新选择检测范围
          </button>
        </section>

        <section className={styles.wrongSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Review</span>
              <h2>错题复盘</h2>
            </div>
            <p>
              {result.wrong.length ? `${result.wrong.length} 个词需要复习` : '本次检测全部答对'}
            </p>
          </div>
          {result.wrong.length ? (
            <div className={styles.wrongList}>
              {result.wrong.slice(0, 100).map((question) => {
                const selected = question.options.find(
                  (option) => option.id === answers[question.id],
                );
                const correct = question.options.find(
                  (option) => option.id === question.correctOptionId,
                );
                return (
                  <article key={question.id}>
                    <div>
                      <strong>{question.word}</strong>
                      <span>{question.unitTitle}</span>
                    </div>
                    <p>
                      <XCircle size={15} /> 你的选择：{selected?.label ?? '未作答'}
                    </p>
                    <p>
                      <CheckCircle2 size={15} /> 正确释义：{correct?.label}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.perfectState}>
              <CheckCircle2 size={30} />
              <strong>全部答对</strong>
              <span>这组句子的词汇掌握得非常扎实。</span>
            </div>
          )}
          {result.wrong.length > 100 ? (
            <p className={styles.resultNote}>错题较多，当前先展示前 100 个词。</p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        actions={
          <Link className={styles.backLink} href={bookPath}>
            <ArrowLeft size={17} /> 返回词汇书
          </Link>
        }
        description="选择要覆盖的托福长句，再随机抽取 100 个词或检测所选句子的全部词汇。"
        eyebrow="英语 · 词汇 · TOEFL"
        title="句子词汇检测"
      />

      <section className={styles.selectionSummary}>
        <span className={styles.summaryIcon}>
          <ClipboardCheck size={23} />
        </span>
        <div>
          <strong>
            已选择 {selectedUnitIds.size} / {allUnitIds.length} 个句子
          </strong>
          <p>干扰项优先来自同一句、同词性的词汇，四个选项均为真实中文释义。</p>
        </div>
        <button onClick={() => setSelectedUnitIds(new Set(allUnitIds))} type="button">
          <ListChecks size={16} /> 全选 100 句
        </button>
        <button onClick={() => setSelectedUnitIds(new Set())} type="button">
          清空
        </button>
      </section>

      <section className={styles.sentenceSection} aria-labelledby="sentence-selection-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Step 01</span>
            <h2 id="sentence-selection-title">选择句子</h2>
          </div>
          <p>可以单选、多选，也可以按每组 10 句快速选择。</p>
        </div>
        <div className={styles.sentenceGroups}>
          {book.sections.map((section) => {
            const sectionUnitIds = section.items.map((item) => item.id);
            const sectionSelected = sectionUnitIds.every((unitId) => selectedUnitIds.has(unitId));
            return (
              <article className={styles.sentenceGroup} key={section.id}>
                <header>
                  <div>
                    <strong>{section.title}</strong>
                    <span>{section.items.length} 句</span>
                  </div>
                  <button onClick={() => toggleSection(sectionUnitIds)} type="button">
                    {sectionSelected ? '取消本组' : '选择本组'}
                  </button>
                </header>
                <div>
                  {section.items.map((item) => {
                    const selected = selectedUnitIds.has(item.id);
                    const sentenceNumber = item.title.replace(/^Sentence\s+/u, '');
                    return (
                      <button
                        aria-label={item.title}
                        aria-checked={selected}
                        className={selected ? styles.sentenceSelected : undefined}
                        key={item.id}
                        onClick={() => toggleUnit(item.id)}
                        role="checkbox"
                        type="button"
                      >
                        <span>{selected ? <Check size={14} /> : null}</span>
                        <strong>{sentenceNumber}</strong>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.modeSection} aria-labelledby="sentence-mode-title">
        <div className={styles.sectionHeading}>
          <div>
            <span>Step 02</span>
            <h2 id="sentence-mode-title">选择检测题量</h2>
          </div>
          <p>随机抽取适合快速定位；全部检测适合完整复习。</p>
        </div>
        <div className={styles.modeGrid}>
          <button
            aria-pressed={mode === 'sample-100'}
            className={mode === 'sample-100' ? styles.modeSelected : undefined}
            onClick={() => setMode('sample-100')}
            type="button"
          >
            <span>{mode === 'sample-100' ? <Check size={15} /> : null}</span>
            <Sparkles size={23} />
            <strong>随机抽取 100 词</strong>
            <p>从所选句子的首次出现词条中随机抽取；不足 100 词时检测全部。</p>
          </button>
          <button
            aria-pressed={mode === 'all'}
            className={mode === 'all' ? styles.modeSelected : undefined}
            onClick={() => setMode('all')}
            type="button"
          >
            <span>{mode === 'all' ? <Check size={15} /> : null}</span>
            <Target size={23} />
            <strong>检测全部词汇</strong>
            <p>覆盖所选句子的全部有效词条，适合完成阶段性复习。</p>
          </button>
        </div>
      </section>

      <section className={styles.startPanel}>
        <div>
          <strong>
            {selectedUnitIds.size ? `准备检测 ${selectedUnitIds.size} 个句子` : '请先选择句子'}
          </strong>
          <p>{modeLabel(mode)} · 每题 4 个中文释义 · 提交后统一查看结果</p>
        </div>
        <button
          disabled={selectedUnitIds.size === 0 || loading}
          onClick={startAssessment}
          type="button"
        >
          {loading ? '正在生成题目…' : '开始检测'} <ArrowRight size={18} />
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
