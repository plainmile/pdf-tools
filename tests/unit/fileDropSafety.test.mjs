import test from 'node:test';
import assert from 'node:assert/strict';
import { protectLocalFileDropNavigation } from '../../src/lib/fileDropSafety.mjs';

test('only local OS-file drags are cancelled, without consuming link or thumbnail drags', () => {
  const listeners = new Map();
  const fakeDocument = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      assert.equal(listeners.get(type), callback);
      listeners.delete(type);
    },
  };
  const cleanup = protectLocalFileDropNavigation(fakeDocument);
  assert.deepEqual([...listeners.keys()], ['dragover', 'drop']);
  const fire = (type, types, hasTransfer = true) => {
    const event = {
      dataTransfer: hasTransfer ? { types } : null,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    listeners.get(type)(event);
    return event.defaultPrevented;
  };
  for (const type of ['dragover', 'drop']) {
    assert.equal(fire(type, ['Files']), true);
    assert.equal(fire(type, ['text/plain', 'Files']), true);
    assert.equal(fire(type, ['text/plain']), false);
    assert.equal(fire(type, ['text/uri-list']), false);
    assert.equal(fire(type, [], false), false);
  }
  cleanup();
  assert.equal(listeners.size, 0, 'Unmount must remove both document listeners');
});
