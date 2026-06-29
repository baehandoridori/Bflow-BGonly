# 나의 할일 위젯 재설계 — 디자인 & 구현 스펙

> **작성**: 2026-06-28 | **확정 디자인**: 시안 15 (목업 `.superpowers/brainstorm/879-1782563792/concept-15-r2.html`)
> **상태**: 디자인 확정, 구현 대기. 미결정 3건(§5) 확인 후 착수.

---

## 1. 배경 & 목표

Studio JBBJ 팀은 캘린더/마감 날짜를 거의 쓰지 않는다(컷에 날짜를 일일이 입력하지 않음). 따라서 '나의 할일' 위젯은 **시간 관리 도구가 아니라 작업(씬) 파악·진행·활용 도구**여야 한다.

- 정렬/그룹/필터: **에피소드·진행단계 기준** (진행률·날짜 제외)
- 위젯은 **대시보드 카드 + 작은 플로팅 팝업** 두 컨텍스트에서 동작
- 핵심 가치: 내 씬을 한눈에 보고 → 정리 → 진행 파악 → 빠르게 완료 → 작업으로 진입

---

## 2. 확정 디자인 (시안 15)

- **상단**: 컴팩트 도넛(4색 진행률) + "오늘 N개 완료" 피드백 + 접으면 한 줄 strip
- **개인 할일**: 박스형 묶음 + 리스트 최상단. 동그라미 체크(Success Check 링→체크 애니메이션 #00B894, 호버 글로우, 클릭 spring, 완료 시 링버스트/콘페티, 퇴장). 클릭 → 상세 모달(연계자/메모 @멘션·#태그)
- **씬(컷)**: 왼쪽 동그라미 없음. 4단계 칩(LO/완료/검수/PNG)이 진행 표시이자 클릭 토글(**순차 규칙** `buildSequentialStagePatch`). 현재 단계 미니라벨(n/4). "다음 X"·본인 이름 표기 없음. 클릭 → 상세 모달(4단계 가로 일렬 + 이미지 + 메모)
- **빠른 추가**: + 버튼 → 입력칸 슬라이드 → `a001` 등 씬 자동완성(에피소드 구분·내 담당 표시·키보드 ↑↓) / 일반 텍스트는 개인 할일로(일정 없이)
- **리스트 ⇄ 카드 뷰** 토글. 카드 이미지: 가이드>스보>없음
- **컨텍스트 토글**: 윈도우 팝업이면 씬 클릭 시 본체 전체 상세 모달, 대시보드면 위젯 내 상세/이동
- **모션**: stagger 진입·자성 호버·완료 축하·도넛 카운트업·뷰 크로스페이드 (`prefers-reduced-motion` 가드)

---

## 3. 구현 블루프린트 (요약)

### 파일 구조 (모듈 분리)
```
src/components/widgets/my-tasks/
├── MyTasksWidget.tsx          진입점
├── hooks/
│   ├── useMyTasksData.ts      데이터 로드/저장/동기화 (기존 본체 1016~1832줄 이동)
│   └── useAllEpisodesFlat.ts  전체 에피소드 flat (★EP 필터 버그 우회)
├── components/
│   ├── DonutHero.tsx · QuickAdd.tsx · TodoRow.tsx · SceneRow.tsx · SceneCard.tsx
│   ├── TodoDetailModal.tsx · SceneDetailModal.tsx  (둘 다 createPortal)
└── types.ts
```
기존 `MyTasksWidget.tsx`는 배럴 re-export로 두어 import 경로 보존.

### 분석 68건 중 함께 반영
1. **모달 포털화** — `createPortal(document.body)` + 뷰포트 반응형 + ESC/포커스트랩/role=dialog (작은 팝업 잘림 해소)
2. **씬 이동** — 행/모달에 `navigateToSceneView` 연결. 팝업은 신규 IPC `widget:navigate-main`(기존 `feedback:jump-to-scene` 패턴 재사용)으로 메인 창 라우팅
3. **데이터 스코핑 버그** — `useDashboardEpisodes`(EP 모드서 타 EP 내 씬 증발) 사용 중단 → `useAllEpisodesFlat`로 전체 구독
4. **모듈 분리** — 위 파일 구조
5. **저장 실패 토스트 + 롤백** (sonner)
6. **assigned/custom 분기 복붙 → 단일 추상화**

### 단계별 구현 순서 (PR 단위, 위험 낮은 것부터)
- **PR 1 — 파일 분리 + 데이터 소스 수정** (기능 변화 없음, EP 스코핑 버그만 수정)
- **PR 2 — 모달 포털 분리 + 씬 이동 IPC** (팝업 잘림 해소 + 씬 이동 작동)
- **PR 3 — 새 헤더/QuickAdd/DonutHero** (상단 UI 교체)
- **PR 4 — 씬/할일 행 + 카드 뷰** (리스트 아이템 전면 교체 + 카드 뷰)
- **PR 5 — 모션 마무리 + reduced-motion 가드**

각 PR은 `typecheck + build:vite` 통과 + 독립 배포 가능.

### 기술 리스크 (개발자 주의)
- 신규 IPC(`widget:navigate-main`): preload+main+types 동시 수정, 팝업→메인 show/focus 타이밍
- QuickAdd 자동완성 드롭다운: 위젯 경계 넘는 fixed 위치 + 뷰포트 클램프
- `_externalDepth` 카운터: 훅 추출 시 useRef로, StrictMode 이중 실행 주의
- 성능: `useAllEpisodesFlat`이 전체(씬 1225+) 구독 → useMemo 의존성 episodes 참조로 한정
- 카드 썸네일: `imageUrl`(Storage) / `drive-img://` 이원화 + 가이드>스보 우선순위

---

## 4. 도메인 규칙 (구현 시 준수)

- 단계 체크는 BG·액팅 둘 다 **순차** (`SEQUENTIAL_STAGE_ORDER` lo→done→review→png). 부서 라벨만 다름(BG: LO/완료/검수/PNG, 액팅: 대기/작업중/피드백/완료)
- 액팅 피드백 요청/대기 흐름은 **이번 위젯엔 미반영**(한솔 결정). 위젯의 단계 칩은 BG식 순차 토글만.

---

## 5. 확정 사항 (2026-06-28 한솔)

- **A. 커스텀 뷰(탭) → 제거.** TabBar 및 custom 뷰 로직 전체 삭제. `assigned`(내 할일) 단일 뷰만 남김 → `assigned/custom` 분기 복붙이 통째로 사라져 `useMyTasksData`가 크게 단순해짐.
- **B. 개인 할일 날짜·캘린더 연동 → 상세 모달로 이동.** 메인 리스트 행에는 날짜/캘린더 미노출. `TodoDetailModal` 안에서만 날짜·캘린더 연동 토글 제공. (연동 로직·calendarService 동기화는 유지, 위치만 모달로)
- **C. 씬 메모 편집 → 상세 모달에서만.** `SceneRow`의 더블클릭 인라인 편집 제거. 메모 편집은 `SceneDetailModal`에서만(@멘션·#태그 지원).

→ 위 확정 반영해 `writing-plans`로 PR 1부터 상세 구현 계획 작성.
