# 미리보기 모드 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dev 모드 + URL `?preview=1` 진입 시 mock '배한솔' admin 으로 자동 로그인 + 우상단 `PREVIEW` 배지 표시. 빌드된 `.exe` 는 영향 없음.

**Architecture:** (1) `isPreviewMode()` 모듈 상수 캐시 1개를 만들어 트리거를 단일화. (2) `App.tsx` 에 `useRef` guard 가 있는 자동 로그인 useEffect 추가 — `users[0]` (배한솔 admin) 으로 진입. (3) `PreviewBadge` 컴포넌트를 `LoginScreen`/메인 라우팅 분기 *바깥*에 항상 마운트 (모드 OFF 시 null 반환). (4) `devElectronAPI.ts` 의 mock 배한솔 password 를 `'1q2w3e4r'` 로 분리.

**Tech Stack:** React 18 + TypeScript, vite 5 dev server, zustand (`useAuthStore`), `import.meta.env.DEV` 정적 치환.

**Source spec:** [`docs/superpowers/specs/2026-04-28-preview-mode-design.md`](../specs/2026-04-28-preview-mode-design.md)

**Note on testing:** 본 프로젝트는 vitest 단위 테스트 인프라가 없는 상태. 검증은 *(a) `tsc --noEmit` 타입 통과, (b) `vite build` production 빌드 통과, (c) production main entry chunk 에 mock password 미포함 + 동작 비활성 검증, (d) `npm run dev` + `?preview=1` 시각 확인* 로 대체.

**사전 점검 완료 사실 (plan 작성 시 직접 확인):**
- `package.json` scripts — `dev` (`vite`), `build:vite` (`tsc && vite build`), `build` (`tsc && vite build && electron-builder`) 모두 정의됨
- `src/App.tsx:1` — `useEffect`, `useRef` 이미 import 됨
- `src/App.tsx:5` — `useAuthStore` 이미 import 됨
- `src/App.tsx:62-68` — `useAuthStore()` destructure 형태로 사용 중. **`currentUser, setCurrentUser, authReady, setAuthReady, setUsers` 가 이미 들어있고, `users` (목록) 만 빠져 있음** → Task 2.1 에서 destructure 라인에 `users` 추가 필요
- `src/App.tsx:1212-1213` — `return ( <> ... </> )` 형태. 이미 fragment 로 감싸져 있어 PreviewBadge 를 첫 자식으로 추가만 하면 됨 (wrap 처리 불필요)
- `src/App.tsx` 의 LoginScreen 분기 (라인 1107, 1124 부근) 와 메인 분기 모두 위 fragment 안에 있음 → PreviewBadge 를 fragment 의 *최상단* 에 두면 두 분기 모두 보임
- 빌드 산출물 경로 (이전 v1.14.x 작업에서 확인됨, 메모리 `project_deploy_workflow.md` 참조): portable target. `dist/win-unpacked/BFLOW.exe` 가 한솔 바로가기의 실제 대상

---

## File Structure

```
신규
  src/utils/previewMode.ts                                     [트리거 + 모듈 상수]
  src/components/PreviewBadge.tsx                              [우상단 노란 배지]

수정
  src/App.tsx                                                  [자동 로그인 useEffect + PreviewBadge 렌더]
  src/mocks/devElectronAPI.ts                                  [mock 배한솔 password 분리]
```

---

## Chunk 1: 핵심 유틸 + 컴포넌트

### Task 1.1: `previewMode.ts` 유틸

**Files:**
- Create: `src/utils/previewMode.ts`

- [ ] **Step 1: 파일 생성**

```ts
// src/utils/previewMode.ts
/**
 * 미리보기 모드 여부 — 모듈 평가 시 한 번만 계산해 캐시.
 *
 * 활성 조건 (둘 다 만족):
 * - import.meta.env.DEV === true       : vite dev server. production build 에서는 정적으로 false 치환됨
 * - URL 쿼리 ?preview=1 (엄격 매치)    : 의도되지 않은 진입 차단. ?preview=true / ?preview 단독은 무시
 *
 * URL 은 페이지 라이프사이클 중 변하지 않으므로 매 호출 재계산 불필요.
 * 안정적인 boolean 참조 값을 반환해 useEffect 의존성에도 안전.
 */
const PREVIEW_MODE_FLAG: boolean = (() => {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('preview') === '1';
})();

export function isPreviewMode(): boolean {
  return PREVIEW_MODE_FLAG;
}
```

- [ ] **Step 2: tsc 통과 확인**

Run: `npx tsc --noEmit`
Expected: PASS — 새 파일에서 타입 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/utils/previewMode.ts
git commit -m "feat: add isPreviewMode() utility — dev + ?preview=1 strict match"
```

---

### Task 1.2: `PreviewBadge` 컴포넌트

**Files:**
- Create: `src/components/PreviewBadge.tsx`

- [ ] **Step 1: 파일 생성**

```tsx
// src/components/PreviewBadge.tsx
import { isPreviewMode } from '@/utils/previewMode';

/**
 * 우상단 PREVIEW 배지.
 * 미리보기 모드 OFF 시 null 반환 → production 빌드에서는 항상 렌더 결과 없음.
 *
 * 렌더 위치는 App.tsx 의 LoginScreen / 메인 라우팅 분기 바깥 — 자동 로그인 직전
 * 찰나에 LoginScreen 이 잠시 보일 때에도 미리보기임이 즉시 인지된다.
 */
export function PreviewBadge() {
  if (!isPreviewMode()) return null;
  return (
    <div
      className="fixed top-2 right-2 z-[9999] px-2 py-0.5 rounded-md bg-yellow-500/95 text-black text-[11px] font-bold tracking-[0.1em] pointer-events-none shadow-md"
      aria-hidden="true"
    >
      PREVIEW
    </div>
  );
}
```

- [ ] **Step 2: tsc 통과 확인**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/components/PreviewBadge.tsx
git commit -m "feat: add PreviewBadge component — yellow top-right indicator"
```

---

## Chunk 2: App 통합 + mock password 분리

### Task 2.1: `App.tsx` 자동 로그인 useEffect + PreviewBadge 렌더

**Files:**
- Modify: `src/App.tsx` (라인 ~62, ~68 근방, 그리고 라인 1213 fragment 안)

> 사전 점검 결과(plan header 참조): `useEffect`/`useRef` import 됨, `useAuthStore` destructure 사용 중(`users` 만 추가 필요), return 부 fragment 형태.

- [ ] **Step 1: import 추가 (line 1 import 블록 끝)**

```tsx
import { isPreviewMode } from '@/utils/previewMode';
import { PreviewBadge } from '@/components/PreviewBadge';
```

(`useEffect`, `useRef` 는 line 1 의 react import 에 *이미 포함*되어 있으므로 추가 불필요)

- [ ] **Step 2: useAuthStore destructure 에 `users` 추가**

`src/App.tsx:62-68` 의 destructure 블록 — 기존:

```tsx
const {
  currentUser, setCurrentUser,
  authReady, setAuthReady,
  setUsers,
  isAdminMode, setAdminMode,
  showPasswordChange, showUserManager, setShowUserManager,
} = useAuthStore();
```

변경 (한 줄 추가):

```tsx
const {
  currentUser, setCurrentUser,
  authReady, setAuthReady,
  users, setUsers,             //  ← `users` 추가
  isAdminMode, setAdminMode,
  showPasswordChange, showUserManager, setShowUserManager,
} = useAuthStore();
```

- [ ] **Step 3: ref 선언 — destructure 직후**

위 destructure 블록 직후 (라인 ~69) 에 추가:

```tsx
// 미리보기 모드 자동 로그인 — 한 번만 발동, 사용자 명시적 로그아웃 후 재로그인 방지.
// React StrictMode 의 더블 마운트에서도 같은 컴포넌트 인스턴스의 ref 는 보존되므로 안전.
const previewAutoLoginDoneRef = useRef(false);
```

- [ ] **Step 4: 자동 로그인 useEffect 추가**

기존 useEffect 들과 같은 함수 본문 영역(예: 라인 ~78 근방의 토스트 useEffect 옆)에 추가:

```tsx
// 미리보기 모드: dev + ?preview=1 진입 시 mock '배한솔' admin 으로 자동 로그인.
useEffect(() => {
  if (previewAutoLoginDoneRef.current) return;
  if (!authReady || currentUser) return;
  if (!isPreviewMode()) return;

  // users 가 아직 비어 있으면(loadUsers() 가 끝나기 전) ref 미설정 + return.
  // deps 의 `users` 변화로 setUsers() 직후 effect 가 재발동해 자동 로그인.
  const fallback = users[0];
  if (!fallback) return;

  previewAutoLoginDoneRef.current = true;
  // dev-only — 트리거 자체가 import.meta.env.DEV === true 보장이라 production 에서 실행되지 않음
  console.log('[Preview] 자동 로그인:', fallback.name);
  setCurrentUser(fallback);
}, [authReady, currentUser, users, setCurrentUser]);
```

- [ ] **Step 5: PreviewBadge 렌더 — fragment 첫 자식으로**

`src/App.tsx:1212-1213` 에서 fragment 시작 직후 첫 줄에 `<PreviewBadge />` 추가:

```tsx
return (
  <>
    <PreviewBadge />                                            {/* ← 추가 */}
    <GradientBackdrop intensity="normal" enabled={globalGradientEnabled} />
    <MainLayout onRefresh={loadData}>{renderView()}</MainLayout>
    {/* ... 이하 기존 */}
  </>
);
```

이로써 LoginScreen 분기(라인 1107 부근)와 메인 분기 모두 같은 fragment 안에 있어 PreviewBadge 가 항상 표시됨.

- [ ] **Step 6: tsc 통과 확인**

Run: `npx tsc --noEmit`
Expected: PASS — 새 import / destructure / useEffect / JSX 모두 타입 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/App.tsx
git commit -m "feat: auto-login as MOCK_USERS[0] in preview mode + render PreviewBadge"
```

---

### Task 2.2: `devElectronAPI.ts` mock 배한솔 password 분리

**Files:**
- Modify: `src/mocks/devElectronAPI.ts:9`

- [ ] **Step 1: 변경 적용**

기존:
```ts
{ id: '1', name: '배한솔', slackId: 'U05DFV9UAN5', password: '1234', isInitialPassword: false, createdAt: '2025-01-01T00:00:00Z', role: 'admin' },
```

변경 후:
```ts
{ id: '1', name: '배한솔', slackId: 'U05DFV9UAN5', password: '1q2w3e4r', isInitialPassword: false, createdAt: '2025-01-01T00:00:00Z', role: 'admin' },
```

(다른 11명의 사용자 password 는 그대로 `'1234'` 유지)

- [ ] **Step 2: tsc 통과 확인**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add src/mocks/devElectronAPI.ts
git commit -m "chore(mock): isolate 배한솔 mock password as 1q2w3e4r"
```

---

## Chunk 3: 빌드/검증/배포

### Task 3.1: production 빌드 검증

**Files:** (없음 — 검증 단계)

> **주의**: vite 는 dynamic import 를 별도 청크로 코드 스플릿하지만, 그 청크 *파일* 은 dist 안에 *존재*할 수 있다 (lazy 로드 대상). 따라서 `grep -r dist/` 로 mock password 가 *어디에도 안 나타남* 을 기대하는 것은 정확하지 않다. 실제 안전성의 본질은: (a) main entry chunk(앱이 즉시 로드)에 mock 미포함 — production 트리거 false 로 dynamic import 가 *실행되지 않음*, (b) 트리거 false 로 자동 로그인 분기 자체가 비활성. 아래 검증은 이 두 가지 본질에 맞춤.

- [ ] **Step 1: production 빌드 실행**

Run: `npm run build:vite`
Expected: PASS — `tsc && vite build` 가 에러 없이 완료. `dist/index.html`, `dist/assets/index-*.js` 생성

- [ ] **Step 2: main entry chunk 에 mock password 미포함 확인**

먼저 main entry chunk 파일명 확인:
Run: `cat dist/index.html | grep -oE 'index-[A-Za-z0-9_-]+\.js'`
Expected: `index-XXXX.js` 형태의 파일명 1개

그 파일에 mock password 가 없는지 확인:
Run: `grep -c "1q2w3e4r" dist/assets/index-XXXX.js` (XXXX 를 위 파일명으로 치환)
Expected: `0` — main entry 에 mock password 미포함

- [ ] **Step 3: 동작 비활성 확인 (정적 분석)**

main entry chunk 에 `import.meta.env.DEV` 가 *상수 false* 로 치환되었는지 확인:
Run: `grep -oE '"PREVIEW_MODE_FLAG[^"]+"|isPreviewMode' dist/assets/index-XXXX.js | head -3`
- 함수가 인라인 되어 모듈 상수 캐시가 정적으로 false 로 평가될 가능성 (vite minifier). 코드가 들어 있어도 결과가 false 로 고정되어 있으면 OK.

빠른 확인 — minified 코드에서 false 분기 dead-code 제거 흔적:
Run: `grep -c "preview-only-mock\|installDevElectronAPI" dist/assets/index-*.js`
Expected: main entry chunk(XXXX)에는 0. 별도 mocks 청크가 분리됐다면 그 파일에는 포함되어 있을 수 있으나 *로드되지 않으면 무해*

- [ ] **Step 4: dynamic mock 청크가 별도로 분리되었는지 확인 (참고)**

Run: `ls dist/assets/ | grep -i "mock\|electron" | head`
Expected (선택적): `devElectronAPI-XXXX.js` 같은 별도 청크가 있을 수도 있고, vite tree-shaking 으로 완전 제거되었을 수도 있다. *어느 쪽이든 production 에서 import 가 실행되지 않으므로 안전*. 이 정보는 PR 본문 메모용.

- [ ] **Step 5: 검증 메모 작성** (커밋 없음)

위 결과를 한 줄로 정리해 PR 본문 *✅ 테스트 가이드* 섹션에 들어갈 형태로 메모.

---

### Task 3.2: dev 모드 시각 확인

**Files:** (없음 — 동작 검증)

- [ ] **Step 1: dev server 실행**

Run: `npm run dev`
Expected: vite dev server 가 `localhost:5173` 에서 시작

- [ ] **Step 2: 일반 모드 진입 — 미리보기 OFF 확인**

브라우저로 `http://localhost:5173/` 접속.
Expected:
- LoginScreen 정상 표시 (자동 로그인 발동 X)
- 우상단에 `PREVIEW` 배지 *없음*
- 콘솔에 `[Preview] 자동 로그인` 로그 없음

- [ ] **Step 3: 미리보기 모드 진입**

브라우저로 `http://localhost:5173/?preview=1` 접속.
Expected:
- LoginScreen 잠시 보일 수 있으나 즉시 자동 로그인되어 메인 대시보드 진입
- 우상단에 `PREVIEW` 배지 표시 (노란 배경, 검정 텍스트, 우상단 8px 떨어진 위치)
- 콘솔에 `[Preview] 자동 로그인: 배한솔` 로그 출력
- 사용자 메뉴/프로필에 *배한솔 (admin)* 정보 표시

- [ ] **Step 4: 로그아웃 후 재로그인 차단 확인**

미리보기 모드에서 메뉴를 통해 로그아웃 시도.
Expected:
- LoginScreen 으로 복귀
- *자동 로그인 재발동되지 않음* (ref guard 동작)
- 페이지 새로고침 시에는 *URL 쿼리스트링 `?preview=1` 이 보존되는지 확인 후* 다시 자동 로그인. (vite dev server 는 SPA 라우터 영향 없이 새로고침 시 동일 URL 유지 → 쿼리스트링도 유지 → 자동 로그인 재발동. 이 점 시각적으로 확인.)

- [ ] **Step 5: 잘못된 URL 파라미터 무시 확인**

브라우저로 `http://localhost:5173/?preview=true` 또는 `?preview` 접속.
Expected:
- 일반 LoginScreen — 자동 로그인 X, PREVIEW 배지 X (엄격 매치 동작)

- [ ] **Step 6: dev server 종료**

`Ctrl+C` 로 dev server 종료. (커밋 없음)

---

### Task 3.3: production 빌드 + .exe 동작 검증

**Files:** (없음 — 최종 동작 검증)

- [ ] **Step 1: 풀 production 빌드**

Run: `npm run build`
Expected: tsc + vite build + electron-builder portable 완료. 산출물 (메모리 `project_deploy_workflow.md` 참조):
- `C:\Bflow-BGonly\dist\BFLOW.exe` (157MB, portable single)
- `C:\Bflow-BGonly\dist\win-unpacked\BFLOW.exe` (180MB, 한솔 바로가기 실제 대상)

- [ ] **Step 2: BFLOW.exe 직접 실행 (수동)**

`C:\Bflow-BGonly\dist\win-unpacked\BFLOW.exe` 더블클릭.
Expected:
- LoginScreen 정상 표시 — 자동 로그인 발동 X
- 우상단 PREVIEW 배지 *없음*
- (참고: Electron 환경에서는 `import.meta.env.DEV === false` 라 트리거 자체 비활성)

- [ ] **Step 3: 실 사용자 계정 로그인 확인**

평소 사용하는 실 Supabase 계정으로 로그인 시도.
Expected:
- 정상 로그인 (mock 영향 없음)

- [ ] **Step 4: 검증 결과 요약** (커밋 없음 — PR 본문 작성용 메모)

Task 3.1~3.3 의 결과를 모아 PR 본문 *✅ 테스트 가이드* 섹션에 들어갈 형태로 정리.

---

## Chunk 4: PR 생성

### Task 4.1: PR 생성

**Files:** (없음)

- [ ] **Step 1: 현재 브랜치 확인**

Run: `git branch --show-current`
Expected: `feat/preview-mode` (worktree add 시 명시적으로 생성한 브랜치)

만약 다르게 나오면 plan 진행 자체가 잘못된 worktree 에서 이뤄지는 것 — 즉시 정지하고 한솔에게 보고.

- [ ] **Step 2: 브랜치 push**

Run: `git push -u origin feat/preview-mode`
Expected: 원격에 브랜치 등록 + 추적 설정

- [ ] **Step 3: PR 생성 (pr-creator 스킬 형식)**

제목: `[v1.15.0] 미리보기 모드 — dev 자동 로그인 + PREVIEW 배지`

본문 4섹션 outline (한솔의 평소 PR 톤):

```markdown
## 📋 업데이트 요약

> 이번 업데이트에서 달라진 점을 간략하게 정리했습니다.

- ✨ 개발 모드(`npm run dev`)에서 앱을 띄울 때 *로그인 화면 막힘 없이* 자동으로 들어가서 둘러볼 수 있게 됨
- 🛡️ 미리보기인지 즉시 알 수 있도록 *우상단 노란 PREVIEW 배지* 표시
- 🔒 빌드된 `.exe` 에는 *영향 없음* — 실 운영 환경 안전

## 🔧 상세 기술 설명

### 트리거 (`src/utils/previewMode.ts`)
- `import.meta.env.DEV === true` AND URL `?preview=1` 엄격 매치 시 활성화
- 모듈 평가 시 한 번만 계산해 boolean 상수로 캐시 (안정 참조)

### 자동 로그인 (`src/App.tsx`)
- `useRef` guard 로 *한 번만* 발동, 사용자 명시적 로그아웃 후 재로그인 방지
- `users[0]` (mock 배한솔 admin) 으로 `setCurrentUser` — `users` 가 비어 있으면 deps 변화 시 재발동
- React StrictMode 더블 마운트에 안전 (ref 보존)

### PREVIEW 배지 (`src/components/PreviewBadge.tsx`)
- LoginScreen / 메인 분기 *바깥* 에 마운트 → 로그인 전후 모두 표시
- production 빌드에서 `isPreviewMode()` 항상 false → null 반환

### 보안 안전망 (`src/mocks/devElectronAPI.ts`)
- mock 배한솔 password `'1234'` → `'1q2w3e4r'` 분리 (실 Supabase password 와 충돌 방지)

## 🚧 개발 난항

특이사항 없음. 이미 갖춰진 `installDevElectronAPI()` mock 인프라를 재활용해 신규 코드 최소화.

## ✅ 테스트 가이드

### 사용자 테스트
1. **미리보기 모드 정상 동작**
   - `npm run dev` 실행 → 브라우저 `http://localhost:5173/?preview=1` 접속
   - ✅ 기대: LoginScreen 잠시 보일 수 있으나 즉시 메인 대시보드 진입 + 우상단 노란 PREVIEW 배지

2. **일반 dev 모드 영향 없음**
   - 같은 dev server 에서 `?preview=1` 없이 접속
   - ✅ 기대: LoginScreen 표시, PREVIEW 배지 없음, 자동 로그인 발동 X

3. **빌드된 `.exe` 영향 없음**
   - `dist/win-unpacked/BFLOW.exe` 실행
   - ✅ 기대: 평소처럼 LoginScreen, PREVIEW 배지 없음, 실 사용자 로그인 정상

### 개발자 테스트
- (Task 3.1 검증 결과 요약을 여기 1~2 줄로 적기)
```

PR 생성 명령:

```bash
gh pr create --base main \
  --title "[v1.15.0] 미리보기 모드 — dev 자동 로그인 + PREVIEW 배지" \
  --body "$(cat <<'EOF'
[위 4섹션 본문 — Task 3 의 실제 검증 결과를 ✅ 테스트 가이드 개발자 테스트 부분에 채워서 작성]
EOF
)"
```

- [ ] **Step 4: 코덱스 자동 리뷰 대기 (필요 시)**

코덱스 봇이 자동으로 리뷰 댓글을 다는 환경. 6~10분 후 결과 확인.
- 이슈 없으면 한솔에게 머지 결정 묻기
- 이슈 있으면 한솔과 함께 검토 후 수정 → 같은 브랜치 push (PR 자동 갱신)

- [ ] **Step 5: 메모리 기록 갱신 (이미 spec 단계에서 만든 파일이 정상인지 확인)**

확인 파일: `C:/Users/user/.claude/projects/C--Bflow-BGonly/memory/project_preview_mode_credentials.md`

- spec 작성 단계에서 만들어 둔 mock password 메모리가 PR 머지 후에도 그대로 유효.
- MEMORY.md 인덱스 라인이 추가되었는지 한 번 확인. 누락 시 보완.

---

## 머지 후 배포 (참고)

PR 머지 후 main 에서:

1. `git checkout main && git pull`
2. `npm run build` (electron-builder portable)
3. `robocopy C:\Bflow-BGonly\dist "G:\공유 드라이브\..\Bflow-BGonly\dist" /E /R:2 /W:2`
4. G드라이브 `win-unpacked\BFLOW.exe` 의 FileVersion 이 `1.14.1` (또는 1.15.0 으로 패치 시) 인지 확인

(메모리 `project_deploy_workflow.md` 의 절차와 동일)

---

## 비고: 1~8번 후속 사이클

본 작업(v1.15.0) 머지 후 다음 사이클(v1.16.0)에서 1~8번 UX 폴리싱 진행.
- 결정사항은 메모리 `project_scenes_ux_polish_decisions.md` 참고
- 5번 화살표 아이콘 / 7번 완전 숨김 은 결정 완료, 나머지(1+6, 2+3+4, 8) 명확화 마저
- 미리보기 모드(v1.15.0)가 이미 머지되어 있어 시각 검증 환경에서 활용 가능
