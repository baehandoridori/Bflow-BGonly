# B flow v1.23.0 UX 폴리싱 — 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최근 작업 위젯에 시간 단위 탐색을 더하고, 활동 분석 모달(7카드)을 신설하고, 자간/업데이트/버전 호버를 폴리싱한다.

**Architecture:** 기존 `useActivityStore` + Supabase RPC 패턴 그대로. 위젯에 단위/기간 상태 추가 + 신규 RPC 2종(get_activity_stats_v2, get_activity_insights). 컴포넌트는 폴더 구조 유지하며 신규 5개 + 수정 13개. UI 토큰/Tailwind 클래스 그대로 활용.

**Tech Stack:** Electron + React 18 + TypeScript + Tailwind + Zustand + @supabase/supabase-js + node:test (검증)

**Spec:** [docs/superpowers/specs/2026-05-09-bflow-ux-polish-design.md](../specs/2026-05-09-bflow-ux-polish-design.md)
**시안 미리보기:** [docs/superpowers/specs/mockups/2026-05-09-bflow-ux-polish/preview.html](../specs/mockups/2026-05-09-bflow-ux-polish/preview.html) (포트 5560)

---

## 검증 정책 (전 청크 공통)

- 컴포넌트 단위는 React 테스트 인프라 부재 → **typecheck + 빌드 + preview 동작 확인**으로 검증.
- 순수 함수(헬퍼)는 `tests/*.test.ts`에 `node --test` 형식으로 unit test 추가 (이미 존재하는 `recentActivityNavigation.test.ts` 패턴 따름).
- 각 청크 끝에 다음 명령으로 검증:
  ```bash
  npm run typecheck && npm run build:vite
  ```
- 자동 업데이트 관련 변경 시 `npm run test:auto-update` 추가.

---

## Chunk 1: Foundation — 마이그레이션, 타입, store, supabase 래퍼

신규 RPC 2종을 DB에 정의하고, 클라이언트가 호출할 타입/래퍼를 준비한다. UI는 아직 손대지 않음.

### Task 1: SQL 마이그레이션 (RPC 2종 추가)

**Files:**
- Create: `DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql`
- Modify: `DEVLOG/supabase-init.sql` (재실행 안전성)

- [ ] **Step 1: 마이그레이션 파일 생성**

`DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql`:

```sql
-- v1.23.0 — get_activity_stats_v2 (시간 단위 확장) + get_activity_insights (분석 모달)

-- 기존 get_activity_stats 시그니처 변경 X (호환성). 새 함수 추가.

-- 1. 기간/granularity 기반 통계 (히트맵·막대 데이터 소스)
CREATE OR REPLACE FUNCTION get_activity_stats_v2(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_granularity text,            -- 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals'
  p_department text DEFAULT NULL,
  p_groups text[] DEFAULT NULL
) RETURNS TABLE (
  bucket1 int,
  bucket2 int,
  total int,
  count_progress int,
  count_memo int,
  count_scene int,
  count_etc int
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_granularity = 'hour-of-day-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(dow  FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket1,
        EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-totals' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        0 AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_activity_stats_v2(timestamptz, timestamptz, text, text, text[]) TO anon, authenticated;

-- 2. 분석 모달 데이터 (7카드 한 번에)
CREATE OR REPLACE FUNCTION get_activity_insights(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_department text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- 1) monthDowGrid: 12개월 × 7요일
  v_result := v_result || jsonb_build_object('monthDowGrid', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('month', m, 'dow', d, 'count', c))
    FROM (
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS m,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS d,
        COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY m, d
    ) t
  ), '[]'::jsonb));

  -- 2) userBreakdown: 활동 많은 상위 5명 + 합계
  v_result := v_result || jsonb_build_object('userBreakdown', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'userName', user_name, 'count', c) ORDER BY c DESC)
    FROM (
      SELECT user_id, MAX(user_name) AS user_name, COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT 5
    ) t
  ), '[]'::jsonb));

  -- 3) userBreakdownTotal (전체 합계 — 상위 5명 외 "기타" 계산용)
  v_result := v_result || jsonb_build_object('userBreakdownTotal', COALESCE((
    SELECT COUNT(*)::int FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ), 0));

  -- 4) stageBreakdown: LO/완료/검수/PNG 카운트
  v_result := v_result || jsonb_build_object('stageBreakdown', (
    SELECT jsonb_build_object(
      'lo',     COUNT(*) FILTER (WHERE action_type='stage_lo'),
      'done',   COUNT(*) FILTER (WHERE action_type='stage_done'),
      'review', COUNT(*) FILTER (WHERE action_type='stage_review'),
      'png',    COUNT(*) FILTER (WHERE action_type='stage_png')
    )
    FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ));

  -- 5) topScenes: 활동 많은 씬 Top 10
  v_result := v_result || jsonb_build_object('topScenes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sceneId', scene_id,
      'sceneLabel', scene_label,
      'episodeNumber', episode_number,
      'total', total,
      'revCount', rev_count,
      'memoCount', memo_count,
      'stageCount', stage_count
    ) ORDER BY total DESC)
    FROM (
      SELECT
        scene_id,
        MAX(scene_label)        AS scene_label,
        MAX(episode_number)     AS episode_number,
        COUNT(*)::int           AS total,
        COUNT(*) FILTER (WHERE action_type IN ('revision_add','revision_resolve'))::int AS rev_count,
        COUNT(*) FILTER (WHERE action_type IN ('memo_update','comment_add'))::int       AS memo_count,
        COUNT(*) FILTER (WHERE action_group='progress')::int                            AS stage_count
      FROM activity_log
      WHERE scene_id IS NOT NULL
        AND created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY scene_id
      ORDER BY total DESC
      LIMIT 10
    ) t
  ), '[]'::jsonb));

  -- 6) weeklyCompleted: 주별 PNG 도달 씬 수 (최근 12주)
  v_result := v_result || jsonb_build_object('weeklyCompleted', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('weekStart', week_start, 'completedSceneCount', cnt) ORDER BY week_start)
    FROM (
      SELECT
        date_trunc('week', created_at AT TIME ZONE 'Asia/Seoul')::date AS week_start,
        COUNT(DISTINCT scene_id)::int AS cnt
      FROM activity_log
      WHERE action_type = 'stage_png'
        AND scene_id IS NOT NULL
        AND created_at >= GREATEST(p_range_start, now() - INTERVAL '12 weeks')
        AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY week_start
    ) t
  ), '[]'::jsonb));

  -- 7) sceneFlow + episodeProgress 는 스키마상 단순 RPC 어려움 (씬 단계 첫 도달 timestamp 추출 필요).
  --    v1.23.0 에서는 클라이언트가 별도로 scenes/episodes 데이터에서 보강 — 본 RPC는 위 6개만 반환.
  --    sceneFlow / episodeProgress 키는 빈 배열/객체로 채워서 응답 형태 일관성 유지.
  v_result := v_result || jsonb_build_object(
    'sceneFlow', '{}'::jsonb,
    'episodeProgress', '[]'::jsonb
  );

  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION get_activity_insights(timestamptz, timestamptz, text) TO anon, authenticated;
```

- [ ] **Step 2: supabase-init.sql 에 동일 함수 추가 (재실행 안전 위해)**

`DEVLOG/supabase-init.sql` 파일 끝에 위 두 RPC 정의 그대로 append (`CREATE OR REPLACE`이므로 재실행 안전).

- [ ] **Step 3: 라이브 DB 적용은 한솔이 수동으로 (Supabase SQL editor)**

이 단계는 자동 실행 X. 한솔에게 마이그레이션 적용 시점에 안내.

- [ ] **Step 4: 커밋**

```bash
git add DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql DEVLOG/supabase-init.sql
git commit -m "v1.23.0 SQL: get_activity_stats_v2 + get_activity_insights RPC 추가"
```

---

### Task 2: 타입 정의 추가

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 파일에 새 타입 추가**

`src/types/index.ts` 마지막에 추가:

```ts
/** 최근 작업 위젯 시간 단위 */
export type TimeUnit = 'week' | 'month' | 'year';

/** 단위 + 기간 인덱스(0=현재, 1=이전, ...) */
export interface TimeRange {
  unit: TimeUnit;
  rangeIdx: number;
}

/** 히트맵 셀 클릭 필터 */
export interface CellFilter {
  bucket1: number;  // dow 또는 month
  bucket2: number;  // hour 또는 dow
}

/** 활동 통계 v2 한 row */
export interface ActivityStatRowV2 {
  bucket1: number;
  bucket2: number;
  total: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}

/** 분석 모달 raw data (RPC 응답) */
export interface ActivityInsightsRaw {
  monthDowGrid: Array<{ month: number; dow: number; count: number }>;
  userBreakdown: Array<{ userId: string; userName: string; count: number }>;
  userBreakdownTotal: number;
  stageBreakdown: { lo: number; done: number; review: number; png: number };
  topScenes: Array<{
    sceneId: string;
    sceneLabel: string | null;
    episodeNumber: number | null;
    total: number;
    revCount: number;
    memoCount: number;
    stageCount: number;
  }>;
  weeklyCompleted: Array<{ weekStart: string; completedSceneCount: number }>;
  sceneFlow: Record<string, never>;       // v1.23.0에서는 미사용
  episodeProgress: Array<unknown>;        // v1.23.0에서는 미사용
}
```

- [ ] **Step 2: typecheck 통과 확인**

```bash
npm run typecheck
```
Expected: PASS (단순 타입 추가, 사용처 없으니 에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/types/index.ts
git commit -m "v1.23.0 types: TimeUnit/CellFilter/ActivityInsightsRaw 추가"
```

---

### Task 3: 시간 범위 헬퍼 함수 + 단위 테스트

**Files:**
- Create: `src/components/widgets/activity/timeRange.ts`
- Create: `tests/timeRange.test.ts`

- [ ] **Step 1: 헬퍼 함수 작성 (KST 기준 캘린더 단위 경계)**

`src/components/widgets/activity/timeRange.ts`:

```ts
import type { TimeUnit, TimeRange } from '@/types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC Date → KST Date (시간 부분만 KST로 보정) */
function toKST(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MS);
}
function fromKST(d: Date): Date {
  return new Date(d.getTime() - KST_OFFSET_MS);
}

/** 기간 단위/idx 의 KST 경계를 UTC ISO 문자열로 반환 */
export function getRangeBoundary(unit: TimeUnit, rangeIdx: number, now: Date = new Date()): { startISO: string; endISO: string; label: string } {
  const kst = toKST(now);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-based
  const d = kst.getUTCDate();
  const dow = kst.getUTCDay(); // 0=일

  let kstStart: Date;
  let kstEnd: Date;
  let label: string;

  if (unit === 'week') {
    // 월요일 기준 주 시작 (월=1, 일=0 → 일요일은 -6)
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monKst = new Date(Date.UTC(y, m, d + diffToMon));
    kstStart = new Date(Date.UTC(monKst.getUTCFullYear(), monKst.getUTCMonth(), monKst.getUTCDate() - rangeIdx * 7));
    kstEnd = new Date(Date.UTC(kstStart.getUTCFullYear(), kstStart.getUTCMonth(), kstStart.getUTCDate() + 7));
    if (rangeIdx === 0) {
      label = `이번 주 (${kstStart.getUTCMonth() + 1}/${kstStart.getUTCDate()}–${new Date(kstEnd.getTime() - 86400000).getUTCMonth() + 1}/${new Date(kstEnd.getTime() - 86400000).getUTCDate()})`;
    } else if (rangeIdx === 1) {
      label = `지난 주 (${kstStart.getUTCMonth() + 1}/${kstStart.getUTCDate()}–${new Date(kstEnd.getTime() - 86400000).getUTCMonth() + 1}/${new Date(kstEnd.getTime() - 86400000).getUTCDate()})`;
    } else {
      label = `${rangeIdx}주 전 (${kstStart.getUTCMonth() + 1}/${kstStart.getUTCDate()}–${new Date(kstEnd.getTime() - 86400000).getUTCMonth() + 1}/${new Date(kstEnd.getTime() - 86400000).getUTCDate()})`;
    }
  } else if (unit === 'month') {
    const targetMonth = m - rangeIdx;
    kstStart = new Date(Date.UTC(y, targetMonth, 1));
    kstEnd = new Date(Date.UTC(y, targetMonth + 1, 1));
    label = rangeIdx === 0 ? `이번 달 (${kstStart.getUTCMonth() + 1}월)`
          : rangeIdx === 1 ? `지난 달 (${kstStart.getUTCMonth() + 1}월)`
          : `${kstStart.getUTCFullYear()}년 ${kstStart.getUTCMonth() + 1}월`;
  } else {
    const targetYear = y - rangeIdx;
    kstStart = new Date(Date.UTC(targetYear, 0, 1));
    kstEnd = new Date(Date.UTC(targetYear + 1, 0, 1));
    label = rangeIdx === 0 ? `올해 (${targetYear}년)`
          : rangeIdx === 1 ? `작년 (${targetYear}년)`
          : `${targetYear}년`;
  }

  return {
    startISO: fromKST(kstStart).toISOString(),
    endISO: fromKST(kstEnd).toISOString(),
    label,
  };
}

/** 단위에 따른 RPC granularity */
export function granularityFor(unit: TimeUnit): 'hour-of-day-x-dow' | 'month-x-dow' {
  if (unit === 'year') return 'month-x-dow';
  return 'hour-of-day-x-dow';
}

/** "오늘로" 버튼 레이블 */
export function todayLabelFor(unit: TimeUnit): string {
  return unit === 'week' ? '이번 주' : unit === 'month' ? '이번 달' : '올해';
}
```

- [ ] **Step 2: 단위 테스트 작성**

`tests/timeRange.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRangeBoundary, granularityFor, todayLabelFor } from '../src/components/widgets/activity/timeRange';

// 2026-05-09(토) 14:30 KST = 2026-05-09T05:30:00Z
const REF = new Date('2026-05-09T05:30:00Z');

test('week idx=0 → 이번 주(월~일) 경계', () => {
  const r = getRangeBoundary('week', 0, REF);
  // KST 월요일 = 2026-05-04
  assert.equal(r.label.startsWith('이번 주'), true);
  assert.match(r.label, /5\/4/);
});

test('week idx=1 → 지난 주', () => {
  const r = getRangeBoundary('week', 1, REF);
  assert.equal(r.label.startsWith('지난 주'), true);
});

test('month idx=0 → 이번 달', () => {
  const r = getRangeBoundary('month', 0, REF);
  assert.equal(r.label, '이번 달 (5월)');
});

test('month idx=1 → 지난 달', () => {
  const r = getRangeBoundary('month', 1, REF);
  assert.equal(r.label, '지난 달 (4월)');
});

test('year idx=0 → 올해', () => {
  const r = getRangeBoundary('year', 0, REF);
  assert.equal(r.label, '올해 (2026년)');
});

test('granularityFor', () => {
  assert.equal(granularityFor('week'), 'hour-of-day-x-dow');
  assert.equal(granularityFor('month'), 'hour-of-day-x-dow');
  assert.equal(granularityFor('year'), 'month-x-dow');
});

test('todayLabelFor', () => {
  assert.equal(todayLabelFor('week'), '이번 주');
  assert.equal(todayLabelFor('month'), '이번 달');
  assert.equal(todayLabelFor('year'), '올해');
});
```

- [ ] **Step 3: 테스트 실행**

```bash
node --test ./tests/timeRange.test.ts
```
Expected: 모든 테스트 통과 (7개).

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/widgets/activity/timeRange.ts tests/timeRange.test.ts
git commit -m "v1.23.0 timeRange: KST 캘린더 단위 경계 헬퍼 + 테스트"
```

---

### Task 4: supabaseService 래퍼 + electron supabase 함수

**Files:**
- Modify: `electron/supabase.ts` (신규 함수 2개)
- Modify: `electron/main.ts` (IPC 핸들러 2개)
- Modify: `electron/preload.ts` (electronAPI 메서드 추가)
- Modify: `src/services/supabaseService.ts` (래퍼)
- Modify: `src/types/electron.d.ts` 또는 해당 파일 (electronAPI 타입)

- [ ] **Step 1: electron/supabase.ts 에 RPC 호출 함수 2개 추가**

기존 `getActivityStats` 근처에 추가:

```ts
import type { ActivityStatRowV2, ActivityInsightsRaw } from '../src/types';

export async function getActivityStatsV2(input: {
  rangeStart: string;
  rangeEnd: string;
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
  department?: 'bg' | 'acting' | null;
  groups?: Array<'progress' | 'memo' | 'scene' | 'etc'>;
}): Promise<ActivityStatRowV2[]> {
  const { data, error } = await supabase.rpc('get_activity_stats_v2', {
    p_range_start: input.rangeStart,
    p_range_end: input.rangeEnd,
    p_granularity: input.granularity,
    p_department: input.department ?? null,
    p_groups: input.groups ?? null,
  });
  if (error) throw error;
  return (data ?? []) as ActivityStatRowV2[];
}

export async function getActivityInsights(input: {
  rangeStart: string;
  rangeEnd: string;
  department?: 'bg' | 'acting' | null;
}): Promise<ActivityInsightsRaw> {
  const { data, error } = await supabase.rpc('get_activity_insights', {
    p_range_start: input.rangeStart,
    p_range_end: input.rangeEnd,
    p_department: input.department ?? null,
  });
  if (error) throw error;
  return data as ActivityInsightsRaw;
}
```

- [ ] **Step 2: electron/main.ts 에 IPC 2개 추가**

`activity:list` 등록 부근에 추가:

```ts
ipcMain.handle('activity:stats-v2', async (_e, args) => {
  return await sbGetActivityStatsV2(args);
});
ipcMain.handle('activity:insights', async (_e, args) => {
  return await sbGetActivityInsights(args);
});
```

import 줄에 함수 추가:
```ts
import { ..., getActivityStatsV2 as sbGetActivityStatsV2, getActivityInsights as sbGetActivityInsights } from './supabase';
```

- [ ] **Step 3: electron/preload.ts 에 electronAPI 메서드 추가**

```ts
getActivityStatsV2: (args) => ipcRenderer.invoke('activity:stats-v2', args),
getActivityInsights: (args) => ipcRenderer.invoke('activity:insights', args),
```

타입 선언도 같이 (preload 파일 또는 .d.ts).

- [ ] **Step 4: src/services/supabaseService.ts 에 래퍼 추가**

```ts
import type { ActivityStatRowV2, ActivityInsightsRaw } from '@/types';

export async function getActivityStatsV2(input: {
  rangeStart: string; rangeEnd: string;
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
  department?: 'bg' | 'acting' | null;
  groups?: Array<'progress' | 'memo' | 'scene' | 'etc'>;
}): Promise<ActivityStatRowV2[]> {
  const rows = await window.electronAPI.getActivityStatsV2(input);
  return rows ?? [];
}

export async function getActivityInsights(input: {
  rangeStart: string; rangeEnd: string;
  department?: 'bg' | 'acting' | null;
}): Promise<ActivityInsightsRaw> {
  return await window.electronAPI.getActivityInsights(input);
}
```

- [ ] **Step 5: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add electron/supabase.ts electron/main.ts electron/preload.ts src/services/supabaseService.ts src/types/
git commit -m "v1.23.0 IPC: get_activity_stats_v2 + get_activity_insights 래퍼"
```

---

## Chunk 2: Widget — 라벨, 헤더, 셀 필터, 단위별 데이터 페치

위젯 본체를 새로운 헤더(시간 단위 토글 + 화살표 + 오늘 버튼 + 분석 버튼)로 교체. 셀 클릭 필터 배너. 라벨 가운데점 포맷.

### Task 5: 씬 라벨 가운데점 포맷

**Files:**
- Modify: `src/components/widgets/activity/feedNavigation.ts`
- Modify: `tests/recentActivityNavigation.test.ts` (테스트 추가)

- [ ] **Step 1: 라벨 포맷 함수 변경**

`formatActivitySceneLabel` 함수를 다음으로 교체:

```ts
/**
 * 씬 라벨을 가운데점 분리 형식으로 변환.
 * 입력: "EP02 E #15"  →  출력: "그림자국 · E · #15"
 * 에피소드 제목 없으면: "EP02 · E · #15"
 */
export function formatActivitySceneLabel(
  sceneLabel: string | null,
  episodeNumber: number | null,
  episodeTitles: Record<number, string>,
): string {
  if (!sceneLabel) return '';
  if (episodeNumber == null) return sceneLabel;

  const epPrefix = `EP${String(episodeNumber).padStart(2, '0')}`;
  const epDisplay = episodeTitles[episodeNumber] || epPrefix;

  // "EP02 E #15" → ["EP02", "E", "#15"]
  if (!sceneLabel.startsWith(epPrefix)) return sceneLabel;
  const remainder = sceneLabel.slice(epPrefix.length).trim(); // "E #15"
  if (!remainder) return epDisplay;

  // 공백으로 분리
  const parts = remainder.split(/\s+/).filter(Boolean);
  return [epDisplay, ...parts].join(' · ');
}
```

`formatActivityGroupLabel`은 그대로 유지 (에피소드 단위만 표시하므로 영향 없음).

- [ ] **Step 2: 테스트 추가**

`tests/recentActivityNavigation.test.ts` 마지막에 추가:

```ts
import { formatActivitySceneLabel } from '../src/components/widgets/activity/feedNavigation';

test('formatActivitySceneLabel: 가운데점 분리', () => {
  const titles = { 2: '그림자국' };
  assert.equal(
    formatActivitySceneLabel('EP02 E #15', 2, titles),
    '그림자국 · E · #15'
  );
});

test('formatActivitySceneLabel: 에피소드 제목 없으면 EP02 폴백', () => {
  assert.equal(
    formatActivitySceneLabel('EP02 E #15', 2, {}),
    'EP02 · E · #15'
  );
});

test('formatActivitySceneLabel: 빈 라벨', () => {
  assert.equal(formatActivitySceneLabel('', 2, {}), '');
});

test('formatActivitySceneLabel: 리비전 라벨도 분리', () => {
  // 'EP02 E #15 리비전 #3' → '그림자국 · E · #15 · 리비전 · #3'
  const titles = { 2: '그림자국' };
  assert.equal(
    formatActivitySceneLabel('EP02 E #15 리비전 #3', 2, titles),
    '그림자국 · E · #15 · 리비전 · #3'
  );
});
```

- [ ] **Step 3: 테스트 실행**

```bash
node --test ./tests/recentActivityNavigation.test.ts
```
Expected: 모든 테스트 통과.

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/widgets/activity/feedNavigation.ts tests/recentActivityNavigation.test.ts
git commit -m "v1.23.0 라벨 포맷: 가운데점(·) 분리 적용"
```

---

### Task 6: useActivityStore 확장 (timeUnit, rangeIdx, cellFilter)

**Files:**
- Modify: `src/stores/useActivityStore.ts`

- [ ] **Step 1: store 인터페이스 확장**

기존 `goldenMode`는 그대로 두되, 신규 필드 추가:

```ts
import { getRangeBoundary, granularityFor } from '@/components/widgets/activity/timeRange';
import type { TimeUnit, CellFilter } from '@/types';

const TIME_UNIT_KEY = 'bflow_activity_time_unit';

interface ActivityState {
  // ... 기존 필드 유지 ...
  timeUnit: TimeUnit;
  rangeIdx: number;
  cellFilter: CellFilter | null;

  setTimeUnit(unit: TimeUnit): void;
  setRangeIdx(idx: number): void;
  goToCurrentRange(): void;
  applyCellFilter(filter: CellFilter): void;
  clearCellFilter(): void;
}
```

- [ ] **Step 2: 초기 상태 + 액션 구현**

```ts
function loadTimeUnit(): TimeUnit {
  try {
    const v = localStorage.getItem(TIME_UNIT_KEY) as TimeUnit | null;
    if (v === 'week' || v === 'month' || v === 'year') return v;
  } catch { /* ignore */ }
  return 'week';
}

// create() 안에:
timeUnit: loadTimeUnit(),
rangeIdx: 0,
cellFilter: null,

setTimeUnit(unit) {
  try { localStorage.setItem(TIME_UNIT_KEY, unit); } catch { /* ignore */ }
  set({ timeUnit: unit, rangeIdx: 0, cellFilter: null });
  void get().loadStats();
},
setRangeIdx(idx) {
  set({ rangeIdx: Math.max(0, idx), cellFilter: null });
  void get().loadStats();
},
goToCurrentRange() {
  set({ rangeIdx: 0, cellFilter: null });
  void get().loadStats();
},
applyCellFilter(filter) {
  set({ cellFilter: filter });
},
clearCellFilter() {
  set({ cellFilter: null });
},
```

- [ ] **Step 3: loadStats 시그니처를 v2 RPC로 교체**

기존 `loadStats`를 다음으로 교체:

```ts
async loadStats() {
  try {
    const { timeUnit, rangeIdx, filters } = get();
    const department = getCurrentDepartment();
    const groups = getCurrentGroupsForServer(filters.groups);
    const { startISO, endISO } = getRangeBoundary(timeUnit, rangeIdx);
    const granularity = granularityFor(timeUnit);
    const stats = await supabaseService.getActivityStatsV2({
      rangeStart: startISO,
      rangeEnd: endISO,
      granularity,
      department,
      groups,
    });
    set({ statsGrid: buildHeatmapGridV2(stats, granularity) });
  } catch (err) {
    console.warn('[activity] stats v2 load failed:', err);
  }
},
```

`buildHeatmapGridV2`는 기존 `buildHeatmapGrid`를 확장한 형태로 `utils.ts`에 추가 (다음 step).

- [ ] **Step 4: utils.ts 에 buildHeatmapGridV2 추가**

`src/components/widgets/activity/utils.ts` 끝에:

```ts
/**
 * granularity 별로 격자 빌드.
 * - hour-of-day-x-dow: bucket1=dow(0=일), bucket2=hour. 표시용 7×24 (월=0).
 * - month-x-dow: bucket1=month(1~12), bucket2=dow. 표시용 12×7.
 */
export function buildHeatmapGridV2(
  stats: ActivityStatRowV2[],
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals',
): GroupedCount[][] {
  if (granularity === 'hour-of-day-x-dow') {
    const grid: GroupedCount[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ ...EMPTY_GROUPED_COUNT })),
    );
    for (const s of stats) {
      const displayDay = (s.bucket1 + 6) % 7; // pg dow → 표시(월=0)
      if (displayDay >= 0 && displayDay < 7 && s.bucket2 >= 0 && s.bucket2 < 24) {
        grid[displayDay][s.bucket2] = {
          total: s.total,
          progress: s.count_progress ?? 0,
          memo: s.count_memo ?? 0,
          scene: s.count_scene ?? 0,
          etc: s.count_etc ?? 0,
        };
      }
    }
    return grid;
  }
  if (granularity === 'month-x-dow') {
    const grid: GroupedCount[][] = Array.from({ length: 12 }, () =>
      Array.from({ length: 7 }, () => ({ ...EMPTY_GROUPED_COUNT })),
    );
    for (const s of stats) {
      const monthIdx = s.bucket1 - 1;
      const displayDow = (s.bucket2 + 6) % 7;
      if (monthIdx >= 0 && monthIdx < 12 && displayDow >= 0 && displayDow < 7) {
        grid[monthIdx][displayDow] = {
          total: s.total,
          progress: s.count_progress ?? 0,
          memo: s.count_memo ?? 0,
          scene: s.count_scene ?? 0,
          etc: s.count_etc ?? 0,
        };
      }
    }
    return grid;
  }
  // month-totals — 12×1
  const grid: GroupedCount[][] = Array.from({ length: 12 }, () =>
    Array.from({ length: 1 }, () => ({ ...EMPTY_GROUPED_COUNT })),
  );
  for (const s of stats) {
    const monthIdx = s.bucket1 - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      grid[monthIdx][0] = {
        total: s.total,
        progress: s.count_progress ?? 0,
        memo: s.count_memo ?? 0,
        scene: s.count_scene ?? 0,
        etc: s.count_etc ?? 0,
      };
    }
  }
  return grid;
}
```

import도 같이 추가: `import type { ActivityStatRowV2 } from '@/types';`

- [ ] **Step 5: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 6: 커밋**

```bash
git add src/stores/useActivityStore.ts src/components/widgets/activity/utils.ts
git commit -m "v1.23.0 store: timeUnit/rangeIdx/cellFilter + buildHeatmapGridV2"
```

---

### Task 7: 위젯 헤더 + 시간 토글/화살표/오늘 버튼

**Files:**
- Modify: `src/components/widgets/RecentActivityWidget.tsx`

- [ ] **Step 1: ModeToggle → TimeUnitToggle 교체 + 헤더 컴포넌트**

기존 `ModeToggle` 함수를 제거하고, 헤더에 새 구조 작성:

```tsx
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react';
import { getRangeBoundary, todayLabelFor } from './activity/timeRange';

function HeaderControls({ onOpenInsights }: { onOpenInsights: () => void }) {
  const { timeUnit, rangeIdx, setTimeUnit, setRangeIdx, goToCurrentRange } = useActivityStore();
  const { label } = useMemo(() => getRangeBoundary(timeUnit, rangeIdx), [timeUnit, rangeIdx]);
  const todayLabel = todayLabelFor(timeUnit);
  const fwdDisabled = rangeIdx === 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setRangeIdx(rangeIdx + 1)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer"
          title="이전 기간"
        >
          <ChevronLeft size={14} />
        </button>
        <div key={`${timeUnit}-${rangeIdx}`} className="text-[11px] font-medium text-text-primary min-w-[100px] text-center">
          {label}
        </div>
        <button
          onClick={() => setRangeIdx(rangeIdx - 1)}
          disabled={fwdDisabled}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/40 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          title="다음 기간"
        >
          <ChevronRight size={14} />
        </button>
        {rangeIdx > 0 && (
          <button
            onClick={goToCurrentRange}
            className="ml-1 px-1.5 py-1 rounded-md text-[10px] font-semibold text-accent-sub bg-accent/10 border border-accent/25 hover:bg-accent/18 cursor-pointer"
            title="현재 기간으로 즉시 이동"
          >
            {todayLabel}
          </button>
        )}
      </div>

      <div className="flex gap-[2px] bg-bg-border/40 p-[2px] rounded-[7px]">
        {(['week', 'month', 'year'] as const).map((u) => (
          <button
            key={u}
            onClick={() => setTimeUnit(u)}
            className={`px-2.5 py-1 rounded-[5px] text-[11px] cursor-pointer transition-all ${timeUnit === u ? 'bg-accent/22 text-accent-sub' : 'text-text-secondary hover:text-text-primary'}`}
            style={timeUnit === u ? { boxShadow: 'inset 0 0 0 1px rgba(108, 92, 231, 0.32)' } : {}}
          >
            {u === 'week' ? '주' : u === 'month' ? '달' : '년'}
          </button>
        ))}
      </div>

      <button
        onClick={onOpenInsights}
        className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-accent-sub hover:bg-accent/10 cursor-pointer transition-colors"
        title="활동 분석 보기"
      >
        <BarChart3 size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: RecentActivityWidget 본체에 HeaderControls 사용**

기존 `<Widget headerRight={<ModeToggle .../>}>` 부분을 다음으로 교체:

```tsx
const [insightsOpen, setInsightsOpen] = useState(false);

return (
  <Widget title="최근 작업" icon={<Activity size={14} />} headerRight={<HeaderControls onOpenInsights={() => setInsightsOpen(true)} />}>
    {/* ... 기존 내용 ... */}
    <ActivityInsightsModal open={insightsOpen} onClose={() => setInsightsOpen(false)} />
  </Widget>
);
```

`ActivityInsightsModal`은 Chunk 3에서 만들 거지만 미리 import 자리만 (placeholder). 임시로:

```tsx
function ActivityInsightsModal(_p: { open: boolean; onClose: () => void }) {
  // Chunk 3에서 구현
  return null;
}
```

- [ ] **Step 3: goldenMode 관련 코드 정리**

`goldenMode`는 단위 토글과 의미가 겹친다 — `heatmap`/`hour`/`day` 중 `heatmap`만 단위별로 항상 노출되도록 단순화.
- 위젯 본체에서 `<GoldenBarChart>` 분기 제거.
- 항상 `<GoldenHeatmap>` 노출.
- 단, 단위가 `year`이면 12×7 대형 히트맵 (다른 컴포넌트 또는 GoldenHeatmap 내부 mode prop).

`GoldenHeatmap` 수정 (Task 8에서 자세히).

- [ ] **Step 4: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 5: preview 동작 확인**

```bash
npm run dev  # 백그라운드
# 브라우저: 위젯 헤더 시간 토글/화살표/오늘 버튼 동작 확인
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/widgets/RecentActivityWidget.tsx
git commit -m "v1.23.0 위젯 헤더: 시간 단위 토글 + 화살표 + 오늘 버튼"
```

---

### Task 8: GoldenHeatmap 단위별 모드 + 셀 클릭 필터

**Files:**
- Modify: `src/components/widgets/activity/GoldenHeatmap.tsx`
- Modify: `src/components/widgets/RecentActivityWidget.tsx`
- Modify: `src/components/widgets/activity/ActivityFeed.tsx`

- [ ] **Step 1: GoldenHeatmap mode prop 추가 (week/month/year)**

```tsx
interface Props {
  mode: 'week-or-month' | 'year';  // week/month는 같은 모양 (7×24)
  onCellClick?: (bucket1: number, bucket2: number) => void;
  onCellHover?: (info: HeatmapCellHoverInfo | null) => void;
}
```

`mode === 'year'` 일 때 12×7 그리드 (월 라벨 + 요일 셀), 아니면 기존 7×24.

`useActivityStore` 의 `cellFilter` 를 읽어 selected 셀 강조:

```tsx
const cellFilter = useActivityStore((s) => s.cellFilter);
const isSelected = (b1: number, b2: number) =>
  cellFilter && cellFilter.bucket1 === b1 && cellFilter.bucket2 === b2;
```

- [ ] **Step 2: 셀 클릭 핸들러를 위젯에서 정의**

`RecentActivityWidget.tsx`:

```tsx
const { timeUnit, applyCellFilter, clearCellFilter, cellFilter } = useActivityStore();

const onCellClick = (b1: number, b2: number) => {
  if (cellFilter && cellFilter.bucket1 === b1 && cellFilter.bucket2 === b2) {
    clearCellFilter();
  } else {
    applyCellFilter({ bucket1: b1, bucket2: b2 });
  }
};
```

`<GoldenHeatmap>` 에 `onCellClick={onCellClick}` 전달.

- [ ] **Step 3: 셀 필터 배너 추가**

위젯의 피드 라벨 바로 위에:

```tsx
{cellFilter && (
  <CellFilterBanner
    filter={cellFilter}
    matchCount={feedMatchCount}
    onClear={clearCellFilter}
    timeUnit={timeUnit}
  />
)}
```

`CellFilterBanner` 컴포넌트는 같은 파일에 정의:

```tsx
function CellFilterBanner({ filter, matchCount, onClear, timeUnit }: {
  filter: CellFilter;
  matchCount: number;
  onClear: () => void;
  timeUnit: TimeUnit;
}) {
  const label = (() => {
    if (timeUnit === 'year') {
      const monthIdx = filter.bucket1; // 0-based
      return `${monthIdx + 1}월 ${['월','화','수','목','금','토','일'][filter.bucket2]}요일`;
    }
    const day = ['월','화','수','목','금','토','일'][filter.bucket1];
    return `${day} ${filter.bucket2}시`;
  })();

  return (
    <div className="mx-3.5 mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
         style={{ background: 'rgba(253,203,110,0.10)', border: '1px solid rgba(253,203,110,0.30)' }}>
      <div className="flex items-center gap-2 text-[11.5px]">
        <Circle size={12} fill="#FDCB6E" stroke="#FDCB6E" />
        <span className="text-text-primary"><b>{label}</b> 활동만 강조 중</span>
        <span className="text-text-secondary">
          {matchCount > 0 ? `· ${matchCount}건` : '· 이 시간대엔 활동이 없어요'}
        </span>
      </div>
      <button onClick={onClear} className="text-[11px] text-text-secondary hover:text-[#FDCB6E] cursor-pointer flex items-center gap-1 px-2 py-1 rounded hover:bg-[#FDCB6E]/10 transition-colors">
        전체 보기
        <X size={12} />
      </button>
    </div>
  );
}
```

`feedMatchCount`는 ActivityFeed에서 계산해 prop으로 끌어올리거나, 위젯에서 store activities + cellFilter로 직접 계산.

- [ ] **Step 4: ActivityFeed 에 dim/highlight 적용**

```tsx
const cellFilter = useActivityStore((s) => s.cellFilter);
const matches = (a: Activity) => {
  if (!cellFilter) return false;
  const created = new Date(a.createdAt);
  const kst = new Date(created.getTime() + 9 * 3_600_000);
  if (timeUnit === 'year') {
    return kst.getUTCMonth() === cellFilter.bucket1
      && ((kst.getUTCDay() + 6) % 7) === cellFilter.bucket2;
  }
  return ((kst.getUTCDay() + 6) % 7) === cellFilter.bucket1
    && kst.getUTCHours() === cellFilter.bucket2;
};

// row 렌더링 시:
const isMatch = matches(item);
const dimmed = cellFilter && !isMatch;
className={cn(
  // 기존 클래스
  dimmed && 'opacity-30',
  isMatch && 'bg-[#FDCB6E]/8 border-l-2 border-[#FFE5A0]',
)}
```

매칭 첫 항목에 `ref` + useEffect로 `scrollIntoView({behavior:'smooth', block:'center'})`.

- [ ] **Step 5: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 6: preview 검증**

`npm run dev`로 띄우고 셀 클릭 → 배너 노출 + dim + 스크롤.

- [ ] **Step 7: 커밋**

```bash
git add src/components/widgets/activity/GoldenHeatmap.tsx src/components/widgets/activity/ActivityFeed.tsx src/components/widgets/RecentActivityWidget.tsx
git commit -m "v1.23.0 셀 필터: 헤어맵 클릭 → 배너 + dim + 스크롤"
```

---

## Chunk 3: Insights Modal + 7 카드

분석 모달 본체 + 카드 컴포넌트 7개. RPC `get_activity_insights` 호출, 응답을 카드들에 분배.

### Task 9: ActivityInsightsModal 본체

**Files:**
- Create: `src/components/widgets/activity/ActivityInsightsModal.tsx`
- Modify: `src/stores/useActivityStore.ts` (insights state 추가)

- [ ] **Step 1: store에 insights 캐시 추가**

```ts
interface ActivityState {
  // ...
  insights: ActivityInsightsRaw | null;
  insightsLoading: boolean;
  insightsRange: 'year' | 'half' | 'quarter';
  loadInsights(range: 'year' | 'half' | 'quarter'): Promise<void>;
  setInsightsRange(range: 'year' | 'half' | 'quarter'): void;
}

// 초기값
insights: null,
insightsLoading: false,
insightsRange: 'year',

setInsightsRange(range) {
  set({ insightsRange: range });
  void get().loadInsights(range);
},

async loadInsights(range) {
  const months = range === 'year' ? 12 : range === 'half' ? 6 : 3;
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const start = new Date(now.getFullYear(), now.getMonth() - months, now.getDate()).toISOString();
  const department = getCurrentDepartment();
  set({ insightsLoading: true });
  try {
    const data = await supabaseService.getActivityInsights({ rangeStart: start, rangeEnd: end, department });
    set({ insights: data, insightsLoading: false });
  } catch (err) {
    console.warn('[activity] insights load failed:', err);
    set({ insightsLoading: false });
  }
},
```

- [ ] **Step 2: ActivityInsightsModal 컴포넌트 골격**

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useActivityStore } from '@/stores/useActivityStore';
import { MonthDowHeatmapCard } from './cards/MonthDowHeatmapCard';
import { StageBreakdownCard } from './cards/StageBreakdownCard';
import { UserBreakdownCard } from './cards/UserBreakdownCard';
import { TopScenesCard } from './cards/TopScenesCard';
import { WeeklyCompletedCard } from './cards/WeeklyCompletedCard';
import { SceneFlowCard } from './cards/SceneFlowCard';
import { EpisodeProgressCard } from './cards/EpisodeProgressCard';

export function ActivityInsightsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { insights, insightsLoading, insightsRange, loadInsights, setInsightsRange } = useActivityStore();

  useEffect(() => {
    if (open && !insights) loadInsights(insightsRange);
  }, [open, insights, insightsRange, loadInsights]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-[1080px] max-h-[88vh] overflow-hidden rounded-2xl border border-bg-border bg-bg-card/95 shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-7 py-5 border-b border-bg-border/60 flex items-start justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">Activity Insights</p>
            <h2 className="text-xl font-bold tracking-tight mt-1.5">활동 분석</h2>
            <p className="text-sm text-text-secondary mt-1">최근 1년치 활동 데이터로 본 팀 작업 패턴.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={insightsRange}
              onChange={(e) => setInsightsRange(e.target.value as 'year' | 'half' | 'quarter')}
              className="bg-bg-border/40 border border-bg-border rounded-lg px-3 py-2 text-[12px] text-text-primary cursor-pointer"
            >
              <option value="year">최근 1년</option>
              <option value="half">최근 6개월</option>
              <option value="quarter">최근 3개월</option>
            </select>
            <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/50">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="p-7 overflow-y-auto">
          {insightsLoading && !insights && (
            <div className="text-center text-text-secondary py-12">불러오는 중...</div>
          )}
          {insights && (
            <div className="space-y-5">
              <MonthDowHeatmapCard data={insights.monthDowGrid} />
              <div className="grid grid-cols-2 gap-5">
                <SceneFlowCard data={insights.sceneFlow} />
                <UserBreakdownCard breakdown={insights.userBreakdown} total={insights.userBreakdownTotal} />
                <StageBreakdownCard data={insights.stageBreakdown} />
                <EpisodeProgressCard data={insights.episodeProgress} />
                <TopScenesCard scenes={insights.topScenes} />
              </div>
              <WeeklyCompletedCard data={insights.weeklyCompleted} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck (카드 컴포넌트는 다음 task에 만들 거니 임시 stub)**

7개 카드 파일을 임시로 stub만 만들어 import 에러 방지:

`src/components/widgets/activity/cards/MonthDowHeatmapCard.tsx`:
```tsx
export function MonthDowHeatmapCard(_p: { data: any }) { return <div className="insight-card">MonthDowHeatmapCard (TODO)</div>; }
```
(나머지 6개도 동일한 stub 형태)

- [ ] **Step 4: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 5: 위젯에 모달 연결 (Task 7의 placeholder 대체)**

`RecentActivityWidget.tsx`에서:
```tsx
import { ActivityInsightsModal } from './activity/ActivityInsightsModal';
```
(기존 placeholder 함수 제거)

- [ ] **Step 6: 커밋**

```bash
git add src/components/widgets/activity/ActivityInsightsModal.tsx src/components/widgets/activity/cards/ src/stores/useActivityStore.ts
git commit -m "v1.23.0 분석 모달: 모달 본체 + 7개 카드 stub + insights store"
```

---

### Task 10: 카드 7개 본 구현

**Files:**
- Modify: `src/components/widgets/activity/cards/*.tsx` (각 카드)

각 카드는 한 step씩. 시안 HTML(`preview.html`)을 React로 옮긴다고 보면 됨.

- [ ] **Step 1: MonthDowHeatmapCard (12개월 × 7요일)**

`src/components/widgets/activity/cards/MonthDowHeatmapCard.tsx` 본 구현.
시안 HTML buildAnalysisHTML의 첫 카드 부분을 React로 옮김.
강도 5단계 (intensityLevel/intensityBg 재사용).
하단 자동 인사이트 텍스트는 데이터에서 max month/dow 계산.

- [ ] **Step 2: SceneFlowCard (씬→완료 흐름)**

`SceneFlowCard.tsx`. v1.23.0 RPC에서는 빈 객체로 옴 (sceneFlow 미구현).
데이터가 비면 placeholder ("이 인사이트는 v1.24에 추가됩니다") 또는 임시 더미값으로 표시.
한솔 결정: 임시 더미값으로 표시 (바·라벨 구조는 시안과 동일).

- [ ] **Step 3: UserBreakdownCard (담당자별 비중)**

상위 5명 + "기타 X명" 자동 계산 (total - sum(top5)).
가로 막대 + 건수.

- [ ] **Step 4: StageBreakdownCard (도넛 + 범례)**

SVG 도넛 직접 그리기 (시안 HTML과 동일한 stroke-dasharray 계산).

- [ ] **Step 5: EpisodeProgressCard (에피소드별 완성도)**

v1.23.0 RPC에서는 빈 배열 → useDataStore의 episodes로 직접 계산 (PNG 단계까지 도달한 씬 비율).

- [ ] **Step 6: TopScenesCard (씬 Top 10)**

`scene-chip` 형태로 라벨 표시 (Task 5의 formatActivitySceneLabel 활용).
상위 2개 빨강 강조 조건: total >= avg * 2.

- [ ] **Step 7: WeeklyCompletedCard (주별 완료 트렌드)**

12주 막대 + 4주 평균선.
이번 주는 노란 강조.

- [ ] **Step 8: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 9: preview 검증 (분석 버튼 → 모달 → 7카드)**

- [ ] **Step 10: 커밋**

```bash
git add src/components/widgets/activity/cards/
git commit -m "v1.23.0 분석 카드 7종 본 구현 (히트맵/씬흐름/담당자/도넛/EP/Top10/주별)"
```

---

## Chunk 4: Polish — 자간 미리보기, 업데이트 모달, 버전 호버

### Task 11: 자간/줄간격 미리보기 박스 + 기본값 마커

**Files:**
- Modify: `src/components/settings/SpacingSection.tsx`

- [ ] **Step 1: 슬라이더에 기본값 마커 + 미리보기 박스 추가**

기존 슬라이더 wrap을 `relative`로, 마커 div + 라벨 추가.
슬라이더 두 개 아래에 미리보기 영역:

```tsx
<div className="pt-4">
  <div className="text-[10.5px] uppercase tracking-wider text-text-secondary/60 mb-1.5">미리보기</div>
  <div
    className="rounded-[10px] px-4 py-3.5 text-[13px] text-text-primary border border-dashed border-bg-border/70 bg-bg-primary/50"
    style={{ lineHeight, letterSpacing: `${letterSpacing}em`, transition: 'line-height 0.15s ease, letter-spacing 0.15s ease' }}
  >
    EP02 그림자국 · E파트 #15 메모 ─ 캐릭터 시선이 카메라를 따라가야 합니다.
    배경 라인 정리 후 LO 단계에서 한 번 더 컬러 체크 부탁드려요. 액팅 쪽
    민수 담당이라 슬랙으로 따로 한 번 말씀드릴게요. 컷 길이가 짧아서 키 5장
    정도면 충분할 것 같고, 마지막에 fade-out 처리는 컴프 단계에서 같이
    잡으면 좋겠습니다. 기본값(줄간격 1.55, 자간 0)은 한글 가독성 테스트
    결과 가장 균형이 좋았습니다 — 길게 적는 메모/리비전 노트에서 효과가
    가장 큽니다.
  </div>
  <p className="mt-2 text-[10.5px] text-text-secondary/60">
    조정 즉시 위 단락의 줄간격과 자간이 바뀝니다. 만족스러운 값을 찾으면 다른 창에도 동기화됩니다.
  </p>
</div>
```

기본값 마커 위치 계산:
- 줄간격: `(1.55 - 1.2) / (2.0 - 1.2) = 0.4375` → `left: 43.75%`
- 자간: `(0 - (-0.05)) / (0.10 - (-0.05)) = 0.3333` → `left: 33.33%`

```tsx
<div className="flex-1 relative">
  <input ... />
  <div className="absolute top-[14px] w-px h-2 bg-accent-sub/60 pointer-events-none" style={{ left: '43.75%' }} />
  <div className="absolute top-[18px] -translate-x-1/2 text-[9px] text-accent-sub/70 pointer-events-none" style={{ left: '43.75%' }}>기본 1.55</div>
</div>
```

(자간도 동일 패턴, left=33.33%, "기본 0")

- [ ] **Step 2: 기존 안내 문구는 미리보기 박스 아래로 이동/통합**

기존 `긴 메모·댓글·씬 설명…` 줄은 제거 또는 미리보기 박스 아래로 흡수.

- [ ] **Step 3: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 4: preview 검증 (설정 → 간격)**

- [ ] **Step 5: 커밋**

```bash
git add src/components/settings/SpacingSection.tsx
git commit -m "v1.23.0 자간 설정: 기본값 마커 + 장문 미리보기 단락"
```

---

### Task 12: 업데이트 모달 PR 타임라인 + 86vh 고정

**Files:**
- Modify: `src/components/update/UpdateCenterModal.tsx`

- [ ] **Step 1: 모달 외곽 height 86vh 고정 + flex-col 구조**

기존 modalRef div의 className을 다음으로 변경:

```tsx
className="w-full max-w-[760px] flex flex-col overflow-hidden rounded-2xl border border-bg-border bg-bg-card/95 shadow-2xl shadow-black/40"
style={{ height: '86vh' }}
```

내부 영역 분할:
- 헤더 (shrink-0)
- 카드 2개 (shrink-0)
- 타임라인 타이틀 (shrink-0)
- 타임라인 본체 (flex-1 overflow-y-auto)

- [ ] **Step 2: 카드 영역 그대로 유지하되 grid grid-cols-2 wrapper 정리**

기존 카드 2개 영역 그대로 유지 — 변경 없음. 다만 부모를 `shrink-0`로 명시.

- [ ] **Step 3: 타임라인 컴포넌트 추가**

기존 release notes 카드 리스트를 다음으로 교체 (시안 HTML의 buildTimelineHTML 참고):

```tsx
<div className="px-6 pt-2 pb-3 shrink-0 flex items-center justify-between border-t border-bg-border/40">
  <div>
    <p className="text-sm font-semibold text-text-primary">버전별 업데이트 내역</p>
    <p className="text-[11px] text-text-secondary">PR 타임라인 형태로 누적 표시</p>
  </div>
  {hiddenReleaseNoteCount > 0 && (
    <button onClick={() => setShowAllReleaseNotes((v) => !v)} className="...">
      {showAllReleaseNotes ? '이전 버전 접기' : `이전 버전 ${hiddenReleaseNoteCount}개 더 보기`}
    </button>
  )}
</div>

<div className="flex-1 overflow-y-auto px-6 pb-6">
  <div className="relative pl-9 pt-2" style={{ /* pr-rail::before 대체 inline */ }}>
    <div className="absolute left-[11px] top-2 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, rgba(108,92,231,0.38), rgba(108,92,231,0.06) 92%)' }} />
    {visibleNotes.map((note, idx) => {
      const isLatest = note.version === displayInfo.latestVersion && hasRemoteUpdate;
      return (
        <div key={`${note.version}-${idx}`} className="relative pb-6">
          <div className={`absolute left-0 w-6 h-6 rounded-full flex items-center justify-center ${isLatest ? 'bg-gradient-to-br from-accent-sub to-accent border-2 border-white/18 shadow-[0_0_0_4px_rgba(162,155,254,0.18),0_0_18px_rgba(108,92,231,0.4)]' : 'bg-bg-card border-2 border-accent-sub/60 shadow-[0_0_0_4px_rgba(108,92,231,0.10)]'}`}>
            {isLatest ? <Check size={11} className="text-white" /> : <span className="text-[10px] text-accent-sub mono">{notes.length - idx}</span>}
          </div>
          <div className={`rounded-2xl border p-4 ${isLatest ? 'border-accent/32 bg-accent/6' : 'border-bg-border/60 bg-bg-primary/40'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">{note.title || `v${note.version}`}</span>
                {isLatest && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-sub/20 text-accent-sub font-semibold">LATEST</span>}
              </div>
              <span className="mono text-[11px] px-2 py-0.5 rounded-full border border-bg-border text-text-secondary">v{note.version}</span>
            </div>
            <ul className="mt-3 space-y-1.5">
              {note.items.map((it, j) => (
                <li key={`${it}-${j}`} className="flex gap-2 text-[12.5px] leading-relaxed text-text-secondary">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-sub/70" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    })}
  </div>
</div>
```

- [ ] **Step 4: 새로고침 동작 — 외형 안 흔들리는지 확인**

기존 새로고침 로직 유지. `frozenUpdateInfoRef` 패턴은 그대로 유지하여 새로고침 중 표시 유지.
모달 height 86vh 고정 + 타임라인 영역만 스크롤이라 외형은 새로고침 응답에 영향 안 받음.

- [ ] **Step 5: typecheck + 빌드 + 자동 업데이트 테스트**

```bash
npm run typecheck && npm run build:vite && npm run test:auto-update
```

- [ ] **Step 6: 커밋**

```bash
git add src/components/update/UpdateCenterModal.tsx
git commit -m "v1.23.0 업데이트 모달: PR 타임라인 + 86vh 높이 고정"
```

---

### Task 13: 버전 버튼 floating 호버 툴팁

**Files:**
- Create: `src/components/layout/VersionHoverTip.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: VersionHoverTip 컴포넌트 작성**

```tsx
interface Props {
  show: boolean;
  state: 'latest' | 'available' | 'failed' | 'suppressed' | 'checking';
  currentVersion: string;
  latestVersion: string;
  buildAt?: string;
  message?: string;
}

export function VersionHoverTip({ show, state, currentVersion, latestVersion, buildAt, message }: Props) {
  const labelKey = state === 'latest' ? '최신 상태'
                : state === 'available' ? `새 버전 v${latestVersion} 준비됨`
                : state === 'failed' ? '업데이트 실패'
                : state === 'suppressed' ? '자동 업데이트 중단됨'
                : '확인 중';
  const tone = state === 'available' ? 'text-accent-sub'
             : (state === 'failed' || state === 'suppressed') ? 'text-[#FDCB6E]'
             : 'text-text-secondary';

  return (
    <div
      className={`absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 bg-bg-card/97 border border-bg-border/85 rounded-[10px] px-3.5 py-2.5 min-w-[240px] max-w-[300px] shadow-[0_18px_40px_rgba(0,0,0,0.45)] text-[12px] text-text-primary z-30 transition-opacity duration-150 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ /* 좌측 보더 화살표 */ }}
    >
      {/* 좌측 화살표 (CSS pseudo 대신 inline div) */}
      <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0" style={{ borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderRight: '8px solid rgba(45,48,65,0.85)' }} />

      <div className={`text-[10.5px] uppercase tracking-[0.14em] mb-1 font-semibold ${tone}`}>{labelKey}</div>
      {message && <div className="text-[12.5px] text-text-primary mb-2 leading-relaxed">{message}</div>}
      <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
        <span>현재 버전</span><b className="text-text-primary mono">v{currentVersion}</b>
      </div>
      {state !== 'latest' && (
        <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
          <span>{state === 'available' ? '준비된 버전' : '대상 버전'}</span>
          <b className={`mono ${state === 'available' ? 'text-accent-sub' : ''}`}>v{latestVersion}</b>
        </div>
      )}
      {buildAt && (
        <div className="flex justify-between gap-2 text-[11.5px] text-text-secondary">
          <span>빌드 시각</span><b className="text-text-primary">{buildAt}</b>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sidebar.tsx 에서 title 제거 + VersionHoverTip 부착**

기존 `<button title={versionButtonTitle}>` 에서 `title` 속성 제거.
부모 `<span>`에 `relative` 추가, 자식으로 `<VersionHoverTip>` 추가.

```tsx
const [tipShow, setTipShow] = useState(false);
const tipTimer = useRef<ReturnType<typeof setTimeout>>();

const onMouseEnter = () => {
  clearTimeout(tipTimer.current);
  tipTimer.current = setTimeout(() => setTipShow(true), 250);
};
const onMouseLeave = () => {
  clearTimeout(tipTimer.current);
  setTipShow(false);
};

const tipState = !updateInfo ? 'checking'
                : hasRemoteUpdate ? 'available'
                : updateInfo.status === 'failed' ? 'failed'
                : updateInfo.status === 'suppressed' ? 'suppressed'
                : 'latest';

// version-pill 부모 <span> 또는 <div> 에 relative 추가, onMouseEnter/Leave 부착
<span className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
  <button onClick={() => setUpdateCenterOpen(true)} className="...">v{__APP_VERSION__}</button>
  <VersionHoverTip
    show={tipShow}
    state={tipState}
    currentVersion={__APP_VERSION__}
    latestVersion={updateInfo?.latestVersion ?? __APP_VERSION__}
    buildAt={updateInfo?.buildAt ? formatBuildTime(updateInfo.buildAt) : undefined}
    message={updateInfo?.message}
  />
</span>
```

- [ ] **Step 3: typecheck + 빌드**

```bash
npm run typecheck && npm run build:vite
```

- [ ] **Step 4: preview 검증 (좌하단 호버)**

- [ ] **Step 5: 커밋**

```bash
git add src/components/layout/VersionHoverTip.tsx src/components/layout/Sidebar.tsx
git commit -m "v1.23.0 버전 호버: 사이드바 우측 floating 툴팁 (title 속성 제거)"
```

---

## Chunk 5: Build & Release

### Task 14: 버전 bump + update-notes + 최종 빌드 검증

**Files:**
- Modify: `package.json` (version: 1.22.20 → 1.23.0)
- Modify: `DEVLOG/update-notes.json` (v1.23.0 항목 추가)

- [ ] **Step 1: package.json version bump**

`"version": "1.22.20"` → `"version": "1.23.0"`

- [ ] **Step 2: update-notes.json 에 v1.23.0 추가**

```json
{
  "version": "1.23.0",
  "title": "활동 위젯 시간 단위 + 분석 모달 추가",
  "items": [
    "최근 작업 위젯에 7일/한달/1년 단위 토글 + 좌우 화살표 + 오늘 버튼",
    "히트맵 셀 클릭 시 피드 자동 스크롤 + 하이라이트 + 다른 행 흐림 처리",
    "활동 분석 모달 신설 — 1년치 인사이트 카드 7종 (요일×월 종합 / 씬→완료 / 담당자별 / 단계별 / 에피소드별 / 씬 Top 10 / 주별 트렌드)",
    "씬 라벨 포맷 정리 (EP02 E #15 → 그림자국 · E · #15)",
    "자간/줄간격 설정에 장문 미리보기 단락 + 기본값 마커",
    "업데이트 모달을 GitHub PR 타임라인 스타일로 개편 + 새로고침 시 외형 안정",
    "버전 버튼 호버 시 사이드바 우측 floating 툴팁 (브라우저 기본 title 대체)"
  ]
}
```

배열 맨 앞에 추가 (최신순).

- [ ] **Step 3: 전체 빌드 + 자동 업데이트 테스트**

```bash
npm run typecheck && npm run build:vite && npm run test:auto-update
```
Expected: 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add package.json DEVLOG/update-notes.json
git commit -m "v1.23.0 release: 버전 bump + update-notes 추가"
```

---

### Task 15: 코드 리뷰 (서브에이전트)

- [ ] **Step 1: feature-dev:code-reviewer 또는 superpowers:code-reviewer 서브에이전트 dispatch**

브랜치 전체 변경에 대해 리뷰 요청. 리뷰 결과의 P1 이슈만 수정.

- [ ] **Step 2: P1 이슈 수정 후 추가 커밋**

이슈가 있으면 `v1.23.0 리뷰 반영: <항목>` 커밋.

---

### Task 16: PR 생성 + Codex 리뷰 루프

- [ ] **Step 1: 푸시**

```bash
git push -u origin claude/gallant-galileo-b043f3
```

- [ ] **Step 2: pr-creator 스킬로 PR 생성**

체계적인 PR 본문 (업데이트 로그 + 상세 기술 설명 + 개발 난항 + 테스트 가이드).

- [ ] **Step 3: codex-review-loop 스킬로 자동 리뷰 루프**

`@codex review` 트리거 → 응답 폴링 → P1/P2 이슈 수정 → 재트리거 → silent까지 반복.

---

### Task 17: 머지 + 빌드 + G드라이브 배포

- [ ] **Step 1: PR 머지 (한솔이 명시한 "쭉 해" + "배포" 요청에 포함)**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 2: main 체크아웃 + pull**

```bash
git checkout main && git pull
```

- [ ] **Step 3: SQL 마이그레이션 안내**

한솔에게 Supabase SQL editor에서 `DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql` 적용 안내 (DB 변경은 자동 못 함).

- [ ] **Step 4: npm run build (정식 NSIS 빌드)**

```bash
npm run build
```
Expected: `dist/`, `dist-electron/`, `BFLOW-Setup.exe`, `manifest.json` 생성.

- [ ] **Step 5: G드라이브 동기화**

CLAUDE.md "자동 업데이트 배포 원칙": 빌드 파일 먼저, manifest는 마지막.

```bash
robocopy "C:\Bflow-BGonly\dist-electron\BFLOW-Setup.exe" "G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\" /Z
# (다른 빌드 산출물도 동기화 — 한솔 워크플로우에 따라)
# 마지막에 manifest.json 동기화
robocopy ... manifest.json
```

(정확한 robocopy 명령은 한솔 워크플로우 확인 후 실행)

- [ ] **Step 6: 한솔에게 배포 완료 알림 + 마이그레이션 안내**

---

## 진행 보고 정책

한솔의 "긴 작업 진척 보고" 패턴: 30분+ 작업은 청크별 진척 + 누적/잔여 시간 명시.

각 청크 완료 시:
- "Chunk N 완료: <요약>. 누적 X분, 잔여 Y분 예상"

청크별 예상 시간:
- Chunk 1 (Foundation): 25분
- Chunk 2 (Widget): 40분
- Chunk 3 (Insights Modal): 50분
- Chunk 4 (Polish): 30분
- Chunk 5 (Release): 20분 + (PR/리뷰 루프 가변)

총 예상: 코드 작성 ~165분 + 리뷰 루프 + 배포 = 3~4시간.

---

*계획서 끝. subagent-driven-development 스킬로 단계별 실행 가능.*
