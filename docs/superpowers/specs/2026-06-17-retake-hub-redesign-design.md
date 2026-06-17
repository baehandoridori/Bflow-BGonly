# 리테이크 허브 개편 설계 (B flow)

> 작성일: 2026-06-17
> 상태: 설계 확정 (한솔 승인) — 구현 계획(writing-plans) 대기
> 관련 기존 스펙: `2026-05-03-revision-feature-design.md`, `2026-05-04-revision-board-renewal-design.md`, `2026-05-21-compositing-dashboard-design.md`

---

## 1. 배경 / 문제

현재 리테이크(수정요청, 코드상 `revision`)는 컴포지터·책임자급이 수정요청을 등록하면 작업자가 `대기 → 진행중 → 완료`로 처리하는 단순 흐름이다. 두 가지 큰 공백이 있다.

1. **담당자 개념 부재**: 지금은 '알림 받을 사람'(`notify_user_ids`)만 배정된다. 누가 실제로 그 리테이크를 책임지고 작업하는지(담당자)가 데이터에 없다. (`comp_revisions.assignee` 컬럼은 존재하나 미사용.)
2. **감독 최종 리테이크의 흩어짐**: 감독이 최종본을 본 뒤 전체 리테이크를 줄 때, 피드백이 파트별·작업자별로 흩어지고 최종 취합자에게 슬랙 DM·스레드로 들어온다. 이를 B flow 안에서 모아 한곳에서 추적할 수단이 없다.

추가로, 리테이크 항목의 상태 표시·완료 처리가 배지+버튼 방식이라 번거롭고, 메모/리테이크 입력란에서 텍스트 중간에 사용자명을 쳐도 자동완성이 뜨지 않는 등 입력 경험이 일관되지 않다.

## 2. 목표

- 리테이크에 **담당자**를 1차 시민으로 도입하고, `담당 진행 → 담당자 완료 → 최종 완료`로 이어지는 워크플로우를 만든다.
- 감독 최종 리테이크를 모으는 **리테이크 허브(세트 기반)** 를 신설한다.
- 항목 상태/완료를 **인라인(클릭 확장 + opacity 전환)** 으로 가볍게 처리한다.
- 메모·댓글·리테이크 입력 전반에 **타이핑 중 엔티티 자동 감지(멘션/파일경로/씬·컷 번호)** 를 공통 적용한다.

## 3. 비목표 (이번 범위 밖)

- 감독·파트장을 위한 별도 역할(role) 신설. (B flow에는 PD/감독 role이 없고, 권한은 기존 `컴포지터급`으로 매핑한다.)
- 슬랙 등 외부 시스템에서 B flow로의 자동 동기화. (허브는 **B flow 내부 직접 입력** 기준.)
- 세트 마감일(deadline) 기능. (한솔 결정: 이번엔 두지 않음.)
- 리테이크 우선순위(`priority`) 부활. (계속 미사용.)

---

## 4. 핵심 결정 요약 (한솔 확정)

| 항목 | 결정 |
|------|------|
| 담당자 워크플로우 단계 | `대기 → 진행중(확인+진행 통합) → 담당자 완료 → 최종 완료` |
| 다중 담당자 | 담당자별 상태 **개별 추적**, **전원 담당완료 후** 최종 완료 가능 |
| 담당자 지정 방식 | 생성 시 + 카드에서 **둘 다** 가능 (알림 대상 중 일부를 승격) |
| 담당자 재배정 권한 | **요청자 + 컴포지터급** |
| 완료 멘트 | 담당자 완료 누르면 **입력창** 등장 (파일경로 등) |
| 최종 완료 권한 | **요청자 + 컴포지터급** |
| 인라인 완료 UX | 클릭 인라인 확장 + 좌측 색 세로막대 + opacity 전환. 담당 진행=칩, 최종 완료=분리 바 |
| 항목 표현 | **맥락별 둘 다** — 씬 모달·기본 리테이크 탭=카드(시안 A), 허브=그리드 테이블(시안 B) |
| 네이밍 | `re#` (이미 `revisionNoToLabel`이 `re${n}` 반환 — 전 화면 일관화) |
| 허브 위치 | 사이드바 **새 메뉴 '리테이크 허브'** |
| 허브 구조 | `리테이크 세트`(제목 + 에피소드 범위 + 취합자) + 하위 항목 |
| 하위 항목 | **씬별 리테이크와 같은 데이터** (담당 흐름 공유). 씬 미지정 '전반' 항목 허용 |
| 자동 취합 | `파트별 / 담당자별 / 진행상태별 / 에피소드·씬 순` 탭·필터 모두 |
| 세트 완료 | 진행률 바 + 하위 전원 최종완료 시 **자동 완료** |
| 세트 입력 | 취합자가 세트 생성, 파트장·감독이 **각자 항목 추가**. 추가자가 그 자리서 담당 배정 |
| 세트 소속 | 허브에서 생성 시 자동 소속 + **기존 리테이크 가져오기** 가능 |
| 취합자 | **세트마다 지정** (컴포지터급 기본 후보) |
| 엔티티 감지 | `@사용자명`, `파일경로(G:\로 시작하는 것만)`, `씬/컷 번호`. 감지 시 평문→칩 morph |

---

## 5. 권한 모델

B flow에는 PD/감독 role이 없다. 사용자 권한은 다음으로만 구성된다 (탐색 확인):
- `AppUser.role`: `'user' | 'admin'`
- `AppUser.isCompositor?: boolean`
- `AppUser.isActingSupervisor?: boolean`
- 특수: `name === '배한솔'` (오너)

**"컴포지터급" 정의** — 기존 `isCompositorForCompositing(user)` (`src/utils/compositingLabels.ts`)를 그대로 사용:
```
isCompositor === true || role === 'admin' || name === '배한솔'
```

| 액션 | 허용 조건 |
|------|----------|
| 리테이크 생성 | 누구나 (현행 유지) |
| 담당 시작/완료(담당자 본인 상태 전이) | 해당 항목의 담당자 본인 |
| 담당자 재배정 | 요청자(`requesterId === currentUser.id`) **또는** 컴포지터급 |
| 최종 완료 / 최종완료 되돌리기 | 요청자 **또는** 컴포지터급 |
| 세트 생성 | 컴포지터급 (취합자 후보) |
| 세트 취합자 지정/변경 | 세트 생성자 또는 컴포지터급 |
| 세트에 항목 추가 | 누구나 (분산 입력) |

권한은 현행과 동일하게 **클라이언트 단 가드** 기준(앱에 DB RLS는 allow-all). UI에서 권한 없는 액션은 숨기거나 비활성.

---

## 6. 데이터 모델 변경

### 6.1 `comp_revisions` 확장 (담당자 워크플로우)

기존 컬럼 유지. 다음을 추가한다.

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `assignee_ids` | JSONB | `'[]'` | 담당자 `user.id` 배열 (반드시 `notify_user_ids`의 부분집합) |
| `assignee_states` | JSONB | `'{}'` | 담당자별 상태 맵 `{ [userId]: { state, note?, startedAt?, doneAt? } }` |
| `set_id` | UUID (nullable) | NULL | 소속 리테이크 세트 (FK → `comp_revision_sets.id`, ON DELETE SET NULL) |
| `final_resolved_by` | TEXT (nullable) | NULL | 최종 완료자 이름 |
| `final_resolved_at` | TIMESTAMPTZ (nullable) | NULL | 최종 완료 시각 |

- `scene_id`는 **nullable로 완화** (세트의 '전반' 항목은 특정 씬에 안 매임). 기존 `scene_uuid`는 이미 nullable.
  - 기존 `scene_id NOT NULL` 제약 제거 마이그레이션 필요. 일반 리테이크는 계속 `scene_id` 채움.
- 기존 `assignee TEXT` 컬럼: 레거시. 신규 로직은 `assignee_ids`/`assignee_states` 사용. (마이그레이션에서 기존 값 무시 가능.)
- 기존 `resolved_by`/`resolved_note`/`resolved_at`: **담당자 완료 멘트**로 의미 재사용하지 않고, 담당자별 멘트는 `assignee_states[userId].note`에 둔다. 카드에 노출하는 대표 완료멘트는 `assignee_states`에서 집계.

`assignee_states[userId].state` 값: `'pending' | 'in_progress' | 'done'`.

### 6.2 전체 상태(`status`) 파생 규칙

`RevisionStatus` 타입에 `'assignee_done'` 추가:
```
'open' | 'in_progress' | 'assignee_done' | 'resolved'
```

전체 `status`는 `assignee_states`로부터 파생하되, 표시·쿼리 편의를 위해 컬럼에도 저장(낙관적 업데이트와 일관 유지):
- 담당자 0명이거나 전원 `pending` → `open` (대기)
- 누군가 `in_progress`이거나 일부만 `done` → `in_progress` (진행중)
- 담당자 전원 `done` 이고 최종완료 전 → `assignee_done` (담당 완료 / 최종 대기)
- 최종 완료됨 → `resolved`

> 담당자가 한 명도 없는 항목(담당 미지정)은 `open`으로 두고, 카드에서 '담당 지정' 유도.

### 6.3 신규 테이블 `comp_revision_sets`

```sql
CREATE TABLE IF NOT EXISTS comp_revision_sets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  episode_number INTEGER NULL,           -- 에피소드 범위(단일 화 기준). 복수 화는 추후
  department    TEXT NULL,               -- 'bg' | 'acting' | null(통합)
  aggregator_id TEXT NULL,               -- 취합자 user.id (REFERENCES users(id) ON DELETE SET NULL)
  status        TEXT NOT NULL DEFAULT 'open', -- 'open' | 'done'
  created_by    TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_revisions_set ON comp_revisions(set_id) WHERE set_id IS NOT NULL;
```

- 세트 진행률은 `comp_revisions WHERE set_id = ?`의 `status` 집계로 계산 (저장 안 함, 파생).
- 세트 `status='done'`: 하위 전원 `resolved` 시 자동 전환 (낙관적 + 동기화).

### 6.4 TypeScript 타입 (`src/types/index.ts`)

```ts
export type RevisionStatus = 'open' | 'in_progress' | 'assignee_done' | 'resolved';
export type AssigneeState = 'pending' | 'in_progress' | 'done';

export interface RevisionAssigneeState {
  state: AssigneeState;
  note?: string;        // 담당자 완료 멘트(파일경로 등)
  startedAt?: string;
  doneAt?: string;
}

export interface CompRevision {
  // ...기존 필드 유지...
  assigneeIds?: string[];                              // 신규
  assigneeStates?: Record<string, RevisionAssigneeState>; // 신규
  setId?: string | null;                              // 신규
  finalResolvedBy?: string;                           // 신규
  finalResolvedAt?: string;                           // 신규
}

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

---

## 7. 담당자 워크플로우

### 7.1 상태 전이

```
[대기 open]
   │ 담당자 본인 '시작'(=확인+진행 통합)
   ▼
[진행중 in_progress]  (담당자별 state: pending → in_progress)
   │ 담당자 본인 '완료' → 완료멘트 입력창 → 확정 (state: done)
   ▼ (담당자 전원 done 시)
[담당 완료 assignee_done]
   │ 요청자/컴포지터급 '최종 완료'
   ▼
[최종 완료 resolved]
```

- 되돌리기: `resolved → assignee_done`(최종완료 취소), 담당자 본인은 `done → in_progress` 되돌리기 가능.
- 담당자별 상태는 `assignee_states[userId]`로 관리. 전체 `status`는 §6.2 규칙으로 파생·저장.

### 7.2 담당자 지정 / 재배정

- 알림 대상(`notify_user_ids`)은 현행 `RevisionRecipientPicker`로 선택.
- 그중 일부를 **담당자로 승격**: 칩에서 한 번 더 누르면 담당자 표시(왕관/별 등). 이때 `assignee_ids`에 추가, `assignee_states[userId] = { state: 'pending' }`.
- 생성 폼(`RevisionPanel`의 폼, `NewRevisionModal`, 허브 항목 추가)과 카드 인라인 양쪽에서 지정/변경 가능.
- 재배정 시 제거된 담당자의 `assignee_states` 엔트리 삭제, 추가된 담당자는 `pending`으로.
- **불변식**: `assignee_ids ⊆ notify_user_ids` (담당자는 항상 알림도 받음). 담당자 추가 시 알림에도 자동 포함.

### 7.3 활동 기록 (`ActionType`)

기존 `revision_in_progress` / `revision_resolve` 유지 + 추가:
- `revision_assignee_done` (담당자 완료)
- `revision_final_resolve` (최종 완료)
- `revision_reassign` (담당자 변경) — 선택

---

## 8. 인라인 완료 UX

### 8.1 공통 원칙

- 상태 배지 텍스트(`대기/진행중/완료`) 제거 → **좌측 색 세로막대**(`rev-side-bar` 유지·확장)로 상태 색 전달:
  - 대기 `#FDCB6E` / 진행중 `#74B9FF` / 담당완료 `#6C5CE7`(accent) / 최종완료 `#00B894`
- **클릭 시 인라인 확장**: 항목을 누르면 그 자리에서 담당 진행·완료멘트·댓글·최종완료 바가 부드럽게 펼쳐짐(높이+opacity transition). (레퍼런스: AliGrids inline-edit.)
- 완료(`resolved`) 시 카드 opacity 0.5~0.7 + 설명 취소선 (기존 `.rev-card[data-status="resolved"]` 유지).
- **담당 진행 = 담당자 칩**(아바타+이름+상태 점/체크, 본인 칩이 액션 트리거), **최종 완료 = 분리된 하단 바**(전원 완료 전 잠김, 후 활성).
- 기존 시각 자산 유지: `elevatedGlassStyle`(그라디언트/글래스), `rev-side-bar`(세로선), `re#` 네이밍.

### 8.2 맥락별 두 형태 (같은 데이터·확장 로직 공유)

- **시안 A — 카드형**: 씬 상세 모달의 리테이크 탭(`RevisionPanel`) + 기본 리테이크 탭. 그라디언트·세로선이 살아있는 카드.
- **시안 B — 그리드 테이블형**: 감독 허브(`§9`). 컬럼 `[색막대 | re# | 내용 | 담당 | 진행]`. 행 클릭 시 인라인 확장.
- 두 형태는 동일한 하위 표현 컴포넌트(담당 칩, 완료멘트, 최종완료 바, 엔티티 하이라이트)를 공유한다.

### 8.3 완료 멘트 입력

- 담당자 본인이 '완료' 누름 → 인라인 입력창 등장 → 파일경로 등 입력(엔티티 감지 적용) → 확정 시 `assignee_states[userId] = { state:'done', note, doneAt }`.
- 멘트는 선택이 아니라 **입력창을 거쳐** 확정(빈 멘트 허용 여부는 구현 시 결정; 기본은 빈 멘트 허용하되 placeholder로 경로 입력 유도).

---

## 9. 감독 리테이크 허브

### 9.1 진입 / 레이아웃

- 사이드바 **새 메뉴 '리테이크 허브'** → 신규 뷰 (예: `src/views/RetakeHubView.tsx`).
- 2단 레이아웃: 좌측 **세트 목록**(제목·에피소드·취합자·진행률 미니바), 우측 **선택 세트 상세**.
- 세트 상세 헤더: 제목 + 에피소드 범위 + 취합자 + 진행률 바(`n / m 최종완료`).

### 9.2 자동 취합 (탭/필터)

세트 상세 본문은 탭으로 묶음 기준 전환:
- `파트별` (BG/캐릭터/이펙트 등 — 씬의 파트 기준)
- `담당자별`
- `진행상태별` (대기/진행중/담당완료/최종완료)
- `에피소드·씬 순`

'전반(대상 씬 없음)' 항목은 별도 그룹으로 노출. 각 항목은 §8.2 시안 B(테이블 행) + 인라인 확장.

### 9.3 세트 생성 / 항목 입력

- 세트 생성(컴포지터급): 제목, 에피소드 범위, 취합자 지정.
- 항목 추가(누구나): 세트 안 '항목 추가' → 씬 선택(에피소드 고정 컨텍스트 → 파트 → 씬) 또는 **씬 미지정(전반)** 선택 → 내용 입력(엔티티 감지) → 알림/담당 지정. 기존 `NewRevisionModal` 흐름 재사용·확장.
- 추가자가 그 자리서 담당 배정(취합자 재배정 가능).

### 9.4 항목 ↔ 씬 리테이크 동등성

- 세트 하위 항목은 `comp_revisions` 레코드 그 자체 (`set_id` 세팅). 씬에 매인 항목(`scene_id` 있음)은 **해당 씬 상세창의 리테이크 탭에도 동일하게** 노출되고 담당 흐름을 공유한다.
- '전반' 항목(`scene_id` NULL)은 씬 상세창엔 안 뜨고 허브에서만 보인다.
- **가져오기**: 기존 일반 리테이크에 `set_id`를 부여하면 세트로 편입(허브에서 '기존 리테이크 가져오기' UI).

### 9.5 세트 진행/완료

- 진행률 = `resolved 개수 / 전체 하위 개수`.
- 하위 전원 `resolved` → 세트 `status='done'` 자동 전환(낙관적 + 동기화). 좌측 목록에서 완료 세트는 흐림+초록.

---

## 10. 엔티티 감지 입력 (공통 시스템)

### 10.1 접근

- `react-native-data-detector`의 **as-you-type 훅 패턴**(변하는 문자열 → 감지 엔티티, 디바운스/취소 안전) 차용. RN 라이브러리는 네이티브 의존이라 **직접 설치하지 않고 웹용으로 자체 구현**.
- 신규 공통 훅 `useEntityDetector(text)` + 공통 입력 컴포넌트(예: `EntityAwareInput` / `MentionTextarea`).

### 10.2 감지 대상 (한솔 확정)

| 엔티티 | 규칙 | 동작 |
|--------|------|------|
| 사용자명 `@멘션` | `@` 뒤 토큰을 `users` 이름과 매칭 | 타이핑 중 드롭다운(텍스트 **중간**에서도) → 선택 시 멘션 + 알림 연동 |
| 파일경로 | **`G:\`로 시작하는 경로만** | 칩/버튼화, 클릭 시 복사/열기. (`PathLinkifiedText` 기존 자산 확장) |
| 씬/컷 번호 | `컷\d+` / `cut\d+` 등 | 칩화, 클릭 시 해당 씬으로 점프 |

> URL은 이번 범위 제외.

### 10.3 인터랙션

- 감지되면 **평문 → 칩/버튼으로 부드럽게 morph**(배경·패딩·색 transition; 데모 확인 완료). 편집 중엔 평문, 토큰 완성/blur 시 칩.
- 구현 기법: textarea + 동기화 하이라이트 오버레이(mirror) 또는 경량 contentEditable. 멘션 드롭다운은 caret 근처 위치.

### 10.4 적용 범위

지금 `@멘션`이 있는 곳: `RevisionCommentThread`, `CommentPanel`(댓글류).
**확장 적용 대상** (현재 미지원):
- 리테이크 생성 내용 입력 (`RevisionPanel` 폼, `AddRevisionForm`, `NewRevisionModal`)
- 담당자 완료 멘트 입력
- 씬 메모 (`UnifiedSceneDetailModal`, `SceneDetailModal`)
- 일정 메모 (`EventQuickEdit`, `EventSidePanel`)
- 작업 메모 (`MyTasksWidget`)
- 개인 메모 에디터 (`MemoEditor`, TipTap — 별도 처리)

---

## 11. 디자인 참고 스킬 (구현 단계)

- `hyperagent-public-skills`의 그리드 시스템 디자인 스킬(뮬러-브로크만/비넬리) 설치 → 허브·테이블 레이아웃의 정렬·여백·타이포 위계 기준. Claude·Codex 공용으로 설치(`.claude/skills` 또는 AGENTS.md 연동).
- `ui-ux-pro-max` 스킬 병행.
- (참고: `react-native-data-detector`는 라이브러리이지 스킬이 아니며 직접 설치 대상 아님 — §10 자체 구현.)

---

## 12. 영향 파일 / 컴포넌트

**데이터/백엔드**
- `DEVLOG/migrations/2026-06-17-retake-hub.sql` (신규): `comp_revisions` 컬럼 추가, `scene_id` nullable, `comp_revision_sets` 생성, 인덱스
- `electron/supabase.ts`: `mapRevision` 확장, 세트 CRUD(`readRevisionSets`/`addRevisionSet`/`updateRevisionSet`/`deleteRevisionSet`), 담당자 상태 업데이트
- `electron/main.ts` + `electron/preload.ts`: 세트/담당 관련 IPC 채널 추가
- `src/types/index.ts`: 타입 추가 (§6.4)
- `src/constants/revision.ts`: `STATUS_CONFIG`에 `assignee_done` 추가, `revisionNoToLabel` 유지

**상태/서비스**
- `src/services/revisionService.ts`: 담당 시작/완료/최종완료/재배정, 세트 연동
- `src/stores/useRevisionStore.ts`: 담당자 상태·세트 낙관적 업데이트
- `src/stores/useRevisionSetStore.ts` (신규): 세트 목록/선택/진행률
- `src/utils/revisionRecipients.ts`: 담당자 승격 규칙 반영(`assignee_ids ⊆ notify_user_ids`)

**UI**
- `src/components/scenes/RevisionPanel.tsx`: 카드(시안 A) 인라인 확장 + 담당 칩 + 최종완료 바
- `src/components/scenes/RevisionRecipientPicker.tsx`: 담당자 승격 토글
- `src/components/scenes/RevisionCommentThread.tsx` / `CommentPanel.tsx`: 엔티티 입력 컴포넌트로 통합
- `src/views/RetakeHubView.tsx` (신규): 허브 2단 레이아웃 + 자동취합 탭 + 테이블(시안 B)
- 사이드바 메뉴 등록 (해당 네비 컴포넌트)
- 공통 입력: `src/components/common/EntityAwareInput.tsx` (신규) + `src/hooks/useEntityDetector.ts` (신규)
- 엔티티 렌더: `PathLinkifiedText` 확장 또는 신규 `EntityText`
- 메모류 입력 컴포넌트들에 공통 입력 적용 (§10.4)

---

## 13. 구현 단계 (제안 순서)

1. **DB 마이그레이션 + 타입/매핑** — `comp_revisions` 확장, `comp_revision_sets`, 타입, `mapRevision`. (라이브 적용은 한솔 승인 후.)
2. **담당자 워크플로우 백엔드/스토어** — 담당 상태 전이, 파생 `status`, 재배정, 권한 가드.
3. **인라인 카드(시안 A)** — `RevisionPanel` 카드 + 담당 칩 + 최종완료 바 + 인라인 확장. 씬 모달/기본 탭 적용.
4. **엔티티 감지 공통 입력** — 훅 + 컴포넌트, 댓글류부터 교체 후 리테이크/메모로 확장.
5. **리테이크 허브(세트)** — 세트 CRUD, 허브 뷰, 자동취합 탭(테이블 시안 B), 항목 추가/가져오기, 진행률/자동완료.
6. **디자인 스킬 설치 + 폴리싱** — 그리드 디자인 스킬 적용, morph 인터랙션 다듬기.

각 단계: `npm run typecheck` + 관련 테스트 + `npm run build:vite` 통과 확인. (정식 배포 시 `npm run build`.)

## 14. 검증

- 단계별 typecheck/test/build.
- 핵심 시나리오 수동 확인:
  - 담당자 1명/다중 명 모두 `시작→완료→최종완료` 정상, 전원 완료 전 최종완료 잠김.
  - 재배정/최종완료 권한 가드(요청자·컴포지터급 외 비노출).
  - 허브 항목이 씬 상세창에도 동일 노출(씬 매인 경우)·'전반' 항목은 허브에만.
  - 세트 진행률·자동완료.
  - 엔티티 감지: `@`(중간 포함)/`G:\` 경로/컷번호 morph 및 멘션 알림.
  - 낙관적 업데이트 + 실패 롤백, Realtime 반영.

## 15. 미해결 / 추후

- 세트 에피소드 '범위'가 복수 화에 걸치는 경우(현 설계는 단일 `episode_number`). 필요 시 범위 컬럼으로 확장.
- 완료멘트 필수 여부 최종 확정(현재 허용, placeholder 유도).
- `MemoEditor`(TipTap)의 엔티티 감지는 별도 확장 포인트(노드/마크) 필요 — 2차.
- 세트 단위 알림(예: 전원 완료 시 취합자/감독 알림) — 2차 후보.
