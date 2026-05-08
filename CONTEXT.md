# CONTEXT.md — B flow 세션 컨텍스트 가이드

> **용도**: 새 Claude 세션이 이 레포에서 작업할 때 빠르게 파악하기 위한 가이드.
> **최종 갱신**: 2026-05-08
> **반드시 함께 읽을 문서**: `CLAUDE.md` (필수 규칙), `ROADMAP.md` (전체 개발 계획), `DEVLOG/AUTO_UPDATE_OPERATIONS.md` (자동 업데이트 운영 기준)

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

> **전환 중**: Google Sheets → Supabase 마이그레이션 진행 중 (Phase 9).
> ScenesView는 Supabase 전환 완료, 일부 뷰에 Sheets 코드 잔존.

```
┌─ Electron 앱 ─────────────────────────────────────────────────┐
│                                                                │
│  ┌─ 렌더러 (React + Zustand) ──────────────────────┐          │
│  │  Views: ScenesView, Dashboard, EpisodeView, ...  │          │
│  │  Stores: useDataStore, useAppStore               │          │
│  │  Services: supabaseService.ts (IPC 래퍼)         │          │
│  └──────────────┬───────────────────────────────────┘          │
│                 │ IPC (preload.ts)                              │
│  ┌──────────────▼───────────────────────────────────┐          │
│  │  메인 프로세스 (electron/main.ts)                  │          │
│  │  ├─ supabase.ts: CRUD 함수 (802줄)                │          │
│  │  ├─ realtime.ts: WebSocket 구독 + 자동 재연결      │          │
│  │  ├─ broadcast.ts: 즉시 delta 전파                  │          │
│  │  └─ sheets.ts: GAS 통신 (이미지 업로드용 잔존)      │          │
│  └──────────────┬───────────────────────────────────┘          │
└─────────────────┼──────────────────────────────────────────────┘
                  │
    ┌─────────────▼─────────────────────────┐
    │  Supabase (PostgreSQL + Realtime)      │
    │  테이블: episodes, parts, scenes,       │
    │          comments, comp_revisions,      │
    │          users, metadata               │
    └─────────────┬─────────────────────────┘
                  │ WebSocket (Realtime)
                  └─→ 변경 즉시 push (~100ms)

    ┌─────────────────────────────────┐
    │  Google Apps Script (Code.gs)   │
    │  → 이미지 업로드만 담당          │
    └─────────────────────────────────┘
```

### 핵심 데이터 흐름

```
체크박스 클릭
  → useDataStore.toggleSceneStage() [즉시 UI 반영 = 낙관적 업데이트]
  → supabaseService.updateSceneField() [IPC → main → Supabase API]
  → 실패 시: 해당 필드만 롤백 (세밀한 롤백)
  → 다른 사용자: Realtime WebSocket으로 즉시 수신 → delta 적용
```

### 데이터 소스 (전환 중)

| | Supabase (현재) |
|--|----------------|
| **데이터** | PostgreSQL (Supabase) |
| **서비스** | `supabaseService.ts` |
| **동기화** | Realtime WebSocket (즉시) |
| **상태** | 전체 뷰 전환 완료, 레거시 Sheets 코드 정리 완료 |

---

## 2.1 자동 업데이트 / 배포 원칙

**목표**: 팀원은 로컬 PC에 설치된 BFLOW를 실행하고, G드라이브는 새 빌드를 받아오는 배포 창고로만 사용한다. G드라이브에서 직접 exe를 계속 실행하면 Windows Defender 검사 때문에 시작 시간이 길어진다.

**v1.22.19 기준 동작**:

- 앱 시작 시 스플래시에서 업데이트 확인/준비 상태를 안내한다.
- 새 버전 준비는 최대 10초까지만 기다린다. 10초 안에 준비되면 installer helper가 로컬에 받아둔 `BFLOW-Setup.exe`를 실행하고 최신 버전으로 재실행한다. 오래 걸리면 현재 버전으로 먼저 연다.
- 앱 사용 중에는 5분 주기로 manifest를 다시 확인하고, 새 버전이 준비되면 지속 토스트, 좌하단 버전 버튼 배지, 업데이트 상세 모달로 표시한다.
- 실제 적용은 `지금 업데이트` 클릭 또는 앱 종료 시 `installerApply.ts`의 installer helper로 수행된다. 실행 중 앱 폴더를 직접 rename/copy하지 않는다.
- 토스트는 "다운로드 준비 완료" 신호일 뿐이다. 적용 성공은 다음 실행 버전, `%LOCALAPPDATA%\Bflow-BGonly\swap.log`의 `[installer-main]`/`[installer]` 로그, `%LOCALAPPDATA%\Bflow-BGonly\installer-pending` 정리 여부로 확인한다.
- 배포 시 `manifest.json`은 반드시 마지막에 갱신한다. 앱이 manifest를 최신 신호로 사용하므로 반쯤 올라간 빌드를 최신으로 판단하게 만들면 안 된다.
- 좌하단 버전 모달은 열 때 자동 확인하지 않고, 사용자가 `새로고침`을 눌렀을 때만 `update:check-now`로 확인한다. 새로고침 중에는 기존 표시 내용을 유지해야 한다.
- `DEVLOG/update-notes.json`의 과거 항목은 모달에서 펼쳐 보는 기록이다. 삭제하지 말고 새 항목을 맨 위에 추가한다.

관련 파일:

| 파일 | 역할 |
|------|------|
| `electron/autoUpdate/checker.ts` | manifest 비교, installer 다운로드, 상태 IPC용 `UpdateInfo` 생성 |
| `electron/autoUpdate/installerApply.ts` | 앱 종료 후 PowerShell helper로 `BFLOW-Setup.exe /S` 실행 |
| `electron/main.ts` | 시작 10초 update gate, 토스트/모달 상태 IPC, 종료 시 installer 적용 위임 |
| `src/components/update/UpdateCenterModal.tsx` | 업데이트 상세 모달 |
| `DEVLOG/update-notes.json` | 배포별 변경 요약. 빌드 시 `dist/manifest.json.releaseNotes`로 들어감 |
| `DEVLOG/AUTO_UPDATE_OPERATIONS.md` | 자동 업데이트 운영 기준 |
| `DEVLOG/DEPLOYMENT.md` | 배포 운영 가이드 |

---

## 3. 핵심 파일 맵

### 데이터 흐름 관련 (가장 자주 수정)

| 파일 | 줄 수 | 역할 | 비고 |
|------|-------|------|------|
| `src/views/ScenesView.tsx` | ~2980 | **메인 뷰** — 씬 CRUD, 체크박스, 필터, 정렬 | 가장 큰 파일, Supabase 전환 완료 |
| `src/stores/useDataStore.ts` | ~200 | 에피소드/씬 상태 + 낙관적 업데이트 함수 | Realtime delta 적용 액션 포함 |
| `src/stores/useAppStore.ts` | ~160 | UI 상태 (뷰, 필터, 연결상태, 테마) | `activeDataSource`, `dataConnected` |
| `electron/supabase.ts` | ~802 | **Supabase CRUD** — 전체 데이터 조작 | 클라이언트 초기화 + 모든 테이블 CRUD |
| `electron/realtime.ts` | ~147 | **Realtime 구독** — WebSocket 이벤트 처리 | 자동 재연결 (지수 백오프, 최대 10회) |
| `electron/broadcast.ts` | ~82 | **Broadcast** — 즉시 delta 전파 | 다중 클라이언트 간 빠른 동기화 |
| `electron/main.ts` | ~900 | Electron 메인 프로세스, IPC 핸들러 전체 | Supabase + Sheets 양쪽 핸들러 |
| `src/services/supabaseService.ts` | ~374 | 렌더러→IPC 래퍼 (Supabase) | 고수준 API (sheetName→UUID 변환) 포함 |
| `electron/sheets.ts` | ~336 | GAS HTTP 통신 | 이미지 업로드 + 메타데이터 읽기 |
| `apps-script/Code.gs` | ~700+ | **Google Apps Script** | 이미지 업로드만 유지 |

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
| `src/config.ts` | 기본 설정값 (DEFAULT_GAS_IMAGE_URL 등) |

---

## 4. 현재 진행 상태 (2026-03-14)

### 완료된 기능

- Phase 0: 긴급 안정화 (0-1~0-3, 0-5~0-6 완료)
- Phase 1: 씬 관리 (정렬, 필터, 레이아웃 그룹핑, 연속 입력)
- Phase 2: 이미지 업로드/비교 뷰, 완료 애니메이션
- Phase 4-1~4-3: 에피소드/타임라인/인원별 뷰
- Phase 6 Step 1~4: BG+액팅 멀티 부서 (타입, 데이터, UI, 대시보드)
- Phase 7-1~7-5: 위젯 편집, 동기부여 메시지, UI 폴리시, 스포트라이트, AOT 위치저장
- Phase 8-0~8-1, 8-3~8-5: 설정 탭, 글꼴 크기, 플렉서스 제어, 스플래시, 로그인 자동저장
- Phase 9 M-0, M-2: Supabase 프로젝트 준비 + 클라이언트 구현 완료

### 현재 진행 중 — Phase 9: Supabase 마이그레이션

**핵심 목표**: Google Sheets → Supabase 전환으로 실시간 크로스 머신 동기화 실현

| 순위 | 항목 | 설명 | 상태 |
|------|------|------|------|
| **1** | **M-3. 뷰/스토어 전환** | ScenesView 완료, 나머지 뷰 잔여 | 🔶 진행 중 |
| **2** | **M-1. 마이그레이션 스크립트** | sheets→JSON→Supabase 변환 | 미착수 |
| **3** | **M-5. 정리 및 빌드 검증** | sheets.ts 삭제, drive-image.ts 분리 | 미착수 |
| **4** | **M-6. 컷오버** | 반나절 다운타임, 실제 마이그레이션 | 미착수 |

> **상세 계획서**: `DEVLOG/supabase-migration-plan.md` (767줄)

---

## 5. 코드 수정 시 주의사항

### 절대 규칙 (CLAUDE.md에서)

1. **`/home/user/Bflow` 레포는 절대 수정 금지** — 참고 전용
2. **모든 개발은 `/home/user/Bflow-BGonly`에서만**
3. **빌드 검증**: `npm run typecheck` + 관련 테스트 + `npm run build:vite` 또는 정식 배포 시 `npm run build` 통과 필수
4. **`package.json`에 `"type": "module"` 쓰지 말 것** — Electron은 CJS

### 패턴 규칙

1. **낙관적 업데이트**: 모든 데이터 변경은 `store.xxxOptimistic()` → supabaseService 호출 → 실패 시 해당 필드만 롤백
2. **Supabase 단일 경로**: 새 기능은 `supabaseService` 경유로만 구현 (Sheets 분기 추가 금지)
3. **서비스 레이어 분리**: 뷰에서 직접 API 호출 금지, 반드시 `services/` 경유
4. **IPC 구조 유지**: 렌더러에서 직접 Supabase 호출 금지, 반드시 IPC → 메인 → Supabase
5. **Realtime**: `syncInBackground()` 대신 Realtime delta로 다른 클라이언트 동기화

### ScenesView.tsx 작업 시 주의

이 파일은 ~2980줄로 앱의 **핵심 허브**. Supabase 전환 완료.

```
패턴 (Supabase):
  handleXxx = async () => {
    // ① 낙관적 업데이트 (store)
    xxxOptimistic(...)

    // ② Supabase 동기화
    try {
      await supabaseService.xxx(...)
      // syncInBackground 불필요 — Realtime이 다른 클라이언트에 전파
    } catch (err) {
      rollbackXxx(...)  // 실패 시 해당 필드만 명시적 롤백
    }
  }
```

---

## 6. 알려진 이슈 & 주의사항

### 확인된 이슈 (2026-03-14)

| 이슈 | 위치 | 심각도 | 상태 |
|------|------|--------|------|
| 복수 동작 부분 실패 | `sheets.ts` (레거시) | ~~높음~~ | ✅ Phase 0-1 배치로 해결, Supabase 전환 후 무관 |
| 아카이브 롤백 누락 | `ScenesView.tsx` | ~~중간~~ | ✅ Phase 0-2에서 해결 |
| ~~Sheets 코드 잔존~~ | ~~App.tsx, useAppStore 등~~ | ~~낮음~~ | ✅ 레거시 네이밍 정리 완료 |
| Supabase 무료 플랜 7일 정지 | 운영 | 중간 | 연휴 시 keep-alive 필요 |
| 인증 시스템 미정 | 전체 | 낮음 | 현행 유지 vs Supabase Auth (한솔님과 확인 필요) |

### Supabase 전환 관련 주의사항

1. **레거시 네이밍 정리 완료**: `sheetsConnected` → `dataConnected`, `DEFAULT_WEB_APP_URL` → `DEFAULT_GAS_IMAGE_URL`, supabaseService 내 `*InSheets`/`*ToSheets` 함수명 정리 완료
2. **이미지 업로드**: GAS 경유 유지 (Supabase Storage 아님). `sheets.ts`에서 이미지 코드를 `drive-image.ts`로 분리 후 삭제 예정
3. **IPC 구조**: 렌더러 → IPC → 메인(supabase.ts) → Supabase API. 렌더러에서 직접 Supabase 호출 금지

---

## 7. 기술 스택 & 빌드

```
Electron 28 + React 18 + TypeScript + Vite
Tailwind CSS + Framer Motion + Zustand + react-grid-layout
@supabase/supabase-js (PostgreSQL + Realtime WebSocket)
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
| `ROADMAP.md` | 전체 개발 로드맵 (Phase 0~9) |
| `DEVLOG/supabase-migration-plan.md` | Supabase 마이그레이션 상세 계획서 (767줄) |
| `DEVLOG/supabase-init.sql` | Supabase DB 스키마 초기화 SQL |
| `tasks/lessons.md` | 과거 실수/패턴 기록 |
| `apps-script/Code.gs` | Google Apps Script (이미지 업로드 전용) |
| `DEVLOG/DEPLOYMENT.md` | 배포/자동 업데이트 운영 가이드 |
| `docs/superpowers/specs/2026-05-01-auto-update-design.md` | 자동 업데이트 설계 및 결정 이력 |
| `/home/user/Bflow/` | Bflow 원본 레포 (참고 전용, 수정 금지) |

---

*이 문서는 새 세션 시작 시 CLAUDE.md와 함께 가장 먼저 읽어야 할 컨텍스트 가이드입니다.*
