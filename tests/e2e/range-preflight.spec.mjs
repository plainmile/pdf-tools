import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function samplePdf(count = 6) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([301 + i, 420]);
  return Buffer.from(await doc.save());
}

async function loadWorkspace(page, route) {
  await page.goto(route);
  await page.getByTestId('file-input').setInputFiles({
    name: 'range-preflight.pdf', mimeType: 'application/pdf', buffer: await samplePdf(),
  });
}

test('organize page selection preflights malformed, reversed, oversized and open-ended ranges', async ({ page }) => {
  await page.goto('/organize-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'selection.pdf', mimeType: 'application/pdf', buffer: await samplePdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByTestId('selection-range-panel').locator('summary').click();
  const input = page.getByTestId('selection-ranges');
  const apply = page.getByTestId('selection-range-apply');
  const warning = page.getByTestId('selection-range-invalid');

  for (const bad of ['6-3', '7-', '1,,2', '②', '²', Array.from({ length: 51 }, () => '1').join(',')]) {
    await input.fill(bad);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAttribute('aria-describedby', /selection-range-invalid/);
    await expect(warning).toContainText('previous selection has not changed');
    await expect(apply).toBeDisabled();
    await expect(page.locator('.selection-info strong')).toHaveText('0 pages selected');
  }

  // Unicode fullwidth digit and open-ended range share the same strict parser.
  await input.fill('４－');
  await expect(warning).toHaveCount(0);
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.locator('.selection-info strong')).toHaveText('3 pages selected');

  // A later invalid entry cannot overwrite the already applied selection.
  await input.fill('2-1');
  await expect(apply).toBeDisabled();
  await expect(page.locator('.selection-info strong')).toHaveText('3 pages selected');
});

test('Chinese split and every-N fields expose preflight errors and recover without dropping the PDF', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loadWorkspace(page, '/zh/split-pdf/');
  await expect(page.locator('.file-count')).toContainText('6');
  const range = page.locator('#ranges-input');
  const download = page.locator('.split-download');
  await range.fill('５－２');
  await expect(range).toHaveAttribute('aria-invalid', 'true');
  await expect(range).toHaveAttribute('aria-describedby', /split-estimate/);
  await expect(page.locator('#split-estimate')).toContainText('请检查页码范围');
  await expect(download).toBeDisabled();

  await range.fill('1-2,3-');
  await expect(range).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
  await expect(download).toBeEnabled();

  // The same immediate feedback applies to impossible every-N input.
  await page.locator('input[name="split-method"]').nth(1).check();
  const chunk = page.locator('#chunk-input');
  await chunk.fill('0');
  await expect(chunk).toHaveAttribute('aria-invalid', 'true');
  await expect(download).toBeDisabled();
  await chunk.fill('2');
  await expect(chunk).not.toHaveAttribute('aria-invalid', 'true');
  await expect(download).toBeEnabled();

  const bounds = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 2);
});
