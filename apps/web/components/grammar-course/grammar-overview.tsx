'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, BookOpenCheck, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GrammarCatalog, GrammarLevelId } from '@english/shared';
import { grammarBasePath, useGrammarProgress } from './grammar-api';
import styles from './grammar-course.module.css';

const levels: GrammarLevelId[] = ['beginner', 'intermediate', 'advanced'];

export function GrammarOverview({ catalog }: { catalog: GrammarCatalog }) {
  const pathname = usePathname();
  const base = grammarBasePath(pathname);
  const { progress, loading, error } = useGrammarProgress();
  const [query, setQuery] = useState('');
  const progressMap = useMemo(
    () =>
      new Map((progress?.entries ?? []).map((entry) => [`${entry.topicId}:${entry.level}`, entry])),
    [progress],
  );
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
  const nextStage = catalog.modules
    .flatMap((module) => module.topics)
    .filter((topic) => topic.pilot)
    .flatMap((topic) => levels.map((level) => ({ topic, level })))
    .find(({ topic, level }) => progressMap.get(`${topic.id}:${level}`)?.status !== 'mastered');
  const firstPilot = catalog.modules
    .flatMap((module) => module.topics)
    .find((topic) => topic.pilot);
  const continueTopic = nextStage?.topic ?? firstPilot;

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>English · Grammar</p>
          <h1>语法学习路径</h1>
          <p>按知识依赖学习86个去重知识点；初级、中级、高级内容在每个知识点内纵向衔接。</p>
        </div>
        {continueTopic ? (
          <Link className={styles.primaryLink} href={`${base}/topic/${continueTopic.id}`}>
            {progress?.summary.startedStageCount ? '继续学习' : '开始试点课程'}
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
          <span>试点已上线</span>
          <strong>{catalog.summary.publishedTopicCount}</strong>
        </div>
        <div>
          <span>已掌握阶段</span>
          <strong>{loading ? '—' : (progress?.summary.masteredStageCount ?? 0)}</strong>
        </div>
      </section>

      {error ? (
        <div className={styles.errorNotice}>{error} 课程仍可浏览，成绩暂时无法同步。</div>
      ) : null}
      <div className={styles.notice}>
        <BookOpenCheck size={15} />{' '}
        当前已开放5个完整试点知识点、15个学习阶段和150道原创练习；其余知识点保留提纲并逐步上线。
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
            const masteredStages = pilotTopics.reduce(
              (total, topic) =>
                total +
                levels.filter(
                  (level) => progressMap.get(`${topic.id}:${level}`)?.status === 'mastered',
                ).length,
              0,
            );
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
                      ? `${masteredStages}/${pilotTopics.length * 3}个试点阶段已掌握`
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
