'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icon';
import { useWorkspace } from '@/components/workspace-provider';
import { apiRequest, tenantPath } from '@/lib/api';
import styles from './ap-library.module.css';

type DocumentType = 'question' | 'answer' | 'combined' | 'reference';

interface Subject {
  id: string;
  label: string;
  category: string;
  questionDocumentCount: number;
  answerDocumentCount: number;
  referenceDocumentCount: number;
  mediaCount: number;
}

interface DocumentSummary {
  id: string;
  subjectId: string;
  title: string;
  relativePath: string;
  year: number | null;
  sizeBytes: number;
  mediaType: string;
  documentType: DocumentType;
  answerDocumentIds: string[];
  hasEmbeddedAnswers?: boolean;
  pageCount?: number;
  questionCount?: number;
  textStatus?: 'native' | 'ocr' | 'scan' | 'error';
}

interface Catalog {
  subjects: Subject[];
  documents: DocumentSummary[];
  media: MediaSummary[];
  summary: {
    sourceFileCount: number;
    uniqueDocumentCount: number;
    questionDocumentCount: number;
    answerDocumentCount: number;
    referenceDocumentCount: number;
    duplicateDocumentCount: number;
  };
}

interface MediaSummary {
  id: string;
  subjectId: string;
  title: string;
  relativePath: string;
  year: number | null;
  sizeBytes: number;
  mediaType: string;
}

interface NativeDocument {
  documentId: string;
  title: string;
  documentType: DocumentType;
  textStatus: 'native' | 'ocr' | 'scan' | 'error';
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
  answers: DocumentSummary[];
  media: MediaSummary[];
}

function useApCatalog() {
  const { currentTenant } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<Catalog>(tenantPath(currentTenant.id, '/learning/ap/catalog'))
      .then((value) => active && setCatalog(value))
      .catch(
        (reason: unknown) =>
          active && setError(reason instanceof Error ? reason.message : '无法载入 AP 题库'),
      );
    return () => {
      active = false;
    };
  }, [currentTenant.id]);
  return { catalog, error };
}

function basePath(pathname: string) {
  return pathname.startsWith('/student/') ? '/student/learning/ap' : '/learning/ap';
}

export function ApCatalogView({ subjectId }: { subjectId?: string }) {
  const pathname = usePathname();
  const base = basePath(pathname);
  const { catalog, error } = useApCatalog();
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 40;

  const subject = catalog?.subjects.find((item) => item.id === subjectId);
  const filteredDocuments = useMemo(() => {
    if (!catalog || !subjectId) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.documents.filter(
      (document) =>
        document.subjectId === subjectId &&
        (document.documentType === 'question' || document.documentType === 'combined') &&
        (year === 'all' || String(document.year ?? '') === year) &&
        (!normalizedQuery ||
          `${document.title} ${document.relativePath}`.toLowerCase().includes(normalizedQuery)),
    );
  }, [catalog, query, subjectId, year]);
  const years = useMemo(() => {
    if (!catalog || !subjectId) return [];
    return [
      ...new Set(
        catalog.documents
          .filter((item) => item.subjectId === subjectId && item.year)
          .map((item) => item.year!),
      ),
    ].sort((a, b) => b - a);
  }, [catalog, subjectId]);
  useEffect(() => setPage(1), [query, year]);

  if (error) return <div className={styles.error}>{error}</div>;
  if (!catalog) return <div className={styles.loading}>正在载入 AP 题库目录…</div>;

  if (subjectId && !subject) return <div className={styles.empty}>没有找到这个 AP 科目。</div>;

  if (subject) {
    const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize));
    const visible = filteredDocuments.slice((page - 1) * pageSize, page * pageSize);
    return (
      <div className={styles.shell}>
        <Link className={styles.back} href={base}>
          ← 返回 AP 科目
        </Link>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{subject.category} · AP Question Bank</p>
            <h1>{subject.label}</h1>
            <p>试题以可选择文字或内嵌原卷显示；对应评分标准、答案与样例可在试卷内直接展开。</p>
          </div>
          <div className={styles.summary}>
            <strong>{subject.questionDocumentCount}</strong>
            <span>份去重试题</span>
          </div>
        </header>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Icon name="search" size={17} />
            <input
              aria-label="搜索试卷"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索年份、试卷或题型"
              value={query}
            />
          </label>
          <select
            aria-label="按年份筛选"
            className={styles.filter}
            onChange={(event) => setYear(event.target.value)}
            value={year}
          >
            <option value="all">全部年份</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value} 年
              </option>
            ))}
          </select>
        </div>
        <section className={styles.documentList}>
          {visible.map((document) => (
            <Link
              className={styles.documentCard}
              href={`${base}/documents/${document.id}`}
              key={document.id}
            >
              <span className={styles.year}>{document.year ?? 'AP'}</span>
              <div>
                <h3>{document.title}</h3>
                <p>
                  {document.pageCount ? `${document.pageCount} 页` : '结构化试卷'}
                  {document.questionCount ? ` · 识别 ${document.questionCount} 题` : ''}
                </p>
              </div>
              <span className={styles.answerReady}>
                {document.hasEmbeddedAnswers || document.answerDocumentIds.length
                  ? '含答案解析 →'
                  : '进入试卷 →'}
              </span>
            </Link>
          ))}
          {!visible.length ? <div className={styles.empty}>没有符合条件的试卷。</div> : null}
        </section>
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

  const groups = [...new Set(catalog.subjects.map((item) => item.category))];
  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Advanced Placement</p>
          <h1>AP 题库</h1>
          <p>
            覆盖文件夹内全部 AP 科目真题；有文字层的试卷采用原生网页排版，扫描卷以内嵌 PDF
            显示，答案、评分标准与样例响应可直接查看。
          </p>
        </div>
        <div className={styles.summary}>
          <strong>{catalog.summary.questionDocumentCount}</strong>
          <span>份去重试题 · {catalog.summary.sourceFileCount.toLocaleString()} 个源文件</span>
        </div>
      </header>
      {groups.map((category) => (
        <section className={styles.category} key={category}>
          <h2>{category}</h2>
          <div className={styles.subjectGrid}>
            {catalog.subjects
              .filter((item) => item.category === category)
              .map((item) => (
                <Link className={styles.subjectCard} href={`${base}/${item.id}`} key={item.id}>
                  <p className={styles.eyebrow}>AP COURSE</p>
                  <h3>{item.label}</h3>
                  <div className={styles.counts}>
                    <span className={styles.badge}>{item.questionDocumentCount} 份试题</span>
                    <span className={styles.badge}>{item.answerDocumentCount} 份解析</span>
                    {item.mediaCount ? (
                      <span className={styles.badge}>{item.mediaCount} 个音视频</span>
                    ) : null}
                  </div>
                </Link>
              ))}
          </div>
        </section>
      ))}
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

function ApMedia({ items }: { items: MediaSummary[] }) {
  const { currentTenant } = useWorkspace();
  const [active, setActive] = useState<{ item: MediaSummary; url: string } | null>(null);
  const [loading, setLoading] = useState('');
  const play = useCallback(
    async (item: MediaSummary) => {
      setLoading(item.id);
      try {
        const result = await apiRequest<{ url: string }>(
          tenantPath(
            currentTenant.id,
            `/learning/ap/media/${encodeURIComponent(item.id)}/resource`,
          ),
        );
        setActive({ item, url: result.url });
      } finally {
        setLoading('');
      }
    },
    [currentTenant.id],
  );
  if (!items.length) return null;
  return (
    <section className={styles.solutionPanel}>
      <h2>本卷配套音视频</h2>
      <div className={styles.counts}>
        {items.map((item) => (
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            key={item.id}
            onClick={() => void play(item)}
            type="button"
          >
            {loading === item.id ? '载入中…' : item.title}
          </button>
        ))}
      </div>
      {active ? (
        active.item.mediaType.startsWith('audio/') ? (
          <audio autoPlay controls src={active.url} />
        ) : active.item.mediaType.startsWith('video/') ? (
          <video controls src={active.url} style={{ maxWidth: '100%' }} />
        ) : (
          <a className={styles.back} href={active.url} rel="noreferrer" target="_blank">
            打开 {active.item.title}
          </a>
        )
      ) : null}
    </section>
  );
}

export function ApDocumentView({ documentId }: { documentId: string }) {
  const pathname = usePathname();
  const base = basePath(pathname);
  const { currentTenant } = useWorkspace();
  const [payload, setPayload] = useState<DocumentPayload | null>(null);
  const [solutions, setSolutions] = useState<DocumentPayload[]>([]);
  const [showSolutions, setShowSolutions] = useState(false);
  const [loadingSolutions, setLoadingSolutions] = useState(false);
  const [originalUrl, setOriginalUrl] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [solutionResources, setSolutionResources] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    apiRequest<DocumentPayload>(
      tenantPath(currentTenant.id, `/learning/ap/documents/${encodeURIComponent(documentId)}`),
    )
      .then((value) => active && setPayload(value))
      .catch(
        (reason: unknown) =>
          active && setError(reason instanceof Error ? reason.message : '无法载入试卷'),
      );
    return () => {
      active = false;
    };
  }, [currentTenant.id, documentId]);

  const loadSolutions = useCallback(async () => {
    if (!payload) return;
    if (showSolutions) {
      setShowSolutions(false);
      return;
    }
    setShowSolutions(true);
    if (solutions.length || !payload.answers.length) return;
    setLoadingSolutions(true);
    try {
      const values = await Promise.all(
        payload.answers.map((answer) =>
          apiRequest<DocumentPayload>(
            tenantPath(currentTenant.id, `/learning/ap/documents/${encodeURIComponent(answer.id)}`),
          ),
        ),
      );
      setSolutions(values);
      const scanned = values.filter((value) => value.content.textStatus === 'scan');
      if (scanned.length) {
        const resources = await Promise.all(
          scanned.map(async (value) => {
            const result = await apiRequest<{ url: string }>(
              tenantPath(
                currentTenant.id,
                `/learning/ap/documents/${encodeURIComponent(value.document.id)}/resource`,
              ),
            );
            return [value.document.id, result.url] as const;
          }),
        );
        setSolutionResources(Object.fromEntries(resources));
      }
    } finally {
      setLoadingSolutions(false);
    }
  }, [currentTenant.id, payload, showSolutions, solutions.length]);

  const toggleOriginal = useCallback(async () => {
    if (!payload) return;
    if (originalUrl) {
      setShowOriginal((value) => !value);
      return;
    }
    const result = await apiRequest<{ url: string }>(
      tenantPath(
        currentTenant.id,
        `/learning/ap/documents/${encodeURIComponent(payload.document.id)}/resource`,
      ),
    );
    setOriginalUrl(result.url);
    setShowOriginal(true);
  }, [currentTenant.id, originalUrl, payload]);

  useEffect(() => {
    if (!payload || payload.content.textStatus !== 'scan' || originalUrl) return;
    void apiRequest<{ url: string }>(
      tenantPath(
        currentTenant.id,
        `/learning/ap/documents/${encodeURIComponent(payload.document.id)}/resource`,
      ),
    ).then((result) => {
      setOriginalUrl(result.url);
      setShowOriginal(true);
    });
  }, [currentTenant.id, originalUrl, payload]);

  if (error) return <div className={styles.error}>{error}</div>;
  if (!payload) return <div className={styles.loading}>正在载入结构化试卷…</div>;
  const hasSolutions = payload.document.hasEmbeddedAnswers || payload.answers.length > 0;
  return (
    <div className={styles.shell}>
      <Link className={styles.back} href={`${base}/${payload.document.subjectId}`}>
        ← 返回本科目题库
      </Link>
      <header className={styles.documentHeader}>
        <p className={styles.eyebrow}>AP EMBEDDED QUESTION PAPER</p>
        <h1>{payload.document.title}</h1>
        <div className={styles.documentMeta}>
          <span>{payload.document.year ? `${payload.document.year} 年` : 'AP 题库'}</span>
          <span>·</span>
          <span>{payload.content.pages.length} 页</span>
          <span>·</span>
          <span>
            {payload.content.textStatus === 'native'
              ? '原生可选文字'
              : payload.content.textStatus === 'ocr'
                ? 'OCR 可选文字'
                : '扫描源文件'}
          </span>
        </div>
        <div className={styles.actions}>
          {hasSolutions ? (
            <button className={styles.button} onClick={() => void loadSolutions()} type="button">
              {showSolutions ? '收起答案解析' : '查看答案解析'}
            </button>
          ) : null}
          {payload.content.textStatus !== 'scan' ? (
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={() => void toggleOriginal()}
              type="button"
            >
              {showOriginal ? '收起原卷图表' : '查看原卷图表'}
            </button>
          ) : null}
        </div>
      </header>
      {payload.content.textStatus === 'scan' ? (
        <div className={styles.notice}>
          这份源文件没有可提取的文字层，已以内嵌 PDF 显示；不会用整页截图冒充嵌入式题目。
        </div>
      ) : null}
      <ApMedia items={payload.media} />
      {showSolutions ? (
        <section className={styles.solutionPanel}>
          <h2>答案与评分解析</h2>
          {loadingSolutions ? <p>正在载入对应评分标准…</p> : null}
          {payload.document.hasEmbeddedAnswers ? (
            <p>本卷自带答案；可在下方原生文档后半部分查看。</p>
          ) : null}
          {solutions.map((solution) => (
            <div key={solution.document.id}>
              <h3>{solution.document.title}</h3>
              {solution.content.textStatus === 'scan' && solutionResources[solution.document.id] ? (
                <iframe
                  className={styles.pdfFrame}
                  src={solutionResources[solution.document.id]}
                  title={`${solution.document.title} 答案解析`}
                />
              ) : (
                <NativePages compact content={solution.content} />
              )}
            </div>
          ))}
        </section>
      ) : null}
      {payload.content.textStatus === 'scan' ? (
        originalUrl ? (
          <iframe className={styles.pdfFrame} src={originalUrl} title={payload.document.title} />
        ) : (
          <div className={styles.loading}>正在载入内嵌原卷…</div>
        )
      ) : (
        <>
          <NativePages content={payload.content} />
          {showOriginal && originalUrl ? (
            <section className={styles.solutionPanel}>
              <h2>原卷与图表</h2>
              <iframe
                className={styles.pdfFrame}
                src={originalUrl}
                title={payload.document.title}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
