import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  movePage, movePageGroup, shiftPage, rotatePages, deletePages, parsePageRanges,
  chunkPageRanges, getRangePages, commitHistory, makeHistoryState, undoHistory, redoHistory,
  MAX_SPLIT_ZIP_BYTES, enforceSplitZipBudget,
} from '../../src/lib/pageOperations.mjs';

const pages = Object.freeze([
  Object.freeze({ id: 'a', sourceId: 'fileA', pageIndex: 0, rotation: 0 }),
  Object.freeze({ id: 'b', sourceId: 'fileB', pageIndex: 0, rotation: 0 }),
  Object.freeze({ id: 'c', sourceId: 'fileA', pageIndex: 1, rotation: 0 }),
]);

const ids = (arr) => arr.map((page) => page.id);

test('dragging across PDFs retains original source references', () => {
  const actual = movePage(pages, 'c', 'a');
  assert.deepEqual(ids(actual), ['c', 'a', 'b']);
  assert.equal(actual[0].sourceId, 'fileA');
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
});

test('moving forward places item after drop target', () => {
  assert.deepEqual(ids(movePage(pages, 'a', 'c')), ['b', 'c', 'a']);
  assert.strictEqual(movePage(pages, 'a', 'missing'), pages);
  assert.deepEqual(ids(shiftPage(pages, 'b', -1)), ['b', 'a', 'c']);
  assert.strictEqual(shiftPage(pages, 'a', -1), pages);
});

test('rotate only selected pages, normalize degrees', () => {
  const rotated = rotatePages(pages, ['b'], -90);
  assert.equal(rotated[1].rotation, 270);
  assert.equal(rotated[0].rotation, 0);
  assert.equal(pages[1].rotation, 0);
});

test('delete selected pages without mutating originals', () => {
  assert.deepEqual(ids(deletePages(pages, ['a', 'c'])), ['b']);
  assert.equal(pages.length, 3);
});

test('split explicit ranges and preserve workspace page order', () => {
  const ranges = parsePageRanges('1-2, 3', pages.length);
  assert.deepEqual(ranges, [{start:1,end:2}, {start:3,end:3}]);
  assert.deepEqual(ids(getRangePages(movePage(pages, 'c', 'a'), ranges[0])), ['c','a']);
});

test('split into fixed-size chunks', () => {
  assert.deepEqual(chunkPageRanges(7, 3), [{start:1,end:3},{start:4,end:6},{start:7,end:7}]);
});

test('reject unsafe or inverted ranges', () => {
  for (const value of ['0', '-1', '4', '2-1', '1-4', '1,', '2-3-4', '1,,2', '999999999999999999999']) {
    assert.throws(() => parsePageRanges(value, 3));
  }
  assert.throws(() => chunkPageRanges(200, 1));
});

test('undo and redo reversible page ordering', () => {
  const initial = makeHistoryState(pages);
  const changed = commitHistory(initial, movePage(pages, 'c', 'a'));
  assert.deepEqual(ids(changed.present), ['c','a','b']);
  assert.deepEqual(ids(undoHistory(changed).present), ['a','b','c']);
  assert.deepEqual(ids(redoHistory(undoHistory(changed)).present), ['c','a','b']);
  assert.strictEqual(commitHistory(initial, pages), initial);
});

test('selected pages move together while retaining source order', () => {
  const original = [
    { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
  ];
  assert.deepEqual(movePageGroup(original, ['b', 'd'], 'a').map((p) => p.id), ['b', 'd', 'a', 'c', 'e']);
  assert.deepEqual(movePageGroup(original, ['b', 'd'], 'd'), original);
  assert.deepEqual(original.map((p) => p.id), ['a', 'b', 'c', 'd', 'e']);
});

test('generated split-PDF budget protects the final ZIP memory footprint', () => {
  assert.equal(MAX_SPLIT_ZIP_BYTES, 128 * 1024 * 1024);
  assert.equal(enforceSplitZipBudget(20, 30), 50);
  assert.equal(enforceSplitZipBudget(MAX_SPLIT_ZIP_BYTES - 1, 1), MAX_SPLIT_ZIP_BYTES);
  assert.throws(() => enforceSplitZipBudget(MAX_SPLIT_ZIP_BYTES - 1, 2), /128 MB/);
  assert.throws(() => enforceSplitZipBudget(100, 0), /128 MB/);
  assert.throws(() => enforceSplitZipBudget(-1, 1), /128 MB/);
});
