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

/** Predict the exact insertion side of the current drag operations.
 * A single page inserted at a later target goes AFTER it; otherwise BEFORE.
 * Grouped selected pages always insert BEFORE the target page.
 * This helper changes visual feedback, never the established page ordering.
 */
export function pageDropSide(pages, movingIds, targetId) {
  if (!Array.isArray(movingIds) || !movingIds.length) return null;
  if (movingIds.includes(targetId)) return null;
  const fromIndex = pages.findIndex(page => page.id === movingIds[0]);
  const toIndex = pages.findIndex(page => page.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return null;
  return movingIds.length > 1 || fromIndex > toIndex ? 'before' : 'after';
}

/** Reinsert the current selection immediately before/after an UNSELECTED page.
 * The target is its original 1-based OUTPUT position, prior to removal.
 * Moved pages keep their relative order, identities, rotations and sources.
 * Return the same array on no-op to avoid inventing an Undo step.
 */
export function moveSelectedPagesToPosition(pages, selectedIds, targetPosition, side = 'before') {
  if (!Number.isSafeInteger(targetPosition) || targetPosition < 1 || targetPosition > pages.length) {
    throw new Error('Target must be a current output page number.');
  }
  if (side !== 'before' && side !== 'after') {
    throw new Error('Specify before or after the target page.');
  }
  const selected = new Set(selectedIds);
  const moved = pages.filter(page => selected.has(page.id));
  if (!moved.length || moved.length !== selected.size) {
    throw new Error('Select existing pages to move.');
  }
  const anchor = pages[targetPosition - 1];
  if (selected.has(anchor.id)) {
    throw new Error('Target page is selected. Choose an unselected page.');
  }
  const remaining = pages.filter(page => !selected.has(page.id));
  const remainingTarget = remaining.indexOf(anchor);
  if (remainingTarget < 0) throw new Error('Target page is no longer in the workspace.');
  const insertAt = remainingTarget + (side === 'after' ? 1 : 0);
  const next = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
  return next.every((page, index) => page === pages[index]) ? pages : next;
}

export function shiftPage(pages, pageId, delta) {
  const from = pages.findIndex((page) => page.id === pageId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= pages.length) return pages;
  const next = [...pages];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Explicit page-order actions; never silently reorder on import. */
export function reversePages(pages) {
  return pages.length < 2 ? pages : [...pages].reverse();
}

/** Explicitly sort complete source-file groups by filename. Within each file,
 * keep the pages in their current relative order (including edits/rotations).
 * A-Z and Z-A must NOT be implemented by reversing every PDF page.
 */
export function sortPagesByFilename(pages, sources, locale = 'en', direction = 'asc') {
  const names = new Map(sources.map((source) => [source.id, source.name]));
  // Different sources can have the same filename. Keep each original file
  // together, using import order as the stable tie-breaker for A-Z and Z-A.
  const sourceOrder = new Map(sources.map((source, index) => [source.id, index]));
  const compare = new Intl.Collator(locale === 'zh' ? 'zh' : 'en', { numeric: true, sensitivity: 'base' });
  const multiplier = direction === 'desc' ? -1 : 1;
  return pages.map((page, index) => ({ page, index }))
    .sort((a, b) => multiplier * compare.compare(names.get(a.page.sourceId) || '', names.get(b.page.sourceId) || '') ||
      (sourceOrder.get(a.page.sourceId) ?? 0) - (sourceOrder.get(b.page.sourceId) ?? 0) || a.index - b.index)
    .map(({ page }) => page);
}

/** Explicitly recombine two simplex scans into duplex reading order.
 * Source A contains front/odd pages; source B contains back/even pages,
 * possibly scanned backwards after turning over the paper stack.
 * Neither source document nor page rotation is modified; this only produces
 * a new page-reference order, making the operation a single Undo step.
 */
export function interleaveDuplexPages(pages, reverseBacks = false) {
  if (!Array.isArray(pages) || typeof reverseBacks !== 'boolean') {
    throw new Error('Choose two source PDFs for duplex interleaving.');
  }
  // Source order is the order in which the FIRST ACTIVE page of each source
  // occurs in the current export. This is the same order shown in source view.
  const groups = groupPagesBySource(pages);
  if (groups.length !== 2) throw new Error('Choose exactly two source PDFs for duplex interleaving.');
  const fronts = groups[0].items.map(item => item.pageRef);
  const backs = groups[1].items.map(item => item.pageRef);
  // A last sheet can have an empty back side, but unmatched middle sheets
  // cannot be inferred safely. Reject rather than silently discard pages.
  if (fronts.length < backs.length || fronts.length > backs.length + 1) {
    throw new Error('Front PDF must have the same number of pages as the back PDF, or one extra.');
  }
  const orderedBacks = reverseBacks ? [...backs].reverse() : backs;
  const next = [];
  for (let index = 0; index < fronts.length; index++) {
    next.push(fronts[index]);
    if (orderedBacks[index]) next.push(orderedBacks[index]);
  }
  return next.every((page, index) => page === pages[index]) ? pages : next;
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
  // Browser users often paste ranges with fullwidth Chinese punctuation,
  // Unicode dashes or digits. Normalize separators without relaxing bounds,
  // inverted-range checks or the 50-range safety limit.
  const normalized = input.normalize('NFKC')
    .replace(/[\uFF0C\u3001\uFF1B;]/g, ',')
    .replace(/[\u2010-\u2015\u2212]/g, '-');
  const parts = normalized.split(',').map((part) => part.trim());
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

/** Convert a visual set of cuts (AFTER each output page) to complete, ordered
 * ranges. Nothing is omitted or duplicated, including on reordered workspaces.
 * The existing 50-PDF safety ceiling also applies to visual split choices.
 */
export function splitRangesFromCuts(cutPages, pageCount, maxParts = 50) {
  if (!Array.isArray(cutPages) || !Number.isSafeInteger(pageCount) ||
      pageCount < 1 || pageCount > 600) throw new Error('Invalid split page count.');
  const sorted = [...cutPages].sort((a, b) => a - b);
  if (sorted.length + 1 > maxParts) throw new Error(`A maximum of ${maxParts} ranges is supported.`);
  if (sorted.some((page, index) => !Number.isSafeInteger(page) ||
      page < 1 || page >= pageCount || (index > 0 && page === sorted[index - 1]))) {
    throw new Error('Invalid visual split position.');
  }
  let start = 1;
  return [...sorted, pageCount].map(end => {
    const part = start === end ? String(start) : `${start}-${end}`;
    start = end + 1;
    return part;
  }).join(', ');
}

/** Visual cuts are meaningful only for a complete, consecutive partition.
 * An intentionally partial, overlapping or out-of-order typed range is NOT
 * silently rewritten by the visual editor; require explicit consent instead.
 * null = custom/invalid input, [] = blank or full-document single range.
 */
export function splitCutsFromRanges(input, pageCount) {
  if (typeof input !== 'string' || !Number.isSafeInteger(pageCount) || pageCount < 1) return null;
  if (!input.trim()) return [];
  let parts;
  try { parts = parsePageRanges(input, pageCount); }
  catch { return null; }
  const cuts = [];
  let next = 1;
  for (const part of parts) {
    if (part.start !== next) return null;
    if (part.end < pageCount) cuts.push(part.end);
    next = part.end + 1;
  }
  return next === pageCount + 1 ? cuts : null;
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

/** Odd/even refer to the CURRENT one-based export position, never an original
 * PDF source-page label. These operations avoid the 50-range input limit and
 * create no document edit/history entry.
 */
export function pageIdsForParity(pages, parity) {
  if (parity !== 'odd' && parity !== 'even') throw new Error('Choose odd or even output pages.');
  const target = parity === 'odd' ? 0 : 1;
  return new Set(pages.filter((_, index) => index % 2 === target).map(page => page.id));
}

/** Invert only the IDs currently present, even if history retains old pages. */
export function invertPageIdSelection(pages, selectedIds) {
  const selected = new Set(selectedIds);
  return new Set(pages.filter(page => !selected.has(page.id)).map(page => page.id));
}

/** Split every N CURRENT output pages into explicit batches of up to
 * 50 output PDFs. Never allocate or download the other batches implicitly.
 * A final PDF may contain fewer than N pages; no pages are omitted/repeated.
 * We retain a strict 600-page workspace and 50-PDF download ceiling.
 */
export function splitChunkBatch(pageCount, chunkSize, batchIndex) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 600) {
    throw new Error('Choose a document with 1 to 600 pages.');
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > pageCount) {
    throw new Error('Choose a valid pages-per-file value.');
  }
  const fileCount = Math.ceil(pageCount / chunkSize);
  const total = Math.ceil(fileCount / 50);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= total) {
    throw new Error('Choose a valid split batch.');
  }
  const firstOutput = batchIndex * 50;
  const parts = Array.from({ length: Math.min(50, fileCount - firstOutput) }, (_, offset) => {
    const start = (firstOutput + offset) * chunkSize + 1;
    return { start, end: Math.min(pageCount, start + chunkSize - 1) };
  });
  return {
    index: batchIndex, total,
    start: parts[0].start, end: parts[parts.length - 1].end,
    parts,
  };
}

/** Compatibility helper for the existing One PDF per page shortcut. */
export function splitSinglePageBatch(pageCount, batchIndex) {
  return splitChunkBatch(pageCount, 1, batchIndex);
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

/** A split is a complete saved document only when every current output page
 * appears in exactly one downloaded part. Keep the unsaved guard for gaps,
 * overlaps, malformed ranges and partial extracts, regardless of part order.
 */
export function splitCoverageDetails(ranges, pageCount) {
  if (!Array.isArray(ranges) || !ranges.length ||
      !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 600) return null;
  // A byte per output page is enough: count 0, 1, or "two or more".
  const occurrences = new Uint8Array(pageCount);
  for (const range of ranges) {
    if (!Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end) ||
        range.start < 1 || range.end < range.start || range.end > pageCount) return null;
    for (let page = range.start; page <= range.end; page++) {
      occurrences[page - 1] = Math.min(2, occurrences[page - 1] + 1);
    }
  }
  const omitted = [];
  const repeated = [];
  occurrences.forEach((count, index) => {
    if (count === 0) omitted.push(index + 1);
    if (count > 1) repeated.push(index + 1);
  });
  return {
    total: pageCount, included: pageCount - omitted.length,
    omitted, repeated, complete: omitted.length === 0 && repeated.length === 0,
  };
}

export function splitCoversAllPagesExactlyOnce(ranges, pageCount) {
  return splitCoverageDetails(ranges, pageCount)?.complete === true;
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
