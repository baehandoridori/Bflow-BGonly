import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

import {
  baeCommentBodyProblem, baeCommentDraftProblem, baeCommentEmojiProblem, baeCommentPlaceLabel, baeMentionedPeople, buildBaeCommentKey,
  isBaeCommentId, looksLikeBaeCommentId, newBaeCommentId, parseBaeCommentAdd, parseBaeCommentKey, parseBaeCommentReactionMap, parseBaeCommentThread,
} from '../src/shared/bae/comments.ts';
import { buildBaeJobDeepLink, parseBflowDeepLink } from '../src/shared/bflowDeepLink.ts';
import { buildSceneImageStoragePath } from '../src/shared/sceneImageStoragePath.ts';
import { parseCommentNotificationRow } from '../src/shared/commentNotification.ts';
import { commentNotificationRecipients, type RecipientWorld } from '../src/shared/commentNotificationRecipients.ts';
import {
  decideSceneCommentNotification, decideSceneCommentNotificationFromServer, normalizeSceneCommentFromServerRow, type SceneCommentNotificationDeps,
} from '../src/utils/sceneCommentNotification.ts';
import { getNotificationIdentity } from '../src/utils/notificationIdentity.ts';
import { buildMentionWebhookPayloads } from '../src/utils/mentionWebhookPayloads.ts';
import { baePreviewCommentReadable, createBaePreviewComments, BAE_PREVIEW_JOBS_KEY, BAE_PREVIEW_MEMBERS_KEY } from '../src/features/bae-gyeong/comments/previewBaeComments.ts';
import { createBaePreviewGateway } from '../src/features/bae-gyeong/previewGateway.ts';
import { baePreviewSeed } from '../src/features/bae-gyeong/previewSeed.ts';

// BAE경 9단계 코멘트 — 화면 · 메인 · 테스트 모드가 같이 쓰는 규칙(서버 짝은 tests/baeGyeongCommentsDatabase.test.ts).
const JOB = '5b0c4f1e-0000-4000-8000-0000000a0001';
const OTHER_JOB = '5b0c4f1e-0000-4000-8000-0000000b0001';
const CID = 'baec_5b0c4f1e-0000-4000-8000-0000000c0001';

test('keys, ids and parsers: bae:{job} threads, baec_ ids, malformed rows dropped', () => {
  assert.equal(buildBaeCommentKey(JOB), `bae:${JOB}`);
  assert.equal(parseBaeCommentKey(`bae:${JOB}`), JOB);
  assert.equal(parseBaeCommentKey('bae:nope'), null);
  assert.equal(parseBaeCommentKey(`char:${JOB}`), null);
  assert.equal(parseBaeCommentKey('EP01_A_BG:3'), null);
  assert.equal(newBaeCommentId('5B0C4F1E-0000-4000-8000-0000000C0001'), CID);
  assert.throws(() => newBaeCommentId('x'));
  assert.ok(isBaeCommentId(CID));
  assert.ok(!isBaeCommentId('c1') && !isBaeCommentId(`baec_${JOB}x`));
  assert.ok(looksLikeBaeCommentId(CID) && !looksLikeBaeCommentId('5b0c4f1e-0000-4000-8000-0000000c0001'));
  const thread = parseBaeCommentThread({
    comments: [
      { id: CID, baeJobId: JOB, userId: 'u1', userName: '장삐쭈', text: '창문', mentions: ['안류천', 3], images: ['https://x/y.jpg'], parentCommentId: null, createdAt: '2026-11-16T01:00:00Z', editedAt: null },
      { id: 'scene-comment', baeJobId: JOB, userId: 'u1', createdAt: '2026-11-16T01:00:00Z' },
      { id: CID, baeJobId: 'nope', userId: 'u1', createdAt: '2026-11-16T01:00:00Z' },
    ],
    audience: [{ id: 'u1', name: '장삐쭈' }, { id: 7 }],
    canModerate: true,
  });
  assert.equal(thread.comments.length, 1);
  assert.deepEqual(thread.comments[0]!.mentions, ['안류천']);
  assert.deepEqual(thread.audience, [{ id: 'u1', name: '장삐쭈' }]);
  assert.equal(thread.canModerate, true);
  assert.throws(() => parseBaeCommentThread({}), /응답/);
  assert.throws(() => parseBaeCommentAdd({ comment: { id: 'x' } }), /응답/);
  assert.deepEqual(Object.keys(parseBaeCommentReactionMap({ [CID]: [{ id: 'r', commentId: CID, userId: 'u', emoji: '👍' }], 'scene-1': [] })), [CID]);
});

test('drafts: shape checks before the server (which checks again)', () => {
  const ok = { id: CID, text: '좋아요', mentions: ['안류천'], images: [], parentCommentId: null };
  assert.equal(baeCommentDraftProblem(ok), null);
  assert.match(baeCommentDraftProblem({ ...ok, id: 'c1' })!, /번호/);
  assert.match(baeCommentDraftProblem({ ...ok, text: '   ' })!, /내용/);
  assert.equal(baeCommentDraftProblem({ ...ok, text: '', images: ['https://p/storage/v1/object/public/scene-images/bae/x/comments/a.jpg'] }), null);
  assert.match(baeCommentDraftProblem({ ...ok, images: ['javascript:alert(1)'] })!, /그림/);
  assert.match(baeCommentDraftProblem({ ...ok, parentCommentId: 'scene-1' })!, /답글/);
  assert.match(baeCommentDraftProblem({ ...ok, text: 'x'.repeat(5001) })!, /5000/);
  assert.equal(baeCommentBodyProblem('', [], null), null, 'an edit that keeps the pictures may empty the words; the server decides');
  assert.equal(baeCommentEmojiProblem('👍'), null);
  assert.ok(baeCommentEmojiProblem('a b') && baeCommentEmojiProblem(''));
  assert.deepEqual(baeMentionedPeople(['안류천', '바깥', '장삐쭈'], [{ id: 'u1', name: '장삐쭈' }, { id: 'u2', name: '안류천' }], 'u1'), ['u2']);
  assert.equal(baeCommentPlaceLabel('  골목   밤 '), 'BAE경 · 골목 밤');
  assert.equal(baeCommentPlaceLabel(null), 'BAE경 기록');
});

test('deep link bflow://bae/{job}?comment={id}, and the comment picture path stays inside bae/{job}/comments/', () => {
  assert.deepEqual(parseBflowDeepLink(buildBaeJobDeepLink(JOB, CID)), { baeJobId: JOB, commentId: CID });
  assert.deepEqual(parseBflowDeepLink(buildBaeJobDeepLink(JOB)), { baeJobId: JOB });
  assert.deepEqual(parseBflowDeepLink(`bflow://bae/${JOB}?comment=%3Cx%3E`), { baeJobId: JOB });
  for (const bad of ['bflow://bae/', 'bflow://bae/nope', `bflow://bae/${JOB}/x`, 'bflow://bae/..%2F..']) assert.equal(parseBflowDeepLink(bad), null, bad);
  assert.equal(buildSceneImageStoragePath('bae', JOB, 'comment', 'jpg', '1731700000000_ab12cd34'), `bae/${JOB}/comments/comment_1731700000000_ab12cd34.jpg`);
  assert.throws(() => buildSceneImageStoragePath('bae', '../x', 'comment', 'jpg', '1_a'));
  assert.equal(buildSceneImageStoragePath('char', 'c1', 'comment', 'png', '1_a'), 'characters/c1/comments/comment_1_a.png', 'character path unchanged');
  assert.equal(buildSceneImageStoragePath('EP01_A_BG', '3', 'comment', 'jpg', '1_a'), 'EP01/A/BG/3/comment_1_a.jpg', 'scene path unchanged');
});

test('Slack: a BAE comment fills the place and the deep link itself; scene payloads are unchanged', () => {
  const me = { id: 'u1', name: '장삐쭈', slackId: 'S1' };
  const target = { id: 'u2', name: '안류천', slackId: 'S2' };
  const bae = buildMentionWebhookPayloads({ comment: { text: '창문 확인' }, sheetName: '', sceneNo: '', me, targets: [target], plainText: (t) => t, now: 0,
    place: { EP: 'BAE경', part: '', scene: 'BAE경 · 골목', deepLink: buildBaeJobDeepLink(JOB, CID) } });
  assert.equal(bae.payloads[0]!.payload.EP, 'BAE경');
  assert.equal(bae.payloads[0]!.payload.scene, 'BAE경 · 골목');
  assert.equal(bae.payloads[0]!.payload.deep_link, `bflow://bae/${JOB}?comment=${CID}`);
  const scene = buildMentionWebhookPayloads({ comment: { text: 'x' }, sheetName: 'EP05_A_BG', sceneNo: '3', sceneLabel: 'a003', me, targets: [target], plainText: (t) => t, now: 0 });
  assert.equal(scene.payloads[0]!.payload.deep_link, 'bflow://scene/EP05_A_BG/3');
  assert.equal(scene.payloads[0]!.payload.EP, 'EP05');
});

// ── 종 알림: 서버 줄 → 화면 알림 ─────────────────────────────────────────────
const deps: SceneCommentNotificationDeps = {
  findScene: () => null, sceneLabel: () => '', isCommentByUser: () => false, hasUserCommentedOnScene: () => false,
  counterpartAssigneeNames: () => [], getRevision: () => null, userIdByName: () => null, plainText: (t) => t,
  sceneThreadKey: () => null, threadPreference: () => 'mute',
};
const serverRow = (reason: string, detail: string | null, kind = 'add') => parseCommentNotificationRow({
  id: '00000000-0000-4000-8000-000000000001', commentId: CID, kind, reason, detail, eventAt: '2026-11-16T01:00:00Z', editAt: kind === 'edit' ? '2026-11-16T01:05:00Z' : null,
  readAt: null, revisionNo: null,
  comment: { partId: null, sceneId: null, sceneUuid: null, userId: 'u2', userName: '안류천', text: '창문을 크게', mentions: [], imageCount: 0,
    parentCommentId: null, revisionId: null, characterId: null, baeJobId: JOB, createdAt: '2026-11-16T01:00:00Z', editedAt: null },
})!;
const ME = { id: 'u1', name: '장삐쭈' };
const decide = (row: ReturnType<typeof serverRow>, autoNotify = true) =>
  decideSceneCommentNotificationFromServer(normalizeSceneCommentFromServerRow(row), { reason: row.reason, detail: row.detail, revisionNo: row.revisionNo }, ME, deps, { autoNotify, retakeNotify: true });

test('the bell: a BAE row opens the record, the maker is told loudly, participants quietly (and only with 내 씬 자동 알림 on)', () => {
  assert.equal(serverRow('auto', 'assignee').comment.baeJobId, JOB);
  const maker = decide(serverRow('auto', 'assignee'))!;
  assert.equal(maker.type, 'mention');
  assert.equal(maker.quiet, false);
  assert.equal(maker.native, true);
  assert.equal(maker.title, '안류천님이 내 BAE경 기록에 코멘트를 남겼습니다');
  assert.equal(maker.metadata.baeJobId, JOB);
  assert.equal(maker.metadata.commentId, CID);
  assert.equal(maker.metadata.sceneThreadKey, undefined, 'no scene thread key — mute/follow do not apply');
  assert.equal(getNotificationIdentity({ type: maker.type, metadata: maker.metadata }), `scene_comment:${CID}`);
  assert.equal(decide(serverRow('mention', null))!.title, '안류천님이 BAE경 기록에서 나를 태그했습니다');
  assert.equal(decide(serverRow('reply', null))!.title, '안류천님이 BAE경 기록에서 내 코멘트에 답글을 남겼습니다');
  const participant = decide(serverRow('auto', 'participant'))!;
  assert.equal(participant.type, 'comment');
  assert.equal(participant.quiet, true);
  assert.equal(decide(serverRow('auto', 'participant'), false), null);
  const edit = decide(serverRow('mention', null, 'edit'))!;
  assert.equal(getNotificationIdentity({ type: edit.type, metadata: edit.metadata }), `scene_comment:${CID}:edit:2026-11-16T01:05:00.000Z`);
  // a realtime row (it never arrives — the table hides it) is never decided on the PC
  assert.equal(decideSceneCommentNotification({ commentId: CID, partId: null, sceneNo: null, userId: 'u2', userName: '안류천', text: '@장삐쭈', mentions: ['장삐쭈'],
    parentCommentId: null, revisionId: null, characterId: null, baeJobId: JOB, kind: 'add' }, ME, deps, { autoNotify: true, retakeNotify: true }), null);
});

// ── 메인 통로 (electron/bae/baeComments.ts) ─────────────────────────────────
let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['@supabase/supabase-js'] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

test('main: every call carries the session token, never a user id from the screen; a missing server answers "not ready"', async () => {
  const mod = await load('electron/bae/baeComments.ts');
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    if (name === 'bae_gyeong_session_comment_reactions') return { data: null, error: { code: 'PGRST202', message: 'no function' } };
    return { data: { comments: [], audience: [], canModerate: false }, error: null };
  } };
  const store = mod.createBaeCommentsStore(client, { tokenFor: (actor: string) => `token-of-${actor}` });
  await store.list('u1', JOB);
  assert.deepEqual(calls[0], ['bae_gyeong_session_comment_list', { p_session_token: 'token-of-u1', p_job_id: JOB }]);
  await assert.rejects(store.reactions('u1', [CID]), /서버 준비/);
  const noToken = mod.createBaeCommentsStore(client, { tokenFor: () => '' });
  await assert.rejects(noToken.list('u1', JOB), /로그인 세션/);
});

test('main IPC: the request epoch must match, shapes are checked, changes are signalled, deleted pictures are cleaned', async () => {
  const mod = await load('electron/bae/baeComments.ts');
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  let origin = { userId: 'u1', epoch: 3 };
  const seen: unknown[][] = []; let changed = 0; const cleaned: string[] = [];
  const row = { id: CID, baeJobId: JOB, userId: 'u1', userName: '장삐쭈', text: 'x', mentions: [], images: [], parentCommentId: null, createdAt: '2026-11-16T01:00:00Z', editedAt: null };
  const store = {
    list: async (...a: unknown[]) => { seen.push(['list', ...a]); return { comments: [], audience: [], canModerate: false }; },
    add: async (...a: unknown[]) => { seen.push(['add', ...a]); return { comment: row, mentioned: [], duplicate: false }; },
    edit: async (...a: unknown[]) => { seen.push(['edit', ...a]); return { comment: row, addedMentioned: [] }; },
    remove: async (...a: unknown[]) => { seen.push(['remove', ...a]); return { deleted: true, images: ['https://p/storage/v1/object/public/scene-images/bae/j/comments/a.jpg'] }; },
    react: async (...a: unknown[]) => { seen.push(['react', ...a]); return []; },
    reactions: async (...a: unknown[]) => { seen.push(['reactions', ...a]); return {}; },
  };
  mod.registerBaeCommentsIpc({
    ipc: { handle: (channel: string, fn: (...a: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) },
    getSessionOriginOrThrow: () => origin, store, onChanged: () => { changed += 1; }, deleteImage: async (url: string) => { cleaned.push(url); },
  });
  assert.deepEqual([...handlers.keys()].sort(), ['bae-comments:add', 'bae-comments:delete', 'bae-comments:edit', 'bae-comments:list', 'bae-comments:react', 'bae-comments:reactions']);
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  await call('bae-comments:list', JOB, 3);
  assert.deepEqual(seen.at(-1), ['list', 'u1', JOB]);
  await assert.rejects(call('bae-comments:list', JOB, 2), /세션이 바뀌었어요/);
  await assert.rejects(call('bae-comments:list', 'nope', 3), /작업 번호/);
  await assert.rejects(call('bae-comments:add', JOB, { id: 'c1', text: 'x', mentions: [] }, 3), /번호/);
  await call('bae-comments:add', JOB, { id: CID, text: 'x', mentions: ['안류천'], images: [], parentCommentId: null, userId: 'spoofed' }, 3);
  assert.deepEqual(seen.at(-1), ['add', 'u1', JOB, { id: CID, text: 'x', mentions: ['안류천'], images: [], parentCommentId: null }], 'the screen cannot pass a user id');
  assert.equal(changed, 1);
  await call('bae-comments:edit', CID, 'y', [], null, 3);
  assert.deepEqual(seen.at(-1), ['edit', 'u1', CID, 'y', [], null]);
  await call('bae-comments:delete', CID, 3);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(cleaned, ['https://p/storage/v1/object/public/scene-images/bae/j/comments/a.jpg']);
  await assert.rejects(call('bae-comments:react', CID, 'a b', true, 3), /반응/);
  await assert.rejects(call('bae-comments:reactions', ['scene-1'], 3), /번호/);
  assert.deepEqual(await call('bae-comments:reactions', [], 3), {});
  // a session that changes while the server answers: the answer is dropped
  store.list = async () => { origin = { userId: 'u2', epoch: 4 }; return { comments: [], audience: [], canModerate: false }; };
  await assert.rejects(call('bae-comments:list', JOB, 3), /버렸어요/);
});

// ── 테스트 모드 저장소: 서버와 같은 규칙 ─────────────────────────────────────
function memoryStorage(seed: Record<string, unknown> = {}) {
  const map = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}
const people = [
  { id: '1', name: '배한솔', role: 'admin' }, { id: '2', name: '장삐쭈', role: 'user' }, { id: '4', name: '안류천', role: 'user' },
  { id: '3', name: '허혜원', role: 'user' }, { id: '9', name: '바깥', role: 'user' },
];

test('test mode: maker and reviewers only, mentions kept to readers, the bell rows follow the TypeScript twin', async () => {
  const storage = memoryStorage({
    [BAE_PREVIEW_JOBS_KEY]: [{ id: JOB, userId: '2' }, { id: OTHER_JOB, userId: '3' }],
    [BAE_PREVIEW_MEMBERS_KEY]: [{ userId: '4', role: 'reviewer' }, { userId: '3', role: 'user' }],
  });
  let me = people[2]!; // 안류천 (reviewer)
  const fanned: Array<{ id: string; recipients: string[] }> = [];
  let ids = 0; let clock = Date.parse('2026-11-16T01:00:00Z');
  const store = createBaePreviewComments({
    storage, identity: () => me, users: () => people,
    notifier: {
      fanoutAdd: async (world: RecipientWorld, commentId: string) => { fanned.push({ id: commentId, recipients: commentNotificationRecipients(world, commentId).map((r) => `${r.recipientId}:${r.reason}`) }); return 1; },
      fanoutEdit: async () => 0, removeComment: async () => {},
    },
    now: () => new Date(clock += 1000).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  });
  const first = await store.add(JOB, { id: CID, text: '@장삐쭈 @허혜원 창문', mentions: ['장삐쭈', '허혜원'], images: [], parentCommentId: null });
  assert.deepEqual(first.comment.mentions, ['장삐쭈'], '허혜원 cannot read this thread');
  assert.deepEqual(first.mentioned, ['2']);
  assert.deepEqual(fanned.at(-1), { id: CID, recipients: ['2:mention'] });
  assert.deepEqual((await store.add(JOB, { id: CID, text: '@장삐쭈 @허혜원 창문', mentions: [], images: [], parentCommentId: null })).duplicate, true);
  me = people[3]!; // 허혜원: another member
  await assert.rejects(store.list(JOB), /만든 사람과 검수자만/);
  await assert.rejects(store.add(JOB, { id: 'baec_00000000-0000-4000-8000-0000000000aa', text: 'x', mentions: [], images: [], parentCommentId: null }), /만든 사람과 검수자만/);
  await assert.rejects(store.add(JOB, { id: CID, text: 'x', mentions: [], images: [], parentCommentId: null }), /만든 사람과 검수자만/);
  me = people[1]!; // 장삐쭈: maker
  const reply = await store.add(JOB, { id: 'baec_00000000-0000-4000-8000-0000000000bb', text: '네', mentions: [], images: [], parentCommentId: CID });
  assert.deepEqual(fanned.at(-1), { id: reply.comment.id, recipients: ['4:reply'] });
  await assert.rejects(store.edit(CID, '남의 글', [], null), /내가 쓴 댓글만/);
  await assert.rejects(store.remove(CID), /내가 쓴 댓글만/);
  const reacted = await store.react(CID, '👍', true);
  assert.deepEqual(reacted.map((r) => `${r.userId}:${r.emoji}`), ['2:👍']);
  assert.deepEqual(Object.keys(await store.reactions([CID, 'scene-1'])), [CID]);
  const thread = await store.list(JOB);
  assert.deepEqual(thread.comments.map((c) => c.id), [CID, reply.comment.id]);
  assert.deepEqual(thread.audience.map((p) => p.id).sort(), ['1', '2', '4']);
  assert.equal(thread.canModerate, false);
  assert.ok(baePreviewCommentReadable(storage, people, CID, '2') && baePreviewCommentReadable(storage, people, CID, '1'));
  assert.ok(!baePreviewCommentReadable(storage, people, CID, '3') && !baePreviewCommentReadable(storage, people, 'scene-1', '2'));
  // a stamp leaves one line by the stamper (좋아요 · 다시), 확인함 stays quiet
  await store.recordStamp(JOB, 'seen', null, '4');
  await store.recordStamp(JOB, 'again', ' 창문 크게 ', '4');
  const lines = (await store.list(JOB)).comments;
  assert.equal(lines.length, 3);
  assert.equal(lines.at(-1)!.text, '다시 도장을 찍었어요.\n창문 크게');
  assert.deepEqual(fanned.at(-1)!.recipients, ['2:auto'], 'the maker hears of the stamp');
  me = people[0]!; // admin removes another's comment
  assert.equal((await store.remove(reply.comment.id)).deleted, true);
  assert.equal((await store.remove(reply.comment.id)).deleted, false);
});

test('wiring: scene paths keep their routes; BAE threads take the session wrappers and hide the shared to-do and follow tables', () => {
  const panel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8').replace(/\r\n/g, '\n');
  const service = readFileSync('src/services/commentService.ts', 'utf8').replace(/\r\n/g, '\n');
  assert.match(panel, /const effectiveSceneThreadKey = characterCommentKey \?\? \(baeCommentKey \? '' : \(sceneThreadKey \?\? sceneKey\)\);/);
  assert.match(panel, /const followSceneKey = !characterCommentKey && effectiveSceneThreadKey \? effectiveSceneThreadKey : null;/);
  assert.match(panel, /id: baeJobId \? newBaeCommentId\(createUuid\(\)\) : createUuid\(\),/);
  assert.match(panel, /if \(baeJobId\) return;\n\s+let timer: ReturnType<typeof setTimeout> \| null = null;\n\s+let onlyPatched = true;/, 'the scene invalidation listener ignores BAE threads');
  for (const fn of ['export async function addComment(', 'export async function updateComment(', 'export async function deleteComment(']) {
    const start = service.indexOf(fn);
    const body = service.slice(start, service.indexOf('\n}\n', start));
    assert.ok(body.indexOf('parseBaeCommentKey(sceneKey)') > 0 && body.indexOf('parseBaeCommentKey(sceneKey)') < body.indexOf('parseCharacterCommentKey(sceneKey)'), `${fn} routes BAE first`);
  }
  assert.match(service, /if \(looksLikeBaeCommentId\(commentId\)\) \{\n\s+await requireBaeCommentsGateway\(\)\.react\(commentId, emoji, true\);/);
  // BAE comments never go to the generic table paths or the comment broadcast
  const bae = service.slice(service.indexOf('// ─── BAE경 기록 코멘트'), service.indexOf('export async function getCommentStoreForPart'));
  assert.doesNotMatch(bae, /supabaseAddComment|supabaseReadComments|bflow:comments-invalidated/);
});

// ── 2단계(phase B) 연결: preload ↔ 메인 · 한 건 보기의 칸 · 알림에서 그 기록 열기 · 도장 ─────────────────
const text = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('phase B: preload opens exactly the comment channels main handles, each with the session epoch (args in main\'s order)', async () => {
  const mod = await load('electron/bae/baeComments.ts');
  const handlers = new Map<string, unknown>();
  mod.registerBaeCommentsIpc({ ipc: { handle: (c: string, h: unknown) => handlers.set(c, h) }, getSessionOriginOrThrow: () => ({ userId: 'u', epoch: 1 }), store: {}, onChanged: () => {} });
  const preload = text('electron/preload.ts');
  const from = preload.slice(preload.indexOf("exposeInMainWorld('baeCommentsAPI'"));
  assert.ok(from.length > 0 && preload.includes("exposeInMainWorld('baeCommentsAPI'"));
  const api = from.slice(0, from.indexOf('});') + 3);
  const expected = [['list', 'list', 'jobId'], ['add', 'add', 'jobId, draft'], ['edit', 'edit', 'commentId, text, mentions, images'],
    ['remove', 'delete', 'commentId'], ['react', 'react', 'commentId, emoji, on'], ['reactions', 'reactions', 'commentIds']] as const;
  for (const [name, ch, args] of expected) {
    assert.match(api, new RegExp(`${name}: \\([^)]*\\) => ipcRenderer\\.invoke\\('bae-comments:${ch}', ${args}, canonicalSessionEpoch\\)`), name);
  }
  assert.equal((api.match(/ipcRenderer\.invoke\('bae-comments:/g) ?? []).length, expected.length, 'no channel only in preload');
  assert.deepEqual([...handlers.keys()].sort(), expected.map(([, ch]) => `bae-comments:${ch}`).sort(), 'no channel only in main');
  assert.match(api, /onChanged: \(callback: \(\) => void\) => \{\n\s+const listener = \(\) => callback\(\);\n\s+ipcRenderer\.on\('bae-comments:changed', listener\);\n\s+return \(\) => ipcRenderer\.removeListener\('bae-comments:changed', listener\);/);
  assert.doesNotMatch(api, /token|getKey|userId/i, 'the screen sends no identity and gets no token');
  // the screen's gateway type and preload expose the same methods
  const types = text('src/features/bae-gyeong/comments/baeCommentsTypes.ts');
  assert.deepEqual([...api.matchAll(/^  ([a-zA-Z]+): \(/gm)].map((m) => m[1]).sort(), [...types.matchAll(/^  ([a-zA-Z]+)\(/gm)].map((m) => m[1]).sort());
  // main wires the store, the change signal to every window, and the server signal (one per app)
  const main = text('electron/main.ts');
  assert.match(main, /registerBaeCommentsIpc\(\{\n\s+ipc: ipcMain,\n\s+store: baeComments,\n\s+getSessionOriginOrThrow,\n\s+onChanged: \(\) => broadcastToAllWindows\('bae-comments:changed', \{\}\),/);
  assert.match(main, /baeCommentsRealtimeCleanup = startBaeCommentsRealtime\(supabaseClient, \(\) => broadcastToAllWindows\('bae-comments:changed', \{\}\)\);/);
  assert.match(main, /baeCommentsRealtimeCleanup\?\.\(\);\n\s+baeCommentsRealtimeCleanup = null;/, 'unsubscribed on quit');
});

test('phase B: the one-job view draws the comment thread in one place, only for jobs the server has', () => {
  const view = text('src/features/bae-gyeong/records/JobView.tsx');
  // 한 건 보기는 오른쪽 접는 칸(BaeJobCommentsDock)을 한 번 붙이고, 그 칸이 댓글 패널을 한 번 그린다.
  assert.match(view, /import \{ BaeJobCommentsDock \} from '\.\.\/comments\/BaeJobCommentsDock';/);
  assert.doesNotMatch(view, /<BaeJobComments /, 'the thread is no longer drawn under the left column');
  assert.equal((view.match(/<BaeJobCommentsDock /g) ?? []).length, 1);
  assert.match(view, /\{p\.comments && isBaeCommentJobId\(p\.comments\.jobId\) \? \(\n\s+<BaeJobCommentsDock key=\{p\.comments\.jobId\} anchor=\{viewEl\} jobId=\{p\.comments\.jobId\} jobName=\{p\.comments\.jobName\} focusCommentId=\{p\.comments\.focusCommentId \?\? null\} \/>\n\s+\) : null\}/);
  assert.ok(view.indexOf('className="bae-view-side"') < view.indexOf('<BaeJobCommentsDock '), 'after both columns — it floats over the right edge, not inside a column');
  const dock = text('src/features/bae-gyeong/comments/BaeJobCommentsDock.tsx');
  assert.equal((dock.match(/<BaeJobComments\n/g) ?? []).length, 1);
  assert.match(dock, /focusCommentId=\{focusCommentId\}\n\s+heightClass="h-full"\n\s+onCount=\{setCount\}/, 'the count comes from the list the panel already loaded');
  assert.match(dock, /const \[open, setOpen\] = useState\(\(\) => !!focusCommentId\);/, 'collapsed by default, open when a notification points at a comment');
  assert.match(dock, /useEffect\(\(\) => \{\n\s+if \(focusCommentId\) setOpen\(true\);\n\s+\}, \[focusCommentId\]\);/, 'a new notification on the same job opens it again');
  assert.match(dock, /el\.inert = !open;/, 'collapsed panel stays mounted (count · realtime) but cannot be reached');
  assert.doesNotMatch(dock, /localStorage/, 'default must stay collapsed — no remembered state');
  const panel = text('src/features/bae-gyeong/comments/BaeJobComments.tsx');
  assert.match(panel, /onCountChange=\{handleCount\}/);
  assert.match(panel, /onCountRef\.current\?\.\(n\);/);
  const types = text('src/features/bae-gyeong/home/benchTypes.ts');
  assert.match(types, /comments\?: \{ jobId: string; jobName: string \| null; focusCommentId\?: string \| null \} \| null;/);
  const bae = text('src/features/bae-gyeong/BaeGyeongView.tsx');
  assert.match(bae, /stamp: stampFor\(j\), comments: commentsFor\(j, true\) \};/, 'team record (reviewer): always on the server');
  assert.match(bae, /comments=\{commentsFor\(recordPicked, jobs\.rows\.some\(\(r\) => r\.id === recordPicked\.id\) \|\| !!jobs\.details\[recordPicked\.id\]\)\}/, 'my record: only once the server has it');
  assert.match(bae, /focusCommentId: focusComment\?\.jobId === j\.id \? focusComment\.commentId : null/);
});

async function loadJump() {
  const fake = { name: 'fake-app-store', setup(b: { onResolve: Function; onLoad: Function }) {
    b.onResolve({ filter: /^@\/stores\/(useAppStore|useAuthStore)$/ }, (a: { path: string }) => ({ path: a.path.endsWith('useAuthStore') ? 'auth' : 'app', namespace: 'fake' }));
    b.onLoad({ filter: /^app$/, namespace: 'fake' }, () => ({ loader: 'js', contents:
      'export const calls = []; export const useAppStore = { getState: () => ({ pushNavigationBackTarget: () => calls.push("back"), setView: (v) => calls.push("view:" + v) }) };' }));
    // 로그인한 사람: 처음엔 배한솔(BAE경 메뉴가 열린 사람, 개발 동안의 문 — featureFlag.canAccessBaeGyeong), 시험이 바꿀 수 있다
    b.onLoad({ filter: /^auth$/, namespace: 'fake' }, () => ({ loader: 'js', contents:
      'export const who = { user: { id: "fcc4b438-2696-4e88-a03f-d6f34e73e08f", name: "배한솔" } }; export const useAuthStore = { getState: () => ({ currentUser: who.user }) };' }));
  } };
  const result = await build({ entryPoints: ['src/features/bae-gyeong/comments/baeJobJump.ts'], bundle: true, format: 'esm', platform: 'node', write: false, plugins: [fake as never], logLevel: 'error' });
  const code = result.outputFiles[0].text.replace('export {', 'export { calls as __calls, who as __who,');
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${nonce++}`);
}

test('phase B: the jump from the bell · Windows notification · Slack link opens BAE경 and is taken once', async () => {
  const jump = await loadJump();
  assert.equal(jump.openBaeJobInApp('nope'), false, 'not a job id: nothing happens');
  assert.equal(jump.useBaeJobJumpStore.getState().request, null);
  assert.equal(jump.openBaeJobInApp(JOB, CID), true);
  assert.deepEqual(jump.__calls, ['back', 'view:bae-gyeong'], 'leaves a way back, then goes to BAE경');
  const req = jump.useBaeJobJumpStore.getState().request;
  assert.deepEqual({ jobId: req.jobId, commentId: req.commentId }, { jobId: JOB, commentId: CID });
  assert.equal(jump.useBaeJobJumpStore.getState().consume(req.seq + 1), null, 'a newer request is not taken by an older reader');
  assert.deepEqual(jump.useBaeJobJumpStore.getState().consume(req.seq), req);
  assert.equal(jump.useBaeJobJumpStore.getState().consume(req.seq), null, 'taken once');
  assert.equal(jump.openBaeJobInApp(JOB, 'scene-comment-id'), true);
  assert.equal(jump.useBaeJobJumpStore.getState().request.commentId, null, 'a comment id of another shape is dropped, the job still opens');
  // someone without the BAE경 menu (a Slack link, an old notification): goes nowhere and leaves no way back
  const before = jump.useBaeJobJumpStore.getState().request;
  jump.__calls.length = 0;
  jump.__who.user = { id: 'u-member', name: '허혜원' };
  assert.equal(jump.openBaeJobInApp(JOB, CID), false);
  assert.deepEqual(jump.__calls, []);
  assert.equal(jump.useBaeJobJumpStore.getState().request, before, 'no new request');
  // the screen takes it only after the rights are known, and decides 'mine' / 'team' from the job the server returns
  const bae = text('src/features/bae-gyeong/BaeGyeongView.tsx');
  assert.match(bae, /if \(!jump \|\| loading \|\| !currentUser \|\| !access\.canUse\) return;\n\s+const req = useBaeJobJumpStore\.getState\(\)\.consume\(jump\.seq\);/);
  assert.match(bae, /void baeGw\(\)\.jobGet\(req\.jobId\)\.then\(\(j\) => \{/);
  assert.match(bae, /if \(useBaeStore\.getState\(\)\.access\.canReview\) \{\n\s+useBaeTeam\.getState\(\)\.put\(j\);\n\s+setRecScope\('team'\); setRecSel\(null\); setTeamSel\(j\.id\);/);
  // every way in goes through the one helper
  assert.match(text('src/utils/notificationSceneAction.ts'), /const opened = openBaeJobInApp\(baeJobId, asString\(metadataValue\(metadata, 'commentId'\)\)\);/);
  assert.match(text('src/App.tsx'), /if \('baeJobId' in data\) \{\n\s+openBaeJobInApp\(data\.baeJobId, data\.commentId \?\? null\);\n\s+return;\n\s+\}/);
});

test('phase B: a stamp that the test-mode gateway saves tells the comment side (좋아요 · 다시 → one line), and the app sends Slack to the maker', async () => {
  const s = baePreviewSeed(new Date(2026, 10, 16, 15, 0), []);
  const storage = memoryStorage();
  const seen: Array<[string, string | null, string | null, string]> = [];
  const gw = createBaePreviewGateway({ storage, identity: () => ({ id: '4', name: '안류천', role: 'user' }), knownUserIds: () => ['1', '2', '3', '4'], seed: () => s,
    onStamped: (jobId, stamp, note, by) => seen.push([jobId, stamp, note, by]) });
  const job = s.jobs.find((j) => j.userId === '2' && j.status === 'done' && !j.stamp)!;
  await gw.jobStamp(job.id, 'again', '형광등 꺼진 쪽을  더 어둡게');
  await gw.jobStamp(job.id, 'again', '형광등 꺼진 쪽을 더 어둡게');
  assert.deepEqual(seen, [[job.id, 'again', '형광등 꺼진 쪽을 더 어둡게', '4']], 'the same stamp again is not a new line');
  await gw.jobStampBulk([s.jobs.find((j) => j.userId === '3' && j.status === 'done' && !j.stamp)!.id]);
  assert.equal(seen.at(-1)![1], 'seen', 'bulk 확인함 is reported too; the comment side keeps it quiet');
  assert.match(text('src/features/bae-gyeong/gateway.ts'), /onStamped: \(jobId, stamp, note, by\) => \{ void recordPreviewStampComment\(jobId, stamp, note, by\); \},/);
  const bae = text('src/features/bae-gyeong/BaeGyeongView.tsx');
  assert.match(bae, /if \(\(s === 'good' \|\| s === 'again'\) && changed\) \{\n\s+void notifyBaeStampSlack\(\{ job: \{ id: saved\.id, userId: saved\.userId, name: baeRecordTitle\(saved\) \}, stamp: s, note: saved\.stampNote \?\? null, me: currentUser, users \}\)/);
  const slack = text('src/features/bae-gyeong/comments/baeCommentSlack.ts');
  assert.match(slack, /if \(input\.stamp !== 'good' && input\.stamp !== 'again'\) return null;\n\s+if \(input\.job\.userId === input\.me\.id\) return null;/);
  assert.match(slack, /extraTargetIds: \[input\.job\.userId\],/);
});
