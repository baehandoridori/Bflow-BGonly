# 실시간 "작업 중(파일 열림)" 프레즌스 — 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬에 연동된 Moho 파일을 팀원이 열면, 다른 팀원의 B flow 카드/시트/모달에 회전 무지개 테두리 + 무지개 이름표로 실시간 표시한다.

**Architecture:** 각 PC의 Electron 메인이 Moho 창 제목을 폴링해 "내가 편집 중인 씬"을 판정 → 기존 `bflow-realtime` 채널에 Supabase presence로 방송(추가 회선 0, 끊기면 자동 소멸) → 메인이 전체 프레즌스를 병합해 IPC로 렌더러에 스냅샷 전달 → 렌더러가 표시. 감지·전파는 메인, 표시는 렌더러(IPC 규칙 준수).

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Supabase Realtime(presence), Tailwind, PowerShell(child_process spawn), 테스트는 `node --test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-07-04-scene-editing-presence-design.md`

**테스트 규약 (이 저장소):**
- 파일: `tests/<name>.test.ts`, `import test from 'node:test'; import assert from 'node:assert/strict';`, 소스는 `.ts` 확장자로 import (예: `from '../electron/presence/mohoTitleParser.ts'`).
- 실행: `node --test ./tests/<name>.test.ts` (Node 22.18 타입 스트리핑, 별도 로더 없음).
- 등록: 새 그룹 `test:presence`를 `package.json`에 만들고 `build`/`build:vite` 체인에 넣어 빌드가 커버하게 한다.
- RTL/jsdom 없음 → UI는 미리보기 모드(`?preview=1`, mock '배한솔')로 수동 검증. 순수 로직만 자동 테스트.

**공용 타입 (PR1에서 `electron/presence/types.ts`에 정의):**
```ts
export interface EditingUser {
  userId: string;
  username: string;
}
/** sceneUuid -> 그 씬을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
```

**PR/브랜치 규약:** 각 PR은 직전 PR 머지 후의 `main`에서 분기. 각 PR = 구현 → `npm run typecheck` + `test:presence` + `build:vite` 통과 → 푸시 → `codex-review-loop` 스킬로 코덱스 리뷰 반영 → 최종 코드리뷰 → 머지. 슬랙 공지·G드라이브 배포는 명시적 단계(PR4 이후)에서만.

---

## Chunk 1 (PR1): 감지 엔진 (main, 순수 코어 + 폴러)

**목표:** Moho 창 제목 → 정규화 basename 파서(U1 코어)와 `scene_work_links` basename→sceneUuid 인덱스(U2)를 순수 함수로 만들고 단위 테스트한다. PowerShell 폴러(win32 가드)와 실측용 디버그 스크립트를 추가한다. main.ts 배선은 PR2에서.

**File Structure:**
- Create `electron/presence/types.ts` — 공용 타입(위 참조). 단일 책임: 타입 정의.
- Create `electron/presence/mohoTitleParser.ts` — 순수: 창 제목 줄 → basename 배열. I/O 없음.
- Create `electron/presence/sceneLinkIndex.ts` — 순수: 링크 배열 → basename 인덱스, basename → sceneUuid 해석. I/O 없음.
- Create `electron/presence/mohoWindowPoller.ts` — I/O: PS 실행 + 주기 폴링 + 변경 감지. 얇은 글루.
- Create `scripts/debug-moho-titles.mjs` — 실측 도구(프로세스명·제목 형식 확인용).
- Create `tests/mohoTitleParser.test.ts`, `tests/sceneLinkIndex.test.ts`.
- Modify `package.json` — `test:presence` 그룹 추가 + `build`/`build:vite`에 연결.

### Task 1: 공용 타입 파일

**Files:**
- Create: `electron/presence/types.ts`

- [ ] **Step 1: 타입 파일 작성**

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
git commit -m "프레즌스 공용 타입 추가"
```

### Task 2: Moho 창 제목 파서 (순수 코어, TDD)

**Files:**
- Create: `electron/presence/mohoTitleParser.ts`
- Test: `tests/mohoTitleParser.test.ts`

**동작 명세:** 각 창 제목 줄에서 (1) 후행 앱 접미사 ` -Moho`(버전 표기 포함, 대소문자 무시) 제거, (2) 미저장 표시 `*` 제거, (3) 남은 문자열이 Moho 프로젝트 확장자(`.moho`/`.mohoproj`/`.anime`)로 끝날 때만 채택, (4) 소문자화, (5) 중복 제거. 실측 기준 제목 예: `b030.moho -Moho`.

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

- [ ] **Step 2: 실패 확인**

Run: `node --test ./tests/mohoTitleParser.test.ts`
Expected: FAIL — `parseMohoTitles`가 없어 import 에러/실패.

- [ ] **Step 3: 최소 구현**

```ts
// electron/presence/mohoTitleParser.ts

/** Moho 프로젝트 파일 확장자 */
const MOHO_EXT = /\.(moho|mohoproj|anime)$/i;

/** 후행 앱 접미사: " -Moho", " - Moho Pro", " — Moho Debut" 등 */
const APP_SUFFIX = /\s*[-–—]\s*Moho(\s+(Pro|Debut|Anime\s*Studio))?\s*$/i;

/** 창 제목 한 줄을 정규화된 basename(소문자, 확장자 포함)으로. 실패 시 null. */
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
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test ./tests/mohoTitleParser.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git add electron/presence/mohoTitleParser.ts tests/mohoTitleParser.test.ts
git commit -m "Moho 창 제목 파서 추가(순수 코어+테스트)"
```

### Task 3: 씬 링크 인덱스 (순수 코어, TDD)

**Files:**
- Create: `electron/presence/sceneLinkIndex.ts`
- Test: `tests/sceneLinkIndex.test.ts`

**동작 명세:** `SupabaseSceneWorkLink[]` 중 `linkKind==='primary_file'`인 것만 대상. `path.win32.basename(path).toLowerCase()` → `Map<basename, Set<sceneUuid>>`. 해석 시 basename 목록 → 매칭 sceneUuid 유니크 배열 + 콜리전(1 basename이 다중 sceneUuid) basename 목록 반환. **Windows 경로(백슬래시)를 host OS와 무관하게 다루기 위해 `path.win32` 사용.**

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/sceneLinkIndex.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from '../electron/presence/sceneLinkIndex.ts';
import type { SupabaseSceneWorkLink } from '../electron/supabase.ts';

function lnk(p: Partial<SupabaseSceneWorkLink> & Pick<SupabaseSceneWorkLink, 'sceneUuid' | 'linkKind' | 'path'>): SupabaseSceneWorkLink {
  return {
    id: p.path, department: 'bg', label: null, sortOrder: 0,
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

- [ ] **Step 2: 실패 확인**

Run: `node --test ./tests/sceneLinkIndex.test.ts`
Expected: FAIL.

- [ ] **Step 3: 최소 구현**

```ts
// electron/presence/sceneLinkIndex.ts
import { win32 as pathWin32 } from 'node:path';
import type { SupabaseSceneWorkLink } from '../supabase.ts';

/** primary_file 링크의 basename(소문자) → 그 파일이 연동된 sceneUuid 집합 */
export function buildPrimaryFileBasenameIndex(
  links: SupabaseSceneWorkLink[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const link of links ?? []) {
    if (link.linkKind !== 'primary_file' || !link.path) continue;
    const base = pathWin32.basename(link.path).toLowerCase();
    if (!base) continue;
    let set = index.get(base);
    if (!set) index.set(base, (set = new Set()));
    set.add(link.sceneUuid);
  }
  return index;
}

export interface ResolveResult {
  sceneUuids: string[];
  collisions: string[];
}

/** 정규화된 basename 목록 → 매칭 sceneUuid(유니크) + 콜리전 basename 목록 */
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

- [ ] **Step 4: 통과 확인**

Run: `node --test ./tests/sceneLinkIndex.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add electron/presence/sceneLinkIndex.ts tests/sceneLinkIndex.test.ts
git commit -m "씬 링크 basename 인덱스 추가(순수 코어+테스트)"
```

### Task 4: PowerShell 폴러 (I/O, win32 가드)

**Files:**
- Create: `electron/presence/mohoWindowPoller.ts`

**참고:** `spawn` 패턴은 `electron/autoUpdate/installerApply.ts`를 따른다. `Get-Process -Name *moho*`의 MainWindowTitle을 줄 단위로 반환. 창 제목이 없으면 빈 줄. 실패는 조용히 빈 배열.

- [ ] **Step 1: 구현**

```ts
// electron/presence/mohoWindowPoller.ts
import { spawn } from 'node:child_process';
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
    } catch {
      done([]);
    }
  });
}

/**
 * 주기 폴링을 시작한다. 이전 결과와 basename 집합이 달라질 때만 onChange 호출.
 * @returns 폴링 중단 함수
 */
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
    if (key !== prevKey) {
      prevKey = key;
      opts.onChange(basenames);
    }
  };

  if (process.platform === 'win32') {
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
  }

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add electron/presence/mohoWindowPoller.ts
git commit -m "Moho 창 제목 폴러 추가(win32 가드, 변경 감지)"
```

### Task 5: 실측 디버그 스크립트

**Files:**
- Create: `scripts/debug-moho-titles.mjs`

**목적:** 한솔 Windows PC에서 실행해 §10 실측 항목(실제 프로세스명·제목 형식) 확인. raw 제목과 파싱 결과를 출력.

- [ ] **Step 1: 작성**

```js
// scripts/debug-moho-titles.mjs
// 사용: node scripts/debug-moho-titles.mjs   (Moho를 켜둔 상태에서 실행)
import { spawn } from 'node:child_process';

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

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: `test:presence` 스크립트 추가**

`package.json`의 `scripts`에 추가:
```json
"test:presence": "node --test ./tests/mohoTitleParser.test.ts ./tests/sceneLinkIndex.test.ts",
```

- [ ] **Step 2: `build`/`build:vite` 체인에 연결**

`build`와 `build:vite`의 테스트 실행 구간에 `npm run test:presence &&`를 `npm run test:notifications` 다음에 삽입. 예(`build:vite`):
```
"build:vite": "npm run typecheck && npm run test:auto-update && npm run test:entity && npm run test:notifications && npm run test:presence && vite build && node scripts/generate-manifest.js --allow-missing-installer",
```
`build`에도 동일하게 `&& npm run test:presence` 삽입.

- [ ] **Step 3: 검증**

Run: `npm run test:presence`
Expected: PASS (parser 6 + index 3 = 9 tests).

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add package.json
git commit -m "test:presence 그룹 추가 및 빌드 체인 연결"
```

### Task 7: PR1 마무리 검증

- [ ] **Step 1: 전체 프레즌스 테스트 + 타입체크 + vite 빌드**

Run: `npm run typecheck && npm run test:presence && npm run build:vite`
Expected: 전부 통과.

- [ ] **Step 2: (한솔 PC에서, 선택) 실측**

Run: `node scripts/debug-moho-titles.mjs` (Moho에 파일 열어둔 상태)
확인: 실제 ProcessName이 `*moho*`로 잡히는지, MainWindowTitle이 `<파일명>.moho -Moho` 형식인지. 다르면 `MOHO_PS_ARGS`/`APP_SUFFIX` 조정 후 파서 테스트 갱신.

> PR1은 여기까지. main.ts 배선/UI 없음. 순수 코어는 100% 테스트, 폴러/스크립트는 실측 도구로 검증 준비 완료.

---

## Chunk 2 (PR2): 프레즌스 전송 (main track/수신 + IPC + 렌더러 스토어)

**목표:** 메인이 폴러 결과로 `channel.track()`하고, presence를 수신·병합해 IPC로 렌더러에 스냅샷 전달. 렌더러 스토어·선택자까지 배선하고, 개발용 오버레이로 종단 검증.

**File Structure:**
- Create `electron/presence/presenceMerge.ts` — 순수: Supabase presenceState → `EditingPresenceSnapshot`.
- Create `electron/presence/editingPresenceService.ts` — 메인 오케스트레이터(폴러↔인덱스↔track↔수신↔broadcast). scene_work_links 캐시 보유.
- Modify `electron/realtime.ts` — 채널에 `.on('presence', …)` 추가 + 채널/track 핸들·`onPresenceSync` 콜백 노출.
- Modify `electron/main.ts` — 서비스 기동, `broadcastSupabasePresence`, 현재 사용자 주입, scene_work_link 캐시 갱신 배선.
- Modify `electron/preload.ts` — `onSupabasePresence` 추가.
- Create `src/utils/editingPresence.ts` — 순수 선택자(자기 제외, 라벨 포맷, 경고 판정).
- Create `src/stores/useEditingPresenceStore.ts` — 스냅샷 보관 스토어 + `useSceneEditingPresence` 훅.
- Modify 렌더러 구독부(예: `src/App.tsx` 또는 `onSupabaseRealtime` 소비 지점) — `onSupabasePresence` 구독.
- Create `src/components/dev/EditingPresenceDebugOverlay.tsx` — DEV 전용 오버레이(PR3에서 제거).
- Create `tests/presenceMerge.test.ts`, `tests/editingPresenceSelectors.test.ts`.
- Modify `package.json` — `test:presence`에 두 파일 추가.

### Task 1: presence 병합 (순수, TDD)

**Files:**
- Create: `electron/presence/presenceMerge.ts`
- Test: `tests/presenceMerge.test.ts`

**명세:** Supabase `channel.presenceState()`는 `Record<presenceKey, Array<payload>>` 형태(payload = track한 `EditingPresencePayload`). 이를 `sceneUuid → EditingUser[]`(userId 기준 dedupe)로 병합.

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
  const state = {
    u1: [
      { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
      { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
    ],
  };
  assert.equal(mergePresenceState(state)['s1'].length, 1);
});

test('편집 씬 없으면 빈 스냅샷', () => {
  assert.deepEqual(mergePresenceState({ u1: [{ userId: 'u1', username: 'x', editingSceneUuids: [], updatedAt: '' }] }), {});
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/presenceMerge.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// electron/presence/presenceMerge.ts
import type { EditingPresencePayload, EditingPresenceSnapshot, EditingUser } from './types.ts';

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

- [ ] **Step 4: 통과 확인** — PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add electron/presence/presenceMerge.ts tests/presenceMerge.test.ts
git commit -m "presence 병합 함수 추가(순수+테스트)"
```

### Task 2: 렌더러 선택자 (순수, TDD)

**Files:**
- Create: `src/utils/editingPresence.ts`
- Test: `tests/editingPresenceSelectors.test.ts`

**명세:** 스냅샷에서 씬(복수 uuid 유니온)의 편집자 선택(자기 제외), 라벨 포맷(최대 N + overflow), 경고 판정(≥2명).

- [ ] **Step 1: 실패 테스트**

```ts
// tests/editingPresenceSelectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEditorsForScenes, formatEditorLabels, isWarnPresence } from '../src/utils/editingPresence.ts';

const snap = {
  s1: [{ userId: 'u1', username: '배한솔' }, { userId: 'u2', username: '김민수' }],
  s2: [{ userId: 'u2', username: '김민수' }],
};

test('여러 sceneUuid 유니온 + 자기 자신 제외 + userId dedupe', () => {
  const r = selectEditorsForScenes(snap, ['s1', 's2'], 'u1');
  assert.deepEqual(r.map((u) => u.userId), ['u2']);
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
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현**

```ts
// src/utils/editingPresence.ts
import type { EditingUser, EditingPresenceSnapshot } from '../../electron/presence/types.ts';

export type { EditingUser, EditingPresenceSnapshot };

/** 여러 sceneUuid의 편집자 유니온에서 자기 자신 제외(userId dedupe) */
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

export function formatEditorLabels(
  editors: EditingUser[],
  max = 2,
): { shown: EditingUser[]; overflow: number } {
  return { shown: editors.slice(0, max), overflow: Math.max(0, editors.length - max) };
}

/** 2명 이상 동시 편집이면 경고 톤 */
export function isWarnPresence(editors: EditingUser[]): boolean {
  return editors.length >= 2;
}
```

> **Note:** 렌더러가 `electron/presence/types.ts`를 import한다. 두 tsconfig(app/node)가 이를 포함하는지 실행 시 확인하고, 문제가 있으면 타입을 `src/types/index.ts`로 재수출한다.

- [ ] **Step 4: 통과 확인** — PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/utils/editingPresence.ts tests/editingPresenceSelectors.test.ts
git commit -m "프레즌스 렌더러 선택자 추가(순수+테스트)"
```

### Task 3: realtime.ts에 presence 훅 추가

**Files:**
- Modify: `electron/realtime.ts`

**명세:** 기존 `bflow-realtime` 채널 빌더에 (1) `.on('presence', { event: '*' }, () => callbacks.onPresenceSync?.(channel.presenceState()))` 추가, (2) 채널 subscribe 상태 콜백에서 `SUBSCRIBED` 시 초기 track 가능하도록 채널 참조를 반환/노출, (3) 콜백 타입에 `onPresenceSync?: (state: unknown) => void` 추가.

- [ ] **Step 1: 콜백 타입 + presence 핸들러 추가**

`setupRealtimeSubscription`(또는 채널 생성 함수)의 콜백 인터페이스에 `onPresenceSync?: (state: Record<string, unknown[]>) => void;`를 추가하고, 채널 빌더에 다음을 체이닝:
```ts
.on('presence', { event: 'sync' }, () => {
  callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>);
})
.on('presence', { event: 'join' }, () => {
  callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>);
})
.on('presence', { event: 'leave' }, () => {
  callbacks.onPresenceSync?.(channel.presenceState() as Record<string, unknown[]>);
})
```

- [ ] **Step 2: 채널 참조 반환**

함수가 채널(또는 `{ channel, unsubscribe }`)을 반환하도록 조정해, main.ts가 `channel.track(payload)`를 호출할 수 있게 한다. 기존 반환 사용처가 있으면 호환 유지(객체 확장).

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add electron/realtime.ts
git commit -m "realtime 채널에 presence sync/join/leave 훅 추가"
```

### Task 4: 메인 오케스트레이터 서비스

**Files:**
- Create: `electron/presence/editingPresenceService.ts`

**명세:** 단일 책임 = "폴러 결과 → track / presence 수신 → 스냅샷 콜백". main.ts가 의존성(현재 사용자, 채널 track 함수, 링크 조회 함수, broadcast 함수)을 주입한다. scene_work_links 캐시는 main.ts가 갱신해 이 서비스에 최신 인덱스를 제공(또는 링크 배열 getter 주입).

- [ ] **Step 1: 구현**

```ts
// electron/presence/editingPresenceService.ts
import type { SupabaseSceneWorkLink } from '../supabase.ts';
import type { EditingPresenceSnapshot, EditingPresencePayload } from './types.ts';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from './sceneLinkIndex.ts';
import { startMohoTitlePolling } from './mohoWindowPoller.ts';
import { mergePresenceState } from './presenceMerge.ts';

export interface EditingPresenceDeps {
  getCurrentUser: () => { userId: string; username: string } | null;
  getWorkLinks: () => SupabaseSceneWorkLink[];
  track: (payload: EditingPresencePayload) => void;
  broadcast: (snapshot: EditingPresenceSnapshot) => void;
  now: () => string; // 테스트 주입용, 기본 new Date().toISOString()
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

  // presence 수신은 main.ts가 onPresenceSync → receivePresence로 연결
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

### Task 5: main.ts 배선 + broadcast + preload

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

**명세:** (1) `broadcastSupabasePresence(snapshot)`를 `broadcastSupabaseEvent`(main.ts:2637) 옆에 추가 — IPC 채널 `'supabase:presence-event'`로 `mainWindow` + `widgetWindows`에 전송. (2) realtime 셋업 시 `onPresenceSync: (state) => receivePresence(state, broadcastSupabasePresence)` 연결하고 채널 참조 확보. (3) 로그인/세션 확정 후 `startEditingPresenceService({...})` 기동 — `getCurrentUser`(기존 현재 사용자 식별), `getWorkLinks`(main의 scene_work_links 캐시), `track: (p) => channel.track(p)`, `broadcast: broadcastSupabasePresence`, `now: () => new Date().toISOString()`, `logCollision`. (4) main이 scene_work_links를 캐시로 보유 — 초기 로드 + 기존 `onSceneWorkLinkChange`(main.ts:2571 부근)에서 캐시 갱신. (5) preload에 `onSupabasePresence` 추가.

- [ ] **Step 1: preload에 onSupabasePresence 추가**

`electron/preload.ts`의 `onSupabaseRealtime`(353) 패턴 복제, 채널명만 `'supabase:presence-event'`:
```ts
onSupabasePresence: (callback: (snapshot: unknown) => void) => {
  const handler = (_e: unknown, data: unknown) => callback(data);
  ipcRenderer.on('supabase:presence-event', handler);
  return () => ipcRenderer.removeListener('supabase:presence-event', handler);
},
```
그리고 preload의 타입 선언(있다면 `ElectronAPI` 인터페이스, `src/types` 또는 preload d.ts)에 시그니처 추가.

- [ ] **Step 2: main.ts에 broadcastSupabasePresence 추가**

`broadcastSupabaseEvent` 근처:
```ts
function broadcastSupabasePresence(snapshot: EditingPresenceSnapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('supabase:presence-event', snapshot);
  for (const win of widgetWindows.values()) if (!win.isDestroyed()) win.webContents.send('supabase:presence-event', snapshot);
}
```

- [ ] **Step 3: main.ts에 scene_work_links 캐시 + 서비스 기동**

- 모듈 스코프: `let sceneWorkLinkCache: SupabaseSceneWorkLink[] = [];`
- 초기 데이터 로드 시 `sceneWorkLinkCache = await readSceneWorkLinks();`
- 기존 `onSceneWorkLinkChange` 콜백에서 캐시를 최신화(간단히 `readSceneWorkLinks()` 재조회 또는 payload 반영).
- realtime 셋업에 `onPresenceSync: (state) => receivePresence(state as any, broadcastSupabasePresence)` 추가, 반환 `channel` 확보.
- 세션 확정 후:
```ts
const stopPresence = startEditingPresenceService({
  getCurrentUser: () => currentUser ? { userId: currentUser.id, username: currentUser.name } : null,
  getWorkLinks: () => sceneWorkLinkCache,
  track: (p) => channel?.track(p),
  broadcast: broadcastSupabasePresence,
  now: () => new Date().toISOString(),
  logCollision: (b) => console.warn('[presence] basename 콜리전:', b),
});
```
- 앱 종료/로그아웃 시 `stopPresence()`.

> `currentUser`의 정확한 식별 필드(id/name)는 main.ts의 기존 로그인 상태에서 확인. 없으면 name을 userId로 사용(문서화).

- [ ] **Step 4: 타입체크 + vite 빌드**

Run: `npm run typecheck && npm run build:vite`
Expected: 통과.

- [ ] **Step 5: 커밋**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "메인 프레즌스 배선: track/수신/broadcast + preload onSupabasePresence"
```

### Task 6: 렌더러 스토어 + 구독 + 개발 오버레이

**Files:**
- Create: `src/stores/useEditingPresenceStore.ts`
- Create: `src/components/dev/EditingPresenceDebugOverlay.tsx`
- Modify: 렌더러 구독부(예: `src/App.tsx`)

- [ ] **Step 1: 스토어 + 훅**

```ts
// src/stores/useEditingPresenceStore.ts
import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { selectEditorsForScenes } from '@/utils/editingPresence';
import type { EditingPresenceSnapshot, EditingUser } from '@/utils/editingPresence';

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
> `useAuthStore`의 현재 사용자 접근자(`currentUser?.id`)는 실제 스토어에 맞춰 확인·수정. 참조 안정성을 위해 필요 시 `useMemo`/`shallow`로 감싼다.

- [ ] **Step 2: 구독 배선**

`onSupabaseRealtime` 구독 지점(App.tsx 등)에서 병행 구독:
```ts
useEffect(() => {
  const off = window.electronAPI?.onSupabasePresence?.((snap) =>
    useEditingPresenceStore.getState().applyPresenceSnapshot(snap as EditingPresenceSnapshot),
  );
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
      {rows.map(([uuid, users]) => (
        <div key={uuid}>{uuid.slice(0, 8)}: {users.map((u) => u.username).join(', ')}</div>
      ))}
    </div>
  );
}
```
App 루트에 `{import.meta.env.DEV && <EditingPresenceDebugOverlay />}` 렌더.

- [ ] **Step 4: 타입체크 + vite 빌드** — 통과.

- [ ] **Step 5: package.json `test:presence`에 두 테스트 추가 + 전체 통과**

`test:presence`를 4개 파일로 확장:
```json
"test:presence": "node --test ./tests/mohoTitleParser.test.ts ./tests/sceneLinkIndex.test.ts ./tests/presenceMerge.test.ts ./tests/editingPresenceSelectors.test.ts",
```
Run: `npm run typecheck && npm run test:presence && npm run build:vite`
Expected: 전부 통과 (파서6+인덱스3+병합3+선택자4 = 16 tests).

- [ ] **Step 6: 커밋**

```bash
git add src/stores/useEditingPresenceStore.ts src/components/dev/EditingPresenceDebugOverlay.tsx src/App.tsx package.json
git commit -m "프레즌스 렌더러 스토어·구독·개발 오버레이 배선"
```

### Task 7: PR2 종단 검증 (개발 오버레이)

- [ ] **Step 1: 미리보기 모드 2계정 수동 검증**

`npm run dev` + `?preview=1` 두 창(또는 두 계정). 한쪽에서 연동된 `.moho`를 실제로 Moho에 열기 → 반대쪽 개발 오버레이에 해당 sceneUuid + 이름 표시(≤6초). 닫으면 사라짐.
> Windows·Moho 없는 환경이면 오버레이는 비지만, 수신 경로는 오버레이에 임시 track을 주입하는 방식으로 확인 가능(개발 콘솔에서 `useEditingPresenceStore.getState().applyPresenceSnapshot({s1:[{userId:'x',username:'테스트'}]})` → 오버레이 렌더 확인).

- [ ] **Step 2: PR2 마무리**

Run: `npm run typecheck && npm run test:presence && npm run build:vite`
Expected: 통과. 오버레이는 PR3에서 실제 UI로 대체·제거.

---

## Chunk 3 (PR3): UI (무지개 테두리 + 이름표 + 배너)

**목표:** 회전 무지개 테두리(U7)와 이름표/배너(U6)를 카드·시트·모달에 적용. 다크/라이트·모션 최소화·다중 편집자/경고 톤·자기 제외. 개발 오버레이 제거.

**File Structure:**
- Modify 전역 CSS(예: `src/index.css`) — `@property --presence-angle`, `@keyframes presence-spin`, `.editing-beam*` 클래스, reduced-motion 미디어쿼리.
- Create `src/components/scenes/EditingPresenceBeam.tsx` — 자식을 무지개 테두리로 감싸는 wrapper(편집자 0명이면 그대로 통과). normal/warn variant.
- Create `src/components/scenes/EditingNameLabels.tsx` — 무지개 이름표(최대 2 + `+N`).
- Create `src/components/scenes/EditingPresenceBanner.tsx` — 모달 배너(전원 나열 + 경고 톤).
- Modify `src/components/scenes/UnifiedSceneCard.tsx` — 카드 wrap + 이름표.
- Modify `src/components/scenes/UnifiedSceneSheetView.tsx` — 행 wrap + 이름칩.
- Modify `src/components/scenes/UnifiedSceneDetailModal.tsx` — 배너.
- Remove `src/components/dev/EditingPresenceDebugOverlay.tsx` 렌더(파일은 삭제 또는 잔존하되 미사용). 삭제 권장.

### Task 1: 전역 CSS — 회전 무지개

**Files:**
- Modify: `src/index.css` (main.tsx가 import하는 전역 스타일; 실제 경로 확인)

- [ ] **Step 1: CSS 추가**

```css
/* 실시간 편집 프레즌스 — 회전 무지개 테두리 */
@property --presence-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes presence-spin { to { --presence-angle: 360deg; } }

.editing-beam { position: relative; border-radius: inherit; }
.editing-beam::before {
  content: ''; position: absolute; inset: -2px; border-radius: inherit; z-index: 0;
  padding: 2px;
  background: conic-gradient(from var(--presence-angle),
    #FF6B6B, #FDCB6E, #4ADE80, #38BDF8, #A78BFA, #F472B6, #FF6B6B);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: presence-spin 5.5s linear infinite;
  pointer-events: none;
}
.editing-beam.editing-beam--warn::before {
  background: conic-gradient(from var(--presence-angle),
    #FF4D4D, #FF6B6B, #FDCB6E, #FF6B6B, #FF4D4D, #F472B6, #FF4D4D);
}
.editing-beam > * { position: relative; z-index: 1; }
@media (prefers-reduced-motion: reduce) {
  .editing-beam::before { animation: none; }
}
```
> `mask-composite`로 테두리 링만 남긴다(내부 콘텐츠를 덮지 않음). 목업의 padding-덮기 방식과 달리 레이아웃 영향 0.

- [ ] **Step 2: 커밋**

```bash
git add src/index.css
git commit -m "회전 무지개 프레즌스 테두리 전역 CSS 추가(모션/경고 대응)"
```

### Task 2: EditingPresenceBeam 컴포넌트

**Files:**
- Create: `src/components/scenes/EditingPresenceBeam.tsx`

- [ ] **Step 1: 구현**

```tsx
// src/components/scenes/EditingPresenceBeam.tsx
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/utils/editingPresence';
import { isWarnPresence } from '@/utils/editingPresence';

/** 편집자가 있으면 자식을 회전 무지개 테두리로 감싼다. 없으면 그대로 통과(레이아웃 불변). */
export function EditingPresenceBeam({
  editors, className, children,
}: { editors: EditingUser[]; className?: string; children: React.ReactNode }) {
  if (!editors.length) return <>{children}</>;
  return (
    <div className={cn('editing-beam', isWarnPresence(editors) && 'editing-beam--warn', className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크** — 통과.
- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/EditingPresenceBeam.tsx
git commit -m "EditingPresenceBeam 래퍼 컴포넌트 추가"
```

### Task 3: EditingNameLabels 컴포넌트

**Files:**
- Create: `src/components/scenes/EditingNameLabels.tsx`

- [ ] **Step 1: 구현**

무지개 이름표(테두리 무지개, 내부는 테마 토큰 표면, 이름 텍스트). 목업 스타일을 Tailwind + CSS로. 최대 2 + `+N`.
```tsx
// src/components/scenes/EditingNameLabels.tsx
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/utils/editingPresence';
import { formatEditorLabels } from '@/utils/editingPresence';

export function EditingNameLabels({
  editors, max = 2, className,
}: { editors: EditingUser[]; max?: number; className?: string }) {
  if (!editors.length) return null;
  const { shown, overflow } = formatEditorLabels(editors, max);
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      {shown.map((u) => (
        <span key={u.userId} className="editing-namelabel">
          <span className="editing-namelabel__inner">
            <span className="editing-namelabel__dot" />
            {u.username}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="editing-namelabel"><span className="editing-namelabel__inner">+{overflow}</span></span>
      )}
    </div>
  );
}
```
그리고 `src/index.css`에 `.editing-namelabel*` 스타일 추가(무지개 테두리 small + 내부 `bg-bg-card` 토큰 + 라이브 점 blink; reduced-motion 시 회전/점멸 정지). CSS는 목업 구현을 이식.

- [ ] **Step 2: index.css에 이름표 스타일 추가 + 타입체크** — 통과.
- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/EditingNameLabels.tsx src/index.css
git commit -m "무지개 이름표 컴포넌트+스타일 추가"
```

### Task 4: 카드뷰 적용

**Files:**
- Modify: `src/components/scenes/UnifiedSceneCard.tsx` (최상위 `motion.div` ~280-310, `SceneWorkLinkBadges` ~312-317)

- [ ] **Step 1: 훅 + wrap + 이름표**

- import: `useSceneEditingPresence`, `EditingPresenceBeam`, `EditingNameLabels`.
- 컴포넌트 상단: `const editors = useSceneEditingPresence([bgScene?.id, actScene?.id]);`
- 최상위 `motion.div`를 `EditingPresenceBeam`으로 감싼다(또는 `motion.div`에 `editing-beam` 클래스를 조건부로 부여 — 레이아웃/기존 애니메이션과의 간섭이 없는 쪽 선택; 우선 wrapper 방식).
- `SceneWorkLinkBadges`와 겹치지 않는 코너(예: 좌상단 `-top-3 left-3`)에 `<EditingNameLabels editors={editors} />`를 절대 배치.

- [ ] **Step 2: 검증(미리보기 모드)**

`npm run dev` + `?preview=1`. 콘솔에서 `useEditingPresenceStore.getState().applyPresenceSnapshot({<실제 sceneUuid>:[{userId:'x',username:'테스트'}]})` 주입 → 해당 카드에 무지개 테두리 + 이름표. 2명 주입 → 경고 톤. reduced-motion(OS 설정 또는 devtools rendering emulate) → 정지.

- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/UnifiedSceneCard.tsx
git commit -m "카드뷰에 실시간 편집 프레즌스(무지개+이름표) 적용"
```

### Task 5: 시트뷰 적용

**Files:**
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`

- [ ] **Step 1: 행 wrap + 이름칩**

행 렌더 지점에서 `const editors = useSceneEditingPresence([bgSceneUuid, actSceneUuid]);` 후 행 최상위 wrapper를 `EditingPresenceBeam`으로 감싼다(행 전체 테두리 회전, 통일감). 행 우측 끝에 `<EditingNameLabels editors={editors} max={2} />`.
> 시트 행 구조에 맞춰 `editing-beam`이 행 높이/정렬을 깨지 않도록 `border-radius`/`inset` 조정. 필요 시 행 전용 `.editing-beam--row` 변형 추가.

- [ ] **Step 2: 검증(미리보기)** — 카드와 동일 주입 방식으로 해당 행 무지개 + 칩 확인.
- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/UnifiedSceneSheetView.tsx src/index.css
git commit -m "시트뷰 행에 실시간 편집 프레즌스 적용(행 테두리 회전)"
```

### Task 6: 상세 모달 배너

**Files:**
- Create: `src/components/scenes/EditingPresenceBanner.tsx`
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx` (본체 wrapper ~1096-1169, `bgScene?.id`/`actScene?.id` ~373)

- [ ] **Step 1: 배너 컴포넌트**

```tsx
// src/components/scenes/EditingPresenceBanner.tsx
import { cn } from '@/utils/cn';
import type { EditingUser } from '@/utils/editingPresence';
import { isWarnPresence } from '@/utils/editingPresence';

export function EditingPresenceBanner({ editors }: { editors: EditingUser[] }) {
  if (!editors.length) return null;
  const names = editors.map((u) => u.username).join(', ');
  return (
    <div className={cn('editing-banner', isWarnPresence(editors) && 'editing-banner--warn')}>
      <span className="editing-namelabel"><span className="editing-namelabel__inner"><span className="editing-namelabel__dot" />{names}</span></span>
      <span className="editing-banner__text">님이 지금 작업 중 · 파일 열려 있음</span>
    </div>
  );
}
```
`.editing-banner*` 스타일을 index.css에 추가(연한 무지개 배경 스트립, warn 시 붉은 기).

- [ ] **Step 2: 모달에 배너 삽입**

`UnifiedSceneDetailModal`에서 `const editors = useSceneEditingPresence([bgScene?.id, actScene?.id]);` 후 본체 상단(제목 아래)에 `<EditingPresenceBanner editors={editors} />`.

- [ ] **Step 3: 검증(미리보기)** — 모달 열고 주입 → 배너 표시, 2명 시 전원 나열 + 경고 톤.
- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/EditingPresenceBanner.tsx src/components/scenes/UnifiedSceneDetailModal.tsx src/index.css
git commit -m "상세 모달에 실시간 편집 배너 추가"
```

### Task 7: 개발 오버레이 제거 + PR3 마무리

**Files:**
- Modify: `src/App.tsx` (오버레이 렌더 제거)
- Delete: `src/components/dev/EditingPresenceDebugOverlay.tsx`

- [ ] **Step 1: 오버레이 제거**

App에서 `<EditingPresenceDebugOverlay />` 렌더 및 import 제거, 파일 삭제.

- [ ] **Step 2: 전체 검증**

Run: `npm run typecheck && npm run test:presence && npm run build:vite`
Expected: 통과. 미리보기에서 카드/시트/모달 3곳 + 다크/라이트 토글 + 다중/경고 + reduced-motion 육안 확인.

- [ ] **Step 3: 커밋**

```bash
git add -A
git commit -m "개발용 프레즌스 오버레이 제거(실제 UI로 대체 완료)"
```

---

## Chunk 4 (PR4): 마무리 — 테스트·업데이트노트·버전·배포 준비

**목표:** 접근성/성능 점검, 업데이트 노트(비개발자 톤), 버전 상향, 최종 빌드. 머지 후 배포 단계로 인계.

**File Structure:**
- Modify `DEVLOG/update-notes.json` — v1.71.0 항목(비개발자 톤).
- Modify `package.json` — `"version": "1.71.0"`.
- (선택) 성능: 폴링 주기/디바운스 상수 재확인.

### Task 1: 성능·접근성 점검

- [ ] **Step 1: 폴링 부하 확인**

PS 폴링 주기 기본 4초 유지 확인(`mohoWindowPoller.ts`). Moho 미실행 시에도 4초마다 PS 1회 spawn됨 — 부하 육안 확인(작업관리자). 과하면 8초로 상향. 값 조정 시 커밋.

- [ ] **Step 2: 접근성**

`reduced-motion`에서 회전/점멸 정지 재확인. 이름표/배너 명도 대비(다크/라이트) 육안 확인. 이름표에 `aria-label`("○○ 편집 중") 부여(스크린리더).

- [ ] **Step 3: 커밋(변경 시)**

```bash
git add -A
git commit -m "프레즌스 성능/접근성 점검 반영"
```

### Task 2: 업데이트 노트 (비개발자 톤)

**Files:**
- Modify: `DEVLOG/update-notes.json`

**톤 규칙(CLAUDE.md):** 기술 용어·식별자·파일경로·컴포넌트명 금지. 상황+영향+결과 시나리오. 슬랙 공유 가능한 톤.

- [ ] **Step 1: 항목 추가**

기존 형식에 맞춰 v1.71.0 항목 추가. 예시 톤:
```json
{
  "version": "1.71.0",
  "date": "2026-07-04",
  "category": "새 기능",
  "summary": "같은 씬 파일을 지금 누가 열어 작업 중인지 실시간으로 보여줘요",
  "description": "연동해 둔 작업 파일을 팀원이 열면, 그 씬 카드와 목록·상세 창에 무지개 테두리와 이름표로 '지금 ○○님이 작업 중'이 떠요. 같은 파일을 둘이 동시에 열면 서로 바로 알아채서, 모르고 같이 만지다 파일이 꼬이는 일을 줄여줍니다. (상대도 B flow를 켜두고 있어야 보여요.)"
}
```
> 실제 `update-notes.json` 스키마/카테고리 값은 파일에서 확인해 맞춘다.

- [ ] **Step 2: 커밋**

```bash
git add DEVLOG/update-notes.json
git commit -m "v1.71.0 업데이트 노트 추가"
```

### Task 3: 버전 상향 + 최종 빌드

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 버전**

`"version": "1.70.0"` → `"1.71.0"`.

- [ ] **Step 2: 최종 검증 빌드**

Run: `npm run typecheck && npm run test:auto-update && npm run test:entity && npm run test:notifications && npm run test:presence && npm run build:vite`
Expected: 전부 통과. (정식 릴리스 빌드 `npm run build`는 배포 단계에서 `bflow-release-deploy` 스킬로.)

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
