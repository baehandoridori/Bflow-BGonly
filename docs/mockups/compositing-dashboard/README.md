# Handoff: B flow — 컴포지팅 현황 대시보드

> **대상 사이드바 섹션**: `compositing` (이미 `useAppStore`의 `ViewMode`에 존재 — 새 뷰로 교체/확장)
> **대상 파일**: `src/views/CompositingView.tsx` 의 자리에 새 대시보드를 마운트하거나, 별도 뷰로 추가
> **권한**: `episode.compositor.name === currentUser.name` 일 때만 상태 변경 가능
> **데이터**: 기존 `useDataStore` 의 `episodes[].parts[].scenes[]` 그대로 사용 + `compositingStatus` 필드 1개 추가
> **테마**: B flow 의 모든 토큰(`--color-bg-*`, `--color-accent`, `--color-on-accent`, 다크/라이트) 그대로 따름

---

## Overview

기존 `CompositingView` 는 "씬 별 리비전(피드백) 타임라인" 에 가깝다. 본 디자인은 그것과 **별개의 신규 뷰** 로, **에피소드 한 편의 컴포지팅 진행 상황을 한눈에 공유** 하는 대시보드다.

- 컴포지팅 담당자(컴포지터)가 각 컷의 진행 상태를 토글하고
- 팀원 전체가 같은 뷰를 보며 어느 파트/컷에서 막혀있는지 즉시 파악할 수 있다
- 담당 컴포지터로 지정된 사용자만 편집 가능, 그 외엔 읽기 전용

3 가지 뷰 모드를 헤더 토글로 전환:
1. **Timeline** (메인 / 기본) — After Effects 타임라인 패널 + 파트별 LP/Dock 호버 카드 그리드
2. **Matrix** — 행=파트 × 열=상태 매트릭스. 어느 단계에서 막혔는지 진단용
3. **Cinema** — 시네마틱 후반작업 부스 톤. 좌측 파트 트랙 / 중앙 카드 콘스텔레이션 / 우측 모니터 프리뷰

세 모드는 **데이터/상태가 완전히 공유** 된다. 토글은 시각화만 바뀌고 동작/권한/필터는 동일.

---

## About the Design Files

본 폴더에 포함된 HTML / JSX 파일은 **디자인 레퍼런스** 이다. 의도된 룩과 인터랙션을 보여주는 프로토타입일 뿐, **그대로 가져다 쓸 프로덕션 코드가 아니다**.

이 디자인을 B flow 의 기존 환경(**Electron + React 18 + TypeScript + Tailwind CSS + Zustand**) 에서 재구현하는 것이 과제다. 기존 패턴을 따라야 한다:
- 색상은 절대 하드코딩하지 말고 `var(--color-*)` / `bg-bg-card`, `text-text-primary` 같은 Tailwind 토큰 사용
- 상태는 `useDataStore` / 새로 만든 `useCompositingDashboardStore` (Zustand) 로
- 데이터 쓰기는 낙관적 업데이트 → Supabase 동기화 → 실패 시 롤백 패턴
- IPC 직접 호출 금지, 반드시 `supabaseService` 경유
- 컴포넌트는 `src/components/scenes/` 의 `UnifiedSceneCard.tsx`, `src/views/compositing/` 의 패턴 따르기
- framer-motion 의 `motion.div`, `AnimatePresence` 활용 가능 (기존 앱이 이미 사용 중)

본 디자인의 인라인 스타일은 토큰 시연용이다. 실제 구현은 **Tailwind 유틸리티 + 필요시 `<style>` 블록의 컴포넌트 클래스** 로 가는 것이 맞다.

## Fidelity

**High-fidelity (Hifi)**. 인터랙션, 모션 곡선, 색 토큰, 타이포 크기, 여백, 음영, 진입 애니메이션 모두 픽셀 단위로 의도된 값이다. 가능한 한 그대로 재현할 것.

---

## Screens / Views

### 1. 메인 대시보드 (`compositing`)

#### 1-1. 헤더 (3 모드 공통)

좌측 → 우측:

| 영역 | 내용 |
|---|---|
| 로고 박스 | 36×36 정사각, `radius: 9`, accent → accentSub 135° 그라데이션, 안에 `clapperboard` lucide 아이콘 18px white |
| 타이틀 | "컴포지팅 현황" (17px / 700) + EP 타이틀·코드 (12px / 500 / secondary) |
| 메타 | "총 N컷 · MM:SS · 업데이트 X" (11px / secondary) |
| **툴바 (우측)** | View Toggle(Timeline/Matrix/Cinema) + 모두 펼치기/접기 (Timeline 모드일 때만) |
| 담당 컴포지터 칩 | pill, 22px 아바타 + "담당 컴포지터" 캡션 + 이름. 본인이면 accent border / 자물쇠 열림, 아니면 일반 카드 / 자물쇠 잠김 |
| 보는 중인 사람 | pill, eye 아이콘 + 18px 아바타 3장 겹침 + "3명" |
| 재진입 ↻ 버튼 | 32×32 카드 + rotate 아이콘. 진입 cascade 애니메이션 재생 |

헤더 하단에 1px 보더 + 18 28 14 padding.

#### 1-2. 상태 범례 (3 모드 공통)

10 28 8 padding. 6 개 칩 가로 정렬, 각각:
- 상태 점 (`--status-*` 토큰) + 라벨 + 카운트 + 비율(%)
- 활성 시 해당 상태 색 / 14% 배경 / 55% 보더 + 점 펄스 글로우
- 클릭 시 필터 토글

상태 6개 (semantic 토큰명):
1. `batch` 배치 — 회색 — `square` 아이콘
2. `combine` 조합 중 — 파랑 — `layers` 아이콘
3. `aggregated` 취합완료 — 액센트 서브 — `check-square` 아이콘
4. `adjust` 보정 중 — 노랑 — `sliders` 아이콘
5. `error` 오류 — 주황 — `alert` 아이콘 (세부: 파일 미싱 / 옥에티 수정 / 리테이크 대기 / 소스 누락 / 경로 오류)
6. `done` 완료 — 초록 — `check` 아이콘

---

### 2. Timeline 모드 (메인)

#### 2-1. AE 타임라인 패널 (상단)

After Effects 의 Time Layout 패널을 정밀 재현. 카드 컨테이너: `radius: 8`, `bg-bg-card`, `border-bg-border`, `boxShadow: 0 8px 24px rgb(var(--color-shadow) / 0.3)`.

**좌측 레이어 패널 (200px 고정)**

- 최상단 카드 헤더 (46px = `RULER_H + RAM_BAR_H + WORK_AREA_H`): "COMP NAME" 캡션 (9px / 0.1em letter-spacing / secondary)
- 4 개 파트 행 (44px = `ROW_H`): 좌측 4px 컬러 strip (`--part-a/b/c/d` 토큰) + S(Solo)/👁(Visibility) 14×14 토글 + 파트명(12px/800/파트 컬러) + 컷 수(9px mono) + 진행도 mini bar(3px) + 완료 % (9px mono right-align)
- 행 클릭 → 하단 카드 영역의 해당 파트로 부드러운 스크롤 (offsetTop − 280)
- Solo 누른 행만 솔로(이 외 dim), 👁 누른 행 가림(dim)
- 행 hover 시 좌측에서 right-leaning 그라데이션 + 컬러 strip glow

**우측 타임라인 그래프 (flex-1)**

위에서 아래:

1. **시간 룰러 (26px)**: 분:초 12 메이저 틱 + 4× 마이너 틱 (1/4 단위). 메이저 라벨은 mono 10px / 600 / `tabular-nums`. 좌단 라벨은 좌측 정렬, 우단 라벨은 우측 정렬, 그 외 중앙 정렬.

2. **RAM 프리뷰 바 (8px)**: `done` 상태 씬 영역을 초록 실선으로 표시. 트랙은 4px on / 4px off 점선 (`--status-done` 15% alpha). 좌단에 "RAM" 라벨 (8px / 800 / `--status-done`). 실선 segment는 `wipe-in` 스태거 등장.

3. **Work Area 바 (12px)**: `combine | adjust | aggregated` 인 씬들의 첫~끝 시간 범위를 파란 영역으로. 영역은 `--status-combine` 42% alpha + 70% alpha 보더. 양 끝에 6px 핸들 (실선 + glow 6px). 좌단 "WORK AREA" 라벨.

4. **레이어 트랙 4 행 (44px × 4)**: 각 파트는 막대 한 줄. 막대 안에 **상태 분포 stacked bar** (배치/조합/취합/보정/오류/완료 의 가로 비율 — 각 세그먼트는 해당 상태 색 그라데이션 + 0.5 alpha primary 1px 분리선). 막대 바깥에 좌측 라벨 컬러 strip 4px + 하단 (파트명·컷수) 좌 / (시간·완료%) 우 라벨. focused 시 막대 위로 1px lift + 1.06 scale-Y + glow.

5. **CTI (Current Time Indicator / 플레이헤드)**: 빨간 1px 세로선 (#E53935), 패널 상단부터 하단까지. 상단에 빨간 ▼ 13×14 화살 핸들. 옆에 분:초 라벨 (9px mono 700 / 빨간 보더 + 카드 배경). 위치 = "가장 마지막 진행 위치" (`done` 끝점 / 진행 중 씬의 진행도 기준 중심점 중 최대값).

#### 2-2. 안내 띠

타임라인 패널 바로 아래. 8 14 padding, `bg-bg-card/0.5`, `radius: 6`. 좌측부터: RAM·Work Area·CTI 의미 설명 + 행동 가이드 (레이어 클릭 → 점프 / S → 솔로 / 👁 → 가리기).

#### 2-3. 파트별 LP 카드 그리드 (하단)

각 파트 한 행, `padding: 12 28 36`, 하단에 점선 보더.

**파트 헤더 (클릭 시 접고/펴기)**:
- chevron 18×18 (펴짐 ▼ 0deg, 접힘 ▶ −90deg, transform transition 220ms)
- 30×30 파트 배지 (focused 시 2px 보더 + glow)
- 파트명 (15px / 700)
- "N컷 · M:SS" (11px / secondary)
- **접혀있을 때만**: 인라인 200×6 stacked mini bar + 완료 % 라벨
- 우측 그라데이션 separator line + (펴짐+호버 시) LP 안내 마이크로 카피

**LP 카드 행** (`expanded === true` 일 때만 렌더):
- `display: flex; flex-wrap: wrap; gap: 40px 14px; align-items: flex-end; padding-top: 18; min-height: 240`
- 진입 시 `bf-card-cascade` 320ms 애니메이션 + 카드별 `--idx * 28ms` 스태거
- 마우스 이동 시: 행의 모든 카드에 대해 마우스 X 와 카드 중심 X 의 거리로 lift 계산
  - `t = max(0, 1 - dx / 200)`, `lift = smoothstep = t² × (3 - 2t)`
  - `translateY(-lift * 14)` `scale(1 + lift * 0.07)`
  - `transformOrigin: 'bottom center'`

**SceneCard** (184px 폭):
- `bg-bg-card`, `border 1.5px / bg-border` (호버/엘리베이트 시 `--status-*` 60~100%), `radius: 10`
- 호버 시 자체 boost: `effectiveLift = max(LP_lift, hover ? 0.55 : 0)` + 4px 추가 lift + glow 30→40% alpha
- 클릭 1회 → **pinned (떠올린 상태)**: 12px 추가 lift + `bf-glow-pulse` 2s ease-in-out infinite (`--bf-glow: var(--status-*)`)
- 떠올린 카드 다시 클릭 → **상세 모달 오픈**
- 카드 헤더 (8 10 6): `#N` partSceneNo (mono 10px secondary60%) + `a001` sceneId (mono 13px 800) + **StatusChip sm**
- 두 이미지 분할 (margin: 0 10 6, gap: 1, radius: 6 overflow hidden):
  - **좌**: `guideUrl` (가이드 / 스토리보드) — 78px height, 좌상단 "가이드" 라벨 (8px mono / 카드 배경 85% / secondary)
  - **우**: `finalUrl` (실제 컴포지팅) — 78px, 좌상단 "실제" 라벨 (status 색 88% / white)
  - 오류 시 하단에 가로 error 칩 (status-error 94% / white)
- 메모 (있을 때): 0 10 4 padding, 10px italic / `rgb(217 161 76)` (앰버 톤) / 한 줄 truncate
- **BG/ACT 두 담당자 영역** (6 10 8):
  - 행 1: `[BG]` 칩 (8px / 0.08em / blue tone bg+text) + 15px 아바타 + 이름 (10.5px / 500)
  - 행 2: `[ACT]` 칩 (pink tone) + 15px 아바타 + 이름
- 진행도 바: 3px / status 색 / 6px glow

#### 2-4. 상세 모달 (떠오른 카드 두 번째 클릭 → 오픈)

- 전체 viewport overlay, `rgb(var(--color-overlay) / 0.7)` + 8px blur backdrop
- 컨테이너: 92% width / max 880, max 90% height, `bg-bg-card`, `radius: 14`, status 색 1.5px 보더 + status 35% glow
- ESC 또는 바깥 클릭으로 닫힘
- **헤더**: 파트 배지 + sceneId(uppercase, mono 22px 800) + 메타 (#partSceneNo · duration) + **StatusChip solid lg** + 닫기 × 32×32
- **본문** (grid 1.4fr 1fr, gap 18, padding 22):
  - **좌 컬럼**:
    - 가이드 라벨(10px secondary 0.1em) + 16:9 큰 이미지 (`radius: 8`, `bg-border`)
    - 실제 라벨 (status 색) + 16:9 큰 이미지 (status 보더 + glow)
  - **우 컬럼**:
    - 담당자 섹션: BG (blue tinted 카드, 26px 아바타) / ACT (pink tinted 카드)
    - 진행도: 라벨 + status 색 % + 6px ProgressBar
    - 메모 (있을 때): primary 50% bg, italic 12px
    - 오류 (있을 때): status-error 16% bg + 50% border + alert 아이콘 + errorKind 텍스트
    - **상태 변경 그리드** (3 col × 2 row): 각 상태 버튼. 현재 상태는 25% alpha bg + 100% border. 컴포지터가 아니면 40% opacity + pointerEvents none + 자물쇠 캡션

---

### 3. Matrix 모드

행=파트(A/B/C/D) × 열=상태(6 가지) 그리드.

**헤더 행**: 좌측 88px 라벨 셀 ("파트 \\ 상태"), 그 우측 6 개 상태 헤더 버튼 카드 (8 10 padding, status 점+라벨, 큰 카운트 18px 800, 전체 대비 분모). 클릭 → 열 포커스/필터.

**파트 행 (× 4)**: 좌측 88px 파트 헤더 (큰 22px partId + 컷수 + 시간), 그 우측 6 개 셀. 각 셀: `min-height: 110`, 점선 보더 (focused 면 status 색), 안에 124px MatrixCard 들 wrap.

**MatrixCard (124px)**: 헤더(scene ID 9px mono) + 16:9 썸네일 (final) + 푸터 (14px BG 아바타 + partID·partSceneNo + 리비전 v 칩). 호버 시 4px lift + status glow + 4% scale.

상단에 SlimTimeline (30px) 추가 — 파트별 비율 바.

행/열 포커스 시 다른 칸 32% opacity dim.

---

### 4. Cinema 모드

3 컬럼: 좌 PartTracks (170px) / 중앙 카드 콘스텔레이션 / 우 CinemaPreview (280px).

배경: 어두운 톤 + 라이트 리크 (accent / accentSub 라디알 그라데이션) + 미세 그레인 (SVG turbulence) + 옅은 스캔라인 (3% opacity).

**좌측 PartTracks**: 파트별 카드 (45 12 padding, radius 9). 좌측 3px 컬러 strip glow, 큰 22px partId + 컷수, 진행도 3px bar + 시간 mono + 완료 %. focused 시 4px 우측 translate.

**중앙 콘스텔레이션**: 파트별 섹션. 각 섹션은 점선 보더 + 파트명 헤더 + 그라데이션 line. 안에 ConstellationCard (92px) 들이 `marginLeft: -8` 로 살짝 겹쳐 가로 wrap. 카드는 sceneId 기반 결정적 -2~2deg 회전 + 미세 yOffset. 항상 status 색 ambient glow (focused 시 55% / 평소 22%). 호버 시 14px lift + 1.18 scale + 회전 0.

**우측 CinemaPreview**:
- 카드 포커스 안됐을 때: 도넛(140px) 멀티컬러 진행률 + 상태별 카운트·% 리스트 + 인터랙션 안내 박스
- 카드 포커스 됐을 때: 16:9 모니터 (status 색 보더 + 28px glow, vignette), 좌상단 파트 배지, 좌하단 sceneId(uppercase mono 14px), 우하단 StatusChip solid sm. 그 아래 메타(담당, 길이, 진행도, 메모, 오류). 컴포지터면 하단에 3×2 상태 변경 그리드.

---

## Interactions & Behavior

### 진입 애니메이션 (3 모드 공통)
- 카드들이 정렬된 순서로 (파트 → partSceneNo) 등장. `bf-card-cascade` keyframes: `opacity 0 → 1`, `translateY(14px) → 0`, `scale(0.92) → 1`, `blur(3px) → 0`. duration: 560ms. 카드별 stagger: `--idx * 28ms + 100ms`.
- 타임라인 막대들은 `bf-wipe-in`: `scaleX(0) → 1`, duration 800ms, `transform-origin: left center`.
- 헤더 ↻ 버튼으로 mountKey 증가시켜 재진입.

### LP / Dock 호버 (Timeline 모드)
- 행에 `mousemove` 리스너. `rowRect` 기준으로 mouseX 계산.
- 모든 카드의 `getBoundingClientRect()` → 중심 X 와 mouseX 거리로 lift.
- `t = max(0, 1 - dx / 200)`, `lift = t² × (3 - 2t)` (smoothstep).
- `transform: translateY(-lift * 14) scale(1 + lift * 0.07)`.
- 카드별 hover 시 `effectiveLift = max(lift, 0.55)` + 추가 4px lift.

### 카드 클릭 → 떠올리기 → 모달
- 1차 클릭: `pinnedScene` state 설정. 카드 +12px lift, glow pulse.
- 같은 카드 2차 클릭 (이미 pinned): 상세 모달 오픈.
- 배경 클릭 → pinned 해제.

### 파트 접고/펴기
- 파트 헤더 클릭으로 토글. 헤더의 chevron transform 220ms.
- 헤더 우측 일괄 "모두 펼치기/접기" 버튼.
- 접힌 파트는 헤더만 + 인라인 mini stacked bar + 완료 % 보임.
- 펼친 행은 cascade 등장.

### 뷰 모드 토글
- 헤더 우측 ViewModeToggle (3 옵션). 활성 옵션은 `--color-accent` bg + on-accent 텍스트 + 12px glow.
- 같은 상태/필터를 그대로 들고 다른 시각화 컴포넌트로 마운트만 바꿈 (`<VariantA>` 가 wrapper 로서 viewMode 에 따라 B/C 렌더).
- 단일 뷰 코드로 갈 거면 `viewMode` state 를 store 에 두고 단일 `<CompositingDashboardView>` 가 3 모드를 내부 분기로 처리해도 됨.

### 권한 분기
- `viewerIsCompositor = currentUser.name === episode.compositor.name`
- 헤더 컴포지터 칩 색/자물쇠 모양 분기
- 상세 모달의 상태 변경 그리드: pointerEvents none / 40% opacity / 자물쇠 안내 캡션
- Cinema 의 우측 모니터 하단 상태 변경 그리드 동일 분기

### 필터 / 솔로 / 가리기
- 상태 칩 클릭 → `statusFilter` 단일 선택 (다시 클릭 해제). 비매칭 카드 dim / saturate 0.5
- 레이어 패널 `S` → `soloPart` 단일. 다른 파트 dim
- 레이어 패널 `👁` → `mutedParts` 다중. 해당 파트 dim
- Timeline 모드에서 파트 카드 행은 솔로/뮤트 영향 받지 않음 (헤더만 dim 시각 옵션은 선택)

### 모션 감소 모드
- `@media (prefers-reduced-motion: reduce)` 에서 모든 animation/transition 0.01ms 로 단축

---

## State Management

새 store 권장 (`src/stores/useCompositingDashboardStore.ts`):

```ts
interface CompositingDashboardState {
  viewMode: 'timeline' | 'matrix' | 'cinema';
  setViewMode: (v: ...) => void;

  expandedParts: Set<string>; // partId
  togglePartExpanded: (partId: string) => void;
  setAllExpanded: (expanded: boolean) => void;

  pinnedScene: string | null; // sceneKey
  setPinnedScene: (k: string | null) => void;

  detailScene: string | null; // sceneKey for modal
  openDetail: (k: string) => void;
  closeDetail: () => void;

  statusFilter: CompositingStatus | null;
  soloPart: string | null;
  mutedParts: Set<string>;
  hoveredPart: string | null;
  pinnedPart: string | null;
}
```

기존 `useDataStore` 는 그대로 사용 (scenes/episodes/parts 데이터).
기존 `useAuthStore.currentUser` 로 권한 판단.

### Supabase 스키마 추가 필요

`scenes` 테이블에 컬럼 추가 (또는 별도 `compositing_states` 테이블):

```sql
ALTER TABLE scenes ADD COLUMN compositing_status TEXT
  CHECK (compositing_status IN ('batch','combine','aggregated','adjust','error','done'))
  DEFAULT 'batch';
ALTER TABLE scenes ADD COLUMN compositing_error_kind TEXT;
ALTER TABLE scenes ADD COLUMN compositing_progress NUMERIC(3,2) DEFAULT 0;
ALTER TABLE scenes ADD COLUMN compositing_updated_at TIMESTAMPTZ;
ALTER TABLE scenes ADD COLUMN compositing_updated_by TEXT;
```

에피소드의 담당 컴포지터:
```sql
ALTER TABLE episodes ADD COLUMN compositor_user_id TEXT;
```

Realtime 채널 구독 시 새 컬럼 포함되도록 `supabaseService` 의 `loadScenes()` / 변경 핸들러 업데이트.

### 낙관적 업데이트 (기존 패턴 그대로)
1. 사용자가 상태 칩 클릭
2. zustand store 즉시 업데이트 (낙관적)
3. `supabaseService.updateSceneCompositingStatus(sceneUuid, newStatus, currentUserName)` 호출
4. 실패 시 토스트 + 이전 상태로 롤백
5. 다른 사용자의 변경은 Realtime 으로 ~100ms 안에 store 에 반영

---

## Design Tokens

본 디자인이 사용하는 토큰들. 모두 B flow 의 기존 `src/themes.ts` / `src/index.css` 체계와 호환되도록 정의했다.

### 기존 토큰 (그대로 사용)
- `--color-bg-primary | --color-bg-card | --color-bg-border`
- `--color-text-primary | --color-text-secondary`
- `--color-accent | --color-accent-sub | --color-on-accent`
- `--color-overlay (with --overlay-alpha)`
- `--color-shadow (with --shadow-alpha)`
- `--color-glass-tint | --color-glass-highlight`
- `--color-length-up | --color-length-down`
- Pretendard Variable 폰트 / `tabular-nums` 숫자

### 신규 토큰 (`src/index.css` 의 `:root` 와 `[data-color-mode="light"]` 양쪽에 추가 필요)

```css
:root {
  /* 컴포지팅 상태 (semantic) */
  --status-batch:      110 115 136;  /* 회색 — 작업 대기 */
  --status-combine:    116 185 255;  /* 파랑 — 조합 진행 중 */
  --status-aggregated: 162 155 254;  /* 액센트 서브 — 취합 완료 */
  --status-adjust:     253 203 110;  /* 노랑 — 보정 중 */
  --status-error:      225 112 85;   /* 주황 — 오류 */
  --status-done:       0 184 148;    /* 초록 — 완료 */

  /* 파트 라벨 컬러 (에피소드당 4 파트 가정 — 5+ 면 hue cycle) */
  --part-a: 225 112 85;    /* 시나몬 */
  --part-b: 245 168 90;    /* 앰버 */
  --part-c: 110 184 102;   /* 그린 */
  --part-d: 80 145 230;    /* 블루 */
}

[data-color-mode="light"] {
  --status-batch:      130 138 158;
  --status-combine:    38 120 215;
  --status-aggregated: 122 105 220;
  --status-adjust:     200 138 28;
  --status-error:      200 70 50;
  --status-done:       16 140 110;

  --part-a: 200 80 55;
  --part-b: 215 130 50;
  --part-c: 70 140 70;
  --part-d: 45 105 195;
}
```

Tailwind 확장 (`tailwind.config.js`):
```js
colors: {
  ...,
  status: {
    batch:      'rgb(var(--status-batch) / <alpha-value>)',
    combine:    'rgb(var(--status-combine) / <alpha-value>)',
    aggregated: 'rgb(var(--status-aggregated) / <alpha-value>)',
    adjust:     'rgb(var(--status-adjust) / <alpha-value>)',
    error:      'rgb(var(--status-error) / <alpha-value>)',
    done:       'rgb(var(--status-done) / <alpha-value>)',
  },
  part: {
    a: 'rgb(var(--part-a) / <alpha-value>)',
    b: 'rgb(var(--part-b) / <alpha-value>)',
    c: 'rgb(var(--part-c) / <alpha-value>)',
    d: 'rgb(var(--part-d) / <alpha-value>)',
  },
},
```

(기존 앱에 `STAGE_COLORS` 와 `SCENE_PHASE_COLORS` 가 있는데, 본 새 상태는 그 둘과 의미·전이가 다르다 — 컴포지팅 워크플로 전용으로 보고 별도 토큰으로 분리하는 게 맞다.)

### 스페이싱 / 라운드 / 그림자

| 사용처 | 값 |
|---|---|
| 카드 padding | `padding: 8 10 6` (헤더) / `0 10 6` (이미지 영역) / `6 10 8` (담당자) |
| 카드 radius | 10 (메인 카드) / 8 (이미지 분할 셀) / 6 (메모/안내 박스) / 999 (칩) |
| 카드 shadow (기본) | `0 2px 8px rgb(var(--color-shadow) / 0.25)` |
| 카드 shadow (호버) | `0 10px 26px shadow/0.45, 0 0 14px status/0.3` |
| 카드 shadow (pinned) | `0 18px 40px shadow/0.6, 0 0 28px status/0.55` |
| 모달 shadow | `0 30px 80px shadow/0.6, 0 0 42px status/0.35` |
| 타임라인 패널 radius | 8 |
| 칩 radius | 999 |
| 진행도 바 height | 3 (카드 안) / 6 (모달 안) |

### 모션

```css
--easing-out:    cubic-bezier(0.16, 1, 0.3, 1);
--easing-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```
- 카드 transform: 180ms `--easing-out`
- 진입 cascade: 560ms `--easing-out`, idx-stagger 28ms
- 타임라인 wipe-in: 800ms, 150~600ms 지연 (요소별)
- chevron rotate: 220ms `--easing-out`
- view mode 토글 컬러: 160ms
- glow pulse: 1.8~2s ease-in-out infinite

---

## Assets

- 본 디자인의 모든 썸네일 / 스토리보드 / 아이콘은 **인라인 SVG / data URI** 로 생성됨 (`mock-data.js` 의 `thumbnailsFor` 참고).
- 실제 앱에서는:
  - 가이드 이미지 = 기존 `scene.storyboardUrl`
  - 실제 컴포지팅 이미지 = 기존 `scene.guideUrl` (또는 새 `scene.compositedUrl` 필드 추가)
  - 두 이미지 모두 `drive-img://` 또는 Supabase Storage URL 사용
- 아이콘은 lucide-react 의 `clapperboard`, `film`, `grid`, `layers`, `square`, `check-square`, `sliders`, `alert-triangle`, `check`, `lock`, `unlock`, `eye`, `rotate-ccw`, `chevron-down`, `chevron-right`, `arrow-right`, `users` 등. (디자인의 `shared.jsx > Icon` 컴포넌트에 매핑 참고)

---

## Files

본 폴더의 파일들:

| 파일 | 역할 |
|---|---|
| `index.html` | 진입점. React 18 + Babel standalone. design-canvas 안에 시안 1 개 아트보드 마운트. Tweaks 패널(다크/라이트 · 액센트 · 컴포지터 권한 · 데이터 시드) |
| `tokens.css` | 토큰 변수 + 라이트 모드 오버라이드 + 진입/펄스 keyframes + 스크롤바 |
| `mock-data.js` | 결정적 PRNG 기반 에피소드 / 파트 / 씬 mock 데이터. BG·ACT 두 담당자 + 가이드/실제 두 SVG 이미지 생성 |
| `shared.jsx` | 공통 UI 키트: `Icon`, `StatusChip`, `StatusDot`, `AssigneeAvatar`, `PartBadge`, `ParticleBurst`, `useStaggerEntry`, `useMountKey`, `DashHeader`, `StatusLegend`, `ProgressBar`, `ViewModeToggle` |
| `variant-a.jsx` | **메인 — Timeline 모드 본문 + 시안 wrapper**. viewMode 가 matrix/cinema 면 B/C 컴포넌트로 위임 |
| `variant-b.jsx` | Matrix 모드 본문 |
| `variant-c.jsx` | Cinema 모드 본문 |
| `design-canvas.jsx` | 디자인 캔버스 스타터 (시안 비교 도구) — 프로덕션 코드와 무관 |
| `tweaks-panel.jsx` | Tweaks 패널 스타터 — 프로덕션 코드와 무관 |

브라우저에서 `index.html` 을 열면 그대로 작동 (외부 CDN: React 18.3.1 / Babel standalone 7.29.0 / Pretendard Variable).

---

## Implementation Plan (권장 순서)

1. **토큰 추가**: `src/index.css` 와 `tailwind.config.js` 에 위의 status / part 토큰 추가. 라이트 모드 오버라이드까지.
2. **데이터 모델**: `src/types/index.ts` 에 `CompositingStatus` 타입 + `Scene.compositingStatus` / `compositingErrorKind` / `compositingProgress` 추가. Episode 타입에 `compositor` 추가.
3. **Supabase 스키마**: 위의 SQL 적용. `supabaseService` 의 scenes/episodes 쿼리에 새 컬럼 포함. Realtime 핸들러 업데이트.
4. **Store**: `useCompositingDashboardStore` 신규 작성.
5. **공통 컴포넌트**: `src/components/compositing/` 폴더 신규. `StatusChip.tsx`, `StatusDot.tsx`, `PartBadge.tsx`, `ViewModeToggle.tsx`. (B flow 의 기존 패턴 따라 `cn()` + Tailwind 유틸로 변환)
6. **메인 뷰**: `src/views/CompositingDashboardView.tsx` 신규. 또는 기존 `CompositingView.tsx` 를 탭으로 분리해 "리비전" 과 "현황" 두 탭으로 만드는 것도 옵션.
7. **Timeline 모드 구현**: AE 타임라인 패널 (`TimeRuler`, `RamPreviewBar`, `WorkAreaBar`, `CompLayerRow`, `LayerPanel`) → 파트 카드 행 → SceneCard → 상세 모달. 각각 별도 파일.
8. **Matrix / Cinema 모드**: 같은 store / 같은 데이터 / 같은 SceneCard 부분 재사용.
9. **사이드바 진입점**: 기존 `Sidebar.tsx` 의 `compositing` 항목이 이미 있음. 새 뷰로 라우팅 추가.
10. **권한 / 낙관적 업데이트** 마지막에 통합.

---

## 알려진 제약 / 의사결정 사항

- **씬 수가 매우 많을 때 (40+)**: Timeline 모드의 타임라인 그래프는 파트 단위로만 그리므로 영향 없음. 카드 그리드만 길어진다. 가상화(virtuoso 등) 적용은 옵션이지만 4 파트 × 40 = 160 카드 정도까지는 그대로 가도 무방.
- **에피소드당 파트가 5+ 일 때**: `--part-a~d` 만으로는 부족. `mock-data.js` 의 `PARTS_DEF` 에서 색을 hue-cycle 로 자동 생성하는 방법 권장. 또는 `--part-e/f` 토큰 추가.
- **모달 안의 상태 변경 그리드**: 6 개 상태가 모두 보이지만, 실제 비즈니스 룰상 일부 전이는 제한될 수 있다 (예: `done` → `batch` 는 의도적 액션이 필요). 클릭 시 확인 모달 / 토스트 등 추가 처리 필요할 수 있음.
- **CTI 위치 계산식**: 현재 mock 은 "마지막 진행 위치" 로 정의했지만, 실제 앱에서는 "마지막 업데이트된 씬의 시간 위치" 또는 "오늘 작업 중인 씬" 등으로 정의 가능. PM 과 상의 후 결정.
- **다른 사용자 커서 / presence**: 본 디자인에는 "보는 중인 사람" 헤더 칩만 포함. 실시간 cursor / focus presence 가 필요하면 Liveblocks (기존 앱이 이미 사용 중) 통합 필요.

---

*디자인 작업: 2026-05-20 / Studio JBBJ B flow*
