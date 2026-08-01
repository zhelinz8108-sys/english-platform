'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, BookOpenText } from 'lucide-react';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

export function GrammarShelf({
  summary,
}: {
  summary: {
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
              {summary.chapterCount} 章 · {summary.appendixCount} 个附录 · {summary.ruleCount}{' '}
              个规则 · {summary.examplePairCount} 组正误例句
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
