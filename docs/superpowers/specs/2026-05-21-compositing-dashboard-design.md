# 컴포지팅 현황 대시보드 — 설계 문서

- 작성일: 2026-05-21
- 브랜치: `claude/stupefied-kapitsa-6670b9`
- 대상 버전: v1.30.0
- 시안 원본: `C:\Users\user\Downloads\design_handoff_unzip\design_handoff_compositing_dashboard\` (PR 1 에서 `docs/mockups/compositing-dashboard/` 로 복사)
- 브레인스토밍 세션 결정사항 기반 (2026-05-21 한솔 × Claude)
- 후속 spec: [2026-05-21-premiere-clip-length-import-design.md](./2026-05-21-premiere-clip-length-import-design.md)

---

## 1. 배경 & 목적

### 현재 상태

사이드바 `compositing` 메뉴 = `src/views/CompositingView.tsx` (1366줄). **리비전 피드백 보드** 역할. 씬별로 리비전을 묶어 보여주고 그룹화/검색/필터 가능. 컴포지팅 단계(조합·취합·보정 등)의 **진행 상황 자체는 추적하지 않음** — 리비전 댓글만.

### 보고된 니즈

한솔(매니저)이 컴포지팅 진행 상황을 한눈에 보고, 컴포지터(편집·믹스 담당) 가 단계를 토글하면 팀원이 실시간으로 보는 **현황 대시보드** 가 필요. 기존 리비전 보드와는 별개 화면.

핸드오프 폴더 (`design_handoff_compositing_dashboard/`) 에서 디자이너가 3 모드 (Timeline / Matrix / Cinema) 시안을 제시. 모드별로 변형되는 메인 본문 + 공유 헤더/필터/카드 패턴.

### 목적

- 컴포지팅 6단계 워크플로 (배치 → 취합중 → 취합 완료 → 보정 중 → 오류 → 완료) 의 EP 별 진행 현황을 **한 화면**에서 파악
- 컴포지터가 단계 토글하면 다른 팀원에게 **실시간 반영** (Supabase Realtime + Presence/Broadcast)
- 기존 리비전 보드는 **별도 메뉴 "리비전"** 으로 분리 (= 사이드바 항목 2개)

---

## 2. 결정한 디자인 (요약)

브레인스토밍 세션 (2026-05-21) 의 한솔 결정 사항 정리:

| # | 영역 | 결정 |
|---|---|---|
| 1 | 사이드바 진입점 | 기존 `compositing` → **"리비전"** 으로 리네임 / 새 **"컴포지팅"** 항목 신설. NAV 항목 2개. 기존 미해결 리비전 배지는 "리비전" 으로 이동 |
| 2 | 단계 워크플로 | 6단계 구조 유지. 표시 라벨: **배치 → 취합중 → 취합 완료 → 보정 중 → 오류 → 완료**. 내부 코드 키: `batch | combine | aggregated | adjust | error | done` (그대로) |
| 3 | 오류 세부 | **파일 미싱 / 옥에티 수정 / 리테이크 / 취소된 씬 / 기타(자유 입력)** |
| 4 | 권한 | 글로벌 `user.isCompositor === true` = 단계 변경 가능 / 나머지 = read-only. EP 별 담당 컴포지터 컬럼 추가 X |
| 5 | 카드 이미지 슬롯 | 좌(가이드) / 우(실제) 2분할 유지. **새 업로드 워크플로 X**. `scene.storyboardUrl` (좌) + `scene.guideUrl` (우) 기존 필드 사용 |
| 6 | EP 선택 | 진입 시 **마지막 본 EP** (`preferences.lastCompositingEpisode` 저장). 헤더에 EP 칩 토글 (EP1·EP2·EP3...). 첫 진입은 가장 큰 episodeNumber 의 활성 에피소드 |
| 7 | 뷰 모드 | **Timeline 단일 모드**. ViewModeToggle UI 안 그림. store 의 `viewMode` 필드는 'timeline' 상수로 미래 확장만 열어둠. Matrix/Cinema 는 별도 추후 spec |
| 8 | 부서(BG/ACT) 통합 | **씬 단위 1개 단계**. 카드에 BG·ACT 두 담당자 표시 / 단계 점은 1개. BG 와 ACT 에 같은 sceneId 가 있으면 같은 단계 공유 |
| 9 | 씬 길이 (duration) | **MVP 범위 밖**. scene 에 `duration_frames` (정수, 24fps 기본) 필드만 추가, 입력 UI 미포함. 별도 후속 spec: **Premiere V1 트랙 파싱 → 씬/파트/전체 길이 자동 추출** |
| 10 | 길이 없을 때 AE 패널 | **씬 인덱스 균등 분포**. 룰러 "Scene 1, 5, 10..." 식. 데이터 들어오면 자동 분:초 룰러로 전환 |
| 11 | AE 메타포 재라벨 | RAM 바 → **"완료 구간"** / Work Area 바 → **"작업 중 구간"** / CTI → **"현재 진행 위치"**. CTI 정의 = 마지막 단계 변경된 씬 위치 |
| 12 | 단계 전이 룰 | **확인 없이 즉시 적용** (낙관적 + Supabase sync). B flow 기존 체크박스 패턴과 일관 |
| 13 | 카드 인터랙션 | **디자인 그대로** — 호버 dock lift / 1 클릭 pin (glow pulse) / 2 클릭 모달 / 다른 곳 클릭 pin 해제. 헤더 아래 자연어 안내 띠로 의도 전달 |
| 14 | presence + 단계 변경 알림 | Supabase Realtime presence + broadcast 활용. ① 헤더 우측에 "지금 같이 보는 사람" 아바타 겹친 칩. ② 다른 사용자가 단계를 바꾸면 그 카드가 1.2초 색 펄스 + 우상단에 보낸 사람 작은 아바타 배지 (2.5초 후 사라짐). 커서 공유는 안 함 |
| 15 | 모션 | **풀 강도** (디자인 그대로) — 560ms cascade + 14px lift + 2s glow pulse + 800ms wipe-in. 프리뷰 단계에서 한솔 확인하며 미세 조정. `prefers-reduced-motion` 대응 |
| 16 (백엔드) | 데이터 저장 | **별도 테이블 `compositing_states`** 새로 만들기. 키 = (episode_number, scene_id). BG/ACT sheet 의 분리와 무관. 한솔 멘탈 모델 (씬 = 한 단위, BG/ACT = 부서) 에 부합 |

---

## 3. 핵심 사용자 흐름

### 시나리오 A — 컴포지터가 단계 토글

1. 원동우(컴포지터, `isCompositor=true`) 가 사이드바 **"컴포지팅"** 클릭
2. 마지막 본 EP (예: EP05) 자동 로딩 — 진입 cascade 560ms (씬 카드들이 순차 등장)
3. EP05 의 a005 가 취합 끝났음 → 카드 한 번 클릭 → **pinned** (떠올림 + glow pulse)
4. 같은 카드 다시 클릭 → 상세 모달
5. 모달 하단 6단계 그리드에서 **"취합 완료"** 클릭 → 즉시 적용 (확인 없음)
6. 모달 닫기 → 카드의 단계 점이 보라색(`aggregated`) 으로 전환 (140ms scale 1→1.18→1)
7. 다른 팀원 화면에는 a005 카드 우상단에 원동우 아바타 배지가 2.5초 뜨고 카드가 1.2초 색 펄스

### 시나리오 B — 비컴포지터가 현황 확인

1. 한솔(매니저, `isCompositor=false`) 이 "컴포지팅" 메뉴 클릭
2. 마지막 본 EP 자동 진입 — 헤더 우측에 "동우·민지" 아바타 칩 (지금 같이 보는 사람)
3. 헤더 아래 안내 띠: "씬을 한 번 클릭하면 위로 떠오르고, 한 번 더 누르면 상세 창이 열립니다"
4. 헤더 상태 필터에서 **"오류"** 칩 클릭 → 다른 단계 카드 dim, 오류 카드만 강조 + 우상단에 오류 사유 라벨 ("파일 미싱" 등)
5. a012 카드 클릭 → 상세 모달 read-only. 단계 그리드는 disabled 회색. 메모 영역에서 컴포지터 메모 / 활동 기록 확인 가능

### 시나리오 C — EP 전환

1. 한솔이 EP05 보다가 EP06 진행도가 궁금
2. 헤더의 **EP 칩 토글** (EP1·EP2·...·EP6) 에서 EP6 클릭
3. 현재 화면 200ms fade-out → EP6 데이터 로드 → 진입 cascade 다시 (씬들 순차 등장)
4. `preferences.lastCompositingEpisode = 6` 자동 저장

### 시나리오 D — 다른 PC 에서 동시 편집 (Realtime)

1. 원동우 PC: a008 단계를 "보정 중" 으로 변경
2. 민지 PC: 0.1초 뒤 a008 카드의 점이 노란색으로 부드럽게 전환 + 카드 1.2초 색 펄스 + 우상단에 동우 아바타 배지 2.5초
3. 민지 PC 의 store 가 Supabase Realtime 으로 자동 sync

### 시나리오 E — 오류 사유 입력

1. 원동우가 a015 를 오류로 표시하려 함
2. 카드 더블 클릭 → 상세 모달
3. 단계 그리드에서 **"오류"** 클릭 → 사유 5종 칩 펼침 (파일 미싱 / 옥에티 수정 / 리테이크 / 취소된 씬 / 기타)
4. "기타" 선택 시 자유 입력 텍스트 칸 노출 → "프리미어에서 누락된 클립" 입력
5. 저장 = 즉시 적용. 카드 점은 주황 + 우상단에 "기타 — 프리미어에서 누락된 클립" 라벨 truncate

---

## 4. 데이터 모델

### 4.1 TypeScript 타입 (`src/types/index.ts` 확장)

```typescript
// 컴포지팅 단계 — 6단계
export type CompositingStatus =
  | 'batch'       // 배치 (회색) — 작업 대기
  | 'combine'     // 취합중 (파랑) — 합치는 중
  | 'aggregated'  // 취합 완료 (보라/액센트) — 모든 소스 모음
  | 'adjust'      // 보정 중 (노랑) — 컬러/디테일 보정
  | 'error'       // 오류 (주황) — 막힘
  | 'done';       // 완료 (초록)

// 오류 세부 사유 — 5종 + 기타(자유입력)
export type CompositingErrorKind =
  | 'missing_file'   // 파일 미싱
  | 'fix_blemish'    // 옥에티 수정
  | 'retake'         // 리테이크
  | 'canceled_scene' // 취소된 씬
  | 'other';         // 기타 (자유 입력)

// 컴포지팅 상태 row — 씬 단위 1개
export interface CompositingState {
  id: string;                            // UUID
  episodeNumber: number;                 // 1, 2, 3, ...
  sceneId: string;                       // 'a001', 'b012', ...
  partId: string;                        // 'A', 'B', 'C', 'D' (헤더 grouping/필터용)
  status: CompositingStatus;             // 단계
  errorKind: CompositingErrorKind | null;// status='error' 일 때만 의미
  errorNote: string | null;              // errorKind='other' 일 때 자유 입력 텍스트
  progressPercent: number;               // 0~100, status='combine' or 'adjust' 일 때 표시용 (옵션, MVP는 단계만)
  updatedAt: string;                     // ISO
  updatedBy: string;                     // user.id
}

// Scene 확장 — 씬 길이 필드만 추가 (입력 UI 는 후속 spec)
export interface Scene {
  // ... 기존 필드 그대로
  durationFrames?: number | null;        // 씬 길이 (24fps 기준 프레임). 없으면 null
  // compositingStatus 등은 Scene 에 안 둠 — compositing_states 테이블에서 join
}

// AppUser — 기존 isCompositor 그대로 사용. 새 필드 X

// Sidebar NAV — ViewMode 확장
// 기존: 'dashboard' | 'scenes' | 'compositing' | 'calendar' | ...
// 변경: 'dashboard' | 'scenes' | 'compositing-revisions' | 'compositing' | 'calendar' | ...
//   - 'compositing-revisions' = 기존 CompositingView (리비전 피드백 보드)
//   - 'compositing' = 새 CompositingDashboardView
// 마이그레이션: localStorage `bflow:view` 가 'compositing' 이었던 사용자는
//   '리비전' 으로 보고 싶었을 수도 있어 → 첫 진입 시 토스트 안내:
//   "컴포지팅이 둘로 나뉘었어요. '컴포지팅' 은 새 진행 현황, '리비전' 은 기존 피드백 보드입니다."
```

상태 → 라벨 / 색 토큰 매핑 (한 곳에 모아둠 — `src/utils/compositingLabels.ts`):

```typescript
export const COMPOSITING_STATUS_LABEL: Record<CompositingStatus, string> = {
  batch:      '배치',
  combine:    '취합중',
  aggregated: '취합 완료',
  adjust:     '보정 중',
  error:      '오류',
  done:       '완료',
};

export const COMPOSITING_STATUS_TOKEN: Record<CompositingStatus, string> = {
  batch:      '--status-batch',
  combine:    '--status-combine',
  aggregated: '--status-aggregated',
  adjust:     '--status-adjust',
  error:      '--status-error',
  done:       '--status-done',
};

export const COMPOSITING_ERROR_LABEL: Record<CompositingErrorKind, string> = {
  missing_file:   '파일 미싱',
  fix_blemish:    '옥에티 수정',
  retake:         '리테이크',
  canceled_scene: '취소된 씬',
  other:          '기타',
};

// 단계 순서 (전이 룰: 자유 — 어디서 어디로든 가능. 단 UI 에서 자연스러운 순서)
export const COMPOSITING_STATUS_ORDER: CompositingStatus[] = [
  'batch', 'combine', 'aggregated', 'adjust', 'error', 'done',
];
```

### 4.2 Supabase 스키마 (`DEVLOG/migrations/2026-05-21-compositing-states.sql`)

```sql
-- 컴포지팅 단계 상태 — 씬 단위 1 row
CREATE TABLE IF NOT EXISTS compositing_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number int NOT NULL,
  scene_id text NOT NULL,
  part_id text NOT NULL,                    -- 'A' | 'B' | 'C' | 'D'
  status text NOT NULL CHECK (status IN ('batch','combine','aggregated','adjust','error','done')),
  error_kind text NULL CHECK (error_kind IS NULL OR error_kind IN ('missing_file','fix_blemish','retake','canceled_scene','other')),
  error_note text NULL,
  progress_percent int NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (episode_number, scene_id)         -- 씬 단위 1 row
);

CREATE INDEX IF NOT EXISTS idx_compositing_states_episode
  ON compositing_states (episode_number);

CREATE INDEX IF NOT EXISTS idx_compositing_states_status
  ON compositing_states (status);

-- 씬 길이 필드 (입력 UI 는 후속 spec, 컬럼만 추가)
ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS duration_frames int NULL;

-- Realtime 활성화 — Supabase studio 에서 수동으로도 가능
ALTER PUBLICATION supabase_realtime ADD TABLE compositing_states;

-- RLS — 모든 로그인 사용자 read, isCompositor 만 write
ALTER TABLE compositing_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compositing_states_select_all_authenticated"
  ON compositing_states FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "compositing_states_insert_compositor"
  ON compositing_states FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
        AND app_users.is_compositor = true
    )
  );

CREATE POLICY "compositing_states_update_compositor"
  ON compositing_states FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = auth.uid()
        AND app_users.is_compositor = true
    )
  );

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION set_compositing_states_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compositing_states_updated_at
  BEFORE UPDATE ON compositing_states
  FOR EACH ROW EXECUTE FUNCTION set_compositing_states_updated_at();
```

### 4.3 마이그레이션 전략

- **기존 씬** → `compositing_states` row 없음. UI 에서 status 가 없으면 `batch` (기본) 로 표시.
- 컴포지터가 단계를 바꾸는 순간 row INSERT (UPSERT pattern). row 없는 동안은 표시만 `batch`.
- 즉 **백필 SQL 없음** — lazy 생성. 매우 가벼움.

### 4.4 supabaseService 확장 (`src/services/supabaseService.ts`)

```typescript
// 로딩
export async function loadCompositingStates(episodeNumber: number): Promise<CompositingState[]>;

// 토글 (UPSERT)
export async function setCompositingState(input: {
  episodeNumber: number;
  sceneId: string;
  partId: string;
  status: CompositingStatus;
  errorKind?: CompositingErrorKind | null;
  errorNote?: string | null;
  updatedBy: string;
}): Promise<CompositingState>;

// 실시간 채널 구독
export function subscribeCompositingStates(
  episodeNumber: number,
  onChange: (row: CompositingState, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): () => void;
```

IPC 채널 — `electron/supabase.ts` 에 동일 함수 wrapper 추가:
- `supabase:loadCompositingStates`
- `supabase:setCompositingState`
- `supabase:compositingStates:subscribe` / `:unsubscribe`
- Realtime broadcast 는 `compositing-presence:{episodeNumber}` 룸으로 별도 채널

---

## 5. 사이드바 라우팅 변경

### 5.1 ViewMode 타입 확장 (`src/stores/useAppStore.ts`)

```typescript
// before
export type ViewMode = 'dashboard' | 'scenes' | 'compositing' | 'calendar' | ...;

// after
export type ViewMode =
  | 'dashboard'
  | 'scenes'
  | 'compositing'           // 새 — 컴포지팅 현황 대시보드 (CompositingDashboardView)
  | 'compositing-revisions' // 기존 — 리비전 피드백 보드 (CompositingView)
  | 'calendar'
  | ...;
```

### 5.2 NAV_ITEMS (`src/components/layout/Sidebar.tsx`)

```typescript
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard, ... },
  { id: 'scenes',    label: '씬 보기', icon: ClipboardList, ... },
  {
    id: 'compositing',              // ← 새 — '컴포지팅' (현황 대시보드)
    label: '컴포지팅',
    icon: Clapperboard,             // 기존 사용 중 — 그대로
    badgeKey: 'compositingErrors',  // 오류 / 미해결 카운트
  },
  {
    id: 'compositing-revisions',   // ← 기존 'compositing' 의 새 식별자
    label: '리비전',
    icon: MessageSquareWarning,    // 새 — 댓글/피드백 메타포
    badgeKey: 'unresolvedRevisions', // 기존 미해결 리비전 배지
  },
  { id: 'calendar',  label: '캘린더', icon: CalendarDays, ... },
  ...
];
```

### 5.3 App.tsx 라우팅 분기

```typescript
// before
{viewMode === 'compositing' && <CompositingView />}

// after
{viewMode === 'compositing' && <CompositingDashboardView />}
{viewMode === 'compositing-revisions' && <CompositingView />}
```

### 5.4 localStorage 마이그레이션

기존 사용자의 `localStorage['bflow:view'] === 'compositing'` 은 두 가지 의도가 모호. 첫 진입 시:

1. `compositing` 값이면 → 새 `compositing` (현황) 으로 진입 (디폴트)
2. 첫 진입 시 1회 토스트 안내:
   ```
   '컴포지팅' 이 둘로 나뉘었어요.
   '컴포지팅' = 새 진행 현황, '리비전' = 기존 피드백 보드
   [리비전으로 가기]
   ```
3. 토스트 안의 "[리비전으로 가기]" 클릭 → `compositing-revisions` 로 전환 + `localStorage['bflow:compositing-split-seen'] = true`
4. 토스트 한 번 닫으면 다신 안 뜸 (위 플래그)

### 5.5 사이드바 배지

- **"컴포지팅" 항목**: 오류 + 미완료 카운트 (= `compositing_states` 에서 status='error' 또는 (status != 'done' AND duration_frames 가 있는 EP 의 전체 씬 수 - done 수))
  - 간단히 MVP: status='error' 카운트만
- **"리비전" 항목**: 기존 미해결 리비전 카운트 그대로

---

## 6. 헤더

### 6.1 구조 (좌 → 우)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [컴포지팅 현황] EP05 ● 진행률 64%   │ EP칩토글  │  담당 컴포지터 칩  보는사람 │
│  뒤로(이전 EP)  ◀ EP05 ▶ 다음 EP   │ 1·2·3·4·5·6 │  [원동우 컴포지터]  [👁 3] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **타이틀**: "컴포지팅 현황 · EP05" — 굵게, accent 배지로 진행률 %
- **EP 칩 토글** (가운데): EP1 EP2 EP3 ... 가로 나열. 현재 EP 강조 (accent border + bold). 클릭 = 전환.
  - 좌우 화살표 (◀ ▶) 로 prev/next EP 도 가능
  - EP 수가 많아도 가로 스크롤 안 함 — 한 줄에 다 표시 (보통 ~10개 내외라 OK)
- **담당 컴포지터 칩**: 정보 표시용. 현재 EP 의 컴포지터 사용자 (= `isCompositor=true` 인 사람 중 그 EP 작업하는 사람) — MVP 는 "isCompositor=true 사용자 전원의 첫 1명" 또는 "현재 로그인이 컴포지터면 본인" 으로 단순화. 추후 EP별 명시 가능.
  - 클릭 시 컴포지터 목록 펼침 (옵션)
- **보는 사람 칩** (👁 + 아바타 겹침 + 숫자): 같은 EP 대시보드를 열어둔 사람들 (Supabase Realtime presence). 본인 제외.
  - 호버 시 이름 목록 풀림
  - 아무도 없으면 칩 숨김

### 6.2 진입 ↻ 버튼

우상단에 작은 ↻ 버튼 — 클릭 시 카드 cascade 재생 (디버그/시연용). 시안 그대로.

### 6.3 헤더 아래 — 안내 띠 (Guide Strip)

```
💡 씬을 한 번 클릭하면 위로 떠오르고, 한 번 더 누르면 상세 창이 열립니다.
   호버하면 옆 카드들이 살짝 들썩이고, 상태 칩을 누르면 그 단계만 강조됩니다.
   [✕ 닫기]
```

- 라이트한 톤 (배경 카드보다 1단계 옅음, 보더 액센트)
- 우측에 [✕ 닫기] — 누르면 `localStorage['bflow:compositing:guide-seen'] = true` 로 영구 숨김
- 다음 진입부터 안 뜸. 헤더 우측 ? 아이콘 클릭으로 다시 펼치기 가능

### 6.4 상태 범례 + 필터 (StatusLegend)

헤더 아래 한 줄로:

```
[배치 8] [취합중 5] [취합 완료 3] [보정 중 2] [오류 1] [완료 9]
```

- 각 칩 = 그 단계의 카드 수
- 클릭 = 그 단계 필터 토글. 다른 단계 dim (opacity 0.35). 다시 누르면 해제.
- 다중 선택 가능 (Shift+클릭 또는 그냥 토글) — MVP 는 단일 선택만, Shift 다중은 추후
- 칩 호버 시 그 단계 카드들도 동시 강조 (linked highlight)

---

## 7. AE 타임라인 패널 (헤더 바로 아래 큰 영역)

### 7.1 구조

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [👁 S]  Scene 1 ────────────────────────────────────────────────────────── │ ← LayerPanel 좌측 (씬 1)
│ [👁 S]  Scene 2 ──────────────────────────────────────────                  │ ← LayerPanel 좌측 (씬 2)
│   ...                                                                       │
│   [완료 구간 ━━━━━━━━━━━━━━━━━━]                                            │ ← RAM 바 재라벨
│   [작업 중 구간 ░░░░░░░░░░░░░]                                              │ ← Work Area 재라벨
│   |←─── 현재 진행 위치                                                       │ ← CTI 재라벨 (빨간 세로선)
│ ─────────────────────────────────────────────────────────────────────────── │
│ Scene 1 | Scene 5 | Scene 10 | Scene 15 | Scene 20                          │ ← 룰러 (씬 인덱스 fallback)
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 컴포넌트 분할

- `TimelinePanel.tsx` — 컨테이너
  - `LayerPanel.tsx` — 좌측 행 라벨 (씬 인덱스 + 솔로/뮤트 토글)
  - `TimeRuler.tsx` — 가로축 룰러 (씬 인덱스 fallback / duration 기반 분:초)
  - `CompletedBar.tsx` — "완료 구간" (= 디자인의 RamPreviewBar, 재라벨)
  - `WorkingBar.tsx` — "작업 중 구간" (= 디자인의 WorkAreaBar, 재라벨)
  - `CurrentPositionLine.tsx` — "현재 진행 위치" (= 디자인의 CtiPlayhead, 재라벨)

### 7.3 가로축 (씬 인덱스 fallback)

- `duration_frames` 가 모두 null 인 EP → 룰러 = "Scene 1 | Scene 5 | Scene 10 | ..." 식. 5씬 또는 10씬 간격.
- `duration_frames` 가 일부라도 채워진 EP → 룰러 = "0:00 | 0:30 | 1:00 | ..." 분:초. 누락 씬은 4초 fallback.
- 전환은 자동 — `useMemo(() => scenes.every(s => s.durationFrames != null), [scenes])` 로 판정.

### 7.4 "완료 구간" / "작업 중 구간"

- **완료 구간** = `status === 'done'` 인 씬들의 가로축 범위. 초록 실선 8px height.
- **작업 중 구간** = `status` 가 `'combine' | 'aggregated' | 'adjust'` 인 씬들의 가로축 범위. 파란 색 12px height + opacity 0.5.
- 두 바는 stack — 완료 위에 작업 중이 올라감 (z-index 정렬).

### 7.5 "현재 진행 위치" (CTI)

- 정의: 마지막으로 단계 변경된 씬의 가로축 위치 (씬 중심점)
- 빨간 세로선 1px + 상단 작은 삼각 핸들
- 다른 사용자가 단계 변경 → CTI 가 부드럽게 sliding (200ms transition)

### 7.6 솔로 (S) / 뮤트 (👁)

LayerPanel 좌측의 각 씬 행에:
- **솔로 (S)** — 그 씬만 강조, 나머지 dim
- **뮤트 (👁)** — 그 씬 숨김 (다른 데서도 dim)
- 이 토글은 store 의 `soloScene` / `mutedScenes` set 에 저장. AE 메타포의 깊은 활용 — 디자인 시안 그대로.

### 7.7 진입 애니메이션

- 패널 자체는 wipe-in 800ms (좌 → 우 mask reveal)
- 그 후 cascade 으로 씬 행들이 위에서 아래로 stagger 등장

---

## 8. 파트별 카드 그리드 (Main Body)

### 8.1 구조

각 파트 (A·B·C·D) 마다 한 행:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [A] 파트 A · 14컷  ▾                                                       │ ← PartHeader
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ...                 │
│ │ a001   │ │ a002   │ │ a003   │ │ a004   │ │ a005   │                     │ ← SceneCard
│ │ [가이드/실제]    │ │       │ │       │ │       │                       │
│ │ ● done │ │ ● done │ │ ● comb │ │ ● batch│ │ ● adj  │                     │
│ │ BG: 동우│ │ BG: 동우│ │ ... │ │ ... │ │ ... │                            │
│ │ ACT:민지│ │ ACT:민지│ │       │ │       │ │       │                     │
│ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 PartHeader

- `[A]` = PartBadge (디자인 토큰 `--part-a/b/c/d` 색)
- "파트 A · 14컷" = 라벨 + 카운트
- 우측 `▾` = collapse/expand (펼치면 카드 그리드, 접으면 한 줄 stacked bar 만)
- 호버 시 그 파트 한 줄 강조 (linked highlight) — store 의 `hoveredPart` 사용

### 8.3 SceneCard

- 크기: ~180px width × ~220px height (모드별 조정)
- 구조 (위 → 아래):
  - **상단**: sceneId (mono) + 단계 점 (StatusDot, 8px)
  - **중단**: 이미지 분할 (좌 storyboardUrl, 우 guideUrl). 둘 다 없으면 placeholder.
  - **하단 1**: BG 담당자 아바타 + 이름 (있으면)
  - **하단 2**: ACT 담당자 아바타 + 이름 (있으면)
  - 우상단 코너: 핀 아이콘 (pinned 상태일 때만), 또는 다른 사용자 변경 시 보낸 사람 작은 아바타 배지 (2.5초)

### 8.4 LP 호버 dock 효과

마우스가 행 위로 들어오면:
- 마우스 위치에 가장 가까운 카드: **-14px translateY + scale 1.07** (lift up)
- 인접 카드들 (좌우 1~2장): 작아지는 lift (-8px / -4px / -2px ...) 거리 함수
- 멀리 있는 카드들: 변화 없음
- 마우스가 행을 떠나면 모든 카드 200ms ease-out 으로 원위치

구현: `onMouseMove` 에서 마우스 X 와 각 카드의 X 거리 계산 → 거리에 비례한 translateY 계산. requestAnimationFrame throttle.

### 8.5 클릭 인터랙션

- **1 클릭**: 그 카드 `pinnedScene = sceneKey`. pinned 카드는 +24px translateY + scale 1.12 + glow pulse (2s 무한 반복) + boxShadow 강조.
- **같은 카드 2 클릭**: `detailScene = sceneKey` → 상세 모달 오픈
- **다른 카드 클릭**: pinnedScene 갱신 (이전 카드 unpin)
- **카드 외부 클릭** (배경, 헤더): `pinnedScene = null`
- **Esc**: pinnedScene = null + detailScene = null

### 8.6 상태별 카드 시각

- `batch` — 카드 회색 톤, 점 회색
- `combine` — 보더 액센트 파랑, 점 파랑, 진행 바 (옵션) progressPercent
- `aggregated` — 보더 보라, 점 보라
- `adjust` — 보더 노랑, 점 노랑, 진행 바 (옵션)
- `error` — 보더 주황, 점 주황 + **에러 사유 라벨 truncate** (우상단)
- `done` — 보더 초록, 점 초록, 카드 약간 desaturate (완료된 느낌)

### 8.7 진입 cascade

- 카드 각각 28ms stagger delay
- 각 카드: 560ms duration, opacity 0 → 1, translateY 14 → 0, scale 0.92 → 1, blur(3px) → 0
- prefers-reduced-motion: 모든 카드 동시 fade-in 200ms

### 8.8 단계 변경 실시간 효과

다른 사용자가 단계 변경 시 (Realtime broadcast 로 받음):
- 그 카드 1.2초 색 펄스 (background 색이 새 단계 색으로 한 번 확 떴다가 fade)
- 우상단에 보낸 사람 아바타 (24px 동그라미) 2.5초 표시 후 fade-out
- 단계 점도 부드러운 morph (140ms scale 1 → 1.18 → 1)

---

## 9. 씬 상세 모달

기존 `SceneDetailModal` 패턴 차용 (또는 별도 `CompositingSceneModal`). 새로 만들기.

### 9.1 구조

```
┌───────────────────────────────────────────────────────────────────────┐
│ [a005]  EP05 · 파트 A · 5번째 컷                              [✕]     │
├───────────────────────────────────────────────────────────────────────┤
│  [가이드 이미지 크게]     [실제 이미지 크게]                          │
├───────────────────────────────────────────────────────────────────────┤
│  단계 변경                                                            │
│  [배치] [취합중] [취합 완료] [보정 중] [오류] [완료]                  │
│   ←── 현재 단계만 채워짐, 나머지는 outline                            │
├───────────────────────────────────────────────────────────────────────┤
│  [오류 사유: 파일 미싱 | 옥에티 수정 | 리테이크 | 취소된 씬 | 기타]  │
│   ← status='error' 일 때만 노출                                       │
│  [기타 이유: ___________________]                                     │
│   ← errorKind='other' 일 때만 노출                                    │
├───────────────────────────────────────────────────────────────────────┤
│  담당자                                                               │
│    BG: 원동우  ACT: 민지                                              │
├───────────────────────────────────────────────────────────────────────┤
│  활동 기록                                                            │
│  · 14:35 원동우가 "보정 중" → "완료" 로 변경                          │
│  · 13:12 원동우가 "취합 완료" → "보정 중" 으로 변경                   │
│  · ...                                                                │
├───────────────────────────────────────────────────────────────────────┤
│  메모 (옵션 — MVP 는 단계별 메모 X, 추후)                             │
└───────────────────────────────────────────────────────────────────────┘
```

### 9.2 단계 변경 그리드

- 6 칩 가로 나열
- 현재 단계: 채워진 칩 (solid background)
- 나머지: outline 칩
- 클릭 = 즉시 적용 (확인 없음)
- 권한 없으면 (`isCompositor=false`) 그리드 전체 disabled — opacity 0.4, cursor not-allowed, 호버 툴팁 "컴포지터만 단계를 변경할 수 있습니다"

### 9.3 오류 사유 사브 그리드

- `status === 'error'` 일 때만 펼침
- 5개 칩 + 기타 칩
- "기타" 선택 시 자유 입력 텍스트 칸 (max 100자) 노출
- 입력은 onBlur 또는 Enter 에 저장 (debounce 300ms)

### 9.4 활동 기록

- `compositing_states` 의 update_at + updated_by 기반
- MVP: 마지막 변경 1개만 표시 (간단). 추후 별도 `compositing_activity` 테이블로 히스토리 확장
- 또는 기존 activity 시스템 활용 (`useActivityStore`) — recent_activity 위젯에도 노출되도록

### 9.5 키보드 단축키 (모달 안)

- `1` ~ `6`: 단계 1~6 으로 변경 (컴포지터만)
- `Esc`: 닫기
- `←` `→`: 같은 파트의 prev/next 씬으로 모달 점프

---

## 10. Store — `useCompositingDashboardStore.ts`

```typescript
import { create } from 'zustand';
import type { CompositingStatus } from '../types';

export type CompositingViewMode = 'timeline'; // | 'matrix' | 'cinema' 향후

interface CompositingDashboardStore {
  // 현재 보고 있는 EP
  episodeNumber: number | null;

  // 뷰 모드 (현재 timeline 고정)
  viewMode: CompositingViewMode;

  // 펼침/접힘 — 파트 ID set
  expandedParts: Set<string>;

  // 핀 / 디테일 모달
  pinnedScene: string | null;      // mergedKey 또는 sceneKey
  detailScene: string | null;

  // 상태 필터 (단일 선택, MVP)
  statusFilter: CompositingStatus | null;

  // 솔로 / 뮤트
  soloScene: string | null;
  mutedScenes: Set<string>;

  // 호버 / 핀 (파트 단위)
  hoveredPart: string | null;
  pinnedPart: string | null;

  // 안내 띠 표시
  guideStripVisible: boolean;

  // Actions
  setEpisode: (n: number) => void;
  toggleExpand: (partId: string) => void;
  setPinnedScene: (key: string | null) => void;
  setDetailScene: (key: string | null) => void;
  setStatusFilter: (s: CompositingStatus | null) => void;
  toggleSolo: (sceneKey: string) => void;
  toggleMute: (sceneKey: string) => void;
  setHoveredPart: (p: string | null) => void;
  setPinnedPart: (p: string | null) => void;
  dismissGuideStrip: () => void;
  showGuideStrip: () => void;
}

export const useCompositingDashboardStore = create<CompositingDashboardStore>((set, get) => ({
  episodeNumber: null,
  viewMode: 'timeline',
  expandedParts: new Set(),
  pinnedScene: null,
  detailScene: null,
  statusFilter: null,
  soloScene: null,
  mutedScenes: new Set(),
  hoveredPart: null,
  pinnedPart: null,
  guideStripVisible: typeof window !== 'undefined'
    ? !localStorage.getItem('bflow:compositing:guide-seen')
    : true,

  setEpisode: (n) => set({ episodeNumber: n }),
  toggleExpand: (partId) => set((s) => {
    const next = new Set(s.expandedParts);
    if (next.has(partId)) next.delete(partId); else next.add(partId);
    return { expandedParts: next };
  }),
  setPinnedScene: (key) => set({ pinnedScene: key }),
  setDetailScene: (key) => set({ detailScene: key }),
  setStatusFilter: (s) => set({ statusFilter: s }),
  toggleSolo: (sceneKey) => set((s) => ({
    soloScene: s.soloScene === sceneKey ? null : sceneKey,
  })),
  toggleMute: (sceneKey) => set((s) => {
    const next = new Set(s.mutedScenes);
    if (next.has(sceneKey)) next.delete(sceneKey); else next.add(sceneKey);
    return { mutedScenes: next };
  }),
  setHoveredPart: (p) => set({ hoveredPart: p }),
  setPinnedPart: (p) => set({ pinnedPart: p }),
  dismissGuideStrip: () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bflow:compositing:guide-seen', '1');
    }
    set({ guideStripVisible: false });
  },
  showGuideStrip: () => set({ guideStripVisible: true }),
}));
```

별도로 `compositing_states` 자체는 **useDataStore 확장** 또는 별도 `useCompositingDataStore` 로 분리. 기존 패턴 (useDataStore 에 scenes / episodes 있는 것) 따라 useDataStore 에 `compositingStates: Map<sceneKey, CompositingState>` 추가가 자연스러움.

---

## 11. 데이터 동기화 흐름

### 11.1 진입 시

```
1. CompositingDashboardView mount
2. store.setEpisode(preferences.lastCompositingEpisode ?? maxActiveEpisode)
3. window.electronAPI.supabaseLoadCompositingStates(episodeNumber)
   → useDataStore.setCompositingStates(rows)
4. window.electronAPI.supabaseSubscribeCompositingStates(episodeNumber)
   → onChange 콜백 등록 → store 의 row UPSERT/DELETE
5. window.electronAPI.compositingPresenceJoin(episodeNumber, currentUser)
   → presence 룸 입장 + sync
6. 카드 cascade 시작
```

### 11.2 단계 토글 (낙관적 업데이트)

```typescript
function toggleStatus(sceneKey: string, next: CompositingStatus) {
  const prev = useDataStore.getState().compositingStates.get(sceneKey);
  // 1. UI 즉시 반영
  useDataStore.getState().setCompositingState(sceneKey, {
    ...prev,
    status: next,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.id,
  });
  // 2. Supabase UPSERT
  window.electronAPI.supabaseSetCompositingState({
    episodeNumber, sceneId, partId,
    status: next,
    updatedBy: currentUser.id,
  })
    .then((row) => {
      // 3. Realtime 으로도 다시 들어옴 (자기 자신 무시 가능, 또는 그냥 overwrite OK)
      useDataStore.getState().setCompositingState(sceneKey, row);
      // 4. 다른 사람에게 broadcast (presence + 단계 변경 알림)
      window.electronAPI.compositingBroadcastChange({
        episodeNumber, sceneKey, status: next, by: currentUser.id,
      });
    })
    .catch((err) => {
      // 5. 실패 → 롤백
      useDataStore.getState().setCompositingState(sceneKey, prev);
      sonnerToast.error('단계 변경 실패: ' + err.message);
    });
}
```

### 11.3 Realtime 수신

```typescript
// supabaseService.subscribeCompositingStates 의 onChange
subscribeCompositingStates(episodeNumber, (row, eventType) => {
  const sceneKey = `${row.episodeNumber}:${row.sceneId}`;
  if (eventType === 'DELETE') {
    useDataStore.getState().deleteCompositingState(sceneKey);
  } else {
    useDataStore.getState().setCompositingState(sceneKey, row);
    // 본인이 아닐 때만 1.2초 색 펄스 + 보낸 사람 아바타 2.5초
    if (row.updatedBy !== currentUser.id) {
      transientHighlightStore.add(sceneKey, row.updatedBy);
    }
  }
});
```

### 11.4 Presence (보는 사람)

별도 broadcast 채널 `compositing-presence:{episodeNumber}`:

```typescript
// 진입
const presenceChannel = supabase.channel(`compositing-presence:${epNum}`);
presenceChannel.on('presence', { event: 'sync' }, () => {
  const state = presenceChannel.presenceState();
  // state = { userId1: [{ name, avatar, joinedAt }], userId2: [...] }
  setCurrentlyViewing(Object.keys(state).filter(id => id !== currentUser.id));
});
presenceChannel.track({ name: currentUser.name, avatar: currentUser.avatar, joinedAt: Date.now() });

// 단계 변경 broadcast
presenceChannel.send({
  type: 'broadcast',
  event: 'status-change',
  payload: { sceneKey, status, by: currentUser.id },
});

// 수신
presenceChannel.on('broadcast', { event: 'status-change' }, ({ payload }) => {
  if (payload.by !== currentUser.id) {
    transientHighlightStore.add(payload.sceneKey, payload.by);
  }
});
```

### 11.5 transientHighlightStore

```typescript
interface TransientHighlight {
  sceneKey: string;
  by: string;        // user.id
  startedAt: number; // ms timestamp
}

// 자동 제거 — 2.5초 후
add(sceneKey, by) {
  this.highlights.set(sceneKey, { sceneKey, by, startedAt: Date.now() });
  setTimeout(() => this.highlights.delete(sceneKey), 2500);
}
```

SceneCard 가 이걸 구독해서 본인 카드에 highlight 있으면 색 펄스 + 아바타 배지 렌더.

---

## 12. 디자인 토큰

핸드오프 `tokens.css` 의 값을 B flow 토큰 시스템 (`src/index.css` / Tailwind) 에 통합. 한솔의 룰 (디자인 톤 유지) 에 맞게 기존 색에 어울리도록 약간 조정 가능.

### 12.1 컴포지팅 단계 색 — `--status-*`

```css
:root, [data-theme="dark"] {
  --status-batch:       #4A5060;   /* 회색 — 작업 대기 */
  --status-combine:     #74B9FF;   /* 파랑 — 취합중 (BG의 LO 색과 동일) */
  --status-aggregated:  #A29BFE;   /* 보라 — 취합 완료 (BG의 완료 색과 동일) */
  --status-adjust:      #FDCB6E;   /* 노랑 — 보정 중 */
  --status-error:       #FF7675;   /* 주황/빨강 — 오류 */
  --status-done:        #00B894;   /* 초록 — 완료 (BG의 PNG 색과 동일) */
}
```

라이트 모드는 saturation 약간 낮춰 톤다운.

### 12.2 파트 색 — `--part-*`

```css
:root, [data-theme="dark"] {
  --part-a: #FF9F43;  /* 주황 */
  --part-b: #74B9FF;  /* 파랑 */
  --part-c: #A29BFE;  /* 보라 */
  --part-d: #00CEC9;  /* 청록 */
}
```

`PartBadge` 컴포넌트가 이 토큰 참조.

### 12.3 카드 톤

```css
--card-base:        #1A1D27;   /* 카드 배경 */
--card-border:      #2D3041;   /* 카드 보더 */
--card-border-hov:  #6C5CE7;   /* 호버 시 액센트 보더 */
--card-glow:        rgba(108, 92, 231, 0.4);   /* pinned glow */
```

### 12.4 모션 (CSS variables)

```css
--motion-cascade-duration:  560ms;
--motion-cascade-stagger:    28ms;
--motion-cascade-translate:  14px;
--motion-dock-lift:         -14px;
--motion-dock-scale:         1.07;
--motion-glow-duration:    2000ms;
--motion-wipe-duration:     800ms;
```

`@media (prefers-reduced-motion: reduce)` 에서 다 200ms fade-in 으로 override.

---

## 13. 모션

### 13.1 진입 cascade

```css
@keyframes bf-cascade-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.92);
    filter: blur(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

.bf-cascade-item {
  animation: bf-cascade-in var(--motion-cascade-duration) cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
}
/* stagger via inline style: animation-delay: calc(28ms * var(--i)) */
```

### 13.2 호버 dock (JS 기반)

```typescript
function onRowMouseMove(e: MouseEvent, rowRef: HTMLElement) {
  const cards = rowRef.querySelectorAll('.scene-card');
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    const cardCenter = rect.left + rect.width / 2;
    const distance = Math.abs(e.clientX - cardCenter);
    const maxDistance = 200; // px
    const lift = Math.max(0, 1 - distance / maxDistance);
    const dy = lift * -14;
    const scale = 1 + lift * 0.07;
    card.style.transform = `translateY(${dy}px) scale(${scale})`;
  });
}
function onRowMouseLeave(rowRef: HTMLElement) {
  rowRef.querySelectorAll('.scene-card').forEach((card) => {
    card.style.transform = '';
  });
}
```

transition CSS 에서 transform: 200ms ease-out 으로 자연스럽게.

### 13.3 glow pulse (pinned)

```css
@keyframes bf-glow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--card-glow); }
  50%      { box-shadow: 0 0 16px 4px var(--card-glow); }
}
.scene-card.pinned {
  animation: bf-glow-pulse var(--motion-glow-duration) ease-in-out infinite;
  transform: translateY(24px) scale(1.12) !important;
}
```

### 13.4 wipe-in (AE 패널 진입)

```css
@keyframes bf-wipe-in {
  from { clip-path: inset(0 100% 0 0); }
  to   { clip-path: inset(0 0 0 0); }
}
.bf-wipe-in {
  animation: bf-wipe-in var(--motion-wipe-duration) cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
```

### 13.5 단계 변경 색 펄스 (Realtime 수신 시)

```css
@keyframes bf-status-flash {
  0%   { background-color: var(--current-status-color); }
  50%  { background-color: var(--current-status-color-bright); }
  100% { background-color: var(--current-status-color); }
}
.scene-card.flashing {
  animation: bf-status-flash 1200ms ease-out;
}
```

### 13.6 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  .bf-cascade-item,
  .bf-wipe-in,
  .scene-card.pinned,
  .scene-card.flashing {
    animation-duration: 200ms !important;
    animation-iteration-count: 1 !important;
  }
  .scene-card.pinned {
    transform: none !important;
    box-shadow: 0 0 0 2px var(--card-glow) !important;
  }
}
```

---

## 14. 권한 모델

### 14.1 단순 룰

- `user.isCompositor === true` → 단계 변경 가능 (모든 EP)
- `user.isCompositor === false` → read-only

### 14.2 UI 분기

- 모달의 단계 그리드: 컴포지터 아니면 disabled
- 모달의 오류 사유 그리드: 컴포지터 아니면 disabled
- 카드 자체는 누구나 클릭 가능 (= pin / 상세 모달 오픈)
- 카드의 단계 점은 다 보임 (status 자체는 read OK)

### 14.3 Supabase RLS

- SELECT: 모든 인증 사용자 OK
- INSERT/UPDATE: `EXISTS (SELECT 1 FROM app_users WHERE id=auth.uid() AND is_compositor=true)` 만
- DELETE: 같은 룰. MVP 는 DELETE 안 함 (UPSERT 만)

---

## 15. PR 분할 계획 (4개)

### PR 1 — 기반: 토큰 + 타입 + DB 스키마

**브랜치**: `claude/stupefied-kapitsa-6670b9` (현재) 또는 새 브랜치

**파일**:
- `src/index.css` — `--status-*`, `--part-*`, `--motion-*` 토큰 추가
- `tailwind.config.js` — 새 토큰을 Tailwind 클래스로 노출
- `src/types/index.ts` — `CompositingStatus`, `CompositingErrorKind`, `CompositingState`, `Scene.durationFrames` 추가
- `src/utils/compositingLabels.ts` (신규) — 라벨/색 매핑 함수
- `DEVLOG/migrations/2026-05-21-compositing-states.sql` — 새 테이블 + 컬럼 + RLS
- `src/services/supabaseService.ts` — `loadCompositingStates`, `setCompositingState`, `subscribeCompositingStates` 추가
- `electron/supabase.ts` — IPC wrapper 추가
- `electron/preload.ts` — `window.electronAPI.supabase*Compositing*` 노출
- `docs/mockups/compositing-dashboard/` — 핸드오프 폴더 복사 (참조용)

**검증**:
- `npm run typecheck` ✓
- `npm run build:vite` ✓
- Supabase 라이브 DB 에 마이그레이션 SQL 적용 → SELECT/INSERT 수동 테스트
- 기존 UI 영향 0 (새 컴포넌트 X)

**커밋**: 한글, "컴포지팅 대시보드 기반 — 토큰·타입·DB 스키마 추가"

### PR 2 — Store + 공통 컴포넌트

**파일**:
- `src/stores/useCompositingDashboardStore.ts` (신규)
- `src/stores/useDataStore.ts` — `compositingStates: Map<string, CompositingState>` 추가 + setter
- `src/components/compositing-dashboard/common/StatusChip.tsx` (신규)
- `src/components/compositing-dashboard/common/StatusDot.tsx` (신규)
- `src/components/compositing-dashboard/common/PartBadge.tsx` (신규)
- `src/components/compositing-dashboard/common/transientHighlightStore.ts` (신규)

**검증**:
- Storybook 없으니 임시 dev playground 페이지에서 시각 확인 (옵션)
- typecheck + build

### PR 3 — 메인 뷰 + 사이드바 라우팅

**파일**:
- `src/views/CompositingDashboardView.tsx` (신규 — 본체)
- `src/views/compositing-dashboard/DashHeader.tsx` (신규)
- `src/views/compositing-dashboard/GuideStrip.tsx` (신규)
- `src/views/compositing-dashboard/StatusLegend.tsx` (신규)
- `src/views/compositing-dashboard/timeline/TimelinePanel.tsx` (신규)
- `src/views/compositing-dashboard/timeline/LayerPanel.tsx` (신규)
- `src/views/compositing-dashboard/timeline/TimeRuler.tsx` (신규)
- `src/views/compositing-dashboard/timeline/CompletedBar.tsx` (신규)
- `src/views/compositing-dashboard/timeline/WorkingBar.tsx` (신규)
- `src/views/compositing-dashboard/timeline/CurrentPositionLine.tsx` (신규)
- `src/views/compositing-dashboard/cards/PartCardRow.tsx` (신규)
- `src/views/compositing-dashboard/cards/PartHeader.tsx` (신규)
- `src/views/compositing-dashboard/cards/SceneCard.tsx` (신규)
- `src/views/compositing-dashboard/modal/CompositingSceneModal.tsx` (신규)
- `src/stores/useAppStore.ts` — ViewMode 에 `compositing-revisions` 추가
- `src/components/layout/Sidebar.tsx` — NAV_ITEMS 2개 항목 분리
- `src/App.tsx` — 라우팅 분기 + localStorage 마이그레이션 토스트
- `src/services/preferencesService.ts` (또는 settingsService) — `lastCompositingEpisode` 저장/로드
- presence/broadcast 통합 (`electron/broadcast.ts` 확장)

**검증**:
- typecheck + build
- 라이트/다크 모드 시각 점검
- isCompositor true/false 양쪽 권한 분기 테스트
- EP 전환 시 cascade 재생
- 두 창 열고 단계 변경 → Realtime 수신 + 색 펄스 + 아바타 배지 확인
- presence 칩 — 두 창 열면 1, 한 창 닫으면 0

### PR 4 — 마무리: keyframes / update-notes / 라이트 모드 점검 / 잔여

**파일**:
- `src/index.css` `@layer components` — `bf-cascade-item`, `bf-wipe-in`, `bf-glow-pulse`, `bf-status-flash` keyframes
- `prefers-reduced-motion` 미디어 쿼리
- `DEVLOG/update-notes.json` — v1.30.0 신규 항목 (한솔 비개발자 톤)
- 라이트 모드 대비 점검 + 누락 토큰 보완
- E2E 시나리오 수동 점검 체크리스트 작성 (`DEVLOG/compositing-dashboard-e2e.md`)
- `tasks/lessons.md` — 학습 사항 정리

**검증**:
- 모든 인터랙션 매끄러운지 (한솔님 프리뷰 확인 게이트)
- typecheck + build + 정식 `npm run build`

### 빌드 검증 룰 — 각 PR 별

CLAUDE.md 룰에 따라:
1. `npm run typecheck` 통과
2. 관련 테스트 통과 (`npm test -- compositing` 같은 패턴)
3. `npm run build:vite` 통과
4. 정식 배포 PR 일 경우 `npm run build` 까지

---

## 16. 후속 spec — Premiere V1 추출 (별도 문서)

- 파일: `docs/superpowers/specs/2026-05-21-premiere-clip-length-import-design.md`
- 요지: 공용 .prproj 파일을 선택 → V1 트랙의 클립 이름과 길이 파싱 → 매칭되는 scene 의 `duration_frames` 자동 채움 + 수동 수정 가능
- 적용 시점: 컴포지팅 대시보드 안정화 후 (PR 4 이후 v1.31.0+ 같은 후속 마이너 버전)
- MVP 에는 placeholder spec 만 (한 줄 outline)

---

## 17. 알려진 모호점 / 추후 결정

### 17.1 PR 1 진행 전 확정 필요

- ✅ 모두 결정됨

### 17.2 PR 2~3 진행 중 spec review 가 필요한 부분

- **카드 이미지 라벨 텍스트** — "가이드" / "실제" 가 약간 어색할 수 있음. 한솔님 팀 용어로 다듬을지 (예: "스토리보드" / "LO" 또는 "보드" / "참고") — PR 3 의 SceneCard 구현 직전에 한솔 확인
- **"담당 컴포지터" 칩** 표시 룰 — 현재는 "isCompositor=true 사용자 첫 1명 또는 본인" 으로 단순화. EP 별 명시가 필요해지면 후속 spec
- **EP 칩 토글의 EP 개수가 매우 많아질 때 (10개+)** — 가로 스크롤 or "..." 드롭다운으로 fallback 필요. 현재는 한 줄로 무조건 표시

### 17.3 추후 (v1.31.0+)

- Matrix 모드 / Cinema 모드 추가
- 활동 기록 히스토리 (별도 `compositing_activity` 테이블)
- 단계별 메모
- presence 의 cursor 공유 (필요 시)
- 사이드바 배지의 더 정교한 카운트 (단순 error 수 → 진척 + 오류 종합 스코어)
- Premiere V1 추출 spec 구현

---

## 18. 참고

- 핸드오프 원본: `C:\Users\user\Downloads\design_handoff_unzip\design_handoff_compositing_dashboard\`
- 핸드오프 README 의 Implementation Plan 10 단계는 본 spec 의 PR 분할 4개로 재정리됨
- 디자인 시안 직접 보기: `index.html` 더블클릭 (3 모드 + Tweaks 패널 라이브)
- 본 spec 의 결정 사항은 브레인스토밍 세션 (2026-05-21 한솔 × Claude) 기반. 그 세션의 결정이 변경되면 본 spec 도 갱신할 것

---

*문서 버전: 2026-05-21 v1*
*작성: Claude × 한솔 (Studio JBBJ)*
