# CONTEXT.md — B flow 세션 컨텍스트 가이드

> **용도**: 새 Claude 세션이 이 레포에서 작업할 때 빠르게 파악하기 위한 가이드.
> **최종 갱신**: 2026-02-24
> **반드시 함께 읽을 문서**: `CLAUDE.md` (필수 규칙), `ROADMAP.md` (전체 개발 계획)

---

## 1. 이 프로젝트가 뭔가?

**B flow**는 Studio JBBJ(애니메이션 스튜디오, ~20명)의 **프로덕션 진행 현황 대시보드**.
에피소드별 BG(배경)/액팅 씬의 진행 상황을 실시간 추적하는 **Electron 데스크탑 앱**이다.

```
사용자가 하는 일:
  1. 앱을 켜놓고 작업 (슬랙처럼 항상 띄워둠)
  2. 자기 담당 씬의 체크박스(LO/완료/검수/PNG)를 토글
  3. 다른 사람의 진행 상황을 대시보드에서 확인
  4. 에피소드/파트/씬을 추가/삭제/아카이브
```

---

## 2. 아키텍처 한눈에 보기

```
┌─ Electron 앱 ─────────────────────────────────────────────────┐
│                                                                │
│  ┌─ 렌더러 (React + Zustand) ──────────────────────┐          │
│  │  Views: ScenesView, Dashboard, EpisodeView, ...  │          │
│  │  Stores: useDataStore, useAppStore               │          │
│  │  Services: sheetsService.ts (IPC 래퍼)           │          │
│  └──────────────┬───────────────────────────────────┘          │
│                 │ IPC (preload.ts)                              │
│  ┌──────────────▼───────────────────────────────────┐          │
│  │  메인 프로세스 (electron/main.ts)                  │          │
│  │  └─ sheets.ts: gasFetch() → HTTP 요청             │          │
│  └──────────────┬───────────────────────────────────┘          │
└─────────────────┼──────────────────────────────────────────────┘
                  │ HTTP (GET/POST)
    ┌─────────────▼─────────────────┐
    │  Google Apps Script (Code.gs) │
    │  (스프레드시트에 바인딩됨)      │
    └─────────────┬─────────────────┘
                  │
    ┌─────────────▼─────────────────┐
    │  Google Sheets (데이터 SSOT)   │
    │  시트 이름: EP01_A_BG, EP01_A_ACT │
    └───────────────────────────────┘
```

### 핵심 데이터 흐름

```
체크박스 클릭
  → useDataStore.toggleSceneStage() [즉시 UI 반영 = 낙관적 업데이트]
  → sheetsService.updateSheetCell() [IPC → main → HTTP → GAS → Sheets]
  → 실패 시: syncInBackground()로 Sheets에서 재로딩하여 UI 복원
```

### 두 가지 모드 (분기 기준: `sheetsConnected` 불리언)

| | 라이브 모드 | 테스트 모드 |
|--|-----------|-----------|
| **데이터** | Google Sheets | `test-data/sheets.json` |
| **서비스** | `sheetsService.ts` | `testSheetService.ts` |
| **활성화** | Sheets 연결 시 | `--test-mode` 또는 `TEST_MODE=1` |
| **분기 위치** | `ScenesView.tsx` 17개소+ | `if(sheetsConnected)` 패턴 |

> **참고**: 테스트 모드 제거가 로드맵 Phase 0-4에 선택적 항목으로 있음.

---

## 3. 핵심 파일 맵

### 데이터 흐름 관련 (가장 자주 수정)

| 파일 | 줄 수 | 역할 | 비고 |
|------|-------|------|------|
| `src/views/ScenesView.tsx` | ~2980 | **메인 뷰** — 씬 CRUD, 체크박스, 필터, 정렬 | 가장 큰 파일, 모든 동작의 허브 |
| `src/stores/useDataStore.ts` | ~200 | 에피소드/씬 상태 + 낙관적 업데이트 함수 | `toggleSceneStage`, `addEpisodeOptimistic` 등 |
| `src/stores/useAppStore.ts` | ~160 | UI 상태 (뷰, 필터, 연결상태, 테마) | `sheetsConnected`, `isTestMode` 등 |
| `electron/sheets.ts` | ~336 | **GAS HTTP 통신** — `gasFetch()`, `gasGet()` | 리다이렉트 핸들링 포함 |
| `electron/main.ts` | ~900 | Electron 메인 프로세스, IPC 핸들러 전체 | 파일워처, 윈도우 관리 |
| `src/services/sheetsService.ts` | ~156 | 렌더러→IPC 래퍼 (라이브 모드) | `addEpisodeToSheets`, `updateSheetCell` 등 |
| `src/services/testSheetService.ts` | ~372 | 로컬 JSON 파일 조작 (테스트 모드) | `readTestSheet`, `addTestScene` 등 |
| `apps-script/Code.gs` | ~700+ | **Google Apps Script** — doGet/doPost | Sheets 직접 조작, 이미지 업로드 |

### UI 컴포넌트

| 파일 | 역할 |
|------|------|
| `src/views/Dashboard.tsx` | 대시보드 — 위젯 그리드 (react-grid-layout) |
| `src/views/EpisodeView.tsx` | 에피소드별 현황 (카드/매트릭스) |
| `src/views/TimelineView.tsx` | 간트 차트 + 히트맵 |
| `src/views/AssigneeView.tsx` | 인원별 태스크 뷰 |
| `src/views/SettingsView.tsx` | 설정 (Sheets 연결, 테마, 사용자) |
| `src/components/scenes/SceneCard.tsx` | 씬 카드 컴포넌트 |
| `src/components/scenes/CommentPanel.tsx` | 씬 댓글 패널 |
| `src/components/widgets/` | 대시보드 위젯 모음 |
| `src/components/spotlight/SpotlightSearch.tsx` | Ctrl+Space 검색 |

### 타입 & 유틸

| 파일 | 역할 |
|------|------|
| `src/types/index.ts` | **모든 타입 정의** — Episode, Part, Scene, Stage, Department |
| `src/utils/calcStats.ts` | 진행률 계산 유틸 |
| `src/config.ts` | 기본 설정값 (DEFAULT_WEB_APP_URL 등) |

---

## 4. 현재 진행 상태 (2026-02-24)

### 완료된 기능

- Phase 1: 씬 관리 (정렬, 필터, 레이아웃 그룹핑, 연속 입력)
- Phase 2: 이미지 업로드/비교 뷰, 완료 애니메이션
- Phase 4-1~4-3: 에피소드/타임라인/인원별 뷰
- Phase 6 Step 1~4: BG+액팅 멀티 부서 (타입, 데이터, UI, 대시보드)
- Phase 7-1,3~5: 위젯 편집, 동기부여 메시지, UI 폴리시, 스포트라이트

### 다음 착수 — Phase 0: 긴급 안정화 (ROADMAP.md 참조)

**핵심 문제**: 1동작=1HTTP 요청 구조로 인한 부분 실패/롤백 이슈

| 순위 | 항목 | 설명 |
|------|------|------|
| **1** | **배치 엔드포인트 (0-1)** | GAS `batch` action으로 복수 동작 원자적 처리 |
| **2** | **낙관적 롤백 보강 (0-2)** | 아카이브 등 복합 동작 실패 시 UI 상태 완전 복원 |
| **3** | **재시도 로직 (0-3)** | HTTP 실패 시 지수 백오프 자동 재시도 |
| 4 | 테스트 모드 제거 (0-4) | 선택적 — 코드 간소화 |

---

## 5. 코드 수정 시 주의사항

### 절대 규칙 (CLAUDE.md에서)

1. **`/home/user/Bflow` 레포는 절대 수정 금지** — 참고 전용
2. **모든 개발은 `/home/user/Bflow-BGonly`에서만**
3. **빌드 검증**: `tsc --noEmit` + `vite build` 통과 필수
4. **`package.json`에 `"type": "module"` 쓰지 말 것** — Electron은 CJS

### 패턴 규칙

1. **낙관적 업데이트**: 모든 데이터 변경은 `store.xxxOptimistic()` → 서비스 호출 → 실패 시 `syncInBackground()`
2. **테스트 모드 동등성**: 새 기능은 `if(sheetsConnected)` 양쪽 경로 모두 구현 (0-4에서 폐지 전까지)
3. **서비스 레이어 분리**: 뷰에서 직접 API 호출 금지, 반드시 `services/` 경유
4. **Apps Script 변경 시**: Code.gs 수정 후 GAS 웹 앱 **재배포** 필요 (사용자가 직접)

### ScenesView.tsx 작업 시 주의

이 파일은 ~2980줄로 앱의 **핵심 허브**. 거의 모든 CRUD가 여기에 있음.

```
패턴:
  handleXxx = async () => {
    // ① 낙관적 업데이트 (store)
    xxxOptimistic(...)

    // ② 서버 동기화 (분기)
    try {
      if (sheetsConnected) {
        await xxxToSheets(...)
      } else {
        await xxxTest(...)
      }
      syncInBackground()
    } catch (err) {
      alert(err)
      syncInBackground()  // ← 주의: 낙관적 상태 롤백 누락 가능
    }
  }
```

---

## 6. 알려진 이슈 & PR 리뷰 사항

### 확인된 이슈 (2026-02-24)

| 이슈 | 위치 | 심각도 | 상태 |
|------|------|--------|------|
| 복수 동작 부분 실패 | `sheets.ts` 전체 | 높음 | Phase 0-1에서 해결 예정 |
| 아카이브 롤백 누락 | `ScenesView.tsx:1930-1933` | 중간 | Phase 0-2에서 해결 예정 |
| commentService 캐시 참조 | `commentService.ts:39` | 낮음 | **수정 완료** (복사본 반환) |
| 테스트 마이그레이션 비결정적 | `testSheetService.ts:43-46` | 매우 낮음 | 테스트 모드 전용, 미수정 |

### 코덱스(Codex) 리뷰 검증 결과

**리뷰 1 — commentService 캐시 참조 (수정 완료)**
- `getComments()`가 캐시 배열 참조를 직접 반환 → 복사본으로 수정됨

**리뷰 2 — 아카이브 낙관적 롤백 (Phase 0-2로 편입)**
- catch에서 `archivedEpisodes` 롤백 안 함 → 유령 아카이브 가능
- Phase 0 배치 엔드포인트로 근본 해결 + 롤백 로직 보강 병행

**리뷰 3 — 테스트 마이그레이션 Math.random() (미수정)**
- 최초 1회 마이그레이션에서만 발생, 이후 저장 시 결정적으로 고정됨
- 테스트 모드 전용이라 실질적 영향 없음 → 수정 불필요

---

## 7. 기술 스택 & 빌드

```
Electron 28 + React 18 + TypeScript + Vite
Tailwind CSS + Framer Motion + Zustand + react-grid-layout
```

```bash
# 개발
npm run dev          # Vite dev server (렌더러만)
npm run electron:dev # Electron + Vite

# 빌드 검증
npx tsc --noEmit     # 타입 체크
npx vite build       # 번들 빌드

# 전체 빌드 (배포용)
npm run build        # tsc + vite build + electron-builder
```

### 디자인 토큰

```
배경: #0F1117 | 카드: #1A1D27 | 보더: #2D3041
텍스트: #E8E8EE | 텍스트 약: #8B8DA3 | 액센트: #6C5CE7
단계: LO=#74B9FF  완료=#A29BFE  검수=#FDCB6E  PNG=#00B894
```

---

## 8. 스킬 & 도구 활용 가이드

### 사용 가능한 스킬

- **`ui-ux-pro-max`**: UI/UX 디자인 작업 시 사용. 글래스모피즘, 다크 모드, 애니메이션 등
  - 이 프로젝트 스타일: 다크 테마, 글래스모피즘, Framer Motion 애니메이션
  - Anti-pattern: 이모지 범벅, 보라색 그라데이션 (AI 슬롭)

### 작업 시 권장 패턴

1. **코드 수정 전**: 반드시 대상 파일 `Read` 먼저. 특히 ScenesView.tsx는 크므로 관련 함수 주변만 읽기
2. **탐색 작업**: `Explore` 서브에이전트 활용 (파일 간 관계 파악)
3. **병렬 검색**: Grep/Glob을 병렬로 호출하여 효율적 탐색
4. **빌드 검증**: 수정 후 `tsc --noEmit` 실행하여 타입 에러 확인
5. **커밋 메시지**: 한글로 작성

### Apps Script (Code.gs) 수정 시

```
⚠️ Code.gs는 앱 내부에서 직접 배포할 수 없음.
   수정 후 사용자에게 Google Apps Script 에디터에서 "새 배포" 안내 필요.
   파일 위치: apps-script/Code.gs
```

---

## 9. 참조 문서 목록

| 문서 | 용도 |
|------|------|
| `CLAUDE.md` | 필수 규칙, 프로젝트 개요 |
| `ROADMAP.md` | 전체 개발 로드맵 (Phase 0~7) |
| `tasks/lessons.md` | 과거 실수/패턴 기록 |
| `apps-script/Code.gs` | Google Apps Script 서버 코드 |
| `/home/user/Bflow/` | Bflow 원본 레포 (참고 전용, 수정 금지) |

---

*이 문서는 새 세션 시작 시 CLAUDE.md와 함께 가장 먼저 읽어야 할 컨텍스트 가이드입니다.*
