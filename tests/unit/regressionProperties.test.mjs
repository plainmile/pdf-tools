import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitRangesFromCuts, splitCutsFromRanges, parsePageRanges,
  getRangePages, splitCoverageDetails,
  makeHistoryState, commitHistory, undoHistory, redoHistory,
} from '../../src/lib/pageOperations.mjs';
import { imagePdfPageLayout } from '../../src/lib/imagePdfLayout.mjs';

let state = 0x5eed2026;
function rand() {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return state >>> 0;
}

test('600-case deterministic split property regression preserves each output page exactly once', () => {
  for (let iteration = 0; iteration < 600; iteration++) {
    const count = 1 + rand() % 600;
    const maxCutCount = Math.min(49, count - 1);
    const countOfCuts = maxCutCount ? rand() % (maxCutCount + 1) : 0;
    const available = Array.from({ length: count - 1 }, (_, i) => i + 1);
    for (let i = available.length - 1; i > 0; i--) {
      const j = rand() % (i + 1);
      [available[i], available[j]] = [available[j], available[i]];
    }
    const shuffledCuts = available.slice(0, countOfCuts);
    const expectedCuts = [...shuffledCuts].sort((a,b) => a-b);
    const ranges = splitRangesFromCuts(shuffledCuts, count);
    assert.deepEqual(splitCutsFromRanges(ranges, count), expectedCuts, 'round trip ' + iteration);
    const parts = parsePageRanges(ranges, count);
    assert.equal(parts.length, countOfCuts + 1, 'count ' + iteration);
    const coverage = splitCoverageDetails(parts, count);
    assert.equal(coverage.complete, true, 'coverage ' + iteration);
    assert.equal(coverage.included, count);
    assert.deepEqual(coverage.repeated, []);
    assert.deepEqual(coverage.omitted, []);
    const original = Array.from({length:count},(_,i)=>({id:'item-'+(i+1)}));
    const exported = parts.flatMap(p=>getRangePages(original,p));
    assert.deepEqual(exported.map(p=>p.id), original.map(p=>p.id), 'pages ' + iteration);
  }
});

test('history retention is bounded after long edits, Undo and Redo remain byte-order-equivalent', () => {
  let history = makeHistoryState([{id:'original',sourceId:'pdf'}]);
  for (let n=1;n<=35;n++) {
    const next = [...history.present,{id:'edit-'+n,sourceId:'pdf'}];
    history = commitHistory(history,next);
    assert.ok(history.past.length<=20);
    assert.equal(history.future.length,0);
  }
  const latest = history.present;
  assert.equal(latest.length,36);
  for(let i=0;i<20;i++) history=undoHistory(history);
  assert.equal(history.present.length,16);
  assert.equal(history.past.length,0);
  assert.equal(undoHistory(history),history,'further Undo is a no-op');
  for(let i=0;i<20;i++) history=redoHistory(history);
  assert.deepEqual(history.present,latest);
  assert.equal(history.future.length,0);
  const noOp = commitHistory(history,history.present);
  assert.equal(noOp,history);
  history = undoHistory(history);
  history = commitHistory(history,[...history.present,{id:'fork',sourceId:'pdf'}]);
  assert.equal(history.future.length,0,'a new edit invalidates old redo history');
});

test('PDF photo layout geometry is finite, bounded and leaves margins intact across extremes', () => {
  for(const dims of [[1,1],[240,360],[960,480],[5000,1000],[1000,5000],[24000,30000]]) {
    for(const paper of ['a4','letter','fit']) {
      for(const margin of [0,12,30,48]) {
        for(const imageSizing of ['contain','cover']) {
          const out = imagePdfPageLayout(...dims,{paper,margin,imageSizing,orientation:'auto'});
          assert.ok(out.width>0 && out.height>0 && out.width<=14400 && out.height<=14400);
          assert.ok(Number.isFinite(out.image.x) && Number.isFinite(out.image.y));
          assert.ok(out.image.width>0 && out.image.height>0);
          const printable={x:margin,y:margin,width:out.width-2*margin,height:out.height-2*margin};
          const tolerance=0.0001;
          if(out.clip) {
            assert.deepEqual(out.clip,printable);
            assert.ok(out.image.x <= margin+tolerance && out.image.y<=margin+tolerance);
            assert.ok(out.image.x+out.image.width >= out.width-margin-tolerance);
            assert.ok(out.image.y+out.image.height >= out.height-margin-tolerance);
          } else {
            assert.ok(out.image.x >= margin-tolerance);
            assert.ok(out.image.y >= margin-tolerance);
            assert.ok(out.image.x+out.image.width<=out.width-margin+tolerance);
            assert.ok(out.image.y+out.image.height<=out.height-margin+tolerance);
          }
        }
      }
    }
  }
});
