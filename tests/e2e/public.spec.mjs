import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const domain = 'https://pdf.plainmile.com';
const screenshotDir = process.env.LIVE_SCREENSHOT_DIR || '';
const slugs = ['', 'workspace/', 'merge-pdf/', 'split-pdf/', 'organize-pdf/',
 'rotate-pdf/', 'extract-pages/', 'delete-pages/', 'image-to-pdf/', 'watermark-pdf/', 'privacy/'];

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
  const response = await request.get(url);
  expect(response.status(),url).toBe(200);
  allURLs.push(...[...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
 }
 for (const slug of slugs) {
  expect(allURLs).toContain(domain + '/' + slug);
  expect(allURLs).toContain(domain + '/zh/' + slug);
 }
 const worker = await request.get('/pdfjs/pdf.worker.min.mjs');
 expect(worker.status()).toBe(200);
 expect(worker.headers()['content-type']).toMatch(/javascript/i);
 expect((await worker.body()).byteLength).toBeGreaterThan(100000);
 expect((await request.get('/__qa_missing_20261022_9485')).status()).toBe(404);
});

test('SEO and AI answer-readiness audit of 22 live URLs', async ({ page }) => {
 const seenTitles = new Set(), audit = [];
 for (const locale of ['en', 'zh']) {
  for (const slug of slugs) {
   const path = locale === 'zh' ? '/zh/' + slug : '/' + slug;
   const response = await page.goto(path, {waitUntil:'domcontentloaded'});
   expect(response?.status(), path).toBe(200);
   const meta = await page.evaluate(() => ({
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
   }));
   expect(meta.lang,path).toBe(locale==='en'?'en':'zh-CN');
   expect(meta.title.length,path).toBeGreaterThan(15);
   expect(meta.description.length,path).toBeGreaterThan(35);
   expect(meta.robots,path).toMatch(/index,\s*follow/i);
   expect(meta.canonical,path).toBe(domain+path);
   expect(meta.en,path).toBe(domain+'/'+slug);
   expect(meta.zh,path).toBe(domain+'/zh/'+slug);
   expect(meta.defaultLang,path).toBe(domain+'/'+slug);
   expect(meta.h1,path).toBe(1);
   expect(meta.mainChars,path).toBeGreaterThan(150);
   expect(meta.ogTitle,path).not.toBe('');
   expect(seenTitles.has(meta.title), 'Duplicate: '+meta.title).toBe(false);
   seenTitles.add(meta.title);
   audit.push({path,...meta});
  }
 }
 console.log('SEO_PUBLIC_AUDIT ' + JSON.stringify({
  pages:audit.length,uniqueTitles:seenTitles.size,
  pagesWithJsonLd:audit.filter(row=>row.jsonLdCount>0).length,
  note:'Structured data is optional. AEO/GEO indexing and citations cannot be guaranteed.'
 }));
 if (screenshotDir) {
  await mkdir(screenshotDir,{recursive:true});
  await writeFile(screenshotDir+'/seo-audit.json',JSON.stringify(audit,null,2));
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
