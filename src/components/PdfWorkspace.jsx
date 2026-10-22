import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { LIMITS, composePdf, isSupportedFile, readSourceFile, saveDownload } from '../lib/pdfEngine.mjs';
import { MAX_WATERMARK_CHARS } from '../lib/watermark.mjs';
import { workspaceCopy, interpolate, translateProcessingError } from '../lib/i18n.mjs';
import {
  movePage, movePageGroup, shiftPage, rotatePages, deletePages, parsePageRanges, chunkPageRanges,
  getRangePages, makeHistoryState, commitHistory, undoHistory, redoHistory,
} from '../lib/pageOperations.mjs';

function PageThumbnail({ source, pageRef, getPreviewDoc, locale, t, watermarkPreview }) {
  const targetRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !source) return;
    let cancelled = false;
    let renderTask;
    (async () => {
      const documentProxy = await getPreviewDoc(source);
      if (cancelled) return;
      const pdfPage = await documentProxy.getPage(pageRef.pageIndex + 1);
      if (cancelled) return;
      const rotation = (pdfPage.rotate + pageRef.rotation) % 360;
      const original = pdfPage.getViewport({ scale: 1, rotation });
      const scale = Math.min(154 / original.width, 190 / original.height, 1);
      const viewport = pdfPage.getViewport({ scale, rotation });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(density, 0, 0, density, 0, 0);
      renderTask = pdfPage.render({ canvasContext: context, canvas, viewport });
      try { await renderTask.promise; }
      finally { pdfPage.cleanup(); }
    })().catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') setFailed(true);
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [getPreviewDoc, pageRef.pageIndex, pageRef.rotation, source, visible]);

  return (
    <div className="page-preview" ref={targetRef}>
      {failed ? <div className="preview-fallback" aria-label={t.previewFail}>{t.previewFail}</div> : (
        <canvas ref={canvasRef} role="img" aria-label={locale === 'zh' ? `${source?.name ?? 'PDF'} 第 ${pageRef.pageIndex + 1} 页预览` : `${source?.name ?? 'PDF'} page ${pageRef.pageIndex + 1} preview`} />
      )}
      {!visible && <div className="preview-loading" aria-hidden="true" />}
      {watermarkPreview && <span className="page-watermark-preview" aria-hidden="true">{watermarkPreview}</span>}
    </div>
  );
}

export default function PdfWorkspace({ mode = 'workspace', locale = 'en' }) {
  const t = workspaceCopy[locale] ?? workspaceCopy.en;
  const inputRef = useRef(null);
  const lastSelectedIndex = useRef(null);
  const previewDocuments = useRef(new Map());
  const [sources, setSources] = useState([]);
  const [history, setHistory] = useState(() => makeHistoryState());
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState(null);
  const [tab, setTab] = useState(mode === 'split-pdf' ? 'split' : 'organize');
  const [splitMode, setSplitMode] = useState('ranges');
  const [ranges, setRanges] = useState('1-2, 3');
  const [chunkSize, setChunkSize] = useState('1');
  const [exportSettingsOpen, setExportSettingsOpen] = useState(mode === 'watermark-pdf');
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const pages = history.present;
  const watermark = { enabled: watermarkEnabled, text: watermarkText };
  const watermarkPreview = watermarkEnabled && watermarkText.trim() ? watermarkText.trim() : null;
  const selectedCount = selected.size;
  const bytesInMemory = useMemo(() => sources.reduce((total, item) => total + item.inputSize, 0), [sources]);
  const sourceLookup = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const splitEstimate = useMemo(() => {
    if (!pages.length) return null;
    try {
      return splitMode === 'ranges' ? parsePageRanges(ranges, pages.length).length : chunkPageRanges(pages.length, Number(chunkSize)).length;
    } catch (_error) { return null; }
  }, [pages.length, splitMode, ranges, chunkSize]);

  // Retain PDF.js loading tasks so the worker and its memory are truly released on reset/unmount.
  const getPreviewDoc = useCallback((source) => {
    let entry = previewDocuments.current.get(source.id);
    if (!entry) {
      entry = { task: null, cancelled: false, promise: null };
      const current = entry;
      entry.promise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
        if (current.cancelled) throw new Error('Preview was cleared.');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        current.task = pdfjs.getDocument({ data: new Uint8Array(source.bytes), useSystemFonts: true });
        return current.task.promise;
      }).catch((reason) => {
        if (previewDocuments.current.get(source.id) === current) previewDocuments.current.delete(source.id);
        throw reason;
      });
      previewDocuments.current.set(source.id, entry);
    }
    return entry.promise;
  }, []);
  const releasePreviewDocuments = useCallback(() => {
    for (const entry of previewDocuments.current.values()) {
      entry.cancelled = true;
      entry.task?.destroy().catch(() => {});
    }
    previewDocuments.current.clear();
  }, []);
  useEffect(() => () => releasePreviewDocuments(), [releasePreviewDocuments]);

  const resetSelection = () => { setSelected(new Set()); lastSelectedIndex.current = null; };
  const commit = (operation, preserveSelection = false) => {
    setHistory((previous) => commitHistory(previous, operation(previous.present)));
    if (!preserveSelection) resetSelection();
    setNotice('');
    setError('');
  };

  const addFiles = async (incoming) => {
    const items = [...(incoming ?? [])];
    if (!items.length || busy) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      if (sources.length + items.length > LIMITS.maxFiles) throw new Error(interpolate(t.errorFiles, { n: LIMITS.maxFiles }));
      if (items.some((file) => !isSupportedFile(file))) throw new Error(t.errorTypes);
      const incomingBytes = items.reduce((total, file) => total + file.size, 0);
      if (bytesInMemory + incomingBytes > LIMITS.maxCombinedBytes) throw new Error(t.errorCombined);
      const nextSources = [];
      const nextPages = [];
      for (const file of items) {
        const source = await readSourceFile(file);
        if (pages.length + nextPages.length + source.pageCount > LIMITS.maxPages) throw new Error(interpolate(t.errorPages, { n: LIMITS.maxPages }));
        nextSources.push(source);
        for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex++) {
          nextPages.push({ id: crypto.randomUUID(), sourceId: source.id, pageIndex, rotation: 0 });
        }
      }
      if (!pages.length) {
        const count = nextPages.length;
        setRanges(count <= 2 ? `1-${count}` : `1-2, 3-${count}`);
      }
      setSources((previous) => [...previous, ...nextSources]);
      setHistory((previous) => commitHistory(previous, [...previous.present, ...nextPages]));
      resetSelection();
      setNotice(locale === 'en'
        ? `Added ${nextSources.length} ${nextSources.length === 1 ? 'file' : 'files'} and ${nextPages.length} ${nextPages.length === 1 ? 'page' : 'pages'}.`
        : interpolate(t.loaded, { files: nextSources.length, pages: nextPages.length }));
    } catch (reason) {
      setError(translateProcessingError(reason instanceof Error ? reason.message : t.errorGeneric, locale));
    } finally { setBusy(false); }
  };

  const withBusy = async (task) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await task(); }
    catch (reason) { setError(translateProcessingError(reason instanceof Error ? reason.message : t.errorGeneric, locale)); }
    finally { setBusy(false); }
  };

  const exportAll = () => withBusy(async () => {
    if (!pages.length) throw new Error(t.noFile);
    saveDownload(await composePdf(sources, pages, { watermark }), 'plainmile-organized.pdf');
    setNotice(t.exported);
  });
  const exportSelected = () => withBusy(async () => {
    const chosen = pages.filter((page) => selected.has(page.id));
    if (!chosen.length) throw new Error(t.selectionNeeded);
    saveDownload(await composePdf(sources, chosen, { watermark }), 'plainmile-extracted.pdf');
    setNotice(interpolate(t.extracted, { pages: chosen.length }));
  });
  const splitIntoZip = () => withBusy(async () => {
    if (!pages.length) throw new Error(t.noFile);
    const pieces = splitMode === 'ranges'
      ? parsePageRanges(ranges, pages.length)
      : chunkPageRanges(pages.length, Number(chunkSize));
    const zip = new JSZip();
    for (let index = 0; index < pieces.length; index++) {
      const range = pieces[index];
      const contents = await composePdf(sources, getRangePages(pages, range), { watermark });
      zip.file(`part-${String(index + 1).padStart(2, '0')}-pages-${range.start}-${range.end}.pdf`, contents);
    }
    saveDownload(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), 'plainmile-split-pdfs.zip', 'application/zip');
    setNotice(interpolate(t.zipped, { files: pieces.length }));
  });

  const toggleSelection = (id, index, shift) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (shift && lastSelectedIndex.current !== null) {
        const start = Math.min(index, lastSelectedIndex.current);
        const end = Math.max(index, lastSelectedIndex.current);
        for (let n = start; n <= end; n++) next.add(pages[n].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastSelectedIndex.current = index;
  };

  const clearAll = () => {
    setWatermarkEnabled(false); setWatermarkText(''); setExportSettingsOpen(mode === 'watermark-pdf');
    setSources([]); setHistory(makeHistoryState()); resetSelection(); setError(''); setNotice(t.cleared);
    releasePreviewDocuments();
  };

  const onMoveDrop = (event, targetId) => {
    event.preventDefault();
    if (event.dataTransfer.files?.length) { void addFiles(event.dataTransfer.files); return; }
    const text = event.dataTransfer.getData('application/x-plainmile-pages');
    let group = [];
    try { group = JSON.parse(text); } catch (_error) { /* fall back to the source page */ }
    if (!Array.isArray(group) || !group.length) group = dragged ? [dragged] : [];
    if (group.length) commit((previous) => group.length === 1 ? movePage(previous, group[0], targetId) : movePageGroup(previous, group, targetId));
    setDragged(null);
  };
  const largeWorkspace = pages.length >= 250 || bytesInMemory >= 100 * 1024 * 1024;
  const selectedText = locale === 'zh' ? `${selectedCount} ${t.selected}` : `${selectedCount} ${selectedCount === 1 ? 'page' : 'pages'} selected`;
  const pageName = (number) => locale === 'zh' ? `第 ${number} 页` : `Page ${number}`;

  return (
    <div className="pdf-workspace" data-testid="pdf-workspace">
      <div className="workspace-bar">
        <div className="workspace-heading"><span className="workspace-app-icon" aria-hidden="true">▤</span><div><strong>{t.app}</strong><span>{t.local}</span></div></div>
        <span className="workspace-status"><span className="status-dot" aria-hidden="true" />{t.local}</span>
      </div>
      <div className="workspace-controls">
        <div className="tool-switch" role="tablist" aria-label={t.app}>
          <button type="button" role="tab" aria-selected={tab === 'organize'} className={tab === 'organize' ? 'active' : ''} onClick={() => setTab('organize')}>{t.organize}</button>
          <button type="button" role="tab" aria-selected={tab === 'split'} className={tab === 'split' ? 'active' : ''} onClick={() => setTab('split')}>{t.split}</button>
        </div>
        <div className="workspace-primary-buttons">
          <input ref={inputRef} data-testid="file-input" aria-label={t.add} className="hidden-input" type="file" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }} />
          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>＋ {t.add}</button>
          {pages.length > 0 && <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => setExportSettingsOpen((value) => !value)} aria-expanded={exportSettingsOpen} aria-controls="export-options-panel" data-testid="export-options-button">{t.exportOptions}{watermarkEnabled ? ` \u00b7 ${t.watermarkOn}` : ""}</button>}
          <button className="button button-primary button-small" type="button" disabled={!pages.length || busy} onClick={exportAll} aria-label={t.export}>{busy ? t.working : t.export} ↓</button>
        </div>
      </div>
      {pages.length > 0 && exportSettingsOpen && (
        <section id="export-options-panel" className="export-options-panel" aria-label={t.exportOptions}>
          <div className="export-options-header"><strong>{t.exportOptions}</strong><span>{t.exportOptionsHint}</span></div>
          <label className="option-radio export-watermark-switch">
            <input type="checkbox" data-testid="watermark-toggle" checked={watermarkEnabled} disabled={busy} onChange={(event) => { setWatermarkEnabled(event.target.checked); setError(''); }} />
            <span>{t.watermarkLabel}</span>
          </label>
          {watermarkEnabled && (
            <div className="watermark-fields">
              <label className="input-label" htmlFor="watermark-text">{t.watermarkTextLabel}</label>
              <input id="watermark-text" data-testid="watermark-text" type="text" maxLength={MAX_WATERMARK_CHARS} value={watermarkText} disabled={busy} onChange={(event) => { setWatermarkText(event.target.value); setError(''); }} placeholder={t.watermarkPlaceholder} />
              <p className="input-note" aria-live="polite">{watermarkText.trim() ? t.watermarkHelp : t.watermarkNeedsText}</p>
            </div>
          )}
        </section>
      )}
      <div className="workspace-content" onDragOver={(event) => { if (Array.from(event.dataTransfer.types ?? []).includes('Files')) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files?.length) { event.preventDefault(); void addFiles(event.dataTransfer.files); } }}>
        {error && <div className="notice notice-error" role="alert">{error}<button type="button" aria-label={t.dismiss} onClick={() => setError('')}>×</button></div>}
        {notice && <div className="notice notice-success" role="status">{notice}<button type="button" aria-label={t.dismiss} onClick={() => setNotice('')}>×</button></div>}
        {largeWorkspace && <p className="utility-note" data-testid="workspace-large-warning">{t.bigDocWarning}</p>}
        {!pages.length ? (
          <div className="dropzone" data-testid="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void addFiles(event.dataTransfer.files); }}>
            <div className="drop-icon" aria-hidden="true">＋</div>
            <h2>{t.dropTitle}</h2><p>{t.dropSub}</p>
            <button type="button" className="button button-primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? t.opening : t.choose}</button>
            <p className="drop-limits">{t.limits}</p><div className="empty-privacy">✓ {t.private}</div>
            {sources.length > 0 && <button type="button" className="button button-secondary button-small" onClick={clearAll} disabled={busy}>{t.reset}</button>}
          </div>
        ) : (
          <>
            <div className="workspace-subbar">
              <div className="file-count"><strong>{locale === 'zh' ? `${pages.length} 页` : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}</strong><span>{locale === 'zh' ? ` · 来自 ${sources.length} 个文件` : ` from ${sources.length} ${sources.length === 1 ? 'file' : 'files'}`}</span></div>
              <div className="history-buttons">
                <button type="button" disabled={!history.past.length || busy} onClick={() => { setHistory(undoHistory); resetSelection(); }} aria-label={t.undo} title={t.undo}>↶ {t.undo}</button>
                <button type="button" disabled={!history.future.length || busy} onClick={() => { setHistory(redoHistory); resetSelection(); }} aria-label={t.redo} title={t.redo}>↷ {t.redo}</button>
                <button type="button" disabled={busy} className="muted-danger" onClick={clearAll}>{t.clear}</button>
              </div>
            </div>
            {tab === 'organize' ? (
              <section aria-label={t.organize} className="pages-work-area">
                <div className="selection-toolbar">
                  <div className="selection-info"><strong>{selectedText}</strong><button type="button" onClick={() => { setSelected(new Set(pages.map((page) => page.id))); lastSelectedIndex.current = null; }}>{t.all}</button><button type="button" onClick={resetSelection} disabled={!selectedCount}>{t.none}</button></div>
                  <div className="page-action-buttons">
                    <button type="button" disabled={!selectedCount || busy} onClick={() => commit((previous) => rotatePages(previous, selected, -90), true)} aria-label={t.rotateLeft}>↶ {t.rotateLeft}</button>
                    <button type="button" disabled={!selectedCount || busy} onClick={() => commit((previous) => rotatePages(previous, selected, 90), true)} aria-label={locale === 'en' ? 'Rotate clockwise' : t.rotateRight}>↷ {t.rotateRight}</button>
                    <button type="button" disabled={!selectedCount || busy} onClick={exportSelected} aria-label={locale === 'en' ? 'Extract selected pages' : t.extract}>↗ {t.extract}</button>
                    <button type="button" disabled={!selectedCount || busy} className="muted-danger" onClick={() => commit((previous) => deletePages(previous, selected))} aria-label={locale === 'en' ? 'Delete selected pages' : t.del}>× {t.del}</button>
                  </div>
                </div>
                <div className="page-grid" data-testid="page-grid">
                  {pages.map((pageRef, index) => {
                    const source = sourceLookup.get(pageRef.sourceId);
                    return (
                      <div className={`page-tile ${selected.has(pageRef.id) ? 'is-selected' : ''} ${dragged === pageRef.id ? 'is-dragging' : ''}`} key={pageRef.id} data-testid="page-tile" data-original-page={pageRef.pageIndex + 1}
                        draggable={!busy} onDragStart={(event) => {
                          const ids = selected.has(pageRef.id) ? pages.filter((page) => selected.has(page.id)).map((page) => page.id) : [pageRef.id];
                          event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-plainmile-pages', JSON.stringify(ids));
                          setDragged(pageRef.id);
                        }}
                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.stopPropagation(); onMoveDrop(event, pageRef.id); }} onDragEnd={() => setDragged(null)}>
                        <label className="page-tile-checkbox"><input type="checkbox" checked={selected.has(pageRef.id)} onChange={(event) => toggleSelection(pageRef.id, index, Boolean(event.nativeEvent?.shiftKey))} aria-label={locale === 'zh' ? `${t.selectPage} ${index + 1} 页` : `Select page ${index + 1}`} /></label>
                        <div className="tile-sequence">{String(index + 1).padStart(2, '0')}</div>
                        <PageThumbnail source={source} pageRef={pageRef} getPreviewDoc={getPreviewDoc} locale={locale} t={t} watermarkPreview={watermarkPreview} />
                        <div className="tile-info" title={source?.name}><strong>{pageName(pageRef.pageIndex + 1)}</strong><small>{source?.name ?? t.document}</small></div>
                        <div className="tile-moves"><button type="button" disabled={index === 0 || busy} title={t.moveLeft.replace('{n}', index + 1)} aria-label={interpolate(t.moveLeft, { n: index + 1 })} onClick={() => commit((previous) => shiftPage(previous, pageRef.id, -1))}>←</button><span title={t.dragTitle} aria-hidden="true">⠿</span><button type="button" disabled={index === pages.length - 1 || busy} title={interpolate(t.moveRight, { n: index + 1 })} aria-label={interpolate(t.moveRight, { n: index + 1 })} onClick={() => commit((previous) => shiftPage(previous, pageRef.id, 1))}>→</button></div>
                      </div>
                    );
                  })}
                  <button type="button" className="add-more-tile" disabled={busy} onClick={() => inputRef.current?.click()}><span aria-hidden="true">＋</span>{t.addMore}</button>
                </div>
                <p className="page-grid-help">{t.dragHint}</p>
              </section>
            ) : (
              <section className="split-panel" aria-label={t.splitTitle}>
                <div className="split-intro"><div className="split-graphic" aria-hidden="true">1–3 <span>→</span> 4–6</div><h3>{t.splitTitle}</h3><p>{t.splitHint}</p></div>
                <div className="split-fields">
                  <label className="option-radio"><input type="radio" name="split-method" checked={splitMode === 'ranges'} onChange={() => setSplitMode('ranges')} />{t.byRanges}</label>
                  <label className="input-label" htmlFor="ranges-input">{t.pageRanges}</label>
                  <input id="ranges-input" value={ranges} onChange={(event) => setRanges(event.target.value)} disabled={splitMode !== 'ranges' || busy} placeholder="1-3, 4-6, 7" />
                  <p className="input-note">{t.rangeHint}</p>
                  <label className="option-radio option-divider"><input type="radio" name="split-method" checked={splitMode === 'chunks'} onChange={() => setSplitMode('chunks')} />{t.every}</label>
                  <label className="input-label" htmlFor="chunk-input">{t.perFile}</label>
                  <input id="chunk-input" type="number" min="1" max={pages.length} step="1" value={chunkSize} onChange={(event) => setChunkSize(event.target.value)} disabled={splitMode !== 'chunks' || busy} />
                  <div className="split-estimate" aria-live="polite">{splitEstimate === null ? t.invalidRange : interpolate(t.estimate, { files: splitEstimate })}</div>
                  <button type="button" className="button button-primary split-download" onClick={splitIntoZip} disabled={busy}>{busy ? t.creating : t.downloadZip} ↓</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <div className="workspace-foot"><span>✓ {t.foot}</span><span>{t.footLimit}</span></div>
    </div>
  );
}
