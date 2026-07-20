'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock3 } from 'lucide-react';
import type { GrammarLesson, GrammarModuleSummary } from '@english/shared';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

const levelNumbers = { beginner: '01', intermediate: '02', advanced: '03' } as const;

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
  const topicProgress = progress?.entries.filter((entry) => entry.topicId === lesson.topicId) ?? [];
  const masteredCount = topicProgress.filter((entry) => entry.status === 'mastered').length;

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
            {lesson.pilot ? 'Complete pilot lesson' : 'Curriculum outline'}
          </p>
          <h1>{lesson.title}</h1>
          <h2>{lesson.english}</h2>
          <p>{lesson.overview}</p>
        </div>
        <div className={styles.topicCounter}>
          <strong>{masteredCount}/3</strong>
          <span>阶段已掌握</span>
        </div>
      </header>

      {error ? <div className={styles.errorNotice}>{error}</div> : null}
      {!lesson.pilot ? (
        <div className={styles.notice}>
          该知识点目前保留三级课程提纲；完整讲解和原创练习将在试点验收后上线。
        </div>
      ) : null}

      <nav className={styles.anchorNav} aria-label="跳转到学习阶段">
        {lesson.stages.map((stage) => (
          <a href={`#${stage.level}`} key={stage.level}>
            {stage.label} · {stage.focus}
          </a>
        ))}
      </nav>

      {lesson.stages.map((stage) => {
        const stageProgress = topicProgress.find((entry) => entry.level === stage.level);
        return (
          <section className={styles.stage} id={stage.level} key={stage.level}>
            <div className={styles.stageHeading}>
              <div>
                <p className={styles.kicker}>Stage {levelNumbers[stage.level]}</p>
                <h2>
                  <span className={styles.stageNumber}>{levelNumbers[stage.level]}</span>
                  {stage.label}
                </h2>
                <p>{stage.focus}</p>
              </div>
              <div className={styles.stageMeta}>
                <Clock3 size={15} />
                <strong>约 {stage.estimatedMinutes} 分钟</strong>
                <span>
                  {stageProgress?.bestAccuracy !== null && stageProgress?.bestAccuracy !== undefined
                    ? `最佳正确率 ${stageProgress.bestAccuracy}%`
                    : '尚未练习'}
                </span>
              </div>
            </div>

            <ul className={styles.objectives}>
              {stage.objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>

            <div className={styles.contentSection}>
              <h3>规则讲解</h3>
              <div className={styles.ruleList}>
                {stage.rules.map((rule) => (
                  <div className={styles.rule} key={rule.title}>
                    <strong>{rule.title}</strong>
                    <div>
                      <p>{rule.body}</p>
                      {rule.pattern ? <code>{rule.pattern}</code> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.contentSection}>
              <h3>双语例句</h3>
              <div className={styles.exampleList}>
                {stage.examples.map((example, index) => (
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

            <div className={styles.contentSection}>
              <h3>常见错误</h3>
              <div className={styles.mistakeList}>
                {stage.mistakes.map((mistake) => (
                  <div className={styles.mistake} key={mistake.wrong}>
                    <p className={styles.wrong}>× {mistake.wrong}</p>
                    <p className={styles.right}>✓ {mistake.right}</p>
                    <small>{mistake.explanation}</small>
                  </div>
                ))}
              </div>
            </div>

            {stage.sources.length ? (
              <p className={styles.sourceNote}>
                参考范围：
                {stage.sources.map((item) => `${item.levelLabel} ${item.rangeLabel}`).join('；')}
                。教材扫描页不在网站展示。
              </p>
            ) : null}

            <div className={styles.stageAction}>
              <p>
                {stage.practiceAvailable ? (
                  stageProgress?.status === 'mastered' ? (
                    <>
                      <CheckCircle2 size={14} /> 已掌握，可再次练习刷新最佳正确率。
                    </>
                  ) : (
                    `完成${stage.questionCount}道原创题，达到80%标记为已掌握。`
                  )
                ) : (
                  '该阶段练习尚在制作中。'
                )}
              </p>
              {stage.practiceAvailable ? (
                <Link
                  className={styles.primaryLink}
                  href={`${base}/topic/${lesson.topicId}/practice?level=${stage.level}`}
                >
                  {stageProgress?.activeSessionId
                    ? '继续练习'
                    : stageProgress?.attemptCount
                      ? '再次练习'
                      : `开始${stage.questionCount}题练习`}
                  <ArrowRight size={15} />
                </Link>
              ) : null}
            </div>
          </section>
        );
      })}

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
