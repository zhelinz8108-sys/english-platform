'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, CircleAlert, RotateCcw, Shuffle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  SatGrammarPracticeAnswer,
  SatGrammarPracticeItem,
  SatGrammarPracticeSet,
} from '@/lib/sat-grammar';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

const answers: SatGrammarPracticeAnswer[] = ['A', 'B', 'C', 'D'];
const sessionSize = 20;
const difficultyLabels = { Easy: '简单', Medium: '中等', Hard: '困难' } as const;

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
  const [offset, setOffset] = useState(0);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<SatGrammarPracticeAnswer | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [completed, setCompleted] = useState(false);

  const sessionItems = useMemo(
    () => pool.slice(offset, Math.min(offset + sessionSize, pool.length)),
    [offset, pool],
  );
  const item = sessionItems[index] ?? null;
  const correctCount = results.filter(Boolean).length;
  const accuracy = results.length ? Math.round((correctCount / results.length) * 100) : 0;
  const progress = sessionItems.length
    ? Math.round(((results.length + (revealed ? 0 : 0)) / sessionItems.length) * 100)
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

  function nextSequentialSession() {
    const nextOffset = offset + sessionSize >= pool.length ? 0 : offset + sessionSize;
    setOffset(nextOffset);
    resetQuestionState();
  }

  function startRandomSession() {
    setPool(shuffleItems(practice.items));
    setOffset(0);
    resetQuestionState();
  }

  function submitAnswer() {
    if (!item || !selected || revealed) return;
    setResults((current) => [...current, selected === item.answer]);
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
          <p>本章暂时没有题面完整且答案可核验的互动题，可以先学习知识点。</p>
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
            <span>正确率</span>
            <strong>{accuracy}%</strong>
          </div>
          <div>
            <span>答对</span>
            <strong>
              {correctCount}/{sessionItems.length}
            </strong>
          </div>
          <div>
            <span>题库</span>
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
            随机一组
          </button>
          {practice.totalCount > sessionSize ? (
            <button className={styles.primaryButton} onClick={nextSequentialSession} type="button">
              下一组
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

  const isCorrect = revealed && selected === item.answer;

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
        <button className={styles.secondaryButton} onClick={startRandomSession} type="button">
          <Shuffle size={15} />
          随机一组
        </button>
      </header>

      <section aria-label="练习进度" className={styles.practiceStatus}>
        <div>
          <span>
            本组第 {index + 1} / {sessionItems.length} 题
          </span>
          <span>题库共 {practice.totalCount} 题</span>
        </div>
        <div
          aria-label="本组作答进度"
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
        </header>

        <div className={styles.questionImage}>
          <Image
            alt={`${item.id} SAT语法题题干与四个选项`}
            height={item.assetHeight}
            priority={index === 0}
            sizes="(max-width: 900px) 100vw, 920px"
            src={item.asset}
            width={item.assetWidth}
          />
        </div>

        <section aria-label="选择答案" className={styles.answerPanel}>
          <p>选择答案</p>
          <div className={styles.answerChoices}>
            {answers.map((answer) => {
              const state = revealed
                ? answer === item.answer
                  ? 'correct'
                  : answer === selected
                    ? 'incorrect'
                    : 'idle'
                : selected === answer
                  ? 'selected'
                  : 'idle';
              return (
                <button
                  aria-label={`选择 ${answer}`}
                  className={styles.answerChoice}
                  data-state={state}
                  disabled={revealed}
                  key={answer}
                  onClick={() => setSelected(answer)}
                  type="button"
                >
                  {answer}
                </button>
              );
            })}
          </div>
        </section>

        {revealed ? (
          <section className={styles.answerFeedback} data-correct={isCorrect}>
            <header>
              {isCorrect ? <Check aria-hidden size={18} /> : <X aria-hidden size={18} />}
              <strong>{isCorrect ? '回答正确' : `回答错误，正确答案是 ${item.answer}`}</strong>
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
              提交答案
              <Check size={15} />
            </button>
          )}
        </div>
      </article>

      <p className={styles.sourceNote}>
        题目来源：{practice.source}。互动题仅采用题面完整且答案可核验的记录。
      </p>
    </div>
  );
}
