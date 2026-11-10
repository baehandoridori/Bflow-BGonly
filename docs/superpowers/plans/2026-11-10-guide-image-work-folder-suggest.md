# 가이드 그림 작업 폴더 제안 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배경 씬 상세 창의 가이드 칸에 그림을 넣으면, 그 그림이 있는(또는 짐작한) 공유 드라이브 폴더를 그 씬의 배경 작업 폴더(와 대표 `.clip`)로 넣을지 아래에서 올라오는 창으로 묻고, 누르면 저장한다.

**Architecture:** 폴더 이름 읽기·후보 고르기·문구는 테스트 가능한 순수 함수(`src/shared/sharedDrivePath.ts`, `src/utils/guideFolderSuggest.ts`, `src/utils/guideFolderSuggestBuild.ts` — 비동기 부분은 의존성 주입)로 두고, 폴더 목록·클립보드 경로는 새 IPC 두 채널(`electron/workFolderSuggestIpc.ts`)로만 읽는다. 렌더러 서비스 `suggestGuideFolder` 가 두 씬 상세 창의 가이드 넣기 길에서 불려 제안을 만들고, 명령형 창 `GuideFolderSuggestSheet`(네이티브 `<dialog>`, `BulkWorkLinkDialog` 와 같은 틀)가 보여 주고 `useSceneWorkLinkStore.upsertLink` 로 저장한다.

**Tech Stack:** Electron 33 · React 18 · TypeScript · Tailwind · Zustand · sonner · node --test(타입 지우기 실행)

**Spec:** `docs/superpowers/specs/2026-11-10-guide-image-work-folder-suggest-design.md` (한솔 승인 2026-11-10). 실행자는 이 계획과 설계를 함께 읽는다. 절 번호(4.3, 5.2 …)는 설계 문서의 것이다.

## Global Constraints

- 렌더러는 파일 시스템·Supabase 에 직접 닿지 않는다: 렌더러 → IPC → 메인(CLAUDE.md 필수 규칙 5).
- DB 변경 없음. 저장은 기존 `useSceneWorkLinkStore.getState().upsertLink({ sceneUuid, department: 'bg', linkKind: 'folder' | 'primary_file', path, userId })` 만 쓴다. 이 창은 `saveWorkLinkPathGuarded` 를 거치지 않는다(설계 4.5).
- 공유 드라이브 루트는 `G:\공유 드라이브\` — 드라이브 글자 대소문자와 `/`·`\` 차이만 무시한다(설계 4.2-1).
- `clipboard:read-image-file`(main.ts:4509)은 고치지 않는다(AGENTS.md:154, `tests/backgroundMapEditorWiring.test.ts:3422-3427` 이 본문을 고정). 클립보드 파일 경로는 새 채널로 읽는다.
- 같은 화·파트의 씬 링크는 씬마다 한 건씩 읽지 않는다 — `loadForSceneUuids([...])` 한 번(메인이 80개씩 나눠 읽음).
- 움직임(CLAUDE.md v1.128.0): transform/opacity 만 움직이고, 흐림(`backdrop-filter`)은 정지된 겹 하나에만 쓰며 흐림 크기는 애니메이션하지 않는다. CSS 는 동작 줄이기 `@media (prefers-reduced-motion: reduce)` 규칙만 쓰고(빌드가 '최소' 짝을 만든다), '최소'를 JS 로 볼 땐 `useMotionPref().reduce`. 줄이기에서는 흐림·어둡게는 그대로, 시트 올라옴·흔들림만 없앤다(설계 5.3).
- 긍정 버튼은 `bg-accent text-on-accent`, 마우스 올림은 `hover:bg-[color-mix(in_srgb,rgb(var(--color-accent))_86%,white)]` — `bg-accent-sub` 금지(설계 5.1).
- 창 문구는 설계 5.2 표의 글자 그대로(Task 1 의 `GUIDE_FOLDER_TEXT` 한 곳에 둔다).
- 테스트가 직접 import 하는 파일은 상대 경로 + `.ts` 확장자만, 런타임 `@/` import 금지. 새 `tests/*.test.ts` 는 package.json `test:scene-links` 에 등록한다(`tests/testScriptRegistration.test.ts` 가 검사).
- 기존 소스는 CRLF 일 수 있다 — 글자를 읽는 배선 테스트는 `readFileSync(...).replace(/\r\n/g, '\n')`.
- 화면 확인은 앱 엔진(Electron 33, Chromium 130)으로, 한솔 PC 화면에 보이는 창을 띄우지 않는다(`show:false` + offscreen 하니스).
- 커밋 메시지는 한글, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 버전 v1.150.0 (package.json, package-lock.json 두 곳, `DEVLOG/update-notes.json`). PR 머지 직전 main 버전을 다시 확인한다.

## Review Focus

1. **씬을 넘긴 뒤 Ctrl+V** — 상세 창의 window `paste` 구독은 씬이 바뀌어도 다시 걸리지 않는다(U:702 주석). 가이드 제안이 이전 씬 uuid 로 가면 엉뚱한 씬에 폴더가 들어간다. → Task 6 배선 테스트가 "paste 핸들러는 ref 로 지금 씬 uuid 를 읽는다"를 고정.
2. **내 저장이 '실시간 같은 값' 판정을 부른다** — `upsertLink` 는 낙관적이라 저장 즉시 칸이 새 값이 되고, 그걸 '다른 사람이 같은 값으로 바꿈 → 조용히 닫기'로 오해하면 성공 알림·빛남이 사라진다. → Task 2 `reconcileCurrentFolder` 단위 테스트 + Task 5 배선 테스트(저장 중·저장 뒤엔 다시 판정하지 않음).
3. **Esc·Tab 끝 키·붙여넣기가 뒤 상세 창에 샘** — 창이 닫히거나 씬이 넘어간다(tasks/lessons.md v1.134.0). → Task 5 배선 테스트: window 캡처 단계 keydown·paste 멈춤, `onCancel` preventDefault, 바깥 누름 닫기 없음.
4. **구글 드라이브가 느리거나 끊김** — 목록 읽기가 멈추면 창이 영영 안 뜨는 건 괜찮지만, 늦게 끝난 옛 판정이 새 그림 뒤에 뜨면 안 된다. → Task 3 시간 제한 테스트(끝나지 않는 readDir → null), Task 6 배선 테스트(요청 번호로 옛 결과 버림).
5. **'한꺼번에 연결'이 조용히 건너뜀** — `offerBulkWorkLink` 는 `dialog[open]` 이 있으면 묻지 않는다. 제안 창이 닫히기 전에 부르면 절대 안 뜬다. → Task 5 배선 테스트: `offerBulkWorkLink` 호출이 `dialog.close()` 뒤에 온다.

---

### Task 1: 공유 드라이브 경로와 폴더 이름 규칙(순수 함수)

**Files:**
- Create: `src/shared/sharedDrivePath.ts`
- Create: `src/utils/guideFolderSuggest.ts`
- Test: `tests/guideFolderSuggest.test.ts`
- Modify: `package.json` (`test:scene-links` 끝에 ` ./tests/guideFolderSuggest.test.ts`)

**Interfaces:**
- Consumes: `readSceneNameLists`, `sceneListForScene`, `sceneFamily`, `sceneRefKey`, `refKey` from `src/utils/sceneFileNameList.ts`
- Produces:
  - `src/shared/sharedDrivePath.ts` (import 없음 — 메인도 `'../src/shared/sharedDrivePath'` 로 쓴다):
    - `export const SHARED_DRIVE_ROOT = 'G:\\공유 드라이브\\';`
    - `export function normalizeWinPath(path: string): string` — trim, `/`→`\`, 연속 `\` 하나로, 끝 `\` 제거(단 `G:\` 같은 드라이브 루트는 그대로)
    - `export function isSharedDrivePath(path: string): boolean` — 정규화 뒤 대소문자 무시로 루트로 시작하고 루트 뒤에 글자가 더 있다
  - `src/utils/guideFolderSuggest.ts`:
    - `export type GuideImageMethod = 'drop' | 'pick' | 'paste';`
    - `export interface GuideSceneRef { sceneId: string; partId: string }`
    - `export function samePath(a?: string | null, b?: string | null): boolean` — `normalizeWinPath` 뒤 소문자 비교, 빈 값끼리는 false
    - `export function parentPath(path: string): string | null`, `leafName(path: string): string`, `joinPath(dir: string, name: string): string`
    - `export function folderSceneKeys(folderName: string, scene: GuideSceneRef): string[] | null`
    - `export function resolveFolderFromImagePath(imagePath: string, scene: GuideSceneRef): { folder: string; mismatch: boolean } | null`
    - `export function pickPartFolder(folders: string[], partId: string): string | null`
    - `export function pickBackgroundRoot(folders: string[]): string | null`
    - `export function findPartFolderName(names: string[], partId: string): string | null`
    - `export function matchSceneFolders(names: string[], scene: GuideSceneRef): string[]`
    - `export function pickClipFile(names: string[], scene: GuideSceneRef): string | null`
    - `export function displayPathParts(path: string): { head: string[]; leaf: string }`
    - `export const GUIDE_FOLDER_TEXT` 와 `guideFolderTitle(mode: 'new' | 'change', guessed: boolean): string`, `guideFolderSourceLine(input: { method: GuideImageMethod; fileName: string | null; guessed: boolean }): string`, `guideFolderMismatchText(sceneId: string): string`

- [ ] **Step 0: 작업 준비 — 의존성 연결**

이 워크트리에는 `node_modules` 가 없다. `package-lock.json` 해시가 같은 다른 워크트리를 찾아 junction 으로 잇는다(예 후보: `C:\Bflow-BGonly\.claude\worktrees\bflow-scene-comments-b-plan-896f04`).

```powershell
(Get-FileHash .\package-lock.json).Hash; (Get-FileHash C:\Bflow-BGonly\.claude\worktrees\<후보>\package-lock.json).Hash
cmd /c mklink /J node_modules C:\Bflow-BGonly\.claude\worktrees\<후보>\node_modules
```
Expected: 해시 같음, `Junction created`. 해시가 다르면 의존성 목록(dependencies)이 같은지 비교하고 같은 후보를 고른다. **지울 땐 `cmd /c rmdir node_modules` 만** — `rm -rf`·`git worktree remove --force` 는 링크를 따라 들어가 원본을 지운다.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `tests/guideFolderSuggest.test.ts`

실제 드라이브 이름(설계 4.4)을 그대로 쓴다. `D` = `'G:\\공유 드라이브\\사우스 코리안 파크\\241_싱크홀 대축제\\배경_싱크홀'`, `scene = (id: string) => ({ sceneId: id, partId: 'D' })`.

```ts
test('isSharedDrivePath: 루트·대소문자·슬래시', () => {
  assert.equal(isSharedDrivePath(`${D}\\d파트\\d054\\d054가이드.png`), true);
  assert.equal(isSharedDrivePath('g:/공유 드라이브/사우스 코리안 파크/x.png'), true);
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\'), false);
  assert.equal(isSharedDrivePath('C:\\Users\\me\\Desktop\\d054가이드.png'), false);
  assert.equal(isSharedDrivePath('G:\\내 드라이브\\d054.png'), false);
});
test('samePath: 끝 역슬래시·대소문자·슬래시 무시', () => {
  assert.equal(samePath(`${D}\\d파트\\d054\\`, `${D.toLowerCase()}/d파트/d054`), true);
  assert.equal(samePath('', ''), false);
});
test('folderSceneKeys: . 과 , 를 나눔표로, 이 씬 가족 글자 목록만', () => {
  assert.deepEqual(folderSceneKeys('d050.052', scene('d052')), ['50', '52']);
  assert.deepEqual(folderSceneKeys('d013,015', scene('d013')), ['13', '15']);
  assert.deepEqual(folderSceneKeys('d022.024a', scene('d024a')), ['22', '24A']);
  assert.deepEqual(folderSceneKeys('D054', scene('d054')), ['54']);
  assert.equal(folderSceneKeys('png', scene('d054')), null);
  assert.equal(folderSceneKeys('png_052', scene('d052')), null);
  assert.equal(folderSceneKeys('d파트', scene('d054')), null);
  assert.equal(folderSceneKeys('241_싱크홀 대축제', scene('d241')), null);
});
test('resolveFolderFromImagePath: 바로 위 폴더, 번호 불일치 경고, 거슬러 오르기', () => {
  assert.deepEqual(resolveFolderFromImagePath(`${D}\\d파트\\d054\\d054가이드.png`, scene('d054')), { folder: `${D}\\d파트\\d054`, mismatch: false });
  assert.deepEqual(resolveFolderFromImagePath(`${D}\\d파트\\d054\\d054가이드.png`, scene('d055')), { folder: `${D}\\d파트\\d054`, mismatch: true });
  assert.deepEqual(resolveFolderFromImagePath(`${D}\\d파트\\d050.052\\png\\x.png`, scene('d052')), { folder: `${D}\\d파트\\d050.052`, mismatch: false });
  assert.equal(resolveFolderFromImagePath(`${D}\\d파트\\x.png`, scene('d054')), null);
  assert.equal(resolveFolderFromImagePath(`${D}\\디자인 및 래퍼런스\\a\\b\\x.png`, scene('d054')), null);
  assert.equal(resolveFolderFromImagePath('C:\\Users\\me\\d054\\x.png', scene('d054')), null);
});
test('pickPartFolder: 위 폴더가 {파트}파트 인 것만, 가장 많은 것', () => {
  const ok = (n: string) => `${D}\\d파트\\${n}`;
  assert.equal(pickPartFolder([ok('d054'), ok('d055'), `${D}\\b파트\\b003`], 'D'), `${D}\\d파트`);
  assert.equal(pickPartFolder([`${D}\\b파트\\b003`], 'D'), null);
  assert.equal(pickPartFolder([`${D}\\D파트\\d054`], 'd'), `${D}\\D파트`);
});
test('pickBackgroundRoot / findPartFolderName', () => {
  assert.equal(pickBackgroundRoot([`${D}\\b파트\\b048`, `${D}\\b파트\\b060`]), D);
  assert.equal(pickBackgroundRoot([`${D}\\프랍\\떨어지는구조물`]), null);
  assert.equal(findPartFolderName(['a파트', 'D파트', '프랍'], 'd'), 'D파트');
});
test('matchSceneFolders: 이 씬이 든 폴더, 이름에 든 씬 수 적은 순 → 이름순', () => {
  const names = ['d028.043.046', 'd043.046', 'd040', 'png', 'd022.024a', 'd021.024.029'];
  assert.deepEqual(matchSceneFolders(names, scene('d043')), ['d043.046', 'd028.043.046']);
  assert.deepEqual(matchSceneFolders(names, scene('d024')), ['d021.024.029']);
  assert.deepEqual(matchSceneFolders(names, scene('d024a')), ['d022.024a']);
  assert.deepEqual(matchSceneFolders(names, scene('d099')), []);
});
test('pickClipFile: 하나뿐 / 번호 맞는 것 딱 하나 / 그 밖 null', () => {
  assert.equal(pickClipFile(['d054.clip', 'd054.png', 'd054가이드.png'], scene('d054')), 'd054.clip');
  assert.equal(pickClipFile(['d050.clip', 'd052.clip', 'd052_가이드.png'], scene('d052')), 'd052.clip');
  assert.equal(pickClipFile(['전체가이드.clip', '전체.clip'], scene('d045')), null);
  assert.equal(pickClipFile(['D054.CLIP'], scene('d054')), 'D054.CLIP');
  assert.equal(pickClipFile([], scene('d054')), null);
});
test('displayPathParts: 루트를 빼고 마지막 폴더를 따로', () => {
  assert.deepEqual(displayPathParts(`${D}\\d파트\\d054`), { head: ['사우스 코리안 파크', '241_싱크홀 대축제', '배경_싱크홀', 'd파트'], leaf: 'd054' });
});
test('문구: 설계 5.2 그대로', () => {
  assert.equal(guideFolderTitle('new', false), '이 그림이 있는 폴더를 작업 폴더로 넣을까요?');
  assert.equal(guideFolderTitle('new', true), '이 씬의 작업 폴더를 찾았어요');
  assert.equal(guideFolderTitle('change', true), '작업 폴더를 이 폴더로 바꿀까요?');
  assert.equal(guideFolderSourceLine({ method: 'drop', fileName: 'd054가이드.png', guessed: false }), '끌어다 놓은 그림 · d054가이드.png');
  assert.equal(guideFolderSourceLine({ method: 'pick', fileName: 'a.png', guessed: false }), '고른 그림 · a.png');
  assert.equal(guideFolderSourceLine({ method: 'paste', fileName: null, guessed: true }), '붙여넣은 그림이라 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.');
  assert.equal(guideFolderSourceLine({ method: 'drop', fileName: null, guessed: true }), '끌어다 놓은 그림에 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.');
  assert.equal(guideFolderMismatchText('d055'), '폴더 이름에 이 씬 번호(d055)가 없어요. 같은 배경을 같이 쓰는 씬이면 그대로 넣어도 돼요.');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test ./tests/guideFolderSuggest.test.ts`
Expected: FAIL — 모듈을 찾지 못함.

- [ ] **Step 3: 구현** — 위 Interfaces 의 두 파일

알고리즘이 시그니처로 정해지지 않는 둘만 적는다.

```ts
// folderSceneKeys — 폴더 이름엔 확장자가 없으니 '.'도 나눔표. 이 씬 가족 글자로 시작하는 목록만 씬 번호로 본다(글자 없는 241, 다른 글자 png_052 제외).
const family = sceneFamily(scene.sceneId, scene.partId);
if (!family) return null;
const lists = readSceneNameLists(folderName.replace(/\./g, ','))
  .filter((list) => list.prefix !== '' && (list.prefix === family || list.prefix === family.slice(0, 1)));
if (lists.length === 0) return null;
return [...new Set(lists.flatMap((list) => list.refs.map(refKey)))];

// resolveFolderFromImagePath — 바로 위 폴더부터 최대 두 단계 더(폴더 셋) 올라가며 씬 번호가 든 첫 폴더. 루트 밖으로 나가면 멈춤.
let folder = parentPath(imagePath);
for (let climb = 0; climb <= 2 && folder && isSharedDrivePath(folder); climb += 1) {
  const keys = folderSceneKeys(leafName(folder), scene);
  if (keys) return { folder, mismatch: !keys.includes(sceneRefKey(scene.sceneId, sceneFamily(scene.sceneId, scene.partId) ?? '') ?? '') };
  folder = parentPath(folder);
}
return null;
```

- `pickPartFolder`: `parentPath(f)` 의 `leafName` 을 소문자로 `${partId.toLowerCase()}파트` 와 견줘 맞는 것만 센다(`samePath` 기준으로 묶음). 가장 많은 것, 같으면 정규화한 문자열이 작은 것. 처음 나온 원래 글자 그대로 돌려준다. `pickBackgroundRoot` 는 같은 방식으로 위 폴더 이름이 `/^[a-z]파트$/i` 인 것의 두 단계 위를 센다.
- `matchSceneFolders`: `folderSceneKeys(name, scene)` 에 이 씬 열쇠가 든 이름만, `keys.length` 오름차순 → 이름 소문자 오름차순.
- `pickClipFile`: 확장자 `.clip`(대소문자 무시) 만. 하나면 그것. 여럿이면 `sceneListForScene(name, scene)` 의 `refs` 에 이 씬 열쇠가 든 것이 정확히 하나일 때 그것(기존 규칙 그대로 — `.` 를 바꾸지 않는다, 설계 4.4).
- 문구는 설계 5.2 표를 `GUIDE_FOLDER_TEXT` 객체 하나에 모은다: `titleNew`, `titleChange`, `titleFound`, `sourcePrefix: { drop: '끌어다 놓은 그림', pick: '고른 그림', paste: '붙여넣은 그림' }`, `guessedPaste`, `guessedDrop`, `candidatesNote: '이름에 이 씬만 든 폴더를 먼저 골라 뒀어요'`, `clipLabel: '대표 파일로도 연결'`, `current: '지금'`, `next: '새 폴더'`, `addNew: '작업 폴더에 넣기'`, `addChange: '바꾸기'`, `skipNew: '건너뛰기'`, `skipChange: '그대로 두기'`, `openFolder: '폴더 열어 보기'`, `saving: '저장 중'`, `retry: '다시 시도'`, `saveFailed: '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'`, `savedNew: '작업 폴더를 넣었어요'`, `savedChange: '작업 폴더를 바꿨어요'`, `openFailed: '이 PC에서 폴더를 찾을 수 없음'`. 제목 우선순위: `change` → `titleChange`, 아니고 `guessed` → `titleFound`, 그 밖 `titleNew`.

- [ ] **Step 4: 통과 확인**

Run: `node --test ./tests/guideFolderSuggest.test.ts`
Expected: PASS (전부).

- [ ] **Step 5: 커밋**

```bash
git add src/shared/sharedDrivePath.ts src/utils/guideFolderSuggest.ts tests/guideFolderSuggest.test.ts package.json
git commit -m "가이드 작업 폴더 제안: 공유 드라이브 경로·폴더 이름 규칙 순수 함수"
```

---

### Task 2: 제안 만들기(의존성 주입 비동기 함수)

**Files:**
- Create: `src/utils/guideFolderSuggestBuild.ts`
- Test: `tests/guideFolderSuggestBuild.test.ts`
- Modify: `package.json` (`test:scene-links` 에 추가)

**Interfaces:**
- Consumes: Task 1 의 함수 전부, `isSharedDrivePath`
- Produces:
```ts
export interface GuideFolderCandidate { folder: string; clip: string | null }   // clip 은 전체 경로
export interface GuideFolderSuggestion {
  sceneUuid: string;
  sceneId: string;                 // 표시·경고용, 예 'd054'
  method: GuideImageMethod;
  fileName: string | null;
  guessed: boolean;                // 경로 없이 짐작했나
  candidates: GuideFolderCandidate[];   // 1개 이상, Task 1 정렬 순서
  mismatch: boolean;               // 경로 길에서만 참일 수 있다
  currentFolder: string | null;    // 있으면 '바꾸기' 모양
  offerClip: boolean;              // 만들 때 대표 파일 칸이 비어 있었나
}
export interface GuideFolderRequest {
  sceneUuid: string; scene: GuideSceneRef; method: GuideImageMethod;
  imagePath: string;               // 모르면 ''
  fileName: string | null;
  partSceneUuids: string[];        // 같은 파트의 다른 씬(자기 제외)
  otherBgPartSceneUuids: string[]; // 같은 화의 다른 배경 파트 씬
}
export interface GuideFolderDeps {
  listDir(dir: string, kind: 'dirs' | 'files'): Promise<string[] | null>;
  loadLinks(sceneUuids: string[]): Promise<boolean>;   // 제때 읽었으면 true
  bgSlots(sceneUuid: string): { folder: string | null; primaryFile: string | null };
}
export async function buildGuideFolderSuggestion(req: GuideFolderRequest, deps: GuideFolderDeps): Promise<GuideFolderSuggestion | null>;
export function suggestionMode(s: Pick<GuideFolderSuggestion, 'currentFolder'>): 'new' | 'change';
/** 실시간으로 바뀐 지금 작업 폴더를 반영. 후보 중 하나와 같아지면 null(조용히 닫기). */
export function reconcileCurrentFolder(s: GuideFolderSuggestion, current: string | null): GuideFolderSuggestion | null;
```

- [ ] **Step 1: 실패하는 테스트 쓰기** — `tests/guideFolderSuggestBuild.test.ts`

가짜 의존성: `tree: Record<string, string[]>`(키 = `dirs:<경로>` / `files:<경로>`), `slots: Record<uuid, {folder, primaryFile}>`, `loadOk = true`. 경로 키는 `samePath` 로 찾는다.

```ts
test('경로 길: 작업 폴더 비어 있음 → 새로 넣기 + clip', async () => {
  const s = await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\d054가이드.png`, fileName: 'd054가이드.png' }), deps({ files: { [`${D}\\d파트\\d054`]: ['d054.clip', 'd054.png'] } }));
  assert.deepEqual(s?.candidates, [{ folder: `${D}\\d파트\\d054`, clip: `${D}\\d파트\\d054\\d054.clip` }]);
  assert.equal(s?.guessed, false); assert.equal(s?.currentFolder, null); assert.equal(s?.offerClip, true); assert.equal(suggestionMode(s!), 'new');
});
test('경로 길: 같은 폴더가 이미 있으면 null (대표 파일이 비어 있어도)', async () => {
  assert.equal(await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\g.png` }), deps({ slots: { self: { folder: `${D}\\D파트\\d054\\`, primaryFile: null } } })), null);
});
test('경로 길: 다른 폴더가 있으면 바꾸기, 대표 파일 있으면 offerClip false', async () => {
  const s = await buildGuideFolderSuggestion(req({ imagePath: `${D}\\d파트\\d054\\g.png` }), deps({ slots: { self: { folder: `${D}\\d파트\\d050.052`, primaryFile: 'x.clip' } } }));
  assert.equal(suggestionMode(s!), 'change'); assert.equal(s?.offerClip, false); assert.equal(s?.candidates[0].clip, null);
});
test('경로 길: 공유 드라이브 밖이면 null, 목록을 읽지 않는다', async () => { /* listDir 호출 0회 */ });
test('짐작 길: 같은 파트 저장 경로 → 파트 폴더 → 후보 둘, 짧은 이름 먼저', async () => {
  const s = await buildGuideFolderSuggestion(
    req({ scene: { sceneId: 'd043', partId: 'D' }, imagePath: '', method: 'paste', partSceneUuids: ['s1', 's2'] }),
    deps({ slots: { s1: { folder: `${D}\\d파트\\d054`, primaryFile: null }, s2: { folder: `${D}\\b파트\\b003`, primaryFile: null } },
           dirs: { [`${D}\\d파트`]: ['d028.043.046', 'd043.046', 'd054'] } }),
  );
  assert.deepEqual(s?.candidates.map((c) => c.folder), [`${D}\\d파트\\d043.046`, `${D}\\d파트\\d028.043.046`]);
  assert.equal(s?.guessed, true);
});
test('짐작 길: 같은 파트에 없으면 다른 배경 파트로 배경 폴더 → d파트 찾기', async () => { /* otherBgPartSceneUuids 의 b파트 경로 + dirs[D] = ['a파트','d파트'] → 후보 생김 */ });
test('짐작 길: 링크 읽기 실패·후보 0개·파트 폴더 없음이면 null', async () => { /* 세 경우 */ });
test('reconcileCurrentFolder: 후보와 같아지면 null, 다르면 바꾸기로', () => {
  const s = { ...base, currentFolder: null };
  assert.equal(reconcileCurrentFolder(s, `${D}\\d파트\\d054`), null);
  assert.equal(reconcileCurrentFolder(s, `${D}\\d파트\\d060`)?.currentFolder, `${D}\\d파트\\d060`);
  assert.equal(reconcileCurrentFolder(s, null), s);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/guideFolderSuggestBuild.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — 순서(설계 4.2·4.3·4.5·4.6):
  1. `await deps.loadLinks([req.sceneUuid])` — 결과는 무시하고 진행(창이 저장 순간 다시 확인한다).
  2. `imagePath` 가 있으면: `isSharedDrivePath` 아니면 null → `resolveFolderFromImagePath` → 없으면 null → 후보 하나, `mismatch` 반영. **목록 읽기 없음.**
  3. `imagePath` 가 없으면(짐작): 참고할 uuid 가 없으면 null. `loadLinks([...partSceneUuids, ...otherBgPartSceneUuids])` 가 false 면 null. `pickPartFolder(같은 파트 folder 들, partId)` → 없으면 `pickBackgroundRoot(다른 파트 folder 들)` → `listDir(root, 'dirs')` → `findPartFolderName` → `joinPath`. 파트 폴더가 없거나 `listDir(partFolder, 'dirs')` 가 null 이면 null. `matchSceneFolders` 가 비면 null.
  4. `bgSlots(self)`: 작업 폴더가 있고 후보 중 하나와 `samePath` 면 null. 있으면 `currentFolder` 에 넣는다.
  5. 대표 파일 칸이 비었으면 `offerClip = true` 이고 후보마다 `listDir(folder, 'files')` → `pickClipFile` → `joinPath`. 읽기 실패면 그 후보 `clip: null`.

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/guideFolderSuggestBuild.test.ts` → PASS

- [ ] **Step 5: 커밋** — `git commit -m "가이드 작업 폴더 제안: 경로 길·짐작 길 제안 만들기"`

---

### Task 3: 메인 프로세스 통로(폴더 목록·클립보드 경로)

**Files:**
- Create: `electron/workFolderSuggestIpc.ts` (런타임 import 없음 — 테스트가 직접 import)
- Modify: `electron/main.ts` (등록 한 줄 + import 둘), `electron/preload.ts` (두 함수), `src/types/index.ts` (`ElectronAPI` 1058 부근에 두 선택 멤버), `src/mocks/devElectronAPI.ts` (mockAPI 2847 부근)
- Test: `tests/workFolderSuggestIpc.test.ts` (+ `test:scene-links` 등록)

**Interfaces:**
- Produces:
```ts
// electron/workFolderSuggestIpc.ts
export const WORK_FOLDER_LIST_TIMEOUT_MS = 3000;
export const WORK_FOLDER_CHANNELS = { clipboardImagePath: 'work-folder:clipboard-image-path', listDir: 'work-folder:list-dir' } as const;
export interface WorkFolderSuggestIpcDeps {
  ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void };
  readClipboardFilePath(): string | null;
  readDir(dir: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  isAllowedPath(path: string): boolean;
  timeoutMs?: number;
}
export function registerWorkFolderSuggestIpc(deps: WorkFolderSuggestIpcDeps): void;
// 렌더러(ElectronAPI, 둘 다 선택 멤버)
workFolderClipboardImagePath?: () => Promise<string | null>;
workFolderListDir?: (dir: string, kind: 'dirs' | 'files') => Promise<string[] | null>;
```

- [ ] **Step 1: 실패하는 테스트** — 가짜 `ipc` 가 핸들러를 모은다.

```ts
test('list-dir: 허용 경로만, dirs/files 나눠, 이름순', async () => {
  const h = register({ readDir: async () => [dir('d054'), file('a.clip'), dir('d043.046')], isAllowedPath: (p) => p.startsWith('G:') });
  assert.deepEqual(await h['work-folder:list-dir'](null, 'G:\\x', 'dirs'), ['d043.046', 'd054']);
  assert.deepEqual(await h['work-folder:list-dir'](null, 'G:\\x', 'files'), ['a.clip']);
  assert.equal(await h['work-folder:list-dir'](null, 'C:\\x', 'dirs'), null);
  assert.equal(await h['work-folder:list-dir'](null, 42, 'dirs'), null);
  assert.equal(await h['work-folder:list-dir'](null, 'G:\\x', 'all'), null);
});
test('list-dir: 시간 제한을 넘기면 null', async () => {
  const h = register({ readDir: () => new Promise(() => {}), isAllowedPath: () => true, timeoutMs: 20 });
  assert.equal(await h['work-folder:list-dir'](null, 'G:\\x', 'dirs'), null);
});
test('list-dir: readDir 오류는 null', async () => { /* reject → null */ });
test('clipboard-image-path: 그대로 돌려주고 오류는 null', async () => { /* 값 / throw → null */ });
test('배선: main 이 등록하고 clipboard:read-image-file 본문은 그대로', () => {
  const main = read('electron/main.ts');
  assert.ok(main.includes('registerWorkFolderSuggestIpc({'));
  assert.ok(main.includes("from '../src/shared/sharedDrivePath'"));
  const preload = read('electron/preload.ts');
  assert.ok(preload.includes("ipcRenderer.invoke('work-folder:list-dir', dir, kind)"));
  assert.ok(preload.includes("ipcRenderer.invoke('work-folder:clipboard-image-path')"));
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/workFolderSuggestIpc.test.ts` → FAIL

- [ ] **Step 3: 구현**
  - 모듈: `list-dir` 은 `typeof dir === 'string'`, `kind` 가 `'dirs' | 'files'`, `isAllowedPath(dir)` 아니면 null. `Promise.race([readDir, 시간 제한])`, 오류·시간 넘김은 `console.warn` 뒤 null. 이름은 `localeCompare` 정렬.
  - main.ts: `import { registerWorkFolderSuggestIpc } from './workFolderSuggestIpc'; import { isSharedDrivePath } from '../src/shared/sharedDrivePath';` 그리고 다른 `ipcMain.handle` 등록 근처에서 `registerWorkFolderSuggestIpc({ ipc: ipcMain, readClipboardFilePath: () => clipboardImageFilePath((format) => clipboard.readBuffer(format)), readDir: (dir) => fs.promises.readdir(dir, { withFileTypes: true }), isAllowedPath: isSharedDrivePath });` (main.ts:2581 과 같은 클립보드 읽기).
  - preload: 위 두 invoke. types: 두 선택 멤버.
  - mock: 예시 폴더 구조(설계 4.4 의 d파트 실제 이름 일부 + `d054` 안 `['d054.clip','d054.png','d054가이드.png']`, `d050.052` 안 `['d050.clip','d052.clip']`)를 담은 객체에서 `samePath` 식으로 찾아 돌려준다. `workFolderClipboardImagePath` 는 `(window as DevPreviewWindow).__bflowMockGuideClipboardPath ?? null` — 미리보기에서 콘솔로 탐색기 복사를 흉내 낸다(타입에 그 필드 추가).

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/workFolderSuggestIpc.test.ts ./tests/backgroundMapEditorWiring.test.ts && npm run typecheck` → PASS

- [ ] **Step 5: 커밋** — `git commit -m "가이드 작업 폴더 제안: 공유 드라이브 폴더 목록·클립보드 경로 통로"`

---

### Task 4: 개인 설정 스위치

**Files:**
- Modify: `src/services/settingsService.ts` (`UserPreferences` 72-207 에 `guideFolderSuggestEnabled?: boolean;` + 주석 "가이드 그림을 넣을 때 작업 폴더 제안. 없으면 켜짐")
- Create: `src/components/settings/SceneLinkSection.tsx`
- Modify: `src/views/SettingsView.tsx:87-88` (`case 'startup'` 을 `<div className="flex flex-col gap-6"><StartupSection /><SceneLinkSection /></div>` 로 — `case 'compositor'` 93-99 선례)
- Test: `tests/guideFolderSuggestWiring.test.ts` (이 Task 에서 만들고 Task 5·6 이 덧붙인다, `test:scene-links` 등록)

**Interfaces:**
- Produces: `export async function isGuideFolderSuggestEnabled(): Promise<boolean>` in `src/services/settingsService.ts` — `(await loadPreferences())?.guideFolderSuggestEnabled ?? true`, 읽기 실패면 true.

- [ ] **Step 1: 실패하는 배선 테스트**

```ts
test('설정: 스위치 문구와 저장 키', () => {
  const section = read('src/components/settings/SceneLinkSection.tsx');
  assert.ok(section.includes('가이드 그림을 넣을 때 작업 폴더 제안'));
  assert.ok(section.includes('role="switch"') && section.includes('aria-checked'));
  assert.ok(section.includes('guideFolderSuggestEnabled'));
  assert.ok(read('src/services/settingsService.ts').includes('guideFolderSuggestEnabled?: boolean'));
  assert.ok(read('src/views/SettingsView.tsx').includes('<SceneLinkSection />'));
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts` → FAIL

- [ ] **Step 3: 구현** — 섹션 제목 '씬 작업 링크', 줄 이름 '가이드 그림을 넣을 때 작업 폴더 제안', 설명 '가이드 칸에 공유 드라이브 그림을 넣으면 그 그림이 있는 폴더를 작업 폴더로 넣을지 물어봐요'. 처음 값 `prefs?.guideFolderSuggestEnabled ?? true`. 바꾸면 화면 먼저 → `savePreferences({ ...(await loadPreferences()), guideFolderSuggestEnabled: next })` → false 면 되돌리고 `toast.error('설정을 저장하지 못했어요')`. 스위치는 `role="switch" aria-checked`(SceneSheetView.tsx:804 패턴). 서비스가 매번 새로 읽으므로 창 사이 방송은 하지 않는다.

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts && npm run typecheck` → PASS

- [ ] **Step 5: 커밋** — `git commit -m "가이드 작업 폴더 제안: 설정 스위치"`

---

### Task 5: 제안 창(아래에서 올라오는 시트) + 저장 + 칸 빛남

**Files:**
- Create: `src/components/scenes/GuideFolderSuggestSheet.tsx`
- Create: `src/utils/workLinkFlash.ts` (런타임 import 없음)
- Modify: `src/styles/motion-popups-panels.css` (시트·겹 keyframes, `.bf-bulk-in` 근처)
- Modify: `src/components/scenes/SceneWorkLinksPanel.tsx` (`WorkLinkRow` 가 빛남 신호를 듣는다)
- Modify: `src/App.tsx:3225` (`<BulkWorkLinkDialogHost />` 바로 뒤에 `<GuideFolderSuggestSheetHost />`)
- Test: `tests/guideFolderSuggestWiring.test.ts` 에 덧붙임, `tests/guideFolderSuggest.test.ts` 에 `workLinkFlash` 순수 테스트 덧붙임

**Interfaces:**
- Consumes: Task 1 문구·`displayPathParts`, Task 2 `GuideFolderSuggestion`·`suggestionMode`·`reconcileCurrentFolder`, `useSceneWorkLinkStore`, `getSceneWorkLinkSlots`, `openWorkPath`, `offerBulkWorkLink`, `useAuthStore`, `useMotionPref`, `animateEl`
- Produces:
```ts
// src/components/scenes/GuideFolderSuggestSheet.tsx
export const GuideFolderSuggestSheet: { isOpen(): boolean; show(suggestion: GuideFolderSuggestion): void };
export function GuideFolderSuggestSheetHost(): JSX.Element | null;
// src/utils/workLinkFlash.ts
export const WORK_LINK_FLASH_EVENT = 'bflow:work-link-flash';
export interface WorkLinkFlashDetail { sceneUuid: string; department: 'bg' | 'acting'; kinds: Array<'folder' | 'primary_file'> }
export function flashWorkLinks(detail: WorkLinkFlashDetail): void;          // window.dispatchEvent(new CustomEvent(...))
export function isWorkLinkFlashFor(detail: WorkLinkFlashDetail, sceneUuid: string | null | undefined, department: string, kind: string): boolean;
```

- [ ] **Step 1: 실패하는 테스트**

```ts
// tests/guideFolderSuggest.test.ts 에 추가
test('isWorkLinkFlashFor', () => {
  const d = { sceneUuid: 'u1', department: 'bg' as const, kinds: ['folder' as const] };
  assert.equal(isWorkLinkFlashFor(d, 'u1', 'bg', 'folder'), true);
  assert.equal(isWorkLinkFlashFor(d, 'u1', 'bg', 'primary_file'), false);
  assert.equal(isWorkLinkFlashFor(d, 'u2', 'bg', 'folder'), false);
});
// tests/guideFolderSuggestWiring.test.ts 에 추가 — SHEET = read('src/components/scenes/GuideFolderSuggestSheet.tsx')
test('창: 네이티브 dialog, 바깥 누름으로 닫지 않음, 키·붙여넣기 뒤로 새지 않음', () => {
  assert.ok(SHEET.includes('.showModal()'));
  assert.ok(SHEET.includes("window.addEventListener('keydown',") && SHEET.includes("window.addEventListener('paste',"));
  assert.ok(squash(SHEET).includes('onCancel={(event)=>{event.preventDefault();'));
  assert.ok(!SHEET.includes('onMouseDown'));   // 바깥 누름 닫기 없음(설계 4.8)
  assert.ok(SHEET.includes('onKeyDown={stop}') && SHEET.includes('onPaste={stop}'));
});
test('창: 저장은 upsertLink 직접, 가드 길 안 씀', () => {
  assert.ok(SHEET.includes('upsertLink(') && !SHEET.includes('saveWorkLinkPathGuarded'));
});
test('창: 한꺼번에 연결은 dialog.close() 뒤에', () => {
  inOrder(SHEET, ['.close()', 'offerBulkWorkLink(']);
});
test('창: 저장 중·저장 뒤에는 실시간 다시 판정 안 함', () => {
  assert.ok(SHEET.includes('reconcileCurrentFolder(') && SHEET.includes('savingRef.current'));
});
test('창: 긍정 버튼 강조색, accent-sub 안 씀', () => {
  assert.ok(SHEET.includes('bg-accent text-on-accent') && !SHEET.includes('accent-sub'));
});
test('App 이 창 호스트를 띄운다', () => {
  inOrder(read('src/App.tsx'), ['<BulkWorkLinkDialogHost />', '<GuideFolderSuggestSheetHost />']);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/guideFolderSuggest.test.ts ./tests/guideFolderSuggestWiring.test.ts` → FAIL

- [ ] **Step 3: 구현** — 틀은 `BulkWorkLinkDialog.tsx` 를 따른다(모듈 변수 `pending`, `externalShow`, `settle`, 호스트, 창 컴포넌트). 다른 점만 적는다.
  - **`show` 는 덮어쓴다**: 이미 떠 있으면 내용만 새 제안으로 바꾸고(다시 올라오는 움직임 없음) 고른 후보·체크·오류를 초기화한다(설계 4.9). Promise 를 돌려주지 않는다(void).
  - **모양**: `<dialog>` 는 화면 전체를 덮는 투명 판 — `className="fixed inset-0 m-0 h-screen w-screen max-h-none max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-transparent"`, `aria-labelledby` 제목. 안에 (1) 겹 `div` `absolute inset-0 bg-black/55 backdrop-blur-[6px]` + 열림·닫힘 클래스, (2) `absolute inset-x-0 bottom-0 flex justify-center` 안에 시트 `w-[min(520px,calc(100vw-32px))] rounded-t-2xl border border-b-0 border-bg-border bg-bg-card px-5 pt-2.5 pb-4 shadow-2xl` + 손잡이 막대. 흐림은 겹 하나에만, 겹의 조상에는 opacity 애니메이션을 걸지 않는다(motion-popups-panels.css:10-11 주의).
  - **내용**(설계 5.1, 시안 C 순서): 머리(강조색 옅은 바탕 `bg-accent/15 text-accent` 의 `FolderSearch` 아이콘 + `guideFolderTitle` + `guideFolderSourceLine`) → 바꾸기면 '지금' 경로(흐리게·줄 그음) ↓ '새 폴더' → 후보가 둘 이상이면 라디오 목록 + `candidatesNote`, 하나면 경로 칸 → `mismatch` 면 노란 상자(`#FDCB6E` 계열, `AlertTriangle`) → `offerClip && 고른 후보.clip` 이면 체크(처음 켜짐, `accent-accent`) `대표 파일로도 연결 · {파일 이름}` → 오류 줄 → 아래 줄(왼쪽 '폴더 열어 보기' 글자 버튼, 오른쪽 '건너뛰기/그대로 두기' 테두리 버튼 + 긍정 버튼). 경로 칸은 `displayPathParts` 의 `head.join(' › ') + ' › '` 를 흐린 색, `leaf` 를 진하게, `title={전체 경로}`.
  - **초점·키**: 열리면 긍정 버튼에 초점. `onCancel` → `preventDefault` 후 건너뛰기 닫기. `onKeyDown={stop}`·`onPaste={stop}`, 창 밖 대상 keydown 은 window 캡처에서 `stopPropagation`, paste 는 window 캡처에서 늘 `stopPropagation`(BulkWorkLinkDialog 81-93 과 같게). 바깥 누름 처리 없음.
  - **실시간**: `useSceneWorkLinkStore((s) => getSceneWorkLinkSlots(s.linkMap, sceneUuid, 'bg').folder?.path ?? null)` 가 바뀌면, `savingRef.current` 가 거짓이고 저장한 적이 없을 때만 `reconcileCurrentFolder` → null 이면 조용히 닫기(알림 없음), 아니면 내용 교체. 그 씬이 자료에서 사라지면(`findSceneLocation(useDataStore.getState().episodes, sceneUuid)` 가 null — 씬 삭제 등) 저장하지 않고 조용히 닫는다(설계 4.9).
  - **저장**(`savingRef` 로 두 번 막기, 설계 4.7): 고른 후보에 대해 (1) 지금 스토어의 작업 폴더가 그 후보와 같으면 폴더 쓰기 생략, 아니면 `upsertLink({ sceneUuid, department: 'bg', linkKind: 'folder', path: folder, userId })` 후 `folderSavedRef = true`; (2) 체크가 켜져 있고 clip 이 있고 지금 대표 파일 칸이 비어 있으면 `upsertLink(... 'primary_file', clip ...)`. 실패 → 버튼 '다시 시도', 오류 줄, `animateEl(sheet, [{transform:'translateX(0)'},{transform:'translateX(-5px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}], { duration: 260 }, reduce)`; 다시 시도는 `folderSavedRef` 면 폴더를 건너뛴다. 성공 → `const toastId = toast.success(mode === 'change' ? savedChange : savedNew)` → `flashWorkLinks({ sceneUuid, department: 'bg', kinds })` → 닫기 움직임 → `dialog.close()` → **그 뒤** 대표 파일을 썼으면 `void offerBulkWorkLink({ sceneUuid, department: 'bg', path: clip, userId, savedToastId: toastId })`. `userId = useAuthStore.getState().currentUser?.id ?? null`.
  - **폴더 열어 보기**: `openWorkPath(folder)` → `!ok` 면 `toast.error(openFailed)`. 창은 그대로.
  - **움직임**: CSS(이름 앞 `bf-gfs-`) — 겹 `opacity 0→1` 180ms `var(--ease-out)`, 닫힘 `1→0` 160ms; 시트 `transform: translateY(100%)→none` + `opacity .6→1` 320ms `var(--ease-out)`, 닫힘 `→translateY(100%)`·`opacity 0` 180ms `var(--ease-in)`. `@media (prefers-reduced-motion: reduce)` 에서 시트·겹 animation 없음. 닫기는 닫힘 클래스를 붙이고 시트 `animationend`(또는 220ms 대비 타이머) 뒤 `close()`; `useMotionPref().reduce` 면 바로.
  - **빛남**: `WorkLinkRow` 가 `WORK_LINK_FLASH_EVENT` 를 듣고 `isWorkLinkFlashFor(detail, scene?.id, department, linkKind)` 면 1200ms 동안 감싸는 `div` 에 `rounded-lg ring-1 ring-accent bg-accent/15` (`transition-[background-color,box-shadow] duration-[400ms]`). 이 감싸기는 `PathLinkCard` 를 고치지 않는다.

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/guideFolderSuggest.test.ts ./tests/guideFolderSuggestWiring.test.ts && npm run test:scene-links && npm run typecheck` → PASS (기존 `sceneBulkWorkLinkWiring` 포함)

- [ ] **Step 5: 커밋** — `git commit -m "가이드 작업 폴더 제안: 아래에서 올라오는 제안 창과 저장"`

---

### Task 6: 제안 서비스 + 씬 상세 창 두 곳 연결

**Files:**
- Create: `src/services/guideFolderSuggestion.ts`
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx` (가이드 `onDropBlob` U:1114, `pickFile` U:783-792, window paste U:704-743)
- Modify: `src/components/scenes/SceneDetailModal.tsx` (`handleDrop` S:934-941, `pickFile` S:888-901, `pasteClipboard` S:903-915, `handlePasteEvent` S:917-932, window paste S:861-884)
- Test: `tests/guideFolderSuggestWiring.test.ts` 에 덧붙임

**Interfaces:**
- Consumes: Task 2 `buildGuideFolderSuggestion`, Task 3 `workFolderListDir`·`workFolderClipboardImagePath`, Task 4 `isGuideFolderSuggestEnabled`, Task 5 `GuideFolderSuggestSheet`, `findSceneLocation`(src/utils/sceneBulkWorkLink.ts:116), `useDataStore`, `useSceneWorkLinkStore`, `getSceneWorkLinkSlots`
- Produces: `export function suggestGuideFolder(input: { sceneUuid: string | null | undefined; method: GuideImageMethod; file?: Blob | null }): void` — 기다리지 않는다, 던지지 않는다(안에서 잡아 `console.warn`).

- [ ] **Step 1: 실패하는 배선 테스트**

```ts
test('서비스: 요청 번호로 옛 결과 버림, 다른 창 떠 있으면 안 띄움, 링크 읽기 시간 제한', () => {
  const svc = read('src/services/guideFolderSuggestion.ts');
  assert.ok(svc.includes('++requestSeq') && svc.includes('!== requestSeq'));
  assert.ok(svc.includes('dialog[open]') && svc.includes('GuideFolderSuggestSheet.isOpen()'));
  assert.ok(svc.includes('isGuideFolderSuggestEnabled()'));
  assert.ok(svc.includes("department !== 'bg'"));
});
test('통합 창: 가이드만, 붙여넣기는 지금 씬 uuid 를 ref 로', () => {
  const u = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
  assert.equal(count(u, 'suggestGuideFolder('), 3);
  assert.ok(squash(u).includes("onDropBlob={(b)=>{voiduploadImage(b,'guide');suggestGuideFolder({sceneUuid:bgScene?.id,method:'drop',file:b});}}"));
  assert.ok(u.includes("sceneUuid: bgSceneIdRef.current, method: 'paste'"));
  inOrder(u, ["sceneUuid: bgSceneIdRef.current, method: 'paste'", 'await uploadImageRef.current(blob, imageType)']);   // 넣자마자 바로
});
test('부서 하나 창: 가이드만, 다섯 길', () => {
  const s = read('src/components/scenes/SceneDetailModal.tsx');
  assert.equal(count(s, 'suggestGuideFolder('), 5);
  assert.ok(s.includes("imageType === 'guide'"));
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts` → FAIL

- [ ] **Step 3: 구현**
  - 서비스 흐름: `const seq = ++requestSeq` → `sceneUuid` 가 없으면 끝(작업 링크 칸이 '씬 데이터 없음'으로 잠긴 씬, 설계 4.7) → 설정 꺼짐이면 끝 → 경로: `file instanceof File` 이면 `window.electronAPI.getPathForFile(file)`(try/catch, 빈 값 가능), 비었고 `method === 'paste'` 면 `await window.electronAPI.workFolderClipboardImagePath?.() ?? ''` → `fileName` = File 이름 또는 경로의 끝 이름(경로·이름 다 없으면 null) → `findSceneLocation(useDataStore.getState().episodes, sceneUuid)`; 없거나 `location.part.department !== 'bg'` 면 끝 → `buildGuideFolderSuggestion(req, deps)` (deps: `listDir` = `workFolderListDir` 없으면 null; `loadLinks` = `loadForSceneUuids` 와 3000ms 시간 제한의 race, 실패·시간 넘김 false; `bgSlots` = `getSceneWorkLinkSlots(linkMap, uuid, 'bg')` 의 path) → 매 await 뒤 `seq !== requestSeq` 면 버림 → 결과가 있고, 우리 창이 떠 있거나 다른 `[role="dialog"][aria-modal="true"], dialog[open]` 이 없으면 `GuideFolderSuggestSheet.show(result)`. `partSceneUuids` = 같은 파트 씬 id(자기 제외), `otherBgPartSceneUuids` = `location.episode.parts` 중 다른 배경 파트의 씬 id.
  - 통합 창: 가이드 `onDropBlob` 은 테스트 글자 그대로. `pickFile` 의 `onchange` 에서 `imageType === 'guide'` 일 때 `suggestGuideFolder({ sceneUuid: bgScene?.id, method: 'pick', file })` (deps 에 `bgScene?.id`). window paste 는 `const bgSceneIdRef = useRef<string | undefined>(undefined); bgSceneIdRef.current = bgScene?.id;` 를 두고, 대상 칸이 정해진 뒤 `imageType === 'guide'` 이면 업로드 **전에** `suggestGuideFolder({ sceneUuid: bgSceneIdRef.current, method: 'paste', file: blob })`.
  - 부서 하나 창: 다섯 길 모두 `imageType === 'guide'` 일 때만. 드롭·고르기·`handlePasteEvent`·window paste 는 File 을 넘기고, '클립보드 붙여넣기' 버튼은 `file` 없이 `method: 'paste'`. window paste 가 씬 변경에 다시 걸리지 않는 구조면 통합 창처럼 ref 로 uuid 를 읽는다. 같은 붙여넣기가 `onPaste` 와 window 양쪽에서 불려도 요청 번호가 마지막 하나만 남긴다.

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts && npm run test:scene-links && npm run typecheck` → PASS

- [ ] **Step 5: 커밋** — `git commit -m "가이드 작업 폴더 제안: 씬 상세 창 두 곳의 가이드 넣기에 연결"`

---

### Task 7: 규칙 문서·버전·업데이트 안내

**Files:**
- Modify: `AGENTS.md:96` 과 새 절, `DEVLOG/update-notes.json` 맨 앞, `package.json`·`package-lock.json`(3·9행) 버전
- Test: `tests/guideFolderSuggestWiring.test.ts` 에 덧붙임

- [ ] **Step 1: 실패하는 테스트**

```ts
test('AGENTS: 한꺼번에 연결 시작점 둘, 새 절', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('### 가이드 그림 작업 폴더 제안 (v1.150.0)'));
  assert.ok(agents.includes('GuideFolderSuggestSheet'));
});
test('버전 1.150.0 과 안내 첫 항목', () => {
  assert.equal(JSON.parse(read('package.json')).version, '1.150.0');
  assert.equal(JSON.parse(read('DEVLOG/update-notes.json'))[0].version, '1.150.0');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts` → FAIL

- [ ] **Step 3: 구현**
  - AGENTS.md:96 을 "제안은 두 곳에서만 시작한다: `saveWorkLinkPathGuarded` 의 성공 줄 뒤, 그리고 가이드 작업 폴더 제안 창(`GuideFolderSuggestSheet`)이 대표 파일을 저장하고 창을 닫은 뒤. 둘 다 대표 파일일 때만, 기다리지 않고." 로. 새 절(:113 뒤): 이 창은 `upsertLink` 직접 / 폴더 이름은 `.` 도 나눔표·가족 글자 목록만 / `.clip` 은 기존 규칙 그대로 / 목록 통로는 `G:\공유 드라이브\` 안만, 3초 / `clipboard:read-image-file` 대신 `work-folder:clipboard-image-path` / 창은 바깥 누름으로 닫지 않음 / 테스트는 `npm run test:scene-links`.
  - 버전 1.149.2 → 1.150.0 (세 곳).
  - update-notes 맨 앞 항목(비개발자 톤, 식별자 금지): `{"version":"1.150.0","title":"가이드 그림을 넣으면 작업 폴더를 찾아 줘요","items":[{"category":"feature","summary":"가이드 그림을 넣으면 그 그림이 있는 폴더를 작업 폴더로 넣을지 물어봐요","description":"씬 창의 가이드 칸에 공유 드라이브의 그림을 끌어다 놓거나 골라 넣으면, 그 그림이 있는 폴더를 작업 폴더로 넣을지 화면 아래에서 올라오는 창으로 물어봐요. 폴더 안 작업 파일(.clip)이 하나로 정해지면 대표 파일도 함께 넣을 수 있어요. 캡처처럼 위치를 알 수 없는 그림은 같은 파트 다른 씬들의 폴더를 보고 찾아 줘요. 필요 없으면 설정의 '시작'에서 끌 수 있어요."}]}`

- [ ] **Step 4: 통과 확인** — Run: `node --test ./tests/guideFolderSuggestWiring.test.ts` → PASS

- [ ] **Step 5: 커밋** — `git commit -m "v1.150.0: 가이드 그림 작업 폴더 제안 — 규칙 문서·버전·업데이트 안내"`

---

### Task 8: 전체 확인

- [ ] **Step 1: 자동 검사**

Run: `npm run typecheck` → 오류 0. Run: `npm run test:scene-links` → 전부 PASS. Run: `npm run build:vite` → 모든 `test:*` 와 vite build 성공(마지막에 manifest 생성 로그).

- [ ] **Step 2: 미리보기 모드(`npm run dev:renderer`, `?preview=1`, mock 로그인 '배한솔'/'1234')** — 241 싱크홀 대축제 D파트 같은 mock 씬에 대해 다섯 상황을 만든다(mock 링크·`__bflowMockGuideClipboardPath`·mock 폴더 구조): 새로 넣기, 바꾸기, 후보 여럿(d043), 번호 불일치(d055 에 d054 경로), 저장 실패(mock upsert 를 한 번 실패시키는 훅이 없으면 네트워크 끊김 흉내 대신 스토어 upsert 를 콘솔에서 한 번 reject 하도록 바꿔 확인). 각각: Enter=넣기, Esc=건너뛰기(씬 창은 그대로), 흐린 곳 누름=안 닫힘, **Tab 을 끝까지 돌린 뒤 화살표·Esc·Ctrl+V** 가 뒤 씬 창에 닿지 않음, 테마 둘 이상에서 긍정 버튼 색, 저장 뒤 작업 링크 칸 빛남 + 알림, 대표 파일 저장 뒤 '한꺼번에 연결' 창이 이어서 뜸, 설정 스위치를 끄면 안 뜸.

- [ ] **Step 3: 앱 엔진 확인** — 워크트리 Electron 을 `show:false` + offscreen 하니스로 띄워 제안 창이 열린 화면을 캡처한다(흐림·시트 위치·글자 잘림, '움직임: 최소'에서 바로 나타남). 한솔 PC 화면에 창을 띄우지 않는다. 캡처 파일을 남긴다.

- [ ] **Step 4: 마무리 보고** — 위 결과와 남은 실기(팀 PC 실제 공유 드라이브에서 끌어다 놓기·고르기·탐색기 복사 붙여넣기·그림만 붙여넣기 각 한 번)를 적는다. PR·머지·배포는 한솔이 정한다.
