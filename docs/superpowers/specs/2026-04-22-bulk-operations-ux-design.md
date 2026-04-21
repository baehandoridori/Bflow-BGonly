# 다중 선택 일괄 작업 UX 재설계 — Hybrid Server-Authoritative

- 작성일: 2026-04-22
- 브랜치: `claude/determined-herschel-236409`
- 대상 범위: 씬 뷰(카드/시트)의 일괄 삭제·일괄 단계 토글·일괄 편집 경로, Realtime 수신 로직, 메인 프로세스 배치 핸들러
- PR 단위: **단일 PR** (사용자 결정)

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
│  → 이유: 고빈도·저위험·로컬 느낌 필수                           │
│                                                             │
│ 다중 항목 변경 (selectedSceneIds.size >= 2)                  │
│  → Server-first + 서버 응답 기반 순차 UI 반영                  │
│  → 이유: 저빈도·고위험·확정감 중요, 사용자가 "다중 모드"를      │
│    의도적으로 활성화한 맥락이므로 소폭 대기 납득 가능             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 왜 🅰️ 하이브리드인가 (대안 기각 근거)

| 대안 | 기각 사유 |
|------|----------|
| **현행 낙관적 유지 + 토스트 개선** | 깜빡임 자체가 사라지지 않음 (증상 B 미해결) |
| **🅱️ 전면 pessimistic** | 단일 클릭 체감 속도 저하 — 씬 체크는 "로컬 행동" 느낌 필수 |
| **🅲 CRDT (Yjs)** | 데이터 레이어 재작성급 대규모 리팩터, 현 단계 오버킬 |
| **🅳 자동 롤백 제거** | 속도는 유지되나 "UI ≠ 서버" 상태가 길어질 수 있어 데이터 무결성 리스크 |

🅰️는 **영향 범위를 "일괄 경로 하나"로 국소화**하면서 B·E·A를 **구조적으로** 해결한다 (사후 완화가 아닌 원인 제거).

---

## 3. UX 사양

### 3.1 일괄 삭제 플로우

```
[T0] 사용자 10개 선택 → 하단 바 "삭제" 클릭
[T0] 확인 모달 표시: "10개 삭제하시겠습니까?"
[T1] "확인" 클릭
      ↓
[T1] 선택된 10개 카드에 "반투명 50% + 미세 펄스" 적용 (처리 중 상태)
[T1] 하단 상태 카드 등장: "10개 삭제 중 · 0/10 완료"
[T1] 서버에 10건 병렬 요청 (Promise.allSettled 유지)
      ↓
[T1+δ] 서버 응답 도착 → Realtime DELETE 이벤트 수신
[T1+δ] 해당 uuid의 카드가 fade-out 후 DOM에서 제거됨
[T1+δ] 상태 카드 카운터 갱신: "10개 삭제 중 · 3/10 완료"
      ↓
[T_done] 전부 완료 → 상태 카드가 "10개 삭제됨 ✓"로 2초간 표시 후 사라짐
        실패 있으면: "8개 완료 · 2개 실패 [다시 시도]" 유지
```

**핵심:**
- 낙관적 즉시 제거 없음. Realtime DELETE 에코가 도착해야 제거.
- 처리 중 상태(반투명)는 "액션 수신됨" 피드백 역할.
- 부분 실패 항목은 반투명 상태로 남고 빨간 "!" 배지 표시.

### 3.2 일괄 단계 토글 (LO/완료/검수/PNG) 플로우

```
[T0] 10개 선택 → 하단 바 "LO" 클릭 (확인창 없음 — 되돌리기 쉬움)
      ↓
[T1] 선택된 10개 카드의 "LO 칸만" 반투명 + 펄스 (전체 카드가 아닌 해당 단계 셀)
[T1] 하단 상태 카드: "10개 LO 처리 중 · 0/10 완료"
[T1] 서버에 10건 병렬 요청 (bulkUpdateSceneStages)
      ↓
[T1+δ] 서버 응답 + Realtime UPDATE 수신 → 해당 LO 칸이 "스르륵 채워짐" 애니메이션
[T1+δ] 상태 카드 카운터 갱신
      ↓
[T_done] 완료 상태 카드 2초 표시 후 사라짐
```

**삭제와 차이:**
- 확인 모달 없음.
- 반투명 처리 범위는 **단일 stage cell**로 국한 (카드 전체가 아님).
- 완료 시 제거가 아니라 "채워짐" 애니메이션.

### 3.3 일괄 편집 (담당자·메모·레이아웃ID) 플로우

기존 일괄 편집 모달은 유지. 모달 "적용" 이후:
- 선택된 항목 전체가 반투명 상태
- 하단 상태 카드 "N개 편집 중"
- Realtime UPDATE 수신 순으로 정상 표시 복귀
- 실패 시 "다시 시도"

---

## 4. 예외 처리 사양

### 4.1 네트워크 지연 (5초 이상)
- 상태 카드 하단에 "네트워크가 느려요" 부연 표시.
- 대기 계속. 사용자가 "취소" 버튼 누르면 진행 중인 작업 **추가 요청 중단** (이미 전송된 건은 서버 응답 대기).

### 4.2 네트워크 끊김 (10초 타임아웃)
- 타임아웃 도달 시 상태 카드 "연결 끊김 — 다시 시도해주세요" + 재시도 버튼.
- 반투명 상태 해제 → 원상 복귀 (이건 "깜빡임 아님" — 실패 원인이 명시적이라 혼란 없음).
- 재시도 시 실패한 항목만 재전송.

### 4.3 동시 편집 충돌
- 사용자 A가 씬 5를 일괄 LO 중인데 사용자 B가 씬 5 삭제:
  - A의 화면: 씬 5 LO 칸 반투명 → 서버 응답 "not found" → Realtime DELETE 이벤트로 씬 5 자체 제거
  - 상태 카드: "씬 5는 다른 사용자에 의해 삭제됨" 개별 안내
  - 나머지 9개는 정상 처리

### 4.4 부분 실패
- 서버 응답이 항목별 성공/실패를 포함 (§5 참조)
- 실패 항목: 반투명 유지 + 빨간 "!" 배지 + 호버 시 실패 이유 툴팁
- 상태 카드: "8개 완료 · 2개 실패 [다시 시도]"
- 재시도 클릭 → 실패한 uuid만 재전송

### 4.5 경계 케이스
- **사용자가 처리 중 창을 닫거나 새로고침**: 이미 서버에 전송된 요청은 계속 처리됨 → 다음 로드 시 Realtime/fetch로 최종 상태 반영. UI 상태는 리셋.
- **Realtime 연결 끊어진 상태에서 일괄 작업**: 서버 응답만으로 UI 반영 (Realtime 에코 대신 IPC 응답 결과 사용). Realtime 복구 시 재동기화.

---

## 5. 구현 사양

### 5.1 백엔드 — 항목별 결과 노출 (가장 중요)

**현재** ([electron/supabase.ts:479-497]):
```typescript
export async function bulkUpdateSceneStages(updates, updatedBy): Promise<void> {
  const results = await Promise.allSettled(
    updates.map((u) => updateSceneStage(u.sceneUuid, u.stage, u.value, updatedBy)),
  );
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    throw new Error(`${total}개 중 ${failedCount}개 업데이트 실패: ${firstReason}`);
  }
}
```

**변경 후** — 항목별 결과 배열 반환:
```typescript
export type BulkUpdateResult = {
  sceneUuid: string;
  stage: string;
  success: boolean;
  error?: string;  // 실패 시에만
};

export async function bulkUpdateSceneStages(
  updates, updatedBy
): Promise<BulkUpdateResult[]> {
  const results = await Promise.allSettled(
    updates.map((u) => updateSceneStage(u.sceneUuid, u.stage, u.value, updatedBy)),
  );
  return updates.map((u, i) => {
    const r = results[i];
    return {
      sceneUuid: u.sceneUuid,
      stage: u.stage,
      success: r.status === 'fulfilled',
      error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
    };
  });
}
```

**동일한 방식으로 변경할 함수들:**
- `bulkDeleteScenes` (신규 — 현재는 개별 호출 반복, 일괄 핸들러 신설)
- `bulkUpdateSceneFields` (담당자/메모/레이아웃ID 일괄 편집용)

### 5.2 IPC 레이어

**신규 핸들러** ([electron/main.ts]):
```typescript
ipcMain.handle('supabase:bulk-delete-scenes', wrapIpc(async (_e, sceneUuids, deletedBy) => {
  return await sbBulkDeleteScenes(sceneUuids, deletedBy);
}));
ipcMain.handle('supabase:bulk-update-scene-fields', wrapIpc(async (_e, updates, updatedBy) => {
  return await sbBulkUpdateSceneFields(updates, updatedBy);
}));
```

기존 `supabase:bulk-update-scene-stages` 핸들러는 반환 타입을 `Promise<BulkUpdateResult[]>`로 변경.

### 5.3 렌더러 — 일괄 상태 관리 스토어 신설

**신규 스토어**: `src/stores/useBulkOperationsStore.ts`

```typescript
type PendingOp = {
  id: string;              // 작업 고유 ID (uuid v4)
  kind: 'delete' | 'stage-toggle' | 'field-edit';
  totalCount: number;
  completedCount: number;
  failedItems: Array<{ sceneUuid: string; error: string }>;
  pendingSceneUuids: Set<string>;  // 아직 서버 확정 안 된 uuid들
  startedAt: number;
  status: 'in-flight' | 'complete' | 'partial-fail' | 'network-error';
  // 토글·편집 한정
  targetStage?: Stage;
  fieldChanges?: Partial<Scene>;
};

interface BulkOperationsStore {
  activeOp: PendingOp | null;
  startOp(op: Omit<PendingOp, 'completedCount' | 'failedItems' | 'startedAt' | 'status'>): void;
  markConfirmed(sceneUuid: string): void;  // Realtime 에코 or IPC 응답으로 1건 확정
  markFailed(sceneUuid: string, error: string): void;
  retryFailed(): Promise<void>;
  cancel(): void;
  clear(): void;
}
```

**pendingSceneUuids 용도**: 각 씬 카드·스테이지 셀이 이 Set을 참조해 "반투명 여부" 결정.

### 5.4 ScenesView.tsx — 일괄 경로 수정

**영향 함수** (현재 위치 기준):
- `handleBulkToggle()` ([ScenesView.tsx:2296-2312])
- `bulkToggleForSheet()` / `bulkToggleResolvedForSheet()` ([2159-2293])
- 일괄 삭제 블록 ([3844-3911])
- 일괄 편집 모달 제출 ([3955-4032])

**수정 패턴** (공통):
```typescript
// Before (예: 일괄 삭제):
selectedScenes.forEach((uuid) => deleteSceneOptimistic(uuid));  // 낙관적 즉시 제거
await batchActions.deleteSceneByUuid(...);  // 서버 호출
// → 실패 시 롤백

// After:
useBulkOperationsStore.getState().startOp({
  id: crypto.randomUUID(),
  kind: 'delete',
  totalCount: selectedScenes.length,
  pendingSceneUuids: new Set(selectedScenes.map(s => s.uuid)),
});
const results = await window.electronAPI.supabaseBulkDeleteScenes(
  selectedScenes.map(s => s.uuid),
  currentUser?.id
);
// Realtime DELETE 에코가 도착하면서 markConfirmed 호출됨
// IPC 응답의 실패 항목은 즉시 markFailed
results.forEach(r => {
  if (!r.success) useBulkOperationsStore.getState().markFailed(r.sceneUuid, r.error);
});
```

**주의:** 낙관적 호출(`deleteSceneOptimistic`, `toggleSceneStage`, `updateSceneFieldOptimistic`)은 일괄 경로에서 **호출하지 않음**. 단일 경로에서는 그대로 호출.

### 5.5 Realtime 수신 → 확정 처리 연결

**수정 위치**: `src/App.tsx` Realtime 이벤트 핸들러 ([App.tsx:676-750]).

```typescript
// scenes UPDATE 수신 시
if (table === 'scenes' && payload.eventType === 'UPDATE') {
  const delta = extractSceneDelta(payload.new);
  if (delta) {
    useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
    // 신규:
    useBulkOperationsStore.getState().markConfirmed(delta.uuid);
  }
}

// scenes DELETE 수신 시 (현재는 300ms 디바운스 + full reload)
// 신규: 일괄 삭제 진행 중인 경우는 즉시 처리
if (table === 'scenes' && payload.eventType === 'DELETE') {
  const activeOp = useBulkOperationsStore.getState().activeOp;
  if (activeOp?.kind === 'delete' && payload.old?.uuid) {
    useDataStore.getState().removeSceneByUuid(payload.old.uuid);  // 즉시 제거
    useBulkOperationsStore.getState().markConfirmed(payload.old.uuid);
  } else {
    scheduleDebouncedReload();  // 기존 경로
  }
}
```

**신규 스토어 함수 필요:** `useDataStore.removeSceneByUuid(uuid)`.

### 5.6 시각 효과 — 반투명 + 펄스

**신규 CSS 유틸** (`src/index.css` 또는 Tailwind plugin):
```css
.bflow-pending-cell {
  opacity: 0.5;
  animation: bflow-pulse 1.2s ease-in-out infinite;
}
.bflow-pending-card { opacity: 0.5; }
.bflow-pending-failed {
  opacity: 0.7;
  outline: 1px solid rgb(239, 68, 68);  /* red-500 */
}
@keyframes bflow-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.35; }
}
```

**적용 지점:**
- `UnifiedSceneCard` 래퍼 div: `activeOp.pendingSceneUuids.has(scene.uuid)`면 `bflow-pending-card` 추가 (삭제·필드 편집 시)
- 스테이지 셀 컴포넌트: `activeOp.kind === 'stage-toggle' && pendingSceneUuids.has(uuid) && activeOp.targetStage === thisStage`면 `bflow-pending-cell` 추가 (토글 시)

### 5.7 신규 컴포넌트 — BulkOperationStatus

**위치**: `src/components/scenes/BulkOperationStatus.tsx` (신규)

- Sonner toast 대신 **고정 위치 floating card** (하단 중앙, 하단 셀렉션 바 위)
- 상태별 표시:
  - `in-flight`: 회전 스피너 + "N개 중 M개 처리 중" + "취소" 버튼
  - `partial-fail`: 빨간 "!" + "N개 완료, M개 실패" + "다시 시도" 버튼 + 닫기
  - `network-error`: "연결 끊김" + "다시 시도" 버튼 + 닫기
  - `complete`: 녹색 "✓" + 2초 후 자동 사라짐 (fade-out)
- 펼침 상세: 실패 항목 리스트 (씬 번호 + 이유)

### 5.8 레이턴시 모니터링 (선택)

디버그 목적으로 Realtime 도착 시간 로깅 추가:
```typescript
// App.tsx Realtime 수신부
const receivedAt = Date.now();
const sentAt = useBulkOperationsStore.getState().activeOp?.startedAt;
if (sentAt) {
  console.debug('[Realtime latency]', receivedAt - sentAt, 'ms for', delta.uuid);
}
```

프로덕션 빌드에서는 `console.debug` 비활성(기존 vite config 확인 필요).

---

## 6. 변경 파일 맵

| 파일 | 변경 종류 | 규모 |
|------|----------|------|
| `electron/supabase.ts` | `bulkUpdateSceneStages` 시그니처 변경, `bulkDeleteScenes`/`bulkUpdateSceneFields` 신규 | 중 |
| `electron/main.ts` | IPC 핸들러 2개 신규 + 1개 반환 타입 변경 | 소 |
| `electron/preload.ts` | IPC 노출 추가 | 소 |
| `src/services/supabaseService.ts` | 신규 함수 바인딩 + 타입 export | 소 |
| `src/stores/useBulkOperationsStore.ts` | **신규** | 중 |
| `src/stores/useDataStore.ts` | `removeSceneByUuid` 신규 | 소 |
| `src/App.tsx` | Realtime 핸들러 분기 추가 | 소 |
| `src/views/ScenesView.tsx` | 일괄 경로 4곳 교체 | 중 |
| `src/components/scenes/UnifiedSceneCard.tsx` | pending 상태 클래스 적용 | 소 |
| `src/components/scenes/BulkOperationStatus.tsx` | **신규** | 중 |
| `src/index.css` (or Tailwind) | pending/펄스 애니메이션 정의 | 소 |

**안 건드리는 곳** (안정성 경계):
- DB 스키마
- Realtime 기본 구독 구조 (`electron/realtime.ts`)
- 단일 항목 처리 경로 (`toggleSceneStage`, `deleteSceneOptimistic`, `updateSceneFieldOptimistic` 1개만 호출하는 호출점)
- 개인 일정/메모/레이아웃/위젯

---

## 7. 검증 (Testing)

### 7.1 직접 확인 시나리오

1. **기본 일괄 삭제** — 10개 선택 → 삭제 → 깜빡임 없이 순차 소실 + 완료 토스트.
2. **기본 일괄 토글** — 10개 선택 → LO 클릭 → 깜빡임 없이 셀 순차 채움.
3. **부분 실패 시뮬레이션** — DevTools로 일부 IPC 응답 강제 실패 → "N개 완료 / M개 실패" 표시 + 재시도 동작.
4. **네트워크 끊김** — DevTools Network → Offline → 일괄 작업 → 10초 타임아웃 → "연결 끊김" 메시지 + 재시도.
5. **동시 편집** — 두 기기에서 같은 씬을 서로 다른 방식으로 수정 → 충돌 메시지 + 나머지 정상.
6. **큰 배치** — 50개 선택 → 일괄 LO → 상태 카드 카운터 정상 갱신 + 성능 이슈 없음.
7. **단일 경로 비변경 확인** — 단일 씬 체크/삭제가 기존과 동일하게 즉시 반영되는지.
8. **사용자 취소** — 처리 중 "취소" 클릭 → 이미 전송된 건은 처리되지만 UI 상태 해제.

### 7.2 회귀 방지 체크

- `tsc --noEmit` + `vite build` 통과
- 기존 단일 클릭 경로가 변경되지 않았는지 (diff 상 변경 함수 재검토)
- Realtime 연결 끊긴 상태에서도 일괄 작업이 IPC 응답만으로 완결되는지

### 7.3 회피된 리스크

- **인덱스 재해석 버그 재발 방지**: 모든 일괄 경로는 UUID를 **낙관적 변경 전에 캡처** (§ tasks/lessons.md 2026-04-20 참조). 본 설계에서는 애초에 낙관적 제거/수정을 안 하므로 자연스럽게 회피됨.
- **Realtime 누락**: Realtime이 끊긴 상태에서도 IPC 응답 결과(`BulkUpdateResult[]`)만으로 `markConfirmed`·`markFailed`가 호출되므로 정상 동작.

---

## 8. 오픈 결정 사항 (구현 시 확정)

1. **확인 모달 임계값**: 삭제 2개도 확인할지, 5개 이상만 확인할지.
   - 초안: 모든 일괄 삭제 확인 (실수 비용 높음).
2. **실패 재시도 횟수 제한**: 무한 재시도 허용할지 3회 제한할지.
   - 초안: 사용자 수동 클릭만 — 자동 재시도 없음.
3. **상태 카드 위치**: 하단 중앙 vs 오른쪽 하단 토스트 스택.
   - 초안: 하단 중앙 (선택 바 바로 위, 시선 이동 최소화).
4. **pending 스타일 강도**: opacity 0.5가 너무 강한지.
   - 초안: 0.5로 시작 후 사용자 피드백으로 조정.

---

## 9. 작업 규모 예측

- 구현: 1.5~2일
- 수동 검증: 반나절
- 사용자 피드백 반영 조정: 0.5일 예비
- 총: **2~3일**

---

## 10. 롤백 전략

- 이 변경은 **일괄 경로 교체** 위주. 단일 경로는 무변경.
- 문제 발생 시 해당 PR 단독 revert로 복구 가능.
- 데이터 마이그레이션 없음 → DB 복구 시나리오 불필요.

---

*작성: Claude × 한솔*
