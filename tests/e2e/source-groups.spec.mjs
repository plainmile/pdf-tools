import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function makePdf(widths) {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 420]);
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}
async function importTwo(page, sizes = [[300, 310], [320]]) {
  await page.goto('/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await makePdf(sizes[0]) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await makePdf(sizes[1]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(sizes[0].length + sizes[1].length);
}
async function exportPdf(page, label = 'Export PDF') {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: label }).click();
  return PDFDocument.load(await readFile(await (await download).path()));
}

test('grouped file view reveals true positions but never changes interleaved PDF export', async ({ page }) => {
  await importTwo(page);
  // Export order: one page 1, one page 2, two page 1.
  await page.getByRole('button', { name: 'Move page 3 left' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);

  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group')).toHaveCount(2);
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('group-view-hint')).toContainText('export order does not change');
  const groups = page.getByTestId('source-group');
  await expect(groups.nth(0).getByTestId('group-output-position')).toHaveText(['Output page 1', 'Output page 3']);
  await expect(groups.nth(1).getByTestId('group-output-position')).toHaveText(['Output page 2']);
  await expect(groups.nth(0).getByTestId('source-group-toggle')).toContainText('one.pdf');

  await groups.nth(0).getByTestId('source-group-select').click();
  await expect(page.getByText('2 pages selected')).toBeVisible();
  await groups.nth(0).getByTestId('source-group-toggle').click();
  await expect(groups.nth(0).getByTestId('page-tile')).toHaveCount(0);
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await page.getByTestId('source-groups-collapse-all').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);

  const exported = await exportPdf(page);
  expect(exported.getPages().map(p => p.getWidth())).toEqual([300, 320, 310]);
  await page.getByTestId('source-groups-expand-all').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);

  await page.getByTestId('workspace-view-order').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('page-tile').nth(1)).toHaveAttribute('data-original-page', '1');
  // Group selection is preserved, and group view does not commit a history edit.
  await expect(page.getByText('2 pages selected')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  const restored = await exportPdf(page);
  expect(restored.getPages().map(p => p.getWidth())).toEqual([300, 310, 320]);
});

test('Chinese touch-width grouping is usable and keeps correct exported pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 780 });
  await page.goto('/zh/workspace/');
  await page.getByTestId('file-input').setInputFiles([
    { name: '甲.pdf', mimeType: 'application/pdf', buffer: await makePdf([300, 310]) },
    { name: '乙.pdf', mimeType: 'application/pdf', buffer: await makePdf([320]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group')).toHaveCount(2);
  await expect(page.getByTestId('group-view-hint')).toContainText('不会调整导出顺序');
  await page.getByTestId('source-groups-collapse-all').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(0);
  await page.getByTestId('source-groups-expand-all').click();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.getByTestId('source-group').first().getByTestId('group-output-position')).toHaveText(['导出第 1 页', '导出第 2 页']);
  const pdf = await exportPdf(page, '导出 PDF');
  expect(pdf.getPages().map(p => p.getWidth())).toEqual([300, 310, 320]);
});

// Observe browser-side heap rather than claiming that a 200 MiB source-byte
// budget caps total process memory. Native PDF.js bitmaps/worker/canvas memory
// is outside this metric; the number is a regression diagnostic, not a promise.
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  test(`360-page source grouping stress at ${viewport.width}px, with lazy previews and bounded JS heap`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await importTwo(page, [
      Array.from({ length: 180 }, (_, index) => 300 + index % 3),
      Array.from({ length: 180 }, (_, index) => 320 + index % 3),
    ]);
    await expect(page.getByTestId('page-tile')).toHaveCount(360);
    await page.getByTestId('workspace-view-grouped').click();
    await expect(page.getByTestId('source-group')).toHaveCount(2);
    await page.getByTestId('source-groups-collapse-all').click();
    await expect(page.getByTestId('page-tile')).toHaveCount(0);
    await expect(page.locator('.page-preview canvas')).toHaveCount(0);
    await page.getByTestId('source-group').first().getByTestId('source-group-toggle').click();
    await expect(page.getByTestId('page-tile')).toHaveCount(180);
    await expect.poll(() => page.locator('.page-preview canvas').count()).toBeGreaterThan(0);
    // Only visible/near-viewport canvases are mounted, not all 180 page bitmaps.
    expect(await page.locator('.page-preview canvas').count()).toBeLessThan(48);
    const session = await page.context().newCDPSession(page);
    try {
      const usage = await session.send('Runtime.getHeapUsage');
      console.log(`SOURCE_GROUP_HEAP ${viewport.width}px: ${Math.round(usage.usedSize / 1048576)} MiB Chromium JS heap`);
      expect(usage.usedSize).toBeGreaterThan(0);
      expect(usage.usedSize).toBeLessThan(384 * 1024 * 1024);
    } finally {
      await session.detach();
    }
    await page.getByTestId('workspace-view-order').click();
    await expect(page.getByTestId('page-tile')).toHaveCount(360);
  });
}
