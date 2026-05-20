# 2026-05-21 — 댓글 이모지 반응 알림 + 활동 로그 spec

세션 배경: v1.28.0 (`/DEVLOG/migrations/2026-05-15-comment-reactions.sql`) 에서 추가된 댓글 이모지 반응 기능이 알림·최근 작업 목록과 연결되어 있지 않아, 누가 내 댓글에 반응을 남겨도 받는 사람이 인지할 방법이 없음. 이를 기존 알림 인프라(`acting_feedback_notifications` / `scene_assignment_notifications`)와 같은 패턴으로 통합하고, 활동 로그(`activities`)에도 이모지 반응 항목을 추가한다.

기존 알림 시스템 컨텍스트는 [docs/superpowers/specs/2026-05-10-comments-notifications-revamp-design.md](./2026-05-10-comments-notifications-revamp-design.md) 참조.

---

## 결정사항 (확정)

| 항목 | 결정 |
|---|---|
| 알림 대상 | **댓글 작성자만**. 같은 댓글에 반응한 다른 사람들에게는 알림 X. |
| 자기 반응 | 자기 댓글에 자기가 이모지 달면 → 알림·활동로그 모두 미생성 |
| 알림 묶기 | `(받는 사람, 댓글, 보낸 사람)` UNIQUE → UPSERT 누적. 새 이모지 **추가 시에만** `read_at=null` 리셋(이미 본 알림도 다시 안 읽음 상태로). 이모지 **제거 시에는** `read_at` 유지 |
| 알림 시각 강도 | 기존 `comment` 톤(차분, 회색 아이콘) 재사용. mention/feedback 강조 톤 X |
| 이모지 취소 동작 | "조용히 사라지기" — 알림 보관함의 emojis 배열에서 제거 + count 차감 + 0 이 되면 행 자체 DELETE. 활동 로그도 해당 행 DELETE |
| 활동 로그 actionType | `'comment_reaction'` 신설 |
| 활동 로그 actionGroup | `'memo'` (기존 댓글·메모·리비전과 같은 카테고리) |
| 활동 로그 그룹핑 | 기존 5분 룰 그대로 — `같은 user + actionType + same episode + same scene + 5분 내` → "이모지 반응 · N건" 묶음 헤더 |
| 알림 클릭 점프 | 씬 모달 + 댓글 패널 자동 펼침 + 해당 댓글로 스크롤 + `targetPulse` 강조 |
| Catch-up | 앱 시작 시 `lastSeenCommentReactionAt` localStorage 기반 페이지네이션 (PAGE_SIZE=100, SAFE_CAP=1000) — `acting_feedback` 캐치업과 동일 패턴 |
| 실시간 전파 | broadcast 채널 `comment-reaction-notification` (추가) / `comment-reaction-notification-removed` (취소) / `activity-removed` (신규, 활동로그 단일 행 삭제용) |

---

## 데이터 모델

### Supabase 신규 테이블 `comment_reaction_notifications`

```sql
CREATE TABLE IF NOT EXISTS comment_reaction_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    TEXT        NOT NULL,                    -- 댓글 작성자
  comment_id      TEXT        NOT NULL,                    -- 반응 대상 댓글
  actor_id        TEXT        NOT NULL,                    -- 이모지 달은 사람
  actor_name      TEXT        NOT NULL,
  -- 씬 점프용 컨텍스트
  scene_id        TEXT,
  episode_number  INTEGER,
  part_id         TEXT,
  dept            TEXT,                                    -- 'bg' | 'act'
  -- 누적 데이터
  emojis          JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- ["❤️","🔥","👏"] 누적 배열 (삽입 순서 보존)
  reaction_count  SMALLINT    NOT NULL DEFAULT 0,
  -- NOTE: last_emoji 는 별도 컬럼으로 두지 않음 — `emojis[length-1]` 로 application 측에서 derive.
  --       race-free + WITH ORDINALITY 의존성 제거. UI 아이콘은 derived getter 사용.
  last_action_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,                             -- null = 미읽음
  UNIQUE (recipient_id, comment_id, actor_id)              -- 묶기 키
);

CREATE INDEX IF NOT EXISTS idx_crn_recipient_unread
  ON comment_reaction_notifications (recipient_id, read_at NULLS FIRST, last_action_at DESC);

CREATE INDEX IF NOT EXISTS idx_crn_comment ON comment_reaction_notifications (comment_id);

-- Realtime publication (멱등성 보장)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='comment_reaction_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comment_reaction_notifications;
  END IF;
END $$;
```

**주의**: `comment_id`는 단일 `comments` 테이블의 `id` 를 가리킴(일반 씬 댓글·리비전 댓글 모두 같은 테이블에 저장되며 `revision_id` 컬럼으로 구분). FK 제약 대신 application-level 참조만 유지(기존 `comment_reactions` 테이블도 FK 없는 텍스트 컬럼).

**Cleanup 경로** (댓글 삭제 시):
- 기존 `deleteComment(commentId)` (electron/supabase.ts:1372) 흐름에서 다음 호출 추가:
  - `DELETE FROM comment_reactions WHERE comment_id = :commentId` (기존, 또는 추가)
  - `DELETE FROM comment_reaction_notifications WHERE comment_id = :commentId` (신규)
  - 영향 받은 activities 행 id 들 SELECT → DELETE → 각 id로 `broadcast('activity-removed')` 발화
- 위 호출들은 supabase-js 의 별도 요청이므로 단일 트랜잭션 보장은 어려움. **best-effort 순차 실행**으로 진행하며, 실패 시 WARN log + 다음 단계 진행 (orphan 데이터 잔존 가능성은 차후 cleanup job 으로 처리).
- broadcast: 각 영향 받은 사용자에게 `comment-reaction-notification-removed`(per-row) + `activity-removed`(per-row) 디스패치

### 활동 로그 (`activities`) 확장

`Activity['actionType']` 타입에 `'comment_reaction'` 추가. `actionGroup` 계산 함수에 매핑:

```ts
// src/types/index.ts
export type ActionType =
  | 'stage_lo' | 'stage_done' | ...
  | 'comment_add' | 'memo_update'
  | 'comment_reaction'    // 신규
  | ...;

// src/utils/activityGrouping.ts (또는 동등 위치)
function actionGroupOf(actionType: ActionType): ActionGroup {
  if (actionType === 'comment_reaction') return 'memo';
  // ...기존
}
```

`detail` 페이로드:
```ts
{
  commentId: string;
  emoji: string;          // 이 행이 추가한 이모지 (단일)
  commentAuthorId: string;
  commentPreview?: string; // 30자 이내, 활동 로그 표시용
}
```

### TypeScript 알림 타입 확장

```ts
// src/types/notifications.ts
export type NotificationType =
  | 'comment'
  | 'mention'
  | 'acting_feedback'
  | 'scene_assignment'
  | 'comment_reaction';  // 신규

export interface CommentReactionNotification {
  id: string;
  type: 'comment_reaction';
  recipientId: string;
  actorId: string;
  actorName: string;
  // commentId 는 metadata 안에만 단일 보관 (점프 핸들러가 metadata 만 읽음)
  emojis: string[];          // 누적 (삽입 순서 보존)
  reactionCount: number;
  // lastEmoji 는 derived: `emojis.at(-1) ?? null`. 클라이언트 헬퍼로 계산, 별도 필드 X.
  metadata: {
    sceneId?: string;
    episodeNumber?: number;
    partId?: string;
    dept?: 'bg' | 'act';
    commentId: string;       // navigateToScene 점프 + cleanup join 용 (단일 진실 위치)
  };
  createdAt: string;
  lastActionAt: string;
  readAt: string | null;
}
```

---

## 동작 시나리오 (한솔 친화)

| 케이스 | 동작 |
|---|---|
| A: A가 한솔 댓글에 ❤️ | 알림 패널에 "A가 회원님 댓글에 ❤️ 반응을 남겼어요" 1줄 (차분 회색). 최근 작업에 1줄 |
| B: A가 1분 안에 ❤️🔥👏 | 알림 1줄(누적 "❤️🔥👏" 표시). 최근 작업 3줄(같은 5분/같은 씬이라 "이모지 반응 · 3건" 묶음 헤더로 자동 접힘) |
| C: A가 ❤️🔥 두 개 달았다가 ❤️ 떼면 | 알림 "🔥 1건"으로 축소(미읽음 리셋 안 함). 최근 작업의 ❤️ 줄 1개 삭제 → 묶음 헤더 "이모지 반응 · 1건"으로 자동 조정 |
| C-end: A가 마지막 이모지까지 다 떼면 | 알림 행 자체 DELETE. 최근 작업 줄 모두 삭제 |
| D: 본인 댓글에 본인이 이모지 | **알림 미생성**, **활동 로그는 기록**(다른 사용자가 보는 최근 작업 위젯엔 정상 표시) |
| E: 오프라인 사이 받은 반응 | 다음 실행 시 catch-up이 자동으로 불러와서 알림 패널에 누적 |
| F: 알림 클릭 | 씬 상세 모달 열기 + 우측 댓글 패널 자동 펼침 + 해당 댓글 위치로 스크롤 + 1.6초 강조(`targetPulse`) |

---

## 흐름 (시퀀스)

### 이모지 추가

```
[Renderer] CommentPanel.handleReactionToggle(commentId, emoji, 'add')
  ↓ IPC
[Main] addCommentReaction(commentId, emoji, userId, userName)
  ↓
supabase: comment_reactions INSERT
  ↓ (행이 실제로 추가된 경우만 다음 단계 — UNIQUE 충돌로 무시되면 분기 종료)
supabase: comments 테이블에서 author_id, scene 정보 조회 (revision_id 컬럼으로 일반/리비전 구분)
  - 미존재면(고아 reaction) early return + WARN log
  ↓
[자기 자신 분기]
  - author_id === userId 면: 알림 행 생성 X, 활동 로그 INSERT 만 수행
  - author_id !== userId 면: 아래 둘 다 수행
  ↓
supabase: comment_reaction_notifications UPSERT (author_id !== userId 일 때만)
  INSERT INTO comment_reaction_notifications
    (recipient_id, comment_id, actor_id, actor_name,
     scene_id, episode_number, part_id, dept,
     emojis, reaction_count, last_action_at, read_at, created_at)
  VALUES
    (:author, :commentId, :userId, :userName,
     :sceneId, :episode, :partId, :dept,
     jsonb_build_array(:emoji), 1, now(), NULL, now())
  ON CONFLICT (recipient_id, comment_id, actor_id) DO UPDATE
  SET emojis         = comment_reaction_notifications.emojis || jsonb_build_array(:emoji),
      reaction_count = comment_reaction_notifications.reaction_count + 1,
      last_action_at = now(),
      read_at        = NULL
  RETURNING *
  -- emojis 는 삽입 순서로 누적. last_emoji 컬럼 없음 → application 측에서 emojis.at(-1) 사용.
  ↓
supabase: activities INSERT { actionType='comment_reaction', detail={commentId, emoji, commentAuthorId, commentPreview} }
  -- 자기 자신이어도 이 INSERT 는 수행 (다른 사용자가 보는 최근 작업 위젯에 표시)
  ↓
broadcast('comment-reaction-changed', {commentId})         -- 기존 (이모지 칩 갱신용)
broadcast('comment-reaction-notification', {notification}) -- 신규, 자기 자신이면 emit X (수신측 필터링 외 송신 단계에서도 skip)
broadcast('activity-added', {activity})                    -- 기존 (최근 작업 위젯용)
```

### 이모지 취소

```
[Renderer] CommentPanel.handleReactionToggle(commentId, emoji, 'remove')
  ↓ IPC
[Main] removeCommentReaction(commentId, emoji, userId)
  ↓
supabase: comment_reactions DELETE WHERE comment_id=:c AND user_id=:u AND emoji=:e RETURNING *
  ↓ (DELETE 된 행이 있을 때만 다음 단계 — 0행이면 분기 종료)
supabase: comments 테이블에서 author_id 조회
  ↓ (author_id !== userId 일 때만 알림 행 처리. 자기 자신이면 알림 분기 건너뛰고 활동로그 DELETE 만)
supabase: comment_reaction_notifications 업데이트 (recipient=author, comment=c, actor=u)
  -- PostgreSQL expression 으로 race-free 제거. WITH ORDINALITY 로 삽입 순서 보존.
  -- UNIQUE(comment_id, user_id, emoji) 제약상 emojis 배열에 같은 이모지 중복 없음 → 1개만 매치.
  WITH updated AS (
    UPDATE comment_reaction_notifications
    SET emojis = COALESCE(
                   (SELECT jsonb_agg(e ORDER BY ord)
                    FROM jsonb_array_elements_text(emojis) WITH ORDINALITY AS t(e, ord)
                    WHERE e <> :emoji),
                   '[]'::jsonb
                 ),
        reaction_count = GREATEST(reaction_count - 1, 0)
        -- read_at, last_action_at, created_at 은 의도적으로 건드리지 않음
    WHERE recipient_id=:author AND comment_id=:c AND actor_id=:u
    RETURNING id, reaction_count
  )
  DELETE FROM comment_reaction_notifications
  WHERE id IN (SELECT id FROM updated WHERE reaction_count = 0)
  RETURNING id AS deleted_id;
  -- 결과:
  --   deleted_id 가 반환되면 → 행 자체 삭제 (broadcast: deleted=true)
  --   updated 행 있고 deleted_id 없으면 → emojis 만 축소 (broadcast: deleted=false, notificationId=updated.id)
  --   updated 행도 없으면(원래 행 없음) → broadcast emit X
  -- last_emoji 는 사용 측에서 emojis[emojis.length-1] 로 derive (서버 별도 컬럼 X)
supabase: activities DELETE — 가장 최근 1행만 (자기 자신이어도 수행)
  WITH target AS (
    SELECT id FROM activities
    WHERE user_id=:u AND action_type='comment_reaction'
      AND detail->>'commentId'=:c AND detail->>'emoji'=:e
    ORDER BY created_at DESC LIMIT 1
  )
  DELETE FROM activities WHERE id IN (SELECT id FROM target)
  RETURNING id
  ↓
broadcast('comment-reaction-changed', {commentId})                         -- 기존
broadcast('comment-reaction-notification-removed', payload)                -- 신규, author_id !== userId 일 때만
  -- payload 형태 (수신측이 분기할 수 있도록 모든 식별자 포함):
  --   {
  --     recipientId: string,    -- 수신측 본인 필터링용 (currentUserId 비교)
  --     notificationId: string, -- 위 SQL 의 RETURNING id (UPDATE 케이스) 또는 deleted_id (DELETE 케이스)
  --     deleted: boolean,       -- true 면 행 자체 삭제됨, false 면 emojis 만 축소됨
  --     emoji: string,          -- 어떤 이모지가 제거됐는지 (UI 강조용)
  --     commentId: string,      -- (옵션) 디버그/추적용
  --     actorId: string         -- (옵션) 디버그/추적용
  --   }
broadcast('activity-removed', {activityId})                                -- 신규, RETURNING id 받은 경우만
```

### Catch-up (앱 시작)

```
App.tsx useEffect (existing 패턴 확장, 두 기존 caught-up 옆에 신설):
  const lastSeen = localStorage.getItem('bflow:lastSeenCommentReactionAt')
  → IPC invoke('notifications:fetchCommentReactions', { since: lastSeen, page: 0 })
  → 최대 SAFE_CAP=1000 까지 페이지네이션 (PAGE_SIZE=100)
  → notificationStore.appendCatchup(rows)
  → 끝나면 localStorage 갱신
```

### Realtime 수신

```
broadcast.on('comment-reaction-notification', payload):
  if (payload.recipientId !== currentUserId) return;       -- 본인 받은 것만
  notificationStore.upsertCommentReaction(payload);        -- 기존 행 갱신 또는 추가
  showToastIfPanelClosed(payload);                          -- 패널 닫혀있으면 토스트

broadcast.on('comment-reaction-notification-removed', payload):
  if (payload.recipientId !== currentUserId) return;
  if (payload.deleted) {
    notificationStore.removeById(payload.notificationId);   -- store 에 없어도 no-op
  } else {
    notificationStore.refetchOne(payload.notificationId);   -- emojis 축소 반영
      -- refetchOne 결과 404(이미 삭제) 면 removeById no-op 으로 fallback
  }

broadcast.on('activity-removed', payload):
  activityStore.removeById(payload.activityId);             -- 신규 store action, missing ID 면 no-op
```

### 읽음 처리 (`read_at` 갱신)

- **알림 클릭 시**: 점프 직전 `markCommentReactionRead(notificationId)` 호출 → `UPDATE comment_reaction_notifications SET read_at = now() WHERE id = :id AND read_at IS NULL` → broadcast 없이 store만 갱신
- **알림 패널 열림 + 화면에 1초 이상 보임**: 기존 `acting_feedback`·`scene_assignment`과 동일한 in-view 자동 read 패턴(기존 NotificationPanel에 `useInViewMarkRead` 훅 있음). 새 type 도 동일 훅 재사용
- **"모두 읽음" 버튼**: `markAllCommentReactionsRead(userId)` IPC → `UPDATE ... WHERE recipient_id = :uid AND read_at IS NULL` → store 일괄 갱신

### 씬 점프

```
NotificationPanel.tsx (type='comment_reaction' 행 클릭):
  notificationHelper.navigateToScene({
    type: 'comment_reaction',
    metadata: { episodeNumber, partId, dept, sceneId, commentId }
  })
  ↓
notificationHelper.ts:
  - dashboardDeptFilter='all' 강제
  - episode/part 설정
  - sceneStore.openSceneModal(sceneId, {
      autoOpenCommentPanel: true,
      scrollToCommentId: commentId,
      pulseCommentId: commentId
    })
  ↓
SceneDetailModal.tsx:
  - props 받아서 CommentPanel 펼침
  - CommentPanel useEffect → document.querySelector(`[data-comment-id="${id}"]`)?.scrollIntoView({behavior:'smooth', block:'center'})
  - 해당 댓글에 className 'animate-target-pulse' 1.6s 추가
```

---

## 묶기·그룹핑 규칙

### 알림 보관함 (DB)
- UNIQUE 키 `(recipient_id, comment_id, actor_id)` 하나로 묶음
- 새 이모지 시 UPSERT — emojis 배열 push, count++, `read_at=null`
- 표시 텍스트: `{actor_name}가 회원님 댓글에 {emojis.join('')} 반응을 남겼어요`
  - emojis 길이 > 5 면 `{first5.join('')}+{count-5}` 형태로 truncate

### 최근 작업 위젯 (Client-side)
- 기존 `groupActivities()` (`src/components/widgets/activity/utils.ts`) 룰 그대로 통과:
  - 같은 `userId` + 같은 `actionType` + 같은 `episodeNumber` + 같은 `sceneId` + 5분 윈도우
- 그룹 헤더 동사: "이모지 반응을 남겼어요"
- 그룹 헤더 카운트: "N건"
- 펼치면 개별 이모지 줄: "❤️ — [씬 라벨] 댓글" / "🔥 — [씬 라벨] 댓글"
- **별도 그룹핑 코드 추가 없음** — 기존 utils 의 actionType 매칭만으로 자동 묶임

### 씬 모달 히스토리 탭
- 기존 `groupStageToggles()` (`src/components/scenes/historyGrouping.ts`)는 **단계 토글 전용**이라 이모지 반응은 단일 항목으로 표시됨
- 추가 변경 없음 — 히스토리에서는 이모지 1개당 1줄 그대로 (정확성 우선)

---

## UI 변경

### `src/components/notifications/NotificationPanel.tsx`
- `type='comment_reaction'` 분기 추가
- 아이콘: derived `lastEmoji` (= `emojis.at(-1) ?? '💬'`) 를 작게 표시 (대체: 회색 💬 + 이모지 오버레이)
- 좌측 색깔 바: 없음 (차분 톤, `comment`와 동일)
- 텍스트 포맷: `{actor_name}가 회원님 댓글에 {emojis 5개 + truncate} 반응을 남겼어요`
- 시간 표시: `last_action_at` 상대 시간 ("3분 전")
- 클릭 핸들러: 위 "씬 점프" 시퀀스

### `src/components/widgets/activity/ActivityFeed.tsx` + `utils.ts`
- `actionType='comment_reaction'` 동사·아이콘 매핑:
  - 아이콘: 작은 💬 + 이모지 오버레이
  - 동사: "이모지 반응을 남겼어요"
- `FeedItemRow`: `{userName}가 [{sceneLabel}] 댓글에 {detail.emoji} 반응을 남겼어요`
- `FeedGroup` 헤더: "이모지 반응 · N건" + 펼치면 각 줄
- 그룹 4-필터 칩 중 `memo` 카테고리에 포함 — 별도 칩 추가 X

### `src/components/scenes/CommentPanel.tsx`
- 각 댓글 wrapper 에 `data-comment-id={comment.id}` 추가 (스크롤 타겟)
- props `scrollToCommentId`, `pulseCommentId` 받아서 useEffect 로 처리
- pulse 종료 후(1.6s) ref clear

### `src/components/scenes/SceneDetailModal.tsx`
- props `autoOpenCommentPanel`, `scrollToCommentId`, `pulseCommentId` 받아서 CommentPanel 에 전달
- mount 시 `autoOpenCommentPanel=true` 면 댓글 패널 펼친 상태로 초기화

---

## 변경 파일 맵

### 신규 파일
| 경로 | 용도 |
|---|---|
| `DEVLOG/migrations/2026-05-21-comment-reaction-notifications.sql` | DDL + Realtime publication |
| `src/services/commentReactionNotifications.ts` (선택, 또는 supabase.ts 내부 함수로) | UPSERT/DELETE 헬퍼 |

### 수정 파일
| 경로 | 변경 |
|---|---|
| `electron/supabase.ts` | `addCommentReaction`/`removeCommentReaction` 흐름 확장 — 댓글 작성자 조회 + notifications UPSERT/DELETE + activities INSERT/DELETE + 신규 broadcast |
| `electron/main.ts` | IPC 채널: `notifications:fetchCommentReactions`, `notifications:markCommentReactionRead`, `notifications:markAllCommentReactionsRead` |
| `src/preload.ts` | 위 IPC 노출 |
| `src/types/index.ts` | `Activity.actionType` 에 `'comment_reaction'` 추가 |
| `src/types/notifications.ts` | `NotificationType` 에 `'comment_reaction'` 추가, `CommentReactionNotification` interface |
| `src/App.tsx` | catch-up useEffect 신설 + broadcast 리스너 3개 등록 |
| `src/stores/useNotificationStore.ts` | `upsertCommentReaction`, `removeById`, `appendCatchup` actions |
| `src/stores/useActivityStore.ts` | `removeById` action, `activity-removed` 처리 |
| `src/components/notifications/NotificationPanel.tsx` | `type='comment_reaction'` 분기 + 렌더링 |
| `src/components/widgets/activity/ActivityFeed.tsx` | 동사·아이콘 매핑 |
| `src/components/widgets/activity/utils.ts` | (필요 시) `comment_reaction` 그룹 헤더 동사 추가 |
| `src/components/scenes/CommentPanel.tsx` | `data-comment-id`, `scrollToCommentId`, `pulseCommentId` props |
| `src/components/scenes/SceneDetailModal.tsx` | `autoOpenCommentPanel` props 전달 |
| `src/utils/notificationHelper.ts` | `type='comment_reaction'` 점프 분기 |
| `package.json` | 마이너 버전 bump (이모지 알림은 신규 기능) |
| `DEVLOG/update-notes.json` | 비개발자 톤 릴리즈 노트 1개 (한솔 톤 규칙 준수) |

### 영향 없음
- `comment_reactions` 테이블 스키마 — 변경 없음 (기존 그대로)
- 기존 알림 테이블 두 개 — 영향 없음
- 단계 토글/리비전/멘션 — 영향 없음

---

## 테스트 계획

### 단위
- `activities DELETE` 1행 매칭 (가장 최근 1개만) — SQL 정확성
- `emojis JSONB` 배열 push 및 last occurrence 제거 — UPSERT/UPDATE 검증
- `actionGroupOf('comment_reaction') === 'memo'`

### 통합
1. 두 사용자 시뮬레이션 (test fixture)
   - A가 한솔 댓글에 ❤️ → 알림 1행, activities 1행, broadcast 발화 확인
   - A가 ❤️🔥👏 추가 → 알림 동일 행 누적, activities 3행, broadcast 4번
   - A가 ❤️ 떼기 → 알림 emojis ["🔥","👏"]로 축소, activities 2행
   - A가 마지막까지 다 떼기 → 알림 행 DELETE, activities 0행
   - 본인이 자기 댓글에 이모지 → 알림·activities 0건
2. Catch-up: lastSeen 이전 행은 패스, 이후 행만 불러옴
3. 씬 점프: 알림 클릭 → 씬 모달 열림 + 댓글 패널 펼침 + 스크롤 + pulse

### 수동 (한솔 검증)
- 두 PC에서 동시 열고 한 PC에서 이모지 누름 → 다른 PC에 1초 내 알림 토스트 확인
- 알림 클릭 → 댓글로 스크롤 + 강조 확인
- 캐치업: 한 PC 닫고 다른 PC에서 이모지 누름 → 첫 PC 다시 열면 알림 패널에 누적 확인

---

## 마이그레이션·롤백

### 적용 순서
1. SQL 마이그레이션 (라이브 DB)
   - 테이블 생성 + 인덱스 + Realtime publication
   - 멱등성 보장(`IF NOT EXISTS`, DO 블록)
2. 코드 배포 (자동 업데이트)
3. 기존 사용자 첫 실행: `lastSeenCommentReactionAt` 미설정 시 **앱 실행 시각(now)** 으로 초기화
   - **의도**: 업데이트 전 이미 존재하던 반응 알림을 무더기로 retroactive 표시하지 않기 위함. 업데이트 이후의 새 반응부터 알림으로 인지.
   - 사이드 이펙트 없음(이전 데이터 없음 — 본 마이그레이션이 첫 도입).
4. 동시 삭제 멱등성: 두 PC 가 마지막 이모지를 동시에 떼서 양쪽 모두 DELETE 시도 → 두 번째 DELETE 는 0행 RETURNING, broadcast 도 emit X (조건: `if (deletedId) broadcast(...)`). 수신측은 첫 broadcast로 이미 store 제거 완료.

### 롤백
- 코드 롤백 → 신규 broadcast 채널은 무시됨
- SQL 롤백 (필요 시): `DROP TABLE comment_reaction_notifications`. 기존 `comment_reactions`·`activities`에는 영향 없음
- 활동 로그 `actionType='comment_reaction'` 행이 이미 저장된 경우 → 구버전에서 알 수 없는 actionType으로 표시되지만 그룹핑·필터에 영향 없음(기존 코드는 default fallthrough)

---

## 비목표 (YAGNI)

- ❌ 이모지 반응 자체 변경(피커 위치/이모지 종류) — v1.28.0 그대로
- ❌ 멘션 알림 통합 — 별도 시스템 유지
- ❌ 이메일/슬랙 알림 — 인앱만
- ❌ 이모지 반응 일괄 취소 UI — 개별 토글만
- ❌ 알림 그룹화를 댓글 단위가 아닌 씬 단위로 묶기 — 댓글 단위가 정밀도/UX 균형 최적
- ❌ 활동 로그에 "reaction_remove" actionType — 추가만 기록, 취소는 silent DELETE

---

## 후속 작업 (Out of Scope)

- 알림 묶음 미리보기 호버 — emojis 배열을 hover tooltip 으로 보여주는 향상 (v1.29.x+)
- 멀티 사용자 한 줄 묶기 — "A, B, C가 회원님 댓글에 반응했어요" 같은 다중 actor 묶기 (별도 디자인 필요)
- 활동 로그에 단계 토글 취소 일관성 — 본 spec 의 `activity-removed` broadcast는 일반화 가능하지만, 이모지 외 케이스 적용은 별도 의사결정 필요
