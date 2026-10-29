import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName, PDFHexString, degrees, rgb, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function makePdf(pageWidths) {
  const doc = await PDFDocument.create();
  for (const width of pageWidths) {
    doc.addPage([width, 420]);
  }
  return Buffer.from(await doc.save());
}

const inputDocuments = async () => ([
  { name: 'first.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310]) },
  { name: 'second.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]) },
]);

async function loadInput(page) {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles(await inputDocuments());
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByText('Added 2 files and 3 pages.')).toBeVisible();
}

async function captured(page, action, timeout = 30000) {
  const waiting = page.waitForEvent('download', { timeout });
  await action();
  const download = await waiting;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

// Record real rendered progress changes without adding test-only app hooks or
// slowing production page copying. This also captures fast ZIP phase changes.
async function trackSplitProgress(page) {
  await page.evaluate(() => {
    window.__splitProgressSamples = [];
    const observe = () => {
      const status = document.querySelector('[data-testid="split-progress"]');
      const meter = document.querySelector('[data-testid="split-progress-meter"]');
      if (!status || !meter) return;
      const sample = {
        text: status.textContent ?? '', value: meter.value, max: meter.max,
        label: meter.getAttribute('aria-label') ?? '',
      };
      const samples = window.__splitProgressSamples;
      if (samples.length < 500 && samples.at(-1)?.text !== sample.text) samples.push(sample);
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['value', 'max'] });
  });
}
async function splitProgressSamples(page) {
  return page.evaluate(() => window.__splitProgressSamples);
}

async function downloadPdf(page, action) {
  const downloadEvent = page.waitForEvent('download');
  await action();
  const download = await downloadEvent;
  const bytes = await readFile(await download.path());
  return PDFDocument.load(bytes);
}

function watermarkImageCounts(pdf) {
  return pdf.getPages().map((pdfPage) => {
    const resourcesRef = pdfPage.node.Resources();
    if (!resourcesRef) return 0;
    const resources = pdf.context.lookup(resourcesRef, PDFDict);
    const xObjectRef = resources.get(PDFName.of('XObject'));
    return xObjectRef ? pdf.context.lookup(xObjectRef, PDFDict).keys().length : 0;
  });
}

test('exports without any watermark by default and only marks pages after opt-in', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  const plain = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(plain)).toEqual([0, 0, 0]);

  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('CONFIDENTIAL');
  await expect(page.getByText('CONFIDENTIAL').first()).toBeVisible();
  const marked = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(marked)).toEqual([1, 1, 1]);

  await page.getByTestId('watermark-toggle').uncheck();
  const plainAgain = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(watermarkImageCounts(plainAgain)).toEqual([0, 0, 0]);
});

test('pristine single PDF export preserves original form fields and source bytes', async ({ page }) => {
  const original = await PDFDocument.create();
  original.setTitle('Original editable form');
  const sheet = original.addPage([420, 595]);
  const field = original.getForm().createTextField('recipient');
  field.setText('Alice');
  field.addToPage(sheet);
  const bytes = Buffer.from(await original.save());
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const saved = await readFile(await (await downloadPromise).path());
  expect(Buffer.from(saved).equals(bytes)).toBe(true);
});

test('organize/split tabs support arrow keys and expose the active panel', async ({ page }) => {
  await loadInput(page);
  const organize = page.getByRole('tab', { name: 'Organize' });
  const split = page.getByRole('tab', { name: 'Split' });
  await organize.focus();
  await organize.press('ArrowRight');
  await expect(split).toBeFocused();
  await expect(split).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Split' })).toBeVisible();
  await split.press('Home');
  await expect(organize).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Organize' })).toBeVisible();
});

test('watermark requires custom text, never inserts a default brand watermark', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await page.getByTestId('watermark-toggle').check();
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter watermark text');
  await page.getByTestId('watermark-text').fill('  ');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter watermark text');
});

test('Chinese watermark page supports custom Chinese text and resets to no watermark', async ({ page }) => {
  await page.goto('/zh/watermark-pdf/');
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('watermark-toggle')).toBeVisible();
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('\u5185\u90e8\u8d44\u6599');
  const marked = await downloadPdf(page, () => page.getByRole('button', { name: '\u5bfc\u51fa PDF' }).click());
  expect(watermarkImageCounts(marked)).toEqual([1, 1]);
  await page.getByRole('button', { name: '\u6e05\u7a7a', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toContainText('永久清除');
  await page.getByTestId('confirm-clear').click();
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
  const plain = await downloadPdf(page, () => page.getByRole('button', { name: '\u5bfc\u51fa PDF' }).click());
  expect(watermarkImageCounts(plain)).toEqual([0, 0]);
});

test('ordinary multi-source PDFs reverse their export order with a single Undo/Redo step', async ({ page }) => {
  await loadInput(page); // first.pdf: 300, 310; second.pdf: 320
  await expect(page.getByTestId('page-order-actions')).toBeVisible();
  await expect(page.getByTestId('reverse-all-pages')).toHaveText('Reverse all pages');
  await page.getByTestId('workspace-view-grouped').click();
  await page.getByTestId('reverse-all-pages').click();
  const reversed = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(reversed.getPages().map(pdfPage => pdfPage.getWidth())).toEqual([320, 310, 300]);

  await page.getByRole('button', { name: 'Undo' }).click();
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(restored.getPages().map(pdfPage => pdfPage.getWidth())).toEqual([300, 310, 320]);

  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(redone.getPages().map(pdfPage => pdfPage.getWidth())).toEqual([320, 310, 300]);
});

test('Chinese 375px mobile can reverse an ordinary PDF scan without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'backwards-scan.pdf', mimeType: 'application/pdf', buffer: await makePdf([321, 432, 543]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('reverse-all-pages')).toHaveText('所有页面倒序');
  await page.getByTestId('reverse-all-pages').click();
  const saved = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(saved.getPages().map(pdfPage => pdfPage.getWidth())).toEqual([543, 432, 321]);
  const viewport = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width + 2);
});

test('watermark respects visible 0/90/180/270 degree rotations and nonzero CropBoxes', async ({ page }) => {
  const { degrees } = await import('pdf-lib');
  const original = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const sheet = original.addPage([595, 842]);
    sheet.setCropBox(21, 37, 510, 700);
    sheet.setRotation(degrees(angle));
  }
  await page.goto('/watermark-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'rotated-and-cropped.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from(await original.save()),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(4);
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('PRIVATE REVIEW');
  const result = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(result.getPages().map(sheet => sheet.getRotation().angle)).toEqual([0, 90, 180, 270]);
  for (const sheet of result.getPages()) {
    expect(sheet.getCropBox()).toMatchObject({ x: 21, y: 37, width: 510, height: 700 });
  }
  expect(watermarkImageCounts(result)).toEqual([1, 1, 1, 1]);
});

test('optional watermark is applied to selected extraction and every split PDF', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('export-options-button').click();
  await page.getByTestId('watermark-toggle').check();
  await page.getByTestId('watermark-text').fill('REVIEW COPY');
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(watermarkImageCounts(extracted)).toEqual([1]);

  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const downloaded = await pending;
  const zip = await JSZip.loadAsync(await readFile(await downloaded.path()));
  const parts = Object.values(zip.files);
  expect(parts).toHaveLength(2);
  for (const part of parts) {
    const pdf = await PDFDocument.load(await part.async('uint8array'));
    expect(watermarkImageCounts(pdf).every((n) => n === 1)).toBe(true);
  }
});

test('cross-file drag-and-drop changes the actual exported page order', async ({ page }) => {
  await loadInput(page);
  const cards = page.getByTestId('page-tile');
  await cards.nth(2).dragTo(cards.nth(0));
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([320, 300, 310]);
});

test('the real drag target shows before/after insertion markers matching exported page order', async ({ page }) => {
  await loadInput(page);
  const tiles = page.getByTestId('page-grid').getByTestId('page-tile');
  await page.evaluate(sourceIndex => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    const transfer = new DataTransfer();
    window.__dragTestTransfer = transfer;
    nodes[sourceIndex].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, 2);
  await expect(tiles.nth(2)).toHaveClass(/is-dragging/);
  await page.evaluate(targetIndex => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    nodes[targetIndex].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dragTestTransfer }));
  }, 0);
  await expect(tiles.nth(0)).toHaveAttribute('data-drop-side', 'before');
  await page.evaluate(targetIndex => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    nodes[targetIndex].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dragTestTransfer }));
  }, 0);
  await expect(tiles.nth(0)).not.toHaveAttribute('data-drop-side', 'before');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([320,300,310]);
});

test('selected multi-page drag marker always describes insertion before the target', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  const tiles = page.getByTestId('page-grid').getByTestId('page-tile');
  await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    window.__dragTestTransfer = new DataTransfer();
    nodes[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dragTestTransfer }));
  });
  await expect(tiles.nth(0)).toHaveClass(/is-dragging/);
  await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    nodes[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dragTestTransfer }));
  });
  await expect(tiles.nth(1)).toHaveAttribute('data-drop-side', 'before');
  await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid="page-grid"] [data-testid="page-tile"]');
    nodes[1].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dragTestTransfer }));
  });
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300,320,310]);
});

test('keyboard-accessible move buttons change the actual exported page order', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([310, 300, 320]);
});

test('multiple typed ranges export one real PDF in typed order without replacing checkbox selection', async ({ page }) => {
  await page.goto('/extract-pages/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303]) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await makePdf([401, 500]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Select page 4' }).check();
  const rangePanel = page.getByTestId('selection-range-panel');
  await expect(rangePanel).toHaveAttribute('open', ''); // Main task must be discoverable on Extract.
  await expect(page.getByTestId('range-combine-download')).toBeDisabled();
  // Users can still hide and reveal the advanced range section.
  await rangePanel.locator('summary').click();
  await expect(rangePanel).not.toHaveAttribute('open');
  await rangePanel.locator('summary').click();
  await expect(rangePanel).toHaveAttribute('open', '');
  await page.getByTestId('selection-ranges').fill('5, 2-3, 5, 1');
  await expect(page.getByTestId('range-combine-download')).toBeEnabled();
  const preview = page.getByTestId('range-combine-preview');
  await expect(preview).toContainText('4 page(s) in this PDF');
  await expect(preview).toContainText('5, 2, 3, 1');
  const saved = await captured(page, () => page.getByTestId('range-combine-download').click());
  expect(saved.name).toBe('plainmile-2-files-combined-4-pages.pdf');
  const combined = await PDFDocument.load(saved.bytes, { updateMetadata: false });
  expect(combined.getPages().map(p => p.getWidth())).toEqual([500, 302, 303, 301]);
  // A convenience download must not select new pages, reorder the source or
  // overwrite an older manual selection used by the regular Extract button.
  await expect(page.locator('.selection-info strong')).toContainText('1 page selected');
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  const selected = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(selected.getPages().map(p => p.getWidth())).toEqual([401]);
  const whole = await downloadPdf(page, () => page.getByRole('button', { name: 'Export all pages' }).click());
  expect(whole.getPages().map(p => p.getWidth())).toEqual([301, 302, 303, 401, 500]);
});

test('Chinese 375px direct range export accepts fullwidth input and rejects reversed ranges without a download', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: '书页.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await expect(page.getByTestId('selection-range-panel')).toHaveAttribute('open', '');
  await page.getByTestId('selection-ranges').fill('５，１－２，５');
  await expect(page.getByTestId('range-combine-preview')).toContainText('5, 1, 2');
  const saved = await captured(page, () => page.getByTestId('range-combine-download').click());
  expect(saved.name).toMatch(/-combined-3-pages\.pdf$/);
  const extracted = await PDFDocument.load(saved.bytes, { updateMetadata: false });
  expect(extracted.getPages().map(p => p.getWidth())).toEqual([305, 301, 302]);
  const downloads = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.getByTestId('selection-ranges').fill('５－２');
  await expect(page.getByTestId('range-combine-preview')).toHaveCount(0);
  await expect(page.getByTestId('selection-ranges')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('range-combine-invalid')).toContainText('选择页码无效');
  await expect(page.getByTestId('range-combine-download')).toBeDisabled();
  await expect(page.getByTestId('selection-range-apply')).toBeDisabled();
  expect(downloads).toEqual([]);
  // Correcting the plan immediately restores the actionable export control.
  await page.getByTestId('selection-ranges').fill('2-4');
  await expect(page.getByTestId('range-combine-invalid')).toHaveCount(0);
  await expect(page.getByTestId('selection-ranges')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('range-combine-download')).toBeEnabled();
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await expect(page.getByTestId('selection-ranges')).toHaveValue('2-4');
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 2);
});

test('select pages by output ranges then extract real nonconsecutive pages', async ({ page }) => {
  await page.goto('/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'numbers.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305, 306]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await expect(page.getByTestId('selection-range-panel')).toHaveAttribute('open', '');
  await page.getByTestId('selection-ranges').fill('2-3, 5, 5');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toHaveText('3 pages selected');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([302, 303, 305]);
});

test('Chinese Every N split accepts fullwidth digits and exports exact PDF page groups on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: '章节.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305, 306, 307]),
  });
  // Split PDF opens on its Split tab, so the Organize-only page tiles are
  // intentionally not mounted. The localized page count is the right cue.
  await expect(page.locator('.file-count')).toContainText('7 页');
  await page.locator('input[name="split-method"]').nth(1).check();
  const count = page.getByRole('spinbutton', { name: '每个 PDF 的页数' });
  await expect(count).toHaveAttribute('inputmode', 'numeric');
  // Text, not type=number: Chromium and Safari otherwise discard fullwidth
  // characters before the app gets a chance to normalize them.
  await count.fill('３e0');
  await expect(page.getByTestId('split-chunk-invalid')).toBeVisible();
  await expect(page.locator('.split-download')).toBeDisabled();
  await count.fill('３');
  await expect(count).toHaveValue('３');
  await expect(count).toHaveAttribute('aria-valuenow', '3');
  // Preserve the original spinbutton interaction for keyboard users.
  await count.press('ArrowUp');
  await expect(count).toHaveValue('4');
  await count.press('ArrowDown');
  await expect(count).toHaveValue('3');
  await count.fill('３');
  await expect(page.getByTestId('split-chunk-invalid')).toHaveCount(0);
  await expect(page.locator('.split-download')).toBeEnabled();
  const started = page.waitForEvent('download');
  await page.locator('.split-download').click();
  const download = await started;
  expect(download.suggestedFilename()).toMatch(/-split\.zip$/);
  const archive = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(archive.files).filter(name => name.endsWith('.pdf')).sort();
  expect(names).toEqual([
    'part-01-pages-1-3.pdf', 'part-02-pages-4-6.pdf', 'part-03-pages-7-7.pdf',
  ]);
  const groups = [];
  for (const name of names) {
    const pdf = await PDFDocument.load(await archive.file(name).async('uint8array'));
    groups.push(pdf.getPages().map(page => page.getWidth()));
  }
  expect(groups).toEqual([[301, 302, 303], [304, 305, 306], [307]]);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
});

test('Chinese touch-width range selection uses export order and rejects reversed ranges atomically', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/delete-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'document.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304, 305]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  await page.getByTestId('workspace-view-grouped').click();
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('１－２，４');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByTestId('selection-ranges').fill('5-1');
  // Invalid input is now blocked before Apply rather than relying on the
  // user to click a doomed action; the previous checkbox selection survives.
  await expect(page.getByTestId('selection-ranges')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('selection-range-invalid')).toContainText('原有选中页面未改变');
  await expect(page.getByTestId('selection-range-apply')).toBeDisabled();
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByRole('button', { name: '删除页面' }).click();
  const saved = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(saved.getPages().map(p => p.getWidth())).toEqual([303, 305]);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
});

test('rotate tool highlights rotation first and preserves secondary extraction', async ({ page }) => {
  await page.goto('/rotate-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'angles.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303]) });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('focused-page-hint')).toContainText('rotate left or right');
  await expect(page.getByTestId('page-actions').getByRole('button', { name: 'Rotate clockwise' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete selected pages' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  const rotated = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(rotated.getPages().map(p => p.getRotation().angle)).toEqual([0,90,0]);
  await page.getByTestId('page-more-actions').locator('summary').click();
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(extracted.getPages().map(p => p.getWidth())).toEqual([302]);
});

test('delete entry defaults to Delete and retains alternate operations and Undo', async ({ page }) => {
  await page.goto('/delete-pages/');
  await page.getByTestId('file-input').setInputFiles({ name: 'delete.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303]) });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('focused-page-hint')).toContainText('Undo can restore');
  await expect(page.getByRole('button', { name: 'Delete selected pages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate clockwise' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  let exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPages().map(p => p.getWidth())).toEqual([301,303]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByTestId('page-more-actions').locator('summary').click();
  await expect(page.getByRole('button', { name: 'Rotate clockwise' })).toBeVisible();
});

test('extract entry favors selected pages and clearly distinguishes full export', async ({ page }) => {
  await page.goto('/extract-pages/');
  await page.getByTestId('file-input').setInputFiles({ name: 'extract.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303]) });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('focused-page-hint')).toContainText('separate PDF');
  await expect(page.getByRole('button', { name: 'Export all pages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract selected pages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete selected pages' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(extracted.getPages().map(p => p.getWidth())).toEqual([302,303]);
  const full = await downloadPdf(page, () => page.getByRole('button', { name: 'Export all pages' }).click());
  expect(full.getPages().map(p => p.getWidth())).toEqual([301,302,303]);
});

test('Chinese focused Delete stays accessible on narrow mobile without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/delete-pages/');
  await page.getByTestId('file-input').setInputFiles({ name: 'delete.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302]) });
  await expect(page.getByRole('button', { name: '删除页面' })).toBeVisible();
  await expect(page.getByTestId('page-more-actions').locator('summary')).toContainText('更多页面操作');
  await page.getByRole('checkbox', { name: '选择第 1 页' }).check();
  await page.getByRole('button', { name: '删除页面' }).click();
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(exported.getPages().map(p => p.getWidth())).toEqual([302]);
  const measure = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(measure.scrollWidth).toBeLessThanOrEqual(measure.clientWidth + 2);
});

test('split tool clearly distinguishes a split download from full-document export', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'split.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303]) });
  await expect(page.getByTestId('page-tile')).toHaveCount(0); // Split tab does not show organizer tiles.
  await expect(page.getByRole('button', { name: 'Export all pages' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('2-3');
  const splitDownload = await downloadPdf(page, () => page.getByRole('button', { name: 'Download PDF' }).click());
  expect(splitDownload.getPages().map(p => p.getWidth())).toEqual([302,303]);
  const complete = await downloadPdf(page, () => page.getByRole('button', { name: 'Export all pages' }).click());
  expect(complete.getPages().map(p => p.getWidth())).toEqual([301,302,303]);
  // Switching into the split tab from another route must be equally clear.
  await page.getByRole('tab', { name: 'Organize' }).click();
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible();
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByRole('button', { name: 'Export all pages' })).toBeVisible();
});

test('rotate, delete, undo and extract selected pages', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  const rotated = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
  const extracted = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(extracted.getPages().map((p) => p.getWidth())).toEqual([310]);
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const afterDelete = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(afterDelete.getPages().map((p) => p.getWidth())).toEqual([300, 320]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
});

test('split PDFs into ZIP ranges in the current workspace order', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const download = await downloadEvent;
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-3.pdf']);
  const partOne = await PDFDocument.load(await zip.files[names[0]].async('uint8array'));
  const partTwo = await PDFDocument.load(await zip.files[names[1]].async('uint8array'));
  expect(partOne.getPages().map((p) => p.getWidth())).toEqual([300, 310]);
  expect(partTwo.getPages().map((p) => p.getWidth())).toEqual([320]);
});

test('split preview exposes omissions and overlaps without blocking intentional partial output', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  const ranges = page.getByRole('textbox', { name: 'Page ranges', exact: true });
  await ranges.fill('1,3');
  await expect(page.getByTestId('split-coverage-omitted')).toContainText('2 included');
  await expect(page.getByTestId('split-coverage-omitted')).toContainText('Pages excluded from the split: 2');
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
  await ranges.fill('1-2,2-3');
  await expect(page.getByTestId('split-coverage-omitted')).toHaveCount(0);
  await expect(page.getByTestId('split-coverage-repeated')).toContainText('Pages repeated across output files: 2');
  await ranges.fill('3,1-2');
  await expect(page.getByTestId('split-coverage-complete')).toContainText('Every current output page is included exactly once');
  await page.getByTestId('split-output-preview').locator('summary').click();
  await expect(page.getByTestId('split-output-preview').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('split-output-preview').locator('li').first()).toContainText('pages 3–3 (1 page)');
  await expect(page.getByTestId('split-output-preview').locator('li').last()).toContainText('pages 1–2 (2 pages)');
});

test('Chinese mobile split preview lists actual output sections and does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'split-zh.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303, 304]),
  });
  await page.locator('#ranges-input').fill('1-2,4');
  await expect(page.getByTestId('split-coverage-omitted')).toContainText('遗漏 1 页：3');
  await page.getByTestId('split-output-preview').locator('summary').click();
  await expect(page.getByTestId('split-output-preview').locator('li')).toHaveCount(2);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
});

test('invalid split ranges disable download until corrected', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  const button = page.getByRole('button', { name: 'Download split PDFs (ZIP)' });
  await expect(button).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter page ranges');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('3-1');
  await expect(button).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('maximum 50 PDFs per download');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  await expect(button).toBeEnabled();
});

test('rejects password-protected or malformed PDFs safely', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await expect(page.getByTestId('dropzone')).toBeVisible();
});

test('PNG images become an A4 PDF page without server upload', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const base64Image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = 'teal';
    context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(base64Image, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
});

test('undo and redo reverse a drag reorder', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(undone.getPages().map((p) => p.getWidth())).toEqual([300, 310, 320]);
  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(redone.getPages().map((p) => p.getWidth())).toEqual([310, 300, 320]);
});


test('deleting every page allows the workspace to be completely reset', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await page.getByRole('button', { name: 'Clear workspace and start over' }).click();
  await page.getByTestId('confirm-clear').click();
  await page.getByTestId('file-input').setInputFiles((await inputDocuments())[0]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([300, 310]);
});

test('Chinese pages switch languages while preserving tri-state theme choice', async ({ page }) => {
  await page.goto('/zh/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: '合并、拆分、转换与整理 PDF' })).toBeVisible();
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', 'https://pdf.plainmile.com/');
  const theme = page.getByRole('combobox', { name: '外观' });
  await expect(theme).toHaveValue('system');
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/zh/workspace/');
  await expect(page.getByRole('combobox', { name: '外观' })).toHaveValue('dark');
  await page.getByRole('link', { name: '语言: English' }).click();
  await expect(page).toHaveURL(/\/workspace\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('combobox', { name: 'Appearance' })).toHaveValue('dark');
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});

test('batch-drag selected pages together across documents in the exported PDF', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  const cards = page.getByTestId('page-tile');
  // The tile contains an independent preview button in its center. Drag from
  // the visible grip and drop on the tile edge to exercise the intended user
  // affordance without accidentally clicking the PDF zoom preview.
  const handle = cards.nth(0).getByTestId('page-drag-handle');
  await expect(handle).toHaveAttribute('draggable', 'true');
  await handle.dragTo(cards.nth(1), { targetPosition: { x: 9, y: 62 } });
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map((p) => p.getWidth())).toEqual([300, 320, 310]);
});

test('same-turn grouped drag/drop preserves selected page IDs even without native payload', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  // Both events occur in one JavaScript turn, BEFORE React has committed the
  // dragged visual state. An empty drop payload simulates browser variance.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="page-tile"]')];
    const original = new DataTransfer();
    cards[0].dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: original,
    }));
    const empty = new DataTransfer();
    cards[1].dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true, dataTransfer: empty,
    }));
    cards[1].dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: empty,
    }));
    cards[0].dispatchEvent(new DragEvent('dragend', {
      bubbles: true, cancelable: true, dataTransfer: original,
    }));
  });
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300, 320, 310]);
});

test('Chinese split tool exports current pages without uploading the document', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles(await inputDocuments());
  await expect(page.getByRole('button', { name: '下载拆分文件（ZIP）' })).toBeDisabled();
  await page.getByRole('textbox', { name: '页码范围' }).fill('１－２，３');
  await expect(page.getByText('预计生成 2 个 PDF 文件。')).toBeVisible();
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载拆分文件（ZIP）' }).click();
  const download = await wait;
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  expect(Object.keys(zip.files).sort()).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-3.pdf']);
});

test('workbench imports 320-page book with lazy previews and extracts one page', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-320-pages.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({length:320},()=>420)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(320, { timeout: 30000 });
  await expect(page.getByTestId('workspace-large-warning')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  const one = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
  expect(one.getPageCount()).toBe(1);
});

test('workbench reports the actual 100 MB file limit, not a stale 25 MB limit', async ({ page }) => {
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0),
  });
  await expect(page.getByRole('alert')).toContainText('100 MB');
  await expect(page.getByRole('alert')).not.toContainText('25 MB');
});

test('one-click every-page split downloads correct PDFs in current export order', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  const preset = page.getByTestId('split-each-page');
  await expect(preset).toBeEnabled();
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: 'Split every N pages' })).toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'Pages per PDF' })).toHaveValue('1');
  await expect(page.getByTestId('split-coverage-complete')).toContainText('3 total');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const archive = await JSZip.loadAsync(await readFile(await (await downloading).path()));
  const filenames = Object.keys(archive.files).sort();
  expect(filenames).toEqual([
    'part-01-pages-1-1.pdf', 'part-02-pages-2-2.pdf', 'part-03-pages-3-3.pdf',
  ]);
  const widths = [];
  for (const filename of filenames) {
    const pdf = await PDFDocument.load(await archive.files[filename].async('uint8array'));
    expect(pdf.getPageCount()).toBe(1);
    widths.push(pdf.getPage(0).getWidth());
  }
  expect(widths).toEqual([300, 310, 320]);
});

test('odd/even split follows reordered output pages and downloads two exact PDFs in one ZIP', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'alternating.pdf', mimeType: 'application/pdf',
    buffer: await makePdf([310, 320, 330, 340, 350, 360, 370]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(7);
  await page.getByTestId('reverse-all-pages').click();
  await page.getByRole('tab', { name: 'Split' }).click();
  const oddEven = page.getByRole('radio', { name: 'Split into odd-page and even-page PDFs' });
  await oddEven.check();
  await expect(oddEven).toBeChecked();
  await expect(page.getByTestId('split-coverage-complete')).toContainText('7 total');
  await expect(page.getByTestId('split-batch-nav')).toHaveCount(0);
  await page.getByTestId('split-output-preview').locator('summary').click();
  const labels = await page.getByTestId('split-output-preview').locator('li').allTextContents();
  expect(labels).toEqual([
    expect.stringContaining('Odd output pages (1, 3, 5…)'),
    expect.stringContaining('Even output pages (2, 4, 6…)'),
  ]);
  expect(labels[0]).toContain('4 pages');
  expect(labels[1]).toContain('3 pages');
  const saved = await captured(page, () => page.locator('.split-download').click(), 30000);
  expect(saved.name).toBe('alternating-odd-even.zip');
  const zip = await JSZip.loadAsync(saved.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['even-pages.pdf', 'odd-pages.pdf']);
  const odd = await PDFDocument.load(await zip.file('odd-pages.pdf').async('uint8array'));
  const even = await PDFDocument.load(await zip.file('even-pages.pdf').async('uint8array'));
  expect(odd.getPages().map(p => p.getWidth())).toEqual([370, 350, 330, 310]);
  expect(even.getPages().map(p => p.getWidth())).toEqual([360, 340, 320]);
  // Splitting is a download, not a page-edit command. The source order stays unchanged.
  await page.getByRole('tab', { name: 'Organize' }).click();
  const first = page.getByTestId('page-tile').first();
  await expect(first).toHaveAttribute('data-original-page', '7');
});

test('Chinese 375px split offers separate or combined ranges in-place, odd/even guard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'mobile-range.pdf', mimeType: 'application/pdf',
    buffer: await makePdf([300, 310, 320, 330, 340]),
  });
  await expect(page.locator('.file-count')).toContainText('5 页');
  await page.locator('#ranges-input').fill('１－２，４－５');
  const hint = page.getByTestId('split-multiple-ranges-hint');
  await expect(hint).toContainText('2 个范围生成 2 份 PDF');
  await expect(hint).toContainText('无需切换工具或重新导入');
  await expect(page.getByTestId('split-combine-download')).toBeEnabled();
  const parity = page.getByRole('radio', { name: '按奇偶页分别生成 PDF' });
  await parity.check();
  await expect(hint).toHaveCount(0);
  await expect(page.getByTestId('split-combine-download')).toHaveCount(0);
  await expect(page.getByTestId('split-coverage-complete')).toContainText('5 页');
  await page.getByTestId('split-output-preview').locator('summary').click();
  await expect(page.getByTestId('split-output-preview')).toContainText('奇数位页面');
  await expect(page.getByTestId('split-output-preview')).toContainText('偶数位页面');
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 2);
  const saved = await captured(page, () => page.locator('.split-download').click());
  const zip = await JSZip.loadAsync(saved.bytes);
  const odd = await PDFDocument.load(await zip.file('odd-pages.pdf').async('uint8array'));
  const even = await PDFDocument.load(await zip.file('even-pages.pdf').async('uint8array'));
  expect(odd.getPages().map(p => p.getWidth())).toEqual([300, 320, 340]);
  expect(even.getPages().map(p => p.getWidth())).toEqual([310, 330]);
  await page.getByRole('radio', { name: '按页码范围拆分' }).check();
  await expect(page.locator('#ranges-input')).toHaveValue('１－２，４－５');
  await expect(hint).toBeVisible();
  await expect(page.getByTestId('split-combine-download')).toBeVisible();
});

test('odd/even split cannot create an empty even PDF for one-page documents', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'one.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]),
  });
  await expect(page.locator('.file-count')).toContainText('1 page');
  await expect(page.getByRole('radio', { name: 'Split into odd-page and even-page PDFs' }))
    .toBeDisabled();
  await expect(page.locator('.split-download')).toBeDisabled();
});

test('split output count over 50 is explained before download', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fifty-one.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 51 }, () => 300)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(51);
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-each-page')).toBeEnabled();
  await expect(page.getByTestId('split-each-page-limit')).toContainText('2 separate batches');
  await page.getByTestId('split-each-page').click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await expect(page.getByRole('button', { name: 'Download this batch (ZIP)' })).toBeEnabled();
  await expect(page.getByTestId('split-coverage-omitted')).toHaveCount(0);
  await page.getByTestId('split-batch-next').click();
  await expect(page.getByTestId('split-batch-status')).toContainText('output pages 51–51');
  const singleDownload = page.locator('.split-download');
  await expect(singleDownload).toContainText('Download PDF');
  await expect(singleDownload).toBeEnabled();
  await expect(page.getByTestId('split-batch-nav')).toContainText('a batch with one output PDF downloads directly');
  const lastPageDownloading = page.waitForEvent('download');
  await singleDownload.click();
  const lastPageDownload = await lastPageDownloading;
  expect(lastPageDownload.suggestedFilename()).toBe('fifty-one-pages-51-51.pdf');
  const lastPagePdf = await PDFDocument.load(await readFile(await lastPageDownload.path()));
  expect(lastPagePdf.getPageCount()).toBe(1);
  await expect(page.locator('.notice-success')).toContainText('Download requested for final batch (2 of 2)');
  await expect(page.locator('.notice-success')).not.toContainText('Next batch');
  await expect(page.getByTestId('split-batch-progress')).toContainText('1 of 2');
  await expect(page.getByTestId('split-batch-current-requested')).toBeVisible();
  // A user may start with the last batch; the shortcut finds the first missing batch.
  await page.getByTestId('split-batch-go-pending').click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await expect(page.getByTestId('split-batch-current-requested')).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('2');
  await expect(page.getByTestId('split-batch-nav')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
});

test('105-page book downloads three separate, correctly numbered per-page ZIP batches', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-105.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 105 }, (_, i) => 300 + i)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(105);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByTestId('split-each-page').click();
  await expect(page.getByTestId('split-batch-prev')).toBeDisabled();
  for (const [batch, start, end] of [[1, 1, 50], [2, 51, 100], [3, 101, 105]]) {
    await expect(page.getByTestId('split-batch-status')).toContainText('Batch ' + batch + ' of 3');
    await expect(page.getByTestId('split-batch-status')).toContainText('output pages ' + start + '–' + end);
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this batch (ZIP)' }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toBe('book-105-pages-' + start + '-' + end + '-split.zip');
    const archive = await JSZip.loadAsync(await readFile(await download.path()));
    const filenames = Object.keys(archive.files).sort();
    expect(filenames).toHaveLength(end - start + 1);
    for (const offset of [0, Math.floor((end - start) / 2), end - start]) {
      const pageNumber = start + offset;
      const filename = 'part-' + String(offset + 1).padStart(2, '0') +
        '-pages-' + pageNumber + '-' + pageNumber + '.pdf';
      expect(filenames).toContain(filename);
      const pdf = await PDFDocument.load(await archive.files[filename].async('uint8array'));
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBe(299 + pageNumber);
    }
    await expect(page.getByTestId('split-coverage-omitted')).toHaveCount(0);
    await expect(page.getByTestId('split-batch-progress')).toContainText(batch + ' of 3');
    if (batch === 3) {
      await expect(page.locator('.notice-success')).toContainText('Download requested for final batch (3 of 3)');
      await expect(page.locator('.notice-success')).not.toContainText('Next batch');
    }
    if (batch < 3) await page.getByTestId('split-batch-next').click();
  }
  await expect(page.getByTestId('split-batch-next')).toBeDisabled();
  await expect(page.getByTestId('split-batch-all-requested')).toBeVisible();
  await expect(page.getByTestId('split-batch-go-pending')).toHaveCount(0);
  await page.getByTestId('split-batch-prev').click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 2 of 3');
  await expect(page.getByTestId('split-batch-current-requested')).toBeVisible();
  // Renaming between batches creates a new delivery plan; do not reuse old markers.
  await page.getByTestId('download-name-panel').locator('summary').click();
  await page.getByTestId('download-name-input').fill('renamed-book');
  await expect(page.getByTestId('split-batch-progress')).toContainText('0 of 3');
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('2');
  await expect(page.getByTestId('split-batch-progress')).toContainText('0 of 2');
  await expect(page.getByTestId('split-batch-all-requested')).toHaveCount(0);
  // Reverting the settings must not resurrect stale progress from the old plan.
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('1');
  await expect(page.getByTestId('split-batch-progress')).toContainText('0 of 3');
});

test('every 2 pages splits a 105-page PDF into two bounded batches without missing outputs', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'two-page-book.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 105 }, (_, index) => 360 + index)),
  });
  // The dedicated /split-pdf/ route opens the Split tab, not page tiles.
  await expect(page.locator('.file-count')).toContainText('105 pages');
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('2');
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await expect(page.getByTestId('split-each-page-limit')).toContainText('One PDF per page would split');
  for (const [batch, firstPage, lastPage, outputs] of [[1, 1, 100, 50], [2, 101, 105, 3]]) {
    await expect(page.getByTestId('split-batch-status')).toContainText('output pages ' + firstPage + '–' + lastPage);
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download this batch (ZIP)' }).click();
    const saved = await waiting;
    expect(saved.suggestedFilename()).toBe('two-page-book-pages-' + firstPage + '-' + lastPage + '-split.zip');
    const archive = await JSZip.loadAsync(await readFile(await saved.path()));
    const files = Object.keys(archive.files).sort();
    expect(files).toHaveLength(outputs);
    for (let offset = 0; offset < outputs; offset++) {
      const start = firstPage + offset * 2;
      const end = Math.min(105, start + 1);
      const name = 'part-' + String(offset + 1).padStart(2, '0') + '-pages-' + start + '-' + end + '.pdf';
      expect(files).toContain(name);
      const part = await PDFDocument.load(await archive.files[name].async('uint8array'));
      expect(part.getPageCount()).toBe(end - start + 1);
      expect(part.getPages().map(p => p.getWidth())).toEqual(
        Array.from({ length: end - start + 1 }, (_, i) => 359 + start + i));
    }
    if (batch === 1) await page.getByTestId('split-batch-next').click();
  }
  await expect(page.getByTestId('split-batch-next')).toBeDisabled();
  await expect(page.locator('.notice-success')).toContainText('Download requested for final batch (2 of 2)');
});

test('375px Chinese visual split jumps to a late page without changing PDF order', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'phone-book.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 105 }, (_, i) => 300 + i)),
  });
  await expect(page.locator('.file-count')).toContainText('105 页');
  await page.getByTestId('visual-split-panel').locator('summary').click();
  const jump = page.getByTestId('split-visual-jump-input');
  await expect(jump).toBeVisible();
  await jump.fill('１０６');
  await page.getByTestId('split-visual-jump-submit').click();
  await expect(page.locator('.notice-error')).toContainText('105');
  await jump.fill('１００');
  await page.getByTestId('split-visual-jump-submit').click();
  const selected = page.locator('[data-testid="visual-split-page"][data-export-position="100"]');
  await expect(selected).toBeFocused();
  await expect(page.locator('.notice-success')).toContainText('100');
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 2);
  await page.locator('[data-testid="visual-split-cut"][data-after-page="100"]').click();
  await expect(page.getByTestId('split-coverage-complete')).toContainText('105');
  const out = await captured(page, () => page.locator('.split-download').click());
  const zip = await JSZip.loadAsync(out.bytes);
  const entries = Object.keys(zip.files).sort();
  expect(entries).toEqual(['part-01-pages-1-100.pdf', 'part-02-pages-101-105.pdf']);
  const counts = [];
  for (const name of entries) {
    const document = await PDFDocument.load(await zip.file(name).async('uint8array'));
    counts.push(document.getPageCount());
  }
  expect(counts).toEqual([100, 5]);
});

test('Undo, Redo and blank insertion reset stale every-N split batch navigation', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-105.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 105 }, (_, index) => 300 + index)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(105);
  await page.getByRole('button', { name: 'Move page 1 right' }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('2');
  const next = page.getByTestId('split-batch-next');
  await next.click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 2 of 2');
  // Only the final three output PDFs are in this batch. Their successful
  // download request must not survive a later page-order edit or Undo.
  const lateBatch = await captured(page, () => page.locator('.split-download').click());
  const archive = await JSZip.loadAsync(lateBatch.bytes);
  expect(Object.keys(archive.files)).toHaveLength(3);
  await expect(page.getByTestId('split-batch-progress')).toContainText('1 of 2');
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await expect(page.getByTestId('split-batch-progress')).toContainText('0 of 2');
  await next.click();
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await next.click();
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(106);
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-batch-status')).toContainText('Batch 1 of 2');
  await expect(page.getByTestId('split-batch-status')).toContainText('output pages 1–100');
});

test('image import uses filename when MIME is generic and blocks oversized PNG before decoding', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 48;
    canvas.getContext('2d').fillRect(0, 0, 96, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'photo.png', mimeType: 'application/octet-stream', buffer: Buffer.from(base64, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
  const header = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(header, 0);
  Buffer.from('IHDR').copy(header, 12);
  header.writeUInt32BE(18000, 16);
  header.writeUInt32BE(18000, 20);
  await page.getByTestId('file-input').setInputFiles({
    name: 'huge.png', mimeType: 'image/png', buffer: header,
  });
  await expect(page.getByRole('alert')).toContainText('Image dimensions are too large');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});

test('empty workspace retains undo and a successful reimport does not inherit hidden file quotas', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  const initial = await makePdf([300]);
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: 20 }, (_, n) => ({
      name: `original-${n + 1}.pdf`, mimeType: 'application/pdf', buffer: initial,
    })),
  );
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();
  await expect(page.getByTestId('empty-history-hint')).toContainText('old undo history will be cleared');

  // A failed import cannot delete the user's last undo opportunity.
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await page.getByTestId('undo-all-deleted').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(20);

  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await page.getByTestId('file-input').setInputFiles({
    name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await makePdf([501]),
  });
  await expect(page.getByTestId('reimport-confirmation')).toHaveAttribute('aria-label', 'Discard the last Undo history?');
  await expect(page.getByTestId('reimport-confirmation')).toContainText('permanently discard the deleted pages');
  await expect(page.getByTestId('undo-all-deleted')).toBeDisabled();
  await page.getByTestId('confirm-reimport').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByText('from 1 file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([501]);
});

test('Chinese empty workspace explains undo and reset before starting a new document', async ({ page }) => {
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'test.pdf', mimeType: 'application/pdf', buffer: await makePdf([314]),
  });
  await page.getByRole('button', { name: '全选' }).click();
  await page.getByRole('button', { name: '删除页面' }).click();
  await expect(page.getByTestId('empty-history-hint')).toContainText('清除旧操作的撤销记录');
  await page.getByTestId('undo-all-deleted').click();
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(restored.getPages().map(p => p.getWidth())).toEqual([314]);
});

test('book-length odd-even split reports cumulative copied pages for both PDFs', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-progress.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 320 }, (_, index) => 300 + index % 10)),
  });
  await page.getByRole('radio', { name: 'Split into odd-page and even-page PDFs' }).check();
  await trackSplitProgress(page);
  const out = await captured(page, () => page.locator('.split-download').click(), 60000);
  expect(out.name).toMatch(/odd-even\.zip$/);
  const zip = await JSZip.loadAsync(out.bytes);
  expect(Object.keys(zip.files).sort()).toEqual(['even-pages.pdf', 'odd-pages.pdf']);
  const odd = await PDFDocument.load(await zip.file('odd-pages.pdf').async('uint8array'));
  const even = await PDFDocument.load(await zip.file('even-pages.pdf').async('uint8array'));
  expect(odd.getPageCount()).toBe(160);
  expect(even.getPageCount()).toBe(160);
  expect(odd.getPage(0).getWidth()).toBe(300);
  expect(even.getPage(0).getWidth()).toBe(301);
  const samples = await splitProgressSamples(page);
  const copy = samples.filter(sample => sample.label === 'PDF page copying progress' && sample.max === 320);
  expect(copy.some(sample => sample.value > 0 && sample.value < 320), JSON.stringify(samples.slice(-12))).toBe(true);
  expect(copy.some(sample => sample.text.includes('Building PDF 2 of 2') && sample.value >= 160),
    JSON.stringify(samples.slice(-12))).toBe(true);
  expect(copy.every(sample => !sample.text.includes('{') && sample.text.includes('output pages')),
    JSON.stringify(samples.slice(-12))).toBe(true);
  await expect(page.getByTestId('split-progress-container')).toHaveCount(0);
});

test('overlapping custom ranges count output copies rather than unique source pages', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'overlaps.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 105 }, (_, i) => 301 + i % 5)),
  });
  await page.locator('#ranges-input').fill('1-105, 51-105');
  await expect(page.getByTestId('split-coverage-repeated')).toContainText('55');
  await trackSplitProgress(page);
  const out = await captured(page, () => page.locator('.split-download').click(), 60000);
  const zip = await JSZip.loadAsync(out.bytes);
  const first = await PDFDocument.load(await zip.file('part-01-pages-1-105.pdf').async('uint8array'));
  const second = await PDFDocument.load(await zip.file('part-02-pages-51-105.pdf').async('uint8array'));
  expect([first.getPageCount(), second.getPageCount()]).toEqual([105, 55]);
  const samples = await splitProgressSamples(page);
  const copy = samples.filter(sample => sample.label === 'PDF page copying progress' && sample.max === 160);
  expect(copy.some(sample => sample.value > 0 && sample.value < 160), JSON.stringify(samples.slice(-12))).toBe(true);
  expect(copy.some(sample => sample.text.includes('Building PDF 2 of 2') && sample.value >= 105),
    JSON.stringify(samples.slice(-12))).toBe(true);
  expect(copy.every(sample => !sample.text.includes('{') && sample.text.includes('160 output pages')),
    JSON.stringify(samples.slice(-12))).toBe(true);
});

test('split ZIP supports 50 outputs with progress controls and valid downloaded PDFs', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fifty-parts.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 50 }, (_, index) => 301 + index)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(50);
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('split-output-budget')).toContainText('128 MB');
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('1');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const download = await waiting;
  const archive = await JSZip.loadAsync(await readFile(await download.path()));
  const names = Object.keys(archive.files).sort();
  expect(names).toHaveLength(50);
  const first = await PDFDocument.load(await archive.files[names[0]].async('uint8array'));
  const last = await PDFDocument.load(await archive.files[names[49]].async('uint8array'));
  expect(first.getPages()[0].getWidth()).toBe(301);
  expect(last.getPages()[0].getWidth()).toBe(350);
  await expect(page.getByRole('status')).toContainText('Created 50 PDF file(s)');
  await expect(page.getByTestId('split-cancel')).toHaveCount(0);
});

test('cancelling a long split stops ZIP download and restores workspace controls', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'cancel-split.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 320 }, (_, index) => 300 + index % 12)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(320);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  await page.getByRole('spinbutton', { name: 'Pages per PDF' }).fill('7');
  const downloads = [];
  page.on('download', event => downloads.push(event.suggestedFilename()));
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  await expect(page.getByTestId('split-cancel')).toBeVisible();
  await expect(page.getByTestId('split-progress-meter')).toHaveAttribute('max', '320');
  await expect(page.getByRole('tab', { name: 'Organize' })).toBeDisabled();
  await page.getByTestId('split-cancel').click();
  await expect(page.getByRole('alert')).toContainText('Split cancelled', { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
  await expect(page.getByTestId('split-progress-meter')).toHaveCount(0);
  expect(downloads).toEqual([]);
});

test('Chinese split clearly announces ZIP limit before running', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'simple.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310]),
  });
  await page.getByRole('tab', { name: '拆分文件' }).click();
  await expect(page.getByTestId('split-output-budget')).toContainText('128 MB');
});

test('Chinese workspace keeps specific file count and type errors rather than a generic failure', async ({ page }) => {
  await page.goto('/zh/workspace/');
  const sample = await makePdf([300]);
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: 21 }, (_, n) => ({
      name: `part-${n}.pdf`, mimeType: 'application/pdf', buffer: sample,
    })),
  );
  await expect(page.getByRole('alert')).toContainText('一次最多处理 20 个文件');
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('请选择 PDF、JPG、PNG、WebP、BMP 或静态 AVIF 文件');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
});

for (const dpr of [1, 2]) {
  test.describe(`thumbnail canvas recycling at ${dpr}x DPR`, () => {
    test.use({ deviceScaleFactor: dpr });
    test('releases offscreen bitmaps, redraws on return, preserves rotation and export', async ({ page }) => {
      test.setTimeout(60000);
      await page.goto('/workspace/');
      await page.getByTestId('file-input').setInputFiles({
        name: 'long-report.pdf', mimeType: 'application/pdf',
        buffer: await makePdf(Array.from({ length: 320 }, (_, i) => 300 + i % 13)),
      });
      const tiles = page.getByTestId('page-tile');
      await expect(tiles).toHaveCount(320, { timeout: 30000 });
      const first = tiles.first();
      await first.scrollIntoViewIfNeeded();
      const firstCanvas = first.locator('canvas');
      await expect.poll(async () => firstCanvas.evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      const firstBackingStore = await firstCanvas.elementHandle();
      expect(firstBackingStore).not.toBeNull();
      await tiles.nth(319).scrollIntoViewIfNeeded();
      await expect(firstCanvas).toHaveCount(0, { timeout: 10000 });
      // Keep the detached canvas handle to prove the actual pixel buffer was reset,
      // not merely hidden while hundreds of thumbnails retain their old bitmaps.
      await expect.poll(() => firstBackingStore.evaluate(c => [c.width, c.height])).toEqual([0, 0]);
      await first.scrollIntoViewIfNeeded();
      await expect.poll(async () => first.locator('canvas').evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      await first.getByRole('checkbox', { name: 'Select page 1' }).check();
      await page.getByRole('button', { name: 'Rotate clockwise' }).click();
      await expect.poll(async () => first.locator('canvas').evaluate(c => c.width), { timeout: 20000 }).toBeGreaterThan(0);
      const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Extract selected pages' }).click());
      expect(output.getPageCount()).toBe(1);
      expect(output.getPages()[0].getRotation().angle).toBe(90);
    });
  });
}

test('split requires deliberate input for a 320-page book and starts blank after clearing', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book-320.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 320 }, (_, i) => 300 + i % 12)),
  });
  await expect(page.locator('.file-count')).toContainText('320 pages');
  const download = page.getByRole('button', { name: 'Download split PDFs (ZIP)' });
  const ranges = page.getByRole('textbox', { name: 'Page ranges', exact: true });
  await expect(ranges).toHaveValue('');
  await expect(download).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter page ranges');
  await page.getByRole('radio', { name: 'Split every N pages' }).check();
  const pagesPerPart = page.getByRole('spinbutton', { name: 'Pages per PDF' });
  await expect(pagesPerPart).toHaveValue('');
  await expect(download).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('Enter how many pages');
  await pagesPerPart.fill('16');
  await expect(page.locator('.split-estimate')).toContainText('20 PDF file(s)');
  await expect(download).toBeEnabled();
  await page.getByRole('radio', { name: 'Split by page ranges' }).check();
  await expect(download).toBeDisabled();
  await ranges.fill('1-30,31-320');
  await expect(page.locator('.split-estimate')).toContainText('2 PDF file(s)');
  await expect(download).toBeEnabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'new-document.pdf', mimeType: 'application/pdf', buffer: await makePdf([350, 351, 352, 353]),
  });
  await expect(ranges).toHaveValue('');
  await expect(download).toBeDisabled();
});

test('Chinese mobile split requires a typed range and exports exactly the chosen pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'mobile.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310, 320, 330]),
  });
  const action = page.getByRole('button', { name: '下载拆分文件（ZIP）' });
  const rangeInput = page.getByRole('textbox', { name: '页码范围' });
  await expect(rangeInput).toHaveValue('');
  await expect(action).toBeDisabled();
  await expect(page.locator('.split-estimate')).toContainText('请填写要拆分的页码范围');
  await rangeInput.fill('1-2,3-4');
  await expect(action).toBeEnabled();
  const wait = page.waitForEvent('download');
  await action.click();
  const archive = await JSZip.loadAsync(await readFile(await (await wait).path()));
  expect(Object.keys(archive.files).sort()).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-4.pdf']);
  const first = await PDFDocument.load(await archive.files['part-01-pages-1-2.pdf'].async('uint8array'));
  const second = await PDFDocument.load(await archive.files['part-02-pages-3-4.pdf'].async('uint8array'));
  expect(first.getPages().map(p => p.getWidth())).toEqual([300, 310]);
  expect(second.getPages().map(p => p.getWidth())).toEqual([320, 330]);
});

function addExifOrientationToJpeg(jpeg, orientation, endian = 'II') {
  const payload = Buffer.alloc(32);
  payload.write('Exif', 0, 'ascii');
  const little = endian === 'II';
  payload.write(endian, 6, 'ascii');
  if (little) {
    payload.writeUInt16LE(42, 8); payload.writeUInt32LE(8, 10);
    payload.writeUInt16LE(1, 14); payload.writeUInt16LE(0x0112, 16);
    payload.writeUInt16LE(3, 18); payload.writeUInt32LE(1, 20);
    payload.writeUInt16LE(orientation, 24);
  } else {
    payload.writeUInt16BE(42, 8); payload.writeUInt32BE(8, 10);
    payload.writeUInt16BE(1, 14); payload.writeUInt16BE(0x0112, 16);
    payload.writeUInt16BE(3, 18); payload.writeUInt32BE(1, 20);
    payload.writeUInt16BE(orientation, 24);
  }
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 34]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function visiblePhotoCorners(page) {
  const canvas = page.getByTestId('page-tile').first().locator('canvas');
  return canvas.evaluate(element => {
    if (!element.width || !element.height) return [];
    const ctx = element.getContext('2d');
    const width = element.width, height = element.height;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const red = data[i], green = data[i + 1], blue = data[i + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 70) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return [];
    const reference = [
      { name: 'R', rgb: [245, 20, 20] },
      { name: 'G', rgb: [20, 235, 35] },
      { name: 'B', rgb: [20, 70, 245] },
      { name: 'Y', rgb: [250, 235, 30] },
    ];
    return [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([u, v]) => {
      const x = Math.round(minX + (maxX - minX) * u);
      const y = Math.round(minY + (maxY - minY) * v);
      const i = (y * width + x) * 4;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      const choices = reference.map(target => ({
        name: target.name,
        distance: target.rgb.reduce((total, component, n) => total + Math.pow(component - rgb[n], 2), 0),
      })).sort((a, b) => a.distance - b.distance);
      return choices[0].name;
    });
  });
}

test('all eight EXIF orientations render actual PDF pages upright, including mirrored camera photos', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/image-to-pdf/');
  const source = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    const quadrants = [
      [0, 0, '#f51414'], [120, 0, '#14eb23'],
      [0, 80, '#1446f5'], [120, 80, '#faeb1e'],
    ];
    for (const [x, y, color] of quadrants) {
      ctx.fillStyle = color; ctx.fillRect(x, y, 120, 80);
    }
    return canvas.toDataURL('image/jpeg', .96).split(',')[1];
  }), 'base64');
  const expected = {
    1: 'RGBY', 2: 'GRYB', 3: 'YBGR', 4: 'BYRG',
    5: 'RBGY', 6: 'BRYG', 7: 'YGBR', 8: 'GYRB',
  };
  const writes = [];
  page.on('request', req => {
    if (!['GET', 'HEAD'].includes(req.method())) writes.push(req.method() + ' ' + req.url());
  });
  for (let orientation = 1; orientation <= 8; orientation++) {
    const jpeg = addExifOrientationToJpeg(source, orientation, orientation % 2 ? 'II' : 'MM');
    // XMP/IPTC/COM can contain private camera/GPS fields; none should be
    // embedded in the PDF's JPEG image XObject after orientation is read.
    const secret = Buffer.from('PM_GPS_PRIVATE_37.7749_-122.4194', 'ascii');
    const jpegWithSecrets = Buffer.concat([jpeg.subarray(0, 2),
      jpegTestSegment(0xe1, secret), jpegTestSegment(0xed, secret),
      jpegTestSegment(0xfe, secret), jpeg.subarray(2)]);
    await page.goto('/image-to-pdf/');
    await page.getByTestId('file-input').setInputFiles({
      name: 'phone-' + orientation + '.jpg',
      mimeType: orientation % 2 ? 'image/jpeg' : 'application/octet-stream',
      buffer: jpegWithSecrets,
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(1);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    // Strip private JPEG headers, but preserve the original entropy-coded
    // image data byte-for-byte, without a lossy canvas re-encode.
    const resources = pdf.context.lookup(pdf.getPage(0).node.Resources(), PDFDict);
    const xObjects = pdf.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
    const image = pdf.context.lookup(xObjects.get(xObjects.keys()[0]));
    const embedded = Buffer.from(image.getContents());
    expect(embedded.equals(source)).toBe(true);
    expect(embedded.includes(Buffer.from('PM_GPS_PRIVATE'))).toBe(false);
    expect(embedded.includes(Buffer.from('Exif'))).toBe(false);

    // Re-open the ACTUAL DOWNLOADED PDF and inspect PDF.js-rendered pixel colors.
    await page.goto('/workspace/');
    await page.getByTestId('file-input').setInputFiles({
      name: 'exported-' + orientation + '.pdf', mimeType: 'application/pdf', buffer: bytes,
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(1);
    // Thumbnails intentionally lazy-render only near the viewport. In a
    // multi-navigation EXIF loop the browser can restore a distant scroll
    // position; actively bring the preview into view before asserting pixels.
    // This does not bypass rendering: the exact downloaded PDF's corners
    // are still checked for all eight orientations.
    await page.getByTestId('page-tile').first().scrollIntoViewIfNeeded();
    let lastCorners = '';
    await expect.poll(async () => {
      lastCorners = (await visiblePhotoCorners(page)).join('');
      return lastCorners;
    }, { timeout: 15000, message: `EXIF ${orientation}: expected ${expected[orientation]}` })
      .toBe(expected[orientation]);
    // Release the imported preview PDF before moving to the next scenario.
    // Its image source has not itself been re-exported, so navigation would
    // correctly warn that this in-memory document would be discarded.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByTestId('confirm-clear').click();
  }
  expect(writes).toEqual([]);
});

function jpegTestSegment(marker, payload) {
  const size = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, size >>> 8, size & 255]), payload]);
}

test('deleting one entire source frees an active file slot without discarding Undo', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  const base = await makePdf([301]);
  await page.getByTestId('file-input').setInputFiles(Array.from({ length: 20 }, (_, i) => ({
    name: 'doc-' + i + '.pdf', mimeType: 'application/pdf', buffer: base,
  })));
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(19);
  await expect(page.getByText('from 19 files')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles({
    name: 'replacement.pdf', mimeType: 'application/pdf', buffer: await makePdf([511]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([...Array(19).fill(301), 511]);

  // Undo must still be able to restore the previously deleted original pages.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(19);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(20);
  await expect(page.getByText('from 20 files')).toBeVisible();
});


async function makeTestPng(page, width, height, color) {
  const base64 = await page.evaluate(({ width, height, color }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height, color });
  return Buffer.from(base64, 'base64');
}

test('image-to-PDF layout: A4 defaults, US Letter landscape and fit-to-image; reflow keeps reordered pages', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/image-to-pdf/');
  await expect(page.getByTestId('image-page-settings')).toBeVisible();
  await expect(page.getByTestId('image-paper')).toHaveValue('a4');
  await expect(page.getByTestId('image-orientation')).toHaveValue('portrait');
  await expect(page.getByTestId('image-margin')).toHaveValue('30');

  const one = await makeTestPng(page, 160, 90, 'red');
  const two = await makeTestPng(page, 90, 160, 'green');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'wide.png', mimeType: 'image/png', buffer: one },
    { name: 'tall.png', mimeType: 'image/png', buffer: two },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);

  const initial = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(initial.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]))
    .toEqual([[595, 842], [595, 842]]);

  await page.getByTestId('image-paper').selectOption('letter');
  await page.getByTestId('image-orientation').selectOption('landscape');
  await page.getByTestId('image-margin').selectOption('12');
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  // Importing again before applying must not silently mix letter/A4 page layouts.
  await page.getByTestId('file-input').setInputFiles({
    name: 'third.png', mimeType: 'image/png', buffer: one,
  });
  await expect(page.getByRole('alert')).toContainText('Apply updated page settings before adding');
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const letter = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(letter.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]))
    .toEqual([[792, 612], [792, 612]]);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('plainmile-2-files-images.pdf');

  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  await page.getByTestId('image-paper').selectOption('fit');
  // Fit should immediately follow the photo shape instead of reusing old landscape/portrait.
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('image-layout-apply').click();
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  const sizes = output.getPages().map(p => [p.getWidth(), p.getHeight()]);
  expect(sizes[0][0]).toBeCloseTo(67.5, 2);
  expect(sizes[0][1]).toBeCloseTo(120, 2);
  expect(sizes[1][0]).toBeCloseTo(120, 2);
  expect(sizes[1][1]).toBeCloseTo(67.5, 2);
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(undone.getPages()[0].getWidth()).toBeCloseTo(120, 2);
});

test('image layout before import, mixed PDF inputs and Chinese text labels are consistent', async ({ page }) => {
  await page.goto('/zh/image-to-pdf/');
  await expect(page.getByTestId('image-page-settings')).toContainText('图片页面设置');
  await page.getByTestId('image-paper').selectOption('fit');
  // Fit should immediately follow the photo shape instead of reusing old landscape/portrait.
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample-phone.png', mimeType: 'image/png',
    buffer: await makeTestPng(page, 240, 135, 'blue'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('sample-phone-images.pdf');
  const image = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(image.getPage(0).getWidth()).toBeCloseTo(180, 2);
  expect(image.getPage(0).getHeight()).toBeCloseTo(101.25, 2);

  await page.getByTestId('image-paper').selectOption('a4');
  await expect(page.getByTestId('image-layout-dirty')).toContainText('尚未应用');
  await page.getByTestId('image-layout-apply').click();
  const revised = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(revised.getPage(0).getWidth()).toBeCloseTo(841.89, 1);
});


test('fit-to-image cannot produce an arbitrarily portrait page from landscape photos', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-orientation')).toHaveValue('auto');
  await expect(page.getByTestId('image-orientation')).toBeDisabled();
  await expect(page.getByTestId('image-fit-orientation-hint')).toContainText('follows each photo shape');
  await page.getByTestId('image-margin').selectOption('0');
  await page.getByTestId('file-input').setInputFiles({
    name: 'landscape.png', mimeType: 'image/png',
    buffer: await makeTestPng(page, 400, 200, 'blue'),
  });
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPage(0).getWidth()).toBeCloseTo(300, 1);
  expect(output.getPage(0).getHeight()).toBeCloseTo(150, 1);
  await page.getByTestId('image-paper').selectOption('a4');
  await expect(page.getByTestId('image-orientation')).toBeEnabled();
  await page.getByTestId('image-orientation').selectOption('portrait');
  await page.getByTestId('image-layout-apply').click();
  const a4 = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(a4.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  expect(a4.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
});

test('Chinese fit-to-image explains automatic orientation and disabled controls', async ({ page }) => {
  await page.goto('/zh/image-to-pdf/');
  await page.getByTestId('image-paper').selectOption('fit');
  await expect(page.getByTestId('image-orientation')).toBeDisabled();
  await expect(page.getByTestId('image-fit-orientation-hint')).toContainText('自动匹配每张照片方向');
  await page.getByTestId('image-paper').selectOption('letter');
  await expect(page.getByTestId('image-orientation')).toBeEnabled();
});


test('oversized WebP header is rejected before canvas decode, while ordinary WebP still converts', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  // RIFF WEBP VP8X announces 10000x9000 pixels (90 MP) in just 30 bytes.
  const massive = Buffer.alloc(30);
  massive.write('RIFF', 0, 'ascii');
  massive.writeUInt32LE(22, 4);
  massive.write('WEBPVP8X', 8, 'ascii');
  massive.writeUInt32LE(10, 16);
  const widthMinusOne = 9999;
  const heightMinusOne = 8999;
  massive[24] = widthMinusOne & 255;
  massive[25] = (widthMinusOne >>> 8) & 255;
  massive[26] = (widthMinusOne >>> 16) & 255;
  massive[27] = heightMinusOne & 255;
  massive[28] = (heightMinusOne >>> 8) & 255;
  massive[29] = (heightMinusOne >>> 16) & 255;
  await page.getByTestId('file-input').setInputFiles({
    name: 'oversized.webp', mimeType: 'image/webp', buffer: massive,
  });
  await expect(page.getByRole('alert')).toContainText('Image dimensions are too large.');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);

  // Test a REAL WebP produced by Chromium, not only fake headers.
  const webpBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = 'purple';
    context.fillRect(0, 0, 64, 32);
    return canvas.toDataURL('image/webp', .87).split(',')[1];
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'legitimate.webp', mimeType: 'image/webp',
    buffer: Buffer.from(webpBase64, 'base64'),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
});

test('irreversible workspace reset has a cancellable confirmation and preserves edits until confirmed', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toContainText('undo history');
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('cancel-clear').click();
  await expect(page.getByTestId('clear-confirmation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('confirm-clear').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('clear-confirmation')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toHaveCount(0);
});

test('mobile Chinese clear confirmation preserves document when cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'private-synthetic.pdf', mimeType: 'application/pdf', buffer: await makePdf([301]),
  });
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByTestId('clear-confirmation')).toContainText('永久清除');
  await page.getByTestId('cancel-clear').click();
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(pdf.getPage(0).getWidth()).toBe(301);
});

test('duplicate nonadjacent selected pages and preserve exact exported order and Undo/Redo', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('checkbox', { name: 'Select page 3' }).check();
  await page.getByTestId('duplicate-pages').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300, 300, 310, 320, 320]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(redone.getPages().map(p => p.getWidth())).toEqual([300, 300, 310, 320, 320]);
});

test('insert blank after a rotated page matching its visible dimensions, without copying content', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('checkbox', { name: 'Select page 2' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(4);
  await expect(page.locator('.file-count')).toContainText('2 files');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPages().map(p => p.getWidth())).toEqual([300, 310, 420, 320]);
  expect(output.getPages().map(p => p.getRotation().angle)).toEqual([0, 90, 0, 0]);
  expect(output.getPage(2).getHeight()).toBe(310);
  expect(output.getPage(2).getRotation().angle).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(4);
});

test('no selection appends blank page; Chinese mobile disables ambiguous multi-selection insert', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 320]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([300, 320, 320]);
  await page.getByRole('checkbox', { name: '选择第 1 页' }).check();
  await page.getByRole('checkbox', { name: '选择第 2 页' }).check();
  await expect(page.getByTestId('insert-blank-page')).toBeDisabled();
  await expect(page.getByTestId('duplicate-pages')).toBeEnabled();
  await expect(page.getByTestId('blank-position-hint')).toContainText('最多选中一页');
});

test('duplicating at the 600-page workspace boundary fails safely and preserves document', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'synthetic-600-pages.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 600 }, () => 300)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(600, { timeout: 20000 });
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByTestId('duplicate-pages').click();
  await expect(page.getByRole('alert')).toContainText('600 pages');
  await expect(page.getByTestId('page-tile')).toHaveCount(600);
  await page.getByTestId('insert-blank-page').click();
  await expect(page.getByRole('alert')).toContainText('600 pages');
  await expect(page.getByTestId('page-tile')).toHaveCount(600);
});


test('photo paper reflow skips deleted Undo-only images until they are restored', async ({ page }) => {
  await page.goto('/image-to-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'old-deleted.png', mimeType: 'image/png', buffer: await makeTestPng(page, 120, 80, 'red') },
    { name: 'still-visible.png', mimeType: 'image/png', buffer: await makeTestPng(page, 80, 120, 'green') },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);

  await page.getByTestId('image-paper').selectOption('letter');
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const onePage = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(onePage.getPageCount()).toBe(1);
  expect(onePage.getPage(0).getWidth()).toBeCloseTo(612, 1);

  // Undo revives an image that was deliberately not re-encoded while hidden.
  // Warn before exporting or mixing A4 and Letter pages; no silent change.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('image-layout-dirty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  await page.getByTestId('image-layout-apply').click();
  await expect(page.getByTestId('image-layout-dirty')).toHaveCount(0);
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(restored.getPageCount()).toBe(2);
  expect(restored.getPages().map(p => Math.round(p.getWidth()))).toEqual([612, 612]);
});


test('expired 20-step Undo history frees deleted PDF bytes without affecting active export', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'expired.pdf', mimeType: 'application/pdf', buffer: await makePdf([300]) },
    { name: 'kept.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const retainedBytes = async () => Number(await page.locator('.file-count').getAttribute('data-retained-bytes'));
  const originalBytes = await retainedBytes();
  expect(originalBytes).toBeGreaterThan(0);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  // Removing a page is reversible, so the deleted source is initially retained.
  expect(await retainedBytes()).toBe(originalBytes);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  for (let step = 0; step < 21; step++) {
    await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  }
  // The old source is no longer reachable from any of the last 20 edits.
  await expect.poll(retainedBytes).toBeLessThan(originalBytes);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(1);
  expect(exported.getPage(0).getWidth()).toBeCloseTo(320, 1);
});


test('visual split previews create correct ZIP partitions and protect custom typed ranges', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'six.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303,304,305,306]),
  });
  await expect(page.locator('.file-count')).toContainText('6 pages');
  const panel = page.getByTestId('visual-split-panel');
  // Even a 600-page book must not mount 600 extra thumbnails before opening.
  await expect(page.getByTestId('visual-split-page')).toHaveCount(0);
  await panel.locator('summary').click();
  await expect(page.getByTestId('visual-split-page')).toHaveCount(6);
  const cut2 = page.locator('[data-testid="visual-split-cut"][data-after-page="2"]');
  const cut4 = page.locator('[data-testid="visual-split-cut"][data-after-page="4"]');
  await cut4.click();
  await cut2.click();
  const ranges = page.getByRole('textbox', { name: 'Page ranges', exact: true });
  await expect(ranges).toHaveValue('1-2, 3-4, 5-6');
  await expect(cut2).toHaveAttribute('aria-pressed', 'true');
  await expect(cut4).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('split-coverage-complete')).toContainText('6');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await pending).path()));
  expect(Object.keys(zip.files).sort()).toEqual([
    'part-01-pages-1-2.pdf', 'part-02-pages-3-4.pdf', 'part-03-pages-5-6.pdf',
  ]);
  for (const [name, widths] of [
    ['part-01-pages-1-2.pdf', [301,302]],
    ['part-02-pages-3-4.pdf', [303,304]],
    ['part-03-pages-5-6.pdf', [305,306]],
  ]) {
    const doc = await PDFDocument.load(await zip.file(name).async('uint8array'));
    expect(doc.getPages().map(p => p.getWidth())).toEqual(widths);
  }
  await cut4.click();
  await expect(ranges).toHaveValue('1-2, 3-6');
  await page.getByTestId('visual-split-clear').click();
  await expect(ranges).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeDisabled();

  // Manual partial / overlapping ranges must not be discarded by one click.
  await ranges.fill('2-4, 6');
  await cut2.click();
  await expect(page.getByTestId('visual-split-confirm')).toBeVisible();
  await expect(page.getByTestId('visual-split-confirm')).toBeFocused();
  await expect(ranges).toHaveValue('2-4, 6');
  await page.getByTestId('visual-split-keep').click();
  await expect(cut2).toBeFocused();
  await expect(ranges).toHaveValue('2-4, 6');
  await cut2.click();
  await page.getByTestId('visual-split-replace').click();
  await expect(cut2).toBeFocused();
  await expect(ranges).toHaveValue('1-2, 3-6');
  await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
});

test('visual cut indices use CURRENT reordered output pages, not source page numbers', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('page-tile').first().getByRole('button', { name: 'Move page 1 right' }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByTestId('visual-split-panel').locator('summary').click();
  await page.locator('[data-testid="visual-split-cut"][data-after-page="1"]').click();
  await expect(page.getByRole('textbox', { name: 'Page ranges', exact: true })).toHaveValue('1, 2-3');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click();
  const zip = await JSZip.loadAsync(await readFile(await (await pending).path()));
  const part1 = await PDFDocument.load(await zip.file('part-01-pages-1-1.pdf').async('uint8array'));
  const part2 = await PDFDocument.load(await zip.file('part-02-pages-2-3.pdf').async('uint8array'));
  expect(part1.getPages().map(p => p.getWidth())).toEqual([310]);
  expect(part2.getPages().map(p => p.getWidth())).toEqual([300,320]);
});

test('Chinese mobile visual split uses accessible buttons without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: '中文拆分.pdf', mimeType: 'application/pdf', buffer: await makePdf([300,310,320,330]),
  });
  await page.getByTestId('visual-split-panel').locator('summary').click();
  const button = page.getByRole('button', { name: '切换输出第 2 页后的拆分点' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: '页码范围' })).toHaveValue('1-2, 3-4');
  const size = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  expect(size.content).toBeLessThanOrEqual(size.visible + 2);
});

test('one split range downloads a real PDF directly, not a ZIP', async ({ page }) => {
  await loadInput(page);
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('2-3');
  await expect(page.locator('.split-estimate')).toContainText('1 PDF file(s)');
  const action = page.getByRole('button', { name: 'Download PDF' });
  await expect(action).toBeEnabled();
  const pending = page.waitForEvent('download');
  await action.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('plainmile-2-files-pages-2-3.pdf');
  const output = await PDFDocument.load(await readFile(await download.path()));
  expect(output.getPages().map((p) => p.getWidth())).toEqual([310, 320]);
  await expect(page.getByRole('status')).toContainText('No ZIP extraction needed');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2, 3');
  await expect(page.getByRole('button', { name: 'Download split PDFs (ZIP)' })).toBeEnabled();
});

test('full one-range split preserves the exact source bytes, but modified pages create a new PDF', async ({ page }) => {
  const original = await PDFDocument.create();
  original.setTitle('Original form and metadata');
  const sheet = original.addPage([320, 425]);
  const field = original.getForm().createTextField('recipient');
  field.setText('Alice');
  field.addToPage(sheet);
  original.addPage([330, 425]);
  const bytes = Buffer.from(await original.save());

  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('.file-count')).toContainText('2 pages');
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('1-2');
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect(Buffer.from(await readFile(await (await firstDownload).path())).equals(bytes)).toBe(true);

  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Rotate left' }).click();
  await page.getByRole('tab', { name: 'Split' }).click();
  const changedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const changed = Buffer.from(await readFile(await (await changedDownload).path()));
  expect(changed.equals(bytes)).toBe(false);
  const changedPdf = await PDFDocument.load(changed);
  expect(changedPdf.getPages().map(p => p.getRotation().angle)).toEqual([270, 270]);
});

test('Chinese single-result split by pages per PDF is a direct full PDF export', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'three.pdf', mimeType: 'application/pdf', buffer: await makePdf([301, 302, 303]) });
  // /split-pdf/ starts on the Split tab; thumbnails only exist on Organize.
  await expect(page.locator('.file-count')).toContainText('3 页');
  await page.getByRole('tab', { name: '拆分文件' }).click();
  await page.getByRole('radio', { name: '每 N 页拆分一次' }).check();
  await page.getByRole('spinbutton', { name: '每个 PDF 的页数' }).fill('3');
  const action = page.getByRole('button', { name: '下载 PDF' });
  await expect(action).toBeEnabled();
  const result = await downloadPdf(page, () => action.click());
  expect(result.getPages().map(p => p.getWidth())).toEqual([301, 302, 303]);
  await expect(page.getByRole('status')).toContainText('无需解压 ZIP');
});


test('two same-tick PDF drop batches cannot bypass 20-file workspace safety limit', async ({ page }) => {
  await page.goto('/workspace/');
  // Astro hydrates the React island asynchronously after the HTML navigation.
  await expect(page.getByTestId('dropzone')).toBeVisible();
  const pdfData = (await makePdf([307])).toString('base64');
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const zone = document.querySelector('[data-testid="dropzone"]');
    for (let batch = 0; batch < 2; batch++) {
      const dt = new DataTransfer();
      for (let n = 0; n < 12; n++) {
        dt.items.add(new File([bytes], `race-${batch}-${n}.pdf`, { type: 'application/pdf' }));
      }
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, pdfData);
  // A synchronous lock rejects the second batch before either asynchronous
  // read finishes; individually valid groups must not result in 24 sources.
  await expect(page.getByTestId('page-tile')).toHaveCount(12, { timeout: 30000 });
  await expect(page.locator('.file-count')).toContainText('from 12 files');
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(12);
  // Verify the real file cap still applies to later, sequential imports.
  await page.getByTestId('file-input').setInputFiles(Array.from({ length: 9 }, (_, n) => ({
    name: `too-many-${n}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(pdfData, 'base64'),
  })));
  await expect(page.getByRole('alert')).toContainText('at most 20 files');
  await expect(page.getByTestId('page-tile')).toHaveCount(12);
});

test('optional custom PDF filename follows safe preview and resets without changing PDF pages', async ({ page }) => {
  await loadInput(page);
  await page.getByTestId('download-name-panel').locator('summary').click();
  const filenameInput = page.getByTestId('download-name-input');
  await filenameInput.fill('  ../Client Review 2026.pdf  ');
  await expect(page.getByTestId('workspace-export-filename')).toContainText('Client-Review-2026.pdf');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const named = await pending;
  expect(named.suggestedFilename()).toBe('Client-Review-2026.pdf');
  const doc = await PDFDocument.load(await readFile(await named.path()));
  expect(doc.getPages().map(p => p.getWidth())).toEqual([300,310,320]);
  await page.getByRole('button', { name: 'Use suggested name' }).click();
  await expect(page.getByTestId('workspace-export-filename')).toContainText('plainmile-2-files-organized.pdf');
  await filenameInput.fill('??...///');
  await expect(page.getByTestId('workspace-export-filename')).toContainText('plainmile-2-files-organized.pdf');
});

test('Chinese custom download name affects split ZIP but does not change page identity', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'pages.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303]) });
  await expect(page.locator('.file-count')).toContainText('3 页');
  await page.getByTestId('download-name-panel').locator('summary').click();
  await page.getByTestId('download-name-input').fill('客户报告.pdf');
  await expect(page.getByTestId('workspace-export-filename')).toContainText('客户报告.pdf');
  await page.getByRole('textbox', { name: '页码范围' }).fill('1, 2-3');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载拆分文件（ZIP）' }).click();
  const dl = await pending;
  expect(dl.suggestedFilename()).toBe('客户报告-split.zip');
  const zip = await JSZip.loadAsync(await readFile(await dl.path()));
  expect(Object.keys(zip.files).sort()).toEqual(['part-01-pages-1-1.pdf','part-02-pages-2-3.pdf']);
  const first = await PDFDocument.load(await zip.file('part-01-pages-1-1.pdf').async('uint8array'));
  const second = await PDFDocument.load(await zip.file('part-02-pages-2-3.pdf').async('uint8array'));
  expect(first.getPage(0).getWidth()).toBe(301);
  expect(second.getPages().map(p => p.getWidth())).toEqual([302,303]);
});

async function makeChapterBookmarkPdf(pageWidths, chapters) {
  const source = await PDFDocument.create();
  const refs = pageWidths.map(width => source.addPage([width, 420]).ref);
  const outline = source.context.obj({ Type: PDFName.of('Outlines'), Count: chapters.length });
  const rootRef = source.context.register(outline);
  const links = chapters.map(([title, pageIndex]) => {
    const item = source.context.obj({
      Title: PDFHexString.fromText(title), Parent: rootRef,
      Dest: [refs[pageIndex], PDFName.of('Fit')],
    });
    return { item, ref: source.context.register(item) };
  });
  links.forEach(({ item }, i) => {
    if (i > 0) item.set(PDFName.of('Prev'), links[i - 1].ref);
    if (i + 1 < links.length) item.set(PDFName.of('Next'), links[i + 1].ref);
  });
  outline.set(PDFName.of('First'), links[0].ref);
  outline.set(PDFName.of('Last'), links.at(-1).ref);
  source.catalog.set(PDFName.of('Outlines'), rootRef);
  return Buffer.from(await source.save());
}

// Construct a genuine PDF outline tree (not a mocked getOutline response),
// including duplicate names, a Windows reserved device title, Unicode and a
// path-like title. Child Count/First/Last links make PDF.js resolve levels 2/3.
async function makeNestedChapterBookmarkPdf() {
  const source = await PDFDocument.create();
  const pageRefs = Array.from({ length: 12 }, (_, index) =>
    source.addPage([300 + index, 420]).ref);
  const root = source.context.obj({ Type: PDFName.of('Outlines'), Count: 3 });
  const rootRef = source.context.register(root);
  const addChildren = (parentRef, nodes) => {
    if (!nodes.length) return;
    const children = nodes.map(node => {
      const item = source.context.obj({
        Title: PDFHexString.fromText(node.title), Parent: parentRef,
        Dest: [pageRefs[node.page], PDFName.of('Fit')],
        ...(node.children?.length ? { Count: node.children.length } : {}),
      });
      return { node, item, ref: source.context.register(item) };
    });
    children.forEach(({ item }, i) => {
      if (i) item.set(PDFName.of('Prev'), children[i - 1].ref);
      if (i + 1 < children.length) item.set(PDFName.of('Next'), children[i + 1].ref);
    });
    const parent = source.context.lookup(parentRef);
    parent.set(PDFName.of('First'), children[0].ref);
    parent.set(PDFName.of('Last'), children.at(-1).ref);
    for (const { node, ref } of children) addChildren(ref, node.children ?? []);
  };
  addChildren(rootRef, [
    { title: 'Intro', page: 0 },
    { title: 'Chapter One', page: 2, children: [
      { title: 'Part A', page: 2, children: [
        { title: 'A.1', page: 3 }, { title: 'A.2', page: 4 },
      ] },
      { title: 'CON', page: 4 }, { title: 'Part A', page: 6 },
    ] },
    { title: 'Chapter Two', page: 8, children: [
      { title: '附录 / 2', page: 8 },
      { title: '../', page: 10, children: [{ title: 'B.1', page: 10 }] },
    ] },
  ]);
  source.catalog.set(PDFName.of('Outlines'), rootRef);
  return Buffer.from(await source.save());
}

test('nested PDF chapter levels produce exact PDFs with optional safe, unique ZIP names', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'nested-outline.pdf', mimeType: 'application/pdf',
    buffer: await makeNestedChapterBookmarkPdf(),
  });
  await expect(page.locator('.file-count')).toContainText('12 pages');
  await page.getByTestId('split-bookmark-panel').locator('summary').click();

  await expect(page.getByTestId('bookmark-level')).toHaveValue('1');
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-preview')).toContainText('level 1');
  await expect(page.getByTestId('bookmark-ranges-preview')).toContainText('1-2, 3-8, 9-12');

  await page.getByTestId('bookmark-level').selectOption('2');
  await expect(page.getByTestId('bookmark-preview')).toHaveCount(0);
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-preview')).toContainText('level 2');
  await expect(page.getByTestId('bookmark-ranges-preview')).toContainText('1-2, 3-4, 5-6, 7-8, 9-10, 11-12');
  await page.getByTestId('bookmark-apply').click();
  await expect(page.locator('#ranges-input')).toHaveValue('1-2, 3-4, 5-6, 7-8, 9-10, 11-12');
  await expect(page.getByTestId('bookmark-use-titles')).not.toBeChecked();

  // Backward-compatible default: no bookmark text in downloaded ZIP names.
  const ordinary = await captured(page, () => page.locator('.split-download').click());
  const ordinaryZip = await JSZip.loadAsync(ordinary.bytes);
  expect(Object.keys(ordinaryZip.files)).toContain('part-03-pages-5-6.pdf');
  expect(Object.keys(ordinaryZip.files).every(name => !name.includes('CON'))).toBe(true);
  const ordinaryPart = await PDFDocument.load(await ordinaryZip.file('part-03-pages-5-6.pdf').async('uint8array'));
  expect(ordinaryPart.getPages().map(p => p.getWidth())).toEqual([304, 305]);

  await page.getByTestId('bookmark-use-titles').check();
  const names = [
    'part-01-pages-1-2.pdf', 'part-02-Part-A-pages-3-4.pdf',
    'part-03-plainmile-CON-pages-5-6.pdf', 'part-04-Part-A-pages-7-8.pdf',
    'part-05-附录-2-pages-9-10.pdf', 'part-06-pages-11-12.pdf',
  ];
  await expect(page.getByTestId('bookmark-zip-names')).toContainText(names[2]);
  const named = await captured(page, () => page.locator('.split-download').click());
  const zip = await JSZip.loadAsync(named.bytes);
  expect(Object.keys(zip.files).sort()).toEqual([...names].sort());
  for (let index = 0; index < names.length; index++) {
    const pdf = await PDFDocument.load(await zip.file(names[index]).async('uint8array'));
    expect(pdf.getPages().map(p => p.getWidth())).toEqual([300 + index * 2, 301 + index * 2]);
  }

  // Manual changes must lose the auto-derived names even if the source PDF
  // and the previous bookmark scan are still present in this tab.
  await page.locator('#ranges-input').fill('1-2, 3-12');
  await expect(page.getByTestId('bookmark-use-titles')).toHaveCount(0);
  const manual = await captured(page, () => page.locator('.split-download').click());
  const manualZip = await JSZip.loadAsync(manual.bytes);
  expect(Object.keys(manualZip.files).sort()).toEqual([
    'part-01-pages-1-2.pdf', 'part-02-pages-3-12.pdf',
  ]);

  // Level 3 draws only from exact grandchildren, never from parent levels.
  await page.getByTestId('bookmark-level').selectOption('3');
  await expect(page.getByTestId('bookmark-preview')).toHaveCount(0);
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-preview')).toContainText('level 3');
  await expect(page.getByTestId('bookmark-ranges-preview')).toContainText('1-3, 4, 5-10, 11-12');
  await page.getByTestId('bookmark-apply').click();
  await expect(page.getByTestId('bookmark-confirm')).toBeFocused();
  await page.getByTestId('bookmark-confirm-replace').click();
  await expect(page.locator('#ranges-input')).toHaveValue('1-3, 4, 5-10, 11-12');
  await expect(page.getByTestId('bookmark-use-titles')).not.toBeChecked();

  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByTestId('reverse-all-pages').click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByTestId('bookmark-use-titles')).toHaveCount(0);
  await expect(page.getByTestId('bookmark-scan')).toBeDisabled();
});

test('Chinese mobile bookmark level reports absent subchapters without overwriting ranges', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  const source = await makeChapterBookmarkPdf([300, 301, 302, 303], [
    ['章节 1', 0], ['章节 2', 2],
  ]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'one-level.pdf', mimeType: 'application/pdf', buffer: source,
  });
  await page.getByTestId('split-bookmark-panel').locator('summary').click();
  await page.locator('#ranges-input').fill('2-3');
  await page.getByTestId('bookmark-level').selectOption('3');
  await page.getByTestId('bookmark-scan').click();
  await expect(page.locator('.notice-error')).toContainText('所选书签层级没有可用的章节拆分点');
  await expect(page.locator('#ranges-input')).toHaveValue('2-3');
  await expect(page.getByTestId('bookmark-apply')).toHaveCount(0);
  await page.getByTestId('bookmark-level').selectOption('1');
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-preview')).toContainText('第 1 级书签');
  await page.getByTestId('bookmark-apply').click();
  await expect(page.getByTestId('bookmark-confirm')).toBeFocused();
  await page.getByTestId('bookmark-keep').click();
  await expect(page.locator('#ranges-input')).toHaveValue('2-3');
});

test('bookmark split reads actual PDF outline, preserves manual ranges and exports correct chapters', async ({ page }) => {
  const book = await makeChapterBookmarkPdf(
    [300, 301, 302, 303, 304, 305, 306, 307, 308],
    [['Intro', 0], ['Chapter One', 3], ['Appendix', 6], ['Duplicate destination', 6]],
  );
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'chapter-book.pdf', mimeType: 'application/pdf', buffer: book,
  });
  await expect(page.locator('.file-count')).toContainText('9 pages');
  await expect(page.locator('.split-intro')).toContainText('chapter bookmarks');
  await page.getByTestId('split-bookmark-panel').locator('summary').click();
  await expect(page.getByTestId('bookmark-scan')).toBeEnabled();
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-preview')).toContainText('3 output ranges');
  await expect(page.getByTestId('bookmark-preview')).toContainText('ignored 0');
  await expect(page.getByTestId('bookmark-ranges-preview')).toContainText('1-3, 4-6, 7-9');
  await expect(page.getByTestId('split-bookmark-panel')).toContainText('Chapter One');

  await page.locator('#ranges-input').fill('1-2, 3-9');
  await page.getByTestId('bookmark-apply').click();
  await expect(page.getByTestId('bookmark-confirm')).toBeVisible();
  await page.getByTestId('bookmark-keep').click();
  await expect(page.locator('#ranges-input')).toHaveValue('1-2, 3-9');
  await page.getByTestId('bookmark-apply').click();
  await page.getByTestId('bookmark-confirm-replace').click();
  await expect(page.locator('#ranges-input')).toHaveValue('1-3, 4-6, 7-9');
  await expect(page.getByTestId('split-output-preview')).toContainText('3');
  await expect(page.getByTestId('split-coverage-complete')).toContainText('9 total');

  const saved = await captured(page, () => page.locator('.split-download').click());
  expect(saved.name).toBe('chapter-book-split.zip');
  const zip = await JSZip.loadAsync(saved.bytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual([
    'part-01-pages-1-3.pdf', 'part-02-pages-4-6.pdf', 'part-03-pages-7-9.pdf',
  ]);
  for (let index = 0; index < names.length; index++) {
    const pdf = await PDFDocument.load(await zip.file(names[index]).async('uint8array'));
    expect(pdf.getPages().map(p => p.getWidth())).toEqual(
      [300 + index * 3, 301 + index * 3, 302 + index * 3],
    );
  }
  // Bookmarks identify ORIGINAL page positions, so after reorder a suggestion
  // would be wrong. Do not allow a stale, already-scanned plan to be reused.
  await page.getByRole('tab', { name: 'Organize' }).click();
  await page.getByTestId('reverse-all-pages').click();
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByTestId('split-bookmark-panel').locator('summary').click();
  await expect(page.getByTestId('bookmark-scan')).toBeDisabled();
  await expect(page.getByTestId('bookmark-preview')).toHaveCount(0);
});

test('bookmark overwrite confirmation is invalidated by newer edits or mode switches and preserves focus', async ({ page }) => {
  const chapterPdf = await makeChapterBookmarkPdf(
    [300, 301, 302, 303, 304, 305],
    [['Intro', 0], ['Chapter One', 2], ['Chapter Two', 4]],
  );
  await page.goto('/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'replace-safe.pdf', mimeType: 'application/pdf', buffer: chapterPdf,
  });
  await expect(page.locator('.file-count')).toContainText('6 pages');
  await page.getByTestId('split-bookmark-panel').locator('summary').click();
  await page.getByTestId('bookmark-scan').click();
  await expect(page.getByTestId('bookmark-ranges-preview')).toContainText('1-2, 3-4, 5-6');

  const ranges = page.locator('#ranges-input');
  const confirm = page.getByTestId('bookmark-confirm');
  await ranges.fill('1-2, 3-6');
  await page.getByTestId('bookmark-apply').click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();

  // The user edits the custom plan AFTER the previous confirmation appeared.
  // That confirmation must not remain armed for a different set of ranges.
  await ranges.fill('1-4, 5-6');
  await expect(confirm).toHaveCount(0);
  await expect(ranges).toHaveValue('1-4, 5-6');

  await page.getByTestId('bookmark-apply').click();
  await expect(confirm).toBeFocused();
  await page.getByTestId('bookmark-keep').click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('bookmark-apply')).toBeFocused();
  await expect(ranges).toHaveValue('1-4, 5-6');

  // Switching method must cancel an old confirmation too. Returning to
  // manual ranges requires a fresh consent to overwrite the user's text.
  await page.getByTestId('bookmark-apply').click();
  await expect(confirm).toBeVisible();
  await page.locator('input[name="split-method"]').nth(1).check();
  await expect(confirm).toHaveCount(0);
  await expect(ranges).toHaveValue('1-4, 5-6');
  await page.locator('input[name="split-method"]').first().check();
  await page.getByTestId('bookmark-apply').click();
  await expect(confirm).toBeFocused();
  await page.getByTestId('bookmark-confirm-replace').click();
  await expect(ranges).toHaveValue('1-2, 3-4, 5-6');
  await expect(ranges).toBeFocused();
});

test('bookmark split clearly handles no outline and provides Chinese local guidance', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'no-outline.pdf', mimeType: 'application/pdf',
    buffer: await makePdf([300, 301, 302]),
  });
  await expect(page.locator('.file-count')).toContainText('3 页');
  await expect(page.locator('.split-intro')).toContainText('章节书签');
  await page.getByTestId('split-bookmark-panel').locator('summary').click();
  await expect(page.getByTestId('bookmark-scan')).toBeDisabled();
  await expect(page.getByTestId('bookmark-availability')).toContainText('需要一份含内置书签');
  await page.getByTestId('file-input').setInputFiles({
    name: 'chapters.pdf', mimeType: 'application/pdf',
    buffer: await makeChapterBookmarkPdf([320, 321], [['Only', 0], ['Second', 1]]),
  });
  // Multiple active PDFs: no chance to interpret one file's bookmark pages
  // as the current concatenated output positions.
  await expect(page.getByTestId('bookmark-scan')).toBeDisabled();
  const dims = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
  }));
  expect(dims.content).toBeLessThanOrEqual(dims.viewport + 2);
});

test('untouched PDF keeps bookmarks; edited PDF warns when chapter navigation is lost', async ({ page }) => {
  const source = await PDFDocument.create();
  const first = source.addPage([430, 600]);
  source.addPage([440, 600]);
  const outline = source.context.obj({ Type: PDFName.of('Outlines'), Count: 1 });
  const rootRef = source.context.register(outline);
  const item = source.context.obj({
    Title: PDFHexString.fromText('Chapter 1'),
    Parent: rootRef,
    Dest: [first.ref, PDFName.of('Fit')],
  });
  const childRef = source.context.register(item);
  outline.set(PDFName.of('First'), childRef);
  outline.set(PDFName.of('Last'), childRef);
  source.catalog.set(PDFName.of('Outlines'), rootRef);
  const bytes = Buffer.from(await source.save());

  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('workspace-bookmark-risk')).toContainText('Document bookmarks detected in 1 PDF');
  await expect(page.getByTestId('workspace-bookmark-risk')).toContainText('clickable table of contents');
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(2);
  expect(exported.catalog.get(PDFName.of('Outlines'))).toBeDefined();

  // Any page modification forces a newly composed PDF; outlines are document-level.
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Rotate left' }).click();
  const rotated = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(rotated.getPageCount()).toBe(2);
  expect(rotated.catalog.get(PDFName.of('Outlines'))).toBeUndefined();

  // Warning is tied to the active source pages, not stale Undo-only data.
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await expect(page.getByTestId('workspace-bookmark-risk')).toHaveCount(0);
  await page.getByTestId('undo-all-deleted').click();
  await expect(page.getByTestId('workspace-bookmark-risk')).toContainText('Document bookmarks');

  await page.goto('/zh/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('workspace-bookmark-risk')).toContainText('目录书签');
  await expect(page.getByTestId('workspace-bookmark-risk')).toContainText('核对导出结果');
});

test('genuine interactive PDF form triggers specific risk warning before page-copy export', async ({ page }) => {
  const src = await PDFDocument.create();
  const canvas = src.addPage([420, 595]);
  const field = src.getForm().createTextField('customer.name');
  field.setText('Filled original');
  field.addToPage(canvas);
  const bytes = Buffer.from(await src.save());
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'interactive-form.pdf', mimeType: 'application/pdf', buffer: bytes,
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('workspace-document-caution')).toBeVisible();
  await expect(page.getByTestId('workspace-form-risk')).toContainText('Interactive form fields detected in 1 PDF');
  await expect(page.getByTestId('workspace-form-risk')).toContainText('fillable fields');
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(1);
  const original = await PDFDocument.load(bytes);
  expect(original.getForm().getFields().length).toBe(1);
  // We do not claim copied forms or signatures survive into another document.
});

test('Chinese form-risk warning appears on focused page tools but plain PDFs stay quiet', async ({ page }) => {
  const doc = await PDFDocument.create();
  const p = doc.addPage([450, 600]);
  const field = doc.getForm().createCheckBox('consent');
  field.addToPage(p);
  await page.goto('/zh/delete-pages/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'checkbox.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()),
  });
  await expect(page.getByTestId('workspace-form-risk')).toContainText('含交互表单字段');
  await expect(page.getByTestId('workspace-form-risk')).toContainText('数字签名');
  await page.getByRole('button', { name: '清空' }).click();
  await expect(page.getByTestId('clear-confirmation')).toBeVisible();
  await page.getByTestId('confirm-clear').click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'ordinary.pdf', mimeType: 'application/pdf', buffer: await makePdf([450, 500]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('workspace-form-risk')).toHaveCount(0);
});

test('book-length jump targets the true output position without reordering or changing selections', async ({ page }) => {
  test.setTimeout(70000);
  const book = await makePdf(Array.from({length: 125}, (_, index) => 300 + index));
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'long-book.pdf', mimeType: 'application/pdf', buffer: book,
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(125);
  await page.getByRole('checkbox', { name: 'Select page 2', exact: true }).check();
  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group')).toHaveCount(1);
  await page.getByTestId('page-jump-panel').locator('summary').click();
  await page.getByTestId('page-jump-input').fill('１２１');
  await page.getByTestId('page-jump-submit').click();
  await expect(page.getByTestId('workspace-view-order')).toHaveAttribute('aria-pressed', 'true');
  const target = page.locator('[data-testid="page-grid"] [data-export-position="121"]');
  await expect(target).toBeInViewport({ timeout: 15000 });
  await expect(target).toHaveAttribute('aria-label', 'Output page 121');
  await expect(page.getByRole('checkbox', { name: 'Select page 2', exact: true })).toBeChecked();
  const exported = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(exported.getPageCount()).toBe(125);
  expect(exported.getPage(120).getWidth()).toBe(420);
  expect(exported.getPage(1).getWidth()).toBe(301);
});

test('invalid Chinese jump never alters page selection or causes mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'many-pages.pdf', mimeType: 'application/pdf', buffer: await makePdf(Array.from({ length: 24 }, (_, n) => 280 + n)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(24);
  await page.getByTestId('page-jump-panel').locator('summary').click();
  await page.getByTestId('page-jump-input').fill('99');
  await page.getByTestId('page-jump-submit').click();
  await expect(page.getByRole('alert')).toContainText('1 到 24');
  await page.getByTestId('page-jump-input').fill('２３');
  await page.getByTestId('page-jump-submit').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-testid="page-grid"] [data-export-position="23"]')).toBeInViewport();
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.viewport + 2);
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(pdf.getPages().map(p => p.getWidth())).toEqual(Array.from({ length: 24 }, (_, n) => 280 + n));
});

/** Pixel-level export regression: metadata-only checks cannot detect a shifted
 * CropBox origin, blanked stream, missing graphics, mirrored page or wrong
 * rotation. Render the same PDF with the actual browser PDF.js worker before
 * export and after the exported file is reopened. No golden files or network.
 */
async function renderedPageTilePng(page, index) {
  const tile = page.getByTestId('page-grid').getByTestId('page-tile').nth(index);
  // IntersectionObserver watches the *preview*, not the outer tile. A tile
  // can be "in view" while its preview is still below the lazy-load threshold.
  await tile.locator('.page-preview').scrollIntoViewIfNeeded();
  const canvas = tile.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await expect.poll(() => canvas.evaluate(node => {
    if (!node.width || !node.height) return 0;
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let coloredPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 0 &&
          (pixels[offset] < 235 || pixels[offset + 1] < 235 || pixels[offset + 2] < 235)) coloredPixels++;
    }
    // A white-but-fully-rendered blank page must NOT qualify as fidelity.
    return coloredPixels;
  }), { timeout: 20000 }).toBeGreaterThan(100);
  // Wait one frame to ensure the worker's canvas render has completed.
  await page.waitForTimeout(80);
  return canvas.evaluate(node => ({
    width: node.width,
    height: node.height,
    png: node.toDataURL('image/png'),
  }));
}

test('mixed paper, native page rotations and shifted CropBoxes preserve exact rendered pixels across export and split', async ({ page }) => {
  test.setTimeout(110000);
  // This test measures PDF.js visual fidelity, not IntersectionObserver
  // virtualization (which has separate 1x/2x DPR regression coverage). Force
  // the five source thumbnails to render even if the CI viewport is small.
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(target) {
        queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
      }
      unobserve() {}
      disconnect() {}
    };
  });
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const inputRotations = [0, 90, 180, 270];
  for (let index = 0; index < 4; index++) {
    const sheet = source.addPage([475 + index * 43, 620 + index * 27]);
    const left = 24 + index * 4, bottom = 42 + index * 3;
    sheet.setCropBox(left, bottom, 340 + index * 12, 465 + index * 14);
    sheet.setRotation(degrees(inputRotations[index]));
    // Opaque colored objects at asymmetric positions reveal shifts, mirrors,
    // clipping, and unexpected blank-page exports in the actual PDF view.
    sheet.drawRectangle({ x: left + 3, y: bottom + 9, width: 48, height: 70, color: rgb(0.15, 0.4, 0.8) });
    sheet.drawRectangle({ x: left + 151, y: bottom + 263, width: 81, height: 25, color: rgb(0.8, 0.24, 0.13) });
    sheet.drawText('PAGE CROP ' + (index + 1), { x: left + 85, y: bottom + 164, size: 19, font });
  }
  const second = await PDFDocument.create();
  const landscape = second.addPage([792, 612]);
  landscape.setCropBox(45, 32, 680, 480);
  landscape.drawRectangle({ x: 62, y: 73, width: 208, height: 102, color: rgb(0.12, 0.7, 0.3) });
  landscape.drawText('LANDSCAPE SOURCE', { x: 118, y: 280, size: 23, font: await second.embedFont(StandardFonts.Helvetica) });

  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'native-rotations.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) },
    { name: 'different-paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await second.save()) },
  ]);
  await expect(page.getByTestId('page-grid').getByTestId('page-tile')).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Select page 1' }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await page.getByRole('checkbox', { name: 'Select page 1' }).uncheck();
  await page.getByRole('checkbox', { name: 'Select page 4' }).check();
  await page.getByRole('button', { name: 'Rotate left' }).click();
  await page.getByRole('checkbox', { name: 'Select page 4' }).uncheck();
  await page.getByRole('button', { name: 'Move page 5 left' }).click();
  await page.getByRole('button', { name: 'Move page 4 left' }).click();

  const before = [];
  for (let index = 0; index < 5; index++) before.push(await renderedPageTilePng(page, index));

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const dl = await pending;
  const completeBytes = await readFile(await dl.path());
  const complete = await PDFDocument.load(completeBytes);
  expect(complete.getPageCount()).toBe(5);
  expect(complete.getPages().map(p => p.getRotation().angle)).toEqual([90, 90, 0, 180, 180]);
  const firstCrop = complete.getPage(0).getCropBox();
  expect(firstCrop).toMatchObject({ x: 24, y: 42, width: 340, height: 465 });
  const thirdCrop = complete.getPage(2).getCropBox();
  expect(thirdCrop).toMatchObject({ x: 45, y: 32, width: 680, height: 480 });

  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'exported-reopened.pdf', mimeType: 'application/pdf', buffer: completeBytes,
  });
  await expect(page.getByTestId('page-grid').getByTestId('page-tile')).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    expect(await renderedPageTilePng(page, index), 'visual parity at output page ' + (index + 1)).toEqual(before[index]);
  }

  // Split uses a separate front-end path but the same export engine.
  await page.getByRole('tab', { name: 'Split' }).click();
  await page.getByRole('textbox', { name: 'Page ranges', exact: true }).fill('2-4');
  const splitEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const splitFile = await splitEvent;
  const splitBytes = await readFile(await splitFile.path());
  expect((await PDFDocument.load(splitBytes)).getPageCount()).toBe(3);
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'split-reopened.pdf', mimeType: 'application/pdf', buffer: splitBytes,
  });
  await expect(page.getByTestId('page-grid').getByTestId('page-tile')).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    expect(await renderedPageTilePng(page, index), 'visual parity at split page ' + (index + 1)).toEqual(before[index + 1]);
  }
});

test('125-page document moves selected nonconsecutive pages before page 100 and preserves Undo/Redo and actual PDF order', async ({ page }) => {
  test.setTimeout(85000);
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'technical-book.pdf', mimeType: 'application/pdf',
    buffer: await makePdf(Array.from({ length: 125 }, (_, n) => 300 + n)),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(125);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('2-4, 8');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toContainText('4 pages selected');
  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('workspace-view-grouped')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('move-position-panel').locator('summary').click();
  await page.getByTestId('move-target-input').fill('１００');
  await page.getByTestId('move-position-side').selectOption('before');
  await page.getByTestId('move-position-submit').click();
  await expect(page.getByTestId('workspace-view-order')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selection-info strong')).toContainText('4 pages selected');
  const movedFirst = page.locator('[data-testid="page-grid"] [data-export-position="96"]');
  await expect(movedFirst).toBeInViewport({ timeout: 15000 });
  await expect(movedFirst).toHaveAttribute('data-original-page', '2');
  for (const [position, original] of [[97,3],[98,4],[99,8],[100,100]]) {
    await expect(page.locator(`[data-testid="page-grid"] [data-export-position="${position}"]`)).toHaveAttribute('data-original-page', String(original));
  }
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('page-grid').getByTestId('page-tile').nth(1)).toHaveAttribute('data-original-page', '2');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('[data-testid="page-grid"] [data-export-position="96"]')).toHaveAttribute('data-original-page', '2');
  const output = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(output.getPageCount()).toBe(125);
  expect(output.getPages().slice(95,100).map(pdf => pdf.getWidth())).toEqual([301,302,303,307,399]);
  expect(output.getPage(0).getWidth()).toBe(300);
});

test('Chinese mobile exact insertion rejects selected destination, then moves pages after current export page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'small-book.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303,304,305,306,307]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(7);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('3, 5');
  await page.getByTestId('selection-range-apply').click();
  await page.getByTestId('move-position-panel').locator('summary').click();
  await page.getByTestId('move-target-input').fill('３');
  await page.getByTestId('move-position-submit').click();
  await expect(page.getByRole('alert')).toContainText('目标页也处于选中状态');
  await expect(page.locator('.selection-info strong')).toContainText('2 页已选中');
  await page.getByTestId('move-target-input').fill('６');
  await page.getByTestId('move-position-side').selectOption('after');
  await page.getByTestId('move-position-submit').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.selection-info strong')).toContainText('2 页已选中');
  const saved = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(saved.getPages().map(pdf => pdf.getWidth())).toEqual([301,302,304,306,303,305,307]);
  const viewport = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
  }));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.client + 2);
});

test('moving pages preserves chosen page IDs but clears stale Shift-range anchors', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'book.pdf', mimeType: 'application/pdf',
    buffer: await makePdf([301,302,303,304,305,306]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByRole('checkbox', { name: 'Select page 2', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select page 4', exact: true }).check();
  await page.getByTestId('move-position-panel').locator('summary').click();
  await page.getByTestId('move-target-input').fill('6');
  await page.getByTestId('move-position-submit').click();
  await expect(page.locator('.selection-info strong')).toContainText('2 pages selected');
  await expect(page.getByRole('status')).toContainText('before the previous output page 6');
  // The last clicked page before the move was output position 4. Reusing
  // that old anchor here incorrectly selects pages 1-4, not just page 1.
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-info strong')).toContainText('3 pages selected');
  const saved = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(saved.getPages().map(p => p.getWidth())).toEqual([301,303,305,302,304,306]);
});


test('larger one-page preview follows original crop/rotation, uses bounded bitmap, and never edits output', async ({ page }) => {
  test.setTimeout(50000);
  const first = await PDFDocument.create();
  const font = await first.embedFont(StandardFonts.Helvetica);
  const cover = first.addPage([430, 610]);
  cover.drawRectangle({ x: 44, y: 85, width: 130, height: 125, color: rgb(.1, .5, .85) });
  cover.drawText('First inspection page', { x: 35, y: 300, font, size: 19 });
  const turned = first.addPage([430, 610]);
  turned.setCropBox(20, 40, 345, 480);
  turned.setRotation(degrees(90));
  turned.drawRectangle({ x: 40, y: 63, width: 180, height: 90, color: rgb(.85, .2, .12) });
  turned.drawText('ROTATED DETAILS', { x: 50, y: 300, font, size: 18 });
  const second = await PDFDocument.create();
  const landscape = second.addPage([750, 475]);
  landscape.drawRectangle({ x: 30, y: 50, width: 290, height: 170, color: rgb(.1, .7, .2) });
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'invoice-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await first.save()) },
    { name: 'landscape-source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await second.save()) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  const tile = page.getByTestId('page-tile').nth(1);
  const openingButton = tile.getByTestId('page-preview-open');
  await expect(openingButton).toHaveAttribute('aria-label', 'Enlarge output page 2');
  await openingButton.click();
  const dialog = page.getByTestId('page-zoom-dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toContainText('Output page 2 of 3');
  await expect(dialog).toContainText('invoice-source.pdf');
  const canvas = page.getByTestId('page-zoom-canvas');
  await expect(canvas).toHaveCSS('visibility', 'visible', { timeout: 25000 });
  const original = await canvas.evaluate(el => {
    const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    let colored = 0;
    for (let n = 0; n < pixels.length; n += 4) {
      if (pixels[n] < 225 || pixels[n + 1] < 225 || pixels[n + 2] < 225) colored++;
    }
    return { width: el.width, height: el.height, colored };
  });
  expect(original.width).toBeGreaterThan(original.height); // Native 90-degree CropBox rotation.
  expect(original.colored).toBeGreaterThan(200);
  expect(original.width * original.height).toBeLessThanOrEqual(8_000_000);
  await page.getByTestId('page-zoom-in').click();
  await expect(page.getByTestId('page-zoom-reset')).toHaveText('150%');
  await expect(canvas).toHaveCSS('visibility', 'visible', { timeout: 25000 });
  const zoomed = await canvas.evaluate(el => ({ width: el.width, height: el.height }));
  expect(zoomed.width).toBeGreaterThan(original.width);
  expect(zoomed.width * zoomed.height).toBeLessThanOrEqual(8_000_000);

  await page.keyboard.press('ArrowRight');
  await expect(dialog).toContainText('Output page 3 of 3');
  await expect(dialog).toContainText('landscape-source.pdf');
  await expect(page.getByTestId('page-zoom-next')).toBeDisabled();
  await expect(page.getByTestId('page-zoom-reset')).toHaveText('100%');
  await expect(canvas).toHaveCSS('visibility', 'visible', { timeout: 25000 });
  await page.evaluate(() => { window.__zoomCanvasForCleanup = document.querySelector('[data-testid="page-zoom-canvas"]'); });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__zoomCanvasForCleanup.width)).toBe(0);
  await expect(openingButton).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Select page 1', exact: true })).toBeChecked();
  await expect(page.locator('.selection-info strong')).toContainText('1 page selected');
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([430,430,750]);
  expect(pdf.getPages().map(p => p.getRotation().angle)).toEqual([0,90,0]);
  expect(pdf.getPage(1).getCropBox()).toMatchObject({ x: 20, y: 40, width: 345, height: 480 });
});

test('Chinese mobile and grouped source preview are accessible without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const source = await PDFDocument.create();
  const pg = source.addPage([520, 720]);
  pg.drawRectangle({ x: 80, y: 150, width: 180, height: 290, color: rgb(.35, .5, .9) });
  const second = await PDFDocument.create();
  const pg2 = second.addPage([480, 600]);
  pg2.drawRectangle({ x: 15, y: 15, width: 200, height: 100, color: rgb(.6, .3, .15) });
  await page.goto('/zh/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: '第一份.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) },
    { name: '第二份.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await second.save()) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group')).toHaveCount(2);
  await page.getByTestId('source-group').nth(1).getByTestId('page-preview-open').click();
  await expect(page.getByTestId('page-zoom-dialog')).toContainText('导出第 2 / 2 页');
  await expect(page.getByTestId('page-zoom-dialog')).toContainText('第二份.pdf');
  await expect(page.getByTestId('page-zoom-canvas')).toHaveCSS('visibility', 'visible', { timeout: 25000 });
  await expect(page.getByTestId('page-zoom-previous')).toBeEnabled();
  await page.getByTestId('page-zoom-previous').click();
  await expect(page.getByTestId('page-zoom-dialog')).toContainText('导出第 1 / 2 页');
  await expect(page.getByTestId('page-zoom-previous')).toBeDisabled();
  await page.getByTestId('page-zoom-close').click();
  await expect(page.getByTestId('page-zoom-dialog')).toHaveCount(0);
  await expect(page.getByTestId('source-group')).toHaveCount(2);
  const browserSize = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    canvasCount: document.querySelectorAll('[data-testid="page-zoom-canvas"]').length,
  }));
  expect(browserSize.canvasCount).toBe(0);
  expect(browserSize.scroll).toBeLessThanOrEqual(browserSize.client + 2);
});

test('quick odd/even selection handles 125-page real PDF beyond 50-range limit and rotates only odd output pages', async ({ page }) => {
  test.setTimeout(65000);
  await page.goto('/rotate-pdf/');
  const widths = Array.from({ length: 125 }, (_, n) => 300 + n);
  await page.getByTestId('file-input').setInputFiles({
    name: 'duplex-scanned-pages.pdf', mimeType: 'application/pdf', buffer: await makePdf(widths),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(125);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  const shortcuts = page.getByTestId('selection-pattern-buttons');
  await expect(shortcuts).toBeVisible();
  await page.getByTestId('select-even-pages').click();
  await expect(page.locator('.selection-info strong')).toHaveText('62 pages selected');
  await expect(page.getByRole('checkbox', { name: 'Select page 2', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select page 3', exact: true })).not.toBeChecked();
  await page.getByTestId('invert-page-selection').click();
  await expect(page.locator('.selection-info strong')).toHaveText('63 pages selected');
  await expect(page.getByRole('checkbox', { name: 'Select page 1', exact: true })).toBeChecked();
  await page.getByTestId('select-odd-pages').click();
  await expect(page.locator('.selection-info strong')).toHaveText('63 pages selected');
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  await expect(page.locator('.selection-info strong')).toHaveText('63 pages selected');
  const pdf = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(pdf.getPageCount()).toBe(125);
  expect(pdf.getPages().map(p => p.getWidth())).toEqual(widths);
  expect(pdf.getPages().map((p, index) => p.getRotation().angle === (index % 2 === 0 ? 90 : 0))).toEqual(Array(125).fill(true));
});

test('Chinese odd/even selection after grouped and reordered multi-file PDF uses true export order', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/delete-pages/');
  await page.getByTestId('file-input').setInputFiles([
    { name: '甲.pdf', mimeType: 'application/pdf', buffer: await makePdf([301,302,303,304]) },
    { name: '乙.pdf', mimeType: 'application/pdf', buffer: await makePdf([401,402]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group')).toHaveCount(2);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  await page.getByTestId('selection-ranges').fill('2-4');
  await page.getByTestId('selection-range-apply').click();
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByTestId('select-odd-pages').click();
  await expect(page.getByTestId('selection-ranges')).toHaveValue('');
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByTestId('invert-page-selection').click();
  await expect(page.locator('.selection-info strong')).toContainText('3 页已选中');
  await page.getByTestId('select-odd-pages').click();
  await page.getByRole('button', { name: '删除页面' }).click();
  const remaining = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(remaining.getPages().map(p => p.getWidth())).toEqual([302,304,402]);
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByTestId('workspace-view-order').click();
  await page.getByRole('button', { name: '向左移动第 6 页' }).click();
  await page.getByTestId('select-odd-pages').click();
  await expect(page.getByRole('checkbox', { name: '选择第 5 页', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择第 6 页', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '删除页面' }).click();
  const reordered = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(reordered.getPages().map(p => p.getWidth())).toEqual([302,304,401]);
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 2);
});

test('accidental valid PDF drop after deleting all pages must not erase the recoverable source', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/workspace/');
  const original = await makePdf([317, 419]);
  await page.getByTestId('file-input').setInputFiles({
    name: '原始资料.pdf', mimeType: 'application/pdf', buffer: original,
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: '全选' }).click();
  await page.getByRole('button', { name: '删除页面' }).click();
  await expect(page.getByTestId('undo-all-deleted')).toBeVisible();

  const dropped = (await makePdf([555])).toString('base64');
  await page.evaluate(data => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const drag = new DataTransfer();
    drag.items.add(new File([bytes], '误拖入.pdf', { type: 'application/pdf' }));
    document.querySelector('[data-testid="dropzone"]').dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: drag }));
  }, dropped);
  await expect(page.getByTestId('reimport-confirmation')).toContainText('原来已删除的页面目前仍可撤销恢复');
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeDisabled();
  await page.getByTestId('cancel-reimport').click();
  await expect(page.getByTestId('reimport-confirmation')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeEnabled();
  await page.getByTestId('undo-all-deleted').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: '导出 PDF' }).click());
  expect(restored.getPages().map(p => p.getWidth())).toEqual([317, 419]);
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(size.w).toBeLessThanOrEqual(size.c + 2);
});

test('invalid reimport never asks to discard Undo and does not wipe old PDF pages', async ({ page }) => {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'recover.pdf', mimeType: 'application/pdf', buffer: await makePdf([320, 331]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Delete selected pages' }).click();
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await expect(page.getByTestId('reimport-confirmation')).toHaveCount(0);
  await expect(page.getByTestId('undo-all-deleted')).toBeEnabled();
  await page.getByTestId('undo-all-deleted').click();
  const restored = await downloadPdf(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(restored.getPages().map(p => p.getWidth())).toEqual([320, 331]);
});
