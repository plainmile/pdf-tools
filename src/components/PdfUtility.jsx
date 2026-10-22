import React, { useState } from 'react';
import { loadPdf, convertPdfToImages, compressPdfRaster, extractPdfText, textToPdf, addPageNumbers } from '../lib/pdfUtilities.mjs';
import { UTILITY_LIMITS, formatBytes, sanitizeFilename } from '../lib/utilityCore.mjs';
import { saveDownload } from '../lib/pdfEngine.mjs';

const COPY = {
  en: {
    label: 'Browser-local processing', file: 'Choose a PDF', textFile: 'Import TXT / Markdown', uploaded: 'Loaded', pages: 'pages', choose: 'Choose file', start: 'Process file', run: 'Convert and download', busy: 'Working on your device…',
    privacy: 'No files are uploaded. Processing may use significant device memory on large documents.', clear: 'Clear',
    pageRange: 'Pages (blank means all)', rangeHint: 'Example: 1-3, 5. Up to 50 pages.', imageType: 'Image format', quality: 'Render resolution',
    low: 'Smaller (72 DPI)', medium: 'Balanced (108 DPI)', high: 'Sharper (144 DPI)',
    download: 'Download result', compressionMethod: 'Compression level', compressionLow: 'Smaller size (lossier)', compressionMid: 'Balanced', compressionHigh: 'Clearer (larger)',
    compressionWarning: 'This method converts every PDF page into a JPEG image. Text stops being searchable or selectable. Forms, annotations, hyperlinks and signatures are not preserved. Keep the original and inspect the output.',
    original: 'Original', result: 'Result', saved: 'Saved', noSaving: 'No size reduction. This file was not downloaded; try a lower resolution or keep the original.',
    compressionReady: 'The output is smaller. Check text sharpness before using it.',
    textWarning: 'Extracts existing selectable PDF text only, not OCR. Columns, tables and heading formatting may not be preserved. Check the exported text.',
    markdownWarning: 'Markdown conversion is approximate; headings are inferred from font size. Complex PDF layout cannot be faithfully recovered.',
    textLabel: 'Text to convert', textPlaceholder: 'Paste text here or import a .txt / .md file…',
    textInputHint: 'Plain text is exported as selectable PDF text where the built-in font supports it. Chinese and other unsupported characters are rendered with local browser fonts as image pages (not searchable).',
    markdownInputHint: 'Supports simple headings, paragraphs, lists, quotes and code blocks; does not render external images, HTML, full tables or complex Markdown. Non-Latin scripts are drawn as page images.',
    pageStart: 'Starting number', pagePosition: 'Position', pageSize: 'Font size', bottomCenter: 'Bottom center', bottomRight: 'Bottom right', topRight: 'Top right',
    numbersHint: 'Adds selectable numbers to every page and preserves page size. Review annotations and digital signatures before using this modified file.',
    ready: 'Ready to download', noPdf: 'Select a PDF first.', noText: 'Enter text to convert.', sizeLimit: 'PDF limit: 25 MB and 50 pages; text limit: 1 MB.',
    noteUnicode: 'This PDF uses rasterized pages for non-Latin characters. Text in the result cannot be selected.', noteSearch: 'Output text is selectable.',
    invalidFile: 'Please select a supported file and retry.', resultPreview: 'Extracted text preview',
  },
  zh: {
    label: '仅在浏览器本地处理', file: '选择 PDF 文件', textFile: '导入 TXT / Markdown', uploaded: '已读取', pages: '页', choose: '选择文件', start: '开始处理', run: '转换并下载', busy: '正在本机处理…',
    privacy: '文件不上传服务器。大文件可能消耗较多设备内存。', clear: '清空',
    pageRange: '选择页码（留空则全部）', rangeHint: '例如 1-3, 5；最多 50 页。', imageType: '图片格式', quality: '渲染清晰度',
    low: '更小（72 DPI）', medium: '平衡（108 DPI）', high: '高清（144 DPI）',
    download: '下载结果', compressionMethod: '压缩强度', compressionLow: '更小体积（画质较低）', compressionMid: '平衡', compressionHigh: '画质较清晰（体积较大）',
    compressionWarning: '此压缩方式会将 PDF 各页重新渲染为 JPEG 图片。输出将失去文本搜索和选中能力，也无法保留表单、注释、链接及数字签名。请保存原文件并检查输出画质。',
    original: '原文件', result: '输出文件', saved: '节省', noSaving: '未缩小文件，因此没有自动下载。可尝试降低清晰度，或保留原文件。',
    compressionReady: '输出文件确实更小。请先核对文字清晰度。',
    textWarning: '只提取 PDF 中已有的可选择文字，不具备 OCR。多栏、表格和段落顺序可能不准确，请核对导出内容。',
    markdownWarning: 'Markdown 为近似转换：根据字号推测标题，复杂 PDF 的版式无法完整还原。',
    textLabel: '需要转换的文本', textPlaceholder: '粘贴文字，或选择 .txt / .md 文件……',
    textInputHint: '支持浏览器本地转换。拉丁文字尽量保留可选中内容；中文等字符会使用本地字体渲染为图片页，输出不支持文字搜索。',
    markdownInputHint: '支持基础标题、段落、列表、引用和代码块；不支持远程图片、HTML、完整表格或复杂 Markdown。中文会渲染为图片页。',
    pageStart: '起始页码', pagePosition: '页码位置', pageSize: '字号', bottomCenter: '底部居中', bottomRight: '右下角', topRight: '右上角',
    numbersHint: '在每页添加可选择的数字，保持纸张尺寸。重要文件请检查注释、数字签名等内容。',
    ready: '文件已经生成', noPdf: '请先选择 PDF 文件。', noText: '请输入待转换的文字。', sizeLimit: 'PDF 不超过 25 MB / 50 页；文本不超过 1 MB。',
    noteUnicode: '由于含有非拉丁文字，此 PDF 输出为图片页，无法选择和搜索文字。', noteSearch: '输出文字可选择和搜索。',
    invalidFile: '请选择受支持的文件后重试。', resultPreview: '提取文字预览',
  },
};

const TEXT_INPUT_MODES = new Set(['txt-to-pdf', 'markdown-to-pdf']);
const TEXT_OUTPUT_MODES = new Set(['pdf-to-txt', 'pdf-to-markdown']);

export default function PdfUtility({ mode, locale = 'en' }) {
  const t = COPY[locale] || COPY.en;
  const isTextInput = TEXT_INPUT_MODES.has(mode);
  const isTextOutput = TEXT_OUTPUT_MODES.has(mode);
  const isCompress = mode === 'compress-pdf';
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [output, setOutput] = useState(null);
  const [preview, setPreview] = useState('');

  function clearOutput() { setOutput(null); setNotice(''); setError(''); setPreview(''); }
  function reset() { setPdf(null); setSourceText(''); setPages(''); clearOutput(); }
  async function chooseFile(event) {
    clearOutput(); setBusy(true);
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) { setBusy(false); return; }
    try {
      if (isTextInput) {
        if (!/\.(?:txt|md|markdown)$/i.test(file.name) || file.size > UTILITY_LIMITS.maxTextBytes) throw new Error(t.invalidFile);
        setSourceText(await file.text());
      } else {
        setPdf(await loadPdf(file));
      }
    } catch (e) { setError(locale === 'zh' ? `${t.invalidFile} ${e.message}` : e.message); }
    finally { setBusy(false); }
  }
  function save(outputFile) {
    saveDownload(outputFile.bytes, outputFile.name, outputFile.mime || 'application/pdf');
  }
  async function processFile() {
    if (busy) return;
    clearOutput(); setBusy(true);
    try {
      const pdfName = pdf ? sanitizeFilename(pdf.name) : 'document';
      if (!isTextInput && !pdf) throw new Error(t.noPdf);
      let result;
      if (mode === 'pdf-to-images') {
        result = await convertPdfToImages(pdf, { format, scale: Number(scale), pages });
        result.name = result.count === 1 ? `${pdfName}-${result.name}` : `${pdfName}-images.zip`;
        save(result);
        setNotice(`${t.ready}: ${result.count} ${t.pages} · ${formatBytes(result.bytes.length)}`);
      } else if (isCompress) {
        const options = {
          compact: { scale: .75, quality: .55 }, balanced: { scale: 1, quality: .7 }, clearer: { scale: 1.5, quality: .8 },
        }[compressMode];
        const candidate = await compressPdfRaster(pdf, options);
        const next = { bytes: candidate.bytes, mime: 'application/pdf', name: `${pdfName}-compressed.pdf`, stats: candidate.stats };
        setOutput(next);
        setNotice(candidate.stats.smaller ? t.compressionReady : t.noSaving);
      } else if (isTextOutput) {
        const markdown = mode === 'pdf-to-markdown';
        const value = await extractPdfText(pdf, markdown);
        setPreview(value.slice(0, 1600));
        result = { bytes: new TextEncoder().encode(value), mime: 'text/plain;charset=utf-8', name: `${pdfName}.${markdown ? 'md' : 'txt'}` };
        save(result);
        setNotice(`${t.ready}: ${formatBytes(result.bytes.length)}`);
      } else if (isTextInput) {
        const encoded = new TextEncoder().encode(sourceText);
        if (!sourceText.trim()) throw new Error(t.noText);
        if (encoded.length > UTILITY_LIMITS.maxTextBytes) throw new Error('Text exceeds 1 MB.');
        const created = await textToPdf(sourceText, mode === 'markdown-to-pdf');
        result = { bytes: created.bytes, name: `text-${mode === 'markdown-to-pdf' ? 'markdown' : 'plain'}.pdf` };
        save(result);
        setNotice(`${t.ready}: ${created.pageCount} ${t.pages} · ${formatBytes(created.bytes.length)} · ${created.searchable ? t.noteSearch : t.noteUnicode}`);
      } else if (mode === 'add-page-numbers') {
        result = { bytes: await addPageNumbers(pdf, { start: Number(start), position, fontSize: Number(fontSize) }), name: `${pdfName}-numbered.pdf` };
        save(result);
        setNotice(`${t.ready}: ${pdf.count} ${t.pages}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : t.invalidFile); }
    finally { setBusy(false); }
  }

  const description = isCompress ? t.compressionWarning : isTextOutput ? `${t.textWarning} ${mode === 'pdf-to-markdown' ? t.markdownWarning : ''}` : isTextInput ? mode === 'markdown-to-pdf' ? t.markdownInputHint : t.textInputHint : mode === 'add-page-numbers' ? t.numbersHint : t.privacy;
  return (
    <section className="pdf-workspace pdf-utility" data-testid="pdf-utility">
      <div className="workspace-bar"><div className="workspace-heading"><span className="workspace-app-icon" aria-hidden="true">▤</span><div><strong>{t.label}</strong><span>{t.privacy}</span></div></div></div>
      <div className="utility-main">
        <label className="utility-file">
          <span className="utility-field-label">{isTextInput ? t.textFile : t.file}</span>
          <input data-testid="utility-file-input" type="file" accept={isTextInput ? '.txt,.md,.markdown,text/plain,text/markdown' : '.pdf,application/pdf'} disabled={busy} onChange={chooseFile} />
        </label>
        {pdf && <div className="utility-file-summary" data-testid="utility-file-summary"><strong>{pdf.name}</strong><span>{formatBytes(pdf.size)} · {pdf.count} {t.pages}</span><button type="button" onClick={reset} disabled={busy}>{t.clear}</button></div>}
        {isTextInput && <label className="utility-text-input"><span className="utility-field-label">{t.textLabel}</span><textarea data-testid="utility-text" rows={10} maxLength={UTILITY_LIMITS.maxTextBytes} placeholder={t.textPlaceholder} value={sourceText} onChange={e => { setSourceText(e.target.value); clearOutput(); }} disabled={busy} /></label>}
        {mode === 'pdf-to-images' && <div className="utility-options">
          <label><span>{t.imageType}</span><select aria-label={t.imageType} value={format} onChange={e => { setFormat(e.target.value); clearOutput(); }}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
          <label><span>{t.quality}</span><select aria-label={t.quality} value={scale} onChange={e => { setScale(e.target.value); clearOutput(); }}><option value="1">{t.low}</option><option value="1.5">{t.medium}</option><option value="2">{t.high}</option></select></label>
          <label><span>{t.pageRange}</span><input data-testid="utility-page-ranges" value={pages} onChange={e => { setPages(e.target.value); clearOutput(); }} placeholder="1-3, 5" /></label>
        </div>}
        {isCompress && <div className="utility-options"><label><span>{t.compressionMethod}</span><select aria-label={t.compressionMethod} value={compressMode} onChange={e => { setCompressMode(e.target.value); clearOutput(); }}><option value="compact">{t.compressionLow}</option><option value="balanced">{t.compressionMid}</option><option value="clearer">{t.compressionHigh}</option></select></label></div>}
        {mode === 'add-page-numbers' && <div className="utility-options">
          <label><span>{t.pageStart}</span><input data-testid="number-start" type="number" min="1" max="99999" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label><span>{t.pagePosition}</span><select aria-label={t.pagePosition} value={position} onChange={e => setPosition(e.target.value)}><option value="bottom-center">{t.bottomCenter}</option><option value="bottom-right">{t.bottomRight}</option><option value="top-right">{t.topRight}</option></select></label>
          <label><span>{t.pageSize}</span><select aria-label={t.pageSize} value={fontSize} onChange={e => setFontSize(e.target.value)}><option value="10">10</option><option value="12">12</option><option value="16">16</option></select></label>
        </div>}
        <p className="utility-note">{description}</p>
        <div className="utility-actions"><button type="button" className="button button-primary" data-testid="utility-run" onClick={processFile} disabled={busy || (isTextInput ? !sourceText.trim() : !pdf)}>{busy ? t.busy : isCompress ? t.start : t.run} ↓</button><span>{t.sizeLimit}</span></div>
        {isCompress && output && <div className="utility-result" data-testid="compression-result">
          <div className="utility-comparison"><div><span>{t.original}</span><strong>{formatBytes(output.stats.original)}</strong></div><div><span>{t.result}</span><strong>{formatBytes(output.stats.candidate)}</strong></div><div><span>{t.saved}</span><strong className={output.stats.smaller ? 'utility-smaller' : 'utility-not-smaller'}>{output.stats.percent}%</strong></div></div>
          <button type="button" className="button button-primary" data-testid="compression-download" disabled={!output.stats.smaller} onClick={() => save(output)}>{t.download} ↓</button>
        </div>}
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {notice && <div className="notice notice-success" role="status">{notice}</div>}
        {isTextOutput && preview && <div className="utility-preview"><label className="utility-field-label" htmlFor="utility-preview">{t.resultPreview}</label><textarea id="utility-preview" readOnly rows={8} value={preview} /></div>}
      </div>
      <div className="workspace-foot"><span>✓ {t.privacy}</span></div>
    </section>
  );
}
