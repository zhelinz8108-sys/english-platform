'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GrammarLevelId, GrammarModuleSummary, GrammarProgressStatus } from '@english/shared';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

const levels: Array<{ id: GrammarLevelId; short: string }> = [
  { id: 'beginner', short: '初' },
  { id: 'intermediate', short: '中' },
  { id: 'advanced', short: '高' },
];
type Filter = 'all' | 'not_started' | 'in_progress' | 'mastered';

function topicState(statuses: GrammarProgressStatus[]): Filter {
  if (statuses.length === 3 && statuses.every((status) => status === 'mastered')) return 'mastered';
  if (statuses.some((status) => status !== 'not_started')) return 'in_progress';
  return 'not_started';
}

export function GrammarModule({ module }: { module: GrammarModuleSummary }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const { progress, error } = useGrammarProgress();
  const [filter, setFilter] = useState<Filter>('all');
  const progressMap = useMemo(
    () =>
      new Map((progress?.entries ?? []).map((entry) => [`${entry.topicId}:${entry.level}`, entry])),
    [progress],
  );
  const pilotCount = module.topics.filter((topic) => topic.pilot).length;
  const topics = module.topics.filter((topic) => {
    if (filter === 'all') return true;
    const statuses = levels.map(
      ({ id }) => progressMap.get(`${topic.id}:${id}`)?.status ?? 'not_started',
    );
    return topicState(statuses) === filter;
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
            <strong>{pilotCount}</strong> 个完整试点
          </span>
          <span>
            <strong>{module.topics.length * 3}</strong> 个学习阶段
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
          {topics.map((topic) => (
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
                <span className={styles.levelProgress} aria-label="初中高三级进度">
                  {levels.map(({ id, short }) => {
                    const entry = progressMap.get(`${topic.id}:${id}`);
                    return (
                      <span
                        className={styles.levelBadge}
                        data-state={entry?.status ?? 'not_started'}
                        key={id}
                      >
                        {entry?.bestAccuracy === null || entry?.bestAccuracy === undefined
                          ? short
                          : `${entry.bestAccuracy}%`}
                      </span>
                    );
                  })}
                </span>
              ) : (
                <span className={styles.comingSoon}>课程提纲</span>
              )}
              <ArrowRight aria-hidden size={16} />
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>当前筛选条件下没有知识点。</div>
      )}
    </div>
  );
}
