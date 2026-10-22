import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WATERMARK_CHARS, WATERMARK_OPACITY, watermarkTextFromOptions } from '../../src/lib/watermark.mjs';

test('default and explicitly disabled settings never add a watermark', () => {
  assert.equal(watermarkTextFromOptions(undefined), null);
  assert.equal(watermarkTextFromOptions({ enabled: false, text: 'DO NOT ADD' }), null);
  assert.equal(watermarkTextFromOptions({ text: 'IGNORED' }), null);
});

test('only an explicit opt-in with nonempty text enables watermarking', () => {
  assert.equal(watermarkTextFromOptions({ enabled: true, text: ' CONFIDENTIAL ' }), 'CONFIDENTIAL');
  assert.equal(watermarkTextFromOptions({ enabled: true, text: ' \u5185\u90e8\u8d44\u6599 ' }), '\u5185\u90e8\u8d44\u6599');
  assert.equal(watermarkTextFromOptions({ enabled: true, text: 'Internal\nUse\tOnly' }), 'Internal Use Only');
});

test('opt-in with empty text is an error instead of adding a surprise watermark', () => {
  assert.throws(() => watermarkTextFromOptions({ enabled: true, text: '   ' }), /Enter watermark text/);
  assert.throws(() => watermarkTextFromOptions({ enabled: true, text: null }), /Enter watermark text/);
});

test('the watermark is bounded and subtle', () => {
  assert.equal(watermarkTextFromOptions({ enabled: true, text: 'a'.repeat(MAX_WATERMARK_CHARS) }).length, MAX_WATERMARK_CHARS);
  assert.throws(() => watermarkTextFromOptions({ enabled: true, text: 'a'.repeat(MAX_WATERMARK_CHARS + 1) }), /characters or fewer/);
  assert.ok(WATERMARK_OPACITY > 0 && WATERMARK_OPACITY < 0.35);
});
