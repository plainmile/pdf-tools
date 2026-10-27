import React, { useEffect, useRef, useState } from 'react';
import { loadPdf, readFileArrayBuffer, convertPdfToImages, compressPdfRaster, compressPdfStructure, extractPdfText, textToPdf, addPageNumbers } from '../lib/pdfUtilities.mjs';
import { UTILITY_LIMITS, formatBytes, sanitizeFilename, imagePageBatch, batchIndexFromCustomPages, imagePageSelectionLabel, translateUtilityError, decodeImportedText, textFitsUtf8Budget, IMAGE_PRINT_SCALE, requestedPages, validateNumberingPlan } from '../lib/utilityCore.mjs';
import { saveDownload } from '../lib/pdfEngine.mjs';
import UnsavedNavigationGuard from './UnsavedNavigationGuard.jsx';

const COPY = {
  en: {
    label: 'Browser-local processing', file: 'Choose a PDF', textFile: 'Import TXT / Markdown', uploaded: 'Loaded', pages: 'pages', choose: 'Choose file', start: 'Process file', run: 'Convert and download', busy: 'Working on your device…',
    privacy: 'No files are uploaded. Processing may use significant device memory on large documents.', clear: 'Clear', loadingFile: 'Opening file locally…', cancelLoad: 'Cancel opening', fileLoadCancelled: 'File opening cancelled. Your previous file and unsaved work were kept.', replaceConfirmTitle: 'Replace the current file?', replaceConfirmHint: 'Opening {name} may discard an undownloaded PDF, a JPG/PNG/ZIP/TXT/MD automatic download not yet verified, or edited text. Verify or download your current work first, or cancel this replacement.', replaceKeep: 'Keep current work', replaceAccept: 'Replace file', clearConfirmTitle: 'Discard unsaved conversion?', clearConfirmHint: 'Some work has not been safely saved. This may include a JPG/PNG/ZIP/TXT/MD download retry, a generated PDF or edited text. Clearing now removes the in-tab copy.', clearKeep: 'Keep my work', clearConfirm: 'Discard and clear',
    pageRange: 'Pages (blank selects all if ≤60)', imageRangeInvalid: 'Enter valid pages from 1 to {pages} (for example 1-3, 5). Each range must go forward.', imageRangeTooMany: 'Select at most 60 pages per conversion. Use the page batches for a longer PDF.', rangeHint: 'Example: 301- or 301-360. A trailing dash selects through the final PDF page (still at most 60 images per batch). Long PDFs start with pages 1-60; use Next pages for later batches. Repeated or overlapping page numbers are exported only once. For custom orders like 3,1, ZIP entries get order-001, order-002 prefixes so extracted files stay in your chosen order.', imageType: 'Image format', quality: 'Render resolution',
    low: 'Smaller (72 DPI)', medium: 'Balanced (108 DPI)', high: 'Sharper (144 DPI)', print: 'Print quality (220 DPI)', printHint: 'Best for printing. Large pages may be rejected to protect your device memory.',
    download: 'Download result', downloadAgain: 'Download again', imageDownloadStarted: 'Automatic image download started.', imageDownloadFallback: 'Check the JPG, PNG or ZIP in Downloads. If absent, use Download again without converting. If saved, use I saved the file to stop leave warnings.', textAutoDownloadFallback: 'Check Downloads for the TXT or Markdown file. If it was blocked, use Download again; if saved, confirm below.', confirmSaved: 'I saved the file', imageResultStale: 'Previous result: this file was generated with earlier image settings. Download again still gets that file. Run conversion to apply the current settings.', compressionMethod: 'Compression method', compressionLevel: 'Compression level', compressionStructure: 'Keep selectable text (try document optimization)', compressionRaster: 'Smaller images (convert pages to JPEG)', compressionLow: 'Smaller size (lossier)', compressionMid: 'Balanced', compressionHigh: 'Clearer (larger)',
    structureWarning: 'Tries smaller PDF object streams without turning text into images. Results may not shrink. PDF bytes are rewritten, so digital signatures become invalid and complex forms, links, bookmarks or attachments must be checked. Keep your original.', structureReady: 'The optimized PDF is smaller. Text remains selectable; compare important links and form fields with your original.', structureNoSaving: 'Rewriting the document did not make it smaller. No download is offered; keep the original or explicitly choose image-based compression.', compressionWarning: 'This method converts every PDF page into a JPEG image. Text stops being searchable or selectable. Forms, annotations, hyperlinks and signatures are not preserved. Keep the original and inspect the output.',
    original: 'Original', result: 'Result', saved: 'Saved', increased: 'Size increase', unchanged: 'No change', noSaving: 'No size reduction. This file was not downloaded; try a lower resolution or keep the original.',
    compressionReady: 'The output is smaller. Check text sharpness before using it.', compressionResultStale: 'This is the previous result, made with different compression settings. You can still download it, or run again with the new setting.', compressionRetryKept: 'The new attempt did not reduce file size. The numbers and download below still belong to your previous successful result.', previewCompressed: 'Preview compressed page 1', hidePreview: 'Hide preview',
    noSavingEarly: 'Stopped early: JPEG data already exceeds the original size. Keep the original or lower the resolution.',
    compressionLowerBound: 'At least', previewAction: 'Generate PDF preview', previewTitle: 'Generated PDF preview', previewFirst: 'Previewing page 1 of {pages}', previewFailed: 'Preview unavailable; you can still download the PDF.', previewRetry: 'Retry preview', downloadPdf: 'Download PDF',
    textWarning: 'Extracts existing selectable PDF text and common filled text/dropdown form fields, not OCR. Columns, tables and complex forms may need review.',
    textOrderLabel: 'Text reading order', textOrderRows: 'By rows (single-column documents and tables)', textOrderLeft: 'Two columns: left first', textOrderRight: 'Two columns: right first', textOrderHint: 'For newspapers and side-by-side articles. Full-width headings, tables and complex layouts can still need manual review.', textOrderStale: 'This download uses your previous reading order. Convert again to apply the new selection.',
    missingTextPages: 'Important: {missing} of {total} pages have no selectable text (pages {pages}). Those pages may be blank or scanned images. Their content was not extracted; OCR would be required for scanned text. Check your original PDF.',
    partialTextReady: 'Some PDF pages were not extracted. Review the warning before choosing to download this incomplete text file.', imageOnlyTextWarning: 'Review before downloading: {count} of {total} pages have images but very little selectable text (pages {pages}). Scanned text may be inside those images and was NOT extracted. These may also be ordinary illustrated pages. Compare with your original; this tool does not run OCR.', imageOnlyTextReady: 'Possible missing text inside images. Automatic download was paused; review the warning and download explicitly if the result is suitable.', formFieldWarning: 'This PDF contains interactive form fields. Visible filled text and dropdown values are included when exposed by PDF.js, but checkbox/radio states, signatures and unsupported or hidden form fields may be missing. Verify the original PDF before downloading.', formFieldReady: 'Interactive PDF form detected. Review extracted field values and any missing controls before downloading.',
    markdownWarning: 'Markdown conversion is approximate; headings are inferred from font size. Complex PDF layout cannot be faithfully recovered.',
    textLabel: 'Text to convert', textPlaceholder: 'Paste text here or import a .txt / .md file…',
    textInputHint: 'Import UTF-8 or BOM-marked UTF-16 text. Pages containing characters unsupported by built-in PDF fonts use local browser fonts as images; other pages keep selectable text.',
    markdownInputHint: 'Import UTF-8 or BOM-marked UTF-16 text. Supports basic headings, lists, quotes and code blocks, not external images, HTML or complex tables. Link addresses appear as text, not clickable links. Pages requiring unsupported glyphs become images; other pages remain searchable.',
    pageStart: 'First printed number', numberPlanStartInvalid: 'Enter a whole starting number from 1 to 99999.', numberPlanFirstInvalid: 'Choose a PDF page number from 1 to {pages}.', numberPlanOverflow: 'The last printed page number would exceed 99999. Lower the starting number or start numbering later.', firstPage: 'Start numbering on PDF page', firstPageReset: 'The new PDF is shorter than the previous starting page. Numbering has been reset to PDF page 1.', firstPageHint: 'Pages before this page (such as a cover or contents) stay unnumbered. The first numbered page displays the number above.', pagePosition: 'Position', pageSize: 'Font size', pageMargin: 'Spacing from edges', marginNarrow: 'Narrow (12 pt)', marginNormal: 'Normal (24 pt)', marginWide: 'Wide (40 pt)', bottomLeft: 'Bottom left', bottomCenter: 'Bottom center', bottomRight: 'Bottom right', topLeft: 'Top left', topCenter: 'Top center', topRight: 'Top right', customPreview: 'Choose a PDF page', customPage: 'PDF page to preview', previewPreparing: 'Preparing the selected page…', invalidPreviewPage: 'Choose a whole page number between 1 and {pages}.',
    numbersHint: 'Adds selectable page numbers starting at the chosen PDF page, leaving earlier pages unnumbered. Preserves page size. Review annotations and digital signatures before using this modified file.',
    numberedResultStale: 'This preview is from your previous page-number settings. Generate again to apply the current settings; you can still download the earlier PDF.', numberedPreviousDownload: 'Download previous PDF',
    ready: 'Ready to download', noPdf: 'Select a PDF first.', noText: 'Enter text to convert.', sizeLimit: 'PDF up to 100 MB / 1,000 pages; TXT / Markdown up to 5 MB.', limitText: 'TXT / Markdown up to 5 MB; PDF output: up to 1,000 pages (300 image-based pages for CJK).', limitImages: 'PDF up to 100 MB / 1,000 pages; up to 60 selected image pages per batch.', limitCompression: 'PDF up to 100 MB / 120 pages.', limitCompressionRaster: 'PDF up to 100 MB / 120 pages; JPEG output safety budget 96 MB.', limitGeneral: 'PDF up to 100 MB / 1,000 pages.', heavyWarning: 'Large document: processing hundreds of pages may take time and require substantial device memory. Close other heavy tabs if necessary.', progressLabel: 'Processed {done} of {total} pages', tooMuchText: 'Text exceeds 5 MB.',
    noteUnicode: 'This PDF uses rasterized pages for non-Latin characters. Text in the result cannot be selected.', noteMixed: '{raster} of {pages} pages contain unsupported characters and are image-based. The other {searchable} pages retain selectable text.', noteSearch: 'Output text is selectable.',
    textResultStale: 'This PDF was generated from the previous text. You can still download this version; generate again to include your latest edits.',
    invalidFile: 'Please select a supported file and retry.', resultPreview: 'Extracted text preview', dropHint: 'Or drag a file here. Nothing is uploaded.', imported: 'Imported', multipleFiles: 'This converter accepts one file at a time. No file was replaced; choose a single file.', batchLabel: 'Image batch {current} of {total}', batchPrev: 'Previous pages', batchNext: 'Next pages', batchCustom: 'Custom page selection', batchCustomHint: 'Previous/Next work with standard 60-page batches. Return to batches to continue near your custom range.', batchResume: 'Return to page batches', cancel: 'Cancel', cancelling: 'Cancelling…', cancelled: 'Cancelled', packaging: 'Packaging ZIP: {percent}%', replacedFailed: 'Import failed. Previous file remains: {name}.', modified: 'Edited after import', nextStep: 'Browse other tools (files do not transfer automatically)', overlap: 'Page numbers are drawn over existing content. Check footers, stamps and existing numbers before using the result.',
  },
  zh: {
    label: '仅在浏览器本地处理', file: '选择 PDF 文件', textFile: '导入 TXT / Markdown', uploaded: '已读取', pages: '页', choose: '选择文件', start: '开始处理', run: '转换并下载', busy: '正在本机处理…',
    privacy: '文件不上传服务器。大文件可能消耗较多设备内存。', clear: '清空', loadingFile: '正在本机读取文件…', cancelLoad: '取消读取', fileLoadCancelled: '已取消读取文件，原文件和未保存的内容均已保留。', replaceConfirmTitle: '确定替换当前文件？', replaceConfirmHint: '打开 {name} 可能丢弃尚未下载的 PDF、尚未确认保存的 JPG/PNG/ZIP/TXT/MD 自动下载结果或文字修改。请先检查或下载当前内容，也可以取消替换。', replaceKeep: '保留当前工作', replaceAccept: '确认替换文件', clearConfirmTitle: '确定丢弃未保存的转换结果？', clearConfirmHint: 'JPG/PNG/ZIP/TXT/MD 补救下载副本、生成的 PDF 结果或编辑后的文字可能尚未妥善保存。清空将从当前标签页删除这些内容。', clearKeep: '继续编辑', clearConfirm: '丢弃并清空',
    pageRange: '选择页码（总页数不超过 60 时可留空）', imageRangeInvalid: '请输入 1 至 {pages} 范围内的页码（例如 1-3, 5），每段范围不能反向。', imageRangeTooMany: '每次最多选择 60 页，请使用页码批次分批导出。', rangeHint: '例如 301- 或 301-360。页码末尾的短横线表示一直选到 PDF 最后一页，但每批仍最多 60 张图片。长 PDF 默认选前 60 页，可用“下一批”继续。重复或重叠页码只导出一次。若输入 3,1 等自定义顺序，ZIP 内图片文件名前会加上 order-001、order-002 前缀，解压排序后仍保持指定顺序。', imageType: '图片格式', quality: '渲染清晰度',
    low: '更小（72 DPI）', medium: '平衡（108 DPI）', high: '高清（144 DPI）', print: '打印高清（220 DPI）', printHint: '适合打印。超大页面可能因设备内存安全限制而无法转换。',
    download: '下载结果', downloadAgain: '再次下载', imageDownloadStarted: '已发起图片自动下载。', imageDownloadFallback: '请检查“下载”文件夹内是否已有 JPG、PNG 或 ZIP。未出现请点“再次下载”；已保存可点“我已保存文件”取消离开提醒。', textAutoDownloadFallback: '请检查“下载”文件夹是否已有 TXT 或 Markdown。如被拦截请点“再次下载”；已保存可点下方确认按钮。', confirmSaved: '我已保存文件', imageResultStale: '这是旧设置生成的结果：再次下载仍会获得上方所列的旧文件。如需应用当前图片格式、清晰度或页码范围，请重新转换。', compressionMethod: '压缩方式', compressionLevel: '图片化压缩强度', compressionStructure: '保留可搜索文字（尝试优化文档结构）', compressionRaster: '图片化压缩（将页面转为 JPEG）', compressionLow: '更小体积（画质较低）', compressionMid: '平衡', compressionHigh: '画质较清晰（体积较大）',
    structureWarning: '此模式尝试重新组织 PDF 对象，不会主动把文字图片化；不一定能缩小文件。文件会被重写，数字签名将失效，复杂表单、链接、书签及附件需要重新核对。请保留原文件。', structureReady: '文档结构优化后文件确实变小，文字仍可搜索；请核对重要链接、表单和书签。', structureNoSaving: '文档结构优化未能让文件变小，因此不提供下载。请保留原文件，或主动选择图片化压缩。', compressionWarning: '此压缩方式会将 PDF 各页重新渲染为 JPEG 图片。输出将失去文本搜索和选中能力，也无法保留表单、注释、链接及数字签名。请保存原文件并检查输出画质。',
    original: '原文件', result: '输出文件', saved: '节省', increased: '体积增加', unchanged: '无变化', noSaving: '未缩小文件，因此没有自动下载。可尝试降低清晰度，或保留原文件。',
    compressionReady: '输出文件确实更小。请先核对文字清晰度。', compressionResultStale: '这是之前压缩设置生成的结果。您仍可下载，或按当前设置重新处理。', compressionRetryKept: '新一轮处理未能缩小文件。下方的大小比较和下载按钮仍对应上一次成功的压缩结果。', previewCompressed: '预览压缩后的首页', hidePreview: '收起预览',
    noSavingEarly: '已提前停止：JPEG 数据已不小于原文件，继续转换也不能节省空间。请保留原文件或降低清晰度。',
    compressionLowerBound: '至少', previewAction: '生成 PDF 预览', previewTitle: '生成的 PDF 预览', previewFirst: '第 1 页预览（共 {pages} 页）', previewFailed: '无法生成预览，但仍可下载 PDF。', previewRetry: '重新尝试预览', downloadPdf: '下载 PDF',
    textWarning: '提取 PDF 中已有的可选择文字，以及常见的已填写文本框和下拉框内容，不具备 OCR。多栏、表格及复杂表单仍需核对。',
    textOrderLabel: '文字阅读顺序', textOrderRows: '按行读取（单栏文档、表格）', textOrderLeft: '双栏：先左栏后右栏', textOrderRight: '双栏：先右栏后左栏', textOrderHint: '适用于报纸、双栏论文等。跨栏标题、表格和复杂版式仍需人工核对。', textOrderStale: '当前结果使用之前的阅读顺序。请重新转换以应用新设置。',
    missingTextPages: '重要提示：共 {total} 页中有 {missing} 页未检测到可选择文字（第 {pages} 页）。这些页可能是空白页或扫描图片，其内容未被提取；扫描文字需要 OCR。请对照原始 PDF 核查。',
    partialTextReady: '有些 PDF 页面未能提取文字。请先查看缺页提示，再决定是否下载这份不完整的文字文件。', imageOnlyTextWarning: '下载前请核查：共 {total} 页中有 {count} 页包含图片，但只能提取到极少文字（第 {pages} 页）。扫描正文可能仍在图片里，未被提取；也可能是正常的图片页面。请对照原 PDF，本工具不提供 OCR。', imageOnlyTextReady: '部分页面的图片中可能藏有未提取的文字。已暂停自动下载，请核对后主动下载。', formFieldWarning: '检测到可交互 PDF 表单。已尝试提取可见的已填写文本框及下拉框内容，但复选框、单选框、签名、隐藏或特殊字段仍可能遗漏。请对照原文件核查后再下载。', formFieldReady: '检测到交互表单，请核对已提取字段及可能遗漏的选项后主动下载。',
    markdownWarning: 'Markdown 为近似转换：根据字号推测标题，复杂 PDF 的版式无法完整还原。',
    textLabel: '需要转换的文本', textPlaceholder: '粘贴文字，或选择 .txt / .md 文件……',
    textInputHint: '支持 UTF-8 或带 BOM 的 UTF-16 文本。含内置 PDF 字体不支持字符的页面将使用本地字体图片化，其他页面保留可选中、可搜索的文字。',
    markdownInputHint: '导入支持 UTF-8 或带 BOM 的 UTF-16。支持基础标题、列表、引用和代码块；不支持远程图片、HTML、完整表格或复杂 Markdown。链接地址显示为普通文字，不成为可点击的链接。需要特殊字体的页面会图片化，其他页面仍可搜索。',
    pageStart: '显示的起始数字', numberPlanStartInvalid: '起始数字必须是 1 至 99999 之间的整数。', numberPlanFirstInvalid: '开始编号的 PDF 页码须为 1 至 {pages} 之间的整数。', numberPlanOverflow: '末页页码不能超过 99999，请减小起始数字或从更靠后的 PDF 页开始编号。', firstPage: '从 PDF 第几页开始编号', firstPageReset: '新 PDF 的页数不足以使用之前的起始编号位置，已重置为从 PDF 第 1 页开始。', firstPageHint: '前面的封面、目录等页面不会添加页码；开始编号的那一页使用上方指定的起始数字。', pagePosition: '页码位置', pageSize: '字号', pageMargin: '距离页边', marginNarrow: '较近（12 点）', marginNormal: '标准（24 点）', marginWide: '较远（40 点）', bottomLeft: '左下角', bottomCenter: '底部居中', bottomRight: '右下角', topLeft: '左上角', topCenter: '顶部居中', topRight: '右上角', customPreview: '查看指定 PDF 页', customPage: '要预览的 PDF 页码', previewPreparing: '正在准备指定页面预览……', invalidPreviewPage: '请输入 1 至 {pages} 之间的整数页码。',
    numbersHint: '从指定 PDF 页开始添加可选择的页码，前面的页面不添加页码；保持原有纸张尺寸。重要文件请检查注释和数字签名。',
    numberedResultStale: '当前预览仍使用上一次生成时的页码设置。请重新生成以应用新设置；您也可以下载之前的 PDF。', numberedPreviousDownload: '下载之前生成的 PDF',
    ready: '文件已经生成', noPdf: '请先选择 PDF 文件。', noText: '请输入待转换的文字。', sizeLimit: 'PDF 最多 100 MB / 1000 页；TXT / Markdown 最多 5 MB。', limitText: 'TXT / Markdown 最多 5 MB；输出最多 1000 页（中文等图片化内容最多 300 页）。', limitImages: 'PDF 最多 100 MB / 1000 页；每批最多导出选定的 60 页图片。', limitCompression: 'PDF 最多 100 MB / 120 页。', limitCompressionRaster: 'PDF 最多 100 MB / 120 页；JPEG 数据累计上限 96 MB。', limitGeneral: 'PDF 最多 100 MB / 1000 页。', heavyWarning: '大文档提示：处理数百页时可能占用较多设备内存，并需要更长时间。建议关闭其他高负载标签页。', progressLabel: '已处理 {done} / {total} 页', tooMuchText: '文本内容超过 5 MB。',
    noteUnicode: '由于含有非拉丁文字，此 PDF 输出为图片页，无法选择和搜索文字。', noteMixed: '共 {pages} 页，其中 {raster} 页含有内置字体不支持的字符，已图片化；其余 {searchable} 页仍可选择和搜索文字。', noteSearch: '输出文字可选择和搜索。',
    textResultStale: '此 PDF 由修改前的文字生成，尚未包含最新编辑。可以下载这个旧版本，或重新生成 PDF。',
    invalidFile: '请选择受支持的文件后重试。', resultPreview: '提取文字预览', dropHint: '也可以将文件拖到这里，不会上传至服务器。', imported: '已导入', multipleFiles: '此转换工具每次只接受一个文件。当前文件未改变，请只选择一个文件。', batchLabel: '图片批次 {current} / {total}', batchPrev: '上一批', batchNext: '下一批', batchCustom: '自定义页码范围', batchCustomHint: '“上一批 / 下一批”按每 60 页导航。先返回批次模式，才能从自定义页码附近继续。', batchResume: '返回分批浏览', cancel: '取消处理', cancelling: '正在取消…', cancelled: '已取消', packaging: '正在打包 ZIP：{percent}%', replacedFailed: '导入失败，当前仍是旧文件：{name}。', modified: '导入后已修改', nextStep: '查看其他工具（文件不会自动带入）', overlap: '页码会直接叠加在原页面上，可能遮挡页脚、印章或已有页码，使用前请核对。',
  },
};


function PdfFirstPagePreview({ bytes, pageCount, t, locale, pageNumber = 1, suppressed = false }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [pdfState, setPdfState] = useState(null);
  const [renderedPage, setRenderedPage] = useState(null);
  const [retryVersion, setRetryVersion] = useState(0);

  // One generated PDF = one PDF.js loading task. Merely browsing page 2,
  // page 300, or the last page must NOT copy/parse the entire 100 MB PDF
  // again or create a new worker for each navigation. A new output byte
  // array or unmount disposes of the previous task and its worker.
  useEffect(() => {
    let disposed = false, loadingTask;
    setPdfState(null);
    setRenderedPage(null);
    setFailed(false);
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      // PDF.js transfers its input buffer to the worker; never transfer the
      // React-owned result bytes that are still needed for Download.
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const document = await loadingTask.promise;
      if (!disposed) setPdfState({ bytes, document });
    })().catch(error => {
      if (!disposed && error?.name !== 'RenderingCancelledException') setFailed(true);
    });
    return () => {
      disposed = true;
      if (loadingTask) void loadingTask.destroy().catch(() => {});
    };
  }, [bytes, retryVersion]);

  // Each page render is short-lived, even though the document is reused.
  // Fast page switches cancel the previous render; a late getPage response
  // is cleaned up rather than rendered into the new page's canvas.
  useEffect(() => {
    let closed = false, task, pdfPage;
    const canvas = canvasRef.current;
    if (!pdfState || pdfState.bytes !== bytes) {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      return undefined;
    }
    setFailed(false);
    setRenderedPage(null);
    (async () => {
      pdfPage = await pdfState.document.getPage(pageNumber);
      if (closed) { pdfPage.cleanup(); return; }
      const base = pdfPage.getViewport({ scale: 1 });
      // Bound BOTH axes. A very tall receipt can be only 80 pt wide but
      // 12,000 pt high; width-only scaling can allocate a >20,000px canvas
      // on Retina/iOS. This is only a display preview: export bytes and
      // original PDF page dimensions are never changed.
      const fit = Math.min(1, 550 / base.width, 700 / base.height);
      const viewport = pdfPage.getViewport({ scale: fit });
      const density = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.style.width = viewport.width + 'px';
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Preview canvas unavailable');
      ctx.setTransform(density, 0, 0, density, 0, 0);
      task = pdfPage.render({ canvasContext: ctx, canvas, viewport });
      await task.promise;
      if (!closed) setRenderedPage(pageNumber);
    })().catch(error => {
      if (!closed && error?.name !== 'RenderingCancelledException') setFailed(true);
    });
    return () => {
      closed = true;
      task?.cancel();
      pdfPage?.cleanup();
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.style.width = ''; }
    };
  }, [pdfState, bytes, pageNumber]);

  return <div className="utility-preview" data-testid={suppressed ? undefined : 'utility-pdf-preview'}
    aria-hidden={suppressed} style={suppressed ? { display: 'none' } : undefined}
    data-rendered-page={renderedPage === pageNumber ? String(pageNumber) : undefined}>
    <strong>{t.previewTitle}</strong>
    <p className="utility-note">{pageNumber === 1 ? t.previewFirst.replace('{pages}', pageCount) : (locale === 'zh' ? `预览第 ${pageNumber} / ${pageCount} 页` : `Preview page ${pageNumber} of ${pageCount}`)}</p>
    <canvas ref={canvasRef} role="img" aria-label={locale === 'zh' ? (pageNumber === 1 ? 'PDF 首页预览' : `PDF 第 ${pageNumber} 页预览`) : (pageNumber === 1 ? 'PDF first page preview' : `PDF page ${pageNumber} preview`)}
      style={{ maxWidth: '100%', height: 'auto', display: failed ? 'none' : 'block' }} />
    {failed && <div className="utility-preview-failed" role="status">
      <p className="utility-note">{t.previewFailed}</p>
      <button type="button" className="button button-secondary button-small"
        data-testid="utility-pdf-preview-retry" onClick={() => {
          // Retry only the preview worker, never regenerate or discard the
          // PDF bytes that the user can already download.
          setFailed(false);
          setRetryVersion(value => value + 1);
        }}>{t.previewRetry}</button>
    </div>}
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
  const fileLoadAbortRef = useRef(null);
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
  const [readingOrder, setReadingOrder] = useState('rows');
  const [scale, setScale] = useState('1.5');
  const [compressMode, setCompressMode] = useState('balanced');
  // Explicitly opt into JPEG rasterization; it destroys searchable text.
  const [compressStrategy, setCompressStrategy] = useState('structure');
  const [numberPreviewPage, setNumberPreviewPage] = useState('first');
  const [numberPreviewCustom, setNumberPreviewCustom] = useState('1');
  const [numberPreviewSettled, setNumberPreviewSettled] = useState('1');
  const [start, setStart] = useState('1');
  const [firstPage, setFirstPage] = useState('1');
  const [position, setPosition] = useState('bottom-center');
  const [margin, setMargin] = useState('24');
  const [fontSize, setFontSize] = useState('12');
  const [busy, setBusy] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadCancelling, setLoadCancelling] = useState(false);
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
  useEffect(() => () => { fileLoadAbortRef.current?.abort(); taskRef.current?.abort(); }, []);
  // While editing a custom page number, keep the last valid page mounted
  // but hidden. Unmounting it here would destroy its worker and force the
  // entire PDF to reopen after the 300ms debounce (pages 5, 50, 500).
  useEffect(() => {
    if (numberPreviewPage !== 'custom' || !output?.pageCount) return undefined;
    const page = Number(numberPreviewCustom);
    if (!numberPreviewCustom.trim() || !Number.isSafeInteger(page) ||
        page < 1 || page > output.pageCount) return undefined;
    const handle = setTimeout(() => setNumberPreviewSettled(numberPreviewCustom), 300);
    return () => clearTimeout(handle);
  }, [numberPreviewPage, numberPreviewCustom, output?.pageCount]);
  const textResultStale = Boolean(isTextInput && output?.bytes && output.textRevision !== textRevision);
  const numberedResultStale = Boolean(mode === 'add-page-numbers' && output?.bytes && output.numberingSettings &&
    (output.numberingSettings.start !== start || output.numberingSettings.firstPage !== firstPage ||
     output.numberingSettings.position !== position || output.numberingSettings.fontSize !== fontSize ||
     output.numberingSettings.margin !== margin));


  function clearOutput() {
    // Replacing the original file or explicitly clearing must release the old
    // result bytes. PDF-to-images option edits instead keep the old result as
    // a visibly stale, recoverable download until new conversion succeeds.
    setClearConfirm(false); setOutput(null); setNotice(''); setError('');
    setPreview(''); setExtractionWarning(''); setProgress(null);
    setShowCompressionPreview(false); setCompressionRetryKept(false);
    setNumberPreviewPage('first'); setNumberPreviewCustom('1'); setNumberPreviewSettled('1');
    setNotDownloaded(false);
  }
  function preserveImageFallbackOnOptionChange() {
    // A blocked automatic download may be the only remaining JPG/PNG/ZIP.
    // Changing a page range, format, resolution or batch must not silently
    // discard it; the on-screen filename and stale notice identify its origin.
    setClearConfirm(false); setNotice(''); setError(''); setProgress(null);
  }
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
        : isTextInput ? (file.size > maximum ? t.tooMuchText : t.invalidFile) : locale === 'zh'
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
    const loadController = new AbortController();
    fileLoadAbortRef.current = loadController;
    setLoadCancelling(false);
    setLoadingFile(true);
    // A failed replacement must preserve the previously generated result,
    // preview and download button, not just the old input document.
    setError('');
    setBusy(true);
    try {
      if (isTextInput) {
        if (!/\.(?:txt|md|markdown)$/i.test(file.name) || !file.size || file.size > UTILITY_LIMITS.maxTextBytes) throw new Error(file.size > UTILITY_LIMITS.maxTextBytes ? t.tooMuchText : t.invalidFile);
        const content = decodeImportedText(new Uint8Array(await readFileArrayBuffer(file, loadController.signal)), locale);
        // UTF-16 can be smaller on disk than the UTF-8 text we actually
        // convert. Reject at import time, before discarding the previous
        // draft or generated PDF, instead of failing only after Run.
        if (new TextEncoder().encode(content).length > UTILITY_LIMITS.maxTextBytes) {
          throw new Error(t.tooMuchText);
        }
        if (loadController.signal.aborted) throw new Error('Processing cancelled.');
        clearOutput();
        setSourceText(content);
        setTextRevision(previous => previous + 1);
        setTextFileName(file.name);
        setTextEdited(false);
      } else {
        const loaded = await loadPdf(file, mode, locale, loadController.signal);
        if (loadController.signal.aborted) throw new Error('Processing cancelled.');
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
      if (loadController.signal.aborted) {
        // Cancellation is not a corrupt-file error and must never erase the
        // previously selected document, unsaved result or text draft.
        setError('');
        setNotice(t.fileLoadCancelled);
      } else {
        setError(translateUtilityError(e, locale) + ((pdf || textFileName) ? ' ' + t.replacedFailed.replace('{name}', pdf?.name || textFileName) : ''));
      }
    } finally {
      if (fileLoadAbortRef.current === loadController) fileLoadAbortRef.current = null;
      operationRef.current = false;
      setLoadingFile(false); setLoadCancelling(false); setBusy(false);
    }
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
    preserveImageFallbackOnOptionChange();
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
    if (isImages || isCompress || isTextInput || isTextOutput || mode === 'add-page-numbers') {
      // A failed or cancelled retry must not destroy a previously generated
      // JPG/ZIP fallback when the browser blocked its automatic download.
      // Changing source, range, format or quality still clears stale bytes.
      // Retain an incomplete text extraction until the user downloads or replaces it.
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
        // Keep the already-created bytes for a manual download fallback. No
        // second PDF render or ZIP build is needed when browsers suppress the
        // automatic download or the user wants another copy. Image settings
        // edits retain these bytes, clearly labeled as a previous result.
        setOutput({ ...result, imageSettings: { format, scale, pages } });
        try { save(result); }
        finally {
          // A programmatic download click (or thrown browser download API)
          // does not prove the file reached Downloads. Always keep the retry
          // guarded until manual download or explicit saved confirmation.
          setNotDownloaded(true);
        }
        setNotice(`${t.imageDownloadStarted} ${result.count} ${t.pages} · ${formatBytes(result.bytes.length)}`);
      } else if (isCompress) {
        const options = {
          compact: { scale: .75, quality: .55 }, balanced: { scale: 1, quality: .7 }, clearer: { scale: 1.5, quality: .8 },
        }[compressMode];
        const candidate = compressStrategy === 'structure'
          ? await compressPdfStructure(pdf, { locale, signal: controller.signal }, report)
          : await compressPdfRaster(pdf, { ...options, locale, signal: controller.signal }, report);
        ensureNotCancelled();
        if (candidate.stats.smaller && candidate.bytes) {
          setOutput({ bytes: candidate.bytes, mime: 'application/pdf',
            name: `${pdfName}-${compressStrategy === 'structure' ? 'optimized' : 'compressed'}.pdf`, stats: candidate.stats,
            compressionMode: compressMode, compressionStrategy: compressStrategy });
          setNotDownloaded(true);
          setCompressionRetryKept(false);
          setNotice(compressStrategy === 'structure' ? t.structureReady : t.compressionReady);
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
            name: `${pdfName}-${compressStrategy === 'structure' ? 'optimized' : 'compressed'}.pdf`, stats: candidate.stats,
            compressionMode: compressMode, compressionStrategy: compressStrategy });
          setNotDownloaded(false);
          setCompressionRetryKept(false);
          setNotice(candidate.stats.lowerBound ? t.noSavingEarly : compressStrategy === 'structure' ? t.structureNoSaving : t.noSaving);
        }
      } else if (isTextOutput) {
        const markdown = mode === 'pdf-to-markdown';
        let textCoverage = null;
        const value = await extractPdfText(pdf, markdown, report, controller.signal,
          coverage => { textCoverage = coverage; }, readingOrder);
        ensureNotCancelled();
        const incomplete = Boolean(textCoverage?.missingPages.length);
        const suspectText = Boolean(textCoverage?.suspectPages.length);
        const hasFormFields = Boolean(textCoverage?.hasFormFields);
        const extractionNotices = [];
        if (incomplete) {
          const { missingPages, total } = textCoverage;
          const previewPages = missingPages.slice(0, 6).join(', ') +
            (missingPages.length > 6 ? ', …' : '');
          extractionNotices.push(t.missingTextPages
            .replace('{missing}', missingPages.length)
            .replace('{total}', total)
            .replace('{pages}', previewPages));
        }
        if (suspectText) {
          const { suspectPages, total } = textCoverage;
          const previewPages = suspectPages.slice(0, 6).join(', ') +
            (suspectPages.length > 6 ? ', …' : '');
          extractionNotices.push(t.imageOnlyTextWarning
            .replace('{count}', suspectPages.length)
            .replace('{total}', total)
            .replace('{pages}', previewPages));
        }
        if (hasFormFields) extractionNotices.push(t.formFieldWarning);
        setExtractionWarning(extractionNotices.join(' '));
        setPreview(value.slice(0, 1600));
        result = { bytes: new TextEncoder().encode(value), mime: 'text/plain;charset=utf-8', name: `${pdfName}.${markdown ? 'md' : 'txt'}` };
        setOutput({ ...result, partialText: incomplete, suspectText, hasFormFields, readingOrder });
        if (incomplete || suspectText || hasFormFields) {
          // Never auto-download a file with image-only body text or
          // interactive controls whose values may not all be represented.
          // The user can inspect the warning and choose an explicit download.
          setNotDownloaded(true);
          setNotice('');
        } else {
          // Only fully ordinary text extraction auto-downloads as before.
          try { save(result); }
          finally {
            // Preserve a text download fallback even if the browser throws
            // before creating the automatic file download.
            setNotDownloaded(true);
          }
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
        result = { bytes: await addPageNumbers(pdf, { start: Number(start), firstPage: Number(firstPage), position, margin: Number(margin), fontSize: Number(fontSize), signal: controller.signal }, report), name: `${pdfName}-numbered.pdf` };
        ensureNotCancelled();
        setOutput({ ...result, pageCount: pdf.count, numberingSettings: { start, firstPage, position, fontSize, margin } });
        setNumberPreviewPage('first'); setNumberPreviewCustom(firstPage); setNumberPreviewSettled(firstPage);
        setNotDownloaded(true);
        setNotice(locale === 'zh' ? '已生成带页码的 PDF。请检查实际页码位置，再下载。' : 'Numbered PDF generated. Check the actual page number placement before downloading.');
      }
    } catch (e) { setError(translateUtilityError(e, locale)); }
    finally { taskRef.current = null; operationRef.current = false; setBusy(false); setProcessing(false); setCancelling(false); }
  }

  const isImages = mode === 'pdf-to-images';
  // Match the Export PDF range validation: a malformed/out-of-bounds plan
  // must be blocked before allocating a PDF.js worker or raster canvas.
  // Blank means all pages ONLY when the document fits in one 60-page run.
  const imageRangeError = (() => {
    if (!isImages || !pdf) return '';
    try {
      const selected = requestedPages(pages, pdf.count);
      return selected.length > UTILITY_LIMITS.maxImagePagesPerRun ? t.imageRangeTooMany : '';
    } catch (_invalidRange) {
      return t.imageRangeInvalid.replace('{pages}', String(pdf.count));
    }
  })();
  // An impossible numbering plan must never start parsing and rewriting a long PDF.
  const numberingErrorType = mode === 'add-page-numbers' && pdf
    ? validateNumberingPlan(start, firstPage, pdf.count) : null;
  const numberingError = numberingErrorType === 'start' ? t.numberPlanStartInvalid
    : numberingErrorType === 'first' ? t.numberPlanFirstInvalid.replace('{pages}', String(pdf?.count))
      : numberingErrorType === 'overflow' ? t.numberPlanOverflow : '';
  const imageBatch = isImages && pdf && pdf.count > UTILITY_LIMITS.maxImagePagesPerRun
    ? imagePageBatch(pdf.count, batchIndex) : null;
  const customImageRange = Boolean(imageBatch && pages !== imageBatch.range);
  const imageResultStale = Boolean(isImages && output?.imageSettings &&
    (output.imageSettings.format !== format || output.imageSettings.scale !== scale ||
      output.imageSettings.pages !== pages));
  const limitHint = isTextInput ? t.limitText : isCompress
    ? (compressStrategy === 'raster' ? t.limitCompressionRaster : t.limitCompression)
    : isImages ? t.limitImages : t.limitGeneral;
  const selectedPreviewNumber = Number(numberPreviewCustom);
  const numberPreviewValid = Boolean(output?.bytes && output.pageCount &&
    numberPreviewCustom.trim() && Number.isSafeInteger(selectedPreviewNumber) &&
    selectedPreviewNumber >= 1 && selectedPreviewNumber <= output.pageCount);
  const numberPreviewReady = numberPreviewValid && numberPreviewSettled === numberPreviewCustom;
  const numberPreviewActualPage = numberPreviewPage === 'last' ? output?.pageCount
    : numberPreviewPage === 'custom' ? Number(numberPreviewSettled)
      : Number(output?.numberingSettings?.firstPage ?? 1);
  const numberPreviewSuppressed = numberPreviewPage === 'custom' && !numberPreviewReady;
  const description = isCompress ? (compressStrategy === 'structure' ? t.structureWarning : t.compressionWarning) : isTextOutput ? `${t.textWarning} ${mode === 'pdf-to-markdown' ? t.markdownWarning : ''}` : isTextInput ? mode === 'markdown-to-pdf' ? t.markdownInputHint : t.textInputHint : mode === 'add-page-numbers' ? t.numbersHint : t.privacy;
  return (
    <section className="pdf-workspace pdf-utility" data-testid="pdf-utility">
      <UnsavedNavigationGuard active={Boolean(busy || (notDownloaded && (pdf || textFileName || sourceText.trim() || output?.bytes)))}
         processing={busy} imageOutputPending={Boolean(isImages && output?.bytes && notDownloaded)}
         textOutputPending={Boolean(isTextOutput && output?.bytes && notDownloaded &&
           !output.partialText && !output.suspectText && !output.hasFormFields)} locale={locale} />
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
        {loadingFile && <div className="utility-load-controls" role="status">
          <span>{t.loadingFile}</span>
          <button type="button" className="button button-secondary button-small"
            data-testid="utility-load-cancel" disabled={loadCancelling}
            onClick={() => { setLoadCancelling(true); fileLoadAbortRef.current?.abort(); }}>
            {loadCancelling ? t.cancelling : t.cancelLoad}
          </button>
        </div>}
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
        {isTextInput && <label className="utility-text-input"><span className="utility-field-label">{t.textLabel}</span><textarea data-testid="utility-text" rows={10} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" placeholder={t.textPlaceholder} value={sourceText} onChange={e => { if (!textFitsUtf8Budget(e.target.value)) { setError(t.tooMuchText); setNotice(''); return; } setSourceText(e.target.value); setTextRevision(previous => previous + 1); setTextEdited(Boolean(textFileName)); setNotDownloaded(true); setClearConfirm(false); setNotice(''); setError(''); setProgress(null); }} disabled={inputLocked} /></label>}
        {isTextInput && !textFileName && sourceText.trim() && <button type="button"
          className="button button-secondary button-small" data-testid="utility-text-clear"
          disabled={inputLocked} onClick={reset}>{t.clear}</button>}
        {mode === 'pdf-to-images' && <div className="utility-options">
          <label><span>{t.imageType}</span><select aria-label={t.imageType} value={format} disabled={inputLocked} onChange={e => { setFormat(e.target.value); preserveImageFallbackOnOptionChange(); }}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
          <label><span>{t.quality}</span><select aria-label={t.quality} value={scale} disabled={inputLocked} onChange={e => { setScale(e.target.value); preserveImageFallbackOnOptionChange(); }}><option value="1">{t.low}</option><option value="1.5">{t.medium}</option><option value="2">{t.high}</option><option value={String(IMAGE_PRINT_SCALE)}>{t.print}</option></select></label>
          <label><span>{t.pageRange}</span><input data-testid="utility-page-ranges" value={pages} disabled={inputLocked}
            aria-invalid={Boolean(imageRangeError)} aria-describedby={imageRangeError ? 'image-range-error' : undefined}
            onChange={e => { setPages(e.target.value); preserveImageFallbackOnOptionChange(); }} placeholder="1-3, 5-" /></label>
        </div>}
        {isImages && <p className="utility-helper">{t.rangeHint}</p>}
        {imageRangeError && <p id="image-range-error" className="utility-note" data-testid="image-range-error" role="alert">{imageRangeError}</p>}
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
        {isTextOutput && <div className="utility-options">
          <label><span>{t.textOrderLabel}</span><select data-testid="text-reading-order"
            aria-label={t.textOrderLabel} value={readingOrder} disabled={inputLocked}
            onChange={event => { setReadingOrder(event.target.value); setNotice(''); setError(''); }}>
            <option value="rows">{t.textOrderRows}</option>
            <option value="left-first">{t.textOrderLeft}</option>
            <option value="right-first">{t.textOrderRight}</option>
          </select></label>
        </div>}
        {isTextOutput && <p className="utility-note" data-testid="text-reading-order-hint">{t.textOrderHint}</p>}
        {isCompress && <div className="utility-options">
          <label><span>{t.compressionMethod}</span><select data-testid="compression-strategy"
            aria-label={t.compressionMethod} value={compressStrategy} disabled={inputLocked}
            onChange={e => { setCompressStrategy(e.target.value); setNotice(''); setError(''); }}>
            <option value="structure">{t.compressionStructure}</option>
            <option value="raster">{t.compressionRaster}</option>
          </select></label>
          {compressStrategy === 'raster' && <label><span>{t.compressionLevel}</span>
            <select data-testid="compression-level" aria-label={t.compressionLevel} value={compressMode}
              disabled={inputLocked} onChange={e => { setCompressMode(e.target.value); setNotice(''); setError(''); }}>
              <option value="compact">{t.compressionLow}</option>
              <option value="balanced">{t.compressionMid}</option>
              <option value="clearer">{t.compressionHigh}</option>
            </select></label>}
        </div>}
        {mode === 'add-page-numbers' && <div className="utility-options">
          <label><span>{t.pageStart}</span><input data-testid="number-start" type="number" min="1" max="99999" step="1" value={start}
            aria-invalid={numberingErrorType === 'start' || numberingErrorType === 'overflow'}
            aria-describedby={numberingErrorType === 'start' || numberingErrorType === 'overflow' ? 'numbering-plan-error' : undefined}
            disabled={inputLocked} onChange={e => { setStart(e.target.value); setNotice(''); setError(''); }} /></label>
          <label><span>{t.firstPage}</span><input data-testid="number-first-pdf-page" type="number" min="1" max={pdf?.count || UTILITY_LIMITS.maxPages} step="1" value={firstPage}
            aria-invalid={numberingErrorType === 'first'}
            aria-describedby={numberingErrorType === 'first' ? 'numbering-plan-error' : undefined}
            disabled={inputLocked} onChange={e => { setFirstPage(e.target.value); setNotice(''); setError(''); }} /></label>
          <label><span>{t.pagePosition}</span><select aria-label={t.pagePosition} value={position} disabled={inputLocked} onChange={e => { setPosition(e.target.value); setNotice(''); setError(''); }}><option value="bottom-left">{t.bottomLeft}</option><option value="bottom-center">{t.bottomCenter}</option><option value="bottom-right">{t.bottomRight}</option><option value="top-left">{t.topLeft}</option><option value="top-center">{t.topCenter}</option><option value="top-right">{t.topRight}</option></select></label>
          <label><span>{t.pageMargin}</span><select aria-label={t.pageMargin} data-testid="number-margin" value={margin} disabled={inputLocked} onChange={e => { setMargin(e.target.value); setNotice(''); setError(''); }}><option value="12">{t.marginNarrow}</option><option value="24">{t.marginNormal}</option><option value="40">{t.marginWide}</option></select></label>
          <label><span>{t.pageSize}</span><select aria-label={t.pageSize} value={fontSize} disabled={inputLocked} onChange={e => { setFontSize(e.target.value); setNotice(''); setError(''); }}><option value="10">10</option><option value="12">12</option><option value="16">16</option></select></label>
        </div>}
        {numberingError && <p id="numbering-plan-error" className="utility-note"
          data-testid="numbering-plan-error" role="alert">{numberingError}</p>}
        <p className="utility-note">{description}</p>
        {mode === 'add-page-numbers' && <p className="input-note" data-testid="number-first-page-hint">{t.firstPageHint}</p>}
        {mode === 'add-page-numbers' && <p className="utility-note" data-testid="page-overlap-warning">{t.overlap}</p>}
        <div className="utility-actions"><button type="button" className="button button-primary" data-testid="utility-run" onClick={processFile} disabled={inputLocked || Boolean(imageRangeError) || Boolean(numberingError) || (isTextInput ? !sourceText.trim() : !pdf)}>{busy ? t.busy : isCompress ? t.start : (isTextInput || mode === 'add-page-numbers') ? t.previewAction : t.run}{isTextInput || isCompress || mode === 'add-page-numbers' ? '' : ' ↓'}</button><span aria-live="polite" data-testid="utility-limit-hint">{limitHint}</span></div>
        {busy && processing && <button type="button" className="button button-secondary" data-testid="utility-cancel" disabled={cancelling} onClick={() => { setCancelling(true); taskRef.current?.abort(); }}>{cancelling ? t.cancelling : t.cancel}</button>}
        {progress && (busy || notice) && <p className="utility-note" data-testid="utility-progress" aria-live="polite">{'packaging' in progress ? t.packaging.replace('{percent}', progress.packaging) : t.progressLabel.replace('{done}', progress.done).replace('{total}', progress.total)}</p>}
        {isImages && output?.bytes && <div className="utility-result" data-testid="image-result">
          {imageResultStale && <p className="utility-note" role="status" data-testid="image-result-stale">{t.imageResultStale}</p>}
          <p className="utility-note">{t.imageDownloadFallback}</p>
          <p className="utility-note"><strong>{output.name}</strong> · {formatBytes(output.bytes.length)}</p>
          <div className="utility-actions">
            <button type="button" className="button button-secondary" data-testid="image-download-again"
              disabled={inputLocked} onClick={() => save(output)}>{t.downloadAgain} ↓</button>
            {notDownloaded && <button type="button" className="button button-secondary button-small" data-testid="image-confirm-saved"
              disabled={inputLocked} onClick={() => setNotDownloaded(false)}>{t.confirmSaved}</button>}
          </div>
        </div>}
        {isCompress && output && <div className="utility-result" data-testid="compression-result">
          <div className="utility-comparison"><div><span>{t.original}</span><strong>{formatBytes(output.stats.original)}</strong></div><div><span>{t.result}</span><strong>{output.stats.lowerBound ? `${t.compressionLowerBound} ` : ''}{formatBytes(output.stats.candidate)}</strong></div><div><span data-testid="compression-change-label">{output.stats.smaller ? t.saved : output.stats.candidate > output.stats.original ? t.increased : t.unchanged}</span><strong data-testid="compression-change-value" className={output.stats.smaller ? 'utility-smaller' : output.stats.candidate > output.stats.original ? 'utility-not-smaller' : ''}>{Math.abs(output.stats.percent)}%</strong></div></div>
          <p className="utility-note" data-testid="compression-result-method">
            {output.compressionStrategy === 'structure' ? t.compressionStructure : t.compressionRaster}
          </p>
          {(output.compressionStrategy !== compressStrategy ||
            (compressStrategy === 'raster' && output.compressionMode !== compressMode)) &&
            <p className="utility-note" role="status" data-testid="compression-result-stale">{t.compressionResultStale}</p>}
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
        {mode === 'add-page-numbers' && output?.bytes && <div className="utility-result" data-testid="numbered-pdf-result">
          {numberedResultStale && <p className="utility-note" role="status" data-testid="numbered-result-stale">{t.numberedResultStale}</p>}
          <p className="utility-note">{locale === 'zh' ? '预览的是生成后的 PDF，请核对页码与原有页脚是否重叠。' : 'This previews the generated PDF. Check that printed numbers do not overlap footers.'}</p>
          <div className="utility-options">
            <label><span>{locale === 'zh' ? '预览页面' : 'Preview page'}</span>
              <select data-testid="number-preview-page" value={numberPreviewPage}
                onChange={event => { setNumberPreviewPage(event.target.value); if (event.target.value === 'custom') { setNumberPreviewCustom(output.numberingSettings.firstPage); setNumberPreviewSettled(output.numberingSettings.firstPage); } }}>
                <option value="first">{locale === 'zh' ? '第一张编号页' : 'First numbered page'}</option>
                <option value="last">{locale === 'zh' ? '最后一页' : 'Last page'}</option>
                <option value="custom">{t.customPreview}</option>
              </select>
            </label>
            {numberPreviewPage === 'custom' && <label><span>{t.customPage}</span>
              <input data-testid="number-preview-custom" type="number" min="1" max={output.pageCount} step="1"
                value={numberPreviewCustom} onChange={event => setNumberPreviewCustom(event.target.value)} />
            </label>}
          </div>
          {numberPreviewPage === 'custom' && !numberPreviewValid &&
            <p className="utility-note" role="status" data-testid="number-preview-invalid">{t.invalidPreviewPage.replace('{pages}', output.pageCount)}</p>}
          {numberPreviewPage === 'custom' && numberPreviewValid && !numberPreviewReady &&
            <p className="utility-note" role="status" data-testid="number-preview-preparing">{t.previewPreparing}</p>}
          <PdfFirstPagePreview bytes={output.bytes} pageCount={output.pageCount}
            pageNumber={numberPreviewActualPage} t={t} locale={locale} suppressed={numberPreviewSuppressed} />
          <button type="button" className="button button-primary" data-testid="numbered-pdf-download" onClick={() => save(output)}>{numberedResultStale ? t.numberedPreviousDownload : t.downloadPdf} ↓</button>
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
          data-testid={output.partialText ? 'partial-text-result' : output.suspectText ? 'suspect-text-result' : output.hasFormFields ? 'form-text-result' : 'complete-text-result'}>
          {output.partialText && <p className="utility-note">{t.partialTextReady}</p>}
          {output.suspectText && <p className="utility-note">{t.imageOnlyTextReady}</p>}
          {output.hasFormFields && <p className="utility-note">{t.formFieldReady}</p>}
          {output.readingOrder !== readingOrder && <p className="utility-note" role="status" data-testid="text-reading-order-stale">{t.textOrderStale}</p>}
          {notDownloaded && !output.partialText && !output.suspectText && !output.hasFormFields &&
            <p className="utility-note" data-testid="text-auto-download-hint">{t.textAutoDownloadFallback}</p>}
          <button type="button" className="button button-primary"
            data-testid={output.partialText ? 'partial-text-download' : output.suspectText ? 'suspect-text-download' : output.hasFormFields ? 'form-text-download' : 'complete-text-download'}
            onClick={() => save(output)}>{output.partialText || output.suspectText || output.hasFormFields ? t.download : t.downloadAgain} ↓</button>
          {notDownloaded && !output.partialText && !output.suspectText && !output.hasFormFields &&
            <button type="button" className="button button-secondary button-small" data-testid="text-confirm-saved"
              disabled={inputLocked} onClick={() => setNotDownloaded(false)}>{t.confirmSaved}</button>}
        </div>}
        {notice && <p className="utility-note" data-testid="utility-next-step"><a href={locale === 'zh' ? '/zh/#all-tools' : '/#all-tools'}>{t.nextStep} →</a></p>}
        {isTextOutput && preview && <div className="utility-preview"><label className="utility-field-label" htmlFor="utility-preview">{t.resultPreview}</label><textarea id="utility-preview" readOnly spellCheck={false} rows={8} value={preview} /></div>}
      </div>
      <div className="workspace-foot"><span>✓ {t.privacy}</span></div>
    </section>
  );
}
