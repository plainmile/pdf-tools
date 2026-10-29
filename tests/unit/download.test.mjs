import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDownload } from '../../src/lib/download.mjs';

test('Blob downloads keep the anchor until a later browser task and release their URL', () => {
  const previousDocument = globalThis.document;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousSetTimeout = globalThis.setTimeout;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  try {
    for (const clickThrows of [false, true]) {
      const scheduled = [];
      const revoked = [];
      const anchor = {
        href: '', download: '', style: {}, removed: false, clicked: 0,
        click() {
          assert.equal(this.removed, false, 'anchor must be attached during click');
          this.clicked++;
          if (clickThrows) throw new Error('Browser refused download');
        },
        remove() { this.removed = true; },
      };
      globalThis.document = {
        body: { appendChild(value) { assert.equal(value, anchor); } },
        createElement(name) { assert.equal(name, 'a'); return anchor; },
      };
      globalThis.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      };
      URL.createObjectURL = blob => {
        assert.ok(blob instanceof Blob);
        assert.equal(blob.type, 'application/pdf');
        return 'blob:test-document';
      };
      URL.revokeObjectURL = url => revoked.push(url);
      if (clickThrows) {
        assert.throws(() => saveDownload(new Uint8Array([1, 2]), '测试.pdf'), /refused download/);
      } else {
        saveDownload(new Uint8Array([1, 2]), '测试.pdf');
      }
      assert.equal(anchor.clicked, 1);
      assert.equal(anchor.href, 'blob:test-document');
      assert.equal(anchor.download, '测试.pdf');
      assert.equal(anchor.style.display, 'none');
      assert.equal(anchor.removed, false, 'removing synchronously may race WebKit navigation');
      assert.deepEqual(scheduled.map(task => task.delay), [1000, 60000]);
      scheduled[0].callback();
      assert.equal(anchor.removed, true);
      assert.deepEqual(revoked, []);
      scheduled[1].callback();
      assert.deepEqual(revoked, ['blob:test-document']);
    }
  } finally {
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
    globalThis.setTimeout = previousSetTimeout;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});
