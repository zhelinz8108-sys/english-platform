'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import styles from '@/components/ap-library/ap-library.module.css';

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;

function clampPage(value: number, pageCount: number) {
  return Math.min(Math.max(Math.trunc(value), 1), Math.max(pageCount, 1));
}

function readableError(reason: unknown) {
  return reason instanceof Error ? reason.message : '无法加载这份 PDF。';
}

export function AlevelPdfReader({ src, title }: { src: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
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
    setPage(1);
    setPageInput('1');
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
        documentRef.current = pdf;
        setPageCount(pdf.numPages);
        setPage((current) => clampPage(current, pdf.numPages));
      } catch (reason) {
        if (!cancelled) setError(readableError(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      if (loadingTask) void loadingTask.destroy();
      const pdf = documentRef.current;
      documentRef.current = null;
      if (pdf) void pdf.cleanup();
    };
  }, [src]);

  useEffect(() => setPageInput(String(page)), [page]);

  useEffect(() => {
    const pdf = documentRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !availableWidth) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    setRendering(true);

    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const contentWidth = Math.max(availableWidth - 48, 320);
        const fitScale = Math.min(Math.max(contentWidth / baseViewport.width, 0.85), 1.9);
        const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建 PDF 画布。');
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
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
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (reason) {
        const message = readableError(reason);
        if (!cancelled && !message.includes('RenderingCancelledException')) setError(message);
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [availableWidth, page, zoom]);

  const updatePage = (value: number) => setPage(clampPage(value, pageCount));

  return (
    <section className={styles.pdfReader}>
      <div className={styles.pdfReaderToolbar}>
        <div className={styles.pdfReaderTitle}>
          <span>PDF 阅读</span>
          <strong>{title}</strong>
        </div>
        <div className={styles.pdfReaderControls}>
          <button
            disabled={page <= 1 || loading}
            onClick={() => updatePage(page - 1)}
            type="button"
          >
            上一页
          </button>
          <label>
            第
            <input
              aria-label="跳转页码"
              inputMode="numeric"
              min={1}
              onBlur={() => updatePage(Number(pageInput))}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') updatePage(Number(pageInput));
              }}
              type="number"
              value={pageInput}
            />
            页 / {pageCount || '—'}
          </label>
          <button
            disabled={pageCount === 0 || page >= pageCount}
            onClick={() => updatePage(page + 1)}
            type="button"
          >
            下一页
          </button>
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
      <div className={styles.pdfCanvasViewport} ref={viewportRef}>
        {loading ? <p className={styles.pdfReaderStatus}>正在加载原卷…</p> : null}
        {error ? <p className={styles.pdfReaderError}>{error}</p> : null}
        <canvas
          aria-label={`${title}，第 ${page} 页`}
          className={styles.pdfCanvas}
          ref={canvasRef}
        />
        {rendering && !error ? (
          <p className={styles.pdfReaderStatus}>正在渲染第 {page} 页…</p>
        ) : null}
      </div>
      <footer className={styles.pdfReaderFooter}>
        <span>仅显示当前页，不显示缩略图栏。</span>
        <a href={src} rel="noreferrer" target="_blank">
          打开原始 PDF
        </a>
      </footer>
    </section>
  );
}
