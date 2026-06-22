# 리테이크 허브 5단계 — 감독 세트 허브 (구현 계획)

> spec: `docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md` (§9 감독 리테이크 허브)
> 전제: 1~4단계(담당자 워크플로우·인라인카드·엔티티감지) 배포 완료. DB 마이그레이션 `2026-06-17-retake-hub.sql` **라이브 적용 확인됨**(comp_revision_sets 테이블·set_id/assignee_states/final_* 컬럼·realtime publication 존재). `CompRevisionSet` 타입·`set_id` 매핑(mapRevision/updateRevision)도 이미 있음.
> 작업 브랜치: `claude/retake-hub-step5` (off main v1.43.2). 배포 버전: **v1.44.0**.

## 목표
감독/취합자용 **리테이크 세트 허브** — 세트(제목+에피소드+취합자+하위 항목)를 만들고, 자동취합 탭(파트/담당자/진행상태/씬순)으로 보고, 항목을 추가/가져오기하고, 진행률·자동완료를 추적. 하위 항목은 `comp_revisions`(set_id 세팅) 그 자체이며 담당자 워크플로우·하위 UI 컴포넌트를 그대로 공유.

## 핵심 결정 (스펙 기반)
- 세트 하위 항목 = `comp_revisions` 레코드(set_id). 씬 매인 항목(scene_id 있음)은 씬 상세창 리테이크 탭에도 동일 노출. '전반' 항목(scene_id NULL)은 허브에만.
- 진행률 = `resolved 수 / 전체 하위 수`. 전원 resolved → 세트 status='done' 자동전환. 빈 세트(0/0)는 자동완료 안 함. 마지막 항목 빠지면 open 복귀.
- 세트 생성·취합자 지정 = 컴포지터급(`isCompositorForCompositing`). 항목 추가 = 누구나.
- 시안 B(그리드 테이블) — 컬럼 `[색막대 | re# | 내용 | 담당 | 진행]`, 행 클릭 인라인 확장. 하위 UI 컴포넌트(`src/components/scenes/revision/*`) 재사용.
- 낙관적 업데이트 + 실패 롤백 + Realtime. preview(`?preview=1`) mock 대응 필수.

## 청크 (의존 순서)

### Chunk A — 순수 로직 (TDD)
- 신규 `src/utils/revisionSet.ts`:
  - `computeSetProgress(items: {status}[]) => { done:number; total:number; pct:number }` — done = status==='resolved' 수, total = 전체. total 0 → {0,0,0}.
  - `isSetAutoComplete(items) => boolean` — total>0 && 전원 resolved.
  - `nextSetStatus(items) => 'open'|'done'` — isSetAutoComplete ? 'done' : 'open'.
  - `groupSetItems(items, mode, ...)` — 자동취합 탭용(파트/담당자/진행상태/씬순) 그룹핑(순수). 기존 compositing/utils 의 정렬·그룹 재사용 가능하면 위임.
- 신규 `tests/revisionSet.test.ts` (node:test) — 진행률/자동완료/빈세트/그룹핑. `test:entity` 스크립트에 추가.

### Chunk B — 타입 + Electron 백엔드 (세트 풀스택)
- `src/types/index.ts`: `ElectronAPI` 에 세트 4메서드 시그니처. `RealtimeCallbacks` 류 onRevisionSetChange(있으면).
- `electron/supabase.ts`: `mapRevisionSet(row)→CompRevisionSet`, `readRevisionSets()`, `addRevisionSet(input)`, `updateRevisionSet(id, fields)`, `deleteRevisionSet(id)`. 각 변경 후 broadcast(`comp_revision_sets`). 기존 addRevision/updateRevision 패턴 모방. `updateRevisionSet` 화이트리스트 필드(title/episodeNumber/department/aggregatorId/status).
- `electron/realtime.ts`: `RealtimeCallbacks.onRevisionSetChange` 추가 + `comp_revision_sets` 채널 핸들러.
- `electron/main.ts`: IPC 핸들러 `supabase:read/add/update/delete-revision-set` + `startSupabaseRealtime` 에 `onRevisionSetChange` → `broadcastSupabaseEvent('comp_revision_sets', payload)`.
- `electron/preload.ts`: 세트 4채널 노출.

### Chunk C — Mock (preview)
- `src/mocks/devElectronAPI.ts`: 세트 mock CRUD + `getMockRevisionSetRows()` + invalidate 이벤트(`bflow:revision-sets-invalidated`). 기존 리비전 mock 패턴.

### Chunk D — Service + Store + realtime 배선
- 신규 `src/services/revisionSetService.ts`: CRUD(electronAPI 경유), `assignToSet(revisionId, setId)`/`removeFromSet(revisionId)`(가져오기/해제 — updateRevision set_id), `maybeAutoCompleteSet(setId, items)`(전원 resolved 시 updateRevisionSet status='done', 아니면 open 복귀).
- 신규 `src/stores/useRevisionSetStore.ts`: 세트 목록/선택/낙관적 CRUD. realtime invalidate 시 reload.
- `src/stores/useRevisionStore.ts`: set_id 편입/해제 낙관 패치(updateRevisionOptimistic 재사용).
- `src/App.tsx` + `WidgetPopup.tsx`: `onSupabaseRealtimeEvent` 에 `table==='comp_revision_sets'` 분기 → 세트 스토어 invalidate/reload.

### Chunk E — UI
- 신규 `src/views/RetakeHubView.tsx`: 2단 레이아웃(좌 세트목록+진행률 미니바 / 우 상세). 상세 헤더(제목·에피소드·취합자·진행률 바) + 자동취합 탭(파트/담당자/진행상태/씬순) + 시안 B 테이블 행(하위 컴포넌트 재사용) + 행 클릭 인라인 확장 + '전반' 그룹.
- 사이드바 등록: `useAppStore.ts` ViewMode 유니온 + `Sidebar.tsx` NAV_ITEMS + `App.tsx` 렌더 switch + lazy import. (부서 UI 비노출 정책 준수 — 세트 department 는 내부 필드, 사용자 노출 최소.)
- 세트 생성 모달(신규, 컴포지터급) + '기존 리테이크 가져오기' UI.
- `NewRevisionModal`/`AddRevisionForm` 확장: 씬 미지정('전반') 지원 + `setId` 부여 옵션(허브에서 호출 시).

### Chunk F — 통합 검증 + 버전
- typecheck + test:entity(+revisionSet) + test:auto-update + build:vite. 버전 1.44.0 + update-notes(비개발자 톤). 정식 build.

## 검증 (스펙 §14)
- 세트 진행률·자동완료(빈세트 0/0 예외 포함). 권한 가드(생성/취합자 = 컴포지터급). 씬 매인 항목 ↔ 씬 상세창 동등 노출. '전반' 항목 허브 전용. 낙관+롤백+Realtime. preview mock.
- node:test 순수로직 + 멀티에이전트 적대 리뷰 + 코덱스 루프.

## 무회귀/정책
- 부서(BG/ACT) UI 비노출. update-notes 비개발자 톤. 머지·배포는 한솔 명시(이번 세션 논스톱 승인됨). manifest-last.
