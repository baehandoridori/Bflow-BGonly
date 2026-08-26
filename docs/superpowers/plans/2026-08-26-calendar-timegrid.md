# 캘린더 2차 개편 구현 플랜 — 시간표·폴리싱·ICS 구독

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents
> available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** 주간 시간표(타임그리드) 보기 신설 + 캘린더 보완/폴리싱 + 외부 캘린더 ICS 구독을
PR-A~PR-E 5개로 나눠 구현한다.

**Architecture:** 확정 설계서 `docs/superpowers/specs/2026-08-26-calendar-timegrid-design.md`
(D8~D15)가 SSOT. 시간표는 기존 `week` 뷰 모드 안의 하위 상태(weekSubMode)로 얹으므로
ScheduleView의 viewMode 분기 구조는 건드리지 않는다. 배치·스냅·diff는 순수 함수로 분리해
node --test로 검증하고, 뷰·훅은 기존 캘린더 관례(낙관 저장 경로·identity·글라스 스타일·
TRANSITION [0.16,1,0.3,1])를 재사용한다.

**Tech Stack:** Electron + React 18 + TS + Tailwind + framer-motion + Supabase(기존 경로만) +
node-ical(PR-E 신규, 메인 프로세스 전용).

---

## Chunk 0: 공통 컨텍스트 (모든 PR 세션이 먼저 읽을 것)

### 0.1 필수 문서 (읽는 순서)
1. `CLAUDE.md` — 필수 규칙(빌드 검증·낙관 패턴·IPC 구조·update-notes 톤)
2. `docs/superpowers/specs/2026-08-26-calendar-timegrid-design.md` — **확정 설계 SSOT (D8~D15)**
3. 시안 원본 `docs/superpowers/specs/mockups/2026-08-26-calendar-timegrid/proposal.html`
   (브라우저로 열어 §02 시간표·§03 데모·§04 월 보기를 눈으로 확인)
4. `docs/superpowers/specs/2026-08-26-calendar-timegrid-polish-proposal.md` — 배경/근거 (G1~G10 표)
5. `tasks/lessons.md` — 과거 실수 패턴

### 0.2 파일 지도 (생성/수정)

| PR | 생성 | 주요 수정 |
|---|---|---|
| A | (1차 플랜 Chunk 4 참조) | electron/realtime.ts, src/stores/useNotificationStore.ts 등 |
| B | `src/utils/timeGridLayout.ts`, `tests/timeGridLayout.test.ts`, `src/components/calendar/WeekTimeGridView.tsx`, `src/hooks/useMotionPref.ts` | `src/views/ScheduleView.tsx`(서브 토글·기억·G1·G2), `src/components/calendar/WeekScrollView.tsx`(G3) |
| C | `src/hooks/useTimeGridDnD.ts`, `src/utils/calendarEventDiff.ts`, `tests/calendarEventDiff.test.ts`, `src/components/calendar/ShortcutHelpOverlay.tsx` | WeekTimeGridView, EventCreateModal(시각 프리필), ScheduleView(키보드), useCalendarDnD(Esc·쓰로틀) |
| D | — | MiniCalendar·WeekSidebar·DaySidebar 배치, EventQuickEdit(전 뷰+시각), CalendarGrid(툴팁·hover·점 라인), EventCreateModal(백드롭), ScheduleView(헤더 라벨) |
| E | `electron/icsSubscriptions.ts`, `tests/icsSubscriptions.test.ts`, `src/shared/icsApiContract.ts`, `src/components/calendar/IcsSubscribeForm.tsx` | electron/main.ts·preload.ts, CalendarRail(구독 섹션), calendarService(병합), devElectronAPI(seed) |

### 0.3 공통 규칙 (전 PR)
- **줄 번호는 참고값**: 이 플랜의 파일:줄은 2026-08-26(main=ab72175) 기준. 수정 전 반드시
  grep으로 현재 위치 재확인. 기존 함수·상태 이름이 플랜과 다르면 **기존 이름을 따르고
  로직만 이식**한다.
- **검증 게이트(각 Task 마무리마다)**: `npm run typecheck` → 관련 테스트(`npm run
  test:calendar` 존재 시 + 신규 테스트) → PR 마무리 Task에서 `npm run build:vite`.
- **낙관 패턴/IPC**: 데이터 변경은 기존 calendarService 경로만 사용. 렌더러에서 Supabase
  직접 호출 금지. 신규 IPC는 기존 calendarApiContract 패턴(공유 타입 → preload → 메인 핸들러).
- **모션**: easing `[0.16,1,0.3,1]`, hover 100~150ms/진입 150~250ms/전환 250~400ms.
  framer 모션은 전부 `useMotionPref().reduce` 가드. 무한 애니는 CSS + reduce 가드 + 정적
  대체. exit 과잉 금지, blur ≤ 2px, italic 금지.
- **update-notes/PR 요약**: 비개발자 톤(CLAUDE.md 룰 — 식별자·기술용어 금지, 상황→영향→결과).
  PR 생성은 pr-creator 스킬, 리뷰는 codex-review-loop 스킬(P1~P3 반영, 명시적 클린 신호까지).
- **버전**: package.json + package-lock.json(3자 일치) — PR-A=1.106.0, B=1.107.0, C=1.108.0,
  D=1.109.0, E=1.110.0. `DEVLOG/update-notes.json`에 항목 추가.
- **머지·배포 게이트**: 코덱스 클린 후 **한솔 확인 → 머지**. G드라이브 배포는 별도 지시.
- **프리뷰 검증**: dev mode `?preview=1`, mock '배한솔'/pw '1234' (vite-preview, 포트 5190).

### 0.4 PR 순서와 의존성
A → B → C → D → E 순차. 각 PR은 직전 PR 머지 후 최신 `origin/main`에서 분기한다.
C는 B의 WeekTimeGridView·timeGridLayout에, D는 B·C 산출물에 의존. E는 독립성이 높지만
레일 UI(PR-B 이후 상태)를 수정하므로 순서를 지킨다.

---

## Chunk 1: PR-A — 알림·실시간·마감 (브랜치 claude/calendar-pr4-notify, v1.106.0)

**이 PR은 새 명세를 쓰지 않는다.** 1차 플랜의 Chunk 4가 완전한 태스크 명세(Task 4.1~4.7)로
이미 존재하므로 그대로 실행한다:

- [ ] **Step 1: 1차 플랜 열기** — `docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md`
  의 **Chunk 4** (Task 4.1~4.7)를 읽고 그 절차를 그대로 따른다.
- [ ] **Step 2: 선행 반영분 델타 확인** — Chunk 4 작성 시점 이후 PR2·PR3 리뷰 루프에서
  일부가 당겨 구현됐다. Chunk 4의 Step 0-2 현황 확인 시 다음을 기대하라:
  - `electron/realtime.ts` — calendars/members/events/tags **4테이블 구독은 이미 존재**.
    Task 4.3에서는 `calendar_notifications` 구독 추가와 뮤트 라우팅만 실제 신규다.
  - `src/App.tsx` SHARED_BFLOW_CALENDAR_TABLES — 캘린더 4테이블 제외는 이미 존재.
    `private_calendar_events` 추가 여부만 확인해 반영한다(플랜 §2-4 G6·제안서 §9-1 참조).
  - Chunk 4 자체에 "없으면 추가" 분기·grep 재확인 지침이 내장돼 있으므로 그 지침이 우선.
- [ ] **Step 3: 버전** — Chunk 4의 마무리 Task에서 버전은 **v1.106.0**으로 한다(1차 플랜에
  적힌 예정 버전과 다르면 이쪽을 따른다).

---

## Chunk 2: PR-B — 시간표 본체 + T0 (브랜치 claude/calendar-tg1-view, v1.107.0)

> 설계 근거: D8~D10, D12. 시안 §02가 시각 기준.

### Task B.1: 브랜치 + 순수 유틸 timeGridLayout (TDD)

**Files:**
- Create: `src/utils/timeGridLayout.ts`, `tests/timeGridLayout.test.ts`
- Modify: `package.json` — `test:calendar` 스크립트에 `./tests/timeGridLayout.test.ts` 추가
  (이 레포의 test:* 는 glob이 아니라 **명시 열거**라 등록하지 않으면 게이트에서 영영 안 돈다)

- [ ] **Step 1: 브랜치** — `git fetch origin && git checkout -b claude/calendar-tg1-view origin/main`
- [ ] **Step 2: 실패하는 테스트 작성** — `tests/timeGridLayout.test.ts`. 이 레포의 테스트는
  Node 네이티브 type-stripping으로 실행되므로 **import는 상대 경로 + `.ts` 확장자 필수**
  (@/ alias 금지 — 기존 tests/*.test.ts 전부가 이 규칙, 1차 플랜 Task 4.1과 동일).

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapMinutes, timeToMinutes, minutesToTime, layoutDayBlocks,
} from '../src/utils/timeGridLayout.ts';

test('snapMinutes: 15분 단위 반올림 + 0~1440 클램프', () => {
  assert.equal(snapMinutes(0), 0);
  assert.equal(snapMinutes(7), 0);
  assert.equal(snapMinutes(8), 15);
  assert.equal(snapMinutes(23), 30);
  assert.equal(snapMinutes(-10), 0);
  assert.equal(snapMinutes(1500), 1440);
});

test('timeToMinutes/minutesToTime 왕복', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(minutesToTime(570), '09:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(timeToMinutes('24:00'), 1440); // 방어적 허용
});

test('layoutDayBlocks: 겹치지 않으면 각자 전체 폭', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 600, endMin: 660 }, // 경계 접촉은 겹침 아님
  ]);
  assert.deepEqual(out.map(o => [o.id, o.col, o.span, o.cols]),
    [['a', 0, 1, 1], ['b', 0, 1, 1]]);
});

test('layoutDayBlocks: 2개 겹침 = 반씩', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 840, endMin: 900 },
    { id: 'b', startMin: 870, endMin: 930 },
  ]);
  const a = out.find(o => o.id === 'a')!, b = out.find(o => o.id === 'b')!;
  assert.equal(a.cols, 2); assert.equal(b.cols, 2);
  assert.notEqual(a.col, b.col);
});

test('layoutDayBlocks: 사슬 겹침은 한 클러스터(a-b 겹침, b-c 겹침, a-c 비겹침)', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 570, endMin: 660 },
    { id: 'c', startMin: 630, endMin: 690 },
  ]);
  assert.ok(out.every(o => o.cols === 2));
  // c는 a와 겹치지 않으므로 a의 컬럼(0)을 재사용
  assert.equal(out.find(o => o.id === 'c')!.col, 0);
});

test('layoutDayBlocks: 우측 빈 컬럼 확장', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 720 },  // 09~12
    { id: 'b', startMin: 540, endMin: 600 },  // 09~10 (col 1)
    { id: 'c', startMin: 540, endMin: 600 },  // 09~10 (col 2)
  ]);
  const a = out.find(o => o.id === 'a')!;
  assert.equal(a.cols, 3);
  assert.equal(a.span, 1); // a는 10시 이후에도 b/c 자리가 '비어 보이지만' 클러스터 폭은 유지
  // 확장 규칙: 자기 오른쪽 컬럼에 시간이 겹치는 블록이 하나도 없을 때만 span 확대
  const out2 = layoutDayBlocks([
    { id: 'x', startMin: 540, endMin: 600 },
    { id: 'y', startMin: 570, endMin: 630 },
    { id: 'z', startMin: 700, endMin: 760 },
  ]);
  assert.equal(out2.find(o => o.id === 'z')!.cols, 1); // z는 별도 클러스터
});

test('layoutDayBlocks: 동시 시작은 긴 블록이 왼쪽', () => {
  const out = layoutDayBlocks([
    { id: 'short', startMin: 540, endMin: 570 },
    { id: 'long', startMin: 540, endMin: 660 },
  ]);
  assert.equal(out.find(o => o.id === 'long')!.col, 0);
});
```

- [ ] **Step 3: 실행해 실패 확인** — `node --test tests/timeGridLayout.test.ts`
  기대: FAIL (모듈 없음)
- [ ] **Step 4: 구현** — `src/utils/timeGridLayout.ts` (기준 구현 — UI 의존성 0):

```ts
/** 주간 시간표 배치·스냅 순수 유틸. UI/DOM 의존성 없음 (node --test 대상). */
export const SNAP_MINUTES = 15;

export function snapMinutes(min: number, step: number = SNAP_MINUTES): number {
  const snapped = Math.round(min / step) * step;
  return Math.max(0, Math.min(24 * 60, snapped));
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, min));
  const h = Math.floor(clamped / 60) % 24;
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface TimeBlockInput { id: string; startMin: number; endMin: number }
export interface TimeBlockLayout extends TimeBlockInput {
  col: number;   // 0-base 컬럼
  span: number;  // 차지 컬럼 수 (우측 확장 반영)
  cols: number;  // 클러스터 총 컬럼 수
}

const overlaps = (a: TimeBlockInput, b: TimeBlockInput) =>
  a.startMin < b.endMin && b.startMin < a.endMin;

/** 충돌 클러스터 균등 분할 + 우측 빈 컬럼 확장 (D10) */
export function layoutDayBlocks(blocks: TimeBlockInput[]): TimeBlockLayout[] {
  const sorted = [...blocks].sort((a, b) =>
    a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin) || a.id.localeCompare(b.id));

  // 1) 클러스터 분할: 진행 중 최대 endMin 이전에 시작하면 같은 클러스터
  const clusters: TimeBlockInput[][] = [];
  let current: TimeBlockInput[] = [];
  let maxEnd = -1;
  for (const b of sorted) {
    if (current.length > 0 && b.startMin >= maxEnd) {
      clusters.push(current);
      current = [];
      maxEnd = -1;
    }
    current.push(b);
    maxEnd = Math.max(maxEnd, b.endMin);
  }
  if (current.length > 0) clusters.push(current);

  // 2) 클러스터 내 그리디 컬럼 배정 + 3) 우측 확장
  const out: TimeBlockLayout[] = [];
  for (const cluster of clusters) {
    const colEnd: number[] = []; // 컬럼별 마지막 endMin
    const placed: Array<TimeBlockInput & { col: number }> = [];
    for (const b of cluster) {
      let col = colEnd.findIndex(end => end <= b.startMin);
      if (col === -1) { col = colEnd.length; colEnd.push(0); }
      colEnd[col] = b.endMin;
      placed.push({ ...b, col });
    }
    const cols = colEnd.length;
    for (const p of placed) {
      let span = 1;
      while (p.col + span < cols) {
        const nextCol = p.col + span;
        const blocked = placed.some(q => q.col === nextCol && overlaps(p, q));
        if (blocked) break;
        span += 1;
      }
      out.push({ id: p.id, startMin: p.startMin, endMin: p.endMin, col: p.col, span, cols });
    }
  }
  return out;
}
```

- [ ] **Step 5: 테스트 통과 확인** — `node --test tests/timeGridLayout.test.ts` 기대: PASS
  (기준 구현과 테스트가 어긋나면 **설계 의도(D10) 쪽으로 테스트를 고정**하고 구현을 수정)
- [ ] **Step 6: 게이트 등록** — package.json `test:calendar`에 `./tests/timeGridLayout.test.ts`
  추가 후 `npm run test:calendar`가 신규 파일 포함해 PASS하는지 확인.
- [ ] **Step 7: 커밋** — `git add -A && git commit -m "시간표 배치·스냅 순수 유틸 추가 (TDD)"`

### Task B.2: useMotionPref 공용 승격

**Files:**
- Create: `src/hooks/useMotionPref.ts`
- Modify: `src/components/widgets/my-tasks/useMotion.ts` (재export로 전환)

- [ ] **Step 1: 현황 확인** — `grep -rn "useMotionPref" src/ | head`. 기대: my-tasks 정의 1곳
  + 소비 1곳.
- [ ] **Step 2: 이동** — 기존 `useMotion.ts`의 구현을 `src/hooks/useMotionPref.ts`로 옮기고,
  원 파일은 `export { useMotionPref } from '@/hooks/useMotionPref';` 재export만 남긴다
  (기존 임포트 호환 유지).
- [ ] **Step 3: 게이트** — `npm run typecheck` PASS 확인 후 커밋
  `"useMotionPref 훅을 공용 위치로 승격"`

### Task B.3: WeekTimeGridView 본체

**Files:**
- Create: `src/components/calendar/WeekTimeGridView.tsx`
- Reference: 시안 §02(구성), D9·D10(규칙), `WeekScrollView.tsx`(주 데이터 흐름·이벤트 필터),
  `CalendarGrid.tsx`(layoutEventBars·글라스 칩·툴팁), `CalendarView.tsx` EventGanttChart의
  "오늘 자동 스크롤" 패턴

- [ ] **Step 1: props 계약 정의** — 참고: WeekScrollView(default export)의 실제 props는
  `currentMonth·currentYear·events·today·onEventClick·onDateClick?·activeWeekIndex·
  onWeekChange·mode?`이며 주 배열 prop과 onEventContextMenu는 **없다**(우클릭은 현재
  CalendarGrid에만 배선 — 주간 연결은 PR-D Task D.2). 기준 인터페이스:

```ts
interface WeekTimeGridViewProps {
  weekDays: Date[];                    // 활성 주 7일 — 일요일 시작(D9).
                                       // ScheduleView가 이미 가진 generateYearWeeks(year)[activeWeekIndex]를 그대로 전달
  events: CalendarEvent[];             // 필터 적용 후
  today: string;
  onEventClick: (ev: CalendarEvent) => void;            // 기존 handleEventClick과 동일 형태
  onEventContextMenu: (ev: CalendarEvent, e: React.MouseEvent) => void; // CalendarGrid와 동일 시그니처
                                       // — ScheduleView의 기존 handleEventContextMenu를 연결
  onSlotClick: (date: string, startTime: string, endTime: string) => void; // 클릭=30분
  onWeekChange: (nextIndex: number) => void;            // Shift+휠·헤더 화살표용
  // PR-C에서 드래그 콜백 추가 예정 — 이번 PR에서는 클릭 경로만
}
```

- [ ] **Step 2: 렌더 구현** — 구조(위→아래): 요일 헤더(sticky) → 종일 레인 → 새벽 접힘 밴드
  → 시간 그리드(스크롤 영역) → 저녁 접힘 밴드. 규칙은 D9·D10 그대로:
  - 종일 레인 귀속: `ev.allDay !== false || ev.startDate !== ev.endDate` (멀티데이 timed 강등
    포함). 바 배치는 `layoutEventBars`를 CalendarGrid에서 import(기존 export 여부 grep —
    비공개면 export 추가). 최대 2행 + "+N개" 토글(로컬 state).
  - 시간 블록: 컬럼별 `layoutDayBlocks(...)` 결과로 `top = (startMin - visibleStartMin) /
    60 * HOUR_PX`, `height = max(duration/60*HOUR_PX, 14px)`, `left/width = col/span/cols`
    백분율. `HOUR_PX = 56` 상수. 블록은 `<button type="button">` + aria-label(D10 접근성).
  - 접힘 밴드: 기본 [0,540)·[1140,1440) 접힘. **해당 구간에 블록이 있으면 그 구간 자동
    펼침**(useMemo로 판정). 클릭 토글, 상태는 컴포넌트 state(비영속).
  - 현재 시각 라인: 1분 setInterval(cleanup 필수). 오늘 컬럼 강조선+점+거터 칩, 타 컬럼
    옅은 선. 지난 블록 opacity 0.5, 진행 중 블록 컬러 링(D9).
  - 진입 시 자동 스크롤: 오늘 포함 주면 now-90분 위치로, 아니면 09:00으로. `requestAnimationFrame`
    1회 (프리뷰 인앱 브라우저에서 rAF 미발화 이슈가 있으므로 setTimeout(0) 폴백 병행 —
    lessons 참조).
  - 휠: 컨테이너 기본 세로 스크롤에 맡기고 **주 이동 휠 핸들러를 붙이지 않는다**(D9).
    Shift+휠만 preventDefault 후 주 이동 콜백.
  - 모션: 마운트 시 블록 1회 stagger(`clampStaggerDelay` 재사용 — my-tasks
    motionUtils에서 import, 필요시 공용 승격은 하지 않고 직접 import 경로 확인),
    `useMotionPref().reduce` 가드.
- [ ] **Step 3: 프리뷰 실측** — `?preview=1`로 열어 시안 §02와 대조: 종일 레인 강등·겹침
  나란히·현재 시각 라인·접힘 밴드·자동 스크롤·클릭 생성(30분 프리필)이 동작하는지 확인.
- [ ] **Step 4: 게이트 + 커밋** — typecheck PASS 후 `"주간 시간표 보기 본체 추가"`

### Task B.4: ScheduleView 통합 — [카드|시간표] 서브 토글 + 뷰 기억

**Files:**
- Modify: `src/views/ScheduleView.tsx` (viewMode state 부근 :87, 세그먼트 토글 :877-892,
  본체 JSX 분기 :939-1001 — **grep 재확인**)

- [ ] **Step 1: 상태 추가** —
  `const [weekSubMode, setWeekSubMode] = useState<'card' | 'timegrid'>(복원값 ?? 'card');`
  복원/저장 키 `bflow_calendar_view_v1` = `JSON.stringify({ viewMode, weekSubMode })`.
  viewMode 초기값도 이 키에서 복원(파싱 실패·미존재 시 'month'). 저장은 두 상태 변경
  useEffect에서. localStorage 접근은 try/catch(기존 useCalendarStore 관례).
- [ ] **Step 2: 서브 토글 UI** — 세그먼트 그룹 오른쪽에 `viewMode === 'week'`일 때만
  [카드|시간표] 미니 토글(시안 §02 배지 9 스타일 — accent 보더). aria-pressed 부여.
- [ ] **Step 3: 본체 분기** — week 분기에서 `weekSubMode === 'timegrid'`면 WeekTimeGridView,
  아니면 기존 WeekScrollView. AnimatePresence 전환 key에 weekSubMode 포함(기존 fade 재사용).
  `onSlotClick` → 기존 EventCreateModal 오픈 경로에 시각 전달(이번 PR에서는 initialDate만
  연결하고 시각 프리필 props는 PR-C에서 추가 — 클릭 생성은 종일로 열려도 OK, PR-C에서 완성).
- [ ] **Step 4: 프리뷰 실측** — 토글 전환·기억(새로고침 후 복원)·기존 카드 모드 회귀 없음 확인.
- [ ] **Step 5: 게이트 + 커밋** — `"주 보기에 카드·시간표 전환 스위치와 마지막 보기 기억 추가"`

### Task B.5: T0 버그 수정 3종 (G1·G2·G3)

**Files:**
- Modify: `src/views/ScheduleView.tsx`(G1: goToPrev/goToNext/키보드의 연도 클램프 :305-329,
  :477-564 / G2: 통계 :917-926), `src/components/calendar/WeekScrollView.tsx`(G3: :319 부근)

- [ ] **Step 1(G1)**: 주간·오늘 네비를 연도 클램프 대신 **날짜 기준**으로 교체 — 인덱스가
  범위를 벗어나면 year±1로 전환하고 generateYearWeeks/day-of-year 인덱스를 새 연도 기준으로
  재계산. 프리뷰에서 12/31↔1/1 왕복 확인(시스템 날짜 조작 대신 네비 연타로 연말까지 이동).
- [ ] **Step 2(G2)**: "이번 달 N개" 필터를 `ev.startDate <= 월말 && ev.endDate >= 월초`로 교체.
- [ ] **Step 3(G3)**: 바 스트립 `slice(0, 5)` 유지 + 초과 시 `+N` 필(DayScrollView :371-382
  패턴 복제). 클릭 시 해당 주 카드 리스트로 스크롤(간단 구현).
- [ ] **Step 4: 게이트 + 커밋** — 항목별 개별 커밋 3개(한글 메시지).

### Task B.6: 마무리 — 게이트·update-notes·버전·PR·코덱스

- [ ] **Step 1**: `npm run typecheck` + 전체 관련 테스트 + `npm run build:vite` 모두 PASS.
- [ ] **Step 2**: `tests/calendarSharedUi.test.ts`가 ScheduleView 렌더를 검증하므로 깨짐 여부
  확인, 서브 토글 관련 시나리오 1개 추가.
- [ ] **Step 3**: 버전 1.107.0(3자 일치) + `DEVLOG/update-notes.json` 항목(비개발자 톤 —
  예: "주간 보기에 구글 캘린더처럼 시간대별로 일정이 보이는 '시간표' 방식이 생겼어요.
  오른쪽 위 스위치로 카드와 시간표를 오갈 수 있고, 마지막 선택을 기억해요").
- [ ] **Step 4**: pr-creator 스킬로 PR 생성 → codex-review-loop 스킬로 리뷰 클린까지 →
  **한솔에게 머지 확인 요청 후 대기**.

---

## Chunk 3: PR-C — 시간표 인터랙션 (브랜치 claude/calendar-tg2-interact, v1.108.0)

> 설계 근거: D11. PR-B 머지 후 최신 main에서 분기.

### Task C.1: calendarEventDiff 순수 함수 (TDD)

**Files:**
- Create: `src/utils/calendarEventDiff.ts`, `tests/calendarEventDiff.test.ts`
- Modify: `package.json` — `test:calendar`에 `./tests/calendarEventDiff.test.ts` 추가

- [ ] **Step 1: 실패 테스트** — (import는 상대 경로 + `.ts` 확장자 — B.1 규칙 동일)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventSnapshot, diffEventSnapshots } from '../src/utils/calendarEventDiff.ts';

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: '회의', startDate: '2026-08-26', endDate: '2026-08-26',
  startTime: '14:00', endTime: '15:00', allDay: false,
  calendarId: 'cal-1', tagId: null, source: 'bflow', sourceCalendarId: 'bflow:cal-1',
  ...over,
});

test('변경 없음 → added/changed 모두 빈 배열', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});

test('시각 변경 → changed에 identity 키', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1', { startTime: '15:00', endTime: '16:00' })] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.changed.length, 1);
  assert.equal(d.added.length, 0);
});

test('신규 이벤트 → added', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.added.length, 1);
});

test('삭제는 무시(하이라이트 대상 아님)', () => {
  const a = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현** — identity 키는 기존
  `src/utils/calendarEventIdentity.ts`의 **`calendarEventIdentityKey`** 재사용.
  changeKey는 `[startDate,endDate,startTime??'',endTime??'',
  String(allDay??''),title,calendarId??'',tagId??''].join('|')`. Map<identityKey, changeKey>
  비교로 added/changed 산출.
- [ ] **Step 4: PASS 확인 + 게이트 등록(test:calendar에 추가) + 커밋** —
  `"실시간 변경 감지용 일정 스냅샷 비교 유틸 (TDD)"`

### Task C.2: useTimeGridDnD 훅 + WeekTimeGridView 연결

**Files:**
- Create: `src/hooks/useTimeGridDnD.ts`
- Modify: `src/components/calendar/WeekTimeGridView.tsx`

- [ ] **Step 1: 훅 설계** — `useCalendarDnD`(전역 리스너·pointer-block 스타일 주입·
  고스트용 preview 콜백)와 `useCalendarDragCreate`(16ms 쓰로틀·역방향 정렬) 패턴을 이식하되
  **2축(deltaDays + deltaMinutes)**으로 확장:
  - 모드: `'create' | 'move' | 'resize-end'` (상단 리사이즈는 범위 외 — D11은 하단만).
  - **클릭 vs 드래그 5px 임계**: 두 훅에는 없다 — `CalendarGrid.tsx` EventBarChip의
    mousedown 핸들러(THRESHOLD=5, grep THRESHOLD) 패턴을 이식해 블록 단순 클릭(상세
    열기)과 move 드래그를 구분한다(구분 없으면 클릭이 0-델타 저장으로 새는 회귀).
  - 좌표→시간: 컬럼 요소 `data-date` + `getBoundingClientRect()` 기준 y offset →
    `snapMinutes(pxToMinutes(...))` (timeGridLayout 유틸 사용).
  - **Esc 취소**: keydown 리스너로 드래그 상태 리셋(프리뷰 원복).
  - **자동 스크롤**: `src/utils/dragAutoScroll.ts`의 순수 함수 `computeEdgeScrollSpeed
    (pos, start, end, edge, max)`만 재사용(edge=40 전달, 음수=위로). 같은 파일의
    `bindVerticalDragAutoScroll`은 HTML5 DnD(dragover) 전용이라 **부적합 — 사용 금지**.
    구동은 훅의 mousemove에서 마지막 clientY를 저장해 setInterval 16ms 루프로 scrollTop 가산.
  - 완료 콜백: create → `(date, startTime, endTime)`, move/resize →
    `(eventId, identity, patch: {startDate,endDate,startTime,endTime})`.
- [ ] **Step 2: 뷰 연결** — 빈 슬롯 mousedown=create(고스트 블록 + 라이브 "HH:MM – HH:MM"),
  블록 본체=move(원위치 점선 고스트 + 이동 블록 scale 1.02·그림자 + 라벨 실시간 갱신),
  하단 8px=resize. `isReadOnly` 블록은 핸들 미부착. 저장은 ScheduleView의 기존
  `handleEventDragDone` 경로에 시각 patch를 추가 전달(updateEvent가 startTime/endTime을
  이미 받음 — grep으로 시그니처 확인).
- [ ] **Step 3: 안착 피드백** — 드롭 성공 시 해당 블록에 1회성 클래스(overshoot 0.45s
  `cubic-bezier(0.34,1.56,0.64,1)` + 보더 플래시). `widget-animations.css`의
  `.widget-settling`/`settleFlash` 키프레임 재사용 가능하면 재사용, 캘린더 전용이 필요하면
  `index.css`에 주석 달아 추가(관례). reduce 가드.
- [ ] **Step 4: 프리뷰 실측** — 생성/이동/리사이즈/Esc/자동 스크롤/스냅(15분)/최소 15분 확인.
- [ ] **Step 5: 게이트 + 커밋** — `"시간표 드래그 생성·이동·길이 조절 추가"`

### Task C.3: EventCreateModal 시각 프리필

**Files:**
- Modify: `src/components/calendar/EventCreateModal.tsx` (Props :20-26 부근)

- [ ] **Step 1**: `initialStartTime?: string; initialEndTime?: string` props 추가 — 제공 시
  `allDay=false` + 시각 초기값 세팅(기존 초기화 useEffect/useState 초기값 경로 grep).
- [ ] **Step 2**: ScheduleView의 슬롯 클릭/드래그 생성 완료 → 모달 오픈 경로에 시각 전달.
  클릭 단발 = 시작~+30분(D11).
- [ ] **Step 3**: 게이트 + 커밋 — `"일정 만들기 창에 시각 미리 채움 지원"`

### Task C.4: 키보드 셋 + 도움말 오버레이

**Files:**
- Create: `src/components/calendar/ShortcutHelpOverlay.tsx`
- Modify: `src/views/ScheduleView.tsx` keydown 핸들러(:477-564 — grep 재확인)

- [ ] **Step 1**: 기존 keydown 가드(입력 필드·모달 열림 시 무시) 안에 추가:
  `T`→goToToday, `W`→viewMode 'week', `M`→'month', `C`→생성 모달(포커스 날짜 또는 오늘),
  `?`(Shift+/)→도움말 오버레이 토글. ←→는 기존 동작 유지.
- [ ] **Step 2**: ShortcutHelpOverlay — 글라스 카드에 단축키 표(200ms fade+scale 진입,
  `char-modal-in` 어휘), Esc/재입력으로 닫기, reduce 가드.
- [ ] **Step 3**: 게이트 + 커밋 — `"캘린더 키보드 단축키와 도움말 안내 추가"`

### Task C.5: Realtime 변경 하이라이트

**Files:**
- Modify: `src/views/ScheduleView.tsx` (정본 재조회 수렴 지점 — `bflow:calendar-changed`
  수신 후 getEvents 반영 부분을 grep으로 특정), `WeekTimeGridView.tsx`·`CalendarGrid.tsx`

- [ ] **Step 1**: 재조회 전 스냅샷 → 반영 후 `diffEventSnapshots`로 added/changed 산출.
  **내 낙관 변경 제외**: 진행 중 뮤테이션이 있는 경우(드래그 직후 등) 해당 identity는
  하이라이트 대상에서 뺀다(간단히: 마지막 로컬 조작 identity를 ref로 기억해 3초간 제외).
- [ ] **Step 2**: 대상 identity 집합을 상태로 두고 2초 뒤 해제. 시간표 블록·월 그리드 바에
  해당 시 컬러 링 펄스 클래스(기존 pulseDate/글로우 어휘 재사용, reduce 가드).
- [ ] **Step 3**: 프리뷰 실측 — 창 2개(WidgetPopup 또는 두 인스턴스)로 한쪽에서 이동 →
  다른 쪽 펄스 확인. 불가 환경이면 mock 이벤트 디스패치로 검증.
- [ ] **Step 4**: 게이트 + 커밋 — `"다른 팀원의 일정 변경을 잠깐 빛나게 표시"`

### Task C.6: 기존 월간 DnD 개선 (G8)

- [ ] **Step 1**: `src/hooks/useCalendarDnD.ts` — mousemove 16ms 쓰로틀 추가(드래그 생성 훅과
  동일 패턴), Esc keydown으로 드래그 취소(프리뷰 원복·콜백 미발화).
- [ ] **Step 2**: 게이트 + 커밋 — `"월 보기 드래그에 Esc 취소와 부드러움 개선"`

### Task C.7: 마무리 — B.6과 동일 절차 (버전 1.108.0, update-notes, PR, 코덱스, 한솔 게이트)

---

## Chunk 4: PR-D — 폴리싱·모션 (브랜치 claude/calendar-tg3-polish, v1.109.0)

> 설계 근거: D13. 항목별 커밋 분리(회귀 시 개별 되돌림).

### Task D.1: 미니캘린더 = 이동 + 전 뷰 표시 (G4)
- [ ] MiniCalendar 클릭 콜백을 "날짜 이동"으로 교체(ScheduleView :809-812 — 월간은 해당 월
  포커스+펄스, 주간은 그 주로+서브모드 유지, 오늘 뷰는 그 날짜로). 생성 경로는 기존
  셀 클릭/+일정 버튼으로 충분.
- [ ] week(카드·시간표)·today 사이드바 상단에 MiniCalendar 추가(`activeWeekStart` prop으로
  현재 주 하이라이트 — prop이 이미 정의돼 있음), 기존 WeekSidebar/DaySidebar는 그 아래 유지.
- [ ] 프리뷰 실측 + 커밋 `"미니 달력 클릭을 날짜 이동으로 바꾸고 모든 보기에 표시"`

### Task D.2: 퀵에디트 확대 (G5)
- [ ] `onEventContextMenu`를 WeekScrollView/DayScrollView 카드·WeekTimeGridView 블록에 연결.
  시그니처는 CalendarGrid·WeekTimeGridView(PR-B 산출물)와 동일한
  `(ev: CalendarEvent, e: React.MouseEvent)` — preventDefault는 기존 handleEventContextMenu
  (ScheduleView :728 부근)가 수행. Week/DayScrollView 카드는 button에 onContextMenu 추가.
- [ ] EventQuickEdit "일정 편집" 탭에 시각 입력 추가 — EventSidePanel의 supportsTimeEditing
  규칙·시각 검증(역전 차단)을 그대로 이식.
- [ ] 커밋 `"우클릭 빠른 편집을 모든 보기로 확대하고 시각 수정 지원"`

### Task D.3: 모션 잔손질 (G7)
- [ ] QuickEdit exit 부활 — **2단계 필수**: ① EventQuickEdit.tsx 내부의 자체
  `<AnimatePresence>` 래퍼(:171·:371 부근)를 제거해 motion.div가 부모 presence 직계가
  되게 하고 ② ScheduleView :1046 `{quickEdit && ...}`를 `<AnimatePresence>`로 감싼다
  (동작 중인 EventSidePanel 배선 :1032-1043과 동일 구조). 중첩 Presence는 exit가 전파되지
  않아 ②만 하면 여전히 dead(framer 10.x). 프리뷰에서 닫힘 애니 실측 확인.
- [ ] 칩 툴팁(CalendarGrid :274-291 부근) 등장에 200ms fade+scale(framer 또는 CSS,
  reduce 가드).
- [ ] EventBarChip hover `transition-all` → `transition-[transform,filter]`(:219-221).
- [ ] EventCreateModal 백드롭에 `bg-black` 추가 + opacity 0.16(설정 모달과 통일 —
  현재는 배경색 유틸 자체가 없어 농도만 바꾸면 무효 수정).
- [ ] 태그 칩 토글에 스프링 pop(0.35s overshoot) + 필터 결과 컨테이너 120ms fade —
  TagBar, reduce 가드.
- [ ] 기간 이동 연타(300ms 내 재입력) 시 월/주 전환 애니메이션 스킵.
- [ ] 각 항목 개별 커밋.

### Task D.4: 헤더·빈 상태·펄스
- [ ] 주간 헤더 라벨 `2026년 8월 · 35주차 · 8.23 – 8.29` 형식(일요일 시작 주 —
  범위는 weeks[i][0]~[6], 주차 값은 기존 주간 사이드바/카드와 동일 계산. headerLabel
  :735-757).
- [ ] 월 그리드 빈 상태(이번 달 일정 0건 시 중앙 안내+생성 유도 — 주간 뷰 문구 관례).
- [ ] '오늘' 버튼 펄스 전 뷰 적용 — **분기 제거만으로는 무동작**(pulseDate는 현재
  CalendarGrid에만 prop 전달). ① :344-350에서 setPulseDate/타이머는 전 뷰 공통으로 빼되
  `setFocusedDate`는 월간 조건 유지(월간 전용 상태), ② WeekScrollView·DayScrollView에
  pulseDate prop을 추가하고 해당 날짜 카드/컬럼에 CalendarGrid의 펄스 어휘(:523-531)
  재사용, ③ 프리뷰에서 주/오늘 뷰 '오늘' 클릭 펄스 실측.
- [ ] 커밋 분리.

### Task D.5: 월 그리드 점 라인 전환 (별도 커밋 — 체급 게이트)
- [ ] **선행 확인**: 이 작업은 D13 필수 조건 4개(점 라인 드래그 유지 / layoutEventBars 입력
  축소 / 2계층 한도+통합 +N / 별도 커밋)를 모두 충족해야 한다. 착수 전 CalendarGrid의
  바 렌더·overflow 계산(:452, :470, :534-545)을 재조사하고 **예상 변경량이 이 Task 하나로
  현행 CalendarGrid의 절반을 넘게 재작성해야 한다고 판단되면 중단**하고 한솔에게 "다음
  라운드 이관"을 보고한다.
- [ ] 진행 시: 시각 단발 일정(allDay===false && start===end)만 점 라인(22px, 도트+HH:MM+제목,
  mousedown 이동 유지·리사이즈 없음), 종일/기간은 기존 바. 한도: 바 행 우선 배치 후 남은
  높이에 점 라인, 통합 "+N 더보기"는 기존 OverflowPopup 재사용.
- [ ] **G9 동반 정리**: maxVisibleBars의 죽은 분기(월 3 외 2주 5/주 8 — ScheduleView :760)와
  CalendarGrid :363 "월/2주/1주 공용" stale 주석을 이 커밋에서 함께 정리한다. 이 Task가
  다음 라운드로 이관되면 G9도 함께 이관됨을 보고에 명시.
- [ ] 프리뷰 실측(드래그 이동 회귀 중점) + 단독 커밋.

### Task D.6: 마무리 — B.6 동일 절차 (버전 1.109.0)

---

## Chunk 5: PR-E — 외부 캘린더 ICS 구독 (브랜치 claude/calendar-tg4-ics, v1.110.0)

> 설계 근거: D14. 읽기 전용 + 나만 보기 + 로컬 저장.

### Task E.1: node-ical 도입 + 파싱·전개 모듈 (TDD)

**Files:**
- Create: `electron/icsSubscriptions.ts`, `tests/icsSubscriptions.test.ts`
- Modify: `package.json`(dependencies에 node-ical + `test:calendar`에
  `./tests/icsSubscriptions.test.ts` 추가)

- [ ] **Step 1**: `npm install node-ical` (메인 프로세스 전용 — 렌더러 import 금지).
- [ ] **Step 2: 실패 테스트** — 파싱·전개 순수 부분을 분리해 테스트.
  **`electron/icsSubscriptions.ts`에는 'electron' top-level import를 절대 넣지 않는다**
  (node --test가 이 파일을 직접 import — 기존 electron측 테스트 모듈 관례와 동일하게
  파일 IO·fetch·경로는 전부 주입(DI)로 받는다. E.2에서도 이 원칙 유지):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandIcsToEvents } from '../electron/icsSubscriptions.ts';

const SINGLE = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ev-1',
  'DTSTART;TZID=Asia/Seoul:20260901T140000', 'DTEND;TZID=Asia/Seoul:20260901T150000',
  'SUMMARY:외부 회의', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const ALLDAY = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ev-2',
  'DTSTART;VALUE=DATE:20260901', 'DTEND;VALUE=DATE:20260903', // exclusive 종료
  'SUMMARY:출장', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const WEEKLY = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ev-3',
  'DTSTART;TZID=Asia/Seoul:20260901T100000', 'DTEND;TZID=Asia/Seoul:20260901T103000',
  'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:주간 미팅', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

const WINDOW = { from: '2026-08-01', to: '2027-02-01' };

test('시각 일정: KST 날짜·시각으로 매핑', () => {
  const out = expandIcsToEvents(SINGLE, WINDOW);
  assert.equal(out.length, 1);
  assert.deepEqual(
    [out[0].startDate, out[0].startTime, out[0].endTime, out[0].allDay],
    ['2026-09-01', '14:00', '15:00', false]);
});

test('종일 일정: exclusive 종료 → inclusive 변환', () => {
  const out = expandIcsToEvents(ALLDAY, WINDOW);
  assert.deepEqual([out[0].startDate, out[0].endDate, out[0].allDay],
    ['2026-09-01', '2026-09-02', true]);
});

test('RRULE 주간 반복 3회 전개', () => {
  const out = expandIcsToEvents(WEEKLY, WINDOW);
  assert.deepEqual(out.map(o => o.startDate),
    ['2026-09-01', '2026-09-08', '2026-09-15']);
});

test('창 밖 인스턴스는 제외', () => {
  const out = expandIcsToEvents(WEEKLY, { from: '2026-09-05', to: '2026-09-10' });
  assert.equal(out.length, 1);
});
```

- [ ] **Step 3: 구현** — `expandIcsToEvents(icsText, {from,to})`: `ical.sync.parseICS` →
  VEVENT 순회. 반복이면 `event.rrule.between(fromDate, toDate, true)` 전개 + `exdate` 제외 +
  `recurrences`(RECURRENCE-ID 오버라이드) 반영. UTC/TZID → KST 변환은 구글 경로의
  `fromRfc3339ToKstFields`(calendarService :334-344) 로직과 동일 규칙로 별도 헬퍼 구현
  (electron 쪽이므로 복제 후 주석으로 출처 명시). 종일 VALUE=DATE는 exclusive→inclusive.
  전개 결과 상한 500건/구독(미래 우선 정렬 후 절단, truncated 플래그 반환).
  **주의**: node-ical의 rrule은 TZID 처리에 알려진 함정(UTC 기준 전개)이 있다 — 테스트가
  실제 KST 벽시계 시각을 고정하는지 확인하고, 어긋나면 rrule 전개 후 원본 DTSTART의
  로컬 시각을 유지하는 보정(전개 결과의 날짜만 취하고 시각은 원본 벽시계 유지)을 적용.
- [ ] **Step 4: PASS + 게이트 등록(test:calendar에 추가) + 커밋** —
  `"ICS 일정 파싱·반복 전개 모듈 (TDD)"`

### Task E.2: 구독 저장·fetch·IPC

**Files:**
- Create: `src/shared/icsApiContract.ts`
- Modify: `electron/icsSubscriptions.ts`(스토어·fetch), `electron/main.ts`(핸들러 등록 —
  기존 calendarIpc 등록 방식 grep), `electron/preload.ts`, ElectronAPI 타입

- [ ] **Step 1**: 계약 —

```ts
export interface IcsSubscription {
  id: string; name: string; url: string; color: string;
  enabled: boolean; lastFetchedAt: string | null; lastError: string | null;
}
export interface IcsEventDto {
  uid: string; title: string; startDate: string; endDate: string;
  allDay: boolean; startTime: string | null; endTime: string | null;
}
// 채널: ics:list / ics:add(name,url,color) / ics:update(id,patch) / ics:remove(id)
//       / ics:refresh(id|null=전체) / ics:events → { subId, events }[]
```

- [ ] **Step 2**: 메인 구현 — 저장 경로는 **`path.join(app.getPath('userData'),
  'ics-subscriptions.json')`**(기존 관례 — portable 빌드에서 exe 기준 경로가 임시 폴더라
  userData 고정, main.ts·fontIpc 선례). 단 `icsSubscriptions.ts` 자체는 'electron' import
  금지이므로 **main.ts에서 dataDir·fetchText 함수를 주입**한다(또는 electron 의존 전송부를
  별도 파일로 분리). fetch는 Node `https`(파일 내 가능) 또는 `net.fetch`(main.ts 쪽에만) —
  webcal:// → https:// 치환, http(s) 외 프로토콜 거부, 리다이렉트 3회 제한, 5MB 상한.
  파싱 결과 메모리 캐시 + 앱 시작·30분 주기 갱신·수동 refresh. 실패 시 lastError 기록
  + 기존 캐시 유지. **주기 갱신 완료 시 `ics:changed` push**(기존 캘린더 창 fanout —
  calendarWindowFanout 관례 재사용)로 렌더러에 알린다.
- [ ] **Step 3**: 게이트 + 커밋 — `"외부 캘린더 구독 저장·갱신 경로와 IPC 추가"`

### Task E.3: 렌더러 병합 + 레일 "구독" 섹션 UI

**Files:**
- Create: `src/components/calendar/IcsSubscribeForm.tsx`
- Modify: `src/services/calendarService.ts`(병합), `src/components/calendar/CalendarRail.tsx`,
  `src/utils/calendarEventFilter.ts`(가시성 키), `src/mocks/devElectronAPI.ts`(seed)

- [ ] **Step 1**: calendarService에 ics 이벤트 로드 → `CalendarEvent` 매핑(`source: 'ics'`,
  `sourceCalendarId: 'ics:<id>'`, `isReadOnly: true`, `canEdit: false`, 색=구독 색,
  id는 `ics:<subId>:<uid>:<startDate>` 충돌 회피). **캐시 격리(D14)**: ics 이벤트는
  bflowEvents/googleEvents 캐시 **밖** 별도 배열로 유지하고 `getEvents()` 출력 시점에만
  병합 — 뮤테이션·구글 새로고침(replaceConfirmedGoogleCalendar) 경로 유입 금지.
  `src/types/calendar.ts` source 유니언에 `'ics'` 추가. **주의 — typecheck는 일부만 잡는다**
  (반환 타입이 주석된 sourceOf 정도). `\.source ===` 전 사이트를 grep으로 전수 점검하고
  (EventSidePanel·calendarService·calendarEventFilter·calendarEventIdentity·CalendarView·
  ScheduleView), 특히 **typecheck 무경고 런타임 폴백 2곳**을 반드시 고친다:
  ① `inferExistingEventSource`의 `if (event.sourceCalendarId) return 'google'` 폴백 —
  `ics:` prefix면 별도 처리(읽기 전용이므로 뮤테이션 진입 시 throw 권장),
  ② `mutateSourceEvents`의 bflow/google 이분법 — ics는 진입 금지 분기 추가.
  `CalendarCacheSource`에 'ics' 추가, identity 유틸에 ics 저장소 케이스 추가.
- [ ] **Step 2**: 필터 — `visibleCalendarIds['ics:<id>']` 키로 구독별 토글(구글 토글과 동일
  패턴, `filterCalendarEvents` 확장 + 기존 필터 테스트에 케이스 추가).
- [ ] **Step 3**: CalendarRail — "내 구글" 아래 "구독" 섹션: 색 체크 토글 + ⋯ 메뉴(이름/색
  변경·지금 새로고침·구독 해제(ConfirmDialog)) + 실패 시 경고 아이콘(툴팁에 마지막 성공
  시각) + `+ 주소로 구독` → IcsSubscribeForm(주소·이름·EVENT_COLORS 색 선택, URL 형식
  검증 인라인 오류, 추가 시 즉시 fetch).
- [ ] **Step 4**: devElectronAPI에 mock 구독 1건 + 일정 3건(시각 1·종일 1·반복 전개분 1).
- [ ] **Step 5**: 프리뷰 실측 — 구독 추가/토글/삭제/새로고침, 월·카드·시간표 3표면 표시,
  읽기 전용(드래그 불가·클릭 상세만) 확인.
- [ ] **Step 6**: 게이트 + 커밋 — `"레일에 구독 섹션과 주소로 구독 추가"`

### Task E.4: 마무리 — B.6 동일 절차 (버전 1.110.0. update-notes 예:
"애플·네이버 등 다른 캘린더의 '공유 주소'를 붙여넣으면 그 일정이 내 캘린더에 함께
보여요(나에게만 보이고, 수정은 원래 앱에서)." )

---

## 완료 후

- ROADMAP.md 상태 갱신 + CLAUDE.md(뷰 모드·ICS 아키텍처 변경 반영) + lessons 기록.
- 전 PR 머지 후 배포는 한솔 지시 대기(bflow-release-deploy 스킬, manifest 마지막 원칙).
