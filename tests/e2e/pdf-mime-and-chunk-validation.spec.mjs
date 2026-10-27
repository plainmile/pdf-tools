import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function samplePdf() {
  const doc = await PDFDocument.create();
  for (const width of [301, 302, 303]) doc.addPage([width, 420]);
  return Buffer.from(await doc.save());
}

test('PDF import trusts PDF intent over conflicting browser MIME, then exports real PDF pages', async ({ page }) => {
  const bytes = await samplePdf();
  for (const [name, mimeType] of [
    ['misreported.pdf', 'image/jpeg'],
    ['downloaded-as-image.jpg', 'application/pdf'],
  ]) {
    await page.goto('/workspace/');
    await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer: bytes });
    await expect(page.getByTestId('page-tile')).toHaveCount(3);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    const output = await PDFDocument.load(await readFile(await (await downloading).path()), { updateMetadata: false });
    expect(output.getPages().map(p => p.getWidth())).toEqual([301, 302, 303]);
  }
});

test('bilingual 375px split chunks reject invalid counts inline and recover without losing pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const input = await samplePdf();
  for (const [url, radio, invalidPattern] of [
    ['/split-pdf/', 'Split every N pages', /1 to 3/],
    ['/zh/split-pdf/', '每 N 页拆分一次', /1 至 3/],
  ]) {
    await page.goto(url);
    await page.getByTestId('file-input').setInputFiles({ name: 'chapters.pdf', mimeType: 'application/pdf', buffer: input });
    await page.getByRole('radio', { name: radio }).check();
    const count = page.locator('#chunk-input');
    for (const invalidValue of ['0', '4', '1.5']) {
      await count.fill(invalidValue);
      await expect(count).toHaveAttribute('aria-invalid', 'true');
      await expect(count).toHaveAttribute('aria-describedby', /split-chunk-invalid/);
      await expect(page.getByTestId('split-chunk-invalid')).toContainText(invalidPattern);
      await expect(page.locator('.split-download')).toBeDisabled();
    }
    await count.fill('2');
    await expect(page.getByTestId('split-chunk-invalid')).toHaveCount(0);
    await expect(count).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.split-download')).toBeEnabled();
    const downloading = page.waitForEvent('download');
    await page.locator('.split-download').click();
    const archive = await JSZip.loadAsync(await readFile(await (await downloading).path()));
    const names = Object.keys(archive.files).sort();
    expect(names).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-3.pdf']);
    const widths = [];
    for (const name of names) {
      const pdf = await PDFDocument.load(await archive.files[name].async('uint8array'), { updateMetadata: false });
      widths.push(pdf.getPages().map(p => p.getWidth()));
    }
    expect(widths).toEqual([[301, 302], [303]]);
    const bounds = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.viewport + 2);
  }
});
