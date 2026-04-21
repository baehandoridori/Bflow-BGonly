# 다중 선택 일괄 작업 UX 재설계 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 일괄 삭제·단계 토글·필드 편집에서 "깜빡임·부분 실패 모호·저장 확신 부족"을 구조적으로 제거하고, Supabase Pro 플랜의 RPC를 활용해 N번 HTTP 왕복을 1번으로 줄인다.

**Architecture:** Hybrid Server-Authoritative — 단일 클릭은 기존 낙관적 경로 유지, 다중 선택(2개+) 일괄 작업은 PostgreSQL RPC 함수 3종으로 단일 왕복 수행하고 서버 확정(IPC 응답 + Realtime 에코) 후에만 UI 반영. pending 상태 스토어(`useBulkOperationsStore`)가 idempotent 확정을 단일 source of truth로 유지한다. 피어 알림을 위한 기존 custom Broadcast 호출(`broadcastSceneUpdate`/`broadcastSceneFieldUpdate`)은 IPC 핸들러 단에서 RPC 성공 결과를 기반으로 보존한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Zustand 4, Tailwind CSS 3, Supabase JS v2, PostgreSQL plpgsql, sonner. 테스트 프레임워크가 프로젝트에 없으므로 **pure-logic 유닛(useBulkOperationsStore)은 간이 Node 스크립트로 검증**, 나머지는 `npx tsc --noEmit` + `npm run build:vite` + 수동 스모크.

**Spec 참조:** [`docs/superpowers/specs/2026-04-22-bulk-operations-ux-design.md`](../specs/2026-04-22-bulk-operations-ux-design.md)

**검증 공통 명령** (Task 끝마다 반복):
```bash
npx tsc --noEmit          # 타입 체크
npm run build:vite        # 렌더러 번들
npm run electron:dev      # 수동 스모크 (일부 Task)
```

**커밋 컨벤션:** 한글, prefix `feat:`/`fix:`/`refactor:`/`chore:` + 간결 본문.

**선결 조건:**
- Supabase 프로젝트가 **활성 상태**(paused 아님). 일시 정지된 경우 대시보드에서 Restore 후 진행.
- `pnpm install` 또는 `npm install` 완료.

---

## 파일 구조 맵

| 파일 | 역할 |
|------|------|
| `DEVLOG/supabase-init.sql` | RPC 3종 CREATE + GRANT |
| `electron/supabase.ts` | RPC 래퍼 함수 (Promise.allSettled 제거) |
| `electron/main.ts` | IPC 핸들러 3개 (신규 2 + 반환 타입 변경 1) + broadcast 보존 |
| `electron/preload.ts` | 새 IPC 메서드 노출 |
| `src/services/supabaseService.ts` | 타입 export (`BulkUpdateResult` 등) + preload 바인딩, `bulkUpdateCells` 제거 |
| `src/stores/useBulkOperationsStore.ts` | **신규** 싱글톤 pending 스토어 |
| `src/stores/useDataStore.ts` | `removeSceneByUuid` 액션 추가 |
| `src/App.tsx` | Realtime 핸들러 분기 (UPDATE markConfirmed, DELETE fast path) |
| `src/views/ScenesView.tsx` | 일괄 경로 4곳 교체, 하단 바 비활성 로직 |
| `src/views/ScenesView.utils.ts` (또는 적절 위치) | `runBulkOp`, `resolveSelectedUuids` 헬퍼 |
| `src/components/scenes/UnifiedSceneCard.tsx` | pending 클래스 분기 |
| `src/components/scenes/BulkOperationStatus.tsx` | **신규** floating 상태 카드 |
| `src/components/common/ConfirmDialog.tsx` | **신규** Promise 기반 확인 모달 |
| `src/index.css` | pending/pulse/failed 애니메이션 |
| `CLAUDE.md` | keep-alive 줄 제거 |
| `DEVLOG/supabase-migration-plan.md` | keep-alive 주석 정리 |

---

## 의존 관계

```
Chunk 1 (DB RPC + Electron 백엔드)
  └─> Chunk 2 (렌더러 스토어)
        └─> Chunk 3 (UI 컴포넌트 + 시각)
              └─> Chunk 4 (ScenesView 오케스트레이션)
                    └─> Chunk 5 (Realtime 통합)
                          └─> Chunk 6 (문서 + 검증)
```

---

## Chunk 1: 백엔드 — DB RPC + Electron IPC

### Task 1: SQL RPC 함수 3종 작성 및 배포

**Files:**
- Modify: `DEVLOG/supabase-init.sql` — 파일 끝에 블록 추가

**배경:** Spec §5.1.0 참조. 3개 함수 + 3개 GRANT EXECUTE. IF NOT EXISTS / CREATE OR REPLACE 패턴 준수.

- [ ] **Step 1: `DEVLOG/supabase-init.sql`의 "RLS 정책" 블록 뒤에 다음 SQL 블록 추가**

```sql
-- ============================================================
-- 다중 선택 일괄 작업 RPC (2026-04-22, spec 2026-04-22-bulk-operations-ux-design.md)
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_update_scene_stages(
  p_updates jsonb,
  p_updated_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  v_uuid uuid;
  v_stage text;
  v_value boolean;
  v_completed_by text;
  v_completed_at timestamptz;
  v_meta_value text;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_uuid := (u->>'sceneUuid')::uuid;
    v_stage := u->>'stage';
    v_value := (u->>'value')::boolean;
    v_completed_by := u->>'completedBy';
    v_completed_at := NULLIF(u->>'completedAt', '')::timestamptz;

    BEGIN
      IF v_stage NOT IN ('lo','done','review','png') THEN
        RAISE EXCEPTION 'invalid stage: %', v_stage;
      END IF;

      UPDATE scenes SET
        lo     = CASE WHEN v_stage = 'lo'     THEN v_value ELSE lo END,
        done   = CASE WHEN v_stage = 'done'   THEN v_value ELSE done END,
        review = CASE WHEN v_stage = 'review' THEN v_value ELSE review END,
        png    = CASE WHEN v_stage = 'png'    THEN v_value ELSE png END,
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      IF v_completed_by IS NOT NULL AND v_completed_at IS NOT NULL THEN
        v_meta_value := jsonb_build_object(
          'completedBy', v_completed_by,
          'completedAt', v_completed_at
        )::text;
        INSERT INTO metadata (type, key, value, updated_at)
          VALUES ('scene-completion', v_uuid::text, v_meta_value, now())
          ON CONFLICT (type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bulk_delete_scenes(
  p_uuids uuid[],
  p_deleted_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  FOREACH v_uuid IN ARRAY p_uuids LOOP
    BEGIN
      DELETE FROM scenes WHERE id = v_uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;
      DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bulk_update_scene_fields(
  p_updates jsonb,
  p_updated_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  f jsonb;
  v_uuid uuid;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_uuid := (u->>'sceneUuid')::uuid;
    f := u->'fields';

    BEGIN
      UPDATE scenes SET
        assignee       = COALESCE(f->>'assignee', assignee),
        memo           = COALESCE(f->>'memo', memo),
        layout         = COALESCE(f->>'layout', layout),
        storyboard_url = COALESCE(f->>'storyboardUrl', storyboard_url),
        guide_url      = COALESCE(f->>'guideUrl', guide_url),
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_scene_stages(jsonb, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_delete_scenes(uuid[], text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_update_scene_fields(jsonb, text)  TO anon, authenticated;
```

- [ ] **Step 2: Supabase 대시보드에서 수동 실행 (사용자 협조 필요)**

사용자에게 안내:
> "DEVLOG/supabase-init.sql의 '다중 선택 일괄 작업 RPC' 블록(L<시작>–L<끝>)을 복사해 Supabase 대시보드 → SQL Editor에 붙여넣고 Run 해주세요."

- [ ] **Step 3: 함수 존재·권한 확인 (Supabase SQL Editor에서 실행)**

```sql
SELECT proname, proargtypes::regtype[] FROM pg_proc WHERE proname LIKE 'bulk_%';
-- 기대: 3 rows

SELECT has_function_privilege('anon', 'bulk_update_scene_stages(jsonb, text)', 'EXECUTE');
-- 기대: t
```

- [ ] **Step 4: 더미 호출로 동작 검증**

```sql
-- 임의 씬 1개 찾기
SELECT id FROM scenes LIMIT 1 \gset

-- LO 토글 → 다시 토글 (1회 sanity check)
SELECT * FROM bulk_update_scene_stages(
  jsonb_build_array(
    jsonb_build_object('sceneUuid', :'id', 'stage', 'lo', 'value', true)
  ),
  'test_user'
);
-- 기대: 1 row, success=true, error=null

SELECT * FROM bulk_update_scene_stages(
  jsonb_build_array(
    jsonb_build_object('sceneUuid', :'id', 'stage', 'lo', 'value', false)
  ),
  'test_user'
);
```

- [ ] **Step 5: 에러 케이스 검증 (없는 UUID)**

```sql
SELECT * FROM bulk_update_scene_stages(
  jsonb_build_array(
    jsonb_build_object('sceneUuid', '00000000-0000-0000-0000-000000000000', 'stage', 'lo', 'value', true)
  ),
  'test_user'
);
-- 기대: 1 row, success=false, error='scene not found: ...'
```

- [ ] **Step 6: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): 일괄 작업 RPC 함수 3종 추가 (stages/delete/fields)"
```

---

### Task 2: `electron/supabase.ts` — RPC 호출로 전환

**Files:**
- Modify: `electron/supabase.ts:479-497` (`bulkUpdateSceneStages` 본문 교체)
- Modify: `electron/supabase.ts` (신규 `bulkDeleteScenes`, `bulkUpdateSceneFields` 추가)

**배경:** Spec §5.1. 기존 `Promise.allSettled` + N번 개별 호출을 단일 `supabase.rpc()` 호출로 교체.

- [ ] **Step 1: 파일 상단 공용 타입 정의 블록 추가** (기존 import 구문 바로 아래)

```typescript
export type BulkStageUpdate = {
  sceneUuid: string;
  stage: 'lo' | 'done' | 'review' | 'png';
  value: boolean;
  completedBy?: string;
  completedAt?: string;
};

export type BulkFieldUpdate = {
  sceneUuid: string;
  fields: {
    assignee?: string;
    memo?: string;
    layoutId?: string;
    storyboardUrl?: string;
    guideUrl?: string;
  };
};

export type BulkUpdateResult = {
  sceneUuid: string;
  success: boolean;
  error?: string;
};

type RpcRow = { scene_uuid: string; success: boolean; error: string | null };

function mapRpcRows(rows: RpcRow[] | null): BulkUpdateResult[] {
  return (rows ?? []).map((row) => ({
    sceneUuid: row.scene_uuid,
    success: row.success,
    error: row.error ?? undefined,
  }));
}
```

- [ ] **Step 2: 기존 `bulkUpdateSceneStages` 교체** (L479-497)

```typescript
export async function bulkUpdateSceneStages(
  updates: BulkStageUpdate[],
  updatedBy: string,
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_update_scene_stages', {
    p_updates: updates.map((u) => ({
      sceneUuid: u.sceneUuid,
      stage: u.stage,
      value: u.value,
      completedBy: u.completedBy ?? null,
      completedAt: u.completedAt ?? null,
    })),
    p_updated_by: updatedBy,
  });
  if (error) throw error;
  return mapRpcRows(data as RpcRow[] | null);
}
```

- [ ] **Step 3: 신규 `bulkDeleteScenes` 추가** (기존 `deleteScene` 함수 바로 뒤)

```typescript
export async function bulkDeleteScenes(
  sceneUuids: string[],
  deletedBy: string,
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_delete_scenes', {
    p_uuids: sceneUuids,
    p_deleted_by: deletedBy,
  });
  if (error) throw error;
  return mapRpcRows(data as RpcRow[] | null);
}
```

- [ ] **Step 4: 신규 `bulkUpdateSceneFields` 추가**

```typescript
export async function bulkUpdateSceneFields(
  updates: BulkFieldUpdate[],
  updatedBy: string,
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_update_scene_fields', {
    p_updates: updates.map((u) => ({
      sceneUuid: u.sceneUuid,
      fields: {
        assignee: u.fields.assignee,
        memo: u.fields.memo,
        layout: u.fields.layoutId,
        storyboardUrl: u.fields.storyboardUrl,
        guideUrl: u.fields.guideUrl,
      },
    })),
    p_updated_by: updatedBy,
  });
  if (error) throw error;
  return mapRpcRows(data as RpcRow[] | null);
}
```

- [ ] **Step 5: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add electron/supabase.ts
git commit -m "feat(electron): bulkUpdateSceneStages를 RPC 호출로 전환 + bulkDelete/Fields 추가"
```

---

### Task 3: `electron/main.ts` — IPC 핸들러 + broadcast 보존

**Files:**
- Modify: `electron/main.ts` 기존 `supabase:bulk-update-scene-stages` 핸들러 (반환 타입 변경)
- Modify: `electron/main.ts` — 신규 IPC 핸들러 2개 추가

**배경:** Spec §5.1.0 "커스텀 Broadcast 보존" + §5.2 IPC 매핑. RPC 성공 항목별로 `broadcastSceneUpdate`/`broadcastSceneFieldUpdate` 호출해 피어 알림 경로 보존.

- [ ] **Step 1: 기존 `supabase:bulk-update-scene-stages` 핸들러 교체**

```typescript
ipcMain.handle('supabase:bulk-update-scene-stages', wrapIpc(async (_e, updates: BulkStageUpdate[], updatedBy: string) => {
  const results = await sbBulkUpdateSceneStages(updates, updatedBy);
  for (const u of updates) {
    const r = results.find((x) => x.sceneUuid === u.sceneUuid);
    if (r?.success) {
      broadcastSceneUpdate(u.sceneUuid, u.stage, u.value, updatedBy);
    }
  }
  return results;
}));
```

import 추가 확인: `sbBulkUpdateSceneStages`는 `./supabase`에서, `broadcastSceneUpdate`는 `./broadcast`에서 이미 import되어 있는지 확인. 없으면 import 구문에 추가.

- [ ] **Step 2: 신규 `supabase:bulk-delete-scenes` 핸들러 추가**

```typescript
ipcMain.handle('supabase:bulk-delete-scenes', wrapIpc(async (_e, sceneUuids: string[], deletedBy: string) => {
  const results = await sbBulkDeleteScenes(sceneUuids, deletedBy);
  // 기존 deleteScene에는 broadcast 호출이 없음 — 패리티 유지 목적이면 여기도 broadcast 생략.
  return results;
}));
```

- [ ] **Step 3: 신규 `supabase:bulk-update-scene-fields` 핸들러 추가**

```typescript
ipcMain.handle('supabase:bulk-update-scene-fields', wrapIpc(async (_e, updates: BulkFieldUpdate[], updatedBy: string) => {
  const results = await sbBulkUpdateSceneFields(updates, updatedBy);
  for (const u of updates) {
    const r = results.find((x) => x.sceneUuid === u.sceneUuid);
    if (!r?.success) continue;
    // 기존 updateSceneField는 필드마다 broadcastSceneFieldUpdate 1회 호출.
    // 여기서도 필드별 전파.
    for (const [key, value] of Object.entries(u.fields)) {
      if (value !== undefined) {
        broadcastSceneFieldUpdate(u.sceneUuid, key, value, updatedBy);
      }
    }
  }
  return results;
}));
```

- [ ] **Step 4: import 구문에 신규 심볼 확실히 포함**

파일 상단에서 다음이 모두 import되어 있어야 함:
```typescript
import {
  bulkUpdateSceneStages as sbBulkUpdateSceneStages,
  bulkDeleteScenes as sbBulkDeleteScenes,
  bulkUpdateSceneFields as sbBulkUpdateSceneFields,
  type BulkStageUpdate,
  type BulkFieldUpdate,
} from './supabase';
import {
  broadcastSceneUpdate,
  broadcastSceneFieldUpdate,
} from './broadcast';
```

- [ ] **Step 5: 타입 체크 + 실행**

```bash
npx tsc --noEmit
npm run build:vite
```
Expected: 성공.

- [ ] **Step 6: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 일괄 작업 IPC 핸들러 3종 + broadcast 보존"
```

---

### Task 4: `electron/preload.ts` — IPC 메서드 노출

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: 기존 `supabaseBulkUpdateSceneStages` 반환 타입 확인**

기존 선언이 `Promise<void>`라면 `Promise<BulkUpdateResult[]>`로 변경. 보통 `contextBridge.exposeInMainWorld` 블록 안 또는 타입 파일(`types/electron.d.ts` 등)에 있음.

- [ ] **Step 2: 신규 2개 메서드 노출**

```typescript
// preload exposure 객체 내부
supabaseBulkUpdateSceneStages: (updates, updatedBy) =>
  ipcRenderer.invoke('supabase:bulk-update-scene-stages', updates, updatedBy),
supabaseBulkDeleteScenes: (sceneUuids, deletedBy) =>
  ipcRenderer.invoke('supabase:bulk-delete-scenes', sceneUuids, deletedBy),
supabaseBulkUpdateSceneFields: (updates, updatedBy) =>
  ipcRenderer.invoke('supabase:bulk-update-scene-fields', updates, updatedBy),
```

- [ ] **Step 3: `window.electronAPI` TypeScript 타입 선언 업데이트**

`src/types` 또는 `electron/` 내 d.ts 파일에서 `ElectronAPI` 인터페이스에 3개 메서드 타입 추가:

```typescript
supabaseBulkUpdateSceneStages(updates: BulkStageUpdate[], updatedBy: string): Promise<BulkUpdateResult[]>;
supabaseBulkDeleteScenes(sceneUuids: string[], deletedBy: string): Promise<BulkUpdateResult[]>;
supabaseBulkUpdateSceneFields(updates: BulkFieldUpdate[], updatedBy: string): Promise<BulkUpdateResult[]>;
```

(import 가능한 위치에 `BulkStageUpdate` 등 타입이 있어야 하므로 필요 시 `../electron/supabase` 경로에서 import 또는 types 파일로 중복 선언)

- [ ] **Step 4: 타입 체크**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add electron/preload.ts <타입 파일>
git commit -m "feat(preload): 일괄 작업 IPC 메서드 3종 노출"
```

---

## Chunk 2: 렌더러 스토어

### Task 5: `useBulkOperationsStore` 타입 설계 + TDD 테스트 작성

**Files:**
- Create: `src/stores/useBulkOperationsStore.ts`
- Create: `src/stores/useBulkOperationsStore.test.mjs` (간이 Node 스크립트)

**배경:** Spec §5.3 idempotency 계약. 프로젝트에 Jest/Vitest가 없으므로 Node assert로 간단 검증.

- [ ] **Step 1: 타입 선언만 먼저 작성 (구현은 빈 껍데기)**

```typescript
// src/stores/useBulkOperationsStore.ts
import { create } from 'zustand';

export type OpKind = 'delete' | 'stage-toggle' | 'field-edit';
export type OpStatus = 'in-flight' | 'complete' | 'partial-fail' | 'network-error' | 'cancelled';

export type PendingOp = {
  id: string;
  kind: OpKind;
  totalCount: number;
  completedCount: number;
  failedItems: Array<{ sceneUuid: string; error: string }>;
  pendingSceneUuids: Set<string>;
  startedAt: number;
  status: OpStatus;
  targetStage?: 'lo' | 'done' | 'review' | 'png';
};

interface BulkOperationsStore {
  activeOp: PendingOp | null;
  startOp(init: Omit<PendingOp, 'completedCount' | 'failedItems' | 'startedAt' | 'status'>): void;
  markConfirmed(sceneUuid: string): void;
  markFailed(sceneUuid: string, error: string): void;
  setStatus(status: OpStatus): void;
  retryFailed(retryFn: (uuids: string[]) => Promise<import('../../electron/supabase').BulkUpdateResult[]>): Promise<void>;
  cancel(): void;
  clear(): void;
}

export const useBulkOperationsStore = create<BulkOperationsStore>(() => ({
  activeOp: null,
  startOp: () => { throw new Error('not implemented'); },
  markConfirmed: () => { throw new Error('not implemented'); },
  markFailed: () => { throw new Error('not implemented'); },
  setStatus: () => { throw new Error('not implemented'); },
  retryFailed: async () => { throw new Error('not implemented'); },
  cancel: () => { throw new Error('not implemented'); },
  clear: () => { throw new Error('not implemented'); },
}));
```

- [ ] **Step 2: 테스트 시나리오 정의 (주석 형태로 파일 상단)**

`src/stores/useBulkOperationsStore.test.mjs`:

```javascript
// Run: node src/stores/useBulkOperationsStore.test.mjs
// (빌드 후 dist/ 기반 실행을 가정하지 않고, 순수 ts-node 호환 아님 → 별도 스펙)
// 실제로는 이 테스트는 ts-node나 vitest 없이는 바로 못 돌리므로,
// TS 포터블 검증은 스토어 구현 후 src/stores/__spec__/ 경로에 두고
// 개발자가 tsx 또는 tsc로 컴파일 후 실행한다.

// 케이스 1: startOp 후 markConfirmed N번 → status='complete'
// 케이스 2: markConfirmed 중복 호출 → no-op, completedCount 변화 없음
// 케이스 3: markFailed 중복 호출 → 1번만 반영
// 케이스 4: activeOp === null 상태에서 markConfirmed 호출 → no-op, 예외 없음
// 케이스 5: 일부 성공 일부 실패 → status='partial-fail'
// 케이스 6: setStatus('network-error') → 즉시 전이
// 케이스 7: cancel() → activeOp.status='cancelled', pendingSceneUuids 비움
// 케이스 8: clear() → activeOp === null
```

- [ ] **Step 3: tsx(또는 ts-node)로 실행 가능한 ts 테스트 작성**

`src/stores/useBulkOperationsStore.spec.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { useBulkOperationsStore } from './useBulkOperationsStore';

function reset() { useBulkOperationsStore.setState({ activeOp: null }); }

// 1. startOp + markConfirmed 전체 성공
(() => {
  reset();
  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: 'op-1', kind: 'stage-toggle', totalCount: 3,
    pendingSceneUuids: new Set(['a', 'b', 'c']), targetStage: 'lo',
  });
  store.markConfirmed('a');
  store.markConfirmed('b');
  store.markConfirmed('c');
  const op = useBulkOperationsStore.getState().activeOp!;
  assert.equal(op.completedCount, 3);
  assert.equal(op.failedItems.length, 0);
  assert.equal(op.status, 'complete');
  console.log('✅ case 1 passed');
})();

// 2. markConfirmed 중복 호출 no-op
(() => {
  reset();
  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: 'op-2', kind: 'delete', totalCount: 2,
    pendingSceneUuids: new Set(['x', 'y']),
  });
  store.markConfirmed('x');
  store.markConfirmed('x'); // 중복
  const op = useBulkOperationsStore.getState().activeOp!;
  assert.equal(op.completedCount, 1);
  console.log('✅ case 2 passed');
})();

// 3. activeOp === null 상태에서 markConfirmed 호출 no-op
(() => {
  reset();
  useBulkOperationsStore.getState().markConfirmed('nonexistent');
  useBulkOperationsStore.getState().markFailed('nonexistent', 'err');
  assert.equal(useBulkOperationsStore.getState().activeOp, null);
  console.log('✅ case 3 passed');
})();

// 4. 부분 실패 → partial-fail
(() => {
  reset();
  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: 'op-3', kind: 'stage-toggle', totalCount: 2,
    pendingSceneUuids: new Set(['p', 'q']), targetStage: 'done',
  });
  store.markConfirmed('p');
  store.markFailed('q', 'network error');
  const op = useBulkOperationsStore.getState().activeOp!;
  assert.equal(op.completedCount, 1);
  assert.equal(op.failedItems.length, 1);
  assert.equal(op.status, 'partial-fail');
  console.log('✅ case 4 passed');
})();

// 5. cancel()
(() => {
  reset();
  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: 'op-4', kind: 'delete', totalCount: 5,
    pendingSceneUuids: new Set(['1','2','3','4','5']),
  });
  store.cancel();
  const op = useBulkOperationsStore.getState().activeOp!;
  assert.equal(op.status, 'cancelled');
  console.log('✅ case 5 passed');
})();

console.log('\n🎉 All bulk-ops store cases passed');
```

- [ ] **Step 4: tsx 실행 (tsx가 devDep에 있는지 확인, 없으면 `npm i -D tsx`)**

```bash
npx tsx src/stores/useBulkOperationsStore.spec.ts
```
Expected: 현재 단계에선 "not implemented" 에러로 **모든 케이스 실패** (TDD 의도).

- [ ] **Step 5: 커밋 (실패 테스트 먼저 기록)**

```bash
git add src/stores/useBulkOperationsStore.ts src/stores/useBulkOperationsStore.spec.ts
git commit -m "test(bulk-ops): useBulkOperationsStore 스펙 시나리오 추가 (실패 상태)"
```

---

### Task 6: `useBulkOperationsStore` 구현 — idempotency 포함

**Files:**
- Modify: `src/stores/useBulkOperationsStore.ts`

- [ ] **Step 1: 구현 코드로 교체**

```typescript
import { create } from 'zustand';
import type { BulkUpdateResult } from '../../electron/supabase';

export type OpKind = 'delete' | 'stage-toggle' | 'field-edit';
export type OpStatus = 'in-flight' | 'complete' | 'partial-fail' | 'network-error' | 'cancelled';

export type PendingOp = {
  id: string;
  kind: OpKind;
  totalCount: number;
  completedCount: number;
  failedItems: Array<{ sceneUuid: string; error: string }>;
  pendingSceneUuids: Set<string>;
  startedAt: number;
  status: OpStatus;
  targetStage?: 'lo' | 'done' | 'review' | 'png';
};

interface BulkOperationsStore {
  activeOp: PendingOp | null;
  startOp(init: Omit<PendingOp, 'completedCount' | 'failedItems' | 'startedAt' | 'status'>): void;
  markConfirmed(sceneUuid: string): void;
  markFailed(sceneUuid: string, error: string): void;
  setStatus(status: OpStatus): void;
  retryFailed(retryFn: (uuids: string[]) => Promise<BulkUpdateResult[]>): Promise<void>;
  cancel(): void;
  clear(): void;
}

function deriveTerminalStatus(op: PendingOp): OpStatus {
  if (op.completedCount + op.failedItems.length === op.totalCount) {
    return op.failedItems.length === 0 ? 'complete' : 'partial-fail';
  }
  return op.status;
}

export const useBulkOperationsStore = create<BulkOperationsStore>((set, get) => ({
  activeOp: null,

  startOp: (init) => {
    set({
      activeOp: {
        ...init,
        completedCount: 0,
        failedItems: [],
        startedAt: Date.now(),
        status: 'in-flight',
        pendingSceneUuids: new Set(init.pendingSceneUuids),
      },
    });
  },

  markConfirmed: (sceneUuid) => {
    const op = get().activeOp;
    if (!op) return;
    if (!op.pendingSceneUuids.has(sceneUuid)) return; // idempotent no-op
    const next: PendingOp = {
      ...op,
      pendingSceneUuids: new Set(
        Array.from(op.pendingSceneUuids).filter((id) => id !== sceneUuid),
      ),
      completedCount: op.completedCount + 1,
    };
    next.status = deriveTerminalStatus(next);
    set({ activeOp: next });
  },

  markFailed: (sceneUuid, error) => {
    const op = get().activeOp;
    if (!op) return;
    if (!op.pendingSceneUuids.has(sceneUuid)) return;
    if (op.failedItems.some((f) => f.sceneUuid === sceneUuid)) return;
    const next: PendingOp = {
      ...op,
      pendingSceneUuids: new Set(
        Array.from(op.pendingSceneUuids).filter((id) => id !== sceneUuid),
      ),
      failedItems: [...op.failedItems, { sceneUuid, error }],
    };
    next.status = deriveTerminalStatus(next);
    set({ activeOp: next });
  },

  setStatus: (status) => {
    const op = get().activeOp;
    if (!op) return;
    set({ activeOp: { ...op, status } });
  },

  retryFailed: async (retryFn) => {
    const op = get().activeOp;
    if (!op || op.failedItems.length === 0) return;
    const toRetry = op.failedItems.map((f) => f.sceneUuid);
    // 실패 항목을 다시 pending으로 옮김
    set({
      activeOp: {
        ...op,
        status: 'in-flight',
        pendingSceneUuids: new Set([...op.pendingSceneUuids, ...toRetry]),
        failedItems: [],
      },
    });
    try {
      const results = await retryFn(toRetry);
      for (const r of results) {
        if (r.success) get().markConfirmed(r.sceneUuid);
        else get().markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
    } catch (e) {
      get().setStatus('network-error');
    }
  },

  cancel: () => {
    const op = get().activeOp;
    if (!op) return;
    set({
      activeOp: {
        ...op,
        status: 'cancelled',
        pendingSceneUuids: new Set(),
      },
    });
  },

  clear: () => set({ activeOp: null }),
}));
```

- [ ] **Step 2: 스펙 재실행**

```bash
npx tsx src/stores/useBulkOperationsStore.spec.ts
```
Expected: 모든 케이스 ✅ 통과.

- [ ] **Step 3: tsc 체크**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/stores/useBulkOperationsStore.ts
git commit -m "feat(store): useBulkOperationsStore 구현 (idempotent markConfirmed/Failed)"
```

---

### Task 7: `useDataStore.removeSceneByUuid` 액션 추가

**Files:**
- Modify: `src/stores/useDataStore.ts`

**배경:** Spec §5.5. Realtime DELETE fast path 및 일괄 삭제 IPC 성공 시 로컬 데이터 제거용.

- [ ] **Step 1: 스토어 인터페이스에 액션 선언 추가**

기존 `updateSceneByUuid` 선언 근처(라인 261 부근).

```typescript
removeSceneByUuid(uuid: string): boolean;  // true if removed, false if not found
```

- [ ] **Step 2: 구현 추가** (기존 `updateSceneByUuid` 구현 바로 뒤)

```typescript
removeSceneByUuid: (uuid) => {
  let found = false;
  set((state) => {
    const newScenesBySheet: typeof state.scenesBySheet = {};
    for (const [sheetName, scenes] of Object.entries(state.scenesBySheet)) {
      const filtered = scenes.filter((s) => {
        if (s.uuid === uuid) {
          found = true;
          return false;
        }
        return true;
      });
      newScenesBySheet[sheetName] = filtered;
    }
    return { scenesBySheet: newScenesBySheet };
  });
  return found;
},
```

주의: 실제 스토어 구조(`scenesBySheet`, `sheets`, 또는 정규화된 형태)에 맞춰 조정. 기존 `deleteSceneOptimistic`의 구현 패턴을 참고 — index 계산이 있다면 uuid 매칭으로 바꾸면 됨.

- [ ] **Step 3: tsc + 단순 호출 검증 (옵션: 앱 실행 후 devtools 콘솔에서)**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/stores/useDataStore.ts
git commit -m "feat(store): useDataStore에 removeSceneByUuid 액션 추가"
```

---

### Task 8: `supabaseService.ts` — 타입 재노출 + `bulkUpdateCells` 제거

**Files:**
- Modify: `src/services/supabaseService.ts:190-199` (`bulkUpdateCells` 제거)
- Modify: `src/services/supabaseService.ts` — 신규 래퍼 함수 바인딩

- [ ] **Step 1: 기존 `bulkUpdateCells` 함수 삭제**

`src/services/supabaseService.ts:190-199`의 `export async function bulkUpdateCells(...)` 블록 통째로 제거.

- [ ] **Step 2: 신규 3종 래퍼 추가**

```typescript
export type { BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult } from '../../electron/supabase';

export async function bulkUpdateSceneStages(
  updates: import('../../electron/supabase').BulkStageUpdate[],
  updatedBy: string,
) {
  return window.electronAPI.supabaseBulkUpdateSceneStages(updates, updatedBy);
}

export async function bulkDeleteScenes(sceneUuids: string[], deletedBy: string) {
  return window.electronAPI.supabaseBulkDeleteScenes(sceneUuids, deletedBy);
}

export async function bulkUpdateSceneFields(
  updates: import('../../electron/supabase').BulkFieldUpdate[],
  updatedBy: string,
) {
  return window.electronAPI.supabaseBulkUpdateSceneFields(updates, updatedBy);
}
```

- [ ] **Step 3: `bulkUpdateCells` 참조 grep — 0이어야 함**

```bash
grep -rn "bulkUpdateCells" src/ electron/ || echo "✅ no references"
```

참조가 남아 있으면 ScenesView.tsx에서 호출 중일 가능성 — Chunk 3에서 교체될 예정이므로 임시로 주석 처리하지 말고 일단 넘어가고, Chunk 3 끝나면 재확인.

- [ ] **Step 4: tsc**

```bash
npx tsc --noEmit
```
Expected: **일시적으로 에러 가능** (ScenesView가 bulkUpdateCells를 import 중). Chunk 3에서 해소됨.

- [ ] **Step 5: 커밋 (tsc 일시 실패 감수)**

```bash
git add src/services/supabaseService.ts
git commit -m "refactor(service): bulkUpdateCells 제거, RPC 기반 3종 래퍼 도입"
```

(주의: tsc 실패 상태로 중간 커밋. Chunk 3 완료 후 빌드 통과 확인.)

---

## Chunk 3: UI 컴포넌트 + 시각 상태

### Task 9: `ConfirmDialog` 컴포넌트 신설

**Files:**
- Create: `src/components/common/ConfirmDialog.tsx`

**배경:** Spec §5.8. `window.confirm` 교체. Promise 기반 API.

- [ ] **Step 1: 컴포넌트 구현**

```tsx
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

type InternalState = ConfirmOptions & { resolve: (ok: boolean) => void };

let externalShow: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function ConfirmDialogHost() {
  const [state, setState] = useState<InternalState | null>(null);

  useEffect(() => {
    externalShow = (opts) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve });
      });
    return () => { externalShow = null; };
  }, []);

  if (!state) return null;

  const handle = (ok: boolean) => {
    state.resolve(ok);
    setState(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => handle(false)}>
      <div
        role="dialog"
        className="bg-[#1A1D27] border border-[#2D3041] rounded-lg p-6 min-w-[320px] max-w-[480px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[#E8E8EE] text-sm mb-5 whitespace-pre-line">{state.message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded text-sm text-[#8B8DA3] hover:bg-[#2D3041]"
            onClick={() => handle(false)}
            autoFocus
          >
            {state.cancelLabel ?? '취소'}
          </button>
          <button
            className={`px-4 py-2 rounded text-sm font-medium ${
              state.tone === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-[#6C5CE7] hover:bg-[#7D6FFF] text-white'
            }`}
            onClick={() => handle(true)}
          >
            {state.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const ConfirmDialog = {
  show(opts: ConfirmOptions): Promise<boolean> {
    if (!externalShow) {
      console.warn('[ConfirmDialog] Host not mounted, falling back to window.confirm');
      return Promise.resolve(window.confirm(opts.message));
    }
    return externalShow(opts);
  },
};
```

- [ ] **Step 2: `App.tsx`에서 `ConfirmDialogHost` 마운트**

`App.tsx` 최상위 JSX에 한 번만:

```tsx
import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';
// ...
<ConfirmDialogHost />
```

(기존 `<Toaster />` 옆에 배치)

- [ ] **Step 3: tsc + 수동 스모크**

```bash
npx tsc --noEmit
npm run electron:dev
```
콘솔에서 `ConfirmDialog.show({ message: 'test' })` 호출 → 모달 뜨는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/common/ConfirmDialog.tsx src/App.tsx
git commit -m "feat(ui): Promise 기반 ConfirmDialog 컴포넌트 추가"
```

---

### Task 10: CSS 애니메이션 추가 (pending / pulse / failed)

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: 파일 끝에 블록 추가**

```css
@layer components {
  @keyframes bflow-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.32; }
  }

  .bflow-pending-cell,
  .bflow-pending-card {
    animation: bflow-pulse 1.2s ease-in-out infinite;
    pointer-events: none;
  }

  .bflow-pending-failed {
    opacity: 0.7;
    outline: 1.5px solid rgb(239, 68, 68);
    outline-offset: -1px;
    position: relative;
    animation: none;
  }

  .bflow-pending-failed::after {
    content: '!';
    position: absolute;
    top: 2px;
    right: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgb(239, 68, 68);
    color: white;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
```

- [ ] **Step 2: 빌드 검증**

```bash
npm run build:vite
```

- [ ] **Step 3: 커밋**

```bash
git add src/index.css
git commit -m "feat(css): 일괄 작업 pending/pulse/failed 시각 상태 추가"
```

---

### Task 11: `UnifiedSceneCard` pending 클래스 분기 적용

**Files:**
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`

**배경:** Spec §5.6. kind별로 카드 전체 or stage 셀만 pending 처리.

- [ ] **Step 1: 컴포넌트 상단에서 `useBulkOperationsStore` 구독**

```tsx
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';

// 함수형 컴포넌트 상단
const activeOp = useBulkOperationsStore((s) => s.activeOp);
```

- [ ] **Step 2: 각 scene uuid별 pending/failed 상태 계산 헬퍼**

```tsx
function getPendingState(op: PendingOp | null, sceneUuid: string | undefined) {
  if (!op || !sceneUuid) return null;
  const failed = op.failedItems.find((f) => f.sceneUuid === sceneUuid);
  if (failed) return { kind: 'failed' as const, error: failed.error };
  if (op.pendingSceneUuids.has(sceneUuid)) return { kind: 'pending' as const };
  return null;
}
```

- [ ] **Step 3: 카드 래퍼 div 클래스에 반영**

```tsx
const bgPending = getPendingState(activeOp, scene.bgScene?.uuid);
const actPending = getPendingState(activeOp, scene.actScene?.uuid);

// kind === 'delete' 또는 'field-edit'면 카드 전체 대상
const wholeCardPending =
  (activeOp?.kind === 'delete' || activeOp?.kind === 'field-edit') &&
  (bgPending || actPending);

const cardClassName = [
  baseClassName,
  wholeCardPending?.kind === 'pending' ? 'bflow-pending-card' : '',
  wholeCardPending?.kind === 'failed' ? 'bflow-pending-failed' : '',
].filter(Boolean).join(' ');
```

- [ ] **Step 4: stage 셀 렌더링 부분에서 kind === 'stage-toggle' 분기**

stage 셀 렌더 JSX(LO/완료/검수/PNG 박스) 부근:

```tsx
const stageCellPending = (uuid: string, stage: Stage) => {
  if (activeOp?.kind !== 'stage-toggle') return '';
  if (activeOp.targetStage !== stage) return '';
  const state = getPendingState(activeOp, uuid);
  if (!state) return '';
  return state.kind === 'pending' ? 'bflow-pending-cell' : 'bflow-pending-failed';
};

// JSX에서:
<div className={`stage-cell ... ${stageCellPending(scene.bgScene!.uuid, 'lo')}`} title={
  activeOp?.kind === 'stage-toggle' && getPendingState(activeOp, scene.bgScene!.uuid)?.kind === 'failed'
    ? getPendingState(activeOp, scene.bgScene!.uuid)?.error
    : undefined
}>
  ...
</div>
```

(4개 stage 셀 모두 동일 패턴 적용. "all" 부서 모드에서 bg·act 각각 렌더되는 영역에 각각 적용 — `scene.actScene?.uuid` 사용)

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/scenes/UnifiedSceneCard.tsx
git commit -m "feat(ui): 씬 카드에 일괄 작업 pending/failed 시각 상태 적용"
```

---

### Task 12: `BulkOperationStatus` floating 상태 카드 컴포넌트

**Files:**
- Create: `src/components/scenes/BulkOperationStatus.tsx`

**배경:** Spec §5.7. in-flight/partial-fail/network-error/complete/cancelled 5개 상태 대응.

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useEffect, useState } from 'react';
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';

export function BulkOperationStatus() {
  const activeOp = useBulkOperationsStore((s) => s.activeOp);
  const clear = useBulkOperationsStore((s) => s.clear);
  const cancel = useBulkOperationsStore((s) => s.cancel);
  const retryFailed = useBulkOperationsStore((s) => s.retryFailed);
  const [expanded, setExpanded] = useState(false);
  const [slowHint, setSlowHint] = useState(false);

  // 5초 이상 in-flight면 slow hint
  useEffect(() => {
    if (activeOp?.status !== 'in-flight') { setSlowHint(false); return; }
    const t = setTimeout(() => setSlowHint(true), 5000);
    return () => clearTimeout(t);
  }, [activeOp?.status, activeOp?.id]);

  // 10초 초과 in-flight면 network-error로 자동 전이
  useEffect(() => {
    if (activeOp?.status !== 'in-flight') return;
    const t = setTimeout(() => {
      const fresh = useBulkOperationsStore.getState().activeOp;
      if (fresh?.status === 'in-flight') {
        useBulkOperationsStore.getState().setStatus('network-error');
      }
    }, 10_000);
    return () => clearTimeout(t);
  }, [activeOp?.id]);

  // complete 시 2초 후 자동 clear
  useEffect(() => {
    if (activeOp?.status !== 'complete') return;
    const t = setTimeout(() => clear(), 2000);
    return () => clearTimeout(t);
  }, [activeOp?.status]);

  // cancelled 시 즉시 clear
  useEffect(() => {
    if (activeOp?.status === 'cancelled') {
      const t = setTimeout(() => clear(), 600);
      return () => clearTimeout(t);
    }
  }, [activeOp?.status]);

  if (!activeOp) return null;

  const label = kindLabel(activeOp.kind, activeOp.targetStage);

  return (
    <div className="fixed bottom-[120px] left-1/2 -translate-x-1/2 z-[100] bg-[#1A1D27] border border-[#2D3041] rounded-lg px-4 py-3 shadow-xl min-w-[320px]">
      <div className="flex items-center gap-3">
        <StatusIcon status={activeOp.status} />
        <div className="flex-1">
          <div className="text-sm text-[#E8E8EE]">{renderTitle(activeOp, label)}</div>
          {slowHint && activeOp.status === 'in-flight' && (
            <div className="text-xs text-[#FDCB6E] mt-1">네트워크가 느려요</div>
          )}
        </div>
        <Actions activeOp={activeOp} onCancel={cancel} onRetry={async () => {
          // 재시도 함수는 외부에서 주입되어야 정확한 RPC 호출이 가능 —
          // 일단 간단히 최신 일괄 경로 재호출용 callback registry를 두거나,
          // ScenesView에서 activeOp.kind를 보고 호출하는 방식을 사용한다.
          // 현재는 사용자 안내 후 수동 복귀를 우선.
          window.dispatchEvent(new CustomEvent('bflow:bulk-retry'));
        }} onClose={clear} />
      </div>

      {activeOp.failedItems.length > 0 && (
        <div className="mt-2">
          <button className="text-xs text-[#6C5CE7] underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? '실패 목록 접기' : `실패 ${activeOp.failedItems.length}건 보기`}
          </button>
          {expanded && (
            <ul className="mt-1 text-xs text-[#8B8DA3] max-h-40 overflow-auto">
              {activeOp.failedItems.map((f) => (
                <li key={f.sceneUuid} className="py-0.5">{f.sceneUuid.slice(0, 8)}… — {f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const map: Record<string, { char: string; color: string }> = {
    'in-flight':     { char: '⏳', color: 'text-[#6C5CE7]' },
    'partial-fail':  { char: '!',  color: 'text-red-500' },
    'network-error': { char: '⚠',  color: 'text-[#FDCB6E]' },
    'complete':      { char: '✓',  color: 'text-[#00B894]' },
    'cancelled':     { char: '⏹',  color: 'text-[#8B8DA3]' },
  };
  const m = map[status] ?? map['in-flight'];
  return <span className={`text-lg font-bold ${m.color}`}>{m.char}</span>;
}

function kindLabel(kind: string, stage?: string) {
  if (kind === 'delete') return '삭제';
  if (kind === 'stage-toggle') return `${(stage ?? '').toUpperCase()}`;
  if (kind === 'field-edit') return '편집';
  return '';
}

function renderTitle(op: ReturnType<typeof useBulkOperationsStore.getState>['activeOp'], label: string) {
  if (!op) return '';
  const { status, completedCount, totalCount, failedItems } = op;
  const failedCount = failedItems.length;
  switch (status) {
    case 'in-flight': return `${label} ${completedCount}/${totalCount} 처리 중`;
    case 'complete': return `${totalCount}개 ${label} 완료`;
    case 'partial-fail': return `${completedCount}개 완료 · ${failedCount}개 실패`;
    case 'network-error': return `연결 끊김 — 다시 시도해주세요`;
    case 'cancelled': return `${label} 처리 중단됨`;
    default: return '';
  }
}

function Actions({ activeOp, onCancel, onRetry, onClose }: {
  activeOp: NonNullable<ReturnType<typeof useBulkOperationsStore.getState>['activeOp']>;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const btn = 'px-2 py-1 text-xs rounded hover:bg-[#2D3041] text-[#E8E8EE]';
  if (activeOp.status === 'in-flight') return (
    <button className={btn} onClick={onCancel} title="이미 전송된 작업은 서버에서 계속 처리됩니다">취소</button>
  );
  if (activeOp.status === 'partial-fail' || activeOp.status === 'network-error') return (
    <div className="flex gap-1">
      <button className={btn} onClick={onRetry}>다시 시도</button>
      <button className={btn} onClick={onClose}>닫기</button>
    </div>
  );
  return null;
}
```

- [ ] **Step 2: ScenesView에 마운트**

`ScenesView.tsx` JSX 최상위에 한 번:

```tsx
import { BulkOperationStatus } from '@/components/scenes/BulkOperationStatus';
// ...
<BulkOperationStatus />
```

- [ ] **Step 3: tsc + 수동 스모크**

```bash
npx tsc --noEmit
npm run electron:dev
```
devtools에서 `useBulkOperationsStore.getState().startOp({...})`를 수동 호출해 각 상태가 렌더되는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/BulkOperationStatus.tsx src/views/ScenesView.tsx
git commit -m "feat(ui): BulkOperationStatus floating 카드 + ScenesView 마운트"
```

---

## Chunk 4: ScenesView 오케스트레이션

### Task 13: `runBulkOp` + `resolveSelectedUuids` 헬퍼 추출

**Files:**
- Create: `src/views/ScenesView.utils.ts`

**배경:** Spec §5.4, §5.4a. 공통 호출 패턴 및 "all" 모드 ID 해석.

- [ ] **Step 1: 파일 작성**

```typescript
import { useBulkOperationsStore, type OpKind } from '@/stores/useBulkOperationsStore';
import { useDataStore } from '@/stores/useDataStore';
import type { BulkUpdateResult } from '../../electron/supabase';

const MERGED_KEY_PREFIX = { bg: 'bg:', act: 'act:' } as const;

export function resolveSelectedUuids(
  selectedIds: Set<string>,
  allMergedScenes: Array<{ key: string; bgScene?: { uuid: string }; actScene?: { uuid: string } }>,
): string[] {
  const uuids: string[] = [];
  for (const id of selectedIds) {
    if (id.startsWith(MERGED_KEY_PREFIX.bg)) {
      uuids.push(id.slice(MERGED_KEY_PREFIX.bg.length));
    } else if (id.startsWith(MERGED_KEY_PREFIX.act)) {
      uuids.push(id.slice(MERGED_KEY_PREFIX.act.length));
    } else {
      const merged = allMergedScenes.find((m) => m.key === id);
      if (merged?.bgScene) uuids.push(merged.bgScene.uuid);
      if (merged?.actScene) uuids.push(merged.actScene.uuid);
    }
  }
  return uuids;
}

type RunBulkOpOptions = {
  targetStage?: 'lo' | 'done' | 'review' | 'png';
  completedMetaByUuid?: Map<string, { completedBy: string; completedAt: string }>;
};

export async function runBulkOp(
  kind: OpKind,
  sceneUuids: string[],
  executor: (uuids: string[]) => Promise<BulkUpdateResult[]>,
  opts: RunBulkOpOptions = {},
): Promise<void> {
  const store = useBulkOperationsStore.getState();
  if (sceneUuids.length === 0) return;

  store.startOp({
    id: crypto.randomUUID(),
    kind,
    totalCount: sceneUuids.length,
    pendingSceneUuids: new Set(sceneUuids),
    targetStage: opts.targetStage,
  });

  try {
    const results = await executor(sceneUuids);
    for (const r of results) {
      if (r.success) {
        store.markConfirmed(r.sceneUuid);
        if (kind === 'delete') {
          useDataStore.getState().removeSceneByUuid(r.sceneUuid);
        }
        if (kind === 'stage-toggle' && opts.completedMetaByUuid) {
          const meta = opts.completedMetaByUuid.get(r.sceneUuid);
          if (meta) {
            useDataStore.getState().updateSceneByUuid(r.sceneUuid, {
              completedBy: meta.completedBy,
              completedAt: meta.completedAt,
            });
          }
        }
      } else {
        store.markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
    }
  } catch (e) {
    store.setStatus('network-error');
  }
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/views/ScenesView.utils.ts
git commit -m "feat(view): runBulkOp + resolveSelectedUuids 헬퍼 신설"
```

---

### Task 14: 일괄 삭제 경로 교체

**Files:**
- Modify: `src/views/ScenesView.tsx:3844-3911` (일괄 삭제 블록)

- [ ] **Step 1: 기존 `window.confirm` 호출을 `ConfirmDialog.show`로 교체**

```tsx
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { runBulkOp, resolveSelectedUuids } from '@/views/ScenesView.utils';
import { bulkDeleteScenes } from '@/services/supabaseService';
```

- [ ] **Step 2: 일괄 삭제 핸들러 전체 교체**

```tsx
const handleBulkDelete = async () => {
  const uuids = resolveSelectedUuids(selectedSceneIds, allMergedScenes);
  if (uuids.length === 0) return;

  const ok = await ConfirmDialog.show({
    message: `${uuids.length}개의 씬을 삭제하시겠습니까?`,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;

  await runBulkOp(
    'delete',
    uuids,
    (list) => bulkDeleteScenes(list, currentUser?.id ?? ''),
  );

  clearSelectedScenes();
};
```

기존 블록의 나머지 로직(낙관적 삭제, try/catch, syncInBackground 등)은 **완전히 제거**. `runBulkOp` 내부에서 처리됨.

- [ ] **Step 3: 버튼 onClick을 새 핸들러로 교체**

기존 휴지통 아이콘 버튼의 `onClick`을 `handleBulkDelete`로 바꿈.

- [ ] **Step 4: 하단 바 비활성 로직 (in-flight 동안)**

```tsx
const isBulkInFlight = useBulkOperationsStore((s) => s.activeOp?.status === 'in-flight');

<button disabled={isBulkInFlight} onClick={handleBulkDelete}>🗑</button>
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: 수동 스모크**

```bash
npm run electron:dev
```
씬 3개 선택 → 삭제 → 확인창 → 서버 확정 후 순차 제거되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/views/ScenesView.tsx
git commit -m "feat(view): 일괄 삭제 경로를 runBulkOp + ConfirmDialog로 교체"
```

---

### Task 15: 일괄 stage 토글 경로 교체

**Files:**
- Modify: `src/views/ScenesView.tsx` — `handleBulkToggle` (L2296-2312), `bulkToggleForSheet` (L2159-2248), `bulkToggleResolvedForSheet` (L2250-2293)

- [ ] **Step 1: 기존 세 함수를 하나의 새 핸들러로 통합**

```tsx
import { bulkUpdateSceneStages, type BulkStageUpdate } from '@/services/supabaseService';

const handleBulkStageToggle = async (stage: 'lo' | 'done' | 'review' | 'png') => {
  const mergedScenes = allMergedScenes.filter((m) => selectedSceneIds.has(m.key)
    || (m.bgScene && selectedSceneIds.has('bg:' + m.bgScene.uuid))
    || (m.actScene && selectedSceneIds.has('act:' + m.actScene.uuid)));

  // 실제 씬 목록 평탄화 (merged 각각 bg/act 쪼갬)
  const targetScenes: Scene[] = [];
  for (const id of selectedSceneIds) {
    if (id.startsWith('bg:')) {
      const sc = allScenesByUuid.get(id.slice(3));
      if (sc) targetScenes.push(sc);
    } else if (id.startsWith('act:')) {
      const sc = allScenesByUuid.get(id.slice(4));
      if (sc) targetScenes.push(sc);
    } else {
      const m = allMergedScenes.find((x) => x.key === id);
      if (m?.bgScene) targetScenes.push(m.bgScene);
      if (m?.actScene) targetScenes.push(m.actScene);
    }
  }
  if (targetScenes.length === 0) return;

  const updates: BulkStageUpdate[] = targetScenes.map((s) => {
    const isDoneTurningOn = stage === 'done' && !s.done;
    return {
      sceneUuid: s.uuid,
      stage,
      value: !s[stage],
      completedBy: isDoneTurningOn ? currentUser?.name : undefined,
      completedAt: isDoneTurningOn ? new Date().toISOString() : undefined,
    };
  });

  const completedMetaByUuid = new Map<string, { completedBy: string; completedAt: string }>();
  for (const u of updates) {
    if (u.completedBy && u.completedAt) {
      completedMetaByUuid.set(u.sceneUuid, { completedBy: u.completedBy, completedAt: u.completedAt });
    }
  }

  await runBulkOp(
    'stage-toggle',
    updates.map((u) => u.sceneUuid),
    () => bulkUpdateSceneStages(updates, currentUser?.id ?? ''),
    { targetStage: stage, completedMetaByUuid },
  );
};
```

- [ ] **Step 2: 기존 `bulkToggleForSheet`/`bulkToggleResolvedForSheet`/`handleBulkToggle` 호출 지점을 새 핸들러로 교체**

기존 4개 stage 버튼(LO/완료/검수/PNG) 및 전체 모드의 BG/ACT 행 버튼 각각:

```tsx
<button onClick={() => handleBulkStageToggle('lo')} disabled={isBulkInFlight}>LO</button>
// ... 마찬가지로 done, review, png
```

- [ ] **Step 3: 기존 함수 본문 제거**

`bulkToggleForSheet`, `bulkToggleResolvedForSheet`, 기존 `handleBulkToggle` 전체 삭제. `updateSceneCompletionMeta` 개별 호출도 같이 제거됨.

- [ ] **Step 4: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 수동 스모크**

씬 5개 선택 → LO 클릭 → 5개 LO 셀이 반투명 후 순차 채움 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/views/ScenesView.tsx
git commit -m "feat(view): 일괄 stage 토글 경로를 runBulkOp + RPC로 교체"
```

---

### Task 16: 일괄 편집(field-edit) 경로 교체

**Files:**
- Modify: `src/views/ScenesView.tsx:3955-4032` (일괄 편집 모달 제출 핸들러)

- [ ] **Step 1: 모달 "적용" 핸들러 교체**

```tsx
import { bulkUpdateSceneFields, type BulkFieldUpdate } from '@/services/supabaseService';

const handleBulkEditSubmit = async (payload: { assignee?: string; memo?: string; layoutId?: string }) => {
  const uuids = resolveSelectedUuids(selectedSceneIds, allMergedScenes);
  if (uuids.length === 0) return;

  const updates: BulkFieldUpdate[] = uuids.map((uuid) => ({
    sceneUuid: uuid,
    fields: payload,
  }));

  await runBulkOp(
    'field-edit',
    uuids,
    () => bulkUpdateSceneFields(updates, currentUser?.id ?? ''),
  );

  closeBulkEditModal();
};
```

- [ ] **Step 2: 기존 `updateSceneFieldOptimistic` 루프 제거**

- [ ] **Step 3: tsc + 수동 스모크**

```bash
npx tsc --noEmit
npm run electron:dev
```
3개 선택 → 일괄 편집 모달 → 담당자 설정 → 적용 → pending 반투명 후 확정.

- [ ] **Step 4: 커밋**

```bash
git add src/views/ScenesView.tsx
git commit -m "feat(view): 일괄 편집 경로를 runBulkOp + RPC로 교체"
```

---

### Task 17: 죽은 코드 제거 + grep 확인

- [ ] **Step 1: `bulkUpdateCells` 참조 0 확인**

```bash
grep -rn "bulkUpdateCells" src/ electron/
```
Expected: no output.

- [ ] **Step 2: `updateSceneCompletionMeta` 개별 호출 루프 0 확인**

```bash
grep -n "updateSceneCompletionMeta" src/views/ScenesView.tsx
```
Expected: 단일 클릭 경로의 1-2회만 (없어도 OK). 대량 루프는 사라져야 함.

- [ ] **Step 3: 최종 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```
Expected: 모두 통과.

- [ ] **Step 4: 커밋 (필요 시 임시 코드 정리)**

```bash
git add -A
git commit -m "chore(view): 이전 낙관적 일괄 경로 잔재 정리" --allow-empty
```

---

## Chunk 5: Realtime 통합

### Task 18: `App.tsx` — scenes UPDATE 핸들러에 markConfirmed 연결

**Files:**
- Modify: `src/App.tsx:723-729` (scenes UPDATE 분기)

- [ ] **Step 1: 기존 분기 수정**

```tsx
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';
// ...

if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
  const delta = extractSceneDelta(payload.new);
  if (delta) {
    const applied = useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
    useBulkOperationsStore.getState().markConfirmed(delta.uuid); // idempotent
    if (applied) return;
  }
}
```

- [ ] **Step 2: tsc + 수동 스모크 (두 기기 사용 불가능하면 단일 기기로)**

기기 A가 일괄 LO → 자신의 Realtime 에코가 돌아와도 중복 없이 정상 동작하는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/App.tsx
git commit -m "feat(realtime): scenes UPDATE 수신 시 markConfirmed 호출"
```

---

### Task 19: `App.tsx` — scenes DELETE fast path 추가

**Files:**
- Modify: `src/App.tsx:739-744` (기존 debounced full reload 분기 앞)

- [ ] **Step 1: DELETE 전용 분기를 UPDATE 분기 바로 뒤에 추가**

```tsx
if (table === 'scenes' && payload?.eventType === 'DELETE') {
  const deletedId = (payload?.old as { id?: string } | undefined)?.id;
  if (typeof deletedId === 'string') {
    useDataStore.getState().removeSceneByUuid(deletedId);
    useBulkOperationsStore.getState().markConfirmed(deletedId); // idempotent
    return;
  }
  // deletedId 없으면 아래 debounced reload로 폴백 (return 하지 않음)
}
```

- [ ] **Step 2: REPLICA IDENTITY 검증 (Supabase SQL Editor)**

```sql
SELECT relname, relreplident FROM pg_class WHERE relname = 'scenes';
```
Expected: `relreplident = 'd'` (default) — 기본값이면 primary key(id)는 DELETE payload에 포함됨.

`'n'` (nothing)이 나오면 폴백 경로(debounced reload)로 작동함을 확인.

- [ ] **Step 3: tsc + 수동 스모크**

기기 A에서 일괄 삭제 → 씬 카드가 하나씩 사라지는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/App.tsx
git commit -m "feat(realtime): scenes DELETE fast path + activeOp 확정 연결"
```

---

## Chunk 6: 문서 + 검증

### Task 20: `CLAUDE.md` — keep-alive 줄 제거

**Files:**
- Modify: `CLAUDE.md:48` (또는 해당 위치)

- [ ] **Step 1: "Supabase 무료 플랜: 7일 미사용 시 자동 정지 — 연휴 시 keep-alive 필요" 줄 삭제**

주변 문맥이 "제약 사항" 섹션이면 해당 불릿만 제거.

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): Pro 플랜 전환으로 keep-alive 제약 제거"
```

---

### Task 21: `DEVLOG/supabase-migration-plan.md` — keep-alive 주석 정리

**Files:**
- Modify: `DEVLOG/supabase-migration-plan.md`

- [ ] **Step 1: "대응: 간단한 keep-alive 요청을 주기적으로 보내거나, 연휴 전에 수동으로 앱을 한 번 실행." 류 문단을 "Pro 플랜 전환(2026-04-22)으로 자동 정지 제약 해소됨"으로 각주 또는 취소선 처리**

- [ ] **Step 2: 커밋**

```bash
git add DEVLOG/supabase-migration-plan.md
git commit -m "docs(devlog): keep-alive 문단을 Pro 전환 주석으로 갱신"
```

---

### Task 22: 테스트 훅 `BFLOW_FORCE_FAIL_RATE` (선택)

**Files:**
- Modify: `electron/supabase.ts` — bulkUpdateSceneStages 등 3개 래퍼

- [ ] **Step 1: dev 전용 인젝션 헬퍼**

```typescript
function maybeForceFail(results: BulkUpdateResult[]): BulkUpdateResult[] {
  const rate = Number(process.env.BFLOW_FORCE_FAIL_RATE ?? '0');
  if (!rate || rate <= 0) return results;
  return results.map((r) => (r.success && Math.random() < rate)
    ? { ...r, success: false, error: 'forced failure (test hook)' }
    : r);
}
```

- [ ] **Step 2: 각 bulk 함수 반환 직전에 래핑**

```typescript
return maybeForceFail(mapRpcRows(data as RpcRow[] | null));
```

- [ ] **Step 3: 프로덕션 빌드 경로 확인**

Electron 메인이므로 `process.env`는 그대로 사용 가능. 프로덕션 빌드에서는 해당 환경변수 미설정이면 no-op.

- [ ] **Step 4: 검증**

```bash
BFLOW_FORCE_FAIL_RATE=0.3 npm run electron:dev
```
10개 일괄 작업 → 약 30% 실패 관찰.

- [ ] **Step 5: 커밋**

```bash
git add electron/supabase.ts
git commit -m "chore(electron): 일괄 작업 테스트 훅 BFLOW_FORCE_FAIL_RATE 추가"
```

---

### Task 23: 수동 검증 시나리오 12개 실행

**12개 시나리오** (spec §7.1):

- [ ] **1. 기본 일괄 삭제** — 10개 선택 → 삭제 확인 → 깜빡임 없이 순차 소실 + "10개 삭제됨" 완료 카드.
- [ ] **2. 기본 일괄 토글 LO** — 10개 선택 → LO 클릭 → LO 셀만 반투명 → 순차 채움 → 완료 카드.
- [ ] **3. 혼합 방향 토글** — LO가 일부만 켜진 10개 선택 → LO 클릭 → 일부 on/일부 off 정상 처리.
- [ ] **4. 부분 실패** — `BFLOW_FORCE_FAIL_RATE=0.3 npm run electron:dev` → 30% 실패 강제 → "N-M개 완료 · M개 실패 [다시 시도]" 표시 + 재시도가 실패분만 재전송.
- [ ] **5. 네트워크 끊김** — DevTools Network Offline → 일괄 → 10초 타임아웃 → "연결 끊김" + 재시도 동작.
- [ ] **6. 동시 편집** — 두 기기에서 같은 씬 대상 일괄 작업 + 단일 삭제 충돌 → 충돌 씬만 실패 메시지 + 나머지 정상.
- [ ] **7. 대량 (50개)** — 50개 선택 → LO → 성능 이슈 없이 완료, 카운터 정상.
- [ ] **8. 단일 경로 회귀** — 단일 씬 체크/삭제가 기존과 동일하게 즉시 반영.
- [ ] **9. 취소** — 진행 중 취소 → 상태 카드 즉시 닫힘 + 다음 새로고침 시 서버 쪽 처리는 완료되어 있는지.
- [ ] **10. 중첩 차단** — 일괄 작업 중 하단 바가 비활성화 & 단일 클릭은 계속 가능.
- [ ] **11. "all" 모드** — 통합 부서 뷰에서 bg/act 혼합 선택 → 각 방향별 pending 표시 정상.
- [ ] **12. 완료 메타 즉시 반영** — 일괄 "완료" 체크 → 본인 화면에 "한솔 · 방금" 즉시 표시. 다른 기기에서는 다음 로드 시 확인.

- [ ] **실패 시나리오 기록**: `tasks/lessons.md`에 추가할 learning이 있으면 별도 커밋으로 반영.

---

### Task 24: 최종 빌드 + PR 준비

- [ ] **Step 1: 전체 빌드**

```bash
npx tsc --noEmit
npm run build:vite
npm run electron:dev  # 스모크 1회
```

- [ ] **Step 2: git log 확인**

```bash
git log --oneline origin/main..HEAD
```
모든 커밋 메시지가 한글·prefix 준수 형식인지 확인.

- [ ] **Step 3: 푸시 + PR 생성**

```bash
git push -u origin claude/determined-herschel-236409
```

그 다음 pr-creator 스킬 또는 `gh pr create`로 PR 작성 (spec + 이 plan 링크 포함).

- [ ] **Step 4: 완료 체크리스트**

- SQL RPC 3종 Supabase에 배포 완료
- electron/* 빌드 성공
- useBulkOperationsStore 테스트 전부 통과
- 12개 수동 시나리오 모두 기록
- CLAUDE.md / DEVLOG 문서 정리
- PR 오픈 + 리뷰 요청

---

## 부록 A: 롤백 절차

1. PR revert (Git merge commit 되돌리기).
2. SQL 함수는 DB에 남아있음 — 필요 시:
   ```sql
   DROP FUNCTION bulk_update_scene_stages(jsonb, text);
   DROP FUNCTION bulk_delete_scenes(uuid[], text);
   DROP FUNCTION bulk_update_scene_fields(jsonb, text);
   ```
3. 심각한 데이터 손실 시 Supabase 대시보드 → Backups → 복구.

## 부록 B: 트러블슈팅

- **"function does not exist" 에러** → Task 1 SQL 배포 누락 또는 함수 시그니처 불일치.
- **"permission denied for function"** → Task 1 Step 2 GRANT EXECUTE 누락.
- **피어 알림 안 옴** → Task 3 IPC 핸들러의 broadcast 호출 누락.
- **본인 "완료 시각" 안 보임** → Task 13 `completedMetaByUuid` 전달 누락 또는 Task 15 맵 구성 로직 오류.
- **UI stuck pending** → Task 18/19 Realtime 핸들러 또는 Task 13 IPC 성공 시 markConfirmed 호출 누락.

---

*작성: Claude × 한솔 (Studio JBBJ)*
*관련 문서: 스펙 [`2026-04-22-bulk-operations-ux-design.md`](../specs/2026-04-22-bulk-operations-ux-design.md)*
