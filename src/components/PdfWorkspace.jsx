import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import UnsavedNavigationGuard from './UnsavedNavigationGuard.jsx';
import PageZoomDialog from './PageZoomDialog.jsx';
import { LIMITS, composePdf, pristinePdfBytes, isSupportedFile, readSourceFile, reflowImageSources, saveDownload, temporaryWorkspaceId, createBlankPageSource, retainedSourceBytes, retainedSourcesBytes } from '../lib/pdfEngine.mjs';
import { sanitizeFilename, workspaceFilenameStem } from '../lib/utilityCore.mjs';
import { IMAGE_PDF_LAYOUT_DEFAULT, sameImagePdfLayout } from '../lib/imagePdfLayout.mjs';
import { MAX_WATERMARK_CHARS } from '../lib/watermark.mjs';
import { workspaceCopy, interpolate, translateProcessingError } from '../lib/i18n.mjs';
import {
  movePage, movePageGroup, pageDropSide, moveSelectedPagesToPosition, shiftPage, rotatePages, deletePages, duplicatePages, insertPageAfter, parsePageRanges, pageIdsForRanges, chunkPageRanges, splitChunkBatch,
  getRangePages, splitCoversAllPagesExactlyOnce, splitCoverageDetails, splitCutsFromRanges, splitRangesFromCuts, reversePages, sortPagesByFilename, interleaveDuplexPages, groupPagesBySource, pageIdsForParity, invertPageIdSelection, makeHistoryState, commitHistory, undoHistory, redoHistory, enforceSplitZipBudget, countActiveSources, historyReferencedSourceIds,
} from '../lib/pageOperations.mjs';

function PageThumbnail({ source, pageRef, getPreviewDoc, locale, t, watermarkPreview, onOpen, outputPosition, busy }) {
  const targetRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      // Load only thumbnails near the viewport, and release them after scrolling away.
      // The page-preview container has a fixed height, so unloading cannot move the scrollbar.
      const entry = entries.find((item) => item.target === target);
      if (entry) setVisible(entry.isIntersecting);
    }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !source) return;
    let cancelled = false;
    let renderTask;
    // Capture the mounted node before awaiting a PDF.js worker. A quick scroll
    // can unmount the canvas while getPreviewDoc() is still loading.
    const canvas = canvasRef.current;
    setFailed(false); // Retry on re-enter and after a rotation changes the page.
    (async () => {
      const documentProxy = await getPreviewDoc(source);
      if (cancelled) return;
      const pdfPage = await documentProxy.getPage(pageRef.pageIndex + 1);
      if (cancelled) { pdfPage.cleanup(); return; }
      try {
        const rotation = (pdfPage.rotate + pageRef.rotation) % 360;
        const original = pdfPage.getViewport({ scale: 1, rotation });
        const scale = Math.min(154 / original.width, 190 / original.height, 1);
        const viewport = pdfPage.getViewport({ scale, rotation });
        if (!canvas || cancelled) return;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable.');
        const density = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * density);
        canvas.height = Math.ceil(viewport.height * density);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(density, 0, 0, density, 0, 0);
        renderTask = pdfPage.render({ canvasContext: context, canvas, viewport });
        await renderTask.promise;
      } finally { pdfPage.cleanup(); }
    })().catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      // Releasing the backing store is intentional: hiding the canvas with CSS
      // alone retains its bitmap, which adds up when a user scrolls 320+ pages.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.style.width = '';
        canvas.style.height = '';
      }
    };
  }, [getPreviewDoc, pageRef.pageIndex, pageRef.rotation, source, visible]);

  return (
    <button type="button" className="page-preview" ref={targetRef}
      data-testid="page-preview-open" disabled={busy || !source}
      aria-label={interpolate(t.previewOpen, { n: outputPosition })}
      title={interpolate(t.previewOpen, { n: outputPosition })}
      onClick={() => onOpen(pageRef.id)}>
      {visible && <canvas ref={canvasRef} width={0} height={0} style={failed ? { display: 'none' } : undefined} role="img" aria-label={locale === 'zh' ? `${source?.name ?? 'PDF'} 第 ${pageRef.pageIndex + 1} 页预览` : `${source?.name ?? 'PDF'} page ${pageRef.pageIndex + 1} preview`} />}
      {visible && failed && <div className="preview-fallback" aria-label={t.previewFail}>{t.previewFail}</div>}
      {!visible && <div className="preview-loading" aria-hidden="true" />}
      {watermarkPreview && <span className="page-watermark-preview" aria-hidden="true">{watermarkPreview}</span>}
      <span className="preview-expand-mark" aria-hidden="true">⤢</span>
    </button>
  );
}

export default function PdfWorkspace({ mode = 'workspace', locale = 'en' }) {
  const t = workspaceCopy[locale] ?? workspaceCopy.en;
  const inputRef = useRef(null);
  const lastSelectedIndex = useRef(null);
  const lastGroupedSelection = useRef(null);
  // HTML drag events can arrive before React commits setDragged(). The ref
  // synchronously carries the whole selected page group across that turn.
  const draggedPageIdsRef = useRef(null);
  const pageGridRef = useRef(null);
  const previewDocuments = useRef(new Map());
  const splitAbortRef = useRef(null);
  const exportAbortRef = useRef(null);
  const layoutAbortRef = useRef(null);
  const importAbortRef = useRef(null);
  const visualConfirmRef = useRef(null);
  const [sources, setSources] = useState([]);
  const [history, setHistory] = useState(() => makeHistoryState());
  const [selected, setSelected] = useState(() => new Set());
  const [selectionRanges, setSelectionRanges] = useState('');
  const [moveTargetInput, setMoveTargetInput] = useState('');
  const [movePlacement, setMovePlacement] = useState('before');
  const [jumpInput, setJumpInput] = useState('');
  const [pendingJump, setPendingJump] = useState(null);
  const [previewPageId, setPreviewPageId] = useState(null);
  const [downloadNameInput, setDownloadNameInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importCancelling, setImportCancelling] = useState(false);
  // `setBusy` is a UI update, not a lock. Same-tick file drops can both read
  // stale busy=false and individually pass limits before either import finishes.
  const busyRef = useRef(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const pendingReimportRef = useRef(null);
  const [pendingReimportCount, setPendingReimportCount] = useState(0);
  const [splitProgress, setSplitProgress] = useState(null);
  const [splitCancelling, setSplitCancelling] = useState(false);
  const [exportProgress, setExportProgress] = useState(null);
  const [exportCancelling, setExportCancelling] = useState(false);
  const [layoutProgress, setLayoutProgress] = useState(null);
  const [layoutCancelling, setLayoutCancelling] = useState(false);
  const [imageLayout, setImageLayout] = useState(() => ({ ...IMAGE_PDF_LAYOUT_DEFAULT }));
  const [lastDownloadedRevision, setLastDownloadedRevision] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [pageView, setPageView] = useState('order');
  const [collapsedSources, setCollapsedSources] = useState(() => new Set());
  const [tab, setTab] = useState(mode === 'split-pdf' ? 'split' : 'organize');
  const [splitMode, setSplitMode] = useState('ranges');
  const [ranges, setRanges] = useState('');
  const [chunkSize, setChunkSize] = useState('');
  const [splitBatchIndex, setSplitBatchIndex] = useState(0);
  const [pendingVisualCut, setPendingVisualCut] = useState(null);
  const [visualSplitOpen, setVisualSplitOpen] = useState(false);
  // A cut can be clicked deep inside a long scrollable preview grid. If the
  // current manual ranges need confirmation, move focus (and scroll) to the
  // explanation instead of leaving a newly disabled cut button out of context.
  useEffect(() => {
    if (pendingVisualCut !== null) visualConfirmRef.current?.focus();
  }, [pendingVisualCut]);
  const [exportSettingsOpen, setExportSettingsOpen] = useState(mode === 'watermark-pdf');
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const pages = history.present;
  const watermark = { enabled: watermarkEnabled, text: watermarkText };
  const watermarkPreview = watermarkEnabled && watermarkText.trim() ? watermarkText.trim() : null;
  const selectedCount = selected.size;
  const bytesInMemory = useMemo(() => retainedSourcesBytes(sources), [sources]);
  const sourceLookup = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const zoomPageIndex = pages.findIndex(page => page.id === previewPageId);
  const zoomPageRef = zoomPageIndex >= 0 ? pages[zoomPageIndex] : null;
  const zoomSource = zoomPageRef ? sourceLookup.get(zoomPageRef.sourceId) : null;
  const navigateZoom = (step) => {
    const target = pages[zoomPageIndex + step];
    if (target) setPreviewPageId(target.id);
  };
  const sourceGroups = useMemo(() => groupPagesBySource(pages), [pages]);
  // Judge active photo pages by their own original layout. A previously deleted
  // photo can reappear after Undo, even when newer images use different paper.
  // A single global "last applied" setting cannot detect that stale page.
  const activeImageSources = new Set(pages.filter(page => sourceLookup.get(page.sourceId)?.isImage).map(page => page.sourceId));
  const imageLayoutDirty = mode === 'image-to-pdf' && [...activeImageSources]
    .some(id => !sameImagePdfLayout(sourceLookup.get(id)?.imageLayout, imageLayout));
  const activeNames = useMemo(() => {
    const ids = new Set(pages.map(page => page.sourceId));
    return sources.filter(source => ids.has(source.id) && !source.isGeneratedBlank).map(source => source.name);
  }, [pages, sources]);
  const fileBase = activeNames.length === 1 ? sanitizeFilename(activeNames[0]) :
    activeNames.length ? `plainmile-${activeNames.length}-files` : 'plainmile-pages';
  const defaultFilename = `${fileBase}-${mode === 'image-to-pdf' ? 'images' : 'organized'}.pdf`;
  // An optional name must never change the PDF bytes, page order, or privacy.
  const userDownloadStem = workspaceFilenameStem(downloadNameInput);
  const filename = userDownloadStem ? `${userDownloadStem}.pdf` : defaultFilename;
  const outputBase = userDownloadStem || fileBase;
  const activeSourceCount = useMemo(() => countActiveSources(pages.filter(page => !sourceLookup.get(page.sourceId)?.isGeneratedBlank)), [pages, sourceLookup]);
  const onlyImages = pages.length > 1 && pages.every(page => sourceLookup.get(page.sourceId)?.isImage);
  // Sorting inserted blank-page sources on their own would detach them from
  // neighboring content. Offer file sorting only for original source groups.
  const canSortSourceFiles = activeSourceCount > 1 &&
    pages.every(page => !sourceLookup.get(page.sourceId)?.isGeneratedBlank);
  const canInterleaveDuplex = (mode === 'merge-pdf' || mode === 'workspace') &&
    sourceGroups.length === 2 && sourceGroups.every(group => {
      const source = sourceLookup.get(group.sourceId);
      return Boolean(source && !source.isImage && !source.isGeneratedBlank);
    });
  const hasOriginalPdf = pages.some(page => { const src = sourceLookup.get(page.sourceId); return src && !src.isImage && !src.isGeneratedBlank; });
  const activeFormSourceCount = countActiveSources(pages.filter(page => sourceLookup.get(page.sourceId)?.hasInteractiveForms));
  const activeBookmarkSourceCount = countActiveSources(pages.filter(page => sourceLookup.get(page.sourceId)?.hasOutlineBookmarks));
  const pristineOutput = pages.length > 0 && Boolean(pristinePdfBytes(sources, pages, watermark));
  // Only a full Export PDF marks these particular edits as safely downloaded.
  // A later rotation/reorder/paper/watermark change immediately re-enables the
  // navigation guard; no document bytes ever leave browser RAM or enter storage.
  const documentRevision = useMemo(() => pages.length ? JSON.stringify({
    pages: pages.map(page => [page.id, page.sourceId, page.pageIndex, page.rotation]),
    photos: sources.filter(source => activeImageSources.has(source.id))
      .map(source => [source.id, source.imageLayout]),
    paper: mode === 'image-to-pdf' ? imageLayout : null,
    watermark: watermarkEnabled ? watermarkText : null,
  }) : null, [pages, sources, imageLayout, watermarkEnabled, watermarkText, mode]);
  // Deleting every page is still an unsaved edit. The original PDFs remain
  // in the Undo history, but there is no nonempty PDF left to export until
  // restored. Leaving the tab must not silently destroy the last Undo chance.
  const recoverableDeletedPages = pages.length === 0 && history.past.some(snapshot => snapshot.length > 0);
  const navigationWouldLoseWork = recoverableDeletedPages ||
    Boolean(pages.length && documentRevision !== lastDownloadedRevision);
  const splitNeedsInput = splitMode === 'ranges' ? !ranges.trim() : !chunkSize.trim();
  // Every-N splitting behaves consistently whether N=1 or N=2, 3, etc.
  // Above 50 output PDFs, page-aligned batches keep each download bounded.
  const chunkSizeNumber = Number(chunkSize);
  const chunkOutputCount = splitMode === 'chunks' &&
    Number.isSafeInteger(chunkSizeNumber) && chunkSizeNumber >= 1 && chunkSizeNumber <= pages.length
    ? Math.ceil(pages.length / chunkSizeNumber) : 0;
  const chunkBatchCount = chunkOutputCount > 50 ? Math.ceil(chunkOutputCount / 50) : 1;
  const safeSplitBatchIndex = Math.min(splitBatchIndex, chunkBatchCount - 1);
  const splitPlan = useMemo(() => {
    if (!pages.length || splitNeedsInput) return null;
    try {
      const batch = splitMode === 'chunks' && chunkOutputCount > 50
        ? splitChunkBatch(pages.length, chunkSizeNumber, safeSplitBatchIndex) : null;
      const parts = splitMode === 'ranges'
        ? parsePageRanges(ranges, pages.length)
        : batch ? batch.parts : chunkPageRanges(pages.length, chunkSizeNumber);
      const coverage = splitCoverageDetails(parts, pages.length);
      return coverage ? { parts, coverage, batch } : null;
    } catch (_error) { return null; }
  }, [pages.length, splitMode, ranges, chunkSizeNumber, chunkOutputCount, safeSplitBatchIndex, splitNeedsInput]);
  const splitEstimate = splitPlan?.parts.length ?? null;
  // Preserve custom, partial or overlapping manual ranges until user explicitly
  // approves replacing them. Visual cuts always cover current export order.
  const visualCuts = splitMode === 'ranges' && pages.length
    ? splitCutsFromRanges(ranges, pages.length) : [];

  const applyVisualCuts = (cutPositions) => {
    try {
      setRanges(cutPositions.length ? splitRangesFromCuts(cutPositions, pages.length) : '');
      setSplitMode('ranges');
      setPendingVisualCut(null);
      setError(''); setNotice('');
    } catch {
      setError(t.invalidRange);
      setNotice('');
    }
  };
  const restoreVisualCutFocus = (afterPage) => {
    setPendingVisualCut(null);
    // Restore the previous position on Cancel or Replace so keyboard users
    // do not lose their place in a book-length page grid.
    requestAnimationFrame(() => {
      document.querySelector('[data-testid="visual-split-cut"][data-after-page="' + afterPage + '"]')?.focus();
    });
  };
  const toggleVisualCut = (afterPage) => {
    if (busy || afterPage < 1 || afterPage >= pages.length) return;
    if (splitMode === 'ranges' && ranges.trim() && visualCuts === null) {
      setPendingVisualCut(afterPage);
      return;
    }
    const cuts = splitMode === 'ranges' ? visualCuts ?? [] : [];
    applyVisualCuts(cuts.includes(afterPage)
      ? cuts.filter(n => n !== afterPage) : [...cuts, afterPage]);
  };

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
  useEffect(() => () => { splitAbortRef.current?.abort(); exportAbortRef.current?.abort(); layoutAbortRef.current?.abort(); importAbortRef.current?.abort(); releasePreviewDocuments(); }, [releasePreviewDocuments]);

  // The 20-step history cap must also cap retained source bytes. Otherwise a
  // deleted PDF or photo that can no longer be restored remains in sources and
  // occupies the real 200 MiB workspace budget until Clear/reload.
  useEffect(() => {
    const referenced = historyReferencedSourceIds(history);
    for (const [id, entry] of previewDocuments.current) {
      if (referenced.has(id)) continue;
      entry.cancelled = true;
      entry.task?.destroy().catch(() => {});
      previewDocuments.current.delete(id);
    }
    setSources(previous => {
      const retained = previous.filter(source => referenced.has(source.id));
      return retained.length === previous.length ? previous : retained;
    });
  }, [history]);

  // Jump to the *current export position*, not the page's original source
  // number. Grouped view can be collapsed: switch to order then scroll after
  // React mounts that grid. Do not change page order or selection.
  useEffect(() => {
    if (pendingJump === null || pageView !== 'order') return;
    const tile = pageGridRef.current?.querySelector(`[data-export-position="${pendingJump}"]`);
    if (tile) {
      tile.scrollIntoView({ behavior: 'auto', block: 'center' });
      tile.focus({ preventScroll: true });
    }
    setPendingJump(null);
  }, [pendingJump, pageView, pages.length]);

  const jumpToPage = (event) => {
    event.preventDefault();
    if (busy || !pages.length) return;
    const value = jumpInput.trim().normalize('NFKC');
    const number = Number(value);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(number) || number > pages.length) {
      setError(interpolate(t.jumpInvalid, { pages: pages.length }));
      setNotice('');
      return;
    }
    setError('');
    setNotice(interpolate(t.jumpFound, { n: number }));
    setPendingJump(number);
    if (pageView !== 'order') setPageView('order');
  };

  const resetSelection = () => { setSelected(new Set()); lastSelectedIndex.current = null; lastGroupedSelection.current = null; };
  const commit = (operation, preserveSelection = false) => {
    setHistory((previous) => commitHistory(previous, operation(previous.present)));
    setSplitBatchIndex(0); // A new output order invalidates previously chosen batch offsets.
    if (!preserveSelection) resetSelection();
    setNotice('');
    setError('');
    setClearConfirm(false);
  };

  const interleaveDuplex = (reverseBacks) => {
    if (busyRef.current || !canInterleaveDuplex) return;
    try {
      // Validate outside the React state updater: invalid counts must show a
      // helpful message, never throw during rendering or destroy the workspace.
      interleaveDuplexPages(pages, reverseBacks);
      commit(previous => interleaveDuplexPages(previous, reverseBacks));
      // Source-group view intentionally keeps each file separate and would hide
      // the new alternating order. Show the REAL export order for inspection.
      setPageView('order');
      setNotice(t.duplexDone);
    } catch (_error) {
      setError(t.duplexInvalidCounts);
      setNotice('');
    }
  };

  const addFiles = async (incoming, { confirmedReimport = false } = {}) => {
    const items = [...(incoming ?? [])];
    if (!items.length || busyRef.current || pendingReimportRef.current) return;
    busyRef.current = true; // Reserve synchronously before awaiting file bytes.
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImporting(true); setImportCancelling(false);
    setError(''); setNotice(''); setClearConfirm(false); setBusy(true);
    // Once every page has been deleted, a successful new import starts a fresh
    // workspace. Keep the old undo history intact until that import succeeds.
    const replacingDeletedPages = pages.length === 0 && sources.length > 0;
    try {
      // Do not import photos with new settings while previously imported photos
      // still use the old paper layout. Otherwise switching the form back could
      // wrongly clear the dirty flag even though the resulting pages differ.
      if (imageLayoutDirty) throw new Error(t.imageMustApply);
      if (activeSourceCount + items.length > LIMITS.maxFiles) throw new Error(interpolate(t.errorFiles, { n: LIMITS.maxFiles }));
      if (items.some((file) => !isSupportedFile(file))) throw new Error(t.errorTypes);
      const incomingBytes = items.reduce((total, file) => total + file.size, 0);
      if ((replacingDeletedPages ? 0 : bytesInMemory) + incomingBytes > LIMITS.maxCombinedBytes) throw new Error(t.errorCombined);
      const nextSources = [];
      const nextPages = [];
      // Input-size preflight protects before reading; after conversion validate
      // the true retained size (PDF + original photo for undo/reflow).
      let additionalRetainedBytes = 0;
      for (const file of items) {
        if (controller.signal.aborted) throw new Error('Processing cancelled.');
        const source = await readSourceFile(file, { imageLayout, signal: controller.signal });
        if (controller.signal.aborted) throw new Error('Processing cancelled.');
        if (pages.length + nextPages.length + source.pageCount > LIMITS.maxPages) throw new Error(interpolate(t.errorPages, { n: LIMITS.maxPages }));
        additionalRetainedBytes += retainedSourceBytes(source);
        if ((replacingDeletedPages ? 0 : bytesInMemory) + additionalRetainedBytes > LIMITS.maxCombinedBytes) {
          throw new Error(t.errorCombined);
        }
        nextSources.push(source);
        for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex++) {
          nextPages.push({ id: temporaryWorkspaceId(), sourceId: source.id, pageIndex, rotation: 0 });
        }
      }
      // Validate and parse the candidate before asking the user to throw away
      // Undo. An invalid replacement should fail immediately and leave the old
      // recovery state intact. Store only File handles (not another 200 MiB of
      // parsed PDFs) while the decision is open; revalidate on confirmation.
      if (controller.signal.aborted) throw new Error('Processing cancelled.');
      if (replacingDeletedPages && recoverableDeletedPages && !confirmedReimport) {
        pendingReimportRef.current = items;
        setPendingReimportCount(items.length);
        setNotice('');
        return;
      }
      if (!pages.length) {
        // Never auto-select an arbitrary split point. A new document needs
        // an explicit range or pages-per-file choice before ZIP download.
        setRanges('');
        setChunkSize('');
        setSplitBatchIndex(0);
        setPendingVisualCut(null);
        setSplitMode('ranges');
        setDownloadNameInput('');
        setMoveTargetInput('');
        setMovePlacement('before');
      }
      if (replacingDeletedPages) {
        releasePreviewDocuments();
        setSources(nextSources);
        setHistory(makeHistoryState(nextPages));
        setCollapsedSources(new Set());
      } else {
        setSources((previous) => [...previous, ...nextSources]);
        setHistory((previous) => commitHistory(previous, [...previous.present, ...nextPages]));
      }
      resetSelection();
      setSplitBatchIndex(0);
      setSelectionRanges('');
      setNotice(locale === 'en'
        ? `Added ${nextSources.length} ${nextSources.length === 1 ? 'file' : 'files'} and ${nextPages.length} ${nextPages.length === 1 ? 'page' : 'pages'}.`
        : interpolate(t.loaded, { files: nextSources.length, pages: nextPages.length }));
    } catch (reason) {
      if (controller.signal.aborted) setNotice(locale === 'zh' ? '已取消导入，当前页面和撤销历史均已保留。' : 'Import cancelled. Current pages and Undo history were kept.');
      else setError(translateProcessingError(reason instanceof Error ? reason.message : t.errorGeneric, locale));
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setImporting(false); setImportCancelling(false);
      busyRef.current = false; setBusy(false);
    }
  };

  const cancelReimport = () => {
    pendingReimportRef.current = null;
    setPendingReimportCount(0);
  };
  const confirmReimport = () => {
    const pending = pendingReimportRef.current;
    cancelReimport();
    if (pending) void addFiles(pending, { confirmedReimport: true });
  };

  const withBusy = async (task) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setNotice(''); setClearConfirm(false);
    try { await task(); }
    catch (reason) { setError(translateProcessingError(reason instanceof Error ? reason.message : t.errorGeneric, locale)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const duplicateSelected = () => {
    try {
      const copies = duplicatePages(pages, selected, temporaryWorkspaceId, LIMITS.maxPages);
      if (copies === pages) return;
      commit(() => copies);
      setNotice(interpolate(t.duplicated, { pages: selectedCount }));
    } catch (reason) {
      setError(translateProcessingError(reason instanceof Error ? reason.message : t.errorGeneric, locale));
    }
  };

  const insertBlank = () => withBusy(async () => {
    if (!pages.length || selectedCount > 1) return;
    if (pages.length + 1 > LIMITS.maxPages) throw new Error(interpolate(t.errorPages, { n: LIMITS.maxPages }));
    const afterIndex = selectedCount === 1
      ? pages.findIndex(page => selected.has(page.id)) : pages.length - 1;
    const reference = pages[afterIndex];
    const source = sourceLookup.get(reference.sourceId);
    const blank = await createBlankPageSource(source, reference,
      locale === 'zh' ? '空白页.pdf' : 'Blank page.pdf');
    if (bytesInMemory + retainedSourceBytes(blank) > LIMITS.maxCombinedBytes) throw new Error(t.errorCombined);
    const newRef = { id: temporaryWorkspaceId(), sourceId: blank.id, pageIndex: 0, rotation: 0 };
    setSources(previous => [...previous, blank]);
    setHistory(previous => commitHistory(previous, insertPageAfter(previous.present, afterIndex, newRef)));
    setSplitBatchIndex(0); // Appending or inserting changes every-N output boundaries.
    resetSelection();
    setNotice(t.blankInserted);
  });

  const applyImageLayout = () => withBusy(async () => {
    const controller = new AbortController();
    layoutAbortRef.current = controller;
    setLayoutCancelling(false);
    const changedPhotos = sources.filter(source => source.isImage &&
      activeImageSources.has(source.id) && !sameImagePdfLayout(source.imageLayout, imageLayout)).length;
    setLayoutProgress({ done: 0, total: changedPhotos });
    try {
      const updated = await reflowImageSources(sources, imageLayout,
        (done, total) => { if (!controller.signal.aborted) setLayoutProgress({ done, total }); },
        t.errorCombined, activeImageSources, controller.signal);
      if (controller.signal.aborted) throw new Error('Photo layout update cancelled.');
      releasePreviewDocuments();
      setSources(updated);
      setNotice(t.imageApplied);
    } finally {
      layoutAbortRef.current = null;
      setLayoutProgress(null);
      setLayoutCancelling(false);
    }
  });

  // Long PDF exports now share the split tool's cancellation behavior.
  // PDF serialization itself may not yield, but no partial download is ever offered.
  const exportPages = (chosen, outputName, successMessage) => withBusy(async () => {
    if (!chosen.length) throw new Error(t.noFile);
    if (imageLayoutDirty) throw new Error(t.imageMustApply);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportCancelling(false);
    const largeExport = chosen.length >= 24;
    if (largeExport) setExportProgress({ done: 0, total: chosen.length });
    try {
      const allPages = chosen.length === pages.length &&
        chosen.every((page, index) => page === pages[index]);
      const pristine = allPages ? pristinePdfBytes(sources, chosen, watermark) : null;
      const bytes = pristine ?? await composePdf(sources, chosen, {
        watermark, signal: controller.signal, cancelMessage: 'PDF export cancelled.',
        onProgress: (done, total) => { if (largeExport && !controller.signal.aborted) setExportProgress({ done, total }); },
      });
      if (controller.signal.aborted) throw new Error('PDF export cancelled.');
      saveDownload(bytes, outputName);
      // A full-page extraction builds a new array via filter(), but produces
      // the same complete PDF as Export all when every export-order page matches.
      // Only a genuinely partial extraction must keep the unsaved-work guard.
      if (chosen.length === pages.length && chosen.every((page, index) => page === pages[index])) {
        setLastDownloadedRevision(documentRevision);
      }
      setNotice(successMessage);
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
      setExportCancelling(false);
    }
  });
  const exportAll = () => exportPages(pages, filename, t.exported);
  const exportSelected = () => {
    const chosen = pages.filter((page) => selected.has(page.id));
    if (!chosen.length) return withBusy(async () => { throw new Error(t.selectionNeeded); });
    return exportPages(chosen, `${outputBase}-selected-${chosen.length}-pages.pdf`, interpolate(t.extracted, { pages: chosen.length }));
  };
  const downloadSplit = () => withBusy(async () => {
    if (!pages.length) throw new Error(t.noFile);
    if (imageLayoutDirty) throw new Error(t.imageMustApply);
    if (!splitPlan?.parts.length) throw new Error(t.invalidRange);
    const pieces = splitPlan.parts;
    const batch = splitPlan.batch;
    // A single per-page ZIP batch intentionally covers only its displayed
    // page range. It must NEVER mark the full edited workspace as downloaded.
    const completeSplit = !batch && splitCoversAllPagesExactlyOnce(pieces, pages.length);
    const controller = new AbortController();
    splitAbortRef.current = controller;
    setSplitCancelling(false);
    setSplitProgress({ phase: 'parts', done: 0, total: pieces.length });
    let size = 0;
    const sourceDocuments = new Map();
    try {
      // A single selected section should be a PDF download, not a ZIP that
      // forces the user to extract the only file. Keep the same output budget.
      const zip = pieces.length > 1 ? new JSZip() : null;
      for (let index = 0; index < pieces.length; index++) {
        if (controller.signal.aborted) throw new Error('Split cancelled.');
        const range = pieces[index];
        const chosenPages = getRangePages(pages, range);
        // One section that contains the untouched original is an export, not
        // a real split. Preserve outlines, forms, signatures and metadata.
        const pristine = !zip && completeSplit
          ? pristinePdfBytes(sources, chosenPages, watermark) : null;
        const contents = pristine ?? await composePdf(sources, chosenPages, {
          watermark, signal: controller.signal, sourceDocuments,
        });
        if (controller.signal.aborted) throw new Error('Split cancelled.');
        size = enforceSplitZipBudget(size, contents.length);
        if (!zip) {
          saveDownload(contents, `${outputBase}-pages-${range.start}-${range.end}.pdf`);
          // A one-piece export covering the entire edited workspace is
          // equivalent to Export PDF; don't warn about work already saved.
          if (completeSplit) setLastDownloadedRevision(documentRevision);
          setNotice(batch ? interpolate(
            batch.index + 1 === batch.total ? t.splitFinalBatchDownloaded : t.splitBatchDownloaded,
            { index: batch.index + 1, total: batch.total },
          ) : t.splitSingleSaved);
          return;
        }
        zip.file(`part-${String(index + 1).padStart(2, '0')}-pages-${range.start}-${range.end}.pdf`, contents);
        setSplitProgress({ phase: 'parts', done: index + 1, total: pieces.length });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (controller.signal.aborted) throw new Error('Split cancelled.');
      setSplitProgress({ phase: 'zip', percent: 0 });
      let lastPercent = -1;
      const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, meta => {
        if (controller.signal.aborted) throw new Error('Split cancelled.');
        const percent = Math.floor(meta.percent);
        if (percent >= lastPercent + 5 || percent === 100) {
          lastPercent = percent;
          setSplitProgress({ phase: 'zip', percent });
        }
      });
      if (controller.signal.aborted) throw new Error('Split cancelled.');
      saveDownload(archive, batch
        ? `${outputBase}-pages-${batch.start}-${batch.end}-split.zip` : `${outputBase}-split.zip`, 'application/zip');
      if (completeSplit) setLastDownloadedRevision(documentRevision);
      setNotice(batch
        ? interpolate(batch.index + 1 === batch.total ? t.splitFinalBatchDownloaded : t.splitBatchDownloaded,
          { index: batch.index + 1, total: batch.total })
        : interpolate(t.zipped, { files: pieces.length }));
    } finally {
      splitAbortRef.current = null;
      setSplitProgress(null);
      setSplitCancelling(false);
    }
  });

  const toggleSelection = (id, index, shift, group = null) => {
    // Shift-range follows the VISIBLE grouped page order. A hidden page from
    // another PDF must never be selected simply because it is interleaved in
    // the underlying export order.
    const groupPosition = group?.items.findIndex(item => item.pageRef.id === id) ?? -1;
    const anchor = lastGroupedSelection.current;
    // React can defer state updater evaluation until after the ref is advanced.
    // Snapshot the export-order anchor before updating it below.
    const orderAnchor = lastSelectedIndex.current;
    setSelected(previous => {
      const next = new Set(previous);
      if (group && shift && anchor?.sourceId === group.sourceId && groupPosition >= 0) {
        const first = Math.min(groupPosition, anchor.position);
        const last = Math.max(groupPosition, anchor.position);
        for (let n = first; n <= last; n++) next.add(group.items[n].pageRef.id);
      } else if (!group && shift && orderAnchor !== null) {
        const first = Math.min(index, orderAnchor);
        const last = Math.max(index, orderAnchor);
        for (let n = first; n <= last; n++) next.add(pages[n].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (group) {
      lastGroupedSelection.current = { sourceId: group.sourceId, position: groupPosition };
      lastSelectedIndex.current = null;
    } else {
      lastSelectedIndex.current = index;
      lastGroupedSelection.current = null;
    }
  };

  const applyPageRangeSelection = (event) => {
    event.preventDefault();
    if (busy || !pages.length) return;
    try {
      // Validate and compute the complete selection before replacing anything.
      // This is the actual current export order, even in grouped source view.
      const ids = pageIdsForRanges(pages, selectionRanges);
      setSelected(ids);
      lastSelectedIndex.current = null;
      lastGroupedSelection.current = null;
      setError('');
      setNotice(interpolate(t.rangeSelected, { pages: ids.size }));
    } catch (_reason) {
      setNotice('');
      setError(t.rangeSelectInvalid);
    }
  };

  const selectByQuickPattern = (pattern) => {
    if (busy || busyRef.current || !pages.length) return;
    const ids = pattern === 'invert'
      ? invertPageIdSelection(pages, selected)
      : pageIdsForParity(pages, pattern);
    setSelected(ids);
    setSelectionRanges(''); // Avoid a stale typed range appearing to be active.
    lastSelectedIndex.current = null;
    lastGroupedSelection.current = null;
    setError('');
    setNotice(interpolate(t.quickSelectionDone, { pages: ids.size }));
  };

  const moveSelectedToPage = (event) => {
    event.preventDefault();
    if (busy || !pages.length || !selectedCount) return;
    const normalized = moveTargetInput.trim().normalize('NFKC');
    const target = Number(normalized);
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(target) ||
        target < 1 || target > pages.length) {
      setError(interpolate(t.moveInvalid, { pages: pages.length }));
      setNotice('');
      return;
    }
    if (selected.has(pages[target - 1].id)) {
      setError(t.moveTargetSelected);
      setNotice('');
      return;
    }
    try {
      const moved = moveSelectedPagesToPosition(pages, selected, target, movePlacement);
      if (moved === pages) {
        setError('');
        setNotice(t.moveUnchanged);
        return;
      }
      const firstSelected = pages.find(page => selected.has(page.id));
      const firstNewIndex = moved.findIndex(page => page.id === firstSelected.id) + 1;
      // A single atomic history edit; selecting a target does not unselect
      // moved page IDs or silently change the user's requested side.
      commit(() => moved, true);
      // Shift-click anchors refer to old export/group indices; after a move
      // retaining them would select the wrong range on the next click.
      lastSelectedIndex.current = null;
      lastGroupedSelection.current = null;
      setMoveTargetInput('');
      setPageView('order');
      setPendingJump(firstNewIndex);
      setNotice(interpolate(movePlacement === 'before' ? t.moveDoneBefore : t.moveDoneAfter,
        { pages: selectedCount, position: target }));
    } catch (_error) {
      setNotice('');
      setError(t.moveInvalid);
    }
  };

  const clearAll = () => {
    cancelReimport();
    setClearConfirm(false);
    setPreviewPageId(null);
    setWatermarkEnabled(false); setWatermarkText(''); setExportSettingsOpen(mode === 'watermark-pdf');
    setSources([]); setHistory(makeHistoryState()); resetSelection(); setError(''); setNotice(t.cleared);
    setPageView('order'); setCollapsedSources(new Set());
    setLastDownloadedRevision(null);
    setRanges(''); setChunkSize(''); setSplitBatchIndex(0); setSplitMode('ranges'); setPendingVisualCut(null);
    setSelectionRanges(''); setMoveTargetInput(''); setMovePlacement('before'); setDownloadNameInput(''); setJumpInput(''); setPendingJump(null);
    // A fresh image-to-PDF workspace must not inherit a previous crop choice.
    setImageLayout({ ...IMAGE_PDF_LAYOUT_DEFAULT });
    releasePreviewDocuments();
  };

  const onMoveDrop = (event, targetId) => {
    event.preventDefault();
    setDropTarget(null);
    if (event.dataTransfer.files?.length) {
      draggedPageIdsRef.current = null;
      setDragged(null);
      void addFiles(event.dataTransfer.files);
      return;
    }
    // DataTransfer's custom payload is not always available on every drop.
    // Prefer the synchronous dragstart snapshot to stale React state.
    let group = draggedPageIdsRef.current;
    if (!Array.isArray(group) || !group.length) {
      const text = event.dataTransfer.getData('application/x-plainmile-pages');
      try { group = JSON.parse(text); } catch (_error) { group = []; }
    }
    if (!Array.isArray(group) || !group.length) group = dragged ? [dragged] : [];
    draggedPageIdsRef.current = null;
    if (group.length) commit((previous) => group.length === 1 ? movePage(previous, group[0], targetId) : movePageGroup(previous, group, targetId));
    setDragged(null);
  };
  const largeWorkspace = pages.length > 0 && (pages.length >= 250 || bytesInMemory >= 100 * 1024 * 1024);
  const selectedText = locale === 'zh' ? `${selectedCount} ${t.selected}` : `${selectedCount} ${selectedCount === 1 ? 'page' : 'pages'} selected`;
  const pageName = (number) => locale === 'zh' ? `第 ${number} 页` : `Page ${number}`;
  const toggleSourceCollapsed = (sourceId) => setCollapsedSources(previous => {
    const next = new Set(previous);
    if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
    return next;
  });

  // A grouped view never alters the document's actual order. Selection and
  // actions use page IDs; the original indices stay visible as Export page N.
  const groupedTiles = (group) => group.items.map(({ pageRef, index }) => {
    const source = sourceLookup.get(pageRef.sourceId);
    return (
      <div className={`page-tile page-tile-grouped ${selected.has(pageRef.id) ? 'is-selected' : ''}`}
        key={pageRef.id} data-testid="page-tile" data-original-page={pageRef.pageIndex + 1}
        data-export-position={index + 1}>
        <label className="page-tile-checkbox"><input type="checkbox"
          checked={selected.has(pageRef.id)} disabled={busy}
          onChange={event => toggleSelection(pageRef.id, index, Boolean(event.nativeEvent?.shiftKey), group)}
          aria-label={locale === 'zh' ? `${t.selectPage} ${index + 1} 页` : `Select page ${index + 1}`} /></label>
        <span className="tile-sequence" data-testid="group-output-position">{interpolate(t.groupOutputPosition, { n: index + 1 })}</span>
        <PageThumbnail source={source} pageRef={pageRef} getPreviewDoc={getPreviewDoc} locale={locale} t={t}
          watermarkPreview={watermarkPreview} onOpen={setPreviewPageId} outputPosition={index + 1} busy={busy} />
        <div className="tile-info" title={source?.name}>
          <strong>{pageName(pageRef.pageIndex + 1)}</strong><small>{source?.name ?? t.document}</small>
        </div>
      </div>
    );
  });


  // Keep the single tested workspace/engine, but make the entry tool's
  // intended task immediately available. Secondary actions remain accessible
  // in a native disclosure instead of overwhelming first-time users.
  const fullDocumentExportIsSecondary = mode === 'extract-pages' || tab === 'split';
  const focusedActionKeys = ({
    'rotate-pdf': ['rotateLeft', 'rotateRight'],
    'delete-pages': ['delete'],
    'extract-pages': ['extract'],
  })[mode] || null;
  const focusedHint = ({
    'rotate-pdf': t.focusRotateHint,
    'delete-pages': t.focusDeleteHint,
    'extract-pages': t.focusExtractHint,
  })[mode];
  const pageActionItems = [
    { key: 'rotateLeft', node: <button type="button" disabled={!selectedCount || busy} onClick={() => commit((previous) => rotatePages(previous, selected, -90), true)} aria-label={t.rotateLeft}>↶ {t.rotateLeft}</button> },
    { key: 'rotateRight', node: <button type="button" disabled={!selectedCount || busy} onClick={() => commit((previous) => rotatePages(previous, selected, 90), true)} aria-label={locale === 'en' ? 'Rotate clockwise' : t.rotateRight}>↷ {t.rotateRight}</button> },
    { key: 'extract', node: <button type="button" disabled={!selectedCount || busy || imageLayoutDirty} onClick={exportSelected} aria-label={locale === 'en' ? 'Extract selected pages' : t.extract}>↗ {t.extract}</button> },
    { key: 'duplicate', node: <button type="button" data-testid="duplicate-pages" disabled={!selectedCount || busy} onClick={duplicateSelected} aria-label={t.duplicateSelected}>⧉ {t.duplicateSelected}</button> },
    { key: 'blank', node: <button type="button" data-testid="insert-blank-page" disabled={busy || selectedCount > 1} onClick={insertBlank} title={t.blankHint} aria-label={t.insertBlank}>＋ {t.insertBlank}</button> },
    { key: 'delete', node: <button type="button" disabled={!selectedCount || busy} className="muted-danger" onClick={() => commit((previous) => deletePages(previous, selected))} aria-label={locale === 'en' ? 'Delete selected pages' : t.del}>× {t.del}</button> },
  ];
  const renderPageAction = ({ key, node }) => <React.Fragment key={key}>{node}</React.Fragment>;

  return (
    <div className="pdf-workspace" data-testid="pdf-workspace">
      <UnsavedNavigationGuard active={navigationWouldLoseWork} locale={locale}
        recoverableDeletedPages={recoverableDeletedPages} />
      {zoomPageRef && zoomSource && <PageZoomDialog
        source={zoomSource} pageRef={zoomPageRef} position={zoomPageIndex + 1}
        pageCount={pages.length} getPreviewDoc={getPreviewDoc}
        locale={locale} t={t} watermarkPreview={watermarkPreview}
        onClose={() => setPreviewPageId(null)} onNavigate={navigateZoom} />}
      <div className="workspace-bar">
        <div className="workspace-heading"><span className="workspace-app-icon" aria-hidden="true">▤</span><div><strong>{t.app}</strong><span>{t.local}</span></div></div>
        <span className="workspace-status"><span className="status-dot" aria-hidden="true" />{t.local}</span>
      </div>
      <div className="workspace-controls">
        <div className="tool-switch" role="tablist" aria-label={t.app}
          onKeyDown={event => {
            if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'organize' : 'split';
            setTab(next);
            event.currentTarget.querySelector('[data-workspace-tab="' + next + '"]')?.focus();
          }}>
          <button type="button" id="workspace-tab-organize" data-workspace-tab="organize"
            role="tab" aria-selected={tab === 'organize'} aria-controls="workspace-panel-organize"
            tabIndex={tab === 'organize' ? 0 : -1} className={tab === 'organize' ? 'active' : ''}
            onClick={() => setTab('organize')} disabled={busy}>{t.organize}</button>
          <button type="button" id="workspace-tab-split" data-workspace-tab="split"
            role="tab" aria-selected={tab === 'split'} aria-controls="workspace-panel-split"
            tabIndex={tab === 'split' ? 0 : -1} className={tab === 'split' ? 'active' : ''}
            onClick={() => setTab('split')} disabled={busy}>{t.split}</button>
        </div>
        <div className="workspace-primary-buttons">
          <input ref={inputRef} data-testid="file-input" aria-label={t.add} className="hidden-input" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.avif,application/pdf,image/jpeg,image/png,image/webp,image/bmp,image/avif" disabled={busy || pendingReimportCount > 0} onChange={(event) => { void addFiles(event.target.files); event.target.value = ''; }} />
          <button className="button button-secondary button-small" type="button" disabled={busy || pendingReimportCount > 0} onClick={() => inputRef.current?.click()}>＋ {t.add}</button>
          {pages.length > 0 && <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => setExportSettingsOpen((value) => !value)} aria-expanded={exportSettingsOpen} aria-controls="export-options-panel" data-testid="export-options-button">{t.exportOptions}{watermarkEnabled ? ` \u00b7 ${t.watermarkOn}` : ""}</button>}
          <button className={`button ${fullDocumentExportIsSecondary ? 'button-secondary' : 'button-primary'} button-small`} type="button"
            disabled={!pages.length || busy || imageLayoutDirty} onClick={exportAll}
            aria-label={fullDocumentExportIsSecondary ? t.exportAllPages : t.export}>
            {busy ? t.working : fullDocumentExportIsSecondary ? t.exportAllPages : t.export} ↓
          </button>
        </div>
      </div>
      {pendingReimportCount > 0 && !busy && <div className="workspace-clear-confirm" role="group"
        aria-label={t.reimportConfirmTitle} data-testid="reimport-confirmation">
        <p>{interpolate(t.reimportConfirmMessage, { files: pendingReimportCount })}</p>
        <div className="workspace-clear-buttons">
          <button type="button" className="button button-secondary button-small"
            data-testid="cancel-reimport" onClick={cancelReimport}>{t.reimportKeep}</button>
          <button type="button" className="button button-secondary button-small muted-danger"
            data-testid="confirm-reimport" onClick={confirmReimport}>{t.reimportReplace}</button>
        </div>
      </div>}
      {clearConfirm && sources.length > 0 && !busy && <div className="workspace-clear-confirm" role="group" aria-label={t.clearConfirmTitle} data-testid="clear-confirmation">
        <p>{t.clearConfirmDescription}</p>
        <div className="workspace-clear-buttons">
          <button type="button" className="button button-secondary button-small" data-testid="cancel-clear" onClick={() => setClearConfirm(false)}>{t.cancelClear}</button>
          <button type="button" className="button button-secondary button-small muted-danger" data-testid="confirm-clear" onClick={clearAll}>{t.confirmClear}</button>
        </div>
      </div>}
      {busy && exportProgress && <div className="export-progress-row" data-testid="export-progress-row">
        <p className="utility-note" data-testid="export-progress" role="status" aria-live="polite">{interpolate(t.exportProgress, exportProgress)}</p>
        <button type="button" className="button button-secondary button-small" data-testid="export-cancel"
          disabled={exportCancelling} onClick={() => { exportAbortRef.current?.abort(); setExportCancelling(true); }}>
          {exportCancelling ? t.exportCancelling : t.exportCancel}
        </button>
      </div>}
      {mode === 'image-to-pdf' && (
        <section className="export-options-panel" data-testid="image-page-settings" aria-label={t.imageSettings}>
          <div className="export-options-header"><strong>{t.imageSettings}</strong><span>{t.imageSettingsHint}</span></div>
          <div className="utility-options">
            <label><span>{t.imagePaper}</span>
              <select aria-label={t.imagePaper} data-testid="image-paper" value={imageLayout.paper} disabled={busy}
                onChange={event => setImageLayout(value => ({ ...value, paper: event.target.value,
                  // "Fit to image" should follow each photo by default, without
                  // silently inheriting the previous portrait/landscape paper orientation.
                  orientation: event.target.value === 'fit' ? 'auto' : value.orientation,
                  imageSizing: event.target.value === 'fit' ? 'contain' : value.imageSizing }))}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
                <option value="fit">{t.imageFit}</option>
              </select>
            </label>
            <label><span>{t.imageOrientation}</span>
              <select aria-label={t.imageOrientation} data-testid="image-orientation" value={imageLayout.orientation} disabled={busy || imageLayout.paper === 'fit'}
                onChange={event => setImageLayout(value => ({ ...value, orientation: event.target.value }))}>
                <option value="portrait">{t.imagePortrait}</option>
                <option value="landscape">{t.imageLandscape}</option>
                <option value="auto">{t.imageAuto}</option>
              </select>
              {imageLayout.paper === 'fit' && <span className="input-note" data-testid="image-fit-orientation-hint">{t.imageFitAutoHint}</span>}
            </label>
            <label><span>{t.imageMargin}</span>
              <select aria-label={t.imageMargin} data-testid="image-margin" value={String(imageLayout.margin)} disabled={busy}
                onChange={event => setImageLayout(value => ({ ...value, margin: Number(event.target.value) }))}>
                <option value="0">{t.imageMarginNone}</option>
                <option value="12">{t.imageMarginNarrow}</option>
                <option value="30">{t.imageMarginNormal}</option>
                <option value="48">{t.imageMarginWide}</option>
              </select>
            </label>
          </div>
          <div className="utility-options">
            <label><span>{t.imageSizing}</span>
              <select data-testid="image-sizing" aria-label={t.imageSizing}
                disabled={busy || imageLayout.paper === 'fit'}
                value={imageLayout.imageSizing}
                onChange={event => setImageLayout(value => ({ ...value, imageSizing: event.target.value }))}>
                <option value="contain">{t.imageContain}</option>
                <option value="cover">{t.imageCover}</option>
              </select>
            </label>
          </div>
          <p className="input-note" data-testid="image-sizing-hint">{imageLayout.paper === "fit" ? t.imageFitSizingHint : imageLayout.imageSizing === "cover" ? t.imageCoverHint : t.imageContainHint}</p>
          {imageLayoutDirty && <p className="utility-note" data-testid="image-layout-dirty">{t.imageLayoutDirty}</p>}
          {imageLayoutDirty && <button type="button" className="button button-secondary" data-testid="image-layout-apply"
            disabled={busy} onClick={applyImageLayout}>{busy ? t.working : t.imageApply}</button>}
          {busy && layoutProgress && <div className="layout-progress-row" role="status" aria-live="polite"
            data-testid="image-layout-progress">
            <span>{interpolate(t.imageApplyProgress, layoutProgress)}</span>
            <button type="button" className="button button-secondary button-small"
              data-testid="image-layout-cancel" disabled={layoutCancelling}
              onClick={() => { layoutAbortRef.current?.abort(); setLayoutCancelling(true); }}>
              {layoutCancelling ? t.imageApplyCancelling : t.imageApplyCancel}
            </button>
          </div>}
        </section>
      )}
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
              <input id="watermark-text" data-testid="watermark-text" type="text" spellCheck={false} autoComplete="off" maxLength={MAX_WATERMARK_CHARS} value={watermarkText} disabled={busy} onChange={(event) => { setWatermarkText(event.target.value); setError(''); }} placeholder={t.watermarkPlaceholder} />
              <p className="input-note" aria-live="polite">{watermarkText.trim() ? t.watermarkHelp : t.watermarkNeedsText}</p>
            </div>
          )}
        </section>
      )}
      {pages.length > 0 && <section className="workspace-download-settings">
        <details data-testid="download-name-panel">
          <summary>{t.renameDownload}</summary>
          <div className="download-name-controls">
            <label htmlFor="download-name-input">{t.outputName}</label>
            <input type="text" id="download-name-input" data-testid="download-name-input" spellCheck={false} autoComplete="off"
              maxLength={120} value={downloadNameInput} disabled={busy}
              placeholder={defaultFilename}
              onChange={event => setDownloadNameInput(event.target.value)} />
            <button type="button" className="button button-secondary button-small"
              onClick={() => setDownloadNameInput('')} disabled={busy || !downloadNameInput}>{t.renameReset}</button>
            <p className="input-note">{t.renameHint}</p>
          </div>
        </details>
        <p className="utility-note" data-testid="workspace-export-filename">{t.outputName}: <strong>{filename}</strong> · {pages.length} {t.pages}</p>
      </section>}
      {importing && <div className="utility-load-controls" role="status" data-testid="workspace-import-progress">
        <span>{locale === 'zh' ? '正在本地读取文件…' : 'Opening files on this device…'}</span>
        <button type="button" className="button button-secondary button-small" data-testid="workspace-import-cancel"
          disabled={importCancelling} onClick={() => { setImportCancelling(true); importAbortRef.current?.abort(); }}>
          {importCancelling ? (locale === 'zh' ? '正在取消…' : 'Cancelling…') : (locale === 'zh' ? '取消导入' : 'Cancel import')}
        </button>
      </div>}
      <div className="workspace-content" onDragOver={(event) => { if (Array.from(event.dataTransfer.types ?? []).includes('Files')) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files?.length) { event.preventDefault(); void addFiles(event.dataTransfer.files); } }}>
        {error && <div className="notice notice-error" role="alert">{error}<button type="button" aria-label={t.dismiss} onClick={() => setError('')}>×</button></div>}
        {notice && <div className="notice notice-success" role="status">{notice}<button type="button" aria-label={t.dismiss} onClick={() => setNotice('')}>×</button></div>}
        {pristineOutput && <p className="utility-note" data-testid="workspace-original-preserved">{locale === 'zh' ? '当前页面未修改，直接导出会保留原始 PDF 字节，包括书签、交互表单及签名。' : 'This PDF is unchanged. Export all preserves the original bytes, including bookmarks, form fields and signatures.'}</p>}
        {hasOriginalPdf && <p className="utility-note" data-testid="workspace-document-caution">{pristineOutput ? (locale === 'zh' ? '但提取部分页面、拆分或修改 PDF 会创建新文件，可能丢失表单、附件、注释或使数字签名失效。原始文件请保留。' : 'Extracting, splitting or editing this PDF creates a new file and may affect forms, attachments, annotations and digital signatures. Keep your original.') : t.documentCaution}</p>}
        {activeFormSourceCount > 0 && <p className="utility-note workspace-form-risk"
          data-testid="workspace-form-risk" role="alert">
          {interpolate(t.formRisk, { files: activeFormSourceCount })}
        </p>}
        {activeBookmarkSourceCount > 0 && <p className="utility-note workspace-bookmark-risk"
          data-testid="workspace-bookmark-risk" role="alert">
          {interpolate(t.bookmarkRisk, { files: activeBookmarkSourceCount })}
        </p>}
        {largeWorkspace && <p className="utility-note" data-testid="workspace-large-warning">{t.bigDocWarning}</p>}
        {!pages.length ? (
          <div className="dropzone" role="tabpanel" id={`workspace-panel-${tab}`} aria-labelledby={`workspace-tab-${tab}`} data-testid="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void addFiles(event.dataTransfer.files); }}>
            <div className="drop-icon" aria-hidden="true">＋</div>
            <h2>{t.dropTitle}</h2><p>{t.dropSub}</p>
            <button type="button" className="button button-primary" disabled={busy || pendingReimportCount > 0} onClick={() => inputRef.current?.click()}>{busy ? t.opening : t.choose}</button>
            <p className="drop-limits">{t.limits}</p><div className="empty-privacy">✓ {t.private}</div>
            {sources.length > 0 && <p className="utility-note" data-testid="empty-history-hint">{t.emptyHistoryHint}</p>}
            {history.past.length > 0 && <button type="button" className="button button-secondary button-small" data-testid="undo-all-deleted" disabled={busy || pendingReimportCount > 0} onClick={() => { setHistory(undoHistory); setSplitBatchIndex(0); resetSelection(); setError(''); setNotice(''); }}>{t.undo}</button>}
            {sources.length > 0 && <button type="button" className="button button-secondary button-small" onClick={() => setClearConfirm(true)} disabled={busy || pendingReimportCount > 0}>{t.reset}</button>}
          </div>
        ) : (
          <>
            <div className="workspace-subbar">
              <div className="file-count" data-retained-bytes={bytesInMemory}><strong>{locale === 'zh' ? `${pages.length} 页` : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}</strong><span>{locale === 'zh' ? ` · 来自 ${activeSourceCount} 个文件` : ` from ${activeSourceCount} ${activeSourceCount === 1 ? 'file' : 'files'}`}</span></div>
              <div className="history-buttons">
                <button type="button" disabled={!history.past.length || busy} onClick={() => { setHistory(undoHistory); setSplitBatchIndex(0); resetSelection(); }} aria-label={t.undo} title={t.undo}>↶ {t.undo}</button>
                <button type="button" disabled={!history.future.length || busy} onClick={() => { setHistory(redoHistory); setSplitBatchIndex(0); resetSelection(); }} aria-label={t.redo} title={t.redo}>↷ {t.redo}</button>
                <button type="button" disabled={busy} className="muted-danger" onClick={() => setClearConfirm(true)}>{t.clear}</button>
              </div>
            </div>
            {tab === 'organize' ? (
              <section aria-label={t.organize} className="pages-work-area" role="tabpanel" id="workspace-panel-organize" aria-labelledby="workspace-tab-organize">
                <div className="selection-toolbar">
                  <div className="selection-info"><strong>{selectedText}</strong><button type="button" disabled={busy} onClick={() => { setSelected(new Set(pages.map((page) => page.id))); lastSelectedIndex.current = null; lastGroupedSelection.current = null; }}>{t.all}</button><button type="button" onClick={resetSelection} disabled={busy || !selectedCount}>{t.none}</button></div>
                  <div className="page-action-buttons" data-testid="page-actions">
                    {focusedActionKeys
                      ? pageActionItems.filter(item => focusedActionKeys.includes(item.key)).map(renderPageAction)
                      : pageActionItems.map(renderPageAction)}
                    {focusedActionKeys && <details className="page-more-actions" data-testid="page-more-actions">
                      <summary>{t.morePageActions}</summary>
                      <div className="page-action-buttons">
                        {pageActionItems.filter(item => !focusedActionKeys.includes(item.key)).map(renderPageAction)}
                      </div>
                    </details>}
                  </div>
                </div>
                {focusedActionKeys && <p className="input-note focused-page-hint" data-testid="focused-page-hint">{focusedHint}</p>}
                <details className="selection-range-panel" data-testid="selection-range-panel">
                  <summary>{t.rangeSelectToggle}</summary>
                  <form className="selection-range-form" onSubmit={applyPageRangeSelection}>
                    <label htmlFor="selection-ranges">{t.rangeSelectLabel}
                      <input id="selection-ranges" data-testid="selection-ranges" type="text"
                        placeholder="1-3, 5, 8-12" value={selectionRanges} disabled={busy}
                        onChange={event => setSelectionRanges(event.target.value)} />
                    </label>
                    <button className="button button-secondary button-small" type="submit"
                      data-testid="selection-range-apply" disabled={busy || !selectionRanges.trim()}>{t.rangeSelectApply}</button>
                    <p className="input-note">{t.rangeSelectHint}</p>
                    <div className="selection-pattern-buttons" data-testid="selection-pattern-buttons"
                      role="group" aria-label={t.quickSelectionLabel}>
                      <button type="button" className="button button-secondary button-small"
                        data-testid="select-odd-pages" disabled={busy}
                        onClick={() => selectByQuickPattern('odd')}>{t.selectOdd}</button>
                      <button type="button" className="button button-secondary button-small"
                        data-testid="select-even-pages" disabled={busy}
                        onClick={() => selectByQuickPattern('even')}>{t.selectEven}</button>
                      <button type="button" className="button button-secondary button-small"
                        data-testid="invert-page-selection" disabled={busy}
                        onClick={() => selectByQuickPattern('invert')}>{t.invertSelection}</button>
                    </div>
                    <p className="input-note">{t.quickSelectionHint}</p>
                  </form>
                </details>
                {pages.length > 1 && <details className="move-position-panel" data-testid="move-position-panel">
                  <summary>{t.moveToggle}</summary>
                  <form className="move-position-form" onSubmit={moveSelectedToPage}>
                    <label htmlFor="move-target-position">{interpolate(t.moveLabel, { pages: pages.length })}
                      <input id="move-target-position" data-testid="move-target-input"
                        type="text" inputMode="numeric" maxLength={8} placeholder="100"
                        value={moveTargetInput} disabled={busy}
                        onChange={event => setMoveTargetInput(event.target.value)} />
                    </label>
                    <label htmlFor="move-position-side">{t.movePositionSide}
                      <select id="move-position-side" data-testid="move-position-side"
                        value={movePlacement} disabled={busy}
                        onChange={event => setMovePlacement(event.target.value)}>
                        <option value="before">{t.moveBefore}</option>
                        <option value="after">{t.moveAfter}</option>
                      </select>
                    </label>
                    <button type="submit" className="button button-secondary button-small"
                      data-testid="move-position-submit"
                      disabled={busy || !selectedCount || selectedCount === pages.length || !moveTargetInput.trim()}>
                      {t.moveApply}
                    </button>
                    <p className="input-note">{selectedCount === pages.length ? t.moveAllSelected : t.moveHint}</p>
                  </form>
                </details>}
                <p className="input-note" data-testid="blank-position-hint">{t.blankHint}</p>
                <div className="workspace-view-switch" role="group" aria-label={t.viewBySource} data-testid="workspace-view-switch">
                  <button type="button" data-testid="workspace-view-order"
                    className={pageView === 'order' ? 'active' : ''} aria-pressed={pageView === 'order'} disabled={busy}
                    onClick={() => setPageView('order')}>{t.viewExportOrder}</button>
                  <button type="button" data-testid="workspace-view-grouped"
                    className={pageView === 'grouped' ? 'active' : ''} aria-pressed={pageView === 'grouped'} disabled={busy}
                    onClick={() => setPageView('grouped')}>{t.viewBySource}</button>
                </div>
                {pages.length > 1 && <details className="page-jump-panel" data-testid="page-jump-panel">
                  <summary>{t.jumpToggle}</summary>
                  <form onSubmit={jumpToPage} className="page-jump-form">
                    <label htmlFor="page-jump-input">{interpolate(t.jumpLabel, { pages: pages.length })}
                      <input id="page-jump-input" data-testid="page-jump-input" type="text"
                        inputMode="numeric" maxLength={8} placeholder="137"
                        value={jumpInput} disabled={busy}
                        onChange={event => setJumpInput(event.target.value)} />
                    </label>
                    <button type="submit" className="button button-secondary button-small"
                      data-testid="page-jump-submit" disabled={busy || !jumpInput.trim()}>{t.jumpAction}</button>
                    <p className="input-note">{t.jumpHint}</p>
                  </form>
                </details>}
                {pages.length > 1 && <div className="page-action-buttons" data-testid={onlyImages ? 'image-batch-actions' : 'page-order-actions'}>
                  {canSortSourceFiles && <>
                    <button type="button" data-testid="sort-source-asc" disabled={busy}
                      onClick={() => commit(previous => sortPagesByFilename(previous, sources, locale, 'asc'))}>
                      {onlyImages ? t.sortFilename : t.sortPdfFilesAsc}</button>
                    <button type="button" data-testid="sort-source-desc" disabled={busy}
                      onClick={() => commit(previous => sortPagesByFilename(previous, sources, locale, 'desc'))}>
                      {onlyImages ? t.sortImagesDesc : t.sortPdfFilesDesc}</button>
                  </>}
                  <button type="button" data-testid="reverse-all-pages" disabled={busy} onClick={() => commit(reversePages)}>{onlyImages ? t.reverseOrder : t.reversePdfOrder}</button>
                </div>}
                {canSortSourceFiles && !onlyImages && <p className="input-note" data-testid="source-sort-hint">{t.sortPdfFilesHint}</p>}
                {canInterleaveDuplex && <details className="page-jump-panel duplex-interleave-panel" data-testid="duplex-interleave-panel">
                  <summary>{t.duplexToggle}</summary>
                  <p className="input-note" data-testid="duplex-interleave-hint">{interpolate(t.duplexHint, {
                    front: sourceLookup.get(sourceGroups[0].sourceId)?.name ?? t.document,
                    back: sourceLookup.get(sourceGroups[1].sourceId)?.name ?? t.document,
                  })}</p>
                  <div className="page-action-buttons">
                    <button type="button" data-testid="duplex-interleave-forward" disabled={busy}
                      onClick={() => interleaveDuplex(false)}>{t.duplexForward}</button>
                    <button type="button" data-testid="duplex-interleave-reverse" disabled={busy}
                      onClick={() => interleaveDuplex(true)}>{t.duplexReverse}</button>
                  </div>
                </details>}
                {pageView === 'grouped' ? (
                  <div className="source-groups" data-testid="source-groups">
                    <div className="source-group-actions">
                      <p className="input-note" data-testid="group-view-hint">{t.groupHint}</p>
                      <button type="button" disabled={busy} data-testid="source-groups-expand-all"
                        onClick={() => setCollapsedSources(new Set())}>{t.groupExpandAll}</button>
                      <button type="button" disabled={busy} data-testid="source-groups-collapse-all"
                        onClick={() => setCollapsedSources(new Set(sourceGroups.map(group => group.sourceId)))}>{t.groupCollapseAll}</button>
                    </div>
                    {sourceGroups.map(group => {
                      const source = sourceLookup.get(group.sourceId);
                      const collapsed = collapsedSources.has(group.sourceId);
                      const label = source?.name ?? t.document;
                      // A collapsed group can still own selected pages. Never hide
                      // that fact before destructive or bulk operations.
                      const selectedInGroup = group.items.reduce((total, item) => total + (selected.has(item.pageRef.id) ? 1 : 0), 0);
                      return (
                        <section className="source-group" data-testid="source-group" key={group.sourceId}
                          aria-label={label} data-source-id={group.sourceId}>
                          <div className="source-group-heading">
                            <button type="button" data-testid="source-group-toggle" disabled={busy}
                              aria-expanded={!collapsed} aria-controls={`source-pages-${group.sourceId}`}
                              aria-label={interpolate(collapsed ? t.groupExpand : t.groupCollapse, { name: label })}
                              onClick={() => toggleSourceCollapsed(group.sourceId)}>
                              <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                              <span className="source-group-name" title={label}>{label}</span>
                              <span className="source-group-count">{interpolate(t.groupPageCount, { pages: group.items.length })}</span>
                              {selectedInGroup > 0 && <span className="source-group-selected-count" data-testid="source-group-selected-count">
                                {interpolate(t.groupSelectedCount, { pages: selectedInGroup })}
                              </span>}
                            </button>
                            <button type="button" className="source-group-select" disabled={busy}
                              data-testid="source-group-select" onClick={() => {
                                setSelected(previous => new Set([...previous, ...group.items.map(item => item.pageRef.id)]));
                                lastSelectedIndex.current = null;
                                lastGroupedSelection.current = null;
                              }}>{t.all}</button>
                            {selectedInGroup > 0 && <button type="button" className="source-group-select" disabled={busy}
                              data-testid="source-group-deselect" onClick={() => {
                                const groupIds = new Set(group.items.map(item => item.pageRef.id));
                                setSelected(previous => new Set([...previous].filter(id => !groupIds.has(id))));
                                lastSelectedIndex.current = null;
                                lastGroupedSelection.current = null;
                              }}>{t.groupClearSelection}</button>}
                          </div>
                          {!collapsed && <div className="page-grid" id={`source-pages-${group.sourceId}`}
                            data-testid="source-group-pages">{groupedTiles(group)}</div>}
                        </section>
                      );
                    })}
                    <button type="button" className="button button-secondary button-small" disabled={busy}
                      onClick={() => inputRef.current?.click()}>{t.addMore}</button>
                  </div>
                ) : (
                <div className="page-grid" data-testid="page-grid" ref={pageGridRef}>
                  {pages.map((pageRef, index) => {
                    const source = sourceLookup.get(pageRef.sourceId);
                    return (
                      <div className={`page-tile ${selected.has(pageRef.id) ? 'is-selected' : ''} ${dragged === pageRef.id ? 'is-dragging' : ''} ${dropTarget?.id === pageRef.id ? 'is-drop-' + dropTarget.side : ''}`} key={pageRef.id} data-testid="page-tile" data-original-page={pageRef.pageIndex + 1}
                        data-export-position={index + 1} tabIndex={-1}
                        role="group" aria-label={interpolate(t.jumpPositionLabel, { n: index + 1 })}
                        data-drop-side={dropTarget?.id === pageRef.id ? dropTarget.side : undefined}
                        draggable={!busy} onDragStart={(event) => {
                          const ids = selected.has(pageRef.id) ? pages.filter((page) => selected.has(page.id)).map((page) => page.id) : [pageRef.id];
                          draggedPageIdsRef.current = ids;
                          event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-plainmile-pages', JSON.stringify(ids));
                          setDragged(pageRef.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          const movingIds = draggedPageIdsRef.current;
                          if (busy || !movingIds?.length || Array.from(event.dataTransfer.types || []).includes('Files')) return;
                          const side = pageDropSide(pages, movingIds, pageRef.id);
                          event.dataTransfer.dropEffect = side ? 'move' : 'none';
                          setDropTarget(previous =>
                            previous?.id === pageRef.id && previous.side === side ? previous :
                              side ? { id: pageRef.id, side } : null);
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) {
                            setDropTarget(previous => previous?.id === pageRef.id ? null : previous);
                          }
                        }}
                        onDrop={(event) => { event.stopPropagation(); onMoveDrop(event, pageRef.id); }}
                        onDragEnd={() => { draggedPageIdsRef.current = null; setDragged(null); setDropTarget(null); }}>
                        <label className="page-tile-checkbox"><input type="checkbox" checked={selected.has(pageRef.id)} disabled={busy} onChange={(event) => toggleSelection(pageRef.id, index, Boolean(event.nativeEvent?.shiftKey))} aria-label={locale === 'zh' ? `${t.selectPage} ${index + 1} 页` : `Select page ${index + 1}`} /></label>
                        <div className="tile-sequence">{String(index + 1).padStart(2, '0')}</div>
                        <PageThumbnail source={source} pageRef={pageRef} getPreviewDoc={getPreviewDoc} locale={locale} t={t}
          watermarkPreview={watermarkPreview} onOpen={setPreviewPageId} outputPosition={index + 1} busy={busy} />
                        <div className="tile-info" title={source?.name}><strong>{pageName(pageRef.pageIndex + 1)}</strong><small>{source?.name ?? t.document}</small></div>
                        <div className="tile-moves"><button type="button" disabled={index === 0 || busy} title={t.moveLeft.replace('{n}', index + 1)} aria-label={interpolate(t.moveLeft, { n: index + 1 })} onClick={() => commit((previous) => shiftPage(previous, pageRef.id, -1))}>←</button><span className="page-drag-handle" data-testid="page-drag-handle" title={t.dragTitle}
                          draggable={!busy} aria-hidden="true">⠿</span><button type="button" disabled={index === pages.length - 1 || busy} title={interpolate(t.moveRight, { n: index + 1 })} aria-label={interpolate(t.moveRight, { n: index + 1 })} onClick={() => commit((previous) => shiftPage(previous, pageRef.id, 1))}>→</button></div>
                      </div>
                    );
                  })}
                  <button type="button" className="add-more-tile" disabled={busy} onClick={() => inputRef.current?.click()}><span aria-hidden="true">＋</span>{t.addMore}</button>
                </div>
                )}
                <p className="page-grid-help">{pageView === 'grouped' ? t.groupHint : t.dragHint}</p>
              </section>
            ) : (
              <section className="split-panel" aria-label={t.splitTitle} role="tabpanel" id="workspace-panel-split" aria-labelledby="workspace-tab-split">
                <div className="split-intro"><div className="split-graphic" aria-hidden="true">1–3 <span>→</span> 4–6</div><h3>{t.splitTitle}</h3><p>{t.splitHint}</p></div>
                <div className="split-fields">
                  <label className="option-radio"><input type="radio" name="split-method" checked={splitMode === 'ranges'} disabled={busy} onChange={() => { setSplitMode('ranges'); setPendingVisualCut(null); }} />{t.byRanges}</label>
                  <label className="input-label" htmlFor="ranges-input">{t.pageRanges}</label>
                  <input id="ranges-input" value={ranges} onChange={(event) => { setRanges(event.target.value); setPendingVisualCut(null); }} disabled={splitMode !== 'ranges' || busy} placeholder="1-3, 4-6, 7" />
                  <p className="input-note">{t.rangeHint}</p>
                  <label className="option-radio option-divider"><input type="radio" name="split-method" checked={splitMode === 'chunks'} disabled={busy} onChange={() => { setSplitMode('chunks'); setPendingVisualCut(null); }} />{t.every}</label>
                  <label className="input-label" htmlFor="chunk-input">{t.perFile}</label>
                  <input id="chunk-input" type="number" min="1" max={pages.length} step="1" value={chunkSize} placeholder="5"
                    onChange={(event) => { setChunkSize(event.target.value); setSplitBatchIndex(0); }}
                    disabled={splitMode !== 'chunks' || busy} />
                  <div className="split-quick-action">
                    <button type="button" className="button button-secondary button-small"
                      data-testid="split-each-page" aria-pressed={splitMode === 'chunks' && Number(chunkSize) === 1}
                      disabled={busy}
                      onClick={() => { setSplitMode('chunks'); setChunkSize('1'); setSplitBatchIndex(0); setPendingVisualCut(null); setError(''); setNotice(''); }}>
                      {t.eachPagePreset}
                    </button>
                    {pages.length > 50 && <p className="input-note" data-testid="split-each-page-limit">
                      {interpolate(t.eachPageLimit, { pages: pages.length, batches: Math.ceil(pages.length / 50) })}
                    </p>}
                  </div>
                  {splitPlan?.batch && <div className="split-batch-nav" data-testid="split-batch-nav" aria-live="polite">
                    <strong data-testid="split-batch-status">{interpolate(t.splitBatchStatus, {
                      index: splitPlan.batch.index + 1, total: splitPlan.batch.total,
                      start: splitPlan.batch.start, end: splitPlan.batch.end,
                    })}</strong>
                    <div className="split-batch-buttons">
                      <button type="button" className="button button-secondary button-small" data-testid="split-batch-prev"
                        disabled={busy || safeSplitBatchIndex === 0}
                        onClick={() => { setSplitBatchIndex(Math.max(0, safeSplitBatchIndex - 1)); setError(''); setNotice(''); }}>
                        {t.splitBatchPrevious}
                      </button>
                      <button type="button" className="button button-secondary button-small" data-testid="split-batch-next"
                        disabled={busy || safeSplitBatchIndex + 1 >= splitPlan.batch.total}
                        onClick={() => { setSplitBatchIndex(safeSplitBatchIndex + 1); setError(''); setNotice(''); }}>
                        {t.splitBatchNext}
                      </button>
                    </div>
                    <p className="input-note">{t.splitBatchWarning}</p>
                  </div>}
                  {pages.length > 1 && <details className="split-visual-panel" data-testid="visual-split-panel"
                    open={visualSplitOpen} onToggle={event => setVisualSplitOpen(event.currentTarget.open)}>
                    <summary>{t.visualSplitToggle}</summary>
                    <p className="input-note">{t.visualSplitHint}</p>
                    {visualCuts?.length > 0 && splitMode === 'ranges' &&
                      <button type="button" className="button button-secondary button-small"
                        data-testid="visual-split-clear" disabled={busy}
                        onClick={() => applyVisualCuts([])}>{t.visualSplitClear}</button>}
                    {pendingVisualCut !== null && <div className="workspace-clear-confirm"
                      ref={visualConfirmRef} tabIndex={-1}
                      role="group" aria-label={t.visualSplitConfirmTitle}
                      data-testid="visual-split-confirm">
                      <p>{t.visualSplitConfirmText}</p>
                      <div className="workspace-clear-buttons">
                        <button type="button" className="button button-secondary button-small"
                          data-testid="visual-split-keep"
                          onClick={() => restoreVisualCutFocus(pendingVisualCut)}>{t.visualSplitKeep}</button>
                        <button type="button" className="button button-secondary button-small"
                          data-testid="visual-split-replace"
                          onClick={() => {
                            const afterPage = pendingVisualCut;
                            applyVisualCuts([afterPage]);
                            restoreVisualCutFocus(afterPage);
                          }}>{t.visualSplitReplace}</button>
                      </div>
                    </div>}
                    {visualSplitOpen && <div className="split-visual-grid" data-testid="visual-split-grid">
                      {pages.map((pageRef, index) => {
                        const afterPage = index + 1;
                        const isCut = Boolean(visualCuts?.includes(afterPage) && splitMode === 'ranges');
                        const source = sourceLookup.get(pageRef.sourceId);
                        return <div className={'split-visual-tile' + (isCut ? ' is-cut' : '')}
                          key={pageRef.id} data-testid="visual-split-page"
                          data-export-position={afterPage}>
                          <span className="split-visual-number">
                            {interpolate(t.visualSplitPage, { n: afterPage })}
                          </span>
                          <PageThumbnail source={source} pageRef={pageRef} getPreviewDoc={getPreviewDoc}
                            locale={locale} t={t} watermarkPreview={watermarkPreview}
                            onOpen={setPreviewPageId} outputPosition={afterPage} busy={busy} />
                          {afterPage < pages.length
                            ? <button type="button" className="button button-secondary button-small"
                                data-testid="visual-split-cut" data-after-page={afterPage}
                                aria-pressed={isCut} disabled={busy || pendingVisualCut !== null}
                                aria-label={interpolate(t.visualSplitCutAfter, { n: afterPage })}
                                onClick={() => toggleVisualCut(afterPage)}>
                                {isCut ? t.visualSplitUndoCut : t.visualSplitCut}
                              </button>
                            : <span className="split-visual-last">{t.visualSplitLast}</span>}
                        </div>;
                      })}
                    </div>}
                  </details>}
                  <div className="split-estimate" aria-live="polite">{splitEstimate === null ? (splitNeedsInput ? (splitMode === 'ranges' ? t.enterSplitRanges : t.enterSplitSize) : t.invalidRange) : interpolate(splitPlan?.batch ? t.splitBatchEstimate : t.estimate, { files: splitEstimate })}</div>
                  {splitPlan && <div className="split-coverage-review" aria-live="polite" data-testid="split-coverage-review">
                    {splitPlan.coverage.complete && <p className="input-note" data-testid="split-coverage-complete">{interpolate(t.splitCoverageComplete, { total: splitPlan.coverage.total })}</p>}
                    {!splitPlan.batch && splitPlan.coverage.omitted.length > 0 && <p className="utility-note" data-testid="split-coverage-omitted">{interpolate(t.splitCoverageOmitted, {
                      included: splitPlan.coverage.included,
                      total: splitPlan.coverage.total,
                      count: splitPlan.coverage.omitted.length,
                      pages: splitPlan.coverage.omitted.slice(0, 8).join(', ') + (splitPlan.coverage.omitted.length > 8 ? ', …' : ''),
                    })}</p>}
                    {splitPlan.coverage.repeated.length > 0 && <p className="utility-note" data-testid="split-coverage-repeated">{interpolate(t.splitCoverageRepeated, {
                      count: splitPlan.coverage.repeated.length,
                      pages: splitPlan.coverage.repeated.slice(0, 8).join(', ') + (splitPlan.coverage.repeated.length > 8 ? ', …' : ''),
                    })}</p>}
                    <details className="split-output-preview" data-testid="split-output-preview">
                      <summary>{interpolate(t.splitPreviewToggle, { files: splitPlan.parts.length })}</summary>
                      <ol>{splitPlan.parts.map((part, index) =>
                        <li key={index}>{interpolate(t.splitPreviewPart, {
                          index: index + 1, start: part.start, end: part.end, count: part.end - part.start + 1,
                          unit: part.end === part.start ? 'page' : 'pages',
                        })}</li>)}</ol>
                    </details>
                  </div>}
                   <p className="input-note" data-testid="split-output-budget">{t.splitOutputBudget}</p>
                   {splitProgress && <p className="utility-note" role="status" data-testid="split-progress" aria-live="polite">{splitProgress.phase === 'parts'
                     ? interpolate(t.splitPartsProgress, { done: splitProgress.done, total: splitProgress.total })
                     : interpolate(t.splitZipProgress, { percent: splitProgress.percent })}</p>}
                   {busy && splitProgress && <button type="button" className="button button-secondary button-small" data-testid="split-cancel" disabled={splitCancelling} onClick={() => { splitAbortRef.current?.abort(); setSplitCancelling(true); }}>{splitCancelling ? t.splitCancelling : t.splitCancel}</button>}
                  <button type="button" className="button button-primary split-download" onClick={downloadSplit} disabled={busy || splitEstimate === null || imageLayoutDirty}>{busy ? t.creating : splitEstimate === 1 ? t.downloadSingle : splitPlan?.batch ? t.splitBatchDownload : t.downloadZip} ↓</button>
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
