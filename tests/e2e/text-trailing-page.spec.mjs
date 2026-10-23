import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const mode of ['txt-to-pdf', 'markdown-to-pdf']) {
  test(`${mode} ignores trailing newlines instead of generating blank PDF pages`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(`/${mode}/`);
    const body = mode === 'markdown-to-pdf' ? '# First entry\n\nLast entry' : 'First entry\n\nLast entry';
    await page.getByTestId('utility-text').fill(body + '\n'.repeat(150));
    await page.getByTestId('utility-run').click();
    await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });
    const pdfEvent = page.waitForEvent('download');
    await page.getByTestId('utility-pdf-download').click();
    const pdfDownload = await pdfEvent;
    const bytes = await readFile(await pdfDownload.path());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    // Reopen the actual downloaded PDF rather than trusting only a UI counter.
    await page.goto('/pdf-to-txt/');
    await page.getByTestId('utility-file-input').setInputFiles({
      name: 'trimmed-trailing-lines.pdf', mimeType: 'application/pdf', buffer: bytes,
    });
    await expect(page.getByTestId('utility-file-summary')).toBeVisible({ timeout: 20000 });
    const txtEvent = page.waitForEvent('download');
    await page.getByTestId('utility-run').click();
    const txtDownload = await txtEvent;
    const extracted = (await readFile(await txtDownload.path())).toString('utf8');
    expect(extracted).toContain('First entry');
    expect(extracted).toContain('Last entry');
  });
}
