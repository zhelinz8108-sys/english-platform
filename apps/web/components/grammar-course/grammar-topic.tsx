'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock3 } from 'lucide-react';
import { useState } from 'react';
import type { GrammarLesson, GrammarLevelId, GrammarModuleSummary } from '@english/shared';
import { summarizeGrammarTopicProgress } from '@/lib/grammar-topic-progress';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

const verbFormRows = [
  ['work', 'works', 'worked', 'worked', 'working'],
  ['study', 'studies', 'studied', 'studied', 'studying'],
  ['stop', 'stops', 'stopped', 'stopped', 'stopping'],
  ['write', 'writes', 'wrote', 'written', 'writing'],
  ['go', 'goes', 'went', 'gone', 'going'],
] as const;

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function GrammarTopic(props: {
  lesson: GrammarLesson;
  module: GrammarModuleSummary;
  previousTopicId: string | null;
  nextTopicId: string | null;
}) {
  const { lesson, module, previousTopicId, nextTopicId } = props;
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const { progress, error } = useGrammarProgress();
  const [selectedLevel, setSelectedLevel] = useState<GrammarLevelId | null>(null);
  const progressEntries = progress?.entries ?? [];
  const topicProgress = summarizeGrammarTopicProgress(progressEntries, lesson.topicId);
  const currentLevel = selectedLevel ?? topicProgress.nextLevel ?? lesson.stages[0]?.level;
  const activeStage =
    lesson.stages.find((stage) => stage.level === currentLevel) ?? lesson.stages[0]!;
  const activeProgressEntry = progressEntries.find(
    (entry) => entry.topicId === lesson.topicId && entry.level === activeStage.level,
  );
  const rules = activeStage.rules;
  const examples = uniqueBy(
    activeStage.examples,
    (example) => `${example.english}:${example.chinese}`,
  );
  const mistakes = uniqueBy(activeStage.mistakes, (mistake) => `${mistake.wrong}:${mistake.right}`);
  const patterns = uniqueBy(
    [...(lesson.patterns ?? []), ...rules.flatMap((rule) => (rule.pattern ? [rule.pattern] : []))],
    (pattern) => pattern,
  );
  const teachingExamples = [
    ...examples.map((example, index) => ({
      id: `example:${example.english}:${index}`,
      english: example.english,
      chinese: example.chinese,
      explanation: example.note ?? (rules.length ? (rules[index % rules.length]?.title ?? '') : ''),
      pattern: patterns.length ? (patterns[index % patterns.length] ?? null) : null,
      wrong: null,
    })),
    ...mistakes.map((mistake, index) => ({
      id: `correction:${mistake.wrong}:${index}`,
      english: mistake.right,
      chinese: '',
      explanation: mistake.explanation,
      pattern: null,
      wrong: mistake.wrong,
    })),
  ];
  const sources = uniqueBy(
    activeStage.sources,
    (source) => `${source.bookId}:${source.rangeLabel}`,
  );
  const totalQuestionCount = lesson.stages.reduce((total, stage) => total + stage.questionCount, 0);
  const stageStatus =
    activeProgressEntry?.status === 'mastered'
      ? '已掌握'
      : activeProgressEntry?.status === 'practiced'
        ? `最佳 ${activeProgressEntry.bestAccuracy ?? 0}%`
        : activeProgressEntry?.status === 'in_progress'
          ? '练习中'
          : '未练习';

  return (
    <div className={styles.page}>
      <header className={styles.topicHeader}>
        <div>
          <nav className={styles.breadcrumb} aria-label="面包屑">
            <Link href={base}>语法路径</Link>
            <ChevronRight size={13} />
            <Link href={`${base}/module/${module.id}`}>{module.title}</Link>
            <ChevronRight size={13} />
            <span>{lesson.title}</span>
          </nav>
          <p className={styles.eyebrow}>Grammar lesson</p>
          <h1>{lesson.title}</h1>
          <h2>{lesson.english}</h2>
          <p>{lesson.overview}</p>
        </div>
        <div className={styles.topicCounter}>
          <span>本课</span>
          <strong>{lesson.stages.length} 阶段</strong>
          <small>{totalQuestionCount} 道练习</small>
        </div>
      </header>

      {error ? <div className={styles.errorNotice}>{error}</div> : null}

      <div className={styles.stageTabs} aria-label="选择学习阶段">
        {lesson.stages.map((stage, index) => {
          const entry = progressEntries.find(
            (item) => item.topicId === lesson.topicId && item.level === stage.level,
          );
          const status =
            entry?.status === 'mastered'
              ? '已掌握'
              : entry?.status === 'practiced'
                ? `${entry.bestAccuracy ?? 0}%`
                : entry?.status === 'in_progress'
                  ? '练习中'
                  : '未开始';
          return (
            <button
              aria-pressed={currentLevel === stage.level}
              data-active={currentLevel === stage.level}
              key={stage.id}
              onClick={() => setSelectedLevel(stage.level)}
              type="button"
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage.label}</strong>
              <small>{status}</small>
            </button>
          );
        })}
      </div>

      <section aria-label={`${activeStage.label}课程内容`} className={styles.stage}>
        <div className={styles.stageHeading}>
          <div>
            <p className={styles.kicker}>{activeStage.label}</p>
            <h2>{activeStage.focus}</h2>
          </div>
          <div className={styles.stageMeta}>
            <Clock3 size={15} />
            <strong>{activeStage.estimatedMinutes} 分钟</strong>
            <span>{stageStatus}</span>
          </div>
        </div>

        {lesson.topicId === 'verb-forms' ? (
          <div className={styles.formMatrix}>
            <div className={styles.sectionTitleRow}>
              <h3>动词五种形式</h3>
            </div>
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th>原形</th>
                    <th>第三人称单数</th>
                    <th>过去式</th>
                    <th>过去分词</th>
                    <th>-ing 形式</th>
                  </tr>
                </thead>
                <tbody>
                  {verbFormRows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((form, cellIndex) => (
                        <td key={`${row[0]}:${cellIndex}`}>{form}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className={styles.contentSection}>
          <div className={styles.sectionTitleRow}>
            <h3>例句精讲</h3>
            <span>{teachingExamples.length} 组</span>
          </div>
          <div className={styles.exampleList}>
            {teachingExamples.map((example) => (
              <article className={styles.example} key={example.id}>
                <p className={styles.exampleSentence}>{example.english}</p>
                {example.pattern ? (
                  <code className={styles.examplePattern}>{example.pattern}</code>
                ) : null}
                {example.wrong ? (
                  <p className={styles.exampleWrong}>
                    <span>避免</span>
                    <s>{example.wrong}</s>
                  </p>
                ) : null}
                <p className={styles.exampleExplanation}>
                  {example.chinese ? <span>{example.chinese}</span> : null}
                  {example.explanation ? (
                    <span>
                      <strong>{example.wrong ? '改错：' : '看点：'}</strong>
                      {example.explanation}
                    </span>
                  ) : null}
                </p>
              </article>
            ))}
          </div>
        </div>

        {sources.length ? (
          <p className={styles.sourceNote}>
            来源：
            {sources
              .map((source) => `《剑桥${source.levelLabel}英语语法》${source.rangeLabel}`)
              .join('；')}
          </p>
        ) : null}

        {activeStage.practiceAvailable ? (
          <div className={styles.stageAction}>
            <p>
              {activeProgressEntry?.status === 'mastered' ? (
                <>
                  <CheckCircle2 size={14} /> 已掌握
                </>
              ) : (
                `${activeStage.questionCount} 题 · 80% 通过`
              )}
            </p>
            <Link
              className={styles.primaryLink}
              href={`${base}/topic/${lesson.topicId}/practice?level=${activeStage.level}`}
            >
              {activeProgressEntry?.activeSessionId
                ? '继续练习'
                : activeProgressEntry?.attemptCount
                  ? '再次练习'
                  : '开始练习'}
              <ArrowRight size={15} />
            </Link>
          </div>
        ) : null}
      </section>

      <nav className={styles.topicNavigation} aria-label="知识点翻页">
        {previousTopicId ? (
          <Link className={styles.secondaryLink} href={`${base}/topic/${previousTopicId}`}>
            <ArrowLeft size={15} />
            上一知识点
          </Link>
        ) : (
          <span />
        )}
        {nextTopicId ? (
          <Link className={styles.secondaryLink} href={`${base}/topic/${nextTopicId}`}>
            下一知识点
            <ArrowRight size={15} />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
