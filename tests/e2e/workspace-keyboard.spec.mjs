import { test, expect } from '@playwright/test';

for (const locale of ['en', 'zh']) {
  test(`workspace tabs wrap arrow keys and honor Home/End (${locale})`, async ({ page }) => {
    await page.goto(locale === 'zh' ? '/zh/workspace/' : '/workspace/');
    const organize = page.locator('[data-workspace-tab="organize"]');
    const split = page.locator('[data-workspace-tab="split"]');
    await expect(organize).toHaveAttribute('aria-selected', 'true');
    await expect(split).toHaveAttribute('aria-selected', 'false');

    // The first tab must wrap BACKWARD to the last tab, with focus and panel
    // updated together. Previously ArrowLeft left the first tab selected.
    await organize.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(split).toBeFocused();
    await expect(split).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#workspace-panel-split[role="tabpanel"]')).toHaveCount(1);

    // The last tab must wrap FORWARD to the first tab.
    await page.keyboard.press('ArrowRight');
    await expect(organize).toBeFocused();
    await expect(organize).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#workspace-panel-organize[role="tabpanel"]')).toHaveCount(1);

    // Ordinary directional movement still works, and Home/End choose edges
    // without changing the URL or causing any document-related side effects.
    await page.keyboard.press('ArrowRight');
    await expect(split).toBeFocused();
    await page.keyboard.press('Home');
    await expect(organize).toBeFocused();
    await page.keyboard.press('End');
    await expect(split).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(organize).toBeFocused();

    await expect(page).toHaveURL(new RegExp(
      locale === 'zh' ? '/zh/workspace/$' : '/workspace/$'
    ));
    await expect(page.getByTestId('dropzone')).toBeVisible();
  });
}
