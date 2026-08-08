'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import { useWorkspace } from '@/components/workspace-provider';
import { apiRequest, resolveApiRequestUrl, tenantPath } from '@/lib/api';
import styles from '@/components/ap-library/ap-library.module.css';

type Session = 'feb-mar' | 'may-june' | 'oct-nov';
type DocumentType =
  | 'question'
  | 'mark_scheme'
  | 'grade_threshold'
  | 'examiner_report'
  | 'insert'
  | 'confidential_instructions'
  | 'prerelease_material'
  | 'supporting_file'
  | 'topic_question'
  | 'topic_answer'
  | 'syllabus'
  | 'reference';

interface Subject {
  id: string;
  label: string;
  category: string;
  syllabusCodes: string[];
  years: number[];
  questionDocumentCount: number;
  topicDocumentCount: number;
  markSchemeCount: number;
  resourceCount: number;
}

interface DocumentSummary {
  id: string;
  subjectId: string;
  syllabusCode: string | null;
  relativePath: string;
  title: string;
  year: number | null;
  session: Session | null;
  level: 'AS' | 'A2' | null;
  levelConfidence: 'explicit' | 'inferred' | null;
  paper: number | null;
  variant: number | null;
  documentType: DocumentType;
  collectionType: 'past-paper' | 'topic' | 'support';
  mediaType: string;
  relatedResourceIds: string[];
  textStatus?: 'native' | 'scan' | 'error';
  pageCount?: number | null;
  questionCount?: number;
}

interface Catalog {
  releaseVersion: string;
  subjects: Subject[];
  summary: {
    sourceFileCount: number;
    uniqueResourceCount: number;
    questionDocumentCount: number;
    topicDocumentCount: number;
    markSchemeCount: number;
  };
}

interface NativeDocument {
  documentId: string;
  title: string;
  textStatus: 'native' | 'scan' | 'error';
  pages: Array<{
    number: number;
    blocks: Array<{ type: 'text'; text: string }>;
    questions: Array<{
      number: number;
      prompt: string;
      options: Array<{ label: string; text: string }>;
    }>;
  }>;
}

interface DocumentPayload {
  document: DocumentSummary;
  content: NativeDocument;
  relatedDocuments: DocumentSummary[];
}

interface SubjectDocuments {
  subject: Subject;
  items: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    years: number[];
    sessions: Session[];
    levels: Array<'AS' | 'A2'>;
    papers: number[];
  };
}

const sessionLabels: Record<Session, string> = {
  'feb-mar': 'Feb/Mar',
  'may-june': 'May/June',
  'oct-nov': 'Oct/Nov',
};

const resourceLabels: Partial<Record<DocumentType, string>> = {
  mark_scheme: '评分标准',
  topic_answer: '答案与解析',
  grade_threshold: '成绩阈值',
  examiner_report: '考官报告',
  insert: '试卷插页',
  confidential_instructions: '实验说明',
  prerelease_material: '预发布材料',
  supporting_file: '考试附件',
  syllabus: '考试大纲',
  reference: '参考资料',
};

function basePath(pathname: string) {
  return pathname.startsWith('/student/') ? '/student/learning/alevel' : '/learning/alevel';
}

function useCatalog() {
  const { currentTenant } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<Catalog>(tenantPath(currentTenant.id, '/learning/alevel/catalog'))
      .then((value) => active && setCatalog(value))
      .catch(
        (reason: unknown) =>
          active && setError(reason instanceof Error ? reason.message : '无法载入 A Level 题库'),
      );
    return () => {
      active = false;
    };
  }, [currentTenant.id]);
  return { catalog, error };
}

export function AlevelCatalogView({ subjectId }: { subjectId?: string }) {
  const pathname = usePathname();
  const base = basePath(pathname);
  const { currentTenant } = useWorkspace();
  const { catalog, error: catalogError } = useCatalog();
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('past-paper');
  const [year, setYear] = useState('');
  const [session, setSession] = useState('');
  const [level, setLevel] = useState('');
  const [paper, setPaper] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SubjectDocuments | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const subject = catalog?.subjects.find((item) => item.id === subjectId);

  useEffect(() => setPage(1), [collection, level, paper, query, session, year]);
  useEffect(() => {
    if (!subjectId) return;
    let active = true;
    const parameters = new URLSearchParams({ collection, page: String(page), pageSize: '40' });
    if (query.trim()) parameters.set('q', query.trim());
    if (year) parameters.set('year', year);
    if (session) parameters.set('session', session);
    if (level) parameters.set('level', level);
    if (paper) parameters.set('paper', paper);
    setLoading(true);
    setError('');
    apiRequest<SubjectDocuments>(
      tenantPath(
        currentTenant.id,
        `/learning/alevel/subjects/${encodeURIComponent(subjectId)}/documents?${parameters}`,
      ),
    )
      .then((value) => active && setResult(value))
      .catch(
        (reason: unknown) =>
          active && setError(reason instanceof Error ? reason.message : '无法载入本科目题卷'),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [collection, currentTenant.id, level, page, paper, query, session, subjectId, year]);

  const filteredSubjects = useMemo(() => {
    if (!catalog) return [];
    const value = query.trim().toLowerCase();
    return catalog.subjects.filter(
      (item) =>
        !value || `${item.label} ${item.syllabusCodes.join(' ')}`.toLowerCase().includes(value),
    );
  }, [catalog, query]);

  if (catalogError) return <div className={styles.error}>{catalogError}</div>;
  if (!catalog) return <div className={styles.loading}>正在载入 A Level 题库目录…</div>;
  if (subjectId && !subject) return <div className={styles.empty}>没有找到这个 A Level 科目。</div>;

  if (subject) {
    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize ?? 40)));
    return (
      <div className={styles.shell}>
        <Link className={styles.back} href={base}>
          ← 返回 A Level 科目
        </Link>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{subject.category} · Cambridge International</p>
            <h1>{subject.label}</h1>
            <p>
              课程代码 {subject.syllabusCodes.join('、')}。按具体年份、考季、Paper 与 Variant
              查找题卷。
            </p>
          </div>
          <div className={styles.summary}>
            <strong>{subject.questionDocumentCount + subject.topicDocumentCount}</strong>
            <span>份去重题卷与专题练习</span>
          </div>
        </header>
        <div className={styles.counts}>
          {(
            [
              ['past-paper', `历年真题 ${subject.questionDocumentCount}`],
              ['topic', `专题练习 ${subject.topicDocumentCount}`],
              ['support', `配套资料 ${subject.resourceCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              className={`${styles.button} ${collection === value ? '' : styles.buttonSecondary}`}
              key={value}
              onClick={() => setCollection(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Icon name="search" size={17} />
            <input
              aria-label="搜索 A Level 题卷"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索年份、试卷或知识点"
              value={query}
            />
          </label>
          <select
            className={styles.filter}
            onChange={(event) => setYear(event.target.value)}
            value={year}
          >
            <option value="">全部年份</option>
            {result?.facets.years.map((value) => (
              <option key={value} value={value}>
                {value} 年
              </option>
            ))}
          </select>
          <select
            className={styles.filter}
            onChange={(event) => setSession(event.target.value)}
            value={session}
          >
            <option value="">全部考季</option>
            {result?.facets.sessions.map((value) => (
              <option key={value} value={value}>
                {sessionLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={styles.filter}
            onChange={(event) => setLevel(event.target.value)}
            value={level}
          >
            <option value="">AS / A2</option>
            {result?.facets.levels.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className={styles.filter}
            onChange={(event) => setPaper(event.target.value)}
            value={paper}
          >
            <option value="">全部 Paper</option>
            {result?.facets.papers.map((value) => (
              <option key={value} value={value}>
                Paper {value}
              </option>
            ))}
          </select>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <div className={styles.loading}>正在载入题卷…</div> : null}
        {!loading ? (
          <section className={styles.documentList}>
            {result?.items.map((document) => (
              <Link
                className={styles.documentCard}
                href={`${base}/documents/${document.id}`}
                key={document.id}
              >
                <span className={styles.year}>{document.year ?? '专题'}</span>
                <div>
                  <h3>{document.title}</h3>
                  <p>
                    {document.session ? sessionLabels[document.session] : '专题资料'}
                    {document.level ? ` · ${document.level}` : ''}
                    {document.syllabusCode ? ` · ${document.syllabusCode}` : ''}
                    {document.pageCount ? ` · ${document.pageCount} 页` : ''}
                  </p>
                </div>
                <span className={styles.answerReady}>
                  {document.relatedResourceIds.length ? '含答案与配套资料 →' : '进入题卷 →'}
                </span>
              </Link>
            ))}
            {!result?.items.length ? (
              <div className={styles.empty}>没有符合条件的资料。</div>
            ) : null}
          </section>
        ) : null}
        {totalPages > 1 ? (
          <div className={styles.pagination}>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              disabled={page === totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const categories = [...new Set(catalog.subjects.map((item) => item.category))];
  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Cambridge International AS & A Level</p>
          <h1>A Level 题库</h1>
          <p>覆盖本地资料库中的全部 CIE 科目、历年真题、评分标准、专题练习与考试附件。</p>
        </div>
        <div className={styles.summary}>
          <strong>
            {catalog.summary.questionDocumentCount + catalog.summary.topicDocumentCount}
          </strong>
          <span>
            {catalog.subjects.length} 个科目 · {catalog.summary.sourceFileCount.toLocaleString()}{' '}
            个源文件
          </span>
        </div>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" size={17} />
          <input
            aria-label="搜索 A Level 科目"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索科目或课程代码"
            value={query}
          />
        </label>
      </div>
      {categories.map((category) => {
        const subjects = filteredSubjects.filter((item) => item.category === category);
        if (!subjects.length) return null;
        return (
          <section className={styles.category} key={category}>
            <h2>{category}</h2>
            <div className={styles.subjectGrid}>
              {subjects.map((item) => (
                <Link className={styles.subjectCard} href={`${base}/${item.id}`} key={item.id}>
                  <p className={styles.eyebrow}>CIE {item.syllabusCodes.join(' / ')}</p>
                  <h3>{item.label}</h3>
                  <div className={styles.counts}>
                    <span className={styles.badge}>{item.questionDocumentCount} 份真题</span>
                    {item.topicDocumentCount ? (
                      <span className={styles.badge}>{item.topicDocumentCount} 份专题</span>
                    ) : null}
                    <span className={styles.badge}>{item.markSchemeCount} 份评分标准</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function NativePages({ content, compact = false }: { content: NativeDocument; compact?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className={compact ? styles.solutionDocument : styles.pages}>
      {content.pages.map((page) => (
        <article className={compact ? undefined : styles.page} key={page.number}>
          {compact ? null : <span className={styles.pageNumber}>PAGE {page.number}</span>}
          {page.blocks.map((block, index) => (
            <p
              className={compact ? styles.solutionText : styles.block}
              key={`${page.number}-${index}`}
            >
              {block.text}
            </p>
          ))}
          {!compact && page.questions.some((question) => question.options.length >= 2) ? (
            <div className={styles.interactive}>
              {page.questions
                .filter((question) => question.options.length >= 2)
                .map((question) => (
                  <fieldset className={styles.question} key={`${page.number}-${question.number}`}>
                    <legend>
                      {question.number}. {question.prompt}
                    </legend>
                    <div className={styles.options}>
                      {question.options.map((option) => {
                        const key = `${page.number}-${question.number}`;
                        return (
                          <label className={styles.option} key={option.label}>
                            <input
                              checked={answers[key] === option.label}
                              name={key}
                              onChange={() =>
                                setAnswers((current) => ({ ...current, [key]: option.label }))
                              }
                              type="radio"
                            />
                            <strong>{option.label}</strong>
                            <span>{option.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function AlevelDocumentView({ documentId }: { documentId: string }) {
  const pathname = usePathname();
  const base = basePath(pathname);
  const { currentTenant } = useWorkspace();
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [activeResource, setActiveResource] = useState<DocumentPayload | null>(null);
  const [download, setDownload] = useState<{ document: DocumentSummary; url: string } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<DocumentPayload>(
      tenantPath(currentTenant.id, `/learning/alevel/documents/${encodeURIComponent(documentId)}`),
    )
      .then((value) => active && setPayload(value))
      .catch(
        (reason: unknown) =>
          active && setError(reason instanceof Error ? reason.message : '无法载入 A Level 题卷'),
      );
    return () => {
      active = false;
    };
  }, [currentTenant.id, documentId]);

  const openResource = useCallback(
    async (document: DocumentSummary) => {
      if (document.mediaType === 'application/pdf') {
        const value = await apiRequest<DocumentPayload>(
          tenantPath(
            currentTenant.id,
            `/learning/alevel/documents/${encodeURIComponent(document.id)}`,
          ),
        );
        setActiveResource(value);
        setDownload(null);
        return;
      }
      const value = await apiRequest<{ url: string }>(
        tenantPath(
          currentTenant.id,
          `/learning/alevel/resources/${encodeURIComponent(document.id)}`,
        ),
      );
      setDownload({ document, url: value.url });
      setActiveResource(null);
    },
    [currentTenant.id],
  );

  if (error) return <div className={styles.error}>{error}</div>;
  if (!payload) return <div className={styles.loading}>正在载入 A Level 题卷…</div>;
  const document = payload.document;
  const originalUrl = resolveApiRequestUrl(
    tenantPath(
      currentTenant.id,
      `/learning/alevel/documents/${encodeURIComponent(document.id)}/embed`,
    ),
  );
  const scan = document.textStatus !== 'native';
  return (
    <div className={styles.shell}>
      <Link className={styles.back} href={`${base}/${document.subjectId}`}>
        ← 返回本科目题库
      </Link>
      <header className={styles.documentHeader}>
        <p className={styles.eyebrow}>CAMBRIDGE INTERNATIONAL EMBEDDED QUESTION PAPER</p>
        <h1>{document.title}</h1>
        <div className={styles.documentMeta}>
          {document.syllabusCode ? <span>{document.syllabusCode}</span> : null}
          {document.year ? <span>{document.year} 年</span> : <span>专题练习</span>}
          {document.session ? <span>{sessionLabels[document.session]}</span> : null}
          {document.level ? <span>{document.level}</span> : null}
          {document.paper ? <span>Paper {document.paper}</span> : null}
          {document.variant !== null ? <span>Variant {document.variant}</span> : null}
          {document.pageCount ? <span>{document.pageCount} 页</span> : null}
        </div>
        <div className={styles.actions}>
          {!scan ? (
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={() => setShowOriginal((value) => !value)}
              type="button"
            >
              {showOriginal ? '收起原卷图表' : '查看原卷图表'}
            </button>
          ) : null}
        </div>
      </header>
      {payload.relatedDocuments.length ? (
        <section className={styles.solutionPanel}>
          <h2>答案与配套资料</h2>
          <div className={styles.counts}>
            {payload.relatedDocuments.map((resource) => (
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                key={resource.id}
                onClick={() => void openResource(resource)}
                type="button"
              >
                {resourceLabels[resource.documentType] ?? '相关资料'} · {resource.title}
              </button>
            ))}
          </div>
          {activeResource ? (
            <div>
              <h3>{activeResource.document.title}</h3>
              {activeResource.content.textStatus === 'native' ? (
                <NativePages compact content={activeResource.content} />
              ) : (
                <iframe
                  className={styles.pdfFrame}
                  src={resolveApiRequestUrl(
                    tenantPath(
                      currentTenant.id,
                      `/learning/alevel/documents/${encodeURIComponent(activeResource.document.id)}/embed`,
                    ),
                  )}
                  title={activeResource.document.title}
                />
              )}
            </div>
          ) : null}
          {download ? (
            download.document.mediaType.startsWith('audio/') ? (
              <audio controls src={download.url} />
            ) : download.document.mediaType.startsWith('video/') ? (
              <video controls src={download.url} style={{ maxWidth: '100%' }} />
            ) : (
              <a className={styles.back} href={download.url} rel="noreferrer" target="_blank">
                下载 {download.document.title}
              </a>
            )
          ) : null}
        </section>
      ) : null}
      {scan ? (
        <>
          <div className={styles.notice}>
            这份资料没有可靠的可提取文字层，已直接内嵌原始 PDF，不使用整页截图替代题目。
          </div>
          <iframe className={styles.pdfFrame} src={originalUrl} title={document.title} />
        </>
      ) : (
        <>
          <NativePages content={payload.content} />
          {showOriginal ? (
            <section className={styles.solutionPanel}>
              <h2>原卷图表与排版</h2>
              <iframe
                className={styles.pdfFrame}
                src={originalUrl}
                title={`${document.title} 原卷`}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
