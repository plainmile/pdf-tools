import { chineseTools } from './i18n.mjs';
export const tools = [
  {
    slug: 'workspace', title: 'PDF Workspace', short: 'One place for every page',
    headline: 'Your documents, exactly how you want them.',
    description: 'Rearrange pages from multiple PDFs, rotate, remove, extract and export. All processing happens locally in your browser.',
    details: 'Drop several PDF files or images, see every page as a thumbnail, and assemble a fresh PDF by dragging pages into the right order.',
    steps: ['Choose PDFs or images', 'Drag pages into a new order', 'Export your finished PDF'],
  },
  {
    slug: 'merge-pdf', title: 'Merge PDF', short: 'Combine many into one',
    headline: 'Merge PDFs in the order you choose.',
    description: 'Combine multiple PDF files into one. Preview and reorder any individual page before you export. Files never leave your browser.',
    details: 'Unlike simple file-level merging, you can interleave individual pages from different documents, remove unwanted pages and rotate sideways scans.',
    steps: ['Add two or more PDFs', 'Arrange files and individual pages', 'Export one combined PDF'],
  },
  {
    slug: 'split-pdf', title: 'Split PDF', short: 'Separate into smaller files',
    headline: 'Split a PDF into just the sections you need.',
    description: 'Split a PDF by page ranges or every N pages. Download the results together as a ZIP file without uploading your documents.',
    details: 'Enter ranges such as 1-3, 4-6 or choose a fixed number of pages for each file. Splitting follows the current page order.',
    steps: ['Add your PDF', 'Enter page ranges or pages per file', 'Download the ZIP'],
  },
  {
    slug: 'organize-pdf', title: 'Organize PDF', short: 'Reorder by thumbnail',
    headline: 'Move any PDF page where it belongs.',
    description: 'Visually reorder PDF pages by dragging thumbnails or using move buttons. Undo and redo changes before saving.',
    details: 'Move pages across files; rotate or delete them with a clear visual overview. Keyboard-accessible move controls are included.',
    steps: ['Add documents', 'Rearrange pages by thumbnail', 'Export with your preferred order'],
  },
  {
    slug: 'rotate-pdf', title: 'Rotate PDF', short: 'Fix sideways pages',
    headline: 'Fix sideways scans in seconds.',
    description: 'Rotate one page or a selection of PDF pages in 90-degree steps, then export a corrected PDF locally.',
    details: 'Pick the sideways pages, rotate them clockwise or counter-clockwise and save the new document without modifying your originals.',
    steps: ['Add a PDF', 'Select the pages to rotate', 'Export the corrected PDF'],
  },
  {
    slug: 'extract-pages', title: 'Extract PDF Pages', short: 'Keep only what matters',
    headline: 'Save selected pages as their own PDF.',
    description: 'Pick individual pages from one or more PDFs and export only that selection, preserving your chosen order.',
    details: 'Checkbox selection makes it easy to assemble a lightweight excerpt from reports, contracts or supporting documents.',
    steps: ['Add your documents', 'Select the pages you want', 'Export selected pages'],
  },
  {
    slug: 'delete-pages', title: 'Delete PDF Pages', short: 'Remove unwanted pages',
    headline: 'Remove the pages you do not need.',
    description: 'Delete unwanted PDF pages with a visual preview. Undo deletion until you export. No document upload is required.',
    details: 'Select one or many pages, remove them, check the revised order and save a new file. Your source PDF stays untouched.',
    steps: ['Open your PDF', 'Select and delete unnecessary pages', 'Export the cleaned PDF'],
  },
  {
    slug: 'watermark-pdf', title: 'Add PDF Watermark', short: 'Optional custom text',
    headline: 'Add a watermark only when you want one.',
    description: 'Add your own light diagonal text watermark to a PDF. Watermarking is off by default, and your files stay in the browser.',
    details: 'Open Export options, turn on Add text watermark and enter your text. Without opting in, files export without any watermark.',
    steps: ['Add a PDF', 'Enable text watermark under Export options', 'Export the marked PDF'],
  },
  {
    slug: 'image-to-pdf', title: 'Images to PDF', short: 'JPG, PNG and WebP',
    headline: 'Turn your images into a tidy PDF.',
    description: 'Convert JPG, PNG and WebP images into PDF pages, reorder them and combine with existing PDF files if needed.',
    details: 'Images are fitted inside A4 portrait pages without stretching. Reorder image pages or mix them with PDF pages before export.',
    steps: ['Choose JPG, PNG or WebP files', 'Reorder or combine pages', 'Export as PDF'],
  },
];

export const getTool = (tool, locale = 'en') => locale === 'zh' ? { ...tool, ...chineseTools[tool.slug] } : tool;
