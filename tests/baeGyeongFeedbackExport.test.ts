import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { crc32 as zlibCrc32 } from 'node:zlib';
import {
  baeFeedbackAsk, baeFeedbackAskText, baeFeedbackCandidates, baeFeedbackDoneText, baeFeedbackHead, baeFeedbackIsReviewed, baeFeedbackItem, baeFeedbackJson,
  baeFeedbackKey, baeFeedbackMarkdown, baeFeedbackPick, baeFeedbackPlan, baeFeedbackRequestProblem, baeFeedbackReviewOf, baeFeedbackWants, baeFeedbackZipName,
  baeFeedbackZipPath, BAE_FEEDBACK_BUTTON_TITLE,
} from '../src/shared/bae/feedbackExport.ts';
import { crc32, storedZip } from '../src/shared/bae/storedZip.ts';
import type { BaeJob } from '../src/shared/bae/jobs.ts';
import { createBaePreviewGateway } from '../src/features/bae-gyeong/previewGateway.ts';

// BAE경 '피드백 내보내기' (HTML v0.4.11 exportFeedback · askExport · makeZip): 고르기 규칙, zip 안의 글과 그림, 메인 통로, 테스트 모드.

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const job = (n: number, patch: Partial<BaeJob> = {}): BaeJob => ({
  id: id(n), userId: 'u1', userName: '배한솔', kind: 'new', status: 'done', name: null, parentJobId: null,
  summary: { request: `요청 ${n}` }, result: {}, images: {}, selfReview: null, stamp: null, stampAt: null, costUsd: 0, origin: '', appVersion: '', hidden: false,
  createdAt: `2026-11-${String(n).padStart(2, '0')}T01:00:00.000Z`, finishedAt: null, updatedAt: `2026-11-${String(n).padStart(2, '0')}T01:00:00.000Z`, ...patch,
});
const reviewed = { rate: '좋음', good: '빛이 좋아요', bad: '' };

/** 압축 없는 zip 을 읽는다: 끝 표시 → 목록 → 파일 머리. CRC 와 크기를 다시 맞춰 본다. */
function readZip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.byteLength - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50, 'end record');
  const n = v.getUint16(eocd + 10, true); const cdSize = v.getUint32(eocd + 12, true); const cdOff = v.getUint32(eocd + 16, true);
  assert.equal(cdOff + cdSize, eocd, 'the list sits right before the end record');
  const dec = new TextDecoder(); const out: Array<{ name: string; data: Uint8Array; flags: number }> = [];
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const flags = v.getUint16(p + 8, true); const method = v.getUint16(p + 10, true); const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true); const nameLen = v.getUint16(p + 28, true); const off = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    assert.equal(method, 0, 'stored');
    assert.equal(v.getUint32(off, true), 0x04034b50, `${name}: local header`);
    assert.equal(v.getUint32(off + 14, true), crc); assert.equal(v.getUint32(off + 18, true), size);
    const ln = v.getUint16(off + 26, true);
    assert.equal(dec.decode(buf.subarray(off + 30, off + 30 + ln)), name);
    const data = buf.subarray(off + 30 + ln, off + 30 + ln + size);
    assert.equal(crc32(data), crc, `${name}: crc`);
    out.push({ name, data, flags });
    p += 46 + nameLen;
  }
  return out;
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('stored zip: the same crc as zlib, UTF-8 names, json and md listed first, readable back', () => {
  const sample = new TextEncoder().encode('BAE경 피드백 ✓'.repeat(100));
  assert.equal(crc32(sample), zlibCrc32(sample));
  assert.equal(crc32(new Uint8Array()), 0);
  const z = storedZip([{ name: 'images/r01_a_result.png', data: new Uint8Array([1, 2, 3]) }, { name: 'feedback.json', data: sample }, { name: '한글.md', data: new Uint8Array([9]) }],
    new Date(2026, 10, 18, 14, 5, 7), ['feedback.json']);
  const files = readZip(z);
  assert.deepEqual(files.map((f) => f.name), ['feedback.json', 'images/r01_a_result.png', '한글.md']);
  assert.ok(files.every((f) => f.flags & 0x0800), 'UTF-8 names');
  assert.deepEqual([...files[1].data], [1, 2, 3]);
  assert.throws(() => storedZip([{ name: 'a', data: new Uint8Array(1) }, { name: 'a', data: new Uint8Array(1) }]), /같은 이름/);
});

test('which records go in: finished drawings of mine that are not hidden; reviewed = my review or a 좋아요 · 다시 stamp', () => {
  assert.equal(baeFeedbackReviewOf({ rate: '', good: '', bad: '' }), null, 'an empty review form is no review');
  assert.deepEqual(baeFeedbackReviewOf(reviewed), { score: '좋음', problems: [], bad: '', good: '빛이 좋아요', want: '', marks: 0 });
  assert.deepEqual(baeFeedbackReviewOf({ score: '다시', tags: ['투시', ' '], strokes: [1, 2], want: '더 밝게' }), { score: '다시', problems: ['투시'], bad: '', good: '', want: '더 밝게', marks: 2 }, 'the HTML review shape is read too');
  assert.equal(baeFeedbackIsReviewed(job(1, { stamp: 'good' })), true);
  assert.equal(baeFeedbackIsReviewed(job(1, { stamp: 'again' })), true);
  assert.equal(baeFeedbackIsReviewed(job(1, { stamp: 'seen' })), false, '확인함 alone says nothing about the picture');
  const c = baeFeedbackCandidates([job(3), job(1), job(2, { status: 'failed' }), job(4, { hidden: true }), job(5, { kind: 'upscale' }), job(6, { kind: 'layers' }),
    job(7, { kind: 'angle' }), job(8, { kind: 'same' }), job(9, { kind: 'edit' }), job(3), job(10, { status: 'drawing' })]);
  assert.deepEqual(c.map((j) => j.id.slice(-2)), ['01', '03', '07', '08', '09'], 'oldest first, once each, tool jobs and unfinished ones left out');
});

test('what to ask: nothing · all (none reviewed) · reviewed only (no fresh) · ask; fresh = the newest 20 unreviewed', () => {
  assert.equal(baeFeedbackAsk(baeFeedbackPlan([])), 'none');
  assert.equal(baeFeedbackAsk(baeFeedbackPlan([job(1), job(2)])), 'all');
  assert.deepEqual(baeFeedbackPick(baeFeedbackPlan([job(2), job(1)]), true), { mode: 'all', jobs: [job(1), job(2)] });
  assert.equal(baeFeedbackAsk(baeFeedbackPlan([job(1, { selfReview: reviewed })])), 'reviewed');
  const many = Array.from({ length: 28 }, (_, i) => job(i + 1, { selfReview: i === 2 || i === 26 ? reviewed : null }));
  const plan = baeFeedbackPlan(many);
  assert.equal(baeFeedbackAsk(plan), 'ask');
  assert.equal(plan.reviewed.length, 2); assert.equal(plan.fresh.length, 20);
  assert.deepEqual(plan.fresh.map((j) => Number(j.id.slice(-2))), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28], 'the newest 20 unreviewed (3 and 27 are reviewed)');
  const only = baeFeedbackPick(plan, false); assert.equal(only.mode, 'reviewed'); assert.deepEqual(only.jobs.map((j) => j.id), [id(3), id(27)]);
  const fresh = baeFeedbackPick(plan, true); assert.equal(fresh.mode, 'fresh'); assert.equal(fresh.jobs.length, 22);
  assert.deepEqual(fresh.jobs.map((j) => j.createdAt), [...fresh.jobs.map((j) => j.createdAt)].sort(), 'by when they were made');
  const t = baeFeedbackAskText(2, 20);
  assert.equal(t.text, '검수한 그림이 2장 있어요. 검수하지 않은 최근 그림 20장도 같이 넣을까요? 새로 시험한 그림은 검수 전이라도 넣어 주세요.');
  assert.deepEqual([t.only, t.fresh, t.cancel], ['검수한 2장만', '최근 그림 20장도 넣기', '취소']);
  assert.equal(BAE_FEEDBACK_BUTTON_TITLE, '검수한 그림을 설명과 함께 zip 하나로 묶어요. 검수 안 한 최근 그림도 넣을 수 있어요');
});

test('request shape, file name and done text', () => {
  assert.equal(baeFeedbackRequestProblem({ mode: 'fresh', ids: [id(1), id(2)] }), null);
  assert.match(baeFeedbackRequestProblem({ mode: 'everything', ids: [id(1)] })!, /방식/);
  assert.match(baeFeedbackRequestProblem({ mode: 'all', ids: [] })!, /1~300/);
  assert.match(baeFeedbackRequestProblem({ mode: 'all', ids: Array.from({ length: 301 }, (_, i) => id(i + 1)) })!, /1~300/);
  assert.match(baeFeedbackRequestProblem({ mode: 'all', ids: ['../../x'] })!, /작업 번호/);
  assert.match(baeFeedbackRequestProblem({ mode: 'all', ids: [id(1), id(1)] })!, /작업 번호/);
  assert.match(baeFeedbackRequestProblem({ mode: 'all', ids: [id(1)], userId: 'u2' })!, /다시 골라/);
  assert.match(baeFeedbackRequestProblem(null)!, /다시 골라/);
  assert.equal(baeFeedbackZipName(new Date(2026, 10, 8, 9, 5, 59)), 'BAE경_피드백_20261108_0905.zip');
  assert.equal(baeFeedbackKey(0, id(7)), 'r01_11111111');
  assert.equal(baeFeedbackDoneText('reviewed', 3, 0), '검수한 그림 3장을 묶었어요');
  assert.equal(baeFeedbackDoneText('fresh', 9, 0), '검수한 그림과 최근 그림 9장을 묶었어요');
  assert.match(baeFeedbackDoneText('all', 4, 2), /^검수한 그림이 없어서 전부\(4장\) 묶었어요\. .*2장/);
});

test('pictures per record: this PC first (the shown version), the server preview after, the other color-lock and before-noise versions when there are some', () => {
  const j = job(1, {
    images: { result: 'https://s/bae/r.jpg', rough: 'https://s/bae/rough.jpg', refs: ['https://s/ref1.jpg'], bases: ['https://s/b1.jpg', 'https://s/b2.jpg'] },
    result: { finish: { lock: { moved: 3, on: false }, noise: { on: true, sec: 4 } } },
  });
  const w = baeFeedbackWants(j, 'r01_x');
  const by = (slot: string, n?: number) => w.find((x) => x.slot === slot && x.n === n)!;
  assert.deepEqual(by('result').local, ['result.png', 'alt_noise.png'], 'shown = color lock off + noise removed');
  assert.equal(by('result').url, 'https://s/bae/r.jpg'); assert.equal(by('result').required, true);
  assert.deepEqual(by('otherLock').local, ['final.png', 'gpt.png', 'source.png']);
  assert.equal(by('otherLock').stem, 'images/r01_x_result_locked', 'shown is before the lock, so the other one is the locked one');
  assert.deepEqual(by('beforeNoise').local, ['alt.png']);
  assert.equal(by('rough').required, true); assert.equal(by('roughNotes').required, false, 'no red notes were sent');
  assert.equal(by('ref', 1).required, true); assert.equal(by('ref', 2).required, false);
  assert.equal(by('base', 2).url, 'https://s/b2.jpg');
  assert.equal(by('marked').required, false);
  assert.equal(baeFeedbackZipPath(by('rough'), 'rough.jpg'), 'images/r01_x_rough.jpg');
  assert.equal(baeFeedbackZipPath(by('result'), 'alt_noise.png'), 'images/r01_x_result.png');
  assert.equal(baeFeedbackZipPath(by('result'), null), 'images/r01_x_result_preview.jpg');
  const plain = baeFeedbackWants(job(2), 'k');
  assert.deepEqual(plain.find((x) => x.slot === 'result')!.local, ['result.png', 'final.png', 'gpt.png', 'source.png']);
  assert.ok(!plain.some((x) => x.slot === 'otherLock' || x.slot === 'beforeNoise'));
  const on = baeFeedbackWants(job(3, { result: { finish: { lock: { moved: 1, on: true } } } }), 'k');
  assert.equal(on.find((x) => x.slot === 'otherLock')!.stem, 'images/k_result_before_lock');
  assert.deepEqual(on.find((x) => x.slot === 'otherLock')!.local, ['alt.png']);
});

test('feedback.json item and feedback.md follow the HTML shape', () => {
  const j: BaeJob = {
    ...job(5, { name: '교실 오후', selfReview: { rate: '다시', bad: '창문이 휘었어요', good: '색이 좋아요' }, stamp: 'again', stampAt: '2026-11-06T00:00:00Z', costUsd: 0.21 }),
    summary: { request: '교실 {창가 쪽}', ratio: '16:9', time: 'day', timeLabel: '낮', place: 'interior', persp: 'one', perspLabel: '1점 투시', manualVer: 'v1.7', fixedVer: 'v1', guidanceVer: '3',
      roughNotes: '칠판\n창문', picks: ['L2'], tilt: 2, base: { mode: 'sheet', n: 1, painted: true, notes: ['책상', ''], parts: 4 } },
    pd: { summaryKo: '오후 교실', notesKo: ['창문 크게'], prompt: 'A classroom.', director: { ko: ['창가 쪽'], en: ['by the window'], replaced: [] } },
    result: { w: 1536, h: 1024, model: 'gpt-image-2.5-sunburst', quality: 'high', sec: 51, finish: { tilt: 2, lock: { moved: 2, on: true }, noise: null } },
    stampNote: '창문을 곧게',
  };
  const got = [
    { slot: 'result' as const, path: 'images/r01_11111111_result.png', preview: false },
    { slot: 'ref' as const, n: 1, path: 'images/r01_11111111_ref1_preview.jpg', preview: true },
    { slot: 'otherLock' as const, path: 'images/r01_11111111_result_before_lock.png', preview: false },
  ];
  const it = baeFeedbackItem(j, 'r01_11111111', got, [{ slot: 'rough', label: '러프' }]);
  assert.equal(it.manual, 'v1.7'); assert.equal(it.size, '1536x1024'); assert.equal(it.time, '낮'); assert.equal(it.perspective, '1점 투시');
  assert.deepEqual(it.director, ['창가 쪽']); assert.deepEqual(it.pdNotes, ['창문 크게']); assert.equal(it.prompt, 'A classroom.');
  assert.equal(it.reviewed, true); assert.deepEqual(it.review, { score: '다시', problems: [], bad: '창문이 휘었어요', good: '색이 좋아요', want: '', marks: 0 });
  assert.deepEqual(it.stamp, { stamp: 'again', label: '다시', note: '창문을 곧게', at: '2026-11-06T00:00:00Z' });
  assert.deepEqual(it.colorLock, { shown: 'locked', moved: 2 }); assert.equal(it.noise, null); assert.equal(it.tilt, 2);
  assert.deepEqual(it.files, { result: 'images/r01_11111111_result.png', refs: ['images/r01_11111111_ref1_preview.jpg'], otherLock: 'images/r01_11111111_result_before_lock.png' });
  assert.deepEqual(it.previews, ['images/r01_11111111_ref1_preview.jpg']); assert.deepEqual(it.missing, ['러프']);
  assert.equal(baeFeedbackItem(job(6, { pd: {} }), 'k', [], [], 'from job.json').prompt, 'from job.json', 'the prompt kept on this PC when the row has none');

  const head = baeFeedbackHead({ app: 'BAE경 (B flow 1.151.0)', now: new Date(2026, 10, 18, 14, 5), versions: { manual: 'v1.7', fixed: 'v1', guidance: '3' }, mode: 'fresh', count: 1, skipped: 1 });
  assert.equal(head.onlyReviewed, false); assert.equal(head.withFresh, true);
  const json = JSON.parse(baeFeedbackJson(head, [it]));
  assert.equal(json.items[0].id, 'r01_11111111'); assert.equal(json.currentManual, 'v1.7'); assert.equal(json.count, 1);
  assert.ok(!('currentRulesKo' in json), 'the guidance text itself is not written (only its version)');
  const md = baeFeedbackMarkdown(head, [it]);
  for (const line of [
    '# BAE경 피드백 (11월 18일 14:05, 1장, 검수한 그림 + 검수 안 한 최근 그림)',
    '지금 매뉴얼: v1.7 · 고정 문장 v1 · 덧붙인 지침 3판',
    '## r01_11111111 · ', ' · 다시',
    '- 이름: 교실 오후',
    '- 매뉴얼 v1.7 · 1536x1024 (16:9) · 품질 high · gpt-image-2.5-sunburst',
    '- 시간대 낮 · 장소 실내 · 투시 1점 투시',
    '- 설명: 교실 {창가 쪽}', '- 개발자 지문: 창가 쪽', '- PD 메모: 창문 크게',
    '- 아쉬운 점: 창문이 휘었어요', '- 좋았던 점: 색이 좋아요', '- 검수자 도장: 다시 · 창문을 곧게',
    '- 기준 배경: 부품 시트 (부품 4개) · 칠한 러프 · 책상 · 기울기 2° · 색 맞춤 켬 (2곳)',
    '- 그림: images/r01_11111111_result.png, images/r01_11111111_ref1_preview.jpg',
    '- 넣지 못한 그림: 러프', '1건은 다시 읽지 못해 빠졌어요',
    '```\nA classroom.\n```',
  ]) assert.ok(md.includes(line), `md has: ${line}`);
  const unreviewed = baeFeedbackMarkdown(head, [baeFeedbackItem(job(7), 'r02_x', [], [])]);
  assert.match(unreviewed, /## r02_x · .* · 검수 안 함/);
  assert.match(unreviewed, /```\n\(주문서 기록 없음\)\n```/);
});

// ── 메인 통로 (electron/bae/baeFeedbackExport.ts) ──
let nonce = 0;
async function loadMain() {
  const r = await build({ entryPoints: ['electron/bae/baeFeedbackExport.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const PUB = (p: string) => `https://store.example/storage/v1/object/public/scene-images/${p}`;
const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);

function mainHarness(opts: { canUse?: boolean; pick?: string | null; failWrite?: boolean } = {}) {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'u1', epoch: 7 };
  const jobGets: string[] = []; const fetched: string[] = []; const reads: string[] = []; const sinks: Array<{ chunks: Uint8Array[]; committed: boolean; aborted: boolean; target: string }> = [];
  const rows = new Map<string, BaeJob>([
    // 이 PC 에서 만든 것: 원본이 있다 (색 맞춤 켬 → 맞추기 전 그림도)
    [id(1), job(1, { selfReview: reviewed, images: { result: PUB(`bae/${id(1)}/result_1600.jpg`), rough: PUB(`bae/${id(1)}/rough.jpg`) }, result: { w: 4, h: 3, finish: { lock: { moved: 1, on: true } } }, pd: { prompt: 'P1' } })],
    // 다른 PC 에서 만든 것: 서버 미리보기만. 러프 주소가 정해 둔 자리가 아니면 받지 않는다
    [id(2), job(2, { stamp: 'good', images: { result: PUB(`bae/${id(2)}/result_1600.jpg?v=1`), rough: 'https://evil.example/rough.jpg' } })],
    [id(3), job(3, { userId: 'u2' })],          // 남의 기록
    [id(4), job(4, { hidden: true })],          // 숨긴 기록
    [id(6), job(6, { kind: 'upscale' })],       // 도구 작업
    // job.json 에 다른 계정이 적힌 폴더: 이 PC 파일을 읽지 않고 미리보기로
    [id(8), job(8, { images: { result: PUB(`bae/${id(8)}/result_1600.jpg`) } })],
  ]);
  const files: Record<string, Record<string, Uint8Array>> = {
    [id(1)]: { 'result.png': png(1), 'rough.jpg': png(2), 'alt.png': png(3), 'final.png': png(4) },
    [id(8)]: { 'result.png': png(8) },
  };
  const deps = {
    ipc: { handle: (c: string, h: (...a: unknown[]) => Promise<unknown>) => handlers.set(c, h) },
    getSessionOriginOrThrow: () => origin,
    canUse: async () => opts.canUse ?? true,
    jobGet: async (actor: string, jobId: string) => { jobGets.push(`${actor}:${jobId}`); const j = rows.get(jobId); if (!j) throw new Error('없음'); return j; },
    versions: async () => ({ manual: 'v1.7', fixed: 'v1', guidance: null }),
    local: {
      readJobFile: async (jobId: string, name: string) => { reads.push(`${jobId.slice(-2)}/${name}`); return files[jobId]?.[name] ?? null; },
      readJobMeta: async (jobId: string) => (jobId === id(8) ? { ownerId: 'someone-else' } : jobId === id(1) ? { ownerId: 'u1', requestPrompt: 'local prompt' } : null),
    },
    publicUrl: PUB,
    pickZipPath: async (_e: unknown, name: string) => { assert.match(name, /^BAE경_피드백_\d{8}_\d{4}\.zip$/); return opts.pick === undefined ? 'C:\\out\\피드백.zip' : opts.pick; },
    appVersion: '1.151.0',
    fetch: async (url: string) => { fetched.push(url); return new Response(new Uint8Array([0xff, 0xd8, 0xff, fetched.length]), { status: 200 }); },
    openZip: async (target: string) => {
      const s = { chunks: [] as Uint8Array[], committed: false, aborted: false, target }; sinks.push(s);
      return { write: async (c: Uint8Array) => { if (opts.failWrite) throw new Error('디스크가 가득 찼어요'); s.chunks.push(c); }, commit: async () => { s.committed = true; }, abort: async () => { s.aborted = true; } };
    },
    now: () => new Date(2026, 10, 18, 14, 5),
  };
  return {
    deps, handlers, jobGets, fetched, reads, sinks, setOrigin: (o: typeof origin) => { origin = o; },
    invoke: (req: unknown, epoch: number) => handlers.get('bae:feedback-export')!({ sender: null }, req, epoch),
  };
}
const concat = (cs: Uint8Array[]) => { const out = new Uint8Array(cs.reduce((n, c) => n + c.byteLength, 0)); let at = 0; for (const c of cs) { out.set(c, at); at += c.byteLength; } return out; };

test('main: reads my records again with my session, pictures from this PC then the server preview, writes one zip through the save dialog', async () => {
  const { registerBaeFeedbackExportIpc, BAE_FEEDBACK_CHANNEL } = await loadMain();
  const h = mainHarness(); registerBaeFeedbackExportIpc(h.deps);
  assert.deepEqual([...h.handlers.keys()], ['bae:feedback-export']); assert.equal(BAE_FEEDBACK_CHANNEL, 'bae:feedback-export');
  const r = await h.invoke({ mode: 'fresh', ids: [id(2), id(1), id(3), id(4), id(5), id(6), id(8)] }, 7) as Record<string, unknown>;
  assert.equal(r.status, 'saved'); assert.equal(r.path, 'C:\\out\\피드백.zip');
  assert.equal(r.count, 3, '1 · 2 · 8 (others: someone else\'s, hidden, unreadable, a tool job)'); assert.equal(r.skipped, 4);
  assert.ok(h.jobGets.every((x) => x.startsWith('u1:')), 'read with the signed-in session');
  assert.deepEqual(h.fetched, [PUB(`bae/${id(2)}/result_1600.jpg?v=1`), PUB(`bae/${id(8)}/result_1600.jpg`)], 'only the set preview places, never another address');
  assert.ok(!h.reads.some((x) => x.startsWith('08/')), 'a folder that job.json says is someone else\'s is not read');
  assert.equal(r.images, 5); assert.equal(r.previews, 2); assert.equal(r.missing, 1, 'the rough of record 2 (a strange address)');
  assert.match(String(r.message), /^검수한 그림과 최근 그림 3장을 묶었어요\. .*1장/);
  const s = h.sinks[0]; assert.equal(s.committed, true); assert.equal(s.aborted, false);
  const zip = readZip(concat(s.chunks));
  assert.equal(r.bytes, concat(s.chunks).byteLength);
  assert.deepEqual(zip.map((f) => f.name), ['feedback.json', 'feedback.md',
    'images/r01_11111111_result.png', 'images/r01_11111111_rough.jpg', 'images/r01_11111111_result_before_lock.png',
    'images/r02_11111111_result_preview.jpg', 'images/r03_11111111_result_preview.jpg']);
  assert.deepEqual([...zip[2].data], [...png(1)]); assert.deepEqual([...zip[4].data], [...png(3)], 'the other color-lock version is alt.png');
  const json = JSON.parse(text(zip[0].data));
  assert.equal(json.app, 'BAE경 (B flow 1.151.0)'); assert.equal(json.mode, 'fresh'); assert.equal(json.count, 3); assert.equal(json.skipped, 4);
  assert.deepEqual(json.items.map((x: { jobId: string }) => x.jobId), [id(1), id(2), id(8)]);
  assert.equal(json.items[0].prompt, 'P1', 'the server row first'); assert.equal(json.items[0].reviewed, true);
  assert.equal(json.items[1].reviewed, true, 'a 좋아요 stamp'); assert.deepEqual(json.items[1].missing, ['러프']);
  assert.equal(json.items[2].reviewed, false);
  const md = text(zip[1].data);
  assert.ok(md.startsWith('# BAE경 피드백 (11월 18일 14:05, 3장, 검수한 그림 + 검수 안 한 최근 그림)'));
  assert.ok(md.includes('- 이 PC 에 원본이 없어서 서버의 작은 미리보기로 넣은 그림: images/r02_11111111_result_preview.jpg'));
  assert.ok(md.includes('- 넣지 못한 그림: 러프'));
});

test('main: the save dialog can be closed, and the session · right · request are checked first', async () => {
  const { registerBaeFeedbackExportIpc } = await loadMain();
  const c = mainHarness({ pick: null }); registerBaeFeedbackExportIpc(c.deps);
  const r = await c.invoke({ mode: 'reviewed', ids: [id(1)] }, 7) as Record<string, unknown>;
  assert.equal(r.status, 'canceled'); assert.equal(c.jobGets.length, 0, 'nothing read'); assert.equal(c.sinks.length, 0, 'nothing written');
  const h = mainHarness(); registerBaeFeedbackExportIpc(h.deps);
  await assert.rejects(h.invoke({ mode: 'reviewed', ids: [id(1)] }, 6), /세션/);
  await assert.rejects(h.invoke({ mode: 'reviewed', ids: ['nope'] }, 7), /작업 번호/);
  await assert.rejects(h.invoke({ mode: 'reviewed', ids: [id(1)], path: 'C:\\x' }, 7), /다시 골라/);
  const out = mainHarness({ canUse: false }); registerBaeFeedbackExportIpc(out.deps);
  await assert.rejects(out.invoke({ mode: 'reviewed', ids: [id(1)] }, 7), /권한/);
  // 저장 창이 떠 있는 동안 다른 계정으로 바뀌면 그만둔다
  const sw = mainHarness(); registerBaeFeedbackExportIpc(sw.deps);
  sw.deps.pickZipPath = async () => { sw.setOrigin({ userId: 'u2', epoch: 8 }); return 'C:\\out\\x.zip'; };
  await assert.rejects(sw.invoke({ mode: 'reviewed', ids: [id(1)] }, 7), /세션/);
  assert.equal(sw.jobGets.length, 0);
  // 넣을 것이 하나도 없으면 파일을 만들지 않는다
  const none = mainHarness(); registerBaeFeedbackExportIpc(none.deps);
  const e = await none.invoke({ mode: 'all', ids: [id(3), id(4)] }, 7) as Record<string, unknown>;
  assert.equal(e.status, 'empty'); assert.equal(none.sinks.length, 0);
});

test('main: a failed write leaves no half file and says so in plain words', async () => {
  const { registerBaeFeedbackExportIpc } = await loadMain();
  const h = mainHarness({ failWrite: true }); registerBaeFeedbackExportIpc(h.deps);
  await assert.rejects(h.invoke({ mode: 'reviewed', ids: [id(1)] }, 7), /^Error: 묶지 못했어요: 디스크가 가득 찼어요/);
  assert.equal(h.sinks[0].aborted, true); assert.equal(h.sinks[0].committed, false);
});

test('main: the real file sink writes next to the target and renames at the end', async () => {
  const { openZipFile } = await loadMain();
  const { mkdtemp, readFile, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'bae-feedback-'));
  const target = join(dir, 'BAE경_피드백.zip');
  const ok = await openZipFile(target);
  await ok.write(new Uint8Array([1, 2])); await ok.write(new Uint8Array([3])); await ok.commit();
  assert.deepEqual([...(await readFile(target))], [1, 2, 3]);
  const bad = await openZipFile(join(dir, 'half.zip'));
  await bad.write(new Uint8Array([9])); await bad.abort();
  assert.deepEqual((await readdir(dir)).sort(), ['BAE경_피드백.zip'], 'no .part file and no half zip left');
});

test('wiring: preload opens the channel with the session epoch, baeMain registers it with a zip save dialog, the button sits only in my records of the 기록 tab', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const bae = preload.slice(preload.indexOf("exposeInMainWorld('baeGyeongAPI'")); const api = bae.slice(0, bae.indexOf('});') + 3);
  assert.match(api, /feedbackExport: \(request: unknown\) => ipcRenderer\.invoke\('bae:feedback-export', request, canonicalSessionEpoch\)/);
  const main = readFileSync('electron/bae/baeMain.ts', 'utf8');
  assert.match(main, /registerBaeFeedbackExportIpc\(\{[\s\S]{0,1200}extensions: \['zip'\][\s\S]{0,200}showSaveDialog/);
  const types = readFileSync('src/features/bae-gyeong/types.ts', 'utf8');
  assert.match(types, /feedbackExport\(request: BaeFeedbackRequest\): Promise<BaeFeedbackResult>;/);
  const list = readFileSync('src/features/bae-gyeong/records/RecordList.tsx', 'utf8');
  assert.match(list, /\{!team && !p\.onAll \? <FeedbackExportButton \/> : null\}/);
  const button = readFileSync('src/features/bae-gyeong/records/FeedbackExport.tsx', 'utf8');
  assert.doesNotMatch(button, /supabase|ipcRenderer/i, 'the screen goes through the gateway only');
});

// ── 테스트 모드 (?preview=1) ──
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}
const dataJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`;

test('preview: the same rules as main — only my finished, visible drawings; pictures from the made ones or the preview addresses', async () => {
  const storage = memoryStorage();
  const me = { id: 'u1', name: '배한솔', role: 'admin' };
  storage.setItem('bflow:preview:bae-jobs', JSON.stringify([
    job(1, { selfReview: reviewed, images: { result: dataJpeg, rough: dataJpeg, refs: ['https://elsewhere.example/ref.jpg'] }, pd: { prompt: 'P' } }),
    job(2, { images: { result: dataJpeg } }),
    job(3, { userId: 'u2', images: { result: dataJpeg } }),
    job(4, { hidden: true }),
  ]));
  const made = new Map([[`${id(2)}/result.png`, png(2)]]);
  const gw = createBaePreviewGateway({
    storage, identity: () => me, knownUserIds: () => ['u1', 'u2'], now: () => '2026-11-18T05:05:00.000Z',
    make: () => ({ localFile: async (jobId: string, name: string) => made.get(`${jobId}/${name}`) ?? null }) as never,
  });
  const r = await gw.feedbackExport({ mode: 'fresh', ids: [id(1), id(2), id(3), id(4)] });
  assert.equal(r.status, 'saved'); assert.equal(r.count, 2); assert.equal(r.skipped, 2);
  assert.equal(r.images, 3, 'record 1: result + rough from the preview addresses; record 2: the made result');
  assert.equal(r.previews, 2); assert.equal(r.missing, 1, 'a reference at an address the preview does not fetch');
  assert.equal(r.path, null, 'no screen in node: nothing downloaded');
  assert.match(r.message, /^검수한 그림과 최근 그림 2장을 묶었어요.*테스트 모드/);
  assert.ok(r.bytes > 0);
  assert.equal((await gw.feedbackExport({ mode: 'all', ids: [id(3)] })).status, 'empty');
  await assert.rejects(gw.feedbackExport({ mode: 'all', ids: ['x'] } as never), /작업 번호/);
  const out = createBaePreviewGateway({ storage, identity: () => ({ id: 'u9', name: '바깥', role: 'user' }), knownUserIds: () => ['u9'] });
  await assert.rejects(out.feedbackExport({ mode: 'all', ids: [id(1)] }), /권한/);
});
