import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('idle workspace must not eagerly import PDF converter and ZIP encoder bundles', () => {
  const engine = read('src/lib/pdfEngine.mjs');
  const watermark = read('src/lib/watermark.mjs');
  const workspace = read('src/components/PdfWorkspace.jsx');
  assert.match(engine, /from '\.\/fileIo\.mjs'/);
  assert.match(watermark, /from '\.\/fileIo\.mjs'/);
  assert.match(workspace, /from '\.\.\/lib\/fileIo\.mjs'/);
  for (const [name, code] of [['pdfEngine', engine], ['watermark', watermark], ['workspace', workspace]]) {
    assert.doesNotMatch(code, /from ['"][^'"]*pdfUtilities\.mjs['"]/, name + ' should not statically load all focused converters');
    assert.doesNotMatch(code, /^import\s+JSZip\s+from\s+['"]jszip['"]/m, name + ' must not load ZIP at idle');
  }
  assert.match(workspace, /await abortableWait\(import\('jszip'\), controller\.signal\)/);
});

test('TXT import can run without eager PDF/ZIP modules; multi-image ZIP remains cancellable', () => {
  const utility = read('src/components/PdfUtility.jsx');
  const converters = read('src/lib/pdfUtilities.mjs');
  const light = read('src/lib/fileIo.mjs');
  assert.match(utility, /import \{ readFileArrayBuffer \} from '\.\.\/lib\/fileIo\.mjs'/);
  assert.match(utility, /else \{\s*const \{ loadPdf \} = await import\('\.\.\/lib\/pdfUtilities\.mjs'\)/);
  assert.doesNotMatch(converters, /^import\s+JSZip\s+from\s+['"]jszip['"]/m);
  assert.match(converters, /await abortableWait\(import\('jszip'\), options\.signal\)/);
  assert.match(light, /export function readFileArrayBuffer/);
  assert.match(light, /export function abortableWait/);
  assert.doesNotMatch(light, /(?:pdf-lib|pdfjs-dist|jszip)/);
});
