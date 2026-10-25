export const languages = ['en', 'zh'];
export const langPath = (path = '/', locale = 'en') => {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return locale === 'zh' ? (suffix === '/' ? '/zh/' : `/zh${suffix}`) : suffix;
};
export const unlocalize = (pathname = '/') => pathname.replace(/^\/zh(?=\/|$)/, '') || '/';

export const siteCopy = {
  en: {
    nav: { workspace: 'Workspace', merge: 'Merge PDF', split: 'Split PDF', tools: 'All tools', open: 'Open workspace', privacy: 'Privacy', theme: 'Appearance', system: 'System', light: 'Light', dark: 'Dark', language: 'Language' },
    footer: { officialSite: 'Official site', github: 'GitHub source code', report: 'Report an issue', tagline: 'Simple PDF tools that respect your files.', local: 'Files stay on your device. Nothing is uploaded.', other: 'PlainMile' },
    home: {
      eyebrow: 'PDF TOOLS · FREE TO USE', title: 'Work with PDF pages, your way.',
      lead: 'Combine documents, move pages into the right order, rotate, remove or split them. See the result before you save.',
      start: 'Open PDF workspace', explore: 'Browse tools', local: 'Processed in your browser', noaccount: 'No account or automatic watermarks', ordered: 'Full control of page order',
      visualTitle: 'Example page workspace', file1: 'Contract · page 1', file2: 'Attachment · page 2', file3: 'Contract · page 2',
      toolsEyebrow: 'PDF TOOLBOX', toolsTitle: 'Choose a task', toolsLead: 'Choose a visual PDF workspace task or a focused converter. Everything runs on your device.',
      howTitle: 'A familiar, straightforward workflow', howSteps: ['Add one or more PDFs or images', 'Reorder or edit with visual page thumbnails', 'Download the finished PDF'],
      closing: 'Ready to organize your pages?', closingText: 'Use the full workspace for several edits in one session.',
    },
    toolsPage: { home: 'Home', private: 'LOCAL PROCESSING', how: 'How it works', other: 'Other PDF tools' },
    privacy: {
      title: 'Privacy', date: 'Updated October 22, 2026',
      blocks: [
        ['Your documents stay local', 'PDFs, images, TXT/Markdown text and exported files are processed in your browser. We do not send document contents, page previews or file names to a document processing server.'],
        ['No accounts or stored documents', 'There are no user accounts, cloud document storage or sync features. Your working files are kept in browser memory and disappear when you close or reload the page.'],
        ['Hosting and network requests', 'Your browser requests the HTML, scripts and stylesheets needed to run the site. Hosting infrastructure may record ordinary request metadata, such as IP address and request time. This does not include the contents of documents you edit.'],
        ['Limits and important documents', 'Very large files may use substantial device memory. Some advanced PDF features, including interactive forms, attachments or digital signatures, may not survive page copying. Always inspect important exports before using them.'],
      ],
    },
  },
  zh: {
    nav: { workspace: 'PDF 工作台', merge: '合并 PDF', split: '拆分 PDF', tools: '全部工具', open: '打开工作台', privacy: '隐私说明', theme: '外观', system: '跟随系统', light: '浅色', dark: '深色', language: '语言' },
    footer: { officialSite: '官方网站', github: 'GitHub 开源代码', report: '反馈问题', tagline: '简单实用、尊重隐私的 PDF 工具。', local: '文件只在设备本地处理，不上传服务器。', other: 'PlainMile 主站' },
    home: {
      eyebrow: 'PDF 工具 · 免费使用', title: '整理 PDF 页面，就这么简单。',
      lead: '合并多个文件、自由调整页面顺序、旋转、删除或拆分。先预览，再下载，不需要上传文件。',
      start: '打开 PDF 工作台', explore: '查看全部工具', local: '浏览器本地处理', noaccount: '无需账号、不强制添加水印', ordered: '逐页查看与精确排序',
      visualTitle: '页面工作台示意', file1: '合同 · 第 1 页', file2: '附件 · 第 2 页', file3: '合同 · 第 2 页',
      toolsEyebrow: 'PDF 工具箱', toolsTitle: '选择您要做的操作', toolsLead: '可视化工作台与独立转换工具均在浏览器本地运行。',
      howTitle: '熟悉、直接的操作流程', howSteps: ['添加 PDF 或图片', '通过页面缩略图调整顺序和内容', '下载整理完成的 PDF'],
      closing: '准备好整理文档了吗？', closingText: '打开工作台，一次完成合并、排序、旋转等操作。',
    },
    toolsPage: { home: '首页', private: '本地处理，不上传文件', how: '使用方法', other: '其他 PDF 工具' },
    privacy: {
      title: '隐私说明', date: '更新日期：2026 年 10 月 22 日',
      blocks: [
        ['文档在浏览器本地处理', 'PDF、图片、TXT/Markdown 文本及导出的文件均在您的浏览器中处理。我们不向文档处理服务器发送原文件、预览图或文件名称。'],
        ['无需账号，不保存文档', '本站无需注册，不提供云存储或跨设备同步。操作时文档保存在浏览器内存中，关闭或刷新页面后不再保留。'],
        ['网站访问请求', '浏览器需要请求网站页面、脚本及样式。主机服务可能记录常规访问元信息，例如 IP 地址和访问时间，但这些请求不包含您处理的文档内容。'],
        ['大文件和重要文档', '大文件可能占用较多设备内存。页面复制可能不保留 PDF 的交互表单、附件或数字签名。重要文件请检查导出结果后再使用。'],
      ],
    },
  },
};

export const chineseTools = {
  workspace: { title: 'PDF 工作台', short: '一个地方，整理全部页面', headline: '自由整理每一页 PDF。', description: '在浏览器本地整理 PDF：拖拽排序、旋转、复制页面、插入空白页、删除或提取，不上传原始文件。', details: '添加 PDF 或图片后预览全部页面；可复制选中页，或按相邻纸张大小插入空白页，再下载新的 PDF。', steps: ['添加 PDF 或图片', '按需调整页面顺序', '导出 PDF'] },
  'merge-pdf': { title: '合并 PDF', short: '多个文件，合并成一个', headline: '按您指定的顺序合并 PDF。', description: '在浏览器本地合并 PDF、调整逐页顺序，并支持两份单面扫描文件按正反面交错合并或反面倒序。', details: '不仅能调整文件顺序，还能混排、旋转、删除页面。对正反面分别扫描的两份 PDF，展开“合并双面扫描”选择是否反转背面页，再交错合并。两份文件的页数需相同，或正面只多一页。原文件不会被修改。', steps: ['添加多个 PDF', '调整顺序或选择双面交错合并', '导出合并后的 PDF'] },
  'split-pdf': { title: '拆分 PDF', short: '按范围或固定页数拆分', headline: '将 PDF 拆分成需要的部分。', description: '按页码范围或每 N 页拆分 PDF，单份直接下载 PDF，多份打包 ZIP。文件在本地处理。', details: '输入 1-3, 4-6 等范围，每个范围独立输出；也可以按固定页数自动拆分。', steps: ['添加 PDF', '输入拆分范围或每份页数', '下载 PDF 或 ZIP'] },
  'organize-pdf': { title: '整理 PDF 页面', short: '缩略图拖拽排序', headline: '让每一页出现在正确位置。', description: '可视化排序、复制 PDF 页面、插入空白页，还能旋转与删除。支持撤销、重做和本地导出。', details: '跨文件调整页面顺序，复制选中页或插入与相邻页面等尺寸的空白页。支持键盘操作，不上传文档。', steps: ['添加文件', '预览并排序', '导出 PDF'] },
  'rotate-pdf': { title: '旋转 PDF 页面', short: '修正方向不对的扫描页', headline: '轻松调整歪倒的页面。', description: '选中一页或多页，以 90° 为单位旋转，再导出新的 PDF。', details: '选中方向不正确的页面，向左或向右旋转。原始文件不会被修改。', steps: ['添加 PDF', '选择并旋转页面', '导出 PDF'] },
  'extract-pages': { title: '提取 PDF 页面', short: '只保留需要的页面', headline: '把选中的页面单独保存。', description: '从一个或多个 PDF 中勾选页面，按照工作台当前顺序提取成新 PDF。', details: '适合从报告、合同和附件中快速提取需要的几页。', steps: ['添加 PDF', '选择需要的页面', '导出所选页面'] },
  'delete-pages': { title: '删除 PDF 页面', short: '去除不需要的页面', headline: '去掉不需要的 PDF 页面。', description: '预览并批量删除页面，支持撤销操作。不会修改原始 PDF。', details: '勾选一个或多个页面、删除、核对结果，再下载整理好的文档。', steps: ['添加 PDF', '选择并删除页面', '导出 PDF'] },
  'watermark-pdf': { title: '添加 PDF 水印', short: '自定义文字水印', headline: '按需给 PDF 添加水印。', description: '默认无水印。可选择开启并填写中文或英文文字，在浏览器本地生成水印 PDF。', details: '通过工作台的“导出选项”开启文字水印。默认关闭，不会给文件自动加标记。', steps: ['添加 PDF 文件', '打开导出选项并输入水印内容', '导出带水印的 PDF'] },
  'pdf-to-images': { title: 'PDF 转图片', short: '导出 JPG 或 PNG', headline: '把 PDF 页面转换为 JPG、PNG 图片。', description: '在浏览器本地将 PDF 转换为 JPG、PNG，支持指定页码和清晰度；多页自动打包 ZIP，无需上传。', details: '支持选择图片格式、清晰度以及页码范围。单页直接下载图片，多页打包 ZIP 下载。', steps: ['选择 PDF', '设置图片格式与页码', '下载图片或 ZIP'] },
  'compress-pdf': { title: '压缩 PDF', short: '比较实际压缩前后的大小', headline: '压缩 PDF，并验证文件真正变小。', description: '本地图片化压缩 PDF，先比较原始文件和输出文件大小，确认变小再下载；会失去文字搜索与交互元素。', details: '适合图片较多的 PDF。将页面重新渲染为 JPEG，可能损失清晰度、表单、链接和文字搜索能力；若输出更大则不下载。', steps: ['选择文件和压缩强度', '比较压缩前后的体积', '仅在文件变小时下载'] },
  'pdf-to-txt': { title: 'PDF 转 TXT', short: '提取已有可选中文字', headline: '提取 PDF 文字并保存为 TXT。', description: '本地提取 PDF 中已有的可选择文字，导出 UTF-8 TXT。扫描件需要 OCR，当前不提供 OCR。', details: '文本顺序受原始 PDF 排版影响，多栏和表格可能错乱。无文本扫描件不会生成空结果。', steps: ['选择包含可选择文字的 PDF', '提取文字', '下载 TXT'] },
  'pdf-to-markdown': { title: 'PDF 转 Markdown', short: '近似提取标题与正文', headline: '将 PDF 文字整理为 Markdown。', description: '浏览器本地将可选中 PDF 文字导出 Markdown，并近似识别标题。不支持 OCR 和复杂排版的精准还原。', details: '可根据字号推断标题，适合简单文档；复杂表格、多栏、图片可能丢失原有结构。', steps: ['选择文字型 PDF', '提取并推测标题层次', '下载 Markdown 文件'] },
  'txt-to-pdf': { title: 'TXT 转 PDF', short: '纯文本生成 PDF', headline: '把 TXT 文本转换成 PDF。', description: '在浏览器中粘贴或导入 TXT，生成 A4 PDF。含中文等特殊字符的页面会图片化，其他页面保留可选择、可搜索文字。', details: '支持 UTF-8 或带 BOM 的 UTF-16。仅使用内置字体无法呈现的页面需要图片化，其余页面可继续搜索、复制文字；源文本不上传。', steps: ['输入或导入 TXT', '核对文本内容', '下载 PDF'] },
  'markdown-to-pdf': { title: 'Markdown 转 PDF', short: '支持简单标题、列表和代码', headline: '将基础 Markdown 生成 PDF。', description: '本地转换基础 Markdown 的标题、段落、列表、引用和代码块；暂不支持复杂表格、HTML 与远程图片。', details: '使用轻量级 Markdown 子集。只有包含内置字体不支持字符的页面被图片化，其他页面保留可选择文字；复杂排版需核对。', steps: ['粘贴或导入 Markdown', '检查标题和内容', '下载 PDF'] },
  'add-page-numbers': { title: '添加 PDF 页码', short: '可跳过封面，逐页检查', headline: '从指定 PDF 页面开始添加页码。', description: '在浏览器本地添加可选择的 PDF 页码，支持六种位置、三档边距、起始数字及任意页面预览，可跳过封面。', details: '分别设置开始编号的 PDF 页与显示的起始数字；封面和目录可以保留不编号。支持顶部或底部左、中、右六种位置与 12、24、40 点的页码边距；生成后可查看第一张编号页、末页或指定页面，再确认下载。小页面若容纳不下页码，会提示调整设置。重要文件还需检查数字签名。', steps: ['选择 PDF 并设置页码', '预览任意页面的实际页码', '核对后下载 PDF'] },
  'image-to-pdf': { title: '图片转 PDF', short: 'JPG、PNG、WebP、BMP、静态 AVIF', headline: '将图片整理为 PDF。', description: '把 JPG、BMP、静态 PNG、静态 WebP 和静态 AVIF 图片转为 PDF。支持 A4、Letter、适合图片、横竖方向和边距；AVIF 需要浏览器解码能力。', details: '可在导入前设置纸张、方向和边距，也可以在导入后重新应用设置。JPG 会移除常见 EXIF、XMP、IPTC 和注释元数据（可能包含 GPS），保留照片方向和原有压缩画质；不处理已有 PDF 的元数据。', steps: ['选择纸张、方向和边距', '添加图片并按需调整顺序', '核对预览后导出 PDF'] },
};

export const workspaceCopy = {
  en: {
    imageSizing: 'Image placement', imageContain: 'Fit entire image (no crop)', imageCover: 'Fill printable area (crop edges)', imageContainHint: 'Entire image is visible; blank space may appear.', imageCoverHint: 'Image fills the area; some edges will be cropped.', imageFitSizingHint: 'Fit-to-image always keeps the full original image.', sortFilename: 'Sort images by filename (A–Z)', sortImagesDesc: 'Sort images by filename (Z–A)', sortPdfFilesAsc: 'Sort source files A–Z', sortPdfFilesDesc: 'Sort source files Z–A', sortPdfFilesHint: 'Sorting groups pages by original filename, including pages you deliberately interleaved. Each file keeps its internal page order. Undo restores your previous order.', duplexToggle: 'Recombine two-sided scans (optional)', duplexHint: 'Front pages: {front}. Back pages: {back}. The first source is treated as fronts and the second as backs. Page counts must match, or fronts may have one extra. The second button reverses the backs before alternating. Review output; Undo restores it.', duplexForward: 'Interleave front / back', duplexReverse: 'Interleave + reverse backs', duplexInvalidCounts: 'The front PDF must have as many pages as the back PDF, or one extra. Confirm which source is first; no pages were changed.', duplexDone: 'Duplex pages interleaved. Check page order before export; Undo restores it.', reverseOrder: 'Reverse image order', reversePdfOrder: 'Reverse all pages', documentCaution: 'Page copying creates a new PDF. Interactive forms, annotations, embedded attachments and digital signatures may be lost or invalidated. Review important documents after export.', formRisk: 'Interactive form fields detected in {files} PDF file(s). Copying pages may remove fillable fields or their editing behavior and invalidate digital signatures. Keep the original PDF and check every field in the export.', bookmarkRisk: 'Document bookmarks detected in {files} PDF file(s). An unchanged single-PDF export preserves the original clickable table of contents. Rotation, reordering, merging, extracting, splitting or watermarking can remove chapter bookmarks. Keep the source and check modified exports.', imageSettings: 'Image page settings', imageSettingsHint: 'Choose before importing, or apply changes to imported photos below.', imagePaper: 'Paper size', imageFit: 'Fit to image', imageFitAutoHint: 'Fit-to-image follows each photo shape automatically.', imageOrientation: 'Page orientation', imagePortrait: 'Portrait', imageLandscape: 'Landscape', imageAuto: 'Auto (match each image)', imageMargin: 'Page margins', imageMarginNone: 'No margins (0 pt)', imageMarginNarrow: 'Narrow (12 pt)', imageMarginNormal: 'Standard (30 pt)', imageMarginWide: 'Wide (48 pt)', imageLayoutDirty: 'These settings have not been applied to the loaded photos. Apply them before exporting.', imageApply: 'Apply to imported photos', imageApplyProgress: 'Updating photo {done} of {total}', imageApplyCancel: 'Cancel update', imageApplyCancelling: 'Cancelling…', imageApplied: 'Photo page settings applied. Page order and selections were preserved.', imageMustApply: 'Apply updated page settings before adding more files or exporting.', outputName: 'Download filename', renameDownload: 'Rename downloaded files (optional)', renameReset: 'Use suggested name', renameHint: 'PDF extensions and unsafe path characters are cleaned automatically. Extracted pages and split files use this name as their prefix.',
    exportOptions: 'Export options', exportOptionsHint: 'No watermark is added unless you enable it.', watermarkOn: 'Watermark on',
    watermarkLabel: 'Add text watermark (optional)', watermarkTextLabel: 'Watermark text', watermarkPlaceholder: 'e.g. CONFIDENTIAL',
    watermarkHelp: 'Light diagonal text on every exported page. Thumbnail previews are approximate.',
    watermarkNeedsText: 'Enter text to apply a watermark, or switch it off to export without one.',
    app: 'PDF page workspace', local: 'ON-DEVICE PROCESSING', exportAllPages: 'Export all pages', morePageActions: 'More page actions', focusRotateHint: 'Select the pages whose orientation needs fixing, then rotate left or right. Unselected pages stay unchanged.', focusDeleteHint: 'Select the pages to remove, then click Delete. Undo can restore them before exporting.', focusExtractHint: 'Select the pages to save into a separate PDF, then click Extract. Use Export all pages only when you want the entire file.', organize: 'Organize', split: 'Split', add: 'Add files', export: 'Export PDF', working: 'Working…',
    dropTitle: 'Drop PDF files or images here', dropSub: 'Or choose files from your device', choose: 'Choose PDF or images', opening: 'Opening files…',
    limits: 'PDF, JPG, BMP, static PNG, static WebP, static AVIF · Up to 20 files · 100 MB each · 600 pages total', private: 'Your files stay on this device.', reset: 'Clear workspace and start over',
    page: 'page', pages: 'pages', file: 'file', files: 'files', from: 'from', selected: 'selected', undo: 'Undo', redo: 'Redo', clear: 'Clear', clearConfirmTitle: 'Clear the PDF workspace?', clearConfirmDescription: 'This permanently removes all loaded files, page edits and undo history. Continue?', cancelClear: 'Keep editing', confirmClear: 'Clear everything', reimportConfirmTitle: 'Discard the last Undo history?', reimportConfirmMessage: 'The {files} validated replacement file(s) will start a NEW workspace and permanently discard the deleted pages that can still be restored with Undo. Keep your previous work or explicitly start fresh.', reimportKeep: 'Keep deleted pages recoverable', reimportReplace: 'Start new workspace',
    all: 'Select all', none: 'Deselect', rangeSelectToggle: 'Select by page numbers', rangeSelectLabel: 'Output page numbers', rangeSelectApply: 'Select pages', rangeSelectHint: 'Use the current export order (e.g. 1-3, 5, 8-12). Replaces the selection; up to 50 ranges.', rangeSelected: 'Selected {pages} page(s) by output position.', rangeSelectInvalid: 'Invalid page selection. Check the page numbers and order (max 50 ranges).', quickSelectionLabel: 'Quick page selection', selectOdd: 'Odd pages (1, 3, 5…)', selectEven: 'Even pages (2, 4, 6…)', invertSelection: 'Invert selection', quickSelectionHint: 'Uses current output positions, even after reordering or merging files. These shortcuts replace the current selection; Invert swaps selected and unselected pages. They do not edit the PDF.', quickSelectionDone: '{pages} output page(s) selected.', moveToggle: 'Move selected pages to a page number', moveLabel: 'Target output page (1–{pages})', movePositionSide: 'Insert selected pages', moveBefore: 'Before target', moveAfter: 'After target', moveApply: 'Move selected pages', moveHint: 'Choose an unselected target page in the CURRENT export order (before moving). The selected pages stay together in their current order. Undo restores the previous order.', moveAllSelected: 'Deselect at least one page to provide an unselected destination.', moveInvalid: 'Enter a valid target page from 1 to {pages}.', moveTargetSelected: 'The target page is selected. Choose a page outside the selection.', moveUnchanged: 'These pages are already in that position.', moveDoneBefore: 'Moved {pages} page(s) before the previous output page {position}.', moveDoneAfter: 'Moved {pages} page(s) after the previous output page {position}.', jumpToggle: 'Go to page', jumpLabel: 'Output page number (1–{pages})', jumpAction: 'Find page', jumpHint: 'Scroll to this page in the current export order. Grouped file view switches to Export order; selection and page arrangement stay unchanged.', jumpInvalid: 'Enter an output page number from 1 to {pages}.', jumpFound: 'Showing output page {n}.', jumpPositionLabel: 'Output page {n}', rotateLeft: 'Rotate left', rotateRight: 'Rotate right', extract: 'Extract', del: 'Delete', duplicateSelected: 'Duplicate selected', duplicated: 'Duplicated {pages} selected page(s) after the originals.', insertBlank: 'Insert blank page', blankInserted: 'Added a blank page using the neighboring page size.', blankHint: 'One page selected: insert after it. None: append at the end. Select at most one page.',
    dragHint: 'Drag thumbnails to reorder; the accent line shows the precise insertion position. To move several pages, select them first and drag one of the selected pages. Shift-click selects a range. On touch screens or with a keyboard, use the move buttons.',
    viewExportOrder: 'Export order', viewBySource: 'Group by file', groupExpandAll: 'Expand all', groupCollapseAll: 'Collapse all', groupExpand: 'Expand {name}', groupCollapse: 'Collapse {name}', groupPageCount: '{pages} page(s)', groupSelectedCount: '{pages} selected in this file', groupClearSelection: 'Deselect this file', groupOutputPosition: 'Output page {n}', groupHint: 'File groups are a viewing aid only. Your export order does not change. Switch to Export order to drag or move pages.', addMore: 'Add more files', pageName: 'Page', document: 'Document', previewFail: 'Preview unavailable', previewOpen: 'Enlarge output page {n}', previewTitle: 'Output page {n} of {total}', previewSourcePage: 'Source page {n}', previewClose: 'Close page preview', previewPrevious: '← Previous', previewNext: 'Next →', previewZoomOut: 'Zoom out', previewZoomIn: 'Zoom in', previewFit: 'Fit page (100%)', previewLoading: 'Rendering this page…', previewHint: 'Inspect the original page with its current rotation. An enabled watermark is a rough visual guide; verify the exported PDF.', selectPage: 'Select page', moveLeft: 'Move page {n} left', moveRight: 'Move page {n} right', dragTitle: 'Drag to reorder',
    splitTitle: 'Choose how to split', splitHint: 'Choose up to 50 custom ranges, or split every N pages. If every-N produces over 50 PDFs, download separate batches of up to 50. All pages follow current export order.',
    splitOutputBudget: 'Generated PDFs are limited to 128 MB per operation to protect browser memory. One result downloads as PDF; multiple results as ZIP.', splitPartsProgress: 'Creating PDF {done} of {total}', splitZipProgress: 'Packaging ZIP: {percent}%', splitCancel: 'Cancel split', splitCancelling: 'Cancelling…', exportProgress: 'Exporting page {done} of {total}', exportCancel: 'Cancel export', exportCancelling: 'Cancelling…',
    visualSplitToggle: 'Choose split points by clicking pages',
    visualSplitHint: 'Select Cut after page under a preview. Click again to undo the cut. This builds a full-document split using the CURRENT page order, up to 50 files. You can still type page ranges above. In pages-per-file mode, clicking a cut switches to page ranges.',
    visualSplitPage: 'Output page {n}', visualSplitCutAfter: 'Toggle split after output page {n}',
    visualSplitCut: 'Cut after this page', visualSplitUndoCut: 'Remove cut',
    visualSplitLast: 'End of document', visualSplitClear: 'Remove all visual cuts',
    visualSplitConfirmTitle: 'Replace your custom page ranges?',
    visualSplitConfirmText: 'These manual ranges are partial, overlapping or out of order. Visual splitting always includes every page exactly once. Replace the typed ranges with a new full-document split?',
    visualSplitKeep: 'Keep my ranges', visualSplitReplace: 'Replace with visual split',
    byRanges: 'Split by page ranges', pageRanges: 'Page ranges', rangeHint: 'Example: 1-3, 4-5, 6. Each range becomes one PDF.', every: 'Split every N pages', perFile: 'Pages per PDF', eachPagePreset: 'One PDF per page', eachPageLimit: 'One PDF per page would split {pages} pages into {batches} separate batches of up to 50 PDFs each.', splitBatchStatus: 'Batch {index} of {total} · output pages {start}–{end}', splitBatchPrevious: 'Previous batch', splitBatchNext: 'Next batch', splitBatchWarning: 'Download each batch separately. Multiple output PDFs arrive in a ZIP; a batch with one output PDF downloads directly. A partial batch does not save the whole edited workspace.', splitBatchEstimate: 'This batch will create {files} PDF file(s).', splitBatchDownload: 'Download this batch (ZIP)', splitBatchDownloaded: 'Downloaded batch {index} of {total}. Use Next batch for the remaining pages.', splitFinalBatchDownloaded: 'Final batch ({index} of {total}) downloaded. Earlier batches are separate downloads; check that you saved each one.', downloadZip: 'Download split PDFs (ZIP)', downloadSingle: 'Download PDF', creating: 'Creating PDFs…',
    foot: 'All document processing stays in your browser', footLimit: '200 MiB retained source-data limit · No encrypted PDFs', bigDocWarning: 'Large PDF: previews are loaded as you scroll. Hundreds of pages can still consume significant device memory. Export may take longer.',
    emptyHistoryHint: 'All pages were removed. Undo to restore them, or add a file to begin a new workspace (the old undo history will be cleared).',
    noFile: 'Add at least one PDF or image first.', selectionNeeded: 'Select at least one page to extract.',
    loaded: 'Added {files} file(s) and {pages} page(s).', exported: 'Export complete. Your original files were not changed.',
    extracted: 'Exported {pages} selected page(s).', zipped: 'Created {files} PDF file(s) in a ZIP archive.', splitSingleSaved: 'Your PDF is ready. No ZIP extraction needed.', cleared: 'Workspace cleared.',
    errorGeneric: 'Could not complete the operation.', errorFiles: 'You can work with at most {n} files.', errorTypes: 'Choose PDF, JPG, PNG, WebP, BMP or static AVIF files. Animation is not supported.', errorCombined: 'The PDFs and original images retained in this workspace exceed the 200 MiB safety limit. Remove some pages/files or use smaller images.', errorPages: 'At most {n} pages can be added.', dismiss: 'Dismiss message',
    enterSplitRanges: 'Enter page ranges to split (for example, 1-3, 4-6).', enterSplitSize: 'Enter how many pages to put in each PDF.',
    invalidRange: 'Check page ranges (up to 50) or pages per file (maximum 50 PDFs per download; every-N splitting supports batches).', estimate: '{files} PDF file(s) will be generated.',
    splitCoverageComplete: 'Every current output page is included exactly once ({total} total).', splitCoverageOmitted: 'Pages excluded from the split: {pages} ({count} of {total}); {included} included. Check your ranges before downloading.', splitCoverageRepeated: 'Pages repeated across output files: {pages} ({count} total). Check whether duplication is intentional.', splitPreviewToggle: 'Review output PDF sections ({files})', splitPreviewPart: 'Part {index}: pages {start}–{end} ({count} {unit})',
  },
  zh: {
    imageSizing: '图片适配方式', imageContain: '完整显示（不裁剪）', imageCover: '填满可用区域（裁剪边缘）', imageContainHint: '完整显示图片，可能留白。', imageCoverHint: '填满页面可用区域，但可能裁剪边缘。', imageFitSizingHint: '适合图片模式保留完整原图，不会裁剪。', sortFilename: '图片按文件名排序（A–Z）', sortImagesDesc: '图片按文件名排序（Z–A）', sortPdfFilesAsc: '按来源文件名排序（A–Z）', sortPdfFilesDesc: '按来源文件名排序（Z–A）', sortPdfFilesHint: '排序会把同一来源文件的页面排列到一起，包括之前手动交错的页面。每个文件内部的当前页序不变，可使用撤销恢复。', duplexToggle: '合并双面扫描（可选）', duplexHint: '正面页：{front}。反面页：{back}。按当前页面顺序首先出现的来源作为正面文件，另一个作为反面文件。两份 PDF 页数应相同，或正面多一页。选择“反面倒序”可先反转反面，再交错合并。请核对结果，可撤销。', duplexForward: '正反面交错合并', duplexReverse: '反面倒序后交错合并', duplexInvalidCounts: '正面文件的页数应等于反面文件，或只多 1 页。请确认两份文件的顺序，页面没有改变。', duplexDone: '已交错合并双面扫描页面。请检查导出顺序，支持撤销恢复。', reverseOrder: '反转图片顺序', reversePdfOrder: '所有页面倒序', documentCaution: '复制 PDF 页面会创建新文档，交互表单、注释、嵌入附件和数字签名可能丢失或失效。重要文件请核对导出结果。', formRisk: '检测到 {files} 个含交互表单字段的 PDF。复制页面可能导致可填写字段、编辑能力丢失或数字签名失效。请保留原始 PDF，并逐项核对导出结果。', bookmarkRisk: '检测到 {files} 个含目录书签的 PDF。单个文件未经修改直接导出时会保留原始书签；旋转、排序、合并、提取、拆分或添加水印后可能丢失可点击的章节目录。请保留原文件并核对导出结果。', imageSettings: '图片页面设置', imageSettingsHint: '可在导入前设置；导入后更改时，需点击下方按钮重新应用到已有照片。', imagePaper: '纸张尺寸', imageFit: '适合图片', imageFitAutoHint: '适合图片时自动匹配每张照片方向，无法手动强制横竖版。', imageOrientation: '页面方向', imagePortrait: '纵向', imageLandscape: '横向', imageAuto: '自动匹配图片方向', imageMargin: '页面边距', imageMarginNone: '无边距（0 pt）', imageMarginNarrow: '窄（12 pt）', imageMarginNormal: '标准（30 pt）', imageMarginWide: '宽（48 pt）', imageLayoutDirty: '新设置尚未应用到已导入的照片。请先应用设置，再导出 PDF。', imageApply: '应用到已导入照片', imageApplyProgress: '正在更新第 {done} / {total} 张照片', imageApplyCancel: '取消应用', imageApplyCancelling: '正在取消…', imageApplied: '已更新照片页面设置，原有页面顺序和选择不变。', imageMustApply: '请先应用修改后的页面设置，再添加文件或导出。', outputName: '下载文件名', renameDownload: '自定义下载文件名（可选）', renameReset: '恢复默认文件名', renameHint: '会自动清理不安全的文件名字符并保留 .pdf 后缀。提取、拆分文件也会使用该名称作为前缀。',
    exportOptions: '导出选项', exportOptionsHint: '默认无水印，只有主动开启后才会添加。', watermarkOn: '水印已开启',
    watermarkLabel: '添加文字水印（可选）', watermarkTextLabel: '水印文字', watermarkPlaceholder: '例如：内部资料',
    watermarkHelp: '导出时在每页添加居中斜向的浅色水印，缩略图为近似预览。',
    watermarkNeedsText: '请填写水印内容；不需要时可关闭水印开关。',
    app: 'PDF 页面工作台', local: '文件仅在本机处理', exportAllPages: '导出全部页面', morePageActions: '更多页面操作', focusRotateHint: '选中方向不正确的页面，再点击向左或向右旋转；其他页面不会改变。', focusDeleteHint: '选中需要删除的页面后点击删除，导出前仍可撤销恢复。', focusExtractHint: '选择需要单独保存的页面，再点击提取。只有需要完整文档时才使用“导出全部页面”。', organize: '整理页面', split: '拆分文件', add: '添加文件', export: '导出 PDF', working: '正在处理…',
    dropTitle: '将 PDF 或图片拖入此处', dropSub: '也可以从您的设备中选择文件', choose: '选择 PDF 或图片', opening: '正在读取…',
    limits: 'PDF、JPG、BMP、静态 PNG、静态 WebP、静态 AVIF · 最多 20 个文件 · 单文件 100 MB · 共 600 页', private: '文件始终留在您的设备上。', reset: '清空工作台，重新开始',
    page: '页', pages: '页', file: '个文件', files: '个文件', from: '来自', selected: '页已选中', undo: '撤销', redo: '重做', clear: '清空', clearConfirmTitle: '确定清空 PDF 工作台？', clearConfirmDescription: '这会永久清除所有已加载文件、页面编辑及撤销历史。是否继续？', cancelClear: '继续编辑', confirmClear: '确认全部清空', reimportConfirmTitle: '确定丢弃最后的撤销历史？', reimportConfirmMessage: '即将使用 {files} 个已验证的新文件开始全新工作台。原来已删除的页面目前仍可撤销恢复；继续会永久清除这些页面与旧的撤销历史。', reimportKeep: '保留原页面以便恢复', reimportReplace: '确认开始新工作台',
    all: '全选', none: '取消选择', rangeSelectToggle: '按页码范围选择', rangeSelectLabel: '导出页码（当前页序）', rangeSelectApply: '选择这些页面', rangeSelectHint: '按当前导出页序输入，例如 1-3, 5, 8-12（也支持中文逗号）。会替换原有选择，最多 50 段。', rangeSelected: '已按导出页码选中 {pages} 页。', rangeSelectInvalid: '选择页码无效，请检查范围、页序和页数（最多 50 段）。', quickSelectionLabel: '快捷选择页面', selectOdd: '奇数页（1、3、5…）', selectEven: '偶数页（2、4、6…）', invertSelection: '反向选择', quickSelectionHint: '按当前导出位置计算，即使合并或重排过文件也一样。奇偶快捷选择会替换原选择；反向选择交换已选与未选页面。这些操作不会修改 PDF。', quickSelectionDone: '已按当前导出页序选中 {pages} 页。', moveToggle: '按页码移动选中页面', moveLabel: '目标导出页码（1–{pages}）', movePositionSide: '将选中页面插入', moveBefore: '目标页之前', moveAfter: '目标页之后', moveApply: '移动选中页', moveHint: '目标页码按移动前的当前导出页序计算，且目标页不可已选中。选中的页面按原顺序成组移动，可撤销。', moveAllSelected: '请先取消选择至少一页，作为未选中的目标位置。', moveInvalid: '请输入 1 到 {pages} 之间的有效目标页码。', moveTargetSelected: '目标页也处于选中状态，请选择未选中的目标页。', moveUnchanged: '这些页面已经位于所指定的位置。', moveDoneBefore: '已将 {pages} 页移动到移动前第 {position} 页之前。', moveDoneAfter: '已将 {pages} 页移动到移动前第 {position} 页之后。', jumpToggle: '快速定位页面', jumpLabel: '导出页码（1–{pages}）', jumpAction: '定位页面', jumpHint: '按当前导出页序定位缩略图；如正在按文件分组，将切换回导出页序。不会修改页面排列或已有选择。', jumpInvalid: '请输入 1 到 {pages} 之间的导出页码。', jumpFound: '已定位到导出第 {n} 页。', jumpPositionLabel: '导出第 {n} 页', rotateLeft: '向左旋转', rotateRight: '向右旋转', extract: '提取页面', del: '删除页面', duplicateSelected: '复制选中页', duplicated: '已在原位置后复制 {pages} 页。', insertBlank: '插入空白页', blankInserted: '已按相邻页面尺寸插入空白页。', blankHint: '选择一页时插入在其后；未选中时追加到末尾。插入前最多选中一页。',
    dragHint: '拖拽缩略图可调整顺序，插入位置会显示醒目的指示线。先多选再拖动选中页面，可成组移动；按住 Shift 点击可选择连续页面。触屏或键盘操作可用每页下方的左右按钮。',
    viewExportOrder: '导出顺序', viewBySource: '按来源文件分组', groupExpandAll: '展开全部', groupCollapseAll: '全部折叠', groupExpand: '展开{name}', groupCollapse: '折叠{name}', groupPageCount: '{pages} 页', groupSelectedCount: '本文件已选 {pages} 页', groupClearSelection: '取消本文件选择', groupOutputPosition: '导出第 {n} 页', groupHint: '文件分组仅改变查看方式，不会调整导出顺序。要拖动页面或调整页序，请切回“导出顺序”。', addMore: '继续添加文件', pageName: '第', document: '文档', previewFail: '无法预览', previewOpen: '放大查看导出第 {n} 页', previewTitle: '导出第 {n} / {total} 页', previewSourcePage: '原文件第 {n} 页', previewClose: '关闭页面预览', previewPrevious: '← 上一页', previewNext: '下一页 →', previewZoomOut: '缩小', previewZoomIn: '放大', previewFit: '适合页面（100%）', previewLoading: '正在渲染当前页面…', previewHint: '显示原始页面及当前旋转。水印预览仅供参考，请以实际导出的 PDF 为准。', selectPage: '选择第', moveLeft: '向左移动第 {n} 页', moveRight: '向右移动第 {n} 页', dragTitle: '拖动可调整顺序',
    splitTitle: '选择拆分方式', splitHint: '按当前工作台顺序拆分。自定义范围最多 50 份；按每 N 页拆分（包括逐页拆分）超过 50 份时，可分批处理（每批下载最多 50 份）。单份直接下载 PDF，多份打包 ZIP。',
    splitOutputBudget: '单次生成的 PDF 总大小不能超过 128 MB，以保护浏览器内存。单份直接下载 PDF，多份下载 ZIP。', splitPartsProgress: '正在生成第 {done}/{total} 个 PDF', splitZipProgress: '正在打包 ZIP：{percent}%', splitCancel: '取消拆分', splitCancelling: '正在取消…', exportProgress: '正在导出第 {done} / {total} 页', exportCancel: '取消导出', exportCancelling: '正在取消…',
    visualSplitToggle: '按页面预览设置拆分点',
    visualSplitHint: '在缩略图下点击「在此页后拆分」，再次点击可取消。依据当前输出页序生成完整拆分（最多 50 份）；仍可在上方手动填写页码。从「每 N 页」模式点击拆分点时会切换到页码范围模式。',
    visualSplitPage: '输出第 {n} 页', visualSplitCutAfter: '切换输出第 {n} 页后的拆分点',
    visualSplitCut: '在此页后拆分', visualSplitUndoCut: '移除此拆分点',
    visualSplitLast: '文档结束', visualSplitClear: '清除所有拆分点',
    visualSplitConfirmTitle: '替换手工输入的页码范围？',
    visualSplitConfirmText: '当前输入的范围可能只包含部分页、重复页或自定义顺序。可视化拆分会让全部页面按当前顺序恰好出现一次。确定替换已有范围吗？',
    visualSplitKeep: '保留原范围', visualSplitReplace: '用可视化拆分替换',
    byRanges: '按页码范围拆分', pageRanges: '页码范围', rangeHint: '例如：1-3, 4-5, 6。每个范围独立生成一个 PDF。', every: '每 N 页拆分一次', perFile: '每个 PDF 的页数', eachPagePreset: '每页生成一份 PDF', eachPageLimit: '如果选择“每页生成一份 PDF”，{pages} 页将分成 {batches} 批，每批最多 50 份 PDF。', splitBatchStatus: '第 {index}/{total} 批 · 当前导出页码 {start}–{end}', splitBatchPrevious: '上一批', splitBatchNext: '下一批', splitBatchWarning: '请逐批下载。当前批次有多份 PDF 时打包 ZIP；只生成一份 PDF 时直接下载。仅下载某一批不代表已保存整个工作台。', splitBatchEstimate: '本批将生成 {files} 份 PDF。', splitBatchDownload: '下载当前批次（ZIP）', splitBatchDownloaded: '已下载第 {index}/{total} 批。可点击“下一批”继续下载剩余页面。', splitFinalBatchDownloaded: '最后一批（第 {index}/{total} 批）已下载。之前各批是独立下载，请确认均已保存。', downloadZip: '下载拆分文件（ZIP）', downloadSingle: '下载 PDF', creating: '正在生成…',
    foot: '所有文档操作均在浏览器本地完成', footLimit: '保留的源文件数据最多 200 MiB · 暂不支持加密 PDF', bigDocWarning: '大文档提示：仅在滚动到页面时生成缩略图，但数百页仍可能消耗较多内存，导出也可能较慢。',
    emptyHistoryHint: '所有页面都已删除。可点击“撤销”恢复；如果添加新文件，将开始新工作台，并清除旧操作的撤销记录。',
    noFile: '请先添加 PDF 或图片。', selectionNeeded: '请先选择需要提取的页面。',
    loaded: '已添加 {files} 个文件，共 {pages} 页。', exported: '导出成功，原始文件没有被修改。',
    extracted: '已提取 {pages} 页。', zipped: '已将 {files} 个 PDF 打包为 ZIP。', splitSingleSaved: 'PDF 已下载，无需解压 ZIP。', cleared: '工作台已清空。',
    errorGeneric: '操作失败，请检查文件后重试。', errorFiles: '一次最多处理 {n} 个文件。', errorTypes: '请选择 PDF、JPG、PNG、WebP、BMP 或静态 AVIF 文件，不支持动态图像。', errorCombined: '当前工作台保留的 PDF 数据和原始图片超过 200 MiB 安全上限。请减少图片或文件，或使用更小的图片。', errorPages: '一次最多支持 {n} 页，请减少文件。', dismiss: '关闭提示',
    enterSplitRanges: '请填写要拆分的页码范围，例如 1-3, 4-6。', enterSplitSize: '请填写每份 PDF 包含多少页。',
    invalidRange: '请检查页码范围（最多 50 段）或每份页数。按每 N 页拆分超过 50 份时可分批下载。', estimate: '预计生成 {files} 个 PDF 文件。',
    splitCoverageComplete: '已完整包含当前全部 {total} 页，每页恰好一次。', splitCoverageOmitted: '当前 {total} 页中仅包含 {included} 页。遗漏 {count} 页：{pages}。下载前请核对页码范围。', splitCoverageRepeated: '有 {count} 页被重复放入不同文件：{pages}。请确认是否需要重复。', splitPreviewToggle: '查看预计生成的 {files} 份 PDF', splitPreviewPart: '第 {index} 份：第 {start}–{end} 页（共 {count} 页）',
  },
};

export function interpolate(template, params = {}) {
  return template.replace(/\{([a-z]+)\}/g, (_, key) => String(params[key] ?? ''));
}

export function translateProcessingError(message, locale = 'en') {
  if (locale !== 'zh') return message;
  const error = String(message);
  if (/Animated (AVIF|WebP|PNG) is not supported/i.test(error)) return '不支持动态 PNG、WebP 或 AVIF。请使用静态图片，避免只导出动画的第一帧。';
  if (/This AVIF could not be decoded/i.test(error)) return '当前浏览器无法解码此 AVIF 图片。请确认文件有效，或先转换为 PNG、WebP 后重试。';
  if (/JPEG metadata could not be safely removed/i.test(error)) return 'JPEG 元数据结构异常，无法安全移除隐藏信息。请换一张图片或先导出为不含元数据的新图片。';
  if (/Split cancelled/i.test(error)) return '已取消拆分，没有下载未完成的 ZIP。';
  if (/PDF export cancelled/i.test(error)) return '已取消 PDF 导出，没有下载未完成的文件。';
  if (/Photo layout update cancelled/i.test(error)) return '已取消照片排版，原有页面保持不变。';
  if (/Split PDF outputs exceed the 128 MB/i.test(error)) return '拆分输出累计超过 128 MB 安全上限，请减少或调整拆分范围。';
  if (/enter watermark text|watermark text must|watermarks require|canvas is unavailable for watermark|could not create the watermark image|invalid PDF page dimensions for watermark/i.test(error)) return '请填写有效的水印文字，或关闭水印功能。';
  if (/50 output|50 ranges|maximum of 50/i.test(error)) return '一次最多生成 50 个 PDF 或使用 50 段页码范围，请减少输出文件数。';
  if (/reversed|outside pages|invalid page range|range such as|range is supported|pages.per.file|no pages to split/i.test(error)) return workspaceCopy.zh.invalidRange;
  if (/password.protected|encrypted/i.test(error)) return '暂不支持带密码保护的 PDF，请先使用已授权方式解锁。';
  if (/could not be opened|as a PDF|corrupt/i.test(error)) return '文件无法作为 PDF 打开，请检查文件是否损坏。';
  if (/100 MB|between 1 byte/i.test(error)) return '单个文件大小必须在 1 字节至 100 MB 之间。';
  if (/image dimensions|too large/i.test(error)) return '图片尺寸过大，请缩小后重试。';

  // Errors already authored in Chinese (including exact limits such as 20 files,
  // 200 MB, 600 pages) should never be replaced with a generic failure.
  if (/[\u3400-\u9fff]/.test(error)) return error;
  return workspaceCopy.zh.errorGeneric;
}
