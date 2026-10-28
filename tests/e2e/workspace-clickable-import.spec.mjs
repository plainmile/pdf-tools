import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function examplePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([301, 420]);
  pdf.addPage([402, 420]);
  return Buffer.from(await pdf.save());
}

for (const [locale, route, sub, exportLabel] of [
  ['English', '/merge-pdf/', 'Click or tap anywhere', 'Export PDF'],
  ['Chinese mobile', '/zh/merge-pdf/', '点击或轻触框内任意位置', '导出 PDF'],
]) {
  test(`${locale}: empty workspace area picks files and exports exact pages`, async ({ page }) => {
    if (locale === 'Chinese mobile') await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(route);
    const zone = page.getByTestId('dropzone');
    await expect(zone).toContainText(sub);
    // Heading is NOT the original Choose button. Clicking elsewhere in the
    // dashed area should invoke the same native file picker.
    const chooserEvent = page.waitForEvent('filechooser');
    await zone.locator('h2').click();
    await (await chooserEvent).setFiles({
      name: 'simple.pdf', mimeType: 'application/pdf', buffer: await examplePdf(),
    });
    await expect(page.getByTestId('page-tile')).toHaveCount(2);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: exportLabel, exact: true }).click();
    const output = await PDFDocument.load(await readFile(await (await download).path()));
    expect(output.getPages().map(page => page.getWidth())).toEqual([301, 402]);
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.client + 2);
  });
}

test('empty workspace does not hijack the existing one-click example button', async ({ page }) => {
  await page.goto('/split-pdf/');
  let accidentalChoosers = 0;
  page.on('filechooser', () => { accidentalChoosers++; });
  await page.getByTestId('workspace-load-demo').click();
  await expect(page.locator('.file-count')).toContainText('4 pages');
  expect(accidentalChoosers).toBe(0);
});
