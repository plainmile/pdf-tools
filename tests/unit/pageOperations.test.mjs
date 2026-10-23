import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  movePage, movePageGroup, shiftPage, rotatePages, deletePages, parsePageRanges,
  chunkPageRanges, getRangePages, commitHistory, makeHistoryState, undoHistory, redoHistory,
  MAX_SPLIT_ZIP_BYTES, enforceSplitZipBudget, countActiveSources, historyReferencedSourceIds,
  reversePages, sortPagesByFilename, duplicatePages, insertPageAfter, groupPagesBySource, pageIdsForRanges,
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

test('localized page range punctuation is normalized but still validates bounds', () => {
  assert.deepEqual(parsePageRanges('１－３，５、７–８', 10), [
    { start: 1, end: 3 }, { start: 5, end: 5 }, { start: 7, end: 8 },
  ]);
  assert.deepEqual([...pageIdsForRanges(pages, '１－２，３')], ['a', 'b', 'c']);
  assert.throws(() => parsePageRanges('３－１，２', 10), /reversed/);
  assert.throws(() => parsePageRanges('１，１１', 10), /outside/);
  assert.throws(() => parsePageRanges('１，，２', 10));
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

import { translateProcessingError, workspaceCopy } from '../../src/lib/i18n.mjs';

test('workspace preserves actionable Chinese input and resource limit messages', () => {
  for (const key of ['errorFiles', 'errorTypes', 'errorCombined', 'errorPages', 'noFile']) {
    assert.equal(translateProcessingError(workspaceCopy.zh[key], 'zh'), workspaceCopy.zh[key]);
  }
  assert.equal(translateProcessingError('一次最多处理 20 个文件。', 'zh'), '一次最多处理 20 个文件。');
  assert.equal(translateProcessingError('unknown internal error', 'zh'), workspaceCopy.zh.errorGeneric);
});

test('the active file count ignores hidden sources retained only for Undo', () => {
  assert.equal(countActiveSources(pages), 2);
  assert.equal(countActiveSources(deletePages(pages, ['b'])), 1);
  assert.equal(countActiveSources(deletePages(pages, ['a', 'b', 'c'])), 0);
  assert.equal(countActiveSources([...pages, { ...pages[0], id: 'd' }]), 2);
});

test('image-batch filename sorting is numeric, stable, reversible and never alters inputs', () => {
  const imagePages = [
    { id: '10', sourceId: 'z', pageIndex: 0 },
    { id: '2a', sourceId: 'a', pageIndex: 0 },
    { id: '2b', sourceId: 'a', pageIndex: 1 },
  ];
  const files = [{ id: 'z', name: 'scan10.png' }, { id: 'a', name: 'scan2.png' }];
  const sorted = sortPagesByFilename(imagePages, files);
  assert.deepEqual(ids(sorted), ['2a', '2b', '10']);
  assert.deepEqual(ids(reversePages(sorted)), ['10', '2b', '2a']);
  assert.deepEqual(ids(imagePages), ['10', '2a', '2b']);
  assert.strictEqual(reversePages([]).length, 0);
});

test('duplicate selected pages immediately after originals using distinct IDs; Undo/Redo preserve all page data', () => {
  let id = 0;
  const result = duplicatePages(pages, ['a', 'c'], () => 'copy-' + (++id));
  assert.deepEqual(ids(result), ['a', 'copy-1', 'b', 'c', 'copy-2']);
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
  assert.notStrictEqual(result[1], pages[0]);
  assert.equal(result[1].sourceId, pages[0].sourceId);
  assert.equal(result[1].pageIndex, pages[0].pageIndex);
  assert.equal(result[1].rotation, pages[0].rotation);
  const initial = makeHistoryState(pages);
  const changed = commitHistory(initial, result);
  assert.deepEqual(ids(undoHistory(changed).present), ids(pages));
  assert.deepEqual(ids(redoHistory(undoHistory(changed)).present), ids(result));
  assert.strictEqual(duplicatePages(pages, ['missing'], () => 'n'), pages);
});

test('duplicating pages never silently exceeds the 600-page workspace cap', () => {
  assert.throws(() => duplicatePages(pages, ['a'], () => 'extra', 3), /At most 3 pages/);
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
  const result = duplicatePages(pages, ['b'], () => 'new', 4);
  assert.deepEqual(ids(result), ['a', 'b', 'new', 'c']);
});

test('blank insertion is deterministic and does not mutate source pages', () => {
  const blank = { id: 'blank', sourceId: 'generated', pageIndex: 0, rotation: 0 };
  assert.deepEqual(ids(insertPageAfter(pages, 1, blank)), ['a', 'b', 'blank', 'c']);
  assert.deepEqual(ids(insertPageAfter(pages, 2, blank)), ['a', 'b', 'c', 'blank']);
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
  assert.throws(() => insertPageAfter(pages, 3, blank), /Invalid/);
  assert.throws(() => insertPageAfter(pages, -2, blank), /Invalid/);
});

test('read-only grouping keeps true PDF export indices for interleaved pages', () => {
  const groups = groupPagesBySource(pages);
  assert.deepEqual(groups.map(group => group.sourceId), ['fileA', 'fileB']);
  assert.deepEqual(groups[0].items.map(item => item.index), [0, 2]);
  assert.deepEqual(groups[0].items.map(item => item.pageRef.id), ['a', 'c']);
  assert.deepEqual(groups[1].items.map(item => item.index), [1]);
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
  assert.deepEqual(groupPagesBySource(deletePages(pages, ['b'])).map(group => group.sourceId), ['fileA']);
  assert.deepEqual(groupPagesBySource([]), []);
});

test('grouping 600 interleaved pages is order-preserving and linear-size', () => {
  const many = Array.from({ length: 600 }, (_, index) => ({
    id: 'page' + index, sourceId: 'source' + index % 12,
    pageIndex: Math.floor(index / 12), rotation: 0,
  }));
  const groups = groupPagesBySource(many);
  assert.equal(groups.length, 12);
  assert.ok(groups.every(group => group.items.length === 50));
  assert.deepEqual(groups[0].items.map(item => item.index), Array.from({ length: 50 }, (_, i) => i * 12));
  assert.deepEqual(many.map(p => p.id), Array.from({ length: 600 }, (_, i) => 'page' + i));
});


test('expired Undo snapshots release orphaned sources but reachable Undo/Redo keep their files', () => {
  const original = [pages[0], pages[1]];
  const imported = makeHistoryState(original);
  const deleted = commitHistory(imported, [pages[1]]);
  assert.deepEqual([...historyReferencedSourceIds(deleted)].sort(), ['fileA', 'fileB']);
  assert.deepEqual([...historyReferencedSourceIds(undoHistory(deleted))].sort(), ['fileA', 'fileB']);
  let history = deleted;
  for (let i = 0; i < 21; i++) history = commitHistory(history, rotatePages(history.present, ['b'], 90));
  assert.deepEqual([...historyReferencedSourceIds(history)], ['fileB']);
  const reset = makeHistoryState([]);
  assert.deepEqual([...historyReferencedSourceIds(reset)], []);

  // Branching after Undo discards files referenced by Redo-only history.
  const withNewFile = commitHistory(imported, [...original, { id: 'z', sourceId: 'fileC', pageIndex: 0, rotation: 0 }]);
  const rolledBack = undoHistory(withNewFile);
  assert.equal(historyReferencedSourceIds(rolledBack).has('fileC'), true);
  const branched = commitHistory(rolledBack, rotatePages(original, ['a'], 90));
  assert.equal(historyReferencedSourceIds(branched).has('fileC'), false);
});


test('select-by-range uses visible export positions, deduplicates overlaps and rejects invalid edits', () => {
  assert.deepEqual([...pageIdsForRanges(pages, '1-2, 2, 3')], ['a', 'b', 'c']);
  assert.deepEqual([...pageIdsForRanges(pages, '3,1')], ['c', 'a']);
  const reordered = movePage(pages, 'c', 'a');
  assert.deepEqual([...pageIdsForRanges(reordered, '1, 3')], ['c', 'b']);
  for (const input of ['3-1', '4', '1,,2', '0']) {
    assert.throws(() => pageIdsForRanges(pages, input));
  }
  assert.deepEqual([...pageIdsForRanges(pages, '1-3')].length, 3);
});
