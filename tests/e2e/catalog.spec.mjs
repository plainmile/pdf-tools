import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('English tool catalog presents grouped static links and four popular shortcuts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('[data-tool-group]')).toHaveCount(4);
  await expect(page.locator('[data-tool-card]')).toHaveCount(16);
  await expect(page.locator('.quick-link')).toHaveCount(4);
  await expect(page.locator('a.tool-card[href="/merge-pdf/"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Organize pages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Convert from PDF' })).toBeVisible();
});

test('tool search filters only relevant tools and clear restores all options', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Find a PDF tool' });
  await search.fill('compress');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/compress-pdf/"]')).toBeVisible();
  await expect(page.locator('[data-tool-group]:visible')).toHaveCount(1);
  await expect(page.locator('[data-tool-group]:visible [data-tool-group-count]')).toHaveText('1 tool');
  await expect(page.locator('[data-category-link]:visible')).toHaveCount(1);
  const visibleGroupId = await page.locator('[data-tool-group]:visible').getAttribute('id');
  await expect(page.locator('[data-category-link]:visible')).toHaveAttribute('href', '#' + visibleGroupId);
  await search.fill('no-such-tool-match');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(0);
  await expect(page.getByText('No tools match that search')).toBeVisible();
  await expect(page.locator('[data-category-jump]')).toBeHidden();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(16);
  await expect(page.locator('[data-category-link]:visible')).toHaveCount(4);
  const groupCounts = await page.locator('[data-tool-group-count]').allTextContents();
  expect(groupCounts.reduce((sum, label) => sum + Number.parseInt(label, 10), 0)).toBe(16);
});


test('localized tool finder respects conversion direction and fullwidth aliases', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Find a PDF tool' });
  await search.fill('JPG to PDF');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/image-to-pdf/"]')).toBeVisible();
  await search.fill('PDF to JPG');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/pdf-to-images/"]')).toBeVisible();
  await search.fill('  JPG   TO   PDF  ');
  await expect(page.locator('a.tool-card[href="/image-to-pdf/"]')).toBeVisible();

  await page.goto('/zh/');
  const zhSearch = page.getByRole('searchbox', { name: '搜索工具' });
  await zhSearch.fill('ＪＰＧ 转 ＰＤＦ');
  await expect(page.locator('a.tool-card[href="/zh/image-to-pdf/"]')).toBeVisible();
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await zhSearch.fill('PDF转JPG');
  await expect(page.locator('a.tool-card[href="/zh/pdf-to-images/"]')).toBeVisible();
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
});

test('conversion search accepts arrows and Chinese verbs without reversing direction', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Find a PDF tool' });
  for (const query of ['JPG → PDF', 'JPG -> PDF']) {
    await search.fill(query);
    await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
    await expect(page.locator('a.tool-card[href="/image-to-pdf/"]')).toBeVisible();
  }
  await search.fill('PDF → JPG');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/pdf-to-images/"]')).toBeVisible();

  await page.goto('/zh/');
  const zhSearch = page.getByRole('searchbox', { name: '搜索工具' });
  for (const query of ['PDF 转换成 JPG', 'PDF转为JPG']) {
    await zhSearch.fill(query);
    await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
    await expect(page.locator('a.tool-card[href="/zh/pdf-to-images/"]')).toBeVisible();
  }
  await zhSearch.fill('JPG 转换为 PDF');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/zh/image-to-pdf/"]')).toBeVisible();
});

test('reciprocal converter navigation is crawlable with localized breadcrumbs', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [route, target, breadcrumb] of [
      ['/pdf-to-txt/', '/txt-to-pdf/', 'Breadcrumb'],
      ['/zh/pdf-to-markdown/', '/zh/markdown-to-pdf/', '面包屑导航'],
      ['/pdf-to-images/', '/image-to-pdf/', 'Breadcrumb'],
      ['/zh/extract-pages/', '/zh/split-pdf/', '面包屑导航'],
    ]) {
      await page.goto(route);
      await expect(page.locator('.below-tools a[href="' + target + '"]')).toHaveCount(1);
      const nav = page.getByRole('navigation', { name: breadcrumb });
      await expect(nav).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }
  } finally { await context.close(); }
});

test('tool finder announces localized match counts and no-match status to assistive technology', async ({ page }) => {
  await page.goto('/');
  const status = page.locator('[data-tool-results]');
  await expect(status).toBeHidden();
  await page.getByRole('searchbox', { name: 'Find a PDF tool' }).fill('compress');
  await expect(status).toHaveText('1 matching tools.');
  await expect(status).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a PDF tool' }).fill('no-such-tool-match');
  await expect(status).toHaveText('0 matching tools.');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(status).toBeHidden();

  await page.goto('/zh/');
  const zhSearch = page.getByRole('searchbox', { name: '搜索工具' });
  await zhSearch.fill('水印');
  await expect(status).toHaveText('找到 1 个工具。');
  await zhSearch.fill('不存在的工具名称123');
  await expect(status).toHaveText('找到 0 个工具。');
});

test('Chinese catalog search, categories and links work on mobile without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/');
  await expect(page.getByRole('heading', { name: '选择您要做的操作' })).toBeVisible();
  const box = page.getByRole('searchbox', { name: '搜索工具' });
  await box.fill('水印');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(1);
  await expect(page.locator('a.tool-card[href="/zh/watermark-pdf/"]')).toBeVisible();
  await expect(page.locator('[data-tool-group]:visible [data-tool-group-count]')).toHaveText('1 个工具');
  await expect(page.locator('[data-category-link]:visible')).toHaveCount(1);
  await box.fill('');
  await expect(page.locator('[data-tool-card]:visible')).toHaveCount(16);
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 2);
});

test('mobile PDF forms use readable 16px input text without causing horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const inspect = async (selectors) => {
    for (const selector of selectors) {
      const input = page.locator(selector).first();
      await expect(input, selector).toHaveCount(1);
      const size = await input.evaluate(element =>
        Number.parseFloat(window.getComputedStyle(element).fontSize));
      expect(size, selector + ' should avoid iPhone Safari focus zoom').toBeGreaterThanOrEqual(16);
    }
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 2);
  };

  await page.goto('/zh/');
  await inspect(['[data-tool-search]']);

  await page.goto('/zh/txt-to-pdf/');
  await inspect(['[data-testid="utility-text"]']);

  await page.goto('/zh/pdf-to-images/');
  await inspect(['[data-testid="utility-page-ranges"]', '.utility-options select']);

  await page.goto('/zh/split-pdf/');
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'phone.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.file-count')).toContainText('1 页');
  await expect(page.locator('.split-intro')).toBeVisible();
  await inspect(['#ranges-input', '#chunk-input', '#download-name-input']);

  const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(meta).toContain('width=device-width');
  expect(meta).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/i);

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  const desktopFontSize = await page.locator('[data-tool-search]').evaluate(element =>
    Number.parseFloat(window.getComputedStyle(element).fontSize));
  expect(desktopFontSize).toBeLessThan(16);
});

test('English tool help is readable, accessible and structured data describes real task', async ({ page }) => {
  await page.goto('/compress-pdf/');
  const accordion = page.locator('.faq-item').first();
  await expect(accordion).toBeVisible();
  await accordion.locator('summary').click();
  await expect(accordion).toHaveAttribute('open', '');
  await expect(accordion.locator('p')).toContainText('document optimization rewrites PDF object streams');
  await expect(accordion.locator('p')).toContainText('JPEG page compression');
  await expect(accordion.locator('p')).toContainText('digital signatures');
  const schema = await page.locator('script[type="application/ld+json"]').textContent();
  const schemas = JSON.parse(schema);
  expect(schemas.find(x => x['@type'] === 'WebApplication')).toMatchObject({
    url: 'https://pdf.plainmile.com/compress-pdf/',
    isAccessibleForFree: true,
  });
  expect(schemas.find(x => x['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(2);
  const origin = await page.locator('a[href="https://github.com/plainmile/pdf-tools"]').count();
  expect(origin).toBe(1);
});

test('bilingual 36-page SEO JSON-LD and metadata are parsable and not spammy', async ({ page }) => {
  for (const path of ['/', '/zh/', '/merge-pdf/', '/zh/merge-pdf/', '/pdf-to-images/', '/zh/pdf-to-images/']) {
    await page.goto(path);
    const raw = await page.locator('script[type="application/ld+json"]').textContent();
    const data = JSON.parse(raw);
    const types = (Array.isArray(data) ? data : [data]).map(x => x['@type']);
    if (path === '/' || path === '/zh/') expect(types).toContain('WebSite');
    else { expect(types).toContain('BreadcrumbList'); expect(types).toContain('WebApplication'); }
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|reviewCount|FAQPage/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://pdf.plainmile.com' + path);
  }
});

test('tool landing page contains contextual related links and indexable FAQ when scripts are disabled', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  try {
    const response = await page.goto('/zh/pdf-to-txt/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '常见问题' })).toBeVisible();
    await expect(page.locator('.faq-item')).toHaveCount(2);
    await expect(page.locator('.below-tools a[href="/zh/pdf-to-images/"]')).toHaveCount(1);
    const ld = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(ld).find(x => x['@type'] === 'WebApplication').name).toBe('PDF 转 TXT');
    // All home catalog links are real server-rendered HTML (no SPA indexing dependency).
    await page.goto('/zh/');
    await expect(page.locator('[data-tool-card]')).toHaveCount(16);
  } finally {
    await ctx.close();
  }
});

test('Chinese split copy explains per-download limits and 50-file batches for long books', async ({ page }) => {
  await page.goto('/zh/split-pdf/');
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  await page.getByTestId('file-input').setInputFiles({
    name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.split-intro')).toContainText('每批下载最多 50 份');
  await expect(page.locator('.split-intro')).not.toContainText('最多生成 50 份');
});

test('both languages visibly credit the original website, including when JavaScript is off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const [path, label] of [
      ['/', 'Official site'],
      ['/zh/', '官方网站'],
      ['/compress-pdf/', 'Official site'],
      ['/zh/merge-pdf/', '官方网站'],
    ]) {
      await page.goto(path);
      const source = page.locator('footer a[data-official-site]');
      await expect(source, path).toHaveCount(1);
      await expect(source).toBeVisible();
      await expect(source).toHaveAttribute('href', 'https://pdf.plainmile.com/');
      await expect(source).toContainText(label);
      await expect(source).toContainText('pdf.plainmile.com');
      const rel = await source.getAttribute('rel');
      expect(rel).toMatch(/\bnofollow\b/);
    }
  } finally { await context.close(); }
});

test('every standalone converter has visible bilingual file-drop guidance', async ({ page }) => {
  for (const locale of ['en','zh']) {
    for (const slug of ['pdf-to-images','compress-pdf','pdf-to-txt','pdf-to-markdown','txt-to-pdf','markdown-to-pdf','add-page-numbers']) {
      await page.goto((locale === 'zh' ? '/zh/' : '/') + slug + '/');
      const zone = page.getByTestId('utility-dropzone');
      await expect(zone).toBeVisible();
      await expect(zone.locator('input[type="file"]')).toHaveCount(1);
      await expect(zone).toContainText(locale === 'zh' ? '不会上传至服务器' : 'Nothing is uploaded');
    }
  }
});

test('localized footer provides a clear privacy-safe issue reporting route', async ({ page }) => {
  for (const [route, label] of [['/', 'Report an issue'], ['/zh/', '反馈问题']]) {
    await page.goto(route);
    const report = page.locator('[data-report-issue]');
    await expect(report).toHaveText(label + ' ↗');
    await expect(report).toHaveAttribute('href', 'https://github.com/plainmile/pdf-tools/issues/new/choose');
    await expect(report).toHaveAttribute('rel', /noopener noreferrer/);
  }
});

test('375px mobile tool pages retain visible, keyboard-usable top navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/zh/image-to-pdf/');
  const nav = page.getByRole('navigation', { name: '主要导航' });
  await expect(nav.getByRole('link', { name: '合并 PDF' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '拆分 PDF' })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(fits).toBe(true);
  await nav.getByRole('link', { name: '拆分 PDF' }).click();
  await expect(page).toHaveURL(/\/zh\/split-pdf\/$/);
});

test('organize PDF page copy/blank help remains indexable in both languages without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/organize-pdf/');
    await expect(page.locator('main')).toContainText('duplicate');
    await expect(page.locator('main')).toContainText('blank PDF pages');
    await expect(page.locator('.tool-faq')).toContainText('600-page workspace limit');

    await page.goto('/zh/organize-pdf/');
    await expect(page.locator('main')).toContainText('复制 PDF 页面');
    await expect(page.locator('main')).toContainText('插入空白页');
    await expect(page.locator('.tool-faq')).toContainText('600 页');
  } finally {
    await context.close();
  }
});
