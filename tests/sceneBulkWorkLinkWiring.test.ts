// tests/sceneBulkWorkLinkWiring.test.ts — 씬 한꺼번에 연결의 배선 앵커 열둘(설계 11.4). 소스를 글자로 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ACTIONS = 'src/services/sceneWorkLinkActions.ts';
const SERVICE = 'src/services/sceneBulkWorkLinkActions.ts';
const DIALOG = 'src/components/scenes/BulkWorkLinkDialog.tsx';
const PANEL = 'src/components/scenes/SceneWorkLinksPanel.tsx';

// 본문을 자르는 표지.
const SAVE = 'export async function saveWorkLinkPathGuarded(';
const CHOOSE = 'export async function chooseAndLinkWorkPath(';
const OTHER_MODAL = 'function otherModalOpen(';
const RELOAD = 'async function reloadLinks(';
const REFRESH = 'function refreshLinks(';
const OFFER = 'export async function offerBulkWorkLink(';
const RUN = 'async function runBulkWorkLink(';
const UNDO = 'async function undoBulkWorkLink(';

// 작업 트리의 기존 소스는 CRLF일 수 있다 — 읽은 뒤 LF로 맞춘다.
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

/** from의 첫 자리부터, from이 끝난 뒤 처음 나오는 to의 끝까지(to 포함). to를 주지 않으면 파일 끝까지. 표지를 찾지 못하면 실패한다. */
function piece(source: string, from: string, to?: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `표지가 없다: ${from}`);
  if (to === undefined) return source.slice(start);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `표지가 없다(${from} 뒤): ${to}`);
  return source.slice(start, end + to.length);
}

/** 조각들이 이 순서로 있다 — 앞 조각의 자리 뒤에서 다음 조각을 찾는다. */
function inOrder(source: string, parts: string[]): void {
  let at = 0;
  for (const part of parts) {
    const found = source.indexOf(part, at);
    assert.notEqual(found, -1, `이 순서의 이 자리에 없다: ${part}`);
    at = found + part.length;
  }
}

const count = (source: string, part: string): number => source.split(part).length - 1;
const has = (source: string, part: string): void => assert.ok(source.includes(part), `없다: ${part}`);
const lacks = (source: string, part: string): void => assert.equal(count(source, part), 0, `있으면 안 된다: ${part}`);
/** 빈칸·줄바꿈을 모두 뺀 글. */
const squash = (text: string): string => text.replace(/\s+/g, '');

test('앵커 1: 제안은 저장이 성공한 뒤에만, 한 곳에서만 시작한다', () => {
  const actions = read(ACTIONS);
  const save = piece(actions, SAVE, CHOOSE);
  inOrder(save, [
    'await useSceneWorkLinkStore.getState().upsertLink(',
    'const savedToastId = toast.success(',
    "if (linkKind === 'primary_file') {",
    'void offerBulkWorkLink({ sceneUuid, department, path, userId: userId ?? null, savedToastId });',
    'return true;',
    '} catch (err) {',
  ]);
  assert.equal(count(actions, 'offerBulkWorkLink('), 1, `${ACTIONS}: offerBulkWorkLink(는 한 번뿐이다`);
  // 설계 표에 없는 보탬: 표의 변형 "SceneWorkLinksPanel.tsx에서 또 부름"은 그 파일을 봐야 잡힌다.
  const panel = read(PANEL);
  has(panel, 'const savePath = async (nextPath: string) => {');
  lacks(panel, 'offerBulkWorkLink');
});

test('앵커 2: 대표 파일일 때만, 기다리지 않고 부른다', () => {
  const actions = read(ACTIONS);
  const save = piece(actions, SAVE, CHOOSE);
  has(save, "if (linkKind === 'primary_file') {");
  has(save, 'void offerBulkWorkLink(');
  lacks(actions, 'await offerBulkWorkLink(');
  // 설계 표에 없는 보탬: 제안은 그 조건의 가지 안에 있다(가지를 비우고 제안을 그 뒤에 두면 폴더 연결에도 묻는데, 표의 두 조각은 그대로 있다).
  assert.equal(
    squash(piece(save, "if (linkKind === 'primary_file') {", 'return true;')),
    "if(linkKind==='primary_file'){voidofferBulkWorkLink({sceneUuid,department,path,userId:userId??null,savedToastId});}returntrue;",
    '대표 파일일 때의 가지에는 제안 한 줄뿐이고, 가지가 닫히면 바로 return true; 이다',
  );
});

test('앵커 3: 한꺼번에 연결과 되돌리기는 제안을 다시 부르지 않고 저장소 액션을 직접 부른다', () => {
  const service = read(SERVICE);
  lacks(service, 'sceneWorkLinkActions');
  lacks(service, 'saveWorkLinkPathGuarded');
  lacks(service, 'chooseAndLinkWorkPath');
  assert.equal(count(service, 'offerBulkWorkLink('), 1, `${SERVICE}: offerBulkWorkLink(는 선언 한 번뿐이다`);
  has(service, OFFER);
  const run = piece(service, RUN, UNDO);
  const undo = piece(service, UNDO);
  has(run, 'store.upsertLink(');
  has(undo, 'store.upsertLink(');
  has(undo, 'store.deleteLink(');

  // 설계 표에 없는 보탬: 쓰는 칸과 값을 글자로 고정한다 — 고른 씬의 그 부서 대표 파일 칸에, 이 파일을(표의 조각만으로는 칸의 종류·부서·경로가 바뀌어도 통과한다).
  assert.equal(
    squash(piece(run, 'const settled = await Promise.allSettled(', '})));')),
    "constsettled=awaitPromise.allSettled(plan.writes.map((write)=>store.upsertLink({sceneUuid:write.sceneUuid,department:offer.department,linkKind:'primary_file',path:offer.path,userId,})));",
    '한꺼번에 연결의 쓰기',
  );
  // 되돌리기: 지우는 칸도 되살리는 칸도 대표 파일이고, 되살리는 값은 그 단계의 예전 경로(step.path)다.
  assert.equal(
    squash(piece(undo, 'const settled = await Promise.allSettled(', '}))));')),
    "constsettled=awaitPromise.allSettled(plan.steps.map((step)=>(step.kind==='delete'?store.deleteLink(step.sceneUuid,offer.department,'primary_file'):store.upsertLink({sceneUuid:step.sceneUuid,department:offer.department,linkKind:'primary_file',path:step.path,userId,}))));",
    '되돌리기의 쓰기',
  );
});

test('앵커 4: 저장소만 부른다 — IPC와 Supabase를 직접 부르지 않는다', () => {
  const service = read(SERVICE);
  has(service, OFFER);
  lacks(service, 'electronAPI');
  lacks(service, 'supabase');
  const dialog = read(DIALOG);
  has(dialog, 'export function BulkWorkLinkDialogHost(');
  lacks(dialog, 'electronAPI');
  lacks(dialog, 'supabase');
});

test('앵커 5: 읽고 나서 매긴다 — 제안은 던지지 않고, 이미 떠 있거나 다른 창이 있으면 물러난다', () => {
  const service = read(SERVICE);
  // 아홉째 조각 runBulkWorkLink(는 끝 표지의 글자에도 들어 있다 — 끝 표지를 뗀 글에서 본다.
  const body = piece(service, OFFER, RUN).slice(0, -RUN.length);
  // 함수 전체가 try 안이고, 그 첫 문장이 "이미 떠 있으면 시작하지 않는다"이다.
  assert.match(
    body,
    /\}\): Promise<void> \{\s*try \{\s*if \(BulkWorkLinkDialog\.isOpen\(\)\) return;/,
    '본문은 try로 시작하고 그 첫 문장이 if (BulkWorkLinkDialog.isOpen()) return; 이다',
  );
  const tried = piece(body, 'try {', '} catch (err) {');
  inOrder(tried, [
    'findBulkLinkScope(',
    'loadForSceneUuids(uuids)',
    'run !== offerRun',
    'Date.now() - startedAt > BULK_LINK_OFFER_MAX_WAIT_MS',
    'sameWorkPath(own, input.path)',
    'buildBulkLinkOffer(',
    'if (otherModalOpen()) return;',
    'BulkWorkLinkDialog.show(offer)',
    'runBulkWorkLink(',
  ]);
  // catch는 경고 한 줄로 끝나고 그 뒤는 함수의 끝이다 — 다시 던지지 않는다.
  const caught = piece(body, '} catch (err) {');
  lacks(caught, 'throw');
  // 경고의 괄호 안에는 세미콜론이 없다 — [^;]*라서 경고 뒤에 문장이 하나라도 더 오면 맞지 않는다(throw 없이 거부를 돌려주는 것도 던지는 제안이다).
  assert.match(squash(caught), /^\}catch\(err\)\{console\.warn\([^;]*\);\}\}$/, 'catch는 경고 한 줄뿐이고 그 뒤에 다른 문장이 없다');

  const modal = piece(service, OTHER_MODAL, RELOAD);
  has(modal, '[role="dialog"][aria-modal="true"]');
  has(modal, 'dialog[open]');

  // 설계 표에 없는 보탬: 상태를 매기는 데 쓰는 링크 지도도 읽은 뒤에 꺼낸다(읽기 전에 꺼내 두면 낡은 지도로 매긴다).
  inOrder(tried, ['loadForSceneUuids(uuids)', 'const linkMap = useSceneWorkLinkStore.getState().linkMap;', 'buildBulkLinkOffer(']);
  // 시작 시각은 읽기 앞에서 재고, 읽기는 기다리고, 읽은 뒤의 두 검사는 돌아간다(시각을 읽기 뒤에 재면 3초 검사가 걸리지 않고, 읽기를 기다리지 않으면 읽기 전의 지도로 매긴다).
  inOrder(tried, [
    'const startedAt = Date.now();',
    'if (uuids.length > 0) await useSceneWorkLinkStore.getState().loadForSceneUuids(uuids);',
    'if (run !== offerRun || BulkWorkLinkDialog.isOpen()) return;',
    'if (Date.now() - startedAt > BULK_LINK_OFFER_MAX_WAIT_MS) return;',
  ]);
  has(service, 'export const BULK_LINK_OFFER_MAX_WAIT_MS = 3000;');
  // 가장 나중 저장의 제안만 남는다 — 차례 번호는 올려서 받는다.
  has(tried, 'const run = ++offerRun;');
  // 연결한 씬의 대표 파일 칸이 방금 저장한 경로일 때만 묻는다.
  has(tried, 'const own = getSceneWorkLinkSlots(linkMap, input.sceneUuid, input.department).primaryFile?.path;');
  has(tried, 'if (!sameWorkPath(own, input.path)) return;');
  // 고른 것이 없으면 끝나고, 있으면 고른 줄·저장한 사람·한 칸 알림을 그대로 넘겨 끝까지 기다린다(기다리지 않으면 실행의 거부가 catch를 벗어난다).
  has(tried, 'if (!selected || selected.length === 0) return;');
  has(tried, 'await runBulkWorkLink(offer, selected, input.userId, input.savedToastId);');
  // 다른 창이 '있을 때' 물러난다.
  has(modal, "return document.querySelector('[role=\"dialog\"][aria-modal=\"true\"], dialog[open]') !== null;");
});

test('앵커 6: 누르는 순간 다시 읽고, 읽지 못했으면 쓰지 않는다 — 되돌리기도 같고, 못 되돌린 것은 다시 건다', () => {
  const service = read(SERVICE);

  const run = piece(service, RUN, UNDO);
  inOrder(run, [
    'toast.dismiss(savedToastId)',
    'const fresh = await reloadLinks([offer.linkedSceneUuid, ...uuids]);',
    'if (!fresh) {',
    'toast.error(bulkLinkRecheckFailedText(offer.linkedSceneId));',
    'const store = useSceneWorkLinkStore.getState();',
    'sameWorkPath(own, offer.path)',
    'toast(bulkLinkSourceChangedText(offer.linkedSceneId));',
    'findBulkLinkScope(useDataStore.getState().episodes, offer.linkedSceneUuid, offer.department, offer.path)',
    'planBulkLink(offer, selectedKeys, store.linkMap, scope)',
    'Promise.allSettled(',
    'refreshLinks(plan.writes.map(',
    'showUndoToast(',
  ]);
  assert.equal(
    squash(piece(run, 'if (!fresh) {', '}')),
    'if(!fresh){toast.error(bulkLinkRecheckFailedText(offer.linkedSceneId));return;}',
    '한꺼번에 연결: 다시 읽지 못했으면 알리고 끝낸다',
  );

  const undo = piece(service, UNDO);
  inOrder(undo, [
    'const fresh = await reloadLinks(',
    'if (!fresh) {',
    'offerAgain(BULK_LINK_TEXT.undoRecheckFailed, writes);',
    'const store = useSceneWorkLinkStore.getState();',
    'planBulkUndo(writes, offer.path, offer.department, store.linkMap, userId)',
    'Promise.allSettled(',
    'refreshLinks(plan.steps.map(',
    'if (failed.length > 0) offerAgain(message, failed);',
  ]);
  assert.equal(
    squash(piece(undo, 'if (!fresh) {', '}')),
    'if(!fresh){offerAgain(BULK_LINK_TEXT.undoRecheckFailed,writes);return;}',
    '되돌리기: 다시 읽지 못했으면 쓰지 않고 다시 건다',
  );
  assert.equal(count(undo, 'showUndoToast('), 1, '되돌리기의 showUndoToast(는 offerAgain 안의 하나뿐이다');
  lacks(undo, 'toast.error(');

  const reload = piece(service, RELOAD, REFRESH);
  has(reload, 'loadForSceneUuids(sceneUuids)');
  has(reload, 'Promise.race(');
  has(reload, '() => true,');
  has(reload, 'return false;');
  has(reload, 'resolve(false)');
  assert.equal(count(reload, 'true'), 1, 'reloadLinks: 참은 읽기가 제때 끝났을 때 하나뿐이다');

  const refresh = piece(service, REFRESH, OFFER);
  has(refresh, 'void useSceneWorkLinkStore.getState().loadForSceneUuids(sceneUuids).catch(');
  lacks(refresh, 'await');

  assert.equal(count(service, 'Promise.allSettled('), 2, 'Promise.allSettled(는 둘이다');
  assert.equal(count(service, 'showUndoToast('), 2, 'showUndoToast(는 둘이다');
  assert.equal(count(service, 'toast.dismiss(savedToastId)'), 1, 'toast.dismiss(savedToastId)는 하나다');
  lacks(service, 'Promise.all(');

  // 설계 표에 없는 보탬: '되돌리기'가 들고 다니는 값을 글자로 고정한다(표의 조각만으로는 무엇을 들고 가는지, 몇 초인지가 바뀌어도 통과한다).
  // 한꺼번에 연결의 '되돌리기'는 10초이고, 성공한 쓰기(done)만 들고 간다 — plan.writes 전부가 아니다.
  has(run, "if (result.status === 'fulfilled') done.push(plan.writes[index]);");
  assert.equal(
    squash(piece(run, 'showUndoToast({', '});')),
    'showUndoToast({message,durationMs:BULK_LINK_UNDO_MS,onUndo:()=>{voidundoBulkWorkLink(offer,done,userId);},onExpire:()=>{},});',
    '한꺼번에 연결의 되돌리기 알림',
  );
  // 다시 건 '되돌리기'도 10초이고, 넘겨받은 것(rest)만 들고 간다 — 처음의 writes 전부가 아니다.
  has(undo, 'const offerAgain = (message: string, rest: BulkLinkWrite[]) => {');
  assert.equal(
    squash(piece(undo, 'showUndoToast({', '});')),
    'showUndoToast({message,durationMs:BULK_LINK_UNDO_MS,onUndo:()=>{voidundoBulkWorkLink(offer,rest,userId);},onExpire:()=>{},});',
    '다시 건 되돌리기 알림',
  );
  // 되돌리는 순간에는 되돌릴 그 씬들을 다시 읽는다.
  has(undo, 'const fresh = await reloadLinks(writes.map((write) => write.sceneUuid));');
  // 되돌린 단계는 못 되돌린 것에 들지 않고, 못 되돌린 단계는 예전 경로를 다시 만들어 든다 — 되살리기면 그 경로, 지우기면 null.
  assert.equal(
    squash(piece(undo, "if (result.status === 'fulfilled') {", '}')),
    "if(result.status==='fulfilled'){undone.push(step.sceneId);return;}",
    '되돌리기: 되돌린 단계는 여기서 끝난다',
  );
  inOrder(undo, [
    'Promise.allSettled(',
    "const before = step.kind === 'restore' ? step.path : null;",
    'failed.push({ sceneUuid: step.sceneUuid, sceneId: step.sceneId, before });',
    'refreshLinks(plan.steps.map(',
  ]);
  // 연결한 씬의 칸이 그 사이 달라졌으면 알리고 끝낸다(가지의 return이 빠지면 원본이 바뀌었는데 퍼뜨린다).
  assert.equal(
    squash(piece(run, 'if (!sameWorkPath(own, offer.path)) {', '}')),
    'if(!sameWorkPath(own,offer.path)){toast(bulkLinkSourceChangedText(offer.linkedSceneId));return;}',
    '한꺼번에 연결: 연결한 씬의 칸이 달라졌으면 알리고 끝낸다',
  );
  // 값도 글자로 고정한다: '되돌리기'는 10초이고, 누르는 순간의 다시 읽기는 1.5초까지만 기다린다.
  has(service, 'export const BULK_LINK_UNDO_MS = 10_000;');
  has(service, 'export const BULK_LINK_RECHECK_MAX_WAIT_MS = 1500;');
  has(reload, 'setTimeout(() => resolve(false), BULK_LINK_RECHECK_MAX_WAIT_MS)');
  has(reload, 'return Promise.race([load, timeout]);');
  // 누르는 순간에는 고른 씬들을 다시 읽는다 — 이 목록이 비면 연결한 씬만 읽고, 고른 씬은 낡은 지도로 계획한다.
  assert.equal(
    squash(piece(run, 'const picked = new Set(selectedKeys);', '.filter((id): id is string => Boolean(id));')),
    'constpicked=newSet(selectedKeys);constuuids=offer.candidates.filter((item)=>picked.has(item.key)).map((item)=>item.sceneUuid).filter((id):idisstring=>Boolean(id));',
    '한꺼번에 연결: 다시 읽는 씬은 고른 줄의 씬이다',
  );
  // 견주는 칸은 연결한 씬의 대표 파일 칸이다.
  has(run, 'const own = getSceneWorkLinkSlots(store.linkMap, offer.linkedSceneUuid, offer.department).primaryFile?.path;');
  // 결과 글자는 성공한 것(done)·실패한 것·그 사이 바뀐 것을 그대로 센다. 하나도 못 했으면 '되돌리기' 없이 알리고 끝낸다.
  has(run, 'const message = bulkLinkResultText({ linked: done.map((write) => write.sceneId), failed, changed: plan.changed });');
  assert.equal(
    squash(piece(run, 'if (done.length === 0) {', 'return;')),
    'if(done.length===0){if(failed.length>0)toast.error(message);elsetoast(message);return;',
    '한꺼번에 연결: 하나도 못 했으면 알리고 끝낸다',
  );
  // 되돌리기의 결과 글자와 끝의 세 갈래: 못 되돌린 것이 있으면 다시 걸고, 되돌린 것이 있으면 성공 알림, 둘 다 없으면 보통 알림.
  has(undo, 'const message = bulkUndoResultText({ undone, failed: failed.map((write) => write.sceneId), kept: plan.kept });');
  assert.equal(
    squash(piece(undo, 'if (failed.length > 0) offerAgain(message, failed);', 'else toast(message);')),
    'if(failed.length>0)offerAgain(message,failed);elseif(undone.length>0)toast.success(message);elsetoast(message);',
    '되돌리기의 끝 세 갈래',
  );
});

test('앵커 7: 순수 모듈은 확장자를 붙인 상대 import만 쓰고 화면에 기대지 않는다', () => {
  for (const path of ['src/utils/sceneFileNameList.ts', 'src/utils/sceneBulkWorkLink.ts']) {
    const source = read(path);
    const froms = [...source.matchAll(/from ['"]([^'"]*)['"]/g)].map((match) => match[1]);
    assert.ok(froms.length > 0, `${path}: import를 읽지 못했다`);
    for (const from of froms) assert.match(from, /^\.\.?\/.*\.ts$/, `${path}: './'나 '../'로 시작해 '.ts'로 끝나야 한다 — ${from}`);
    for (const word of ['@/', 'react', 'sonner', 'zustand', 'window.', 'document.']) {
      assert.equal(count(source, word), 0, `${path}: 있으면 안 된다 — ${word}`);
    }
    for (const line of source.split('\n')) {
      if (line.includes('../types/index.ts')) assert.match(line, /^import type /, `${path}: ../types/index.ts는 import type으로만 온다`);
    }
  }
  has(read('src/utils/sceneBulkWorkLink.ts'), "from '../types/index.ts';");
  const debounce = read('electron/presence/trailingDebounce.ts');
  has(debounce, 'export function createTrailingDebounce(');
  lacks(debounce, 'import');
});

test('앵커 8: 호스트는 본 창에 하나, 창은 스스로 닫히는 길이 하나', () => {
  const app = read('src/App.tsx');
  assert.equal(count(app, '<BulkWorkLinkDialogHost />'), 1, 'src/App.tsx: <BulkWorkLinkDialogHost />는 한 번이다');
  inOrder(app, ['<ConfirmDialogHost />', '<BulkWorkLinkDialogHost />']);

  const dialog = read(DIALOG);
  for (const part of [
    'showModal()',
    'aria-labelledby={titleId}',
    'onCancel=',
    'type="checkbox"',
    'onKeyDown={stop}',
    'onPaste={stop}',
    'event.stopPropagation();',
    'isOpen: (): boolean => pending !== null',
    'bulkLinkRowParts(row, checked)',
    'bulkLinkReplaceNote(replaceCount)',
  ]) has(dialog, part);
  assert.match(dialog, /externalShow = null;\s*settle\(null\);/, '호스트가 사라질 때 externalShow = null; 바로 뒤에 settle(null);');
  for (const part of ['window.confirm', "'Enter'", '"Enter"', 'title=', 'truncate', 'openNow']) lacks(dialog, part);
  assert.equal(count(dialog, 'submit'), 2, 'submit은 const submit = 과 onClick={submit} 둘뿐이다');
  // 설계 표에 없는 보탬: 체크 칸·버튼에 포커스가 있을 때의 붙여넣기는 body로 와서 onPaste에 닿지 않는다 — 창 단위 캡처에서 멈춘다.
  has(dialog, "window.addEventListener('paste', stopPasteAtWindow, true);");
  has(dialog, 'const stopPasteAtWindow = (pasted: ClipboardEvent) => { pasted.stopPropagation(); };');
  // 그 리스너는 창이 닫힐 때 뗀다 — 남으면 창이 한 번 뜬 뒤 본 창의 붙여넣기가 모두 멈춘다.
  has(dialog, "return () => window.removeEventListener('paste', stopPasteAtWindow, true);");
  // 설계 6.3(수동 검증에서 더함): Tab이 마지막 버튼을 지나면 포커스가 한 번 창 밖(body)에 놓인다. 그때의 키는 onKeyDown에 닿지 않는다 — 창 단위 캡처에서, 창 밖에서 온 키만 멈춘다.
  has(dialog, 'const stopOutsideKeyAtWindow = (pressed: KeyboardEvent) => {');
  has(dialog, 'if (!dialogRef.current?.contains(pressed.target as Node | null)) pressed.stopPropagation();');
  has(dialog, "window.addEventListener('keydown', stopOutsideKeyAtWindow, true);");
  has(dialog, "return () => window.removeEventListener('keydown', stopOutsideKeyAtWindow, true);");
  // 관문 C에서 더함: 체크를 푼 줄까지 넘기면 고르지 않은 씬(남이 맡은 씬도 든다)의 파일이 바뀐다 — 체크됐고 고를 수 있는 줄만 넘긴다.
  has(dialog, "const picked = offer.candidates.filter((row) => checkedKeys.has(row.key) && (row.state === 'empty' || row.state === 'replace'));");
  has(dialog, 'const submit = () => { if (count > 0) onClose(picked.map((row) => row.key)); };');
  // 닫는 길은 모두 settle을 지난다: 버튼·Esc·바깥 누름은 close로 가고, 이미 떠 있을 때의 새 요청은 덮어쓰지 않고 null로 끝난다.
  has(dialog, 'const close = (keys: string[] | null) => { settle(keys); setOffer(null); };');
  has(dialog, 'onCancel={(event) => { event.preventDefault(); onClose(null); }}');
  has(dialog, 'onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(null); }}');
  has(dialog, 'if (pending) { resolve(null); return; }');
});

test('앵커 9: main은 링크 행 신호를 모아서 한 번 — 렌더러로 가는 신호는 행마다 바로', () => {
  const main = read('electron/main.ts');
  const handler = piece(main, 'onSceneWorkLinkChange: (payload) => {', 'onPresenceSync:');
  inOrder(handler, ["broadcastSupabaseEvent('scene_work_links', payload);", 'sceneWorkLinkRefresh.schedule();']);
  lacks(handler, 'refreshSceneWorkLinkCache(');
  lacks(handler, 'editingPresence?.reset()');
  const callback = piece(
    main,
    'const sceneWorkLinkRefresh = createTrailingDebounce(() => {',
    '}, { waitMs: SCENE_WORK_LINK_REFRESH_WAIT_MS, maxWaitMs: SCENE_WORK_LINK_REFRESH_MAX_WAIT_MS });',
  );
  inOrder(callback, ['refreshSceneWorkLinkCache().then(', 'editingPresence?.reset()']);
  const stop = piece(main, 'function stopEditingPresenceService(): void {', 'function broadcastSupabaseEvent(');
  has(stop, 'sceneWorkLinkRefresh.cancel();');
  // 설계 표에 없는 보탬: 모으는 시간도 글자로 고정한다 — 0.4초 쉬면 돌고, 이어지는 변화에서는 2초에 한 번은 돈다.
  has(main, 'const SCENE_WORK_LINK_REFRESH_WAIT_MS = 400;');
  has(main, 'const SCENE_WORK_LINK_REFRESH_MAX_WAIT_MS = 2000;');
});

// 이 확인을 test:presence의 파일 안에 두면 그 스크립트가 빌드에서 빠질 때 감시도 함께 사라진다 — 그래서 test:scene-links의 이 파일이 지킨다.
test('앵커 10: 프레즌스 테스트가 빌드에 들어 있다', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.match(scripts['test:presence'], /\.\/tests\/presenceTrailingDebounce\.test\.ts/);
  assert.match(scripts['test:presence'], /\.\/tests\/sceneLinkIndex\.test\.ts/);
  assert.match(scripts.build, /npm run test:presence &&/);
  assert.match(scripts['build:vite'], /npm run test:presence &&/);
});

test('앵커 11: 새 창은 링크 행 신호에 자료를 다시 받지 않는다', () => {
  const widget = read('src/views/WidgetPopup.tsx');
  const from = "if (table === 'calendar_notifications') return;";
  const to = '// 그 외 → 디바운스 full reload';
  assert.equal(count(widget, from), 1, `표지는 한 번씩이다: ${from}`);
  assert.equal(count(widget, to), 1, `표지는 한 번씩이다: ${to}`);
  has(piece(widget, from, to), "if (table === 'scene_work_links') return;");
});

test('앵커 12: 저장이 도는 중에는 또 저장하지 않는다', () => {
  const panel = read(PANEL);
  const head = piece(panel, 'const savePath = async (nextPath: string) => {', 'setSaving(true);');
  has(head, 'if (saving) return;');
});
