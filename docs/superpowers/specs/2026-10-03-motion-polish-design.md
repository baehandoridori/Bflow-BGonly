# B flow 움직임 폴리싱 — 설계 (2026-10-03)

> 출처: 움직임 제안서 아티팩트 https://claude.ai/artifact/23EN6o4ns4CnEfM9PiXANG (항목 20 + 바탕 A·B·C, 전후 목업).
> 한솔 승인: "이 점을 고려해서 쭉 진행해줘" (2026-10-03) — 전 항목 진행, 20번·14번은 아래 결정대로 변경.
> 원칙: 바뀐 후 움직임은 transform/opacity 중심(합성 스레드), 반복·이동 요소 backdrop-filter 금지, '동작 줄이기' 존중, 연타용 animation:none 토글 금지. 근거와 측정법은 tasks/lessons.md 2026-10-02 항목.

## 바탕 작업

### 바탕 A. 공통 박자 정하기 — 빠름·보통·느림 세 가지 속도와 두 가지 곡선

지금은 창마다 0.15초·0.2초·0.25초, 들어오는 곡선도 제각각이에요. 그래서 같은 '창 열기'인데 화면마다 느낌이 달라요. 기준을 하나로 정해요. 작은 반응(누름·화살표·메뉴)은 0.12초, 창·내용 교체는 0.18초, 미끄러지는 표시·카드 이동은 0.26초. 들어올 때는 빠르게 출발해 부드럽게 멈추고, 나갈 때는 부드럽게 출발해 빠르게 사라지는 곡선을 써요. 카드에 마우스를 올렸을 때 반응도 하나로 맞춰요. 누를 수 있는 카드는 2px 떠오르며 테두리가 밝아지고 그림자가 깊어지고, 누를 수 없는 정보 카드는 테두리만 밝아져요. 이 기준이 있으면 아래 항목들이 모두 '한 회사가 만든 앱'처럼 같은 박자로 움직여요.

<details><summary>개발 메모</summary>

토큰: --dur-fast 120ms / --dur-base 180ms / --dur-slow 260ms, --ease-out cubic-bezier(.16,1,.3,1)(useStackFlip.ts:33-34·캘린더 넘김에서 이미 사용), --ease-in cubic-bezier(.4,0,1,1), 작은 보상용 overshoot cubic-bezier(.34,1.56,.64,1). tailwind.config.js:57-75 에 transitionDuration/TimingFunction 확장이 없음 → 추가. src/lib/motion.ts 에 framer 프리셋(popIn/modalIn/viewEnter)을 transform 문자열 + transitionEnd {transform:'none'} 로 정의(framer 10.18 개별 x/y/scale 은 메인 스레드). 공용 CSS keyframe 은 bf-pop-in, 기존 char-overlay-in/char-modal-in(index.css:1548-1556) 별칭. 카드 hover 공통 클래스 .bf-card-hover 는 transform 2px lift + ::after(미리 그린 box-shadow) 의 opacity 전환만 씀. 현황 정리: AssigneeView.tsx:139·EpisodeView.tsx:108 의 transition-border 는 Tailwind 3 에 없는 클래스, Widget.tsx:72-73 hover:shadow-lg 는 :81 인라인 boxShadow 에 덮여 죽은 클래스. 컴포지팅 .scene-card 는 가장자리 떨림 때문에 320ms 로 늦춘 이력(index.css:1466-1468)이 있으니 hover 판정 요소와 들리는 요소를 분리. 측정치: duration 0.2×46, 0.15×26, ease 'easeOut'×36, [0.16,1,0.3,1]×30.

</details>

### 바탕 B. 윈도우 '애니메이션 끄기'를 앱 전체가 따르게 (다음 단계: 앱 안 '움직임' 설정)

윈도우에서 '애니메이션 효과'를 끈 사람에게도 지금은 캘린더와 일부 메뉴만 움직임을 줄여요. 창 열림, 카드 등장, 축하 꽃가루, 파트 완료 화면의 빛망울, 대시보드 배경, 알림 카드는 그대로 움직여요. 먼저 이 설정 하나로 앱 전체가 조용해지게 맞춰요. 아래 모든 항목은 '동작 줄이기면 이렇게'를 함께 정해 두었어요. 다음 단계로 설정에 '움직임: 기본 / 가볍게 / 최소'를 넣을 수 있어요. '가볍게'는 계속 반복되는 장식만 멈추고 창이 열리는 것 같은 짧은 반응은 남겨요. 저사양 PC 팀원이 직접 고를 수 있게 돼요.

<details><summary>개발 메모</summary>

1단계(S): main.tsx App 바깥을 <MotionConfig reducedMotion='user'> 로 감쌈(ScheduleView.tsx:1529 의 중첩 MotionConfig 는 안쪽이 이겨 그대로 유지). MotionConfig 는 transform 문자열·WAAPI·rAF·canvas·SMIL 을 막지 못함 → 개별 가드는 src/hooks/useMotionPref.ts(현재 사용처 6곳뿐: MiniCalendar.tsx:34, TagBar.tsx:51, WeekScrollView.tsx:103, WeekTimeGridView.tsx:378, CalendarWidget.tsx:274, MyTasksWidget.tsx:410). 전역 규칙 index.css:1036-1043 보다 특이도가 높은 !important 규칙이 있음: index.css:914-936(토스트), widget-animations.css:4-8, 11-15, 35-37 → @media (prefers-reduced-motion: no-preference) 안으로 이동. 가드 필요 목록: Dashboard.tsx:121-203 플렉서스, StarNest 두 종, ScenesView.tsx:449-506·690-718 파트 완료 보케, ui/Confetti.tsx:56-72, VacationView.tsx:661-669 동기화 막대, GoldenBarChart.tsx:250-253 SMIL, behavior 'smooth' 스크롤(ActivityFeed.tsx:358, CommentPanel.tsx:1760-1773, ScenesView.tsx:1050). 2단계(M): preferences.json 에 motionLevel 'full'|'lite'|'minimal', document.documentElement.dataset.motion, html[data-motion='lite'] 에서 무한 장식과 backdrop-filter 를 끔, 'minimal' 은 reduce 규칙을 복제, useMotionPref 는 {reduce, lite} 로 확장, EffectsSection 상단에 3칸 세그먼트.

</details>

### 바탕 C. 보이지 않는 무게 덜기 — 겉모습은 그대로, 앱은 가볍게

새 움직임을 넣기 전에 지금 앱을 무겁게 하는 것부터 덜어내요. 그래야 저사양 PC 에서도 새 움직임이 매끄러워요. 무게의 원인은 세 가지예요. ① 움직이는 알림 카드·펼침 메뉴·인사 말풍선·타임라인 미리보기 카드·스크롤 따라오는 위쪽 띠 뒤의 '흐린 유리' 효과예요. 대부분 바탕이 90% 넘게 불투명해서 눈에는 거의 안 보이는데, 움직일 때마다 컴퓨터가 흐림을 새로 계산해요. ② 계속 숨 쉬듯 빛나는 장식이에요(새 댓글 배지, 새 버전 배지, 일괄 작업 바, 시트의 씬 번호 테두리). 매 순간 화면을 다시 칠하는 방식이에요. ③ 대시보드 뒤 별자리 배경이에요. B flow 를 안 쓰고 다른 프로그램으로 작업하는 동안에도 1초에 60번 움직이고, 그 위 유리 위젯 10여 개가 매번 흐림을 다시 계산해요. 빛나는 모양과 유리 느낌은 거의 그대로 두고 방식만 가볍게 바꿔요. 눈에 띄게 달라지는 건 두 가지예요. 다른 프로그램을 쓰는 동안 대시보드 배경이 1~2초에 걸쳐 천천히 멈추고, 시트의 씬 번호 빛 테두리는 평소엔 멈춰 있다가 마우스를 올린 줄만 돌아요. 씬 번호 테두리는 한솔이 직접 고른 디자인이라 목업으로 확인받고 결정해요.

<details><summary>개발 메모</summary>

① 움직이는 흐림 제거(배경 알파 .97 로 보정): index.css:899-911 토스트 blur(16px), GlassDropdown.tsx:224-227(glassStyles.ts:3-10 floatingGlassStyle 은 22곳에서 쓰므로 흐림 없는 변형 floatingSolidStyle 을 신설), WelcomeToast.tsx:26-69(spring x/y/scale → transform 문자열, exit filter blur(8px) 제거, elevatedGlassStyle 의 알파는 .84 라 약간 비침), TimelinePanel.tsx:690-701(backdrop-blur-md 제거, width/height/filter 전환을 scale·::after opacity 로, 옆 카드 배경 .74→.92), CharacterBoardView.tsx:445·ScenesView.tsx:5417·WeekTimeGridView.tsx:525 sticky 흐림 제거, UpdateCenterModal.tsx:322·SpotlightSearch.tsx:678 전체 화면 흐림을 단색 반투명으로. ② 무한 paint 를 ::after opacity 로(notification-bell.css 와 같은 해법): index.css:436-451 .comment-unread-badge, :1326-1336 .bflow-badge-pulse, :1347-1362 .bflow-bulk-bar-pulse(바는 등장 시 2회만 + ScenesView.tsx:6318 blur 제거), :1311-1323 bflow-peak-pulse. scene-effects.css:25-64 는 기본 animation:none + 정적 그라데이션, tr:hover 에서만 회전. :270-277 is-resizing 은 animation:none 대신 animation-play-state: paused. ③ 배경: Dashboard.tsx:121-203 에 30fps 상한, window focus/blur·visibilitychange 시 motionScale 감쇠(점이 순간이동하지 않게 dtFactor 상한 :130 활용), 끌기·리사이즈 중 정지 플래그, reduce 면 한 프레임만 그림, 입자 글로우는 오프스크린 스프라이트(:180-190 createRadialGradient 매 프레임 120회 제거). 공용 훅 useBackgroundLoopGate 로 StarNest 두 종(StarNestBackground.tsx:408)에도 적용. 위젯 유리를 흐림 없는 반투명(.55)으로 바꾸는 안은 겉모습이 크게 달라지므로 기본안에서 제외하고 스크린샷 비교 후 결정. ④ Dashboard.tsx:1201-1215·302-317 hover 존이 바뀔 때마다 무거운 위젯이 재렌더됨 → getWidgetComponent 결과를 key=`${isEpMode}:${id}` 로 캐시, :1213 같은 값이면 상태 갱신 생략. 전후 측정은 v1.127.5 와 같은 방식(프레임 시간, CPU 4~6배 감속).

</details>

## 항목

### 1. 만들어 둔 버튼·화살표 움직임 되살리고 화살표 통일하기 (앱 전체) `unblock-button-motion`

- 화면: 앱 전체 — 펼침 메뉴의 ▼ 화살표, 사이드바 맨 아래 접기 버튼, 왼쪽 위 B 로고, 캘린더 날짜 옆 + 버튼, 마우스를 올리면 나타나는 작은 버튼(씬 목록 왼쪽 에피소드 목록, 메모 위젯 등), 리테이크·컴포지팅·타임라인의 ▶ 접기 화살표
- 종류/빈도/작업/위험: fix / daily / S / medium

**지금**: 펼침 메뉴를 열면 ▼ 화살표가 돌지 않고 한 번에 '뚝' 뒤집혀요. B 로고에 마우스를 올리면 '뚝' 커지고, 숨어 있던 작은 버튼은 서서히가 아니라 '툭' 나타나요. 원래 다 부드럽게 움직이도록 만들어 뒀어요. 그런데 다크/라이트를 바꿀 때 색을 부드럽게 바꾸려고 넣은 공통 설정 하나가, 6월 업데이트 이후 약 넉 달 동안 이 움직임 150여 곳을 모두 꺼 두고 있었어요. 리테이크 트리, 컴포지팅 파트 머리줄, 타임라인 그룹의 ▶ 화살표는 아예 그림만 ▶에서 ▼로 바꿔 끼우게 만들어져 있어서, 돌도록 만들어 둔 캐릭터 화면의 화살표와 방식이 달라요.

**바꾼 후**: 공통 설정이 '색이 바뀔 때만' 거들도록 한발 물러서서, 버튼마다 원래 의도한 움직임이 살아나요. ▼ 화살표는 0.2초 동안 반 바퀴 돌고, B 로고는 살며시 커졌다가 누르면 살짝 눌리고, 숨은 버튼은 서서히 떠올라요. 그림만 바뀌던 ▶ 화살표도 모두 0.2초에 90도 도는 같은 방식으로 맞춰요. 덤으로 헤더·사이드바 아이콘 버튼을 누르는 순간 살짝 눌리는 반응을 넣어요. 다크/라이트 전환 때 색이 부드럽게 바뀌는 건 그대로예요.

**조심할 점**: 넉 달 동안 아무도 보지 못한 움직임이 한꺼번에 켜지는 일이에요. 그래서 화면마다 한 번씩 눌러 보며 어색한 곳을 정리해야 해요. 마우스를 올렸을 때 색이 부드럽게 바뀌던 일부 버튼은 오히려 색이 뚝 바뀔 수 있어요. 최근 가볍게 다듬은 캘린더 + 버튼 주변이 다시 무거워지지 않게 함께 손봐야 해요.

**수치 사양(목업 기준)**: 장면: 배경 #0F1117, 카드(#1A1D27, 보더 #2D3041, radius 12) 4개를 2×2로 배치(각 300×170). ① '작업자: 전체 ▼' 버튼(높이 32, 글자 13px #E8E8EE, ▼ 12px #8B8DA3). 누르면 아래에 4줄 목록이 열림. ② 40×40 B 로고(배경 #6C5CE7→#A29BFE 그라데이션, radius 10, 흰 B). ③ 에피소드 행 3줄(높이 32). 마우스를 올리면 오른쪽에 연필·휴지통 아이콘(16px)이 나타남. ④ 트리 머리줄 2줄 '▶ EP03 (리테이크 4)', 누르면 아래 2줄이 펼쳐짐. 상단에 [지금 | 바꾸면] 토글. 지금: 색 관련 속성만 전환되게 강제 → ▼ 는 0ms 에 뒤집힘, 로고 hover 는 scale 1→1.1 즉시, 아이콘은 opacity 즉시, ▶ 는 글리프만 ▶↔▼ 교체. 바꾸면: ▼ rotate 0→180deg 200ms cubic-bezier(.2,0,0,1). 로고 hover scale 1→1.1 300ms cubic-bezier(.16,1,.3,1), 누르는 동안 scale .95 120ms. 아이콘 opacity 0→1 150ms ease-out. ▶ rotate 0→90deg 200ms cubic-bezier(.2,0,0,1). 헤더 모양 아이콘 버튼은 누르는 동안 scale .97 120ms. 동작 줄이기: 회전·확대 없이 상태만 즉시 바뀌고 색만 120ms 페이드.

<details><summary>개발 메모</summary>

원인: src/index.css:263-280 `body.theme-ready button, … svg { transition: background-color .18s, border-color, color, fill, stroke }`(특이도 0,1,2)가 Tailwind `.transition-transform/.transition-opacity/.transition-all/.duration-*`(0,1,0)와 `.calendar-day-add`(0,1,0)를 이김. theme-ready 는 App.tsx:892 에서 영구로 붙고, v1.36.0(85f878e8)부터 이 상태. 빌드 CSS 의 computed transitionProperty 로 확인됨. 수정: 263-273 셀렉터를 `body.theme-ready, :where(body.theme-ready) :where(header, aside, main, [role='dialog'], button, input, textarea, select, svg)` 로 바꿔 특이도 0 으로(#root 줄은 분리). 유틸 클래스가 있으면 유틸이 이기고, 없으면 기존 180ms 색 페이드가 유지됨. 회귀 점검: (1) index.css:1691 .calendar-day-add 의 box-shadow/color 0.14s 가 살아나서 useProximityReveal 이 --reveal 을 갱신할 때마다 그림자 전환이 재시작됨 → color 만 남길 것(v1.127.5 회귀 방지). (2) SceneDetailModal.tsx:1223-1231 motion.button 의 transition-all 이 framer x/opacity 와 겹침 → transition-colors 로. (3) transition-opacity/transform 만 가진 버튼(EpisodeTreeNav.tsx:319 등)은 hover 색 페이드를 잃음 → `transition` 이나 명시 목록으로. (4) Sidebar.tsx:104 로고 scale 이 살아나면 :124-125 backdrop blur(20px) 층도 같이 스케일됨 → 흐림 제거. (5) tests/themeTransitionPerformance.test.ts 가 'body.theme-ready button/header' 패턴을 단언하므로 함께 갱신. 화살표 통일: SceneGroupSection.tsx:125,347,413 · EpisodeGroupSection.tsx:126,216 · PartHeader.tsx:48-49 · GanttCanvas.tsx:414 의 ChevronRight↔ChevronDown 교체를 단일 ChevronRight + `transition-transform duration-200` + 펼침 시 rotate-90 으로(기준: CharacterTabGroupsView.tsx:215, gantt tree.css:11-12). 눌림: `.press-feedback{transition:transform 120ms cubic-bezier(.2,0,0,1)} .press-feedback:active{transform:scale(.97)}` 를 Header.tsx:89-108 아이콘 버튼과 사이드바 nav 에 적용. 규모: button 에 transition-(transform|opacity|all) 162건, Chevron 약 23곳.

</details>

### 2. 설명 말풍선이 가리킨 것을 덮지 않고 그 위에 딱 붙어 뜨게 (앱 전체 + 캘린더·타임라인·대시보드 그래프) `tooltip-anchor`

- 화면: 앱 전체 아이콘 버튼의 설명 말풍선, 캘린더 월 보기의 일정 막대 설명 카드, 타임라인 막대 설명 카드, 대시보드 '최근 작업' 칸 그림·'부서별 비교' 막대의 말풍선
- 종류/빈도/작업/위험: fix / daily / M / low

**지금**: 앱 전체 말풍선이 원래 의도한 자리(마우스 위쪽 가운데)가 아니라 마우스 바로 옆에서 오른쪽 아래로 펼쳐져서, 방금 가리킨 버튼을 덮어요. 화면 오른쪽 끝에서는 남은 폭만큼 좁아져 글자가 몇 자씩 여러 줄로 접히고, 끝에 바짝 붙으면 일부가 화면 밖으로 나가요. 캘린더·타임라인의 설명 카드는 마우스를 조금만 움직여도 졸졸 따라다니며 흔들려요. 타임라인은 그때마다 차트 전체를, 캘린더는 막대에 마우스를 올리고 뗄 때마다 달력 전체를 새로 계산해요. 캘린더 일정 막대는 마우스를 올리면 살짝 커지면서 작은 글씨가 번져요. 대시보드 '최근 작업'의 칸은 커지도록 만들어 둔 효과가 연결되지 않아 아무 반응이 없고, 0.1초쯤 뒤 마우스 자리에 앱의 어두운 말풍선('월 13시' 같은)이 하나 더 겹쳐 떠요(위젯을 따로 띄운 창에서는 회색 기본 말풍선이 겹쳐요).

**바꾼 후**: 모든 말풍선이 가리킨 곳 바로 위 가운데에 뜨고(화면 위쪽에서는 아래에), 화면 끝에서는 안쪽으로 밀려 들어와 잘리지 않아요. 캘린더·타임라인 설명 카드는 처음 마우스를 올린 막대 위에 고정되어 흔들리지 않아요. 한 번 뜬 뒤 옆 버튼이나 옆 막대로 옮기면 기다리지 않고 바로 그 위로 옮겨 가요. 캘린더 막대는 크기는 그대로 두고 테두리만 밝아져서 글씨가 번지지 않아요. '최근 작업' 칸은 마우스를 올린 칸만 톡 커지고, 겹쳐 뜨던 두 번째 말풍선은 없어져요.

**조심할 점**: 앱 전체 말풍선이 마우스를 따라오는 지금 방식은 그대로 두고 위치만 바로잡아요. 그래서 큰 버튼의 아래쪽을 가리키면 말풍선이 버튼 윗부분에 걸칠 수 있어요. 캘린더·타임라인 설명 카드는 '막대에 고정'으로 바뀌어서, 따라다니는 쪽이 익숙한 사람은 처음엔 조금 다르게 느낄 수 있어요.

**수치 사양(목업 기준)**: 장면: 상단 툴바(높이 44, #1A1D27) 아이콘 버튼 6개(32×32, 마지막 2개는 화면 오른쪽 끝 8px 안쪽). 아래에 캘린더 한 주 7칸(칸 140×90)과 일정 막대 3개(높이 26, 보라 #6C5CE7·노랑 #FDCB6E·초록 #00B894, 하나는 3일짜리). 그 아래 7×24 칸 그림(칸 12px, 간격 2px, 보라 농도 5단계). [지금 | 바꾸면] 토글과 '자동 커서 재생' 버튼. 재생 경로: 아이콘1 → 아이콘6 → 막대1 안에서 좌우 40px 흔들기 → 막대2 → 칸 3개. 지금: 말풍선 왼쪽 위 모서리가 (커서x, 커서y−12)에 놓여 커서와 버튼을 덮음. 오른쪽 끝 아이콘에서는 말풍선 폭의 절반이 화면 밖. 캘린더 카드는 400ms 뒤 등장한 다음 mousemove 마다 커서를 따라감(배경 rgba(26,29,39,.92) + blur 18px). 막대 hover 시 scale 1.02. 칸 그림은 무반응이고 1초 뒤 회색 기본 말풍선이 겹침. 바꾸면: 앱 말풍선은 커서 위 가운데, 등장 opacity 0→1 + scale .92→1 120ms cubic-bezier(.2,0,0,1), 화면 가장자리 8px 안쪽으로 클램프. 웜업(마지막 숨김 후 300ms 안)이면 지연 0, 등장 생략, 위치만 120ms 미끄러짐. 캘린더 카드는 400ms 뒤 막대 위 중앙(막대 top−6px)에 고정, 등장 opacity 0→1 + translateY(6px→0) 140ms cubic-bezier(.16,1,.3,1). 막대 hover 는 1px 테두리 + 그림자 층 opacity 0→1 150ms(크기 불변). 칸 hover 는 scale 1.4 150ms ease + 맨 앞으로, 말풍선 opacity 120ms. 동작 줄이기: 등장은 opacity 만 100ms, 위치 이동 즉시.

<details><summary>개발 메모</summary>

GlobalTooltip.tsx:155-167 — motion.div 에 animate scale 과 style.transform 문자열을 함께 쓰면 framer 10.18 이 transform 을 'scale(..) translateZ(0)'→'none' 으로 덮어서 translate(-50%,-100%) 가 한 번도 적용되지 않음(use-props.mjs·build-styles.mjs, UMD 재현). 수정: 바깥 일반 div 가 위치를 맡고(ref.style.transform = translate3d(x,y,0) translate(-50%, -100% 또는 0) 을 rAF 로 갱신), 안쪽 motion.div 는 opacity/scale 만 맡음(transform-origin bottom center). 또는 transformTemplate 사용. :109-126 의 mousemove setState 는 ref 갱신으로 바꾸고, text/position 이 바뀔 때만 setState. :171-178 backdropFilter 제거, 배경 알파 .97/.99. 웜업: 마지막 숨김 후 300ms 안이면 지연 0, key 를 고정해 등장 생략. 위치 transition 120ms 는 대상이 바뀌는 순간에만(상시로 켜면 따라가기가 끈적해짐). :32-41 shiftX 는 가운데 정렬 기준이라 정상 작동하게 됨. 사이드바가 접혀 있을 때 nav title 툴팁과 펼침 타이밍이 겹치지 않는지 확인. CalendarGrid.tsx:175-182 handleMove 를 제거하고 enter 시점 rect 로 앵커를 1회 고정({x: clamp(clientX, left+16, right-16), y: top}). :276-280 tooltipGlassStyle 의 backdropFilter 는 none. :206 scale-[1.02] brightness-110 대신 ::after 링(정적 box-shadow)의 opacity 150ms. :57 EventBarChip 을 React.memo 로 감싸고 :492 hoveredEventIdentity 는 부모에서 isHovered boolean 으로 계산해 내림(:723). GanttCanvas.tsx:401 onPointerMove → onPointerEnter 에서 rect 로 1회. GanttTooltip.tsx:46 따라가기는 task.id 가 바뀔 때만. :339 conflicts 를 useMemo([projects]) 로. 대시보드: RecentActivityWidget.tsx:174-183, DepartmentComparisonWidget.tsx:55-62·269-278 의 말풍선을 별도 컴포넌트로 빼고 ref 로 transform 갱신, blur 제거, 숨김 60ms 디바운스(지금은 :46·131-137 위치 state 때문에 위젯 전체가 리렌더). GoldenHeatmap.tsx:137 에 'path-link-heatmap-cell' 클래스를 붙여 activity-widget.css:4-8 을 연결, :138 title 제거, :146 인라인 zIndex 'auto' 제거(hover z-index 를 막음).

</details>

### 3. 15초마다 깜빡이는 '동기화 중…'을 조용하게, 직접 누른 새로고침만 또렷하게 `header-sync-quiet`

- 화면: 모든 화면 상단 헤더 오른쪽의 '최신 상태' 표시와 새로고침 버튼
- 종류/빈도/작업/위험: fix / daily / S / low

**지금**: 앱은 15초마다 자동으로 새 내용을 받아와요. 그때마다 '최신 상태'(초록 체크)가 '동기화 중...'(깜빡이는 점)으로 바뀌었다 돌아와요. 두 글자의 길이가 달라서 왼쪽 연결 아이콘이 좌우로 살짝 밀려요. 새로고침 버튼은 버튼 통째로(마우스를 올려 둔 회색 배경까지) 돌다가, 받아오기가 끝나는 순간 어느 각도에 있든 제자리로 '뚝' 튀어요. 자동으로 받아오는 동안에는 새로고침을 눌러도 반응이 없어요. 하루 종일 켜 두면 한 시간에 240번 반복돼요.

**바꾼 후**: 자동으로 받아올 때는 '최신 상태' 글자와 버튼을 그대로 두고, 초록 체크만 한 번 은은하게 숨 쉬어요. 내가 직접 새로고침을 눌렀을 때만 화살표 아이콘(버튼 배경 말고)이 돌고, 끝나면 돌던 바퀴를 마저 돈 뒤 사뿐히 멈추면서 체크가 '톡' 나타나요. 글자 자리는 폭을 고정해서 옆 아이콘이 흔들리지 않아요. 자동으로 받아오는 중에 눌러도 무시하지 않고, 끝난 뒤 한 번 더 받아와요.

**조심할 점**: 자동으로 받아오는 순간이 눈에 덜 띄게 되므로, '지금 연결이 살아 있나?'를 확인하던 사람은 초록 체크의 은은한 숨쉬기로 확인하게 돼요. 연결이 끊긴 경우의 표시는 지금과 같아요.

**수치 사양(목업 기준)**: 장면: 헤더 띠(높이 48, 배경 #0F1117, 아래 보더 #2D3041). 오른쪽 그룹: DB 아이콘(16px #00B894) · 상태 슬롯('✓ 최신 상태' 12px #8B8DA3, 체크 #00B894) · 새로고침 버튼(32×32, 아이콘 16px, hover 배경 #2D3041 50%) · 해/달 · 종. 버튼: [15초 자동 확인 흉내](1.2초 동안 동기화 상태), [직접 새로고침](0.9초), [자동 중에 새로고침 누르기]. 지금: 자동·직접 모두 문구가 '● 동기화 중...'(점 pulse)으로 바뀌고, 폭 차이로 DB 아이콘이 6px 좌우로 이동. 버튼 전체(hover 배경 포함)가 1s linear 로 돌다가 끝나면 그 각도에서 0°로 스냅. 자동 중에는 버튼 비활성. 바꾸면: 자동은 문구 유지, 체크만 opacity 1→.35→1 600ms 1회. 직접은 아이콘만 rotate 700ms linear 반복, 끝나면 현재 바퀴를 마저 돌며 ease-out 감속 정지, 이어서 체크 scale .6→1.12→1 220ms cubic-bezier(.18,.88,.34,1.28). 상태 슬롯 폭 78px 고정, 문구 교체는 두 문구 opacity 160ms 교차. 자동 중에 누르면 자동이 끝난 뒤 아이콘이 이어서 돌며 한 번 더 받아옴. 동작 줄이기: 회전 없이 문구만 교차.

<details><summary>개발 메모</summary>

App.tsx:2989-2996 POLL_INTERVAL 15000 → loadData. :613-614 setSyncing(true), :682 finally setSyncing(false). 실시간 구조 변경 재로드(:2157, :2751)도 같은 함수. Header.tsx:75-86 은 isSyncing 에 따라 문구와 아이콘을 통째로 교체하고, 오른쪽 그룹이 justify-between 오른쪽 끝이라 :57-68 DB 배지가 밀림. :89-99 는 버튼 요소 자체에 `isSyncing && 'animate-spin text-accent'` + disabled 를 걸어, 클래스가 빠지면 0°로 스냅됨. 수정: loadData 에 출처 옵션 추가. App.tsx:3243 은 onRefresh={loadData} 라 클릭 이벤트가 첫 인자로 들어오므로 `() => loadData({ manual: true })` 로 감싸고, useDataStore 에 syncKind 'auto'|'manual'|null 추가. 자동일 때는 setSyncing 을 생략하거나 600ms 를 넘길 때만 표시. 회전은 svg 에 ref → `el.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:700,iterations:Infinity})`, 종료 시 `anim.effect.updateTiming({ iterations: Math.ceil(anim.currentTime/700), easing:'ease-out' })` 로 현재 바퀴만 마저 돌고 onfinish 에서 cancel. 버튼에 animate-spin 금지. 상태 슬롯은 min-w-[78px], 두 span 을 겹쳐 opacity 160ms 교차. 체크 '톡'은 WAAPI 1회(클래스 토글 금지). 자동 동기화 중 수동 클릭은 끝난 뒤 1회 재실행(disabled 제거). Header.tsx:22 useDataStore() 전체 구독을 selector 로. WAAPI 는 전역 reduce CSS 가 막지 못하므로 useMotionPref 로 회전 생략.

</details>

### 4. 댓글 칸을 열 때: '의견 없음'이 번쩍이거나, 맨 위부터 쭉 미끄러지거나, '새 댓글' 줄이 금방 사라지는 문제 `comment-open-calm`

- 화면: 씬 목록 → 씬 상세 창 오른쪽 댓글(←/→로 다음 씬을 넘길 때마다), 캐릭터 → 캐릭터 상세 댓글
- 종류/빈도/작업/위험: fix / daily / M / low

**지금**: 씬 상세를 열거나 다음 씬으로 넘어갈 때마다 댓글 칸이 새로 만들어져요. 댓글을 다 불러오기 전까지 '아직 의견이 없습니다 · 첫 의견을 남겨보세요'가 잠깐 보였다가 댓글로 뚝 바뀌어요(캐릭터 댓글과 처음 여는 파트에서 특히 눈에 띄어요). 불러오기에 실패해도 똑같이 '의견 없음'으로 보여요. 댓글이 많은 씬은 매번 맨 위(오래된 댓글)에서 시작해 맨 아래까지 쭉 미끄러져 내려가요. 새 댓글이 있는 씬은 '새 댓글' 줄까지 내려가는데, 그 줄이 보이자마자 사라지고(아래가 한 줄 당겨짐) 또 맨 아래로 미끄러져서 어디부터 새 댓글인지 볼 틈이 없어요. 위로 올려 예전 댓글을 읽는 중에 팀원이 댓글을 달면 화면이 아래로 끌려가요.

**바꾼 후**: 불러오는 동안에는 회색 말풍선 자리 2~3개가 은은하게 기다리고(0.15초 안에 오면 이것도 안 보여요), 도착하면 진짜 댓글로 스르륵 바뀌어요. '의견 없음'은 정말 댓글이 없을 때만 나오고, 실패하면 '댓글을 불러오지 못했어요 · 다시 불러오기'가 떠요. 처음 열 때는 이미 맨 아래(최신 댓글)에 자리 잡은 상태로 나타나고, 새 댓글이 있으면 '새 댓글' 줄이 화면 가운데에 놓인 채로 보여요. 그 줄은 보는 동안 남아 있다가 4초 뒤 옅어져요(자리는 그대로). 위로 올려 읽는 중에 새 댓글이 오면 화면을 끌어내리지 않고, 아래에 '새 댓글 1개 ↓' 알약이 떠올라요.

**조심할 점**: '새 댓글' 줄이 지금보다 오래 남아 있게 돼요. 읽음 처리 자체는 지금처럼 바로 되고, 줄만 천천히 옅어지는 거예요.

**수치 사양(목업 기준)**: 장면: 씬 상세 창 오른쪽 댓글 패널(폭 360, 높이 520, #1A1D27). 말풍선 14개로 넘침(상대 #2D3041 왼쪽, 내 것 보라 25% 오른쪽). 위에 '← 이전 씬 / 다음 씬 →' 버튼. 씬 A 는 댓글 14개, 씬 B 는 0개, 씬 C 는 아래 3개가 '새 댓글'. 스위치 '느린 인터넷(0.6초)'. 버튼 [위로 올려 읽는 중 + 팀원 댓글 도착]. 지금: 넘길 때 '아직 의견이 없습니다 · 첫 의견을 남겨보세요'가 0.6초 보였다가 말풍선이 뚝 나타남. 스크롤은 0에서 바닥까지 smooth 약 600ms. C 에서는 구분선까지 내려간 직후 구분선이 사라지고(한 줄 당겨짐) 다시 바닥까지 미끄러짐. 읽는 중 도착하면 바닥으로 끌려감. 바꾸면: 150ms 를 넘기면 회색 말풍선 자리 3개(좌/우 교대, 높이 44/60/36, 배경 rgba(232,232,238,.04)) 위로 빛 띠가 translateX(−100%→100%) 1200ms ease-in-out 반복. 도착 시 목록 opacity 0→1 180ms, 처음부터 바닥에 고정. 0개면 빈 안내 opacity + translateY(4px→0) 180ms. C 는 구분선(보라 1px + '새 댓글' 라벨)이 화면 가운데에 놓인 채 등장, 4초 뒤 opacity 1→0 300ms(높이 유지). 위로 올려 둔 상태에서 도착하면 아래 중앙에 '새 댓글 1개 ↓' 알약(높이 28, #6C5CE7, 흰 글자 12px)이 opacity 0→1 + translateY(8px→0) 160ms cubic-bezier(.16,1,.3,1)로 등장, 누르면 바닥까지 smooth. 동작 줄이기: 빛 띠 없이 정적 회색, 스크롤 즉시, 알약은 이동 없이 등장.

<details><summary>개발 메모</summary>

빈 상태 번쩍: CommentPanelResizable.tsx:288 key={sceneKey} 로 씬마다 리마운트, CommentPanel.tsx:348 useState([]) 에 로딩 플래그 없음, :636-668 loadComments 에 catch 없음, :1916-1924 빈 안내. 캐릭터는 commentService.ts:315 에서 매번 IPC, 씬은 :118-122 파트 캐시 미스 시 조회. 수정: loaded 플래그 + 150ms 지연 자리표시(::after translateX sweep, 테마 토큰), 실패 시 '다시 불러오기' 줄(ThreadTodoSection.tsx:247-251 패턴). 스크롤: :1760-1765 effect 가 0→N 일 때 scrollTo({top: scrollHeight, behavior:'smooth'}), :1767-1773 은 setTimeout 150 후 scrollIntoView center. → 처음으로 비어 있지 않게 그려질 때 useLayoutEffect 에서 scrollTop 을 직접 지정(initialPinnedRef). 반응 일괄 조회(:666-667)나 이미지로 높이가 늘어나는 첫 ~1초는, 사용자가 휠·포인터를 쓰기 전까지 ResizeObserver 로 바닥 고정. ThreadTodoSection onHeightGrow(:1888-1906)와 규칙 공유. 구분선: :1775-1790 IntersectionObserver(threshold .6)가 즉시 markUnreadCommentsRead → :1730-1742 firstUnread null → :2048-2060·:2266-2278 구분선 언마운트, :1760 effect 는 deps 에 firstUnread 가 있어 재실행되며 다시 맨 아래로 스크롤. dividerId 를 최초 1회 캡처해 유지하고, 4초 뒤 .comment-unread-divider--fading(opacity 300ms, 자리 유지). onScroll 에서 nearBottomRef(<80px) 를 갱신해 그때만 따라가고, 아니면 newBelowCount 누적 + 알약(sticky bottom-2, pill-in 160ms). scrollIntoView 는 바깥 상자까지 움직일 수 있으므로 scrollTop 직접 조정(tasks/lessons.md:753). JS 의 behavior 'smooth' 는 index.css:1041 reduce 규칙이 막지 못하므로 useMotionPref 로 'auto' 분기.

</details>

### 5. 컴포지팅 카드의 깜빡 재등장·즉시 어두워짐·펼칠 때 겹침 고치기 `compositing-card-fixes`

- 화면: 컴포지팅 — 씬 카드(다른 팀원이 단계를 바꿀 때, 카드를 한 번 눌러 띄울 때, 위 단계 칩으로 거를 때), '파트 A · N컷' 머리줄 접고 펼치기, 화면에 처음 들어올 때 카드가 차례로 떠오르는 순간
- 종류/빈도/작업/위험: fix / daily / M / low

**지금**: 다른 팀원이 어떤 씬의 단계를 바꾸면, 원래 그 카드가 새 단계 색으로 한 번 번쩍여야 해요. 그런데 그 색이 카드 앞면에 가려 실제로는 보이지 않아요. 바꾼 사람 이름 동그라미만 2.5초 떠 있다가, 그게 사라지는 순간 카드 전체가 한 번 꺼졌다가 화면에 처음 들어올 때처럼 아래에서 다시 떠올라요. 오류처럼 보이는 깜빡임이에요. 카드를 한 번 누르면 그 카드는 부드럽게 떠오르는데, 나머지 카드는 같은 순간 '뚝' 어두워져요. 단계 칩으로 거를 때도 뚝 흐려져요. 접어 둔 파트를 펼치면 아래 파트 제목줄이 한 번에 '툭' 내려앉은 뒤 나머지만 미끄러져 내려가고, 접자마자 바로 다시 펼치면 카드가 아래 파트 제목줄 위에 겹쳐 보여요.

**바꾼 후**: 단계가 바뀐 카드 앞면이 새 단계 색으로 한 번 은은하게 물들었다 빠져요(약 0.9초). 이름 동그라미는 '톡' 나타났다 조용히 사라지고, 카드가 꺼졌다 다시 떠오르는 일은 없어져요. 나머지 카드는 떠오르는 속도에 맞춰 0.2초 동안 스르륵 어두워지고, 칩으로 거를 때도 같아요. 파트를 펼치면 서랍이 열리듯 카드가 위에서부터 드러나고 아래 파트도 처음부터 같은 속도로 내려가며, 접자마자 다시 펼쳐도 아래 파트 위로 삐져나오지 않아요. 처음 들어올 때 차례로 떠오르는 연출은 그대로 두되, 무거운 '흐렸다 선명해지는' 효과만 빼서 가볍게 해요.

**조심할 점**: 처음 들어올 때 카드가 '살짝 흐렸다 선명해지는' 효과는 한솔이 직접 다듬었던 부분이에요. 빼도 느낌이 거의 같은지 목업으로 먼저 확인받아요. 에피소드를 바꾸거나 처음 화면을 열 때 카드 수십 장이 한꺼번에 물들지 않게, 실제로 단계가 바뀐 카드만 물들게 해요.

**수치 사양(목업 기준)**: 장면: 컴포지팅 흉내. 파트 A(카드 12장, 6열×2줄, 카드 120×150, 위 색 블록 2칸 + 씬번호 'A012' + 상태 점 8px)와 파트 B(카드 6장 1줄)를 세로로 쌓음. 머리줄 '▶ 파트 A · 12컷'. 단계 색: 배치 #74B9FF, 취합중 #FDCB6E, 완료 #00B894. 버튼: [다른 사람이 A03 을 완료로], [카드 A05 클릭(띄우기)], ['완료만' 칩], [A 접기/펼치기], [↻ 첫 등장]. 지금: A03 오른쪽 위 이름 동그라미(20px)만 2.5초 표시되고, 사라지는 순간 카드가 opacity 0·scale .92·blur 2px 로 꺼졌다가 560ms 동안 다시 떠오름. A05 는 translateY(−18px) scale(1.045) 320ms 인데 나머지는 opacity .55 즉시. 칩 필터는 opacity .35 즉시. A 를 펼치면 둘째 줄 카드가 B 머리줄 위에 겹쳐 떠오르고 B 는 280ms 동안 내려감. ↻ 시 카드마다 blur 2px→0. 바꾸면: A03 앞면 위 완료색(#00B894) 층 opacity 0→.28(25% 지점)→0 900ms ease-out, 이름 동그라미 scale .6→1 220ms cubic-bezier(.2,.9,.3,1.2), 재등장 없음. 나머지 카드 opacity 1→.55 200ms ease, 칩 필터도 200ms. A 펼침은 칸 높이 0→실제 높이 280ms cubic-bezier(.22,1,.36,1), 그동안 칸 밖으로 안 나옴, 끝난 뒤 넘침 허용, 화살표 rotate 0→90deg 200ms. ↻ 등장은 translateY(14px) + scale(.92) → none 560ms cubic-bezier(.2,.7,.2,1), 카드 간 20ms 지연, 흐림 없음. 동작 줄이기: 물듦 200ms 1회, 재배치·등장 즉시.

<details><summary>개발 메모</summary>

깜빡 재등장: index.css:1503-1505 `.scene-card.flashing{animation: bf-status-flash 1200ms}`(0,2,0)가 같은 요소의 `.bf-cascade-item`(:1446-1448) animation 을 통째로 덮어씀. transientHighlightStore.ts:17 의 2500ms 뒤 클래스가 빠지면 animation-name 이 bf-cascade-in 으로 돌아가 backwards fill(opacity 0·blur·scale .92) + 지연(SceneCard.tsx:143 20ms*idx)으로 다시 재생됨. 핀 카드는 0.56초 동안 핀 위치(-18px)까지 덮임. 배경 플래시(:1497-1501)는 SceneCard.tsx:158 불투명 버튼에 가려 죽은 효과. 수정: .scene-card.flashing·bf-status-flash 규칙(:1497-1505, :1524)을 삭제하고, 버튼 안 마지막 자식으로 `<span key={washNonce} className='bf-status-wash'>`(absolute inset-0, rounded inherit, background var(tokenVar), @keyframes 0%{opacity:0} 25%{opacity:.28} 100%{opacity:0} 900ms forwards)을 둠. nonce 는 같은 episodeNumber 이고, 이전 state 가 있고, updatedAt 이 바뀐 커밋일 때만 증가(EP 전환·첫 로드에서 일괄 재생 금지). 아바타 SceneCard.tsx:252-263 진입은 scale .6→1 220ms. 셸 구조는 유지(cascade 를 래퍼로 옮기면 핀 카드 z-index 쌓임이 깨질 수 있음). 즉시 어두워짐: index.css:1470-1474 .scene-card transition 은 @layer 밖 규칙이라 SceneCard.tsx:130 transition-all 을 덮음 → 목록에 `opacity 200ms ease` 추가(:133 opacity-55/35). 배지 SceneCard.tsx:222-249 와 라벨 :173-183 은 마운트 키프레임(pop 220ms, 라벨 translateX(-4px) 160ms). 펼침 겹침: PartCardRow.tsx:150-159 가 처음부터 overflow visible + maxHeight max(320, contentHeight) 로 마운트됨 → 펼치는 동안은 overflow hidden 유지, transitionend(max-height) 후 visible. 시작값을 0 으로 하고 useLayoutEffect 에서 측정한 뒤 다음 rAF 에 목표값. 첫 마운트는 transition none. 가벼운 등장: @keyframes bf-cascade-in(:1435-1444)에서 filter 2줄 삭제, .bf-cascade-item will-change 삭제, reduce 블록(:1537-1541) 정리.

</details>

### 6. 단계 버튼 누르는 손맛 — 눌림·차오름·미끄러짐 + 카드 선택 체크 '톡' `stage-toggle-feel`

- 화면: 씬 목록 카드·시트의 LO/완료/검수/PNG 버튼, 액팅의 대기/작업중/피드백(리테이크 대기)/완료 칩, 여러 담당자 씬의 담당자별 버튼, 카드를 눌러 선택할 때 오른쪽 위 체크 동그라미
- 종류/빈도/작업/위험: polish / daily / M / low

**지금**: 단계 버튼을 누르면 눌리는 느낌 없이 배경색만 0.15초 만에 바뀌어요. PNG 를 누르면 앞 단계까지 네 칸이 동시에 켜지고, 진한 '현재 단계' 표시는 옆으로 옮겨 가는 게 아니라 제자리에서 흐려지고 진해져요. 액팅 칩도 색만 바뀌고, '작업중'을 누르는 순간 위에 '작업중 N차' 줄이 갑자기 생겨 카드가 덜컹 길어져요(같은 줄 다른 카드들도 같이 늘어나요). 카드를 눌러 고르면 테두리는 스르륵 보라가 되는데, 체크 동그라미는 '뚝' 나타나고 '뚝' 사라져요.

**바꾼 후**: 누르는 순간 버튼이 살짝 눌렸다가 톡 튕겨 올라와요. 켜진 칸은 색이 왼쪽에서 오른쪽으로 짧게 차오르고, PNG 처럼 여러 칸이 켜질 땐 LO→완료→검수→PNG 순서로 아주 짧게(전체 0.3초 남짓) 이어서 차올라요. 끌 때는 반대 순서로 빠져요. 액팅 칩은 색 알약 하나가 새 칩 자리로 미끄러지고, '작업중 N차' 표시는 카드 높이를 바꾸지 않는 자리(칩 묶음 위 모서리)에 살짝 떠오르며 나타나서 카드가 덜컹이지 않아요. 체크 동그라미는 '톡' 튀어나오며 안의 체크가 쓱 그려져요. 네 칸이 다 켜질 때 터지는 꽃가루는 이 항목에서 바꾸지 않아 두 화면이 똑같아요('동작 줄이기'를 켜도 터지는 것까지 같아요. 꽃가루는 17번에서 다뤄요).

**조심할 점**: 세 버튼 묶음이 카드·시트·상세 창 6곳에서 함께 쓰여서, 한 번 바꾸면 모든 화면에 반영돼요. 그만큼 시트처럼 칸이 좁은 곳에서도 어색하지 않은지 같이 확인해야 해요. 특히 넓은 화면에서 한 줄에 카드가 6장씩 놓이면 카드가 좁아져 '작업중 N차' 표시를 놓을 빈자리가 모자라니, 그때 놓을 자리를 따로 정해야 해요.

**수치 사양(목업 기준)**: 장면: 씬 카드 2장 나란히(각 300×220, #1A1D27, 보더 #2D3041, radius 12), 위에 '지금' / '바꾸면' 라벨. 카드 안: 씬번호 'A012'(14px #E8E8EE), 아래 BG 4칸 막대(각 칸 64×28, 간격 4, 라벨 LO/완료/검수/PNG 11px. 켜짐 색 LO #74B9FF·완료 #A29BFE·검수 #FDCB6E·PNG #00B894, 켜진 칸 배경 해당색 13%, 현재 단계 칸 100% + 흰 글자). 그 아래 액팅 칩 4개(대기/작업중/리테이크 대기/완료, 높이 26). 오른쪽 위 선택 체크 원(20px, #6C5CE7). 버튼: 카드 빈 곳 클릭=선택, 칸 클릭, [자동 재생 LO→PNG→LO]. 지금: 누름 반응 없음, 배경색만 150ms cubic-bezier(.4,0,.2,1)로 교체, PNG 클릭 시 4칸 동시, 현재 단계 진한 블록은 교차 페이드. 칩 활성 배경은 즉시 교체, '작업중' 선택 시 위에 '작업중 2차' 줄(높이 22)이 즉시 생겨 카드 높이 +22px. 체크 원은 즉시 등장·소멸. 바꾸면: 누르는 동안 scale .94 80ms, 떼면 scale 1 260ms cubic-bezier(.34,1.56,.64,1). 칸 채움 층은 scaleX 0→1(왼쪽 기준) 220ms cubic-bezier(.16,1,.3,1). PNG 클릭 시 LO→완료→검수→PNG 순서로 40ms 간격(총 약 340ms), 해제는 역순 40ms 간격. 현재 단계 칸은 채움 층 opacity .13→1 160ms. 칩은 알약 1개 translateX 260ms cubic-bezier(.2,.9,.3,1.1) + 배경색 200ms. '작업중 2차'는 칩 묶음 위 모서리 absolute 로 opacity 0→1 + translateY(4px→0) 180ms(카드 높이 불변). 체크 원은 scale .4→1 200ms cubic-bezier(.34,1.56,.64,1) + 체크선 그리기 160ms(60ms 지연), 해제는 scale .4 + opacity 0 120ms. 동작 줄이기: 눌림·채움·미끄러짐 없이 색만 즉시 전환.

<details><summary>개발 메모</summary>

StageSegmentToggle.tsx:87-108(transition-all 150ms + inline backgroundColor, :68-77 onPointerDown 즉시 onToggle, :active 없음). 각 버튼에 relative overflow-hidden + 자식 `<span class='stage-seg-fill' data-on data-current style='--i, --seg'>`, inline 배경 제거. CSS: `.stage-seg-fill{position:absolute;inset:0;background:var(--seg);transform:scaleX(0);transform-origin:left;opacity:.13;transition:transform 220ms cubic-bezier(.16,1,.3,1),opacity 160ms}`, `[data-on=true]{transform:scaleX(1);transition-delay:calc(var(--i)*40ms)}`, `[data-on=false]{transition-delay:calc((3 - var(--i))*40ms)}`, `[data-current=true]{opacity:1}`. 눌림은 `:active{transform:scale(.94);transition-duration:80ms}`, 기본 transform 260ms cubic-bezier(.34,1.56,.64,1). inline fontWeight 700 전환은 글자 폭(레이아웃)을 바꾸므로 굵기 고정. transition-all 은 transform/opacity/color 로 좁힘. ScenePhaseToggle.tsx:161-177 과 AssigneeProgressStack.tsx:121,171 은 radiogroup 안 absolute 알약 1개 translateX(calc(var(--idx)*(100% + gap))) 260ms cubic-bezier(.2,.9,.3,1.1). :100-122 차수 줄 `{showWorkRound && …}` 은 absolute 배치(높이 불변)로. grid-template-rows 펼침은 같은 줄 카드 전체를 재배치하니 피함. 선택 체크: ScenesView.tsx:1075-1084, UnifiedSceneCard.tsx:347-354 를 항상 렌더 + data-on, `.scene-select-check{transform:scale(.4);opacity:0;transition:transform 200ms cubic-bezier(.34,1.56,.64,1),opacity 120ms}`, path 는 stroke-dashoffset 12→0 160ms(60ms 지연), pointer-events none, top-1.5/top-9 위치 로직 유지(:1078). PNG 클릭은 sceneStageProgression.ts:8-23 buildSequentialStagePatch 로 앞 단계를 동시 변경 → 도미노는 CSS 지연만으로 표현. transition 이라 animation:none 토글 문제 없고, 전역 reduce CSS 가 자동 적용.

</details>

### 7. 선택 표시가 미끄러져 따라오기 — 사이드바·탭·보기 전환·검색 목록 (앱 전체 공통) `sliding-indicator`

- 화면: 왼쪽 사이드바 메뉴(대시보드~설정)와 리테이크·컴포지팅 숫자 배지, 씬 상세 창의 상세/리테이크/파일/히스토리 탭, 캘린더 '월·2주·주·오늘'·'카드·시간표', 씬 목록 '전체/시작 전/진행 중/완료', 리테이크·리테이크 허브·캐릭터의 보기 탭, 에피소드 카드/매트릭스, 타임라인 '전체·진행 중·완료', 빠른 검색(Ctrl+Space) 결과 목록, @멘션·#태그 목록
- 종류/빈도/작업/위험: new / daily / M / low

**지금**: 대시보드와 씬 목록 위쪽 탭만 보라 알약이 옆 칸으로 미끄러지고, 나머지는 이전 칸의 보라 배경이 꺼지고 새 칸이 제자리에서 켜지는 '깜빡 교체'예요. 사이드바에서 씬 목록·타임라인·캘린더처럼 무거운 화면을 누르면 새 화면이 다 그려질 때까지 선택 표시도 같이 기다려서, 누른 직후 잠깐 반응이 없어 보여요. 빠른 검색이나 @멘션 목록에서 ↑↓ 로 옮길 때도 줄마다 배경이 꺼졌다 켜지고, 리테이크 숫자 배지는 바뀌어도 숫자만 휙 바뀌어요.

**바꾼 후**: 선택 표시 하나가 이전 칸에서 새 칸으로 0.2초 남짓 미끄러지고, 탭 폭이 다르면 폭도 맞춰 늘었다 줄어요. 사이드바는 화면이 무거워도 손을 떼자마자 표시가 먼저 출발해서 '눌렸다'가 바로 보여요(다만 새 화면을 그리는 도중에 또 누른 건 그리기가 끝난 뒤 출발해요). 검색·멘션 목록의 강조 막대는 키를 누를 때마다 0.12초 만에 따라붙어요. 빠르게 연타해도 끊기지 않아요. 숫자 배지는 늘면 톡 커졌다 돌아오고, 0이 되면 작게 줄며 사라져요. 이미 미끄러지는 대시보드·씬 목록 탭도 같은 속도로 맞춰요.

**조심할 점**: 단축키나 알림 링크처럼 클릭 없이 화면이 바뀌는 경우에도 막대가 정확히 따라가야 해요. 창 크기가 바뀌어 메뉴 이름이 아이콘으로 줄어드는 경우도 함께 확인해요.

**수치 사양(목업 기준)**: 장면 3구역. A) 세로 사이드바(폭 200, 배경 #0F1117) 메뉴 6칸(높이 40, 간격 8: 대시보드/에피소드/씬 목록/캘린더/리테이크 ③/캐릭터), 활성 표시는 보라 알약(#6C5CE7 20%, radius 8) + 글자 #6C5CE7. 체크박스 '무거운 화면 흉내(클릭 후 0.4초 멈춤)', 버튼 '리테이크 +1'·'리테이크 0으로'. B) 가로 세그먼트 '월|2주|주|오늘'(각 56×28)와 밑줄형 탭 '상세|리테이크|파일|히스토리'(폭 서로 다름, 밑줄 2px #6C5CE7). C) 빠른 검색 패널(폭 520) 결과 10줄(그룹 헤더 '씬','담당자' 섞임, 줄 높이 36, 높이 넘쳐 스크롤), ↑↓ 버튼과 '빠르게 5번 연타'. 지금: 알약·밑줄·줄 배경이 이전 자리에서 180ms 꺼지고 새 자리에서 켜짐. 무거운 화면을 켜면 0.4초 아무 반응이 없다가 한꺼번에 바뀜. 배지 숫자 즉시 교체. 검색 목록 스크롤 즉시 점프. 바꾸면: 사이드바 알약 translateY 260ms cubic-bezier(.3,1.25,.5,1)(튕김 거의 없음), 무거운 화면이어도 클릭 즉시 출발. 세그먼트 알약 translateX 220ms cubic-bezier(.16,1,.3,1)(같은 폭). 밑줄은 translateX + width 220ms 같은 곡선. 검색 강조 막대는 translateY(+height) 120ms cubic-bezier(.2,0,0,1), 연타하면 진행 중 위치에서 새 목표로 이어짐. 목록 스크롤은 즉시. 배지는 늘 때 scale 1→1.25→1 220ms cubic-bezier(.2,0,0,1), 0 이 되면 scale .6 + opacity 0 120ms. 동작 줄이기: 표시 즉시 이동, 배지 숫자만 교체.

<details><summary>개발 메모</summary>

공용 훅 useSlidingIndicator(containerRef, activeKey, axis): useLayoutEffect 에서 활성 요소의 offsetLeft/Top/Width/Height 를 재서 절대위치 표시 1개에 transform translate3d + (탭이면) width 를 줌. 첫 측정 전과 reduce 일 때는 style.transition 을 비움(클래스 토글 금지). 폭 변화는 ResizeObserver 로 추적(compact-label-container). 사이드바: Sidebar.tsx:372-378 은 버튼마다 bg 교체 + :368 setView 가 App.tsx:3098-3143 renderView 와 같은 커밋 → 로컬 optimisticView 를 flushSync 로 먼저 그리고 setView 는 requestAnimationFrame→setTimeout 으로 다음 프레임에. 단축키·딥링크·goBackNavigation 처럼 클릭 없이 바뀔 때도 currentView 를 따라감. 휴가 숨김·playground 필터 때문에 인덱스가 아니라 ref Map 사용. aside overflow-hidden 안에 relative 래퍼. hover 펼침(width 350ms)과 겹치지 않게 세로 이동만. 배지 :402-419 는 이전 값 ref 비교 후 WAAPI scale 1→1.25→1 220ms, 0 이 되면 언마운트 전 120ms 축소(useMotionPref 가드). 적용처: UnifiedSceneDetailModal.tsx:1309-1314(밑줄을 활성 탭에만 렌더), ScheduleView.tsx:1641-1684(세그먼트는 같은 폭으로 맞춰 translateX 만 — 보기 전환과 같은 순간의 무거운 마운트와 겹치므로 width 전환 회피), EventQuickEdit.tsx:431-450, GanttView.tsx:226 + gantt.css aria-pressed, ScenesView.tsx:5651-5666(상태 필터 4버튼만, 기존 layoutId 패턴 5439-5446 과 같게, 색은 animate={{backgroundColor}}), CompositingView.tsx:636-676, RetakeHubView.tsx:474-488, CharacterBoardView.tsx:469-548·756(TabButton :57), EpisodeView.tsx:457-480, SettingsSidebar.tsx:176-185. 목록 강조: SpotlightSearch.tsx:749-760 행 bg 제거, 결과 컨테이너 안 absolute 막대(그룹 헤더가 섞여 있으니 [data-idx] offsetTop 측정), :659-662 scrollIntoView 는 scrollTop 직접 조정으로(꾹 누름 대비 즉시), 쿼리 변경 시 1회 transition none. MentionDropdown.tsx:21-40·HashtagDropdown.tsx:20-48 동일, scrollIntoView 는 scrollTop 으로(lessons 2026-10-02). 기존 Dashboard.tsx:965/989/1045/1070, ScenesView.tsx:5440/5470 layoutId 는 유지하고 spring 만 맞춤.

</details>

### 8. 창·메뉴가 모두 같은 박자로 떠오르기 — 확인 창, 알림 창, 우클릭 메뉴, 아래 일괄 변경 바 (앱 전체 공통) `popup-rhythm`

- 화면: 삭제 등을 묻는 확인 창, 좌하단 버전 버튼 → 업데이트 내역 창, 비밀번호 변경 창, 리테이크 '새 리테이크 등록', 리테이크 허브 항목 추가·가져오기·새 세트 창, 헤더 종을 누르면 열리는 알림 창, 헤더 내 이름 메뉴, 씬 카드·시트·타임라인·캘린더 목록 '…'·태그 관리·휴가 관리의 우클릭/작은 메뉴, 컴포지팅 아래 'N개 선택 · 일괄 변경' 바
- 종류/빈도/작업/위험: polish / daily / M / low

**지금**: 필터 펼침 메뉴는 살짝 내려오며 열리는데, 확인 창·업데이트 내역 창·비밀번호 변경·새 리테이크 등록 창은 움직임 없이 '뚝' 나타나요. 알림 창·내 이름 메뉴·씬 카드 우클릭 메뉴·타임라인 우클릭 메뉴·캘린더 목록 '…' 메뉴도 '뚝'이에요. 일정 우클릭 편집창은 가운데에서 커지고, 리테이크 허브 창들은 열릴 땐 커지며 나오는데 닫힐 땐 뚝 꺼져요. 같은 '작은 창 열기'인데 화면마다 박자가 제각각이에요. 확인 창은 라이트 모드에서도 어두운 색 그대로예요. 컴포지팅에서 카드를 누르면 아래 일괄 변경 바가 툭 생기고 툭 사라져요.

**바꾼 후**: 큰 창은 뒤 배경이 0.15초 동안 어두워지며, 창이 살짝 아래·살짝 작은 크기에서 0.18초 만에 떠올라요(캐릭터 화면 창들이 0.2초에 뜨는 것과 거의 같은 박자예요). 작은 메뉴와 알림 창은 누른 자리 쪽 모서리에서 0.14초 만에 피어나요. 알림 창은 종 아래에서, 이름 메뉴는 이름 아래에서, 우클릭 메뉴는 누른 지점에서요. 일괄 변경 바는 아래에서 살짝 올라오고, 선택 개수가 바뀌면 숫자가 톡 바뀌어요. 바가 떠 있는 동안 다른 카드를 연달아 눌러도 다시 튀어 오르지 않아요. 닫을 때는 지금 원칙대로 바로 사라져서 다음 동작을 막지 않아요. 확인 창 색도 라이트 모드에 맞춰요(화면 안 '라이트 모드' 버튼으로 비교할 수 있어요).

**조심할 점**: '닫힘은 바로'가 지금 원칙이라 그대로 따랐어요. 원하면 닫힐 때도 0.12초 가라앉게 바꿀 수 있어요(목업에서 비교 가능). 뒤를 흐리게 비추는 유리 창은 열리는 동안 흐림이 잠깐 꺼졌다 켜지지 않도록 구조를 함께 정리해야 해요.

**수치 사양(목업 기준)**: 장면: 어두운 작업 화면(#0F1117)에 씬 카드 4장(각 200×140)과 헤더(오른쪽 종 아이콘 + 빨간 배지 3, '배한솔 ▾'). 버튼: [씬 삭제(확인 창)], [종], [배한솔 ▾], 카드 우클릭(실제 contextmenu, 화면 오른쪽 끝 카드 포함), [카드 2장 선택(아래 일괄 바)], [라이트 모드], [빠르게 3번 열고 닫기]. 확인 창은 360×180 #1A1D27, 오버레이 rgba(0,0,0,.5). 알림 창은 320×360, 이름 메뉴는 208×160, 우클릭 메뉴는 180×140, 일괄 바는 높이 48 폭 420 하단 중앙. 지금: 모두 0ms 등장·소멸(확인 창은 라이트 모드에서도 어두운 색), 일괄 바 즉시, 숫자 즉시. 바꾸면: 오버레이 opacity 0→1 150ms ease-out(흐림 없음), 큰 창 opacity 0→1 + translateY(6px) scale(.98)→none 180ms cubic-bezier(.16,1,.3,1). 종 패널·이름 메뉴는 기준 top right, opacity 0→1 + translateY(−4px) scale(.97)→none 140ms cubic-bezier(.16,1,.3,1). 우클릭 메뉴는 클릭 지점 쪽 모서리 기준 같은 값(오른쪽 끝에서 뒤집히면 기준도 뒤집힘). 일괄 바는 translateY(16px) scale(.98)→none + opacity 180ms 같은 곡선, 숫자 변경은 translateY(4px→0) + opacity .4→1 140ms, 떠 있는 동안 재선택해도 재등장 없음. 닫힘: 기본 즉시. 토글 '닫힘도 부드럽게'를 켜면 opacity→0 + translateY(4px) scale(.98) 120ms cubic-bezier(.4,0,1,1). 동작 줄이기: opacity 만 100ms.

<details><summary>개발 메모</summary>

공용 키프레임: 큰 창은 기존 char-overlay-in/char-modal-in(index.css:1548-1556, 200ms ease-out, scale .98→1)을 재사용하거나 bf-modal-in 별칭. 작은 메뉴는 `@keyframes bf-pop-in{from{opacity:0;transform:translateY(-4px) scale(.97)}} .bf-pop{animation:bf-pop-in 140ms cubic-bezier(.16,1,.3,1) backwards;transform-origin:var(--pop-origin, top right)}`. 퇴장은 두지 않음(index.css:1544-1546 '과잉 금지' 원칙). 적용: ConfirmDialog.tsx:62-99(색 하드코딩 :73·:76 → bg-bg-card/border-bg-border/text-text-primary, resolve·pendingRef 흐름은 그대로), UpdateCenterModal.tsx:233 + :322 backdrop-blur-sm → bg-black/60 단색(플렉서스 위에서 매 프레임 재블러), PasswordChangeModal.tsx:43, UserManagerModal.tsx:103, NewRevisionModal.tsx:301-311, RevisionAddModal.tsx:214-217·RevisionImportModal.tsx:129-131·RevisionSetCreateModal.tsx:86-88(framer scale/y → 같은 CSS), NotificationPanel.tsx:276·:351-360(흐림 없는 floatingSolidStyle 변형 + 판 자신에 bf-pop, backwards 라서 리사이즈 핸들 좌표 영향 없음), UserMenu.tsx:48-49, ui/ContextMenu.tsx:50-65(위치 보정 :22-32 를 useLayoutEffect 로, origin 은 보정 결과에 맞춤), SceneContextMenu.tsx:65-80, GanttDialogs.tsx:39(gantt.css .gantt-context), CalendarRail.tsx:89-93, TagManagerPopover.tsx:669-684, VacationView.tsx:719-720, VacationDeleteListModal(:181 `if (!open) return null` → AnimatePresence 로 exit 살리기), EventQuickEdit.tsx:399-404(origin 을 커서 모서리로). Backdrop Root 주의: opacity<1 조상 아래 backdrop-filter 는 바깥을 못 봄(Chromium 실측) → 오버레이와 창은 형제로 두고, 흐림 판 자신에게 애니메이션(VacationRegisterModal.tsx:170-186, GlassDropdown.tsx:197-226 동일 문제). 일괄 바: BulkActionBar.tsx:56 즉시 return null → 바깥 래퍼(fixed inset-x-0 bottom-7 flex justify-center pointer-events-none)가 가운데 정렬을 맡고 안쪽 바에 WAAPI 진입 180ms, size 0 이면 leaving 상태로 140ms 뒤 언마운트(퇴장 중 재선택은 cancel 후 진입), :64-65 backdropFilter 제거, 숫자는 <span key={size}> 140ms. reduce 는 전역 CSS + WAAPI 는 useMotionPref.

</details>

### 9. 팀원이 바꾼 순간이 보이게 — 바뀐 카드 은은한 빛·이름표, 담당자 카드 반짝, 최근 작업 새 줄 스르륵 `teammate-live`

- 화면: 씬 목록 카드·시트(팀원이 같은 파트를 체크할 때), 대시보드 '담당자별 현황'(EP 담당자별 현황 포함), 대시보드 '최근 작업' 목록
- 종류/빈도/작업/위험: new / daily / M / low

**지금**: 다른 팀원이 같은 파트에서 검수를 체크하면, 내 화면에서는 그 칸 색이 0.15초 만에 조용히 바뀌는 게 전부예요. 내 담당 씬일 때만 알림이 뜨고, 그 밖에는 수십 장 중 어디가 바뀌었는지, 누가 바꿨는지 카드만 봐서는 알 수 없어요. 대시보드 담당자 카드도 %와 '7/12씬'이 뚝 바뀌기만 해요. '최근 작업' 목록은 새 활동이 맨 위에 뚝 끼어들고 아래 줄이 한 번에 툭 밀려요. 같은 사람이 연달아 한 같은 작업은 '묶음'으로 접히는데, 묶음에 새 활동이 붙을 때마다 묶음이 통째로 새로 만들어져요. 그래서 내 묶음은 닫혔다 다시 펼쳐지며 덜컹이고, 남의 묶음을 펼쳐 보고 있었다면 그 사람이 같은 작업을 또 하는 순간 저절로 접혀요.

**바꾼 후**: 팀원이 바꾼 카드는 테두리가 은은하게 한 번 빛났다 가라앉고(약 1.5초), 카드 위 가운데에 '김지은 · 검수 ✓' 작은 이름표가 내려왔다가 2초 뒤 사라져요. 내가 바꾼 것은 빛나지 않아요. 일괄 작업처럼 한꺼번에 여러 씬이 바뀌면 이름표 없이 몇 장만 짧게 빛나요. 담당자 카드는 진행률이 오른 사람만 바탕이 보랏빛으로 한 번 은은하게 반짝이고, 씬 하나를 끝까지 완료한 순간에만 '+1씬'이 작게 떠올라요. '최근 작업'은 새 줄이 위에서 살짝 내려오며 나타나고, 1.5초 동안 옅은 보랏빛 바탕이 남아 '방금 생긴 것'이 보여요. 묶음은 그대로 두고 'N건' 숫자만 바뀌며, 펼쳐 둔 묶음은 열린 채로 유지돼요.

**조심할 점**: 하루 종일 켜 두는 화면이라 너무 자주 번쩍이면 거슬릴 수 있어요. 그래서 빛은 은은하게, 이름표는 팀원이 한 장씩 바꾼 경우에만, 동시에 빛나는 개수는 상한을 둬요. 보던 목록 위치는 지금처럼 유지돼요.

**수치 사양(목업 기준)**: 장면 2구역. A) 씬 카드 8장(4×2, 각 220×150), 각 카드 하단 4칸 단계 막대(LO #74B9FF/완료 #A29BFE/검수 #FDCB6E/PNG #00B894). B) 오른쪽 대시보드 유리 위젯 2개: '담당자별 현황' 카드 6장(2열, 이름·'7/12씬'·'58%'·4px 막대), '최근 작업' 목록 6줄(아바타·이름·'LO 체크'·'방금') + '배한솔 · 5건' 묶음(펼친 상태). 버튼: [김지은이 A03 검수 체크], [내가 A05 체크], [일괄 30개 변경], [같은 사람이 또 체크(묶음에 추가)], [남의 새 활동]. 지금: A03 검수 칸 색만 150ms 교체. 담당자 카드 숫자 즉시, 막대 width 700ms. 최근 작업 맨 위 줄이 즉시 끼어들고 아래 줄이 한 번에 36px 밀림. 묶음 추가 시 묶음이 높이 0→auto 200ms 로 다시 펼쳐지는 덜컹(남의 묶음이면 접힘). 바꾸면: A03 테두리 링(1.5px #6C5CE7 90%) opacity 0→1(15% 지점)→0 1500ms cubic-bezier(.16,1,.3,1). 카드 위 가운데 이름표 '김지은 · 검수 ✓'(높이 20, #1A1D27, 보더 #6C5CE7, 11px)가 translateY(−6px→0) + opacity 180ms ease-out 으로 등장, 2.2초 뒤 220ms ease-in 퇴장. 내 체크는 빛 없음. 일괄 30개는 이름표 없이 링만, 최대 8장. 담당자 카드는 바탕 보라 18% 층 opacity 0→1(15%)→0 1300ms, 씬 완료 때만 '+1씬'(11px #A29BFE) translateY(4px→−10px) + opacity 0→1→0 1100ms. 최근 작업 새 줄은 opacity 0→1 250ms + 목록 translateY(−36px→0) 260ms cubic-bezier(.16,1,.3,1) + 새 줄 바탕 보라 12% opacity 1→0 1600ms. 묶음 추가는 묶음 유지, 'N건' 숫자만 교체. 동작 줄이기: 링·이름표는 움직임 없이 1.5초 정적 표시, 이동 없음.

<details><summary>개발 메모</summary>

씬: App.tsx:2492-2496('scene-update' broadcast → updateSceneByUuid, senderId 는 :2498-2513 내 씬 알림에만 쓰임), :2522-2535('scene-phase-update'), postgres UPDATE 경로 App.tsx:1830-1835(보낸 사람 정보 없음 → payload.new.updated_by 와 현재 사용자 비교, electron/supabase.ts:702 기록 형식 확인 필요). 새 zustand useSceneFlashStore: Record<uuid,{kind,by,stage,value,at}>, 2.5s 자동 삭제(타이머 1개로 묶어 정리). BG 체크 1번에 단계 수만큼 신호가 연달아 옴(ScenesView.tsx:4031-4045 → electron/broadcast.ts:170) → 같은 씬에 400ms 안에 다시 오면 빛을 재시작하지 말고 이름표 글자만 갱신. 300ms 안 20건 초과(일괄)면 이름표 생략, 동시 링 최대 8. SceneCard 는 memo 가 아니므로(ScenesView.tsx:955) 카드 내부에서 `useSceneFlashStore(s => s.flashes[id])` 셀렉터로만 구독. 렌더 `<span key={flash.at} className='scene-remote-ring'/>`(absolute inset -1px, border 1.5px accent .9, @keyframes 15%{opacity:1} 100%{opacity:0} 1.5s cubic-bezier(.16,1,.3,1) forwards) — key 재마운트로 재시작, box-shadow 애니메이션 금지. 이름표 위치는 가운데(왼쪽 -top-3 은 편집 중 이름표 :1062, 오른쪽은 링크 배지 :1067-1071). 시트 행은 UnifiedSceneSheetView.tsx:1175 근처 td:first-child ::after. 담당자 카드: AssigneeCardsWidget.tsx:37-57(calcStats.ts:142-149 순서 고정), episode/EpAssigneeCardsWidget.tsx:40-51 — prevRef Map, 첫 실행은 저장만, dashboardFilter/episodeDashboardEp 변경 시 리셋, 동시 반짝 상한 6, `<span key>` assignee-flash 1.3s + assignee-delta(씬 완료 시만) 1.1s. 최근 작업: activity/utils.ts:128 묶음 key 가 buffer[0](최신, :99 내림차순) id → 가장 오래된 항목 id 로(5분 창을 넘는 연속 활동에서는 여전히 바뀔 수 있음). ActivityFeed.tsx:238 open 상태를 Map<groupKey,boolean> 으로 끌어올림, :287 AnimatePresence initial={false}. seenIdsRef 로 새 줄만 feed-row-new(opacity 250ms + ::after accent/12 1.6s). 맨 위(scrollTop 0)일 때만 내용 래퍼에 WAAPI translateY(−h→0) 260ms. 스크롤이 내려가 있으면 Chromium 스크롤 앵커링이 이미 위치를 유지하므로 수동 보정 전에 실측. useMotionPref 가드.

</details>

### 10. 진행률 숫자가 막대와 함께 또르륵 굴러가며 바뀌기 `rolling-numbers`

- 화면: 대시보드 전체 진행률 원 가운데 큰 %, 숫자 카드, 부서별 비교 %, 에피소드 대시보드 EP 진행률, 씬 목록 위 진행률 막대 옆 %, 씬 카드 오른쪽 위 %, 진행률 원 아래 명언
- 종류/빈도/작업/위험: polish / daily / M / low

**지금**: 진행률 원의 색 띠와 막대는 0.7초 동안 부드럽게 늘어나는데, 옆의 % 숫자는 그 순간 바로 바뀌어서 막대와 따로 놀아요. 파트·에피소드를 바꿔 42%→78% 처럼 크게 바뀔 때 특히 어색해요. 팀원이 체크해 0.1%만 움직여도 원 아래 명언이 거의 매번 다른 문구로 바뀌어서 산만해요. 25%·50%·75%를 넘는 순간에는 새 색 띠가 이어지지 않고 툭 생겨요(여러 씬이 한꺼번에 바뀔 때 눈에 띄어요).

**바꾼 후**: 바뀐 자릿수만 '또르륵' 굴러 새 숫자에서 멈춰요(약 0.5초). 오를 땐 위로만, 내릴 땐 아래로만 굴러서 중간에 엉뚱한 숫자가 스치지 않아요. 42→78 처럼 큰 변화는 숫자가 막대와 같은 속도로 함께 올라가요. 화면을 처음 열거나 탭·에피소드를 바꾼 직후에는 굴리지 않고 바로 보여 줘요. 숫자 폭은 고정해서 흔들리지 않아요. 명언은 진행 구간(예: 25~50%)이 실제로 바뀔 때와 원래 8초 주기에만 바뀌어요. 경계를 넘어도 색 띠가 끊기지 않고 이어서 늘어나요.

**조심할 점**: 숫자가 굴러가는 동안 큰 화면 전체를 다시 그리지 않도록, 숫자 칸만 따로 움직이게 만들어야 해요. 숫자 띠를 0~9 한 줄로만 만들면 9→0 으로 넘어갈 때 거꾸로 되감기며 엉뚱한 숫자가 스쳐 보이니, 자동차 주행거리계처럼 한 방향으로만 감기게 해야 해요. 탭을 바꿀 때마다 모든 숫자가 굴러가면 오히려 산만하니 그때는 끄는 게 핵심이에요.

**수치 사양(목업 기준)**: 장면: 카드 2장 '지금/바꾸면'(각 320×300, #1A1D27). 위: 4색 진행률 원(지름 160, 두께 14, 구간색 0~25 #74B9FF, 25~50 #A29BFE, 50~75 #FDCB6E, 75~100 #00B894), 가운데 '45.2%' 32px 굵게 #E8E8EE, 아래 명언 한 줄 12px #8B8DA3. 아래: 진행률 막대(높이 6, 트랙 #2D3041) + 오른쪽 '42%'. 버튼: [팀원 체크 +0.4%], [경계 넘기 24.8→25.3%], [파트 바꾸기 42→78%], [처음 열기], [연타 5번]. 지금: 숫자 즉시 교체. 원·막대는 700ms ease-out. 명언은 버튼마다 다른 문구로 0.5초 페이드(+y 8px). 경계 넘기면 새 호가 툭 생기고 둥근 끝이 순간이동. 바꾸면: 바뀐 자리의 숫자 띠가 translateY 500ms cubic-bezier(.16,1,.3,1)(소수점·% 고정, 폭 고정). 42→78 은 숫자가 막대와 같은 500ms cubic-bezier(.16,1,.3,1)로 카운트업. 원 호 4개가 항상 있어 경계를 넘어도 이어서 늘어남. 명언은 같은 구간이면 유지. [처음 열기]는 굴림 없이 최종값. 연타하면 진행 중 위치에서 새 값으로 이어짐. 동작 줄이기: 숫자 즉시 교체, 막대·원 즉시.

<details><summary>개발 메모</summary>

숫자 즉시 교체 위치: OverallProgressWidget.tsx:216 `{pct}%`, charts/StatCard.tsx:16(감사 :155 는 오기), charts/DonutChart.tsx:72, DepartmentComparisonWidget.tsx:188-190·214-216, episode/EpOverallProgressWidget.tsx:77·96, ScenesView.tsx:5797(overallPct, :3823 반올림 정수라 체크 1번은 대부분 0~1% 변화), 카드 :1127-1129, AssigneeProgressStack.tsx:215-217·240-242. 신규 charts/RollingNumber.tsx: 숫자 자리마다 overflow hidden 열 + 0~9 띠 translateY(-d*10%) CSS transition .5s cubic-bezier(.16,1,.3,1), '.'·'%' 고정, tabular-nums, 열 key 는 오른쪽 기준 자릿수(9.9→10.0 대응), 첫 렌더와 dashboardFilter/episodeDashboardEp 변경 직후에는 transition 없음(data-ready). 큰 변화(≥5%p)는 카운트업(DonutHero.tsx:29-51 useCountUp 을 src/hooks/useCountUp.ts 로 이전)을 쓰되, ScenesView 같은 큰 뷰에서 setState 하지 말고 작은 <CountUp> 컴포넌트로 격리. React 가 children 을 소유한 텍스트를 textContent 로 덮지 말 것. 새 CSS 에 !important 를 쓰지 않으면 전역 reduce 규칙이 자동 적용. 명언: :128 useMemo(getMessagePool(pct)) + :141-143 setMsgIdx(random) → bucketOf(pct) 의존. 도넛 연속성: :112-125, :198-212 key={i} 필터 → COLOR_SEGMENTS 4개를 항상 렌더(key=seg.min, 비활성은 길이 0), :209 round cap 은 모두 butt + 끝점 원. ScenesView.tsx:5793 transition-all → transition-[width](그라데이션은 보간 안 됨). 막대를 translateX 로 바꾸는 건 progressGradient 모양이 바뀌므로 하지 않음.

</details>

### 11. 항목을 바꿔 볼 때 창 틀은 제자리, 내용만 스르륵 — 옆 상세 창·날짜 카드·캐릭터 그림 `content-swap-in-place`

- 화면: 캘린더 일정 막대를 눌러 여는 오른쪽 상세 창, 리테이크 '선택 리테이크' 칸, 휴가 '선택한 날짜' 카드, 타임라인 작업·프로젝트 상세 창, 캐릭터 카드의 ‹ › 복장 넘기기와 캐릭터 상세 창의 복장·캐릭터 바꾸기
- 종류/빈도/작업/위험: fix / daily / M / low

**지금**: 캘린더 상세 창이 열린 채로 다른 일정을 누르면, 기존 창이 오른쪽으로 빠지는 동시에 새 창이 들어와서 두 장이 0.25초 동안 엇갈려 덜컹거려요. 리테이크는 다른 항목을 누르면 칸이 하나 더 생겨 두 칸이 나란히 접히고 펼쳐지며 글자가 잘린 채 밀려요. 휴가는 다른 날짜를 누를 때마다 카드가 위로 빠졌다가 아래에서 다시 올라오고, 아래 '내 휴가 내역'이 들썩여요. 타임라인 상세 창은 아무 연출 없이 뚝 생기고 차트가 갑자기 좁아져요. 캐릭터 그림은 복장을 넘기면 그 자리에서 뚝 바뀌어요.

**바꾼 후**: 창이 처음 열릴 때만 오른쪽에서 살짝 밀려 들어오고, 이미 열린 상태에서 다른 항목을 누르면 창 틀은 가만히 있고 제목·날짜·메모 같은 내용만 0.14초 동안 살짝 떠오르며 바뀌어요. 맨 위 색 띠는 새 색으로 바로 바뀌어요. 타임라인 상세 창도 처음 열릴 때 오른쪽에서 밀려 들어와요. 캐릭터 그림은 옛 그림 위로 새 그림이 겹쳐 떠오르며, 누른 쪽(‹ 은 왼쪽, › 는 오른쪽)에서 살짝 밀려 들어와요. 새 그림이 준비된 다음에 바뀌어서 빈 칸이 번쩍이지 않아요.

**조심할 점**: 캘린더 상세 창에서 편집하던 도중에 다른 일정을 누를 때, 지금처럼 작성 중인 내용이 안전하게 처리되는지 꼭 확인해야 해요. 리테이크 칸도 메모를 쓰던 도중에 항목을 바꾸면 지금처럼 새 항목 기준으로 비워져야 해요.

**수치 사양(목업 기준)**: 장면: 왼쪽 월간 칸 4개 + 일정 막대 3개(A 보라 #6C5CE7 '디자인 리뷰', B 노랑 #FDCB6E 'EP12 검수', C 초록 #00B894 '배경 마감'). 오른쪽 280px 상세 창(#1A1D27, 맨 위 4px 색 띠, 제목 16px, 날짜 12px #8B8DA3, 메모 3줄). 아래 작은 장면: 캐릭터 카드 1장(160×200, 색 일러스트 블록 3종을 복장으로) + ‹ › 버튼. 버튼: [막대 A→B→C 차례 클릭(0.5초 간격)], [닫기], [‹], [›]. 지금: 클릭할 때마다 창 2장이 오른쪽 300px 에서 엇갈려 250ms 겹쳐 움직임. 캐릭터 그림 즉시 교체. 바꾸면: 첫 클릭만 창 translateX(24px)→0 + opacity 0→1 250ms cubic-bezier(.16,1,.3,1). 이후 클릭은 창 고정, 색 띠 즉시 새 색, 제목·날짜·메모만 opacity 0→1 + translateY(4px→0) 140ms ease-out. 닫기는 translateX(24px) + opacity 0 180ms. 캐릭터 그림은 새 그림 opacity 0→1 + translateX(±6px→0) 160ms ease-out(누른 방향에서), 옛 그림은 아래층에서 160ms 뒤 제거. 동작 줄이기: 창·내용·그림 모두 opacity 만 100ms.

<details><summary>개발 메모</summary>

캘린더: ScheduleView.tsx:1884-1887 AnimatePresence 자식 key 가 `panel-${calendarEventIdentityKey}` 라 교체 시 퇴장·등장 동시. EventSidePanel.tsx:97-101 x 300 슬라이드, :441 같은 자리 absolute, :444-445 floatingGlassStyle(배경 .95 → backdropFilter none). 800줄 패널의 상태를 옮기는 리팩터는 위험하므로, AnimatePresence custom 으로 '교체 중' 신호를 넘겨 교체일 때만 퇴장 duration 0 + 새 패널 initial=false + 본문 CSS 페이드(calendarPanelSwap 140ms). 이렇게 하면 key 재마운트로 상태가 초기화되는 지금 동작을 유지. 첫 열기·닫기는 transform 문자열 + transitionEnd. ScheduleView 의 MotionConfig 는 transform 문자열을 막지 못하므로 useMotionPref 로 가드. :455 색 띠는 linear-gradient 라 보간 불가 → 즉시 교체. 같은 처방을 EventCreateModal.tsx:238-244, CalendarSettingsModal.tsx:790-800 에도(유리 + framer x 40). 리테이크: CompositingView.tsx:757-769 + RevisionDetailPanel.tsx:112-117 width 0↔380(메인 스레드, 목록 재배치) → 바깥 motion 셸(키 없음, 열기/닫기만 width) + 안쪽 내용 컴포넌트(key=revision.id). 상태 :49-56 은 안쪽으로 옮겨야 항목마다 초기화. :179 elevatedGlassStyle → 불투명 카드. 휴가: VacationView.tsx:994-1001 mode 'wait' 제거, 자식 key 상수, 안쪽 div key={selectedDate} + CSS vacDetailSwap 120ms, backdrop-blur-sm 제거(/60 → /90). 높이 애니메이션 금지. 타임라인: gantt.css:11 .gantt-inspector 에 `animation: gantt-inspector-in .2s cubic-bezier(.16,1,.3,1)`(from opacity 0, translateX(16px)), GanttView.tsx:232. GanttInspector 는 key 가 없어 교체 시 재생되지 않음(의도). LinkedCalendarPanel 은 key(:233)가 작업마다 바뀌므로 바깥 래퍼에 걸 것. width 전환 금지. 캐릭터: CharacterImageFrame.tsx:108-117 에 opt-in crossfade/direction prop(이전 url 을 아래 레이어로 두고, 새 img 를 decode() 후 opacity 1 + translateX(dir*6px→0) 160ms, transitionend 에서 이전 레이어 제거), CharacterCard.tsx:69-75·116-123, FeaturedImageSlot.tsx:540-545 에만 켬. CharacterDetailModal.tsx:926 main 에 useLayoutEffect([selectedId]) WAAPI opacity + translateY(4px) 140ms(리마운트하지 않아 내부 상태 보존).

</details>

### 12. 화면·파트·에피소드를 바꿀 때 한 덩어리로 스르륵 (+대시보드 탭은 판 그대로 내용만) `view-transition`

- 화면: 사이드바로 화면을 옮길 때, 씬 목록 왼쪽 에피소드 트리에서 파트·에피소드를 바꿀 때, 컴포지팅 에피소드 칩·‹ › 를 누를 때, 대시보드 위쪽 통합/배경/액팅 탭과 에피소드 선택, 휴가 달력 ◀ ▶
- 종류/빈도/작업/위험: new / daily / L / medium

**지금**: 사이드바 메뉴를 누르면 화면이 통째로 '뚝' 바뀌고, 처음 여는 화면은 가운데 로딩 동그라미가 잠깐 번쩍여요. 들어오는 모습도 화면마다 달라요. 인원별·팀원은 카드가 줄줄이 올라와 20명쯤이면 마지막 카드까지 0.9초 가까이 걸리고, 리테이크 허브·캐릭터·설정은 아무 움직임이 없어요. 씬 목록에서 파트를 바꾸면 카드 묶음이 그 자리에서 뚝 바뀌어요(시트는 줄마다 따로 조금씩 늦게 떠올라 무거워요). 컴포지팅에서 에피소드를 바꾸면 그림만 제자리에서 바뀌고, 새로 생긴 카드만 따로 떠올라요. 대시보드 탭을 바꾸면 위젯이 0.15초 사라졌다가 다시 나타나는데, 그 사이 위젯의 흐린 유리가 풀려 뒤 배경 선이 또렷하게 비쳤다가 끝에 '툭' 흐려지고, 오른쪽에 있는 위젯일수록 옆으로 0.35초 쓸리며 자리를 잡아요(메뉴로 대시보드에 들어올 때도 같아요). 휴가 달을 넘기면 보던 달이 다 빠져나간 '다음에야' 새 달이 들어와 잠깐 빈 화면이 보여요.

**바꾼 후**: 어느 메뉴로 가든 새 화면이 0.18초 동안 서서히 드러나는 한 가지 방식으로 맞춰요. 로딩 동그라미는 0.25초 넘게 걸릴 때만 보이고, 메뉴에 마우스를 올리는 순간 그 화면을 미리 준비해 둬요. 카드가 차례로 올라오는 연출은 남기되 마지막 카드도 0.2초 안에 출발해 0.4초면 모두 도착해요. 파트·에피소드를 바꾸면 카드 묶음 전체가 한 덩어리로 살짝(6~16px) 미끄러지며 나타나요. 다음 에피소드는 오른쪽에서, 이전 에피소드는 왼쪽에서 들어와요. 대시보드 탭은 위젯 판을 제자리에 두고 안쪽 내용만 0.18초 동안 다시 드러나며 숫자와 막대는 새 값으로 흘러가게 해서, 유리가 풀리는 깜빡임과 빈 순간을 없애요. 메뉴로 대시보드에 들어올 때 오른쪽 위젯이 옆으로 쓸려 오던 것도 처음부터 제자리에 그려서 없애요. 휴가 달 넘김은 캘린더 화면처럼 나가는 달과 들어오는 달이 겹쳐서 넘어가요. 탭·에피소드·달을 빠르게 연달아 누르면 미끄러지거나 다시 드러나는 연출 없이 바로 바뀌어요(대시보드의 숫자와 막대는 새 값으로 이어서 흘러가요).

**조심할 점**: 새 화면을 그리는 순간과 움직임이 겹치기 때문에 저사양 PC 에서 꼭 확인해야 해요. 대시보드 탭은 위젯을 새로 만들지 않게 바꾸는 작업이라, 위젯마다 펼침·스크롤 같은 상태가 그대로 유지되는지 점검해야 해요. 알림 링크로 들어가자마자 씬 창이 열리는 경우에는 이 연출을 건너뛰어요.

**수치 사양(목업 기준)**: 장면: 왼쪽 사이드바 5메뉴(대시보드/씬 목록/인원별/리테이크 허브/휴가), 오른쪽 본문. 대시보드는 떠다니는 점 배경 위 유리 위젯 4장(배경 rgba(26,29,39,.28) + blur 24px)과 위쪽 탭 [통합|배경|액팅]. 씬 목록은 카드 9장(3×3, 각 200×120)과 에피소드 칩 [EP1|EP2|EP3]. 인원별은 카드 20장. 체크 '처음 방문', 버튼 [빠르게 4번 연타]. 지금: 메뉴 클릭 시 본문 즉시 교체, '처음 방문'이면 가운데 24px 스피너가 80ms 번쩍. 인원별은 카드가 30ms 간격·300ms 씩 차례로(마지막 0.87초). 대시보드 탭은 위젯 묶음 opacity 1→0 150ms(그동안 유리 흐림이 꺼져 점·선이 또렷) → 빈 화면 → 0→1 150ms 끝에 흐림이 툭 돌아옴. EP 칩은 카드 색만 제자리 교체 + 새 카드 2장만 따로 떠오름. 바꾸면: 본문 위 배경색(#0F1117) 덮개 opacity 1→0 180ms cubic-bezier(.16,1,.3,1)(내용 자체는 움직이지 않음), 스피너는 250ms 를 넘길 때만. 인원별 카드는 opacity + translateY(8px→0) 200ms, 간격 20ms, 최대 지연 200ms. 대시보드 탭은 위젯 판 고정, 안쪽 내용만 opacity 0→1 180ms, 숫자는 굴림. EP 칩은 카드 영역 전체 translateX(±16px→0) + opacity 0→1 240ms cubic-bezier(.16,1,.3,1)(다음 EP 는 오른쪽, 이전 EP 는 왼쪽에서), 연타하면 마지막만. 동작 줄이기: 덮개 페이드만 120ms, 이동 없음.

<details><summary>개발 메모</summary>

사이드바 이동: App.tsx:3133-3141 `<LazyErrorBoundary key={currentView}>` + Suspense 스피너. 래퍼에 opacity 를 걸면 Backdrop Root 가 되어 대시보드 위젯 blur(Widget.tsx:77-80)가 꺼짐(Chromium 실측). transform 을 걸면 fixed 자손의 기준 상자가 바뀜(fixed inset-0 46개 파일, 포털 밖 모달 존재). → main 안에 absolute 덮개(bg-primary, pointer-events none)를 opacity 1→0 180ms 로 걷는 방식. pendingDeepLink(App.tsx:3075-3089, ScenesView.tsx:3231-3274)가 있으면 생략, playground 제외. Suspense fallback 은 250ms 지연 컴포넌트. lazy 팩토리를 상수로 빼서 사이드바 onMouseEnter 에서 해당 항목만 prefetch(13개 화면을 requestIdleCallback 으로 전부 import 하면 큰 모듈 평가가 입력을 막음). Header.tsx:51 제목은 key span 120ms 페이드. main scrollTop 이 이전 화면 값으로 남는지 확인. 스태거: AssigneeView.tsx:361-366, TeamView.tsx:453-457, EpisodeView.tsx:505-509 → delay min(i*0.02, 0.2). 씬 파트: ScenesView.tsx:6008·6227 그리드 컨테이너에 WAAPI(partKey 변경 시 opacity + translateY(6px) 180ms, 진행 중이면 cancel). SceneSheetView.tsx:933-936 행별 framer 제거, UnifiedSceneSheetView.tsx:922 래퍼에 동일 적용. 컴포지팅: CompositingDashboardView.tsx:334 래퍼에 dir=±1 WAAPI translateX(±16px) 240ms, :333 스크롤 컨테이너 overflow-x clip(가로 스크롤바 출렁임 방지), cascade 는 마운트·↻ 직후에만 armed, 단계·이미지는 비동기 도착(:94 loadCompositingForEpisode). 대시보드 탭: Dashboard.tsx:1157-1164 key 재마운트 + opacity 를 제거하고, 위젯은 store 값으로 갱신. 필요하면 Widget.tsx:110 children 컨테이너에만 filterKey 1회 opacity 180ms(유리 셸 자식이라 흐림 유지). RecentActivityWidget.tsx:65-67 처럼 재마운트에 기대던 재조회·상태는 위젯별로 확인. 휴가: VacationView.tsx:763-769 mode wait + framer x → createMonthSlideVariants(monthSlideMotion.ts, CalendarGrid.tsx:38-42·585-596 과 같은 값, 층 key 는 monthKey+seq), ScheduleView.tsx:766-779 markPeriodNavigation 패턴으로 연타 즉시 전환, :780 measureWeekRow ref 는 들어오는 층에만, :661-669 동기화 막대는 CSS keyframe.

</details>

### 13. 아침 첫 진입 — 클릭하면 바로 반응하고, 커튼 걷히듯 대시보드가 드러나며 위젯이 차례로 자리 잡기 `first-entry`

- 화면: 앱을 켰을 때 로딩 영상 → 'Bflow.' 첫 화면 → 대시보드로 들어가는 순간(로그인 직후 포함)
- 종류/빈도/작업/위험: fix / daily / L / medium

**지금**: 'Bflow.' 첫 화면에서 클릭하면 0.3~0.5초 동안 글자가 그대로 멈춰 있다가(아래 안내 문구만 0.4초 뒤 흐려지기 시작) 대시보드가 한 번에 '뚝' 나타나요. 'Bflow' 글자가 위로 떠오르며 사라지는 퇴장 연출은 만들어져 있지만, 실제로는 재생되지 못하고 잘려요. 대시보드에서는 위젯 전체가 0.15초 동안 한꺼번에 희미하게 나타나고, 막대와 원 그래프는 이미 다 채워진 채로 등장해요. 로딩 영상에서 첫 화면으로 넘어갈 때도 그냥 컷이에요.

**바꾼 후**: 첫 화면을 보고 있는 동안 대시보드를 뒤에서 미리 그려 둬요. 클릭하는 순간 'Bflow.' 글자가 위로 살짝 떠오르며 흐려지고, 가려 두었던 대시보드가 0.35초 동안 커튼이 걷히듯 드러나요. 이어서 위젯들이 왼쪽 위부터 아주 짧은 간격으로 차례로 또렷해지고(모두 또렷해지기까지 약 0.5초), 막대가 0에서 차오르고 원이 그려져요. 이 차오름은 앱을 켠 뒤 처음 한 번만 하고, 다른 화면에 갔다 올 때마다 반복하지 않아요. 인사 말풍선은 커튼이 다 걷히자마자 올라와요. 로딩 영상에서 첫 화면으로 넘어갈 때도 짧게 겹쳐지며 넘어가요.

**조심할 점**: 대시보드를 미리 그리는 일과 첫 화면 연출이 저사양 PC 에서 겹쳐 끊기지 않는지 실측이 필요해요. 미리 그려 둔 위젯의 등장과 차오름이 가려진 채로 먼저 끝나 버리지 않게, 커튼이 걷히는 순간에 맞춰 시작해야 해요. 막대가 매번 0부터 차오르면 금방 질리기 때문에 앱을 켠 뒤 첫 진입에만 하는 게 핵심이에요.

**수치 사양(목업 기준)**: 장면: 검은 화면(#0F1117) 가운데 'Bflow.' 64px(B 만 #6C5CE7)과 아래 'click anywhere to continue' 12px #8B8DA3. 그 뒤에 대시보드(사이드바 + 위젯 6개 3×2: 진행률 원, 단계 막대 4줄, 담당자 카드 4장, 에피소드 요약 2개, 최근 작업, 캘린더). 버튼 [앱 켜기 재생], [다른 화면 갔다 오기], [동작 줄이기]. 지금: 클릭 → 500ms 정지(안내 문구만 400ms 뒤 흐려지기 시작) → 대시보드 컷, 위젯 전체 opacity 0→1 150ms 동시, 막대·원은 이미 채워진 상태, 이어서 인사 말풍선. 바꾸면: 클릭 즉시 'Bflow.'와 안내 문구가 translateY(0→−30px) + opacity 1→0 300ms cubic-bezier(.4,0,1,1)(지연 없음). 150ms 뒤 덮개 opacity 1→0 350ms ease. 덮개가 걷힐 때 위젯은 (y,x) 순서로 opacity 0→1 320ms cubic-bezier(.16,1,.3,1), 각 28ms 지연(최대 8단계 = 224ms), 위젯 안 내용은 translateY(6px→0) 함께. 막대는 0에서 목표까지 700ms cubic-bezier(.16,1,.3,1), 원 호도 같은 시간 동안 그려짐(앱 켠 뒤 첫 1회만). 덮개가 다 걷힌 뒤 인사 말풍선. [다른 화면 갔다 오기]는 위젯 opacity 페이드만, 차오름 없음. 동작 줄이기: 덮개 즉시 제거, 위젯·막대 즉시.

<details><summary>개발 메모</summary>

LoginScreen.tsx:824-833 ready 클릭 → phase 'transition' → 500ms 뒤 'done'(landing 중이면 :810-822 300ms). :845 `if (phase === 'done') return null` 때문에 :861-864 hero exit(0.7s)가 재생되지 않음. :544-548 ClickPrompt 의 delay 0.4 가 exit 에도 걸림. App.tsx:3157 로딩 스플래시 클릭과 :3229-3239 분기 교체가 컷. 수정: phase 'ready'(사용자가 클릭을 기다리는 유휴 구간)에 MainLayout 을 미리 마운트하고, LoginScreen 을 fixed 오버레이(z-[9998])로 유지. LoginScreen 루트(:848)는 자체 배경이 없어 GradientBackdrop 에 기대므로 덮개에 불투명 배경층 추가. 클릭 즉시 onExitStart: hero 퇴장(transform 문자열/CSS 로, framer filter blur 는 무거움), ClickPrompt exit 은 delay 0·duration .2, 오버레이 `animation: splash-out 350ms ease 150ms forwards`(opacity) → onAnimationEnd 에서 onComplete. 자동 인사(App.tsx:3008-3016, 3291-3305)는 오버레이 종료 후 시작. WelcomeToast 는 spring x/y/scale → transform 문자열, exit blur 제거, useMotionPref. 대기 중 :551-566 textShadow 무한 반복이 메인 마운트 순간 멈칫할 수 있음. 로딩 스플래시(App.tsx:3148)도 오버레이로 200ms 크로스페이드. 위젯 등장: Widget.tsx 루트는 opacity 만(셸에 blur 24px 가 있어 transform 하면 재블러), 안쪽 내용(:110)에만 translateY(6px). 래퍼에 --enter-i(currentLayout 을 (y,x) 로 정렬한 순위), delay min(i,8)*28ms, mount 전용 CSS animation(RGL 리렌더로 재시작되지 않음, 클래스 토글 금지). 막대 차오름: HorizontalBar.tsx:27, VerticalBar.tsx:21, StatCard, StageBarsWidget.tsx:54-60, AssigneeCardsWidget.tsx:48-57, EpisodeSummaryWidget.tsx:90-98, episode/* 를 translateX(calc(var(--pct)*1% - 100%)) + @starting-style(Electron 33 = Chromium 130). DepartmentComparisonWidget.tsx:170-186 스택 막대는 scaleX 나 width 유지. 도넛은 rAF 2회 뒤 값 설정(@starting-style 이 SVG 프레젠테이션 속성에 먹는지 미검증). '세션 첫 1회' 플래그는 모듈 변수. CPU 6배 감속 + Performance 로 long task 겹침 실측.

</details>

### 14. 씬 상세 창 — 닫을 때도 부드럽게, 열 때 글자 안 찌그러지게, 씬·탭 넘김은 빠르게, 이미지 올릴 때 덜컹 없이 `scene-detail-flow`

- 화면: 씬 목록에서 카드를 두 번 눌러 여는 씬 상세 창(댓글 패널 포함): 열기·닫기, ←/→ 다음 씬, 상세/리테이크/파일/히스토리 탭, 콘티·가이드 이미지 칸
- 종류/빈도/작업/위험: fix / daily / M / low

**지금**: 열 때는 살짝 커지며 나타나는데, Esc 나 바깥을 눌러 닫으면 창과 댓글 패널이 한순간에 '뚝' 사라져요. '전체' 보기에서 카드를 두 번 누르면 카드 자리에서 창이 커지며 열리는데, 카드와 창의 가로세로 비율이 달라 초반에 글자가 납작하게 눌려 보여요. 다음 씬으로 넘기면 BG·액팅만 볼 때는 내용이 그 자리에서 '팍' 바뀌고, '전체' 보기에서는 옛 씬이 다 빠져나간 뒤에야 새 씬이 들어와서 0.4초쯤 빈 칸을 거쳐 0.8초 만에 자리를 잡아요. 탭을 바꿀 때도 같은 느린 미끄러짐이 걸리고, 누른 탭과 상관없이 '마지막으로 씬을 넘긴 방향'으로 밀려요. 이미지를 붙여넣으면 저장이 끝날 때까지 방금 붙인 그림이 안 보이고, 끝나면 칸이 커지면서 아래 내용이 덜컹 밀려요.

**바꾼 후**: 닫을 때 창과 댓글 패널이 0.16초 동안 살짝 작아지며 가라앉고, 뒤 화면이 서서히 밝아져요. '전체' 보기에서 열 때는 비율을 유지한 채 커지고 처음 순간만 투명해서 납작함이 안 보여요. 씬 넘김은 두 상세 창 모두 옛 씬이 빠지는 것과 새 씬이 들어오는 게 겹쳐 0.2초 안에 끝나고, 빠르게 연타하면 움직임 없이 바로바로 넘어가요. 탭을 바꿀 때는 0.15초 안에 새 내용이 누른 탭 쪽에서 살며시 나타나요. 이미지는 붙여넣는 즉시 그 그림이 살짝 어둡게 보이며 아래 얇은 줄이 흐르다가, 저장되면 밝아지면서 '저장됨 ✓'이 잠깐 떠요. 칸 높이는 처음부터 끝까지 그대로예요.

**조심할 점**: 닫기 경로(Esc·바깥 클릭·다른 화면에서 닫기 신호)가 모두 같은 부드러운 닫힘을 거치게 해야 해요. 닫히는 0.16초 동안 연타 클릭은 무시하도록 막아요.

**한솔 결정 (2026-10-03): 다음 씬·이전 씬 넘김은 카드가 왼쪽·오른쪽으로 '지나가는' 느낌을 더 살린다. 지금 움직임을 발전시켜도 된다.**
- 다음 씬(→): 지금 씬 내용이 왼쪽으로 지나가며 빠지고(이동 약 96px·살짝 작아짐 0.985·흐려짐), 다음 씬이 오른쪽에서 지나 들어온다(+96px → 0). 두 장이 겹쳐 지나가며 0.3초 안팎(cubic-bezier(.22,1,.36,1))에 자리 잡는다. 이전 씬(←)은 거울 방향.
- 창 틀(머리줄·닫기 버튼·댓글 패널 틀)은 제자리. 씬 번호·제목은 같은 방향으로 짧게 굴러 바뀐다.
- 빠르게 연타·키를 누르고 있으면 움직임을 없애지 말고 짧게(약 0.14초) 이어 붙여 카드를 착착 넘기는 느낌을 준다. 방향이 바뀌면 즉시 반대로.
- 발전 요소(성능이 허락하면): ←/→ 버튼에 마우스를 올리면 그쪽 가장자리에 다음 카드 모서리가 살짝 비친다(덱처럼). 맨 끝 씬에서 더 넘기면 살짝 튕겨 돌아온다(고무줄).
- 동작 줄이기: 이동 없이 0.12초 투명도 교차만.
- 무거운 내용(이미지·댓글)은 이동 레이어 하나로 묶어 transform/opacity 만 움직인다(레이아웃·흐림 애니메이션 금지).

**수치 사양(목업 기준)**: 장면: 카드 4장 그리드(각 240×200) + 상세 창 모형(본체 720×560 #1A1D27 + 오른쪽 댓글 패널 300px). 헤더 '#012 EP03', 탭 4개(상세|리테이크|파일|히스토리), 본문에 이미지 칸 2개(각 높이 160)와 텍스트 줄, 좌우 화살표. 체크 '슬로모션 ×4'. 버튼: [카드 더블클릭], [Esc], [→ 다음 씬], [→ 5번 연타], [탭: 상세→히스토리→상세], [이미지 붙여넣기(2초 저장)]. 지금: 열기 시 카드(240×200)에서 창으로 비균등 scale 520ms → 초반 글자 납작. Esc 즉시 사라짐. 다음 씬: 본문 x −48 + opacity 0 으로 420ms 퇴장 → 빈 칸 → 오른쪽 48px 에서 420ms 입장, 창 전체 x 56→0 550ms, 연타하면 밀림. 탭도 같은 슬라이드(방향은 마지막 씬 넘김 방향). 이미지는 '저장 중...' 128px 상자 → 2초 뒤 160px 이미지로 점프(아래 텍스트 32px 밀림), hover 버튼 즉시 등장. 바꾸면: 열기는 균등 scale(카드폭/창폭) + 위 정렬, opacity 0→1(30% 지점) 520ms cubic-bezier(.16,1,.3,1). 닫기는 opacity→0 + translateY(6px) scale(.97) 160ms cubic-bezier(.4,0,1,1), 배경 동시 페이드. 다음 씬은 옛 본문 translateX(−24px) + opacity 0, 새 본문 translateX(24px→0) + opacity 0→1 이 동시에 200ms cubic-bezier(.16,1,.3,1), 창 흔들림 ±20px 300ms. 180ms 안 재입력이면 즉시 교체. 탭은 새 내용 opacity 0→1 + translateX(±8px→0) 150ms(오른쪽 탭이면 오른쪽에서). 이미지는 붙여넣는 즉시 그 그림 opacity .55 + 하단 2px 진행 줄(40% 폭 막대가 translateX 로 1s linear 반복), 완료 시 opacity 1 200ms + '저장됨 ✓' 칩 1.2초 페이드, 칸 높이 160 고정. hover 버튼 opacity 150ms. 동작 줄이기: opacity 만 120ms, 연결 확대 생략.

<details><summary>개발 메모</summary>

닫기: ScenesView.tsx:6639 `{detailScene && …<SceneDetailModal/>}`, :6711~6854 `{detailMerged && …}` 가 부모에서 언마운트하고, AnimatePresence 는 각 모달 내부(SceneDetailModal.tsx:936, UnifiedSceneDetailModal.tsx:1131)라 exit(SceneDetailModal.tsx:943,971 / UnifiedSceneDetailModal.tsx:742-746) 미실행. framer 10.18 에서 바깥 AnimatePresence 의 퇴장 신호는 안쪽 경계를 넘지 못함 → 모달 내부 closing 상태 + 내부 onExitComplete 에서 부모 onClose(Esc·바깥 클릭·closeSceneModalSignal ScenesView.tsx:3717 모두 통과). exit 은 transform 문자열 'translateY(6px) scale(0.97)' 160ms ease [0.4,0,1,1], 퇴장 중 pointer-events none. 연결 확대: SceneContinuityTransition.tsx:18-25 scale(scaleX, scaleY) → 균등 s = sourceW/targetW, 위 정렬, 키프레임 [{transform:start, opacity:0},{opacity:1, offset:.3},{transform:'none'}], :89 filter 제거, index.css:289-293 will-change filter 제거. 넘김: UnifiedSceneDetailModal.tsx:799-807·955-963 mode 'wait' 0.4/0.42 → mode 'popLayout' 0.2/0.22, x ±24 를 transform 문자열로, 래퍼 :437-450 x ±56 0.55s → ±20 0.3s, 마지막 navigate 후 180ms 안이면 duration 0. SceneDetailModal.tsx:967-972 본체 key 고정 → 안쪽 콘텐츠에 AnimatePresence initial={false} + key=scene.id, 같은 variants. 탭: body key `body:${tab}:${idx}`(:955) 에서 tab 분리 → 바깥 key 는 index, 안쪽 `<div key={tab} className='bf-tab-fade'>`(CSS 150ms backwards, --tab-dx = 탭 인덱스 차 부호 × 8px), tab 은 wait 없음, :313 initialTab·:324 setTab('revisions') 확인. 헤더 blur(20px)(:793-797)와 blur(40/50px) 글로우(:776-790)는 scale·슬라이드 중 재래스터 → 불투명 배경·미리 흐린 그라데이션으로. 이미지: :1729-1738 loading 분기(h-32)가 :1753(h-40)과 높이가 다르고, uploadImage(:647-678)가 previewUrls 를 세팅해도 :978 loading 이 먼저라 미리보기 미표시 → previewUrl 우선 + loading 은 오버레이, 높이 h-40 통일, 원격 url 은 new Image().decode() 후 교체, '저장됨' 칩은 key={savedAt}. hover 오버레이 :1771·SceneDetailModal.tsx:325 transition-colors → transition-[opacity,background-color] 150ms, 버튼 backdrop-blur-sm → bg-black/45. SceneDetailModal.tsx:262-268 도 같은 처리. useMotionPref 로 reduce 시 opacity 만.

</details>

### 15. 필터·정렬을 켠 채 체크해도 카드가 증발하지 않게 + 바꿀 때 바뀐 것만 미끄러져 움직이기 `reflow-on-filter`

- 화면: 씬 목록(상태 필터 '미착수/진행중/완료'나 '진행률순' 정렬을 켠 채 체크할 때, 필터·정렬·검색을 바꿀 때), 인원별·팀원 정렬 버튼, 리테이크에서 항목을 완료했을 때, 캐릭터 카드를 끌어 옮긴 뒤, 캘린더 태그 칩·왼쪽 캘린더 체크
- 종류/빈도/작업/위험: fix / daily / L / medium

**지금**: '진행 중'만 보면서 마지막 단계를 체크하면, 누른 그 순간 카드가 목록에서 '팍' 사라지고 뒤 카드들이 한 칸씩 당겨져서 마우스 아래에 다른 카드가 와 있어요(완료 축하 꽃가루도 카드와 함께 사라져 못 봐요). '진행률순' 정렬에서는 체크할 때마다 카드가 다른 자리로 순간이동해요. 필터·정렬·검색을 바꾸면 카드들이 한 번에 사라지고 다른 카드들이 다른 자리에 '팍' 나타나서, 어떤 카드가 어디로 갔는지 눈으로 따라갈 수 없어요. 인원별·팀원 정렬, 리테이크 완료 항목이 아래로 가는 순간, 캐릭터 카드를 놓는 순간도 모두 순간이동이에요. 캘린더 태그를 켜고 끄면 바뀌지 않은 일정까지 달력 전체가 한 번 어두워졌다 밝아져요.

**바꾼 후**: 필터에서 빠지게 된 카드는 1~1.5초 동안 제자리에 머물며 축하와 색 변화를 다 보여 준 뒤, 살짝 옅어지면서 빠지고 나머지 카드가 빈자리로 스르륵 당겨져요. 여러 장을 연달아 체크하는 동안에는 기다려 줘요. 필터·정렬·검색을 바꾸면 남는 카드는 원래 자리에서 새 자리로 0.3초 동안 미끄러지고, 새로 보이는 카드는 살짝 떠오르며 나타나요. 인원별·팀원 정렬, 리테이크 완료 항목, 캐릭터 카드도 같은 방식으로 미끄러져요(글자 눌림 없이 자리만 이동). 캘린더는 달력 전체가 깜빡이지 않고, 새로 보이게 된 일정만 0.18초 동안 또렷해지며 떠올라요.

**조심할 점**: 카드가 아주 많으면(150장 이상) 미끄러짐 없이 바로 바뀌게 상한을 둬요. 머무는 1초 동안 '왜 안 사라지지?' 헷갈리지 않도록 카드를 살짝 옅게 해서 '곧 빠짐'을 알려요. 범위가 넓어서 씬 목록 → 인원별·리테이크 → 캐릭터·캘린더 순으로 나눠 진행하는 게 안전해요.

**수치 사양(목업 기준)**: 장면: 위 필터 바(상태 '전체|시작 전|진행 중|완료', 정렬 '번호순|진행률순', 검색창), 카드 12장 4×3(각 180×130, 진행률·단계 4칸 각기 다름), '진행 중' 켜짐. 옆 미니 장면: 캘린더 2주(14칸) 막대 8개(태그 3색) + 태그 칩 3개. 버튼: [A05 PNG 체크(완료로 빠짐)], [연속 3장 체크], [진행률순 정렬], [검색 'A0'], [태그 칩 토글]. 지금: A05 클릭 순간 카드 즉시 제거, 뒤 카드가 한 칸씩 즉시 당겨짐(마우스 아래 다른 카드가 온 위치를 빨간 점으로 표시), 꽃가루 안 보임. 정렬·검색 시 즉시 재배치. 태그 토글 시 막대가 즉시 바뀐 뒤 격자 전체 opacity 1→.55→1(120ms). 바꾸면: A05 는 꽃가루와 함께 1200ms 제자리(그동안 opacity .65 300ms 로 예고) → opacity 0 200ms → 나머지 카드가 이전 위치에서 새 위치로 translate 320ms cubic-bezier(.16,1,.3,1). 연속 체크 동안 머무름 연장. 정렬·검색은 남는 카드 translate 320ms 같은 곡선, 새로 보이는 카드 opacity 0→1 + translateY(8px→0) 200ms, 지연 min(i×12,150)ms. 태그 토글은 새로 보이는 막대만 opacity 0→1 + translateY(2px→0) 180ms ease-out, 격자 깜빡임 없음. 동작 줄이기: 머무름은 유지, 이동 없이 즉시 재배치.

<details><summary>개발 메모</summary>

머무름: ScenesView.tsx:3443-3463·3499-3521(개별), :3546-3553(통합)에서 matchesAssigneeStatusFilter·sort 가 낙관 값으로 즉시 반영됨. lingerKeys Map<key,{order,until}> 를 handleToggleForSheet(:3917~)·액팅 phase·담당자 토글의 낙관 갱신 직후 등록(statusFilter !== 'all' 이거나 sortKey 가 progress/incomplete 일 때). 기본 1200ms, 축하가 있으면 :2881-2886 의 1600ms 에 맞춤, 연속 체크 시 연장. 필터 통과 + 기록 order 로 끼워 넣기, deps 에 lingerKeys. data-lingering → opacity .65 300ms. 카드 이동: useStackFlip.ts:77- 패턴을 항목별 x/y 로 확장한 useGridFlip(containerRef, flipKey, {maxItems:150}). data-flip-id, flipKey = status|assignee|sortKey|sortDir|debouncedSearch|groupMode + linger 만료(체크 같은 데이터 변경은 제외). WAAPI translate 320ms cubic-bezier(.16,1,.3,1), 신규는 opacity + translateY(8px) 200ms + 지연 min(i*12,150). 화면 밖은 skip, 진행 중이면 cancel 후 재측정, 라쏘 중(isSelecting)이나 reduce 면 비활성. 빠지는 카드 복제본 페이드는 생략. 인원별·팀원: AssigneeView.tsx:359-368, TeamView.tsx:451-465 framer layout='position'(크기 보정 없음, 20장). 리테이크: RevisionItem.tsx:115-125 의 framer layout + transition-all 이 겹침 → 둘 다 제거(transition-colors), SceneRow 에서 rev.id ref Map FLIP. 캐릭터: CharacterBoardView.tsx:397-405 handleCardDrop 에서 reorderCharacters 전에 rect 스냅샷, 내가 놓은 경우만, 40장 초과면 생략(CharacterTabGroupsView.tsx:184 동일). 캘린더: ScheduleView.tsx:596-613 filterFadeOpacity 제거, :1745 opacity 1 고정, filterSignature 변경 시각을 CalendarGrid 에 prop 으로 → EventBarChip 마운트 시점에만 판정해 안쪽 div 에 calendarBarReveal 180ms(컨테이너 클래스 방식은 기존 막대까지 매칭되므로 금지). CalendarRail.tsx:60,159 체크는 railCheckPop 160ms, :341 화살표 transition-transform. WAAPI 는 useMotionPref 로 가드.

</details>

### 16. 끌어서 옮기는 모든 곳에 '잡았다→옮긴다→놓았다' 세 박자 — 캘린더·타임라인·대시보드 위젯 `drag-landing`

- 화면: 캘린더 월 보기 일정 막대 끌기·늘이기, 주 시간표 블록을 다른 요일로 끌기, 날짜 옆 + 로 범위를 잡아 '만들기', 타임라인 작업 막대 끌기, 대시보드 위젯 끌기·크기 조절·쓰레기통
- 종류/빈도/작업/위험: polish / daily / L / medium

**지금**: 캘린더 월 보기에서 막대를 끌면 원래 자리가 텅 비고, 반투명 점선 막대가 칸을 넘을 때마다 뚝뚝 순간이동해요. 놓아도 '놓였다'는 반응이 없어요. 시간표에서는 다른 요일로 넘길 때마다 블록이 깜빡이거나 잠깐(최대 0.5초) 손에서 사라지고, 놓은 뒤의 보라 반짝임은 저장이 끝난 뒤에야 나와요. '만들기'를 누르면 유리 막대가 저장이 끝날 때까지 남아 있는 채로 같은 날짜 칸 위쪽에 진짜 막대가 툭 생겨서, 잠깐 두 개가 함께 보여요. 타임라인 막대는 하루 단위로 뚝뚝 점프하고 들어 올린 느낌이 없어요. 대시보드 위젯은 잡아도 살짝 투명해지고 테두리가 깜빡일 뿐 들어 올린 느낌이 없고, 나머지 위젯들이 흐려지며 움직여서 느린 PC 에서는 버벅일 수 있어요. 크기 조절을 놓으면 그때그때 출렁이거나 착 맞춰져서 들쭉날쭉하고, 쓰레기통은 0.15초 늦게 끈적하게 커지며 놓으면 위젯이 그 자리에서 사라져요.

**바꾼 후**: 잡는 순간 살짝 들리며 그림자가 깊어지고, 원래 자리에는 흐린 점선 흔적이 남아 '어디서 왔는지'가 보여요. 끄는 동안에는 칸 사이를 0.12초씩 미끄러지며 손을 따라오고(시간표는 요일을 넘어도 계속 진하게), 손을 떼는 즉시 1.03배로 '톡' 내려앉으며 테두리가 한 번 반짝여요. '만들기'를 누르면 유리 막대가 녹아 사라지고, 같은 날짜 칸에 진짜 막대가 굳어지듯 진해지며 한 번 빛나요. 대시보드 위젯은 잡으면 1.02배 커지며 깊은 그림자가 생기고, 나머지 위젯은 흐림 없이 어둡게만 내려앉아요. 크기 조절은 놓으면 언제나 같은 방식으로 맞춰지고, 쓰레기통 위에 올리면 위젯이 작아지고 흐려지며 '곧 버려짐'을 미리 보여 줘요.

**조심할 점**: 놓는 즉시 반짝이므로 '반짝 = 저장 완료'는 아니에요. 저장에 실패하면 지금처럼 원래 자리로 돌아가고, 실패 안내는 '안심 장치' 항목과 연결돼요. 타임라인은 끄는 동안 차트 전체를 다시 그리지 않도록 방식을 바꿔야 매끄러워요. 캘린더 → 위젯 → 타임라인 순으로 나눠 진행하길 권해요.

**수치 사양(목업 기준)**: 장면 3구역. A) 월간 2주(14칸, 칸 120×90) '디자인 리뷰' 막대(높이 26, #6C5CE7). B) 시간표 3열(월·화·수, 시간 눈금) 10:00-11:00 블록(#A29BFE). C) 떠다니는 점 배경 위 유리 위젯 4장 2×2(각 260×160, 배경 rgba(26,29,39,.28) + blur 24px) + 오른쪽 아래 쓰레기통(48px 원). 버튼: [월간 끌기 재생(오른쪽 3칸·아래 1칸)], [시간표 월→화→수 끌기], [+ 로 3칸 만들기], [위젯 끌기], [위젯을 쓰레기통에]. 체크 '저장 지연 0.6초'. 지금: A 는 원래 자리가 비고 점선 막대(opacity .5)가 칸 경계마다 순간이동, 놓으면 그냥 진한 막대. B 는 요일을 넘을 때마다 블록 opacity 0→1(최대 0.5초 투명), 놓은 뒤 0.6초 지나서 보라 테두리 반짝. 만들기는 유리 막대 위에 진짜 막대가 툭 겹침 → 0.6초 뒤 유리 막대 사라짐. C 는 잡은 위젯 opacity .95, 나머지 위젯 어둡게 + blur 2px, 쓰레기통 hover scale 1.08 이 0.15초 늦게 끈적, 놓으면 즉시 사라짐. 바꾸면: A 는 원래 자리에 흐린 점선 흔적(opacity .3, 1px dashed). 끄는 막대는 칸이 바뀔 때 translate 120ms cubic-bezier(.16,1,.3,1). 놓으면 scale 1→1.03→1 420ms cubic-bezier(.34,1.56,.64,1) + 테두리 링 opacity .9→0 450ms(저장을 기다리지 않음). B 는 블록이 계속 진하게 따라오고 놓는 즉시 같은 착지. 만들기는 유리 막대 opacity 1→0 150ms, 같은 자리 진짜 막대 opacity 0→1 + scale .96→1 320ms cubic-bezier(.16,1,.3,1) + 빛 링 .8→0 600ms. C 는 잡은 위젯 scale 1.02 + 그림자 층(0 28px 56px rgba(0,0,0,.45)) opacity 0→1 180ms cubic-bezier(.2,.8,.2,1), opacity 1 유지. 나머지 위젯은 어두운 덮개(rgba(15,17,23,.55))만 200ms. 밀려나는 위젯 translate 350ms cubic-bezier(.16,1,.3,1). 놓으면 scale 1 180ms + 기존 튕김 안착 450ms cubic-bezier(.34,1.56,.64,1). 쓰레기통 위에서는 위젯 scale .92 + opacity .7 150ms, 쓰레기통 scale 1.08 150ms(한 방식), 놓으면 즉시 제거. 동작 줄이기: 착지 반동·이동 없이 테두리 링만.

<details><summary>개발 메모</summary>

월간: CalendarGrid.tsx:716 key 에 `-c${bar.startCol}` 가 있어 칸이 바뀔 때마다 재마운트 → :217 left/width/top 0.12s 는 resize-end 에서만 돎. key 를 `${identity}-seg${segmentIndex}` 로 바꾸고 left/width transition 을 지운 뒤 useLayoutEffect 에서 이전 rect 와 비교해 WAAPI translate 120ms. :509-518 displayEvents 가 원래 자리를 비우므로 events 에서 원래 bars 를 따로 layout 해 정적 흔적(opacity .3, 1px dashed)을 그림. 착지: handleEventDragDone 진입 즉시(await 전) settleIdentity, 안쪽 div 에 .calendar-bar-settle(transform 1.03→1 420ms cubic-bezier(.34,1.56,.64,1) + ::after 링 opacity 450ms), 루트 hover transform 과 분리, 재생은 key/신규 마운트(animation:none 토글 금지). useCalendarDnD.ts:140-158. 시간표: WeekTimeGridView.tsx:956 initial 을 `reduce || isPreviewed ? false : …`(:897-898), :272 stagger. useTimeGridDnD.ts:436-445 settle 을 Promise 이후가 아니라 onEventChange 호출 직후에 동기로, 끄는 중 scale 1.02 는 framer 대신 CSS 클래스. 만들기: DragCreateGhost.tsx:69-70 즉시 null → 퇴장 클래스 150ms, index.css:1754-1755 backdrop-filter 제거. ScheduleView.tsx:842-865 handleAddEvent 에서 bornIdentityKeys(1s 만료, :391-412 패턴), :431-462 localEcho 는 강조 제외 → born 은 별도. 타임라인: GanttCanvas.tsx:308-310 delta 가 바뀔 때만 setDrag, 끄는 막대 .gantt-bar-position 에 잔여 오프셋 style.transform 직접 기록, endDrag(:312-331) WAAPI 120ms 로 0, 정적 들림 그림자, 스냅 칸 점선. 리사이즈 끝은 스냅 유지(scaleX 는 진행률 표시를 찌그러뜨림), 그룹 이동은 하루 스냅 유지. 위젯: Dashboard.tsx:1274-1279 dim 오버레이 backdropFilter 삭제(배경 .55), 항상 렌더 + opacity 전환, 반경 12→16(:1275)·테두리 13→17(:1233,1246,1258). widget-animations.css:11-15 opacity .95→1, 래퍼 data-lifted → Widget.tsx 루트 'widget-shell' scale 1.02(:74 transition-all → transform/border-color), 그림자 층 opacity. :35-37 `transition: all` 을 transform/opacity 로, !important 규칙들에 reduced-motion 예외(:4-8 포함). 리사이즈 armed 상태로 width/height .15s 는 선택(저사양 실측 후). 쓰레기통 :1307-1312 framer scale 과 :1329 인라인 transform transition 이중 구동 → 확대는 안쪽 래퍼 CSS 하나로, :1325 blur 제거, 버려질 예고는 shell scale .92 + opacity .7, 빨려 들어감 고스트는 선택.

</details>

### 17. 끝냈을 때의 보상 — 씬 완료 '톡'과 매끄러운 꽃가루, 파트 완료는 화사하게 한 번, 할 일 완료 손맛 통일 `celebrate-done`

- 화면: 씬 목록에서 네 단계를 다 채우는 순간, 파트 완료 '고생하셨습니다!' 화면, 대시보드 '내 리테이크' 위젯의 '담당 완료', 씬·캐릭터 상세 댓글 패널 위 '팀 할 일' 체크
- 종류/빈도/작업/위험: polish / daily / M / low

**지금**: 씬을 완료하면 단계 버튼 가운데서 꽃가루 20개가 위·옆으로 곧게 퍼지며 흐려져요(떨어지지 않아요). 이 꽃가루는 체크 직후 화면이 갱신되는 순간과 겹쳐서 느린 PC 에서 뚝뚝 끊길 수 있고, '애니메이션 효과'를 꺼 둔 사람에게도 터져요. 카드 바탕의 초록 표시는 서서히가 아니라 '탁' 켜지고, 카드 자체는 아무 반응이 없어요. 파트 완료 화면은 닫기 전까지 빛망울·리본이 계속 떠다녀 무겁고, X 를 누르면 뚝 꺼지고, 완료된 파트를 다시 열 때마다 또 떠요. '내 리테이크'는 '담당 완료'를 누르면 목록 맨 위에 메모 칸이 뚝 생기고, 확인하면 줄이 뚝 사라져요. '팀 할 일'은 기본 네모 체크가 딸깍 바뀌고 취소선이 즉시 그어져요. 대시보드 '나의 할 일'은 체크 없이 '완료하기' 글자 버튼으로 끝내서, 할 일을 끝내는 손맛이 화면마다 달라요.

**바꾼 후**: 마지막 체크를 누르면 카드가 아주 살짝 '톡' 떠올랐다 돌아오고, 초록빛이 0.4초 동안 번지듯 채워져요. 꽃가루는 위로 톡 터졌다가 중력처럼 흩날리며 떨어져 0.9초 안에 사라지고, 화면이 바빠도 끊기지 않는 가벼운 방식으로 그려요. 파트 완료 화면은 처음 4~5초만 지금처럼 화사하게 흐르다가 천천히 잦아들어 고요한 배경으로 멈춰요. X 를 누르면 0.3초 동안 스르륵 사라지고, 이미 본 완료 화면은 다시 열 때 카드만 작게 떠요. '내 리테이크'는 '담당 완료'를 누른 그 줄이 강조되며 메모 칸이 그 아래 부드럽게 열리고, 확인하면 초록 체크가 그려진 뒤 줄이 스르륵 사라지며 아래 줄들이 미끄러져 올라와요. '팀 할 일'은 예전 '나의 할 일'에 쓰던 동그란 체크를 다시 살려, 체크가 톡 그려지고 취소선이 부드럽게 그어져요. 애니메이션을 끈 사람에게는 꽃가루 대신 칸 테두리가 한 번 은은하게 빛나요.

**조심할 점**: 파트 완료 화면은 한솔이 고른 연출이라 모양은 그대로 두고 '도는 시간과 무게'만 줄여요. 효과를 한꺼번에 너무 많이 넣지 않도록 씬 완료는 톡·번짐·꽃가루 세 가지로 절제했어요. 완료 표시 숫자(100%→✓) 바꾸기는 정보 표시가 달라지는 일이라 넣지 않았어요.

**수치 사양(목업 기준)**: 장면: 씬 카드 1장(300×220, LO·완료·검수 켜짐, PNG 빔), 아래 '내 리테이크' 카드(3줄, 각 줄 장면 라벨·색 있는 상태 글자·'진행중'/'담당 완료' 버튼), 오른쪽 '팀 할 일 2/4' 목록 4줄. 버튼: [PNG 체크], [바쁜 PC 흉내(체크 직후 0.3초 메인 스레드 점유)], [파트 완료 화면 열기], [X 닫기], [다시 열기], [리테이크 2번째 줄 담당 완료 → 메모 확인], [팀 할 일 체크], [동작 줄이기]. 지금: PNG → 꽃가루 20개가 위·옆 직선 1.2s easeOut(바쁜 PC 켜면 멈칫), 초록 그라데이션 즉시 켜짐. 파트 완료는 빛망울 20개 무한 이동 + 유리 카드, X 누르면 즉시 사라짐, 다시 열면 또 뜸. 리테이크는 메모 칸이 목록 맨 위에 즉시 생겨 목록이 64px 밀리고, 확인하면 줄 즉시 제거·아래 줄 툭. 팀 할 일은 네모 체크와 취소선 즉시. 바꾸면: 카드 transform none → translateY(−2px) scale(1.025)(40% 지점) → none 280ms cubic-bezier(.34,1.56,.64,1). 초록 틴트 층 opacity 0→1 400ms ease-out. 꽃가루 20개(보라 #6C5CE7·살구 #FDCB6E·초록 #00B894, 6~9px): 0→45% 구간 위로 튐(cubic-bezier(.2,.8,.4,1)), 이후 +110px 떨어지며 회전·opacity→0(cubic-bezier(.5,0,.9,.6)), 총 900ms, 바쁜 PC 를 켜도 매끄러움. 파트 완료: 장식이 4.5초 흐른 뒤 1초에 걸쳐 멈춤, X 누르면 opacity→0 300ms, 아래 '완료 안내 다시 보기' 알약이 translateY(12px→0) + opacity 200ms, 다시 열면 카드만 작게. 리테이크: 해당 줄 배경 보라 6% 150ms + 메모 칸 opacity + translateY(−4px→0) 180ms. 확인 시 초록 체크 원 scale 0→1(stiffness 520, damping 18 정도의 스프링, 약 300ms) → 400ms 뒤 줄 opacity→0 150ms + 아래 줄 translateY(dy→0) 260ms cubic-bezier(.16,1,.3,1). 팀 할 일은 체크 원 scale 0→1 같은 스프링 + 취소선 색 transparent→currentColor 220ms, 글자 #E8E8EE→#8B8DA3 220ms. 동작 줄이기: 꽃가루·톡 없이 PNG 칸 테두리 1회 빛남(opacity .7→0 400ms), 파트 완료 장식 정지.

<details><summary>개발 메모</summary>

꽃가루: ui/Confetti.tsx:36-72 framer 개별 x/y/scale/rotate 20개(메인 스레드), y 항상 음수(:39-40), reduce 가드 없음. CSS 변수(--cx/--cy/--cs/--cr) + 공용 keyframe 또는 WAAPI transform 문자열 2단 키프레임(45% 지점 튀어오름 → +110px 낙하, 900ms). useMotionPref().reduce 면 렌더하지 않고 onComplete 만. tests/sceneCompletionUx.test.ts:60-61 의 completeRef/[active] 구조 유지 또는 테스트 갱신. ScenesView.tsx:2884 의 1600ms 해제 안에 끝나게. 발사: ScenesView.tsx:2325·2526·3984 setCelebratingTarget(낙관 갱신과 같은 tick), 사용처 :1218, UnifiedSceneCard.tsx:493. my-tasks/components/Confetti.tsx:28-35 도 같은 방식으로. 틴트: index.css:334-370 그라데이션 background 는 보간 불가 → 별도 span 의 opacity 400ms(편집 중 무지개가 ::before 사용, scene-effects.css:316). 카드 톡: celebrating true 커밋에서 루트 ref WAAPI 280ms. 파트 완료: ScenesView.tsx:450-470 보케·:483-505 오로라·:659-683 리본·:688-713 트레이스를 CSS keyframe(transform/opacity, iteration 2, 끝 프레임 = 시작 프레임)으로, 움직이는 층의 filter blur 는 미리 흐린 radial-gradient 로, :745 카드 backdropFilter 제거(배경 .88→.96), :764-773 광택 1회, 루트 :626-630 에 exit opacity .3s(AnimatePresence 는 :5896/6073 에 있음), :3838-3858 dismiss 한 overlayKey 를 localStorage(try/catch)에 기억해 재방문 시 축소판, CompletionRestoreButton :859-876 등장 + backdrop-blur-md 제거, reduce 면 장식 렌더 생략. 내 리테이크: MyRetakesWidget.tsx:162-168 메모 fieldset 을 해당 줄 아래로, :140-144 성공 시 leaving 스냅샷 600ms 유지 + SuccessCheckCircle(my-tasks/components/SuccessCheckCircle.tsx:24) + 줄 단위 FLIP(data-flip-id), :180 상태 라벨 key 재마운트 150ms. myRetakes.ts:10,19 완료 필터. 팀 할 일: ThreadTodoSection.tsx:259-266 기본 체크박스 → SuccessCheckCircle 패턴(role=checkbox, aria-checked, disabled=busy 유지), :268 취소선은 text-decoration-color transparent↔currentColor + color 220ms, :257 busy transition-opacity 150ms, 목록 AnimatePresence initial={false} + popLayout 퇴장(:86-94 높이 측정 → onHeightGrow 와 충돌 방지), 접기는 즉시 유지, 꽃가루 없음.

</details>

### 18. 알림이 와서 → 열고 → 건너뛰어 → 도착하기까지 한 흐름으로 `notification-journey`

- 화면: 헤더 알림 종과 숫자 배지, 알림 창의 줄(읽음·지우기·모두 읽음), 오른쪽 아래 알림 카드, 알림·리테이크·검색에서 씬으로 건너뛰었을 때 헤더 왼쪽 '돌아가기', 리테이크 허브에 링크로 도착한 줄, 씬 목록에서 강조되는 카드
- 종류/빈도/작업/위험: new / daily / M / low

**지금**: 새 알림이 와도 숫자 배지가 3→4로 뚝 바뀌기만 해서 '방금 왔다'는 순간이 구분되지 않아요. 알림 창에서 읽음 처리하면 왼쪽 막대는 순간 사라지고 글씨는 툭 바뀌고, 지우면 줄이 뚝 없어지면서 아래 줄들이 한 번에 올라붙어요. 오른쪽 아래 알림 카드는 멘션·피드백 요청·일정이 모두 같은 모양이라 '나를 부른 알림'이 한눈에 안 들어와요. '애니메이션 효과'를 끈 사람에게도 계속 미끄러져요. 알림을 눌러 씬으로 건너뛰면 헤더 왼쪽에 '돌아가기'가 뚝 생기고 화면 제목이 옆으로 순간이동해요. 리테이크 허브로 들어오면 그 줄로 스크롤되고 펼쳐지긴 하지만 '여기예요' 표시가 없어 눈으로 찾아야 해요. 씬 목록에서는 강조된 카드로 스크롤된 뒤 4초 안에 다른 곳으로 스크롤하면, 그사이 화면이 한 번이라도 새로 그려질 때 다시 그 카드 쪽으로 끌려가요.

**바꾼 후**: 멘션·배정·피드백 요청처럼 나를 직접 부른 알림이 오면 종이 좌우로 짧게 '딩동'(0.6초) 흔들리고, 다른 사람이 내 씬을 체크한 것 같은 자동 알림은 숫자 배지만 톡 커져요. 새 숫자는 아래에서 굴러 올라오고, 여러 개가 한꺼번에 와도 반응은 한 번만 해요. 알림 창에서 읽음 처리하면 왼쪽 막대가 위아래로 접히듯 사라지고 글씨도 0.2초에 걸쳐 차분해지며, 지운 줄은 오른쪽으로 밀려나고 아래 줄이 미끄러져 올라와요. 알림 카드는 왼쪽에 얇은 색 막대와 아이콘이 붙어요(멘션·배정은 보라, 피드백 요청은 노랑, 일정은 파랑). 건너뛰면 '돌아가기'가 왼쪽에서 밀려 나오고 제목은 스르륵 비켜서요. 도착한 줄은 테두리에 보라 빛이 두 번 은은하게 켜졌다 꺼지고, 강조된 카드로는 처음 한 번만 데려다주고 그다음엔 내가 스크롤하는 대로 따라가요.

**조심할 점**: 자동 알림까지 종을 흔들면 시끄러우니, 나를 직접 부른 알림만 흔들어요. 앱을 켤 때 쌓여 있던 알림을 불러오는 순간이나 계정을 바꾸는 순간에는 흔들지 않아요. 종 주변의 은은한 빛(최근에 다듬은 부분)은 그대로 둬요.

**수치 사양(목업 기준)**: 장면: 헤더 띠(왼쪽 제목 '리테이크', 오른쪽 종 + 빨간 배지 '3'), 종 아래 알림 창(320×360, 줄 5개: 멘션 2·댓글 2·일정 1, 각 줄 왼쪽 3px 안 읽음 막대), 오른쪽 아래 알림 카드 스택 영역, 그 아래 리테이크 허브 목록 12줄(스크롤). 버튼: [댓글 자동 알림], [멘션 알림], [놓친 알림 5개 한꺼번에], [줄 ✓ 읽음], [줄 🗑], [알림 눌러 씬으로 이동], [돌아가기], [링크로 7번째 줄 도착], [동작 줄이기]. 지금: 배지 숫자 즉시 교체, 종 고정. 읽음 막대 즉시 사라지고 제목 굵기·색 툭. 지운 줄 즉시 사라지고 아래 줄 36px 점프. 알림 카드는 흐린 배경(blur 16px)으로 0.35s 미끄러지며 쌓이고 종류 구분 없음, 동작 줄이기를 켜도 미끄러짐. 이동하면 제목이 '씬 목록'으로 바뀌며 '← 돌아가기'(높이 28)가 즉시 생기고 제목이 98px 순간이동. 도착 줄 표시 없음. 바꾸면: 멘션은 종 rotate 0→18→−14→9→−4→0deg 600ms ease-out(축 50% 15%), 배지 scale 1→1.28→1 260ms cubic-bezier(.18,.88,.34,1.28), 숫자 translateY(70%→0) 150ms. 자동 알림은 배지만. 5개 한꺼번에도 1회. 읽음 막대 scaleY 1→0 + opacity 200ms, 글자색 200ms. 지운 줄 translateX(24px) + opacity 0 150ms → 아래 줄 translateY(36px→0) 220ms cubic-bezier(.16,1,.3,1). 알림 카드는 흐림 없음(배경 .97), 왼쪽 3px 색 막대(멘션 #6C5CE7, 피드백 #FDCB6E, 일정 #74B9FF) + 16px 아이콘, 등장 0.35s cubic-bezier(.16,1,.3,1), 퇴장 200ms, 동작 줄이기면 페이드만. '← 돌아가기' opacity 0→1 + translateX(−6px→0) 160ms, 제목 translateX(−98px→0) 180ms cubic-bezier(.2,0,0,1). 도착 줄 테두리 2px #6C5CE7 opacity 0→.9→0→.9→0 1400ms. 동작 줄이기: 흔들림·이동 없이 배지 숫자 교체, 도착 테두리 1.4초 정적 표시.

<details><summary>개발 메모</summary>

종·배지: NotificationPanel.tsx:242-273 — 배지는 즉시 마운트·교체, 빛은 notification-bell.css:21-42 상태 기반(건드리지 않음). bellRef/badgeRef/prevRef, useEffect([unreadCount, unreadMentionCount]): prev 가 null(하이드레이트)이거나 activeUserId 변경 직후면 기록만 하고, 증가 + 1초 쓰로틀이면 svg 에 WAAPI rotate 0/14/-11/7/-3/0deg 600ms(transformOrigin 50% 15%, 멘션이면 ×1.3), 배지 scale 1→1.28→1 260ms cubic-bezier(.18,.88,.34,1.28), 숫자 span key={count} 150ms. 클래스 토글 금지(::after 무한 빛 재시작 깜빡임). 줄: :146-155 inline 막대 색 → transform scaleY + opacity 200ms(색 고정), :177-178 제목은 색 transition 만(굵기 차이는 안 읽음 구분용이라 유지), 삭제 :231 은 WAAPI translateX(24px) + opacity 150ms 후 removeNotification + 아래 줄 FLIP, 모두 읽음 :398-400 은 동시 페이드, 묶음 :87·96 화살표는 rotate-90 하나로. 알림 창 여는 연출은 popup-rhythm 항목에서. 알림 카드: index.css:906-907 backdrop 제거, :914-936 전이 규칙을 no-preference 미디어 안으로(sonner 자체 reduce 규칙 복원), 퇴장 .25s → .2s(sonner TIME_BEFORE_UNMOUNT=200), notificationHelper.ts:58-70 dispatchNotification 에 className `bflow-toast--${type}` + icon(NotificationPanel.tsx:47-66 typeConfig 를 공용 util 로), 정적 inset 왼쪽 막대. 남은 시간 막대는 sonner 정지 조건과 어긋날 수 있어 선택. 돌아가기: Header.tsx:37-50 조건부 버튼(back-in 160ms), :51 h1 은 ref + useLayoutEffect([Boolean(navigationBackTarget)]) 에서 offsetLeft 차이를 WAAPI translateX 180ms(진입 경로 notificationSceneAction.ts:58-86, retakeNavigation.ts:13, sceneNavigationAction.ts:38, 복귀 useAppStore.ts:376). view-transition 의 제목 페이드와 겹치면 FLIP 은 바깥 span, 페이드는 안쪽 span. 도착: RetakeHubView.tsx:306-310 → RetakeHubItemRow.tsx:77-82 에 data-arrive nonce + ::after ring opacity 키프레임 1.4s(씬 상세의 rev-pulse index.css:1251-1267 는 box-shadow paint 반복이라 재사용하지 말고 모양만 맞춤), 재도착은 focusToken 으로 새 nonce. RetakeHubItemTable.tsx:162 행 key 에 group.key 포함 → '진행상태별' 탭에서 리마운트되며 펼침 초기화 → 펼침 상태를 테이블로 끌어올림. 씬 목록: ScenesView.tsx:1050 인라인 ref 콜백이 하이라이트 4초(:2789-2795) 동안 렌더마다 scrollIntoView smooth 재호출 → UnifiedSceneCard.tsx:182-187 처럼 prevHighlightedRef + useEffect 1회. WAAPI·smooth 는 useMotionPref 가드.

</details>

### 19. 댓글 보내기·이모지 반응의 손맛 — 입력칸에서 떠오르고, 반응은 '톡' `comments-send-react`

- 화면: 씬 상세·캐릭터 상세 댓글 패널(본문 댓글, 답글, 오른쪽 스레드 창), 말풍선 아래 이모지 반응 칩(👍 2 같은 것), 이모지 고르는 창
- 종류/빈도/작업/위험: polish / daily / M / low

**지금**: 댓글을 보내면 내 말풍선이 위에서 아래로 살짝 내려오며 생겨요(입력칸은 아래에 있는데 반대 방향이에요). 답글과 오른쪽 스레드 창 메시지는 아예 움직임 없이 뚝 생겨요. 저장이 오래 걸려도 보내기 버튼만 작게 돌 뿐 말풍선에는 '보내는 중' 표시가 없고, 실패하면 말풍선이 아무 말 없이 사라지고 입력칸에 글만 되돌아와요. 이모지 반응을 누르면 칩이 뚝 생기고 숫자도 2→3으로 뚝 바뀌며, 취소하면 칩이 뚝 사라지고 옆 칩들이 한 번에 당겨져요. 이모지 고르는 창은 뚝 열리고, '더 많은 이모지'를 누르면 창이 한 번에 커지며 위로 튀어 올라요.

**바꾼 후**: 보낸 말풍선이 입력칸 쪽(아래)에서 살짝 떠올라 자리 잡고, 답글과 스레드 창도 같은 방식으로 떠올라요. 저장이 0.4초 넘게 걸릴 때만 말풍선이 살짝 흐려지고 작은 시계가 붙었다가, 저장되면 또렷해져요(평소엔 말풍선에 아무 표시 없이 바로 끝나요). 실패하면 말풍선이 남은 채 빨간 테두리와 '보내지 못했어요 · 다시 보내기 · 지우기'가 붙어요. 반응을 누르면 새 칩만 '톡' 하고 살짝 커졌다 제자리로 오고, 숫자는 늘면 위로·줄면 아래로 짧게 굴러 바뀌며, 취소한 칩은 쏙 줄어들며 사라져요. 이모지 창은 스마일 버튼 쪽에서 피어나고, '더 많은 이모지'는 아래쪽을 버튼 옆에 붙인 채 위로 펼쳐져요.

**조심할 점**: 실패한 댓글을 화면에 남겨 두는 건 흐름을 바꾸는 일이라, 먼저 '실패 안내 + 떠오르는 방향 바로잡기'만 내고 '다시 보내기' 버튼은 다음 단계로 나누는 게 안전해요. 패널을 열 때 이미 있던 반응 칩들은 튀지 않고, 새로 생긴 칩만 반응해요.

**수치 사양(목업 기준)**: 장면: 댓글 패널(360×520, #1A1D27): 상대 말풍선 2개(왼쪽, #2D3041), 내 말풍선 2개(오른쪽, 보라 #6C5CE7 25%), 하단 입력칸(높이 44) + 보내기 버튼. 내 말풍선 아래 반응 줄 '👍 2', '❤️ 1' + 😀 버튼. 버튼: [보내기], [느리게 보내기(1.2초)], [실패하게 보내기], [👍 누르기/취소], [🎉 새로 추가], [😀 → 더 보기], [동작 줄이기]. 지금: 말풍선 translateY(−6px→0) + opacity 220ms 로 위에서 내려옴. 느리게 보내도 표시 없음. 실패하면 0.8초 뒤 말풍선이 사라지고 글이 입력칸으로 복귀(안내 없음). 칩 즉시 생성, 숫자 즉시, 취소하면 즉시 사라지며 옆 칩이 당겨짐. 이모지 창 즉시 등장, 더 보기 시 높이 80→320 으로 위치를 다시 계산해 위로 튐. 바꾸면: 말풍선 opacity 0→1 + translateY(8px→0) 220ms cubic-bezier(.16,1,.3,1). 400ms 를 넘기면 opacity .6 200ms + 시계 아이콘 12px, 완료 시 opacity 1 200ms. 실패 시 말풍선 유지 + 테두리 1.5px #E17055 층 opacity 0→1 200ms + 아래 작은 글 '보내지 못했어요 · 다시 보내기 · 지우기'. 새 칩 scale .4→1.07(70% 지점)→1 190ms cubic-bezier(.18,.88,.34,1.28). 숫자는 늘면 새 숫자 translateY(70%→0), 줄면 (−70%→0) 150ms. 취소 칩 scale .6 + opacity 0 140ms 후 제거. 이모지 창은 버튼 쪽 기준 scale .92→1 + opacity 140ms cubic-bezier(.16,1,.3,1), 더 보기는 아래 가장자리 고정·위로 커짐. 동작 줄이기: opacity 만 120ms.

<details><summary>개발 메모</summary>

진입: CommentPanel.tsx:2064-2069 `initial={{opacity:0, y:-6}}` → `initial={{opacity:0, transform:'translateY(8px)'}} animate={{opacity:1, transform:'translateY(0px)', transitionEnd:{transform:'none'}}}`. 답글 :2280·스레드 창 :2823 의 일반 div 를 motion.div 로, 스레드 목록은 AnimatePresence initial={false}. 첫 로드 정지는 :1926 initial={false} 유지. '활동 감추기'·'re만' 토글(:1494-1495) 시 퇴장 항목이 자리를 차지하다 툭 당겨지므로 popLayout. 상태: SceneCommentWithSource 에 로컬 전용 _pending/_failed(:1309 생성 시 _pending, 저장 성공 시 해제, addComment 페이로드에서는 제외). 흐림 표시는 400ms 타이머 뒤 opacity .6(:2155-2159 transition-opacity). 실패: :1387-1430 이 console.error 후 setComments(comments) 롤백 + 입력 복원(토스트 없음, electron/supabase.ts:1766~ throwIfError 로 실제 throw) → 1단계는 토스트 추가, 2단계는 _failed 로 남기고 다시 보내기(같은 id)·지우기(:1417-1424 이미지 정리 재사용). 수정 :1458-1461, 삭제 :1476-1480, 리액션 :730-738, 스레드 :1663-1676 도 공용 notifyRollback 토스트. 반응: ReactionsArea(:211)에 seenRef(첫 렌더 emoji 집합) → 새 emoji 에만 popIn(arcade.css:542-546 spawn 곡선 cubic-bezier(.18,.88,.34,1.28) 190ms 재사용), 서버 재조회(:724-729)는 key=emoji 동일이라 재생 안 됨. ReactionChip.tsx:25 transition-all(색만), :36 숫자 key 굴림 150ms, :37-41 툴팁 opacity + translateY(2px) 120ms. 퇴장 칩은 140ms 유지 후 제거(이웃 FLIP 은 비용 대비 효과 낮아 생략). EmojiPicker.tsx:51 `if (!open) return null` + :56-63 height 상수 80→320 으로 top 재계산 → 위로 열 땐 bottom 기준 고정, 컨테이너 picker-in 140ms(transform-origin 버튼 쪽, 단색 카드라 scale 안전). useMotionPref.

</details>

### 20. 실패·실수 순간의 안심 장치 — 되돌아간 체크는 '도리도리', 지운 것은 '되돌리기' `safety-net`

- 화면: 씬 목록(카드·시트)의 LO/완료/검수/PNG 체크와 액팅 단계·담당자별 진행이 저장에 실패해 되돌아갈 때, 댓글 말풍선 휴지통, 알림 창 '전체 삭제'
- 종류/빈도/작업/위험: fix / rare / M / low

**지금**: 단계 체크를 눌렀는데 인터넷이 잠깐 끊겨 저장이 안 되면, 체크가 아무 말 없이 원래대로 풀려요. 체크가 '튕겼다'는 사실조차 모를 수 있어요. 네 단계를 다 채운 순간이었다면 축하 꽃가루가 이미 터진 뒤에 체크만 슬그머니 빠져요. 액팅 단계 실패는 화면 아래 알림만 떠서 수십 장 중 어느 씬이 되돌아갔는지 알 수 없어요. 댓글 휴지통은 확인 없이 바로 지워지고 되돌릴 방법이 없어요. 알림 창의 '전체 삭제'도 한 번 누르면 전부 즉시 사라져요.

**바꾼 후**: 저장에 실패해 체크가 되돌아갈 때 그 칸이 고개를 젓듯 좌우로 짧게 흔들리고(0.25초), 빨간 테두리가 한 번 번졌다 사라져요. 동시에 오른쪽 아래에 'a012 검수 체크가 저장되지 않아 되돌렸어요 · 다시 시도'가 떠서, 한 번 누르면 같은 체크를 다시 보내요. 알림 창 '전체 삭제'는 목록을 비우면서 '알림을 모두 지웠어요 · 되돌리기'를 띄우고, 누르면 그대로 돌아와요. 다음 단계로 댓글 휴지통도 지운 자리가 접히며 사라지고, 5초 동안 '댓글을 지웠어요 · 되돌리기'가 떠요.

**조심할 점**: 댓글 되돌리기는 5초 동안 기다렸다 지우는 방식이라, 그 사이 다른 팀원 화면에는 댓글이 아직 남아 있다가 5초 뒤에 사라져요. 그 사이 앱을 닫거나 다른 씬으로 넘어가면 바로 지워지도록 챙겨야 해서, 알림 '전체 삭제' 되돌리기부터 먼저 하길 권해요.

**한솔 결정 (2026-10-03): '다시 시도' 버튼 없이 자동으로 다시 보낸다.**
- 단계 체크 저장이 실패하면 바로 되돌리지 않는다. 체크는 켜진 채로 두고 그 칸만 '다시 보내는 중' 표시(은은한 점선 테두리·살짝 흐림)를 단 채 자동으로 다시 보낸다: 0.8초 → 2초 → 4초 간격 3회.
- 인터넷이 끊긴 상태면(연결 상태 신호) 다시 연결될 때까지 기다렸다가 보낸다(최대 60초).
- 다시 보내는 중에 같은 칸을 또 누르면 기다리던 재전송을 취소하고 마지막 값만 보낸다.
- 다시 보내 봐도 소용없는 실패(권한·검증 거절 등)는 기다리지 않고 바로 되돌린다.
- 끝내 실패하면 그때 되돌리며 칸이 도리도리 흔들리고(0.25초) 빨간 테두리가 번졌다 사라지고, 오른쪽 아래에 'a012 검수 체크를 저장하지 못해 되돌렸어요 · 인터넷 연결을 확인해 주세요' 안내만 뜬다(버튼 없음).
- 다시 보내기가 성공하면 표시만 조용히 사라진다.
- 알림 '전체 삭제'·댓글 삭제의 '되돌리기'는 제안서대로 유지(이건 실수 되돌리기라 버튼이 맞다).

**수치 사양(목업 기준)**: 장면: 씬 카드 1장(LO·완료 켜짐) + 4칸 막대, 스위치 '저장 실패 상황'. 오른쪽에 알림 창(알림 5줄 + '전체 삭제' 버튼), 아래 댓글 3개(내 댓글에 휴지통). 버튼: [검수 클릭], [전체 삭제], [댓글 휴지통], [되돌리기], [동작 줄이기]. 지금: 검수 켜짐 → 0.8초 뒤 아무 말 없이 꺼짐. 전체 삭제는 즉시 빈 창. 휴지통은 말풍선 opacity 220ms 로 사라지고 끝. 바꾸면: 0.8초 뒤 검수 칸 translateX 0→−3→3→−2→0px 240ms ease-out + 빨간(#E17055) 1.5px 테두리 층 opacity 0→1(15% 지점)→0 900ms, 동시에 오른쪽 아래 알림 카드 'A012 검수 체크가 저장되지 않아 되돌렸어요 [다시 시도]'(누르면 다시 켜짐). 전체 삭제는 줄들 opacity→0 150ms 후 빈 창 + 알림 카드 '알림을 모두 지웠어요 [되돌리기]'(아래 2px 막대가 5초 동안 scaleX 1→0 linear), 되돌리기를 누르면 줄들 opacity 0→1 180ms. 휴지통은 말풍선 opacity→0 + translateX(12px) 150ms, 아래 말풍선들 translateY(dy→0) 220ms cubic-bezier(.16,1,.3,1), 알림 카드 '댓글을 지웠어요 [되돌리기]' 5초. 동작 줄이기: 흔들림 없이 테두리만, 이동 없음.

<details><summary>개발 메모</summary>

체크 실패: ScenesView.tsx:4073-4090 catch 가 console.error('[토글 실패]') 후 setSceneStageValue 롤백만(persistSequentialStagePatchWithRollback sceneStageProgression.ts:70-87 도 토스트 없음). 대조: :2347-2349 '단계 변경 저장에 실패했습니다', :2368·:2565·:4068 '담당자별 진행 저장에 실패했습니다' 는 토스트만. 수정: 공용 notifyRollback(msg, retry) → sonnerToast.error(`${sceneId} ${stageLabel} 체크가 저장되지 않아 되돌렸어요`, {action:{label:'다시 시도', onClick:() => handleToggleForSheet(sheetName, sceneId, stage, {sceneUuid, sceneIndex})}}). 축하가 아직 진행 중이면 clearCelebration(:2881). teammate-live 의 useSceneFlashStore 재사용 flash(id, {kind:'rollback', stage, at}). StageSegmentToggle/ScenePhaseToggle 에 data-stage-key, 해당 버튼에 WAAPI translateX 0/-3/3/-2/0px 240ms ease-out(arcade.css:566-570 impact-soft 진폭), 안쪽 `<span key={flashAt} className='stage-seg-rollback'>`(border 1.5px red, @keyframes 15%{opacity:1} → 0, 900ms) — key 재마운트, 클래스 토글 금지. reduce 면 흔들림 없이 테두리만. 같은 notifyRollback 을 CommentPanel.tsx:730-738·1458-1461·1476-1480·1663-1676 에도. 알림 전체 삭제: NotificationPanel.tsx:407-415 clearAll 직전 스냅샷 → 토스트 액션 → useNotificationStore 에 restore(useNotificationStore.ts:217-220 persistToDisk([]) 경로 함께 갱신, DB 읽음과 무관하게 로컬 목록만). 댓글 지연 삭제(2단계): CommentPanel.tsx:1465-1481 handleDelete 에서 _pendingDelete 로 숨기고 5000ms 뒤 deleteComment, 되돌리기 시 타이머 취소. 패널 언마운트(CommentPanelResizable.tsx:288 key 리마운트)·창 종료(App.tsx:463 근처 종료 대기 경로)·beforeunload 에서 즉시 확정. 답글이 달린 부모는 숨김 처리 규칙 필요.

</details>

### 바탕 C 목업. 시트 씬 번호 빛 테두리 — 평소엔 멈춤, 마우스 올린 줄만 회전 `sheet-number-glow`

- 화면: 씬 목록 › 시트 보기의 씬 번호
- 종류/빈도/작업/위험: polish / daily / S / low

**지금**: 시트 보기에서는 모든 줄의 씬 번호 빛 테두리가 3초에 한 바퀴씩 쉬지 않고 돌고, 번호 글자의 빛도 숨 쉬듯 계속 밝아졌다 어두워져요. 줄이 50개면 50개가 동시에 움직여서, 컴퓨터가 화면을 쉬지 않고 다시 칠해요.

**바꾼 후**: 같은 빛 테두리가 평소에는 멈춘 채 은은하게 보이고, 마우스를 올린 줄만 테두리가 돌며 빛이 밝아져요. 디자인은 그대로 두고, 움직임은 지금 보고 있는 줄에만 줘요.

**조심할 점**: 한솔 님이 직접 고른 디자인이에요. 늘 도는 모습이 더 좋다면 그대로 두고 회전만 느리게 하는 절충안도 있어요.

**수치 사양(목업 기준)**: 장면: 시트 표 일부 8줄(줄 높이 30, 보더 #2D3041 가로줄). 각 줄: 씬 번호 a001~a008 을 빛 테두리 칸(padding 3px 10px, radius 7, 1.5px conic 테두리 #6C5CE7↔#A29BFE, 글자 #6C5CE7 + text-shadow 빛)에, 옆에 담당자 이름·단계 점 4개 흉내. 무대 오른쪽 위에 작은 토글 '다시 칠하는 곳 보기'(data-trigger) — 켜면 매 프레임 다시 칠해지는 요소 위에 초록 반투명 테두리가 깜빡임(크롬 개발자 도구의 paint flashing 흉내: 지금은 8줄 전부, 바꾼 후는 마우스를 올린 줄만). 지금: 모든 테두리 3s linear infinite 회전 + 글자 빛 2.4s ease-in-out 펄스, hover 줄은 1.2s 회전 + 더 밝게. 바꾼 후: 기본은 정적 그라데이션 테두리(opacity .55) + 정적 글자 빛, hover 줄만 1.2s 회전 + 밝게(opacity 200ms 전환). 각 줄에 data-trigger="hover" 를 2~3개. play(): '다시 칠하는 곳 보기'를 켜고, 가짜 커서가 3번째 줄 → 6번째 줄로 천천히 이동하며 hover 상태를 보여준다. 동작 줄이기: 회전·펄스 없음.

<details><summary>개발 메모</summary>

src/styles/scene-effects.css:25-64 — .scene-num-glow-wrap::before 의 conic-gradient(from var(--scene-effect-angle)) 를 @property 각도로 3s linear infinite 회전(매 프레임 paint, 합성 스레드로 못 감), .scene-num-glow-text 의 text-shadow 2.4s 펄스(paint). hover 시 1.2s 회전 + blur(0.5px). 제안: 기본 animation:none + 정적 그라데이션, tr:hover(또는 wrap:hover) 에서만 회전·펄스. :270-277 is-resizing 은 animation:none 대신 animation-play-state: paused (연타 클래스 토글 깜빡임 방지).

</details>
