import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('a scanned image with a long selectable footer must not silently auto-download partial TXT or Markdown', async ({ page }) => {
  test.setTimeout(60000);
  const base64Image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 420; canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 420, 400);
    ctx.fillStyle = '#111';
    ctx.font = '26px serif';
    ctx.fillText('BODY IS SCANNED IMAGE', 12, 90);
    ctx.fillText('NOT SELECTABLE TEXT', 12, 145);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([500,700]).drawText('Readable cover content', {x:40,y:600,font,size:14});
  const scanned = doc.addPage([500,700]);
  const image = await doc.embedPng(Buffer.from(base64Image, 'base64'));
  scanned.drawImage(image, {x:35,y:150,width:430,height:460});
  scanned.drawText('Confidential archive / Page 21 of 240', {x:40,y:35,font,size:10});
  doc.addPage([500,700]).drawText('Readable ending content', {x:40,y:600,font,size:14});
  const input = Buffer.from(await doc.save());
  for (const path of ['/pdf-to-txt/','/zh/pdf-to-markdown/']) {
    await page.goto(path);
    await page.getByTestId('utility-file-input').setInputFiles({
      name: 'scan-with-footer.pdf', mimeType:'application/pdf', buffer: input,
    });
    await expect(page.getByTestId('utility-file-summary')).toContainText('3');
    const automatic = [];
    const onDownload = d => automatic.push(d);
    page.on('download', onDownload);
    await page.getByTestId('utility-run').click();
    await expect(page.getByTestId('suspect-text-result')).toBeVisible();
    await expect(page.getByTestId('text-extraction-warning')).toContainText('2');
    expect(automatic).toHaveLength(0);
    const downloaded = page.waitForEvent('download');
    await page.getByTestId('suspect-text-download').click();
    const file = await downloaded;
    const text = (await readFile(await file.path())).toString('utf8');
    expect(text).toContain('Confidential archive / Page 21 of 240');
    expect(text).toContain('Readable ending content');
    expect(text).not.toContain('BODY IS SCANNED IMAGE');
    page.off('download', onDownload);
  }
});
