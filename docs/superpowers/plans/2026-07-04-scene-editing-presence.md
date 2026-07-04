# 실시간 "작업 중(파일 열림)" 프레즌스 — 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬에 연동된 Moho 파일을 팀원이 열면, 다른 팀원의 B flow 카드/시트/모달에 회전 무지개 테두리 + 무지개 이름표로 실시간 표시한다.

**Architecture:** 각 PC의 Electron 메인이 Moho 창 제목을 폴링해 "내가 편집 중인 씬"을 판정 → 기존 `bflow-realtime` 채널에 Supabase presence로 방송(추가 회선 0, 끊기면 자동 소멸) → 메인이 전체 프레즌스를 병합해 IPC로 렌더러에 스냅샷 전달 → 렌더러가 표시. 감지·전파는 메인, 표시는 렌더러(IPC 규칙 준수).

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Supabase Realtime(presence), Tailwind, PowerShell(child_process spawn), 테스트는 `node --test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-07-04-scene-editing-presence-design.md`

---

## 규약 (이 저장소)

**테스트:**
- 파일: `tests/<name>.test.ts`, `import test from 'node:test'; import assert from 'node:assert/strict';`, 소스는 `.ts` 확장자로 import (예: `from '../electron/presence/mohoTitleParser.ts'`).
- 실행: `node --test ./tests/<name>.test.ts` (Node 22.18 타입 스트리핑, 별도 로더 없음).
- 등록: 새 그룹 `test:presence`를 `package.json`에 만들고 `build`/`build:vite` 체인에 넣어 빌드가 커버.
- RTL/jsdom 없음 → UI는 미리보기 모드(`?preview=1`, mock '배한솔')로 수동 검증. 순수 로직만 자동 테스트.

**import 관례:**
- **electron/ 신규 소스는 기존 관례를 따라 `import { spawn } from 'child_process'`, `import path from 'path'` (node: 접두사 없음).** 테스트만 `node:test`/`node:assert/strict` 사용(기존 테스트 관례).
- **electron/ 소스 간(source-to-source) import는 확장자 없이** 쓴다 (예: `from './types'`, `from '../supabase'`). `tsconfig.node.json`은 `allowImportingTsExtensions`가 없어 `.ts` 확장자 import가 `TS5097`로 실패한다. **테스트 파일(tests/)만** 소스를 `.ts` 확장자로 import한다(두 tsconfig include 밖 + `node --test` 타입스트리핑이 실제 경로 필요). src/ 렌더러 코드는 `@/` alias(확장자 없음) 사용. (PR1에서 확인된 사항.)

**공유 타입 (renderer↔main 경계):**
- 이 저장소는 electron과 src가 별도 tsconfig 프로젝트다(`tsconfig.json` include: `['src']`, `tsconfig.node.json` include: `['vite.config.ts','electron']`). `SceneWorkLink`가 electron/src 양쪽에 병렬 정의된 것과 동일한 관례를 따른다.
- 따라서 프레즌스 공유 타입은 **양쪽에 구조적으로 동일하게 정의**한다(IPC는 평문 JSON이라 구조 동일성만 필요):
  - main: `electron/presence/types.ts`
  - renderer: `src/types/index.ts` 에 `EditingUser`, `EditingPresenceSnapshot` 추가
- **렌더러 코드는 electron/을 cross-import 하지 않는다.** `src/utils/editingPresence.ts` 등은 `@/types`에서 가져온다.

**공용 타입 정의 (동일 구조):**
```ts
// main: electron/presence/types.ts / renderer: src/types/index.ts 에 각각
export interface EditingUser { userId: string; username: string; }
/** sceneUuid -> 그 씬을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
// (main 전용) 메인이 track하는 페이로드
export interface EditingPresencePayload { userId: string; username: string; editingSceneUuids: string[]; updatedAt: string; }
```

**PR/브랜치 규약:** 각 PR은 직전 PR 머지 후의 `main`에서 분기. 각 PR = 구현 → `npm run typecheck` + `test:presence` + `build:vite` 통과 → 푸시 → `codex-review-loop` 스킬로 코덱스 리뷰 반영 → 최종 코드리뷰 → 머지. 슬랙 공지·G드라이브 배포는 명시적 단계(PR4 이후)에서만.

---

## Chunk 1 (PR1): 감지 엔진 (main, 순수 코어 + 폴러)

**목표:** Moho 창 제목 → 정규화 basename 파서(U1 코어)와 `scene_work_links` basename→sceneUuid 인덱스(U2)를 순수 함수로 만들고 단위 테스트한다. PowerShell 폴러(win32 가드)와 실측용 디버그 스크립트를 추가한다. main.ts 배선은 PR2에서.

**File Structure:**
- Create `electron/presence/types.ts` — main 측 공용 타입.
- Create `electron/presence/mohoTitleParser.ts` — 순수: 창 제목 줄 → basename 배열. I/O 없음.
- Create `electron/presence/sceneLinkIndex.ts` — 순수: 링크 배열 → basename 인덱스, basename → sceneUuid 해석. I/O 없음.
- Create `electron/presence/mohoWindowPoller.ts` — I/O: PS 실행 + 주기 폴링 + 변경 감지. 얇은 글루.
- Create `scripts/debug-moho-titles.mjs` — 실측 도구.
- Create `tests/mohoTitleParser.test.ts`, `tests/sceneLinkIndex.test.ts`.
- Modify `package.json` — `test:presence` 그룹 추가 + `build`/`build:vite`에 연결.

### Task 1: main 측 공용 타입 파일

**Files:** Create `electron/presence/types.ts`

- [ ] **Step 1: 작성**

```ts
// electron/presence/types.ts
export interface EditingUser {
  userId: string;
  username: string;
}
/** sceneUuid -> 그 씬을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
/** 메인이 Supabase presence로 track하는 페이로드(사용자당 1개) */
export interface EditingPresencePayload {
  userId: string;
  username: string;
  editingSceneUuids: string[];
  updatedAt: string;
}
```

- [ ] **Step 2: 커밋**

```bash
git add electron/presence/types.ts
git commit -m "프레즌스 공용 타입(main) 추가"
```

### Task 2: Moho 창 제목 파서 (순수 코어, TDD)

**Files:** Create `electron/presence/mohoTitleParser.ts`; Test `tests/mohoTitleParser.test.ts`

**동작 명세:** 각 창 제목 줄에서 (1) 후행 앱 접미사 ` -Moho`(버전 표기 포함, 대소문자 무시) 제거, (2) 미저장 표시 `*` 제거, (3) 남은 문자열이 Moho 프로젝트 확장자(`.moho`/`.mohoproj`/`.anime`)로 끝날 때만 채택, (4) 소문자화, (5) 중복 제거. 실측 기준 제목: `b030.moho -Moho`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/mohoTitleParser.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMohoTitles } from '../electron/presence/mohoTitleParser.ts';

test('표준 제목에서 basename(확장자 포함, 소문자) 추출', () => {
  assert.deepEqual(parseMohoTitles(['b030.moho -Moho']), ['b030.moho']);
});
test('미저장 표시 * 와 대소문자 처리', () => {
  assert.deepEqual(parseMohoTitles(['B030-피드백.MOHO* -Moho']), ['b030-피드백.moho']);
});
test('여러 Moho 인스턴스(여러 줄)와 중복 제거', () => {
  assert.deepEqual(
    parseMohoTitles(['b030.moho -Moho', 'b031-다시.moho -Moho', 'b030.moho -Moho']),
    ['b030.moho', 'b031-다시.moho'],
  );
});
test('빈 줄/공백/비-moho(제목없음, 새 프로젝트) 무시', () => {
  assert.deepEqual(parseMohoTitles(['', '   ', 'Untitled -Moho', 'Moho Pro']), []);
});
test('버전 표기가 붙은 앱 접미사도 제거', () => {
  assert.deepEqual(parseMohoTitles(['a012.mohoproj - Moho Pro']), ['a012.mohoproj']);
});
test('파일명에 대시가 있어도 확장자 앞까지 보존', () => {
  assert.deepEqual(parseMohoTitles(['ep2-b030-retake.moho -Moho']), ['ep2-b030-retake.moho']);
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/mohoTitleParser.test.ts` → FAIL.

- [ ] **Step 3: 최소 구현**

```ts
// electron/presence/mohoTitleParser.ts
const MOHO_EXT = /\.(moho|mohoproj|anime)$/i;
const APP_SUFFIX = /\s*[-–—]\s*Moho(\s+(Pro|Debut|Anime\s*Studio))?\s*$/i;

/** 창 제목 한 줄 → 정규화 basename(소문자, 확장자 포함). 실패 시 null. */
export function normalizeMohoTitle(rawLine: string): string | null {
  let s = (rawLine ?? '').trim();
  if (!s) return null;
  const m = APP_SUFFIX.exec(s);
  if (m) s = s.slice(0, m.index);
  s = s.trim().replace(/\*+$/, '').trim();
  if (!s || !MOHO_EXT.test(s)) return null;
  return s.toLowerCase();
}

/** 여러 창 제목 줄 → 정규화 basename 배열(중복 제거, 입력 순서 유지). */
export function parseMohoTitles(rawLines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of rawLines ?? []) {
    const name = normalizeMohoTitle(line);
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — PASS (6 tests).
- [ ] **Step 5: 커밋**

```bash
git add electron/presence/mohoTitleParser.ts tests/mohoTitleParser.test.ts
git commit -m "Moho 창 제목 파서 추가(순수 코어+테스트)"
```

### Task 3: 씬 링크 인덱스 (순수 코어, TDD)

**Files:** Create `electron/presence/sceneLinkIndex.ts`; Test `tests/sceneLinkIndex.test.ts`

**동작 명세:** `SupabaseSceneWorkLink[]` 중 `linkKind==='primary_file'`만. `path.win32.basename(path).toLowerCase()` → `Map<basename, Set<sceneUuid>>`. **Windows 경로(백슬래시)를 host OS와 무관하게 다루기 위해 `path.win32` 사용**(단, import는 관례대로 `import path from 'path'` 후 `path.win32.basename`).

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/sceneLinkIndex.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from '../electron/presence/sceneLinkIndex.ts';
import type { SupabaseSceneWorkLink } from '../electron/supabase.ts';

let seq = 0;
function lnk(p: Partial<SupabaseSceneWorkLink> & Pick<SupabaseSceneWorkLink, 'sceneUuid' | 'linkKind' | 'path'>): SupabaseSceneWorkLink {
  return {
    id: `id-${seq++}`, department: 'bg', label: null, sortOrder: 0,
    createdBy: null, createdAt: '', updatedBy: null, updatedAt: '',
    ...p,
  } as SupabaseSceneWorkLink;
}

test('primary_file만 인덱싱하고 basename 소문자 키', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\show\\EP2\\B030.moho' }),
    lnk({ sceneUuid: 's1', linkKind: 'folder', path: 'G:\\show\\EP2' }),
  ]);
  assert.deepEqual([...(idx.get('b030.moho') ?? [])], ['s1']);
  assert.equal(idx.has('ep2'), false);
});
test('해석: basename → sceneUuid 유니크', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\a\\b030.moho' }),
    lnk({ sceneUuid: 's2', linkKind: 'primary_file', path: 'G:\\a\\b031.moho' }),
  ]);
  const r = resolveScenesForBasenames(idx, ['b030.moho', 'nomatch.moho']);
  assert.deepEqual(r.sceneUuids, ['s1']);
  assert.deepEqual(r.collisions, []);
});
test('콜리전: 동명 파일 다른 폴더 → 전 sceneUuid + collision 보고', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\ep1\\b030.moho' }),
    lnk({ sceneUuid: 's2', linkKind: 'primary_file', path: 'G:\\ep2\\b030.moho' }),
  ]);
  const r = resolveScenesForBasenames(idx, ['b030.moho']);
  assert.deepEqual(r.sceneUuids.sort(), ['s1', 's2']);
  assert.deepEqual(r.collisions, ['b030.moho']);
});
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 최소 구현**

```ts
// electron/presence/sceneLinkIndex.ts
import path from 'path';
import type { SupabaseSceneWorkLink } from '../supabase.ts';

/** primary_file 링크의 basename(소문자) → sceneUuid 집합 */
export function buildPrimaryFileBasenameIndex(
  links: SupabaseSceneWorkLink[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const link of links ?? []) {
    if (link.linkKind !== 'primary_file' || !link.path) continue;
    const base = path.win32.basename(link.path).toLowerCase();
    if (!base) continue;
    let set = index.get(base);
    if (!set) index.set(base, (set = new Set()));
    set.add(link.sceneUuid);
  }
  return index;
}

export interface ResolveResult { sceneUuids: string[]; collisions: string[]; }

/** 정규화 basename 목록 → 매칭 sceneUuid(유니크) + 콜리전 basename 목록 */
export function resolveScenesForBasenames(
  index: Map<string, Set<string>>,
  basenames: string[],
): ResolveResult {
  const sceneSet = new Set<string>();
  const collisions: string[] = [];
  for (const base of basenames ?? []) {
    const set = index.get(base);
    if (!set || set.size === 0) continue;
    if (set.size > 1) collisions.push(base);
    for (const uuid of set) sceneSet.add(uuid);
  }
  return { sceneUuids: [...sceneSet], collisions };
}
```

- [ ] **Step 4: 통과 확인** — PASS (3 tests).
- [ ] **Step 5: 커밋**

```bash
git add electron/presence/sceneLinkIndex.ts tests/sceneLinkIndex.test.ts
git commit -m "씬 링크 basename 인덱스 추가(순수 코어+테스트)"
```

### Task 4: PowerShell 폴러 (I/O, win32 가드)

**Files:** Create `electron/presence/mohoWindowPoller.ts`

**참고:** `spawn` 패턴은 `electron/autoUpdate/installerApply.ts`(`import { spawn } from 'child_process'`)를 따른다.

- [ ] **Step 1: 구현**

```ts
// electron/presence/mohoWindowPoller.ts
import { spawn } from 'child_process';
import { parseMohoTitles } from './mohoTitleParser.ts';

/** 모든 Moho 인스턴스의 MainWindowTitle을 한 줄씩 출력하는 PS 명령 인자 */
export const MOHO_PS_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  "Get-Process -Name *moho* -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }",
];

/** 1회 폴링: 실행 중 Moho 창 제목 → 정규화 basename 배열. 실패/비win32 → []. */
export function pollMohoActiveBasenames(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (lines: string[]) => { if (!settled) { settled = true; resolve(lines); } };
    try {
      const ps = spawn('powershell.exe', MOHO_PS_ARGS, { windowsHide: true });
      ps.stdout.on('data', (d) => { out += d.toString(); });
      ps.on('error', () => done([]));
      ps.on('close', () => done(parseMohoTitles(out.split(/\r?\n/))));
    } catch { done([]); }
  });
}

/** 주기 폴링 시작. basename 집합이 달라질 때만 onChange. @returns 중단 함수 */
export function startMohoTitlePolling(opts: {
  intervalMs?: number;
  onChange: (basenames: string[]) => void;
}): () => void {
  const intervalMs = opts.intervalMs ?? 4000;
  let prevKey = '__init__';
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    const basenames = await pollMohoActiveBasenames();
    if (stopped) return;
    const key = [...basenames].sort().join('|');
    if (key !== prevKey) { prevKey = key; opts.onChange(basenames); }
  };
  if (process.platform === 'win32') {
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
  }
  return () => { stopped = true; if (timer) clearInterval(timer); };
}
```

- [ ] **Step 2: 타입체크** — `npm run typecheck` → 에러 없음.
- [ ] **Step 3: 커밋**

```bash
git add electron/presence/mohoWindowPoller.ts
git commit -m "Moho 창 제목 폴러 추가(win32 가드, 변경 감지)"
```

### Task 5: 실측 디버그 스크립트

**Files:** Create `scripts/debug-moho-titles.mjs`

**목적:** 한솔 Windows PC에서 실행해 §10 실측 항목(프로세스명·제목 형식) 확인.

- [ ] **Step 1: 작성**

```js
// scripts/debug-moho-titles.mjs
// 사용: node scripts/debug-moho-titles.mjs   (Moho를 켜둔 상태에서)
import { spawn } from 'child_process';
const args = [
  '-NoProfile', '-NonInteractive', '-Command',
  "Get-Process -Name *moho* -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize",
];
const ps = spawn('powershell.exe', args, { windowsHide: true });
let out = '';
ps.stdout.on('data', (d) => { out += d.toString(); });
ps.stderr.on('data', (d) => process.stderr.write(d));
ps.on('close', () => {
  console.log('=== Get-Process *moho* ===');
  console.log(out.trim() || '(실행 중 Moho 프로세스 없음)');
});
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/debug-moho-titles.mjs
git commit -m "Moho 제목 실측 디버그 스크립트 추가"
```

### Task 6: 테스트 그룹 등록 + 빌드 연결

**Files:** Modify `package.json` (scripts)

- [ ] **Step 1: `test:presence` 스크립트 추가**

```json
"test:presence": "node --test ./tests/mohoTitleParser.test.ts ./tests/sceneLinkIndex.test.ts",
```

- [ ] **Step 2: `build`/`build:vite` 체인에 `npm run test:presence` 삽입 (test:notifications 다음, vite build 앞)**

`build:vite` 최종형:
```
"build:vite": "npm run typecheck && npm run test:auto-update && npm run test:entity && npm run test:notifications && npm run test:presence && vite build && node scripts/generate-manifest.js --allow-missing-installer",
```
`build` 최종형(electron-builder 체인 유지, test 구간에만 삽입):
```
"build": "npm run typecheck && npm run test:auto-update && npm run test:entity && npm run test:notifications && npm run test:presence && vite build && electron-builder && node scripts/generate-manifest.js",
```

- [ ] **Step 3: 검증** — `npm run test:presence` → PASS (parser 6 + index 3 = 9). `npm run typecheck` → 에러 없음.
- [ ] **Step 4: 커밋**

```bash
git add package.json
git commit -m "test:presence 그룹 추가 및 빌드 체인 연결"
```

### Task 7: PR1 마무리 검증

- [ ] **Step 1:** `npm run typecheck && npm run test:presence && npm run build:vite` → 전부 통과.
- [ ] **Step 2: (한솔 PC, 선택) 실측** — `node scripts/debug-moho-titles.mjs` (Moho에 파일 열어둔 상태). 실제 ProcessName이 `*moho*`로 잡히는지, MainWindowTitle이 `<파일명>.moho -Moho` 형식인지 확인. 다르면 `MOHO_PS_ARGS`/`APP_SUFFIX` 조정 + 파서 테스트 갱신.

> PR1은 여기까지. main.ts 배선/UI 없음.

---

## Chunk 2 (PR2): 프레즌스 전송 (main track/수신 + IPC + 렌더러 스토어)

**목표:** 메인이 폴러 결과로 track하고, presence를 수신·병합해 IPC로 렌더러에 스냅샷 전달. 렌더러 스토어·선택자까지 배선하고, 개발용 오버레이로 종단 검증. **재연결 시 최신 채널로 재track**을 보장한다.

**File Structure:**
- Create `electron/presence/presenceMerge.ts` — 순수: presenceState → `EditingPresenceSnapshot`.
- Create `electron/presence/editingPresenceService.ts` — 메인 오케스트레이터.
- Modify `electron/realtime.ts` — presence sync/join/leave 핸들러 + `trackPresence()`(최신 채널 사용, 마지막 페이로드 보관, SUBSCRIBED 시 재track) + `onPresenceSync` 콜백.
- Modify `electron/main.ts` — 서비스 기동, `broadcastSupabasePresence`, `currentActivityUser` 주입, scene_work_link 캐시.
- Modify `electron/preload.ts` — `onSupabasePresence` 추가.
- Modify `src/types/index.ts` — `EditingUser`/`EditingPresenceSnapshot` 추가, `ElectronAPI`에 `onSupabasePresence` 추가.
- Modify `src/mocks/devElectronAPI.ts` — mock에 `onSupabasePresence: noop` 추가(ElectronAPI required 멤버 충족).
- Create `src/utils/editingPresence.ts` — 순수 선택자.
- Create `src/stores/useEditingPresenceStore.ts` — 스냅샷 스토어 + `useSceneEditingPresence` 훅.
- Modify 렌더러 구독부(`onSupabaseRealtime` 소비 지점) — `onSupabasePresence` 구독.
- Create `src/components/dev/EditingPresenceDebugOverlay.tsx` — DEV 전용(PR3에서 제거).
- Create `tests/presenceMerge.test.ts`, `tests/editingPresenceSelectors.test.ts`.
- Modify `package.json` — `test:presence`에 두 파일 추가.

### Task 1: presence 병합 (순수, TDD)

**Files:** Create `electron/presence/presenceMerge.ts`; Test `tests/presenceMerge.test.ts`

**명세:** Supabase `channel.presenceState()`는 `Record<presenceKey, Array<payload>>`(payload = `EditingPresencePayload`). → `sceneUuid → EditingUser[]`(userId dedupe).

- [ ] **Step 1: 실패 테스트**

```ts
// tests/presenceMerge.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePresenceState } from '../electron/presence/presenceMerge.ts';

test('여러 사용자의 편집 씬을 sceneUuid별로 병합', () => {
  const state = {
    u1: [{ userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' }],
    u2: [{ userId: 'u2', username: '김민수', editingSceneUuids: ['s1', 's2'], updatedAt: '' }],
  };
  const snap = mergePresenceState(state);
  assert.deepEqual(snap['s1'].map((u) => u.userId).sort(), ['u1', 'u2']);
  assert.deepEqual(snap['s2'].map((u) => u.username), ['김민수']);
});
test('같은 사용자 중복 페이로드는 userId로 dedupe', () => {
  const state = { u1: [
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
  ] };
  assert.equal(mergePresenceState(state)['s1'].length, 1);
});
test('편집 씬 없으면 빈 스냅샷', () => {
  assert.deepEqual(mergePresenceState({ u1: [{ userId: 'u1', username: 'x', editingSceneUuids: [], updatedAt: '' }] }), {});
});
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현**

```ts
// electron/presence/presenceMerge.ts
import type { EditingPresencePayload, EditingPresenceSnapshot, EditingUser } from './types';

type PresenceState = Record<string, EditingPresencePayload[]>;

export function mergePresenceState(state: PresenceState): EditingPresenceSnapshot {
  const bySceneUsers = new Map<string, Map<string, EditingUser>>();
  for (const payloads of Object.values(state ?? {})) {
    for (const p of payloads ?? []) {
      for (const sceneUuid of p.editingSceneUuids ?? []) {
        let users = bySceneUsers.get(sceneUuid);
        if (!users) bySceneUsers.set(sceneUuid, (users = new Map()));
        if (!users.has(p.userId)) users.set(p.userId, { userId: p.userId, username: p.username });
      }
    }
  }
  const snapshot: EditingPresenceSnapshot = {};
  for (const [sceneUuid, users] of bySceneUsers) snapshot[sceneUuid] = [...users.values()];
  return snapshot;
}
```

- [ ] **Step 4: 통과 확인** — PASS (3). 
- [ ] **Step 5: 커밋**

```bash
git add electron/presence/presenceMerge.ts tests/presenceMerge.test.ts
git commit -m "presence 병합 함수 추가(순수+테스트)"
```

### Task 2: 렌더러 공유 타입 + 선택자 (순수, TDD)

**Files:** Modify `src/types/index.ts`; Create `src/utils/editingPresence.ts`; Test `tests/editingPresenceSelectors.test.ts`

- [ ] **Step 1: `src/types/index.ts`에 공유 타입 추가**

기존 타입 정의 구역에 추가(파일 어디든 적절한 위치):
```ts
export interface EditingUser { userId: string; username: string; }
/** sceneUuid -> 그 씬을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
```

- [ ] **Step 2: 실패 테스트**

```ts
// tests/editingPresenceSelectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectEditorsForScenes, formatEditorLabels, isWarnPresence,
  editingBeamClassName, editingBeamRowClassName,
} from '../src/utils/editingPresence.ts';

const snap = {
  s1: [{ userId: 'u1', username: '배한솔' }, { userId: 'u2', username: '김민수' }],
  s2: [{ userId: 'u2', username: '김민수' }],
};

test('여러 sceneUuid 유니온 + 자기 자신 제외 + userId dedupe', () => {
  assert.deepEqual(selectEditorsForScenes(snap, ['s1', 's2'], 'u1').map((u) => u.userId), ['u2']);
});
test('자기 없으면 전원', () => {
  assert.equal(selectEditorsForScenes(snap, ['s1'], null).length, 2);
});
test('라벨 포맷: 최대 2 + overflow', () => {
  const editors = [{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }, { userId: 'c', username: 'C' }];
  const r = formatEditorLabels(editors, 2);
  assert.deepEqual(r.shown.map((u) => u.username), ['A', 'B']);
  assert.equal(r.overflow, 1);
});
test('경고 판정: 2명 이상', () => {
  assert.equal(isWarnPresence([{ userId: 'a', username: 'A' }]), false);
  assert.equal(isWarnPresence([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), true);
});
test('beam 클래스: 0명 빈 문자열, 1명 base, 2명 warn', () => {
  assert.equal(editingBeamClassName([]), '');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }]), 'editing-beam');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam editing-beam--warn');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }]), 'editing-beam-row');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam-row editing-beam-row--warn');
});
```

- [ ] **Step 3: 실패 확인** — FAIL.

- [ ] **Step 4: 구현**

```ts
// src/utils/editingPresence.ts
import type { EditingUser, EditingPresenceSnapshot } from '@/types';

export function selectEditorsForScenes(
  snapshot: EditingPresenceSnapshot,
  sceneUuids: Array<string | null | undefined>,
  excludeUserId: string | null | undefined,
): EditingUser[] {
  const byId = new Map<string, EditingUser>();
  for (const uuid of sceneUuids) {
    if (!uuid) continue;
    for (const user of snapshot[uuid] ?? []) {
      if (excludeUserId && user.userId === excludeUserId) continue;
      if (!byId.has(user.userId)) byId.set(user.userId, user);
    }
  }
  return [...byId.values()];
}

export function formatEditorLabels(editors: EditingUser[], max = 2): { shown: EditingUser[]; overflow: number } {
  return { shown: editors.slice(0, max), overflow: Math.max(0, editors.length - max) };
}

/** 2명 이상 동시 편집이면 경고 톤 */
export function isWarnPresence(editors: EditingUser[]): boolean {
  return editors.length >= 2;
}

/** div/motion.div 요소에 붙일 무지개 테두리 클래스 (편집자 0명이면 '') */
export function editingBeamClassName(editors: EditingUser[]): string {
  if (!editors.length) return '';
  return isWarnPresence(editors) ? 'editing-beam editing-beam--warn' : 'editing-beam';
}

/** 테이블 <tr>에 붙일 행 전용 무지개 테두리 클래스 (편집자 0명이면 '') */
export function editingBeamRowClassName(editors: EditingUser[]): string {
  if (!editors.length) return '';
  return isWarnPresence(editors) ? 'editing-beam-row editing-beam-row--warn' : 'editing-beam-row';
}
```

- [ ] **Step 5: 통과 확인** — PASS (5).
- [ ] **Step 6: 커밋**

```bash
git add src/types/index.ts src/utils/editingPresence.ts tests/editingPresenceSelectors.test.ts
git commit -m "프레즌스 렌더러 공유 타입·선택자·beam 클래스 헬퍼 추가(순수+테스트)"
```

### Task 3: realtime.ts — presence 핸들러 + trackPresence + 재track

**Files:** Modify `electron/realtime.ts`

**명세:** (1) 콜백 타입에 `onPresenceSync?: (state: Record<string, unknown[]>) => void` 추가. (2) 채널 빌더에 presence **sync/join/leave 3개 핸들러**(와일드카드 `'*'` 미지원) 추가 — 각 콜백에서 `callbacks.onPresenceSync?.(channel.presenceState())`. (3) **모듈 스코프의 최신 채널로 track하는 `trackPresence(payload)` export** — 마지막 페이로드를 모듈 스코프에 저장하고 현재 채널에 `track`. (4) subscribe status 콜백(`SUBSCRIBED`, realtime.ts:123 부근)에서 저장된 마지막 페이로드가 있으면 **재track**(재연결 대응).

- [ ] **Step 1: 콜백 타입 + presence 핸들러**

콜백 인터페이스에 `onPresenceSync?: (state: Record<string, unknown[]>) => void;` 추가. 채널 빌더 체이닝에:
```ts
.on('presence', { event: 'sync' }, () => callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>))
.on('presence', { event: 'join' }, () => callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>))
.on('presence', { event: 'leave' }, () => callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>))
```

- [ ] **Step 2: trackPresence + 재track**

realtime.ts 모듈 스코프에:
```ts
let lastPresencePayload: unknown | null = null;

/** 항상 현재(최신) 채널로 presence track. 마지막 페이로드를 저장해 재연결 시 재track. */
export function trackPresence(payload: unknown): void {
  lastPresencePayload = payload;
  // `channel`은 realtime.ts가 reconnect마다 교체하는 모듈 스코프 변수
  void channel?.track(payload as Record<string, unknown>);
}
```
그리고 subscribe status 콜백(`status === 'SUBSCRIBED'`)에 재track 추가:
```ts
if (status === 'SUBSCRIBED' && lastPresencePayload) {
  void channel?.track(lastPresencePayload as Record<string, unknown>);
}
```
> `channel`이 모듈 스코프 `let`인지 확인(realtime.ts:106-114의 reconnect가 교체). 아니라면 최신 채널 참조를 모듈 스코프로 승격.

- [ ] **Step 3: 타입체크** — 에러 없음.
- [ ] **Step 4: 커밋**

```bash
git add electron/realtime.ts
git commit -m "realtime: presence sync/join/leave + trackPresence(최신채널)+SUBSCRIBED 재track"
```

### Task 4: 메인 오케스트레이터 서비스

**Files:** Create `electron/presence/editingPresenceService.ts`

**명세:** 단일 책임 = "폴러 결과 → track / presence 수신 → 스냅샷 콜백". main.ts가 의존성 주입. `track`은 realtime의 `trackPresence`를 넘겨받아 재연결에 안전.

- [ ] **Step 1: 구현**

```ts
// electron/presence/editingPresenceService.ts
import type { SupabaseSceneWorkLink } from '../supabase';
import type { EditingPresenceSnapshot, EditingPresencePayload } from './types';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from './sceneLinkIndex';
import { startMohoTitlePolling } from './mohoWindowPoller';
import { mergePresenceState } from './presenceMerge';

export interface EditingPresenceDeps {
  getCurrentUser: () => { userId: string; username: string } | null;
  getWorkLinks: () => SupabaseSceneWorkLink[];
  track: (payload: EditingPresencePayload) => void;
  broadcast: (snapshot: EditingPresenceSnapshot) => void;
  now: () => string;
  intervalMs?: number;
  logCollision?: (basenames: string[]) => void;
}

export function startEditingPresenceService(deps: EditingPresenceDeps): () => void {
  const warned = new Set<string>();
  let lastEditing = '__init__';

  const publish = (basenames: string[]) => {
    const user = deps.getCurrentUser();
    if (!user) return;
    const idx = buildPrimaryFileBasenameIndex(deps.getWorkLinks());
    const { sceneUuids, collisions } = resolveScenesForBasenames(idx, basenames);
    const fresh = collisions.filter((c) => !warned.has(c));
    if (fresh.length) { fresh.forEach((c) => warned.add(c)); deps.logCollision?.(fresh); }
    const key = [...sceneUuids].sort().join('|');
    if (key === lastEditing) return;
    lastEditing = key;
    deps.track({ userId: user.userId, username: user.username, editingSceneUuids: sceneUuids, updatedAt: deps.now() });
  };

  const stopPolling = startMohoTitlePolling({ intervalMs: deps.intervalMs, onChange: publish });
  return () => stopPolling();
}

/** main.ts의 onPresenceSync 콜백이 호출: 전체 상태 병합 → broadcast */
export function receivePresence(
  state: Record<string, EditingPresencePayload[]>,
  broadcast: (snapshot: EditingPresenceSnapshot) => void,
): void {
  broadcast(mergePresenceState(state));
}
```

- [ ] **Step 2: 타입체크** — 에러 없음.
- [ ] **Step 3: 커밋**

```bash
git add electron/presence/editingPresenceService.ts
git commit -m "메인 프레즌스 오케스트레이터 서비스 추가"
```

### Task 5: main.ts 배선 + broadcast + preload + mock

**Files:** Modify `electron/main.ts`, `electron/preload.ts`, `src/types/index.ts`(ElectronAPI), `src/mocks/devElectronAPI.ts`

**명세:** (1) preload `onSupabasePresence` (`'supabase:presence-event'`). (2) `ElectronAPI` 인터페이스(src/types/index.ts:1265 부근)에 `onSupabasePresence` 시그니처 추가. (3) **`src/mocks/devElectronAPI.ts`(:488 mockAPI)에 `onSupabasePresence: () => () => {}` 추가** — required 멤버 충족(누락 시 typecheck 실패). (4) main.ts `broadcastSupabasePresence` (main.ts:2637 `broadcastSupabaseEvent` 옆). (5) realtime 셋업에 `onPresenceSync: (state) => receivePresence(state as Record<string, EditingPresencePayload[]>, broadcastSupabasePresence)`. (6) scene_work_links 캐시 + 서비스 기동, `track: (p) => trackPresence(p)`, `getCurrentUser`는 **`currentActivityUser`(main.ts:1417)** 사용.

- [ ] **Step 1: preload `onSupabasePresence`**

`electron/preload.ts`의 `onSupabaseRealtime`(353) 패턴 복제, 채널명 `'supabase:presence-event'`:
```ts
onSupabasePresence: (callback: (snapshot: unknown) => void) => {
  const handler = (_e: unknown, data: unknown) => callback(data);
  ipcRenderer.on('supabase:presence-event', handler);
  return () => ipcRenderer.removeListener('supabase:presence-event', handler);
},
```

- [ ] **Step 2: ElectronAPI 타입 + mock**

`src/types/index.ts`의 `ElectronAPI` 인터페이스에 `onSupabaseRealtime` 옆:
```ts
onSupabasePresence: (callback: (snapshot: unknown) => void) => () => void;
```
`src/mocks/devElectronAPI.ts`(:488 `mockAPI`)에 주변 관례(`noop`, :44 = `() => () => {}`)에 맞춰:
```ts
onSupabasePresence: noop,
```

- [ ] **Step 3: main.ts broadcast + 배선**

`broadcastSupabaseEvent` 근처:
```ts
function broadcastSupabasePresence(snapshot: EditingPresenceSnapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('supabase:presence-event', snapshot);
  for (const win of widgetWindows.values()) if (!win.isDestroyed()) win.webContents.send('supabase:presence-event', snapshot);
}
```
- 모듈 스코프: `let sceneWorkLinkCache: SupabaseSceneWorkLink[] = [];` 초기 로드 시 `sceneWorkLinkCache = await sbReadSceneWorkLinks();` (main.ts:1318에서 `readSceneWorkLinks`가 `sbReadSceneWorkLinks`로 alias import됨 — 실제 alias 확인해 사용), 기존 `onSceneWorkLinkChange`(main.ts:2571 부근)에서 갱신.
- realtime 셋업 콜백에 `onPresenceSync: (state) => receivePresence(state as Record<string, EditingPresencePayload[]>, broadcastSupabasePresence)` 추가.
- import: `startEditingPresenceService`, `receivePresence`(from `./presence/editingPresenceService`), `trackPresence`(from `./realtime`), 그리고 **타입** `import type { EditingPresenceSnapshot, EditingPresencePayload } from './presence/types'` (broadcast 시그니처·receivePresence 캐스트에 필요; 없으면 TS2304).
- 세션 확정 후:
```ts
const stopPresence = startEditingPresenceService({
  getCurrentUser: () => currentActivityUser ? { userId: currentActivityUser.id, username: currentActivityUser.name } : null,
  getWorkLinks: () => sceneWorkLinkCache,
  track: (p) => trackPresence(p),
  broadcast: broadcastSupabasePresence,
  now: () => new Date().toISOString(),
  logCollision: (b) => console.warn('[presence] basename 콜리전:', b),
});
```
- 앱 종료/로그아웃 시 `stopPresence()`.

> `currentActivityUser`의 필드는 `{ id, name }`(main.ts:1417, `auth:set-current-user` 1419). 확인 후 사용.

- [ ] **Step 4: 타입체크 + vite 빌드** — `npm run typecheck && npm run build:vite` 통과.
- [ ] **Step 5: 커밋**

```bash
git add electron/main.ts electron/preload.ts src/types/index.ts src/mocks/devElectronAPI.ts
git commit -m "메인 프레즌스 배선: track(재연결안전)/수신/broadcast + preload/mock onSupabasePresence"
```

### Task 6: 렌더러 스토어 + 구독 + 개발 오버레이

**Files:** Create `src/stores/useEditingPresenceStore.ts`, `src/components/dev/EditingPresenceDebugOverlay.tsx`; Modify 구독부(예: `src/App.tsx`)

- [ ] **Step 1: 스토어 + 훅**

```ts
// src/stores/useEditingPresenceStore.ts
import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { selectEditorsForScenes } from '@/utils/editingPresence';
import type { EditingPresenceSnapshot, EditingUser } from '@/types';

interface EditingPresenceState {
  byScene: EditingPresenceSnapshot;
  applyPresenceSnapshot: (snapshot: EditingPresenceSnapshot) => void;
}
export const useEditingPresenceStore = create<EditingPresenceState>((set) => ({
  byScene: {},
  applyPresenceSnapshot: (snapshot) => set({ byScene: snapshot ?? {} }),
}));

/** 여러 sceneUuid의 편집자(자기 자신 제외) */
export function useSceneEditingPresence(sceneUuids: Array<string | null | undefined>): EditingUser[] {
  const byScene = useEditingPresenceStore((s) => s.byScene);
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  return selectEditorsForScenes(byScene, sceneUuids, currentUserId);
}
```
> `useAuthStore`의 현재 사용자 접근자(`currentUser?.id`)는 실제 스토어 형태에 맞춰 확인·수정. 참조 안정성 위해 필요 시 `useMemo`.

- [ ] **Step 2: 구독 배선**

`onSupabaseRealtime` 구독 지점(App.tsx 등)에 병행:
```ts
useEffect(() => {
  const off = window.electronAPI?.onSupabasePresence?.((snap) =>
    useEditingPresenceStore.getState().applyPresenceSnapshot(snap as EditingPresenceSnapshot));
  return () => off?.();
}, []);
```

- [ ] **Step 3: 개발 오버레이(PR2 완료 기준)**

```tsx
// src/components/dev/EditingPresenceDebugOverlay.tsx
import { useEditingPresenceStore } from '@/stores/useEditingPresenceStore';
export function EditingPresenceDebugOverlay() {
  if (!import.meta.env.DEV) return null;
  const byScene = useEditingPresenceStore((s) => s.byScene);
  const rows = Object.entries(byScene);
  return (
    <div style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 99999, background: 'rgba(0,0,0,.8)', color: '#fff', font: '11px monospace', padding: 8, borderRadius: 8, maxWidth: 320, pointerEvents: 'none' }}>
      <div style={{ opacity: .6 }}>[presence] {rows.length} scene(s)</div>
      {rows.map(([uuid, users]) => (<div key={uuid}>{uuid.slice(0, 8)}: {users.map((u) => u.username).join(', ')}</div>))}
    </div>
  );
}
```
App 루트에 `{import.meta.env.DEV && <EditingPresenceDebugOverlay />}`.

- [ ] **Step 4: `test:presence`에 두 테스트 추가**

```json
"test:presence": "node --test ./tests/mohoTitleParser.test.ts ./tests/sceneLinkIndex.test.ts ./tests/presenceMerge.test.ts ./tests/editingPresenceSelectors.test.ts",
```
Run: `npm run typecheck && npm run test:presence && npm run build:vite` → 통과 (파서6+인덱스3+병합3+선택자5 = 17).

- [ ] **Step 5: 커밋**

```bash
git add src/stores/useEditingPresenceStore.ts src/components/dev/EditingPresenceDebugOverlay.tsx src/App.tsx package.json
git commit -m "프레즌스 렌더러 스토어·구독·개발 오버레이 배선"
```

### Task 7: PR2 종단 검증 (개발 오버레이)

- [ ] **Step 1: 미리보기 모드 검증** — `npm run dev` + `?preview=1`. Windows·Moho 있으면 실제 파일 열기→반대쪽 오버레이 표시(≤6초)/닫으면 사라짐. 없으면 콘솔 주입 `useEditingPresenceStore.getState().applyPresenceSnapshot({s1:[{userId:'x',username:'테스트'}]})`로 수신·렌더 경로 확인.
- [ ] **Step 2: 마무리** — `npm run typecheck && npm run test:presence && npm run build:vite` 통과. 오버레이는 PR3에서 제거.

---

## Chunk 3 (PR3): UI (무지개 테두리 + 이름표 + 배너)

**목표:** 회전 무지개 테두리(U7)와 이름표/배너(U6)를 카드·시트·모달에 적용. **기존 `src/styles/scene-effects.css`의 회전 conic `@property` 패턴을 재사용**하고, **테이블 행은 `<div>` wrapper가 아니라 기존 `.scene-row-highlighted`(td/행 pseudo) 방식**을 따른다. 다크/라이트·모션 최소화·다중 편집자/경고 톤·자기 제외·aria-label. 개발 오버레이 제거.

**File Structure:**
- Modify `src/styles/scene-effects.css` — 프레즌스용 회전 무지개 테두리 클래스(`.editing-beam*`, `.editing-beam-row*`), 이름표(`.editing-namelabel*`), 배너(`.editing-banner*`). 기존 회전 conic `@property`(`--scene-effect-angle`, lines 8-48)와 mask-composite 링 기법을 재사용/참조.
- Create `src/components/scenes/EditingNameLabels.tsx` — 무지개 이름표(최대 2 + `+N`), aria-label.
- Create `src/components/scenes/EditingPresenceBanner.tsx` — 모달 배너(전원 나열 + 경고 톤), aria-label.
- Modify `src/components/scenes/UnifiedSceneCard.tsx` — motion.div에 `editingBeamClassName` 클래스 부여(래퍼 div 금지) + 이름표.
- Modify `src/components/scenes/UnifiedSceneSheetView.tsx` — `<tr>`에 `editingBeamRowClassName` 클래스 + 셀 내 이름칩.
- Modify `src/components/scenes/UnifiedSceneDetailModal.tsx` — 배너 삽입(모달은 링 없이 배너만).
- Delete `src/components/dev/EditingPresenceDebugOverlay.tsx` + App 렌더 제거.

> **사전 조사(구현 시작 시):** `src/styles/scene-effects.css`에서 (a) 회전 conic `@property`/keyframes/mask 링 기법(lines 8-48), (b) 행 하이라이트 `.scene-row-highlighted`(lines 95-119)가 `<tr>`에 어떻게 링/하이라이트를 그리는지 읽고, 같은 메커니즘을 프레즌스 링에 재사용한다.

### Task 1: scene-effects.css — 회전 무지개 테두리(카드/모달용 div)

**Files:** Modify `src/styles/scene-effects.css`

- [ ] **Step 1: `.editing-beam` 추가(기존 @property/mask 기법 재사용)**

기존 회전 conic `@property`가 있으면 그 각도 변수를 재사용(예: `--scene-effect-angle`). 없으면 프레즌스 전용 `@property --presence-angle`를 파일 상단에 정의. `.editing-beam`은 요소에 직접 붙는 클래스(래퍼 아님):
```css
/* 실시간 편집 프레즌스 — 회전 무지개 테두리 (div/motion.div용) */
.editing-beam { position: relative; }
.editing-beam::before {
  content: ''; position: absolute; inset: -2px; border-radius: inherit; z-index: 0; padding: 2px;
  background: conic-gradient(from var(--scene-effect-angle, 0deg),
    #FF6B6B, #FDCB6E, #4ADE80, #38BDF8, #A78BFA, #F472B6, #FF6B6B);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: scene-effect-rotate 5.5s linear infinite; /* 기존 keyframe 이름에 맞춰 조정 */
  pointer-events: none;
}
.editing-beam.editing-beam--warn::before {
  background: conic-gradient(from var(--scene-effect-angle, 0deg),
    #FF4D4D, #FF6B6B, #FDCB6E, #FF6B6B, #FF4D4D, #F472B6, #FF4D4D);
}
@media (prefers-reduced-motion: reduce) { .editing-beam::before { animation: none; } }
```
> 카드가 자식 콘텐츠를 `overflow: hidden`으로 자르지 않는지 확인(기존 `SceneWorkLinkBadges`가 `-top-3`로 카드 밖에 보이므로 클리핑 없음 — 링 `inset:-2px`도 보임). 기존 keyframe/각도 변수명은 파일에서 확인해 맞춘다.

- [ ] **Step 2: 커밋**

```bash
git add src/styles/scene-effects.css
git commit -m "scene-effects: 회전 무지개 프레즌스 테두리 클래스 추가(기존 패턴 재사용)"
```

### Task 2: EditingNameLabels 컴포넌트

**Files:** Create `src/components/scenes/EditingNameLabels.tsx`; Modify `src/styles/scene-effects.css`(`.editing-namelabel*`)

- [ ] **Step 1: 컴포넌트**

```tsx
// src/components/scenes/EditingNameLabels.tsx
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/types';
import { formatEditorLabels } from '@/utils/editingPresence';

export function EditingNameLabels({ editors, max = 2, className }: { editors: EditingUser[]; max?: number; className?: string }) {
  if (!editors.length) return null;
  const { shown, overflow } = formatEditorLabels(editors, max);
  const aria = `${editors.map((u) => u.username).join(', ')} 편집 중`;
  return (
    <div className={cn('inline-flex items-center gap-1', className)} aria-label={aria}>
      {shown.map((u) => (
        <span key={u.userId} className="editing-namelabel"><span className="editing-namelabel__inner"><span className="editing-namelabel__dot" aria-hidden />{u.username}</span></span>
      ))}
      {overflow > 0 && (<span className="editing-namelabel"><span className="editing-namelabel__inner">+{overflow}</span></span>)}
    </div>
  );
}
```

- [ ] **Step 2: `.editing-namelabel*` 스타일(scene-effects.css)** — 무지개 테두리 small 알약(같은 conic mask 기법, 작은 padding) + 내부 `background: var(--color-bg-card...)`(테마 토큰으로 다크/라이트 자동) + 이름 텍스트 + 라이브 점(blink; reduced-motion 시 정지). 목업 스타일 이식.

- [ ] **Step 3: 타입체크** — 통과.
- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/EditingNameLabels.tsx src/styles/scene-effects.css
git commit -m "무지개 이름표 컴포넌트+스타일 추가(aria-label 포함)"
```

### Task 3: 카드뷰 적용 (motion.div 클래스, 래퍼 금지)

**Files:** Modify `src/components/scenes/UnifiedSceneCard.tsx` (최상위 `motion.div` ~280-310; `SceneWorkLinkBadges` ~312-317)

- [ ] **Step 1: 훅 + 클래스 + 이름표**

- import: `useSceneEditingPresence`, `EditingNameLabels`, `editingBeamClassName`.
- 상단: `const editors = useSceneEditingPresence([bgScene?.id, actScene?.id]);`
- **최상위 `motion.div`의 `className`에 `editingBeamClassName(editors)`를 합류**(래퍼 div 추가 금지 — Framer `layoutId`/`SceneContinuityTransition` 간섭 회피). `cn(...기존, editingBeamClassName(editors))`.
- `SceneWorkLinkBadges`와 겹치지 않는 코너(예: 좌상단 `absolute -top-3 left-3 z-20`)에 `<EditingNameLabels editors={editors} />`.

- [ ] **Step 2: 검증(미리보기)** — `?preview=1`. 콘솔에서 `useEditingPresenceStore.getState().applyPresenceSnapshot({<실제 sceneUuid>:[{userId:'x',username:'테스트'}]})` 주입 → 해당 카드 무지개 테두리 + 이름표. 2명 → 경고 톤. **카드의 layoutId 레이아웃 애니메이션/씬 연속성 전환이 여전히 정상 동작하는지 확인**(클래스만 추가라 정상이어야 함). reduced-motion(devtools rendering emulate) → 정지.

- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/UnifiedSceneCard.tsx
git commit -m "카드뷰에 실시간 편집 프레즌스(무지개 클래스+이름표) 적용"
```

### Task 4: 시트뷰 적용 (`<tr>` 클래스 + 행 pseudo, div wrapper 금지)

**Files:** Modify `src/components/scenes/UnifiedSceneSheetView.tsx`; Modify `src/styles/scene-effects.css`(`.editing-beam-row*`)

**중요:** `<tr>`은 `<div>`로 감쌀 수 없다. 기존 `.scene-row-highlighted`(scene-effects.css:95-119)가 행 하이라이트를 그리는 방식(행/셀 pseudo-element 또는 box-shadow)을 그대로 따라 `.editing-beam-row`를 만든다.

- [ ] **Step 1: `.editing-beam-row*` CSS(scene-effects.css)**

`.scene-row-highlighted` 메커니즘을 재사용해 행 전체에 회전 무지개 링/테두리. 예(행 pseudo가 가능하면):
```css
tr.editing-beam-row { position: relative; }
tr.editing-beam-row::after {
  content: ''; position: absolute; inset: 0; border-radius: 8px; z-index: 1; padding: 2px;
  background: conic-gradient(from var(--scene-effect-angle, 0deg), #FF6B6B,#FDCB6E,#4ADE80,#38BDF8,#A78BFA,#F472B6,#FF6B6B);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: scene-effect-rotate 5.5s linear infinite; pointer-events: none;
}
tr.editing-beam-row.editing-beam-row--warn::after { /* 붉은 기 무지개 */ }
@media (prefers-reduced-motion: reduce) { tr.editing-beam-row::after { animation: none; } }
```
> `<tr>` pseudo/position이 이 저장소 브라우저(Electron Chromium)에서 `.scene-row-highlighted`와 동일하게 동작하는지 확인. 동작 방식이 다르면(예: 셀 box-shadow) 그 방식을 그대로 채택.

- [ ] **Step 2: 행에 클래스 + 이름칩**

행 렌더 지점: `const editors = useSceneEditingPresence([bgSceneUuid, actSceneUuid]);` → `<tr className={cn(...기존, editingBeamRowClassName(editors))}>`. 행의 적절한 셀(예: 우측 상태 셀) 안에 `<EditingNameLabels editors={editors} max={2} />`.

- [ ] **Step 3: 검증(미리보기)** — 주입으로 확인: (a) 행 링이 **실제로 회전**하는지, (b) `<tr>::after` 링이 **행 높이/정렬을 깨지 않는지** — 깨지면 mask-padding 대신 기존 `.scene-row-highlighted`처럼 **box-shadow 방식으로 폴백**, (c) 우측 이름칩 표시, (d) 2명 경고 톤, (e) reduced-motion에서 **정지**. (CSS는 typecheck/node --test가 못 잡으니 이 육안 확인이 유일한 게이트.)
- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/UnifiedSceneSheetView.tsx src/styles/scene-effects.css
git commit -m "시트뷰 행에 실시간 편집 프레즌스 적용(scene-row-highlighted 방식)"
```

### Task 5: 상세 모달 배너

**Files:** Create `src/components/scenes/EditingPresenceBanner.tsx`; Modify `src/components/scenes/UnifiedSceneDetailModal.tsx`(본체 ~1096-1169, `bgScene?.id`/`actScene?.id` ~373); Modify `src/styles/scene-effects.css`(`.editing-banner*`)

- [ ] **Step 1: 배너 컴포넌트**

```tsx
// src/components/scenes/EditingPresenceBanner.tsx
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/types';
import { isWarnPresence } from '@/utils/editingPresence';

export function EditingPresenceBanner({ editors }: { editors: EditingUser[] }) {
  if (!editors.length) return null;
  const names = editors.map((u) => u.username).join(', ');
  return (
    <div className={cn('editing-banner', isWarnPresence(editors) && 'editing-banner--warn')} aria-label={`${names} 지금 작업 중`}>
      <span className="editing-namelabel"><span className="editing-namelabel__inner"><span className="editing-namelabel__dot" aria-hidden />{names}</span></span>
      <span className="editing-banner__text">님이 지금 작업 중 · 파일 열려 있음</span>
    </div>
  );
}
```
`.editing-banner*`(연한 무지개 스트립, warn 시 붉은 기)를 scene-effects.css에 추가.

- [ ] **Step 2: 모달 삽입** — `const editors = useSceneEditingPresence([bgScene?.id, actScene?.id]);` 후 본체 상단(제목 아래)에 `<EditingPresenceBanner editors={editors} />`. (모달은 링 없이 배너만.)
- [ ] **Step 3: 검증(미리보기)** — 모달 열고 주입 → 배너, 2명 시 전원 + 경고 톤.
- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/EditingPresenceBanner.tsx src/components/scenes/UnifiedSceneDetailModal.tsx src/styles/scene-effects.css
git commit -m "상세 모달에 실시간 편집 배너 추가(aria-label 포함)"
```

### Task 6: 개발 오버레이 제거 + PR3 마무리

**Files:** Modify `src/App.tsx`; Delete `src/components/dev/EditingPresenceDebugOverlay.tsx`

- [ ] **Step 1:** App에서 오버레이 렌더/ import 제거, 파일 삭제.
- [ ] **Step 2: 전체 검증** — `npm run typecheck && npm run test:presence && npm run build:vite` 통과. 미리보기에서 카드/시트/모달 3곳 + 다크/라이트 토글 + 다중/경고 + reduced-motion 육안 확인.
- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "개발용 프레즌스 오버레이 제거(실제 UI로 대체 완료)"
```

---

## Chunk 4 (PR4): 마무리 — 테스트·업데이트노트·버전·배포 준비

**목표:** 성능 점검, 업데이트 노트(비개발자 톤, **실제 스키마**), 버전 상향, 최종 빌드. 머지 후 배포 인계.

**File Structure:**
- Modify `DEVLOG/update-notes.json` — v1.71.0 항목(실제 스키마).
- Modify `package.json` — `"version": "1.71.0"`.

### Task 1: 성능 점검(수동)

- [ ] **Step 1: 폴링 부하** — PS 폴링 기본 4초 유지 확인(`mohoWindowPoller.ts`). Moho 미실행 시에도 4초마다 PS spawn — 작업관리자로 부하 육안 확인. 과하면 `intervalMs` 8초 상향(값 변경 시 `electron/presence/mohoWindowPoller.ts` 커밋).
- [ ] **Step 2: 명도 대비** — 다크/라이트에서 이름표/배너 대비 육안 확인. (aria-label은 Chunk 3에서 이미 컴포넌트에 부여됨.)

### Task 2: 업데이트 노트 (비개발자 톤, 실제 스키마)

**Files:** Modify `DEVLOG/update-notes.json`

**실제 스키마:** 최상위 배열, 각 릴리스 `{ "version", "title", "items": [ { "category", "summary", "description" } ] }`. **`category`는 반드시 enum**: `feature | change | bugfix | ux | stability | docs` (tests/releaseNoteCategories.test.ts 강제). `date` 필드 없음. 새 기능 → `"feature"`.

**톤 규칙(CLAUDE.md):** 기술 용어·식별자·파일경로·컴포넌트명 금지. 상황+영향+결과 시나리오. 슬랙 공유 가능한 톤.

- [ ] **Step 1: 항목 추가(파일 최상단/기존 형식에 맞춰)**

```json
{
  "version": "1.71.0",
  "title": "지금 누가 이 씬 파일을 작업 중인지 실시간으로 보여요",
  "items": [
    {
      "category": "feature",
      "summary": "연동해 둔 작업 파일을 팀원이 열면, 그 씬에 '지금 ○○님이 작업 중'이 실시간으로 떠요",
      "description": "씬에 연결해 둔 작업 파일을 누군가 열어서 작업하고 있으면, 그 씬 카드와 목록·상세 창에 무지개 테두리와 이름표로 '지금 ○○님이 작업 중'이라고 표시돼요. 같은 파일을 둘이 동시에 열면 서로 바로 알아채서, 모르고 같이 만지다 파일이 꼬이는 일을 줄여줍니다. (상대도 B flow를 켜두고 있어야 보여요.)"
    }
  ]
}
```
> 실제 파일의 기존 항목 구조(키 순서·title 유무)를 열어 확인하고 정확히 맞춘다. 유효 category 집합: feature/change/bugfix/ux/stability/docs.

- [ ] **Step 2: 검증** — `npm run test:auto-update`(releaseNoteCategories 포함) 통과.
- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/update-notes.json
git commit -m "v1.71.0 업데이트 노트 추가"
```

### Task 3: 버전 상향 + 최종 빌드

**Files:** Modify `package.json`

- [ ] **Step 1:** `"version": "1.70.0"` → `"1.71.0"`.
- [ ] **Step 2: 최종 검증** — `npm run typecheck && npm run test:auto-update && npm run test:entity && npm run test:notifications && npm run test:presence && npm run build:vite` → 전부 통과.
- [ ] **Step 3: 커밋**

```bash
git add package.json
git commit -m "v1.71.0 버전 상향"
```

### Task 4: 머지 후 배포 인계

- [ ] **Step 1:** PR4까지 머지 완료 확인.
- [ ] **Step 2:** `bflow-release-deploy` 스킬로 정식 빌드 → G드라이브 배포(**빌드 파일 먼저, `manifest.json` 마지막**) → `swap.log`/`installer-pending` 확인 → 버전 보고.
- [ ] **Step 3:** 슬랙 공지는 한솔 명시 요청 시에만.

---

## 실행 방식

- 하네스에 서브에이전트 있음 → **superpowers:subagent-driven-development** 로 태스크별 신선 서브에이전트 + 2단계 리뷰.
- 각 PR(Chunk) 완료 후: `npm run typecheck` + `test:presence` + `build:vite` 통과 → 푸시 → **codex-review-loop** 스킬로 코덱스 리뷰 반영·재트리거(명시 완료 신호까지) → 최종 코드리뷰 → 머지 → 다음 PR은 최신 main에서 분기.
- 최후 PR4 머지 후 배포 단계 수행. 승인 게이트 없음(한솔 전권 위임). 진척은 마일스톤마다 보고.
