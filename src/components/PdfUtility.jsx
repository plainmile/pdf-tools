import React, { useEffect, useRef, useState } from 'react';
import { loadPdf, convertPdfToImages, compressPdfRaster, extractPdfText, textToPdf, addPageNumbers } from '../lib/pdfUtilities.mjs';
import { UTILITY_LIMITS, formatBytes, sanitizeFilename, imagePageBatch, batchIndexFromCustomPages, imagePageSelectionLabel, translateUtilityError } from '../lib/utilityCore.mjs';
import { saveDownload } from '../lib/pdfEngine.mjs';
import UnsavedNavigationGuard from './UnsavedNavigationGuard.jsx';

const COPY = {
  en: {
    label: 'Browser-local processing', file: 'Choose a PDF', textFile: 'Import TXT / Markdown', uploaded: 'Loaded', pages: 'pages', choose: 'Choose file', start: 'Process file', run: 'Convert and download', busy: 'Working on your device…',
    privacy: 'No files are uploaded. Processing may use significant device memory on large documents.', clear: 'Clear',
    pageRange: 'Pages (blank selects all if ≤60)', rangeHint: 'Example: 301-360. Long PDFs start with pages 1-60; use Next pages for later batches.', imageType: 'Image format', quality: 'Render resolution',
    low: 'Smaller (72 DPI)', medium: 'Balanced (108 DPI)', high: 'Sharper (144 DPI)',
    download: 'Download result', compressionMethod: 'Compression level', compressionLow: 'Smaller size (lossier)', compressionMid: 'Balanced', compressionHigh: 'Clearer (larger)',
    compressionWarning: 'This method converts every PDF page into a JPEG image. Text stops being searchable or selectable. Forms, annotations, hyperlinks and signatures are not preserved. Keep the original and inspect the output.',
    original: 'Original', result: 'Result', saved: 'Saved', increased: 'Size increase', unchanged: 'No change', noSaving: 'No size reduction. This file was not downloaded; try a lower resolution or keep the original.',
    compressionReady: 'The output is smaller. Check text sharpness before using it.', previewCompressed: 'Preview compressed page 1', hidePreview: 'Hide preview',
    noSavingEarly: 'Stopped early: JPEG data already exceeds the original size. Keep the original or lower the resolution.',
    compressionLowerBound: 'At least', previewAction: 'Generate PDF preview', previewTitle: 'Generated PDF preview', previewFirst: 'Previewing page 1 of {pages}', previewFailed: 'Preview unavailable; you can still download the PDF.', downloadPdf: 'Download PDF',
    textWarning: 'Extracts existing selectable PDF text only, not OCR. Columns, tables and heading formatting may not be preserved. Check the exported text.',
    markdownWarning: 'Markdown conversion is approximate; headings are inferred from font size. Complex PDF layout cannot be faithfully recovered.',
    textLabel: 'Text to convert', textPlaceholder: 'Paste text here or import a .txt / .md file…',
    textInputHint: 'Plain text is exported as selectable PDF text where the built-in font supports it. Chinese and other unsupported characters are rendered with local browser fonts as image pages (not searchable).',
    markdownInputHint: 'Supports simple headings, paragraphs, lists, quotes and code blocks; does not render external images, HTML, full tables or complex Markdown. Non-Latin scripts are drawn as page images.',
    pageStart: 'Starting number', pagePosition: 'Position', pageSize: 'Font size', bottomCenter: 'Bottom center', bottomRight: 'Bottom right', topRight: 'Top right',
    numbersHint: 'Adds selectable numbers to every page and preserves page size. Review annotations and digital signatures before using this modified file.',
    ready: 'Ready to download', noPdf: 'Select a PDF first.', noText: 'Enter text to convert.', sizeLimit: 'PDF up to 100 MB / 1,000 pages; TXT / Markdown up to 5 MB.', limitText: 'TXT / Markdown up to 5 MB; PDF output: up to 1,000 pages (300 image-based pages for CJK).', limitImages: 'PDF up to 100 MB / 1,000 pages; up to 60 selected image pages per batch.', limitCompression: 'PDF up to 100 MB / 120 pages; JPEG output safety budget 96 MB.', limitGeneral: 'PDF up to 100 MB / 1,000 pages.', heavyWarning: 'Large document: processing hundreds of pages may take time and require substantial device memory. Close other heavy tabs if necessary.', progressLabel: 'Processed {done} of {total} pages', tooMuchText: 'Text exceeds 5 MB.',
    noteUnicode: 'This PDF uses rasterized pages for non-Latin characters. Text in the result cannot be selected.', noteSearch: 'Output text is selectable.',
    invalidFile: 'Please select a supported file and retry.', resultPreview: 'Extracted text preview', dropHint: 'Or drag a file here. Nothing is uploaded.', imported: 'Imported', multipleFiles: 'This converter accepts one file at a time. No file was replaced; choose a single file.', batchLabel: 'Image batch {current} of {total}', batchPrev: 'Previous pages', batchNext: 'Next pages', batchCustom: 'Custom page selection', batchCustomHint: 'Previous/Next work with standard 60-page batches. Return to batches to continue near your custom range.', batchResume: 'Return to page batches', cancel: 'Cancel', cancelling: 'Cancelling…', cancelled: 'Cancelled', packaging: 'Packaging ZIP: {percent}%', replacedFailed: 'Import failed. Previous file remains: {name}.', modified: 'Edited after import', nextStep: 'Browse other tools (files do not transfer automatically)', overlap: 'Page numbers are drawn over existing content. Check footers, stamps and existing numbers before using the result.',
  },
  zh: {
    label: '仅在浏览器本地处理', file: '选择 PDF 文件', textFile: '导入 TXT / Markdown', uploaded: '已读取', pages: '页', choose: '选择文件', start: '开始处理', run: '转换并下载', busy: '正在本机处理…',
    privacy: '文件不上传服务器。大文件可能消耗较多设备内存。', clear: '清空',
    pageRange: '选择页码（总页数不超过 60 时可留空）', rangeHint: '例如 301-360。长 PDF 默认选前 60 页，可用“下一批”继续。', imageType: '图片格式', quality: '渲染清晰度',
    low: '更小（72 DPI）', medium: '平衡（108 DPI）', high: '高清（144 DPI）',
    download: '下载结果', compressionMethod: '压缩强度', compressionLow: '更小体积（画质较低）', compressionMid: '平衡', compressionHigh: '画质较清晰（体积较大）',
    compressionWarning: '此压缩方式会将 PDF 各页重新渲染为 JPEG 图片。输出将失去文本搜索和选中能力，也无法保留表单、注释、链接及数字签名。请保存原文件并检查输出画质。',
    original: '原文件', result: '输出文件', saved: '节省', increased: '体积增加', unchanged: '无变化', noSaving: '未缩小文件，因此没有自动下载。可尝试降低清晰度，或保留原文件。',
    compressionReady: '输出文件确实更小。请先核对文字清晰度。', previewCompressed: '预览压缩后的首页', hidePreview: '收起预览',
    noSavingEarly: '已提前停止：JPEG 数据已不小于原文件，继续转换也不能节省空间。请保留原文件或降低清晰度。',
    compressionLowerBound: '至少', previewAction: '生成 PDF 预览', previewTitle: '生成的 PDF 预览', previewFirst: '第 1 页预览（共 {pages} 页）', previewFailed: '无法生成预览，但仍可下载 PDF。', downloadPdf: '下载 PDF',
    textWarning: '只提取 PDF 中已有的可选择文字，不具备 OCR。多栏、表格和段落顺序可能不准确，请核对导出内容。',
    markdownWarning: 'Markdown 为近似转换：根据字号推测标题，复杂 PDF 的版式无法完整还原。',
    textLabel: '需要转换的文本', textPlaceholder: '粘贴文字，或选择 .txt / .md 文件……',
    textInputHint: '支持浏览器本地转换。拉丁文字尽量保留可选中内容；中文等字符会使用本地字体渲染为图片页，输出不支持文字搜索。',
    markdownInputHint: '支持基础标题、段落、列表、引用和代码块；不支持远程图片、HTML、完整表格或复杂 Markdown。中文会渲染为图片页。',
    pageStart: '起始页码', pagePosition: '页码位置', pageSize: '字号', bottomCenter: '底部居中', bottomRight: '右下角', topRight: '右上角',
    numbersHint: '在每页添加可选择的数字，保持纸张尺寸。重要文件请检查注释、数字签名等内容。',
    ready: '文件已经生成', noPdf: '请先选择 PDF 文件。', noText: '请输入待转换的文字。', sizeLimit: 'PDF 最多 100 MB / 1000 页；TXT / Markdown 最多 5 MB。', limitText: 'TXT / Markdown 最多 5 MB；输出最多 1000 页（中文等图片化内容最多 300 页）。', limitImages: 'PDF 最多 100 MB / 1000 页；每批最多导出选定的 60 页图片。', limitCompression: 'PDF 最多 100 MB / 120 页；JPEG 数据累计上限 96 MB。', limitGeneral: 'PDF 最多 100 MB / 1000 页。', heavyWarning: '大文档提示：处理数百页时可能占用较多设备内存，并需要更长时间。建议关闭其他高负载标签页。', progressLabel: '已处理 {done} / {total} 页', tooMuchText: '文本内容超过 5 MB。',
    noteUnicode: '由于含有非拉丁文字，此 PDF 输出为图片页，无法选择和搜索文字。', noteSearch: '输出文字可选择和搜索。',
    invalidFile: '请选择受支持的文件后重试。', resultPreview: '提取文字预览', dropHint: '也可以将文件拖到这里，不会上传至服务器。', imported: '已导入', multipleFiles: '此转换工具每次只接受一个文件。当前文件未改变，请只选择一个文件。', batchLabel: '图片批次 {current} / {total}', batchPrev: '上一批', batchNext: '下一批', batchCustom: '自定义页码范围', batchCustomHint: '“上一批 / 下一批”按每 60 页导航。先返回批次模式，才能从自定义页码附近继续。', batchResume: '返回分批浏览', cancel: '取消处理', cancelling: '正在取消…', cancelled: '已取消', packaging: '正在打包 ZIP：{percent}%', replacedFailed: '导入失败，当前仍是旧文件：{name}。', modified: '导入后已修改', nextStep: '查看其他工具（文件不会自动带入）', overlap: '页码会直接叠加在原页面上，可能遮挡页脚、印章或已有页码，使用前请核对。',
  },
};


function PdfFirstPagePreview({ bytes, pageCount, t, locale }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let closed = false, task, loadingTask, pdfPage;
    const canvas = canvasRef.current;
    setFailed(false);
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (closed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const doc = await loadingTask.promise;
      if (closed) return;
      pdfPage = await doc.getPage(1);
      if (closed) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(1, 550 / base.width) });
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.style.width = viewport.width + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Preview canvas unavailable');
      ctx.setTransform(density, 0, 0, density, 0, 0);
      task = pdfPage.render({ canvasContext: ctx, canvas, viewport });
      await task.promise;
    })().catch(error => {
      if (!closed && error?.name !== 'RenderingCancelledException') setFailed(true);
    });
    return () => {
      closed = true;
      task?.cancel();
      pdfPage?.cleanup();
      loadingTask?.destroy().catch(() => {});
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    };
  }, [bytes]);
  return <div className="utility-preview" data-testid="utility-pdf-preview">
    <strong>{t.previewTitle}</strong>
    <p className="utility-note">{t.previewFirst.replace('{pages}', pageCount)}</p>
    <canvas ref={canvasRef} role="img" aria-label={locale === 'zh' ? 'PDF 首页预览' : 'PDF first page preview'}
      style={{ maxWidth: '100%', height: 'auto', display: failed ? 'none' : 'block' }} />
    {failed && <p className="utility-note">{t.previewFailed}</p>}
  </div>;
}

const TEXT_INPUT_MODES = new Set(['txt-to-pdf', 'markdown-to-pdf']);
const TEXT_OUTPUT_MODES = new Set(['pdf-to-txt', 'pdf-to-markdown']);

export default function PdfUtility({ mode, locale = 'en' }) {
  const t = COPY[locale] || COPY.en;
  const isTextInput = TEXT_INPUT_MODES.has(mode);
  const isTextOutput = TEXT_OUTPUT_MODES.has(mode);
  const isCompress = mode === 'compress-pdf';
  const taskRef = useRef(null);
  const [textEdited, setTextEdited] = useState(false);
  const [notDownloaded, setNotDownloaded] = useState(false);
  const [pdf, setPdf] = useState(null);
  const [sourceText, setSourceText] = useState('');
  const [pages, setPages] = useState('');
  const [format, setFormat] = useState('jpg');
  const [scale, setScale] = useState('1.5');
  const [compressMode, setCompressMode] = useState('balanced');
  const [start, setStart] = useState('1');
  const [position, setPosition] = useState('bottom-center');
  const [fontSize, setFontSize] = useState('12');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [output, setOutput] = useState(null);
  const [preview, setPreview] = useState('');
  const [showCompressionPreview, setShowCompressionPreview] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [textFileName, setTextFileName] = useState('');
  const [batchIndex, setBatchIndex] = useState(0);

  function clearOutput() { setOutput(null); setNotice(''); setError(''); setPreview(''); setProgress(null); setShowCompressionPreview(false); setNotDownloaded(true); }
  function reset() { if (busy) return; setPdf(null); setSourceText(''); setPages(''); setTextFileName(''); setTextEdited(false); setBatchIndex(0); clearOutput(); setNotDownloaded(false); }
  async function acceptFile(file) {
    if (!file || busy) return;
    // A failed replacement must preserve the previously generated result,
    // preview and download button, not just the old input document.
    setError('');
    setBusy(true);
    try {
      if (isTextInput) {
        if (!/\.(?:txt|md|markdown)$/i.test(file.name) || !file.size || file.size > UTILITY_LIMITS.maxTextBytes) throw new Error(t.invalidFile);
        const content = await file.text();
        clearOutput();
        setSourceText(content);
        setTextFileName(file.name);
        setTextEdited(false);
      } else {
        const loaded = await loadPdf(file, mode, locale);
        clearOutput();
        setPdf(loaded);
        setBatchIndex(0);
        setPages(mode === 'pdf-to-images' && loaded.count > UTILITY_LIMITS.maxImagePagesPerRun
          ? imagePageBatch(loaded.count).range : '');
      }
    } catch (e) {
      setError(translateUtilityError(e, locale) + ((pdf || textFileName) ? ' ' + t.replacedFailed.replace('{name}', pdf?.name || textFileName) : ''));
    } finally { setBusy(false); }
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    await acceptFile(file);
  }
  function chooseBatch(index) {
    if (!pdf) return;
    setBatchIndex(index);
    setPages(imagePageBatch(pdf.count, index).range);
    clearOutput();
  }
  function resumeImageBatches() {
    if (!pdf || busy) return;
    const index = batchIndexFromCustomPages(pages, pdf.count, batchIndex);
    chooseBatch(index);
  }
  function save(outputFile) {
    saveDownload(outputFile.bytes, outputFile.name, outputFile.mime || 'application/pdf');
    setNotDownloaded(false);
  }
  async function processFile() {
    if (busy) return;
    clearOutput(); setBusy(true); setProcessing(true); setCancelling(false);
    const controller = new AbortController();
    taskRef.current = controller;
    const ensureNotCancelled = () => { if (controller.signal.aborted) throw new Error('Processing cancelled.'); };
    // Throttle UI re-renders for book-length documents.
    const report = (done, total) => {
      if (!controller.signal.aborted && (done === total || done === 1 || done % 10 === 0)) setProgress({ done, total });
    };
    try {
      const pdfName = pdf ? sanitizeFilename(pdf.name) : 'document';
      if (!isTextInput && !pdf) throw new Error(t.noPdf);
      let result;
      if (mode === 'pdf-to-images') {
        result = await convertPdfToImages(pdf, { format, scale: Number(scale), pages, locale, signal: controller.signal, onPackagingProgress: percent => setProgress({ packaging: percent }) }, report);
        ensureNotCancelled();
        // Reuse the validated range parser; a fullwidth input like ３０１－３０６
        // must not collapse to an anonymous images.zip with ambiguous naming.
        const selectedRange = imagePageSelectionLabel(pages, pdf.count);
        result.name = result.count === 1 ? `${pdfName}-${result.name}` : selectedRange ? `${pdfName}-pages-${selectedRange}.zip` : `${pdfName}-images.zip`;
        save(result);
        setNotice(`${t.ready}: ${result.count} ${t.pages} · ${formatBytes(result.bytes.length)}`);
      } else if (isCompress) {
        const options = {
          compact: { scale: .75, quality: .55 }, balanced: { scale: 1, quality: .7 }, clearer: { scale: 1.5, quality: .8 },
        }[compressMode];
        const candidate = await compressPdfRaster(pdf, { ...options, locale, signal: controller.signal }, report);
        ensureNotCancelled();
        setOutput({ bytes: candidate.stats.smaller ? candidate.bytes : null,
          mime: 'application/pdf', name: `${pdfName}-compressed.pdf`, stats: candidate.stats });
        setNotice(candidate.stats.smaller ? t.compressionReady : candidate.stats.lowerBound ? t.noSavingEarly : t.noSaving);
      } else if (isTextOutput) {
        const markdown = mode === 'pdf-to-markdown';
        const value = await extractPdfText(pdf, markdown, report, controller.signal);
        ensureNotCancelled();
        setPreview(value.slice(0, 1600));
        result = { bytes: new TextEncoder().encode(value), mime: 'text/plain;charset=utf-8', name: `${pdfName}.${markdown ? 'md' : 'txt'}` };
        save(result);
        setNotice(`${t.ready}: ${formatBytes(result.bytes.length)}`);
      } else if (isTextInput) {
        const encoded = new TextEncoder().encode(sourceText);
        if (!sourceText.trim()) throw new Error(t.noText);
        if (encoded.length > UTILITY_LIMITS.maxTextBytes) throw new Error(t.tooMuchText);
        const created = await textToPdf(sourceText, mode === 'markdown-to-pdf', { signal: controller.signal });
        ensureNotCancelled();
        const baseName = textFileName ? sanitizeFilename(textFileName) : 'plainmile-text';
        result = { bytes: created.bytes, pageCount: created.pageCount,
          name: `${baseName}-${mode === 'markdown-to-pdf' ? 'markdown' : 'plain'}.pdf` };
        setOutput(result);
        setNotice(`${t.ready}: ${created.pageCount} ${t.pages} · ${formatBytes(created.bytes.length)} · ${created.searchable ? t.noteSearch : t.noteUnicode}`);
      } else if (mode === 'add-page-numbers') {
        result = { bytes: await addPageNumbers(pdf, { start: Number(start), position, fontSize: Number(fontSize), signal: controller.signal }, report), name: `${pdfName}-numbered.pdf` };
        ensureNotCancelled();
        save(result);
        setNotice(`${t.ready}: ${pdf.count} ${t.pages}`);
      }
    } catch (e) { setError(translateUtilityError(e, locale)); }
    finally { taskRef.current = null; setBusy(false); setProcessing(false); setCancelling(false); }
  }

  const isImages = mode === 'pdf-to-images';
  const imageBatch = isImages && pdf && pdf.count > UTILITY_LIMITS.maxImagePagesPerRun
    ? imagePageBatch(pdf.count, batchIndex) : null;
  const customImageRange = Boolean(imageBatch && pages !== imageBatch.range);
  const limitHint = isTextInput ? t.limitText : isCompress ? t.limitCompression : isImages ? t.limitImages : t.limitGeneral;
  const description = isCompress ? t.compressionWarning : isTextOutput ? `${t.textWarning} ${mode === 'pdf-to-markdown' ? t.markdownWarning : ''}` : isTextInput ? mode === 'markdown-to-pdf' ? t.markdownInputHint : t.textInputHint : mode === 'add-page-numbers' ? t.numbersHint : t.privacy;
  return (
    <section className="pdf-workspace pdf-utility" data-testid="pdf-utility">
      <UnsavedNavigationGuard active={Boolean(notDownloaded && (pdf || textFileName || sourceText.trim()))} locale={locale} />
      <div className="workspace-bar"><div className="workspace-heading"><span className="workspace-app-icon" aria-hidden="true">▤</span><div><strong>{t.label}</strong><span>{t.privacy}</span></div></div></div>
      <div className="utility-main">
        <div className={`utility-dropzone${dragging ? ' is-dragging-over' : ''}`} data-testid="utility-dropzone"
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (!event.dataTransfer.files?.length) return;
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            if (event.dataTransfer.files.length > 1) {
              // Reject without erasing a valid, possibly undownloaded result.
              setError(t.multipleFiles);
              return;
            }
            void acceptFile(event.dataTransfer.files[0]);
          }}>
          <label className="utility-file">
            <span className="utility-field-label">{isTextInput ? t.textFile : t.file}</span>
            <input data-testid="utility-file-input" type="file"
              accept={isTextInput ? '.txt,.md,.markdown,text/plain,text/markdown' : '.pdf,application/pdf'}
              disabled={busy} onChange={chooseFile} />
          </label>
          <span className="utility-drop-hint">{t.dropHint}</span>
        </div>
        {isTextInput && textFileName && <div className="utility-file-summary" data-testid="text-file-summary"><strong>{t.imported}: {textFileName}{textEdited ? ` · ${t.modified}` : ''}</strong><button type="button" disabled={busy} onClick={reset}>{t.clear}</button></div>}
        {pdf && <div className="utility-file-summary" data-testid="utility-file-summary"><strong>{pdf.name}</strong><span>{formatBytes(pdf.size)} · {pdf.count} {t.pages}</span><button type="button" onClick={reset} disabled={busy}>{t.clear}</button></div>}
        {pdf && (pdf.count >= 250 || pdf.size >= 75 * 1024 * 1024) && <p className="utility-note" data-testid="large-document-note">{t.heavyWarning}</p>}
        {isTextInput && <label className="utility-text-input"><span className="utility-field-label">{t.textLabel}</span><textarea data-testid="utility-text" rows={10} maxLength={UTILITY_LIMITS.maxTextBytes} placeholder={t.textPlaceholder} value={sourceText} onChange={e => { setSourceText(e.target.value); setTextEdited(Boolean(textFileName)); clearOutput(); }} disabled={busy} /></label>}
        {mode === 'pdf-to-images' && <div className="utility-options">
          <label><span>{t.imageType}</span><select aria-label={t.imageType} value={format} onChange={e => { setFormat(e.target.value); clearOutput(); }}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
          <label><span>{t.quality}</span><select aria-label={t.quality} value={scale} onChange={e => { setScale(e.target.value); clearOutput(); }}><option value="1">{t.low}</option><option value="1.5">{t.medium}</option><option value="2">{t.high}</option></select></label>
          <label><span>{t.pageRange}</span><input data-testid="utility-page-ranges" value={pages} onChange={e => { setPages(e.target.value); clearOutput(); }} placeholder="1-3, 5" /></label>
        </div>}
        {isImages && <p className="utility-helper">{t.rangeHint}</p>}
        {imageBatch && <div className="utility-batch-nav" data-testid="utility-batch-nav">
          <span>{customImageRange
            ? t.batchCustom
            : t.batchLabel.replace('{current}', batchIndex + 1).replace('{total}', imageBatch.total)}</span>
          <div role="group" aria-label={customImageRange ? t.batchCustom : t.batchLabel.replace('{current}', batchIndex + 1).replace('{total}', imageBatch.total)}>
            <button type="button" data-testid="utility-batch-prev" disabled={busy || customImageRange || batchIndex === 0}
              onClick={() => chooseBatch(batchIndex - 1)}>← {t.batchPrev}</button>
            <button type="button" data-testid="utility-batch-next" disabled={busy || customImageRange || batchIndex >= imageBatch.total - 1}
              onClick={() => chooseBatch(batchIndex + 1)}>{t.batchNext} →</button>
          </div>
          {customImageRange && <div className="utility-batch-custom" data-testid="utility-batch-custom">
            <p className="utility-note">{t.batchCustomHint}</p>
            <button type="button" className="button button-secondary button-small"
              data-testid="utility-batch-resume" onClick={resumeImageBatches} disabled={busy}>{t.batchResume}</button>
          </div>}
        </div>}
        {isCompress && <div className="utility-options"><label><span>{t.compressionMethod}</span><select aria-label={t.compressionMethod} value={compressMode} onChange={e => { setCompressMode(e.target.value); clearOutput(); }}><option value="compact">{t.compressionLow}</option><option value="balanced">{t.compressionMid}</option><option value="clearer">{t.compressionHigh}</option></select></label></div>}
        {mode === 'add-page-numbers' && <div className="utility-options">
          <label><span>{t.pageStart}</span><input data-testid="number-start" type="number" min="1" max="99999" value={start} onChange={e => { setStart(e.target.value); clearOutput(); }} /></label>
          <label><span>{t.pagePosition}</span><select aria-label={t.pagePosition} value={position} onChange={e => { setPosition(e.target.value); clearOutput(); }}><option value="bottom-center">{t.bottomCenter}</option><option value="bottom-right">{t.bottomRight}</option><option value="top-right">{t.topRight}</option></select></label>
          <label><span>{t.pageSize}</span><select aria-label={t.pageSize} value={fontSize} onChange={e => { setFontSize(e.target.value); clearOutput(); }}><option value="10">10</option><option value="12">12</option><option value="16">16</option></select></label>
        </div>}
        <p className="utility-note">{description}</p>
        {mode === 'add-page-numbers' && <p className="utility-note" data-testid="page-overlap-warning">{t.overlap}</p>}
        <div className="utility-actions"><button type="button" className="button button-primary" data-testid="utility-run" onClick={processFile} disabled={busy || (isTextInput ? !sourceText.trim() : !pdf)}>{busy ? t.busy : isCompress ? t.start : isTextInput ? t.previewAction : t.run}{isTextInput || isCompress ? '' : ' ↓'}</button><span>{limitHint}</span></div>
        {busy && processing && <button type="button" className="button button-secondary" data-testid="utility-cancel" disabled={cancelling} onClick={() => { setCancelling(true); taskRef.current?.abort(); }}>{cancelling ? t.cancelling : t.cancel}</button>}
        {progress && (busy || notice) && <p className="utility-note" data-testid="utility-progress" aria-live="polite">{'packaging' in progress ? t.packaging.replace('{percent}', progress.packaging) : t.progressLabel.replace('{done}', progress.done).replace('{total}', progress.total)}</p>}
        {isCompress && output && <div className="utility-result" data-testid="compression-result">
          <div className="utility-comparison"><div><span>{t.original}</span><strong>{formatBytes(output.stats.original)}</strong></div><div><span>{t.result}</span><strong>{output.stats.lowerBound ? `${t.compressionLowerBound} ` : ''}{formatBytes(output.stats.candidate)}</strong></div><div><span data-testid="compression-change-label">{output.stats.smaller ? t.saved : output.stats.candidate > output.stats.original ? t.increased : t.unchanged}</span><strong data-testid="compression-change-value" className={output.stats.smaller ? 'utility-smaller' : output.stats.candidate > output.stats.original ? 'utility-not-smaller' : ''}>{Math.abs(output.stats.percent)}%</strong></div></div>
          {output.bytes && <button type="button" className="button button-secondary" data-testid="compression-preview-action"
            aria-expanded={showCompressionPreview} aria-controls="compression-preview-content"
            onClick={() => setShowCompressionPreview(value => !value)}>
            {showCompressionPreview ? t.hidePreview : t.previewCompressed}
          </button>}
          {showCompressionPreview && output.bytes && <div id="compression-preview-content" data-testid="compression-preview">
            <PdfFirstPagePreview bytes={output.bytes} pageCount={pdf.count} t={t} locale={locale} />
          </div>}
          <button type="button" className="button button-primary" data-testid="compression-download" disabled={!output.stats.smaller || !output.bytes} onClick={() => save(output)}>{t.download} ↓</button>
        </div>}
        {isTextInput && output?.bytes && <div className="utility-result" data-testid="text-pdf-result">
          <PdfFirstPagePreview bytes={output.bytes} pageCount={output.pageCount} locale={locale} t={t} />
          <button type="button" className="button button-primary" data-testid="utility-pdf-download"
            onClick={() => save(output)}>{t.downloadPdf} ↓</button>
        </div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {notice && <div className="notice notice-success" role="status">{notice}</div>}
        {notice && <p className="utility-note" data-testid="utility-next-step"><a href={locale === 'zh' ? '/zh/#all-tools' : '/#all-tools'}>{t.nextStep} →</a></p>}
        {isTextOutput && preview && <div className="utility-preview"><label className="utility-field-label" htmlFor="utility-preview">{t.resultPreview}</label><textarea id="utility-preview" readOnly rows={8} value={preview} /></div>}
      </div>
      <div className="workspace-foot"><span>✓ {t.privacy}</span></div>
    </section>
  );
}
