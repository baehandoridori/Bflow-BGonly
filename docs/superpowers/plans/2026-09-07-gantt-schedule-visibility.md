# 간트 막대와 그룹 일정 개선 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent tasks below. User has already authorized implementation, local review and deployment after the retake release.

**Goal:** 진행률을 읽기 쉬운 막대, 하위 일정 전체 이동, 저장된 계층 색상, 기간·오늘 기준 남은 일수를 제공한다.

**Architecture:** 간트의 프로젝트 단위 CAS·낙관적 저장·실행 취소와 기존 캘린더 projection을 유지한다. Canvas는 드래그 고스트를 계산하고 View는 정본 프로젝트에서 모든 후손을 한 번에 저장한다. 새 항목의 기본 색상은 실제 color에 저장하며 하위 항목은 null 상속으로 캘린더와 일치시킨다.

**Tech Stack:** Electron, React, TypeScript, 기존 B flow 공용 dropdown, node:test, PGlite.

**Spec:** 2026-09-07 사용자 요청 및 '기간과 남은 일수 함께 표시' 답변.

## Global Constraints

- 그룹의 위·좌·우 테두리는 유지하면서 진행률 채움과 전환 애니메이션을 복원한다.
- 이름의 호버와 차트 옆 ⋯ 버튼은 제거한다. 막대 호버·키보드 상세 접근, 우클릭과 상세창은 유지한다.
- 그룹 이동은 필터나 접힘과 관계없이 모든 하위 그룹·작업·완료 작업·마일스톤을 함께 옮긴다. 시간 값과 기간을 유지한다.
- 자동 일정 항목이 포함되면 기존 단일 작업 정책처럼 한 번 확인하여 수동 전환하고 선행 관계는 유지한다. 취소 시 전체 변경 없음.
- 새 프로젝트는 덜 사용한 색, 새 최상위 그룹은 프로젝트·형제와 다른 색, 하위 그룹·작업은 상위 색을 상속한다. 기존 사용자 지정 색·상속 선택은 보존한다.
- 기간은 항상 막대 오른쪽에 표시한다. 상단 옵션으로 오늘 선과 남은 일수를 켜고 끄며, 남은 일수는 'N일 남음 / 오늘 마감 / N일 지남'으로 표시한다.
- 프로젝트 이름은 굵고 크게, 그룹 이름은 접기 버튼과 중간 굵기로, 작업 이름은 보통 굵기로 구분한다. 상시 종류 배지는 복원하지 않는다.
- 완료 상태는 체크와 '완료' 버튼 형태로 명확히 보인다. 진행률 증가 시 막대와 상세 편집기의 테두리가 짧게 반응하며, 입력 포커스·저장 흐름을 유지하고 동작 줄이기 설정을 따른다.
- 리테이크 PR #275(v1.116.0)의 배포가 끝난 뒤 최신 main·배포 버전으로 통합하고 이번 배포를 진행한다. 그때까지 G드라이브에 쓰지 않는다.

## Task 1: 그룹 날짜의 원자적 이동

Files: `domain.ts`, `tests/ganttSubtreeShift.test.ts`, `tests/ganttPreview.test.ts`; integration in `GanttView.tsx` and `ganttCreationUi.test.ts` by root.

Interface: `shiftTaskSubtree(project: GanttProject, groupId: string, days: number): GanttProject`. A zero delta returns unchanged dates. Invalid/non-integer deltas and missing/non-group IDs fail before mutation. View handles the existing confirmation and passes the same canonical revision to one save.

- [x] First test nested groups, hidden/completed children, timed midnight spans, leap dates, milestones, automatic modes and external successors with concrete +3 and -2 day shifts.
- [x] Implement using `descendantIds`, `shiftDate`, immutable cloning, manual mode for shifted automatic descendants, then `scheduleProject`.
- [x] Test a single preview revision/undo/redo, projected calendar dates, and full rollback when one linked calendar is read only.
- [x] Integrate `onShiftGroup(project, task, deltaDays)` with fresh canonical state, permission/revision checks and pending/confirmation cancellation.

## Task 2: 일관된 새 항목 색상

Files: new `colors.ts`, `tests/ganttColors.test.ts`; creation wiring in `GanttView.tsx` by root.

Interface: `nextProjectColor(projects: Pick<GanttProject,'color'>[]): string`, `newGroupColor(project: GanttProject, parentId: string|null): string|null`.

- [x] Test no duplicate colors before palette exhaustion, least-used reuse, lowercase hex equivalence, root sibling exclusion and nested null inheritance.
- [x] Implement deterministic palette selection. Use the current snapshot on creation. Keep existing resolver and SQL inheritance unchanged.
- [x] Verify project/group/child color through canonical preview calendar projection and inherited parent recoloring.

## Task 3: 막대 표시·호버·고스트와 날짜 옵션

Files: `GanttCanvas.tsx`, `GanttTooltip.tsx`, `canvas.css`, `navigation.css`, `tests/ganttCanvas.test.ts`, `tests/ganttTooltip.test.ts`; new pure label helper/tests if needed.

- [x] Test bar-only hover anchors, keyboard Escape focus return, no row menu button, group drag callback and all visible descendants moving in the ghost.
- [x] Add a filled group progress layer under the top bracket with an interruptible width transition and reduced-motion support.
- [x] Show duration after every bar (including 0d milestones); retain exact timed durations. Use compact days rather than assuming every month is 30 days.
- [x] Add a compact existing-style display menu for today's line and remaining days; persist only local display preferences. Update today at local midnight and on focus.
- [x] Verify dependency endpoints and ancestors use preview bounds during group dragging, cancellation/revision changes discard the entire ghost.

## Task 4: 통합 검사와 순차 배포

- [x] Run related node tests and independent local reviews; fix actionable findings and repeat the affected checks.
- [x] Login to preview as 배한솔, verify 1280×720/1024×640, dark/light, group drag, duration labels, progress and bar F2. Deep nesting, pointer hover events and calendar parity covered by automated behavior tests; distinguish these from native production interaction.
- [ ] Incorporate retake release's final main, set the next minor version and retain all update notes. Run `npm run typecheck` and `npm run build:vite` with `BFLOW_PGLITE_MODULE` configured.
- [ ] PR/merge, then build from exact merge in a clean release worktree via `npm run build`.
- [ ] After the retake deployment is explicitly complete, back up live release, verify candidate, copy non-manifest files, confirm full parity with old manifest preserved, publish manifest last and verify every hash.
