# 캘린더 새 창 — 설계 (2026-10-06)

> 요청(한솔): "캐릭터 현황판처럼, 캘린더도 따로 팝업으로 볼 수 있게"
> 버전: v1.129.0

## 1. 무엇을 만드나

사이드바의 '캘린더' 화면(`schedule` → `ScheduleView`)을 캐릭터 현황판처럼 **별도 창**으로 열 수 있게 한다.
다른 화면(씬 목록·대시보드 등)을 보면서 캘린더를 옆에 띄워 두는 용도다. 창 안의 캘린더는 본 창의 캘린더와
같은 화면이다 — 월·2주·주·오늘 보기, 일정 만들기·고치기·끌어 옮기기, 태그·캘린더 필터, 팀원 변경 실시간 반영.

대시보드의 작은 '캘린더 위젯' 팝업(`calendar`, `calendar-<시각>`)은 그대로 둔다. 이번 것은 화면 전체다.

## 2. 여는 곳

| 위치 | 모양 | 조건 |
|---|---|---|
| 사이드바 '캘린더' 항목 | 항목에 마우스를 올리면 오른쪽에 '새 창으로' 아이콘 버튼 (캐릭터 항목과 같은 버튼) | 사이드바가 펼쳐진 뒤(폭 전환 350ms 끝)에만 |
| 캘린더 화면 머리줄 | '새 창으로' 버튼 ('+ 일정' 왼쪽) | 본 창에서만. 새 창 안에서는 숨김 |

이미 열려 있으면 새로 만들지 않고 그 창을 앞으로 가져온다(기존 팝업 공통 동작).

## 3. 구조 — 캐릭터 현황판 팝업 패턴을 그대로 따른다

```
[본 창] 사이드바/머리줄 버튼
   └─ window.electronAPI.widgetOpenPopup('schedule', '캘린더')        (기존 IPC)
        └─ main: openWidgetPopup — WIDGET_POPUP_DEFAULTS['schedule'] = 1280×820, 항상 위 꺼짐
             └─ 새 창이 같은 앱을 #widget-popup/schedule 로 연다
                  └─ main.tsx → <WidgetPopup widgetId="schedule">
                       └─ WIDGET_REGISTRY['schedule'] = <SchedulePopupBody/>
                            └─ 로그인 확인 → lazy(ScheduleView)
```

- **팝업 id 는 `schedule`** (화면 id 와 같다). `calendar-` 로 시작하면 캘린더 위젯의 여러 개 띄우기 규칙
  (`widgetId.startsWith('calendar-')`)에 걸리므로 쓰지 않는다.
- **로그인 확인**: 캘린더에는 개인 일정이 있다. 창이 열린 채 로그아웃하면 "로그인한 뒤에 캘린더를 볼 수 있어요"만 보인다
  (현황판 팝업과 같은 이유 — 공유 PC 에 내용이 남지 않게).
- **데이터**: `ScheduleView` 는 마운트될 때 스스로 일정을 읽는다(`loadBflowEvents`). 팝업 껍데기(`WidgetPopup`)가 이미
  세션·사용자·휴가 연결·캘린더 변경 신호(다른 창의 변경 → 정본 재조회)·외부 구독(ICS)을 맡고 있어 추가 배선이 없다.
- 창 위치·크기·투명도·항상 위 설정은 기존 팝업처럼 기억되고, 열어 둔 채 앱을 끄면 다음 실행 때 다시 열린다.

## 4. 새 창 안에서 '다른 화면으로 가는' 버튼

새 창에는 캘린더 화면 하나만 있다. 캘린더 안에서 다른 화면으로 가는 버튼 네 가지는 그대로 두면 아무 일도 일어나지 않으므로,
**본 창을 앞으로 가져와 그 화면으로 이동**시킨다.

| 버튼 | 본 창에서 | 새 창에서 |
|---|---|---|
| 휴가 일정의 '이동' | 휴가 화면으로 | 본 창이 휴가 화면으로 |
| 씬이 연결된 일정의 '이동' | 씬 목록(그 씬 강조) | 본 창이 씬 목록으로 |
| 할 일이 연결된 일정의 '할일로 이동' | 대시보드의 그 할 일 | 본 창이 대시보드로 |
| '구글 캘린더 연동 안 됨 · 설정에서 연동하기' | 설정 화면 | 본 창이 설정 화면으로 |

구현:

- 새 IPC `widget:navigate-view` (기존 `widget:navigate-main`·`widget:navigate-to-date` 와 같은 모양):
  렌더러(팝업) → main(본 창 show·focus 후 전달) → 렌더러(본 창 App).
- `src/utils/widgetViewNavigation.ts`
  - `WidgetViewNavigation` — `{ view: 'vacation' | 'settings' }` / `{ view: 'dashboard', todoId? }` / `{ view: 'scenes', episodeNumber?, partId?, department?, highlightSceneId?, toastMessage? }`
  - `requestMainWindowView(navigation)` — 팝업 창이면 IPC 를 보내고 `true`, 본 창이면 아무것도 하지 않고 `false`.
    호출부는 `if (!requestMainWindowView(…)) 기존동작()` 한 줄.
  - `parseWidgetViewNavigation(raw)` — 본 창이 받은 값을 검사(허용된 화면·타입만). 모르는 값은 무시.
- **팝업 창 판정은 훅이 아니라 창의 성질로 한다**: `src/utils/popupWindow.ts` 의 `isWidgetPopupWindow()` 가
  `location.hash` 가 `#widget-popup/` 로 시작하는지 본다(main.tsx 가 팝업 화면을 고르는 기준과 같다).
  `IsPopupContext` 훅을 쓰지 않는 이유: `ScheduleView`·`CalendarRail`·`EventSidePanel` 은 기존 테스트가 훅을 흉내 내어
  함수를 직접 호출한다 — `useContext` 를 더하면 그 테스트 하네스가 전부 깨진다. 버튼을 누르는 순간에만 물어보면 된다.
  머리줄의 '새 창으로' 버튼은 `canPopOutToWindow()`(본 창이고 새 창 열기 기능이 있을 때)로 그린다.
- main 의 `widget:navigate-view` 는 본 창이 최소화돼 있으면 되살린 뒤(`restore`) 앞으로 가져온다.
- 본 창은 받은 값을 그대로 믿지 않는다: `parseWidgetViewNavigation` 이 통과시킨 네 화면(휴가·설정·대시보드·씬 목록)만 연다.

### 미리보기에서의 로그인 상태 (코덱스 1차 지적)

Electron 에서는 main 프로세스가 로그인 상태를 모든 창에 알리고(`session:changed`), 새 창은 뜨자마자 다시 달라고 한다
(`session:request-current`). 미리보기 mock 은 창마다 따로 돌고 그 길이 no-op 이라, 새 창의 로그인 확인이 본 창과 어긋났다 —
'로그인 유지'를 끄고 로그인하면 새 창에 안내만 뜨고, 본 창에서 로그아웃해도 새 창에 개인 일정이 남았다.

그래서 mock 에서 **새 창이 자기를 연 본 창의 로그인 상태를 따라간다**(창 사이 BroadcastChannel).

- 새 창은 뜬 직후 자기를 연 창(`window.opener`)에 지금 상태를 묻는다. 지목받은 본 창은 로그아웃 상태여도 답한다.
- 본 창의 로그인·로그아웃은 그때마다 알린다. 새 창은 mock 상태를 바꾸고 `onSessionChanged` 구독자에게 알린다.
- 본 창끼리는 맞추지 않는다(탭 두 개에 서로 다른 사람으로 로그인해 보는 쓰임 유지). 새 창도 자기를 연 창만 따라간다.
- 주소를 직접 쳐서 연 새 창(연 창을 모름)은 로그인돼 있는 본 창의 답을 받는다.

## 5. 범위 밖 (알고 넘어가는 것)

- 새 창이 열린 뒤에 본 창에서 구글 캘린더를 새로 연동하면, 새 창은 닫았다 다시 열어야 구글 일정이 보인다
  (연동 상태 신호가 창 사이로 가지 않는다. 연동은 한 번 하는 설정이라 이번엔 다루지 않는다).
- 일정 알림(리마인더)·알림 종은 본 창이 맡는다. 새 창은 알림을 따로 띄우지 않는다.
- 트레이 메뉴의 위젯 목록에는 넣지 않는다(현황판도 없다).
- 대시보드 캘린더 위젯의 '전체' 버튼(팝업에서는 무동작)은 이번 범위가 아니다.

## 6. 바뀌는 파일

| 파일 | 내용 |
|---|---|
| `electron/main.ts` | `WIDGET_POPUP_DEFAULTS.schedule`, `widget:navigate-view` 핸들러 |
| `electron/preload.ts`, `src/types/index.ts` | `widgetNavigateView` / `onWidgetNavigateView` |
| `src/mocks/devElectronAPI.ts` | 미리보기용: 새 창 크기, 화면 이동 신호(창 사이 BroadcastChannel), 새 창이 본 창의 로그인 상태를 따라가기 |
| `src/utils/popupWindow.ts`, `src/utils/widgetViewNavigation.ts` | 새 파일 (위 4절) |
| `src/views/WidgetPopup.tsx` | `SchedulePopupBody`, 등록 |
| `src/views/ScheduleView.tsx` | 머리줄 '새 창으로' 버튼, '이동'의 팝업 분기 |
| `src/components/calendar/CalendarRail.tsx`, `EventSidePanel.tsx` | 설정·할 일 이동의 팝업 분기 |
| `src/components/layout/Sidebar.tsx` | 새 창 버튼을 캐릭터·캘린더 두 항목 공용으로 |
| `src/App.tsx` | `onWidgetNavigateView` 수신 |
| 테스트 | `tests/calendarPopup.test.ts`(새), `tests/sidebarCharacterPopout.test.ts`(공용화 반영) |

## 7. 검증

- 단위: `parseWidgetViewNavigation`, `requestMainWindowView`, `isWidgetPopupWindow`, `canPopOutToWindow`.
- 배선: 등록·기본 크기·IPC 5곳·사이드바·머리줄 버튼(앵커, 뮤테이션으로 확인).
- 화면: 미리보기를 **앱과 같은 엔진(Electron 33 = Chromium 130)** 으로 열어 확인 — `npm run preview:electron`.
  - 본 창: 머리줄·사이드바 버튼이 `#widget-popup/schedule` 를 1280×820 으로 연다. 다른 화면에서 눌러도 그 화면을 떠나지 않는다.
  - 새 창: 캘린더가 그려지고(월 35칸·일정 막대), '새 창으로' 버튼은 숨는다. 보기 전환·단축키·일정 상세 창·일정 만들기 동작.
  - 새 창의 이동 버튼: 휴가/씬 이동·설정에서 연동하기가 본 창에 보내는 부탁의 내용을 확인. 새 창의 화면은 그대로.
  - 본 창: 부탁을 받으면 휴가·설정·씬 목록(강조·안내 포함)·대시보드로 이동. 모르는 화면·잘못된 값은 무시.
  - 로그인 상태를 비우면 새 창이 안내 글만 남기고 캘린더를 내린다.
- 기존 캘린더 테스트(훅 흉내 하네스) 전부 통과.

### 실제 앱에서만 확인할 수 있는 것 (배포 후 실기)

미리보기는 브라우저용 mock 으로 돌아서, **실제 창을 만드는 main 프로세스 쪽**은 거치지 않는다.

- 실제 새 창이 1280×820·항상 위 꺼짐으로 뜨는지, 위치·크기가 기억되는지
- 새 창의 이동 버튼 → main → 본 창(최소화 상태에서 되살아나는지 포함)
- 열어 둔 채 앱을 껐다 켰을 때 다시 열리는지

이 부분은 코드 모양이 이미 쓰이는 `widget:navigate-to-date` 와 같고 타입 검사·배선 테스트로 고정했지만, 직접 돌려 보지는 못했다
(검증용으로 앱 본체를 한 번 더 띄우면 `bflow://` 링크 연결을 그 창이 가져가 버려 띄우지 않았다).
