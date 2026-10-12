# 배경 도면 편집 상태 표시 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배경 도면 편집기에서 "지금 편집 중인가, 저장했는가"가 늘 보이게 해 v1.135.0으로 만든다(추가 요청 G2의 1차 — 보이는 상태). 편집 중에는 도면 작업 영역 둘레의 2px 테두리와, 그 위에 붙어 화면을 따라오는 띠('편집 중' · 저장 안 한 변경 N개 · `Ctrl+S` · '편집 끝내기' · '도면 저장')가 있고, 보기 모드에는 조용한 '편집 시작' 버튼 하나가 있다. 한솔의 두 답(2026-10-12, 말 그대로): **"저장한 뒤에 편집을 계속, 띠의 색은 테마 색상과 대비되는 색상으로."** — 저장은 어느 저장 길에서든 편집을 끝내지 않고, 띠의 색은 테마의 두 색(강조색·보조 강조색)과 화면 바탕에서 계산한다. 바꾼 것이 없으면 '편집 끝내기'는 묻지 않고, '도면 저장'은 저장할 것이 있을 때만 켜지며, Ctrl+S로 저장하고, 저장하면 띠가 4초 동안 "✓ 도면을 저장했어요"라고 한다. 운영 DB·IPC·저장 모양은 바뀌지 않고 배경 메뉴는 계속 배한솔 계정 한정이다.

**Architecture:** "편집 중"은 깃발이 아니라 "지금 보는 도면에 초안이 있다"(`editing`)이다. 판정은 순수 모듈 셋에 두고 `node --test`로 값을 고정한다 — 초안의 '바뀜'과 수(`mapDocument.ts`의 `mapDraftChanged`·`mapDraftSteps`, 기록에서 밀려난 단계를 세는 `dropped`), 띠가 보일 것(`mapEditStatus.ts`: 초안·저장 중·방금 저장함 → 일곱 값), 띠의 색(`mapEditColor.ts`: 강조색·보조 강조색·바탕 → `strip`·`ink`, import 없음). 저장 길 넷은 `persistMaps` 한 곳을 지나고, 그 함수가 저장한 도면의 초안을 **명령에서 만든 도면**(`savedMaps`)으로 한 번의 dispatch(`rebase-drafts`)에 다시 놓는다 — 초안이 없는 렌더가 없어 띠가 깜빡이지 않는다. 저장 안 한 편집이 없는 초안만 라이브러리를 따라간다(`follow-saved`). 띠(`BackgroundMapEditStrip.tsx`)는 `.bmap-main`의 자식 하나라 평면과 3D에 같은 요소이고, 높이는 창 폭으로만 정해지며(40px / 72px) 그 높이는 이미지 목록이 낸다. 색은 `useMapEditColors`가 `<html>`의 계산된 스타일에서 읽어 편집기 뿌리의 변수 둘(`--bmap-edit`·`--bmap-edit-ink`)에 쓴다. Ctrl+S는 창 단위·캡처 단계에서 듣는다. 화면 배선은 소스 앵커 50~59가 글자로 고정하고 뮤테이션으로 확인한다. **CSS·포커스·스크롤·색은 설계 중에 한 번도 앱에서 그려 보지 않았다 — 엔진 확인은 오케스트레이터의 게이트다(설계 15.2).**

**Tech Stack:** Electron 33(Chromium 130) · React 18 · TypeScript · SVG · CSS(규칙 하나가 한 줄) · node:test(Node 22 type-stripping) · Vite

---

## 모든 Task 공통 규칙

- **작업 위치**: `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`, 브랜치 `claude/bg-map-edit-state-strip`(= main v1.134.0, 6731305a). 명령은 모두 그 폴더에서 돌린다. 다른 워크트리·상위 checkout은 건드리지 않는다.
- **계약은 설계 문서다**: `docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md`(아래 "설계"). 머리말의 용어(띠·테두리·초안·편집 중·바뀜·깨끗한 초안·다시 놓기·따라가기·테마의 두 색·스크롤 상자)와 각 Task의 **Read first**에 적힌 절을 먼저 읽는다. 설계에 적히지 않은 동작은 만들지 않는다. 이 계획과 설계가 어긋나면 설계가 맞다 — 멈추고 보고한다. **설계의 코드 블록·한글 문구·CSS 줄·표의 값은 글자(띄어쓰기·따옴표·주석 포함) 그대로 옮긴다** — 앵커와 테스트가 그 글자를 읽는다. 이 계획에 적힌 조각이 설계와 한 글자라도 다르면 설계의 것을 쓴다.
- **줄 번호로 찾지 않는다**: 설계의 `:265` 같은 번호는 6731305a의 것이고 Task가 지나면 밀린다. **인용한 코드로 찾는다.** 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다.
- **편집기 한눈에**: `BackgroundMapEditor.tsx`는 컴포넌트 하나다. `current`는 지금 도면(편집 중이면 초안 값), `draft`는 그 도면의 초안, `editing = !!draft && snapshot.canManage`, `disabled = pending || busy`(`pending`은 저장소의 "저장이 도는 중", `busy`는 편집기 자신의 비동기 동작), `canEdit = editing && !disabled`, `gestureActive`는 끌기 도중, `doc`는 동기 문서 저장소(`doc.getState()`는 늘 지금), `settle()`은 끌던 것을 취소하고 지금의 초안들을 돌려주고, `focusCanvas()`는 키보드를 캔버스로 보낸다. **`await` 뒤의 핸들러는 그 렌더의 `snapshot`·`current`·`draft`·`canEdit`·`draftChanged`를 쥐고 있다 — 핸들러 안의 판정은 `doc.getState()`에서 읽는다**(설계 R9).
- **명령**: **모두 Bash 도구(Git Bash)로 돌린다 — PowerShell이 아니다**(자가 점검의 `| wc -l`·`$'\r'`·`BFLOW_REPO='…' node …`·`node -e "…"`·`> 로그 2>&1`이 그 문법이다). `grep -c`는 0건이면 종료 코드 1을 내므로 찍힌 수만 본다(`&&`로 잇지 않는다). Task 13의 `npm run build:vite`는 타임아웃 600000ms로(또는 백그라운드로) 돌린다. 테스트 파일 하나 `node --test tests/<file>.test.ts` · `npm run typecheck` · 배경 묶음 `npm run test:background`(= `node --test ./tests/background*.test.ts` — 파일 이름의 무늬라 새 `tests/background*.test.ts`는 저절로 든다). 시작 기준(6731305a, 이 계획을 쓸 때 다시 돌렸다): **tests 542 / pass 537 / fail 0 / skipped 5**(건너뜀은 PGlite 없는 DB 계약 — SQL이 바뀌지 않으므로 PGlite 실행은 필요 없다). CSS를 고치는 Task 6부터는 **끝까지**(Task 6~13의 검사 단계마다 — 설계 14절 "4단계부터는" — 그리고 게이트의 대체안으로 CSS를 고친 커밋에서도) `npm run test:motion`도 돌린다(기준 **tests 619 / pass 619 / fail 0**). 매 Task 뒤 기대: 수가 직전보다 많거나 같고, **fail 0, skipped 5**. Task에 적힌 수는 "경우 하나에 `test()` 하나"로 썼을 때의 값이다 — 다르게 나눴으면 수가 다를 수 있고, 줄어들면 안 된다.
- **테스트 규칙(Node type-stripping)**: `.ts` 확장자를 붙인 상대 import, 지울 수 있는 TypeScript만(enum·namespace·`satisfies`·매개변수 속성 금지), 경로 별칭(`@/`) 금지 — 테스트가 실행 때 import하는 모든 모듈에 해당한다. 타입은 반드시 `import type { … }`(값 import에 타입을 섞으면 `does not provide an export named …`로 파일 전체가 실패하고, `npm run typecheck`는 `tests/background*.test.ts`를 검사하지 않아 잡지 못한다). 새 `.ts` 모듈도 같은 규칙이다. `.tsx`에서 `.ts`를 import할 때는 기존처럼 확장자 없이 쓴다(`'./mapEditStatus'`). **각 Task의 테스트는 그 Task까지 생긴 이름만 import한다.**
- **테스트 먼저**(@superpowers:test-driven-development): 실패하는 테스트 → 구현. 없는 export를 import한 파일은 `SyntaxError: The requested module … does not provide an export named '…'`(새 모듈이면 `ERR_MODULE_NOT_FOUND`)로 **파일 전체가** 실패한다 — 그것이 기대하는 실패다. 화면 배선은 순수 테스트로 잡을 수 없으므로 그 Task의 앵커(`tests/backgroundMapEditorWiring.test.ts`)를 먼저 쓴다.
- **앵커 규칙**: 소스는 그 파일의 `read(name)`으로 읽는다(줄 끝을 LF로 맞추고 주석을 뺀다 — 설계 코드의 주석 줄은 앵커가 보지 못한다). 함수는 `piece(source, from, to)`로 자르고(표지를 못 찾으면 단언으로 실패), 가지는 `block`, 순서는 `inOrder`, 개수는 `count`. 표지·정규식에 줄바꿈 글자를 넣지 않는다. '없음'을 보는 검사는 표지를 단언한 조각에만 건다. **CSS는 주석을 빼지 않고 줄 단위로 읽는다**: `readFileSync(new URL('backgrounds-map.css', directory), 'utf8').replace(/\r\n/g, '\n').split('\n')`. 앵커는 번호마다 `test()` 하나이고 이름은 `anchor 50: …`처럼 시작한다(각 Task에 이름을 적었다 — 뒤 Task가 그 이름의 `test()`에 단언을 더한다). 파일 안에서는 번호 순서로 둔다(49 다음에 50, 51 …). 기존 앵커 1~49는 고치지 않는다. 자가 점검의 "N번"은 나타난 횟수다: `grep -oF '<조각>' <파일> | wc -l`.
- **하지 않는 것**: dev 서버·Electron·미리보기 창을 띄우지 않는다(`npm run dev*`·`npm run preview:electron`·`npm run build` 금지 — `npm run build:vite`는 Task 13에서만). push·PR·머지·배포를 하지 않는다. **Supabase·운영 DB 도구(이름이 무엇이든, 읽기 전용 조회도)에 닿지 않는다.** 앱에서 확인하는 일은 모두 오케스트레이터의 게이트다.
- **건드리지 않는 파일**(설계 10.3): `src/features/playground/featureFlag.ts`, `electron/**`, `domain.ts`, `types.ts`, `previewGateway.ts`, `src/mocks/devElectronAPI.ts`, `useBackgroundStore.ts`, `BackgroundLibraryView.tsx`, `BackgroundUI.tsx`, `mapEditSession.ts`, `BackgroundMapPanels.tsx`, `BackgroundMapNameBox.tsx`, `BackgroundMapSelectionSummary.tsx`, `BackgroundMapCameraColor.tsx`, `BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapCameraGizmo.ts`, `mapCanvas.ts`, `BackgroundMapPlanPreview.tsx`, `backgrounds.css`, `backgrounds-map-3d.css`, `backgrounds-map-plan.css`, `src/themes.ts`, `src/App.tsx`, `src/index.css`, `DEVLOG/migrations/**`, `CLAUDE.md`. 편집기 안에서도 `keyboard()`·`pointerDown`·`navigate`·`createMap`·`linkMap`·`saveSettings`·삭제 가지의 본문은 한 글자도 고치지 않는다(설계 10.2).
- **줄 끝**: 이 PC는 `core.autocrlf=true`라 작업 폴더의 줄 끝이 파일마다 다르다. **각 파일의 지금 줄 끝을 그대로 둔다.** 고치기 전에 `git ls-files --eol <파일>`로 본다(6731305a에서: `BackgroundMapEditor.tsx`·`backgrounds-map.css`·`tests/backgroundMapEditorWiring.test.ts`·`package.json`·`package-lock.json`·`DEVLOG/update-notes.json`·`AGENTS.md`·`ROADMAP.md`·`docs/superpowers/plans/2026-10-10-feedback-additions.md`는 `w/crlf`, `mapDocument.ts`·`mapWorkflow.ts`·`useBackgroundMapDocument.ts`·`BackgroundMapGallery.tsx`·`tests/backgroundMapDocument.test.ts`·`tests/backgroundMapWorkflow.test.ts`는 `w/lf`). 고친 뒤 같은 명령이 **같은 값**이어야 한다 — `w/mixed`면 그 파일을 원래 줄 끝으로 통째로 맞춘 뒤 커밋한다. 새 파일은 LF로 만든다. 줄 끝을 셀 때는 `grep -cU $'\r' <파일>`(`-U` 없는 grep은 CRLF에서도 0을 낸다).
- **커밋**: Task마다 한 번, 그 Task의 **Files**만 `git add` 한다. 형식: `git commit -m "<한글 메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. 새 파일을 빠뜨리지 않는다(`git status --short`에 그 Task의 `??`가 남으면 안 된다).
- **떠 있는 서버와 창은 그대로 둔다**: 오케스트레이터의 dev 서버(미리보기 주소 `http://localhost:5190/?preview=1`)와 확인용 Electron 창이 떠 있을 수 있다. 프로세스를 끝내지 않고, 그 포트를 쓰지 않고, 창에 입력하지 않는다. 소스를 저장하면 그 창이 스스로 다시 그려지는 것은 정상이다.
- **스크래치와 뮤테이션 사본은 저장소 밖에만**: `C:\Users\user\AppData\Local\Temp\claude\C--Bflow-BGonly--claude-worktrees-background-library-2d-3d-editor-a0ed8c\bafc21df-e0b6-4780-87fb-9fc41e436a3b\scratchpad`(또는 자기 세션의 스크래치패드) 아래 **새 폴더**에 둔다. `node_modules`를 복사하지 않고 junction·symlink를 걸지 않는다. 끝나면 그 폴더를 지운다. 워크트리 안에는 임시 파일을 만들지 않는다.
- **오케스트레이터가 하는 것**: ① **Task 1 전에** 설계 문서와 이 계획(둘 다 `git status`의 `??`)을 커밋한다(`문서: 배경 도면 다-1 편집 상태 띠 설계와 구현 계획`). ② **게이트 A**(Task 7 뒤), **게이트 B**(Task 11 뒤), **게이트 M**(Task 12 뒤 — 뮤테이션 표의 판정), **최종 수동 검증**(Task 13 뒤). 게이트는 그 Task의 자동 검사가 통과한 뒤, **다음 Task를 시작하기 전에** 본다 — 대체안이 뒤 Task의 앵커가 읽는 글자를 바꾸기 때문이다. 오케스트레이터는 게이트마다 그 절의 **결과 줄**을 이 문서에 적고 커밋한 뒤 다음 Task를 연다. **게이트 바로 다음 Task의 작업자는 결과 줄이 비어 있으면 시작하지 않고 보고한다.** ③ Task 13의 `npm run build:vite`는 `dist`·`dist-electron`을 다시 쓴다 — 그 Task가 도는 동안에는 확인 창을 쓰지 않는다. ④ PR·머지·`npm run build`·배포는 한솔이 말할 때만.

## File structure

새 파일(모두 LF)

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapEditStatus.ts` | 띠가 보일 것을 정하는 순수 함수와 문구(설계 3.1) |
| `src/features/backgrounds/mapEditColor.ts` | 띠의 색을 정하는 순수 함수와 색 표(설계 7.1). import 없음 |
| `src/features/backgrounds/useMapEditColors.ts` | 그 색을 화면의 테마에서 읽어 편집기 뿌리에 쓰는 훅(설계 7.6) |
| `src/features/backgrounds/BackgroundMapEditStrip.tsx` | 띠(설계 6.1). 받은 것만 그린다 — 상태도 타이머도 없다 |
| `tests/backgroundMapEditStatus.test.ts` | 상태 표(11.1), 저장 → 계속 편집 → 다시 저장의 문서·저장소 단위 테스트(F-1~F-5) |
| `tests/backgroundMapEditColor.test.ts` | 색 표와 기준(C-0~C-8·C-11), CSS와의 일치(C-9·C-10) |

바뀌는 파일

| 파일 | 내용 | Task |
|---|---|---|
| `mapDocument.ts` | `MapDraft.dropped`, `commitDraft`, `freshDraft`, `rebaseDrafts`, 액션 `rebase-drafts`·`follow-saved`, `mapDraftSteps`, `mapDraftChanged`의 한 항, `MAP_HISTORY_LIMIT` import | 1 |
| `useBackgroundMapDocument.ts` | `rebaseDrafts`·`followSaved` 더하기(1), `dropDrafts` 빼기(4) | 1·4 |
| `mapWorkflow.ts` | `savedMaps` | 2 |
| `BackgroundMapEditor.tsx` | 설계 10.2의 표가 전부다: import 넷, `openDialogs`, 상태 둘·ref 둘, `useMapEditColors(rootRef)`, 새 함수 다섯, effect 넷, `persistMaps`·`saveMap`의 본문, `confirmAction`의 버리기 가지, 그리는 줄 아홉 곳 | 4·5·7·8·9·10·11 |
| `BackgroundMapGallery.tsx` | 안내 글 두 곳 | 9 |
| `backgrounds-map.css` | 설계 6.8 전부 — 기본 덩어리는 **`.bmap-main` 규칙 바로 다음**(미디어 블록들보다 앞) | 6 |
| `tests/backgroundMapDocument.test.ts` · `backgroundMapWorkflow.test.ts` · `backgroundMapEditorWiring.test.ts` | D-1~D-8 · W-1·W-2 · 앵커 50~59 | 1 · 2 · 4~12 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · `AGENTS.md` · `ROADMAP.md` · `docs/superpowers/plans/2026-10-10-feedback-additions.md` | 버전 1.135.0, 업데이트 내역, 문서(설계 13절). `DEVLOG/background-library-verification-2026-09-21.md`는 오케스트레이터가 쓴다 | 13 |

**import 방향(한 방향)**: `mapEditStatus.ts → mapDocument.ts` · `mapEditColor.ts`는 아무것도 import하지 않는다 · `useMapEditColors.ts → mapEditColor.ts` · `BackgroundMapEditStrip.tsx → mapEditStatus.ts` · 편집기가 넷을 쓴다. 테스트만 `src/themes.ts`의 프리셋을 읽는다.

Task와 설계 14절의 아홉 단계: 1단계 = Task 1·2 · 2 = Task 3 · 3 = Task 4·5 · 4 = Task 6·7(+게이트 A) · 5 = Task 8·9 · 6 = Task 10 · 7 = Task 11(+게이트 B) · 8 = Task 12(+게이트 M) · 9 = Task 13(+최종 수동 검증). 나눈 곳은 "순수 모듈·새 파일 + 테스트" 커밋과 "편집기 배선" 커밋의 경계다. **이 계획이 설계의 빈 곳을 정한 것 여덟**(설계와 어긋나지 않는다 — 다른 답이 오면 그 Task의 그 줄만 고친다): ① 4단계의 임시 머리줄은 `{!editing && <button …>공간 편집</button>}`의 꼴(Task 7 — 설계는 "예전 갈림 안에 남아 있다"고만 한다. Task 9가 없앤다). ② `useBackgroundMapDocument.ts`의 두 메서드 줄의 글자(Task 1 — 설계는 이름만 준다). ③ F-1~F-5는 설계대로 3단계(Task 4)에 쓰지만 1단계의 순수 모듈만 쓰므로 **쓰자마자 통과한다**(실패를 보지 않는 테스트다 — 그 값을 Task 12의 뮤테이션이 흔든다). 앵커 59도 같다. ④ 뮤테이션 사본은 저장소 밖이라 `zustand`를 찾지 못한다 — 해석 훅 두 파일로 푼다(Task 12. 이 계획을 쓸 때 저장소 밖 사본에서 `tests/backgroundStore.test.ts` 19개가 그 훅으로 통과함을 확인했다). ⑤ 설계 6.5의 CSS 주석 줄의 "(기존 세 줄 뒤에) "는 놓을 자리를 적은 말로 읽어 옮기지 않는다(Task 6 — 주석이라 어떤 테스트도 읽지 않는다). 설계 8.2의 `openDialogs` 줄 끝 주석(`// 모듈 상수: spaceEntry(:89) 다음 줄`)도 같다(Task 10). ⑥ 3단계를 둘로 나눠 Task 4와 5 사이의 커밋에서는 깨끗한 초안이 라이브러리를 따라가지 않는다(게이트가 없는 사이다). ⑦ 설계 13절의 문서 가운데 검증 결과가 있어야 쓰는 것(검증 기록, 추가 요청 계획 7.3의 '확인한 것'·'다' 줄의 상태)은 오케스트레이터가 최종 수동 검증 뒤에 채우고, Task 13은 그때까지 아는 것만 적는다. ⑧ 앵커 52의 '없다' 검사 셋은 따옴표 없이 찾는다(Task 8 — 설계 11.4의 52 행은 따옴표를 붙여 적었는데, 가운데 것 `'저장하지 않은 변경사항'`은 따옴표째로는 지금의 소스에도 없는 글자라 그대로 옮기면 지키는 것이 없다).

---

## Chunk 1: 상태 모델과 색 함수 (설계 14절 1·2단계)

### Task 1: 문서 리듀서 — 밀려난 단계를 세는 `dropped`, 다시 놓기와 따라가기

**Files:**
- Modify: `src/features/backgrounds/mapDocument.ts`, `src/features/backgrounds/useBackgroundMapDocument.ts`
- Test: `tests/backgroundMapDocument.test.ts`

**Read first:** 설계 3.2 전부(코드 블록 둘, "왜 이것으로 충분한가", 표), 4.1의 `rebase-drafts` 코드 블록과 그 바로 아래 문단, 4.4의 `follow-saved` 코드 블록·"`dropDrafts`를 쓰지 않는다" 문단·경우 표, 11.3의 D-1~D-8, 2.8의 "`editStatus`: 단계 수…" 행, 16절의 가·나·다·라·하·거 · `mapDocument.ts`의 `export type MapDraft =`, `export type MapDocumentAction =`, `function openDraft(`, `function dropDrafts(`, 리듀서의 `case 'update': {`와 `case 'gesture-finish': {`, `export function mapDraftChanged(` · `mapEditSession.ts`의 `MAP_HISTORY_LIMIT`·`commitMapHistory`(읽기만) · `useBackgroundMapDocument.ts` 전체 · 테스트의 도우미(`mapA`는 버전 3, `mapB`는 7, `run`·`named`·`moved`·`opened`·`valueOf`), `'the undo history of a draft keeps the newest fifty steps'`(60번 고치는 꼴의 본보기), `'a selection is no part of the edit: …'`(`selectMany`·`viewOf`).

- [ ] **Step 1: 테스트를 쓴다(11.3)** — import에 `mapDraftSteps`를 더한다. 새 `test()` 일곱 개와 기존 두 곳.
  - **D-1** `'edits the full history lets go of still count as unsaved'`: 60번 고치면 `past.length 50`, `dropped 10`, `mapDraftSteps 60`. 이어 50번 되돌리면 `past.length 0`, `future.length 50`, `value.name '10'`, **`mapDraftChanged true`**, `mapDraftSteps 10`. 한 번 더 고치면 11.
  - **D-2** `'inside the limit every edit can be taken back, and then nothing is unsaved'`: 5번 고치고 5번 되돌리면 `mapDraftChanged false`, 수 0, `dropped 0`. 다시 실행 한 번이면 1.
  - **D-3** `'a drag is one edit when it is released, never while it previews'`: 50번 고친(기록이 가득 찬) 초안에서 `gesture-begin` + `gesture-preview`(`moved(…, 900)`) 뒤 수 50, `gesture-finish` 뒤 51·`dropped 1`·`past.length 50`. 제자리로 돌아온 끌기(미리보기를 시작 값과 같은 내용으로 되돌린 뒤 `gesture-finish`)는 수를 바꾸지 않는다.
  - **D-4** `'rebase-drafts puts a fresh draft under each listed map that has one, and opens none'`: A만 편집 중이고 한 번 고친 상태에 `{ type: 'rebase-drafts', maps: [saved, mapB] }`(`saved = { ...mapA, revision: 4, name: '저장됨' }`) → A의 초안은 `deepEqual(value, saved)`이되 **같은 객체가 아니고**, `baseRevision 4`, `past []`, `future []`, `dropped 0`, `mapDraftChanged false`. **`mapDraft(next, B)`는 `undefined`**(열리지 않는다). 둘 다 편집 중(`opened()`)에서 A만 넘기면 B의 초안은 같은 객체, `next.viewports === state.viewports`. 할 일이 없으면(`maps: []`, 초안 없는 도면만) **같은 상태 객체**.
  - **D-5** `'rebase-drafts ends a gesture or a field edit only on a replaced draft'`: A를 끄는 중에 A를 다시 놓으면 `gesture null`, B를 다시 놓으면 제스처가 그대로(같은 객체). 합치는 중인 칸 편집(`coalesceKey`를 준 `update`로 만든 `coalescing`)도 같다.
  - **D-6** `'follow-saved moves a draft with nothing unsaved to a newer revision of its map, and nothing else'`(넘기는 목록에 두 도면이 다 들어 있다): 깨끗한 초안 + 더 새 버전(`{ ...mapA, revision: 4 }`) → 따라간다(`baseRevision 4`). 같은 버전(`[mapA, mapB]`) → **같은 상태**. 더 옛 버전 → 같은 상태. **바뀐 초안 → 같은 상태.** 모두 되돌린 초안(`future.length 1`) → 따라가고 `future []`. 끌기 도중 → 같은 상태. `baseRevision: null`(손으로 만든 상태) → 같은 상태. 초안이 없으면 같은 상태이고 열지 않는다.
  - **D-6b** `'follow-saved drops a draft with nothing unsaved whose map the library no longer has'`(목록에서 한 도면을 뺀다): 깨끗한 초안은 없어지고(`mapDraft(next, A) === undefined`) 다른 도면의 초안은 같은 객체, `viewports`도 같은 객체. **바뀐 초안 → 같은 상태.** 모두 되돌려 깨끗해진 초안 → 없어진다. 끌기 도중인 깨끗한 초안 → 같은 상태(제스처 그대로). `baseRevision: null` → 같은 상태. 한 번에 둘(`maps: [{ ...mapB, revision: 8 }]`): A는 없어지고 B는 8로 따라간다. 다른 도면에서 합치는 중이던 `coalescing`은 그대로(같은 객체). 빈 목록 → 깨끗한 초안은 모두 없어지고 바뀐 초안은 남는다.
  - **D-7**(기존 줄): `'entering a newly created map replaces any draft of it and starts a clean history'` 안의 `mapDraftChanged({ value: created, baseRevision: null, past: [], future: [] })`에 `dropped: 0`을 더한다. 기대(`true`)는 그대로다.
  - **D-8**(기존 테스트): `'a selection is no part of the edit: …'`의 `actions` 목록 **끝에** 이 둘을 이 차례로: `{ type: 'rebase-drafts', maps: [mapA] }, { type: 'follow-saved', maps: [{ ...mapA, revision: mapA.revision + 1 }, mapB] }`(글자 그대로 — 같은 버전의 `[mapA, mapB]`를 넘기면 그 테스트의 `notEqual`에 걸린다).
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapDocument.test.ts` → `does not provide an export named 'mapDraftSteps'`(파일 전체).
- [ ] **Step 3: `mapDocument.ts`의 타입과 읽는 함수** — `./mapEditSession.ts`의 값 import에 `MAP_HISTORY_LIMIT`을 더한다. `MapDraft`를 설계 3.2의 꼴로(`dropped: number`와 그 주석). `MapDocumentAction`의 `drop-drafts` 줄 다음에 `| { type: 'rebase-drafts'; maps: readonly BackgroundMap[] }`와 `| { type: 'follow-saved'; maps: readonly BackgroundMap[] }`. 지금의 `mapDraftChanged`(주석 포함)를 설계 3.2의 두 함수로 바꾼다: `export function mapDraftSteps(draft: MapDraft | undefined): number`(= `dropped + past.length`, 초안이 없으면 0), `export function mapDraftChanged(draft: MapDraft | undefined): boolean`(지금 식에 `|| draft.dropped > 0`).
- [ ] **Step 4: 초안을 만드는 함수 셋** — 지금의 `function openDraft(` 자리에(`function dropDrafts(` **앞**에, 이 차례로) 설계 4.1의 글자 그대로: `function freshDraft(map: BackgroundMap): MapDraft`(저장 안 한 것이 없는 초안), `function openDraft(state, map)`(`freshDraft`를 쓰게 고친 것 — 서명 그대로), `function rebaseDrafts(state: MapDocumentState, maps: readonly BackgroundMap[], only?: (draft: MapDraft, map: BackgroundMap) => boolean): MapDocumentState`(초안이 **있는** 도면만, `only`를 지난 것만 새 초안으로. 할 일이 없으면 같은 상태. 바뀌는 초안 위의 제스처·칸 편집만 끝낸다). 순서가 계약이다(앵커 50이 `function freshDraft(` → `function openDraft(`, `function rebaseDrafts(` → `function dropDrafts(`로 자른다).
- [ ] **Step 5: 단계를 넣는 두 곳** — `function withDraft(` 앞에 설계 3.2의 `function commitDraft(draft: MapDraft, next: BackgroundMap, entry?: BackgroundMap): MapDraft`(기록이 가득 찬 채 한 단계가 더 들어오면 `dropped`가 하나 는다). 리듀서의 `update` 가지의 `commitMapHistory(draft, action.map)`과 `gesture-finish` 가지의 `commitMapHistory(draft, value, historyEntry)`를 `commitDraft(…)`로 바꾼다(인자 그대로). `mapEditSession.ts`는 고치지 않는다.
- [ ] **Step 6: 두 액션** — `case 'drop-drafts':` 가지 다음에 설계 4.1 블록 끝의 `case 'rebase-drafts':` 가지(두 줄 — `rebaseDrafts(state, action.maps)`를 돌려준다)와 설계 4.4의 `case 'follow-saved': { … }` 블록 전체(주석 포함). 세 조건(`!mapDraftChanged(draft)`, `state.gesture?.mapId !== map.id`, `map.revision > (draft.baseRevision ?? Infinity)`)과 없어진 도면의 줄(`!known.has(id) && !mapDraftChanged(followed.drafts[id]) && followed.gesture?.mapId !== id`)을 한 글자도 바꾸지 않는다. 그 가지에서 `dropDrafts(`를 부르지 않는다.
- [ ] **Step 7: `useBackgroundMapDocument.ts`** — 타입 `BackgroundMapDocument`의 `dropDrafts` 줄 다음에 `/** After a save: each saved map that has a draft goes on from what was saved. A map without a draft gets none. */` `rebaseDrafts(maps: readonly BackgroundMap[]): void;`와 `/** A draft with nothing unsaved in it follows the library: on to a newer revision of its map, or away with a map that is gone. */` `followSaved(maps: readonly BackgroundMap[]): void;`, `actions`의 `dropDrafts:` 줄 다음에 `rebaseDrafts: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'rebase-drafts', maps }),`와 `followSaved: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'follow-saved', maps }),`. **`dropDrafts`는 아직 둔다**(`persistMaps`가 쓴다 — Task 4가 뺀다).
- [ ] **Step 8:** `node --test tests/backgroundMapDocument.test.ts` → tests 47 / pass 47. `node --test tests/backgroundMapEditSession.test.ts tests/backgroundMapWorkflow.test.ts` → 12 / pass 12(그대로).
- [ ] **Step 9:** `npm run typecheck` → 오류 없음.
- [ ] **Step 10:** `npm run test:background` → tests 549, fail 0, skipped 5.
- [ ] **Step 11: 커밋** — 세 파일 / `배경 도면 다-1: 초안의 '바뀜'을 기록에서 밀려난 단계까지 세고, 저장 뒤 다시 놓기·따라가기 액션을 문서 리듀서에 더한다`

**v1.134.0과 달라지는 것(되살리지 말 것):** '바뀜'이 `past.length > 0`만이 아니다 — 51번 넘게 고치고 끝까지 되돌린 도면의 트리 점이 꺼지지 않는다(예전에는 꺼졌고, 값은 저장된 것과 달랐다). **고친 기존 테스트의 핀은 위의 둘(D-7의 한 줄, D-8의 목록)뿐이다** — `mapDraftChanged`의 다른 기대는 하나도 바뀌지 않는다.
**이 Task가 끝나면 편집기는:** 그 밖에는 v1.134.0과 같다(새 액션을 부르는 곳이 없다).

### Task 2: `savedMaps`와 띠의 상태를 정하는 `mapEditStatus.ts`

**Files:**
- Create: `src/features/backgrounds/mapEditStatus.ts`, `tests/backgroundMapEditStatus.test.ts`
- Modify: `src/features/backgrounds/mapWorkflow.ts`
- Test: `tests/backgroundMapWorkflow.test.ts`

**Read first:** 설계 3.1 전부(코드 블록, 문구의 규칙 셋, "순서가 뜻이다"), 3.3의 상태 표, 4.1의 `savedMaps` 코드 블록, 11.1 전부(표 열 줄과 그 위아래 문단), 11.3의 W-1·W-2, 16절의 '저' · `mapWorkflow.ts`의 `MapSaveCommand`·`mapSaveWasApplied`·`saveMapChanges` · `tests/backgroundMapWorkflow.test.ts`의 `'도면 연결과 초안 저장은 …'`(`applyBackgroundCommand(snapshot, command, { canManage: true })`와 `mapSaveWasApplied`를 함께 쓰는 본보기).

- [ ] **Step 1: 작업 흐름 테스트 둘**(`tests/backgroundMapWorkflow.test.ts`, import에 `savedMaps`) — **W-1** `'savedMaps: 저장이 끝난 도면은 명령의 값에 그 저장이 준 버전을 얹은 것이다'`: `expectedRevision`이 1·7·`null`인 도면 셋의 명령 → `revision`이 2·8·1(새 도면 `null`은 1), 나머지 값은 `deepEqual`로 그대로다. **W-2** `'savedMaps의 버전 셈은 저장 계약과 복구 판정의 셈과 같다'`: 초안을 실은 `saveMapChanges`의 명령과 새 도면(`expectedRevision: null`)을 실은 `createMapAndConnect`의 명령 각각에 대해, `applyBackgroundCommand(snapshot, command, { canManage: true })`가 만든 스냅샷의 그 도면들이 `savedMaps(command)`와 깊은 비교로 같고 `mapSaveWasApplied(그 스냅샷, command)`가 참이다.
- [ ] **Step 2: 상태 테스트 둘**(새 파일) — 초안은 리듀서로 만든다(`reduceMapDocument`·`createMapDocument`·`mapDraft`: 방금 엶 / 1번 고침 / 12번 고침 / 60번 고치고 50번 되돌림. 7번 줄만 손으로 만든 `{ value, baseRevision: null, past: [], future: [], dropped: 0 }`).
  - `'the band shows one of four phases: the ten rows of the table, each compared whole'`: **자료는 설계 11.1의 표 열 줄을 그대로 옮긴다**(줄마다 초안·`saving`·`justSaved`와 기대 객체의 일곱 값 `phase`·`changed`·`steps`·`detail`·`canSave`·`saveLabel`·`announce`. 3번 줄의 기대는 2번 줄과, 10번 줄의 기대는 4번 줄과 같은 객체다). 줄마다 `assert.deepEqual(mapEditStatus(draft, saving, justSaved), expected, '#번호')` — 값의 일부만 견주지 않는다. 빠뜨리면 안 되는 값: 1번 `'clean'`·`'저장된 그대로예요'`·`announce ''`, 2번 `'저장 안 한 변경 1개'`·`announce ''`, 4번 `'saving'`·`detail`과 `saveLabel` 둘 다 `'저장 중…'`·`announce '도면을 저장하는 중이에요'`, 6번 `'saved'`·`'도면을 저장했어요'`(announce도 같다), 7번 `changed true`인데 `steps 0`·`'아직 저장한 적 없는 도면이에요'`, 9번 `steps 10`.
  - `'the wording: the label, how long the notice stays, and a clean band that never begins like an unsaved one'`: `MAP_EDIT_LABEL === '편집 중'`, `MAP_SAVED_NOTICE_MS === 4000`, 깨끗함의 `detail`이 `'저장 안 한'`으로 시작하지 않는다.
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/backgroundMapEditStatus.test.ts` → `ERR_MODULE_NOT_FOUND … mapEditStatus.ts`. `node --test tests/backgroundMapWorkflow.test.ts` → `does not provide an export named 'savedMaps'`.
- [ ] **Step 4: `mapWorkflow.ts`** — `mapSaveWasApplied` 다음, `export function effectiveMaps(` **앞**에 설계 4.1의 `export function savedMaps(command: MapSaveCommand): BackgroundMap[]`(주석 포함. 명령의 도면마다 `revision: (expectedRevision ?? 0) + 1`). 자리가 계약이다(앵커 50이 `export function savedMaps(` → `export function effectiveMaps(`로 자른다).
- [ ] **Step 5: `mapEditStatus.ts`** — 설계 3.1의 코드 블록 전체를 글자 그대로(LF): `MapEditPhase`, `MapEditStatus`, `MAP_EDIT_LABEL`, `MAP_SAVED_NOTICE_MS`, `export function mapEditStatus(draft: MapDraft, saving: boolean, justSaved: boolean): MapEditStatus`. 가지의 순서(저장 중 > 바뀜 > 방금 저장함 > 깨끗함)와 문구를 바꾸지 않는다.
- [ ] **Step 6:** 두 파일을 각각 `node --test` → 작업 흐름 8 / pass 8, 상태 2 / pass 2.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** `npm run test:background` → tests 553, fail 0, skipped 5.
- [ ] **Step 9: 커밋** — 네 파일 / `배경 도면 다-1: 띠가 보일 것을 정하는 순수 함수(mapEditStatus)와, 저장이 끝난 도면을 명령에서 만드는 savedMaps`

**이 Task가 끝나면 편집기는:** Task 1과 같다(새 함수를 아직 쓰지 않는다).

### Task 3: 띠의 색 — `mapEditColor.ts`

**Files:**
- Create: `src/features/backgrounds/mapEditColor.ts`, `tests/backgroundMapEditColor.test.ts`

**Read first:** 설계 7.1 전부(코드 블록 64줄과 그 아래 불릿), 7.2, 7.3의 표(열두 줄), 7.4의 두 표와 "훑어본 범위" 불릿들, 7.5의 표, 11.2의 C-0~C-8·C-11(**C-9·C-10은 Task 6**), 16절의 차·카·타·파·서·처·커·터 · `src/themes.ts`의 `THEME_PRESETS`(id는 `violet`·`cinema-red`·`midnight-blue`·`emerald`·`amber-gold`·`nameko`)·`getLightColors`·`hslToRgb`·`rgbToHex`·`deriveThemeFromAccent`(테스트가 `../src/themes.ts`로 읽는다. 고치지 않는다).

- [ ] **Step 1: 테스트를 쓴다(11.2)** — `test()` 열두 개, 이름을 `C-0: …`처럼 시작한다. **설계 11.2의 그 행을 옆에 두고 쓴다.** 아래는 빠뜨리면 안 되는 값이다.
  - **C-0 계산 자체**: `colorContrast([28, 22, 8], [245, 178, 64])` = 9.70 ± 0.01 · `colorContrast([255, 255, 255], [0, 102, 117])` = 6.65 ± 0.01 · 흰색 대 검정 = 21 · 인자를 바꿔도 같다 · `colorHue([245, 178, 64])` = 37.8 ± 0.05 · `[86, 204, 222]` → 187.9 ± 0.05 · `[220, 150, 255]` → 280.0 ± 0.05 · `[255, 0, 0]` → 정확히 0 · `hueDistance(350, 10)`·`(10, 350)` = 20, `(0, 180)` = 180 · `MAP_EDIT_MIN_CHROMA === 0.08`, `MAP_EDIT_MAIN_TONES === 2`, `MAP_EDIT_RESERVE_BELOW === 60` · `MAP_EDIT_TONES`의 `id`가 차례로 `amber`·`cyan`·`purple`.
  - **C-1 여섯 프리셋 × 두 화면**: `THEME_PRESETS`가 여섯이고 id가 위와 같음을 먼저 단언한다. 프리셋마다 `mapEditColors(colors.accent, colors.accentSub, colors.bgPrimary)`와 밝은 바탕 `getLightColors(id).bgPrimary`. **기대 열두 줄은 설계 7.3의 표의 `strip`·`ink` 열을 그대로 옮긴다**: `violet`·`midnight-blue`·`emerald`는 어두운 `245 178 64` / `28 22 8`, 밝은 `128 81 0` / `255 255 255`. `cinema-red`·`amber-gold`·`nameko`는 어두운 `86 204 222` / `6 28 34`, 밝은 `0 102 117` / `255 255 255`. 보조 강조색 자리에 강조색을 넣어도 열두 줄이 같다.
  - **C-2**: 같은 열두 줄에서 강조색·보조 강조색 **각각**까지 색상 거리 ≥ 70, 글자 : 띠 ≥ 6, 띠 : 바탕 ≥ 4.5, 띠 : 카드(`bgCard`) ≥ 4.5, 보라 없음.
  - **C-3 훑기 1(한 계열)**: 색상 0~359 × 채도 20·35·60·100 × 밝기 15·30·50·70·85의 강조색 7,200개(`hslToRgb`, 보조 = 강조) × 바탕 아홉(프리셋의 어두운 바탕 여섯, 밝은 바탕, `deriveThemeFromAccent(rgbToHex(강조색), rgbToHex(강조색), 'dark' | 'light')`의 바탕 둘 — 카드는 그 테마의 `bgCard`). **"색상이 있는가"와 강조색의 색상은 만든 쪽의 값으로 정한다**: 색상 = 넣은 `h`, `(1 − |2L − 1|) × S`가 **테스트가 따로 적은** 0.08 이상이면 색상이 있다(모듈의 `colorHue`로 정하지 않는다). 색상이 있으면 거리 ≥ 70(넣은 `h`에서 고른 띠의 색상 `colorHue(colorTriple(strip))`까지 — 그 계산은 C-0이 못 박았다)·글자 : 띠 ≥ 6·띠 : 바탕 ≥ 4.5·띠 : 카드 ≥ 4.5, 없으면(채도 20%의 밝기 15%·85%) 호박. 보라가 한 번도 없다.
  - **C-3b 훑기 2(두 계열)**: 강조색 × 보조 강조색의 색상 360 × 360(`hslToRgb(h, 100, 50)`), 바탕 `15 17 23`·`239 243 250`. 고른 띠의 색상이 두 색 **각각**에서 ≥ 45(색상은 넣은 값), 글자 : 띠 ≥ 6, 띠 : 바탕 ≥ 4.5. 보라를 고른 쌍이 있고(> 0), 보라를 고른 모든 쌍에서 호박·청록이 둘 다 가까운 테마 색에서 60 안이다. **거꾸로 검사**: 쌍마다 답을 테스트가 스스로 계산한다(모듈 함수 금지) — 후보 색상을 테스트에 따로 적고(`37.8`, `187.9`, `280.0`), 한 후보의 거리 = 넣은 두 색상 가운데 가까운 쪽까지. 호박·청록의 거리가 **둘 다 60 미만이고** 보라의 거리가 그 둘 가운데 큰 쪽보다 크면 답은 보라, 아니면 호박·청록 가운데 먼 쪽. 고른 `strip`이 그 후보의 두 톤 가운데 하나여야 한다. 건너뛰는 쌍: 호박 거리와 청록 거리의 차, 보라 거리와 (호박·청록 가운데) 큰 거리의 차, 그 큰 거리와 60의 차 가운데 하나라도 0.5 미만. 건너뛴 쌍이 전체의 3% 이하임을 함께 단언한다(이 계획을 쓸 때 설계 7.1의 블록을 글자 그대로 뽑아 이 문장대로 돌렸다: 259,200쌍 가운데 건너뜀 1.86%, 틀린 쌍 0, 가까운 쪽까지의 최소 46.0).
  - **C-3c 메인만 바꾼 서른 가지**: 프리셋 `P`의 `accentSub` × 다른 프리셋 `Q`의 `accent` 서른 가지 모두 두 색 각각에서 ≥ 45. 글자 그대로 넷: `amber-gold`의 보조색 + `midnight-blue`의 강조색 → 보라(어두운 `220 150 255` / 밝은 `134 46 178`), `nameko` 보조색 + `midnight-blue` 강조색 → 보라, `emerald` 보조색 + `cinema-red` 강조색 → 보라, `violet` 보조색 + `cinema-red` 강조색 → 청록.
  - **C-4 색상 없음**: `128 128 128`·`242 242 242`·`16 16 16`·`140 132 120`·`250 250 255`를 두 색 자리에 모두 넣으면 어느 바탕에서든 호박, `colorHue`는 그 다섯에 `null`, `129 77 65`에는 숫자. **문턱 바로 위** `140 130 119` → `colorHue` 31.4 ± 0.1이고 청록. 회색 강조색 + 보조색 `251 191 36` → 청록, 회색 강조색 + 보조색 `34 211 238` → 호박.
  - **C-5 두 후보의 가운데**: 채도 100%·밝기 50%의 색을 두 자리에 모두 넣어 110° → 청록, 116° → 호박, 290° → 호박, 296° → 청록. 넷 다 거리 ≥ 70이고 보라가 아니다.
  - **C-6 읽을 수 없는 입력**(설계의 가·나·다·라 네 묶음을 줄마다): (가) 세 인자 모두 `''` → 호박·밝은. (나) 두 색이 `'abc'`·`'1 2'`·`'300 0 0'`이고 바탕 `15 17 23` → 호박·밝은, 바탕 `239 243 250` → **호박·짙은**. (다) `108 92 231`·`162 155 254`에 바탕만 `''` → 호박·밝은. (라) 강조색 `''` + 보조색 `251 191 36` + 바탕 `239 243 250` → 청록·짙은. `colorTriple`이 `'108, 92, 231'`과 앞뒤 공백이 든 글자를 읽는다.
  - **C-7 톤**: 세 후보 모두 바탕 `15 17 23`에서 밝은 톤, `239 243 250`에서 짙은 톤(보라는 C-3c의 쌍으로 부른다). `mapEditColors.length === 3`(모드 인자가 없다).
  - **C-8 후보 표**: 여섯 톤 모두 빨강에서 ≥ 30, 채널 차 ≥ 0.4, 글자 : 띠 ≥ 6. 한 후보의 두 톤은 색상이 1 안. 이웃한 후보 사이의 간격 셋이 모두 ≥ 90이고 합이 360.
  - **C-11 순수 모듈**: `mapEditColor.ts`의 원문(주석 포함)에 `/^import\b/m`이 걸리지 않고(`source.includes('import')`로 묻지 않는다 — 머리 주석에 "no imports"가 있다) `document`·`window`·`getComputedStyle`이 없다. `mapEditStatus.ts`에 `/from\s+['"]three/`와 `/\b(?:document|window)\.\w/`가 걸리지 않는다.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapEditColor.test.ts` → `ERR_MODULE_NOT_FOUND … mapEditColor.ts`.
- [ ] **Step 3: `mapEditColor.ts`** — 설계 7.1의 코드 블록 전체를 글자 그대로(LF, 머리 주석 포함): `MapEditColors`, `MAP_EDIT_TONES`(열두 값), `MAP_EDIT_MAIN_TONES`, `MAP_EDIT_RESERVE_BELOW`, `MAP_EDIT_MIN_CHROMA`, `export function colorTriple(text: string): [number, number, number] | null`, `export function colorHue(rgb: readonly number[]): number | null`(채널 차가 0.08 미만이면 `null`), `export function hueDistance(a: number, b: number): number`, `export function colorContrast(a: readonly number[], b: readonly number[]): number`(WCAG), `export function mapEditColors(accent: string, accentSub: string, page: string): MapEditColors`(호박·청록 가운데 테마의 두 색에서 먼 쪽, 둘 다 60° 안이면 보라를 함께 본다, 색상이 없으면 호박, 바탕과 대비가 큰 톤). **수식과 값을 손으로 다시 치지 않는다 — 복사한다.**
- [ ] **Step 4:** `node --test tests/backgroundMapEditColor.test.ts` → 12 / pass 12(두 훑기 때문에 1~2초 걸린다).
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → tests 565, fail 0, skipped 5.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면 다-1: 띠의 색을 테마의 두 색과 화면 바탕에서 정하는 순수 함수(mapEditColor)와 그 기준 테스트`

**이 Task가 끝나면 편집기는:** Task 1과 같다.

---

## Chunk 2: 저장한 뒤에도 편집 중 (설계 14절 3단계)

### Task 4: `persistMaps`는 초안을 다시 놓고, `saveMap`은 바뀐 것이 있을 때만 겹치지 않게 저장한다

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/useBackgroundMapDocument.ts`
- Test: `tests/backgroundMapEditStatus.test.ts`(F-1~F-5), `tests/backgroundMapEditorWiring.test.ts`(앵커 50, 51의 편집기 쪽)

**Read first:** 설계 2.3, 4.1 전부(코드 블록, "왜 명령에서 만드는가", `await` 뒤에 써도 되는 것·안 되는 것, 표), 4.2 전부(두 코드 블록과 불릿 여섯), 4.3의 표(그 길들의 본문은 고치지 않는다), 9.3, I12, 10.2의 표, 11.3의 F-1~F-5, 11.4의 머리 두 문단과 50·51 행 · 편집기의 `async function persistMaps(`부터 `function enterNewMap(`까지, `async function saveMap(`부터 `async function confirmAction(`까지, `const [error, setError] = useState('');`, `const [busy, setBusy] = useState(false);`, `useEffect(() => { if (!snapshot.canManage) {`로 시작하는 줄, `{error && !confirmation && !createForm && !linkForm && !settingsForm && <div className="bg-error" role="alert">{error}</div>}` · `tests/backgroundStore.test.ts`의 `deferred`와 `'도면 묶음 저장은 응답을 잃어도 …'`(실제 저장소 `createBackgroundStore()` + `initialize('admin', { read, execute })`의 본보기) · 앵커 테스트의 `piece`·`block`·`inOrder`·`count`·`handler`.

- [ ] **Step 1: F-1~F-5를 쓴다**(`tests/backgroundMapEditStatus.test.ts`에 `test()` 다섯 개 — 실제 저장소 `createBackgroundStore`, 가짜 게이트웨이, 문서 저장소 `createMapDocumentStore`. 화면 없이 한솔의 답 1 전체다).
  - **F-1** `'F-1: a save, more edits and a second save go through when the draft is put back from the command'`: 버전 3의 도면 하나로 시작 → 편집 → 저장을 시작할 때의 스냅샷을 잡아 둔다 → `saveMapChanges` → `execute` → **잡아 둔 스냅샷의 버전은 여전히 3**(저장소는 4) → `rebase-drafts`에 `savedMaps(command)` → 초안의 값이 저장소의 도면과 깊은 비교로 같고 `baseRevision 4`·`mapDraftChanged false`·`viewports` 같은 객체 → 다시 편집 → 두 번째 저장 통과(버전 5) → 쓰기 두 번.
  - **F-2** `'F-2: a draft opened from the snapshot the handler still holds is refused on the next save'`: 잡아 둔 옛 스냅샷의 도면으로 연 초안의 저장은 `/다른 사용자가 내용을 변경했습니다/`로 거절된다.
  - **F-3** `'F-3: the echo of one's own save changes nothing'`: 저장·다시 놓기 뒤 저장소의 도면들로 `follow-saved` → 같은 상태 객체.
  - **F-4** `'F-4: following while a save runs would keep the values of a save that failed'`: 풀리지 않는 게이트웨이(`deferred`)로 깨끗한 초안 위의 설정 저장(이름을 바꾼 값)을 시작 → `pending` 동안 저장소의 버전이 +1(낙관 값) → 그때 `follow-saved`를 보낸 **사본** 문서의 초안은 `baseRevision` +1·새 이름·`mapDraftChanged false` → 저장을 실패시키면 저장소는 되돌아가고 사본의 초안은 그 틀린 값을 그대로 쥔다(편집기가 `disabled`일 때 부르지 않는 까닭의 기록).
  - **F-5** `'F-5: saving an untouched draft still writes and raises the revision'`: 손대지 않은 초안으로 만든 명령을 `execute`하면 쓰기 한 번, 버전 +1(그래서 편집기가 막는다).
- [ ] **Step 2: F 테스트를 돌린다** — `node --test tests/backgroundMapEditStatus.test.ts` → **7 / pass 7. 쓰자마자 통과하는 것이 기대다**(Task 1·2의 순수 모듈만 쓴다). 실패하면 Task 1·2의 구현이 설계와 다른 것이다 — 테스트를 맞추지 말고 멈추고 보고한다.
- [ ] **Step 3: 앵커 50·51을 쓴다** — `handler`에 `persistMaps: () => piece(editor, 'async function persistMaps(', 'function enterNewMap(')`와 `saveMap: () => piece(editor, 'async function saveMap(', 'async function confirmAction(')`(끝 표지는 **지금은** `confirmAction` — Task 10이 `function requestSave(`로 좁힌다).
  - **`anchor 50: a save never ends edit mode: every saved map that was being edited goes on from what the command saved`**: `persistMaps` 조각에 `await execute(command);` 다음에 `doc.rebaseDrafts(savedMaps(command));`. 그 조각의 `await execute(command);` **뒤쪽**에 `/\bsnapshot\b/`·`/\bcurrent\b/`·`/\bdraft\b/`·`doc.beginEditing`·`doc.enterNewMap`이 없다. 편집기 전체에 `dropDrafts`가 없고 `await persistMaps(`가 정확히 넷. `useBackgroundMapDocument.ts`에 `dropDrafts`가 없고 `type: 'rebase-drafts'`가 있다. `mapDocument.ts`의 `rebaseDrafts`(`function rebaseDrafts(` → `function dropDrafts(`)에 `!!draft &&`와 `freshDraft(map)`, `freshDraft`(`function freshDraft(` → `function openDraft(`)에 `past: [], future: [], dropped: 0`. `mapWorkflow.ts`의 `savedMaps`(`export function savedMaps(` → `export function effectiveMaps(`)에 `revision: (expectedRevision ?? 0) + 1`. `saveMap` 조각에 `setTool(`이 없다.
  - **`anchor 51: the map is saved only when something is unsaved and never twice at once, and a save that ends in a message brings the message into view`**(편집기 쪽 — 띠 쪽은 Task 6이 같은 `test()`에 더한다): `saveMap` 조각에 차례로 `if (!current || !draft || !canEdit || saving.current) return;` → `if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); setRefused(count => count + 1); return; }` → `if (!mapDraftChanged(mapDraft(doc.getState(), current.id))) return;` → `if (!current.name.trim()) {` → `const settled = settle()` → `saving.current = true; setBusy(true);` → `finally { saving.current = false; setBusy(false); }`. 그 조각에 `draftChanged`(소문자 d로 시작하는 낱말)가 없다. `setRefused(count => count + 1)`가 그 조각에 정확히 셋. 편집기에 `useEffect(() => { if (refused) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [refused]);`와 `<div className="bg-error" role="alert" ref={errorRef}>`.
- [ ] **Step 4: 실패를 확인한다** — `node --test tests/backgroundMapEditorWiring.test.ts` → 앵커 50·51만 실패(`not found: doc.rebaseDrafts(savedMaps(command));` 등), 나머지 49개 통과.
- [ ] **Step 5: 상태와 ref**(설계 4.2·10.2의 자리) — `./mapWorkflow` import에 `savedMaps`. `const [error, setError] = useState('');` 다음 줄에 설계 4.2의 두 줄 `const [refused, setRefused] = useState(0);`(그 위의 주석 포함)과 `const errorRef = useRef<HTMLDivElement>(null);`. `const [busy, setBusy] = useState(false);` 다음 줄에 `const saving = useRef(false);`. `useEffect(() => { if (!snapshot.canManage) { … } }, [snapshot.canManage]);` 줄 **바로 다음**에 `useEffect(() => { if (refused) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [refused]);`. 도면 위의 빨간 띠(위에 인용한 줄 — 확인 창 안의 `bg-error`가 아니다)의 `<div className="bg-error" role="alert">`에 ` ref={errorRef}`를 더한다(조건과 글자는 그대로).
- [ ] **Step 6: `persistMaps`** — 본문을 `await execute(command);` + 설계 4.1의 두 주석 줄 + `doc.rebaseDrafts(savedMaps(command));`로 바꾼다. **`const shown = current?.id;`와 `setSavedNotice` 줄은 넣지 않는다**(Task 11). `await` 뒤에서 클로저의 `snapshot`·`current`·`draft`를 읽지 않는다.
- [ ] **Step 7: `saveMap`** — 본문 전체를 설계 4.2의 첫 코드 블록 글자 그대로(주석 포함). 검사의 차례는 가드 → 그리다 만 다각형 → 바뀜(저장소에서 지금 읽는다) → 이름. `saving.current = true`는 일찍 돌아가는 검사들 **뒤**에서 켜고 `finally`에서 끈다. `setTool('select')`가 없다. `createMap`·`linkMap`·`saveSettings`·삭제 가지는 한 글자도 고치지 않는다.
- [ ] **Step 8: `useBackgroundMapDocument.ts`** — 타입의 `dropDrafts` 줄(그 주석 포함)과 `actions`의 `dropDrafts:` 줄을 뺀다. 리듀서의 `drop-drafts` 액션과 그 테스트는 그대로 둔다(`discard`가 같은 함수를 쓴다).
- [ ] **Step 9:** `node --test tests/backgroundMapEditorWiring.test.ts` → 51 / pass 51.
- [ ] **Step 10:** `npm run typecheck` → 오류 없음.
- [ ] **Step 11:** `npm run test:background` → tests 572, fail 0, skipped 5.
- [ ] **Step 12: 커밋** — 네 파일 / `배경 도면 다-1: 저장해도 편집이 이어진다 — persistMaps가 초안을 버리지 않고 명령에서 다시 놓고, saveMap은 바뀐 것이 있을 때만 겹치지 않게 저장한다`

**v1.134.0과 달라지는 것(되살리지 말 것):** ① **저장은 편집을 끝내지 않는다** — '도면 저장'뿐 아니라 '설정 저장'·'기존 도면 연결'·'연결 해제'·'내부 도면 만들기'가 함께 저장한 초안도 편집 중으로 남는다(예전에는 넷 다 `dropDrafts`로 버렸다). ② 저장 뒤 되돌리기 기록은 비워지고 **도구는 그대로다**(예전에는 `select`로 돌아갔다). ③ **손대지 않은 도면의 '도면 저장'은 쓰기를 내보내지 않는다**(예전에는 버전이 하나 올랐다). ④ 그리다 만 다각형 검사가 이름 검사보다 앞이다. ⑤ 저장이 문장으로 끝나면 그 빨간 띠를 화면 안으로 끌어온다. 고정한 기존 테스트의 핀은 없다(리듀서의 `'discarding and dropping saved drafts remove only the named maps'`는 그대로 통과한다).
**이 Task가 끝나면 편집기는:** 머리줄은 예전 그대로인데 저장해도 '취소'·'도면 저장'이 남고 배지가 '편집 중'으로 돌아간다(계속 편집 중). 깨끗한 초안이 아직 라이브러리를 따라가지 않는다 — Task 5가 채운다(둘 사이에 게이트는 없다).

### Task 5: 깨끗한 초안은 라이브러리를 따라간다

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 56)

**Read first:** 설계 I4, 4.4 전부(리듀서 블록, 편집기 블록, "창이 열려 있는 동안에는 따라가지 않는 까닭", "보던 도면이 없어졌을 때 비우는 것", "고른 점을 푸는 까닭", 경우 표), 15.4의 따라가기 불릿들, 10.2 표의 `followSaved` 행, 11.4의 56 행 · 편집기의 `useEffect(() => { if (!snapshot.canManage) {` 줄과 Task 4가 그 아래에 둔 `refused` effect, `const abortGesture = useEvent(`, `function navigate(`(무엇을 비우는지 — **고치지 않는다**), `const [activeVertex, setActiveVertex]`, `const [confirmation, setConfirmation]`·`createForm`·`linkForm`·`settingsForm`.

- [ ] **Step 1: 앵커 56을 쓴다** — **`anchor 56: only a draft with nothing unsaved follows the library, never during a save or under an open dialog, and a map that went away is left as on a move to another map`**. 조각은 `piece(editor, 'const followSaved = useEvent(() => {', 'const abortGesture = useEvent(')`. 그 안에 차례로: `if (disabled || doc.isGestureActive() || confirmation || createForm || linkForm || settingsForm) return;` → `const before = mapDraft(doc.getState(), current?.id);` → `doc.followSaved(snapshot.maps);` → `if (mapDraft(doc.getState(), current?.id) !== before) setActiveVertex(null);` → `if (before && !mapDraft(doc.getState(), current?.id)) { setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); }` → `useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, confirmation, createForm, linkForm, settingsForm]);`(여섯 줄 모두 **줄 전체**를 글자 그대로). `mapDocument.ts`의 `block(source, "case 'follow-saved': {")`에 `!mapDraftChanged(draft)`, `state.gesture?.mapId !== map.id`, `map.revision > (draft.baseRevision ?? Infinity)`, `!known.has(id) && !mapDraftChanged(followed.drafts[id]) && followed.gesture?.mapId !== id`가 있고 `dropDrafts(`가 없다.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapEditorWiring.test.ts` → 앵커 56이 `marker not found: const followSaved = useEvent(() => {`로 실패, 나머지 51개 통과.
- [ ] **Step 3: 구현** — `useEffect(() => { if (!snapshot.canManage) { … } }, [snapshot.canManage]);` 줄 **바로 다음**, Task 4의 `refused` effect **앞**에 설계 4.4의 편집기 블록 전체(주석 포함): `const followSaved = useEvent(() => { … });`(저장이 돌거나 끌기 도중이거나 편집기의 창 넷 가운데 하나가 열려 있으면 부르지 않는다. 보던 도면의 초안이 바뀌면 고른 점을 풀고, 없어지면 `navigate`가 비우는 것을 그 자리에서 비운다)와 그 `useEffect`(의존 목록에 창 넷 — 창이 닫힐 때 다시 돈다). `navigate`의 본문은 고치지 않는다.
- [ ] **Step 4:** `node --test tests/backgroundMapEditorWiring.test.ts` → 52 / pass 52.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → tests 573, fail 0, skipped 5.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면 다-1: 저장 안 한 편집이 없는 초안은 라이브러리를 따라간다 — 저장 중과 열린 창 아래에서는 하지 않고, 보던 도면이 없어지면 다른 도면으로 갈 때처럼 비운다`

**v1.134.0과 달라지는 것(되살리지 말 것):** 새 동작이다. 깨끗한 초안으로 편집 중인 화면은 다른 PC가 그 도면을 저장하면 그 모습으로 바뀌고(고른 다각형 점이 풀린다), 그 도면을 지웠으면 목록에서 빠지며 보고 있었다면 목록의 첫 도면으로 간다(찍던 다각형 점·도구·기호 목록·오류가 비워진다). **저장 안 한 편집이 있는 초안은 건드리지 않는다.** 확인·만들기·연결·설정 창이 열려 있는 동안에는 일어나지 않는다 — 그 가드를 빼면 응답을 잃은 삭제 뒤 다시 누른 '삭제'가 다른 도면을 지운다.
**이 Task가 끝나면 편집기는:** Task 4의 화면에 위의 따라가기가 더해졌다. 머리줄·배지는 아직 예전 것이다.

---

## Chunk 3: 띠와 배치 (설계 14절 4단계)

### Task 6: 띠 컴포넌트, 색 훅, CSS 전부

**Files:**
- Create: `src/features/backgrounds/BackgroundMapEditStrip.tsx`, `src/features/backgrounds/useMapEditColors.ts`
- Modify: `src/features/backgrounds/backgrounds-map.css`
- Test: `tests/backgroundMapEditColor.test.ts`(C-9·C-10), `tests/backgroundMapEditorWiring.test.ts`(앵커 54의 CSS·띠 파일 쪽, 55의 훅 파일 쪽, 51의 띠 쪽)

**Read first:** 설계 6.1 전부, 6.3, 6.4(바뀌는 두 줄과 `scroll-margin-top` 두 줄의 까닭), 6.5(세 줄과 불릿 넷), 6.6, 6.8 전부(**놓는 자리**, 코드 블록 36줄, '고치는 줄' 표, '지켜야 하는 것'), 6.9, 7.6 전부, R11, 11.2의 C-9·C-10, 11.4의 51·54·55 행 · `backgrounds-map.css`의 `.bmap-layout { display:flex; min-height:500px;`로 시작하는 첫 줄, `.bmap-draft-dot {` 줄, `.bmap-main {` 줄, `@media(max-width:1100px) { .bmap-gallery-grid {`로 시작하는 줄, `@media(max-width:900px) {` 블록(첫 줄 `  .bmap-layout { height:auto; min-height:0; }`), `@media(min-width:901px) {` 블록(세 줄) · `tests/backgroundMapElements.test.ts`의 `sheet`와 `'the road colours are variables of the map editor: …'`(`.bmap-layout {`로 시작하는 줄을 세는 기존 검사 — 그대로 통과해야 한다) · `BackgroundMapCameraColor.tsx`(`aria-disabled`로 흐리게 하는 선례).

- [ ] **Step 1: C-9·C-10을 쓴다**(`tests/backgroundMapEditColor.test.ts`, CSS는 `/\r?\n/`으로 줄을 나눠 읽는다) — **C-9**: `.bmap-layout { --bmap-edit:245 178 64; --bmap-edit-ink:28 22 8; --bmap-edit-h:40px; }` 줄이 정확히 하나 있고, 그 두 색이 `mapEditColors('108 92 231', '162 155 254', '15 17 23')`의 `strip`·`ink`와 같다. **C-10**(줄 맨 앞에서 시작하는 기본 규칙에서): `.bmap-edit-strip {` 줄에 `background:rgb(var(--bmap-edit))`와 `color:rgb(var(--bmap-edit-ink))`, `.bmap-main.is-editing .bmap-canvas-wrap::after {` 줄에 `border:2px solid rgb(var(--bmap-edit))`, `.bmap-draft-dot {` 줄에 `color:rgb(var(--bmap-edit))`, `.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {` 줄에 `background:rgb(var(--bmap-edit-ink))`와 `color:rgb(var(--bmap-edit))`. 그리고 **앞 공백을 뗀 뒤** `.bmap-edit`·`.bg-library .bmap-edit`·`.bmap-main.is-editing`·`.bmap-draft-dot`로 시작하는 모든 줄(변수 줄 `.bmap-layout { --bmap-edit:`은 들지 않는다)에 `/#[0-9a-fA-F]{3,8}\b/`, `/rgb\((?!var\(--bmap-edit)/`, `/(?<![\w-])(?:white|black)(?![\w-])/`, `/hsla?\(/`가 걸리지 않는다. 그런 줄이 하나도 없으면 실패하게 수를 먼저 단언한다.
- [ ] **Step 2: 앵커 54·55를 쓰고 51에 더한다** — 새 소스는 `read('BackgroundMapEditStrip.tsx')`·`read('useMapEditColors.ts')`로, CSS는 공통 규칙의 방법으로 줄 배열을 읽는다. **기본 규칙의 줄과 순서 검사의 네 줄은 줄 맨 앞에서, 미디어 블록 안의 줄은 앞 공백을 떼고 찾는다**(설계 11.4의 '줄을 찾는 법').
  - **`anchor 54: the band is one element for the plan and for 3D, stuck over the map at a height that never depends on what it says`**(CSS·띠 파일 쪽 — 편집기 쪽은 Task 7): ① 띠 파일에 `<section className="bmap-edit-strip" data-phase={status.phase}`와 `<p className="bmap-edit-state"><strong>{MAP_EDIT_LABEL}</strong><span>{status.detail}</span></p>`가 글자 그대로, `className="bmap-edit-key"`·`"bmap-edit-actions"`·`"bmap-edit-end"`·`"bmap-edit-save"`가 각각 정확히 한 번. ② `.bmap-edit-strip {` 줄에 `position:sticky`, `top:0`, `z-index:5`, `flex:0 0 var(--bmap-edit-h)`, `height:var(--bmap-edit-h)`. ③ `.bmap-edit-state {` 줄에 `white-space:nowrap`·`min-width:0`·`min-height:23px`, `.bmap-edit-state>span {` 줄에 `text-overflow:ellipsis`·`overflow:hidden`. ④ `.bmap-layout {`로 시작하는 **첫** 줄과 `.bmap-main {` 줄에 `overflow:clip`이 있고 `overflow:hidden`이 없다. ⑤ 테두리 줄이 `.bmap-main.is-editing .bmap-canvas-wrap::after {`로 시작하고 `content:""`·`inset:0`·`position:absolute`·`pointer-events:none`을 담는다. `.bmap-canvas-wrap {` 줄에 `border`가 없다. ⑥ 설계 6.5의 세 줄이 `@media(min-width:901px) {` 줄과 그 블록을 닫는 `}` 줄 사이에 있다. ⑦ **순서(줄 번호)**: `.bmap-layout { --bmap-edit:`·`.bmap-edit-strip {`·`.bmap-edit-state {`·`.bmap-edit-key {`로 시작하는 줄이 각각 하나씩이고 넷 다 `@media(max-width:900px) {` 줄보다 앞이다. ⑧ **좁은 창**: 그 `@media(max-width:900px) {` 줄과 닫는 `}` 줄 사이에 `.bmap-layout { height:auto; min-height:0; --bmap-edit-h:72px; }`, `.bmap-edit-strip { flex-wrap:wrap`으로 시작하는 줄, `.bmap-edit-state { flex:1 0 100%`로 시작하는 줄, `.bmap-edit-key { margin-left:auto`로 시작하는 줄. 파일 어디에도 `.bmap-edit-key { display:none`이 없다. `@media(max-width:1100px) { .bmap-edit-strip { padding-left:14px; } }` 줄이 기본 `.bmap-edit-strip {` 줄보다 뒤, `@media(max-width:900px) {` 줄보다 앞. ⑨ **상태의 모양**: `.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {` 줄에 `border-radius`와 `background:rgb(var(--bmap-edit-ink))`, `.bmap-edit-strip[data-phase="saved"] .bmap-edit-state>span::before {` 줄에 `content:"✓"`. ⑩ **저장 버튼**: `.bg-library .bmap-edit-strip .bmap-edit-save {` 줄에 `min-width:`·`font-weight:600`·`transition:none`. `.bg-library .bmap-edit-strip .bmap-edit-save[aria-disabled="true"],`로 시작하는 줄이 **정확히 하나**이고 `background:transparent`·`cursor:default`를 담으며 `font-weight`가 없다. ⑪ **가리는 포커스**: `.bmap-main.is-editing :is(button,input,select,summary) { scroll-margin-top:var(--bmap-edit-h); }`와 `.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }`가 줄 전체로 글자 그대로 있다.
  - **`anchor 55: the colours of the band come from the two accents of the theme and the page as they are on screen`**(훅 파일 쪽 — 편집기의 한 줄은 Task 7): `getComputedStyle(document.documentElement)`, **호출 전체** `mapEditColors(theme.getPropertyValue('--color-accent'), theme.getPropertyValue('--color-accent-sub'), theme.getPropertyValue('--color-bg-primary'))`, `root.style.setProperty('--bmap-edit', colors.strip)`, `root.style.setProperty('--bmap-edit-ink', colors.ink)`, **호출 전체** `observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] })`, `observer.disconnect()`. `document.documentElement.style.setProperty`와 `getAttribute`가 없다. `inOrder(source, 'apply();', 'new MutationObserver(apply)')`.
  - **앵커 51에 더한다**(띠 쪽): 띠 파일에 `const idle = !status.canSave || disabled;`, `aria-disabled={idle}`, `onClick={() => { if (!idle) onSave(); }}`, `title={status.canSave ? '도면 저장 (Ctrl+S)' : status.phase === 'saving' ? undefined : '저장할 변경이 없어요'}`가 글자 그대로 있고, 저장 버튼의 태그(`className="bmap-edit-save"`부터 그 뒤의 첫 `</button>`까지)에 ` disabled=`(앞에 공백)가 없다.
- [ ] **Step 3: 실패를 확인한다** — 색 테스트: C-9·C-10 실패(그 줄이 없다). 앵커 테스트: 51·54·55가 `ENOENT`(띠·훅 파일이 아직 없다 — 51의 새 부분도 띠 파일을 읽는다)로 실패한다. 새 소스는 `test()` **안에서**(또는 부를 때 읽는 함수로) 읽어 다른 앵커가 함께 쓰러지지 않게 한다 — 나머지 51개는 통과.
- [ ] **Step 4: `BackgroundMapEditStrip.tsx`** — 설계 6.1의 코드 블록 전체를 글자 그대로(LF): `export function BackgroundMapEditStrip({ status, disabled, onEnd, onSave }: { status: MapEditStatus; disabled: boolean; onEnd(): void; onSave(): void }): JSX.Element`. 받은 것만 그린다. '도면 저장'은 `disabled`가 아니라 `aria-disabled`로 흐리고, 흐릴 때의 클릭은 아무 일도 하지 않는다.
- [ ] **Step 5: `useMapEditColors.ts`** — 설계 7.6의 코드 블록 전체를 글자 그대로(LF): `export function useMapEditColors(rootRef: RefObject<HTMLElement>): void`. `useLayoutEffect` 안에서 `<html>`의 계산된 스타일의 변수 셋을 읽어 넘겨받은 요소에 쓰고(같은 값은 다시 쓰지 않는다), `<html>`의 `data-color-mode`·`class`·`style`을 관찰한다. **처음의 `apply();`를 빼지 않는다.**
- [ ] **Step 6: CSS**(CRLF 그대로, 규칙 하나가 한 줄) — 일곱 곳:
  1. 첫 줄 `.bmap-layout { display:flex; … }`의 `overflow:hidden` → `overflow:clip`.
  2. `.bmap-draft-dot { … }`의 `color:#eab76b` → `color:rgb(var(--bmap-edit))`.
  3. `.bmap-main { … }`의 `overflow:hidden` → `overflow:clip`. **그 줄 바로 다음 줄부터** 설계 6.8의 코드 블록 전체(주석 줄 `/* Edit mode: a band over the map …`부터 `@media (prefers-reduced-motion: no-preference) {` 블록을 닫는 `}`까지 **36줄**)를 글자 그대로. **파일의 끝에 붙이지 않는다**(좁은 창의 덮어쓰기와 특이도가 같아 뒤에 오는 쪽이 이긴다).
  4. `@media(max-width:900px) {` 줄 **바로 앞**에 한 줄: `@media(max-width:1100px) { .bmap-edit-strip { padding-left:14px; } }`
  5. 900px 이하 블록의 첫 줄 `  .bmap-layout { height:auto; min-height:0; }` → `  .bmap-layout { height:auto; min-height:0; --bmap-edit-h:72px; }`
  6. 그 줄 바로 다음에 세 줄(두 칸 들여쓰기): `.bmap-edit-strip { flex-wrap:wrap; align-content:center; row-gap:6px; }` · `.bmap-edit-state { flex:1 0 100%; }` · `.bmap-edit-key { margin-left:auto; }`
  7. `@media(min-width:901px) {` 블록의 기존 세 줄 **뒤**에 설계 6.5의 네 줄(두 칸 들여쓰기): 주석 한 줄(`/* While editing the band takes its height from the image list, not from the map: the canvas keeps its size as edit mode starts and ends. */` — 설계 블록의 "(기존 세 줄 뒤에) "는 놓을 자리를 적은 말이라 옮기지 않는다)과 규칙 셋.
  - 지켜야 하는 것(설계 6.8): `@keyframes` 둘은 `no-preference` 블록 **밖**, 두 `animation` 선언은 그 블록 **안**에만. `backdrop-filter`·무한 반복 없음. `[tabindex]`를 `scroll-margin-top`의 대상에 넣지 않는다. 띠·테두리·점의 규칙에 색을 직접 적지 않는다(변수 줄 하나만 예외).
- [ ] **Step 7: 자가 점검** — `git diff --numstat src/features/backgrounds/backgrounds-map.css` → `48	4	…`(더한 줄 36 + 1 + 3 + 4 + 고친 줄 4, 지운 줄은 고친 줄 4). `git ls-files --eol`이 여전히 `w/crlf`. 덩어리가 한 번만 들어갔는지: `grep -c '^\.bmap-edit-strip {' src/features/backgrounds/backgrounds-map.css` → 1, `grep -c '^@keyframes bmap-edit' …` → 2.
- [ ] **Step 8:** `node --test tests/backgroundMapEditColor.test.ts` → 14 / pass 14. `node --test tests/backgroundMapEditorWiring.test.ts` → 54 / pass 54. `node --test tests/backgroundMapElements.test.ts` → 그대로 통과.
- [ ] **Step 9:** `npm run typecheck` → 오류 없음.
- [ ] **Step 10:** `npm run test:background` → tests 577, fail 0, skipped 5. `npm run test:motion` → tests 619 / pass 619 / fail 0.
- [ ] **Step 11: 커밋** — 다섯 파일 / `배경 도면 다-1: 편집 상태 띠 컴포넌트와 색 훅, 띠·테두리·좁은 창·도면 크기 보정의 CSS`

**v1.134.0과 달라지는 것(되살리지 말 것):** `.bmap-layout`·`.bmap-main`이 `overflow:clip`이다(`hidden`으로 되돌리면 띠가 붙지 않는다). 트리의 '저장 안 한 점'의 색이 고정 `#eab76b`가 아니라 변수다. **고친 기존 테스트의 핀은 없다** — `tests/backgroundMapElements.test.ts`의 `.bmap-layout {`로 시작하는 줄 검사는 `--bmap-road`·`--bmap-cam:`을 담은 줄만 세므로 새 변수 줄(따로 한 줄)에 걸리지 않는다.
**이 Task가 끝나면 편집기는:** Task 5와 같게 보인다. 띠와 훅은 아직 어디에도 이어져 있지 않고(새 규칙은 걸리는 요소가 없다), 트리의 점만 CSS의 기본값(`245 178 64` — 기본 테마의 호박)으로 그려진다.

### Task 7: 띠를 편집기에 잇는다 — `is-editing`, 띠 줄, 머리줄에서 `취소`·`도면 저장`·배지 빼기

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 54의 편집기 쪽, 55의 편집기 줄)

**Read first:** 설계 6.1의 "편집기에서 그리는 줄"과 그 아래 불릿, 6.2 전부, 6.7의 표(이 Task는 `취소`·`도면 저장`·배지·점의 풍선까지 — '편집 시작'은 Task 9), 7.6의 "편집기에서" 줄, 14절 4단계 전부(임시 핸들러와 이 단계의 화면), 11.4의 54·55 행 · 편집기의 `const rootRef = useRef<HTMLDivElement>(null);`, `<span className="bmap-draft-dot" title="저장 전 변경사항">●</span>`, `: <main className="bmap-main">`(둘째 가지 — 도면이 없을 때의 `<div className="bmap-main">`은 그대로다), `{editing && <span className="bmap-badge">`, `<div className="bmap-actions">` 줄 전체, `{notice && <div className="bmap-notice" role="status">` 줄, `<BackgroundMapPanels gallery={gallery}>`.

- [ ] **Step 1: 앵커 54·55에 더한다** — **54**: 편집기에 `<BackgroundMapEditStrip`이 정확히 한 번, `{editing && draft && <BackgroundMapEditStrip `의 꼴이고, 그 자리가 `<BackgroundMapPanels gallery={gallery}>`보다 앞이며 `{mode === 'plan' ? <svg ref={svgRef}`보다 앞이다. 편집기에 `` bmap-main${editing ? ' is-editing' : ''} ``를 담은 `<main className={…}>` 줄이 있다. **55**: 편집기에 `useMapEditColors(rootRef);`가 정확히 한 번.
- [ ] **Step 2: 실패를 확인한다** — 앵커 54·55가 실패, 나머지 52개 통과.
- [ ] **Step 3: import와 훅 호출** — `import { BackgroundMapEditStrip } from './BackgroundMapEditStrip';`, `import { mapEditStatus } from './mapEditStatus';`(`MAP_SAVED_NOTICE_MS`는 Task 11), `import { useMapEditColors } from './useMapEditColors';`. `const rootRef = useRef<HTMLDivElement>(null);` **다음 줄**에 `useMapEditColors(rootRef);`. 뿌리 줄의 시작 `<div className="bmap-layout" ref={rootRef} `는 그대로다(앵커 28).
- [ ] **Step 4: `.bmap-main`과 띠 줄** — 둘째 가지의 `<main className="bmap-main">`을 `` <main className={`bmap-main${editing ? ' is-editing' : ''}`}> ``로. 안내 줄(`{notice && …}`) 다음, `<BackgroundMapPanels gallery={gallery}>` 앞에 **이 단계의 임시 꼴**로 한 줄: `{editing && draft && <BackgroundMapEditStrip status={mapEditStatus(draft, pending, false)} disabled={disabled} onEnd={() => { setError(''); setConfirmation('discard'); }} onSave={() => void saveMap()} />}`(`canEdit`에 달지 않는다. `onEnd`는 Task 8이, `onSave`는 Task 10이, `false`는 Task 11이 바꾼다).
- [ ] **Step 5: 머리줄과 배지, 점의 풍선** — 제목 옆의 `{editing && <span className="bmap-badge">{draftChanged ? '저장 전 변경사항' : '편집 중'}</span>}`를 통째로 뺀다(`.bmap-badge` 규칙과 다른 두 곳의 배지는 그대로 둔다). `.bmap-actions` 줄의 `{editing ? <>…취소…도면 저장…</> : <button …>공간 편집</button>}`을 `{!editing && <button type="button" className="bg-button bg-primary" disabled={disabled} onClick={() => { beginEditing(); setInspectorOpen(true); }}>공간 편집</button>}`로(편집 중의 두 버튼은 띠로 갔다. '공간 편집' 버튼의 글자는 Task 9가 바꾼다). 트리 점의 `title="저장 전 변경사항"` → `title="저장 안 한 변경이 있어요"`(조건 `mapDraftChanged(mapDraft(state, map.id)) &&`는 그대로).
- [ ] **Step 6: 자가 점검** — `grep -oF "setConfirmation('discard')" …Editor.tsx | wc -l` → 1(띠의 임시 `onEnd` 하나). `grep -c "저장 전 변경사항" …Editor.tsx` → 0.
- [ ] **Step 7:** `node --test tests/backgroundMapEditorWiring.test.ts` → 54 / pass 54.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → tests 577, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 10: 커밋** — 두 파일 / `배경 도면 다-1: 편집 중에는 도면 위에 띠와 테두리 — 띠를 편집기에 잇고 머리줄의 취소·도면 저장·배지를 뺀다`

**v1.134.0과 달라지는 것(되살리지 말 것):** 편집 중에 띠와 테두리가 생긴다. **`취소`·`도면 저장`이 머리줄에서 띠로 옮겨 갔고**('취소'의 이름은 '편집 끝내기'), **제목 옆 배지('편집 중' / '저장 전 변경사항')가 없어졌다.** **'도면 저장'은 저장할 것이 없으면 흐리다**(풍선 '저장할 변경이 없어요'). 트리 점의 풍선이 띠와 같은 말이고 색이 테마에 따라 계산된다. 그 글자들을 고정한 기존 테스트는 없다. **배치도 달라진다(`is-editing`이 붙는 이 Task부터 — 게이트 A의 E3·L3·L4·E10이 재는 것이고, 일부러 그런 것이다. 설계 6.4·6.5):** 편집을 시작하면 도면 크기는 그대로이고 이미지 목록이 40px 짧아진다(901px 이상. 창이 낮거나 1440×900의 3D처럼 이미 스크롤하던 화면은 `.bmap-layout`의 최소 높이가 40px 늘어 — 500 → 540, 3D 760 → 800 — 목록 대신 탭이 40px 더 스크롤하고, 900px 이하에서는 페이지가 72px 길어진다). 편집을 시작하고 끝낼 때 도면이 그만큼(40px / 72px) 오르내리고, 손잡이로 최대치까지 늘려 둔 도면은 최대 40px 줄어든다. 탭이 스크롤된 채 Tab으로 닿아 끌려 온 칸·버튼은 맨 위가 아니라 띠 바로 아래에 선다(`scroll-margin-top`).
**이 Task가 끝나면 편집기는(게이트 A가 보는 화면):** 띠·테두리·색·배치는 완성이다. 임시인 것 셋 — 머리줄에 보라색 '공간 편집'이 남아 있고(편집 중에는 사라진다), 띠의 '편집 끝내기'는 바꾼 것이 없어도 **늘 묻고**(창의 글은 예전 것), 저장하면 "저장 중…"에서 곧바로 "저장된 그대로예요"가 된다('방금 저장함'이 없다). Ctrl+S는 아직 없다.

### 게이트 A — 띠·테두리·배치·색·스크롤 (Task 7 뒤 · **오케스트레이터가 한다. Task 작업자는 앱을 띄우지 않는다**)

방법은 설계 12절 머리말 그대로다(`npm run dev:renderer` + `npm run preview:electron`, Electron 33, 1440×900과 740×900, 어두운·밝은 화면).

- **보는 것**(설계 14절 4단계): **E1~E5**(E4는 깨끗함·바뀜 9·10·100개·저장 중의 높이와 폭, 그리고 깨끗함 → 바뀜 → 저장 중 → 깨끗함과 바뀜 → 모두 되돌림 동안 `Ctrl+S` 표시와 두 버튼의 `left`·`top`까지 — '방금 저장함'은 게이트 B) · **E10** · **S2·S3**(깨끗함과 바뀜이 25%로 줄인 화면에서 갈리는가 — 여덟 쌍. S2의 머리줄 쪽은 게이트 B) · **C1~C3·C5b·C9·C10** · **L1~L4**.
- **멈추고 한솔에게 묻는 것 둘**(설계 15.1·15.2 — 대체안으로도 안 되면 뺀 채로 넘어가지 않는다): **E1** 띠가 탭의 맨 위에 붙지 않을 때(띠와 `.bg-tab-content` 사이에 `overflow`가 `visible`·`clip`이 아닌 조상이 남았는지 먼저 본 뒤에도. 붙지 않는 띠나 `overflow:hidden`으로 되돌린 채로 내지 않는다) / **C9·C10** 테두리를 3px로 굵게 해도 같은 색상의 표시(청록 테마의 기호·청록 카메라, 호박 테마의 카메라·3D의 카메라 시점 표시)와 섞여 보일 때.
- **대체안과 그것이 바꾸는 글자**(설계 15.2의 표 — 쓴 경우 소스와 그 글자를 읽는 앵커·테스트를 **같은 커밋에서** 맞춘다): E2 테두리가 3D 위에서 가려짐 → `z-index:4`, 그래도 안 되면 `.bmap-workspace`로 옮김(**앵커 54의 ⑤, C-10의 테두리 줄** — 둘 다 `.bmap-main.is-editing .bmap-canvas-wrap::after {`로 시작하는 줄을 찾는다. `no-preference` 블록의 테두리 `animation` 줄의 선택자도 같이 옮긴다) · E3 도면이 줄어듦 → 이미지 목록의 식(6.5의 줄 — **앵커 54의 ⑥**) · E4·L2 한 줄에 넘침 → 띠의 세 줄과 `--bmap-edit-h:72px`를 따로 둔 `@media(max-width:960px)` 블록으로(**앵커 54의 좁은 창 검사**) · E5 색이 한 박자 늦음 → `apply`를 `requestAnimationFrame` 한 번 뒤로(**앵커 55의 `inOrder`**) · E10의 (가) 칸이 여전히 띠에 가림 → 받아들이고 완료 보고에 적는다 · E10의 (나) → 빼는 줄을 지우고 첫 줄 끝에 `:not(.bmap-edit-strip *)`(**앵커 54의 ⑪**) · E10의 (다) 도면을 누를 때 화면이 움직임 → **먼저 가린다**: 개발 도구에서 `scroll-margin-top` 두 줄을 끄고 같은 자리에서 같은 누름을 되풀이한다. **끄면 멈출 때만** 그 두 줄을 뺀다(**앵커 54의 ⑪**, 그리고 Task 13이 `AGENTS.md`에 적을 그 문장 — 결과 줄에 적는다). 꺼도 움직이면 지금도 있는 동작이다 — 규칙은 두고, 본 자리와 움직인 양을 결과 줄에 적는다(완료 보고의 '따로 고칠 일': `focus({ preventScroll: true })`) · C1~C3·C5b 색값 → `MAP_EDIT_TONES`와 CSS 기본값 한 줄(**C-0·C-1·C-3c·C-9**, 이웃 간격 90°는 지킨다) · C9·C10 → 테두리 `border:3px`(**C-10**) · S3 갈리지 않음 → `.bmap-edit-strip[data-phase="changed"] { box-shadow:inset 0 -3px 0 rgb(var(--bmap-edit-ink)); }` 한 줄을 알약 줄 앞에(**앵커 54의 ⑨**) · ✓가 네모로 나옴 → 테두리로 그린 체크(**앵커 54의 ⑨**) · 알약이 띠의 높이를 넘음 → 알약의 위아래 여백 1px(`.bmap-edit-state`의 `min-height:23px`는 그대로 — 앵커 없음) · `sr-only`의 글자가 보임(저장 중의 "도면을 저장하는 중이에요") → 설계 15.2의 한 줄로 바꾸고 클래스를 뺀다(**Task 11의 앵커 57이 찾을 띠 파일 줄이 바뀐다 — 결과 줄에 적는다**) · 들어올 때의 움직임이 모드 전환(평면 ↔ 3D)·저장에 다시 돎 → `no-preference` 블록의 두 규칙과 `@keyframes` 둘을 뺀다(앵커 없음) · 흐린 저장 버튼의 글자가 읽기 어려움 → 글자색 투명도 .78(앵커 없음). **여기 적은 것은 요약이고 설계 15.2의 표가 기준이다** — 표에만 있는 가지(가로 넘침은 넘치는 요소의 `min-width:0`, 클릭 뒤의 포커스 고리, 1,231~1,310px의 도구줄, E3의 '고칠 수 없으면 받아들이고 보고', E4의 '옮기지 않는 것 셋'과 '새 블록도 기본 덩어리보다 뒤'·740의 버튼 좌우 여백, S3의 줄 두께 6px까지, C9·C10에서 색상을 옮기지 않음)는 표 그대로 한다.
- **결과 줄(오케스트레이터가 Task 8을 열기 전에 이 줄을 채워 커밋한다 — 날짜 · 본 항목과 결과 · 쓴 대체안과 그 커밋 · 뒤 Task가 따라야 하는 바뀐 글자 · 한솔에게 물은 것과 답. 대체안이 없으면 "대체안 없음"이라고 적는다):**
  - 게이트 A 결과: **2026-10-12 · HEAD 2e7b8f03 · Electron 33 화면 밖 검사 창(미리보기 계정, 실제 입력) · 1440×900·740×900(E4·L1은 901·900·1210·1231·1300·1310도) · 어두운·밝은 화면 · 콘솔 경고·오류 0.** **통과:** E1(평면·3D, 740·1440 — 띠가 탭 맨 위에 붙고 가로 스크롤 없음) · E2(네 변 2px, 3D와 곁의 평면에도, `pointer-events:none`, z 1 < 도구줄 2) · E3(평면 SVG 크기 같음 · 이미지 목록 40px 줄어듦 · 740은 72px · 3D는 스크롤 +40px) · E4('방금 저장함' 빼고 전부 — 901 이상 한 줄 40px, 900 이하 두 줄 72px, 9·10·105개 잘림 없음, 저장 중에 `편집 끝내기` 잠김, 세 앵커의 `left`·`top`이 어느 전환에서도 그대로. 사이드바를 펼친 폭에서도 같음) · E5(어두운 ↔ 밝은 즉시, 평면·3D) · E10 (나)·(다) · S2·S3(1 → 2 → 1 → 2, 모두 되돌림 → 깨끗함. 25% 여덟 쌍이 갈린다 — 가장 약한 쌍은 1440 어두운 화면. 3D 기즈모: 끄는 동안 띠가 그대로, 놓으면 +1, 1 → 2 → 되돌리기 둘 → 깨끗함) · C1~C3(설계의 값 그대로 — 보라·파랑·에메랄드는 호박 `245 178 64`/`128 81 0`, 빨강·호박 금·머쉬룸은 청록 `86 204 222`/`0 102 117`, 글자:띠 6.65~9.7, 띠:바탕 5.98~10.4) · C5b(보라 `220 150 255`/`134 46 178`) · C9·C10(어두운·밝은, 평면·3D·카메라 시점 — 테두리 2px 그대로) · L1(1210·1231·1300은 도구줄 두 줄, 1310부터 한 줄, 띠는 한 줄) · L2 · L3(오류 문장이 없으면 잘림 0, 한 줄짜리 오류 문장 42.1px이 떠 있으면 23.2px. 최소 높이 500 → 540 확인 — 설계의 "20px"은 어림이었고 지키는 것은 "v1.134.0보다 더 잘리지 않는다"라서 통과로 본다. 설계 6.5와 L3 행의 문구를 이 커밋에서 고쳤다) · L4(최대 높이 443 → 403, 이미지 목록 160px, 끝내면 돌아옴). **받아들이고 완료 보고에 적는 것(15.2대로):** E10 (가) — 스크롤 상자 밖의 칸은 포커스가 가면 띠 아래에 놓이지만, 이미 상자 안에 있으면서 붙어 있는 띠에 가려진 칸은 포커스로 밀려 나오지 않는다. **적어 둘 것:** 3D 캔버스가 편집 중에 3px 짧다(도구줄이 41 → 44px — v1.134.0에도 있던 것, 띠와 무관) · 검사 창에는 포인터 붙잡기가 없어 기즈모를 놓는 이벤트가 끄는 동안 뜨는 치수 표시에 떨어진다 — 빈 곳을 한 번 눌러 끝냈다(실제 앱은 TransformControls가 포인터를 붙잡는다). **쓴 대체안: 대체안 없음. 뒤 Task가 따라야 하는 바뀐 글자: 없음. 한솔에게 물은 것: 없음**(S3의 화면과 테마 색 화면은 완료 보고에서 보여 준다).

---

## Chunk 4: 버튼과 나가기 (설계 14절 5단계)

### Task 8: '편집 끝내기' — 잃을 것이 없으면 묻지 않는다

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 52)

**Read first:** **게이트 A의 결과 줄**(비어 있으면 시작하지 않고 보고한다. 바뀐 글자가 적혀 있으면 그 글자를 쓴다) · 설계 5.1 전부(두 코드 블록과 불릿 여덟), 5.2 전부(표와 코드), I9·I10, 9.2의 `savedNotice` 선언 한 줄, 11.4의 셋째 문단("`savedNotice` 상태는 5단계에서 선언한다")과 52 행, 10.2 표의 `leaveEditing`·`endEditing` 행 · 편집기의 `function beginEditing(`부터 `function undo(`까지, `confirmAction`의 `if (confirmation === 'discard') {` 가지, 띠 줄(Task 7), 확인 창의 줄(`{confirmation && current && <BackgroundModal title={confirmation === 'discard' ? '도면 편집을 취소할까요?'`로 시작), `const focusAfterConfirm = useRef(false);`와 그 effect(읽기만).

- [ ] **Step 1: 앵커 52를 쓴다** — **`anchor 52: edit mode ends without a question only when nothing would be lost`**. `handler`에 `leaveEditing: () => piece(editor, 'function leaveEditing(', 'function endEditing(')`, `endEditing: () => piece(editor, 'function endEditing(', 'function undo(')`, 띠 줄 `strip: () => piece(editor, '<BackgroundMapEditStrip ', '/>')`.
  - `endEditing` 조각에 차례로 `if (!current || !editing || disabled) return;` → `abortGesture();` → `if (mapDraftChanged(mapDraft(doc.getState(), current.id)) || polygon.length) { setError(''); setConfirmation('discard'); return; }` → `leaveEditing(); focusCanvas();`. 그 조각에 `future`가 없다.
  - `leaveEditing` 조각에 `doc.discard(current.id);`, `setPolygon([])`, `setSavedNotice(null)`.
  - `block(handler.confirmAction(), "if (confirmation === 'discard') {")`에 `leaveEditing();`과 `focusAfterConfirm.current = true; setConfirmation(null); return;`.
  - 편집기 전체에 `setConfirmation('discard')`가 정확히 한 번.
  - 띠 줄에 `onEnd={endEditing}`과 `disabled={disabled}`. 띠 파일에 `<button type="button" className="bmap-edit-end" disabled={disabled} onClick={onEnd}>편집 끝내기</button>`가 글자 그대로.
  - 편집기에 제목의 식 `confirmation === 'discard' ? (draftChanged ? '저장하지 않고 편집을 끝낼까요?' : '편집을 끝낼까요?')`와 글의 식 `confirmation === 'discard' ? (draftChanged ? '이 도면에서 저장 안 한 변경은 사라져요.' : '그리던 다각형이 사라져요.')`가 글자 그대로, `'버리고 끝내기'`가 있고, `도면 편집을 취소할까요?`·`저장하지 않은 변경사항`·`변경사항 버리기`라는 글자가 편집기에 없다(**따옴표 없이 찾는다** — 지금의 글은 `'이 도면에서 저장하지 않은 변경사항은 사라집니다.'`라 따옴표째 찾으면 고치기 전에도 걸리지 않는다. 이 Task 뒤에는 셋 다 편집기 어디에도 없다).
- [ ] **Step 2: 실패를 확인한다** — 앵커 52가 `marker not found: function leaveEditing(`으로 실패, 나머지 54개 통과.
- [ ] **Step 3: `savedNotice` 선언** — `const saving = useRef(false);` 다음 줄에 설계 9.2의 주석과 `const [savedNotice, setSavedNotice] = useState<{ mapId: string } | null>(null);`. **선언만이다** — 타이머 effect·켜는 줄·읽는 곳은 Task 11(읽는 곳이 없어도 typecheck는 통과한다: `noUnusedLocals`가 꺼져 있다).
- [ ] **Step 4: 두 함수** — **`function beginEditing(` 다음, `function undo(` 앞**에 설계 5.1의 `function leaveEditing()`(지금 보는 도면의 초안을 버리고 그리다 만 점·도구·오류·저장 알림을 비운다)과 `function endEditing()`(저장 안 한 편집이나 그리다 만 다각형이 있으면 묻고 — 저장소에서 지금 읽는다 — 없으면 곧바로 끝내고 포커스를 캔버스로)을 주석까지 글자 그대로. `beginEditing` **앞**에 두지 않는다(`placeSymbol` 조각이 `function beginEditing(`에서 끝난다).
- [ ] **Step 5: 띠의 `onEnd`** — 띠 줄의 `onEnd={() => { setError(''); setConfirmation('discard'); }}`를 `onEnd={endEditing}`으로(`leaveEditing`을 바로 잇지 않는다 — 저장 안 한 편집이 묻지 않고 사라진다).
- [ ] **Step 6: 버리기 가지와 창의 문구** — `confirmAction`의 `if (confirmation === 'discard') { … }` 본문을 설계 5.1의 둘째 블록으로(`leaveEditing();` + `focusAfterConfirm.current = true; setConfirmation(null); return;`). 확인 창의 줄에서 제목·글·버튼의 `discard` 쪽만 설계 5.2의 세 식으로 바꾼다(`delete-map`·`delete-group`·`delete-node` 쪽은 한 글자도 고치지 않는다).
- [ ] **Step 7:** `node --test tests/backgroundMapEditorWiring.test.ts` → 55 / pass 55.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → tests 578, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 10: 커밋** — 두 파일 / `배경 도면 다-1: '편집 끝내기'는 잃을 것이 없으면 묻지 않는다 — leaveEditing·endEditing과 버리기 확인 창의 문구`

**v1.134.0과 달라지는 것(되살리지 말 것):** **'취소'가 '편집 끝내기'가 됐고, 바꾼 것이 없으면(모두 되돌린 뒤 포함) 묻지 않고 끝난다**(예전에는 늘 물었다). 저장 안 한 변경이 있거나 그리다 만 다각형이 있으면 묻는다 — 제목 "저장하지 않고 편집을 끝낼까요?"(다각형만 있을 때 "편집을 끝낼까요?"), 글과 버튼('버리고 끝내기')도 바뀌었다. 끝낸 뒤 포커스가 캔버스로 간다. 그 글자들을 고정한 기존 테스트는 없다(앵커 29가 읽는 `delete-group` 가지는 그대로다).
**이 Task가 끝나면 편집기는:** 띠의 두 버튼이 설계대로 움직인다. 머리줄의 보라색 '공간 편집'과 옛 안내 글은 아직 남아 있다(Task 9).

### Task 9: 조용한 '편집 시작', 안내 글 셋, '연결 해제'의 포커스

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/BackgroundMapGallery.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 58)

**Read first:** 설계 6.7 전부(두 표, 두 코드 블록, 불릿), I11, 4.3의 "'연결 해제'의 포커스" 문단과 코드 한 줄, R4, 11.4의 58 행 · 편집기의 `.bmap-actions` 줄(Task 7의 `{!editing && <button … >공간 편집</button>}`), `<div className="bmap-canvas-empty">` 줄의 `'도면 편집에서 공간·문·사물·카메라를 배치할 수 있습니다.'`, `onClick={() => void linkMap(null, selected.id)}>연결 해제</button>` · `BackgroundMapGallery.tsx`의 `'공간 편집에서 이 카메라에 배경 시점을 연결해 주세요.'`와 `'도면 설정이나 공간 편집에서 배경 장소를 연결하면 여기에 모입니다.'` · CSS의 `.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }`(Task 6에서 들어갔다).

- [ ] **Step 1: 앵커 58을 쓴다** — **`anchor 58: the header keeps a quiet 편집 시작 in its place, and the words name a button only to those who see it`**(이미지 목록은 `read('BackgroundMapGallery.tsx')`).
  - 편집기에 `>편집 시작</button>`이 정확히 한 번. 그 버튼의 태그에 `className="bg-button bmap-edit-start"`(그 태그에 `bg-primary`가 없다), `disabled={disabled || editing}`, `aria-hidden={editing || undefined}`, `onClick`에 `beginEditing(); setInspectorOpen(true); focusCanvas();`. `>도면 설정</button><button type="button" className="bg-button bmap-edit-start"`가 이어져 있다(갈림 안에 있지 않다).
  - CSS에 `.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }` 줄이 글자 그대로 있고 그 줄에 `display:none`이 없다.
  - 편집기와 이미지 목록 파일에 `공간 편집에서`·`도면 편집에서`·`>공간 편집<`이 없고, `.bmap-actions` 줄(`<div className="bmap-actions">`부터 그 줄의 끝까지)에 `>취소</button>`이 없다.
  - 이미지 목록 파일에 `도면을 편집하면서`가 정확히 둘이고 `편집 시작`이 없다. 편집기에 `snapshot.canManage ? "'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다." : '관리자가 공간을 배치하면 여기에 표시됩니다.'`가 글자 그대로.
  - 편집기에 `저장 전 변경사항`과 `편집 중`이라는 글자가 없다(따옴표의 꼴과 무관하게 — 문구는 `mapEditStatus.ts`에 있다). 트리의 점 줄이 `mapDraftChanged(mapDraft(state, map.id)) && <span className="bmap-draft-dot" title="저장 안 한 변경이 있어요">●</span>`다.
  - '연결 해제' 버튼의 `onClick`이 `() => { focusCanvas(); void linkMap(null, selected.id); }`다.
- [ ] **Step 2: 실패를 확인한다** — 앵커 58이 실패(`>편집 시작</button>`이 없다), 나머지 55개 통과.
- [ ] **Step 3: 머리줄의 버튼** — `{!editing && <button … >공간 편집</button>}`을 갈림 없이 설계 6.7의 버튼으로(**한 줄로** — 설계 블록의 줄바꿈은 읽기 좋게 접은 것이다): `<button type="button" className="bg-button bmap-edit-start" disabled={disabled || editing} aria-hidden={editing || undefined} onClick={() => { beginEditing(); setInspectorOpen(true); focusCanvas(); }}>편집 시작</button>`. 자리는 지금 그대로(`snapshot.canManage &&` 안, '도면 설정' 바로 다음). 편집 중에는 DOM에서 빼지 않고 감춘다.
- [ ] **Step 4: 빈 도면의 안내** — 그 `<span>`을 설계 6.7의 줄로: `{editing ? '도형을 고르고 빈 곳을 드래그하거나 밑그림을 올려보세요.' : snapshot.canManage ? "'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다." : '관리자가 공간을 배치하면 여기에 표시됩니다.'}`(버튼 이름의 작은따옴표가 든 문자열만 큰따옴표로 싼다).
- [ ] **Step 5: 이미지 목록의 두 글**(`BackgroundMapGallery.tsx`, LF) — `'공간 편집에서 이 카메라에 배경 시점을 연결해 주세요.'` → `'도면을 편집하면서 이 카메라에 배경 시점을 연결해 주세요.'`, `'도면 설정이나 공간 편집에서 배경 장소를 연결하면 여기에 모입니다.'` → `'도면 설정에서, 또는 도면을 편집하면서 공간에 배경 장소를 연결하면 여기에 모입니다.'`. 그 파일에 `editing`을 넘기지 않고 버튼 이름을 쓰지 않는다. "현재 공간 편집 내용도 함께 저장됩니다."(편집기)는 그대로 둔다.
- [ ] **Step 6: '연결 해제'의 클릭** — 그 버튼의 `onClick={() => void linkMap(null, selected.id)}`를 `onClick={() => { focusCanvas(); void linkMap(null, selected.id); }}`로. `linkMap`의 본문은 고치지 않는다.
- [ ] **Step 7:** `node --test tests/backgroundMapEditorWiring.test.ts` → 56 / pass 56.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → tests 579, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 10: 커밋** — 세 파일 / `배경 도면 다-1: 조용한 '편집 시작'은 편집 중에도 자리를 지키고, 안내 글은 버튼이 보이는 사람에게만 그 이름을 말한다`

**v1.134.0과 달라지는 것(되살리지 말 것):** **'공간 편집' → '편집 시작'**: 보라색이 아니라 테두리만 있는 버튼이고, 편집 중에는 자리를 지킨 채 보이지 않는다(빼면 '도면 설정'이 포인터 밑으로 밀려와 더블클릭이 설정 창을 연다). '편집 시작'·'연결 해제'를 누른 뒤 포커스가 캔버스로 간다. 안내 글 셋이 옛 버튼 이름을 말하지 않고, 읽기 전용 계정의 빈 도면 안내는 "관리자가 공간을 배치하면 여기에 표시됩니다."다. 그 글자들을 고정한 기존 테스트는 없다.
**이 Task가 끝나면 편집기는:** 보기 모드의 머리줄은 `속성 접기` · `도면 설정` · `편집 시작`, 편집 중에는 띠가 그 일을 한다. 남은 것은 Ctrl+S와 저장 알림이다.

---

## Chunk 5: Ctrl+S와 저장 알림 (설계 14절 6·7단계)

### Task 10: Ctrl+S — 창 단위에서 듣고, 치던 값을 먼저 확정한다

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 53, `saveMap` 조각의 끝 표지)

**Read first:** 설계 2.5, 8.1, 8.2 전부(코드 블록, 표, 불릿), 8.3 전부(`requestSave`와 표, 조합 중의 근거), R10, 10.2 표의 `openDialogs`·`onSaveKey`·`requestSave` 행, 11.4의 53 행 · 편집기의 `const spaceEntry = …` 줄, `const onSpaceKey = useEvent(`부터 그 effect의 끝 `}, [onSpaceKey]);`까지(본보기 — **고치지 않는다**), 그 다음의 `// A press the canvas did not take …` effect, `async function saveMap(`의 끝과 `async function confirmAction(`, 띠 줄, `function keyboard(`(읽기만 — S를 넣지 않는다).

- [ ] **Step 1: 앵커 53을 쓰고 표지를 좁힌다** — `handler.saveMap`의 끝 표지를 `'function requestSave('`로 바꾸고(앵커 50·51이 그대로 통과해야 한다), `requestSave: () => piece(editor, 'function requestSave(', 'async function confirmAction(')`와 `onSaveKey: () => piece(editor, 'const onSaveKey = useEvent(', 'useEffect(')`를 더한다. **`anchor 53: Ctrl+S is heard on the window, passes its guards, commits the field being typed in and saves`**:
  - `onSaveKey` 조각에 차례로(줄 전체) `if (event.code !== 'KeyS' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;` → `if (!root || root.offsetParent === null || !editing) return;` → `if (createForm || linkForm || settingsForm || confirmation || document.querySelector(openDialogs)) return;` → `if (element && element !== document.body && !element.closest('.bg-library')) return;` → `if (element?.closest(textFields) && !root.contains(element)) return;` → `event.preventDefault(); event.stopPropagation();` → `if (event.repeat) return;` → `requestSave();`. 그 조각에 `closest('dialog')`·`closest(textEntry)`·`isComposing`·`229`가 없다.
  - 편집기에 `const openDialogs = 'dialog[open], [aria-modal="true"]';`, `window.addEventListener('keydown', onSaveKey, true);`, `window.removeEventListener('keydown', onSaveKey, true);`.
  - `requestSave` 조각에 차례로 `if (!current || !canEdit || saving.current || pointerRef.current || doc.isGestureActive()) return;` → `focusCanvas();` → `void saveMap();`.
  - `handler.keyboard()`에 `'KeyS'`와 `=== 's'`가 없다. 띠 줄에 `onSave={requestSave}`.
- [ ] **Step 2: 실패를 확인한다** — 앵커 50·51이 `marker not found after "async function saveMap(": function requestSave(`로(표지를 좁혔기 때문이다), 53이 `marker not found: const onSaveKey = useEvent(`로 실패한다 — 구현하면 셋 다 통과한다. 나머지 54개 통과.
- [ ] **Step 3: 모듈 상수** — `const spaceEntry = …` 줄 **다음 줄**에 `const openDialogs = 'dialog[open], [aria-modal="true"]';`(앵커 13·28이 고정한 선택자 상수들의 글자는 그대로다. 설계 블록의 줄 끝 주석 `// 모듈 상수: spaceEntry(:89) 다음 줄`은 놓을 자리를 적은 말이라 옮기지 않는다).
- [ ] **Step 4: 핸들러와 리스너** — Space의 effect(`}, [onSpaceKey]);`로 끝나는 `useEffect`) **바로 다음**, `// A press the canvas did not take …` effect **앞**에 설계 8.2의 `const onSaveKey = useEvent((event: KeyboardEvent) => { … });`와 그 `useEffect`를 주석까지 글자 그대로(가드의 차례가 뜻이다: 키 → 보이고 편집 중 → 열린 창은 상태와 문서에 묻는다 → 배경 화면 밖의 포커스는 넘긴다 → 편집기 밖의 글자 칸은 넘긴다 → 삼킨다 → 반복은 버린다 → 저장). `onSpaceKey`와 그 effect **사이**, Alt의 effect **안**에 두지 않는다. `keyboard()`에 S를 넣지 않는다.
- [ ] **Step 5: `requestSave`** — **`saveMap` 다음, `confirmAction` 앞**에 설계 8.3의 `function requestSave()`(주석 포함: 저장 중·끌기 도중이면 아무것도 하지 않고, 포커스를 캔버스로 보내 치던 값을 확정한 뒤 `saveMap`을 부른다). `confirmAction` **뒤**에 두지 않는다(`confirmAction` 조각이 `async function createMap(`에서 끝난다).
- [ ] **Step 6: 띠의 `onSave`** — 띠 줄의 `onSave={() => void saveMap()}`를 `onSave={requestSave}`로.
- [ ] **Step 7:** `node --test tests/backgroundMapEditorWiring.test.ts` → 57 / pass 57.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → tests 580, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 10: 커밋** — 두 파일 / `배경 도면 다-1: Ctrl+S로 저장 — 창 단위에서 듣고, 열린 창과 배경 화면 밖의 포커스에는 넘기고, 치던 값을 먼저 확정한다`

**v1.134.0과 달라지는 것(되살리지 말 것):** **Ctrl+S가 편집 중인 도면을 저장한다**(예전에는 아무 일도 하지 않았다). 포커스가 칸·버튼에 있거나 아무 데도 없어도 듣고, 보기 모드·읽기 전용·다른 탭·열린 창·배경 화면 밖의 포커스에서는 삼키지도 않는다. **한글 조합 중에도 저장한다**(조합 중을 막다른 길로 두지 않는다). '도면 저장' 버튼과 Ctrl+S는 포커스를 캔버스로 옮긴다 — 저장할 것이 없을 때도 옮긴다(쓰기는 나가지 않는다). 편집 중에는 사용자가 Ctrl+S에 묶어 둔 앱 단축키가 나가지 않는다.
**이 Task가 끝나면 편집기는:** 저장 알림만 빼고 설계의 동작 전부다(저장하면 "저장 중…"에서 곧바로 "저장된 그대로예요").

### Task 11: 저장했다는 알림 — 띠 안에서 4초

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 57)

**Read first:** 설계 9.1, 9.2 전부(코드 블록과 불릿), 4.1의 `persistMaps` 코드 블록(이번에 `shown`과 알림 줄까지), 3.1의 표("세 입력을 편집기가 주는 값"), I8, 15.4의 "저장이 끝나는 순간의 사이 렌더" 불릿, 11.4의 57 행 · 편집기의 `persistMaps`(Task 4의 꼴), `const [savedNotice, setSavedNotice]`(Task 8), 따라가기 effect와 `refused` effect(Task 4·5), 띠 줄, `import { mapEditStatus } from './mapEditStatus';`.

- [ ] **Step 1: 앵커 57을 쓴다** — **`anchor 57: a save is told inside the band, for a moment`**:
  - `persistMaps` 조각에 `const shown = current?.id;`가 `await execute(command);` **앞**에 있고, `if (shown && command.maps.some(item => item.entity.id === shown) && mapDraft(doc.getState(), shown)) setSavedNotice({ mapId: shown });`가 줄 전체로 있다.
  - 편집기에 차례로 `window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS)` → `return () => window.clearTimeout(timer);` → `}, [savedNotice]);`.
  - 띠 줄에 `savedNotice?.mapId === current.id`와 `mapEditStatus(draft, pending,`. 띠 파일에 `<span className="sr-only" role="status">{status.announce}</span>`.
  - 이 기능의 어느 `.tsx`에도(`readdirSync(directory)`) `sonner`가 없다. `persistMaps`·`saveMap` 조각에 `setNotice(`가 없다.
- [ ] **Step 2: 실패를 확인한다** — 앵커 57이 실패(`not found: const shown = current?.id;`), 나머지 57개 통과. (앵커 50은 계속 통과해야 한다 — `await` **뒤쪽**에 `\bcurrent\b`·`\bdraft\b`가 없다: `shown`은 `await` 앞에서 잡고, `mapDraft(`는 낱말 `draft`가 아니다.)
- [ ] **Step 3: import와 타이머** — `./mapEditStatus` import를 `import { MAP_SAVED_NOTICE_MS, mapEditStatus } from './mapEditStatus';`로. 따라가기 effect **다음**, `refused` effect **앞**에 설계 9.2의 타이머 effect(주석 포함. 저장할 때마다 새 객체라 4초부터 다시 돌고, 정리에서 타이머를 지운다 — 의존은 `[savedNotice]`). 그 세 effect의 차례는 따라가기 → 알림 타이머 → 까닭 끌어오기다(설계 10.2).
- [ ] **Step 4: `persistMaps`** — 본문을 설계 4.1의 코드 블록 전체로(`const shown = current?.id;`를 `await` **앞**에, 다시 놓기 다음에 알림 줄). 알림은 저장을 시작할 때 보던 도면이 명령에 들어 있고 그 도면에 초안이 있을 때만 켠다.
- [ ] **Step 5: 띠의 `justSaved`** — 띠 줄의 `mapEditStatus(draft, pending, false)`를 `mapEditStatus(draft, pending, savedNotice?.mapId === current.id)`로. 이제 띠 줄은 설계 6.1의 줄과 글자 그대로 같다: `{editing && draft && <BackgroundMapEditStrip status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id)} disabled={disabled} onEnd={endEditing} onSave={requestSave} />}`.
- [ ] **Step 6:** `node --test tests/backgroundMapEditorWiring.test.ts` → 58 / pass 58.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** `npm run test:background` → tests 581, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 9: 커밋** — 두 파일 / `배경 도면 다-1: 저장하면 띠가 4초 동안 "도면을 저장했어요"라고 알린다`

**v1.134.0과 달라지는 것(되살리지 말 것):** **저장한 뒤 알림이 생겼다** — 띠의 글자가 굵은 "✓ 도면을 저장했어요"가 되고 4초 뒤 "저장된 그대로예요"로 돌아간다(예전에는 아무 알림이 없었다). 토스트는 쓰지 않는다. '설정 저장'·'연결 해제'도 편집 중이었으면 같은 알림을 낸다. 다른 도면으로 옮겨 가는 저장('연결하고 열기', '만들고 들어가기')에서는 보이지 않는다.
**이 Task가 끝나면 편집기는(게이트 B가 보는 화면):** 설계의 동작 전부다.

### 게이트 B — 저장·나가기·키보드 (Task 11 뒤 · **오케스트레이터가 한다**)

- **보는 것**(설계 14절 7단계): **E6~E9**(E6은 **실제 한글 입력기로** — 손으로 치거나 CDP `Input.imeSetComposition`. 어느 쪽인지 적는다) · **E4의 나머지**('방금 저장함'의 높이·폭, 저장 중 → 방금 저장함 → 깨끗함 동안 `Ctrl+S` 표시와 두 버튼의 `left`·`top`) · **V1~V5·V7b** · **K1~K3·K7~K9** · **X1~X4·X8** · 게이트 A에서 미룬 **S1·S2의 머리줄 쪽**.
- **대체안과 그것이 바꾸는 글자**(설계 15.2): E6 `event.code`가 `KeyS`가 아님 → 조건에 `|| event.key.toLowerCase() === 's'`(**앵커 53의 첫 줄**) · E6 조합 중인 마지막 글자가 빠지거나 겹침 → `requestSave`의 `void saveMap();`을 `window.setTimeout(saveLatest, 0);`으로, `const saveLatest = useEvent(() => { void saveMap(); });`(**앵커 53의 `requestSave` 줄**). **어느 경우에도 "조합 중에는 아무 일도 하지 않는다"로 돌아가지 않는다.** `preventDefault`가 조합을 깨뜨리면 그 한 줄만 조합 중에 건너뛴다(**앵커 53의 "`isComposing`이 없다"**를 "조합 중에 `return`하지 않는다"로) · E9 감춘 버튼의 자리가 달라짐 → 그 버튼에 `min-width` · V7b `scrollIntoView`가 스크롤 상자 밖까지 움직임 → `rootRef.current.closest('.bg-tab-content')`의 `scrollTop`만 고치는 식(**앵커 51의 effect 줄**) · V1·S2 들어올 때의 움직임이 저장·모드 전환에 다시 돎 → `no-preference` 블록의 두 규칙과 `@keyframes` 둘을 뺀다 · `sr-only`의 글자가 보임 → 설계 15.2의 한 줄로 바꾸고 클래스를 뺀다(**앵커 57의 띠 파일 줄**) · V1 ✓가 네모로 나옴('방금 저장함'은 이 게이트에서 처음 보인다) → 테두리로 그린 체크(**앵커 54의 ⑨**). 이 가운데 게이트 A에서 이미 쓴 것은 그대로다. 여기 적은 것도 요약이고 설계 15.2의 표가 기준이다.
- **결과 줄(오케스트레이터가 Task 12를 열기 전에 채워 커밋한다 — 게이트 A와 같은 꼴. E6을 어느 방법으로 했는지 적는다):**
  - 게이트 B 결과: **2026-10-12 · HEAD 88c6e301 · Electron 33 화면 밖 검사 창(미리보기 계정, 실제 입력) · 1440×900·740×900(E4는 901·900도, 사이드바를 펼친 폭 포함) · 어두운 화면 · 콘솔 경고·오류 0.** **통과:** S1·S2의 머리줄 쪽(보기: `속성 접기`·`도면 설정`·테두리만 있는 `편집 시작`, 띠·테두리·배지 없음 / 편집 중: `편집 시작`이 `visibility:hidden`으로 자리를 지킴, `취소`·`도면 저장` 없음) · **E6 (가)(나) — CDP `Input.imeSetComposition`으로**('주'를 확정하고 '방'에 밑줄이 있는 채 Ctrl+S 한 번: `keydown`이 `code=KeyS`·`isComposing=true`로 오고, 이름이 정확히 `주방`·`거실`로 저장되어 새로 고침 뒤에도 같다 — 빠지지도 겹치지도 않음) · E7(`편집 시작`·`도면 저장`을 마우스로 누른 뒤 포커스가 도면에 있고 `+`·Delete가 클릭 없이 듣는다. `편집 끝내기` 뒤 `+`도) · E8(CDP로 `prefers-reduced-motion: reduce`, 그리고 앱의 '최소'가 다는 `html[data-motion-minimal]` — 띠와 테두리의 `animation-name`이 `none`, 알약과 ✓ 그대로) · E9(1440·740 — 더블클릭해도 설정 창이 뜨지 않고 `도면 설정`의 `left`가 같다. 끝내면 `편집 시작`이 같은 `left`에) · E4의 나머지(1440·901(사이드바 펼침, 본문 532px)·900·740(사이드바 펼침, 364px)·740 — 깨끗함 → 바뀜 → 저장 중 → 방금 저장함 → 깨끗함 동안 높이 40/72 그대로, 세 앵커의 `left`·`top` 한 가지, 잘림 0, 알림 4.0초) · V1(저장 중 … → "도면을 저장했어요" 4.01초 → 저장된 그대로. 라이브러리 머리줄의 '저장 중…', 도면·목록 크기 그대로) · V2(이어서 네 번 저장, 거절 없음, 새로 고침 뒤 값 같음) · V3(저장 뒤 두 버튼 꺼짐, 도면에서 Ctrl+Z 무반응) · V4(여러 개 선택과 묶음 버튼·확대와 보기·`화면 이동` 도구·3D 자세 그대로) · V5(저장 중에 끌리지 않음, 휠은 확대. 끄는 도중 Ctrl+S는 저장 호출 0이고 끌기가 이어짐) · V7b(740 평면: 맨 아래에서 Ctrl+S와 띠의 `도면 저장` 모두 탭이 올라와 빨간 띠가 맨 위, 그 아래 띠. 보이는 중에 다시 누르면 그대로 / 1440 3D: 저장을 실패시키면 빨간 띠가 화면 안, 초안·기록 그대로, 함수를 되돌리면 통과) · K1·K2(친 값 저장, 범위 밖은 한계 값 100000, 포커스가 도면으로)·K3(영문·한글 — 칸이 닫히고 저장)·K7(3D 저장, 기즈모를 끄는 도중은 저장 호출 0이고 끌기가 이어짐)·K8(보기 모드: 저장 호출 0)·K9(설정·버리기 확인·연결·배경 상세·업데이트 내역 창 — 안에서도, 포커스가 `body`에 놓인 채로도 저장 호출 0. 비밀번호 변경 창은 칸에서도 버튼에서도 0이고 포커스가 그 창에) · X1·X2·X4·X8(제목 "편집을 끝낼까요?"·"그리던 다각형이 사라져요.", `돌아가기` 뒤 점이 남아 이어서 찍힘, `버리고 끝내기` 뒤 점 없음). **게이트가 찾아 고친 것 셋(소스·앵커 52·설계 5.1을 같은 커밋에서):** ① 확인 창에서 누른 **Esc**가 창을 닫으면서 그리던 다각형의 점과 손에 든 도구까지 지웠다(창 안의 키가 편집기의 Escape 가지까지 올라온다. v1.134.0에도 있던 것 — `돌아가기`는 점을 남기는데 Esc는 지웠다) → Escape 가지의 둘째 줄 `if ((event.target as HTMLElement).closest('dialog')) return;`(e1488b4d). ② 기호 팔레트를 연 채 편집을 끝냈다 다시 시작하면 팔레트가 열려 있었다 → `leaveEditing`에 `setSymbolPaletteOpen(false)`(e1488b4d). ③ 바꾼 것 없이 `편집 끝내기`를 **더블클릭**하면 띠가 사라지며 올라온 것에 둘째 클릭이 닿았다 — 900px 이하의 두 줄 배치에서는 도면이라 고른 것이 풀리거나 다른 공간이 골라졌다 → `swallowSecondClick()`이 0.5초 동안 창 단위에서 누름을 멈춘다(88c6e301 — 고친 뒤 740·900·1440에서 고른 것 그대로, 0.5초 뒤의 클릭은 듣는다). **Task 12가 따라야 하는 것:** 설계 5.1의 두 코드 블록과 그 아래 불릿 셋이 위 커밋들에서 바뀌었다 — 11.4의 52 행에 변형 넷을 더한다(Esc 가드를 뺌 / `leaveEditing`에서 `setSymbolPaletteOpen(false)`를 뺌 / `endEditing`에서 `swallowSecondClick();`을 뺌 / `swallowSecondClick`이 리스너를 떼지 않음). **쓴 대체안(15.2):** E7의 "클릭 뒤 도면에 보이는 포커스 고리 → 받아들인다" 하나 — 도면에 포커스가 가면 엔진 기본의 주황색 고리가 보인다(보기 모드에서 도면을 눌러도 같은 고리다. v1.130.0부터). 그 밖의 대체안 없음, 앵커 53·51·57·54가 읽는 글자는 그대로다. **적어 둘 것:** X3 — 개발 미리보기는 `React.StrictMode`의 이중 effect 때문에 `BackgroundModal`의 "이전 포커스"가 창 안의 닫기 버튼으로 잡혀 `돌아가기`·Esc 뒤 포커스가 `body`로 간다(`showModal` 직전의 포커스가 `편집 끝내기`인 것은 기록으로 확인. 이 편집기의 모든 확인 창이 v1.134.0부터 같다) — 배포 빌드는 effect가 한 번이라 `편집 끝내기`로 돌아온다(코드로 확인, 한솔 PC 실기 항목). 그 `focus()`가 붙은 띠에서 화면을 움직이지 않는 것은 740에서 직접 불러 확인(스크롤 300 그대로) · E6 (다) — 한글 입력 상태는 자동 입력으로 만들 수 없다. 조건이 글쇠의 자리(`event.code === 'KeyS'`)라 입력 상태와 무관하다는 것까지 확인(실기 항목) · 버튼에 포커스가 있는 채의 Ctrl+Z는 편집기의 되돌리기가 아니라 엔진의 글자 되돌리기로 간다(v1.134.0과 같다 — `keyboard()`가 버튼에서 돌아 나온다). 저장 직후에도 그 길로 방금 친 칸의 값이 되돌아가 "저장 안 한 변경 1개"가 된다(띠는 사실대로 말한다) — 완료 보고의 '따로 고칠 일' · 저장 → 고침 → 되돌리기를 4초 안에 하면 "도면을 저장했어요"가 한 번 더 보인다(설계 9.2 그대로). **한솔에게 물은 것: 없음.**

---

## Chunk 6: 앵커·뮤테이션·마무리 (설계 14절 8·9단계)

### Task 12: 앵커 59와 뮤테이션 실행 — **표를 돌려주고, 판정하지 않는다**

**Files:**
- Modify: `tests/backgroundMapEditorWiring.test.ts`(앵커 59)
- 그 밖의 저장소 파일은 건드리지 않는다(뮤테이션은 저장소 밖 사본에만 넣는다)

**Read first:** **게이트 A·B의 결과 줄**(B가 비어 있으면 시작하지 않고 보고한다) · 설계 11.4 전부(표의 셋째 열 '잡아야 하는 변형', 그 아래 "앵커는 뮤테이션으로 확인한다" 문단, "살아남기 쉬운 변형 — 반드시 넣어 본다" 문단의 스물셋), 11.5 전부, 11.6 · 지금의 앵커 테스트 전체와 완성된 소스.

- [ ] **Step 1: 앵커 59를 쓴다** — **`anchor 59: the two new test files run in the build`**(무늬에 걸리는 이 오래된 파일 안에 둔다): `tests` 폴더(`new URL('./', import.meta.url)`)에 `backgroundMapEditStatus.test.ts`와 `backgroundMapEditColor.test.ts`가 있고, 각각 줄 맨 앞에서 시작하는 `test(`가 셋 이상이며(`/^test\(/gm`) `test.skip(`·`test.todo(`·`{ skip:`이 없다. `package.json`(`new URL('../package.json', import.meta.url)`)의 `scripts['test:background']`가 정확히 `node --test ./tests/background*.test.ts`이고, `scripts.build`와 `scripts['build:vite']`가 `npm run test:background`를 담는다.
- [ ] **Step 2:** `node --test tests/backgroundMapEditorWiring.test.ts` → 59 / pass 59(이 앵커는 쓰자마자 통과한다 — 그것이 실패하는 모습은 Step 5의 `A59` 변형이 보인다).
- [ ] **Step 3: 저장소 밖에 사본을 만든다** — 공통 규칙의 스크래치 자리 아래 새 폴더에, **같은 상대 경로로** 복사한다: `src/features/backgrounds/`의 파일 전부, `src/themes.ts`, `package.json`, `tests/`의 다섯 파일(`backgroundMapDocument`·`backgroundMapWorkflow`·`backgroundMapEditStatus`·`backgroundMapEditColor`·`backgroundMapEditorWiring` — `.test.ts`). `node_modules`는 복사하지도 잇지도 않는다. 상태 테스트는 `useBackgroundStore.ts`를 거쳐 `zustand`를 끌어오므로, 사본에 아래 두 파일을 만들어 **없는 패키지 이름만 저장소에서 찾게** 한다(복사·연결 없음):
  ```js
  // tools/hook.mjs
  import { pathToFileURL } from 'node:url';
  const repo = pathToFileURL(`${process.env.BFLOW_REPO}/package.json`).href;
  export async function resolve(specifier, context, next) {
    try { return await next(specifier, context); }
    catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || /^(?:\.|\/|file:|node:)/.test(specifier)) throw error;
      return next(specifier, { ...context, parentURL: repo });
    }
  }
  // tools/register.mjs
  import { register } from 'node:module';
  register('./hook.mjs', import.meta.url);
  ```
  사본의 뿌리에서 돌린다: `BFLOW_REPO='C:/Bflow-BGonly/.claude/worktrees/background-library-2d-3d-editor-a0ed8c' node --import ./tools/register.mjs --test tests/<file>.test.ts`.
- [ ] **Step 4: 기준선을 먼저 돌린다** — 변형을 넣기 **전에** 사본의 다섯 파일을 그대로 돌려 모두 통과함을 확인한다(문서 47 · 작업 흐름 8 · 상태 7 · 색 14 · 앵커 59 — 게이트에서 앵커가 늘었으면 그 수). 하나라도 실패하면 변형을 넣지 않고 멈추고 보고한다.
- [ ] **Step 5: 변형을 하나씩 넣고 기록한다** — 변형마다: 사본의 한 곳만 바꾼다 → 그 변형을 겨눈 테스트 파일을 돌린다 → 결과를 적는다 → **워크트리의 파일로 되돌린다**(다음 변형은 깨끗한 사본에서). 스크립트로 돌려도 된다(그 스크립트는 사본 폴더에 두고 커밋하지 않는다). 변형의 목록은 **설계 11.4에서 그대로 옮긴다**:
  - **A**(표의 셋째 열): 행마다 **괄호 밖의** ` / `로 나뉜 것을 각각 하나로 센다(56 행의 괄호 안 ` / ` 둘은 설명이다 — 그것까지 세면 13이 된다) — `A50-1…5`, `A51-1…10`, `A52-1…14`(게이트 B에서 더한 넷이 11~14다), `A53-1…12`, `A54-1…21`, `A55-1…8`, `A56-1…11`, `A57-1…5`, `A58-1…8`, `A59-1…2`. "…하거나 …"·"넷을 하나씩"·"…만, …만"처럼 한 항목에 꼴이 여럿이면 `a`·`b`…로 **따로** 돌린다(예: `A56-7a~d`는 가드에서 `confirmation`·`createForm`·`linkForm`·`settingsForm`을 하나씩).
  - **P**(순수 테스트의 표본, "순수 테스트도 표본을 뽑는다" 문단의 차례대로 `P-1…25`): `commitDraft`의 `dropped` 더하기를 뺌 / `rebaseDrafts`의 `!!draft &&`를 뺌 / `freshDraft`가 `future`를 남김 / `follow-saved`의 세 조건 각각 / `savedMaps`의 `+ 1`을 뺌 / 없어진 도면 줄의 세 조건 각각 / `mapEditStatus`의 가지 순서 바꾸기 둘 / 알림이 떠 있는 동안의 바뀜을 저장 중 검사보다 앞에서 따로 다룸 / `announce`에 수 / `changed: steps > 0` / 톤을 늘 밝은 쪽으로 / 가까운 쪽을 고름 / 색상 없음을 빨강으로 읽음 / 밝기 계산에서 감마를 뺌 / 문턱을 0.09로 / 보조 강조색을 보지 않음 / 예비색을 뺌 / 예비색을 대등하게 봄 / 예비색의 문턱을 55로 적음(상수는 60인 채) / 읽히지 않는 테마 색에 늘 밝은 톤.
  - **S**("살아남기 쉬운 변형" 스물셋, `S-1…23` — 둘로 나뉜 (15)·(17)·(18)·(21)은 `a`·`b`로 따로. (10)은 **테스트 쪽** 변형이다: D-8의 둘째 액션을 같은 버전의 `maps: [mapA, mapB]`로 바꾸면 그 테스트가 실패해야 한다).
  - **결과는 셋 가운데 하나로만 적는다**: `잡힘: "<실패한 test()의 이름>"`(그 변형을 겨눈 단언이 실패) / `살아남음`(겨눈 파일이 모두 통과) / `import 실패(세지 않음)`(`SyntaxError`·`ERR_MODULE_NOT_FOUND`·타입 제거 오류로 파일 전체가 쓰러짐 — **잡힌 것이 아니다.** 문법이 서는 꼴로 다시 넣어 본다. 그래도 안 되면 그 꼴과 함께 이 결과로 남긴다).
- [ ] **Step 6: 표를 돌려준다** — 완료 보고에 변형마다 한 줄: `ID | 바꾼 파일과 바꾼 것(한 줄) | 돌린 테스트 파일 | 결과`. 맨 위에 수를 적는다(넣은 변형 · 잡힘 · 살아남음 · import 실패). **작업자는 표를 판정하지 않는다**: 살아남은 것이 있어도 앵커·테스트·구현을 고치지 않고, "괜찮다"·"문제다"를 쓰지 않는다 — 게이트 M이 한다.
- [ ] **Step 7:** 사본 폴더를 지운다. `git status --short` → 앵커 테스트 한 파일뿐(변형이 워크트리에 새지 않았다).
- [ ] **Step 8:** `npm run typecheck` → 오류 없음. `npm run test:background` → tests 582, fail 0, skipped 5. `npm run test:motion` → 619 / fail 0.
- [ ] **Step 9: 커밋** — 한 파일 / `테스트: 배경 도면 다-1 앵커 59 — 새 테스트 파일 둘이 빌드에서 도는지 지킨다`

**이 Task가 끝나면 편집기는:** Task 11과 같다.

### 게이트 M — 뮤테이션 표의 판정 (Task 12 뒤 · **오케스트레이터가 한다**)

- 기준은 **표의 모든 줄이 `잡힘`**이다. `살아남음`마다: 설계 11.4의 그 행이 그 변형을 잡으라고 한 것이므로 **앵커(또는 그 순수 테스트)를 조인다 — 구현은 고치지 않는다**(설계 14절 8단계). 조인 뒤 그 변형과 기준선을 다시 돌려 `잡힘`·통과를 확인하고 따로 커밋한다(`테스트: 배경 도면 다-1 앵커 조임 — <ID들>`). `import 실패(세지 않음)`은 문법이 서는 꼴로 다시 돌린 결과로 바꾼다. 잡을 수 없다고 판단한 변형이 있으면 그 까닭을 결과 줄에 적는다(작업자가 아니라 오케스트레이터가 정한다).
- **결과 줄(오케스트레이터가 Task 13을 열기 전에 채워 커밋한다 — 넣은 변형 수 · 잡힘 · 조인 앵커와 그 커밋 · 남긴 것과 까닭):**
  - 게이트 M 결과: **2026-10-12 · 표는 173cb24e(앵커 59까지)에서 나왔다. 넣은 변형 177줄(설계의 항목 144 = A 96 · P 25 · S 23 — 게이트 B가 52 행에 더한 넷 포함 — 을 꼴마다 나눈 수) · 잡힘 176 · 살아남음 1 · import 실패 0. 기준선: 문서 47 · 작업 흐름 8 · 상태 7 · 색 14 · 앵커 59.** 게이트 B의 넷(A52-11~14)은 모두 앵커 52가 잡았다. **살아남은 것과 조인 것:** `A59-2e`(상태 테스트의 모든 `test()`에 `{ todo: true }` — 그 파일은 tests 7 · pass 0 · todo 7로 초록불이었다). 검토가 같은 행("테스트를 모두 건너뜀으로 바꿈")에서 다섯 철자를 더 찾았다: `{skip: true}`(빈칸 없이), `{ timeout: 1000, skip: true }`, 본문 첫 줄의 `t.skip()`, `import { skip as test }`, `describe.skip(` 묶음 — 조이기 전의 앵커로는 여섯이 모두 살아남는 것을 사본에서 다시 확인했다. **앵커 59를 조였다**: 처음의 세 글자 대신 두 파일에 낱말 `skip`·`todo`가 아예 없고(`/\b(?:skip|todo)\b/`) 첫 줄이 `import test from 'node:test';`. 검토는 58 행의 "배지를 남김"에서도 하나를 찾았다 — 글자를 상태 모듈에서 빌려 온 배지(`{editing && <span className="bmap-badge">{MAP_EDIT_LABEL}</span>}`)는 59개가 모두 통과했다. **앵커 58을 조였다**: 머리줄 조각에 `bmap-badge`가 없고 편집기에 `MAP_EDIT_LABEL`이 없다. 조인 뒤 여덟 변형(위의 여섯 + 배지 둘 — 하나는 import 없이 다른 글자를 넣은 꼴)을 저장소 밖 사본에서 다시 넣어 **여덟 모두 잡힘**, 기준선 59 / 59를 확인했다(이 커밋의 앞 커밋: `테스트: 배경 도면 다-1 앵커 조임 — A59-2e~j, A58-4b·c`). 구현은 고치지 않았다. **남긴 것과 까닭:** 없음(잡을 수 없다고 본 변형 없음). **적어 둘 것(설계의 문구를 바로잡음, 같은 커밋):** 11.4가 `mapEditStatus`의 가지 순서 바꾸기를 "11.1의 3·5"가 본다고 적었는데, 세 가지의 줄 차례만 바꾼 다섯 꼴은 모두 3이나 4에서 먼저 멈춘다(모두 잡힌다) — 5에서 처음 멈추는 것은 순서 바꾸기가 아닌 꼴이다 · 한 `test()`는 첫 실패한 단언에서 멈추므로, 표의 몇 줄(A52-7·8, A53-1·2, A54-1, A55-1a, S-14)은 그 행이 가리키는 단언보다 앞의 단언에서 잡혔다 — 뒤의 단언이 따로 잡는지는 이 표가 말하지 않는다(받아들임: 변형이 잡히는 것이 기준이다) · A55-1c(띠 규칙에 색을 직접 적음)는 앵커 55가 아니라 색 테스트의 C-10이 잡는다(설계대로다). **`test:background`: tests 582 · fail 0 · skipped 5 그대로**(조임은 단언을 더했을 뿐 테스트 수를 바꾸지 않는다).

### Task 13: 버전 1.135.0·업데이트 내역·문서·전체 게이트

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`, `AGENTS.md`, `ROADMAP.md`, `docs/superpowers/plans/2026-10-10-feedback-additions.md`

**Read first:** **게이트 M의 결과 줄**(비어 있으면 시작하지 않고 보고한다)과 게이트 A·B의 결과 줄(쓴 대체안은 문서에 그 구현대로 적는다) · 설계 13절 전부(JSON 블록과 문서별 내용), 11.5의 "git에 올리지 않은 파일" 문단과 두 명령, 11.6, 14절 9단계 · `DEVLOG/update-notes.json`의 첫 12줄(들여쓰기) · `AGENTS.md`의 `- 새 도면 요소(v1.133.0):` 불릿 · `ROADMAP.md`의 `- [x] 2026-10-10 ③ 새 도면 요소(v1.133.0):` 줄과 파일 끝의 `### v1.134.0 씬 대표 파일 한꺼번에 연결 (2026-10-11)` 절 · `docs/superpowers/plans/2026-10-10-feedback-additions.md`의 `## 7. 진행 기록` 표의 `| 다. 편집 상태와 저장 지키기 (G2) | - | 대기 |` 줄과 `### 7.2 나. 한꺼번에 연결 …` 절(꼴의 본보기).

- [ ] **Step 1: 버전** — `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 `1.134.0`인지 본다(이미 1.135.0 이상이면 멈추고 보고한다). `package.json`의 `"version"`, `package-lock.json`의 맨 위 `"version"`과 `packages[""]`의 `"version"` 세 곳을 `1.135.0`으로. 확인: `git diff --numstat package.json package-lock.json` → `2	2	package-lock.json`과 `1	1	package.json`.
- [ ] **Step 2: `DEVLOG/update-notes.json`** — 다시 직렬화하지 않는다(파일 전체가 바뀐다). **글자로 끼워 넣는다**: 첫 줄 `[` 바로 다음, 기존 첫 항목(`"version": "1.134.0"`의 `  {`) 앞에 아래 블록(설계 13절과 같은 글자, `{`부터 `}`까지 **31줄**)을 **각 줄 앞에 공백 2칸을 더해** 넣고 마지막 줄을 `  },`로 한다. 본문은 한 글자도 바꾸지 않는다. 줄 끝은 그 파일의 것(CRLF) 그대로.

```json
{
  "version": "1.135.0",
  "title": "배경 도면에서 편집 중인지 한눈에 보여요 (시험 중)",
  "items": [
    {
      "category": "ux",
      "summary": "도면을 편집하는 동안 색 띠와 테두리가 보여요 (시험 중)",
      "description": "예전에는 편집 중인지 그냥 보는 중인지 잘 구분되지 않아서, 옮겨 놓고 저장을 잊는 일이 잦았어요. 이제 '편집 시작'(예전의 '공간 편집')을 누르면 도면 둘레에 색 테두리가 생기고, 도면 위에 '편집 중'과 저장 안 한 변경이 몇 개인지 알려 주는 띠가 늘 보여요. '도면 저장'과 '편집 끝내기'(예전의 '취소')도 오른쪽 위 대신 이 띠 안에 있어요."
    },
    {
      "category": "ux",
      "summary": "저장해도 편집이 끝나지 않고, Ctrl+S로 저장할 수 있어요 (시험 중)",
      "description": "예전에는 '도면 저장'을 누르면 편집이 끝나서 다시 편집을 눌러야 했어요. 이제 저장한 뒤에도 그대로 이어서 고칠 수 있고, 띠에 '도면을 저장했어요'라고 잠깐 알려 줘요. 키보드의 Ctrl+S로도 저장돼요."
    },
    {
      "category": "ux",
      "summary": "바꾼 것이 없으면 묻지 않고 편집을 끝내요 (시험 중)",
      "description": "예전에는 아무것도 바꾸지 않았는데도 편집을 그만둘 때마다 '버릴까요?'를 물었어요. 이제 '편집 끝내기'는 바꾼 것이 없으면 바로 끝나고, 저장 안 한 변경이나 그리다 만 다각형이 있을 때만 물어봐요. '도면 저장' 버튼도 저장할 것이 있을 때만 켜져요."
    },
    {
      "category": "ux",
      "summary": "띠의 색은 쓰고 있는 테마 색과 겹치지 않게 정해져요 (시험 중)",
      "description": "어떤 테마를 쓰든 띠가 묻히지 않도록, 띠와 테두리의 색은 테마 색과 멀리 떨어진 색으로 알아서 바뀌어요. 보통은 호박색이나 청록색이고, 색을 직접 골라 쓰는 테마에서는 보라색이 될 때도 있어요."
    },
    {
      "category": "ux",
      "summary": "배경 화면은 아직 배한솔 계정에서만 보여요 (시험 중)",
      "description": "이번 변경도 배경 화면 안의 일이라, 배경 메뉴가 보이지 않는 분들은 달라지는 것이 없어요. 저장하지 않은 편집을 이 PC에 보관해 두는 기능은 다음 차례에 이어서 넣을 예정이에요."
    }
  ]
}
```

  - 확인 1: `git diff --numstat DEVLOG/update-notes.json` → `31	0	DEVLOG/update-notes.json`(더한 줄 31, 지운 줄 0).
  - 확인 2(값): `node -e "const n=require('./DEVLOG/update-notes.json');if(n[0].version!=='1.135.0'||n[0].items.length!==5||n[0].items.some(i=>i.category!=='ux')||n[1].version!=='1.134.0')process.exit(1);console.log(n[0].title)"` → 제목이 찍히고 종료 코드 0.
  - 확인 3(들여쓰기): `node -e "const l=require('fs').readFileSync('DEVLOG/update-notes.json','utf8').split(/\r?\n/);if(l[0]!=='['||l[1]!=='  {'||l[2]!=='    \"version\": \"1.135.0\",'||l[31]!=='  },'||l[32]!=='  {'||l[33]!=='    \"version\": \"1.134.0\",'||l.slice(1,32).some(s=>!s.startsWith('  ')||s.includes('\t')))process.exit(1)"` → 종료 코드 0. `git ls-files --eol DEVLOG/update-notes.json`이 고치기 전과 같다(`w/mixed`가 아니다).
- [ ] **Step 3: `AGENTS.md`**(CRLF 그대로) — '배경 라이브러리 데이터 경계'의 `- 새 도면 요소(v1.133.0): …` 불릿 **바로 다음**에 불릿 하나, **한 줄로**: `- 편집 상태 띠(v1.135.0): ` + 설계 13절 '문서'의 `AGENTS.md` 항목에서 "편집 중은 깃발이 아니라 …"부터 "… 읽기 전용 계정에는 없다."까지를 그 차례 그대로(`/`로 나뉜 항목을 **모두**, 굵은 곳은 굵게). 게이트에서 대체안으로 바뀐 것이 있으면 그 구현대로 고쳐 적는다.
- [ ] **Step 4: `ROADMAP.md`**(CRLF 그대로) — '2026-09-21 배경 라이브러리' 절의 ③ 줄 **다음**에 설계 13절의 한 줄(`- [x] 2026-10-12 다-1 편집 상태 띠(v1.135.0): …설계: docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md`)을 글자 그대로. 파일 끝의 v1.134.0 절 **다음**에 `### v1.135.0 배경 도면 편집 상태 띠 (2026-10-12)` 절: `- [x]` 다섯 줄(띠와 테두리 / 저장 뒤에도 편집 중 — 되돌리기 기록은 비워짐 / 바꾼 것이 있을 때만 저장, 없으면 묻지 않고 끝내기 / Ctrl+S / 띠 색의 규칙 한 줄)과 `- [ ] 수동 검증(설계 12절 전체)`, `- [ ] 배포`, `- [ ] 다-2(초안 보관·알림)는 다음 차례`.
- [ ] **Step 5: 추가 요청 계획**(CRLF 그대로) — `## 7. 진행 기록` 표의 '다' 줄을 `| 다. 편집 상태와 저장 지키기 (G2) | 1차: docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md, 아래 7.3 · 2차: - | 1차(보이는 상태) 2026-10-12 구현 완료(v1.135.0) · 수동 검증·배포 대기 · 2차(보관) 대기 |`로 고친다. 7.2 절 **뒤**에 `### 7.3 다-1. 편집 상태 띠 — 만든 것과 확인한 것 (v1.135.0, 2026-10-12)` 절을 7.1·7.2와 같은 꼴로: **만든 것**(설계 1.1의 "시안 그대로"와 "한솔의 두 답"을 비개발자 문장으로) / **확인한 것**(자동 검사의 수 — `test:background`의 tests·pass·skipped와 `test:motion`. Step 6에서 값이 달라지면 고친다 — 그리고 게이트 A·B·M의 결과 줄에서 옮긴 것) / **확인하지 못한 것**(최종 수동 검증 — 설계 12절 전체 — 과 배포 뒤 실기. 오케스트레이터가 검증 뒤 이 항목을 고친다) / **한솔의 두 답과 이 설계가 정한 것**(두 답을 말 그대로, 그리고 설계 1.1의 I1~I12를 한 줄씩).
- [ ] **Step 6: 전체 게이트(설계 11.6)** — `npm run typecheck` → 오류 없음 · `npm run test:background` → fail 0, skipped 5 · `npm run test:motion` → fail 0 · `npm run build:vite > <저장소 밖 스크래치>/build-vite.log 2>&1`. **성공은 종료 코드가 아니라 로그로 본다**: `> bflow@1.135.0 test:…` 머리 열셋(playground · auto-update · entity · notifications · presence · scene-links · character · calendar · ui · gantt · background · vacation · motion)마다 그 아래의 `# fail 0`(`grep -c '^# fail 0' <로그>` → 13, `grep -c '^# fail [1-9]' <로그>` → 0), 배경 묶음의 `# skipped 5`, `vite build`의 `✓ built in …` 세 줄, 마지막 줄 `[generate-manifest] …\dist\manifest.json 생성 — v1.135.0 @ …`. `npm run build`(배포 빌드)는 돌리지 않는다. 로그 파일은 스크래치에 두고 끝나면 지운다.
- [ ] **Step 7: git에 올리지 않은 파일이 없는지**(설계 11.5) — `git status --porcelain -- src/features/backgrounds tests docs DEVLOG` → `??`로 시작하는 줄이 없다(이 계획·설계가 `??`면 오케스트레이터의 것이다 — 넣지 말고 보고한다). `git ls-files --error-unmatch src/features/backgrounds/mapEditStatus.ts src/features/backgrounds/mapEditColor.ts src/features/backgrounds/useMapEditColors.ts src/features/backgrounds/BackgroundMapEditStrip.tsx tests/backgroundMapEditStatus.test.ts tests/backgroundMapEditColor.test.ts` → 성공(여섯 파일이 모두 올라 있다).
- [ ] **Step 8: 커밋** — 여섯 파일(빌드 산출물은 올리지 않는다) / `v1.135.0: 배경 도면 다-1 편집 상태 띠 — 버전·업데이트 내역·문서`

**이 Task가 끝나면:** 코드는 게이트 M 뒤와 같고, 앱의 업데이트 내역 맨 위에 1.135.0 항목이 보인다. `DEVLOG/background-library-verification-2026-09-21.md`와 완료 보고는 오케스트레이터가 쓴다. `CLAUDE.md`는 고치지 않는다(구조 변경 없음).

### 최종 수동 검증 — 설계 12절 전체 (Task 13 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- **방법과 범위**: 설계 12절 머리말 그대로(Electron 33, 미리보기 계정, 창 1440×900과 740×900, 어두운·밝은 화면). **모든 항목**(E1~E10, S1~S7, V1~V14e, X1~X10, K1~K12, C1~C10, L1~L5, U1~U3, R1~R6)을 1440×900 어두운 화면에서 보고 ★ 항목은 나머지 세 조합에서 다시 본다. 게이트 A·B에서 본 것도 마지막 상태에서 다시 본다. E6은 실제 한글 입력기로, V12~V14e는 같은 저장소를 쓰는 둘째 창으로, U1·U2는 설계에 적힌 방법으로.
- **적는 것**: `DEVLOG/background-library-verification-2026-09-21.md`(CRLF)에 `## 2026-10-12 다-1 편집 상태 띠 (v1.135.0)`(검증한 날이 다르면 그 날짜로) — 11.6의 수치, 12절의 결과(E1~E10의 관찰과 쓴 대체안, 색을 본 테마와 화면, 폭), 검증에 쓴 미리보기 주소, 확인하지 못한 것. 추가 요청 계획의 7.3과 '다' 줄, `ROADMAP.md`의 v1.135.0 절을 그 결과로 고친다. `문서: 배경 도면 다-1 수동 검증 기록 (v1.135.0)`으로 따로 커밋한다.
- **조정할 때**: 설계 15.2의 표를 따른다(게이트 A·B에 옮겨 적은 것과 같다). 대체안이 앵커·테스트가 읽는 글자를 바꾸면 **같은 변경에서** 그 앵커·테스트와 `AGENTS.md`의 그 문장·완료 보고의 그 줄을 맞추고 따로 커밋한다. 설계와 다른 동작이 보이면 고치기 전에 원인을 찾는다(@superpowers:systematic-debugging).
- **한솔에게 보이는 것**(머지 확인 때): 색을 본 화면(바이올렛 드림·똥파리 골드·에메랄드 × 두 화면, 보라가 나오는 직접 고른 테마 하나 — C5b)과, 깨끗함·바뀜을 나란히 둔 화면(S3). PR·머지·`npm run build`·G드라이브 배포는 한솔이 말할 때만 한다. 운영 DB에 할 일은 없다. **PR을 만들기 직전과 머지 직전에** `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 여전히 `1.134.0`인지 다시 본다(설계 13절 — Task 13 Step 1은 문서 커밋 전에 한 번 볼 뿐이다). 올라 있으면 버전 세 곳·update-notes의 맨 앞 항목·문서의 1.135.0을 다시 매기고 Task 13 Step 6의 전체 게이트를 다시 통과시킨 뒤 진행한다.

---

## 완료 보고에 적을 것

설계 15.3에서 그대로 옮겼다(아래 첫 문단부터 설계의 글자이고, `1.1`·`15.1`·`15.2`·`15.4` 같은 절 번호는 설계의 것이다). 완료 보고에는 비개발자 문장으로 옮겨 적고, 게이트에서 대체안으로 바꾼 것이 있으면 그 줄을 그 구현대로 고쳐 적는다.

시안과 두 답에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이다. 첫 열두 줄이 1.1의 I1~I12다. **★는 시안에 보인 대로만 만들면 되지 않거나 사용자가 잘못 알 수 있어서, 가장 덜 놀라운 쪽으로 고쳐 정한 것**이다 — 다른 답이 오면 1.1의 표대로 고친다.

**완료 보고의 맨 앞에 두는 넷 — I3·I4·I9·I11.** 한솔이 화면에서 보게 되는 것이 시안과 두 답보다 넓어지는 곳이다(I3: 설정 저장·연결 해제 뒤에도 편집 중 / I4: 깨끗한 편집 화면이 다른 PC의 저장으로 스스로 바뀌고, 지워진 도면에서는 첫 도면으로 넘어간다 / I9: "바꾼 것이 없으면 바로"라고 보였는데 찍던 다각형이 있으면 묻는다 / I11: 편집 중 머리줄의 빈 자리). 넷 다 "예전에는 … → 이제는 …"의 전후 문장으로 먼저 적고, 나머지를 그 뒤에 잇는다. 이 목록의 어느 것도 구현 전에 묻지 않는다(15.1).

- **(I1) '저장 안 한 변경 N개'의 N은 끝난 편집의 수다.** 한 번 끌어 옮긴 것, 칸 하나에 친 값, 공간 하나 그린 것이 각각 1이다. 되돌리면 줄어든다. 많이 고쳐도 정확하다.
- **★ (I2) 띠의 세 상태는 글자의 모양으로 갈린다.** 저장할 것이 없으면 "저장된 그대로예요", 저장 안 한 변경이 있으면 그 글자가 채워진 알약 모양 안에("저장 안 한 변경 3개"), 저장하면 굵은 "✓ 도면을 저장했어요"가 4초. 저장한 뒤에도 띠가 늘 떠 있게 되어서, "저장 안 한 변경이 없어요"와 "저장 안 한 변경 3개"처럼 문장의 끝만 다른 글자로는 저장했는지 안 했는지가 한눈에 들어오지 않는다.
- **(I3) 저장은 저장한 도면의 편집을 끝내지 않는다 — 어느 저장 길에서든.** '도면 설정'의 '설정 저장', '연결 해제'도 편집 중이었으면 계속 편집 중이다. '기존 도면 연결'·'내부 도면 만들기'는 지금처럼 그 도면으로 옮겨 가는데, 원래 도면은 편집 중인 채 남는다(돌아오면 띠가 있다). **편집을 끝내려면 '편집 끝내기'를 누른다.** **"저장했는데 띠가 사라졌다"로 보이는 곳이 하나 있다**: '기존 도면 연결'의 '연결하고 열기'는 저장한 뒤 그 도면으로 옮겨 가고, 그 도면이 편집 중이 아니었으면 보기로 열린다 — 띠는 지금 보는 도면의 것이라, 편집이 끝난 것이 아니라 편집 중이 아닌 도면으로 간 것이다(아래의 '연결하고 열기' 줄). 그 밖에 이 화면 안에서 편집이 끝나는 것은 셋뿐이다: 도면을 지웠을 때, 다른 PC에서 그 도면을 지웠을 때(I4), 응답을 잃은 '도면 만들기'를 다시 누른 드문 경우의 부모 도면(이 셋째는 저장을 하고도 그 도면의 편집이 끝나는 하나뿐인 길이고, 지금 그대로다).
- **(I4) 저장한 뒤 편집 중인 채 둔 화면은, 다른 PC에서 그 도면을 저장하면 15초 안에 그 모습으로 바뀐다**(저장 안 한 변경이 없을 때만). **다른 PC에서 그 도면을 지웠으면 이 PC의 목록에서도 빠지고**, 보고 있었다면 목록의 첫 도면으로 간다(보기 모드에서 지금 일어나는 것과 같다). 그 도면에 찍어 두었던 다각형 점은 함께 사라진다(그릴 도면이 없어졌다). **확인 창이나 설정·연결·만들기 창이 열려 있는 동안에는 이 두 가지가 일어나지 않고, 창을 닫은 뒤에 일어난다** — 창이 묻던 도면이 창 밑에서 다른 도면으로 바뀌면 '삭제'나 '버리고 끝내기'가 엉뚱한 도면에 가기 때문이다. 저장 안 한 변경이 있을 때는 지금처럼 내 편집이 남고, 저장을 누르면 "다른 사용자가 내용을 변경했습니다"가 뜬다 — 그 경우를 미리 알려 주는 것은 다음 차례(보관)에서 한다.
- **★ (I5) 띠의 색은 테마의 두 색(메인 액센트·서브 액센트)을 모두 보고 정한다.** 호박색과 청록색 가운데 두 색에서 더 먼 쪽이고, 둘 다 가까우면 보라색이다. 바이올렛 드림·윤성원 블루·에메랄드에서는 호박, 공산당 레드·똥파리 골드·이혜민 머쉬룸에서는 청록이다. 보라는 색을 직접 고른 테마에서만 나온다 — 예를 들어 똥파리 골드에서 메인 액센트만 파랑으로 바꾸면 서브 액센트(노랑)가 남아 있어서, 호박 띠는 그 노랑에, 청록 띠는 새 파랑에 묻힌다. 회색 같은 색만 골랐으면 호박이다. 어두운 화면에서는 밝은 띠에 어두운 글자, 밝은 화면에서는 짙은 띠에 흰 글자다. 빨강 계열은 쓰지 않는다(오류로 보이지 않게).
- **(I6) 도면 목록의 '저장 안 한 점'도 띠와 같은 색이 됐고**(똥파리 골드 테마에서 묻히던 것이 함께 풀렸다), 올려 두면 나오는 글자도 띠와 같은 말("저장 안 한 변경이 있어요")이 됐다.
- **(I7) 창이 좁으면(폭 900px 이하) 띠가 두 줄이다.** 'Ctrl+S' 표시는 둘째 줄의 버튼 왼쪽에 그대로 있다.
- **(I8) 저장했다는 알림은 띠 안에만 뜬다**(화면 구석의 알림은 띄우지 않는다).
- **★ (I9) 다각형을 그리다 만 채 '편집 끝내기'를 누르면, 다른 변경이 없어도 묻는다**(제목 "편집을 끝낼까요?", 글 "그리던 다각형이 사라져요." — 저장 안 한 변경이 있을 때의 제목 "저장하지 않고 편집을 끝낼까요?"와 다르다. 찍던 점은 저장할 수 있는 것이 아니라서다). '돌아가기'를 누르면 찍던 점이 그대로 있다. 지금의 '취소'가 하던 대로다 — 시안의 "바꾼 것이 없으면 바로 끝난다"를 글자 그대로 따르면 찍던 점이 말없이 사라진다.
- **(I10) 고친 것을 모두 되돌린 뒤 '편집 끝내기'를 누르면 묻지 않고 끝난다.** 그때 되돌린 편집은 다시 실행할 수 없게 된다(편집을 다시 시작해도 '다시 실행'이 꺼져 있다). 되돌려서 저장된 모습과 견줘 보는 중이었다면, 편집을 끝내기 전에 '다시 실행'으로 돌려놓아야 한다.
- **★ (I11) 편집 중에는 머리줄의 '편집 시작' 자리가 비어 있다.** 버튼을 없애지 않고 보이지 않게만 했다. 없애면 옆의 '도면 설정'이 그 자리로 밀려와서, '편집 시작'을 더블클릭한 사람에게 설정 창이 뜬다.
- **★ (I12) '도면 저장'이나 Ctrl+S가 저장되지 않고 문장으로 끝났는데(그리다 만 다각형이 있다, 저장에 실패했다) 그 빨간 띠가 화면 밖이면, 화면이 그쪽으로 움직인다.** 띠가 화면을 따라오게 되면서, 아래로 내려가 있을 때 저장을 눌러도 아무 일이 없는 것처럼 보이는 경우가 생기기 때문이다.
- **★ 한글 이름을 치던 중에(마지막 글자에 밑줄이 있는 채) Ctrl+S를 눌러도 그 글자까지 저장된다.** 처음 안은 그때 아무 일도 하지 않게 했는데, 한글은 마지막 글자가 늘 그 상태로 남아서 "이름을 치고 바로 Ctrl+S"가 말없이 저장되지 않는다.
- **저장 전의 되돌리기 기록은 저장하면 비워진다**(미리 알린 대로). 저장 직후에는 되돌리기 버튼이 꺼져 있다.
- **저장해도 손에 든 도구가 풀리지 않는다**(예전에는 저장하면 '선택' 도구로 돌아갔다).
- **바꾼 것이 없으면 '도면 저장'과 Ctrl+S는 저장하지 않는다**(쓰기가 나가지 않는다). 그때 띠에는 "저장된 그대로예요"가 떠 있다. 흐린 '도면 저장'은 눌러도 아무 일이 없고, Ctrl+S는 포커스만 도면으로 옮긴다(검색 칸에서 눌렀다면 커서가 칸에서 빠진다). **다각형을 그리다 만 채라면 Ctrl+S는 지금처럼 "그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요."를 보인다** — 다른 변경이 없을 때도 말없이 끝나지 않는다.
- **Ctrl+S는 포커스가 배경 화면 안에 있거나 아무 데도 없을 때 듣는다.** 앱의 왼쪽 메뉴나 위쪽 줄의 버튼(어두운·밝은 전환 등)을 누른 직후에는 도면을 한 번 눌러야 듣는다 — 되돌리기 같은 편집기의 다른 단축키와 같다. 비밀번호 변경 창처럼 앱의 다른 창에서 누른 Ctrl+S가 그 밑의 도면을 저장하지 않게 하려는 것이다.
- **편집을 시작하면 도면 아래의 이미지 목록이 띠만큼(40px) 짧아진다.** 도면의 크기는 그대로다. 좁은 창에서는 페이지가 띠만큼 길어지고, 넓은 창이라도 창이 낮거나 3D처럼 이미 화면이 위아래로 움직이던 때는 목록은 그대로인 채 페이지가 40px 길어진다.
- **'편집 시작'·'도면 저장'·'편집 끝내기'·'연결 해제'를 누른 뒤 곧바로 키보드(Delete, Ctrl+Z, 확대)를 쓸 수 있다**(예전에는 도면을 한 번 눌러야 했다).
- **버튼의 이름과 자리가 바뀌었다.** '공간 편집' → '편집 시작'(보라색이 아니라 테두리만 있는 버튼), '취소' → '편집 끝내기', '도면 저장'은 오른쪽 위에서 띠 안으로. 버리기 확인 창은 제목이 "저장하지 않고 편집을 끝낼까요?"(찍던 다각형만 있을 때는 "편집을 끝낼까요?"), 버튼이 '버리고 끝내기'다. 안내 글 셋도 옛 버튼 이름을 말하지 않는다 — '편집 시작'이라는 이름은 그 버튼이 보이는 사람(권한이 있고 편집 중이 아닌 사람)에게만 말한다.
- **제목 옆의 작은 배지('편집 중' / '저장 전 변경사항')가 없어졌다.** 띠가 같은 말을 한다.
- **'기존 도면 연결'의 '연결하고 열기'는 옮겨 간 도면을 보기 모드로 열고, '내부 도면 만들기'의 '만들고 들어가기'는 새 도면을 편집 중으로 연다.** 지금도 그렇지만, 띠가 생기면서 한쪽은 띠가 사라지고 한쪽은 띠가 있는 것으로 눈에 띈다. 이번에 바꾸지 않았다.
- **다른 도면으로 가면(공간을 더블클릭해 상세 도면으로 들어가는 평소의 흐름) 띠가 사라진다 — 간 도면이 편집 중이 아니면.** **띠는 "편집 모드"가 아니라 지금 보는 도면의 것이다.** 떠나온 도면에 저장 안 한 변경이 있어도 묻지 않고, 그것을 알려 주는 것은 도면 목록의 작은 점 하나뿐이다. 간 도면의 띠가 "저장된 그대로예요"나 "✓ 도면을 저장했어요"라고 해도 그것은 그 도면의 이야기이고, 떠나온 도면의 변경은 저장되지 않은 채다 — 그대로 다른 메뉴로 가면 사라진다. 한솔이 짚은 순서(편집 → 옮김 → 저장하지 않고 다른 곳으로)가 도면 사이에서는 그대로 남아 있다는 뜻이다. **지금과 같고, 이번에 바꾸지 않았다**(다음 차례의 '모두 저장'과 보관이 다룬다).
- **Ctrl+S에 다른 동작을 직접 묶어 둔 경우**(설정 › 단축키) 도면을 편집하는 동안에는 그 동작 대신 도면이 저장된다.
- **이번에 넣지 않은 것**(다음 차례): 다른 메뉴로 가거나 앱을 꺼도 남는 초안, 왼쪽 메뉴와 탭의 점, 다른 곳에서 바뀌었다는 알림, 모두 저장. **지금도 저장하지 않고 다른 메뉴로 가면 편집한 것이 사라진다** — 띠가 그것을 막아 주지는 않는다.
- **이번에 고치지 않은, 전부터 있던 드문 문제 하나**: 편집 중이 아닐 때(보기 모드) '도면 삭제'가 실제로는 됐는데 답을 받지 못해 오류가 뜬 경우, 열린 채 남은 그 창에서 '삭제'를 다시 누르면 목록의 첫 도면이 지워질 수 있다. 이번 변경과 무관하게 지금도 있다. 편집 중일 때는 지금처럼 막혀 있고 이번에도 그대로 막아 두었다(15.4). 보기 모드 쪽은 따로 고칠 일로 남긴다.
- 앱에서 본 결과와 쓴 대체안(15.2), 색을 본 테마와 화면(보라가 나오는 테마 하나를 넣는다). 게이트 A에서 멈춰 물은 것이 있으면 그 답.
