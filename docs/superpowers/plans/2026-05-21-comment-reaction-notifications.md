# 댓글 이모지 반응 알림 + 활동 로그 — 구현 플랜

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1.28.0 에서 추가된 댓글 이모지 반응을 알림(`comment_reaction_notifications`) + 활동 로그(`activities.actionType='comment_reaction'`) 인프라와 연결한다. 댓글 작성자에게 차분 톤 알림 + 캐치업/실시간/씬 점프 + 최근 작업 위젯의 묶음 자동 적용.

**Spec:** [`docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md`](../specs/2026-05-21-comment-reaction-notifications-design.md)

**Architecture:** 기존 `acting_feedback_notifications` 패턴 그대로 복제 — DB 영구 기록 + Realtime broadcast + lastSeen catch-up. 활동 로그는 기존 `activities` 테이블에 새 actionType 추가, 5분 윈도우 그룹핑은 기존 utils 그대로 통과. 이모지 취소 시 활동 로그도 행 삭제(새 `activity-removed` broadcast 신설).

**Tech Stack:** TypeScript + React + Electron + Supabase (PostgreSQL + Realtime) + Zustand + `node:test` runner.

---

## 실행 순서 / 검증 게이트

각 청크 끝: `npm run typecheck` 통과 + 새 단위 테스트 통과. 모든 청크 끝나면 `npm run build:vite` 1회 + 수동 동작 확인. 청크별 단일 commit.

1. **Chunk 1** — 데이터 모델 (SQL 마이그레이션 + TypeScript 타입)
2. **Chunk 2** — 백엔드 (electron/supabase.ts add/remove 흐름 확장 + IPC)
3. **Chunk 3** — Stores + App.tsx (catch-up + broadcast 리스너)
4. **Chunk 4** — UI 컴포넌트 (NotificationPanel + ActivityFeed + Scene 점프)
5. **Chunk 5** — 통합 검증 + 릴리즈 노트 + 버전 bump

---

## Chunk 1: 데이터 모델 (SQL + TypeScript 타입)

### Task 1.1 — SQL 마이그레이션 신설

**Files:**
- Create: `DEVLOG/migrations/2026-05-21-comment-reaction-notifications.sql`

- [ ] **Step 1.1.1: 마이그레이션 SQL 작성**

```sql
-- 2026-05-21: 댓글 이모지 반응 알림 테이블
-- spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md

CREATE TABLE IF NOT EXISTS comment_reaction_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    TEXT        NOT NULL,
  comment_id      TEXT        NOT NULL,
  actor_id        TEXT        NOT NULL,
  actor_name      TEXT        NOT NULL,
  scene_id        TEXT,
  episode_number  INTEGER,
  part_id         TEXT,
  dept            TEXT,
  emojis          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  reaction_count  SMALLINT    NOT NULL DEFAULT 0,
  last_action_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  UNIQUE (recipient_id, comment_id, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_crn_recipient_unread
  ON comment_reaction_notifications (recipient_id, read_at NULLS FIRST, last_action_at DESC);

CREATE INDEX IF NOT EXISTS idx_crn_comment
  ON comment_reaction_notifications (comment_id);

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

- [ ] **Step 1.1.2: Supabase 라이브 DB 적용**

`mcp__67cc...__apply_migration` 으로 적용 (project id는 기존 `DEVLOG/migrations/` 인접 SQL 의 적용 로그 확인). 적용 실패 시 SQL 에러 확인 후 멱등성 유지하며 재시도.

- [ ] **Step 1.1.3: Commit (마이그레이션 단독)**

```bash
git add DEVLOG/migrations/2026-05-21-comment-reaction-notifications.sql
git commit -m "feat(db): comment_reaction_notifications 테이블 신설 (이모지 반응 알림)"
```

---

### Task 1.2 — TypeScript 타입 추가

**Files:**
- Modify: `src/types/index.ts` (Activity.actionType 확장)
- Modify: `src/types/notifications.ts` (NotificationType + CommentReactionNotification)
- Find: `src/types/notifications.ts` 가 없으면 `src/types/index.ts` 내부에 정의

- [ ] **Step 1.2.1: 기존 알림 타입 위치 확인**

```bash
grep -rn "NotificationType\|AppNotification\|'acting_feedback'" src/types/
```

→ 위치 확정 후 그 파일에 새 타입 추가.

- [ ] **Step 1.2.2: NotificationType 확장**

```ts
export type NotificationType =
  | 'comment'
  | 'mention'
  | 'acting_feedback'
  | 'scene_assignment'
  | 'comment_reaction';  // 신규
```

- [ ] **Step 1.2.3: CommentReactionNotification 인터페이스 추가**

```ts
export interface CommentReactionNotification {
  id: string;
  type: 'comment_reaction';
  recipientId: string;
  actorId: string;
  actorName: string;
  emojis: string[];          // 누적 (삽입 순서 보존)
  reactionCount: number;
  metadata: {
    sceneId?: string;
    episodeNumber?: number;
    partId?: string;
    dept?: 'bg' | 'act';
    commentId: string;
  };
  createdAt: string;
  lastActionAt: string;
  readAt: string | null;
}

export function lastEmojiOf(n: Pick<CommentReactionNotification, 'emojis'>): string | null {
  return n.emojis.length > 0 ? n.emojis[n.emojis.length - 1] : null;
}
```

- [ ] **Step 1.2.4: Activity.actionType 확장**

`src/types/index.ts` 의 `ActionType` 유니언에 `'comment_reaction'` 추가.

```ts
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'phase_wait' | 'phase_work' | 'phase_feedback' | 'phase_done'
  | 'memo_update' | 'comment_add'
  | 'revision_add' | 'revision_in_progress' | 'revision_resolve' | 'revision_delete' | 'revision_comment'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide'
  | 'comment_reaction';   // 신규
```

- [ ] **Step 1.2.5: `src/components/widgets/activity/constants.ts` — 3개 Record 동시 업데이트**

**중요**: `ActionType` 유니언에 새 멤버 추가하면 `ACTION_TYPE_TO_GROUP`, `ACTION_TYPE_LABEL`, `ACTION_TYPE_COLOR` 세 `Record<ActionType, …>` 모두 entry 추가 안 하면 typecheck FAIL (exhaustiveness).

```ts
// ACTION_TYPE_TO_GROUP — 'memo' 카테고리
comment_reaction: 'memo',

// ACTION_TYPE_LABEL — 사용자 노출 한국어
comment_reaction: '이모지 반응',

// ACTION_TYPE_COLOR — 메모 톤 인근 색 (comment_add #FFA94D · memo_update #FF8FA3 사이)
// 이모지 자체가 시각적 hook 이라 부드러운 보라/핑크 톤이 자연스러움
comment_reaction: '#C8A2D8',
```

세 위치 모두 동일 commit 안에 함께 추가. `ActivityFeed.tsx` / `ActivityFilterChips.tsx` / `RecentActivityWidget.tsx` 는 이 Record 를 직접 읽으므로 추가 변경 불필요.

- [ ] **Step 1.2.6: typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 1.2.7: Commit**

```bash
git add src/types/ src/components/widgets/activity/constants.ts
git commit -m "feat(types): comment_reaction 알림·활동 타입 + 3개 Record entry 추가"
```

---

## Chunk 2: 백엔드 (electron supabase + main + preload)

### Task 2.1 — `addCommentReaction` 흐름 확장

**Files:**
- Modify: `electron/supabase.ts` (`addCommentReaction` 함수)

- [ ] **Step 2.1.1a: 댓글 SELECT 스키마 사전 확인 (자명한 가정 차단)**

```bash
grep -n "from('comments')" electron/supabase.ts
grep -n "scene_uuid\|episode_number\|part_id\|dept" electron/supabase.ts | head -30
```

목표: `comments` 테이블 실제 컬럼명(`user_id`, `user_name`, `scene_id`, `scene_uuid`, `part_id`, `text`, `revision_id`)과 scenes 테이블의 episode/part/dept 조회 패턴을 확정. 인접 함수 `readCommentsForPart` / `addComment` (electron/supabase.ts:1269/1295) 의 SELECT 형식을 그대로 모방.

- [ ] **Step 2.1.1b: 댓글 author 조회 헬퍼 추가**

`electron/supabase.ts` 내부 private 헬퍼 (단일 `comments` 테이블 — `revision_id` 컬럼으로 일반/리비전 구분):

```ts
async function fetchCommentContext(commentId: string): Promise<{
  authorId: string;
  authorName: string;
  sceneId?: string;       // 점프 시 sceneStore 가 요구하는 형태(sort_order 문자열)
  sceneUuid?: string;     // 내부 조인용
  episodeNumber?: number;
  partId?: string;
  dept?: 'bg' | 'act';
  commentPreview?: string;
} | null> {
  const { data: comment, error } = await supabase
    .from('comments')
    .select('user_id, user_name, scene_id, scene_uuid, part_id, text, revision_id')
    .eq('id', commentId)
    .maybeSingle();
  if (error || !comment) return null;

  // scene 컨텍스트(episode/dept) 는 scenes 테이블에서 별도 조회.
  // 인접 함수(readCommentsForPart 등)에서 사용되는 컬럼명을 그대로 따름.
  // scenes 스키마와 실제 매칭은 Step 2.1.1a 결과로 확정.
  let episodeNumber: number | undefined;
  let dept: 'bg' | 'act' | undefined;
  if (comment.scene_uuid) {
    const { data: scene } = await supabase
      .from('scenes')
      .select('episode_number, dept')
      .eq('id', comment.scene_uuid)
      .maybeSingle();
    episodeNumber = scene?.episode_number;
    dept = scene?.dept;
  }

  return {
    authorId: comment.user_id,
    authorName: comment.user_name,
    sceneId: comment.scene_id,
    sceneUuid: comment.scene_uuid,
    episodeNumber,
    partId: comment.part_id,
    dept,
    commentPreview: (comment.text ?? '').slice(0, 30),
  };
}
```

**주의**: `scenes` 의 `episode_number` / `dept` 컬럼명은 Step 2.1.1a 결과로 확정. 실제 컬럼명이 `episode` 또는 `department` 면 SELECT 와 반환 mapping 모두 그에 맞춤. **개발자가 추측으로 작성하지 말 것** — grep 결과를 보고 결정.

- [ ] **Step 2.1.2: addCommentReaction 함수 확장**

기존 INSERT 후 다음 분기 추가:

```ts
// 기존: comment_reactions INSERT
const inserted = await supabase.from('comment_reactions').insert({...}).select().maybeSingle();
if (!inserted.data) return { ok: true, inserted: false }; // UNIQUE 충돌 → 무시

// 신규: context 조회 + 알림/활동 분기
const ctx = await fetchCommentContext(commentId);
if (!ctx) {
  console.warn('[reaction] 고아 reaction 감지 (comment 조회 실패):', commentId);
  // 활동 로그도 안 남김 (씬 정보 없으면 그룹핑·점프 불가)
  return { ok: true, inserted: true };
}

// 활동 로그 (자기 자신이어도 INSERT)
const activityRow = await supabase.from('activities').insert({
  user_id: userId,
  user_name: userName,
  action_type: 'comment_reaction',
  action_group: 'memo',
  scene_id: ctx.sceneId,
  episode_number: ctx.episodeNumber,
  part_id: ctx.partId,
  department: ctx.dept,
  detail: { commentId, emoji, commentAuthorId: ctx.authorId, commentPreview: ctx.commentPreview },
  created_at: new Date().toISOString(),
}).select().maybeSingle();

// 자기 자신이면 알림 분기 종료
if (ctx.authorId === userId) {
  broadcastCommentReactionChanged({ commentId });
  if (activityRow.data) broadcastActivityAdded(activityRow.data);
  return { ok: true, inserted: true };
}

// 알림 UPSERT
const notifRow = await supabase.rpc('upsert_comment_reaction_notification', {
  p_recipient: ctx.authorId,
  p_comment: commentId,
  p_actor: userId,
  p_actor_name: userName,
  p_scene: ctx.sceneId,
  p_episode: ctx.episodeNumber,
  p_part: ctx.partId,
  p_dept: ctx.dept,
  p_emoji: emoji,
});
// 또는 raw SQL 사용 — 아래 Step 2.1.3 의 RPC vs raw 선택 참조
```

- [ ] **Step 2.1.3: UPSERT를 raw SQL로 처리 (RPC 함수 생성 부담 회피)**

`@supabase/supabase-js` 가 raw 텍스트 SQL UPSERT 를 직접 지원하지 않으므로 두 가지 옵션:

**옵션 A (선택)** — application 측에서 SELECT 후 INSERT 또는 UPDATE 분기:

```ts
// 1) 기존 행 있는지 확인
const existing = await supabase.from('comment_reaction_notifications')
  .select('id, emojis, reaction_count')
  .eq('recipient_id', ctx.authorId)
  .eq('comment_id', commentId)
  .eq('actor_id', userId)
  .maybeSingle();

let notifRow;
if (existing.data) {
  // UPDATE — emojis 배열 push, count++, read_at=null
  const newEmojis = [...(existing.data.emojis ?? []), emoji];
  notifRow = await supabase.from('comment_reaction_notifications')
    .update({
      emojis: newEmojis,
      reaction_count: existing.data.reaction_count + 1,
      last_action_at: new Date().toISOString(),
      read_at: null,
    })
    .eq('id', existing.data.id)
    .select().maybeSingle();
} else {
  // INSERT 신규
  notifRow = await supabase.from('comment_reaction_notifications').insert({
    recipient_id: ctx.authorId,
    comment_id: commentId,
    actor_id: userId,
    actor_name: userName,
    scene_id: ctx.sceneId,
    episode_number: ctx.episodeNumber,
    part_id: ctx.partId,
    dept: ctx.dept,
    emojis: [emoji],
    reaction_count: 1,
    last_action_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    read_at: null,
  }).select().maybeSingle();
}
```

**주의**: 옵션 A 는 동시성 race window 존재 (두 PC 가 동시 INSERT 시도 시 둘 다 UNIQUE conflict). 처리: INSERT 실패 시 SELECT 재조회 + UPDATE retry 1회. 코드:

```ts
if (notifRow.error?.code === '23505') {  // UNIQUE violation
  const retry = await supabase.from('comment_reaction_notifications')
    .select('id, emojis, reaction_count')
    .eq('recipient_id', ctx.authorId)
    .eq('comment_id', commentId)
    .eq('actor_id', userId)
    .single();
  if (retry.data) {
    notifRow = await supabase.from('comment_reaction_notifications')
      .update({
        emojis: [...(retry.data.emojis ?? []), emoji],
        reaction_count: retry.data.reaction_count + 1,
        last_action_at: new Date().toISOString(),
        read_at: null,
      }).eq('id', retry.data.id).select().maybeSingle();
  }
}
```

**옵션 B** — Supabase 에 PL/pgSQL 함수 `upsert_comment_reaction_notification` 미리 만들고 RPC 호출.
- 장점: race-free (DB 락)
- 단점: 마이그레이션에 함수 정의 추가

→ **선택: 옵션 A + retry**. 함수 생성 부담 없음. 동시 INSERT race 는 retry로 수렴.

- [ ] **Step 2.1.4: 알림 broadcast 발화**

```ts
if (notifRow.data) {
  await broadcastCommentReactionNotification({
    notification: serializeNotification(notifRow.data),
  });
}
if (activityRow.data) {
  await broadcastActivityAdded(activityRow.data);
}
broadcastCommentReactionChanged({ commentId });
return { ok: true, inserted: true };
```

`broadcastCommentReactionNotification`, `broadcastActivityAdded` 는 신규 또는 기존 `broadcastCommentReactionChanged` 패턴을 따라 생성 (`broadcastChannel.send({ event, payload })`).

- [ ] **Step 2.1.5: typecheck**

```bash
npm run typecheck
```

---

### Task 2.2 — `removeCommentReaction` 흐름 확장

**Files:**
- Modify: `electron/supabase.ts` (`removeCommentReaction` 함수)

- [ ] **Step 2.2.1: DELETE 후 알림/활동 정리**

기존 DELETE 후:

```ts
const deleted = await supabase.from('comment_reactions')
  .delete().eq('comment_id', commentId).eq('user_id', userId).eq('emoji', emoji)
  .select().maybeSingle();
if (!deleted.data) return { ok: true, removed: false };  // 행 없음

const ctx = await fetchCommentContext(commentId);

// 활동 로그 — 가장 최근 매칭 1행 DELETE (자기 자신이어도)
const removedActivity = await supabase.rpc('delete_latest_reaction_activity', {
  p_user: userId, p_comment: commentId, p_emoji: emoji,
});
// 또는 raw SQL workaround — Step 2.2.2 참조
```

- [ ] **Step 2.2.2: `activities` DELETE 가장 최근 1행 — application workaround**

Supabase JS 클라이언트가 `DELETE ... ORDER BY ... LIMIT` 미지원이라 두 단계:

```ts
const target = await supabase.from('activities')
  .select('id')
  .eq('user_id', userId)
  .eq('action_type', 'comment_reaction')
  .filter('detail->>commentId', 'eq', commentId)
  .filter('detail->>emoji', 'eq', emoji)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();

let removedActivityId: string | null = null;
if (target.data) {
  const del = await supabase.from('activities')
    .delete().eq('id', target.data.id).select('id').maybeSingle();
  removedActivityId = del.data?.id ?? null;
}
```

- [ ] **Step 2.2.3: 알림 행 업데이트/삭제 (자기 자신 아닐 때만)**

```ts
let notifRemovalPayload: {
  recipientId: string;
  notificationId: string;
  deleted: boolean;
  emoji: string;
  commentId: string;
  actorId: string;
} | null = null;

if (ctx && ctx.authorId !== userId) {
  const cur = await supabase.from('comment_reaction_notifications')
    .select('id, emojis, reaction_count')
    .eq('recipient_id', ctx.authorId)
    .eq('comment_id', commentId)
    .eq('actor_id', userId)
    .maybeSingle();
  if (cur.data) {
    // emojis 에서 해당 이모지 1개 제거 (last occurrence)
    const idx = (cur.data.emojis as string[]).lastIndexOf(emoji);
    const next = idx >= 0
      ? [...(cur.data.emojis as string[]).slice(0, idx), ...(cur.data.emojis as string[]).slice(idx + 1)]
      : (cur.data.emojis as string[]);
    const nextCount = Math.max(0, cur.data.reaction_count - 1);
    if (nextCount === 0 || next.length === 0) {
      await supabase.from('comment_reaction_notifications').delete().eq('id', cur.data.id);
      notifRemovalPayload = {
        recipientId: ctx.authorId, notificationId: cur.data.id, deleted: true,
        emoji, commentId, actorId: userId,
      };
    } else {
      await supabase.from('comment_reaction_notifications').update({
        emojis: next, reaction_count: nextCount,
        // read_at, last_action_at, created_at 건드리지 않음
      }).eq('id', cur.data.id);
      notifRemovalPayload = {
        recipientId: ctx.authorId, notificationId: cur.data.id, deleted: false,
        emoji, commentId, actorId: userId,
      };
    }
  }
}
```

**Race note**: 두 PC 동시 마지막 이모지 DELETE → 양쪽 모두 cur.data 읽고 둘 다 DELETE 시도 → 두 번째는 0행 영향, payload 둘 다 emit 되어도 receiver 가 `removeById` no-op 처리하므로 OK.

- [ ] **Step 2.2.4: broadcast 발화**

```ts
broadcastCommentReactionChanged({ commentId });
if (notifRemovalPayload) {
  await broadcastCommentReactionNotificationRemoved(notifRemovalPayload);
}
if (removedActivityId) {
  await broadcastActivityRemoved({ activityId: removedActivityId });
}
return { ok: true, removed: true };
```

`broadcastActivityRemoved` 는 신규.

- [ ] **Step 2.2.5: typecheck**

---

### Task 2.3 — 댓글 삭제 시 cleanup

**Files:**
- Modify: `electron/supabase.ts` — 기존 `deleteComment` 함수 (line ~1372)

- [ ] **Step 2.3.1: deleteComment 함수 끝부분에 cleanup 3종 추가 (단일 함수 — 일반/리비전 댓글 모두 처리)**

`deleteComment` 는 단일 함수이며 `comments` 테이블에 일반 댓글·리비전 댓글이 모두 저장됨(`revision_id` 컬럼으로 구분). 따라서 별도 분기 없이 한 곳에서 처리.

기존 row 삭제(line 1387 인근) 이후 다음 추가:

```ts
// 댓글 row 삭제 직후 (storage 정리는 별도 fire-and-forget 흐름)
// best-effort 순차 cleanup — supabase-js 단일 트랜잭션 미지원이라 실패 시 WARN log + 다음 단계 진행
try {
  await supabase.from('comment_reactions').delete().eq('comment_id', commentId);
} catch (e) {
  console.warn('[deleteComment] comment_reactions cleanup 실패:', e);
}
try {
  await supabase.from('comment_reaction_notifications').delete().eq('comment_id', commentId);
  // recipient 들에게 알림 사라짐 broadcast 는 생략 가능 — 댓글 자체가 사라지면 점프 대상도 없으므로
  // catch-up 시 자연 정합화 또는 추후 별도 broadcast 추가
} catch (e) {
  console.warn('[deleteComment] comment_reaction_notifications cleanup 실패:', e);
}
try {
  // activities — 영향 받은 행 id 들 먼저 조회 → DELETE → 각 id 별 broadcast
  const { data: affected } = await supabase
    .from('activities')
    .select('id')
    .eq('action_type', 'comment_reaction')
    .filter('detail->>commentId', 'eq', commentId);
  if (affected?.length) {
    await supabase.from('activities').delete().in('id', affected.map(r => r.id));
    for (const row of affected) {
      broadcastActivityRemoved({ activityId: row.id });
    }
  }
} catch (e) {
  console.warn('[deleteComment] activities cleanup 실패:', e);
}
```

**트랜잭션 주의**: supabase-js 4개 요청은 별개 라운드트립. 실패 한 단계가 다음을 막지 않음. orphan 데이터 발생 가능성은 차후 cleanup job 또는 monitoring 으로 처리(spec 후속 작업 항목).

- [ ] **Step 2.3.2: typecheck**

- [ ] **Step 2.3.3: Commit (백엔드 한 번에)**

```bash
git add electron/supabase.ts
git commit -m "feat(electron): 이모지 반응 알림·활동 로그 생성/취소/cleanup 흐름 추가"
```

---

### Task 2.4 — IPC 채널 + preload 노출

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts` 또는 `src/preload.ts` (위치 확인)

- [ ] **Step 2.4.1: IPC handler 등록**

`electron/main.ts` 내 기존 알림 IPC 인접 위치에 추가:

```ts
ipcMain.handle('notifications:fetchCommentReactions', async (_e, args: {
  recipientId: string;
  since?: string;     // ISO timestamp — 이 이후 last_action_at 만
  limit?: number;
  offset?: number;
  ids?: string[];     // 단일 또는 일부 fetch (refetch 케이스)
}) => {
  return await supabaseService.fetchCommentReactionNotifications(args);
});
ipcMain.handle('notifications:markCommentReactionRead', async (_e, { id }) => {
  return await supabaseService.markCommentReactionRead(id);
});
ipcMain.handle('notifications:markAllCommentReactionsRead', async (_e, { recipientId }) => {
  return await supabaseService.markAllCommentReactionsRead(recipientId);
});
```

해당 service 함수 3개를 `electron/supabase.ts` 에 추가 (단순 SELECT/UPDATE).

- [ ] **Step 2.4.2: preload 에 노출**

```ts
// preload.ts
contextBridge.exposeInMainWorld('electron', {
  // 기존 ...
  notifications: {
    // 기존 ...
    fetchCommentReactions: (args) => ipcRenderer.invoke('notifications:fetchCommentReactions', args),
    markCommentReactionRead: (args) => ipcRenderer.invoke('notifications:markCommentReactionRead', args),
    markAllCommentReactionsRead: (args) => ipcRenderer.invoke('notifications:markAllCommentReactionsRead', args),
  },
});
```

`window.electron.notifications` 가 이미 존재하면 그 안에 추가, 아니면 기존 패턴 따라.

- [ ] **Step 2.4.3: typecheck**

- [ ] **Step 2.4.4: Commit**

```bash
git add electron/main.ts electron/preload.ts src/preload.ts 2>/dev/null || true
git commit -m "feat(ipc): 이모지 반응 알림 fetch/markRead IPC 채널 추가"
```

---

## Chunk 3: Stores + App.tsx (catch-up + broadcast 리스너)

### Task 3.1 — `useNotificationStore` 확장

**Files:**
- Modify: `src/stores/useNotificationStore.ts`

- [ ] **Step 3.1.1: store actions 추가**

```ts
interface NotificationStoreState {
  // 기존 ...
  notifications: AppNotification[];
}

interface NotificationStoreActions {
  // 기존 ...
  upsertCommentReaction: (n: CommentReactionNotification) => void;
  removeById: (id: string) => void;
  appendCatchupCommentReactions: (rows: CommentReactionNotification[]) => void;
  refetchCommentReaction: (id: string) => Promise<void>;
}

// 구현
upsertCommentReaction: (n) => set((s) => {
  const idx = s.notifications.findIndex(x => x.id === n.id);
  if (idx >= 0) {
    const next = [...s.notifications];
    next[idx] = n;
    return { notifications: next };
  }
  return { notifications: [n, ...s.notifications] };
}),
removeById: (id) => set((s) => ({
  notifications: s.notifications.filter(x => x.id !== id),
})),
appendCatchupCommentReactions: (rows) => set((s) => {
  const seen = new Set(s.notifications.map(n => n.id));
  const fresh = rows.filter(r => !seen.has(r.id));
  return { notifications: [...fresh, ...s.notifications] };
}),
refetchCommentReaction: async (id) => {
  const currentUserId = useUserStore.getState().currentUserId;
  if (!currentUserId) return;
  const res = await window.electron.notifications.fetchCommentReactions({
    recipientId: currentUserId,
    ids: [id],
    limit: 1,
  });
  const row = res?.data?.[0];
  if (row) {
    set((s) => {
      const idx = s.notifications.findIndex(x => x.id === id);
      if (idx >= 0) {
        const next = [...s.notifications];
        next[idx] = row;
        return { notifications: next };
      }
      return s;
    });
  } else {
    // 행이 사라졌으면 store 에서도 제거 (race fallback)
    set((s) => ({ notifications: s.notifications.filter(x => x.id !== id) }));
  }
}
```

`fetchCommentReactions` IPC 의 `ids?: string[]` 옵션을 Task 2.4.1 에서 함께 정의 — refetch 경로 단일 채널.

- [ ] **Step 3.1.2: typecheck**

---

### Task 3.2 — `useActivityStore.removeById` 추가

**Files:**
- Modify: `src/stores/useActivityStore.ts`

- [ ] **Step 3.2.1: removeById action 추가**

```ts
removeById: (id: string) => set((s) => ({
  activities: s.activities.filter(a => a.id !== id),
  // statsGrid 업데이트는 단순화: receiveRealtime 이 add 만 처리하던 패턴 그대로,
  // remove 는 다음 fetch 라운드에서 자연 정합화. 즉시 grid 빼지 않음.
})),
```

- [ ] **Step 3.2.2: typecheck**

- [ ] **Step 3.2.3: Commit (stores 두 개)**

```bash
git add src/stores/
git commit -m "feat(stores): 이모지 반응 알림 upsert/remove + activity removeById 액션"
```

---

### Task 3.3 — App.tsx catch-up useEffect + broadcast 리스너

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 3.3.1: 기존 acting_feedback catch-up 위치 확인**

```bash
grep -n "fetchActingFeedbackNotifications\|lastSeenActingFeedback" src/App.tsx
```

→ 그 패턴 그대로 복제.

- [ ] **Step 3.3.2: catch-up useEffect 추가**

```ts
useEffect(() => {
  if (!currentUserId) return;
  const STORAGE_KEY = 'bflow:lastSeenCommentReactionAt';
  const PAGE_SIZE = 100;
  const SAFE_CAP = 1000;

  const lastSeen = localStorage.getItem(STORAGE_KEY) ?? new Date().toISOString();
  let cancelled = false;

  (async () => {
    let page = 0;
    let total = 0;
    while (!cancelled && total < SAFE_CAP) {
      const res = await window.electron.notifications.fetchCommentReactions({
        recipientId: currentUserId,
        since: lastSeen,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (!res?.data?.length) break;
      notificationStore.appendCatchupCommentReactions(res.data);
      total += res.data.length;
      if (res.data.length < PAGE_SIZE) break;
      page++;
    }
    if (!cancelled) {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    }
  })();

  return () => { cancelled = true; };
}, [currentUserId]);
```

- [ ] **Step 3.3.3: broadcast 리스너 3개 추가**

기존 broadcast 등록 위치에 인접하여:

```ts
useEffect(() => {
  const offNotif = broadcast.on('comment-reaction-notification', (payload) => {
    if (payload.notification.recipientId !== currentUserId) return;
    notificationStore.upsertCommentReaction(payload.notification);
    if (!notificationPanelOpen) {
      // 토스트 (옵션) — 기존 'comment' 알림 토스트 패턴 따름
      showToast({ /* ... */ });
    }
  });
  const offNotifRemoved = broadcast.on('comment-reaction-notification-removed', (payload) => {
    if (payload.recipientId !== currentUserId) return;
    if (payload.deleted) {
      notificationStore.removeById(payload.notificationId);
    } else {
      notificationStore.refetchCommentReaction(payload.notificationId);
    }
  });
  const offActRemoved = broadcast.on('activity-removed', (payload) => {
    activityStore.removeById(payload.activityId);
  });
  return () => { offNotif(); offNotifRemoved(); offActRemoved(); };
}, [currentUserId, notificationPanelOpen]);
```

- [ ] **Step 3.3.4: typecheck**

- [ ] **Step 3.3.5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): 이모지 반응 catch-up + 3종 realtime 리스너"
```

---

## Chunk 4: UI 컴포넌트

### Task 4.1 — NotificationPanel 분기 추가

**Files:**
- Modify: `src/components/notifications/NotificationPanel.tsx`

- [ ] **Step 4.1.1: type='comment_reaction' 렌더링 분기**

기존 type별 switch 위치 인접에:

```tsx
case 'comment_reaction': {
  const last = lastEmojiOf(n) ?? '💬';
  const emojiText = n.emojis.length > 5
    ? `${n.emojis.slice(0, 5).join('')}+${n.emojis.length - 5}`
    : n.emojis.join('');
  return (
    <NotificationRow
      icon={<span className="text-base">{last}</span>}
      tone="muted"               // 'comment' 와 동일
      title={`${n.actorName}가 회원님 댓글에 ${emojiText} 반응을 남겼어요`}
      time={n.lastActionAt}
      unread={!n.readAt}
      onClick={() => {
        window.electron.notifications.markCommentReactionRead({ id: n.id });
        navigateToScene({
          type: 'comment_reaction',
          metadata: n.metadata,
        });
      }}
    />
  );
}
```

기존 `NotificationRow` 또는 동등 컴포넌트의 prop 이름·시그니처에 맞춰 조정.

- [ ] **Step 4.1.2: in-view auto-read 훅 적용**

기존 `useInViewMarkRead` 또는 동등 훅이 있으면 새 type 도 같은 훅에 포함. 없으면 기존 'comment' 알림이 어떻게 자동 읽음 처리되는지 확인 후 동일 패턴 적용.

- [ ] **Step 4.1.3: typecheck**

---

### Task 4.2 — ActivityFeed actionType 매핑

**Files:**
- Modify: `src/components/widgets/activity/utils.ts`
- Modify: `src/components/widgets/activity/ActivityFeed.tsx`

- [ ] **Step 4.2.1: 동사·아이콘 매핑 추가**

`utils.ts` 의 actionType → 동사 매핑 함수에:

```ts
case 'comment_reaction':
  return '이모지 반응을 남겼어요';
```

아이콘 매핑:

```ts
case 'comment_reaction':
  return '💬'; // 또는 detail.emoji 가 있으면 그걸로
```

- [ ] **Step 4.2.2: FeedItemRow 렌더링 — detail.emoji 표시**

```tsx
{actionType === 'comment_reaction' && detail?.emoji && (
  <span className="ml-1">{detail.emoji}</span>
)}
```

- [ ] **Step 4.2.3: 그룹 헤더 라벨**

기존 group label 함수에 `'comment_reaction'` → "이모지 반응" 추가.

- [ ] **Step 4.2.4: 단위 테스트 — 그룹핑 동작 검증**

`tests/commentReactionActivityGrouping.test.ts` 신규:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupActivities } from '../src/components/widgets/activity/utils.ts';
import type { Activity } from '../src/types/index.ts';

const base = (overrides: Partial<Activity>): Activity => ({
  id: 'a1', userId: 'u1', userName: '한솔', actionType: 'comment_reaction',
  actionGroup: 'memo', sceneId: 'scene-1', sceneLabel: 'EP01 #01',
  episodeNumber: 1, department: 'bg', detail: { emoji: '❤️', commentId: 'c1' },
  createdAt: '2026-05-21T00:00:00.000Z', ...overrides,
});

test('same user/scene/5min 내 comment_reaction → 1 group', () => {
  const acts = [
    base({ id: 'a1', detail: { emoji: '❤️', commentId: 'c1' }, createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', detail: { emoji: '🔥', commentId: 'c1' }, createdAt: '2026-05-21T00:01:00Z' }),
    base({ id: 'a3', detail: { emoji: '👏', commentId: 'c1' }, createdAt: '2026-05-21T00:02:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'group');
});

test('6분 간격 → 2 groups', () => {
  const acts = [
    base({ id: 'a1', createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', createdAt: '2026-05-21T00:06:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});
```

- [ ] **Step 4.2.5: 이모지 묶음 truncation 헬퍼 + 테스트**

`src/types/notifications.ts` (또는 인접) 에 헬퍼:

```ts
export function formatReactionEmojiList(emojis: string[], maxVisible: number = 5): string {
  if (emojis.length <= maxVisible) return emojis.join('');
  return emojis.slice(0, maxVisible).join('') + `+${emojis.length - maxVisible}`;
}
```

`tests/commentReactionEmojiFormat.test.ts` 신규:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReactionEmojiList } from '../src/types/notifications.ts';

test('5개 이하 → 전부 표시', () => {
  assert.equal(formatReactionEmojiList(['❤️','🔥']), '❤️🔥');
  assert.equal(formatReactionEmojiList(['❤️','🔥','👏','🎉','💯']), '❤️🔥👏🎉💯');
});

test('5개 초과 → 첫 5개 + "+N"', () => {
  assert.equal(
    formatReactionEmojiList(['❤️','🔥','👏','🎉','💯','✨','🙌']),
    '❤️🔥👏🎉💯+2'
  );
});

test('빈 배열 → 빈 문자열', () => {
  assert.equal(formatReactionEmojiList([]), '');
});
```

NotificationPanel 의 Step 4.1.1 에서 `emojiText` 인라인 계산을 이 헬퍼 호출로 교체.

- [ ] **Step 4.2.6: 테스트 실행**

```bash
node --test tests/commentReactionActivityGrouping.test.ts tests/commentReactionEmojiFormat.test.ts
```

Expected: 두 파일 모두 PASS

- [ ] **Step 4.2.7: typecheck**

---

### Task 4.3 — CommentPanel 스크롤 타겟 + SceneDetailModal props

**Files:**
- Modify: `src/components/scenes/CommentPanel.tsx`
- Modify: `src/components/scenes/SceneDetailModal.tsx`

- [ ] **Step 4.3.1: CommentPanel 댓글 wrapper 에 data attribute**

```tsx
<div data-comment-id={comment.id} className="...">
  {/* 댓글 내용 */}
</div>
```

- [ ] **Step 4.3.2: CommentPanel scrollTo/pulse props**

```tsx
interface CommentPanelProps {
  // 기존 ...
  scrollToCommentId?: string;
  pulseCommentId?: string;
}

useEffect(() => {
  if (!scrollToCommentId) return;
  const el = panelRef.current?.querySelector(`[data-comment-id="${scrollToCommentId}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [scrollToCommentId]);

useEffect(() => {
  if (!pulseCommentId) return;
  const el = panelRef.current?.querySelector(`[data-comment-id="${pulseCommentId}"]`);
  if (!el) return;
  el.classList.add('animate-target-pulse');
  const t = setTimeout(() => el.classList.remove('animate-target-pulse'), 1600);
  return () => clearTimeout(t);
}, [pulseCommentId]);
```

**CSS 클래스명**: 기존 코드는 `comment-target-pulse` (정의: `src/styles/comment-panel.css` line 116, `comment-target-pulse-anim` 1.6s keyframe). 위 스니펫에서 `animate-target-pulse` 대신 `comment-target-pulse` 사용. 추가 CSS 작성 불필요 — 기존 클래스 재사용.

```tsx
// 정정된 pulse 적용:
el.classList.add('comment-target-pulse');
const t = setTimeout(() => el.classList.remove('comment-target-pulse'), 1600);
```

- [ ] **Step 4.3.3: SceneDetailModal props 추가**

```tsx
interface SceneDetailModalProps {
  // 기존 ...
  autoOpenCommentPanel?: boolean;
  scrollToCommentId?: string;
  pulseCommentId?: string;
}

// 초기 상태
const [commentPanelOpen, setCommentPanelOpen] = useState(autoOpenCommentPanel ?? false);

// CommentPanel 에 props 전달
<CommentPanel
  scrollToCommentId={scrollToCommentId}
  pulseCommentId={pulseCommentId}
  // ...
/>
```

- [ ] **Step 4.3.4: typecheck**

---

### Task 4.4 — notificationHelper 점프 분기

**Files:**
- Modify: `src/utils/notificationHelper.ts`

- [ ] **Step 4.4.1: navigateToScene 분기 확장**

```ts
export function navigateToScene(params: {
  type: NotificationType;
  metadata: { sceneId?: string; episodeNumber?: number; partId?: string; dept?: string; commentId?: string };
}) {
  const { type, metadata } = params;

  // 기존 dept/episode/part 설정 코드 ...
  useDashboardStore.getState().setDeptFilter('all');
  useEpisodeStore.getState().setActiveEpisode(metadata.episodeNumber);
  // ...

  if (type === 'comment_reaction' || type === 'comment' || type === 'mention') {
    sceneStore.openSceneModal(metadata.sceneId, {
      autoOpenCommentPanel: true,
      scrollToCommentId: metadata.commentId,
      pulseCommentId: metadata.commentId,
    });
  } else {
    sceneStore.openSceneModal(metadata.sceneId, {});
  }
}
```

기존 함수 시그니처 확인 후 정확한 위치에 분기 추가. `openSceneModal` 시그니처에 신규 옵션 3개 추가.

- [ ] **Step 4.4.2: typecheck**

- [ ] **Step 4.4.3: Commit (UI 4개 한 번에)**

```bash
git add src/components/notifications/ src/components/widgets/activity/ src/components/scenes/CommentPanel.tsx src/components/scenes/SceneDetailModal.tsx src/utils/notificationHelper.ts tests/commentReactionActivityGrouping.test.ts
git commit -m "feat(ui): 이모지 반응 알림 패널 + 활동 위젯 매핑 + 씬 점프 스크롤"
```

---

## Chunk 5: 통합 검증 + 릴리즈 노트 + 버전 bump

### Task 5.1 — 빌드 검증

- [ ] **Step 5.1.1: 전체 typecheck**

```bash
npm run typecheck
```

Expected: PASS, 에러 0

- [ ] **Step 5.1.2: auto-update 회귀 테스트**

```bash
npm run test:auto-update
```

Expected: PASS (영향 없음 확인)

- [ ] **Step 5.1.3: 새 단위 테스트 실행**

```bash
node --test tests/commentReactionActivityGrouping.test.ts tests/commentReactionEmojiFormat.test.ts
```

Expected: 두 파일 모두 PASS

- [ ] **Step 5.1.4: vite 빌드**

```bash
npm run build:vite
```

Expected: PASS, dist 산출물 생성

---

### Task 5.2 — 수동 테스트 체크리스트 (한솔 검증용)

DEVLOG/auto-update-test-scenario.md 와 같은 위치에 작성하거나 PR 본문에 포함.

- [ ] **Step 5.2.1: 체크리스트 작성 (PR 본문에 포함)**

```markdown
## 테스트 가이드

1. 두 PC(또는 두 계정)로 동시 접속
2. PC1 → 씬 댓글 작성, PC2 → 그 댓글에 ❤️ 누르기
   - 기대: PC1 알림 패널에 "OO가 회원님 댓글에 ❤️ 반응을 남겼어요" 1초 내 표시
3. PC2 → 같은 댓글에 🔥, 👏 연속 누르기
   - 기대: PC1 알림이 한 줄에 ❤️🔥👏 누적, "안 읽음" 으로 다시 살아남
4. PC1 → 알림 클릭
   - 기대: 씬 상세 창 열림 → 우측 댓글 패널 자동 펼침 → 해당 댓글 위치로 스크롤 + 1.6초 강조
5. PC2 → ❤️ 떼기
   - 기대: PC1 알림이 🔥👏 두 개로 줄어듦, 최근 작업 위젯의 ❤️ 줄도 사라짐
6. PC2 → 🔥, 👏 마저 떼기
   - 기대: PC1 알림 줄 자체 사라짐
7. PC1 → 자기 댓글에 자기가 이모지
   - 기대: 알림 발생 X, 최근 작업 위젯에는 기록됨 (PC2에서 보면 보임)
8. 캐치업: PC1 종료 → PC2 가 PC1 댓글에 이모지 → PC1 다시 실행
   - 기대: PC1 알림 패널에 자동으로 새 알림 누적
9. 댓글 삭제: PC1 → 댓글 삭제
   - 기대: 그 댓글의 모든 이모지·알림·활동로그 정리됨 (PC1·PC2 모두)
```

---

### Task 5.3 — 버전 bump + 업데이트 노트

**Files:**
- Modify: `package.json` (1.28.0 → 1.29.0)
- Modify: `DEVLOG/update-notes.json`

- [ ] **Step 5.3.1: package.json 마이너 bump**

`"version": "1.28.0"` → `"version": "1.29.0"`

- [ ] **Step 5.3.2: update-notes.json 항목 추가 (비개발자 톤 — CLAUDE.md 규칙 준수)**

기존 `update-notes.json` 최상단(또는 형식 따라) 에 1개 항목 추가:

```json
{
  "version": "1.29.0",
  "date": "2026-05-21",
  "summary": "내 댓글에 이모지 받으면 이제 알람이 와요",
  "description": "지금까지는 누가 내 댓글에 ❤️ 같은 이모지를 달아도 알림 패널에 표시되지 않았는데, 이제 차분한 톤으로 알림이 도착해요. 같은 사람이 ❤️🔥👏 연속으로 누르면 한 줄로 묶여서 보이고, 잘못 누르고 다시 떼면 조용히 사라져요. 알림을 누르면 해당 씬 상세 창이 열리면서 그 댓글 위치까지 자동으로 이동해 강조 표시까지 해줘요. 앱을 꺼둔 사이에 받은 반응도 다음 실행 때 자동으로 모아 보여줘요. 최근 작업 목록의 '댓글·메모' 칸에서도 누가 어떤 이모지를 남겼는지 확인할 수 있어요."
}
```

**검증 (CLAUDE.md update-notes.json 작성 톤 규칙)**:
- ✅ 기술 용어 없음 (PostgREST, broadcast, IPC 등)
- ✅ 식별자 없음 (NotificationPanel, CommentReactionNotification 등)
- ✅ 파일 경로 없음
- ✅ 시나리오 형식: "지금까지는 X → 이제 Y" / "Z 상황에서 W 동작"

- [ ] **Step 5.3.3: Commit (릴리즈)**

```bash
git add package.json DEVLOG/update-notes.json
git commit -m "chore: v1.29.0 — 댓글 이모지 반응 알림 + 최근 작업 기록"
```

- [ ] **Step 5.3.4: 최종 typecheck + build:vite 1회 더**

```bash
npm run typecheck && npm run build:vite
```

Expected: 모두 PASS

---

## 완료 후 동작

1. PR 생성 (pr-creator 스킬) — 한솔 톤 업데이트 로그 + 기술 설명 + 테스트 가이드(Task 5.2)
2. 코덱스 리뷰 루프 (codex-review-loop 스킬) — 자동 반영
3. 루프 완료 시 알람 발송

---

## 영향 없음 / 회귀 위험

- `comment_reactions` 테이블 스키마: 변경 없음
- 기존 `acting_feedback_notifications`, `scene_assignment_notifications` 흐름: 영향 없음
- 단계 토글, 댓글 생성, 멘션, 리비전 흐름: 영향 없음
- 자동 업데이트 시스템: 영향 없음 (test:auto-update 게이트로 회귀 차단)

## 잠재 위험 / 모니터링

- **race window**: 두 PC 동시 INSERT 시 retry 1회로 수렴. retry 도 실패하면 1초 대기 후 1회 더, 그래도 실패면 로그 + early return (사용자 영향: 알림 누적 1건 누락 가능성). 모니터링: `console.warn` 메시지 누적 시 옵션 B(RPC) 전환 검토.
- **scenes 조인 컬럼명 불일치**: Task 2.1 의 fetchCommentContext SELECT 가 실제 스키마와 안 맞으면 알림 생성 실패. 첫 통합 테스트에서 즉시 발견 가능.
- **고아 reaction (댓글 없음)**: ctx === null 시 WARN log + 활동 로그 안 남김. 데이터 정합성 영향 없음.

---

*작성: 2026-05-21*
