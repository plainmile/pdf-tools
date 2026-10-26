import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  movePage, movePageGroup, pageDropSide, moveSelectedPagesToPosition, shiftPage, rotatePages, deletePages, parsePageRanges,
  chunkPageRanges, splitChunkBatch, splitSinglePageBatch, oddEvenSplitParts, getRangePages, splitCoversAllPagesExactlyOnce, splitCoverageDetails, splitCutsFromRanges, splitRangesFromCuts, splitRangesFromBookmarkStarts, bookmarkItemsAtLevel, commitHistory, makeHistoryState, undoHistory, redoHistory,
  MAX_SPLIT_ZIP_BYTES, enforceSplitZipBudget, countActiveSources, historyReferencedSourceIds,
  reversePages, sortPagesByFilename, interleaveDuplexPages, duplicatePages, insertPageAfter, groupPagesBySource, pageIdsForRanges, pagePositionsForCombinedRanges, pageIdsForParity, invertPageIdSelection,
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

test('drop indicator describes exactly where the existing drag algorithms insert pages', () => {
  assert.equal(pageDropSide(pages, ['c'], 'a'), 'before');
  assert.deepEqual(ids(movePage(pages, 'c', 'a')), ['c', 'a', 'b']);
  assert.equal(pageDropSide(pages, ['a'], 'c'), 'after');
  assert.deepEqual(ids(movePage(pages, 'a', 'c')), ['b', 'c', 'a']);
  assert.equal(pageDropSide(pages, ['a', 'c'], 'b'), 'before');
  assert.deepEqual(ids(movePageGroup(pages, ['a','c'], 'b')), ['a', 'c', 'b']);
  assert.equal(pageDropSide(pages, ['a', 'c'], 'a'), null);
  assert.equal(pageDropSide(pages, ['a'], 'missing'), null);
  assert.equal(pageDropSide(pages, [], 'a'), null);
});

test('numeric insertion moves nonadjacent PDF pages to an exact before/after anchor', () => {
  const original = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f'].map(id => Object.freeze({ id })));
  assert.deepEqual(ids(moveSelectedPagesToPosition(original, ['b', 'd'], 6, 'before')), ['a','c','e','b','d','f']);
  assert.deepEqual(ids(moveSelectedPagesToPosition(original, ['d', 'b'], 6, 'after')), ['a','c','e','f','b','d']);
  assert.deepEqual(ids(moveSelectedPagesToPosition(original, new Set(['b','d']), 1, 'after')), ['a','b','d','c','e','f']);
  assert.deepEqual(ids(original), ['a','b','c','d','e','f']);
  const noop = moveSelectedPagesToPosition(original, ['b'], 3, 'before');
  assert.strictEqual(noop, original);
  const undoable = commitHistory(makeHistoryState(original), moveSelectedPagesToPosition(original, ['b','d'], 6, 'before'));
  assert.deepEqual(ids(undoHistory(undoable).present), ids(original));
  assert.deepEqual(ids(redoHistory(undoHistory(undoable)).present), ids(undoable.present));
});

test('numeric insertion rejects invalid and selected target atomically', () => {
  const original = [{id:'a'}, {id:'b'}, {id:'c'}];
  for (const position of [0, -1, 4, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => moveSelectedPagesToPosition(original, ['b'], position, 'before'), /Target/);
  }
  assert.throws(() => moveSelectedPagesToPosition(original, ['b'], 2, 'after'), /selected/);
  assert.throws(() => moveSelectedPagesToPosition(original, ['a','b','c'], 1), /selected/);
  assert.throws(() => moveSelectedPagesToPosition(original, [], 1), /Select/);
  assert.throws(() => moveSelectedPagesToPosition(original, ['unknown'], 1), /Select/);
  assert.throws(() => moveSelectedPagesToPosition(original, ['a'], 2, 'inside'), /before or after/);
  assert.deepEqual(ids(original), ['a','b','c']);
});

test('odd and even page selection follows one-based current export order, not source page number', () => {
  const original = Object.freeze([
    { id: 'a', sourceId: 'one', pageIndex: 10 },
    { id: 'b', sourceId: 'two', pageIndex: 0 },
    { id: 'c', sourceId: 'one', pageIndex: 0 },
    { id: 'd', sourceId: 'two', pageIndex: 3 },
    { id: 'e', sourceId: 'one', pageIndex: 1 },
  ].map(page => Object.freeze(page)));
  assert.deepEqual([...pageIdsForParity(original, 'odd')], ['a', 'c', 'e']);
  assert.deepEqual([...pageIdsForParity(original, 'even')], ['b', 'd']);
  const reordered = movePage(original, 'e', 'a');
  assert.deepEqual([...pageIdsForParity(reordered, 'odd')], ['e', 'b', 'd']);
  assert.deepEqual([...pageIdsForParity(reordered, 'even')], ['a', 'c']);
  assert.deepEqual([...invertPageIdSelection(original, ['a', 'd', 'stale-undo-id'])], ['b', 'c', 'e']);
  assert.deepEqual([...invertPageIdSelection(original, [])], ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([...invertPageIdSelection(original, original.map(p => p.id))], []);
  assert.throws(() => pageIdsForParity(original, 'third'), /odd or even/);
  assert.deepEqual(original.map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
});

test('odd/even shortcuts scale to maximum 600 workspace pages without range expansion', () => {
  const book = Array.from({ length: 600 }, (_, index) => ({ id: String(index), sourceId: 'book', pageIndex: index }));
  const odds = pageIdsForParity(book, 'odd');
  const evens = pageIdsForParity(book, 'even');
  assert.equal(odds.size, 300);
  assert.equal(evens.size, 300);
  assert.deepEqual([...invertPageIdSelection(book, odds)], [...evens]);
  assert.deepEqual([...pageIdsForParity(book.slice(0, 1), 'even')], []);
  assert.deepEqual([...pageIdsForParity([], 'odd')], []);
  assert.equal(pageIdsForParity(book, 'odd').has('0'), true);
  assert.equal(pageIdsForParity(book, 'odd').has('1'), false);
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

test('combined ranges honor typed order, remove overlaps and preserve source refs', () => {
  assert.deepEqual(pagePositionsForCombinedRanges('３，１－２、３', 3), [3, 1, 2]);
  assert.deepEqual(pagePositionsForCombinedRanges('2-3, 1-2', 3), [2, 3, 1]);
  assert.deepEqual(pagePositionsForCombinedRanges('1-3', 3).map(n => pages[n - 1].id), ['a', 'b', 'c']);
  assert.deepEqual(pages.map(p => p.id), ['a', 'b', 'c']);
  for (const bad of ['', ' ', '2-1', '0', '4', '1,,2', '1,', 'not a range', null, 3]) {
    assert.throws(() => pagePositionsForCombinedRanges(bad, 3), 'invalid selection: ' + String(bad));
  }
  const fiftyOneRanges = Array.from({ length: 51 }, () => '1').join(',');
  assert.throws(() => pagePositionsForCombinedRanges(fiftyOneRanges, 3), /maximum of 50/);
  assert.equal(pagePositionsForCombinedRanges('1-600', 600).length, 600);
  assert.throws(() => pagePositionsForCombinedRanges('1-601', 601), /At most 600/);
});

test('split explicit ranges and preserve workspace page order', () => {
  const ranges = parsePageRanges('1-2, 3', pages.length);
  assert.deepEqual(ranges, [{start:1,end:2}, {start:3,end:3}]);
  assert.deepEqual(ids(getRangePages(movePage(pages, 'c', 'a'), ranges[0])), ['c','a']);
});

test('split into fixed-size chunks', () => {
  assert.deepEqual(chunkPageRanges(7, 3), [{start:1,end:3},{start:4,end:6},{start:7,end:7}]);
});

test('nested PDF outlines select only the chosen depth and bound cyclic or hostile inputs', () => {
  const l3a = { title: 'A.1', items: [] };
  const l3b = { title: 'B.1', items: [] };
  const l2a = { title: 'A', items: [l3a] };
  const l2b = { title: 'B', items: [l3b] };
  const l1a = { title: 'Part I', items: [l2a, l2b] };
  const l1b = { title: 'Part II', items: [] };
  const outline = [l1a, l1b];
  assert.deepEqual(bookmarkItemsAtLevel(outline, 1).map(x => x.title), ['Part I', 'Part II']);
  assert.deepEqual(bookmarkItemsAtLevel(outline, 2).map(x => x.title), ['A', 'B']);
  assert.deepEqual(bookmarkItemsAtLevel(outline, 3).map(x => x.title), ['A.1', 'B.1']);
  assert.deepEqual(bookmarkItemsAtLevel([l1b], 3), []);
  assert.throws(() => bookmarkItemsAtLevel(outline, 0), /Invalid/);
  assert.throws(() => bookmarkItemsAtLevel(outline, 4), /Invalid/);
  assert.throws(() => bookmarkItemsAtLevel('outline', 1), /Invalid/);
  assert.throws(() => bookmarkItemsAtLevel(outline, 2, 2), /Too many/);
  const recursive = { title: 'self' };
  recursive.items = [recursive];
  assert.deepEqual(bookmarkItemsAtLevel([recursive], 3), []);
  const malicious = [{ title: 'root', items: Array.from({ length: 1001 }, (_, i) => ({ title: String(i) })) }];
  assert.throws(() => bookmarkItemsAtLevel(malicious, 2), /Too many/);
});

test('bookmark destinations create complete chapter ranges with covers, duplicates and out-of-order starts', () => {
  const asParts = (starts, count) => parsePageRanges(splitRangesFromBookmarkStarts(starts, count), count);
  assert.deepEqual(asParts([8, 3, 3, 1, 12, 8], 15), [
    { start: 1, end: 2 }, { start: 3, end: 7 },
    { start: 8, end: 11 }, { start: 12, end: 15 },
  ]);
  assert.deepEqual(asParts([5], 8), [{ start: 1, end: 4 }, { start: 5, end: 8 }]);
  assert.deepEqual(asParts([1, 4], 4), [{ start: 1, end: 3 }, { start: 4, end: 4 }]);
  const book = asParts([1, 101, 201, 301, 401, 501], 600);
  assert.equal(splitCoversAllPagesExactlyOnce(book, 600), true);
  assert.equal(book.length, 6);
  assert.equal(book[book.length - 1].end, 600);
});

test('bookmark splitting rejects malformed destinations and over 50 output chapters', () => {
  for (const starts of [null, '3', [0, 3], [1.5], [NaN], [601], [1, '5'], []]) {
    assert.throws(() => splitRangesFromBookmarkStarts(starts, 600));
  }
  for (const count of [0, 1, 601, NaN, 2.5]) {
    assert.throws(() => splitRangesFromBookmarkStarts([2], count));
  }
  assert.throws(() => splitRangesFromBookmarkStarts([1], 600), /chapter breaks/);
  assert.throws(() => splitRangesFromBookmarkStarts([1, 2], 600, 1), /Invalid/);
  assert.throws(() => splitRangesFromBookmarkStarts(Array.from({ length: 51 }, (_, i) => i + 2), 600), /maximum/i);
  assert.deepEqual(splitRangesFromBookmarkStarts([1, 51], 100), '1-50, 51-100');
});

test('odd/even split creates two complete disjoint PDFs in CURRENT output order', () => {
  for (const count of [2, 3, 4, 7, 51, 105, 600]) {
    const parts = oddEvenSplitParts(count);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.map(part => part.kind), ['odd', 'even']);
    assert.equal(parts[0].positions.length, Math.ceil(count / 2));
    assert.equal(parts[1].positions.length, Math.floor(count / 2));
    assert.equal(splitCoversAllPagesExactlyOnce(parts, count), true);
    const reordered = Array.from({ length: count }, (_, index) => ({ id: String(count - index), pageIndex: count - index - 1 }));
    assert.deepEqual(getRangePages(reordered, parts[0]).map(item => item.id),
      parts[0].positions.map(position => String(count - position + 1)));
    assert.deepEqual(getRangePages(reordered, parts[1]).map(item => item.id),
      parts[1].positions.map(position => String(count - position + 1)));
  }
  assert.deepEqual(oddEvenSplitParts(5), [
    { kind: 'odd', positions: [1, 3, 5] },
    { kind: 'even', positions: [2, 4] },
  ]);
});

test('odd/even split rejects empty, overflow, repeated and missing page positions', () => {
  for (const count of [0, 1, 601, NaN, 3.5, -1]) {
    assert.throws(() => oddEvenSplitParts(count));
  }
  assert.equal(splitCoversAllPagesExactlyOnce([
    { kind: 'odd', positions: [1, 3] },
    { kind: 'even', positions: [2] },
  ], 3), true);
  assert.equal(splitCoversAllPagesExactlyOnce([
    { kind: 'odd', positions: [1, 3] },
    { kind: 'even', positions: [3] },
  ], 3), false);
  assert.equal(splitCoverageDetails([{ positions: [] }], 3), null);
  assert.equal(splitCoverageDetails([{ positions: [1, 0] }], 3), null);
  assert.equal(splitCoverageDetails([{ positions: [1.5] }], 3), null);
  assert.equal(splitCoverageDetails([{ positions: [1, 4] }], 3), null);
  assert.throws(() => getRangePages(pages, { positions: [1, 4] }));
  assert.deepEqual(ids(pages), ['a', 'b', 'c']);
});

test('per-page batches partition up to 600 current output pages without overlap or omission', () => {
  for (const count of [1, 50, 51, 105, 600]) {
    const batches = Array.from({ length: Math.ceil(count / 50) },
      (_, index) => splitSinglePageBatch(count, index));
    const all = batches.flatMap(batch => batch.parts);
    assert.equal(all.length, count);
    assert.deepEqual(all.map(part => part.start), Array.from({ length: count }, (_, i) => i + 1));
    assert.ok(all.every(part => part.start === part.end));
    assert.ok(batches.every(batch => batch.parts.length >= 1 && batch.parts.length <= 50));
    assert.equal(batches[0].start, 1);
    assert.equal(batches.at(-1).end, count);
    assert.equal(splitCoversAllPagesExactlyOnce(all, count), true);
    if (count > 50) {
      assert.equal(batches.every(batch => !splitCoversAllPagesExactlyOnce(batch.parts, count)), true,
        'a partial batch must never mark the entire modified workspace saved');
    }
  }
  assert.deepEqual(splitSinglePageBatch(105, 1), {
    index: 1, total: 3, start: 51, end: 100,
    parts: Array.from({ length: 50 }, (_, index) => ({ start: 51 + index, end: 51 + index })),
  });
  for (const [count, index] of [[0, 0], [601, 0], [NaN, 0], [51, -1], [51, 2], [51, 0.5]]) {
    assert.throws(() => splitSinglePageBatch(count, index));
  }
});

test('every-N split batches cover all current pages without overlaps, including incomplete final PDFs', () => {
  for (const count of [1, 50, 51, 101, 105, 200, 201, 319, 600]) {
    for (const size of [1, 2, 3, 4, 7, 12, 50, 99, 600].filter(n => n <= count)) {
      const outputCount = Math.ceil(count / size);
      const batchCount = Math.ceil(outputCount / 50);
      const batches = Array.from({ length: batchCount },
        (_, index) => splitChunkBatch(count, size, index));
      const parts = batches.flatMap(batch => batch.parts);
      assert.equal(parts.length, outputCount, count + '/' + size + ' output count');
      assert.ok(batches.every(batch => batch.total === batchCount && batch.parts.length <= 50));
      assert.deepEqual(parts.map(part => part.start), parts.map((_, i) => i * size + 1));
      assert.deepEqual(parts.map(part => part.end), parts.map((part, i) => Math.min(count, (i + 1) * size)));
      assert.ok(parts.every(part => part.end - part.start + 1 <= size));
      assert.equal(batches[0].start, 1);
      assert.equal(batches.at(-1).end, count);
      assert.equal(splitCoversAllPagesExactlyOnce(parts, count), true);
      if (batchCount > 1) {
        assert.ok(batches.every(batch => !splitCoversAllPagesExactlyOnce(batch.parts, count)));
      }
    }
  }
  assert.deepEqual(splitChunkBatch(105, 2, 1), {
    index: 1, total: 2, start: 101, end: 105,
    parts: [{ start: 101, end: 102 }, { start: 103, end: 104 }, { start: 105, end: 105 }],
  });
  assert.deepEqual(splitChunkBatch(201, 4, 1), {
    index: 1, total: 2, start: 201, end: 201,
    parts: [{ start: 201, end: 201 }],
  });
  assert.equal(splitChunkBatch(600, 2, 5).parts.length, 50);
  for (const [count, size, index] of [
    [0, 1, 0], [601, 1, 0], [105, 0, 0], [105, -2, 0],
    [105, 106, 0], [105, 2.5, 0], [105, 2, -1],
    [105, 2, 2], [105, 2, 0.5], [NaN, 2, 0],
  ]) assert.throws(() => splitChunkBatch(count, size, index));
});

test('split downloads count as saved only when all current pages are covered exactly once', () => {
  assert.equal(splitCoversAllPagesExactlyOnce(parsePageRanges('1-2,3-4', 4), 4), true);
  assert.equal(splitCoversAllPagesExactlyOnce(parsePageRanges('3-4,1-2', 4), 4), true);
  assert.equal(splitCoversAllPagesExactlyOnce(chunkPageRanges(7, 3), 7), true);
  assert.equal(splitCoversAllPagesExactlyOnce([{ start: 1, end: 4 }], 4), true);
  assert.equal(splitCoversAllPagesExactlyOnce(parsePageRanges('1-2,4', 4), 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce(parsePageRanges('1-3,3-4', 4), 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([{ start: 0, end: 4 }], 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([{ start: 1, end: 5 }], 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([{ start: 3, end: 2 }], 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([null], 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([], 4), false);
  assert.equal(splitCoversAllPagesExactlyOnce([{ start: 1, end: 1 }], 0), false);
});

test('split preview counts omitted and repeated output pages without changing the range order', () => {
  const omitted = splitCoverageDetails(parsePageRanges('1-2,4', 4), 4);
  assert.deepEqual(omitted, { total: 4, included: 3, omitted: [3], repeated: [], complete: false });
  const repeated = splitCoverageDetails(parsePageRanges('3-4,1-3', 4), 4);
  assert.deepEqual(repeated, { total: 4, included: 4, omitted: [], repeated: [3], complete: false });
  assert.deepEqual(splitCoverageDetails(chunkPageRanges(7, 3), 7), {
    total: 7, included: 7, omitted: [], repeated: [], complete: true,
  });
  assert.equal(splitCoverageDetails([{ start: 0, end: 2 }], 4), null);
  assert.equal(splitCoverageDetails([{ start: 1, end: 5 }], 4), null);
  assert.equal(splitCoverageDetails([], 4), null);
  assert.equal(splitCoverageDetails([{ start: 1, end: 1 }], 601), null);
  assert.equal(splitCoversAllPagesExactlyOnce(parsePageRanges('3-4,1-3', 4), 4), false);
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

test('visual split positions create full, ordered PDF ranges from CURRENT page positions', () => {
  assert.equal(splitRangesFromCuts([4, 2], 6), '1-2, 3-4, 5-6');
  assert.deepEqual(splitCutsFromRanges('1-2, 3-4, 5-6', 6), [2, 4]);
  assert.deepEqual(splitCutsFromRanges('１－２，３－４，５－６', 6), [2, 4]);
  assert.equal(splitRangesFromCuts([], 6), '1-6');
  assert.deepEqual(splitCutsFromRanges('1-6', 6), []);
  assert.deepEqual(splitCutsFromRanges('', 6), []);
  assert.deepEqual(splitCutsFromRanges('1', 1), []);
  for (const custom of ['2-6', '1-3, 3-6', '4-6, 1-3', '1-3', '1-9', 'invalid']) {
    assert.equal(splitCutsFromRanges(custom, 6), null, custom);
  }
  assert.throws(() => splitRangesFromCuts([1, 1], 6), /position/);
  assert.throws(() => splitRangesFromCuts([0], 6), /position/);
  assert.throws(() => splitRangesFromCuts([6], 6), /position/);
  assert.throws(() => splitRangesFromCuts([1.5], 6), /position/);
  assert.throws(() => splitRangesFromCuts([1], 0), /count/);
  const fiftyParts = splitRangesFromCuts(Array.from({ length: 49 }, (_, i) => i + 1), 100);
  assert.equal(parsePageRanges(fiftyParts, 100).length, 50);
  assert.throws(() => splitRangesFromCuts(Array.from({ length: 50 }, (_, i) => i + 1), 100), /50 ranges/);
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

test('PDF filename sorting groups interleaved sources but preserves each source page order', () => {
  const original = Object.freeze([
    { id: 'z0', sourceId: 'z', pageIndex: 0, rotation: 90 },
    { id: 'a0', sourceId: 'a', pageIndex: 0, rotation: 0 },
    { id: 'z1', sourceId: 'z', pageIndex: 1, rotation: 270 },
    { id: 'a1', sourceId: 'a', pageIndex: 1, rotation: 0 },
  ].map(page => Object.freeze(page)));
  const sources = [{ id: 'z', name: 'scan10.pdf' }, { id: 'a', name: 'scan2.pdf' }];
  const ascending = sortPagesByFilename(original, sources, 'en', 'asc');
  const descending = sortPagesByFilename(original, sources, 'en', 'desc');
  assert.deepEqual(ids(ascending), ['a0', 'a1', 'z0', 'z1']);
  assert.deepEqual(ids(descending), ['z0', 'z1', 'a0', 'a1']);
  assert.equal(ascending[2].rotation, 90);
  assert.equal(ascending[3].rotation, 270);
  assert.deepEqual(ids(original), ['z0', 'a0', 'z1', 'a1']);
  const modified = commitHistory(makeHistoryState(original), descending);
  assert.deepEqual(ids(undoHistory(modified).present), ids(original));
  assert.deepEqual(ids(redoHistory(undoHistory(modified)).present), ids(descending));
  assert.strictEqual(commitHistory(makeHistoryState(ascending),
    sortPagesByFilename(ascending, sources, 'en', 'asc')).past.length, 0);
});

test('identically named source PDFs sort as separate files using import order', () => {
  const mixed = [
    { id: '2-0', sourceId: 'second' },
    { id: '1-0', sourceId: 'first' },
    { id: '2-1', sourceId: 'second' },
    { id: '1-1', sourceId: 'first' },
  ];
  const sources = [{ id: 'first', name: 'same.pdf' }, { id: 'second', name: 'same.pdf' }];
  assert.deepEqual(ids(sortPagesByFilename(mixed, sources, 'en', 'asc')),
    ['1-0', '1-1', '2-0', '2-1']);
  assert.deepEqual(ids(sortPagesByFilename(mixed, sources, 'en', 'desc')),
    ['1-0', '1-1', '2-0', '2-1']);
});

test('duplex scans interleave 1,3,5 with reversed 6,4,2 as 1,2,3,4,5,6', () => {
  const fronts = [1, 3, 5].map(n => Object.freeze({ id: String(n), sourceId: 'fronts', pageIndex: n - 1, rotation: 90 }));
  const backs = [6, 4, 2].map(n => Object.freeze({ id: String(n), sourceId: 'backs', pageIndex: n - 1, rotation: 0 }));
  const imported = Object.freeze([...fronts, ...backs]);
  const reversed = interleaveDuplexPages(imported, true);
  assert.deepEqual(ids(reversed), ['1','2','3','4','5','6']);
  assert.deepEqual(ids(interleaveDuplexPages(imported, false)), ['1','6','3','4','5','2']);
  assert.equal(reversed[0].rotation, 90);
  assert.equal(reversed[1].pageIndex, 1);
  assert.deepEqual(ids(imported), ['1','3','5','6','4','2']);
  const history = commitHistory(makeHistoryState(imported), reversed);
  assert.deepEqual(ids(undoHistory(history).present), ids(imported));
  assert.deepEqual(ids(redoHistory(undoHistory(history)).present), ids(reversed));
  assert.strictEqual(interleaveDuplexPages(reversed, false), reversed);
});

test('duplex interleave allows one extra front, but rejects mismatched source counts safely', () => {
  const make = (id, sourceId) => ({ id, sourceId, pageIndex: 0, rotation: 0 });
  const frontLonger = [make('f1', 'a'), make('f2', 'a'), make('b1', 'b')];
  assert.deepEqual(ids(interleaveDuplexPages(frontLonger)), ['f1', 'b1', 'f2']);
  const bad = [make('f1','a'),make('f2','a'),make('f3','a'),make('b1','b')];
  assert.throws(() => interleaveDuplexPages(bad), /same number of pages.*one extra/);
  assert.deepEqual(ids(bad), ['f1', 'f2', 'f3', 'b1']);
  assert.throws(() => interleaveDuplexPages([make('f1','a')]), /exactly two/);
  assert.throws(() => interleaveDuplexPages([make('f1','a'),make('b1','b'),make('c1','c')]), /exactly two/);
  assert.throws(() => interleaveDuplexPages([make('f1','a'),make('b1','b'),make('b2','b')]), /same number/);
  assert.throws(() => interleaveDuplexPages([], true), /exactly two/);
  assert.throws(() => interleaveDuplexPages(frontLonger, 'reverse'), /Choose two/);
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
