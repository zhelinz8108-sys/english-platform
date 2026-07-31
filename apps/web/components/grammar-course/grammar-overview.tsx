'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import { useState } from 'react';
import type { GrammarCatalog } from '@english/shared';
import { grammarBasePath } from './grammar-api';
import styles from './grammar-course.module.css';

export function GrammarOverview({ catalog }: { catalog: GrammarCatalog }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  const modules = catalog.modules.filter((module) =>
    normalized
      ? [
          module.title,
          module.english,
          module.summary,
          ...module.topics.flatMap((topic) => [topic.title, topic.english]),
        ]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalized)
      : true,
  );
  const firstTopic = catalog.modules.flatMap((module) => module.topics)[0];

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>SAT · Grammar</p>
          <h1>SAT 语法知识点大全</h1>
          <p>基于 3000 词汇量版讲义，按句子结构学习 27 章 SAT 核心语法。</p>
        </div>
        {firstTopic ? (
          <Link className={styles.primaryLink} href={`${base}/topic/${firstTopic.id}`}>
            开始阅读
            <ArrowRight size={16} />
          </Link>
        ) : null}
      </header>

      <section aria-label="语法课程概况" className={styles.summaryStrip}>
        <div>
          <span>学习阶段</span>
          <strong>{catalog.summary.partCount}</strong>
        </div>
        <div>
          <span>课程章节</span>
          <strong>{catalog.summary.topicCount}</strong>
        </div>
        <div>
          <span>内容来源</span>
          <strong>1</strong>
        </div>
      </section>

      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Contents</p>
          <h2>课程目录</h2>
        </div>
        <label className={styles.search}>
          <Search size={16} />
          <span className="sr-only">搜索 SAT 语法章节</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索中文、英文或知识点"
            type="search"
            value={query}
          />
        </label>
      </div>

      {modules.length ? (
        <div className={styles.moduleList}>
          {modules.map((module) => (
            <Link className={styles.moduleRow} href={`${base}/module/${module.id}`} key={module.id}>
              <span className={styles.moduleNumber}>
                {String(module.sequence).padStart(2, '0')}
              </span>
              <span className={styles.moduleCopy}>
                <small>{module.english}</small>
                <strong>{module.title}</strong>
                <p>{module.summary}</p>
              </span>
              <span className={styles.moduleStats}>
                <strong>{module.topics.length} 章</strong>
                <span>按顺序阅读</span>
              </span>
              <ArrowRight aria-hidden size={17} />
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>没有找到匹配的阶段或章节。</div>
      )}
    </div>
  );
}
