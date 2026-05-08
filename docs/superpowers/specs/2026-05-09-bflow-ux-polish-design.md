# B flow UX 폴리싱 — 최근 작업 위젯 / 분석 모달 / 자간 미리보기 / 업데이트 모달 / 버전 호버

- 작성일: 2026-05-09
- 브랜치: `claude/gallant-galileo-b043f3`
- 대상 범위: 위젯 1종 확장 + 신규 모달 1종(분석) + 업데이트 모달 리디자인 + 설정 섹션 보완 + 사이드바 컴포넌트 1종
- PR 단위: **단일 PR** (v1.23.0 — 마이너)
- 시안 미리보기: `docs/superpowers/specs/mockups/2026-05-09-bflow-ux-polish/preview.html` (포트 5560)

---

## 1. 배경 & 목적

한솔(매니저)이 이미 운영 중인 B flow 대시보드 곳곳을 다듬는 작업. 기능 추가보다는 **이미 있는 화면을 더 잘 쓰게** 만드는 폴리싱이 핵심이다.

### 다섯 가지 문제

1. **최근 작업 위젯이 7일치만 보여 줌** — 더 긴 기간(달·년)을 보거나 특정 주차/월로 가서 회고하기 어렵다.
2. **씬 라벨이 `EP02 E #15` 같은 내부 표기** — 비개발자가 "어떤 에피소드의 어디"인지 직관적으로 못 읽는다.
3. **자간/줄간격 슬라이더에 미리보기가 없다** — 슬라이더만 있어 가독성 변화를 즉시 확인 못 한다.
4. **업데이트 내역 모달의 새로고침이 외형을 흔든다** + **버전 카드가 단조롭다** — PR 내역 흐름처럼 보기 좋게.
5. **좌하단 버전 버튼 호버가 브라우저 기본 `title`** — 좁은 사이드바(64px) 밖으로 텍스트가 삐져나온다.

### 목적

- 일·주·월·년 흐름을 **하나의 위젯에서** 넘나들게 한다 (단위 토글 + 화살표 + "오늘" 버튼).
- 분석은 **별도 모달**에 모아 위젯을 가볍게 유지한다.
- 자간/줄간격은 **즉시 단락 변화로** 결과를 보여준다.
- 업데이트/버전 영역은 **타임라인·floating 툴팁** 패턴으로 통일감.

---

## 2. 결정한 디자인 (요약)

| 영역 | 결정 | 근거/대안 |
|---|---|---|
| 시간 단위 | **주 / 달 / 년 토글** + 좌우 화살표 + "오늘"/"이번 주"/"이번 달"/"올해" 버튼 | 한솔 결정 (대안: 드롭다운 캘린더). 단위는 캘린더 단위(월~일, 1일~말일, 1/1~12/31). |
| 화살표 제한 | **다음 화살표는 현재 기간일 때 비활성** | 미래로 가지 못하게. UX 안전장치. |
| 씬 라벨 포맷 | `그림자국 · E · #15` (가운데점) | 한솔 결정 (대안: 하이픈, 더블 꺾임표). |
| 히트맵 셀 클릭 | **피드 자동 스크롤 + 노란 펄스 + 다른 행 dim + 상단 필터 배너** (재클릭 해제) | 단순 강조보다 명확. 빈 시간대도 "활동 없음" 메시지. |
| 분석 진입 | 위젯 헤더에 📊 **분석 버튼** 추가 | 한솔 결정 (대안: 인사이트 배너 클릭). |
| 분석 모달 카드 | **7개** (요일×월 종합 히트맵 / 씬→완료 흐름 / 담당자별 비중 / 단계별 도넛 / 에피소드별 진행 / 씬 Top 10 / 주별 완료 트렌드) | 한솔이 1차 3개 + 2차 1개 선정. |
| 자간 미리보기 | **슬라이더 아래 장문 한글 단락** + 기본값 마커 + "기본값 복원" 버튼 | 한솔 결정 (대안: 옆 샘플링 / 3단계 비교 카드). |
| 업데이트 모달 | **GitHub PR 타임라인** + **모달 높이 86vh 고정**, 내부만 스크롤 | 한솔 결정 (대안: 카드 유지 / Two-pane). 새로고침 시 외형 안 흔들림. |
| 버전 버튼 호버 | **사이드바 우측 floating 커스텀 툴팁** (브라우저 기본 `title` 대체) | 한솔 결정. 새 버전·현재 버전·빌드 시각·메시지를 한 번에. |

---

## 3. 시안별 상세

### 3.1 시안 ① — 최근 작업 위젯 확장

#### 헤더 변경
```
[Activity icon] 최근 작업    [◀] 이번 주 (5/4–5/10) [▶] [오늘]    [주|달|년]    [📊]    [팝아웃]
```

- **단위 토글** (`주 / 달 / 년`): 기존 `히트맵 / 시간대 / 요일` 모드 토글을 대체.
  - 히트맵/막대 모드는 단위(주/달/년)에 따라 데이터 표현이 자동 적응 (3.1.4 참조).
  - 마지막 선택 단위는 `localStorage` 저장 (`bflow_activity_time_unit`).
- **좌우 화살표** (`◀ ▶`):
  - 단위가 `주`면 한 주씩, `달`이면 한 달씩, `년`이면 한 해씩 이동.
  - **다음 화살표(▶)는 현재 기간(`rangeIdx===0`)일 때 disabled** + opacity 0.25, cursor not-allowed.
  - 이전(◀)에는 제한 없음 (1년 보존 한계까지). 활동이 없는 기간으로 가도 빈 상태 표시.
- **"오늘"/"이번 주"/"이번 달"/"올해" 버튼**:
  - `currentRangeIdx > 0`일 때만 노출.
  - 라벨은 단위에 따라: `주 → "이번 주"`, `달 → "이번 달"`, `년 → "올해"`.
  - 클릭 시 `rangeIdx = 0`으로 즉시 복귀 + 토스트 `"이번 주(으)로 이동했어요"`.
- **분석 버튼** (📊): 클릭 시 분석 모달(§3.2) 오픈.

#### 라벨 포맷 (3.1.2)
- `formatActivitySceneLabel(sceneLabel, episodeNumber, episodeTitles)`을 수정해 출력만 변경 (DB 저장값 `EP02 E #15`은 유지).
- 출력: `에피소드 제목 · 파트ID · #컷번호` — 가운데점(U+00B7) 구분자.
- 에피소드 제목이 없으면 `EP02 · E · #15`으로 폴백.
- CSS는 `.scene-chip` 칩 형태(연한 보라 배경, 보라 텍스트, 가운데점은 더 흐리게).

#### 시간 범위 정의 (3.1.3)
| 단위 | rangeIdx 0 | rangeIdx 1 | … |
|---|---|---|---|
| 주 | 이번 주 (월~일) | 지난 주 | 2주 전 … |
| 달 | 이번 달 (1일~말일) | 지난 달 | 3월 … |
| 년 | 올해 (1/1~12/31) | 작년 | 2024년 … |

- KST 기준. `Asia/Seoul` 타임존으로 변환 후 단위별 경계 계산.
- `rangeIdx`는 0부터 시작하며 위젯 마운트 시 항상 0으로 리셋 (저장하지 않음 — 위치까지 기억하면 복귀 시 혼란).

#### 데이터 표현 (3.1.4)
| 단위 | 히트맵 | 시간대 막대 | 요일 막대 |
|---|---|---|---|
| 주 (현행) | 7요일 × 24시간 (1주치) | 24시간 합산 | 7요일 합산 |
| 달 | 7요일 × 24시간 (해당 월 평균/합) | 24시간 합산 | 7요일 합산 |
| 년 | 12개월 × 7요일 (대형) | 12개월 합산 (월별 막대) | 12개월 합산 |

- 막대/히트맵 컴포넌트는 `mode` prop을 받아 단위 차이를 흡수.
- 서버 RPC `activity:stats` 시그니처 확장:
  - 기존: `{ days?: number, department?, groups? }` → `{ rangeStart: ISO, rangeEnd: ISO, granularity: 'hour-of-day-x-dow' | 'month-x-dow', department?, groups? }`
  - granularity에 따라 `GROUP BY` 절을 변경.

#### 셀 클릭 인터랙션 (3.1.5)
- 셀 클릭 → `applyCellFilter(day, hour)` 호출:
  1. 셀에 `selected` 클래스 부여 (노란 outline + glow).
  2. `feedList.classList.add('filter-active')` → CSS로 매칭 안 된 행 opacity 0.30.
  3. 매칭 행에 `highlight` 클래스 → 노란 좌측 보더 + 1.6초 펄스 ×3.
  4. 첫 매칭 행 `scrollIntoView({behavior:'smooth', block:'center'})`.
  5. 피드 상단에 노란 배너: `🔆 [화 14시] 활동만 강조 중 · 5건 [전체 보기]`
  6. 매칭 0건 → 배너 메시지 `· 이 시간대엔 활동이 없어요`, 셀만 selected (피드는 그대로 dim).
- 같은 셀 재클릭 → `clearCellFilter()`.
- 다른 셀 클릭 → 새 필터로 자동 교체.
- 시간 단위/기간 변경 시 → 필터 자동 해제.
- "전체 보기" 버튼 → `clearCellFilter()`.

#### 인사이트 배너 (3.1.6)
- 자동 산출 문구 (단위 + rangeIdx별):
  - `주 idx=0`: "이번 주 가장 활발: {요일} {N}–{N+2}시 ({합계}건)"
  - `주 idx>0`: "{rangeLabel} 정점: {요일} {N}–{N+2}시 ({합계}건)"
  - `달 idx=0`: "5월 정점: {요일1}·{요일2} {N}–{N+2}시 (전체 {%}%)"
  - `년 idx=0`: "{year}년 BG 활발 시기: {months}, 액팅: {months}" (부서 모드별)
- 데이터 < 20건이면 폴백: "기록을 모으는 중입니다".

---

### 3.2 시안 ② — 활동 분석 모달

#### 진입
- 위젯 헤더 📊 버튼.
- 모달은 `max-w-[1080px] max-h-[88vh]`, 모달 헤더에 기간 셀렉트(`최근 1년 / 최근 6개월 / 최근 3개월`).

#### 카드 7종 (1080px 폭에서 2-column 그리드 + 일부 full-width)

| # | 카드 | 차트 | 데이터 | 자동 인사이트 |
|---|---|---|---|---|
| 1 | **요일×월 종합 히트맵** (full) | 12개월 × 7요일 격자 | `GROUP BY EXTRACT(month), EXTRACT(dow)` | "BG 정점: 4–6월 화·수, 액팅: 9–11월 목" |
| 2 | **씬 생성 → 완료 평균 소요** (col) | 가로 막대 5단계 (씬 추가→LO→완료→검수→PNG) | 씬별 단계 첫 도달 timestamp의 평균 차이 | "평균 9.2일 — LO~완료가 병목" |
| 3 | **담당자별 활동 비중** (col) | 가로 막대 (상위 5명 + 기타) | `GROUP BY user_id ORDER BY count DESC LIMIT 5` | "총 1,079건 — 한솔·민수가 49%" |
| 4 | **단계별 작업 비중** (col) | SVG 도넛 + 범례 | `GROUP BY action_type WHERE action_type LIKE 'stage_%'` | "LO·완료가 60% — 후반 단계는 적음" |
| 5 | **에피소드별 완성도 + 활동량** (col) | 진행률 바 + 우측 활동 건수 | `episodes` 테이블 + `activity_log` join | "EP02가 가장 활발 — 진행률은 EP01 앞섬" |
| 6 | **작업이 많이 손이 가는 씬 Top 10** (col) | 순위 리스트 (씬 라벨 + 리비전/메모/단계 미니 카운트) | `GROUP BY scene_id ORDER BY count DESC LIMIT 10` | "상위 2개 빨강 — 평균 2배 이상" |
| 7 | **주별 완료 씬 수 트렌드** (full) | 12주 막대 차트 + 4주 평균선 | 주별 PNG 단계 도달 씬 수 | "이번 주 18개 — 4주 평균 대비 +29%" |

#### 색 규칙
- 단계 색은 기존 토큰: `LO #74B9FF / 완료 #A29BFE / 검수 #FDCB6E / PNG #00B894`.
- 정점/강조는 `#FDCB6E` 노란 그라데이션.
- "작업 많이 손이 가는 씬" Top 1, 2는 `#FF7675` 빨강 강조.
- 일반 막대/히트맵 강도는 `--color-accent` (테마 색상 따라감).

#### 새 IPC / RPC
- `activity:insights` (신규) — 1년치 분석 데이터를 한 번에 가져오는 RPC. 7개 카드의 raw data를 묶어서 반환:
  ```ts
  type InsightsResponse = {
    monthDowGrid: Array<{month: 1..12, dow: 0..6, count: number}>,
    sceneFlow: { avgLo: number, avgDone: number, avgReview: number, avgPng: number },
    userBreakdown: Array<{userId, userName, count}>,
    stageBreakdown: { lo: n, done: n, review: n, png: n },
    episodeProgress: Array<{episodeNumber, title, pctPng, activityCount}>,
    topScenes: Array<{sceneId, sceneLabel, total, revCount, memoCount, stageCount}>,
    weeklyCompleted: Array<{weekStart: ISO, completedSceneCount: number}>,
  }
  ```
- 한 번에 묶어 반환하여 모달 진입 시 단일 RPC 호출. 응답 캐시 60초.

---

### 3.3 시안 ③ — 자간/줄간격 미리보기

#### 변경 전
- `SpacingSection` 슬라이더 2개 + 하단 한 줄 안내.

#### 변경 후
- 슬라이더 2개는 그대로.
- **각 슬라이더 위에 기본값 마커**:
  - 줄간격 슬라이더: 트랙 위 작은 보라 세로선 + `기본 1.55` 라벨 (1.55의 비율 위치).
  - 자간 슬라이더: 트랙 위 보라 세로선 + `기본 0` 라벨 (0의 비율 위치).
- **슬라이더 아래 미리보기 영역** 추가:
  - 라벨: "미리보기"
  - 박스: 점선 테두리 (`border-dashed`), 어두운 배경, 한글 8~10줄 장문 단락.
  - 단락 텍스트는 실제 메모/리비전 노트 톤 ("EP02 그림자국 · E파트 #15 메모 — 캐릭터 시선이 카메라를 따라가야…").
  - `style.lineHeight`/`style.letterSpacing`을 슬라이더와 동기화 (기존 `applySpacing` 함수 그대로 활용).
- **"기본값 복원" 버튼**은 기존 위치 유지 (제목 우측). 둘 중 하나라도 기본값과 다르면 노출.
- 박스 아래 한 줄 안내 유지: "조정 즉시 위 단락의 줄간격과 자간이 바뀝니다…"

---

### 3.4 시안 ④ — 업데이트 모달 (PR 타임라인)

#### 변경 전 (`UpdateCenterModal.tsx`)
- 상단 카드 2개 (현재 / 최신) + 아래 카드형 release note 리스트.
- `min-h-[210px]` 노트 영역이 있지만 모달 외곽 자체는 콘텐츠 길이에 따라 변동 → 새로고침 시 흔들림.

#### 변경 후
- **모달 외곽 높이를 `86vh` 고정**, `flex flex-col`로 구성.
- 영역 분할:
  1. **헤더** (shrink-0): 제목 + "마지막 확인 시각" + 새로고침 + 닫기.
  2. **상단 카드 2개** (shrink-0): 현재 사용 중 / 준비된 최신 버전 (기존과 동일). 카드 자체는 `min-h` 고정.
  3. **세로 구분선** + 타이틀 행 (shrink-0): "버전별 업데이트 내역" + "이전 N개 더 보기" 토글.
  4. **타임라인 영역** (`flex-1 overflow-y-auto`): PR 타임라인 본체.
- **PR 타임라인 스타일**:
  - 좌측에 점·연결선 (`.pr-rail::before`로 그림): 보라 그라데이션 라인, 위는 진하고 아래로 갈수록 흐려짐.
  - 각 버전마다 점(`.pr-node`):
    - 최신: 보라 그라데이션 fill + 흰 체크 아이콘 + glow.
    - 과거: 보더 only, 안에 버전 순번 숫자.
  - 점 우측에 카드: 제목 / 날짜 / `v버전` 칩 / 변경 사항 ul.
  - 최신 카드는 보라 보더 + 옅은 보라 배경 + `LATEST` 배지.
  - 과거 카드는 일반 보더 + 어두운 배경.
- **"이전 버전 더 보기" 토글**:
  - 기본 3개 노출.
  - 클릭 시 전체 노출 + 라벨 "이전 버전 접기".
  - 시안에서는 6개 더미; 실제는 `update-notes.json`의 모든 항목.
- **새로고침 동작**:
  - 회전 애니메이션 (icon `animate-spin`).
  - 응답 도착하면 `lastCheckedAt`만 갱신, 모달 외형은 그대로 유지.
  - 응답이 빈 release note일 때도 폴백 카드("업데이트 내역 확인")를 채워서 타임라인 영역이 비지 않게.
  - 토스트로 결과 안내 ("최신 상태로 갱신했습니다 ─ 모달 크기는 변하지 않았어요").

#### 데이터
- `update-notes.json` 형태 유지 (`Array<{version, title, items}>`).
- 새로 추가되는 props/state는 없음. 외형 변경만.

---

### 3.5 시안 ⑤ — 버전 호버 툴팁

#### 변경 전 (`Sidebar.tsx`)
- 좌하단 `<button>` 에 `title={versionButtonTitle}` (브라우저 기본 툴팁).
- 텍스트가 길면 사이드바 64px 폭 밖으로 삐져나감.

#### 변경 후
- `<button>`에서 `title` 제거.
- 부모 `<div class="relative">` + 자식 `<div class="floating-tip">` 패턴.
- 호버 (mouseenter, 250ms 지연) → 우측 floating 툴팁:
  - 위치: `position:absolute; left:calc(100% + 12px); top:50%; transform:translateY(-50%)`.
  - 좌측 화살표 (CSS `::before`로 보더 색 삼각형).
  - 너비: `min-width:240px; max-width:300px`.
  - 배경: `rgba(26,29,39,0.97)` + 보더 + 그림자.
- 툴팁 내부:
  - 라벨 키 (대문자 작은 텍스트): 상태별 — `최신 상태` / `새 버전 v1.23.0 준비됨` / `업데이트 실패` / `자동 업데이트 중단됨`.
  - 본문 1~2줄: 상태 설명.
  - 행 3개: `현재 버전 / 준비된 버전 / 빌드 시각` (mono 폰트).
- 상태별 색:
  - 최신: 무채색.
  - 새 버전: 보라 + 라벨 `새 버전`.
  - 실패/중단: 노란 (`#FDCB6E`).
- 클릭 시 기존 동작 유지 (업데이트 모달 오픈).
- 마우스 leave 시 즉시 사라짐.

---

## 4. 구현 단계 (PR 분할 X — 단일 PR)

| # | 단계 | 파일 | 비고 |
|---|---|---|---|
| 1 | 라벨 포맷 | `src/components/widgets/activity/feedNavigation.ts` | `formatActivitySceneLabel`/`formatActivityGroupLabel`만 수정 |
| 2 | 위젯 헤더 (시간 토글 + 화살표 + 오늘 + 분석 버튼) | `src/components/widgets/RecentActivityWidget.tsx` | `ModeToggle` → `TimeUnitToggle` 교체 |
| 3 | 시간 단위 store 확장 | `src/stores/useActivityStore.ts` | `timeUnit`, `rangeIdx`, `setTimeUnit`, `setRangeIdx`, `goToCurrent` 추가 |
| 4 | 셀 클릭 필터 배너 + dim | `src/components/widgets/RecentActivityWidget.tsx`, `ActivityFeed.tsx`, `GoldenHeatmap.tsx` | `cellFilter` 상태 + 배너 컴포넌트 |
| 5 | 시간 단위별 데이터 페치 | `electron/supabase.ts`, `electron/main.ts` | `activity:stats` 시그니처 확장 (`rangeStart`/`rangeEnd`/`granularity`) |
| 6 | 분석 모달 본체 + 7개 카드 | `src/components/widgets/activity/ActivityInsightsModal.tsx` (신규), 카드 컴포넌트 7개 | 도넛 SVG 직접 그리기 (chart 라이브러리 없음) |
| 7 | 인사이트 RPC | `electron/supabase.ts`, Supabase SQL 마이그레이션 | `record_activity_insights()` RPC 신설 |
| 8 | 자간 미리보기 | `src/components/settings/SpacingSection.tsx` | 기본값 마커 + 미리보기 박스 추가 |
| 9 | 업데이트 모달 PR 타임라인 | `src/components/update/UpdateCenterModal.tsx` | 외곽 86vh 고정 + 타임라인 컴포넌트 |
| 10 | 버전 호버 floating 툴팁 | `src/components/layout/Sidebar.tsx` (또는 신규 `VersionHoverTip.tsx` 분리) | `title` 제거, custom div |
| 11 | 위젯 등록 명칭 | (변경 없음 — `recent-activity` widget id 유지) | - |

---

## 5. SQL 마이그레이션

### 5.1 신규 RPC: `get_activity_stats_v2`

기존 `get_activity_stats(p_days int, ...)` 대신 `(rangeStart timestamptz, rangeEnd timestamptz, granularity text, ...)` 시그니처 추가.

```sql
CREATE OR REPLACE FUNCTION get_activity_stats_v2(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_granularity text,                       -- 'hour-of-day-x-dow' | 'month-x-dow'
  p_department text DEFAULT NULL,
  p_groups text[] DEFAULT NULL
) RETURNS TABLE (bucket1 int, bucket2 int, total int, count_progress int, count_memo int, count_scene int, count_etc int)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_granularity = 'hour-of-day-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(dow FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket2,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;
  ELSIF p_granularity = 'month-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        EXTRACT(dow FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket2,
        COUNT(*)::int, ...
      ...
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_activity_stats_v2(...) TO anon, authenticated;
```

기존 `get_activity_stats`는 호환성 유지를 위해 한 버전만 더 유지 (사용처 없으면 다음 PR에서 제거).

### 5.2 신규 RPC: `get_activity_insights`

분석 모달 7개 카드를 한 번에 채우는 RPC.

```sql
CREATE OR REPLACE FUNCTION get_activity_insights(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_department text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- 1. monthDowGrid
  v_result := v_result || jsonb_build_object('monthDowGrid', (
    SELECT jsonb_agg(jsonb_build_object('month', m, 'dow', d, 'count', c))
    FROM (
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS m,
        EXTRACT(dow FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS d,
        COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY m, d
    ) t
  ));
  -- 2. sceneFlow / 3. userBreakdown / 4. stageBreakdown / 5. episodeProgress / 6. topScenes / 7. weeklyCompleted ...
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION get_activity_insights(...) TO anon, authenticated;
```

각 절은 별도 CTE 또는 인라인 서브쿼리로 작성. 모든 카드 데이터를 단일 jsonb로 묶어 IPC 1회로 모달 채우기.

### 5.3 마이그레이션 파일

- `DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql` 신설.
- `DEVLOG/supabase-init.sql`에도 동일 함수 추가 (재실행 안전성).

---

## 6. 변경 파일 목록

| 파일 | 변경 |
|---|---|
| `src/components/widgets/RecentActivityWidget.tsx` | 헤더(시간 토글/화살표/오늘/분석) + 모달 오픈 핸들러 |
| `src/components/widgets/activity/ActivityFeed.tsx` | 셀 필터 배너, dim 모드, 라벨 표시 형식 (chip 적용) |
| `src/components/widgets/activity/GoldenHeatmap.tsx` | 셀 selected 표시 강화, 단위에 따른 헤더 라벨 |
| `src/components/widgets/activity/GoldenBarChart.tsx` | 단위(주/달/년) 별 막대 mode 분기 |
| `src/components/widgets/activity/feedNavigation.ts` | 라벨 포맷 변경 (가운데점) |
| `src/components/widgets/activity/utils.ts` | 시간 단위 헬퍼 추가 (`getRangeBoundary`, `incrementRange`) |
| `src/components/widgets/activity/ActivityInsightsModal.tsx` | **신규** — 분석 모달 |
| `src/components/widgets/activity/cards/*.tsx` | **신규** — 7개 카드 컴포넌트 |
| `src/components/settings/SpacingSection.tsx` | 미리보기 박스 + 기본값 마커 |
| `src/components/update/UpdateCenterModal.tsx` | PR 타임라인 + 86vh 고정 |
| `src/components/layout/Sidebar.tsx` | 버전 버튼 호버 floating 툴팁 |
| `src/components/layout/VersionHoverTip.tsx` | **신규** — floating 툴팁 컴포넌트 (분리 권장) |
| `src/stores/useActivityStore.ts` | `timeUnit`, `rangeIdx`, `cellFilter`, `goToCurrent`, `applyCellFilter` 추가 |
| `src/services/supabaseService.ts` | `getActivityInsights`, `getActivityStatsV2` 래퍼 |
| `electron/supabase.ts` | 동일 함수 추가 |
| `electron/main.ts` | IPC `activity:stats` (확장), `activity:insights` (신규) |
| `electron/preload.ts` | electronAPI에 `getActivityInsights` 추가 |
| `src/types/index.ts` | `TimeUnit`, `CellFilter`, `ActivityInsights` 타입 추가 |
| `DEVLOG/supabase-init.sql` | RPC 2종 추가 |
| `DEVLOG/migrations/2026-05-09-activity-stats-v2-and-insights.sql` | **신규** |
| `package.json` | 1.22.20 → 1.23.0 |
| `DEVLOG/update-notes.json` | v1.23.0 항목 추가 |

---

## 7. 테스트 전략

### 7.1 단위 테스트
- `getRangeBoundary(unit, idx)`: 주/달/년 각각 idx=0/1/2일 때 KST 경계 정확성.
- `incrementRange(unit, idx, dir)`: 화살표 동작.
- `formatActivitySceneLabel`: EP 접두 교체 + 가운데점 분리.
- `applyCellFilter` / `clearCellFilter`: store 상태 + dim 클래스.

### 7.2 수동 통합 테스트
- 단위 토글 주→달→년→다시 주: 데이터·라벨 일치.
- 화살표 ◀ 무한 누름: 활동 없는 옛 기간에서 빈 상태 표시.
- 화살표 ▶: 현재 기간에서 disabled 확인.
- "오늘" 버튼: 단위별 라벨, 누르면 idx=0.
- 셀 클릭 → 필터 → 같은 셀 클릭 → 해제.
- 셀 클릭 → 다른 셀 클릭 → 새 필터로 교체 (이전 highlight 해제).
- 시간 단위 전환 시 셀 필터 자동 해제.
- 분석 모달 진입 → 7개 카드 모두 데이터 채워짐.
- 분석 모달 기간 셀렉트 변경 → RPC 재호출 → 카드 업데이트.
- 자간/줄간격 슬라이더 조작 → 미리보기 단락 즉시 변동, 기본값 마커 위치 정확.
- 자간 기본값 = 0 정확히 클릭 → "기본값 복원" 버튼 사라짐.
- 업데이트 모달 새로고침 5회 연타: 외곽 크기 변동 X, 마지막 확인 시각만 갱신.
- 업데이트 모달 release note 12개 → 3개 표시 → 펼치기 → 12개 모두 보임.
- 버전 버튼 호버 (250ms 후 툴팁) → 마우스 떠남 → 즉시 사라짐.
- 버전 버튼 클릭 → 업데이트 모달 오픈 (기존 동작 유지).

### 7.3 빌드 검증
- `npm run typecheck`
- `npm run build:vite`
- `npm run test:auto-update`

---

## 8. 마이그레이션 / 배포

- DB 변경: RPC 2종 신설. 다운타임 0.
- 기존 컴포넌트 자리 유지 — widget id `recent-activity` 그대로, 기존 사용자 layout.json 재사용.
- 기존 `get_activity_stats` 호출처 (electron/supabase.ts에 1곳)를 `get_activity_stats_v2`로 교체. 본 PR에서 같이.
- `update-notes.json`에 v1.23.0 항목 추가 (변경 사항 목록).
- 배포 절차: 한솔 워크플로우 (`npm run build` → BFLOW-Setup.exe + manifest 갱신 → G드라이브 동기화). CLAUDE.md 자동 업데이트 원칙 준수 (manifest는 빌드 파일 모두 올린 뒤 마지막에).

---

## 9. 결정 이력 (Q&A 요약)

브레인스토밍 라운드에서 결정된 핵심들:

1. **시간 탐색 UI**: 단위 토글(주/달/년) + 좌우 화살표 (드롭다운 캘린더 / 조합형 중)
2. **히트맵 클릭**: 피드 자동 스크롤 + 하이라이트 (우측 슬라이드 패널 / 모달 중)
3. **데이터 분석 깊이**: 별도 활동 분석 모달 형태 (자동 인사이트 텍스트만 / 위젯 안 미니 / 별도 페이지 중)
4. **씬 라벨 포맷**: `그림자국 · E · #15` 가운데점 (하이픈 / 더블꺾임표 중)
5. **자간 미리보기**: 슬라이더 아래 장문 단락 (옆 샘플링 / 3단계 비교 카드 중)
6. **업데이트 모달**: GitHub PR 타임라인 (기존 카드 유지 / Two-pane 중)
7. **새로고침 안정**: 모달 높이 86vh 고정 + 내부 스크롤 (자유 + 트랜지션 / 스켈레톤 fade 중)
8. **시간 단위 정의**: 캘린더 단위 (롤링 N일 단위 중)
9. **분석 모달 진입**: 위젯 헤더 분석 버튼 (인사이트 배너 클릭 / 둘 다 중)
10. **분석 카드 1차**: 1년치 종합 히트맵 / 씬→완료 흐름 / 담당자별 비중 (한솔 다중 선택)
11. **버전 호버 툴팁**: 사이드바 우측 floating (말풍선형 중)
12. **추가 인사이트 1차** (피드백 후): 단계별 도넛 / 에피소드별 진행 / 씬 Top 10 (4개 후보 중 3개)
13. **추가 인사이트 2차**: 주별 완료 씬 트렌드 1개만 추가 (BG vs 액팅 / 이상 패턴 감지 빠짐)
14. **인터렉션 보완**: 화살표/토글 변경 시 데이터 함께 변동 + "오늘" 버튼 + 다음 화살표 disabled + 셀 클릭 필터 배너 (한솔 피드백 반영)

---

## 10. 후속 작업 (out of scope)

- BG vs 액팅 부서 비교 추이 (한솔이 2차에서 빼기로 결정 — 추후 v2 후보)
- 이상 패턴 감지 (급증/급감일 자동 표시) — 추후 v2 후보
- 분석 모달에서 카드 클릭 시 상세 페이지 (현재는 카드 내부에서 인사이트만)
- 분석 모달 데이터 CSV/엑셀 내보내기
- 사람별 골든타임 카드 (활동 위젯 v2 후보로 기존 스펙에서 언급)
- Supabase Auth 도입 시점에 RPC 신뢰 모델 강화

---

*이 사양서가 OK이면 다음 단계로 `writing-plans` 스킬을 호출해 단계별 구현 계획서를 만든 뒤 코드 수정에 들어갑니다.*
