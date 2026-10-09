# 배경 도면 ③ 계단·도로·카메라 색 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배경 도면에 새 요소 셋을 더해 v1.133.0으로 만든다 — 기호 '계단'(평면은 디딤판 줄무늬와 화살표, 3D는 층층이 오르는 단), '도로'(공간의 한 종류: 회색 바닥과 가운데 점선, 3D는 벽 없는 바닥, 늘 방 아래), 카메라 색(동그라미 여섯 개와 '기본 색으로'). 저장 모양이 셋 늘어나므로(`symbol: 'stairs'`, 공간의 `surface: 'road'`, 카메라의 `color`) 서버 검증 함수를 넓히는 세 번째 migration 파일 하나를 더하고, 앱이 모르는 종류가 저장돼 있으면 오류 대신 "업데이트가 필요해요" 안내를 띄운다. 배경 메뉴는 계속 배한솔 계정 한정이다.

**Architecture:** 닫힌 목록은 `domain.ts`의 상수 셋 한 곳이고 요소 파일의 IN 목록이 같은 순서로 같다(계약 테스트가 견준다). 요소 파일의 검증 함수 본문은 "3D 파일의 본문 + 정확히 다섯 줄"이며 적용된 두 SQL 파일은 머리말 주석만 바뀐다(본문 해시를 테스트로 얼린다). 판정은 모두 three.js·DOM 없는 순수 모듈에 두고 `node --test`로 값을 고정한다 — 도로의 판별·벽 높이·가운데 선(`mapSpatial.ts`), 쌓임의 층과 겹침 판정(`mapStack.ts`), 키를 쓰고 지우는 두 함수와 소속 규칙(`mapGeometry.ts`), 색 표(새 `mapCameraColor.ts`). 평면 SVG·3D·보조 평면도는 초안 하나에서 `surface`·`color`·`symbol`을 읽고(`mapCanvas.ts`의 계약은 그대로), DOM의 색은 CSS 변수(`--bmap-cam`·`--bmap-road`, 숫자 셋), 3D의 색은 팔레트와 색 표의 숫자다. 읽기 장치는 검증이 던지는 오류의 **종류**만 가른다(`BackgroundUnsupportedError`) — 어느 쪽이든 통째로 거절하고, 모르는 값을 지우고 읽지 않는다.

**Tech Stack:** Electron 33(Chromium 130) · React 18 · TypeScript · SVG · three.js(3D 뷰포트) · PostgreSQL plpgsql(계약 테스트는 PGlite) · node:test(Node 22 type-stripping) · Vite

---

## 모든 Task 공통 규칙

- **작업 위치**: `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`, 브랜치 `claude/bg-map-new-elements`(= main v1.132.0, a0ca0542). 다른 워크트리·상위 checkout은 건드리지 않는다.
- **계약은 설계 문서다**: `docs/superpowers/specs/2026-10-09-background-map-new-elements-design.md`(아래 "설계"). 머리말의 용어(새 모양·도로·방·검증 함수·기본 파일·3D 파일·요소 파일·이전 버전·업데이트 안내·쌓임 순서·초안)와 각 Task의 **Read first**에 적힌 절을 먼저 읽는다. 설계에 적히지 않은 동작은 만들지 않는다. 이 계획과 설계가 어긋나면 설계가 맞다 — 멈추고 보고한다. **설계의 코드 블록·CSS·문구·SQL 줄을 옮길 때는 글자(띄어쓰기 포함)를 바꾸지 않는다**(Task 18의 앵커와 계약 테스트가 그 글자를 읽는다).
- **줄 번호**: 설계와 이 계획의 `:617` 같은 번호는 기준 커밋(a0ca0542)의 것이다. Task가 지나면 밀리므로 **인용한 코드로 찾는다**(특히 Task 3이 머리말을 고치면 기본 파일은 3줄, 3D 파일은 7줄 밀린다). 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래, 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.
- **편집기 한눈에**: `BackgroundMapEditor.tsx`는 컴포넌트 하나다. `current`는 지금 도면(편집 중이면 초안 값), `selected`는 "하나를 다루는 도구가 붙는 노드"(평면의 여러 개 선택에서는 `undefined`), `editing`은 편집 중, `canEdit`은 편집 중이고 저장 중이 아님, `fieldLocked`는 `!canEdit || selected.locked`, `gestureActive`는 끌기 도중, `mode`는 `'plan' | '3d'`, `updateMap(next)`는 되돌리기 한 단계짜리 수정, `replaceMapNode(map, node)`는 노드 하나 바꿔 넣기, `patchNode(changes)`는 합치기(키를 지울 수 없다), `focusCanvas()`는 키보드를 캔버스로 돌린다. 지금 동작의 요약은 설계 2절이다.
- **명령**: 테스트 파일 하나 `node --test tests/<file>.test.ts` · `npm run typecheck` · 배경 묶음 `npm run test:background`(glob `tests/background*.test.ts`). 시작 기준(a0ca0542): **tests 449 / pass 446 / fail 0 / skipped 3**. skipped는 PGlite 없이 건너뛰는 DB 실행 테스트로, **Task 4부터 5**다(최상위 실행 테스트 둘이 는다). 매 Task 뒤 기대: 테스트 수가 직전보다 많거나(테스트를 더한 Task) 같고(단언만 는 Task), fail 0.
- **DB 계약 테스트는 PGlite로도 돌린다** — SQL·`domain.ts`·`addMapCamera`·`applyNodeWorldPose`를 고치는 Task(1·2·3·4·5·9·19, 그리고 점검에서 그 파일들을 고친 때의 18)의 필수 단계다. Bash 도구에서: `BFLOW_PGLITE_MODULE='C:/Users/user/AppData/Local/Temp/claude/C--Bflow-BGonly--claude-worktrees-background-library-2d-3d-editor-a0ed8c/bafc21df-e0b6-4780-87fb-9fc41e436a3b/scratchpad/pglite/node_modules/@electric-sql/pglite/dist/index.js' node --test tests/backgroundDatabaseContract.test.ts`(PowerShell이면 `$env:BFLOW_PGLITE_MODULE='…'`로 주고 끝나면 `Remove-Item Env:BFLOW_PGLITE_MODULE`). 시작 기준: PGlite로 **tests 28 / pass 28 / skipped 0**, 없이 **tests 7 / pass 4 / skipped 3**. PGlite로 돌렸는데 skipped가 0이 아니면 경로가 틀린 것이다 — 건너뛴 것을 통과로 적지 않는다.
- **테스트 규칙(Node type-stripping)**: `.ts` 확장자를 붙인 상대 import, 지울 수 있는 TypeScript만(enum·namespace·`satisfies`·매개변수 속성 금지 — 클래스 필드 선언은 된다), 경로 별칭(`@/`) 금지. 타입은 반드시 `import type { … }` — 타입 제거 실행에서는 `import { 타입 }`이 지워지지 않아 `does not provide an export named …`로 파일 전체가 실패한다(`npm run typecheck`는 잡지 못한다: `tests/background*.test.ts`는 타입 검사를 받지 않는다). 새 `.ts` 모듈도 같은 규칙이다. `.tsx`에서 `.ts`를 import할 때는 기존처럼 확장자 없이 쓴다(`'./mapCameraColor'`). **각 Task의 테스트는 그 Task까지 생긴 이름만 import한다**(아직 없는 이름을 import하면 그 테스트 파일 전체가 실패한다).
- **테스트 먼저**(@superpowers:test-driven-development): 실패하는 테스트 → 구현 순서. 없는 export를 import한 테스트 파일은 `SyntaxError: The requested module … does not provide an export named '…'`(새 모듈이면 `ERR_MODULE_NOT_FOUND`)로 **파일 전체가** 실패한다 — 그것이 기대하는 실패다. 화면 배선은 순수 테스트로 잡을 수 없으므로 Task 끝의 **자가 점검(grep)** 으로 조각이 글자 그대로 있는지 보고, Task 18의 앵커가 고정한다. 자가 점검의 "N곳"은 **나타난 횟수**다(줄 수가 아니다 — 이 코드는 한 줄에 같은 조각이 둘 들 수 있다): `grep -c`(줄 수)가 아니라 `grep -oF '<조각>' <파일> | wc -l`로 센다.
- **앵커 규칙**(`tests/backgroundMapEditorWiring.test.ts`): 소스는 그 파일의 `read(name)`으로 읽는다(줄 끝을 LF로 정규화하고 주석을 뺀다 — 새 checkout은 CRLF다). 함수 본문은 `piece(source, from, to)`로 자르고(두 표지를 못 찾으면 단언으로 실패한다), 순서는 `inOrder`·`positions`로, 개수는 `count`로 센다. 표지·정규식에 줄바꿈 글자를 넣지 않는다. '없음'을 보는 검사는 표지를 단언한 조각에만 건다. CSS·문서·SQL을 글자로 읽는 다른 테스트도 같다: 읽은 뒤 `/\r?\n/`으로 줄을 나누거나 `\r\n`을 `\n`으로 맞추고, 찾는 표지가 있음을 먼저 단언한다.
- **하지 않는 것**: dev 서버·Electron·미리보기 창을 띄우지 않는다(`npm run dev*`, `npm run preview:electron`, `npm run build` 금지). push·PR·머지·배포를 하지 않는다. **운영 DB와 Supabase 도구(`mcp__…__apply_migration`·`execute_sql`·`list_migrations` 등 이름이 무엇이든)에 어떤 식으로도 닿지 않는다 — 읽기 전용 조회도 하지 않는다.** 운영 적용(설계 4.5)과 화면 확인은 **오케스트레이터의 관문**이다. 요소 파일은 저장소의 파일과 PGlite 테스트로만 다룬다.
- **건드리지 않는 파일**(설계 9.3): `electron/**`, `mapCanvas.ts`, `mapDocument.ts`, `useBackgroundMapDocument.ts`, `mapEditSession.ts`, `mapWorkflow.ts`, `mapPlanSelect.ts`(테스트만 더한다), `mapPlanEdit.ts`, `mapPlanGesture.ts`, `mapSnap.ts`, `mapGallery.ts`, `previewGateway.ts`, `BackgroundMapNameBox.tsx`, `BackgroundMapSelectionSummary.tsx`, `BackgroundMapPanels.tsx`, `BackgroundMapGallery.tsx`, `BackgroundUI.tsx`, `backgrounds.css`, `backgrounds-map-3d.css`, `src/mocks/devElectronAPI.ts`, `src/features/playground/featureFlag.ts`, **`CLAUDE.md`**(아래 '오케스트레이터가 먼저 하는 것').
- **적용된 두 SQL 파일의 특별 규칙**(`DEVLOG/migrations/2026-09-21-background-library.sql`, `2026-10-07-background-map-3d.sql` — 운영에서 함수 본문 md5를 대조한 파일이다): 고치는 것은 **Task 3 하나뿐**이고, 고치는 줄은 **`BEGIN;`보다 앞의 `-- ` 주석 줄뿐**이다. `BEGIN;`부터 파일 끝까지는 한 바이트도 바꾸지 않는다(줄 끝 포함 — 두 파일은 작업 트리에서 LF다). Task 2가 넣는 계약 테스트 D5(본문 sha256 고정)가 그것을 본다 — D5가 실패하면 본문을 건드린 것이니 **바이트 그대로** 되돌리고 다시 한다: Bash 도구(Git Bash)에서 `git show HEAD:DEVLOG/migrations/<파일> > DEVLOG/migrations/<파일>`(또는 `git -c core.autocrlf=input checkout -- <파일>`). **그냥 `git checkout -- <파일>`로 되돌리지 않는다** — 이 PC는 `core.autocrlf=true`·`* text=auto`라 그 파일을 CRLF로 다시 쓰고(`-c core.autocrlf=false`를 붙여도 CRLF다), 그러면 Task 3 Step 6의 `\r` 검사가 고친 내용과 무관하게 실패한다. PowerShell의 `>`도 쓰지 않는다. 되돌린 뒤 `git ls-files --eol <파일>`이 `i/lf w/lf`임을 확인하고 (Task 3이면) 머리말 수정을 다시 한다. 다른 Task는 두 파일을 열어 읽기만 한다.
- **커밋**: Task마다 한 번, 그 Task의 **Files**만 `git add` 한다. 형식: `git commit -m "<한글 메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. 줄 끝은 각 파일의 지금 상태 그대로 둔다(작업 트리에서 `AGENTS.md`·`CLAUDE.md`·`ROADMAP.md`·`package.json`·`package-lock.json`·라운드 계획·검증 기록은 CRLF, 소스·테스트·CSS·`DEVLOG/update-notes.json`·인수인계 문서·두 적용 SQL은 LF). 파일 전체의 줄 끝을 바꾸지 않는다. 새 파일(요소 파일 포함)은 LF로 만든다. **줄 끝을 볼 때는 `git ls-files --eol <파일>`이나 `grep -cU $'\r' <파일>`을 쓴다** — `-U` 없는 `grep -c $'\r'`은 이 PC의 Git Bash grep(3.0)이 줄 끝의 CR을 떼고 읽어 CRLF 파일에서도 0이다(a0ca0542의 `CLAUDE.md`: `-U` 없이 0, `-U`로 161).
- **오케스트레이터가 먼저 하는 것(Task 1 전)**: ① 설계 문서와 이 계획(둘 다 `git status`의 `??`)을 커밋한다(`문서: 배경 도면 ③ 새 도면 요소 설계와 구현 계획`). ② **`CLAUDE.md` :3의 다시 실행 문장을 설계 4.3의 글자로 바꿔 커밋한다**("운영 DB에는 2026-10-08에 … 순서로 적용했다(기본 파일을 다시 실행하면 3D 파일도 다시 실행한다)." → 4.3의 인용문 "운영 DB에는 2026-10-08에 … 순서로 적용했다. 적용 사슬은 기본 → 3D → `2026-10-09-background-map-elements.sql`(v1.133.0)이며, **앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다**(…)." — 줄의 나머지는 그대로, CRLF 그대로). 이 한 줄은 승인된 설계의 글자이지만 `CLAUDE.md`는 작업자가 다른 에이전트의 지시로 고치는 파일이 아니므로 오케스트레이터가 한다. Task 3의 D4가 그 줄에 옛 문장이 없음을 본다(Task 3의 Step 1이 먼저 확인한다). Task 작업자는 이 세 파일을 고치지 않는다.
- **관문은 오케스트레이터의 일이다**: 관문 A(Task 6 뒤 — 업데이트 안내), 관문 B(Task 7 뒤 — 계단의 엔진 확인), 관문 C(Task 14 뒤 — 도로의 엔진 확인), 관문 D(Task 17 뒤 — 카메라 색의 엔진 확인과 **여섯 색을 한솔에게 보이기**), 최종 수동 검증(Task 19 뒤), **운영 DB 적용(PR 머지 뒤, 앱 배포 전)**. 관문은 그 Task의 게이트가 통과한 뒤, 다음 Task를 시작하기 전에 본다(설계 14.2의 대체안이 걸려 있어 뒤 Task가 그 위에 쌓이기 전에 본다). Task 작업자는 자기 Task의 게이트까지만 한다.

## File structure

새 파일

| 파일 | 책임 |
|---|---|
| `DEVLOG/migrations/2026-10-09-background-map-elements.sql` | 검증 함수를 "3D 본문 + 추가 셋(다섯 줄)"으로 바꿔 넣는다. 그 밖에는 가드와 잠금 블록뿐(설계 4절) |
| `src/features/backgrounds/mapCameraColor.ts` | 카메라 색 표(이름·화면 이름·어두운/밝은 값)와 `cameraColorHex` (순수, three.js·DOM 없음) |
| `src/features/backgrounds/BackgroundMapCameraColor.tsx` | 속성 칸의 색 동그라미 여섯 개와 '기본 색으로' 글자 버튼(받은 값만 그린다) |
| `tests/backgroundMapElements.test.ts` | 기호 목록의 대체값, 도로의 판별·가운데 선, 색 표, 색 표·도로 색과 CSS의 일치, 새 CSS 규칙이 그 변수를 실제로 쓰는지(설계 10.4·10.6) |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `types.ts` | `BackgroundSymbolKind`에 `'stairs'`, `BackgroundSpaceSurface`, `BackgroundCameraColor`, 공간의 `surface?`, 카메라의 `color?` |
| `domain.ts` | 닫힌 목록 상수 셋, 새 키와 값 검사, `BackgroundUnsupportedError`(`detail`)·`known`·`onlyKeys`의 오류 종류, 노드 종류 검사의 자리 |
| `mapSpatial.ts` | `SYMBOL_VOLUME_HEIGHTS.stairs`, `isRoadSpace`, `spaceWallHeight`, `roadCentreLine`, `roadCentrePlanLine` |
| `mapStack.ts` | `stackedSpaces`의 층(맨 앞 항), `spacesOverlap` |
| `mapGeometry.ts` | `setSpaceSurface`, `setCameraColor`, `addMapCamera`의 도로 규칙, `applyNodeWorldPose`가 도로에 `volumeHeight`를 쓰지 않음 |
| `symbolCatalog.ts` · `BackgroundSymbolGlyph.tsx` | 계단 항목과 이름으로 찾는 대체값 · 계단 그림 |
| `mapPlanPreview.ts` · `BackgroundMapPlanPreview.tsx` | `planKindLabel`, 도로의 읽어 주는 값과 옆 그림 · 도로의 클래스·가운데 점선·접근성 이름, 카메라의 `data-camera-color` 다섯 곳 |
| `BackgroundMapPlanOverlays.tsx` | 카메라 손잡이 `<g>`의 `data-camera-color` |
| `map3dScene.ts` | 계단 가지, 도로 가지(재질 다섯·팔레트 둘·그리는 순서·범위·`shapeKey`), `roadsUnderRooms`와 `pickMapNode`의 맨 앞 걸음, `mapSpacePile`과 `mapClickStep`의 한 줄, 카메라 색 재질(`material`의 둘째 인자, `shapeKey`) |
| `BackgroundMap3D.tsx` · `BackgroundMapCameraGizmo.ts` | `readPalette`의 `road`·`roadMark`, `applyGizmo`의 `flat`, 손잡이 위 클릭의 더미와 import · `mapGizmoSetup`의 셋째 인자, `MapGizmoTarget.flat`, `setTarget` |
| `BackgroundMapEditor.tsx` | 도로 도구, 공간 그리기의 도로, '공간 종류'와 `changeSpaceSurface`, 도로의 높이 칸과 안내, 색 동그라미와 `changeCameraColor`, `data-camera-color` 둘, `kindLabel`·머리 글자·목록 아이콘, 기호 목록 제목 |
| `useBackgroundStore.ts` · `BackgroundLibraryView.tsx` | 업데이트 안내(`updateRequired`, 저장 막기, 콘솔 기록 한 번, 안내 화면) |
| `backgrounds-map.css` · `backgrounds-map-plan.css` | 변수 블록, 도로 규칙, 호박색 글자의 변수 치환, 색 동그라미, 보조 평면도의 색(설계 9.4) |
| `DEVLOG/migrations/2026-09-21-background-library.sql` · `2026-10-07-background-map-3d.sql` | **머리말 주석만**(Task 3) |
| `tests/backgroundDatabaseContract` · `backgroundDomain` · `backgroundStore` · `backgroundPreview` · `backgroundPersistence` · `backgroundSpatial` · `backgroundMapStack` · `backgroundMapGeometry` · `backgroundMapPlanSelect`(더하기만) · `backgroundMapPlanPreview` · `backgroundMap3dScene` · `backgroundMapEditorWiring` (.test.ts) | 설계 10절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · `AGENTS.md` · `ROADMAP.md` · `DEVLOG/background-3d-opus-handoff-2026-10-07.md` · `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md` | 버전 1.133.0, 업데이트 내역, 문서(설계 12절·4.3). `CLAUDE.md` :3, `DEVLOG/background-library-verification-2026-09-21.md`, 운영 적용 기록은 오케스트레이터가 쓴다 |

**import 방향(거꾸로 가지 않는다, 새로 생기는 줄만)**: `mapStack.ts → mapSpatial.ts`(`isRoadSpace`, `nodePlanOutline`) · `mapGeometry.ts → mapSpatial.ts`(`isRoadSpace`) — `mapGeometry.ts`는 여전히 `mapStack.ts`를 import하지 않는다 · `mapPlanPreview.ts → mapSpatial.ts`(`isRoadSpace`) · `mapCameraColor.ts → types.ts`(타입만) · `map3dScene.ts → mapCameraColor.ts`, `mapStack.ts`(`spacesOverlap`), `mapSpatial.ts`(`isRoadSpace`·`spaceWallHeight`·`roadCentreLine`) · `BackgroundMapCameraColor.tsx → mapCameraColor.ts`. `mapSpatial.ts`·`mapStack.ts`·`mapCameraColor.ts`·`domain.ts`는 three.js·DOM을 import하지 않는다. 3D 파일(`BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`)은 `mapPlanSelect`·`mapPlanEdit`·`mapPlanGesture`·`mapSnap`을 import하지 않는다(앵커 10). Node로 도는 모듈의 새 import는 `.ts` 확장자를 붙인다.

Task와 설계 13절의 일곱 단계: 1=Task 1–4 · 2=Task 5–6 · 3=Task 7 · 4=Task 8–10 · 5=Task 11–14 · 6=Task 15–17 · 7=Task 18–19. 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "배선" 커밋의 경계다. 설계 13절과 다른 곳 둘: **`CLAUDE.md` :3**(설계는 1단계의 파일로 적었다)은 오케스트레이터가 Task 1 전에 고치고, 1단계의 새 값 검사는 **Task 1에서는 `requireValue`로, Task 5에서 `known`으로** 바꾼다(설계가 둘 다 허용한 것을 하나로 정했다).

---

## Chunk 1: 저장 계약과 세 번째 migration (설계 13절 1단계)

### Task 1: 앱 쪽 계약 — 타입, 닫힌 목록 상수 셋, 새 키와 값 검사

**Files:**
- Modify: `src/features/backgrounds/types.ts`, `src/features/backgrounds/domain.ts`, `src/features/backgrounds/mapSpatial.ts`(`SYMBOL_VOLUME_HEIGHTS` 한 줄)
- Test: `tests/backgroundDomain.test.ts`, `tests/backgroundSpatial.test.ts`, `tests/backgroundPersistence.test.ts`, `tests/backgroundPreview.test.ts`

**Read first:** 설계 3.1, 3.3, 3.4, 2.1(표의 1~3·7·15·16행), 1.3의 R3~R5, 10.1(`:113`·`:282`·`:72`·`:313` 행), 10.2(왕복·값 검사·잘못 붙은 키·상수 — **오류의 종류**를 보는 검사는 Task 5), 10.8 · `types.ts:12-35` · `domain.ts:18`, `:36-56` · `mapSpatial.ts:29-32` · 테스트의 픽스처 꼴: `tests/backgroundDomain.test.ts:104-135`(`blankMap`·`mapLink`·`symbol`), `:173`(`checkNodes`), `:276-290` · `tests/backgroundPersistence.test.ts:41-62`(세로 값 전달 테스트가 본보기) · `tests/backgroundPreview.test.ts:35-73`.

- [ ] **Step 1: 고정 값 넷을 바꾼다(10.1)** — `tests/backgroundDomain.test.ts:113`의 `const kinds=['door',…,'custom'] as const;` → `const kinds=BACKGROUND_SYMBOL_KINDS;`(import에 `BACKGROUND_CAMERA_COLORS, BACKGROUND_SPACE_SURFACES, BACKGROUND_SYMBOL_KINDS`를 더한다 — 계단까지 저장·왕복) · `:282`의 정렬 목록 → `['bed','cabinet','chair','custom','desk','door','plant','sofa','stairs','table']`, 바로 다음에 `assert.deepEqual([...BACKGROUND_SYMBOL_KINDS].sort(),[...kinds].sort());` · `tests/backgroundSpatial.test.ts:72`는 그대로 두고 다음 줄에 `assert.equal(SYMBOL_VOLUME_HEIGHTS.stairs, 180);` · `:313`의 쌍 목록 끝에 `['stairs', 180]`(`:315-316`의 모르는 문자열 → 80은 그대로).
- [ ] **Step 2: 새 테스트를 쓴다(10.2·10.8)**
  - **상수**: `BACKGROUND_SPACE_SURFACES`가 `['road']`, `BACKGROUND_CAMERA_COLORS`가 `['red','lime','green','teal','blue','pink']`(순서까지), 둘 다 `purple`·`amber`가 없다. `BACKGROUND_SYMBOL_KINDS`가 `['door','desk','chair','table','sofa','bed','cabinet','plant','custom','stairs']`.
  - **새 모양 왕복**(domain): 한 도면에 계단(`{...symbol(), symbol:'stairs'}`), 사각형 도로(`surface:'road'`), 다각형 도로(`shape:'polygon'`, 점 넷, `surface:'road'`), 색 여섯마다 카메라 하나(`color`), 그리고 평범한 공간·카메라·기호. `applyBackgroundCommand`로 저장 → `{...map, revision:1}`과 `deepEqual`. 평범한 세 노드에 `Object.hasOwn(node,'surface')`·`Object.hasOwn(node,'color')`가 거짓. `validateBackgroundSnapshot` 통과. 이름만 바꾼 저장(버전 1 → 2)과 `save-maps` 묶음에서도 `nodes`가 그대로.
  - **값 검사(문장만)**: 공간의 `surface`가 `'river'`·`'room'`·`''`·`null`·`undefined`·`true`·`1`·`[]`·`{}` → 모두 `/공간 종류/`. 카메라의 `color`가 `'purple'`·`'amber'`·`'#ff0000'`·`''`·`null`·`undefined`·`7`·`true`·`[]`·`{}` → 모두 `/카메라 색/`. 기호 `symbol:'elevator'` → `/사물 기호/`.
  - **잘못 붙은 키**: 카메라·기호에 `surface:'road'`, 공간·기호에 `color:'red'` → `/속성/`.
  - **메인 저장소**(`tests/backgroundPersistence.test.ts`, `:41`의 테스트와 같은 꼴로 새 테스트 하나): 계단·도로·색 카메라가 든 도면을 그대로 넘기고(SQL 인자가 보낸 글자 그대로) 응답도 그대로 돌려준다. `surface:'river'` → `/공간 종류/`, `color:'purple'`·`color:null` → `/카메라 색/`, `symbol:'elevator'` → `/사물 기호/`, 카메라의 `surface`·공간의 `color` → `/속성/` — SQL을 부르기 전에 멈춘다(호출 수 그대로).
  - **미리보기**(`tests/backgroundPreview.test.ts`): 새 모양이 든 도면을 저장하고 게이트웨이를 새로 만들어 다시 읽어도 그대로(`deepEqual`). (읽기 오류의 종류는 Task 5.)
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/backgroundDomain.test.ts` → `does not provide an export named 'BACKGROUND_…'`(새 상수 셋 가운데 먼저 걸린 이름 — 파일 전체). 나머지 세 파일은 새 단언이 실패한다(`SYMBOL_VOLUME_HEIGHTS.stairs`가 `undefined`, 새 모양 저장이 `사물 기호가 올바르지 않습니다.`·`지원하지 않는 배경 속성이 포함되어 있습니다.`로 거절).
- [ ] **Step 4: `types.ts`** (설계 3.1의 글자 그대로)
  ```ts
  /** desk/sofa/cabinet/plant are retained for saved-map compatibility and render as custom. */
  export type BackgroundSymbolKind = 'door' | 'desk' | 'chair' | 'table' | 'sofa' | 'bed' | 'cabinet' | 'plant' | 'custom' | 'stairs';
  export type BackgroundSpaceSurface = 'road';
  export type BackgroundCameraColor = 'red' | 'lime' | 'green' | 'teal' | 'blue' | 'pink';
  // BackgroundSpace 에 더한다:
    /** What the space is besides a room. Omitted = a room: written only for a road, and removed (never null) when it is a room again. */
    surface?: BackgroundSpaceSurface;
  // BackgroundCamera 에 더한다:
    /** Name of a colour of the camera palette. Omitted = the default amber: written only when one is picked, and removed (never null) for the default. */
    color?: BackgroundCameraColor;
  ```
- [ ] **Step 5: `domain.ts`** — `import type`에 `BackgroundCameraColor, BackgroundSpaceSurface, BackgroundSymbolKind`를 더하고, `BACKGROUND_SPATIAL_LIMITS` 아래에 상수 셋(글자 그대로):
  ```ts
  /** Closed lists of the stored map shape. Mirrored by DEVLOG/migrations/2026-10-09-background-map-elements.sql. */
  export const BACKGROUND_SYMBOL_KINDS: readonly BackgroundSymbolKind[] = ['door', 'desk', 'chair', 'table', 'sofa', 'bed', 'cabinet', 'plant', 'custom', 'stairs'];
  export const BACKGROUND_SPACE_SURFACES: readonly BackgroundSpaceSurface[] = ['road'];
  export const BACKGROUND_CAMERA_COLORS: readonly BackgroundCameraColor[] = ['red', 'lime', 'green', 'teal', 'blue', 'pink'];
  ```
  - 공간 가지(`:41`): `onlyKeys` 목록에 `'surface'`를 더하고, 세로 값 검사(`spatial(n,'volumeHeight','입체 높이');`) 뒤에 `if('surface' in n)requireValue(BACKGROUND_SPACE_SURFACES.includes(n.surface as BackgroundSpaceSurface),'공간 종류가 올바르지 않습니다.');`
  - 카메라 가지(`:48`): `onlyKeys` 목록에 `'color'`를 더하고, 세로 값 검사 넷 뒤에 `if('color' in n)requireValue(BACKGROUND_CAMERA_COLORS.includes(n.color as BackgroundCameraColor),'카메라 색이 올바르지 않습니다.');`
  - 기호 가지(`:52`): 문자열 아홉 개를 적은 줄을 `requireValue(BACKGROUND_SYMBOL_KINDS.includes(n.symbol as BackgroundSymbolKind),'사물 기호가 올바르지 않습니다.');`로. 기호의 `onlyKeys` 목록은 그대로다(`surface`·`color`는 다른 종류에 붙으면 `onlyKeys`가 거절한다). 문장은 한 글자도 바꾸지 않는다. Task 5가 이 세 줄을 `known`으로 바꾼다.
- [ ] **Step 6: `mapSpatial.ts`** — `SYMBOL_VOLUME_HEIGHTS`에 `stairs: 180`(방의 기본 높이와 같다 — 한 층을 오르는 계단). `Record<BackgroundSymbolKind, number>`라 이 줄이 없으면 typecheck가 깨진다.
- [ ] **Step 7:** 네 테스트 파일을 각각 `node --test` → 통과.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** PGlite로 계약 테스트 → tests 28 / pass 28 / skipped 0(이 Task는 그 파일을 고치지 않았다 — 새 `domain.ts`가 기존 실행 테스트를 깨지 않는지 본다).
- [ ] **Step 10:** `npm run test:background` → tests 449보다 많음, fail 0, skipped 3.
- [ ] **Step 11: 커밋** — 일곱 파일 / `배경 도면 ③: 저장 계약(앱) — 기호 종류 stairs, 공간의 surface, 카메라의 color를 타입과 검증의 닫힌 목록에 더한다`

**v1.132.0과 달라지는 것(되살리지 말 것):** 앱 검증(렌더러·미리보기·메인 프로세스가 함께 쓰는 `domain.ts`)이 새 모양 셋을 받아들인다 — 예전에는 `사물 기호가 올바르지 않습니다.`·`지원하지 않는 배경 속성이 포함되어 있습니다.`로 거절했다. 닫힌 목록은 줄 안의 문자열이 아니라 상수 셋이다.
**이 Task가 끝나면 편집기는:** v1.132.0과 같다(새 모양을 만드는 화면이 없다). 손으로 넣은 `symbol: 'stairs'`는 '기타 사물'로 보이고(대체값이 아직 마지막 항목이다) 3D에서는 높이 180의 점선 상자다. 저장소의 SQL 파일은 아직 새 모양을 모른다.

### Task 2: 요소 파일과 정적 계약 테스트 D1·D2·D3·D5

**Files:**
- Create: `DEVLOG/migrations/2026-10-09-background-map-elements.sql`
- Test: `tests/backgroundDatabaseContract.test.ts`

**Read first:** 설계 4.1 전부(구조 블록, 다섯 줄의 표, 불릿 넷, 멱등·가드), 4.2의 머리말 블록(26줄), 4.4의 머리말과 D1·D2·D3·D5 행, 1.3의 R1~R3 · 3D 파일 전체(`:20-121` — 가드 `:24-28`, 함수 `:30-104`, 잠금 블록 `:106-119`) · 계약 테스트 `:1-75`(`migration`·`code`·`entityValidator`, 3D 파일의 같은 검사 둘이 본보기).

- [ ] **Step 1: 테스트를 쓴다(4.4)** — 맨 위: `:6`의 import에 `BACKGROUND_CAMERA_COLORS, BACKGROUND_SPACE_SURFACES, BACKGROUND_SYMBOL_KINDS`, `:9`의 import에 `SYMBOL_VOLUME_HEIGHTS`, `:13`에 `sqlElements=migration('2026-10-09-background-map-elements.sql')`. 테스트 이름은 설계 표의 이름 그대로.
  - **D5 '적용된 두 파일의 본문은 그대로다'** — 파일마다(글자 그대로): `const text = migration(name).replace(/\r\n/g, '\n'); const at = text.indexOf('\nBEGIN;\n'); assert.ok(at >= 0); const hash = createHash('sha256').update(text.slice(at + 1)).digest('hex');`. 기대값: 기본 파일 `9fae1b53f02379bf98af1a25f1cff04576d69d9fc59d7486da49b6cc6c4fd5eb`, 3D 파일 `2e785dc4fe674136d620c0fd236b460572de7f782ca481bd8888e9ce15fc23b3`(이 계획을 쓸 때 a0ca0542의 파일에서 다시 계산해 같았다). 줄 끝을 맞추는 줄과 `at >= 0` 검사를 빼지 않는다.
  - **D1 '요소 파일은 검증 함수 하나만 바꿔 넣고, 기본값을 넣지 않고, 잠금을 다시 돈다'** — 3D 파일의 `:34-58` 검사와 같은 꼴. 머리말 `/^-- Prerequisites: 2026-09-21-background-library\.sql, then 2026-10-07-background-map-3d\.sql/m`. `code(sqlElements)`에 대해: `BEGIN;`·두 `SET LOCAL`·`COMMIT;`(`:37`의 정규식 그대로) · `CREATE OR REPLACE FUNCTION public\.\w+`가 검증 함수 **하나뿐**(`deepEqual`) · `to_regprocedure('public.background_library_validate_entity(text,jsonb)') IS NULL`과 `position('n-spatial' IN body)=0` · `ERRCODE='55000'`이 정확히 둘 · `RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp` · `:53`의 정규식 그대로 `doesNotMatch`(`jsonb_set|jsonb_insert|jsonb_build_object|jsonb_strip_nulls|COALESCE|\|\||DEFAULT|\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE TABLE)\b`, `i`) · `:55-57`의 `REVOKE … FROM PUBLIC`·`REVOKE … FROM %I`·`GRANT EXECUTE … TO %I`·`NOTIFY pgrst, 'reload schema';` 넷.
  - **D2 '요소 파일은 3D 검증 함수의 모든 규칙을 글자 그대로 두고 정확히 셋을 더한다'** — `base = entityValidator(sql3d)`, `next = entityValidator(sqlElements)`. `widened` = `base`의 각 줄에 세 치환: `WHEN 'space' THEN ARRAY['elevation','volumeHeight']` → `WHEN 'space' THEN ARRAY['elevation','volumeHeight','surface']` / `WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect']` → `WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect','color']` / `'plant','custom')` → `'plant','custom','stairs')`. `widened`와 `base`가 다른 줄이 **정확히 3** · `next.filter(line => widened.includes(line))`가 `widened`와 `deepEqual` · `added = next.filter(line => !widened.includes(line))`가 상수에서 만든 두 글자와 `deepEqual`(공간 줄, 카메라 줄 순서. 들여쓰기 네 칸):
    ```ts
    const list = (names: readonly string[]) => names.map(name => `'${name}'`).join(',');
    `    PERFORM public.background_library_require(NOT (n ? 'surface') OR n->>'surface' IN (${list(BACKGROUND_SPACE_SURFACES)}),'공간 종류가 올바르지 않습니다.');`
    `    PERFORM public.background_library_require(NOT (n ? 'color') OR n->>'color' IN (${list(BACKGROUND_CAMERA_COLORS)}),'카메라 색이 올바르지 않습니다.');`
    ```
    `next`에 ``n->>'symbol' IN (${list(BACKGROUND_SYMBOL_KINDS)}),'사물 기호 또는 연결 공간이 올바르지 않습니다.');``로 **끝나는** 줄이 정확히 하나. 자리: `next`에서 두 줄이 각각 `'공간의 바닥 높이 또는 입체 높이가 올바르지 않습니다.'`가 든 줄과 `'카메라 높이, 위아래 각도, 기울기 또는 화면 비율이 올바르지 않습니다.'`가 든 줄의 **바로 다음**(`indexOf` + 1).
  - **D3 'SQL의 닫힌 목록은 앱이 검증에 쓰는 상수와 같다'** — `code(sqlElements)`에서 `/n->>'symbol' IN \(([^)]*)\)/g`·`/n->>'surface' IN \(([^)]*)\)/g`·`/n->>'color' IN \(([^)]*)\)/g`가 각각 **한 번씩**만 맞고, 따옴표 안 이름의 배열이 `BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS`와 `deepEqual`(순서까지). 색 목록에 `purple`·`amber`가 없다. `Object.keys(SYMBOL_VOLUME_HEIGHTS).sort()`가 `[...BACKGROUND_SYMBOL_KINDS].sort()`와 같다.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundDatabaseContract.test.ts` → 모듈을 읽는 순간 `ENOENT … 2026-10-09-background-map-elements.sql`로 파일 전체가 실패한다.
- [ ] **Step 3: 요소 파일을 만든다** — **함수 본문을 손으로 다시 치지 않는다.** 3D 파일에서 복사하고 아래 다섯 곳만 고친다(스크래치 폴더의 Node 스크립트로 조립해도 된다 — 그 스크립트는 커밋하지 않는다). 순서:
  1. 머리말: 설계 4.2의 블록 26줄(`-- Background library maps: stairs symbol, road spaces and camera colours.`부터 `-- submitted map with the stored one. No stored row is touched by this file.`까지)을 글자 그대로. `Applied to production …` 줄은 넣지 않는다(운영 적용 뒤 오케스트레이터가 넣는다).
  2. 여는 줄과 가드(설계 4.1의 글자 그대로 — 파일에서는 `BEGIN;`·`DO`·`END $$;`가 줄 맨 앞, `IF`·`SELECT`·`END IF;`가 한 칸, `RAISE`가 두 칸 들여쓰기다. 아래 블록의 왼쪽 여백은 이 문서의 목록 들여쓰기다):
     ```sql
     BEGIN;
     SET LOCAL lock_timeout = '5s';
     SET LOCAL statement_timeout = '45s';

     DO $$ DECLARE body TEXT; BEGIN
      IF to_regprocedure('public.background_library_validate_entity(text,jsonb)') IS NULL THEN
       RAISE EXCEPTION '2026-09-21-background-library.sql 을 먼저 적용해야 합니다.' USING ERRCODE='55000';
      END IF;
      SELECT p.prosrc INTO body FROM pg_proc p WHERE p.oid='public.background_library_validate_entity(text,jsonb)'::regprocedure;
      IF position('n-spatial' IN body)=0 THEN
       RAISE EXCEPTION '2026-10-07-background-map-3d.sql 을 먼저 적용해야 합니다.' USING ERRCODE='55000';
      END IF;
     END $$;
     ```
  3. 함수: 3D 파일의 `CREATE OR REPLACE FUNCTION public.background_library_validate_entity(kind TEXT, v JSONB)`(`:30`)부터 그 함수의 `END $$;`(`:104`)까지를 **그대로 복사한 뒤 정확히 다섯 곳**:

     | # | 3D 파일의 줄 | 요소 파일의 줄 |
     |---|---|---|
     | 넓힘 1 | `    WHEN 'space' THEN ARRAY['elevation','volumeHeight']` | `    WHEN 'space' THEN ARRAY['elevation','volumeHeight','surface']` |
     | 넓힘 2 | `    WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect']` | `    WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect','color']` |
     | 넓힘 3 | `… AND n->>'symbol' IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');` | `… IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom','stairs'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');`(줄의 나머지는 그대로) |
     | 더함 1 | 공간의 `'공간의 바닥 높이 또는 입체 높이가 올바르지 않습니다.');` 줄 **바로 다음에** | `    PERFORM public.background_library_require(NOT (n ? 'surface') OR n->>'surface' IN ('road'),'공간 종류가 올바르지 않습니다.');` |
     | 더함 2 | 카메라의 `'카메라 높이, 위아래 각도, 기울기 또는 화면 비율이 올바르지 않습니다.');` 줄 **바로 다음에** | `    PERFORM public.background_library_require(NOT (n ? 'color') OR n->>'color' IN ('red','lime','green','teal','blue','pink'),'카메라 색이 올바르지 않습니다.');` |

     변수 이름 `spatial`은 바꾸지 않는다. 함수 본문 안에 주석을 넣지 않는다(설계 4.1 구조 블록의 `-- 3D 파일 :32 ~ :103 …` 줄은 설명이지 파일의 줄이 아니다). `NOT (n ? '…') OR`의 꼴을 지킨다 — `n ? 'surface' AND …`로 쓰면 기존의 모든 방이 거절된다.
  4. 빈 줄 하나 뒤에 3D 파일의 잠금 블록(`-- CREATE OR REPLACE keeps the existing grants; repeat the base lockdown so a rerun also repairs drift.` 줄부터 그 `END $$;`까지, `:106-119`)을 글자 그대로, 이어서 `NOTIFY pgrst, 'reload schema';`와 `COMMIT;`. 파일은 줄바꿈으로 끝난다.
- [ ] **Step 4: 자가 점검** — ① 두 파일의 함수 부분만 견준다: Bash에서 `diff <(sed -n '/^CREATE OR REPLACE FUNCTION/,/^END \$\$;/p' DEVLOG/migrations/2026-10-07-background-map-3d.sql) <(sed -n '/^CREATE OR REPLACE FUNCTION/,/^END \$\$;/p' DEVLOG/migrations/2026-10-09-background-map-elements.sql)` → `<`로 시작하는 줄이 정확히 3개, `>`로 시작하는 줄이 정확히 5개(넓힌 셋 + 더한 둘)이고 그 밖의 차이가 없다. ② 요소 파일에 `\r`이 없다(`grep -cU $'\r' <파일>` → 0 — `-U`를 빼지 않는다, 공통 규칙의 '커밋'), 탭이 없다. ③ `git status --short DEVLOG/migrations/` → 새 파일 하나뿐(두 적용 파일은 바뀌지 않았다).
- [ ] **Step 5:** `node --test tests/backgroundDatabaseContract.test.ts` → tests 11 / pass 8 / skipped 3. D5는 **고치지 않은** 두 파일에서 통과해야 한다(실패하면 기대값이나 줄 끝 처리가 틀린 것이다).
- [ ] **Step 6:** PGlite로 → tests 32 / pass 32 / skipped 0(실행 테스트는 아직 요소 파일을 돌리지 않는다 — Task 4).
- [ ] **Step 7:** `npm run typecheck` → 오류 없음. `npm run test:background` → Task 1보다 4개 많음, fail 0, skipped 3.
- [ ] **Step 8: 커밋** — 두 파일 / `배경 도면 ③: 세 번째 migration(요소 파일) — 검증 함수는 3D 본문에 다섯 줄만 다르다. 정적 계약 테스트가 그 글자와 닫힌 목록, 적용된 두 파일의 본문을 고정한다`

**이 Task가 끝나면 편집기는:** Task 1과 같다. 저장소에 요소 파일이 생겼을 뿐이고, 운영 DB에는 아무것도 하지 않았다.

### Task 3: 다시 실행 규칙을 세 파일 사슬로 — 두 적용 파일의 머리말(주석만), AGENTS.md, 인수인계 문서, D4

**Files:**
- Modify: `DEVLOG/migrations/2026-09-21-background-library.sql`(`:5-7`의 주석 세 줄 → 여섯 줄), `DEVLOG/migrations/2026-10-07-background-map-3d.sql`(`:9` 다음에 주석 일곱 줄), `AGENTS.md`(`:3`, `:106`, `:111`, `:114`), `DEVLOG/background-3d-opus-handoff-2026-10-07.md`(`:266`, `:297`)
- Test: `tests/backgroundDatabaseContract.test.ts`(D4)

**Read first:** 설계 4.3 전부(바꾸기 전·후의 글자가 모두 있다), 4.2의 '앞 파일만 다시 돌리면 깨지는 것' 표와 그 아래 문단, 4.4의 D4 행, 1.3 표 아래의 첫 불릿(`CLAUDE.md`·`AGENTS.md` :3의 글자를 고정하지 않는 까닭) · 두 적용 파일의 `BEGIN;` 앞 · 계약 테스트 `:36-37`, `:54`, `:71-75`(머리말을 읽는 기존 검사 — 그대로 통과해야 한다) · 공통 규칙의 '적용된 두 SQL 파일의 특별 규칙'.

- [ ] **Step 1: `CLAUDE.md` :3이 이미 고쳐져 있는지 본다** — `grep -c "3D 파일도 다시 실행한다" CLAUDE.md` → 0, `grep -c "2026-10-09-background-map-elements.sql" CLAUDE.md` → 1 이상. 아니면 **멈추고 보고한다**(오케스트레이터가 먼저 고친다. 작업자는 `CLAUDE.md`를 고치지 않는다).
- [ ] **Step 2: D4를 쓴다** — 이름 '세 파일의 머리말과 운영 문서가 사슬 전체를 말하고, 옛 두 파일 규칙이 남아 있지 않다'. 문서는 `readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8')`처럼 읽어 `/\r?\n/`으로 줄을 나눈다.
  - 요소 파일: `/^-- Chain: base -> 3D -> this file\./m`, `/^-- Re-run this file after every run of either of them/m`, 둘 다 `BEGIN;`보다 앞(`indexOf` 비교).
  - 기본 파일: `BEGIN;` 앞의 글자에 `2026-10-09-background-map-elements.sql`이 있고 `run the 3D file again`이 **없다**.
  - 3D 파일: `/^-- After this file, run 2026-10-09-background-map-elements\.sql again as well/m`이 `BEGIN;`보다 앞.
  - `CLAUDE.md`와 `AGENTS.md` 각각 — **부정 검사만**: `다시 실행`과 (`3D 파일도` 또는 `이 SQL도`)를 함께 담은 줄이 없다.
  - `AGENTS.md` — **긍정 검사**: `background_library_validate_entity`와 `2026-10-09-background-map-elements.sql`과 `그 뒤의 파일을 모두 순서대로 다시 실행한다`를 **한 줄에** 함께 담은 줄이 있다. `CLAUDE.md`와 두 파일의 `:3`에는 긍정 검사를 걸지 않는다(④가 그 줄을 다시 쓴다).
  - 인수인계 문서: `3D SQL도 다시 실행한다`를 담은 줄이 **정확히 하나**이고 그 줄에 `2026-10-09-background-map-elements.sql`이 있다. `3D SQL 재실행`을 담은 줄이 하나 이상이고 **줄마다** 그 파일 이름이 있다.
- [ ] **Step 3: 실패를 확인한다** — D4가 여러 단언에서 실패한다(기본 파일에 요소 파일 이름이 없다 등). 다른 테스트는 통과.
- [ ] **Step 4: 기본 파일의 머리말** — `-- Follow-up: 2026-10-07-background-map-3d.sql widens …`로 시작하는 주석 세 줄을 설계 4.3의 여섯 줄(`-- Follow-up chain: 2026-10-07-background-map-3d.sql (vertical-axis map fields), then`부터 `-- strip such a map to get past the error: apply the chain again.`까지)로 바꾼다. 머리말에 `jsonb_set(`이라는 글자를 쓰지 않는다(`:54`의 검사가 파일 전체에서 정확히 한 번을 본다).
- [ ] **Step 5: 3D 파일의 머리말** — `-- Re-run this file after every run of 2026-09-21-background-library.sql, not only after the first one.` 줄과 그 아래 세 줄은 **그대로 두고**, `-- with a vertical field makes every background write fail with 22023 until this file is applied again.` 줄 **다음에** 설계 4.3의 일곱 줄(`-- After this file, run 2026-10-09-background-map-elements.sql again as well: it replaces the same`부터 `-- brought back): apply the chain again.`까지)을 더한다. 그 뒤의 빈 주석 줄 `--`과 나머지는 그대로다.
- [ ] **Step 6: 두 파일이 주석만 바뀌었는지 본다** — `git diff --numstat DEVLOG/migrations/` → `6	3	…2026-09-21-background-library.sql`, `7	0	…2026-10-07-background-map-3d.sql`. `git diff -U0 DEVLOG/migrations/2026-09-21-background-library.sql DEVLOG/migrations/2026-10-07-background-map-3d.sql | grep '^[-+][^-+]'` → 출력 없음(바뀐 줄이 모두 `--`로 시작한다 — 주석이다). 두 파일에 `\r`이 생기지 않았다(`grep -cU $'\r'` → 0, `git ls-files --eol`이 `i/lf w/lf`). 어긋나서 되돌릴 때는 공통 규칙의 방법으로 한다(`git show HEAD:… > …` — 그냥 `git checkout --`은 CRLF로 다시 쓴다). 마지막 판정은 Step 9의 D5다.
- [ ] **Step 7: `AGENTS.md`**(CRLF 그대로) — 설계 4.3의 글자대로 네 곳: ① `:3`의 "운영 DB에는 2026-10-08에 … 순서로 적용했다(기본 파일을 다시 실행하면 3D 파일도 다시 실행한다)."를 `CLAUDE.md` :3과 **같은 글자**의 새 문장으로(줄의 나머지는 그대로) ② `:106`의 "기호 종류·치수·경첩/열림 방향은 공용 domain과 SQL에서 함께 검증한다." 끝에 " 닫힌 목록(기호 종류, 공간의 `surface`, 카메라의 `color`)은 `domain.ts`의 `BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS` 한 곳이고 `DEVLOG/migrations/2026-10-09-background-map-elements.sql`의 IN 목록과 같아야 한다(테스트가 견준다)." ③ `:111`의 "…이 SQL은 기본 migration 뒤에 적용하고 기본 migration을 다시 실행하면 이 SQL도 다시 실행한다."를 4.3의 긴 문장("…적용 순서는 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` → `2026-10-09-background-map-elements.sql`이다. 셋 다 같은 검증 함수(`background_library_validate_entity`)를 … **앞의 파일을 다시 실행하면 그 뒤의 파일을 모두 순서대로 다시 실행한다.** … 적용된 파일은 머리말 주석만 고치고 `BEGIN;` 아래는 고치지 않는다.")으로 — 한 줄로 쓴다(D4의 긍정 검사가 한 줄에서 셋을 찾는다) ④ `:114`의 "새 설치는 `DEVLOG/migrations/2026-09-21-background-library.sql`이 필요하다." → "새 설치는 위의 세 파일을 그 순서로 적용한다."
- [ ] **Step 8: 인수인계 문서**(LF 그대로) — §13.3 `:266`의 "…3D SQL도 다시 실행한다(두 파일 머리말에 기록)." **바로 뒤, 같은 줄에** " **v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`. 앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다(§17.3).**" · `:297`의 괄호 안 `3D SQL 재실행` **바로 뒤, 괄호 안에** " — v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`, §13.3·§17.3". 옛 문장은 지우지 않는다.
- [ ] **Step 9:** `node --test tests/backgroundDatabaseContract.test.ts` → tests 12 / pass 9 / skipped 3. **D5가 통과한다 = 두 본문이 그대로다.** `:36-37`·`:54`·`:73-74`의 기존 검사도 통과.
- [ ] **Step 10:** PGlite로 → tests 33 / pass 33 / skipped 0.
- [ ] **Step 11:** `npm run typecheck` → 오류 없음. `npm run test:background` → 1개 증가, fail 0, skipped 3.
- [ ] **Step 12: 커밋** — 다섯 파일(`CLAUDE.md`는 넣지 않는다) / `배경 도면 ③: 적용 사슬은 기본 → 3D → 요소 — 두 적용 파일의 머리말(주석만)과 AGENTS·인수인계 문서의 다시 실행 규칙을 세 파일 사슬로 고치고 계약 테스트로 고정한다`

**v1.132.0과 달라지는 것(되살리지 말 것):** "기본 파일을 다시 실행하면 3D 파일도 다시 실행한다"는 이제 **틀린 지시**다 — 운영 지시로는 하나도 남기지 않는다. 좁은 검증 함수 아래에서 막힌 쓰기를 도면을 지워서 풀지 않는다는 경고가 세 머리말과 AGENTS.md에 있다.
**이 Task가 끝나면 편집기는:** Task 1과 같다(코드 변경 없음).

### Task 4: PGlite 실행 테스트 P1~P4와 CRLF 실행

**Files:**
- Test: `tests/backgroundDatabaseContract.test.ts`
- Modify(테스트가 요소 파일의 잘못을 드러낼 때만): `DEVLOG/migrations/2026-10-09-background-map-elements.sql` — 두 적용 파일은 어떤 경우에도 고치지 않는다

**Read first:** 설계 4.4의 'PGlite 실행 테스트' 전부, 4.2의 표와 "막힌 쓰기를 도면을 지워서 풀지 않는다" 문단, 3.4, 10.10(CRLF 실행), 10.1의 계약 테스트 행 · 계약 테스트 `:85-124`(`boot`·`read`·`run`·`save`·`remove`), `:170-184`(종류 목록과 `invalid`), `:306-320`·`:339-346`(`save-maps` 명령을 `run`으로 보내고 **그 명령을** `mapSaveWasApplied`에 넘기는 본보기 — P1이 이 꼴이다), `:321-338`(`refuse`의 꼴 — 도우미는 `:323-329`: 단독 저장과 묶음 저장 둘 다 거절, 전후 `read()` 동일) · `mapWorkflow.ts:4-14`(`MapSaveCommand`와 `mapSaveWasApplied`) · `:376-420`(최상위 실행 테스트 둘 — migration을 다시 돌릴 때는 `RESET ROLE` → `db.exec(파일)` → `SET ROLE anon`, 순서가 틀린 적용 뒤에는 `ROLLBACK`).

- [ ] **Step 1: 큰 실행 테스트의 바탕** — `:110`의 적용 줄을 `await db.exec(sql);await db.exec(sql);await db.exec(sql3d);await db.exec(sql3d);await db.exec(sqlElements);await db.exec(sqlElements);await db.exec('SET ROLE anon');`으로(세 파일을 두 번씩 — 멱등까지). `:175`의 종류 목록 `['door',…,'custom']`을 `BACKGROUND_SYMBOL_KINDS`로. `:181`의 `symbol:'unknown'`은 그대로 거절돼야 한다.
- [ ] **Step 2: P1(큰 테스트 안의 하위 테스트) '계단·도로·카메라 색은 보낸 그대로 저장되고 없던 노드에는 아무것도 생기지 않는다'** — 도면 하나에 `{...symbol(), symbol:'stairs'}`, `{...space(), surface:'road'}`, 다각형 도로(`shape:'polygon'`, 점 넷, `surface:'road'`, `elevation: 30`), 색 여섯마다 카메라(`{...camera(), color}`), `{...camera(), elevation:150, pitch:-20, color:'teal'}`, 그리고 평범한 `space()`·`camera()`·`symbol()`. **`mapSaveWasApplied`는 `save-maps` 명령만 받는다**(`command.maps`를 읽는다 — `save('map', m)`의 `{type:'save',…}`를 넘기면 던진다): 첫 저장은 `const command = {type:'save-maps',maps:[{entity:m,expectedRevision:null}]}`을 `run(command)`으로 하고 **그 명령을 그대로** 넘긴다(`:343-344`의 꼴. 저장된 도면은 돌아온 스냅숏의 `maps`에서 id로 찾는다). 저장 결과가 `{...m, revision:1}`과 `deepEqual` · 평범한 세 노드에 `surface`·`color` 키가 없다(`Object.hasOwn`) · 이름만 바꾼 저장(1 → 2) 뒤에도 노드가 그대로 · `mapSaveWasApplied(첫 저장 직후의 스냅숏, command)`이 참, 명령에서 색 하나를 다른 색으로 바꾸거나 `surface`를 뺀 것은 거짓 · 일반 팀원 토큰(`read('member')`)으로 읽어도 같은 값.
- [ ] **Step 3: P2(하위 테스트) '모르는 값·잘못된 타입·잘못 붙은 키는 22023으로 거절되고 아무것도 바뀌지 않는다'** — 기존 `refuse`(`:323-329`)와 같은 꼴. `surface`: `'river'`·`'room'`·`'Road'`·`''`·`null`·`true`·`1`·`[]`·`{}` → `{code:'22023', message:/공간 종류/}`. `color`: `'purple'`·`'amber'`·`'#ff0000'`·`'Red'`·`''`·`null`·`7`·`true`·`[]`·`{}` → `/카메라 색/`. 잘못 붙은 키: 카메라·기호에 `surface:'road'`, 공간·기호에 `color:'red'` → `/도면 배치 항목/`. 기호 `symbol:'elevator'` → `/사물 기호/`.
- [ ] **Step 4: P3(새 최상위 테스트, `{skip:!runtime}`) '3D 파일까지만으로는 새 모양이 거절되므로 요소 파일은 그 위에만 얹는다'** — 빈 DB에 요소 파일 → `{code:'55000'}`, `ROLLBACK`, `background_library_%` 함수 0개 · 기본 파일만 적용한 뒤 요소 파일 → `{code:'55000', message:/3d/}`, `ROLLBACK`, 검증 함수 본문(`pg_proc.prosrc`)에 `n-spatial`이 여전히 없다 · 3D 파일 적용 → 평범한 도면과 세로 값 도면은 저장되고, 계단은 `/사물 기호/`, `surface`·`color`는 `/도면 배치 항목/`으로 22023 · 요소 파일 적용 → 셋 다 보낸 그대로 저장된다 · 그 전에 저장한 행은 읽어서 그대로다.
- [ ] **Step 5: P4(새 최상위 테스트, `{skip:!runtime}`) '앞 파일을 다시 돌려도 잃는 것이 없고 사슬을 다시 적용하면 고쳐진다'** — 세 파일 적용 뒤 `fresh`(계단 + 도로 + 색 카메라)·`tall`(세로 값)·`flat`(평범) 도면과 장소 하나를 저장하고 `before = read()`. ① 3D 파일만 다시 → `read()`가 `before`와 같다. 쓰기 넷(새 장소, 새 도면, `flat` 이름 바꾸기, `fresh` 이름 바꾸기)이 모두 22023. 요소 파일 다시 → `read()` 같고 쓰기가 된다. ② 기본 파일만 다시 → `read()` 같고 쓰기가 모두 22023. 여기서 요소 파일을 바로 → 55000(`ROLLBACK`). 3D 파일 → 쓰기는 여전히 22023(계단이 저장돼 있다). 요소 파일 → 쓰기가 되고 `fresh`·`tall`·`flat`이 그대로다. ③ 3D 파일만 다시 → 쓰기 넷이 다시 22023. 그 상태에서 `fresh`를 지우는 명령(`{ type: 'delete', kind: 'map', id: fresh.id, expectedRevision }`)은 **오류 없이 통과**하고, 그 뒤에는 새 장소 저장과 `flat` 이름 바꾸기도 통과한다. `read()`에 `fresh`가 없고 `tall`·`flat`은 그대로다. 요소 파일을 다시 적용한다. 끝에 `anon`·`authenticated`가 실행할 수 있는 `background_library_%` 함수가 `execute`·`read` 둘뿐(`has_function_privilege`). (③은 권하는 길이 아니라 "22023 앞에서 도면을 지우면 안 되는 까닭"을 고정하는 것이다.)
- [ ] **Step 6: PGlite로 돌린다** — tests 37 / pass 37 / skipped 0(P3·P4 안에 하위 테스트를 두면 그만큼 더 많다. fail 0과 skipped 0이 기준이다). Task 2의 파일이 맞으면 새 테스트는 **처음부터 통과한다**. 실패하면 요소 파일이 설계 4.1과 어긋난 것이다 — 요소 파일을 고치고 Task 2의 자가 점검(Step 4)을 다시 한다. 기존 최상위 테스트 둘(`:376`, `:393`)은 손대지 않고 통과해야 한다.
- [ ] **Step 7: 새 테스트에 이가 있는지 본다(작업 트리는 고치지 않는다)** — `.superpowers/mutation-scratch/`에 아래 Step 8과 같은 방법으로 사본을 만들고(줄 끝은 바꾸지 않는다), 사본의 요소 파일에서 더함 1의 `NOT (n ? 'surface') OR `를 지워 PGlite로 돌린다 → P1(또는 기존 하위 테스트)이 실패한다. 되돌리고 `'stairs'`를 뺀다 → P1·D2·D3이 실패한다. 사본을 지운다.
- [ ] **Step 8: CRLF 실행(10.10)** — 이 워크트리의 SQL 파일은 LF라서 여기서만 돌리면 D5의 줄 끝 처리가 시험되지 않는다. 워크트리 안의 `.superpowers/crlf-scratch/`(`.gitignore`에 있고 `test:background`의 glob과 tsc의 `include`에 들지 않는다)에 같은 상대 경로로 복사한다: `tests/backgroundDatabaseContract.test.ts`, `src/features/backgrounds/` 전체, `DEVLOG/migrations/`의 세 파일과 `2026-09-05-app-sessions-gantt-auth.sql`, `CLAUDE.md`, `AGENTS.md`, `DEVLOG/background-3d-opus-handoff-2026-10-07.md`. 사본의 **세 배경 SQL 파일과 세 문서**의 줄 끝을 CRLF로 바꾸고(`node -e`로 `\r\n`→`\n`→`\r\n`, 바꾼 뒤 `grep -cU $'\r'`로 0이 아님을 확인 — `-U` 없이는 CRLF로 바뀌었어도 0이 나온다), 그 폴더에서 PGlite로 `node --test tests/backgroundDatabaseContract.test.ts` → fail 0, skipped 0. 끝나면 `.superpowers/crlf-scratch` 폴더만 지운다. **junction·symlink를 만들지 않는다**(위쪽 `node_modules`가 그대로 해석된다 — 링크를 건 사본을 지우다 원본이 지워진 사고가 있었다). `git status --short`에 이 Task의 파일 말고 새 항목이 없는지 본다.
- [ ] **Step 9:** `node --test tests/backgroundDatabaseContract.test.ts`(PGlite 없이) → tests 14 / pass 9 / skipped 5. `npm run typecheck` → 오류 없음. `npm run test:background` → tests 2개 증가, fail 0, **skipped 5**(이 뒤로 5가 기준이다).
- [ ] **Step 10: 커밋** — 한 파일(요소 파일을 고쳤으면 둘) / `테스트: 배경 도면 ③ DB 실행 계약 — 새 모양의 저장·거절, 3D 파일 위에만 얹히는 순서, 앞 파일을 다시 돌렸을 때의 복구. CRLF 사본에서도 통과`

**이 Task가 끝나면:** 저장소의 세 파일이 운영에 넣을 수 있는 상태임을 PGlite가 본다. 운영 DB는 건드리지 않았다(적용은 PR 머지 뒤 오케스트레이터의 관문). 편집기는 Task 1과 같다.

---

## Chunk 2: 읽기 장치 — "업데이트가 필요해요" (설계 13절 2단계)

### Task 5: 검증이 거절의 종류를 가른다 — `BackgroundUnsupportedError`·`known`·`onlyKeys`, 노드 종류 검사의 자리

**Files:**
- Modify: `src/features/backgrounds/domain.ts`
- Test: `tests/backgroundDomain.test.ts`, `tests/backgroundPreview.test.ts`

**Read first:** 설계 5.2의 (1) 전부(코드 블록, 줄 표, 불릿 일곱), 3.4의 끝, 5.3, 5.5의 `backgroundDomain`·`backgroundPreview` 불릿, 10.2의 값 검사(종류), 1.3의 R5·R11 · `domain.ts:8`, `:18`, `:36-63`, `:87-88` · `previewGateway.ts:34-38`(읽을 때 같은 검증) · `tests/backgroundDomain.test.ts:173`, `:236`.

- [ ] **Step 1: 테스트를 쓴다(5.5·10.2)** — import에 `BackgroundUnsupportedError`. "그 클래스다"는 `assert.throws(fn, BackgroundUnsupportedError)`와 문장 정규식 둘 다로, "그 클래스가 아니다"는 `error => error instanceof Error && !(error instanceof BackgroundUnsupportedError) && 정규식.test(error.message)`로 본다.
  - `validateBackgroundSnapshot` — **모르는 값·키 → `BackgroundUnsupportedError`**(문장은 기존 정규식에 맞는다): 기호 종류 `'elevator'`(`/사물 기호/`) · 노드 종류 `type: 'note'`(좌표·이름이 없는 노드여도 `/지원하지 않는 도면 오브젝트/`) · 노드·도면·장소·배경의 변형에 붙은 모르는 키(`/속성/`) · 모르는 `shape`(`/공간 모양/`)·`surface`(`/공간 종류/`)·`color`(`/카메라 색/`)·`shot`(`/구도 분류/`)·`time`(`/시간대 분류/`).
  - **깨진 값 → `Error`이되 그 클래스가 아니다**: `symbol: 42`, `color: 7`, `surface: true`, `shape: null`, `type` 없음, 범위 밖 숫자, `NaN` 좌표, 끊긴 참조(도면에 없는 `spaceId`).
  - 최상위에 `notes: []`를 더한 자료는 통과한다.
  - **`detail`**: 기호 종류 `'elevator'` → `error.detail === 'value "elevator"'` · 노드의 모르는 키 `future` → `'keys "future"'` · 두 경우 모두 `error.message`에 `elevator`·`future`가 **없다** · 300자짜리 모르는 값 → `detail.length < 100`.
  - **Task 1의 값 검사에 종류를 더한다(10.2)**: `surface`가 `'river'`·`'room'`·`''` → 그 클래스, `null`·`undefined`·`true`·`1`·`[]`·`{}` → 그 클래스가 아니다. `color`가 `'purple'`·`'amber'`·`'#ff0000'`·`''` → 그 클래스, `null`·`undefined`·`7`·`true`·`[]`·`{}` → 아니다.
  - **미리보기**(`tests/backgroundPreview.test.ts`): 저장소(`bflow-background-library-preview-v1`의 값)에 모르는 기호 종류가 든 자료를 직접 넣고 `read()` → `assert.rejects(…, BackgroundUnsupportedError)`. 깨진 값(`x: 'a'`)이면 그 클래스가 아닌 `Error`.
- [ ] **Step 2: 실패를 확인한다** — 두 파일 모두 `does not provide an export named 'BackgroundUnsupportedError'`.
- [ ] **Step 3: 구현한다** — `requireValue` 아래에 클래스와 `known`을 넣고 `onlyKeys`를 바꾼다(설계의 글자 그대로):
  ```ts
  /**
   * Thrown where stored data holds a key, or a value of a closed list, that this version does not know: most likely
   * written by a newer app. It is still an Error with the same message: nothing is accepted that was refused before.
   */
  export class BackgroundUnsupportedError extends Error {
    /** What was not known (the keys, or the value). For the console only: no part of the message and never shown to the user. */
    readonly detail: string;
    constructor(message: string, detail: string) { super(message); this.name = 'BackgroundUnsupportedError'; this.detail = detail; }
  }
  /** A value of a closed list. A string outside the list is unknown (BackgroundUnsupportedError); anything else is invalid. */
  function known(value: unknown, allowed: readonly string[], message: string): void {
    if (typeof value === 'string' && allowed.includes(value)) return;
    throw typeof value === 'string' ? new BackgroundUnsupportedError(message, `value ${JSON.stringify(value.slice(0, 80))}`) : new Error(message);
  }
  function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new BackgroundUnsupportedError('지원하지 않는 배경 속성이 포함되어 있습니다.', `keys ${unknown.slice(0, 8).map(key => JSON.stringify(key.slice(0, 80))).join(', ')}`);
  }
  ```
  - 닫힌 문자열 목록을 보는 줄을 `known`으로 바꾼다. **문장은 한 글자도 바꾸지 않는다**: `shape`(`['rect','ellipse','polygon']`, `공간 모양이 올바르지 않습니다.`) · `surface`(`BACKGROUND_SPACE_SURFACES`, `공간 종류가 올바르지 않습니다.` — `if('surface' in n)` 아래 그대로) · `color`(`BACKGROUND_CAMERA_COLORS`, `카메라 색이 올바르지 않습니다.` — `if('color' in n)` 아래 그대로) · `symbol`(`BACKGROUND_SYMBOL_KINDS`, `사물 기호가 올바르지 않습니다.`) · `hinge`(`['left','right']`, `문의 경첩 방향이 올바르지 않습니다.`) · `swing`(`['inward','outward']`, `문 열림 방향이 올바르지 않습니다.`) · `shot`(`['wide','medium','closeup','detail']`, `구도 분류를 확인해 주세요.`) · `time`(`['day','night','other']`, `시간대 분류를 확인해 주세요.`).
  - 노드의 `type`: 노드 루프의 `object(n);` **바로 다음, 다른 검사보다 앞에** `known(n.type,['space','camera','symbol'],'지원하지 않는 도면 오브젝트입니다.');`를 넣고, 마지막 가지의 `requireValue(n.type==='symbol','지원하지 않는 도면 오브젝트입니다.');`를 뺀다(마지막 가지는 이제 늘 기호다).
  - **그대로 두는 것**: 요청의 `c.kind`·`c.type` 검사(`requireValue` — 저장된 자료가 아니라 이 앱이 만드는 요청이다), 숫자 범위(`number`·`spatial`)·타입·개수 한계(`array`), `validateBackgroundSnapshot`이 아는 다섯 모음만 읽는 것. 모르는 값을 지우거나 건너뛰는 줄을 만들지 않는다(파일에 `delete `가 없다).
- [ ] **Step 4: 자가 점검** — `domain.ts`에: `grep -oF 'known(' src/features/backgrounds/domain.ts | wc -l` → 10(정의 1 + 호출 9: `type`·`shape`·`surface`·`color`·`symbol`·`hinge`·`swing`·`shot`·`time`. 나타난 횟수다 — 줄 수(`grep -c`)로 세면 9가 나온다: `hinge`·`swing`이 한 줄이다) · `requireValue(n.type==='symbol'` 0곳 · `delete ` 0곳 · `requireValue(kinds.includes(c.kind as BackgroundKind)`와 `requireValue(c.type==='save'||c.type==='delete'`는 그대로 1곳씩.
- [ ] **Step 5:** 두 테스트 파일 → 통과. `tests/backgroundDomain.test.ts`의 기존 테스트(문장 정규식)는 손대지 않고 통과해야 한다.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음.
- [ ] **Step 7:** PGlite로 계약 테스트 → fail 0, skipped 0(tests 37).
- [ ] **Step 8:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 5(`tests/backgroundPersistence.test.ts`·`backgroundStore.test.ts`는 손대지 않고 통과 — 문장이 같다).
- [ ] **Step 9: 커밋** — 세 파일 / `배경 도면 ③: 검증이 "모르는 종류·키·값"과 "깨진 값"을 가른다(BackgroundUnsupportedError) — 문장과 거절 범위는 그대로, 무엇을 몰랐는지는 detail에`

**v1.132.0과 달라지는 것(되살리지 말 것):** 목록에 없는 키와 닫힌 목록 밖의 **문자열**은 같은 문장의 `BackgroundUnsupportedError`다(예전에는 모두 `Error`). 노드의 `type`은 식별자·이름·좌표보다 **먼저** 본다 — 이름이나 좌표가 없는 모르는 종류의 노드가 이름·좌표 검사의 문장이 아니라 `지원하지 않는 도면 오브젝트입니다.`로 거절된다. 받아들이는 범위는 한 글자도 넓어지지 않았다.
**이 Task가 끝나면 편집기는:** Task 1과 같다(오류의 종류를 읽는 곳이 아직 없다 — 모르는 종류가 저장돼 있으면 여전히 빨간 띠다).

### Task 6: 저장소와 화면 — `updateRequired`, 저장 막기, 콘솔 기록 한 번, 안내 화면

**Files:**
- Modify: `src/features/backgrounds/useBackgroundStore.ts`, `src/features/backgrounds/BackgroundLibraryView.tsx`
- Test: `tests/backgroundStore.test.ts`

**Read first:** 설계 5.2의 (2)·(3) 전부, 5.1, 5.5의 `backgroundStore` 불릿, 2.2(지금의 읽는 길과 화면), 10.9의 앵커 46(Task 18이 읽을 글자) · `useBackgroundStore.ts` 전체(57줄) · `BackgroundLibraryView.tsx:31`, `:91-99`, `:112-176` · `tests/backgroundStore.test.ts:1-30`, `:92-102`.

- [ ] **Step 1: 테스트를 쓴다(5.5)** — `console.warn`은 `t.mock.method(console, 'warn', () => {})`로 받는다. "모르는 기호 종류가 든 응답" = 도면의 기호 하나가 `symbol: 'elevator'`인 스냅숏.
  - ① 첫 읽기에 모르는 기호 종류 → `updateRequired` 참, `error` `null`, `snapshot`은 빈 것, `execute`는 `/업데이트/`로 거절되고 게이트웨이의 `execute`가 불리지 않는다(호출 수 0). `console.warn`이 **정확히 한 번** 불리고 인자가 `['[background] update required:', '사물 기호가 올바르지 않습니다.', 'value "elevator"']`. 같은 응답으로 `refresh()`를 두 번 더 → 둘 다 거짓, `updateRequired` 참인 채, 호출 수 **1 그대로**.
  - ② 정상으로 읽은 뒤 모르는 키(`future`)가 든 응답 → `refresh()` 거짓, `updateRequired` 참, `snapshot`은 마지막으로 확인한 것 그대로, `console.warn` 한 번. 같은 응답으로 한 번 더 → 호출 수 그대로. 이어서 정상 응답 → `refresh()` 참, `updateRequired` 거짓. 그 뒤 모르는 키가 든 응답을 다시 → 호출 수 **2**.
  - ③ 기존 '조회 결과의 높이 값이 잘못되면…'(`:95-102`)에 `assert.equal(store.getState().updateRequired, false)` 한 줄과 `console.warn`이 불리지 않음을 더한다.
  - ④ `execute`의 응답과 복구 조회가 모두 모르는 종류를 담고 있을 때 → 거절, `updateRequired` 참, `pending` 거짓, `error` `null`, `snapshot`은 저장 전 것, `console.warn` 한 번.
- [ ] **Step 2: 실패를 확인한다** — 새 단언이 실패한다(`updateRequired`가 `undefined`, `error`가 문장).
- [ ] **Step 3: 저장소** — import에 `BackgroundUnsupportedError`. 아래 조각은 **띄어쓰기까지 이 글자로** 쓴다(앵커 46이 읽는다): `error instanceof BackgroundUnsupportedError` · `if (get().updateRequired) throw new Error('앱을 업데이트한 뒤 다시 저장해 주세요.');` · `if (!get().updateRequired) console.warn('[background] update required:', `.
  - `BackgroundState`에 `/** The stored library holds a kind, key or value this version does not know: nothing is shown and nothing is saved until the app is updated. */ updateRequired: boolean;`. 처음 상태와 `initialize`의 `set`에 `updateRequired:false`.
  - `refresh`: 성공의 `set`에 `updateRequired:false`를 함께. `catch`에서 (낡은 응답이 아니면 — 지금의 `version===generation&&ticket===readTicket` 조건 안에서) `error instanceof BackgroundUnsupportedError`이면 `if (!get().updateRequired) console.warn('[background] update required:', error.message, error.detail);` 뒤에 `set({ loading: false, updateRequired: true, error: null })`, 아니면 지금처럼 `set({ loading: false, error: message(error) })`. `snapshot`은 어느 쪽이든 건드리지 않는다.
  - `execute`: 로그인 검사(`throw new Error('로그인이 필요합니다.')`) **다음 줄에** 위의 `if (get().updateRequired) throw …` — 게이트웨이를 부르지 않는다. 실패 복구에서: 응답 검증이 던진 것이 `BackgroundUnsupportedError`면 그것을, 아니면 복구 조회(`active.read()`·`validateBackgroundSnapshot(canonical)`)가 던진 것이 그 클래스면 그것을 기억해 둔다(지금의 `catch{/* retain last confirmed state */}`가 오류를 받게 한다). `mapSaveWasApplied`로 완료를 알아보는 줄은 **그 앞에 그대로** 둔다. 기억한 것이 있으면 `if (!get().updateRequired) console.warn('[background] update required:', 그오류.message, 그오류.detail);` 뒤에 `set({ snapshot: restored, pending: false, updateRequired: true, error: null })`, 없으면 지금처럼 `error: message(error)`. 어느 쪽이든 원래 오류를 다시 던진다.
  - `console.warn`은 **거짓에서 참으로 바뀌는 그때에만** 부른다(두 곳 모두 `set` 바로 앞의 `if (!get().updateRequired)`). 새 상태 칸을 더 만들지 않는다.
- [ ] **Step 4: 화면** — 저장소에서 `updateRequired`를 함께 읽는다(`:31`). 머리줄의 상태 글자: `pending` → `loading` 다음에 `updateRequired ? "업데이트 필요"`. `updateRequired`면 **탭 줄(`<nav className="bg-library-tabs" …>`)·오류 띠·본문(`bg-loading`과 `bg-library-body`)을 그리지 않고** 그 자리에 아래 하나를 그린다(글자 그대로. `.bg-empty`와 이미 import된 `RefreshCw`를 쓴다 — 새 CSS 없음). 탭 줄과 본문은 `updateRequired`가 아닐 때의 가지에만 있다:
  ```tsx
  <div className="bg-empty" role="alert">
    <RefreshCw size={28} strokeWidth={1.4} aria-hidden="true" />
    <h3>업데이트가 필요해요</h3>
    <p>이 PC의 B flow보다 새 버전에서 만든 도면 자료가 저장돼 있어서, 지금 버전으로는 배경 화면을 열 수 없어요. 화면 왼쪽 아래의 버전 버튼을 눌러 업데이트한 뒤 다시 열어 주세요. 저장된 자료는 그대로 안전하고, 업데이트하기 전까지 이 PC에서는 보거나 고칠 수 없어요.</p>
    <button type="button" className="bg-button bg-primary" disabled={loading || refreshing} onClick={() => void refresh()}>다시 확인</button>
  </div>
  ```
  머리줄의 새로고침 버튼은 그대로 둔다(같은 `refresh`).
- [ ] **Step 5: 자가 점검** — `useBackgroundStore.ts`: `console.warn('[background] update required:'`가 정확히 2곳이고 둘 다 `if (!get().updateRequired) console.warn(`의 꼴 · `error instanceof BackgroundUnsupportedError` 1곳 이상 · `if (get().updateRequired) throw` 1곳. `BackgroundLibraryView.tsx`: `업데이트가 필요해요`·`다시 확인`·`업데이트 필요` 각 1곳, `<BackgroundMapEditor`는 여전히 1곳.
- [ ] **Step 6:** `node --test tests/backgroundStore.test.ts` → 통과(기존 열 개는 `:95-102`의 한 줄 말고는 손대지 않고 통과).
- [ ] **Step 7:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 8: 커밋** — 세 파일 / `배경 도면 ③: 앱이 모르는 종류가 저장돼 있으면 오류 대신 "업데이트가 필요해요" — 탭과 본문을 내리고 저장을 막으며, 까닭은 안내가 켜질 때 콘솔에 한 번 남긴다`

**v1.132.0과 달라지는 것(되살리지 말 것):** 읽은 자료에 이 버전이 모르는 키·종류가 있으면 빨간 오류 띠와 "그 전 자료로 그린, 편집되는 본문" 대신 안내 하나가 뜬다. 안내가 뜬 동안 `execute`는 게이트웨이를 부르지 않고 거절한다. **안내가 뜨는 순간 편집기가 화면에서 내려가므로 그 세션의 저장하지 않은 편집은 사라진다**(알고 넘어간다 — 완료 보고). 깨진 값은 지금처럼 빨간 띠다.
**이 Task가 끝나면 편집기는:** 평소에는 v1.132.0과 같다. 미리보기 저장소에 모르는 종류를 심으면 안내가 뜬다(관문 A).

### 관문 A — 업데이트 안내 U1~U4 (Task 6 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

방법: 설계 11절 머리말(`npm run dev:renderer` + `npm run preview:electron`, Electron 33, 미리보기 시험 계정, **실제 입력**). **전용 포트(다른 세션이 쓰지 않는 주소)에서 한다** — 미리보기 저장소 키 `bflow-background-library-preview-v1`은 같은 주소의 모든 빌드가 함께 쓰고, 여기에 모르는 종류를 심으면 그 주소에서 v1.132.0 이하의 코드를 띄운 다른 세션은 라이브러리 전체를 거절한다(설계 5.3). 함께 쓰는 주소밖에 없으면 시작할 때 키의 값을 떠 두고 끝나면 되돌린다.

| 확인 | 봐야 할 것 | 다르면 |
|---|---|---|
| U1 ★ 저장소에서 기호 하나의 `symbol`을 `'elevator'`로 바꾸고 새로고침 버튼 | 탭과 본문이 사라지고 **'업데이트가 필요해요'** 안내와 '다시 확인'. 빨간 띠가 없다. 머리줄 '업데이트 필요'. 콘솔에 `[background] update required: 사물 기호가 올바르지 않습니다. value "elevator"` **한 줄**. 안내를 30초 넘게 띄워 두고 창 포커스를 두어 번 옮겨도 한 줄 그대로다 | 대체안 없음 — 다음 Task 전에 원인을 찾는다(@superpowers:systematic-debugging) |
| U2 노드에 모르는 키(`"future": 1`) / `x`를 `"a"`로 | 안내 / **빨간 오류 띠**(안내가 아니다) | 같다 |
| U3 안내가 뜬 채 저장소를 되돌리고 '다시 확인' | 본문이 돌아온다 | 같다 |
| U4 편집 중에 U1을 일으킨다(다른 탭에서 저장소를 고친다) | 안내로 바뀐다. 저장 버튼이 화면에 없다 | 같다 |
| U5 끝나면 심은 값을 되돌린다 | 본문이 돌아오고 콘솔에 새 줄이 없다. 저장소에 `elevator`·`future`가 남아 있지 않다 | — |

---

## Chunk 3: 계단 (설계 13절 3단계)

### Task 7: 계단 — 기호 목록과 이름으로 찾는 대체값, 평면 그림, 3D의 단, 기호 목록 제목

**Files:**
- Modify: `src/features/backgrounds/symbolCatalog.ts`, `src/features/backgrounds/BackgroundSymbolGlyph.tsx`, `src/features/backgrounds/map3dScene.ts`(`buildSymbol`), `src/features/backgrounds/BackgroundMapEditor.tsx`(기호 목록의 제목과 `title` 둘)
- Test (Create): `tests/backgroundMapElements.test.ts`
- Test: `tests/backgroundMap3dScene.test.ts`

**Read first:** 설계 6.1~6.4 전부, 2.1의 8~10행, 10.1의 `tests/backgroundMap3dScene.test.ts:182-186` 행(반복 목록의 순서와 그 까닭), 10.4의 첫 불릿, 10.7의 '계단' 불릿, 10.9의 앵커 48 · `symbolCatalog.ts` 전체 · `BackgroundSymbolGlyph.tsx:16-66` · `map3dScene.ts:474-539`(`part` 도우미, `bed` 가지, 마지막 `else`, 선택 윤곽, 대리 상자) · 편집기 `:979-981` · 3D 테스트 `:38-49`(픽스처), `:180-200`, `:793-848`(자원 수·해제).

- [ ] **Step 1: 새 테스트 파일(10.4의 첫 불릿)** — `tests/backgroundMapElements.test.ts`. import는 `node:test`·`node:assert/strict`, `'../src/features/backgrounds/symbolCatalog.ts'`, 그리고 `import type { BackgroundSymbolKind } from '../src/features/backgrounds/types.ts'`뿐(지금은 — 뒤 Task가 이 파일에 테스트를 더한다). `getSymbolPreset('desk'|'sofa'|'cabinet'|'plant').id`가 `'custom'` · `getSymbolPreset('stairs')`가 `{ id: 'stairs', label: '계단', width: 120, height: 240 }`(`deepEqual`) · 모르는 문자열(`'piano' as BackgroundSymbolKind`) → `'custom'` · `symbolCatalog.map(item => item.id)`가 `['door','chair','table','bed','stairs','custom']`.
- [ ] **Step 2: 3D 테스트(10.1·10.7)** — `:182-186`: `parts`에 `stairs: ['stairs-step']`. 반복 목록을 `['door', 'chair', 'table', 'bed', 'stairs', 'custom', 'desk', 'sofa', 'cabinet', 'plant']`로(**`'plant'`가 마지막** — 반복 바로 뒤의 "없앤 종류는 기타 사물로 그린다" 줄이 마지막으로 맞춘 종류를 본다). 반복 안에 한 줄: 종류가 `'stairs'`가 아니면 `assert.ok(!root.getObjectByName('stairs-step'), kind)`. 새 테스트 하나(계단):
  - 높이 180(기본) → `stairs-step` 메시 **10개**, 몸통 크기 `[가로, 180, 세로]`. `volumeHeight` 20·54 → 3단, 63 → 4단, 288·1000 → 16단.
  - 단의 `scale.y`가 `1/N … 1`로 오르고, 가장 높은 단의 세계 z가 가장 낮은 단보다 **작다**(평면 위쪽으로 오른다). `rotation: 90`이면 오르는 쪽도 돈다(가장 높은 단의 세계 x·z로 확인).
  - 모든 단의 geometry가 다른 기호(의자)의 상자와 **같은 객체** · `pickTargets`에 단 전부(`pickPart: 'solid'`)와 대리 상자(`'box'`) · 선택하면 `selection-outline`이 생긴다 · 계단이 든 장면을 `dispose`하면 `resourceCount()`가 모두 0.
- [ ] **Step 3: 실패를 확인한다** — 새 파일: `getSymbolPreset('stairs').id`가 `'custom'`이라 실패. 3D: `stairs-step`을 찾지 못해 실패.
- [ ] **Step 4: `symbolCatalog.ts`** — 바뀌는 것은 두 줄뿐이다. `bed` 다음·`custom` 앞에 `{ id: "stairs", label: "계단", width: 120, height: 240 },`, 대체값은 `return symbolCatalog.find(item => item.id === symbol) ?? symbolCatalog.find(item => item.id === "custom")!;`. **`symbolCatalog: ReadonlyArray<{ id: BackgroundSymbolKind; … }>`의 타입 표기는 그대로 둔다**(빼면 `getSymbolPreset(…).id`가 `string`이 되어 편집기 세 곳의 typecheck가 깨진다).
- [ ] **Step 5: `BackgroundSymbolGlyph.tsx`** — `bed` 가지 다음, `custom` 가지 앞에 가지 하나(글자 그대로). `vectorEffect`·`<pattern>`·`foreignObject`를 쓰지 않는다(선 굵기는 다른 기호처럼 그림 단위다):
  ```tsx
  {symbol === "stairs" && (
    <>
      <rect x={10} y={4} width={80} height={92} fill="currentColor" fillOpacity={0.06} />
      <path d="M10 19.33H90M10 34.67H90M10 50H90M10 65.33H90M10 80.67H90" strokeWidth={2} opacity={0.65} />
      <path d="M50 86V16M40 28L50 14L60 28" />
      <circle cx={50} cy={88} r={3.5} fill="currentColor" stroke="none" />
    </>
  )}
  ```
- [ ] **Step 6: `map3dScene.ts`의 `buildSymbol`** — `kind === 'bed'` 가지 다음, 마지막 `else`(점선 상자) 앞에(글자 그대로). 새 geometry·재질이 없다(공용 상자와 `symbol`·`symbolOn`). 대리 상자는 줄이지 않는다(문만 줄인다):
  ```ts
  } else if (kind === 'stairs') {
    // Solid steps from the floor up, the lowest at the plan bottom (+Z) and the highest at the plan top (-Z), where the plan arrow points.
    const steps = Math.min(16, Math.max(3, Math.round(tall / 18)));
    for (let index = 0; index < steps; index++) part('stairs-step', -0.5, 0.5, 0, (index + 1) / steps, 0.5 - (index + 1) / steps, 0.5 - index / steps);
  }
  ```
- [ ] **Step 7: 편집기** — 기호 버튼의 `title="문과 사물 기호"` → `title="문·계단·사물 기호"`, 목록 제목 `<div className="bmap-palette-heading">문과 사물</div>` → `문·계단·사물`. 그 밖(놓기 `placeSymbol`, 속성 칸, 아래 줄 힌트 `계단 놓을 곳을 클릭 · Esc 취소`)은 기존 식이 만든다 — 고치지 않는다.
- [ ] **Step 8:** 두 테스트 파일 → 통과. `tests/backgroundMap3dScene.test.ts:793-848`은 손대지 않고 통과.
- [ ] **Step 9:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 10: 커밋** — 여섯 파일 / `배경 도면 ③: 기호 '계단' — 평면은 디딤판 줄무늬와 화살표, 3D는 높이에 따라 3~16단. 기호 목록의 대체값은 자리 아닌 이름(custom)으로 찾는다`

**v1.132.0과 달라지는 것(되살리지 말 것):** 기호 목록이 여섯 개다(계단이 다섯째, 제목 '문·계단·사물'). 목록에 없는 종류의 대체값은 "마지막 항목"이 아니라 `custom`이다 — 옛 종류 넷(책상·소파·수납장·화분)은 여전히 '기타 사물'이고 계단이 되지 않는다. 평면의 디딤판은 늘 다섯 줄, 3D의 단 수는 높이에서 정한다(둘을 맞추지 않는다). 위·아래층 연결은 없다.
**이 Task가 끝나면 편집기는:** 기호 목록에서 계단을 골라 평면·3D 바닥에 놓을 수 있다(이름 '계단', 120×240, 높이 180). 경첩·열림 버튼은 나오지 않는다. 미리보기에서는 저장된다. **운영 서버는 요소 파일을 적용하기 전까지 계단이 든 저장을 22023으로 거절한다** — 배포 순서(DB 먼저)가 그것을 막는다.

### 관문 B — 계단의 엔진 확인 E1·E2 (Task 7 뒤 · **오케스트레이터가 한다**)

방법은 관문 A와 같다(전용 포트). 이 관문부터 미리보기 저장소에 새 모양이 들어간다 — 그 주소에서는 v1.132.0 이하의 코드를 띄우지 않는다.

| 확인 | 봐야 할 것 | 다르면 (설계 14.2) |
|---|---|---|
| E1 ★ 계단을 의자·침대 옆에 놓고 10%·100%·400%에서 본다. 가로·세로를 크게 다르게 늘인다 | 계단의 선이 **다른 기호와 같은 식으로** 굵어지고 가늘어진다. 디딤판 다섯 줄과 화살표가 상자를 따라 늘어난다. 120×240에서 가로줄이 세로줄보다 굵은 것이 침대와 같은 정도다 | 계단만 무겁거나 가벼우면 디딤판의 굵기(2)와 불투명도(0.65)만 고친다. `vector-effect`는 넣지 않는다 |
| E2 ★ 도구줄의 기호 버튼·기호 목록·오브젝트 목록·속성 칸 미리보기의 계단 아이콘을 다른 다섯과 나란히 | 16~28px에서도 줄무늬와 화살표로 읽히고 무게가 이웃과 어울린다 | 읽히지 않으면 디딤판을 세 줄(y 27, 50, 73)로 줄이고 굵기를 3.2로(모든 자리에서 같은 그림). **같은 변경에서** 설계 6.2·11절 E1·14.3의 "다섯 줄" 서술을 고치고, Task 18의 앵커 48이 읽을 `d` 글자와 완료 보고의 그 줄도 바뀐 그림에 맞춘다 |
| S1~S7(설계 11절 '계단')은 최종 수동 검증에서 본다 — 여기서 미리 보아도 된다 | | |

---

## Chunk 4: 도로 — 순수 부분 (설계 13절 4단계)

### Task 8: 도로의 판별·벽 높이·가운데 선 (`mapSpatial.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapSpatial.ts`
- Test: `tests/backgroundMapElements.test.ts`

**Read first:** 설계 7.1, 7.4의 "`roadCentreLine`이 정하는 것" 표·띠 규칙·조건 표 (가)~(라)·그 아래 불릿 전부·"설계 중 계산한 값" 표·`roadCentrePlanLine`, 10.4의 둘째~다섯째 불릿(조건별 변형 표 포함), I2, 14.4의 첫 두 불릿 · `mapSpatial.ts:40-43`(`rotatePlan`), `:61-65`, `:202-213`(`spaceOutline` — 가운데 선은 이 틀이다) · `mapGeometry.ts:244-255`(`containsPoint`의 다각형 가지 — (라)가 같은 식을 쓴다).

- [ ] **Step 1: 테스트를 쓴다(10.4)** — import에 `isRoadSpace, spaceWallHeight, roadCentreLine, roadCentrePlanLine, nodeVolumeHeight`(mapSpatial)와 `containsPoint`(mapGeometry). 도로는 `{ …공간, surface: 'road' }`, 다각형의 점은 `(가로 비율, 세로 비율)`, 값은 1e-9 안에서 견준다.
  - `isRoadSpace`: `surface: 'road'`만 참, 키가 없으면 거짓. `spaceWallHeight`: 방 → `nodeVolumeHeight`와 같다(없으면 180, 있으면 그 값), 도로 → 0(`volumeHeight: 400`이 있어도).
  - `roadCentreLine` — **선이 나오는 줄**: 300×100 사각형 `[(-150,0),(150,0)]` / 100×300 사각형 `[(0,-150),(0,150)]` · 300×100 네 점 `(0,0)(1,0)(1,1)(0,1)`(점 순서를 뒤집어도) `[(-150,0),(150,0)]` · 100×300 네 점 `[(0,-150),(0,150)]` · 200×200 네 점 `[(-100,0),(100,0)]` · 200×200 ㄱ자 `(0,0)(1,0)(1,1)(0.6,1)(0.6,0.4)(0,0.4)` → `[(-100,-60),(60,-60),(60,100)]`, 시작 점을 하나 민 `(1,0)(1,1)(0.6,1)(0.6,0.4)(0,0.4)(0,0)` → `[(60,100),(60,-60),(-100,-60)]` · 300×100 여섯 점 띠 `(0,0)(0.5,0)(1,0)(1,1)(0.5,1)(0,1)` → `[(-150,0),(0,0),(150,0)]`, 하나 민 `(0.5,0)(1,0)(1,1)(0.5,1)(0,1)(0,0)` → `[(150,0),(0,0),(-150,0)]` · 400×200 두 번 꺾인 길 `(0,0)(0.5,0)(0.5,0.6)(1,0.6)(1,1)(0.3,1)(0.3,0.4)(0,0.4)` → `[(-200,-60),(-40,-60),(-40,60),(200,60)]` · 300×200 ∧ 모양 `(0,0.5)(0.5,0)(1,0.5)(1,1)(0.5,0.5)(0,1)` → `[(-150,50),(0,-50),(150,50)]` · 200×100 평행사변형 `(0,0)(0.5,0)(1,1)(0.5,1)` → `[(-50,-50),(50,50)]` · 400×100 조금 어긋난 짝 `(0,0)(0.25,0)(1,0)(1,1)(0.35,1)(0,1)` → `[(-200,0),(-80,0),(200,0)]` · 200×200 육각형 `(0.25,0)(0.75,0)(1,0.5)(0.75,1)(0.25,1)(0,0.5)` → `[(0,-100),(0,0),(0,100)]`.
  - **`null`인 줄**: 400×100 크게 어긋난 짝 `(0,0)(0.25,0)(1,0)(1,1)(0.45,1)(0,1)`과 아래 점만 `(0.75,1)`인 것 · 400×100 한쪽 옆줄에만 두 점 `(0,0)(0.25,0)(0.75,0)(1,0)(1,1)(0,1)` · 200×200 바깥 모서리만 둥글린 ㄱ자 `(0,0)(0.75,0)(0.925,0.075)(1,0.25)(1,1)(0.75,1)(0.75,0.2)(0,0.2)` · 400×100 끝이 뾰족한 길 `(0,0.5)(0.25,0)(0.75,0)(1,0.5)(0.75,1)(0.25,1)` · 300×100 나비넥타이 `(0,0)(1,1)(1,0)(0,1)` · 300×300 십자 `(0.3,0)(0.7,0)(0.7,0.3)(1,0.3)(1,0.7)(0.7,0.7)(0.7,1)(0.3,1)(0.3,0.7)(0,0.7)(0,0.3)(0.3,0.3)` · 300×250 T자 `(0,0)(1,0)(1,0.32)(0.6,0.32)(0.6,1)(0.4,1)(0.4,0.32)(0,0.32)` · 300×100 두 끝 변에 점을 더한 것 `(0,0)(1,0)(1,0.5)(1,1)(0,1)(0,0.5)` · 200×160 육각형(위와 같은 여섯 점) · 300×300 뒤엉킨 여덟 점 `(0.8,0.7)(0.2,0.7)(0,0.3)(0.7,0)(0.3,0.6)(0.6,0.6)(0,0.2)(0.7,0.2)` · 삼각형 · 다섯 점 `(0,0)(0.5,0)(1,0)(1,1)(0,1)` · 200×200 오목 사각형 `(0,0)(0.5,0.4)(1,0)(0.5,1)` · 타원 · 방(같은 모양에서 `surface`만 뺀 것) · 가로가 `NaN`·0인 도로.
  - **성질**: 선이 나온 모든 줄에서 `roadCentrePlanLine`의 구간 가운데 점마다 `containsPoint(space, 점)`이 참(회전 0·37·90·250). `roadCentreLine`은 `rotation`을 읽지 않는다(같은 공간에 회전 0·37·90·250 → `deepEqual`).
  - `roadCentrePlanLine`: (100, 100, 300×100) 도로 → `[(100,150),(400,150)]`, `rotation: 90`이면 `[(250,0),(250,300)]`(1e-9). 방·타원 도로 → `null`.
- [ ] **Step 2: 실패를 확인한다** — `does not provide an export named 'isRoadSpace'`(파일 전체 — Task 7의 테스트까지 함께 실패하는 것이 정상이다).
- [ ] **Step 3: 구현한다** (시그니처와 주석은 글자 그대로. `mapGeometry.ts`를 import하지 않는다)
  ```ts
  /** Whether a space is a road: a wall-less floor that lies under every other space. */
  export function isRoadSpace(space: BackgroundSpace): boolean { return space.surface === 'road'; }
  /** Height of the walls a space is drawn with and takes up in the world: none for a road. `nodeVolumeHeight` stays what is stored. */
  export function spaceWallHeight(space: BackgroundSpace): number { return isRoadSpace(space) ? 0 : nodeVolumeHeight(space); }
  /**
   * Centre line of a road in the frame of spaceOutline (centred on the box centre, not rotated), or null when the space
   * is no road or its shape has none.
   */
  export function roadCentreLine(space: BackgroundSpace): BackgroundPoint[] | null;
  /** The same line as absolute plan points (turned with the space). */
  export function roadCentrePlanLine(space: BackgroundSpace): BackgroundPoint[] | null;
  ```
  - `roadCentreLine`: 도로가 아니거나 가로·세로가 유한한 양수가 아니면 `null` · 사각형과 "점이 셋 미만이라 상자로 그려지는 다각형"은 긴 쪽을 따라 끝에서 끝까지(`width >= height`면 `[(-w/2, 0), (w/2, 0)]`, 아니면 `[(0, -h/2), (0, h/2)]` — 정사각형은 가로) · 타원은 `null` · 다각형은 점이 홀수면 `null`, 짝수(`n = 2k`)면 **띠 규칙**.
  - **띠 규칙**: `P = spaceOutline(space)`. 시작 번호 `s = 0 … k−1`을 차례로: `A_i = P[(s+i) % n]`, `B_i = P[(s−1−i+2n) % n]`, `M_i = (A_i + B_i) / 2` (`i = 0 … k−1`). 아래 넷을 **모두** 지나는 **가장 작은** `s`의 `[M_0 … M_{k−1}]`이 결과, 없으면 `null`.
    - (가) 칸마다 볼록: `i = 0 … k−2`마다 사각형 `A_i, A_{i+1}, B_{i+1}, B_i`의 네 모서리에서 잇닿은 두 변의 외적 부호가 넷 다 같고 0이 아니다.
    - (나) 안쪽 가로대가 길을 가로지른다: `i = 1 … k−2`마다 `R = B_i − A_i`, `T = M_{i+1} − M_{i−1}`에 대해 `|R·T| ≤ 0.5·|R|·|T|`이고 두 길이가 0보다 크다. **양 끝 가로대는 보지 않는다.**
    - (다) 선이 폭보다 길다: `Σ|M_{i+1} − M_i|`가 가장 긴 가로대 `|B_i − A_i|` 이상이고 0보다 크다.
    - (라) 선이 도로 안에 있다: 모든 구간의 가운데 점이 그 다각형 안(짝-홀 판정 — `containsPoint`의 다각형 가지와 같은 식을 이 틀의 점 `P`에 쓴 몇 줄을 이 함수 곁에 둔다).
  - `roadCentrePlanLine`: 위의 점들을 `space.rotation`만큼 돌려(`rotatePlan`) 공간 가운데(`x + width/2`, `y + height/2`)에 더한 것. 선이 없으면 `null`.
- [ ] **Step 4:** `node --test tests/backgroundMapElements.test.ts` → 통과. 한 줄이라도 어긋나면 조건을 설계 7.4의 글자대로 다시 본다(10.4의 표가 "어느 조건을 빼면 어느 줄이 무슨 값으로 실패하는지"를 적어 두었다 — 60°의 기준 방향이 `M_{i+1} − M_{i−1}`인 것, 양 끝을 보지 않는 것, 가장 작은 `s`).
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 6: 커밋** — 두 파일 / `배경 도면 ③: 도로의 판별(isRoadSpace)·벽 높이(spaceWallHeight)·가운데 선(roadCentreLine) — 곧은 길과, 두 옆줄의 점이 마주 보는 띠 모양 다각형에만 선이 있다`

**이 Task가 끝나면 편집기는:** Task 7과 같다(새 함수를 아직 쓰지 않는다).

### Task 9: 쌓임의 층, `setSpaceSurface`, 새 카메라의 소속, 도로에는 쓰지 않는 `volumeHeight` (`mapStack.ts`·`mapGeometry.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapStack.ts`(`stackedSpaces`), `src/features/backgrounds/mapGeometry.ts`(`setSpaceSurface` 새로, `addMapCamera`, `applyNodeWorldPose`)
- Test: `tests/backgroundMapStack.test.ts`, `tests/backgroundMapGeometry.test.ts`

**Read first:** 설계 3.3 전부(두 함수의 시그니처와 "둘 다:" 문단), 7.7의 코드 블록과 첫 두 불릿, 7.8 전부, 7.9의 `applyNodeWorldPose` 행, 10.3의 `stackedSpaces`·`addMapCamera`·`setSpaceSurface`·`applyNodeWorldPose`·"`surface`를 그대로 갖는다" 줄, 1.3의 R4·R8, I3·I5 · `mapStack.ts` 전체 · `mapGeometry.ts:54-77`, `:238-242`, `:257-266`, `:302-335` · `tests/backgroundMapStack.test.ts:10-30`(픽스처 `space(id, x, y, width, height, extra)`·`building()`) · `tests/backgroundMapGeometry.test.ts:217-255`(기대값을 **바꾸지 않는** 기존 테스트).

- [ ] **Step 1: 쌓임 테스트(10.3)** — 기존 `building()`에 `street = space('street', 0, 300, 1000, 80, { surface: 'road' })`(넓이 80000), `lane = space('lane', 480, 0, 40, 680, { surface: 'road' })`(27200)를 더한 도면에서:
  - `stackedSpaces`(배열 순서를 섞어도): `['street', 'lane', 'site', 'floor', 'room', 'closet']`.
  - `patch = space('patch', 0, 0, 10, 10, { surface: 'road' })`와 `site` → `['patch', 'site']`(어느 순서로 주든 — 작은 도로도 큰 방 아래).
  - `spaceStackRanks`: `street 0, lane 1, site 2, floor 3, room 4, closet 5`.
  - `spacesAt((490, 340))`: `['room', 'floor', 'site', 'lane', 'street']` · `spacesAt((490, 20))`: `['site', 'lane']` · 도로만 있는 도면 `[street, lane]`의 (490, 340): `['lane', 'street']`.
  - 넓이가 `NaN`인 도로는 도로 층의 맨 아래이고 방보다 위로 오지 않는다. 받은 노드 그대로(`===`) 돌려주고 `map.nodes`를 바꾸지 않는다.
- [ ] **Step 2: 기하 테스트(10.3)**
  - `addMapCamera`(생성점 (500, 340). 기존 `room`·`far`·`hall`에 `street`·`lane`을 위와 같은 값으로): `[street]` → `'street'` · `[street, room]`·`[room, street]` → `'room'` · `[street, lane, room]` → `'room'` · `[street, room, hall]` → `null` · `[street, lane]` → `null` · `[far, street]` → `'street'`.
  - `setSpaceSurface`: 방 → 도로는 `surface: 'road'`가 생기고 다른 키는 `deepEqual` · 도로 → 방은 `Object.hasOwn(next, 'surface')`가 거짓이고 `volumeHeight` 등은 그대로 · **`setSpaceSurface(방, null) === 방`**(`surface` 키가 없는 방), `setSpaceSurface(도로, 'road') === 도로` · 잠긴 공간은 받은 객체(`===`) · 받은 객체를 고치지 않는다.
  - `applyNodeWorldPose`(자세의 `position`·`quaternion`은 `nodeWorldPose(도로)`의 것 그대로, `scale`만 바꾼다): 도로(`volumeHeight` 없음)에 `scale: { x: 1, y: 3, z: 1 }` → 받은 도면 그대로(`===`) · `scale: { x: 2, y: 3, z: 1 }` → 그 노드가 `{ ...road, x: road.x - road.width / 2, width: road.width * 2 }`와 `deepEqual`이고 `Object.hasOwn(next, 'volumeHeight')`가 거짓 · `volumeHeight: 240`이 저장된 도로에 `{ x: 1, y: 3, z: 1 }` → 받은 도면 그대로이고 240이 남는다 · 같은 자세를 방에 주면 지금처럼 `volumeHeight`가 540.
  - `rectToPolygon(도로)`·`polygonFromWorldPoints(도로, …)`·`transformMapSpace`로 옮긴 도로가 `surface: 'road'`를 그대로 갖는다(이 셋은 **고치지 않고** 통과해야 한다).
- [ ] **Step 3: 실패를 확인한다** — 쌓임: 층이 없어 순서가 넓이순으로 나온다(`['site', 'floor', 'street', …]`). 기하: `does not provide an export named 'setSpaceSurface'`.
- [ ] **Step 4: `mapStack.ts`** — `import { isRoadSpace } from './mapSpatial.ts';`를 더하고 `stackedSpaces`의 두 줄만 바꾼다(글자 그대로):
  ```ts
  return { space, index, layer: isRoadSpace(space) ? 0 : 1, area: Number.isFinite(area) ? area : Infinity };
  …
  return entries.sort((a, b) => a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area).map(entry => entry.space);
  ```
  머리말 주석에 "a road lies under every room" 한마디를 더한다. `spaceStackRanks`·`spacesAt`·`spacePlanArea`는 고치지 않는다.
- [ ] **Step 5: `mapGeometry.ts`** — import에 `isRoadSpace`(mapSpatial)와 타입 `BackgroundSpaceSurface`.
  ```ts
  /** A space as a road, or as a room again (`surface` null). The key is written only for a road and removed for a room. The same object back when nothing changes or the space is locked. */
  export function setSpaceSurface(space: BackgroundSpace, surface: BackgroundSpaceSurface | null): BackgroundSpace;
  ```
  - 규칙: 잠겼거나 `(space.surface ?? null) === surface`이면 받은 객체 그대로. 값이 있으면 `{ ...space, surface }`. 지울 때는 `const next = { ...space }; delete next.surface; return next;`. `undefined`·`null`을 값으로 쓰지 않는다.
  - `addMapCamera`(글자 그대로):
    ```ts
    const containing = map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && containsPoint(node, created));
    // A road lies under what stands on it: the rooms decide first, and a road is joined only where no room holds the point.
    const rooms = containing.filter(space => !isRoadSpace(space)), candidates = rooms.length ? rooms : containing;
    const camera: BackgroundCamera = candidates.length === 1 ? { ...created, spaceId: candidates[0].id } : created;
    ```
  - `applyNodeWorldPose`의 `box`: `volumeHeight: node.type === 'space' && isRoadSpace(node) ? null : settle(volumeHeight * scale.y, volumeHeight, limits.volumeHeight.min, limits.volumeHeight.max) };`
- [ ] **Step 6:** 두 테스트 파일 → 통과. `tests/backgroundMapGeometry.test.ts:217-255`와 `tests/backgroundMapStack.test.ts`의 기존 테스트는 기대값을 바꾸지 않고 통과해야 한다.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** PGlite로 계약 테스트 → fail 0, skipped 0(그 파일은 `addMapCamera`·`applyNodeWorldPose`를 PGlite 실행 부분에서만 부른다).
- [ ] **Step 9:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 5(3D·보조 평면도·평면 선택 테스트는 손대지 않고 통과 — 도로가 없는 도면의 순서는 그대로다).
- [ ] **Step 10: 커밋** — 네 파일 / `배경 도면 ③: 도로는 크기와 무관하게 모든 방 아래에 쌓인다 — 쌓임 순서의 맨 앞 항(층), 키를 쓰고 지우는 setSpaceSurface, 새 카메라는 방이 먼저·없으면 도로, 도로에는 입체 높이를 쓰지 않는다`

**v1.132.0과 달라지는 것(되살리지 말 것):** 쌓임 순서의 비교에 층이 맨 앞 항으로 들어간다 — 쌓임 순서를 읽는 여섯 곳(평면 그리기, `planPileAt`, 보조 평면도, `pickMapFloor`, `mapFloorPile`, `placeSymbol`)이 **읽는 줄을 고치지 않고** 따라온다. 새 카메라의 소속은 생성점을 품은 **방**만 먼저 세고, 방이 없을 때만 도로를 센다(도로가 없는 도면에서는 예전과 같다). 3D 기즈모의 결과는 도로에 `volumeHeight`를 쓰지 않는다.
**이 Task가 끝나면 편집기는:** 도로를 만드는 화면은 아직 없다. 저장돼 있던 도로(미리보기 저장소에 손으로 넣은 것)는 평면·보조 평면도·3D에서 방 아래에 쌓이지만 아직 방의 모습(보라, 벽)으로 그려진다.

### Task 10: 보조 평면도의 말과 값 — `planKindLabel`, 도로의 읽어 주는 값, 옆 그림 (`mapPlanPreview.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapPlanPreview.ts`
- Test: `tests/backgroundMapPlanPreview.test.ts`

**Read first:** 설계 7.5의 둘째~넷째 불릿, 7.9의 마지막 행, 10.5 · `mapPlanPreview.ts:19`, `:181-215`, `:230-255` · `tests/backgroundMapPlanPreview.test.ts:317-320`, `:331-333`(손대지 않고 통과해야 하는 기존 검사).

- [ ] **Step 1: 테스트를 쓴다(10.5)** — `planKindLabel`: 도로 `'도로'`, 방 `'공간'`, 기호 `'기호'`, 카메라 `'카메라'` · `planNodeLabel(도로)` → `'이름, 도로'` · `planVolumeReadout(도로)`: `kind: '도로'`, `items`가 바닥 높이 한 줄뿐(`key: 'floor'`) · `planNodeSummary(도로)` → `'이름 · 바닥 높이 0'` · `planSideView`: 도로(바닥 0, `volumeHeight: 400` 저장)만 있는 도면의 결과가 **공간이 없는 도면의 결과와 `deepEqual`** / 카메라가 그 도로에 속해도(`spaceId`) `room`이 `null` / 바닥 300인 도로는 범위를 300까지 넓힌다(공간 없는 도면과 `camera.y`가 달라진다 — 기본 카메라(높이 120)면 35.33…(= 62 − 120/180·40) → 46(= 62 − 120/300·40). `floorY`는 62 그대로다: 0보다 낮은 것이 없으면 바닥선은 움직이지 않는다) / 방과 도로(바닥이 방의 범위 안)가 함께 있으면 방만 있을 때와 같은 결과.
- [ ] **Step 2: 실패를 확인한다** — `does not provide an export named 'planKindLabel'`.
- [ ] **Step 3: 구현한다** — import에 `isRoadSpace`(mapSpatial).
  - `/** What a node is called on the companion plan: a road is a space with a name of its own. */ export function planKindLabel(node: BackgroundNode): string` — 도로(`node.type === 'space' && isRoadSpace(node)`)면 `'도로'`, 아니면 `PLAN_KIND_LABELS[node.type]`. **`PLAN_KIND_LABELS` 표는 그대로 둔다**(설계는 이 함수의 시그니처를 글자로 주지 않았다 — 이 줄이 그것이다).
  - `planNodeLabel`·`planCameraReadout`·`planVolumeReadout`이 `planKindLabel(node)`를 쓴다.
  - `planVolumeReadout`: 도로면 `items`가 `{ key: 'floor', label: '바닥 높이', … }` 한 줄뿐(입체 높이 줄이 없다). `planNodeSummary`는 고치지 않아도 `이름 · 바닥 높이 N`이 된다.
  - `planSideView`: 도로는 **바닥 높이만** 범위에 넣는다(`top = floor`), "공간이 하나도 없을 때의 기본 눈금" 판정(`spaces`)에서 세지 않고, 카메라가 속해 있어도 `own`을 만들지 않는다(`room`은 `null`).
- [ ] **Step 4:** `node --test tests/backgroundMapPlanPreview.test.ts` → 통과(`:317-320`·`:331-333` 포함 기존 것은 그대로).
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 6: 커밋** — 두 파일 / `배경 도면 ③: 보조 평면도가 도로를 '도로'로 읽고 바닥 높이만 말한다 — 옆에서 본 그림은 도로의 저장된 입체 높이를 쓰지 않는다`

**v1.132.0과 달라지는 것(되살리지 말 것):** 보조 평면도가 읽어 주는 종류 이름은 표(`PLAN_KIND_LABELS`)가 아니라 `planKindLabel`을 지난다. 도로의 `volumeHeight`는 저장돼 있어도 읽어 주는 값·옆 그림의 범위에 들지 않는다.
**이 Task가 끝나면 편집기는:** Task 9와 같고, 저장돼 있던 도로를 3D 옆 평면도에서 고르면 '도로'와 바닥 높이만 읽어 준다(모습은 아직 방이다).

---

## Chunk 5: 도로 — 화면 (설계 13절 5단계)

### Task 11: 두 공간이 평면에서 겹치는가 — `spacesOverlap` (`mapStack.ts`), 큰 방 안의 도로의 누름 고정

**Files:**
- Modify: `src/features/backgrounds/mapStack.ts`
- Test: `tests/backgroundMapStack.test.ts`, `tests/backgroundMapPlanSelect.test.ts`(더하기만 — `mapPlanSelect.ts`는 고치지 않는다)

**Read first:** 설계 7.6의 "'겹친다'의 판정 — `spacesOverlap`" 코드 블록과 그 아래 불릿 넷(뜻·방법·셈의 양·광선의 맞춤 점으로 가르지 않는 까닭), 10.3의 `spacesOverlap` 표(22줄)와 `resolvePlanPress` 표, 7.7의 "큰 공간 안에 통째로 든 도로" 문단, I4·I5, 14.4의 `spacesOverlap` 줄 · `mapSpatial.ts:239-257`(`nodePlanOutline` — 타원은 48각형) · `mapPlanSelect.ts:113-161`(`resolvePlanPress`) · `tests/backgroundMapPlanSelect.test.ts`의 기존 `resolvePlanPress` 테스트 꼴.

- [ ] **Step 1: `spacesOverlap` 테스트(10.3의 표 전부)** — `space(id, x, y, width, height, 바꿀 값)` 꼴. `길` = 도로 (0, 300, 1000×80). **줄마다 두 인자를 바꿔 불러도 같은 값**이어야 한다(도우미로 양쪽을 함께 단언한다).
  - 거짓: (25, 380, 150×150)·길(변만 맞닿음) / (25, 379.99999999999994, 150×150)·길(반올림 한 걸음) / (39.999999999, 100, 100×100)·도로 (0, 0, 40×680)(띠 폭의 여유) / (1000, 380, 100×100)·길(모서리) / (25, 500, 150×150)·길(떨어짐) / 마름모 (100, 380, 100×100, 점 `(0.5,0)(1,0.5)(0.5,1)(0,0.5)`)·길 / 타원 (100, 380, 200×100)·길 / 45° 돌린 (100, 460, 150×150)·길 / ㄱ자 (900, 200, 300×300, 점 `(0,0)(1,0)(1,1)(0.4,1)(0.4,0.3)(0,0.3)`)·도로 (0, 300, 1010×80) / ㄷ자 (0, 0, 300×300, 점 `(0,0)(1,0)(1,1)(0.7,1)(0.7,0.3)(0.3,0.3)(0.3,1)(0,1)`)·그 홈 안의 도로 (90, 90, 120×210) / (25, 300, `NaN`×150)·길.
  - 참: (25, 379.99, 150×150)·길(0.01만큼 걸침) / (300, 200, 200×150)·도로 (0, 0, 1000×680)(통째로) / (0, 300, 100×80)·길(변을 함께 쓰며 겹침) / (0, 300, 1000×80)·길(같은 윤곽) / (0, 0, 2×2)·도로 (1, 0, 2×2)(반씩 걸친 둘) / (400, 0, 200×680)·길(십자) / 위의 마름모를 y 370으로 / 위의 타원을 y 375로 / 45° 돌린 (100, 400, 150×150)·길 / 비스듬한 띠 (500, −50, 220×1000, 점 `(0,0)(20/220,0)(1,1)(200/220,1)`)·도로 (−1000, 0, 2000×10) / 나비넥타이 (0, 0, 300×100, 점 `(0,0)(1,1)(1,0)(0,1)`)·도로 (−100, −100, 500×300).
- [ ] **Step 2: `resolvePlanPress` 테스트 둘(10.3 — 지금의 규칙이 큰 방 안의 도로에 어떻게 나타나는지를 고정한다. 소스를 고치지 않으므로 처음부터 통과한다)** — 맨 위 노드가 방 `yard`, 더미가 `['yard', 'inner']`(`inner`는 도로), 선택이 `inner` 하나, 편집 중, Shift 없음. `again` 거짓 → `drag: 'move'`, `nodeId: 'yard'`, `selectAtPress: 'yard'`, `click.kind: 'none'`(**방이 움직인다**). `again` 참 → `drag: 'move'`, `nodeId: 'inner'`, `selectAtPress` 없음, `click`이 `{ kind: 'step', ids: ['yard', 'inner'], from: 'inner', spaces: true }`.
- [ ] **Step 3: 실패를 확인한다** — `tests/backgroundMapStack.test.ts`가 `does not provide an export named 'spacesOverlap'`로 실패. `tests/backgroundMapPlanSelect.test.ts`는 통과(새 둘 포함).
- [ ] **Step 4: 구현한다** — `mapStack.ts`의 import를 `import { isRoadSpace, nodePlanOutline } from './mapSpatial.ts';`로 넓히고(`BackgroundPoint` 타입은 이미 있다), 설계 7.6의 블록을 **글자 그대로** 옮긴다(상수·머리말 주석·본문의 주석 넷 포함):
  ```ts
  /** Slack of the overlap test, in plan units: outlines that only share an edge or a corner, or miss each other by rounding, do not overlap. */
  const OVERLAP_SLACK = 1e-6;
  /**
   * Whether two spaces share ground on the plan: an area, not only an edge or a corner. Read from the outlines the 3D
   * floors and the companion plan are drawn with (an ellipse as its 48-gon; the plan itself draws the true ellipse);
   * where an outline crosses itself, inside is counted the way containsPoint counts it.
   */
  export function spacesOverlap(a: BackgroundSpace, b: BackgroundSpace): boolean { /* 설계 7.6의 본문 그대로 */ }
  ```
  - 규칙 한 줄: 두 윤곽의 꼭짓점과 **모든 변의 짝**(한 윤곽의 변끼리도)이 만나는 점의 x로 세로 띠를 나누고, 폭이 `OVERLAP_SLACK`보다 넓은 띠마다 한가운데 세로선이 두 윤곽의 안(홀짝)을 지나는 구간이 `OVERLAP_SLACK`보다 길게 겹치면 참. 윤곽에 유한하지 않은 값이 있거나 점이 셋 미만이면 거짓. "한쪽의 모서리가 다른 쪽 안에 있는가"로 바꾸지 않는다.
- [ ] **Step 5:** 두 테스트 파일 → 통과(22줄 × 양쪽 순서).
- [ ] **Step 6:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 7: 커밋** — 세 파일 / `배경 도면 ③: 두 공간이 평면에서 넓이를 나눠 갖는가(spacesOverlap) — 변이나 모서리만 맞닿은 것은 겹친 것이 아니다. 큰 방 안의 도로를 누를 때의 지금 규칙을 테스트로 고정한다`

**이 Task가 끝나면 편집기는:** Task 10과 같다(`spacesOverlap`을 아직 쓰지 않는다).

### Task 12: 3D의 도로 — 벽 없는 바닥과 가운데 점선, 팔레트·재질, 범위, 높이 손잡이 없음

**Files:**
- Modify: `src/features/backgrounds/map3dScene.ts`(`Map3DPalette`·`MAP3D_DARK_PALETTE`, `MaterialKey`와 `material()`, `shapeKey`, `buildSpace`, `mapWorldBounds`, import), `src/features/backgrounds/BackgroundMap3D.tsx`(`readPalette`, `applyGizmo`), `src/features/backgrounds/BackgroundMapCameraGizmo.ts`(`mapGizmoSetup`, `MapGizmoTarget`, `setTarget`), `src/features/backgrounds/backgrounds-map.css`(변수 블록의 **도로 쪽 두 줄**)
- Test: `tests/backgroundMap3dScene.test.ts`, `tests/backgroundMapElements.test.ts`

**Read first:** 설계 7.6의 `buildSpace` 블록과 그 아래 불릿(벽 없는 바닥 ~ 누름 대상), 7.9 전부, 8.3의 변수 블록과 "이 블록은 두 단계에 나뉘어 들어간다" 문단, 10.7의 '도로'·'범위'·'기즈모'·'`flat`이 손잡이까지 닿는다'·'도로 색은 테마의 CSS 변수에서 온다' 불릿, 10.6의 셋째 불릿(도로의 두 값), 10.9의 앵커 44 · `map3dScene.ts:20-33`, `:47-49`, `:88-94`, `:365-410`, `:445-471`, `:692-701` · `BackgroundMap3D.tsx:34-49`, `:428-437` · `BackgroundMapCameraGizmo.ts:14-22`, `:34`, `:245-257` · 3D 테스트 `:119-162`(방의 벽), `:886-896`, `:1141-1147`·`:1774-1776`(기즈모 손잡이), `:2456-2466`(테마).

- [ ] **Step 1: 테스트를 쓴다(10.7·10.6)**
  - **도로**(장면): `space-floor`·`space-outline`이 있고 **`space-walls`가 없다** · 사각형 도로에 `road-centre`(꼭짓점 2), ㄱ자 도로에 꼭짓점 4, 타원 도로에는 없다 · 바닥의 `renderOrder`가 −1.5이고 방은 −1 · 모든 꼭짓점의 세계 높이가 바닥 높이다(`elevation: 30`이면 30) · `pickTargets`에 도로의 것은 바닥 하나(`pickPart: 'floor'`) · 선택하면 바닥 재질의 불투명도가 커지고(0.28 → 0.44) 테두리가 방의 선택 테두리와 **같은 재질 객체** · 잠그면 테두리가 점선 재질이고 `lineDistance` 속성이 있다 · 방 → 도로로 바꿔 다시 맞추면 벽이 사라지고, 되돌리면 돌아온다(뿌리 객체는 같다).
  - **범위**: 도로(`volumeHeight: 500` 저장)만 있는 도면의 `mapWorldBounds().max.y`가 0.
  - **기즈모(순수)**: `mapGizmoSetup('space', 'scale', true)` → `showY: false`, `showX`·`showZ` 참 · `('space', 'rotate', true)`·`('space', 'translate', true)`는 둘째 인자만 준 것과 `deepEqual` · `('symbol', 'scale', true)`도 `showY: false` · 셋째 인자가 없으면 기존 결과 그대로(`:886-896` 불변).
  - **`flat`이 손잡이까지**: 하니스(`gizmoHarness`) — `gizmo.setTarget({ id, type: 'space', root, flat: true }, 'scale')` 뒤 `[controls.showX, controls.showY, controls.showZ]`가 `[true, false, true]`, 같은 대상을 `flat` 없이 다시 주면 `[true, true, true]`, `flat: true`에 `'translate'`·`'rotate'`는 `flat` 없는 결과와 같다. 뷰포트(`mountViewport`) — 도로가 든 도면에서 `editor.render({ selectedId: 도로, gizmoMode: 'scale' })` → `transform.showY` 거짓, `showX`·`showZ` 참. 그 도로의 `surface` 키를 지운 같은 노드를 다시 주면 `showY` 참. 방을 고르면 처음부터 참.
  - **테마의 도로 색**(기존 'viewport: theme changes repaint…'에 더한다): 도면에 사각형 도로 하나를 넣고 `themeValues`에 `'--bmap-road': '93 100 112'`와 `'--bmap-road-mark': '58 63 71'`을 더한 뒤 변경 관찰자를 돌리고 한 프레임 → 그 도로의 `space-floor` 재질 색이 `0x5d6470`, `road-centre` 재질 색이 `0x3a3f47`. `themeValues`를 비우고 다시 돌리면 `0x9aa1ad`·`0xe3e6ec`.
  - **CSS와 팔레트**(`tests/backgroundMapElements.test.ts` — `readFileSync`로 `backgrounds-map.css`를 글자로 읽고 `MAP3D_DARK_PALETTE`를 import한다): `--bmap-road:154 161 173`과 `--bmap-road-mark:227 230 236`이 있고 그 숫자 셋이 `MAP3D_DARK_PALETTE.road`(`0x9aa1ad`)·`roadMark`(`0xe3e6ec`)와 같은 색이다. 밝은 화면 줄에 `--bmap-road:93 100 112`·`--bmap-road-mark:58 63 71`이 있다. **도로 값은 선언 글자(`--bmap-road:154 161 173`, `--bmap-road-mark:227 230 236`, 밝은 화면의 두 값)를 부분 문자열로 찾는다 — 규칙 줄 전체(`.bmap-layout { … }`)를 고정하지 않는다**(Task 17이 그 줄의 앞에 카메라 변수를 더한다. 밝은 화면의 값은 `[data-color-mode="light"] .bmap-layout`으로 시작하는 줄에서 찾는다).
- [ ] **Step 2: 실패를 확인한다** — 3D 테스트의 새 단언들이 실패한다(도로에 `space-walls`가 있다, `showY`가 참 등). 요소 테스트는 CSS에 변수가 없어 실패.
- [ ] **Step 3: 팔레트와 재질** — `Map3DPalette`에 `road: number; roadMark: number;`, `MAP3D_DARK_PALETTE`에 `road: 0x9aa1ad, roadMark: 0xe3e6ec`. `MaterialKey`에 `'roadFloor' | 'roadFloorOn' | 'roadLine' | 'roadLineLocked' | 'roadCentre'`, `material()`의 `switch`에: `roadFloor` `flat(palette.road, 0.28)` · `roadFloorOn` `flat(palette.road, 0.44)` · `roadLine` `line(palette.road, 0.75)` · `roadLineLocked` `dash(palette.road, 0.75, 12, 7)` · `roadCentre` `dash(palette.roadMark, 0.9, 14, 10)`. import에 `isRoadSpace, roadCentreLine, spaceWallHeight`(mapSpatial).
- [ ] **Step 4: `buildSpace`·`shapeKey`·`mapWorldBounds`** — `buildSpace`의 앞부분을 설계 7.6의 블록대로: `const road = isRoadSpace(node), height = spaceWallHeight(node);`(도로는 0), 바닥 재질은 `this.material(road ? (selected ? 'roadFloorOn' : 'roadFloor') : (selected ? 'spaceFloorOn' : 'spaceFloor'))`, 그리고 글자 그대로:
  ```ts
  // Under the floors of the rooms, over the underlay: where a road and a room overlap the order never depends on the view.
  floor.renderOrder = road ? -1.5 : -1;
  if (road) {
    // A wall-less floor: its outline on the floor, and the dashed centre line where the shape has one.
    const edges = new LineSegments(entry.own.track(segments(outline.flatMap((a, index) => { const b = outline[(index + 1) % count]; return [a.x, 0, a.y, b.x, 0, b.y]; }))),
      this.material(node.locked ? (selected ? 'spaceDashOn' : 'roadLineLocked') : (selected ? 'spaceLineOn' : 'roadLine')));
    if (node.locked) edges.computeLineDistances();
    floor.name = 'space-floor'; edges.name = 'space-outline';
    tag(floor, node.id, 'space', 'floor'); entry.picks.push(floor);
    entry.root.add(floor, edges);
    const line = roadCentreLine(node);
    if (line) {
      const centre = new LineSegments(entry.own.track(segments(line.slice(1).flatMap((to, index) => [line[index].x, 0, line[index].y, to.x, 0, to.y]))), this.material('roadCentre'));
      centre.computeLineDistances(); centre.name = 'road-centre';
      entry.root.add(centre);
    }
    return;
  }
  ```
  그 아래(방의 벽·테두리)는 지금 그대로. `shapeKey`의 공간 줄 끝에 `|${isRoadSpace(node) ? 'road' : ''}`. `mapWorldBounds`에서 공간의 위쪽은 `base + spaceWallHeight(node)`(기호는 지금처럼 `nodeVolumeHeight`).
- [ ] **Step 5: 기즈모와 뷰포트** — `export function mapGizmoSetup(type: BackgroundNode['type'], mode: Map3DGizmoMode, flat = false): MapGizmoSetup | null` — `flat`이고 `scale`이면 `showY: false`, 그 밖은 지금과 같다(카메라의 `scale`은 여전히 `null`). `export type MapGizmoTarget = { id: string; type: BackgroundNode['type']; root: Object3D; flat?: boolean };`. `setTarget`: `const setup = target ? mapGizmoSetup(target.type, mode, target.flat) : null;`. `BackgroundMap3D.tsx`의 `applyGizmo`가 넘기는 대상에 `flat: node.type === 'space' && isRoadSpace(node)`(import에 `isRoadSpace`). `readPalette`에 `road: hex('--bmap-road', base.road), roadMark: hex('--bmap-road-mark', base.roadMark)`(`base`에서 그냥 채우지 않는다 — 밝은 화면 값이 CSS 한 곳에만 있다).
- [ ] **Step 6: CSS 변수(도로 쪽만)** — `backgrounds-map.css`의 첫 줄(`.bmap-layout { display:flex; …}`) 바로 다음에 세 줄. 카메라 쪽(`--bmap-cam`·`--bmap-cam-mark`와 `[data-camera-color]` 줄들)은 Task 17이 이 블록에 더한다:
  ```css
  /* Colours of the map editor that are no theme colour: one camera (default = the amber it always was), and the road. */
  .bmap-layout { --bmap-road:154 161 173; --bmap-road-mark:227 230 236; }
  [data-color-mode="light"] .bmap-layout { --bmap-road:93 100 112; --bmap-road-mark:58 63 71; }
  ```
- [ ] **Step 7:** 두 테스트 파일 → 통과. 방의 벽(`:119-162`)·자원 해제(`:793-848`)·기존 누름 테스트는 손대지 않고 통과.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음(`Map3DPalette`를 만드는 곳이 모두 두 키를 채웠는지 여기서 드러난다). `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 9: 커밋** — 여섯 파일 / `배경 도면 ③: 3D의 도로는 벽 없는 납작한 바닥 — 회색 바닥과 테두리, 가운데 점선, 방보다 먼저 그리는 순서, 범위에는 바닥만, 크기 방식에 높이 손잡이 없음`

**v1.132.0과 달라지는 것(되살리지 말 것):** 3D에서 `surface: 'road'`인 공간은 벽·지붕이 없고 `renderOrder` −1.5로 방(−1)보다 먼저 그려진다. 맞춤·위에서 보기의 범위에 도로의 저장된 `volumeHeight`가 들지 않는다. 도로의 크기 방식에는 높이 방향 손잡이(Y, XY, YZ)가 없다. 방의 모습과 손잡이는 그대로다.
**이 Task가 끝나면 편집기는:** 저장돼 있던 도로가 3D에서 회색 바닥으로 보인다. 평면과 보조 평면도는 아직 방의 모습이고, 도로 위에 선 건물의 벽을 누르면 뒤의 도로가 잡힌다(Task 13이 고친다).

### Task 13: 3D의 누름 — 도로는 자기와 겹친 방에 지고, 그 방의 벽 너머로는 다시 눌러 내려간다

**Files:**
- Modify: `src/features/backgrounds/map3dScene.ts`(`roadsUnderRooms` 새로, `pickMapNode`, `mapSpacePile` 새로, `mapClickStep`의 한 줄과 주석 둘), `src/features/backgrounds/BackgroundMap3D.tsx`(`pick`의 한 줄, import)
- Test: `tests/backgroundMap3dScene.test.ts`, `tests/backgroundMapEditorWiring.test.ts`(앵커 31의 글자 한 곳)

**Read first:** 설계 7.6의 "누름 — 도로는 자기 위에 선 방에 진다"부터 끝까지(돌려 본 것의 표, `pickMapNode` 블록과 불릿, `roadsUnderRooms`의 자리, `mapSpacePile` 블록·쓰는 곳 두 줄·결과 표·더블클릭), 10.7의 '누름' 표(17줄 — 아래 Step 1의 표는 "도로 바닥 하나 / 둘" 두 줄을 한 줄로 적었다)·장면 셋·뷰포트 셋, 10.1의 앵커 31 행과 "손대지 않고 통과해야 하는 것", 1.3의 R8, I4, 14.4의 3D 줄들 · `map3dScene.ts:587-689` · `BackgroundMap3D.tsx:8`, `:545-575` · 3D 테스트 `:77`(`cast`), `:316-319`(`aim`), `:850`(`viewerFor`), `:1866-1893`(`mountViewport`·`clickNth`·`partsUnder`·`selects`·`opened`), `:2009-2058`(손잡이 위의 클릭) · 앵커 테스트 `:495-528`.

- [ ] **Step 1: 맞춤 표의 테스트(10.7)** — import에 `mapSpacePile`. 맞춤은 기존 `hit(nodeId, pickPart, distance, nodeKind)` 꼴(`point` 없음). 조각: `도로` = 도로 (0, 0, 1000×680) · `방` = (300, 200, 200×150) · `큰 방` = (100, 100, 700×500) · `둘째 방` = (600, 400, 100×100) · `옆 방` = (0, 680, 300×100)(도로의 아래 변에 붙었다 — 겹치지 않는다) · `골목` = 도로 (480, 0, 40×680)(방과 겹친다) · `먼 골목` = 도로 (900, 0, 40×680)(방과 겹치지 않는다). **카메라·기호가 나오는 줄의 `map`에는 그 노드도 넣는다.**

  | `map` | 맞춤(가까운 것부터) | `pickMapNode(hits, map)` | `mapSpacePile(hits, map)` | 그 밖 |
  |---|---|---|---|---|
  | 도로, 방 | 같은 거리의 바닥 둘 | 방(도면 순서를 바꿔도, 도로가 방 안의 조각 (350, 250, 20×20)이어도) | `[방, 도로]` | `pickMapFloor` → 방, `mapFloorPile` → `[방, 도로]` |
  | 도로, 방 | **방의 벽, 도로 바닥** | **방** | **`[방, 도로]`** | `map` 없이 부르면 도로. `mapFloorPile` → `[도로]`, `pickMapFloor` → 도로(고치지 않았다). `resolveMapClick(map, 방, hits, true)` → **도로**, `(map, 도로, hits, true)` → 방. `again` 거짓이면 선택이 방·도로·`null` 어느 것이든 방. `again`·`repeat` 모두 참이면 선택 그대로. `mapClickAim(map, 방, hits, true)` → 방, `(map, 도로, hits, true)` → 도로, `(map, 도로, hits, false)` → 방 |
  | 도로, 옆 방 | **옆 방의 벽, 도로 바닥** | **도로** | **`[도로]`** | 선택이 옆 방·도로·`null` 어느 것이든, `again`이 참이든 거짓이든 `resolveMapClick` → 도로 |
  | 도로, 골목, 방 | 방의 벽, 같은 거리의 도로 바닥 둘(도로·골목) | 방 | `[방, 골목, 도로]` | 그 셋을 선택으로 `resolveMapClick(…, true)` → 차례로 골목, 도로, 방 |
  | 도로, 먼 골목, 방 | 방의 벽, 같은 거리의 도로 바닥 둘(도로·먼 골목) | **먼 골목** | `[먼 골목, 도로]`(`mapFloorPile`과 같다) | |
  | 도로(`elevation: 200`), 방 | **올린 도로의 바닥, 방의 바닥** | **방** | `[도로, 방]`(`mapFloorPile`과 같다) | `pickMapFloor` → 도로. `resolveMapClick(map, 방, hits, true)` → 도로, `(map, 도로, hits, true)` → 방, `again` 거짓이면 어느 쪽에서든 방 |
  | 도로(`elevation: 200`), 옆 방 | 올린 도로의 바닥, 옆 방의 바닥 | **도로** | `[도로, 옆 방]` | |
  | 도로, 골목, 방 | 도로 바닥 하나 / 도로 바닥 둘(같은 거리: 도로·골목) | 도로 / 골목 | `[도로]` / `[골목, 도로]` | |
  | 도로, 큰 방, 방 | 방의 벽, 큰 방의 바닥, 도로 바닥 | 큰 방 | `[큰 방, 도로]` | `resolveMapClick(map, 방, hits, true)` → 큰 방, `(map, 큰 방, hits, true)` → 도로 |
  | 도로, 둘째 방, 방 | 두 방의 벽(둘째 방이 가깝다), 도로 바닥 | 둘째 방 | `[둘째 방, 도로]` | |
  | 도로, 옆 방, 방 | 두 방의 벽(옆 방이 가깝다), 도로 바닥 | 옆 방 | `[옆 방, 도로]` | |
  | 도로, 방 | 방의 벽만 | 방 | `[]` | |
  | 도로, 방, 기호, 카메라 | 기호의 대리 상자(`'box'`), 도로 바닥 / 카메라, 도로 바닥 | 기호 / 카메라 | `[도로]` | |
  | 도로, 방, 기호, 카메라 | 기호의 대리 상자, 방의 벽, 도로 바닥 / 카메라, 방의 벽, 도로 바닥 | 기호 / 카메라 | `[도로]` — 방을 넣지 않는다 | |
  | 큰 방, 방(도로 없음) | 방의 벽, 큰 방의 바닥 | 큰 방 | `[큰 방]` | `resolveMapClick(map, 방, hits, true)` → 큰 방(v1.132.0과 같다) |
  | 어느 것이든 | 빈 맞춤 | `null` | `[]` | |
- [ ] **Step 2: 장면 테스트 셋(10.7)** — ① **넓은 도로 위의 건물**: 도로 (0, 0, 1000×680) 위에 방 (300, 200, 200×150, 높이 180). `cast(scene, [400, 300, 800], [0, -300, 180 - 800])` — 맞춤에 그 방의 `'wall'`만 있고 `'floor'`가 없으며 도로의 `'floor'`가 있음을 먼저 확인 → `pickMapNode`가 방, `mapSpacePile`이 `[방, 도로]`. 그 도로의 `surface`를 지운 같은 장면에서는 `pickMapNode`가 큰 공간이고 `mapSpacePile`이 `[큰 공간]`. ② **길가의 건물(길에 붙여 세웠다)**: 길 = 도로 (0, 300, 1000×80), 눈 쪽 건물 다섯 = 방 (25 + 200·i, 380, 150×150), 먼 쪽 다섯 = 방 (25 + 200·i, 150, 150×150), i = 0…4. 보는 곳 `viewerFor(fitMapView(map, 1.6), 1.6)`. 길 한가운데 (500, 0, 340)을 겨눈 광선: 맞춤의 노드가 눈 쪽 셋째 건물(`'wall'`만)과 길(`'floor'`만) 둘뿐임을 확인 → **`pickMapNode`가 길**, `mapSpacePile`이 `[길]`, `resolveMapClick(map, 선택, hits, true)`가 선택 `null`·그 건물·길 어느 것에서든 길. 표본 392점(`x = 9 + 17.85·ix`, `ix` 0…55, `z = 306 + 11.3·iz`, `iz` 0…6)마다 처음 잡히는 것이 길이고 `mapSpacePile`이 `[길]`, 그 가운데 눈 쪽 건물의 `'wall'` 맞춤이 든 점이 **196을 넘는다**(수를 글자로 고정하지 않는다). 같은 392점을 `viewerFor(topDownMapView(map, 1.6), 1.6)`에서 겨누어도 모두 길. ③ **눈 쪽 건물 다섯을 길 쪽으로 1만큼 옮긴 것**(y 379): 같은 392점에서 처음 잡히는 것이 길이거나 눈 쪽 건물 하나다. 건물인 **모든** 점에서 그 건물의 맞춤이 `'wall'`뿐이고 `mapFloorPile`이 `[길]`, `mapSpacePile`이 `[그 건물, 길]`, `resolveMapClick(map, 그 건물, hits, true)`가 길, `(map, 길, hits, true)`가 그 건물. 길인 점과 건물인 점이 모두 있고 건물인 점이 더 많다. 길 한가운데의 광선: `pickMapNode`가 눈 쪽 셋째 건물, 선택 `null`·그 건물·길에서 차례로 그 건물·**길**·그 건물.
- [ ] **Step 3: 뷰포트 테스트 셋(10.7)** — ① **건물 벽 너머의, 그 건물 밑 도로**(위 ①의 도면, 800×500, `canEdit: false`, 누르는 점 `editor.at(400, 0, 180)` — `partsUnder`로 건물 `{'wall'}`·도로 `{'floor'}`를 먼저 확인): 천천히 세 번(`clickNth` 세 번) → 건물 → **도로** → 건물 · 빠른 두 번(`detail` 1, 2)과 `dblclick` → `selects`가 `[건물, 건물]`, `opened`가 `[건물]`(도로에 `childMapId`를 연결한 도면에서도 `[건물]`) · 도로에 상세 도면을 연결하고 천천히 두 번 눌러 도로까지 내려간 뒤 그 점을 더블클릭 → `opened`가 `[도로]` · `selectedId: 도로`로 연 뷰포트에서 그 점을 처음 누르면 건물 · `viewport.topDown()`·`editor.frame()` 뒤 `editor.at(400, 0, 120)`(`partsUnder`로 건물의 맞춤이 없음을 확인)을 누르면 도로. ② **건물 옆의 도로**(위 ②의 도면에서 길에 상세 도면을 연결, 누르는 점 `editor.at(500, 0, 340)` — 눈 쪽 셋째 건물 `{'wall'}`·길 `{'floor'}` 확인, `canEdit: false`): 천천히 세 번 → `selects`가 `[길, 길, 길]`. 이어서 빠른 두 번과 `dblclick` → `opened`가 `[길]`. ③ **손잡이 위의 클릭**(위 ①의 도면, 편집 중 — `BackgroundMap3D.tsx`의 한 줄은 이 테스트만 지킨다): 누르는 점 `editor.handle(건물, 'Y', 0.3)`(건물을 고른 뷰포트에서 한 번 구해 같은 기본 보기의 뷰포트들에 쓴다. `partsUnder`로 건물 `{'wall'}`·도로 `{'floor'}` 확인). 그 점을 `clickNth`로 누르면 건물. `editor.frame()`·`editor.move(점)` 뒤 `editor.dev().transform.axis`가 `'Y'`임을 확인하고 같은 점을 한 번 더 누르면 `selects`가 `[건물, 도로]`이고 미리보기·되돌리기·취소 수가 모두 0. `selectedId: 건물`로 연 뷰포트에서 같은 손잡이에 올린 뒤 처음 누르면 `selects`가 `[]`.
- [ ] **Step 4: 앵커 31의 글자(10.1)** — `tests/backgroundMapEditorWiring.test.ts:525`의 `inOrder` 가운데 글자 `'pile = mapFloorPile(hits, map);'` → `'pile = mapSpacePile(hits, map);'`, `:527`은 `count(step, /mapSpacePile\(/g)`가 1이고 `count(step, /mapFloorPile\(/g)`가 0. 그 앵커의 나머지 줄(`:497-523`)은 그대로.
- [ ] **Step 5: 실패를 확인한다** — 3D 테스트: `does not provide an export named 'mapSpacePile'`. 앵커 31: 실패.
- [ ] **Step 6: `map3dScene.ts`** — import에 `isRoadSpace`(mapSpatial — Task 12가 이미 넣었다)와 `spacesOverlap`(`'./mapStack.ts'`). `pickMapFloor` **다음**, `pickMapNode` 바로 앞에(글자 그대로):
  ```ts
  /** The roads on a ray that lie under a room on the same ray: the two share ground on the plan (spacesOverlap). */
  function roadsUnderRooms(hits: readonly MapPickHit[], map: BackgroundMap): Set<string> {
    const onRay = new Set<string>();
    for (const hit of hits) { const node = hitNode(hit); if (node?.kind === 'space') onRay.add(node.id); }
    const spaces = map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && onRay.has(node.id));
    const rooms = spaces.filter(space => !isRoadSpace(space));
    return new Set(spaces.filter(space => isRoadSpace(space) && rooms.some(room => spacesOverlap(room, space))).map(space => space.id));
  }
  export function pickMapNode(hits: readonly MapPickHit[], map?: BackgroundMap): string | null {
    // A road lies under the rooms that stand on it: where the ray also meets such a room, on its floor or on a wall and
    // at any height, the floor of that road takes no part in the click. Beside a room a road is a floor like any other.
    const under = map ? roadsUnderRooms(hits, map) : null;
    const list = under?.size ? hits.filter(hit => !under.has(String(hit.object.userData.nodeId))) : hits;
    // …지금의 본문 그대로, `hits` 자리에 `list`(`pickMapFloor(list, map)`까지)…
  }
  ```
  `mapFloorPile` **다음**에(글자 그대로):
  ```ts
  /**
   * The spaces a slow second click on one spot takes turns through: the floors under the pointer as mapFloorPile lists
   * them, and in front of them the room that the click picks on a wall when every floor behind that wall is a road
   * under a room on the ray. Without it such a road could not be reached there: the room takes every click.
   */
  export function mapSpacePile(hits: readonly MapPickHit[], map: BackgroundMap): string[] {
    const pile = mapFloorPile(hits, map), picked = pickMapNode(hits, map);
    // A picked space that is no floor under the pointer was hit on a wall, and then every floor there is a road set
    // aside by pickMapNode: any other floor would have been picked instead. A camera or an object on top is no part of
    // a pile of spaces.
    return picked !== null && pile.length > 0 && !pile.includes(picked) && map.nodes.some(node => node.id === picked && node.type === 'space') ? [picked, ...pile] : pile;
  }
  ```
  `mapClickStep`: `pile = mapFloorPile(hits, map);` → `pile = mapSpacePile(hits, map);`. 그 함수의 주석 둘을 바뀐 더미에 맞춘다 — ① `if (repeat)` 위의 세 줄 주석(`:667-669`): 바꿀 말 "its floor and the floor the click picks are both in the pile"는 **두 줄에 걸쳐 있다**(`:667`이 "…It keeps the selected space only while its floor"로 끝나고 `:668`이 "// and the floor the click picks are both in the pile: with a camera…"로 시작한다 — 한 줄짜리 찾기·Edit으로는 잡히지 않는다). 그 두 줄을 함께 다시 접어 "…It keeps the selected space only while it and what the click picks are both in the pile: with a camera or an object on top, …"로 읽히게 한다(`:669`와 문장의 나머지는 그대로) ② `// A space hit on a wall only is no part of the floors under the pointer.`(`:672`, `if (pile.length < 2 …` 바로 위) → `// A space hit on a wall only is no part of the pile, but for the room picked on a wall in front of the roads under it (mapSpacePile).` **`pickMapFloor`·`mapFloorPile`의 본문은 고치지 않는다**(기호를 놓는 자리와 바닥끼리의 순서 — 도로 규칙을 넣지 않는다).
- [ ] **Step 7: `BackgroundMap3D.tsx`** — `pick`의 `again ? mapFloorPile(hits, props.map) : []` → `again ? mapSpacePile(hits, props.map) : []`, import(`:8`)의 `mapFloorPile`을 `mapSpacePile`로(그 파일에서 더 쓰이지 않는다). 같은 자리인지를 정하는 줄, `doubleClickNode`, `floorPoint`는 고치지 않는다.
- [ ] **Step 8: 자가 점검** — `map3dScene.ts`: `function roadsUnderRooms(`가 `export function pickMapFloor(`와 `export function pickMapNode(` 사이 · `rooms.some(room => spacesOverlap(room, space))` 1곳 · `mapFloorPile(` 호출은 `mapSpacePile` 안의 하나뿐. `BackgroundMap3D.tsx`: `mapFloorPile` 0곳, `mapSpacePile` 2곳(import, `pick`).
- [ ] **Step 9:** 두 테스트 파일 → 통과. 기존 누름 테스트(`pickMapNode`·`pickMapFloor`·`mapFloorPile`·`resolveMapClick`·`mapClickAim`, 뷰포트 `:1834-2183`)와 앵커 21은 **손대지 않고** 통과해야 한다 — 실패하면 테스트가 아니라 구현을 본다.
- [ ] **Step 10:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 11: 커밋** — 네 파일 / `배경 도면 ③: 3D에서 도로는 자기와 평면에서 겹친 방에게만 진다 — 그 방의 벽 너머로는 같은 자리를 천천히 다시 눌러 내려가고(mapSpacePile), 건물 옆의 도로는 지금의 방처럼 한 번에 잡힌다`

**v1.132.0과 달라지는 것(되살리지 말 것):** `pickMapNode`의 맨 앞에 한 걸음이 생겼다 — 같은 광선에 맞은 방과 **평면에서 겹친 도로**의 바닥 맞춤만 뺀다(겹침 검사를 빼면 길가 건물이 길을 가로막는다). 다시 누를 때의 더미는 `mapFloorPile`이 아니라 `mapSpacePile`이고, 클릭(`mapClickStep`)과 손잡이 위의 클릭(`pick`)이 **둘 다** 그것을 부른다. 도로가 없는 도면과 `map` 없이 부르는 호출의 결과는 그대로다.
**이 Task가 끝나면 편집기는:** 3D에서 도로 위에 선 건물은 바닥·벽 어디를 눌러도 건물이 잡히고, 같은 자리를 천천히 다시 누르면 도로다. 평면에서는 아직 도로를 그릴 수 없다.

### Task 14: 편집기와 보조 평면도의 도로 — 도구, 그리기, '공간 종류', 높이 칸, 이름들, CSS

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/BackgroundMapPlanPreview.tsx`, `src/features/backgrounds/backgrounds-map.css`, `src/features/backgrounds/backgrounds-map-plan.css`
- Test: `tests/backgroundMapEditorWiring.test.ts`(앵커 26의 글자 한 곳), `tests/backgroundMapElements.test.ts`(10.6의 라·마·바)

**Read first:** 설계 7.2 전부, 7.3 전부(코드 블록 셋, 안내 표), 7.4의 그리기 블록과 그 아래 불릿 넷(회색 바닥·가운데 점선·이름·테두리 굵기), 7.5의 첫 두 불릿, 7.9의 속성 칸 행, 7.10, 9.4의 도로 규칙(두 CSS 표), 10.1의 앵커 26 행, 10.6의 라·마·바, 10.9의 앵커 40·41·43·44(Task 18이 읽을 글자 — 이 Task에서 그 글자로 쓴다) · 편집기 `:35`, `:79`, `:162`, `:165-178`, `:471-478`, `:615-617`, `:692`, `:721`, `:931-936`, `:1000-1007`, `:1061`, `:1072`, `:1083-1089`, `:1117-1121` · `BackgroundMapPlanPreview.tsx:43-52`, `:231` · `backgrounds-map.css:44-53` · `backgrounds-map-plan.css:19-34` · 앵커 테스트 `:392-413`.

- [ ] **Step 1: 테스트를 고치고 쓴다** — 앵커 26(`:404`)의 글자 `"const drawing = canEdit && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'symbol');"` → `"const drawing = canEdit && (isDrawTool(tool) || tool === 'symbol');"`, `:402-403`의 주석 "four drawing tools" → "five". 같은 앵커의 `mode = ` 셋은 그대로 통과해야 한다. `tests/backgroundMapElements.test.ts`에 CSS 검사 셋(두 CSS 파일을 글자로 읽고 `/\r?\n/`으로 줄을 나눈다): **라** `backgrounds-map.css`의 `.bmap-road-line {` 줄과 `backgrounds-map-plan.css`의 `.bmap-plan-road-line {` 줄이 각각 하나 있고 둘 다 `fill:none`과 `vector-effect:non-scaling-stroke`를 담는다 · **마** `backgrounds-map.css`의 `.bmap-space.is-road text {` 줄에 `stroke-width:calc(4px * var(--bmap-label-scale,1))`이 있다 · **바** `backgrounds-map-plan.css`에서 `.bmap-plan-space.is-road>polygon`의 자리가 `.bmap-plan-node:focus-visible>polygon`의 자리보다 **앞**이고(`indexOf`), `.bmap-plan-space.is-road:hover:not(:focus-visible)>polygon`이 있으며 `.bmap-plan-space.is-road:hover>polygon`이 없다.
- [ ] **Step 2: 실패를 확인한다** — 앵커 26과 새 CSS 검사 셋이 실패한다.
- [ ] **Step 3: 도로 도구(7.2)** — `type Tool`에 `'road'`. `isDrawTool`이 `'road'`도 센다(3D로 가면 선택 도구로 돌아간다). 도구줄(편집 중·평면)의 다각형 다음에 `{ id: 'road' as const, label: '도로', title: '도로: 끌어서 곧은 길 그리기 · 꺾이는 길은 그린 뒤 다각형으로 바꿔 점을 다듬어요', icon: '═' }`. 그리고 글자 그대로:
  ```ts
  function newSpace(shape: BackgroundSpace['shape'], origin: BackgroundPoint, road = false): BackgroundSpace {
    return { id: uuid(), type: 'space', name: road ? '새 도로' : '새 공간', placeId: null, childMapId: null, x: origin.x, y: origin.y, width: 10, height: 10, rotation: 0, shape, points: [], locked: false,
      ...(road ? { surface: 'road' as const } : {}) };
  }
  // pointerDown — 그리기 도구의 판정
  const drawing = canEdit && (isDrawTool(tool) || tool === 'symbol');
  // pointerDown — 그리기 세션
  if (canEdit && (tool === 'rect' || tool === 'ellipse' || tool === 'road')) { mode = 'draw'; target = newSpace(tool === 'road' ? 'rect' : tool, point, tool === 'road'); }
  ```
  그리는 모양은 사각형 하나다(`surface: road ? 'road' : undefined`로 쓰지 않는다 — 키가 `undefined`로 남아 저장이 거절된다). `pointerDown`의 `mode = ` 대입은 여전히 셋이다.
- [ ] **Step 4: 평면 그리기(7.4)** — 공간을 그리는 `stackedSpaces(current).map(node => {` 안에서(이 호출은 여전히 한 번, `shownIds.has(node.id)`는 셋): `const isSelected = shownIds.has(node.id), road = isRoadSpace(node), centre = roadCentreLine(node);` · `<g>`의 `className`을 `` `bmap-space ${road ? 'is-road ' : ''}${isSelected ? 'is-selected' : ''} ${node.locked ? 'is-locked' : ''}${node.id === renamingNode?.id ? ' is-renaming' : ''}` ``로 · `aria-label`을 `` `${node.name}${road ? ', 도로' : ''}${node.childMapId ? ', 상세 도면 연결' : ''}` ``로 · 사각형의 `rx`를 `rx={road ? 0 : 4}`로 · 모양 요소 **다음, 이름 `<text>` 앞에** `{centre && <polyline className="bmap-road-line" fill="none" points={centre.map(point => `${point.x + node.width / 2},${point.y + node.height / 2}`).join(' ')} />}`(`fill="none"` 속성을 뺀다면 스타일이 빠졌을 때 꺾인 길 안쪽이 검게 칠해진다). import에 `isRoadSpace, roadCentreLine`(mapSpatial)과 타입 `BackgroundSpaceSurface`, `setSpaceSurface`(mapGeometry).
- [ ] **Step 5: 방 ↔ 도로(7.3)** — 다른 모듈 상수 곁에(글자 그대로):
  ```ts
  // The last sentence is how to get hold of a road that another space covers: it cannot be pressed there directly.
  const ROAD_HINT = '도로는 벽 없는 바닥이에요. 다른 공간과 겹치면 늘 아래에 깔려요. 다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.';
  const ROAD_HINT_ROUND = '둥근 도로에는 가운데 점선이 없어요.';
  const ROAD_HINT_NO_STRIP = '가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요. 한쪽에 점을 더했으면 맞은편에도 하나 더해 주세요. 광장처럼 길 모양이 아닌 곳에는 그리지 않아요.';
  ```
  컴포넌트 안에(글자 그대로):
  ```ts
  function changeSpaceSurface(surface: BackgroundSpaceSurface | null) {
    if (!current || selected?.type !== 'space' || !canEdit) return;
    const next = setSpaceSurface(selected, surface);
    if (next !== selected) updateMap(replaceMapNode(current, next));     // one update, one undo step; the members stay where they are
  }
  ```
  속성 칸: 모양 줄 묶음(`bmap-shape-actions`) 다음, 카메라 가지 앞에 — **편집 중이면 평면·3D 모두**(글자 그대로):
  ```tsx
  {editing && selected.type === 'space' && <>
    <Field label="공간 종류"><select value={isRoadSpace(selected) ? 'road' : 'room'} disabled={fieldLocked || gestureActive}
      onChange={event => changeSpaceSurface(event.target.value === 'road' ? 'road' : null)}><option value="room">방</option><option value="road">도로</option></select></Field>
    <p className="bmap-hint">{isRoadSpace(selected) ? ROAD_HINT : '도로로 바꾸면 벽 없는 회색 바닥이 되고, 다른 공간 아래에 깔려요.'}</p>
    {/* The centre line is the look of a road: where the shape has none, say why, or it reads as a bug. */}
    {isRoadSpace(selected) && !roadCentreLine(selected) && <p className="bmap-hint">{selected.shape === 'ellipse' ? ROAD_HINT_ROUND : ROAD_HINT_NO_STRIP}</p>}
  </>}
  ```
  `patchNode({ surface … })`로 쓰지 않는다(합치기만 해서 지울 수 없다). 모양 줄의 안내: 사각형 **도로**일 때만 `꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.` 대신 `꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.`(사각형 방·다각형·타원은 지금 그대로, 묶음의 조건과 버튼도 그대로).
- [ ] **Step 6: 높이 칸과 이름들(7.9·7.3 끝)** — '높이' 묶음(`selected.type !== 'camera'`의 `<details>`): 도로면 머리줄 오른쪽 글자가 `입체 N` 대신 `바닥 N`(`Math.round(nodeElevation(selected))`), **`label="입체 높이"` 칸은 도로가 아닐 때의 가지에만** 그리고('바닥 높이' 칸 하나만 남는다 — `bmap-field-pair` 묶음은 그대로 둔다), 안내는 도로일 때 `바닥 높이를 바꾸면 이 도로에 속한 카메라와 사물도 같은 만큼 함께 오르내려요. 도로에는 벽이 없어서 입체 높이가 없어요.`(방·기호는 지금 문장 그대로). `kindLabel`의 공간 가지를 `node.type === 'space' ? (isRoadSpace(node) ? '도로' : '공간')`으로(목록의 종류 글자·접근성 이름, 이름 칸의 `도로 이름`이 따라온다). 속성 칸 머리 글자: `selected.type === 'space' ? (isRoadSpace(selected) ? '선택한 도로' : '선택한 공간') : …`. 오브젝트 목록의 아이콘: 도로면 모양과 무관하게 `'═'`.
- [ ] **Step 7: 보조 평면도(7.5)** — `PlanShape`: 도로(`node.type === 'space' && isRoadSpace(node)`)면 `<g>`의 클래스에 ` is-road`를 더하고, `<polygon points={points} />` **다음에** `roadCentrePlanLine(node)`가 있으면 `<polyline className="bmap-plan-road-line" fill="none" points={pointList(…)} />`(소수 둘째 자리 — 이 파일의 `pointList`). 읽어 주는 칸의 접근성 이름: `selected?.type === 'space' ? (isRoadSpace(selected) ? '선택한 도로' : '선택한 공간') : '선택한 기호'`. import에 `isRoadSpace, roadCentrePlanLine`.
- [ ] **Step 8: CSS(9.4의 도로 규칙. 전환·애니메이션·`backdrop-filter` 없음, `stroke-dasharray`·`stroke-width`는 아래에 적힌 곳 말고 적지 않는다)** — `backgrounds-map.css`: 십자 커서 목록에 `,.bmap-canvas.tool-road` · 공간의 기본 규칙 넷(`.bmap-space.is-locked>…`까지) **뒤에** 차례로
  `.bmap-space.is-road>rect,.bmap-space.is-road>ellipse,.bmap-space.is-road>polygon { fill:rgb(var(--bmap-road) / .22); stroke:rgb(var(--bmap-road) / .6); }`
  `.bmap-space.is-road:hover>rect,.bmap-space.is-road:hover>ellipse,.bmap-space.is-road:hover>polygon { fill:rgb(var(--bmap-road) / .3); stroke:rgb(var(--bmap-road)); }`
  `.bmap-space.is-road.is-selected>rect,.bmap-space.is-road.is-selected>ellipse,.bmap-space.is-road.is-selected>polygon { fill:rgb(var(--bmap-road) / .34); stroke:rgb(var(--color-accent-sub)); }`
  `.bmap-road-line { fill:none; stroke:rgb(var(--bmap-road-mark) / .85); stroke-width:1.5; stroke-dasharray:9 7; vector-effect:non-scaling-stroke; pointer-events:none; }`
  · 공간 이름 규칙 둘(`.bmap-space text.bmap-space-detail`까지) **뒤에** `.bmap-space.is-road text { paint-order:stroke; stroke:rgb(var(--color-bg-primary)); stroke-width:calc(4px * var(--bmap-label-scale,1)); stroke-linejoin:round; }`.
  `backgrounds-map-plan.css`: `.bmap-plan-space:hover>polygon` 줄 **바로 다음**(반드시 `.bmap-plan-node:focus-visible>polygon`보다 앞)에 차례로
  `.bmap-plan-space.is-road>polygon { fill:rgb(var(--bmap-road) / .24); stroke:rgb(var(--bmap-road) / .7); }`
  `.bmap-plan-space.is-road:hover:not(:focus-visible)>polygon { fill:rgb(var(--bmap-road) / .34); stroke:rgb(var(--bmap-road)); }`
  `.bmap-plan-road-line { fill:none; stroke:rgb(var(--bmap-road-mark) / .8); stroke-width:1; stroke-dasharray:4 3; vector-effect:non-scaling-stroke; pointer-events:none; }`
- [ ] **Step 9: 자가 점검** — 편집기: `stackedSpaces(current).map(` 1곳 · `<polyline className="bmap-road-line" fill="none"` 1곳이고 같은 `<g>`의 `<text`보다 앞 · `rx={road ? 0 : 4}` 1곳 · `setSpaceSurface(selected, surface)` 1곳 · `patchNode({ surface`·`surface: undefined`·`surface: null` 0곳 · `isRoadSpace(selected) ? ROAD_HINT :` 1곳 · `label="입체 높이"` 1곳 · `'선택한 도로'` 1곳. 보조 평면도: `<polyline className="bmap-plan-road-line" fill="none"` 1곳, `선택한 도로` 1곳.
- [ ] **Step 10:** 두 테스트 파일 → 통과(앵커 1~25·27~39는 손대지 않고 통과).
- [ ] **Step 11:** `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 12: 커밋** — 여섯 파일 / `배경 도면 ③: 도로를 그린다 — 그리기 도구 '도로', 회색 바닥과 가운데 점선, 속성 칸의 '공간 종류'(방 ↔ 도로), 바닥 높이만 있는 높이 칸, 보조 평면도의 도로`

**v1.132.0과 달라지는 것(되살리지 말 것):** 평면 도구줄(편집 중)에 '도로'가 생겨 이름 붙은 그리기 도구가 넷이다. 모든 공간의 속성 칸에 '공간 종류'가 나온다(평면·3D, 모양과 무관). 도로의 속성 칸에는 '입체 높이' 칸이 없다. 도로의 이름에만 글자 테두리가 있고(방의 이름은 그대로) 그 굵기는 글자처럼 `--bmap-label-scale`을 곱한다. `pointerDown`의 그리기 판정은 `isDrawTool`을 지난다. **큰 방 안에 통째로 그린 도로는 몸통을 바로 누를 수 없다** — 쌓임 규칙의 결과이며 고치지 않는다(속성 칸의 `ROAD_HINT`가 잡는 법을 말한다).
**이 Task가 끝나면 편집기는:** 도로 도구로 곧은 길을 그리면 회색 바닥과 가운데 점선이 보이고 이름 칸이 `새 도로`로 열린다. 방을 도로로 바꾸거나 되돌릴 수 있고(되돌리기 한 번씩), 평면·보조 평면도·3D가 같은 초안에서 같은 도로를 그린다.

### 관문 C — 도로의 엔진 확인 E3~E5와 R13 (Task 14 뒤 · **오케스트레이터가 한다**)

방법은 관문 A와 같다(전용 포트). 시험 도면은 설계 11절 머리말의 것(큰 도로 위의 건물, 세로 도로와의 교차, 상세 도면이 연결된 도로).

| 확인 | 봐야 할 것 | 다르면 (설계 14.2) |
|---|---|---|
| E3 ★ 도로의 가운데 점선과 그 위의 이름을 10%·25%·33%·100%·400%에서(가로·세로 도로, 상세 도면이 연결된 도로) | 점선의 길이와 굵기가 화면에서 같다. **어느 확대율에서도 이름과 '상세 도면 ↗'이 점선에 그어지지 않고 읽힌다**(테두리가 10%에서 사라지지 않고 400%에서 부풀지 않는다). 방의 이름은 v1.132.0과 같다 | 점선 길이가 확대에 따라 변하면 받아들이고 완료 보고에 적는다. `stroke-width`의 `calc()`가 SVG 글자에 듣지 않으면 도로의 `<text>` 둘에 `style={{ strokeWidth: 4 * labelScale }}`을 주고 10.6의 '마'와 앵커 41의 글자를 그에 맞춘다. 얼룩져 보이면 `4px`을 `3px`으로. 그래도 거슬리면 테두리를 빼고 이름을 아래로 옮긴다(14.2의 그 줄) |
| E4 3D에서 도로와 방이 겹친 곳·교차한 두 도로를 여러 각도로 | 겹친 곳의 색이 각도에 따라 바뀌거나 깜빡이지 않는다 | 깜빡이면 정수로 다시 매긴다(기본 바닥 −4, 밑그림 −3, 도로 −2, 방 −1). **같은 변경에서** 10.7의 도로 테스트(−1.5), Task 18의 앵커 44가 읽을 `floor.renderOrder = road ? -1.5 : -1;`, 설계 7.6의 그 줄을 고친다 |
| E5 3D의 도로 가운데 점선 | 보통의 거리에서 점선으로 읽힌다 | `dashSize` 14·`gapSize` 10의 값만 고친다 |
| R13 (740 · 1210 · 1300) 평면의 도구줄(편집 중) | 740: 넘치거나 도면을 가리지 않는다. 1210·1300: 이름 붙은 도구가 늘면서 **두 줄로 접히는지** 본다 | 접히면 v1.132.0의 같은 폭과 견주어 새로 접힌 것인지 적는다. 기본은 받아들이고 완료 보고에 적는다. 한솔이 거슬린다고 하면 그리기 도구 넷의 이름만 한 단계 일찍 감춘다(클래스 하나와 `@media(max-width:1400px)` 한 줄) |

---

## Chunk 6: 카메라 색 (설계 13절 6단계)

### Task 15: 색 표와 키를 쓰고 지우는 `setCameraColor` (`mapCameraColor.ts`·`mapGeometry.ts`)

**Files:**
- Create: `src/features/backgrounds/mapCameraColor.ts`
- Modify: `src/features/backgrounds/mapGeometry.ts`
- Test: `tests/backgroundMapElements.test.ts`, `tests/backgroundMapGeometry.test.ts`

**Read first:** 설계 8.1, 3.2(색 표), 3.3, 10.6의 첫 두 불릿, 10.3의 `setSpaceSurface`·`setCameraColor` 문단(끝의 괄호까지), I1·I6 · Task 9의 `setSpaceSurface`(같은 꼴).

- [ ] **Step 1: 테스트를 쓴다** — `MAP_CAMERA_COLORS.map(item => item.id)`가 `BACKGROUND_CAMERA_COLORS`와 `deepEqual`(순서까지), 화면 이름 여섯이 서로 다르고 비어 있지 않다 · `cameraColorHex('red', false)` → `0xf2726b`, `('red', true)` → `0xc2362f`, 여섯 모두 아래 표의 값 · 표에 없는 이름(`'purple' as BackgroundCameraColor`) → `null`. `setCameraColor`: 색 → 다른 색(다른 키는 `deepEqual`) · 색 → `null`이면 `Object.hasOwn(next, 'color')`가 거짓 · 같은 값이면 받은 객체(`===`) · 잠긴 카메라는 받은 객체 · **`setCameraColor(색 없는 카메라, null) === 그 카메라`** · 받은 객체를 고치지 않는다.
- [ ] **Step 2: 실패를 확인한다** — 요소 테스트: `ERR_MODULE_NOT_FOUND`(mapCameraColor.ts 없음). 기하 테스트: `does not provide an export named 'setCameraColor'`.
- [ ] **Step 3: `mapCameraColor.ts`** (글자 그대로. three.js·DOM 없음)
  ```ts
  import type { BackgroundCameraColor } from './types.ts';

  /** The colours a camera can be given, in the order the inspector shows them. `dark`/`light`: the value on each theme. */
  export const MAP_CAMERA_COLORS: readonly { id: BackgroundCameraColor; label: string; dark: number; light: number }[] = [
    { id: 'red', label: '빨강', dark: 0xf2726b, light: 0xc2362f },
    { id: 'lime', label: '연두', dark: 0xb7d84b, light: 0x5f7f0f },
    { id: 'green', label: '초록', dark: 0x5fcf8b, light: 0x1f8a4c },
    { id: 'teal', label: '청록', dark: 0x45cfc4, light: 0x0b8a82 },
    { id: 'blue', label: '파랑', dark: 0x63a9f7, light: 0x1e6fd0 },
    { id: 'pink', label: '분홍', dark: 0xf58fb8, light: 0xc23f7c },
  ];
  /** The value of a camera colour on a theme, or null for a name that is not in the palette (the caller keeps the default). */
  export function cameraColorHex(color: BackgroundCameraColor, light: boolean): number | null;
  ```
  표의 줄 수가 곧 동그라미 수다(여섯). 호박색은 이 표에 없다 — 색이 아니라 "키가 없음"이다.
- [ ] **Step 4: `mapGeometry.ts`** — `/** A camera in a colour of the palette, or in the default again (`color` null). The key is removed for the default. The same object back when nothing changes or the camera is locked. */ export function setCameraColor(camera: BackgroundCamera, color: BackgroundCameraColor | null): BackgroundCamera;` — 잠겼거나 `(camera.color ?? null) === color`이면 받은 객체, 값이 있으면 `{ ...camera, color }`, 지울 때는 `const next = { ...camera }; delete next.color; return next;`(`camera.color === color`로만 견주면 `undefined !== null`이라 빈 되돌리기 단계가 생긴다).
- [ ] **Step 5:** 두 테스트 파일 → 통과. `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 6: 커밋** — 네 파일 / `배경 도면 ③: 카메라 색 표(이름 여섯과 어두운·밝은 값)와 키를 쓰고 지우는 setCameraColor — 호박색은 저장하지 않는다`

**이 Task가 끝나면 편집기는:** Task 14와 같다(색을 고르는 화면이 아직 없다).

### Task 16: 3D의 카메라 색 — 색마다 한 벌의 재질 (`map3dScene.ts`)

**Files:**
- Modify: `src/features/backgrounds/map3dScene.ts`(`materials`의 타입, `material()`, `buildCamera`, `shapeKey`)
- Test: `tests/backgroundMap3dScene.test.ts`

**Read first:** 설계 8.4 전부, 2.3의 3D 행, 10.7의 '카메라 색' 불릿, 10.9의 앵커 45(3D 부분) · `map3dScene.ts:88-94`, `:142`, `:216-224`, `:365-410`, `:542-573` · 3D 테스트 `:793-848`.

- [ ] **Step 1: 테스트를 쓴다(10.7)** — 어두운 팔레트에서 `color: 'red'`인 카메라의 몸통(`camera-body`)·시선(`camera-frustum`)·화면 틀(`camera-frame`)·바닥 고리(`camera-ring`) 재질의 색이 `0xf2726b`이고 렌즈는 `palette.cameraLens` · 색이 없는 카메라는 `palette.camera` · 빨간 카메라 둘은 **같은 재질 객체**를 쓰고, 빨간 것과 색 없는 것은 다른 객체 · `setPalette({ ...MAP3D_DARK_PALETTE, light: true })` 뒤 빨간 카메라는 `0xc2362f`(이전 재질은 모두 해제) · 색을 `'blue'`로 바꿔 다시 맞추면 그 카메라가 다시 만들어지고 `0x63a9f7` · 선택하면 선의 불투명도가 0.6 → 1 · 기존 자원 해제 테스트(`:829-848`)의 장면에 색 카메라를 더한다: `dispose`가 색 재질까지 **한 번씩** 해제하고 자원 수가 0.
- [ ] **Step 2: 실패를 확인한다** — 빨간 카메라의 재질 색이 `0xe6b578`이라 실패.
- [ ] **Step 3: 구현한다** — import에 `cameraColorHex`(`'./mapCameraColor.ts'`)와 타입 `BackgroundCameraColor`. `materials`를 `Map<string, Material>`로, `private material(key: MaterialKey, color?: BackgroundCameraColor): Material` — 저장소의 열쇠는 `` color ? `${key}|${color}` : key ``. 색을 타는 이름은 **여섯**(`camera`·`cameraLine`·`cameraLineOn`·`cameraFar`·`cameraFarOn`·`cameraRing`): 그 가지들의 색은 `color`가 있고 `cameraColorHex(color, palette.light)`가 값을 주면 그 값, 아니면 지금의 `palette.camera`. **`cameraLens`는 색을 타지 않는다.** `buildCamera`: `const tint = node.color;`를 두고 `this.material('camera', tint)`, `this.material(selected ? 'cameraLineOn' : 'cameraLine', tint)`, `this.material(selected ? 'cameraFarOn' : 'cameraFar', tint)`, `this.material('cameraRing', tint)` — `this.material('cameraLens')`와 `this.material('proxy')`는 그대로(이 함수에서 `tint` 없이 부르는 것은 그 둘뿐이다). `shapeKey`의 카메라 줄 끝에 `|${node.color ?? ''}`. 새 재질은 기존처럼 공용 묶음에 들어가 `setPalette`·`dispose`가 그대로 다룬다.
- [ ] **Step 4:** `node --test tests/backgroundMap3dScene.test.ts` → 통과. `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 5: 커밋** — 두 파일 / `배경 도면 ③: 3D의 카메라가 제 색으로 보인다 — 색마다 한 벌의 재질을 필요할 때 만들고 테마와 함께 버린다. 렌즈는 그대로`

**v1.132.0과 달라지는 것(되살리지 말 것):** 3D의 재질 저장소 열쇠가 이름만이 아니라 `이름|색`일 수 있다. 색이 없는 카메라의 재질과 모습은 그대로다(두 화면 모두 `palette.camera`).
**이 Task가 끝나면 편집기는:** 저장돼 있던 `color`가 3D에서만 보인다(평면·목록·보조 평면도는 아직 호박색, 고르는 화면 없음).

### Task 17: 색 동그라미와 화면의 색 — 속성 칸, `data-camera-color` 여덟 곳, CSS

**Files:**
- Create: `src/features/backgrounds/BackgroundMapCameraColor.tsx`
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/BackgroundMapPlanOverlays.tsx`, `src/features/backgrounds/BackgroundMapPlanPreview.tsx`, `src/features/backgrounds/backgrounds-map.css`, `src/features/backgrounds/backgrounds-map-plan.css`
- Test: `tests/backgroundMapElements.test.ts`(10.6의 셋째 불릿의 카메라 쪽과 가·나·다·사)

**Read first:** 설계 8.2 전부(컴포넌트 코드와 불릿 — 동그라미가 여섯인 까닭, `aria-disabled`를 쓰는 까닭, 포커스 고리), 8.3 전부(요소 표, 변수 블록, 치환 표, 동그라미 CSS 블록과 그 아래 괄호, 보조 평면도 규칙), 2.3, 9.4, 10.6의 셋째·넷째 불릿, 10.9의 앵커 43·45, R4 · 편집기 `:171`, `:1027`, `:1090-1093` · `BackgroundMapPlanOverlays.tsx:33-40` · `BackgroundMapPlanPreview.tsx:81-89`, `:111-114`, `:225-228` · `backgrounds-map.css:59-71`, `:129-132` · `backgrounds-map-plan.css:2-3`.

- [ ] **Step 1: 테스트를 쓴다(10.6)** — 두 CSS 파일을 글자로 읽는다(줄은 `/\r?\n/`). 색마다 `.bmap-layout [data-camera-color="<이름>"] { --bmap-cam:<어두운 숫자 셋>; }`과 `[data-color-mode="light"] .bmap-layout [data-camera-color="<이름>"] { --bmap-cam:<밝은 숫자 셋>; }`이 있다(숫자 셋은 `MAP_CAMERA_COLORS`의 값에서 계산) · `data-camera-color="purple"`·`"amber"` 규칙이 없다 · 기본값 `--bmap-cam:230 181 120`이 있다. **가** `backgrounds-map.css`에서 `.bmap-camera`로 시작하는 줄과 `.bmap-handles .bmap-camera-`로 시작하는 줄(열 개 이상임을 단언)에 `#e6b578`·`#372715`가 **없고**(대소문자 무시, 투명도 두 자리가 붙은 꼴 포함), 그 줄들을 이은 글자에 `var(--bmap-cam)`과 `var(--bmap-cam-mark)`가 있다 · **나** `backgrounds-map-plan.css`에 `.bmap-plan-preview [data-camera-color] {`로 시작하는 줄이 하나 있고 `--bmap-plan-cam:`·`--bmap-plan-cam-line:`·`--bmap-plan-cam-edge:`·`--bmap-plan-cam-soft:` 넷과 `var(--bmap-cam)`이 있다 · **다** `.bmap-node-kind.is-camera[data-camera-color]`의 자리가 `[data-color-mode="light"] .bmap-node-kind.is-camera`의 자리보다 **뒤** · **사** `.bg-library .bmap-color-swatch:focus-visible { outline-offset:5px; }`가 있다.
- [ ] **Step 2: 실패를 확인한다** — 새 검사가 모두 실패한다(Task 12의 도로 검사는 통과).
- [ ] **Step 3: `BackgroundMapCameraColor.tsx`** (글자 그대로. import는 `useId`(react), `MAP_CAMERA_COLORS`(`'./mapCameraColor'`), 타입 `BackgroundCameraColor`. 이 파일에 `bmap-color-swatch`는 `MAP_CAMERA_COLORS.map(` 안의 한 군데뿐이다 — 호박색 동그라미를 만들지 않는다. '기본 색으로'는 되돌릴 것이 없을 때 `disabled`가 아니라 `aria-disabled`다)
  ```tsx
  export function BackgroundMapCameraColor({ color, disabled, onChange }: {
    color: BackgroundCameraColor | undefined; disabled: boolean;
    /** null: back to the default (the key is removed). */
    onChange(color: BackgroundCameraColor | null): void }): JSX.Element {
    const labelId = useId();
    return <div className="bmap-color-field">
      <span className="bmap-eyebrow" id={labelId}>카메라 색</span>
      <div className="bmap-color-swatches" role="group" aria-labelledby={labelId}>
        {MAP_CAMERA_COLORS.map(item => <button key={item.id} type="button" className="bmap-color-swatch" data-camera-color={item.id} aria-pressed={color === item.id} aria-label={item.label} title={item.label} disabled={disabled} onClick={() => onChange(item.id)} />)}
        {/* No circle of its own: the amber is "no colour picked". Not `disabled` when there is nothing to reset: its own click
            would switch it off under the focus, the focus would leave the editor, and the editor's keys would reach nothing. */}
        <button type="button" className="bmap-text-button bmap-color-reset" aria-disabled={color === undefined} title="고른 색을 지우고 원래 색(호박색)으로 돌아가요" disabled={disabled} onClick={() => { if (color !== undefined) onChange(null); }}>기본 색으로</button>
      </div>
    </div>;
  }
  ```
- [ ] **Step 4: 편집기** — import에 `BackgroundMapCameraColor`, `setCameraColor`, 타입 `BackgroundCameraColor`. 컴포넌트 안에(글자 그대로):
  ```ts
  function changeCameraColor(color: BackgroundCameraColor | null) {
    if (!current || selected?.type !== 'camera' || !canEdit) return;
    const next = setCameraColor(selected, color);
    if (next !== selected) updateMap(replaceMapNode(current, next));     // one update per pick, one undo step
  }
  ```
  속성 칸의 카메라 가지 **맨 앞**(이름 칸 바로 아래, '카메라 설정' 묶음 위)에 `{editing && <BackgroundMapCameraColor color={selected.color} disabled={fieldLocked} onChange={changeCameraColor} />}` — 편집 중일 때만, 평면·3D 모두, 파일에 한 번. `coalesceKey`를 쓰지 않는다. `patchNode({ color …})`·`color: undefined`·`color: null`로 쓰지 않는다. 평면 카메라의 `<g className={`bmap-camera …`}>`에 `data-camera-color={node.color}`, 오브젝트 목록의 종류 아이콘 `<span className={`bmap-node-kind is-${node.type}`}>`에 `data-camera-color={node.type === 'camera' ? node.color : undefined}`(값이 없으면 React가 속성을 내지 않는다 → 기본 호박색).
- [ ] **Step 5: 손잡이와 보조 평면도** — `BackgroundMapPlanOverlays.tsx`의 카메라 가지 `<g className="bmap-handles" …>`에 `data-camera-color={node.color}`. `BackgroundMapPlanPreview.tsx`의 **다섯 곳**: `PlanCamera`의 `<g>` · 선택된 카메라를 겹쳐 그리는 `<g className="bmap-plan-selected bmap-plan-camera">` · `CameraReadout`의 `<div className="bmap-plan-readout is-camera">` · 선택된 카메라의 안내 줄 둘(`<p className="bmap-plan-note">` 둘) — 뒤의 넷은 선택된 카메라의 `color`를 쓴다.
- [ ] **Step 6: CSS** — `backgrounds-map.css`:
  - 변수 블록(Task 12의 세 줄)의 첫 규칙을 `.bmap-layout { --bmap-cam:230 181 120; --bmap-cam-mark:55 39 21; --bmap-road:154 161 173; --bmap-road-mark:227 230 236; }`로 넓히고, 밝은 화면의 도로 줄 다음에 `.bmap-layout [data-camera-color] { --bmap-cam-mark:var(--color-bg-primary); }`와 색마다 두 줄(위 Step 1의 꼴 그대로, 어두운 여섯 줄 다음에 밝은 여섯 줄 — 설계 8.3의 블록과 같아진다):

    | 이름 | 어두운 화면 | 밝은 화면 |
    |---|---|---|
    | `red` 빨강 | `#f2726b` · `242 114 107` | `#c2362f` · `194 54 47` |
    | `lime` 연두 | `#b7d84b` · `183 216 75` | `#5f7f0f` · `95 127 15` |
    | `green` 초록 | `#5fcf8b` · `95 207 139` | `#1f8a4c` · `31 138 76` |
    | `teal` 청록 | `#45cfc4` · `69 207 196` | `#0b8a82` · `11 138 130` |
    | `blue` 파랑 | `#63a9f7` · `99 169 247` | `#1e6fd0` · `30 111 208` |
    | `pink` 분홍 | `#f58fb8` · `245 143 184` | `#c23f7c` · `194 63 124` |
  - 평면 카메라의 규칙(`.bmap-camera circle`부터 `.bmap-handles .bmap-camera-guide`까지)에서 **글자 색만** 바꾼다(선택자·굵기·그 밖은 그대로. 여덟 자리부터 바꾼다): `#e6b57820` → `rgb(var(--bmap-cam) / .1255)` · `#e6b57865` → `rgb(var(--bmap-cam) / .3961)` · `#e6b57840` → `rgb(var(--bmap-cam) / .251)` · `#e6b57826` → `rgb(var(--bmap-cam) / .149)` · `#e6b578` → `rgb(var(--bmap-cam))` · `#372715` → `rgb(var(--bmap-cam-mark))`. **바꾸지 않는 호박색**: `.bmap-node-kind.is-camera`(`#e6b578`·밝은 화면 `#a8701f`), '카메라 추가' 아이콘(`.bmap-toolbar-camera`), 위아래·시점 버튼의 눌린 테두리, `backgrounds-map-3d.css`.
  - 목록: `[data-color-mode="light"] .bmap-node-kind.is-symbol` 줄 **다음에** `.bmap-node-kind.is-camera[data-camera-color] { color:rgb(var(--bmap-cam)); }`.
  - 색 줄: 설계 8.3의 둘째 CSS 블록(`.bmap-color-field`, `.bmap-color-swatches`, `.bg-library .bmap-color-swatch`와 그 `:hover:not(:disabled)`·`[aria-pressed="true"]`·`:focus-visible`, `.bg-library .bmap-color-reset`과 그 `[aria-disabled="true"]` — 여덟 규칙과 주석 넷: 간격 12px / 공용 hover / 공용 포커스 고리 / 'Back to the default colour')을 글자 그대로. 전환·애니메이션을 새로 넣지 않는다.
  - `backgrounds-map-plan.css`(파일 끝에, 글자 그대로): `/* A camera with a colour of its own: the four camera variables of this plan follow it, on both themes. */`와 `.bmap-plan-preview [data-camera-color] { --bmap-plan-cam:rgb(var(--bmap-cam)); --bmap-plan-cam-line:rgb(var(--bmap-cam)); --bmap-plan-cam-edge:rgb(var(--color-bg-primary)); --bmap-plan-cam-soft:rgb(var(--bmap-cam) / .18); }`. 그 파일의 뿌리 변수 넷(`:2-3`)은 고치지 않는다.
- [ ] **Step 7: 자가 점검** — `data-camera-color=`가 편집기 2곳, `BackgroundMapPlanOverlays.tsx` 1곳, `BackgroundMapPlanPreview.tsx` 5곳, `BackgroundMapCameraColor.tsx` 1곳 · 편집기에 `<BackgroundMapCameraColor` 1곳, `setCameraColor(selected, color)` 1곳, `patchNode({ color` 0곳 · `backgrounds-map.css`의 `.bmap-camera`·`.bmap-handles .bmap-camera-` 줄에 `#e6b578`·`#372715` 0곳.
- [ ] **Step 8:** `node --test tests/backgroundMapElements.test.ts` → 통과. `npm run typecheck` → 오류 없음. `npm run test:background` → 테스트 수 증가, fail 0, skipped 5.
- [ ] **Step 9: 커밋** — 일곱 파일 / `배경 도면 ③: 카메라 색 동그라미 여섯 개와 '기본 색으로' — 평면·손잡이·목록·보조 평면도가 CSS 변수 하나(--bmap-cam)로 같은 색을 그린다. 색이 없는 카메라는 그대로 호박색`

**v1.132.0과 달라지는 것(되살리지 말 것):** 평면 카메라의 색 글자(16진수)가 변수가 됐다 — 기본값이 지금의 색이라 색이 없는 카메라는 두 화면 모두 **그대로**여야 한다(관문 D의 C1). 편집 중인 카메라의 속성 칸 맨 위에 '카메라 색' 줄이 생겼다. 선택된 카메라의 방향 손잡이와 점선도 그 카메라 색이다. '카메라 일반'의 호박색(카메라 추가·시점 보기 띠·방향 버튼)은 그대로다.
**이 Task가 끝나면 편집기는:** 카메라를 고르고 동그라미를 누르면 평면·3D·보조 평면도·목록이 그 색이 되고(누를 때마다 되돌리기 한 단계), '기본 색으로'가 키를 지워 호박색으로 되돌린다. 세 기능이 모두 화면에 있다.

### 관문 D — 카메라 색의 엔진 확인과 **여섯 색을 한솔에게 보이기** (Task 17 뒤 · **오케스트레이터가 한다**)

방법은 관문 A와 같다. **C1은 v1.132.0을 다른 포트(다른 주소)에서 띄워 나란히 견준다** — 같은 주소에서는 새 모양이 한 번이라도 저장된 뒤 v1.132.0의 코드가 저장소 전체를 거절한다.

| 확인 | 봐야 할 것 | 다르면 (설계 14.2) |
|---|---|---|
| C1 ★ 색이 없는 카메라의 평면·목록·보조 평면도·3D의 계산된 색을 v1.132.0과 견준다(어두운·밝은) | 두 화면 모두 **같다** | 그 규칙만 지금의 16진수 글자로 되돌리고 색 있는 카메라용 규칙을 `[data-camera-color]` 선택자로 따로 적는다. 그러면 10.6의 '가'(16진수가 없어야 하는 줄을 `[data-camera-color]`가 든 줄로 좁힌다)와 Task 18의 그 변형도 함께 고친다 |
| C2·C7 동그라미의 눌림 고리와 포커스 고리(지금 색·이웃 동그라미에 포커스), 흐린 '기본 색으로' | 눌림 고리와 포커스 고리가 **함께** 보이고 이웃과 겹치지 않는다. 흐린 상태가 읽힌다. 740에서 줄이 넘치지 않는다 | 고리의 굵기·간격·흐림 정도만 고친다. 그래도 엉기면 눌림 표시를 안쪽 `box-shadow:inset …`으로 옮기고 포커스 규칙을 뺀다(10.6의 '사'를 맞춘다) |
| C4 색이 있는 카메라에서 '기본 색으로' → 그대로 `+` 키 | 확대된다(포커스가 버튼에 남고 편집기의 키가 닿는다) | 닿지 않으면 누른 뒤 `event.currentTarget.focus()`를 한 번 부른다 |
| **C8 ★ 여섯 색 카메라를 방·도로·기호 옆에 놓고 선택·잠금·수직 상태로, 어두운·밝은 화면에서** | 여섯이 서로, 그리고 방(보라)·기호·도로·스냅 안내선과 구분된다. 선택은 굵기로 읽힌다 | 값만 고친다(`mapCameraColor.ts`와 CSS 두 벌 — 10.6의 테스트가 함께 맞는지 본다) |

**C8을 마친 화면(평면과 3D, 어두운·밝은, 속성 칸의 동그라미 줄)을 한솔에게 보인다 — 늦어도 PR 머지 확인을 받을 때, 반드시 운영 DB 적용보다 먼저**(설계 5.4의 1, I6). 승인된 것은 '여섯 개'와 '보라 빼기'이고 여섯의 색상은 설계가 골랐다. 색을 바꾸자는 답이 **적용 전에** 오면 이름까지 맞춰 고친다(`BACKGROUND_CAMERA_COLORS`·요소 파일의 IN 목록과 머리말·`mapCameraColor.ts`·CSS·테스트를 같은 PR에서 — D2·D3이 함께 맞는지 본다). **적용 뒤에** 오면 값과 화면 이름만 고치고 운영 DB는 다시 건드리지 않는다. 보인 날과 답을 완료 보고의 (I6) 줄에 적는다.

---

## Chunk 7: 앵커 테스트와 마무리 (설계 13절 7단계)

### Task 18: 새 앵커 40~49와 뮤테이션 확인, CSS·문구 점검

**Files:**
- Modify: `tests/backgroundMapEditorWiring.test.ts`
- Modify(점검에서 어긋난 것이 나올 때만): 이번 차례의 소스·CSS·테스트

**Read first:** 설계 10.9 전부(표와 그 아래 긴 문단 — 변형마다 어느 테스트가 잡는지까지), 10.6의 표, 9.4, 7.3, 8.2, 5.2 · 지금의 앵커 테스트 전체(`read`·`piece`·`positions`·`inOrder`·`count`, 앵커 9·10·21·31의 꼴) · 완성된 소스. 관문 B·C·D에서 대체안으로 바꾼 것이 있으면 그 구현대로 쓴다.

- [ ] **Step 1: 앵커를 쓴다** — 앵커마다 `test()` 하나. 조각은 **설계 10.9 표의 글자 그대로**다(아래는 요약 — 표를 옆에 두고 쓴다). 편집기 밖의 파일은 `read('map3dScene.ts')`처럼 읽는다. 기존 앵커 1~39는 고치지 않는다(26·31은 Task 13·14에서 이미 고쳤다).

  | # | 보는 것 | 뮤테이션(사본에서 깨뜨리는 법) |
  |---|---|---|
  | 40 | **도로 도구**: `type Tool`에 `'road'` · `isDrawTool`이 `'road'`를 센다 · `pointerDown`에 `if (canEdit && (tool === 'rect' \|\| tool === 'ellipse' \|\| tool === 'road')) { mode = 'draw'; target = newSpace(tool === 'road' ? 'rect' : tool, point, tool === 'road'); }` · `newSpace`에 `name: road ? '새 도로' : '새 공간'`과 `...(road ? { surface: 'road' as const } : {})` | 도로 도구가 방을 그림 / `isDrawTool`에서 뺌 / `surface: road ? 'road' : undefined`로 씀 |
  | 41 | **평면·보조 평면도의 도로와 도로의 말**: 공간을 그리는 줄에 `road = isRoadSpace(node)`, `${road ? 'is-road ' : ''}`, `rx={road ? 0 : 4}`, `<polyline className="bmap-road-line" fill="none"`가 있고 그것이 같은 `<g>`의 `<text`보다 **앞** · `stackedSpaces(current).map(`이 한 번, `shownIds.has(node.id)`가 셋 · `backgrounds-map.css`에 `.bmap-space.is-road text {`로 시작하고 `paint-order:stroke`와 `var(--bmap-label-scale`을 담은 규칙 · `BackgroundMapPlanPreview.tsx`의 `PlanShape`에 `isRoadSpace(`와 `is-road`, `<polygon` **다음에** `<polyline className="bmap-plan-road-line" fill="none"`(점은 `roadCentrePlanLine(`에서), 그 파일에 `선택한 도로` · `kindLabel`에 `isRoadSpace(node) ? '도로' : '공간'`, 머리 글자 `'선택한 도로'`, 목록 아이콘 `'═'` · `둥근 도로에는 가운데 점선이 없어요.`와 `가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요.`가 있고 그 줄이 `isRoadSpace(selected) && !roadCentreLine(selected)` 아래 · `꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.` · `다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.`를 담은 `ROAD_HINT`가 `isRoadSpace(selected) ? ROAD_HINT :`로 쓰인다 | 도로를 따로 한 번 더 그림 / 점선을 `<polygon>`으로 / 점선을 이름 뒤에 그림 / 이름의 테두리 규칙을 뺌 / 굵기를 고정값 4로 / `fill="none"` 속성을 뺌 / 보조 평면도가 도로를 방으로 그림 / 목록과 머리 글자에 '공간' / 점선 안내를 뺌 / 덮인 도로의 안내를 뺌 (각각) |
  | 42 | **층**: `mapStack.ts`의 정렬 줄이 `a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area`이고 `layer: isRoadSpace(space) ? 0 : 1` | 층 항을 뺌 / 부호를 뒤집음 / 층을 넓이 뒤에 둠 |
  | 43 | **있는 노드의 키는 순수 함수 둘만 바꾼다**: `changeSpaceSurface`에 `setSpaceSurface(selected, surface)`와 `updateMap(replaceMapNode(current, next))`, `changeCameraColor`에 `setCameraColor(selected, color)`와 같은 줄 · 편집기에 `patchNode({ surface`·`patchNode({ color`·`surface: undefined`·`color: undefined`·`surface: null`·`color: null`이 **없다** · `mapGeometry.ts`에 `delete next.surface`·`delete next.color` | `patchNode`로 기본값을 씀 / 지우는 대신 `undefined`를 씀 |
  | 44 | **도로의 높이**: `label="입체 높이"` 칸이 도로가 아닐 때의 가지에만 · `applyNodeWorldPose`에 `isRoadSpace(node) ? null : settle(volumeHeight * scale.y` · `applyGizmo`에 `flat: node.type === 'space' && isRoadSpace(node)` · `setTarget`에 `mapGizmoSetup(target.type, mode, target.flat)` · `buildSpace`에 `floor.renderOrder = road ? -1.5 : -1;` · `mapWorldBounds`에 `spaceWallHeight(` | 도로에 입체 높이 칸 / 3D에서 도로의 높이가 쓰임 / `setTarget`이 `flat`을 넘기지 않음 / 그리는 순서를 같게 둠 |
  | 45 | **카메라 색의 배선**: 편집기에 `<BackgroundMapCameraColor`가 한 번, 카메라 가지 안·`editing` 아래 · `BackgroundMapCameraColor.tsx`에 `className="bmap-color-swatch"`가 **정확히 한 번**이고 `MAP_CAMERA_COLORS.map(` 안 · 같은 파일에 `기본 색으로`와 `onChange(null)`, 그 버튼의 `className`에 `bmap-color-swatch`가 없고 `aria-disabled={color === undefined}`(`color === undefined`가 `disabled=`에 들어 있지 않다) · `data-camera-color=`가 평면 카메라 `<g>`, 목록 아이콘, 손잡이 `<g>`, 보조 평면도 다섯 곳 · `shapeKey`의 카메라 줄에 `node.color ?? ''` · `buildCamera`에서 `tint` 없이 부르는 `this.material(`은 `this.material('cameraLens')`와 `this.material('proxy')` **둘뿐**이고 색을 타는 이름 여섯의 호출은 모두 `, tint)`로 끝난다 | 한 화면에서 색이 빠짐 / 색을 바꿔도 3D가 다시 만들지 않음 / 렌즈까지 물듦 / 호박색 동그라미를 되살림 / '기본 색으로'를 `disabled`로 끔 |
  | 46 | **업데이트 안내**: `domain.ts`의 `onlyKeys`가 `BackgroundUnsupportedError`를 던지고 그 파일에 `delete `가 없다 · `refresh`에 `error instanceof BackgroundUnsupportedError` · `execute`의 로그인 검사 다음에 `if (get().updateRequired) throw` · `console.warn('[background] update required:'`가 **두 번**이고 둘 다 `if (!get().updateRequired) console.warn(`의 꼴 · `BackgroundLibraryView.tsx`에 `업데이트가 필요해요`·`다시 확인`, 탭 줄과 본문이 `updateRequired`가 아닐 때의 가지에만 | 모르는 키를 지우고 읽음 / 안내 아래에 편집기가 그대로 / 저장이 막히지 않음 / 까닭을 남기지 않음 / 실패한 읽기마다 적음 |
  | 47 | **순수 모듈**: `mapCameraColor.ts`·`mapSpatial.ts`가 three.js를 import하지 않고 DOM을 만지지 않는다(앵커 9와 같은 정규식). 앵커 10은 그대로 통과 | `window`를 읽는 줄 추가 |
  | 48 | **기호 목록과 계단 그림**: `symbolCatalog.ts`에 `item.id === "custom"`으로 찾는 대체값, `symbolCatalog.length - 1`이 없다, `symbolCatalog: ReadonlyArray<{`가 그대로 · `BackgroundSymbolGlyph.tsx`에 `symbol === "stairs"` 가지와 디딤판 `d="M10 19.33H90M10 34.67H90M10 50H90M10 65.33H90M10 80.67H90"`, 화살표 `d="M50 86V16M40 28L50 14L60 28"` · 그 파일에 `<pattern`과 `vectorEffect`가 없다 | 대체값을 자리로 되돌림 / 타입 표기를 뺌 / 계단 가지를 빼거나 종류 이름을 틀림 / 계단에만 `vectorEffect` |
  | 49 | **3D의 누름**: `mapStack.ts`에 `export function spacesOverlap(`과 `OVERLAP_SLACK`, 그 본문에 `nodePlanOutline(` · `function roadsUnderRooms(`의 본문에 `rooms.some(room => spacesOverlap(room, space))` · `pickMapNode`의 본문에 `roadsUnderRooms(hits, map)`과 `hits.filter(hit => !under.has(String(hit.object.userData.nodeId)))` · `pickMapFloor`와 `mapFloorPile`의 본문에 `isRoadSpace`·`roadsUnderRooms`·`spacesOverlap`이 **없다** · `mapSpacePile`의 본문에 `mapFloorPile(hits, map)`, `pickMapNode(hits, map)`, `pile.length > 0`, `node.type === 'space'`, `[picked, ...pile]`이 있고 `isRoadSpace`·`spacesOverlap`이 없다 · `BackgroundMap3D.tsx`의 `pick`에 `again ? mapSpacePile(hits, props.map) : []`, 그 파일 어디에도 `mapFloorPile`이 없다. **본문을 자르는 자리**: `pickMapFloor`는 `piece(scene, 'export function pickMapFloor(', 'function roadsUnderRooms(')`, `roadsUnderRooms`는 거기서 `'export function pickMapNode('`까지, `pickMapNode`는 `'export function mapFloorPile('`까지, `mapFloorPile`은 `'export function mapSpacePile('`까지, `mapSpacePile`은 `'function mapClickStep('`까지(앵커 21처럼 `pickMapNode` 앞까지로 자르면 `roadsUnderRooms`가 섞여 바른 구현에서 실패한다) | 그 걸음을 뺌 / 겹침 검사를 뺌(`rooms.length > 0`) / 도로를 바닥 더미에서 뺌 / `pickMapFloor`에서 도로를 뺌 / `mapClickStep`이 `mapFloorPile`을 그대로 / 손잡이 위의 클릭만 `mapFloorPile` / `mapSpacePile`이 카메라·기호를 더미 앞에 넣음 |
- [ ] **Step 2:** `node --test tests/backgroundMapEditorWiring.test.ts` → 49개 통과. 실패하는 앵커가 있으면 배선이 빠진 것이다 — **소스를 고친다**. 정규식이 틀린 경우에만 테스트를 고친다.
- [ ] **Step 3: 뮤테이션 확인(사본에서만 — 작업 트리의 소스에는 넣지 않는다)** — 사본의 자리는 **워크트리 안의 `.superpowers/mutation-scratch/`**다: 이번 차례의 테스트는 대부분 `three`나 `esbuild`를 끌어오므로(`backgroundMap3dScene`·`backgroundPersistence`, 그리고 `map3dScene.ts`를 import하는 `backgroundMapElements`) 워크트리 밖의 사본에서는 `Cannot find package …`로 파일 전체가 실패한다. `.superpowers/`는 `.gitignore`에 있고 `test:background`의 glob과 tsc의 `include`에 들지 않으며 위쪽 `node_modules`가 그대로 해석된다. **`node_modules`를 junction·symlink로 걸지 않는다**(사본을 지우다 원본이 지워진 사고가 있었다).
  - 같은 상대 경로로 복사한다: 쓸 테스트 파일들(`tests/`), `src/features/backgrounds/`, `DEVLOG/migrations/`의 세 배경 파일과 `2026-09-05-app-sessions-gantt-auth.sql`, `CLAUDE.md`, `AGENTS.md`, `DEVLOG/background-3d-opus-handoff-2026-10-07.md`.
  - **뮤테이션을 넣기 전에 사본의 테스트 파일을 한 번씩 그대로 돌려 통과를 확인한다**(계약 테스트는 PGlite로). `ERR_MODULE_NOT_FOUND`나 import 오류로 파일 전체가 실패한 것은 '잡힘'으로 세지 않는다 — 잡힌 것은 그 뮤테이션을 겨눈 단언이 실패한 것이다.
  - 표의 뮤테이션을 **하나씩** 넣고 그 번호의 앵커가 실패하는지 본 뒤 되돌린다('/'로 나뉜 것은 각각). 살아남으면 작업 트리의 앵커를 조여 다시 복사하고 반복한다.
  - 순수 테스트의 표본(설계 10.9의 문단 그대로): `stackedSpaces`의 층 삭제 / `addMapCamera`에서 `rooms.length ?` 삭제, 도로를 아예 뺌 / `roadCentreLine`의 띠 규칙을 하나씩 빼거나 바꾼 **아홉 가지**(10.4의 표 — 줄마다 실패하는 값이 적혀 있다) / 3D 누름의 **열세 가지** ①`pickMapNode`의 그 걸음 삭제 ②겹침 검사 삭제(`rooms.some(…)`를 `rooms.length > 0`으로) ③`mapClickStep`을 `mapFloorPile`로 ④`BackgroundMap3D.tsx`의 한 줄만 `mapFloorPile`로(손잡이 뷰포트 테스트 하나만 잡는다) ⑤`mapSpacePile`의 `node.type === 'space'` 삭제 ⑥`pile.length > 0` 삭제 ⑦`[...pile, picked]` ⑧`pickMapFloor`에서도 도로를 뺌 ⑨`spacesOverlap`의 겹친 길이 비교를 `>= 0`으로 ⑩"한쪽의 모서리가 다른 쪽 안에 있는가"로 바꿈 ⑪변끼리 만나는 점의 x를 넣지 않음 ⑫띠 폭의 여유를 뺌("10억분의 1" 줄 하나만 잡는다) ⑬두 윤곽의 변끼리에서만 모음("나비넥타이" 줄 하나만 잡는다) / `setSpaceSurface`가 `undefined`를 씀 / `setCameraColor`를 `camera.color === color`로만 견줌 / `known`이 늘 `Error`를 던짐, 늘 `BackgroundUnsupportedError`를 던짐 / `getSymbolPreset`의 대체값을 마지막 항목으로 / `cameraColorHex`가 밝은 값을 늘 돌려줌 / `readPalette`가 도로 색을 `base`에서 채움 / 저장소가 실패한 읽기마다 `console.warn`을 부름 / 10.6의 일곱 줄 각각(호박색 글자 하나를 남김, 보조 평면도의 색 규칙을 뺌, 목록 색 규칙을 밝은 화면 규칙 앞으로, 가운데 선 규칙의 `fill:none`을 뺌, 이름 테두리 굵기를 4로, 보조 평면도의 도로 규칙을 포커스 규칙 뒤로, 동그라미의 포커스 규칙을 뺌).
  - 계약 테스트의 표본: 요소 파일에서 `'stairs'`를 뺌, `'road'`를 `'roads'`로(D2·D3) / 더한 두 줄의 `NOT (n ? 'surface') OR`를 `n ? 'surface' AND`로(**PGlite 없이** D2가 잡아야 한다) / `CLAUDE.md` :3을 옛 문장으로 되돌림(D4의 부정 검사) / `AGENTS.md`의 데이터 경계 항목에서 사슬 문장을 뺌(D4의 긍정 검사) / 인수인계 `:297`에 덧붙인 글을 뺌(D4) / D5에서 줄 끝을 맞추는 줄을 빼고 SQL 사본을 CRLF로 바꿔 돌림.
  - 끝나면 `.superpowers/mutation-scratch` 폴더만 지우고, `git status --short`에 이 Task의 파일 말고 새 항목이 없는지(뮤테이션이 새지 않았는지) 본다. 넣은 뮤테이션 수와 잡힌 수를 커밋 메시지 본문에 적는다.
- [ ] **Step 4: CSS 점검(9.4)** — 설계 9.4의 두 표에 적힌 규칙이 모두 그 자리(앞뒤 순서)에 있다. 새 규칙에 `transition`·`animation`·`backdrop-filter`가 없고, 도로의 채움 규칙 셋과 보조 평면도의 도로 규칙 둘에 `stroke-dasharray`·`stroke-width`가 없다. `backgrounds.css`·`backgrounds-map-3d.css`는 바뀌지 않았다(`git diff --stat a0ca0542 -- src/features/backgrounds/backgrounds.css src/features/backgrounds/backgrounds-map-3d.css` → 비어 있다).
- [ ] **Step 5: 문구 점검** — 아래 문자열이 소스에 글자 그대로 있다: `문·계단·사물` / `문·계단·사물 기호` / `도로: 끌어서 곧은 길 그리기 · 꺾이는 길은 그린 뒤 다각형으로 바꿔 점을 다듬어요` / `새 도로` / `공간 종류` / `도로로 바꾸면 벽 없는 회색 바닥이 되고, 다른 공간 아래에 깔려요.` / `도로는 벽 없는 바닥이에요. 다른 공간과 겹치면 늘 아래에 깔려요. 다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.` / `둥근 도로에는 가운데 점선이 없어요.` / `가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요. 한쪽에 점을 더했으면 맞은편에도 하나 더해 주세요. 광장처럼 길 모양이 아닌 곳에는 그리지 않아요.` / `꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.` / `선택한 도로`(편집기와 보조 평면도) / `바닥 높이를 바꾸면 이 도로에 속한 카메라와 사물도 같은 만큼 함께 오르내려요. 도로에는 벽이 없어서 입체 높이가 없어요.` / `카메라 색` / `기본 색으로` / `고른 색을 지우고 원래 색(호박색)으로 돌아가요` / `빨강`·`연두`·`초록`·`청록`·`파랑`·`분홍` / `업데이트가 필요해요` / `업데이트 필요` / `다시 확인` / `앱을 업데이트한 뒤 다시 저장해 주세요.` / 설계 5.2의 안내 문단(`이 PC의 B flow보다 새 버전에서 만든 도면 자료가 저장돼 있어서, …고칠 수 없어요.`). 기존 문구(`꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.`, `다각형으로 바꾸기`, `카메라 추가`)는 그대로 있다.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음. `npm run test:background` → 10개 증가, fail 0, skipped 5. **이 Task에서 `domain.ts`·요소 파일·계약 테스트·`mapGeometry.ts`의 `addMapCamera`/`applyNodeWorldPose`를 고쳤으면 PGlite로 계약 테스트도 돌린다** → fail 0, skipped 0(Step 3의 사본 실행은 고치기 전에 뜬 복사본의 것이라 이것을 대신하지 못한다).
- [ ] **Step 7: 커밋** — 바뀐 파일 / `테스트: 배경 도면 ③ 배선 앵커 10개(40~49)와 뮤테이션 확인, CSS·문구 점검`

**이 Task가 끝나면 편집기는:** Task 17과 같다(점검에서 고친 문구·CSS가 있으면 그만큼만 다르다).

### Task 19: 버전 1.133.0·업데이트 내역·문서·전체 게이트

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`, `AGENTS.md`, `ROADMAP.md`, `DEVLOG/background-3d-opus-handoff-2026-10-07.md`, `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`

**Read first:** 설계 12절 전부(JSON 블록과 문서별 내용), 1.3 표 아래의 두 불릿(뒤 차례가 알고 들어와야 하는 것), 10.10 · `DEVLOG/update-notes.json`의 첫 25줄(들여쓰기) · `AGENTS.md`의 "선택과 겹친 공간(v1.132.0)" 불릿(`:113`) · `ROADMAP.md:25`, `:1421-1427` · 인수인계 문서 `## 16.` 절(`:391~`)의 문체 · 라운드 계획의 `### B3`(`:37`)과 `## 7. 진행 기록` 표의 ③ 행(`:339`).

- [ ] **Step 1: 버전** — `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 `1.132.0`인지 본다(이미 1.133.0 이상이면 멈추고 보고). `package.json`의 `"version"`(`:3`), `package-lock.json`의 맨 위 `"version"`(`:3`)과 `packages[""]`의 `"version"`(`:9`) 세 곳을 `1.133.0`으로. 확인: `git diff --numstat package.json package-lock.json` → `2	2	package-lock.json`과 `1	1	package.json`.
- [ ] **Step 2: `DEVLOG/update-notes.json`** — 다시 직렬화하지 않는다(파일 전체가 바뀐다). **글자로 끼워 넣는다**: 첫 줄 `[` 바로 다음, 기존 첫 항목 `  {` 앞에 아래 블록(`{`부터 `}`까지 **26줄**, 설계 12절과 같은 글자)을 각 줄 앞에 공백 2칸을 더해 넣고 마지막 줄을 `  },`로 한다. 본문은 한 글자도 바꾸지 않는다.

  ```json
  {
    "version": "1.133.0",
    "title": "배경 도면에 계단·도로·카메라 색이 생겼어요 (시험 중)",
    "items": [
      {
        "category": "feature",
        "summary": "기호에 '계단'이 생겼어요 (시험 중)",
        "description": "도면에 놓는 기호 목록에 계단이 추가됐어요. 평면에서는 디딤판 줄무늬와 올라가는 방향 화살표로 보이고, 3D에서는 층층이 올라가는 모양으로 보여요. 방향은 다른 기호처럼 돌려서 정하고, 크기와 높이도 똑같이 바꿀 수 있어요. 배경 화면은 아직 배한솔 계정에서만 시험하고 있어요."
      },
      {
        "category": "feature",
        "summary": "도로를 그릴 수 있어요 (시험 중)",
        "description": "그리기 도구에 '도로'가 생겼어요. 끌어서 그리면 회색 바닥에 가운데 점선이 있는 길이 되고, 3D에서는 벽 없이 납작한 바닥으로 보여요. 방처럼 배경 장소와 카메라를 연결할 수 있고, 건물과 겹치면 늘 건물 아래에 깔려서 건물을 누르는 데 방해가 되지 않아요. 꺾이는 길은 다각형으로 바꾼 뒤 점을 다듬어 만들고, 이미 그린 방을 도로로 바꾸거나 되돌릴 수도 있어요."
      },
      {
        "category": "feature",
        "summary": "카메라마다 색을 정할 수 있어요 (시험 중)",
        "description": "카메라를 고르면 속성 칸에 색 동그라미 여섯 개가 나오고, 누르면 그 카메라의 색이 바뀌어요. 평면, 3D, 3D 옆의 작은 평면도, 오른쪽 목록에 모두 같은 색으로 보여서 카메라가 많아도 구분하기 쉬워요. 색을 고르지 않은 카메라는 지금처럼 호박색이고, 고른 뒤에도 '기본 색으로'를 누르면 호박색으로 돌아가요."
      },
      {
        "category": "ux",
        "summary": "배경 화면의 새 기능은 PC를 모두 업데이트한 뒤에 써요 (시험 중)",
        "description": "계단·도로·카메라 색을 한 번이라도 저장하면, 이전 버전의 B flow에서는 배경 화면이 열리지 않아요. 그래서 배경 화면을 쓰는 PC를 모두 이 버전으로 올린 뒤에 새 기능을 써요. 배경 화면은 아직 배한솔 계정에서만 보여서, 다른 분들은 따로 하실 일이 없어요. 이 버전부터는 나중에 이런 일이 생겨도 오류 대신 '업데이트가 필요해요'라는 안내가 보여요."
      }
    ]
  }
  ```

  - 확인 1: `git diff --numstat DEVLOG/update-notes.json` → `26	0	DEVLOG/update-notes.json`(더해진 줄 26, 지워진 줄 0).
  - 확인 2: `node -e "const n=require('./DEVLOG/update-notes.json');if(n[0].version!=='1.133.0'||n[0].items.length!==4||n[0].items.map(i=>i.category).join()!=='feature,feature,feature,ux'||n[1].version!=='1.132.0')process.exit(1);console.log(n[0].title)"` → 제목이 찍히고 종료 코드 0.
- [ ] **Step 3: `AGENTS.md`**(CRLF 그대로) — "선택과 겹친 공간(v1.132.0)" 불릿 바로 다음에 `- 새 도면 요소(v1.133.0): …` 불릿 하나. 내용은 설계 12절 '문서'의 AGENTS.md 줄에 `/`로 나뉘어 적힌 항목을 그 순서대로 **모두** 옮긴다(저장 모양의 추가 셋과 닫힌 목록 한 곳 / 선택 키는 지워서 되돌리고 `setSpaceSurface`·`setCameraColor` 둘만 바꾼다 / 서버는 검증만·사슬 끝에 새 파일·DB 먼저·**적용 뒤 배포가 끝날 때까지 운영에 새 모양을 저장하지 않는다**·**저장 모양은 새 선택 키나 닫힌 목록의 새 문자열로만 넓힌다** / `BackgroundUnsupportedError`와 업데이트 안내·`known` / 도로는 공간(`isRoadSpace`, 층, 쌓임 순서를 읽는 여섯 곳, `pickMapNode`의 맨 앞 걸음과 `spacesOverlap`, `mapSpacePile`을 둘 다 부른다, `pickMapFloor`·`mapFloorPile`에는 도로 규칙 없음, 큰 방 안의 도로, `spaceWallHeight`, 새 카메라의 소속) / 가운데 점선 `roadCentreLine`과 이름 테두리 / 카메라 색은 칸의 이름·동그라미 여섯·포커스 고리 / 기호 목록의 대체값과 그림의 선 / 미리보기 저장소 키). 관문에서 대체안으로 바뀐 것이 있으면 그 구현대로 적는다. **D4가 이 파일을 읽는다**: `다시 실행`과 `3D 파일도`(또는 `이 SQL도`)를 한 줄에 함께 쓰지 않는다.
- [ ] **Step 4: `ROADMAP.md`**(CRLF 그대로) — '2026-09-21 배경 라이브러리' 절의 ② 줄(`:25`) 다음에 한 줄: `- [x] 2026-10-09 ③ 새 도면 요소(v1.133.0): 계단 기호, 도로(공간의 한 종류), 카메라 색. 저장 모양이 늘어 운영 DB에 검증 함수를 넓히는 파일 하나를 더하고(앱보다 먼저 적용), 모르는 종류가 저장돼 있으면 오류 대신 업데이트 안내를 띄운다. 설계: docs/superpowers/specs/2026-10-09-background-map-new-elements-design.md`. 파일 끝의 `### v1.132.0 …` 절 다음에 `### v1.133.0 배경 도면 ③ 새 도면 요소 (2026-10-09)` 절: 세 기능 각 한 줄과 업데이트 안내 한 줄(`- [x]`), 그리고 `- [ ] 운영 DB 적용: 2026-10-09-background-map-elements.sql (적용 버전 번호·함수 본문 대조 결과)`, `- [ ] 수동 검증(설계 11절 전체)`, `- [ ] 배포 뒤: 한솔의 PC를 모두 1.133.0으로 올린 뒤 새 요소의 첫 저장과 새로 고침`.
- [ ] **Step 5: 인수인계 문서**(LF 그대로) — 파일 끝에 `## 17. ③ 새 도면 요소 (v1.133.0)`: 17.1 문서 위치(설계, 이 계획 `docs/superpowers/plans/2026-10-09-background-map-new-elements.md`, 검증 기록의 절 이름 `## 2026-10-09 ③ 새 도면 요소 (v1.133.0)`) · 17.2 파일(이 계획의 File structure) · 17.3 운영 DB(사슬과 다시 실행 규칙을 적고, 적용 기록 — 버전 번호·시각, 본문 md5 전·후, 권한, 점검 호출 결과 — 은 "적용 뒤 오케스트레이터가 적는다"로 자리만 둔다) · 17.4 뒤 차례가 지켜야 할 것(설계 12절의 그 줄에 `/`로 적힌 항목 전부 — 굵게 적힌 셋을 굵게 옮긴다) · 17.5 뒤 차례가 정할 것(④의 파일이 사슬의 넷째, ④가 `CLAUDE.md` :3·`AGENTS.md` :3을 다시 쓸 때 사슬 문장을 옮겨 적는다, ⑤의 주석 핀). **D4가 이 파일을 읽는다**: 17절에 `3D SQL도 다시 실행한다`·`3D SQL 재실행`이라는 글자를 쓰지 않는다.
- [ ] **Step 6: 라운드 계획**(CRLF 그대로) — `### B3` 목록에 B2와 같은 꼴의 `- 문서:`(설계·이 계획 링크)와 `- 상태: 2026-10-09 구현 완료(v1.133.0) · 수동 검증·운영 DB 적용·배포 대기` 줄을 더하고, `## 7. 진행 기록` 표의 ③ 행을 설계 문서 경로와 같은 상태로 바꾼다. 다른 줄은 손대지 않는다.
- [ ] **Step 7: 전체 게이트(10.10의 다섯 가지)** — ① `npm run build:vite`(typecheck → 모든 테스트 묶음 → `vite build` → 개발용 manifest). 성공은 종료 코드만이 아니라 로그로 본다: 배경 묶음의 `# fail 0`·`# skipped 5`, `vite build`의 `✓ built in …`, 마지막 manifest 생성 줄. `npm run build`(배포 빌드)는 돌리지 않는다. ② PGlite로 계약 테스트 → fail 0, **skipped 0**. ③ CRLF 사본에서 계약 테스트(Task 4의 Step 8과 같은 방법 — 이 Task가 고친 `AGENTS.md`·인수인계 문서까지 넣은 마지막 상태로) → fail 0, skipped 0. 사본을 지운다.
- [ ] **Step 8: 커밋** — 일곱 파일(빌드 산출물은 올리지 않는다) / `v1.133.0: 배경 도면 ③ 계단·도로·카메라 색 — 버전·업데이트 내역·문서`. 커밋 전에 `git status --short docs/superpowers/ CLAUDE.md`를 본다: 설계·이 계획·`CLAUDE.md`가 `??`나 ` M`으로 남아 있으면 넣지 말고 보고한다(오케스트레이터의 것이다).

**이 Task가 끝나면:** 코드는 Task 18과 같고, 앱의 업데이트 내역 맨 위에 1.133.0 항목이 보인다. `DEVLOG/background-library-verification-2026-09-21.md`, 운영 적용 기록, 완료 보고는 오케스트레이터가 쓴다. PR·머지·운영 DB 적용·배포는 한솔이 말할 때만, 아래 순서로 한다.

### 최종 수동 검증 — 설계 11절 전체 (Task 19 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- 방법과 범위: 설계 11절 머리말 그대로(전용 포트와 전용 미리보기 저장소, 1440×900·740×900, 어두운·밝은 화면. R13만 1210·1300에서도). 시험 도면 셋(큰 도로 위의 건물과 계단·카메라 셋·세로 도로 / R2b의 큰 방 안에 통째로 든 도로 / R6b의 길가 도면 — 건물 하나만 일부러 길에 걸친다)을 만들고 모든 항목(E1~E5, S1~S7, R1~R14, C1~C10, V1·V2, U1~U5, 회귀)을 1440×900 어두운 화면에서, ★ 항목은 나머지 세 조합에서 다시 본다.
- 결과를 `DEVLOG/background-library-verification-2026-09-21.md`의 `## 2026-10-09 ③ 새 도면 요소 (v1.133.0)`(검증한 날이 다르면 그 날짜로. 이 파일은 CRLF)에 적는다: 10.10의 수치(PGlite를 지정한 실행의 DB 계약 수 포함), 11절 결과(E1~E5와 C1·C8의 관찰, U1~U5, R13의 세 폭), 검증에 쓴 미리보기 주소와 그 저장소에 새 모양이 남아 있는지, 확인하지 못한 것 — 배포 뒤 실기에서만 볼 수 있는 셋(설치된 앱에서 새 모양의 첫 저장과 새로 고침 / 한솔의 실제 도면에서 색 여섯의 구분 / 이전 버전을 일부러 남겨 둔 PC가 있다면 거기서 배경 화면이 설계 2.2의 문장으로 열리지 않는지)과 후속 하나(다음 묶음 ④ — 배경 화면을 다른 계정에 여는 차례 — 를 시작하기 전에 화면을 여는 대상 PC가 v1.133.0 이상인지 확인한다, 설계 5.4의 7). 검증 기록은 `문서: 배경 도면 ③ 수동 검증 기록 (v1.133.0)`으로 따로 커밋한다. 조정으로 소스·앵커를 고쳤으면 그것도 따로 커밋한다.
- 조정할 때: 설계 14.2의 표를 따른다(관문 B·C·D에 옮겨 적은 것과 같다). 대체안이 앵커·테스트가 읽는 글자를 바꾸면 **같은 변경에서** 그 앵커·테스트와 `AGENTS.md`·인수인계 17절·완료 보고의 그 줄을 맞춘다. 그 밖에 설계와 다른 동작이 보이면 고치기 전에 원인을 찾는다(@superpowers:systematic-debugging).

### 운영 DB 적용 — 설계 4.5 (PR 머지 뒤, 앱 빌드·배포 **전** · **오케스트레이터가 한다. Task 작업자는 운영 DB와 Supabase 도구에 닿지 않는다**)

순서는 설계 5.4다: ① PR 머지(머지 직전에 `origin/main`의 버전을 다시 본다. **관문 D의 여섯 색을 한솔이 본 뒤다**) → ② 이 관문 → ③ 적용 기록을 문서에 → ④ `npm run build`와 G드라이브 배포(한솔 확인 뒤, `manifest.json` 마지막) → ⑤ 한솔이 배경 화면을 쓰는 PC를 모두 v1.133.0으로 → ⑥ 그 뒤에 새 모양의 첫 저장(설치된 앱에서 저장 → 새로 고침 뒤 그대로인지 본다) → ⑦ 다음 묶음 ④(배경 화면을 다른 계정에 여는 차례 — 이 줄의 걸음 ④가 아니다)를 시작하기 전에: 화면을 여는 대상 PC가 v1.133.0 이상인지 확인한다. **②에서 ⑥까지는 운영에 새 모양을 저장하지 않는다**(개발 빌드로도, 검증하면서도 — 서버는 적용한 순간부터 새 모양을 받고, 그 사이에 저장되면 그것을 모르는 PC가 모두 안내를 띄우는데 올릴 버전이 아직 없다).

- **넣는 글자와 견주는 값은 blob에서 꺼낸다**(작업 폴더의 파일은 새 checkout에서 CRLF다): `git show <머지 커밋>:DEVLOG/migrations/2026-10-09-background-map-elements.sql`의 출력을 **바이트 그대로**(Bash 도구나 Node의 `execFileSync` — PowerShell의 `>`·파이프 금지), `\r`이 하나도 없음을 확인한 뒤에 쓴다(파일로 받았으면 `grep -cU $'\r'` → 0, 또는 Node로 바이트 13을 센다 — `-U` 없는 grep은 CRLF에서도 0을 낸다). 함수 본문의 md5(검증 함수의 `AS $$` 바로 뒤부터 닫는 `$$` 바로 앞까지 — `prosrc`의 범위)를 3D 파일과 요소 파일에 대해 미리 계산해 적어 둔다.
- **적용 전 — 읽기 전용 확인**(프로젝트 `mpqifkpxalwxgcrddchv`. 쿼리는 설계 4.5의 (1)~(7) 글자 그대로): (1) 적용 기록에 `background_library`(20261008035103)·`background_map_3d`(20261008035155)가 있고 `background_map_elements`는 없다 · (2) `is_3d` 참, `has_elements` 거짓, `prosecdef` 거짓, `proconfig`가 `search_path=public, pg_temp` 하나, `body`가 `956240d88619d7b370d9116acb2a0213`(LF, `has_cr` 거짓 — 기대값. 이 계획을 쓸 때 저장소의 3D 파일에서 다시 계산해 같았다) 또는 `5ec213a0ecb45a6c9b4b366edb3d3b5c`(같은 글자의 CRLF, `has_cr` 참 — 어느 쪽이었는지 적고 계속한다). **그 밖의 값이면 멈춘다** · (3) 함수 13줄의 md5를 적어 둔다 · (4) `anon`·`authenticated`마다 `background_library_execute`·`background_library_read` 둘뿐 · (5) 새 모양이 든 노드 수 0 · (6) `SELECT public.background_library_validate();`가 오류 없이 한 줄(22023이면 이미 편집이 막혀 있다는 뜻 — 적용하지 않고 어느 행인지부터 찾는다) · (7) 두 표 모두 RLS 켜짐·정책 0·`anon`·`authenticated` 직접 권한 없음. **하나라도 어긋나면 적용하지 않고 멈춘다**((2)의 CRLF 값만 예외).
- **적용**: migration 도구로 이름 `background_map_elements`, 내용은 blob으로 받은 요소 파일 전체(LF, `BEGIN;`·`COMMIT;` 포함).
- **적용 뒤 — 확인**(설계 4.5의 1~9): 1 적용 기록에 `background_map_elements`가 `background_map_3d` **뒤에** 한 줄(그 버전 번호를 적는다) · 2 (2)를 다시 — `is_3d`·`has_elements` 참, `has_cr` 거짓, `prosecdef`·`proconfig`는 전과 같고, `body`가 **blob의 요소 파일에서 계산한 md5와 같다** · 3 (3)을 다시 — 검증 함수 한 줄만 바뀌고 **나머지 12개의 md5는 적용 전과 같다** · 4 (6)을 다시 — 오류 없이 한 줄 · 5 (4)를 다시 — 그대로 둘씩, `PUBLIC`에는 0줄 · 6 (7)과 (5)가 적용 전과 같다 · 7 검증 함수 직접 호출(설계 4.5의 JSON 그대로 — 도로·`teal` 카메라·계단): 오류 없이 한 줄, `"surface":"river"`·`"color":"purple"`·`"symbol":"elevator"`로 하나씩 바꾼 셋은 각각 22023 · 8 익명 역할로(호출마다 트랜잭션을 따로, `ROLLBACK`) 잘못된 토큰의 `background_library_read('invalid')` → 42501, `background_library_validate_entity('map','{}'::jsonb)` → 42501, 표 직접 조회 → 42501 · 9 실제 저장(쓰기) 호출은 운영에서 하지 않는다.
- **어긋났을 때**: 2번의 md5나 7번의 결과가 다르면(글자가 옮기다 어긋난 것 — 가장 있을 법하다) **되돌리지 않는다.** (5)의 수가 여전히 0임을 확인하고, blob에서 다시 받은 글자를 **SQL을 그대로 실행하는 도구로** 한 번 더 실행한 뒤(migration 도구로 다시 넣지 않는다 — 적용 기록이 한 줄 더 생긴다. 파일은 멱등이다) 확인 2~8을 처음부터 다시 한다. **다시 실행한 사실과 시각을 '적는 것'에 함께 적는다.** 바른 글자가 들어갔는데도 어긋날 때(예: 4번의 (6)이 22023), 또는 바른 글자를 끝내 넣을 수 없을 때에만 되돌린다: 새 모양이 하나도 저장되지 않았음((5)의 둘째 줄 0)을 확인하고 3D 파일을 blob에서 같은 방법으로 받아 같은 길(SQL을 그대로 실행하는 도구 — 이것도 새 적용 기록을 만들지 않는다)로 실행한 뒤 (2)가 `956240d8…`(`has_cr` 거짓)임을 본다. **적용 기록에는 `background_map_elements`가 남으므로, 되돌렸다는 사실을 인수인계 17.3과 요소 파일 머리말에 적는다.** 새 모양이 하나라도 저장된 뒤에는 되돌리지 않는다(그 도면을 남겨 두는 쓰기가 모두 막힌다).
- **적는 것**(주석과 문서뿐이라 따로 커밋한다): 적용 버전 번호와 시각, (2)·(3)의 md5 표(전·후, 적용 전이 LF 값이었는지 CRLF 값이었는지), `prosecdef`·`proconfig`, (4)~(7)과 7·8번의 결과, 확인한 사람 — 인수인계 17.3, 검증 기록의 이번 절, 요소 파일 머리말(`-- Prerequisites:` 문단 끝에 `-- Applied to production on <날짜> as <버전 번호> (background_map_elements), after the 3D file (20261008035155).`), `CLAUDE.md` :3과 `AGENTS.md` :3(그 문장의 `(v1.133.0)` 바로 뒤에 ` — 요소 파일은 <날짜>에 <버전 번호>로 적용`을 똑같이), `ROADMAP.md`의 v1.133.0 절. 머리말에 한 줄을 더한 뒤 `npm run test:background`가 그대로 통과하는지 본다(D1·D4는 그 줄을 고정하지 않고, 요소 파일의 본문은 바뀌지 않는다).

---

## 완료 보고에 적을 것

설계 14.3에서 그대로 옮겼다. 승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이므로, 완료 보고에 비개발자 문장으로 옮겨 적는다. 첫 여섯 줄이 설계 1.1의 I1~I6이다(다른 답이 오면 고칠 곳은 1.1의 표에 있다). 관문에서 대체안으로 바꾼 것이 있으면 그 줄을 그 구현대로 고쳐 적는다.

- **(I1) 색 동그라미는 승인대로 여섯 개다(빨강·연두·초록·청록·파랑·분홍). 고른 색을 지우고 원래의 호박색으로 돌아가는 길은 동그라미가 아니라 그 줄 끝의 글자 버튼 '기본 색으로'다.** 색을 고르지 않은 카메라에서는 그 버튼이 흐리다. 버튼이 필요 없으면 뺄 수 있다(저장 규칙은 그대로).
- **(I2) 가운데 점선은 곧은 길과, 양쪽 옆줄의 점이 같은 수로 서로 마주 보는 길(띠 모양)에 보인다.** 꺾을 때는 긴 두 변에 점을 **마주 보게** 하나씩 더한다. 점선이 사라지는 때: 한쪽에만 점을 더한 동안(하나든 둘이든 — 맞은편에도 같은 수를 더하면 돌아온다), 마주 보는 두 점을 길 방향으로 크게 어긋나게 둔 동안. 점선이 없는 모양: 둥근 도로, 끝이 뾰족한 길, T자·십자(한 다각형으로 그린 갈림길 — 도로 둘을 겹쳐 그리면 각자 점선이 나온다), 길이보다 폭이 넓은 모양. 그때는 속성 칸의 '공간 종류' 아래에 까닭이 한 줄로 나온다. **네모에 가까운 넓은 다각형(광장)은 양쪽 점이 마주 보면 띠로 읽혀 가운데를 가로지르는 점선이 하나 그려질 수 있다**(정사각형 도로에 가로 점선이 그려지는 것과 같다) — 점선 없는 광장은 타원으로 그린다.
- **(I3) 새 카메라는 그 자리에 건물이 있으면 건물에, 건물이 없고 도로만 있으면 도로에 속한다.** 기호도 같다(가장 작은 방, 없으면 도로).
- **(I4) 3D에서 도로는 '자기와 겹친 건물'에게만 진다.** 평면에서 넓이가 겹치는 건물(도로 위에 선 건물)은 바닥을 눌러도, 벽을 눌러도, 바닥을 높이 올린 도로(고가)가 그 건물 위를 지나는 자리를 눌러도 건물이 먼저 잡히고 더블클릭도 건물의 것이다. 그런 건물의 **벽 너머로 보이는 도로 자리**는 처음 누르면 건물이고, 같은 자리를 천천히 한 번 더 누르면 도로로 내려간다(평면에서 건물과 겹친 도로를 고를 때와 같은 방식). 그 자리에서 도로의 상세 도면을 열려면 도로까지 내려간 뒤에 더블클릭한다. 설계 때 잰 예(넓은 도로 위의 건물 하나, 기본 각도)에서는 도로가 보이는 자리의 9%가 그런 자리다. **건물과 겹치지 않고 옆을 지나는 도로는 지금의 방과 똑같다** — 건물의 벽 너머로 보이는 자리에서도 한 번에 잡히고, 더블클릭 한 번에 그 도로의 상세 도면이 열린다(그 건물은 자기 바닥이 보이는 곳에서 누른다 — 방끼리의 지금 규칙이다). **변만 맞닿은 것은 겹친 것이 아니고, 조금이라도(1만큼이라도) 걸쳐 그린 건물은 겹친 것이다**: 길가 건물을 손으로만 그리면 조금 걸치기 쉬운데, 그러면 그 건물의 벽 뒤로 보이는 길은 두 번째 누름에 잡힌다 — 옮기기의 스냅으로 가장자리를 맞추면 한 번에 잡힌다. 다른 방식 둘과 그 값: "겹치지 않아도 도로가 늘 건물에 지게" 하면 길가에 건물이 늘어선 도면을 기본 각도로 볼 때 길이 보이는 자리의 94%가 처음 누를 때 앞 건물이고, "도로도 방처럼 벽 너머의 바닥이 먼저 잡히게" 하면 넓은 도로 위에 선 건물은 몸통의 절반쯤(55%)에서 도로가 잡힌다. (3D에서 올린 도로 위에 기호를 놓으면 그 점 아래에 건물이 있을 때는 건물에 속해 건물 바닥에 선다.)
- **(I5) 큰 공간 안에 통째로 그린 도로는 몸통을 바로 누를 수 없다.** "항상 건물 아래"의 건물을 도로가 아닌 모든 공간으로 읽었기 때문에, 마당이나 부지 같은 더 큰 방 안의 도로를 누르면 바깥 방이 잡힌다("작은 공간이 위"가 이 경우에는 서지 않는다). 그 도로가 이미 선택돼 있어도(방금 그렸거나 목록에서 골랐어도) 몸통을 끌면 **바깥 방이 움직인다.** 도로를 다루는 길: 그 자리를 천천히 한 번 더 눌러 도로로 내려간 뒤 그 자리에서 끌기 / Shift를 누른 채 도로 가장자리에 걸치는 상자 그리기 / 오브젝트 목록에서 고른 뒤 속성 칸·손잡이·F2 / 3D에서도 같다(천천히 다시 누르기, 기즈모). 도로를 고르면 속성 칸의 '공간 종류' 아래에 "다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요."가 나온다.
- **(I6) 여섯 색은 빨강·연두·초록·청록·파랑·분홍이다.** 승인된 것은 '여섯 개'와 '보라 빼기'이고, 이 여섯의 색상과 주황·노랑(호박색과 가깝다)·회색·흰색(도로와 가깝다)을 뺀 것은 설계가 골랐다. 운영 DB를 적용하기 전에 화면으로 보였다(보인 날과 답을 적는다). 나중에 색을 바꾸고 싶으면 운영 DB를 건드리지 않고 앱에서 바꾼다.
- **도로에는 '입체 높이'가 없다.** 속성 칸에 바닥 높이만 나오고, 3D의 크기 손잡이에 높이 방향이 없다. 방을 도로로 바꿨다가 되돌리면 예전 벽 높이가 돌아온다.
- **도로 도구는 곧은 길(사각형)만 그린다.** 꺾이는 길은 그린 뒤 '다각형으로 바꾸기'로, 또는 다각형을 그린 뒤 '공간 종류'를 도로로.
- **평면에서 도로의 이름에는 글자 테두리가 있다**(가운데 점선이 이름 자리를 지나기 때문이다. 축소해도 테두리가 글자와 함께 화면 크기를 지킨다). 방의 이름은 그대로다.
- **계단의 선은 다른 기호처럼 상자와 함께 굵어지고 가늘어진다.** 기본 크기(120×240)에서는 가로줄이 세로줄보다 굵다(침대와 같다).
- **평면의 계단은 디딤판이 늘 다섯 줄이고, 3D의 단 수는 높이에 따라 3~16단이다**(기본 높이 180에서 10단). 둘의 수는 맞추지 않았다.
- **3D 옆 작은 평면도에서 계단은 다른 기호처럼 네모 윤곽으로만 보인다.**
- **선택한 카메라의 방향 손잡이와 점선도 그 카메라 색이다.** '카메라 추가' 버튼과 '이 카메라 시점으로 보기'의 호박색은 그대로다.
- **여러 개를 골랐을 때의 요약에서 도로는 '공간'으로 센다.**
- **이전 버전(1.130.0~1.132.0)이 남아 있는 PC**: 새 요소가 하나라도 저장되면 배경 화면 전체가 열리지 않고 빨간 글자로 '사물 기호가 올바르지 않습니다.' 또는 '지원하지 않는 배경 속성이 포함되어 있습니다.'가 보인다. 그때 화면을 열어 둔 채였다면 저장이 서버에는 반영되고 화면에는 실패로 보일 수 있다. 자료는 잃지 않는다. 업데이트하면 풀린다.
- **1200px보다 조금 넓은 창에서 평면의 도구줄이 두 줄이 될 수 있다**(이름 붙은 그리기 도구가 넷이 됐다). 앱에서 본 결과와 고른 대체안을 적는다(14.2).
- **업데이트 안내가 뜨면 그 순간 저장하지 않은 편집은 사라진다.** 앞으로 저장 모양이 또 늘어날 때(④·⑤ 이후) 이전 버전에서 생길 수 있는 일이다. 안내는 "모르는 종류·항목이 저장돼 있음"만 알아본다 — 뒤 차례가 저장 규칙을 다른 식으로 넓히면(숫자 범위 등) 이 버전에는 안내가 아니라 빨간 오류로 보이므로, 뒤 차례는 새 항목이나 새 종류 이름으로만 넓히기로 적어 두었다.
- **운영 DB**: 적용한 날짜와 기록 이름, 함수 본문을 파일과 대조한 결과.
- **넣지 않은 것**: 계단의 층 연결, 도로의 차선·폭·점선 켜고 끄기, 색 자유 선택, 색으로 걸러 보기.
- (엔진 확인에서 생긴 것이 있을 때만) 관문 A~D와 최종 수동 검증에서 대체안으로 바꾼 것 — 예: 계단의 디딤판을 세 줄로 줄였다(E2), 3D 바닥의 그리는 순서를 정수로 다시 매겼다(E4), 도로 이름의 테두리를 인라인 굵기로 주었다(E3).

