# 리비전 보드 리뉴얼 — 구현 계획 (v1.19.0)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컴포지팅 뷰(`CompositingView.tsx`)를 v1.18.0 신표준에 맞게 정정하고, 검색·정렬·그룹화·씬 모달 점프·썸네일 영역을 추가하며, 1366줄 단일 파일을 6개로 분할한다.

**Architecture:** 기존 좌측 보드 + 우측 슬라이드 디테일 패널 구조 유지. 그룹화 모드(씬별/에피소드별/진행률별)에 따라 본문 섹션 컴포넌트를 라우팅. 검색·정렬·필터·그룹화 상태는 메인 뷰에서 관리하고 useMemo로 파생 데이터 계산.

**Tech Stack:** TypeScript / React 18 / Tailwind / Lucide / framer-motion / Zustand. 신규 라이브러리 없음.

**Spec:** [docs/superpowers/specs/2026-05-04-revision-board-renewal-design.md](../specs/2026-05-04-revision-board-renewal-design.md)
**mockup:** [docs/mockups/revision-board-v3.html](../../mockups/revision-board-v3.html)

---

## 작업 원칙

- 각 task: 코드 → `tsc --noEmit` → 커밋
- 커밋 메시지: `[v1.19.0-step-N] 한국어 요약`
- 한솔의 시간 압박 의식 — 청크 1에서 분할만, 청크 2에서 모든 변경. 빠른 진행.
- CSS 변수 사용 (hex 하드코딩 금지). italic 금지.
- 기존 외부 import 경로(`@/views/CompositingView`) 보존 (default export 유지)

---

## 파일 구조 (After)

```
src/views/
├── CompositingView.tsx               # 메인 (조립자, ~400줄)
└── compositing/
    ├── SceneGroupSection.tsx         # 씬별 그룹 (default 모드)
    ├── EpisodeGroupSection.tsx       # 에피소드별 nested
    ├── ProgressKanbanSection.tsx     # 진행률별 칸반
    ├── RevisionDetailPanel.tsx       # 우측 슬라이드 패널
    ├── AddRevisionForm.tsx           # 등록 폼
    ├── RevisionCard.tsx              # 개별 카드 (썸네일/메타/본문/액션)
    ├── SceneJumpButton.tsx           # ↗ 씬 모달 점프 (재사용)
    └── sharedHooks.ts                # 검색/필터/정렬/그룹화 hooks
```

---

## Chunk 1: 파일 분할 (코드 변경 최소)

### Task 1: 1366줄 → 6개 파일로 분할

**목표**: 코드 변경 없이 컴포넌트만 추출. 빌드 통과 + 기존 동작 100% 유지.

**Files:**
- Create: `src/views/compositing/SceneGroupSection.tsx` (현 SceneRow + RevisionItem)
- Create: `src/views/compositing/RevisionDetailPanel.tsx` (현 DetailPanel)
- Create: `src/views/compositing/AddRevisionForm.tsx` (현 AddRevisionForm)
- Create: `src/views/compositing/RevisionCard.tsx` (현 RevisionItem 일부)
- Create: `src/views/compositing/sharedHooks.ts` (parseSceneKey, parsePathsFromText 등 유틸)
- Modify: `src/views/CompositingView.tsx` (extract만, 동작 동일)

- [ ] **Step 1: sharedHooks.ts에 유틸 추출**

`parseSceneKey`, `parsePathsFromText`, `getInitials`, `Avatar`, `AvatarStack` 등을 옮김 (이름 변경 X).

- [ ] **Step 2: RevisionDetailPanel 추출**

현 `DetailPanel` (L771-1015) → `compositing/RevisionDetailPanel.tsx`. props 인터페이스 명시.

- [ ] **Step 3: AddRevisionForm 추출**

현 `AddRevisionForm` (L408-582) → `compositing/AddRevisionForm.tsx`.

- [ ] **Step 4: SceneGroupSection 추출 + 내부 RevisionCard**

`SceneRow` (L586-726) + `RevisionItem` (L251-404) → `compositing/SceneGroupSection.tsx`. RevisionItem이 충분히 독립적이면 `RevisionCard.tsx`로 별도 추출.

- [ ] **Step 5: CompositingView 본체 정리**

추출된 컴포넌트들을 import. 메인 뷰는 헤더/필터/그룹 라우팅 + state 관리만 남김.

- [ ] **Step 6: 빌드 + 동작 확인**

```bash
npx tsc --noEmit
npm run build:vite
```

UI 동작 변경 없는지 dev에서 한 번 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/views/CompositingView.tsx src/views/compositing/
git commit -m "[v1.19.0-step-1] CompositingView 1366줄 → 6개 파일 분할 (동작 동일)"
```

---

## Chunk 2: 신표준 정정 + 신규 기능

### Task 2: v1.18.0 신표준 정정

**Files:**
- Modify: `src/views/compositing/RevisionCard.tsx` (또는 SceneGroupSection 내부)
- Modify: `src/views/compositing/RevisionDetailPanel.tsx`
- Modify: `src/views/compositing/AddRevisionForm.tsx`

- [ ] **Step 1: RevisionCard 정정**
  - `re#` 라벨 표시 (`revisionNoToLabel(rev.revisionNo)` 사용)
  - `PriorityBadge` 사용 제거
  - `StatusDots` (우선순위 도트) 제거 — SceneRow 헤더에서도 제거. 미해결 카운트 뱃지로 대체 (이미 있음)
  - 부서 칩 제거
  - `frameNo` mono 표시 제거

- [ ] **Step 2: RevisionDetailPanel 정정**
  - 우선순위 뱃지/색 메타 제거
  - 부서 메타 제거
  - 프레임번호 메타 제거
  - 상단에 `[re#]` 라벨 + "씬 상세 모달 열기" 링크

- [ ] **Step 3: AddRevisionForm 정정**
  - `priority` state + 토글 제거
  - `frameNo` state + input 제거
  - 자동값으로 처리 (이미 v1.18.0의 RevisionPanel과 동일 패턴)

- [ ] **Step 4: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/views/compositing/
git commit -m "[v1.19.0-step-2] 컴포지팅 뷰 v1.18.0 신표준 정정 — re# 적용 + 우선순위/부서/프레임 제거"
```

---

### Task 3: 검색 + 정렬 추가

**Files:**
- Modify: `src/views/CompositingView.tsx`
- Modify: `src/views/compositing/sharedHooks.ts` (필터·정렬 헬퍼)

- [ ] **Step 1: 필터 바 Row 1 마크업 추가**

검색 입력 + 정렬 드롭다운. 디자인은 mockup 참조.

- [ ] **Step 2: state 추가**

```ts
const [searchQuery, setSearchQuery] = useState('');
const [sortMode, setSortMode] = useState<'recent'|'oldest'|'sceneNo'|'comments'>('recent');
```

- [ ] **Step 3: 필터링 + 정렬 헬퍼**

`sharedHooks.ts`에:

```ts
export function filterRevisionsBySearch(revisions: CompRevision[], query: string, sceneInfoMap: Map<string, SceneInfo>): CompRevision[] {
  if (!query.trim()) return revisions;
  const q = query.toLowerCase();
  return revisions.filter(r => {
    if (r.description.toLowerCase().includes(q)) return true;
    if (r.requesterName?.toLowerCase().includes(q)) return true;
    const info = sceneInfoMap.get(r.sceneKey);
    if (info?.sceneName?.toLowerCase().includes(q)) return true;
    return false;
  });
}

export function sortRevisions(revisions: CompRevision[], mode: SortMode, commentCounts: Map<string, number>): CompRevision[] {
  const sorted = [...revisions];
  switch (mode) {
    case 'recent':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'oldest':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'sceneNo':
      return sorted.sort((a, b) => a.sceneKey.localeCompare(b.sceneKey));
    case 'comments':
      return sorted.sort((a, b) => (commentCounts.get(b.id) ?? 0) - (commentCounts.get(a.id) ?? 0));
  }
}
```

- [ ] **Step 4: useMemo 적용**

기존 `groupedScenes` 계산 위에 search → sort 단계 추가.

- [ ] **Step 5: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/views/CompositingView.tsx src/views/compositing/sharedHooks.ts
git commit -m "[v1.19.0-step-3] 검색 + 정렬 추가 (최신/오래된/씬번호/댓글많은순)"
```

---

### Task 4: 그룹화 토글 (씬별/에피소드별/진행률별)

**Files:**
- Create: `src/views/compositing/EpisodeGroupSection.tsx`
- Create: `src/views/compositing/ProgressKanbanSection.tsx`
- Modify: `src/views/CompositingView.tsx`

- [ ] **Step 1: 그룹화 토글 UI**

필터 바 위쪽 (또는 우측)에 3개 버튼:

```tsx
type GroupMode = 'scene' | 'episode' | 'progress';
const [groupMode, setGroupMode] = useState<GroupMode>('scene');
```

- [ ] **Step 2: EpisodeGroupSection 컴포넌트**

EP 헤더 → 펼치면 그 EP의 씬들 nested. 각 씬 안에 미니 리비전 행들 (re#/상태/본문/시간).

mockup `revision-board-v3.html`의 `view-episode` 섹션 참조.

- [ ] **Step 3: ProgressKanbanSection 컴포넌트**

3컬럼 grid. 각 컬럼 = 상태별. 미니 카드 (씬 라벨 칩 + re# + 본문 일부 + 메타).

mockup의 `view-progress` 섹션 참조.

- [ ] **Step 4: CompositingView에서 라우팅**

```tsx
{groupMode === 'scene' && <SceneGroupSection ... />}
{groupMode === 'episode' && <EpisodeGroupSection ... />}
{groupMode === 'progress' && <ProgressKanbanSection ... />}
```

- [ ] **Step 5: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/views/compositing/ src/views/CompositingView.tsx
git commit -m "[v1.19.0-step-4] 그룹화 토글 추가 — 씬별/에피소드별/진행률별 3종"
```

---

### Task 5: 썸네일 영역 + 씬 모달 점프 버튼

**Files:**
- Modify: `src/views/compositing/RevisionCard.tsx` (썸네일)
- Create: `src/views/compositing/SceneJumpButton.tsx` (재사용 점프 버튼)
- Modify: `src/views/compositing/SceneGroupSection.tsx` (씬 헤더에 점프 버튼)
- Modify: `src/views/compositing/RevisionDetailPanel.tsx` (상단 점프 링크)

- [ ] **Step 1: SceneJumpButton 컴포넌트**

```tsx
interface Props {
  sceneKey: string;  // 'EP01:A:1' 형태
  variant?: 'icon' | 'link';  // icon=헤더용 ↗ 아이콘, link=패널용 텍스트 링크
}

export function SceneJumpButton({ sceneKey, variant = 'icon' }: Props) {
  function handleJump(e: React.MouseEvent) {
    e.stopPropagation();
    const { ep, part, sceneId } = parseSceneKey(sceneKey);
    // bflow:open-scene-modal 이벤트 발행 — episode/part/scene 정보를 detail에 담아
    window.dispatchEvent(new CustomEvent('bflow:open-scene-modal', {
      detail: {
        episodeNumber: parseInt(ep.replace(/\D/g,''), 10),
        partId: part,  // 또는 partId lookup 필요
        sceneId,
        initialTab: 'revisions',
      },
    }));
  }

  if (variant === 'link') {
    return (
      <button onClick={handleJump} className="text-[10px] text-accent-sub hover:underline flex items-center gap-1">
        <ExternalLinkIcon className="w-2.5 h-2.5" />
        씬 모달 열기
      </button>
    );
  }

  return (
    <button onClick={handleJump} title="씬 상세 모달 열기" className="p-1.5 rounded hover:bg-accent/15 text-text-secondary hover:text-accent-sub">
      <ExternalLinkIcon className="w-4 h-4" />
    </button>
  );
}
```

⚠️ `bflow:open-scene-modal` 이벤트 detail은 v1.18.0의 NotificationPanel + ScenesView 라우팅에서 사용 중. 그 핸들러(`ScenesView.tsx:2055-2101`)가 받는 정확한 필드명에 맞춰 dispatch.

- [ ] **Step 2: 씬 헤더에 SceneJumpButton 마운트**

`SceneGroupSection.tsx`의 SceneRow 헤더 우측 끝에:

```tsx
<SceneJumpButton sceneKey={group.sceneKey} variant="icon" />
```

- [ ] **Step 3: RevisionDetailPanel 상단에 점프 링크**

```tsx
<SceneJumpButton sceneKey={selectedRev.sceneKey} variant="link" />
```

- [ ] **Step 4: RevisionCard에 썸네일 영역**

```tsx
{rev.imageUrl ? (
  <div className="shrink-0 w-20 h-14 rounded overflow-hidden relative">
    <img src={rev.imageUrl} className="w-full h-full object-cover" alt="" />
    {/* +N 표시 (추가 이미지가 있다면 — 현재 데이터 모델은 단일 image_url만 지원, 향후 확장) */}
  </div>
) : (
  <div className="shrink-0 w-20 h-14 rounded border border-dashed border-bg-border/40 flex items-center justify-center text-text-secondary/50">
    <ImageIcon className="w-4 h-4" strokeWidth={1.5} />
  </div>
)}
```

- [ ] **Step 5: 호버 시 인라인 상태 변경 노출**

카드에 `group` Tailwind 클래스 + `opacity-0 group-hover:opacity-100 transition-opacity`로 상태 ▾ 버튼 표시.

- [ ] **Step 6: 빌드 + 커밋**

```bash
npx tsc --noEmit
npm run build:vite
git add src/views/compositing/
git commit -m "[v1.19.0-step-5] 썸네일 영역 + 씬 모달 점프 버튼 + 호버 액션 추가"
```

---

### Task 6: 마무리 — 버전 업 + 검증

**Files:**
- Modify: `package.json` (1.18.1 → 1.19.0)

- [ ] **Step 1: 버전 업 + 빌드**

```bash
# package.json version: 1.18.1 → 1.19.0
npm run build:vite
```

- [ ] **Step 2: spec 검증 기준 11개 수동 통과**

dev 모드에서 직접 확인:
1. [ ] 우선순위/부서/프레임 표시 없음 (카드/디테일/등록 폼)
2. [ ] re# 형식 넘버링
3. [ ] 검색 동작 (본문/씬/등록자 매칭)
4. [ ] 정렬 4종 동작
5. [ ] 그룹화 토글 3종 동작
6. [ ] 씬 헤더 ↗ 버튼 → 씬 모달 열림
7. [ ] 썸네일: 이미지 있음/없음 일관 표시
8. [ ] 호버 인라인 액션 노출
9. [ ] 우측 디테일 패널 카드 클릭 슬라이드 인 (기존 유지)
10. [ ] 다크/라이트 + 테마 색 6종 자동 반영
11. [ ] 1366줄 분할 (각 파일 ≤400줄)
12. [ ] tsc + vite build 통과

실패 항목은 fix 커밋 (`[v1.19.0-step-6-fix] xxx 수정`).

- [ ] **Step 3: 마지막 커밋**

```bash
git add package.json
git commit -m "[v1.19.0] 컴포지팅 뷰 리뉴얼 — 신표준 정정 + 검색·정렬·그룹화·씬 점프·썸네일"
```

선택적: ROADMAP.md / CLAUDE.md 한 줄 갱신.

---

## 끝.

모든 Task 완료 시 v1.19.0 릴리스 준비 완료. PR 생성/머지/배포는 한솔 명시 시에만.
