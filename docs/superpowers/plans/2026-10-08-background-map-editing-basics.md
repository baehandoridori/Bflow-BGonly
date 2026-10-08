# 배경 도면 ① 평면 편집 기본기 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 평면 도면에 휠 확대·축소와 전체 맞춤, 그리자마자 이름 짓기, 가까운 도형에 붙는 스냅, 다각형 점 편집을 더해 v1.131.0으로 만든다(저장 자료·운영 DB·3D 화면 변경 없음).

**Architecture:** 계산은 모두 three.js·DOM 없는 순수 모듈(`mapDocument.ts`의 보기 계산, `mapGeometry.ts`의 도형 계산, 새 `mapSnap.ts`·`mapPlanGesture.ts`·`mapPlanEdit.ts`)에 두고 `node --test`로 값을 고정한다. 편집기(`BackgroundMapEditor.tsx`)는 포인터 좌표를 구해 `previewPlanGesture`를 부르고 그 결과를 기존 제스처(`beginGesture → previewGesture → finishGesture`)로 보내기만 하며, 손잡이·안내선·이름 칸은 작은 조각 컴포넌트가 그린다. 문서 상태(리듀서·상태 모양)와 저장 형식은 바뀌지 않는다.

**Tech Stack:** Electron 33(Chromium 130) · React 18 · TypeScript · SVG · node:test(Node 22 type-stripping) · Vite

---

## 모든 Task 공통 규칙

- **작업 위치**: `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`, 브랜치 `claude/bg-map-editing-basics`. 다른 워크트리·상위 checkout은 건드리지 않는다.
- **계약은 설계 문서다**: `docs/superpowers/specs/2026-10-08-background-map-editing-basics-design.md`(아래 "설계"). 머리말의 용어(화면 배율값·제스처·초안)와 각 Task의 **Read first**에 적힌 절을 먼저 읽는다. 설계에 적히지 않은 동작은 만들지 않는다. 이 계획과 설계가 어긋나면 설계가 맞다 — 멈추고 보고한다.
- **줄 번호**: 설계와 이 계획의 `:419` 같은 번호는 기준 커밋(d8325afb)의 것이다. Task가 지나면 밀리므로 **인용한 코드로 찾는다**. 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다.
- **편집기 한눈에**: `BackgroundMapEditor.tsx`는 컴포넌트 하나다. `doc = useBackgroundMapDocument()`는 동기 저장소다(`doc.getState()`는 방금 보낸 것까지 반영된 값, `doc.beginGesture/previewGesture/finishGesture/cancelGesture`, `doc.update`, `doc.select`, `doc.setViewport`). `current`는 지금 도면(편집 중이면 초안 값), `view`는 그 도면의 보기 값 `{ x, y, zoom, selectedId }`, `selected`는 고른 노드, `canEdit`은 편집 중이고 저장 중이 아님, `pointerRef.current`는 눌려 있는 포인터의 세션(`PointerSession`), `useEvent`(:60-64)는 늘 최신 렌더의 처리기를 부르는 고정 함수다. 지금 동작의 요약은 설계 2절 표에 있다.
- **명령**: 테스트 파일 하나 `node --test tests/<file>.test.ts` · `npm run typecheck` · 배경 묶음 `npm run test:background`. 시작 기준(커밋 d5c6997f에서 잰 값): **tests 235 / pass 232 / fail 0 / skipped 3**. skipped 3은 DB 계약 테스트가 `BFLOW_PGLITE_MODULE` 없이 건너뛰는 것으로 정상이다. 매 Task 뒤 기대: 테스트 수가 직전보다 많고(테스트를 더한 Task) 또는 같고(배선만 한 Task), fail 0, skipped 3.
- **테스트 규칙(Node type-stripping)**: `.ts` 확장자를 붙인 상대 import, 지울 수 있는 TypeScript만(enum·namespace·매개변수 속성 금지), 경로 별칭(`@/`) 금지. 타입은 반드시 `import type { … }`으로 가져온다 — 타입 제거 실행에서는 `import { 타입 }`이 지워지지 않아 `does not provide an export named …`로 파일 전체가 실패한다(없는 export 때문에 나는 '기대한 실패'와 문구가 같다. 구현한 뒤에도 남아 있으면 import부터 본다. `npm run typecheck`는 잡지 못한다). 새 `.ts` 모듈도 같다. `.tsx`는 node 테스트에서 import할 수 없다. `npm run typecheck`는 `tests/background*.test.ts`를 검사하지 않으므로 테스트의 타입 실수는 실행으로만 드러난다. `.tsx`에서 `.ts`를 import할 때는 기존처럼 확장자 없이 쓴다(`'./mapGeometry'`).
- **테스트 먼저**(@superpowers:test-driven-development): 순수 함수는 실패하는 테스트 → 구현 순서. 없는 export를 import한 테스트 파일은 `SyntaxError: The requested module … does not provide an export named '…'`(새 파일이면 `ERR_MODULE_NOT_FOUND`)로 **파일 전체가** 실패한다 — 그것이 기대하는 실패다. 편집기 배선은 순수 테스트로 잡을 수 없으므로 Task 끝의 **자가 점검(grep)** 으로 조각이 글자 그대로 있는지 본다. 그 조각들은 Task 12의 앵커 테스트가 고정하니, 설계의 코드 블록을 옮길 때 글자를 바꾸지 않는다.
- **하지 않는 것**: dev 서버·Electron·미리보기 창을 띄우지 않는다(`npm run dev*`, `npm run preview:electron`, `npm run build` 금지). 화면 확인은 **오케스트레이터의 엔진 확인**(관문 A·B, 최종 수동 검증)이다. 배포·PR·머지도 하지 않는다.
- **건드리지 않는 파일**: `types.ts`, `domain.ts`, `mapSpatial.ts`, `mapEditSession.ts`, `useBackgroundMapDocument.ts`, `mapWorkflow.ts`, `mapCanvas.ts`, `mapPlanPreview.ts`, `BackgroundMapPlanPreview.tsx`, `BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapCameraGizmo.ts`, `electron/**`, `DEVLOG/migrations/**`, `src/features/playground/featureFlag.ts`, `CLAUDE.md`.
- **커밋**: Task마다 한 번, 그 Task의 **Files**만 `git add` 한다. 형식: `git commit -m "<한글 메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. 줄 끝은 각 파일의 지금 상태 그대로 둔다(작업 트리에서 `package.json`·`package-lock.json`·`AGENTS.md`·`ROADMAP.md`·라운드 계획은 CRLF, 나머지는 LF). 파일 전체의 줄 끝을 바꾸지 않는다.
- **이 계획 파일**: 아직 추적되지 않는 파일이다(`git status`의 `??`). **오케스트레이터가 Task 1 전에** 이 파일 하나만 커밋한다(`문서: 배경 도면 ① 평면 편집 기본기 구현 계획`) — Task 13이 추적되는 문서 둘에 이 계획의 위치와 링크를 적기 때문이다. Task 작업자는 이 파일을 고치지 않고, Task 13 Step 8의 경우가 아니면 `git add` 하지 않는다.

## File structure

새 파일

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapSnap.ts` | 스냅 대상 모으기, 가까이 있는 것만 거르기(닿는 거리), 옮기기·크기·점·회전의 붙이기와 정수 맞춤, 안내선 값 (순수, three.js·DOM 없음) |
| `src/features/backgrounds/mapPlanGesture.ts` | 평면 제스처 한 번의 미리보기: (시작 도면, 누른 점, 지금 점, 스냅) → (도면, 안내선) (순수) |
| `src/features/backgrounds/mapPlanEdit.ts` | 화면 크기 상수, 손잡이·점 손잡이 배치, 더블클릭 대상, 스냅 설정 읽기/쓰기 |
| `src/features/backgrounds/BackgroundMapNameBox.tsx` | 캔버스 위 이름 입력 칸(위치·포커스·Enter/Esc/blur) |
| `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` | 안내선, 회전·크기 손잡이, 점 손잡이를 그리는 SVG 조각(받은 값만 그린다) |
| `tests/backgroundMapSnap.test.ts` · `tests/backgroundMapPlanGesture.test.ts` · `tests/backgroundMapPlanEdit.test.ts` | 위 세 순수 모듈의 값 고정(설계 12.3·12.4·12.6) |
| `tests/backgroundMapEditorWiring.test.ts` | 편집기 배선의 소스 앵커 18개(설계 12.7) |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `mapDocument.ts` | `MAP_ZOOM_LIMITS.min` 0.1, `MAP_LABEL_SCALE_LIMITS`, `mapScreenScale`, `zoomMapViewportAt`, `wheelZoomFactor`, `MAP_FIT_MARGIN`, `fitMapViewport`. 리듀서·상태 모양은 그대로 |
| `mapGeometry.ts` | `nodeLocalPoint`·`resizeSpaceTo`(기존 `resizeSpace`를 둘로), `nodeResizeCorner`, `placeMapNode`, `replaceMapNode`(공개·전 종류), `renameMapNode`, `nodeNameAnchor`, 다각형 점 함수 다섯 개 |
| `BackgroundMapEditor.tsx` | 휠 효과·맞춤·키, 세션 필드와 누름 기록, 창 단위 처리기 둘(캔버스 밖 누름 / 끌기에 쓴 Alt), `pointerMove`를 `previewPlanGesture` 호출로, 넘기기를 `click`으로, 더블클릭을 SVG 한 곳으로, 이름 칸·안내선·점 손잡이 배선, 스냅 버튼, 모양 줄, 문구 |
| `backgrounds-map.css` | 설계 10.1의 새 클래스 9종 |
| `tests/backgroundMapDocument.test.ts` · `tests/backgroundMapGeometry.test.ts` | 설계 12.1·12.2·12.5 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · `AGENTS.md` · `ROADMAP.md` · `DEVLOG/background-3d-opus-handoff-2026-10-07.md` · `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md` | 버전 1.131.0, 업데이트 내역, 문서(설계 14절). `DEVLOG/background-library-verification-2026-09-21.md`는 수동 검증 결과가 필요하므로 오케스트레이터가 쓴다 |

**import 방향(거꾸로 가지 않는다)**: `mapPlanGesture.ts` → `mapSnap.ts` → `mapGeometry.ts` → `mapSpatial.ts`. `mapPlanEdit.ts` → `mapSpatial.ts`. 조각 컴포넌트와 편집기는 이 모듈들을 읽기만 한다. 3D 파일(`BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`)은 새 모듈을 import하지 않는다.

Task와 설계 15절의 일곱 단계: ①=Task 1 · ②=Task 2–3 · ③=Task 4–5 · ④=Task 6–7 · ⑤=Task 8–9 · ⑥=Task 10–11 · ⑦=Task 12–13. 둘로 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "편집기 배선" 커밋의 경계다(⑤는 '이름 칸'과 '더블클릭', ⑦은 '앵커'와 '버전·문서').

---

## Chunk 1: 바탕과 확대·축소 (F9)

### Task 1: 화면 배율값·포인터 기준 확대·전체 맞춤 계산

**Files:**
- Modify: `src/features/backgrounds/mapDocument.ts` (`MAP_ZOOM_LIMITS` :44, `zoomMapViewport` :173-179 옆에 새 export)
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx` (`labelScale` :163 한 줄과 import :11만)
- Test: `tests/backgroundMapDocument.test.ts`

**Read first:** 설계 3.1, 4.2(식과 값 표), 12.1, 12.2, 1.3의 R1 · `mapDocument.ts` 전체 · `mapSpatial.ts:259-270`(`mapPlanBounds`) · 테스트 파일 :1-25(픽스처 `mapA`·`run`·`opened`·`valueOf`), :335-342.

- [ ] **Step 1: 고정 값 한 줄을 바꾼다(12.1)** — `tests/backgroundMapDocument.test.ts:339`의 `assert.equal(zoomMapViewport(home, 0.001).zoom, 0.25)` → `0.1`. 기존 단언 가운데 손대는 것은 이 한 줄뿐이다(:279 문서 키, :253-275 보기 값 모양, :337-341의 나머지는 그대로 통과해야 한다).
- [ ] **Step 2: 새 테스트를 쓴다(12.2)** — import에 `MAP_ZOOM_LIMITS, MAP_LABEL_SCALE_LIMITS, MAP_FIT_MARGIN, mapScreenScale, zoomMapViewportAt, wheelZoomFactor, fitMapViewport`(mapDocument)와 `mapPlanBounds`(mapSpatial)를 더한다. `home = { x: 0, y: 0, zoom: 1, selectedId: 'kept' }`. 소수 기대값은 1e-12 안에서 비교한다.
  - `zoomMapViewportAt`: `(home, 2, {500, 340})` → `{ x: 250, y: 170, zoom: 2, selectedId: 'kept' }`이고 `zoomMapViewport(home, 2)`와 같다 / `(home, 2, {0, 0})` → `{ x: 0, y: 0, zoom: 2 }` / `(home, 2, {1000, 680})` → `{ x: 500, y: 340, zoom: 2 }` / `(home, 0.5, {250, 170})` → `{ x: -250, y: -170, zoom: 0.5 }` / 임의의 기준점 세 개에서 `(anchor.x − x) × zoom`, `(anchor.y − y) × zoom`이 전후 같다 / 한계(zoom 4에서 ×2, zoom 0.1에서 ×0.5)·`NaN` 배율·`NaN` 기준점은 **받은 객체 그대로**(`assert.equal`) / `selectedId` 유지.
  - `wheelZoomFactor(deltaY, deltaMode, pinch)`: `(100, 0, false)` → 0.8187307530779818 / `(-100, 0, false)` → 1.2214027581601699 / `(3, 1, false)` → 0.9084640160687062 / `(1000, 0, false)` → 0.697676326071031 / `(2, 0, true)` → 0.9801986733067553 / `(100, 0, true)` → 0.8187307530779818 / `(0, …)` → 1 / `(NaN, …)` → 1 / `f(d) × f(−d) ≈ 1` / 쪽 단위: `(0.25, 2, false)` → 0.8187307530779818, `(1, 2, false)` → 0.697676326071031.
  - `fitMapViewport`: 빈 도면과 기본 영역 안의 방 하나 → `{ x: 0, y: 0, zoom: 1 }`(deepEqual) / 방(x −500, y 100, 500×100) → zoom ≈ 0.641026, x ≈ −560, y ≈ −190.4(1e-3) / 방(x 50000, y 0, 100×100) → `zoom === 0.1`, x ≈ 21052, y ≈ −3060(1e-6) / 위로만 나간 방(x 100, y −300, 100×100): `B = mapPlanBounds(map)`, `g = MAP_FIT_MARGIN × Math.max(B.width, B.height × 1000 / 680)`일 때 viewBox 위쪽 `y ≈ −300 − g`, 아래쪽 `y + 680 / zoom ≈ 680`(아래에는 여백 없음) / 좌표가 `NaN`인 카메라를 더해도 결과가 같다 / 한계에 걸리지 않은 경우마다 viewBox(`x, y, 1000/zoom, 680/zoom`)가 `mapPlanBounds`를 포함한다.
  - `mapScreenScale(zoom, canvas)`: `(1, 1000×680)` → 1 / `(1, 500×680)` → 2 / `(1, 2000×680)` → 1 / `(2, 1000×680)` → 0.5 / `(2, 0×0)` → 0.5(`1 / zoom`). `MAP_LABEL_SCALE_LIMITS.max === 1 / MAP_ZOOM_LIMITS.min`, `MAP_ZOOM_LIMITS` deepEqual `{ min: 0.1, max: 4 }`, `MAP_FIT_MARGIN === 0.04`.
  - **그리기 + 이름 = 되돌리기 한 단계**(리듀서): `begin-editing` → `gesture-begin` → `gesture-preview`(공간 하나를 더한 도면) → `gesture-finish` → `update`(그 공간 이름을 바꾼 도면, `history: false`). 확인: `past.length === 1`, `value`의 공간 이름이 새 이름, `undo` 뒤 `value`에 그 공간이 없음, `redo` 뒤 **새 이름의** 공간이 돌아옴. *이 테스트는 지금 코드로도 통과한다 — Task 8의 이름 확정이 기대는 동작을 못 박아 두는 것이다.*
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/backgroundMapDocument.test.ts` → 파일 전체가 `does not provide an export named 'MAP_FIT_MARGIN'`(또는 첫 번째 없는 이름)로 실패.
- [ ] **Step 4: `mapDocument.ts`를 구현한다** (리듀서·상태 모양·`zoomMapViewport`는 손대지 않는다)
  - `export const MAP_ZOOM_LIMITS = { min: 0.1, max: 4 } as const;` — min 0.25 → 0.1.
  - `export const MAP_LABEL_SCALE_LIMITS = { min: 0.4, max: 1 / MAP_ZOOM_LIMITS.min } as const;` — `{ 0.4, 10 }`. 상한을 숫자 10으로 쓰지 않는다.
  - `export function mapScreenScale(zoom: number, canvas: { width: number; height: number }): number;` — `1 / (Math.min(canvas.width / MAP_PLAN_EXTENT.width, canvas.height / MAP_PLAN_EXTENT.height) × zoom)`. `canvas` 값이 0 이하이거나 유한하지 않으면 1000×680으로 계산.
  - `export function zoomMapViewportAt(viewport: MapViewport, factor: number, anchor: BackgroundPoint): MapViewport;` — `zoom′ = clamp(zoom × factor)`. `zoom′`가 유한하지 않거나 `zoom`과 같거나 `anchor`가 유한하지 않으면 받은 객체. 아니면 `x′ = anchor.x − (anchor.x − x) × zoom / zoom′`, y도 같게.
  - `export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number;` — 유한하지 않으면 1. `거리 = deltaY × (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)`. `pinch`면 `Math.exp(−clamp(거리, −20, 20) × 0.01)`, 아니면 `Math.exp(−clamp(거리, −180, 180) × 0.002)`.
  - `export const MAP_FIT_MARGIN = 0.04;`
  - `export function fitMapViewport(map: BackgroundMap): Pick<MapViewport, 'x' | 'y' | 'zoom'>;` — `B = mapPlanBounds(map)`, `g = MAP_FIT_MARGIN × Math.max(B.width, B.height × 1000 / 680)`. 왼쪽·위·오른쪽·아래 가운데 **기본 영역(0~1000 × 0~680) 밖으로 나간 쪽에만** `g`를 더한 상자 T. `zoom = clamp(Math.min(1000 / T.width, 680 / T.height))`, `x = T 가운데 x − 1000 / (2 × zoom)`, `y = T 가운데 y − 680 / (2 × zoom)`.
- [ ] **Step 5: 편집기의 `labelScale`만 바꾼다** — :163을 `const screenScale = mapScreenScale(view.zoom, canvasSize);`와 `const labelScale = Math.min(MAP_LABEL_SCALE_LIMITS.max, Math.max(MAP_LABEL_SCALE_LIMITS.min, screenScale));` 두 줄로. `screenScale`은 뒤 Task들의 손잡이·스냅·점 손잡이가 모두 쓰는 **하나뿐인** 값이다(따로 계산하지 않는다).
- [ ] **Step 6:** `node --test tests/backgroundMapDocument.test.ts` → 전부 통과.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음.
- [ ] **Step 8:** `npm run test:background` → tests 235보다 많음, fail 0, skipped 3.
- [ ] **Step 9: 커밋** — `mapDocument.ts`, `BackgroundMapEditor.tsx`, `tests/backgroundMapDocument.test.ts` / `배경 도면: 화면 배율값과 포인터 기준 확대·전체 맞춤 계산 추가 (최소 확대 10%)`

**v1.130.0과 달라지는 것(되살리지 말 것):** 최소 확대 25% → 10%. 글자 크기 상한 4 → `1 / 최소 확대`(10).
**이 Task가 끝나면 편집기는:** − 버튼으로 10%까지 축소된다. 1000×680 이상 캔버스에서 이름 글자 크기는 그대로다. '맞춤'은 아직 초기화이고 나머지는 v1.130.0과 같다.

### Task 2: 화면 크기 상수와 손잡이 배치 (`mapPlanEdit.ts`)

**Files:**
- Create: `src/features/backgrounds/mapPlanEdit.ts`
- Test (Create): `tests/backgroundMapPlanEdit.test.ts`

**Read first:** 설계 3.2(`planNodeHandles` 규칙 전부 — 크기 네모가 없는 경우·비켜 서는 경우·카메라 거리·점선), 12.6 첫 묶음 · 편집기 :647-659(배율 1에서 재현해야 하는 지금 값) · `mapSpatial.ts:107-111`(`projectCameraToPlan`의 `direction`·`vertical`).

- [ ] **Step 1: 테스트를 쓴다(12.6의 `planNodeHandles`)**
  - 배율 1 = 지금 값: 방 200×100 → `{ kind: 'box', radius: 7, lift: 28, resize: { x: 194, y: 94, size: 12, shifted: false } }` / 기호는 `lift: 25` / 수평 카메라 → `{ kind: 'camera', distance: 80, radius: 7, guide: null }` / pitch 60° 카메라 → `guide ≈ { from: 40, to: 73 }` / 수직(pitch 90) 카메라 → `guide = { from: 18, to: 73 }`.
  - 배율 0.25와 4에서 화면 크기 불변: `radius / s === 7`, `lift / s === 28`, `resize.size / s === 12`, `(width − resize.x) / s === 6`.
  - 카메라 거리: 배율 1 → 80, 2 → 80, 5 → 200.
  - 긴 변이 화면 12px 미만이면 `resize: null`: 10×10 기호는 배율 1에서 `null`, 0.5에서 있다 / 400×12 벽은 배율 1에서 있다.
  - 비켜 서기(배율 1, 방 200×100): 점이 `(0,0)(1,0)(1,1)(0,1)`인 다각형 + `vertexHandles` 참 → `{ x: 208, y: 108, size: 12, shifted: true }`(**`null`이 아니다**) / 같은 다각형 + 거짓 → `{ x: 194, y: 94, size: 12, shifted: false }` / 모서리 점을 `(0.9, 1)`로 옮긴 다각형 + 참 → `shifted: false` / 점이 `(0.93, 0.9)`이면 `shifted: true` / 배율 2 → `{ x: 216, y: 116, size: 24, shifted: true }` / 사각형·타원·기호는 `vertexHandles`와 무관하게 `shifted: false`.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapPlanEdit.test.ts` → `ERR_MODULE_NOT_FOUND`(mapPlanEdit.ts 없음).
- [ ] **Step 3: 구현한다** (import는 `./types.ts`의 타입과 `./mapSpatial.ts`뿐)
  ```ts
  /** Sizes in CSS pixels unless noted. Multiplied by the screen scale they stay constant on screen. */
  export const MAP_EDIT_MARK = {
    handle: 7, spaceLift: 28, symbolLift: 25, resize: 12, resizeMinNode: 12, resizeShift: 14,
    cameraOffset: 40, cameraFan: 80 /* map units */, cameraBody: 12 /* map units */, cameraRing: 18 /* map units */,
    vertex: 5, vertexHit: 9, edge: 5, edgeMin: 28, vertexMinNode: 32,
    guideOverhang: 8, polygonDot: 4, nameBoxCameraDrop: 30,
  } as const;
  export type PlanNodeHandles =
    | { kind: 'camera'; distance: number; radius: number; guide: { from: number; to: number } | null }
    | { kind: 'box'; radius: number; lift: number; resize: { x: number; y: number; size: number; shifted: boolean } | null };
  export function planNodeHandles(node: BackgroundNode, scale: number, vertexHandles: boolean): PlanNodeHandles;
  ```
  - 공간·기호(s = `scale`): `radius = 7s`, `lift = 28s`(공간) / `25s`(기호).
  - 크기 네모 보통: `{ x: width − 6s, y: height − 6s, size: 12s, shifted: false }`. **`null`은 하나뿐**: `Math.max(width, height) / s < 12`.
  - 비켜 서기: `vertexHandles`가 참이고 다각형 공간의 어떤 점 p가 `(1 − p.x) × width < 15s && (1 − p.y) × height < 15s`이면 `{ x: width + 8s, y: height + 8s, size: 12s, shifted: true }`.
  - 카메라: `radius = 7s`, `distance = Math.max(80, 40s)`. `fan = 80 × Math.hypot(direction.x, direction.y)`, `body = 수직이면 18, 아니면 12`. `fan < distance − 8s`이면 `guide = { from: Math.max(body, fan), to: distance − 7s }`, 아니면 `null`.
  - 이 Task에서는 여기까지만 만든다. `planVertexHandles`는 Task 10, `doubleClickNodeId`는 Task 9, 스냅 설정 읽기/쓰기는 Task 7. (비켜 서기 **규칙**은 여기서 끝내고, 편집기가 `vertexHandles`를 참으로 넘기는 것은 Task 11이다.)
- [ ] **Step 4:** `node --test tests/backgroundMapPlanEdit.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: 화면 크기 상수와 손잡이 배치 계산(mapPlanEdit) 추가`

**이 Task가 끝나면 편집기는:** Task 1과 같다(새 모듈을 아직 쓰지 않는다).

### Task 3: 휠 확대·맞춤·키와 화면 크기 고정 손잡이 (편집기 배선)

**Files:**
- Create: `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` (`MapNodeHandles`만)
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx` (크기 재기 효과 :171-180 다음에 휠 효과, `zoomBy` :504-508 옆에 `fitView`, `keyboard` :509-522, 다각형 미리보기 점 :645, 손잡이 JSX :646-659, 아래 줄 :678)

**Read first:** 설계 4.1, 4.3(코드 블록과 '등록 위치 결정'), 4.4, 4.5, 9(`MapNodeHandles`), 12.7의 1·2·11·13 · 편집기 :60-64(`useEvent`), :171-180, :413-418(`pointFrom`), :504-522, :645-659, :678.

이 Task에는 새 순수 테스트가 없다(계산은 Task 1·2에서 고정했다). 배선은 Step 8의 자가 점검과 Task 12의 앵커 1·2·11·13으로 지킨다.

- [ ] **Step 1: `MapNodeHandles`를 만든다** — 시그니처: `export function MapNodeHandles({ node, scale, vertexHandles, onHandleDown }: { node: BackgroundNode; scale: number; vertexHandles: boolean; onHandleDown(event: ReactPointerEvent<SVGElement>, handle: 'resize' | 'rotate'): void }): JSX.Element;` `planNodeHandles(node, scale, vertexHandles)`가 준 값만 그린다. 마크업은 지금 것 그대로: `<g className="bmap-handles" transform=…>`(카메라는 :650, 공간·기호는 :656의 transform), `.bmap-camera-guide`(x1 `guide.from`, x2 `guide.to`), `.bmap-camera-direction`(cx `distance`, r `radius`), 줄기 `(width/2, 0) → (width/2, −lift)`, `.bmap-rotate-handle`(cx `width/2`, cy `−lift`, r `radius`), `.bmap-resize-handle`(x, y, `size`×`size`). `resize`가 `null`이면 네모를 그리지 않고, `resize.shifted`면 네모 앞에 `<line x1={width} y1={height} x2={resize.x} y2={resize.y} />`를 하나 더 그린다.
- [ ] **Step 2: 편집기의 손잡이 JSX(:646-659의 IIFE 둘)를 바꾼다** — `{selected && canEdit && !selected.locked && <MapNodeHandles node={selected} scale={screenScale} vertexHandles={false} onHandleDown={(event, handle) => pointerDown(event, selected, handle)} />}`. (`vertexHandles={false}`는 Task 11에서 바뀐다.) 주석 "Handles are drawn last…"는 남긴다.
- [ ] **Step 3: 다각형 미리보기 점(:645)** — `r={4 / view.zoom}` → `r={MAP_EDIT_MARK.polygonDot * screenScale}`.
- [ ] **Step 4: 휠** — 설계 4.3의 코드 블록(`const onWheel = useEvent((event: WheelEvent) => …)`와 `useEffect`)을 그대로 옮긴다. 지켜야 할 것: 네이티브 리스너를 **SVG에** `{ passive: false }`로, 의존값 `[onWheel, current?.id, mode]`, 처리기 첫 줄이 `event.preventDefault()`(누르고 있거나 제스처 중이면 그 뒤에 돌아간다), 보기 값은 `mapViewport(doc.getState(), current.id)`에서, `zoomed !== live`일 때만 `updateView`. React의 `onWheel={…}` prop은 쓰지 않는다(passive라 `preventDefault`가 듣지 않는다).
- [ ] **Step 5: `fitView`** — `function fitView() { if (!current || pointerRef.current) return; updateView(fitMapViewport(current)); }`. `zoomBy`는 그대로 둔다.
- [ ] **Step 6: 아래 줄(:678)** — '맞춤' 버튼 `onClick={fitView}`, `title="그려 둔 것 전체가 보이게 맞춤 (0)"`. − 버튼에 `title="축소 (−)"`, ＋ 버튼에 `title="확대 (+)"`(`aria-label`은 그대로). `updateView({ x: 0, y: 0, zoom: 1 })`은 소스에 남기지 않는다.
- [ ] **Step 7: 키(4.4)** — `keyboard()`의 Escape 분기 다음, **`if (target.closest(interactive)) return;` 앞**에 '평면 단축키' 묶음을 둔다(`const target = …` 줄을 묶음 위로 올린다). 조건(모두): `mode === 'plan'` · Ctrl·Meta·Alt 없음 · `!event.nativeEvent.isComposing` · `target`이 `input, textarea, select, [contenteditable]:not([contenteditable="false"])` 안이 아니고 `dialog` 안이 아님. 키: `+` 또는 `=` → `preventDefault`, `zoomBy(1.25)` / `-` → `preventDefault`, `zoomBy(0.8)` / `0` → `preventDefault`, `fitView()`. 처리한 키는 거기서 `return`. (F2는 Task 8에서 이 묶음에 더한다.) Ctrl/Meta 조합은 잡지 않는다(앱 전체 배율 단축키다).
- [ ] **Step 8: 자가 점검** — 편집기에서: `addEventListener('wheel', onWheel, { passive: false })` 1곳 · `onWheel={` 0곳 · `fitMapViewport(` 1곳 이상 · `updateView({ x: 0, y: 0, zoom: 1 })` 0곳 · `zoomBy(1.25)`의 첫 위치가 `target.closest(interactive)`보다 앞줄. 두 파일에 `<pattern` 0곳.
- [ ] **Step 9:** `npm run typecheck` → 오류 없음.
- [ ] **Step 10:** `npm run test:background` → Task 2와 같은 수, fail 0, skipped 3.
- [ ] **Step 11: 커밋** — 두 파일 / `배경 도면: 휠 확대·축소, 전체 맞춤, + − 0 키, 화면 크기 고정 손잡이`

**v1.130.0과 달라지는 것(되살리지 말 것):** '맞춤'은 초기화가 아니라 전체 보기다(기본 영역 안의 도면에서만 결과가 100%·(0, 0)으로 같다). 손잡이는 도면 단위가 아니라 화면 크기 고정이다. 화면에서 긴 변이 12px보다 작은 도형에는 크기 네모가 없다. SVG 위의 휠은 늘 `preventDefault`한다(좁은 창에서 페이지가 내려가지 않는다). + − 0은 버튼에 포커스가 있어도 듣는다.
**이 Task가 끝나면 편집기는:** 휠로 포인터 기준 확대·축소(보기·편집 모두), '맞춤'과 `0`은 전체 보기, `+`/`=`/`-` 키, 손잡이는 확대와 무관한 크기. 끌기 계산은 아직 v1.130.0 그대로다(크기 네모를 가운데에서 벗어나 누르면 첫 움직임에 모서리가 튄다 — Task 5에서 없어진다).

---

## Chunk 2: 제스처 모듈과 스냅 (F4)

### Task 4: 크기 바꾸기 보조 함수와 노드 바꿔 넣기 (`mapGeometry.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapGeometry.ts` (`resizeSpace` :13-20, 비공개 `replaceNode` :127-128과 그 호출 :145·:167, 새 export)
- Test: `tests/backgroundMapGeometry.test.ts`

**Read first:** 설계 5.3(`replaceMapNode`), 6.3 전부, 12.5의 앞 네 묶음, 12.1 끝 문단 · `mapGeometry.ts:6-57`, `:127-168` · 테스트 :13-20, :42-50, :69-75(손대지 않고 통과해야 하는 `resizeSpace` 고정 값).

- [ ] **Step 1: 테스트를 쓴다(12.5)**
  - `resizeSpaceTo` / `nodeLocalPoint`: 회전 0·90·37에서 `resizeSpace(node, p)`와 `resizeSpaceTo(node, nodeLocalPoint(node, p).x, nodeLocalPoint(node, p).y)`가 같은 값. 회전 0의 방(x 244.65, y 120.3)은 어떤 크기로 바꿔도 결과의 `x === 244.65`, `y === 120.3`.
  - `nodeResizeCorner`: 회전 0 → `{ x: x + width, y: y + height }`(`===`). 방(100, 100, 60×40)의 회전 90 → (110, 150), 180 → (100, 100), 270 → (150, 90)(1e-9). `resizeSpace(node, nodeResizeCorner(node))`의 가로·세로가 처음 값과 1e-9 안(회전 0, 90, 37).
  - `placeMapNode`: 저장 x·y가 정확히 준 값(`===`) / 공간이면 소속 항목이 `moveMapNode(map, id, 같은 차이)`와 같은 자리(1e-9) / 잠긴·없는 노드는 `map` 그대로(`===`).
  - `replaceMapNode`: 공간의 x를 바꿔 넣어도 소속 카메라·기호 객체가 `===`로 그대로(같은 변화를 `transformMapSpace`에 주면 움직이는 것과 대비).
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapGeometry.test.ts` → `does not provide an export named 'nodeLocalPoint'`(또는 첫 번째 없는 이름)로 파일 실패.
- [ ] **Step 3: 구현한다**
  - `export function replaceMapNode(map: BackgroundMap, next: BackgroundNode): BackgroundMap;` — 비공개 `replaceNode`를 모든 노드 종류로 넓혀 내보낸다. `applyNodeWorldPose`의 두 호출도 이것을 쓰고 `replaceNode`는 지운다. 소속 항목은 따라가지 않는다(문서 주석은 5.3의 것).
  - `export function nodeLocalPoint(node: BackgroundSpace | BackgroundSymbol, world: BackgroundPoint): BackgroundPoint;` — 회전이 **정확히 0**(`rotation === 0`)이면 `(world.x − x, world.y − y)`. 아니면 지금 :14-16의 계산을 같은 순서로.
  - `export function resizeSpaceTo<T extends BackgroundSpace | BackgroundSymbol>(space: T, width: number, height: number): T;` — 길이를 10~100000으로 자른다. 회전 0이면 `{ ...space, width, height }`(x·y는 받은 값 그대로). 아니면 지금 :18-19의 식.
  - `resizeSpace(space, pointer)` 본문 → `const local = nodeLocalPoint(space, pointer); return resizeSpaceTo(space, local.x, local.y);`
  - `export function nodeResizeCorner(node: BackgroundSpace | BackgroundSymbol): BackgroundPoint;` — 회전 0이면 `(x + width, y + height)`. 아니면 고정점(:14-15) + `rotate((width, height), rotation)`.
  - `export function placeMapNode(map: BackgroundMap, id: string, position: BackgroundPoint): BackgroundMap;` — 공간이면 `transformMapSpace(map, { ...selected, x: position.x, y: position.y })`, 그 밖은 `replaceMapNode`. 없는·잠긴 노드는 `map`.
- [ ] **Step 4:** `node --test tests/backgroundMapGeometry.test.ts` → 새 테스트와 기존 고정 값(:13-20, :42-50, :69-75, :97-104) 모두 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: 크기 바꾸기 보조 함수 분리 — 회전 0은 저장 위치 그대로, 노드 바꿔 넣기·정확히 놓기`

**v1.130.0과 달라지는 것(되살리지 말 것):** 회전이 정확히 0인 도형의 크기 바꾸기는 가운데를 거치지 않는다. 예전 식(`x + width/2 − width/2`)은 마지막 자리를 흔들었다(`(244.65 + 30) − 30` = 244.64999999999998).
**이 Task가 끝나면 편집기는:** Task 3과 같다(회전 0의 크기 바꾸기에서 저장 x·y가 비트까지 그대로라는 점만 다르다).

### Task 5: 평면 제스처 미리보기 모듈(스냅 없이)과 `pointerMove` 교체

**Files:**
- Create: `src/features/backgrounds/mapSnap.ts` (타입 네 개만), `src/features/backgrounds/mapPlanGesture.ts`
- Modify: `src/features/backgrounds/BackgroundMapEditor.tsx` (`pointerMove` :465-482, import :9, 안 쓰게 되는 `angle` :35)
- Test (Create): `tests/backgroundMapPlanGesture.test.ts`

**Read first:** 설계 3.3(타입, 표의 **왼쪽 칸**, '손잡이를 누른 자리는 결과에 들어가지 않는다' 문단), 6.2의 타입 선언부, 12.4의 '스냅 없음'·'순수성' 묶음, 15절 3번 · 편집기 :456-483 · Task 4의 함수.

- [ ] **Step 1: 테스트를 쓴다(12.4, 다섯째 인자 `null`)**
  - move = `moveMapNode(initial, id, delta)`와 같은 값.
  - 공간 resize = `transformMapSpace(initial, resizeSpace(node, nodeResizeCorner(node) + delta))` / **기호 resize** = `replaceMapNode(initial, resizeSpace(node, nodeResizeCorner(node) + delta))` / 카메라 resize = `initial`.
  - 카메라 rotate = 포인터 방향(카메라 (500, 340), `point (500, 440)` → `angle` 90) / 공간 rotate는 소속 카메라의 각도도 돌린다 / **기호 rotate**는 그 기호의 `rotation`만 바뀌고 다른 노드는 `===`.
  - draw = 최소 10인 상자가 `nodes` 끝에 붙는다(`start (100, 100)`, `point (103, 250)` → `{ x: 100, y: 100, width: 10, height: 150 }`).
  - 누른 자리는 결과에 들어가지 않는다: `start`와 `point`를 같은 만큼 옮기면 resize 결과가 같다 / `start`가 모서리에서 (14, 14) 떨어져 있어도 `delta`가 (0, 0)이면 가로·세로가 처음 값과 1e-9 안.
  - 순수성: 같은 인자면 같은 결과, 다른 점을 먼저 미리 본 뒤에도 같다 / `initial`을 바꾸지 않는다(전후 `JSON.stringify` 동일) / 없는 노드는 `null` / 잠긴 노드의 move는 `initial`과 같은 값 / `guides`는 늘 빈 배열.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapPlanGesture.test.ts` → `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 3: `mapSnap.ts`에 타입만 둔다** (상수와 함수는 Task 6). 주석에 `window.`·`document.`·`from 'three'` 같은 글자를 쓰지 않는다(Task 12의 앵커가 정규식으로 본다).
  ```ts
  /** A line things stick to: x = at ('x', a vertical line) or y = at. `from`/`to` is its extent along the other axis. */
  export type SnapLine = { axis: 'x' | 'y'; at: number; from: number; to: number };
  export type SnapGuide = SnapLine;
  export type SnapBox = { left: number; right: number; top: number; bottom: number };
  export type SnapCandidates = { x: readonly SnapLine[]; y: readonly SnapLine[]; points: readonly BackgroundPoint[] };
  ```
- [ ] **Step 4: `mapPlanGesture.ts`를 구현한다**
  ```ts
  export type PlanGesture =
    | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
    | { mode: 'draw'; node: BackgroundSpace };            // 'vertex' 는 Task 10 에서 더한다
  export type PlanGestureSnap = { candidates: SnapCandidates; /** map units */ tolerance: number; /** map units */ reach: number };
  export type PlanGesturePreview = { map: BackgroundMap; guides: SnapGuide[] };
  export function previewPlanGesture(gesture: PlanGesture, initial: BackgroundMap, start: BackgroundPoint,
    point: BackgroundPoint, snap: PlanGestureSnap | null): PlanGesturePreview | null;
  ```
  - `delta = point − start`. 노드는 `initial.nodes`에서 `nodeId`로 찾고 없으면 `null`.
  - move: `moveMapNode(initial, nodeId, delta)`.
  - draw: `{ ...node, x: min(start.x, point.x), y: min(start.y, point.y), width: max(10, abs(delta.x)), height: max(10, abs(delta.y)) }`를 `initial.nodes` 끝에.
  - resize: 카메라면 `initial`. 아니면 `corner = nodeResizeCorner(node) + delta` → `resizeSpace(node, corner)` → 공간은 `transformMapSpace(initial, resized)`, 기호는 `replaceMapNode`.
  - rotate: `각도(a, c) = Math.atan2(a.y − c.y, a.x − c.x) × 180 / Math.PI`, 가운데 = `(x + width/2, y + height/2)`. 카메라는 `angle = normalizeDegrees(각도(point, 카메라))`, 공간·기호는 `rotation = normalizeDegrees(node.rotation + 각도(point, 가운데) − 각도(start, 가운데))`. 공간은 `transformMapSpace`, 그 밖은 `replaceMapNode`.
  - 이 Task에서는 `snap`을 받기만 하고 모든 mode가 위(왼쪽 칸)대로 계산하며 `guides: []`를 돌려준다. 오른쪽 칸은 Task 7.
- [ ] **Step 5: 편집기의 `pointerMove`를 바꾼다** — 세션을 `PlanGesture`로 바꾸는 `planGestureOf(session)`를 더한다(draw는 `{ mode: 'draw', node: session.node }` — `session.node.type === 'space'`로 좁힌다, 나머지는 `{ mode, nodeId: session.node.id }`). `pan`·`click` 분기(:463-464)는 그대로 두고 그 아래(:465-482)를 `const preview = previewPlanGesture(planGestureOf(session), session.initial, session.start, point, null); if (!preview) return; doc.previewGesture(preview.map);`로 바꾼다. import에서 `resizeSpace`를 빼고, 쓰지 않게 된 `angle`(:35)을 지운다(`normalizeAngle`은 '90° 회전' 버튼이 쓴다. `moveMapNode`·`transformMapSpace`는 속성 칸이 쓰므로 남는다).
- [ ] **Step 6: 자가 점검** — 편집기에 `resizeSpace(` 0곳, `moveMapNode(next` 0곳, `pointerMove` 안에서 `previewPlanGesture(`가 `doc.previewGesture(`보다 앞.
- [ ] **Step 7:** `node --test tests/backgroundMapPlanGesture.test.ts` → 통과.
- [ ] **Step 8:** `npm run typecheck` → 오류 없음.
- [ ] **Step 9:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 10: 커밋** — 네 파일 / `배경 도면: 평면 제스처 미리보기를 순수 모듈로 옮김 (크기 손잡이가 누른 자리로 튀지 않게)`

**v1.130.0과 달라지는 것(되살리지 말 것):** 크기 바꾸기는 모서리를 포인터 자리로 가져가지 않고, 오른쪽 아래 모서리에 **움직인 만큼**을 더한다(`resizeSpace(node, point)`로 되돌리지 않는다).
**이 Task가 끝나면 편집기는:** 옮기기·그리기·크기·회전이 v1.130.0과 같은 값을 낸다. 달라진 것은 크기 네모를 가운데에서 벗어나 눌러도 첫 움직임에 모서리가 튀지 않는다는 점 하나다.

### Task 6: 스냅 계산 모듈 (`mapSnap.ts`)

**Files:**
- Modify: `src/features/backgrounds/mapSnap.ts`
- Test (Create): `tests/backgroundMapSnap.test.ts`

**Read first:** 설계 6.1(2~9번), 6.2 전부(세부 규칙 문단 하나하나가 구현 명세다), 6.4, 12.3 · `mapSpatial.ts:47-55`(`normalizeDegrees`·`normalizeSignedDegrees`), `:239-256`(`nodePlanOutline`) · `mapGeometry.ts:27-50`(소속 항목을 실어 나르는 조건 :32, :36).

- [ ] **Step 1: 테스트를 쓴다(12.3)** — 픽스처: 방 A = (100, 100, 144.65×80), 끄는 방 B = (300.4, 120.3, 60×40), 허용 6, 닿는 거리 48. 도면은 A와 끄는 방(그 줄에 적힌 방이 있으면 그것까지), 후보는 따로 적지 않으면 `collectSnapCandidates(map, snapTravellingIds(map, [끄는 id]))`. 손으로 만든 후보 선의 범위는 따로 적지 않으면 그 축의 기본 영역 전체(세로 선 `from 0, to 680`, 가로 선 `from 0, to 1000`). 왼쪽·위로 붙은 값과 정수로 맞춘 값은 `===`, 가운데·오른쪽·아래로 붙은 값은 1e-9.
  - `isQuarterTurn`: 0, 90, 180, 270, 360, −90, 89.995 → 참 / 30, 89.9, 45 → 거짓.
  - `nodeSnapBox`: 회전 0의 A는 `right === 244.65` / 회전 90의 방은 가로·세로가 바뀐 상자 / 회전 30은 가운데 한 점 / 기운(pitch) 기호는 가운데 한 점 / 카메라는 그 점 / 방(100, 100, 60×40)의 회전 180 → `{ left: 100, right: 160, top: 100, bottom: 140 }`(`===`), 회전 270 → `{ left: 110, right: 150, top: 90, bottom: 150 }`.
  - `nodeSnapSpan`: 회전 0·90·180·270의 방은 `nodeSnapBox`와 네 값이 `===` / 카메라는 그 점 / 회전 30의 방(500, 300, 80×40) → `{ left ≈ 495.359, right ≈ 584.641, top ≈ 282.679, bottom ≈ 357.321 }`(1e-3) / 기운 기호는 `nodePlanOutline`의 최소·최대.
  - `snapTravellingIds`: 공간 + 잠기지 않은 소속 카메라·기호 / 잠긴 소속 항목과 다른 공간의 항목은 제외 / 잠긴 공간은 자기만 / 카메라 하나는 자기만.
  - `collectSnapCandidates`: 테두리 4선(`x = 0, 1000`은 `from 0 to 680`, `y = 0, 680`은 `from 0 to 1000`) / 방마다 3 + 3선 / 돌려 놓은 방은 1 + 1선이고 그 선의 `from/to`는 한 점이 아니라 `nodeSnapSpan`의 범위 / 카메라 1 + 1선 / 제외한 id의 선은 없음 / `points`는 사각형·다각형 공간의 꼭짓점만(타원·기호·카메라 없음).
  - `snapMove` — 멀리 있는 것은 잡지 않는다: B를 `delta (−52, 300.4)` → `position = { x: 248, y: 421 }`, 안내선 없음. 같은 호출에 닿는 거리 1000 → `position.x === 244.65`.
  - `snapMove` — 닿는 거리 경계: 방 C = (300, 300, 60×40). `delta (−52, −72)`(틈이 정확히 48) → `{ x: 244.65, y: 228 }`(`===`), x 안내선 한 줄. `delta (−52, −71)` → `{ x: 248, y: 229 }`, 없음. 닿는 거리 0: `delta (−52, −120)`(맞닿음) → `x === 244.65`, `delta (−52, −119)` → `x === 248`. 닿는 거리 `NaN`·음수는 0과 같은 결과.
  - `snapMove` — 테두리 선도 같은 규칙(도면에 그 방 하나뿐이라 후보는 테두리 4선): 방(3.4, −200, 60×40)을 `delta (0, 0.2)` → `{ x: 3, y: -200 }`, 없음. 방(3.4, −80, 60×40)을 `delta (0, 0.2)` → `{ x: 0, y: -80 }`.
  - `snapMove` — 같은 값이라도 먼 선은 안내선에 들어가지 않는다: 방 E(100, 500, 80×60)를 더하고 B를 `delta (−198, 10.4)` → x 안내선이 `from 100`, `to 180`(E의 500~560까지 뻗지 않는다).
  - `snapMove` — B를 `delta (−52, 10.4)` → `{ x: 244.65, y: 131 }`(둘 다 `===`), x 안내선 한 줄(`at 244.65`, `from 100`, `to 180`) / `delta (−158, −1.9)`(가운데끼리) → `≈ { x: 142.325, y: 120 }`, 안내선 두 줄 / `delta (200.3, 300.3)` → `{ x: 501, y: 421 }`, 없음 / `delta (637, −117)`(테두리) → `≈ { x: 940, y: 0 }`, `y === 0` / 허용 0에서 `delta (−52, 10.4)` → `{ x: 248, y: 131 }`, 없음.
  - `snapMove` — 돌려 놓은 도형: 회전 30의 방(500, 300, 80×40)을 `(−366, −182)` → 가운데로 붙어 `≈ { x: 132.325, y: 120 }`. '가까이'는 윤곽으로: 회전 30의 방 G(280, 200, 200×100)를 `delta (−3.75, −108.4)` → `≈ { x: 276, y: 90 }`, y 안내선 한 줄 / `delta (50, −108.4)` → `{ x: 330, y: 92 }`, 없음. 상대가 돌려 놓은 도형: 후보가 G와 테두리뿐인 도면에서 방 H(600, 300, 60×40)를 `delta (−80.4, −68.6)` → `≈ { x: 520, y: 230 }`.
  - `snapMove` — 허용 거리 경계(정확히 6은 붙고 6.01은 안 붙음) / 더 가까운 후보가 이김 / 같은 값의 후보 둘이 모두 닿는 거리 안이면 안내선 범위가 둘을 덮음 / 같은 거리일 때의 순서: 끄는 방(300, 500, 20×20)을 `delta (−205, 0)`, 후보 `{ x: [x = 100, x = 110], y: [], points: [] }` → `position.x === 100` / id 둘을 넘기면 합친 상자의 가장자리로 붙고 `delta`가 공통 / 없는 `anchorId`·`movingIds`에 없는 기준·`NaN` 입력은 `null` / 입력 도면 불변(전후 `JSON.stringify`).
  - `snapPoint`: 점 후보가 선보다 우선 / 선에 붙는 축과 정수로 맞는 축이 섞인 경우 / 허용 0이면 정수 맞춤만 / **닿는 거리가 없다**: `withVertexNeighbours({ x: [], y: [], points: [] }, [(100, 100)])`에 점 (102.4, 600.3), 허용 6 → `{ x: 100, y: 600 }`(옆 점의 x에 붙는다) / 같은 후보에 점 (300.2, 102.4) → `{ x: 300, y: 100 }`(옆 점의 y에 붙는다 — 둘을 합쳐 12.3의 '옆 점의 x·y에 붙음').
  - `snapResize`: 회전 0에서 오른쪽 끝이 이웃의 왼쪽 끝에 붙고(`x + width`가 대상과 1e-9) 세로는 정수 / 회전 90에서 화면 y가 가로 길이를 정함 / 회전 30은 붙지 않고 두 길이 모두 정수 / 붙은 값이 10 미만이면 무시 / 100000 상한 / 기호도 같은 규칙 / 회전 0에서 `x`·`y`가 받은 값 그대로(`===`, 방 (244.65, 120.3, …)).
  - `snapResize` — 멀리 있는 이웃: 방(100, 100, 60×40), `corner (198.4, 140.3)`, 후보는 세로 선 `x = 200` 하나. 범위 `from 100, to 180`이면 `width === 100`, `from 400, to 480`이면 `width === 98`. 두 경우 모두 `height === 40`.
  - `snapResize` — 축 바꿈의 부호: 방(100, 100, 60×40). 회전 180, `corner (80.3, 90.4)`, 후보 `x = 75` → `width === 85`, `height === 50`, 결과 `x ≈ 75`, `y ≈ 90`. 회전 270, `corner (170.2, 69.6)`, 후보 `y = 65` → `width === 85`, `height === 60`.
  - `snapRotation`: 357.5 → 0 / 2.9 → 0 / 3.1 → 3.1 / 92 → 90 / −91 → 270 / 360 → 0 / 45.5 → 45.5 / `NaN` → `NaN`.
  - `sameSnapGuides`: 같은 값의 다른 배열 → 참, 한 필드라도 다르면 거짓.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapSnap.test.ts` → `does not provide an export named …`로 파일 실패.
- [ ] **Step 3: 구현한다** — three.js·DOM을 쓰지 않는다. 시그니처(설계 6.2):
  ```ts
  export const MAP_SNAP = { tolerancePx: 6, reachPx: 48, quarterTurn: 0.01, rotationStops: [0, 90, 180, 270], rotationCapture: 3 } as const;
  export function isQuarterTurn(rotation: number): boolean;
  export function nodeSnapBox(node: BackgroundNode): SnapBox;
  export function nodeSnapSpan(node: BackgroundNode): SnapBox;
  export function snapTravellingIds(map: BackgroundMap, movingIds: readonly string[]): Set<string>;
  export function collectSnapCandidates(map: BackgroundMap, excluded: ReadonlySet<string>): SnapCandidates;
  export function withVertexNeighbours(candidates: SnapCandidates, neighbours: readonly BackgroundPoint[]): SnapCandidates;
  export function snapMove(map: BackgroundMap, movingIds: readonly string[], anchorId: string, delta: BackgroundPoint,
    candidates: SnapCandidates, tolerance: number, reach: number): { position: BackgroundPoint; delta: BackgroundPoint; guides: SnapGuide[] } | null;
  export function snapPoint(point: BackgroundPoint, candidates: SnapCandidates, tolerance: number): { point: BackgroundPoint; guides: SnapGuide[] };
  export function snapResize<T extends BackgroundSpace | BackgroundSymbol>(node: T, corner: BackgroundPoint,
    candidates: SnapCandidates, tolerance: number, reach: number): { node: T; guides: SnapGuide[] };
  export function snapRotation(degrees: number, capture?: number): number;
  export function sameSnapGuides(a: readonly SnapGuide[], b: readonly SnapGuide[]): boolean;
  ```
  - `isQuarterTurn` — `t = normalizeDegrees(r) % 90`, `Math.min(t, 90 − t) < 0.01`.
  - `nodeSnapBox` — 카메라는 그 점. 90° 단위이고 기울지 않은 공간·기호: 0°·180° 쪽은 **저장 값에서 직접**(`left = x`, `right = x + width`, `top = y`, `bottom = y + height`), 90°·270° 쪽은 가운데에서 가로 ±`height/2`·세로 ±`width/2`(쪽은 `Math.round(normalizeDegrees(r) / 90) % 2`). 그 밖(자유 회전, pitch·roll이 0이 아닌 기호)은 가운데 한 점.
  - `nodeSnapSpan` — 카메라·90° 단위는 `nodeSnapBox`의 결과를 그대로, 그 밖은 `nodePlanOutline` 점들의 최소·최대.
  - `snapTravellingIds` — `movingIds` + 움직이는 공간이 잠기지 않았을 때 `type !== 'space' && spaceId === 그 공간 && !locked`인 노드.
  - `collectSnapCandidates` — 테두리 4선 + `excluded`에 없는 노드마다 `nodeSnapBox`의 선(점이면 축마다 1개, 아니면 시작·가운데·끝 3개), 선의 `from/to`는 `nodeSnapSpan`의 다른 축 범위. 여기서는 거르지 않는다. `points`는 사각형·다각형 **공간**의 `nodePlanOutline`.
  - `withVertexNeighbours` — 받은 후보를 바꾸지 않고 옆 점 n마다 `{ axis: 'x', at: n.x, from: n.y, to: n.y }`와 `{ axis: 'y', at: n.y, from: n.x, to: n.x }`를 더한 새 후보.
  - 닿는 거리 판정(내부, `snapMove`·`snapResize` 공용): 세로 선은 `틈 = Math.max(0, L.from − Q.bottom, Q.top − L.to)`, 가로 선은 `Math.max(0, L.from − Q.right, Q.left − L.to)`. `틈 ≤ reach`만 후보. `reach`가 유한하지 않거나 음수면 0.
  - `snapMove` — 움직이는 선은 기준 노드의 저장 좌표로부터의 `offset`으로 든다(시작·가운데·끝, 점이면 1개). Q는 차지한 범위 S를 `delta`만큼 옮긴 **붙이기 전** 자리. 가장 가까운 쌍, 같으면 먼저 찾은 것(움직이는 선은 시작·가운데·끝 순, 후보는 모은 순서). 붙은 축 `position = 후보.at − offset`, 붙지 않은 축 `Math.round(anchor + delta)`. 결과의 `delta = position − 기준 노드의 저장 x·y`. 안내선은 닿는 거리 안이고 `|선.at − at| ≤ 1e-6`인 후보들과 붙인 뒤의 S를 합친 범위. `tolerance ≤ 0`이면 정수 맞춤만.
  - `snapPoint` — `points`가 먼저(`Math.hypot` ≤ 허용, 가장 가까운 점 그대로, 길이 0의 x·y 안내선 둘). 없으면 축마다 가장 가까운 선의 `at`, 없으면 `Math.round`. 닿는 거리 판정 없음.
  - `snapResize` — 고정점은 돌아간 왼쪽 위 모서리. 90° 단위이고 기울지 않았을 때만 `corner`의 x·y를 닿는 거리 안의 선에 붙인다(Q = 고정점과 `corner`가 만드는 상자, `points`는 쓰지 않는다). 자기 축으로는 삼각함수 대신 축 바꿈(k = `Math.round(normalizeDegrees(r) / 90) % 4`: k0 `(dx, dy)`, k1 `(dy, −dx)`, k2 `(−dx, −dy)`, k3 `(−dy, dx)`), 그 밖의 각도는 `nodeLocalPoint`. 붙었고 10 이상이면 그대로, 아니면 `Math.round`. 10~100000. `resizeSpaceTo`로 결과를 만든다.
  - `snapRotation` — `capture` 기본 3. 유한하지 않으면 그대로. `t = normalizeDegrees(d)`, `Math.abs(normalizeSignedDegrees(t − s)) ≤ capture`인 정지 각도 s가 있으면 s, 없으면 t.
  - `sameSnapGuides` — 길이와 네 필드가 모두 같으면 참.
- [ ] **Step 4:** `node --test tests/backgroundMapSnap.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음.
- [ ] **Step 6:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 7: 커밋** — 두 파일 / `배경 도면: 스냅 계산 모듈(mapSnap) — 가까운 것에만 붙고 붙지 않은 축은 정수`

**이 Task가 끝나면 편집기는:** Task 5와 같다(스냅을 아직 부르지 않는다).

### Task 7: 스냅 배선 — 제스처의 스냅 분기·안내선·'스냅' 버튼·Alt

**Files:**
- Modify: `src/features/backgrounds/mapPlanGesture.ts` (표의 오른쪽 칸, `planGestureCandidates`), `src/features/backgrounds/mapPlanEdit.ts` (스냅 설정), `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` (`MapSnapGuides`), `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/backgrounds-map.css`
- Test: `tests/backgroundMapPlanGesture.test.ts`, `tests/backgroundMapPlanEdit.test.ts`

**Read first:** 설계 3.3(표의 **오른쪽 칸**, `planGestureCandidates` 표의 move·resize·draw·rotate 줄), 3.4(세션 필드, `pointerMove` 코드 블록, `pointerUp`·`abortGesture`), 6.1의 9~11, 6.5 전부, 6.6, 9(`MapSnapGuides`), 10.1(안내선·스냅 버튼 줄과 그 아래 선택자 문단), 12.4의 '스냅 있음'·draw·`planGestureCandidates` 묶음, 12.6 끝 묶음, 12.7의 17·18 · `BackgroundMapPanels.tsx:4-17`(기기별 설정의 try/catch 방식).

- [ ] **Step 1: 테스트를 쓴다**
  - 제스처 + 스냅(허용 6, 닿는 거리 48): move가 붙은 뒤 소속 카메라가 같은 만큼 따라감 / 공간이 자기 소속 의자에는 붙지 않음 / 잠긴 의자에는 붙음 / rotate 91.5° → 정확히 90이고 소속 항목도 그 각도로.
  - 가까이 있는 것에만(후보는 `planGestureCandidates`): 방(100, 100, 300×200)과 소속 없는 의자(700, 451.5, 60×60) — 방을 `delta (0.3, 350.2)` → 저장 위치 `(100, 450)`, 안내선 없음. 의자가 (430, 151.5)인 도면에서 방을 `delta (0.3, 50.2)` → 저장 y `=== 151.5`, y 안내선 한 줄.
  - draw는 스냅을 줘도 `null`일 때와 같은 도면이고 안내선이 없다(이웃 모서리 바로 옆에서 시작·끝내도 소수 좌표 그대로).
  - `planGestureCandidates`: move·resize는 실려 가는 것을 뺀 전부(테두리 4선 포함) / draw·rotate는 `x`·`y`·`points` 모두 길이 0.
  - 스냅 설정: 저장소가 없으면 `readSnapPreference() === true`이고 `storeSnapPreference(false)`가 던지지 않음 / 가짜 `globalThis.localStorage`(`Object.defineProperty(globalThis, 'localStorage', { configurable: true, value })`, 끝나면 지운다)로 `'off'` → `false`, 그 밖 → `true`, 쓰기 값이 키 `bflow.background-map.snap.v1`에 `'on'`·`'off'`.
- [ ] **Step 2: 실패를 확인한다** — 두 테스트 파일 실행 → `planGestureCandidates`·`readSnapPreference` export 없음으로 각각 파일 실패.
- [ ] **Step 3: 순수 쪽을 구현한다**
  - `export function planGestureCandidates(gesture: PlanGesture, initial: BackgroundMap): SnapCandidates;` — move·resize는 `collectSnapCandidates(initial, snapTravellingIds(initial, [nodeId]))`, draw·rotate는 `{ x: [], y: [], points: [] }`.
  - `previewPlanGesture`의 `snap` 있음: move는 `r = snapMove(initial, [nodeId], nodeId, delta, candidates, tolerance, reach)` → `placeMapNode(initial, nodeId, r.position)`, 안내선 `r.guides`(`r`이 `null`이면 자유 이동) / resize는 `snapResize(node, corner, candidates, tolerance, reach)`의 `node`로 같은 처리, 안내선은 그 결과 것 / rotate는 각도를 `snapRotation`에 통과(안내선 없음) / **draw는 스냅을 무시한다**.
  - `mapPlanEdit.ts`: `export const MAP_SNAP_PREFERENCE_KEY = 'bflow.background-map.snap.v1';` · `export function readSnapPreference(): boolean;`(`'off'` → false, 그 밖·저장소 없음 → true) · `export function storeSnapPreference(enabled: boolean): void;`(`'on'`/`'off'`, 저장소 오류는 삼킨다).
- [ ] **Step 4:** 두 테스트 파일 → 통과.
- [ ] **Step 5: `MapSnapGuides`** — `export function MapSnapGuides({ guides, scale }: { guides: readonly SnapGuide[]; scale: number }): JSX.Element | null;` `<g className="bmap-snap-guides" pointerEvents="none" aria-hidden="true">`. x축 선은 `x1 = x2 = at`, `y1 = from − 8·scale`, `y2 = to + 8·scale`, y축 선은 그 반대. 없으면 `null`.
- [ ] **Step 6: 편집기 — 상태와 세션** — 파일 맨 위 `const NO_GUIDES: readonly SnapGuide[] = [];`. 설계 6.5의 상태 세 줄을 그대로: `const [snapEnabled, setSnapEnabled] = useState(readSnapPreference);` · `const [guides, setGuides] = useState<readonly SnapGuide[]>(NO_GUIDES);` · `const showGuides = (next: readonly SnapGuide[]) => setGuides(previous => sameSnapGuides(previous, next) ? previous : next);`. `PointerSession`에 `scale: number`(누른 순간의 화면 배율값)와 `candidates: SnapCandidates | null`을 더하고 세션을 기록할 때 `scale: screenScale, candidates: null`.
- [ ] **Step 7: 편집기 — `pointerMove`·`pointerUp`·`abortGesture`** — Task 5의 호출을 설계 3.4의 코드 블록으로 바꾼다: `snapEnabled && !event.altKey`일 때만 스냅을 만들고, 후보는 `session.candidates ??= planGestureCandidates(gesture, session.initial)`, `tolerance: MAP_SNAP.tolerancePx * session.scale`, **`reach: MAP_SNAP.reachPx * session.scale`**(글자 그대로). `if (!preview) { showGuides(NO_GUIDES); return; }` 뒤 `doc.previewGesture(preview.map); showGuides(preview.guides);`. `pointerUp`은 세션 확인 직후 `showGuides(NO_GUIDES)`, `abortGesture`에도 `showGuides(NO_GUIDES)`.
- [ ] **Step 8: 편집기 — Alt(6.5)** — `altDrag` ref와 창 단위 효과(`keydown`·`keyup` 캡처, `blur`)를 설계 6.5의 코드 블록 그대로 옮긴다. 켜는 곳 셋: `pointerDown`이 세션을 기록하는 자리의 `if (event.altKey) altDrag.current = true;`, `pointerMove`가 세션을 확인한 직후(4px 문턱 앞)의 같은 줄, 창 처리기. 끄는 곳 둘: 그 Alt의 `keyup`, 창 `blur`. **`pointerUp`과 `abortGesture`에는 `altDrag.current =`를 쓰지 않는다**(마우스를 뗀 뒤에 오는 Alt 뗌을 막는 것이 목적이다). `event.key === 'Alt' && pointerRef.current` 꼴로 한꺼번에 묶어 판정하지 않는다. `keyboard()`와 루트 `<div>`에는 Alt 처리를 두지 않는다.
- [ ] **Step 9: 편집기 — 버튼과 안내선** — `.bmap-zoom`의 맨 앞에 `mode === 'plan' && editing`일 때만 설계 6.5의 버튼을 그대로: `className="bmap-snap-toggle"`, `aria-pressed={snapEnabled}`, 글자 `스냅`, `title`은 켜짐 `스냅 켜짐: 가까운 가장자리·가운데에 붙어요 · Alt를 누른 채 끌면 잠깐 꺼져요` / 꺼짐 `스냅 꺼짐: 놓은 자리 그대로예요`, 누르면 상태를 뒤집고 `storeSnapPreference(next)`. 손잡이 바로 앞에 `<MapSnapGuides guides={guides} scale={screenScale} />`.
- [ ] **Step 10: CSS(10.1)** — `.bmap-snap-guides line { stroke:#ff7aa8; stroke-width:1; vector-effect:non-scaling-stroke; pointer-events:none; }`와 밝은 화면 짝 `[data-color-mode="light"] .bmap-snap-guides line { stroke:#d6336c; }` · `.bmap-snap-toggle { margin-right:6px; }` · 켜진 모양은 선택자를 **`.bg-library .bmap-zoom .bmap-snap-toggle[aria-pressed="true"]`** 로 쓰고 도구줄 활성 버튼(:41)과 같은 글자색·배경(짧은 선택자는 :79의 `background:transparent`에 진다). 전환·애니메이션·`backdrop-filter`는 넣지 않는다.
- [ ] **Step 11: 자가 점검** — 편집기에 `reach: MAP_SNAP.reachPx * session.scale` 1곳 · `if (event.altKey) altDrag.current = true;` 2곳(`pointerDown`, `pointerMove`) · `altDrag.current = false` 2곳(keyup, blur) · `function pointerUp`부터 `function zoomBy` 앞까지와 `abortGesture` 본문에 `altDrag.current` 0곳.
- [ ] **Step 12:** `npm run typecheck` → 오류 없음.
- [ ] **Step 13:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 14: 커밋** — Files의 일곱 파일 / `배경 도면: 옮기기·크기·회전 스냅과 안내선, 스냅 버튼, Alt 자유 끌기`

**v1.130.0과 달라지는 것(되살리지 말 것):** 스냅이 켜진 끌기에서 붙지 않은 축은 정수로 떨어진다(v1.130.0은 소수 그대로). 붙은 축은 대상 값 그대로이고 **반올림하지 않는다**. 스냅을 끄거나 Alt를 누르면 v1.130.0의 값이다. 그리기 도구는 스냅 대상이 아니다. `finishGesture` 뒤에 좌표를 고쳐 쓰는 코드는 만들지 않는다.
**이 Task가 끝나면 편집기는:** 옮기기·크기 바꾸기가 가까운(화면 48px 안) 도형의 가장자리·가운데와 도면 테두리에 붙고 붙은 동안만 분홍 안내선이 보인다. 회전은 0·90·180·270 근처 3°에서 걸린다. 아래 줄에 '스냅' 버튼(기기별 기억), Alt를 누른 채 끌면 자유.

### 관문 A — 엔진 확인 E3 (Task 7 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- 방법: 설계 13절 머리말(`npm run dev:renderer` + `npm run preview:electron`, Electron 33, 미리보기 시험 계정, **실제 입력**). 창 위쪽에 메뉴 줄(File·Edit…)이 보이는 창에서 스냅을 켠 채로 한다. 콘솔 기록이 필요하면 개발자 도구에서 리스너를 붙여 보고, 임시 로그를 커밋하지 않는다.
- 할 일(설계 13절 E3): ① Alt를 먼저 누르고 방을 끌어 놓은 뒤 **마우스 먼저**, 1초 뒤 Alt를 떼고 Delete ② ①과 같되 Alt를 2초 넘게 더 누르다 떼고 F2(이 시점에는 F2가 아직 없으므로 `0` 키로 대신 보고, F2는 관문 B에서 다시 본다) ③ 끄는 **중에** Alt를 눌렀다 떼고 마우스를 뗀 뒤 Ctrl+Z ④ 끄는 중에 Alt를 누르고 마우스 먼저, 그다음 Alt를 떼고 `0` ⑤ 끌지 않고 Alt만 눌렀다 뗌.
- 봐야 할 것: ①~④ 모두 메뉴 줄에 강조·밑줄이 생기지 않고 키가 한 번에 듣는다. ⑤는 v1.130.0과 같은지 기록만 한다.
- **실패하면(설계 16절 E3 줄)**: 규칙(6.5)은 그대로 둔다. 화면 쪽 코드로는 더 막을 길이 없다(창 메뉴는 `electron/**`의 일이고 이번 범위 밖). 스냅의 나머지는 그대로 두고 한솔에게 둘 중 하나를 고르게 한다 — ① 창 쪽에서 메뉴 줄이 Alt에 반응하지 않게 하는 수정을 따로 낸다 ② 그대로 두고 "Alt로 끈 뒤에는 도면을 한 번 눌러야 키가 듣는다"를 완료 보고에 적는다. 어느 쪽이든 '스냅' 버튼으로 끄는 길은 그대로 있고, Task 8 이후는 그대로 진행한다.

---

## Chunk 3: 이름 바로 짓기 (F1)

### Task 8: 이름 칸 — 그리면 열리고 F2로 연다

**Files:**
- Modify: `src/features/backgrounds/mapGeometry.ts` (`renameMapNode`, `nodeNameAnchor`), `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/backgrounds-map.css`
- Create: `src/features/backgrounds/BackgroundMapNameBox.tsx`
- Test: `tests/backgroundMapGeometry.test.ts`

**Read first:** 설계 5.1, 5.2, 5.3, 5.4 전부(코드 블록과 '한 단계로 합치기'), 5.5 전부(키 처리, '입력 칸이 내려갈 때의 blur'), 5.7, 5.8, 10.1(이름 칸 선택자 문단), 12.5(`renameMapNode`·`nodeNameAnchor`), 12.7의 4·7·8·13 · 편집기의 `useEvent`, `focusCanvas`, `undo`, `finishPolygon`, `pointerUp`, `keyboard`, `kindLabel` · `src/components/widgets/my-tasks/components/QuickAdd.tsx:163`(조합 중 가드의 기존 방식).

- [ ] **Step 1: 테스트를 쓴다(12.5)** — `renameMapNode`: `'  교실  '` → 이름 `'교실'` / 빈 이름(`''`, `'   '`)·같은 이름·잠긴 노드·없는 노드는 `map` 그대로(`===`). `nodeNameAnchor`: 공간·기호는 상자 가운데(방 (100, 100, 60×40)은 회전 37이어도 (130, 120)), 카메라는 그 점.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapGeometry.test.ts` → `does not provide an export named 'renameMapNode'`.
- [ ] **Step 3: `mapGeometry.ts`** — `export function renameMapNode(map: BackgroundMap, id: string, name: string): BackgroundMap;`(앞뒤 공백을 뗀 이름으로. 빈·같은 이름, 없는·잠긴 노드는 `map` 자신) · `export function nodeNameAnchor(node: BackgroundNode): BackgroundPoint;`(공간·기호는 상자 가운데, 카메라는 그 점).
- [ ] **Step 4:** `node --test tests/backgroundMapGeometry.test.ts` → 통과.
- [ ] **Step 5: `BackgroundMapNameBox.tsx`**
  ```tsx
  type Props = {
    svgRef: RefObject<SVGSVGElement>; anchor: BackgroundPoint; /** CSS px below the anchor */ drop: number;
    label: string; initial: string; positionKey: string;
    onCommit(text: string, returnFocus: boolean): void; onCancel(): void;
    /** Undo (false) or redo (true) pressed while nothing was typed: the editor closes the box and runs its own history. */
    onHistory(redo: boolean): void;
  };
  export function BackgroundMapNameBox(props: Props): JSX.Element;
  ```
  - HTML `<input>`이다(**`<foreignObject>`를 쓰지 않는다**). 속성: `className="bmap-name-box"`, `aria-label={label}`, `maxLength={160}`, `spellCheck={false}`, `autoComplete="off"`. 글자 버퍼 `text`는 이 컴포넌트의 지역 상태다(타이핑 중에는 초안을 건드리지 않는다).
  - 위치: `useLayoutEffect`(의존값 `anchor.x, anchor.y, drop, positionKey`)에서 `svg.getScreenCTM()`으로 `anchor`를 화면 좌표로 바꾸고 `offsetParent`의 사각형을 빼서 `style.left/top`에 직접 쓴다. SVG 사각형 밖으로 나가지 않게 자기 반 크기 + 4px 안쪽으로 자른다.
  - 포커스: 마운트 때 한 번 `input.focus({ preventScroll: true }); input.select();`.
  - `onKeyDown`·`onBlur`·`opened`(`useRef(initial)`)·`leaving`은 5.5의 코드 블록을 그대로 옮긴다 — 순서가 뜻이다: Escape의 `stopPropagation`이 조합 가드(`event.nativeEvent.isComposing || event.keyCode === 229`)보다 **앞**, Enter는 `onCommit(text, true)`, 되돌리기 조합(Ctrl/Meta + z·y, Alt 없음)은 `text === opened.current`일 때만 `onHistory(key === 'y' || event.shiftKey)`, `onBlur`는 `if (!leaving.current) onCommit(text, false)`. `leaving`은 레이아웃 효과의 정리 함수에서 켠다.
- [ ] **Step 6: 편집기 — 상태(5.2)**
  ```ts
  type NameEdit = { mapId: string; nodeId: string; /** The draft value right after the creating edit; null for an existing node. */ created: BackgroundMap | null };
  const [renaming, setRenamingState] = useState<NameEdit | null>(null);
  const renamingRef = useRef<NameEdit | null>(null);       // handlers read this, so a late blur after a close is a no-op
  function setRenaming(next: NameEdit | null) { renamingRef.current = next; setRenamingState(next); }
  ```
- [ ] **Step 7: 편집기 — 처리기(5.4의 코드 블록을 그대로)**
  - `function beginRename(id: string, created = false)` — `!current || mode !== 'plan' || !canEdit || pointerRef.current || doc.isGestureActive()`면 돌아간다. 살아 있는 초안(`mapDraft(doc.getState(), current.id)?.value`)에서 노드를 찾고 없거나 잠겼으면 돌아간다. `select(id)` 뒤 `setRenaming({ mapId, nodeId: id, created: created ? value : null })`.
  - `const commitName = useEvent((text: string, returnFocus: boolean) => …)` — `renamingRef.current`가 없으면 돌아간다. 먼저 `setRenaming(null)`. `renameMapNode`의 결과가 초안 값과 다를 때만 `updateMap(next, edit.created && draftNow.value === edit.created ? { history: false } : undefined)`(이 줄은 글자 그대로). `returnFocus`면 `focusCanvas()`.
  - `const cancelName = useEvent(() => { if (!renamingRef.current) return; setRenaming(null); focusCanvas(); });`
  - `const passNameHistory = useEvent((redo: boolean) => { cancelName(); undo(redo); });`
  - `function renameSelected()` — `!selected || !canEdit || selected.locked || pointerRef.current || doc.isGestureActive()`면 돌아간다. `revealPlanPoint(view, nodeNameAnchor(selected), 24)`가 다른 보기를 주면 `updateView({ x, y })`, 그 뒤 `beginRename(selected.id)`.
- [ ] **Step 8: 편집기 — 부르는 곳** — `pointerUp`의 확정 분기: `if (session.mode === 'draw') { setTool('select'); if (session.node) beginRename(session.node.id, true); }` · `finishPolygon` 끝에 `beginRename(node.id, true);` · Task 3의 평면 단축키 묶음에 `F2`: `selected`가 있으면 `preventDefault`, `renameSelected()`, `return`.
- [ ] **Step 9: 편집기 — 렌더** — 5.4의 `renamingNode` 식(`renaming && mode === 'plan' && canEdit && renaming.mapId === current?.id`일 때 잠기지 않은 그 노드)과 `useEffect(() => { if (renaming && !renamingNode) setRenaming(null); }, [renaming, renamingNode])`. `<BackgroundMapNameBox key={renamingNode.id} svgRef={svgRef} anchor={nodeNameAnchor(renamingNode)} drop={…} label={…} initial={renamingNode.name} positionKey={…} onCommit={commitName} onCancel={cancelName} onHistory={passNameHistory} />`를 `.bmap-canvas-wrap` 안, SVG의 형제로(평면 모드일 때만). `label`은 `` `${kindLabel(renamingNode)} 이름` ``, `drop`은 카메라면 `MAP_EDIT_MARK.nameBoxCameraDrop` 아니면 0, `positionKey`는 `` `${view.x}:${view.y}:${view.zoom}:${canvasSize.width}:${canvasSize.height}` ``. 이름을 고치는 노드의 `<g>`(공간·기호·카메라)에 `is-renaming` 클래스를 더한다.
- [ ] **Step 10: CSS(10.1)** — 선택자 `.bg-library input.bmap-name-box:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"])`에 `position:absolute; z-index:3; width:168px; min-height:30px; padding:4px 8px; transform:translate(-50%,-50%); text-align:center; font-size:13px;` + 강조색 테두리·카드 배경·옅은 그림자(공용 입력 규칙의 `width:100%`·`min-height:36px`보다 구체적이어야 덮인다). `.is-renaming text { visibility:hidden; }`. 전환·애니메이션 없음.
- [ ] **Step 11: 자가 점검** — 이름 칸에 `text === opened.current`, `leaving.current`, `isComposing` · 편집기에 `{ history: false }`와 `=== edit.created`가 같은 줄, `onHistory={passNameHistory}`, `'F2'`가 `target.closest(interactive)`보다 앞줄 · 배경 폴더의 `.tsx`에 `<foreignObject` 0곳.
- [ ] **Step 12:** `npm run typecheck` → 오류 없음.
- [ ] **Step 13:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 14: 커밋** — 다섯 파일 / `배경 도면: 그리면 바로 열리는 이름 칸과 F2 이름 고치기`

**v1.130.0과 달라지는 것(되살리지 말 것):** 그린 직후 포커스가 이름 칸에 있다. 아무것도 치지 않은 칸의 Ctrl+Z는 칸을 닫고 도면을 되돌린다(공간이 한 번에 사라진다). 이름 칸 안의 Delete는 글자 편집이다(삭제 확인 창이 뜨지 않는다). 그리기 뒤 확정한 이름은 되돌리기 단계를 **늘리지 않는다**.
**이 Task가 끝나면 편집기는:** 사각형·타원·다각형을 그리면 그 자리에 이름 칸이 열린다(Enter·다른 곳 클릭으로 확정, Esc면 '새 공간'). 선택한 것은 F2로 이름을 고친다. 더블클릭은 아직 v1.130.0 그대로다.

### Task 9: 더블클릭을 SVG 한 곳에서, 넘기기는 `click`에서

**Files:**
- Modify: `src/features/backgrounds/mapPlanEdit.ts` (`doubleClickNodeId`), `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/backgrounds-map.css`
- Test: `tests/backgroundMapPlanEdit.test.ts`

**Read first:** 설계 2절 '이전 분석에서 바로잡은 것'의 첫 두 줄, 3.4(`PlanPress`·`NO_PRESSES`·창 단위 `pointerdown` 처리기·`pointerDown`의 1~3번·넘기기), 5.6 전부, 5.8, 10.1(아래 줄 힌트 문단), 10.2, 12.6(`doubleClickNodeId`), 12.7의 5·6·16 · 편집기 `pointerDown`·`pointerUp`, SVG 태그(:608), 노드 `<g>` 셋(:612, :623, :637), `footerHint`(:563-567), 연결 안내(:687).

- [ ] **Step 1: 테스트를 쓴다(12.6)** — `doubleClickNodeId('c', 'a', ['a', 'b', 'c'])` → `'c'`(첫 누름이 묶음 안) / `('a', 'a', ['a'])` → `'a'` / `('x', 'a', ['a', 'b'])` → `'a'`(묶음 밖) / `(null, 'a', ['a', 'b'])` → `'a'`.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/backgroundMapPlanEdit.test.ts` → `does not provide an export named 'doubleClickNodeId'`.
- [ ] **Step 3:** `export function doubleClickNodeId(firstPressId: string | null, hitId: string, pile: readonly string[]): string;` — `firstPressId`가 `null`이 아니고 `hitId`와 같거나 `pile`에 들어 있으면 `firstPressId`, 아니면 `hitId`.
- [ ] **Step 4:** `node --test tests/backgroundMapPlanEdit.test.ts` → 통과.
- [ ] **Step 5: 편집기 — 누름 기록(3.4)**
  ```ts
  /** What one press landed on. A double-click on the canvas is resolved from the last two of these. */
  type PlanPress = {
    hitId: string | null;      // 포인터 아래 맨 위의 노드(그 요소가 pointerdown 을 받았다). 빈 곳이면 null
    targetId: string | null;   // 그 누름이 작용한 노드(묶음에서 이미 골라 둔 것). 손잡이·빈 곳이면 null
    handle: boolean;
  };
  const NO_PRESSES: readonly [PlanPress | null, PlanPress | null] = [null, null];
  const pressLog = useRef(NO_PRESSES);          // 편집기 안, 최근 두 번의 누름
  ```
  미뤄 둔 넘기기는 `pendingCycle`(ref, `{ ids, nodeId, mapId }` 또는 `null`). 창 단위 효과는 3.4의 코드 블록 그대로: `window.addEventListener('pointerdown', forget, true)`이고 `forget`은 `event.target`이 `svgRef.current` 안이 아니면(`svgRef.current?.contains(event.target)`) `pressLog.current = NO_PRESSES`. 시간·거리 상수는 쓰지 않는다.
- [ ] **Step 6: 편집기 — `pointerDown`** — (1) 가드(:420)나 좌표 실패(:422)로 돌아가기 전에 `pressLog.current = NO_PRESSES` (2) `svgRef.current?.focus()` 바로 뒤에 `pendingCycle.current = null;` (3) 겹친 묶음 판정이 끝난 뒤, 다각형 점 추가·기호 놓기로 돌아가기 **전**에 `pressLog.current = [pressLog.current[1], { hitId: node?.id ?? null, targetId: handle ? null : target?.id ?? null, handle: !!handle }];`
- [ ] **Step 7: 편집기 — 넘기기** — `pointerUp`의 넘기기(:499-502)는 `select` 대신 `pendingCycle.current = { ids, nodeId: session.node.id, mapId: session.mapId }`만 한다. SVG에 5.6의 `onClick`을 그대로 단다: 기록을 꺼내 비우고, `!cycle || (event.detail >= 2 && canEdit)`이면 돌아가고, 아니면 `select(cycle.ids[(cycle.ids.indexOf(cycle.nodeId) + 1) % cycle.ids.length], cycle.mapId)`.
- [ ] **Step 8: 편집기 — 더블클릭** — react 타입 import(:2)에 `MouseEvent as ReactMouseEvent`를 더한다(지금은 `PointerEvent as ReactPointerEvent`·`KeyboardEvent as ReactKeyboardEvent`뿐이라, 빠뜨리면 Step 12에서 `Cannot find name 'ReactMouseEvent'`). 5.6의 `function canvasDoubleClick(event: ReactMouseEvent<SVGSVGElement>)`를 코드 블록 그대로 옮기고 SVG의 `onDoubleClick`(:608)을 `onDoubleClick={canvasDoubleClick}`으로 바꾼다. 공간·기호·카메라 `<g>`의 `onDoubleClick` 셋(:612, :623, :637)은 **지운다**. 판정 순서를 바꾸지 않는다: 마지막 누름 없음·손잡이·직전 450ms 안의 끌기면 무동작 → 빈 곳이면 다각형 도구일 때 완성 → 첫 누름이 없거나 같은 노드가 아니면 무동작 → 대상 결정(`doubleClickNodeId(first.targetId, node.id, pile)`) → **연결된 공간이면 `openSpace`가 먼저**(선택·이동 도구) → 선택 도구면 `beginRename`.
- [ ] **Step 9: 편집기 — 문구와 힌트 고정(10.1, 10.2)** — 아래 줄 힌트 `<span>`에 `className="bmap-footer-hint"`와 `title={mode === 'plan' ? footerHint : undefined}`. 평면·편집 중(그 밖): `끌어 옮기기 · 모서리로 크기 · 원으로 회전 · 더블클릭 이름 · 휠 확대` / 평면·보기: `클릭해서 선택 · 공간 더블클릭으로 상세 도면 열기 · 휠로 확대` / 다각형 도구·기호 놓기·3D 문구는 지금 그대로. 연결된 공간 안내(:687)는 편집 중일 때 `공간을 더블클릭해도 열립니다. 이름은 F2 키나 위의 이름 칸에서 바꿔요.`(보기 모드는 지금 문구).
- [ ] **Step 10: CSS** — `.bmap-canvas-wrap:not(.is-3d) .bmap-footer-hint { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; line-height:15px; }`(평면에서만 건다. 선택에 따라 문구가 바뀌어도 아래 줄 높이가 그대로여야 더블클릭의 둘째 클릭이 같은 자리에 떨어진다).
- [ ] **Step 11: 자가 점검** — 편집기에 `onDoubleClick=` **정확히 1곳**이고 `onDoubleClick={canvasDoubleClick}` · `event.detail >= 2` 1곳 · `pressLog.current = NO_PRESSES` 2곳 이상(창 처리기, `pointerDown` 가드) · `addEventListener('pointerdown', forget, true)` 1곳 · `pointerUp` 안에 `pendingCycle.current =`가 있고 `select(ids[`는 없음.
- [ ] **Step 12:** `npm run typecheck` → 오류 없음.
- [ ] **Step 13:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 14: 커밋** — 네 파일 / `배경 도면: 더블클릭을 SVG 한 곳에서 판정 — 이름 고치기·상세 도면 열기, 넘기기는 click에서`

**v1.130.0과 달라지는 것(되살리지 말 것):** 겹친 것 넘기기가 떼기(`pointerUp`)가 아니라 `click`에서 돈다. 편집 중의 빠른 둘째 클릭은 넘기지 않고 이름 칸을 연다(보기 모드는 클릭마다 넘긴다). 상세 도면이 연결된 공간의 더블클릭이 편집 중과 이동 도구에서도 열린다(v1.130.0은 보기 모드와 잠긴 공간에서만 열렸다). 노드 `<g>`에 `onDoubleClick`을 다시 달지 않는다 — 포인터를 캡처한 누름 뒤의 `dblclick`은 `<g>`에 닿지 않는다.
**이 Task가 끝나면 편집기는:** 편집 중 선택 도구로 상세 도면이 없는 공간·기호·카메라의 몸통을 더블클릭하면 이름 칸이 열리고, 연결된 공간은 더블클릭으로 들어간다. 손잡이 위·캔버스 밖에서 시작한 더블클릭은 아무 일도 하지 않는다. 아래 줄 힌트는 평면에서 두 줄 높이로 고정된다.

### 관문 B — 엔진 확인 E1·E2·E4·E5·E6 (Task 9 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

방법은 관문 A와 같다. 관문 A의 ②(F2)도 여기서 다시 본다. 할 일과 봐야 할 것은 설계 13절의 해당 줄 그대로이고, 다르면 아래 대체안(설계 16절)으로 바꾼다. 대체안으로 바꾸면 Task 12의 해당 앵커(5·6)도 그 구현에 맞춘다.

| 확인 | 봐야 할 것 | 다르면 (설계 16절) |
|---|---|---|
| E1 같은 자리의 카메라 셋을 편집 중에 1초 간격으로 클릭 | 클릭마다 다음 카메라로 넘어간다. 콘솔에 찍은 `click`의 `detail`이 더블클릭 때 2로 SVG에 온다 | 넘기기를 `pointerUp`에 그대로 두고, 직전의 움직이지 않은 누름이 500ms·5px 안이었으면 편집 중일 때 넘기지 않는다(시간·거리 판정) |
| E5 편집 중 선택 도구로 ① 상세 도면 없는 방 ② 연결된 방의 몸통을 더블클릭 | ① 이름 칸이 열리고 포커스가 남는다 ② 그 도면으로 들어간다. `dblclick`의 `target`이 SVG인지 기록 | `dblclick`이 SVG에 오지 않으면 SVG의 `onClick`에서 `event.detail === 2`일 때 `canvasDoubleClick`을 부른다 |
| E2 이름 칸에 한글 '과학실'을 치고 Enter | 이름이 정확히 '과학실'. Enter 횟수를 기록 | 조합 가드는 유지한다. 글자가 빠지면 `compositionend` 뒤에 확정하도록 미룬다 |
| E4 이름 칸이 열린 채 트리에서 다른 도면으로 이동 | 이름이 확정된 뒤 이동하고, 돌아오면 이름이 맞다 | 설계 16절에 따로 정한 대체안이 없다(가장 가까운 줄 '입력 칸이 내려갈 때의 blur'의 대체안 칸은 비어 있다). 실패하면 blur가 클릭보다 먼저 온다는 5.7의 전제가 깨진 것이므로 원인을 찾고(@superpowers:systematic-debugging), 설계를 바꿔야 하면 멈추고 한솔에게 보고한다 |
| E6 방 S 안에 다각형 점 셋을 찍고 '다각형 완성' 버튼을 더블클릭 | S의 이름 칸이 열리지 않는다. 새 다각형이 생기고 S가 선택되며 방금 열린 이름 칸은 닫혀 있다. `dblclick` 시점의 `pressLog` 첫 칸이 `null`. `dblclick`이 SVG에 오는지는 기록만 | 오든 오지 않든 동작이 같아야 한다. 첫 칸이 비어 있지 않으면 그 누름이 지나는 길을 찾아 같은 처리기로 보낸다. 시간 상수로 막지 않는다 |

---

## Chunk 4: 다각형 점 편집 (F11)

### Task 10: 다각형 점 계산 — 옮기기·끼우기·지우기·네모에서 바꾸기, 점 손잡이 배치, `vertex` 제스처

**Files:**
- Modify: `src/features/backgrounds/mapGeometry.ts`, `src/features/backgrounds/mapPlanEdit.ts`, `src/features/backgrounds/mapPlanGesture.ts`
- Test: `tests/backgroundMapGeometry.test.ts`, `tests/backgroundMapPlanEdit.test.ts`, `tests/backgroundMapPlanGesture.test.ts`

**Read first:** 설계 3.2(`planVertexHandles` 규칙), 3.3(표의 vertex 줄, `planGestureCandidates` 표의 vertex 줄), 7.1의 3·7·9, 7.2 전부(여섯 단계와 검산), 12.4의 vertex 묶음과 `planGestureCandidates`, 12.5의 `polygonFromWorldPoints` 계열과 `rectToPolygon`, 12.6의 `planVertexHandles` · `mapSpatial.ts:202-213`(`spaceOutline`), `:239-256` · `domain.ts:27`(`validateBackgroundEntity`).

- [ ] **Step 1: 테스트를 쓴다 — `tests/backgroundMapGeometry.test.ts`(12.5)**
  - 회전 0의 삼각형(20, 30, 100×50, 점 `(0,0)(1,0)(0.5,1)`)의 셋째 점을 (70, 130)으로 → `{ x: 20, y: 30, width: 100, height: 100, points: [(0,0), (1,0), (0.5,1)] }`.
  - 회전 37의 네 점 다각형에서 한 점을 옮김 → 회전 37 그대로, 나머지 점의 절대 좌표 오차 1e-9 미만, 모든 `points`가 0~1.
  - 끼워 넣기: 변 가운데점이면 상자·넓이 불변, 점 수 +1 / `index = n − 1`이면 새 점이 목록 끝에 붙는다(마지막 점과 0번 점 사이) · 지우기: 4 → 3, 3개에서는 `null` · 200개에서 끼워 넣기는 `null`.
  - 지우면 너무 좁아지는 경우: 방(0, 0, 100×100)의 점 `(0,0)(0.05,0)(1,0.5)(0.05,1)`에서 2번 점을 지우면 가로가 5 → `null`.
  - 옆 점과 같은 자리: 점을 `(index − 1)`번·`(index + 1)`번 점의 절대 좌표로 옮기면 `null` / 끼워 넣을 점이 그 변의 한쪽 끝과 같으면 `null`.
  - `null`: 상자 한 변 10 미만, 넓이 1 미만(세 점이 한 줄), 유한하지 않은 점, 잠긴 공간, 다각형이 아님, 범위 밖 `index`.
  - 결과를 넣은 도면이 `validateBackgroundEntity('map', …)`를 통과한다.
  - `rectToPolygon`: `nodePlanOutline`이 전후 같음(회전 0과 37) / 타원·다각형·잠긴 사각형은 `null` / 이름·연결·높이 같은 다른 필드는 그대로.
- [ ] **Step 2: 테스트를 쓴다 — `tests/backgroundMapPlanEdit.test.ts`(12.6)** — `planVertexHandles`: 사각형·타원·잠긴 다각형·긴 변이 화면 32px 미만 → `null` / `vertices`가 `nodePlanOutline`과 같음(회전 포함) / 화면 28px 미만인 변에는 '+' 없음 / 점 200개면 `edges`가 빔.
- [ ] **Step 3: 테스트를 쓴다 — `tests/backgroundMapPlanGesture.test.ts`(12.4의 vertex)**
  - 한 점만 움직이고 다른 점의 절대 좌표가 1e-9 안(회전 0과 37) / 소속 카메라·기호 객체가 `===`로 그대로 / 끼워 넣기는 점이 하나 늘고 `index + 1` 자리에 생기며 마지막 변(`index = n − 1`)에서도 된다.
  - 누른 자리: 점의 절대 좌표가 (200, 100)일 때 `start (206, 103)`, `point (216, 103)`, 스냅 `null` → 그 점이 (210, 100). `start`와 `point`를 같은 만큼 옮겨도(같은 `delta` — 정수만큼 옮기거나 1e-9 안에서 비교) vertex 결과가 같다: 옮기기·끼워 넣기 둘 다, 스냅 `null`(12.4. resize 쪽은 Task 5에 있다).
  - 스냅(허용 6): 옆 점의 x·y에 붙음 / 다른 공간의 모서리에 붙음 / **붙지 않는 것**: 다른 방의 변 중간(그 변에서 2 떨어진 자리, 모서리에서는 허용 거리 밖), 다른 방의 가운데 선, 그 다각형 안 의자의 가장자리·가운데 선, 카메라의 점, 도면 테두리(x = 2.4) — 좌표가 정수이고 안내선이 없다.
  - 상자가 10보다 좁아지는 점은 `null` / 옆 점과 같은 자리가 되는 점은 `null`(옆 점의 x·y 선에 함께 붙는 위치).
  - `planGestureCandidates`(vertex): 다른 방 둘, 타원 방 하나, 그 다각형 안의 의자와 카메라가 있는 도면에서 `x`와 `y`의 길이가 각각 2, `points`는 다른 **사각형·다각형** 공간의 꼭짓점만 / 끼워 넣기의 옆 점은 그 변의 두 끝.
- [ ] **Step 4: 실패를 확인한다** — geometry·planEdit 파일은 없는 export로 파일 전체가 실패, gesture 파일은 새 vertex 테스트들만 실패(기존 테스트는 통과).
- [ ] **Step 5: `mapGeometry.ts`** (7.2. 결과는 `replaceMapNode`로 넣는다 — **`transformMapSpace`를 거치지 않는다**)
  - `export function polygonFromWorldPoints(space: BackgroundSpace, points: readonly BackgroundPoint[]): BackgroundSpace | null;` — 7.2의 1~6단계. 회전 유지, 상자는 자기 축에서의 점 범위, 점은 0~1로 정규화(`clamp01`). `null`: 3개 미만·200개 초과, 유한하지 않음, 한 변 10 미만·100000 초과, 넓이 1 미만, `|x′|`·`|y′|` 100000 초과.
  - `export function movePolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null;`
  - `export function insertPolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null;` — `index`와 다음 점 사이(`index + 1` 자리)에 끼운다. 200개면 `null`.
  - `export function removePolygonVertex(space: BackgroundSpace, index: number): BackgroundSpace | null;` — 3개 이하면 `null`.
  - 세 함수 공통: 다각형이 아니거나 잠겼거나 `index`가 정수 범위 밖이면 `null`. 절대 좌표는 `nodePlanOutline(space)`(저장 순서 그대로)에서 얻고 바꾼 뒤 `polygonFromWorldPoints`. 옮기기·끼우기는 새 점이 양옆 점과 `Math.hypot` 1e-6 미만이면 `null`(양옆 = 옮기기는 `(index ± 1) mod n`, 끼우기는 `index`와 `(index + 1) mod n`).
  - `export function rectToPolygon(space: BackgroundSpace): BackgroundSpace | null;` — `shape === 'rect'`이고 잠기지 않았을 때 `{ ...space, shape: 'polygon', points: [{0,0}, {1,0}, {1,1}, {0,1}] }`.
- [ ] **Step 6: `mapPlanEdit.ts`** — `export type PlanVertexHandles = { vertices: BackgroundPoint[]; edges: { index: number; point: BackgroundPoint }[] };` · `export function planVertexHandles(space: BackgroundSpace, scale: number): PlanVertexHandles | null;` — 다각형이 아님·잠김·점 3개 미만·`Math.max(width, height) / scale < 32`면 `null`. `vertices = nodePlanOutline(space)`. `edges`는 점이 200개 미만일 때, 화면 길이 28px 이상인 변(`i` → `(i + 1) % n`)의 가운데점이며 `index = i`.
- [ ] **Step 7: `mapPlanGesture.ts`** — `PlanGesture`에 `| { mode: 'vertex'; nodeId: string; index: number; insert: boolean }`를 더한다. vertex: 다각형 공간이 아니면 `null`. `outline = nodePlanOutline(node)`, `base` = 옮기기면 `outline[index]`, 끼워 넣기면 `outline[index]`와 `outline[(index + 1) % n]`의 가운데점. `target = base + delta`(스냅이 있으면 `snapPoint(target, candidates, tolerance).point`와 그 안내선, `reach`는 쓰지 않는다). `insert`면 `insertPolygonVertex(node, index, target)`, 아니면 `movePolygonVertex(node, index, target)`. 결과가 `null`이면 `null`, 아니면 `replaceMapNode(initial, shaped)`. `planGestureCandidates`의 vertex는 **둘뿐**: `withVertexNeighbours({ x: [], y: [], points: collectSnapCandidates(initial, new Set([nodeId])).points }, 옆 점 둘)` — 옆 점은 옮길 때 `(index ± 1) mod n`, 끼워 넣을 때 `index`와 `(index + 1) mod n`의 절대 좌표. 다른 노드의 선·테두리 선을 넣지 않는다.
- [ ] **Step 8:** 세 테스트 파일 → 통과.
- [ ] **Step 9:** `npm run typecheck` → 오류 없음.
- [ ] **Step 10:** `npm run test:background` → 테스트 수 증가, fail 0, skipped 3.
- [ ] **Step 11: 커밋** — 여섯 파일 / `배경 도면: 다각형 점 옮기기·끼우기·지우기와 네모→다각형 계산, 점 제스처`

**이 Task가 끝나면 편집기는:** Task 9와 같다(점 손잡이를 아직 그리지 않는다).

### Task 11: 점 손잡이·점 Delete·'다각형으로 바꾸기' (편집기 배선)

**Files:**
- Modify: `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` (`MapVertexHandles`), `src/features/backgrounds/BackgroundMapEditor.tsx`, `src/features/backgrounds/backgrounds-map.css`

**Read first:** 설계 3.4(`PlanHandle`, 세션의 `vertex`, `pointerDown`의 2·4·5·6번, `pointerUp`의 끼워 넣기 코드 블록과 근거), 4.3(같은 점 거리 문단), 7.1, 7.3 전부, 7.4, 9(`MapVertexHandles`), 10.1, 10.2의 위 두 줄, 12.7의 12·14·15 · 편집기 `pointerDown`·`pointerUp`·`keyboard`·`undo`, 도구 버튼(:593), 속성 칸의 연결 구역(:685-691).

이 Task에는 새 순수 테스트가 없다(계산은 Task 2·10에서 고정했다). 배선은 Step 10의 자가 점검과 Task 12의 앵커 12·14·15로 지킨다.

- [ ] **Step 1: `MapVertexHandles`** — `export function MapVertexHandles({ handles, scale, activeIndex, onHandleDown }: { handles: PlanVertexHandles; scale: number; activeIndex: number | null; onHandleDown(event: ReactPointerEvent<SVGElement>, handle: { index: number; insert: boolean }): void }): JSX.Element;` `<g className="bmap-vertex-handles" aria-hidden="true">` 안에 '+'들(`<g className="bmap-vertex-add">`: 누르는 원 r `9·scale`, 보이는 원 r `5·scale`, 십자 `<path>`, 누르면 `{ index, insert: true }`)을 먼저, 꼭짓점들(`<g className="bmap-vertex-handle">`, 고른 점이면 ` is-active`: 누르는 원 r `9·scale`, 보이는 원 r `5·scale`, 누르면 `{ index, insert: false }`)을 나중에. 좌표는 절대 좌표(회전 그룹 밖).
- [ ] **Step 2: 편집기 — 타입과 상태** — `type PlanHandle = 'resize' | 'rotate' | { index: number; insert: boolean };`, `PointerSession.mode`에 `'vertex'`, 필드 `vertex: { index: number; insert: boolean } | null`. 상태 `const [activeVertex, setActiveVertex] = useState<{ mapId: string; nodeId: string; index: number } | null>(null);`와 `useEffect(() => setActiveVertex(null), [view.selectedId, current?.id, mode, canEdit])`. 렌더마다 7.3의 두 식을 그대로: `const vertexHandles = mode === 'plan' && canEdit && tool === 'select' && selected?.type === 'space' && !selected.locked ? planVertexHandles(selected, screenScale) : null;`와 **`const activeIndex = vertexHandles && activeVertex && activeVertex.mapId === current.id && activeVertex.nodeId === selected?.id && activeVertex.index < vertexHandles.vertices.length ? activeVertex.index : null;`**(보이는 손잡이에서만 고른 점이 나온다). 타입 때문에 `current?.id`로 쓰거나 Delete 분기에 `current &&`를 더해도 되지만, 식의 시작 `vertexHandles &&`와 Delete 조건의 `activeIndex !== null`은 그대로 둔다.
- [ ] **Step 3: 편집기 — `pointerDown(event, node?, handle?: PlanHandle)`** — (2) `svgRef.current?.focus()` 뒤: `handle`이 점 손잡이가 아니면 `setActiveVertex(null)` (4) 다각형 도구의 같은 점 거리: `Math.hypot(last.x - point.x, last.y - point.y) < 1` → `< MAP_EDIT_MARK.polygonDot * screenScale` (5) 모드: `mode = target.locked ? 'click' : typeof handle === 'object' ? 'vertex' : handle ?? 'move'` (6) `vertex`이고 `beginGesture`가 성공하면, 끼워 넣기가 아닐 때 `setActiveVertex({ mapId, nodeId, index })`. 세션에 `vertex`를 싣고 `planGestureOf`가 `{ mode: 'vertex', nodeId, ...session.vertex }`를 만든다.
- [ ] **Step 4: 편집기 — `pointerUp`** — 확정 분기에 3.4의 끼워 넣기 코드 블록을 그대로: `finishGesture` 뒤의 초안에서 그 다각형의 점 수가 `=== points(session.initial) + 1`일 때만 `setActiveVertex({ …, index: session.vertex.index + 1 })`, 아니면 `null`(받아들여진 위치가 없는 '+' 끌기 뒤에 원래 있던 옆 점이 골라지면 다음 Delete가 그 점을 지운다).
- [ ] **Step 5: 편집기 — 그리기** — `MapNodeHandles`의 `vertexHandles={false}` → `vertexHandles={!!vertexHandles}`(크기 네모가 모서리 점과 겹치면 비켜 선다 — 규칙은 Task 2). 그 뒤에 `{vertexHandles && selected?.type === 'space' && <MapVertexHandles handles={vertexHandles} scale={screenScale} activeIndex={activeIndex} onHandleDown={(event, handle) => pointerDown(event, selected, handle)} />}`. 그리는 순서: 안내선 → 회전·크기 손잡이 → '+' → 꼭짓점(맨 위).
- [ ] **Step 6: 편집기 — Delete와 지우는 때** — `keyboard()`의 입력 칸 가드 뒤, 노드 삭제 줄(:521) **앞**에 7.3의 Delete 분기를 그대로(조건의 첫 항이 `activeIndex !== null`, 분기 안에서 `activeVertex.index`를 읽지 않는다, 끝은 `return`). 안내 문구: `다각형에는 꼭짓점이 3개 이상 필요해요. 이 점은 지울 수 없어요.` / `이 점을 지우면 공간이 너무 작아져요.` 고른 점을 지우는 곳: Escape 분기, `undo()` 안, 도구 버튼의 `onClick`.
- [ ] **Step 7: 편집기 — 속성 칸의 모양 줄** — 공간의 연결 구역 다음·접이식 항목들 앞에 `editing && selected.type === 'space'`일 때 7.3의 `<div className="bmap-shape-actions">`를 그대로: 사각형이면 버튼 `다각형으로 바꾸기`(`className="bmap-text-button"`, `disabled={fieldLocked || gestureActive}`, `rectToPolygon` → `updateMap(replaceMapNode(current, shaped))`)와 힌트 `꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.`, 다각형이면 힌트 `점을 끌어 모양을 고쳐요. 변 가운데의 +를 끌면 점이 생기고, 점을 고른 뒤 Delete를 누르면 지워져요.` 타원에는 아무것도 없다.
- [ ] **Step 8: 편집기 — 아래 줄 힌트(10.2의 위 두 줄)** — 평면·편집 중·`vertexHandles`가 있으면 `점을 끌어 모양 고치기 · +를 끌어 점 추가 · 점 고르고 Delete` / 평면·편집 가능·선택 도구·잠기지 않은 다각형이 선택됐는데 `vertexHandles`가 `null`이면 `확대하면 점을 고칠 수 있어요 · 휠로 확대`. 그 밖은 Task 9의 문구.
- [ ] **Step 9: CSS(10.1)** — `.bmap-vertex-handle`(누르는 원 투명, 보이는 원은 `.bmap-handles circle`과 같은 채움·테두리, `cursor:move`) · `.bmap-vertex-handle.is-active`(보이는 원을 `rgb(var(--color-accent-sub))`로 채움) · `.bmap-vertex-add`(보이는 원은 점선 테두리, 십자 `stroke` 1.5, `cursor:copy`) · `.bmap-shape-actions { margin:10px 0 4px; }`.
- [ ] **Step 10: 자가 점검** — 편집기에 `const activeIndex = vertexHandles &&` 1곳 · Delete 분기 조건에 `activeIndex !== null` · `=== points(session.initial) + 1` 1곳 · `last.y - point.y) < MAP_EDIT_MARK.polygonDot * screenScale` 1곳이고 `last.y - point.y) < 1 ` 0곳 · `vertexHandles={false}` 0곳.
- [ ] **Step 11:** `npm run typecheck` → 오류 없음.
- [ ] **Step 12:** `npm run test:background` → Task 10과 같은 수, fail 0, skipped 3.
- [ ] **Step 13: 커밋** — 세 파일 / `배경 도면: 다각형 점 손잡이, 점 Delete, 다각형으로 바꾸기 버튼`

**v1.130.0과 달라지는 것(되살리지 말 것):** 다각형 도구가 같은 점으로 보는 거리는 도면 1단위가 아니라 화면 4px이다. 고른 점이 **보이고 있을 때**의 Delete는 그 점을 지우고 노드 삭제 확인 창을 띄우지 않는다(보이지 않으면 지금처럼 노드 삭제). 점 편집은 소속 카메라·기호를 옮기지 않는다.
**이 Task가 끝나면 편집기는:** 네 기능이 모두 된다 — 편집 중 다각형을 고르면 꼭짓점 동그라미와 변의 '+'가 보이고, 끌면 그 점만 움직이며(옆 점의 가로·세로, 다른 공간의 모서리에 붙는다), 점을 고르고 Delete로 지운다. 사각형 공간은 '다각형으로 바꾸기'로 바꾼다.

---

## Chunk 5: 앵커 테스트와 마무리

### Task 12: 배선 앵커 테스트 18개와 뮤테이션 확인, CSS·문구 점검

**Files:**
- Create: `tests/backgroundMapEditorWiring.test.ts`
- Modify(점검에서 어긋난 것이 나올 때만): `src/features/backgrounds/backgrounds-map.css`, `src/features/backgrounds/BackgroundMapEditor.tsx`

**Read first:** 설계 12.7 전부, 10.1, 10.2 · `tests/backgroundAccess.test.ts:39-45`(이 기능의 소스 앵커 방식: `readFileSync(new URL('../src/…', import.meta.url), 'utf8')` + `assert.match`) · 완성된 편집기·이름 칸·조각 파일.

- [ ] **Step 1: 앵커 18개를 쓴다** — 앵커마다 `test()` 하나. 낱말만 찾지 말고 아래 표의 조각을 본다. 읽기·자르기·위치 비교는 다음 세 규칙을 지킨다(빠지면 늘 통과하는 앵커가 된다).
  - **줄 끝**: 소스는 읽은 직후 `.replace(/\r\n/g, '\n')`으로 정규화하고, 표지·정규식에 줄바꿈 글자를 넣지 않는다(여러 줄에 걸치면 `\s*` 또는 `[\s\S]*?`). 이 작업 트리의 소스는 LF지만 `core.autocrlf=true`라 새로 받은 checkout은 CRLF이고, 이 테스트는 `npm run build:vite`에서도 돈다.
  - **자르기**: 함수 본문은 `source.slice(start, end)`로 잘라 본다 — `start = source.indexOf(시작 표지)`, `end = source.indexOf(끝 표지, start)`(예: `function pointerUp(` ~ `function zoomBy(`). 자르기 전에 두 표지를 단언한다: `assert.ok(start > -1 && end > start)`. 표지를 못 찾으면 조각이 비어, '없음'을 보는 앵커(5·12·17)가 조용히 통과한다.
  - **위치 비교**: 첫 번째로 나오는 자리(`indexOf`)로 하고, 비교하는 자리가 모두 `> -1`인지 먼저 단언한다(못 찾은 −1은 무엇보다도 '앞'이다). 13번의 세 자리와 가드는 `keyboard` 본문 안에서 찾는다: `source.indexOf(…, source.indexOf('function keyboard('))`. `keyboard` 위의 `function fitView() {`에도 `fitView()`라는 글자가 있어, 파일 처음부터 찾으면 그 항은 늘 참이다.

  | # | 앵커가 보는 것 | 뮤테이션(스크래치 사본에서 깨뜨리는 법) |
  |---|---|---|
  | 1 | 편집기에 `addEventListener('wheel', …, { passive: false })`, 그 효과의 의존값에 `current?.id, mode`, `onWheel={` 없음 | `{ passive: false }` 삭제 / 의존값에서 `mode` 삭제 / SVG에 `onWheel={…}` 추가 |
  | 2 | `fitMapViewport(` 있음, `updateView({ x: 0, y: 0, zoom: 1 })` 없음 | `fitView`를 예전 초기화로 |
  | 3 | `pointerMove` 본문에서 `previewPlanGesture(`가 `doc.previewGesture(`보다 앞, 편집기에 `resizeSpace(`·`moveMapNode(next` 없음 | `pointerMove`에 `resizeSpace(` 한 줄 추가 |
  | 4 | 이름 확정에 `{ history: false }`와 `=== edit.created`가 함께 | `=== edit.created`를 `!== null`로 |
  | 5 | SVG `onClick` 처리기에 `event.detail >= 2`, `pointerUp` 본문에 `pendingCycle.current =`가 있고 `select(ids[`가 없음 | `>= 2`를 `>= 3`으로 / `pointerUp`에 예전 넘기기 복구 |
  | 6 | `onDoubleClick=`이 정확히 한 번이고 값이 `canvasDoubleClick`, `canvasDoubleClick` 본문에 `pressLog.current`, `pointerDown` 본문에 `pressLog.current = [` | 노드 `<g>` 하나에 `onDoubleClick={…}` 추가 |
  | 7 | 이름 칸: Escape의 `stopPropagation`, `isComposing`, `onHistory(` 분기에 `text === opened.current`, `onBlur`에 `leaving.current`. 편집기: `onHistory={passNameHistory}`, `passNameHistory`에 `cancelName()`과 `undo(` | `text === opened.current` 삭제 / `!leaving.current` 삭제 |
  | 8 | 배경 폴더의 모든 `.tsx`에 `<foreignObject` 마크업 없음(여는 꺾쇠까지 본다) | 이름 칸을 `<foreignObject>`로 감쌈 |
  | 9 | `mapSnap.ts`·`mapPlanGesture.ts`에 three.js import와 DOM 접근이 없음(정규식 둘은 표 아래) | `window.innerWidth`를 읽는 줄 추가 |
  | 10 | `BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`가 `mapSnap`·`mapPlanGesture`·`mapPlanEdit`을 import하지 않음 | 3D 파일에 import 한 줄 추가 |
  | 11 | 편집기와 조각 파일에 `<pattern` 없음 | `<pattern` 추가 |
  | 12 | Delete의 점 분기 조건에 `activeIndex !== null`, `activeIndex` 식이 `vertexHandles &&`로 시작, 분기 안에 `activeVertex.index` 없음 | 조건을 `activeVertex !== null`로 / 식의 `vertexHandles &&` 삭제 |
  | 13 | `keyboard` 본문 안에서 찾은 `'F2'`·`fitView()`·`zoomBy(1.25)`의 위치가 모두 `target.closest(interactive)`보다 앞 | 묶음을 가드 뒤로 옮김 / `0` 분기(`fitView()`)만 가드 뒤로 옮김 |
  | 14 | 같은 점 판정이 `last.y - point.y) < MAP_EDIT_MARK.polygonDot * screenScale`, 예전 꼴(`last.y - point.y) < 1`)이 없음 | `< 1`로 되돌림 |
  | 15 | `pointerUp` 본문에서 `=== points(session.initial) + 1`이 `setActiveVertex(added ?`보다 앞 | 비교를 `true`로 바꿈 |
  | 16 | window의 `pointerdown` **캡처** 리스너(`addEventListener('pointerdown', …, true)`), 그 처리기가 `svgRef.current?.contains(` 뒤에 `pressLog.current = NO_PRESSES`, `pointerDown` 본문에도 `pressLog.current = NO_PRESSES` | 캡처 인자 `true` 삭제 / `pointerDown` 가드의 비우기 삭제 |
  | 17 | window의 `keydown`·`keyup` 캡처 리스너와 `blur` 리스너, 키 처리기에 `altDrag.current`·`preventDefault`·`keyup`에서만 `altDrag.current = false`, `pointerDown`·`pointerMove` 본문에 `event.altKey`로 `altDrag.current = true`, **`pointerUp`·`abortGesture` 본문에 `altDrag.current =` 없음**, 편집기에 `event.key === 'Alt' && pointerRef.current` 꼴 없음 | `pointerUp`에 `altDrag.current = false` 추가 / `pointerMove`의 줄 삭제 |
  | 18 | `pointerMove` 본문에 `reach: MAP_SNAP.reachPx * session.scale` | `reach: Infinity`로 |

  - 9번의 정규식: `/from\s+['"]three/` 와 `/\b(?:document|window)\.\w/`. 낱말만 찾으면 "three is never imported here" 같은 주석에 걸린다.
  - 14번: 설계 12.7은 "`< 1)`이 남아 있지 않다"고 적었지만 v1.130.0의 실제 글자는 `… point.y) < 1 ? previous : …`라서 `< 1)`은 원래 없다(그대로 쓰면 늘 통과하는 앵커가 된다). 정규식은 `/last\.y - point\.y\) < 1\b/`가 걸리지 않는 것으로 쓴다.
- [ ] **Step 2:** `node --test tests/backgroundMapEditorWiring.test.ts` → 18개 통과. 실패하는 앵커가 있으면 배선이 빠진 것이다 — **소스를 고친다**(앵커를 느슨하게 하지 않는다). 정규식이 틀린 경우에만 테스트를 고친다.
- [ ] **Step 3: 뮤테이션 확인(스크래치 사본에서만)** — 워크트리 **밖**의 임시 폴더에 `tests/backgroundMapEditorWiring.test.ts`와 `src/features/backgrounds/`를 같은 상대 경로로 복사한다(`<임시>/tests/…`, `<임시>/src/features/backgrounds/…`). 표의 뮤테이션을 **하나씩** 사본에 넣고 `node --test <임시>/tests/backgroundMapEditorWiring.test.ts`를 돌려 그 번호의 앵커가 **실패**하는지 본 뒤 원래대로 되돌린다('/'로 나뉜 뮤테이션은 각각). 살아남은(통과한) 뮤테이션이 있으면 워크트리의 앵커를 조여 다시 복사하고 반복한다. 워크트리의 소스에는 뮤테이션을 넣지 않는다. 끝나면 사본을 지우고, 넣은 뮤테이션 수와 잡힌 수를 커밋 메시지 본문에 적는다.
- [ ] **Step 4: CSS 점검(10.1)** — 아홉 클래스가 모두 있고 선택자가 설계와 같다: `.bmap-snap-guides line`(+ `[data-color-mode="light"]` 짝), `.bmap-vertex-handle`, `.bmap-vertex-handle.is-active`, `.bmap-vertex-add`, `.bg-library input.bmap-name-box:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"])`, `.is-renaming text`, `.bmap-snap-toggle`와 `.bg-library .bmap-zoom .bmap-snap-toggle[aria-pressed="true"]`, `.bmap-canvas-wrap:not(.is-3d) .bmap-footer-hint`, `.bmap-shape-actions`. 새 규칙에 `transition`·`animation`·`backdrop-filter`가 없다.
- [ ] **Step 5: 문구 점검(10.2, 4.3, 6.5, 7.3)** — 아래 문자열이 소스에 글자 그대로 있다: `점을 끌어 모양 고치기 · +를 끌어 점 추가 · 점 고르고 Delete` / `확대하면 점을 고칠 수 있어요 · 휠로 확대` / `끌어 옮기기 · 모서리로 크기 · 원으로 회전 · 더블클릭 이름 · 휠 확대` / `클릭해서 선택 · 공간 더블클릭으로 상세 도면 열기 · 휠로 확대` / `공간을 더블클릭해도 열립니다. 이름은 F2 키나 위의 이름 칸에서 바꿔요.` / `그려 둔 것 전체가 보이게 맞춤 (0)` / `축소 (−)` / `확대 (+)` / 스냅 버튼의 두 `title` / `다각형으로 바꾸기`와 두 힌트 / 점 지우기 안내 둘. 예전 문구 `선택 후 드래그 · 모서리로 크기 조절 · 위쪽 원으로 회전`과 `확대와 위치 초기화`는 남아 있지 않다.
- [ ] **Step 6:** `npm run typecheck` → 오류 없음.
- [ ] **Step 7:** `npm run test:background` → 18개 증가, fail 0, skipped 3.
- [ ] **Step 8: 커밋** — 바뀐 파일 / `테스트: 배경 도면 편집기 배선 앵커 18개와 뮤테이션 확인, CSS·문구 점검`

**이 Task가 끝나면 편집기는:** Task 11과 같다(점검에서 고친 문구·CSS가 있으면 그만큼만 다르다).

### Task 13: 버전 1.131.0·업데이트 내역·문서·전체 게이트

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`, `AGENTS.md`, `ROADMAP.md`, `DEVLOG/background-3d-opus-handoff-2026-10-07.md`, `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`

**Read first:** 설계 14절 전부(JSON 블록과 문서별 내용), 11절 '다음 묶음 ②를 막지 않는 점' · `DEVLOG/update-notes.json`의 첫 20줄(들여쓰기) · `AGENTS.md:102-114` · `ROADMAP.md:12-24`, `:1401-1408` · 인수인계 문서 `## 14.` 절의 문체 · 라운드 계획의 `### B1`(:19-24)과 `## 7. 진행 기록` 표.

- [ ] **Step 1: 버전** — 먼저 `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 `1.130.0`인지 본다(이미 1.131.0 이상이면 멈추고 보고). `package.json`의 `"version"`(:3), `package-lock.json`의 맨 위 `"version"`(:3)과 `packages[""]`의 `"version"`(:9) 세 곳을 `1.131.0`으로. 확인: `git diff --numstat package.json package-lock.json` → `1 1`, `2 2`.
- [ ] **Step 2: `DEVLOG/update-notes.json`** — 이 파일은 `JSON.stringify` 출력과 다르다(다시 직렬화하면 전체가 바뀐다). **글자로 끼워 넣는다**: 첫 줄 `[` 바로 다음, 기존 첫 항목 `  {` 앞에 설계 14절의 JSON 블록(`{`부터 `}`까지 26줄)을 각 줄 앞에 공백 2칸을 더해 넣고 마지막 줄을 `  },`로 한다. 본문은 설계에서 **한 글자도 바꾸지 않고** 복사한다. 제목 `배경 도면을 그리고 고치기가 편해졌어요 (시험 중)`, 항목 넷의 `category`는 차례로 `feature`·`ux`·`feature`·`feature`, `summary`는 `도면을 마우스 휠로 확대·축소해요 (시험 중)` / `공간을 그리면 바로 이름을 붙여요 (시험 중)` / `옮기고 줄일 때 옆 도형에 착 붙어요 (시험 중)` / `다각형의 점을 끌어 모양을 고쳐요 (시험 중)`.
  - 확인 1: `git diff --numstat DEVLOG/update-notes.json` → `26 0`(지워진 줄이 없다).
  - 확인 2: `node -e "const n=require('./DEVLOG/update-notes.json');if(n[0].version!=='1.131.0'||n[0].items.length!==4||n[1].version!=='1.130.0')process.exit(1);console.log(n[0].title)"` → 제목이 찍히고 종료 코드 0.
- [ ] **Step 3: `AGENTS.md`** — '배경 라이브러리 데이터 경계'의 "평면/3D 공동 도면" 불릿(:111) 바로 다음에 `- 평면 편집 보조(v1.131.0): …` 불릿 하나. 내용은 설계 14절 '문서'의 AGENTS.md 줄에 `/`로 나뉘어 적힌 항목을 그 순서대로 모두 옮긴다(확대·맞춤은 보기 값만 / 순수 모듈과 제스처 안의 스냅 / 붙은 축·붙지 않은 축 / 가까이 있는 것만(`MAP_SNAP.reachPx`) / 다각형 점이 붙는 두 곳 / `replaceMapNode`로 그 노드만 / 화면 상태와 기기별 키 `bflow.background-map.snap.v1` / 늘 깔린 눈금 없음 / 더블클릭은 SVG 한 곳·누름 기록·캔버스 밖 누름은 비움 / 끌기에 쓴 Alt / 손잡이의 기준점에 움직인 만큼).
- [ ] **Step 4: `ROADMAP.md`** — '2026-09-21 배경 라이브러리' 절의 `- [x] 2026-10-08 main 통합…` 줄 다음에 `- [x] 2026-10-08 ① 평면 편집 기본기(v1.131.0)`로 시작하는 한 줄(네 기능 이름과 설계 문서 경로). 파일 끝 `### v1.130.0 …` 절 다음에 `### v1.131.0 배경 도면 ① 평면 편집 기본기 (2026-10-08)` 절: 네 기능을 `- [x]` 네 줄(확대·축소 / 이름 바로 짓기 / 스냅 / 다각형 점 편집 — 설계 1.1의 소제목 순서와 내용), 남은 것을 `- [ ]`로(설계 13절 수동 검증, 배포 뒤 실기: 터치패드 벌리기·휠 감도·설치 앱에서의 저장).
- [ ] **Step 5: 인수인계 문서** — `DEVLOG/background-3d-opus-handoff-2026-10-07.md` 끝에 `## 15. ① 평면 편집 기본기 (v1.131.0)`: 설계 문서와 이 계획의 위치, 바뀐 파일(이 계획의 File structure), 뒤 묶음이 지켜야 할 것(화면 배율값 하나 / `snapMove`의 id 집합과 닿는 거리 / 넘기기는 `click`에서 / 더블클릭은 SVG에서 누름 기록으로, 캔버스 밖 누름은 기록을 비운다 / ②가 정해야 하는 넘기기 조건 — 설계 11절).
- [ ] **Step 6: 라운드 계획** — `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 `### B1` 목록에 설계 문서·이 계획의 링크와 상태 한 줄을 더하고, `## 7. 진행 기록` 표의 ① 줄 상태를 `2026-10-08 구현 완료(v1.131.0) · 수동 검증·배포 대기`로 바꾼다. 다른 줄은 손대지 않는다.
- [ ] **Step 7: 전체 게이트** — `npm run build:vite`(typecheck → 모든 테스트 묶음 → `vite build` → 개발용 manifest). 성공은 종료 코드만이 아니라 로그로 본다: 배경 묶음의 `# fail 0`·`# skipped 3`, `vite build`의 `✓ built in …`, 마지막 manifest 생성 줄. `npm run build`(배포 빌드)는 돌리지 않는다.
- [ ] **Step 8: 커밋** — 일곱 파일(빌드 산출물은 올리지 않는다) / `v1.131.0: 배경 도면 ① 평면 편집 기본기 — 버전·업데이트 내역·문서`. 커밋 전에 `git status --short docs/superpowers/plans/`를 본다: 이 계획 파일이 `??`로 남아 있으면(오케스트레이터가 Task 1 전에 커밋하지 않았다) 이 커밋에 함께 넣는다 — Step 5·6이 가리키는 파일이 레포에 있어야 한다.

**이 Task가 끝나면:** 코드는 Task 12와 같고, 앱의 업데이트 내역 맨 위에 1.131.0 항목이 보인다. 배포·PR·머지는 한솔이 말할 때만 한다.

### 최종 수동 검증 — 설계 13절 전체 (Task 13 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- 방법과 범위: 설계 13절 머리말 그대로. 모든 항목(E1~E6, Z1~Z13, N1~N18, S1~S12, P1~P12, R1~R6)을 1440×900 어두운 화면에서 보고, ★ 항목은 1440×900 밝은 화면·740×900 어두운·밝은 화면에서 다시 본다. '(740)' 항목은 740×900에서 본다. Z7의 Ctrl + `+`를 확인한 뒤에는 Ctrl + `0`으로 앱 배율을 되돌린다.
- 결과를 `DEVLOG/background-library-verification-2026-09-21.md`의 `## 2026-10-08 ① 평면 편집 기본기 (v1.131.0)`에 적는다: typecheck·`test:background`·`build:vite` 수치, E1~E6과 N13·N15·S12의 관찰 그대로, 확인하지 못한 것(실제 터치패드 벌리기, 한솔 PC의 휠 감도, 설치 앱에서의 저장).
- 조정할 때 건드리는 곳(설계 16절): S12에서 너무 자주 붙거나 옆방과 줄이 잘 안 맞으면 **`MAP_SNAP.reachPx` 하나만**(24~96px) · 벌리기 감도는 `wheelZoomFactor`의 pinch 계수 0.01만 · N14에서 글자가 빠지면 E2의 대체안(`compositionend` 뒤 확정) · N15의 포커스 테두리는 기록만 하고 손대지 않는다 · 관문 A·B에서 대체안으로 바꾼 것이 있으면 Task 12의 앵커와 인수인계 문서 15절도 그에 맞춘다.

---

## 완료 보고에 적을 것

설계 16절에서 옮겼다. 승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이므로, 완료 보고에 비개발자 문장으로 적는다.

- **겹친 카메라를 빠르게 누를 때**: 편집 중에는 빠른 두 번 클릭이 '다음 카메라로'가 아니라 '이름 고치기'가 된다. 천천히 누르면 지금처럼 넘어간다. 불편하면 대안은 "묶음 안에서는 둘째 클릭도 넘기고, 이름은 F2로만"인데, 승인 문구("카메라는 더블클릭하면 이름을 고친다")를 묶음에서 접는 것이라 한솔이 골라야 한다. (N13에서 본 그대로 적는다.)
- **새로 그린 도형의 소수 좌표**: 그리기 도구는 스냅 대상이 아니다. 새로 그린 사각형·타원·다각형과 새로 놓은 기호는 이번에도 소수 좌표로 생기고, 그 뒤에 옮기면 위치가, 크기를 바꾸면 길이가, 점을 끌면 그 점이 정리된다. 그릴 때부터 붙고 정수로 떨어지게 하려면 범위를 넓히는 결정이 필요하다.
- **상세 도면이 연결된 공간의 더블클릭**이 편집 중과 이동 도구에서도 열리게 된다. v1.130.0에서는 안내 문구와 달리 보기 모드에서만 열렸다.
- **멀리 있는 도형과는 줄을 맞춰 주지 않는다**: 붙는 상대는 끄는 것에서 화면 48px 안에 있는 것뿐이다. '멀리서 줄 맞추기'가 필요하면 닿는 거리를 늘리거나 따로 정해야 한다. S12에서 본 느낌(안내선이 보이는 때와 안 보이는 때, 50%와 작은 의자에서)을 함께 적는다.
- **방을 옮길 때 가까운 가구·카메라에도 붙는다**: 종류로 거르지 않았다. 거슬리면 "방은 방과 도면 테두리에만, 가구·카메라는 자기 방과 그 방 안의 것에만 붙는다"로 좁힐 수 있다 — 승인된 대상을 줄이는 것이라 한솔이 골라야 한다.
- (엔진 확인에서 생긴 것이 있을 때만) 관문 A의 E3이 실패했다면 한솔이 고른 쪽, 관문 B에서 대체안으로 바꾼 것.
