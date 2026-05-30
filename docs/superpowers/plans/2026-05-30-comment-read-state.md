# 댓글 읽음 상태 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 뷰 카드/시트, 피드백 허브, 씬 상세 모달에서 Slack처럼 새 댓글만 조용히 강조하고, 확인한 뒤에는 사용자별 읽음 상태를 Supabase에 저장한다.

**Architecture:** `comment_read_states`는 사용자 + 씬 thread 단위의 마지막 확인 시간만 저장한다. 화면은 먼저 로컬 캐시를 읽음으로 바꾸고, Supabase upsert는 백그라운드에서 재시도한다. 일반 댓글과 리비전 댓글은 기존 리비전 scene key 규칙(`EP05:A:a001`)으로 합쳐 같은 씬 대화 흐름으로 계산한다.

**Tech Stack:** Electron + React 18 + TypeScript + Supabase(PostgreSQL) + Tailwind CSS + `node:test`.

---

## Spec

- UX/데이터 설계: `docs/superpowers/specs/2026-05-29-comment-read-state-design.md`
- 최종 확인 목업: `docs/mockups/2026-05-29-feedback-comment-unread-final-check.html`

## File Structure

- Create `DEVLOG/migrations/2026-05-30-comment-read-states.sql`
  - Supabase에 `comment_read_states` 테이블, 인덱스, RLS allow-all 정책을 추가한다.
- Modify `DEVLOG/supabase-init.sql`
  - 신규 설치 환경도 같은 테이블을 갖도록 초기 스키마에 반영한다.
- Modify `electron/supabase.ts`
  - `readCommentReadStates(userId)`와 `upsertCommentReadState(userId, sceneThreadKey, lastReadAt)`를 추가한다.
- Modify `electron/main.ts`
  - renderer에서 부를 IPC 핸들러 `supabase:read-comment-read-states`, `supabase:upsert-comment-read-state`를 추가한다.
- Modify `electron/preload.ts`
  - `window.electronAPI.supabaseReadCommentReadStates`, `supabaseUpsertCommentReadState`를 노출한다.
- Modify `src/types/index.ts`
  - Electron API 타입과 읽음 상태 row 타입을 추가한다.
- Modify `src/services/supabaseService.ts`
  - renderer 서비스 wrapper를 추가한다.
- Create `src/utils/commentThreadKey.ts`
  - `sheetName + scene.no` 댓글 키를 `EP05:A:a001` thread key로 변환한다.
- Modify `src/services/commentReadStateService.ts`
  - 기존 로컬 settings 기반 구현을 Supabase 기반 캐시 + optimistic update + retry queue로 교체한다.
- Modify `src/components/scenes/CommentPanel.tsx`
  - 첫 안읽은 댓글 위에 `새 댓글` 구분선을 넣고, 실제로 보였을 때 읽음 처리한다.
- Modify `src/components/scenes/CommentPanelResizable.tsx`
  - canonical `sceneThreadKey`를 `CommentPanel`로 전달한다.
- Modify `src/components/scenes/SceneDetailModal.tsx`
  - 단일 씬 상세 모달에서 canonical thread key를 계산해 넘긴다.
- Modify `src/components/scenes/UnifiedSceneDetailModal.tsx`
  - BG/ACT 통합 상세 모달에서도 같은 thread key를 넘긴다.
- Modify `src/views/ScenesView.tsx`
  - 카드/시트 댓글 배지를 canonical thread key 기반으로 계산하고 unread pulse를 적용한다.
- Modify `src/components/scenes/SceneSheetView.tsx`, `src/components/scenes/UnifiedSceneCard.tsx`, `src/components/scenes/UnifiedSceneSheetView.tsx`
  - `hasUnreadComments`가 들어오는 배지 UI를 회색/보라 pulse 디자인으로 정리한다.
- Modify `src/views/CompositingView.tsx`
  - 피드백 허브의 리비전 댓글 배지가 같은 scene thread read state를 사용하게 한다.
- Modify `src/views/FeedbackHubPreviewApp.tsx`
  - preview 더미 데이터에서 새 댓글 확인 흐름이 재현되도록 초기 read state를 주입한다.
- Create `src/components/common/CompactIconLabel.tsx`
  - 좁은 창에서 `작...`처럼 어색하게 잘리거나 세로로 쌓이는 액션 라벨을 아이콘 전용 표시로 통일한다.
- Modify `src/index.css`
  - compact label의 container-query 기반 숨김 규칙과 focus/pulse 접근성 규칙을 추가한다.
- Modify `src/components/scenes/ScenePhaseToggle.tsx`
  - 액팅 단계 `작업/피드백/완료` 라벨이 좁은 칩에서 `작...`처럼 잘리지 않도록 아이콘 우선 표시로 바꾼다.
- Modify `src/components/scenes/SheetColumnResize.tsx`
  - 사용자가 직접 좁힌 시트 헤더는 짧은 라벨 + 전체 title을 쓸 수 있게 한다.
- Test `tests/commentReadStateService.test.ts`
  - 기존 테스트를 Supabase 캐시/본인 댓글 제외/재시도 큐 기준으로 확장한다.
- Create `tests/commentThreadKey.test.ts`
  - 댓글 key와 리비전 key가 같은 thread key로 합류하는지 검증한다.
- Create `tests/commentReadStateSchema.test.ts`
  - SQL 마이그레이션과 초기 스키마가 같은 핵심 테이블 정의를 포함하는지 검증한다.
- Create `tests/commentReadStateUiWiring.test.ts`
  - `새 댓글` 구분선, IntersectionObserver, pulse 클래스, canonical key wiring을 정적 검증한다.
- Create `tests/responsiveCompactLabels.test.ts`
  - 좁은 창에서 텍스트 라벨이 말줄임/세로 배치로 망가지지 않고 아이콘 + 접근성 라벨로 대체되는지 정적 검증한다.

---

## Execution Gates

각 task 끝에서 해당 테스트를 먼저 통과시킨다. 전체 구현 끝에는 다음을 순서대로 실행한다.

```powershell
node --test ./tests/commentThreadKey.test.ts ./tests/commentReadStateService.test.ts ./tests/commentReadStateSchema.test.ts ./tests/commentReadStateUiWiring.test.ts ./tests/responsiveCompactLabels.test.ts
npm run typecheck
npm run build:vite
```

수동 확인은 마지막 task에서 Browser로 한다.

```text
http://localhost:59286/?preview=feedback-hub
http://localhost:59286/
```

---

## Task 1: Supabase Schema And IPC

**Files:**
- Create: `DEVLOG/migrations/2026-05-30-comment-read-states.sql`
- Modify: `DEVLOG/supabase-init.sql`
- Modify: `electron/supabase.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/supabaseService.ts`
- Test: `tests/commentReadStateSchema.test.ts`

- [ ] **Step 1.1: Write the schema test first**

Create `tests/commentReadStateSchema.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('DEVLOG/migrations/2026-05-30-comment-read-states.sql', 'utf8');
const initSql = readFileSync('DEVLOG/supabase-init.sql', 'utf8');

for (const [label, sql] of [
  ['migration', migration],
  ['supabase init', initSql],
] as const) {
  test(`${label} defines comment_read_states`, () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS comment_read_states/i);
    assert.match(sql, /user_id\s+TEXT\s+NOT NULL/i);
    assert.match(sql, /scene_thread_key\s+TEXT\s+NOT NULL/i);
    assert.match(sql, /last_read_at\s+TIMESTAMPTZ\s+NOT NULL/i);
    assert.match(sql, /PRIMARY KEY\s*\(\s*user_id\s*,\s*scene_thread_key\s*\)/i);
  });

  test(`${label} protects comment_read_states with allow_all RLS policy`, () => {
    assert.match(sql, /ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING \(true\) WITH CHECK \(true\)/i);
  });
}
```

- [ ] **Step 1.2: Run schema test to verify it fails**

Run:

```powershell
node --test ./tests/commentReadStateSchema.test.ts
```

Expected: FAIL because `DEVLOG/migrations/2026-05-30-comment-read-states.sql` does not exist yet.

- [ ] **Step 1.3: Add migration SQL**

Create `DEVLOG/migrations/2026-05-30-comment-read-states.sql`.

```sql
-- 2026-05-30: 사용자별 씬 댓글 읽음 상태
-- spec: docs/superpowers/specs/2026-05-29-comment-read-state-design.md

CREATE TABLE IF NOT EXISTS comment_read_states (
  user_id TEXT NOT NULL,
  scene_thread_key TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scene_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_read_states_user_updated
  ON comment_read_states (user_id, updated_at DESC);

ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'comment_read_states'
      AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 1.4: Add the same table to the init SQL**

In `DEVLOG/supabase-init.sql`, insert this block near the existing `comments` table section and before the RLS policy block.

```sql
-- comment_read_states: 사용자별 씬 댓글 마지막 확인 시간
CREATE TABLE IF NOT EXISTS comment_read_states (
  user_id TEXT NOT NULL,
  scene_thread_key TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scene_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_read_states_user_updated
  ON comment_read_states (user_id, updated_at DESC);
```

Then insert this policy block near the existing `comments` RLS policy block.

```sql
ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comment_read_states' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 1.5: Add Electron Supabase functions**

In `electron/supabase.ts`, add the type near the comments section.

```ts
export interface CommentReadStateRow {
  userId: string;
  sceneThreadKey: string;
  lastReadAt: string;
  updatedAt: string;
}
```

Add these functions after `readCommentsForPart`.

```ts
export async function readCommentReadStates(userId: string): Promise<CommentReadStateRow[]> {
  const safeUserId = userId.trim();
  if (!safeUserId) return [];

  const { data, error } = await supabase
    .from('comment_read_states')
    .select('user_id, scene_thread_key, last_read_at, updated_at')
    .eq('user_id', safeUserId)
    .order('updated_at', { ascending: false });

  throwIfError(error);

  return (data ?? []).map((row: any) => ({
    userId: String(row.user_id ?? ''),
    sceneThreadKey: String(row.scene_thread_key ?? ''),
    lastReadAt: String(row.last_read_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  })).filter((row) => row.userId && row.sceneThreadKey && row.lastReadAt);
}

export async function upsertCommentReadState(
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
): Promise<void> {
  const safeUserId = userId.trim();
  const safeSceneThreadKey = sceneThreadKey.trim();
  const readMs = Date.parse(lastReadAt);

  if (!safeUserId || !safeSceneThreadKey || !Number.isFinite(readMs)) {
    throw new Error('invalid comment read state input');
  }

  const { error } = await supabase
    .from('comment_read_states')
    .upsert({
      user_id: safeUserId,
      scene_thread_key: safeSceneThreadKey,
      last_read_at: new Date(readMs).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,scene_thread_key' });

  throwIfError(error);
}
```

- [ ] **Step 1.6: Add IPC handlers**

In `electron/main.ts`, extend the Supabase import list.

```ts
  readCommentReadStates as sbReadCommentReadStates,
  upsertCommentReadState as sbUpsertCommentReadState,
```

Add handlers near the existing comments IPC handlers.

```ts
ipcMain.handle('supabase:read-comment-read-states', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadCommentReadStates(userId);
}));

ipcMain.handle('supabase:upsert-comment-read-state', wrapIpc(async (
  _e: unknown,
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
) => {
  await sbUpsertCommentReadState(userId, sceneThreadKey, lastReadAt);
}));
```

- [ ] **Step 1.7: Expose preload methods**

In `electron/preload.ts`, add the methods near `supabaseReadComments`.

```ts
  supabaseReadCommentReadStates: (userId: string) =>
    ipcRenderer.invoke('supabase:read-comment-read-states', userId),
  supabaseUpsertCommentReadState: (userId: string, sceneThreadKey: string, lastReadAt: string) =>
    ipcRenderer.invoke('supabase:upsert-comment-read-state', userId, sceneThreadKey, lastReadAt),
```

- [ ] **Step 1.8: Add renderer types and wrappers**

In `src/types/index.ts`, add the row type before `ElectronAPI`.

```ts
export interface CommentReadStateRow {
  userId: string;
  sceneThreadKey: string;
  lastReadAt: string;
  updatedAt: string;
}
```

In the `ElectronAPI` interface, add:

```ts
  supabaseReadCommentReadStates: (userId: string) => Promise<CommentReadStateRow[]>;
  supabaseUpsertCommentReadState: (userId: string, sceneThreadKey: string, lastReadAt: string) => Promise<void>;
```

In `src/services/supabaseService.ts`, add:

```ts
import type { CommentReadStateRow } from '@/types';

export async function readCommentReadStatesFromSupabase(userId: string): Promise<CommentReadStateRow[]> {
  if (!window.electronAPI?.supabaseReadCommentReadStates) return [];
  return window.electronAPI.supabaseReadCommentReadStates(userId);
}

export async function upsertCommentReadStateInSupabase(
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
): Promise<void> {
  if (!window.electronAPI?.supabaseUpsertCommentReadState) return;
  await window.electronAPI.supabaseUpsertCommentReadState(userId, sceneThreadKey, lastReadAt);
}
```

If `src/services/supabaseService.ts` already has a type import from `@/types`, merge `CommentReadStateRow` into that import instead of creating a duplicate import.

- [ ] **Step 1.9: Run schema test**

Run:

```powershell
node --test ./tests/commentReadStateSchema.test.ts
```

Expected: PASS.

- [ ] **Step 1.10: Commit schema and IPC**

Run:

```powershell
git add DEVLOG/migrations/2026-05-30-comment-read-states.sql DEVLOG/supabase-init.sql electron/supabase.ts electron/main.ts electron/preload.ts src/types/index.ts src/services/supabaseService.ts tests/commentReadStateSchema.test.ts
git commit -m "댓글 읽음 상태 저장 경로 추가"
```

---

## Task 2: Canonical Scene Thread Key

**Files:**
- Create: `src/utils/commentThreadKey.ts`
- Test: `tests/commentThreadKey.test.ts`

- [ ] **Step 2.1: Write key conversion tests**

Create `tests/commentThreadKey.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSceneThreadKeyForScene,
  buildSceneThreadKeyFromCommentKey,
  buildSceneThreadKeyFromRevisionKey,
} from '../src/utils/commentThreadKey.ts';

const episodes = [
  {
    episodeNumber: 5,
    title: 'EP05',
    parts: [
      {
        partId: 'A',
        sheetName: 'EP05_A_BG',
        department: 'bg',
        scenes: [
          { id: 'scene-a001', no: 1, sceneId: 'a001' },
          { id: 'scene-a002', no: 2, sceneId: 'a002' },
        ],
      },
      {
        partId: 'A',
        sheetName: 'EP05_A_ACT',
        department: 'act',
        scenes: [
          { id: 'scene-a001-act', no: 1, sceneId: 'a001' },
        ],
      },
    ],
  },
] as any;

test('buildSceneThreadKeyForScene uses episode part scene format', () => {
  const key = buildSceneThreadKeyForScene({
    episodeNumber: 5,
    partId: 'a',
    sceneId: 'A001',
    fallbackKey: 'fallback',
  });

  assert.equal(key, 'EP05:A:a001');
});

test('comment sheet key and revision scene key meet at the same scene thread key', () => {
  const fromComment = buildSceneThreadKeyFromCommentKey(episodes, 'EP05_A_BG:1');
  const fromRevision = buildSceneThreadKeyFromRevisionKey('EP05:A:a001');

  assert.equal(fromComment, 'EP05:A:a001');
  assert.equal(fromRevision, 'EP05:A:a001');
});

test('comment key falls back when no matching part or scene exists', () => {
  assert.equal(buildSceneThreadKeyFromCommentKey(episodes, 'UNKNOWN:99'), 'UNKNOWN:99');
});
```

- [ ] **Step 2.2: Run key test to verify it fails**

Run:

```powershell
node --test ./tests/commentThreadKey.test.ts
```

Expected: FAIL because `src/utils/commentThreadKey.ts` does not exist.

- [ ] **Step 2.3: Implement key helper**

Create `src/utils/commentThreadKey.ts`.

```ts
import type { Episode, Part, Scene } from '@/types';
import { buildUnifiedRevisionSceneKey, normalizeRevisionSceneKey } from './revisionSceneKey';

type SceneThreadInput = {
  episodeNumber?: number | string | null;
  partId?: string | null;
  sceneId?: string | null;
  sheetName?: string | null;
  fallbackKey?: string | null;
};

function parseSheetName(sheetName: string | null | undefined): { episode: string; part: string } {
  const [episode = '', part = ''] = (sheetName ?? '').split('_');
  return { episode, part };
}

function normalizeEpisodeLabel(value: number | string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const digits = raw.match(/\d+/)?.[0] ?? '';
  if (!digits) return raw.toUpperCase();
  return `EP${digits.padStart(2, '0')}`;
}

function getEpisodeNumberForPart(episodes: readonly Episode[], part: Part): number | string {
  const owner = episodes.find((episode) => episode.parts.some((candidate) => candidate.sheetName === part.sheetName));
  return owner?.episodeNumber ?? parseSheetName(part.sheetName).episode;
}

export function buildSceneThreadKeyForScene(input: SceneThreadInput): string {
  const fallback = input.fallbackKey?.trim() ?? '';
  const sheetContext = parseSheetName(input.sheetName);
  const episode = normalizeEpisodeLabel(input.episodeNumber ?? sheetContext.episode);
  const part = String(input.partId ?? sheetContext.part ?? '').trim().toUpperCase();
  const sceneId = String(input.sceneId ?? '').trim();

  if (!episode || !part || !sceneId) return fallback;

  return normalizeRevisionSceneKey(buildUnifiedRevisionSceneKey(`${episode}_${part}`, sceneId));
}

export function buildSceneThreadKeyFromPartScene(
  episodes: readonly Episode[],
  part: Part,
  scene: Pick<Scene, 'sceneId'>,
  fallbackKey: string,
): string {
  return buildSceneThreadKeyForScene({
    episodeNumber: getEpisodeNumberForPart(episodes, part),
    partId: part.partId,
    sceneId: scene.sceneId,
    sheetName: part.sheetName,
    fallbackKey,
  });
}

export function buildSceneThreadKeyFromRevisionKey(sceneKey: string): string {
  return normalizeRevisionSceneKey(sceneKey);
}

export function buildSceneThreadKeyFromCommentKey(
  episodes: readonly Episode[],
  commentSceneKey: string,
): string {
  const [sheetName = '', rawSceneNo = ''] = commentSceneKey.split(':');
  const part = episodes.flatMap((episode) => episode.parts).find((candidate) => candidate.sheetName === sheetName);
  if (!part) return commentSceneKey;

  const scene = part.scenes.find((candidate) => {
    return String(candidate.no) === rawSceneNo || candidate.sceneId.trim().toLowerCase() === rawSceneNo.trim().toLowerCase();
  });

  if (!scene) return commentSceneKey;

  return buildSceneThreadKeyFromPartScene(episodes, part, scene, commentSceneKey);
}

export function buildLegacyCommentSceneKey(sheetName: string, scene: Pick<Scene, 'no'>): string {
  return `${sheetName}:${scene.no}`;
}
```

- [ ] **Step 2.4: Run key test**

Run:

```powershell
node --test ./tests/commentThreadKey.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Commit key helper**

Run:

```powershell
git add src/utils/commentThreadKey.ts tests/commentThreadKey.test.ts
git commit -m "댓글과 리비전 씬 키 통합"
```

---

## Task 3: Supabase-Backed Read State Service

**Files:**
- Modify: `src/services/commentReadStateService.ts`
- Test: `tests/commentReadStateService.test.ts`

- [ ] **Step 3.1: Replace tests with Supabase-oriented behavior**

Replace `tests/commentReadStateService.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetCommentReadStateServiceForTests,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
  markSceneThreadReadForUser,
  primeCommentReadStateForUser,
} from '../src/services/commentReadStateService.ts';

test('comment read state treats comments newer than the seen timestamp as unread', () => {
  const latest = '2026-05-29T09:30:00.000Z';

  assert.equal(isCommentKeyUnread(latest, undefined), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:29:59.000Z'), true);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:30:00.000Z'), false);
  assert.equal(isCommentKeyUnread(latest, '2026-05-29T09:31:00.000Z'), false);
});

test('latest other-user comment ignores invalid, empty, and own rows', () => {
  const latest = getLatestOtherUserCommentCreatedAt([
    { userId: 'me', createdAt: '2026-05-29T11:00:00.000Z' },
    { userId: 'other', createdAt: 'bad-date' },
    { userId: 'other', createdAt: '2026-05-29T09:00:00.000Z' },
    { userId: 'other', createdAt: '2026-05-29T10:00:00.000Z' },
    { userId: 'other', createdAt: '' },
  ], 'me');

  assert.equal(latest, '2026-05-29T10:00:00.000Z');
});

test('prime and mark update the per-user cache optimistically', async () => {
  __resetCommentReadStateServiceForTests();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T09:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T10:00:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
});

test('mark ignores older read timestamps', async () => {
  __resetCommentReadStateServiceForTests();
  primeCommentReadStateForUser('me', { 'EP05:A:a001': '2026-05-29T10:00:00.000Z' });

  await markSceneThreadReadForUser({
    userId: 'me',
    sceneThreadKey: 'EP05:A:a001',
    readAt: '2026-05-29T09:59:00.000Z',
  });

  const state = await getCommentReadStateForUser('me');
  assert.equal(state['EP05:A:a001'], '2026-05-29T10:00:00.000Z');
});
```

- [ ] **Step 3.2: Run read-state tests to verify they fail**

Run:

```powershell
node --test ./tests/commentReadStateService.test.ts
```

Expected: FAIL because the service still exposes local-settings behavior and does not export the new APIs.

- [ ] **Step 3.3: Replace service with cache + Supabase + retry**

Replace `src/services/commentReadStateService.ts` with:

```ts
import {
  readCommentReadStatesFromSupabase,
  upsertCommentReadStateInSupabase,
} from './supabaseService';

export const COMMENT_READ_STATE_EVENT = 'bflow:comment-read-state-changed';

type CommentReadStateMap = Record<string, string>;

type CommentTimestampLike = {
  userId?: string | null;
  createdAt?: string | null;
};

type MarkSceneThreadReadInput = {
  userId: string;
  sceneThreadKey: string;
  readAt: string;
};

type PendingWrite = MarkSceneThreadReadInput & {
  attempts: number;
};

const cacheByUser = new Map<string, CommentReadStateMap>();
const pendingWrites = new Map<string, PendingWrite>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function pendingKey(userId: string, sceneThreadKey: string): string {
  return `${userId}\n${sceneThreadKey}`;
}

function isValidDateString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function dispatchReadStateChanged(userId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMMENT_READ_STATE_EVENT, { detail: { userId } }));
}

function shouldReplace(prev: string | undefined, next: string): boolean {
  if (!isValidDateString(next)) return false;
  if (!prev) return true;
  const prevMs = Date.parse(prev);
  const nextMs = Date.parse(next);
  return !Number.isFinite(prevMs) || nextMs > prevMs;
}

function setCachedReadAt(userId: string, sceneThreadKey: string, readAt: string): boolean {
  if (!userId || !sceneThreadKey || !isValidDateString(readAt)) return false;

  const current = { ...(cacheByUser.get(userId) ?? {}) };
  if (!shouldReplace(current[sceneThreadKey], readAt)) return false;

  current[sceneThreadKey] = new Date(Date.parse(readAt)).toISOString();
  cacheByUser.set(userId, current);
  return true;
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingCommentReadStateWrites();
  }, delayMs);
}

async function flushPendingCommentReadStateWrites(): Promise<void> {
  const entries = [...pendingWrites.entries()];
  for (const [key, pending] of entries) {
    try {
      await upsertCommentReadStateInSupabase(pending.userId, pending.sceneThreadKey, pending.readAt);
      pendingWrites.delete(key);
    } catch (err) {
      const attempts = pending.attempts + 1;
      pendingWrites.set(key, { ...pending, attempts });
      console.warn('[댓글 읽음] Supabase 재시도 실패:', err);
    }
  }

  if (pendingWrites.size > 0) {
    const hasOnlyFirstFailures = [...pendingWrites.values()].some((pending) => pending.attempts <= 1);
    scheduleRetry(hasOnlyFirstFailures ? 10_000 : 30_000);
  }
}

function enqueuePendingWrite(input: MarkSceneThreadReadInput): void {
  const key = pendingKey(input.userId, input.sceneThreadKey);
  const prev = pendingWrites.get(key);
  if (prev && !shouldReplace(prev.readAt, input.readAt)) return;
  pendingWrites.set(key, { ...input, attempts: prev?.attempts ?? 0 });
  scheduleRetry(10_000);
}

export function getLatestOtherUserCommentCreatedAt(
  comments: readonly CommentTimestampLike[],
  currentUserId: string | null | undefined,
): string | null {
  let latestAt: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const comment of comments) {
    if (currentUserId && comment.userId === currentUserId) continue;
    const createdAt = comment.createdAt;
    if (!isValidDateString(createdAt)) continue;
    const ms = Date.parse(createdAt);
    if (ms > latestMs) {
      latestMs = ms;
      latestAt = new Date(ms).toISOString();
    }
  }

  return latestAt;
}

export function getLatestCommentCreatedAt(comments: readonly Pick<CommentTimestampLike, 'createdAt'>[]): string | null {
  return getLatestOtherUserCommentCreatedAt(comments, null);
}

export function isCommentKeyUnread(latestCommentAt?: string | null, seenAt?: string | null): boolean {
  if (!isValidDateString(latestCommentAt)) return false;
  if (!isValidDateString(seenAt)) return true;
  return Date.parse(latestCommentAt) > Date.parse(seenAt);
}

export function primeCommentReadStateForUser(userId: string, state: CommentReadStateMap): void {
  if (!userId) return;
  const normalized: CommentReadStateMap = {};
  for (const [sceneThreadKey, readAt] of Object.entries(state)) {
    if (!sceneThreadKey || !isValidDateString(readAt)) continue;
    normalized[sceneThreadKey] = new Date(Date.parse(readAt)).toISOString();
  }
  cacheByUser.set(userId, normalized);
}

export async function getCommentReadStateForUser(userId: string): Promise<CommentReadStateMap> {
  if (!userId) return {};

  await flushPendingCommentReadStateWrites();

  try {
    const rows = await readCommentReadStatesFromSupabase(userId);
    const next: CommentReadStateMap = {};
    for (const row of rows) {
      if (!row.sceneThreadKey || !isValidDateString(row.lastReadAt)) continue;
      next[row.sceneThreadKey] = new Date(Date.parse(row.lastReadAt)).toISOString();
    }
    cacheByUser.set(userId, next);
    return { ...next };
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 상태 로드 실패:', err);
    return { ...(cacheByUser.get(userId) ?? {}) };
  }
}

export async function markSceneThreadReadForUser(input: MarkSceneThreadReadInput): Promise<void> {
  const { userId, sceneThreadKey, readAt } = input;
  if (!userId || !sceneThreadKey || !isValidDateString(readAt)) return;

  const normalizedReadAt = new Date(Date.parse(readAt)).toISOString();
  const changed = setCachedReadAt(userId, sceneThreadKey, normalizedReadAt);
  if (changed) dispatchReadStateChanged(userId);

  try {
    await upsertCommentReadStateInSupabase(userId, sceneThreadKey, normalizedReadAt);
    pendingWrites.delete(pendingKey(userId, sceneThreadKey));
  } catch (err) {
    console.warn('[댓글 읽음] Supabase 저장 실패, 백그라운드 재시도:', err);
    enqueuePendingWrite({ userId, sceneThreadKey, readAt: normalizedReadAt });
  }
}

export async function markCommentKeysSeen(
  userId: string,
  latestBySceneKey: Record<string, string | null | undefined>,
): Promise<void> {
  for (const [sceneThreadKey, readAt] of Object.entries(latestBySceneKey)) {
    if (!readAt) continue;
    await markSceneThreadReadForUser({ userId, sceneThreadKey, readAt });
  }
}

export function __resetCommentReadStateServiceForTests(): void {
  cacheByUser.clear();
  pendingWrites.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
```

- [ ] **Step 3.4: Run read-state tests**

Run:

```powershell
node --test ./tests/commentReadStateService.test.ts
```

Expected: PASS.

- [ ] **Step 3.5: Commit read-state service**

Run:

```powershell
git add src/services/commentReadStateService.ts tests/commentReadStateService.test.ts
git commit -m "댓글 읽음 상태 서비스를 Supabase 기반으로 교체"
```

---

## Task 4: CommentPanel Unread Divider And Read Trigger

**Files:**
- Modify: `src/components/scenes/CommentPanel.tsx`
- Modify: `src/components/scenes/CommentPanelResizable.tsx`
- Test: `tests/commentReadStateUiWiring.test.ts`

- [ ] **Step 4.1: Write UI wiring test**

Create `tests/commentReadStateUiWiring.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
const resizable = readFileSync('src/components/scenes/CommentPanelResizable.tsx', 'utf8');

test('CommentPanel renders unread divider and observes visibility before marking read', () => {
  assert.match(commentPanel, /새 댓글/);
  assert.match(commentPanel, /IntersectionObserver/);
  assert.match(commentPanel, /markSceneThreadReadForUser/);
  assert.match(commentPanel, /getLatestOtherUserCommentCreatedAt/);
});

test('CommentPanelResizable passes canonical sceneThreadKey to CommentPanel', () => {
  assert.match(resizable, /sceneThreadKey\?: string/);
  assert.match(resizable, /sceneThreadKey=\{sceneThreadKey/);
});
```

- [ ] **Step 4.2: Run UI wiring test to verify it fails**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: FAIL because `CommentPanel` does not yet contain the unread divider/read trigger.

- [ ] **Step 4.3: Extend CommentPanel props**

In `src/components/scenes/CommentPanel.tsx`, import the read-state helpers.

```ts
import {
  COMMENT_READ_STATE_EVENT,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
  markSceneThreadReadForUser,
} from '@/services/commentReadStateService';
```

Extend `CommentPanelProps`.

```ts
interface CommentPanelProps {
  sceneKey: string;
  secondarySceneKey?: string;
  sceneThreadKey?: string;
  onCountChange?: (count: number) => void;
  inlineEvents?: CommentInlineEvent[];
  focusCommentId?: string | null;
  sceneLabel?: string;
}
```

In the component signature, include `sceneThreadKey`.

```ts
export function CommentPanel({
  sceneKey,
  secondarySceneKey,
  sceneThreadKey,
  onCountChange,
  inlineEvents,
  focusCommentId,
  sceneLabel,
}: CommentPanelProps) {
```

- [ ] **Step 4.4: Add local read-state state and latest-other-user calculation**

After the existing comment state declarations in `CommentPanel`, add:

```ts
  const effectiveSceneThreadKey = sceneThreadKey ?? sceneKey;
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const readMarkedRef = useRef<string | null>(null);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);

  const latestOtherUserCommentAt = useMemo(
    () => getLatestOtherUserCommentCreatedAt(comments, currentUser?.id),
    [comments, currentUser?.id],
  );

  const hasUnreadComments = isCommentKeyUnread(latestOtherUserCommentAt, lastReadAt);
```

Add the read-state loader effect.

```ts
  useEffect(() => {
    if (!currentUser?.id) {
      setLastReadAt(null);
      return;
    }

    let cancelled = false;
    const load = () => {
      void getCommentReadStateForUser(currentUser.id).then((state) => {
        if (!cancelled) setLastReadAt(state[effectiveSceneThreadKey] ?? null);
      });
    };

    load();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== currentUser.id) return;
      load();
    };

    window.addEventListener(COMMENT_READ_STATE_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(COMMENT_READ_STATE_EVENT, handler);
    };
  }, [currentUser?.id, effectiveSceneThreadKey]);
```

- [ ] **Step 4.5: Compute first unread comment**

After `mainFlowComments`, add:

```ts
  const firstUnreadCommentId = useMemo(() => {
    if (!currentUser?.id || !hasUnreadComments) return null;
    const readMs = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;

    for (const comment of mainFlowComments) {
      if (comment.userId === currentUser.id) continue;
      const createdMs = Date.parse(comment.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      if (createdMs > readMs) return comment.id;
    }

    return null;
  }, [currentUser?.id, hasUnreadComments, lastReadAt, mainFlowComments]);
```

- [ ] **Step 4.6: Add read marker function and observer**

Add:

```ts
  const markUnreadCommentsRead = useCallback(() => {
    if (!currentUser?.id || !effectiveSceneThreadKey || !latestOtherUserCommentAt) return;
    if (readMarkedRef.current === latestOtherUserCommentAt) return;

    readMarkedRef.current = latestOtherUserCommentAt;
    setLastReadAt(latestOtherUserCommentAt);
    void markSceneThreadReadForUser({
      userId: currentUser.id,
      sceneThreadKey: effectiveSceneThreadKey,
      readAt: latestOtherUserCommentAt,
    });
  }, [currentUser?.id, effectiveSceneThreadKey, latestOtherUserCommentAt]);

  useEffect(() => {
    if (!firstUnreadCommentId || !latestOtherUserCommentAt) return;
    const anchor = unreadDividerRef.current;
    const root = scrollRef.current;
    if (!anchor || !root) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        markUnreadCommentsRead();
        observer.disconnect();
      }
    }, { root, threshold: 0.6 });

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [firstUnreadCommentId, latestOtherUserCommentAt, markUnreadCommentsRead]);
```

- [ ] **Step 4.7: Auto-scroll to first unread instead of bottom**

Replace the existing new-comment auto-scroll effect with:

```ts
  useEffect(() => {
    if (firstUnreadCommentId) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length, inlineEvents?.length, firstUnreadCommentId]);

  useEffect(() => {
    if (!firstUnreadCommentId) return;
    const timer = setTimeout(() => {
      unreadDividerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [firstUnreadCommentId]);
```

- [ ] **Step 4.8: Render the unread divider in the feed**

Inside the feed `.map`, just before rendering the first unread comment node, insert:

```tsx
              const showUnreadDivider =
                node.kind === 'comment'
                && firstUnreadCommentId
                && node.comment.id === firstUnreadCommentId;
```

Wrap the returned node in a fragment:

```tsx
              return (
                <React.Fragment key={node.kind === 'comment' ? node.comment.id : node.event.id}>
                  {showUnreadDivider && (
                    <div
                      ref={unreadDividerRef}
                      className="flex items-center gap-2 py-1"
                      aria-label="새 댓글 시작"
                    >
                      <span className="h-px flex-1 bg-accent/30" />
                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        새 댓글
                      </span>
                      <span className="h-px flex-1 bg-accent/30" />
                    </div>
                  )}
                  {renderedNode}
                </React.Fragment>
              );
```

Use the existing comment/event JSX as `renderedNode`; keep its existing `commentRefs` and `motion` wrappers intact.

- [ ] **Step 4.9: Mark read on click and reply**

Add `onClick={markUnreadCommentsRead}` to the top-level element that wraps each comment row, not to the entire scroll container. In the reply-submit success path, call:

```ts
markUnreadCommentsRead();
```

This makes clicking an unread comment or replying feel like Slack's "I handled this" behavior.

- [ ] **Step 4.10: Pass `sceneThreadKey` through CommentPanelResizable**

In `src/components/scenes/CommentPanelResizable.tsx`, add prop:

```ts
  sceneThreadKey?: string;
```

Destructure it:

```ts
    sceneThreadKey,
```

Pass it into `CommentPanel`.

```tsx
          sceneThreadKey={sceneThreadKey}
```

- [ ] **Step 4.11: Run UI wiring test**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: PASS.

- [ ] **Step 4.12: Commit CommentPanel changes**

Run:

```powershell
git add src/components/scenes/CommentPanel.tsx src/components/scenes/CommentPanelResizable.tsx tests/commentReadStateUiWiring.test.ts
git commit -m "씬 상세 댓글 새 댓글 구분선과 읽음 처리 추가"
```

---

## Task 5: Scene Detail Modal Wiring

**Files:**
- Modify: `src/components/scenes/SceneDetailModal.tsx`
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`
- Modify: `tests/commentReadStateUiWiring.test.ts`

- [ ] **Step 5.1: Extend UI wiring test for modals**

Append to `tests/commentReadStateUiWiring.test.ts`.

```ts
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');

test('scene detail modals pass canonical sceneThreadKey to the comment panel', () => {
  assert.match(sceneDetailModal, /sceneThreadKey=\{revisionSceneKey\}/);
  assert.match(unifiedSceneDetailModal, /sceneThreadKey=\{revisionSceneKey\}/);
});
```

- [ ] **Step 5.2: Run UI wiring test to verify it fails**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: FAIL because the modal props are not yet passed.

- [ ] **Step 5.3: Pass canonical key from single scene detail modal**

In `src/components/scenes/SceneDetailModal.tsx`, `revisionSceneKey` already exists:

```ts
  const revisionSceneKey = buildSceneKey(sheetName, scene.sceneId);
```

Add this prop to `CommentPanelResizable`.

```tsx
            sceneThreadKey={revisionSceneKey}
```

- [ ] **Step 5.4: Pass canonical key from unified detail modal**

In `src/components/scenes/UnifiedSceneDetailModal.tsx`, `revisionSceneKey` already feeds `RevisionPanel`. Add the same prop to `CommentPanelResizable`.

```tsx
              sceneThreadKey={revisionSceneKey}
```

- [ ] **Step 5.5: Run UI wiring test**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: PASS.

- [ ] **Step 5.6: Commit modal wiring**

Run:

```powershell
git add src/components/scenes/SceneDetailModal.tsx src/components/scenes/UnifiedSceneDetailModal.tsx tests/commentReadStateUiWiring.test.ts
git commit -m "씬 상세 모달 댓글 읽음 키 연결"
```

---

## Task 6: Scene View Card And Sheet Badges

**Files:**
- Modify: `src/views/ScenesView.tsx`
- Modify: `src/components/scenes/SceneSheetView.tsx`
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`
- Modify: `tests/commentReadStateUiWiring.test.ts`

- [ ] **Step 6.1: Extend UI test for scene badges**

Append to `tests/commentReadStateUiWiring.test.ts`.

```ts
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const sceneSheetView = readFileSync('src/components/scenes/SceneSheetView.tsx', 'utf8');
const unifiedSceneCard = readFileSync('src/components/scenes/UnifiedSceneCard.tsx', 'utf8');
const unifiedSceneSheetView = readFileSync('src/components/scenes/UnifiedSceneSheetView.tsx', 'utf8');

test('scene views compute unread badges with scene thread keys', () => {
  assert.match(scenesView, /buildSceneThreadKeyFromCommentKey/);
  assert.match(scenesView, /commentUnreadByThreadKey/);
  assert.match(scenesView, /motion-safe:animate-\[commentBadgePulse_2\.6s_ease-in-out_infinite\]/);
});

test('scene badge components expose comment unread state with SVG count badges', () => {
  assert.match(sceneSheetView, /hasUnreadComments/);
  assert.match(unifiedSceneCard, /hasUnreadComments/);
  assert.match(unifiedSceneSheetView, /hasUnreadComments/);
  assert.doesNotMatch(`${sceneSheetView}\n${unifiedSceneCard}\n${unifiedSceneSheetView}`, /💬/);
});
```

- [ ] **Step 6.2: Run UI wiring test to verify it fails**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: FAIL because scene views still rely on some legacy `sheetName:scene.no` read keys.

- [ ] **Step 6.3: Import canonical key helper in ScenesView**

In `src/views/ScenesView.tsx`, add:

```ts
import {
  buildLegacyCommentSceneKey,
  buildSceneThreadKeyFromCommentKey,
  buildSceneThreadKeyFromPartScene,
} from '@/utils/commentThreadKey';
```

- [ ] **Step 6.4: Track latest comments by thread key**

In `reloadCommentCounts`, keep `commentCounts` and `commentIdsByKey` keyed by legacy comment key for existing code compatibility, but add latest timestamps by canonical thread key.

Use this shape in the store callback:

```ts
const latestByThreadKey: Record<string, string | null> = {};

for (const [legacySceneKey, comments] of Object.entries(store)) {
  const threadKey = buildSceneThreadKeyFromCommentKey(episodes, legacySceneKey);
  latestByThreadKey[threadKey] = getLatestOtherUserCommentCreatedAt(comments, currentUser?.id);
}

setCommentLatestAtByKey((prev) => ({ ...prev, ...latestByThreadKey }));
```

Rename the state where practical:

```ts
const [commentLatestAtByThreadKey, setCommentLatestAtByThreadKey] = useState<Record<string, string | null>>({});
const [commentReadAtByThreadKey, setCommentReadAtByThreadKey] = useState<Record<string, string>>({});
```

If renaming every call site creates a large diff, keep the old variable names but store canonical keys in them.

- [ ] **Step 6.5: Compute unread by thread key**

Replace the old unread map with:

```ts
  const commentUnreadByThreadKey = useMemo(() => {
    const unread: Record<string, boolean> = {};
    for (const [threadKey, latestAt] of Object.entries(commentLatestAtByThreadKey)) {
      unread[threadKey] = isCommentKeyUnread(latestAt, commentReadAtByThreadKey[threadKey]);
    }
    return unread;
  }, [commentLatestAtByThreadKey, commentReadAtByThreadKey]);
```

- [ ] **Step 6.6: Read Supabase state into canonical map**

Replace the existing read-state effect body with:

```ts
      void getCommentReadStateForUser(currentUser.id).then((state) => {
        if (!cancelled) setCommentReadAtByThreadKey(state);
      });
```

Keep the existing `COMMENT_READ_STATE_EVENT` listener so `CommentPanel` can refresh badges after marking read.

- [ ] **Step 6.7: Pass unread state to single cards and sheets**

Where the single scene card currently uses:

```tsx
hasUnreadComments={commentUnreadByKey[`${currentPart?.sheetName ?? ''}:${scene.no}`] ?? false}
```

replace with:

```tsx
hasUnreadComments={commentUnreadByThreadKey[
  currentPart ? buildSceneThreadKeyFromPartScene(episodes, currentPart, scene, buildLegacyCommentSceneKey(currentPart.sheetName, scene)) : ''
] ?? false}
```

Apply the same logic to the single `SceneSheetView` props. Pass `commentUnreadByThreadKey` only if the child can compute canonical keys; otherwise keep the child prop name `commentUnreadByKey` but provide a map keyed by canonical thread key and update the child lookup.

- [ ] **Step 6.8: Pass unread state to unified cards and sheets**

Replace `hasMergedUnreadComments` with a canonical thread key lookup.

```ts
  const hasMergedUnreadComments = useCallback((merged: MergedScene) => {
    const bgThreadKey = merged.bgScene && bgPart
      ? buildSceneThreadKeyFromPartScene(episodes, bgPart, merged.bgScene, buildLegacyCommentSceneKey(bgPart.sheetName, merged.bgScene))
      : null;
    const actThreadKey = merged.actScene && actPart
      ? buildSceneThreadKeyFromPartScene(episodes, actPart, merged.actScene, buildLegacyCommentSceneKey(actPart.sheetName, merged.actScene))
      : null;

    return Boolean(
      (bgThreadKey && commentUnreadByThreadKey[bgThreadKey])
      || (actThreadKey && commentUnreadByThreadKey[actThreadKey]),
    );
  }, [actPart, bgPart, commentUnreadByThreadKey, episodes]);
```

- [ ] **Step 6.9: Add pulse keyframes and reduced-motion guard**

Add the animation class where the comment badge class is built.

```tsx
hasUnreadComments
  ? 'border-accent/30 bg-accent/15 text-accent shadow-[0_0_14px_rgba(108,92,231,0.18)] motion-safe:animate-[commentBadgePulse_2.6s_ease-in-out_infinite]'
  : 'border-bg-border/45 bg-text-secondary/10 text-text-secondary/60'
```

In the global CSS file already used for app-level styles, add:

```css
@keyframes commentBadgePulse {
  0%, 100% {
    box-shadow: 0 0 0 rgba(108, 92, 231, 0);
    transform: translateZ(0) scale(1);
  }
  50% {
    box-shadow: 0 0 14px rgba(108, 92, 231, 0.22);
    transform: translateZ(0) scale(1.03);
  }
}

@media (prefers-reduced-motion: reduce) {
  .motion-safe\:animate-\[commentBadgePulse_2\.6s_ease-in-out_infinite\] {
    animation: none;
  }
}
```

If Tailwind's `motion-safe:` variant already handles reduced motion in the build, keep only the keyframes and verify in `npm run build:vite`.

- [ ] **Step 6.10: Run tests**

Run:

```powershell
node --test ./tests/commentThreadKey.test.ts ./tests/commentReadStateService.test.ts ./tests/commentReadStateUiWiring.test.ts
```

Expected: PASS.

- [ ] **Step 6.11: Commit scene badge wiring**

Run:

```powershell
git add src/views/ScenesView.tsx src/components/scenes/SceneSheetView.tsx src/components/scenes/UnifiedSceneCard.tsx src/components/scenes/UnifiedSceneSheetView.tsx tests/commentReadStateUiWiring.test.ts
git commit -m "씬 뷰 댓글 배지 읽음 상태 연결"
```

---

## Task 7: Feedback Hub And Preview Data

**Files:**
- Modify: `src/views/CompositingView.tsx`
- Modify: `src/views/FeedbackHubPreviewApp.tsx`
- Modify: `tests/commentReadStateUiWiring.test.ts`

- [ ] **Step 7.1: Extend UI test for feedback hub**

Append to `tests/commentReadStateUiWiring.test.ts`.

```ts
const compositingView = readFileSync('src/views/CompositingView.tsx', 'utf8');
const feedbackHubPreviewApp = readFileSync('src/views/FeedbackHubPreviewApp.tsx', 'utf8');

test('feedback hub uses shared scene thread read state instead of revision-only seen flags', () => {
  assert.match(compositingView, /commentUnreadByThreadKey|sceneThreadKey/);
  assert.match(feedbackHubPreviewApp, /primeCommentReadStateForUser/);
  assert.match(feedbackHubPreviewApp, /comment-read-state-changed|COMMENT_READ_STATE_EVENT/);
});
```

- [ ] **Step 7.2: Run UI wiring test to verify it fails**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: FAIL until the hub and preview use shared thread read state.

- [ ] **Step 7.3: Replace revision-only seen flags in CompositingView**

In `src/views/CompositingView.tsx`, load user read state with the same service used by `ScenesView`.

```ts
const [commentReadAtByThreadKey, setCommentReadAtByThreadKey] = useState<Record<string, string>>({});

useEffect(() => {
  if (!currentUser?.id) {
    setCommentReadAtByThreadKey({});
    return;
  }

  let cancelled = false;
  const load = () => {
    void getCommentReadStateForUser(currentUser.id).then((state) => {
      if (!cancelled) setCommentReadAtByThreadKey(state);
    });
  };

  load();
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string }>).detail;
    if (detail?.userId && detail.userId !== currentUser.id) return;
    load();
  };

  window.addEventListener(COMMENT_READ_STATE_EVENT, handler);
  return () => {
    cancelled = true;
    window.removeEventListener(COMMENT_READ_STATE_EVENT, handler);
  };
}, [currentUser?.id]);
```

When building revision cards, calculate:

```ts
const latestOtherUserCommentAt = getLatestOtherUserCommentCreatedAt(revisionComments, currentUser?.id);
const hasUnreadComments = isCommentKeyUnread(latestOtherUserCommentAt, commentReadAtByThreadKey[revision.sceneKey]);
```

Keep the badge count as total comments. Only color/pulse changes with `hasUnreadComments`.

- [ ] **Step 7.4: Prime preview read state**

In `src/views/FeedbackHubPreviewApp.tsx`, import:

```ts
import {
  COMMENT_READ_STATE_EVENT,
  primeCommentReadStateForUser,
} from '@/services/commentReadStateService';
```

After preview users and comments are hydrated, seed read state for the logged-in preview user.

```ts
primeCommentReadStateForUser('preview-user-baehan', {
  'EP05:A:a002': '2026-05-29T06:30:00.000Z',
  'EP06:B:b003': '2026-05-29T08:30:00.000Z',
});

window.dispatchEvent(new CustomEvent(COMMENT_READ_STATE_EVENT, {
  detail: { userId: 'preview-user-baehan' },
}));
```

`seedFeedbackHubPreview()` sets `currentUser: previewUsers[0]`, and `previewUsers[0].id` is `preview-user-baehan`, so this seed targets the preview user who is actually logged in.

- [ ] **Step 7.5: Ensure preview comment add updates badges**

In preview comment creation handlers, after inserting a comment into the local comment store, dispatch the existing invalidation event and the read-state event.

```ts
window.dispatchEvent(new CustomEvent('bflow:comments-invalidated'));
window.dispatchEvent(new CustomEvent(COMMENT_READ_STATE_EVENT, {
  detail: { userId: useAuthStore.getState().currentUser?.id },
}));
```

- [ ] **Step 7.6: Run UI wiring test**

Run:

```powershell
node --test ./tests/commentReadStateUiWiring.test.ts
```

Expected: PASS.

- [ ] **Step 7.7: Commit feedback hub wiring**

Run:

```powershell
git add src/views/CompositingView.tsx src/views/FeedbackHubPreviewApp.tsx tests/commentReadStateUiWiring.test.ts
git commit -m "피드백 허브 댓글 읽음 상태 연결"
```

---

## Task 8: Responsive Compact Labels

**Files:**
- Create: `src/components/common/CompactIconLabel.tsx`
- Modify: `src/index.css`
- Modify: `src/views/CompositingView.tsx`
- Modify: `src/views/ScenesView.tsx`
- Modify: `src/components/scenes/ScenePhaseToggle.tsx`
- Modify: `src/components/scenes/SheetColumnResize.tsx`
- Modify: `src/components/scenes/SceneSheetView.tsx`
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`
- Test: `tests/responsiveCompactLabels.test.ts`

- [ ] **Step 8.1: Write compact label test**

Create `tests/responsiveCompactLabels.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync('src/components/common/CompactIconLabel.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const compositing = readFileSync('src/views/CompositingView.tsx', 'utf8');
const scenes = readFileSync('src/views/ScenesView.tsx', 'utf8');
const phaseToggle = readFileSync('src/components/scenes/ScenePhaseToggle.tsx', 'utf8');
const sheetColumnResize = readFileSync('src/components/scenes/SheetColumnResize.tsx', 'utf8');
const sceneSheet = readFileSync('src/components/scenes/SceneSheetView.tsx', 'utf8');
const unifiedCard = readFileSync('src/components/scenes/UnifiedSceneCard.tsx', 'utf8');
const unifiedSheet = readFileSync('src/components/scenes/UnifiedSceneSheetView.tsx', 'utf8');

test('CompactIconLabel keeps icon-only controls accessible', () => {
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /title=\{label\}/);
  assert.match(component, /data-compact-icon-label/);
  assert.match(component, /aria-hidden="true"/);
});

test('compact label CSS hides text by container width, not by awkward truncation', () => {
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container\s*\(max-width:\s*72px\)/);
  assert.match(css, /data-compact-label-text/);
});

test('feedback and scene surfaces use the compact label component for dense actions', () => {
  const sources = `${compositing}\n${scenes}\n${phaseToggle}\n${sceneSheet}\n${unifiedCard}\n${unifiedSheet}`;
  assert.match(sources, /CompactIconLabel/);
  assert.doesNotMatch(sources, /writing-mode/);
  assert.doesNotMatch(sources, /작\.\.\./);
});

test('sheet headers support short labels without losing full titles', () => {
  assert.match(sheetColumnResize, /shortLabel\?:/);
  assert.match(sheetColumnResize, /title=\{typeof children === 'string' \? children : undefined\}/);
});
```

- [ ] **Step 8.2: Run compact label test to verify it fails**

Run:

```powershell
node --test ./tests/responsiveCompactLabels.test.ts
```

Expected: FAIL because `CompactIconLabel` does not exist yet.

- [ ] **Step 8.3: Create CompactIconLabel**

Create `src/components/common/CompactIconLabel.tsx`.

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface CompactIconLabelProps {
  icon: ReactNode;
  label: string;
  className?: string;
  textClassName?: string;
}

export function CompactIconLabel({
  icon,
  label,
  className,
  textClassName,
}: CompactIconLabelProps) {
  return (
    <span
      data-compact-icon-label
      aria-label={label}
      title={label}
      className={cn('compact-icon-label inline-flex min-w-0 items-center justify-center gap-1.5', className)}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
        {icon}
      </span>
      <span
        data-compact-label-text
        aria-hidden="true"
        className={cn('compact-icon-label__text min-w-0 whitespace-nowrap text-inherit', textClassName)}
      >
        {label}
      </span>
    </span>
  );
}
```

- [ ] **Step 8.4: Add compact label CSS**

Append to `src/index.css`.

```css
.compact-icon-label {
  container-type: inline-size;
}

.compact-icon-label__text {
  overflow: hidden;
  text-overflow: clip;
  transition: opacity 160ms ease, max-width 160ms ease;
}

@container (max-width: 72px) {
  .compact-icon-label [data-compact-label-text] {
    max-width: 0;
    opacity: 0;
  }
}
```

This intentionally uses icon-only collapse instead of ellipsis. Tooltip and `aria-label` preserve meaning.

- [ ] **Step 8.5: Replace dense feedback hub action labels**

In `src/views/CompositingView.tsx`, import compact labels and lucide icons already used in the file.

```ts
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { ListCollapse, ListTree, Plus, UserRound, LayoutList, Columns3, KanbanSquare } from 'lucide-react';
```

Keep the file's existing lucide imports by merging these icon names into the current import.

Replace dense button text with `CompactIconLabel`:

```tsx
<CompactIconLabel
  icon={expandedScenes.size > 0 ? <ListCollapse size={13} /> : <ListTree size={13} />}
  label={expandedScenes.size > 0 ? '모두 접기' : '모두 펼치기'}
/>
```

```tsx
<CompactIconLabel icon={<Plus size={12} strokeWidth={2.5} />} label="새 피드백" />
```

For view mode buttons:

```tsx
const groupModeOptions = [
  { key: 'scene' as const, label: '씬 트리', icon: <LayoutList size={13} /> },
  { key: 'episode' as const, label: '에피소드별', icon: <Columns3 size={13} /> },
  { key: 'progress' as const, label: '상태 보드', icon: <KanbanSquare size={13} /> },
];
```

Render:

```tsx
<CompactIconLabel icon={icon} label={label} />
```

For `내 관련`, use:

```tsx
<CompactIconLabel icon={<UserRound size={12} />} label="내 관련" />
```

- [ ] **Step 8.6: Make ScenePhaseToggle icon-first in compact contexts**

In `src/components/scenes/ScenePhaseToggle.tsx`, import icons:

```ts
import { CheckCircle2, Clock, LoaderCircle, MessageSquareWarning } from 'lucide-react';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
```

Add a helper map near phase labels.

```tsx
const SCENE_PHASE_ICONS: Record<ScenePhaseState, React.ReactNode> = {
  wait: <Clock size={11} />,
  work: <LoaderCircle size={11} />,
  feedback: <MessageSquareWarning size={11} />,
  done: <CheckCircle2 size={11} />,
};
```

Replace the inner label span:

```tsx
<CompactIconLabel
  icon={SCENE_PHASE_ICONS[state]}
  label={SCENE_PHASE_LABELS_SHORT[state]}
  className="w-full"
/>
```

Keep the existing active/inactive color classes and click handlers. The narrow state should collapse text before it truncates to `작...`.

- [ ] **Step 8.7: Apply the same pattern to dense scene/sheet controls**

In `src/views/ScenesView.tsx`, `src/components/scenes/SceneSheetView.tsx`, and `src/components/scenes/UnifiedSceneSheetView.tsx`, only change action controls or chip-like labels that currently become awkward under constrained width. Do not replace free text such as scene memo, assignee, or search placeholder.

Use this rule:

```tsx
<CompactIconLabel icon={<MessageCircle size={10} fill="currentColor" />} label={`댓글 ${commentCount}개`} />
```

For status chips, keep color but collapse label:

```tsx
<CompactIconLabel icon={<span className="h-1.5 w-1.5 rounded-full bg-current" />} label={statusLabel} />
```

For scene detail actions:

```tsx
<CompactIconLabel icon={<ExternalLink size={12} />} label="씬 상세" />
```

The button itself must keep `min-h-[34px]`, visible focus, and `title`.

- [ ] **Step 8.8: Add short label support to sheet headers**

In `src/components/scenes/SheetColumnResize.tsx`, extend the header props:

```ts
shortLabel?: string;
```

Render:

```tsx
<span className="sheet-header-label block truncate pr-2" title={typeof children === 'string' ? children : undefined}>
  <span data-short-label>{shortLabel ?? children}</span>
  <span data-full-label>{children}</span>
</span>
```

Then add this CSS to `src/index.css`:

```css
.sheet-header-label {
  container-type: inline-size;
}

.sheet-header-label [data-short-label] {
  display: none;
}

@container (max-width: 64px) {
  .sheet-header-label [data-full-label] {
    display: none;
  }

  .sheet-header-label [data-short-label] {
    display: inline;
  }
}
```

Pass `shortLabel` for dense headers in `SceneSheetView.tsx` and `UnifiedSceneSheetView.tsx`:

```tsx
shortLabel="SB"
shortLabel="Guide"
shortLabel="BG"
shortLabel="ACT"
```

- [ ] **Step 8.9: Run compact label test**

Run:

```powershell
node --test ./tests/responsiveCompactLabels.test.ts
```

Expected: PASS.

- [ ] **Step 8.10: Commit responsive compact labels**

Run:

```powershell
git add src/components/common/CompactIconLabel.tsx src/index.css src/views/CompositingView.tsx src/views/ScenesView.tsx src/components/scenes/ScenePhaseToggle.tsx src/components/scenes/SheetColumnResize.tsx src/components/scenes/SceneSheetView.tsx src/components/scenes/UnifiedSceneCard.tsx src/components/scenes/UnifiedSceneSheetView.tsx tests/responsiveCompactLabels.test.ts
git commit -m "좁은 창 액션 라벨을 아이콘형으로 정리"
```

---

## Task 9: Final Verification And Browser Check

**Files:**
- Verify all changed files from Tasks 1-8

- [ ] **Step 9.1: Run all focused tests**

Run:

```powershell
node --test ./tests/commentThreadKey.test.ts ./tests/commentReadStateService.test.ts ./tests/commentReadStateSchema.test.ts ./tests/commentReadStateUiWiring.test.ts ./tests/responsiveCompactLabels.test.ts
```

Expected: PASS for all tests.

- [ ] **Step 9.2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9.3: Run Vite build**

Run:

```powershell
npm run build:vite
```

Expected: PASS.

- [ ] **Step 9.4: Open feedback hub preview**

Use the Browser skill to open:

```text
http://localhost:59286/?preview=feedback-hub
```

Verify:

- Scene/revision comment badge with unread comments is purple and softly pulses.
- Read badge is grey.
- Badge number stays as total comment count.
- Opening scene detail scrolls to `새 댓글`.
- Once `새 댓글` is visible, the hub badge changes to grey.
- Narrowing the window keeps dense actions as clean icons instead of `작...` style truncation or vertical text.

- [ ] **Step 9.5: Open real app scene view**

Use the Browser skill to open:

```text
http://localhost:59286/
```

Verify:

- Card view has SVG comment badge + number.
- Sheet view has the same read/unread badge behavior.
- Opening a scene detail modal marks only the current user's read state.
- Adding your own comment does not make the badge unread for yourself.
- Card/sheet controls use the same compact icon behavior when the window is narrow.

- [ ] **Step 9.6: Commit final verification notes if files changed**

If verification required code fixes, commit exact changed files.

```powershell
git status --short
git add DEVLOG/migrations/2026-05-30-comment-read-states.sql DEVLOG/supabase-init.sql electron/supabase.ts electron/main.ts electron/preload.ts src/types/index.ts src/services/supabaseService.ts src/utils/commentThreadKey.ts src/services/commentReadStateService.ts src/components/common/CompactIconLabel.tsx src/index.css src/components/scenes/CommentPanel.tsx src/components/scenes/CommentPanelResizable.tsx src/components/scenes/SceneDetailModal.tsx src/components/scenes/UnifiedSceneDetailModal.tsx src/components/scenes/ScenePhaseToggle.tsx src/components/scenes/SheetColumnResize.tsx src/views/ScenesView.tsx src/components/scenes/SceneSheetView.tsx src/components/scenes/UnifiedSceneCard.tsx src/components/scenes/UnifiedSceneSheetView.tsx src/views/CompositingView.tsx src/views/FeedbackHubPreviewApp.tsx tests/commentReadStateService.test.ts tests/commentThreadKey.test.ts tests/commentReadStateSchema.test.ts tests/commentReadStateUiWiring.test.ts tests/responsiveCompactLabels.test.ts
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "No verification fixes to commit"
} else {
  git commit -m "댓글 읽음 상태 검증 보완"
}
```

If no code fixes were needed after Task 7, do not create an empty commit.

---

## Rollback Notes

If Supabase deployment of `comment_read_states` is delayed, the UI should still work in the current session through the in-memory cache. In that state:

- New unread badges appear from loaded comments.
- Opening the modal clears badges locally.
- Cross-PC persistence starts only after the migration is applied.

Do not re-enable the previous `%APPDATA%/comment-read-state.json` storage as a fallback, because that would make "this PC only" and "all PCs" behavior diverge in a way users cannot see.

---

## Self-Review Result

- Spec coverage: Supabase 저장, 사용자 + 씬 단위 key, 본인 댓글 제외, 전체 댓글 수 유지, 보라 pulse/회색 read badge, `새 댓글` 구분선, 첫 안읽은 댓글 자동 이동, viewport 진입 시 읽음 처리, optimistic update + retry queue, 피드백 허브 공유 상태, 좁은 창 라벨 아이콘화 규칙을 Tasks 1-9에 배치했다.
- Placeholder scan: 계획 안의 실행 명령과 코드 삽입 위치를 구체화했다. 마지막 검증 commit 단계도 실제 파일 목록으로 고정했다.
- Type consistency: `CommentReadStateRow`, `sceneThreadKey`, `commentUnreadByThreadKey`, `getCommentReadStateForUser`, `markSceneThreadReadForUser` 명칭을 schema, Electron API, renderer service, UI wiring에서 같은 이름으로 맞췄다.
