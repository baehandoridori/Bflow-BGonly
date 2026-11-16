-- 개발 브랜치(bae-gyeong-dev) 전용 댓글 바탕. 운영 DB에는 실행하지 않는다 (운영에는 이미 있다).
-- 왜: 9단계(BAE경 기록의 댓글)는 운영의 댓글 표·알림 함수 위에 얹힌다. 개발 브랜치에는 그 바탕이 없어서, 레포 파일에서
--   날짜 순서대로 줄 그대로 떼어 온다. 먼저 DEVLOG/verification/2026-11-16-bae-gyeong-dev-base.sql(사용자 · 세션)이 있어야 한다.
-- 운영과 같은지: 적용 뒤 댓글 함수 15개의 md5(prosrc)가 운영 값(2026-11-16 읽기 전용 조회)과 같다 —
--   tests/baeGyeongCommentsDatabase.test.ts 'production fingerprint' 가 확인한다. 댓글 표의 칸 순서 · FK 도 운영 모양에 맞췄다.
-- 주석 한 가지: 운영의 함수 셋(comment_notifications_recipients · comment_notifications_fanout ·
--   remove_emoji_from_reaction_notification)은 레포 본문에서 '-- 주석'만 빠진 글이다(적용 도구가 본문 안 주석을 지웠다 —
--   주석만 있는 줄은 줄째, 코드 뒤 주석은 앞 공백과 함께). 그래서 그 두 파일(05-21 반응 RPC · 11-05 알림)은 함수 본문 안의
--   주석을 뺀 채로 옮겼다. 그 밖의 글자는 한 글자도 바꾸지 않았다. 09-14 팀 할 일 파일은 주석이 남은 채 운영과 같다.
-- 대역(운영과 칸이 다른 표 — 9단계가 건드리지 않는다): characters · character_costumes 는 id 만, comp_revisions 는 init 모양 +
--   05-03 · 06-17(assignee_ids) · 06-22 만. comment_read_states 는 운영에 없어서 넣지 않는다.
-- 출처(이 파일을 만든 순서 그대로):
--   DEVLOG/supabase-init.sql 8-75
--   DEVLOG/supabase-init.sql 89-111
--   DEVLOG/supabase-init.sql 188-193
--   DEVLOG/supabase-init.sql 234-239
--   DEVLOG/supabase-init.sql 271-274
--   DEVLOG/2026-05-03-revision-redesign-migration.sql (전체)
--   DEVLOG/2026-05-05-replica-identity-full.sql (전체)
--   DEVLOG/migrations/2026-05-10-add-parent-comment-id.sql (전체)
--   DEVLOG/migrations/2026-05-15-comment-reactions.sql (전체)
--   DEVLOG/migrations/2026-05-21-comment-reaction-notifications.sql (전체)
--   DEVLOG/migrations/2026-05-21-comment-reaction-rpc.sql (전체) — 함수 본문 안 주석은 뺌
--   DEVLOG/migrations/2026-06-22-comp-revisions-part-id-nullable.sql (전체)
--   DEVLOG/migrations/2026-06-26-character-comments.sql (전체)
--   DEVLOG/migrations/2026-09-14-comment-thread-todos.sql (전체)
--   DEVLOG/migrations/2026-11-05-comment-notifications.sql (BEGIN · COMMIT 두 줄만 뺀 전체) — 함수 본문 안 주석은 뺌
-- 앞의 BAE 바탕처럼 이 파일 하나를 한 번에 적용한다(apply_migration 이 트랜잭션으로 감싼다). 다시 돌려도 안전하다(IF NOT EXISTS · OR REPLACE).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── DEVLOG/supabase-init.sql 8-75 ──
-- 1. episodes
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number INTEGER NOT NULL,
  title TEXT,
  memo TEXT,
  status TEXT DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_number)
);

-- 2. parts (→ episodes)
CREATE TABLE IF NOT EXISTS parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  department TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_id, part_id, department)
);

-- 3. scenes (→ parts) + updated_by 컬럼 (자기 변경 필터링용)
CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_number TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  memo TEXT,
  storyboard_url TEXT,
  guide_url TEXT,
  assignee TEXT,
  lo BOOLEAN DEFAULT false,
  done BOOLEAN DEFAULT false,
  review BOOLEAN DEFAULT false,
  png BOOLEAN DEFAULT false,
  layout TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(part_id, scene_number)
);

CREATE INDEX IF NOT EXISTS idx_scenes_part_id ON scenes(part_id);
CREATE INDEX IF NOT EXISTS idx_scenes_assignee ON scenes(assignee);

-- 4. comments (→ parts, scenes)
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_part_scene ON comments(part_id, scene_id);

-- ── 대역(운영과 같은 칸 순서·FK): scene_uuid · images 는 05-03 파일보다 먼저 운영에 있었다(05-03 의 '누락 보강' 주석).
--    images 칸을 더한 파일은 레포에 없다(v1.15.12). 운영 모양: scene_uuid uuid NULL FK scenes ON DELETE CASCADE, images jsonb DEFAULT '[]'. ──
ALTER TABLE comments ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL REFERENCES scenes(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

-- ── DEVLOG/supabase-init.sql 89-111 ──
-- 5. comp_revisions (→ parts)
CREATE TABLE IF NOT EXISTS comp_revisions (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  description TEXT,
  frame_no TEXT,
  image_url TEXT,
  department TEXT,
  requester_id TEXT,
  requester_name TEXT,
  assignee TEXT,
  resolved_by TEXT,
  resolved_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comp_revisions_part_scene ON comp_revisions(part_id, scene_id);

-- ── DEVLOG/supabase-init.sql 188-193 ──
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── DEVLOG/supabase-init.sql 234-239 ──
ALTER TABLE comp_revisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comp_revisions' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comp_revisions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── DEVLOG/supabase-init.sql 271-274 ──
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── DEVLOG/2026-05-03-revision-redesign-migration.sql ──
-- 리비전 기능 전면 재설계 마이그레이션
-- 작성일: 2026-05-03
-- 멱등(IF NOT EXISTS) — 재실행 안전

-- 1. comments.revision_id (리비전 ↔ 댓글 단일 흐름 통합)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS revision_id TEXT NULL
  REFERENCES comp_revisions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_revision_id
  ON comments(revision_id) WHERE revision_id IS NOT NULL;

-- 2. users.is_compositor (컴포지터 역할 — 부서 구분 없음, 여러 명 가능)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_compositor BOOLEAN DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_is_compositor
  ON users(is_compositor) WHERE is_compositor = true;

-- 3. comp_revisions.notify_user_ids (알림 받을 사람 목록)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS notify_user_ids JSONB DEFAULT '[]'::jsonb;

-- 4. comments.scene_uuid (init.sql 누락 보강)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 5. comp_revisions.scene_uuid (init.sql 누락 보강)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 6. 레거시 백필: 기존 리비전의 notify_user_ids에 등록자 포함 (빈 배열인 경우만)
UPDATE comp_revisions
  SET notify_user_ids = jsonb_build_array(requester_id)
  WHERE notify_user_ids = '[]'::jsonb
    AND requester_id IS NOT NULL
    AND requester_id <> '';

-- ── DEVLOG/2026-05-05-replica-identity-full.sql ──
-- REPLICA IDENTITY FULL — Realtime UPDATE payload.old 보장
-- 작성일: 2026-05-05 (코덱스 10차 P1 fix)
-- 멱등 — 재실행 안전 (DEFAULT → FULL 전환은 idempotent)
--
-- 배경: Supabase Postgres Changes 의 UPDATE payload 는 기본적으로 `new` 만 보장하고
-- `old` 는 PK 만 들어옴. App.tsx 의 리비전 status 변경 알림이 `oldRow.status !==
-- newRow.status` 비교에 의존하므로 `old` 가 undefined 인 환경에서는 in_progress/
-- resolved 알림이 절대 발화되지 않음. REPLICA IDENTITY FULL 로 전체 row 를 payload
-- 에 포함시켜 정확한 비교 가능.
--
-- 댓글 테이블도 향후 status/edit 비교에 대비해 같이 설정.

ALTER TABLE comp_revisions REPLICA IDENTITY FULL;
ALTER TABLE comments REPLICA IDENTITY FULL;

-- ── DEVLOG/migrations/2026-05-10-add-parent-comment-id.sql ──
-- 2026-05-10 — comments 테이블에 parent_comment_id 컬럼 추가
-- 1단계 대댓글 (Slack/Linear 스타일) 구현 위한 self-reference.
-- 부모 삭제 시 ON DELETE SET NULL → 답글이 일반 댓글로 떨어져 메인 흐름에 표시됨 (Slack 동작과 일치).
--
-- 적용 이력 (실 DB, 2026-05-11):
--   초기 spec 은 parent_comment_id uuid 였지만 실 comments.id 가 text 타입이라
--   self-reference 호환성 위해 text 로 정정 적용. 본 파일도 동기화.

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS parent_comment_id text NULL
  REFERENCES comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

COMMENT ON COLUMN comments.parent_comment_id IS
  '1단계 대댓글 부모 참조 (v1.24.0+). NULL = 일반 댓글, 값 있음 = 답글. 부모 삭제 시 SET NULL.';

-- ── DEVLOG/migrations/2026-05-15-comment-reactions.sql ──
-- 2026-05-15 v1.26.0 — 댓글 이모지 리액션
--
-- 한 사용자는 한 댓글에 한 이모지를 1번만 누를 수 있다 (UNIQUE).
-- 댓글 삭제 시 cascade. 사용자 삭제 시도 cascade.
--
-- 참고:
--   - comments.id 는 TEXT 타입 → comment_id 도 TEXT
--   - users.id 는 TEXT 타입 → user_id 도 TEXT
--   - RLS 는 기존 패턴(allow_all) 따라 동일 허용. 권한 가드는 IPC 레이어에서.

CREATE TABLE IF NOT EXISTS comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reactions_user ON comment_reactions(user_id);

-- RLS — 기존 패턴 그대로 (anon key 전체 허용, 권한 가드는 앱 레이어)
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_reactions') THEN
    CREATE POLICY "allow_all" ON comment_reactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Realtime 활성화 (코덱스 2차 P2: 멱등성 — 이미 등록되어 있으면 skip)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comment_reactions;
  END IF;
END$$;

COMMENT ON TABLE comment_reactions IS
  '댓글 이모지 리액션 (v1.26.0+). 한 댓글에 한 사용자가 같은 이모지를 1번만 누를 수 있다.';

-- ── DEVLOG/migrations/2026-05-21-comment-reaction-notifications.sql ──
-- 2026-05-21: 댓글 이모지 반응 알림 테이블
-- spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md
-- plan: docs/superpowers/plans/2026-05-21-comment-reaction-notifications.md
--
-- 한 줄 = "받는 사람(comment 작성자) × 댓글 × 반응한 사람" 의 묶음 알림.
-- 같은 (recipient, comment, actor) 면 emojis 배열에 누적되고 read_at 이 NULL 로 리셋됨.

CREATE TABLE IF NOT EXISTS comment_reaction_notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    TEXT        NOT NULL,
  comment_id      TEXT        NOT NULL,
  actor_id        TEXT        NOT NULL,
  actor_name      TEXT        NOT NULL,
  -- 점프용 컨텍스트 (스냅샷 — 댓글이 다른 씬으로 이동하는 일은 없음)
  scene_id        TEXT,
  episode_number  INTEGER,
  part_id         TEXT,
  dept            TEXT,
  -- 누적 데이터 (last_emoji 는 별도 컬럼 두지 않고 client 에서 emojis.at(-1) 로 derive)
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

-- Realtime publication 등록 (멱등성 보장)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='comment_reaction_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comment_reaction_notifications;
  END IF;
END $$;

-- ── DEVLOG/migrations/2026-05-21-comment-reaction-rpc.sql ──
-- 2026-05-21 (코덱스 4차 P1): comment_reaction_notifications atomic UPSERT/REMOVE RPC
-- spec: docs/superpowers/specs/2026-05-21-comment-reaction-notifications-design.md
--
-- 기존 application-side SELECT → INSERT/UPDATE 시퀀스가 동일 (recipient, comment, actor) 조합의
-- 동시 호출에서 race condition 으로 emoji 손실 가능. 단일 SQL 표현식으로 원자화.

-- ─── UPSERT (이모지 추가) ────────────────────────────
CREATE OR REPLACE FUNCTION upsert_comment_reaction_notification(
  p_recipient   TEXT,
  p_comment     TEXT,
  p_actor       TEXT,
  p_actor_name  TEXT,
  p_scene       TEXT,
  p_episode     INTEGER,
  p_part        TEXT,
  p_dept        TEXT,
  p_emoji       TEXT
) RETURNS comment_reaction_notifications
LANGUAGE plpgsql AS $$
DECLARE
  v_row comment_reaction_notifications;
BEGIN
  INSERT INTO comment_reaction_notifications
    (recipient_id, comment_id, actor_id, actor_name,
     scene_id, episode_number, part_id, dept,
     emojis, reaction_count, last_action_at, read_at, created_at)
  VALUES
    (p_recipient, p_comment, p_actor, p_actor_name,
     p_scene, p_episode, p_part, p_dept,
     jsonb_build_array(p_emoji), 1, now(), NULL, now())
  ON CONFLICT (recipient_id, comment_id, actor_id) DO UPDATE
  SET emojis         = comment_reaction_notifications.emojis || jsonb_build_array(p_emoji),
      reaction_count = comment_reaction_notifications.reaction_count + 1,
      last_action_at = now(),
      read_at        = NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ─── REMOVE (이모지 제거 + 빈 행이면 DELETE) ──────────
-- 행 잠금 + 새 emojis 계산 + UPDATE/DELETE 한 트랜잭션에서 수행 → race-free.
DROP FUNCTION IF EXISTS remove_emoji_from_reaction_notification(TEXT, TEXT, TEXT, TEXT);
CREATE FUNCTION remove_emoji_from_reaction_notification(
  p_recipient TEXT,
  p_comment   TEXT,
  p_actor     TEXT,
  p_emoji     TEXT
) RETURNS TABLE(
  notification_id        UUID,
  deleted                BOOLEAN,
  reaction_count_after   SMALLINT,
  emojis_after           JSONB
) LANGUAGE plpgsql AS $$
DECLARE
  v_id           UUID;
  v_new_emojis   JSONB;
  v_new_count    SMALLINT;
BEGIN
  SELECT id INTO v_id
    FROM comment_reaction_notifications
   WHERE recipient_id = p_recipient
     AND comment_id   = p_comment
     AND actor_id     = p_actor
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
    INTO v_new_emojis
    FROM comment_reaction_notifications n,
         LATERAL jsonb_array_elements_text(n.emojis) WITH ORDINALITY AS t(e, ord)
   WHERE n.id = v_id
     AND t.e  <> p_emoji;

  v_new_count := jsonb_array_length(v_new_emojis)::SMALLINT;

  IF v_new_count = 0 THEN
    DELETE FROM comment_reaction_notifications WHERE id = v_id;
    notification_id       := v_id;
    deleted               := TRUE;
    reaction_count_after  := 0;
    emojis_after          := '[]'::jsonb;
    RETURN NEXT;
  ELSE
    UPDATE comment_reaction_notifications
       SET emojis         = v_new_emojis,
           reaction_count = v_new_count,
           last_action_at = now()
     WHERE id = v_id;
    notification_id       := v_id;
    deleted               := FALSE;
    reaction_count_after  := v_new_count;
    emojis_after          := v_new_emojis;
    RETURN NEXT;
  END IF;
END;
$$;

-- ── 대역: 리테이크 허브(2026-06-17-retake-hub.sql)의 assignee_ids 칸 하나만(알림 받는 사람 계산이 읽는다) ──
ALTER TABLE comp_revisions ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── DEVLOG/migrations/2026-06-22-comp-revisions-part-id-nullable.sql ──
-- 2026-06-22: 리테이크 허브 '전반'(씬 미지정) 항목 지원 — comp_revisions.part_id nullable.
--
-- 배경: 5단계 마이그레이션(2026-06-17-retake-hub.sql)이 scene_id 만 nullable 로 풀고
--       part_id 를 빠뜨렸다. 그 결과 part_id=null 인 '전반' 항목 INSERT 가
--       NOT NULL 제약(SQLSTATE 23502)으로 무조건 실패한다.
-- 전반 항목은 특정 파트/씬에 안 매이고 set_id(comp_revision_sets) 로만 묶이므로
-- part_id 가 null 이어야 한다. (씬-바운드 항목은 기존처럼 part_id 채움 — 영향 없음.)
--
-- 멱등: 이미 nullable 이면 no-op(Postgres DROP NOT NULL 은 재실행 안전).
ALTER TABLE comp_revisions ALTER COLUMN part_id DROP NOT NULL;

-- ── 대역: 캐릭터 현황판 표 둘(2026-06-25-character-board-mvp.sql)은 댓글 FK 가 가리키는 id 칸만 ──
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS character_costumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT ''
);

-- ── DEVLOG/migrations/2026-06-26-character-comments.sql ──
-- ============================================================
-- 캐릭터 댓글 지원 (additive + 제약 완화)
-- date: 2026-06-26
--
-- 기존 comments 테이블을 재사용해 캐릭터(현황판) 댓글 스레드를 담는다.
-- 씬 댓글은 그대로 (part_id + scene_id). 캐릭터 댓글은 character_id 로 식별.
-- 대댓글(parent_comment_id)·이모지 반응(comment_reactions, comment_id FK)·읽음 상태는 그대로 재사용.
-- ============================================================

ALTER TABLE comments ADD COLUMN IF NOT EXISTS character_id UUID REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS costume_id UUID REFERENCES character_costumes(id) ON DELETE SET NULL;

-- 캐릭터 댓글은 part_id/scene_id 가 없으므로 NOT NULL 완화.
-- 기존 씬 댓글 row 는 값이 있으므로 영향 없음. 씬 댓글 INSERT 는 계속 두 값을 채운다.
ALTER TABLE comments ALTER COLUMN part_id DROP NOT NULL;
ALTER TABLE comments ALTER COLUMN scene_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_character ON comments(character_id) WHERE character_id IS NOT NULL;

-- ── DEVLOG/migrations/2026-09-14-comment-thread-todos.sql ──
-- 2026-09-14: 씬/캐릭터 댓글 스레드의 팀 공유 할 일 (피드백 58)
--
-- 배경:
--   댓글 패널("댓글 및 활동" / 캐릭터는 "이 캐릭터에 대한 이야기") 위쪽에 팀이 같이 보는 체크리스트를 둔다.
--   스레드 키 = CommentPanel 의 effectiveSceneThreadKey (씬 `EP05:A:a001`, 캐릭터 `char:{uuid}`).
-- 경계(CLAUDE.md 규칙 7):
--   테이블은 anon/authenticated 직접 권한 없음(RLS 켜고 정책 0개 + 권한 회수). 앱이 닿는 길은
--   SECURITY DEFINER 래퍼 4개뿐이며, 래퍼는 app_session_user_id(토큰) 으로 호출자를 확정하고
--   작성자·완료자 이름을 서버가 users(명시 컬럼)에서 채운다. 클라이언트 신원 주장은 받지 않는다.
--   users FK 는 두지 않는다(사용자 삭제 cascade 가 다른 삭제 트리거를 막았던 회귀 회피). 퇴사자 항목은 admin 이 지운다.
-- 실시간: publication 에 넣지 않고 statement 트리거가 내용 없는 신호('thread-todos-changed')만 보낸다.
-- 호환성: 추가 전용. 기존 앱(v1.117.x)이 쓰는 객체는 건드리지 않는다.
-- 멱등: 반복 실행해도 안전하다. 이 프로젝트의 default privileges 가 새 테이블/함수에 anon 권한을
--   자동 부여하므로 명시적으로 회수한다. 라이브 적용은 코드 PR 머지 전 한솔 게이트(계획서 부록 A-2).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- ── 1) 테이블 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_thread_todos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key      TEXT NOT NULL CHECK (btrim(thread_key) <> '' AND length(thread_key) <= 200),
  text            TEXT NOT NULL CHECK (btrim(text) <> '' AND length(text) <= 200),
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at         TIMESTAMPTZ,
  done_by         TEXT,
  done_by_name    TEXT,
  -- 완료 정보 세 칸은 함께 채워지거나 함께 비어 있다.
  CONSTRAINT comment_thread_todos_done_pair
    CHECK ((done_at IS NULL) = (done_by IS NULL) AND (done_by IS NULL) = (done_by_name IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_comment_thread_todos_thread
  ON public.comment_thread_todos (thread_key, created_at);

-- RLS 켜고 정책은 만들지 않는다. anon 은 어떤 행도 볼 수 없고, 래퍼(SECURITY DEFINER)만 통과한다.
ALTER TABLE public.comment_thread_todos ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.comment_thread_todos FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.comment_thread_todos FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- ── 2) 공개 래퍼 4개 (세션 토큰 → 호출자 확정 → 본문) ─────────────────────
-- 호출자 확정 3줄은 네 함수에 그대로 반복한다(별도 헬퍼 없음 — 읽는 사람이 한 함수 안에서 경계를 다 본다).
-- 세션 실패는 app_session_user_id 가 42501 로 던지고, users 에 없는 사용자(삭제된 계정)도 42501 로 통일한다.

CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_list(p_session_token TEXT, p_thread_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_thread_key IS NULL OR btrim(p_thread_key) = '' OR length(p_thread_key) > 200 THEN
    RAISE EXCEPTION '할 일 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at, t.id)
                   FROM public.comment_thread_todos t WHERE t.thread_key = p_thread_key), '[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_add(p_session_token TEXT, p_thread_key TEXT, p_text TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; v_text TEXT; t public.comment_thread_todos;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_thread_key IS NULL OR btrim(p_thread_key) = '' OR length(p_thread_key) > 200 THEN
    RAISE EXCEPTION '할 일 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  -- 연속 공백은 한 칸으로, 앞뒤 공백은 제거 (렌더러·main 의 sanitizeThreadTodoText 와 같은 규칙).
  v_text := btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'));
  IF v_text = '' OR length(v_text) > 200 THEN
    RAISE EXCEPTION '할 일은 1~200자로 적어 주세요.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.comment_thread_todos (thread_key, text, created_by, created_by_name)
  VALUES (p_thread_key, v_text, v_user, v_name)
  RETURNING * INTO t;
  RETURN to_jsonb(t);
END $$;

-- 완료: 같은 항목을 둘이 동시에 체크하면 먼저 체크한 사람이 남는다(COALESCE). 해제는 누구나. 없는 항목은 P0002.
CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_set_done(p_session_token TEXT, p_id UUID, p_done BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; t public.comment_thread_todos;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_done IS NULL THEN
    RAISE EXCEPTION '할 일 요청이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.comment_thread_todos SET
    done_at      = CASE WHEN p_done THEN COALESCE(done_at, now()) ELSE NULL END,
    done_by      = CASE WHEN p_done THEN COALESCE(done_by, v_user) ELSE NULL END,
    done_by_name = CASE WHEN p_done THEN COALESCE(done_by_name, v_name) ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION '이미 지워진 할 일이에요.' USING ERRCODE = 'P0002'; END IF;
  RETURN to_jsonb(t);
END $$;

-- 삭제: 작성자 본인 또는 users.role = 'admin'. 권한·부재를 DELETE 한 문장으로 판정한다(SELECT→DELETE 경합 없음).
--   이미 없는 항목은 멱등 성공({deleted:false}), 남의 항목은 42501.
CREATE OR REPLACE FUNCTION public.comment_thread_todos_session_delete(p_session_token TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_name TEXT; v_role TEXT; v_deleted UUID;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  SELECT u.name, u.role INTO v_name, v_role FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION '할 일 요청이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.comment_thread_todos
   WHERE id = p_id AND (created_by = v_user OR v_role = 'admin')
  RETURNING id INTO v_deleted;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'deleted', true); END IF;
  IF EXISTS (SELECT 1 FROM public.comment_thread_todos WHERE id = p_id) THEN
    RAISE EXCEPTION '내가 추가한 할 일만 지울 수 있어요.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'deleted', false);
END $$;

COMMENT ON FUNCTION public.comment_thread_todos_session_list(TEXT, TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 스레드의 팀 할 일 목록을 돌려주는 공개 래퍼.';
COMMENT ON FUNCTION public.comment_thread_todos_session_add(TEXT, TEXT, TEXT) IS '세션 토큰으로 호출자를 확정한 뒤 팀 할 일을 추가하는 공개 래퍼(작성자 이름은 서버가 채움).';
COMMENT ON FUNCTION public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN) IS '세션 토큰으로 호출자를 확정한 뒤 완료/해제를 기록하는 공개 래퍼(최초 완료자 유지).';
COMMENT ON FUNCTION public.comment_thread_todos_session_delete(TEXT, UUID) IS '세션 토큰으로 호출자를 확정한 뒤 작성자 또는 관리자만 지우는 공개 래퍼.';

-- ── 3) 권한: 래퍼만 anon/authenticated/service_role 에 EXECUTE ────────────

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.comment_thread_todos_session_list(TEXT, TEXT),
    public.comment_thread_todos_session_add(TEXT, TEXT, TEXT),
    public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN),
    public.comment_thread_todos_session_delete(TEXT, UUID)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.comment_thread_todos_session_list(TEXT, TEXT),
        public.comment_thread_todos_session_add(TEXT, TEXT, TEXT),
        public.comment_thread_todos_session_set_done(TEXT, UUID, BOOLEAN),
        public.comment_thread_todos_session_delete(TEXT, UUID) TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- ── 4) Realtime: 내용 없는 변경 신호 (gantt_notify_change 미러) ───────────
-- 테이블을 publication 에 넣으면 행 내용이 anon 구독자에게 흘러간다. 대신 statement 단위 트리거가
-- 공개 채널 'bflow-realtime' 에 테이블 이름만 broadcast 한다. 앱은 신호를 받으면 래퍼로 다시 읽는다.
-- 0행 DELETE(이미 지워진 항목 재삭제)에도 신호가 나가지만 20명 규모라 허용한다.

CREATE OR REPLACE FUNCTION public.comment_thread_todos_notify_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'thread-todos-changed', 'bflow-realtime', false);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[thread-todos] realtime 변경 신호 전송 실패: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.comment_thread_todos_notify_change() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.comment_thread_todos_notify_change() FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS comment_thread_todos_notify_change ON public.comment_thread_todos;
CREATE TRIGGER comment_thread_todos_notify_change
  AFTER INSERT OR UPDATE OR DELETE ON public.comment_thread_todos
  FOR EACH STATEMENT EXECUTE FUNCTION public.comment_thread_todos_notify_change();

-- 방어: 누군가 publication 에 넣었다면 뺀다(행 내용 노출 방지).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_thread_todos') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.comment_thread_todos;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── DEVLOG/migrations/2026-11-05-comment-notifications.sql ──
-- 2026-11-05: 씬 댓글 알림을 서버가 저장 순간에 만든다 (씬 댓글 B안 PR 6 · 인수인계서 §10)
--
-- 배경:
--   지금까지는 댓글을 받는 PC 마다 렌더러가 '누가 받나'를 각자 판정했다(src/utils/sceneCommentNotification.ts).
--   그 PC 의 캐시에 씬·댓글이 없으면 알림이 빠지고, 로그인 때마다 최근 댓글을 최대 2,000줄 훑어 놓친 멘션을 찾았다.
--   이 파일은 댓글이 저장되는 그 트랜잭션 안에서 받을 사람을 계산해 comment_notifications 에 한 줄씩 넣는다.
--   앱은 '내 줄'만 세션 래퍼로 읽는다(놓친 알림 복원 = 내 줄 목록, 2,000줄 훑기 없음).
-- 한솔 결정(2026-11-05): 서버가 저장 순간에 만든다(앱이 저장 뒤 요청하는 원안 대신 — 업데이트 안 한 PC 가 쓴 댓글도 빠짐없이),
--   '내 씬' 조용한 알림은 그 PC 가 씬을 열어 봤는지와 무관하게 늘 만든다(보관한 에피소드·파트는 지금처럼 만들지 않는다),
--   슬랙은 이번에 옮기지 않는다.
--
-- 받는 사람 규칙 (화면 판정 함수와 같은 순서, 한 사람은 한 댓글에 가장 강한 이유 한 줄만):
--   캐릭터 댓글   : 본문에 @이름 으로 부른 사람(mention)만.
--   리테이크 댓글 : mention → 리테이크 요청자·알림 대상(retake). 담당자는 알림 대상 안에 있을 때만(앱의 '담당 ⊆ 알림 대상' 규칙).
--   일반 댓글     : mention → 원댓글 작성자(reply) → 자동(auto): 씬 담당(assignee) > 같은 장면 상대 부서 담당(counterpart)
--                   > 그 씬·상대 부서 같은 씬에 댓글을 단 적 있는 사람(participant). 자동은 활성 에피소드·활성 파트의 씬만.
--   수정          : 수정으로 새로 들어간 @이름만(kind='edit', mention). 같은 사람이 다시 들어가면 그 줄을 새로 고친다.
--   작성자 본인과 users 에 없는 이름·id 는 받지 않는다. 이름이 같은 사람이 여럿이면 모두 받는다(앱도 이름으로 비교한다).
--   설정(내 씬 자동 알림·리테이크 알림)과 스레드 팔로우·끄기는 PC 로컬이라 서버는 모른다 — 앱이 보여 줄 때 거른다.
--
-- 경계(CLAUDE.md 규칙 7·10, AGENTS.md '씬 댓글 알림 경계'):
--   comment_notifications 는 RLS 를 켜고 정책 0개 + anon/authenticated 권한 회수. publication 에 넣지 않는다.
--   앱이 닿는 길은 세션 래퍼 두 개뿐(목록·읽음). 줄은 댓글 트리거만 만든다 — 클라이언트는 줄을 만들 수 없다.
--   실시간은 줄이 생겼을 때 공개 채널 bflow-realtime 에 내용 없는 신호 'comment-notifications-changed' 한 번 → 앱이 래퍼로 다시 읽는다.
--   트리거는 모든 예외를 삼킨다 — 알림을 못 만들어도 댓글 저장·삭제는 절대 막지 않는다(PR #265: 트리거 하나가 사용자 삭제를 막은 회귀).
--   users·comments FK 는 두지 않는다(사용자 삭제·댓글 삭제 경로를 새 테이블이 막지 않게). 댓글이 지워지면 삭제 트리거가 줄을 지우고,
--   목록 래퍼는 comments 와 INNER JOIN 해 남은 줄을 감춘다.
-- 호환성: 추가 전용. comments 에는 트리거 셋만 붙고 칸·권한은 그대로다. v1.148.0 앱은 이 객체를 모르고 그대로 동작한다.
-- 멱등: 반복 실행해도 안전하다(마지막 채우기는 이미 있는 줄을 건너뛴다). 이 프로젝트의 default privileges 가 새 테이블·함수에
--   anon 권한을 자동으로 주므로 명시 회수한다.
-- 채우기(6절): 최근 30일 댓글 중 '나를 직접 부른' 줄(멘션·답글·리테이크)만 신호 없이 채운다. 자동 알림(담당·상대 부서·참여자)은
--   채우지 않는다 — 지금 담당자·지금까지의 댓글로 계산하면 그때는 받지 않았을 사람에게도 줄이 생기고, v1.148.0 이 이미 보여 준
--   자동 알림이 업데이트 뒤 다시 들어온다(리뷰 지적). 줄 시각은 댓글 시각이되 서버 시각보다 늦지 않게 자른다(시계가 앞선 PC·위조 댓글).
-- 되돌리기(그대로 실행): 트리거 셋과 래퍼 두 개를 지우면 새 앱은 '서버 알림 없음'으로 보고 예전 길(렌더러 판정 + 놓친 멘션 훑기)로 돌아간다.
--   BEGIN;
--   DROP TRIGGER IF EXISTS comment_notifications_after_insert ON public.comments;
--   DROP TRIGGER IF EXISTS comment_notifications_after_mentions ON public.comments;
--   DROP TRIGGER IF EXISTS comment_notifications_after_delete ON public.comments;
--   DROP FUNCTION IF EXISTS public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER);
--   DROP FUNCTION IF EXISTS public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB);
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
-- 운영 적용: 2026-11-05 13:51 KST, 20261105045120(apply_migration 'comment_notifications'). 적용 전 같은 본문 + 확인 SQL 을
--   한 묶음으로 돌려 끝에서 일부러 되돌리는 예행연습 통과(채울 줄 36개), 적용 뒤 확인 SQL 도 같은 방식으로 통과 — 채운 줄 40개
--   (멘션 39·답글 1), anon 은 래퍼 두 개만 실행, 표 권한 없음, publication 밖, 트리거 셋.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1) 테이블 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL,
  comment_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('add', 'edit')),
  reason       TEXT NOT NULL CHECK (reason IN ('mention', 'reply', 'retake', 'auto')),
  detail       TEXT CHECK (detail IS NULL OR detail IN ('assignee', 'counterpart', 'participant')),
  actor_id     TEXT NOT NULL,
  -- 서버 시각(목록 커서). comments.created_at 은 보낸 PC 의 시계라 커서로 쓰지 않는다.
  event_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 수정 줄: 그 수정의 comments.edited_at(앱의 수정 방송 editedAt 과 같은 값 — 같은 수정이 두 길로 와도 한 번만).
  edit_at      TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  CONSTRAINT comment_notifications_once UNIQUE (recipient_id, comment_id, kind),
  CONSTRAINT comment_notifications_auto_detail CHECK ((reason = 'auto') = (detail IS NOT NULL)),
  CONSTRAINT comment_notifications_edit_mention CHECK (kind = 'add' OR reason = 'mention')
);

CREATE INDEX IF NOT EXISTS idx_comment_notifications_recipient
  ON public.comment_notifications (recipient_id, event_at, id);
CREATE INDEX IF NOT EXISTS idx_comment_notifications_comment
  ON public.comment_notifications (comment_id);

ALTER TABLE public.comment_notifications ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON TABLE public.comment_notifications FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.comment_notifications FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- ── 2) 내부 함수: 이름 목록 · 받는 사람 · 줄 넣기 ────────────────────────────

-- JSONB 배열 안의 글자만(앱의 asNames 와 같다). 배열이 아니면 빈 목록.
CREATE OR REPLACE FUNCTION public.comment_notifications_names(p_value JSONB)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(ARRAY(
    SELECT e #>> '{}' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::JSONB END) e
    WHERE jsonb_typeof(e) = 'string' AND e #>> '{}' <> ''
  ), ARRAY[]::TEXT[])
$$;

-- 새 댓글 하나의 받는 사람. 화면 판정 함수(decideSceneCommentNotification)와 같은 순서이고,
-- 미리보기 짝은 src/shared/commentNotificationRecipients.ts(같은 예제로 tests/commentNotificationsDatabase.test.ts 가 대조).
CREATE OR REPLACE FUNCTION public.comment_notifications_recipients(p_comment_id TEXT)
RETURNS TABLE(recipient_id TEXT, reason TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH c AS (
  SELECT cm.id, cm.user_id, cm.part_id, cm.scene_uuid, cm.parent_comment_id, cm.revision_id, cm.character_id,
         public.comment_notifications_names(cm.mentions) AS mention_names,
         CASE WHEN btrim(COALESCE(cm.scene_id, '')) ~ '^-?[0-9]{1,9}$' THEN btrim(cm.scene_id)::INTEGER END AS scene_no
    FROM public.comments cm WHERE cm.id = p_comment_id
),
mention AS (
  SELECT u.id AS recipient_id, 'mention'::TEXT AS reason, NULL::TEXT AS detail, 1 AS rank
    FROM c JOIN public.users u ON u.name = ANY (c.mention_names)
),
reply AS (
  SELECT p.user_id, 'reply'::TEXT, NULL::TEXT, 2
    FROM c JOIN public.comments p ON p.id = c.parent_comment_id
   WHERE c.character_id IS NULL AND c.revision_id IS NULL
),
retake AS (
  SELECT t.id, 'retake'::TEXT, NULL::TEXT, 2
    FROM c JOIN public.comp_revisions r ON r.id = c.revision_id
   CROSS JOIN LATERAL (
     SELECT r.requester_id AS id
     UNION SELECT unnest(public.comment_notifications_names(r.notify_user_ids))
     UNION SELECT a FROM unnest(public.comment_notifications_names(r.assignee_ids)) a
            WHERE a = ANY (public.comment_notifications_names(r.notify_user_ids))
   ) t
   WHERE c.character_id IS NULL
),
scene AS (
  SELECT s.id, s.part_id, s.scene_number, s.sort_order, s.assignee, pt.episode_id, pt.part_id AS part_letter, pt.department
    FROM c
    JOIN public.scenes s ON (s.id = c.scene_uuid OR (s.part_id = c.part_id AND s.sort_order = c.scene_no))
    JOIN public.parts pt ON pt.id = s.part_id AND pt.status = 'active'
    JOIN public.episodes ep ON ep.id = pt.episode_id AND ep.status = 'active'
   WHERE c.character_id IS NULL AND c.revision_id IS NULL
   ORDER BY (s.id = c.scene_uuid) DESC NULLS LAST, s.id
   LIMIT 1
),
counterpart_scene AS (
  SELECT cs.id, cs.part_id, cs.sort_order, cs.assignee
    FROM scene sc
    JOIN public.parts cp ON cp.episode_id = sc.episode_id AND cp.part_id = sc.part_letter AND cp.status = 'active'
                        AND CASE WHEN sc.department = 'acting' THEN cp.department <> 'acting' ELSE cp.department = 'acting' END
    JOIN public.scenes cs ON cs.part_id = cp.id AND lower(btrim(cs.scene_number)) = lower(btrim(sc.scene_number))
   WHERE btrim(sc.scene_number) <> ''
),
assignee_names AS (
  SELECT btrim(n) AS name, 'assignee'::TEXT AS detail, 3 AS rank
    FROM scene, regexp_split_to_table(COALESCE(scene.assignee, ''), '[,、，]') n
  UNION ALL
  SELECT btrim(n), 'counterpart'::TEXT, 4
    FROM counterpart_scene, regexp_split_to_table(COALESCE(counterpart_scene.assignee, ''), '[,、，]') n
),
auto_assignee AS (
  SELECT u.id, 'auto'::TEXT, a.detail, a.rank
    FROM assignee_names a JOIN public.users u ON u.name = a.name
   WHERE a.name <> ''
),
participant AS (
  SELECT DISTINCT o.user_id, 'auto'::TEXT, 'participant'::TEXT, 5
    FROM c, public.comments o
   WHERE o.id <> c.id
     AND EXISTS (
       SELECT 1 FROM scene sc WHERE o.scene_uuid = sc.id OR (o.part_id = sc.part_id AND btrim(o.scene_id) = sc.sort_order::TEXT)
       UNION ALL
       SELECT 1 FROM counterpart_scene cs WHERE o.scene_uuid = cs.id OR (o.part_id = cs.part_id AND btrim(o.scene_id) = cs.sort_order::TEXT)
     )
),
candidate AS (
  SELECT * FROM mention
  UNION ALL SELECT * FROM reply
  UNION ALL SELECT * FROM retake
  UNION ALL SELECT * FROM auto_assignee
  UNION ALL SELECT * FROM participant
)
SELECT DISTINCT ON (k.recipient_id) k.recipient_id, k.reason, k.detail
  FROM candidate k, c
 WHERE k.recipient_id IS NOT NULL
   AND k.recipient_id <> c.user_id
   AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = k.recipient_id)
 ORDER BY k.recipient_id, k.rank
$$;

-- 줄 넣기. 'add' 는 받는 사람 계산 결과를 그대로(이미 있으면 건너뜀), 'edit' 는 새로 들어간 @이름의 사람에게 멘션 한 줄
-- (같은 사람이 다시 들어가면 그 줄을 새로 고쳐 안 읽음으로). 새 줄이 생겼고 p_signal 이면 내용 없는 신호를 한 번 보낸다.
CREATE OR REPLACE FUNCTION public.comment_notifications_fanout(
  p_comment_id TEXT, p_kind TEXT, p_added_names TEXT[], p_event_at TIMESTAMPTZ, p_signal BOOLEAN
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT; v_edit_at TIMESTAMPTZ; v_count INTEGER := 0;
BEGIN
  SELECT cm.user_id, cm.edited_at INTO v_actor, v_edit_at FROM public.comments cm WHERE cm.id = p_comment_id;
  IF NOT FOUND OR v_actor IS NULL THEN RETURN 0; END IF;
  IF p_kind = 'add' THEN
    INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at)
    SELECT r.recipient_id, p_comment_id, 'add', r.reason, r.detail, v_actor, COALESCE(p_event_at, now())
      FROM public.comment_notifications_recipients(p_comment_id) r
    ON CONFLICT ON CONSTRAINT comment_notifications_once DO NOTHING;
  ELSIF p_kind = 'edit' THEN
    INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at, edit_at)
    SELECT DISTINCT u.id, p_comment_id, 'edit', 'mention', NULL, v_actor, COALESCE(p_event_at, now()), v_edit_at
      FROM public.users u
     WHERE u.name = ANY (COALESCE(p_added_names, ARRAY[]::TEXT[])) AND u.id <> v_actor
    ON CONFLICT ON CONSTRAINT comment_notifications_once
      DO UPDATE SET reason = 'mention', detail = NULL, actor_id = EXCLUDED.actor_id, event_at = EXCLUDED.event_at,
                    edit_at = EXCLUDED.edit_at, read_at = NULL;
  ELSE
    RETURN 0;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 AND COALESCE(p_signal, false) THEN
    BEGIN
      IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
        EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::JSONB, 'comment-notifications-changed', 'bflow-realtime', false;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[comment-notifications] realtime 변경 신호 전송 실패: %', SQLERRM;
    END;
  END IF;
  RETURN v_count;
END $$;

-- ── 3) comments 트리거 셋 (모든 예외를 삼킨다) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.comment_notifications_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.comment_notifications_fanout(NEW.id, 'add', NULL, NULL, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 새 댓글 알림 만들기 실패(댓글은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_mentions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_added TEXT[];
BEGIN
  BEGIN
    v_added := ARRAY(
      SELECT DISTINCT n FROM unnest(public.comment_notifications_names(NEW.mentions)) n
       WHERE NOT (n = ANY (public.comment_notifications_names(OLD.mentions)))
    );
    IF cardinality(v_added) > 0 THEN
      PERFORM public.comment_notifications_fanout(NEW.id, 'edit', v_added, NULL, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 수정 멘션 알림 만들기 실패(수정은 저장됨): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.comment_notifications_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    DELETE FROM public.comment_notifications WHERE comment_id = OLD.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[comment-notifications] 지운 댓글의 알림 정리 실패(댓글은 지워짐): %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS comment_notifications_after_insert ON public.comments;
CREATE TRIGGER comment_notifications_after_insert
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comment_notifications_on_insert();

DROP TRIGGER IF EXISTS comment_notifications_after_mentions ON public.comments;
CREATE TRIGGER comment_notifications_after_mentions
  AFTER UPDATE OF mentions ON public.comments
  FOR EACH ROW WHEN (OLD.mentions IS DISTINCT FROM NEW.mentions)
  EXECUTE FUNCTION public.comment_notifications_on_mentions();

DROP TRIGGER IF EXISTS comment_notifications_after_delete ON public.comments;
CREATE TRIGGER comment_notifications_after_delete
  AFTER DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comment_notifications_on_delete();

-- ── 4) 공개 래퍼 두 개 (세션 토큰 → 호출자 확정 → 내 줄만) ────────────────

-- 내 줄을 (event_at, id) 커서 뒤로 오래된 것부터 최대 200개. 댓글 내용·리테이크 번호를 함께 돌려줘 앱이 스토어 없이도 그린다.
-- 커서의 id 가 없으면 그 시각보다 뒤(앱은 커밋 순서 차이 몫만큼 시각을 앞당겨 다시 읽고, 받은 줄은 스스로 거른다).
CREATE OR REPLACE FUNCTION public.comment_notifications_session_list(
  p_session_token TEXT, p_after_at TIMESTAMPTZ, p_after_id UUID, p_limit INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_limit INTEGER;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  PERFORM 1 FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  RETURN COALESCE((
    SELECT jsonb_agg(s.item ORDER BY s.event_at, s.id)
      FROM (
        SELECT n.event_at, n.id, jsonb_build_object(
                 'id', n.id, 'commentId', n.comment_id, 'kind', n.kind, 'reason', n.reason, 'detail', n.detail,
                 'eventAt', n.event_at, 'editAt', n.edit_at, 'readAt', n.read_at, 'revisionNo', r.revision_no,
                 'comment', jsonb_build_object(
                   'partId', c.part_id, 'sceneId', c.scene_id, 'sceneUuid', c.scene_uuid,
                   'userId', c.user_id, 'userName', c.user_name, 'text', c.text,
                   'mentions', CASE WHEN jsonb_typeof(c.mentions) = 'array' THEN c.mentions ELSE '[]'::JSONB END,
                   'imageCount', CASE WHEN jsonb_typeof(c.images) = 'array' THEN jsonb_array_length(c.images) ELSE 0 END,
                   'parentCommentId', c.parent_comment_id, 'revisionId', c.revision_id, 'characterId', c.character_id,
                   'createdAt', c.created_at, 'editedAt', c.edited_at)
               ) AS item
          FROM public.comment_notifications n
          JOIN public.comments c ON c.id = n.comment_id
          LEFT JOIN public.comp_revisions r ON r.id = c.revision_id
         WHERE n.recipient_id = v_user
           AND (p_after_at IS NULL
                OR n.event_at > p_after_at
                OR (p_after_id IS NOT NULL AND n.event_at = p_after_at AND n.id > p_after_id))
         ORDER BY n.event_at, n.id
         LIMIT v_limit
      ) s
  ), '[]'::JSONB);
END $$;

-- 내 줄 읽음. 화면에 있던 알림만 보낸다 — 새 댓글 줄은 댓글 id, 수정으로 넣은 @ 줄은 (댓글 id, 그 수정 시각) 짝.
-- 같은 댓글에서 빠졌다가 다시 불려 새로 고쳐진 수정 줄은 시각이 달라 읽음이 되지 않는다(아직 이 PC 가 못 받은 알림 — 코덱스 1차).
-- '전부' 는 받지 않는다 — 아직 이 PC 가 받지 못한 줄까지 읽음이 되지 않게. 이미 읽은 줄은 그대로.
CREATE OR REPLACE FUNCTION public.comment_notifications_session_mark_read(
  p_session_token TEXT, p_add_comment_ids TEXT[], p_edit_targets JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user TEXT; v_count INTEGER := 0; v_more INTEGER := 0; v_edits INTEGER;
BEGIN
  v_user := public.app_session_user_id(p_session_token);
  PERFORM 1 FROM public.users u WHERE u.id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' USING ERRCODE = '42501'; END IF;
  IF p_edit_targets IS NOT NULL AND jsonb_typeof(p_edit_targets) <> 'array' THEN
    RAISE EXCEPTION '읽음 대상이 올바르지 않습니다.' USING ERRCODE = '22023';
  END IF;
  v_edits := COALESCE(jsonb_array_length(p_edit_targets), 0);
  IF COALESCE(cardinality(p_add_comment_ids), 0) + v_edits > 500 THEN
    RAISE EXCEPTION '한 번에 읽음으로 바꿀 수 있는 알림은 500개까지예요.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_add_comment_ids), 0) > 0 THEN
    UPDATE public.comment_notifications SET read_at = now()
     WHERE recipient_id = v_user AND kind = 'add' AND read_at IS NULL AND comment_id = ANY (p_add_comment_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  IF v_edits > 0 THEN
    UPDATE public.comment_notifications n SET read_at = now()
      FROM jsonb_to_recordset(p_edit_targets) AS t("commentId" TEXT, "editAt" TIMESTAMPTZ)
     WHERE n.recipient_id = v_user AND n.kind = 'edit' AND n.read_at IS NULL
       AND n.comment_id = t."commentId" AND n.edit_at = t."editAt";
    GET DIAGNOSTICS v_more = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('updated', v_count + v_more);
END $$;

COMMENT ON TABLE public.comment_notifications IS
  '씬·캐릭터 댓글 알림(받는 사람별 한 줄). 댓글 트리거만 만들고, 앱은 comment_notifications_session_* 래퍼로 내 줄만 읽는다.';
COMMENT ON FUNCTION public.comment_notifications_recipients(TEXT) IS '내부 전용: 새 댓글의 받는 사람(이유·자동 종류). 화면 판정 함수와 같은 순서.';
COMMENT ON FUNCTION public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN) IS '내부 전용: 알림 줄을 넣고 새 줄이 있으면 내용 없는 신호를 보낸다.';
COMMENT ON FUNCTION public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER) IS '세션 토큰으로 호출자를 확정한 뒤 내 댓글 알림 줄을 커서 뒤로 돌려주는 공개 래퍼.';
COMMENT ON FUNCTION public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB) IS '세션 토큰으로 호출자를 확정한 뒤 내 댓글 알림 줄을 읽음으로 바꾸는 공개 래퍼.';

-- ── 5) 권한: 내부 함수는 아무도, 래퍼 두 개만 anon/authenticated/service_role ──

DO $$ DECLARE role_name TEXT; BEGIN
  REVOKE ALL PRIVILEGES ON FUNCTION
    public.comment_notifications_names(JSONB),
    public.comment_notifications_recipients(TEXT),
    public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN),
    public.comment_notifications_on_insert(),
    public.comment_notifications_on_mentions(),
    public.comment_notifications_on_delete(),
    public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER),
    public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB)
  FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($r$REVOKE ALL PRIVILEGES ON FUNCTION
        public.comment_notifications_names(JSONB),
        public.comment_notifications_recipients(TEXT),
        public.comment_notifications_fanout(TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN),
        public.comment_notifications_on_insert(),
        public.comment_notifications_on_mentions(),
        public.comment_notifications_on_delete() FROM %I$r$, role_name);
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format($g$GRANT EXECUTE ON FUNCTION
        public.comment_notifications_session_list(TEXT, TIMESTAMPTZ, UUID, INTEGER),
        public.comment_notifications_session_mark_read(TEXT, TEXT[], JSONB) TO %I$g$, role_name);
    END IF;
  END LOOP;
END $$;

-- 방어: 누군가 publication 에 넣었다면 뺀다(줄 내용이 anon 구독자에게 흘러가지 않게).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comment_notifications') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.comment_notifications;
  END IF;
END $$;

-- ── 6) 최근 30일 댓글로 한 번 채우기 (신호 없음) ─────────────────────────────
-- 새 앱의 첫 '놓친 알림 모으기'는 예전 기준 시각부터 내 줄을 읽는다 — 이 파일을 적용하기 전에 온 '나를 부른' 댓글도 빠지지 않게.
-- 자동 알림은 채우지 않는다(머리말). 줄 시각은 댓글을 쓴 시각(예전 기준 시각과 같은 시계)이되 서버 시각보다 늦지 않게.
INSERT INTO public.comment_notifications (recipient_id, comment_id, kind, reason, detail, actor_id, event_at)
SELECT r.recipient_id, cm.id, 'add', r.reason, r.detail, cm.user_id, LEAST(COALESCE(cm.created_at, now()), now())
  FROM public.comments cm
 CROSS JOIN LATERAL public.comment_notifications_recipients(cm.id) r
 WHERE cm.created_at > now() - interval '30 days'
   AND r.reason <> 'auto'
ON CONFLICT ON CONSTRAINT comment_notifications_once DO NOTHING;

-- ── 7) 운영과 같은 표 권한 (2026-11-16 읽기 전용 조회로 맞춤) ─────────────────────────────
-- 개발 브랜치는 새 표에 anon · authenticated 기본 권한이 Dxtm 뿐이라, 운영처럼 앱 열쇠가 직접 읽고 쓰는 표에 권한을 준다.
-- 운영: comments · comment_reactions · episodes · parts · scenes · comp_revisions · characters · character_costumes ·
--   comment_reaction_notifications = anon/authenticated arwdDxtm. comment_notifications · comment_thread_todos = 권한 없음(래퍼로만).
DO $$ DECLARE t TEXT; r TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['comments','comment_reactions','episodes','parts','scenes','comp_revisions','characters','character_costumes','comment_reaction_notifications'] LOOP
  IF to_regclass('public.' || t) IS NOT NULL THEN
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO %I', t, r); END IF;
   END LOOP;
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['comment_notifications','comment_thread_todos'] LOOP
  IF to_regclass('public.' || t) IS NOT NULL THEN
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', t, r); END IF;
   END LOOP;
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
