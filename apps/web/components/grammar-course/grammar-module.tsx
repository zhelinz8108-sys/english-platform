'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { GrammarModuleSummary } from '@english/shared';
import { summarizeGrammarTopicProgress } from '@/lib/grammar-topic-progress';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

type Filter = 'all' | 'not_started' | 'in_progress' | 'mastered';

export function GrammarModule({ module }: { module: GrammarModuleSummary }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const { progress, error } = useGrammarProgress();
  const [filter, setFilter] = useState<Filter>('all');
  const progressEntries = progress?.entries ?? [];
  const pilotCount = module.topics.filter((topic) => topic.pilot).length;
  const topics = module.topics.filter((topic) => {
    if (filter === 'all') return true;
    return summarizeGrammarTopicProgress(progressEntries, topic.id).status === filter;
  });

  return (
    <div className={styles.page}>
      <header className={styles.moduleHeader}>
        <nav className={styles.breadcrumb} aria-label="面包屑">
          <Link href={base}>语法路径</Link>
          <ChevronRight size={13} />
          <span>模块 {String(module.sequence).padStart(2, '0')}</span>
        </nav>
        <p className={styles.eyebrow}>{module.english}</p>
        <h1>{module.title}</h1>
        <p>{module.summary}</p>
        <div className={styles.moduleStatsBar}>
          <span>
            <strong>{module.topics.length}</strong> 个知识点
          </span>
          <span>
            <strong>{pilotCount}</strong> 个已开放课程
          </span>
          <span>
            <strong>3</strong> 本教材融合
          </span>
        </div>
      </header>

      {error ? <div className={styles.errorNotice}>{error}</div> : null}
      <div className={styles.filterBar} aria-label="筛选知识点">
        {[
          ['all', '全部'],
          ['not_started', '未学习'],
          ['in_progress', '学习中'],
          ['mastered', '已掌握'],
        ].map(([value, label]) => (
          <button
            data-active={filter === value}
            key={value}
            onClick={() => setFilter(value as Filter)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {topics.length ? (
        <div className={styles.topicList}>
          {topics.map((topic) => {
            const topicProgress = summarizeGrammarTopicProgress(progressEntries, topic.id);
            return (
              <Link className={styles.topicRow} href={`${base}/topic/${topic.id}`} key={topic.id}>
                <span className={styles.topicSequence}>
                  {String(topic.globalSequence).padStart(2, '0')}
                </span>
                <span className={styles.topicCopy}>
                  <small>{topic.english}</small>
                  <strong>{topic.title}</strong>
                  <p>{topic.overview}</p>
                </span>
                {topic.pilot ? (
                  <span className={styles.topicStatus} data-state={topicProgress.status}>
                    {topicProgress.mastered
                      ? '已掌握'
                      : topicProgress.started
                        ? topicProgress.bestAccuracy === null
                          ? '学习中'
                          : `学习中 · 最佳 ${topicProgress.bestAccuracy}%`
                        : '开始学习'}
                  </span>
                ) : (
                  <span className={styles.comingSoon}>内容整理中</span>
                )}
                <ArrowRight aria-hidden size={16} />
              </Link>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>当前筛选条件下没有知识点。</div>
      )}
    </div>
  );
}
