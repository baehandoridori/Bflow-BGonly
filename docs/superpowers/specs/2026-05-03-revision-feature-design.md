# 리비전 기능 전면 재설계 — 설계 문서

> **작성일**: 2026-05-03
> **대상 버전**: v1.18.0 (예정)
> **상태**: 설계 확정, 구현 준비
> **mockup**: [`docs/mockups/`](../../mockups/) — `revision-visibility.html`, `revision-detail.html`, `revision-comment-integration.html`

---

## 1. 배경과 목표

### 현재 상태 (반쪽짜리)
B flow의 리비전 기능은 데이터/UI는 거의 만들어져 있지만 **3가지 핵심 기능이 빠져서** 실사용이 어려움:

1. **담당자 미지정** — DB에 `assignee` 컬럼이 있지만 등록 폼에서 받지 않아 항상 빈 값
2. **알림 0건** — `NotificationType`에 `'revision'`이 없어 등록·진행·완료 시 누구에게도 알림이 가지 않음
3. **컴포지터 역할 미정의** — 코드/DB 어디에도 "이 사람이 컴포지터"라는 표시가 없어 알림 대상 결정 자체가 불가능

### 목표
컴포지터 ↔ 작업자 간 **양방향 협업 흐름**을 완성하고, **씬 댓글 패널과 통합된 단일 대화 흐름**을 제공한다.

---

## 2. 핵심 사용자 흐름

### 시나리오 A — 컴포지터가 수정 요청
1. BG 컴포지터(김OO)가 PNG 결과물을 본다
2. 씬 모달 열기 → "리비전" 탭 → "+ 새 리비전" 클릭
3. 본문 작성 + 참고 이미지 첨부 + 알림 받을 사람 확인 (자동 체크: 정OO·이OO·박OO)
4. "리비전 등록" 클릭 → `re3` 생성, 자동 체크된 사람들에게 벨/토스트/OS 알림
5. BG 작업자(이OO)가 알림 클릭 → 씬 모달 자동 열림 → 리비전 탭 → re3 카드로 자동 스크롤 + 강조
6. 이OO이 "진행중" 변경 → 다시 알림
7. 카드 안 댓글 스레드에서 김OO ↔ 이OO 대화 (모든 댓글이 우측 씬 댓글 패널에 [re3] 라벨로도 동시 노출)
8. 이OO이 작업 완료 → "완료" 변경 → 마지막 알림. 카드 흐림 처리 + 본문 취소선

### 시나리오 B — 작업자가 변경 통보
1. 작업자(박OO)가 자기가 한 변경을 알리고 싶음
2. 씬 모달 → 리비전 탭 → "+ 새 리비전" → 본문에 "캐릭터 위치 X에서 Y로 변경했어요" 작성
3. 알림 대상에서 본인 자동 제외, 컴포지터·다른 담당자만 체크된 채로 등록
4. 알림 받은 컴포지터가 확인 후 "완료" 처리

---

## 3. 데이터 모델 변경

### 3-1. 새 컬럼 추가

| 테이블 | 컬럼 | 타입 | 설명 |
|---|---|---|---|
| `comments` | `revision_id` | `TEXT NULL` (FK→comp_revisions.id ON DELETE CASCADE) | NULL이면 일반 씬 댓글, 값이 있으면 그 리비전 맥락 댓글 |
| `users` | `compositor_dept` | `TEXT NULL CHECK (compositor_dept IN ('BG','ACT'))` | NULL이면 일반 사용자, 'BG'/'ACT'면 그 부서 컴포지터 |
| `comp_revisions` | `notify_user_ids` | `JSONB DEFAULT '[]'` | 등록 시 알림 받기로 지정된 user.id 배열. 이후 상태 변경/댓글 알림도 이 목록 기준 |

### 3-2. 미사용 처리 (제거 X)

`comp_revisions`의 `priority`, `frame_no`, `department` 컬럼은 **테이블에서 제거하지 않고 유지**(이미 저장된 데이터 보존). 다만:
- 등록 폼에서 입력 UI 제거
- 카드/배지 표시 제거
- 신규 데이터는 `priority='normal'`, `frame_no=''`, `department=`(자동 추론) 기본값으로 저장

### 3-3. NotificationType 확장

`src/stores/useNotificationStore.ts`:
```ts
// 기존
type NotificationType = 'scene_change' | 'comment' | 'milestone' | 'system'
// 추가
type NotificationType = 'scene_change' | 'comment' | 'milestone' | 'system' | 'revision'
```

`AppNotification.metadata`에 추가 필드:
- `revisionId: string` — 알림 클릭 시 모달 자동 열기·스크롤·강조용
- `revisionAction: 'add' | 'in_progress' | 'resolve' | 'comment'` — 알림 라벨 분기

### 3-4. activity_log 액션 타입 추가

기존 4종(`revision_add` / `revision_in_progress` / `revision_resolve` / `revision_delete`)에 추가:
- `revision_comment` — 리비전 카드 안에서 댓글 작성 시 기록

### 3-5. 마이그레이션 SQL

`DEVLOG/2026-05-03-revision-redesign-migration.sql`로 새로 생성:

```sql
-- 1. comments 테이블에 revision_id 컬럼 추가
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS revision_id TEXT NULL
  REFERENCES comp_revisions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_revision_id ON comments(revision_id) WHERE revision_id IS NOT NULL;

-- 2. users 테이블에 compositor_dept 컬럼 추가
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS compositor_dept TEXT NULL
  CHECK (compositor_dept IN ('BG','ACT'));
CREATE INDEX IF NOT EXISTS idx_users_compositor_dept ON users(compositor_dept) WHERE compositor_dept IS NOT NULL;

-- 3. comp_revisions 테이블에 notify_user_ids 컬럼 추가
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS notify_user_ids JSONB DEFAULT '[]'::jsonb;

-- 4. comments에 scene_uuid 누락 시 추가 (앱이 사용 중이지만 init.sql 누락)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 5. comp_revisions에 scene_uuid 누락 시 추가
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;
```

> 위 SQL은 멱등(IF NOT EXISTS) — 이미 ad-hoc으로 추가됐어도 안전하게 재실행 가능.

---

## 4. UI 설계

### 4-1. 등록 폼 (RevisionPanel 내부 인라인)

**제거**: 우선순위 토글, 프레임번호 입력, 부서 표시
**유지**: 본문(textarea) + 이미지 첨부(파일 선택/Ctrl+V)
**신규**: "알림 받을 사람" 칩 영역
- 자동 체크 칩: `findCompositorsForDept(dept)` + `getSceneAssignees(scene)` 합집합 - 등록자 본인
- "다른 사람 추가" 버튼 → 검색 드롭다운 → 클릭 시 칩 추가
- 자동 체크된 칩도 클릭으로 해제 가능
- 등록 시 `notify_user_ids = checked.map(c => c.userId)` 저장

### 4-2. 리비전 카드

**제거**: 우선순위 칩(긴급/높음/보통), 부서 칩(BG/ACT), 프레임번호 표시
**유지**: 상태 칩(대기/진행중/완료), 본문, 이미지 썸네일, 등록자 + 시간 + 댓글 수, 상태 변경 드롭다운, 더보기 ⋯
**변경**:
- 넘버링: `Rev.X` → `re#` (씬별 시퀀스, 작은 액센트 색)
- 시각 강조 (시안 1):
  - 좌측 컬러 막대(3px, 액센트 색) — 미해결(open/in_progress) 카드만
  - 우측 상단 배지(말풍선+!  아이콘 + 미해결 개수) — 씬 카드/시트 행에서 표시
  - 카드 테두리도 액센트 색으로 강조
- 완료 카드: 흐림(opacity:0.7) + 본문 취소선 + 좌측 막대 초록(#00B894)

**카드 안 댓글 스레드**:
- 입력란 placeholder: `re# 댓글 남기기...`
- 컴포지터 댓글은 액센트 색 강조
- 일반 댓글은 회색 톤
- 댓글 작성 시 자동으로 `comment.revision_id = 그 카드의 re# id` 부여

### 4-3. 씬 카드/시트 — 시각 표시 (시안 1 강조)

**보드 뷰** (`UnifiedSceneCard.tsx`):
- 카드에 미해결 리비전(open + in_progress) 1개 이상 → 좌측 4px 컬러 막대(액센트 색) + 우측 상단 배지(말풍선+! + 개수) + 카드 테두리 액센트
- 미해결 0개 + 완료된 리비전만 있음 → 우측 상단에 작은 회색 ✓ + 개수 (옅은 표시)

**시트 뷰** (`UnifiedSceneSheetView.tsx`):
- 행 좌측 3px 컬러 막대(액센트 색) — 미해결 있을 때만
- 씬번호 셀 옆에 작은 배지(말풍선+! + 개수)

**아이콘**: Lucide `MessageSquareWarning` (말풍선 + 느낌표). 색상은 `currentColor` → 부모의 액센트 색 자동 상속.

### 4-4. 씬 댓글 패널 통합 (`CommentPanel.tsx`)

- 댓글 리스트에 `comment.revision_id`가 있는 댓글은 작성자 이름 옆에 작은 `re#` 배지 표시
- 배지 스타일: `bg: rgb(var(--color-accent) / 0.15)`, `text: rgb(var(--color-accent-sub))`, `border: rgb(var(--color-accent) / 0.3)`, 클릭 가능
- 배지 클릭 시:
  1. 모달 탭을 `revisions`로 전환
  2. 해당 카드(`#rev-card-${revisionId}`)로 부드럽게 스크롤
  3. 카드 댓글 스레드 자동 펼침 (접혀있던 경우)
  4. 1.2초 강조 애니메이션(2회 펄스)
- 헤더에 "re만" 토글 버튼 — 일반 댓글 숨기고 `revision_id` 있는 댓글만 표시
- 패널 하단 입력란 placeholder: `씬 댓글 남기기... (라벨 없음)` + 보조 안내문 "여기서 적으면 일반 씬 댓글로. 리비전 댓글은 카드 안에서 적기"

### 4-5. 어드민 설정 화면

`src/components/settings/` 하위에 신규 섹션 `CompositorSection.tsx` 추가:
- "리비전 컴포지터 지정" 헤더
- BG 컴포지터: `<select multiple>` (사용자 목록에서 1~2명 선택)
- ACT 컴포지터: `<select multiple>` (사용자 목록에서 1~2명 선택)
- 저장 시: `users.compositor_dept` 값 일괄 업데이트 (선택된 사람 → 'BG'/'ACT', 해제된 사람 → NULL)
- 어드민(`role==='admin'`)만 접근 가능. 일반 사용자에겐 섹션 비표시

### 4-6. 알림 패널 (`NotificationPanel.tsx`)

`type === 'revision'` 알림 항목:
- 아이콘: 말풍선+! (액센트 색 — 우선순위 구분 없음)
- 제목 라벨 분기:
  - `add`: `새 리비전 — {sceneLabel}`
  - `in_progress`: `리비전 진행중 — {sceneLabel}`
  - `resolve`: `리비전 완료 — {sceneLabel}`
  - `comment`: `리비전 댓글 — {sceneLabel}`
- 본문: `{userName}: "{description 또는 commentText 첫 60자}..."`
- 클릭 시: 메타데이터의 `episodeId/partId/sceneId/revisionId`를 사용해 모달 열고 → 리비전 탭 → 그 카드로 스크롤+강조

---

## 5. 알림 시스템

### 5-1. 트리거 시점
1. **등록(`add`)** — `addRevision` 직후
2. **진행중(`in_progress`)** — `updateRevision({status: 'in_progress'})` 직후
3. **완료(`resolve`)** — `updateRevision({status: 'resolved'})` 직후
4. **댓글(`comment`)** — `addComment({revision_id != null})` 직후

### 5-2. 수신 대상
`comp_revisions.notify_user_ids` 배열에 포함된 사용자. **단 액션을 수행한 본인은 제외**.

### 5-3. 채널 (3중)
1. **벨 패널** — `useNotificationStore.addNotification()` (로컬 JSON 저장, 카운터)
2. **토스트** — 우측 상단 fade-in/out (5초)
3. **OS 알림** — `electron Notification API`로 트리거 (앱 비포커스 시에만 — 기존 패턴 유지)

### 5-4. 다른 사용자에게 전파
현재 알림은 로컬 JSON 저장이라 다른 사용자에게 자동 전파되지 않음. **Realtime 활용**:
- `comp_revisions` 테이블 INSERT/UPDATE → 기존 Realtime 구독(`electron/realtime.ts`)에서 수신
- `useRevisionStore`가 변경 감지 → 본인이 `notify_user_ids`에 포함되어 있고 액션 수행자가 아니면 → `addNotification` 호출
- `comments` 테이블 INSERT (with `revision_id`) → 동일 패턴
- 즉 **알림 발송 자체는 각 클라이언트가 자기가 수신할 알림인지 판단해서 자체 발송** (Push 서버 없이 동작)

---

## 6. 댓글 통합 (단일 흐름 정책)

### 데이터 모델
- 모든 댓글은 `comments` 테이블 단일 저장
- `revision_id` NULL → 일반 씬 댓글 (씬 댓글 패널만 표시)
- `revision_id` 값 있음 → 리비전 맥락 댓글 (리비전 카드 안 + 씬 댓글 패널 [re#] 배지로 동시 표시)

### 입력 위치 → revision_id 자동 부여
- 리비전 카드 안 입력란에서 작성 → `revision_id = 그 카드의 re# id` 자동 부여
- 씬 댓글 패널 입력란에서 작성 → `revision_id = NULL` (일반 씬 댓글)

### 표시 로직 (CommentPanel.tsx)
```ts
// 댓글 리스트는 변경 없이 모두 가져옴 (filter는 나중에 옵션)
const comments = await getCommentsByScene(sceneId)
// 렌더링에서 revision_id 있으면 [re#] 배지
{comment.revision_id && (
  <ReBadge revisionId={comment.revision_id} onClick={navigateToRevision} />
)}
```

### "re만" 필터
패널 헤더 토글 → `comments.filter(c => c.revision_id !== null)` 만 표시.

---

## 7. 권한 정책

| 액션 | 누가 가능 |
|---|---|
| 리비전 등록 | 누구나 |
| 상태 변경 (진행중/완료/대기 되돌리기) | 누구나 (책임은 activity_log로 추적) |
| 리비전 삭제 | 등록자(`requesterId === userId`) + 어드민(`role === 'admin'`) |
| 댓글 작성 (카드/패널 모두) | 누구나 |
| 댓글 삭제/수정 | 작성자 + 어드민 (기존 정책 유지) |
| 컴포지터 지정 (`compositor_dept` 변경) | 어드민만 |

---

## 8. 라이프사이클

| 이벤트 | 처리 |
|---|---|
| 씬 삭제 | 그 씬의 리비전 + 댓글 모두 자동 삭제 (FK CASCADE — 현재 동작 유지) |
| 씬 모든 단계 완료(PNG까지) | **별도 처리 없음** — 리비전은 그대로 유지 |
| 리비전 삭제 | 그 리비전에 달린 댓글 모두 자동 삭제 (FK CASCADE) |
| 리비전 완료 처리 | 카드 시각 흐림 처리. 데이터는 보존, 알림 발송 |
| 사용자 비활성/탈퇴 | 별도 처리 없음 — 등록자/담당자/알림 대상 표시는 그대로 (이름만 보임) |

---

## 9. 활동 로그(activity_log) 연동

기존 4종 + 신규 1종 = **5종**:
- `revision_add` — 등록 (기존)
- `revision_in_progress` — 진행중 변경 (기존)
- `revision_resolve` — 완료 변경 (기존)
- `revision_delete` — 삭제 (기존)
- `revision_comment` — 카드 안 댓글 (신규)

`detail` JSONB 필드에 `{ revisionId, revisionNo, commentText? }` 저장. ActivityFeed 위젯에 라벨/색 등록 필요 (`src/components/widgets/activity/constants.ts`).

---

## 10. 구현 영향 범위 (수정/추가될 파일 요약)

### 신규
- `DEVLOG/2026-05-03-revision-redesign-migration.sql`
- `src/components/settings/CompositorSection.tsx` (어드민 컴포지터 설정 UI)
- `src/utils/revisionRecipients.ts` (자동 체크 대상 계산 헬퍼)

### 수정
- **DB/타입**: `src/types/index.ts` — `CompRevision`에 `notifyUserIds`, `User`에 `compositorDept`, `Comment`에 `revisionId` 추가
- **알림 store**: `src/stores/useNotificationStore.ts` — `'revision'` 타입 + `revisionId/revisionAction` 메타
- **리비전 store/서비스**: `src/stores/useRevisionStore.ts`, `src/services/revisionService.ts` — `notifyUserIds` 처리, 알림 발송 로직 (전파 시점 본인 판단)
- **댓글 서비스**: `src/services/commentService.ts` — `revisionId` 필드 처리, `addCommentForRevision()` 추가
- **RevisionPanel**: `src/components/scenes/RevisionPanel.tsx` — 등록 폼 재설계(우선순위/부서/프레임 제거 + 알림 대상 칩), 카드 표시 재설계(re# 넘버링 + 강조 시안 + 댓글 스레드 + 입력)
- **CommentPanel**: `src/components/scenes/CommentPanel.tsx` — `[re#]` 배지 표시 + 클릭 핸들러 + "re만" 필터
- **UnifiedSceneCard**: `src/components/scenes/UnifiedSceneCard.tsx` — 리비전 시각 표시(좌측 막대/우측 배지/테두리)
- **UnifiedSceneSheetView**: `src/components/scenes/UnifiedSceneSheetView.tsx` — 행 좌측 막대 + 셀 배지
- **UnifiedSceneDetailModal**: `src/components/scenes/UnifiedSceneDetailModal.tsx` — re# 배지 클릭 시 탭 전환 + 카드 스크롤 + 강조 핸들러
- **NotificationPanel**: `src/components/NotificationPanel.tsx` — `'revision'` 타입 분기 + 클릭 시 모달 열기 라우팅
- **ActivityFeed constants**: `src/components/widgets/activity/constants.ts` — `revision_comment` 라벨/색 추가
- **IPC**: `electron/preload.ts`, `electron/main.ts`, `electron/supabase.ts` — `notifyUserIds` 인자 추가, `addRevision` 시그니처 변경, `addCommentForRevision` 신규 IPC

### 데이터 마이그레이션
- 기존 `comp_revisions.assignee` 데이터: 그대로 두되 신규 데이터는 사용 안 함 (notify_user_ids로 대체)
- 기존 `comments`의 `revision_id`는 NULL로 채워짐 (모두 일반 씬 댓글로 분류) — 정상

---

## 11. 알려진 리스크 / 주의사항

1. **CSS 변수 활용**: 모든 강조 색은 `rgb(var(--color-accent))` 사용 — 사용자가 테마 색 바꾸면 자동 반영. 하드코딩된 hex 색상 금지 (#FF6B6B 같은 위험 색만 예외).
2. **알림 폭주 가능성**: 한 리비전에 진행중 변경 → 완료 → 댓글 5개 → 4명에게 9건 × 4명 = 36건 알림. 사용자 설정에서 "리비전 알림 OS 알림 끄기" 같은 옵션 향후 추가 검토. 1차 구현에서는 모든 채널 ON.
3. **Realtime 자체 발송 패턴의 race**: 두 사용자가 거의 동시에 같은 리비전 등록 시 알림 중복 가능. `notification.id = revisionId + actionType + timestamp` 형태로 중복 ID는 무시.
4. **컴포지터 미지정 상태**: 어드민이 아직 컴포지터를 설정하지 않은 부서의 씬에서 리비전 등록 시 — 자동 체크 대상에 컴포지터가 없음(담당자만 자동 체크). 빈 알림 대상은 막지 않음(등록자 임의 추가 가능).
5. **레거시 데이터**: 기존에 등록된 `comp_revisions` 행은 `notify_user_ids = []`로 시작. 상태 변경 시 알림 대상이 비어있어 아무에게도 안 감. **마이그레이션 시 backfill 옵션**: 등록자(`requesterId`)만이라도 `notify_user_ids`에 넣어두기.

---

## 12. 검증 기준

- [ ] 마이그레이션 SQL이 멱등하게 실행됨 (재실행 시 에러 없음)
- [ ] 등록 폼에 우선순위/부서/프레임번호 UI 없음
- [ ] 알림 받을 사람 자동 체크 = 컴포지터 + 담당자 - 등록자
- [ ] "다른 사람 추가" 검색 → 클릭 → 칩 추가 정상 작동
- [ ] 리비전 등록 시 자동 체크된 사람들에게 벨/토스트/OS 알림 전송 (등록자 본인은 미수신)
- [ ] 알림 클릭 → 씬 모달 자동 열림 → 리비전 탭 → 해당 카드 스크롤 + 1.2초 강조
- [ ] 리비전 카드 안 댓글 작성 시 우측 씬 댓글 패널에도 [re#] 배지로 즉시 표시
- [ ] 씬 댓글 패널의 [re#] 배지 클릭 → 리비전 탭 + 카드 스크롤 + 댓글 스레드 펼침 + 강조
- [ ] "re만" 필터 토글 정상 작동
- [ ] 씬 카드/시트 행에 미해결 리비전 표시(좌측 막대 + 우측 배지)
- [ ] 어드민이 설정 화면에서 BG/ACT 컴포지터 지정 가능
- [ ] 테마 색 변경 시 모든 강조 색이 즉시 따라 변경
- [ ] activity_log에 5종 액션 모두 기록 (댓글 포함)
