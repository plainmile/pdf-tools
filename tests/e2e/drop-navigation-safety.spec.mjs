import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function smallPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 420]);
  return Buffer.from(await pdf.save()).toString('base64');
}

for (const { path, workspace } of [
  { path: '/merge-pdf/', workspace: true },
  { path: '/zh/pdf-to-images/', workspace: false },
]) {
  test(`OS file dropped on non-upload header cannot navigate away from ${path}; real dropzone still imports`, async ({ page }) => {
    await page.goto(path);
    // A browser normally opens a file dropped on an unhandled header/footer,
    // potentially discarding the in-memory PDF and any Undo/download state.
    const safety = await page.evaluate(() => {
      const header = document.querySelector('.site-header');
      if (!header) throw new Error('Expected site header');
      const local = new DataTransfer();
      local.items.add(new File(['not a real PDF'], 'outside.pdf', { type: 'application/pdf' }));
      const link = new DataTransfer();
      link.setData('text/uri-list', 'https://example.com/');
      const emit = (type, transfer) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
        header.dispatchEvent(event);
        return event.defaultPrevented;
      };
      return {
        fileOver: emit('dragover', local),
        fileDrop: emit('drop', local),
        linkOver: emit('dragover', link),
        linkDrop: emit('drop', link),
      };
    });
    expect(safety).toEqual({ fileOver: true, fileDrop: true, linkOver: false, linkDrop: false });
    await expect(page).toHaveURL(new RegExp(path.replaceAll('/', '\\/') + '$'));

    // The protection is NOT a second import handler: dropping onto the
    // existing task-specific area must still perform a real local import.
    const encoded = await smallPdf();
    const drop = await page.evaluate(({ base64, selector }) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped.pdf', { type: 'application/pdf' }));
      const target = document.querySelector(selector);
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }, { base64: encoded, selector: workspace ? '[data-testid="dropzone"]' : '[data-testid="utility-dropzone"]' });
    expect(drop).toBe(true);
    if (workspace) {
      await expect(page.getByTestId('page-tile')).toHaveCount(1);
    } else {
      await expect(page.getByTestId('utility-file-summary')).toContainText('dropped.pdf');
    }
  });
}
