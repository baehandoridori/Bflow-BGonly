# 액팅 씬 단계 토글 + 검수자 멘션 알림 — 설계 문서

> **작성일**: 2026-05-11
> **대상 버전**: v1.25.0 (잠정)
> **상태**: 설계 확정, 구현 준비
> **mockups**:
> - 인터랙션 시안: [`docs/mockups/2026-05-11-acting-toggle-q1-interaction.html`](../../mockups/2026-05-11-acting-toggle-q1-interaction.html) (옵션 A 칩 4개 라디오)
> - "단계" 구조 확인: [`docs/mockups/2026-05-11-acting-toggle-q6-stage-structure.html`](../../mockups/2026-05-11-acting-toggle-q6-stage-structure.html)
> - 피드백 확인 모달: [`docs/mockups/2026-05-11-feedback-confirm-modal.html`](../../mockups/2026-05-11-feedback-confirm-modal.html)
> **선행**: v1.18.0 (컴포지터·리비전 멘션 패턴), v1.24.0 (댓글 자동 알림·점프 패턴)

---

## 1. 배경과 목표

### 현재 상태

액팅 씬은 BG와 동일하게 `lo / done / review / png` boolean 4 컬럼 토글을 쓰고 있고, 부서 설정(`DEPARTMENT_CONFIGS.acting.stageLabels`)을 통해 라벨만 "1원화 / 2원화 / 동화 / 최종"으로 다르게 표시한다. 검수 요청·피드백 흐름이 데이터에 명시되어 있지 않고, 검수자 멘션·알림 시스템(현재 컴포지터·리비전에서만 작동)도 액팅 작업 단계에는 연결되어 있지 않다.

### 문제점

1. **검수 흐름이 토글에 없음** — 액팅 1원화가 끝났다는 boolean 만 있을 뿐, "검수 요청 중" "검수 완료, 수정 필요" 같은 작업 라운드 정보가 표현되지 않는다.
2. **차수(작업 반복 횟수) 표현 불가** — 한 단계가 3번 반복돼도 4 boolean 으로는 회수를 구분할 수 없다.
3. **검수자(애니메이션 수퍼바이저) 멘션 채널 없음** — 액팅 작업자가 검수를 요청할 때 별도 채널(슬랙·구두)에 의존. BG 컴포지터 리비전과 같은 멘션 자동 알림 시스템이 없다.

### 목표

- 액팅 씬 토글을 **상태(state) + 차수(round)** 모델로 전환해 작업 라운드와 검수 흐름을 데이터로 표현.
- "피드백 대기" 누르는 순간 **잘못 클릭 방지 확인 모달**을 거쳐 액팅 검수자 풀에 자동 멘션·알림.
- 알림 클릭 시 ScenesView 로 점프해 해당 씬 행이 펄스로 강조.
- 코드/데이터 구조는 **부서 무관 일반화** — BG가 향후 같은 시스템으로 합류할 때 마이그레이션 부담 최소.

---

## 2. 결정 사항 요약

| # | 항목 | 결정 |
|---|---|---|
| Q1 | 토글 인터랙션 | **칩 4개 라디오** (대기 / 작업중 / 피드백 대기 / 완료). 활성 칩 안에 차수 ▴▾ |
| Q2 | 차수 증감 | **수동 ▴▾ 가 주력**. 보조로 피드백 대기 → 작업중 갈 때 자동 +1. 한 번 손으로 조정한 값은 자동으로 다시 안 올라감 |
| Q3 | 검수자 풀 관리 | 설정 > 사용자 관리에 "**액팅 검수자**" 섹션 신설. 컴포지터와 **독립적, 동시 겸임 가능** |
| Q4 | 알림 대상 | 액팅 검수자 풀 멤버 **전원** (자기 자신 제외). BG 컴포지터/씬 담당자/등록자 자동 포함 X |
| Q5 | 알림 클릭 시 | ScenesView 로 이동 + **씬 행 펄스 강조만**. 모달/패널 자동 오픈 X |
| Q6 | 모델 구조 | **한 씬 = 1세트의 [상태 + 차수]**. 한 시점에 한 상태만 활성. 단계 4개가 평행 존재하는 구조(시안 A) 아님 |
| Q7 | 기존 데이터 마이그레이션 | 1원화→대기, 2원화→작업중 1차, 동화→피드백 대기 1차, 최종→완료. 체크 없음 → 대기. 기존 boolean 컬럼은 DB 보존(롤백용) |
| Q8 | BG 적용 범위 | **액팅만 먼저**. BG 는 기존 LO/완료/검수/PNG 유지. 코드/DB 는 부서 무관 일반화해 BG 확장 시 부담 최소 |
| Q9 | 피드백 대기 확인 모달 | 카드/시트/상세 모달 어디서 눌러도 모달이 먼저 뜸. 액팅 검수자 풀 전원 기본 체크. 추가 멘션은 **빈 상태 + 검색**으로만 추가. 푸터 3 버튼: 취소 / 알림 없이 상태만 변경 / 알림 보내기 (N명) |

---

## 3. 핵심 사용자 흐름

### 시나리오 A — 작업자가 검수 요청

1. 김아무가 ScenesView 에서 SC_001 의 "작업중 1차" 칩을 보고 있음
2. 1원화 작업 끝나서 "**피드백 대기**" 칩 클릭
3. **확인 모달 등장**:
   - 헤더: "피드백 대기로 보내기"
   - 씬 정보: SC_001 · 작업중 1차 → 피드백 대기 1차
   - 수신자: 액팅 검수자 풀 3명(김감독·박감독·이감독) 모두 기본 체크
4. 김아무가 "**알림 보내기 (3명)**" 클릭
5. 칩이 [피드백 대기 1차] 로 바뀜
6. 3명에게 Windows 토스트 + 인앱 알림 동시 발송

### 시나리오 B — 검수자가 알림 받아 점프

1. 박감독이 Dashboard 작업 중. Windows 우하단 토스트 등장: "EP01 SC_001 — 김아무가 피드백 대기로 보냈습니다"
2. 토스트 클릭
3. BFLOW 활성화 → ScenesView 자동 전환 → SC_001 행으로 스크롤 → 행이 1.6초간 보라색 펄스
4. 박감독이 행 클릭 → 씬 디테일 모달 열고 시안 확인
5. 박감독이 댓글로 "수정 요청 — 키 포즈 다시" 작성
6. 김아무에게 댓글 멘션 알림 (기존 시스템)

### 시나리오 C — 작업자가 피드백 받아 재작업

1. 김아무가 댓글 알림 받음. 박감독 코멘트 확인
2. 칩의 [피드백 대기 1차] 가 활성 상태. 김아무는 [**작업중**] 칩 클릭
3. **자동으로 [작업중 2차]** 로 전환 (피드백 대기 → 작업중이면 +1)
4. 재작업 후 다시 피드백 대기 클릭 → 확인 모달 → 알림 → 박감독 검수
5. 박감독이 OK → 김아무가 [**완료**] 클릭. 차수 사라짐. 작업 종료

### 시나리오 D — 잘못 클릭

1. 작업자가 실수로 피드백 대기 클릭
2. 확인 모달 등장
3. 작업자가 "**취소**" 클릭 → 상태 변경 안 됨, 모달만 닫힘. 알림도 안 감

### 시나리오 E — 알림 없이 상태만 변경

1. 작업자가 자기 작업 정리 차원에서 "피드백 대기" 로 표시하고 싶음
2. 확인 모달에서 "**알림 없이 상태만 변경**" 클릭
3. 칩만 피드백 대기 N차로 바뀜. 누구에게도 알림 안 감

---

## 4. UI — 새 토글 컴포넌트

### 4-1. 모양 (액팅 씬 한 행)

```
SC_001 · 담당 김아무   [ 대기 ] [ 작업중  ▾2차▴ ] [ 피드백 대기 ] [ 완료 ]
                                       ↑ 활성 칩 안에 차수 카운터
```

- 칩 4개가 한 줄. 한 시점에 1개만 활성 (라디오)
- 활성 칩이 **작업중** 또는 **피드백 대기** 일 때만 칩 안쪽에 ▾ N차 ▴ 표시
- ▴ 누르면 +1차 (최소 1, 최대 99). ▾ 누르면 −1차 (1차 미만으로 안 내려감)
- 대기 / 완료 칩에는 차수 표기 없음. 대기 ↔ 완료로 직접 점프할 때 차수는 1로 리셋

### 4-2. 상태 전이 규칙

| 출발 → 도착 | 자동 차수 동작 | 모달 동작 |
|---|---|---|
| 대기 → 작업중 | work_round = 1 로 시작 | 모달 없음 |
| 작업중 → 피드백 대기 | feedback_round = work_round 로 동기화 | **확인 모달 표시** |
| 피드백 대기 → 작업중 | work_round = feedback_round + 1 (자동 +1) | 모달 없음 |
| 작업중 → 완료 | round 모두 0 으로 리셋 (정보는 history 보존) | 모달 없음 |
| 피드백 대기 → 완료 | round 모두 0 으로 리셋 | 모달 없음 (이미 검수 OK 한 셈) |
| 어떤 상태 → 대기 | round 모두 0 으로 리셋 | 모달 없음 |
| 어떤 상태 → 피드백 대기 (직접 점프) | feedback_round = max(1, 기존 round) | **확인 모달 표시** |

> 자동 차수 동작은 한솔님이 ▴▾ 로 수동 조정해 둔 값과 충돌하지 않는다. 즉 수동 조정한 직후 같은 상태 안에서 추가 자동 동작은 일어나지 않으며, 상태가 바뀌어 진입할 때만 위 규칙으로 결정된다.

### 4-3. 렌더링 위치

- ScenesView 카드 뷰의 토글 영역
- ScenesView 시트(셀) 뷰의 토글 영역
- 씬 상세 모달(`UnifiedSceneDetailModal`)의 상단 상태 영역

세 곳 모두 같은 컴포넌트(`<ScenePhaseToggle />`)로 렌더링. 이벤트 핸들러는 공통 훅(`useScenePhaseToggle`)에 모아둠.

### 4-4. 부서 분기

`scene.department === 'acting'` 인 경우에만 새 토글 렌더. BG 씬은 기존 LO/완료/검수/PNG 4 boolean 토글 유지.

---

## 5. UI — 피드백 대기 확인 모달

> mockup: [`docs/mockups/2026-05-11-feedback-confirm-modal.html`](../../mockups/2026-05-11-feedback-confirm-modal.html)

### 5-1. 트리거

작업중/대기/완료 → 피드백 대기로 가는 모든 클릭에서 모달 표시. 모달을 거치지 않으면 상태는 변경되지 않는다.

### 5-2. 구성

| 영역 | 내용 |
|---|---|
| 헤더 | "피드백 대기로 보내기" + 닫기 (×) |
| 씬 정보 | EP·부서 / 씬 ID / 담당 / 상태 변경 화살표 (이전 상태 → 피드백 대기 N차) |
| 수신자 — 액팅 검수자 | 풀에 등록된 전원이 행으로 표시. **전원 기본 체크**. 행 클릭으로 토글. role-tag = "액팅 검수자" |
| 수신자 — 추가 멘션 | **빈 상태로 시작**. "+ 다른 팀원 검색" 버튼만 표시. 클릭 시 사내 사용자 검색 인풋 등장. 선택된 사람은 행으로 추가됨 (취소 가능) |
| 푸터 | 3 버튼 — 취소 / 알림 없이 상태만 변경 / 알림 보내기 (N명) |

### 5-3. 버튼 동작

| 버튼 | 상태 변경 | 알림 발송 |
|---|---|---|
| 취소 | ✗ | ✗ |
| 알림 없이 상태만 변경 | ✓ (피드백 대기 N차로) | ✗ |
| 알림 보내기 (N명) | ✓ | ✓ (선택된 N명에게) |

### 5-4. 컴포넌트

- `<FeedbackRequestModal sceneId targetRound onConfirm onCancel />` — 신규
- 사용자 검색 인풋은 컴포지터 풀에서 쓰이는 패턴(`<UserSearchInput />`) 재사용 또는 동일 구조로 새로 작성
- 같은 모달 컴포넌트가 카드/시트/상세 모달 어디서든 호출됨

---

## 6. UI — 어드민: 액팅 검수자 풀

### 6-1. 위치

설정 > 사용자 관리 (`SettingsView.tsx` 의 사용자 섹션). 기존 "컴포지터" 섹션과 나란히 새 섹션 "**액팅 검수자**" 추가.

### 6-2. 동작

- 컴포지터 섹션과 동일한 패턴 (`<CompositorSection />` 참고)
- 사용자 목록에 체크박스, 어드민이 토글, 저장 버튼
- 한 사람이 컴포지터 + 액팅 검수자 동시 체크 가능 → 양쪽 알림 모두 받음
- 자기 자신을 액팅 검수자로 체크해도 자기 씬의 피드백 알림은 "본인 제외" 룰에 의해 안 받음

### 6-3. 컴포넌트

- `<ActingSupervisorSection />` — 신규 (`CompositorSection.tsx` 패턴 그대로 복제 + 부서 enum 차이만)

---

## 7. 알림 & 점프 흐름

### 7-1. 알림 채널

| 채널 | 표시 | 클릭 동작 |
|---|---|---|
| Windows 네이티브 토스트 | `electron/main.ts` 의 `new Notification()` | 앱 활성화 + 씬으로 점프 |
| 인앱 알림 센터 | 기존 댓글/리비전 알림 동일 위젯 | 클릭 시 씬으로 점프 |

### 7-2. 알림 페이로드

```ts
{
  type: 'acting-feedback-request',
  episodeId, sceneId, sheetName,  // 점프용 식별자
  senderId, senderName,           // 작업자
  fromState, toState,             // 'work' → 'feedback'
  workRound, feedbackRound,
  recipients: string[]            // user_id 배열 (선택된 N명)
}
```

### 7-3. 디스패치

- "알림 보내기" 클릭 → renderer → `supabaseService.dispatchFeedbackNotification(payload)` → IPC → main → Supabase notifications 테이블 insert + Realtime broadcast + Windows 토스트(수신자 OS 활성 시)
- BG 컴포지터 리비전 멘션과 같은 큐 구조 사용 (`electron/notifications.ts`)

### 7-4. 점프 동작

토스트/인앱 알림 클릭 시:

1. `bflow:scene-jump` IPC 이벤트 (이미 있는 deepLink 핸들러 확장 또는 신규 이벤트)
2. `useAppStore.setActiveView('scenes')` 로 ScenesView 강제 전환
3. `useScenesStore.setHighlightSceneId(sceneId)` 로 행 강조 ID 세팅
4. ScenesView 에서 해당 행이 자동 스크롤 + 1.6초 보라색 펄스 (`anim-target-pulse` 기존 CSS 재사용)
5. 모달/패널 자동 오픈은 하지 않음 (사용자 결정)

이미 v1.24.0 의 댓글 점프와 v1.24.4 의 활동 위젯 점프에서 동일 패턴 사용 중. 큐/핸들러 그대로 재활용.

---

## 8. 데이터 모델

### 8-1. scenes 테이블 — 새 컬럼

```sql
ALTER TABLE scenes
  ADD COLUMN scene_state text
    CHECK (scene_state IN ('wait', 'work', 'feedback', 'done')),
  ADD COLUMN work_round int DEFAULT 0,
  ADD COLUMN feedback_round int DEFAULT 0;
```

- 컬럼 이름은 부서 무관 일반화 (`act_state` 아님). BG 합류 시에도 그대로 사용.
- 액팅 씬에만 값 채움. BG 씬은 NULL 유지(이번 PR 한정).
- 기존 `lo / done / review / png` boolean 컬럼은 **삭제하지 않고 보존**.
  - 액팅: 마이그레이션 시 새 컬럼으로 매핑 + 기존 컬럼은 그대로 남김 (롤백용)
  - BG: 기존 컬럼 그대로 사용

### 8-2. users 테이블 — 새 컬럼

```sql
ALTER TABLE users
  ADD COLUMN is_acting_supervisor boolean DEFAULT false;
```

- 기존 `is_compositor` 컬럼은 그대로
- 두 컬럼은 독립적. 동시 true 가능

### 8-3. notifications 테이블 — 새 type 값

기존 알림 큐에 새 `type` 값 추가:
- `acting-feedback-request`

스키마 변경 없음. payload jsonb 만 위 7-2 형식으로 채우면 됨.

---

## 9. 마이그레이션 전략

### 9-1. SQL 스크립트 (`DEVLOG/migrations/2026-05-11-acting-phase-toggle.sql`)

```sql
-- 1. 컬럼 추가 (없으면)
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS scene_state text
    CHECK (scene_state IN ('wait', 'work', 'feedback', 'done')),
  ADD COLUMN IF NOT EXISTS work_round int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_round int DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_acting_supervisor boolean DEFAULT false;

-- 2. 액팅 씬의 기존 boolean → 새 컬럼 1:1 매핑
UPDATE scenes
SET
  scene_state =
    CASE
      WHEN png  = true THEN 'done'
      WHEN review = true THEN 'feedback'
      WHEN done = true THEN 'work'
      WHEN lo   = true THEN 'wait'
      ELSE 'wait'
    END,
  work_round =
    CASE
      WHEN png = true THEN 0
      WHEN done = true OR review = true THEN 1
      ELSE 0
    END,
  feedback_round =
    CASE
      WHEN png = true THEN 0
      WHEN review = true THEN 1
      ELSE 0
    END
WHERE department = 'acting'
  AND scene_state IS NULL;
```

> 위 CASE 는 한솔님이 결정한 "1원화→대기, 2원화→작업중, 동화→피드백 대기, 최종→완료" 1:1 매핑을 보존한 형태다. 위에서부터 우선순위 — png 가 true 면 모두 완료로, 그 다음 review, done, lo 순. 보통 누적 체크라 가장 마지막 단계가 결정한다.

### 9-2. 롤백

- 새 컬럼 3개(`scene_state`, `work_round`, `feedback_round`)와 `users.is_acting_supervisor` DROP
- 기존 boolean 컬럼은 그대로라 데이터 손실 없음

---

## 10. 모듈화 — BG 확장 대비

이번 PR 에서는 액팅만 새 시스템. 그러나 BG 가 나중에 합류할 때 부담 최소가 목표.

### 10-1. 컴포넌트

`<ScenePhaseToggle department="acting" scene={s} />` — props 로 부서를 받음. 내부에서:
- `department === 'acting'` → 새 4상태 칩 토글 + 차수 카운터
- `department === 'bg'` → 기존 4 boolean 토글 (라벨: LO/완료/검수/PNG)

미래에 BG 가 새 시스템으로 갈 때는 이 한 분기만 제거하면 됨.

### 10-2. 데이터 모델

컬럼 이름이 부서 무관 (`scene_state`, `work_round`, `feedback_round`). BG 합류 시 마이그레이션은 동일한 매핑 함수에 BG 컬럼만 추가하면 됨.

### 10-3. 검수자 풀

`users.is_acting_supervisor` 와 `users.is_compositor` 가 부서별 평행 구조. 향후 부서가 더 늘면 같은 패턴(`is_xxx_supervisor`) 컬럼 하나만 추가.

### 10-4. 알림 디스패치

`electron/notifications.ts` 에서 부서 enum 으로 디스패치 분기:

```ts
function getRecipientPool(department, sceneId): UserId[] {
  if (department === 'acting') return await getActingSupervisors();
  if (department === 'bg')     return await getCompositors();  // 기존
}
```

새 부서 추가 시 케이스 하나만 추가.

---

## 11. 변경되는 파일 (개략)

### 신규

| 파일 | 역할 |
|---|---|
| `src/components/scenes/ScenePhaseToggle.tsx` | 부서 무관 토글 컴포넌트 (액팅이면 새 4상태, BG면 기존 4 boolean) |
| `src/components/scenes/FeedbackRequestModal.tsx` | 피드백 대기 확인 모달 |
| `src/components/settings/ActingSupervisorSection.tsx` | 액팅 검수자 풀 관리 UI (CompositorSection 패턴 복제) |
| `src/services/feedbackNotificationService.ts` | 피드백 알림 전송 서비스 |
| `src/utils/scenePhaseMigration.ts` | 기존 boolean → 새 컬럼 매핑 헬퍼 (런타임 fallback용) |
| `DEVLOG/migrations/2026-05-11-acting-phase-toggle.sql` | 마이그레이션 SQL |

### 수정

| 파일 | 변경 내용 |
|---|---|
| `src/types/index.ts` | Scene 타입에 `sceneState`, `workRound`, `feedbackRound` 추가. User 에 `isActingSupervisor` 추가 |
| `src/views/ScenesView.tsx` | 액팅 씬 토글 렌더링을 `<ScenePhaseToggle />` 로 교체. 시트 뷰·카드 뷰 양쪽 |
| `src/components/scenes/UnifiedSceneDetailModal.tsx` | 상태 영역을 같은 토글 컴포넌트로 교체 |
| `src/components/scenes/SceneCard.tsx` | 카드 내 토글을 새 컴포넌트로 |
| `src/components/scenes/SceneSheetView.tsx` | 시트 뷰 토글을 새 컴포넌트로 |
| `src/components/settings/SettingsSidebar.tsx` | 액팅 검수자 섹션 라우트 추가 |
| `src/views/SettingsView.tsx` | ActingSupervisorSection 렌더링 |
| `src/services/userService.ts` | `isActingSupervisor` 필드 처리 |
| `electron/supabase.ts` | scenes 새 컬럼 read/write + users 새 컬럼 처리 + 액팅 검수자 풀 조회 RPC |
| `electron/main.ts` | 피드백 알림 IPC 핸들러 + 씬 점프 deepLink |
| `electron/notifications.ts` | 피드백 알림 디스패치 분기 추가 |
| `src/stores/useDataStore.ts` | 상태 변경 낙관적 업데이트 + 차수 조정 액션 |
| `src/utils/calcStats.ts` | 액팅 진행률 계산을 새 컬럼 기반으로 (BG 는 기존) |

---

## 12. 진행 순서 (구현 단계)

이 spec 승인 후 `writing-plans` 스킬에서 상세 단계별 plan 으로 분해 예정. 개략 순서:

1. **DB 마이그레이션 SQL 작성 + 로컬 검증** — 컬럼 추가, 액팅 데이터 변환, 롤백 시나리오 점검
2. **타입 확장 + 스토어 액션** — Scene/User 타입, useDataStore 의 낙관적 업데이트 액션
3. **`<ScenePhaseToggle />` 컴포넌트 + 차수 +/- 인터랙션** (액팅 분기만 우선)
4. **ScenesView 통합** (카드·시트 양쪽), 상세 모달 통합
5. **어드민 — `<ActingSupervisorSection />`** + supabaseService CRUD
6. **`<FeedbackRequestModal />`** + 사용자 검색 인풋
7. **피드백 알림 디스패치 (renderer → IPC → main → notifications)**
8. **Windows 토스트 + 인앱 알림 + 씬 점프 deepLink**
9. **calcStats 액팅 진행률 계산 수정** (위젯/대시보드 영향 점검)
10. **typecheck + 빌드 + 시나리오 A~E 수동 점검** + 한솔님 사전 테스트

---

## 13. 검증 체크리스트 (배포 전)

- [ ] 액팅 씬 토글이 카드/시트/상세 모달 세 곳 모두에서 동일하게 동작
- [ ] 차수 ▴▾ 이 최소 1 / 최대 99 범위 안에서만
- [ ] 피드백 대기 → 작업중 갈 때 자동 +1 (수동 조정한 직후엔 자동 안 일어남)
- [ ] 피드백 대기 클릭 시 확인 모달이 반드시 먼저 뜸 (모달 우회 경로 없음)
- [ ] 모달 "취소" → 상태 변경 없음
- [ ] 모달 "알림 없이 상태만 변경" → 상태만 바뀌고 알림 없음
- [ ] 모달 "알림 보내기" → 선택된 N명 모두에게 토스트 + 인앱 알림 도착
- [ ] 알림 클릭 시 ScenesView 자동 전환 + 행 펄스
- [ ] 자기 자신 피드백 → 자기 알림 안 옴 (수퍼바이저로 체크되어 있어도)
- [ ] 어드민 화면에서 액팅 검수자 체크/저장 후 풀에 반영
- [ ] 한 사람이 컴포지터 + 액팅 검수자 동시 체크 시 양쪽 알림 모두 받음
- [ ] BG 씬은 기존 LO/완료/검수/PNG 토글 그대로
- [ ] 진행률 위젯·대시보드 액팅 통계가 새 컬럼 기준으로 정상 표시
- [ ] 기존 액팅 boolean 데이터 → 새 상태 매핑 표 대로 변환됨
- [ ] 마이그레이션 SQL 롤백 → 원복 가능

---

## 14. 미해결 / 보류

- **차수 무한 vs 상한**: 현재 99 로 잠정. 운영하면서 너무 많은 차수가 쌓이면 별도 정책 검토.
- **피드백 대기 모달의 "마지막 선택 기억"**: 같은 씬에서 다시 피드백 대기 누를 때 직전 선택 상태를 기억할지. 이번 PR 에서는 매번 디폴트(액팅 검수자 풀 전원). 운영 후 사용 패턴 보고 결정.
- **위젯 영향**: `EpStageBarsWidget`, `EpOverallProgressWidget`, `EpPartDetailWidget` 등 액팅 통계를 쓰는 위젯이 새 컬럼에 맞게 동작하는지는 9번 단계에서 점검.
