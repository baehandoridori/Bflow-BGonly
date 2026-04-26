# 최근 작업 위젯 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 활동을 시간 역순 피드 + 시간×요일 히트맵(또는 막대 그래프)으로 보여주는 신규 위젯 1개를 추가하고, 기존 mutation 12개 함수에 활동 기록을 자동 INSERT하도록 패치한다.

**Architecture:** 새 `activity_log` 테이블을 신설하고, 클라이언트가 mutation 호출 시 RPC 트랜잭션 안에서 UPDATE + INSERT를 함께 실행한다. Realtime은 `activity_log` 채널만 구독해 모든 윈도우에 즉시 prepend. 위젯은 옵션 1(상하 분할) 레이아웃에 그래프 모드 3종(히트맵/시간대/요일) 토글 + 4그룹 필터 칩 + 5분 윈도우 그룹화 + 1년 자동 보존 정책으로 구성한다.

**Tech Stack:** Supabase Pro (PostgreSQL + Realtime + pg_cron), Electron 28, React 18 + TypeScript, Zustand, Framer Motion, Tailwind CSS, react-grid-layout, dayjs (시간대 처리), Lucide 아이콘.

**Source spec:** [`docs/superpowers/specs/2026-04-27-recent-activity-widget-design.md`](../specs/2026-04-27-recent-activity-widget-design.md)

**Final mockup:** [`docs/superpowers/specs/mockups/2026-04-27-recent-activity-widget/final.html`](../specs/mockups/2026-04-27-recent-activity-widget/final.html)

---

## File Structure

다음 파일을 생성·수정한다. 각 파일의 책임은 한 가지로 좁히고, 시각화/상태/IO 레이어를 분리한다.

```
DB
  DEVLOG/supabase-init.sql                              [수정]

Electron 백엔드
  electron/supabase.ts                                  [수정]
  electron/main.ts                                      [수정]
  electron/realtime.ts                                  [수정]
  electron/broadcast.ts                                 [수정]
  electron/preload.ts                                   [수정]

타입 / 서비스
  src/types/index.ts                                    [수정]
  src/services/supabaseService.ts                       [수정]

상태 관리
  src/stores/useActivityStore.ts                        [신규]

UI 컴포넌트 (src/components/widgets/activity/)
  src/components/widgets/RecentActivityWidget.tsx       [신규]
  src/components/widgets/activity/GoldenHeatmap.tsx     [신규]
  src/components/widgets/activity/GoldenBarChart.tsx    [신규]
  src/components/widgets/activity/ActivityFeed.tsx      [신규]
  src/components/widgets/activity/ActivityFilterChips.tsx [신규]
  src/components/widgets/activity/ActivityTooltip.tsx   [신규]
  src/components/widgets/activity/utils.ts              [신규]
  src/components/widgets/activity/constants.ts          [신규]

뷰 / 설정
  src/views/Dashboard.tsx                               [수정]
  src/views/SettingsView.tsx                            [수정]
  src/components/settings/ActivityStorageInfo.tsx       [신규]
```

---

## Chunk 1: DB 스키마 + RPC

**목표:** Supabase에 `activity_log` 테이블, 인덱스, RLS, Realtime publication, RPC 함수, pg_cron 보존 작업을 정의한다. 모든 SQL은 `IF NOT EXISTS` / `CREATE OR REPLACE` 로 재실행 안전하게.

**Files:**
- Modify: `DEVLOG/supabase-init.sql` (마지막에 새 섹션 추가)

### Task 1.1: activity_log 테이블 + 인덱스

- [ ] **Step 1: SQL 추가**

`DEVLOG/supabase-init.sql` 끝에 다음 섹션 추가:

```sql
-- ============================================================
-- 최근 작업 위젯 — activity_log (2026-04-27)
-- spec: docs/superpowers/specs/2026-04-27-recent-activity-widget-design.md
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_group TEXT NOT NULL,         -- 'progress' | 'memo' | 'scene' | 'etc'
  scene_id UUID,                       -- scenes.id (UUID), nullable
  scene_label TEXT,                    -- 표시용 "EP01 A씬 #5"
  episode_number INTEGER,
  department TEXT,                     -- 'bg' | 'acting'
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created  ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user     ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_scene    ON activity_log(scene_id);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'activity_log' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON activity_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

- [ ] **Step 2: 검증** — Supabase SQL Editor에서 실행해 에러 없이 테이블이 생성되는지 확인

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'activity_log';
SELECT indexname FROM pg_indexes WHERE tablename = 'activity_log';
```

기대: 1행 + 인덱스 3개

- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): activity_log 테이블 + 인덱스 + RLS + Realtime publication"
```

### Task 1.2: record_activity RPC 함수

- [ ] **Step 1: SQL 추가**

```sql
CREATE OR REPLACE FUNCTION record_activity(
  p_user_id TEXT,
  p_user_name TEXT,
  p_action_type TEXT,
  p_action_group TEXT,
  p_scene_id UUID,
  p_scene_label TEXT,
  p_episode_number INTEGER,
  p_department TEXT,
  p_detail JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO activity_log (
    user_id, user_name, action_type, action_group,
    scene_id, scene_label, episode_number, department, detail
  ) VALUES (
    p_user_id, p_user_name, p_action_type, p_action_group,
    p_scene_id, p_scene_label, p_episode_number, p_department, p_detail
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_activity(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, JSONB)
  TO anon, authenticated;
```

- [ ] **Step 2: 검증** — 호출 테스트

```sql
SELECT record_activity(
  'test_user', '테스트', 'stage_lo', 'progress',
  NULL, 'EP01 A씬 #1', 1, 'bg',
  '{"from":false,"to":true}'::jsonb
);
SELECT * FROM activity_log WHERE user_id = 'test_user';
DELETE FROM activity_log WHERE user_id = 'test_user';
```

기대: UUID 1개 반환, SELECT 1행, DELETE 1행

- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): record_activity RPC 함수 추가"
```

### Task 1.3: bulk RPC 시그니처 확장

기존 `bulk_update_scene_stages`/`bulk_delete_scenes`/`bulk_update_scene_fields` 3개 함수에 활동 기록 파라미터 추가.

- [ ] **Step 1: bulk_update_scene_stages 확장**

`DEVLOG/supabase-init.sql`의 기존 정의를 다음으로 교체 (`CREATE OR REPLACE`):

```sql
CREATE OR REPLACE FUNCTION bulk_update_scene_stages(
  p_updates jsonb,
  p_updated_by text,
  p_user_name text DEFAULT NULL          -- 신규: 활동 기록용 (NULL이면 기록 생략)
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  v_uuid uuid;
  v_stage text;
  v_value boolean;
  v_has_meta_keys boolean;
  v_completed_by text;
  v_completed_at_text text;
  v_completed_at timestamptz;
  v_meta_value text;
  v_scene_label text;
  v_episode_number integer;
  v_department text;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_uuid := NULL;
    BEGIN
      v_uuid := (u->>'sceneUuid')::uuid;
      v_stage := u->>'stage';
      v_value := (u->>'value')::boolean;
      v_has_meta_keys := (u ? 'completedBy') OR (u ? 'completedAt');
      v_completed_by := u->>'completedBy';
      v_completed_at_text := u->>'completedAt';
      v_scene_label := u->>'sceneLabel';
      v_episode_number := COALESCE((u->>'episodeNumber')::integer, NULL);
      v_department := u->>'department';

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

      -- 기존 metadata 처리 (변경 없음)
      IF v_has_meta_keys THEN
        IF v_completed_by IS NOT NULL AND v_completed_by <> ''
           AND v_completed_at_text IS NOT NULL AND v_completed_at_text <> '' THEN
          v_completed_at := v_completed_at_text::timestamptz;
          v_meta_value := jsonb_build_object(
            'completedBy', v_completed_by,
            'completedAt', v_completed_at
          )::text;
          INSERT INTO metadata (type, key, value, updated_at)
            VALUES ('scene-completion', v_uuid::text, v_meta_value, now())
            ON CONFLICT (type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        ELSE
          DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;
        END IF;
      END IF;

      -- 신규: 활동 기록 (p_user_name이 있을 때만, 실패해도 본 작업은 성공)
      IF p_user_name IS NOT NULL THEN
        BEGIN
          PERFORM record_activity(
            p_updated_by, p_user_name,
            'stage_' || v_stage, 'progress',
            v_uuid, v_scene_label, v_episode_number, v_department,
            jsonb_build_object('value', v_value)
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;  -- 활동 기록 실패는 무시
        END;
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

GRANT EXECUTE ON FUNCTION bulk_update_scene_stages(jsonb, text, text) TO anon, authenticated;
```

- [ ] **Step 2: bulk_delete_scenes 확장**

```sql
CREATE OR REPLACE FUNCTION bulk_delete_scenes(
  p_uuids uuid[],
  p_deleted_by text,
  p_user_name text DEFAULT NULL,
  p_meta jsonb DEFAULT '[]'::jsonb        -- 각 element: { sceneUuid, sceneLabel, episodeNumber, department }
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_uuid uuid;
  m jsonb;
  v_scene_label text;
  v_episode_number integer;
  v_department text;
BEGIN
  FOREACH v_uuid IN ARRAY p_uuids LOOP
    BEGIN
      DELETE FROM scenes WHERE id = v_uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;
      DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;

      IF p_user_name IS NOT NULL THEN
        SELECT m INTO m FROM jsonb_array_elements(p_meta) WHERE (m->>'sceneUuid')::uuid = v_uuid;
        v_scene_label := m->>'sceneLabel';
        v_episode_number := COALESCE((m->>'episodeNumber')::integer, NULL);
        v_department := m->>'department';
        BEGIN
          PERFORM record_activity(
            p_deleted_by, p_user_name,
            'scene_delete', 'scene',
            v_uuid, v_scene_label, v_episode_number, v_department,
            '{}'::jsonb
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
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

GRANT EXECUTE ON FUNCTION bulk_delete_scenes(uuid[], text, text, jsonb) TO anon, authenticated;
```

- [ ] **Step 3: bulk_update_scene_fields 확장**

`bulk_update_scene_stages`와 같은 패턴으로 `p_user_name` 파라미터 추가하고 변경된 필드별로 `record_activity` 호출 (memo→`memo_update`, assignee→`assignee_change`, layout→`layout_change`, storyboardUrl→`image_upload_storyboard`, guideUrl→`image_upload_guide`).

전체 코드는 길어 생략 — 동일 패턴 적용. 함수 끝의 GRANT만 다음으로 갱신:

```sql
GRANT EXECUTE ON FUNCTION bulk_update_scene_fields(jsonb, text, text) TO anon, authenticated;
```

- [ ] **Step 4: 검증** — Supabase SQL Editor에서 새 시그니처 호출 테스트

```sql
SELECT * FROM bulk_update_scene_stages(
  '[{"sceneUuid":"00000000-0000-0000-0000-000000000000","stage":"lo","value":true,"sceneLabel":"TEST","episodeNumber":1,"department":"bg"}]'::jsonb,
  'test_user',
  '테스트'
);
```

기대: scene_not_found 에러 (UUID가 가짜이므로). 시그니처 자체가 수용되는지가 핵심.

- [ ] **Step 5: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): bulk RPC 시그니처에 활동 기록 파라미터 추가"
```

### Task 1.4: 보존 정책 cron

- [ ] **Step 1: cleanup 함수 + cron 등록**

```sql
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM activity_log WHERE created_at < now() - INTERVAL '1 year';
END;
$$;

-- pg_cron extension 활성화 (이미 있으면 무시)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 기존 같은 이름 cron이 있으면 unschedule 후 재등록
DO $$ BEGIN
  PERFORM cron.unschedule('activity-log-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'activity-log-cleanup',
  '0 4 * * *',
  $$ SELECT cleanup_old_activity_logs(); $$
);
```

- [ ] **Step 2: 검증**

```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'activity-log-cleanup';
```

기대: 1행

- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): activity_log 1년 보존 cron 등록"
```

### Task 1.5: activity_log_stats RPC (히트맵 집계용)

- [ ] **Step 1: 함수 추가**

```sql
CREATE OR REPLACE FUNCTION activity_log_stats(
  p_since TIMESTAMPTZ,
  p_groups TEXT[] DEFAULT NULL,        -- NULL이면 전체
  p_department TEXT DEFAULT NULL       -- NULL이면 전체
) RETURNS TABLE (
  day_of_week INTEGER,                 -- 0=일, 1=월, ..., 6=토 (KST 기준)
  hour INTEGER,                        -- 0..23
  count INTEGER
)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT
    EXTRACT(dow  FROM (created_at AT TIME ZONE 'Asia/Seoul'))::integer AS day_of_week,
    EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul'))::integer AS hour,
    COUNT(*)::integer AS count
  FROM activity_log
  WHERE created_at >= p_since
    AND (p_groups IS NULL OR action_group = ANY(p_groups))
    AND (p_department IS NULL OR department = p_department)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION activity_log_stats(TIMESTAMPTZ, TEXT[], TEXT) TO anon, authenticated;
```

- [ ] **Step 2: 검증**

```sql
SELECT * FROM activity_log_stats(now() - INTERVAL '7 days') LIMIT 10;
```

기대: 0행 또는 일부 (데이터 양에 따라). 에러만 없으면 OK.

- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/supabase-init.sql
git commit -m "feat(db): activity_log_stats RPC (24x7 히트맵 집계)"
```

---

## Chunk 2: Electron 백엔드 + IPC

**목표:** 메인 프로세스에 활동 기록·조회·재연결 백필 함수, Realtime 구독, broadcast 채널, IPC 핸들러를 추가한다.

**Files:**
- Modify: `electron/supabase.ts`
- Modify: `electron/main.ts`
- Modify: `electron/realtime.ts`
- Modify: `electron/broadcast.ts`
- Modify: `electron/preload.ts`

### Task 2.1: supabase.ts에 활동 함수 추가

- [ ] **Step 1: 타입 정의 추가** (`electron/supabase.ts` 상단 type 섹션)

```typescript
export type ActionGroup = 'progress' | 'memo' | 'scene' | 'etc';
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'memo_update' | 'comment_add' | 'revision_add' | 'revision_resolve'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide';

export interface ActivityRow {
  id: string;
  user_id: string;
  user_name: string;
  action_type: ActionType;
  action_group: ActionGroup;
  scene_id: string | null;
  scene_label: string | null;
  episode_number: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface RecordActivityInput {
  userId: string;
  userName: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  sceneId?: string | null;
  sceneLabel?: string | null;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  detail?: Record<string, unknown>;
}
```

- [ ] **Step 2: recordActivity 헬퍼 함수**

```typescript
export async function recordActivity(input: RecordActivityInput): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('record_activity', {
      p_user_id: input.userId,
      p_user_name: input.userName,
      p_action_type: input.actionType,
      p_action_group: input.actionGroup,
      p_scene_id: input.sceneId ?? null,
      p_scene_label: input.sceneLabel ?? null,
      p_episode_number: input.episodeNumber ?? null,
      p_department: input.department ?? null,
      p_detail: input.detail ?? {},
    });
    if (error) {
      console.warn('[activity] record failed:', error.message);
      return null;
    }
    return data as string;
  } catch (err) {
    console.warn('[activity] record exception:', err);
    return null;
  }
}
```

> **Why:** try/catch 외부 호출자에 부담 주지 않도록 헬퍼 안에서 모두 흡수. 본 mutation 흐름은 절대 중단 안 됨.

- [ ] **Step 3: listActivities, getActivityStats, backfillActivities**

```typescript
export async function listActivities(opts: {
  before?: string;
  limit?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}): Promise<ActivityRow[]> {
  let q = supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.before) q = q.lt('created_at', opts.before);
  if (opts.groups && opts.groups.length > 0) q = q.in('action_group', opts.groups);
  if (opts.department) q = q.eq('department', opts.department);

  const { data, error } = await q;
  if (error) throw new Error(`listActivities failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

export async function getActivityStats(opts: {
  days?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}): Promise<Array<{ day_of_week: number; hour: number; count: number }>> {
  const since = new Date(Date.now() - (opts.days ?? 7) * 86400000).toISOString();
  const { data, error } = await supabase.rpc('activity_log_stats', {
    p_since: since,
    p_groups: opts.groups ?? null,
    p_department: opts.department ?? null,
  });
  if (error) throw new Error(`getActivityStats failed: ${error.message}`);
  return data ?? [];
}

export async function backfillActivities(since: string, limit = 200): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`backfillActivities failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}
```

- [ ] **Step 4: 빌드 검증**

```bash
npx tsc --noEmit
```

기대: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add electron/supabase.ts
git commit -m "feat(activity): supabase.ts에 record/list/stats/backfill 함수 추가"
```

### Task 2.2: IPC 핸들러 (main.ts)

- [ ] **Step 1: 핸들러 3개 추가** (`electron/main.ts` 적절한 위치, 기존 handler 그룹 근처)

```typescript
// ─── IPC 핸들러: 활동 기록 ────────────────────────────────────

ipcMain.handle('activity:list', async (_event, opts: {
  before?: string;
  limit?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}) => {
  try {
    const rows = await listActivities(opts);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('activity:stats', async (_event, opts: {
  days?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}) => {
  try {
    const stats = await getActivityStats(opts);
    return { ok: true, stats };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('activity:backfill', async (_event, since: string) => {
  try {
    const rows = await backfillActivities(since);
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

> **주의:** `activity:record`는 노출하지 않음. mutation 함수 내부에서만 `recordActivity`를 부른다 (§3.4 신뢰 모델).

- [ ] **Step 2: 빌드 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(activity): IPC 핸들러 list/stats/backfill 추가"
```

### Task 2.3: Realtime 구독 + Broadcast

- [ ] **Step 1: realtime.ts에 activity_log 채널 추가**

`electron/realtime.ts`의 기존 채널 등록 부분을 찾아 다음 추가:

```typescript
channel.on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'activity_log' },
  (payload) => {
    broadcastActivityInsert(payload.new as ActivityRow);
  }
);
```

- [ ] **Step 2: broadcast.ts에 함수 추가**

```typescript
export function broadcastActivityInsert(row: ActivityRow): void {
  const windows = BrowserWindow.getAllWindows();
  for (const w of windows) {
    w.webContents.send('activity:realtime-insert', row);
  }
}
```

- [ ] **Step 3: preload.ts에 activity 메서드 추가**

```typescript
// existing electronAPI 객체 안에 추가
activityList: (opts: any) => ipcRenderer.invoke('activity:list', opts),
activityStats: (opts: any) => ipcRenderer.invoke('activity:stats', opts),
activityBackfill: (since: string) => ipcRenderer.invoke('activity:backfill', since),
onActivityRealtimeInsert: (cb: (row: any) => void) => {
  const handler = (_event: any, row: any) => cb(row);
  ipcRenderer.on('activity:realtime-insert', handler);
  return () => ipcRenderer.removeListener('activity:realtime-insert', handler);
},
```

- [ ] **Step 4: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit
git add electron/realtime.ts electron/broadcast.ts electron/preload.ts
git commit -m "feat(activity): Realtime 구독 + broadcast + preload API"
```

---

## Chunk 3: Mutation 함수 패치

**목표:** `electron/supabase.ts`의 12개 mutation 함수에 `recordActivity()` 호출을 추가한다 (호출 지점 14개). 각 호출은 try/catch로 감싸 본 mutation 결과에 영향을 주지 않는다.

**Files:**
- Modify: `electron/supabase.ts` (기존 mutation 함수들)

### Task 3.1: updateSceneField 패치

기존 함수 시그니처는 `updateSceneField(sceneId, field, value, ...)` 패턴. 4종 stage + memo + assignee + layout 분기 추가.

- [ ] **Step 1: 함수 안에 활동 기록 코드 추가**

```typescript
// updateSceneField 함수 끝에 추가:
const userId = /* 호출 컨텍스트에서 받기 */;
const userName = /* 호출 컨텍스트에서 받기 */;

let actionType: ActionType | null = null;
let actionGroup: ActionGroup | null = null;
const detail: Record<string, unknown> = {};

if (field === 'lo' || field === 'done' || field === 'review' || field === 'png') {
  actionType = `stage_${field}` as ActionType;
  actionGroup = 'progress';
  detail.value = value;
} else if (field === 'memo') {
  actionType = 'memo_update';
  actionGroup = 'memo';
} else if (field === 'assignee') {
  actionType = 'assignee_change';
  actionGroup = 'etc';
  detail.to = value;
} else if (field === 'layout') {
  actionType = 'layout_change';
  actionGroup = 'etc';
  detail.to = value;
}

if (actionType && actionGroup) {
  await recordActivity({
    userId, userName, actionType, actionGroup,
    sceneId, sceneLabel, episodeNumber, department,
    detail,
  });
}
```

> **주의:** 기존 시그니처가 userId/userName/sceneLabel/episodeNumber/department를 안 받으면 시그니처를 확장해야 한다. 호출자(supabaseService.ts)에서도 함께 전달하도록 패치 필요.

- [ ] **Step 2: 호출자(supabaseService.ts) 패치** — 모든 `updateSceneField` 호출 지점에 활동 메타 추가

- [ ] **Step 3: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit
git add electron/supabase.ts src/services/supabaseService.ts
git commit -m "feat(activity): updateSceneField에 활동 기록 추가 (4단계+memo+assignee+layout)"
```

### Task 3.2: addScene / deleteScene 패치

각각 끝에 `recordActivity({ actionType: 'scene_add' | 'scene_delete', actionGroup: 'scene', ... })` 추가. 패턴 동일.

- [ ] **Step 1-3:** Task 3.1 동일 패턴 적용 + 커밋

### Task 3.3: addComment / addRevision / updateRevisionStatus 패치

- [ ] **Step 1:** `addComment` → `comment_add` (group: memo)
- [ ] **Step 2:** `addRevision` → `revision_add` (group: memo)
- [ ] **Step 3:** `updateRevisionStatus(status='resolved')` → `revision_resolve` (group: memo)
- [ ] **Step 4:** 빌드 검증 + 커밋

### Task 3.4: uploadImage 패치

- [ ] **Step 1:** type='storyboard' → `image_upload_storyboard` (group: etc)
- [ ] **Step 2:** type='guide' → `image_upload_guide` (group: etc)
- [ ] **Step 3:** 빌드 검증 + 커밋

### Task 3.5: bulk RPC 호출자 패치 (supabaseService.ts)

bulk_update_scene_stages / bulk_delete_scenes / bulk_update_scene_fields 호출 시 새 파라미터 (`p_user_name`, sceneLabel/episodeNumber/department 등) 전달.

- [ ] **Step 1: 호출 코드 갱신 + 빌드 검증 + 커밋**

---

## Chunk 4: 타입 + Store + 서비스

**목표:** 렌더러 측 타입, Zustand store, 서비스 래퍼, 유틸 함수를 작성한다. TDD: 유틸 함수는 단위 테스트 우선.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/supabaseService.ts`
- Create: `src/stores/useActivityStore.ts`
- Create: `src/components/widgets/activity/utils.ts`
- Create: `src/components/widgets/activity/constants.ts`
- Create: `src/components/widgets/activity/__tests__/utils.test.ts`

### Task 4.1: 타입 정의

- [ ] **Step 1: src/types/index.ts에 추가**

```typescript
export type ActionGroup = 'progress' | 'memo' | 'scene' | 'etc';
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'memo_update' | 'comment_add' | 'revision_add' | 'revision_resolve'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide';

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  sceneId: string | null;
  sceneLabel: string | null;
  episodeNumber: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}
```

- [ ] **Step 2: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/types/index.ts
git commit -m "feat(activity): Activity, ActionType, ActionGroup 타입 정의"
```

### Task 4.2: constants.ts (그룹 매핑, 컬러)

- [ ] **Step 1: 작성**

```typescript
import type { ActionType, ActionGroup } from '@/types';

export const ACTION_TYPE_TO_GROUP: Record<ActionType, ActionGroup> = {
  stage_lo: 'progress', stage_done: 'progress', stage_review: 'progress', stage_png: 'progress',
  memo_update: 'memo', comment_add: 'memo', revision_add: 'memo', revision_resolve: 'memo',
  scene_add: 'scene', scene_delete: 'scene',
  assignee_change: 'etc', layout_change: 'etc',
  image_upload_storyboard: 'etc', image_upload_guide: 'etc',
};

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  stage_lo: 'LO 완료',
  stage_done: '완료 진척',
  stage_review: '검수 통과',
  stage_png: 'PNG 마감',
  memo_update: '메모 수정',
  comment_add: '댓글 작성',
  revision_add: '리비전 등록',
  revision_resolve: '리비전 해결',
  scene_add: '씬 추가',
  scene_delete: '씬 삭제',
  assignee_change: '담당자 변경',
  layout_change: '레이아웃 변경',
  image_upload_storyboard: '스토리보드 업로드',
  image_upload_guide: '가이드 업로드',
};

export const ACTION_TYPE_COLOR: Record<ActionType, string> = {
  stage_lo: '#74B9FF', stage_done: '#A29BFE', stage_review: '#FDCB6E', stage_png: '#00B894',
  memo_update: '#FF8FA3', comment_add: '#FFA94D', revision_add: '#4DD0E1', revision_resolve: '#81ECEC',
  scene_add: '#6FCF97', scene_delete: '#FF7675',
  assignee_change: '#95A5A6', layout_change: '#95A5A6',
  image_upload_storyboard: '#95A5A6', image_upload_guide: '#95A5A6',
};

export const GROUP_LABEL: Record<ActionGroup, string> = {
  progress: '작업 진행', memo: '메모/댓글', scene: '씬 생성/삭제', etc: '기타',
};

export const GROUP_DOT_COLOR: Record<ActionGroup, string> = {
  progress: '#74B9FF', memo: '#FF8FA3', scene: '#6FCF97', etc: '#95A5A6',
};

export const GROUP_WINDOW_MS = 5 * 60 * 1000;          // 5분
export const PAGE_SIZE = 100;
export const MAX_CACHED = 500;
export const KST_TIMEZONE = 'Asia/Seoul';
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/widgets/activity/constants.ts
git commit -m "feat(activity): 상수 (그룹 매핑, 컬러, 라벨)"
```

### Task 4.3: utils.ts (TDD)

- [ ] **Step 1: 실패 테스트 작성** — `src/components/widgets/activity/__tests__/utils.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { groupActivities, pickGoldenWindow } from '../utils';
import type { Activity } from '@/types';

const mkActivity = (overrides: Partial<Activity>): Activity => ({
  id: Math.random().toString(),
  userId: 'u1', userName: '한솔',
  actionType: 'stage_lo', actionGroup: 'progress',
  sceneId: 's1', sceneLabel: 'EP01 A씬 #1',
  episodeNumber: 1, department: 'bg',
  detail: {}, createdAt: '2026-04-27T10:00:00Z',
  ...overrides,
});

describe('groupActivities', () => {
  it('빈 배열은 빈 배열 반환', () => {
    expect(groupActivities([])).toEqual([]);
  });

  it('5분 윈도우 안에서 같은 user/type/episode를 묶음', () => {
    const items = [
      mkActivity({ id: '1', createdAt: '2026-04-27T10:00:00Z' }),
      mkActivity({ id: '2', createdAt: '2026-04-27T10:02:00Z' }),
      mkActivity({ id: '3', createdAt: '2026-04-27T10:04:00Z' }),
    ];
    const result = groupActivities(items);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    expect(result[0].items).toHaveLength(3);
  });

  it('5분을 넘기면 다른 그룹', () => {
    const items = [
      mkActivity({ id: '1', createdAt: '2026-04-27T10:00:00Z' }),
      mkActivity({ id: '2', createdAt: '2026-04-27T10:06:00Z' }),
    ];
    const result = groupActivities(items);
    expect(result).toHaveLength(2);
  });

  it('단일 항목은 그룹화하지 않음', () => {
    const items = [mkActivity({ id: '1' })];
    const result = groupActivities(items);
    expect(result[0].type).toBe('item');
  });

  it('다른 user는 다른 그룹', () => {
    const items = [
      mkActivity({ id: '1', userId: 'u1' }),
      mkActivity({ id: '2', userId: 'u2' }),
    ];
    expect(groupActivities(items)).toHaveLength(2);
  });
});

describe('pickGoldenWindow', () => {
  it('연속 2시간 합 최대 슬롯 반환', () => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    grid[1][14] = 5; grid[1][15] = 7;       // 화 14-15시 합 12
    grid[2][10] = 8;                         // 수 10시 단독 8
    const result = pickGoldenWindow(grid);
    expect(result.day).toBe(1);
    expect(result.hour).toBe(14);
    expect(result.count).toBe(12);
  });

  it('빈 격자는 null 반환', () => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    expect(pickGoldenWindow(grid)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

```bash
npx vitest run src/components/widgets/activity/__tests__/utils.test.ts
```

기대: FAIL (모듈 없음)

- [ ] **Step 3: 구현 — `src/components/widgets/activity/utils.ts`**

```typescript
import type { Activity } from '@/types';
import { GROUP_WINDOW_MS } from './constants';

export type FeedItem =
  | { type: 'item'; activity: Activity }
  | { type: 'group'; key: string; items: Activity[] };

export function groupActivities(items: Activity[]): FeedItem[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result: FeedItem[] = [];
  let buffer: Activity[] = [sorted[0]];

  const sameGroup = (a: Activity, b: Activity) => {
    if (a.userId !== b.userId) return false;
    if (a.actionType !== b.actionType) return false;
    if (a.episodeNumber !== b.episodeNumber) return false;
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return Math.abs(da - db) <= GROUP_WINDOW_MS;
  };

  const flush = () => {
    if (buffer.length === 1) {
      result.push({ type: 'item', activity: buffer[0] });
    } else {
      result.push({
        type: 'group',
        key: `${buffer[0].userId}:${buffer[0].actionType}:${buffer[0].episodeNumber ?? 'na'}:${buffer[0].id}`,
        items: [...buffer],
      });
    }
    buffer = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = buffer[buffer.length - 1];
    const cur = sorted[i];
    if (sameGroup(prev, cur)) buffer.push(cur);
    else { flush(); buffer.push(cur); }
  }
  flush();
  return result;
}

export interface GoldenWindow {
  day: number;
  hour: number;
  count: number;
}

export function pickGoldenWindow(grid: number[][]): GoldenWindow | null {
  let best: GoldenWindow | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 23; h++) {
      const sum = (grid[d]?.[h] ?? 0) + (grid[d]?.[h + 1] ?? 0);
      if (sum === 0) continue;
      if (!best || sum > best.count) best = { day: d, hour: h, count: sum };
    }
  }
  return best;
}

export function pickGoldenHour(hourTotals: number[]): { hour: number; ratio: number } | null {
  const total = hourTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestHour = 0, bestSum = 0;
  for (let h = 0; h < 23; h++) {
    const sum = hourTotals[h] + (hourTotals[h + 1] ?? 0);
    if (sum > bestSum) { bestSum = sum; bestHour = h; }
  }
  return { hour: bestHour, ratio: bestSum / total };
}

export function pickGoldenDay(dayTotals: number[]): { day: number; ratio: number } | null {
  const total = dayTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestDay = 0, bestCount = 0;
  for (let d = 0; d < 7; d++) {
    if (dayTotals[d] > bestCount) { bestCount = dayTotals[d]; bestDay = d; }
  }
  return { day: bestDay, ratio: bestCount / total };
}

export function buildHeatmapGrid(stats: Array<{ day_of_week: number; hour: number; count: number }>): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of stats) {
    // PostgreSQL EXTRACT(dow): 0=Sunday, 1=Monday, ..., 6=Saturday
    // 표시는 월=0..일=6 으로 정규화
    const displayDay = (s.day_of_week + 6) % 7;
    grid[displayDay][s.hour] = s.count;
  }
  return grid;
}

export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

```bash
npx vitest run src/components/widgets/activity/__tests__/utils.test.ts
```

기대: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/widgets/activity/utils.ts src/components/widgets/activity/__tests__/utils.test.ts
git commit -m "feat(activity): utils (groupActivities, pickGoldenWindow, intensityLevel) + tests"
```

### Task 4.4: supabaseService.ts 활동 래퍼

- [ ] **Step 1: 함수 추가**

```typescript
import type { Activity, ActionGroup } from '@/types';

export async function listActivities(opts: {
  before?: string; limit?: number;
  groups?: ActionGroup[]; department?: 'bg' | 'acting' | null;
}): Promise<Activity[]> {
  const res = await window.electronAPI.activityList(opts);
  if (!res?.ok) throw new Error(res?.error || 'listActivities failed');
  return res.rows.map(rowToActivity);
}

export async function getActivityStats(opts: {
  days?: number; groups?: ActionGroup[]; department?: 'bg' | 'acting' | null;
}): Promise<Array<{ day_of_week: number; hour: number; count: number }>> {
  const res = await window.electronAPI.activityStats(opts);
  if (!res?.ok) throw new Error(res?.error || 'getActivityStats failed');
  return res.stats;
}

export async function backfillActivities(since: string): Promise<Activity[]> {
  const res = await window.electronAPI.activityBackfill(since);
  if (!res?.ok) throw new Error(res?.error || 'backfillActivities failed');
  return res.rows.map(rowToActivity);
}

export function subscribeToActivityRealtime(cb: (activity: Activity) => void): () => void {
  return window.electronAPI.onActivityRealtimeInsert((row: any) => cb(rowToActivity(row)));
}

function rowToActivity(row: any): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    actionType: row.action_type,
    actionGroup: row.action_group,
    sceneId: row.scene_id,
    sceneLabel: row.scene_label,
    episodeNumber: row.episode_number,
    department: row.department,
    detail: row.detail,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 2: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/services/supabaseService.ts
git commit -m "feat(activity): supabaseService 활동 래퍼"
```

### Task 4.5: useActivityStore (Zustand)

- [ ] **Step 1: 작성** — `src/stores/useActivityStore.ts`

```typescript
import { create } from 'zustand';
import type { Activity, ActionGroup } from '@/types';
import * as supabaseService from '@/services/supabaseService';
import { useAppStore } from './useAppStore';
import { buildHeatmapGrid } from '@/components/widgets/activity/utils';
import { MAX_CACHED, PAGE_SIZE } from '@/components/widgets/activity/constants';

const FILTERS_KEY = 'bflow_activity_filters';
const MODE_KEY = 'bflow_activity_golden_mode';

type GoldenMode = 'heatmap' | 'hour' | 'day';

interface ActivityState {
  activities: Activity[];
  statsGrid: number[][];
  pendingByLocalId: Map<string, string>;
  lastSeenCreatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;

  filters: { groups: Set<ActionGroup> };
  goldenMode: GoldenMode;

  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  loadStats(): Promise<void>;
  backfillSince(): Promise<void>;
  prependOptimistic(localTmpId: string, partial: Activity): void;
  replaceTmpId(localTmpId: string, realUuid: string): void;
  receiveRealtime(activity: Activity): void;
  setFilter(group: ActionGroup, on: boolean): void;
  setGoldenMode(mode: GoldenMode): void;
}

function loadFilters(): Set<ActionGroup> {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set(['progress', 'memo', 'scene', 'etc']);
}
function saveFilters(set: Set<ActionGroup>) {
  localStorage.setItem(FILTERS_KEY, JSON.stringify([...set]));
}
function loadMode(): GoldenMode {
  return (localStorage.getItem(MODE_KEY) as GoldenMode) || 'heatmap';
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  statsGrid: Array.from({ length: 7 }, () => Array(24).fill(0)),
  pendingByLocalId: new Map(),
  lastSeenCreatedAt: null,
  isLoading: false,
  error: null,
  hasMore: true,
  filters: { groups: loadFilters() },
  goldenMode: loadMode(),

  async loadInitial() {
    set({ isLoading: true, error: null });
    try {
      const department = useAppStore.getState().activeDepartment === 'all' ? null : useAppStore.getState().activeDepartment;
      const rows = await supabaseService.listActivities({ limit: PAGE_SIZE, department });
      set({
        activities: rows,
        lastSeenCreatedAt: rows[0]?.createdAt ?? null,
        hasMore: rows.length === PAGE_SIZE,
        isLoading: false,
      });
      await get().loadStats();
    } catch (err: any) {
      set({ error: String(err?.message || err), isLoading: false });
    }
  },

  async loadMore() {
    const { activities, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;
    const last = activities[activities.length - 1];
    if (!last) return;
    set({ isLoading: true });
    try {
      const department = useAppStore.getState().activeDepartment === 'all' ? null : useAppStore.getState().activeDepartment;
      const rows = await supabaseService.listActivities({
        before: last.createdAt, limit: PAGE_SIZE, department,
      });
      const sevenDaysAgo = Date.now() - 7 * 86400000;
      const filtered = rows.filter(r => new Date(r.createdAt).getTime() >= sevenDaysAgo);
      const merged = [...activities, ...filtered].slice(0, MAX_CACHED);
      set({
        activities: merged,
        hasMore: rows.length === PAGE_SIZE && filtered.length === rows.length && merged.length < MAX_CACHED,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: String(err?.message || err), isLoading: false });
    }
  },

  async loadStats() {
    try {
      const department = useAppStore.getState().activeDepartment === 'all' ? null : useAppStore.getState().activeDepartment;
      const stats = await supabaseService.getActivityStats({ days: 7, department });
      set({ statsGrid: buildHeatmapGrid(stats) });
    } catch (err) {
      console.warn('[activity] stats load failed:', err);
    }
  },

  async backfillSince() {
    const since = get().lastSeenCreatedAt;
    if (!since) { await get().loadInitial(); return; }
    try {
      const rows = await supabaseService.backfillActivities(since);
      for (const r of rows) get().receiveRealtime(r);
      await get().loadStats();
    } catch (err) {
      console.warn('[activity] backfill failed:', err);
    }
  },

  prependOptimistic(localTmpId, partial) {
    set(s => ({
      activities: [partial, ...s.activities].slice(0, MAX_CACHED),
      pendingByLocalId: new Map(s.pendingByLocalId).set(localTmpId, partial.id),
    }));
  },

  replaceTmpId(localTmpId, realUuid) {
    set(s => {
      const tmpUuid = s.pendingByLocalId.get(localTmpId);
      if (!tmpUuid) return s;
      const newMap = new Map(s.pendingByLocalId);
      newMap.delete(localTmpId);
      newMap.set(localTmpId, realUuid);
      return {
        pendingByLocalId: newMap,
        activities: s.activities.map(a => a.id === tmpUuid ? { ...a, id: realUuid } : a),
      };
    });
  },

  receiveRealtime(activity) {
    set(s => {
      // 1) UUID 일치 → 무시
      if (s.activities.some(a => a.id === activity.id)) return s;
      // 2) 임시→진짜 매핑 일치 → 무시 (이미 replaceTmpId에서 처리됨)
      // 3) 소프트 키 폴백: 본인 + 같은 type/scene + 5초 이내
      const myId = useAppStore.getState().currentUser?.id;
      if (activity.userId === myId) {
        const fiveSecAgo = Date.now() - 5000;
        const match = s.activities.find(a =>
          a.id.startsWith('tmp_') &&
          a.userId === activity.userId &&
          a.actionType === activity.actionType &&
          a.sceneId === activity.sceneId &&
          new Date(a.createdAt).getTime() >= fiveSecAgo
        );
        if (match) {
          return {
            activities: s.activities.map(a => a.id === match.id ? activity : a),
          };
        }
      }
      // 신규 prepend
      return {
        activities: [activity, ...s.activities].slice(0, MAX_CACHED),
        lastSeenCreatedAt: activity.createdAt,
        statsGrid: incrementGrid(s.statsGrid, activity.createdAt),
      };
    });
  },

  setFilter(group, on) {
    const next = new Set(get().filters.groups);
    if (on) next.add(group); else next.delete(group);
    saveFilters(next);
    set({ filters: { groups: next } });
  },

  setGoldenMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
    set({ goldenMode: mode });
  },
}));

function incrementGrid(grid: number[][], createdAt: string): number[][] {
  const dt = new Date(createdAt);
  const kst = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const d = (kst.getDay() + 6) % 7;          // 월=0..일=6
  const h = kst.getHours();
  const next = grid.map(row => [...row]);
  next[d][h] += 1;
  return next;
}
```

- [ ] **Step 2: 빌드 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/stores/useActivityStore.ts
git commit -m "feat(activity): useActivityStore Zustand 스토어"
```

---

## Chunk 5: UI 컴포넌트

**목표:** 위젯 본체 + 히트맵 + 막대 차트 + 피드 + 필터칩 + 툴팁 컴포넌트를 작성. 시안([final.html](../specs/mockups/2026-04-27-recent-activity-widget/final.html))의 스타일을 Tailwind로 옮긴다.

**Files:**
- Create: `src/components/widgets/activity/GoldenHeatmap.tsx`
- Create: `src/components/widgets/activity/GoldenBarChart.tsx`
- Create: `src/components/widgets/activity/ActivityFeed.tsx`
- Create: `src/components/widgets/activity/ActivityFilterChips.tsx`
- Create: `src/components/widgets/activity/ActivityTooltip.tsx`
- Create: `src/components/widgets/RecentActivityWidget.tsx`

### Task 5.1: GoldenHeatmap.tsx

- [ ] **Step 1: 컴포넌트 작성** — 시안의 24×7 격자, 색 강도, 호버 툴팁

```typescript
import { intensityLevel } from './utils';
import { useActivityStore } from '@/stores/useActivityStore';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

export function GoldenHeatmap({ onCellHover }: { onCellHover: (cell: { day: number; hour: number; count: number; x: number; y: number } | null) => void }) {
  const grid = useActivityStore(s => s.statsGrid);
  return (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: '22px repeat(24, 1fr)' }}>
      <div></div>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="text-[9px] text-text-secondary/50 text-center">
          {[0, 6, 12, 18].includes(h) ? h : ''}
        </div>
      ))}
      {DAYS.map((day, d) => (
        <FragmentRow key={day} day={day} dayIdx={d} row={grid[d]} onCellHover={onCellHover} />
      ))}
    </div>
  );
}

function FragmentRow({ day, dayIdx, row, onCellHover }: any) {
  return (
    <>
      <div className="text-[10px] text-text-secondary text-right pr-1.5">{day}</div>
      {row.map((count: number, h: number) => {
        const lv = intensityLevel(count);
        const bg = ['rgba(108,92,231,0.06)', 'rgba(108,92,231,0.18)', 'rgba(108,92,231,0.36)', 'rgba(108,92,231,0.58)', 'rgba(108,92,231,0.85)'][lv];
        return (
          <div
            key={h}
            className="aspect-square rounded-[2px] cursor-pointer transition-transform hover:scale-[1.4] hover:z-10 hover:relative"
            style={{ background: bg, ...(lv === 4 ? { boxShadow: '0 0 8px rgba(108,92,231,0.3)' } : {}) }}
            onMouseEnter={(e) => onCellHover({ day: dayIdx, hour: h, count, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => onCellHover(null)}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: 빌드 검증 + 커밋**

### Task 5.2: GoldenBarChart.tsx (시간대 + 요일 두 모드)

- [ ] **Step 1: 작성** — `props.mode: 'hour' | 'day'`로 분기

(코드 생략 — 시안의 `.bar-chart` / `.bar-chart-week` 패턴 동일)

- [ ] **Step 2: 빌드 검증 + 커밋**

### Task 5.3: ActivityFilterChips.tsx

- [ ] **Step 1: 작성** — 4개 칩 + "전체" 칩

(코드 생략 — 시안 `.chip` 패턴)

- [ ] **Step 2: 빌드 검증 + 커밋**

### Task 5.4: ActivityFeed.tsx

- [ ] **Step 1: 작성** — `groupActivities` 활용, 본인 보더 강조, Framer Motion prepend 애니메이션

```typescript
import { motion, AnimatePresence } from 'framer-motion';
import { useActivityStore } from '@/stores/useActivityStore';
import { useAppStore } from '@/stores/useAppStore';
import { groupActivities } from './utils';
import { ACTION_TYPE_LABEL, ACTION_TYPE_COLOR } from './constants';
// ... (시안 패턴 그대로 적용)
```

- [ ] **Step 2: 빌드 검증 + 커밋**

### Task 5.5: ActivityTooltip.tsx (글로벌)

- [ ] **Step 1: 작성** — fixed position, mouse follow, breakdown 표시

- [ ] **Step 2: 빌드 검증 + 커밋**

### Task 5.6: RecentActivityWidget.tsx (메인)

- [ ] **Step 1: 작성** — Widget 베이스 + 헤더(모드 토글/필터/팝아웃) + 인사이트 + 골든타임 + 칩 + 피드

```typescript
import { useEffect } from 'react';
import { Widget } from './Widget';
import { Activity } from 'lucide-react';
import { useActivityStore } from '@/stores/useActivityStore';
import { GoldenHeatmap } from './activity/GoldenHeatmap';
import { GoldenBarChart } from './activity/GoldenBarChart';
import { ActivityFeed } from './activity/ActivityFeed';
import { ActivityFilterChips } from './activity/ActivityFilterChips';
import { ActivityTooltip } from './activity/ActivityTooltip';
import { pickGoldenWindow, pickGoldenHour, pickGoldenDay } from './activity/utils';
import { subscribeToActivityRealtime } from '@/services/supabaseService';

export function RecentActivityWidget() {
  const { goldenMode, setGoldenMode, statsGrid, loadInitial, receiveRealtime, backfillSince } = useActivityStore();

  useEffect(() => {
    loadInitial();
    const unsub = subscribeToActivityRealtime(receiveRealtime);
    // 재연결 감지 (useAppStore.dataConnected 변경 watch — 별도 useEffect)
    return () => unsub();
  }, []);

  // 인사이트 산출
  const insight = computeInsight(goldenMode, statsGrid);

  return (
    <Widget title="최근 작업" icon={<Activity size={14} />}>
      <ModeToggle mode={goldenMode} onChange={setGoldenMode} />
      <InsightBanner text={insight} />
      {goldenMode === 'heatmap' && <GoldenHeatmap />}
      {goldenMode === 'hour' && <GoldenBarChart mode="hour" />}
      {goldenMode === 'day' && <GoldenBarChart mode="day" />}
      <ActivityFilterChips />
      <ActivityFeed />
      <ActivityTooltip />
    </Widget>
  );
}
```

- [ ] **Step 2: 빌드 검증 + 커밋**

---

## Chunk 6: 위젯 등록 + 모니터링 + 빌드 검증

**목표:** Dashboard.tsx에 위젯 등록, SettingsView에 모니터링 라인, 전체 빌드 + 수동 테스트.

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/SettingsView.tsx`
- Create: `src/components/settings/ActivityStorageInfo.tsx`

### Task 6.1: Dashboard.tsx에 위젯 등록

- [ ] **Step 1: import + WIDGET_NAMES + 디폴트 레이아웃**
- [ ] **Step 2: 위젯 추가 메뉴에 항목 추가**
- [ ] **Step 3: 빌드 검증 + 커밋**

### Task 6.2: SettingsView.tsx에 모니터링 추가

- [ ] **Step 1: ActivityStorageInfo 컴포넌트 작성** — RPC 1회 호출로 count + size 표시

```typescript
export function ActivityStorageInfo() {
  const [info, setInfo] = useState<{ count: number; sizeMB: number } | null>(null);
  useEffect(() => {
    window.electronAPI.activityStorageInfo?.().then(setInfo);
  }, []);
  if (!info) return null;
  return (
    <div className="text-xs text-text-secondary">
      활동 기록: {info.count.toLocaleString()}건 · 약 {info.sizeMB.toFixed(1)} MB · 1년 후 자동 정리
    </div>
  );
}
```

(IPC `activity:storage-info` 핸들러도 추가 — `SELECT count(*), pg_total_relation_size('activity_log')`)

- [ ] **Step 2: SettingsView에서 사용 + 빌드 검증 + 커밋**

### Task 6.3: 전체 빌드 + 수동 테스트

- [ ] **Step 1:** `npx tsc --noEmit` 통과
- [ ] **Step 2:** `npx vite build` 통과
- [ ] **Step 3:** `npx vitest run` 통과 (모든 단위 테스트)
- [ ] **Step 4: 수동 검증 체크리스트** (스펙 §9.2 참조)
  - [ ] 두 윈도우 동시 토글 → 활동 1번씩만 보임 (중복 없음)
  - [ ] 본인 토글 → 즉시 피드 최상단 (보더 강조)
  - [ ] 다른 사용자 토글 → ~100ms 후 피드 최상단
  - [ ] 필터 칩 토글 → 피드 + 히트맵 동시 갱신
  - [ ] 그래프 모드 전환 → 인사이트 텍스트 변경
  - [ ] 그룹화 5건 펼침/접기
  - [ ] 호버 툴팁 표시
  - [ ] 빈 상태 → 첫 활동 흐름
  - [ ] 오프라인 진입 → 헤더 점, 재연결 backfill
  - [ ] 위젯 클릭 → 씬 모달 열림

- [ ] **Step 5: 최종 커밋**

```bash
git commit -m "feat: 최근 작업 위젯 v1 출시 (활동 피드 + 골든타임 분석)"
```

---

## 완료 기준

- [ ] DB 마이그레이션 실행 완료 (`activity_log` 테이블 + RPC + cron)
- [ ] 모든 mutation 호출에 활동 기록 추가 + Realtime 동작 확인
- [ ] 위젯이 Dashboard에 표시되고 4가지 시안 요소(헤더/인사이트/골든타임/필터/피드) 모두 동작
- [ ] 단위 테스트 + 통합 수동 테스트 모두 통과
- [ ] `tsc --noEmit` + `vite build` 통과
- [ ] PR 머지 후 v1.14.0 태그
