// Categories are deliberately small and task-oriented; every real tool appears exactly once.
// Render all links in Astro HTML so search engines can crawl them without JavaScript.
export const toolGroups = [
  { id: 'organize', en: 'Organize pages', zh: '整理 PDF', glyph: '▤',
    slugs: ['workspace', 'merge-pdf', 'split-pdf', 'organize-pdf', 'rotate-pdf', 'extract-pages', 'delete-pages'] },
  { id: 'from-pdf', en: 'Convert from PDF', zh: '从 PDF 转换',
    slugs: ['pdf-to-images', 'pdf-to-txt', 'pdf-to-markdown'] },
  { id: 'to-pdf', en: 'Convert to PDF', zh: '转换为 PDF',
    slugs: ['image-to-pdf', 'txt-to-pdf', 'markdown-to-pdf'] },
  { id: 'improve', en: 'Adjust and optimize', zh: '调整和优化 PDF',
    slugs: ['compress-pdf', 'watermark-pdf', 'add-page-numbers'] },
];

/**
 * On-site finder synonyms for tasks the existing pages actually support.
 * Search hints are UI-only; never create thin alias routes or duplicate SEO
 * landing pages for "JPG to PDF" versus the canonical Images to PDF tool.
 */
export const toolSearchAliases = Object.freeze({
  'workspace': ['edit pdf pages', 'pdf page editor', '编辑pdf页面'],
  'merge-pdf': ['combine pdf', 'join pdf', '合并pdf', 'pdf合并'],
  'split-pdf': ['separate pdf', 'split pdf pages', 'split pdf to individual pages', '拆分pdf', 'pdf拆分'], 
  'organize-pdf': ['rearrange pdf', 'reorder pdf', 'pdf排序'],
  'rotate-pdf': ['rotate pdf pages', 'pdf旋转'],
  'extract-pages': ['extract pdf pages', 'pdf提取页面', '提取pdf页面', '提取部分页'], 
  'delete-pages': ['remove pdf pages', 'pdf删除页面', '删除pdf页面'],
  'watermark-pdf': ['pdf watermark', 'pdf加水印', 'pdf水印', '添加pdf水印'],
  'pdf-to-images': ['pdf to jpg', 'pdf to jpeg', 'pdf to png', 'pdf to image', 'pdf to images', 'save pdf as png', 'save pdf as jpg', 'pdf转jpg', 'pdf转jpeg', 'pdf转png', 'pdf转图片'], 
  'compress-pdf': ['reduce pdf size', 'make pdf smaller', 'shrink pdf', '压缩pdf', 'pdf压缩', 'pdf压小', 'pdf变小'], 
  'pdf-to-txt': ['pdf to text', 'pdf to txt', 'pdf转txt', 'pdf转文字'],
  'pdf-to-markdown': ['pdf to md', 'pdf to markdown', 'pdf转md'],
  'txt-to-pdf': ['text to pdf', 'txt to pdf', 'txt转pdf'],
  'markdown-to-pdf': ['md to pdf', 'markdown to pdf', 'md转pdf'],
  'add-page-numbers': ['number pdf pages', 'page numbers', 'pdf页码', '添加页码', 'pdf加页码'],
  'image-to-pdf': ['jpg to pdf', 'jpeg to pdf', 'png to pdf', 'webp to pdf', 'bmp to pdf', 'avif to pdf', 'image to pdf', 'photo to pdf', 'photos to pdf', '图片转pdf', '照片转pdf', 'jpg转pdf', 'png转pdf'], 
});

export const featuredToolSlugs = ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-images'];
export const toolSymbols = {
  workspace: '▦', 'merge-pdf': '⇄', 'split-pdf': '↗',
  'organize-pdf': '☷', 'rotate-pdf': '↻', 'extract-pages': '⇧',
  'delete-pages': '×', 'pdf-to-images': '▧', 'pdf-to-txt': 'T',
  'pdf-to-markdown': 'M↓', 'image-to-pdf': '▣', 'txt-to-pdf': 'T↓',
  'markdown-to-pdf': 'M↑', 'compress-pdf': '⇥',
  'watermark-pdf': 'W', 'add-page-numbers': '#',
};

// Conversion pairs and the two ways to extract/split are intentional next
// steps, not generic keyword links. Keep them visible in prerendered HTML.
const companionTools = Object.freeze({
  'pdf-to-images': 'image-to-pdf',
  'image-to-pdf': 'pdf-to-images',
  'pdf-to-txt': 'txt-to-pdf',
  'txt-to-pdf': 'pdf-to-txt',
  'pdf-to-markdown': 'markdown-to-pdf',
  'markdown-to-pdf': 'pdf-to-markdown',
  'split-pdf': 'extract-pages',
  'extract-pages': 'split-pdf',
  // Compression refuses >120-page inputs: splitting is the useful recovery step.
  'compress-pdf': 'split-pdf',
});

export function relatedToolSlugs(slug) {
  const matchingGroup = toolGroups.find(group => group.slugs.includes(slug));
  const groupNeighbors = matchingGroup ? matchingGroup.slugs.filter(candidate => candidate !== slug) : [];
  const mainTasks = ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-images', 'workspace'];
  const companion = companionTools[slug] ? [companionTools[slug]] : [];
  return [...new Set([...companion, ...groupNeighbors, ...mainTasks])]
    .filter(candidate => candidate !== slug).slice(0, 5);
}
