import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function pdf(widths) {
  const doc = await PDFDocument.create();
  widths.forEach(w => doc.addPage([w, 480]));
  return Buffer.from(await doc.save());
}

test('Unix-style dotfile PDF imports export a visible default filename and preserve the actual page', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: '.private.pdf', mimeType: 'application/pdf', buffer: await pdf([317]),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('private-merged.pdf');
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const download = await started;
  expect(download.suggestedFilename()).toBe('private-merged.pdf');
  const saved = await PDFDocument.load(await readFile(await download.path()));
  expect(saved.getPages().map(p => p.getWidth())).toEqual([317]);
});

test('fullwidth PDF filename produces one clean Chinese image name without changing image bytes', async ({ page }) => {
  await page.goto('/zh/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: '报告．ＰＤＦ', mimeType: 'application/pdf', buffer: await pdf([310]),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('报告．ＰＤＦ');
  await page.getByRole('combobox', { name: '图片格式' }).selectOption('png');
  const started = page.waitForEvent('download');
  await page.getByTestId('utility-run').click();
  const download = await started;
  expect(download.suggestedFilename()).toBe('报告-page-001.png');
  const image = await readFile(await download.path());
  expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test('merge tool suggests merged.pdf, preserves a custom name, and exports correct pages', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer: await pdf([301]) },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await pdf([320]) },
  ]);
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await expect(page.getByTestId('workspace-export-filename')).toContainText('plainmile-2-files-merged.pdf');
  await page.getByTestId('download-name-panel').locator('summary').click();
  await page.getByTestId('download-name-input').fill('Meeting notes');
  await expect(page.getByTestId('workspace-export-filename')).toContainText('Meeting-notes.pdf');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const file = await event;
  expect(file.suggestedFilename()).toBe('Meeting-notes.pdf');
  const out = await PDFDocument.load(await readFile(await file.path()));
  expect(out.getPages().map(p => p.getWidth())).toEqual([301, 320]);
});

test('rotate tool uses a meaningful default name without affecting the PDF', async ({ page }) => {
  await page.goto('/rotate-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'scan.pdf', mimeType: 'application/pdf', buffer: await pdf([330]),
  });
  await expect(page.getByTestId('workspace-export-filename')).toContainText('scan-rotated.pdf');
  await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).check();
  await page.getByRole('button', { name: 'Rotate clockwise' }).click();
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const output = await promise;
  expect(output.suggestedFilename()).toBe('scan-rotated.pdf');
  const doc = await PDFDocument.load(await readFile(await output.path()));
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getRotation().angle).toBe(90);
});

test('watermark suggested name changes only when user enables nonempty watermark', async ({ page }) => {
  await page.goto('/watermark-pdf/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'draft.pdf', mimeType: 'application/pdf', buffer: await pdf([350]),
  });
  await expect(page.getByTestId('workspace-export-filename')).toContainText('draft-organized.pdf');
  await page.getByTestId('watermark-toggle').check();
  await expect(page.getByTestId('workspace-export-filename')).toContainText('draft-organized.pdf');
  await page.getByTestId('watermark-text').fill('DRAFT');
  await expect(page.getByTestId('workspace-export-filename')).toContainText('draft-watermarked.pdf');
  await page.getByTestId('watermark-toggle').uncheck();
  await expect(page.getByTestId('workspace-export-filename')).toContainText('draft-organized.pdf');
});

test('split page starts with a short bilingual hint; advanced rules stay accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, hint, expand, advanced] of [
    ['/split-pdf/', 'Download separate PDFs', 'More split options and limits', '50 custom ranges'],
    ['/zh/split-pdf/', '可分别下载', '查看更多拆分方式和限制', '最多 50 份'],
  ]) {
    await page.goto(path);
    await page.getByTestId('file-input').setInputFiles({
      name: 'small.pdf', mimeType: 'application/pdf', buffer: await pdf([310, 320, 330, 340]),
    });
    await expect(page.getByTestId('split-intro-quick')).toContainText(hint);
    const more = page.getByTestId('split-intro-more');
    await expect(more).not.toHaveAttribute('open');
    await expect(more.locator('summary')).toContainText(expand);
    await more.locator('summary').click();
    await expect(more.locator('p')).toBeVisible();
    await expect(more.locator('p')).toContainText(advanced);
    const widths = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.client + 2);
  }
});
