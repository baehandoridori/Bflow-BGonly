# 최근 작업 위젯 — 활동 피드 + 골든타임 분석

- 작성일: 2026-04-27
- 브랜치: `claude/trusting-blackwell-722ea1`
- 대상 범위: 신규 위젯 1개 + 신규 테이블/RPC + 12개 mutation 함수에 활동 기록 호출 추가
- PR 단위: **단일 PR** (Phase 9-7 또는 v1.14.0)
- 시안 미리보기: `docs/superpowers/specs/mockups/2026-04-27-recent-activity-widget/final.html`
- 참고: Supabase Pro 플랜 기준 (2026-04-22 업그레이드 완료)

---

## 1. 배경 & 목적

Studio JBBJ 팀이 BG/액팅 작업을 하면서 "**다른 동료들이 지금 뭘 하고 있는지**"를 자연스럽게 인지할 수단이 부족하다. 슬랙처럼 앱을 항상 띄워두는 사용 패턴이지만, 정작 진행률 카드·차트만으로는 "지영이 방금 무슨 씬을 끝냈고, 민수가 어떤 댓글을 남겼는지" 같은 **사회적 인지(social presence)** 가 약하다.

또한 한솔(매니저)은 "팀이 언제 가장 활발한지"를 데이터로 알고 싶어 한다. 회의 시간대 회피, 집중 시간 보호 결정에 활용하기 위함.

### 핵심 사용자 시나리오

1. **모두가 보는 소셜 피드** — 누가 LO를 끝냈고 누가 메모를 달았는지 시간 역순으로 흐름 확인. 동기부여·협업 촉진.
2. **팀 골든타임 분석** — 1주일 단위로 가장 활발한 시간대를 시각화. 회의·집중 시간 결정에 참고.
3. **본인 활동 회고 (이차적)** — 본인 활동도 같이 보임. 피드에서 본인 항목은 좌측 보더로 약하게 강조.

---

## 2. 결정한 디자인 (요약)

| 결정 | 값 | 근거 |
|---|---|---|
| 용도 | 팀 소셜 피드 | 한솔 결정 (다른 옵션: 매니저 모니터링/본인 회고/통합) |
| 레이아웃 | 옵션 1 — 상하 분할 (히트맵 위 / 피드 아래) | 4가지 시안 비교 후 선택 |
| 추적 종류 | **13종** | 작업 4 + 메모/댓글/리비전 4 + 씬 add/del 2 + 기타 4 |
| 출시 방식 | **깨끗하게 시작** (백필 없음) | DB 변경 최소, 출시 후 자동 누적 |
| 데이터 경로 | **앱 INSERT + RPC 트랜잭션** | 디버깅 용이, 표시 라벨 같이 저장 |
| 그래프 모드 | **3가지 토글** (히트맵 / 시간대 막대 / 요일 막대) | 한솔 보강 요청 |
| 필터 | **4그룹 칩** (작업 진행 / 메모·댓글 / 씬 생성·삭제 / 기타) | 한솔 명시 분류 |
| 그룹화 | 같은 사람 + 같은 종류 + 같은 씬 + **5분 윈도우** | 자잘한 토글 묶기 |
| 본인 강조 | 좌측 보더 + "(나)" 라벨 | 사회적 인지 / 자기 식별 |
| 보존 정책 | **1년 자동 정리** (cron) | DB ~100MB/년 안정, 무료 플랜 5년 안전 |
| 모니터링 | 설정 화면에 "활동 N건 · X MB" 한 줄 | 한솔 직접 상태 확인 |
| Realtime | INSERT 즉시 prepend + UUID dedupe | 기존 broadcast.ts 패턴 |
| 클릭 동작 | 항목 클릭 → 씬 상세 모달 (`UnifiedSceneDetailModal`) | 자연스러운 흐름 |

---

## 3. 데이터 모델

### 3.1 신규 테이블: `activity_log`

```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id TEXT NOT NULL,                -- 누가
  user_name TEXT NOT NULL,              -- 표시용 (조인 비용 ↓, 이름 변경되어도 옛 기록은 옛 이름)
  action_type TEXT NOT NULL,            -- 13종 enum (아래 §3.2)
  action_group TEXT NOT NULL,           -- 'progress' | 'memo' | 'scene' | 'etc' (필터 4그룹)

  scene_id UUID,                        -- 어떤 씬 (nullable: 씬 외 활동도 가능 — 향후 확장)
  scene_label TEXT,                     -- 표시용: "EP01 A씬 #5"
  episode_number INTEGER,               -- 통계/필터용
  department TEXT,                      -- 'bg' | 'acting'

  detail JSONB,                         -- 자유 메타 (예: { from: false, to: true })
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created  ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user     ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_scene    ON activity_log(scene_id);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON activity_log FOR ALL USING (true) WITH CHECK (true);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
```

### 3.2 13종 `action_type` enum

| 그룹 | type 값 | 발생 시점 | 픽토그램 컬러 |
|---|---|---|---|
| **progress** | `stage_lo`         | LO 체크박스 ON/OFF | LO `#74B9FF` |
| **progress** | `stage_done`       | 완료 체크박스 ON/OFF | 완료 `#A29BFE` |
| **progress** | `stage_review`     | 검수 체크박스 ON/OFF | 검수 `#FDCB6E` |
| **progress** | `stage_png`        | PNG 체크박스 ON/OFF | PNG `#00B894` |
| **memo** | `memo_update`      | 씬 메모 변경 | 분홍 `#FF8FA3` |
| **memo** | `comment_add`      | 댓글 작성 | 주황 `#FFA94D` |
| **memo** | `revision_add`     | 리비전 등록 | 시안 `#4DD0E1` |
| **memo** | `revision_resolve` | 리비전 해결 | 시안-밝음 `#81ECEC` |
| **scene** | `scene_add`        | 씬 추가 | 초록 `#6FCF97` |
| **scene** | `scene_delete`     | 씬 삭제 | 빨강 `#FF7675` |
| **etc** | `assignee_change`  | 담당자 변경 | 회색 `#95A5A6` |
| **etc** | `layout_change`    | 레이아웃ID 변경 | 회색 |
| **etc** | `image_upload_storyboard` / `image_upload_guide` | 이미지 업로드 | 회색 |

### 3.3 보존 정책 — 1년 자동 정리

```sql
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM activity_log WHERE created_at < now() - INTERVAL '1 year';
END;
$$;

-- pg_cron 사용 (Supabase Pro 활성화됨)
SELECT cron.schedule(
  'activity-log-cleanup',
  '0 4 * * *',                          -- 매일 새벽 4시
  $$ SELECT cleanup_old_activity_logs(); $$
);
```

---

## 4. 기록 경로 — 앱 INSERT + RPC 트랜잭션

### 4.1 공통 RPC 함수

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

GRANT EXECUTE ON FUNCTION record_activity(...) TO anon, authenticated;
```

### 4.2 mutation 함수 패치 — `electron/supabase.ts`

다음 12개 함수 끝에 `recordActivity()` 호출 추가 (try/catch로 감싸서 본 mutation은 실패시키지 않음):

| 함수 | action_type |
|---|---|
| `updateSceneField(stage='lo')` | `stage_lo` |
| `updateSceneField(stage='done')` | `stage_done` |
| `updateSceneField(stage='review')` | `stage_review` |
| `updateSceneField(stage='png')` | `stage_png` |
| `updateSceneField(field='memo')` | `memo_update` |
| `updateSceneField(field='assignee')` | `assignee_change` |
| `updateSceneField(field='layout')` | `layout_change` |
| `addScene` | `scene_add` |
| `deleteScene` | `scene_delete` |
| `addComment` | `comment_add` |
| `addRevision` | `revision_add` |
| `updateRevisionStatus(='resolved')` | `revision_resolve` |
| `uploadImage(type='storyboard')` | `image_upload_storyboard` |
| `uploadImage(type='guide')` | `image_upload_guide` |

bulk RPC 함수(`bulk_update_scene_stages` 등) 안에서도 각 row 단위로 활동을 INSERT하도록 수정 (트리거 없이 RPC 내부에서 처리).

### 4.3 자기 변경 dedupe

낙관적 prepend의 임시 ID(`tmp_*`)를 RPC 응답의 진짜 UUID로 교체. Realtime 이벤트가 같은 UUID면 store에서 무시.

---

## 5. UI 구조 — 위젯 본체

### 5.1 메타데이터

| 항목 | 값 |
|---|---|
| widget id | `recent-activity` |
| 타이틀 | "최근 작업" |
| 아이콘 | Lucide `Activity` |
| 그리드 디폴트 | width 6 / height 8 |
| 등록 위치 | `Dashboard.tsx`의 위젯 배열 + `WIDGET_NAMES` 상수 |
| 부서 모드 | BG/액팅/통합 모두 동일 (department 컬럼 필터) |

### 5.2 헤더

기존 위젯 글래스 헤더 패턴 + 추가 도구:

- **모드 토글 3개** (히트맵 / 시간대 / 요일) — 우측 정렬, 작은 사이즈, 토글 시 `localStorage` 저장
- **필터 버튼** (`Filter` 아이콘) — 클릭 시 13종 개별 토글 드롭다운 (선택)
- **팝아웃 버튼** (기존 패턴)

### 5.3 인사이트 배너

히트맵/그래프 바로 위에 액센트 컬러 배너 1줄. 모드별 자동 산출 문구:

- 히트맵: `"이번 주 가장 활발: {요일} {N}–{N+2}시 ({합계}건)"` — 연속 2시간 합 최대 슬롯
- 시간대 막대: `"하루 중 정점: 오후 {N}–{N+2}시 ({비율}%)"` — 24시간 합산 후 정점 슬롯
- 요일 막대: `"주중 정점: {요일} (전체의 {비율}%)"` — 7일 합산 후 정점 요일

데이터 < 20건이면 **"기록을 모으는 중입니다"** 폴백.

### 5.4 골든타임 시각화

#### 히트맵 (24×7 격자)

- 가로 24시간 / 세로 7요일
- 5단계 색 강도: `0건(회색 6%) → 1–2건(18%) → 3–5건(36%) → 6–10건(58%) → 11+건(85% + glow)`
- 시간 라벨은 `0 / 6 / 12 / 18` 4개만
- 셀 호버 시 툴팁: `"{요일} {시}시 · {건수}건 / 작업 X · 메모 Y · 씬 Z · 기타 W"` (그룹별 분포)

#### 시간대 막대 (0–23시)

- 24개 막대, 요일 합산
- 액센트 그라데이션 (`#6C5CE7` → `#A29BFE`)
- 호버 시 굵기 변화 + 툴팁 `"{시}시 · {건수}건"`

#### 요일 막대 (월–일)

- 7개 막대, 시간 합산
- 정점 요일은 노란색 그라데이션 (`#FDCB6E` → `#FFE5A0`)
- 호버 시 툴팁 `"{요일}요일 · {건수}건"`

### 5.5 4그룹 필터 칩

```
[ 전체 N ] [ ● 작업 진행 N ] [ ● 메모/댓글 N ] [ ● 씬 생성/삭제 N ] [ ● 기타 N ]
```

- 칩 클릭 → 토글 (active: 액센트 보더, 비활성: 흐림)
- 활성 그룹의 합계가 칩 옆에 숫자로 표시
- 필터는 **클라이언트 사이드** (피드와 히트맵 모두 같이 갱신)
- 필터 상태는 `localStorage`에 저장
- "전체"는 모든 그룹 ON 상태일 때 강조

### 5.6 활동 피드

#### 단일 항목

```
[아바타] 한솔 [✓ 픽토] LO 완료 [씬 칩 EP01 A씬 #5]
        2분 전
```

#### 그룹화 항목 (5분 윈도우)

같은 사람 + 같은 action_type + 같은 episode_number + 5분 이내 → 1그룹

```
[아바타] 한솔 [✓ 픽토] LO 완료 [씬 칩 EP01 A씬] · 5건       [▸]
        방금 · 5분 내 묶음
```

클릭 시 펼침 (Framer Motion `height auto`):

```
        ✓ LO 완료 · EP01 A씬 #5    · 방금
        ✓ LO 완료 · EP01 A씬 #6    · 1분 전
        ...
```

#### 본인 활동 강조

- `border-left: 2px solid var(--accent-sub)` (#A29BFE)
- 이름 옆 "(나)" 라벨 (작은 회색 텍스트, 액센트 컬러)
- 배경 약간 어두움 (`rgba(108, 92, 231, 0.04)`)

#### 시간 표시

- 상대 시간: `"방금" / "N분 전" / "N시간 전"` (24시간 미만)
- 절대 시간: `"어제 14:32" / "3일 전 10:15"` (24시간 이상)

#### 클릭 액션

- 그룹 헤더 클릭 → 펼침/접기
- 단일 항목 클릭 → `UnifiedSceneDetailModal` 열기 (씬 ID 전달)
- 씬이 삭제됐으면 토스트 `"이 씬은 삭제되었습니다"` 후 모달 안 열림

#### 무한 스크롤

- 스크롤 끝 도달 시 다음 50건 로드
- 최대 7일치 또는 최대 500건 (메모리 한도)
- 이상 시 `hasMore: false` + "이전 활동 보기" 버튼 (선택, v2)

### 5.7 상태별 표현

| 상태 | 모습 |
|---|---|
| 로딩 (초기) | 히트맵·피드 영역에 skeleton (회색 펄스) |
| 빈 상태 | "아직 활동 기록이 없습니다 · 첫 변경이 발생하면 여기에 표시됩니다" + 스파클 아이콘 |
| 오프라인 | 헤더에 작은 점 (amber) + "오프라인 — 마지막 동기화 N분 전" |
| 에러 | "활동 불러오기 실패 · 다시 시도" 버튼 |

---

## 6. 상호작용 & 동작

### 6.1 상태 관리 — `useActivityStore` (Zustand)

```typescript
interface ActivityStore {
  activities: Activity[];                  // 시간 역순, 최대 500
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  filters: {
    groups: Set<'progress' | 'memo' | 'scene' | 'etc'>;
    department: 'all' | 'bg' | 'acting';
  };
  goldenMode: 'heatmap' | 'hour' | 'day';

  // 액션
  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  prepend(activity: Activity): void;       // Realtime
  applyDelta(payload: RealtimePayload): void;
  setFilter(group: ..., on: boolean): void;
  setGoldenMode(mode: ...): void;
}
```

`localStorage` 영속화:
- `bflow_activity_filters` — 필터 상태
- `bflow_activity_golden_mode` — 그래프 모드

### 6.2 데이터 흐름

```
[초기 로드]
  Dashboard 마운트 → useActivityStore.loadInitial()
  → IPC 'activity:list' { limit: 100 }
  → main의 supabase.ts.listActivities()
  → activity_log 최근 100건 + 7일치 통계 반환
  → store에 세팅 → UI 렌더

[Realtime 신규]
  다른 사용자가 체크박스 토글
  → activity_log INSERT
  → Supabase Realtime 이벤트
  → electron/realtime.ts 수신
  → broadcast.ts → 모든 윈도우에 전파
  → useActivityStore.prepend(newItem) (UUID 중복 체크 후)
  → 피드 최상단에 Framer Motion 진입 애니메이션
  → 히트맵 해당 셀 강도 +1 (로컬 재계산)

[자기 변경]
  체크박스 토글 → 낙관적 prepend (tmp_*) → RPC 응답으로 진짜 UUID 교체
  Realtime 같은 UUID 이벤트는 store dedupe 로직으로 무시

[페이지네이션]
  피드 끝 도달 → loadMore() → IPC { before: oldestCreatedAt, limit: 50 }
  → 7일 경계 도달 시 hasMore: false
```

### 6.3 그룹화 알고리즘

```typescript
function groupActivities(items: Activity[]): GroupedItem[] {
  // 시간 역순 순회
  // 직전 항목과 같은 (user_id, action_type, episode_number) + 5분 이내 → 같은 그룹
  // 그룹 내 children은 시간 역순 유지
  // 단일 활동(children 1개)은 그룹화하지 않고 평면 항목
}
```

### 6.4 인사이트 자동 산출

```typescript
function pickGoldenWindow(grid: number[][]): {day, hour, count, ratio} {
  // 24×7 격자에서 연속 2시간(같은 요일) 합이 최대인 슬롯
  // 동률이면 가장 최근 요일 우선
}
function pickGoldenHour(hourTotals: number[]): {hour, ratio}
function pickGoldenDay(dayTotals: number[]): {day, ratio}
```

### 6.5 시간대 처리

`activity_log.created_at` = `TIMESTAMPTZ` (UTC 저장).
클라이언트에서 KST(`Asia/Seoul`)로 변환하여 히트맵 셀 결정.
`dayjs` 또는 `Date.toLocaleString` + 타임존 옵션 활용.

### 6.6 IPC 핸들러 추가 — `electron/main.ts`

| 채널 | 역할 |
|---|---|
| `activity:list` | 페이지네이션 조회 |
| `activity:record` | RPC `record_activity` 호출 래퍼 |
| `activity:stats` | 1주일치 히트맵용 집계 (옵션, 클라이언트 계산이면 생략 가능) |

---

## 7. 에지 케이스 & 성능

### 7.1 동시성 / 중복 방지

- 낙관적 prepend의 임시 ID → RPC 응답 UUID로 교체
- Realtime 이벤트 dedupe: store에 같은 UUID 이미 있으면 무시
- 여러 윈도우 동시 변경: activity_log INSERT는 트랜잭션 내, 자체 충돌 없음

### 7.2 사용자/씬 변경

- 사용자 이름 변경 → 과거 기록은 옛 이름 (의도된 동작)
- 씬 삭제 → `scene_id`는 FK 없으므로 그대로 남음, 클릭 시 토스트 후 모달 닫힘
- 아카이브된 에피소드 활동도 표시 (필터로 제외 가능, v2)

### 7.3 성능 추정

| 시나리오 | 측정/추정 | 대응 |
|---|---|---|
| 활동량 (팀 20명, 50건/인/일) | 1,000건/일 = 26만건/년 | 1년 보존 정책으로 제한 |
| DB 용량 | row 약 400 bytes → 약 100MB/년 | 무료 한도 500MB의 20% |
| 위젯 첫 로드 | <100ms | 인덱스 효율 |
| 체크박스 토글 지연 | +5–10ms | RPC INSERT 1건 |
| Realtime 메시지 | 2만/일 (1000건 × 20접속) | Pro 한도 200만/일의 1% |

### 7.4 사이즈 모니터링

설정 화면에 한 줄 추가:
```
활동 기록: 12,345건 · 약 4.9 MB · 1년 후 자동 정리
```

값은 `SELECT count(*), pg_total_relation_size('activity_log')` RPC로 조회.

### 7.5 새 mutation 추가 시 누락 방지

- PR 리뷰 체크리스트에 "활동 기록 호출 추가" 항목
- v2에서 lint 룰로 자동화 가능 (선택)

---

## 8. 마이그레이션 & 배포

### 8.1 SQL 마이그레이션

`DEVLOG/supabase-init.sql`에 다음 추가:

1. `activity_log` 테이블 생성 + 인덱스 3개
2. RLS 정책 (`allow_all`)
3. Realtime publication 추가
4. `record_activity()` RPC 함수
5. `cleanup_old_activity_logs()` 함수 + pg_cron 스케줄

`IF NOT EXISTS` 패턴으로 재실행 안전성 유지.

### 8.2 코드 변경 범위

| 파일 | 변경 내용 |
|---|---|
| `DEVLOG/supabase-init.sql` | 위 §8.1 추가 |
| `electron/supabase.ts` | `recordActivity`, `listActivities` 함수 신설 + 12개 mutation에 호출 추가 |
| `electron/main.ts` | IPC 핸들러 2개 추가 |
| `electron/realtime.ts` | activity_log 구독 추가 |
| `electron/broadcast.ts` | activity 이벤트 전파 추가 |
| `electron/preload.ts` | electronAPI에 activity 메서드 추가 |
| `src/types/index.ts` | `Activity`, `ActionType`, `ActionGroup` 타입 정의 |
| `src/services/supabaseService.ts` | activity 래퍼 함수 |
| `src/stores/useActivityStore.ts` | **신규** — Zustand store |
| `src/components/widgets/RecentActivityWidget.tsx` | **신규** — 메인 위젯 |
| `src/components/widgets/activity/ActivityFeed.tsx` | **신규** — 피드 컴포넌트 |
| `src/components/widgets/activity/GoldenHeatmap.tsx` | **신규** — 히트맵 |
| `src/components/widgets/activity/GoldenBarChart.tsx` | **신규** — 막대 그래프 |
| `src/components/widgets/activity/ActivityFilterChips.tsx` | **신규** — 필터 칩 |
| `src/views/Dashboard.tsx` | 위젯 등록 + 디폴트 레이아웃 |
| `src/views/SettingsView.tsx` | 활동 기록 모니터링 라인 1줄 |

### 8.3 배포 영향

- DB 변경: `activity_log` 테이블 신설 (다운타임 0)
- 기존 mutation 12개 패치: 한 줄씩 추가, try/catch로 본 동작은 안 깨짐
- 위젯 자동 노출 안 됨 — 사용자가 `+` 버튼으로 추가
- 버전: `v1.14.0` (마이너 — 새 기능)

---

## 9. 테스트 전략

### 9.1 단위 테스트

| 대상 | 검증 |
|---|---|
| `groupActivities()` | 5분 윈도우, 같은 종류·씬 묶기, 그룹 < 2면 평면화 |
| `pickGoldenWindow()` / `pickGoldenHour()` / `pickGoldenDay()` | 정점 선택 정확성, 동률 처리 |
| `useActivityStore.prepend()` | UUID dedupe, 500건 한도 enforcement |
| `useActivityStore.setFilter()` | 필터 변경 시 히트맵·피드 동시 갱신 |

### 9.2 통합 테스트 (수동 검증)

- [ ] 두 윈도우에서 동시에 다른 씬 토글 → 양쪽 다 활동이 1번씩만 보임 (중복 없음)
- [ ] 본인 토글 → 즉시 피드 최상단 (낙관적), 보더 강조
- [ ] 다른 사용자 토글 → ~100ms 후 피드 최상단 (Realtime)
- [ ] 필터 칩 토글 → 피드 + 히트맵 동시 갱신
- [ ] 그래프 모드 전환 → 인사이트 텍스트 변경
- [ ] 그룹화된 5건 펼침/접기
- [ ] 호버 툴팁 (히트맵 그룹별 분포 / 막대 단순)
- [ ] 빈 상태 → 첫 활동 → 풍부 상태 흐름
- [ ] 오프라인 진입 → 헤더 점, 재연결 시 누락분 fetch
- [ ] 1년 cron 동작 (수동으로 INTERVAL '5 minutes' 변경 후 검증, 후 원복)

### 9.3 빌드 검증

- `npx tsc --noEmit` 통과
- `npx vite build` 통과

---

## 10. 결정 이력 (Q&A)

브레인스토밍 과정의 핵심 결정들:

1. **두 기능 묶기**: 위젯 + G:\\ 경로 링크화 → 별도 스펙 2개로 분리
2. **위젯 용도**: 팀 소셜 피드 / 매니저 모니터링 / 본인 회고 / 통합 → **팀 소셜 피드**
3. **활동 범위**: 진척만 / 진척+소통 / 픽토그램 다양화 → **그룹화된 픽토그램**
4. **골든타임 형태**: 히트맵 / 시간대 막대 / 사람별 카드 / 텍스트 → **히트맵** (+ 후속 요청으로 막대 모드 추가)
5. **레이아웃**: 상하 분할 / 탭 / 좌우 분할 / 분리 위젯 → **상하 분할**
6. **추적 종류**: 성과만 / 성과+소통 / 성과+소통+설정 → **전부 (12종 → 13종)**
7. **출시 시점 데이터**: 풍부 백필 / 진척만 백필 / 깨끗한 시작 → **깨끗한 시작**
8. **기록 경로**: 트리거 / 앱 INSERT+RPC / 기존 테이블 UNION → **앱 INSERT+RPC**
9. **추가 보강** (한솔 요청): 그래프 3모드 + 4그룹 필터 + 툴팁 강화 + 1년 보존

---

## 11. 후속 작업 (out of scope)

이 스펙 외에 별도 진행:

- **B 스펙**: 메모/댓글에 G:\\ 경로 자동 링크화 (별도 문서)
- **v2 후보**:
  - 사람별 골든타임 카드 추가 (히트맵 옆 행)
  - 활동 검색
  - 엑셀 내보내기 (월간 활동 리포트)
  - 개별 활동 종류 13종 토글 (현재는 4그룹만)
  - 본인 활동 숨기기 옵션
  - 노이즈 필터 (예: 동일 토글 ON→OFF→ON 묶기)
