import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const samples = [
  ['/samples/plainmile-demo.pdf', [612, 620, 628, 636]],
  ['/samples/plainmile-demo-part-a.pdf', [612, 620]],
  ['/samples/plainmile-demo-part-b.pdf', [628, 636]],
];

async function captureDownload(page, action) {
  const event = page.waitForEvent('download', { timeout: 30000 });
  await action();
  const download = await event;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

async function pdfWidths(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map(page => page.getWidth());
}

test('public demonstration PDFs have real ordered pages, PDF MIME, and explicit noindex', async ({ request }) => {
  for (const [path, widths] of samples) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('application/pdf');
    expect(response.headers()['x-robots-tag'], path).toMatch(/noindex/i);
    const bytes = await response.body();
    expect(bytes.subarray(0, 8).toString(), path).toBe('%PDF-1.4');
    expect(await pdfWidths(bytes), path).toEqual(widths);
  }
  const missing = await request.get('/samples/nonexistent.pdf');
  expect(missing.status()).toBe(404);
});

test('English and Chinese PDF landing pages prerender usable example instructions without inventing routes', async ({ request }) => {
  const cases = [
    ['/split-pdf/', '1-2, 3-4', 1],
    ['/zh/split-pdf/', '1-2, 3-4', 1],
    ['/merge-pdf/', 'four pages', 2],
    ['/zh/merge-pdf/', '4 页', 2],
    ['/compress-pdf/', 'not guaranteed', 1],
    ['/zh/compress-pdf/', '不保证', 1],
  ];
  for (const [path, expected, count] of cases) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).toContain('data-testid="demo-guidance"');
    expect(html, path).toContain(expected);
    expect((html.match(/href="\/samples\/plainmile-demo(?:-part-[ab])?\.pdf"/g) || []).length, path).toBe(count);
    expect(html, path).toContain('rel="canonical"');
    expect(html, path).toContain('hreflang="en"');
    expect(html, path).toContain('hreflang="zh-CN"');
    expect(html, path).not.toContain('FAQPage');
  }
  for (const path of ['/image-to-pdf/', '/txt-to-pdf/', '/markdown-to-pdf/']) {
    const html = await (await request.get(path)).text();
    expect(html, path).not.toContain('data-testid="demo-guidance"');
  }
});

test('one-click example Split PDF exports real two-by-two ZIP without POSTing documents', async ({ page }) => {
  const nonGets = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) nonGets.push(request.method() + ' ' + request.url());
  });
  await page.goto('/split-pdf/');
  await page.getByTestId('workspace-load-demo').click();
  await expect(page.locator('.file-count')).toContainText('4 pages');
  await expect(page.getByTestId('workspace-load-demo')).toHaveCount(0);
  await page.locator('#ranges-input').fill('1-2, 3-4');
  await expect(page.getByTestId('split-coverage-complete')).toBeVisible();
  const out = await captureDownload(page, () =>
    page.getByRole('button', { name: 'Download split PDFs (ZIP)' }).click());
  const zip = await JSZip.loadAsync(out.bytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['part-01-pages-1-2.pdf', 'part-02-pages-3-4.pdf']);
  expect(await pdfWidths(await zip.files[names[0]].async('uint8array'))).toEqual([612, 620]);
  expect(await pdfWidths(await zip.files[names[1]].async('uint8array'))).toEqual([628, 636]);
  expect(nonGets).toEqual([]);
});

test('Merge PDF demo loads two distinct source PDFs and saves four pages in A-then-B order', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.getByTestId('workspace-load-demo').click();
  await expect(page.locator('.file-count')).toContainText('4 pages');
  await expect(page.locator('.file-count')).toContainText('2 files');
  const out = await captureDownload(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(await pdfWidths(out.bytes)).toEqual([612, 620, 628, 636]);
});

test('Chinese utility demo extracts selectable sample text and downloads actual UTF-8 TXT', async ({ page }) => {
  await page.goto('/zh/pdf-to-txt/');
  await expect(page.getByTestId('demo-guidance')).toContainText('Overview');
  await page.getByTestId('utility-load-demo').click();
  await expect(page.getByTestId('utility-file-summary')).toContainText('plainmile-demo.pdf');
  const out = await captureDownload(page, () => page.getByTestId('utility-run').click());
  expect(out.name).toMatch(/\.txt$/i);
  const text = out.bytes.toString('utf8');
  for (const section of ['Overview', 'Checklist', 'Summary', 'Notes']) {
    expect(text).toContain(section);
  }
  expect(text.indexOf('Overview')).toBeLessThan(text.indexOf('Checklist'));
  expect(text.indexOf('Checklist')).toBeLessThan(text.indexOf('Summary'));
  expect(text.indexOf('Summary')).toBeLessThan(text.indexOf('Notes'));
});

test('375px bilingual demo stays usable and does not overflow or weaken split validation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, rangeLabel] of [
    ['/split-pdf/', 'Page ranges'],
    ['/zh/split-pdf/', '页码范围'],
  ]) {
    await page.goto(path);
    await expect(page.getByTestId('demo-guidance')).toBeVisible();
    await expect(page.getByTestId('workspace-load-demo')).toBeEnabled();
    await page.getByTestId('workspace-load-demo').click();
    await expect(page.locator('.file-count')).toContainText('4');
    await page.getByRole('textbox', { name: rangeLabel, exact: true }).fill('5');
    await expect(page.locator('.split-download')).toBeDisabled();
    await page.getByRole('textbox', { name: rangeLabel, exact: true }).fill('1-2, 3-4');
    await expect(page.locator('.split-download')).toBeEnabled();
    const size = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll, path).toBeLessThanOrEqual(size.viewport + 2);
  }
});


test('workspace: user file import overrides a delayed demo GET without appending demo pages', async ({ page }) => {
  await page.goto('/workspace/');
  let release, intercepted;
  const requested = new Promise(resolve => { intercepted = resolve; });
  await page.route('**/samples/plainmile-demo.pdf', async route => {
    await new Promise(resolve => { release = resolve; intercepted(); });
    await route.continue();
  });
  await page.getByTestId('workspace-load-demo').click();
  await requested;
  const custom = await PDFDocument.create();
  custom.addPage([471, 470]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'my-private-input.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await custom.save()),
  });
  await expect(page.locator('.file-count')).toContainText('1 page');
  const response = page.waitForResponse('**/samples/plainmile-demo.pdf');
  release();
  await response;
  await expect(page.locator('.file-count')).toContainText('1 page');
  await expect(page.locator('.file-count')).toContainText('1 file');
  const out = await captureDownload(page, () => page.getByRole('button', { name: 'Export PDF' }).click());
  expect(await pdfWidths(out.bytes)).toEqual([471]);
});

test('standalone converter: an explicit user PDF wins over delayed example loading', async ({ page }) => {
  await page.goto('/pdf-to-txt/');
  let release, intercepted;
  const requested = new Promise(resolve => { intercepted = resolve; });
  await page.route('**/samples/plainmile-demo.pdf', async route => {
    await new Promise(resolve => { release = resolve; intercepted(); });
    await route.continue();
  });
  await page.getByTestId('utility-load-demo').click();
  await requested;
  const custom = await PDFDocument.create();
  custom.addPage([483, 470]);
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'real-user-file.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await custom.save()),
  });
  await expect(page.getByTestId('utility-file-summary')).toContainText('real-user-file.pdf');
  const response = page.waitForResponse('**/samples/plainmile-demo.pdf');
  release();
  await response;
  await expect(page.getByTestId('utility-file-summary')).toContainText('real-user-file.pdf');
  await expect(page.getByTestId('utility-file-summary')).not.toContainText('plainmile-demo.pdf');
});

test('task-first bilingual 375px tool layout keeps upload above crawlable example help', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, loadTestId] of [
    ['/split-pdf/', 'workspace-load-demo'],
    ['/zh/split-pdf/', 'workspace-load-demo'],
    ['/pdf-to-txt/', 'utility-load-demo'],
    ['/zh/pdf-to-txt/', 'utility-load-demo'],
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const toolIndex = html.indexOf('workspace-with-demo');
    const sampleIndex = html.indexOf('data-testid="demo-guidance"');
    expect(toolIndex, path).toBeGreaterThan(-1);
    expect(sampleIndex, path).toBeGreaterThan(toolIndex);
    expect(html, path).toContain('rel="canonical"');
    expect(html, path).toContain('hreflang="en"');
    expect(html, path).toContain('hreflang="zh-CN"');
    expect(html, path).toMatch(/href="\\/samples\\/plainmile-demo\\.pdf"/);

    await page.goto(path);
    await expect(page.getByTestId(loadTestId)).toBeEnabled();
    const positions = await page.evaluate(() => {
      const tool = document.querySelector('.workspace-outer');
      const guide = document.querySelector('[data-testid="demo-guidance"]');
      return {
        toolTop: tool?.getBoundingClientRect().top,
        guideTop: guide?.getBoundingClientRect().top,
        toolBottom: tool?.getBoundingClientRect().bottom,
        gap: guide?.getBoundingClientRect().top - tool?.getBoundingClientRect().bottom,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        guideText: guide?.textContent || '',
      };
    });
    expect(positions.toolTop, path).toBeLessThan(positions.guideTop);
    expect(positions.toolBottom, path).toBeLessThan(positions.guideTop);
    expect(positions.gap, path).toBeLessThan(100);
    expect(positions.scrollWidth, path).toBeLessThanOrEqual(positions.clientWidth + 2);
    if (path.startsWith('/zh/')) expect(positions.guideText).toContain('上方工具');
    else expect(positions.guideText).toContain('tool above');
  }
});
