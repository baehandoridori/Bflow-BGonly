# 공유 캘린더 구현 — 실행 세션 핸드오프 프롬프트 (PR1~PR4)

> 사용법: **권장은 "통합 순차 진행 프롬프트" 하나를 새 Claude Code 세션(작업 디렉터리 `C:\Bflow-BGonly`)에 붙여넣는 것** — 한 세션이 PR1→PR4 를 순차 진행하며 각 머지 시점에만 한솔 확인을 받는다. 개별 프롬프트(아래)는 PR 을 세션별로 나누고 싶을 때 사용.
> 공통 전제: 머지·G드라이브 배포·슬랙 공지·라이브 DB 적용은 **한솔이 직접 지시할 때만**. 각 세션은 PR 생성 + 코덱스 리뷰 루프까지가 자동 범위다.

---

## 통합 순차 진행 프롬프트 (권장 — 한 세션으로 PR1→PR4)

```
B flow 공유 캘린더 라운드(설계·플랜 완료, 문서는 main 에 머지됨)를 PR1부터 PR4까지 순차 구현해줘.

## 전체 진행 방식
이 세션은 PR1 → PR2 → PR3 → PR4 를 순서대로 진행한다. 각 PR 마다:
1. origin/main 최신화 → 새 워크트리·브랜치 생성 (superpowers:using-git-worktrees). 브랜치명: claude/calendar-pr1-cleanup / pr2-data / pr3-ui / pr4-notify.
2. 필독: docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md 의 Chunk 0(공통 규칙·파일 지도) + 해당 PR 의 Chunk. 추가로 —
   · PR1: 설계서 §10 + docs/superpowers/research/2026-08-24-calendar-current-structure.md §3
   · PR2: 설계서 §4·§5·§6·§12
   · PR3: 설계서 §3 + 시안 원본 docs/superpowers/specs/mockups/2026-08-24-calendar/M1~M6 (브라우저로 열어 시각 기준)
   · PR4: 설계서 §7·§8·§9
   (설계서 = docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md, 플랜과 충돌 시 설계서 우선. 단 플랜에 "의도된 편차"로 명시된 항목은 플랜을 따른다)
3. superpowers:executing-plans(서브에이전트 가능하면 superpowers:subagent-driven-development)로 해당 Chunk 의 Task 를 체크박스 순서대로 실행. 연구 문서의 줄 번호는 드리프트 가능 — 모든 삭제·수정은 grep 재확인 후 진행.
4. 검증 게이트(순서 고정): npm run typecheck → 관련 npm run test:* → npm run build:vite → 프리뷰 실기(npm run dev:renderer 후 http://localhost:5190/?preview=1, mock 로그인 배한솔/1234). 작동 증명 없이 완료 표시 금지. PR별 실기 시나리오는 각 Chunk 마무리 Task 에 있다.
5. 버전: PR 생성 직전 origin/main 기준 마이너 +1, package.json + package-lock.json(최상단 version + packages[""].version) 3자 일치.
6. pr-creator 스킬로 PR 생성 → codex-review-loop 스킬로 코덱스가 명시적 클린 신호를 줄 때까지 반영.
7. 코덱스 클린 후 완료 보고(각 PR 프롬프트의 "완료 보고" 항목 형식)와 함께 한솔에게 머지 확인을 요청하고 대기한다. "머지해" 지시를 받으면 gh pr merge <번호> --squash 로 머지하고, gh pr view 로 머지 확인 후 다음 PR 로 넘어간다. 지시 전 임의 머지 금지.

## PR 사이 특별 게이트
- PR2 머지 직후: PR3 시작 전에 한솔에게 마이그레이션 라이브 적용 게이트를 상기시켜라(이 문서 하단 "배포 게이트 체크리스트" 1번). 적용 지시가 오면 DEVLOG/migrations/2026-08-24-shared-calendars.sql 을 Supabase MCP 로 적용하고 이관 전후 행 수 비교(SELECT count(*))로 검증해 보고한다. 적용 지시가 없어도 PR3 는 프리뷰 mock 으로 진행 가능하니 확인 후 계속.
- PR4 머지 후: 빌드·G드라이브 배포는 별도 지시 대기(bflow-release-deploy 스킬, manifest.json 마지막 원칙).

## PR별 요점 (상세는 각 Chunk)
- PR1 정리(동작 불변): 죽은 코드 삭제(EventCreateTooltip, ScheduleView 내 EventDetailModal/TodayView/편집모드 잔재 등) + 날짜 유틸·휴가 매핑 공용화 + ScheduleView 분해 + test:calendar 스크립트. isPrivate/구글 경로는 건드리지 않는다.
- PR2 데이터: 마이그레이션 SQL 작성(파일만, 라이브 적용은 게이트) + calendarPermissions(TDD) + electron/calendarStore·calendarIpc + ensurePersonalCalendar + 렌더러 타입/서비스/useCalendarStore + "나만 보기" 저장 경로 스위치 + mock. 불변식: 머지 후에도 화면 동작 동일, 테이블 없어도 조용히 동작(에러 토스트 금지).
- PR3 UI: 프리뷰 seed 선행 → CalendarRail → TagBar(+필터 TDD) → 헤더 개편(유형·부서 필터 제거) → EventCreateModal 개편(캘린더 선택·종일/시각·태그, "나만 보기" 체크박스 제거) → CalendarSettingsModal → TagManagerPopover → EventSidePanel/EventQuickEdit → 주/오늘 시간 표시 → 칩 규칙. 마무리에 시안 M1~M6 대조 체크리스트 수행. 알림/realtime·타임라인 탭·휴가 모듈은 금지.
- PR4 알림·마감: 알림 생성(수신자·문구 순수 함수 TDD) → 캐치업+알림센터 calendar 유형 → realtime 4테이블 구독 + App.tsx data-change 제외/calendar-changed 수신부 수정 → teamCalendarId 완전 제거(grep 소탕 증거) → 프리뷰 알림 seed → ROADMAP/CLAUDE.md/lessons 문서 마감. 실기: 두 창 실시간 반영·알림 클릭 이동·구글 미연동 표시.

## 전 구간 금지
G드라이브 배포·슬랙 게시(한솔 명시 시에만), /home/user/Bflow(원본 레포) 수정, 지시 없는 머지, PR 범위 밖 변경(각 Chunk 의 "금지" 참조).

## 컨텍스트 유지
세션이 길어져 컨텍스트가 요약되더라도, 각 PR 시작 시점마다 Chunk 0 + 해당 Chunk 를 다시 읽어 상태를 복원한 뒤 진행하라. 각 PR 완료 보고에는 "지금까지 머지된 PR / 남은 PR" 현황 한 줄을 포함하라.

시작: 지금 바로 PR1 부터 진행해.
```

> 아래 개별 프롬프트는 PR 을 세션별로 나눠 돌리고 싶을 때의 대안이다. 통합 프롬프트와 내용은 동일하다.

---

## PR1 프롬프트 — 정리 (동작 불변)

```
B flow 공유 캘린더 라운드의 PR1(정리)을 구현해줘.

1) origin/main 최신화 후 새 워크트리·브랜치 claude/calendar-pr1-cleanup 에서 작업해. (superpowers:using-git-worktrees)
2) 다음을 순서대로 읽어: docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md 의 Chunk 0(공통 규칙·파일 지도) → Chunk 1 전체. 배경이 필요하면 docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md §10 과 docs/superpowers/research/2026-08-24-calendar-current-structure.md §3 을 참조해.
3) superpowers:executing-plans(서브에이전트 가능하면 superpowers:subagent-driven-development)로 Chunk 1 의 Task 1.1~마무리 Task 를 체크박스 순서대로 실행해. 연구 문서의 줄 번호는 드리프트했을 수 있으니 모든 삭제는 grep 재확인 후 진행.
4) 이 PR 은 동작 불변이 목표다. 검증 게이트(typecheck → test → build:vite → 프리뷰 실기: 월/2주/주/오늘 전환·드래그 생성·클릭 상세·우클릭 퀵에디트·대시보드 위젯)를 통과 증거와 함께 보고해.
5) 버전은 PR 생성 직전 origin/main 기준 마이너 +1 (package.json + package-lock.json 3자 일치). pr-creator 스킬로 PR 생성 후 codex-review-loop 스킬로 코덱스가 명시적 클린 신호를 줄 때까지 반영해.
금지: 머지, G드라이브 배포, 슬랙 게시, /home/user/Bflow(원본 레포) 수정, isPrivate/구글 경로 변경(그건 PR2·PR4 몫).
완료 보고: 삭제한 죽은 코드 목록 / ScheduleView 분해 결과(파일·줄수) / 검증 게이트 결과 / PR 링크.
```

---

## PR2 프롬프트 — 데이터 계층

```
B flow 공유 캘린더 라운드의 PR2(데이터 계층)를 구현해줘. 전제: PR1(정리)이 main 에 머지된 상태여야 해 — 아니면 멈추고 알려줘.

1) origin/main 최신화 후 새 워크트리·브랜치 claude/calendar-pr2-data 에서 작업해.
2) 다음을 순서대로 읽어: docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md 의 Chunk 0 → Chunk 2 전체 → 설계서 docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md §4(DDL)·§5(권한)·§6(IPC)·§12(호환).
3) superpowers:executing-plans 로 Chunk 2 의 Task 를 순서대로 실행해: 마이그레이션 SQL 작성(파일만 — 라이브 적용 금지, 적용은 한솔 게이트) → calendarPermissions(TDD) → electron/calendarStore·calendarIpc → ensurePersonalCalendar → 렌더러 타입/서비스/useCalendarStore → "나만 보기" 저장 경로 스위치 → devElectronAPI mock.
4) 핵심 불변식: 이 PR 머지 후에도 화면 동작은 기존과 동일해야 하고, 테이블이 아직 없어도(마이그레이션 미적용) 에러 토스트 없이 조용히 동작해야 해. 프리뷰에서 "나만 보기" 일정 생성·표시가 여전히 되는지 확인해.
5) 검증 게이트 + 버전(마이너 +1, 3자 일치) + pr-creator + codex-review-loop. PR 본문에 설계서와 다른 의도된 편차(파일 배치 calendarStore/calendarIpc 분리 등, Chunk 2 도입부 참조)를 명시해.
금지: 머지, 배포, 슬랙, 라이브 DB 적용(apply_migration 금지), 원본 레포 수정, UI 개편(PR3 몫).
완료 보고: 신규 테이블/IPC 목록 / 권한 테스트 매트릭스 결과 / 프리뷰 확인 결과 / 라이브 적용 대기 중인 SQL 경로 / PR 링크.
```

---

## PR3 프롬프트 — UI (레일·태그·모달)

```
B flow 공유 캘린더 라운드의 PR3(UI)를 구현해줘. 전제: PR2 가 main 에 머지된 상태여야 해 — 아니면 멈추고 알려줘. (라이브 DB 적용 여부는 무관 — 프리뷰 mock 으로 개발한다)

1) origin/main 최신화 후 새 워크트리·브랜치 claude/calendar-pr3-ui 에서 작업해.
2) 다음을 순서대로 읽어: docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md 의 Chunk 0 → Chunk 3 전체 → 설계서 §3(UI 명세) → 시안 원본 docs/superpowers/specs/mockups/2026-08-24-calendar/M1Month~M6Notify.dc.html (브라우저로 열어 시각 기준으로 삼아).
3) superpowers:executing-plans 로 Chunk 3 의 Task 를 순서대로: 프리뷰 seed 선행 → CalendarRail → TagBar(+필터 테스트 TDD) → 헤더 개편(기존 유형·부서 필터 제거) → EventCreateModal 개편(캘린더 선택·종일/시각·태그, "나만 보기" 체크박스 제거) → CalendarSettingsModal → TagManagerPopover → EventSidePanel/EventQuickEdit → 주/오늘 시간 표시 → 칩 규칙.
4) 각 UI Task 마다 프리뷰 실기 확인(구체적 클릭 경로는 플랜에 있음). 마무리 Task 의 시안 M1~M6 대조 체크리스트를 항목 단위로 수행하고 스크린샷 또는 관찰 기록을 남겨.
5) 검증 게이트 + 버전(마이너 +1) + pr-creator + codex-review-loop. 사용자 체감이 큰 릴리즈이므로 PR "📋 업데이트 요약"은 시나리오 톤으로(기술 용어·식별자 금지).
금지: 머지, 배포, 슬랙, 라이브 DB 적용, 원본 레포 수정, 알림/realtime(PR4 몫), 타임라인 탭·휴가 모듈 변경.
완료 보고: 시안 대조 체크리스트 결과(불일치 항목 포함) / 프리뷰 시나리오(캘린더 생성→멤버 공유→일정 생성→태그 토글→보기전용) 결과 / PR 링크.
```

---

## PR4 프롬프트 — 알림·실시간·마감

```
B flow 공유 캘린더 라운드의 PR4(알림·실시간·마감)를 구현해줘. 전제: PR3 가 main 에 머지된 상태여야 해 — 아니면 멈추고 알려줘.

1) origin/main 최신화 후 새 워크트리·브랜치 claude/calendar-pr4-notify 에서 작업해.
2) 다음을 순서대로 읽어: docs/superpowers/plans/2026-08-24-calendar-shared-calendars.md 의 Chunk 0 → Chunk 4 전체 → 설계서 §7(실시간)·§8(알림)·§9(구글 처분).
3) superpowers:executing-plans 로 Chunk 4 의 Task 를 순서대로: 알림 생성(수신자 계산·문구 순수 함수 TDD) → 캐치업+알림센터 calendar 유형 → realtime 4테이블 구독 + App.tsx data-change 제외/calendar-changed 수신부 수정 → teamCalendarId 완전 제거 → 프리뷰 알림 seed → ROADMAP/CLAUDE.md/lessons 문서 마감.
4) 실기 시나리오: 프리뷰 두 창(또는 mock 헬퍼)으로 실시간 반영, 알림 수신→클릭→날짜 이동, 구글 미연동 상태 표시를 확인해.
5) 검증 게이트 + 버전(마이너 +1) + pr-creator + codex-review-loop. PR 본문에 렌더러 이벤트 채널을 기존 broadcast 경로로 수렴시킨 의도된 편차를 명시해.
금지: 머지, 배포, 슬랙, 라이브 DB 적용, 원본 레포 수정.
완료 보고: 알림 문구 규칙 테스트 결과 / 실시간 시나리오 결과 / teamCalendarId 제거 grep 소탕 증거 / 다음 라운드 잔여물(private_calendar_events 델타 재이관 후 DROP) 재확인 / PR 링크.
```

---

## 배포 게이트 체크리스트 (한솔 지시 후, 배포 세션용)

1. PR2 머지 직후: `DEVLOG/migrations/2026-08-24-shared-calendars.sql` 라이브 적용 (Supabase MCP) → 이관 전후 행 수 비교(`SELECT count(*)`) → `calendar_tags` 시드 확인.
2. PR4 머지 후: bflow-release-deploy 스킬로 빌드·배포 (빌드 파일 먼저, manifest.json 마지막).
3. 배포 후 실기: 구글 미연동 계정으로 팀 캘린더 보임 확인, 두 PC 실시간 반영, 알림 수신.
4. 다음 라운드 백로그: 전 팀원 업데이트 확인 후 `private_calendar_events` 델타 재이관 + DROP / 반복 일정·슬랙 알림·D-3 강조 여부 재논의.
