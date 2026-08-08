'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import styles from '@/components/ap-library/ap-library.module.css';

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;
const RENDER_WINDOW = 3;

type PageRenderState = 'rendering' | 'ready';

function clampPage(value: number, pageCount: number) {
  return Math.min(Math.max(Math.trunc(value), 1), Math.max(pageCount, 1));
}

function readableError(reason: unknown) {
  return reason instanceof Error ? reason.message : '无法加载这份 PDF。';
}

export function AlevelPdfReader({ src, title }: { src: string; title: string }) {
  const canvasRef = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pageRef = useRef<Record<number, HTMLDivElement | null>>({});
  const viewportRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<Map<number, RenderTask>>(new Map());
  const renderedRef = useRef<Map<number, PageRenderState>>(new Map());
  const renderGenerationRef = useRef(0);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [pageRatio, setPageRatio] = useState(1 / Math.SQRT2);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateWidth = () => setAvailableWidth(Math.floor(viewport.clientWidth));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void>; promise: Promise<PDFDocumentProxy> } | null =
      null;

    setLoading(true);
    setError('');
    setPageCount(0);
    setCurrentPage(1);
    setPageInput('1');
    setRenderedPages(new Set());
    documentRef.current = null;

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        if (cancelled) return;
        loadingTask = pdfjs.getDocument({
          disableAutoFetch: true,
          url: src,
          withCredentials: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          await pdf.cleanup();
          return;
        }
        const firstPage = await pdf.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1 });
        documentRef.current = pdf;
        setPageRatio(viewport.width / viewport.height);
        setPageCount(pdf.numPages);
      } catch (reason) {
        if (!cancelled) setError(readableError(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderGenerationRef.current += 1;
      for (const task of renderTaskRef.current.values()) task.cancel();
      renderTaskRef.current.clear();
      renderedRef.current.clear();
      if (loadingTask) void loadingTask.destroy();
      const pdf = documentRef.current;
      documentRef.current = null;
      if (pdf) void pdf.cleanup();
    };
  }, [src]);

  const clearPage = useCallback((pageNumber: number) => {
    if (renderedRef.current.get(pageNumber) !== 'ready') return;
    const canvas = canvasRef.current[pageNumber];
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    }
    renderedRef.current.delete(pageNumber);
    setRenderedPages((current) => {
      if (!current.has(pageNumber)) return current;
      const next = new Set(current);
      next.delete(pageNumber);
      return next;
    });
  }, []);

  const renderPage = useCallback(
    async (pageNumber: number) => {
      const pdf = documentRef.current;
      const canvas = canvasRef.current[pageNumber];
      if (!pdf || !canvas || !availableWidth || renderedRef.current.has(pageNumber)) return;
      const generation = renderGenerationRef.current;
      renderedRef.current.set(pageNumber, 'rendering');

      try {
        const pdfPage = await pdf.getPage(pageNumber);
        if (generation !== renderGenerationRef.current) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        // The A Level reader is intentionally a wide, document-first workspace.
        // Keep the page close to the full available reading width instead of
        // capping it at the former narrow 920px desktop layout.
        const contentWidth = Math.min(Math.max(availableWidth - 48, 320), 1560);
        const fitScale = Math.min(Math.max(contentWidth / baseViewport.width, 0.85), 2.6);
        const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建 PDF 画布。');
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const renderTask = pdfPage.render({
          canvas: null,
          canvasContext: context,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ],
          viewport,
        });
        renderTaskRef.current.set(pageNumber, renderTask);
        await renderTask.promise;
        if (generation !== renderGenerationRef.current) return;
        renderedRef.current.set(pageNumber, 'ready');
        setRenderedPages((current) => new Set(current).add(pageNumber));
      } catch (reason) {
        const message = readableError(reason);
        if (
          generation === renderGenerationRef.current &&
          !message.includes('RenderingCancelledException')
        ) {
          setError(message);
        }
      } finally {
        renderTaskRef.current.delete(pageNumber);
        if (renderedRef.current.get(pageNumber) === 'rendering') {
          renderedRef.current.delete(pageNumber);
        }
      }
    },
    [availableWidth, zoom],
  );

  useEffect(() => {
    const scrollViewport = viewportRef.current;
    if (!scrollViewport || !pageCount || !availableWidth) return;
    renderGenerationRef.current += 1;
    renderedRef.current.clear();
    setRenderedPages(new Set());
    for (const task of renderTaskRef.current.values()) task.cancel();
    renderTaskRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (Number.isInteger(pageNumber)) void renderPage(pageNumber);
        }
      },
      { root: scrollViewport, rootMargin: '140% 0px', threshold: 0.01 },
    );
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const pageElement = pageRef.current[pageNumber];
      if (pageElement) observer.observe(pageElement);
    }
    return () => observer.disconnect();
  }, [availableWidth, pageCount, renderPage, zoom]);

  const releaseDistantPages = useCallback(
    (centerPage: number) => {
      for (const [pageNumber, state] of renderedRef.current) {
        if (state === 'ready' && Math.abs(pageNumber - centerPage) > RENDER_WINDOW) {
          clearPage(pageNumber);
        }
      }
    },
    [clearPage],
  );

  const syncCurrentPage = useCallback(() => {
    const scrollViewport = viewportRef.current;
    if (!scrollViewport) return;
    const position = scrollViewport.scrollTop + 36;
    let visiblePage = 1;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const element = pageRef.current[pageNumber];
      if (!element || element.offsetTop > position) break;
      visiblePage = pageNumber;
    }
    setCurrentPage(visiblePage);
    setPageInput(String(visiblePage));
    releaseDistantPages(visiblePage);
  }, [pageCount, releaseDistantPages]);

  const jumpToPage = useCallback(
    (value: number) => {
      const targetPage = clampPage(value, pageCount);
      const scrollViewport = viewportRef.current;
      const target = pageRef.current[targetPage];
      if (!scrollViewport || !target) return;
      scrollViewport.scrollTo({ behavior: 'smooth', top: Math.max(target.offsetTop - 18, 0) });
      setCurrentPage(targetPage);
      setPageInput(String(targetPage));
      void renderPage(targetPage);
    },
    [pageCount, renderPage],
  );

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  return (
    <section className={styles.pdfReader}>
      <div className={styles.pdfReaderToolbar}>
        <div className={styles.pdfReaderTitle}>
          <span>PDF 连续阅读</span>
          <strong>{title}</strong>
        </div>
        <div className={styles.pdfReaderControls}>
          <span className={styles.pdfReaderPageIndicator}>
            第 {currentPage} / {pageCount || '—'} 页
          </span>
          <label>
            跳至
            <input
              aria-label="跳转页码"
              inputMode="numeric"
              min={1}
              onBlur={() => jumpToPage(Number(pageInput))}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpToPage(Number(pageInput));
              }}
              type="number"
              value={pageInput}
            />
            页
          </label>
          <span className={styles.pdfReaderDivider} />
          <button
            aria-label="缩小页面"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
            type="button"
          >
            −
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            aria-label="放大页面"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
            type="button"
          >
            +
          </button>
        </div>
      </div>
      <div className={styles.pdfCanvasViewport} onScroll={syncCurrentPage} ref={viewportRef}>
        {loading ? <p className={styles.pdfReaderStatus}>正在加载原卷…</p> : null}
        {error ? <p className={styles.pdfReaderError}>{error}</p> : null}
        {pageCount ? (
          <div className={styles.pdfPages}>
            {Array.from({ length: pageCount }, (_, index) => {
              const pageNumber = index + 1;
              const isRendered = renderedPages.has(pageNumber);
              return (
                <div
                  className={`${styles.pdfPage} ${isRendered ? styles.pdfPageReady : ''}`}
                  data-page-number={pageNumber}
                  key={pageNumber}
                  ref={(element) => {
                    pageRef.current[pageNumber] = element;
                  }}
                  style={{ aspectRatio: pageRatio }}
                >
                  <span className={styles.pdfPageLoading}>正在渲染第 {pageNumber} 页…</span>
                  <canvas
                    aria-label={`${title}，第 ${pageNumber} 页`}
                    className={styles.pdfCanvas}
                    ref={(element) => {
                      canvasRef.current[pageNumber] = element;
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <footer className={styles.pdfReaderFooter}>
        <span>在试卷区域内向上或向下滚动即可连续阅读。</span>
        <a href={src} rel="noreferrer" target="_blank">
          打开原始 PDF
        </a>
      </footer>
    </section>
  );
}
