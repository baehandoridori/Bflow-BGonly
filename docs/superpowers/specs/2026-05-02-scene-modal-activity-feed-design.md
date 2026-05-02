# 씬 상세 모달 — 활동 피드 + 구조 정리 디자인

> **작성**: 2026-05-02 / Claude × 한솔
> **컨텍스트**: SCENE-MODAL-A 적용 후 1주 — 한솔 피드백 (실시간 반영 X, 활동 압도, 누락) 해결
> **연관**: [v1.16.0 PR #57](https://github.com/.../pull/57) 후속

## 1. 문제

| # | 증상 | 원인 |
|---|---|---|
| 1 | 모달 열린 상태에서 다른 PC 변경이 실시간 반영 안 됨 | `subscribeToActivityRealtime` 이 `RecentActivityWidget` 안에서만 시작 → 위젯이 안 떠 있으면 cache 갱신 0 |
| 2 | 단계 토글이 누적되면 댓글이 묻힘 | 댓글창 인라인에 모든 audit 표시 → 단계 토글 빈도 높아 시그널 압도 |
| 3 | 씬 생성 등 일부 audit 가 안 보임 | `scene_add` audit 가 `sceneId: null` 로 기록됨 → `sceneIds` 필터에서 제외 |
| 4 | 같은 IPC 두 번 호출 (낭비) | `useSceneActivities` 가 모달 + `SceneHistoryTab` 둘 다에서 호출 |

## 2. 결정 사항

### 2-1. 댓글창 인라인 정책 (B 옵션)

댓글창에는 **댓글 + 큰 이벤트만** 시간순 머지:

| 표시 | 액션 | source |
|---|---|---|
| ✅ | 메모 변경 | `memo_update` |
| ✅ | 스토리보드/가이드 업로드 | `image_upload_storyboard / _guide` |
| ✅ | 씬 생성 | `scene_add` |
| ✅ | 단계 전부 완료 | `Scene.completedAt + completedBy` (derive — activity_log 별도 actionType 없음) |
| ✅ | 리비전 등록 / 해결 | `revision_add / revision_resolve` |
| ❌ | 단계 개별 토글 | `stage_lo/done/review/png` (히스토리 탭 전용) |
| ❌ | 담당자 / 레이아웃 변경 | (히스토리 탭 전용) |

**근거**: 댓글창 = 협업 대화 공간. 단계 토글은 스튜디오 활동 대부분(추정 ~70%)을 차지해 댓글을 시각적으로 압도. 큰 이벤트만 인라인 → 사용자가 협업 흐름을 한눈에.

### 2-2. 히스토리 탭 — 5분 그룹화 + 펼침

같은 user + 같은 부서 + 5분 내 단계 토글들을 **1줄로 collapse**:

> **이혜민 BG · LO · 완료 · 취소된 검수 변경** (14:30 ~ 14:38)

- 노드 아이콘: `Layers` (lucide) — 단일 토글의 `Check`/`Square` 와 구별
- 클릭 시 아래로 펼침 → 각 토글 개별 (시각/상태) 표시
- 메모/이미지/리비전 등 다른 audit 는 그룹화 X (개별 줄)

**근거**: 정확한 audit 정보는 보존하면서 시각적 압도 완화. 펼침으로 정밀 audit 가능.

### 2-3. Realtime 글로벌화

`App.tsx` 에서 useEffect 로 `subscribeToActivityRealtime` 항상 활성화 + `loadInitial` 호출.

```ts
// App.tsx 안 (entry-level)
useEffect(() => {
  useActivityStore.getState().loadInitial();
  const unsub = subscribeToActivityRealtime((row) => {
    useActivityStore.getState().receiveRealtime(row);
  });
  return unsub;
}, []);
```

`RecentActivityWidget` 의 자체 구독 로직은 idempotent 처리 (이미 글로벌이 시작했으면 no-op) — 또는 제거.

**근거**: activity_log 는 글로벌 데이터 (앱 전역 audit). 위젯 lifecycle 에 묶일 이유 없음.

### 2-4. 중복 fetch 제거

`useSceneActivities` 호출은 **모달에서 1회만**. SceneHistoryTab 은 `activities: Activity[]` props 로 받기.

```tsx
// UnifiedSceneDetailModal
const sceneActivities = useSceneActivities([bgScene?.id, actScene?.id], 200);

// SceneHistoryTab
<SceneHistoryTab activities={sceneActivities} />
```

**근거**: 같은 sceneIds 로 같은 IPC 두 번 호출하는 낭비. 모달이 owner 가 되어 단일 source.

### 2-5. scene_add 매핑 fix

`electron/main.ts:1022` 단일 씬 생성 케이스에서 `sceneId: null` → `sceneId: <createdUuid>` 채움. bulk 추가는 그대로 null (여러 씬 → 1 audit 의도).

```ts
// before
{ actionType: 'scene_add', sceneId: null, detail: { sceneId } }
// after
{ actionType: 'scene_add', sceneId: createdUuid, detail: { sceneId } }
```

기존 audit 데이터는 마이그레이션 X — 신규 생성부터 sceneId 채워짐. 옛 활동은 못 가져오지만 1년 내 cleanup 되니 결국 자정.

### 2-6. 새 활동 슬라이드 인

AnimatePresence + initial(`y: -8, opacity: 0`) → animate(`y: 0, opacity: 1`). 댓글창 + 히스토리 탭 둘 다.

**근거**: Realtime 으로 들어온 새 항목이 갑자기 나타나면 어색. 부드러운 슬라이드로 자연스러운 인지.

### 2-7. 시간 표시

`formatStamp` 그대로 (절대 시간). 같은 날 = `14:32` / 올해 = `05.02 14:32` / 다른 해 = `2026.05.02 14:32`.

**근거**: audit 는 정확한 시각이 의미 있음. 채팅 같은 캐주얼 시간 표시는 audit 컨텍스트와 안 맞음.

### 2-8. 멘션 강조

`@나` 멘션된 댓글/활동에만 `accent` 색 좌측 스트라이프 (4px) 추가. 다른 강조 없음.

**근거**: 한솔 사용 패턴 — 멘션 받으면 즉시 인지 필요. 그 외 (내 담당 씬, 내가 한 일) 강조하면 도배.

### 2-9. 부서 색

모달 내부 시각 요소: mockup 색 (BG `#8B7BF7`, ACT `#FF7A8A`) **유지**.
글로벌 `DEPARTMENT_CONFIGS`: 기존 (BG `#6C5CE7`, ACT `#E17055`) **유지**.

**근거**: 모달은 mockup의 시그니처 분위기 (보라+코랄 글로우). 글로벌 부서 색 변경은 다른 화면(요약, 차트, 카드) 다 영향 → 검증 부담 ↑. 모달은 격리된 컨텍스트라 OK.

### 2-10. preview/ 폴더 정리

`src/components/scenes/preview/` 통째 삭제. `main.tsx` 의 `?preview=scene-modal-a` 라우팅도 제거. 본격 적용 끝났으니 미리보기 코드 불필요.

## 3. 보류 (다음 단계)

### 3-1. God component 분리 (UnifiedSceneDetailModal 1179줄)

별도 작업. 분리 후보:
- `useSceneModalData` hook (활동/댓글/리비전 fetch + 메모이제이션)
- `SceneModalChrome` (글로우/헤더/박스/그림자)
- `SceneModalTabs` (탭 시스템)
- `useSceneImageUpload` hook (paste/drop)

**예상 작업량**: 3~4시간. 회귀 위험 있어 별도 PR 권장.

### 3-2. 컴포넌트 명명 일관성

`Scene*Tab` (Files/History) vs `*Panel` (Comment/Revision) 통일. 큰 변경 X, 다른 작업 사이에 자연스럽게.

## 4. 데이터 모델 / 타입 변경

### Activity (기존 그대로 사용 — 추가 없음)
```ts
type ActionType = 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'memo_update' | 'comment_add' | 'revision_add' | 'revision_resolve'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide';
```

### IPC `activity:list` (기존)
```ts
opts: { before?, limit?, groups?, department?, sceneIds? }
```

### 새 helper
- `groupStageToggles(activities, windowMs)` — 5분 그룹화 (히스토리 탭)
- `filterCommentInlineEvents(activities, sceneScene completion)` — 댓글창 큰 이벤트 필터

## 5. 작업 순서

1. **Realtime 글로벌화** (App.tsx + RecentActivityWidget 정리) — 회귀 작아야 OK
2. **scene_add sceneId 채우기** (electron/main.ts)
3. **모달이 활동 단일 fetch + props 전달** (SceneHistoryTab refactor)
4. **CommentPanel 인라인 = 큰 이벤트만** (`describeActivity` 활용 + filter)
5. **히스토리 탭 5분 그룹화 + 펼침**
6. **새 활동 슬라이드 인** (AnimatePresence)
7. **멘션 강조 스트라이프**
8. **preview/ 폴더 삭제 + main.tsx 정리**
9. **tsc + vite build 검증**
10. **dev 동작 확인 (HTTP transform sanity)**

## 6. 위험 요소

- **Realtime 중복 구독**: 글로벌 + 위젯 둘 다 시작 시 같은 활동 두 번 처리. → 위젯 자체 구독 제거 또는 idempotent 처리.
- **Activity cache 부족**: 옛날 씬은 cache + IPC 200개로도 부족 가능. → 사용자 신고 받으면 페이지네이션 추가.
- **scene_add 마이그레이션**: 기존 sceneId null 인 audit 는 그대로 누락. → 1년 cleanup 으로 자정. 명시적 마이그레이션 안 함.

## 7. 성공 기준

- 다른 PC 에서 단계 토글 → 모달 안에서 ~100ms 내 새 활동 표시
- 댓글창에 단계 토글로 도배되지 않음 (스튜디오 1주 운영 후 확인)
- 옛날 씬도 cache 부족하지 않으면 audit 다 보임
- 같은 sceneIds 로 IPC 1회 호출 (network 탭 검증)
- god component 미해결이지만 다음 단계 plan 명시
