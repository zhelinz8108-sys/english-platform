'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SatGrammarCatalog } from '@/lib/sat-grammar';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

export function OtherGrammarOverview({ catalog }: { catalog: SatGrammarCatalog }) {
  const pathname = usePathname();
  const grammarBase = grammarBasePath(pathname);
  const courseBase = `${grammarBase}/other`;
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  const entries = useMemo(
    () =>
      catalog.entries
        .map((entry) => ({
          ...entry,
          knowledgePoints: normalized
            ? entry.knowledgePoints.filter((point) =>
                `${point.title} ${point.sectionTitle}`
                  .toLocaleLowerCase('zh-CN')
                  .includes(normalized),
              )
            : entry.knowledgePoints,
        }))
        .filter(
          (entry) =>
            !normalized ||
            `${entry.label} ${entry.title} ${entry.summary}`
              .toLocaleLowerCase('zh-CN')
              .includes(normalized) ||
            entry.knowledgePoints.length > 0,
        ),
    [catalog.entries, normalized],
  );
  const firstChapter = catalog.entries[0];

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href={grammarBase}>
        <ArrowLeft size={15} />
        返回语法课程
      </Link>

      <header className={styles.courseHeader}>
        <div>
          <p className={styles.eyebrow}>{catalog.english}</p>
          <h1>{catalog.title}</h1>
          <p>{catalog.description}</p>
          <small>{catalog.source.scope}</small>
        </div>
        {firstChapter ? (
          <div className={styles.courseActions}>
            <Link className={styles.primaryLink} href={`${courseBase}/${firstChapter.id}`}>
              从第一章开始
              <ArrowRight size={16} />
            </Link>
          </div>
        ) : null}
      </header>

      <section aria-label="其他语法课程概况" className={styles.summaryList}>
        <div>
          <span>系统章节</span>
          <strong>{catalog.summary.chapterCount}</strong>
        </div>
        <div>
          <span>非重复知识点</span>
          <strong>{catalog.summary.ruleCount}</strong>
        </div>
        <div>
          <span>正误例句组</span>
          <strong>{catalog.summary.examplePairCount}</strong>
        </div>
        <div>
          <span>对照来源</span>
          <strong>3 本</strong>
        </div>
      </section>

      <div className={styles.catalogToolbar}>
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Contents</p>
          <h2>知识点目录</h2>
        </div>
        <label className={styles.searchBox}>
          <Search aria-hidden size={16} />
          <span className="sr-only">搜索其他语法知识点</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索章节或知识点"
            type="search"
            value={query}
          />
        </label>
      </div>

      {entries.length ? (
        <div className={styles.entryList}>
          {entries.map((entry) => (
            <details
              className={styles.entryCard}
              key={entry.id}
              open={normalized ? true : undefined}
            >
              <summary>
                <span className={styles.entryNumber}>
                  {String(entry.sequence).padStart(2, '0')}
                </span>
                <span className={styles.entryCopy}>
                  <small>{entry.label}</small>
                  <strong>{entry.title}</strong>
                  <p>{entry.summary}</p>
                </span>
                <span className={styles.entryCount}>{entry.ruleCount} 个知识点</span>
                <ChevronDown aria-hidden className={styles.entryChevron} size={18} />
              </summary>
              <div className={styles.entryBody}>
                <ol className={styles.knowledgeList}>
                  {entry.knowledgePoints.map((point) => (
                    <li key={point.id}>
                      <Link href={`${courseBase}/${entry.id}#${point.id}`}>
                        <span>{point.title}</span>
                        <ArrowRight aria-hidden size={14} />
                      </Link>
                    </li>
                  ))}
                </ol>
                <Link className={styles.entryLink} href={`${courseBase}/${entry.id}`}>
                  阅读本章
                  <ArrowRight aria-hidden size={15} />
                </Link>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p className={styles.emptyState}>没有找到匹配的章节或知识点。</p>
      )}
    </div>
  );
}
