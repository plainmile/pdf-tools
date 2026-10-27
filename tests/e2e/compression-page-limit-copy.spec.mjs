import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('121-page PDF correctly explains both compression methods in English and Chinese', async ({ page }) => {
  test.setTimeout(60000);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 121; i++) pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save());

  for (const locale of ['en', 'zh']) {
    await page.goto(locale === 'zh' ? '/zh/compress-pdf/' : '/compress-pdf/');
    const method = page.getByTestId('compression-strategy');
    for (const strategy of ['structure', 'raster']) {
      await method.selectOption(strategy);
      await page.getByTestId('utility-file-input').setInputFiles({
        name: 'book.pdf', mimeType: 'application/pdf', buffer: bytes,
      });
      await expect(page.getByRole('alert')).toContainText(locale === 'zh'
        ? '120 页，包括保留文字与 JPEG 图片化模式'
        : '120 pages per run in both text-preserving and JPEG modes');
      await expect(page.getByTestId('utility-file-summary')).toHaveCount(0);
      await expect(page.getByTestId('utility-run')).toBeDisabled();
    }
  }
});
