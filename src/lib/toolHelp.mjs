// Practical, visible help for users and crawlers. Not FAQPage rich-result spam.
// Do not imply OCR, lossless compression, editable PDF text, or cryptographic signatures.
export const toolHelp = {
  en: {
    workspace: [
      ['Can I open a book with hundreds of pages?', 'Yes. The visual workspace accepts up to 600 pages and 200 MiB across files. Thumbnails load as you scroll. Large documents still need substantial device memory.'],
      ['Does the workspace change my original files?', 'No. Rotate, delete and reorder your copies in the browser, then download a new PDF. Your source documents stay untouched.'],
    ],
    'merge-pdf': [
      ['Can I interleave pages from different PDFs?', 'Yes. Add your PDFs, then drag individual pages between documents before exporting a single PDF.'],
      ['Will merging upload private documents?', 'No. Files are processed locally in the browser and are not sent to a PDF conversion server.'],
    ],
    'split-pdf': [
      ['Can I split a PDF into custom page ranges?', 'Yes. Enter ranges such as 1-3, 4-6, or choose a fixed number of pages per output file.'],
      ['How are the split files downloaded?', 'The tool downloads the selected sections together as a ZIP. To avoid excessive output files, it supports up to 50 ranges or parts per operation.'],
    ],
    'organize-pdf': [
      ['How do I move several pages together?', 'Select pages using their checkboxes, then drag the selection to its new position. Keyboard-accessible move controls are also provided.'],
      ['Can I undo an accidental move?', 'Yes. Undo and redo are available before export. Reloading the page clears the current editing session.'],
    ],
    'rotate-pdf': [
      ['Can I rotate only the pages scanned sideways?', 'Yes. Select the affected pages, rotate them by 90 degrees, and export a corrected PDF. Other pages retain their original orientation.'],
      ['Does rotating reduce image resolution?', 'Page rotation changes the PDF page orientation without intentionally converting its content to images. Always check important exports.'],
    ],
    'extract-pages': [
      ['Can I take selected pages out of a long document?', 'Yes. Select the desired pages in the workspace and download a separate PDF containing only that selection.'],
      ['Do extracted pages keep their order?', 'Yes. They follow the order shown in the current workspace. You can reorder pages before extracting them.'],
    ],
    'delete-pages': [
      ['Are removed pages deleted from my original PDF?', 'No. Removal affects the current browser workspace only. The downloaded PDF contains the pages you kept.'],
      ['Can I restore a deleted page?', 'Use Undo before downloading, or clear the workspace and open the original PDF again.'],
    ],
    'watermark-pdf': [
      ['Does PlainMile insert its own watermark?', 'No. Watermarking is off by default. You must enable the option and type the text yourself.'],
      ['Can I add Chinese text as a watermark?', 'Yes. Custom Chinese and English text is rendered locally onto exported PDF pages.'],
    ],
    'pdf-to-images': [
      ['Can I export pages 301 to 360 from a book?', 'Yes. Open a PDF of up to 1,000 pages and choose a page range. You can export up to 60 images per batch.'],
      ['Does PNG or JPG keep selectable text?', 'No. PNG and JPG are images of the rendered pages, so their text cannot be selected as PDF text.'],
    ],
    'compress-pdf': [
      ['Will compressed pages still contain selectable text?', 'No. This tool re-renders pages as JPEG images; searchable text, clickable links, forms and signatures may be lost. Keep your original PDF.'],
      ['What if the new file is larger?', 'The tool measures the actual sizes and will not offer a larger result as an improvement. Image-based compression is limited to 120 pages per run.'],
    ],
    'pdf-to-txt': [
      ['Can I extract text from a 500-page book?', 'Yes, for PDFs containing selectable text, subject to a 100 MiB and 1,000-page limit and your device memory.'],
      ['Will this read a scanned PDF?', 'Not if it contains only page images. This tool does not perform OCR, and multi-column reading order may need manual corrections.'],
    ],
    'pdf-to-markdown': [
      ['Will headings be reproduced exactly?', 'No. Heading levels are inferred from text sizes. Tables, images and complex layouts may not transfer reliably.'],
      ['Can I convert a scanned textbook?', 'Only text already embedded in a PDF is extracted. Scanned pages without a text layer need OCR from a separate tool.'],
    ],
    'txt-to-pdf': [
      ['Can I turn a book-length TXT file into PDF?', 'You can import up to 5 MiB of UTF-8 text. Output is limited to 1,000 text pages, or 300 image-based pages for non-Latin scripts.'],
      ['Will Chinese text be searchable in the output?', 'Currently, Chinese characters are rendered using your browser fonts as image-based PDF pages, so they are not searchable or selectable.'],
    ],
    'markdown-to-pdf': [
      ['What Markdown is supported?', 'Basic headings, paragraphs, lists, block quotes and code blocks. Remote images, HTML and complex tables are not rendered.'],
      ['Is this a full Word-style layout engine?', 'No. It is a lightweight browser-only converter. Review the downloaded layout, especially for long documents and Chinese text.'],
    ],
    'add-page-numbers': [
      ['Can I number a 320-page PDF starting at 201?', 'Yes. Set 201 as the starting number; the first page displays 201 and page 320 displays 520.'],
      ['Can I move page numbers to the top?', 'Yes. Choose a supported position and font size before downloading the new PDF.'],
    ],
    'image-to-pdf': [
      ['Can I combine JPG, PNG and WebP images?', 'Yes. Add images together and reorder them; you can also mix them with existing PDF pages in the visual workspace.'],
      ['Will the images be stretched?', 'Images are fitted within an A4 portrait page without intentionally changing their aspect ratio.'],
    ],
  },
  zh: {
    workspace: [
      ['能处理几百页的书吗？', '可以。可视化工作台最多支持 600 页、文件总计 200 MiB。缩略图随滚动按需加载，但大文档仍会占用较多设备内存。'],
      ['会修改原始 PDF 吗？', '不会。旋转、删除和调整顺序只影响浏览器中的工作副本；导出时会生成新的 PDF。'],
    ],
    'merge-pdf': [
      ['可以将不同 PDF 中的页面交叉合并吗？', '可以。先添加多个 PDF，再拖动每一页到需要的位置，最后导出一个 PDF。'],
      ['合并时会上传合同等隐私文件吗？', '不会。文件直接在您的浏览器中处理，不上传到转换服务器。'],
    ],
    'split-pdf': [
      ['可以按自定义范围拆分吗？', '可以。输入 1-3、4-6 这样的页码范围，或者指定每份文件包含几页。'],
      ['拆分结果怎么保存？', '输出会打包成 ZIP 下载。为防止一次创建过多文件，单次最多支持 50 个范围或拆分结果。'],
    ],
    'organize-pdf': [
      ['如何一次移动多页？', '通过复选框选择多页，再拖动整组页面。也支持使用移动按钮调整顺序。'],
      ['移动错了可以撤销吗？', '可以。导出前可以撤销和重做。刷新页面则会清空当前编辑会话。'],
    ],
    'rotate-pdf': [
      ['可以只旋转部分倒置的扫描页吗？', '可以。选择需要修正的页面，以 90° 为单位旋转，其他页面不变。'],
      ['旋转会降低清晰度吗？', '旋转修改的是 PDF 页面的方向，并不会刻意将页面图片化。重要文档仍建议检查导出结果。'],
    ],
    'extract-pages': [
      ['如何从一本长 PDF 中抽出指定页？', '在工作台中勾选需要的页面，再选择提取，下载仅包含所选页面的新 PDF。'],
      ['提取出的页面顺序如何确定？', '按照工作台当前显示的顺序导出。您也可以先拖动页面，再进行提取。'],
    ],
    'delete-pages': [
      ['删除页面会影响原始 PDF 吗？', '不会。删除只发生在浏览器的编辑副本中，下载后才会得到去除指定页面的新文件。'],
      ['误删之后怎么恢复？', '导出前可以撤销；也可以清空工作台，重新打开原始文件。'],
    ],
    'watermark-pdf': [
      ['是否会自动添加 PlainMile 水印？', '不会。水印功能默认关闭，只有您主动开启并填写内容后才会加入水印。'],
      ['支持中文水印吗？', '支持。中英文自定义文字会在浏览器本地绘制到导出的 PDF 页面。'],
    ],
    'pdf-to-images': [
      ['可以把一本书的第 301 至 360 页导出为图片吗？', '可以。支持打开最多 1000 页的 PDF，每次选择并导出最多 60 页图片。'],
      ['转换成 PNG 或 JPG 后还能复制文字吗？', '不能。PNG 和 JPG 是页面的图片，不包含原 PDF 的可选择文字。'],
    ],
    'compress-pdf': [
      ['压缩后的 PDF 还能搜索和复制文字吗？', '不能保证。当前压缩会将页面重新渲染为 JPEG 图片，可能丢失可搜索文本、链接、表单和签名。请保留原文件。'],
      ['如果压缩后的 PDF 反而更大呢？', '工具会真实比较文件大小，不会把变大的结果当作压缩成功。当前图片化压缩每次最多支持 120 页。'],
    ],
    'pdf-to-txt': [
      ['可以提取 500 页电子书的文字吗？', '可以，但 PDF 必须有可选择的文字层，且文件不超过 100 MiB、页数不超过 1000 页，实际还受设备内存限制。'],
      ['扫描版电子书可以直接提取吗？', '没有文字层的图片型扫描件不能提取文字。当前不包含 OCR，多栏排版的顺序也可能需要检查。'],
    ],
    'pdf-to-markdown': [
      ['Markdown 标题和表格能保持原样吗？', '不能保证。标题依据文字大小推测；图片、表格和复杂排版不一定能正确还原。'],
      ['扫描版教材能转换吗？', '只能提取 PDF 中已有的文字层。没有文字层的扫描件需要先进行 OCR。'],
    ],
    'txt-to-pdf': [
      ['可以将长篇 TXT 电子书转换成 PDF 吗？', '文本文件最多 5 MiB。纯拉丁文字输出最多 1000 页，中文等图片化内容最多 300 页。'],
      ['中文转换后的 PDF 能搜索吗？', '目前中文文字通过浏览器字体绘制为图片页面，因此不能直接搜索或选择其中的文字。'],
    ],
    'markdown-to-pdf': [
      ['支持哪些 Markdown 语法？', '支持基本标题、段落、列表、引用及代码块；暂不渲染远程图片、HTML 和复杂表格。'],
      ['可以完全替代 Word 排版吗？', '不能。这是轻量级本地转换工具，较长内容或中文文档导出后应检查分页与排版。'],
    ],
    'add-page-numbers': [
      ['320 页 PDF 能从第 201 页开始编号吗？', '可以。设置起始页码 201，第一页显示 201，最后一页显示 520。'],
      ['页码可以放在页面顶部吗？', '可以。可选择提供的页码位置和字号，然后下载新 PDF。'],
    ],
    'image-to-pdf': [
      ['JPG、PNG、WebP 能混合生成 PDF 吗？', '可以。选择多张图片，调整顺序，也可以与已有 PDF 页面放在同一个工作台中。'],
      ['图片会被强行拉伸吗？', '不会故意改变图片比例，图片会按比例放入 A4 竖向页面中。'],
    ],
  },
};
export const toolHelpFor = (slug, locale = 'en') => toolHelp[locale]?.[slug] ?? [];
