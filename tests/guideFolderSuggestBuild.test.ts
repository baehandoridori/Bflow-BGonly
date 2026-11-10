// tests/guideFolderSuggestBuild.test.ts — 제안 만들기(경로 길·짐작 길·저장된 값 비교·대표 파일, 설계 4.2·4.3·4.5·4.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { samePath } from '../src/utils/guideFolderSuggest.ts';
import {
  buildGuideFolderSuggestion,
  reconcileCurrentFolder,
  suggestionMode,
  type GuideFolderDeps,
  type GuideFolderRequest,
  type GuideFolderSuggestion,
} from '../src/utils/guideFolderSuggestBuild.ts';

const D = 'G:\\공유 드라이브\\사우스 코리안 파크\\241_싱크홀 대축제\\배경_싱크홀';

function req(over: Partial<GuideFolderRequest> = {}): GuideFolderRequest {
  return {
    sceneUuid: 'self',
    scene: { sceneId: 'd054', partId: 'D' },
    method: 'drop',
    imagePath: '',
    fileName: null,
    partSceneUuids: [],
    otherBgPartSceneUuids: [],
    ...over,
  };
}

type Slot = { folder: string | null; primaryFile: string | null };
function deps(over: {
  dirs?: Record<string, string[]>;
  files?: Record<string, string[]>;
  slots?: Record<string, Slot>;
  loadOk?: boolean;
} = {}) {
  const calls = { listDir: 0, loadLinks: [] as string[][] };
  const find = (table: Record<string, string[]> | undefined, dir: string) => {
    const key = Object.keys(table ?? {}).find((candidate) => samePath(candidate, dir));
    return key === undefined ? null : table![key];
  };
  const value: GuideFolderDeps = {
    async listDir(dir, kind) {
      calls.listDir += 1;
      return find(kind === 'dirs' ? over.dirs : over.files, dir);
    },
    async loadLinks(uuids) {
      calls.loadLinks.push(uuids);
      return over.loadOk ?? true;
    },
    bgSlots(uuid) {
      return over.slots?.[uuid] ?? { folder: null, primaryFile: null };
    },
  };
  return { value, calls };
}

test('경로 길: 작업 폴더 비어 있음 → 새로 넣기 + clip', async () => {
  const { value } = deps({ files: { [`${D}\\d파트\\d054`]: ['d054.clip', 'd054.png'] } });
  const s = await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\d054가이드.png`, fileName: 'd054가이드.png' }), value);
  assert.deepEqual(s?.candidates, [{ folder: `${D}\\d파트\\d054`, clip: `${D}\\d파트\\d054\\d054.clip` }]);
  assert.equal(s?.guessed, false);
  assert.equal(s?.currentFolder, null);
  assert.equal(s?.offerClip, true);
  assert.equal(s?.mismatch, false);
  assert.equal(s?.sceneId, 'd054');
  assert.equal(s?.fileName, 'd054가이드.png');
  assert.equal(suggestionMode(s!), 'new');
});

test('경로 길: 같은 폴더가 이미 있으면 null (대표 파일이 비어 있어도)', async () => {
  const { value } = deps({ slots: { self: { folder: `${D}\\D파트\\d054\\`, primaryFile: null } } });
  assert.equal(await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\g.png` }), value), null);
});

test('경로 길: 다른 폴더가 있으면 바꾸기, 대표 파일 있으면 offerClip false 이고 clip 을 찾지 않는다', async () => {
  const { value, calls } = deps({
    slots: { self: { folder: `${D}\\d파트\\d050.052`, primaryFile: 'x.clip' } },
    files: { [`${D}\\d파트\\d054`]: ['d054.clip'] },
  });
  const s = await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\g.png` }), value);
  assert.equal(suggestionMode(s!), 'change');
  assert.equal(s?.currentFolder, `${D}\\d파트\\d050.052`);
  assert.equal(s?.offerClip, false);
  assert.equal(s?.candidates[0].clip, null);
  assert.equal(calls.listDir, 0);
});

test('경로 길: 번호 불일치는 경고를 달고 제안', async () => {
  const { value } = deps();
  const s = await buildGuideFolderSuggestion(req({ scene: { sceneId: 'd055', partId: 'D' }, imagePath: `${D}\\d파트\\d054\\g.png` }), value);
  assert.equal(s?.mismatch, true);
  assert.equal(s?.candidates[0].folder, `${D}\\d파트\\d054`);
});

test('경로 길: 공유 드라이브 밖이면 null, 목록을 읽지 않는다', async () => {
  const { value, calls } = deps();
  assert.equal(await buildGuideFolderSuggestion(req({ imagePath: 'C:\\Users\\me\\Desktop\\d054\\g.png' }), value), null);
  assert.equal(calls.listDir, 0);
});

test('짐작 길: 같은 파트 저장 경로 → 파트 폴더 → 후보 둘, 짧은 이름 먼저', async () => {
  const { value, calls } = deps({
    slots: {
      s1: { folder: `${D}\\d파트\\d054`, primaryFile: null },
      s2: { folder: `${D}\\b파트\\b003`, primaryFile: null },
    },
    dirs: { [`${D}\\d파트`]: ['d028.043.046', 'd043.046', 'd054'] },
    files: { [`${D}\\d파트\\d043.046`]: ['d043.clip', 'd046.clip'] },
  });
  const s = await buildGuideFolderSuggestion(
    req({ scene: { sceneId: 'd043', partId: 'D' }, method: 'paste', partSceneUuids: ['s1', 's2'] }),
    value,
  );
  assert.deepEqual(s?.candidates.map((c) => c.folder), [`${D}\\d파트\\d043.046`, `${D}\\d파트\\d028.043.046`]);
  assert.equal(s?.candidates[0].clip, `${D}\\d파트\\d043.046\\d043.clip`);
  assert.equal(s?.candidates[1].clip, null);
  assert.equal(s?.guessed, true);
  assert.deepEqual(calls.loadLinks[1], ['s1', 's2']);
});

test('짐작 길: 같은 파트에 없으면 다른 배경 파트로 배경 폴더 → d파트 찾기', async () => {
  const { value } = deps({
    slots: { o1: { folder: `${D}\\b파트\\b048`, primaryFile: null } },
    dirs: { [D]: ['a파트', 'D파트', '프랍'], [`${D}\\D파트`]: ['d054', 'd055'] },
  });
  const s = await buildGuideFolderSuggestion(req({ method: 'drop', partSceneUuids: ['s1'], otherBgPartSceneUuids: ['o1'] }), value);
  assert.deepEqual(s?.candidates.map((c) => c.folder), [`${D}\\D파트\\d054`]);
  assert.equal(s?.guessed, true);
});

test('짐작 길: 링크 읽기 실패·후보 0개·파트 폴더 없음·참고할 씬 없음이면 null', async () => {
  const withFolder = { s1: { folder: `${D}\\d파트\\d055`, primaryFile: null } };
  assert.equal(await buildGuideFolderSuggestion(req({ partSceneUuids: ['s1'] }), deps({ slots: withFolder, loadOk: false }).value), null);
  assert.equal(await buildGuideFolderSuggestion(req({ partSceneUuids: ['s1'] }), deps({ slots: withFolder, dirs: { [`${D}\\d파트`]: ['d055'] } }).value), null);
  assert.equal(await buildGuideFolderSuggestion(req({ partSceneUuids: ['s1'] }), deps({ slots: { s1: { folder: `${D}\\프랍\\x`, primaryFile: null } } }).value), null);
  const none = deps();
  assert.equal(await buildGuideFolderSuggestion(req(), none.value), null);
  assert.equal(none.calls.listDir, 0);
});

test('reconcileCurrentFolder: 후보와 같아지면 null, 다르면 바꾸기로, 그대로면 같은 것', () => {
  const base: GuideFolderSuggestion = {
    sceneUuid: 'self', sceneId: 'd054', method: 'drop', fileName: null, guessed: false,
    candidates: [{ folder: `${D}\\d파트\\d054`, clip: null }], mismatch: false, currentFolder: null, offerClip: true,
  };
  assert.equal(reconcileCurrentFolder(base, `${D}\\d파트\\d054\\`), null);
  assert.equal(reconcileCurrentFolder(base, `${D}\\d파트\\d060`)?.currentFolder, `${D}\\d파트\\d060`);
  assert.equal(reconcileCurrentFolder(base, null), base);
  const changed = { ...base, currentFolder: `${D}\\d파트\\d060` };
  assert.equal(reconcileCurrentFolder(changed, null)?.currentFolder, null);
});
