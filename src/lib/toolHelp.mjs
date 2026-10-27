// Practical, visible help for users and crawlers. Not FAQPage rich-result spam.
// Do not imply OCR, bitwise-lossless compression, editable PDF text, or intact digital signatures.
export const toolHelp = {
  en: {
    workspace: [
      ['Can I open a book with hundreds of pages?', 'Yes. The visual workspace accepts up to 600 pages and 200 MiB across files. Thumbnails load as you scroll. Large documents still need substantial device memory.'],
      ['Does the workspace change my original files?', 'No. Rotate, delete and reorder your copies in the browser, then download a new PDF. Your source documents stay untouched.'],
      ['Can I duplicate pages or add a blank separator?', 'Yes. Select pages and choose Duplicate selected to copy each right after its original. Insert blank page after one selected page, or at the end when none is selected. Each blank matches the adjacent page size.'],
      ['What happens if I type an invalid page selection?', 'The workspace marks reversed, out-of-bounds or too many page ranges before you apply them, and disables Select pages. Your previously selected pages are not changed; fix the input and apply it to update the selection.'],
      ['What happens if I switch tools while a file is still loading or exporting?', 'The workspace warns before leaving during an active import or PDF export. You can continue processing, cancel first, or deliberately leave. An incomplete PDF is never downloaded.'],
      ['Can I leave after only viewing an unchanged PDF?', 'Yes. Opening one original PDF without changes does not create unsaved work, so you can switch tools freely. If you select pages, enter ranges, combine documents or edit a page, export your work before leaving or switching languages.'],
    ],
    'merge-pdf': [
      ['Can I interleave pages from different PDFs?', 'Yes. Add your PDFs, then drag individual pages between documents before exporting a single PDF.'],
      ['Will merging upload private documents?', 'No. Files are processed locally in the browser and are not sent to a PDF conversion server.'],
    ],
    'split-pdf': [
      ['Can I split a PDF into custom page ranges?', 'Yes. Enter ranges such as 1-3, 4-6; the default download creates a separate PDF per range. Type 15- to include page 15 through the final page (not -15). On this same split page, choose Download ranges as one PDF to combine the entered ranges in order without opening another tool. Invalid and reversed ranges disable both downloads.'],
      ['Can overlapping ranges be combined without duplicated pages?', 'Yes. Separate split outputs may intentionally repeat pages between files. The single combined-PDF download follows the entered range order but keeps repeated or overlapping pages only at their first occurrence. Your source pages and checkbox selections are unchanged.'],
      ['Can I split odd and even pages into two PDFs?', 'Yes. Choose Split into odd-page and even-page PDFs to get two PDFs in one ZIP. Odd and even refer to the current export page order, not the original scanned page numbers.'],
      ['Can I split a PDF by chapters or subchapters?', 'Yes. For one PDF in its complete original page order, choose bookmark level 1, 2 or 3 and preview the exact chapter boundaries before applying. Up to 50 output PDFs are supported; missing levels or invalid destinations do not invent chapters. You can optionally add sanitized chapter titles to ZIP filenames, but this is off by default. Exported PDFs do not retain the original clickable bookmarks.'],
      ['Can I choose split points by looking at the pages?', 'Yes. Expand Choose split points by clicking pages, then click Cut after this page under a preview. Click again to remove a cut. It uses your current page order; manually entered custom ranges are protected from accidental replacement.'],
      ['How are the split files downloaded?', 'A single result downloads as PDF; multiple results download as ZIP. When splitting every N pages would create over 50 PDFs, use the Next batch and Previous batch buttons. Each download contains up to 50 PDFs.'],
      ['How do I split a 200-page book into one PDF per page?', 'Choose One PDF per page. Download each 50-page ZIP batch, then use Next batch. Each batch is a separate download with the current output page range in its filename.'],
      ['Can I see progress and cancel a long PDF split?', 'Yes. The progress bar counts output pages copied across the PDFs in the current download, even if a custom range repeats pages. ZIP packaging is displayed separately. Cancel split stops the job without downloading an incomplete result.'],
    ],
    'organize-pdf': [
      ['How do I move several pages together?', 'Select pages using their checkboxes, then drag the selection to its new position. Keyboard-accessible move controls are also provided.'],
      ['Can I undo an accidental move?', 'Yes. Undo and redo are available before export. Reloading the page clears the current editing session.'],
      ['Where will duplicate or blank pages go?', 'Selected pages are duplicated immediately after each original. A blank page is inserted after one selected page; with nothing selected, it is appended at the end. The 600-page workspace limit still applies.'],
    ],
    'rotate-pdf': [
      ['Can I rotate only the pages scanned sideways?', 'Yes. Select the affected pages, rotate them by 90 degrees, and export a corrected PDF. Other pages retain their original orientation.'],
      ['Does rotating reduce image resolution?', 'Page rotation changes the PDF page orientation without intentionally converting its content to images. Always check important exports.'],
    ],
    'extract-pages': [
      ['Can I take selected pages out of a long document?', 'Yes. Tick thumbnails to extract in workspace order, or enter ranges such as 3, 1-2 and choose Export ranges as one PDF to combine them in the typed order. For all remaining pages, enter 15- to select page 15 through the final output page.'],
      ['Do extracted pages keep their order?', 'Checkbox extraction follows the current workspace order. Direct range export follows the order you type and ignores repeated/overlapping page numbers after their first occurrence. Invalid or reversed ranges are flagged before download and cannot be exported. Neither changes the original PDF.'],
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
      ['Can I export pages 301 to 360 from a book?', 'Yes. Open a PDF of up to 1,000 pages and choose a page range. Type 301- for page 301 through the end, provided it selects no more than 60 pages; larger selections require smaller batches. You can export up to 60 images per batch. Invalid, reversed and oversized selections are shown before conversion rather than starting an unusable export.'],
      ['Does PNG or JPG keep selectable text?', 'No. PNG and JPG are images of the rendered pages, so their text cannot be selected as PDF text.'],
      ['Do repeated or overlapping page ranges export a page twice?', 'No. Each PDF page is rendered once in the order it first appears in your selection. The ZIP name reflects the pages actually exported; non-ascending output files use order-number prefixes.'],
      ['What happens if I leave while pages are converting?', 'The browser asks for confirmation when a PDF is loading or image conversion is running. Stay to finish the batch or cancel first; leaving discards unfinished work without downloading incomplete images.'],
      ['Does this extract the original photos embedded inside a PDF?', 'No. This converts whole PDF pages into new JPG or PNG images, including any text or graphics on those pages. It does not separately extract embedded photos or preserve their original image data.'],
    ],
    'compress-pdf': [
      ['Will PDF compression keep my text searchable?', 'By default, yes: document optimization rewrites PDF object streams without converting pages into images. Choose JPEG page compression only if you accept that searchable text, links and forms will be lost. Both methods rewrite the file and invalidate digital signatures. Keep the original and check important output.'],
      ['What if the new file is larger?', 'Both methods measure the actual original and result sizes. A larger or equal-size result is not downloadable. The page limit remains 120 per run and some PDFs cannot be reduced further.'],
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
      ['Can I turn a book-length TXT file into PDF?', 'You can import up to 5 MiB of UTF-8 or BOM-marked UTF-16 text. Output is limited to 1,000 total pages, including at most 300 image-based pages requiring unsupported glyphs.'],
      ['Will Chinese text be searchable in the output?', 'Pages with Chinese or other unsupported characters are rendered as images, so those pages are not searchable. Pages containing only supported characters remain selectable, even in the same document.'],
    ],
    'markdown-to-pdf': [
      ['What Markdown is supported?', 'Basic headings, paragraphs, lists, block quotes and code blocks. Remote images, HTML and complex tables are not rendered.'],
      ['Which text-file encodings are supported?', 'Import UTF-8 or BOM-marked UTF-16 LE/BE. Invalid encoding is rejected rather than silently corrupting the generated PDF.'],
      ['Is this a full Word-style layout engine?', 'No. It is a lightweight browser-only converter. Review the downloaded layout, especially for long documents and Chinese text.'],
    ],
    'add-page-numbers': [
      ['Can I number a 320-page PDF starting at 201?', 'Yes. Set 201 as the starting number; the first page displays 201 and page 320 displays 520.'],
      ['How can I avoid numbering beyond the last page?', 'Choose the PDF page where numbering begins and the first printed number. The tool checks those settings before conversion, including whether the final printed page number would exceed 99999. Earlier cover pages stay unnumbered.'],
      ['Can I position page numbers at any corner?', 'Yes. Choose a top or bottom left, center or right position and one of three spacing presets. The original PDF page size is not changed.'],
      ['Can I check a page in the middle of a long PDF?', 'Yes. After generating the PDF, preview the first numbered page, last page or any PDF page number, including an unnumbered cover. Previewing does not alter the output or download it.'],
      ['Will a wide inset clip the page number?', 'No. The tool checks each page’s visible dimensions, even on rotated or cropped PDFs. If a number cannot fit, conversion stops and any earlier generated result remains available.'],
    ],
    'image-to-pdf': [
      ['Can I combine JPG, PNG, WebP, BMP and AVIF images?', 'Yes. JPG and BMP can be combined with static PNG, WebP and AVIF if your browser decodes them. Animated PNG (APNG), WebP and AVIF are rejected rather than silently dropping frames. You can reorder images or mix them with PDF pages.'],
      ['Can I use Letter, landscape or no margins?', 'Yes. Choose A4, US Letter or fit-to-image paper, portrait/landscape/automatic orientation and 0, 12, 30 or 48 pt margins. Changes made after import must be applied before exporting.'],
      ['Will the images be stretched?', 'Images are fitted within the selected page and preserve their original proportions.'],
      ['Will my phone photo location be included?', 'For imported JPGs, common EXIF, XMP, IPTC and comment metadata is removed before PDF embedding. GPS may be in those fields. This is not a general metadata-removal tool for existing PDFs.'],
    ],
  },
  zh: {
    workspace: [
      ['能处理几百页的书吗？', '可以。可视化工作台最多支持 600 页、文件总计 200 MiB。缩略图随滚动按需加载，但大文档仍会占用较多设备内存。'],
      ['会修改原始 PDF 吗？', '不会。旋转、删除和调整顺序只影响浏览器中的工作副本；导出时会生成新的 PDF。'],
      ['能复制选中的页面或插入空白分隔页吗？', '可以。复制的页面紧跟原页面，插入空白页时，选择一页则插在其后，不选择则追加到末尾；空白页使用相邻页的尺寸。'],
      ['输入了错误的选择页码会怎样？', '工作台会在应用前标记反向、越界或超过 50 段的页码范围，并禁用「选择页面」。之前已经选中的页面不会改变；修正输入后再应用即可。'],
      ['文件正在导入或导出时切换工具会怎样？', '当前仍在读取或导出 PDF 时会先询问是否离开。可以继续处理、先取消操作，或者明确选择离开；不会下载未完成的 PDF。'],
      ['只打开 PDF 看看，切换工具会丢失原文件吗？', '不会。只打开一份未修改的原始 PDF 并预览，可以直接切换工具，原文件仍在您的设备上。但如果选中了页面、输入了拆分范围、合并多个文件或编辑了页面，请先导出结果再离开或切换语言。'],
    ],
    'merge-pdf': [
      ['可以将不同 PDF 中的页面交叉合并吗？', '可以。先添加多个 PDF，再拖动每一页到需要的位置，最后导出一个 PDF。'],
      ['合并时会上传合同等隐私文件吗？', '不会。文件直接在您的浏览器中处理，不上传到转换服务器。'],
    ],
    'split-pdf': [
      ['可以按自定义范围拆分吗？', '可以。输入 1-3、4-6，默认每段生成一份 PDF；输入 15- 表示直到最后一页（不支持 -15）。若想合并成一份 PDF，可直接在此拆分页选择「将这些范围合并为一份 PDF」，不需要切换工具或重新导入。反向、越界或过多范围会禁用两种下载。'],
      ['范围重叠时，合并 PDF 会重复页面吗？', '不会。独立拆分会保留不同文件中的重复页；合并成一份 PDF 时则按输入顺序处理，重复或重叠页只保留首次出现。原始页序和勾选状态不会改变。'],
      ['能把奇数页、偶数页分别保存吗？', '可以。选择「按奇偶页分别生成 PDF」，会把当前页序的奇数位、偶数位页面分别生成两份 PDF，并打包为一个 ZIP；不是依据原文件印刷页码。'],
      ['能按 PDF 的章节和子章节书签拆分吗？', '可以，前提是单份 PDF 保留了完整原始页序并且带有内置书签。选择第 1、2 或 3 级书签，先预览并确认；不存在的层级不会虚构拆分点，单次最多 50 份。ZIP 文件名可主动选择使用经过清理的章节标题，默认关闭。导出的 PDF 不保留原书签导航，也不能通过扫描文字识别章节。'],
      ['可以看着页面缩略图选择拆分位置吗？', '可以。展开「按页面预览设置拆分点」，在缩略图下选择「在此页后拆分」，再次点击可取消。拆分按当前页面顺序进行；手工指定的特殊范围不会被意外覆盖。'],
      ['拆分结果怎么保存？', '单份结果直接下载 PDF，多份打包 ZIP。按每 N 页拆分超过 50 份时，可以点击“下一批”逐批下载，每批最多 50 份 PDF。自定义范围仍限制 50 份。'],
      ['一本 200 页的书怎样逐页拆成独立 PDF？', '点击“每页生成一份 PDF”，先下载前 50 页组成的 ZIP，再点击“下一批”逐批下载；每批的页码范围会写入 ZIP 文件名。'],
      ['拆分几百页 PDF 时能看到进度或取消吗？', '可以。进度条按本次下载实际复制的输出页数累计，重复范围按实际输出次数计数，ZIP 打包另行显示。点击「取消拆分」可中止，不会下载不完整的文件。'],
    ],
    'organize-pdf': [
      ['如何一次移动多页？', '通过复选框选择多页，再拖动整组页面。也支持使用移动按钮调整顺序。'],
      ['移动错了可以撤销吗？', '可以。导出前可以撤销和重做。刷新页面则会清空当前编辑会话。'],
      ['复制页和空白页会放在哪里？', '复制的每一页紧跟在其原页面之后。空白页插在唯一选中页面之后；若没有选中页，则放在文档最后。复制或插入后仍不能超过 600 页。'],
    ],
    'rotate-pdf': [
      ['可以只旋转部分倒置的扫描页吗？', '可以。选择需要修正的页面，以 90° 为单位旋转，其他页面不变。'],
      ['旋转会降低清晰度吗？', '旋转修改的是 PDF 页面的方向，并不会刻意将页面图片化。重要文档仍建议检查导出结果。'],
    ],
    'extract-pages': [
      ['如何从一本长 PDF 中抽出指定页？', '可以勾选缩略图并提取，也可以输入 3，1－2 等多个页码范围，直接按输入顺序合并为一份 PDF 下载。输入 15- 表示选取当前导出页序的第 15 页直到最后一页。'],
      ['提取出的页面顺序如何确定？', '勾选后提取按工作台当前页序；直接按范围合并则使用输入顺序，重复或重叠页码只保留首次出现的页面。倒序或越界的范围会在导出前提示，不能直接下载。不会改动原始 PDF。'],
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
      ['可以把一本书的第 301 至 360 页导出为图片吗？', '可以。支持打开最多 1000 页的 PDF。输入 301- 可选择第 301 页至文档末页，但如果超过每批 60 张图片的限制，仍需分批导出。范围反向、页码越界或一次选择超过 60 页时，会在转换前提示修改。'],
      ['转换成 PNG 或 JPG 后还能复制文字吗？', '不能。PNG 和 JPG 是页面的图片，不包含原 PDF 的可选择文字。'],
      ['页码范围重复或重叠，会导出重复图片吗？', '不会。同一 PDF 页面只在首次出现的位置导出一次，并保留自定义顺序。ZIP 名称对应实际导出的页面；倒序或交错的图片文件名前会加顺序前缀。'],
      ['正在转换 PDF 页面时离开会怎样？', '文件仍在读取或图片转换未完成时，浏览器会先询问是否离开。可以继续转换或先取消；明确离开将放弃未完成的图片批次，不会下载不完整的结果。'],
      ['能从 PDF 中单独提取原始照片吗？', '不能。这里是把整个 PDF 页面重新渲染为 JPG 或 PNG，包含页面上的文字和图形；并非单独提取 PDF 内嵌照片，也不保留原始图片数据。'],
    ],
    'compress-pdf': [
      ['压缩后的 PDF 还能搜索和复制文字吗？', '默认的文档结构优化不会将文字图片化，因此可选中文字通常仍可搜索；若主动选择 JPEG 图片化压缩，则会丢失文字搜索能力、表单及链接。两种模式都将重写 PDF，使数字签名失效。请保留原文件并核查重要内容。'],
      ['如果压缩后的 PDF 反而更大呢？', '两种方式都真实比较输入和输出大小，变大或没有变小就不能下载优化结果。每次最多处理 120 页，部分文件已经很紧凑，无法进一步缩小。'],
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
      ['可以将长篇 TXT 电子书转换成 PDF 吗？', '支持 UTF-8 或带 BOM 的 UTF-16 文本，文件最多 5 MiB。输出总计最多 1000 页，其中需要特殊字体的图片化页面最多 300 页。'],
      ['中文转换后的 PDF 能搜索吗？', '目前中文文字通过浏览器字体绘制为图片页面，因此不能直接搜索或选择其中的文字。'],
    ],
    'markdown-to-pdf': [
      ['支持哪些 Markdown 语法？', '支持基本标题、段落、列表、引用及代码块；暂不渲染远程图片、HTML 和复杂表格。'],
      ['导入文本文件支持哪些编码？', '支持 UTF-8 或带 BOM 的 UTF-16 LE/BE。无法正确识别编码时将拒绝导入，避免生成乱码 PDF。'],
      ['可以完全替代 Word 排版吗？', '不能。这是轻量级本地转换工具，较长内容或中文文档导出后应检查分页与排版。'],
    ],
    'add-page-numbers': [
      ['320 页 PDF 能从第 201 页开始编号吗？', '可以。设置起始页码 201，第一页显示 201，最后一页显示 520。'],
      ['如何避免页码超过末页或 99999？', '先选择从 PDF 第几页开始编号，再输入显示的起始数字。工具会在生成前检查起始位置和最终显示页码是否超过 99999；之前的封面等页面保持不编号。'],
      ['页码能放在左上角、右下角吗？', '可以。支持上、下两排各三个位置，并提供 12、24、40 点的页码边距。只调整数字位置，不改变原 PDF 的纸张大小。'],
      ['能检查几百页文档中间的某一页吗？', '可以。生成后可预览第一张编号页、最后一页，或输入任意 PDF 页码检查（包括未编号封面）。切换预览页不会重新生成或自动下载文件。'],
      ['边距太大会不会把数字画到页面外？', '不会。工具按实际显示页面尺寸检查，包含旋转和裁剪过的页面。空间不足会提示调整，之前生成的 PDF 不会被清除。'],
    ],
    'image-to-pdf': [
      ['JPG、PNG、WebP、BMP、AVIF 能混合生成 PDF 吗？', '可以。支持 JPG、BMP 和静态 PNG、WebP、AVIF，调整顺序，也可以和 PDF 页面混用。AVIF 需要浏览器支持解码；动态 PNG（APNG）、WebP、AVIF 会被拒绝，避免丢失动画帧。'],
      ['能用 Letter、横向纸张或无边距吗？', '可以。支持 A4、US Letter、适合图片，纵向、横向或自动方向，以及 0、12、30、48 pt 边距。导入后修改设置需先点击“应用到已导入照片”。'],
      ['图片会被强行拉伸吗？', '不会。图片会按比例放入所选纸张，不会为了填满页面而拉伸。'],
      ['手机照片的定位信息会留在 PDF 中吗？', '导入 JPG 时，会移除常见 EXIF、XMP、IPTC 和 JPEG 注释元数据，其中可能有 GPS 位置信息。这并不是对已有 PDF 的通用元数据清除工具。'],
    ],
  },
};
export const toolHelpFor = (slug, locale = 'en') => toolHelp[locale]?.[slug] ?? [];
