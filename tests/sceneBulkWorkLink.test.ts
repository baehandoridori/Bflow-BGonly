import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BULK_LINK_DEFAULTS,
  BULK_LINK_TEXT,
  buildBulkLinkOffer,
  bulkLinkConfirmLabel,
  bulkLinkLayoutHeading,
  bulkLinkLead,
  bulkLinkNotFoundText,
  bulkLinkRecheckFailedText,
  bulkLinkReplaceNote,
  bulkLinkResultText,
  bulkLinkRowParts,
  bulkLinkSourceChangedText,
  bulkUndoResultText,
  effectiveLayout,
  findBulkLinkScope,
  findSceneLocation,
  planBulkLink,
  planBulkUndo,
  sameWorkPath,
  sceneIdList,
} from '../src/utils/sceneBulkWorkLink.ts';
import type { BulkLinkDefaults, BulkLinkOffer, BulkLinkPlan, BulkLinkScope, BulkLinkWrite } from '../src/utils/sceneBulkWorkLink.ts';
import { getWorkLinkSlotKey } from '../src/utils/sceneWorkLinks.ts';
import type { Episode, Part, Scene, SceneWorkLink, SceneWorkLinkDepartment } from '../src/types/index.ts';

// 설계 11.2의 공통 자료.
const scene = (id: string, no: number, sceneId: string, layoutId = '') =>
  ({ id, no, sceneId, layoutId, memo: '', storyboardUrl: '', guideUrl: '', assignee: '', lo: false, done: false, review: false, png: false });

// 부를 때마다 새 객체가 나온다 — "그 사이 씬 자료가 바뀌었다"는 이 자료를 새로 만들어 씬 하나만 고친 뒤 findBulkLinkScope를 다시 불러 얻는다.
function makeEpisodes(): Episode[] {
  const bgA = { partId: 'A', department: 'bg', sheetName: 'EP05_A_BG', scenes: [
    scene('bg-1', 1, 'a001', '12'), scene('bg-2', 2, 'a002', '12'), scene('bg-3', 3, 'a003'),
    scene('bg-3a', 4, 'a003A'), scene('bg-5', 5, 'a005', '7'), scene('bg-7', 6, 'A007'),
    scene('bg-9', 7, 'a009', ' 12 '),
    { ...scene('', 8, 'a010', '12'), id: undefined },          // uuid 없는 씬
  ] };
  const actA = { partId: 'a', department: 'acting', sheetName: 'EP05_A_ACT', scenes: [
    scene('act-1', 1, 'A001'), scene('act-2', 2, 'A002'), scene('act-3', 3, 'A003', '12'),
    scene('act-5', 4, 'A005'), scene('act-7', 5, 'A007'),
  ] };
  const bgB = { partId: 'B', department: 'bg', sheetName: 'EP05_B_BG', scenes: [scene('bgb-1', 1, 'b001', '12'), scene('bgb-3', 2, 'b003')] };
  // 순서가 뒤섞여 있고, 연결할 씬(c001)과 번호가 같은 씬(C001)이 한 파트에 있다. 액팅 짝의 레이아웃에는 빈칸이 붙어 있다.
  const bgC = { partId: 'C', department: 'bg', sheetName: 'EP05_C_BG', scenes: [
    scene('c-5', 1, 'c005'), scene('c-1', 2, 'c001'), scene('c-1u', 3, 'C001'), scene('c-3', 4, 'c003'),
  ] };
  const actC = { partId: 'C', department: 'acting', sheetName: 'EP05_C_ACT', scenes: [scene('ca-3', 1, 'c003', ' 12 ')] };
  // 씬 번호를 0 없이 쓰는 파트('없는 씬' 줄의 자릿수 확인용).
  const bgP = { partId: 'P', department: 'bg', sheetName: 'EP05_P_BG', scenes: [scene('p-1', 1, 'p1'), scene('p-3', 2, 'p3'), scene('p-12', 3, 'p12')] };
  const episodes = [
    { episodeNumber: 5, title: 'EP.05', parts: [bgA, actA, bgB, bgC, actC, bgP] },
    { episodeNumber: 6, title: 'EP.06', parts: [{ partId: 'A', department: 'bg', sheetName: 'EP06_A_BG', scenes: [scene('e6-1', 1, 'a001', '12'), scene('e6-3', 2, 'a003', '12')] }] },
  ];
  return episodes as Episode[];
}

const FILE = 'G:\\show\\EP5\\a 001,003,005,007,011.moho';

// 링크 지도를 만드는 도우미: link('act-3', 'bg', 경로, 고친 사람 = 'me') → [칸 열쇠, { sceneUuid, department, linkKind: 'primary_file', path, updatedBy, … }]
const link = (
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  path: string,
  updatedBy: string | null = 'me',
): [string, SceneWorkLink] => [
  getWorkLinkSlotKey(sceneUuid, department, 'primary_file'),
  { id: 'l-' + sceneUuid + department, sceneUuid, department, linkKind: 'primary_file', path, label: null, sortOrder: 0, createdBy: null, createdAt: '', updatedBy, updatedAt: '' },
];

const episodes = makeEpisodes();
const [bgA, actA, , bgC, actC] = episodes[0].parts;

// 묶음은 sceneId의 배열로 견준다.
const sceneIds = (scenes: Scene[]): string[] => scenes.map((item) => item.sceneId);

const sceneOf = (part: Part, sceneId: string): Scene => {
  const found = part.scenes.find((item) => item.sceneId === sceneId);
  assert.ok(found, sceneId);
  return found;
};

// 묶음이 나와야 하는 호출: null이 아님을 단언하고 돌려준다. 넘긴 인자만 그대로 넘긴다(defaults를 생략하면 생략한 채로).
const scopeOf = (...args: [string, SceneWorkLinkDepartment, string, BulkLinkDefaults?]): BulkLinkScope => {
  const scope = findBulkLinkScope(episodes, ...args);
  assert.ok(scope, `${args[0]} ${args[2]}`);
  return scope;
};

// 창을 열 때의 링크(buildBulkLinkOffer의 자료).
const LINKS = new Map([
  link('bg-5', 'bg', 'G:\\old\\a005.moho'),
  link('bg-7', 'bg', 'g:/show/ep5/A 001,003,005,007,011.MOHO'),
  link('bg-2', 'bg', 'G:\\old\\layout12.moho'),
]);

const D: BulkLinkDefaults = { checkNamedReplace: true, offerLayoutOnly: true, checkLayoutOnly: false };

// 제안의 줄: [씬 번호, 묶음, 상태, 처음 체크]. 제안이 없으면(null) undefined라 어느 목록과도 같지 않다.
const rows = (offer: BulkLinkOffer | null) => offer?.candidates.map((item) => [item.sceneId, item.group, item.state, item.checked]);

test('findSceneLocation: uuid로 씬의 파트와 화를 찾는다', () => {
  const location = findSceneLocation(episodes, 'act-3');
  assert.equal(location?.part.sheetName, 'EP05_A_ACT');
  assert.equal(location?.episode.episodeNumber, 5);
  assert.equal(findSceneLocation(episodes, 'nope'), null);
  assert.equal(findSceneLocation(episodes, ''), null);
});

test('effectiveLayout: 자기 레이아웃, 비었으면 짝 파트의 같은 번호 씬 것 — 양쪽 다 다듬는다', () => {
  assert.equal(effectiveLayout(sceneOf(actA, 'A001'), actA, bgA), '12');
  assert.equal(effectiveLayout(sceneOf(bgA, 'a003'), bgA, actA), '12');
  assert.equal(effectiveLayout(sceneOf(bgA, 'a003A'), bgA, actA), '');
  assert.equal(effectiveLayout(sceneOf(bgA, 'a009'), bgA, actA), '12');
  // 짝 파트가 없으면 자기 것만.
  assert.equal(effectiveLayout(sceneOf(bgA, 'a003'), bgA, undefined), '');
  assert.equal(effectiveLayout(sceneOf(bgA, 'a001'), bgA, undefined), '12');
  // 짝 쪽의 빈칸도 다듬는다.
  assert.equal(effectiveLayout(sceneOf(bgC, 'c003'), bgC, actC), '12');
});

// 보탬 자료(설계 11.2의 목록 밖): 4.9의 `if (!key) return '';`. 11.2의 씬에는 모두 번호가 있어 이 줄을 지운 구현을 가르지 못한다 — 막 더한 씬은 번호가 ''로 저장될 수 있다.
test('effectiveLayout: 씬 번호가 빈 씬은 짝 파트의 번호가 빈 씬을 짝으로 삼지 않는다', () => {
  const blankBg = { partId: 'Y', department: 'bg', sheetName: 'EP07_Y_BG', scenes: [scene('y-1', 1, '')] } as Part;
  const blankAct = { partId: 'Y', department: 'acting', sheetName: 'EP07_Y_ACT', scenes: [scene('ya-1', 1, '', '12')] } as Part;
  assert.equal(effectiveLayout(blankBg.scenes[0], blankBg, blankAct), '');
});

test('findBulkLinkScope: 배경 씬에서 — 그 파트의 이름 묶음·레이아웃 묶음·없는 씬', () => {
  const scope = scopeOf('bg-1', 'bg', FILE);
  assert.deepEqual(sceneIds(scope.named), ['a003', 'a005', 'A007']);
  assert.deepEqual(sceneIds(scope.layout), ['a002', 'a009', 'a010']);
  assert.deepEqual(scope.notFound, ['a011']);
  assert.equal(scope.layoutValue, '12');
  // 배경 파트 것만이다 — 액팅 씬·파트 B·6화의 씬이 하나도 없다.
  assert.deepEqual([...scope.named, ...scope.layout].map((item) => item.id), ['bg-3', 'bg-5', 'bg-7', 'bg-2', 'bg-9', undefined]);
});

test('findBulkLinkScope: 액팅 씬에서 — 액팅 파트 것만, 없는 씬은 연결한 씬 번호에 적힌 글자 그대로', () => {
  const scope = scopeOf('act-1', 'acting', FILE);
  assert.deepEqual(sceneIds(scope.named), ['A003', 'A005', 'A007']);
  assert.deepEqual(sceneIds(scope.layout), ['A002']);
  assert.deepEqual(scope.notFound, ['A011']);
  // 보탬(11.2의 목록 밖): layoutValue는 유효 레이아웃이다(4.1) — A001은 자기 것이 비었고 배경 짝 a001의 12다.
  assert.equal(scope.layoutValue, '12');
});

test('findBulkLinkScope: 부서가 어긋나면 null', () => {
  assert.equal(findBulkLinkScope(episodes, 'bg-1', 'acting', FILE), null);
});

test('findBulkLinkScope: 이름에도 레이아웃에도 다른 씬이 없으면 null', () => {
  // 번호가 없는 이름·레이아웃이 혼자인 씬, 자기 번호만 적힌 이름.
  assert.equal(findBulkLinkScope(episodes, 'bg-5', 'bg', 'G:\\x\\main.psd'), null);
  assert.equal(findBulkLinkScope(episodes, 'bg-5', 'bg', 'G:\\x\\a005.moho'), null);
  // 레이아웃이 빈 씬끼리는 묶음이 아니다.
  assert.equal(findBulkLinkScope(episodes, 'bg-7', 'bg', 'G:\\x\\main.psd'), null);
});

test('findBulkLinkScope: 이름에 자기뿐이어도 레이아웃이 같은 씬이 있으면 레이아웃 묶음', () => {
  const scope = scopeOf('bg-2', 'bg', 'G:\\x\\a002.moho');
  assert.deepEqual(scope.named, []);
  assert.deepEqual(sceneIds(scope.layout), ['a001', 'a003', 'a009', 'a010']);
});

test('findBulkLinkScope: 이름이 다른 씬들을 가리키면 레이아웃 묶음도 없다 — 번호 하나짜리 다른 글자는 해당하지 않는다', () => {
  assert.equal(findBulkLinkScope(episodes, 'bg-1', 'bg', 'G:\\x\\b 001,003.moho'), null);
  const scope = scopeOf('bg-1', 'bg', 'G:\\x\\b030.moho');
  assert.deepEqual(scope.named, []);
  assert.deepEqual(sceneIds(scope.layout), ['a002', 'a003', 'a009', 'a010']);
});

test('findBulkLinkScope: 자기 번호가 빠진 목록도 이 씬의 목록이다(P4)', () => {
  const scope = scopeOf('bg-2', 'bg', 'G:\\x\\a 003,005.moho');
  assert.deepEqual(sceneIds(scope.named), ['a003', 'a005']);
  assert.deepEqual(sceneIds(scope.layout), ['a001', 'a009', 'a010']);
  assert.deepEqual(scope.notFound, []);
});

test('findBulkLinkScope: 이름 묶음은 번호 순이고, 연결한 씬과 번호가 같은 씬은 넣지 않는다', () => {
  const scope = scopeOf('c-1', 'bg', 'G:\\x\\c 001,003,005.moho');
  assert.deepEqual(sceneIds(scope.named), ['c003', 'c005']);
  assert.deepEqual(scope.layout, []);
  // 보탬(11.2의 목록 밖): 순수 모듈이다(4절 머리말) — 넘겨받은 씬 배열(저장소의 자료)의 순서는 그대로다. 번호 순은 사본을 정렬한 것이다.
  assert.deepEqual(sceneIds(bgC.scenes), ['c005', 'c001', 'C001', 'c003']);
});

test('findBulkLinkScope: 접미가 붙은 씬은 접미까지 맞아야 한다', () => {
  const scope = scopeOf('bg-3', 'bg', 'G:\\x\\a 001,003,003A.moho');
  assert.deepEqual(sceneIds(scope.named), ['a001', 'a003A']);
  assert.deepEqual(scope.notFound, []);
});

test('findBulkLinkScope: 범위 — 있는 씬만 올리고, 범위 사이의 없는 번호는 적지 않는다', () => {
  const upTo3 = scopeOf('bg-1', 'bg', 'G:\\x\\a001~003.moho');
  assert.deepEqual(sceneIds(upTo3.named), ['a002', 'a003']);
  assert.deepEqual(sceneIds(upTo3.layout), ['a009', 'a010']);
  assert.deepEqual(upTo3.notFound, []);
  // 끝 번호는 직접 적힌 것이다.
  const upTo4 = scopeOf('bg-1', 'bg', 'G:\\x\\a001~004.moho');
  assert.deepEqual(sceneIds(upTo4.named), ['a002', 'a003']);
  assert.deepEqual(upTo4.notFound, ['a004']);
  const upTo5 = scopeOf('bg-1', 'bg', 'G:\\x\\a001~005.moho');
  assert.deepEqual(sceneIds(upTo5.named), ['a002', 'a003', 'a005']);
  assert.deepEqual(upTo5.notFound, []);
});

test('findBulkLinkScope: 다른 파트·다른 화의 씬은 보지 않는다', () => {
  const partB = scopeOf('bgb-1', 'bg', 'G:\\x\\b 001,003.moho');
  assert.deepEqual(sceneIds(partB.named), ['b003']);
  assert.deepEqual(partB.layout, []);
  const episode6 = scopeOf('e6-1', 'bg', 'G:\\x\\a 001,003.moho');
  assert.deepEqual(episode6.named.map((item) => item.id), ['e6-3']);
  assert.deepEqual(episode6.layout, []);
});

test('findBulkLinkScope: 없는 씬의 표시 글자 — 접미까지, 숫자는 파일 이름의 자릿수대로', () => {
  const suffixed = scopeOf('bg-1', 'bg', 'G:\\x\\a 001,003,005B.moho');
  assert.deepEqual(sceneIds(suffixed.named), ['a003']);
  assert.deepEqual(sceneIds(suffixed.layout), ['a002', 'a009', 'a010']);
  assert.deepEqual(suffixed.notFound, ['a005B']);
  const unpadded = scopeOf('p-1', 'bg', 'G:\\x\\p1,3,5.moho');
  assert.deepEqual(sceneIds(unpadded.named), ['p3']);
  assert.deepEqual(unpadded.notFound, ['p5']);
  const fourDigits = scopeOf('bg-1', 'bg', 'G:\\x\\a0001,0003,0011.moho');
  assert.deepEqual(sceneIds(fourDigits.named), ['a003']);
  assert.deepEqual(fourDigits.notFound, ['a0011']);
});

test('findBulkLinkScope: 글자 붙은 목록 뒤에 남은 조각은 읽지 않는다', () => {
  const path = 'G:\\x\\a001,003-009,011.moho';
  const from1 = scopeOf('bg-1', 'bg', path);
  assert.deepEqual(sceneIds(from1.named), ['a003']);
  assert.deepEqual(sceneIds(from1.layout), ['a002', 'a009', 'a010']);
  assert.deepEqual(from1.notFound, []);
  // 같은 파일을 a009에: 자기 번호 9가 앞의 목록에 없어도 그 목록이 읽힌다(P4).
  const from9 = scopeOf('bg-9', 'bg', path);
  assert.deepEqual(sceneIds(from9.named), ['a001', 'a003']);
  assert.deepEqual(sceneIds(from9.layout), ['a002', 'a010']);
  assert.deepEqual(from9.notFound, []);
  // 다른 파트의 목록 뒤에 남은 조각.
  assert.equal(findBulkLinkScope(episodes, 'bg-5', 'bg', 'G:\\x\\b001,003-005,007.moho'), null);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.3의 4 "글자는 연결한 씬 번호에 적힌 글자 그대로, 없으면 family"의 뒷부분. 11.2의 씬 번호에는 모두 글자가 있어 가족으로 떨어지는 길을 가르지 못한다.
test('findBulkLinkScope: 없는 씬의 표시 글자 — 씬 번호에 글자가 없으면 가족(파트 첫 글자)', () => {
  const partN = { partId: 'A', department: 'bg', sheetName: 'EP07_A_BG', scenes: [scene('n-1', 1, '001'), scene('n-3', 2, '003')] };
  const episodesN = [{ episodeNumber: 7, title: 'EP.07', parts: [partN] }] as Episode[];
  const scope = findBulkLinkScope(episodesN, 'n-1', 'bg', 'G:\\x\\001,003,005.moho');
  assert.ok(scope);
  assert.deepEqual(sceneIds(scope.named), ['003']);
  assert.deepEqual(scope.notFound, ['a005']);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.3의 3 "같은 열쇠의 씬이 둘이면 둘 다 넣는다". 11.2에서 열쇠가 겹치는 씬은 연결한 씬 자신과 겹치는 C001뿐이라, 열쇠마다 하나만 남기는 구현을 가르지 못한다.
test('findBulkLinkScope: 이름 묶음 — 번호가 같은 씬이 둘이면(e003·E003) 둘 다 넣는다', () => {
  const partE = { partId: 'E', department: 'bg', sheetName: 'EP07_E_BG', scenes: [scene('e-1', 1, 'e001'), scene('e-3', 2, 'e003'), scene('e-3u', 3, 'E003')] };
  const episodesE = [{ episodeNumber: 7, title: 'EP.07', parts: [partE] }] as Episode[];
  const scope = findBulkLinkScope(episodesE, 'e-1', 'bg', 'G:\\x\\e 001,003.moho');
  assert.ok(scope);
  assert.deepEqual(sceneIds(scope.named), ['e003', 'E003']);
  assert.deepEqual(scope.notFound, []);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.4 "다듬은 글자의 완전 일치다('12'와 '012'는 다르다)". 11.2에는 수로는 같고 글자만 다른 레이아웃이 없어, 수로 견주거나 대소문자를 접는 구현을 가르지 못한다.
test('findBulkLinkScope: 레이아웃 묶음 — 글자 그대로 같아야 한다(12와 012, 12a와 12A는 다르다)', () => {
  const partZ = { partId: 'Z', department: 'bg', sheetName: 'EP07_Z_BG', scenes: [
    scene('z-1', 1, 'z001', '12'), scene('z-2', 2, 'z002', '012'), scene('z-3', 3, 'z003', '12'),
    scene('z-4', 4, 'z004', '12a'), scene('z-5', 5, 'z005', '12A'),
  ] };
  const episodesZ = [{ episodeNumber: 7, title: 'EP.07', parts: [partZ] }] as Episode[];
  const scope = findBulkLinkScope(episodesZ, 'z-1', 'bg', 'G:\\x\\main.psd');
  assert.ok(scope);
  assert.deepEqual(scope.named, []);
  assert.deepEqual(sceneIds(scope.layout), ['z003']);
  assert.equal(findBulkLinkScope(episodesZ, 'z-4', 'bg', 'G:\\x\\main.psd'), null);
});

test('필터와 무관: 화면 상태를 받는 인자가 없다(기본값이 있는 defaults는 세지 않는다)', () => {
  assert.equal(findBulkLinkScope.length, 4);
  assert.equal(buildBulkLinkOffer.length, 4);
});

test('buildBulkLinkOffer: 후보마다 상태와 처음 체크 — 이름 묶음 먼저, 그다음 레이아웃 묶음', () => {
  const offer = buildBulkLinkOffer(scopeOf('bg-1', 'bg', FILE), FILE, 'bg', LINKS);
  assert.ok(offer);
  assert.deepEqual(offer.candidates.map((item) => [item.sceneId, item.group, item.state, item.checked, item.key]), [
    ['a003', 'named', 'empty', true, 'bg-3'],
    ['a005', 'named', 'replace', true, 'bg-5'],
    ['A007', 'named', 'same', false, 'bg-7'],
    ['a002', 'layout', 'replace', false, 'bg-2'],
    ['a009', 'layout', 'empty', false, 'bg-9'],
    ['a010', 'layout', 'unavailable', false, 'no:8:a010'],
  ]);
  // 보탬(11.2의 표 밖): 4.1의 나머지 필드 — uuid 없는 줄의 sceneUuid는 null이고(''가 아니다), path와 department는 넘긴 그대로다.
  assert.deepEqual(offer.candidates.map((item) => item.sceneUuid), ['bg-3', 'bg-5', 'bg-7', 'bg-2', 'bg-9', null]);
  assert.equal(offer.path, FILE);
  assert.equal(offer.department, 'bg');
  assert.equal(offer.fileName, 'a 001,003,005,007,011.moho');
  assert.equal(offer.layout, '12');
  assert.equal(offer.linkedSceneId, 'a001');
  assert.equal(offer.linkedSceneUuid, 'bg-1');
  assert.deepEqual(offer.notFound, ['a011']);
  assert.equal(offer.candidates[1].currentPath, 'G:\\old\\a005.moho');
});

test('손잡이 셋: 넘긴 값을 듣는다 — offerLayoutOnly, checkNamedReplace, checkLayoutOnly', () => {
  const noLayout = scopeOf('bg-1', 'bg', FILE, { ...D, offerLayoutOnly: false });
  assert.deepEqual(sceneIds(noLayout.named), ['a003', 'a005', 'A007']);
  assert.deepEqual(noLayout.layout, []);
  assert.equal(findBulkLinkScope(episodes, 'bg-2', 'bg', 'G:\\x\\a002.moho', { ...D, offerLayoutOnly: false }), null);
  const checked = (defaults: BulkLinkDefaults) => (
    buildBulkLinkOffer(scopeOf('bg-1', 'bg', FILE), FILE, 'bg', LINKS, defaults)?.candidates.map((item) => item.checked)
  );
  assert.deepEqual(checked({ ...D, checkNamedReplace: false }), [true, false, false, false, false, false]);
  assert.deepEqual(checked({ ...D, checkLayoutOnly: true }), [true, true, false, true, true, false]);
});

test('buildBulkLinkOffer: 할 일이 없으면 null — 모두 이미 이 파일이거나, uuid 없는 씬뿐이거나', () => {
  // 대소문자·빗금만 다른 같은 파일.
  const pathB = 'G:\\x\\b 001,003.moho';
  const linksB = new Map([link('bgb-3', 'bg', 'G:/x/B 001,003.moho')]);
  assert.equal(buildBulkLinkOffer(scopeOf('bgb-1', 'bg', pathB), pathB, 'bg', linksB), null);
  const partD = { partId: 'D', department: 'bg', sheetName: 'EP05_D_BG', scenes: [scene('d-1', 1, 'd001'), { ...scene('', 2, 'd003'), id: undefined }] };
  const episodesD = [{ episodeNumber: 5, title: 'EP.05', parts: [partD] }] as Episode[];
  const pathD = 'G:\\x\\d 001,003.moho';
  const scopeD = findBulkLinkScope(episodesD, 'd-1', 'bg', pathD);
  assert.ok(scopeD);
  assert.deepEqual(sceneIds(scopeD.named), ['d003']);
  assert.equal(buildBulkLinkOffer(scopeD, pathD, 'bg', new Map()), null);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.6 "후보 가운데 empty나 replace가 하나라도 있을 때만". 11.2의 제안에는 늘 empty와 replace가 함께 있고 처음부터 체크된 이름 묶음의 줄도 있어, 둘 중 한쪽만 보거나·체크된 줄만 보거나·이름 묶음만 보는 구현을 가르지 못한다.
test('buildBulkLinkOffer: 창이 뜨는 조건 — empty나 replace가 하나라도 있으면 뜬다(체크된 줄이 없어도, 레이아웃 묶음뿐이어도)', () => {
  const pathB = 'G:\\x\\b 001,003.moho';
  // 빈 칸 하나뿐.
  assert.deepEqual(rows(buildBulkLinkOffer(scopeOf('bgb-1', 'bg', pathB), pathB, 'bg', new Map())), [['b003', 'named', 'empty', true]]);
  // 다른 파일을 든 칸 하나뿐 — 그 줄을 풀어 둔 채 여는 설정(checkNamedReplace: false)에서도 창은 뜬다.
  const replaceOnly = new Map([link('bgb-3', 'bg', 'G:\\old\\b003.moho')]);
  assert.deepEqual(rows(buildBulkLinkOffer(scopeOf('bgb-1', 'bg', pathB), pathB, 'bg', replaceOnly)), [['b003', 'named', 'replace', true]]);
  assert.deepEqual(
    rows(buildBulkLinkOffer(scopeOf('bgb-1', 'bg', pathB), pathB, 'bg', replaceOnly, { ...D, checkNamedReplace: false })),
    [['b003', 'named', 'replace', false]],
  );
  // 레이아웃 묶음뿐이고 처음부터 체크된 줄이 하나도 없다(P3: 올리되 체크하지 않는다).
  const pathA2 = 'G:\\x\\a002.moho';
  assert.deepEqual(rows(buildBulkLinkOffer(scopeOf('bg-2', 'bg', pathA2), pathA2, 'bg', new Map())), [
    ['a001', 'layout', 'empty', false],
    ['a003', 'layout', 'empty', false],
    ['a009', 'layout', 'empty', false],
    ['a010', 'layout', 'unavailable', false],
  ]);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.5의 표 "unavailable — 처음 체크: 아니오"와 4.1의 `sceneUuid: string | null`. 11.2에서 창이 뜨는 제안의 uuid 없는 씬은 레이아웃 묶음의 a010뿐이라, 이름 묶음의 uuid 없는 줄을 체크해 두는 구현을 가르지 못한다.
test('buildBulkLinkOffer: 이름 묶음의 uuid 없는 씬 — 체크하지 않고, 열쇠는 no:…, sceneUuid는 null', () => {
  const partD = { partId: 'D', department: 'bg', sheetName: 'EP05_D_BG', scenes: [
    scene('d-1', 1, 'd001'), { ...scene('', 2, 'd003'), id: undefined }, scene('d-5', 3, 'd005'),
  ] };
  const episodesD = [{ episodeNumber: 5, title: 'EP.05', parts: [partD] }] as Episode[];
  const pathD = 'G:\\x\\d 001,003,005.moho';
  const scopeD = findBulkLinkScope(episodesD, 'd-1', 'bg', pathD);
  assert.ok(scopeD);
  const offer = buildBulkLinkOffer(scopeD, pathD, 'bg', new Map());
  assert.ok(offer);
  assert.deepEqual(offer.candidates.map((item) => [item.sceneId, item.group, item.state, item.checked, item.key, item.sceneUuid]), [
    ['d003', 'named', 'unavailable', false, 'no:2:d003', null],
    ['d005', 'named', 'empty', true, 'd-5', 'd-5'],
  ]);
});

test('buildBulkLinkOffer: 액팅에서 연결하면 액팅 칸만 읽는다', () => {
  // 같은 uuid에 배경 링크가 따로 있어도 보지 않는다.
  const links = new Map([link('act-3', 'bg', 'G:\\bg\\other.psd'), link('act-5', 'acting', 'G:\\old\\A005.moho')]);
  const offer = buildBulkLinkOffer(scopeOf('act-1', 'acting', FILE), FILE, 'acting', links);
  assert.ok(offer);
  assert.deepEqual(
    offer.candidates.map((item) => `${item.sceneId} ${item.state}`),
    ['A003 empty', 'A005 replace', 'A007 empty', 'A002 empty'],
  );
  // 보탬(11.2의 목록 밖): 제안의 department는 넘긴 부서다(4.1).
  assert.equal(offer.department, 'acting');
});

test('상수 고정: BULK_LINK_DEFAULTS', () => {
  assert.deepEqual(BULK_LINK_DEFAULTS, { checkNamedReplace: true, offerLayoutOnly: true, checkLayoutOnly: false });
});

test('sameWorkPath: 다듬고 빗금과 대소문자를 맞춘 값이 비지 않았고 같다', () => {
  assert.equal(sameWorkPath('G:/a/B.moho', 'g:\\a\\b.MOHO '), true);
  assert.equal(sameWorkPath('', ''), false);
  assert.equal(sameWorkPath(null, 'x'), false);
  assert.equal(sameWorkPath(undefined, undefined), false);
});

// 실행 계획의 자료: 위 buildBulkLinkOffer 테스트의 제안과, 그 제안을 만든 첫 호출의 결과(씬 자료가 그대로일 때의 scope).
const firstScope = (): BulkLinkScope => scopeOf('bg-1', 'bg', FILE);
const firstOffer = (): BulkLinkOffer => {
  const offer = buildBulkLinkOffer(firstScope(), FILE, 'bg', LINKS);
  assert.ok(offer);
  return offer;
};

// 고른 것. bg-7은 상태가 same이라 고를 수 없는 줄이다 — 들어 있어도 무시한다.
const PICKED = ['bg-3', 'bg-5', 'bg-2', 'bg-7'];
const WRITE_A003: BulkLinkWrite = { sceneUuid: 'bg-3', sceneId: 'a003', before: null };
const WRITE_A005: BulkLinkWrite = { sceneUuid: 'bg-5', sceneId: 'a005', before: 'G:\\old\\a005.moho' };
const WRITE_A002: BulkLinkWrite = { sceneUuid: 'bg-2', sceneId: 'a002', before: 'G:\\old\\layout12.moho' };

const sceneByUuid = (part: Part, uuid: string): Scene => {
  const found = part.scenes.find((item) => item.id === uuid);
  assert.ok(found, uuid);
  return found;
};

// 그 사이 바뀐 씬 자료로 다시 찾은 묶음: 자료를 새로 만들어 배경 파트 A의 씬 하나만 고친 뒤 findBulkLinkScope를 다시 부른다.
const rescoped = (change: (part: Part) => void): BulkLinkScope | null => {
  const fresh = makeEpisodes();
  change(fresh[0].parts[0]);
  return findBulkLinkScope(fresh, 'bg-1', 'bg', FILE);
};

test('planBulkLink: 누르는 순간의 링크로 다시 본다 — 그대로면 쓰고, 이미 이 파일이면 same, 그 사이 달라졌으면 changed', () => {
  const offer = firstOffer();
  const scope = firstScope();
  // 링크가 창을 열 때와 같다.
  const unchanged = planBulkLink(offer, PICKED, LINKS, scope);
  assert.deepEqual(unchanged, { writes: [WRITE_A003, WRITE_A005, WRITE_A002], same: [], changed: [] });
  // 그 사이 bg-3에 다른 사람이 파일을 걸었다.
  const taken = planBulkLink(offer, PICKED, new Map([...LINKS, link('bg-3', 'bg', 'G:\\someone\\else.moho')]), scope);
  assert.deepEqual(taken.changed, ['a003']);
  assert.deepEqual(taken.writes, [WRITE_A005, WRITE_A002]);
  assert.deepEqual(taken.same, []);
  // 그 사이 bg-3이 이 파일이 됐다.
  const already = planBulkLink(offer, PICKED, new Map([...LINKS, link('bg-3', 'bg', FILE)]), scope);
  assert.deepEqual(already.same, ['a003']);
  assert.deepEqual(already.writes, [WRITE_A005, WRITE_A002]);
  assert.deepEqual(already.changed, []);
  // 고르지 않은 줄(bg-9)과 uuid 없는 줄(no:8:a010)은 어디에도 없다.
  for (const plan of [unchanged, taken, already]) {
    const touched = [...plan.writes.map((write) => write.sceneId), ...plan.same, ...plan.changed];
    assert.equal(touched.includes('a009'), false);
    assert.equal(touched.includes('a010'), false);
  }
});

test('planBulkLink: 그 사이 씬 자료가 바뀌었으면 — 더는 그 묶음의 그 씬이 아닌 줄은 쓰지 않는다', () => {
  const offer = firstOffer();
  // 링크는 창을 열 때 그대로다. 넷째 인자(scope)만 바뀐 자료로 다시 찾은 것이다.
  const planWith = (scope: BulkLinkScope | null): BulkLinkPlan => planBulkLink(offer, PICKED, LINKS, scope);

  // bg-3의 씬 번호가 a013이 됐다(이름 묶음에서 빠진다).
  const renumbered = rescoped((part) => { sceneByUuid(part, 'bg-3').sceneId = 'a013'; });
  assert.deepEqual(planWith(renumbered), { writes: [WRITE_A005, WRITE_A002], same: [], changed: ['a003'] });

  // bg-5의 씬 번호가 a011이 됐다 — 011도 파일 이름에 있어 uuid는 이름 묶음에 그대로 있지만 번호 글자가 다르다.
  const renumberedInList = rescoped((part) => { sceneByUuid(part, 'bg-5').sceneId = 'a011'; });
  assert.deepEqual(renumberedInList?.named.map((item) => item.id), ['bg-3', 'bg-7', 'bg-5']);
  assert.deepEqual(planWith(renumberedInList), { writes: [WRITE_A003, WRITE_A002], same: [], changed: ['a005'] });

  // bg-2의 레이아웃이 99가 됐다(레이아웃 묶음에서 빠진다).
  const otherLayout = rescoped((part) => { sceneByUuid(part, 'bg-2').layoutId = '99'; });
  assert.deepEqual(planWith(otherLayout), { writes: [WRITE_A003, WRITE_A005], same: [], changed: ['a002'] });

  // 연결한 씬 bg-1의 번호가 A003이 됐다 — bg-3은 이제 자기와 같은 번호라 이름 묶음에서 빠지고 레이아웃 묶음으로 옮겨 간다(묶음이 달라졌다).
  const movedGroup = rescoped((part) => { sceneByUuid(part, 'bg-1').sceneId = 'A003'; });
  assert.deepEqual(movedGroup?.layout.map((item) => item.id), ['bg-2', 'bg-3', 'bg-9', undefined]);
  assert.deepEqual(planWith(movedGroup), { writes: [WRITE_A005, WRITE_A002], same: [], changed: ['a003'] });

  // bg-3이 지워지고 그 번호 a003으로 다른 씬(uuid bg-3x)이 생겼다 — 번호 글자는 같지만 uuid가 다르다.
  const replaced = rescoped((part) => {
    part.scenes = part.scenes.filter((item) => item.id !== 'bg-3');
    part.scenes.push(scene('bg-3x', 9, 'a003'));
  });
  assert.deepEqual(replaced?.named.map((item) => `${item.id} ${item.sceneId}`), ['bg-3x a003', 'bg-5 a005', 'bg-7 A007']);
  assert.deepEqual(planWith(replaced), { writes: [WRITE_A005, WRITE_A002], same: [], changed: ['a003'] });

  // 연결한 씬 bg-1의 번호가 파일 이름에 없는 a021이 됐다 — 묶음은 그대로다(P4: 글자가 맞고 번호가 둘 이상인 목록은 자기 번호가 없어도 읽는다).
  const selfNotListed = rescoped((part) => { sceneByUuid(part, 'bg-1').sceneId = 'a021'; });
  assert.deepEqual(planWith(selfNotListed), { writes: [WRITE_A003, WRITE_A005, WRITE_A002], same: [], changed: [] });

  // 연결한 씬 bg-1의 번호가 b021이 됐다 — 글자가 달라져 파일 이름이 다른 씬들의 목록이 됐고, 다시 찾은 묶음이 null이다.
  const otherFamily = rescoped((part) => { sceneByUuid(part, 'bg-1').sceneId = 'b021'; });
  assert.equal(otherFamily, null);
  assert.deepEqual(planWith(otherFamily), { writes: [], same: [], changed: ['a003', 'a005', 'a002'] });
});

test('planBulkLink: scope는 기본값이 없는 인자다 — 빼먹고 부를 수 없다', () => {
  assert.equal(planBulkLink.length, 4);
});

// 보탬 자료(설계 11.2의 목록 밖): 4.7의 표 "창을 열 때 본 경로(currentPath)와 다르다 → changed". 11.2에서 그 사이 달라진 칸은 비어 있던 줄(a003)뿐이라, 비어 있던 줄에 파일이 생긴 것만 보는 구현을 가르지 못한다.
test('planBulkLink: 다른 파일이 걸려 있던 줄도 창을 열 때 본 경로와 달라졌으면 쓰지 않는다 — 또 다른 파일이 됐든, 비었든', () => {
  const offer = firstOffer();
  const scope = firstScope();
  const another = planBulkLink(offer, PICKED, new Map([...LINKS, link('bg-5', 'bg', 'G:\\newer\\a005.moho')]), scope);
  assert.deepEqual(another, { writes: [WRITE_A003, WRITE_A002], same: [], changed: ['a005'] });
  const cleared = planBulkLink(offer, PICKED, new Map([...LINKS].filter(([, item]) => item.sceneUuid !== 'bg-5')), scope);
  assert.deepEqual(cleared, { writes: [WRITE_A003, WRITE_A002], same: [], changed: ['a005'] });
});

// 보탬 자료(설계 11.2의 목록 밖): 4.7 "고른 후보마다, 후보의 순서대로 위에서부터". 11.2의 고른 것은 후보와 같은 순서이고, 묶음에서 빠진 줄이 그 사이 이 파일이 된 경우가 없어, 고른 순서를 따르거나 표의 둘째 줄(same)을 먼저 보는 구현을 가르지 못한다.
test('planBulkLink: 후보의 순서대로 쓰고(고른 순서가 아니다), 더는 그 묶음이 아닌 줄은 그 사이 이 파일이 됐어도 changed다', () => {
  const offer = firstOffer();
  // uuid 없는 줄의 열쇠가 고른 것에 들어 있어도 어디에도 없다.
  const reordered = planBulkLink(offer, ['no:8:a010', 'bg-2', 'bg-5', 'bg-3'], LINKS, firstScope());
  assert.deepEqual(reordered, { writes: [WRITE_A003, WRITE_A005, WRITE_A002], same: [], changed: [] });
  const renumbered = rescoped((part) => { sceneByUuid(part, 'bg-3').sceneId = 'a013'; });
  const gone = planBulkLink(offer, PICKED, new Map([...LINKS, link('bg-3', 'bg', FILE)]), renumbered);
  assert.deepEqual(gone, { writes: [WRITE_A005, WRITE_A002], same: [], changed: ['a003'] });
});

test('액팅에서 연결하면 액팅 칸만 읽고 쓴다: 실행 계획과 되돌리기 계획', () => {
  // 같은 uuid에 배경 링크가 따로 있어도 보지 않는다.
  const links = new Map([link('act-3', 'bg', 'G:\\bg\\other.psd'), link('act-5', 'acting', 'G:\\old\\A005.moho')]);
  const scope = scopeOf('act-1', 'acting', FILE);
  const offer = buildBulkLinkOffer(scope, FILE, 'acting', links);
  assert.ok(offer);
  assert.deepEqual(planBulkLink(offer, ['act-3', 'act-5'], links, scope).writes, [
    { sceneUuid: 'act-3', sceneId: 'A003', before: null },
    { sceneUuid: 'act-5', sceneId: 'A005', before: 'G:\\old\\A005.moho' },
  ]);
  const after = new Map([link('act-3', 'acting', FILE), link('act-3', 'bg', 'G:\\bg\\other.psd')]);
  assert.deepEqual(planBulkUndo([{ sceneUuid: 'act-3', sceneId: 'A003', before: null }], FILE, 'acting', after, 'me'), {
    steps: [{ kind: 'delete', sceneUuid: 'act-3', sceneId: 'A003' }],
    kept: [],
  });
});

test('planBulkUndo: 아직 이 동작이 쓴 칸만 되돌린다 — 비어 있던 씬은 다시 비우고, 바뀐 씬은 예전 파일로', () => {
  const writes = [WRITE_A003, WRITE_A005, WRITE_A002];
  // 링크의 고친 사람은 모두 'me'. bg-5는 그 뒤 다른 파일이 됐다.
  const links = new Map([link('bg-3', 'bg', FILE), link('bg-5', 'bg', 'G:\\other\\changed.moho'), link('bg-2', 'bg', FILE)]);
  assert.deepEqual(planBulkUndo(writes, FILE, 'bg', links, 'me'), {
    steps: [
      { kind: 'delete', sceneUuid: 'bg-3', sceneId: 'a003' },
      { kind: 'restore', sceneUuid: 'bg-2', sceneId: 'a002', path: 'G:\\old\\layout12.moho' },
    ],
    kept: ['a005'],
  });
  // 칸이 비어 있는 경우(그 뒤 풀렸다)도 손대지 않는다.
  assert.deepEqual(planBulkUndo(writes, FILE, 'bg', new Map(), 'me'), { steps: [], kept: ['a003', 'a005', 'a002'] });
});

test('planBulkUndo: 경로는 같은데 마지막으로 고친 사람이 다르면 손대지 않는다', () => {
  const writes = [WRITE_A003, WRITE_A005, WRITE_A002];
  const links = new Map([link('bg-3', 'bg', FILE, 'someone'), link('bg-5', 'bg', FILE, 'me'), link('bg-2', 'bg', FILE, null)]);
  assert.deepEqual(planBulkUndo(writes, FILE, 'bg', links, 'me'), {
    steps: [{ kind: 'restore', sceneUuid: 'bg-5', sceneId: 'a005', path: 'G:\\old\\a005.moho' }],
    kept: ['a003', 'a002'],
  });
  // 로그인한 사람이 없을 때(userId가 null)는 고친 사람이 null인 칸이 내 것이다. bg-2는 링크가 없다.
  const anonymous = new Map([link('bg-3', 'bg', FILE, null), link('bg-5', 'bg', FILE, null)]);
  assert.deepEqual(planBulkUndo(writes, FILE, 'bg', anonymous, null), {
    steps: [
      { kind: 'delete', sceneUuid: 'bg-3', sceneId: 'a003' },
      { kind: 'restore', sceneUuid: 'bg-5', sceneId: 'a005', path: 'G:\\old\\a005.moho' },
    ],
    kept: ['a002'],
  });
});

// 보탬 자료(설계 11.2의 목록 밖): 4.7 "그 칸의 경로가 sameWorkPath(지금, path)". 11.2의 되돌리기 자료에서 아직 이 파일인 칸은 경로의 글자까지 같아, 글자 그대로 견주는 구현을 가르지 못한다.
test('planBulkUndo: 빗금과 대소문자만 다른 경로는 아직 이 파일이다', () => {
  const links = new Map([link('bg-3', 'bg', 'g:/show/ep5/A 001,003,005,007,011.MOHO')]);
  assert.deepEqual(planBulkUndo([WRITE_A003], FILE, 'bg', links, 'me'), {
    steps: [{ kind: 'delete', sceneUuid: 'bg-3', sceneId: 'a003' }],
    kept: [],
  });
});

test('문구: BULK_LINK_TEXT의 열 값', () => {
  assert.deepEqual(BULK_LINK_TEXT, {
    title: '이 파일을 다른 씬에도 연결할까요?',
    named: '파일 이름에 적힌 씬',
    only: '이 씬만',
    pick: '연결할 씬을 골라 주세요',
    empty: '비어 있음',
    same: '이미 이 파일',
    unavailable: '아직 저장 중인 씬이라 연결할 수 없어요',
    replaceMark: '→ 이 파일로 바뀜',
    replaceMarkOff: '체크하면 이 파일로 바뀜',
    undoRecheckFailed: '연결 상태를 확인하지 못해서 아직 되돌리지 않았어요',
  });
});

test('문구: 안내 한 줄과 레이아웃 묶음의 머리글', () => {
  assert.equal(
    bulkLinkLead({ linkedSceneId: 'a001', department: 'bg' }),
    '방금 a001의 배경 대표 파일로 연결했어요. 아래에서 고른 씬에도 배경 대표 파일로 연결해요.',
  );
  assert.equal(
    bulkLinkLead({ linkedSceneId: 'a001', department: 'acting' }),
    '방금 a001의 액팅 대표 파일로 연결했어요. 아래에서 고른 씬에도 액팅 대표 파일로 연결해요.',
  );
  assert.equal(bulkLinkLayoutHeading('12'), '같은 레이아웃(#12)인 씬');
});

test('문구: 줄의 글자 조각 — replace 줄의 표시는 체크를 따르고, 경로 줄은 이름과 다를 때만', () => {
  assert.deepEqual(
    bulkLinkRowParts({ state: 'replace', currentPath: 'G:\\old\\a005.moho' }, true),
    { text: '지금: a005.moho', mark: '→ 이 파일로 바뀜', path: 'G:\\old\\a005.moho' },
  );
  // 체크가 풀려 있으면 mark만 다르다.
  assert.deepEqual(
    bulkLinkRowParts({ state: 'replace', currentPath: 'G:\\old\\a005.moho' }, false),
    { text: '지금: a005.moho', mark: '체크하면 이 파일로 바뀜', path: 'G:\\old\\a005.moho' },
  );
  // 경로가 이름뿐이면 경로 줄이 없다.
  assert.equal(bulkLinkRowParts({ state: 'replace', currentPath: 'a005.moho' }, true).path, null);
  // 폴더로 끝나는 경로면 이름 자리에 경로 전체가 온다.
  const folder = bulkLinkRowParts({ state: 'replace', currentPath: 'G:\\old\\folder\\' }, true);
  assert.equal(folder.text, '지금: G:\\old\\folder\\');
  assert.equal(folder.path, null);
  // 나머지 셋은 둘째 인자가 true든 false든 같다.
  for (const checked of [true, false]) {
    assert.deepEqual(bulkLinkRowParts({ state: 'empty', currentPath: null }, checked), { text: '비어 있음', mark: null, path: null });
    assert.deepEqual(
      bulkLinkRowParts({ state: 'same', currentPath: 'G:\\show\\EP5\\a 001,003,005,007,011.moho' }, checked),
      { text: '이미 이 파일', mark: null, path: null },
    );
    assert.deepEqual(
      bulkLinkRowParts({ state: 'unavailable', currentPath: null }, checked),
      { text: '아직 저장 중인 씬이라 연결할 수 없어요', mark: null, path: null },
    );
  }
});

test('문구: 없는 씬 줄, 연결한 씬이 바뀌었을 때, 다시 읽지 못했을 때', () => {
  assert.equal(bulkLinkNotFoundText(['a011', 'a013']), '파일 이름에는 있지만 이 파트에 없는 씬: a011, a013');
  assert.equal(bulkLinkSourceChangedText('a001'), '그 사이 a001의 파일이 바뀌어서 다른 씬에는 연결하지 않았어요');
  assert.equal(
    bulkLinkRecheckFailedText('a001'),
    '연결 상태를 확인하지 못해서 다른 씬에는 연결하지 않았어요. a001의 상세 창에서 대표 파일의 연필(수정) 버튼으로 같은 파일을 다시 저장하면 다시 물어봐요',
  );
});

test('문구: 버튼의 글자, 씬 번호 줄임, 파일이 바뀌는 씬의 수', () => {
  assert.equal(bulkLinkConfirmLabel(3), '선택한 3개에 연결');
  assert.equal(bulkLinkConfirmLabel(0), '연결할 씬을 골라 주세요');
  assert.equal(sceneIdList(['a003', 'a005', 'a007', 'a009']), 'a003, a005, a007 외 1개');
  assert.equal(bulkLinkReplaceNote(3), '이 중 3개는 지금 연결된 파일이 바뀌어요');
  assert.equal(bulkLinkReplaceNote(1), '이 중 1개는 지금 연결된 파일이 바뀌어요');
  assert.equal(bulkLinkReplaceNote(0), '');
});

// 보탬 자료(설계 11.2의 목록 밖): 7.3 "셋까지는 a003, a005, a007, 넘으면 … 외 1개". 11.2에는 꼭 셋인 목록이 없어 경계가 하나 어긋난 구현('외 0개')을 가르지 못하고, 둘째 인자 max를 넘긴 예도 없다.
test('문구: sceneIdList — 셋까지는 모두 적고, max를 넘기면 그 수까지만 적는다', () => {
  assert.equal(sceneIdList(['a003', 'a005', 'a007']), 'a003, a005, a007');
  assert.equal(sceneIdList(['a003', 'a005', 'a007'], 2), 'a003, a005 외 1개');
});

test('문구: 한꺼번에 연결의 결과 — 있는 조각만 잇는다', () => {
  assert.equal(bulkLinkResultText({ linked: ['a003', 'a005', 'a007'], failed: [], changed: [] }), '씬 3개에 연결했어요');
  assert.equal(
    bulkLinkResultText({ linked: ['a003'], failed: ['a005', 'a007'], changed: ['a009'] }),
    '씬 1개에 연결했어요 · 2개는 연결하지 못했어요(a005, a007) · 1개는 그 사이 바뀌어서 그대로 뒀어요(a009)',
  );
  assert.equal(
    bulkLinkResultText({ linked: [], failed: ['a003', 'a005', 'a007', 'a009'], changed: [] }),
    '4개는 연결하지 못했어요(a003, a005, a007 외 1개)',
  );
  assert.equal(bulkLinkResultText({ linked: [], failed: [], changed: [] }), '이미 모두 이 파일에 연결돼 있어요');
});

test('문구: 되돌리기의 결과 — 있는 조각만 잇는다', () => {
  assert.equal(bulkUndoResultText({ undone: ['a003', 'a005'], failed: [], kept: [] }), '씬 2개를 되돌렸어요');
  assert.equal(
    bulkUndoResultText({ undone: ['a003'], failed: ['a005'], kept: ['a007'] }),
    '씬 1개를 되돌렸어요 · 1개는 되돌리지 못했어요(a005) · 1개는 그 뒤에 바뀌어서 그대로 뒀어요(a007)',
  );
  assert.equal(bulkUndoResultText({ undone: [], failed: [], kept: [] }), '되돌릴 것이 없어요');
});
