import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const domain = 'https://pdf.plainmile.com';
const screenshotDir = process.env.LIVE_SCREENSHOT_DIR || '';
const slugs = ['', 'workspace/', 'merge-pdf/', 'split-pdf/', 'organize-pdf/',
 'rotate-pdf/', 'extract-pages/', 'delete-pages/', 'image-to-pdf/', 'watermark-pdf/', 'pdf-to-images/', 'compress-pdf/', 'pdf-to-txt/', 'pdf-to-markdown/', 'txt-to-pdf/', 'markdown-to-pdf/', 'add-page-numbers/', 'privacy/'];
const indexablePaths = new Set(slugs.flatMap(slug => ['/' + slug, '/zh/' + slug]));

test('live sitemap, robots, routes, PDF worker, 404', async ({ request }) => {
 const robots = await request.get('/robots.txt');
 expect(robots.status()).toBe(200);
 expect(await robots.text()).toContain('Sitemap: ' + domain + '/sitemap-index.xml');
 const index = await request.get('/sitemap-index.xml');
 expect(index.status()).toBe(200);
 const sitemapURLs = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
 expect(sitemapURLs.length).toBeGreaterThan(0);
 let allURLs = [];
 for (const url of sitemapURLs) {
  const response = await request.get(new URL(url).pathname);
  expect(response.status(),url).toBe(200);
  allURLs.push(...[...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
 }
 for (const slug of slugs) {
  expect(allURLs).toContain(domain + '/' + slug);
  expect(allURLs).toContain(domain + '/zh/' + slug);
 }
 expect(new Set(allURLs).size, 'sitemap duplicate URLs').toBe(allURLs.length);
 expect(allURLs.some(url => /\/404(?:\/|\.html|$)/.test(url)), '404 must not appear in sitemap').toBe(false);
 expect(allURLs.length, 'sitemap must list only our 36 indexable EN/ZH pages').toBe(indexablePaths.size);
 for (const url of allURLs) {
  const address = new URL(url);
  expect(address.origin, 'sitemap URL must use the official origin').toBe(domain);
  expect(indexablePaths.has(address.pathname), 'unexpected sitemap URL: ' + url).toBe(true);
 }
 const worker = await request.get('/pdfjs/pdf.worker.min.mjs');
 expect(worker.status()).toBe(200);
 expect(worker.headers()['content-type']).toMatch(/javascript/i);
 expect((await worker.body()).byteLength).toBeGreaterThan(100000);
 const missing = await request.get('/__qa_missing_20261022_9485');
 expect(missing.status()).toBe(404);
 const missingHtml = await missing.text();
 expect(missingHtml).toMatch(/name="robots"\s+content="noindex, nofollow"/);
 // No translated 404 exists at /zh/404; keep missing routes out of hreflang
 // and canonical, and give visitors a bilingual link to the actual homepage.
 expect(missingHtml).not.toMatch(/rel="canonical"|hreflang="(?:en|zh-CN|x-default)"/);
 expect(missingHtml).not.toContain('/zh/404');
 expect(missingHtml).toContain('Back to PDF tools');
 expect(missingHtml).toContain('href="/zh/"');
 expect(missingHtml).toContain('返回中文工具首页');
});

test('SEO and AI answer-readiness audit of 36 live URLs', async ({ page }) => {
 const seenTitles = new Set(), seenDescriptions = new Set(), audit = [];
 for (const locale of ['en', 'zh']) {
  for (const slug of slugs) {
   const path = locale === 'zh' ? '/zh/' + slug : '/' + slug;
   const response = await page.goto(path, {waitUntil:'domcontentloaded'});
   expect(response?.status(), path).toBe(200);
   const meta = await page.evaluate(() => {
    const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap(element => {
       const data = JSON.parse(element.textContent || 'null');
       return Array.isArray(data) ? data : [data];
      }).filter(Boolean);
    return {
    lang: document.documentElement.lang,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    en: document.querySelector('link[hreflang="en"]')?.href || '',
    zh: document.querySelector('link[hreflang="zh-CN"]')?.href || '',
    defaultLang: document.querySelector('link[hreflang="x-default"]')?.href || '',
    h1: document.querySelectorAll('h1').length,
    mainChars: (document.querySelector('main')?.textContent || '').trim().length,
    jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
    officialSiteHref: document.querySelector('footer a[data-official-site]')?.href || '',
    officialSiteRel: document.querySelector('footer a[data-official-site]')?.rel || '',
    officialSiteText: document.querySelector('footer a[data-official-site]')?.textContent?.trim() || '',
    schemas: schemas.map(schema => ({
      type: schema['@type'], name: schema.name, description: schema.description,
      url: schema.url, inLanguage: schema.inLanguage,
      breadcrumbItems: schema.itemListElement?.map(entry => entry.item),
    })),
    localLinks: [...document.querySelectorAll('a[href]')]
      .map(anchor => new URL(anchor.href))
      .filter(link => link.origin === location.origin)
      .map(link => link.pathname),
    };
   });
   expect(meta.lang,path).toBe(locale==='en'?'en':'zh-CN');
   expect(meta.title.length,path).toBeGreaterThan(15);
   expect(meta.description.length,path).toBeGreaterThan(locale === 'zh' ? 20 : 35);
   expect(meta.robots,path).toMatch(/index,\s*follow/i);
   expect(meta.canonical,path).toBe(domain+path);
   expect(meta.en,path).toBe(domain+'/'+slug);
   expect(meta.zh,path).toBe(domain+'/zh/'+slug);
   expect(meta.defaultLang,path).toBe(domain+'/'+slug);
   expect(meta.h1,path).toBe(1);
   expect(meta.mainChars,path).toBeGreaterThan(150);
   expect(meta.ogTitle,path).not.toBe('');
   expect(meta.officialSiteHref,path+' official project link').toBe(domain+'/');
   expect(meta.officialSiteText,path+' visible credit').toContain('pdf.plainmile.com');
   expect(meta.officialSiteRel,path+' template outbound link').toMatch(/\bnofollow\b/);
   for (const localPath of meta.localLinks) {
    expect(indexablePaths.has(localPath), path + ': broken internal link to ' + localPath).toBe(true);
   }
   expect(seenTitles.has(meta.title), 'Duplicate title: '+meta.title).toBe(false);
   expect(seenDescriptions.has(meta.description), 'Duplicate description: '+meta.description).toBe(false);
   seenTitles.add(meta.title);
   seenDescriptions.add(meta.description);
   const expectedLanguage = locale === 'zh' ? 'zh-CN' : 'en';
   const localHome = domain + (locale === 'zh' ? '/zh/' : '/');
   if (slug === '') {
    const site = meta.schemas.find(schema => schema.type === 'WebSite');
    expect(site, path + ': WebSite schema').toBeTruthy();
    expect(site.url).toBe(meta.canonical);
    expect(site.inLanguage).toBe(expectedLanguage);
   } else if (slug !== 'privacy/') {
    const app = meta.schemas.find(schema => schema.type === 'WebApplication');
    const crumbs = meta.schemas.find(schema => schema.type === 'BreadcrumbList');
    expect(app, path + ': WebApplication schema').toBeTruthy();
    expect(crumbs, path + ': BreadcrumbList schema').toBeTruthy();
    expect(app.url).toBe(meta.canonical);
    expect(app.inLanguage).toBe(expectedLanguage);
    expect(app.description).toBe(meta.description);
    expect(crumbs.breadcrumbItems).toEqual([localHome, meta.canonical]);
   }
   if (slug !== 'privacy/') expect(meta.jsonLdCount, path + ': structured data').toBeGreaterThan(0);
   audit.push({path,...meta});
  }
 }
 console.log('SEO_PUBLIC_AUDIT ' + JSON.stringify({
  pages:audit.length,uniqueTitles:seenTitles.size,uniqueDescriptions:seenDescriptions.size,
  pagesWithJsonLd:audit.filter(row=>row.jsonLdCount>0).length,
  note:'Structured data is optional. AEO/GEO indexing and citations cannot be guaranteed.'
 }));
 if (screenshotDir) {
  await mkdir(screenshotDir,{recursive:true});
  await writeFile(screenshotDir+'/seo-audit.json',JSON.stringify(audit,null,2));
 }
});

test('split progress has useful bilingual crawlable SSR content and accurate app schema', async ({ request }) => {
  for (const locale of ['en', 'zh']) {
    const path = locale === 'zh' ? '/zh/split-pdf/' : '/split-pdf/';
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    // These answers must exist in the original HTML; Google and users do not
    // need a React hydration pass to discover how the split actually works.
    expect(html, path).toContain(locale === 'zh'
      ? '拆分几百页 PDF 时能看到进度或取消吗？'
      : 'Can I see progress and cancel a long PDF split?');
    expect(html, path).toContain(locale === 'zh'
      ? '重复范围按实际输出次数计数'
      : 'even if a custom range repeats pages');
    expect(html, path).toContain(locale === 'zh'
      ? 'ZIP 打包另行显示'
      : 'ZIP packaging is displayed separately');
    expect(html, path).toContain(locale === 'zh' ? '/zh/extract-pages/' : '/extract-pages/');
    expect(html, path).toContain(locale === 'zh'
      ? '能按 PDF 的章节书签自动拆分吗？'
      : 'Can I split a PDF at chapter bookmarks?');
    expect(html, path).toContain(locale === 'zh'
      ? '未改变原始页序'
      : 'original order');
    expect(html, path).toContain('application/ld+json');
    expect(html, path).toContain('WebApplication');
    expect(html, path).toContain('BreadcrumbList');
  }
});

test('public language/theme and mobile layout', async ({ page }) => {
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/zh/',{waitUntil:'networkidle'});
 await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
 await page.getByRole('combobox',{name:'外观'}).selectOption('dark');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.goto('/zh/workspace/');
 await expect(page.getByRole('combobox',{name:'外观'})).toHaveValue('dark');
 await page.getByRole('link',{name:'语言: English'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 if (screenshotDir) {
  await mkdir(screenshotDir,{recursive:true});
  await page.screenshot({path:screenshotDir+'/desktop-workspace-en.png',fullPage:true});
 }
 for (const width of [390,375]) {
  await page.setViewportSize({width,height:844});
  await page.goto('/zh/workspace/',{waitUntil:'networkidle'});
  await expect(page.getByTestId('dropzone')).toBeVisible();
  const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  expect(dims.scroll,'mobile overflow at '+width).toBeLessThanOrEqual(dims.client+2);
  if(width===390 && screenshotDir) await page.screenshot({path:screenshotDir+'/mobile-workspace-zh.png',fullPage:true});
 }
});

test('real public PDF upload/export without network POST', async ({ page }) => {
 const writes=[];
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())) writes.push(r.method()+' '+r.url());});
 const input=await PDFDocument.create();
 input.addPage([300,420]); input.addPage([315,420]);
 await page.goto('/workspace/');
 await page.getByTestId('file-input').setInputFiles({
  name:'synthetic-public-test.pdf',mimeType:'application/pdf',buffer:Buffer.from(await input.save())
 });
 await expect(page.getByTestId('page-tile')).toHaveCount(2);
 await page.getByTestId('export-options-button').click();
 await expect(page.getByTestId('watermark-toggle')).not.toBeChecked();
 const waiter=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export PDF'}).click();
 const saved=await waiter;
 const output=await PDFDocument.load(await readFile(await saved.path()));
 expect(output.getPages().map(p=>p.getWidth())).toEqual([300,315]);
 expect(writes).toEqual([]);
});
