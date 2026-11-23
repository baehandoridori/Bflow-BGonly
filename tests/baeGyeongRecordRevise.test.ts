import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { BAE_DEFAULT_FIXED } from '../electron/bae/defaultTexts.ts';
import { BAE_ROUGH_SAME_MAX, baeGrayDiff, baeOrderFromRecord, baeRecordReviseBlock } from '../src/shared/bae/order/fromRecord.ts';

// 2026-11-23 한솔 '한글로 주문서 고치기는 어딨어': 앱을 다시 켜면 방금 그림도 기록이 되어 작업대 주문서 칸이 보기만 됐다.
// 기록에 남은 PD 글로 이전 주문서를 다시 세워 고칠 수 있게 — 다시 세운 주문서가 PD 에게 가는 고치기 재료를 앱 안 주문서와 똑같이 만드는지 본다.
const built = await build({ entryPoints: ['src/shared/bae/order/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
const O: any = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const FIX = new URL('./fixtures/bae/order/', import.meta.url);

/** draw() 가 서버에 남기는 모양 그대로 (summary · pd). */
function recordOf(prev: any, promptText: string) {
  return {
    kind: 'new' as const, status: 'done' as const,
    summary: { picks: prev.picks, refNotes: prev.refIds.map(() => ''), manualVer: prev.manualVer, fixedVer: prev.blocksVer, tilt: prev.tilt,
      ...(prev.place ? { base: { mode: prev.place.mode, n: prev.place.n, painted: prev.place.painted, notes: Array.from({ length: prev.place.n }, () => ''), parts: 0 } } : {}) },
    pd: { summaryKo: prev.summary, notesKo: prev.notes, reason: prev.reason, prompt: promptText, raw: prev.raw, revisions: prev.revisions, revTexts: prev.revTexts,
      director: prev.director ? { ko: prev.director.ko, en: prev.director.en, replaced: prev.director.replaced } : null },
  };
}

test('a recorded order rebuilds the same revise input the live order gives the PD', () => {
  let n = 0;
  for (const name of readdirSync(FIX).filter((x) => x.endsWith('.json') && x !== 'html.json')) {
    const f = JSON.parse(readFileSync(new URL(name, FIX), 'utf8'));
    const prev = f.snap?.prevOrder; if (!prev || typeof f.call?.revText !== 'string') continue;
    const rec = recordOf(prev, f.snap.promptBefore);
    const back = baeOrderFromRecord(rec as any, prev.refIds);
    assert.deepEqual(O.reviseInput(f.call.revText, f.snap.promptBefore, back, BAE_DEFAULT_FIXED, null),
      O.reviseInput(f.call.revText, f.snap.promptBefore, prev, BAE_DEFAULT_FIXED, null), name);
    assert.equal(O.mappingText(back), O.mappingText(prev), name);
    assert.deepEqual(back.revisions, prev.revisions); assert.deepEqual(back.revTexts, prev.revTexts);
    n++;
  }
  assert.ok(n >= 1, 'at least one revise fixture');
});

test('reference count mismatch keeps the recorded count (image numbers stay those of the picture)', () => {
  const rec = { summary: { refNotes: ['a', 'b'], picks: ['L2'] }, pd: { summaryKo: '요약', prompt: 'p' } };
  assert.deepEqual(baeOrderFromRecord(rec as any, [7, 8]).refIds, [7, 8]);
  assert.deepEqual(baeOrderFromRecord(rec as any, [7]).refIds, ['rec-0', 'rec-1']);
  const o = baeOrderFromRecord({ summary: { base: { mode: 'base', n: 2, painted: true, notes: ['', ''], parts: 0 } }, pd: { prompt: 'p', summaryKo: 's' } } as any, []);
  assert.deepEqual(o.place, { mode: 'base', n: 2, painted: true });
  assert.equal(o.dirty, false); assert.equal(o.prompt, 'p');
});

test('only finished new / same-place pictures with a kept order can be revised', () => {
  const pd = { summaryKo: '요약', prompt: 'prompt' };
  assert.equal(baeRecordReviseBlock({ kind: 'new', status: 'done', pd }), '');
  assert.equal(baeRecordReviseBlock({ kind: 'same', status: 'failed', pd }), '');
  assert.equal(baeRecordReviseBlock({ kind: 'new', status: 'stopped', pd }), '');
  assert.notEqual(baeRecordReviseBlock({ kind: 'angle', status: 'done', pd }), '');
  assert.notEqual(baeRecordReviseBlock({ kind: 'upscale', status: 'done', pd } as any), '');
  assert.notEqual(baeRecordReviseBlock({ kind: 'new', status: 'drawing', pd }), '');
  assert.notEqual(baeRecordReviseBlock({ kind: 'new', status: 'done', pd: { summaryKo: '요약' } }), '');
  assert.notEqual(baeRecordReviseBlock({ kind: 'new', status: 'done' }), '');
});

test('rough comparison: same drawing re-saved stays under the line, a different drawing goes over', () => {
  const W = 96, H = 54; const paper = () => new Float32Array(W * H).fill(1);
  const line = (g: Float32Array, y: number, x0: number, x1: number, v = 0.1) => { for (let x = x0; x < x1; x++) g[y * W + x] = v; };
  const a = paper(); line(a, 10, 5, 80); line(a, 30, 20, 60);
  const resaved = a.map((v) => Math.min(1, Math.max(0, v + (v < 0.5 ? 0.04 : -0.02))));
  const other = paper(); line(other, 40, 10, 90); line(other, 5, 30, 50);
  assert.ok(baeGrayDiff(a, resaved) <= BAE_ROUGH_SAME_MAX);
  assert.ok(baeGrayDiff(a, other) > BAE_ROUGH_SAME_MAX);
  assert.equal(baeGrayDiff(paper(), paper()), 0);
  assert.equal(baeGrayDiff(a, new Float32Array(3)), 1);
});
