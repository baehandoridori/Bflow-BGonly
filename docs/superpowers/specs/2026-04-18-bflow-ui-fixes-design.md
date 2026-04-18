# B flow 9개 UI/UX 이슈 통합 수정 — 설계 문서

- 작성일: 2026-04-18
- 브랜치: `claude/quirky-keller-3422fd`
- 대상 범위: Electron 메인 앱, 플로팅 위젯(BrowserWindow), 대시보드 내 위젯, 로그인 화면
- PR 단위: **단일 PR**(사용자 결정)

## 배경

사용자 리포트로 파악된 9건의 이슈를 한 PR에 통합 반영한다. 구성은 다음과 같다.

1. 씬 뷰 카드 메모 영역 클릭이 라쏘 드래그로 오인식되어 다수 카드가 선택됨
2. 설정의 글꼴 크기(프리셋·카테고리별 스케일)가 플로팅 위젯/대시보드 위젯에 반영되지 않음
3. "내 할일" 위젯을 플로팅으로 띄우면 항목이 빈 칸으로 표시됨
4. 로그인 화면 플렉서스 파티클 색상이 현재 테마와 다르게 보임(초기 프레임 폴백 색상 노출 추정)
5. 글자 카테고리별 **색상** 개별 조절 기능 신규 추가(크기와 동일 구조) — 메인·플로팅·대시보드 전부
6. 빌드된 앱에서 자동 로그인이 작동하지 않음
7. 대시보드 파티클을 끄면 그라데이션 배경도 함께 사라짐 → 그라데이션만 유지하는 **옵션** 제공. **로그인 화면까지 포함**(사용자 결정)
8. 휴가 등록 중에는 캘린더/휴가 위젯에 "등록 대기중" 상태(노란색)로 표시, 등록 완료 시 어느 화면에서든 토스트 알림
9. 에피소드 위젯을 플로팅으로 띄운 상태에서 앱 재시작 시 위젯이 빈 칸으로 뜸(에피소드 번호 파라미터 미복원)

## 용어 및 참고

- **플로팅 위젯**: `WidgetPopup`이 진입점인 별도 BrowserWindow. `#widget-popup/<id>?ep=...` URL hash로 메타 전달.
- **대시보드 위젯**: 메인 앱 대시보드에서 `react-grid-layout`으로 배치되는 카드.
- **공유 경로**
  - 글꼴 설정: `src/services/settingsService.ts`(loadPreferences/savePreferences), `src/utils/typography.ts`(applyFontSettings), `preferences.json`
  - 테마 색상: `src/themes.ts`(applyTheme), `src/index.css` 전역 CSS 변수
  - 위젯 팝업 창 생성: `electron/main.ts` `openWidgetPopup()`, 위치 캐시 `widgetPositionCache`
  - 세션: `src/services/userService.ts`(loadSession), `src/stores/useAuthStore.ts`, `auth.json`

## 설계 — 이슈별

### ① 카드 메모 클릭 → 라쏘 오인식

**현상 (사용자 보고)**  
`스크롤 맨 위` 상태에서 2번 컷의 메모 영역을 클릭하면 스크롤이 내려가며 6번 컷이 선택되어 2–6번 다중 선택이 되는 것처럼 보임. 마우스는 움직이지 않았음.

**원인**  
- `useLassoSelection`([src/views/ScenesView.tsx:41-113])의 라쏘 제외 셀렉터(`button, input, select, textarea, a, [role="button"]`)에 메모 영역이 포함되지 않음. 메모는 `<div><p>`([src/components/scenes/UnifiedSceneCard.tsx:140-146]).
- mousedown 직후 카드에 포커스/레이아웃 변화로 스크롤 컨테이너가 움직이면 `getBoundingClientRect()` 기반 교차 판정에서 라쏘 드래그가 사실상 시작된 효과가 난다.
- 5px 임계값은 `clientX/Y`만 기준이라 "스크롤 발생 후 실제 마우스 이동 없음" 케이스를 거르지 못함.

**수정**  
1. `UnifiedSceneCard.tsx` 메모 래퍼 div에 `data-no-lasso` 속성 추가.
2. `useLassoSelection` 제외 조건에 `[data-no-lasso]`, `[contenteditable="true"]`도 포함(이미 지원 — 확인 후 보강).
3. mousedown 당시 `container.scrollTop/scrollLeft`를 `startScrollRef`에 저장. mousemove에서 실제 스크롤 변화분을 dx/dy에서 **차감**하여 스크롤로 인한 가짜 이동을 무효화한다.

```ts
// mousedown
startScrollRef.current = { top: container.scrollTop, left: container.scrollLeft };
// mousemove
const scrollDx = container.scrollLeft - startScrollRef.current.left;
const scrollDy = container.scrollTop - startScrollRef.current.top;
const dx = me.clientX - startRef.current.x - scrollDx;
const dy = me.clientY - startRef.current.y - scrollDy;
if (!isDragging.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
```

4. 임계값 5 → 8px(클릭 허용 범위 완화).

**테스트**  
- 카드 뷰 스크롤 최상단에서 상단 카드 메모 클릭 → 라쏘 안 뜨고 단일 클릭으로만 처리.
- 빈 영역에서 실제 드래그 시 라쏘 선택 정상 동작 확인.

---

### ② 글꼴 크기 플로팅/대시보드 위젯 미적용

**원인**  
`WidgetPopup`의 초기화([src/views/WidgetPopup.tsx:287-371])에서 `loadTheme()`만 호출하고 `loadPreferences()` + `applyFontSettings()`가 빠져 있음. 플로팅 BrowserWindow는 별도 렌더러 프로세스라 메인 앱의 `document.documentElement.style`을 공유하지 않음.

**수정**  
1. `WidgetPopup` 초기화 루틴에 아래 추가(theme 적용 직후).

```ts
const prefs = await loadPreferences();
if (prefs) {
  applyFontSettings({
    scale: prefs.fontScale ?? 'm',
    categoryScales: prefs.fontCategoryScales,
  });
}
```

2. **실시간 반영**: 메인 앱의 `FontSizeSection`/`FontColorSection`에서 저장 시, `window.electronAPI.preferencesBroadcast()`(신규 IPC) 호출 → 메인 프로세스가 모든 위젯 창에 `preferences:changed` 전송 → 각 위젯이 리스너에서 `loadPreferences` + `applyFontSettings` + `applyTextColors`(신규) 재호출.
3. 메인 창도 동일 브로드캐스트에 반응(자기 자신 포함).

**테스트**  
- 설정에서 프리셋 xl로 변경 → 메인·플로팅·대시보드 모든 위젯 글자 크기 즉시 변경.
- 앱 재시작 후에도 유지.

---

### ③ "내 할일" 플로팅 빈 칸

**원인 가설**  
- `WidgetPopup`의 `loadSession()`([src/views/WidgetPopup.tsx:362-365])은 호출되지만 실패 조건(auth.json 파싱 문제, 사용자 배열 불일치)에서 `currentUser`가 null.
- 또는 `currentUser.name`은 설정되더라도, 씬 `assignee` 이름 매칭 로직과 `readTaskViews(userId)`의 assignedSceneKeys 로드가 플로팅 컨텍스트에서 async 경합.
- 이슈 ⑥(자동 로그인)와 동일 근본 원인일 가능성. **먼저 ⑥을 고치면 해결되는지 확인** 후 남은 케이스만 추가 패치.

**수정**  
1. `loadSession` 실패/사용자 없음 시 로그를 명시적으로 남김(`console.warn('[WidgetPopup] session load failed', reason)`).
2. `MyTasksWidget`의 `activeView.type === 'assigned'` 분기에서 `currentUser`가 아직 없을 때 스켈레톤/로딩 상태로 렌더링(현재는 `name=''`이면 빈 배열 반환).
3. `readTaskViews` 호출도 `currentUser?.id`가 준비된 뒤에 trigger. 현재 이미 userId 기반이면 확인.
4. 이슈 ⑥ 수정 후 재현 없으면 여기서 마무리. 재현 시 `useAuthStore`를 플로팅 창에서 메인 창과 동기화하는 IPC(`session:broadcast`) 추가 — 메인이 로그인 성공/로그아웃 시 모든 창에 push.

**테스트**  
- 메인에서 로그인한 사용자로 "내 할일" 플로팅 띄우기 → 메인과 동일 개수의 씬 노출.
- 메인에서 로그아웃 후 플로팅도 빈 상태로 전환.

---

### ④ 플렉서스 파티클에 테마와 다른 색이 껴 보임

**원인**  
- `PlexusBackground` / `DashboardPlexus`의 `getPlexusColors`/`getColors`([src/components/auth/LoginScreen.tsx:48-77], [src/views/Dashboard.tsx:77-84])는 테마 로드 실패 시 하드코딩 RGB 폴백을 사용: `[[108,92,231], [162,155,254], [116,185,255], [0,184,148], [85,239,196]]` — 파랑/청록이 섞여 있음.
- 로그인 화면은 테마 로드 전에 canvas 첫 프레임이 렌더될 수 있음. 파티클 색은 생성 시 고정되어, 이후 테마가 적용돼도 이미 칠해진 파티클은 폴백 색상을 유지.

**수정**  
1. 파티클 생성 루프를 "테마 로드 확정 후"로 지연. `PlexusBackground` 내부에서 `themeReady` 플래그가 true가 될 때까지 canvas 비우고 대기.
2. 폴백 배열은 **테마 accent/accentSub만** 남기고 파랑/청록 제거(`[[108,92,231], [162,155,254]]`). 필요한 variation은 HSL 이동으로 생성하되 채도 너무 튀지 않게 clamp.
3. 파티클마다 색 레퍼런스를 "인덱스 → 현재 getPlexusColors() 반환의 인덱스"로 매 프레임 resolve하도록 바꿔, 테마 변경이 실시간 반영되게 한다(현재는 초기화 시 한 번 고정).

**테스트**  
- 로그인 화면 최초 진입 → 파티클이 현재 테마 accent 계열로 통일되어 보임(파랑/청록 없음).
- 설정에서 테마 색 변경(커스텀) → 대시보드/로그인 파티클 색이 즉시 따라감.

---

### ⑤ 글자 카테고리별 색상 개별 조절 (신기능)

**구조**  
- `UserPreferences`([src/services/settingsService.ts])에 추가:
  ```ts
  fontCategoryColors?: {
    heading?: string;  // "R G B" RGB triplet (theme와 동일 포맷)
    body?: string;
    caption?: string;
    micro?: string;
  };
  fontColorPreset?: 'theme' | 'high-contrast' | 'soft' | 'mono' | 'custom';
  ```
- `applyFontSettings`와 별개로 `applyTextColors(colors)` 함수를 `typography.ts`에 추가. `document.documentElement`에 CSS 변수를 설정:
  - `--color-text-heading`, `--color-text-body`, `--color-text-caption`, `--color-text-micro` (미지정 시 `--color-text-primary`로 폴백).
- `src/index.css`에 카테고리 클래스 매핑:
  ```css
  .text-xl, .text-lg, h1, h2, h3 { color: rgb(var(--color-text-heading, var(--color-text-primary))); }
  .text-base, .text-sm { color: rgb(var(--color-text-body, var(--color-text-primary))); }
  .text-xs { color: rgb(var(--color-text-caption, var(--color-text-primary))); }
  .text-\[11px\], .text-\[10px\], .text-\[9px\] { color: rgb(var(--color-text-micro, var(--color-text-primary))); }
  ```
  (Tailwind `text-text-primary` 등 명시 클래스를 이미 사용하는 곳은 유지 — 계층 색상은 "기본값 override" 레이어로 동작.)

**프리셋 (사용자 결정: 포함)**  
- `theme` (기본) — 모두 `--color-text-primary`
- `high-contrast` — 제목 100% 흰, 본문 primary, 캡션/마이크로 secondary
- `soft` — 제목 accent-sub, 본문 primary, 캡션/마이크로 secondary(낮은 밝기)
- `mono` — 전부 primary
- `custom` — 고급 모드 사용자 지정

**설정 UI**  
- `FontColorSection.tsx` 신규. `FontSizeSection`과 동일 UX:
  - 프리셋 셀렉터 5종(프리셋 선택 시 개별 색상 자동 적용·잠금).
  - 고급 토글 ON 시 카테고리별 color picker + 현재 미리보기.
  - 설정 저장 → `savePreferences` → `applyTextColors` 즉시 호출 → 이슈 ②의 브로드캐스트 채널로 다른 창도 반영.

**테스트**  
- 프리셋 high-contrast 선택 → 제목 대비 증가 확인.
- 고급에서 본문 색만 변경 → 메인·플로팅·대시보드 모두 즉시 반영.
- 테마 변경 시 프리셋 `theme`이면 새 테마 색을 따라감.

---

### ⑥ 빌드 앱 자동 로그인 실패

**원인 가설**  
`app.setName('Bflow-BGonly')`가 main process 초기화에 명시되지 않으면 userData 경로가 `package.json`의 `productName` 등으로 결정되어 **개발과 빌드 경로가 달라질 수 있다**. 결과적으로 빌드 앱이 `auth.json`을 찾지 못해 세션 복원 실패.

**수정**  
1. `electron/main.ts` 최상단에 `app.setName('Bflow-BGonly')` 또는 `app.setPath('userData', ...)` 명시(CLAUDE.md 경로 요건 `%APPDATA%\Bflow-BGonly\`).
2. `loadSession` 실패 구간별 로그 추가:
   - auth.json 미존재
   - JSON 파싱 실패
   - `users.find(...)`가 undefined
3. 빌드 후 `%APPDATA%\Bflow-BGonly\` 실제 존재/파일 확인.
4. `rememberMe`가 false로 저장되어 있는 케이스도 방어: 기본값 true 유지 확인.

**테스트**  
- 빌드 설치 후 최초 로그인 → 앱 재실행 → 자동 로그인 성공.
- `%APPDATA%\Bflow-BGonly\auth.json` 존재 및 읽기 가능.

---

### ⑦ 파티클 OFF 시 그라데이션 유지 옵션 (로그인 화면 포함)

**원인**  
그라데이션이 canvas 내부(`ctx.createRadialGradient`)에 그려져 파티클과 묶여 있음([src/views/Dashboard.tsx:127-150], [src/components/auth/LoginScreen.tsx:PlexusBackground 내부]).

**수정**  
1. 그라데이션을 canvas 밖 DOM 배경으로 분리:
   ```tsx
   <div className="fixed inset-0 -z-10" style={{
     background: `radial-gradient(at 20% 10%, rgb(var(--color-accent) / 0.10) 0%, transparent 50%),
                  radial-gradient(at 80% 90%, rgb(var(--color-accent-sub) / 0.08) 0%, transparent 50%)`,
   }} />
   ```
   - 색은 이미 존재하는 테마 변수 사용 → 테마 바뀌면 자동 갱신.
2. `useAppStore.plexusSettings`에 `gradientEnabled` 추가(기본 true). 파티클 설정 UI에 "그라데이션 배경" 토글 추가.
3. 파티클 `enabled=false`여도 `gradientEnabled=true`면 그라데이션 레이어만 렌더.
4. **적용 범위** — Dashboard + LoginScreen (사용자 결정). 각 컴포넌트가 동일 `GradientBackdrop` 재사용 가능한 컴포넌트로 분리.

**테스트**  
- 대시보드에서 파티클 off → 어두운 단색 대신 그라데이션 유지.
- 설정에서 그라데이션 off → 완전 단색.
- 로그인 화면도 동일 동작.

---

### ⑧ 휴가 등록 대기 상태 + 완료 토스트

**현상**  
현재 휴가 등록은 GAS API 호출 후 응답이 와야 반영. 등록 요청 후 다른 화면으로 나갔다 돌아오면 대기 상태가 사라짐. 완료 알림 없음.

**수정**  
1. 낙관적 업데이트 — 등록 요청 순간 `useVacationStore`(신규 또는 기존 vacation store)에 `pendingEvents: VacationEvent[]` 추가. `status: 'pending'` 필드로 구분.
2. `VacationWidget`과 `CalendarWidget` 렌더링 시 pending 이벤트는 **노란색(예: amber-400 배경 + amber 테두리)** 으로 표시.
3. 영속성 — pending 목록을 `%APPDATA%\Bflow-BGonly\pendingVacations.json`에 저장. 다른 화면 전환/재시작 시에도 유지.
4. 메인 프로세스에 `vacation:registered` broadcast 채널 추가. API 응답 성공 시 모든 창에 push → 각 창이 `sonner.toast.success('휴가 등록 완료')` 표시 + pending 제거.
5. 실패 시 `vacation:failed` broadcast → 에러 토스트 + pending을 사용자 수동 재시도 또는 자동 롤백.

**테스트**  
- 휴가 등록 버튼 클릭 → 즉시 노란색 pending으로 표시.
- 대기 중 다른 탭 이동 후 복귀 → 여전히 노란색.
- 등록 완료 시 어느 화면이든 토스트 알림.
- 실패 시 에러 토스트 + 상태 롤백.

---

### ⑨ 에피소드 위젯 재시작 시 빈 칸

**원인**  
`widgetPositionCache`([electron/main.ts 1340-1500 근처])는 위치/크기/AOT/opacity만 저장. `openWidgetPopup(widgetId, title, extra)`의 `extra` (예: `{ ep: '1' }`)가 저장되지 않아 재실행 시 `#widget-popup/ep-overall-progress` 로만 로드됨 → `extraParams.ep === undefined` → `episodeDashboardEp` 복원 안 됨 → 렌더 대상 에피소드 없음 → 빈 칸.

**수정**  
1. `WidgetPosition` 타입에 `extra?: Record<string, string>` 추가.
2. `openWidgetPopup` 호출 시점에 `widgetPositionCache.set(widgetId, { ...existing, extra })`로 저장.
3. 창 생성 시 `savedPos.extra`가 있으면 URL hash의 query string에 자동 주입.
4. 저장 대상은 `ep-*` 위젯 공통(특정 prefix 필터 불필요, 모든 extra 저장).
5. 기존 포지션 저장 파일(`widget-positions.json` 등) 하위 호환성 유지 — `extra` 미존재 시 `undefined`로 로드.

**테스트**  
- EP 1의 "EP 통합 진행률" 플로팅 띄움 → 앱 종료 → 재시작 → 동일 위치·크기에 EP 1 데이터로 복원.
- EP 2의 "EP 부서별 비교"도 동일 시나리오로 확인.

---

## 변경 파일 요약

| 영역 | 파일 | 변경 |
|------|------|------|
| 라쏘 수정 | `src/views/ScenesView.tsx`, `src/components/scenes/UnifiedSceneCard.tsx` | 제외 셀렉터 + 스크롤 보정 + `data-no-lasso` |
| 위젯 공통 초기화 | `src/views/WidgetPopup.tsx` | `loadPreferences` + `applyFontSettings` + `applyTextColors` + 브로드캐스트 리스너 |
| 폰트 색상 (신규) | `src/utils/typography.ts`, `src/services/settingsService.ts`, `src/index.css`, `src/components/settings/FontColorSection.tsx`, `src/components/settings/SettingsScreen.tsx` 진입점 | 카테고리별 색상 + 프리셋 |
| 브로드캐스트 IPC | `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts` | `preferences:changed`, `vacation:registered`, `session:broadcast` |
| 플렉서스 | `src/components/auth/LoginScreen.tsx`, `src/views/Dashboard.tsx` | 테마 로드 전 파티클 지연 + 폴백 색 정리 + 그라데이션 분리 |
| 그라데이션 분리 | `src/components/common/GradientBackdrop.tsx` (신규), `LoginScreen.tsx`, `Dashboard.tsx` | 공통 배경 컴포넌트 |
| 자동 로그인 | `electron/main.ts`, `src/App.tsx`, `src/services/userService.ts` | `setName` 명시 + 로그 |
| 휴가 | `src/components/widgets/VacationWidget.tsx`, `src/components/widgets/CalendarWidget.tsx`, `src/services/vacationService.ts`, `src/stores/useVacationStore.ts` (신규 가능), `electron/main.ts` | pending 상태 + 영속 + 브로드캐스트 토스트 |
| 위젯 복원 | `electron/main.ts` (`widgetPositionCache`), `electron/preload.ts` | `extra` 영속화 |

## 작업 순서 (단일 PR 내부 순서)

1. `electron/main.ts` `app.setName` + 로그(이슈 ⑥)
2. IPC 브로드캐스트 인프라 추가(`preferences:changed`, `vacation:*`, `session:broadcast`)
3. 위젯 창 `extra` 영속화(이슈 ⑨)
4. 라쏘 제외/스크롤 보정(이슈 ①)
5. `applyTextColors` + CSS 변수 기반 카테고리 색(이슈 ⑤ 코어)
6. `FontColorSection` + 프리셋 UI(이슈 ⑤ UI)
7. `WidgetPopup` 초기화 루틴에 preferences/텍스트 색 적용(이슈 ②)
8. MyTasks 플로팅 세션 문제 재확인 및 패치(이슈 ③)
9. `GradientBackdrop` 분리 + 설정 토글(이슈 ⑦)
10. 플렉서스 폴백/지연 수정(이슈 ④)
11. 휴가 pending 흐름(이슈 ⑧)
12. 단계마다 `tsc --noEmit` + `vite build`

## 호환성 및 리스크

- **기존 preferences.json**: 신규 필드는 전부 optional. 구버전 파일도 그대로 로드.
- **widgetPositionCache 포맷 변경**: `extra` 필드 추가는 하위 호환(미존재 시 undefined).
- **CSS 변수 추가**: `--color-text-heading` 등은 폴백(`var(... , --color-text-primary)`)으로 기본값 유지. 기존 컴포넌트 색상 깨짐 없음.
- **IPC 브로드캐스트 누적**: 리스너 정리(return cleanup) 누락 시 메모리 누수. `useEffect` 구독은 반드시 cleanup 반환.
- **플렉서스 지연**: 테마 로드가 지연되면 로그인 화면이 잠시 비어 보일 수 있음 → 빈 배경 대신 `GradientBackdrop`이 이미 깔려 있어 위화감 최소.
- **휴가 pending**: 네트워크 장애로 무한 pending 방지 위해 30초 후 자동 실패 처리(타이머).
- **단일 PR 규모**: 파일 약 12–15개 변경. 각 이슈가 독립적이라 리뷰 청크별 검토 가능.

## 미결 사항

- 플로팅 위젯용 `session:broadcast`가 필요한지는 이슈 ⑥ 수정 후 재현 테스트로 결정.
- 프리셋 `high-contrast` 등의 실제 색상값은 디자인 토큰(`themes.ts`)의 현재 accent/secondary와 맞춰 구현 시 최종 확정.
- 휴가 pending의 UI 구체 스타일(노란색 배경 농도)은 기존 VacationWidget 색상 체계에 맞춰 구현 시 조정.

## 검증 체크리스트

- [ ] tsc --noEmit 통과
- [ ] vite build 통과
- [ ] 메인 앱 로그인 → 재실행 → 자동 로그인 성공
- [ ] 카드 뷰 스크롤 최상단에서 메모 클릭 시 라쏘 안 생김
- [ ] 설정 프리셋 변경 시 모든 위젯에 즉시 반영
- [ ] "내 할일" 플로팅이 메인과 동일 항목 수 노출
- [ ] 로그인/대시보드 파티클이 테마 색만 사용
- [ ] 파티클 off 시 그라데이션 유지 가능
- [ ] 글자 카테고리별 색상 프리셋 5종 + 고급 모드 동작
- [ ] 휴가 등록 pending 상태 + 완료 토스트 전역 전파
- [ ] EP 위젯 재시작 복원 성공(EP 번호 유지)
