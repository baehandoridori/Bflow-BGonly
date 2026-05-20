---
description: 컴포지팅 대시보드 PR 2 시작 — Store + 공통 컴포넌트
---

# 세션 2 시작 — 컴포지팅 대시보드 PR 2 (Store + 공통 컴포넌트)

## 상황

한솔님이 컴포지팅 현황 대시보드를 만드는 중. **PR 1 (기반: 토큰·타입·DB 스키마) 머지 완료** 했으니 이제 **PR 2 (Store + 공통 컴포넌트)** 차례.

## 진행 전 체크

다음을 먼저 확인:

1. **PR 1 머지 확인**:
   - `git log --oneline main -3` 으로 v1.30 또는 "컴포지팅 대시보드 기반" 커밋 머지 확인
   - 머지 안 됐으면 한솔님께 보고 + PR 1 상태 점검 후 진행

2. **plan 파일 PR 1 체크박스 확인**:
   - `docs/superpowers/plans/2026-05-21-compositing-dashboard.md` 의 PR 1 섹션이 모두 `[x]` 인지
   - 미완료가 있으면 그것부터 마무리

3. **main 최신화**:
   - 워크트리에서 작업할 거면 `git pull --ff-only` 또는 새 워크트리 (`Skill: superpowers:using-git-worktrees`)

## 이번 세션의 목표 (PR 2)

> **목표:** 의존성 0 의 공통 컴포넌트 + Zustand store. 어떤 뷰에도 영향 없음. typecheck/build 통과만 보장.

Plan 파일의 **"PR 2 — Store + 공통 컴포넌트"** 섹션을 따라 진행:

- Task 2.1: `useCompositingDashboardStore.ts` 신설
- Task 2.2: `useDataStore` 에 `compositingStates: Map` 확장
- Task 2.3: `transientHighlightStore.ts` 신설 (단계 변경 색 펄스용)
- Task 2.4: 공통 컴포넌트 (StatusChip / StatusDot / PartBadge)
- Task 2.5: 검증 (typecheck + build:vite) + commit + PR

각 task 의 step 별 체크박스를 plan 파일에서 진행하면서 채워나갈 것.

## 가이드라인 (한솔 룰)

- **CLAUDE.md**: 빌드 검증 필수 (`npm run typecheck` + 관련 테스트 + `npm run build:vite`). 한글 커밋. Supabase 단일 경로 (이번 청크엔 직접 영향 없음).
- **메모리 룰** (반드시 준수):
  - `feedback_pr_merge_gate.md` — PR 생성까지만 자동, **머지는 한솔님 명시 시에만**
  - `feedback_deploy_gate.md` — G드라이브 동기화는 한솔님 명시 시에만
  - `feedback_slack_announce.md` — 슬랙 공지는 한솔님 명시 시에만
  - `feedback_progress_reporting.md` — 긴 작업은 청크별 진척 보고
- **PR 본문 톤**: PR-creator 스킬 활용. 비개발자 톤 요약 + 개발자 톤 상세 분리.

## 참고 문서

- **Spec**: [`docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md`](../../docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md)
- **Plan**: [`docs/superpowers/plans/2026-05-21-compositing-dashboard.md`](../../docs/superpowers/plans/2026-05-21-compositing-dashboard.md)
- **핸드오프 (참조용)**: `docs/mockups/compositing-dashboard/` (PR 1 에서 복사됨)

## 진행 단계

1. **Skill 활용 우선순위**:
   - `superpowers:executing-plans` (또는 `subagent-driven-development`) — 이 plan 실행
   - `superpowers:verification-before-completion` — 빌드/테스트 통과 확인
   - `pr-creator` — PR 생성
   - `codex-review-loop` — 코덱스 리뷰 트리거 + 반영

2. plan 파일의 PR 2 task 들 순서대로 진행. 매 task 끝마다 plan 의 체크박스 `[x]` 로 갱신 (Edit tool).

3. 청크 끝나면:
   - `npm run typecheck` 통과
   - `npm run build:vite` 통과
   - commit (한글) → push → PR 생성
   - 코덱스 리뷰 트리거 + P1/P2 이슈 반영 + 재트리거
   - PR URL 한솔님께 보고 + 머지 대기

4. 머지 완료 후 한솔님이 `/session-3-start` 입력하면 세션 3 진입.

## 끝 게이트

PR 2 머지 완료 + plan 의 PR 2 전체 체크박스 `[x]` 표시 commit + 한솔님 다음 세션 신호 대기.
