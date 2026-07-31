'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ChevronRight } from 'lucide-react';
import type { GrammarModuleSummary } from '@english/shared';
import { grammarBasePath } from './grammar-api';
import styles from './grammar-course.module.css';

export function GrammarModule({ module }: { module: GrammarModuleSummary }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);

  return (
    <div className={styles.page}>
      <header className={styles.moduleHeader}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          <Link href={base}>SAT 语法</Link>
          <ChevronRight size={13} />
          <span>阶段 {String(module.sequence).padStart(2, '0')}</span>
        </nav>
        <p className={styles.eyebrow}>{module.english}</p>
        <h1>{module.title}</h1>
        <p>{module.summary}</p>
        <div className={styles.moduleStatsBar}>
          <span>
            <strong>{module.topics.length}</strong> 章
          </span>
        </div>
      </header>

      <div className={styles.topicList}>
        {module.topics.map((topic) => (
          <Link className={styles.topicRow} href={`${base}/topic/${topic.id}`} key={topic.id}>
            <span className={styles.topicSequence}>
              {String(topic.globalSequence).padStart(2, '0')}
            </span>
            <span className={styles.topicCopy}>
              <small>{topic.english}</small>
              <strong>{topic.title}</strong>
            </span>
            <span className={styles.topicStatus} data-state="not_started">
              阅读
            </span>
            <ArrowRight aria-hidden size={16} />
          </Link>
        ))}
      </div>
    </div>
  );
}
