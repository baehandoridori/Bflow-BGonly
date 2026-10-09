# 배경 도면 ② 선택 도구 개편 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평면 도면의 '선택' 도구를 고르고 옮기는 도구로 바꿔 v1.132.0으로 만든다 — 빈 곳을 끌어 상자로 여러 개 고르기와 Shift+클릭, 함께 옮기기(스냅 포함)·지우기·잠그기, '화면 이동' 도구와 스페이스·휠 버튼, 겹친 공간에서 작은 방이 먼저 잡히고 같은 자리를 천천히 다시 누르면 아래로 넘어가기(평면·보조 평면도·3D). 저장 자료·운영 DB·배경 메뉴 노출 범위는 그대로다.

**Architecture:** 판정은 모두 three.js·DOM 없는 순수 모듈에 두고 `node --test`로 값을 고정한다 — 쌓임 순서 한 곳(새 `mapStack.ts`), 선택 모델(`mapDocument.ts`의 `selectedIds`·`select-many`·`pick-one`과 읽는 함수 `mapSelection`·`singleViewId`·`pickAction`), 묶음 계산(`mapGeometry.ts`의 `moveMapNodes`·`removeMapNodes`·`lockMapNodes`, `mapPlanGesture.ts`의 `move-group`), 누름·상자 판정(새 `mapPlanSelect.ts`). 편집기(`BackgroundMapEditor.tsx`)는 `resolvePlanPress`가 정한 것을 실행만 하고, 상자는 화면 상태일 뿐 문서 제스처가 아니다. 3D와 보조 평면도는 계약(`mapCanvas.ts`의 `selectedId` 하나)을 그대로 둔 채 3D의 하나(`singleId`)만 받고, 각자의 누름 기억(`turn`)으로 "같은 자리를 다시 누름"을 안다.

**Tech Stack:** Electron 33(Chromium 130) · React 18 · TypeScript · SVG · three.js(3D 뷰포트) · node:test(Node 22 type-stripping) · Vite

---

## 모든 Task 공통 규칙

- **작업 위치**: `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`, 브랜치 `claude/bg-map-selection-tools`(= main v1.131.0). 다른 워크트리·상위 checkout은 건드리지 않는다.
- **계약은 설계 문서다**: `docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md`(아래 "설계"). 머리말의 용어(묶음·대표·3D의 하나·상자·더미·같은 자리를 다시 누름·연속 클릭·천천히 다시 누름)와 각 Task의 **Read first**에 적힌 절을 먼저 읽는다. 설계에 적히지 않은 동작은 만들지 않는다. 이 계획과 설계가 어긋나면 설계가 맞다 — 멈추고 보고한다. 설계의 코드 블록을 옮길 때는 글자를 바꾸지 않는다(Task 15의 앵커가 그 글자를 읽는다).
- **줄 번호**: 설계와 이 계획의 `:599` 같은 번호는 기준 커밋(a2cc1d38)의 것이다. Task가 지나면 밀리므로 **인용한 코드로 찾는다**. 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래, 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.
- **편집기 한눈에**: `BackgroundMapEditor.tsx`는 컴포넌트 하나다. `doc = useBackgroundMapDocument()`는 동기 저장소다(`doc.getState()`는 방금 보낸 것까지 반영된 값, `doc.dispatch`, `doc.beginGesture/previewGesture/finishGesture/cancelGesture`, `doc.update`, `doc.setViewport`). `current`는 지금 도면(편집 중이면 초안 값), `view`는 그 도면의 보기 값, `selected`는 "하나를 다루는 도구가 붙는 노드"(Task 4부터 평면의 여러 개 선택에서는 `undefined`), `canEdit`은 편집 중이고 저장 중이 아님, `pointerRef.current`는 눌려 있는 포인터의 세션(`PointerSession`), `pressLog`는 최근 두 번의 누름(`PlanPress { hitId, targetId, handle }`), `pendingCycle`은 미뤄 둔 넘기기, `useEvent`(:104-108)는 늘 최신 렌더의 처리기를 부르는 고정 함수, `settle()`은 진행 중인 제스처를 취소한 도면, `focusCanvas()`는 키보드를 캔버스로 돌린다. 지금 동작의 요약은 설계 2절이다.
- **명령**: 테스트 파일 하나 `node --test tests/<file>.test.ts` · `npm run typecheck` · 배경 묶음 `npm run test:background`(glob `tests/background*.test.ts`). 시작 기준(a2cc1d38): **tests 347 / pass 344 / fail 0 / skipped 3**. skipped 3은 DB 계약 테스트가 `BFLOW_PGLITE_MODULE` 없이 건너뛰는 것으로 정상이다. 매 Task 뒤 기대: 테스트 수가 직전보다 많거나(테스트를 더한 Task) 같고(배선만 한 Task), fail 0, skipped 3.
- **테스트 규칙(Node type-stripping)**: `.ts` 확장자를 붙인 상대 import, 지울 수 있는 TypeScript만(enum·namespace·매개변수 속성 금지), 경로 별칭(`@/`) 금지. 타입은 반드시 `import type { … }`으로 가져온다 — 타입 제거 실행에서는 `import { 타입 }`이 지워지지 않아 `does not provide an export named …`로 파일 전체가 실패한다(없는 export 때문에 나는 '기대한 실패'와 문구가 같다. 구현한 뒤에도 남아 있으면 import부터 본다. `npm run typecheck`는 잡지 못한다 — `tests/background*.test.ts`는 타입 검사를 받지 않는다). 새 `.ts` 모듈도 같은 규칙이다. `.tsx`에서 `.ts`를 import할 때는 기존처럼 확장자 없이 쓴다(`'./mapStack'`).
- **테스트 먼저**(@superpowers:test-driven-development): 순수 함수는 실패하는 테스트 → 구현 순서. 없는 export를 import한 테스트 파일은 `SyntaxError: The requested module … does not provide an export named '…'`(새 모듈이면 `ERR_MODULE_NOT_FOUND`)로 **파일 전체가** 실패한다 — 그것이 기대하는 실패다. 편집기 배선은 순수 테스트로 잡을 수 없으므로 Task 끝의 **자가 점검(grep)** 으로 조각이 글자 그대로 있는지 보고, Task 15의 앵커가 고정한다.
- **앵커 규칙**(`tests/backgroundMapEditorWiring.test.ts`): 소스는 그 파일의 `read(name)`으로 읽는다(줄 끝을 LF로 정규화하고 주석을 뺀다 — 이 작업 트리는 `core.autocrlf=true`라 새 checkout은 CRLF다). 함수 본문은 `piece(source, from, to)`로 자르고(두 표지를 못 찾으면 단언으로 실패한다), 순서는 `inOrder`·`positions`로(못 찾은 조각은 실패한다), 개수는 `count`로 센다. 표지·정규식에 줄바꿈 글자를 넣지 않는다. '없음'을 보는 검사는 표지를 단언한 조각에만 건다.
- **하지 않는 것**: dev 서버·Electron·미리보기 창을 띄우지 않는다(`npm run dev*`, `npm run preview:electron`, `npm run build` 금지). 화면 확인은 **오케스트레이터의 관문 A·B와 최종 수동 검증**이다. push·PR·머지·배포도 하지 않는다.
- **건드리지 않는 파일**(설계 11절): `types.ts`, `domain.ts`, `mapSpatial.ts`, `mapEditSession.ts`, `mapSnap.ts`, `mapWorkflow.ts`, `mapCanvas.ts`, `mapGallery.ts`, `BackgroundMapGallery.tsx`, `BackgroundMapNameBox.tsx`, `BackgroundMapCameraGizmo.ts`, `BackgroundMapPanels.tsx`, `electron/**`, `DEVLOG/migrations/**`, `src/features/playground/featureFlag.ts`, `CLAUDE.md`. (①에서는 손대지 않던 `mapPlanPreview.ts`·`BackgroundMapPlanPreview.tsx`·`map3dScene.ts`·`BackgroundMap3D.tsx`·`useBackgroundMapDocument.ts`와 3D 테스트는 이번에 **의도적으로** 고친다.)
- **커밋**: Task마다 한 번, 그 Task의 **Files**만 `git add` 한다. 형식: `git commit -m "<한글 메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. 줄 끝은 각 파일의 지금 상태 그대로 둔다(작업 트리에서 `package.json`·`package-lock.json`·`AGENTS.md`·`ROADMAP.md`·라운드 계획·검증 기록은 CRLF, 소스·테스트·`DEVLOG/update-notes.json`·인수인계 문서는 LF). 파일 전체의 줄 끝을 바꾸지 않는다.
- **문서 두 개**: 설계 문서와 이 계획은 아직 추적되지 않는 파일이다(`git status`의 `??`). **오케스트레이터가 Task 1 전에** 이 둘만 커밋한다(`문서: 배경 도면 ② 선택 도구 개편 설계와 구현 계획`). Task 작업자는 두 파일을 고치지 않는다.
- **Q1과 관문은 오케스트레이터의 일이다**: Q1(설계 1.1·16.1)은 Task 7 전에 한솔에게 확인한다. 답을 받은 즉시 설계 1.1 '확인' 칸에 날짜와 함께 적는다(커밋은 최종 수동 검증의 문서 커밋에 함께 한다 — 그때까지 설계 문서가 `git status`에 ` M`으로 보이고, Task 작업자는 그것을 `git add` 하지 않는다). 엔진 확인은 관문 A(Task 10 뒤 — E6·E11의 원시 이벤트도 여기서 미리 찍는다)·관문 B(Task 14 뒤), 수동 검증 전체는 Task 16 뒤다.

## File structure

새 파일

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapStack.ts` | 겹친 공간의 쌓임 순서 하나: 넓이, 아래→위 목록, 번호표, 한 점을 품은 공간들 (순수. 평면과 3D가 함께 쓴다) |
| `src/features/backgrounds/mapPlanSelect.ts` | '선택' 도구의 누름 판정(`resolvePlanPress`)과 같은 자리 판정(`PlanSpot`·`sameSpotAgain`), 상자(`planRect`·`planRectTouches`·`planMarqueeIds`), 카메라·기호의 "포인터 아래"(`planMarkCovers`) (순수) |
| `src/features/backgrounds/BackgroundMapSelectionSummary.tsx` | 여러 개 선택의 속성 칸 요약(개수·구성·묶음 동작 버튼) |
| `tests/backgroundMapStack.test.ts` · `tests/backgroundMapPlanSelect.test.ts` | 위 두 순수 모듈의 값 고정(설계 12.3·12.4) |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `mapDocument.ts` | `MapViewport.selectedIds`와 `selectedId`의 새 뜻(3D의 하나), 액션 `select-many`·`pick-one`, `select`의 규칙, `mapSelection`·`MapSelection`·`singleViewId`·`pickAction`. 문서 키는 그대로 |
| `useBackgroundMapDocument.ts` | `selectMany` |
| `mapGeometry.ts` | `moveMapNodes`·`removeMapNodes`·`lockMapNodes` |
| `mapPlanGesture.ts` | `PlanGesture`의 `move-group`, 그 미리보기와 후보 |
| `mapPlanEdit.ts` | `planDoubleClickAction` |
| `mapPlanPreview.ts` | `planPileAt`, `nextPlanSelection`의 여섯째~여덟째 인자(`point`, `again`, `repeat`) |
| `BackgroundMapPlanPreview.tsx` | 공간을 쌓임 순서로 그리기, 클릭 점·`again`·연속 클릭 넘기기(`turn`, `Activate`의 넷째 인자), 밖의 누름에 `turn` 지우기(`svgRef`, 창 캡처 `pointerdown`) |
| `BackgroundMapPlanOverlays.tsx` | `MapMarquee` |
| `map3dScene.ts` | `pickMapFloor`의 순서, `mapFloorPile`·`mapClickAim`, `resolveMapClick`의 공간 더미와 `again`·`repeat` |
| `BackgroundMap3D.tsx` | `Press.repeat`, `turn`·`aimed`, `click`·`clickHandle`을 `pick` 하나로, `opens`·`doubleClickNode`, `turn`을 끝내는 줄들과 창 캡처 `pointerdown`(`onPressElsewhere`) |
| `BackgroundMapEditor.tsx` | 선택을 읽는 값(설계 3.5), 포인터 흐름(9절, `lastSpot`), 스페이스(5.3), 도구줄·힌트 문구, 넘기기와 `doubleClickIntent`·`openSpace`, `select`의 3D 규칙(`pickAction`), 묶음 삭제·잠금·Delete와 포커스, Esc의 상자 취소, 속성 칸 분기, `ObjectList` props, 쌓임 순서로 그리기, 새 기호의 소속 |
| `backgrounds-map.css` | `.bmap-marquee`, 커서 규칙 셋(설계 10.2) |
| `tests/backgroundMapDocument.test.ts` · `backgroundMapGeometry` · `backgroundMapPlanGesture` · `backgroundMapPlanEdit` · `backgroundMapPlanPreview` · `backgroundMap3dScene` · `backgroundMapEditorWiring` | 설계 12절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · `AGENTS.md` · `ROADMAP.md` · `DEVLOG/background-3d-opus-handoff-2026-10-07.md` · `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md` | 버전 1.132.0, 업데이트 내역, 문서(설계 14절). `DEVLOG/background-library-verification-2026-09-21.md`와 설계 1.1의 Q1 '확인' 칸은 오케스트레이터가 쓴다 |

**import 방향(거꾸로 가지 않는다)**: `mapStack.ts → mapGeometry.ts → mapSpatial.ts` · `mapPlanPreview.ts → mapStack.ts`(+ 지금의 import) · `mapPlanSelect.ts → mapPlanEdit.ts`·`mapPlanPreview.ts`·`mapSpatial.ts`, 그리고 `mapDocument.ts`에서는 `import type`만 · `mapPlanGesture.ts → mapSnap.ts → mapGeometry.ts`(지금 그대로) · `map3dScene.ts → mapStack.ts`(+ 지금의 import). `mapGeometry.ts`·`mapDocument.ts`는 새 모듈을 import하지 않는다. 3D 파일(`BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`)은 `mapPlanSelect`·`mapPlanEdit`·`mapPlanGesture`·`mapSnap`을 import하지 않는다.

Task와 설계 15절의 여덟 단계: 1=Task 1–2 · 2=Task 3–4 · 3=Task 5 · 4=Task 6–8 · 5=Task 9–10 · 6=Task 11 · 7=Task 12–14 · 8=Task 15–16. 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "배선" 커밋의 경계다. 설계 15절과 다른 곳 둘: **Esc의 상자 취소**(설계는 6단계)는 관문 A의 E4가 보므로 Task 9에서 넣고, **기존 앵커 5·6**(설계는 8단계)은 Task 9가 그 줄을 고쳐 쓰는 순간 깨지므로 Task 9에서 함께 고친다. 설계 7단계의 "E6·E11을 먼저 확인"은 둘로 나눴다: 구현과 무관한 원시 이벤트는 7단계를 시작하기 전(관문 A)에 찍고, 구현된 동작은 관문 B에서 본다.

---

## Chunk 1: 쌓임 순서 (F8의 바탕)

### Task 1: 쌓임 순서 모듈 (`mapStack.ts`)

**Files:**
- Create: `src/features/backgrounds/mapStack.ts`
- Test (Create): `tests/backgroundMapStack.test.ts`

**Read first:** 설계 4절 전부, 7.6, 12.3 · `mapGeometry.ts`의 `outlineArea`(:120-125, `Math.abs`를 쓰는 같은 식)·`containsPoint`(:208-219) · `mapSpatial.ts:211-212`(점이 3개 미만이면 윤곽이 상자) · `tests/backgroundMapGeometry.test.ts` 맨 위의 픽스처 꼴(공간·기호·카메라 만드는 법).

- [ ] **Step 1: 테스트를 쓴다(12.3)**
  - `spacePlanArea`: 사각형 800×520 → `416000` / 타원 160×140 → `17592.91886010284`(1e-9) / 삼각형(100×50, 점 (0,0)(1,0)(0.5,1)) → `2500` / ㄱ자(200×100, 점 (0,0)(1,0)(1,0.4)(0.4,0.4)(0.4,1)(0,1)) → `12800`(1e-9) / 점이 둘뿐인 다각형(100×50) → `5000` / 회전 37로 바꿔도 같은 값 / **점의 순서를 거꾸로 뒤집은 삼각형·ㄱ자도 `2500`·`12800`**(음수가 아니다).
  - `stackedSpaces`: `outer`(100, 80, 800×520)와 `inner`(400, 260, 160×140 타원) — `[inner, outer]`와 `[outer, inner]` 모두 id가 `['outer', 'inner']` / 거꾸로 돈 큰 다각형(0, 0, 400×400, 점 (0,0)(0,1)(1,1)(1,0)) 안의 작은 사각형(100, 100, 50×50): 두 순서 모두 `['큰 다각형', '작은 사각형']`이고 `spacesAt((120, 120))`이 `['작은 사각형', '큰 다각형']` / 같은 넓이 `twinA`(0, 0, 100×100)·`twinB`(50, 50, 100×100): `[twinA, twinB]` → `['twinA', 'twinB']`, 거꾸로 주면 `['twinB', 'twinA']`(뒤에 있는 것이 위) / 도면 `[closet(320, 220, 60×40), room(300, 200, 200×150), site(0, 0, 1000×680), floor(100, 80, 800×520), 의자, 카메라]` → `['site', 'floor', 'room', 'closet']` / 가로가 `NaN`인 공간은 맨 아래 / 돌려받은 노드가 받은 객체와 `===`이고 `map.nodes`의 순서가 그대로다(전후 `JSON.stringify` 동일).
  - `spaceStackRanks`(위 도면): `site 0, floor 1, room 2, closet 3`. 공간이 아닌 id는 없다(`has`가 거짓).
  - `spacesAt`(위 도면): (340, 240) → `['closet', 'room', 'floor', 'site']` / (450, 300) → `['room', 'floor', 'site']` / (150, 100) → `['floor', 'site']` / (50, 50) → `['site']` / (−5, −5) → `[]` / 돌려 놓은 방·타원·다각형은 `containsPoint`와 같은 답.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapStack.test.ts` → `ERR_MODULE_NOT_FOUND`(mapStack.ts 없음).
- [ ] **Step 3: 구현한다** (import는 아래 둘뿐)
  ```ts
  import { containsPoint } from './mapGeometry.ts';
  import type { BackgroundMap, BackgroundPoint, BackgroundSpace } from './types.ts';

  /** Plan area of a space as the plan draws it: what "smaller" means for stacking. */
  export function spacePlanArea(space: BackgroundSpace): number;
  /** The spaces of a map from the bottom of the stack to the top: a larger plan area lies below, and of two equal areas the earlier in the map. */
  export function stackedSpaces(map: BackgroundMap): BackgroundSpace[];
  /** Stack position of every space id: 0 is the bottom. */
  export function spaceStackRanks(map: BackgroundMap): Map<string, number>;
  /** The spaces that hold a plan point, the topmost (smallest) first. */
  export function spacesAt(map: BackgroundMap, point: BackgroundPoint): BackgroundSpace[];
  ```
  - `spacePlanArea`: 사각형 `width × height` · 타원 `width × height × π / 4` · 다각형은 저장된 0~1 점들의 신발끈 넓이의 **절댓값** × `width × height`(점이 3개 미만이면 `width × height`). 회전은 넓이를 바꾸지 않는다.
  - `stackedSpaces`: 공간만 골라 `(넓이 내림차순, 배열 번호 오름차순)`으로 정렬. 넓이가 유한하지 않으면 `Infinity`(맨 아래). 노드 객체는 받은 것 그대로, `map.nodes`는 바꾸지 않는다.
  - `spaceStackRanks`: `stackedSpaces`의 번호표. `spacesAt`: `stackedSpaces(map)` 가운데 `containsPoint(space, point)`인 것을 **위에서부터**.
- [ ] **Step 4:** `node --test tests/backgroundMapStack.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → tests 347보다 많음, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: 겹친 공간의 쌓임 순서 모듈(mapStack) — 작은 공간이 위, 같으면 배열 순서`

**이 Task가 끝나면 편집기는:** v1.131.0과 같다(새 모듈을 아직 쓰지 않는다).

### Task 2: 쌓임 순서를 읽는 네 곳 — 평면 그리기·보조 평면도·3D 바닥·새 기호

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx` (공간 그리기 :847, `placeSymbol` :421, import :11), `src/features/backgrounds/BackgroundMapPlanPreview.tsx` (:188), `src/features/backgrounds/map3dScene.ts` (`pickMapFloor` :592-608)
- Test: `tests/backgroundMap3dScene.test.ts` (:340-353, :367, :1616)

**Read first:** 설계 4절 '쓰는 곳 다섯', 7.3의 첫 문단, 7.5, 12.1(3D 행 셋과 그 아래 '손대지 않고 통과'), 12.6의 첫 불릿, 12.8 앵커 21 · `map3dScene.ts:586-628` · 테스트 :336-369, :1612-1634.

- [ ] **Step 1: 고정 값 셋을 바꾼다(12.1)** — ① :340의 주석을 "the smaller space is on top, whatever the order in the map"으로, :342의 `top = nested.nodes[1]`을 **`top = inner`** 로(두 순서 모두) ② :367의 기대값 `outer.id` → **`inner.id`** ③ :1616의 `mapOf([classroom, corridor, nook])` → **`mapOf([nook, classroom, corridor])`**. :1617-1634의 기대값은 한 글자도 바꾸지 않는다.
- [ ] **Step 2: 규칙 테스트 한 줄을 더한다(12.6 첫 불릿)** — :368 다음에, 같은 높이에서 넓이가 같은 두 공간 `twinA`(0, 0, 100×100)·`twinB`(50, 50, 100×100): `pickMapNode([hit(twinA.id, 'floor', 80), hit(twinB.id, 'floor', 80.00000001)], mapOf([twinA, twinB]))` → `twinB.id`, `mapOf([twinB, twinA])` → `twinA.id`(배열에서 뒤에 있는 것이 위).
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/backgroundMap3dScene.test.ts` → 고친 세 곳이 실패한다(:342 묶음의 `mapOf([inner, outer])` 쪽, :367, :1624 "the room drawn inside the classroom"). Step 2의 줄은 지금 규칙으로도 통과한다.
- [ ] **Step 4: `pickMapFloor`** — `order(hit)`를 `map.nodes.findIndex(…)` 대신 `ranks.get(String(hit.object.userData.nodeId)) ?? -1`로(`const ranks = spaceStackRanks(map)`, `import { spaceStackRanks } from './mapStack.ts';`). 나머지 줄(가장 가까운 바닥, 같은 높이 판정 `1e-6`, 번호가 큰 것이 이긴다, `map` 없이 부르면 가장 가까운 바닥)은 그대로. 머리말 주석의 "the space later in the map is on top"을 쌓임 순서(작은 공간이 위)로 고친다. 이 함수 안에 `map.nodes.findIndex(`를 남기지 않는다.
- [ ] **Step 5: 편집기** — 공간 그리기의 `current.nodes.filter((node): node is BackgroundSpace => node.type === 'space').map(node => {`를 `stackedSpaces(current).map(node => {`로. `placeSymbol`의 한 줄을 `const containingSpace = spacesAt(base, point)[0];`으로(그 아래 바닥 높이·`spaceId` 줄은 그대로). `import { spacesAt, stackedSpaces } from './mapStack';`를 더하고 쓰지 않게 된 `containsPoint`를 import에서 뺀다.
- [ ] **Step 6: 보조 평면도(:188)** — `{stackedSpaces(map).map(node => <PlanShape key={node.id} node={node} scale={scale} selected={node.id === selectedId} onActivate={activate} />)}`(`import { stackedSpaces } from './mapStack';`). 기호·카메라의 줄(:189-190)은 그대로.
- [ ] **Step 7: 자가 점검** — 편집기: `stackedSpaces(current).map(` 1곳 · `nodes.filter((node): node is BackgroundSpace` 0곳 · `spacesAt(base, point)[0]` 1곳 · `reverse().find(` 0곳. 보조 평면도: `stackedSpaces(map).map(` 1곳. `map3dScene.ts`: `spaceStackRanks(map)` 1곳.
- [ ] **Step 8:** `node --test tests/backgroundMap3dScene.test.ts` → 통과(:449-453 "…and a space never cycles", :1617-1634는 손대지 않고 통과).
- [ ] **Step 9:** `npm run typecheck` → 오류 없음.
- [ ] **Step 10:** `npm run test:background` → Task 1과 같은 수(단언만 늘었다), fail 0, skipped 3. `tests/backgroundMapGeometry.test.ts:234-254`(카메라 소속)·`:426-443`은 손대지 않고 통과해야 한다.
- [ ] **Step 11: 커밋** — 네 파일 / `배경 도면: 겹친 공간은 작은 것이 위 — 평면 그리기·보조 평면도·3D 바닥 고르기·새 기호의 소속이 같은 쌓임 순서를 읽는다`

**v1.131.0과 달라지는 것(되살리지 말 것):** 겹친 공간의 그리는 순서와 누름이 배열 순서가 아니라 넓이 순서다(나중에 그린 큰 방이 작은 방을 덮지 않는다). 3D의 같은 높이 바닥도 작은 공간이 먼저다 — 3D 테스트의 고정 값 셋이 뒤집힌다. 새 기호는 놓은 자리의 **가장 작은** 공간에 속한다(예전: 배열에서 마지막). 새 카메라의 소속(`addMapCamera`)은 **그대로**다. 저장되는 `nodes`의 순서는 바뀌지 않는다.
**이 Task가 끝나면 편집기는:** 큰 방 안의 작은 방이 그린 순서와 무관하게 평면·보조 평면도·3D에서 눌린다. 넘기기는 아직 없다(공간은 더미를 이루지 않는다).

---

## Chunk 2: 선택 모델

### Task 3: 선택 모델 — `selectedIds`, `select-many`·`pick-one`, 읽는 함수 셋 (`mapDocument.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapDocument.ts`, `src/features/backgrounds/useBackgroundMapDocument.ts`
- Test: `tests/backgroundMapDocument.test.ts`

**Read first:** 설계 3.1~3.4 전부, 1.3의 R1~R3, 12.1(문서 테스트 행 넷), 12.2 · `mapDocument.ts` 전체(특히 :13, :28-42, :47, :127-136, :146-148) · 테스트 :1-25(픽스처 `mapA`·`run`·`opened`·`valueOf`), :253-290.

- [ ] **Step 1: 고정 값 넷에 `selectedIds`를 더한다(12.1)** — :256 `{ x: 30, y: -20, zoom: 2, selectedId: camera.id, selectedIds: [camera.id] }` · :257 `…selectedId: 'space-in-b', selectedIds: ['space-in-b']` · :258 `…selectedId: null, selectedIds: []` · :268 `{ x: 0, y: 0, zoom: 0.5, selectedId: camera.id, selectedIds: [camera.id] }`. 다른 기존 단언(:262-265 `viewports` 정체, :269, :277-288)은 손대지 않고 통과해야 한다.
- [ ] **Step 2: 새 테스트를 쓴다(12.2)** — import에 `mapSelection, singleViewId, pickAction`(mapDocument)과 `nextPlanSelection`(mapPlanPreview)을 더한다.
  - `select`: `select-many [a, b]` 뒤 `select b` → `selectedIds` `['b']`·`selectedId` `'b'`(대표를 다시 골라도 접힌다 — 이른 반환이 없어졌다) / `select null` → `[]`·`null` / 같은 선택을 다시 → 받은 `state`(`assert.equal`).
  - `select-many`: `['a', 'b', 'a', 'c']` → `['a', 'b', 'c']`, 대표 `'c'` / 빈 목록 → `[]`·`null` / 같은 id·같은 순서 → 받은 `state` / 다른 도면의 보기 값은 `===` / `set-viewport`(옮기기·확대) 뒤에도 `selectedIds`가 **같은 배열**(`===`).
  - 더하기·빼기 액션은 없다: `{ type: 'toggle-select', … }` → 받은 `state` 그대로, `add: true`를 실은 `select-many` → 바꿔 넣기(리듀서가 `add`를 읽지 않는다).
  - 불변식: `select`·`select-many`를 섞은 열 번의 진행마다 `selectedId === (selectedIds[selectedIds.length - 1] ?? null)`.
  - **`pick-one`은 선택을 건드리지 않는다**: `[a, b]`에서 `pick-one x` → `selectedIds`가 전과 같은 배열(`===`), `selectedId` `'x'`, `coalescing` `null`, `drafts` `===` / `pick-one null` → `selectedId` `null`, 목록은 같은 배열 / 같은 id를 다시 → 받은 `state` / 다른 도면의 보기 값 `===` / 이어서 `set-viewport` → `selectedId`가 그대로 실려 간다.
  - **평면의 선택 액션은 `selectedId`를 대표로 되돌린다**: `pick-one x` 뒤 `select-many [a, b]`(같은 목록) → 받은 `state`가 **아니고** `selectedId: 'b'`인 새 보기 값. 한 번 더 같은 `select-many` → 이번에는 받은 `state`. `pick-one x` 뒤 `select a` → `['a']`·`'a'`.
  - **사라진 id는 선택을 손댈 때 떨어진다**: 공간 S를 더하고 `select S` → `undo`(저장 목록 `['S']`, `mapSelection(초안, 저장 목록).ids`는 `[]`) → `select-many`에 `[...mapSelection(…).ids, '의자']` → `redo` → `mapSelection(…).ids`가 `['의자']`. 견주는 경우: 손대지 않고 `undo` → `redo`만 하면 `['S']`.
  - `singleViewId`(도면에 `a`·`b`·`c`·`x`): 선택 `[a]`·`selectedId` `'a'` → `'a'` / `[a]`·`'x'` → `'a'` / 빈 선택 → `null`(`selectedId`가 무엇이든) / `[a, b]`·`'b'` → `'b'` / `'a'` → `'a'` / 묶음 밖 `'x'` → `'x'` / `null` → `null` / 도면에 없는 `'gone'` → `'b'` / 도면 `undefined` → `null`.
  - `pickAction`: 선택 `[a, b]`·`singleView` 참 → `{ type: 'pick-one', mapId, id }` — `id`가 `'b'`·`'a'`·`'x'`·`null` 넷 모두 / 같은 선택·거짓 → 넷 모두 `{ type: 'select', mapId, id }` / 선택 `[a]`와 빈 선택은 참이어도 `select` / 저장 목록 `[a, gone]`(살아 있는 것 하나)도 `select`.
  - **3D에서 고른 것은 묶음을 바꾸지 않는다**: `reduce(state, pickAction(mapId, id, true, mapSelection(도면, mapViewport(state, mapId).selectedIds)))` 꼴로 `select-many [a, b, c]` 뒤 `x`, `null`, `a`, `c`, `x`를 차례로 → 매번 `selectedIds`가 처음의 그 배열(`===`)이고 `singleViewId(…)`가 방금 고른 것 / 같은 자리의 카메라 셋(`camA`·`camB`·`camC`)에서 `[a, camB]`를 고르고 `nextPlanSelection(도면, 'camA', 'camB')`의 결과(`'camC'`)를 같은 식으로 → `selectedIds` 같은 배열, `singleViewId` `'camC'` / 견주는 경우: 선택 `[a]`에서 같은 식으로 `x` → `selectedIds` `['x']`.
  - 선택이 달라지면 `coalescing`이 `null`, 같으면 유지.
  - **선택은 편집과 무관하다**: `[a, b]`를 고른 뒤 `gesture-begin/preview/finish`, `undo`, `redo`, `discard`, `drop-drafts`를 차례로 — 매번 `viewports`가 같은 객체(`===`). 선택 액션은 `drafts`를 바꾸지 않는다(`===`).
  - **전환은 여전히 액션이 아니다**: 여러 개를 고른 상태에서 :281-282 꼴의 `set-mode` 반복 → `state` 그대로.
  - `mapSelection(map, 저장 목록)`: 모두 살아 있으면 `ids`가 저장된 배열과 `===` / 노드 하나를 뺀 도면이면 그 id만 빠지고 대표는 남은 것의 마지막 / 대표가 죽었으면 그 앞의 것이 대표 / 도면 `undefined`·빈 선택 → `{ ids: [], primaryId: null }`이고 두 번 불러 같은 객체 / 되돌리기로 사라졌다가 다시 실행으로 돌아오면 `ids`에 다시 든다.
  - 스토어(`createMapDocumentStore`): `select-many`가 구독자에게 한 번 알리고, 같은 선택은 알리지 않는다.
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/backgroundMapDocument.test.ts` → 파일 전체가 `does not provide an export named 'mapSelection'`(또는 첫 번째 없는 이름)으로 실패.
- [ ] **Step 4: `mapDocument.ts`를 구현한다** (문서 키 `coalescing·drafts·gesture·viewports`는 그대로. `update`·`undo`·`redo`·`gesture-*`·`discard`·`drop-drafts`·`begin-editing`·`enter-new-map`은 선택을 건드리지 않는다)
  - `MapViewport`: `{ x: number; y: number; zoom: number; selectedId: string | null; selectedIds: readonly string[] }` — 두 필드의 문서 주석은 설계 3.1의 코드 블록 그대로.
  - `const NO_SELECTION: readonly string[] = [];` 하나를 빈 선택마다 돌려 쓴다. `DEFAULT_VIEWPORT`에 `selectedIds: NO_SELECTION`.
  - 액션 둘을 더한다: `| { type: 'select-many'; mapId: string; ids: readonly string[] }` · `| { type: 'pick-one'; mapId: string; id: string | null }`.
  - 리듀서 안의 `withSelection(state, mapId, viewport, ids)` 하나가 `select`·`select-many`를 처리한다: 결과 목록이 지금 목록과 **같은 id·같은 순서**이고 `selectedId`도 이미 그 마지막 것(빈 목록이면 `null`)이면 받은 `state`. 목록은 같은데 `selectedId`만 다르면 `selectedId`를 대표로 되돌린 새 보기 값(목록 배열은 지금 것을 그대로 싣는다 — 설계가 정하지 않은 곳이라 메모에 이로운 쪽으로 정했다). 목록이 달라졌으면 새 목록과 그 대표. 바뀐 두 경우 모두 그 도면의 보기 값만 새 객체로 바꾸고 `coalescing: null`. `select`는 `id`가 있으면 `[id]`, `null`이면 빈 목록. `select-many`는 `ids`에서 중복을 뺀 것(먼저 나온 자리 유지). **지금의 이른 반환 `if (viewport.selectedId === action.id) return state;`(:129)는 없앤다.** 리듀서는 id가 그 도면의 노드인지 확인하지 않는다.
  - `pick-one`: `selectedId`가 이미 `action.id`면 받은 `state`. 아니면 `{ ...viewport, selectedId: action.id }`와 `coalescing: null` — **`selectedIds`는 같은 배열이 실려 간다.**
  - 읽는 함수(순수, 이 파일에 둔다. 문서 주석은 설계 3.3 그대로):
    ```ts
    export type MapSelection = { /** Selected ids that are nodes of the map, in picked order. */ ids: readonly string[]; /** The last of them. */ primaryId: string | null };
    export function mapSelection(map: BackgroundMap | undefined, selectedIds: readonly string[]): MapSelection;
    export function singleViewId(map: BackgroundMap | undefined, selection: MapSelection, selectedId: string | null): string | null;
    export function pickAction(mapId: string, id: string | null, singleView: boolean, selection: MapSelection): MapDocumentAction;
    ```
    `mapSelection`: `map`이 없거나 저장 목록이 비었으면 상수 객체 하나 `{ ids: NO_SELECTION, primaryId: null }`. 저장된 id가 모두 그 도면의 노드면 **저장된 배열 그대로**를 `ids`로, 아니면 살아 있는 것만 거른 새 배열. `primaryId`는 `ids`의 마지막. / `singleViewId`: 살아 있는 선택이 하나 이하면 `selection.primaryId`, 여러 개면 `selectedId`가 `null`이면 `null`·그 도면의 노드면 그 id·도면에 없으면 `selection.primaryId`. / `pickAction`: `singleView`가 참이고 `selection.ids.length > 1`일 때만 `{ type: 'pick-one', mapId, id }`, 그 밖에는 `{ type: 'select', mapId, id }`(`id`가 무엇인지는 보지 않는다).
- [ ] **Step 5: 훅** — `BackgroundMapDocument` 타입에 `selectMany(mapId: string, ids: readonly string[]): void;`, 구현 `selectMany: (mapId: string, ids: readonly string[]) => store.dispatch({ type: 'select-many', mapId, ids })`. `pick-one`은 훅에 이름을 두지 않는다(편집기가 `doc.dispatch(pickAction(…))`로 보낸다).
- [ ] **Step 6:** `node --test tests/backgroundMapDocument.test.ts` → 통과.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3(`tests/backgroundMap3dScene.test.ts:1949, :2055` 근처의 통합 테스트가 손대지 않고 통과).
- [ ] **Step 9: 커밋** — 세 파일 / `배경 도면: 선택 모델 — 도면별 선택 묶음(selectedIds)과 select-many·pick-one, 읽을 때 거르는 mapSelection·singleViewId·pickAction`

**v1.131.0과 달라지는 것(되살리지 말 것):** `select`의 이른 반환이 없다 — `select(id)`는 어디서 보내든 묶음을 그것 하나로 접는다. 보기 값에 `selectedIds`가 있다(기존 테스트의 고정 값 넷). 저장 목록에 더하거나 빼는 액션은 **만들지 않는다**.
**이 Task가 끝나면 편집기는:** v1.131.0과 같다(하나만 고르는 동안 `select`의 결과가 같다).

### Task 4: 편집기가 선택을 읽는 곳 — `selection`·`singleId`·`selected`, `select` → `pickAction`, 오브젝트 목록

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`

**Read first:** 설계 2.2의 표, 3.5 전부(코드 블록과 # 표), 6.7의 `select` 코드 블록과 그 아래 불릿, 10.1의 `ObjectList`·`listSelection`, 12.8 앵커 22·23·24 · 편집기 :151-164, :216-243, :321-325, :335, :338-355, :754-768, :896, :903, :983.

이 Task에는 새 순수 테스트가 없다(계산은 Task 3에서 고정했다). 배선은 Step 7의 자가 점검과 Task 15의 앵커 22·23·24로 지킨다.

- [ ] **Step 1: 읽는 값(3.5)** — `import { mapSelection, pickAction, singleViewId } from './mapDocument'`와 `import type { MapSelection }`을 더하고, `const selected = current?.nodes.find(node => node.id === view.selectedId);`(:220)를 설계 3.5의 다섯 줄로 바꾼다(주석 포함, 글자 그대로): `const selection = useMemo(() => mapSelection(current, view.selectedIds), [current, view.selectedIds]);` · `const multiple = selection.ids.length > 1;` · `const singleId = singleViewId(current, selection, view.selectedId);` · `const selected = mode === 'plan' && multiple ? undefined : current?.nodes.find(node => node.id === singleId);` · `const groupNodes = useMemo(() => current ? current.nodes.filter(node => selection.ids.includes(node.id)) : [], [current, selection]);`(`groupNodes`는 Task 11이 쓴다).
- [ ] **Step 2: `selected`를 따라가는 곳** — `settledSelected`(:243)는 `settledCurrent?.nodes.find(node => node.id === selected?.id)` · 시점 보기를 끝내는 효과(:321-323)의 비교와 의존값을 `singleId`로(`previous.id === singleId`, `[singleId, current?.id, mode]`) · 고른 점을 푸는 효과(:325)의 의존값을 `[selected?.id, current?.id, mode, canEdit]`로.
- [ ] **Step 3: `select`(:335)** — 본문을 설계 6.7의 한 줄로(문서 주석 포함): `function select(id: string | null, mapId = current?.id) { if (mapId) doc.dispatch(pickAction(mapId, id, mode === '3d' && mapId === current?.id, selection)); }`. `selectNode`·`clearSelection`(:754-755)과 `select(null, childId)`(:500), `confirmAction`의 `'delete-node'` 분기 끝의 `select(null)`(:455)은 그대로 둔다.
- [ ] **Step 4: 3D와 보조 평면도** — `<Map3D map={current} selectedId={singleId} canEdit={canEdit} onSelect={selectNode}`와 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} />`. `onSelect`와 `mapCanvas.ts`는 그대로다.
- [ ] **Step 5: 오브젝트 목록(10.1)** — `ObjectList`의 props를 `{ nodes, selectedIds, primaryId, onSelect }: { nodes: BackgroundNode[]; selectedIds: readonly string[]; primaryId: string | null; onSelect: (id: string) => void }`로. 줄의 `is-selected`는 `selectedIds.includes(node.id)`, `aria-current`는 `node.id === primaryId`일 때만 `'true'`. `settledCurrent` 다음에 설계 10.1의 `listSelection` 메모를 글자 그대로 두고(`[settledCurrent, view.selectedIds, view.selectedId, mode]`) `<ObjectList nodes={settledCurrent?.nodes ?? current.nodes} selectedIds={listSelection.ids} primaryId={listSelection.primaryId} onSelect={selectNode} />`.
- [ ] **Step 6: 이 Task에서 건드리지 않는 것** — 평면 노드의 강조(`node.id === selected?.id`, :848·:856·:874 — Task 9가 `shownIds`로 바꾼다), `pointerDown`이 `view.selectedId`를 읽는 줄(:599 — Task 9가 없앤다), 속성 칸의 분기(Task 11). `switchMode`·`leave3D`·`navigate`에는 선택을 부르는 줄을 넣지 않는다(전환은 선택을 건드리지 않는다, R2).
- [ ] **Step 7: 자가 점검** — 편집기에 `doc.select(` 0곳 · `pick-one` 0곳 · `const singleId = singleViewId(current, selection, view.selectedId);` 1곳 · `selectedId={singleId}` 2곳 · `selectedId={view.selectedId}` 0곳 · `function switchMode`부터 `function expandPath` 앞까지와 `function navigate` 줄에 `select(`·`selectMany(` 0곳.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → Task 3과 같은 수, fail 0, skipped 3(기존 앵커 20개 통과).
- [ ] **Step 10: 커밋** — 한 파일 / `배경 도면: 편집기가 선택 묶음을 읽는다 — 3D와 보조 평면도에는 하나(singleId)만, select는 pickAction으로, 목록은 묶음 전체 강조`

**v1.131.0과 달라지는 것(되살리지 말 것):** `selected`는 더 이상 "`view.selectedId`인 노드"가 아니다. 편집기는 `doc.select`를 직접 부르지 않는다(3D 모드에서 여러 개가 선택돼 있으면 같은 `select(id)`가 `pick-one`이 되어야 한다).
**이 Task가 끝나면 편집기는:** v1.131.0과 같다 — 여러 개를 고를 길이 아직 없으므로 `pickAction`은 늘 `select`이고 `singleId`는 그 선택이다.

---

## Chunk 3: 묶음 계산과 판정 모듈 (순수)

### Task 5: 묶음 계산 — `moveMapNodes`·`removeMapNodes`·`lockMapNodes`와 `move-group` 제스처

**Files:**
- Modify: `src/features/backgrounds/mapGeometry.ts`, `src/features/backgrounds/mapPlanGesture.ts`
- Test: `tests/backgroundMapGeometry.test.ts`, `tests/backgroundMapPlanGesture.test.ts`

**Read first:** 설계 2.4, 6.3 전부, 6.4의 코드 블록과 '지우기' 첫 불릿, 12.5의 `moveMapNodes`~`previewPlanGesture` 묶음 · `mapGeometry.ts:54-117`(`transformMapSpace`·`moveMapNode`·`placeMapNode`·`removeMapNode`) · `mapPlanGesture.ts` 전체 · `mapSnap.ts:78-83, :154-174`(`snapTravellingIds`·`snapMove` — 고치지 않는다).

- [ ] **Step 1: 테스트를 쓴다(12.5)**
  - `moveMapNodes` — 도면 `[A(100, 100, 144.65×80), B(300.4, 120.3, 60×40), chairB(310, 130, 20×20, B 소속), lockedB(330, 130, 20×20, B 소속·잠김), free(400.5, 200.25, 30×30), camB(320, 140, B 소속), LS(600, 300, 100×100, 잠김), mLS(620, 320, 20×20, LS 소속)]`: `ids [B, chairB, free, LS, mLS, lockedB]`, `delta (10, −5)` → B (310.4, 115.3), chairB (320, 125)(한 번만), camB (330, 135)(묶음에 없어도 실려 간다), free (410.5, 195.25), mLS (630, 315), **LS·lockedB·A는 받은 객체 그대로**(`===`). 1e-9 비교 / id 하나: `[B]`가 `moveMapNode(map, 'B', d)`와, `[free]`가 `moveMapNode(map, 'free', d)`와 `deepEqual` / `[LS, lockedB, 'missing']` → `map` 그대로(`===`) / `anchor { id: 'B', position: { x: 244.65, y: 113 } }` → B의 저장 x·y가 정확히 그 값(`===`), 나머지는 `delta`만큼. 입력 도면을 바꾸지 않는다.
  - `removeMapNodes`: `[B, free]` → chairB·lockedB·camB가 남고 `spaceId`가 `null`, mLS는 `LS` 그대로. `removeMapNode`를 차례로 부른 것과 `deepEqual` / 없는 id뿐 → `map`(`===`) / **잠긴 것은 남는다**: `[B, lockedB, LS, free]` → B와 free만 지워진다(lockedB는 남되 `spaceId` `null`, LS와 mLS는 받은 객체 `===`) / `[LS, lockedB]` → `map`(`===`).
  - `lockMapNodes`: 섞인 묶음을 잠그면 모두 `locked: true`, 이미 잠긴 노드 객체는 `===` / 모두 이미 그 값이면 `map`(`===`) / 좌표·`spaceId`는 바뀌지 않는다.
  - `previewPlanGesture`의 `move-group` — 도면 `[A(100, 100, 144.65×80), B(300.4, 120.3, 60×40), free(400.5, 126.25, 30×30)]`, `ids [B, free]`, 허용 6, 닿는 거리 48, 후보는 `planGestureCandidates`로: 스냅 없음 → `moveMapNodes(initial, [B, free], delta)`와 `deepEqual` / 기준 B, `delta (−52, −7.6)` → B (244.65, 113)(`===`), free (344.75, 118.95)(1e-9), 안내선 x 한 줄(`at 244.65`, `from 100`, `to 180`) / 기준 free(누른 것이 free), 같은 `delta` → free (344.75, 119), B ≈ (244.65, 113.05)(1e-9). 두 경우 모두 간격이 처음과 같다 / `delta (200.3, 300.3)` → B (501, 421), 안내선 없음 / 후보에 B와 free의 선이 없다(`planGestureCandidates`의 x·y 선 수 = 테두리 2 + A의 3) / `[B, chairB]`, `delta (10, 5)` → `moveMapNode(initial, 'B', delta)`와 같은 좌표(의자가 두 번 가지 않는다) / 누른 것이 실려 가는 항목: 위 도면에 `chairB(310, 130, 20×20, B 소속)`를 더하고 `{ mode: 'move-group', nodeId: 'chairB', ids: ['B', 'chairB'] }`, `delta (−52, −7.6)` → B의 저장 위치 `(244.65, 113)`(`===`), 의자 (254.25, 122.7)(1e-9). 의자 세로 122·B 세로 112.3이 나오면 기준이 잘못 잡힌 것이다 / 잠긴 것만 든 묶음 → `map`이 `initial`과 `===`, 안내선 없음. 잠긴 것이 섞이면 그것만 `===`로 남는다 / 순수성: 같은 인자 = 같은 결과(다른 점을 먼저 미리 본 뒤에도), `initial`을 바꾸지 않는다.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapGeometry.test.ts` → `does not provide an export named 'moveMapNodes'`. `node --test tests/backgroundMapPlanGesture.test.ts`도 `moveMapNodes`를 import하므로 같은 문구로 파일 전체가 실패한다(import를 빼고 돌리면 새 테스트만 단언 실패다 — 없는 `move-group`은 지금 회전 분기로 떨어진다).
- [ ] **Step 3: `mapGeometry.ts`** (문서 주석은 설계 6.3·6.4 그대로)
  ```ts
  export function moveMapNodes(map: BackgroundMap, ids: readonly string[], delta: BackgroundPoint,
    anchor?: { id: string; position: BackgroundPoint }): BackgroundMap;
  export function removeMapNodes(map: BackgroundMap, ids: readonly string[]): BackgroundMap;
  export function lockMapNodes(map: BackgroundMap, ids: readonly string[], locked: boolean): BackgroundMap;
  ```
  - `moveMapNodes`: ① 움직이는 것 = `ids`에 있고 도면에 있으며 **잠기지 않은** 노드. 없으면 `map` 그대로 ② 갈 자리 = `anchor`의 노드면 `anchor.position`, 아니면 저장 x·y + `delta` ③ 움직이는 **공간**마다 `transformMapSpace(지금까지의 도면, { ...space, 갈 자리 })`를 한 번씩(그 공간의 잠기지 않은 소속 항목은 여기서 한 번 실려 간다. 잠긴 소속 항목은 남는다) ④ 그다음, 움직이는 것 가운데 공간이 아니고 **③에서 실려 가지 않은 것**(자기 공간이 움직이는 공간이 아닌 것)만 갈 자리로 ⑤ id 하나면 `moveMapNode(map, id, delta)`와 같은 값.
  - `removeMapNodes`: 대상은 `ids` 가운데 도면에 있고 **잠기지 않은 것**. 없으면 `map` 그대로. 지워진 공간에 속했던 남은 항목은 `removeMapNode`처럼 `spaceId: null`. (`removeMapNode`는 고치지 않는다 — 하나를 지울 때의 잠금은 지금처럼 부르는 쪽이 본다.)
  - `lockMapNodes`: 목록의 노드 가운데 `locked`가 다른 것만 바꾼다. 바뀌는 것이 없으면 `map` 그대로.
- [ ] **Step 4: `mapPlanGesture.ts`** — `PlanGesture`에 `| { mode: 'move-group'; nodeId: string; ids: readonly string[] }`(주석 ``/** Several selected nodes moved as one. `nodeId` is the pressed one. */``). `previewPlanGesture`에 설계 6.3의 분기를 그대로 — **`const node = initial.nodes.find(…)` 줄보다 앞에** 둔다(이 함수의 마지막 갈래는 회전이라, 빠지면 묶음이 돈다):
  ```ts
  const moving = initial.nodes.filter(node => gesture.ids.includes(node.id) && !node.locked).map(node => node.id);
  if (!moving.length) return { map: initial, guides: [] };
  const anchorId = groupAnchorId(initial, moving, gesture.nodeId);
  const stuck = snap && snapMove(initial, moving, anchorId, delta, snap.candidates, snap.tolerance, snap.reach);
  return stuck ? { map: moveMapNodes(initial, moving, stuck.delta, { id: anchorId, position: stuck.position }), guides: stuck.guides }
    : { map: moveMapNodes(initial, moving, delta), guides: [] };
  ```
  `groupAnchorId`(모듈 안의 함수): 누른 노드. 누른 것이 움직이는 공간에 **실려 가는** 항목(자기 공간이 `moving` 안의 공간)이면 그 공간. 누른 것이 `moving`에 없으면 `moving[0]`. `planGestureCandidates`의 `move-group`(마지막 줄보다 앞): `collectSnapCandidates(initial, snapTravellingIds(initial, moving))` — 묶음에 든 잠긴 것은 붙는 대상으로 남는다.
- [ ] **Step 5:** 두 테스트 파일 → 통과.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음(편집기의 `planGestureOf`는 그대로 컴파일된다).
- [ ] **Step 7:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 8: 커밋** — 네 파일 / `배경 도면: 묶음 계산 — 함께 옮기기(moveMapNodes, 소속 항목은 한 번만)·함께 지우기·잠그기와 move-group 제스처의 스냅`

**이 Task가 끝나면 편집기는:** Task 4와 같다(아직 부르지 않는다).

### Task 6: 더미 목록 `planPileAt`와 더블클릭이 하는 일 `planDoubleClickAction`

**Files:**
- Modify: `src/features/backgrounds/mapPlanPreview.ts`, `src/features/backgrounds/mapPlanEdit.ts`
- Test: `tests/backgroundMapPlanPreview.test.ts`, `tests/backgroundMapPlanEdit.test.ts`

**Read first:** 설계 7.2의 '더미 목록'과 '더블클릭이 하는 일'(코드 블록·표 둘), 12.5의 `planDoubleClickAction`·`planPileAt` 줄 · `mapPlanPreview.ts:112-147` · `mapPlanEdit.ts:66-73`(`doubleClickNodeId`).

- [ ] **Step 1: 테스트를 쓴다(12.5)**
  - `planPileAt`(Task 1의 겹친 도면 `[closet, room, site, floor, …]`에 카메라 셋을 같은 자리에 더한 것): 공간 위 (340, 240) → `['closet', 'room', 'floor', 'site']` / 눌린 공간이 그 점을 품지 않으면 `[hitId]` / 카메라 위에서는 `planStackUnder`와 같은 목록(공간이 섞이지 않는다).
  - `planDoubleClickAction`(7.2의 표 그대로): 연결된 공간(`hasDetailMap` 참) × 도구 `select`·`hand` → `'open'`(`canEdit` 거짓이어도, 잠겨 있어도), 도구 `rect` → `null` / 연결 없는 공간·기호·카메라: 도구 `select`·`canEdit` 참·잠기지 않음 → `'rename'`, `canEdit` 거짓 → `null`, 잠김 → `null`, 도구 `hand` → `null`.
- [ ] **Step 2: 실패를 확인한다** — 두 파일이 각각 `does not provide an export named 'planPileAt'` / `'planDoubleClickAction'`으로 실패.
- [ ] **Step 3: 구현한다** (문서 주석은 설계 7.2 그대로)
  ```ts
  // mapPlanPreview.ts — planStackUnder·nextPlanSelection 옆. import { spacesAt } from './mapStack.ts';
  export function planPileAt(map: BackgroundMap, hitId: string, point: BackgroundPoint, tolerance?: number, covers?: (node: BackgroundNode) => boolean): string[];
  // mapPlanEdit.ts
  export type PlanDoubleClickAction = 'open' | 'rename' | null;
  export function planDoubleClickAction(node: BackgroundNode, context: { tool: string; canEdit: boolean; hasDetailMap: boolean }): PlanDoubleClickAction;
  ```
  - `planPileAt`: 눌린 것이 카메라·기호면 `planStackUnder(map, hitId, tolerance, covers)` 그대로. 공간이면 `spacesAt(map, point)`의 id들(작은 것부터)이고, 눌린 공간이 그 안에 없으면 `[hitId]`. 더미는 종류를 섞지 않는다.
  - `planDoubleClickAction`: 공간이고 `hasDetailMap`이면 도구가 `select` 또는 `hand`일 때 `'open'`, 그 밖의 도구는 `null`. 그 밖의 모든 노드는 도구가 `select`이고 `canEdit`이고 잠기지 않았을 때 `'rename'`, 아니면 `null`.
- [ ] **Step 4:** 두 테스트 파일 → 통과(`tests/backgroundMapPlanPreview.test.ts:357-429`는 손대지 않고 통과).
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 네 파일 / `배경 도면: 같은 자리에서 차례로 넘어가는 목록(planPileAt)과 더블클릭이 하는 일(planDoubleClickAction)`

**이 Task가 끝나면 편집기는:** Task 4와 같다.

### Task 7: 상자 판정 — `planRect`·`planRectTouches`·`planMarqueeIds`·`planMarkCovers` (`mapPlanSelect.ts`)

**Q1 — 이 Task를 시작하기 전에 오케스트레이터가 한솔의 답을 받는다**(설계 1.1·16.1의 물을 말 그대로). 아래는 이 설계의 답 **"공간은 벽이 상자에 닿아야 잡힌다"** 로 썼다. 답이 같으면 그대로 간다. 답이 "넓이가 겹치면 고른다"면 바뀌는 곳은 설계 16.1에 적힌 것뿐이다: `planRectTouches`의 공간 판정(사각형·다각형, 타원 두 줄)에 "상자의 한 꼭짓점이 공간 안"(`containsPoint`)을 더하고, 12.4의 '안쪽' 줄들(아래 Step 1에서 ★로 표시)과 M2·M7·M13의 기대, 6.8의 둘째 줄, 완료 보고의 Q1 문장을 고친다. 그때는 오케스트레이터가 ★ 줄의 새 기대값을 정해 넘긴다 — 작업자가 스스로 정하지 않는다. 답이 '넓이'면 이 Task의 커밋 메시지(Step 7의 "공간은 벽이, 기호는 넓이가" → "공간과 기호는 넓이가")와 Task 15 Step 3의 표본 '벽 판정을 넓이 판정으로'도 거꾸로(더한 `containsPoint` 검사를 삭제) 바꾼다. Task 1~6과 Task 8~14는 답과 무관하고, Task 16의 `AGENTS.md`(Step 3)와 완료 보고는 받은 답대로 적는다.

**Files:**
- Create: `src/features/backgrounds/mapPlanSelect.ts`
- Test (Create): `tests/backgroundMapPlanSelect.test.ts`

**Read first:** 설계 6.2 전부("닿았다"의 표와 그 아래 세 문단), 16.4의 둘째 불릿, 12.4의 `planRect`·`planRectTouches`·`planMarqueeIds`·`planMarkCovers` · `mapSpatial.ts:239-256`(`nodePlanOutline`) · 편집기 :84-85(`onPlanMark` — 옮겨 올 식) · `mapPlanEdit.ts:5-10`(`MAP_EDIT_MARK.cameraBody` 12·`cameraRing` 18·`cameraFan` 80) · `tests/backgroundMapPlanPreview.test.ts:380-388`(`mainPlan`).

- [ ] **Step 1: 테스트를 쓴다(12.4)** — 방 R = (100, 100, 200×100).
  - `planRect`: `(310, 210) → (90, 90)`과 그 반대가 같은 상자.
  - R: ★(150,120)–(250,180) 안쪽 → 거짓 / (280,120)–(320,180) 오른쪽 벽을 가로지름 → 참 / (90,90)–(310,210) 통째로 감쌈 → 참 / (310,90)–(400,210) 밖 → 거짓 / (300,120)–(340,160) 벽에 딱 닿음 → 참, (300.5,120)–(340,160) → 거짓 / 크기 0인 상자 ★(150,150) → 거짓, (300,150) → 참.
  - R, 회전 30(윤곽 ≈ (138.397, 56.699) (311.603, 156.699) (261.603, 243.301) (88.397, 143.301)): (100,100)–(110,110) → 참 / ★(190,140)–(210,160) → 거짓(안쪽) / (130,50)–(145,60) → 참 / (286,100)–(300,108) → 거짓(돌리기 전 상자 안이지만 돌린 방 밖).
  - 타원 E = (100, 100, 200×100): ★(180,130)–(220,170) 안 → 거짓 / (100,100)–(115,108) 감싼 상자의 귀퉁이 → 거짓 / (100,140)–(110,160) → 참 / 감쌈 → 참 / (301,140)–(320,160) → 거짓 / (300,140)–(320,160) 접함 → 참. E, 회전 45: (262,212)–(275,225) 긴 축의 끝 → 참 / ★(195,145)–(205,155) 가운데 → 거짓.
  - 가운데 아래가 파인 다각형 U = (100, 100, 200×200, 점 (0,0)(1,0)(1,1)(0.6,1)(0.6,0.5)(0.4,0.5)(0.4,1)(0,1)): (150,220)–(250,280) 네 꼭짓점이 모두 안이지만 파인 곳을 걸침 → 참 / ★(120,220)–(160,280) 왼쪽 팔 안 → 거짓 / (190,220)–(210,280) 파인 곳 안 → 거짓.
  - 의자 (300, 300, 40×40): (310,310)–(320,320) 안 → 참 / (335,335)–(360,360) → 참 / (341,300)–(360,320) → 거짓. 회전 45: (300,300)–(304,304) 돌리기 전 귀퉁이 → 거짓 / (318,290)–(322,293) 돌린 꼭짓점 → 참. pitch 60·입체 높이 200(드리운 윤곽이 y 503까지): (310,400)–(330,420) 드리운 윤곽 안 → 거짓 / (310,310)–(330,330) → 참.
  - 카메라 (500, 340): (512,330)–(520,350) 정확히 12 → 참 / (512.5,330)–(520,350) → 거짓 / (560,335)–(570,345) 부채꼴만 → 거짓 / (490,330)–(510,350) → 참 / (508,348)–(520,360) 대각 11.3 → 참 / (509,349)–(520,360) 12.7 → 거짓. 수직 카메라(pitch 90): (517,330)–(530,350) → 참 / (519,330)–(530,350) → 거짓.
  - R에 상자의 값 하나가 `NaN` → 거짓.
  - `planMarqueeIds` — 도면 `[site(0, 0, 1000×680), R, locked(600, 100, 100×100, 잠김), 의자 c(300, 300, 40×40), 카메라 cam(500, 340)]`: ★(90,90)–(310,210) → `['R']`(안에 든 상자라 `site`는 없다) / ★(150,120)–(250,180) → `[]` / (−10,−10)–(1010,690) → `['site', 'R', 'locked', 'c', 'cam']`(도면 순서, 잠긴 것 포함) / ★(590,150)–(610,160) → `['locked']` / 입력 도면을 바꾸지 않는다 / 끝에 `tiny(540, 335, 10×10)`·`under(495, 335, 10×10)`를 더하면 ★(535,330)–(555,350) → `['tiny']`, ★(480,320)–(520,360) → `['cam', 'under']`(도면 순서).
  - `planMarkCovers`: `planNodeCovers(node, point, 카메라면 수직 18 / 그 밖 12 · 기호면 0, 80)`과 같은 답(카메라 몸통·부채꼴·수직 고리, 기호 상자, 공간은 거짓) — `tests/backgroundMapPlanPreview.test.ts:384`의 `mainPlan`과 같은 점들로.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapPlanSelect.test.ts` → `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 3: 구현한다** (import: `./mapPlanEdit.ts`의 `MAP_EDIT_MARK`, `./mapPlanPreview.ts`의 `planNodeCovers`, `./mapSpatial.ts`의 `nodePlanOutline`·`projectCameraToPlan`, 타입은 `import type`)
  ```ts
  export type PlanRect = { left: number; top: number; right: number; bottom: number };
  /** The box between two plan points, whichever way it was dragged. */
  export function planRect(a: BackgroundPoint, b: BackgroundPoint): PlanRect;
  /** Whether the box touches a node. */
  export function planRectTouches(node: BackgroundNode, rect: PlanRect): boolean;
  /** Ids of the nodes a box touches, in map order. */
  export function planMarqueeIds(map: BackgroundMap, rect: PlanRect): string[];
  /** Whether a plan point lies on a camera or symbol as the main plan draws it (the editor's former onPlanMark). */
  export function planMarkCovers(node: BackgroundNode, point: BackgroundPoint): boolean;
  ```
  상자는 **닫힌** 상자다(가장자리에 걸친 것도 닿은 것). 변–상자는 선분을 상자로 잘라(Liang–Barsky) 남는 것이 있는지로 본다.
  - 공간(사각형·다각형): `nodePlanOutline(space)`의 닫힌 변 가운데 하나라도 상자와 만나면 참(**벽**). 안쪽에만 든 상자는 거짓.
  - 공간(타원): 상자의 네 꼭짓점을 `u = rotate(p − 가운데, −rotation)`, `q = (u.x / (width/2), u.y / (height/2))`로 옮긴다. `near` = 원점에서 그 네 점이 이루는 볼록 사각형(속 포함)까지의 거리(원점이 안이면 0), `far` = 네 점 가운데 원점에서 가장 먼 거리. **`near ≤ 1 && far ≥ 1`** 이면 참. 48각형 근사를 쓰지 않는다.
  - 기호: 자기 상자(가운데에서 `±width/2, ±height/2`를 `rotation`만큼 돌린 네 점)의 변이 상자와 만나거나, 상자의 한 꼭짓점이 그 사각형 안이면 참. 기울인(pitch·roll) 기호가 드리우는 윤곽은 세지 않는다.
  - 카메라: 카메라 점에서 상자까지의 거리(안이면 0)가 `MAP_EDIT_MARK.cameraBody`(12) 이하, 수직으로 보는 카메라는 `MAP_EDIT_MARK.cameraRing`(18). **부채꼴은 세지 않는다.**
  - 좌표가 유한하지 않은 노드·상자 → 거짓. 잠긴 노드도 잡힌다.
  - `planMarkCovers(node, point)` = `planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? MAP_EDIT_MARK.cameraRing : MAP_EDIT_MARK.cameraBody, MAP_EDIT_MARK.cameraFan)`.
- [ ] **Step 4:** `node --test tests/backgroundMapPlanSelect.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: 상자 판정(mapPlanSelect) — 공간은 벽이, 기호는 넓이가, 카메라는 몸통이 상자에 닿아야 잡힌다`(Q1의 답이 '넓이'였으면 머리말대로 고친 메시지)

**이 Task가 끝나면 편집기는:** Task 4와 같다.

### Task 8: 누름 판정 — `sameSpotAgain`·`resolvePlanPress` (`mapPlanSelect.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapPlanSelect.ts`
- Test: `tests/backgroundMapPlanSelect.test.ts`

**Read first:** 설계 6.1 전부(코드 블록 둘, `from`의 조건 셋, `again`의 조건 셋, 상황 표, 보기 모드 표, 편집 중 표 1~10, '결정과 근거'), 12.4의 `sameSpotAgain`·`resolvePlanPress`.

- [ ] **Step 1: 테스트를 쓴다(12.4)**
  - `sameSpotAgain` — 자리 기억 `{ mapId: 'm', hitId: 'I', pickedId: 'O' }`: (`'m'`, `'I'`, 선택 `[O]`) → 참 / 선택 `[I]` → 거짓 / 선택 `[O, c]` → 거짓 / 선택 없음 → 거짓 / 눌린 것 `'J'` → 거짓 / 눌린 것 `null` → 거짓 / 도면 `'n'` → 거짓 / 자리 기억 `null` → 거짓 / `pickedId`가 `null`인 기억은 어떤 선택에도 거짓.
  - `resolvePlanPress` — 노드: 방 `I`(안쪽), 방 `O`(바깥), 의자 `c`, 잠긴 방 `L`, 같은 자리의 카메라 `camA`·`camB`. `I` 위의 더미는 `[I, O]`. 따로 적지 않으면 `again`은 거짓. `step`마다 `spaces`를 함께 본다(눌린 것이 방이면 `true`, 카메라·기호면 `false`).
    - 보기 모드: 빈 곳 → `pan`·`select null` / `I`(선택 없음) → `pan`·`select I`·`targetId I` / `I`(선택 `[I]`, `again` 참) → `step { ids: [I, O], from: I, spaces: true }`·`targetId I` / `I`(선택 `[O]`, `again` 참) → `step … from: O`·`targetId O` / Shift를 줘도 같은 결과 / 어느 줄에도 `selectAtPress`가 없다.
    - **보기 모드·처음 누름**(`again` 거짓): `I`(선택 `[I]`) → `select I`·`targetId I`(넘기지 않는다) / **`I`(선택 `[O]`) → `select I`·`targetId I`**.
    - 보기 모드·여러 개 선택: 선택 `[I, c]`에서 `c` → `pan`·`select c`(`step`이 아니다). `again`을 참으로 줘도 같다.
    - 편집 1~3: Shift+빈 곳 → `marquee`·`none`·`logged` 거짓 / Shift+`c` → `toggle c`·`logged` 거짓 / 빈 곳 → `marquee`·`select null`·`logged` 참.
    - **Shift는 다른 줄보다 먼저다**: 선택 `[I, c]`에서 Shift+`c` → `marquee`·`toggle c`·`groupIds` `null`·`nodeId` `null` / 선택 `[O]`에서 Shift+`I`(더미 `[I, O]`, `again` 참이어도) → `toggle I`(`step`이 아니다).
    - 편집 4·5: 선택 `[I, c]`에서 `c` → `move`·`nodeId c`·`groupIds`가 받은 `selection.ids`와 `===`·`click select c`·`selectAtPress` 없음 / 선택 `[I, L]`에서 `L` → `marquee`·`select L`.
    - 편집 6(`again` 참): 선택 `[O]`에서 `I` 위(더미 `[I, O]`) → `move`·`nodeId O`·`step from O`·`selectAtPress` 없음.
    - **편집·처음 누름**(`again` 거짓): 선택 `[O]`에서 `I` 위 → **9번**: `move`·`nodeId I`·`selectAtPress I`·`click none`·`targetId I` / 네 겹(더미 `[closet, room, floor, site]`)에서 선택 `[floor]`, `closet` 위 → 9번(`selectAtPress closet`). 같은 것에 `again` 참 → 6번(`nodeId floor`·`step from floor`).
    - 편집 7(`again` 참): `O`가 잠김, 선택 `[O]`, `I` 위 → `move`·`nodeId I`·`selectAtPress I`·`step from O`·`targetId I`. `again` 거짓이면 9번(`click none`).
    - 편집 8(`again` 참): `O`와 `I` 모두 잠김 → `marquee`·`step from O`. `again` 거짓이면 10번(`select I`).
    - 편집 9·10: 선택 없음, `I` → `move`·`selectAtPress I`·`none` / `L`(더미 `[L]`) → `marquee`·`select L`·`selectAtPress` 없음.
    - **카메라·기호의 더미는 `again`을 보지 않는다**: 선택 `[camB]`, `camA` 위(더미 `[camA, camB]`), `again` 거짓 → 6번(`nodeId camB`·`step { ids: [camA, camB], from: camB, spaces: false }`). 보기 모드에서도 `step from camB`·`spaces: false`.
    - 여러 개 선택 중에는 `from`을 보지 않는다: 선택 `[O, c]`에서 `I` 위(`again` 참) → 9번(`selectAtPress I`) / 선택이 하나이고 더미에 없으면: 선택 `[c]`, `I` 위(`again` 참) → 9번 / 더미가 하나뿐이면: 선택 `[I]`, 더미 `[I]`(`again` 참) → 9번(`click none`).
- [ ] **Step 2: 실패를 확인한다** — 파일 전체가 `does not provide an export named 'resolvePlanPress'`(또는 `'sameSpotAgain'`)로 실패.
- [ ] **Step 3: 구현한다** — 타입과 시그니처는 설계 6.1의 코드 블록 둘을 주석까지 그대로 옮긴다(`MapSelection`은 `import type { MapSelection } from './mapDocument.ts'`). 아래는 그 블록에서 주석을 빼고 줄만 줄인 것이다 — 필드 이름과 타입은 같다:
  ```ts
  export type PlanPressClick = { kind: 'none' } | { kind: 'select'; id: string | null } | { kind: 'toggle'; id: string }
    | { kind: 'step'; ids: readonly string[]; from: string; spaces: boolean };
  export type PlanPressPlan = { drag: 'pan' | 'marquee' | 'move'; nodeId: string | null; groupIds: readonly string[] | null;
    selectAtPress?: string; click: PlanPressClick; targetId: string | null; logged: boolean };
  export function resolvePlanPress(input: { canEdit: boolean; shift: boolean; hit: BackgroundNode | null; pile: readonly string[];
    selection: MapSelection; again: boolean; node(id: string): BackgroundNode | undefined }): PlanPressPlan;
  export type PlanSpot = { mapId: string; hitId: string; pickedId: string | null };
  export function sameSpotAgain(spot: PlanSpot | null, mapId: string, hitId: string | null, selection: MapSelection): boolean;
  ```
  - `sameSpotAgain` = `spot`과 `hitId`가 있고, `spot.mapId === mapId`, `spot.hitId === hitId`, `selection.ids.length === 1`, `selection.primaryId === spot.pickedId`.
  - `from` = 아래가 **모두** 참일 때의 대표, 아니면 없음: ① `selection.ids.length === 1` ② 그 대표가 `pile`에 들어 있고 `pile.length > 1` ③ `hit`이 **공간이면 `again`이 참**(카메라·기호면 이 조건은 보지 않는다).
  - 보기 모드(`canEdit` 거짓, Shift는 보지 않는다): 빈 곳 → `pan`·`select null`·`targetId null` / 노드·`from` 있음 → `pan`·`step`·`targetId from` / 그 밖의 노드 → `pan`·`select hit.id`·`targetId hit.id`.
  - 편집 중(위에서부터 먼저 맞는 줄): 1 Shift·빈 곳 → `marquee`·`none`·`targetId null`·`logged` 거짓 / 2 Shift·노드 → `marquee`·`toggle hit.id`·`null`·거짓 / 3 빈 곳 → `marquee`·`select null`·`null` / 4 여러 개 선택 중이고 누른 것이 그 안에 있으며 잠기지 않음 → `move`·`nodeId = hit.id`·`groupIds = selection.ids`·`select hit.id`·`targetId hit.id` / 5 〃 잠김 → `marquee`·`select hit.id`·`hit.id` / 6 `from` 있음·그 노드가 잠기지 않음 → `move`·`nodeId = from`·`step`·`targetId from` / 7 `from` 있음·그 노드가 잠김·누른 것은 잠기지 않음 → `move`·`nodeId = hit.id`·`selectAtPress = hit.id`·`step`(여전히 `from`에서)·**`targetId hit.id`** / 8 `from` 있음·둘 다 잠김 → `marquee`·`step`·`targetId from` / 9 그 밖·누른 것이 잠기지 않음 → `move`·`nodeId = hit.id`·`selectAtPress = hit.id`·`none`·`hit.id` / 10 그 밖·잠김 → `marquee`·`select hit.id`·`hit.id`. 적지 않은 칸은 `nodeId: null`, `groupIds: null`, `logged: true`.
  - `step`은 늘 `{ kind: 'step', ids: pile, from, spaces: hit.type === 'space' }`.
- [ ] **Step 4:** `node --test tests/backgroundMapPlanSelect.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: '선택' 도구의 누름 판정(resolvePlanPress)과 같은 자리를 다시 눌렀는가(sameSpotAgain)`

**이 Task가 끝나면 편집기는:** Task 4와 같다.

---

## Chunk 4: 편집기의 포인터 흐름 (F5·F6)

### Task 9: 포인터 흐름 — 누름 판정 배선, 상자, 묶음 이동, Shift, 넘기기와 더블클릭

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` (`MapMarquee`), `src/features/backgrounds/backgrounds-map.css` (`.bmap-marquee`), `tests/backgroundMapEditorWiring.test.ts` (앵커 5·6, `handler` 표)

**Read first:** 설계 9절 전부(9.1~9.4의 코드 블록과 불릿), 5.2, 5.4, 5.5, 6.1의 표 둘, 6.2('상태'·'좌표'·'끄는 동안'·'뗄 때'·'취소'), 6.3의 끝 문단, 6.6의 Esc 우선순위와 코드 블록의 Escape 분기, 7.2 전부(코드 블록과 표), 10.1의 `MapMarquee`, 10.2의 `.bmap-marquee` 행, 12.8의 앵커 5·6·25·26·27·30·33 · 편집기 :36-48, :84-97, :206-211, :279-285, :534-537, :576-707, :719-724, :767, :841-888 · 앵커 테스트 :48-66, :99-124.

- [ ] **Step 1: 앵커 5·6과 `handler` 표를 새 내용으로 고친다(12.8)** — `handler`: `pointerUp`의 끝 표지를 `'function doubleClickIntent('`로, `doubleClickIntent: () => piece(editor, 'function doubleClickIntent(', 'function canvasDoubleClick(')`와 `openSpace: () => piece(editor, 'function openSpace(', 'function beginRename(')`를 더한다.
  - **앵커 5**: SVG `onClick` 조각에 순서대로 `const cycle = pendingCycle.current; pendingCycle.current = null;` → `if (!cycle || (event.detail >= 2 && (cycle.spaces || doubleClickIntent(pointFrom(event))))) return;` → `const next = cycle.ids[(cycle.ids.indexOf(cycle.from) + 1) % cycle.ids.length];` → `select(next, cycle.mapId);`. 그 `if` 줄은 편집기에 정확히 한 번. `pointerUp`에 `pendingCycle.current = { ids: click.ids, from: click.from, mapId: session.mapId, spaces: click.spaces };`가 있고, `pointerUp` 안의 `\bselect\(`가 **정확히 둘**이며 그 둘이 `select(session.node.id, session.mapId)`와 `select(click.id, session.mapId)`, `click.ids[`와 `indexOf(click.from`은 없다. 끌기가 끝난 뒤의 줄 `if (!session.groupIds && session.node) select(session.node.id, session.mapId);`. (지금의 "한 번" 검사와 `session.stack` 표지 검사는 지운다.)
  - **앵커 6**: `onDoubleClick=`은 편집기·조각 파일을 통틀어 한 번. `canvasDoubleClick`이 `doubleClickIntent(`를 부르고 `openSpace(intent.node.id, tool !== 'hand')`를 갖는다. `doubleClickIntent`가 `pressLog.current`를 읽고 `first.hitId !== last.hitId`, `doubleClickNodeId(first.targetId, node.id, pile)`, `for (const item of target === node ? [node] : [target, node])`, `planDoubleClickAction(item,`을 순서대로 갖는다. 편집기 전체에서 `doubleClickIntent(` **호출**이 정확히 둘(정의 줄 `function doubleClickIntent(`은 세지 않는다). `openSpace`에 `if (pick && id !== singleId) select(id);`가 `navigate(`보다 앞. `pointerDown`의 누름 기록 줄 `pressLog.current = press ? [pressLog.current[1], press] : NO_PRESSES;`.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapEditorWiring.test.ts` → `handler.pointerUp()`을 쓰는 앵커(5·15·17·19)와 6이 `marker not found … function doubleClickIntent(`로 실패, 나머지는 통과.
- [ ] **Step 3: import·타입·상수** — `./mapPlanSelect`에서 `planMarkCovers, planMarqueeIds, planRect, resolvePlanPress, sameSpotAgain`과 타입 `PlanPressClick, PlanRect, PlanSpot`, `./mapPlanPreview`에서 `planPileAt`, `./mapPlanEdit`에서 `planDoubleClickAction`, 조각에서 `MapMarquee`. `onPlanMark`(:84-85)를 **지우고** 쓰지 않게 된 `planNodeCovers`·`planStackUnder` import를 뺀다. `PointerSession`(9.1): `mode`가 `'pan' | 'marquee' | 'move' | 'resize' | 'rotate' | 'draw' | 'vertex'`(**`'click'`이 사라지고 `'marquee'`가 생긴다**), `stack` 필드를 없애고 `groupIds: readonly string[] | null`·`click: PlanPressClick`·`spotId: string | null`을 더한다(주석은 9.1 그대로). `const NO_CLICK: PlanPressClick = { kind: 'none' };`.
- [ ] **Step 4: 상태와 ref** — `const [marquee, setMarquee] = useState<PlanRect | null>(null);` · `const [panning, setPanning] = useState(false);`(`className`에 붙이는 것은 Task 10) · `const spaceHeld = useRef(false);`(이 Task에서는 늘 `false`다. 켜는 것은 Task 10) · `const lastSpot = useRef<PlanSpot | null>(null);`(주석은 7.2 그대로) · `pendingCycle`의 타입을 `{ ids: readonly string[]; from: string; mapId: string; spaces: boolean } | null`로 · `select` 옆에 `function liveSelection(mapId: string, map: BackgroundMap): MapSelection { return mapSelection(map, mapViewport(doc.getState(), mapId).selectedIds); }`.
- [ ] **Step 5: `planGestureOf`(:91-97)** — 제외 목록의 `'click'`을 `'marquee'`로 바꾸고, 그 줄 앞에 `if (mode === 'move' && node && session.groupIds) return { mode: 'move-group', nodeId: node.id, ids: session.groupIds };`. 주석의 "`pan` and `click`"도 고친다.
- [ ] **Step 6: `pointerDown`** — 맨 앞부터 `const live = …`(:576-593)까지는 **그대로** 둔다(가드 두 줄과 그 앵커 16). `let target = …, stack …` 줄(:594)을 `const hit = node && (live.nodes.find(item => item.id === node.id) ?? node);`로 바꾸고, 그 아래 `doc.beginGesture` 줄까지(:595-622)를 **설계 9.1의 코드 블록으로 글자 그대로** 바꾼다(설계는 범위를 ':594-626'으로 적었지만 그 블록은 `beginGesture` 줄에서 끝난다). 그 뒤의 :623-628(`const vertex`, 점 손잡이의 `setActiveVertex`, 세션 기록, `altDrag`, 포인터 캡처)은 **그대로 두되** 세션 기록에서 `stack`을 빼고 `groupIds`·`click`·`spotId`를 싣는다. 지켜야 할 것: `const panning = event.button === 1 || tool === 'hand' || spaceHeld.current;` · `const spot = pressLog.current[1] ? lastSpot.current : null; lastSpot.current = null;`와 `const again = sameSpotAgain(spot, current.id, hit?.id ?? null, held);`가 누름 기록을 적는 줄보다 **앞** · `resolvePlanPress(`는 `panning || drawing || handle ? null :`로 시작하는 한 곳 · 다각형·기호의 이른 반환 둘은 `if (!panning && canEdit && !handle && tool ===`으로 시작(다각형 블록의 안쪽 줄은 지금 그대로 — 앵커 14·19·20) · 모드를 정하는 묶음은 `if (!panning) {` 안 · `if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;` · 세션 기록은 한 문장이고 바로 뒤가 `if (event.altKey) altDrag.current = true;`(앵커 17)이며 `node: target`, `groupIds: plan?.groupIds ?? null`, `click: plan?.click ?? NO_CLICK`, `spotId: plan?.logged && hit ? hit.id : null`을 싣는다. `pointerDown` 안에 `view.selectedId`·`stack`·`if (mode === 'click'`을 남기지 않는다.
- [ ] **Step 7: `pointerMove`** — 4px 문턱 줄까지 그대로. 그 아래를 9.2의 블록으로: `const first = !session.moved;` → `session.moved = true;` → `pan`이면 `if (first) setPanning(true);` 뒤 `updateView(…)` → `if (session.mode === 'marquee') { setMarquee(planRect(session.start, point)); return; }` → `if (!canEdit || !session.node) return;` → 이하 그대로.
- [ ] **Step 8: `pointerUp`** — 세션 확인부터 `lastDrag` 갱신까지 그대로 두고 `setPanning(false)`를 더한 뒤, 그 아래를 9.3의 블록으로 글자 그대로 바꾼다: 상자 분기(`setMarquee(null)`, 움직였고 취소가 아니고 `canEdit`이면 살아 있는 초안에서 `doc.selectMany(session.mapId, planMarqueeIds(live, planRect(session.start, point)))` — `doc.finishGesture(`는 이 분기에 없다) → `else if (session.mode !== 'pan')`의 제스처 분기(끝난 뒤의 선택은 `if (!session.groupIds && session.node) select(session.node.id, session.mapId);`, 그리기 뒤의 도구·이름 칸과 끼워 넣은 점 블록은 그대로) → 움직이지 않은 누름의 `click` 실행(`select`·`toggle`·`step`) → 자리 기억(`if (!cancel && session.spotId !== null && !(session.moved && session.mode !== 'move')) {`). **지금의 `if (session.mode === 'pan') return;`은 없앤다.** `toggle`은 `liveSelection(session.mapId, liveMap).ids`에서 새 목록을 만들어 `doc.selectMany`로 보낸다. 넘기기는 `pendingCycle`에 적어 두기만 한다.
- [ ] **Step 9: `abortGesture`와 Esc** — `abortGesture`에 `setMarquee(null); setPanning(false);`. `keyboard()`의 Escape 분기 한 줄을 `if (pointerRef.current?.mode === 'marquee' || doc.isGestureActive()) { abortGesture(); return; }`로(6.6 — 관문 A의 E4가 본다). Escape 분기에 `select(`·`selectMany(`를 넣지 않는다.
- [ ] **Step 10: 넘기기·더블클릭·들어가기(7.2의 코드 블록 그대로)** — `function doubleClickIntent(point: BackgroundPoint | null)`를 `pointerUp`과 `canvasDoubleClick` 사이에 둔다(파일에서 `pointerUp → doubleClickIntent → canvasDoubleClick → zoomBy` 순서). `canvasDoubleClick`과 `openSpace(id: string, pick = false)`의 본문, SVG `onClick`의 다섯 줄(끝이 `if (lastSpot.current?.mapId === cycle.mapId) lastSpot.current = { ...lastSpot.current, pickedId: next };`)을 그대로 옮긴다. **`openSpace`는 지금 자리(`beginRename` 바로 앞, :534)에 두고 본문만 바꾼다** — 설계의 코드 블록은 `canvasDoubleClick` 뒤에 적었지만 자리는 옮기지 않는다(설계 7.2 끝의 불릿. Step 1의 `handler.openSpace` 표지 `'function openSpace('` ~ `'function beginRename('`가 그 자리를 읽는다). `openSpaceFrom3D`는 `if (tool !== 'symbol') openSpace(id, tool !== 'hand');`. SVG 여는 태그 안에는 `}>`를, `onClick` 본문 안에는 `}}`를 만드는 표현을 쓰지 않는다(앵커의 `canvasTag()`·`piece(…, '}}')`가 거기서 끊는다).
- [ ] **Step 11: 렌더(9.4)** — `marqueeIds`·`shownIds` 메모 둘을 글자 그대로 두고, 공간·기호·기호의 드리운 윤곽·카메라의 `is-selected`와 기호 이름을 보이는 조건(:864)을 `shownIds.has(node.id)`로. `<MapSnapGuides … />` 다음, 손잡이 앞에 `{marquee && <MapMarquee rect={marquee} />}`.
- [ ] **Step 12: 조각과 CSS** — `BackgroundMapPlanOverlays.tsx`에 `import type { PlanRect } from './mapPlanSelect';`(그 파일의 다른 타입 import처럼 확장자 없이)와 `export function MapMarquee({ rect }: { rect: PlanRect }): JSX.Element` — `<rect className="bmap-marquee" x={rect.left} y={rect.top} width={rect.right - rect.left} height={rect.bottom - rect.top} pointerEvents="none" aria-hidden="true" />`. CSS: `.bmap-marquee { fill:rgb(var(--color-accent) / .08); stroke:rgb(var(--color-accent-sub)); stroke-width:1; stroke-dasharray:4 3; vector-effect:non-scaling-stroke; pointer-events:none; }`(전환·애니메이션 없음).
- [ ] **Step 13: 자가 점검** — 편집기에 `resolvePlanPress(` 1곳 · `onPlanMark` 0곳 · `session.stack` 0곳 · `mode === 'click'` 0곳 · `lastSpot.current =`(대입) 정확히 3곳 · `function pointerUp`부터 `function doubleClickIntent` 앞까지 `select(` 2곳 · `doubleClickIntent(` 3곳(정의 1 + 호출 2) · `onDoubleClick=` 1곳 · `setMarquee(null)` 2곳(`abortGesture`, `pointerUp`).
- [ ] **Step 14:** `node --test tests/backgroundMapEditorWiring.test.ts` → 20개 통과. 실패하면 **소스를 고친다**(앵커를 느슨하게 하지 않는다).
- [ ] **Step 15:** `npm run typecheck` → 오류 없음.
- [ ] **Step 16:** `npm run test:background` → Task 8과 같은 수, fail 0, skipped 3.
- [ ] **Step 17: 커밋** — 네 파일 / `배경 도면: '선택' 도구의 포인터 흐름 — 빈 곳 끌기는 상자, 묶음 이동, Shift+클릭, 보기 모드는 끌면 화면 이동, 겹친 공간은 같은 자리를 천천히 다시 눌러 아래로`

**v1.131.0과 달라지는 것(되살리지 말 것):**
- 보기 모드: 노드 위에서 끌어도 화면이 움직인다(`click` 모드가 없다). **선택은 움직이지 않고 뗄 때** 바뀐다 — 빈 곳을 끌기만 해서는 선택이 풀리지 않는다.
- 편집 중 '선택' 도구: 빈 곳을 끌면 화면 이동이 아니라 **상자**다. 잠긴 것 위의 끌기도 상자이고, 잠긴 것은 뗄 때 선택된다.
- 묶음에 든 것을 누르면 누를 때 접지 않고(끌면 함께 간다) 움직이지 않고 뗄 때 접는다. 묶음 이동 뒤에는 끈 것을 다시 선택하지 않는다.
- 겹친 **공간**이 더미를 이룬다. 처음 누르면 늘 맨 위(가장 작은) 것, 같은 자리를 천천히 다시 누를 때만 아래로. 연속 클릭은 공간을 넘기지 않는다. 카메라·기호 더미의 넘기기 조건은 `canEdit`이 아니라 `doubleClickIntent`다.
- 더블클릭으로 들어간 공간은 선택된 채 남는다. 골라 둔 더미의 것이 잠겨 있으면 그 자리의 끌기는 맨 위 것을 옮기거나(7번) 상자를 그린다(8번).
- Esc는 상자를 그리는 중이면 상자만 취소한다. 선택은 풀지 않는다.

**이 Task가 끝나면 편집기는:** 설계 6.1·6.2·7.2의 평면 동작이 모두 된다(상자·Shift·묶음 이동·겹친 공간 넘기기·더블클릭). 아직 없는 것: 스페이스 화면 이동과 손 모양 커서, 도구 이름 '화면 이동'과 새 힌트(Task 10), 여러 개 선택의 속성 칸 요약·함께 지우기·잠그기(Task 11 — 그때까지 속성 칸은 '도면 구성'을 보인다), 3D·보조 평면도의 넘기기(Task 12~14).

### Task 10: 화면 이동의 세 길 — 스페이스, 커서, '화면 이동' 도구 이름, 아래 줄 힌트

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/backgrounds-map.css`

**Read first:** 설계 5.1, 5.2, 5.3 전부(코드 블록과 불릿 — 추적과 삼키기는 따로다), 5.6, 9.4의 `className` 줄, 10.2(커서 규칙 셋과 '자리' 문단), 10.3, 12.8의 앵커 28·13 · 편집기 :68-72, :296-311(끌기에 쓴 Alt — 같은 꼴의 창 캡처 효과), :787-800, :802, :841 · CSS :44-47, :69, :177, :188.

- [ ] **Step 1: 상수** — `textFields`·`interactive`·`textEntry`(:69-72)는 **글자 그대로 둔다**(앵커 13). `textFields` 위 주석의 "Both selectors below"만 "The selectors below"로. 그 아래에 주석과 함께: `const tickInputs = 'input:is([type="checkbox"], [type="radio"])';` · ``const spaceEntry = `:is(${textEntry}):not(${tickInputs})`;``
- [ ] **Step 2: 스페이스 추적(5.3의 코드 블록 그대로)** — `const [spacePan, setSpacePan] = useState(false);` · `const rootRef = useRef<HTMLDivElement>(null);`(편집기 루트 `<div className="bmap-layout" …>`에 `ref={rootRef}`) · `const onSpaceKey = useEvent((event: KeyboardEvent) => { … })`와 창 캡처 `keydown`·`keyup` + `blur` 효과. `spaceHeld`는 Task 9의 ref를 쓴다(5.3의 주석을 붙인다). `onSpaceKey` 안의 순서를 지킨다: `if (event.code !== 'Space') return;` → `keyup`이면 `hold(false)` → 추적 조건 `if (mode !== 'plan' || !root || root.offsetParent === null || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;` → `if (element?.closest(spaceEntry)) return;` → `hold(true);` → 삼키는 줄 ``if (element === document.body || (element && root.contains(element) && !element.closest(`${interactive}, summary`))) event.preventDefault();``. **`hold(true)`보다 앞에 `root.contains(`·`document.body`를 두지 않는다**(추적은 포커스의 자리를 보지 않는다). `event.preventDefault()`는 `onSpaceKey` 안에 그 한 줄뿐이고, `keyboard()`에는 스페이스 분기를 두지 않는다.
- [ ] **Step 3: SVG의 `className`** — `` className={`bmap-canvas tool-${tool}${spacePan && !gestureActive && !marquee ? ' is-space-pan' : ''}${panning ? ' is-panning' : ''}`} ``.
- [ ] **Step 4: CSS 커서 규칙 셋(10.2)** — `.bmap-symbol { … cursor:pointer; }`(:188) **뒤에 이 순서로** 둔다(앞에 두면 기호 도구의 십자 커서에 진다): `.bmap-canvas.is-space-pan { cursor:grab; }` · `.bmap-canvas:is(.tool-hand,.is-space-pan) * { cursor:grab; }` · `.bmap-canvas.is-panning, .bmap-canvas.is-panning * { cursor:grabbing; }`. 전환·애니메이션·`backdrop-filter` 없음.
- [ ] **Step 5: 도구줄(5.1)** — 평면의 두 항목만: `select`는 라벨 `선택`, `title`이 편집 중 `선택: 눌러 고르고 끌어 옮기기 · 빈 곳을 끌어 여러 개 고르기` / 보기 모드 `선택: 눌러 고르기 · 끌면 화면이 움직여요`. `hand`는 라벨 **`화면 이동`**, `title` `화면 이동: 끌어서 화면만 옮기기 · 스페이스를 누른 채 끌거나 휠 버튼으로 끌어도 돼요`. 아이콘(`↖`·`✥`)과 그리기 도구, 3D 도구줄(선택·둘러보기)과 기즈모의 '이동'은 그대로.
- [ ] **Step 6: 아래 줄 힌트(10.3)** — 평면의 사슬 순서: 기호 놓기 → 다각형 도구 → **'화면 이동' 도구** → 점 손잡이가 보임 → 점 손잡이가 숨겨진 다각형 → **편집 중·여러 개 선택**(`editing && multiple`) → 편집 중 → 보기. 문구: 화면 이동 `끌어서 화면 이동 · 휠로 확대 · 배치는 움직이지 않아요` / 여러 개 `끌어 함께 옮기기 · Shift+클릭으로 더하고 빼기 · Delete 삭제 · 빈 곳 클릭으로 풀기` / 편집 중 `끌어 옮기기 · 빈 곳 끌어 여러 개 선택 · Shift+클릭 추가 · 더블클릭 이름` / 보기 `클릭해 선택 · 끌어 화면 이동 · 공간 더블클릭으로 상세 도면 · 휠 확대`. 기호·다각형·점 손잡이의 문구와 3D의 문구는 지금 그대로.
- [ ] **Step 7: 자가 점검** — 편집기에 `tickInputs`·`spaceEntry` 상수 두 줄이 글자 그대로 · `function keyboard`부터 `const selectNode` 앞까지 `'Space'` 0곳 · `closest(textEntry)`는 `keyboard()`의 한 곳뿐(`onSpaceKey`에는 없다) · `ref={rootRef}` 1곳 · 평면 도구줄의 옛 라벨 `{ id: 'hand', label: '이동'` 0곳(기즈모의 `label: '이동'`은 남는다) · 옛 힌트 `끌어 옮기기 · 모서리로 크기 · 원으로 회전 · 더블클릭 이름 · 휠 확대`·`클릭해서 선택 · 공간 더블클릭으로 상세 도면 열기 · 휠로 확대` 0곳.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → Task 9와 같은 수, fail 0, skipped 3.
- [ ] **Step 10: 커밋** — 두 파일 / `배경 도면: '이동' 도구를 '화면 이동'으로 — 스페이스를 누른 채 끌어도 화면 이동, 손 모양 커서, 선택 도구 안내 문구`

**v1.131.0과 달라지는 것(되살리지 말 것):** 평면 도구줄의 '이동'은 **'화면 이동'** 이다(3D 기즈모의 '이동'은 그대로). 스페이스를 누르고 있으면 어느 도구에서든 그 누름은 화면 이동이다 — 그리지 않고, 점을 찍지 않고, 기호를 놓지 않고, 손잡이를 잡지 않고, 선택도 바꾸지 않는다. 스페이스를 누른 채의 누름은 누름 기록에 적지 않는다(스페이스 + 더블클릭은 아무 일도 하지 않는다).
**이 Task가 끝나면 편집기는:** 화면을 옮기는 길이 셋이다(휠 버튼·'화면 이동' 도구·스페이스). 스페이스는 평면 모드이고 편집기가 보이면 포커스가 어디에 있든 듣고, 글자 칸·`select`·열린 창에서는 글자다.

### 관문 A — 엔진 확인 E1~E5·E7~E10과 E6·E11의 원시 이벤트 (Task 10 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

방법: 설계 13절 머리말(`npm run dev:renderer` + `npm run preview:electron`, Electron 33, 미리보기 시험 계정, **실제 입력**). 콘솔 기록이 필요하면 개발자 도구에서 리스너를 붙여 보고, 임시 로그를 커밋하지 않는다. 할 일과 봐야 할 것은 설계 13절의 해당 줄 그대로다. 다르면 아래 대체안(설계 16.2)으로 바꾼다. 대체안이 **이미 있는 앵커**가 읽는 줄을 바꾸면 — E5의 대체안 둘은 Task 9에서 고친 앵커 5·6의 줄(SVG `onClick`, `pointerUp`의 `select(` 둘, `onDoubleClick=` 한 번)을 바꾼다 — 그 앵커는 그 자리에서 함께 고치고 `npm run test:background`를 다시 돌려 fail 0을 본 뒤 커밋한다. 나머지는 Task 15의 해당 앵커를 그 구현에 맞춘다. E8의 뒤 두 경우(묶음 삭제 확인 창, 요약의 '모두 잠그기')는 Task 11 뒤에야 볼 수 있으므로 관문 B에서 본다.

| 확인 | 봐야 할 것 | 다르면 (설계 16.2) |
|---|---|---|
| E1 (740) 스페이스를 2초 누름 / 누른 채 끌기 / 끄는 도중 뗌 · E2 버튼·글자 칸·접기 줄·`select`·이름 칸에서의 스페이스 · E9 다른 탭과 편집기 밖 버튼의 스페이스 | 페이지가 내려가지 않고 커서가 손 모양, 화면이 움직이고 선택은 그대로 / 버튼·체크 칸·접기 줄·편집기 밖 요소의 스페이스는 지금처럼 듣는다 / 글자 칸에서는 빈칸이 쳐지고, 글자 칸에 커서를 둔 채 누른 스페이스+끌기는 보통의 끌기다(방이 옮겨진다) | 스크롤이 남으면 삼키는 줄의 대상 판정(`element === document.body`·`root.contains(element)`와 `closest`)이 실제 포커스 대상과 맞는지부터 본다. 버튼·접기 줄이 눌리지 않게 되면 삼키는 조건을 "대상이 SVG이거나 그 안, 또는 `body`"로 좁힌다(추적 조건은 그대로) |
| E3 Shift+클릭 여러 번, Shift+끌기 | 화면 어디에도 글자 선택(파란 강조)이 생기지 않는다 | `.bmap-canvas-wrap`에 `user-select:none`을 더한다(CSS 한 줄). 그래도 남으면 그 요소에 `onSelectStart={event => event.preventDefault()}` |
| E4 상자를 속성 칸 위까지 끌고 뗌 / 끄는 중 Esc / 끄는 중 Alt+Tab | 상자가 따라가고 뗀 순간 적용 / 상자가 사라지고 선택 그대로 / 상자가 없고 다음 누름이 정상 | 대체안 없음 — 다른 끌기와 같은 캡처·`onLostPointerCapture`다. 실패하면 원인을 찾는다(@superpowers:systematic-debugging) |
| E5 보기 모드에서 방을 누름(SVG `click`의 `detail`·`target` 기록) → 연결된 방을 더블클릭 | `click`이 SVG에 `detail` 1, 2로 온다 → 그 도면으로 들어간다 | ① 설계 16절의 E1·E5 대체안: 넘기기를 `pointerUp`에 두고 시간·거리(500ms·5px)로 판정 / `dblclick`이 SVG에 오지 않으면 SVG의 `onClick`에서 `event.detail === 2`일 때 `canvasDoubleClick`을 부른다 |
| E7 보기 모드와 편집 중에 방 위에서 휠 버튼으로 끈다 | 화면이 움직인다. 자동 스크롤 표시가 뜨지 않는다 | 대체안 없음(누름의 `preventDefault`가 막는다. v1.131.0과 같은 줄) |
| E8 ★ '공간 편집' 직후·'도면 저장' 직후·확인 창('변경사항 버리기' 취소)을 닫은 직후, 캔버스를 누르지 않고 스페이스+끌기 | 화면이 움직이고 아무것도 옮겨지거나 선택되지 않는다(`document.activeElement`를 적는다) | 추적은 포커스의 자리를 보지 않으므로 화면 이동은 된다. 달라질 수 있는 것은 페이지 스크롤 막기뿐: 그 요소가 편집기 밖이고 스페이스가 페이지를 내리면, 삼키는 조건에 더하지 말고 `beginEditing`·`saveMap`·확인 창이 닫힌 뒤에 `focusCanvas()`를 부른다 |
| E10 ★ 편집 중, ① '도면 탐색' 탭 버튼 ② 새로고침 버튼 ③ 잠금 체크 칸 ④ 사이드바 접기 버튼을 누른 **바로 뒤에** 스페이스+끌기, 마우스를 뗀 뒤 스페이스를 뗌(`keydown`·`keyup`의 `target`과 그 버튼의 `click` 기록) | 넷 다 화면이 움직이고 아무것도 고쳐지지 않으며, 스페이스를 뗄 때 그 버튼·체크 칸이 눌리지 않는다. `keyup`의 `target`은 SVG | 화면이 움직이지 않으면 `target`이 `spaceEntry`에 걸리는지 본다(걸리면 그 `type`을 `tickInputs`에 더한다). `keydown`이 아예 오지 않으면 "그 버튼을 누른 뒤 캔버스를 한 번 눌러야 한다"로 두고 완료 보고에 적는다(편집기 밖 요소를 고치지 않는다). 뗄 때 버튼이 눌리면: `spaceUsed` ref(`pointerDown`이 `spaceHeld.current`를 읽어 화면 이동을 시작할 때 켠다)를 두고 `onSpaceKey`의 `keyup` 가지가 그때만 `event.preventDefault()`한 뒤 끈다. 이때 앵커 28의 "`preventDefault`는 한 줄뿐"을 두 줄로 고친다 |
| E6·E11의 **원시 이벤트만 미리**(Task 12~14의 구현과 무관하다 — v1.131.0의 3D와 보조 평면도가 이미 내는 이벤트라 개발자 도구의 리스너로 찍는다): 3D에서 방을 더블클릭(캔버스 `mousedown`의 `detail`) / 3D 캔버스에서 오른쪽·휠 버튼을 누름(캔버스 `pointerdown`의 `button`) / 편집기 밖과 확인 창의 버튼을 누름(창 캡처 `pointerdown`의 `target`) / 보조 평면도에서 방을 더블클릭(그 노드 `click`의 `detail`) | `detail` 1, 2 / `button` 2·1 / 누름마다 오고 대상이 3D 캔버스가 아니다 / `detail` 1, 2 | 다르면 Task 13·14를 관문 B 표의 대체안으로 **시작한다**(Task 12의 계산은 그대로다): 오케스트레이터가 바뀌는 줄(Task 13 Step 3~6과 뷰포트 테스트의 클릭, Task 14 Step 1)을 정해 넘긴다 — 작업자가 스스로 정하지 않는다. 구현한 뒤에 알면 Task 13과 그 테스트를 다시 써야 한다 |

---

## Chunk 5: 묶음 동작

### Task 11: 묶음 요약, 함께 지우기·잠그기, Delete, 3D의 안내 한 줄

**Files:**
- Create: `src/features/backgrounds/BackgroundMapSelectionSummary.tsx`
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx`

**Read first:** 설계 6.4 전부, 6.5 전부, 6.6(Delete 줄과 코드 블록), 6.7의 하나 삭제 불릿, 10.1의 둘째 불릿, 12.8의 앵커 29·24·30 · 편집기 :202, :450-456, :748-750, :914-916, :970, :973, :1013 · `BackgroundUI.tsx:32-34`(확인 창이 닫힐 때 포커스를 돌려주는 곳).

- [ ] **Step 1: 요약 컴포넌트(6.5)** — 받은 값만 그린다.
  ```tsx
  export function BackgroundMapSelectionSummary({ nodes, canAct, disabled, onClear, onLock, onDelete }: {
    nodes: readonly BackgroundNode[];
    /** Editing on the plan: the group actions are offered. */
    canAct: boolean; disabled: boolean;
    onClear(): void; onLock(locked: boolean): void; onDelete(): void }): JSX.Element;
  ```
  머리: `여러 개 선택`(`.bmap-eyebrow`) + `×` 버튼(`className="bmap-icon-button"`, `aria-label="선택 해제"`) → `onClear` / 제목: `` `${nodes.length}개 선택` ``(`.bmap-selected-name`) / 구성: `공간 2 · 기호 3 · 카메라 1` 꼴(0인 종류는 뺀다), 잠긴 것이 있으면 뒤에 `` ` · 잠긴 것 ${m}` `` / 이하 `canAct`일 때만 — 안내 `고른 것 가운데 하나를 끌면 함께 옮겨져요. 잠긴 것은 제자리에 있어요.`, 버튼 줄(기존 `.bmap-symbol-actions` 그대로): `모두 잠그기`(잠기지 않은 것이 있을 때만 활성 → `onLock(true)`) · `잠금 풀기`(잠긴 것이 있을 때만 활성 → `onLock(false)`), 삭제 버튼 `` `선택한 ${n}개 삭제` ``(`className="bmap-text-button bmap-danger"`, n = 잠기지 않은 개수, 0이면 비활성 → `onDelete`), 안내 `크기와 회전은 하나만 골랐을 때 바꿀 수 있어요.` 새 CSS 클래스를 만들지 않는다. **`disabled`**(설계 6.5는 시그니처만 적었다): 묶음 버튼 셋(모두 잠그기·잠금 풀기·삭제)의 `disabled`에 `disabled ||`로 더한다. `×`에는 걸지 않는다(지금의 :916과 같다). 편집기가 넘기는 `canAct`(= `canEdit` = 편집 중이고 `disabled`가 아님)는 저장 중에 이미 거짓이라 보이는 동작은 달라지지 않는다.
- [ ] **Step 2: 속성 칸 분기(10.1)** — import에 요약 컴포넌트와 `lockMapNodes, removeMapNodes`(`./mapGeometry`)를 더한다. `selected ? <지금의 양식> : mode === 'plan' && multiple ? <BackgroundMapSelectionSummary nodes={groupNodes} canAct={canEdit} disabled={disabled} onClear={() => select(null)} onLock={locked => { updateMap(lockMapNodes(current, selection.ids, locked)); focusCanvas(); }} onDelete={() => { setError(''); setConfirmation('delete-group'); }} /> : <지금의 도면 구성>`. `<aside className="bmap-inspector" …>`의 **첫 줄**에 `{mode === '3d' && multiple && <p className="bmap-hint">…</p>}` — 문구 `` `평면에서 고른 ${n}개는 그대로 있어요. 3D에서는 하나씩만 다루고, 평면으로 돌아가면 ${n}개가 다시 선택돼 있어요.` ``(`n = selection.ids.length`). 양식의 `×`(:916)는 지금처럼 `select(null)`이다. 3D 모드에는 묶음을 푸는 버튼을 두지 않는다.
- [ ] **Step 3: 묶음 삭제(6.4)** — 확인 상태(:202)에 `'delete-group'`을 더한다. `confirmAction`에 분기: `confirmation === 'delete-group' && canEdit`이면 `settle()`로 정리한 도면에서 `const next = removeMapNodes(source, selection.ids); updateMap(next);` **한 번** → `doc.selectMany(current.id, selection.ids.filter(id => next.nodes.some(node => node.id === id)));` → `focusAfterConfirm.current = true; setConfirmation(null); return;`. 편집기는 묶음 **전체**를 넘긴다(잠긴 것을 남기는 것은 `removeMapNodes`의 일이다). 포커스 장치는 설계 그대로:
  ```ts
  /** Set by a group delete: once its confirmation is gone, the keyboard goes back to the canvas. */
  const focusAfterConfirm = useRef(false);
  useEffect(() => { if (!confirmation && focusAfterConfirm.current) { focusAfterConfirm.current = false; focusCanvas(); } }, [confirmation]);
  ```
  하나를 지우는 `'delete-node'` 분기(끝의 `select(null)` 포함)는 **코드 그대로** 둔다.
- [ ] **Step 4: 확인 창(:1013)** — `'delete-group'`의 제목 `` `선택한 ${n}개 삭제` ``(n = 지워질 개수 = `groupNodes` 가운데 잠기지 않은 것), 본문 `` `선택한 배치 ${n}개를 지웁니다. 공간을 지우면 함께 고르지 않은 카메라와 사물 기호는 도면에 남고 공간 연결만 해제됩니다. 원본 장소와 배경은 유지됩니다.` ``, 잠긴 것이 m개(> 0)면 뒤에 `` ` 잠긴 ${m}개는 지워지지 않습니다.` ``. 버튼은 지금과 같다(`돌아가기` / `삭제`).
- [ ] **Step 5: Delete 키(6.6의 코드 블록 그대로)** — 고른 점을 지우는 분기(:740-747)는 그대로. 그 아래의 노드 삭제 줄을:
  ```ts
  if (event.key === 'Delete' && !event.repeat && canEdit && !pointerRef.current && !doc.isGestureActive()) {
    if (selected && !selected.locked) { event.preventDefault(); setConfirmation('delete-node'); }
    else if (mode === 'plan' && multiple && groupNodes.some(node => !node.locked)) { event.preventDefault(); setConfirmation('delete-group'); }
  }
  ```
- [ ] **Step 6: 자가 점검** — 편집기에 `removeMapNodes(source, selection.ids)` 1곳 · `focusAfterConfirm.current = true` 1곳 · `if (!confirmation && focusAfterConfirm.current)` 1곳 · `lockMapNodes(current, selection.ids, locked)` 뒤에 `focusCanvas()` · `mode === '3d' && multiple` 1곳 · 묶음 Delete 줄이 `mode === 'plan' && multiple`을 조건으로 · `confirmAction`의 `'delete-node'` 분기가 여전히 `select(null)`로 끝난다.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** `npm run test:background` → Task 10과 같은 수, fail 0, skipped 3(앵커 12의 Delete 순서 통과).
- [ ] **Step 9: 커밋** — 두 파일 / `배경 도면: 여러 개 선택의 요약과 함께 지우기·잠그기 — 잠긴 것은 남고, 한 번에 지운 것은 되돌리기 한 번, 끝난 뒤 키보드는 캔버스로`

**v1.131.0과 달라지는 것(되살리지 말 것):** 평면에서 여러 개가 선택돼 있으면 속성 칸은 노드 양식이 아니라 요약 하나다. Delete는 고른 점 → 하나 → 묶음 순이고, 묶음 Delete는 평면에서만 듣는다(3D에서는 3D의 하나만). 보기 모드에 남은 여러 개 선택(저장 뒤)에는 버튼이 없다.
**이 Task가 끝나면 편집기는:** 설계 6절(F6)의 평면 동작이 모두 된다. 여러 개를 고른 채 3D로 가면 속성 칸 맨 위에 안내 한 줄이 보이고 묶음은 그대로다.

---

## Chunk 6: 3D와 보조 평면도의 넘기기

### Task 12: 넘기기 계산 — `mapFloorPile`·`mapClickAim`·`resolveMapClick(again, repeat)`, `nextPlanSelection`의 점·`again`·`repeat`

**Files:**
- Modify: `src/features/backgrounds/map3dScene.ts`, `src/features/backgrounds/mapPlanPreview.ts`
- Test: `tests/backgroundMap3dScene.test.ts`, `tests/backgroundMapPlanPreview.test.ts`

**Read first:** 설계 7.1, 7.3의 '넘기기'(코드 블록과 규칙 1~3, 그 아래 세 불릿), 7.4의 클릭 불릿, 12.5의 `nextPlanSelection` 묶음, 12.6의 규칙·`resolveMapClick`·`mapClickAim` 묶음 · `map3dScene.ts:586-647` · 3D 테스트 :300-370, :400-456(실제 광선을 쏘는 `cast`·`aim`·`viewerFor`) · `mapPlanPreview.ts:135-147`.

- [ ] **Step 1: 테스트를 쓴다**
  - `nextPlanSelection`(12.5 — Task 6의 겹친 도면 + 카메라 셋. 여덟 인자 `(map, hitId, selectedId, tolerance, covers, point, again, repeat)`, 따로 적지 않으면 `repeat` 거짓): `again` 참 — `(map, 'closet', 'closet', undefined, undefined, 점, true)` → `'room'`, 선택 `'room'` → `'floor'`, 선택 `'site'` → `'closet'`(돈다), 선택이 더미 밖 → `'closet'` / **`again` 거짓은 늘 맨 위 것**: 선택 `'closet'` → `'closet'`, `'room'` → `'closet'`, **`'floor'` → `'closet'`** / **연속 클릭은 공간을 넘기지 않는다**(`again` 참·`repeat` 참): 선택 `'closet'` → **`'closet'`**, `'room'` → **`'room'`**, `'site'` → `'site'`, 더미 밖 → `'closet'`. `again` 거짓·`repeat` 참 → 선택이 무엇이든 `'closet'` / 점 없이 부르면(`again`이 참이어도) `'closet'` / 카메라 더미는 `again`·`repeat`과 무관: 선택이 둘째 카메라면 `again` 거짓이어도, `repeat` 참이어도 셋째 카메라 / **이어서 누르기**(`turn`을 손으로 들고 간다 — `again` = "`turn`의 `hitId`가 눌린 것이고 `pickedId`가 지금 선택"): `'closet'` 자리를 천천히 세 번 → `'closet'`, `'room'`, `'floor'`. 이어서 빠르게 두 번(`repeat` 거짓, 참) → `'site'`, `'site'`. 천천히 한 번 눌러 `'closet'`을 고른 뒤 `turn`을 비우고 다시 누른다 → `'closet'` 그대로, 비우지 않으면 `'room'`. 키보드로 `'closet'`을 고른 뒤(`turn`은 적지 않고 비운다)의 첫 클릭 → `'closet'` 그대로.
  - 규칙(12.6, 손으로 만든 hit): `mapFloorPile` — 같은 높이 셋(작은 것부터), 높이가 다른 둘(가까운 것부터, 넓이와 무관), `mapFloorPile(hits, map)[0]`이 `pickMapFloor(hits, map)`의 공간.
  - `resolveMapClick` 실제 광선(안쪽 타원 방 + 바깥 방, 위에서 내려다봄. 넷째 `again`, 다섯째 `repeat`): `again` 참 — 선택 없음 → 안쪽, 안쪽 선택 → 바깥, 바깥 선택 → 안쪽(돈다) / **`again` 거짓**: 안쪽 선택 → 안쪽 그대로, **바깥 선택 → 안쪽**, 세 겹에서 가운데 선택 → **가장 작은 것**(`again` 참이면 큰 것) / **`again` 참·`repeat` 참**: 안쪽 선택 → **안쪽 그대로**, 바깥 선택 → **바깥 그대로**, 세 겹의 가운데 → **가운데 그대로**. `again` 거짓·`repeat` 참 → 처음 누름과 같다(바깥 선택 → 안쪽). 선택 없음·`repeat` 참 → 안쪽 / 카메라 셋이 같은 자리: 둘째 카메라 선택 → `again`·`repeat` 네 조합 모두 셋째 카메라 / 어느 쪽이든: 바깥만 있는 자리 → 바깥 그대로, 그 자리에 의자가 있으면 의자, 선택된 공간이 벽으로만 맞았으면 고른 것 그대로.
  - `mapClickAim`: 넘기는 클릭이면 선택돼 있던 것, 아니면 고른 것. `again` 거짓에서 바깥이 선택된 채 안쪽 자리 → 안쪽.
- [ ] **Step 2: 실패를 확인한다** — 3D 테스트는 `does not provide an export named 'mapClickAim'`(또는 `'mapFloorPile'`)로 파일 전체가 실패. 보조 평면도 테스트는 새 테스트만 단언 실패(여섯째 인자부터는 지금 무시된다).
- [ ] **Step 3: `map3dScene.ts`** (문서 주석은 설계 7.3 그대로)
  ```ts
  export function mapFloorPile(hits: readonly MapPickHit[], map: BackgroundMap): string[];
  export function resolveMapClick(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again?: boolean, repeat?: boolean): string | null;
  export function mapClickAim(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again?: boolean): string | null;
  ```
  - `mapFloorPile`: 바닥에 맞은 것(`pickPart === 'floor'`)을 거리 오름차순으로, 같은 높이(앞의 것에서 `1e-6 × max(1, 거리)` 안)끼리는 쌓임 번호가 큰 것(위)부터.
  - `resolveMapClick`(`again`·`repeat` 기본 `false`): ① `picked = pickMapNode(hits, map)`. 선택이 없거나, 고른 것이 없거나, 선택된 것이 광선에 맞지 않았으면 `picked` ② 선택된 것이 **공간**이면 — `again`이 아니면 `picked` / `again`이고 **`repeat`이면 `selectedId` 그대로** / `again`이고 `repeat`이 아니면 더미 = `mapFloorPile(hits, map)`. 카메라·기호면 지금의 더미(`stackedMapNodeIds(map, selectedId)` 가운데 광선에 맞은 것, `again`·`repeat`을 보지 않는다) ③ 더미가 둘 이상이고 선택된 것과 `picked`가 모두 그 안에 있으면 선택된 것의 **다음**, 아니면 `picked`. 인자 셋으로 부르면 v1.131.0과 같은 결과다(:449-453 불변). 주석 "A space is a pile of one, so it never steps."를 새 규칙으로 고친다.
  - `mapClickAim`: 같은 판정으로 "넘겼다면 선택돼 있던 것, 아니면 `picked`"(모듈 안의 함수 하나를 둘이 함께 쓴다).
- [ ] **Step 4: `mapPlanPreview.ts`** — `nextPlanSelection(map, hitId, selectedId, tolerance?, covers?, point?: BackgroundPoint, again = false, repeat = false)`: 눌린 것이 카메라·기호면 지금과 같다(`point`·`again`·`repeat`을 보지 않는다). 눌린 것이 **공간**이면 `point`가 있고 `again`일 때 더미 = `planPileAt(map, hitId, point, tolerance, covers)`이고, 선택된 것이 그 안에 있으면 **`repeat`이면 선택된 것 그대로**, 아니면 그 다음 것. 그 밖에는 `hitId`. 인자 다섯 이하의 결과는 그대로다(:357-429 불변).
- [ ] **Step 5:** 두 테스트 파일 → 통과.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음.
- [ ] **Step 7:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 8: 커밋** — 네 파일 / `배경 도면: 3D와 보조 평면도의 넘기기 계산 — 같은 자리를 다시 누를 때만 아래 공간으로, 연속 클릭은 그대로`

**이 Task가 끝나면 편집기는:** Task 11과 같다(뷰포트와 보조 평면도가 아직 옛 인자로 부른다).

### Task 13: 3D 뷰포트 — 연속 클릭, 같은 자리의 기억(`turn`), 첫 클릭이 겨눈 것(`aimed`), `pick` 하나

**Files:**
- Modify: `src/features/backgrounds/BackgroundMap3D.tsx`
- Test: `tests/backgroundMap3dScene.test.ts`

**Read first:** 설계 7.3의 '뷰포트의 기억 둘'부터 끝까지(표, 코드 블록 둘, 불릿, '기억이 끝나는 때' 표), 12.6의 뷰포트·통합 묶음, 12.8의 앵커 31·35, 16.2의 E6·E11 줄 · `BackgroundMap3D.tsx` :19-23, :139-198, :212-254, :278-298, :523-586 · 테스트 :1168-1262(`mountViewport` — `press(at, extra)`가 `pointerdown`과 `mousedown`에 같은 `extra`를 싣는다), :1294-1306(오른쪽·휠 버튼), :1612-1634, :1732-1758(손잡이를 누르는 방식, 창에 `keydown`), :1938-1960(통합), :2085.

- [ ] **Step 1: 뷰포트 테스트를 쓴다(12.6)** — 연결된 안쪽 방 `nook`과 바깥 방 `classroom`이 겹친 자리. 클릭은 `editor.press(at, { detail: N }); editor.release(at)`. 따로 적지 않으면 `canEdit: false`. **손잡이 준비**(손잡이를 누른다고 적은 줄 모두): `gizmoMode`는 기본값 `'translate'`, `frame()` 뒤 선택된 것의 한가운데(`editor.screen(id)`)로 먼저 `editor.move(…)`를 보내고 누르기 **전에** `editor.dev().transform.axis === 'XYZ'`를 확인한다(:1638-1666의 크기 기즈모 준비는 쓰지 않는다). **자리와 끝맺음**: 새 뷰포트 테스트는 겹친 방 테스트(:1612-1634) 뒤에, 통합 테스트는 지금의 통합 테스트(:1940) 뒤에 두고 — 둘 다 정리 테스트(:2062) **앞**이다 — 모두 `editor.viewport.dispose()`(통합은 `unsubscribe()`도)로 끝낸다. 이제 뷰포트마다 `start()`가 창에 캡처 `pointerdown` 리스너를 붙이므로, 하나라도 남으면 그 테스트가 아니라 정리 테스트("Every viewport of this file is disposed by now")가 실패한다.
  - 천천히 두 번(`detail` 1, 1) → `nook` → `classroom`. 한 번 더 → `nook`.
  - 빠르게 두 번(1, 2) + `dblclick` → `select` 기록이 한 번, `open`이 `nook`.
  - `classroom`을 다른 자리에서 골라 둔 채(그 방만 있는 자리를 눌러서, 또는 `selectedId`로) `nook` 자리를 한 번 → `nook`. 그 자리를 빠르게 두 번 + `dblclick` → `open`이 **`nook`**.
  - 세 번 되풀이: 빠르게 두 번 + `dblclick`을 세 번(매번 `render({ selectedId: nook })`으로 선택을 돌려준다) → `open`이 세 번 다 `nook`, `classroom`은 열리지 않는다.
  - 천천히 눌러 `classroom`까지 넘긴 뒤(1, 1) 빠르게 두 번 + `dblclick` → `open`이 **`classroom`**. `classroom`에 연결이 없는 도면에서 같은 일 → `open`이 **`nook`**, 둘째 클릭은 넘기지 않는다.
  - **연결 없는 두 방**: 빠르게 두 번(1, 2) → `state.selectedId`가 안쪽 방 그대로이고 `select` 기록 어디에도 바깥 방이 없다. `detail` 3도 같다. `dblclick`의 `open`은 안쪽 방. 견주는 경우: 천천히 두 번(1, 1) → 안쪽 → 바깥.
  - **넘겨 둔 뒤의 빠른 두 번**(연결 없는 세 겹 `S`·`M`·`B`): (1, 1)로 `M`까지 넘긴 뒤 (1, 2) → `select` 기록 `S`, `M`, `B`, `B`.
  - 손잡이 위의 연속 클릭(`canEdit: true`, 연결 없는 두 방): 안쪽 방을 누른 뒤 한가운데 손잡이를 `detail` 2로 끌지 않고 누른다 → `select` 기록이 늘지 않고 선택이 안쪽 방 그대로.
  - 겹친 카메라 셋: `detail` 2를 줘도 클릭마다 넘어간다. 다른 자리에서 골라 둔 카메라가 있어도 넘어간다.
  - 둘러보기 도구: '선택' 도구로 `classroom`만 있는 자리를 누른 뒤 `render({ tool: 'look' })` → `nook` 자리를 (1, 2) + `dblclick` → `select` 기록이 없고 `open`이 **`nook`**.
  - 손잡이(`canEdit: true`): `nook`을 누른다 → 그 한가운데 손잡이를 `detail` 1로 끌지 않고 누른다 → `classroom`으로 넘어간다. 견주는 경우: `selectedId: classroom`으로 시작해 그 한가운데 손잡이(아래에 `nook`의 바닥이 오는 도면)를 한 번 누른다 → `select` 기록이 없다.
  - 첫 클릭이 손잡이인 더블클릭(`canEdit: true`): `selectedId: nook`으로 시작해 한가운데 손잡이를 빠르게 두 번 + `dblclick` → `open`이 `nook`, `select` 기록이 없다.
  - 다른 길로 바뀐 선택: `nook` 자리를 한 번 누른 뒤 `render({ selectedId: classroom })` → 다시 `nook`으로 돌려놓고 그 자리를 누른다 → `nook` 그대로.
  - **자리 기억이 끝나는 누름**(줄마다 새로: `nook`을 눌러 고른다 → 아래 일 → 그 자리를 `editor.at(…)`으로 다시 구해 `detail` 1로 누른다. 기대는 모두 "`nook` 그대로 — `select` 기록에 `classroom`이 없다". 그 일을 빼면 `classroom`이라는 견줌도 둔다): 오른쪽 버튼으로 둘러봄(`press(at, { button: 2, buttons: 2 })` → `move(…, { buttons: 2 })` 30px → `release(…, { button: 2, buttons: 0 })`, `view()`가 달라졌는지) / 오른쪽 버튼을 끌지 않고 눌렀다 뗌 / 휠 버튼으로 끌어 옮김(`{ button: 1, buttons: 4 }`) / 캔버스 밖의 누름(`window.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, isPrimary: true }))`) / '둘러보기' 도구의 끌기(`render({ tool: 'look' })` → 왼쪽 30px 끌기 → `render({ tool: 'select' })`) / '선택' 도구의 빈 끌기(바닥 위 30px) / 포인터 취소(`press(at)` 뒤 캔버스에 `pointercancel`).
  - 손잡이 클릭에서도 같다(`canEdit: true`): `nook`을 누른다 → `frame()` → 오른쪽 버튼으로 누르고 끌고 뗀다 → 한가운데 손잡이를 `detail` 1로 누른다 → `select` 기록이 늘지 않는다. 캔버스 밖 `pointerdown`으로 해도 같다.
  - 기즈모 끌기는 기억을 지키고, 취소는 끝낸다(`canEdit: true`): `nook`을 누른다 → `frame()` → X 화살표(`editor.handle(nook.id, 'X')`)를 20px 끌고 뗀다(`finish` 한 번) → `frame()` → 옮겨진 `nook`의 한가운데 손잡이를 누른다 → **`classroom`으로 넘어간다**. 같은 준비에서 끄는 도중 창에 Escape(`cancel` 한 번) → 뗀다 → 손잡이를 누른다 → 넘어가지 않는다.
  - 정리: :2085의 목록(`'keydown', 'keyup', 'pointermove', 'pointerup'`)에 `'pointerdown'`을 더한다.
  - 통합(문서 스토어 연결 — `onSelect`는 `value => store.dispatch(pickAction(mapId, value, true, mapSelection(초안, mapViewport(store.getState(), mapId).selectedIds)))`, 뷰포트에 넘기는 `selectedId`는 `singleViewId(초안, mapSelection(…), mapViewport(…).selectedId)`. `group` = `select-many` 직후의 `selectedIds` 배열): `[a, b]`를 고르고 대표 `b`를 기즈모로 끌고 `finish` → `selectedIds === group` / 대표 `b`를 누른다(겹친 것 없는 자리) → `selectedIds === group`, 뷰포트의 `selectedId`는 `b`, 스토어 알림 없음. 묶음 안의 `a` → `a`. 묶음 밖의 `c` → `c`. 빈 바닥 → `null`. 다시 `a` → `a`. 그동안 `selectedIds === group` / 대표가 겹친 카메라 셋 가운데 하나(`[의자, 둘째 카메라]`): 강조된 둘째 카메라를 누른다 → 뷰포트의 `selectedId`만 셋째 카메라, 두 번 더 누르면 첫째 → 둘째, 그동안 `selectedIds === group`. `canEdit: true`로 손잡이를 끌지 않고 눌러서 해도 같다 / 대표인 방을 같은 자리에서 천천히 두 번(`[의자, nook]`) → `nook` → `classroom`, `selectedIds === group` / 견주는 경우 — `['a']`만 고른 문서: `c`를 누르면 `selectedIds`가 `['c']`, 빈 바닥이면 `[]` / `select-many ['a', 'b']`(같은 목록)를 다시 보내면 `mapViewport(…).selectedId`가 `'b'`.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMap3dScene.test.ts` → 새 뷰포트 테스트가 단언 실패(지금의 3D는 공간을 넘기지 않고, 창에 `pointerdown` 리스너가 없다). 기존 테스트는 통과.
- [ ] **Step 3: 기억과 누름** — `Press`(:23)에 `repeat: boolean`. 필드 둘(주석은 7.3 그대로): `private turn: { hitId: string; pickedId: string | null } | null = null;` · `private aimed: string | null = null;`. `start()`의 캔버스 리스너들 옆에 `window.addEventListener('pointerdown', this.onPressElsewhere, true);`, `dispose()`에 같은 인자의 `window.removeEventListener(`. `private readonly onPressElsewhere = (event: PointerEvent): void => { if (event.target !== this.canvas) this.turn = null; };`. `onPointerDown`: `this.press = … repeat: false } : null;` **뒤에** `if (!this.press) this.turn = null;`. `onMouseDown`에 한 줄 `if (event.button === 0 && this.press) this.press.repeat = event.detail >= 2;`(휠 버튼의 `preventDefault`는 그대로). `onPointerUp`의 끌린 누름 가지를 `this.lastDragAt = performance.now();` → `if (!press.gizmo) this.turn = null;` → `return;` 순서로 하고, `press.repeat`을 `this.clickHandle(`과 `this.click(` 둘 다에 넘긴다. 기즈모 host의 `onCancelGesture`: `{ if (this.press) this.press.moved = true; this.turn = null; this.props.onCancelGesture(); }`. `onPointerCancel`: `{ this.press = null; this.turn = null; }`.
- [ ] **Step 4: 고르기** — `click`·`clickHandle`(:523-547)을 설계 7.3의 코드 블록(`click`·`clickHandle`·`pick`·`opens`·`doubleClickNode`)으로 글자 그대로 바꾼다. `click`의 세 갈래(`this.look` / `props.placing` 블록 / `props.tool !== 'select'`)는 지금 그대로 두고 그 앞에 `if (this.look || props.placing || props.tool !== 'select') { this.aimed = null; this.turn = null; }`. `clickHandle`의 본문은 `this.pick(clientX, clientY, repeat, true);` 한 줄. `pick` 안에서 `this.turn = …`은 `props.onSelect(next)`보다 **앞**이고, 파일에 `resolveMapClick(` 호출은 `resolveMapClick(props.map, selectedId, hits, again, repeat)` 하나뿐이다. import에 `mapClickAim, mapFloorPile`을 더한다(`stackedMapNodeIds`는 이미 있다).
- [ ] **Step 5: `update()`와 `onDoubleClick`** — `update()`에 `if (this.turn && props.selectedId !== this.turn.pickedId) this.turn = null;`, `mapChanged` 분기(:239-243)에 `this.aimed = null; this.turn = null;`. `onDoubleClick`은 가드를 그대로 두고 대상을 고르는 줄만 `const id = this.doubleClickNode(this.cast(event.clientX, event.clientY));`로.
- [ ] **Step 6: 자가 점검** — 파일 전체에서 `this.turn = null`이 정확히 8곳(`onPressElsewhere`, `onPointerDown`, `onPointerUp`의 끌린 가지, `onCancelGesture`, `onPointerCancel`, `click`, `update`의 두 줄) · `resolveMapClick(` 1곳 · `this.doubleClickNode(` 2곳(`pick`, `onDoubleClick`) · 파일에 `selectedIds`·`mapPlanSelect` 0곳.
- [ ] **Step 7:** `node --test tests/backgroundMap3dScene.test.ts` → 통과(:1612-1634, :1700-1758의 기존 기대값은 손대지 않고 통과).
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 10: 커밋** — 두 파일 / `배경 도면: 3D에서도 같은 자리를 천천히 다시 누르면 아래 방으로 — 연속 클릭은 넘기지 않고, 다른 것을 누르면 기억이 끝난다`

**v1.131.0과 달라지는 것(되살리지 말 것):** 3D에서 선택된 공간을 같은 자리에서 천천히 다시 누르면 아래 바닥의 공간으로 넘어간다(손잡이 위에서도). 더블클릭이 여는 것은 "포인터 아래 맨 위"가 아니라 첫 클릭이 겨눈 연결된 공간이 먼저다. 3D의 고르기는 `click`·`clickHandle` 두 길이 아니라 `pick` 하나다. 겹친 카메라·기호는 지금처럼 클릭마다 넘어간다.
**이 Task가 끝나면 편집기는:** 3D에서 겹친 방이 평면과 같은 규칙으로 잡히고 넘어간다. 보조 평면도는 아직 넘기지 않는다(Task 14).

### Task 14: 보조 평면도 — 클릭 점·`again`·연속 클릭 넘기기, 밖의 누름에 기억 지우기

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapPlanPreview.tsx`

**Read first:** 설계 7.4 전부(코드 블록과 불릿), 7.3 끝의 '기억이 끝나는 때' 표의 보조 평면도 칸, 12.8의 앵커 34, 16.2의 E6(보조 평면도) 줄 · `BackgroundMapPlanPreview.tsx` :1-2, :14-37, :157-168, :183-190 · 편집기 :313-319(같은 꼴의 창 캡처 리스너).

이 기능에는 컴포넌트를 띄우는 테스트가 없다. 판정은 Task 12의 "이어서 누르기"가, 배선은 Step 4의 자가 점검과 Task 15의 앵커 34가, 흐름은 수동 검증 O6·O26·O28이 본다.

- [ ] **Step 1: 클릭 횟수 넘기기** — `Activate`(:15)를 `(id: string, cycle: boolean, point?: BackgroundPoint, repeat?: boolean) => void`로. `nodeButton`의 `onClick`은 `onActivate(node.id, true, clickPoint(event), event.detail >= 2)`. 키보드로 고르는 길(`onActivate(node.id, false)`)은 그대로.
- [ ] **Step 2: 기억과 밖의 누름(7.4의 코드 블록 그대로)** — react import에 `useEffect`를 더한다. `const turn = useRef<{ hitId: string; pickedId: string } | null>(null);` · `const svgRef = useRef<SVGSVGElement>(null);`(`<svg className="bmap-plan-svg" ref={svgRef} …>`) · 렌더에서 `if (turn.current && turn.current.pickedId !== selectedId) turn.current = null;` · 창 캡처 효과 — `forget`의 본문은 `if (!(event.target instanceof Node) || !svgRef.current?.contains(event.target) || !event.isPrimary || event.button !== 0) turn.current = null;`, `window.addEventListener('pointerdown', forget, true);`로 붙이고 정리 함수가 뗀다.
- [ ] **Step 3: `activate`** — `(id, cycle, point, repeat = false)`로 받고: `const again = cycle && turn.current?.hitId === id && turn.current.pickedId === now.selectedId;` → `const next = cycle ? nextPlanSelection(now.map, id, now.selectedId, Math.max(12, PLAN_MARK.dot * 2 * now.scale), covers, point, again, repeat) : id;` → `turn.current = cycle ? { hitId: id, pickedId: next } : null;` → `now.onSelect(next);`. 자리 기억은 **클릭만** 적는다(키보드로 고른 것은 비운다). 바탕의 `onClick={() => onSelect(null)}`은 그대로.
- [ ] **Step 4: 자가 점검** — `event.detail >= 2` 1곳 · `nextPlanSelection(`의 마지막 세 인자가 `point, again, repeat` · `turn.current = cycle ? { hitId: id, pickedId: next } : null;`이 `now.onSelect(next)`보다 앞 · `ref={svgRef}` 1곳 · 파일에 `selectedIds` 0곳.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → Task 13과 같은 수, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 한 파일 / `배경 도면: 보조 평면도에서도 같은 자리를 천천히 다시 누르면 아래 방으로 — 빠른 둘째 클릭과 키보드로 고른 뒤의 첫 클릭은 그대로`

**v1.131.0과 달라지는 것(되살리지 말 것):** 보조 평면도의 공간도 같은 자리를 천천히 다시 누르면 넘어간다. 그 화면 밖을 누르거나 왼쪽 주 버튼이 아닌 버튼으로 누르면 기억이 끝난다. 겹친 카메라·기호는 지금처럼 클릭마다 넘어간다.
**이 Task가 끝나면 편집기는:** 평면·보조 평면도·3D가 같은 쌓임 순서와 같은 "다시 누름"의 뜻을 쓴다(설계 7.1).

### 관문 B — 엔진 확인 E6·E11과 E8의 남은 둘 (Task 14 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

방법은 관문 A와 같다. E6·E11의 원시 이벤트는 관문 A에서 이미 찍었다 — 여기서는 구현된 동작과 함께 다시 본다(E6: 겹친 방의 빠른 두 번이 넘기지 않고 연결된 방이면 들어가는지 / E11: 오른쪽·휠 버튼 누름이나 캔버스 밖의 누름 뒤에 같은 자리를 다시 눌러도 그 방 그대로인지). 대체안으로 바꾸면 Task 15의 앵커 31·34·35와 뷰포트 테스트도 그 구현에 맞춘다.

| 확인 | 봐야 할 것 | 다르면 (설계 16.2) |
|---|---|---|
| E6 3D에서 방을 더블클릭(캔버스 `mousedown`의 `detail` 기록) | 1, 2로 온다 | 고르는 일(`pick`)을 평면처럼 캔버스의 `click` 이벤트로 옮긴다: `pointerup`은 누른 자리와 손잡이 여부를 적어 두기만 하고, `click`이 `event.detail >= 2`를 `repeat`으로 넘겨 `pick`을 부른다(`turn`·`aimed`·`doubleClickNode`는 그대로). 뷰포트 테스트의 클릭은 `click` 이벤트를 함께 보낸다 |
| E6 보조 평면도에서 방을 더블클릭(그 노드 `click`의 `detail` 기록) | 1, 2로 온다 | 늘 1이면 보조 평면도 SVG의 `onMouseDown`이 `event.detail >= 2`를 ref에 적어 두고 `nodeButton`의 `onClick`이 그 값을 `repeat`으로 넘긴다 |
| E11 3D 캔버스에서 오른쪽·휠 버튼을 누름(캔버스 `pointerdown`의 `button`) / 편집기 밖과 확인 창의 버튼을 누름(창 캡처 `pointerdown`의 `target`) | `button` 2·1로 온다 / 누름마다 온다(대상이 3D 캔버스가 아니다) | 오른쪽·휠 버튼의 누름이 `pointerdown`으로 오지 않으면 OrbitControls의 `start`에서도 지운다(`this.orbit.addEventListener('start', …)`). 이 대체안을 쓰면 3D에서는 휠 확대도 기억을 끝낸다(완료 보고에 적는다). 창 캡처가 어떤 요소의 누름을 놓치면 그 요소만 예외로 적고 고치지 않는다 |
| E8 ★의 남은 둘: 묶음 삭제 확인 창을 닫은 직후 / 요약의 '모두 잠그기'를 누른 직후, 캔버스를 누르지 않고 스페이스+끌기 (G5·G7과 함께) | 화면이 움직이고, Ctrl+Z가 바로 듣는다(포커스가 캔버스) | 묶음 삭제 뒤 포커스가 캔버스로 가지 않으면(창의 정리 함수와 `focusAfterConfirm` 효과의 순서가 반대) 효과 안에서 `requestAnimationFrame`으로 한 프레임 미룬다 |

---

## Chunk 7: 앵커 테스트와 마무리

### Task 15: 새 앵커 15개와 뮤테이션 확인, CSS·문구 점검

**Files:**
- Modify: `tests/backgroundMapEditorWiring.test.ts`
- Modify(점검에서 어긋난 것이 나올 때만): 편집기·3D·보조 평면도 소스, `src/features/backgrounds/backgrounds-map.css`

**Read first:** 설계 12.8 전부(표 둘, 그 아래 세 문단), 10.2, 10.3, 5.1, 6.4, 6.5 · 지금의 앵커 테스트 전체(`read`·`piece`·`positions`·`inOrder`·`count`·`handler`·`canvasTag`) · 완성된 소스.

- [ ] **Step 1: 앵커를 쓴다** — 앵커마다 `test()` 하나. 조각은 설계 12.8 표의 글자 그대로다(아래는 요약 — 표를 옆에 두고 쓴다). 편집기 밖의 파일은 `read('map3dScene.ts')`처럼 읽는다. 새 조각 표지는 `handler` 표처럼 "자기 첫 줄 ~ 파일에서 바로 뒤에 오는 코드"로 잡는다: `select`(`function select(` ~ `function updateView(`), `navigate`·`switchMode`·`leave3D`(~ `function expandPath(`), `placeSymbol`(~ `function beginEditing(`), `confirmAction`(~ `async function createMap(`), `planGestureOf`(~ `function mapPath(`), `onSpaceKey`(`const onSpaceKey = useEvent(` ~ 그 뒤의 `useEffect(`), `pickMapFloor`(~ `export function pickMapNode(`), 3D의 `pick`·`click`·`onPointerDown`·`onPointerUp`·`update`·`start`·`dispose`. Task 9에서 고친 5·6은 그대로 둔다.

  | # | 보는 것 | 뮤테이션(스크래치 사본에서 깨뜨리는 법) |
  |---|---|---|
  | 10 | 3D 세 파일이 import하지 않는 목록에 `mapPlanSelect`를 더한다 | 3D 파일에 `mapPlanSelect` import 한 줄 |
  | 21 | 쌓임 순서는 한 곳: 편집기에 `stackedSpaces(current).map(`가 있고 `nodes.filter((node): node is BackgroundSpace`가 없다 · 보조 평면도에 `stackedSpaces(map).map(` · `pickMapFloor`에 `spaceStackRanks(map)`가 있고 `map.nodes.findIndex(`가 없다 · `placeSymbol`에 `spacesAt(base, point)[0]`, 편집기에 `reverse().find(`가 없다 | 넷 가운데 하나를 배열 순서로 되돌림(각각) |
  | 22 | `switchMode`·`leave3D`·`navigate` 본문에 `select(`·`selectMany(`가 없다 | `switchMode`에 대표 하나로 접는 줄 |
  | 23 | `<Map3D map={current} selectedId={singleId} canEdit={canEdit} onSelect={selectNode}` · `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode}` · `const singleId = singleViewId(current, selection, view.selectedId);` · `select` 본문이 `if (mapId) doc.dispatch(pickAction(mapId, id, mode === '3d' && mapId === current?.id, selection));` 한 줄 · 편집기에 `doc.select(`와 `pick-one`이 없다 · `'delete-node'` 분기가 `select(null)`로 끝난다 · `mapCanvas.ts`·`BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`·`BackgroundMapPlanPreview.tsx`에 `selectedIds`가 없다 | `select`가 `doc.select`를 부름 / 3D에 `view.selectedId`나 `selection.primaryId`를 넘김 / `mode === '3d'` 조건을 뺌 / 3D에 묶음을 넘김 |
  | 24 | `const selected = mode === 'plan' && multiple ? undefined : current?.nodes.find(node => node.id === singleId);` · 손잡이 줄이 `selected && canEdit && !selected.locked`로 시작 · 3D 안내 줄이 `mode === '3d' && multiple` 아래 | `selected`의 조건을 뺌 |
  | 25 | `pointerDown`에 `resolvePlanPress(`가 정확히 한 번이고 `view.selectedId`가 없다 · `planGestureOf`에 `{ mode: 'move-group', nodeId: node.id, ids: session.groupIds }` · `pointerUp`의 `toggle` 분기가 `liveSelection(`으로 읽은 목록으로 `doc.selectMany(`를 부른다 · `mapDocument.ts`에 `toggle-select`와 `add?:`가 없다 | 편집기 안에서 따로 판정 / 묶음 제스처를 하나짜리로 넘김 / 날것 목록에 붙이는 액션을 되살림 |
  | 26 | `pointerDown`에 `const panning = event.button === 1 \|\| tool === 'hand' \|\| spaceHeld.current;` · 다각형·기호의 이른 반환 둘이 `if (!panning && canEdit && !handle && tool ===`으로 시작 · 모드를 정하는 묶음이 `if (!panning) {` 안 · `resolvePlanPress(`를 부르는 줄이 `panning \|\| drawing \|\| handle ? null :`로 시작 | 스페이스를 누른 채 그리기 도구가 그림 / 선택이 바뀜 |
  | 27 | `pointerDown`의 `if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;` · `pointerMove`의 상자 분기가 `setMarquee(` 뒤 `return`으로 끝나고 `previewPlanGesture(`보다 앞 · `pointerUp`의 상자 분기에 `doc.selectMany(`가 있고 `doc.finishGesture(`가 없다 · `abortGesture`에 `setMarquee(null)` | 상자가 되돌리기 단계를 만듦 / 취소 때 상자가 남음 |
  | 28 | 창 캡처 `keydown`·`keyup`과 `blur` 리스너(`onSpaceKey`) · 상수 `tickInputs`·`spaceEntry`가 글자 그대로 · `onSpaceKey` 안의 다섯 줄이 Task 10 Step 2의 순서로 · `hold(true)`보다 앞에 `root.contains(`·`document.body`가 없다 · `onSpaceKey` 안에 `closest(textEntry)`가 없다 · `event.preventDefault()`는 `onSpaceKey` 안에 한 줄뿐 · `keyboard()` 안에 `'Space'`가 없다 · SVG의 `className`에 `spacePan && !gestureActive && !marquee ? ' is-space-pan'` | 추적에 포커스 자리 조건을 되살림 / `spaceEntry`를 `textEntry`로 / `tickInputs`에서 `checkbox`를 뺌 / `spaceEntry` 검사를 뺌 / 삼키는 줄에서 `root.contains(element) &&`를 뺌 / `` `${interactive}, summary` `` 검사를 뺌 / `document.body`를 뺌 / `root.offsetParent === null`을 뺌 (각각) |
  | 29 | `'delete-group'` 분기가 `removeMapNodes(source, selection.ids)`, 그 뒤의 `doc.selectMany(`, `focusAfterConfirm.current = true`를 갖는다 · `if (!confirmation && focusAfterConfirm.current)` 효과 · `onLock`이 `lockMapNodes(current, selection.ids, locked)` 뒤에 `focusCanvas()` · `keyboard`의 Delete가 고른 점 → 하나 → 묶음 순이고 묶음 줄이 `mode === 'plan' && multiple`을 조건으로 | 3D에서 묶음을 지움 / 지운 뒤 선택을 그대로 둠 / 잠근 뒤 `focusCanvas()`를 뺌 |
  | 30 | Escape 분기가 `pointerRef.current?.mode === 'marquee' \|\| doc.isGestureActive()`에서 `abortGesture()`로 돌아간다 · Escape 분기 안에 `select(`·`selectMany(`가 없다 | `marquee` 조건을 뺌 / Esc가 선택을 풂 |
  | 31 | `BackgroundMap3D.tsx`: `onMouseDown`에 `this.press.repeat = event.detail >= 2` · `pick`에 `const again = top !== null && this.turn?.hitId === top && this.turn.pickedId === selectedId;`, `if (!repeat) this.aimed = mapClickAim(props.map, selectedId, hits, again);`, `else if (this.opens(this.doubleClickNode(hits))) return;`, `resolveMapClick(props.map, selectedId, hits, again, repeat)`(파일에 이 호출 하나뿐), `props.onSelect(next)`보다 앞에 `this.turn =` · `click`의 `{ this.aimed = null; this.turn = null; }` 줄 · `clickHandle`의 본문이 `this.pick(` 한 줄 · `onPointerUp`이 `press.repeat`을 둘 다에 넘긴다 · `onDoubleClick`에 `this.doubleClickNode(` · `update`의 두 줄 · `map3dScene.ts`의 `resolveMapClick`에서 공간 더미가 `again` 조건 아래에 있고 `repeat`이면 `selectedId`를 돌려주는 줄이 있다 | 둘째 클릭이 겨눈 것을 덮어씀 / 둘러보기 도구의 클릭이 `aimed`를 지우지 않음 / `again` 없이 공간을 넘김 / `repeat`을 `resolveMapClick`에 넘기지 않음 / 손잡이 클릭에 `repeat`을 넘기지 않음 / 둘째 클릭과 `dblclick`이 다른 함수를 씀 |
  | 35 | `start`에 `window.addEventListener('pointerdown', this.onPressElsewhere, true);`, `dispose`에 같은 인자의 `removeEventListener` · `onPressElsewhere`의 본문 `if (event.target !== this.canvas) this.turn = null;` · `onPointerDown`에서 `this.press =` 뒤에 `if (!this.press) this.turn = null;` · `onPointerUp`의 끌린 가지에 `this.lastDragAt = performance.now();` → `if (!press.gizmo) this.turn = null;` → `return;` · `onCancelGesture`와 `onPointerCancel`에 `this.turn = null;` · 파일 전체에서 `this.turn = null`이 이 다섯 곳과 앵커 31의 세 곳뿐 | 창 리스너를 뺌 / 캡처(`true`)를 뺌 / `event.target !== this.canvas` 조건을 뺌 / `if (!this.press) this.turn = null;`을 뺌 / `if (!press.gizmo) this.turn = null;`을 뺌 / 그 줄의 `!press.gizmo` 조건을 뺌 / 취소 줄을 뺌 / `dispose`에서 떼지 않음 |
  | 34 | `BackgroundMapPlanPreview.tsx`: `onActivate(node.id, true, clickPoint(event), event.detail >= 2)` · `activate`의 `again` 줄, `nextPlanSelection(`의 마지막 세 인자 `point, again, repeat`, `turn.current = cycle ? { hitId: id, pickedId: next } : null;`이 `now.onSelect(next)`보다 앞 · 렌더의 `if (turn.current && turn.current.pickedId !== selectedId) turn.current = null;` · `forget`의 본문과 `window.addEventListener('pointerdown', forget, true);`, 정리 함수 · SVG 태그의 `ref={svgRef}` · `mapPlanPreview.ts`의 `nextPlanSelection`에서 공간 더미가 `again` 아래에 있고 `repeat`이면 `selectedId`를 돌려주는 줄이 있다 | `again` 없이 공간을 넘김 / 키보드로 고른 것까지 자리 기억에 적음 / `event.detail >= 2`를 뺌 / `repeat`을 넘기지 않음 / 창 리스너를 뺌 / `svgRef`를 SVG에 달지 않음 / `contains` 조건을 뒤집음 |
  | 33 | `pointerDown`에 `const spot = pressLog.current[1] ? lastSpot.current : null; lastSpot.current = null;` → `const again = sameSpotAgain(spot, current.id, hit?.id ?? null, held);` → `resolvePlanPress(` → `pressLog.current = press ?`가 **이 순서로** · 세션에 `spotId: plan?.logged && hit ? hit.id : null` · `pointerUp`의 `if (!cancel && session.spotId !== null && !(session.moved && session.mode !== 'move'))`(글자 그대로 한 번, `session.spotId !== null`만으로 끝나는 `if`는 없다) 아래에 `lastSpot.current = { mapId: session.mapId, hitId: session.spotId, pickedId:` · SVG `onClick`의 `select(next, cycle.mapId);` 뒤에 `lastSpot.current = { ...lastSpot.current, pickedId: next };` · 편집기 전체에서 `lastSpot.current =`(대입)가 정확히 셋 | 넘긴 뒤 고치지 않음 / 누름 기록이 비어도 읽음 / 누를 때 비우지 않음 / 누름 기록을 적은 뒤에 읽음 / `!(session.moved && session.mode !== 'move')`를 뺌 / 그 조건을 `!session.moved`로 좁힘 |
  | 32 | `mapStack.ts`·`mapPlanSelect.ts`가 three.js를 import하지 않고 DOM을 만지지 않는다(앵커 9와 같은 정규식 둘) | `window.innerWidth`를 읽는 줄 추가 |

  Task 9의 앵커 5·6도 뮤테이션 대상이다(설계 12.8 '바뀌는 앵커' 표의 변형: `cycle.spaces ||`를 뺌 / `spaces`를 `pendingCycle`에 싣지 않음 / `pointerUp`에서 바로 넘김 / `!session.groupIds`를 뺌 / 넘기기가 다른 판정을 씀 / 맨 위 것으로 넘어오는 `for` 줄을 뺌 / 들어갈 때 선택하지 않음).
- [ ] **Step 2:** `node --test tests/backgroundMapEditorWiring.test.ts` → 35개 통과. 실패하는 앵커가 있으면 배선이 빠진 것이다 — **소스를 고친다**. 정규식이 틀린 경우에만 테스트를 고친다. 기존 앵커 1~4, 7~9, 11~20은 그대로 통과해야 한다. (관문 A·B에서 대체안으로 바꾼 것이 있으면 그 앵커를 그 구현에 맞춘다.)
- [ ] **Step 3: 뮤테이션 확인(스크래치 사본에서만)** — 워크트리 **밖**의 임시 폴더에 `tests/backgroundMapEditorWiring.test.ts`와 `src/features/backgrounds/`를 같은 상대 경로로 복사한다. **뮤테이션을 넣기 전에 복사한 테스트 파일을 한 번씩 그대로 돌려 통과를 확인한다** — `ERR_MODULE_NOT_FOUND`나 import 오류로 파일 전체가 실패한 것은 '잡힘'으로 세지 않는다(잡힌 것은 그 뮤테이션을 겨눈 단언이 실패한 것이다). 표의 뮤테이션을 **하나씩** 사본에 넣고 그 번호의 앵커가 **실패**하는지 본 뒤 되돌린다('/'로 나뉜 것은 각각). 살아남은 뮤테이션이 있으면 워크트리의 앵커를 조여 다시 복사하고 반복한다. 새 순수 테스트도 같은 방식으로 표본을 본다(해당 테스트 파일을 함께 복사): 쌓임 비교의 부호 / `spacePlanArea`의 절댓값 삭제 / 벽 판정을 넓이 판정으로(Q1의 답이 '넓이'였으면 거꾸로: 더한 `containsPoint` 검사를 삭제) / `moveMapNodes`의 "실려 간 것은 건너뛴다" 줄 삭제 / `removeMapNodes`의 잠금 검사 삭제 / `resolvePlanPress`·`resolveMapClick`·`nextPlanSelection`에서 공간 더미의 `again` 조건 삭제 / `resolveMapClick`·`nextPlanSelection`에서 공간 가지의 `repeat` 줄 삭제, 그 줄이 `selectedId` 대신 맨 위 것을 돌려주게 바꿈 / `resolvePlanPress`의 `step`이 `spaces`를 늘 거짓으로 / Shift 줄을 4번 뒤로 옮김 / `sameSpotAgain`의 `pickedId` 비교 삭제 / `pickAction`에서 "여러 개" 조건이나 `singleView` 조건 삭제 / `pick-one`이 `selectedIds`를 새 배열로 바꿈 / `withSelection`이 목록만 같으면 그대로 돌려줌 / `singleViewId`의 "하나 이하" 줄이나 "사라졌으면 대표" 줄 삭제. 워크트리의 소스에는 뮤테이션을 넣지 않는다. 끝나면 사본을 지우고, 넣은 뮤테이션 수와 잡힌 수를 커밋 메시지 본문에 적는다.
  - **`resolveMapClick` 표본 셋(`again` 조건 삭제 / `repeat` 줄 삭제 / 그 줄이 맨 위 것을 돌려줌)은 워크트리 밖에서 돌지 않는다**: 그 테스트 파일 `tests/backgroundMap3dScene.test.ts`가 `esbuild`·`three`를 import하므로 밖의 사본에서는 `Cannot find package 'esbuild'`로 파일 전체가 실패한다(기준 커밋에서 확인했다. 다른 표본의 테스트 파일과 앵커 테스트는 `node:`와 상대 import뿐이라 밖에서 돈다 — 3D 파일을 겨눈 앵커 31·35의 뮤테이션도 소스 글자를 읽는 앵커 테스트가 잡는다). 이 셋만 `<워크트리>/.superpowers/mutation-scratch/tests/`와 `<워크트리>/.superpowers/mutation-scratch/src/features/backgrounds/`에 복사해 돌린다 — `.superpowers/`는 `.gitignore`에 있고, `test:background`의 glob(`./tests/background*.test.ts`)과 tsc의 `include`(`src`)에 들지 않으며, 위쪽 `node_modules`가 그대로 해석된다(기준 커밋에서 그 자리의 사본이 통과하는 것을 확인했다). 여기서도 뮤테이션 전에 한 번 그대로 돌려 통과를 본다. **`node_modules`를 junction·symlink로 걸지 않는다**(사본을 지울 때 링크를 따라 들어가 원본이 지워진 사고가 있었다). 끝나면 `.superpowers/mutation-scratch` 폴더만 지우고, `git status --short`에 이 Task의 파일(과 Q1 칸을 적은 설계 문서) 말고 새 항목이 없는지 — 워크트리의 소스에 뮤테이션이 새지 않았는지 — 본다.
- [ ] **Step 4: CSS 점검(10.2)** — `.bmap-marquee`가 설계의 값 그대로. 커서 규칙 셋이 `.bmap-symbol { … cursor:pointer; }` 뒤에 `.bmap-canvas.is-space-pan` → `.bmap-canvas:is(.tool-hand,.is-space-pan) *` → `.bmap-canvas.is-panning, .bmap-canvas.is-panning *` 순서로 있다. 새 규칙에 `transition`·`animation`·`backdrop-filter`가 없다. 요약용 새 클래스가 없다(`.bmap-symbol-actions`를 쓴다).
- [ ] **Step 5: 문구 점검(5.1, 10.3, 6.4, 6.5)** — 아래 문자열이 소스에 글자 그대로 있다: `화면 이동` / `선택: 눌러 고르고 끌어 옮기기 · 빈 곳을 끌어 여러 개 고르기` / `선택: 눌러 고르기 · 끌면 화면이 움직여요` / `화면 이동: 끌어서 화면만 옮기기 · 스페이스를 누른 채 끌거나 휠 버튼으로 끌어도 돼요` / 힌트 넷(Task 10 Step 6) / `여러 개 선택` / `개 선택` / `모두 잠그기` / `잠금 풀기` / `고른 것 가운데 하나를 끌면 함께 옮겨져요. 잠긴 것은 제자리에 있어요.` / `크기와 회전은 하나만 골랐을 때 바꿀 수 있어요.` / `개를 지웁니다. 공간을 지우면 함께 고르지 않은 카메라와 사물 기호는 도면에 남고 공간 연결만 해제됩니다. 원본 장소와 배경은 유지됩니다.` / `개는 지워지지 않습니다.` / `개는 그대로 있어요. 3D에서는 하나씩만 다루고, 평면으로 돌아가면`. 3D 도구줄의 `둘러보기`와 기즈모의 `이동`은 그대로 있다.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음.
- [ ] **Step 7:** `npm run test:background` → 15개 증가, fail 0, skipped 3.
- [ ] **Step 8: 커밋** — 바뀐 파일 / `테스트: 배경 도면 ② 배선 앵커 15개와 뮤테이션 확인, CSS·문구 점검`

**이 Task가 끝나면 편집기는:** Task 14와 같다(점검에서 고친 문구·CSS가 있으면 그만큼만 다르다).

### Task 16: 버전 1.132.0·업데이트 내역·문서·전체 게이트

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`, `AGENTS.md`, `ROADMAP.md`, `DEVLOG/background-3d-opus-handoff-2026-10-07.md`, `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`

**Read first:** 설계 14절 전부(JSON 블록과 문서별 내용), 1.3 표 아래의 '뒤 차례(③~⑤)를 막지 않는 점', 7.6 · `DEVLOG/update-notes.json`의 첫 20줄(들여쓰기) · `AGENTS.md:112`("평면 편집 보조(v1.131.0)" 불릿) · `ROADMAP.md:24`, `:1411-1418` · 인수인계 문서 `## 15.` 절(:352~)의 문체 · 라운드 계획의 `### B1`·`### B2`와 `## 7. 진행 기록` 표.

- [ ] **Step 1: 버전** — 먼저 `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 `1.131.0`인지 본다(이미 1.132.0 이상이면 멈추고 보고). `package.json`의 `"version"`(:3), `package-lock.json`의 맨 위 `"version"`(:3)과 `packages[""]`의 `"version"`(:9) 세 곳을 `1.132.0`으로. 확인: `git diff --numstat package.json package-lock.json` → `1 1`, `2 2`.
- [ ] **Step 2: `DEVLOG/update-notes.json`** — 이 파일은 `JSON.stringify` 출력과 다르다(다시 직렬화하면 전체가 바뀐다). **글자로 끼워 넣는다**: 첫 줄 `[` 바로 다음, 기존 첫 항목 `  {` 앞에 아래 블록(`{`부터 `}`까지 **21줄**, 설계 14절과 같은 글자)을 각 줄 앞에 공백 2칸을 더해 넣고 마지막 줄을 `  },`로 한다. 본문은 **한 글자도 바꾸지 않는다.** 다른 바이트는 그대로다.

  ```json
  {
    "version": "1.132.0",
    "title": "배경 도면에서 여러 개를 한꺼번에 고르고 옮겨요 (시험 중)",
    "items": [
      {
        "category": "feature",
        "summary": "끌어서 여러 개를 한꺼번에 골라요 (시험 중)",
        "description": "평면 도면을 편집할 때 '선택' 도구로 빈 곳을 끌면 상자가 나오고, 상자에 닿은 공간·기호·카메라가 모두 선택돼요. Shift를 누른 채 클릭하면 하나씩 더하거나 뺄 수 있어요. 고른 것 가운데 하나를 끌면 함께 옮겨지고, 함께 지우거나 잠글 수 있어요. 한 번에 옮긴 것은 되돌리기 한 번으로 돌아와요. 큰 공간이 화면을 덮고 있으면 그 공간을 잠가 두거나 Shift를 누른 채 끌어 그 위에서도 상자를 그릴 수 있어요. 3D 화면에서는 지금처럼 하나씩만 다루고, 평면으로 돌아오면 고른 것들이 그대로 있어요. 배경 화면은 아직 배한솔 계정에서만 시험하고 있어요."
      },
      {
        "category": "ux",
        "summary": "'이동' 도구가 '화면 이동'으로 바뀌었어요 (시험 중)",
        "description": "평면 도면에서 화면을 옮기는 도구의 이름을 '화면 이동'으로 바꿨어요. 도구를 바꾸지 않아도 마우스 휠 버튼으로 끌거나 스페이스 키를 누른 채 끌면 화면이 움직여요. 편집 중이 아닐 때는 어디를 끌어도 화면이 움직여요. 예전에는 방 위에서 끌면 움직이지 않았는데 그것도 고쳤어요."
      },
      {
        "category": "ux",
        "summary": "겹쳐 그린 공간에서 작은 방이 먼저 잡혀요 (시험 중)",
        "description": "큰 네모 안에 작은 방을 그렸을 때, 예전에는 나중에 그린 것이 위에 올라와 그 아래 방을 누를 수 없었어요. 이제 그린 순서와 상관없이 작은 공간이 먼저 잡히고, 같은 자리를 천천히 한 번 더 누르면 그 아래 공간으로 넘어가요. 평면과 3D 화면 모두 같아요. 빠르게 두 번 누르면 지금처럼 이름을 고치거나 상세 도면으로 들어가요."
      }
    ]
  }
  ```

  - 확인 1: `git diff --numstat DEVLOG/update-notes.json` → `21	0	DEVLOG/update-notes.json`(더해진 줄 21, 지워진 줄 0).
  - 확인 2: `node -e "const n=require('./DEVLOG/update-notes.json');if(n[0].version!=='1.132.0'||n[0].items.length!==3||n[0].items.map(i=>i.category).join()!=='feature,ux,ux'||n[1].version!=='1.131.0')process.exit(1);console.log(n[0].title)"` → 제목이 찍히고 종료 코드 0.
- [ ] **Step 3: `AGENTS.md`** — '배경 라이브러리 데이터 경계'의 "평면 편집 보조(v1.131.0)" 불릿(:112) 바로 다음에 `- 선택과 겹친 공간(v1.132.0): …` 불릿 하나. 내용은 설계 14절 '문서'의 AGENTS.md 줄에 `/`로 나뉘어 적힌 항목을 그 순서대로 **모두** 옮긴다(선택 묶음은 날것으로 두고 읽을 때 거른다·선택 액션은 바꿔 넣기뿐 / 전환은 선택을 바꾸지 않고 3D는 하나만·`singleViewId`·`pickAction` / `selected`의 뜻 / `resolvePlanPress` / 상자는 화면 상태·공간은 벽 / 묶음 이동·잠긴 것 / `mapStack.ts` 한 곳 / 처음 누르면 맨 위·`again` / 자리 기억이 끝나는 때 / 공간의 더미는 연속 클릭에 넘어가지 않는다·`doubleClickIntent`·`openSpace` / 화면 이동의 세 길과 스페이스의 추적·삼키기 / Esc / 새 카메라의 소속). Q1의 답이나 관문에서 대체안으로 바뀐 것이 있으면 그 구현대로 적는다.
- [ ] **Step 4: `ROADMAP.md`** — '2026-09-21 배경 라이브러리' 절의 ① 줄(:24) 다음에 한 줄: `- [x] 2026-10-09 ② 선택 도구 개편(v1.132.0): 상자로 여러 개 고르기와 묶음 옮기기·지우기·잠그기, '화면 이동' 도구와 스페이스·휠 버튼, 겹친 공간에서 작은 방이 먼저. 저장 자료·운영 DB는 그대로다. 설계: docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md`. 파일 끝의 `### v1.131.0 …` 절(:1411-1418) 다음에 `### v1.132.0 배경 도면 ② 선택 도구 개편 (2026-10-09)` 절: 세 기능을 `- [x]` 세 줄(도구 정리 / 여러 개 고르기 / 겹친 공간 — 설계 1.1의 소제목 순서와 내용), 남은 것을 `- [ ]`로(설계 13절 수동 검증, 배포 뒤 실기 확인: 한솔 PC의 더블클릭 간격에서 "천천히 다시 누르기"와 "빠른 더블클릭", 실제 도면에서의 상자, 설치된 앱 창에서의 스페이스).
- [ ] **Step 5: 인수인계 문서** — `DEVLOG/background-3d-opus-handoff-2026-10-07.md` 끝에 `## 16. ② 선택 도구 개편 (v1.132.0)`: 16.1 문서 위치(설계, 이 계획 `docs/superpowers/plans/2026-10-09-background-map-selection-tools.md`, 검증 기록의 절 이름 `## 2026-10-09 ② 선택 도구 개편 (v1.132.0)`) · 16.2 파일(이 계획의 File structure) · 16.3 뒤 차례가 지켜야 할 것(설계 14절의 그 줄에 적힌 항목 전부) · 16.4 뒤 차례가 정할 것(⑤의 주석 핀이 상자에 잡히는지).
- [ ] **Step 6: 라운드 계획** — `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 `### B2` 목록에 B1과 같은 꼴의 `- 문서:`(설계·이 계획 링크)와 `- 상태:` 줄을 더하고, `## 7. 진행 기록` 표의 ② 행을 설계 문서 경로와 `2026-10-09 구현 완료(v1.132.0) · 수동 검증·배포 대기`로 바꾼다. 다른 줄은 손대지 않는다.
- [ ] **Step 7: 전체 게이트** — `npm run build:vite`(typecheck → 모든 테스트 묶음 → `vite build` → 개발용 manifest). 성공은 종료 코드만이 아니라 로그로 본다: 배경 묶음의 `# fail 0`·`# skipped 3`, `vite build`의 `✓ built in …`, 마지막 manifest 생성 줄. `npm run build`(배포 빌드)는 돌리지 않는다.
- [ ] **Step 8: 커밋** — 일곱 파일(빌드 산출물은 올리지 않는다) / `v1.132.0: 배경 도면 ② 선택 도구 개편 — 버전·업데이트 내역·문서`. 커밋 전에 `git status --short docs/superpowers/`를 본다: 설계나 이 계획이 `??`로 남아 있으면(오케스트레이터가 Task 1 전에 커밋하지 않았다) 이 커밋에 함께 넣는다. 설계 문서가 ` M`이면 Q1 '확인' 칸을 적은 것이다 — 넣지 않는다(오케스트레이터가 검증 기록과 함께 커밋한다).

**이 Task가 끝나면:** 코드는 Task 15와 같고, 앱의 업데이트 내역 맨 위에 1.132.0 항목이 보인다. `CLAUDE.md`는 고치지 않는다. 배포·PR·머지는 한솔이 말할 때만 한다.

### 최종 수동 검증 — 설계 13절 전체 (Task 16 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- 방법과 범위: 설계 13절 머리말 그대로. 시험 도면(큰 방 O 안에 방 I·J와 의자, 연결이 다른 네 벌, 연결 없는 세 겹 S·M·B, 같은 자리의 카메라 셋 — O는 **나중에** 그린다)을 만들고, 모든 항목(E1~E11, T1~T10, M1~M17, G1~G20, O1~O29, R1~R5)을 1440×900 어두운 화면에서 본다. ★ 항목은 1440×900 밝은 화면·740×900 어두운·밝은 화면에서 다시 보고, '(740)' 항목은 740×900에서 본다.
- 결과를 `DEVLOG/background-library-verification-2026-09-21.md`의 `## 2026-10-09 ② 선택 도구 개편 (v1.132.0)`에 적는다(이 파일은 CRLF): typecheck·`test:background`·`build:vite` 수치, 13절 결과(E1~E11, G10·G11·G15·G17·G18·O6·O14~O18·O23·O24·O26~O29·M2·M13은 관찰 그대로. E10은 네 경우마다 스페이스 `keydown`·`keyup`의 대상과 밖의 버튼이 눌렸는지), Q1에 받은 답, 확인하지 못한 것(한솔 PC의 더블클릭 간격, 실제 도면에서의 상자, 설치된 앱 창에서의 스페이스). 설계 1.1의 Q1 '확인' 칸은 답을 받은 날 이미 적었다(공통 규칙) — 비어 있으면 여기서 답과 날짜를 적는다.
- **커밋**: 검증 기록과 설계의 Q1 칸은 오케스트레이터가 `문서: 배경 도면 ② 수동 검증 기록 (v1.132.0)`으로 커밋한다(①의 cff8b048처럼. 그때처럼 라운드 계획의 ② 상태 두 줄을 '구현·수동 검증 완료'로 고쳤으면 그 파일도 함께 — 그 밖의 파일은 넣지 않는다). 아래 조정으로 소스·앵커를 고쳤으면 그것은 따로 커밋한다.
- 조정할 때 건드리는 곳(설계 16.2): G5에서 삭제 확인 뒤 Ctrl+Z가 듣지 않으면 `focusAfterConfirm` 효과를 `requestAnimationFrame`으로 한 프레임 미룬다 · O10에서 크기를 키우는 끌기가 끊기면 제스처 중에는 제스처 시작 도면의 순서로 그린다(`gestureStartMap`) — 이 대체안을 쓰면 앵커 21의 편집기 조각(`stackedSpaces(current).map(`)을 그 구현에 맞추고 `npm run test:background`를 다시 돌린다 · E3의 글자 선택은 `.bmap-canvas-wrap`의 `user-select:none` · 관문 A·B에서 대체안으로 바꾼 것이 있으면 Task 15의 앵커와 `AGENTS.md`·인수인계 문서 16절도 그에 맞춘다. 그 밖에 설계와 다른 동작이 보이면 고치기 전에 원인을 찾는다(@superpowers:systematic-debugging).

---

## 완료 보고에 적을 것

설계 16.3에서 그대로 옮겼다. 승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이므로, 완료 보고에 비개발자 문장으로 옮겨 적는다. Q1은 구현 전에 이미 물었으므로 받은 답과 함께 한 줄만 다시 적는다(답이 달랐다면 첫 줄을 그 답대로 고친다).

- **(Q1) 상자는 공간의 벽에 닿아야 그 공간을 고른다.** 방 안쪽에만 그린 상자는 그 방을 고르지 않고 안의 가구·카메라만 고른다. 방 하나만 있는 곳에서 그 방 안에 상자를 그리면 아무것도 잡히지 않는다(방은 눌러서 고른다).
- **카메라는 몸통이 상자에 닿아야 잡힌다. 부채꼴만 걸친 상자에는 잡히지 않는다.** 부채꼴은 눌러서 카메라를 고를 수 있는 곳이지만, 상자에까지 세면 옆의 가구를 고르려던 상자가 카메라를 늘 끌고 온다.
- **Shift를 누른 채 그린 상자도 보통 상자와 같다: 닿은 것으로 선택이 바뀐다.** 지금 선택에 더하는 상자는 넣지 않았다. 더하려면 Shift+클릭으로 하나씩 더한다.
- **잠긴 것도 상자에 잡힌다. 다만 함께 옮길 때 제자리에 있고 함께 지울 때 남는다.** 여럿을 한꺼번에 풀 수 있게 하기 위해서다. 잠긴 것 위에서 끌면(Shift 없이도) 상자가 나온다.
- **편집 중이 아닐 때 선택은 '눌렀다 뗄 때' 바뀐다.** 끌면 화면만 움직이고 선택과 아래 이미지 그리드는 그대로다. 예전에는 빈 곳을 끌기만 해도 선택이 풀렸다.
- **겹친 자리를 처음 누르면 늘 작은 공간이 잡힌다 — 큰 공간이 선택돼 있어도 그렇다.** 큰 공간을 골라 둔 채 안쪽 방을 끌면 안쪽 방이 움직이고, 안쪽 방을 빠르게 두 번 누르면 안쪽 방의 이름 칸(연결돼 있으면 그 도면)이 열린다.
- **같은 자리를 다시 눌러 아래 공간까지 넘겨 둔 동안에는 그 아래 공간이 그 자리의 대상이다.** 그 자리에서 끌면 아래 공간이 움직이고, 빠르게 두 번 누르면 아래 공간의 이름 칸(연결돼 있으면 그 도면)이 열린다. 다른 곳(다른 방, 속성 칸, 목록)을 한 번 누르거나, 편집 중이 아닐 때 그 자리에서 끌어 화면을 옮기면 다시 작은 공간부터다. **3D와 3D 옆의 작은 평면도에서도 같다**: 방을 누른 뒤 화면을 둘러보거나(오른쪽 버튼·휠 버튼으로 끌기, '둘러보기' 도구) 그 화면 밖(속성 칸, 목록, 도구줄, 다른 화면)을 한 번 누르고 돌아와 그 방을 다시 누르면 그 방이 그대로 선택돼 있다. 아래 공간으로 넘어가는 것은 사이에 다른 것을 누르지 않고 같은 자리를 천천히 다시 누를 때뿐이다(휠로 확대하는 것은 사이에 해도 된다. 3D에서 손잡이로 끌어 옮긴 뒤에는, 평면에서 끌어 옮긴 뒤처럼 이어서 넘길 수 있다). 넘겨 둔 아래 공간에 더블클릭이 할 일이 없으면(편집 중이 아닐 때의 연결 없는 공간, 잠긴 연결 없는 공간) 맨 위의 방에 작용한다 — 연결된 방이면 들어간다.
- **더블클릭으로 상세 도면에 들어가면, 돌아왔을 때 들어갔던 공간이 선택돼 있다.**
- **빠른 두 번 클릭은 넘기기가 아니다 — 어느 화면, 어느 모드에서든.** 겹친 공간을 빠르게 두 번 누르면 '아래 공간으로'가 아니라 이름 고치기(연결돼 있으면 들어가기)다. 더블클릭이 할 일이 없는 곳(편집 중이 아닐 때의 연결 없는 공간, 잠긴 연결 없는 공간, 3D와 3D 옆 작은 평면도의 연결 없는 공간)에서는 **아무 일도 없이 그 공간이 선택된 채 남는다**(지금의 버전에서 방을 더블클릭했을 때와 같다). 넘기려면 클릭 사이를 띄운다. 넘기는 것은 새로 시작하는 클릭뿐이라서, 아래 공간까지 넘겨 둔 자리를 빠르게 두 번 누르면 첫 클릭이 한 칸 넘기고 둘째 클릭은 거기서 멈춘다. 겹친 **카메라·기호**는 ①과 같다: 편집 중에 빠르게 두 번 누르면 이름 고치기이고, 더블클릭이 할 일이 없을 때(편집 중이 아닐 때, 3D)는 지금처럼 누를 때마다 다음 것으로 넘어간다.
- **3D에서 무엇을 고르든 평면의 여러 개 선택은 그대로다.** 여러 개를 고른 채 3D로 가면 3D는 그 가운데 마지막에 고른 하나를 다룬다. 3D에서 다른 것을 누르거나(묶음에 없는 것, 빈 바닥 포함) 목록에서 고르거나 카메라·기호를 새로 만들면 3D가 다루는 하나만 바뀐다. 평면으로 돌아오면 처음에 고른 여러 개가 다시 선택돼 있고, **3D에서 새로 고르거나 만든 것은 선택돼 있지 않다.** 3D에서 지운 것만 그 여러 개에서 빠진다. 여러 개 선택을 푸는 것은 평면에서 한다(3D 화면에는 푸는 버튼이 없고, 속성 칸 맨 위에 "평면에서 고른 N개는 그대로 있어요" 한 줄이 보인다). 하나만 골랐을 때는 지금과 같다: 3D에서 고른 것이 평면에서도 선택돼 있다.
- **평면과 3D가 처음에 다른 공간을 잡을 수 있는 곳이 하나 있다: 바닥 높이가 다른 공간이 겹친 자리.** 평면은 넓이로만 위아래를 정하고(작은 것이 위), 3D는 눈에 가까운 바닥(위층)이 먼저다. 어느 쪽이든 같은 자리를 천천히 다시 누르면 다른 공간으로 넘어간다. 바닥 높이가 같은 공간끼리는 평면과 3D가 같다.
- **함께 옮길 때의 스냅은 묶음 전체를 감싼 상자로 붙는다.** 붙지 않은 방향은 잡고 끈 것 하나의 위치만 소수점 없이 떨어지고, 나머지는 서로의 간격을 지킨다(그래서 소수가 남을 수 있다).
- **새 기호는 놓은 자리의 가장 작은 공간에 속한다**(예전에는 나중에 그린 공간). 새 카메라의 소속 규칙은 그대로다(생성점을 품은 공간이 하나뿐일 때만).
- **Esc는 선택을 풀지 않는다**(하나든 여러 개든, 지금과 같다). 여러 개 선택은 요약의 `×`나 빈 곳을 눌러 푼다. 상자를 그리다 Esc를 누르면 상자만 사라진다.
- **넣지 않은 것**: Ctrl+A(모두 고르기), Esc로 선택 풀기, 지금 선택에 더하는 상자, 오브젝트 목록에서의 Shift+클릭, 방향키로 옮기기. 필요하면 따로 정한다.
- **스페이스로 화면 옮기기는 평면에서만 된다(3D는 지금처럼 오른쪽 버튼·둘러보기).** 방금 무엇을 눌렀든 — 배경 화면의 탭이나 새로고침 버튼, 앱 왼쪽의 메뉴, 속성 칸의 잠금 체크 칸 — 스페이스를 누른 채 도면을 끌면 화면이 움직이고, 그 버튼이나 체크 칸은 눌리지 않는다. 다만 **글자를 치는 칸에 커서가 있을 때는 스페이스가 글자다**(이름 칸·숫자 칸·검색 칸, 목록을 여는 선택 칸, 열려 있는 창): 그때 스페이스를 누른 채 끄는 것은 보통의 끌기다. 버튼이나 체크 칸에 포커스가 있을 때 스페이스만 눌렀다 떼면 지금처럼 그 버튼·체크 칸이 눌린다.
- (엔진 확인에서 생긴 것이 있을 때만) 관문 A·B에서 대체안으로 바꾼 것 — 예: 편집기 밖의 버튼을 누른 뒤에는 캔버스를 한 번 눌러야 스페이스가 듣는다(E10), 3D에서는 휠 확대도 "같은 자리"의 기억을 끝낸다(E11).
