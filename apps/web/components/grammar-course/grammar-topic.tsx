'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Lightbulb,
  Sparkles,
} from 'lucide-react';
import type { GrammarLesson, GrammarModuleSummary } from '@english/shared';
import { grammarLevelIds } from '@english/shared';
import { summarizeGrammarTopicProgress } from '@/lib/grammar-topic-progress';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

interface ChapterCopy {
  eyebrow: string;
  title: string;
  description: string;
}

const defaultChapterCopy: ChapterCopy[] = [
  {
    eyebrow: 'Chapter one',
    title: '先建立基本规则',
    description: '先把最常见的形式和核心意义认清，形成稳定的第一判断。',
  },
  {
    eyebrow: 'Chapter two',
    title: '再分清结构与用法',
    description: '把相近形式放在同一个句型中比较，理解什么时候该用、什么时候不能用。',
  },
  {
    eyebrow: 'Chapter three',
    title: '最后处理变体与例外',
    description: '进入真实表达中的变体、语体差异和容易被忽略的特殊情况。',
  },
];

const topicChapterCopy: Record<string, ChapterCopy[]> = {
  'verb-forms': [
    {
      eyebrow: 'Chapter one',
      title: '先认清动词的五张“面孔”',
      description: '从原形、第三人称单数、过去式、过去分词到 -ing，一次建立完整形式地图。',
    },
    {
      eyebrow: 'Chapter two',
      title: '再看助动词决定哪种形式',
      description: '把 do、have、be 放进句型里比较，分清原形、过去分词和 -ing 的位置。',
    },
    {
      eyebrow: 'Chapter three',
      title: '最后攻克不规则与语言变体',
      description: '不靠孤立背词，按变化模式、英美差异和特殊搭配建立记忆线索。',
    },
  ],
};

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
  const progressEntries = progress?.entries ?? [];
  const topicProgress = summarizeGrammarTopicProgress(progressEntries, lesson.topicId);
  const rules = lesson.stages.flatMap((stage) => stage.rules);
  const examples = uniqueBy(
    lesson.stages.flatMap((stage) => stage.examples),
    (example) => `${example.english}:${example.chinese}`,
  );
  const mistakes = uniqueBy(
    lesson.stages.flatMap((stage) => stage.mistakes),
    (mistake) => `${mistake.wrong}:${mistake.right}`,
  );
  const sources = uniqueBy(
    lesson.stages.flatMap((stage) => stage.sources),
    (source) => `${source.bookId}:${source.rangeLabel}`,
  );
  const estimatedMinutes = lesson.stages.reduce(
    (total, stage) => total + stage.estimatedMinutes,
    0,
  );
  const questionCount = lesson.stages.reduce((total, stage) => total + stage.questionCount, 0);
  const practiceAvailable = lesson.stages.some((stage) => stage.practiceAvailable);
  const patterns = uniqueBy(
    [...(lesson.patterns ?? []), ...rules.flatMap((rule) => (rule.pattern ? [rule.pattern] : []))],
    (pattern) => pattern,
  );
  const chapters = topicChapterCopy[lesson.topicId] ?? defaultChapterCopy;
  const practiceLevel =
    topicProgress.nextLevel ?? (topicProgress.mastered ? grammarLevelIds[0] : null);
  const nextProgressEntry = practiceLevel
    ? progressEntries.find(
        (entry) => entry.topicId === lesson.topicId && entry.level === practiceLevel,
      )
    : null;

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
          <p className={styles.eyebrow}>
            {lesson.pilot ? 'Complete grammar lesson' : 'Curriculum topic'}
          </p>
          <h1>{lesson.title}</h1>
          <h2>{lesson.english}</h2>
          <p>{lesson.overview}</p>
        </div>
        <div className={styles.topicCounter}>
          <span>本课学习量</span>
          <strong>{lesson.stages.length} 章</strong>
          <small>
            {rules.length} 条规则 · {examples.length} 组例句
          </small>
        </div>
      </header>

      {error ? <div className={styles.errorNotice}>{error}</div> : null}
      {!lesson.pilot ? (
        <div className={styles.notice}>
          三本教材的重复内容已经融合；建议按下面三章顺序学习，再用例句和易错辨析完成一次闭环。
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="跳转到知识点内容">
        {patterns.length ? <a href="#patterns">核心结构</a> : null}
        <a href="#rules">学习章节</a>
        <a href="#examples">双语例句</a>
        <a href="#mistakes">常见错误</a>
        {practiceAvailable ? <a href="#practice">知识点练习</a> : null}
      </nav>

      <section className={styles.stage} id="rules">
        <div className={styles.stageHeading}>
          <div>
            <p className={styles.kicker}>Continuous learning path</p>
            <h2>不是一张清单，而是一条能学完的路线</h2>
            <p>每章都包含规则解释；结构、例句和易错点在后面相互对应。</p>
          </div>
          <div className={styles.stageMeta}>
            <Clock3 size={15} />
            <strong>约 {estimatedMinutes} 分钟</strong>
            <span>
              {topicProgress.mastered
                ? '已掌握'
                : topicProgress.bestAccuracy === null
                  ? '尚未练习'
                  : `最佳正确率 ${topicProgress.bestAccuracy}%`}
            </span>
          </div>
        </div>

        {patterns.length ? (
          <div className={styles.patternBoard} id="patterns">
            <div className={styles.patternIntro}>
              <BookOpenText size={18} />
              <div>
                <span>先看结构</span>
                <strong>把这一课的骨架装进脑中</strong>
              </div>
            </div>
            <div className={styles.patternGrid}>
              {patterns.map((pattern) => (
                <code key={pattern}>{pattern}</code>
              ))}
            </div>
          </div>
        ) : null}

        {lesson.topicId === 'verb-forms' ? (
          <div className={styles.formMatrix}>
            <div className={styles.sectionTitleRow}>
              <div>
                <p className={styles.kicker}>Form map</p>
                <h3>先用一张表看懂五种形式</h3>
              </div>
              <span>规则与不规则放在一起比较</span>
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

        <div className={styles.chapterList}>
          {lesson.stages.map((stage, stageIndex) => {
            const chapter = chapters[stageIndex] ?? defaultChapterCopy[stageIndex];
            if (!chapter) return null;
            return (
              <article className={styles.lessonChapter} key={stage.id}>
                <header className={styles.chapterHeader}>
                  <span className={styles.chapterOrdinal}>{stageIndex + 1}</span>
                  <div>
                    <p className={styles.kicker}>{chapter.eyebrow}</p>
                    <h3>{chapter.title}</h3>
                    <p>{chapter.description}</p>
                  </div>
                </header>
                <div className={styles.ruleCardGrid}>
                  {stage.rules.map((rule) => (
                    <section className={styles.ruleCard} key={`${stage.id}:${rule.title}`}>
                      <Lightbulb size={16} />
                      <div>
                        <h4>{rule.title}</h4>
                        <p>{rule.body}</p>
                        {rule.pattern ? <code>{rule.pattern}</code> : null}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <div className={styles.contentSection} id="examples">
          <div className={styles.sectionTitleRow}>
            <div>
              <p className={styles.kicker}>Read in context</p>
              <h3>把规则放回句子里</h3>
            </div>
            <span>{examples.length} 组双语例句</span>
          </div>
          <div className={styles.exampleList}>
            {examples.map((example, index) => (
              <div className={styles.example} key={`${example.english}:${index}`}>
                <p>{example.english}</p>
                <small>
                  {example.chinese}
                  {example.note ? ` · ${example.note}` : ''}
                </small>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.contentSection} id="mistakes">
          <div className={styles.sectionTitleRow}>
            <div>
              <p className={styles.kicker}>Common traps</p>
              <h3>最容易用错的地方</h3>
            </div>
            <span>先判断助动词，再选择动词形式</span>
          </div>
          <div className={styles.mistakeList}>
            {mistakes.map((mistake) => (
              <div className={styles.mistake} key={mistake.wrong}>
                <p className={styles.wrong}>× {mistake.wrong}</p>
                <p className={styles.right}>✓ {mistake.right}</p>
                <small>{mistake.explanation}</small>
              </div>
            ))}
          </div>
        </div>

        {sources.length ? (
          <p className={styles.sourceNote}>
            内容参考：
            {sources
              .map((source) => `《剑桥${source.levelLabel}英语语法》${source.rangeLabel}`)
              .join('；')}
            。三本内容已融合编排，教材扫描页不在网站展示。
          </p>
        ) : null}

        {lesson.related?.length ? (
          <div className={styles.relatedTopics}>
            <Sparkles size={15} />
            <span>学完可以继续串联：</span>
            {lesson.related.map((item) => (
              <strong key={item}>{item}</strong>
            ))}
          </div>
        ) : null}

        {practiceAvailable ? (
          <div className={styles.stageAction} id="practice">
            <p>
              {topicProgress.mastered ? (
                <>
                  <CheckCircle2 size={14} /> 已掌握，可再次练习巩固这个知识点。
                </>
              ) : (
                `${questionCount}道分级练习按由简到难排列，每组达到80%后继续下一组。`
              )}
            </p>
            {practiceLevel ? (
              <Link
                className={styles.primaryLink}
                href={`${base}/topic/${lesson.topicId}/practice?level=${practiceLevel}`}
              >
                {topicProgress.mastered
                  ? '再次练习巩固'
                  : nextProgressEntry?.activeSessionId
                    ? '继续知识点练习'
                    : nextProgressEntry?.attemptCount
                      ? '再次练习本组'
                      : '开始知识点练习'}
                <ArrowRight size={15} />
              </Link>
            ) : null}
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
