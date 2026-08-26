# 캘린더 2차 개편 실행 프롬프트 (핸드오프)

> 사용법: 아래 **통합 순차 진행 프롬프트**를 새 Claude 세션에 그대로 붙여넣는다.
> 한 세션이 PR-A→PR-E를 순차 진행하며, **머지 시점마다 한솔 확인**을 받는다.
> (개별 PR 프롬프트는 하단 — 세션이 끊겼을 때 이어붙이는 용도)

---

## 통합 순차 진행 프롬프트 (권장)

```
캘린더 2차 개편(주간 시간표+폴리싱+ICS 구독)을 구현 플랜대로 진행해 줘.

기준 문서 (이 순서로 먼저 읽을 것):
1. CLAUDE.md
2. docs/superpowers/specs/2026-08-26-calendar-timegrid-design.md  ← 확정 설계 SSOT (D8~D15)
3. docs/superpowers/plans/2026-08-26-calendar-timegrid.md         ← 구현 플랜 (Chunk 0~5)
4. 시안: docs/superpowers/specs/mockups/2026-08-26-calendar-timegrid/proposal.html
5. tasks/lessons.md

진행 방식:
- 플랜 Chunk 0(공통 규칙)을 숙지한 뒤, PR-A → PR-B → PR-C → PR-D → PR-E 순서로 진행.
- PR-A는 플랜 Chunk 1의 지시대로 "1차 플랜(2026-08-24-calendar-shared-calendars.md)의
  Chunk 4"를 그대로 실행한다 (버전만 v1.106.0).
- 각 PR: 최신 origin/main에서 분기 → 플랜 Task 순서대로 (TDD 태스크는 테스트 먼저) →
  typecheck + 관련 테스트 + build:vite 통과 → pr-creator 스킬로 PR 생성 →
  codex-review-loop 스킬로 코덱스 리뷰 클린까지 (P1~P3 반영, 명시적 클린 신호 필수) →
  "PR #N 코덱스 클린. 머지해도 될까요?"라고 나(한솔)에게 물은 뒤 대기.
  내가 "머지"라고 하면 gh pr merge --squash 후 다음 PR로.
- 플랜의 파일:줄 번호는 참고값 — 수정 전 grep으로 재확인하고, 기존 이름과 다르면 기존
  이름을 따른다.
- update-notes.json과 PR "업데이트 요약"은 비개발자 톤 룰(CLAUDE.md) 엄수.
- G드라이브 배포는 하지 마 (내가 따로 지시).
- PR-D의 Task D.5(월 보기 점 라인)는 체급 게이트가 있다 — 착수 전 재조사에서 판 커지면
  중단하고 나에게 보고.
- 막히면 멈추고 나에게 물어봐. 플랜과 실제 코드가 크게 다르면 플랜을 맹신하지 말고
  설계서(D8~D15) 의도 기준으로 판단해.

지금 PR-A부터 시작해.
```

---

## 개별 PR 프롬프트 (세션 재시작용)

각 프롬프트 앞에 공통으로: "기준 문서 5개(위 통합 프롬프트와 동일)를 먼저 읽어."

### PR-A (알림, v1.106.0)
```
캘린더 플랜의 Chunk 1에 따라, 1차 플랜 2026-08-24-calendar-shared-calendars.md의 Chunk 4
(Task 4.1~4.7)를 실행해 줘. 브랜치 claude/calendar-pr4-notify, 버전 v1.106.0.
선행 반영분 델타(realtime 4테이블 구독 기존재 등)는 새 플랜 Chunk 1 Step 2 참조.
PR 생성·코덱스 클린까지 하고 머지는 나에게 물어봐.
```

### PR-B (시간표 본체, v1.107.0)
```
캘린더 플랜 Chunk 2(Task B.1~B.6)를 실행해 줘. 브랜치 claude/calendar-tg1-view.
timeGridLayout은 테스트 먼저(TDD). 시안 §02와 프리뷰 실측 대조 필수.
PR 생성·코덱스 클린까지 하고 머지는 나에게 물어봐.
```

### PR-C (인터랙션, v1.108.0)
```
캘린더 플랜 Chunk 3(Task C.1~C.7)를 실행해 줘. 브랜치 claude/calendar-tg2-interact.
calendarEventDiff는 테스트 먼저. 드래그 3종+Esc+자동 스크롤 프리뷰 실측 필수.
PR 생성·코덱스 클린까지 하고 머지는 나에게 물어봐.
```

### PR-D (폴리싱, v1.109.0)
```
캘린더 플랜 Chunk 4(Task D.1~D.6)를 실행해 줘. 브랜치 claude/calendar-tg3-polish.
항목별 커밋 분리. Task D.5는 체급 게이트 — 판 커지면 중단하고 보고.
PR 생성·코덱스 클린까지 하고 머지는 나에게 물어봐.
```

### PR-E (ICS 구독, v1.110.0)
```
캘린더 플랜 Chunk 5(Task E.1~E.4)를 실행해 줘. 브랜치 claude/calendar-tg4-ics.
expandIcsToEvents는 테스트 먼저. node-ical은 메인 프로세스 전용.
PR 생성·코덱스 클린까지 하고 머지는 나에게 물어봐.
```

---

## 게이트 요약 (한솔용)

| 시점 | 한솔이 할 일 |
|---|---|
| 각 PR 코덱스 클린 후 | "머지" 한 마디 (또는 보류 지시) |
| PR-D Task D.5 체급 보고 시 | 진행/다음 라운드 이관 결정 |
| 전체 머지 후 | 배포 지시("배포해줘") — bflow-release-deploy 절차, manifest 마지막 |
| 배포 후 | 팀 안내 여부 결정(슬랙 공지는 명시 요청 시에만) |
