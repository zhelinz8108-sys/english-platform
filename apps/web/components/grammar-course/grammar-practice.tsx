'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  GrammarLevelId,
  GrammarPracticeResult,
  GrammarPracticeSessionEnvelope,
} from '@english/shared';
import { grammarBasePath, useGrammarPracticeApi } from './grammar-api';
import styles from './grammar-course.module.css';

const levelLabels: Record<GrammarLevelId, string> = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级',
};

const kindLabels = {
  single_choice: 'Single choice',
  true_false: 'True or false',
  fill_blank: 'Fill in the blank',
  error_correction: 'Error correction',
} as const;

export function GrammarPractice(props: { topicId: string; title: string; level: GrammarLevelId }) {
  const { topicId, title, level } = props;
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const api = useGrammarPracticeApi();
  const [session, setSession] = useState<GrammarPracticeSessionEnvelope | null>(null);
  const [result, setResult] = useState<GrammarPracticeResult | null>(null);
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.create(topicId, level);
      setSession(created);
      setResult(created.result);
      const firstUnanswered = created.questions.findIndex(
        (question) => !created.answers[question.id]?.trim(),
      );
      setIndex(firstUnanswered < 0 ? created.questions.length - 1 : firstUnanswered);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法开始语法练习。');
    } finally {
      setBusy(false);
    }
  }, [api, level, topicId]);

  useEffect(() => {
    void start();
  }, [start]);

  const question = session?.questions[index] ?? null;
  useEffect(() => {
    setDraft(question ? (session?.answers[question.id] ?? '') : '');
  }, [question, session?.answers]);

  const answered = session?.answeredCount ?? 0;
  const progressPercent = session ? Math.round((answered / session.questionCount) * 100) : 0;
  const canSave = Boolean(question && draft.trim() && !busy);

  async function saveAnswer(moveNext: boolean) {
    if (!session || !question || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.answer(session.sessionId, question.id, draft);
      setSession(updated);
      if (moveNext && index < updated.questions.length - 1) setIndex(index + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '答案保存失败。');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!session || session.answeredCount !== session.questionCount) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.submit(session.sessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '练习提交失败。');
    } finally {
      setBusy(false);
    }
  }

  if (busy && !session && !result) {
    return <div className={styles.loading}>正在准备10道原创语法题…</div>;
  }

  if (result) {
    return (
      <div className={styles.practiceShell}>
        <header className={styles.practiceHeader}>
          <p className={styles.eyebrow}>Grammar practice result</p>
          <h1>
            {title} · {levelLabels[level]}
          </h1>
          <p>
            {result.mastered
              ? '本阶段已掌握。你仍可以再次练习并刷新最佳正确率。'
              : '本次尚未达到80%，可查看解析后再次练习。'}
          </p>
        </header>
        <section className={styles.resultSummary} aria-label="练习成绩">
          <div>
            <span>本次正确率</span>
            <strong>{result.accuracy}%</strong>
          </div>
          <div>
            <span>答对</span>
            <strong>
              {result.correctCount}/{result.questionCount}
            </strong>
          </div>
          <div>
            <span>历史最佳</span>
            <strong>{result.bestAccuracy}%</strong>
          </div>
          <div>
            <span>掌握状态</span>
            <strong>{result.mastered ? '已掌握' : '待巩固'}</strong>
          </div>
        </section>
        <div className={styles.toolbar}>
          <div>
            <p className={styles.kicker}>Review</p>
            <h2>逐题解析</h2>
          </div>
          <div className={styles.topicNavigation}>
            <Link className={styles.secondaryLink} href={`${base}/topic/${topicId}`}>
              <ArrowLeft size={15} />
              返回课程
            </Link>
            <button
              className={styles.primaryButton}
              disabled={busy}
              onClick={() => void start()}
              type="button"
            >
              <RotateCcw size={15} />
              再次练习
            </button>
          </div>
        </div>
        <div className={styles.reviewList}>
          {result.review.map((item, reviewIndex) => (
            <article
              className={styles.reviewItem}
              data-correct={item.correct}
              key={item.questionId}
            >
              <p>
                {item.correct ? <Check size={15} /> : <X size={15} />} {reviewIndex + 1}.{' '}
                {item.prompt}
              </p>
              <div className={styles.reviewAnswers}>
                <span>
                  你的答案<strong>{item.selectedAnswer || '未作答'}</strong>
                </span>
                <span>
                  正确答案<strong>{item.correctAnswer}</strong>
                </span>
              </div>
              <small>{item.explanation}</small>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (!session || !question) {
    return (
      <div className={styles.practiceShell}>
        <div className={styles.errorNotice}>{error ?? '练习暂时不可用。'}</div>
        <Link className={styles.secondaryLink} href={`${base}/topic/${topicId}`}>
          <ArrowLeft size={15} />
          返回课程
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.practiceShell}>
      <header className={styles.practiceHeader}>
        <p className={styles.eyebrow}>Grammar practice · {levelLabels[level]}</p>
        <h1>{title}</h1>
        <p>共10题；答案会逐题保存，全部完成后显示正确率、最佳成绩和解析。</p>
      </header>
      <div className={styles.practiceTopline}>
        <span>
          第 {index + 1} / {session.questionCount} 题
        </span>
        <span>已保存 {answered} 题</span>
      </div>
      <div
        aria-label="作答进度"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        className={styles.progressTrack}
        role="progressbar"
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      {error ? <div className={styles.errorNotice}>{error}</div> : null}
      <section className={styles.practiceCard}>
        <span className={styles.questionKind}>{kindLabels[question.kind]}</span>
        <p className={styles.questionPrompt}>{question.prompt}</p>
        <p className={styles.questionInstruction}>{question.instruction}</p>
        {question.options ? (
          <div className={styles.options}>
            {question.options.map((option, optionIndex) => (
              <button
                className={styles.option}
                data-selected={draft === option.id}
                key={option.id}
                onClick={() => setDraft(option.id)}
                type="button"
              >
                <span>{optionIndex + 1}</span>
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <input
            autoComplete="off"
            autoFocus
            className={styles.answerInput}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSave)
                void saveAnswer(index < session.questionCount - 1);
            }}
            placeholder="输入答案"
            value={draft}
          />
        )}
        <div className={styles.practiceActions}>
          <button
            className={styles.secondaryButton}
            disabled={index === 0 || busy}
            onClick={() => setIndex(index - 1)}
            type="button"
          >
            <ArrowLeft size={15} />
            上一题
          </button>
          {index < session.questionCount - 1 ? (
            <button
              className={styles.primaryButton}
              disabled={!canSave}
              onClick={() => void saveAnswer(true)}
              type="button"
            >
              保存并下一题
              <ArrowRight size={15} />
            </button>
          ) : session.answeredCount === session.questionCount &&
            session.answers[question.id] === draft ? (
            <button
              className={styles.primaryButton}
              disabled={busy}
              onClick={() => void submit()}
              type="button"
            >
              提交并查看正确率
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              disabled={!canSave}
              onClick={() => void saveAnswer(false)}
              type="button"
            >
              保存本题
              <Check size={15} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
