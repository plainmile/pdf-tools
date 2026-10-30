import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function fixturePdf(pageCount = 3) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage([420, 594]);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function danglingControls(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[aria-controls]')].flatMap(element => {
      const targetIds = (element.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
      return targetIds.filter(id => !document.getElementById(id))
        .map(id => element.tagName.toLowerCase() + '[aria-controls=' + id + ']');
    }));
}

test('workspace tabs and optional controls keep valid targets without loading hidden thumbnails', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ['/workspace/', '/zh/workspace/', '/split-pdf/']) {
    await page.goto(route);
    await expect(page.getByTestId('pdf-workspace')).toBeVisible();
    expect(await danglingControls(page)).toEqual([]);
    await page.locator('#workspace-tab-split').click();
    expect(await danglingControls(page)).toEqual([]);
    await page.locator('#workspace-tab-organize').click();
    expect(await danglingControls(page)).toEqual([]);
  }

  await page.getByTestId('file-input').setInputFiles({
    name: 'controls.pdf', mimeType: 'application/pdf', buffer: await fixturePdf(),
  });
  await expect(page.getByTestId('page-tile')).toHaveCount(3);
  expect(await danglingControls(page)).toEqual([]);

  await expect(page.locator('#export-options-panel')).toBeHidden();
  await page.getByTestId('export-options-button').click();
  await expect(page.locator('#export-options-panel')).toBeVisible();
  expect(await danglingControls(page)).toEqual([]);
  await page.getByTestId('export-options-button').click();
  await expect(page.locator('#export-options-panel')).toBeHidden();
  expect(await danglingControls(page)).toEqual([]);

  await page.getByTestId('workspace-view-grouped').click();
  await expect(page.getByTestId('source-group-pages')).toHaveCount(1);
  await page.getByTestId('source-groups-collapse-all').click();
  await expect(page.getByTestId('source-group-pages')).toHaveCount(0);
  expect(await danglingControls(page)).toEqual([]);
  await page.getByTestId('source-groups-expand-all').click();
  await expect(page.getByTestId('source-group-pages')).toHaveCount(1);
  expect(await danglingControls(page)).toEqual([]);

  await page.locator('#workspace-tab-split').click();
  expect(await danglingControls(page)).toEqual([]);
  await page.locator('#workspace-tab-organize').click();
  expect(await danglingControls(page)).toEqual([]);
});

test('compression disclosure retains its ARIA target when the PDF preview is closed', async ({ page }) => {
  await page.goto('/compress-pdf/');
  await expect(page.getByTestId('pdf-utility')).toBeVisible();
  await page.getByTestId('utility-file-input').setInputFiles({
    name: 'unoptimized.pdf', mimeType: 'application/pdf', buffer: await fixturePdf(18),
  });
  await expect(page.getByTestId('utility-file-summary')).toBeVisible();
  await page.getByTestId('utility-run').click();
  await expect(page.getByTestId('compression-download')).toBeEnabled();
  const toggle = page.getByTestId('compression-preview-action');
  await expect(toggle).toBeVisible();
  await expect(page.locator('#compression-preview-content')).toBeHidden();
  expect(await danglingControls(page)).toEqual([]);
  await toggle.click();
  await expect(page.getByTestId('compression-preview')).toBeVisible();
  expect(await danglingControls(page)).toEqual([]);
  await toggle.click();
  await expect(page.locator('#compression-preview-content')).toBeHidden();
  expect(await danglingControls(page)).toEqual([]);
});
