'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ButtonLink,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import {
  VocabularyCards,
  type VocabularyCardEntry,
} from '@/components/vocabulary-cards';
import { ApiProblemError, apiRequest } from '@/lib/api';

interface GradeSummary {
  grade: number;
  label: string;
  count: number;
  pageCount: number;
  questionCount: number;
}

interface LibrarySummary {
  generatedAt: string;
  totalCount: number;
  totalPages: number;
  totalQuestions: number;
  totalDiscussionQuestions: number;
  totalVocabulary: number;
  grades: GradeSummary[];
}

interface ReadingIndexItem {
  id: string;
  grade: number;
  sequence: number;
  title: string;
  author: string;
  publicationYear: string;
  description: string;
  lexile: number | null;
  category: string;
  wordCount: number;
  pageCount: number;
  questionCount: number;
  discussionQuestionCount: number;
  vocabularyCount: number;
}

interface ReadingOption {
  id: string;
  label: string;
}

interface ReadingQuestion {
  id: string;
  number: number;
  prompt: string;
  options: ReadingOption[];
  kind: 'multiple-choice' | 'short-answer';
  sourceKind?: 'multiple-choice' | 'short-answer' | 'discussion';
  rewritten?: boolean;
}

interface ReadingBlock {
  number: number;
  tag: 'p' | 'blockquote' | 'h2' | 'h3' | 'li';
  text: string;
}

interface ReadingArticle extends ReadingIndexItem {
  subtitle: string;
  slug: string;
  intro: string;
  annotationTask: string;
  permissions: string;
  isPoem: boolean;
  blocks: ReadingBlock[];
  questions: ReadingQuestion[];
  discussionQuestions: ReadingQuestion[];
  pdfUrl: string | null;
  sourceUrl: string;
  answerBankStatus?: 'ready' | 'missing';
  answerBankReviewed?: boolean;
  vocabulary: VocabularyCardEntry[];
}

interface ReadingAnswerResult {
  questionId: string;
  selectedOptionId: string | null;
  correctOptionId: string;
  correct: boolean;
  evidence: number[];
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  rewritten: boolean;
  sourceKind: 'multiple-choice' | 'short-answer' | 'discussion';
}

interface ReadingCheckResult {
  articleId: string;
  answeredCount: number;
  correctCount: number;
  totalCount: number;
  percentage: number;
  reviewed: boolean;
  results: ReadingAnswerResult[];
}

interface ReadingResponse {
  data: ReadingIndexItem[];
  summary: LibrarySummary;
  page: { nextCursor: null; hasMore: boolean; limit: number };
}

interface SavedDraft {
  answers: Record<string, string>;
  completed: boolean;
  savedAt: string;
}

type ReadingCollectionId = 'commonlit';

const fallbackGrades: GradeSummary[] = (
  [
    [3, 198],
    [4, 262],
    [5, 344],
    [6, 196],
    [7, 217],
    [8, 307],
    [9, 320],
    [10, 323],
    [11, 199],
    [12, 82],
    // Preserve the numeric pair shape under noUncheckedIndexedAccess.
    // The map below produces the local placeholder before the API summary arrives.
  ] satisfies [number, number][]
).map(([grade, count]) => ({
  grade,
  label: `Grade ${grade}`,
  count,
  pageCount: 0,
  questionCount: 0,
}));

const fallbackSummary: LibrarySummary = {
  generatedAt: '',
  totalCount: 2448,
  totalPages: 17152,
  totalQuestions: 13125,
  totalDiscussionQuestions: 7566,
  totalVocabulary: 21579,
  grades: fallbackGrades,
};

function draftKey(articleId: string): string {
  return `aurelis:commonlit-reading:${articleId}`;
}

function completedKey(): string {
  return 'aurelis:commonlit-reading:completed';
}

function articleMeta(item: ReadingIndexItem): string[] {
  return [
    item.author,
    item.publicationYear,
    item.lexile ? `Lexile ${item.lexile}L` : '',
    `${item.wordCount.toLocaleString('en-US')} 词`,
    `${item.vocabularyCount} 个重点词`,
    `${item.questionCount} 道理解题`,
  ].filter(Boolean);
}

export function ToeflReadingPage({ initialGrade = null }: { initialGrade?: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const toeflHome = pathname.startsWith('/student/')
    ? '/student/learning/toefl'
    : '/learning/toefl';
  const readingHome = pathname.startsWith('/student/')
    ? '/student/learning/toefl/reading'
    : '/learning/toefl/reading';
  const [summary, setSummary] = useState<LibrarySummary>(fallbackSummary);
  const [selectedCollection, setSelectedCollection] = useState<ReadingCollectionId | null>(
    initialGrade === null ? null : 'commonlit',
  );
  const [selectedGrade, setSelectedGrade] = useState<number | null>(initialGrade);
  const [items, setItems] = useState<ReadingIndexItem[]>([]);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);
  const [loadingGrade, setLoadingGrade] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [error, setError] = useState<ApiProblemError | null>(null);
  const [article, setArticle] = useState<ReadingArticle | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftReady, setDraftReady] = useState(false);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [checkResult, setCheckResult] = useState<ReadingCheckResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const readerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(completedKey()) ?? '[]') as unknown;
      if (Array.isArray(stored)) {
        setCompletedIds(
          new Set(stored.filter((value): value is string => typeof value === 'string')),
        );
      }
    } catch {
      setCompletedIds(new Set());
    }
  }, []);

  useEffect(() => {
    const updateVisibility = () => setShowBackToTop(window.scrollY > 700);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  useEffect(() => {
    if (selectedCollection !== 'commonlit' || selectedGrade === null) return;
    let cancelled = false;
    async function loadGrade() {
      setLoadingGrade(true);
      setError(null);
      try {
        const response = await apiRequest<ReadingResponse>(
          `/api/local-reading?grade=${selectedGrade}&pageSize=500`,
        );
        if (!cancelled) {
          setItems(response.data);
          setSummary(response.summary);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof ApiProblemError
              ? caught
              : new ApiProblemError({
                  type: 'about:blank',
                  title: '阅读资料加载失败',
                  status: 500,
                  detail: '请确认本地 CommonLit 资料库已生成。',
                }),
          );
        }
      } finally {
        if (!cancelled) setLoadingGrade(false);
      }
    }
    void loadGrade();
    return () => {
      cancelled = true;
    };
  }, [selectedCollection, selectedGrade]);

  useEffect(() => {
    if (!article || !draftReady) return;
    const completed = completedIds.has(article.id);
    const payload: SavedDraft = {
      answers,
      completed,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(draftKey(article.id), JSON.stringify(payload));
  }, [answers, article, completedIds, draftReady]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en');
    if (!normalized) return items;
    return items.filter(
      (item) =>
        item.title.toLocaleLowerCase('en').includes(normalized) ||
        item.author.toLocaleLowerCase('en').includes(normalized) ||
        item.category.toLocaleLowerCase('en').includes(normalized) ||
        String(item.sequence).includes(normalized) ||
        String(item.lexile ?? '').includes(normalized),
    );
  }, [items, query]);

  const resultByQuestion = useMemo(
    () => new Map(checkResult?.results.map((result) => [result.questionId, result]) ?? []),
    [checkResult],
  );

  const answeredCount = article
    ? article.questions.filter((question) => answers[question.id]?.trim()).length
    : 0;

  async function openArticle(item: ReadingIndexItem) {
    setLoadingArticle(true);
    setError(null);
    setSubmissionMessage('');
    setCheckResult(null);
    setDraftReady(false);
    try {
      const detail = await apiRequest<ReadingArticle>(
        `/api/local-reading/${encodeURIComponent(item.id)}`,
      );
      let saved: SavedDraft | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(draftKey(item.id)) ?? 'null') as SavedDraft | null;
      } catch {
        saved = null;
      }
      setArticle(detail);
      setAnswers(saved?.answers ?? {});
      setDraftReady(true);
      window.setTimeout(() => readerRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    } catch (caught) {
      setError(
        caught instanceof ApiProblemError
          ? caught
          : new ApiProblemError({
              type: 'about:blank',
              title: '文章加载失败',
              status: 500,
              detail: '请稍后重试。',
            }),
      );
    } finally {
      setLoadingArticle(false);
    }
  }

  function closeArticle() {
    setArticle(null);
    setAnswers({});
    setDraftReady(false);
    setSubmissionMessage('');
    setCheckResult(null);
    window.scrollTo({ behavior: 'smooth', top: 0 });
  }

  async function completeExercise() {
    if (!article) return;
    const unanswered = article.questions.length - answeredCount;
    if (unanswered > 0) {
      setSubmissionMessage(`还有 ${unanswered} 道原文理解题未作答。`);
      const firstUnanswered = article.questions.find((question) => !answers[question.id]?.trim());
      if (firstUnanswered) {
        document
          .getElementById(`reading-question-${firstUnanswered.id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    if (article.answerBankStatus === 'ready') {
      setGrading(true);
      try {
        const response = await fetch(
          `/api/local-reading/${encodeURIComponent(article.id)}/check`,
          {
            body: JSON.stringify({ answers }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          },
        );
        if (!response.ok) throw new Error('答案暂时无法核对');
        const checked = (await response.json()) as ReadingCheckResult;
        setCheckResult(checked);
        const next = new Set(completedIds);
        next.add(article.id);
        setCompletedIds(next);
        localStorage.setItem(completedKey(), JSON.stringify([...next]));
        setSubmissionMessage(
          `本次答对 ${checked.correctCount}/${checked.totalCount} 题，得分 ${checked.percentage}%。`,
        );
      } catch {
        setSubmissionMessage('答案核对暂时失败，请稍后重试。你的作答已经保存在本机。');
      } finally {
        setGrading(false);
      }
      return;
    }
    const next = new Set(completedIds);
    next.add(article.id);
    setCompletedIds(next);
    localStorage.setItem(completedKey(), JSON.stringify([...next]));
    setSubmissionMessage('已保存本篇作答；这篇文章的自编答案仍在生成中。');
  }

  function renderGradeArticles(grade: number) {
    return (
      <Card padding={false} className="reading-article-library reading-grade-page">
        <div className="list-toolbar">
          <div>
            <strong>Grade {grade}</strong>
            <small className="reading-list-count">{filteredItems.length} 篇文章</small>
            <p>点击文章后进入文字阅读与作答页。</p>
          </div>
          <label className="search-box">
            <span className="sr-only">搜索文章</span>
            <Icon name="search" size={17} />
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(40);
              }}
              placeholder="标题、作者、编号或 Lexile"
              type="search"
              value={query}
            />
          </label>
        </div>

        {loadingGrade ? (
          <LoadingState label={`正在加载 Grade ${grade}`} />
        ) : filteredItems.length === 0 ? (
          <EmptyState description="换一个关键词再试试。" icon="book" title="没有匹配的文章" />
        ) : (
          <div className="reading-article-list">
            {filteredItems.slice(0, visibleCount).map((item) => (
              <button
                className="reading-article-row"
                disabled={loadingArticle}
                key={item.id}
                onClick={() => void openArticle(item)}
                type="button"
              >
                <span className="reading-article-sequence">
                  {String(item.sequence).padStart(3, '0')}
                </span>
                <span className="reading-article-summary">
                  <strong>{item.title}</strong>
                  <small>{articleMeta(item).join(' · ')}</small>
                  {item.description ? <p>{item.description}</p> : null}
                </span>
                <span className="reading-article-status">
                  {completedIds.has(item.id) ? (
                    <StatusBadge tone="success">已完成</StatusBadge>
                  ) : item.questionCount === 0 ? (
                    <StatusBadge tone="warning">原资料未附题</StatusBadge>
                  ) : (
                    <StatusBadge tone="brand">可作答</StatusBadge>
                  )}
                  <span>
                    开始阅读 <Icon name="arrow" size={15} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {visibleCount < filteredItems.length ? (
          <div className="reading-load-more">
            <button
              className="button button-secondary"
              onClick={() => setVisibleCount((count) => count + 40)}
              type="button"
            >
              加载更多
            </button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        actions={
          <ButtonLink href={initialGrade === null ? toeflHome : readingHome} variant="secondary">
            {initialGrade === null ? '返回托福' : '返回年级选择'}
          </ButtonLink>
        }
        description={
          initialGrade === null
            ? '先选择阅读资料来源，再按年级或主题进入文字阅读与题目练习。'
            : `浏览 CommonLit Grade ${initialGrade} 的文章，支持搜索后直接进入阅读与练习。`
        }
        eyebrow={initialGrade === null ? '英语 · 阅读' : 'CommonLit · 分级阅读'}
        title={initialGrade === null ? '阅读资料库' : `Grade ${initialGrade} 阅读文章`}
      />

      {!article ? (
        <div className={initialGrade === null ? undefined : 'reading-grade-standalone'}>
          <section aria-labelledby="reading-source-title" className="reading-source-section">
            <div className="reading-section-title">
              <div>
                <p className="eyebrow">Reading sources</p>
                <h2 id="reading-source-title">选择资料来源</h2>
              </div>
              <p>每个资料库独立管理分类、文章和题目。</p>
            </div>
            <div className="reading-source-grid">
              <button
                aria-expanded={selectedCollection === 'commonlit'}
                className={
                  selectedCollection === 'commonlit'
                    ? 'reading-source-card is-active'
                    : 'reading-source-card'
                }
                onClick={() => {
                  const next = selectedCollection === 'commonlit' ? null : 'commonlit';
                  setSelectedCollection(next);
                  setSelectedGrade(null);
                  setItems([]);
                  setQuery('');
                  setVisibleCount(40);
                  setError(null);
                }}
                type="button"
              >
                <span className="reading-source-icon">
                  <Icon name="book" size={22} />
                </span>
                <span className="reading-source-copy">
                  <small>分级阅读</small>
                  <strong>CommonLit</strong>
                  <p>Grade 3–12 文章，含原文理解题与讨论题。</p>
                </span>
                <span className="reading-source-count">
                  <strong>{summary.totalCount.toLocaleString('en-US')}</strong>
                  <small>篇文章</small>
                </span>
                <Icon name="chevron" size={18} />
              </button>
              <div className="reading-source-future">
                <span>
                  <Icon name="plus" size={20} />
                </span>
                <div>
                  <strong>为新资料库预留</strong>
                  <p>以后新增的阅读来源会在这里与 CommonLit 并列，不会混在同一个目录里。</p>
                </div>
              </div>
            </div>
          </section>

          {selectedCollection === null ? (
            <div className="reading-library-prompt">
              <span>
                <Icon name="book" size={22} />
              </span>
              <div>
                <strong>先选择一个阅读资料库</strong>
                <p>选中后才会显示该来源的分类和文章。</p>
              </div>
            </div>
          ) : null}

          {selectedCollection === 'commonlit' ? (
            <>
              <section className="reading-library-overview" aria-label="CommonLit 资料库概览">
                <div>
                  <span>CommonLit 文章</span>
                  <strong>{summary.totalCount.toLocaleString('en-US')}</strong>
                  <small>Grade 3–12</small>
                </div>
                <div>
                  <span>原文理解题</span>
                  <strong>{summary.totalQuestions.toLocaleString('en-US')}</strong>
                  <small>选择题 + 简答题</small>
                </div>
                <div>
                  <span>全库去重词汇</span>
                  <strong>{summary.totalVocabulary.toLocaleString('en-US')}</strong>
                  <small>词性、中文释义与双语语境</small>
                </div>
              </section>

              <section aria-labelledby="reading-grade-title" className="reading-grade-section">
                <div className="reading-section-title">
                  <div>
                    <p className="eyebrow">CommonLit · Choose a grade</p>
                    <h2 id="reading-grade-title">按年级选择</h2>
                  </div>
                  <p>选择后进入该年级的独立文章页。</p>
                </div>
                <div className="reading-grade-grid">
                  {summary.grades.map((grade) => {
                    const active = selectedGrade === grade.grade;
                    return (
                      <div
                        className={active ? 'reading-grade-group is-open' : 'reading-grade-group'}
                        key={grade.grade}
                      >
                        <button
                          aria-label={`打开 Grade ${grade.grade} 文章页`}
                          className="reading-grade-card"
                          onClick={() => {
                            router.push(`${readingHome}/grade/${grade.grade}`);
                          }}
                          type="button"
                        >
                          <span>Grade</span>
                          <strong>{grade.grade}</strong>
                          <small>{grade.count} 篇</small>
                          <Icon name="chevron" size={17} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {selectedGrade === null ? (
                <div className="reading-library-prompt">
                  <span>
                    <Icon name="book" size={22} />
                  </span>
                  <div>
                    <strong>再选择一个 Grade</strong>
                    <p>进入独立页面后，可按标题、作者、编号或 Lexile 搜索文章。</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {initialGrade !== null ? renderGradeArticles(initialGrade) : null}

          {error ? (
            <div className="reading-error" role="alert">
              <Icon name="alert" size={20} />
              <div>
                <strong>{error.problem.title}</strong>
                <p>{error.problem.detail}</p>
              </div>
            </div>
          ) : null}

        </div>
      ) : (
        <main className="reading-workspace" ref={readerRef}>
          <div className="reading-reader-toolbar">
            <button className="button button-secondary" onClick={closeArticle} type="button">
              <Icon name="arrow" size={16} /> 返回 Grade {article.grade}
            </button>
            <div>
              <span>
                作答进度 {answeredCount}/{article.questions.length}
              </span>
              {article.pdfUrl ? (
                <a
                  className="button button-ghost"
                  href={article.pdfUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  查看原 PDF
                </a>
              ) : null}
            </div>
          </div>

          <header className="reading-article-header">
            <div className="reading-article-kicker">
              <span>Grade {article.grade}</span>
              {article.category ? <span>{article.category}</span> : null}
              {article.lexile ? <span>{article.lexile}L</span> : null}
            </div>
            <h1>{article.title}</h1>
            {article.subtitle ? (
              <p className="reading-article-subtitle">{article.subtitle}</p>
            ) : null}
            <p className="reading-article-byline">
              {[article.author, article.publicationYear].filter(Boolean).join(' · ')}
            </p>
            {article.intro ? <p className="reading-article-intro">{article.intro}</p> : null}
            {article.annotationTask ? (
              <div className="reading-annotation-task">
                <Icon name="target" size={18} />
                <p>
                  <strong>阅读任务</strong>
                  {article.annotationTask}
                </p>
              </div>
            ) : null}
          </header>

          <VocabularyCards
            className="reading-vocabulary-section"
            entries={article.vocabulary}
            eyebrow="CommonLit Vocabulary · 全库去重"
          />

          <div className="reading-practice-layout">
            <article className={article.isPoem ? 'reading-passage is-poem' : 'reading-passage'}>
              <div className="reading-passage-heading">
                <div>
                  <p className="eyebrow">Passage</p>
                  <h2>文字版原文</h2>
                </div>
                <span>{article.wordCount.toLocaleString('en-US')} 词</span>
              </div>
              <div className="reading-passage-body">
                {article.blocks.map((block, index) => {
                  const key = `${block.number}-${index}`;
                  if (block.tag === 'h2') return <h2 key={key}>{block.text}</h2>;
                  if (block.tag === 'h3') return <h3 key={key}>{block.text}</h3>;
                  if (block.tag === 'blockquote') {
                    return <blockquote key={key}>{block.text}</blockquote>;
                  }
                  return (
                    <div className="reading-paragraph" key={key}>
                      <span aria-label={`段落 ${block.number}`}>[{block.number}]</span>
                      <p>{block.text}</p>
                    </div>
                  );
                })}
              </div>
              {article.permissions ? (
                <p className="reading-permissions">{article.permissions}</p>
              ) : null}
            </article>

            <aside className="reading-question-rail">
              <div>
                <p className="eyebrow">Questions</p>
                <h2>原文理解题</h2>
                <span>
                  {answeredCount}/{article.questions.length} 已作答
                </span>
              </div>
              {article.questions.length ? (
                <nav aria-label="题目导航">
                  {article.questions.map((question) => (
                    <button
                      aria-label={`前往第 ${question.number} 题`}
                      className={answers[question.id]?.trim() ? 'is-answered' : ''}
                      key={question.id}
                      onClick={() =>
                        document
                          .getElementById(`reading-question-${question.id}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      }
                      type="button"
                    >
                      {question.number}
                    </button>
                  ))}
                </nav>
              ) : (
                <p className="reading-no-question-note">这份原资料未附阅读题。</p>
              )}
            </aside>
          </div>

          <section className="reading-questions-section" aria-labelledby="text-questions-title">
            <div className="reading-questions-heading">
              <div>
                <p className="eyebrow">Text-dependent questions</p>
                <h2 id="text-questions-title">原文理解题</h2>
                <p>所有题目均为可自动判分的选择题；改写题会标明原始题型。</p>
              </div>
              <span>{article.questions.length} 题</span>
            </div>

            {article.questions.length ? (
              <div className="reading-question-list">
                {article.questions.map((question) => (
                  <fieldset
                    className="reading-question-card"
                    id={`reading-question-${question.id}`}
                    key={question.id}
                  >
                    <legend>
                      <span>{question.number}</span>
                      <span className="reading-question-prompt">
                        {question.prompt}
                        {question.rewritten ? (
                          <small>
                            由{question.sourceKind === 'discussion' ? '讨论题' : '简答题'}改写
                          </small>
                        ) : null}
                      </span>
                    </legend>
                    {question.kind === 'multiple-choice' ? (
                      <>
                        <div className="reading-options">
                          {question.options.map((option) => {
                            const result = resultByQuestion.get(question.id);
                            const optionState = result
                              ? option.id === result.correctOptionId
                                ? ' is-correct'
                                : option.id === result.selectedOptionId
                                  ? ' is-incorrect'
                                  : ''
                              : '';
                            return (
                              <label
                                className={optionState.trim()}
                                key={`${question.id}-${option.id}`}
                              >
                                <input
                                  checked={answers[question.id] === option.id}
                                  name={`${article.id}-${question.id}`}
                                  onChange={() => {
                                    setAnswers((current) => ({
                                      ...current,
                                      [question.id]: option.id,
                                    }));
                                    setCheckResult(null);
                                    setSubmissionMessage('');
                                  }}
                                  type="radio"
                                />
                                <span>{option.id.toUpperCase()}</span>
                                <p>{option.label}</p>
                              </label>
                            );
                          })}
                        </div>
                        {resultByQuestion.has(question.id) ? (
                          <div
                            className={
                              resultByQuestion.get(question.id)?.correct
                                ? 'reading-answer-explanation is-correct'
                                : 'reading-answer-explanation is-incorrect'
                            }
                          >
                            <strong>
                              {resultByQuestion.get(question.id)?.correct ? '回答正确' : '回答错误'}
                            </strong>
                            <p>{resultByQuestion.get(question.id)?.explanation}</p>
                            <small>
                              原文依据：第{' '}
                              {resultByQuestion.get(question.id)?.evidence.join('、')} 段
                              {' · '}置信度：
                              {resultByQuestion.get(question.id)?.confidence === 'high'
                                ? '高'
                                : resultByQuestion.get(question.id)?.confidence === 'medium'
                                  ? '中'
                                  : '低'}
                            </small>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <label className="reading-short-answer">
                        <span>你的回答</span>
                        <textarea
                          onChange={(event) => {
                            const value = event.target.value;
                            setAnswers((current) => ({ ...current, [question.id]: value }));
                            setSubmissionMessage('');
                          }}
                          placeholder="Write your answer in complete sentences."
                          rows={5}
                          value={answers[question.id] ?? ''}
                        />
                      </label>
                    )}
                  </fieldset>
                ))}
              </div>
            ) : (
              <div className="reading-empty-questions">
                <Icon name="book" size={22} />
                <div>
                  <strong>原 PDF 未附阅读题</strong>
                  <p>《{article.title}》的原始资料只有文章正文，可作为纯阅读材料使用。</p>
                </div>
              </div>
            )}

            {article.questions.length ? (
              <div className="reading-submit-panel">
                <div>
                  <strong>作答会自动保存在本机</strong>
                  <p>
                    {article.answerBankStatus === 'ready'
                      ? `提交后立即判分并显示原文依据${article.answerBankReviewed ? '；答案已经二次复核' : ''}。`
                      : '这篇文章的自编答案仍在生成中，暂时只保存进度。'}
                  </p>
                  {submissionMessage ? <span role="status">{submissionMessage}</span> : null}
                </div>
                <button
                  className="button button-primary"
                  disabled={grading}
                  onClick={() => void completeExercise()}
                  type="button"
                >
                  <Icon name="check" size={17} /> {grading ? '正在判分…' : '提交并判分'}
                </button>
              </div>
            ) : null}
          </section>

          {article.discussionQuestions.length ? (
            <details className="reading-discussion-section">
              <summary>
                <span>
                  <small>Discussion questions</small>
                  <strong>讨论与开放表达</strong>
                </span>
                <span>{article.discussionQuestions.length} 题</span>
              </summary>
              <div className="reading-question-list">
                {article.discussionQuestions.map((question) => (
                  <fieldset className="reading-question-card" key={question.id}>
                    <legend>
                      <span>{question.number}</span>
                      {question.prompt}
                    </legend>
                    <label className="reading-short-answer">
                      <span>讨论笔记（可选）</span>
                      <textarea
                        onChange={(event) => {
                          const value = event.target.value;
                          setAnswers((current) => ({ ...current, [question.id]: value }));
                        }}
                        placeholder="Record your ideas here."
                        rows={4}
                        value={answers[question.id] ?? ''}
                      />
                    </label>
                  </fieldset>
                ))}
              </div>
            </details>
          ) : null}
        </main>
      )}

      {showBackToTop ? (
        <button
          aria-label="回到页面顶部"
          className="listening-back-to-top"
          onClick={() => {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ behavior: reduceMotion ? 'auto' : 'smooth', top: 0 });
          }}
          title="回到顶部"
          type="button"
        >
          <Icon name="arrow" size={17} />
          <span>顶部</span>
        </button>
      ) : null}
    </>
  );
}

export default function ToeflReadingRoute() {
  return <ToeflReadingPage />;
}
