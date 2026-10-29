import React, { useEffect, useRef, useState } from 'react';
import { interpolate } from '../lib/i18n.mjs';

const ZOOM_LEVELS = [0.75, 1, 1.5, 2];
const MAX_PREVIEW_PIXELS = 8_000_000;

/**
 * Full-page inspection uses the SAME browser-local PDF.js source as the
 * thumbnail list. Render only the visible page, cap its canvas memory, and
 * cancel/dispose that bitmap on navigation, resizing, zooming and dismissal.
 * This is a source-page visual inspection, not a new PDF transformation.
 */
export default function PageZoomDialog({
  source, pageRef, position, pageCount, getPreviewDoc, locale, t,
  watermarkPreview, onClose, onNavigate,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('loading');
  const [retryVersion, setRetryVersion] = useState(0);
  const [size, setSize] = useState(() => ({
    width: window.innerWidth, height: window.innerHeight,
  }));

  useEffect(() => {
    const focusedBeforeOpen = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const resize = () => setSize(previous =>
      previous.width === window.innerWidth && previous.height === window.innerHeight
        ? previous : { width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('resize', resize);
      if (focusedBeforeOpen?.isConnected) focusedBeforeOpen.focus();
    };
  }, []);

  // Moving to the next page should start fitted, not inherit a large zoom
  // and unexpectedly display only a cropped region of another page.
  useEffect(() => setZoom(1), [pageRef.id]);

  useEffect(() => {
    let cancelled = false;
    let renderTask;
    let pdfPage;
    const canvas = canvasRef.current;
    setStatus('loading');
    (async () => {
      if (!canvas || !source) throw new Error('PDF source missing.');
      const doc = await getPreviewDoc(source);
      if (cancelled) return;
      pdfPage = await doc.getPage(pageRef.pageIndex + 1);
      if (cancelled) return;
      const rotation = ((pdfPage.rotate + pageRef.rotation) % 360 + 360) % 360;
      const original = pdfPage.getViewport({ scale: 1, rotation });
      const availableWidth = Math.max(200, Math.min(940, size.width - 58));
      const availableHeight = Math.max(210, Math.min(1020, size.height - 215));
      const fitScale = Math.min(availableWidth / original.width, availableHeight / original.height, 2);
      const viewport = pdfPage.getViewport({ scale: fitScale * zoom, rotation });
      // An image-heavy landscape page at 2x zoom must not allocate 100+ MB
      // just because the device has an unusually high DPR.
      const density = Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2,
        Math.sqrt(MAX_PREVIEW_PIXELS / (viewport.width * viewport.height))));
      canvas.width = Math.max(1, Math.floor(viewport.width * density));
      canvas.height = Math.max(1, Math.floor(viewport.height * density));
      canvas.style.width = Math.round(viewport.width) + 'px';
      canvas.style.height = Math.round(viewport.height) + 'px';
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Preview canvas is unavailable.');
      context.setTransform(density, 0, 0, density, 0, 0);
      renderTask = pdfPage.render({ canvasContext: context, canvas, viewport });
      await renderTask.promise;
      if (!cancelled) setStatus('ready');
    })().catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') {
        // A failed render may have allocated a large backing bitmap. Discard
        // it before showing Retry; the PDF source and page edits stay intact.
        canvas.width = 0;
        canvas.height = 0;
        setStatus('error');
      }
    }).finally(() => { pdfPage?.cleanup(); });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      // A hidden canvas still owns its pixels. Free the backing store now.
      if (canvas) {
        canvas.width = 0; canvas.height = 0;
        canvas.style.width = ''; canvas.style.height = '';
      }
    };
  }, [source, pageRef.pageIndex, pageRef.rotation, getPreviewDoc,
    zoom, size.width, size.height, retryVersion]);

  const changeZoom = (direction) => {
    setZoom(previous => {
      const index = ZOOM_LEVELS.indexOf(previous);
      return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))];
    });
  };

  const handleKeys = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowLeft' && position > 1) {
      event.preventDefault();
      onNavigate(-1);
    } else if (event.key === 'ArrowRight' && position < pageCount) {
      event.preventDefault();
      onNavigate(1);
    } else if (event.key === 'Tab') {
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
        event.preventDefault();
        buttons[0].focus();
      }
    }
  };

  return (
    <div className="page-zoom-backdrop" data-testid="page-zoom-backdrop"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="page-zoom-dialog" ref={dialogRef} data-testid="page-zoom-dialog"
        role="dialog" aria-modal="true" aria-labelledby="page-zoom-title"
        aria-describedby="page-zoom-hint" onKeyDown={handleKeys}>
        <header className="page-zoom-header">
          <div className="page-zoom-heading">
            <h2 id="page-zoom-title">{interpolate(t.previewTitle, { n: position, total: pageCount })}</h2>
            <p title={source.name}>{source.name} · {interpolate(t.previewSourcePage, { n: pageRef.pageIndex + 1 })}</p>
          </div>
          <button ref={closeRef} type="button" className="page-zoom-close"
            data-testid="page-zoom-close" aria-label={t.previewClose} onClick={onClose}>×</button>
        </header>
        <div className="page-zoom-toolbar">
          <button type="button" data-testid="page-zoom-previous"
            disabled={position <= 1} onClick={() => onNavigate(-1)}>{t.previewPrevious}</button>
          <button type="button" data-testid="page-zoom-next"
            disabled={position >= pageCount} onClick={() => onNavigate(1)}>{t.previewNext}</button>
          <span className="page-zoom-toolbar-spacer"/>
          <button type="button" data-testid="page-zoom-out" aria-label={t.previewZoomOut}
            disabled={zoom === ZOOM_LEVELS[0]} onClick={() => changeZoom(-1)}>−</button>
          <button type="button" data-testid="page-zoom-reset"
            onClick={() => setZoom(1)} aria-label={t.previewFit}>{Math.round(zoom * 100)}%</button>
          <button type="button" data-testid="page-zoom-in" aria-label={t.previewZoomIn}
            disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            onClick={() => changeZoom(1)}>＋</button>
        </div>
        <div className="page-zoom-stage" data-testid="page-zoom-stage">
          <div className="page-zoom-sheet">
            <canvas ref={canvasRef} data-testid="page-zoom-canvas" role="img"
              aria-label={interpolate(t.previewTitle, { n: position, total: pageCount })}
              style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}/>
            {watermarkPreview && status === 'ready' &&
              <span className="page-watermark-preview" aria-hidden="true">{watermarkPreview}</span>}
          </div>
          {status === 'loading' && <p className="page-zoom-message" role="status">{t.previewLoading}</p>}
          {status === 'error' && <div className="page-zoom-message" role="alert">
            <p>{t.previewFail}</p>
            <button type="button" className="button button-secondary button-small"
              data-testid="page-zoom-retry" onClick={() => {
                setStatus('loading');
                setRetryVersion(value => value + 1);
              }}>{t.previewRetry}</button>
          </div>}
        </div>
        <p id="page-zoom-hint" className="page-zoom-hint">{t.previewHint}</p>
      </section>
    </div>
  );
}
