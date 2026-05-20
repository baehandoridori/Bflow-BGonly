# Claude Code 프롬프트 — B flow 컴포지팅 대시보드 구현

> 본 폴더의 디자인을 B flow Electron 앱(C:\\Bflow-BGonly)에 구현할 때 사용할 프롬프트 모음.
> Claude Code 세션을 새로 열고 아래 프롬프트들을 순서대로 사용하세요.

---

## 🔑 첫 메시지 (세션 초기 컨텍스트)

```
B flow 앱(C:\Bflow-BGonly, Electron + React 18 + TS + Tailwind + Zustand)에 새로운 "컴포지팅 현황 대시보드" 뷰를 구현해 줘.

먼저 디자인 핸드오프 폴더를 읽어:
- design_handoff_compositing_dashboard/README.md (구현 명세 전체)
- design_handoff_compositing_dashboard/index.html, variant-a.jsx, variant-b.jsx, variant-c.jsx, shared.jsx (디자인 레퍼런스 — 그대로 옮기지 말고 패턴/룩만 참고)
- design_handoff_compositing_dashboard/tokens.css, mock-data.js (토큰 / 데이터 모델 참고)

그리고 코드베이스 컨텍스트도 파악해:
- CLAUDE.md, ROADMAP.md, CONTEXT.md
- src/views/CompositingView.tsx (기존 컴포지팅 뷰 — 새 뷰는 이것과 별개)
- src/components/scenes/UnifiedSceneCard.tsx (카드 패턴 참고)
- src/themes.ts, src/index.css (토큰 시스템)
- src/stores/useDataStore.ts, useAuthStore.ts
- src/types/index.ts (Episode/Part/Scene 타입)
- src/components/layout/Sidebar.tsx (네비게이션 진입점)

읽고 나서 README 의 "Implementation Plan" 10 단계 중 어느 것부터 시작할지 / 그 순서가 맞는지 / 누락된 게 있는지 확인해서 알려줘. 구현은 아직 시작하지 말 것.
```

---

## Phase 1 — 토큰 + 데이터 모델 + Supabase 스키마

```
README 의 "Design Tokens" 섹션과 "State Management > Supabase 스키마" 섹션을 따라:

1. src/index.css 의 :root 와 [data-color-mode="light"] 양쪽에 --status-* (6개) 와 --part-* (4개) 추가. 기존 라이트 모드 패턴 그대로.

2. tailwind.config.js 의 theme.extend.colors 에 status.* 와 part.* 그룹 추가 (rgb(var(--…) / <alpha-value>) 형식).

3. src/types/index.ts 에:
   - CompositingStatus = 'batch' | 'combine' | 'aggregated' | 'adjust' | 'error' | 'done'
   - CompositingErrorKind = '파일 미싱' | '옥에티 수정' | '리테이크 대기' | '소스 누락' | '경로 오류'
   - COMPOSITING_STATUSES 배열, COMPOSITING_STATUS_LABELS, COMPOSITING_STATUS_ICONS 맵 정의
   - Scene 인터페이스에 compositingStatus, compositingErrorKind?, compositingProgress?, compositingUpdatedAt?, compositingUpdatedBy? 추가
   - Episode 인터페이스에 compositor?: { userId, name } 추가

4. DEVLOG/migrations/ 에 새 SQL 마이그레이션 파일 추가 (README 의 ALTER TABLE 4 개). live DB 적용은 한솔 확인 후.

5. supabaseService 의 loadScenes(), realtime payload 매핑에 새 컬럼 포함.

작업 후: typecheck + build:vite 통과 확인. 변경된 파일 목록과 함께 보고.
```

---

## Phase 2 — Store + 공통 컴포넌트

```
README "State Management" 의 useCompositingDashboardStore 신규 작성.
- src/stores/useCompositingDashboardStore.ts
- viewMode, expandedParts (Set), pinnedScene, detailScene, statusFilter, soloPart, mutedParts (Set), hoveredPart, pinnedPart
- 모든 setter + togglePartExpanded, setAllExpanded, openDetail, closeDetail 액션

그리고 src/components/compositing/ 폴더 신규로:
- StatusChip.tsx (sm/md/lg + solid/soft variant. 디자인의 shared.jsx > StatusChip 참고. 단 인라인 스타일 X — Tailwind cn() 사용)
- StatusDot.tsx (withPulse 옵션)
- PartBadge.tsx (sm/md/lg)
- ViewModeToggle.tsx (Timeline / Matrix / Cinema. shared.jsx > ViewModeToggle 참고)

기존 cn() 유틸 사용, framer-motion 사용 가능. 색상은 무조건 토큰 경유.
```

---

## Phase 3 — Timeline 모드 (메인) 구현

```
새 뷰 src/views/CompositingDashboardView.tsx + 서브 컴포넌트들을 src/views/compositing-dashboard/ 폴더에 분리해서:

- DashHeader.tsx (담당 컴포지터 칩, viewer 칩, ViewModeToggle, 모두 펼치기/접기, 진입 재생 ↻)
- StatusLegend.tsx (6 칩, 필터 토글)
- timeline/TimeRuler.tsx
- timeline/RamPreviewBar.tsx
- timeline/WorkAreaBar.tsx
- timeline/CompLayerRow.tsx (파트 막대 = stacked 분포)
- timeline/LayerPanel.tsx (좌측 200px, Solo/Visibility 토글)
- timeline/CtiPlayhead.tsx
- cards/PartCardRow.tsx (LP 호버 + collapse/expand)
- cards/SceneCard.tsx (BG/ACT 두 담당자 + 가이드/실제 두 이미지 + hover lift + pin 글로우)
- modal/SceneDetailModal.tsx

LP 호버 / cascade 진입 / chevron 회전 / CTI 위치 계산은 README 의 "Interactions & Behavior" 섹션 그대로.

데이터는 useDataStore 에서 episodes 가져와서 sceneInfoMap 빌드 (기존 CompositingView.tsx 패턴 참고). 권한은 useAuthStore.currentUser vs episode.compositor.

상태 변경(SceneDetailModal 의 6 버튼)은 supabaseService.updateSceneField 호출 + 낙관적 업데이트 (기존 패턴).

Sidebar.tsx 의 compositing 항목을 새 뷰로 라우팅. 기존 CompositingView (리비전) 는 별도 라우트로 보존 — 또는 새 뷰 안에서 탭으로 통합할지 한솔에게 확인.
```

---

## Phase 4 — Matrix + Cinema 모드

```
README 의 "3. Matrix 모드", "4. Cinema 모드" 섹션 따라 추가:
- src/views/compositing-dashboard/matrix/MatrixBoard.tsx (헤더 행 + 파트 행 × 4. 셀 안에 MatrixCard.tsx)
- src/views/compositing-dashboard/cinema/CinemaRoom.tsx (CinemaBackdrop, PartTracks, ConstellationCard, CinemaPreview, Donut)

Timeline 의 SceneCard / SceneDetailModal 은 그대로 재사용. 상태/필터/권한은 같은 store.

viewMode 값에 따라 CompositingDashboardView 가 위 셋 중 하나만 렌더.
```

---

## Phase 5 — 마무리

```
- 진입 cascade keyframes / glow-pulse / wipe-in 을 src/index.css 의 @layer components 에 추가
- prefers-reduced-motion 처리
- 라이트 모드에서 RAM 바 점선 / Work Area 보더 대비 확인
- 사이드바 아이콘 (clapperboard) 와 컴포지팅 뷰 진입 시 알림 없는지 확인
- DEVLOG/update-notes.json 에 사용자 친화적 톤으로 한 줄 (CLAUDE.md 의 작성 룰 따름)
- README 의 "알려진 제약 / 의사결정 사항" 섹션 한솔에게 다시 한 번 확인 후 결정
```

---

## ⚠️ 주의 사항

- **색 하드코딩 절대 금지**. 디자인 파일의 모든 인라인 `rgb(var(--…))` 는 시연용 — 실 코드는 Tailwind 유틸 (`bg-status-done`, `text-part-a` 등) 또는 `<style>` 의 클래스로 토큰화.
- **본 핸드오프의 HTML/JSX 는 절대 그대로 복붙 X**. 패턴/룩만 참고하고, B flow 의 기존 코딩 컨벤션 (`UnifiedSceneCard.tsx`, `RevisionPanel.tsx` 등) 에 맞춰 재작성.
- **기존 `STAGE_COLORS` / `SCENE_PHASE_COLORS` 와 혼동 금지**. 본 새 워크플로는 그 둘과 의미가 다르고 별도 `--status-*` 토큰을 사용한다.
- `CLAUDE.md` 의 필수 규칙 6 개 모두 준수 (낙관적 업데이트 / Supabase 단일 경로 / IPC 구조 / 빌드 검증 / 한국어 커밋 / 자동 업데이트 manifest 룰).
