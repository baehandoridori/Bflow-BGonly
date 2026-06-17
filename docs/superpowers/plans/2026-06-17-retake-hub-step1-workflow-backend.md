# 리테이크 허브 1단계: 담당자 워크플로우 데이터·백엔드 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리테이크에 담당자(assignee) 개념과 `대기→진행중→담당자완료→최종완료` 워크플로우를 데이터·로직·백엔드 계층에 도입한다 (UI는 2단계).

**Architecture:** 순수 함수(상태 파생·불변식·전이·권한)를 `src/utils/revisionWorkflow.ts`에 모아 TDD로 검증하고, 이를 DB 매핑(`mapRevision`)·서비스·스토어·IPC가 호출한다. 전체 `status`는 `final_resolved_at` + `assignee_states`에서 파생하며 컬럼은 캐시로 저장한다(읽을 때 재파생해 복원).

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Supabase(PostgreSQL), 테스트 = Node.js 내장 `node:test`.

**스펙:** `docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md` (§5 권한, §6 데이터 모델, §7 워크플로우)

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|------|------|-----------|
| `DEVLOG/migrations/2026-06-17-retake-hub.sql` | DB 스키마 변경 | 신규 |
| `src/types/index.ts` | 타입(`RevisionStatus` 확장, `RevisionAssigneeState`, `CompRevision` 확장, `CompRevisionSet`) | 수정 |
| `src/constants/revision.ts` | `STATUS_CONFIG`에 `assignee_done` | 수정 |
| `src/utils/revisionWorkflow.ts` | 순수 로직(파생 status·sanitize·전이·권한) | 신규 |
| `tests/revisionWorkflow.test.ts` | 위 순수 로직 테스트 | 신규 |
| `electron/supabase.ts` | `SupabaseRevision` 확장, `mapRevision`/`addRevision`/`updateRevision` 확장 | 수정 |
| `electron/preload.ts` | 담당/세트 IPC 노출 | 수정 |
| `electron/main.ts` | IPC 핸들러 + 활동기록 ActionType | 수정 |
| `src/services/revisionService.ts` | 담당 액션 서비스 | 수정 |
| `src/stores/useRevisionStore.ts` | 담당 액션 낙관적 업데이트 | 수정 |

> 세트(`comp_revision_sets`) 테이블은 1단계 마이그레이션에서 생성만 하고(가져오기/허브 UI는 5단계), 담당자 워크플로우에 집중한다. 세트 Realtime 핸들러는 5단계.

---

## Chunk 1: 데이터 모델 (마이그레이션 + 타입)

### Task 1: 마이그레이션 SQL 작성

**Files:**
- Create: `DEVLOG/migrations/2026-06-17-retake-hub.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 2026-06-17: 리테이크 허브 — 담당자 워크플로우 + 세트
-- spec: docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md
-- plan: docs/superpowers/plans/2026-06-17-retake-hub-step1-workflow-backend.md
--
-- comp_revisions 에 담당자(assignee_ids/assignee_states)·세트(set_id)·최종완료(final_*) 추가.
-- 전체 status 는 final_resolved_at + assignee_states 에서 파생(앱 레벨). status CHECK 에 'assignee_done' 추가.
-- scene_id 는 세트 '전반' 항목을 위해 nullable 로 완화.
-- 멱등성 유지 — 재실행 안전.

-- ─── 1) comp_revisions 컬럼 추가 ───
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS assignee_ids      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assignee_states   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS set_id            UUID         NULL,
  ADD COLUMN IF NOT EXISTS final_resolved_by TEXT         NULL,
  ADD COLUMN IF NOT EXISTS final_resolved_at TIMESTAMPTZ  NULL;

-- ─── 2) status CHECK 제약에 'assignee_done' 추가 ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'comp_revisions' AND constraint_name = 'comp_revisions_status_check'
  ) THEN
    ALTER TABLE comp_revisions DROP CONSTRAINT comp_revisions_status_check;
  END IF;
  ALTER TABLE comp_revisions
    ADD CONSTRAINT comp_revisions_status_check
    CHECK (status IN ('open','in_progress','assignee_done','resolved'));
EXCEPTION WHEN duplicate_object THEN
  -- 이미 추가됨 — 무시
  NULL;
END $$;

-- ─── 3) scene_id NOT NULL 완화 (세트 '전반' 항목) ───
ALTER TABLE comp_revisions ALTER COLUMN scene_id DROP NOT NULL;

-- ─── 4) comp_revision_sets 테이블 ───
CREATE TABLE IF NOT EXISTS comp_revision_sets (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT         NOT NULL,
  episode_number INTEGER      NULL,
  department     TEXT         NULL,
  aggregator_id  TEXT         NULL REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by     TEXT         NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── 5) set_id FK + 인덱스 ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'comp_revisions' AND constraint_name = 'comp_revisions_set_id_fkey'
  ) THEN
    ALTER TABLE comp_revisions
      ADD CONSTRAINT comp_revisions_set_id_fkey
      FOREIGN KEY (set_id) REFERENCES comp_revision_sets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comp_revisions_set ON comp_revisions(set_id) WHERE set_id IS NOT NULL;

-- ─── 6) RLS allow_all (기존 테이블 컨벤션 동일) ───
ALTER TABLE comp_revision_sets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comp_revision_sets' AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON comp_revision_sets FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ─── 7) updated_at 자동 갱신 트리거 ───
CREATE OR REPLACE FUNCTION set_comp_revision_sets_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comp_revision_sets_updated_at ON comp_revision_sets;
CREATE TRIGGER trg_comp_revision_sets_updated_at
  BEFORE UPDATE ON comp_revision_sets
  FOR EACH ROW EXECUTE FUNCTION set_comp_revision_sets_updated_at();

-- ─── 8) Realtime publication ───
-- 주의: comp_revision_sets 핸들러는 5단계(허브)에서 추가한다. publication 등록은
-- 핸들러가 없어도 무해(이벤트 무시)하므로 여기서 함께 등록한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='comp_revision_sets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comp_revision_sets;
  END IF;
END $$;
```

- [ ] **Step 2: SQL 문법 자체 점검 (수동)**

라이브 DB 적용은 한솔 승인 후. 이 단계에서는 파일이 멱등 패턴(IF NOT EXISTS/DO $$)을 따르는지 눈으로 확인한다. (다른 마이그레이션 `2026-05-21-compositing-states.sql`과 동일 스타일.)

> 참고: 라이브 DB에는 현재 `comp_revisions_status_check` 제약이 **없다**(init SQL·마이그레이션 어디에도 없으며 `status`는 `TEXT DEFAULT 'open'`). 따라서 섹션 2)의 DO 블록은 실제로는 "교체"가 아니라 **CHECK 제약 신규 추가**다. 기존 status 값(`open`/`in_progress`/`resolved`)은 모두 새 enum에 포함되므로 ADD CONSTRAINT가 실패하지 않는다.

- [ ] **Step 3: Commit**

```bash
git add DEVLOG/migrations/2026-06-17-retake-hub.sql
git commit -m "리테이크 허브 1단계: 담당자·세트 마이그레이션 SQL"
```

---

### Task 2: 타입 정의 추가

**Files:**
- Modify: `src/types/index.ts:216-243` (RevisionStatus, CompRevision)

- [ ] **Step 1: `RevisionStatus` 확장 + 담당자 상태 타입 추가**

`src/types/index.ts`의 `export type RevisionStatus = ...` 라인을 다음으로 교체하고, 바로 아래에 신규 타입 추가:

```ts
export type RevisionStatus = 'open' | 'in_progress' | 'assignee_done' | 'resolved';
export type RevisionPriority = 'urgent' | 'high' | 'normal';

export type AssigneeState = 'pending' | 'in_progress' | 'done';

export interface RevisionAssigneeState {
  state: AssigneeState;
  note?: string;        // 담당자 완료 멘트(파일경로 등)
  startedAt?: string;   // ISO 8601
  doneAt?: string;      // ISO 8601
}
```

- [ ] **Step 2: `CompRevision`에 신규 필드 추가**

`CompRevision` 인터페이스의 `notifyUserIds?: string[];` 아래에 추가:

```ts
  /** 담당자 user.id 배열 (반드시 notifyUserIds의 부분집합). */
  assigneeIds?: string[];
  /** 담당자별 상태 맵 { [userId]: { state, note?, startedAt?, doneAt? } }. */
  assigneeStates?: Record<string, RevisionAssigneeState>;
  /** 소속 리테이크 세트 id (없으면 일반 리테이크). */
  setId?: string | null;
  /** 최종 완료자 이름. */
  finalResolvedBy?: string;
  /** 최종 완료 시각 ISO 8601. */
  finalResolvedAt?: string;
```

- [ ] **Step 3: `CompRevisionSet` 타입 추가**

`CompRevision` 인터페이스 정의 바로 뒤에 추가:

```ts
export interface CompRevisionSet {
  id: string;
  title: string;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  aggregatorId?: string | null;
  status: 'open' | 'done';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck`
Expected: PASS (신규 옵셔널 필드라 기존 사용처 영향 없음). `STATUS_CONFIG`가 `Record<RevisionStatus, ...>`라 `assignee_done` 누락 에러가 날 수 있음 → Task 3에서 해결. 이 단계에서 그 에러만 남으면 정상.

---

### Task 3: STATUS_CONFIG에 assignee_done 추가

**Files:**
- Modify: `src/constants/revision.ts`

- [ ] **Step 1: `STATUS_CONFIG`에 `assignee_done` 항목 추가**

`in_progress` 항목과 `resolved` 항목 사이에 추가:

```ts
  assignee_done: {
    label: '담당 완료',
    color: 'rgb(var(--color-accent))',
    bg: 'color-mix(in srgb, rgb(var(--color-accent)) 15%, transparent)',
  },
```

> 주의: `--color-accent`는 RGB triplet(`108 92 231`)이라 `var(--color-accent)` 단독은 invalid CSS color다. 반드시 `rgb(var(--color-accent))`로 감싼다.

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/constants/revision.ts
git commit -m "리테이크 허브 1단계: 담당자 워크플로우 타입 + assignee_done 상태"
```

---

## Chunk 2: 순수 워크플로우 로직 (TDD)

> 모든 함수는 `src/utils/revisionWorkflow.ts`에, 테스트는 `tests/revisionWorkflow.test.ts`에. 테스트는 `node --test tests/revisionWorkflow.test.ts`로 실행.

### Task 4: deriveRevisionStatus (전체 status 파생)

**Files:**
- Create: `src/utils/revisionWorkflow.ts`
- Test: `tests/revisionWorkflow.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`tests/revisionWorkflow.test.ts` 생성:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveRevisionStatus } from '../src/utils/revisionWorkflow.ts';
import type { RevisionAssigneeState } from '../src/types/index.ts';

const S = (state: 'pending' | 'in_progress' | 'done'): RevisionAssigneeState => ({ state });

test('deriveRevisionStatus: final_resolved_at 있으면 항상 resolved', () => {
  assert.equal(deriveRevisionStatus(['a'], { a: S('done') }, '2026-06-17T00:00:00Z'), 'resolved');
  assert.equal(deriveRevisionStatus([], {}, '2026-06-17T00:00:00Z'), 'resolved');
});

test('deriveRevisionStatus: 담당자 0명이면 open', () => {
  assert.equal(deriveRevisionStatus([], {}, null), 'open');
});

test('deriveRevisionStatus: 전원 pending이면 open', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('pending'), b: S('pending') }, null), 'open');
});

test('deriveRevisionStatus: 전원 done이면 assignee_done', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done'), b: S('done') }, null), 'assignee_done');
});

test('deriveRevisionStatus: 일부만 done이면 in_progress', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done'), b: S('pending') }, null), 'in_progress');
});

test('deriveRevisionStatus: 누군가 in_progress면 in_progress', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('in_progress'), b: S('pending') }, null), 'in_progress');
});

test('deriveRevisionStatus: state 누락 항목은 pending 취급', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done') }, null), 'in_progress');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/revisionWorkflow.test.ts`
Expected: FAIL ("Cannot find module '../src/utils/revisionWorkflow.ts'")

- [ ] **Step 3: 최소 구현**

`src/utils/revisionWorkflow.ts` 생성:

```ts
import type { RevisionStatus, RevisionAssigneeState } from '@/types';

/**
 * 전체 status 파생 (권위). 위에서부터 먼저 만족하는 것:
 * 1. final_resolved_at 있으면 → resolved
 * 2. 담당자 0명 또는 전원 pending → open
 * 3. 담당자 전원 done → assignee_done
 * 4. 그 외 → in_progress
 */
export function deriveRevisionStatus(
  assigneeIds: readonly string[],
  assigneeStates: Readonly<Record<string, RevisionAssigneeState>>,
  finalResolvedAt: string | null | undefined,
): RevisionStatus {
  if (finalResolvedAt) return 'resolved';
  if (assigneeIds.length === 0) return 'open';
  const states = assigneeIds.map((id) => assigneeStates[id]?.state ?? 'pending');
  if (states.every((s) => s === 'pending')) return 'open';
  if (states.every((s) => s === 'done')) return 'assignee_done';
  return 'in_progress';
}
```

> 참고: 테스트는 `'@/types'` alias를 `node --test`가 해석 못 할 수 있다. 테스트에서는 타입만 `import type ... from '../src/types/index.ts'`로 가져오고, 구현의 `import type { ... } from '@/types'`는 런타임에 제거되므로(타입 전용) 문제없다. 만약 `node --test`가 alias로 실패하면 구현의 import도 상대경로 `./...`가 아닌 타입 전용이라 무시되는지 확인하고, 안 되면 `import type`만 쓰는 현 형태를 유지한다(타입 import는 트랜스파일 시 제거됨).

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/revisionWorkflow.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/revisionWorkflow.ts tests/revisionWorkflow.test.ts
git commit -m "리테이크 허브 1단계: deriveRevisionStatus 파생 로직 + 테스트"
```

---

### Task 5: sanitizeAssignees (불변식 assignee_ids ⊆ notify_user_ids)

**Files:**
- Modify: `src/utils/revisionWorkflow.ts`
- Modify: `tests/revisionWorkflow.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`tests/revisionWorkflow.test.ts` 끝에 추가 (import에 `sanitizeAssignees` 추가):

```ts
import { sanitizeAssignees } from '../src/utils/revisionWorkflow.ts';

test('sanitizeAssignees: notify에 없는 담당자 제거', () => {
  const r = sanitizeAssignees(['a', 'b', 'c'], { a: S('done'), b: S('in_progress'), c: S('pending') }, ['a', 'b']);
  assert.deepEqual(r.assigneeIds, ['a', 'b']);
  assert.deepEqual(Object.keys(r.assigneeStates).sort(), ['a', 'b']);
  assert.equal(r.assigneeStates.a.state, 'done');
});

test('sanitizeAssignees: state 없는 담당자는 pending으로 채움', () => {
  const r = sanitizeAssignees(['a'], {}, ['a', 'b']);
  assert.deepEqual(r.assigneeIds, ['a']);
  assert.equal(r.assigneeStates.a.state, 'pending');
});

test('sanitizeAssignees: 빈 입력', () => {
  const r = sanitizeAssignees([], {}, []);
  assert.deepEqual(r.assigneeIds, []);
  assert.deepEqual(r.assigneeStates, {});
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/revisionWorkflow.test.ts`
Expected: FAIL ("sanitizeAssignees is not a function" 또는 import 에러)

- [ ] **Step 3: 구현 추가**

`src/utils/revisionWorkflow.ts`에 추가:

```ts
/**
 * 불변식 assignee_ids ⊆ notify_user_ids 복원.
 * notify에 없는 담당자는 제거, state 없는 담당자는 pending으로 채움.
 */
export function sanitizeAssignees(
  assigneeIds: readonly string[],
  assigneeStates: Readonly<Record<string, RevisionAssigneeState>>,
  notifyUserIds: readonly string[],
): { assigneeIds: string[]; assigneeStates: Record<string, RevisionAssigneeState> } {
  const allowed = new Set(notifyUserIds);
  const cleanIds = assigneeIds.filter((id) => allowed.has(id));
  const cleanStates: Record<string, RevisionAssigneeState> = {};
  for (const id of cleanIds) {
    cleanStates[id] = assigneeStates[id] ?? { state: 'pending' };
  }
  return { assigneeIds: cleanIds, assigneeStates: cleanStates };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/revisionWorkflow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/revisionWorkflow.ts tests/revisionWorkflow.test.ts
git commit -m "리테이크 허브 1단계: sanitizeAssignees 불변식 복원 + 테스트"
```

---

### Task 6: 담당 상태 전이 함수

**Files:**
- Modify: `src/utils/revisionWorkflow.ts`
- Modify: `tests/revisionWorkflow.test.ts`

전이 함수는 `assignee_states`의 불변 업데이트만 책임진다 (DB 저장은 호출부). 각 함수는 `{ assigneeIds, assigneeStates }`를 받아 새 `assigneeStates`를 반환.

- [ ] **Step 1: 실패 테스트 추가**

```ts
import { startAssignee, completeAssignee, revertAssignee } from '../src/utils/revisionWorkflow.ts';

test('startAssignee: pending → in_progress, startedAt 세팅', () => {
  const next = startAssignee({ a: S('pending') }, 'a', '2026-06-17T01:00:00Z');
  assert.equal(next.a.state, 'in_progress');
  assert.equal(next.a.startedAt, '2026-06-17T01:00:00Z');
});

test('completeAssignee: → done, note/doneAt 세팅', () => {
  const next = completeAssignee({ a: S('in_progress') }, 'a', 'G:\\path\\v3.psd', '2026-06-17T02:00:00Z');
  assert.equal(next.a.state, 'done');
  assert.equal(next.a.note, 'G:\\path\\v3.psd');
  assert.equal(next.a.doneAt, '2026-06-17T02:00:00Z');
});

test('revertAssignee: done → in_progress, doneAt 제거', () => {
  const next = revertAssignee({ a: { state: 'done', note: 'x', doneAt: 't' } }, 'a');
  assert.equal(next.a.state, 'in_progress');
  assert.equal(next.a.doneAt, undefined);
});

test('전이 함수는 원본을 변경하지 않는다(불변)', () => {
  const orig = { a: S('pending') };
  startAssignee(orig, 'a', 't');
  assert.equal(orig.a.state, 'pending');
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/revisionWorkflow.test.ts` → FAIL

- [ ] **Step 3: 구현 추가**

```ts
type StateMap = Record<string, RevisionAssigneeState>;

export function startAssignee(states: Readonly<StateMap>, userId: string, now: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  return { ...states, [userId]: { ...prev, state: 'in_progress', startedAt: prev.startedAt ?? now } };
}

export function completeAssignee(states: Readonly<StateMap>, userId: string, note: string, now: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  return { ...states, [userId]: { ...prev, state: 'done', note, doneAt: now } };
}

export function revertAssignee(states: Readonly<StateMap>, userId: string): StateMap {
  const prev = states[userId] ?? { state: 'pending' };
  const next: RevisionAssigneeState = { ...prev, state: 'in_progress' };
  delete next.doneAt;
  return { ...states, [userId]: next };
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --test tests/revisionWorkflow.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/revisionWorkflow.ts tests/revisionWorkflow.test.ts
git commit -m "리테이크 허브 1단계: 담당 상태 전이 함수 + 테스트"
```

---

### Task 7: 권한 가드

**Files:**
- Modify: `src/utils/revisionWorkflow.ts`
- Modify: `tests/revisionWorkflow.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

```ts
import { canReassignRevision, canFinalResolveRevision, canActAsAssignee } from '../src/utils/revisionWorkflow.ts';
import type { AppUser, CompRevision } from '../src/types/index.ts';

const user = (over: Partial<AppUser>): AppUser =>
  ({ id: 'u', name: 'n', slackId: '', password: '', isInitialPassword: false, createdAt: '', ...over });
const rev = (over: Partial<CompRevision>): CompRevision =>
  ({ id: 'r', sceneKey: '', revisionNo: 1, status: 'open', priority: 'normal', description: '',
     requesterId: 'req', requesterName: '', createdAt: '', updatedAt: '', ...over });

test('canReassignRevision: 요청자 본인 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'req' }), rev({ requesterId: 'req' })), true);
});
test('canReassignRevision: 컴포지터 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'x', isCompositor: true }), rev({})), true);
});
test('canReassignRevision: admin 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'x', role: 'admin' }), rev({})), true);
});
test('canReassignRevision: 무관한 일반 사용자 거부', () => {
  assert.equal(canReassignRevision(user({ id: 'x' }), rev({ requesterId: 'req' })), false);
});
test('canReassignRevision: null 사용자 거부', () => {
  assert.equal(canReassignRevision(null, rev({})), false);
});
test('canFinalResolveRevision: 요청자/컴포지터급만', () => {
  assert.equal(canFinalResolveRevision(user({ id: 'req' }), rev({ requesterId: 'req' })), true);
  assert.equal(canFinalResolveRevision(user({ id: 'x' }), rev({ requesterId: 'req' })), false);
});
test('canActAsAssignee: 담당자 본인만', () => {
  assert.equal(canActAsAssignee(user({ id: 'a' }), rev({ assigneeIds: ['a', 'b'] })), true);
  assert.equal(canActAsAssignee(user({ id: 'z' }), rev({ assigneeIds: ['a', 'b'] })), false);
});
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/revisionWorkflow.test.ts` → FAIL

- [ ] **Step 3: 구현 추가**

`revisionWorkflow.ts` 상단 import에 추가: `import { isCompositorForCompositing } from '@/utils/compositingLabels';` 그리고 `import type { AppUser, CompRevision } from '@/types';`

```ts
/** 컴포지터급(컴포지터/admin/배한솔) 또는 리테이크 요청자 본인. */
function isRequesterOrCompositor(user: AppUser | null | undefined, revision: Pick<CompRevision, 'requesterId'>): boolean {
  if (!user) return false;
  if (revision.requesterId && revision.requesterId === user.id) return true;
  return isCompositorForCompositing(user);
}

export function canReassignRevision(user: AppUser | null | undefined, revision: Pick<CompRevision, 'requesterId'>): boolean {
  return isRequesterOrCompositor(user, revision);
}

export function canFinalResolveRevision(user: AppUser | null | undefined, revision: Pick<CompRevision, 'requesterId'>): boolean {
  return isRequesterOrCompositor(user, revision);
}

export function canActAsAssignee(user: AppUser | null | undefined, revision: Pick<CompRevision, 'assigneeIds'>): boolean {
  if (!user) return false;
  return (revision.assigneeIds ?? []).includes(user.id);
}
```

- [ ] **Step 4: 통과 확인** — Run: `node --test tests/revisionWorkflow.test.ts` → PASS (전체 통과)

- [ ] **Step 5: 타입체크 + 커밋**

Run: `npm run typecheck` → PASS

```bash
git add src/utils/revisionWorkflow.ts tests/revisionWorkflow.test.ts
git commit -m "리테이크 허브 1단계: 권한 가드(재배정/최종완료/담당) + 테스트"
```

---

## Chunk 3: DB 계층 (supabase.ts)

### Task 8: SupabaseRevision 확장 + mapRevision 파생/sanitize

**Files:**
- Modify: `electron/supabase.ts:159-178` (SupabaseRevision), `:1897-1920` (mapRevision)
- Modify: `src/services/revisionService.ts:290-338` (rowToRevision + loadAllRevisions row 타입 — IPC 결과 재매핑, P1)

> 주의: `electron/`는 `@/` alias를 쓰지 않을 수 있다. 기존 `electron/supabase.ts`의 import 스타일을 따른다. `deriveRevisionStatus`/`sanitizeAssignees`는 순수 함수이므로 `electron/`에서 상대경로로 import하거나, 의존을 피하려면 mapRevision 내부에 동일 로직을 인라인한다. **기본 방침: `src/utils/revisionWorkflow.ts`에서 import** (메인 프로세스도 TS 번들에 포함됨 — 기존에 `src/`를 import하는 예가 있는지 확인 후, 없으면 인라인).

- [ ] **Step 1: `SupabaseRevision`에 필드 추가**

```ts
  assigneeIds: string[];
  assigneeStates: Record<string, { state: string; note?: string; startedAt?: string; doneAt?: string }>;
  setId: string | null;
  finalResolvedBy: string;
  finalResolvedAt: string | null;
```

- [ ] **Step 2: `mapRevision`에서 신규 필드 매핑 + 파생 status 복원**

`mapRevision` 반환 객체에 추가하고, `status`를 파생값으로 덮어쓴다:

```ts
  const rawAssigneeIds = r.assignee_ids;
  const assigneeIds: string[] = Array.isArray(rawAssigneeIds)
    ? (rawAssigneeIds.filter((x) => typeof x === 'string') as string[])
    : [];
  const assigneeStates = (r.assignee_states && typeof r.assignee_states === 'object')
    ? (r.assignee_states as Record<string, { state: string; note?: string; startedAt?: string; doneAt?: string }>)
    : {};
  const finalResolvedAt = (r.final_resolved_at as string) || null;

  // 불변식 복원: assignee_ids ⊆ notify_user_ids
  const allowed = new Set(notifyUserIds);
  const cleanAssigneeIds = assigneeIds.filter((id) => allowed.has(id));

  // 파생 status (권위) — 저장된 status는 캐시로 보고 재계산값으로 덮어씀
  let derivedStatus: string;
  if (finalResolvedAt) derivedStatus = 'resolved';
  else if (cleanAssigneeIds.length === 0) derivedStatus = 'open';
  else {
    const states = cleanAssigneeIds.map((id) => assigneeStates[id]?.state ?? 'pending');
    if (states.every((s) => s === 'pending')) derivedStatus = 'open';
    else if (states.every((s) => s === 'done')) derivedStatus = 'assignee_done';
    else derivedStatus = 'in_progress';
  }
```

반환 객체의 `status`를 `derivedStatus`로, 그리고:
```ts
    status: derivedStatus,
    assigneeIds: cleanAssigneeIds,
    assigneeStates,
    setId: (r.set_id as string) || null,
    finalResolvedBy: (r.final_resolved_by as string) || '',
    finalResolvedAt,
```

> 레거시 행(컬럼이 없던 시절): `assignee_ids` 없으면 `[]`, `final_resolved_at` 없으면 status는 저장값 그대로 쓰지 말고 위 규칙으로 `open`이 됨. 기존 'resolved' 레거시 데이터가 있으면 `final_resolved_at`이 없어 `open`으로 보일 수 있으므로, **마이그레이션 보강**: 기존 `status='resolved'` 행을 `final_resolved_at = COALESCE(resolved_at, updated_at)`로 백필. (Task 1 SQL에 추가 — 아래 Step 3.)

- [ ] **Step 3: 마이그레이션에 레거시 status 백필 추가**

`DEVLOG/migrations/2026-06-17-retake-hub.sql` 끝에 추가:

```sql
-- ─── 9) 레거시 resolved 행을 final_resolved_at 로 백필 (파생 status 호환) ───
UPDATE comp_revisions
  SET final_resolved_at = COALESCE(resolved_at, updated_at, now())
  WHERE status = 'resolved' AND final_resolved_at IS NULL;
```

- [ ] **Step 3.5: 렌더러 측 rowToRevision + loadAllRevisions row 타입 확장 (P1 — 필수)**

`mapRevision` 결과는 IPC(`supabaseReadRevisions`)를 거쳐 렌더러 `src/services/revisionService.ts`의 `rowToRevision`(약 L290-324)이 다시 `CompRevision`으로 매핑한다. 여기서 신규 필드를 복사하지 않으면 스토어의 `CompRevision`에서 `assigneeIds` 등이 항상 undefined가 되어 파생 status가 무너진다(낙관적 업데이트로 잠깐 보였다 `loadRevisions()` 후 사라짐). `rowToRevision` 반환 객체에 추가:

```ts
  assigneeIds: Array.isArray(row.assigneeIds) ? row.assigneeIds : [],
  assigneeStates: (row.assigneeStates && typeof row.assigneeStates === 'object') ? row.assigneeStates : {},
  setId: (row.setId as string) ?? null,
  finalResolvedBy: (row.finalResolvedBy as string) ?? '',
  finalResolvedAt: (row.finalResolvedAt as string) || undefined,
```

그리고 `loadAllRevisions`의 row 타입 정의(약 L330-338)에 신규 필드(`assigneeIds`, `assigneeStates`, `setId`, `finalResolvedBy`, `finalResolvedAt`)를 `mapRevision` 반환 형태와 일치하게 추가한다.

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/supabase.ts src/services/revisionService.ts DEVLOG/migrations/2026-06-17-retake-hub.sql
git commit -m "리테이크 허브 1단계: mapRevision + rowToRevision 담당자 매핑 + 파생 status 복원 + 레거시 백필"
```

---

### Task 9: addRevision — 담당자 필드 저장

**Files:**
- Modify: `electron/supabase.ts:1790-1875` (addRevision)

생성 시 담당자는 보통 비어 있거나 일부 지정. 1단계에서는 `assignee_ids`/`assignee_states`를 받아 저장할 수 있게 시그니처를 확장한다. UI 연결은 2단계지만 경로는 미리 준비.

- [ ] **Step 1: `addRevision` 시그니처에 옵셔널 파라미터 추가**

마지막 파라미터 `notifyUserIdsJson?` 뒤에:
```ts
  assigneeIdsJson?: string,
```

- [ ] **Step 2: 파싱 + insert에 포함**

`notifyUserIds` 파싱부 아래에:
```ts
  let assigneeIds: string[] = [];
  if (assigneeIdsJson) {
    try {
      const parsed = JSON.parse(assigneeIdsJson);
      if (Array.isArray(parsed)) assigneeIds = parsed.filter((x) => typeof x === 'string');
    } catch { /* 무시 */ }
  }
  // 불변식: 담당자는 알림 대상에 포함
  const notifySet = new Set(notifyUserIds);
  assigneeIds = assigneeIds.filter((id) => notifySet.has(id));
  const assigneeStates: Record<string, { state: string }> = {};
  for (const id of assigneeIds) assigneeStates[id] = { state: 'pending' };
```

`.insert({...})` 객체에 추가:
```ts
    assignee_ids: assigneeIds,
    assignee_states: assigneeStates,
```

- [ ] **Step 3: 타입체크** — Run: `npm run typecheck` → PASS

- [ ] **Step 4: Commit**

```bash
git add electron/supabase.ts
git commit -m "리테이크 허브 1단계: addRevision 담당자 저장 경로"
```

---

### Task 10: updateRevision — fieldMap 확장

**Files:**
- Modify: `electron/supabase.ts:1878-1895` (updateRevision)

- [ ] **Step 1: `fieldMap`에 신규 필드 추가**

```ts
    assigneeIds: 'assignee_ids',
    assigneeStates: 'assignee_states',
    setId: 'set_id',
    finalResolvedBy: 'final_resolved_by',
    finalResolvedAt: 'final_resolved_at',
```

- [ ] **Step 2: JSONB 값 처리**

`updates`는 `Record<string, string>`이라 JSON 컬럼은 문자열로 들어온다. `assignee_ids`/`assignee_states`/`set_id`는 JSON 파싱이 필요:

`for (const [k, v] of Object.entries(updates))` 루프를 다음으로 교체:
```ts
  const jsonFields = new Set(['assigneeIds', 'assigneeStates']);
  for (const [k, v] of Object.entries(updates)) {
    const col = fieldMap[k] || k;
    if (jsonFields.has(k)) {
      try { dbUpdates[col] = JSON.parse(v); } catch { dbUpdates[col] = v; }
    } else {
      dbUpdates[col] = v;
    }
  }
```

- [ ] **Step 3: 타입체크** — Run: `npm run typecheck` → PASS

- [ ] **Step 4: Commit**

```bash
git add electron/supabase.ts
git commit -m "리테이크 허브 1단계: updateRevision 담당자/세트/최종완료 필드 매핑"
```

---

## Chunk 4: 서비스 + 스토어 + IPC + 활동기록

### Task 11: 활동기록 ActionType 추가

**Files:**
- Modify: `src/types/index.ts` (ActionType)
- Modify: `electron/main.ts:1898-1981` (update-revision 핸들러)

- [ ] **Step 1: `ActionType`에 추가**

`src/types/index.ts`의 `ActionType` 유니온에 `| 'revision_assignee_done' | 'revision_final_resolve' | 'revision_reassign'` 추가 (기존 `revision_resolve` 라인 근처).

- [ ] **Step 2: main.ts update-revision 핸들러에서 새 status에 맞는 활동기록**

기존 핸들러는 `status`가 `in_progress`/`resolved`일 때만 기록한다. `updates.status`가 `assignee_done`이면 `revision_assignee_done`, `updates.finalResolvedAt`이 있으면 `revision_final_resolve`로 기록하도록 분기 추가. (기존 분기 패턴을 따라 `statusActionType` 결정 로직을 확장.)

```ts
  // 기존: const statusActionType = updates.status === 'resolved' ? 'revision_resolve' : 'revision_in_progress';
  // 변경:
  let statusActionType: ActionType | null = null;
  if (updates.finalResolvedAt) statusActionType = 'revision_final_resolve';
  else if (updates.status === 'assignee_done') statusActionType = 'revision_assignee_done';
  else if (updates.status === 'in_progress') statusActionType = 'revision_in_progress';
  else if (updates.status === 'resolved') statusActionType = 'revision_resolve';
  else if (updates.assigneeIds) statusActionType = 'revision_reassign';
  // statusActionType이 null이면 활동기록 스킵
```

- [ ] **Step 3: 타입체크** — Run: `npm run typecheck` → PASS

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts electron/main.ts
git commit -m "리테이크 허브 1단계: 담당완료/최종완료/재배정 활동기록"
```

---

### Task 12: revisionService — 담당 액션

**Files:**
- Modify: `src/services/revisionService.ts:495-555` (updateRevisionStatus 근처)

서비스는 순수 함수(`revisionWorkflow`)로 다음 `assigneeStates`를 계산하고, `updateRevisionStatus`가 쓰는 IPC(`supabaseUpdateRevision(id, updates)`)로 저장한다. `updates`는 `Record<string,string>`이므로 JSON은 `JSON.stringify`.

- [ ] **Step 1: 담당 액션 함수 추가**

```ts
import {
  startAssignee, completeAssignee, revertAssignee, deriveRevisionStatus, sanitizeAssignees,
} from '@/utils/revisionWorkflow';

/** 담당자 본인이 작업 시작 (pending/none → in_progress). */
export async function startAssigneeWork(rev: CompRevision, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const states = startAssignee(rev.assigneeStates ?? {}, userId, now);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    assigneeStates: JSON.stringify(states), status, updatedAt: now,
  });
}

/** 담당자 본인 완료 (멘트 포함). */
export async function completeAssigneeWork(rev: CompRevision, userId: string, note: string): Promise<void> {
  const now = new Date().toISOString();
  const states = completeAssignee(rev.assigneeStates ?? {}, userId, note, now);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    assigneeStates: JSON.stringify(states), status, updatedAt: now,
  });
}

/** 담당자 재배정 (요청자/컴포지터급). assigneeIds는 notify의 부분집합으로 sanitize. */
export async function reassignRevision(rev: CompRevision, nextAssigneeIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { assigneeIds, assigneeStates } = sanitizeAssignees(
    nextAssigneeIds, rev.assigneeStates ?? {}, rev.notifyUserIds ?? [],
  );
  const status = deriveRevisionStatus(assigneeIds, assigneeStates, rev.finalResolvedAt);
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    assigneeIds: JSON.stringify(assigneeIds),
    assigneeStates: JSON.stringify(assigneeStates),
    status, updatedAt: now,
  });
}

/** 최종 완료 (요청자/컴포지터급). */
export async function finalResolveRevision(rev: CompRevision, byName: string): Promise<void> {
  const now = new Date().toISOString();
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    finalResolvedAt: now, finalResolvedBy: byName, status: 'resolved', updatedAt: now,
  });
}

/** 최종 완료 되돌리기. */
export async function revertFinalResolve(rev: CompRevision): Promise<void> {
  const now = new Date().toISOString();
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], rev.assigneeStates ?? {}, null);
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    finalResolvedAt: '', finalResolvedBy: '', status, updatedAt: now,
  });
}

/** 담당자 본인 완료 되돌리기 (done → in_progress). 최종완료 상태면 차단(spec §6.2). */
export async function revertAssigneeWork(rev: CompRevision, userId: string): Promise<void> {
  if (rev.finalResolvedAt) {
    throw new Error('최종 완료된 리테이크는 먼저 최종 완료를 되돌려야 합니다.');
  }
  const now = new Date().toISOString();
  const states = revertAssignee(rev.assigneeStates ?? {}, userId);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await window.electronAPI.supabaseUpdateRevision(rev.id, {
    assigneeStates: JSON.stringify(states), status, updatedAt: now,
  });
}
```

> `revertAssignee` 순수 함수(Task 6)를 import에 포함해야 한다(아래 Step 1 import 라인에 이미 포함).

> `finalResolvedAt: ''` 빈 문자열로 NULL 처리 — `updateRevision`이 빈 문자열을 그대로 저장하면 파생에서 truthy 체크에 걸리지 않으므로 OK. (`mapRevision`의 `(r.final_resolved_at as string) || null`이 빈 문자열을 null로 정규화.)

- [ ] **Step 2: 타입체크** — Run: `npm run typecheck` → PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/revisionService.ts
git commit -m "리테이크 허브 1단계: 담당 시작/완료/재배정/최종완료 서비스"
```

---

### Task 13: useRevisionStore — 낙관적 액션

**Files:**
- Modify: `src/stores/useRevisionStore.ts:157-183` (updateStatus 근처)

기존 `updateRevisionOptimistic(id, sceneKey, updates)`를 재사용한다.

- [ ] **Step 1: 스토어 액션 추가**

```ts
  startAssignee: async (rev: CompRevision, userId: string) => {
    const now = new Date().toISOString();
    const states = startAssignee(rev.assigneeStates ?? {}, userId, now);
    const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status, updatedAt: now });
    try { await revisionService.startAssigneeWork(rev, userId); }
    catch { await get().loadRevisions(); }
  },

  completeAssignee: async (rev: CompRevision, userId: string, note: string) => {
    const now = new Date().toISOString();
    const states = completeAssignee(rev.assigneeStates ?? {}, userId, note, now);
    const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status, updatedAt: now });
    try { await revisionService.completeAssigneeWork(rev, userId, note); }
    catch { await get().loadRevisions(); }
  },

  reassign: async (rev: CompRevision, nextAssigneeIds: string[]) => {
    const { assigneeIds, assigneeStates } = sanitizeAssignees(nextAssigneeIds, rev.assigneeStates ?? {}, rev.notifyUserIds ?? []);
    const status = deriveRevisionStatus(assigneeIds, assigneeStates, rev.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeIds, assigneeStates, status });
    try { await revisionService.reassignRevision(rev, nextAssigneeIds); }
    catch { await get().loadRevisions(); }
  },

  finalResolve: async (rev: CompRevision, byName: string) => {
    const now = new Date().toISOString();
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { finalResolvedAt: now, finalResolvedBy: byName, status: 'resolved' });
    try { await revisionService.finalResolveRevision(rev, byName); }
    catch { await get().loadRevisions(); }
  },

  revertFinalResolve: async (rev: CompRevision) => {
    const status = deriveRevisionStatus(rev.assigneeIds ?? [], rev.assigneeStates ?? {}, null);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { finalResolvedAt: undefined, finalResolvedBy: undefined, status });
    try { await revisionService.revertFinalResolve(rev); }
    catch { await get().loadRevisions(); }
  },

  revertAssignee: async (rev: CompRevision, userId: string) => {
    if (rev.finalResolvedAt) return; // 최종완료 상태면 차단 (spec §6.2)
    const states = revertAssignee(rev.assigneeStates ?? {}, userId);
    const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
    get().updateRevisionOptimistic(rev.id, rev.sceneKey, { assigneeStates: states, status });
    try { await revisionService.revertAssigneeWork(rev, userId); }
    catch { await get().loadRevisions(); }
  },
```

스토어 인터페이스(`RevisionState`)에 위 액션 시그니처(`startAssignee`/`completeAssignee`/`reassign`/`finalResolve`/`revertFinalResolve`/`revertAssignee`)를 추가하고, 파일 상단에 `import { startAssignee, completeAssignee, revertAssignee, deriveRevisionStatus, sanitizeAssignees } from '@/utils/revisionWorkflow';` 추가.

- [ ] **Step 2: 타입체크** — Run: `npm run typecheck` → PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/useRevisionStore.ts
git commit -m "리테이크 허브 1단계: 담당 액션 낙관적 스토어"
```

---

### Task 14: IPC 시그니처 정합 확인 + 1단계 통합 검증

**Files:**
- Modify: `electron/preload.ts:219-233` (필요 시 `supabaseAddRevision` 파라미터 추가)

- [ ] **Step 1: preload `supabaseAddRevision`에 `assigneeIdsJson` 옵셔널 추가**

`notifyUserIdsJson` 뒤에 `assigneeIdsJson?: string` 추가하고 `ipcRenderer.invoke(...)` 인자에도 전달. main의 `supabase:add-revision` 핸들러도 동일 파라미터를 받아 `sbAddRevision(..., assigneeIdsJson)`에 넘긴다.

> `supabaseUpdateRevision(id, updates)`는 이미 `Record<string,string>`을 받으므로 담당 액션에 변경 불필요.

- [ ] **Step 2: 전체 테스트 + 타입체크 + 빌드**

Run: `node --test tests/revisionWorkflow.test.ts`
Expected: PASS (전체)

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build:vite`
Expected: 성공 (에러 없이 번들 생성)

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts electron/main.ts
git commit -m "리테이크 허브 1단계: addRevision 담당자 IPC 배선 + 1단계 통합 검증"
```

---

## 1단계 완료 기준 (Definition of Done)

- [ ] `node --test tests/revisionWorkflow.test.ts` 전체 통과 (파생/sanitize/전이/권한)
- [ ] `npm run typecheck` 통과
- [ ] `npm run build:vite` 통과
- [ ] 마이그레이션 SQL 멱등성 확인 (라이브 적용은 한솔 승인 후)
- [ ] UI 없이도 담당 액션 경로(서비스/스토어/IPC/DB)가 타입 정합
- [ ] 되돌리기 경로(`revertFinalResolve`/`revertAssignee`)가 서비스·스토어에 포함되고, `resolved` 상태 담당자 되돌리기 차단 가드가 동작

> **다음 단계(2단계):** 인라인 카드(시안 A) — `RevisionPanel`에 담당 칩·최종완료 바·인라인 확장을 붙이고 위 스토어 액션을 연결. 별도 plan으로 작성.

---

## 미해결 / 구현 중 결정

- `electron/`에서 `src/utils/revisionWorkflow.ts` import 가능 여부(번들 구성)를 Task 8 시작 시 확인. 불가하면 `mapRevision` 내 파생 로직은 인라인(이미 인라인으로 작성됨), 나머지 메인 프로세스 의존 없음.
- `node --test`의 TS/alias 처리: 기존 테스트가 `../src/...ts` 상대경로 + `import type`만 쓰므로 동일 패턴 유지. 구현 파일의 `@/` alias는 타입 전용 import에만 사용(런타임 제거됨). 런타임 값 import(`isCompositorForCompositing`)는 `revisionWorkflow.ts`가 `src/` 내부라 Vite 빌드에서는 정상이나, **테스트에서 `canReassignRevision`이 `isCompositorForCompositing`를 실제 호출**하므로 `node --test`가 `@/utils/compositingLabels`를 해석해야 한다. → Task 7 구현 시 `revisionWorkflow.ts`의 해당 import를 **상대경로** `'./compositingLabels'`로 작성(같은 `src/utils/` 폴더)해 `node --test` 호환을 보장.
