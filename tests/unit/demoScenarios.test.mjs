import test from 'node:test';
import assert from 'node:assert/strict';
import { demoForTool } from '../../src/lib/demoScenarios.mjs';
import { tools } from '../../src/lib/tools.mjs';

test('only actual PDF-input tools advertise downloadable demos in both languages', () => {
  const excluded = new Set(['image-to-pdf', 'txt-to-pdf', 'markdown-to-pdf']);
  for (const tool of tools) {
    const en = demoForTool(tool.slug, 'en');
    const zh = demoForTool(tool.slug, 'zh');
    if (excluded.has(tool.slug)) {
      assert.equal(en, null, tool.slug);
      assert.equal(zh, null, tool.slug);
      continue;
    }
    assert.ok(en, tool.slug);
    assert.ok(zh, tool.slug);
    assert.ok(en.expected.length > 55, tool.slug);
    assert.ok(zh.expected.length > 20, tool.slug);
    assert.ok(zh.title !== en.title, tool.slug);
    assert.deepEqual(en.files.map(file => file.path), zh.files.map(file => file.path));
    assert.equal(new Set(en.files.map(file => file.name)).size, en.files.length);
    for (const file of en.files) {
      assert.match(file.path, /^\/samples\/plainmile-demo(?:-part-[ab])?\.pdf$/);
      assert.equal(file.name, file.path.split('/').at(-1));
      assert.ok(file.en && file.zh);
    }
  }
  assert.equal(demoForTool('unknown'), null);
  assert.equal(demoForTool('__proto__'), null);
});

test('Merge PDF has two files; all other eligible tools use exactly one four-page PDF', () => {
  for (const tool of tools) {
    const scenario = demoForTool(tool.slug);
    if (!scenario) continue;
    assert.equal(scenario.files.length, tool.slug === 'merge-pdf' ? 2 : 1, tool.slug);
    if (tool.slug !== 'merge-pdf') assert.equal(scenario.files[0].name, 'plainmile-demo.pdf');
  }
});
