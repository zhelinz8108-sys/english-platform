'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, BookOpenCheck, Search } from 'lucide-react';
import { useState } from 'react';
import type { GrammarCatalog } from '@english/shared';
import { summarizeGrammarTopicProgress } from '@/lib/grammar-topic-progress';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

export function GrammarOverview({ catalog }: { catalog: GrammarCatalog }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const { progress, loading, error } = useGrammarProgress();
  const [query, setQuery] = useState('');
  const progressEntries = progress?.entries ?? [];
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
  const nextTopic = catalog.modules
    .flatMap((module) => module.topics)
    .filter((topic) => topic.pilot)
    .find((topic) => !summarizeGrammarTopicProgress(progressEntries, topic.id).mastered);
  const firstPilot = catalog.modules
    .flatMap((module) => module.topics)
    .find((topic) => topic.pilot);
  const continueTopic = nextTopic ?? firstPilot;
  const started = progressEntries.some((entry) => entry.status !== 'not_started');
  const masteredTopicCount = catalog.modules
    .flatMap((module) => module.topics)
    .filter(
      (topic) => topic.pilot && summarizeGrammarTopicProgress(progressEntries, topic.id).mastered,
    ).length;

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>English · Grammar</p>
          <h1>语法学习路径</h1>
          <p>
            按知识依赖学习86个去重知识点；每个知识点融合三本教材内容，由核心规则自然过渡到复杂应用。
          </p>
        </div>
        {continueTopic ? (
          <Link className={styles.primaryLink} href={`${base}/topic/${continueTopic.id}`}>
            {started ? '继续学习' : '开始学习'}
            <ArrowRight size={16} />
          </Link>
        ) : null}
      </header>

      <section aria-label="语法课程概况" className={styles.summaryStrip}>
        <div>
          <span>学习模块</span>
          <strong>{catalog.summary.partCount}</strong>
        </div>
        <div>
          <span>知识点</span>
          <strong>{catalog.summary.topicCount}</strong>
        </div>
        <div>
          <span>完整课程</span>
          <strong>{catalog.summary.publishedTopicCount}</strong>
        </div>
        <div>
          <span>已掌握知识点</span>
          <strong>{loading ? '—' : masteredTopicCount}</strong>
        </div>
      </section>

      {error ? (
        <div className={styles.errorNotice}>{error} 课程仍可浏览，成绩暂时无法同步。</div>
      ) : null}
      <div className={styles.notice}>
        <BookOpenCheck size={15} />{' '}
        当前已开放5个完整知识点和150道原创练习；三本教材的内容已按由简到难合并，其余知识点逐步补充练习。
      </div>

      <div className={styles.toolbar}>
        <div>
          <p className={styles.kicker}>Curriculum</p>
          <h2>12个学习模块</h2>
        </div>
        <label className={styles.search}>
          <Search size={16} />
          <span className="sr-only">搜索语法模块或知识点</span>
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
          {modules.map((module) => {
            const pilotTopics = module.topics.filter((topic) => topic.pilot);
            const masteredTopics = pilotTopics.filter(
              (topic) => summarizeGrammarTopicProgress(progressEntries, topic.id).mastered,
            ).length;
            return (
              <Link
                className={styles.moduleRow}
                href={`${base}/module/${module.id}`}
                key={module.id}
              >
                <span className={styles.moduleNumber}>
                  {String(module.sequence).padStart(2, '0')}
                </span>
                <span className={styles.moduleCopy}>
                  <small>{module.english}</small>
                  <strong>{module.title}</strong>
                  <p>{module.summary}</p>
                </span>
                <span className={styles.moduleStats}>
                  <strong>{module.topics.length}个知识点</strong>
                  <span>
                    {pilotTopics.length
                      ? `${masteredTopics}/${pilotTopics.length}个完整知识点已掌握`
                      : '内容提纲已建立'}
                  </span>
                </span>
                <ArrowRight aria-hidden size={17} />
              </Link>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>没有找到匹配的模块或知识点。</div>
      )}
    </div>
  );
}
