# 배플레이그라운드 배한솔 전용 접근 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배플레이그라운드를 `main`에 포함하되 로그인 이름이 정확히 `배한솔`인 사용자만 메뉴와 뷰에 접근할 수 있게 한다.

**Architecture:** 사용자 이름을 받는 순수 접근 판정 함수 하나를 `featureFlag.ts`에 두고 Sidebar, App route guard, MainLayout이 모두 이 함수를 사용한다. 접근 판정은 네트워크나 환경 변수 없이 fail-closed로 동작하며, 허용되지 않은 `playground` 뷰 상태는 렌더 전에 `dashboard`로 교정한다.

**Tech Stack:** React 18, TypeScript, Zustand, Node test runner, Vite, Electron

## Global Constraints

- 초기 허용 이름은 정확히 `배한솔` 하나다.
- 로그인 전, 로그아웃 상태, 이름 누락, 다른 이름은 모두 차단한다.
- 개발 환경이나 기존 `VITE_ENABLE_PLAYGROUND_PREVIEW` 값으로 사용자 권한을 우회하지 않는다.
- Sidebar, App, MainLayout은 같은 production 판정 함수를 사용한다.
- Supabase 스키마, 관리자 UI, 게임·주식 서버 저장, 배포는 변경하지 않는다.
- 제품 코드보다 실패 테스트를 먼저 작성하고 RED를 확인한다.
- 기능 추가 버전은 `1.78.0`에서 `1.79.0`으로 올리되 배포는 하지 않는다.

---

### Task 1: 사용자 접근 계약과 세 화면 배선

**Files:**
- Modify: `tests/playgroundNavigationWiring.test.ts`
- Modify: `src/features/playground/featureFlag.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/MainLayout.tsx`

**Interfaces:**
- Produces: `canAccessPlayground(userName: unknown): boolean`
- Produces: `resolveAllowedView(value: unknown, userName: unknown): ViewMode`
- Consumes: `useAuthStore((state) => state.currentUser?.name)`

- [ ] **Step 1: 접근 계약 실패 테스트 작성**

`tests/playgroundNavigationWiring.test.ts`의 기존 환경 플래그 테스트를 다음 계약으로 교체한다.

```ts
import { canAccessPlayground, resolveAllowedView } from '../src/features/playground/featureFlag.ts';

test('playground access is fail-closed to 배한솔 only', () => {
  assert.equal(canAccessPlayground('배한솔'), true);
  for (const blocked of ['다른 사용자', '', ' 배한솔 ', null, undefined, 1234]) {
    assert.equal(canAccessPlayground(blocked), false);
    assert.equal(resolveAllowedView('playground', blocked), 'dashboard');
  }
  assert.equal(resolveAllowedView('playground', '배한솔'), 'playground');
  assert.equal(resolveAllowedView('not-a-view', '배한솔'), 'dashboard');
});
```

같은 파일의 배선 테스트에는 다음 검사를 추가한다.

```ts
const featureFlag = readFileSync('src/features/playground/featureFlag.ts', 'utf8');
assert.doesNotMatch(featureFlag, /VITE_ENABLE_PLAYGROUND_PREVIEW|import\.meta\.env/);
assert.match(sidebar, /canAccessPlayground\(currentUserName\)/);
assert.match(app, /resolveAllowedView\(currentView, currentUser\?\.name\)/);
assert.match(layout, /canAccessPlayground\(currentUserName\)/);
```

- [ ] **Step 2: RED 확인**

Run:

```powershell
node --test .\tests\playgroundNavigationWiring.test.ts
```

Expected: `canAccessPlayground` export가 없거나 기존 환경 기반 판정 때문에 실패한다.

- [ ] **Step 3: 순수 접근 판정 최소 구현**

`src/features/playground/featureFlag.ts`의 환경 기반 판정을 다음 사용자 판정으로 교체한다.

```ts
import type { ViewMode } from '@/stores/useAppStore';

const PLAYGROUND_ALLOWED_USER_NAMES = new Set(['배한솔']);

export function canAccessPlayground(userName: unknown): boolean {
  return typeof userName === 'string' && PLAYGROUND_ALLOWED_USER_NAMES.has(userName);
}

export function resolveAllowedView(value: unknown, userName: unknown): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !canAccessPlayground(userName)) return 'dashboard';
  return value as ViewMode;
}
```

`KNOWN_VIEWS`는 기존 목록을 그대로 유지한다.

- [ ] **Step 4: Sidebar에 동일 판정 연결**

기존 `isPlaygroundPreviewEnabled` import를 `canAccessPlayground`으로 교체하고 이미 구독 중인 `currentUserName`을 사용한다.

```ts
.filter((item) => item.id !== 'playground' || canAccessPlayground(currentUserName))
```

- [ ] **Step 5: App의 저장 뷰와 현재 뷰 차단**

저장된 기본 뷰를 읽을 때는 현재 auth store 이름을 전달한다.

```ts
useAppStore.getState().setView(resolveAllowedView(
  savedPrefs.defaultView,
  useAuthStore.getState().currentUser?.name,
));
```

현재 뷰를 렌더할 때는 reactive `currentUser` 이름을 전달한다.

```ts
const safeCurrentView = resolveAllowedView(currentView, currentUser?.name);
```

기존 교정 effect는 유지해 사용자 전환 시 `dashboard`를 store에도 반영한다.

- [ ] **Step 6: MainLayout의 몰입형 상태 차단**

`useAuthStore`로 현재 이름을 구독하고 동일 판정을 사용한다.

```ts
const currentUserName = useAuthStore((state) => state.currentUser?.name);
const immersive = currentView === 'playground' && canAccessPlayground(currentUserName);
```

- [ ] **Step 7: GREEN과 전체 Playground 회귀 확인**

Run:

```powershell
node --test .\tests\playgroundNavigationWiring.test.ts
npm run test:playground
npm run typecheck
```

Expected: focused test와 Playground 97개 이상 테스트가 모두 통과하고 TypeScript 오류가 없다.

- [ ] **Step 8: Task 1 커밋**

```powershell
git add -- tests/playgroundNavigationWiring.test.ts src/features/playground/featureFlag.ts src/components/layout/Sidebar.tsx src/App.tsx src/components/layout/MainLayout.tsx
git diff --cached --check
git commit -m "배플레이그라운드를 배한솔 계정에만 노출"
```

---

### Task 2: 비공개 프리뷰 버전과 로드맵 기록

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DEVLOG/update-notes.json`
- Modify: `ROADMAP.md`
- Test: `tests/releaseNoteCategories.test.ts`

**Interfaces:**
- Produces: package version `1.79.0`
- Produces: update note first entry with version `1.79.0`
- Consumes: existing release-note JSON schema and manifest generator

- [ ] **Step 1: 버전 정합성 실패 조건 확인**

Run:

```powershell
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); const n=require('./DEVLOG/update-notes.json'); if(p.version!=='1.79.0'||l.version!=='1.79.0'||l.packages[''].version!=='1.79.0'||n[0].version!=='1.79.0') process.exit(1)"
```

Expected: 현재 버전이 `1.78.0`이므로 exit code 1.

- [ ] **Step 2: 버전과 업데이트 내역 추가**

`package.json` 버전과 `package-lock.json`의 최상위 및 `packages[""]` 버전을 `1.79.0`으로 바꾼다. `DEVLOG/update-notes.json` 맨 앞에는 다음 항목을 추가한다.

```json
{
  "version": "1.79.0",
  "title": "배한솔님 전용 배플레이그라운드 프리뷰를 시작해요",
  "items": [
    {
      "category": "feature",
      "summary": "게임 로비와 JBBJ 모의투자 시장을 먼저 시험해요",
      "description": "배한솔 계정에서만 배플레이그라운드 메뉴가 보여요. 테트리스·스네이크·스도쿠 준비 화면과 JBBJ 모의투자 홈·종목·계좌 흐름을 실제 앱에서 먼저 확인할 수 있어요. 다른 팀원 화면에는 아직 나타나지 않아요."
    }
  ]
}
```

- [ ] **Step 3: ROADMAP에 한정 프리뷰 상태 기록**

문서 날짜를 `2026-07-11`, 버전을 `v1.79.0`으로 갱신하고 전체 현황에 다음 줄을 추가한다.

```text
실험 기능: 배플레이그라운드     ██████░░░░ 배한솔 한정 프리뷰 (로비·하우스·JBBJ 시장)
```

Overview 아래에 다음 절을 추가한다.

```markdown
## 실험 기능: 배플레이그라운드 `[진행]`

> **초기 사용자**: 배한솔 계정만 접근 가능. 다른 팀원에게는 사이드바와 화면을 모두 숨긴다.

- [x] A안 게임 로비와 JBBJ 하우스
- [x] 클릭 지점에서 퍼지는 게임·시장 입장 전환
- [x] 테트리스·스네이크·스도쿠 준비 화면
- [x] JBBJ 시장 홈·종목 상세·내 계좌 프리뷰
- [x] 배한솔 사용자 한정 접근 게이트
- [ ] 실제 사용 피드백을 반영한 포인트·게임 점수 정책 확정
- [ ] 관리자 종목·뉴스·가격 조정 기능
- [ ] 게임 실행과 서버 저장
```

- [ ] **Step 4: 버전·릴리스 노트 테스트와 커밋**

Run:

```powershell
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); const n=require('./DEVLOG/update-notes.json'); if(p.version!=='1.79.0'||l.version!=='1.79.0'||l.packages[''].version!=='1.79.0'||n[0].version!=='1.79.0') process.exit(1)"
npm run test:auto-update
```

Expected: 버전 정합성 검사와 auto-update 테스트가 모두 통과한다.

Commit:

```powershell
git add -- package.json package-lock.json DEVLOG/update-notes.json ROADMAP.md
git diff --cached --check
git commit -m "배플레이그라운드 한정 프리뷰 버전 기록"
```

---

### Task 3: 실제 사용자 QA, 독립 리뷰, main 병합

**Files:**
- Verify only: all Task 1 and Task 2 files

**Interfaces:**
- Consumes: `canAccessPlayground(userName: unknown): boolean`
- Produces: locally merged `main` with no push and no deployment

- [ ] **Step 1: 실제 프리뷰에서 배한솔 허용 확인**

`http://127.0.0.1:5173/?preview=1`에서 `배한솔`/`1234`로 로그인한다. 사이드바 `배플레이그라운드` 버튼, 입장 overlay `지금은 쉬는 시간!`, A 로비를 확인한다.

- [ ] **Step 2: 실제 프리뷰에서 비허용 사용자 차단 확인**

인앱 브라우저의 Vite runtime import로 `useAuthStore`의 `currentUser`를 임시 비허용 사용자 객체로 바꾼다. 제품 파일이나 저장 데이터는 수정하지 않는다.

```js
const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
useAuthStore.getState().setCurrentUser({
  id: 'preview-blocked-user',
  name: '다른 사용자',
  slackId: '',
  isInitialPassword: false,
  createdAt: new Date(0).toISOString(),
  role: 'user',
});
```

메뉴가 사라지고 현재 Playground가 즉시 대시보드로 교정되는지 확인한 뒤 배한솔 세션으로 복구한다. 콘솔 error가 0인지 확인한다.

- [ ] **Step 3: 전체 검증**

Run:

```powershell
npm run test:playground
npm run test:auto-update
npm run typecheck
npm run build:vite
git diff --check main..HEAD
git status --short --branch
```

Expected: 모든 명령 exit code 0, working tree clean.

- [ ] **Step 4: 독립 리뷰**

리뷰어는 `main..HEAD` 전체에서 다음을 확인한다.

- 배한솔만 접근 가능하고 환경 플래그 우회가 없음
- Sidebar 숨김과 App 직접 접근 차단이 함께 존재
- 사용자 전환 시 즉시 dashboard로 교정
- 버전 `1.79.0`과 update-notes 첫 항목 정합
- Supabase, IPC, 배포 경로에 새 변경 없음

Critical/Important 이슈를 모두 수정하고 재검증한다.

- [ ] **Step 5: 로컬 main 병합 전 상태 확인**

```powershell
git -C C:\Bflow-BGonly status --short --branch
git -C C:\Bflow-BGonly fetch --all --prune
git -C C:\Bflow-BGonly pull --ff-only
```

main이 깨끗하고 원격과 fast-forward 가능한 경우에만 병합한다. 사용자 변경이 있으면 보존하고 중단해 보고한다.

- [ ] **Step 6: main 로컬 병합과 병합 결과 재검증**

```powershell
git -C C:\Bflow-BGonly merge --no-ff codex/jbbj-market-preview -m "배플레이그라운드 배한솔 한정 프리뷰 병합"
npm run test:playground
npm run test:auto-update
npm run typecheck
npm run build:vite
```

명령은 `C:\Bflow-BGonly`에서 실행한다. 성공 후 branch와 worktree는 즉시 삭제하지 않고 보존한다. push, PR, G드라이브 배포는 실행하지 않는다.
