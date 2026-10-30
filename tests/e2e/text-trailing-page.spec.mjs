import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

for (const mode of ['txt-to-pdf', 'markdown-to-pdf']) {
  test(`${mode} trims outer blank lines without adding empty PDF pages`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(`/${mode}/`);
    const body = mode === 'markdown-to-pdf' ? '# First entry\n\nLast entry' : 'First entry\n\nLast entry';
    // Leading blank lines from pasted documents must not consume entire
    // pages before the first actual paragraph. Interior spacing stays.
    await page.getByTestId('utility-text').fill('\n'.repeat(180) + body + '\n'.repeat(150));
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


test('Markdown technical inline code survives actual PDF export and text extraction', async ({ page }) => {
  await page.goto('/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('Use `<strong>` literally. See [guide](https://example.org/docs).');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });
  const pdfEvent = page.waitForEvent('download');
  await page.getByTestId('utility-pdf-download').click();
  const pdfBytes = await readFile(await (await pdfEvent).path());
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(1);

  await page.goto('/pdf-to-txt/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'technical-code.pdf', mimeType: 'application/pdf', buffer: pdfBytes,
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  const textEvent = page.waitForEvent('download');
  await page.getByTestId('utility-run').click();
  const extracted = (await readFile(await (await textEvent).path())).toString('utf8');
  expect(extracted).toContain('Use <strong> literally.');
  expect(extracted).toContain('guide (https://example.org/docs)');
});

test('bilingual Markdown to PDF preserves escaped symbols in the actual downloaded PDF', async ({ page }) => {
  const tick = String.fromCharCode(96);
  const input = 'Stars: \\*literal\\*. Link: \\[docs](https://example.org).\n' +
    'Inline code: ' + tick + '\\*raw\\*' + tick + '.';
  for (const localePrefix of ['', '/zh']) {
    await page.goto(localePrefix + '/markdown-to-pdf/');
    await page.getByTestId('utility-text').fill(input);
    await page.getByTestId('utility-run').click();
    await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 20000 });
    const pdfEvent = page.waitForEvent('download');
    await page.getByTestId('utility-pdf-download').click();
    const bytes = await readFile(await (await pdfEvent).path());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);

    await page.goto(localePrefix + '/pdf-to-txt/');
    await page.getByTestId('utility-file-input').setInputFiles({
      name: 'escaped-markdown.pdf', mimeType: 'application/pdf', buffer: bytes,
    });
    await expect(page.getByTestId('utility-file-summary')).toBeVisible({ timeout: 20000 });
    const txtEvent = page.waitForEvent('download');
    await page.getByTestId('utility-run').click();
    const actual = (await readFile(await (await txtEvent).path())).toString('utf8');
    expect(actual).toContain('Stars: *literal*.');
    expect(actual).toContain('Link: [docs](https://example.org).');
    expect(actual).toContain('Inline code: \\*raw\\*.');
  }
});
