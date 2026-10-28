import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const [route, name] of [['/txt-to-pdf/', 'English'], ['/zh/markdown-to-pdf/', 'Chinese']]) {
  test(`${name}: import local text before requesting the PDF converter and produce a valid PDF`, async ({ page }) => {
    await page.goto(route);
    const imports = [];
    page.on('request', request => {
      if (/pdfUtilities|jszip/i.test(request.url())) imports.push(request.url());
    });
    await page.getByTestId('utility-file-input').setInputFiles({
      name: route.includes('markdown') ? 'notes.md' : 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(route.includes('markdown') ? '# Local notes\nA small page.' : 'A local text file.', 'utf8'),
    });
    await expect(page.getByTestId('text-file-summary')).toBeVisible();
    expect(imports, 'importing TXT or Markdown should not fetch the PDF converter bundle').toEqual([]);
    await page.getByTestId('utility-run').click();
    await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 30000 });
    const pending = page.waitForEvent('download');
    await page.getByTestId('utility-pdf-download').click();
    const download = await pending;
    const pdf = await PDFDocument.load(await readFile(await download.path()));
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
}
