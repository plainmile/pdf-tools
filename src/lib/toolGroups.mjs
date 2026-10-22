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
export const featuredToolSlugs = ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-images'];
export const toolSymbols = {
  workspace: '▦', 'merge-pdf': '⇄', 'split-pdf': '↗',
  'organize-pdf': '☷', 'rotate-pdf': '↻', 'extract-pages': '⇧',
  'delete-pages': '×', 'pdf-to-images': '▧', 'pdf-to-txt': 'T',
  'pdf-to-markdown': 'M↓', 'image-to-pdf': '▣', 'txt-to-pdf': 'T↓',
  'markdown-to-pdf': 'M↑', 'compress-pdf': '⇥',
  'watermark-pdf': 'W', 'add-page-numbers': '#',
};

export function relatedToolSlugs(slug) {
  const matchingGroup = toolGroups.find(group => group.slugs.includes(slug));
  const groupNeighbors = matchingGroup ? matchingGroup.slugs.filter(candidate => candidate !== slug) : [];
  const mainTasks = ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-images', 'workspace'];
  return [...new Set([...groupNeighbors, ...mainTasks])].filter(candidate => candidate !== slug).slice(0, 5);
}
