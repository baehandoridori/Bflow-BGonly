# 캘린더 2차 개편 확정 설계서 — 주간 시간표 + 폴리싱 + ICS 구독 (SSOT)

- **작성일**: 2026-08-26 | **상태**: **확정** (한솔 Q1~Q5 전부 추천안 채택, 2026-08-26)
- **배경·근거·대안 비교**: `2026-08-26-calendar-timegrid-polish-proposal.md` (제안서) 참조.
  이 문서는 구현 세션이 따라야 할 **확정 스펙만** 담는다. 충돌 시 이 문서가 우선.
- **시안**: https://claude.ai/code/artifact/2f5ba08d-2590-4c28-a75d-5df3a873ef8f
  (원본 `docs/superpowers/specs/mockups/2026-08-26-calendar-timegrid/proposal.html`)
- **구현 플랜**: `docs/superpowers/plans/2026-08-26-calendar-timegrid.md`
- **선행**: 1차 설계서 `2026-08-24-calendar-pm-shared-calendars-design.md` (D1~D7). 본 문서는
  D8부터 이어 번호를 붙인다.

---

## D8. 시간표 진입 방식 (Q1=A, Q2=A)

- '주' 보기 안에 **[카드 | 시간표] 서브 토글**을 둔다. 헤더 세그먼트는 `[월|2주|주|오늘]`
  4개 유지. 서브 토글은 주 보기 활성 시에만 세그먼트 오른쪽에 표시(시안 §02 배지 9).
- **2주 보기는 카드형 그대로, '오늘' 보기도 현행 유지**(시간표화는 다음 라운드 재평가).
- 최초 기본값 = **카드**(기존 동작 불변 원칙). 서브 토글 선택은 localStorage에 기억(D12).
- 새 모드 한글명 = **"시간표"**.

## D9. 시간표 화면 구성 (시안 §02가 시각 SSOT)

- **레이아웃**: 좌측 시간 거터(56px, "오전 9시/오후 12시" 표기) + 7일 컬럼. **주 시작 =
  일요일**(한솔 확정 2026-08-26 — 기존 `generateYearWeeks`의 일요일 시작 주 배열을 그대로
  사용한다. 시안 §02의 월요일 시작 표기는 목업 제작 편의였으며 요일 순서는 일~토가 정답).
  1시간 실선 + 30분 옅은 보조선. 요일 헤더는 기존 관례(오늘=액센트 원형 배지,
  일=red-400·토=blue-400, 주말 컬럼 배경 딤).
- **종일 레인**: 요일 헤더 아래 별도 레인. 멀티데이 바는 **`CalendarGrid.tsx`의
  `layoutEventBars(events, weekStart, cols)`를 export해 재사용**한다(`VacationView.tsx`의
  동명 4-인자 함수 아님 — 주의). 주 단위 클램프 · `◂`/`▸` 이어짐 표기 동일.
  **최대 2행 + "+N개" 확장 토글**(클릭 시 레인 펼침, 다시 클릭 시 접힘).
- **시간대 노출**: 기본 09:00~19:00. **0~9시 / 19~24시는 접힘 밴드**("⌄ 0시–9시 · 접혀
  있어요")로 표시하고 클릭 시 펼침. **접힌 구간에 일정이 있으면 해당 구간 자동 펼침**.
  펼침 상태는 세션 내 유지(영속화 안 함).
- **현재 시각 라인**: 오늘 컬럼에 2px 빨간 실선 + 좌측 점 + 거터에 "HH:MM" 빨간 칩.
  다른 컬럼에는 1px 28% 옅은 선. 1분 간격 갱신(setInterval, 뷰 언마운트 시 해제).
- **자동 스크롤**: 시간표 진입 시 현재 시각(오늘이 범위 밖이면 09:00)이 보이도록 스크롤.
  간트의 "오늘 자동 스크롤" 패턴(CalendarView.tsx EventGanttChart) 참고.
- **휠 정책**: 시간표 본체에서 휠 = 세로 시간 스크롤 전용. **주 이동은 ←→ 키 / 헤더
  화살표 / Shift+휠**. (카드 모드의 "휠=주 이동"은 그대로 유지 — 모드별 정책 분리)
- **지난 일정**: 종료 시각이 현재보다 앞이면 opacity 0.5 딤. 진행 중(시작≤now<종료)이면
  1px 컬러 링 + 그림자 서브틀 강조.

## D10. 이벤트 블록과 데이터 매핑

- **블록 스타일**: `색 18% 틴트 채움(color-mix over #1A1D27) + 좌측 3px 원색 보더 +
  9px 시각 라벨(원색) + 11px 제목(#E8E8EE)`. 색은 기존 규칙 그대로 = 소속 캘린더 색
  (구글 #8B8DA3, 휴가 VACATION_COLOR). 최소 블록 높이 = 15분(14px). 30분 미만 블록은
  시각 라벨 생략하고 제목 한 줄만.
- **겹침 배치**: 충돌 클러스터 균등 분할 + 우측 빈 컬럼 확장. `timeGridLayout.ts` 순수
  함수로 구현 + 단위 테스트 필수(알고리즘은 플랜 Task B.1의 기준 구현이 SSOT).
- **레인 귀속 규칙**:
  - `allDay !== false` (true 또는 undefined — tri-state 규칙) → 종일 레인.
  - `allDay === false && startDate === endDate` → 시간 그리드 블록.
  - `allDay === false && startDate !== endDate` (멀티데이 timed) → **종일 레인으로 강등**
    표시(바 텍스트에 시각 프리픽스 유지). 구글 유입분 대비.
  - 시각 표기는 기존 `formatEventTimeRange`/`formatEventChipText` 재사용.
- **접근성**: 시간표 블록은 `<button type="button">` + `aria-label`("제목, 시각 범위") +
  키보드 포커스 ring. (기존 월 그리드 칩 개보수는 이번 비범위 — 제안서 §4 T2)

## D11. 인터랙션 (PR-C)

- **스냅**: 15분. 픽셀↔분 변환·스냅은 `timeGridLayout.ts` 순수 함수 공유(생성/이동/
  리사이즈 세 경로 동일 유틸).
- **빈 슬롯 드래그 생성**: 드래그 중 고스트 블록 + 라이브 "HH:MM – HH:MM" 라벨. 놓으면
  EventCreateModal이 `allDay=false` + 시각 프리필로 오픈. **클릭만 하면 30분** 일정 프리필.
  기존 `useCalendarDragCreate` 패턴(16ms 쓰로틀·persisted 하이라이트) 이식.
  **클릭 vs 드래그 5px 임계는 두 훅에는 없고 `CalendarGrid.tsx` EventBarChip의 mousedown
  핸들러(THRESHOLD=5)에 있다** — 그 패턴을 이식해 블록 클릭(상세 열기)과 드래그(이동)를
  구분한다.
- **블록 이동**: 요일+시간 2축 동시(deltaDays+deltaMinutes). 원위치에 점선 고스트 유지,
  이동 블록은 그림자+scale 1.02 "들어올림", 블록 내 시각 라벨 실시간 갱신.
- **리사이즈**: 하단 엣지 8px 히트존(ns-resize)만. 종료 시각 변경, 최소 15분 보장.
- **Esc 취소**: 드래그 중 Esc = 원상 복귀(생성/이동/리사이즈 공통). 신규 훅과 기존
  `useCalendarDnD`(월간)에 모두 추가(G8). mousemove 16ms 쓰로틀도 월간 훅에 통일.
- **드래그 자동 스크롤**: 시간표 스크롤 영역 가장자리 40px 접근 시 자동 스크롤.
  `src/utils/dragAutoScroll.ts`의 **순수 함수 `computeEdgeScrollSpeed`만 재사용**(edge 인자
  40 전달). 같은 파일의 `bindVerticalDragAutoScroll`은 HTML5 DnD(dragover) 전용이라
  mousemove 기반 시간표 드래그에 부적합 — 스크롤 구동은 훅에서 마지막 clientY를 저장해
  16ms 루프로 직접 가산한다.
- **드롭 안착**: overshoot 스프링(0.45s cubic-bezier(0.34,1.56,0.64,1)) + 보더 플래시 1회.
  `widget-settling`/`settleFlash` 어휘 재사용.
- **저장**: 기존 `updateEvent(eventId, {startDate,endDate,startTime,endTime}, identity)`
  낙관 경로 그대로. `isReadOnly` 블록은 드래그·리사이즈 핸들 미부착, 클릭만.
- **키보드 셋**: `T`=오늘, `W`/`M`=주/월 전환, `←→`=기간 이동, `C`=새 일정, `Esc`=닫기/
  취소, `?`=단축키 도움말 오버레이. input/textarea/select 포커스 중·모달 열림 중 비활성
  (기존 keydown 가드 패턴 준수).
- **Realtime 하이라이트**: realtime 무효화 신호는 eventType만 오므로(계약 변경 금지),
  **정본 재조회 전후 스냅샷을 `calendarEventDiff.ts`(identity 기준 순수 함수)로 비교**해
  변경/신규 이벤트에 2초 컬러 링 펄스. 내 자신의 낙관 변경(뮤테이션 토큰 진행 중)은 제외.

## D12. T0 동반 개선 (PR-B 포함)

- **뷰 기억**: `bflow_calendar_view_v1` localStorage 키에 `{ viewMode, weekSubMode }` 저장,
  캘린더 진입 시 복원. (기존 `bflow_calendar_*` 키 패턴·explicit 저장 관례 준수)
- **G1 연도 경계**: 주간·오늘 보기의 연도 클램프 제거 — 날짜 기준 네비게이션으로 교체
  (12/31 → 1/1 이동 가능). generateYearWeeks 의존 로직은 연도 전환 시 재생성.
- **G2 통계**: "이번 달 N개" = `startDate ≤ 월말 && endDate ≥ 월초` 겹침 판정으로 수정.
- **G3 주간 +N**: WeekScrollView 바 스트립 5개 초과 시 "+N" 필 표시(DayScrollView와 동일
  패턴). 클릭 시 해당 주 첫날의 OverflowPopup 또는 카드 리스트 스크롤(간단한 쪽 선택).
- **reduced-motion**: `useMotionPref`를 `src/hooks/useMotionPref.ts`로 승격(기존 my-tasks
  경로는 재export로 호환 유지). 시간표·캘린더의 framer 모션 전부에 reduce 가드.

## D13. 폴리싱·모션 (PR-D)

- G4: 미니캘린더 클릭 = **해당 날짜로 이동**(생성은 셀/버튼 경로로 충분). week(카드·시간표)
  ·today 사이드바에도 미니캘린더 표시(주간은 현재 주 하이라이트 — 기존 `activeWeekStart`
  prop 활용). 기존 WeekSidebar/DaySidebar는 미니캘린더 아래로 이동 배치.
- G5: EventQuickEdit를 주간(카드·시간표)·오늘 보기 카드/블록 우클릭에도 연결. 퀵에디트
  "일정 편집" 탭에 시각(time) 입력 추가(캐노니컬 bflow + 편집 가능 구글만 — 기존
  supportsTimeEditing 규칙).
- G7 모음: QuickEdit exit 부활 — **EventQuickEdit 내부의 자체 AnimatePresence 래퍼를
  제거**하고 ScheduleView 쪽 조건부 렌더를 AnimatePresence로 감싼다(중첩 Presence는 exit가
  전파되지 않음, framer-motion 10.x — 동작하는 EventSidePanel 배선 구조와 동일하게) /
  툴팁 200ms fade+scale 등장 / 칩 hover `transition-all` → `transform,filter` 한정 /
  EventCreateModal 백드롭에 `bg-black` + opacity 0.16 통일 / 월 그리드 빈 상태·'오늘' 펄스
  전 뷰 적용(펄스는 Week/DayScrollView에 pulseDate prop을 새로 내려 렌더 — 분기 제거만으로는
  무동작) / **태그 칩 토글 스프링 pop + 필터 결과 컨테이너 120ms fade** / **기간 이동 연타
  시(300ms 내 재입력) 전환 애니메이션 스킵**.
- **G9 정리**(maxVisibleBars 죽은 분기 + stale 주석)는 월 점 라인 전환 커밋에 동반한다 —
  점 라인 작업이 다음 라운드로 이관되면 G9도 함께 이관됨을 명시.
- 주간 헤더 라벨: `2026년 8월 · 35주차 · 8.23 – 8.29` 형식으로 보강(일요일 시작 주 범위 —
  week[0]~week[6], 주차 값은 기존 주간 사이드바/카드와 동일 계산 사용).
- **월 그리드 점 라인 전환(시안 §04)**: 시각 일정 = 점+시각 라인(22px), 종일/기간 = 바.
  필수 조건 — ① 점 라인에도 mousedown 드래그(일 단위 이동) 유지 ② `layoutEventBars`
  입력은 종일/기간만으로 좁힘 ③ 칸 한도 = 바 행 + 점 라인 별도 한도 2계층 + 통합 "+N"
  ④ 별도 커밋으로 분리, 회귀 시 이 커밋만 되돌릴 수 있게. 구현 중 체급이 커지면 중단하고
  한솔에게 보고(다음 라운드 이관 옵션).

## D14. 외부 캘린더 ICS 구독 (Q5=A, PR-E)

- **범위**: 주소(ICS URL) 구독 = **읽기 전용 + 나만 보기**(구독 목록은 각자 PC 로컬 저장,
  Supabase 미저장). "팀원 개인 일정 서로 보기"(E2)는 비범위 — 별도 라운드.
- **저장**: `path.join(app.getPath('userData'), 'ics-subscriptions.json')` — 기존 관례
  (portable 빌드 대응으로 userData 고정, main.ts·fontIpc 선례). 스키마
  `{ id, name, url, color, enabled, lastFetchedAt }[]`. 메인 프로세스 소유.
  **`electron/icsSubscriptions.ts`에는 'electron' top-level import 금지**(node --test 직접
  import 대상 — 기존 electron측 테스트 모듈 관례). 저장 경로(dataDir)와 fetch 함수는
  main.ts에서 주입(DI)하고, `net.fetch`를 쓰려면 main.ts 쪽에만 둔다(Node `https`면 파일 내
  구현 가능).
- **파서**: `node-ical` 의존성 추가(메인 프로세스 전용). RRULE 반복은 **과거 1개월 ~ 미래
  6개월 창으로 전개**해 인스턴스화. 구독당 전개 후 상한 500건(초과 시 미래 우선 + 경고 1회).
- **시간대**: TZID/UTC → KST 변환 통일(기존 `+09:00` 전제). 종일(VALUE=DATE)은 exclusive
  종료 → inclusive 변환(구글 경로와 동일 규칙).
- **fetch**: 앱 시작 + 30분 주기 + 레일 수동 새로고침 버튼. 실패 시 마지막 캐시 유지 +
  레일에 경고 아이콘(마지막 성공 시각 툴팁). http(s) URL만 허용, `webcal://`은 https로 치환.
  **주기 갱신 완료 시 메인→렌더러 push 신호(`ics:changed`, 기존 캘린더 창 fanout 관례
  재사용)**를 보내고, 렌더러는 수신 시 `ics:events` 재조회 → 병합 캐시 갱신.
- **IPC**: `ics:list / ics:add / ics:update / ics:remove / ics:refresh / ics:events` —
  기존 calendarApiContract 패턴대로 `src/shared/`에 계약 타입 정의, preload 경유.
- **표시**: `CalendarEvent`로 매핑 — `source: 'ics'` 신설, `sourceCalendarId: 'ics:<id>'`,
  `isReadOnly: true`, 색 = 구독 색(EVENT_COLORS에서 선택, 기본 #8B8DA3). 레일에 **"구독"
  섹션**(내 구글 아래): 색 체크 토글 + ⋯ 메뉴(이름/색 변경 · 새로고침 · 삭제) + "+ 주소로
  구독" 버튼(URL 붙여넣기 + 이름 + 색 선택 미니 폼, URL 검증 실패 시 인라인 오류).
  월/카드/시간표 전 표면에서 일반 읽기 전용 일정과 동일 취급(필터: 구글 토글과 동일하게
  구독별 visibleCalendarIds 키 `ics:<id>` 사용).
- **캐시 격리(중요)**: ics 이벤트는 calendarService의 bflowEvents/googleEvents 캐시 **밖**
  별도 배열로 유지하고 `getEvents()` 출력 시점에만 병합한다 — 뮤테이션·구글 새로고침
  경로(replaceConfirmedGoogleCalendar 등)에 절대 유입 금지. `CalendarCacheSource`에 'ics'를
  추가하되 `mutateSourceEvents`·`inferExistingEventSource`는 ics를 별도 분기로 처리한다
  (읽기 전용이므로 뮤테이션 진입 시 throw 권장). **typecheck가 못 잡는 런타임 폴백 2곳** —
  `inferExistingEventSource`의 `sourceCalendarId → 'google'` 폴백(ics가 구글로 오분류될
  지점)과 EventSidePanel의 소스 라벨 문자열 폴백 — 에 `ics:` prefix 명시 가드를 추가한다.
- **프리뷰 모드**: devElectronAPI에 mock 구독 1건 + 일정 3건 seed.

## D15. 진행 방식 (Q3=A, Q4=A)

| PR | 브랜치 | 내용 | 버전 |
|---|---|---|---|
| PR-A | `claude/calendar-pr4-notify` | 1차 플랜 Chunk 4 그대로 실행(알림·teamCalendarId 제거·문서 마감) | v1.106.0 |
| PR-B | `claude/calendar-tg1-view` | 시간표 본체 + T0(D12) — 서브 토글 방식이라 viewMode 분기 리팩터링은 불필요(YAGNI) | v1.107.0 |
| PR-C | `claude/calendar-tg2-interact` | 시간표 인터랙션 + 키보드 + Realtime 하이라이트 + G8 | v1.108.0 |
| PR-D | `claude/calendar-tg3-polish` | 폴리싱·모션(D13) — 월 점 라인은 별도 커밋 | v1.109.0 |
| PR-E | `claude/calendar-tg4-ics` | ICS 구독(D14) | v1.110.0 |

- 순서 고정: A → B → C → D → E (각각 최신 main에서 분기). 각 PR: typecheck + 관련 테스트 +
  build:vite + 코덱스 리뷰 클린 → **머지는 한솔 확인 후**. G드라이브 배포는 별도 지시.
- update-notes·PR "업데이트 요약"은 비개발자 톤 룰(CLAUDE.md) 준수.
- CalendarWidget(대시보드 위젯)은 코드 통합 비범위 — 데이터만 자동 반영(1차 D4 유지).
- KST 하드코딩 전제 유지. RLS는 기존 allow_all 관례(앱 레벨 강제) 유지.
