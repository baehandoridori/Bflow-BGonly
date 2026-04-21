# 다중 선택 일괄 작업 UX 재설계 — Hybrid Server-Authoritative + RPC

- 작성일: 2026-04-22
- 브랜치: `claude/determined-herschel-236409`
- 대상 범위: 씬 뷰(카드/시트)의 일괄 삭제·일괄 단계 토글·일괄 편집 경로, Realtime 수신 로직, 메인 프로세스 배치 핸들러, preload 바인딩, **PostgreSQL RPC 함수 신설**
- PR 단위: **단일 PR** (사용자 결정)
- 전제: Supabase **Pro 플랜** (2026-04-22 업그레이드) — 확장된 Realtime 한도 + 일일 백업 + 자동 정지 없음

---

## 1. 배경

Studio JBBJ 팀이 카드 뷰/시트 뷰에서 다중 선택 후 일괄 작업(삭제, LO/완료/검수/PNG 단계 토글, 담당자·메모·레이아웃ID 일괄 편집)을 수행할 때 현재 낙관적 업데이트 구조가 **체감 혼란**을 일으키고 있다. 한솔(비개발자) 확인 결과 핵심 증상은 3가지다.

- **B. 중간 상태 깜빡임**: 낙관적으로 바뀐 UI가 서버 실패 시 조용히 롤백 → 사용자 혼란.
- **E. 부분 실패 모호함**: 배치 일부만 실패했을 때 어떤 항목이 실패했는지 표면화되지 않음.
- **A. 저장 확신 부족**: "눈앞에선 바뀌었는데 정말 서버에 저장됐나?" 불확실.

### 근본 원인

깜빡임은 **"예측 + 실패 시 되돌리기"의 수학적 결과**다. 다중 사용자 앱에서 "즉시 반영 + 깜빡임 0 + 일관성"은 **CRDT 없이는 동시 만족 불가능**. 따라서 패러다임 자체를 조정해야 한다.

현재 관련 이슈 기록:
- `tasks/lessons.md` (2026-04-20): 낙관적 삭제 × 인덱스 재해석 버그 (해결 완료, UUID 캡처 패턴 도입)
- 본 설계는 그 연장선 — 인덱스 문제가 아닌 **"조용한 롤백" 문제** 해결.

---

## 2. 해결 전략 — "Hybrid Server-Authoritative"

### 2.1 핵심 규칙

```
┌─────────────────────────────────────────────────────────────┐
│ 단일 항목 변경 (selectedSceneIds.size <= 1)                  │
│  → 낙관적 유지 (현재 그대로, 변경 없음)                        │
│                                                             │
│ 다중 항목 변경 (selectedSceneIds.size >= 2)                  │
│  → Server-first + 서버 응답 기반 순차 UI 반영                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 대안 기각 근거

| 대안 | 기각 사유 |
|------|----------|
| **현행 낙관적 유지 + 토스트 개선** | 깜빡임 자체가 사라지지 않음 (증상 B 미해결) |
| **🅱️ 전면 pessimistic** | 단일 클릭 체감 속도 저하 — 씬 체크는 "로컬 행동" 느낌 필수 |
| **🅲 CRDT (Yjs)** | 데이터 레이어 재작성급 대규모 리팩터, 현 단계 오버킬 |
| **🅳 자동 롤백 제거** | 속도는 유지되나 "UI ≠ 서버" 상태가 길어져 데이터 무결성 리스크 |

---

## 3. UX 사양

### 3.1 일괄 삭제 플로우

```
[T0] 사용자 N개 선택 → 하단 바 "삭제" 클릭
[T0] 확인 모달 (커스텀, 기존 window.confirm 교체): "N개 삭제하시겠습니까?"
      → 확인창은 **2개 이상 모든 경우**에 표시 (임계값 고정)
[T1] "확인" 클릭
      ↓
[T1] 선택된 N개 카드에 "반투명 50% + 미세 펄스" (처리 중 상태)
[T1] 하단 상태 카드 등장: "N개 삭제 중 · 0/N 완료"
[T1] IPC → 서버에 N건 병렬 요청 (Promise.allSettled)
      ↓
[T1+δ] 확정 경로 (happy path):
       IPC 응답의 success:true 항목 → 즉시 markConfirmed
       + Realtime DELETE 에코 수신 → markConfirmed (idempotent)
[T1+δ] markConfirmed된 uuid의 카드가 fade-out 후 DOM 제거
[T1+δ] 상태 카드 카운터 갱신
      ↓
[T_done] 전부 완료: "N개 삭제됨 ✓" 2초 표시 후 자동 사라짐
         실패 있으면: "N-M개 완료 · M개 실패 [다시 시도]" 유지 (수동 닫기)
```

**핵심 원칙:**
- 낙관적 즉시 제거 없음. **서버 확정**이 도착해야 제거.
- IPC 응답과 Realtime 에코 중 **먼저 도착한 쪽이 확정**을 트리거 (idempotent markConfirmed).
- 부분 실패 항목: 반투명 상태 유지 + 빨간 "!" 배지 + 호버 시 사유 툴팁.

### 3.2 일괄 단계 토글 (LO/완료/검수/PNG) 플로우

```
[T0] N개 선택 → 하단 바 "LO" 클릭 (확인창 없음 — 되돌리기 쉬움)
      ↓
[T1] 선택된 N개 카드의 "LO 셀만" 반투명 + 펄스
     (방향 불문 — 대상 stage 셀이면 모두 pending 표기)
[T1] 하단 상태 카드: "N개 LO 처리 중 · 0/N 완료"
[T1] 서버에 N건 병렬 (bulkUpdateSceneStages, 완료 메타 포함)
      ↓
[T1+δ] IPC 응답 + Realtime UPDATE 수신 → markConfirmed
       해당 LO 셀이 "스르륵 색 채워짐/비워짐" (방향에 따라)
[T1+δ] 상태 카드 카운터 갱신
      ↓
[T_done] 완료 표시 2초 후 사라짐
```

**혼합 방향 (mixed direction) 처리:**
현재 `bulkToggleForSheet`는 각 씬의 현재값을 반전(`!baseScene[stage]`)한다. 즉 한 배치 안에서 일부는 true→false, 일부는 false→true 가능.

- **Pending 시각 표현**: 방향 불문, **대상 stage 셀 자체를 "반투명 + 펄스"** 처리. "어느 방향인지"는 처리 중엔 굳이 명시하지 않음.
- **확정 애니메이션**: 각 씬의 최종 값에 따라 채움(진입) 또는 비움(해제) 애니메이션 선택적 적용.
- **혼합 방향 정책**: 기존 동작 유지 (반전). 사용자가 "일괄 켜기" vs "일괄 끄기"를 고르는 토글은 별도 기능이 아니므로 spec에서 신규 정의하지 않음.

**완료 메타 (completed_by/completed_at):**

중요 정정: `completed_by`/`completed_at`은 **scenes 테이블 컬럼이 아니다**. 별도 `metadata` 테이블에 generic KV (type='scene_completion_meta', key=scene uuid, value=JSON string) 형태로 저장된다 (DEVLOG/supabase-init.sql L114-123).

현재 `bulkToggleForSheet`는 `bulkUpdateCells` 호출 후 **별도**로 `updateSceneCompletionMeta` N건을 추가 호출한다 (ScenesView.tsx:2231-2246). N×2 HTTP 요청이 발생하고 Realtime 에코 순서도 보장되지 않는다.

→ **본 설계에서는 Pro 플랜의 이점을 살려 PostgreSQL RPC 함수로 scenes + metadata를 한 트랜잭션에 원자적으로 처리** (§5.1.0 참조). 즉:
- 렌더러는 `{ sceneUuid, stage, value, completedBy?, completedAt? }[]` 형태로 한 번에 전달
- RPC `bulk_update_scene_stages` 내부에서 scenes row UPDATE + metadata row UPSERT를 하나의 트랜잭션으로 수행
- 별도 `updateSceneCompletionMeta` 호출 제거
- `SCENE_FIELD_MAP` 확장 **불필요** (scenes 테이블에는 해당 컬럼이 없으므로 Realtime scenes UPDATE 델타에 완료 메타는 포함 안 됨)
- 다른 클라이언트에서 완료 메타 갱신 반영은 **기존 동작 그대로** (metadata 테이블은 현재 Realtime 구독 대상이 아님 — 다음 로드 시 반영됨). 본 스펙 범위 밖.

### 3.3 일괄 편집 (담당자·메모·레이아웃ID) 플로우

기존 일괄 편집 모달은 유지. 모달 "적용" 이후:
- 선택된 항목 **전체 카드**가 반투명 + 펄스
- 하단 상태 카드 "N개 편집 중"
- IPC 응답 및 Realtime UPDATE 수신 순으로 markConfirmed
- 실패 시 "다시 시도" — 실패 uuid만 재전송

### 3.4 동시 작업 중첩 정책 (Overlap Policy)

- `useBulkOperationsStore.activeOp`는 **싱글톤** (한 번에 하나만).
- 일괄 작업 진행 중(`activeOp !== null && activeOp.status === 'in-flight'`) 일 때 하단 바의 일괄 액션 버튼(LO/완료/검수/PNG/편집/삭제)은 **비활성화**.
- 단일 클릭(낙관적 경로)은 진행 중인 일괄 작업과 무관하게 계속 허용 (서로 다른 경로).
- 완료/실패/취소로 `activeOp.status`가 끝나면 하단 바 재활성화.

---

## 4. 예외 처리 사양

### 4.1 네트워크 지연 (5초 이상)
- 상태 카드 하단에 "네트워크가 느려요" 부연 표시.
- 계속 대기.
- **"취소" 버튼 의미**: 이미 병렬로 모두 전송되었으므로 HTTP 중단은 하지 않음. 대신:
  - 현재 `activeOp`를 `cancelled` 상태로 플래그
  - 이후 도착하는 IPC 응답/Realtime 에코는 실제 DB 갱신은 적용하되, UI pending 상태만 해제 (상태 카드 즉시 닫힘)
  - 즉 "취소" = "이 일괄 작업의 UI 모니터링 중단" (사용자에게는 "닫기" 개념). 툴팁으로 "이미 서버에 전송된 작업은 완료됩니다" 안내.

### 4.2 네트워크 끊김 (10초 타임아웃)
- 타임아웃 도달 시 (IPC 응답도, Realtime 에코도 오지 않음):
  - 상태 카드 "연결 끊김 — 다시 시도해주세요" + 재시도 버튼
  - 반투명 pending 상태 해제 (사용자 의도 = 포기)
  - 재시도 시 `pendingSceneUuids` 원본을 기준으로 전체 재전송 (서버가 이미 처리했던 건 멱등성으로 무해)

### 4.3 동시 편집 충돌
- A가 씬 5 LO 토글 중, B가 씬 5 삭제:
  - A의 IPC 응답: `{sceneUuid: '5', success: false, error: 'not_found'}`
  - A의 Realtime: `scenes DELETE { old: { id: '5' } }` 수신
  - 결과: 씬 5는 UI에서 제거(Realtime DELETE 경로) + 실패 리스트에 "씬 5 (다른 사용자 삭제)" 표시
- 나머지 N-1건은 정상 처리.

### 4.4 부분 실패
- IPC 응답이 `BulkUpdateResult[]`로 항목별 결과 포함.
- 실패 항목: 반투명 유지 + 빨간 "!" 배지 + 호버 툴팁.
- 상태 카드: "(N-M)개 완료 · M개 실패 [다시 시도]".
- 재시도: 실패 uuid만 재전송 (새 activeOp 생성 or 기존 op 재활용 — 구현에서 택1; 초안은 기존 op 재활용).

### 4.5 Realtime 연결 끊긴 상태에서 일괄 작업
- IPC 응답만으로 markConfirmed/markFailed 진행 (Realtime 에코 없이도 완결).
- 이는 **happy path 이중 확정 경로**의 자연스러운 귀결 — §5.5 참조.

### 4.6 사용자 새로고침 / 창 닫기
- 이미 서버 전송된 요청은 서버에서 계속 처리 → 다음 로드 시 DB에서 최종 상태 반영.
- `useBulkOperationsStore`는 초기화됨 (세션 밖으로 영속화 안 함).
- Realtime 핸들러는 `activeOp === null` 시 `markConfirmed/markFailed` 호출해도 **no-op** 보장 (§5.5).

---

## 5. 구현 사양

### 5.1.0 PostgreSQL RPC 함수 설계 (Pro 플랜 활용)

**왜 RPC인가**: 현재 `Promise.allSettled`는 N개 씬 업데이트 = N번의 HTTP 왕복(electron main → Supabase). RPC 함수로 전환하면 **1번의 HTTP 왕복에 서버 내부에서 N개 쿼리 실행**. 속도↑ + 트랜잭션 일관성↑ + scenes/metadata 동시 갱신의 원자성 확보.

**설계 원칙**:
- 각 함수는 `BEGIN/EXCEPTION WHEN OTHERS` 루프로 **항목별 best-effort** (부분 성공 허용) — 현 UX 사양 보존.
- `RETURNS TABLE (scene_uuid uuid, success boolean, error text)` 시그니처 통일.
- SECURITY INVOKER (호출자 권한 — 기존 RLS 정책 "allow_all" 그대로 적용).
- IF NOT EXISTS / CREATE OR REPLACE 패턴 (기존 supabase-init.sql 스타일 따름).

**함수 #1: `bulk_update_scene_stages`**

```sql
CREATE OR REPLACE FUNCTION bulk_update_scene_stages(
  p_updates jsonb,   -- [{sceneUuid, stage, value, completedBy?, completedAt?}, ...]
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
  v_meta_value text;  -- JSON stringified
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

      -- scenes 테이블 UPDATE (CASE 분기)
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

      -- metadata 테이블 UPSERT (완료 메타 있을 때만)
      IF v_completed_by IS NOT NULL OR v_completed_at IS NOT NULL THEN
        v_meta_value := jsonb_build_object(
          'completedBy', v_completed_by,
          'completedAt', v_completed_at,
          'stage', v_stage
        )::text;
        INSERT INTO metadata (type, key, value, updated_at)
          VALUES ('scene_completion_meta', v_uuid::text, v_meta_value, now())
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
```

**함수 #2: `bulk_delete_scenes`**

```sql
CREATE OR REPLACE FUNCTION bulk_delete_scenes(
  p_uuids uuid[],
  p_deleted_by text  -- 현재 미사용(감사 로그 필요 시 확장)
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
      -- 연관 metadata 정리 (best-effort, 실패해도 메인 삭제는 성공)
      DELETE FROM metadata WHERE type = 'scene_completion_meta' AND key = v_uuid::text;

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
```

**함수 #3: `bulk_update_scene_fields`**

```sql
CREATE OR REPLACE FUNCTION bulk_update_scene_fields(
  p_updates jsonb,   -- [{sceneUuid, fields: {assignee?, memo?, layout?, storyboardUrl?, guideUrl?}}, ...]
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
```

**배포 절차:**
1. 위 3개 CREATE OR REPLACE FUNCTION 블록을 `DEVLOG/supabase-init.sql` 하단에 추가 (RLS 정책 블록 뒤).
2. 사용자(한솔)가 Supabase 대시보드 SQL Editor에서 수동 실행 (기존 관리 방식 따름).
3. 동일 PR에서 `electron/supabase.ts`가 `supabase.rpc(...)`를 호출하도록 변경.
4. 배포 순서: **SQL 먼저 적용 → 클라이언트 배포** (반대 순서면 RPC 호출 실패).

**Realtime 이벤트:** RPC 내부에서 실행된 UPDATE/DELETE 문은 통상적인 Postgres Changes 이벤트를 발행함. 클라이언트 Realtime 구독 코드는 변경 없음.

**보안 검토:** `SECURITY INVOKER`이므로 현재 "allow_all" RLS 아래서는 anon key로 호출 가능. 향후 Supabase Auth 전환 시 RLS를 authenticated 전용으로 강화하면 RPC도 자동으로 보호됨.

### 5.1 백엔드 — RPC 기반 구현으로 전환

**타입 정의** (`electron/supabase.ts` 또는 공유 types):
```typescript
export type BulkStageUpdate = {
  sceneUuid: string;
  stage: 'lo' | 'done' | 'review' | 'png';
  value: boolean;
  completedBy?: string;   // stage === 'done' 등 완료 메타 필요 시
  completedAt?: string;   // ISO string
};

export type BulkUpdateResult = {
  sceneUuid: string;
  success: boolean;
  error?: string;        // 실패 시에만
};
```

**`bulkUpdateSceneStages` 개정** ([electron/supabase.ts:479-497]):

RPC 호출로 단순화. 기존 `Promise.allSettled` + `updateSceneStage` N번 호출 전부 제거.

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
  if (error) throw error;  // 전체 함수 실패 (네트워크/SQL 구문 에러 등)
  return (data ?? []).map((row: { scene_uuid: string; success: boolean; error: string | null }) => ({
    sceneUuid: row.scene_uuid,
    success: row.success,
    error: row.error ?? undefined,
  }));
}
```

**신규 함수들** (동일 패턴):

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
  return (data ?? []).map((row: { scene_uuid: string; success: boolean; error: string | null }) => ({
    sceneUuid: row.scene_uuid,
    success: row.success,
    error: row.error ?? undefined,
  }));
}

export async function bulkUpdateSceneFields(
  updates: Array<{ sceneUuid: string; fields: Partial<Scene> }>,
  updatedBy: string,
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_update_scene_fields', {
    p_updates: updates.map((u) => ({
      sceneUuid: u.sceneUuid,
      fields: {
        assignee: u.fields.assignee,
        memo: u.fields.memo,
        layout: u.fields.layoutId,          // client camelCase → db column
        storyboardUrl: u.fields.storyboardUrl,
        guideUrl: u.fields.guideUrl,
      },
    })),
    p_updated_by: updatedBy,
  });
  if (error) throw error;
  return (data ?? []).map((row: { scene_uuid: string; success: boolean; error: string | null }) => ({
    sceneUuid: row.scene_uuid,
    success: row.success,
    error: row.error ?? undefined,
  }));
}
```

**에러 의미 구분**:
- RPC 호출 자체가 `error`를 반환 → 전체 함수 실패 (네트워크 끊김, SQL 문법 오류 등) → 렌더러에서 `network-error` 상태로.
- RPC `data`에 `success: false` 항목 포함 → 특정 scene만 실패 (부분 실패) → `markFailed`로 표시.

**기존 `bulkUpdateCells`** (`src/services/supabaseService.ts:190-199`): 삭제 (호출자 전부 `bulkUpdateSceneStages`로 마이그레이션). 기존 `updateSceneStage` 개별 헬퍼는 단일 경로에서 여전히 사용되므로 유지.

**기존 `updateSceneCompletionMeta` 개별 호출 제거**: `bulkToggleForSheet` 라인 2231-2246의 메타 별도 호출 루프 완전 삭제 (RPC가 원자적으로 처리).

### 5.2 IPC 레이어 + Preload 바인딩

**IPC 채널 ↔ preload 메서드 ↔ 반환 타입 매핑**:

| IPC channel | preload method (window.electronAPI) | 반환 타입 |
|-------------|-------------------------------------|---------|
| `supabase:bulk-update-scene-stages` | `supabaseBulkUpdateSceneStages(updates, updatedBy)` | `Promise<BulkUpdateResult[]>` |
| `supabase:bulk-delete-scenes` (신규) | `supabaseBulkDeleteScenes(sceneUuids, deletedBy)` | `Promise<BulkUpdateResult[]>` |
| `supabase:bulk-update-scene-fields` (신규) | `supabaseBulkUpdateSceneFields(updates, updatedBy)` | `Promise<BulkUpdateResult[]>` |

기존 `supabase:bulk-update-scene-stages` 핸들러의 반환 타입을 `Promise<void>` → `Promise<BulkUpdateResult[]>`로 변경. preload camelCase 바인딩도 동일 시그니처로.

**electron/main.ts 핸들러 예시**:
```typescript
ipcMain.handle('supabase:bulk-update-scene-stages', wrapIpc(async (_e, updates, updatedBy) => {
  return await sbBulkUpdateSceneStages(updates, updatedBy);  // BulkUpdateResult[] 반환
}));
ipcMain.handle('supabase:bulk-delete-scenes', wrapIpc(async (_e, uuids, deletedBy) => {
  return await sbBulkDeleteScenes(uuids, deletedBy);
}));
ipcMain.handle('supabase:bulk-update-scene-fields', wrapIpc(async (_e, updates, updatedBy) => {
  return await sbBulkUpdateSceneFields(updates, updatedBy);
}));
```

### 5.3 렌더러 — 일괄 상태 관리 스토어 (`useBulkOperationsStore`)

**신규 파일**: `src/stores/useBulkOperationsStore.ts`

```typescript
type OpKind = 'delete' | 'stage-toggle' | 'field-edit';
type OpStatus = 'in-flight' | 'complete' | 'partial-fail' | 'network-error' | 'cancelled';

type PendingOp = {
  id: string;                          // uuid v4
  kind: OpKind;
  totalCount: number;
  completedCount: number;              // markConfirmed로만 증가
  failedItems: Array<{ sceneUuid: string; error: string }>;
  pendingSceneUuids: Set<string>;      // 아직 확정 안 된 uuid. 단일 source of truth.
  startedAt: number;
  status: OpStatus;
  targetStage?: 'lo' | 'done' | 'review' | 'png';  // stage-toggle 한정
};

interface BulkOperationsStore {
  activeOp: PendingOp | null;
  startOp(init: Omit<PendingOp, 'completedCount' | 'failedItems' | 'startedAt' | 'status'>): void;
  markConfirmed(sceneUuid: string): void;  // idempotent
  markFailed(sceneUuid: string, error: string): void;  // idempotent per-uuid
  setStatus(status: OpStatus): void;  // 네트워크 에러·취소 등 강제 전이
  retryFailed(retryFn: (uuids: string[]) => Promise<BulkUpdateResult[]>): Promise<void>;
  cancel(): void;
  clear(): void;
}
```

**Idempotency 계약 (핵심):**
- `markConfirmed(uuid)`: `pendingSceneUuids`에 uuid가 있을 때만 `completedCount++` 및 Set에서 제거. 없으면 **no-op**.
- `markFailed(uuid, err)`: `pendingSceneUuids`에 uuid가 있을 때만 Set에서 제거하고 `failedItems`에 push. 이미 failed에 있으면 no-op (error 메시지 덮어쓰지 않음).
- `activeOp === null` 시 모든 변경 함수는 no-op (Realtime 늦게 도착 등 대비).
- `completedCount + failedItems.length === totalCount` 일 때 자동으로 status 전이:
  - `failedItems.length === 0` → `'complete'`
  - 그 외 → `'partial-fail'`

**단일 source of truth**: `pendingSceneUuids` Set만 체크하면 IPC/Realtime 어느 쪽이 먼저 와도 정확. "이미 제거된 uuid"에 대한 중복 호출이 자동으로 무시됨.

**Invariant — stage-toggle op 범위:**
- 하나의 `activeOp` 는 **단일 `targetStage`에 대해서만** 작동한다. 즉 같은 배치에서 LO와 완료를 동시에 토글하는 건 허용 안 함 (현재 UI에도 없음).
- 이 불변을 보장해야 `pendingSceneUuids` Set이 "씬 uuid → 셀 하나"로 1:1 대응 가능.

### 5.4 ScenesView — 일괄 경로 교체 (공통 패턴)

**영향 위치**:
- `handleBulkToggle()` ([ScenesView.tsx:2296-2312])
- `bulkToggleForSheet()` / `bulkToggleResolvedForSheet()` ([2159-2293])
- 일괄 삭제 블록 ([3844-3911])
- 일괄 편집 모달 제출 ([3955-4032])

**패턴 — 공통 helper로 추출**:
```typescript
// src/views/ScenesView.utils.ts (신규 or 기존 유틸)
const MERGED_KEY_PREFIX = { bg: 'bg:', act: 'act:' } as const;

async function runBulkOp(
  kind: OpKind,
  sceneUuids: string[],
  executor: (uuids: string[]) => Promise<BulkUpdateResult[]>,
  opts: { targetStage?: Stage } = {},
) {
  const store = useBulkOperationsStore.getState();
  store.startOp({
    id: crypto.randomUUID(),
    kind,
    totalCount: sceneUuids.length,
    pendingSceneUuids: new Set(sceneUuids),
    targetStage: opts.targetStage,
  });

  try {
    const results = await executor(sceneUuids);
    // happy path: IPC 응답으로 즉시 markConfirmed/markFailed
    // Realtime 에코가 동시 도착해도 idempotent이므로 OK
    for (const r of results) {
      if (r.success) {
        store.markConfirmed(r.sceneUuid);
        // 중요: delete kind는 IPC 성공 시점에 데이터 스토어에서도 제거해야 함.
        // Realtime DELETE 에코가 오프라인이면 영영 안 와서 카드가 pending에 갇히기 때문.
        // removeSceneByUuid는 존재하지 않는 uuid에 대해 no-op이므로 Realtime과 경합해도 안전.
        if (kind === 'delete') {
          useDataStore.getState().removeSceneByUuid(r.sceneUuid);
        }
      } else {
        store.markFailed(r.sceneUuid, r.error ?? 'Unknown error');
      }
    }
  } catch (e) {
    // 전체 실패 (네트워크 끊김 등)
    store.setStatus('network-error');
  }
}
```

**호출 예 (일괄 삭제)**:
```typescript
// window.confirm → 커스텀 모달 컴포넌트로 교체
const ok = await ConfirmDialog.show({ message: `${uuids.length}개 삭제하시겠습니까?` });
if (!ok) return;
await runBulkOp('delete', uuids, (list) =>
  window.electronAPI.supabaseBulkDeleteScenes(list, currentUser?.id),
);
```

**호출 예 (일괄 stage 토글)**:
```typescript
const updates: BulkStageUpdate[] = selectedScenes.map((s) => ({
  sceneUuid: s.uuid,
  stage,
  value: !s[stage],
  completedBy: stage === 'done' && !s.done ? currentUser?.name : undefined,
  completedAt: stage === 'done' && !s.done ? new Date().toISOString() : undefined,
}));
await runBulkOp('stage-toggle', updates.map((u) => u.sceneUuid),
  () => window.electronAPI.supabaseBulkUpdateSceneStages(updates, currentUser?.id),
  { targetStage: stage },
);
```

**주의: 낙관적 헬퍼 호출 금지 (일괄 경로 내부)**
- `deleteSceneOptimistic`, `toggleSceneStage`(store), `updateSceneFieldOptimistic`, `updateSceneCompletionMeta` **호출 제거**.
- 단일 경로에서는 그대로 유지.

### 5.4a 선택 ID 해석 — "all" 부서 모드 처리

`selectedDepartment === 'all'` 일 때 `selectedSceneIds`는 접두사 붙은 합성 키를 포함한다 (`"bg:<uuid>"`, `"act:<uuid>"`, 또는 mergedKey). 일괄 작업 진입 시:

```typescript
// 유틸: 선택 ID → 실제 scene UUID 배열
function resolveSelectedUuids(
  selectedIds: Set<string>,
  allMergedScenes: MergedScene[],
): string[] {
  const uuids: string[] = [];
  for (const id of selectedIds) {
    if (id.startsWith(MERGED_KEY_PREFIX.bg)) uuids.push(id.slice(MERGED_KEY_PREFIX.bg.length));
    else if (id.startsWith(MERGED_KEY_PREFIX.act)) uuids.push(id.slice(MERGED_KEY_PREFIX.act.length));
    else {
      // merged key: bg/act 둘 다 존재할 수 있음
      const merged = allMergedScenes.find((m) => m.key === id);
      if (merged?.bgScene) uuids.push(merged.bgScene.uuid);
      if (merged?.actScene) uuids.push(merged.actScene.uuid);
    }
  }
  return uuids;
}
```

**Pending 시각 매칭 규칙** (§5.6 참조):
- `UnifiedSceneCard`는 merged scene 단위로 렌더됨 (BG+ACT 한 카드).
- `activeOp.pendingSceneUuids.has(merged.bgScene?.uuid) || has(merged.actScene?.uuid)` 중 하나라도 pending이면 **해당 방향 셀만** 반투명 처리.
- 카드 전체 반투명은 "delete" 또는 "field-edit" kind일 때.

### 5.5 Realtime 수신 연결 (App.tsx:676-750)

**수정 필요 경로 2개:**

**(A) scenes UPDATE** (기존 delta 경로 — 현재 `extractSceneDelta` 사용):
```typescript
if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
  const delta = extractSceneDelta(payload.new);
  if (delta) {
    const applied = useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
    // 신규: idempotent markConfirmed
    useBulkOperationsStore.getState().markConfirmed(delta.uuid);
    if (applied) return;
  }
}
```

**(B) scenes DELETE** (현재 debounced full reload로 처리 — 신규 빠른 경로 추가):
```typescript
if (table === 'scenes' && payload?.eventType === 'DELETE') {
  // Supabase 기본: DELETE payload.old에는 primary key(id)만 포함됨.
  // 컬럼명은 `id` (realtimeDelta.ts의 extractSceneDelta도 row.id 사용).
  const deletedId = (payload?.old as { id?: string } | undefined)?.id;
  if (typeof deletedId === 'string') {
    useDataStore.getState().removeSceneByUuid(deletedId);  // 신규 store 액션
    useBulkOperationsStore.getState().markConfirmed(deletedId);  // idempotent
    return;  // debounced reload 생략
  }
  // deletedId 없으면 → 안전하게 기존 debounced reload로 폴백
}
```

**REPLICA IDENTITY 주의:**
- Supabase 기본 Postgres 설정에서 DELETE payload에 primary key(`id`)는 보장되어 포함됨.
- 만약 운영 중 `scenes` 테이블이 `REPLICA IDENTITY DEFAULT`가 아닌 값으로 변경되어 `payload.old.id`가 undefined로 오면, 위 코드는 fallthrough → 기존 debounced reload로 복구. 즉 **fail-safe**.
- 프리 체크: Supabase SQL Editor에서 `SELECT relname, relreplident FROM pg_class WHERE relname = 'scenes';` 로 `d` (default) 확인. 구현 전 검증 권장.

**happy path 이중 확정**:
- IPC 응답이 먼저 도착: `markConfirmed` → pending Set에서 제거 → Realtime 에코가 이후 도착해도 no-op.
- Realtime 에코가 먼저 도착: 동일 — 먼저 도착한 쪽이 확정.
- `activeOp === null` (사용자가 창 닫음 등): 모든 호출 no-op.

### 5.6 시각 효과 — Pending + 실패

**CSS 유틸 (Tailwind 확장 or `src/index.css`)**:
```css
@keyframes bflow-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.32; }
}
.bflow-pending-cell, .bflow-pending-card {
  animation: bflow-pulse 1.2s ease-in-out infinite;
  pointer-events: none;  /* pending 중 재클릭 방지 */
}
.bflow-pending-failed {
  opacity: 0.7;
  outline: 1.5px solid rgb(239, 68, 68);
  outline-offset: -1px;
  position: relative;
}
.bflow-pending-failed::after {
  content: '!';
  position: absolute; top: 2px; right: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: rgb(239, 68, 68); color: white;
  font-size: 10px; display: flex; align-items: center; justify-content: center;
}
```

**적용 지점**:

| 위치 | 조건 | 클래스 |
|------|------|--------|
| `UnifiedSceneCard` 루트 div | `activeOp?.kind in ('delete','field-edit')` AND 해당 카드의 bg/act uuid 중 하나가 pending | `bflow-pending-card` |
| Stage 셀 (LO/완료/검수/PNG) | `activeOp?.kind === 'stage-toggle'` AND `activeOp.targetStage === thisStage` AND 해당 셀의 scene uuid가 pending | `bflow-pending-cell` |
| 위 둘 중 하나에서 `failedItems`에 해당 uuid 포함 | — | `bflow-pending-failed` (pending 클래스 대체) |

**"all" 모드 처리** (§5.4a 참조):
- Merged card에서 bg uuid만 pending이면 해당 카드의 **bg 측 레이아웃**만 반투명 (act 측은 정상).
- 구현: `UnifiedSceneCard`가 bg/act 각각 별도 서브 영역을 가지므로, 서브 영역에 class 주입.

### 5.7 신규 컴포넌트 — `BulkOperationStatus`

**위치**: `src/components/scenes/BulkOperationStatus.tsx`

- 하단 중앙 고정 floating card (선택 바 **바로 위**, 기존 Sonner toast 스택과 시각 충돌 방지를 위해 **Sonner는 `error` 외 메시지를 해당 작업 중 숨김** — §10 참조).
- 상태별 표시:
  - `in-flight`: 스피너 + "N개 중 M개 처리 중" + [취소] 버튼. 5초 초과 시 "네트워크가 느려요" 추가.
  - `partial-fail`: 빨간 "!" + "(N-M)개 완료 · M개 실패" + [다시 시도] [닫기] 버튼 + 실패 목록 확장 토글.
  - `network-error`: "연결 끊김" + [다시 시도] [닫기].
  - `complete`: 녹색 "✓" + "N개 처리 완료" + 2초 후 fade-out.
  - `cancelled`: 회색 "처리 중단됨" + 즉시 fade-out.
- 펼침 상세: 실패 항목 리스트 (씬 번호 + 이유 텍스트).

### 5.8 커스텀 확인 다이얼로그

기존 `window.confirm` (ScenesView.tsx:3846)는 시스템 UI라 테마 불일치 + 테스트 불가 → 앱 내장 모달로 교체.

**컴포넌트**: `src/components/common/ConfirmDialog.tsx` (신규 or 기존이 있으면 재사용).
- Promise 기반 API: `await ConfirmDialog.show({ message, confirmLabel?, cancelLabel? })` → `boolean`.
- Portal로 전역 렌더. 포커스 트랩 포함.

### 5.9 레이턴시 모니터링 (선택)

디버그 목적 로깅 (프로덕션 빌드에서는 비활성):
```typescript
// App.tsx Realtime 수신부
const activeOp = useBulkOperationsStore.getState().activeOp;
if (activeOp && activeOp.pendingSceneUuids.has(delta.uuid)) {
  const latencyMs = Date.now() - activeOp.startedAt;
  console.log(`[App Realtime] latency ${latencyMs}ms for ${delta.uuid}`);
}
```

기존 `[App Realtime]` prefix 준수 (App.tsx:681).

---

## 6. 변경 파일 맵

| 파일 | 변경 종류 | 규모 |
|------|----------|------|
| `electron/supabase.ts` | `bulkUpdateSceneStages` 시그니처 변경, `bulkDeleteScenes`/`bulkUpdateSceneFields` 신규, `updateSceneStageWithMeta` 내부 헬퍼 | 중 |
| `electron/main.ts` | IPC 핸들러 2개 신규 + 1개 반환 타입 변경 | 소 |
| `electron/preload.ts` | IPC 노출 추가 (3개) | 소 |
| `src/services/supabaseService.ts` | 신규 함수 바인딩 + 타입 export (`BulkUpdateResult`, `BulkStageUpdate`) | 소 |
| `src/stores/useBulkOperationsStore.ts` | **신규** | 중 |
| `src/stores/useDataStore.ts` | `removeSceneByUuid(uuid)` 신규 액션 | 소 |
| `DEVLOG/supabase-init.sql` | 3개 RPC 함수 CREATE OR REPLACE 블록 추가 (§5.1.0) | 중 |
| `src/App.tsx` | Realtime UPDATE/DELETE 핸들러 분기 추가 + `markConfirmed` 훅인 | 소 |
| `src/views/ScenesView.tsx` | 일괄 경로 4곳 교체 + `bulkToggleForSheet`/`bulkToggleResolvedForSheet` 리팩터 (낙관적+롤백 → runBulkOp) + `window.confirm` → `ConfirmDialog` | 중 |
| `src/views/ScenesView.utils.ts` (or 적절 위치) | `runBulkOp`, `resolveSelectedUuids` 헬퍼 | 소 |
| `src/components/scenes/UnifiedSceneCard.tsx` | pending 상태 클래스 적용 분기 | 소 |
| `src/components/scenes/BulkOperationStatus.tsx` | **신규** | 중 |
| `src/components/common/ConfirmDialog.tsx` | 신규 (없으면) | 소 |
| `src/index.css` (or Tailwind config) | pending/펄스/실패 애니메이션 정의 | 소 |

**안 건드리는 곳 (안정성 경계):**
- DB 스키마 (`scenes` 테이블 구조 변경 없음)
- Realtime 기본 구독 구조 (`electron/realtime.ts`)
- 단일 항목 처리 경로 (`toggleSceneStage`, `deleteSceneOptimistic`, `updateSceneFieldOptimistic`가 **1곳에서만** 호출되는 단일 클릭 지점)
- 개인 일정/메모/레이아웃/위젯/에피소드

---

## 7. 검증 (Testing)

### 7.1 수동 시나리오 (구현 완료 후 실행)

1. **기본 일괄 삭제** — 10개 선택 → 삭제 확인 → 깜빡임 없이 순차 소실 + "10개 삭제됨" 완료 카드.
2. **기본 일괄 토글 (LO)** — 10개 선택 → LO 클릭 → LO 셀만 반투명 → 순차 채움 → 완료 카드.
3. **혼합 방향 토글** — LO가 일부만 켜진 10개 선택 → LO 클릭 → 일부 on/일부 off 정상 처리.
4. **부분 실패** — 테스트 훅(`BFLOW_FORCE_FAIL_RATE=0.3` 환경변수 or DevTools 명령)으로 30% 실패 강제 → "N-M개 완료 · M개 실패 [다시 시도]" 표시 + 재시도가 실패분만 재전송.
5. **네트워크 끊김** — DevTools Network Offline → 일괄 → 10초 타임아웃 → "연결 끊김" + 재시도 동작.
6. **동시 편집** — 두 기기에서 같은 씬 대상 일괄 작업 + 단일 삭제 충돌 → 충돌 씬만 실패 메시지 + 나머지 정상.
7. **대량 (50개)** — 50개 선택 → LO → 성능 이슈 없이 완료, 카운터 정상.
8. **단일 경로 회귀** — 단일 씬 체크/삭제가 기존과 동일하게 즉시 반영.
9. **취소** — 진행 중 취소 → 상태 카드 즉시 닫힘 + 서버 쪽은 계속 처리 (다음 새로고침 시 확인).
10. **중첩 차단** — 일괄 작업 중 하단 바가 비활성화 & 단일 클릭은 계속 가능.
11. **"all" 모드** — 통합 부서 뷰에서 bg/act 혼합 선택 → 각 방향별 pending 표시 정상.
12. **완료 메타** — LO→완료 토글 시 `completed_by`/`completed_at`이 DB에 일괄 반영, 다른 세션 Realtime에도 즉시 표시.

### 7.2 테스트 훅 사양

**환경 변수**: `BFLOW_FORCE_FAIL_RATE=0.0~1.0`
- `electron/supabase.ts`의 `updateSceneStageWithMeta`/`deleteScene`/등에서 `Math.random() < rate`이면 강제 throw.
- 프로덕션 빌드에서는 해당 코드 경로 비활성 (dev 한정).

### 7.3 회귀 방지 체크

- `tsc --noEmit` + `vite build` 통과
- 단일 클릭 경로 회귀 없는지 diff 재검토
- `updateSceneCompletionMeta` 개별 호출이 **완전히 제거**되었는지 확인 (grep — RPC가 대체)
- `bulkUpdateCells` 호출 지점이 0이 되는지 (grep) — 남아있으면 구 경로가 조용히 같이 실행됨
- `supabase.rpc('bulk_update_scene_stages', ...)` 3종 호출이 실제 성공하는지 (SQL 배포 누락 시 runtime에 "function does not exist" 에러 — 배포 순서 §5.1.0 준수)

### 7.4 사전 DB 검증

구현 착수 전 Supabase에서:
```sql
SELECT relname, relreplident FROM pg_class WHERE relname = 'scenes';
-- 기대: relreplident = 'd' (default, primary key only)
```
`d` 또는 `f`(full) 어느 쪽이어도 `payload.old.id`는 정상 전달. 혹시 `n`(nothing)이면 DELETE payload 비어있으므로 fail-safe fallback(debounced reload)이 작동함을 확인.

---

## 8. 구현 결정 고정 사항

| 항목 | 결정 |
|------|------|
| 삭제 확인 모달 임계값 | **2개 이상 모두** (실수 비용 높음, 단순성 우선) |
| 확인 모달 형태 | **커스텀 ConfirmDialog** (window.confirm 교체) |
| 실패 재시도 | 수동 클릭만 (자동 재시도 없음) |
| 상태 카드 위치 | 하단 중앙 (선택 바 바로 위) |
| Pending opacity | 0.5 (펄스 시 0.32) |
| 작업 중첩 | 싱글톤 activeOp, in-flight 동안 하단 바 비활성 |
| 취소 동작 | 서버 요청 중단 X, UI 모니터링만 해제 |
| Sonner toast 간섭 | 일괄 작업 진행 중 정보성 토스트 표시 억제 (에러 토스트는 유지) |
| **서버 처리 방식** | **PostgreSQL RPC 함수 (Pro 플랜 활용)** — 1번 요청 + 원자적 scenes/metadata 갱신 |
| **부분 실패 정책** | RPC 내부 BEGIN/EXCEPTION per-item (best-effort) — 기존 UX 사양 보존 |
| **배포 순서** | SQL 함수 먼저 적용 → 클라이언트 배포 (역순은 runtime 에러) |
| **keep-alive 정리** | 본 PR에 포함 (CLAUDE.md + DEVLOG 문서 두 군데 업데이트) |

---

## 9. 작업 규모 예측

- **SQL RPC 함수 작성 + Supabase 적용 + 테스트**: 0.5일 (§5.1.0)
- 백엔드(supabase.ts — RPC 호출로 전환, main.ts, preload) + 타입 정의: 0.5일
- `useBulkOperationsStore` + idempotency 테스트: 0.5일
- ScenesView 4개 경로 교체 + helper 추출: 1일
- Realtime 핸들러 수정 + `removeSceneByUuid`: 0.5일
- `BulkOperationStatus` + `ConfirmDialog` + CSS: 0.5일
- keep-alive 워크어라운드 제거 + 문서 정리: 0.25일
- 수동 검증 + 사용자 피드백 반영: 0.5~1일
- **총: 4~5일**

---

## 10. 롤백 전략

- 이 변경은 **일괄 경로 교체** 위주. 단일 경로 무변경.
- 문제 발생 시 단일 PR 단독 revert로 복구 가능.
- DB 스키마 변경 없음 (테이블 구조 그대로, 함수만 추가) → 데이터 복구 시나리오 불필요.
- RPC 함수는 `CREATE OR REPLACE` 이므로 기존 함수 덮어쓰기 걱정 없음. PR revert 시 함수는 DB에 남아있지만 미사용 상태이므로 무해 (원하면 DROP FUNCTION 수동 실행).
- **Pro 플랜 일일 백업**: 심각한 데이터 손실 시 Supabase 대시보드에서 하루 전 스냅샷 복구 가능.
- 만약 `BulkOperationStatus`만 문제면 해당 컴포넌트 숨김 + 기존 Sonner 토스트 경로 임시 부활 가능 (2단 방어).

---

## 11. 부수 작업 — keep-alive 워크어라운드 제거

Pro 플랜은 7일 자동 정지가 없으므로 관련 문서·코드 정리:

- **CLAUDE.md L48**: "Supabase 무료 플랜: 7일 미사용 시 자동 정지 — 연휴 시 keep-alive 필요" 줄 삭제.
- **DEVLOG/supabase-migration-plan.md**: keep-alive 관련 문단 제거 또는 "Pro 플랜 전환으로 해소" 각주 추가.
- **코드 영향**: 확인 결과 keep-alive 로직이 코드에 **이미 구현되어 있지 않음** (수동 대응 전제였음) → 코드 변경 불필요.

이 정리는 선택 사항이며 본 PR에 같이 포함하면 프로젝트 문서 일관성이 개선됨.

---

*작성: Claude × 한솔*
