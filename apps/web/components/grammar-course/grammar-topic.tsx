'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ListChecks,
  Target,
  TriangleAlert,
} from 'lucide-react';
import type { GrammarLesson, GrammarModuleSummary } from '@english/shared';
import { grammarBasePath } from './grammar-api';
import styles from './grammar-course.module.css';

type ReadingLineKind = 'bullet' | 'correct' | 'example' | 'note' | 'wrong';

function readingLineKind(line: string): ReadingLineKind {
  if (line.startsWith('• ')) return 'bullet';
  if (['错误：', '不清楚：'].some((prefix) => line.startsWith(prefix))) return 'wrong';
  if (['正确：', '清楚：', '更清楚：', '简化：'].some((prefix) => line.startsWith(prefix))) {
    return 'correct';
  }
  if (/[A-Za-z]{2}/u.test(line)) return 'example';
  return 'note';
}

export function GrammarTopic(props: {
  lesson: GrammarLesson;
  module: GrammarModuleSummary;
  sections: Array<{ title: string; lines: string[]; details: string[] }>;
  guide: { goals: string[]; steps: string[]; traps: string[] };
  previousTopicId: string | null;
  nextTopicId: string | null;
}) {
  const { lesson, module, sections, guide, previousTopicId, nextTopicId } = props;
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const topic = module.topics.find((item) => item.id === lesson.topicId);
  const source = lesson.stages[0]?.sources[0];

  return (
    <div className={styles.page}>
      <header className={styles.topicHeader}>
        <div>
          <nav className={styles.breadcrumb} aria-label="面包屑">
            <Link href={base}>SAT 语法</Link>
            <ChevronRight size={13} />
            <Link href={`${base}/module/${module.id}`}>{module.title}</Link>
            <ChevronRight size={13} />
            <span>{lesson.title}</span>
          </nav>
          <p className={styles.eyebrow}>
            Chapter {String(topic?.globalSequence ?? 1).padStart(2, '0')} · SAT Grammar
          </p>
          <h1>{lesson.title}</h1>
          <h2>{lesson.english}</h2>
          <p>{lesson.overview}</p>
        </div>
        <div className={styles.topicCounter}>
          <span>来源</span>
          <strong>{source?.rangeLabel ?? 'SAT 语法讲义'}</strong>
          <small>3000 词汇量版</small>
        </div>
      </header>

      <section className={styles.chapterGuide} aria-label="本章学习指南">
        <div className={styles.guideBlock}>
          <div className={styles.guideHeading}>
            <Target size={17} />
            <h3>本章学会什么</h3>
          </div>
          <ul>
            {guide.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </div>
        <div className={styles.guideBlock}>
          <div className={styles.guideHeading}>
            <ListChecks size={17} />
            <h3>SAT 判断步骤</h3>
          </div>
          <ol>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>

      <article className={styles.readingChapter}>
        {sections.map((section, sectionIndex) => (
          <section className={styles.readingSection} key={`${section.title}:${sectionIndex}`}>
            <div className={styles.readingSectionHeading}>
              <span>{String(sectionIndex + 1).padStart(2, '0')}</span>
              <h3>{section.title}</h3>
            </div>
            <div className={styles.readingCard}>
              {section.lines.map((line, lineIndex) => {
                const kind = readingLineKind(line);
                return (
                  <p
                    className={`${styles.readingLine} ${styles[`readingLine${kind}`]}`}
                    key={`${line}:${lineIndex}`}
                  >
                    {line}
                  </p>
                );
              })}
              {section.details.length > 0 ? (
                <div className={styles.readingExplanation}>
                  <strong>详细讲解</strong>
                  <ol>
                    {section.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </article>

      <section className={styles.trapGuide} aria-labelledby="trap-guide-title">
        <div className={styles.guideHeading}>
          <TriangleAlert size={17} />
          <h3 id="trap-guide-title">高频陷阱</h3>
        </div>
        <ul>
          {guide.traps.map((trap) => (
            <li key={trap}>{trap}</li>
          ))}
        </ul>
      </section>

      <p className={styles.sourceNote}>
        规则与例句依据：《SAT 语法知识点大全 - 3000 词汇量版》
        {source?.rangeLabel ?? ''}；判断步骤与例句讲解依据原规则补充。
      </p>

      <nav className={styles.topicNavigation} aria-label="知识点翻页">
        {previousTopicId ? (
          <Link className={styles.secondaryLink} href={`${base}/topic/${previousTopicId}`}>
            <ArrowLeft size={15} />
            上一章
          </Link>
        ) : (
          <span />
        )}
        {nextTopicId ? (
          <Link className={styles.primaryLink} href={`${base}/topic/${nextTopicId}`}>
            下一章
            <ArrowRight size={15} />
          </Link>
        ) : (
          <Link className={styles.primaryLink} href={base}>
            返回目录
            <ArrowRight size={15} />
          </Link>
        )}
      </nav>
    </div>
  );
}
