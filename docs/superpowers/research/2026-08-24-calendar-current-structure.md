# B flow 캘린더 현재 구조 분석 (PM 일정관리 개편 사전조사)

> 작성: 2026-08-24, main=93f2c9d 기준. 7개 차원 병렬 탐색(뷰/데이터/컴포넌트/통합점/구글연동/사용자·공유모델/이력문서) 후 통합.
> 용도: 캘린더 개편 브레인스토밍·설계서·작업계획의 근거 문서. 읽기 전용 조사 결과이며 코드 변경은 없음.

## 1. 구조 지도
## B flow 캘린더 서브시스템 구조 지도 (2026-08-24, main=93f2c9d 기준, 전부 파일 열어 확인)

### 0. 한눈에 보기 (비개발자용 요약)
- 사이드바에는 "타임라인 / 캘린더 / 휴가" 세 탭이 있고, 코드 이름은 각각 `'calendar'`(=타임라인!) / `'schedule'`(=캘린더!) / `'vacation'` 으로 **이름이 뒤바뀌어** 있다 (`src/components/layout/Sidebar.tsx:46-48`, `src/App.tsx:2812-2817`, `src/stores/useAppStore.ts:21-35`).
- 실제 "일정 만들고 고치는 캘린더"는 `ScheduleView` 하나다. 일정은 **세 군데에 따로 저장**된다: ① 공개 일정 → 로그인한 사람의 **Google Calendar `primary`** ② "나만 보기" 일정 → Supabase `private_calendar_events` ③ 휴가 → 구글 스프레드시트(Apps Script 웹앱)에서 읽기만.
- 팀원끼리 같은 일정을 보는 장치는 앱 안에 **없다**. 각자 자기 Google 캘린더에 쓰고 자기 것만 읽으므로, 동료 일정이 보이려면 Google 쪽 공유 설정에 의존한다 (`src/services/calendarService.ts:206-208`, `258-265`).
- Google 을 연동하지 않은 사람은 캘린더 첫 로드가 아예 건너뛰어져(비공개 일정조차) 빈 달력(+휴가)만 본다 (`src/views/ScheduleView.tsx:1253-1256`, `src/components/widgets/CalendarWidget.tsx:110-113`).

### 1. 뷰 계층 (Views)
| ViewMode id | 사이드바 라벨 | 파일 | 줄수 | 역할 |
|---|---|---|---|---|
| `'calendar'` | 타임라인 (`GanttChart` 아이콘) | `src/views/CalendarView.tsx` | 960 | 에피소드/파트 **진행률** 바(timeline, 날짜 축 없음) + 히트맵 + 읽기전용 이벤트 간트(`EventGanttChart` :292, `getEvents()` 마운트 1회 :297, `bflow:calendar-changed` 미구독, 휴가 병합 :305-334) |
| `'schedule'` | 캘린더 (`CalendarDays`) | `src/views/ScheduleView.tsx` | 2111 | 월/2주/주/오늘 4모드 일정 CRUD. 상태 1199-1240, 데이터 로드 1245-1263(**`isAuthenticated` 가드 뒤 `syncAll`** 1253-1256), 휴가 로드 1266-1290, 필터 1301-1307, 할일 역동기화 `syncCalendarToTodo`/`unlinkTodoFromCalendar` 1162-1185, `EventCreateModal` 553-856(“나만 보기” 체크박스 832-839), `CalendarGrid` 862-1085, 키보드 1542-1641, `bflow:navigate-to-date` 수신 1646-1689 |
| `'vacation'` | 휴가 (`Palmtree`) | `src/views/VacationView.tsx` | 1193 | 자체 6주 월 그리드(전원 휴가) + 내 휴가 현황/내역/등록/취소/대휴. `DAHYU_ADMINS=['허혜원','배한솔']` :35,526. calendarService 미사용 |
- 헤더 제목 매핑 `src/components/layout/headerTitle.ts:3-12` 에 `calendar:'타임라인'`, `vacation:'휴가 관리'` 만 있고 **`schedule` 항목 없음**(ScheduleView 가 자체 h1). 백스택 라벨은 `schedule:'일정'` (`src/utils/navigationBackStack.ts:41-42`) — 사이드바 '캘린더' 와 불일치.
- 휴가 탭 숨김: `src/components/layout/navVisibility.ts:12` `VACATION_HIDDEN_NAMES=['강선영']`, `:21-23` `id==='vacation'` 일 때만, `Sidebar.tsx:223` 에서 필터. `UserMenu.tsx:65` '휴가 관리' 버튼과 `ScheduleView.tsx:1465` `setView('vacation')` 은 막지 않음.
- 단축키 `src/hooks/useGlobalShortcuts.ts:21-23,38-40`: Ctrl+6→`'calendar'`, Ctrl+7→`'schedule'`, Ctrl+8→`'vacation'`.
- 진입 경로: `CalendarWidget.tsx:297`, `SpotlightSearch.tsx:585`, `MyTasksWidget.tsx:518` 모두 `setView('schedule')`; 팝업 창은 `widgetNavigateToDate` IPC → `electron/main.ts:4370-4375` → `App.tsx:2200-2208`.

### 2. 컴포넌트 계층 (`src/components/calendar/*` — 전부 ScheduleView 전용, `ScheduleView.tsx:25-33` import)
| 파일 | 줄 | 역할 |
|---|---|---|
| `MiniCalendar.tsx` | 230 | 월 모드 좌측 미니 달력 (날짜 클릭→생성 모달) |
| `WeekScrollView.tsx` | 554 | 주/2주 모드 본체 + `generateYearWeeks`/`findWeekIndexForDate`/`getISOWeekNumber` export |
| `WeekSidebar.tsx` | 186 | 주 모드 좌측 주차 리스트 |
| `DayScrollView.tsx` | 434 | 오늘 모드(±2일 캐러셀) |
| `DaySidebar.tsx` | 167 | 오늘 모드 좌측 날짜 리스트 |
| `EventSidePanel.tsx` | 488 | 이벤트 클릭 상세/편집(제목·날짜·메모·나만보기), 휴가/읽기전용이면 편집 불가 (:148) |
| `EventQuickEdit.tsx` | 291 | 우클릭 팝오버(색 10종·복제·삭제 / 제목·날짜·유형·메모) |
| `EventCreateTooltip.tsx` | 387 | **미사용(dead)** — import 0건, `ScheduleView.tsx:26` 주석만 |
- 대시보드 위젯 `src/components/widgets/CalendarWidget.tsx`(879줄): 위 컴포넌트를 전혀 재사용하지 않고 월/2주/주/일을 **자체 구현**, 읽기 전용(생성·편집·클릭 상세 없음), `IsPopupContext` 미사용이라 팝업 창에서 '전체' 버튼(:297 `setView('schedule')`) 무동작. `WidgetPopup.tsx:83` `WIDGET_REGISTRY['calendar']` 로 팝업 가능.
- 휴가 연동 UI: `VacationRegisterModal`, `VacationDeleteListModal`, `VacationWidget.tsx`(160줄), `useVacationPendingStore`.

### 3. 훅 (Hooks)
- `src/hooks/useCalendarDnD.ts`(183): 월 그리드 이벤트 바 이동/리사이즈 (`data-date` 셀 탐지). 사용처 `ScheduleView.tsx:1501` 한 곳.
- `src/hooks/useCalendarDragCreate.ts`(230): 월 그리드 빈 셀 드래그 범위 선택 → 생성 모달. 사용처 `ScheduleView.tsx:1524` 한 곳.
- 주/2주/일 모드에는 DnD·우클릭·드래그 생성 없음(카드 `onClick` 만).

### 4. 서비스 계층 (렌더러)
- `src/services/calendarService.ts`(638): 렌더러 어댑터. 상태는 Zustand 가 아니라 모듈 변수 `eventCache`(:212) + `window` 이벤트 `bflow:calendar-changed`.
  - `PRIVATE_CAL_ID='supabase-private'` :13, `toCalendarEventFromPrivate` :17-37
  - 로컬 설정 `bflow_gcal_local_settings`(localStorage) + `gcalSaveLocalSettings` IPC 미러 :41-62
  - `getGCalSettings()` :89-114 — `teamCalendarId` 는 Supabase `metadata('gcal','teamCalendarId')`, `saveTeamCalendarId` :117-120
  - `toCalendarEvent()` :141-168 — `color` 항상 `'#6C5CE7'`(:152 TODO), `isReadOnly: !meta.bflow_type`(:165), `isPrivate: visibility==='private'`(:168)
  - `getTargetCalendar(_type)` :206-208 — **항상 `'primary'`**
  - `loadLegacyEvents` :216-220 no-op, `loadAllEvents`/`getEvents` :222-230
  - `syncAll()` :233-297 — ① `supabaseReadPrivateEvents(userId)` :243-252 ② calIds = {`teamCalendarId`?, `personalCalendarId||'primary'`} :258-265 ③ `gcalService.fullSync` :269-281 ④ `ensureWatch` :289-293
  - `syncIncremental()` :299-334 — **GCal 만** (비공개 재조회 없음)
  - `resolveEvent` :341-367(`cal_` 폴백 :362-365), `addEvent` :369-449(비공개 분기 :371-408 → Supabase; 공개 :410-448 → GCal `'primary'`), `updateEvent` :450-(공개↔비공개 create-first 이전, `cal_${uuid}` :466), `deleteEvent`, `broadcastCalendarChange`, `findEventByTodoId` :631-638
- `src/services/googleCalendarService.ts`(72): `gcal*` IPC 1:1 래퍼.
- `src/services/vacationService.ts`(109): `vacation*` IPC 래퍼(`fetchAllVacationEvents` 등).
- `src/services/supabaseService.ts`: 캘린더 전용 CRUD **없음**. `readMetadata` :450 / `writeMetadata` :445, `applyCalendarToTodoPatch` :635-637 만 관련. 비공개 이벤트 CRUD 는 calendarService 가 `window.electronAPI.supabase*PrivateEvent` 를 직접 호출(supabaseService 미경유 — CLAUDE.md 규칙 4 와 어긋남).
- 타입 `src/types/calendar.ts`(90): `CalendarEvent` :27-68(`startDate/endDate` YYYY-MM-DD 만, `createdBy` 이름 문자열, `linked*`, `linkedTodoId`, `vacation*`, `isReadOnly`, `sourceCalendarId`, `isPrivate`), `CalendarStore` :71(미사용), `GCalSettings` :74-78, `BflowEventMeta` :81-90.

### 5. IPC / 메인 프로세스
| 채널 | preload | main 핸들러 | 실제 처리 |
|---|---|---|---|
| `supabase:read/add/update/delete-private-event` | `preload.ts:257-265` | `main.ts:2437-2457` — `getSessionUserIdOrThrow` :2423-2428, `assertPrivateEventOwnerOrThrow` :2430-2435 (세션 사용자 강제·소유자 검증) | `electron/supabase.ts:1785-1862` `private_calendar_events` CRUD + `broadcastDataChange('private_calendar_events')` :1817/1842/1849 + `broadcastCalendarChanged` :1818/1843/1850 |
| `gcal:is-authenticated/start-auth/save-credentials/has-credentials/save-local-settings/sign-out/list-calendars/full-sync/incremental-sync/insert-event/update-event/delete-event/ensure-watch` | `preload.ts:523-538` | `main.ts:2966-3026` | `electron/googleCalendar.ts`(501): 하드코딩 팀 OAuth 클라이언트 `DEFAULT_CLIENT_ID/SECRET` :22-23, loopback `127.0.0.1:8089`, `SCOPES=['…/auth/calendar']` :82, `google-tokens.json` safeStorage 암호화, syncToken `gcal-sync-state.json`, watch `WEBHOOK_URL` :90 → Edge Function `supabase/functions/gcal-webhook/index.ts` → Supabase Broadcast `gcal-sync/calendar-changed` |
| `calendar:broadcast-change` → `calendar:changed` | `preload.ts:648-655` | `main.ts:3783` (송신 창 제외 전파) | `App.tsx:2625-2641` / `WidgetPopup.tsx:315-321` 이 `bflow:calendar-changed` 재발행(`upsert`/`delete` 면 `syncAll` 선행) |
| `personal-todo:patch / calendar-patch / retry-calendar` | `preload.ts:340-352` | `main.ts:2859-2898`, 어댑터 `personalTodoCalendarAdapter` :1560-1627(대상 = `gcal-local-settings.json` `personalCalendarId` 또는 primary, `visibility:'private'` :1608,1625) | `electron/personalTodoCalendarSync.ts`(356) 저널·결정적 ID `bf10<sha256>` |
| `vacation:*` (connect/read-all-events/register/cancel/grant-dahyu/…) | `preload.ts:499-521` | `main.ts:3797-3947` | `electron/vacation.ts`(331) GAS 웹앱 HTTP |
| `widget:navigate-to-date` | `preload.ts:574-581` | `main.ts:4370-4375` | 팝업→본체 날짜 점프 |
| `supabase:read/write-metadata` | — | `main.ts:2767-2772` (권한 검증 없음) | `metadata` 테이블 (`teamCalendarId` 저장처) |
- Broadcast 수신: `App.tsx:2584-2595` `calendar-changed` → `isAuthenticated` 일 때만 `syncIncremental`(GCal 만). `App.tsx:2458-2480` `data-change` 는 `users` 외 모든 테이블(→ `private_calendar_events` 포함)을 "구조 변경"으로 보고 300ms 후 `loadData()` **전체 재로드**.
- `electron/realtime.ts`(226): `private_calendar_events`·`users` postgres_changes 미구독.

### 6. DB / 외부 저장소
- Supabase `private_calendar_events` (`DEVLOG/supabase-init.sql:140-159`): `id UUID`, `user_id TEXT NOT NULL`(FK 없음), `title, memo, color, type, start_date TEXT, end_date TEXT, linked_episode, linked_part, linked_sheet_name, linked_scene_id, linked_department, linked_todo_id, created_by, created_at, updated_at`. RLS `allow_all` :255-259. Realtime publication 미포함. 사용자 삭제 RPC `delete_user_cascade` 가 수동 삭제(`DEVLOG/migrations/2026-04-30_delete_user_cascade_rpc.sql:33`).
- Supabase `metadata(type,key,value)` :127-135 — `('gcal','teamCalendarId')`.
- Supabase `users` :114-124 — `id TEXT PK, name, role 'admin'|'user', password 평문, slack_id, hire_date, birthday, is_initial_password` + 이후 `is_compositor`, `is_acting_supervisor`. **부서/팀/그룹 컬럼 없음**.
- 클라이언트는 메인 프로세스에서 **anon key 하드코딩** (`electron/supabase.ts:79-92`), Supabase Auth 미사용, 모든 SQL 에 `auth.uid()` 0건 → DB 권한 경계 없음.
- Google Calendar: 공개 일정 본체. B flow 메타는 `extendedProperties.private.bflow_*` 에만(색상·`linkedSheetName` 은 미전송).
- 휴가: Google Sheets(GAS WebApp) — Supabase 와 조인 불가, 앱에서 `type:'vacation', isReadOnly:true` 로 합성(`ScheduleView.tsx:1271-1285`, `CalendarWidget.tsx:130-144`, `CalendarView.tsx:311-326` 3중복).
- 에피소드/파트/씬 테이블에 **마감일 컬럼 없음**. 유일한 마감일은 `character_costumes.due_date`(캘린더 미표시).

### 7. 데이터 흐름 요약
쓰기: UI → `calendarService.addEvent/updateEvent/deleteEvent`(낙관적 캐시 → IPC → 실패 롤백) → [비공개] `supabase:*-private-event` → Supabase / [공개] `gcal:*` → Google primary.
읽기: `syncAll`(Google 인증 시에만 호출됨) → 비공개(Supabase) + 공개(GCal fullSync) → `eventCache` → `bflow:calendar-changed` → ScheduleView/CalendarWidget `getEvents()`; 휴가는 각 뷰가 `fetchAllVacationEvents` 별도 호출.
타인 변경 전파: 공개=GCal watch → Edge Function → Broadcast → `syncIncremental`; 비공개=Broadcast 는 오지만 수신측이 GCal 만 재조회해 **실질 미반영**(`electron/broadcast.ts:241-242` 주석과 불일치); 같은 PC 다중 창=`calendar:broadcast-change` IPC.

## 2. 기능 목록
| 기능 | 어디서 (파일:줄) | 상태 | 비고 |
|---|---|---|---|
| 월/2주/주/오늘 4모드 캘린더 보기 | `ScheduleView.tsx:1993-2048` (`CalendarGrid`/`WeekScrollView`/`DayScrollView`) | 동작 | 2주/주/오늘은 열람 위주 |
| 날짜 드래그/클릭으로 일정 생성 | `useCalendarDragCreate.ts` + `ScheduleView.tsx:1524-1534` → `EventCreateModal` :553-856 | 동작 | 월 모드 `CalendarGrid` 에서만 (`data-date` 셀) |
| 생성 필드: 제목·시작일·마감일·유형(일반/EP/파트/씬)·EP/파트/씬 연결·색 10종·메모·나만 보기 | `ScheduleView.tsx:689-852` | 동작 | 시간·담당자·반복·알림·장소 없음. 날짜는 `YYYY-MM-DD` 종일만 |
| 이벤트 클릭 → 사이드패널 상세/편집(제목·날짜·메모·나만보기)·삭제·씬/할일/휴가 탭 이동 | `EventSidePanel.tsx` (`ScheduleView.tsx:2077`) | 동작 | 색·유형·연결대상은 여기서 편집 불가 |
| 우클릭 퀵에디트(색·복제·삭제 / 제목·날짜·유형·메모) | `EventQuickEdit.tsx` (`ScheduleView.tsx:2090`) | 동작 | 연결대상 편집 불가, 복제 시 연결 제거 `type:'custom'` |
| 이벤트 바 드래그 이동/리사이즈 | `useCalendarDnD.ts`, `ScheduleView.tsx:1501` | 동작 | 월 모드만, `isReadOnly` 차단 |
| 타입 필터(전체/일반/EP/파트/씬/휴가)·부서 필터·휴가 토글 | `ScheduleView.tsx:1301-1307`, 헤더 1883-1932 | 동작 | 사람(담당자) 필터 없음 |
| 키보드 이동(월: 화살표/Enter, 주·일: 화살표, Esc) | `ScheduleView.tsx:1542-1641` | 동작 | |
| "나만 보기" 비공개 일정 (Supabase, 본인 전용) | `calendarService.ts:371-408`, `main.ts:2437-2457`, `private_calendar_events` | 동작 | 메인에서 세션 사용자 강제. 타 기기 실시간 반영 없음. Google 미연동이면 재시작 후 초기 로드 안 됨 |
| 공개 일정 (Google primary 저장, `bflow_*` 메타) | `calendarService.ts:410-448`, `electron/googleCalendar.ts` | 동작(연동자만) | 색상 왕복 유실(:152), 팀원 간 공유는 Google 측 설정 의존 |
| Google OAuth 연결/해제/자격증명/지금 동기화 | `SheetsSection.tsx:349-476` (설정>연동) | 동작 | 팀/개인 캘린더 선택 핸들러는 `void` 처리 (:243-244) |
| 연동 상태 표시(사이드바 점·설정 개요) | `Sidebar.tsx:34-37,229`, `IntegrationOverview.tsx:44-45` | 동작 | |
| 실시간: GCal watch → Edge Function → Broadcast → `syncIncremental` | `googleCalendar.ts:450-489`, `gcal-webhook/index.ts`, `App.tsx:2584-2595` | 동작(배포 상태 미확인) | 비공개 이벤트는 미반영 |
| 같은 PC 다중 창 동기화 | `calendar:broadcast-change` `main.ts:3783`, `App.tsx:2625-2641`, `WidgetPopup.tsx:315-321` | 동작 | |
| 개인 할일 ↔ 캘린더 양방향 | `MyTasksWidget.tsx:102-114`, `TodoDetailModal.tsx:68-70`, `electron/personalTodoCalendarSync.ts`, `ScheduleView.tsx:1162-1185` | 동작 | Google 인증 전제(`main.ts:1560-1627`). 할일 목록 행에는 날짜 배지 없음 |
| 할일→캘린더 날짜 점프 / 캘린더→할일 점프 | `MyTasksWidget.tsx:511-525`, `ScheduleView.tsx:1646-1689`, `EventSidePanel.tsx:455-469` | 동작 | 팝업은 `widget:navigate-to-date` IPC |
| 휴가 오버레이(읽기전용) | `ScheduleView.tsx:1266-1290`, `CalendarWidget.tsx:126-163`, `CalendarView.tsx:305-334` | 동작(`vacationConnected` 시) | 3중복 매핑, 이동은 `setView('vacation')` |
| 휴가 탭: 전원 휴가 월 그리드·내 현황·등록·취소·대휴(관리자) | `VacationView.tsx` | 동작 | 2026-03-02 이후 동결, `DAHYU_ADMINS` 하드코딩, 특정 사용자 사이드바 숨김 |
| 대시보드 캘린더 위젯(읽기 전용, 팝업 가능) | `CalendarWidget.tsx` | 동작 | ScheduleView 와 코드 공유 없음, 팝업에서 '전체' 무동작 |
| 타임라인 탭: 진행률 바/히트맵 | `CalendarView.tsx:86-271` | 동작 | 날짜 축 없음(일정 도구 아님) |
| 타임라인 탭: 이벤트/휴가 간트(읽기전용) | `CalendarView.tsx:292-778` | 동작(캐시 의존) | 범위 지난달~다다음달 고정, `bflow:calendar-changed` 미구독 → 다른 경로로 캐시 채워지기 전엔 비어 보임 |
| 스포트라이트 일정 검색 | `SpotlightSearch.tsx:567-590` | 동작 | 뷰 전환만, 날짜 이동 없음, 마운트 1회 로드 |
| 단축키 Ctrl+6/7/8 | `useGlobalShortcuts.ts:21-23,38-40` | 동작 | |
| 팀 캘린더(`teamCalendarId`) 읽기 | `calendarService.ts:94-102,258-265` | 반쪽 | 읽기만, 쓰기 항상 primary, 설정 UI 없음 |
| 미리보기(dev) 모드 캘린더 | `src/mocks/devElectronAPI.ts:887,1083-1084,1389,1396` | 빈 달력 | gcal/vacation/private 모두 빈 mock, `supabaseAddPrivateEvent` id 고정 `'mock-private'` |
| 일정 알림/슬랙/리마인더 | — | 없음 | `slackWebhookService.ts`·`useNotificationStore` 에 캘린더 코드 0건 |
| 캘린더 단위 테스트 | `tests/calendarIntegrationStatus.test.ts`(문자열 검사, npm 스크립트 미연결), `tests/personalTodo*`(할일 경계만) | 거의 없음 | ScheduleView/DnD/날짜 계산/calendarService 테스트 0건 |

## 3. 중복·레거시·죽은 코드
## 판정 기준
"죽은 코드" = import/렌더/호출이 0건임을 grep 으로 확인한 것. "잔재" = 호출은 되지만 분기가 고정되어 의미 없는 것. "중복" = 같은 로직이 복수 파일에 로컬 복제된 것. (읽기 전용 조사라 제거하지 않음.)

## A. 제거 권고 1순위 — 확실한 dead (삭제해도 동작 영향 없음)
1. `src/components/calendar/EventCreateTooltip.tsx` 387줄 전체 — import 0건(`grep -rln EventCreateTooltip src` → 자기 자신 + `ScheduleView.tsx:26` 주석뿐).
2. `src/views/ScheduleView.tsx:412-547` `EventDetailModal` — `<EventDetailModal` 렌더 0건(2074 주석 'EventSidePanel (replaces EventDetailModal)'). 전용 아이콘 import(`Clock, FileText, MapPin, Settings, Pencil, ExternalLink, Trash2` :5-8)도 함께.
3. `ScheduleView.tsx:1091-1156` `TodayView` — 렌더 0건(오늘 모드는 `DayScrollView`).
4. `ScheduleView.tsx:1207` `editEvent` + `:1421-1432` `handleUpdateEvent` + `EventCreateModal` 편집 모드 — `setEditEvent` 호출 6곳(1432,1529,1623,2001,2016,2068) 전부 `null` → 편집 모드 도달 불가. (살릴지 여부는 오너 질문 참조)
5. `ScheduleView.tsx:1208` `detailEvent` — `setDetailEvent(null)` 만 2회(1466,1483), 읽기 0건.
6. `ScheduleView.tsx:1451-1454` `handleDateClick` — 빈 함수, `:2030` prop 전달만.
7. `ScheduleView.tsx:1240` `weekOffset`(set 1회·deps 등장만), `:1524` `dragState` destructure 미사용, `CalendarGrid` `focusWeekIndex` prop(876,895 선언만), `EventBarChip` `compact` prop(145,149), 미사용 import `Filter`/`GripVertical`/`filterEventsByRange`/`isSameDay`(tsconfig `noUnusedLocals:false` 라 통과).
8. `src/types/calendar.ts:71` `CalendarStore` — 참조 0건. `:55` `vacationRowIndex` — 쓰기/읽기 0건(휴가는 `vac-`/`gvac-` 합성 ID 만).
9. `src/services/calendarService.ts:216-220` `loadLegacyEvents`/`legacyLoaded`(no-op) 와 `:222-225` `loadAllEvents`(외부 호출 없음, `getEvents` 와 동일).
10. `calendarService.ts:631-638` `findEventByTodoId` — 정의 파일 외 참조 없음(할일 연동은 메인 `personalTodoCalendarSync` 로 이관).
11. `ScheduleView.tsx:1172,1182` `window.dispatchEvent(new Event('bflow:todos-changed'))` — 수신 리스너 0건(grep). 할일 갱신은 `personal-todo:commit` IPC 로 이뤄짐.
12. `tests/calendarIntegrationStatus.test.ts` — `package.json` test:* 어디에도 미포함(빌드 게이트 밖의 죽은 테스트). 삭제보다 `test:ui` 연결 권장.
13. `src/mocks/devElectronAPI.ts:1084` `supabaseAddPrivateEvent` 고정 id `'mock-private'` — 프리뷰에서 비공개 일정 2개 이상 생성 시 캐시 id 충돌. dead 는 아니나 버그성 mock.

## B. 제거 권고 2순위 — 잔재(stub)·반쪽 구현 (공유 캘린더 설계 시 정리)
1. `calendarService.ts:206-208` `getTargetCalendar(_type)` 항상 `'primary'` — 팀/개인 캘린더 구분 제거된 시그니처 잔재. 호출부 3곳은 `existing.sourceCalendarId || …` 폴백.
2. 팀 캘린더 설정 경로: `SheetsSection.tsx:243-254` `handleCalendarSelect`/`calendars` state 를 `void` 로 무력화, `calendarService.ts:117-132` `saveTeamCalendarId`/`saveGCalSettings` 는 UI 경로 없음, `GCalSettings.teamCalendarId`(`types/calendar.ts:75`)는 읽기(syncAll :261)에만 섞임. → 공유 캘린더를 Supabase 로 가면 전부 제거 대상; GCal 팀 캘린더로 가면 복원 대상.
3. `calendarService.ts:434` `visibility: event.isPrivate ? 'private' : undefined` — `isPrivate` 는 :371 에서 이미 Supabase 분기로 빠지므로 도달 불가. `types/calendar.ts:61-67` `isPrivate` 주석("Google Calendar 에 visibility:'private' 로 저장")도 구버전 설명.
4. `electron/broadcast.ts:241-242` 주석 "다른 기기 비공개 CRUD 도 실시간 반영된다" — 수신측 `App.tsx:2584-2595` 는 `syncIncremental`(GCal 만) → 비공개 미반영. 주석 오류 또는 미구현.
5. `types/calendar.ts:88-89` `bflow_vacation_type/bflow_vacation_user` + `CalendarEventType 'vacation'` 의 Google 쓰기 경로 — 휴가는 GAS 에서 읽기만 하므로 실제 기록 경로 없음(`toBflowMeta` :197-198 복사만).
6. `calendarService.ts:41-62` localStorage `bflow_gcal_local_settings` 와 메인 `gcal-local-settings.json` 이중 저장 — 단일화 가능.
7. `ScheduleView.tsx` `ev.linkedTodoId || ev.id.startsWith('cal_')` 6회(308,1428,1443,1493,1671,1711) — `cal_` ID 는 `calendarService.ts:466` 저장소 이전 임시 ID 뿐이라 사실상 레거시 분기.
8. `electron/googleCalendar.ts:89-92` TODO 주석(이미 실제 URL 들어가 있음), `:245-248` startAuth 120초 타이머 미해제(무해).
9. DB `metadata` `type='feature-access'` orphan 행(캐릭터 현황판 게이트, v1.94.0 삭제) — 새 공유 기능에서 같은 키 재사용 금지.
10. `ROADMAP.md:1179-1183` 수치(calendarService 81줄/ScheduleView 57KB/CalendarWidget 358줄)는 현재(638/2111줄/879줄)와 불일치.

## C. 중복 (리팩터링 대상 — 기능 확장 비용의 원인)
1. **CalendarWidget(879줄) vs ScheduleView 서브컴포넌트**: 월/2주/주/일 4개 화면을 완전히 별도 구현(상태 모델도 절대 인덱스 vs 상대 오프셋). `src/components/calendar/*`·훅 어느 것도 import 안 함.
2. **날짜 유틸 10곳 로컬 복제**: `fmtDate/parseDate/addDays/daysBetween/hexToRgba/요일 배열` 이 ScheduleView, DayScrollView, DaySidebar, WeekScrollView, WeekSidebar, MiniCalendar, EventSidePanel, useCalendarDnD, useCalendarDragCreate, CalendarWidget 에 각각. 주차 계산 `getISOWeekNumber`(WeekScrollView.tsx:36) vs `getWeekNumber`(CalendarWidget.tsx:19) 이중.
3. **휴가→CalendarEvent 매핑 3중복**: `ScheduleView.tsx:1271-1285`, `CalendarWidget.tsx:130-144`, `CalendarView.tsx:311-326`(id 접두만 `vac-`/`wvac-`/`gvac-`).
4. `EventCard`(WeekScrollView.tsx:414-475) ≈ `DayEventCard`(DayScrollView.tsx:290-347) 카드 마크업 중복. `WeekScrollView.tsx:8-9` `WEEKDAYS`/`WEEKDAY_SHORT` 동일 배열.
5. `CalendarView.tsx:339-346` `vacByPerson` useMemo 계산 후 미사용, 601-608 재계산.
6. ScheduleView 2111줄 단일 파일(CalendarGrid/EventCreateModal/OverflowPopup/할일 역동기화 포함) — 캐릭터 현황판처럼 분해 선행 필요.

## 권고 순서
(1) A 전부 삭제 + `calendarIntegrationStatus.test.ts` 를 `test:ui` 에 연결 → (2) 공유 캘린더 저장소 결정 후 B-1~B-5 정리 → (3) 확장 전 C-1·C-2(공용 `calendarDate.ts` 유틸, CalendarWidget 이 `src/components/calendar/*` 재사용)·C-6 분해.

## 4. 공유 캘린더 토대 분석
## 목표 재확인
"구글 계정 연동 없이도 보이는, 팀 전체 또는 특정 팀원에게만 보이는 캘린더들을 만들고·관리·공유". 현재 코드에는 이 기능의 **직접 토대는 없다**(공유 대상 컬럼·캘린더 엔티티·멤버 선택 UI 연결 모두 부재). 대신 재사용할 수 있는 간접 토대는 꽤 많다.

## 1. 재사용 가능한 토대
### (a) 사용자 모델 — 그대로 사용 가능
- Supabase `users`(`DEVLOG/supabase-init.sql:114-124`): `id TEXT(UUID 문자열)`, `name`, `role 'admin'|'user'`, `slack_id`, `is_compositor`, `is_acting_supervisor`. 앱 타입 `AppUser`(`src/types/index.ts:567-585`). 렌더러 `useAuthStore.users`(앱 시작 시 `loadUsers`, `src/services/userService.ts:37-66`)가 전원 목록을 들고 있어 **멤버 선택 드롭다운의 데이터 소스로 즉시 사용 가능**.
- 주의: 씬/복장 담당자는 **이름 문자열**(`scenes.assignee`)이라 식별 체계가 둘. 공유 대상은 반드시 `users.id` 기반으로 저장해야 함(이름 변경·동명이인 대비).

### (b) 권한 판정 패턴 — 복제할 선례
| 패턴 | 위치 | 공유 캘린더에 적용 |
|---|---|---|
| 메인 IPC 에서 세션 사용자 강제 + 소유자 검증 | `electron/main.ts:2423-2457` `getSessionUserIdOrThrow`/`assertPrivateEventOwnerOrThrow` (비공개 일정), `electron/personalTodoService.ts:302-313` | **가장 권장되는 강제 지점**. 새 `calendar:*` IPC 도 같은 헬퍼로 "세션 사용자가 owner 또는 member 인 캘린더만 읽기/쓰기" 를 메인에서 걸 수 있음 |
| `user_id` 컬럼 + 본인 필터 | `private_calendar_events.user_id`, `personal_todos`, `memos`, `task_views` | 개인 캘린더(자기 전용)의 원형 |
| `role==='admin'` UI 분기 | `SettingsSidebar.tsx:78-99`, `AdminRoleSection.tsx`, `CompositorSection.tsx` | "팀 전체 캘린더는 admin 만 생성" 같은 규칙에 재사용 |
| 행 단위 수신자 목록 JSONB | `comp_revisions.notify_user_ids`/`assignee_ids`(`DEVLOG/2026-05-03-revision-redesign-migration.sql:18-33`) | `calendars.member_ids JSONB` 식의 가장 단순한 공유 대상 저장 선례 |
| metadata JSON 기반 기능 게이트(삭제됨) | git `72fb503^:src/hooks/useCharacterBoardAccess.ts`, `FeatureGatingSection.tsx` | "사용자 멀티선택 + 관리자 자동 포함 + 즉시 저장/롤백" 설정 UI 의 직접 선례(코드는 git 에만) |
| 하드코딩 이름 게이트 | `VacationView.tsx:35` `DAHYU_ADMINS`, `navVisibility.ts:12`, `compositingLabels.ts:83-89` | 반면교사 — 공유 기능에는 쓰지 말 것 |

### (c) "N명 선택" UI — 붙여 쓸 수 있는 컴포넌트
1. `src/components/compositing/CompositorAssignPopover.tsx`(226줄) — `useAuthStore.users` 체크 팝오버, `Set<string>` 선택, dirty 가드, 바깥클릭/Esc, 저장 중 잠금, 저장 후 재조회. **1순위 템플릿**.
2. `src/components/scenes/RevisionRecipientPicker.tsx`(308줄) — props `allUsers, defaultCheckedIds, excludeUserId, onChange(checkedIds)` 순수 presentational 칩+검색. 캘린더 생성/설정 모달 안에 그대로 삽입 가능.
3. `src/components/scenes/FeedbackRequestModal.tsx`(429줄) — 기본 풀 체크 + 검색 추가 모달형.
4. `src/components/characters/AssigneeNamePicker.tsx` — 이름 기반·자유 입력 허용이라 **부적합**.
- 공통 유틸: `src/utils/avatarColor.ts`, `src/utils/userColor.ts`.

### (d) 낙관적 업데이트·브로드캐스트 골격
- `calendarService.addEvent/updateEvent/deleteEvent` 의 캐시 push → IPC → 롤백 패턴(:369-449 등)과 `broadcastCalendarChange` → `bflow:calendar-changed` → 뷰 `getEvents()` 갱신 구조는 저장소가 바뀌어도 그대로 쓸 수 있다. 비공개 이벤트 IPC(`supabase:*-private-event`)는 "Supabase 전용 일정 CRUD" 의 완성된 예시이며, 새 공유 테이블용 IPC 는 이걸 복제·확장하면 된다.
- 메인 `electron/broadcast.ts` `broadcastCalendarChanged`/`broadcastDataChange` 와 `electron/realtime.ts` 구독 목록(테이블 추가만 하면 postgres_changes 수신).
- `CalendarEvent.isReadOnly`(휴가에 사용 중)는 "공유받은 보기 전용 일정" 표시에 재사용 가능. `EventSidePanel.tsx:148`, `useCalendarDnD` 가 이미 `isReadOnly` 를 존중.

### (e) UI 표면
- 캘린더 본체 UI(ScheduleView·서브컴포넌트·DnD·필터·사이드패널)는 저장소와 무관하게 재사용. 필터(`ScheduleView.tsx:1301-1307`)에 "캘린더 선택" 차원을 추가하는 형태로 확장 가능.

## 2. 부족한 것 (새로 만들어야 함)
1. **캘린더 엔티티 자체가 없다.** 현재 "이벤트" 만 있고 "캘린더(묶음)" 개념이 없다. 필요한 최소 스키마: `calendars(id, name, color, owner_id, visibility 'team'|'members'|'private', created_at)` + 공유 대상(`calendar_members(calendar_id, user_id, can_edit)` 또는 `member_ids JSONB`) + `calendar_events(calendar_id, …기존 private_calendar_events 컬럼…)`. `private_calendar_events` 를 `calendar_events` 로 승격(또는 `calendar_id NULL=개인` 으로 흡수)하는 마이그레이션이 자연스럽다.
2. **공유 대상 컬럼·가시성 필터 없음.** `CalendarEvent` 에 `createdBy`(이름)·`isPrivate` 만 있음(`src/types/calendar.ts:27-68`). 읽기 경로 `syncAll` 은 "본인 user_id" 만 조회(`calendarService.ts:243-252`).
3. **권한 강제 지점 없음.** RLS 는 전 테이블 `allow_all` + anon key + Supabase Auth 미도입(`electron/supabase.ts:79-92`, `auth.uid()` 0건)이라 DB 로는 못 막는다. 앱 레벨로 가야 하며, 최소한 읽기 IPC 에서 `getSessionUserIdOrThrow` 기반 멤버십 체크를 메인에 둬야 "UI 에서만 안 보이는" 수준을 넘는다. `supabase:write-metadata`(`main.ts:2770`)·`supabase:update-user` 는 현재 검증 없음 — metadata 방식으로 공유 설정을 저장하면 권한이 없다.
4. **팀/그룹 엔티티 없음.** 사용자에 부서 컬럼 없음(`parts.department` 만). "BG 팀 전체에 공유" 같은 묶음 선택을 원하면 `users` 부서 컬럼 또는 `user_groups` 가 필요 — 단 메모리 규칙 "부서(BG/ACT) UI 분리 자제" 와 충돌 여부 확인 필요. 당장은 `visibility:'team'`(전원) + 개별 user id 목록 두 단계로 충분.
5. **Google 미연동자 경로.** `syncAll` 호출부 전부 `isAuthenticated` 가드(`ScheduleView.tsx:1253-1256`, `CalendarWidget.tsx:110-113`, `calendarService.ts:345-346,633-634`, `App.tsx:2586-2588`). 공유 캘린더는 이 가드 **밖**에서 로드되도록 분리해야 "구글 연동 없이도 보이는" 목표가 성립. (syncAll 내부는 이미 비공개→Google 순이라 가드만 풀어도 비공개는 살아난다.)
6. **타인 변경 실시간 전파 없음.** `private_calendar_events` 는 Realtime 미구독, Broadcast 수신측은 GCal 만 재조회. 새 테이블은 `supabase_realtime` publication + `electron/realtime.ts` 추가 + 수신 시 Supabase 재조회 경로 필요. 또한 `App.tsx:2458-2480` 이 비-users 테이블 `data-change` 를 전체 `loadData()` 로 처리하므로 캘린더 테이블은 이 분기에서 제외해야 함.
7. **관리 UI 없음.** 캘린더 생성/이름·색/멤버 편집/삭제 화면, 캘린더별 표시 토글(구글 캘린더식 좌측 체크 목록), 이벤트 생성 모달의 "어느 캘린더에" 선택 — 전부 신규. `SheetsSection` 의 Google 카드와 분리된 "캘린더 관리" 설정 섹션 또는 ScheduleView 좌측 사이드바 확장이 후보.
8. **데이터 무결성.** `private_calendar_events.user_id` FK 없음, 날짜 TEXT. 새 테이블은 `REFERENCES users(id)`, `DATE` 타입, `delete_user_cascade` RPC 갱신 필요.
9. **테스트·프리뷰.** 캘린더 단위 테스트 0건, 프리뷰 mock 은 빈 값 — 공유 기능 구현 전 `devElectronAPI.ts` seed 와 최소 도메인 테스트(가시성 판정 함수) 선행 권장.

## 3. 설계 방향에 대한 소견(결정은 오너)
- 목표 문장("구글 연동 없이")과 CLAUDE.md 규칙 4("새 기능은 supabaseService 경유") 를 합치면 **Supabase 신규 테이블이 자연스러운 선택**이다. 이 경우 Google Calendar 는 "개인 미러/내보내기" 로 격하되고 `getTargetCalendar`·`teamCalendarId`·`toBflowMeta` 계열은 정리 대상이 된다.
- 권한은 "메인 IPC 강제(private_calendar_events 방식)" 수준이 현실적 상한이며, Supabase Auth+RLS 는 별도 프로젝트다.

## 5. PM 일정관리 관점 갭 분석
## PM 일정관리 관점에서 현재 캘린더가 못 하는 것 (우선순위 순)

### P0 — 목표 기능("구글 연동 없는 팀/멤버 공유 캘린더")을 직접 막는 것
1. **팀이 같이 보는 일정 저장소가 없다.** 공개 일정은 각자 Google `primary` 에 저장(`calendarService.ts:206-208`)되고 읽기도 자기 primary 뿐(:258-265). PM 이 "EP03 마감" 을 만들어도 다른 팀원 앱에는 안 뜬다. `teamCalendarId` 는 읽기에만 섞이고 설정 UI 는 `void`(`SheetsSection.tsx:243-244`).
2. **Google 미연동 = 빈 캘린더.** `syncAll` 호출이 전부 `isAuthenticated` 뒤(`ScheduleView.tsx:1253-1256`, `CalendarWidget.tsx:110-113`). 비개발자 팀원이 OAuth 동의를 거쳐야 일정이 보이는 진입 장벽이며, 비공개 일정조차 재시작 후 안 보인다.
3. **"누가 볼 수 있나" 를 앱이 정하지 못한다.** 이벤트에 소유자/공유 대상/참석자 컬럼이 없고(`types/calendar.ts:27-68` `createdBy` 이름 문자열뿐), RLS 는 `allow_all`, 뷰 내부에 작성자 기반 권한 체크 없음(`EventSidePanel.tsx:148` 은 `isReadOnly`/휴가만). 동료가 만든 B flow 일정도 같은 캘린더를 읽으면 내 앱에서 편집 가능하게 보인다.
4. **캘린더(묶음) 개념이 없다.** "캘린더를 만들고 관리" 할 엔티티·UI·표시 토글이 전무. 현재는 타입 필터(일반/EP/파트/씬/휴가) 와 부서 필터뿐(`ScheduleView.tsx:1883-1932`).

### P1 — 일정관리 도구로서의 기본기 공백
5. **담당자 개념 없음.** 일정에 사람을 배정하거나 "내 일정/OOO 일정" 으로 거를 수 없다. 담당자별 부하·주간 배정 뷰 불가.
6. **시간 단위 불가.** `startDate/endDate` 가 `YYYY-MM-DD` 종일만(`types/calendar.ts:34-36`, `calendarService.ts:420-422` 길이 10 판정). 회의·마감 시각 관리 불가.
7. **편집 경로 분산·공백.** 생성 모달은 색·유형·연결대상·나만보기를 받지만, 생성 후 연결대상(EP/파트/씬)은 어디서도 수정 불가(사이드패널=제목·날짜·메모·나만보기, 퀵에디트=색·제목·날짜·유형·메모). `EventCreateModal` 편집 모드는 도달 불가 코드.
8. **주/2주/일 모드는 열람 위주.** DnD·우클릭·드래그 생성이 월 `CalendarGrid` 전용(`data-date` 셀, `useCalendarDnD`, `useCalendarDragCreate`).
9. **반복·알림·리마인더·슬랙 연동 없음.** 마감 임박 경고(ROADMAP 4-2 "D-3/D-1" 미체크 `ROADMAP.md:424-425`), 변경 알림, 슬랙 공지 코드 0건.
10. **프로덕션 데이터와 날짜가 연결돼 있지 않다.** `Scene/Part/Episode` 에 마감일 컬럼 없음(`src/types/index.ts:438-497,688,696`), 캘린더의 EP/파트/씬 이벤트는 전부 수동 링크, 씬 화면에서 역조회 불가. 유일한 마감 데이터 `character_costumes.due_date` 도 캘린더 미표시.

### P2 — 구조·운영 부채 (확장 비용을 키우는 것)
11. 실시간 전파 미비: 비공개 일정 타 기기 미반영(`broadcast.ts:241-242` 주석과 불일치), 공개는 GCal watch(7일)·Edge Function·하드코딩 토큰(`googleCalendar.ts:90-92`) 경로 의존, `private_calendar_events` 변경이 전 클라이언트 `loadData()` 풀 리로드 유발(`App.tsx:2458-2480`).
12. 데이터 소스 3원화(GCal / Supabase / 휴가 GAS) — 가용 인원·휴가 반영 마감 경고 같은 집계 레이어 없음. 공개 일정은 Google 왕복 시 색상·`linkedSheetName` 유실(`calendarService.ts:152`, `toBflowMeta`).
13. UI 중복(CalendarWidget 별도 구현, 날짜 유틸 10곳, 휴가 매핑 3곳) + ScheduleView 2111줄 단일 파일 + dead 코드 다수 → 필드 하나 추가에 6종 이상 수정.
14. 테스트 0건(캘린더 UI/서비스/DnD), `calendarIntegrationStatus.test.ts` 는 빌드 게이트 미연결, 프리뷰 mock 빈 값 → 회귀 감지·시안 검증 수단 부재.
15. 네이밍 역전(`'calendar'`=타임라인, `'schedule'`=캘린더, 백스택 라벨 '일정') + `headerTitle.ts` 에 `schedule` 없음 → 기획·QA 커뮤니케이션 혼선.
16. 타임라인 탭의 timeline/heatmap 은 날짜 축 없는 진행률 차트, gantt 는 읽기전용·범위 고정(`CalendarView.tsx:325-327`)·캐시 미구독(:297) — "타임라인" 이란 이름과 달리 일정 도구가 아님.
17. 휴가 탭 숨김이 사이드바만(`navVisibility.ts`), `UserMenu.tsx:65`·`ScheduleView.tsx:1465`·`resolveAllowedView` 는 미차단. 휴가 모듈은 2026-03-02 이후 동결, 관리자 이름 하드코딩.
18. 미리보기 모드 `supabaseAddPrivateEvent` 고정 id(`devElectronAPI.ts:1084`).

### 제안 우선순위 (목표 기준)
1) Supabase `calendars`+`calendar_events`(+멤버) 신설, 메인 IPC 에서 세션 기반 멤버십 강제, Google 가드 밖 로드 경로 → P0-1~4 해결.
2) 캘린더 관리 UI(생성/멤버/표시 토글) + 이벤트 생성 모달 "캘린더 선택" + 사이드패널에서 연결대상·색 편집 통합 → P1-4,7.
3) Realtime 구독·`data-change` 분기 제외·dead 코드 제거·날짜 유틸 공용화·프리뷰 seed·도메인 테스트 → P2.
4) 담당자/시간/알림은 오너 확인 후(한솔 기존 결정 "팀은 캘린더/마감 날짜 거의 안 씀", `docs/superpowers/specs/2026-06-28-mytasks-widget-redesign-design.md:10`) 단계적으로.

## 6. 오너 확인 질문
1. [최우선] 공유 캘린더 데이터를 어디에 둘까요? (a) Supabase 에 새 '캘린더·일정' 테이블을 만들고 Google 은 개인 미러로만 남김 — '구글 연동 없이도' 목표와 CLAUDE.md 규칙(새 기능은 Supabase 경유)에 맞음 / (b) Google 팀 캘린더(teamCalendarId) 쓰기를 복원하고 Google 공유 권한을 씀 — 연동 필수가 계속 남음. 현재 코드는 공개 일정을 각자 Google primary 에만 씁니다(calendarService.ts:206-208).
2. 팀원 전원이 Google Calendar 를 실제로 연동해 쓰고 있나요, 아니면 대부분 미연동인가요? 미연동이면 지금 캘린더는 휴가만 보이는 빈 달력입니다(ScheduleView.tsx:1253-1256). 이 답에 따라 Google 경로를 '유지·격하·제거' 중 무엇으로 할지 달라집니다.
3. 공유 범위 단위는 '팀 전체 / 내가 고른 사람들 / 나만' 세 가지로 충분한가요? 아니면 'BG 팀·컴포지터 전원' 같은 묶음 선택도 필요한가요? 묶음이 필요하면 사용자에 부서(팀) 속성을 새로 둬야 하는데, 이전 결정 '부서 UI 분리 자제' 와 충돌할 수 있습니다.
4. 권한을 얼마나 강하게 막을까요? (1) 화면에서만 안 보이게(빠름, 우회 가능) (2) 앱 메인 프로세스에서 로그인 사용자 기준으로 읽기·쓰기를 막음(현재 '나만 보기' 일정 방식, 권장) (3) Supabase Auth 도입 + DB 권한(RLS) — 별도 큰 프로젝트. 지금 DB 는 전 테이블 allow_all 이라 (3) 없이는 DB 로 못 막습니다.
5. 캘린더를 누가 만들고 멤버를 누가 바꿀 수 있나요? 만든 사람만 / admin 도 가능 / 팀 전체 캘린더는 admin 만 생성? 그리고 공유받은 사람은 보기만인지 편집도 가능한지(캘린더별 '편집 허용' 옵션 필요 여부).
6. '팀은 캘린더/마감 날짜를 거의 쓰지 않는다'(2026-06-28 결정) 전제가 지금도 유효한가요? PM 일정관리 요구가 새로 생긴 배경(누가·어떤 단위로 — 에피소드 마감? 회의? 개인 작업 배정?)을 알려주시면 담당자·시간·알림 같은 P1 항목의 포함 여부를 정할 수 있습니다.
7. 에피소드/파트/씬 '마감일' 을 데이터로 넣을 계획이 있나요? 현재 씬·파트·에피소드에 날짜 컬럼이 전혀 없어 캘린더의 EP/파트/씬 일정은 전부 수동 링크입니다. 넣는다면 씬/에피소드 테이블 컬럼으로 둘지, 캘린더 일정의 연결로만 둘지.
8. '타임라인' 탭(진행률 바·히트맵·읽기전용 간트, 코드명 'calendar')과 '캘린더' 탭(코드명 'schedule')을 계속 둘 다 둘까요? 간트를 캘린더의 5번째 모드로 합치고 타임라인은 진행률 분석 전용으로 줄이는 안, 또는 이번 개편에서 타임라인 탭은 손대지 않는 안 중 선택이 필요합니다.
9. 휴가 모듈(스프레드시트 기반, 2026-03 이후 변경 없음, 특정 사용자에게 탭 숨김)을 이번 캘린더 개편 범위에 넣을까요, 아니면 지금처럼 읽기전용 오버레이로만 두고 손대지 않을까요? 실제 사용률도 궁금합니다.
10. 정리 작업을 같이 진행해도 될까요? 확실한 죽은 코드(EventCreateTooltip 파일, ScheduleView 의 EventDetailModal/TodayView/편집모드 잔재 등)와 대시보드 캘린더 위젯의 별도 구현(ScheduleView 와 코드 공유 없음)을 공유 기능 전에 먼저 걷어내면 이후 수정 범위가 절반 이하로 줄어듭니다. 대신 배포 1회가 '정리' 만으로 나가게 됩니다.

## 7. 탐색 간 모순 검증 기록
1. [isPrivate 저장 위치] users_sharing 탐색의 권한 패턴 표는 '공개 캘린더 일정 … isPrivate 는 GCal visibility:private' 라고 적었으나, data/google/views/integrations 는 'isPrivate=true → Supabase private_calendar_events 전용' 이라고 함. 파일 확인 결과 후자가 맞다: calendarService.ts:371 `if (event.isPrivate)` 분기에서 Supabase 로 저장하고 return (:371-408). :434 의 `visibility: event.isPrivate ? 'private' : undefined` 는 도달 불가 잔재이며, types/calendar.ts:61-67 의 isPrivate 주석이 구버전 설명이라 users_sharing 이 이를 인용한 것으로 보임.
2. [Google 미연동 시 비공개 일정] data 탐색은 '미인증 사용자는 비공개 일정만 가능' 이라 했고 google 탐색은 '미연동이면 Supabase 비공개 일정조차 초기 로드되지 않는다' 고 함. 둘 다 부분적으로 맞다: 생성(addEvent :371-408)은 앱 로그인만 있으면 되지만, 초기 로드 syncAll 호출부가 전부 isAuthenticated 가드 뒤(ScheduleView.tsx:1253-1256, CalendarWidget.tsx:110-113, calendarService.ts:345-346·633-634, App.tsx:2586-2588)라 재시작 후엔 보이지 않는다. syncAll 내부(:240-252)는 비공개를 먼저 읽도록 돼 있어 호출부 가드가 의도를 무력화하는 상태.
3. [getTargetCalendar 위치] data/google/users_sharing 은 calendarService.ts:202-205(또는 202-208), views/integrations 는 206-208(209). 확인: 주석 202-204, 함수 본체 206-208. 실질 차이 없음.
4. [CalendarStore 타입 위치] data 는 types/calendar.ts:71, views 는 :63, history 는 :80. 확인: :71 이 맞음(:80 은 BflowEventMeta 주석).
5. [ScheduleView 줄 번호 드리프트] components 는 handleDateClick 1440-1444·handleNavigate 1442-1467(views), integrations 는 1451-1454·1464-1469. 확인: handleDateClick 1451-1454, handleNavigate 1462-1468. EventDetailModal 끝 줄도 551(views) vs 547(components) — 함수 본체는 412 시작, 큰 의미 없음.
6. [파일 줄수] google 탐색의 electron/main.ts 5048·preload.ts 660·electron/supabase.ts 1860·broadcast.ts 360·App.tsx 2700, data 탐색의 broadcast.ts 260 은 추정치. wc -l 확인: main.ts 5135, preload.ts 770, supabase.ts 4670, broadcast.ts 357, App.tsx 3019, Sidebar.tsx 493(google 420 오기), realtime.ts 226(data 130 오기). 나머지(calendarService 638, ScheduleView 2111, CalendarView 960, VacationView 1193, CalendarWidget 879, googleCalendar.ts 501, types/calendar.ts 90)는 일치.
7. [코드 주석 vs 동작] electron/broadcast.ts:241-242 주석 '다른 기기 비공개 CRUD 도 실시간 반영된다' 는 data·google 탐색 모두 '실제 수신측(App.tsx:2584-2595)은 GCal incremental 만 수행' 이라고 지적 — 탐색 간 모순은 아니지만 코드 주석이 현실과 어긋남을 확인(파일 열어 검증).
8. [역할 호칭] views 는 CalendarView 를 '에피소드/파트 진행률 분석 + 읽기전용 간트', history 는 '간트/히트맵' 으로 요약하고 둘 다 '중복 아님' 으로 일치. 다만 views 의 '타임라인 탭 timeline 은 날짜 축 없음' 과 ROADMAP 4-2 '[완료] 간트 차트' 표기는 용어 충돌(ROADMAP 의 간트=진행률 바, 코드의 gantt 탭=날짜 간트).