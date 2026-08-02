'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, BookCopy, BookOpenText } from 'lucide-react';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

export function GrammarShelf({
  satSummary,
  otherSummary,
}: {
  satSummary: {
    chapterCount: number;
    appendixCount: number;
    ruleCount: number;
    examplePairCount: number;
  };
  otherSummary: {
    chapterCount: number;
    appendixCount: number;
    ruleCount: number;
    examplePairCount: number;
  };
}) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);

  return (
    <div className={styles.page}>
      <header className={styles.shelfHeader}>
        <p className={styles.eyebrow}>English · Grammar</p>
        <h1>语法</h1>
        <p>选择一本语法课程，按章节从上往下学习。</p>
      </header>

      <section aria-labelledby="grammar-courses-title" className={styles.shelfSection}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Courses</p>
          <h2 id="grammar-courses-title">语法课程</h2>
        </div>
        <Link className={styles.courseCard} href={`${base}/sat`}>
          <span className={styles.courseIcon}>
            <BookOpenText aria-hidden size={22} />
          </span>
          <span className={styles.courseCopy}>
            <small>Standard English Conventions</small>
            <strong>SAT语法</strong>
            <p>从句子边界与标点开始，系统学习动词、代词、修饰语、平行结构、所有格与比较。</p>
            <span className={styles.courseMeta}>
              {satSummary.chapterCount} 章 · {satSummary.appendixCount} 个附录 ·{' '}
              {satSummary.ruleCount} 个规则 · {satSummary.examplePairCount} 组正误例句
            </span>
          </span>
          <span className={styles.courseAction}>
            进入课程
            <ArrowRight aria-hidden size={16} />
          </span>
        </Link>

        <Link className={styles.courseCard} href={`${base}/other`}>
          <span className={styles.courseIcon}>
            <BookCopy aria-hidden size={22} />
          </span>
          <span className={styles.courseCopy}>
            <small>Grammar Beyond SAT</small>
            <strong>其他语法</strong>
            <p>
              汇总剑桥初级、中级与高级英语语法中，SAT
              课程尚未覆盖的时态语义、情态、冠词、数量词、介词和高级句式。
            </p>
            <span className={styles.courseMeta}>
              {otherSummary.chapterCount} 章 · {otherSummary.ruleCount} 个非重复知识点 ·{' '}
              {otherSummary.examplePairCount} 组正误例句
            </span>
          </span>
          <span className={styles.courseAction}>
            进入课程
            <ArrowRight aria-hidden size={16} />
          </span>
        </Link>
      </section>
    </div>
  );
}
