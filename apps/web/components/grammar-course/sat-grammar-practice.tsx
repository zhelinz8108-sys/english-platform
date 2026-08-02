'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CircleAlert, RotateCcw, Shuffle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  SatGrammarPracticeAnswer,
  SatGrammarPracticeItem,
  SatGrammarPracticeMode,
  SatGrammarPracticeSet,
} from '@/lib/sat-grammar';
import { SAT_GRAMMAR_RANDOM_SESSION_SIZE, selectSatGrammarSessionItems } from '@/lib/sat-grammar';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

const answers: SatGrammarPracticeAnswer[] = ['A', 'B', 'C', 'D'];
const difficultyLabels = { Easy: '简单', Medium: '中等', Hard: '困难' } as const;
const verificationLabels = {
  original_answer: '答案已核验',
  inferred_duplicate: '同题答案已核验',
  pending_verification: '答案待核验',
  conflict_review: '答案来源冲突',
} as const;

interface PracticeResult {
  correct: boolean | null;
  gradable: boolean;
}

function shuffleItems(items: SatGrammarPracticeItem[]): SatGrammarPracticeItem[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (!current || !replacement) continue;
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

export function SatGrammarPractice({ practice }: { practice: SatGrammarPracticeSet }) {
  const pathname = usePathname();
  const grammarBase = grammarBasePath(pathname);
  const courseBase = `${grammarBase}/sat`;
  const returnHref = practice.chapterId ? `${courseBase}/${practice.chapterId}` : courseBase;
  const [pool, setPool] = useState(practice.items);
  const [mode, setMode] = useState<SatGrammarPracticeMode>('full');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<SatGrammarPracticeAnswer | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<PracticeResult[]>([]);
  const [completed, setCompleted] = useState(false);

  const sessionItems = useMemo(() => selectSatGrammarSessionItems(pool, mode), [mode, pool]);
  const item = sessionItems[index] ?? null;
  const gradedResults = results.filter((result) => result.gradable);
  const correctCount = gradedResults.filter((result) => result.correct).length;
  const reviewCount = results.length - gradedResults.length;
  const accuracy = gradedResults.length
    ? Math.round((correctCount / gradedResults.length) * 100)
    : null;
  const progress = sessionItems.length
    ? Math.round((results.length / sessionItems.length) * 100)
    : 0;

  function resetQuestionState() {
    setIndex(0);
    setSelected(null);
    setRevealed(false);
    setResults([]);
    setCompleted(false);
  }

  function restartSession() {
    resetQuestionState();
  }

  function startFullSession() {
    setMode('full');
    setPool(practice.items);
    resetQuestionState();
  }

  function startRandomSession() {
    setMode('random');
    setPool(shuffleItems(practice.items));
    resetQuestionState();
  }

  function submitAnswer() {
    if (!item || !selected || revealed) return;
    const gradable = item.gradable && item.answer !== null;
    setResults((current) => [
      ...current,
      { correct: gradable ? selected === item.answer : null, gradable },
    ]);
    setRevealed(true);
  }

  function moveNext() {
    if (index >= sessionItems.length - 1) {
      setCompleted(true);
      return;
    }
    setIndex((current) => current + 1);
    setSelected(null);
    setRevealed(false);
  }

  if (!practice.totalCount || !item) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} href={returnHref}>
          <ArrowLeft size={15} />
          返回 SAT 语法
        </Link>
        <header className={styles.practiceHero}>
          <p className={styles.eyebrow}>SAT Grammar Practice</p>
          <h1>{practice.title}</h1>
          <p>{practice.description}</p>
        </header>
        <div className={styles.practiceEmpty}>
          <CircleAlert aria-hidden size={19} />
          <p>本章暂时没有对应练习题，可以先学习知识点。</p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} href={returnHref}>
          <ArrowLeft size={15} />
          返回 SAT 语法
        </Link>
        <header className={styles.practiceHero}>
          <p className={styles.eyebrow}>Practice Result</p>
          <h1>本组完成</h1>
          <p>{practice.title}</p>
        </header>
        <section aria-label="本组成绩" className={styles.practiceResult}>
          <div>
            <span>已完成</span>
            <strong>{results.length}</strong>
          </div>
          <div>
            <span>已核验题正确率</span>
            <strong>{accuracy === null ? '—' : `${accuracy}%`}</strong>
          </div>
          <div>
            <span>已核验题答对</span>
            <strong>
              {correctCount}/{gradedResults.length}
            </strong>
          </div>
          <div>
            <span>待核验题</span>
            <strong>{reviewCount}</strong>
          </div>
          <div>
            <span>完整题库</span>
            <strong>{practice.totalCount}</strong>
          </div>
        </section>
        <div className={styles.resultActions}>
          <button className={styles.secondaryButton} onClick={restartSession} type="button">
            <RotateCcw size={15} />
            重做本组
          </button>
          <button className={styles.secondaryButton} onClick={startRandomSession} type="button">
            <Shuffle size={15} />
            随机 {Math.min(SAT_GRAMMAR_RANDOM_SESSION_SIZE, practice.totalCount)} 题
          </button>
          {mode === 'random' ? (
            <button className={styles.primaryButton} onClick={startFullSession} type="button">
              进入完整题库
              <ArrowRight size={15} />
            </button>
          ) : (
            <Link className={styles.primaryLink} href={returnHref}>
              返回课程
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    );
  }

  const gradable = item.gradable && item.answer !== null;
  const isCorrect = gradable && revealed && selected === item.answer;
  const feedbackStatus = gradable ? (isCorrect ? 'correct' : 'incorrect') : 'pending';

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href={returnHref}>
        <ArrowLeft size={15} />
        返回 SAT 语法
      </Link>

      <header className={styles.practiceHero}>
        <div>
          <p className={styles.eyebrow}>SAT Grammar Practice</p>
          <h1>{practice.title}</h1>
          <p>{practice.description}</p>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={mode === 'full' ? startRandomSession : startFullSession}
          type="button"
        >
          {mode === 'full' ? <Shuffle size={15} /> : <ArrowLeft size={15} />}
          {mode === 'full'
            ? `随机 ${Math.min(SAT_GRAMMAR_RANDOM_SESSION_SIZE, practice.totalCount)} 题`
            : '返回完整题库'}
        </button>
      </header>

      <section aria-label="练习进度" className={styles.practiceStatus}>
        <div>
          <span>
            {mode === 'full' ? '完整题库' : '随机练习'}第 {index + 1} / {sessionItems.length} 题
          </span>
          <span>完整题库共 {practice.totalCount} 题</span>
        </div>
        <div
          aria-label="当前练习作答进度"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className={styles.practiceProgress}
          role="progressbar"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <article className={styles.questionCard}>
        <header className={styles.questionMeta}>
          <span>{item.id}</span>
          <span>{item.category}</span>
          <span>{difficultyLabels[item.difficulty]}</span>
          <span data-verification={gradable ? 'verified' : 'pending'}>
            {verificationLabels[item.answerStatus]}
          </span>
        </header>

        <section aria-label={`${item.id} 题面`} className={styles.textQuestion}>
          <p>{item.questionText}</p>
        </section>

        <section aria-label="选择答案" className={styles.answerPanel}>
          <p>{gradable ? '选择答案（提交后即时判分）' : '选择答案（本题待核验，不计分）'}</p>
          <div className={styles.answerChoices}>
            {answers.map((answer, answerIndex) => {
              const choice = item.choiceTexts[answerIndex] ?? '';
              const state = revealed
                ? gradable
                  ? answer === item.answer
                    ? 'correct'
                    : answer === selected
                      ? 'incorrect'
                      : 'idle'
                  : answer === selected
                    ? 'recorded'
                    : 'idle'
                : selected === answer
                  ? 'selected'
                  : 'idle';
              return (
                <button
                  aria-label={`选择 ${answer}：${choice}`}
                  aria-pressed={selected === answer}
                  className={styles.answerChoice}
                  data-state={state}
                  disabled={revealed}
                  key={answer}
                  onClick={() => setSelected(answer)}
                  type="button"
                >
                  <strong className={styles.answerLetter}>{answer}</strong>
                  <span className={styles.answerText}>{choice}</span>
                </button>
              );
            })}
          </div>
        </section>

        {revealed ? (
          <section className={styles.answerFeedback} data-status={feedbackStatus}>
            <header>
              {!gradable ? (
                <CircleAlert aria-hidden size={18} />
              ) : isCorrect ? (
                <Check aria-hidden size={18} />
              ) : (
                <X aria-hidden size={18} />
              )}
              <strong>
                {!gradable
                  ? '选择已记录，答案待核验'
                  : isCorrect
                    ? '回答正确'
                    : `回答错误，正确答案是 ${item.answer}`}
              </strong>
            </header>
            <p>{item.explanation}</p>
          </section>
        ) : null}

        <div className={styles.practiceActions}>
          {revealed ? (
            <button className={styles.primaryButton} onClick={moveNext} type="button">
              {index === sessionItems.length - 1 ? '查看本组成绩' : '下一题'}
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              disabled={!selected}
              onClick={submitAnswer}
              type="button"
            >
              {gradable ? '提交答案' : '记录选择'}
              <Check size={15} />
            </button>
          )}
        </div>
      </article>

      <p className={styles.sourceNote}>
        题目来源：{practice.source}。共收录 {practice.totalCount}{' '}
        道完整可作答题；只有答案来源一致且可核验的题目计入正确率。
      </p>
    </div>
  );
}
