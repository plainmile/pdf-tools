import test from 'node:test';
import assert from 'node:assert/strict';
import { tools, getTool } from '../../src/lib/tools.mjs';
import { featuredToolSlugs, toolGroups, toolSymbols, relatedToolSlugs } from '../../src/lib/toolGroups.mjs';
import { toolHelpFor } from '../../src/lib/toolHelp.mjs';
import { absoluteToolUrl, toolJsonLd, websiteJsonLd } from '../../src/lib/seo.mjs';

test('all tools appear once in clear categories and featured tasks are available', () => {
  const unique = new Set();
  for (const group of toolGroups) {
    assert.ok(group.en && group.zh);
    for (const slug of group.slugs) {
      assert.ok(!unique.has(slug), `Repeated in tool catalog: ${slug}`);
      unique.add(slug);
      assert.ok(toolSymbols[slug]);
    }
  }
  assert.deepEqual([...unique].sort(), tools.map(x => x.slug).sort());
  for (const slug of featuredToolSlugs) assert.ok(unique.has(slug));
});

test('bilingual visible FAQs cover every real tool with accurate limitations', () => {
  for (const tool of tools) {
    for (const locale of ['en', 'zh']) {
      const localized = getTool(tool, locale);
      assert.ok(localized.title && localized.description);
      const help = toolHelpFor(tool.slug, locale);
      assert.ok(help.length >= 2, `Missing ${locale} FAQ for ${tool.slug}`);
      for (const [q, answer] of help) {
        assert.ok(q.length >= 6 && answer.length >= 20);
        assert.ok(!/<script|\bLorem ipsum\b/i.test(q + answer));
      }
    }
  }
});

test('structured data uses real URLs, no fabricated ratings and matches visible tools', () => {
  for (const locale of ['en', 'zh']) {
    const root = websiteJsonLd(locale);
    assert.equal(root['@type'], 'WebSite');
    assert.equal(root.url, absoluteToolUrl('', locale));
    assert.equal(root.inLanguage, locale === 'zh' ? 'zh-CN' : 'en');
    for (const source of tools) {
      const tool = getTool(source, locale);
      const schema = toolJsonLd(tool, locale);
      assert.equal(schema.length, 2);
      const [crumbs, app] = schema;
      assert.equal(crumbs['@type'], 'BreadcrumbList');
      assert.equal(crumbs.itemListElement[1].item, absoluteToolUrl(tool.slug, locale));
      assert.equal(app['@type'], 'WebApplication');
      assert.equal(app.name, tool.title);
      assert.equal(app.description, tool.description);
      assert.equal(app.url, absoluteToolUrl(tool.slug, locale));
      assert.equal(app.offers.price, 0);
      assert.equal(app.isAccessibleForFree, true);
      assert.equal(app.aggregateRating, undefined);
    }
  }
});

test('related tools prioritize matching real tasks and exclude the current route', () => {
  const known = new Set(tools.map(x => x.slug));
  for (const tool of tools) {
    const related = relatedToolSlugs(tool.slug);
    assert.ok(related.length >= 3 && related.length <= 5, tool.slug);
    assert.equal(related.includes(tool.slug), false);
    assert.equal(new Set(related).size, related.length);
    assert.ok(related.every(slug => known.has(slug)));
  }
  assert.equal(relatedToolSlugs('compress-pdf')[0], 'watermark-pdf');
  assert.equal(relatedToolSlugs('pdf-to-txt')[0], 'pdf-to-images');
});
