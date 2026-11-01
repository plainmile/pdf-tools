import { test, expect } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function fixturePdf() {
  const pdf = await PDFDocument.create();
  // Keep the entire sentence inside the page. pdf-lib's default 24 pt text
  // would cross the right margin and produce a clipped PDF fixture.
  pdf.addPage([350, 450]).drawText('LOCAL PDF DOWNLOAD RETRY', { x: 25, y: 375, size: 12 });
  return Buffer.from(await pdf.save());
}

async function rejectBrowserDownloads(page) {
  await page.evaluate(() => {
    window.__originalDownloadClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function blockGeneratedFile() {
      if (this.download && this.href.startsWith('blob:')) {
        throw new Error('synthetic browser download refusal');
      }
      return window.__originalDownloadClick.call(this);
    };
  });
}

async function restoreBrowserDownloads(page) {
  await page.evaluate(() => {
    if (window.__originalDownloadClick) {
      HTMLAnchorElement.prototype.click = window.__originalDownloadClick;
      delete window.__originalDownloadClick;
    }
  });
}

async function downloadBytes(page, selector) {
  const event = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByTestId(selector).click();
  const download = await event;
  return { name: download.suggestedFilename(), bytes: Buffer.from(await readFile(await download.path())) };
}

test('Chinese TXT PDF survives a rejected manual browser download and retries the identical generated file', async ({ page }) => {
  const uncaught = [];
  const uploads = [];
  page.on('pageerror', error => uncaught.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
  await page.goto('/zh/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('中文测试：浏览器下载被拒绝后，文件仍然可用。');
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('text-pdf-result')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.notice-success')).toContainText('无法选择和搜索文字');

  await rejectBrowserDownloads(page);
  try {
    await page.getByTestId('utility-pdf-download').click();
    await expect(page.getByRole('alert')).toContainText('浏览器未能开始下载');
    await expect(page.getByTestId('text-pdf-result')).toBeVisible();
    await expect(page.locator('.notice-success')).toContainText('无法选择和搜索文字');
    await expect(page.locator('a[download][href^="blob:"]')).toHaveCount(0);
  } finally {
    await restoreBrowserDownloads(page);
  }

  const result = await downloadBytes(page, 'utility-pdf-download');
  expect(result.name).toMatch(/\.pdf$/);
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPageCount()).toBe(1);
  const resources = pdf.context.lookup(pdf.getPage(0).node.Resources(), PDFDict);
  const objectRef = resources.get(PDFName.of('XObject'));
  expect(objectRef).toBeTruthy();
  expect(pdf.context.lookup(objectRef, PDFDict).keys().length).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(uncaught).toEqual([]);
  expect(uploads).toEqual([]);
});

test('English PDF-to-TXT manual save error does not lose the already extracted file', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  const bytes = await fixturePdf();
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'local.pdf', mimeType: 'application/pdf', buffer: bytes,
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('local.pdf');
  // This converter auto-downloads once. A later explicit repeat still needs
  // to handle a browser refusal without repeating extraction.
  const first = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByTestId('utility-run').click();
  expect((await readFile(await (await first).path())).toString('utf8')).toContain('LOCAL PDF DOWNLOAD RETRY');
  await expect(page.getByTestId('complete-text-result')).toBeVisible();
  // A successful automatic download may deliberately leave its original Blob
  // anchor briefly attached for Firefox/WebKit download handoff. The blocked
  // *manual* retry must not create any ADDITIONAL orphan anchor.
  const autoDownloadUrls = new Set(await page.locator('a[download][href^="blob:"]')
    .evaluateAll(anchors => anchors.map(anchor => anchor.href)));

  await rejectBrowserDownloads(page);
  try {
    await page.getByTestId('complete-text-download').click();
    await expect(page.getByRole('alert')).toContainText('The browser could not start this download');
    await expect(page.getByTestId('complete-text-result')).toBeVisible();
    const afterBlockedRetry = await page.locator('a[download][href^="blob:"]')
      .evaluateAll(anchors => anchors.map(anchor => anchor.href));
    expect(afterBlockedRetry.filter(url => !autoDownloadUrls.has(url))).toEqual([]);
  } finally {
    await restoreBrowserDownloads(page);
  }
  const retry = await downloadBytes(page, 'complete-text-download');
  expect(retry.name).toMatch(/\.txt$/);
  expect(retry.bytes.toString('utf8')).toContain('LOCAL PDF DOWNLOAD RETRY');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('page numbering manual PDF rejection stays recoverable without generating pages again', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'number-me.pdf', mimeType: 'application/pdf', buffer: await fixturePdf(),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('numbered-pdf-result')).toBeVisible({ timeout: 20_000 });
  const originalNotice = await page.locator('.notice-success').textContent();

  await rejectBrowserDownloads(page);
  try {
    await page.getByTestId('numbered-pdf-download').click();
    await expect(page.getByRole('alert')).toContainText('The browser could not start this download');
    await expect(page.getByTestId('numbered-pdf-result')).toBeVisible();
    await expect(page.locator('.notice-success')).toHaveText(originalNotice);
  } finally {
    await restoreBrowserDownloads(page);
  }
  const result = await downloadBytes(page, 'numbered-pdf-download');
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPageCount()).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('manual PDF download recovery help stays crawlable in both languages without FAQ rich result claims', async ({ request }) => {
  for (const [path, question] of [
    ['/txt-to-pdf/', 'What if Download PDF does not start?'],
    ['/zh/txt-to-pdf/', '点击“下载 PDF”后没有文件怎么办？'],
    ['/markdown-to-pdf/', 'What if the generated PDF will not download?'],
    ['/zh/markdown-to-pdf/', '生成的 PDF 无法下载怎么办？'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain(question);
    expect(html, path).toContain('rel="canonical"');
    expect(html, path).toContain('hreflang="en"');
    expect(html, path).toContain('hreflang="zh-CN"');
    expect(html, path).not.toContain('"@type":"FAQPage"');
  }
});
