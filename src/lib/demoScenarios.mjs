/**
 * Public, non-personal PDF fixtures with deliberately predictable output.
 * These paths are static GET resources. Loading a demo never uploads a user's
 * document or persists any source file outside the current browser tab.
 * The examples are NOT separate indexable SEO landing pages.
 */
const single = Object.freeze([
  Object.freeze({
    path: '/samples/plainmile-demo.pdf',
    name: 'plainmile-demo.pdf',
    en: 'Download the 4-page sample PDF',
    zh: '下载四页示例 PDF',
  }),
]);
const merge = Object.freeze([
  Object.freeze({
    path: '/samples/plainmile-demo-part-a.pdf',
    name: 'plainmile-demo-part-a.pdf',
    en: 'Download sample A (2 pages)',
    zh: '下载示例 A（2 页）',
  }),
  Object.freeze({
    path: '/samples/plainmile-demo-part-b.pdf',
    name: 'plainmile-demo-part-b.pdf',
    en: 'Download sample B (2 pages)',
    zh: '下载示例 B（2 页）',
  }),
]);

const scenarios = Object.freeze({
  workspace: {
    en: 'Load the four-page example, rotate page 2 clockwise and export. Expect four pages; only page 2 should be rotated.',
    zh: '载入四页示例，将第 2 页顺时针旋转后导出。结果仍为 4 页，只有第 2 页发生旋转。',
  },
  'merge-pdf': {
    en: 'Load example A and B together, then export one PDF. Expect four pages, with both A pages before both B pages.',
    zh: '同时载入示例 A 和 B，再导出一份 PDF。预期共 4 页，A 的两页排在 B 的两页之前。',
  },
  'split-pdf': {
    en: 'Enter 1-2, 3-4 under page ranges and download the ZIP. It should contain exactly two PDFs of two pages each.',
    zh: '在“页码范围”中输入 1-2, 3-4 并下载 ZIP。压缩包中应恰好有两份 PDF，每份两页。',
  },
  'organize-pdf': {
    en: 'Move page 4 before page 1 and export. The new order should start with Notes, then Overview, Checklist and Summary.',
    zh: '把第 4 页移动到第 1 页之前并导出。新顺序应为 Notes、Overview、Checklist、Summary。',
  },
  'rotate-pdf': {
    en: 'Select page 2, rotate it 90 degrees clockwise and export. All four pages remain; only page 2 rotates.',
    zh: '选中第 2 页，顺时针旋转 90° 后导出。仍保留 4 页，且只有第 2 页旋转。',
  },
  'extract-pages': {
    en: 'Enter 4, 2-3 and export ranges as one PDF. Expect exactly three pages in the order Notes, Checklist, Summary.',
    zh: '输入 4, 2-3 并选择“将范围导出为一份 PDF”。结果恰好有 3 页，依次为 Notes、Checklist、Summary。',
  },
  'delete-pages': {
    en: 'Delete page 3 and export. Expect three pages in the order Overview, Checklist, Notes. Undo restores the original.',
    zh: '删除第 3 页后导出。结果应为 3 页，依次是 Overview、Checklist、Notes；撤销可恢复原文档。',
  },
  'watermark-pdf': {
    en: 'Enable the optional text watermark, type DRAFT and export. Check that DRAFT is visible; it is a visual mark, not redaction.',
    zh: '打开可选文字水印，输入 DRAFT 后导出。检查 DRAFT 是否显示；水印只是视觉标记，不是安全打码。',
  },
  'pdf-to-images': {
    en: 'Choose PNG and the page range 1-2. The downloaded ZIP should contain exactly two PNG images, one for each page.',
    zh: '选择 PNG 格式并输入页码范围 1-2。下载的 ZIP 应包含两张 PNG 图片，对应前两页。',
  },
  'compress-pdf': {
    en: 'Compare the original and processed byte counts. This small text PDF may already be compact; compression is not guaranteed, and a non-smaller result cannot be downloaded.',
    zh: '比较原始与处理后文件的字节数。这个小型文字 PDF 可能已经很紧凑，不保证能压缩；结果没有变小时不可下载。',
  },
  'pdf-to-txt': {
    en: 'Extract selectable text. The TXT should include Overview, Checklist, Summary and Notes; scanned image-only PDFs still require OCR.',
    zh: '提取可选择的文字。TXT 应包含 Overview、Checklist、Summary、Notes；纯扫描图片 PDF 仍需要 OCR。',
  },
  'pdf-to-markdown': {
    en: 'Convert selectable text to Markdown. The four section names should appear, but heading inference and complex layouts are only approximate.',
    zh: '将可选择的文字转为 Markdown。结果应包含四个章节名，但标题推断与复杂版式只能近似处理。',
  },
  'add-page-numbers': {
    en: 'Choose first PDF page 2 and starting number 1. The cover remains unnumbered; pages 2–4 receive 1, 2 and 3.',
    zh: '把“开始编号的 PDF 页”设为 2，“起始编号”设为 1。封面不编号，第 2～4 页分别显示 1、2、3。',
  },
});

export function demoForTool(mode, locale = 'en') {
  if (!Object.hasOwn(scenarios, mode)) return null;
  return {
    files: mode === 'merge-pdf' ? merge : single,
    expected: scenarios[mode][locale === 'zh' ? 'zh' : 'en'],
    title: locale === 'zh' ? '使用示例 PDF 验证结果' : 'Try a PDF example and check the result',
    privacy: locale === 'zh'
      ? '这些文件是公开的非私人示例。可在上方工具中点击“载入示例 PDF”直接试用，或在此下载后手动选择；自己的文件仍只在浏览器中处理。'
      : 'These are public, non-personal files. Choose Load example PDF in the tool above to try one immediately, or download the PDF here and select it yourself. Your files are still processed only in your browser.',
  };
}

/** Download public sample PDFs using same-origin GET and create normal Files.
 * The existing import path handles validation, cancellation and undo history.
 */
export async function loadDemoPdfFiles(mode) {
  const demo = demoForTool(mode);
  if (!demo) throw new Error('No sample PDF is available for this tool.');
  const files = [];
  for (const source of demo.files) {
    const response = await fetch(source.path, { cache: 'no-store' });
    if (!response.ok) throw new Error('The sample PDF could not be loaded.');
    const data = await response.arrayBuffer();
    if (data.byteLength < 100 || data.byteLength > 1024 * 1024) {
      throw new Error('The sample PDF is unavailable or unexpectedly large.');
    }
    files.push(new File([data], source.name, { type: 'application/pdf' }));
  }
  return files;
}
