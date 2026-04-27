# 미리보기 모드 — 디자인 문서

**작성일**: 2026-04-28
**대상 브랜치**: `feat/preview-mode`
**대상 버전**: v1.15.0
**작성자**: 한솔 × Claude

---

## 배경

B flow는 기본적으로 Electron 데스크톱 앱이지만, **개발/디자인 검토 단계**에서 다음 상황이 발생한다.

- 한솔이 *Claude Code의 미리보기 도구* 또는 `npm run dev` 로 vite dev server를 띄워 앱을 빠르게 둘러보거나 변경 사항을 확인하고 싶음
- 그러나 **로그인 화면에서 막힘** — Electron preload (`window.electronAPI`)가 dev 모드에서는 자동 mock 으로 대체되지만, 그 mock 사용자 목록과 한솔의 입력이 맞지 않거나 흐름이 어긋나 인증이 통과되지 않음

이 문서는 **dev 모드 + URL 파라미터** 조합 시 자동 로그인 + 미리보기 식별 표시를 통해 마찰 없는 검증 환경을 만드는 방안을 정의한다.

---

## 사전 점검 결과 (현재 상태)

본 디자인을 잡기 위해 코드베이스를 사전 점검한 결과, 다음 인프라가 *이미 갖춰져 있음*을 확인했다.

| 항목 | 상태 | 위치 |
|---|---|---|
| `installDevElectronAPI()` 자동 호출 | ✅ 이미 동작 | `src/main.tsx:10-13` |
| 12명의 mock 사용자 (`배한솔` admin 포함, password='1234') | ✅ 이미 정의 | `src/mocks/devElectronAPI.ts:8-21` |
| Supabase / Sheets / 캘린더 / 휴가 등 모든 IPC mock | ✅ 이미 정의 | 같은 파일, 200줄 |
| `useAuthStore.setCurrentUser(user)` API | ✅ 이미 동작 | `src/stores/useAuthStore.ts:32-40` |

→ **남은 빈자리는 단 두 가지**: (1) 미리보기 모드 진입 시 LoginScreen을 자동 우회하는 흐름, (2) 미리보기임을 식별하는 시각 배지.

---

## 결정사항 요약

| 항목 | 결정 |
|---|---|
| 활성화 트리거 | `import.meta.env.DEV === true` **AND** URL 쿼리 `?preview=1` 동시 충족 |
| 진입 동작 | 자동 로그인 (`useAuthStore.setCurrentUser(MOCK_USERS[0])`, 즉 *배한솔* admin) → 로그인 화면 우회 |
| 데이터 정책 | 기존 `devElectronAPI.ts` 의 mock 데이터 그대로 사용. 빈 mock 으로 인해 "둘러보기 거리"가 부족하면 후속 작업(1~8번 사이클)에서 fixture 보강 |
| 시각 표시 | 화면 우상단 fixed 위치에 작은 `PREVIEW` 배지 (노란/주황 톤) |
| 프로덕션 영향 | 빌드된 `.exe` 는 `import.meta.env.DEV === false` 이므로 트리거 자체가 비활성. 기능적/시각적 변화 없음 |
| 추가 보호 | URL 파라미터 없는 일반 `npm run dev` 사용 시는 영향 없음 — 평소처럼 LoginScreen 표시 |

---

## 섹션 1: 활성화 트리거

### 목표

dev 모드 + 명시적 URL 파라미터 조합 시에만 미리보기 활성화. 일반 `npm run dev` 사용·프로덕션 빌드는 영향 없음.

### 구현 위치

신규 파일: `src/utils/previewMode.ts`

### 코드 스케치

```ts
// src/utils/previewMode.ts
/**
 * 미리보기 모드 여부.
 * - import.meta.env.DEV: vite dev server 환경에서만 true (프로덕션 빌드는 false)
 * - URL 쿼리 ?preview=1 동시 충족 — 명시적 진입만 허용
 */
export function isPreviewMode(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('preview') === '1';
}
```

### 트레이드오프

- **dev 자동 활성화 (`?preview=1` 불필요)** 는 채택하지 않음 → 일반 `npm run dev` 작업 시에도 자동 로그인되어 부작용 가능
- **별도 npm 스크립트 (`npm run preview`)** 는 채택하지 않음 → vite preview 와 혼동, 빌드 산출물 검증과 의미 충돌

---

## 섹션 2: 자동 로그인

### 목표

미리보기 모드 진입 시 LoginScreen 을 표시하지 않고 곧장 메인 화면으로.

### 구현 위치

`src/App.tsx` — 마운트 단계의 인증 흐름 useEffect 옆에 추가

### 코드 스케치

```tsx
// src/App.tsx (인증 초기화 useEffect 근처)
import { isPreviewMode } from '@/utils/previewMode';

useEffect(() => {
  if (!authReady || currentUser) return;
  if (!isPreviewMode()) return;

  // mock 사용자 목록에서 첫 번째(배한솔 admin)를 자동 선택
  // — useAuthStore.users 는 App 마운트 시 loadUsers() 결과로 채워짐
  const fallback = users[0];
  if (fallback) {
    console.log('[Preview] 자동 로그인:', fallback.name);
    setCurrentUser(fallback);
  }
}, [authReady, currentUser, users, setCurrentUser]);
```

### 동작 시퀀스

1. 한솔이 미리보기 띄움 → vite dev server 의 `localhost:5173/?preview=1`
2. 부팅: `installDevElectronAPI()` 호출 → mock IPC 설치
3. 일반 인증 흐름: `loadUsers()` → mock 의 `usersRead()` → `setUsers(MOCK_USERS)`
4. `authReady === true` 시점에 위 useEffect 발동 → `currentUser === null` AND `isPreviewMode() === true` 조건 → 자동 로그인
5. 메인 대시보드 진입

### Edge case

- 사용자가 자동 로그인 후 의도적으로 `로그아웃` → useAuthStore.currentUser 가 다시 null. useEffect 의 `currentUser` 의존성 때문에 재발동 → 재로그인. **로그아웃 의도가 있는 경우 방해되므로 회피**: 한 번 자동 로그인했음을 ref 로 표시해두고 중복 호출 막음.

```tsx
const previewAutoLoginDoneRef = useRef(false);

useEffect(() => {
  if (previewAutoLoginDoneRef.current) return;
  if (!authReady || currentUser) return;
  if (!isPreviewMode()) return;
  const fallback = users[0];
  if (!fallback) return;
  previewAutoLoginDoneRef.current = true;
  setCurrentUser(fallback);
}, [authReady, currentUser, users, setCurrentUser]);
```

---

## 섹션 3: PREVIEW 배지

### 목표

미리보기 모드임을 한 솔이 즉시 인지 → 실 데이터 화면과 혼동 방지.

### 구현 위치

신규 파일: `src/components/PreviewBadge.tsx`
렌더 위치: `src/App.tsx` 내 최상위 (모달/드로어 위까지 보이도록 z-index 충분히 높게)

### 디자인

- **위치**: `position: fixed; top: 8px; right: 8px; z-index: 9999`
- **색상**: 노란/주황 (`bg-yellow-500/95 text-black`) — 한 눈에 띄도록
- **텍스트**: `PREVIEW`
- **크기**: 작은 padding `px-2 py-0.5`, font 11px, 700 weight, letter-spacing 0.1em
- **모서리**: rounded-md
- **상호작용**: `pointer-events: none` (클릭 막음, 정보 전용)

### 코드 스케치

```tsx
// src/components/PreviewBadge.tsx
import { isPreviewMode } from '@/utils/previewMode';

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

App.tsx 에서 항상 렌더 (`isPreviewMode()` 가 false 면 컴포넌트가 null 반환).

---

## 섹션 4: 프로덕션 영향 검증

### 목표

빌드된 `.exe` 가 미리보기 모드의 영향을 *어떤 형태로도* 받지 않음을 보장.

### 검증 포인트

1. `import.meta.env.DEV` 는 vite production build 에서 *정적으로* `false` 로 치환됨 → `isPreviewMode()` 는 항상 false 반환 → 자동 로그인 분기 비활성, `PreviewBadge` null 반환
2. URL 쿼리는 Electron 프로덕션 환경에서 `file://` 또는 `app://` 로딩이라 사용자가 `?preview=1` 을 실수로/일부러 붙여도 dev 조건 미충족으로 무시
3. `installDevElectronAPI()` 는 main.tsx 에서 *이미* `if (!window.electronAPI && import.meta.env.DEV)` 조건. 프로덕션에서는 `window.electronAPI` 가 preload 로 존재 + DEV false 라 호출 안 됨

---

## 비범위 (Out of Scope)

다음 항목은 본 작업에 포함하지 않는다 (사용자 결정에 따라 또는 YAGNI):

- **사용자 전환 메뉴** (다른 가짜 사용자 시뮬레이션) — 한솔의 결정에 따라 단일 자동 로그인으로 결정
- **mock fixture 데이터 보강** (샘플 에피소드/씬/댓글 채우기) — 현재 빈 mock 그대로. 후속 사이클(v1.16.0, 1~8번)에서 검증 시 필요 시 보강
- **실 Supabase 직접 호출 모드** — mock electronAPI 그대로 사용. dev 모드에서는 실 데이터 보지 않음
- **쓰기 차단 (read-only)** — 일반 동작. mock 환경이라 새로고침하면 작성 내용 사라짐
- **로그아웃 후 재진입 흐름** — 한 번 로그아웃하면 미리보기 자동 로그인 재발동 안 함 (ref guard). 재진입 원하면 페이지 새로고침

---

## 다음 단계

1. 이 spec 에 대한 사용자 검토
2. **구현 계획** 작성 (`writing-plans` 스킬 호출) → 단계별 task 분해
3. **구현** → 빌드/테스트 → PR (v1.15.0)
