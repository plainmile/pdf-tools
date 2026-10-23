/** Pure, deterministic page operations; none of these mutate their arguments. */
export const MAX_SPLIT_ZIP_BYTES = 128 * 1024 * 1024;

// ZIP assembly holds generated PDF buffers plus archive buffers in browser memory.
export function enforceSplitZipBudget(totalBytes, nextBytes) {
  if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(nextBytes) ||
      totalBytes < 0 || nextBytes < 1 || totalBytes + nextBytes > MAX_SPLIT_ZIP_BYTES) {
    throw new Error('Split PDF outputs exceed the 128 MB safety limit. Use fewer or smaller page ranges.');
  }
  return totalBytes + nextBytes;
}

/** Count only source files still represented in the current page workspace.
 * Sources held exclusively for Undo must not consume the 20 ACTIVE-file slots.
 * Their buffers remain part of the separate real 200 MiB memory budget.
 */
export function countActiveSources(pages) {
  return new Set(pages.map((page) => page.sourceId)).size;
}

/**
 * A read-only presentation grouping by original source. Each item retains
 * its REAL index in export order, even if pages were interleaved across PDFs.
 * Never use these groups when composing/exporting or changing page order.
 * Deleted/Undo-only sources are omitted because they have no active pages.
 */
export function groupPagesBySource(pages) {
  const groups = new Map();
  pages.forEach((pageRef, index) => {
    let group = groups.get(pageRef.sourceId);
    if (!group) {
      group = { sourceId: pageRef.sourceId, items: [] };
      groups.set(pageRef.sourceId, group);
    }
    group.items.push({ pageRef, index });
  });
  return [...groups.values()];
}

export function movePage(pages, draggedId, targetId) {
  const from = pages.findIndex((page) => page.id === draggedId);
  const to = pages.findIndex((page) => page.id === targetId);
  if (from < 0 || to < 0 || from === to) return pages;
  const next = [...pages];
  const [page] = next.splice(from, 1);
  next.splice(to, 0, page);
  return next;
}

/** Move all selected pages as one contiguous group, preserving their original order. */
export function movePageGroup(pages, pageIds, targetId) {
  const movingIds = new Set(pageIds);
  if (!movingIds.size || movingIds.has(targetId)) return pages;
  const moved = pages.filter((page) => movingIds.has(page.id));
  if (!moved.length) return pages;
  const remaining = pages.filter((page) => !movingIds.has(page.id));
  const target = remaining.findIndex((page) => page.id === targetId);
  if (target < 0) return pages;
  const result = [...remaining.slice(0, target), ...moved, ...remaining.slice(target)];
  return result.every((page, index) => page === pages[index]) ? pages : result;
}

export function shiftPage(pages, pageId, delta) {
  const from = pages.findIndex((page) => page.id === pageId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= pages.length) return pages;
  const next = [...pages];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Explicit image-batch actions; never silently reorder on import. */
export function reversePages(pages) {
  return pages.length < 2 ? pages : [...pages].reverse();
}

export function sortPagesByFilename(pages, sources, locale = 'en') {
  const names = new Map(sources.map((source) => [source.id, source.name]));
  const compare = new Intl.Collator(locale === 'zh' ? 'zh' : 'en', { numeric: true, sensitivity: 'base' });
  return pages.map((page, index) => ({ page, index }))
    .sort((a, b) => compare.compare(names.get(a.page.sourceId) || '', names.get(b.page.sourceId) || '') || a.index - b.index)
    .map(({ page }) => page);
}

/** Duplicate selected pages immediately AFTER their originals in current order.
 * Copies receive fresh page IDs but point to the same underlying source page;
 * the source bytes and rotation stay unchanged, and Undo restores original order.
 */
export function duplicatePages(pages, ids, createId, maxPages = 600) {
  const selected = new Set(ids);
  const count = pages.reduce((n, page) => n + (selected.has(page.id) ? 1 : 0), 0);
  if (!count) return pages;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || pages.length + count > maxPages) {
    throw new Error(`At most ${maxPages} pages can be added.`);
  }
  if (typeof createId !== 'function') throw new Error('A page ID generator is required.');
  return pages.flatMap(page => selected.has(page.id)
    ? [page, { ...page, id: createId() }] : [page]);
}

/** Put a new page after one existing page (or after the last page).
 * The caller owns construction of the source PDF and the fresh page ID.
 */
export function insertPageAfter(pages, afterIndex, page) {
  if (!Number.isSafeInteger(afterIndex) || afterIndex < -1 || afterIndex >= pages.length || !page?.id) {
    throw new Error('Invalid blank page insertion position.');
  }
  return [...pages.slice(0, afterIndex + 1), page, ...pages.slice(afterIndex + 1)];
}

export function rotatePages(pages, ids, degrees) {
  const selected = new Set(ids);
  return pages.map((page) => selected.has(page.id)
    ? { ...page, rotation: ((page.rotation + degrees) % 360 + 360) % 360 }
    : page);
}

export function deletePages(pages, ids) {
  const selected = new Set(ids);
  return pages.filter((page) => !selected.has(page.id));
}

export function parsePageRanges(input, pageCount, maxRanges = 50) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('There are no pages to split.');
  const parts = input.split(',').map((part) => part.trim());
  if (!parts.length || parts.some((part) => !part)) throw new Error('Use a range such as 1-3, 4-6.');
  if (parts.length > maxRanges) throw new Error(`A maximum of ${maxRanges} ranges is supported.`);
  return parts.map((part) => {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid page range: ${part}`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Range ${part} is outside pages 1-${pageCount}, or reversed.`);
    }
    return { start, end };
  });
}

/** Select by the current EXPORT order rather than the source PDF page number.
 * Repeated/overlapping ranges are deduplicated, and validation is atomic.
 */
export function pageIdsForRanges(pages, input) {
  const chosen = new Set();
  for (const { start, end } of parsePageRanges(input, pages.length)) {
    for (let index = start - 1; index < end; index++) chosen.add(pages[index].id);
  }
  return chosen;
}

export function chunkPageRanges(pageCount, chunkSize) {
  const n = Number(chunkSize);
  if (!Number.isSafeInteger(n) || n < 1 || n > pageCount) throw new Error('Choose a valid pages-per-file value.');
  const result = [];
  for (let start = 1; start <= pageCount; start += n) {
    result.push({ start, end: Math.min(pageCount, start + n - 1) });
  }
  if (result.length > 50) throw new Error('A maximum of 50 output PDFs is supported. Increase pages per file.');
  return result;
}

export function getRangePages(pages, range) {
  return pages.slice(range.start - 1, range.end);
}

/** Sources are needed while referenced by current, Undo or Redo pages.
 * A deleted file may be kept for Undo, but once that snapshot falls outside
 * the bounded history there is no reason to keep its sensitive bytes in RAM.
 */
export function historyReferencedSourceIds(history) {
  const ids = new Set();
  for (const snapshot of [...history.past, history.present, ...history.future]) {
    for (const page of snapshot) ids.add(page.sourceId);
  }
  return ids;
}

export function makeHistoryState(pages = []) {
  return { past: [], present: pages, future: [] };
}

export function commitHistory(history, nextPages) {
  if (nextPages === history.present) return history;
  if (nextPages.length === history.present.length && nextPages.every((p, i) => p === history.present[i])) return history;
  return { past: [...history.past.slice(-19), history.present], present: nextPages, future: [] };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  const next = history.future[0];
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
