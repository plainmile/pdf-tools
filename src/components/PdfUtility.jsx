import React, { useEffect, useRef, useState } from 'react';
import { loadPdf, convertPdfToImages, compressPdfRaster, extractPdfText, textToPdf, addPageNumbers } from '../lib/pdfUtilities.mjs';
import { UTILITY_LIMITS, formatBytes, sanitizeFilename, imagePageBatch, batchIndexFromCustomPages, imagePageSelectionLabel, translateUtilityError, decodeImportedText, IMAGE_PRINT_SCALE } from '../lib/utilityCore.mjs';
import { saveDownload } from '../lib/pdfEngine.mjs';
import UnsavedNavigationGuard from './UnsavedNavigationGuard.jsx';

const COPY = {
  en: {
    label: 'Browser-local processing', file: 'Choose a PDF', textFile: 'Import TXT / Markdown', uploaded: 'Loaded', pages: 'pages', choose: 'Choose file', start: 'Process file', run: 'Convert and download', busy: 'Working on your device…',
    privacy: 'No files are uploaded. Processing may use significant device memory on large documents.', clear: 'Clear', replaceConfirmTitle: 'Replace the current file?', replaceConfirmHint: 'Opening {name} will discard your unsaved PDF result or edited text. Download or copy your current work first, or cancel this replacement.', replaceKeep: 'Keep current work', replaceAccept: 'Replace file', clearConfirmTitle: 'Discard unsaved conversion?', clearConfirmHint: 'The generated PDF preview or edited text has not been safely saved. Clearing now will remove it from this browser.', clearKeep: 'Keep my work', clearConfirm: 'Discard and clear',
    pageRange: 'Pages (blank selects all if ≤60)', rangeHint: 'Example: 301-360. Long PDFs start with pages 1-60; use Next pages for later batches. For custom orders like 3,1, ZIP filenames get order-001, order-002 prefixes so extracted files stay in your chosen order.', imageType: 'Image format', quality: 'Render resolution',
    low: 'Smaller (72 DPI)', medium: 'Balanced (108 DPI)', high: 'Sharper (144 DPI)', print: 'Print quality (220 DPI)', printHint: 'Best for printing. Large pages may be rejected to protect your device memory.',
    download: 'Download result', downloadAgain: 'Download again', compressionMethod: 'Compression level', compressionLow: 'Smaller size (lossier)', compressionMid: 'Balanced', compressionHigh: 'Clearer (larger)',
    compressionWarning: 'This method converts every PDF page into a JPEG image. Text stops being searchable or selectable. Forms, annotations, hyperlinks and signatures are not preserved. Keep the original and inspect the output.',
    original: 'Original', result: 'Result', saved: 'Saved', increased: 'Size increase', unchanged: 'No change', noSaving: 'No size reduction. This file was not downloaded; try a lower resolution or keep the original.',
    compressionReady: 'The output is smaller. Check text sharpness before using it.', compressionResultStale: 'This is the previous result, made with a different compression level. You can still download it, or run again with the new setting.', compressionRetryKept: 'The new attempt did not reduce file size. The numbers and download below still belong to your previous successful result.', previewCompressed: 'Preview compressed page 1', hidePreview: 'Hide preview',
    noSavingEarly: 'Stopped early: JPEG data already exceeds the original size. Keep the original or lower the resolution.',
    compressionLowerBound: 'At least', previewAction: 'Generate PDF preview', previewTitle: 'Generated PDF preview', previewFirst: 'Previewing page 1 of {pages}', previewFailed: 'Preview unavailable; you can still download the PDF.', downloadPdf: 'Download PDF',
    textWarning: 'Extracts existing selectable PDF text only, not OCR. Columns, tables and heading formatting may not be preserved. Check the exported text.',
    missingTextPages: 'Important: {missing} of {total} pages have no selectable text (pages {pages}). Those pages may be blank or scanned images. Their content was not extracted; OCR would be required for scanned text. Check your original PDF.',
    partialTextReady: 'Some PDF pages were not extracted. Review the warning before choosing to download this incomplete text file.',
    markdownWarning: 'Markdown conversion is approximate; headings are inferred from font size. Complex PDF layout cannot be faithfully recovered.',
    textLabel: 'Text to convert', textPlaceholder: 'Paste text here or import a .txt / .md file…',
    textInputHint: 'Import UTF-8 or BOM-marked UTF-16 text. Pages containing characters unsupported by built-in PDF fonts use local browser fonts as images; other pages keep selectable text.',
    markdownInputHint: 'Import UTF-8 or BOM-marked UTF-16 text. Supports basic headings, lists, quotes and code blocks, not external images, HTML or complex tables. Link addresses appear as text, not clickable links. Pages requiring unsupported glyphs become images; other pages remain searchable.',
    pageStart: 'First printed number', firstPage: 'Start numbering on PDF page', firstPageReset: 'The new PDF is shorter than the previous starting page. Numbering has been reset to PDF page 1.', firstPageHint: 'Pages before this page (such as a cover or contents) stay unnumbered. The first numbered page displays the number above.', pagePosition: 'Position', pageSize: 'Font size', bottomCenter: 'Bottom center', bottomRight: 'Bottom right', topRight: 'Top right',
    numbersHint: 'Adds selectable page numbers starting at the chosen PDF page, leaving earlier pages unnumbered. Preserves page size. Review annotations and digital signatures before using this modified file.',
    ready: 'Ready to download', noPdf: 'Select a PDF first.', noText: 'Enter text to convert.', sizeLimit: 'PDF up to 100 MB / 1,000 pages; TXT / Markdown up to 5 MB.', limitText: 'TXT / Markdown up to 5 MB; PDF output: up to 1,000 pages (300 image-based pages for CJK).', limitImages: 'PDF up to 100 MB / 1,000 pages; up to 60 selected image pages per batch.', limitCompression: 'PDF up to 100 MB / 120 pages; JPEG output safety budget 96 MB.', limitGeneral: 'PDF up to 100 MB / 1,000 pages.', heavyWarning: 'Large document: processing hundreds of pages may take time and require substantial device memory. Close other heavy tabs if necessary.', progressLabel: 'Processed {done} of {total} pages', tooMuchText: 'Text exceeds 5 MB.',
    noteUnicode: 'This PDF uses rasterized pages for non-Latin characters. Text in the result cannot be selected.', noteMixed: '{raster} of {pages} pages contain unsupported characters and are image-based. The other {searchable} pages retain selectable text.', noteSearch: 'Output text is selectable.',
    textResultStale: 'This PDF was generated from the previous text. You can still download this version; generate again to include your latest edits.',
    invalidFile: 'Please select a supported file and retry.', resultPreview: 'Extracted text preview', dropHint: 'Or drag a file here. Nothing is uploaded.', imported: 'Imported', multipleFiles: 'This converter accepts one file at a time. No file was replaced; choose a single file.', batchLabel: 'Image batch {current} of {total}', batchPrev: 'Previous pages', batchNext: 'Next pages', batchCustom: 'Custom page selection', batchCustomHint: 'Previous/Next work with standard 60-page batches. Return to batches to continue near your custom range.', batchResume: 'Return to page batches', cancel: 'Cancel', cancelling: 'Cancelling…', cancelled: 'Cancelled', packaging: 'Packaging ZIP: {percent}%', replacedFailed: 'Import failed. Previous file remains: {name}.', modified: 'Edited after import', nextStep: 'Browse other tools (files do not transfer automatically)', overlap: 'Page numbers are drawn over existing content. Check footers, stamps and existing numbers before using the result.',
  },
  zh: {
    label: '仅在浏览器本地处理', file: '选择 PDF 文件', textFile: '导入 TXT / Markdown', uploaded: '已读取', pages: '页', choose: '选择文件', start: '开始处理', run: '转换并下载', busy: '正在本机处理…',
    privacy: '文件不上传服务器。大文件可能消耗较多设备内存。', clear: '清空', replaceConfirmTitle: '确定替换当前文件？', replaceConfirmHint: '打开 {name} 将丢弃尚未下载的 PDF 结果或未保存的文字修改。请先下载或复制当前内容，也可以取消替换。', replaceKeep: '保留当前工作', replaceAccept: '确认替换文件', clearConfirmTitle: '确定丢弃未保存的转换结果？', clearConfirmHint: '当前生成的 PDF 预览或编辑后的文字尚未妥善保存。清空将从浏览器删除这些内容。', clearKeep: '继续编辑', clearConfirm: '丢弃并清空',
    pageRange: '选择页码（总页数不超过 60 时可留空）', rangeHint: '例如 301-360。长 PDF 默认选前 60 页，可用“下一批”继续。若输入 3,1 等自定义顺序，ZIP 文件名会加上 order-001、order-002 前缀，解压排序后也保持指定顺序。', imageType: '图片格式', quality: '渲染清晰度',
    low: '更小（72 DPI）', medium: '平衡（108 DPI）', high: '高清（144 DPI）', print: '打印高清（220 DPI）', printHint: '适合打印。超大页面可能因设备内存安全限制而无法转换。',
    download: '下载结果', downloadAgain: '再次下载', compressionMethod: '压缩强度', compressionLow: '更小体积（画质较低）', compressionMid: '平衡', compressionHigh: '画质较清晰（体积较大）',
    compressionWarning: '此压缩方式会将 PDF 各页重新渲染为 JPEG 图片。输出将失去文本搜索和选中能力，也无法保留表单、注释、链接及数字签名。请保存原文件并检查输出画质。',
    original: '原文件', result: '输出文件', saved: '节省', increased: '体积增加', unchanged: '无变化', noSaving: '未缩小文件，因此没有自动下载。可尝试降低清晰度，或保留原文件。',
    compressionReady: '输出文件确实更小。请先核对文字清晰度。', compressionResultStale: '这是之前压缩强度生成的结果。您仍可下载，或按当前设置重新处理。', compressionRetryKept: '新一轮处理未能缩小文件。下方的大小比较和下载按钮仍对应上一次成功的压缩结果。', previewCompressed: '预览压缩后的首页', hidePreview: '收起预览',
    noSavingEarly: '已提前停止：JPEG 数据已不小于原文件，继续转换也不能节省空间。请保留原文件或降低清晰度。',
    compressionLowerBound: '至少', previewAction: '生成 PDF 预览', previewTitle: '生成的 PDF 预览', previewFirst: '第 1 页预览（共 {pages} 页）', previewFailed: '无法生成预览，但仍可下载 PDF。', downloadPdf: '下载 PDF',
    textWarning: '只提取 PDF 中已有的可选择文字，不具备 OCR。多栏、表格和段落顺序可能不准确，请核对导出内容。',
    missingTextPages: '重要提示：共 {total} 页中有 {missing} 页未检测到可选择文字（第 {pages} 页）。这些页可能是空白页或扫描图片，其内容未被提取；扫描文字需要 OCR。请对照原始 PDF 核查。',
    partialTextReady: '有些 PDF 页面未能提取文字。请先查看缺页提示，再决定是否下载这份不完整的文字文件。',
    markdownWarning: 'Markdown 为近似转换：根据字号推测标题，复杂 PDF 的版式无法完整还原。',
    textLabel: '需要转换的文本', textPlaceholder: '粘贴文字，或选择 .txt / .md 文件……',
    textInputHint: '支持 UTF-8 或带 BOM 的 UTF-16 文本。含内置 PDF 字体不支持字符的页面将使用本地字体图片化，其他页面保留可选中、可搜索的文字。',
    markdownInputHint: '导入支持 UTF-8 或带 BOM 的 UTF-16。支持基础标题、列表、引用和代码块；不支持远程图片、HTML、完整表格或复杂 Markdown。链接地址显示为普通文字，不成为可点击的链接。需要特殊字体的页面会图片化，其他页面仍可搜索。',
    pageStart: '显示的起始数字', firstPage: '从 PDF 第几页开始编号', firstPageReset: '新 PDF 的页数不足以使用之前的起始编号位置，已重置为从 PDF 第 1 页开始。', firstPageHint: '前面的封面、目录等页面不会添加页码；开始编号的那一页使用上方指定的起始数字。', pagePosition: '页码位置', pageSize: '字号', bottomCenter: '底部居中', bottomRight: '右下角', topRight: '右上角',
    numbersHint: '从指定 PDF 页开始添加可选择的页码，前面的页面不添加页码；保持原有纸张尺寸。重要文件请检查注释和数字签名。',
    ready: '文件已经生成', noPdf: '请先选择 PDF 文件。', noText: '请输入待转换的文字。', sizeLimit: 'PDF 最多 100 MB / 1000 页；TXT / Markdown 最多 5 MB。', limitText: 'TXT / Markdown 最多 5 MB；输出最多 1000 页（中文等图片化内容最多 300 页）。', limitImages: 'PDF 最多 100 MB / 1000 页；每批最多导出选定的 60 页图片。', limitCompression: 'PDF 最多 100 MB / 120 页；JPEG 数据累计上限 96 MB。', limitGeneral: 'PDF 最多 100 MB / 1000 页。', heavyWarning: '大文档提示：处理数百页时可能占用较多设备内存，并需要更长时间。建议关闭其他高负载标签页。', progressLabel: '已处理 {done} / {total} 页', tooMuchText: '文本内容超过 5 MB。',
    noteUnicode: '由于含有非拉丁文字，此 PDF 输出为图片页，无法选择和搜索文字。', noteMixed: '共 {pages} 页，其中 {raster} 页含有内置字体不支持的字符，已图片化；其余 {searchable} 页仍可选择和搜索文字。', noteSearch: '输出文字可选择和搜索。',
    textResultStale: '此 PDF 由修改前的文字生成，尚未包含最新编辑。可以下载这个旧版本，或重新生成 PDF。',
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
  // React busy state is a display flag, NOT an admission lock. Two same-tick
  // native drops or Run events can otherwise both start asynchronous work.
  const operationRef = useRef(false);
  // Keep a replacement in RAM until the user chooses to discard unsaved work.
  // Ref synchronously reserves the slot against duplicate same-tick drops.
  const pendingReplacementRef = useRef(null);
  const [pendingReplacementName, setPendingReplacementName] = useState('');
  const [textEdited, setTextEdited] = useState(false);
  const [textRevision, setTextRevision] = useState(0);
  const [notDownloaded, setNotDownloaded] = useState(false);
  const [pdf, setPdf] = useState(null);
  const [sourceText, setSourceText] = useState('');
  const [pages, setPages] = useState('');
  const [format, setFormat] = useState('jpg');
  const [scale, setScale] = useState('1.5');
  const [compressMode, setCompressMode] = useState('balanced');
  const [start, setStart] = useState('1');
  const [firstPage, setFirstPage] = useState('1');
  const [position, setPosition] = useState('bottom-center');
  const [fontSize, setFontSize] = useState('12');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [output, setOutput] = useState(null);
  const [preview, setPreview] = useState('');
  const [extractionWarning, setExtractionWarning] = useState('');
  const [showCompressionPreview, setShowCompressionPreview] = useState(false);
  const [compressionRetryKept, setCompressionRetryKept] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [textFileName, setTextFileName] = useState('');
  const [batchIndex, setBatchIndex] = useState(0);
  const [clearConfirm, setClearConfirm] = useState(false);
  // A preview awaiting download, or text edited/typed only in this tab, must
  // not be discarded via an unconfirmed Clear click.
  const hasUnsavedUtilityWork = Boolean((output?.bytes && notDownloaded) ||
    (isTextInput && sourceText.trim() && (!textFileName || textEdited)));
  const inputLocked = busy || Boolean(pendingReplacementName);
  const textResultStale = Boolean(isTextInput && output?.bytes && output.textRevision !== textRevision);


  function clearOutput() { setClearConfirm(false); setOutput(null); setNotice(''); setError(''); setPreview(''); setExtractionWarning(''); setProgress(null); setShowCompressionPreview(false); setCompressionRetryKept(false); setNotDownloaded(true); }
  function clearSession() {
    if (operationRef.current) return;
    setPdf(null); setSourceText(''); setPages(''); setTextFileName('');
    setTextEdited(false); setTextRevision(0); setBatchIndex(0);
    clearOutput(); setNotDownloaded(false);
  }
  function reset() {
    if (operationRef.current || pendingReplacementRef.current) return;
    if (hasUnsavedUtilityWork) { setClearConfirm(true); return; }
    clearSession();
  }
  function requestFile(file) {
    if (!file || operationRef.current || pendingReplacementRef.current) return;
    // An obviously unsupported/empty/oversized input must be rejected right
    // away, WITHOUT asking the user to abandon a valuable unsaved result.
    // PDF content corruption is checked by the existing parser after consent.
    const validType = isTextInput ? /\.(?:txt|md|markdown)$/i.test(file.name)
      : /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const maximum = isTextInput ? UTILITY_LIMITS.maxTextBytes : UTILITY_LIMITS.maxPdfBytes;
    if (!validType || !file.size || file.size > maximum) {
      const message = !validType
        ? isTextInput ? t.invalidFile : locale === 'zh' ? '请选择 PDF 文件。' : 'Choose a PDF file.'
        : isTextInput ? t.invalidFile : locale === 'zh'
          ? 'PDF 文件大小须在 1 字节至 100 MB 之间。' : 'PDF must be between 1 byte and 100 MB.';
      const existing = pdf?.name || textFileName;
      setError(message + (existing ? ' ' + t.replacedFailed.replace('{name}', existing) : ''));
      return;
    }
    if (hasUnsavedUtilityWork) {
      pendingReplacementRef.current = file;
      setPendingReplacementName(file.name || t.file);
      setDragging(false);
      setClearConfirm(false);
      return;
    }
    void acceptFile(file);
  }
  function cancelReplacement() {
    pendingReplacementRef.current = null;
    setPendingReplacementName('');
  }
  function confirmReplacement() {
    const file = pendingReplacementRef.current;
    cancelReplacement();
    if (file) void acceptFile(file);
  }
  async function acceptFile(file) {
    if (!file || operationRef.current) return;
    // Reserve synchronously before awaiting PDF parsing or File.text().
    operationRef.current = true;
    // A failed replacement must preserve the previously generated result,
    // preview and download button, not just the old input document.
    setError('');
    setBusy(true);
    try {
      if (isTextInput) {
        if (!/\.(?:txt|md|markdown)$/i.test(file.name) || !file.size || file.size > UTILITY_LIMITS.maxTextBytes) throw new Error(t.invalidFile);
        const content = decodeImportedText(new Uint8Array(await file.arrayBuffer()), locale);
        // UTF-16 can be smaller on disk than the UTF-8 text we actually
        // convert. Reject at import time, before discarding the previous
        // draft or generated PDF, instead of failing only after Run.
        if (new TextEncoder().encode(content).length > UTILITY_LIMITS.maxTextBytes) {
          throw new Error(t.tooMuchText);
        }
        clearOutput();
        setSourceText(content);
        setTextRevision(previous => previous + 1);
        setTextFileName(file.name);
        setTextEdited(false);
      } else {
        const loaded = await loadPdf(file, mode, locale);
        clearOutput();
        setPdf(loaded);
        if (mode === 'add-page-numbers' &&
            (!Number.isSafeInteger(Number(firstPage)) || Number(firstPage) < 1 || Number(firstPage) > loaded.count)) {
          // The old file may have 100 pages and the new one only two. Do not
          // silently carry an impossible physical page number into Run.
          setFirstPage('1');
          setNotice(t.firstPageReset);
        }
        setBatchIndex(0);
        setPages(mode === 'pdf-to-images' && loaded.count > UTILITY_LIMITS.maxImagePagesPerRun
          ? imagePageBatch(loaded.count).range : '');
      }
    } catch (e) {
      setError(translateUtilityError(e, locale) + ((pdf || textFileName) ? ' ' + t.replacedFailed.replace('{name}', pdf?.name || textFileName) : ''));
    } finally { operationRef.current = false; setBusy(false); }
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    requestFile(file);
  }
  function chooseBatch(index) {
    if (!pdf || operationRef.current || pendingReplacementRef.current) return;
    setBatchIndex(index);
    setPages(imagePageBatch(pdf.count, index).range);
    clearOutput();
  }
  function resumeImageBatches() {
    if (!pdf || operationRef.current || pendingReplacementRef.current) return;
    const index = batchIndexFromCustomPages(pages, pdf.count, batchIndex);
    chooseBatch(index);
  }
  function save(outputFile) {
    saveDownload(outputFile.bytes, outputFile.name, outputFile.mime || 'application/pdf');
    // Downloading an earlier PDF does not save new nonempty text edits.
    // When the textarea is empty and the only retained PDF is downloaded,
    // neither a new text draft nor undownloaded result remains to protect.
    setNotDownloaded(Boolean(isTextInput && outputFile.textRevision !== textRevision && sourceText.trim()));
  }
  async function processFile() {
    if (operationRef.current || pendingReplacementRef.current) return;
    operationRef.current = true; // Prevent a second Run during the same event turn.
    // Keep successfully generated PDF bytes available while adjusting text
    // or retrying a conversion. Failed/cancelled attempts cannot erase the
    // last undownloaded result. Replacing a valid source still requires consent.
    if (isCompress || isTextInput || isTextOutput) {
      // Retain an incomplete text extraction until the user downloads or replaces it.
      // A failed/cancelled retry must not erase the only recoverable result.
      setClearConfirm(false); setNotice(''); setError(''); setProgress(null);
      setShowCompressionPreview(false);
    } else {
      clearOutput();
    }
    setBusy(true); setProcessing(true); setCancelling(false);
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
        if (candidate.stats.smaller && candidate.bytes) {
          setOutput({ bytes: candidate.bytes, mime: 'application/pdf',
            name: `${pdfName}-compressed.pdf`, stats: candidate.stats, compressionMode: compressMode });
          setNotDownloaded(true);
          setCompressionRetryKept(false);
          setNotice(t.compressionReady);
        } else if (output?.bytes) {
          // "No savings" is a completed conversion, not an exception. Never
          // overwrite the prior valid PDF just because this retry is worse.
          // Keep its original stats, preview, bytes and undownloaded guard.
          setCompressionRetryKept(true);
          // The previous PDF remains valid; a green success toast would
          // misdescribe this unsuccessful retry. The result banner explains it.
          setNotice('');
        } else {
          setOutput({ bytes: null, mime: 'application/pdf',
            name: `${pdfName}-compressed.pdf`, stats: candidate.stats, compressionMode: compressMode });
          setNotDownloaded(false);
          setCompressionRetryKept(false);
          setNotice(candidate.stats.lowerBound ? t.noSavingEarly : t.noSaving);
        }
      } else if (isTextOutput) {
        const markdown = mode === 'pdf-to-markdown';
        let textCoverage = null;
        const value = await extractPdfText(pdf, markdown, report, controller.signal,
          coverage => { textCoverage = coverage; });
        ensureNotCancelled();
        const incomplete = Boolean(textCoverage?.missingPages.length);
        if (incomplete) {
          const { missingPages, total } = textCoverage;
          const previewPages = missingPages.slice(0, 6).join(', ') +
            (missingPages.length > 6 ? ', …' : '');
          setExtractionWarning(t.missingTextPages
            .replace('{missing}', missingPages.length)
            .replace('{total}', total)
            .replace('{pages}', previewPages));
        } else {
          setExtractionWarning('');
        }
        setPreview(value.slice(0, 1600));
        result = { bytes: new TextEncoder().encode(value), mime: 'text/plain;charset=utf-8', name: `${pdfName}.${markdown ? 'md' : 'txt'}` };
        if (incomplete) {
          // Never auto-download a file that silently omits some source pages.
          // Keep it for explicit review and allow repeated download after consent.
          setOutput({ ...result, partialText: true });
          setNotDownloaded(true);
          setNotice('');
        } else {
          // Keep successful full extractions available for a second download.
          // This does not change the existing one-click automatic download.
          setOutput({ ...result, partialText: false });
          save(result);
          setNotice(`${t.ready}: ${formatBytes(result.bytes.length)}`);
        }
      } else if (isTextInput) {
        const encoded = new TextEncoder().encode(sourceText);
        if (!sourceText.trim()) throw new Error(t.noText);
        if (encoded.length > UTILITY_LIMITS.maxTextBytes) throw new Error(t.tooMuchText);
        const created = await textToPdf(sourceText, mode === 'markdown-to-pdf', { signal: controller.signal });
        ensureNotCancelled();
        const baseName = textFileName ? sanitizeFilename(textFileName) : 'plainmile-text';
        result = { bytes: created.bytes, pageCount: created.pageCount,
          name: `${baseName}-${mode === 'markdown-to-pdf' ? 'markdown' : 'plain'}.pdf` };
        setOutput({ ...result, textRevision });
        setNotDownloaded(true);
        const searchNotice = created.rasterPages === 0 ? t.noteSearch
          : created.rasterPages === created.pageCount ? t.noteUnicode
            : t.noteMixed.replace('{raster}', String(created.rasterPages))
              .replace('{pages}', String(created.pageCount))
              .replace('{searchable}', String(created.pageCount - created.rasterPages));
        setNotice(`${t.ready}: ${created.pageCount} ${t.pages} · ${formatBytes(created.bytes.length)} · ${searchNotice}`);
      } else if (mode === 'add-page-numbers') {
        result = { bytes: await addPageNumbers(pdf, { start: Number(start), firstPage: Number(firstPage), position, fontSize: Number(fontSize), signal: controller.signal }, report), name: `${pdfName}-numbered.pdf` };
        ensureNotCancelled();
        save(result);
        setNotice(`${t.ready}: ${pdf.count} ${t.pages}`);
      }
    } catch (e) { setError(translateUtilityError(e, locale)); }
    finally { taskRef.current = null; operationRef.current = false; setBusy(false); setProcessing(false); setCancelling(false); }
  }

  const isImages = mode === 'pdf-to-images';
  const imageBatch = isImages && pdf && pdf.count > UTILITY_LIMITS.maxImagePagesPerRun
    ? imagePageBatch(pdf.count, batchIndex) : null;
  const customImageRange = Boolean(imageBatch && pages !== imageBatch.range);
  const limitHint = isTextInput ? t.limitText : isCompress ? t.limitCompression : isImages ? t.limitImages : t.limitGeneral;
  const description = isCompress ? t.compressionWarning : isTextOutput ? `${t.textWarning} ${mode === 'pdf-to-markdown' ? t.markdownWarning : ''}` : isTextInput ? mode === 'markdown-to-pdf' ? t.markdownInputHint : t.textInputHint : mode === 'add-page-numbers' ? t.numbersHint : t.privacy;
  return (
    <section className="pdf-workspace pdf-utility" data-testid="pdf-utility">
      <UnsavedNavigationGuard active={Boolean(notDownloaded && (pdf || textFileName || sourceText.trim() || output?.bytes))} locale={locale} />
      <div className="workspace-bar"><div className="workspace-heading"><span className="workspace-app-icon" aria-hidden="true">▤</span><div><strong>{t.label}</strong><span>{t.privacy}</span></div></div></div>
      <div className="utility-main">
        <div className={`utility-dropzone${dragging ? ' is-dragging-over' : ''}`} data-testid="utility-dropzone"
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
            event.preventDefault();
            if (!inputLocked) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (!event.dataTransfer.files?.length) return;
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            if (operationRef.current || pendingReplacementRef.current) return;
            if (event.dataTransfer.files.length > 1) {
              // Reject without erasing a valid, possibly undownloaded result.
              setError(t.multipleFiles);
              return;
            }
            requestFile(event.dataTransfer.files[0]);
          }}>
          <label className="utility-file">
            <span className="utility-field-label">{isTextInput ? t.textFile : t.file}</span>
            <input data-testid="utility-file-input" type="file"
              accept={isTextInput ? '.txt,.md,.markdown,text/plain,text/markdown' : '.pdf,application/pdf'}
              disabled={inputLocked} onChange={chooseFile} />
          </label>
          <span className="utility-drop-hint">{t.dropHint}</span>
        </div>
        {isTextInput && textFileName && <div className="utility-file-summary" data-testid="text-file-summary"><strong>{t.imported}: {textFileName}{textEdited ? ` · ${t.modified}` : ''}</strong><button type="button" disabled={inputLocked} onClick={reset}>{t.clear}</button></div>}
        {pdf && <div className="utility-file-summary" data-testid="utility-file-summary"><strong>{pdf.name}</strong><span>{formatBytes(pdf.size)} · {pdf.count} {t.pages}</span><button type="button" onClick={reset} disabled={inputLocked}>{t.clear}</button></div>}
        {pendingReplacementName && !busy && <div className="workspace-clear-confirm" role="group"
          aria-label={t.replaceConfirmTitle} data-testid="utility-replace-confirm">
          <p>{t.replaceConfirmHint.replace('{name}', pendingReplacementName)}</p>
          <div className="workspace-clear-buttons">
            <button type="button" className="button button-secondary button-small" data-testid="utility-replace-keep"
              onClick={cancelReplacement}>{t.replaceKeep}</button>
            <button type="button" className="button button-secondary button-small muted-danger" data-testid="utility-replace-accept"
              onClick={confirmReplacement}>{t.replaceAccept}</button>
          </div>
        </div>}
        {clearConfirm && !busy && <div className="workspace-clear-confirm" role="group"
          aria-label={t.clearConfirmTitle} data-testid="utility-clear-confirm">
          <p>{t.clearConfirmHint}</p>
          <div className="workspace-clear-buttons">
            <button type="button" className="button button-secondary button-small"
              data-testid="utility-clear-keep" onClick={() => setClearConfirm(false)}>{t.clearKeep}</button>
            <button type="button" className="button button-secondary button-small muted-danger"
              data-testid="utility-clear-confirm-button" onClick={clearSession}>{t.clearConfirm}</button>
          </div>
        </div>}
        {pdf && (pdf.count >= 250 || pdf.size >= 75 * 1024 * 1024) && <p className="utility-note" data-testid="large-document-note">{t.heavyWarning}</p>}
        {isTextInput && <label className="utility-text-input"><span className="utility-field-label">{t.textLabel}</span><textarea data-testid="utility-text" rows={10} maxLength={UTILITY_LIMITS.maxTextBytes} placeholder={t.textPlaceholder} value={sourceText} onChange={e => { setSourceText(e.target.value); setTextRevision(previous => previous + 1); setTextEdited(Boolean(textFileName)); setNotDownloaded(true); setClearConfirm(false); setNotice(''); setError(''); setProgress(null); }} disabled={inputLocked} /></label>}
        {isTextInput && !textFileName && sourceText.trim() && <button type="button"
          className="button button-secondary button-small" data-testid="utility-text-clear"
          disabled={inputLocked} onClick={reset}>{t.clear}</button>}
        {mode === 'pdf-to-images' && <div className="utility-options">
          <label><span>{t.imageType}</span><select aria-label={t.imageType} value={format} disabled={inputLocked} onChange={e => { setFormat(e.target.value); clearOutput(); }}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
          <label><span>{t.quality}</span><select aria-label={t.quality} value={scale} disabled={inputLocked} onChange={e => { setScale(e.target.value); clearOutput(); }}><option value="1">{t.low}</option><option value="1.5">{t.medium}</option><option value="2">{t.high}</option><option value={String(IMAGE_PRINT_SCALE)}>{t.print}</option></select></label>
          <label><span>{t.pageRange}</span><input data-testid="utility-page-ranges" value={pages} disabled={inputLocked} onChange={e => { setPages(e.target.value); clearOutput(); }} placeholder="1-3, 5" /></label>
        </div>}
        {isImages && <p className="utility-helper">{t.rangeHint}</p>}
        {isImages && scale === String(IMAGE_PRINT_SCALE) && <p className="utility-note" data-testid="image-print-hint">{t.printHint}</p>}
        {imageBatch && <div className="utility-batch-nav" data-testid="utility-batch-nav">
          <span>{customImageRange
            ? t.batchCustom
            : t.batchLabel.replace('{current}', batchIndex + 1).replace('{total}', imageBatch.total)}</span>
          <div role="group" aria-label={customImageRange ? t.batchCustom : t.batchLabel.replace('{current}', batchIndex + 1).replace('{total}', imageBatch.total)}>
            <button type="button" data-testid="utility-batch-prev" disabled={inputLocked || customImageRange || batchIndex === 0}
              onClick={() => chooseBatch(batchIndex - 1)}>← {t.batchPrev}</button>
            <button type="button" data-testid="utility-batch-next" disabled={inputLocked || customImageRange || batchIndex >= imageBatch.total - 1}
              onClick={() => chooseBatch(batchIndex + 1)}>{t.batchNext} →</button>
          </div>
          {customImageRange && <div className="utility-batch-custom" data-testid="utility-batch-custom">
            <p className="utility-note">{t.batchCustomHint}</p>
            <button type="button" className="button button-secondary button-small"
              data-testid="utility-batch-resume" onClick={resumeImageBatches} disabled={inputLocked}>{t.batchResume}</button>
          </div>}
        </div>}
        {isCompress && <div className="utility-options"><label><span>{t.compressionMethod}</span><select aria-label={t.compressionMethod} value={compressMode} disabled={inputLocked} onChange={e => { setCompressMode(e.target.value); setNotice(''); setError(''); }}><option value="compact">{t.compressionLow}</option><option value="balanced">{t.compressionMid}</option><option value="clearer">{t.compressionHigh}</option></select></label></div>}
        {mode === 'add-page-numbers' && <div className="utility-options">
          <label><span>{t.pageStart}</span><input data-testid="number-start" type="number" min="1" max="99999" value={start} disabled={inputLocked} onChange={e => { setStart(e.target.value); clearOutput(); }} /></label>
          <label><span>{t.firstPage}</span><input data-testid="number-first-pdf-page" type="number" min="1" max={pdf?.count || UTILITY_LIMITS.maxPages} step="1" value={firstPage} disabled={inputLocked} onChange={e => { setFirstPage(e.target.value); clearOutput(); }} /></label>
          <label><span>{t.pagePosition}</span><select aria-label={t.pagePosition} value={position} disabled={inputLocked} onChange={e => { setPosition(e.target.value); clearOutput(); }}><option value="bottom-center">{t.bottomCenter}</option><option value="bottom-right">{t.bottomRight}</option><option value="top-right">{t.topRight}</option></select></label>
          <label><span>{t.pageSize}</span><select aria-label={t.pageSize} value={fontSize} disabled={inputLocked} onChange={e => { setFontSize(e.target.value); clearOutput(); }}><option value="10">10</option><option value="12">12</option><option value="16">16</option></select></label>
        </div>}
        <p className="utility-note">{description}</p>
        {mode === 'add-page-numbers' && <p className="input-note" data-testid="number-first-page-hint">{t.firstPageHint}</p>}
        {mode === 'add-page-numbers' && <p className="utility-note" data-testid="page-overlap-warning">{t.overlap}</p>}
        <div className="utility-actions"><button type="button" className="button button-primary" data-testid="utility-run" onClick={processFile} disabled={inputLocked || (isTextInput ? !sourceText.trim() : !pdf)}>{busy ? t.busy : isCompress ? t.start : isTextInput ? t.previewAction : t.run}{isTextInput || isCompress ? '' : ' ↓'}</button><span>{limitHint}</span></div>
        {busy && processing && <button type="button" className="button button-secondary" data-testid="utility-cancel" disabled={cancelling} onClick={() => { setCancelling(true); taskRef.current?.abort(); }}>{cancelling ? t.cancelling : t.cancel}</button>}
        {progress && (busy || notice) && <p className="utility-note" data-testid="utility-progress" aria-live="polite">{'packaging' in progress ? t.packaging.replace('{percent}', progress.packaging) : t.progressLabel.replace('{done}', progress.done).replace('{total}', progress.total)}</p>}
        {isCompress && output && <div className="utility-result" data-testid="compression-result">
          <div className="utility-comparison"><div><span>{t.original}</span><strong>{formatBytes(output.stats.original)}</strong></div><div><span>{t.result}</span><strong>{output.stats.lowerBound ? `${t.compressionLowerBound} ` : ''}{formatBytes(output.stats.candidate)}</strong></div><div><span data-testid="compression-change-label">{output.stats.smaller ? t.saved : output.stats.candidate > output.stats.original ? t.increased : t.unchanged}</span><strong data-testid="compression-change-value" className={output.stats.smaller ? 'utility-smaller' : output.stats.candidate > output.stats.original ? 'utility-not-smaller' : ''}>{Math.abs(output.stats.percent)}%</strong></div></div>
          {output.compressionMode !== compressMode && <p className="utility-note" role="status" data-testid="compression-result-stale">{t.compressionResultStale}</p>}
          {compressionRetryKept && <p className="utility-note" role="status" data-testid="compression-retry-kept">{t.compressionRetryKept}</p>}
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
          {textResultStale && <p className="utility-note" role="status" data-testid="text-result-stale">{t.textResultStale}</p>}
          <PdfFirstPagePreview bytes={output.bytes} pageCount={output.pageCount} locale={locale} t={t} />
          <button type="button" className="button button-primary" data-testid="utility-pdf-download"
            onClick={() => save(output)}>{t.downloadPdf} ↓</button>
        </div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {notice && <div className="notice notice-success" role="status">{notice}</div>}
        {extractionWarning && <div className="utility-note" role="alert"
          data-testid="text-extraction-warning">{extractionWarning}</div>}
        {isTextOutput && output?.bytes && <div className="utility-result"
          data-testid={output.partialText ? 'partial-text-result' : 'complete-text-result'}>
          {output.partialText && <p className="utility-note">{t.partialTextReady}</p>}
          <button type="button" className="button button-primary"
            data-testid={output.partialText ? 'partial-text-download' : 'complete-text-download'}
            onClick={() => save(output)}>{output.partialText ? t.download : t.downloadAgain} ↓</button>
        </div>}
        {notice && <p className="utility-note" data-testid="utility-next-step"><a href={locale === 'zh' ? '/zh/#all-tools' : '/#all-tools'}>{t.nextStep} →</a></p>}
        {isTextOutput && preview && <div className="utility-preview"><label className="utility-field-label" htmlFor="utility-preview">{t.resultPreview}</label><textarea id="utility-preview" readOnly rows={8} value={preview} /></div>}
      </div>
      <div className="workspace-foot"><span>✓ {t.privacy}</span></div>
    </section>
  );
}
