import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function threePagePdf() {
  const document = await PDFDocument.create();
  for (const width of [320, 340, 360]) document.addPage([width, 440]);
  return Buffer.from(await document.save());
}

test('Chinese mobile workspace jump accepts ordinary zero-padded digits, rejects numbered-list glyphs', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'jump-three-pages.pdf', mimeType: 'application/pdf', buffer: await threePagePdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByTestId('page-jump-panel').locator('summary').click();

  const jump = page.getByTestId('page-jump-input');
  const submit = page.getByTestId('page-jump-submit');
  for (const invalid of ['②', '²', '2e0', '0', '4']) {
    await jump.fill(invalid);
    await submit.click();
    await expect(page.locator('.notice-error')).toContainText('1 到 3', { timeout: 10000 });
  }

  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-groups')).toBeVisible();
  await jump.fill('００２');
  await submit.click();
  await expect(page.locator('.notice-error')).toHaveCount(0);
  await expect(page.locator('.notice-success')).toContainText('第 2 页');
  await expect(page.getByTestId('workspace-view-order')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('page-tile').nth(1)).toBeFocused();
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await expect(page.locator('.selection-info strong')).toContainText('0');
});

test('Chinese visual split page jump uses identical strict decimal behavior without cutting pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/split-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'visual-jump.pdf', mimeType: 'application/pdf', buffer: await threePagePdf(),
  });
  await expect(page.locator('.file-count')).toContainText('3');
  await page.getByTestId('visual-split-panel').locator('summary').click();
  await expect(page.getByTestId('split-visual-jump-form')).toBeVisible();

  const jump = page.getByTestId('split-visual-jump-input');
  const submit = page.getByTestId('split-visual-jump-submit');
  for (const invalid of ['③', '³', '3e0', '4']) {
    await jump.fill(invalid);
    await submit.click();
    await expect(page.locator('.notice-error')).toContainText('1 到 3');
  }

  await jump.fill('００３');
  await submit.click();
  await expect(page.locator('.notice-error')).toHaveCount(0);
  await expect(page.locator('.notice-success')).toContainText('第 3 页');
  await expect(page.getByTestId('visual-split-page').nth(2)).toBeFocused();
  await expect(page.getByTestId('visual-split-cut')).toHaveCount(2);
  await expect(page.getByTestId('visual-split-cut').nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('visual-split-cut').nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ranges-input')).toHaveValue('');
});

test('invalid Unicode move target never changes actual exported page order', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'move-order.pdf', mimeType: 'application/pdf', buffer: await threePagePdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  await page.getByTestId('page-tile').nth(2).locator('input[type="checkbox"]').check();
  await page.getByTestId('move-position-panel').locator('summary').click();

  const target = page.getByTestId('move-target-input');
  const submit = page.getByTestId('move-position-submit');
  for (const invalid of ['②', '²', '1e0', '0', '4']) {
    await target.fill(invalid);
    await submit.click();
    await expect(page.locator('.notice-error')).toContainText('1 到 3');
    await expect(page.getByTestId('page-tile').nth(2)).toHaveAttribute('data-original-page', '3');
  }
  // A user-typed fullwidth, zero-padded decimal is unambiguous and valid.
  await target.fill('００１');
  await submit.click();
  await expect(page.locator('.notice-error')).toHaveCount(0);
  await expect(page.getByTestId('page-tile').nth(0)).toHaveAttribute('data-original-page', '3');
  await expect(page.getByTestId('page-tile').nth(1)).toHaveAttribute('data-original-page', '1');
  await expect(page.getByTestId('page-tile').nth(2)).toHaveAttribute('data-original-page', '2');

  // Assert the actual PDF page order, not just a toast/thumbnail.
  const event = page.waitForEvent('download');
  await page.locator('.workspace-primary-buttons button').last().click();
  const downloaded = await event;
  const pdf = await PDFDocument.load(await readFile(await downloaded.path()));
  expect(pdf.getPages().map(page => page.getWidth())).toEqual([360, 320, 340]);
});
