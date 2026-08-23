# B flow 공유 캘린더 (PM 일정관리) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google 연동 없이 보이는 B flow 자체 공유 캘린더(팀 전체/특정 팀원/개인) + 태그 필터 + 시간 단위 일정 + 앱 내 알림을 4개 PR 로 구현한다.

**Architecture:** Supabase 신규 테이블 5개(`calendars`/`calendar_members`/`calendar_tags`/`calendar_events`/`calendar_notifications`)를 SSOT 로 두고, 렌더러 → IPC → 메인 프로세스(세션 검증 + 권한 강제) → Supabase 단일 경로. 렌더러 `calendarService` 의 `eventCache` 가 B flow/구글/휴가 3 소스를 병합하고, 변경은 낙관적 업데이트 + Realtime(postgres_changes) + 창간 IPC 로 전파한다. UI 는 기존 `ScheduleView` 를 분해한 뒤 좌측 캘린더 레일 + 태그 줄을 얹는 "레이어형 단일 캘린더"(접근안 A).

**Tech Stack:** Electron(main IPC) + React 18 + TypeScript + Zustand + @supabase/supabase-js + node --test.

---

## Chunk 0: 공통 컨텍스트 (모든 PR 세션이 먼저 읽을 것)

### 0.1 필수 문서 (읽는 순서)

1. `docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md` — **설계서(SSOT)**. 결정 D1~D7, DDL, 권한 규칙, UI 명세. 이 플랜과 충돌하면 설계서가 우선.
2. `docs/superpowers/research/2026-08-24-calendar-current-structure.md` — 현재 구조 분석. 죽은 코드 목록(§3)과 파일:줄 근거. **줄 번호는 조사 시점(main=93f2c9d) 기준이라 드리프트 가능 — 반드시 grep 으로 재확인 후 수정할 것.**
3. `docs/superpowers/specs/mockups/2026-08-24-calendar/M1Month~M6Notify.dc.html` — UI 시안 원본(브라우저로 열면 렌더됨). PR3 의 시각 기준.
4. `CLAUDE.md` + `tasks/lessons.md` — 필수 규칙과 과거 실수 패턴.

### 0.2 전체 파일 구조 (생성/수정 지도)

**신규 생성:**

| 파일 | 책임 | PR |
|---|---|---|
| `DEVLOG/migrations/2026-08-24-shared-calendars.sql` | 테이블 5개 + 인덱스 + 태그 시드 + private_calendar_events 이관 + realtime publication + delete_user_cascade 갱신 | PR2 |
| `src/shared/calendarPermissions.ts` | 권한 판정 순수 함수 4개 (메인·렌더러·테스트 공용, **상대 import 만**) | PR2 |
| `electron/calendarStore.ts` | 메인측 캘린더/일정/태그/알림 Supabase CRUD (`electron/supabase.ts` 의 private-event 함수 패턴) | PR2 |
| `electron/calendarIpc.ts` | `calendar:*` IPC 핸들러 등록(세션 검증 + 권한 강제 + broadcast) — main.ts 비대화 방지 위해 분리. PR4 에서 알림 insert 배선도 이 파일에 추가 | PR2,4 |
| `src/stores/useCalendarStore.ts` | 렌더러 캘린더 목록·태그·켬/끔 토글(localStorage persist)·알림 뮤트 상태 | PR2 |
| `src/utils/calendarDate.ts` | 날짜 유틸 공용화(fmtDate/parseDate/addDays/daysBetween/hexToRgba/요일/ISO주차) | PR1 |
| `src/utils/vacationEvents.ts` | 휴가 VacationEvent → CalendarEvent 매핑 공용화 | PR1 |
| `src/components/calendar/CalendarGrid.tsx` | ScheduleView 에서 이동(월 그리드 + EventBarChip) | PR1 |
| `src/components/calendar/EventCreateModal.tsx` | ScheduleView 에서 이동(생성 모달) → PR3 에서 필드 개편 | PR1 |
| `src/components/calendar/CalendarRail.tsx` | 좌측 캘린더 목록 카드(섹션 4개 + 토글 + ⋯ 메뉴 + 새 캘린더) | PR3 |
| `src/components/calendar/TagBar.tsx` | 태그 칩 줄(독립 토글 + 전체 리셋 + 태그 관리 진입) | PR3 |
| `src/components/calendar/CalendarSettingsModal.tsx` | 캘린더 생성/설정·멤버 공유 모달 (M4) | PR3 |
| `src/components/calendar/TagManagerPopover.tsx` | 태그 관리 팝오버 (M5, admin 편집) | PR3 |
| `src/utils/calendarEventFilter.ts` | 캘린더∩태그 필터·칩 텍스트·정렬·레일 그룹 순수 함수 | PR3 |
| `src/mocks/devCalendarSeed.ts` | 프리뷰 seed(캘린더 4·태그 4·일정 15) + 인메모리 CRUD | PR3 |
| `tests/calendarPermissions.test.ts` | 권한 매트릭스 테스트 | PR2 |
| `tests/calendarDateUtils.test.ts` | 날짜 유틸 테스트 | PR1 |
| `tests/calendarEventFilter.test.ts` | 캘린더∩태그 필터·태그없는 일정 항상표시 규칙 | PR3 |
| `tests/calendarNotifications.test.ts` | 알림 문구 생성·수신자 계산 | PR4 |

**주요 수정:**

| 파일 | 내용 | PR |
|---|---|---|
| `package.json` | `test:calendar` 스크립트 신설 + `build`/`build:vite` 체인에 추가 + `test:ui` 에 `calendarIntegrationStatus.test.ts` 연결 + 버전 | PR1~4 |
| `src/views/ScheduleView.tsx` | 죽은 코드 삭제 → 분해(PR1) → 레일/태그줄/통계줄 조립 + 기존 필터 제거(PR3) | PR1,3 |
| `src/types/calendar.ts` | dead 타입 삭제(PR1), `BflowCalendar`/`CalendarTag` 신설 + `CalendarEvent` 확장(`calendarId/tagId/allDay/startTime/endTime/canEdit/source`)(PR2) | PR1,2 |
| `src/services/calendarService.ts` | dead 함수 삭제(PR1), `loadBflowEvents` + bflow CRUD 라우팅 + 구글 가드 밖 로드(PR2), teamCalendarId 제거(PR4) | PR1,2,4 |
| `electron/main.ts` | `calendarIpc` 등록 호출 1줄 (알림 insert 는 `calendarIpc.ts` 안에 배선 — PR4) | PR2 |
| `electron/preload.ts` | `calendar*` API 노출 | PR2 |
| `electron/realtime.ts` | `calendars`/`calendar_members`/`calendar_events`/`calendar_notifications` 구독 | PR4 |
| `src/App.tsx` | data-change 전체 리로드 분기에서 `calendar%`+`private_calendar_events` 제외, `calendar-changed` 수신부를 "B flow 재조회(항상)+구글 incremental(인증 시)" 로 수정 | PR4 |
| `src/components/calendar/EventSidePanel.tsx` | 캘린더/태그/시각 표시 + 캘린더 이동·태그 변경 + 보기 전용 처리 | PR3 |
| `src/components/calendar/EventQuickEdit.tsx` | 색 편집 → 태그·캘린더 변경으로 교체 | PR3 |
| `src/components/calendar/WeekScrollView.tsx` / `DayScrollView.tsx` | 종일 우선 + 시각순 정렬 + 시간 부제 표시 | PR3 |
| `src/components/calendar/CalendarGrid.tsx` | EventBarChip 텍스트를 `formatEventChipText` 규칙(태그·제목 / HH:MM 제목)으로 교체 | PR3 |
| `src/stores/useNotificationStore.ts` | `calendar` 알림 유형 + 클릭 내비 | PR4 |
| `src/mocks/devElectronAPI.ts` | 신규 IPC mock(PR2) + 캘린더 4개/태그 4개/일정 15개 seed(PR3) | PR2,3 |
| `src/components/settings/SheetsSection.tsx` | teamCalendarId 잔재 제거 | PR4 |
| `DEVLOG/update-notes.json` | 각 PR 항목(비개발자 톤) | PR1~4 |

> 참고: PR3 는 PR2 미적용 상태로 시작하는 경우에 한해 `src/services/calendarService.ts`(구글 고정색)·`src/utils/vacationEvents.ts`(휴가 고정색)를 폴백으로 조정할 수 있다(Chunk 3 Task 3.10 조건부).

### 0.3 공통 규칙 (전 PR)

- **검증 게이트(각 PR 완료 전 필수, 이 순서)**: `npm run typecheck` → 관련 `npm run test:*` → `npm run build:vite` → 프리뷰 실기(`npm run dev:renderer` 후 `http://localhost:5190/?preview=1`, mock 로그인 `배한솔`/`1234`) — 스플래시가 안 뜨면 수동 로그인. **작동 증명 없이 완료 표시 금지.**
- **커밋**: 한글 메시지, 태스크 단위로 자주. 브랜치는 PR 별 신규(`claude/calendar-pr1-cleanup` 등). Bflow 원본 레포(`/home/user/Bflow`) 수정 절대 금지.
- **버전**: 기능 PR = 마이너 +1. **PR 생성 직전 `origin/main` 의 `package.json` 버전 기준**으로 산정(1.102.0 이후 다른 PR 이 먼저 머지될 수 있음). `package.json` + `package-lock.json` 2곳(lock 은 최상단 `version` + `packages[""].version`) 3자 일치.
- **PR**: `pr-creator` 스킬 사용. 본문 "📋 업데이트 요약" 은 비개발자 톤(기술 용어·식별자·파일경로 금지). 생성 후 `codex-review-loop` 스킬로 리뷰 루프. **머지·G드라이브 배포·슬랙 공지는 한솔 명시 지시 시에만.**
- **Supabase 경로**: 렌더러에서 직접 Supabase 호출 금지(IPC → 메인). 전체 조회는 `.range()` 페이지네이션(PostgREST 1000행 제한).
- **스타일**: 메모/placeholder 에 italic 금지. `cn` 은 clsx 단독. 이모지 아이콘 금지(lucide). 부서(BG/ACT) UI 노출 금지.
- **알려진 함정**(`tasks/lessons.md`): 색상 하드코딩 수정 시 `calendar/*` 전체 grep / 전역 키 정규화는 reader·writer·UI키 동반 수정 / node --test 에서 `@/` alias 런타임 import 금지(상대 경로) / 목록 끝 고정 앵커 금지.

### 0.4 PR 순서와 의존성

```
PR1 정리(동작 불변) ──▶ PR2 데이터(테이블+IPC+경로 스위치) ──▶ PR3 UI(레일·태그·모달) ──▶ PR4 알림·마감
```

- 각 PR 은 독립적으로 머지 가능한 작동 상태여야 한다. PR2 머지 후에도 화면은 기존과 동일하게 동작(저장소만 교체), PR3 후 새 UI, PR4 후 알림.
- **마이그레이션 SQL 라이브 적용은 PR2 머지 직후·배포 전** 별도 단계(한솔 확인 후). 적용 전까지 PR2 코드는 테이블 부재 시 빈 목록으로 동작해야 함(에러 토스트 금지, `console.warn` 만).

---

# Chunk 1 — PR1 정리 플랜

> chunk0(공통 컨텍스트)을 먼저 읽었다는 전제. 검증 게이트·커밋·버전·PR 규칙은 chunk0 §0.3 을 따르고 여기서 반복하지 않는다.

## Chunk 1: PR1 — 정리 (동작 불변, 브랜치 claude/calendar-pr1-cleanup)

**목표**: 공유 캘린더 구현(PR2~4) 전에 캘린더 서브시스템의 죽은 코드를 걷어내고, 10곳에 복제된 날짜 유틸과 3중복 휴가 매핑을 공용 모듈로 합치고, 2111줄 `ScheduleView.tsx` 를 분해한다. **이 PR 에서 화면 동작은 아무것도 달라지지 않아야 한다.**

**근거**: 설계서 §10, 연구 문서 §3(A 목록). 아래 줄 번호는 2026-08-24 실측(main=93f2c9d 기준 워크트리에서 전 항목 파일 열어 확인 완료 — 연구 문서와 일치)이지만, **각 스텝에서 반드시 grep 으로 재확인 후 수정한다** (다른 PR 이 먼저 머지되면 드리프트).

**이 PR 에서 건드리지 않는 것** (경계 명확화):
- `calendarService.ts:434` `visibility: event.isPrivate ? 'private' : undefined` 도달 불가 분기와 `types/calendar.ts:61-67` `isPrivate` 구버전 주석 — **PR4 몫** (설계 §9). PR1 에서 삭제 금지.
- `getTargetCalendar`/`teamCalendarId`/`SheetsSection` 잔재 — PR2/PR4 몫.
- 타임라인 탭(`CalendarView`)의 구조·휴가 모듈(`VacationView`)·대시보드 위젯 UI — D4 결정으로 손대지 않음 (휴가 **매핑 함수** 공용화만 예외, Task 1.4).
- 유형/부서 필터·휴가 토글 UI (`ScheduleView.tsx:1883-1932`) — PR3 에서 태그 줄로 대체될 때까지 유지.

---

### Task 1.1: 브랜치 생성 + calendarIntegrationStatus.test.ts 를 test:ui 게이트에 연결

**Files:**
- Modify: `package.json` (`test:ui` 스크립트 1줄)
- Test: `tests/calendarIntegrationStatus.test.ts` (기존 파일, 수정 없이 연결만 — 깨져 있을 때만 갱신)

- [ ] **Step 1: 브랜치 생성.** `git fetch origin && git checkout -b claude/calendar-pr1-cleanup origin/main` → `git log -1 --oneline` 으로 최신 main 위인지 확인. 기대: origin/main HEAD 와 동일 커밋.
- [ ] **Step 2: 현재 통과 여부 확인.** `node --test ./tests/calendarIntegrationStatus.test.ts` 실행. 기대: `# pass 1` / `# fail 0` (2026-08-24 실측 통과 확인됨). 이 테스트는 `SheetsSection.tsx`/`IntegrationOverview.tsx`/`Sidebar.tsx` 를 `readFileSync` 로 읽어 문자열 존재를 assert 하는 **문자열 검사 성격**이다(로직 테스트 아님). 만약 깨져 있으면: 실패한 assert 의 문자열을 해당 소스 파일에서 grep 해 현재 표현으로 테스트를 갱신한다 — 소스를 테스트에 맞추지 말 것(이 PR 은 동작 불변).
- [ ] **Step 3: `package.json` `test:ui` 끝에 `./tests/calendarIntegrationStatus.test.ts` 추가.** 결과 형태:
  ```
  "test:ui": "node --test ./tests/sidebarNavVisibility.test.ts ./tests/compositingCarouselLayer.test.ts ./tests/compositorAssign.test.ts ./tests/calendarIntegrationStatus.test.ts",
  ```
- [ ] **Step 4: `npm run test:ui`** → 기대: 4개 파일 전부 pass (`# fail 0`).
- [ ] **Step 5: 커밋.** 예: `테스트: 캘린더 연동 상태 테스트를 test:ui 빌드 게이트에 연결`

---

### Task 1.2: 죽은 코드 삭제 (연구 §3 A 목록 전부)

**Files:**
- Delete: `src/components/calendar/EventCreateTooltip.tsx`
- Modify: `src/views/ScheduleView.tsx`, `src/types/calendar.ts`, `src/services/calendarService.ts`

공통 절차: **각 항목마다 삭제 전 grep 으로 참조 0 확인 → 삭제 → 해당 심볼 grep 재확인(0건) → 그룹 끝에서 typecheck.** `tsconfig` 가 `noUnusedLocals:false` 라 미사용이 typecheck 로 안 잡히므로 grep 이 유일한 안전망이다.

- [ ] **Step 1: EventCreateTooltip.tsx 파일 삭제.** `grep -rn "EventCreateTooltip" src` → 기대: 자기 자신 + `ScheduleView.tsx:26` 주석 1줄뿐. 파일 삭제(`git rm src/components/calendar/EventCreateTooltip.tsx`) + ScheduleView 의 주석 줄(`// EventCreateTooltip removed — ...`) 삭제. 재grep 0건 확인.
- [ ] **Step 2: `EventDetailModal` 함수 삭제 (ScheduleView 412-547 부근).** `grep -n "<EventDetailModal" src/views/ScheduleView.tsx` → 기대 0건(렌더 없음, 2074 주석의 문자열 매치만 있을 수 있음 — JSX 태그 아님을 확인). `function EventDetailModal` 부터 다음 구분 주석(`이벤트 생성/편집 모달`) 직전까지 삭제. 이 함수 전용 lucide 아이콘도 import(5-8행)에서 제거: `Clock, FileText, MapPin, Settings, Pencil, Trash2, ExternalLink` — 단 **제거 전 각 아이콘을 파일 내 grep** 해서 다른 사용처가 없는지 확인(2026-08-24 실측: 7개 전부 EventDetailModal 내부 486-538 에서만 사용. `Palmtree`(307,1911)와 `CheckSquare`(308)는 다른 곳에서 사용 중이므로 **유지**).
- [ ] **Step 3: `TodayView` 함수 삭제 (1091-1156 부근).** `grep -n "<TodayView" src/views/ScheduleView.tsx` → 기대 0건(오늘 모드는 `DayScrollView` 가 렌더). `function TodayView` 블록 전체 + 위 구분 주석(`오늘 뷰 (타임라인 스타일)`) 삭제.
- [ ] **Step 4: 도달 불가 편집 모드 잔재 제거.** `grep -n "editEvent\|handleUpdateEvent\b" src/views/ScheduleView.tsx` 로 전체 위치 파악 후:
  - `editEvent` state(1207) + `handleUpdateEvent` 콜백(1421-1434) 삭제.
  - `setEditEvent(null)` 6곳(1432는 handleUpdateEvent 내부라 함께 삭제됨, 1529/1623/2001/2016/2068) — 호출만 지우고 **감싸는 핸들러의 나머지 줄은 유지** (2001/2016 은 DayScrollView/WeekScrollView 의 `onDateClick` 실동작 핸들러 내부).
  - `EventCreateModal` 렌더부(2062-2070): `key` 는 `'create'` 고정 문자열로, `editEvent` prop 제거, `onSave={handleAddEvent}` 로 단순화.
  - `EventCreateModal` 함수 내부: `editEvent` prop(556,563)과 `isEditMode`(572) 제거, state 초기값의 `editEvent?.X ??` 폴백 제거(574-585 → `initialDate`/기본값만), 자동입력 가드(599)의 `if (isEditMode) return;` 줄과 deps 의 `isEditMode`(629) 제거, 헤더 제목(677) `'새 이벤트'` 고정, 저장 버튼(850) `'이벤트 추가'` 고정.
  - 재grep: `editEvent|isEditMode|handleUpdateEvent\b` → 0건 (주의: `handleUpdateEventDirect` 는 사이드패널/퀵에디트가 실사용 — **삭제 금지**, `\b` 경계로 구분).
- [ ] **Step 5: `detailEvent` 삭제.** state(1208) + `setDetailEvent(null)` 2곳(1466,1483) + 주석(1211 `replaces detailEvent modal`) 정리. 재grep 0건.
- [ ] **Step 6: 빈 `handleDateClick` + CalendarGrid `onDateClick` prop 제거.** `handleDateClick`(1451-1454, 빈 함수) 삭제 → `CalendarGrid` 호출부(2030) prop 제거 → `CalendarGrid` 컴포넌트의 `onDateClick` 파라미터(868)·타입(888)·셀 `onClick={() => { if (!isDragging) onDateClick(dateStr); }}`(984) 제거. **주의**: 셀 클릭 생성은 원래 `onMouseDown`(드래그 훅) 경로로 동작하므로 이 제거는 no-op 삭제가 맞다. DayScrollView(1998)/WeekScrollView(2013)의 `onDateClick` 은 생성 모달을 여는 **실동작 — 절대 건드리지 않는다**.
- [ ] **Step 7: 소소한 미사용 제거 일괄.**
  - `weekOffset` state(1240) 삭제 + `weeks` useMemo deps(1350)에서 제거 + `goToToday` 의 `setWeekOffset(0)`(1384) 삭제. (값을 읽는 곳이 deps 뿐임을 grep 으로 확인.)
  - 1524 destructure 에서 `dragState` 제거 → `const { handleCellMouseDown, isDateInRange } = useCalendarDragCreate({...})`. 훅 자체(`useCalendarDragCreate.ts`)는 수정하지 않는다.
  - `CalendarGrid` 의 `focusWeekIndex` prop(876 파라미터, 895 타입) 삭제 — 내부 사용 0건 grep 확인.
  - `EventBarChip` 의 `compact` prop(145,149) 삭제, 사용처 273-274 는 false 분기 값으로 고정: `top: `${bar.row * 28 + 36}px``, `height: '26px'` (호출부 1047 은 compact 를 안 넘기므로 표시 불변).
  - 미사용 import 제거: `Filter`, `GripVertical`(lucide, 5-6행), `filterEventsByRange`(14행 — 파일 내 사용 0건 grep 확인, `calendarService` 의 export 자체는 CalendarView 등에서 쓸 수 있으므로 **서비스쪽 함수는 유지**하고 import 만 제거), 로컬 함수 `isSameDay`(62-64, 사용 0건).
- [ ] **Step 8: 중간 검증.** `npm run typecheck` → 기대: 에러 0. 커밋: `정리: ScheduleView 죽은 코드 삭제 (상세모달·오늘뷰·편집모드 잔재·미사용 prop)`
- [ ] **Step 9: `types/calendar.ts` 정리.** `grep -rn "CalendarStore\b" src electron tests` → 기대: 정의(71행)뿐 (주의: PR2 에서 만들 `useCalendarStore` 와 이름이 비슷하니 `\b` 경계 필수 — 현재는 존재하지 않아야 정상). `CalendarStore` 타입 삭제. `grep -rn "vacationRowIndex" src electron tests` → 기대: 정의(55행)뿐 → 필드 삭제.
- [ ] **Step 10: `calendarService.ts` 죽은 함수 삭제.** `grep -rn "loadLegacyEvents\|legacyLoaded\|loadAllEvents\|findEventByTodoId" src electron tests` → 기대: 전부 `calendarService.ts` 내부뿐.
  - `loadLegacyEvents`(216-220 no-op)·`legacyLoaded`(213) 삭제 + **호출 3곳 함께 정리**: `loadAllEvents`(222-225, 함수째 삭제), `getEvents`(227-230 → `return [...eventCache];` 한 줄로), `syncAll` 초입(235 `await loadLegacyEvents();` 줄 삭제).
  - `findEventByTodoId`(629-638) 삭제 (할일 연동은 메인 `personalTodoCalendarSync` 로 이관 완료된 상태).
  - 재grep 4개 심볼 0건 확인.
- [ ] **Step 11: `bflow:todos-changed` dispatch 2곳 삭제.** `grep -rn "bflow:todos-changed" src electron` → 기대: `ScheduleView.tsx` 1172,1182 두 곳뿐(수신 리스너 0건 — 2026-08-24 실측 확인). `syncCalendarToTodo`/`unlinkTodoFromCalendar` 안의 `window.dispatchEvent(new Event('bflow:todos-changed'));` 줄만 삭제, 함수 자체는 유지(실사용).
- [ ] **Step 12: 검증 + 커밋.** `npm run typecheck && npm run test:ui` → 통과. 프리뷰 실기 스모크(chunk0 §0.3 절차): 캘린더 탭 진입 → 월 그리드 렌더 → 빈 셀 드래그 → 생성 모달 열림(제목이 '새 이벤트') → 생성 → 바 클릭 시 사이드패널 열림. 커밋: `정리: 캘린더 타입·서비스 죽은 코드 삭제 (CalendarStore·legacy 로드·todos-changed 발신)`

---

### Task 1.3: `src/utils/calendarDate.ts` 신설 + 10곳 로컬 복제 교체 (TDD)

**Files:**
- Create: `src/utils/calendarDate.ts`
- Test: `tests/calendarDateUtils.test.ts`
- Modify: `src/views/ScheduleView.tsx`, `src/components/calendar/DayScrollView.tsx`, `src/components/calendar/DaySidebar.tsx`, `src/components/calendar/WeekScrollView.tsx`, `src/components/calendar/WeekSidebar.tsx`, `src/components/calendar/MiniCalendar.tsx`, `src/components/calendar/EventSidePanel.tsx`, `src/hooks/useCalendarDnD.ts`, `src/hooks/useCalendarDragCreate.ts`, `src/components/widgets/CalendarWidget.tsx`

사전 확정 사항(전 파일 열어 확인): 10곳의 `fmtDate`/`parseDate`/`addDays`/`daysBetween`/`hexToRgba` 구현은 **전부 동일 로직**(parseDate 는 모두 정오 정규화). 주차 계산만 이중: `WeekScrollView.getISOWeekNumber`(정오 시프트) vs `CalendarWidget.getWeekNumber`(자정 정규화). 두 알고리즘은 "1월 1일이 금요일인 해"(예: 2027)에만 결과가 갈리고 그때 정답(ISO)은 CalendarWidget 쪽이다 — 공용 모듈은 CalendarWidget 알고리즘을 채택하고, 2025~2026 전 구간 동치를 테스트로 증명한다(아래 Step 1). 2027 케이스는 구 구현의 +1 오차 버그가 함께 고쳐지는 것이므로 커밋 메시지에 명시한다.

- [ ] **Step 1: 실패 테스트 작성.** `tests/calendarDateUtils.test.ts` 를 아래 내용 그대로 생성 (마지막 `mapVacationEvents` 블록은 Task 1.4 에서 추가하므로 여기서는 넣지 않는다):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKDAYS, WEEKDAY_SHORT, fmtDate, parseDate, addDays, daysBetween,
  hexToRgba, getISOWeekNumber,
} from '../src/utils/calendarDate.ts';

test('fmtDate/parseDate — 왕복·패딩·정오 정규화', () => {
  assert.equal(fmtDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(fmtDate(parseDate('2026-08-24')), '2026-08-24');
  assert.equal(fmtDate(parseDate('2026-12-01')), '2026-12-01');
  assert.equal(parseDate('2026-02-01').getHours(), 12); // 기존 관례: 정오 정규화(경계 오차 방지)
});

test('addDays — 월/년/윤년 경계', () => {
  assert.equal(fmtDate(addDays(parseDate('2026-01-31'), 1)), '2026-02-01');
  assert.equal(fmtDate(addDays(parseDate('2026-12-31'), 1)), '2027-01-01');
  assert.equal(fmtDate(addDays(parseDate('2026-03-01'), -1)), '2026-02-28');
  assert.equal(fmtDate(addDays(parseDate('2028-02-28'), 1)), '2028-02-29');
});

test('daysBetween — 부호 포함 일수 차 (b - a)', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-24'), 23);
  assert.equal(daysBetween('2026-08-24', '2026-08-01'), -23);
  assert.equal(daysBetween('2026-08-24', '2026-08-24'), 0);
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
});

test('hexToRgba', () => {
  assert.equal(hexToRgba('#6C5CE7', 0.22), 'rgba(108,92,231,0.22)');
  assert.equal(hexToRgba('#00B894', 1), 'rgba(0,184,148,1)');
});

test('요일 배열', () => {
  assert.equal(WEEKDAYS.length, 7);
  assert.equal(WEEKDAYS[0], '일');
  assert.equal(WEEKDAYS[6], '토');
  assert.deepEqual(WEEKDAY_SHORT, WEEKDAYS);
});

test('getISOWeekNumber — 알려진 값', () => {
  assert.equal(getISOWeekNumber(new Date(2026, 0, 1)), 1);    // 2026-01-01 목 → 1주
  assert.equal(getISOWeekNumber(new Date(2026, 11, 31)), 53); // 2026 은 ISO 53주 해
  assert.equal(getISOWeekNumber(new Date(2025, 11, 29)), 1);  // 2025-12-29 월 → 2026년 1주차에 속함
  // 1/1 이 금요일인 해: 구 WeekScrollView 구현은 2 를 반환하던 케이스(정오 시프트 오차). ISO 정답은 1.
  assert.equal(getISOWeekNumber(new Date(2027, 0, 7)), 1);
});

test('getISOWeekNumber — 구 WeekScrollView 알고리즘과 2025~2026 전 구간 일치 (표시 불변 증명)', () => {
  // 구 구현 사본 (src/components/calendar/WeekScrollView.tsx:36-43 에서 그대로 복사)
  function oldWsvImpl(d: Date): number {
    const date = new Date(d.getTime());
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const yearStart = new Date(date.getFullYear(), 0, 1);
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }
  for (let d = new Date(2025, 0, 1, 12); d.getFullYear() <= 2026; d.setDate(d.getDate() + 1)) {
    assert.equal(getISOWeekNumber(d), oldWsvImpl(d), `주차 불일치: ${fmtDate(d)}`);
  }
});
```

- [ ] **Step 2: 실패 확인.** `node --test ./tests/calendarDateUtils.test.ts` → 기대: `ERR_MODULE_NOT_FOUND` (모듈 없음) 로 실패.
- [ ] **Step 3: 최소 구현.** `src/utils/calendarDate.ts` 를 아래 내용 그대로 생성 (기존 10곳의 실구현에서 채택 — 무의존 모듈, node --test 직접 import 가능):

```ts
// 캘린더 공용 날짜 유틸 — ScheduleView/캘린더 컴포넌트/훅/위젯 10곳의 로컬 복제를 대체.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAY_SHORT = WEEKDAYS;

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 'YYYY-MM-DD' → Date (정오 정규화 — 날짜 경계 오차 방지, 기존 관례 유지) */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** 두 'YYYY-MM-DD' 간 일수 차 (b - a, 부호 포함) */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** '#RRGGBB' → 'rgba(r,g,b,a)' */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * ISO 8601 주차 (1~53). 구 CalendarWidget.getWeekNumber 알고리즘(자정 정규화) 채택.
 * 구 WeekScrollView.getISOWeekNumber 는 정오 시프트 때문에 1/1 이 금요일인 해(예: 2027)에
 * +1 오차가 있었고, 이 모듈로 통일하면서 그 오차가 함께 수정됨 (2025~2026 은 결과 동일 — 테스트로 증명).
 */
export function getISOWeekNumber(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
```

- [ ] **Step 4: 통과 확인.** `node --test ./tests/calendarDateUtils.test.ts` → 기대: `# pass 7` / `# fail 0`. 커밋: `기능: 캘린더 공용 날짜 유틸 calendarDate 신설 (테스트 포함)`
- [ ] **Step 5: 파일별 교체 — 로컬 복제 삭제 후 import 로 대체.** 각 파일에서 아래 "삭제 대상"을 지우고 `import { ... } from '@/utils/calendarDate';` 추가(컴포넌트/훅은 vite 번들 대상이라 alias 사용 가능). **파일마다 삭제 전 `grep -n "function fmtDate\|function parseDate\|function addDays\|function daysBetween\|function hexToRgba\|WEEKDAYS\|getISOWeekNumber\|getWeekNumber" <파일>`** 로 실제 위치·사용처를 재확인한다. 실측 기준표:

  | 파일 | 삭제(→공용 import) | 로컬 유지 |
  |---|---|---|
  | `src/views/ScheduleView.tsx` | `WEEKDAYS`(42), `fmtDate`(44), `parseDate`(51), `addDays`(56), `daysBetween`(66) | `layoutEventBars` 등 (Task 1.5 에서 이동) |
  | `src/components/calendar/DayScrollView.tsx` | `fmtDate`(10), `parseDate`(17), `daysBetween`(22), `hexToRgba`(37) | `dayIndexToDate`, `daysInYear` |
  | `src/components/calendar/DaySidebar.tsx` | `fmtDate`(9) | `dayIndexToDate` |
  | `src/components/calendar/WeekScrollView.tsx` | `WEEKDAYS`(8), `WEEKDAY_SHORT`(9), `fmtDate`(11), `parseDate`(18), `addDays`(23), `daysBetween`(29), `getISOWeekNumber`(36), `hexToRgba`(80) | `generateYearWeeks`, `findWeekIndexForDate` (export 유지) |
  | `src/components/calendar/WeekSidebar.tsx` | `fmtDate`(8) + `import { getISOWeekNumber } from './WeekScrollView'`(5) → `@/utils/calendarDate` 로 변경 | — |
  | `src/components/calendar/MiniCalendar.tsx` | `fmtDate`(18), `addDays`(25), `WEEKDAYS`(31) | — |
  | `src/components/calendar/EventSidePanel.tsx` | `parseDate`(28) | `formatDate`(한국어 'N년 N월 N일' 표기 — 공용화 대상 아님) |
  | `src/hooks/useCalendarDnD.ts` | `parseDate`(29), `fmtDate`(34), `daysBetweenDates`(47 — 사용처를 공용 `daysBetween` 으로 교체 후 삭제) | `addDaysToStr`(41)는 `fmtDate(addDays(parseDate(s), n))` 조합 one-liner 로 축소해 유지, `getDateFromElement` |
  | `src/hooks/useCalendarDragCreate.ts` | `parseDate`(12), `fmtDate`(17) | — |
  | `src/components/widgets/CalendarWidget.tsx` | `WEEKDAYS_SHORT`(17)→공용 `WEEKDAY_SHORT` 로 호출부 이름 변경, `getWeekNumber`(20)→공용 `getISOWeekNumber` 로 호출부 5곳(338,340,363,561,658) 변경, `fmtDate`(59), `parseDate`(66), `addDays`(71) | `getWeekStart`, `getDdayLabel`, `packEventRows`, `PENDING_VACATION_COLOR` |

  주의 2가지: (1) `WeekScrollView.tsx` 끝의 `export { generateYearWeeks, findWeekIndexForDate, getISOWeekNumber };`(249) 에서 `getISOWeekNumber` 를 제거한다 — 외부 소비자는 `WeekSidebar`(위에서 교체)와 `ScheduleView`(import 안 함) 뿐임을 `grep -rn "getISOWeekNumber" src` 로 확인. (2) `WEEKDAYS`/`WEEKDAY_SHORT` 는 값이 같은 배열이므로 어느 이름을 쓰든 동작 동일 — 호출부 이름만 공용 모듈 기준으로 맞춘다.
- [ ] **Step 6: 전체 검증.** `npm run typecheck` → 에러 0. `node --test ./tests/calendarDateUtils.test.ts` → pass. `grep -rn "function fmtDate\|function parseDate(" src` → 기대: `src/utils/calendarDate.ts` 1곳뿐.
- [ ] **Step 7: 주차 표시 불변 실기 확인.** 프리뷰(chunk0 §0.3)에서: 캘린더 탭 → `주` 모드 전환 → 좌측 주차 리스트와 본문의 `W##` 라벨이 상식적 주차(오늘 날짜 기준 ISO 주차)인지 확인 → `2주` 모드도 동일 확인 → 대시보드의 캘린더 위젯에서 주 관련 표시(주차 라벨) 정상 확인. 테스트의 "2025~2026 전 구간 일치" 가 이미 수치 동치를 증명하므로 여기서는 렌더 확인만.
- [ ] **Step 8: 커밋.** 예: `리팩터링: 날짜 유틸 10곳 로컬 복제를 calendarDate 공용 모듈로 통일 (2027년 주차 +1 오차 겸 수정)`

---

### Task 1.4: `src/utils/vacationEvents.ts` 신설 — 휴가 매핑 3중복 공용화

**Files:**
- Create: `src/utils/vacationEvents.ts`
- Test: `tests/calendarDateUtils.test.ts` (테스트 블록 추가)
- Modify: `src/views/ScheduleView.tsx`, `src/components/widgets/CalendarWidget.tsx`, `src/views/CalendarView.tsx`

3곳의 매핑은 id 접두(`vac-`/`wvac-`/`gvac-`)만 다르고 나머지 필드는 완전 동일(실측 확인: `ScheduleView.tsx:1271-1284`, `CalendarWidget.tsx:131-144`, `CalendarView.tsx:313-326`). CalendarWidget 의 **pending 휴가 변환**(`wvac-pending-` 접두, `PENDING_VACATION_COLOR`, "(등록 중)" 제목)은 필드 구성이 달라 **공용화 대상이 아니다 — 그대로 둔다**.

- [ ] **Step 1: 실패 테스트 추가.** `tests/calendarDateUtils.test.ts` 끝에 아래 블록 추가:

```ts
import { mapVacationEvents } from '../src/utils/vacationEvents.ts';
import { VACATION_COLOR } from '../src/types/vacation.ts';

test('mapVacationEvents — 접두별 ID·읽기전용·필드 매핑', () => {
  const raw = [
    { name: '배한솔', type: '연차', startDate: '2026-09-01', endDate: '2026-09-02' },
    { name: '허혜원', type: '오전반차', startDate: '2026-09-03', endDate: '2026-09-03' },
  ];
  for (const prefix of ['vac', 'wvac', 'gvac'] as const) {
    const mapped = mapVacationEvents(raw, prefix);
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].id, `${prefix}-배한솔-2026-09-01-0`);
    assert.equal(mapped[1].id, `${prefix}-허혜원-2026-09-03-1`);
  }
  const [a] = mapVacationEvents(raw, 'vac');
  assert.equal(a.title, '배한솔 연차');
  assert.equal(a.memo, '');
  assert.equal(a.color, VACATION_COLOR);
  assert.equal(a.type, 'vacation');
  assert.equal(a.startDate, '2026-09-01');
  assert.equal(a.endDate, '2026-09-02');
  assert.equal(a.createdBy, '배한솔');
  assert.equal(a.vacationType, '연차');
  assert.equal(a.vacationUserName, '배한솔');
  assert.equal(a.isReadOnly, true);
});
```

  (import 문은 파일 상단 import 묶음으로 올린다.) `node --test ./tests/calendarDateUtils.test.ts` → 기대: `vacationEvents` 모듈 없음으로 실패.
- [ ] **Step 2: 구현.** `src/utils/vacationEvents.ts` 생성 (node --test 직접 import 가능해야 하므로 **상대 import + .ts 확장자** — `src/utils/characterAssets.ts` 의 기존 관례와 동일):

```ts
// 휴가(VacationEvent) → 캘린더 이벤트 변환 공용화.
// 기존 3중복: ScheduleView('vac')/CalendarWidget('wvac')/CalendarView('gvac') — 접두만 달랐음.
// node --test 가 직접 import 하는 모듈: @/ alias 금지, 상대 import 만.
import type { CalendarEvent } from '../types/calendar.ts';
import { VACATION_COLOR, type VacationEvent } from '../types/vacation.ts';

export type VacationIdPrefix = 'vac' | 'wvac' | 'gvac';

export function mapVacationEvents(raw: VacationEvent[], idPrefix: VacationIdPrefix): CalendarEvent[] {
  return raw.map((v, i) => ({
    id: `${idPrefix}-${v.name}-${v.startDate}-${i}`,
    title: `${v.name} ${v.type}`,
    memo: '',
    color: VACATION_COLOR,
    type: 'vacation' as const,
    startDate: v.startDate,
    endDate: v.endDate,
    createdBy: v.name,
    createdAt: new Date().toISOString(),
    vacationType: v.type,
    vacationUserName: v.name,
    isReadOnly: true,
  }));
}
```

- [ ] **Step 3: 통과 확인.** `node --test ./tests/calendarDateUtils.test.ts` → `# fail 0`.
- [ ] **Step 4: 3곳 교체.** 각 파일에서 인라인 `.map((v, i) => ({...}))` 블록을 `mapVacationEvents(raw, '<접두>')` 호출로 교체하고, 더 이상 안 쓰이면 `VACATION_COLOR` import 를 제거한다(파일 내 다른 사용처 grep 후):
  - `ScheduleView.tsx` `loadVacationEvents`(1266-1290): `setVacationEvents(mapVacationEvents(raw, 'vac'))`.
  - `CalendarWidget.tsx` 휴가 로드 effect(127-147): `setVacationEvts(mapVacationEvents(raw, 'wvac'))`. pending 변환(149-163)은 그대로.
  - `CalendarView.tsx` 휴가 로드 effect(305-334): `const mapped = mapVacationEvents(raw, 'gvac');` 후 기존 merge 로직 유지.
  - 재grep: `grep -rn "vac-\${v.name}\|wvac-\${v.name}\|gvac-\${v.name}" src` → 0건 (인라인 매핑 잔존 없음).
- [ ] **Step 5: 검증 + 커밋.** `npm run typecheck` → 에러 0. 프리뷰는 휴가 mock 이 빈 값이라 휴가 바 렌더는 확인 불가 — "휴가 미연동 상태에서 캘린더 탭·위젯·타임라인 탭이 오류 없이 렌더" 만 확인(콘솔 에러 0). 커밋: `리팩터링: 휴가 이벤트 매핑 3중복을 vacationEvents 공용 모듈로 통일`

---

### Task 1.5: ScheduleView 분해 — CalendarGrid·EventCreateModal 을 파일로 이동

**Files:**
- Create: `src/components/calendar/CalendarGrid.tsx` (CalendarGrid + EventBarChip + OverflowPopup + layoutEventBars + EventBar 타입)
- Create: `src/components/calendar/EventCreateModal.tsx`
- Modify: `src/views/ScheduleView.tsx`

원칙: **이동 위주, 로직 변경 금지** (설계 §10, 캐릭터 현황판 뷰 분해 #192 선례). `OverflowPopup` 은 `CalendarGrid` 전용(그리드 내부에서만 렌더)이므로 별도 파일 대신 `CalendarGrid.tsx` 안에 비공개 컴포넌트로 함께 이동한다(chunk0 파일 지도와 일치). 참고: 설계서 §10 은 `OverflowPopup.tsx` 를 별도 파일로 나열하지만 이 플랜은 `CalendarGrid.tsx` 내부 비공개 컴포넌트로 유지한다(그리드 전용 내부 컴포넌트라 단일 파일이 응집도상 우수 — 의도된 편차). PR 본문 상세 섹션에도 이 한 줄을 남길 것.

- [ ] **Step 1: 이동 범위 재확인.** `grep -n "^function \|^const \|^interface \|^export" src/views/ScheduleView.tsx` 로 현재 최상위 심볼 목록·순서를 확인. 이동 대상(Task 1.2 반영 후 기준): `EventBar` 인터페이스 + `layoutEventBars` + `EventBarChip` + `OverflowPopup` + `CalendarGrid` → `CalendarGrid.tsx` / `EventCreateModal` → `EventCreateModal.tsx`. ScheduleView 에 남는 것: `syncCalendarToTodo`/`unlinkTodoFromCalendar` 헬퍼 + `ScheduleView` 본체.
- [ ] **Step 2: `CalendarGrid.tsx` 생성.** 위 5개 심볼을 코드 그대로 잘라 붙이고 필요한 import 만 구성: `react`(useState/useMemo/useRef 등 실사용분), `react-dom`(createPortal), `framer-motion`(motion, AnimatePresence), lucide(`X`, `Palmtree`, `CheckSquare` — 이동한 코드가 실제 쓰는 것만 grep 으로 확정), `@/utils/cn`, `@/utils/calendarDate`(fmtDate/parseDate/addDays/daysBetween/WEEKDAYS), `@/utils/glassStyles`(floatingGlassStyle/tooltipGlassStyle), `@/types/calendar`(CalendarEvent), `@/hooks/useCalendarDnD`(type DragMode/DragPreview). export 는 `export function CalendarGrid` 하나(EventBarChip/OverflowPopup/layoutEventBars 는 파일 내부 비공개 유지 — 외부 참조 0건 grep 확인). 단 `src/views/VacationView.tsx:49` 부근의 `layoutEventBars` 는 import 가 아닌 독립 로컬 사본이므로 무관 — 건드리지 말 것. **주의**: 셀의 `data-date` 속성과 DOM 구조를 절대 바꾸지 않는다(`useCalendarDnD`/`useCalendarDragCreate` 가 `data-date` 셀 탐지에 의존).
- [ ] **Step 3: `EventCreateModal.tsx` 생성.** `EventCreateModal` 을 그대로 이동. import: `react`, `framer-motion`, lucide(`X`), `@/utils/cn`, `@/utils/calendarDate`(fmtDate), `@/utils/glassStyles`(floatingGlassStyle), `@/stores/useAuthStore`/`useDataStore`/`useAppStore`, `@/types/calendar`(CalendarEvent/CalendarEventType/EVENT_COLORS), `@/types`(DEPARTMENT_CONFIGS). props 타입(episodes 인라인 타입 포함)은 현재 시그니처 그대로 유지 — PR3 에서 개편 예정이므로 여기서 시그니처를 만지지 않는다. `export function EventCreateModal`.
- [ ] **Step 4: ScheduleView 정리.** 이동한 심볼 삭제 → `import { CalendarGrid } from '@/components/calendar/CalendarGrid';`, `import { EventCreateModal } from '@/components/calendar/EventCreateModal';` 추가 → 이동으로 안 쓰이게 된 import(createPortal, X, Palmtree/CheckSquare, tooltipGlassStyle, DEPARTMENT_CONFIGS, EVENT_COLORS 등)를 **각각 파일 내 grep 후** 제거(헤더 필터 UI 가 아직 Palmtree(1911)를 쓰는 등 잔존 사용처 있음 — 기계적 일괄 제거 금지).
- [ ] **Step 5: 줄수 확인.** `wc -l src/views/ScheduleView.tsx src/components/calendar/CalendarGrid.tsx src/components/calendar/EventCreateModal.tsx` → 목표: ScheduleView **1000줄 이하** (실측 예상: 2111 − 죽은코드 약 250 − 이동 약 860 ≈ 1000 부근). 1000을 조금 넘으면 원인만 기록하고 추가 분해는 하지 않는다(과잉 분해 금지 — PR3 에서 헤더/필터 개편 때 자연 감소).
- [ ] **Step 6: 검증.** `npm run typecheck` → 에러 0. `npm run test:ui && node --test ./tests/calendarDateUtils.test.ts` → pass.
- [ ] **Step 7: 프리뷰 실기 확인 (이동 회귀 체크 — 구체 경로).** chunk0 §0.3 절차로 프리뷰 진입 후:
  1. 캘린더 탭 → 월 그리드 렌더, 오늘 셀 강조 확인.
  2. 빈 셀에서 2~3일 드래그 → 생성 모달 열림 + 시작/종료일 프리필 확인 → 제목 `분해 테스트` 입력 → `이벤트 추가` → 그리드에 바 표시.
  3. 바 클릭 → EventSidePanel 열림. 바 우클릭 → EventQuickEdit 팝오버 → 색 변경 → 즉시 반영.
  4. 바 몸통 드래그로 다른 날짜로 이동 → 이동 반영. 바 끝 리사이즈 → 기간 변경 반영.
  5. 한 날짜에 이벤트를 5개 이상 만들고 `+N개` 오버플로우 클릭 → OverflowPopup 열림/닫힘.
  6. 퀵에디트에서 삭제 → 바 사라짐.
- [ ] **Step 8: 커밋.** 예: `리팩터링: ScheduleView 분해 — CalendarGrid·EventCreateModal 파일 분리 (로직 변경 없음)`

---

### Task 1.6: `test:calendar` 스크립트 신설 + 빌드 게이트 연결

**Files:**
- Modify: `package.json` (scripts 3줄)

- [ ] **Step 1: 스크립트 추가.** `package.json` scripts 에 (기존 `test:ui` 다음 줄):
  ```
  "test:calendar": "node --test ./tests/calendarDateUtils.test.ts",
  ```
- [ ] **Step 2: 빌드 체인 삽입.** `build` 와 `build:vite` 두 체인 모두에서 `npm run test:ui &&` 바로 뒤에 `npm run test:calendar &&` 를 삽입 (두 체인의 테스트 나열이 동일해야 함 — diff 로 두 줄 비교 확인).
- [ ] **Step 3: 검증.** `npm run test:calendar` → `# fail 0`. 커밋: `빌드: test:calendar 게이트 신설 (날짜 유틸·휴가 매핑 테스트)`

---

### Task 1.7: 마무리 — 검증 게이트 · update-notes · 버전 · PR · 리뷰 루프

**Files:**
- Modify: `DEVLOG/update-notes.json`, `package.json`, `package-lock.json`

- [ ] **Step 1: 전체 검증 게이트 (chunk0 §0.3 순서 그대로).**
  1. `npm run typecheck` → 에러 0.
  2. `npm run test:ui && npm run test:calendar` → 전부 pass.
  3. `npm run build:vite` → 성공 (전체 테스트 체인 + vite build 포함, 수 분 소요).
  4. 프리뷰 실기 최종 확인 — **PR1 전용 체크리스트**:
     - 월/2주/주/오늘 4모드 전환이 모두 렌더되고 콘솔 에러 0.
     - 월: 드래그 생성 → 모달(제목 `새 이벤트`) → 생성 → 바 클릭 패널 → 우클릭 퀵에디트(색 변경·복제·삭제) → 바 드래그 이동/리사이즈.
     - 주/오늘: 카드 클릭 → 패널 열림, 날짜 셀 클릭 → 생성 모달 열림(이 경로는 Task 1.2 Step 6 에서 보존한 실동작).
     - 미니 달력(월 모드 좌측) 날짜 클릭 동작.
     - 키보드: 월 모드 화살표 이동 + Enter, Esc 로 패널 닫기.
     - 대시보드 캘린더 위젯: 4모드 전환 렌더 + 주차 라벨 표시 (읽기 전용 그대로).
     - 타임라인 탭(코드명 `calendar`): 진입 시 오류 없음 (휴가 매핑 교체 영향권).
     - 나만 보기 체크 생성 1건: 프리뷰 mock 특성상 id 고정(`mock-private`)이므로 **1건만** 만들어 표시 확인 (2건 이상은 기존 mock 버그로 충돌 — 회귀 아님, 연구 §3 A-13).
- [ ] **Step 2: update-notes.json 항목 추가.** 배열 맨 앞에 추가(최신이 위, 기존 구조 `{version, title, items:[{category, summary, description}]}` 준수, category 는 `stability` 사용). 동작 불변 PR 이므로 짧게 1항목:
  ```json
  {
    "version": "<Step 3 에서 확정한 버전>",
    "title": "캘린더 내부 정리",
    "items": [
      {
        "category": "stability",
        "summary": "캘린더 안쪽을 크게 정리했어요 — 화면에서 달라지는 건 없어요",
        "description": "다음에 나올 공유 캘린더 기능을 준비하면서 캘린더 안쪽을 정리했어요. 오랫동안 안 쓰이던 부품을 걷어내고 여러 곳에 흩어져 있던 같은 계산을 하나로 합쳤어요. 보이는 모습과 쓰는 방법은 이전과 완전히 같고, 앞으로 캘린더 업데이트가 더 빠르고 안전해져요."
      }
    ]
  }
  ```
  검증: `npm run test:auto-update` → pass (`releaseNoteCategories` 테스트가 category 값을 검사).
- [ ] **Step 3: 버전 산정.** chunk0 §0.3 규칙: `git fetch origin && git show origin/main:package.json | grep '"version"'` 로 **PR 생성 직전 origin/main 버전** 확인 후 마이너 +1 (2026-08-24 기준 1.102.0 → 예상 1.103.0, 다른 PR 선머지 시 재산정). `package.json` + `package-lock.json` 2곳(최상단 `version` + `packages[""].version`) 3자 일치. 확인: `grep -n '"version"' package.json package-lock.json | head -3`. Step 2 의 update-notes `version` 도 동일 값으로. 커밋: `버전: v1.103.0 — 캘린더 정리 라운드 (update-notes 포함)`
- [ ] **Step 4: PR 생성.** `pr-creator` 스킬 사용 (chunk0 §0.3 — "📋 업데이트 요약" 은 비개발자 톤: Step 2 description 재사용 가능. 상세 기술 섹션에는 삭제 목록·유틸 공용화·2027 주차 오차 수정·분해 결과 줄수를 개발자 톤으로 기술). base=main, head=claude/calendar-pr1-cleanup. **머지는 한솔 지시 대기.**
- [ ] **Step 5: 코덱스 리뷰 루프.** `codex-review-loop` 스킬로 PR 리뷰 트리거 → P1/P2/P3 수정·재트리거 → 명시적 완료 신호(`Didn't find any major issues` 등)까지 반복. 리뷰 반영 커밋 후에는 Step 1 의 게이트(최소 typecheck + test:calendar + test:ui)를 다시 통과시킨다.
- [ ] **Step 6: 종료 보고.** PR 링크 + 검증 결과 요약(테스트 pass 수, ScheduleView 최종 줄수, 프리뷰 확인 항목)을 남기고, 머지·배포는 진행하지 않는다 (chunk0 §0.3 게이트).

---

### 부록 A: 실측 근거 스냅샷 (2026-08-24, 작업 시 grep 재검증용)

플랜 작성 시점에 워크트리에서 전 항목을 파일 열어 확인한 값. 작업 시작 시 아래 명령으로 드리프트 여부를 먼저 판정하라 — **수치가 다르면 다른 PR 이 먼저 머지된 것이므로, 줄 번호가 아니라 심볼 grep 기준으로 진행**한다.

```
wc -l src/views/ScheduleView.tsx src/services/calendarService.ts src/types/calendar.ts \
  src/components/calendar/*.tsx src/components/widgets/CalendarWidget.tsx \
  src/hooks/useCalendarDnD.ts src/hooks/useCalendarDragCreate.ts
```

기대(스냅샷): ScheduleView 2111 / calendarService 638 / types/calendar 90 / EventCreateTooltip 387 / DayScrollView 434 / DaySidebar 167 / WeekScrollView 554 / WeekSidebar 186 / MiniCalendar 230 / EventSidePanel 488 / EventQuickEdit 291 / CalendarWidget 879 / useCalendarDnD 183 / useCalendarDragCreate 230.

**삭제 대상 심볼 위치 스냅샷 (ScheduleView.tsx):**

| 심볼 | 위치(실측) | 판정 근거 |
|---|---|---|
| `EventDetailModal` | 412-547 (함수), 아이콘 사용 486-538 | `<EventDetailModal` JSX 렌더 0건 |
| `TodayView` | 1091-1156 | `<TodayView` 렌더 0건 |
| `editEvent` state / `handleUpdateEvent` | 1207 / 1421-1434 | `setEditEvent` 호출 6곳(1432,1529,1623,2001,2016,2068) 전부 `null` → 편집 모드 도달 불가 |
| `EventCreateModal` 편집 분기 | 556,563,572,574-585,599,629,677,850 | `isEditMode` 사용처 5곳 실측 |
| `detailEvent` | 1208, set 1466/1483 | 읽기 0건 |
| `handleDateClick` | 1451-1454 (빈 함수), prop 2030, 그리드 내부 868/888/984 | 셀 onClick 이 no-op 호출 |
| `weekOffset` | 1240, deps 1350, set 1384 | 값 읽기 0건 (deps 등장만) |
| `dragState` destructure | 1524 | ScheduleView 내 사용 0건 (훅 내부 사용은 정상) |
| `focusWeekIndex` prop | 876, 895 | CalendarGrid 내부 사용 0건 |
| `EventBarChip.compact` | 145, 149, 사용 273-274 | 호출부 1047 에서 미전달 → 항상 false 분기 |
| 미사용 import | `Filter`(5), `GripVertical`(6), `filterEventsByRange`(14), 로컬 `isSameDay`(62-64) | 파일 내 사용 0건 (289-290 의 `backdropFilter` 는 CSS 속성 — 오탐 주의) |
| `bflow:todos-changed` dispatch | 1172, 1182 | 수신 `addEventListener` 전 레포 0건 |

**기타 파일 스냅샷:** `types/calendar.ts` — `CalendarStore`(71), `vacationRowIndex`(55). `calendarService.ts` — `legacyLoaded`(213), `loadLegacyEvents`(216-220), `loadAllEvents`(222-225), 호출부 `getEvents`(228)·`syncAll`(235), `findEventByTodoId`(629-638), 모두 외부 참조 0건. `WeekScrollView.tsx` re-export 문(249)의 `getISOWeekNumber` 외부 소비자는 `WeekSidebar.tsx:5` 한 곳. 휴가 매핑 3곳: `ScheduleView.tsx:1271-1284` / `CalendarWidget.tsx:131-144` / `CalendarView.tsx:313-326` (필드 완전 동일, 접두만 상이 — dnd/pending 등 파생 없음 확인).

**테스트 현황 스냅샷:** `tests/calendarIntegrationStatus.test.ts` 22줄, 현재 단독 실행 pass(실측 `# pass 1`). `package.json` `test:ui` 는 3파일(sidebarNavVisibility/compositingCarouselLayer/compositorAssign). `build`/`build:vite` 테스트 체인 순서: playground → auto-update → entity → notifications → presence → character → ui. update-notes category 허용값: `bugfix|change|docs|feature|stability|ux` (`tests/releaseNoteCategories.test.ts`).

**프리뷰 mock 스냅샷 (`src/mocks/devElectronAPI.ts`):** `gcalIsAuthenticated → false`(1389), `gcalFullSync → []`(1396), `gcalInsertEvent → mock_<uuid>`(1398) — 공개 일정 생성·편집·드래그는 프리뷰 세션 내(캐시 수준)에서 동작하고 새로고침 시 사라지는 것이 **기존 정상 동작**이다. `supabaseAddPrivateEvent → id 고정 'mock-private'`(1084) — 나만 보기 2건 이상 생성 시 충돌은 기존 mock 버그(회귀 아님).

### 부록 B: 이 PR 의 알려진 함정 (lessons 반영)

1. **node --test 직접 import 모듈은 `@/` alias 금지** — `calendarDate.ts`(무의존)·`vacationEvents.ts`(상대 `.ts` import)로 준수. 레포 관례는 `src/utils/characterAssets.ts:1`(`'../types/index.ts'`) 참조. tsconfig `allowImportingTsExtensions: true` 라 `.ts` 확장자 import 가 typecheck 도 통과한다.
2. **커밋 경계마다 typecheck 시뮬레이션** (피드백 51~54 라운드 교훈) — 각 Task 의 커밋 스텝 직전 typecheck 가 이미 스텝에 박혀 있다. 스텝을 건너뛰고 몰아서 커밋하지 말 것.
3. **`noUnusedLocals:false`** — 미사용 심볼이 typecheck 를 통과하므로, "삭제 후 grep 0건" 확인이 유일한 회귀 방지 수단이다. 특히 `handleUpdateEvent` vs `handleUpdateEventDirect` 같은 접두 관계 심볼은 반드시 `\b` 경계 grep.
4. **WidgetPopup 경로** (피드백 51~54 교훈: 캘린더 표면 확장 시 팝업 경로 점검) — PR1 은 표시 로직을 바꾸지 않지만, CalendarWidget 을 수정하므로 Task 1.7 실기에서 위젯을 팝업으로 띄워(위젯 헤더의 팝업 버튼) 렌더까지 한 번 확인하면 좋다. 팝업에서 '전체' 버튼 무동작은 기존 이슈(연구 §1-2)로 회귀 아님.
5. **분해 시 `data-date` 셀 구조 보존** — `useCalendarDnD`/`useCalendarDragCreate` 가 DOM 의 `data-date` 속성 탐지로 동작한다. CalendarGrid 이동 시 마크업을 한 글자도 바꾸지 않는 것이 안전선.
6. **이 PR 은 브랜치가 오래 살면 손해** — 순수 정리라 충돌 표면이 넓다(ScheduleView 전역). PR2 이후 작업과 겹치지 않도록 PR1 을 먼저 리뷰 루프까지 완주시키고, 리베이스가 필요해지면 심볼 grep 기준으로 재적용한다.

---

## Chunk 2: PR2 — 데이터 계층 (브랜치 claude/calendar-pr2-data)

**전제**: PR1(정리·분해)이 origin/main 에 머지된 상태에서 시작. `git fetch origin && git checkout -b claude/calendar-pr2-data origin/main`. PR1 미머지면 STOP 하고 오너에게 보고.

**완료 기준**: 머지 후에도 화면 동작은 기존과 동일(레일·태그 UI 는 PR3). 달라지는 것은 저장 경로뿐 — "나만 보기" 일정이 개인 캘린더(`calendar_events`)로 저장되고, B flow 일정 로드가 구글 인증 가드 밖에서 항상 실행된다. **마이그레이션 SQL 라이브 적용 전에도 앱은 정상 동작**해야 한다(테이블 부재 → 빈 목록 + `console.warn`, 에러 토스트 금지, "나만 보기"는 기존 `private_calendar_events` 경로로 폴백).

**줄 번호 주의**: 아래 줄 번호는 조사 시점(main=93f2c9d, PR1 반영 전) 기준. PR1 이 ScheduleView 를 분해했으므로 **모든 수정 지점은 작업 시점에 grep 으로 재확인**한다.

---

### Task 2.1: 마이그레이션 SQL 작성 (라이브 적용은 별도 게이트)

**Files:**
- Create: `DEVLOG/migrations/2026-08-24-shared-calendars.sql`

이 파일은 **기록용**. 라이브 DB 적용은 PR2 머지 직후·G드라이브 배포 전, **한솔 확인 후 별도 게이트**로 수행(chunk0 §0.4, 설계서 §12 "DB 먼저, 앱 나중"). 이 Task 는 파일 작성 + 정적 검토까지만.

- [ ] **Step 1: 구 테이블 실제 스키마 재확인**
  - `sed -n '140,160p' DEVLOG/supabase-init.sql` — `private_calendar_events` 컬럼 확인. 기대: `id UUID`, `user_id TEXT`(FK 없음), `start_date/end_date TEXT`("YYYY-MM-DD 또는 ISO datetime" 주석), `created_at/updated_at TIMESTAMPTZ`, `created_by TEXT`(이름 문자열).
  - `grep -n "delete_user_cascade" DEVLOG/migrations/*.sql` — 최신 정의가 `2026-06-29-character-board-asset-workflow.sql:33` 인지 확인(더 최신 파일이 있으면 그것을 베이스로 복사).
- [ ] **Step 2: SQL 파일 작성** — 아래 전문을 그대로 작성(재실행 안전: `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / DO 블록 예외 흡수).

```sql
-- DEVLOG/migrations/2026-08-24-shared-calendars.sql
-- B flow 공유 캘린더 (PM 일정관리) — PR2 데이터 계층
-- 설계서: docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md §4·§4.1
-- 재실행 안전(idempotent). 라이브 적용은 PR2 머지 직후·배포 전 별도 게이트(한솔 확인 후).

-- ── 1) 신규 테이블 5개 (설계서 §4 DDL 그대로) ──────────────────
CREATE TABLE IF NOT EXISTS calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6C5CE7',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','members','team')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  is_personal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_personal ON calendars(owner_id) WHERE is_personal;
CREATE TABLE IF NOT EXISTS calendar_members (
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (calendar_id, user_id)
);
CREATE TABLE IF NOT EXISTS calendar_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  memo TEXT,
  tag_id UUID REFERENCES calendar_tags(id) ON DELETE SET NULL,
  all_day BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TEXT,          -- 'HH:MM' KST, all_day=false 일 때만
  end_time TEXT,
  linked_episode INTEGER,
  linked_part TEXT,
  linked_sheet_name TEXT,
  linked_scene_id TEXT,
  linked_department TEXT,
  linked_todo_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(calendar_id, start_date, end_date);
CREATE TABLE IF NOT EXISTS calendar_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_name TEXT,
  calendar_id UUID,          -- FK 없음: 캘린더 삭제 후에도 알림 문구 보존
  calendar_name TEXT,
  event_id UUID,
  event_title TEXT,
  event_date TEXT,           -- 이동 대상 날짜 YYYY-MM-DD
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  detail TEXT,               -- 예: '9/25 → 9/26'
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_calendar_notif_recipient
  ON calendar_notifications(recipient_id, created_at DESC);

-- ── 2) RLS allow_all (기존 관례: supabase-init.sql:255-259 의 pg_policies 존재 검사 패턴) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendars','calendar_members','calendar_tags','calendar_events','calendar_notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'allow_all') THEN
      EXECUTE format('CREATE POLICY "allow_all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- ── 3) 태그 시드 4행 (설계서 §4, 한솔이 태그 관리에서 수정 가능) ──
INSERT INTO calendar_tags (name, color, sort_order) VALUES
  ('업로드', '#E17055', 0),
  ('가편',   '#74B9FF', 1),
  ('대본',   '#FDCB6E', 2),
  ('회의',   '#A29BFE', 3)
ON CONFLICT (name) DO NOTHING;

-- ── 4) 기존 "나만 보기" 데이터 이관 (설계서 §4.1, 재실행 안전) ──
-- 4-1) private_calendar_events 사용자별 개인 캘린더 upsert
--      (users 에 없는 고아 user_id 는 FK 위반 방지를 위해 제외)
INSERT INTO calendars (name, color, visibility, owner_id, is_personal)
SELECT DISTINCT '개인', '#6C5CE7', 'private', p.user_id, true
FROM private_calendar_events p
JOIN users u ON u.id = p.user_id
ON CONFLICT (owner_id) WHERE is_personal DO NOTHING;

-- 4-2) 이벤트 복사 (id·created_at 유지, all_day=true, color 는 의도적으로 버림 — 설계서 §4.1)
--      구 created_by 는 이름 문자열이라 FK(users.id) 불만족 → 소유자 user_id 로 대체.
--      구 start_date 는 'YYYY-MM-DD 또는 ISO datetime' — 앞 10자만 잘라 DATE 캐스팅.
INSERT INTO calendar_events (id, calendar_id, title, memo, all_day, start_date, end_date,
  linked_episode, linked_part, linked_sheet_name, linked_scene_id, linked_department,
  linked_todo_id, created_by, created_at, updated_at)
SELECT p.id, c.id, p.title, p.memo, true,
  substring(p.start_date, 1, 10)::date, substring(p.end_date, 1, 10)::date,
  p.linked_episode, p.linked_part, p.linked_sheet_name, p.linked_scene_id, p.linked_department,
  p.linked_todo_id, p.user_id, p.created_at, p.updated_at
FROM private_calendar_events p
JOIN calendars c ON c.owner_id = p.user_id AND c.is_personal
WHERE substring(p.start_date, 1, 10) ~ '^\d{4}-\d{2}-\d{2}$'
  AND substring(p.end_date, 1, 10) ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT (id) DO NOTHING;

-- 4-3) private_calendar_events 테이블은 이번엔 남겨둠(롤백 + 구버전 앱 호환 — 설계서 §12).
--      다음 라운드에서 공존 창 델타 재이관 후 DROP.

-- ── 5) Realtime publication 4개 (재실행 시 duplicate_object 흡수) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendars','calendar_members','calendar_events','calendar_notifications'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ── 6) delete_user_cascade 갱신 (2026-06-29 판 전문 복사 + 캘린더 정리 추가) ──
-- 베이스: DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql:33-84
-- (더 최신 재정의가 있으면 그 판을 베이스로 할 것 — Step 1 에서 확인)
CREATE OR REPLACE FUNCTION public.delete_user_cascade(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_admin_id TEXT;
BEGIN
  SELECT name INTO v_user_name FROM users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- (여기에 2026-06-29 판의 scenes/comp_revisions/character_costumes UPDATE 블록을
  --  한 글자도 바꾸지 말고 그대로 복사해 넣는다)

  DELETE FROM personal_todos          WHERE user_id = p_user_id;
  DELETE FROM task_views              WHERE user_id = p_user_id;
  DELETE FROM memos                   WHERE user_id = p_user_id;
  DELETE FROM private_calendar_events WHERE user_id = p_user_id;

  -- ── 공유 캘린더 정리 (2026-08-24 추가, 설계서 §4) ──
  -- 작성자 표시는 nullable — FK(NO ACTION) 위반 방지
  UPDATE calendar_events SET created_by = NULL WHERE created_by = p_user_id;
  -- 개인 캘린더는 삭제 (이벤트는 ON DELETE CASCADE)
  DELETE FROM calendars WHERE owner_id = p_user_id AND is_personal;
  -- 공유 캘린더는 팀 자산 보존 — admin(배한솔 우선) 에게 소유 이전
  SELECT id INTO v_admin_id FROM users
  WHERE id <> p_user_id AND role = 'admin'
  ORDER BY (name = '배한솔') DESC, created_at ASC
  LIMIT 1;
  IF v_admin_id IS NOT NULL THEN
    -- 새 소유자가 이미 멤버 행으로 있으면 제거(소유자는 멤버 목록에 두지 않는 규약)
    DELETE FROM calendar_members m USING calendars c
      WHERE m.calendar_id = c.id AND c.owner_id = p_user_id AND m.user_id = v_admin_id;
    UPDATE calendars SET owner_id = v_admin_id, updated_at = now()
      WHERE owner_id = p_user_id;
  ELSE
    DELETE FROM calendars WHERE owner_id = p_user_id;  -- admin 부재(비정상) 폴백
  END IF;
  DELETE FROM calendar_members       WHERE user_id = p_user_id;
  DELETE FROM calendar_notifications WHERE recipient_id = p_user_id;

  DELETE FROM users WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.delete_user_cascade(TEXT) IS
  '사용자 삭제 + 종속 정리 atomic RPC. 씬/리테이크/복장 담당자 비우기 / 개인 데이터 삭제 / 개인 캘린더 삭제·공유 캘린더 admin 이전 / users 삭제를 한 트랜잭션으로. comments·activity_log 는 역사 기록으로 보존.';
```

- [ ] **Step 3: 주석 플레이스홀더 해소** — 위 전문의 "(여기에 2026-06-29 판의 … 그대로 복사)" 부분을 실제로 `2026-06-29-character-board-asset-workflow.sql:44-77`(scenes·comp_revisions·character_costumes 담당자 정리 블록) 원문으로 치환한다. 최종 파일에 플레이스홀더 주석이 남으면 안 된다.
  - 주의: 2026-06-29 마이그레이션의 줄 번호(44-77 류)를 그대로 믿지 말 것 — 'scenes·comp_revisions·character_costumes 담당자 UPDATE 블록만' 이라는 의미 기준으로 복사한다. 77행은 `DELETE FROM personal_todos` 라 줄 번호대로 복사하면 중복/조각이 섞인다.
- [ ] **Step 4: 정적 검토** — `grep -n "ON CONFLICT" DEVLOG/migrations/2026-08-24-shared-calendars.sql` → 3곳(태그 시드/개인 캘린더/이벤트 복사). ON CONFLICT 부분 인덱스 문법(`(owner_id) WHERE is_personal`)이 `idx_calendars_personal` 정의와 일치하는지, RLS·publication 루프의 테이블 배열이 각각 5개·4개인지 눈으로 확인.
- [ ] **Step 5: 커밋** — `git add DEVLOG/migrations/2026-08-24-shared-calendars.sql && git commit -m "공유 캘린더 마이그레이션 SQL 작성 (테이블 5개·태그 시드·나만보기 이관·cascade 갱신)"`

---

### Task 2.2: 권한 모듈 calendarPermissions + 역할 매트릭스 테스트 (TDD)

**Files:**
- Create: `src/shared/calendarPermissions.ts`
- Test: `tests/calendarPermissions.test.ts`
- Modify: `tsconfig.node.json` (composite 프로젝트가 electron→src/shared import 를 허용하도록 include 추가)

`src/shared/` 디렉터리는 현재 없다(신설). **상대 import 만** 사용(`@/` alias 금지 — node --test 직접 임포트 함정, tasks/lessons.md).

- [ ] **Step 1: 실패 테스트 작성** — `tests/calendarPermissions.test.ts` 를 아래 골격으로 작성(기존 `tests/createUuid.test.ts` 의 `.ts` 확장자 직접 import 스타일).

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canViewCalendar,
  canEditCalendarEvents,
  canManageCalendar,
  canCreateCalendar,
} from '../src/shared/calendarPermissions.ts';

const OWNER = 'u-owner';
const EDITOR = 'u-editor';    // can_edit=true 멤버
const VIEWER = 'u-viewer';    // can_edit=false 멤버
const OUTSIDER = 'u-outsider';
const ADMIN = { id: 'u-admin', role: 'admin' as const };
const NORMAL = (id: string) => ({ id, role: 'user' as const });
const MEMBERS = [{ user_id: EDITOR, can_edit: true }, { user_id: VIEWER, can_edit: false }];
const MEMBER_IDS = MEMBERS.map((m) => m.user_id);
const cal = (visibility: 'private' | 'members' | 'team', isPersonal = false) =>
  ({ owner_id: OWNER, visibility, is_personal: isPersonal });

test('canViewCalendar: 역할 매트릭스', () => {
  // private/members: 소유자·멤버만 (admin 이라도 비멤버면 안 보임 — 설계서 §5 공식 그대로)
  for (const vis of ['private', 'members'] as const) {
    for (const uid of [OWNER, EDITOR, VIEWER]) assert.equal(canViewCalendar(cal(vis), MEMBER_IDS, uid), true);
    for (const uid of [OUTSIDER, ADMIN.id]) assert.equal(canViewCalendar(cal(vis), MEMBER_IDS, uid), false);
  }
  for (const uid of [OUTSIDER, ADMIN.id]) assert.equal(canViewCalendar(cal('team'), [], uid), true);
});

test('canEditCalendarEvents: 소유자 + can_edit 멤버만', () => {
  for (const vis of ['private', 'members', 'team'] as const) {
    for (const uid of [OWNER, EDITOR]) assert.equal(canEditCalendarEvents(cal(vis), MEMBERS, uid), true);
    for (const uid of [VIEWER, OUTSIDER, ADMIN.id]) assert.equal(canEditCalendarEvents(cal(vis), MEMBERS, uid), false);
  }
});

test('canManageCalendar: 소유자 또는 admin, 단 개인 캘린더는 소유자만', () => {
  assert.equal(canManageCalendar(cal('members'), NORMAL(OWNER)), true);
  assert.equal(canManageCalendar(cal('members'), ADMIN), true);
  for (const uid of [EDITOR, OUTSIDER]) assert.equal(canManageCalendar(cal('members'), NORMAL(uid)), false);
  assert.equal(canManageCalendar(cal('private', true), NORMAL(OWNER)), true);
  assert.equal(canManageCalendar(cal('private', true), ADMIN), false);  // is_personal 특례: admin 제외
});

test('canCreateCalendar: team 은 admin 만', () => {
  assert.equal(canCreateCalendar(ADMIN, 'team'), true);
  assert.equal(canCreateCalendar(NORMAL(OUTSIDER), 'team'), false);
  for (const vis of ['private', 'members'] as const) {
    assert.equal(canCreateCalendar(NORMAL(OUTSIDER), vis), true);
    assert.equal(canCreateCalendar(ADMIN, vis), true);
  }
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/calendarPermissions.test.ts` → 모듈 없음(ERR_MODULE_NOT_FOUND) 실패가 정상.
- [ ] **Step 3: 최소 구현** — `src/shared/calendarPermissions.ts` 전문:

```ts
/** 공유 캘린더 권한 판정 순수 함수 (설계서 §5).
 *  메인(IPC 강제 지점)·렌더러(UI 노출)·node --test 3곳 공용.
 *  주의: @/ alias 금지 — node --test 가 직접 임포트 (상대 경로만). */

export interface CalendarPermissionTarget {
  owner_id: string;
  visibility: 'private' | 'members' | 'team';
  is_personal: boolean;
}

export interface CalendarMemberEntry {
  user_id: string;
  can_edit: boolean;
}

export interface PermissionUser {
  id: string;
  role: 'admin' | 'user';
}

/** 캘린더가 이 사용자에게 보이는가 — 소유자 / 팀 전체 / 멤버. */
export function canViewCalendar(
  cal: CalendarPermissionTarget,
  memberUserIds: string[],
  userId: string,
): boolean {
  return cal.owner_id === userId || cal.visibility === 'team' || memberUserIds.includes(userId);
}

/** 이 캘린더의 일정을 만들고/고치고/지울 수 있는가 — 소유자 + can_edit 멤버. */
export function canEditCalendarEvents(
  cal: CalendarPermissionTarget,
  members: CalendarMemberEntry[],
  userId: string,
): boolean {
  return cal.owner_id === userId || members.some((m) => m.user_id === userId && m.can_edit);
}

/** 캘린더 자체(이름·색·공개 범위·멤버·삭제)를 관리할 수 있는가.
 *  개인 캘린더(is_personal)는 admin 특례 없이 소유자 본인만 (설계서 §5). */
export function canManageCalendar(
  cal: CalendarPermissionTarget,
  user: PermissionUser,
): boolean {
  if (cal.is_personal) return cal.owner_id === user.id;
  return cal.owner_id === user.id || user.role === 'admin';
}

/** 이 공개 범위의 캘린더를 만들 수 있는가 — 팀 전체 캘린더는 admin 만 (결정 D2). */
export function canCreateCalendar(
  user: PermissionUser,
  visibility: 'private' | 'members' | 'team',
): boolean {
  return visibility !== 'team' || user.role === 'admin';
}
```

- [ ] **Step 4: 통과 확인** — `node --test ./tests/calendarPermissions.test.ts` → `pass 4, fail 0`.
- [ ] **Step 5: tsconfig.node.json include 확장** — Task 2.4 에서 electron 코드가 이 모듈을 import 하면 composite 프로젝트 특성상 TS6307(파일이 include 밖) 오류가 난다. 선제 수정: `"include": ["vite.config.ts", "electron"]` → `"include": ["vite.config.ts", "electron", "src/shared"]`. `npm run typecheck` → 통과 확인.
- [ ] **Step 6: 커밋** — `git commit -m "캘린더 권한 판정 순수 함수 4종 + 역할 매트릭스 테스트 (개인 캘린더 admin 특례 포함)"`

---

### Task 2.3: electron/calendarStore.ts — 메인측 Supabase CRUD

**Files:**
- Create: `electron/calendarStore.ts`

파일 배치 주의: 설계서 §6.1 은 `electron/supabase.ts` 확장 + `electron/calendarService.ts` 를 제시하지만, 이 플랜은 `electron/calendarStore.ts` + `electron/calendarIpc.ts` 로 구성한다 — 기능 동등, 파일 분리가 단일 책임상 우수한 의도된 편차이며 PR 본문에 명시한다.

`electron/supabase.ts` 의 private-event 함수군(1785-1862 부근 — `grep -n "readPrivateEvents" electron/supabase.ts` 로 재확인) 스타일을 따르되, **브로드캐스트는 여기서 하지 않는다** — 쓰기 성공 후 broadcast 는 Task 2.4 의 `calendarIpc.ts` 가 일괄 수행한다(private-event 함수는 supabase.ts 내부에서 broadcast 했지만, 새 모듈은 순수 CRUD 로 분리해 테스트·mock 오염을 막는다 — 의도된 편차이며 PR 본문에 한 줄 명시).

- [ ] **Step 1: 파일 작성** — 아래 구조와 핵심 코드로 `electron/calendarStore.ts` 작성.

```ts
/** electron/calendarStore.ts — B flow 공유 캘린더 Supabase CRUD (메인 전용).
 *  권한 검증·broadcast 는 calendarIpc.ts 담당 — 여기는 순수 데이터 접근만.
 *  마이그레이션 전(테이블 부재) 안전: 읽기는 빈 결과 + console.warn, 쓰기는 throw. */
import { supabase } from './supabase';

export interface CalendarRow {
  id: string; name: string; color: string;
  visibility: 'private' | 'members' | 'team';
  owner_id: string; is_personal: boolean;
  created_at: string; updated_at: string;
}
export interface CalendarMemberRow { calendar_id: string; user_id: string; can_edit: boolean }
export interface CalendarTagRow { id: string; name: string; color: string; sort_order: number }
export interface CalendarEventRow {
  id: string; calendar_id: string; title: string; memo: string | null;
  tag_id: string | null; all_day: boolean;
  start_date: string; end_date: string;   // supabase-js 는 DATE 를 'YYYY-MM-DD' 문자열로 반환
  start_time: string | null; end_time: string | null;
  linked_episode: number | null; linked_part: string | null; linked_sheet_name: string | null;
  linked_scene_id: string | null; linked_department: string | null; linked_todo_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
export interface CalendarNotificationRow {
  id: string; recipient_id: string; actor_id: string | null; actor_name: string | null;
  calendar_id: string | null; calendar_name: string | null;
  event_id: string | null; event_title: string | null; event_date: string | null;
  action: 'create' | 'update' | 'delete'; detail: string | null;
  created_at: string; read_at: string | null;
}

type SbError = { code?: string | null; message?: string | null } | null;

function throwIfError(error: SbError): void {
  if (error) throw new Error(error.message ?? 'Supabase error');
}

/** 마이그레이션 전 테이블 부재 — 42P01(Postgres) / PGRST205(PostgREST schema cache). */
function isMissingTable(error: SbError): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /does not exist|schema cache/i.test(error.message ?? '');
}

// ── 캘린더 ──────────────────────────────────────
export async function listCalendarsWithMembers(): Promise<{ calendars: CalendarRow[]; members: CalendarMemberRow[] }> {
  const { data, error } = await supabase
    .from('calendars').select('*').order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) {
      console.warn('[calendar] calendars 테이블 없음 — 마이그레이션 전, 빈 목록 반환');
      return { calendars: [], members: [] };
    }
    throw new Error(error.message);
  }
  // 팀 규모(~20명 × 캘린더 수십 개)라 1000행 상한과 무관 — 단일 조회
  const { data: memberData, error: memberError } = await supabase
    .from('calendar_members').select('calendar_id, user_id, can_edit');
  throwIfError(memberError);
  return { calendars: (data ?? []) as CalendarRow[], members: (memberData ?? []) as CalendarMemberRow[] };
}

export async function getCalendarWithMembers(calendarId: string): Promise<{ calendar: CalendarRow | null; members: CalendarMemberRow[] }> { /* .eq('id', id).maybeSingle() + 해당 캘린더 멤버 조회. 테이블 부재 시 { calendar: null, members: [] } + warn */ }
export async function createCalendar(input: { name: string; color: string; visibility: 'private' | 'members' | 'team'; owner_id: string; is_personal?: boolean }): Promise<CalendarRow> { /* insert().select('*').single() */ }
export async function updateCalendar(id: string, updates: Partial<Pick<CalendarRow, 'name' | 'color' | 'visibility'>>): Promise<void> { /* update({...updates, updated_at: new Date().toISOString()}).eq('id', id) */ }
export async function deleteCalendar(id: string): Promise<void> { /* delete().eq('id', id) — 이벤트는 CASCADE */ }
/** 멤버 전체 교체 — calendar_id 로 delete 후 members 를 insert (소유자 행은 넣지 않는 규약). 빈 배열이면 delete 만. */
export async function replaceMembers(calendarId: string, members: Array<{ user_id: string; can_edit: boolean }>): Promise<void> { /* delete → insert, throwIfError 2회 */ }

// ── 일정 ────────────────────────────────────────
/** 기간 조회 + .range() 페이지네이션 (PostgREST 1000행 제한 — project_postgrest_1000_row_cap). */
export async function listEventsInRange(params: {
  calendarIds: string[];
  from?: string;  // YYYY-MM-DD — end_date >= from
  to?: string;    // YYYY-MM-DD — start_date <= to
}): Promise<CalendarEventRow[]> {
  if (params.calendarIds.length === 0) return [];
  const PAGE = 1000;
  const all: CalendarEventRow[] = [];
  let offset = 0;
  for (;;) {
    let query = supabase
      .from('calendar_events').select('*')
      .in('calendar_id', params.calendarIds)
      .order('start_date', { ascending: true })
      .order('id', { ascending: true })     // 페이지 경계 결정성 확보
      .range(offset, offset + PAGE - 1);
    if (params.from) query = query.gte('end_date', params.from);
    if (params.to) query = query.lte('start_date', params.to);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) {
        console.warn('[calendar] calendar_events 테이블 없음 — 마이그레이션 전, 빈 목록 반환');
        return [];
      }
      throw new Error(error.message);
    }
    const rows = (data ?? []) as CalendarEventRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function getEventById(id: string): Promise<CalendarEventRow | null> { /* maybeSingle */ }
export async function createEvent(input: Omit<CalendarEventRow, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<CalendarEventRow> { /* insert().select('*').single() */ }
export async function updateEvent(id: string, updates: Partial<Omit<CalendarEventRow, 'id' | 'created_at'>>): Promise<CalendarEventRow> { /* update({...updates, updated_at: ...}).eq('id', id).select('*').single() */ }
export async function deleteEvent(id: string): Promise<void> { /* delete().eq('id', id) */ }

// ── 태그 ────────────────────────────────────────
export async function listTags(): Promise<CalendarTagRow[]> { /* sort_order asc — 테이블 부재 시 [] + warn */ }
/** 태그 일괄 저장 — 전달 목록이 최종 상태. 구현: listTags 로 기존 조회 → 전달 목록에 없는 id 는
 *  .delete().in('id', ...) (tag_id FK 가 ON DELETE SET NULL 이라 일정의 태그는 자동 '없음' 처리, 설계서 §3.5)
 *  → id 있는 행은 update, 없는 행은 insert → listTags() 재반환. */
export async function saveTags(tags: Array<{ id?: string; name: string; color: string; sort_order: number }>): Promise<CalendarTagRow[]> { /* 위 docstring 대로 */ }

// ── 알림 (PR2 는 저장소 함수만 — insert 호출은 PR4) ──
export async function insertNotifications(rows: Array<Omit<CalendarNotificationRow, 'id' | 'created_at' | 'read_at'>>): Promise<void> { /* insert(rows) — 부재/실패 시 console.warn 만 (best-effort, 설계서 §8) */ }
export async function listUnreadNotifications(recipientId: string, sinceIso: string): Promise<CalendarNotificationRow[]> { /* recipient_id eq + read_at is null + created_at gte + order desc — 부재 시 [] */ }
export async function markNotificationsRead(recipientId: string, ids: string[]): Promise<void> { /* update({read_at: now}).in('id', ids).eq('recipient_id', recipientId) — 본인 행만 */ }

// ── 사용자 role 재조회 (calendarIpc 의 admin 검증용) ──
export async function getUserRole(userId: string): Promise<'admin' | 'user'> {
  const { data, error } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  throwIfError(error);
  return ((data as { role?: string } | null)?.role === 'admin') ? 'admin' : 'user';
}

// ── 개인 캘린더 보장 (로그인 훅 — Task 2.5 에서 연결) ──
const ensuredPersonalFor = new Set<string>();
export async function ensurePersonalCalendar(userId: string): Promise<void> {
  if (ensuredPersonalFor.has(userId)) return;
  const { data, error } = await supabase
    .from('calendars').select('id').eq('owner_id', userId).eq('is_personal', true).maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.warn('[calendar] 개인 캘린더 조회 실패:', error.message);
    return;  // 마이그레이션 전 포함 — 조용히 no-op
  }
  if (data) { ensuredPersonalFor.add(userId); return; }
  const { error: insError } = await supabase.from('calendars').insert({
    name: '개인', color: '#6C5CE7', visibility: 'private', owner_id: userId, is_personal: true,
  });
  if (insError && insError.code !== '23505') {   // 23505 = 동시 로그인 레이스 — 정상
    console.warn('[calendar] 개인 캘린더 생성 실패:', insError.message);
    return;
  }
  ensuredPersonalFor.add(userId);
}
```

  주석으로 표시한 `/* ... */` 본문들은 완전 구현된 함수들(listCalendarsWithMembers / listEventsInRange / getUserRole / ensurePersonalCalendar)과 같은 패턴 + 각 docstring 명세대로 채운다. 읽기 계열(getCalendarWithMembers/listTags/listUnreadNotifications)은 모두 isMissingTable → 빈 결과 + warn. 최종 파일에 `/* ... */` 플레이스홀더가 남으면 안 된다.
- [ ] **Step 2: typecheck** — `npm run typecheck` → 통과(아직 아무도 import 안 하므로 unused 여부만).
- [ ] **Step 3: 커밋** — `git commit -m "메인 프로세스 캘린더 CRUD 모듈 추가 (마이그레이션 전 테이블 부재 안전 처리 포함)"`

---

### Task 2.4: electron/calendarIpc.ts — IPC 핸들러 + preload + ElectronAPI 타입

**Files:**
- Create: `electron/calendarIpc.ts`
- Modify: `electron/main.ts` (등록 호출 1줄 + import), `electron/preload.ts` (calendar* API 13개), `src/types/index.ts` (ElectronAPI 확장 — `grep -n "interface ElectronAPI" src/types/index.ts` → 1036 부근, private-event 시그니처는 1369 부근)

채널은 설계서 §6.1 표 그대로. 권한 강제 지점은 전부 이 파일이다.

- [ ] **Step 1: calendarIpc.ts 작성** — 핵심 전문:

```ts
/** electron/calendarIpc.ts — calendar:* IPC 등록.
 *  세션 검증(getSessionUserIdOrThrow 주입) + 권한 강제(calendarPermissions) + broadcast.
 *  main.ts 비대화 방지를 위해 분리. 렌더러 → 여기 → calendarStore → Supabase 단일 경로. */
import { ipcMain } from 'electron';
import {
  canViewCalendar, canEditCalendarEvents, canManageCalendar, canCreateCalendar,
} from '../src/shared/calendarPermissions';
import * as store from './calendarStore';
import type { CalendarRow, CalendarEventRow, CalendarMemberRow } from './calendarStore';
import { broadcastCalendarChanged, broadcastDataChange } from './broadcast';

interface CalendarIpcDeps { getSessionUserIdOrThrow: () => string }

function wrap<T extends unknown[], R>(fn: (...args: T) => Promise<R>) {
  return async (_e: unknown, ...args: T): Promise<R> => {
    try { return await fn(...args); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Calendar IPC]', msg);
      throw new Error(msg);   // main.ts 의 wrapIpc 와 같은 패턴
    }
  };
}

/** 일정 쓰기 성공 후 알림 파이프라인 진입점 (설계서 §8).
 *  PR4 에서 수신자 계산 + calendar_notifications insert 를 구현한다.
 *  PR2 에서는 호출 지점만 확정하고 의도적으로 아무것도 하지 않는다. */
async function emitCalendarEventNotifications(_ctx: {
  actorId: string; action: 'create' | 'update' | 'delete';
  calendar: CalendarRow; members: CalendarMemberRow[];
  event: CalendarEventRow | null; previous: CalendarEventRow | null;
}): Promise<void> {
  return;
}

const membersOf = (all: CalendarMemberRow[], calendarId: string) =>
  all.filter((m) => m.calendar_id === calendarId);

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const sessionUser = async () => {
    const id = deps.getSessionUserIdOrThrow();
    return { id, role: await store.getUserRole(id) };
  };
  /** 캘린더 + 멤버 로드, 요청자가 볼 수 없으면 throw. */
  const loadCalendarForUserOrThrow = async (calendarId: string, userId: string) => {
    const { calendar, members } = await store.getCalendarWithMembers(calendarId);
    if (!calendar) throw new Error('캘린더를 찾을 수 없습니다');
    if (!canViewCalendar(calendar, members.map((m) => m.user_id), userId)) {
      throw new Error('이 캘린더에 대한 권한이 없습니다');
    }
    return { calendar, members };
  };

  ipcMain.handle('calendar:list', wrap(async () => {
    const user = await sessionUser();
    const { calendars, members } = await store.listCalendarsWithMembers();
    return calendars
      .filter((cal) => canViewCalendar(cal, membersOf(members, cal.id).map((m) => m.user_id), user.id))
      .map((cal) => {
        const calMembers = membersOf(members, cal.id);
        return {
          ...cal,
          members: calMembers,
          can_edit: canEditCalendarEvents(cal, calMembers, user.id),
          can_manage: canManageCalendar(cal, user),
        };
      });
  }));

  ipcMain.handle('calendar:create', wrap(async (input: {
    name: string; color: string; visibility: 'private' | 'members' | 'team';
    members?: Array<{ user_id: string; can_edit: boolean }>;
  }) => {
    const user = await sessionUser();
    if (!canCreateCalendar(user, input.visibility)) {
      throw new Error('팀 전체 캘린더는 관리자만 만들 수 있습니다');
    }
    const created = await store.createCalendar({
      name: input.name, color: input.color, visibility: input.visibility,
      owner_id: user.id, is_personal: false,   // 개인 캘린더는 ensurePersonalCalendar 전용
    });
    if (input.members?.length && input.visibility !== 'private') {
      await store.replaceMembers(created.id, input.members.filter((m) => m.user_id !== user.id));
    }
    broadcastDataChange('calendars', 'INSERT');
    broadcastCalendarChanged('INSERT');
    return created;
  }));

  // calendar:events:create — (input: store.createEvent 파라미터) 흐름:
  //   sessionUser() → loadCalendarForUserOrThrow(input.calendar_id) →
  //   canEditCalendarEvents 아니면 throw('이 캘린더에 일정을 만들 권한이 없습니다') →
  //   store.createEvent({ ...input, created_by: user.id })  // 렌더러 주장 무시, 세션 id 강제
  //   → emitCalendarEventNotifications({action:'create', event:created, previous:null})
  //   → broadcastDataChange('calendar_events','INSERT') + broadcastCalendarChanged('INSERT')
  //   → created 반환.

  // calendar:update — 같은 골격: loadCalendarForUserOrThrow → canManageCalendar 검증 →
  //   is_personal 이면 patch 에서 visibility 제거(항상 private) → visibility 를 'team' 으로
  //   바꾸려면 canCreateCalendar(user,'team') 추가 검증 → store.updateCalendar →
  //   broadcastDataChange('calendars','UPDATE') + broadcastCalendarChanged('UPDATE').
  // calendar:delete — is_personal 이면 throw('개인 캘린더는 삭제할 수 없습니다') →
  //   canManageCalendar 검증 → store.deleteCalendar(일정은 DB CASCADE) → broadcast DELETE.
  // calendar:set-members — is_personal 이면 throw → canManageCalendar 검증 →
  //   store.replaceMembers(calendarId, members.filter(m => m.user_id !== calendar.owner_id)) →
  //   broadcastDataChange('calendar_members','UPDATE') + broadcastCalendarChanged('UPDATE').

  ipcMain.handle('calendar:events:list', wrap(async (params?: { from?: string; to?: string }) => {
    const user = await sessionUser();
    const { calendars, members } = await store.listCalendarsWithMembers();
    const visibleIds = calendars
      .filter((cal) => canViewCalendar(cal, membersOf(members, cal.id).map((m) => m.user_id), user.id))
      .map((cal) => cal.id);
    return store.listEventsInRange({ calendarIds: visibleIds, from: params?.from, to: params?.to });
  }));

  ipcMain.handle('calendar:events:update', wrap(async (
    id: string, updates: Parameters<typeof store.updateEvent>[1],
  ) => {
    const user = await sessionUser();
    const previous = await store.getEventById(id);
    if (!previous) throw new Error('일정을 찾을 수 없습니다');
    const { calendar, members } = await loadCalendarForUserOrThrow(previous.calendar_id, user.id);
    if (!canEditCalendarEvents(calendar, members, user.id)) {
      throw new Error('이 일정을 수정할 권한이 없습니다');
    }
    // 캘린더 이동(calendar_id 변경) 시 대상 캘린더 편집 권한도 검증
    if (updates.calendar_id && updates.calendar_id !== previous.calendar_id) {
      const target = await loadCalendarForUserOrThrow(updates.calendar_id, user.id);
      if (!canEditCalendarEvents(target.calendar, target.members, user.id)) {
        throw new Error('옮기려는 캘린더에 일정을 만들 권한이 없습니다');
      }
    }
    const updated = await store.updateEvent(id, updates);
    await emitCalendarEventNotifications({
      actorId: user.id, action: 'update', calendar, members, event: updated, previous,
    });
    broadcastDataChange('calendar_events', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return updated;
  }));

  // calendar:events:delete — getEventById 로 previous 조회(없으면 no-op return, idempotent) →
  //   loadCalendarForUserOrThrow + canEditCalendarEvents 검증 → store.deleteEvent →
  //   emitCalendarEventNotifications({action:'delete', event:null, previous}) →
  //   broadcastDataChange('calendar_events','DELETE') + broadcastCalendarChanged('DELETE').

  ipcMain.handle('calendar:tags:list', wrap(async () => {
    deps.getSessionUserIdOrThrow();   // 로그인만 요구
    return store.listTags();
  }));

  ipcMain.handle('calendar:tags:save', wrap(async (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => {
    const user = await sessionUser();   // users.role DB 재조회 — 렌더러 주장 불신 (설계서 §6.1)
    if (user.role !== 'admin') throw new Error('태그는 관리자만 수정할 수 있습니다');
    const saved = await store.saveTags(tags);
    broadcastDataChange('calendar_tags', 'UPDATE');
    broadcastCalendarChanged('UPDATE');
    return saved;
  }));

  // calendar:notifications:catchup — 세션 userId + since(최근 30일 ISO, 설계서 §8) 로
  //   store.listUnreadNotifications(userId, since) 반환.
  // calendar:notifications:mark-read — (ids: string[]) 받아
  //   store.markNotificationsRead(세션 userId, ids) — 본인 행만 갱신.
}
```

  주석으로 압축한 핸들러(calendar:update/delete/set-members, events:delete, notifications 2종)는 주석 명세 그대로 실제 `ipcMain.handle` 코드로 구현한다 — 최종 파일에 명세 주석 대신 구현이 있어야 한다.

- [ ] **Step 2: main.ts 등록** — `grep -n "supabase:delete-private-event" electron/main.ts` 로 비공개 일정 IPC 블록 끝을 찾고, 그 직후에 1줄 추가: `registerCalendarIpc({ getSessionUserIdOrThrow });` (함수 선언은 호이스팅되므로 참조 OK). 파일 상단 import 구역에 `import { registerCalendarIpc } from './calendarIpc';` 추가. `ensurePersonalCalendar` import 는 Task 2.5 에서.
- [ ] **Step 3: preload.ts 노출** — `grep -n "supabaseDeletePrivateEvent" electron/preload.ts` 아래에 블록 추가:

```ts
// ─── B flow 공유 캘린더 ───
calendarList: () => ipcRenderer.invoke('calendar:list'),
calendarCreate: (input: unknown) => ipcRenderer.invoke('calendar:create', input),
calendarUpdate: (id: string, updates: unknown) => ipcRenderer.invoke('calendar:update', id, updates),
calendarDelete: (id: string) => ipcRenderer.invoke('calendar:delete', id),
calendarSetMembers: (calendarId: string, members: unknown) => ipcRenderer.invoke('calendar:set-members', calendarId, members),
calendarEventsList: (params?: { from?: string; to?: string }) => ipcRenderer.invoke('calendar:events:list', params),
calendarEventCreate: (input: unknown) => ipcRenderer.invoke('calendar:events:create', input),
calendarEventUpdate: (id: string, updates: unknown) => ipcRenderer.invoke('calendar:events:update', id, updates),
calendarEventDelete: (id: string) => ipcRenderer.invoke('calendar:events:delete', id),
calendarTagsList: () => ipcRenderer.invoke('calendar:tags:list'),
calendarTagsSave: (tags: unknown) => ipcRenderer.invoke('calendar:tags:save', tags),
calendarNotificationsCatchup: () => ipcRenderer.invoke('calendar:notifications:catchup'),
calendarNotificationsMarkRead: (ids: string[]) => ipcRenderer.invoke('calendar:notifications:mark-read', ids),
```

- [ ] **Step 4: ElectronAPI 타입 추가** — `src/types/index.ts` 의 `supabaseDeletePrivateEvent` 시그니처(1400 부근, grep 재확인) 아래에 13개 메서드 타입을 추가한다. 기존 관례(1369-1404 의 private-event 블록)대로 **row 형태를 인라인 구조 타입으로** 쓴다. 반환 row 는 snake_case(DB 그대로): `calendarList(): Promise<Array<{ id: string; name: string; color: string; visibility: 'private'|'members'|'team'; owner_id: string; is_personal: boolean; created_at: string; updated_at: string; members: Array<{ user_id: string; can_edit: boolean }>; can_edit: boolean; can_manage: boolean }>>` / `calendarEventsList(params?: { from?: string; to?: string }): Promise<Array<{...CalendarEventRow 전 컬럼...}>>` / 나머지는 calendarIpc 핸들러 파라미터·반환과 1:1.
- [ ] **Step 5: typecheck 확인** — `npm run typecheck` → 통과. 실패 시 대표 원인: tsconfig.node.json include 누락(Task 2.2 Step 5), preload 와 ElectronAPI 시그니처 불일치.
- [ ] **Step 6: 커밋** — `git commit -m "캘린더 IPC 13종 추가 — 세션 검증 + 권한 강제 + 알림 훅 자리 (preload·타입 포함)"`

---

### Task 2.5: ensurePersonalCalendar — 로그인 시 개인 캘린더 보장

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 호출 위치 확인** — `grep -n "personalTodoCalendarSync.recover" electron/main.ts` → SessionManager 생성자의 `broadcast` 콜백(1773-1781 부근). 이 콜백은 login/restore/ensure 로 세션이 확립될 때마다 `payload.user` 와 함께 불린다 — `ensurePersonalCalendar` 의 정확한 훅 지점(신규 사용자 대응, 설계서 §4.1-4).
- [ ] **Step 2: 호출 추가** — `broadcast` 콜백의 `if (payload.user)` 블록 안에 추가(중복 방지는 calendarStore 의 `ensuredPersonalFor` Set 이 담당):

```ts
void calendarStore.ensurePersonalCalendar(payload.user.id).catch((error) => {
  console.warn('[calendar] 개인 캘린더 보장 실패 (다음 로그인에 재시도):', error);
});
```

  상단 import: `import * as calendarStore from './calendarStore';` (Task 2.4 에서 이미 추가했으면 재사용).
- [ ] **Step 3: 검증** — `npm run typecheck` 통과. 동작 확인은 마이그레이션 전이라 no-op 이 정상(라이브 적용 후 실기 확인 항목으로 Task 2.9 게이트에 기재).
- [ ] **Step 4: 커밋** — `git commit -m "로그인 세션 확립 시 개인 캘린더 자동 생성 훅 연결 (마이그레이션 전 no-op)"`

---

### Task 2.6: 렌더러 타입·서비스·스토어

**Files:**
- Modify: `src/types/calendar.ts`, `src/services/calendarService.ts`
- Create: `src/stores/useCalendarStore.ts`

- [ ] **Step 1: 타입 확장** — `src/types/calendar.ts` 에 추가(PR1 이 `CalendarStore`/`vacationRowIndex` 를 이미 삭제했는지 grep 확인 — 남아 있으면 이 PR 에서 삭제하지 말고 그대로 둠, PR1 몫):

```ts
/** B flow 자체 캘린더 (Supabase calendars 행의 렌더러 표현) */
export interface BflowCalendar {
  id: string; name: string; color: string;
  visibility: 'private' | 'members' | 'team';
  ownerId: string; isPersonal: boolean;
  members: CalendarMember[];
  canEdit: boolean;    // 메인 프로세스가 계산해 내려줌
  canManage: boolean;
  createdAt: string;
}
export interface CalendarMember { userId: string; canEdit: boolean }
export interface CalendarTag { id: string; name: string; color: string; sortOrder: number }
```

  `CalendarEvent` 인터페이스에 확장 필드 추가:

```ts
  // ── B flow 공유 캘린더 확장 (PR2) ──
  calendarId?: string;                       // 소속 B flow 캘린더 id
  tagId?: string;                            // 태그 (선택)
  allDay?: boolean;                          // 기본 true — false 면 startTime/endTime 사용
  startTime?: string;                        // 'HH:MM' (KST)
  endTime?: string;
  canEdit?: boolean;                         // 파생 — 캘린더 편집 권한
  source?: 'bflow' | 'google' | 'vacation';  // 파생 — 병합 캐시의 출처 구분
```

- [ ] **Step 2: useCalendarStore 작성** — `src/stores/useCalendarStore.ts` 신설. 기존 `useActivityStore` 의 수동 localStorage 패턴(zustand persist 미들웨어 미사용)을 따른다. 필수 요소:
  - state: `calendars: BflowCalendar[]`, `tags: CalendarTag[]`, `loaded: boolean`, `visibleCalendarIds: Record<string, boolean>`(명시적 false 만 저장, 기본 켬), `enabledTagIds: Record<string, boolean>`(동일), `mutedCalendarIds: string[]`. localStorage 키: `bflow_calendar_visible_v1` / `bflow_calendar_tags_enabled_v1` / `bflow_calendar_muted_v1` — 읽기·쓰기 전부 try/catch silent.
  - actions: `loadAll()`(= `calendarList` + `calendarTagsList` IPC → snake_case row 를 camelCase 로 매핑, 실패 시 빈 배열 + `console.warn` — 에러 토스트 금지), `toggleCalendarVisible(id)`, `toggleTag(id)`, `resetTagsAllOn()`, `toggleMuted(id)`.
  - selectors(파생 함수 export): `isCalendarVisible(state, id)`·`isTagEnabled(state, id)` — 키 없으면 true, `getPersonalCalendar(state, myUserId)` — `calendars.find(c => c.isPersonal && c.ownerId === myUserId)`. UI 소비는 PR3 — 이 PR 에서는 calendarService 가 색·권한 매핑에 사용.
- [ ] **Step 3: calendarService 병합 구조 개편** — `src/services/calendarService.ts`:
  - 모듈 변수를 source 별로 분리: `let bflowEvents: CalendarEvent[] = []; let googleEvents: CalendarEvent[] = [];` 및 `function rebuildEventCache(): void { const seen = new Set<string>(); eventCache = [...bflowEvents, ...googleEvents].filter((e) => !seen.has(e.id) && (seen.add(e.id), true)); }` — **bflow 를 앞에 두어 중복 id 는 calendar_events 우선**.
  - **낙관적 CRUD 경로도 소스 배열 기준으로 전부 재작성한다 (전면 규약 — sync 함수만 좁게 해석 금지)**: 이 PR 이후 `eventCache` 에 쓰는 코드는 `rebuildEventCache()` 내부 1곳만 남는다. 그렇지 않으면 `loadBflowEvents()` 가 `rebuildEventCache()` 를 호출하는 순간(뷰 마운트·위젯 cold-cache) eventCache 에만 반영돼 있던 낙관적 변경이 소스 배열 재조립으로 소실되는 정합성 구멍이 생긴다. 치환은 기계적이다 — 공용 헬퍼 추가:

```ts
/** 낙관적 CRUD 공용 헬퍼 — 두 소스 배열에 같은 변환을 적용 후 캐시 재조립.
 *  id 기준 map/filter 는 해당 id 가 한쪽 배열에만 존재하므로 양쪽 적용이 안전하다. */
function mutateSourceEvents(fn: (arr: CalendarEvent[]) => CalendarEvent[]): void {
  bflowEvents = fn(bflowEvents);
  googleEvents = fn(googleEvents);
  rebuildEventCache();
}
```

  - 낙관적 경로 치환 규약: (a) **push(생성)** — 레거시 비공개 분기(`PRIVATE_CAL_ID`, 378행 부근)와 신규 bflow 이벤트는 `bflowEvents.push(...)`, 구글 경로(420행 부근)는 `googleEvents.push(...)` 후 각각 `rebuildEventCache()` 호출; (b) **localId→서버 id 교체 / 필드 패치 / 롤백 / 삭제**(402-406·440-445·497·516·529·548·562·568·582·593·602행 부근 — 전부 id 기준 map/filter) — `mutateSourceEvents((arr) => arr.map(...))` / `mutateSourceEvents((arr) => arr.filter(...))` 로 치환, 어느 배열에 있는지 분기 불필요; (c) `broadcastCalendarChange` 호출 위치·인자는 기존 그대로 유지.
  - 상수 추가: `const BFLOW_CAL_PREFIX = 'bflow:';` — bflow 일정의 `sourceCalendarId` 는 `'bflow:' + calendarId` 규약.
  - 매핑 함수 신설 `toCalendarEventFromBflowRow(row, calendarsById)`: `color` = 소속 캘린더 색(없으면 `'#6C5CE7'`), `source: 'bflow'`, `sourceCalendarId: BFLOW_CAL_PREFIX + row.calendar_id`, `calendarId/tagId/allDay/startTime/endTime` 매핑, `canEdit` = 캘린더의 `canEdit`, `isReadOnly` = `!canEdit`, `type` 은 `linked_scene_id → 'scene'` / `linked_part → 'part'` / `linked_episode → 'episode'` / 그 외 `'custom'` (기존 칩 렌더 호환).
  - `loadBflowEvents()` 신설(export):

```ts
/** B flow 일정 로드 — 구글 인증 가드 밖에서 항상 호출된다 (설계서 §6.2 핵심). */
export async function loadBflowEvents(): Promise<void> {
  try {
    await useCalendarStore.getState().loadAll();
    const calendars = useCalendarStore.getState().calendars;
    const calendarsById = new Map(calendars.map((c) => [c.id, c]));
    const rows = await window.electronAPI.calendarEventsList();
    const next = rows.map((row) => toCalendarEventFromBflowRow(row, calendarsById));
    // 마이그레이션 전 폴백: 구 private_calendar_events 병행 읽기 — 중복 id 는 calendar_events 우선.
    const newIds = new Set(next.map((e) => e.id));
    try {
      const userId = useAuthStore.getState().currentUser?.id;
      if (userId) {
        const legacyRows = await window.electronAPI.supabaseReadPrivateEvents(userId);
        for (const row of legacyRows) {
          if (!newIds.has(row.id)) next.push(toCalendarEventFromPrivate(row));
        }
      }
    } catch (err) {
      console.warn('[Calendar] 구 비공개 일정 폴백 로드 실패:', err);
    }
    bflowEvents = next;
    rebuildEventCache();
    broadcastCalendarChange();
  } catch (err) {
    console.warn('[Calendar] B flow 일정 로드 실패:', err);
  }
}
```

  - `syncAll()` 수정: (a) 함수 첫머리의 비공개 이벤트 로드 블록(`supabaseReadPrivateEvents` try/catch)을 **삭제**하고 `await loadBflowEvents();` 로 대체(폴백 읽기가 loadBflowEvents 안으로 이동했으므로 중복 없음), (b) 끝의 `eventCache = [...events]` 를 `googleEvents = events; rebuildEventCache();` 로 교체. `syncIncremental()` 의 캐시 갱신부(312·323행 부근 filter 포함)도 같은 방식으로 googleEvents 만 갱신 후 rebuild. 마지막에 `grep -n "eventCache" src/services/calendarService.ts` 로 전수 확인 — **쓰기(`eventCache =` / `eventCache.push` / `eventCache[idx] =`)는 `rebuildEventCache()` 내부 1곳만 남고**, 나머지는 읽기(`eventCache.find` 등)여야 한다. 위 낙관적 경로 치환 규약이 적용됐다면 자동으로 충족된다. 또한 개편 후 `syncAll()` 반환값이 구글 이벤트만 담게 되므로, 반환값을 소비하는 호출자를 `grep -n "await syncAll\|= syncAll" src/` 로 전수 확인한다.
- [ ] **Step 4: bflow CRUD 라우팅** — 같은 파일:
  - `addBflowEvent(event, calendarId)` 내부 함수: 낙관적 push — `bflowEvents.push(...)` + `rebuildEventCache()`(source·color 매핑 포함, Step 3 치환 규약) → `calendarEventCreate({ calendar_id: calendarId, title, memo, tag_id: event.tagId ?? null, all_day: event.allDay ?? true, start_date, end_date, start_time: event.startTime ?? null, end_time: event.endTime ?? null, linked_* 컬럼들 })` → 성공 시 localId→서버 id 교체(`localToGcalId` 매핑 재사용, `mutateSourceEvents` 로 배열 갱신) → 실패 시 `mutateSourceEvents((arr) => arr.filter((e) => e.id !== localId))` 롤백 + rethrow. 기존 isPrivate 분기(371-408 부근)와 동일 골격.
  - `addEvent()`: 함수 첫머리에 `if (event.calendarId) { await addBflowEvent(event, event.calendarId); return; }` 분기 추가(그 아래 isPrivate 분기 처리 방식은 Task 2.7).
  - `updateEvent()`/`deleteEvent()`: `existing.sourceCalendarId?.startsWith(BFLOW_CAL_PREFIX)` 분기 추가 — 낙관적 패치·삭제·롤백은 전부 `mutateSourceEvents` 경유(Step 3 규약) → `calendarEventUpdate(id, patch)`/`calendarEventDelete(id)` → 실패 롤백. patch 매핑에 `calendar_id`(캘린더 이동)·`tag_id`·`all_day`·`start_time`·`end_time` 포함(UI 는 PR3 이지만 데이터 경로는 지금 완성). 기존 PRIVATE_CAL_ID 분기는 **그대로 유지**(마이그레이션 전 폴백 이벤트 편집용).
- [ ] **Step 5: typecheck + 도메인 테스트** — `npm run typecheck` → 통과. `node --test ./tests/calendarPermissions.test.ts` → 여전히 통과(회귀 확인).
- [ ] **Step 6: 커밋** — `git commit -m "렌더러 캘린더 타입·스토어·서비스 확장 — B flow 일정 병합 캐시와 CRUD 라우팅"`

---

### Task 2.7: 기존 "나만 보기" 경로 스위치 + 구글 가드 밖 로드

**Files:**
- Modify: `src/services/calendarService.ts` (addEvent isPrivate 분기), `src/views/ScheduleView.tsx`, `src/components/widgets/CalendarWidget.tsx` — PR1 분해로 로드 effect 가 `src/components/calendar/` 하위로 이동했을 수 있음: `grep -rn "isAuthenticated" src/views/ScheduleView.tsx src/components/calendar/ src/components/widgets/CalendarWidget.tsx` 로 실제 위치 확인

- [ ] **Step 1: isPrivate 저장 경로 스위치** — `calendarService.addEvent` 의 `if (event.isPrivate)` 분기(grep: `event.isPrivate`)를 수정: 분기 첫머리에서 `const personal = getPersonalCalendar(useCalendarStore.getState(), userId);` 조회 후,
  - `personal` 이 있으면(마이그레이션 후 정상 경로): `await addBflowEvent({ ...event, calendarId: personal.id }, personal.id); return;`
  - 없으면(마이그레이션 전): **기존 `supabaseAddPrivateEvent` 코드 그대로 실행**(폴백). 삭제 금지.
  - 방어: `addBflowEvent`(또는 해당 생성 함수) 진입 시 `useCalendarStore` 가 아직 로드 전(`loaded=false`)이면 `loadAll()` 을 한 번 await 한 뒤 personal 캘린더를 찾는다.
  - EventCreateModal 의 "나만 보기" 체크박스 UI 는 **건드리지 않는다**(개편은 PR3). 모달이 넘기는 `isPrivate: true` 이벤트가 서비스 계층에서 새 경로로 흘러갈 뿐.
- [ ] **Step 2: ScheduleView 가드 밖 로드** — 데이터 로드 effect(구 1245-1263, PR1 후 위치 grep)에서: gcal `isAuthenticated()` 확인 **전에** `await loadBflowEvents();` 를 무조건 호출. 구글 인증 시에만 `syncAll()` 호출하는 기존 로직은 유지. import 에 `loadBflowEvents` 추가.
- [ ] **Step 3: CalendarWidget 가드 밖 로드** — cold-cache effect(구 105-120)에서 동일 처리: `isAuthenticated` 체크와 무관하게 `loadBflowEvents()` 를 먼저 await. `bflow:calendar-changed` 리스너는 기존 그대로(캐시 재읽기라 자동 반영).
- [ ] **Step 4: typecheck + build 후 커밋** — `npm run typecheck && npm run build:vite` → 통과. `git commit -m "나만 보기 일정을 개인 캘린더로 저장 전환 (마이그레이션 전 구 경로 폴백) + B flow 일정 로드를 구글 인증 가드 밖으로"`

---

### Task 2.8: devElectronAPI mock — 신규 IPC 전부 in-memory

**Files:**
- Modify: `src/mocks/devElectronAPI.ts`

프리뷰(`?preview=1`)에서 새 경로가 살아 있어야 Task 2.9 실기 검증이 가능. 기본 데이터는 최소(개인 캘린더 1개 + 태그 4개 + 일정 0개) — 풍부한 seed 는 PR3 몫.
- [ ] **Step 1: 세션 변수 확인** — `grep -n "previewCanonicalUserId" src/mocks/devElectronAPI.ts` — 현재 로그인 mock 사용자 id 모듈 변수(1289 부근 loginCanonicalSession 에서 설정). mock 의 "내 개인 캘린더" 판정에 사용.
- [ ] **Step 2: in-memory 저장소 + 13개 mock 구현** — `mockAPI` 객체의 `supabaseDeletePrivateEvent` 근처(1086 부근)에 추가.
  - 모듈 상단: `const mockCalendars/mockCalendarEvents: Array<Record<string, unknown>> = []` + `mockCalendarTags` 4행(태그 시드와 동일: 업로드 `#E17055` 0 / 가편 `#74B9FF` 1 / 대본 `#FDCB6E` 2 / 회의 `#A29BFE` 3, id 는 `'tag-upload'` 등 고정 문자열).
  - `ensureMockPersonalCalendar()`: `previewCanonicalUserId` 없으면 null. `mockCalendars` 에서 `owner_id === userId && is_personal` 검색, 없으면 `{ id: 'mock-personal-'+userId, name: '개인', color: '#6C5CE7', visibility: 'private', owner_id: userId, is_personal: true, created_at/updated_at: now }` push 후 반환.
  - mock 메서드 13개: `calendarList`(ensureMockPersonalCalendar 후 owner 본인 것 + visibility 'team' 만 반환, `members: []`, `can_edit`/`can_manage` = owner 여부) / `calendarCreate·Update·Delete`(배열 조작, id 는 `createUuid()`) / `calendarSetMembers`(no-op) / `calendarEventsList`(보이는 캘린더의 이벤트) / `calendarEventCreate`(id `createUuid()` — 구 mock 의 `'mock-private'` 고정 id 버그 재현 금지) / `calendarEventUpdate·Delete` / `calendarTagsList`(위 4행) / `calendarTagsSave`(교체) / `calendarNotificationsCatchup`(`[]`) / `calendarNotificationsMarkRead`(no-op).
- [ ] **Step 3: typecheck** — `npm run typecheck` → 통과(ElectronAPI 인터페이스와 mock 시그니처 일치 확인이 여기서 걸러짐).
- [ ] **Step 4: 프리뷰 스모크** — `npm run dev:renderer` → `http://localhost:5190/?preview=1` → `배한솔`/`1234` 로그인 → 캘린더 탭: 빈 달력 정상 표시(콘솔에 캘린더 관련 uncaught 에러 0건). 일정 생성 모달에서 "나만 보기" 체크 후 저장 → 달력에 칩 표시 + 새로고침 없이 유지(개인 캘린더 mock 경로로 저장됐다는 뜻). devtools 콘솔에서 `localStorage` 에 `bflow_calendar_*` 키 생성 확인.
- [ ] **Step 5: 커밋** — `git commit -m "프리뷰 mock 에 캘린더 IPC 13종 추가 (개인 캘린더 자동 생성 + 고정 id 버그 미재현)"`

---

### Task 2.9: 마무리 — 검증 게이트 · update-notes · 버전 · PR · 코덱스 루프

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`

- [ ] **Step 1: test:calendar 스크립트 갱신** — `grep -n "test:calendar" package.json`. PR1 이 만든 스크립트에 `./tests/calendarPermissions.test.ts` 추가. (만약 PR1 이 스크립트를 만들지 않았다면 신설: `"test:calendar": "node --test ./tests/calendarDateUtils.test.ts ./tests/calendarPermissions.test.ts"` — PR1 테스트 파일 존재 여부는 `ls tests/calendarDateUtils.test.ts` 로 확인 후 있는 것만 나열. 그리고 `build`/`build:vite` 체인의 `npm run test:ui` 앞에 `npm run test:calendar &&` 삽입.)
  - `test:calendar` 의 `build`/`build:vite` 체인 연결 여부는 위 조건과 무관하게 `grep -n "test:calendar" package.json` 으로 항상 확인한다.
  - `npm run test:calendar` → 전부 pass 확인.
- [ ] **Step 2: 검증 게이트 (chunk0 §0.3 순서 그대로)** —
  1. `npm run typecheck` → 통과 2. `npm run test:calendar` → 통과(+ `npm run test:ui` — PR1 이 `calendarIntegrationStatus.test.ts` 를 연결했다면 함께) 3. `npm run build:vite` → 통과
  4. 프리뷰 실기(`npm run dev:renderer` → `http://localhost:5190/?preview=1`, `배한솔`/`1234`):
     - 캘린더 탭 진입 → 월 그리드가 기존과 동일하게 뜬다 (구글 미연동 상태에서 콘솔 에러 0건, 에러 토스트 0건)
     - `+ 일정` → 제목 입력 + "나만 보기" 체크 → 만들기 → 칩 즉시 표시(낙관적) → 다른 날짜로 이동 후 복귀해도 유지
     - 그 일정 클릭 → 사이드패널에서 제목 수정 → 반영 확인 / 삭제 → 사라짐 확인 (bflow 라우팅 CRUD 왕복)
     - "나만 보기" 미체크 일반 일정 생성 → 기존 구글 경로 동작(프리뷰 mock 에선 실패 무해) — 회귀 없음 확인
     - 대시보드 캘린더 위젯 → 같은 일정이 보임(가드 밖 로드 + 병합 캐시 공유 확인)
  - **작동 증명 없이 완료 표시 금지.** 위 클릭 경로 결과를 PR 본문 테스트 가이드에 기록.
- [ ] **Step 3: update-notes.json 항목 추가** — 배열 맨 앞에 추가(기존 형식: `{version, title, items:[{category, summary, description}]}`). 체감 변화가 거의 없는 PR 이므로 톤 예시:

```json
{
  "version": "1.XXX.0",
  "title": "캘린더 새 단장 준비",
  "items": [{
    "category": "improvement",
    "summary": "곧 나올 팀 공유 캘린더를 위한 기반 작업을 했어요",
    "description": "다음 업데이트에서 팀원끼리 일정을 함께 보는 캘린더가 추가될 예정이에요. 이번에는 그 준비로 일정이 저장되는 방식을 앱 자체 저장소로 정리했어요. 화면에서 달라지는 건 없고, '나만 보기' 일정도 지금까지처럼 그대로 만들고 볼 수 있어요."
  }]
}
```

  (금지어 점검: 테이블/IPC/마이그레이션/Supabase 같은 단어 없음 — CLAUDE.md 톤 룰.)
- [ ] **Step 4: 버전 산정** — `git fetch origin && git show origin/main:package.json | grep '"version"'` 기준 **마이너 +1** (chunk0 §0.3 — 1.102.0 이후 PR1 등이 먼저 머지되므로 반드시 재확인). `package.json` + `package-lock.json` 2곳(최상단 `version` + `packages[""].version`) 3자 일치. update-notes 의 `1.XXX.0` 도 같은 값으로 치환. `git commit -m "v1.XXX.0 버전 및 업데이트 노트 — 공유 캘린더 데이터 계층"`
- [ ] **Step 5: PR 생성** — `pr-creator` 스킬 사용 (chunk0 §0.3). 본문에 반드시 포함:
  - "📋 업데이트 요약": 비개발자 톤 (Step 3 문안 재사용 가능)
  - 상세 기술 설명(개발자 톤): 테이블 5개 + 이관 SQL / IPC 권한 강제 구조 / 경로 스위치 + 폴백 / calendarStore 가 broadcast 를 하지 않는 의도된 편차
  - **구버전 호환 리스크(설계서 §12·§13 요약 재인용)**: ① 신규 테이블 추가만이라 구버전 앱은 영향 없음 ② `private_calendar_events` 는 남겨둬 구버전 "나만 보기"가 계속 동작 — 신·구 버전이 다른 테이블에 쓰는 공존 창이 생기며, 구 테이블 DROP 은 전 팀원 업데이트 후 다음 라운드에서 **델타 재이관 후** 수행 ③ PR4 전까지는 캘린더 쓰기가 다른 클라이언트의 전체 새로고침을 유발할 수 있음(기존 "나만 보기"와 같은 수준, PR4 에서 해소) ④ 공유 캘린더 UI 는 아직 없음 — PR3 배포 전까지 새 테이블은 "나만 보기" 저장소로만 쓰임
  - **머지 후 별도 게이트**: "마이그레이션 SQL(`DEVLOG/migrations/2026-08-24-shared-calendars.sql`) 라이브 적용은 머지 직후·배포 전, 한솔 확인 후 진행. 적용 후 실기 확인: 재로그인 시 개인 캘린더 자동 생성 + 기존 나만 보기 일정이 그대로 보이는지" 를 체크리스트로 명기. 체크리스트에 이관 전후 행 수 비교도 포함: `SELECT count(*) FROM private_calendar_events;` 와 `SELECT count(*) FROM calendar_events;` 로 유실 여부 즉시 확인
- [ ] **Step 6: codex-review-loop** — `codex-review-loop` 스킬로 리뷰 루프 실행. 명시 완료 신호까지 재트리거. P1/P2 수정 시 typecheck + test:calendar + build:vite 재실행 후 push. **머지·G드라이브 배포·슬랙 공지는 한솔 명시 지시 시에만** (chunk0 §0.3).

---

# Chunk 3

> 이 chunk 는 chunk0.md(공통 컨텍스트)와 설계서 `docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md` §3(UI 설계)·§11(테스트·프리뷰)을 전제로 한다.
> **선행 조건: PR1(정리·분해)·PR2(데이터·IPC·스토어)가 머지된 `origin/main` 에서 분기한다.** PR2 가 만든 실제 API(타입·스토어·IPC 이름)는 이 플랜의 "기대 시그니처" 와 다를 수 있으므로, 각 Task 의 첫 스텝에 있는 grep 재확인을 건너뛰지 말 것.
> 시안 원본: `docs/superpowers/specs/mockups/2026-08-24-calendar/M1Month~M6Notify.dc.html` — 브라우저로 열어 실제 렌더를 보면서 작업한다.

## Chunk 3: PR3 — UI (브랜치 claude/calendar-pr3-ui)

**Goal:** 캘린더 레일 + 태그 줄 + 새 일정/설정/태그 모달 + 상세 패널·퀵에디트 개편 + 주/오늘 시간 표시 + 프리뷰 seed. 이 PR 이 끝나면 사용자가 시안 M1~M6 과 같은 화면을 실제로 조작할 수 있다.

**PR2 산출물 기대 시그니처 (전 Task 공통 — 작업 시작 시 1회 재확인):**

```bash
# 실제 이름·형태 확인 (이 플랜의 기대와 다르면 실제 코드에 맞춰 아래 Task 들을 조정)
grep -n "BflowCalendar\|CalendarTag" src/types/calendar.ts
grep -n "export" src/stores/useCalendarStore.ts | head -30
grep -n "calendar" electron/preload.ts | head -30
grep -n "loadBflowEvents\|source\|calendarId" src/services/calendarService.ts | head -40
```

기대 형태 (설계서 §5·§6 기준):

```ts
// src/types/calendar.ts (PR2 가 추가했을 것)
export interface BflowCalendar {
  id: string; name: string; color: string;
  visibility: 'private' | 'members' | 'team';
  ownerId: string; ownerName?: string; isPersonal: boolean;
  members: { userId: string; canEdit: boolean }[];
  canEdit: boolean;    // 내 권한 (calendar:list 가 계산해 반환)
  canManage: boolean;
  createdAt?: string; eventCount?: number;
}
export interface CalendarTag { id: string; name: string; color: string; sortOrder: number; }
// CalendarEvent 확장: calendarId? tagId? allDay? startTime? endTime? canEdit? source?('bflow'|'google'|'vacation')

// src/stores/useCalendarStore.ts (PR2) — 켬/끔·뮤트는 localStorage persist
// calendars, tags, hiddenCalendarIds, hiddenTagIds, googleVisible, mutedCalendarIds
// loadCalendars(), loadTags(), toggleCalendar(id), toggleTag(id), setAllTagsOn(), toggleGoogle(), toggleMute(id)
```

스토어에 위 셀렉터/액션이 없으면 **PR3 에서 useCalendarStore 에 추가**한다(다른 파일에 로컬 state 로 흩뿌리지 말 것).

---

### Task 3.1: 브랜치 생성 + 프리뷰 seed (캘린더 4·태그 4·일정 15)

이후 모든 UI Task 를 프리뷰(`?preview=1`, mock 배한솔/1234)로 검증할 수 있게 seed 를 먼저 만든다.

**Files:**
- Create: `src/mocks/devCalendarSeed.ts`
- Modify: `src/mocks/devElectronAPI.ts` (PR2 가 만든 calendar* mock 을 seed 연결로 교체)

- [ ] **Step 1: 브랜치 생성**
  ```bash
  git fetch origin && git checkout -b claude/calendar-pr3-ui origin/main
  git log --oneline -3   # PR2 머지 커밋이 보여야 함. 안 보이면 PR2 머지 전 — 중단하고 보고
  ```
- [ ] **Step 2: PR2 의 mock 표면 확인**
  ```bash
  grep -n "calendar" src/mocks/devElectronAPI.ts | head -30
  ```
  PR2 는 신규 IPC 를 빈 값 mock 으로 추가했을 것(chunk0 §0.2). 그 함수 이름들(preload 와 1:1)을 그대로 쓰되 구현만 seed 기반으로 교체한다.
- [ ] **Step 3: `src/mocks/devCalendarSeed.ts` 작성** — 완전한 코드:

  ```ts
  /**
   * devCalendarSeed — 프리뷰(?preview=1) 전용 캘린더/태그/일정 seed + 인메모리 CRUD.
   * mock 사용자: 배한솔(id '1', admin). 허혜원 id '3', 장삐쭈 id '2', 안류천 id '4'.
   * localStorage 미사용(새로고침 시 초기화) — seed 재현성 우선.
   */
  import type { BflowCalendar, CalendarTag, CalendarEvent } from '@/types/calendar';

  const now = new Date();
  const Y = now.getFullYear();
  const M = now.getMonth(); // 0-based, 이번 달에 seed 를 깔아 프리뷰에서 바로 보이게
  const d = (day: number) => `${Y}-${String(M + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`;

  export const SEED_TAGS: CalendarTag[] = [
    { id: 'tag-upload', name: '업로드', color: '#E17055', sortOrder: 0 },
    { id: 'tag-cut', name: '가편', color: '#74B9FF', sortOrder: 1 },
    { id: 'tag-script', name: '대본', color: '#FDCB6E', sortOrder: 2 },
    { id: 'tag-meeting', name: '회의', color: '#A29BFE', sortOrder: 3 },
  ];

  // 권한 상태 seed (배한솔 '1' 기준):
  //  - 개인: 소유 → canEdit/canManage true
  //  - EP 마일스톤(team, 소유 배한솔): canEdit/canManage true
  //  - 스튜디오 공지(team, 소유 허혜원, 멤버 없음): canEdit false → "보기 전용" 검증용
  //  - 리드 회의(members, 소유 허혜원, 배한솔 can_edit=true 멤버): canEdit true, canManage true(admin)
  export const SEED_CALENDARS: BflowCalendar[] = [
    { id: 'cal-personal-1', name: '개인', color: '#6C5CE7', visibility: 'private', ownerId: '1', ownerName: '배한솔', isPersonal: true, members: [], canEdit: true, canManage: true },
    { id: 'cal-milestone', name: 'EP 마일스톤', color: '#74B9FF', visibility: 'team', ownerId: '1', ownerName: '배한솔', isPersonal: false, members: [], canEdit: true, canManage: true },
    { id: 'cal-notice', name: '스튜디오 공지', color: '#FDCB6E', visibility: 'team', ownerId: '3', ownerName: '허혜원', isPersonal: false, members: [], canEdit: false, canManage: true },
    { id: 'cal-leads', name: '리드 회의', color: '#A29BFE', visibility: 'members', ownerId: '3', ownerName: '허혜원', isPersonal: false, members: [{ userId: '1', canEdit: true }, { userId: '2', canEdit: false }], canEdit: true, canManage: true },
  ];

  type SeedEvent = Pick<CalendarEvent, 'id' | 'title' | 'memo' | 'startDate' | 'endDate'> &
    Partial<Pick<CalendarEvent, 'tagId' | 'allDay' | 'startTime' | 'endTime' | 'linkedEpisode'>> & { calendarId: string };

  // 종일 단일 7 + 다중일 3 + 시간 일정 5 = 15개
  export const SEED_EVENTS: SeedEvent[] = [
    { id: 'sev-01', calendarId: 'cal-milestone', tagId: 'tag-upload', title: 'EP05 업로드', memo: '', startDate: d(1), endDate: d(1) },
    { id: 'sev-02', calendarId: 'cal-milestone', tagId: 'tag-cut', title: 'EP06 가편 납품', memo: '', startDate: d(12), endDate: d(12), linkedEpisode: 6 },
    { id: 'sev-03', calendarId: 'cal-milestone', tagId: 'tag-script', title: 'EP07 대본 리딩', memo: '', startDate: d(8), endDate: d(8) },
    { id: 'sev-04', calendarId: 'cal-milestone', tagId: 'tag-upload', title: 'EP06 업로드', memo: '', startDate: d(25), endDate: d(25) },
    { id: 'sev-05', calendarId: 'cal-milestone', tagId: 'tag-cut', title: 'EP07 가편 작업', memo: '', startDate: d(13), endDate: d(16) },   // 다중일
    { id: 'sev-06', calendarId: 'cal-notice', title: '전체 회식', memo: '장소 추후 공지', startDate: d(15), endDate: d(15) },              // 태그 없음(항상 표시 규칙 검증)
    { id: 'sev-07', calendarId: 'cal-notice', title: '사무실 정비', memo: '', startDate: d(21), endDate: d(22) },                          // 다중일 + 태그 없음 + 보기 전용
    { id: 'sev-08', calendarId: 'cal-notice', tagId: 'tag-upload', title: '채널 점검', memo: '', startDate: d(28), endDate: d(28) },
    { id: 'sev-09', calendarId: 'cal-leads', tagId: 'tag-meeting', title: '리드 회의', memo: '', startDate: d(3), endDate: d(3), allDay: false, startTime: '14:00', endTime: '15:00' },
    { id: 'sev-10', calendarId: 'cal-leads', tagId: 'tag-meeting', title: '리드 회의', memo: '', startDate: d(10), endDate: d(10), allDay: false, startTime: '14:00', endTime: '15:00' },
    { id: 'sev-11', calendarId: 'cal-leads', tagId: 'tag-meeting', title: '리드 회의', memo: '', startDate: d(17), endDate: d(17), allDay: false, startTime: '14:00', endTime: '15:00' },
    { id: 'sev-12', calendarId: 'cal-leads', tagId: 'tag-meeting', title: '컴포 TF 싱크', memo: '', startDate: d(18), endDate: d(18), allDay: false, startTime: '15:30', endTime: '16:00' },
    { id: 'sev-13', calendarId: 'cal-personal-1', title: '치과', memo: '', startDate: d(9), endDate: d(9), allDay: false, startTime: '09:30', endTime: '10:30' },
    { id: 'sev-14', calendarId: 'cal-personal-1', title: '장비 반납', memo: '', startDate: d(19), endDate: d(19) },
    { id: 'sev-15', calendarId: 'cal-personal-1', title: '이사 준비', memo: '', startDate: d(26), endDate: d(27) },
  ];

  // ── 인메모리 스토어 (프리뷰 CRUD 동작용) ──
  let calendars = SEED_CALENDARS.map((c) => ({ ...c, members: [...c.members] }));
  let tags = [...SEED_TAGS];
  let events = SEED_EVENTS.map((e) => ({ ...e }));
  let seq = 100;

  export const previewCalendarDb = {
    listCalendars: () => calendars.map((c) => ({ ...c })),
    createCalendar: (input: Partial<BflowCalendar>) => {
      const cal: BflowCalendar = {
        id: `cal-mock-${seq++}`, name: input.name ?? '새 캘린더', color: input.color ?? '#6C5CE7',
        visibility: input.visibility ?? 'members', ownerId: '1', ownerName: '배한솔',
        isPersonal: false, members: input.members ?? [], canEdit: true, canManage: true,
      };
      calendars.push(cal); return { ...cal };
    },
    updateCalendar: (id: string, patch: Partial<BflowCalendar>) => {
      calendars = calendars.map((c) => (c.id === id ? { ...c, ...patch } : c));
    },
    deleteCalendar: (id: string) => {
      calendars = calendars.filter((c) => c.id !== id);
      events = events.filter((e) => e.calendarId !== id);
    },
    setMembers: (id: string, members: { userId: string; canEdit: boolean }[]) => {
      calendars = calendars.map((c) => (c.id === id ? { ...c, members: [...members] } : c));
    },
    listEvents: () => events.map((e) => ({ ...e })),
    createEvent: (input: Record<string, unknown>) => {
      const ev = { id: `sev-mock-${seq++}`, memo: '', ...input } as (typeof events)[number];
      events.push(ev); return { ...ev };
    },
    updateEvent: (id: string, patch: Record<string, unknown>) => {
      events = events.map((e) => (e.id === id ? { ...e, ...patch } : e));
    },
    deleteEvent: (id: string) => { events = events.filter((e) => e.id !== id); },
    listTags: () => tags.map((t) => ({ ...t })),
    saveTags: (next: CalendarTag[]) => {
      tags = next.map((t) => ({ ...t }));
      const alive = new Set(tags.map((t) => t.id));
      events = events.map((e) => (e.tagId && !alive.has(e.tagId) ? { ...e, tagId: undefined } : e));
    },
  };
  ```

  주의: `BflowCalendar` 실제 필드명이 다르면(예: snake_case) seed 를 실제 타입에 맞춘다. 이벤트 반환 형태(raw row vs CalendarEvent)는 PR2 mock 이 반환하던 형태와 동일하게 맞출 것 — `calendarService.loadBflowEvents` 가 소비하는 형태가 기준.
- [ ] **Step 4: devElectronAPI 의 calendar* mock 을 previewCalendarDb 로 연결.** PR2 가 추가한 각 mock 함수(예: `calendarList`, `calendarCreate`, `calendarUpdate`, `calendarDelete`, `calendarSetMembers`, `calendarEventsList`, `calendarEventsCreate/Update/Delete`, `calendarTagsList`, `calendarTagsSave` — 실제 이름은 Step 2 grep 결과)를 previewCalendarDb 호출로 교체. 반환 껍데기(`{ ok: true, data }` 등)는 기존 mock 과 동일하게 유지.
- [ ] **Step 5: 검증**
  ```bash
  npm run typecheck        # 기대: 오류 0
  ```
  프리뷰 실기: `npm run dev:renderer` → `http://localhost:5190/?preview=1` → 배한솔/1234 로그인 → 캘린더 탭(Ctrl+7). **PR2 완료 상태 기준으로 seed 일정 15개가 월 그리드에 보이면 성공**(레일·태그줄은 아직 없음 — 이번 달에 일정이 찍히는지만 확인).
- [ ] **Step 6: 커밋** — `git add -A && git commit -m "프리뷰 캘린더 seed 추가: 캘린더 4개·태그 4개·일정 15개 인메모리 CRUD"`

---

### Task 3.2: 필터 순수 함수 + 테스트 (TDD — Task 3.3~3.4 의 토대)

레일/태그줄보다 먼저 필터 규칙을 순수 함수로 굳힌다. 규칙(설계서 §3.2): (켜진 캘린더) ∩ (켜진 태그), 태그 없는 일정은 항상 표시, 휴가 칩 off 시 휴가 숨김, 구글은 레일의 "내 구글" 토글.

**Files:**
- Create: `src/utils/calendarEventFilter.ts`
- Test: `tests/calendarEventFilter.test.ts`
- Modify: `package.json` (`test:calendar` 스크립트에 테스트 추가)

- [ ] **Step 1: 실패 테스트 작성** — `tests/calendarEventFilter.test.ts` (상대 import 만, `@/` 금지 — chunk0 §0.3):

  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import {
    filterCalendarEvents, VACATION_CHIP_ID, formatEventChipText,
    sortEventsForList, formatEventTimeRange, groupCalendarsForRail,
  } from '../src/utils/calendarEventFilter';

  const ev = (over: Record<string, unknown>) => ({
    id: 'e', title: '제목', memo: '', color: '#fff', type: 'custom',
    startDate: '2026-09-01', endDate: '2026-09-01', createdBy: '', createdAt: '',
    source: 'bflow', calendarId: 'cal-a', ...over,
  }) as never;
  const state = (over: Record<string, unknown> = {}) => ({
    hiddenCalendarIds: [] as string[], hiddenTagIds: [] as string[], googleVisible: true, ...over,
  });

  test('켜진 캘린더 ∩ 켜진 태그', () => {
    const events = [ev({ id: '1', tagId: 't1' }), ev({ id: '2', calendarId: 'cal-b', tagId: 't1' }), ev({ id: '3', tagId: 't2' })];
    const out = filterCalendarEvents(events, state({ hiddenCalendarIds: ['cal-b'], hiddenTagIds: ['t2'] }));
    assert.deepEqual(out.map((e: { id: string }) => e.id), ['1']);
  });
  test('태그 없는 일정은 태그 필터가 걸려 있어도 항상 표시', () => {
    const out = filterCalendarEvents([ev({ id: '1' })], state({ hiddenTagIds: ['t1', 't2'] }));
    assert.equal(out.length, 1);
  });
  test('태그 없는 일정도 캘린더가 꺼지면 숨김', () => {
    const out = filterCalendarEvents([ev({ id: '1' })], state({ hiddenCalendarIds: ['cal-a'] }));
    assert.equal(out.length, 0);
  });
  test('휴가 칩 off 시 휴가 숨김, on 이면 표시', () => {
    const vac = ev({ id: 'v', source: 'vacation', type: 'vacation', calendarId: undefined });
    assert.equal(filterCalendarEvents([vac], state({ hiddenTagIds: [VACATION_CHIP_ID] })).length, 0);
    assert.equal(filterCalendarEvents([vac], state()).length, 1);
  });
  test('구글 일정은 googleVisible 로만 제어(태그 필터 무관)', () => {
    const g = ev({ id: 'g', source: 'google', calendarId: undefined, tagId: undefined });
    assert.equal(filterCalendarEvents([g], state({ googleVisible: false })).length, 0);
    assert.equal(filterCalendarEvents([g], state({ hiddenTagIds: ['t1'] })).length, 1);
  });
  test('칩 텍스트: 종일=태그명·제목 / 태그없음=캘린더명·제목 / 시간=HH:MM 제목', () => {
    const tags = { t1: '업로드' }; const cals = { 'cal-a': '스튜디오 공지' };
    assert.equal(formatEventChipText(ev({ tagId: 't1' }), tags, cals), '업로드 · 제목');
    assert.equal(formatEventChipText(ev({}), tags, cals), '스튜디오 공지 · 제목');
    assert.equal(formatEventChipText(ev({ allDay: false, startTime: '14:00' }), tags, cals), '14:00 제목');
    assert.equal(formatEventChipText(ev({ source: 'google', calendarId: undefined }), tags, cals), '구글 · 제목');
    assert.equal(formatEventChipText(ev({ source: 'vacation', type: 'vacation', calendarId: undefined }), tags, cals), '휴가 · 제목');
  });
  test('목록 정렬: 종일 먼저, 시간 일정은 시각순', () => {
    const list = [ev({ id: 'b', allDay: false, startTime: '15:00' }), ev({ id: 'a', allDay: false, startTime: '09:00' }), ev({ id: 'c' })];
    assert.deepEqual(sortEventsForList(list).map((e: { id: string }) => e.id), ['c', 'a', 'b']);
  });
  test('시간 부제: "14:00 – 15:00 · 태그명"', () => {
    assert.equal(formatEventTimeRange(ev({ allDay: false, startTime: '14:00', endTime: '15:00', tagId: 't1' }), { t1: '회의' }), '14:00 – 15:00 · 회의');
    assert.equal(formatEventTimeRange(ev({ allDay: false, startTime: '14:00' }), {}), '14:00');
    assert.equal(formatEventTimeRange(ev({}), {}), null);
  });
  test('레일 그룹: team 은 소유 무관 팀 전체 섹션, members 소유=내 캘린더, 공유받음 분리', () => {
    const cal = (over: Record<string, unknown>) => ({ id: 'c', name: '', color: '', visibility: 'members', ownerId: '1', isPersonal: false, members: [], canEdit: true, canManage: true, ...over }) as never;
    const g = groupCalendarsForRail([
      cal({ id: 'p', isPersonal: true, visibility: 'private' }),
      cal({ id: 'own-members' }),
      cal({ id: 'team-mine', visibility: 'team' }),
      cal({ id: 'team-other', visibility: 'team', ownerId: '3' }),
      cal({ id: 'shared', ownerId: '3' }),
    ], '1');
    assert.deepEqual(g.mine.map((c: { id: string }) => c.id), ['p', 'own-members']);   // 개인 캘린더 맨 앞
    assert.deepEqual(g.team.map((c: { id: string }) => c.id).sort(), ['team-mine', 'team-other'].sort());
    assert.deepEqual(g.shared.map((c: { id: string }) => c.id), ['shared']);
  });
  ```
- [ ] **Step 2: 실패 확인** — `node --test ./tests/calendarEventFilter.test.ts` → 기대: 모듈 없음으로 전부 실패.
- [ ] **Step 3: `src/utils/calendarEventFilter.ts` 구현** — 완전한 코드(타입 import 는 상대 경로):

  ```ts
  import type { CalendarEvent, BflowCalendar } from '../types/calendar';

  /** 태그줄 내장 휴가 칩의 고정 id (calendar_tags 테이블에는 없음) */
  export const VACATION_CHIP_ID = 'builtin-vacation';

  export interface CalendarFilterState {
    hiddenCalendarIds: readonly string[];
    hiddenTagIds: readonly string[]; // VACATION_CHIP_ID 포함 가능
    googleVisible: boolean;
  }

  function sourceOf(ev: CalendarEvent): 'bflow' | 'google' | 'vacation' {
    if (ev.source) return ev.source;
    if (ev.type === 'vacation') return 'vacation';
    return ev.calendarId ? 'bflow' : 'google';
  }

  /** (켜진 캘린더) ∩ (켜진 태그). 태그 없는 일정은 태그 필터 무시(항상 표시 — 설계서 §3.2 확정). */
  export function filterCalendarEvents(
    events: readonly CalendarEvent[], state: CalendarFilterState,
  ): CalendarEvent[] {
    const hiddenCals = new Set(state.hiddenCalendarIds);
    const hiddenTags = new Set(state.hiddenTagIds);
    return events.filter((ev) => {
      const src = sourceOf(ev);
      if (src === 'vacation') return !hiddenTags.has(VACATION_CHIP_ID);
      if (src === 'google') return state.googleVisible;
      if (ev.calendarId && hiddenCals.has(ev.calendarId)) return false;
      if (ev.tagId && hiddenTags.has(ev.tagId)) return false;
      return true;
    });
  }

  /** 칩 텍스트: 시간 일정 'HH:MM 제목' / 종일 '태그명 · 제목' / 태그 없음 '캘린더명 · 제목' (구글·휴가는 고정 접두). */
  export function formatEventChipText(
    ev: CalendarEvent, tagNameById: Record<string, string>, calendarNameById: Record<string, string>,
  ): string {
    if (ev.allDay === false && ev.startTime) return `${ev.startTime} ${ev.title}`;
    const src = sourceOf(ev);
    const prefix = (ev.tagId ? tagNameById[ev.tagId] : undefined)
      ?? (src === 'google' ? '구글' : src === 'vacation' ? '휴가'
        : ev.calendarId ? calendarNameById[ev.calendarId] : undefined);
    return prefix ? `${prefix} · ${ev.title}` : ev.title;
  }

  /** 주/오늘 카드 목록 정렬: 종일 먼저, 시간 일정은 시각순(같으면 제목 가나다). */
  export function sortEventsForList(events: readonly CalendarEvent[]): CalendarEvent[] {
    return [...events].sort((a, b) => {
      const at = a.allDay === false && !!a.startTime;
      const bt = b.allDay === false && !!b.startTime;
      if (at !== bt) return at ? 1 : -1;
      if (at && bt && a.startTime !== b.startTime) return (a.startTime as string).localeCompare(b.startTime as string);
      return a.title.localeCompare(b.title, 'ko');
    });
  }

  /** 카드 부제 '14:00 – 15:00 · 태그명'. 종일이면 null. */
  export function formatEventTimeRange(
    ev: CalendarEvent, tagNameById: Record<string, string>,
  ): string | null {
    if (ev.allDay !== false || !ev.startTime) return null;
    const range = ev.endTime && ev.endTime !== ev.startTime ? `${ev.startTime} – ${ev.endTime}` : ev.startTime;
    const tag = ev.tagId ? tagNameById[ev.tagId] : undefined;
    return tag ? `${range} · ${tag}` : range;
  }

  /** 레일 섹션: team=팀 전체(소유 무관) / mine=내 소유 비-team(개인 맨 앞) / shared=공유받음. */
  export function groupCalendarsForRail(calendars: readonly BflowCalendar[], myUserId: string) {
    const mine: BflowCalendar[] = []; const team: BflowCalendar[] = []; const shared: BflowCalendar[] = [];
    for (const cal of calendars) {
      if (cal.visibility === 'team') team.push(cal);
      else if (cal.ownerId === myUserId) mine.push(cal);
      else shared.push(cal);
    }
    mine.sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal));
    return { mine, team, shared };
  }
  ```
- [ ] **Step 4: 통과 확인** — `node --test ./tests/calendarEventFilter.test.ts` → 기대: 9 pass 0 fail. (실패 시 `src/types/calendar.ts` 의 실제 필드명 확인 — PR2 가 `source`/`allDay` 를 다른 이름으로 넣었다면 필터 유틸을 실제 이름에 맞춘다.)
- [ ] **Step 5: package.json 연결** — `grep -n "test:calendar" package.json` 으로 PR1~2 가 만든 스크립트 확인 후 `./tests/calendarEventFilter.test.ts` 를 뒤에 추가. `npm run test:calendar` → 기대: 전부 pass.
- [ ] **Step 6: 커밋** — `git commit -am "캘린더∩태그 필터·칩 텍스트·정렬 순수 함수와 테스트 추가"`

---

### Task 3.3: CalendarRail.tsx (M1 — 좌측 캘린더 목록 카드)

**Files:**
- Create: `src/components/calendar/CalendarRail.tsx`
- Modify: `src/views/ScheduleView.tsx` (좌측 레일에 미니달력 아래 배치)

시안: M1Month.dc.html 좌측 레일. 참조 패턴: 팝오버 메뉴는 `EventQuickEdit.tsx` 의 바깥클릭/Esc 처리, 색 체크박스는 자체 구현(네이티브 checkbox 아님 — 캘린더 색 배경 + 체크 아이콘).

**필수 요소 체크리스트 (M1 대조):**
- [ ] 섹션 4개 헤더: `내 캘린더` / `팀 전체` / `나에게 공유됨` / `내 구글` — `groupCalendarsForRail` 결과 사용. 빈 섹션은 헤더 숨김(내 구글 제외).
- [ ] 각 행: 색 체크박스(체크 = 표시 켬 = `!hiddenCalendarIds.includes(id)`, 배경 = 캘린더 색, 체크 시 lucide `Check`) + 이름(truncate) + 공유받은 캘린더 배지 `편집`/`보기`(= `cal.canEdit`, shared 섹션만).
- [ ] 행 hover 시 우측 `⋯`(lucide `MoreHorizontal`) → 메뉴 2항목: `설정 열기`(CalendarSettingsModal, Task 3.6 전까지는 TODO 금지 — Task 3.6 에서 연결하므로 이 Task 에서는 메뉴에 `설정 열기` 를 disabled 로 두지 말고 **Task 3.6 이후로 이 스텝을 미루지도 말고**, 콜백 prop `onOpenSettings(cal)` 만 받아 호출 — ScheduleView 쪽 연결은 Task 3.6 에서) / `이 캘린더 알림 끄기`(뮤트 시 `알림 켜기`, `useCalendarStore.toggleMute`). **게이트 주의: ⋯ 메뉴 자체는 모든 캘린더 행에 노출한다(뮤트는 누구나 쓴다). `cal.canManage` 게이트는 메뉴 전체가 아니라 `설정 열기` 항목에만 건다** — canManage false 면 메뉴에 `알림 끄기` 만 남는다.
- [ ] 맨 아래 `+ 새 캘린더` 버튼 → prop `onCreateCalendar()` 호출(연결은 Task 3.6).
- [ ] `내 구글` 행: gcal 연동 시 체크박스 활성(`googleVisible` 토글) + `연동됨` 표시. 미연동 시 회색 점 + "구글 캘린더 연동 안 됨 · 설정에서 연동하기"(클릭 → `useAppStore` 의 `setView('settings')` 호출이 정답 경로 — 선례: `src/components/settings/ProfileSection.tsx:454`).
- [ ] 뮤트된 캘린더 행에는 lucide `BellOff` 12px 아이콘 표시.

- [ ] **Step 1: CalendarRail.tsx 구현.** props: `{ isAuthenticated: boolean; onOpenSettings: (cal: BflowCalendar) => void; onCreateCalendar: () => void; }`. 데이터는 `useCalendarStore` 직접 구독(calendars/hiddenCalendarIds/googleVisible/mutedCalendarIds + toggle 액션). ⋯ 메뉴는 팝오버 4대 체크리스트 적용(트리거 버튼을 바깥클릭 판정에서 제외 / 닫기 경로 일관성 / Esc 는 stopPropagation 후 메뉴만 닫기 / 상태 변경 후 재조회).
- [ ] **Step 2: ScheduleView 좌측 사이드바에 배치.** 현재 구조: `ScheduleView.tsx:1778-1840` (`sidebarOpen` state, 펼침 시 180px, MiniCalendar/WeekSidebar/DaySidebar 분기). `grep -n "sidebarOpen" src/views/ScheduleView.tsx` 로 재확인 후, 펼침 상태 div 안에서 기존 미니달력(월)/주차(주)/날짜(오늘) 아래에 `<CalendarRail />` 를 추가하고 세로 스크롤(`overflow-y-auto`) 처리. 접기 동작은 기존 `sidebarOpen` 그대로(새 상태 만들지 말 것). 캘린더/태그 로드: `useCalendarStore.loadCalendars()/loadTags()` 가 앱 시작 시 이미 불리는지 grep(`grep -rn "loadCalendars" src/`) — 안 불리면 ScheduleView mount useEffect 에서 호출.
- [ ] **Step 3: typecheck + 프리뷰 실기.** `npm run typecheck` → 오류 0. 프리뷰: 캘린더 탭 → 사이드바 펼치기 → (1) 섹션에 개인/EP 마일스톤·스튜디오 공지/리드 회의가 각각 내 캘린더/팀 전체/나에게 공유됨으로 분류되는지 (2) `리드 회의` 에 `편집` 배지 (3) `EP 마일스톤` 체크 해제 → 월 그리드에서 해당 일정 사라짐(Task 3.4 의 헤더 개편·filteredEvents 교체 전이므로 필터 연결이 아직이면 이 항목은 Task 3.4 에서 재확인) (4) ⋯ → 알림 끄기 → BellOff 아이콘 (5) 내 구글 행에 미연동 안내 문구.
- [ ] **Step 4: 커밋** — `git commit -am "캘린더 레일 추가: 섹션 4개·색 체크박스·편집/보기 배지·알림 뮤트 메뉴"`

---

### Task 3.4: TagBar.tsx + ScheduleView 헤더 개편 (M1/M5 — 기존 필터 제거)

**Files:**
- Create: `src/components/calendar/TagBar.tsx`
- Modify: `src/views/ScheduleView.tsx` (유형/부서/휴가 필터 제거, filteredEvents 교체, 통계줄)

**필수 요소 체크리스트 (M1 태그줄):**
- [ ] `태그` 라벨 + `전체` 칩 + 팀 태그 칩들(useCalendarStore.tags, sortOrder 순) + 내장 `휴가` 칩(`VACATION_CHIP_ID`, `vacationConnected` 일 때만) + `+ 태그 관리`(연결은 Task 3.7 — prop `onOpenTagManager()`).
- [ ] 칩 켬 = 태그색 틴트 배경(`hexToRgba(color, 0.22)` — PR1 의 `src/utils/calendarDate.ts` 유틸 사용) + 태그색 텍스트, 끔 = 회색. 휴가 칩 색 `#00B894`.
- [ ] `전체` 칩 = 상태가 아니라 **모두 켜기 리셋 버튼**(`setAllTagsOn()` — hiddenTagIds 비우기). 모든 칩(휴가 포함)이 켜져 있을 때만 강조 표시.

- [ ] **Step 1: TagBar.tsx 구현** (useCalendarStore 구독, props `{ vacationConnected: boolean; onOpenTagManager: () => void }`).
- [ ] **Step 2: ScheduleView 기존 필터 제거.** 재확인 grep:
  ```bash
  grep -n "filter\b\|deptFilter\|showVacation\|CalendarFilter" src/views/ScheduleView.tsx
  ```
  (PR1 분해 후 줄번호가 바뀌었을 것.) 제거 대상: `filter`/`setFilter`/`deptFilter`/`setDeptFilter`/`showVacation`/`setShowVacation` state, 헤더의 유형 필터·부서 필터·휴가 토글 버튼 UI, `CalendarFilter` import(타입 자체는 CalendarWidget 이 쓰므로 `src/types/calendar.ts` 에서 삭제하지 말 것). `allEvents`(휴가 병합) 는 유지하고 `filteredEvents` 를 다음으로 교체:
  ```ts
  const filteredEvents = useMemo(
    () => filterCalendarEvents(allEvents, { hiddenCalendarIds, hiddenTagIds, googleVisible }),
    [allEvents, hiddenCalendarIds, hiddenTagIds, googleVisible],
  );
  ```
- [ ] **Step 3: 헤더 아래 TagBar 배치 + 통계줄 교체.** 통계줄(현 `ScheduleView.tsx:1963-1979`)을 "이번 달 N개 · 오늘 N개 · 켜진 캘린더 N/M" 으로 교체. N = 표시 켬 캘린더 수(bflow + 연동 시 내 구글 포함), M = 레일에 체크박스로 노출된 전체 수. 생성 버튼 라벨 `이벤트` → `일정`(M1 시안 표기).
- [ ] **Step 4: DnD/DragCreate 연결 확인.** `useCalendarDnD`·`useCalendarDragCreate` 는 filteredEvents 를 소비하는 CalendarGrid 경유이므로 코드 변경 없이 동작해야 함. grep 으로 두 훅 호출부에 `filter`/`deptFilter` 참조가 남아 있지 않은지 확인:
  ```bash
  grep -n "useCalendarDnD\|useCalendarDragCreate" src/views/ScheduleView.tsx
  ```
- [ ] **Step 5: 검증.** `npm run typecheck` → 오류 0. `npm run test:calendar` → pass. 프리뷰: (1) 유형/부서/휴가 필터가 사라지고 태그줄 표시 (2) `회의` 칩 끄기 → 리드 회의 4건 사라짐, `전체 회식`(태그 없음)은 그대로 (3) 모든 칩 켬 상태에서만 `전체` 강조 (4) `전체` 클릭 → 끈 칩 복구 (5) 레일에서 `EP 마일스톤` 끄기 → 해당 일정만 사라짐 (6) 통계줄 "켜진 캘린더 4/5" 형태(미연동이라 구글 제외 여부는 구현 규칙대로) (7) 월 그리드에서 일정 드래그 이동 여전히 동작.
- [ ] **Step 6: 커밋** — `git commit -am "태그줄 추가·기존 유형/부서/휴가 필터 제거: 캘린더∩태그 필터로 교체"`

---### Task 3.5: EventCreateModal 개편 (M3 — 캘린더 선택·종일/시각·태그)

**Files:**
- Modify: `src/components/calendar/EventCreateModal.tsx` (PR1 이 ScheduleView 에서 분리한 파일 — `ls src/components/calendar/` 로 확인)
- Modify: `src/views/ScheduleView.tsx` (`handleAddEvent` 저장 라우팅 전달)

**필수 요소 체크리스트 (M3, 필드 순서 그대로):**
- [ ] ① 캘린더 드롭다운(필수): `useCalendarStore.calendars.filter(c => c.canEdit)` + gcal 연동 시 마지막에 `내 구글 캘린더` 옵션(고정 값 `GOOGLE_CALENDAR_OPTION = 'google'` — 모달 파일에 export const 로 정의). 아래 도움말 "편집 권한이 있는 캘린더만 보여요". 기본값 = 개인 캘린더(`isPersonal`).
- [ ] ② 제목 (기존 유지, 자동 제목 로직 유지)
- [ ] ③ 종일 토글(기본 켬). 끄면 시작/종료 각각 날짜+시각 4칸: 시각은 `<input type="time" step={600}>`, 기존 date input 과 같은 스타일(`colorScheme: colorMode` 포함 — 기존 date input 의 style 객체 재사용). 시작 시각 변경 시 종료 시각이 비어 있으면 +1시간 자동.
- [ ] ④ 태그 칩 단일 선택(선택 사항): `없음` + 태그들. 켠 칩 = 태그색 틴트.
- [ ] ⑤ 연결 세그먼트 `[없음|에피소드|파트|씬]` — 기존 evType/linked* 로직 유지(색 프리셋 `EVENT_COLORS` 선택 UI 는 **제거** — 색은 캘린더 소속).
- [ ] ⑥ 메모 (기존 유지)
- [ ] `나만 보기` 체크박스 **제거**(isPrivate — "개인" 캘린더 선택이 대체).
- [ ] 푸터 좌측: 알림 안내 — team 캘린더면 "팀 전원에게 알림이 가요", members 면 "이 캘린더 멤버 N명에게 알림이 가요"(N = members.length, 본인 제외 계산은 하지 않아도 됨 — 안내 문구일 뿐), 개인/구글이면 문구 없음. 우측: 취소 / 만들기.

- [ ] **Step 1: PR2 저장 라우팅 계약 재확인.**
  ```bash
  grep -n "addEvent" src/services/calendarService.ts | head
  ```
  PR2 의 `addEvent` 가 bflow/구글을 무엇으로 분기하는지(기대: `event.calendarId` 유무 또는 `source`) 확인하고, 모달 `onSave` payload 를 그 계약에 맞춘다: bflow → `{ calendarId, tagId?, allDay, startTime?, endTime?, ... }`, 내 구글 → 기존 공개 경로 필드(계약이 기대와 다르면 이 Task 를 실제 계약에 맞춤).
- [ ] **Step 2: 모달 개편 구현** (위 체크리스트). `onSave` 시그니처 변경에 따라 ScheduleView `handleAddEvent` 도 수정.
- [ ] **Step 3: 검증.** `npm run typecheck` → 오류 0. 프리뷰: `+ 일정` → (1) 캘린더 드롭다운에 개인/EP 마일스톤/리드 회의만(스튜디오 공지 없음 — canEdit false) + 도움말 문구 (2) 종일 끄기 → 시각 4칸 (3) 리드 회의 + 회의 태그 + 14:00–15:00 저장 → 그리드에 `14:00 <제목>` 칩 (4) 개인 캘린더로 종일 저장 → 보라색 칩. 새로고침 시 seed 초기화는 정상(인메모리).
- [ ] **Step 4: 커밋** — `git commit -am "새 일정 모달 개편: 캘린더 선택·종일/시각·태그 단일 선택, 나만 보기 제거"`

---

### Task 3.6: CalendarSettingsModal.tsx (M4 — 생성/설정·멤버 공유)

**Files:**
- Create: `src/components/calendar/CalendarSettingsModal.tsx`
- Modify: `src/views/ScheduleView.tsx` (레일 `onOpenSettings`/`onCreateCalendar` 연결)

재사용 검토(사전 확인 완료): `RevisionRecipientPicker` 의 props(`allUsers/defaultCheckedIds/excludeUserId/onChange(checkedIds)`)는 체크 여부만 전달해 **행별 보기|편집 토글을 표현할 수 없음** → 재사용하지 않고, 그 파일의 검색 드롭다운 패턴(`src/components/scenes/RevisionRecipientPicker.tsx` 의 searchOpen/query/외부클릭 처리)과 `CompositorAssignPopover` 의 저장 패턴만 참조해 자체 구현한다.

**필수 요소 체크리스트 (M4):**
- [ ] 헤더: `캘린더 설정`(생성 모드는 `새 캘린더`) + 배지 줄: `소유자 {이름}` · `만든 날` · `일정 N개`(생성 모드는 배지 줄 없음. eventCount 필드가 없으면 `calendarService.getEvents()` 결과에서 calendarId 로 집계 — eventCache 는 calendarService 내부라 직접 접근 불가).
- [ ] 이름 input + 색 10스와치(`EVENT_COLORS` — `src/types/calendar.ts:13`).
- [ ] 공개 범위 라디오: `나만` / `특정 팀원` / `팀 전체` — 팀 전체는 `currentUser.role === 'admin'` 만 활성, 비활성 시 옆에 `관리자만` 라벨.
- [ ] 멤버 섹션(특정 팀원 선택 시): 요약 "N명 · 편집 n · 보기 n" + `이름으로 추가…` 검색 인풋(`useAuthStore.users`에서, 이미 멤버·소유자 제외) + 행 = 아바타(`avatarColor`) + 이름 + `[보기|편집]` 세그먼트 토글 + 제거(X). 소유자 행은 맨 위 고정, 토글 대신 `변경 불가` 배지. 본인 행엔 `나` 표시.
- [ ] 팀 전체 선택 시에도 멤버 섹션 노출(= "추가 편집자" 목록, 설계서 §5) — 라벨을 `추가 편집자` 로 변경.
- [ ] `isPersonal` 캘린더: 공개 범위·멤버·삭제 섹션 숨김(이름·색만 편집 가능). 진입 가드는 레일 쪽 — 단 **`cal.canManage` 게이트는 ⋯ 메뉴 전체가 아니라 `설정 열기` 항목에만 건다**(Task 3.3 체크리스트와 동일 규칙). ⋯ 메뉴에는 누구나 쓰는 `이 캘린더 알림 끄기` 가 있으므로 메뉴 전체를 canManage 로 가리면 비관리자(일반 팀원이 보는 팀 캘린더)의 뮤트가 사라진다. **주의: 프리뷰 mock 은 배한솔(admin)이라 seed 캘린더 전부 canManage:true — 이 오구현은 실기 검증으로 잡히지 않으니 코드에서 게이트 위치를 직접 확인할 것.**
- [ ] 하단 `캘린더 삭제`(수정 모드 + `canManage` 만): 확인 다이얼로그 필수 — "일정 N개가 함께 삭제돼요" 경고. 기존 확인 다이얼로그 패턴 grep: `grep -rn "삭제할까요\|삭제하시겠" src/components | head -5` (예: `CharacterDetailModal.tsx` 의 confirm message 패턴 — "정말 삭제" 문자열은 레포에 없음) 후 동일 패턴 사용.
- [ ] 저장: 생성 모드 → `calendar:create` 후 `calendar:set-members`, 수정 모드 → `calendar:update` + `calendar:set-members` 를 `Promise.allSettled` 로 호출하고 **성공/실패 무관 항상 `loadCalendars()` 재조회**(팝오버 4대 체크리스트). 실패 시 toast + 모달 유지.

- [ ] **Step 1: 모달 구현.** 진입 4경로 연결: 레일 행 ⋯ → `설정 열기`, 레일 `+ 새 캘린더`, (수정 모드 초기값 = 선택 캘린더, 생성 모드 초기값 = 이름 '', 색 EVENT_COLORS[0], visibility 'members'). IPC 호출은 렌더러에서 `window.electronAPI.calendar*`(preload 이름 grep) 직접 또는 PR2 가 만든 서비스 함수 경유 — PR2 방식을 따른다: `grep -n "calendarCreate\|createCalendar" src/services/ src/stores/ -r`.
- [ ] **Step 2: 검증.** `npm run typecheck` → 오류 0. 프리뷰: (1) `+ 새 캘린더` → 이름 "컴포 TF"·색 선택·특정 팀원·장삐쭈 추가(보기) → 저장 → 레일 `내 캘린더` 에 즉시 표시 (2) 리드 회의 ⋯ → 설정 열기 → 멤버 행에 배한솔(나)·장삐쭈, 소유자 허혜원 `변경 불가` (3) 장삐쭈를 편집으로 토글 후 저장 → 재열람 시 유지 (4) admin 이므로 팀 전체 라디오 활성 (5) 방금 만든 컴포 TF 삭제 → 경고 다이얼로그 → 레일에서 제거 (6) 개인 캘린더 설정 → 이름·색만 보임.
- [ ] **Step 3: 커밋** — `git commit -am "캘린더 설정 모달 추가: 이름·색·공개 범위·멤버 보기/편집·삭제"`

---

### Task 3.7: TagManagerPopover.tsx (M5 — admin 태그 관리)

**Files:**
- Create: `src/components/calendar/TagManagerPopover.tsx`
- Modify: `src/views/ScheduleView.tsx` (TagBar `onOpenTagManager` 연결)

**필수 요소 체크리스트 (M5):**
- [ ] TagBar 의 `+ 태그 관리` 옆에 anchored 팝오버(createPortal + 위치 보정 — `EventQuickEdit.tsx:59-70` 화면 밖 보정 패턴 참조). 팝오버 4대 체크리스트 적용.
- [ ] 헤더: `태그 관리` + 비 admin 이면 `관리자만 편집` 라벨과 함께 **읽기 전용 열람**(행 편집/추가/삭제 버튼 미노출).
- [ ] 행 = 색 점 + 이름 + (admin) 위/아래 화살표 버튼(lucide `ChevronUp`/`ChevronDown` — 드래그 정렬 대신 단순 우선) + 연필(인라인 편집: 이름 input + 색 스와치 10종 + 확인/취소) + 휴지통.
- [ ] `+ 새 태그` (admin): 빈 인라인 편집 행 추가.
- [ ] 삭제 시 경고: "이 태그를 쓰는 일정은 '태그 없음'으로 바뀌어요" 확인 후 진행.
- [ ] 하단 안내문: "휴가는 자동 태그라 여기서 바꿀 수 없어요" (휴가 칩은 목록에 없음).
- [ ] 저장 모델: 팝오버 내 편집은 로컬 draft 배열로 쌓고, 변경 즉시가 아니라 각 행 확정(확인/삭제/정렬) 시마다 `calendar:tags:save`(일괄 저장) 호출 → 성공/실패 무관 `loadTags()` 재조회. admin 검증은 메인이 하므로(설계서 §6.1) 렌더러는 UI 게이트만.

- [ ] **Step 1: 팝오버 구현** (위 체크리스트, admin 판정 `useAuthStore.currentUser?.role === 'admin'`).
- [ ] **Step 2: 검증.** `npm run typecheck` → 오류 0. 프리뷰(배한솔=admin): (1) `+ 태그 관리` → 4개 행 (2) `업로드` 이름을 `업로드일` 로 인라인 수정 → 태그줄 칩 즉시 갱신 (3) `대본` 을 위로 이동 → 칩 순서 변경 (4) 새 태그 `리뷰` 추가 → 칩 등장 (5) `리뷰` 삭제 → 경고 후 제거 (6) `회의` 삭제 → 리드 회의 칩 텍스트가 `14:00 리드 회의`(시간 일정이라 그대로), `컴포 TF 싱크` 등 태그 삭제 확인은 월 그리드 칩이 아니라 주 보기 부제(`formatEventTimeRange` 결과에서 `· 회의` 가 사라짐) 또는 상세 패널의 태그 칩에서 확인(시간 일정이라 월 그리드 칩엔 태그명이 안 보임). 일정은 계속 표시.
- [ ] **Step 3: 커밋** — `git commit -am "태그 관리 팝오버 추가: 인라인 편집·정렬·삭제 경고, 관리자만 편집"`

---

### Task 3.8: EventSidePanel 확장 + EventQuickEdit 교체 (M1 우측 패널 / §3.6)

**Files:**
- Modify: `src/components/calendar/EventSidePanel.tsx`
- Modify: `src/components/calendar/EventQuickEdit.tsx`
- Modify: `src/views/ScheduleView.tsx` (props 변경 반영)

**EventSidePanel 체크리스트 (M1 `일정 상세`):**
- [ ] 표시 추가: 캘린더 행(색 점 + 이름), 태그 칩, 날짜에 시각 병기 "9월 10일 (수) 14:00 – 15:00"(시간 일정일 때 — `formatEventTimeRange` 재사용 또는 날짜 포맷에 startTime/endTime 붙이기), 만든이(기존), 연결(기존), 메모(기존).
- [ ] 편집 모드(canEdit)에 **캘린더 이동**(편집 가능 캘린더 select — 구글↔bflow 교차 이동은 v1 제외, bflow 캘린더 간만) + **태그 변경**(칩 단일 선택) 추가 → `onUpdate(id, { calendarId, tagId })`. 낙관적 반영 후 실패 롤백은 기존 `handleUpdateEventDirect` 경로 그대로.
- [ ] 시간 편집: 편집 모드에서 종일 토글 + 시각 4칸(Task 3.5 와 동일 마크업 재사용 가능하면 소형 공용 컴포넌트로 추출 — `src/components/calendar/TimeRangeFields.tsx`, 아니면 중복 허용 범위).
- [ ] **보기 전용**: `event.canEdit === false || event.isReadOnly` 이면 편집·삭제 버튼 미노출 + 헤더에 `보기 전용` 라벨. 기존 `isVacation`(`EventSidePanel.tsx:148`) 분기를 이 판정으로 일반화.
- [ ] 기존 `나만 보기` draft(draftPrivate) UI 제거 — 개인 캘린더로 이동이 대체.

**EventQuickEdit 체크리스트 (§3.6):**
- [ ] `색상` 탭(EVENT_COLORS 그리드, `onUpdateColor` prop) 제거 → `태그·캘린더` 탭: 태그 칩 단일 선택(즉시 `onUpdate(id,{tagId})`) + 캘린더 이동 select(편집 가능만, 즉시 `onUpdate(id,{calendarId})`) + 기존 복제/삭제 버튼 유지.
- [ ] `일정 편집` 탭(제목/날짜/유형/메모) 유지. 보기 전용 이벤트는 기존 isVacation 처리처럼 편집 차단 + 복제만 허용.
- [ ] ScheduleView 호출부에서 `onUpdateColor` prop 제거(`grep -n "onUpdateColor" src -r` → 0건이 될 것).

- [ ] **Step 1: isReadOnly 연결 재확인.**
  ```bash
  grep -n "canEdit\|isReadOnly" src/services/calendarService.ts | head
  ```
  PR2 가 bflow 이벤트 매핑에서 `canEdit:false → isReadOnly:true` 를 세팅했는지 확인. 안 했으면 `loadBflowEvents` 매핑에 한 줄 추가(드래그 차단은 `isReadOnly` 로 동작 — `ScheduleView` 의 `handleBarDragStart` 가 이미 차단).
- [ ] **Step 2: EventSidePanel 확장 구현.**
- [ ] **Step 3: EventQuickEdit 탭 교체 구현.**
- [ ] **Step 4: 검증.** `npm run typecheck` → 오류 0. 프리뷰: (1) `전체 회식`(스튜디오 공지, canEdit false) 클릭 → 패널에 `보기 전용` + 편집/삭제 없음, 드래그도 안 됨 (2) `리드 회의` 클릭 → 캘린더 행·`회의` 태그 칩·"14:00 – 15:00" 표시 (3) 편집 → 태그를 `없음`, 캘린더를 `EP 마일스톤` 으로 이동 → 칩 색이 하늘색으로 변경 (4) `EP05 업로드` 우클릭 → 색상 탭이 없고 태그·캘린더 탭 (5) 우클릭 → 복제 동작 유지.
- [ ] **Step 5: 커밋** — `git commit -am "상세 패널에 캘린더·태그·시각 추가, 퀵에디트 색상 탭을 태그·캘린더 변경으로 교체"`

---

### Task 3.9: 주/오늘 보기 시간 표시 (M2)

**Files:**
- Modify: `src/components/calendar/WeekScrollView.tsx` (`EventCard`, `WeekScrollView.tsx:414-475` — PR1 후 줄번호 재확인)
- Modify: `src/components/calendar/DayScrollView.tsx` (`DayEventCard`)

**체크리스트 (M2 — 시간표 축은 만들지 않는다):**
- [ ] 하루 카드 목록 정렬: `sortEventsForList` 적용(종일 먼저, 시간 일정 시각순). 두 파일의 이벤트 나열 지점을 grep 으로 찾아 적용: `grep -n "\.map((ev" src/components/calendar/WeekScrollView.tsx src/components/calendar/DayScrollView.tsx`.
- [ ] 시간 일정 카드 부제: 기존 `{dateRange}{spanDays} · {event.type}` 의 `event.type` 원시 노출을 정리하고, 시간 일정이면 `formatEventTimeRange(ev, tagNameById)` 결과("14:00 – 15:00 · 회의")를, 종일이면 태그명(있을 때만)을 표기.
- [ ] tagNameById 는 `useCalendarStore.tags` 에서 `useMemo` 로 생성해 prop 으로 내리거나 카드 컴포넌트에서 직접 구독(파일당 한 곳에서만 구독 — 중복 셀렉터 금지).

- [ ] **Step 1: 구현** (두 파일).
- [ ] **Step 2: 검증.** `npm run typecheck` → 오류 0. 프리뷰: 주 보기 → 리드 회의가 있는 날에 종일 일정(있다면)이 먼저, `리드 회의` 카드 부제가 "14:00 – 15:00 · 회의". 오늘 보기(seed 날짜가 오늘과 겹치지 않으면 미니 달력/일정 생성으로 오늘 날짜에 시간 일정 하나 만들어 확인).
- [ ] **Step 3: 커밋** — `git commit -am "주/오늘 보기: 종일 우선 정렬과 시각 부제 표시"`

---

### Task 3.10: 일정 칩 규칙 (M1/§3.2) + CalendarWidget 자동 표시 확인

**Files:**
- Modify: `src/components/calendar/CalendarGrid.tsx` (EventBarChip 텍스트)
- Modify: `src/services/calendarService.ts` (구글 고정색 — 미적용 시에만)
- Modify: `src/utils/vacationEvents.ts` (휴가 고정색 확인 — 미적용 시에만)

- [ ] **Step 1: 색 규칙 재확인 (PR2 산출물 점검).**
  ```bash
  grep -n "#8B8DA3\|#00B894\|color" src/services/calendarService.ts | head -20
  grep -n "color" src/utils/vacationEvents.ts
  ```
  기대: bflow 이벤트 `color` = 캘린더 색(loadBflowEvents 매핑), 구글 = `#8B8DA3`, 휴가 = `#00B894`. 구글이 여전히 `'#6C5CE7'` 고정(연구문서 §1-4 `toCalendarEvent :152` TODO 잔재)이면 `#8B8DA3` 으로 교체. 색상 하드코딩 수정 시 `grep -rn "6C5CE7" src/components/calendar src/views/ScheduleView.tsx` 로 잔여 지점 전수 확인(lessons: 색상 수정은 calendar/* 전체 grep).
- [ ] **Step 2: EventBarChip 텍스트 교체.** `CalendarGrid.tsx` 의 칩 라벨을 `formatEventChipText(ev, tagNameById, calendarNameById)` 로 교체(틴트 배경은 기존 `hexToRgba(event.color, ...)` 유지 — 색은 이미 캘린더 색). tagNameById/calendarNameById 는 ScheduleView 에서 `useMemo` 로 만들어 CalendarGrid prop 으로 전달.
- [ ] **Step 3: CalendarWidget 자동 표시 확인(코드 변경 없음 — D4).** 위젯은 `calendarService.getEvents()` 병합 캐시를 읽으므로(`src/components/widgets/CalendarWidget.tsx:6,115`) bflow 일정이 자동 표시되어야 한다. 프리뷰 대시보드에서 캘린더 위젯에 seed 일정이 캘린더 색으로 보이는지 확인. 위젯의 유형 필터(`typeFilter`)는 그대로 둔다(비범위). 표시가 안 되면 위젯이 아니라 `loadBflowEvents` 호출 시점(구글 가드 밖 로드 — PR2 몫) 문제이므로 `App.tsx`/서비스에서 원인 추적.
- [ ] **Step 4: 검증.** `npm run typecheck` → 오류 0. `npm run test:calendar` → pass. 프리뷰 월 그리드: (1) `업로드 · EP05 업로드`(하늘색 틴트) (2) `14:00 리드 회의` (3) 태그 없는 `스튜디오 공지 · 전체 회식` (4) `개인 · 치과` 는 시간 일정이므로 `09:30 치과`.
- [ ] **Step 5: 커밋** — `git commit -am "일정 칩 텍스트 규칙 적용: 태그·제목/HH:MM 제목, 소스 고정색 정리"`

---

### Task 3.11: 마무리 — 시안 대조·검증 게이트·update-notes·버전·PR

**Files:**
- Modify: `DEVLOG/update-notes.json`
- Modify: `package.json`, `package-lock.json` (버전)

- [ ] **Step 1: 시안 M1~M6 나란히 대조 (요소 단위 체크리스트).** 각 시안 파일을 브라우저로 열고 프리뷰 화면과 비교:
  - M1(월): 레일 섹션 4개·배지·태그줄·통계줄·칩 텍스트(`업로드 · EP05 업로드`/`14:00 리드 회의`)·우측 일정 상세(캘린더/태그/시각/연결/만든이/메모)
  - M2(주): 주차 목록 유지·태그줄·카드 부제 시각 표시·시간표 축 없음
  - M3(새 일정): 필드 순서 ①~⑥·도움말 문구·푸터 알림 안내·나만 보기 없음
  - M4(설정): 배지 줄·색 스와치·공개 범위 라디오(관리자만 라벨)·멤버 행 보기|편집·변경 불가 배지·삭제 경고
  - M5(태그 관리): 관리자만 편집 라벨·인라인 편집·새 태그·휴가 자동 태그 안내. 정렬은 위/아래 화살표 방식으로 대체(승인된 단순화 — 시안의 드래그 핸들과 다름)
  - M6: 알림 패널은 PR4 범위 — 우측 "구글 미연동 사용자" 레일 상태(회색 점 + 연동 안내)만 이번 PR 대조 대상
  불일치 항목은 즉시 수정 후 해당 Task 의 커밋에 이어 `git commit -am "시안 대조 보완: <항목>"`.
- [ ] **Step 2: 프리뷰 통합 시나리오 (한 흐름으로).** 배한솔/1234 로그인 → 캘린더 탭 → (1) `+ 새 캘린더` 로 "컴포 TF"(특정 팀원, 장삐쭈 보기) 생성 → (2) 설정 재진입해 장삐쭈를 편집으로 변경 → (3) `+ 일정` 으로 컴포 TF 에 시간 일정(15:00–16:00, 태그 회의) 생성 → (4) `회의` 태그 끄기 → 방금 일정 숨김, `전체` 로 복구 → (5) 레일에서 컴포 TF 끄기/켜기 → (6) `전체 회식` 클릭 → 보기 전용 확인 → (7) 우클릭 퀵에디트로 `EP05 업로드` 태그를 가편으로 변경 → 칩 텍스트 즉시 갱신. 각 단계 스크린샷 또는 확인 메모.
- [ ] **Step 3: 검증 게이트 (chunk0 §0.3 순서 그대로).**
  ```bash
  npm run typecheck
  npm run test:calendar
  npm run build:vite
  ```
  기대: 전부 통과. 실패 시 완료 표시 금지, 원인 수정 후 재실행.
- [ ] **Step 4: update-notes.json 항목 추가.** `DEVLOG/update-notes.json` 최상단에 이번 버전 항목(비개발자 톤 — chunk0 §0.3, 식별자·기술용어 금지). 예시문:
  ```json
  {
    "version": "<Step 5 에서 확정>",
    "date": "<배포일>",
    "summary": "캘린더가 팀 공유 캘린더로 새 단장했어요",
    "description": "이제 구글 계정을 연동하지 않아도 팀 일정이 보여요. 캘린더 왼쪽에서 팀 캘린더를 만들고 원하는 팀원에게 보기 또는 편집 권한으로 공유할 수 있어요. 일정에는 업로드·가편 같은 태그를 달아 원하는 것만 골라 볼 수 있고, 회의처럼 시간이 정해진 일정은 14:00 – 15:00 형태로 표시돼요. 다른 사람이 공유해 준 캘린더는 권한에 따라 보기만 되거나 함께 편집할 수 있어요."
  }
  ```
  실제 파일의 기존 항목 구조(`categories` 등 추가 필드 여부)를 먼저 보고 같은 형태로 맞춘다: `head -40 DEVLOG/update-notes.json`.
- [ ] **Step 5: 버전 산정.** `git fetch origin && git show origin/main:package.json | grep '"version"'` — 그 시점 최신 버전 기준 **마이너 +1** (기능 PR). `package.json` + `package-lock.json` 2곳(최상단 `version` + `packages[""].version`) 3자 일치 확인:
  ```bash
  grep -n '"version"' package.json package-lock.json | head -3
  ```
- [ ] **Step 6: 커밋 + PR 생성.** `git commit -am "vX.Y.0 캘린더 공유 UI: 레일·태그줄·설정/태그 모달·상세 패널 개편"` → push → **`pr-creator` 스킬로 PR 생성**(본문 "업데이트 요약" 은 Step 4 와 같은 비개발자 톤, 상세 기술 설명 섹션은 개발자 톤 OK). base: main.
- [ ] **Step 7: `codex-review-loop` 스킬로 리뷰 루프.** P1/P2/P3 수정·재트리거를 명시 완료 신호까지 반복. **머지·G드라이브 배포·슬랙 공지는 한솔 명시 지시 시에만**(chunk0 §0.3).

---

## Chunk 4: PR4 — 알림·실시간·마감 (브랜치 claude/calendar-pr4-notify)

> 전제: PR1(정리)·PR2(데이터/IPC)·PR3(UI) 머지 완료 + 마이그레이션 `2026-08-24-shared-calendars.sql` 라이브 적용 완료 상태에서 시작한다.
> 이 chunk 의 파일:줄 번호는 main=93f2c9d 조사 시점 기준이며 PR1~3 이 대부분을 옮겼다. **모든 수정 전 반드시 grep 으로 현재 위치를 재확인**한다.
> PR2 산출물(`electron/calendarStore.ts`, `electron/calendarIpc.ts`, `src/stores/useCalendarStore.ts`, `loadBflowEvents`)의 실제 함수명·시그니처는 PR2 머지 결과가 SSOT 다. 이 chunk 의 코드 블록은 "PR2 가 chunk0 지도대로 만들어졌다"는 가정의 기준 구현이며, 이름이 다르면 **기존 이름을 따르고 로직만 이식**한다.

시작 절차:

- [ ] **Step 0-1: 브랜치 생성** — `git fetch origin && git checkout -b claude/calendar-pr4-notify origin/main`. 기대: 최신 main(PR3 머지 포함)에서 분기.
- [ ] **Step 0-2: PR2/PR3 산출물 현황 확인** — `grep -n "calendar:notifications" electron/calendarIpc.ts electron/preload.ts` / `grep -n "mutedCalendarIds\|muted" src/stores/useCalendarStore.ts` / `grep -n "loadBflowEvents" src/services/calendarService.ts` 실행. 기대: loadBflowEvents 는 존재. notifications IPC·뮤트 상태는 존재 여부를 기록해 두고 아래 Task 에서 "없으면 추가" 분기를 따른다.
- [ ] **Step 0-3: electron → src/shared 임포트 패턴 확인** — `electron/*.ts` 에서 `../src/shared` 임포트가 실제 빌드를 통과하는지 확인한다. `grep -rn "src/shared" electron/` 로 PR2 의 `src/shared/calendarPermissions.ts` 가 이 패턴을 이미 성립시켰는지 확인하고, `npm run typecheck` 로 검증. 성립돼 있지 않으면 Task 4.1 에서 `calendarNotifications.ts` 임포트를 동일 방식으로 성립시킨다.

---

### Task 4.1: 알림 순수 함수 + 메인 프로세스 알림 생성 (TDD)

**Files:**
- Create: `src/shared/calendarNotifications.ts`
- Create: `tests/calendarNotifications.test.ts`
- Modify: `electron/calendarStore.ts` (알림 CRUD 3함수 추가)
- Modify: `electron/calendarIpc.ts` (events create/update/delete 성공 후 best-effort 알림 insert)
- Modify: `package.json` (`test:calendar` 스크립트에 테스트 파일 추가)
- Test: `tests/calendarNotifications.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `tests/calendarNotifications.test.ts` 를 아래 케이스로 작성한다. 임포트는 상대 경로 + `.ts` 확장자(기존 `tests/myTasksStats.test.ts` 스타일, `@/` alias 금지).

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCalendarNotificationRecipients,
  formatCalendarDateShort,
  buildCalendarChangeDetail,
  buildCalendarNotificationText,
} from '../src/shared/calendarNotifications.ts';

test('수신자: members 캘린더 = 소유자 + 멤버 - 행위자', () => {
  const r = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'members' },
    ['u2', 'u3'],
    ['u1', 'u2', 'u3', 'u4', 'u5'],
    'u2',
  );
  assert.deepEqual(r.sort(), ['u1', 'u3']);
});

test('수신자: team 캘린더 = 전체 사용자 - 행위자', () => {
  const r = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'team' },
    [],
    ['u1', 'u2', 'u3'],
    'u1',
  );
  assert.deepEqual(r.sort(), ['u2', 'u3']);
});

test('수신자: 소유자가 멤버에도 있으면 중복 제거', () => {
  const r = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'members' },
    ['u1', 'u2'],
    ['u1', 'u2', 'u3'],
    'u3',
  );
  assert.deepEqual(r.sort(), ['u1', 'u2']);
});

test('수신자: 개인(private) 캘린더에서 본인 행위 = 빈 배열 (알림 없음)', () => {
  const r = computeCalendarNotificationRecipients(
    { owner_id: 'u1', visibility: 'private' },
    [],
    ['u1', 'u2'],
    'u1',
  );
  assert.deepEqual(r, []);
});

test('날짜 축약: 2026-09-05 → 9/5, 파싱 불가는 원문 유지', () => {
  assert.equal(formatCalendarDateShort('2026-09-05'), '9/5');
  assert.equal(formatCalendarDateShort('2026-12-25'), '12/25');
  assert.equal(formatCalendarDateShort('nonsense'), 'nonsense');
});

test('detail: 시작일 변경 시에만 M/D → M/D', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-26', endDate: '2026-09-26' },
    ),
    '9/25 → 9/26',
  );
});

test('detail: 시작일 동일 + 종료일만 변경 → 종료일 기준', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-25', endDate: '2026-09-27' },
    ),
    '9/25 → 9/27',
  );
});

test('detail: 날짜 무변경(제목·메모·태그만) → null', () => {
  assert.equal(
    buildCalendarChangeDetail(
      { startDate: '2026-09-25', endDate: '2026-09-25' },
      { startDate: '2026-09-25', endDate: '2026-09-25' },
    ),
    null,
  );
});

test('문구: create / update(detail 유·무) / delete', () => {
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'create', detail: null }),
    { title: '한솔 님이 [EP 마일스톤] 에 일정을 추가했어요', body: "'EP12 업로드'" },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'update', detail: '9/25 → 9/26' }),
    { title: "한솔 님이 'EP12 업로드' 을 변경했어요", body: '9/25 → 9/26' },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'update', detail: null }),
    { title: "한솔 님이 'EP12 업로드' 을 변경했어요", body: '[EP 마일스톤]' },
  );
  assert.deepEqual(
    buildCalendarNotificationText({ actorName: '한솔', calendarName: 'EP 마일스톤', eventTitle: 'EP12 업로드', action: 'delete', detail: null }),
    { title: '한솔 님이 [EP 마일스톤] 의 일정을 삭제했어요', body: "'EP12 업로드'" },
  );
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/calendarNotifications.test.ts`. 기대: 모듈 없음(ERR_MODULE_NOT_FOUND)으로 전부 실패.
- [ ] **Step 3: 순수 함수 모듈 구현** — `src/shared/calendarNotifications.ts` 를 아래 전체 코드로 생성한다. 외부 의존 0개(node --test 직접 임포트 대상).

```ts
// 캘린더 알림 — 수신자 계산·문구 생성 순수 함수 (메인·렌더러·테스트 공용).
// 설계서 §3.7/§8. node --test 가 직접 임포트하므로 @/ alias·외부 import 금지.

export type CalendarNotificationAction = 'create' | 'update' | 'delete';

export interface NotifCalendarShape {
  owner_id: string;
  visibility: 'private' | 'members' | 'team';
}

/** 수신자 = 해당 캘린더를 볼 수 있는 사용자 전원 - 행위자 본인.
 *  team 이면 전체 users, 그 외는 소유자 + calendar_members. 중복 제거. */
export function computeCalendarNotificationRecipients(
  calendar: NotifCalendarShape,
  memberUserIds: string[],
  allUserIds: string[],
  actorId: string,
): string[] {
  const base = calendar.visibility === 'team'
    ? allUserIds
    : [calendar.owner_id, ...memberUserIds];
  return Array.from(new Set(base)).filter((id) => !!id && id !== actorId);
}

/** '2026-09-25' → '9/25'. 형식이 다르면 원문 그대로 반환. */
export function formatCalendarDateShort(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** update 알림의 detail — 날짜가 실제로 바뀐 경우에만 'M/D → M/D'.
 *  시작일 변경 우선, 시작일이 같고 종료일만 바뀌면 종료일 기준. 그 외 변경은 null. */
export function buildCalendarChangeDetail(
  prev: { startDate: string; endDate: string },
  next: { startDate: string; endDate: string },
): string | null {
  if (prev.startDate !== next.startDate) {
    return `${formatCalendarDateShort(prev.startDate)} → ${formatCalendarDateShort(next.startDate)}`;
  }
  if (prev.endDate !== next.endDate) {
    return `${formatCalendarDateShort(prev.endDate)} → ${formatCalendarDateShort(next.endDate)}`;
  }
  return null;
}

export interface CalendarNotificationTextInput {
  actorName: string;
  calendarName: string;
  eventTitle: string;
  action: CalendarNotificationAction;
  detail: string | null;
}

/** 알림 패널 표시 문구 (설계서 §3.7) — realtime push 와 catchup 이 같은 문구를 쓴다. */
export function buildCalendarNotificationText(
  row: CalendarNotificationTextInput,
): { title: string; body: string } {
  switch (row.action) {
    case 'create':
      return {
        title: `${row.actorName} 님이 [${row.calendarName}] 에 일정을 추가했어요`,
        body: `'${row.eventTitle}'`,
      };
    case 'update':
      return {
        title: `${row.actorName} 님이 '${row.eventTitle}' 을 변경했어요`,
        body: row.detail ?? `[${row.calendarName}]`,
      };
    case 'delete':
      return {
        title: `${row.actorName} 님이 [${row.calendarName}] 의 일정을 삭제했어요`,
        body: `'${row.eventTitle}'`,
      };
  }
}
```

- [ ] **Step 4: 통과 확인** — `node --test ./tests/calendarNotifications.test.ts`. 기대: 전 케이스 pass.
- [ ] **Step 5: 메인측 알림 CRUD 함수 추가** — `electron/calendarStore.ts` 에 아래 3함수를 추가한다. supabase 클라이언트·에러 처리 유틸은 파일 내 기존 import 를 따른다(`grep -n "^import" electron/calendarStore.ts` 로 확인 — throwIfError 미사용 파일이면 `if (error) throw error;` 로 대체).

```ts
export interface CalendarNotificationInsertRow {
  recipient_id: string;
  actor_id: string;
  actor_name: string;
  calendar_id: string;
  calendar_name: string;
  event_id: string | null;
  event_title: string;
  event_date: string;          // YYYY-MM-DD — 클릭 시 이동 대상 날짜
  action: 'create' | 'update' | 'delete';
  detail: string | null;
}

/** 알림 행 일괄 insert — best-effort: 실패는 호출부가 warn 처리하고 저장은 성공 유지. */
export async function sbInsertCalendarNotifications(
  rows: CalendarNotificationInsertRow[],
): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase.from('calendar_notifications').insert(rows);
  if (error) throw error;
}

/** 캐치업 — 최근 30일 내 미읽음 알림 (설계서 §8.5). 행 수 작음 — limit 200 상한. */
export async function sbFetchCalendarNotificationsCatchup(
  userId: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('calendar_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .gt('created_at', sinceIso)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Record<string, unknown>[];
}

/** 읽음 처리 */
export async function sbMarkCalendarNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 6: calendarIpc 에 알림 생성 훅 배선** — `electron/calendarIpc.ts` 의 `calendar:events:create` / `calendar:events:update` / `calendar:events:delete` 핸들러에서 **저장 성공 직후** 아래 헬퍼를 fire-and-forget(`void notifyCalendarEventChange(...)`) 으로 호출한다. update 핸들러는 patch 적용 **전의 기존 행**(start_date/end_date)을 확보해 `buildCalendarChangeDetail` 을 계산한다 — PR2 구현이 권한 검증을 위해 기존 행을 이미 조회하고 있으면 그 값을 재사용(`grep -n "events:update" -A 20 electron/calendarIpc.ts` 로 확인). 사용자 전체 목록은 `electron/supabase.ts` 의 기존 `readUsers()` 를 사용한다. `memberUserIds` 는 PR2 핸들러가 권한 검증 등으로 멤버 목록을 이미 들고 있으면 그 값을 재사용하고, 없으면 `electron/calendarStore.ts` 의 멤버 조회 함수(`listCalendarsWithMembers` 또는 동등 함수)를 호출해 채우는 폴백을 둔다.

```ts
import {
  computeCalendarNotificationRecipients,
  buildCalendarChangeDetail,
} from '../src/shared/calendarNotifications';
import { sbInsertCalendarNotifications } from './calendarStore';
import { readUsers } from './supabase';

interface NotifyEventChangeInput {
  actorId: string;
  action: 'create' | 'update' | 'delete';
  calendar: { id: string; name: string; owner_id: string; visibility: 'private' | 'members' | 'team' };
  memberUserIds: string[];
  event: { id: string | null; title: string; start_date: string };
  /** update 에서 날짜가 바뀐 경우에만 'M/D → M/D' — buildCalendarChangeDetail 결과 */
  detail: string | null;
}

/** 일정 CRUD 성공 직후 호출. 알림은 best-effort — 실패해도 일정 저장은 성공 처리 (설계서 §8.1). */
async function notifyCalendarEventChange(input: NotifyEventChangeInput): Promise<void> {
  try {
    const users = await readUsers();
    const actor = users.find((u) => u.id === input.actorId);
    const recipients = computeCalendarNotificationRecipients(
      input.calendar,
      input.memberUserIds,
      users.map((u) => u.id),
      input.actorId,
    );
    if (!recipients.length) return; // 개인 캘린더 본인 작업 등 — 알림 없음
    await sbInsertCalendarNotifications(recipients.map((recipientId) => ({
      recipient_id: recipientId,
      actor_id: input.actorId,
      actor_name: actor?.name ?? '알 수 없음',
      calendar_id: input.calendar.id,
      calendar_name: input.calendar.name,
      event_id: input.event.id,
      event_title: input.event.title,
      event_date: input.event.start_date,
      action: input.action,
      detail: input.detail,
    })));
  } catch (err) {
    console.warn('[calendarIpc] 알림 insert 실패 (best-effort — 일정 저장은 성공 유지):', err);
  }
}
```

- [ ] **Step 7: test:calendar 스크립트에 연결** — `package.json` 의 `test:calendar`(PR2 신설) 에 `./tests/calendarNotifications.test.ts` 추가. `npm run test:calendar` 실행. 기대: 신규 포함 전 캘린더 테스트 pass.
- [ ] **Step 8: typecheck + 커밋** — `npm run typecheck` 통과 후 커밋: `캘린더 일정 변경 시 앱 내 알림 행 생성 (수신자·문구 순수 함수 + 테스트)`.

---

### Task 4.2: 캐치업 + 알림 스토어 확장 + 클릭 내비 + 읽음 처리

**Files:**
- Modify: `electron/calendarIpc.ts` (`calendar:notifications:catchup` / `:mark-read` 핸들러 — PR2 에 이미 있으면 검증만)
- Modify: `electron/preload.ts` (`calendarNotificationsCatchup` / `calendarNotificationsMarkRead` — 동일)
- Modify: `src/types/index.ts` (electronAPI 타입 2개 추가)
- Modify: `src/stores/useNotificationStore.ts` (NotificationType 에 `calendar` + metadata 필드)
- Modify: `src/utils/notificationIdentity.ts` (calendar identity — 캐치업 재실행 dedupe)
- Modify: `src/utils/notificationDomainRead.ts` (읽음 → mark-read IPC)
- Modify: `src/components/NotificationPanel.tsx` (아이콘/라벨 + 클릭 내비)
- Modify: `src/App.tsx` (캘린더 알림 catch-up effect)
- Test: `tests/calendarNotifications.test.ts` (기존), `npm run test:notifications` (회귀)

- [ ] **Step 1: IPC 핸들러 추가/확인** — Step 0-2 결과에 따라: 없으면 `electron/calendarIpc.ts` 에 아래 2 핸들러를 추가한다(세션 검증 패턴은 파일 내 기존 핸들러와 동일하게 — `getSessionUserIdOrThrow` 사용, 인자로 받은 userId 를 신뢰하지 않고 세션 userId 로 조회).

```ts
ipcMain.handle('calendar:notifications:catchup', wrapIpc(async () => {
  const userId = getSessionUserIdOrThrow();
  const rows = await sbFetchCalendarNotificationsCatchup(userId);
  return rows.map(mapCalendarNotificationRow);
}));

ipcMain.handle('calendar:notifications:mark-read', wrapIpc(async (_e: unknown, id: string) => {
  getSessionUserIdOrThrow(); // 세션 검증만 — 행 소유 검증은 recipient 단일 UPDATE 라 위험도 낮음
  await sbMarkCalendarNotificationRead(id);
}));

/** DB snake_case → 렌더러 camelCase (fetchMissedSceneAssignmentNotifications 패턴) */
function mapCalendarNotificationRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    recipientId: String(r.recipient_id),
    actorId: (r.actor_id as string) ?? null,
    actorName: (r.actor_name as string) ?? null,
    calendarId: (r.calendar_id as string) ?? null,
    calendarName: (r.calendar_name as string) ?? null,
    eventId: (r.event_id as string) ?? null,
    eventTitle: (r.event_title as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    action: r.action as 'create' | 'update' | 'delete',
    detail: (r.detail as string) ?? null,
    createdAt: String(r.created_at),
  };
}
```

`wrapIpc`/세션 헬퍼 이름은 `grep -n "wrapIpc\|getSessionUserIdOrThrow" electron/calendarIpc.ts electron/main.ts` 로 실명 확인 후 맞춘다.
- [ ] **Step 2: preload + 타입** — `electron/preload.ts` 에 (없으면) 추가하고, `src/types/index.ts` 의 electronAPI 인터페이스(`grep -n "calendarBroadcastChange" src/types/index.ts` 부근)에 시그니처 추가.

```ts
calendarNotificationsCatchup: () => ipcRenderer.invoke('calendar:notifications:catchup'),
calendarNotificationsMarkRead: (id: string) => ipcRenderer.invoke('calendar:notifications:mark-read', id),
```

- [ ] **Step 3: 알림 스토어 확장** — `src/stores/useNotificationStore.ts`:
  - `NotificationType` 유니온에 `'calendar'` 추가(주석: PR4 캘린더 일정 변경 알림).
  - `metadata` 에 3필드 추가: `calendarNotificationId?: string;`(mark-read 용) `calendarId?: string;`(뮤트 필터) `eventDate?: string;`(클릭 이동 날짜, YYYY-MM-DD).
  - `countUnreadMentions` 의 필터 조건에 `|| x.type === 'calendar'` 추가 — mention 류와 동일하게 강조 배지에 포함(캘린더 공유 알림은 즉시 인지 대상).
- [ ] **Step 4: identity + domain read** — `src/utils/notificationIdentity.ts` 의 `getNotificationIdentity` 상단 패턴(feedbackNotificationId 등)과 동일하게 추가: `const calendarNotificationId = asNonEmptyString(metadataField(metadata, 'calendarNotificationId')); if (calendarNotificationId) return \`calendar:${calendarNotificationId}\`;` — 미읽음 기준 캐치업이 앱 재시작마다 같은 행을 다시 가져와도 패널에 중복이 쌓이지 않는다. `src/utils/notificationDomainRead.ts` 에는:

```ts
const calendarNotificationId = asString(metadataValue(metadata, 'calendarNotificationId'));
if (type === 'calendar' && calendarNotificationId) {
  Promise.resolve(window.electronAPI?.calendarNotificationsMarkRead?.(calendarNotificationId))
    .catch((err) => console.warn('[notificationDomainRead] 캘린더 알림 read 실패:', err));
}
```

- [ ] **Step 5: NotificationPanel** — `src/components/NotificationPanel.tsx`:
  - 타입별 아이콘 switch 에 `case 'calendar': return { icon: CalendarDays, color: '#74B9FF', label: '일정' };` (lucide `CalendarDays` import 추가, 이모지 금지).
  - `handleNavigate` 최상단에 calendar 분기 — `MyTasksWidget.navigateToCalendar` 패턴(뷰 전환 후 300ms 뒤 dispatch) 미러:

```ts
if (n.type === 'calendar') {
  useAppStore.getState().setView('schedule');
  const date = n.metadata?.eventDate;
  if (date) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bflow:navigate-to-date', { detail: { date } }));
    }, 300);
  }
  setPanelOpen(false);
  return;
}
```

  `useAppStore` import 여부는 grep 으로 확인 후 없으면 추가. delete 알림도 event_date 가 저장돼 있으므로 같은 경로로 그 날짜로 이동한다(일정은 없어도 날짜 컨텍스트 제공).
- [ ] **Step 6: App.tsx 캐치업 effect** — 씬 배정 catch-up effect(`grep -n "assignmentCatchupDoneRef" src/App.tsx`) 바로 아래에 평행 구조로 추가. lastSeen 대신 **read_at 기준(미읽음 30일)** 이므로 lastSeenTracker·페이지네이션 불필요(200행 상한).

```ts
// PR4: 캘린더 알림 catch-up — 최근 30일 미읽음 (read_at 기준, 씬 배정 catch-up 과 평행 구조)
const calendarCatchupDoneRef = useRef<string | null>(null);
useEffect(() => {
  if (!currentUser) { resetCatchupRun(calendarCatchupDoneRef); return; }
  if (!authReady) return;
  if (!beginCatchupRun(calendarCatchupDoneRef, currentUser.id)) return;
  const me = currentUser;
  (async () => {
    try {
      const rows = await window.electronAPI?.calendarNotificationsCatchup?.();
      if (!rows?.length) return;
      const { buildCalendarNotificationText } = await import('@/shared/calendarNotifications');
      const { useCalendarStore } = await import('@/stores/useCalendarStore');
      const muted = useCalendarStore.getState().mutedCalendarIds;
      const store = useNotificationStore.getState();
      let shown = 0;
      for (const r of orderCatchupRowsForPrepend(rows)) {
        if (r.calendarId && muted.includes(r.calendarId)) continue; // 뮤트 — 표시단 필터 (행은 DB 에 쌓임)
        const text = buildCalendarNotificationText({
          actorName: r.actorName ?? '알 수 없음',
          calendarName: r.calendarName ?? '캘린더',
          eventTitle: r.eventTitle ?? '',
          action: r.action,
          detail: r.detail,
        });
        store.addNotification({
          type: 'calendar',
          title: text.title,
          body: text.body,
          createdAt: r.createdAt,
          metadata: {
            calendarNotificationId: r.id,
            calendarId: r.calendarId ?? undefined,
            eventDate: r.eventDate ?? undefined,
          },
        });
        shown += 1;
      }
      if (shown > 0) console.log('[calendar-catchup] 미읽음 캘린더 알림', shown, '건 복원');
    } catch (err) {
      console.warn('[calendar-catchup] 실패:', err);
      releaseCatchupRunOnError(calendarCatchupDoneRef, me.id);
    }
  })();
}, [currentUser, authReady]);
```

`useCalendarStore` 의 뮤트 상태 실명(`mutedCalendarIds`)은 Step 0-2 확인 결과에 맞춘다(Task 4.3 Step 5 에서 없으면 신설).
- [ ] **Step 7: 검증 + 커밋** — `npm run typecheck` → `npm run test:notifications`(identity/store 회귀) → 통과 후 커밋: `캘린더 알림 캐치업·읽음 처리·클릭 시 해당 날짜 이동 연결`.

---

### Task 4.3: Realtime 구독 4테이블 + 수신 라우팅 + App.tsx 분기 수정 + 알림 뮤트

**Files:**
- Modify: `electron/realtime.ts` (calendars / calendar_members / calendar_events / calendar_notifications 구독)
- Modify: `electron/main.ts` (콜백 배선 + 300ms 디바운스 + 전 윈도우 전파)
- Modify: `src/App.tsx` (data-change 제외 분기, calendar-changed 수신부 재작성, calendar-notification 수신)
- Modify: `src/stores/useCalendarStore.ts` (뮤트 상태 — 없으면 신설)
- Modify: `src/components/calendar/CalendarRail.tsx` (⋯ 메뉴 '이 캘린더 알림 끄기' 배선)
- Test: `npm run test:calendar` + 프리뷰 실기

- [ ] **Step 1: realtime.ts 구독 추가** — `RealtimeCallbacks` 에 옵셔널 콜백 2개 추가 후, `createChannel` 의 presence 구독 직전에 postgres_changes 4건 추가:

```ts
// RealtimeCallbacks 에 추가
onCalendarTableChange?: (table: string, payload: ChangePayload) => void;
onCalendarNotificationInsert?: (payload: ChangePayload) => void;
```

```ts
// createChannel 내부, presence 구독 직전
// PR4: 공유 캘린더 — 구조/일정 변경은 재조회 신호, 알림은 INSERT 만 수신
for (const table of ['calendars', 'calendar_members', 'calendar_events']) {
  built.on(
    'postgres_changes',
    { event: '*', schema: 'public', table },
    (payload) => {
      console.log(`[Realtime] ${table} 이벤트 수신:`, payload.eventType);
      callbacks.onCalendarTableChange?.(table, payload);
    },
  );
}
built.on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'calendar_notifications' },
  (payload) => callbacks.onCalendarNotificationInsert?.(payload),
);
```

전제: 마이그레이션(PR2)에서 4테이블이 `supabase_realtime` publication 에 추가됨 — `grep -n "ALTER PUBLICATION" DEVLOG/migrations/2026-08-24-shared-calendars.sql` 로 확인, 누락 시 이번 cleanup SQL(Task 4.4)에 함께 넣고 라이브 적용 항목에 기재.
- [ ] **Step 2: main.ts 배선** — `startSupabaseRealtime` 의 `setupRealtimeSubscription({...})` 에 콜백 2개 추가 + 파일 상단 근처에 디바운스 헬퍼. 렌더러 전파는 기존 `supabase:broadcast-event` 채널을 재사용해 App.tsx 의 `calendar-changed` 수신부 하나로 수렴시킨다(브로드캐스트 경로와 realtime 경로가 같은 수신부를 탐).

```ts
// 캘린더 테이블 realtime → 렌더러 재조회 신호 (300ms 디바운스 — 연속 변경 묶음)
let calendarRealtimeRefreshTimer: NodeJS.Timeout | null = null;
function scheduleCalendarRealtimeRefresh(table: string) {
  if (calendarRealtimeRefreshTimer) clearTimeout(calendarRealtimeRefreshTimer);
  calendarRealtimeRefreshTimer = setTimeout(() => {
    calendarRealtimeRefreshTimer = null;
    const event = { event: 'calendar-changed', payload: { action: 'realtime', table, ts: Date.now() } };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('supabase:broadcast-event', event);
    }
    for (const win of widgetWindows.values()) {
      if (!win.isDestroyed()) win.webContents.send('supabase:broadcast-event', event);
    }
  }, 300);
}
```

```ts
// setupRealtimeSubscription 콜백에 추가
onCalendarTableChange: (table) => scheduleCalendarRealtimeRefresh(table),
onCalendarNotificationInsert: (payload) => {
  const row = payload.new as Record<string, unknown> | undefined;
  if (!row) return;
  const event = { event: 'calendar-notification', payload: { notification: mapCalendarNotificationRow(row) } };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('supabase:broadcast-event', event);
  }
  for (const win of widgetWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send('supabase:broadcast-event', event);
  }
},
```

`mapCalendarNotificationRow` 는 Task 4.2 Step 1 의 함수를 calendarIpc.ts 에서 export 해 재사용(중복 정의 금지).
- [ ] **Step 3: App.tsx data-change 제외 분기** — `grep -n "data-change" src/App.tsx` 로 현재 위치 확인(조사 시점 2458-2480). `changedTable === 'users'` 분기 다음에 추가:

```ts
// PR4: 캘린더 계열은 전용 경로(calendar-changed / calendar-notification)로 반영 — 전체 리로드 제외.
// private_calendar_events 는 신구 버전 공존 창 동안 구버전 "나만 보기" 쓰기가
// 신버전 전체 리로드를 유발하지 않게 함께 제외 (설계서 §7).
if (changedTable && (changedTable.startsWith('calendar') || changedTable === 'private_calendar_events')) {
  return;
}
```

- [ ] **Step 4: calendar-changed 수신부 재작성** — `grep -n "calendar-changed" src/App.tsx` 로 위치 확인(조사 시점 2584-2595). 기존 "인증 시에만 syncIncremental" 을 아래로 교체 — 구글 미연동자에게 공유 변경이 미반영되던 버그 겸 해결(broadcast.ts:241-242 주석 불일치 해소):

```ts
if (data.event === 'calendar-changed') {
  // B flow 캘린더 재조회 — 구글 연동 여부와 무관하게 항상
  import('@/services/calendarService').then(({ loadBflowEvents }) => {
    loadBflowEvents().catch((err) => console.warn('[Broadcast] B flow 캘린더 재조회 실패:', err));
  });
  // 구글 레이어 — 인증된 경우에만 incremental
  import('@/services/googleCalendarService').then(({ isAuthenticated }) => {
    isAuthenticated().then((authed) => {
      if (!authed) return;
      import('@/services/calendarService').then(({ syncIncremental }) => {
        syncIncremental().catch((err) => console.warn('[Broadcast] 캘린더 incremental sync 실패:', err));
      });
    });
  });
}
```

`electron/broadcast.ts` 의 `broadcastCalendarChanged` 주석("다른 기기 비공개 CRUD 도 실시간 반영된다")도 현실에 맞게 갱신: "수신측은 B flow 재조회(항상) + 구글 incremental(인증 시)".
- [ ] **Step 5: calendar-notification 수신 push** — App.tsx 의 `onSupabaseBroadcast` 알림 수신 effect(`grep -n "scene-assignment-notification" src/App.tsx`, 조사 시점 1959) 에 분기 추가:

```ts
if (e?.event === 'calendar-notification') {
  const row = (e.payload as { notification?: CalendarNotificationPushRow } | undefined)?.notification;
  const me = useAuthStore.getState().currentUser;
  if (!row || !me?.id) return;
  if (row.recipientId !== me.id) return;   // 수신자 필터 — 클라이언트에서 (설계서 §7)
  if (row.actorId === me.id) return;       // 이중 방어 — 서버가 본인 제외해도 안전망
  const muted = useCalendarStore.getState().mutedCalendarIds;
  if (row.calendarId && muted.includes(row.calendarId)) return; // 뮤트 — 표시단 필터
  const text = buildCalendarNotificationText({
    actorName: row.actorName ?? '알 수 없음',
    calendarName: row.calendarName ?? '캘린더',
    eventTitle: row.eventTitle ?? '',
    action: row.action,
    detail: row.detail,
  });
  dispatchNotification({
    type: 'calendar',
    title: text.title,
    body: text.body,
    metadata: {
      calendarNotificationId: row.id,
      calendarId: row.calendarId ?? undefined,
      eventDate: row.eventDate ?? undefined,
    },
  }, notiSettingsRef.current);
  return;
}
```

`CalendarNotificationPushRow` 타입은 mapCalendarNotificationRow 반환 형과 동일하게 App.tsx 로컬(또는 `src/shared/calendarNotifications.ts`)에 정의. `buildCalendarNotificationText`·`useCalendarStore` 는 파일 상단 정적 import (이 effect 는 고빈도가 아니라 dynamic import 불필요).
- [ ] **Step 6: 뮤트 상태 + 레일 메뉴 배선** — Step 0-2 에서 `mutedCalendarIds` 부재로 확인됐으면 `src/stores/useCalendarStore.ts` 에 추가(기존 켬/끔 토글과 같은 localStorage persist 방식을 따름):

```ts
mutedCalendarIds: string[];
toggleCalendarMuted: (calendarId: string) =>
  set((s) => ({
    mutedCalendarIds: s.mutedCalendarIds.includes(calendarId)
      ? s.mutedCalendarIds.filter((id) => id !== calendarId)
      : [...s.mutedCalendarIds, calendarId],
  })),
```

`src/components/calendar/CalendarRail.tsx` 의 ⋯ 메뉴(M6 시안, PR3 산출물)에서 '이 캘린더 알림 끄기' 항목을 `toggleCalendarMuted(cal.id)` 에 연결. 필수 요소: 뮤트 상태면 라벨 '알림 켜기' + lucide `BellOff` 아이콘 표시, 뮤트 여부와 무관하게 캘린더 표시 켬/끔에는 영향 없음.
- [ ] **Step 7: 검증 + 커밋** — `npm run typecheck` → `npm run test:calendar` → `npm run build:vite`. 프리뷰(`?preview=1`)에서 Task 4.5 mock 완성 전이므로 콘솔 에러 없음만 확인. 커밋: `캘린더 4테이블 실시간 구독 + 수신 라우팅 + 전체 리로드 제외 + 캘린더별 알림 끄기`.

---

### Task 4.4: teamCalendarId 완전 제거 + 잔재 정리 + cleanup 마이그레이션

**Files:**
- Modify: `src/services/calendarService.ts`
- Modify: `src/components/settings/SheetsSection.tsx`
- Modify: `src/types/calendar.ts`
- Create: `DEVLOG/migrations/2026-08-24-shared-calendars-cleanup.sql`
- Test: `npm run typecheck` + grep 소탕 확인

- [ ] **Step 1: 현재 참조 전수 조사** — `grep -rn "teamCalendarId\|saveTeamCalendarId\|cachedTeamCalendarId" src electron tests` 실행, 결과 목록을 기준으로 아래를 진행(조사 시점 기준: calendarService.ts 10여 곳 + SheetsSection.tsx 5곳 + types/calendar.ts 1곳).
- [ ] **Step 2: calendarService.ts 정리** —
  - `saveTeamCalendarId` 함수 삭제, `cachedTeamCalendarId` 변수 삭제.
  - `migrateOldSettings`: `parsed.teamCalendarId` → metadata 쓰기 블록 삭제(personalCalendarId/lastSyncAt 이관만 유지).
  - `getGCalSettings`: metadata 조회 블록 삭제, 반환에서 `teamCalendarId` 제거.
  - `saveGCalSettings`: teamCalendarId 비교·writeMetadata 블록 삭제.
  - `syncAll`·`syncIncremental`: `if (settings.teamCalendarId) calIds.add(...)` 줄 삭제 — calIds 는 `personalCalendarId || 'primary'` 단일.
  - 정리 후 `readMetadata`/`writeMetadata` import 가 이 파일에서 미사용이 되면 import 도 제거(`grep -n "readMetadata\|writeMetadata" src/services/calendarService.ts` 로 확인).
- [ ] **Step 3: 도달 불가 분기·구주석 정정** — `grep -n "isPrivate ? 'private'" src/services/calendarService.ts` (조사 시점 :434). PR2 개편 후에도 남아 있으면 GCal insert 의 `visibility: event.isPrivate ? 'private' : undefined` 줄 삭제(isPrivate 는 GCal 분기 진입 전에 이미 개인 캘린더 경로로 빠짐 — 도달 불가). `src/types/calendar.ts` 의 `isPrivate` 필드 주석("Google Calendar 에 visibility:'private' 로 저장…")을 실제 동작으로 정정: "레거시 호환 — true 면 B flow 개인 캘린더 경로. 신규 코드는 calendarId 를 사용". 필드 자체는 참조가 남아 있으면 유지(`grep -rn "isPrivate" src | grep -v test` 로 판단).
- [ ] **Step 4: SheetsSection.tsx 정리** —
  - import 에서 `saveTeamCalendarId` 제거.
  - `gcalSettings` state 초기값에서 `teamCalendarId: null` 제거.
  - `void calendars; void handleCalendarSelect;` 잔재와 `handleCalendarSelect` 함수 전체, `calendars` state(+ `setCalendars`, `gcalListCalendars` 채우는 코드) 삭제 — 단 `setCalendars([])` 를 부수 정리로 쓰는 signOut 경로가 있으므로 함께 정리(`grep -n "setCalendars\|calendars" src/components/settings/SheetsSection.tsx` 전수 확인).
- [ ] **Step 5: GCalSettings 타입 축소** — `src/types/calendar.ts` 의 `GCalSettings` 에서 `teamCalendarId` 필드 삭제(남는 필드: personalCalendarId, lastSyncAt). `npm run typecheck` 로 누락 참조를 컴파일러가 전부 잡게 한다. 기대: teamCalendarId 관련 오류 0건이 될 때까지 수정.
- [ ] **Step 6: cleanup 마이그레이션 작성** — `DEVLOG/migrations/2026-08-24-shared-calendars-cleanup.sql` 생성:

```sql
-- 2026-08-24 공유 캘린더 라운드 마감 정리 (PR4)
-- 구글 팀 캘린더(teamCalendarId) 잔재 제거 — 팀 공유는 B flow 캘린더가 담당 (설계서 §9).
-- 구버전 앱은 이 행이 없으면 primary 만 동기화하므로 삭제해도 안전.
DELETE FROM metadata WHERE type = 'gcal' AND key = 'teamCalendarId';
```

(Task 4.3 Step 1 에서 publication 누락이 확인된 경우 `ALTER PUBLICATION supabase_realtime ADD TABLE ...` 도 이 파일에 추가.) 라이브 적용은 PR 머지 후 배포 시점에 한솔 확인 받고 실행 — PR 본문 체크리스트에 명시.
- [ ] **Step 7: 소탕 확인 + 커밋** — `grep -rn "teamCalendarId" src electron tests` → 기대: 0건 (DEVLOG 문서·마이그레이션 SQL 제외). `grep -rn "getTargetCalendar" src` → PR1/PR2 에서 정리됐는지 확인, 남았으면 함께 제거. `npm run typecheck` 통과 후 커밋: `구글 팀 캘린더(teamCalendarId) 잔재 완전 제거 + metadata 정리 SQL`.

---

### Task 4.5: 프리뷰 mock — 알림 seed 2건 + 실시간 mock 이벤트 헬퍼

**Files:**
- Modify: `src/mocks/devElectronAPI.ts`
- Test: 프리뷰 실기 (`http://localhost:5190/?preview=1`)

- [ ] **Step 1: 알림 mock seed** — `devElectronAPI.ts` 에 PR3 캘린더 seed(캘린더 4개/일정 15개) 근처에 추가. 날짜는 하드코딩하지 말고 현재 월 기준 동적 생성(기존 seed 의 날짜 생성 방식을 따름):

```ts
// PR4: 캘린더 알림 mock — catchup seed 2건 (미읽음)
const mockCalendarNotifications = [
  {
    id: 'mock-caln-1',
    recipientId: MOCK_ME_ID, // mock 로그인 사용자(배한솔) id — 파일 내 기존 상수 재사용
    actorId: 'mock-user-2',
    actorName: '김코비',
    calendarId: 'mock-cal-milestone', // PR3 seed 의 'EP 마일스톤' 캘린더 id 와 일치시킬 것
    calendarName: 'EP 마일스톤',
    eventId: 'mock-cal-ev-1',
    eventTitle: 'EP12 업로드',
    eventDate: fmtMockDate(25),       // 이번 달 25일 YYYY-MM-DD
    action: 'create' as const,
    detail: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-caln-2',
    recipientId: MOCK_ME_ID,
    actorId: 'mock-user-3',
    actorName: '박리깅',
    calendarId: 'mock-cal-milestone',
    calendarName: 'EP 마일스톤',
    eventId: 'mock-cal-ev-2',
    eventTitle: '가편 리뷰',
    eventDate: fmtMockDate(26),
    action: 'update' as const,
    detail: `${new Date().getMonth() + 1}/25 → ${new Date().getMonth() + 1}/26`,
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
];
```

  API mock 은 `calendarNotificationsCatchup: async () => mockCalendarNotifications,` / `calendarNotificationsMarkRead: async () => {},`. `MOCK_ME_ID`·캘린더 id·`fmtMockDate` 는 파일 내 실존 상수/헬퍼명으로 맞춘다(`grep -n "배한솔\|mock-cal" src/mocks/devElectronAPI.ts`).
- [ ] **Step 2: 실시간 mock 이벤트 헬퍼** — 현재 `onSupabaseBroadcast: noop` 을 리스너 집합으로 교체하고 콘솔 헬퍼 노출:

```ts
const supabaseBroadcastListeners = new Set<(event: unknown) => void>();
// ...
onSupabaseBroadcast: (callback: (event: unknown) => void) => {
  supabaseBroadcastListeners.add(callback);
  return () => supabaseBroadcastListeners.delete(callback);
},
```

```ts
// 프리뷰 전용: 콘솔에서 window.__bflowMockCalendarNotify() 실행 →
// 실시간 캘린더 알림 수신 경로(App.tsx calendar-notification 분기)를 시뮬레이션.
(window as unknown as Record<string, unknown>).__bflowMockCalendarNotify = (
  overrides: Record<string, unknown> = {},
) => {
  const row = {
    ...mockCalendarNotifications[0],
    id: `mock-caln-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  for (const cb of supabaseBroadcastListeners) {
    cb({ event: 'calendar-notification', payload: { notification: row } });
  }
};
```

  주의: `onSupabaseBroadcast` 를 교체하면 기존 noop 반환값(undefined) 대신 cleanup 함수를 반환하게 됨 — App.tsx 구독부가 반환값을 cleanup 으로 쓰는지 확인(`grep -n "onSupabaseBroadcast" src/App.tsx`), 정상.
- [ ] **Step 3: 프리뷰 실기 확인** — `npm run dev:renderer` → `http://localhost:5190/?preview=1` → mock 로그인 `배한솔`/`1234`. 확인 항목: ① 종 아이콘 배지에 미읽음 2건 + '일정' 라벨 알림 2개(문구: "김코비 님이 [EP 마일스톤] 에 일정을 추가했어요") ② 두 번째 알림 body 에 'M/25 → M/26' ③ 알림 클릭 → 캘린더(schedule) 뷰 전환 + 해당 날짜 펄스 이동 ④ DevTools 콘솔 `window.__bflowMockCalendarNotify()` → 알림 실시간 추가 ⑤ 레일 ⋯ 메뉴에서 'EP 마일스톤' 알림 끄기 후 재호출 → 알림이 추가되지 않음 ⑥ 알림 끄기 상태에서 캘린더 일정 표시는 유지.
- [ ] **Step 4: 커밋** — `프리뷰 mock 캘린더 알림 seed 2건 + 실시간 수신 시뮬레이션 헬퍼 추가`.

---

### Task 4.6: 문서 마감 (ROADMAP / CLAUDE.md / lessons)

**Files:**
- Modify: `ROADMAP.md`
- Modify: `CLAUDE.md`
- Modify: `tasks/lessons.md`

- [ ] **Step 1: ROADMAP.md 갱신** — ① Phase 4-2(`grep -n "월간/주간 캘린더" ROADMAP.md`) 미체크 항목 아래에 완료 항목 추가: `- [x] **공유 캘린더 (PM 일정관리)**: 팀 전체/특정 팀원/개인 캘린더 + 태그 필터 + 시간 단위 일정 + 앱 내 알림 (2026-08 라운드, 설계서 docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md)`. ② 구현 현황 표(`grep -n "캘린더 서비스" ROADMAP.md`, 조사 시점 1179-1183)의 stale 수치(calendarService 81줄 / ScheduleView 57KB / CalendarWidget 358줄)를 PR4 시점 실측(`wc -l src/services/calendarService.ts src/views/ScheduleView.tsx src/components/widgets/CalendarWidget.tsx`)으로 정정하고 "공유 캘린더: Supabase 5테이블 + IPC 권한 강제" 행 추가.
- [ ] **Step 2: CLAUDE.md 아키텍처 한 줄** — "## 경로" 아래 **데이터** 단락의 `씬/에피소드/체크박스/메모/개인일정 → Supabase (PostgreSQL)` 를 다음으로 갱신: `씬/에피소드/체크박스/메모/캘린더(공유·개인 일정/태그/알림) → Supabase (PostgreSQL, 캘린더는 렌더러 → IPC → 메인에서 권한 강제)`.
- [ ] **Step 3: lessons.md 교훈 기록** — `tasks/lessons.md` 말미에 이번 라운드 항목 추가. 최소 다음 2건을 기본으로 쓰되, 실제 이 세션에서 수정 지적을 받았으면 그 내용으로 대체/보강한다:
  - "전체 리로드 분기가 있는 앱에 새 테이블을 추가할 때는 data-change 제외 목록을 같은 PR 에서 갱신한다 — 안 하면 일정 하나 저장에 앱 전체 reload." (App.tsx data-change / calendar% 제외)
  - "브로드캐스트 수신부가 특정 소스만 재조회하는 구조에 소스를 추가할 때는 송신 주석이 아니라 수신부 코드를 기준으로 검증한다 — broadcast.ts 주석과 App.tsx 실동작 불일치가 비공개 일정 미반영 버그로 2026-08 까지 잠복." 
- [ ] **Step 4: 커밋** — `캘린더 라운드 문서 마감 (ROADMAP 수치 정정 + CLAUDE.md 데이터 경로 + lessons)`.

---

### Task 4.7: 마무리 — 검증 게이트 + update-notes + 버전 + PR + 코덱스 리뷰

**Files:**
- Modify: `DEVLOG/update-notes.json`
- Modify: `package.json`, `package-lock.json` (버전)

절차와 게이트는 chunk0 §0.3 을 따른다(중복 서술 생략). 이 Task 고유 사항만 기술:

- [ ] **Step 1: 검증 게이트 실행** — 순서대로: `npm run typecheck` → `npm run test:calendar` → `npm run test:notifications` → `npm run build:vite`. 기대: 전부 통과. 실패 시 완료 표시 금지, 원인 수정 후 재실행.
- [ ] **Step 2: 프리뷰 실기 시나리오** — Task 4.5 Step 3 의 6개 항목 재확인 + 추가: ⑦ 구글 미연동 mock 상태에서 캘린더 뷰에 B flow 일정(seed)이 보이는지 — "내 구글" 행은 회색 점 + 연동 안내(연동 안내 문구는 M6 우측의 미연동 상태 화면 기준, 레일의 회색 점 요소는 M1 레일에도 있음 — 'M6 우측/M1 레일'). ⑧ 알림 '모두 읽음' 클릭 → 새로고침(재로그인) 후 캐치업이 같은 알림을 다시 쌓지 않는지(mark-read mock 은 no-op 이지만 identity dedupe 로 중복 방지되는지 확인).
- [ ] **Step 3: 실기(Electron) 실시간 시나리오** — 가능한 환경에서 `npm run electron:dev` 로 본체 실행 + 캘린더 위젯 팝업(또는 두 번째 계정 창): ① A 창에서 공유 캘린더에 일정 생성 → B 창 캘린더에 수 초 내 반영(전체 화면 reload 없이 — DevTools 콘솔에 `[Broadcast] 구조 변경 감지 → reload` 가 찍히지 않아야 함) ② B 계정에 종 알림 도착, 클릭 → 해당 날짜 이동 ③ 일정 날짜 변경 → 알림 detail 에 'M/D → M/D' ④ 알림 끈 캘린더의 변경은 알림 미표시(일정 반영은 됨). 두 계정 실기가 불가한 환경이면 이 항목을 PR 본문 테스트 가이드에 "배포 전 확인 필요" 로 명시.
- [ ] **Step 4: update-notes.json 항목 추가** — 배열 맨 앞에 추가(비개발자 톤 — 기술 용어·식별자·파일경로 금지):

```json
{
  "version": "<산정 버전>",
  "title": "함께 쓰는 캘린더 마무리 — 알림과 실시간 반영",
  "items": [
    {
      "category": "feature",
      "summary": "내가 볼 수 있는 캘린더에 일정이 생기면 종 알림이 와요",
      "description": "누가 공유 캘린더에 일정을 추가하거나 날짜를 바꿔도 직접 달력을 열어보기 전엔 알 수 없었어요. 이제 일정이 추가·변경·삭제되면 종 모양 알림으로 알려주고, 알림을 누르면 그 날짜로 바로 이동해요. 날짜가 바뀐 경우엔 며칠에서 며칠로 옮겨졌는지도 함께 보여줘요."
    },
    {
      "category": "feature",
      "summary": "다른 사람이 바꾼 일정이 내 화면에 바로 반영돼요",
      "description": "예전엔 다른 팀원이 일정을 바꿔도 내 화면에는 한참 뒤에 보이거나 앱을 다시 켜야 했어요. 이제 누가 일정을 만들거나 고치면 몇 초 안에 내 캘린더에도 그대로 나타나요. 앱을 끄고 있던 동안 온 알림도 다시 켜면 놓치지 않고 모아서 보여줘요."
    },
    {
      "category": "ux",
      "summary": "시끄러운 캘린더는 알림만 끌 수 있어요",
      "description": "일정이 자주 바뀌는 캘린더 때문에 알림이 쌓이는 게 부담될 수 있어요. 캘린더 목록에서 원하는 캘린더의 알림만 끄면, 일정은 그대로 보이면서 알림만 조용해져요."
    }
  ]
}
```

- [ ] **Step 5: 버전 산정** — chunk0 §0.3 버전 규칙: PR 생성 직전 `git fetch origin && git show origin/main:package.json | grep '"version"'` 로 기준 확인(PR1~3 이 각각 마이너 +1 했으므로 예: 1.105.0 이면 이번은 1.106.0). `package.json` + `package-lock.json` 2곳(최상단 `version` + `packages[""].version`) 3자 일치 확인: `grep -n '"version"' package.json package-lock.json | head -3`. update-notes 의 `<산정 버전>` 도 동일 값으로 치환. 커밋: `v<버전> 캘린더 알림·실시간 마감 버전 및 업데이트 노트`.
- [ ] **Step 6: PR 생성** — `pr-creator` 스킬 사용(chunk0 §0.3). PR 본문에 반드시 포함: ① "📋 업데이트 요약" 은 Step 4 문구 재사용(비개발자 톤) ② 배포 전 라이브 SQL 적용 체크리스트: `DEVLOG/migrations/2026-08-24-shared-calendars-cleanup.sql` (metadata teamCalendarId 정리 — 한솔 확인 후) ③ 테스트 가이드에 Step 3 실시간 시나리오 ④ **다음 라운드 잔여물 명시**: "전 팀원이 새 버전으로 업데이트된 뒤, 공존 창 동안 구버전이 `private_calendar_events` 에 새로 쓴 델타 행을 `calendar_events` 로 재이관하고 나서 `private_calendar_events` 를 DROP (설계서 §12)" ⑤ **설계 편차 명시(코덱스 리뷰 대응)**: 렌더러 이벤트 채널을 설계서 §7 의 `bflow:calendar-changed` 예시 대신 기존 `supabase:broadcast-event` 경로의 `calendar-changed`/`calendar-notification` 으로 수렴시킨 것은 기존 수신부 재사용을 위한 의도된 편차임을 PR 본문에 한 줄로 명시.
- [ ] **Step 7: 코덱스 리뷰 루프** — `codex-review-loop` 스킬로 PR 리뷰 트리거·P1/P2/P3 반영·명시 완료 신호까지 반복(chunk0 §0.3). 머지·G드라이브 배포·슬랙 공지는 한솔 명시 지시 시에만.
