import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function onePagePdf() {
  const document = await PDFDocument.create();
  document.addPage([320, 420]);
  return Buffer.from(await document.save());
}

test('workspace warns before leaving during a still-loading PDF; cancel releases navigation guard', async ({ page }) => {
  await page.goto('/workspace/');
  await page.evaluate(() => {
    FileReader.prototype.readAsArrayBuffer = function () { /* simulate a stalled local file reader */ };
  });
  await page.getByTestId('file-input').setInputFiles({
    name: 'slow-import.pdf', mimeType: 'application/pdf', buffer: await onePagePdf(),
  });
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.locator('.language-link').click();
  const prompt = page.getByTestId('unsaved-navigation-dialog');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('still loading or being processed');
  await expect(page).toHaveURL(url => url.pathname === '/workspace/');
  await page.getByTestId('unsaved-keep').click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId('workspace-import-cancel')).toBeVisible();
  await page.getByTestId('workspace-import-cancel').click();
  await expect(page.getByTestId('workspace-import-progress')).toHaveCount(0);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(url => url.pathname === '/zh/workspace/');
});

test('Chinese PDF utility warns during file load without falsely claiming a saved result', async ({ page }) => {
  await page.goto('/zh/pdf-to-txt/');
  await page.evaluate(() => {
    FileReader.prototype.readAsArrayBuffer = function () { /* never finish until cancelled */ };
  });
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'slow-import.pdf', mimeType: 'application/pdf', buffer: await onePagePdf(),
  });
  await expect(page.getByTestId('utility-load-cancel')).toBeVisible();
  await page.locator('.language-link').click();
  const prompt = page.getByTestId('unsaved-navigation-dialog');
  await expect(prompt).toContainText('仍在读取或处理文件');
  await page.getByTestId('unsaved-keep').click();
  await expect(prompt).toHaveCount(0);
  await page.getByTestId('utility-load-cancel').click();
  await expect(page.getByTestId('utility-load-cancel')).toHaveCount(0);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(url => url.pathname === '/pdf-to-txt/');
});

test('active PDF-to-image conversion needs confirmation; cancelling safely restores navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeRead = Blob.prototype.arrayBuffer;
    window.__blockPageImageRead = false;
    window.__pageImageReadStalled = false;
    Blob.prototype.arrayBuffer = function () {
      if (window.__blockPageImageRead && this.type === 'image/png') {
        window.__blockPageImageRead = false;
        window.__pageImageReadStalled = true;
        return new Promise(() => {});
      }
      return nativeRead.apply(this, arguments);
    };
  });
  await page.goto('/pdf-to-images/');
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'convert.pdf', mimeType: 'application/pdf', buffer: await onePagePdf(),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.locator('.utility-options select').first().selectOption('png');
  const downloads = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
  await page.evaluate(() => { window.__blockPageImageRead = true; });
  await page.getByTestId('utility-run').click();
  await expect.poll(() => page.evaluate(() => window.__pageImageReadStalled)).toBe(true);
  await page.locator('.language-link').click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toContainText('still loading or being processed');
  await page.getByTestId('unsaved-keep').click();
  await page.getByTestId('utility-cancel').click();
  await expect(page.getByTestId('utility-run')).toBeEnabled();
  expect(downloads).toEqual([]);
  await page.locator('.language-link').click();
  await expect(page).toHaveURL(url => url.pathname === '/zh/pdf-to-images/');
});

test('bilingual loading/processing explanation is present in HTML before JavaScript runs', async ({ request }) => {
  for (const [path, phrase] of [
    ['/workspace/', 'What happens if I switch tools while a file is still loading or exporting?'],
    ['/pdf-to-images/', 'What happens if I leave while pages are converting?'],
    ['/zh/workspace/', '文件正在导入或导出时切换工具会怎样？'],
    ['/zh/pdf-to-images/', '正在转换 PDF 页面时离开会怎样？'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain(phrase);
    expect(html, path).toContain('rel="canonical"');
    expect(html, path).toContain('hreflang="zh-CN"');
  }
});
