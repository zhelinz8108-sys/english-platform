'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Layers3,
  LibraryBig,
  Search,
  Sparkles,
  Target,
} from 'lucide-react';
import { ButtonLink, PageHeader } from '@/components/ui';
import styles from './grammar-learning-path.module.css';

export interface GrammarSource {
  level: string;
  units: number[];
  rangeLabel: string;
}

export interface GrammarLevel {
  id: 'beginner' | 'intermediate' | 'advanced';
  label: string;
  focus: string;
  sequence: number;
  content: string[];
  source: GrammarSource | null;
}

export interface GrammarTopic {
  id: string;
  sequence: number;
  globalSequence: number;
  title: string;
  english: string;
  overview: string;
  patterns: string[];
  levels: GrammarLevel[];
  examples: Array<{ english: string; chinese: string }>;
  mistakes: Array<{ wrong: string; right: string; explanation: string }>;
  related: string[];
  sources: GrammarSource[];
}

export interface GrammarPart {
  id: string;
  sequence: number;
  title: string;
  english: string;
  summary: string;
  topics: GrammarTopic[];
}

export interface GrammarLibrary {
  title: string;
  description: string;
  summary: {
    partCount: number;
    topicCount: number;
    levelLessonCount: number;
    sourceUnitCount: number;
  };
  sources: Array<{ id: string; level: string; title: string; unitCount: number }>;
  parts: GrammarPart[];
}

const STORAGE_KEY = 'aurelis:grammar-path:completed:v1';

function lessonKey(topicId: string, levelId: string) {
  return `${topicId}:${levelId}`;
}

function readCompleted() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export function GrammarLearningPath({ library }: { library: GrammarLibrary }) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState('');
  const [openPartId, setOpenPartId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedLevelId, setSelectedLevelId] = useState<GrammarLevel['id']>('beginner');
  const detailTopRef = useRef<HTMLDivElement>(null);

  const flatTopics = useMemo(
    () =>
      library.parts.flatMap((part) =>
        part.topics.map((topic) => ({ topic, part })),
      ),
    [library.parts],
  );

  const selected = selectedTopicId
    ? flatTopics.find(({ topic }) => topic.id === selectedTopicId) ?? null
    : null;

  const filteredParts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    if (!normalized) return library.parts;
    return library.parts
      .map((part) => ({
        ...part,
        topics: part.topics.filter((topic) =>
          [topic.title, topic.english, topic.overview, ...topic.patterns]
            .join(' ')
            .toLocaleLowerCase('zh-CN')
            .includes(normalized),
        ),
      }))
      .filter((part) => part.topics.length > 0);
  }, [library.parts, query]);

  const completedCount = completed.size;
  const progress = hydrated
    ? Math.round((completedCount / library.summary.levelLessonCount) * 100)
    : 0;

  useEffect(() => {
    setCompleted(readCompleted());
    setHydrated(true);
  }, []);

  function saveCompleted(next: Set<string>) {
    setCompleted(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  }

  function openTopic(topic: GrammarTopic, levelId: GrammarLevel['id'] = 'beginner') {
    setSelectedTopicId(topic.id);
    setSelectedLevelId(levelId);
    window.setTimeout(() => detailTopRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  function continueLearning() {
    const next = flatTopics
      .flatMap(({ topic }) => topic.levels.map((level) => ({ topic, level })))
      .find(({ topic, level }) => !completed.has(lessonKey(topic.id, level.id)));
    if (next) openTopic(next.topic, next.level.id);
  }

  function toggleCurrentLesson() {
    if (!selected) return;
    const key = lessonKey(selected.topic.id, selectedLevelId);
    const next = new Set(completed);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    saveCompleted(next);
  }

  function finishAndContinue() {
    if (!selected) return;
    const key = lessonKey(selected.topic.id, selectedLevelId);
    const nextCompleted = new Set(completed);
    nextCompleted.add(key);
    saveCompleted(nextCompleted);

    const levelIndex = selected.topic.levels.findIndex((level) => level.id === selectedLevelId);
    const nextLevel = selected.topic.levels[levelIndex + 1];
    if (nextLevel) {
      setSelectedLevelId(nextLevel.id);
      detailTopRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const topicIndex = flatTopics.findIndex(({ topic }) => topic.id === selected.topic.id);
    const nextTopic = flatTopics[topicIndex + 1]?.topic;
    if (nextTopic) openTopic(nextTopic);
  }

  const activeLevel = selected?.topic.levels.find((level) => level.id === selectedLevelId) ?? null;
  const selectedTopicPosition = selected
    ? flatTopics.findIndex(({ topic }) => topic.id === selected.topic.id)
    : -1;

  return (
    <div className={styles.page}>
      <PageHeader
        actions={
          <ButtonLink href="/student/learning/english/vocabulary/assessment" variant="secondary">
            词汇量检测
          </ButtonLink>
        }
        description="把三本剑桥语法书的 360 个原书单元合并去重，按学习依赖串成初级、中级、高级连续路径。"
        eyebrow="英语 · 语法"
        title="语法学习路径"
      />

      {!selected ? (
        <>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <span className={styles.heroIcon}><BookOpenCheck size={25} /></span>
              <div>
                <p className={styles.kicker}>Three-level mastery path</p>
                <h2>不是三套重复目录，而是一条完整进阶路线</h2>
                <p>每个知识点从核心形式出发，进入用法对比，最后处理复杂结构、语体与信息组织。</p>
              </div>
            </div>
            <button className={styles.primaryButton} onClick={continueLearning} type="button">
              {completedCount > 0 ? '继续学习' : '从第一课开始'}
              <ArrowRight size={17} />
            </button>
          </section>

          <section aria-label="语法资料库统计" className={styles.stats}>
            <div><Layers3 size={20} /><span>学习模块</span><strong>{library.summary.partCount}</strong></div>
            <div><LibraryBig size={20} /><span>去重知识点</span><strong>{library.summary.topicCount}</strong></div>
            <div><Target size={20} /><span>三级课程</span><strong>{library.summary.levelLessonCount}</strong></div>
            <div><BookOpenCheck size={20} /><span>原书单元</span><strong>{library.summary.sourceUnitCount}</strong></div>
          </section>

          <section className={styles.progressCard}>
            <div className={styles.progressHeading}>
              <div>
                <p className={styles.kicker}>Your progress</p>
                <h2>学习进度</h2>
              </div>
              <strong>{completedCount} / {library.summary.levelLessonCount} 课</strong>
            </div>
            <div aria-label="语法学习进度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className={styles.progressTrack} role="progressbar">
              <span style={{ width: `${progress}%` }} />
            </div>
            <p>{progress === 100 ? '完整路径已学完，可以按模块复习。' : `已完成 ${progress}%，进度会自动保存在本机。`}</p>
          </section>

          <section className={styles.levelPath} aria-labelledby="grammar-level-path-title">
            <div className={styles.sectionHeading}>
              <div><p className={styles.kicker}>Learning stages</p><h2 id="grammar-level-path-title">每个知识点都走完三个阶段</h2></div>
            </div>
            <div className={styles.levelCards}>
              {[
                ['01', '初级', '看懂形式', '建立核心概念、基本结构与最常用意义。'],
                ['02', '中级', '分清用法', '比较相近结构，掌握搭配、限制与语境差异。'],
                ['03', '高级', '灵活表达', '处理复杂句、语体、语用范围和信息焦点。'],
              ].map(([number, label, title, description], index) => (
                <div className={styles.levelCard} key={label}>
                  <span>{number}</span>
                  <div><small>{label}</small><h3>{title}</h3><p>{description}</p></div>
                  {index < 2 ? <ArrowRight className={styles.levelArrow} size={18} /> : null}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.catalog} aria-labelledby="grammar-catalog-title">
            <div className={styles.catalogHeader}>
              <div><p className={styles.kicker}>Complete curriculum</p><h2 id="grammar-catalog-title">完整知识路径</h2></div>
              <label className={styles.searchBox}>
                <Search size={17} />
                <span className="sr-only">搜索语法知识点</span>
                <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索中文、英文或结构" type="search" value={query} />
              </label>
            </div>

            {filteredParts.length ? (
              <div className={styles.parts}>
                {filteredParts.map((part) => {
                  const expanded = query.trim().length > 0 || openPartId === part.id;
                  const partCompleted = part.topics.reduce(
                    (sum, topic) => sum + topic.levels.filter((level) => completed.has(lessonKey(topic.id, level.id))).length,
                    0,
                  );
                  return (
                    <article className={expanded ? `${styles.part} ${styles.partOpen}` : styles.part} key={part.id}>
                      <button
                        aria-expanded={expanded}
                        className={styles.partButton}
                        onClick={() => setOpenPartId(expanded ? null : part.id)}
                        type="button"
                      >
                        <span className={styles.partNumber}>{String(part.sequence).padStart(2, '0')}</span>
                        <span className={styles.partCopy}>
                          <small>{part.english}</small>
                          <strong>{part.title}</strong>
                          <span>{part.summary}</span>
                        </span>
                        <span className={styles.partMeta}>{partCompleted}/{part.topics.length * 3} 课</span>
                        <ChevronDown className={styles.chevron} size={20} />
                      </button>
                      {expanded ? (
                        <div className={styles.topicList}>
                          {part.topics.map((topic) => {
                            const done = topic.levels.filter((level) => completed.has(lessonKey(topic.id, level.id))).length;
                            return (
                              <button className={styles.topicButton} key={topic.id} onClick={() => openTopic(topic)} type="button">
                                <span className={styles.topicSequence}>{String(topic.globalSequence).padStart(2, '0')}</span>
                                <span className={styles.topicCopy}><strong>{topic.title}</strong><small>{topic.english}</small></span>
                                <span aria-label={`已完成 ${done} 个阶段`} className={styles.stageDots}>
                                  {topic.levels.map((level) => completed.has(lessonKey(topic.id, level.id)) ? <CheckCircle2 key={level.id} size={17} /> : <Circle key={level.id} size={17} />)}
                                </span>
                                <ArrowRight size={17} />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.empty}>没有找到匹配的知识点，请换一个关键词。</div>
            )}
          </section>
        </>
      ) : (
        <div className={styles.detail} ref={detailTopRef}>
          <button className={styles.backButton} onClick={() => setSelectedTopicId(null)} type="button"><ArrowLeft size={17} />返回完整路径</button>

          <section className={styles.topicHero}>
            <div>
              <p className={styles.kicker}>模块 {selected.part.sequence} · 知识点 {selected.topic.globalSequence} / {library.summary.topicCount}</p>
              <h1>{selected.topic.title}</h1>
              <h2>{selected.topic.english}</h2>
              <p>{selected.topic.overview}</p>
            </div>
            <div className={styles.topicProgress}><strong>{selected.topic.levels.filter((level) => completed.has(lessonKey(selected.topic.id, level.id))).length}/3</strong><span>阶段完成</span></div>
          </section>

          <section className={styles.patternCard}>
            <div><Sparkles size={19} /><strong>核心结构</strong></div>
            <div className={styles.patterns}>{selected.topic.patterns.map((pattern) => <code key={pattern}>{pattern}</code>)}</div>
          </section>

          <section className={styles.lessonCard}>
            <div className={styles.levelTabs} role="tablist" aria-label="选择学习阶段">
              {selected.topic.levels.map((level) => {
                const done = completed.has(lessonKey(selected.topic.id, level.id));
                return (
                  <button aria-selected={selectedLevelId === level.id} className={selectedLevelId === level.id ? styles.activeLevel : ''} key={level.id} onClick={() => setSelectedLevelId(level.id)} role="tab" type="button">
                    <span>{done ? <Check size={16} /> : String(level.sequence).padStart(2, '0')}</span>
                    <div><strong>{level.label}</strong><small>{level.focus}</small></div>
                  </button>
                );
              })}
            </div>

            {activeLevel ? (
              <div className={styles.lessonBody} role="tabpanel">
                <div className={styles.lessonHeading}>
                  <div><p className={styles.kicker}>Stage {activeLevel.sequence}</p><h2>{activeLevel.label} · {activeLevel.focus}</h2></div>
                  {activeLevel.source ? <span className={styles.sourceBadge}>{activeLevel.source.level}原书 · {activeLevel.source.rangeLabel}</span> : <span className={styles.sourceBadge}>三书衔接知识</span>}
                </div>
                <ol className={styles.conceptList}>
                  {activeLevel.content.map((content, index) => <li key={content}><span>{index + 1}</span><p>{content}</p></li>)}
                </ol>
                <div className={styles.lessonActions}>
                  <button className={styles.secondaryButton} onClick={toggleCurrentLesson} type="button">
                    {completed.has(lessonKey(selected.topic.id, activeLevel.id)) ? '取消完成标记' : '标记为已完成'}
                  </button>
                  <button className={styles.primaryButton} onClick={finishAndContinue} type="button">
                    {activeLevel.sequence < 3 ? '完成并进入下一阶段' : selectedTopicPosition < flatTopics.length - 1 ? '完成并进入下一知识点' : '完成整条路径'}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.studyGrid}>
            <div className={styles.examplesCard}>
              <div className={styles.sectionHeading}><div><p className={styles.kicker}>Examples</p><h2>双语例句</h2></div><span>{selected.topic.examples.length} 组</span></div>
              <div className={styles.examples}>
                {selected.topic.examples.map((example, index) => <div key={example.english}><span>{String(index + 1).padStart(2, '0')}</span><div><p>{example.english}</p><small>{example.chinese}</small></div></div>)}
              </div>
            </div>
            <div className={styles.mistakesCard}>
              <div className={styles.sectionHeading}><div><p className={styles.kicker}>Common mistakes</p><h2>常见错误</h2></div></div>
              <div className={styles.mistakes}>
                {selected.topic.mistakes.map((mistake) => <div key={mistake.wrong}><p className={styles.wrong}><span>×</span>{mistake.wrong}</p><p className={styles.right}><span>✓</span>{mistake.right}</p><small>{mistake.explanation}</small></div>)}
              </div>
            </div>
          </section>

          <section className={styles.sourceCard}>
            <div><LibraryBig size={20} /><div><p className={styles.kicker}>Source map</p><h2>原书来源映射</h2></div></div>
            <div className={styles.sourceList}>
              {selected.topic.sources.length ? selected.topic.sources.map((source) => <span key={source.level}><strong>{source.level}</strong>{source.rangeLabel}</span>) : <span><strong>衔接</strong>三本书并集补充知识点</span>}
            </div>
            {selected.topic.related.length ? <p className={styles.related}><strong>关联知识：</strong>{selected.topic.related.join(' · ')}</p> : null}
          </section>

          <nav className={styles.topicNav} aria-label="知识点翻页">
            <button disabled={selectedTopicPosition <= 0} onClick={() => { const previous = flatTopics[selectedTopicPosition - 1]; if (previous) openTopic(previous.topic); }} type="button"><ArrowLeft size={17} />上一知识点</button>
            <button disabled={selectedTopicPosition >= flatTopics.length - 1} onClick={() => { const next = flatTopics[selectedTopicPosition + 1]; if (next) openTopic(next.topic); }} type="button">下一知识点<ArrowRight size={17} /></button>
          </nav>
        </div>
      )}
    </div>
  );
}
