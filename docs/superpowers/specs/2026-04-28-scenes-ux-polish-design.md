# 씬 뷰 UX 폴리싱 + SEED_USER 보안 hotfix — 디자인 문서

**작성일**: 2026-04-28
**대상 브랜치**: `feat/scenes-view-ux-polish`
**대상 버전**: v1.15.0
**작성자**: 한솔 × Claude

---

## 배경

한솔이 일상 사용 중 부딪히는 씬 뷰 UX 마찰 8가지를 한 묶음으로 해결한다. 추가로 *9번(미리보기 모드) 작업 중 발견한 SEED_USER 실 password 노출 보안 이슈* 도 함께 hotfix 한다 (별도 PR 분리 비효율 — 같은 v1.15.0 에 묶음).

---

## 결정사항 요약 (1차 브레인스토밍 결과)

| 묶음 | 항목 | 한솔 결정 |
|---|---|---|
| 🅐 | (1+6) 시트 뷰 셀에 `L#레이아웃번호` 가 안 보임 | 셀 자체에 표시되어야 — *현재 코드는 layoutId 있으면 표시인데 데이터/조건 추가 분석 필요* |
| 🅑 | (2+3+4) 마지막 본 *뷰 모드 / 에피소드 / 트리 펼침* 상태 기억 | localStorage 로 사용자별 저장 + 씬 뷰 재진입 시 복원 |
| 🅒 | (5) 시트 뷰 씬 번호 호버 시 더블클릭 어포던스 | **↗ 화살표 아이콘 등장 + 색 강조** |
| 🅓 | (7) 상단바 *옵션 접기* 동작 | **완전 숨김** — 요약 칩 라인까지 사라짐. 펼치기는 그대로 |
| 🅔 | (8) 댓글 알림 토스트 + 확인 버튼 | **멘션된 댓글 + 담당 씬 댓글 둘 다** 토스트. 클릭 시 씬 모달 |
| 🅕 | SEED_USER 실 password 코드 평문 노출 | hotfix — `password=''` + `isInitialPassword=true`. 코드에서 password 제거 |

---

## 섹션 1: 🅐 시트 뷰 레이아웃 표시 (3가지 변경)

한솔의 추가 명확화로 단순 스타일 강화가 아니라 **세 가지 변경**으로 정리:

### 1-A. 시트 뷰 셀에 `L#레이아웃` 항상 표시

**현재**: 시트 뷰는 `sceneGroupMode === 'layout'` (레이아웃별 보기) 일 때만 layoutId 가 그룹 헤더로 노출. *일반 모드(예: episode/part)에서는 시트 뷰 셀 어디에도 layoutId 가 안 보임*. (카드 뷰는 셀 안에 흐리게라도 표시됨 — `ScenesView.tsx:757-761`)

**결정**: 시트 뷰의 *각 행* 에도 layoutId 를 작은 컬럼/뱃지로 항상 표시. sceneGroupMode 와 무관.

**구현 위치**: `src/components/scenes/UnifiedSceneSheetView.tsx` (시트 행 셀 부근, 596 라인 근방)

### 1-B. 레이아웃별 보기 모드의 시트 뷰 = 카드 뷰처럼 섹션 그룹핑

**현재**: `sceneGroupMode === 'layout'` 시 시트 뷰의 그룹핑 처리 분석이 필요 — 카드 뷰는 레이아웃 헤더 + 그 아래 카드들이 *섹션* 으로 명확히 구분되는데, 시트 뷰는 그렇지 않음 (행 사이 구분만 있을 가능성)

**결정**: 시트 뷰의 레이아웃 모드를 *카드 뷰와 동일한 섹션 헤더 + 섹션별 영역 구분* 스타일로 정렬. 헤더에 `L#XX (n개 씬)` 표기, 섹션 사이 visible separator.

**구현 위치**: `src/components/scenes/UnifiedSceneSheetView.tsx` 의 layout 그룹핑 렌더 분기 (라인 285~296 의 "레이아웃 그루핑" 주석 근방)

### 1-C. 레이아웃 글자 자체 스타일 강화

`L#{layoutId}` 라벨이 현재 `text-text-secondary/50 italic 11px` 라 너무 흐림.

**결정**: `text-accent-sub italic 12px font-medium` 정도로 가시성 강화. 카드 뷰(ScenesView 757-761) 와 시트 뷰 모두 동일 적용해 일관성 유지.

### 구현 위치 종합

- `src/views/ScenesView.tsx:757-761` (카드 뷰 셀 — 1-C 스타일)
- `src/components/scenes/UnifiedSceneSheetView.tsx` 다음 부분:
  - 시트 행 셀에 layoutId 표시 추가 (1-A)
  - layout 그룹핑 분기 카드 스타일 정렬 (1-B)
  - layoutId 라벨 스타일 (1-C)

---

## 섹션 2: 🅑 마지막 상태 기억 (뷰 모드 / 에피소드 / 트리)

### 목표

씬 뷰를 떠나도 다음 진입 시 *마지막으로 보던 상태* 가 그대로 복원.

### 저장 항목 + key

| key | 값 |
|---|---|
| `bflow_scenes_view_mode` | `'card'` 또는 `'sheet'` |
| `bflow_scenes_last_episode` | 에피소드 번호 (number) |
| `bflow_scenes_tree_open` | `true` 또는 `false` |

브라우저 localStorage 단일 사용자 환경 — 모든 키 사용자별 분리 불필요 (앱이 단일 PC 에서 실행). 만료 없음 (변경 시 즉시 갱신).

### 구현 위치

신규 유틸: `src/utils/scenesViewPersist.ts`

```ts
const KEYS = {
  viewMode: 'bflow_scenes_view_mode',
  lastEpisode: 'bflow_scenes_last_episode',
  treeOpen: 'bflow_scenes_tree_open',
} as const;

export function loadPersistedSceneViewMode(): 'card' | 'sheet' | null { /* ... */ }
export function savePersistedSceneViewMode(mode: 'card' | 'sheet'): void { /* ... */ }
// 동일 패턴 lastEpisode / treeOpen
```

### 통합 위치

- `src/views/ScenesView.tsx`:
  - `sceneViewMode` 초기값을 `loadPersistedSceneViewMode() ?? 'card'` 로
  - `setSceneViewMode` 시 즉시 `savePersistedSceneViewMode()` 호출
  - 동일하게 `selectedEpisode` (useAppStore), `treeOpen` (local state)
- `useAppStore.dashboardDeptFilter` 패턴과 동일 (이미 영속화 패턴 존재 — `src/stores/useAppStore.ts` 참고하면 ZUSTAND PERSIST middleware 가 있는지 확인 필요)

### Edge case

- **에피소드가 삭제됨**: 마지막 본 에피소드 번호가 현재 episodes 목록에 없으면 → 첫 에피소드로 fallback
- **localStorage 비활성** (사용자 개인정보보호 모드): try/catch 로 무시 + 디폴트 동작

---

## 섹션 3: 🅒 시트 뷰 씬 번호 호버 어포던스

### 결정

호버 시 *씬 번호 글자 옆에 ↗ 화살표 아이콘이 부드럽게 등장* + *글자 색이 액센트로 변경*.

### 구현 위치

`src/views/ScenesView.tsx:750-762` 근방 (씬 번호 셀)

```tsx
<div className="flex items-center gap-2 min-w-0 group cursor-pointer">
  <span className="text-sm font-mono text-text-secondary/50 group-hover:text-accent transition-colors">
    #{...}
  </span>
  <span className="text-[15px] font-mono font-bold text-text-primary truncate group-hover:text-accent-sub transition-colors">
    <HighlightText ... />
  </span>
  <ArrowUpRight
    size={12}
    className="text-accent opacity-0 group-hover:opacity-100 transition-opacity"
  />
  {scene.layoutId && (
    <span className="...">L#{scene.layoutId}</span>
  )}
</div>
```

`group` + `group-hover:` Tailwind 패턴으로 셀 호버 시 자식 동시 변화. `ArrowUpRight` (lucide-react) 아이콘 사용.

### 동일 적용 위치

- `UnifiedSceneSheetView.tsx` 의 씬 번호 셀

---

## 섹션 4: 🅓 상단바 옵션 접기 = 완전 숨김

### 현재 상태

`src/views/ScenesView.tsx:3245-3262`:
- 접힌 상태에서 *"현재 옵션 [chip] [chip] ..."* 요약 라인 표시
- chip 들은 클릭 비활성

### 결정

접힌 상태에서 **요약 라인 자체를 렌더하지 않음** — `AnimatePresence` 의 `sceneControlsCollapsed === true` 분기를 빈 요소(또는 0높이 placeholder) 로 변경.

### 구현 위치

`src/views/ScenesView.tsx:3247-3262` (`sceneControlsCollapsed ? (...요약 라인...) : (...풀 옵션...)`)

수정 후:
```tsx
{sceneControlsCollapsed ? null : (
  <motion.div ...>
    {/* 풀 옵션 */}
  </motion.div>
)}
```

또는 AnimatePresence 가 한쪽 자식 null 을 처리하므로 단순 조건부 렌더로 변경.

---

## 섹션 5: 🅔 댓글 토스트 (멘션 + 담당 씬)

### 현재 상태 (코드 분석)

`src/utils/notificationHelper.ts:46-60` 의 `dispatchNotification()` 함수가 *이미* sonner 토스트 + "씬 보기" 액션 버튼 + 클릭 시 씬 뷰로 이동을 구현. 즉 인프라는 이미 있음.

### 한솔 의도 추정

한솔이 "토스트 알림 추가"라 한 건 다음 중 하나:
- (가설 A) 토스트가 이미 뜨는데 *눈에 잘 안 띄어서* 인지 안 됨 → 디자인 강화
- (가설 B) 트리거 흐름이 누락되어 *멘션/담당 씬 댓글 도착 시 dispatchNotification 호출이 안 됨* → 트리거 추가
- (가설 C) "확인" 버튼이 라벨이 "씬 보기" 라 직관적이지 않음 → 라벨 변경

### 결정

한솔이 "둘 다 해주세요" — 세 가지 모두 처리:

#### 5-1. 트리거 흐름 보강 (가설 B 가 가장 가능성 높음)

- 댓글 Realtime 수신 시 (`src/services/commentService.ts` 또는 useAppStore 의 댓글 트리거) → 다음 조건 확인:
  - 댓글에 `@한솔` 같은 멘션 포함 (사용자 이름 정확 매치)
  - 또는 댓글 대상 씬의 `assignee === currentUser.name`
- 둘 중 하나면 `dispatchNotification(...)` 호출

구현 위치: `src/services/commentService.ts` 또는 `src/stores/useDataStore.ts` (Realtime 댓글 처리 부분)

#### 5-2. 토스트 라벨 직관화

`dispatchNotification()` 의 action.label `'씬 보기'` → `'확인'` 로 변경. 동작은 동일 (클릭 시 씬 모달 포커스).

#### 5-3. 토스트 시각 강화 (선택)

sonner 의 `duration` 옵션을 늘리거나 (`{ duration: 8000 }`) 색상 액센트 강화. 현재 디폴트 4000ms 인지 확인 후.

### Edge case

- **본인이 작성한 댓글에 본인 이름 멘션** (자체 멘션): 토스트 안 띄움 (자기 댓글에 알림 무의미)
- **여러 멘션이 한꺼번에 도착**: sonner 가 자체 stack 처리. 별도 처리 불필요

---

## 섹션 6: 🅕 SEED_USER 보안 hotfix

### 문제

`src/services/userService.ts:25-33` 의 `SEED_USER` 상수에 한솔의 실 Supabase admin password (`'1q2w3e4r!A'`) 가 *하드코딩*되어 v1.14.x 빌드된 `.exe` 의 main entry chunk 에 평문으로 노출.

### 결정

```ts
const SEED_USER: AppUser = {
  id: '00000000-0000-0000-0000-000000000001',
  name: '배한솔',
  slackId: 'U05DFV9UAN5',
  password: '',                  // ← 빈값으로 변경
  isInitialPassword: true,       // ← true 로 변경 (변경 강제)
  createdAt: '2025-01-01T00:00:00.000Z',
  role: 'admin',
};
```

### 운영 영향

- 평상시 (Supabase 사용자 row 살아있는 상태) 에는 SEED_USER fallback 자체가 호출 안 됨 → 영향 없음
- 빈 사용자 목록에서 시드되더라도 빈 password 로는 로그인 매칭 불가 → 한솔이 Supabase Studio 에서 password 직접 설정 후 로그인

### 한솔에게 안내 필수

PR 본문에 다음 *반드시* 포함:
> ⚠️ 현재 G드라이브에 배포된 v1.14.1 `.exe` 의 main entry chunk 에 한솔님 admin 의 옛 password 가 평문 노출 중. **즉시 Supabase 에서 새 강한 password 로 변경해주세요** (이미 변경하셨다면 무시).

### 검증

production 빌드 후 `grep -c "1q2w3e4r!A" dist/assets/index-*.js` → **0** 매치 확인.

---

## 비범위 (Out of Scope)

- 9번 (미리보기 모드) — 별도 PR (#42) 폐기 결정에 따라 본 작업에서 제외
- mock 사용자(11명, '배한솔' 외) password 변경 — 별도 후속 작업
- 다른 뷰 (에피소드, 인원별 등) 의 마지막 상태 기억 — 본 작업은 *씬 뷰 한정*

---

## 다음 단계

1. 이 spec 에 대한 한솔 검토
2. 필요 시 1+6번 / 8번 가설 확인 (한솔 화면 캡처 또는 dev server 로 직접 검증)
3. **구현 계획** 작성 (`writing-plans` 스킬) → 단계별 task 분해 — 또는 spec 검토 후 한솔 동의하에 *plan 단계 생략하고 바로 구현*
4. 구현 → 빌드 → PR (v1.15.0)
