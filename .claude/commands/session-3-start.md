---
description: 컴포지팅 대시보드 PR 3 시작 — 메인 뷰 + 사이드바 라우팅
---

# 세션 3 시작 — 컴포지팅 대시보드 PR 3 (메인 뷰 + 사이드바 라우팅)

## 상황

PR 1 (기반) + PR 2 (Store + 공통 컴포넌트) 머지 완료. 이제 **PR 3 — 사용자가 실제로 보는 화면** 차례. 가장 큰 PR.

## 진행 전 체크

1. **PR 1, 2 머지 확인**:
   - `git log --oneline main -5` 로 두 커밋 머지 확인
   - plan 파일의 PR 1, PR 2 섹션 모두 `[x]` 인지

2. **main 최신화**

3. **준비 컨텍스트 빠르게 점검**:
   - PR 1 에서 만든 토큰 `--status-*`, `--part-*`, `--motion-*` 가 `src/index.css` 에 있는지
   - PR 1 에서 만든 타입 `CompositingState`, `CompositingStatus` 가 `src/types/index.ts` 에 있는지
   - PR 2 에서 만든 `useCompositingDashboardStore`, `StatusChip`, `StatusDot`, `PartBadge` 가 있는지
   - `compositing_states` 테이블이 Supabase 에 있는지 (`mcp__67cc__list_tables` 로 확인)

## 이번 세션의 목표 (PR 3)

> **목표:** 사이드바 "컴포지팅" 클릭하면 실제 화면 뜨고 동작. Realtime + Presence + Broadcast 통합. 가장 큰 PR — 작업량 크므로 task 단위로 commit 분할 권장.

Plan 파일의 **"PR 3 — 메인 뷰 + 사이드바 라우팅"** 섹션을 따라 진행:

- Task 3.1: 사이드바 라우팅 변경 (compositing-revisions ViewMode + NAV_ITEMS 분리 + localStorage 마이그레이션)
- Task 3.2: DashHeader (EP 칩 토글 + 담당 컴포지터 칩 + 보는 사람 칩)
- Task 3.3: GuideStrip + StatusLegend
- Task 3.4: Timeline 패널 (LayerPanel, TimeRuler, CompletedBar, WorkingBar, CurrentPositionLine)
- Task 3.5: 파트 카드 그리드 (PartCardRow + PartHeader + SceneCard)
- Task 3.6: 상세 모달 (CompositingSceneModal)
- Task 3.7: 데이터 동기화 (낙관적 + Realtime + Presence + Broadcast)
- Task 3.8: preferences (lastCompositingEpisode) 저장
- Task 3.9: 검증 + 시각 점검 + commit + PR

## 가이드라인 (한솔 룰)

- **CLAUDE.md**: 
  - 빌드 검증 필수
  - 한글 커밋
  - **낙관적 업데이트 패턴**: 단계 토글 = UI 즉시 반영 → Supabase sync → 실패 시 롤백
  - **Supabase 단일 경로**: 새 기능은 `supabaseService` 경유로만 (Sheets 분기 추가 X)
  - **IPC 구조 유지**: 렌더러에서 직접 Supabase 호출 금지
- **메모리 룰**:
  - PR 머지 게이트 / G드라이브 게이트 / 슬랙 게이트
  - 비개발자 톤 (update-notes 는 PR 4 에서 작성)
  - **부서 UI 분리 자제** (`feedback_no_dept_split_in_ui.md`) — BG/ACT 가 카드에 두 담당자로 표시되지만 "부서 분리" UI 는 X. 한 카드 = 한 씬 단위
  - **메모 italic 금지** (`feedback_memo_italic.md`)
- **모션**: 한솔이 풀 강도 선택. 단 "촌스럽지 않게끔". glow 채도/blur 강도/stagger 타이밍 미세 조정 필요. 프리뷰 단계에서 한솔 확인.

## 권한 분기 핵심

- `useAuthStore().currentUser.isCompositor === true` → 단계 변경 가능
- `false` → 카드 클릭/모달 오픈은 OK, 단계 변경 그리드는 disabled (opacity 0.4 + tooltip)
- Supabase RLS 가 백엔드 보안 — UI 분기는 UX 용

## Realtime / Presence 핵심

- `compositing_states` 테이블 Realtime 구독 — 단계 변경 자동 전파
- `compositing-presence:{epNum}` 채널 — 같은 EP 보는 사람 presence + broadcast event 'status-change'
- 본인이 아닌 사용자 변경 수신 시:
  - `transientHighlightStore.add(sceneKey, by)` → 카드 1.2초 색 펄스 + 우상단 보낸 사람 아바타 2.5초

## 참고 문서

- **Spec**: [`docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md`](../../docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md) — 특히 섹션 5~11
- **Plan**: [`docs/superpowers/plans/2026-05-21-compositing-dashboard.md`](../../docs/superpowers/plans/2026-05-21-compositing-dashboard.md)
- **핸드오프**: `docs/mockups/compositing-dashboard/` — `variant-a.jsx` (Timeline 시안), `shared.jsx` (공통 패턴), `tokens.css` (토큰), `mock-data.js` (데이터 모델)

## 진행 단계

1. Skill 활용: `superpowers:executing-plans` + `superpowers:subagent-driven-development` (여러 컴포넌트 병렬 작업 가능)
2. Task 단위로 commit 분할 권장 (Task 3.1 commit, Task 3.2 commit ...) — 한 PR 안에 여러 커밋 OK
3. 청크 끝나면 typecheck + build:vite + 시각 점검 (라이트/다크 모드)
4. 두 창 열고 단계 변경 → Realtime sync 확인
5. PR 생성 (pr-creator) + 코덱스 리뷰 (codex-review-loop) + 한솔 머지 게이트

## 끝 게이트

PR 3 머지 완료 + plan PR 3 체크박스 `[x]` 표시 commit. 한솔님이 `/session-4-start` 입력하면 세션 4 진입.
