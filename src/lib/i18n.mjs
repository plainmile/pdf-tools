export const languages = ['en', 'zh'];
export const langPath = (path = '/', locale = 'en') => {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return locale === 'zh' ? (suffix === '/' ? '/zh/' : `/zh${suffix}`) : suffix;
};
export const unlocalize = (pathname = '/') => pathname.replace(/^\/zh(?=\/|$)/, '') || '/';

export const siteCopy = {
  en: {
    nav: { workspace: 'Workspace', merge: 'Merge PDF', split: 'Split PDF', tools: 'All tools', open: 'Open workspace', privacy: 'Privacy', theme: 'Appearance', system: 'System', light: 'Light', dark: 'Dark', language: 'Language' },
    footer: { tagline: 'Simple PDF tools that respect your files.', local: 'Files stay on your device. Nothing is uploaded.', other: 'PlainMile' },
    home: {
      eyebrow: 'PDF TOOLS · FREE TO USE', title: 'Work with PDF pages, your way.',
      lead: 'Combine documents, move pages into the right order, rotate, remove or split them. See the result before you save.',
      start: 'Open PDF workspace', explore: 'Browse tools', local: 'Processed in your browser', noaccount: 'No account or watermarks', ordered: 'Full control of page order',
      visualTitle: 'Example page workspace', file1: 'Contract · page 1', file2: 'Attachment · page 2', file3: 'Contract · page 2',
      toolsEyebrow: 'PDF TOOLBOX', toolsTitle: 'Choose a task', toolsLead: 'Each tool opens the same workspace, so you can combine actions without reloading your files.',
      howTitle: 'A familiar, straightforward workflow', howSteps: ['Add one or more PDFs or images', 'Reorder or edit with visual page thumbnails', 'Download the finished PDF'],
      closing: 'Ready to organize your pages?', closingText: 'Use the full workspace for several edits in one session.',
    },
    toolsPage: { home: 'Home', private: 'LOCAL PROCESSING', how: 'How it works', other: 'Other PDF tools' },
    privacy: {
      title: 'Privacy', date: 'Updated October 22, 2026',
      blocks: [
        ['Your documents stay local', 'PDFs, images and exported files are processed in your browser. We do not send document contents, page previews or file names to a document processing server.'],
        ['No accounts or stored documents', 'There are no user accounts, cloud document storage or sync features. Your working files are kept in browser memory and disappear when you close or reload the page.'],
        ['Hosting and network requests', 'Your browser requests the HTML, scripts and stylesheets needed to run the site. Hosting infrastructure may record ordinary request metadata, such as IP address and request time. This does not include the contents of documents you edit.'],
        ['Limits and important documents', 'Very large files may use substantial device memory. Some advanced PDF features, including interactive forms, attachments or digital signatures, may not survive page copying. Always inspect important exports before using them.'],
      ],
    },
  },
  zh: {
    nav: { workspace: 'PDF 工作台', merge: '合并 PDF', split: '拆分 PDF', tools: '全部工具', open: '打开工作台', privacy: '隐私说明', theme: '外观', system: '跟随系统', light: '浅色', dark: '深色', language: '语言' },
    footer: { tagline: '简单实用、尊重隐私的 PDF 工具。', local: '文件只在设备本地处理，不上传服务器。', other: 'PlainMile 主站' },
    home: {
      eyebrow: 'PDF 工具 · 免费使用', title: '整理 PDF 页面，就这么简单。',
      lead: '合并多个文件、自由调整页面顺序、旋转、删除或拆分。先预览，再下载，不需要上传文件。',
      start: '打开 PDF 工作台', explore: '查看全部工具', local: '浏览器本地处理', noaccount: '无需账号、不加水印', ordered: '逐页查看与精确排序',
      visualTitle: '页面工作台示意', file1: '合同 · 第 1 页', file2: '附件 · 第 2 页', file3: '合同 · 第 2 页',
      toolsEyebrow: 'PDF 工具箱', toolsTitle: '选择您要做的操作', toolsLead: '各工具共用同一个工作台，可以连续操作，不必反复导入文件。',
      howTitle: '熟悉、直接的操作流程', howSteps: ['添加 PDF 或图片', '通过页面缩略图调整顺序和内容', '下载整理完成的 PDF'],
      closing: '准备好整理文档了吗？', closingText: '打开工作台，一次完成合并、排序、旋转等操作。',
    },
    toolsPage: { home: '首页', private: '本地处理，不上传文件', how: '使用方法', other: '其他 PDF 工具' },
    privacy: {
      title: '隐私说明', date: '更新日期：2026 年 10 月 22 日',
      blocks: [
        ['文档在浏览器本地处理', 'PDF、图片和导出的文件均在您的浏览器中处理。我们不向文档处理服务器发送原文件、预览图或文件名称。'],
        ['无需账号，不保存文档', '本站无需注册，不提供云存储或跨设备同步。操作时文档保存在浏览器内存中，关闭或刷新页面后不再保留。'],
        ['网站访问请求', '浏览器需要请求网站页面、脚本及样式。主机服务可能记录常规访问元信息，例如 IP 地址和访问时间，但这些请求不包含您处理的文档内容。'],
        ['大文件和重要文档', '大文件可能占用较多设备内存。页面复制可能不保留 PDF 的交互表单、附件或数字签名。重要文件请检查导出结果后再使用。'],
      ],
    },
  },
};

export const chineseTools = {
  workspace: { title: 'PDF 工作台', short: '一个地方，整理全部页面', headline: '自由整理每一页 PDF。', description: '把多个 PDF 或图片组合起来，拖拽排序、旋转、删除、提取并导出。所有操作在浏览器本地完成。', details: '添加文件后即可看到全部页面缩略图。按您指定的顺序编辑，再导出新的 PDF。', steps: ['添加 PDF 或图片', '按需调整页面顺序', '导出 PDF'] },
  'merge-pdf': { title: '合并 PDF', short: '多个文件，合并成一个', headline: '按您指定的顺序合并 PDF。', description: '合并多个 PDF，导出前可预览、逐页调整顺序。不必上传文件到服务器。', details: '不仅能调整文件顺序，还能混排不同文件中的页面，旋转扫描件并删除不需要的页面。', steps: ['添加多个 PDF', '调整页面顺序', '导出合并后的 PDF'] },
  'split-pdf': { title: '拆分 PDF', short: '按范围或固定页数拆分', headline: '将 PDF 拆分成需要的部分。', description: '按页码范围或每 N 页拆分 PDF，将结果打包成 ZIP 下载。文件在本地处理。', details: '输入 1-3, 4-6 等范围，每个范围独立输出；也可以按固定页数自动拆分。', steps: ['添加 PDF', '输入拆分范围或每份页数', '下载 ZIP'] },
  'organize-pdf': { title: '整理 PDF 页面', short: '缩略图拖拽排序', headline: '让每一页出现在正确位置。', description: '通过缩略图和移动按钮调整 PDF 页面顺序，支持撤销和重做。', details: '跨文件调整页面顺序，旋转、删除页面。也可通过键盘可操作的按钮移动页面。', steps: ['添加文件', '预览并排序', '导出 PDF'] },
  'rotate-pdf': { title: '旋转 PDF 页面', short: '修正方向不对的扫描页', headline: '轻松调整歪倒的页面。', description: '选中一页或多页，以 90° 为单位旋转，再导出新的 PDF。', details: '选中方向不正确的页面，向左或向右旋转。原始文件不会被修改。', steps: ['添加 PDF', '选择并旋转页面', '导出 PDF'] },
  'extract-pages': { title: '提取 PDF 页面', short: '只保留需要的页面', headline: '把选中的页面单独保存。', description: '从一个或多个 PDF 中勾选页面，按照工作台当前顺序提取成新 PDF。', details: '适合从报告、合同和附件中快速提取需要的几页。', steps: ['添加 PDF', '选择需要的页面', '导出所选页面'] },
  'delete-pages': { title: '删除 PDF 页面', short: '去除不需要的页面', headline: '去掉不需要的 PDF 页面。', description: '预览并批量删除页面，支持撤销操作。不会修改原始 PDF。', details: '勾选一个或多个页面、删除、核对结果，再下载整理好的文档。', steps: ['添加 PDF', '选择并删除页面', '导出 PDF'] },
  'image-to-pdf': { title: '图片转 PDF', short: '支持 JPG、PNG、WebP', headline: '将图片整理为 PDF。', description: '将 JPG、PNG、WebP 图片转为 PDF 页面，可与现有 PDF 混排和合并。', details: '图片会按比例放入 A4 纸张，不会被拉伸。可随时调整顺序后导出。', steps: ['添加图片', '调整顺序', '导出 PDF'] },
};

export const workspaceCopy = {
  en: {
    app: 'PDF page workspace', local: 'ON-DEVICE PROCESSING', organize: 'Organize', split: 'Split', add: 'Add files', export: 'Export PDF', working: 'Working…',
    dropTitle: 'Drop PDF files or images here', dropSub: 'Or choose files from your device', choose: 'Choose PDF or images', opening: 'Opening files…',
    limits: 'PDF, JPG, PNG, WebP · Up to 20 files · 25 MB each · 200 pages total', private: 'Your files stay on this device.', reset: 'Clear workspace and start over',
    page: 'page', pages: 'pages', file: 'file', files: 'files', from: 'from', selected: 'selected', undo: 'Undo', redo: 'Redo', clear: 'Clear',
    all: 'Select all', none: 'Deselect', rotateLeft: 'Rotate left', rotateRight: 'Rotate right', extract: 'Extract', del: 'Delete',
    dragHint: 'Drag thumbnails to reorder. To move several pages, select them first and drag one of the selected pages. Shift-click selects a range. On touch screens or with a keyboard, use the move buttons.',
    addMore: 'Add more files', pageName: 'Page', document: 'Document', previewFail: 'Preview unavailable', selectPage: 'Select page', moveLeft: 'Move page {n} left', moveRight: 'Move page {n} right', dragTitle: 'Drag to reorder',
    splitTitle: 'Choose how to split', splitHint: 'Page numbers follow your current workspace order. Every result is included in one ZIP download.',
    byRanges: 'Split by page ranges', pageRanges: 'Page ranges', rangeHint: 'Example: 1-3, 4-5, 6. Each range becomes one PDF.', every: 'Split every N pages', perFile: 'Pages per PDF', downloadZip: 'Download split PDFs (ZIP)', creating: 'Creating PDFs…',
    foot: 'All document processing stays in your browser', footLimit: '100 MB combined · No password-protected PDFs',
    noFile: 'Add at least one PDF or image first.', selectionNeeded: 'Select at least one page to extract.',
    loaded: 'Added {files} file(s) and {pages} page(s).', exported: 'Export complete. Your original files were not changed.',
    extracted: 'Exported {pages} selected page(s).', zipped: 'Created {files} PDF file(s) in a ZIP archive.', cleared: 'Workspace cleared.',
    errorGeneric: 'Could not complete the operation.', errorFiles: 'You can work with at most {n} files.', errorTypes: 'Choose PDF, JPG, PNG or WebP files.', errorCombined: 'The total input size must be 100 MB or less.', errorPages: 'At most {n} pages can be added.', dismiss: 'Dismiss message',
    invalidRange: 'Check page ranges or pages per file to continue.', estimate: '{files} PDF file(s) will be generated.',
  },
  zh: {
    app: 'PDF 页面工作台', local: '文件仅在本机处理', organize: '整理页面', split: '拆分文件', add: '添加文件', export: '导出 PDF', working: '正在处理…',
    dropTitle: '将 PDF 或图片拖入此处', dropSub: '也可以从您的设备中选择文件', choose: '选择 PDF 或图片', opening: '正在读取…',
    limits: 'PDF、JPG、PNG、WebP · 最多 20 个文件 · 单文件 25 MB · 共 200 页', private: '文件始终留在您的设备上。', reset: '清空工作台，重新开始',
    page: '页', pages: '页', file: '个文件', files: '个文件', from: '来自', selected: '页已选中', undo: '撤销', redo: '重做', clear: '清空',
    all: '全选', none: '取消选择', rotateLeft: '向左旋转', rotateRight: '向右旋转', extract: '提取页面', del: '删除页面',
    dragHint: '拖拽缩略图可调整顺序。先多选再拖动选中页面，可成组移动；按住 Shift 点击可选择连续页面。触屏或键盘操作可用每页下方的左右按钮。',
    addMore: '继续添加文件', pageName: '第', document: '文档', previewFail: '无法预览', selectPage: '选择第', moveLeft: '向左移动第 {n} 页', moveRight: '向右移动第 {n} 页', dragTitle: '拖动可调整顺序',
    splitTitle: '选择拆分方式', splitHint: '页码以当前工作台的顺序为准。所有结果将打包成一个 ZIP 文件。',
    byRanges: '按页码范围拆分', pageRanges: '页码范围', rangeHint: '例如：1-3, 4-5, 6。每个范围独立生成一个 PDF。', every: '每 N 页拆分一次', perFile: '每个 PDF 的页数', downloadZip: '下载拆分文件（ZIP）', creating: '正在生成…',
    foot: '所有文档操作均在浏览器本地完成', footLimit: '合计最多 100 MB · 暂不支持加密 PDF',
    noFile: '请先添加 PDF 或图片。', selectionNeeded: '请先选择需要提取的页面。',
    loaded: '已添加 {files} 个文件，共 {pages} 页。', exported: '导出成功，原始文件没有被修改。',
    extracted: '已提取 {pages} 页。', zipped: '已将 {files} 个 PDF 打包为 ZIP。', cleared: '工作台已清空。',
    errorGeneric: '操作失败，请检查文件后重试。', errorFiles: '一次最多处理 {n} 个文件。', errorTypes: '请选择 PDF、JPG、PNG 或 WebP 文件。', errorCombined: '所有输入文件总大小不得超过 100 MB。', errorPages: '一次最多支持 {n} 页，请减少文件。', dismiss: '关闭提示',
    invalidRange: '请检查拆分页码或每份页数。', estimate: '预计生成 {files} 个 PDF 文件。',
  },
};

export function interpolate(template, params = {}) {
  return template.replace(/\{([a-z]+)\}/g, (_, key) => String(params[key] ?? ''));
}

export function translateProcessingError(message, locale = 'en') {
  if (locale !== 'zh') return message;
  const error = String(message);
  if (/reversed|outside pages|invalid page range|range such as|range is supported|pages.per.file|no pages to split/i.test(error)) return workspaceCopy.zh.invalidRange;
  if (/password.protected|encrypted/i.test(error)) return '暂不支持带密码保护的 PDF，请先使用已授权方式解锁。';
  if (/could not be opened|as a PDF|corrupt/i.test(error)) return '文件无法作为 PDF 打开，请检查文件是否损坏。';
  if (/25 MB|between 1 byte/i.test(error)) return '单个文件大小必须在 25 MB 以内，且不能为空。';
  if (/image dimensions|too large/i.test(error)) return '图片尺寸过大，请缩小后重试。';
  if (/50 output|50 ranges/i.test(error)) return '一次最多生成 50 个 PDF，请调整拆分范围。';
  return workspaceCopy.zh.errorGeneric;
}
