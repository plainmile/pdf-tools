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
