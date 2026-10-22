import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFDict, PDFName } from 'pdf-lib';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

async function fixturePdf(label = 'Hello PDF world', count = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < count; n++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(label + ' ' + (n + 1), { x: 30, y: 715, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

async function upload(page, bytes) {
  await page.getByTestId('utility-file-input').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
}

async function getDownload(page, action) {
  const event = page.waitForEvent('download', { timeout: 6000 }).catch(async () => {
    const errors = await page.getByRole('alert').allTextContents();
    const messages = await page.getByRole('status').allTextContents();
    throw new Error('No PDF utility download. Alerts: ' + JSON.stringify(errors) + '; Status: ' + JSON.stringify(messages));
  });
  await action();
  const download = await event;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test('PDF to image PNG selected pages ZIP has valid images, JPG single page valid JPEG', async ({ page }) => {
  await page.goto('/pdf-to-images/');
  await upload(page, await fixturePdf());
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('png');
  const multi = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(multi.name).toMatch(/\.zip$/);
  const zip = await JSZip.loadAsync(multi.bytes);
  const names = Object.keys(zip.files).sort();
  expect(names).toEqual(['page-001.png', 'page-002.png']);
  const png = await zip.files[names[0]].async('uint8array');
  expect(Array.from(png.slice(0, 8))).toEqual([137,80,78,71,13,10,26,10]);
  await page.getByRole('combobox', { name: 'Image format' }).selectOption('jpg');
  await page.getByTestId('utility-page-ranges').fill('2');
  const single = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(single.name).toMatch(/\.jpg$/);
  expect(Array.from(single.bytes.slice(0, 3))).toEqual([255,216,255]);
});

test('compression never auto-downloads, blocks a larger PDF, and shows actual byte sizes', async ({ page }) => {
  const small = await fixturePdf('Small page', 1);
  await page.goto('/compress-pdf/');
  await upload(page, small);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-result')).toBeVisible({ timeout: 3000 }).catch(async () => {
    throw new Error('Compression output missing. Alerts: ' + JSON.stringify(await page.getByRole('alert').allTextContents()));
  });
  await expect(page.getByTestId('compression-download')).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('No size reduction');

  const rawPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 700;
    const ctx = canvas.getContext('2d'); const image = ctx.createImageData(700,700);
    // Deterministic non-compressible PNG; JPEG significantly shrinks this PDF.
    let n = 12345;
    for (let p = 0; p < image.data.length; p += 4) {
      n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
      image.data[p] = n & 255; image.data[p + 1] = (n >>> 8) & 255;
      image.data[p + 2] = (n >>> 16) & 255; image.data[p + 3] = 255;
    }
    ctx.putImageData(image,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const imageDoc = await PDFDocument.create();
  const image = await imageDoc.embedPng(Buffer.from(rawPng, 'base64'));
  imageDoc.addPage([595.28,841.89]).drawImage(image, {x:0,y:0,width:595,height:841});
  const input = Buffer.from(await imageDoc.save());
  await upload(page, input);
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  const compressed = await getDownload(page, () => page.getByTestId('compression-download').click());
  expect(compressed.bytes.byteLength).toBeLessThan(input.byteLength);
  expect((await PDFDocument.load(compressed.bytes)).getPageCount()).toBe(1);
});

test('PDF to TXT and Markdown extract actual text, reject empty scanned pages', async ({ page }) => {
  const pdf = await fixturePdf('Hello searchable PlainMile');
  for (const [path, extension] of [['/pdf-to-txt/', 'txt'], ['/pdf-to-markdown/', 'md']]) {
    await page.goto(path);
    await upload(page, pdf);
    const downloaded = await getDownload(page, () => page.getByTestId('utility-run').click());
    expect(downloaded.name).toMatch(new RegExp('\\.' + extension + '$'));
    expect(downloaded.bytes.toString('utf8')).toContain('Hello searchable PlainMile');
  }
  const empty = await PDFDocument.create(); empty.addPage([400,400]);
  await page.goto('/pdf-to-txt/');
  await upload(page, Buffer.from(await empty.save()));
  await page.getByTestId('utility-run').click();
  await expect(page.getByRole('alert')).toContainText('No selectable text');
});

test('TXT to PDF yields selectable text; Markdown to PDF supports Chinese via local raster pages', async ({ page }) => {
  await page.goto('/txt-to-pdf/');
  await page.getByTestId('utility-text').fill('Hello selectable world');
  const latin = await getDownload(page, () => page.getByTestId('utility-run').click());
  const pdf = await PDFDocument.load(latin.bytes);
  expect(pdf.getPageCount()).toBe(1);
  await page.goto('/pdf-to-txt/');
  await upload(page, latin.bytes);
  const extracted = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect(extracted.bytes.toString('utf8')).toContain('Hello selectable world');
  await page.goto('/zh/markdown-to-pdf/');
  await page.getByTestId('utility-text').fill('# 中文标题\n\n- 第一项\n- 第二项');
  const cjk = await getDownload(page, () => page.getByTestId('utility-run').click());
  const result = await PDFDocument.load(cjk.bytes);
  expect(result.getPageCount()).toBe(1);
  const resources = result.context.lookup(result.getPage(0).node.Resources(), PDFDict);
  expect(result.context.lookup(resources.get(PDFName.of('XObject')), PDFDict).keys().length).toBeGreaterThan(0);
  await expect(page.getByRole('status')).toContainText('无法选择和搜索文字');
});

test('numbered PDF stores the requested starting numbers as selectable text', async ({ page }) => {
  await page.goto('/add-page-numbers/');
  await upload(page, await fixturePdf());
  await page.getByTestId('number-start').fill('7');
  await page.getByRole('combobox', { name: 'Position' }).selectOption('top-right');
  const downloaded = await getDownload(page, () => page.getByTestId('utility-run').click());
  expect((await PDFDocument.load(downloaded.bytes)).getPageCount()).toBe(2);
  await page.goto('/pdf-to-txt/');
  await upload(page, downloaded.bytes);
  const text = (await getDownload(page, () => page.getByTestId('utility-run').click())).bytes.toString('utf8');
  expect(text).toMatch(/\b7\b/);
  expect(text).toMatch(/\b8\b/);
});

test('all new Chinese/English landing routes and footer open-source attribution', async ({ page }) => {
  for (const path of ['pdf-to-images','compress-pdf','pdf-to-txt','pdf-to-markdown','txt-to-pdf','markdown-to-pdf','add-page-numbers']) {
    for (const prefix of ['/', '/zh/']) {
      const response = await page.goto(prefix + path + '/');
      expect(response?.status(), prefix + path).toBe(200);
      await expect(page.getByTestId('pdf-utility')).toBeVisible();
      await expect(page.getByRole('link', { name: /GitHub (source code|开源代码)/ })).toHaveAttribute('href', 'https://github.com/plainmile/pdf-tools');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://pdf.plainmile.com' + prefix + path + '/');
    }
  }
});
