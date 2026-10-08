# 배경 도면 ① 평면 편집 기본기 — 설계 (2026-10-08)

> 요청(한솔, 도면 피드백 2차): 확대·축소, 이름 바로 짓기, 스냅, 다각형 점 편집
> 승인: 2026-10-08 (라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md` §1 "① 묶음 설계 — 승인")
> 버전: v1.131.0 · 운영 DB 변경 없음 · 저장 자료 변경 없음 · 3D 화면 변경 없음 · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: 브랜치 `claude/bg-map-editing-basics` (= main v1.130.0, d8325afb). 아래 줄 번호는 이 커밋에서 직접 확인했다.
> 검토 반영(2026-10-08): 더블클릭은 SVG 한 곳에서 누름 기록으로 판정(5.6) · 크기 네모는 없애지 않고 비켜 세움(3.2) · 손잡이는 누른 자리가 아니라 움직인 만큼(3.3) · 그리기는 스냅 대상 아님(1.2, 6.1) · 고른 점은 보이는 손잡이에서만(7.3) · 이름 칸의 Ctrl+Z와 내려갈 때의 blur(5.5) · 단축키는 버튼 포커스에서도(4.4) · 아래 줄 힌트 고정(10.1). 한솔에게 알릴 것은 16절 '완료 보고에 적을 것'.
> 2차 검토 반영(2026-10-08): 스냅은 **가까이 있는 것만** — 다른 축으로 화면 48px 안(6.1의 2·3, 6.2) · 다각형 점이 붙는 곳은 승인 문구의 둘뿐(옆 점의 가로·세로, 다른 공간의 모서리 — 3.3, 7.1의 7) · 끌기에 쓴 Alt는 마우스와 Alt 중 무엇을 먼저 떼든 창 메뉴로 새지 않게(6.5) · 캔버스가 받지 않은 누름은 노드 더블클릭(이름 고치기·상세 도면으로 들어가기)의 첫 누름이 될 수 없다(3.4, 5.6).

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 승인된 범위의 전부이며, 적히지 않은 동작은 만들지 않는다.

용어: **화면 배율값**(`screenScale`) = 평면 캔버스의 CSS 1px 이 도면 좌표 몇 단위인지. **제스처** = 포인터를 누른 뒤 뗄 때까지의 한 번의 끌기(`mapDocument.ts`의 gesture). **초안** = `mapDocument.ts`가 들고 있는 편집 중인 도면 값.

---

## 1. 목표와 범위

### 1.1 만드는 것 (승인 문구 그대로)

**확대·축소**
- 평면에서 마우스 휠을 굴리면 마우스가 가리키는 곳을 중심으로 확대·축소된다. 터치패드 두 손가락 벌리기도 된다.
- '맞춤'은 그려 둔 것 전체가 한눈에 보이게 맞춘다(지금은 처음 크기로만 돌아간다).
- 크기·회전 손잡이는 확대 정도와 상관없이 늘 같은 크기로 보인다.
- 지금보다 더 멀리 축소할 수 있고, 키보드 + − 0 으로도 된다.
- 좁은 창에서는 도면 위에서 휠을 굴리면 페이지가 내려가는 대신 확대·축소가 된다(3D 화면과 같은 동작).

**이름 바로 짓기**
- 네모·원·다각형을 그리면 그 자리에 이름 칸이 바로 열린다. Enter나 다른 곳 클릭으로 확정, Esc면 '새 공간'으로 남는다.
- 상세 도면이 없는 공간, 기호, 카메라는 더블클릭하면 이름을 고친다.
- 상세 도면이 연결된 공간은 지금처럼 더블클릭하면 들어가고, 이름은 F2 키나 오른쪽 속성 칸에서 바꾼다.
- 그리기와 이름 짓기는 되돌리기 한 번으로 함께 취소된다.

**스냅**
- 옮기거나 크기를 바꿀 때, 다른 도형의 가장자리·가운데나 도면 테두리에 가까워지면 착 붙는다. 붙는 순간에만 가는 안내선이 보인다.
- 붙지 않은 위치·크기는 소수점 없이 떨어진다. 붙은 쪽은 상대 도형과 정확히 같은 값을 쓴다.
- 돌릴 때는 수평·수직(0°, 90°, 180°, 270°) 근처에서 살짝 걸린다.
- 도면 아래에 '스냅' 켜기/끄기 버튼을 두고, Alt를 누른 채 끌면 그때만 자유롭게 놓인다.
- 늘 깔려 있는 점 눈금은 만들지 않는다.

**다각형 점 편집**
- 편집 중에 다각형을 고르면 꼭짓점마다 작은 동그라미가 나타나고, 끌면 그 점만 움직인다.
- 변 가운데의 '+'를 끌면 점이 새로 생기고, 점을 고른 뒤 Delete를 누르면 지워진다(최소 3개는 남는다).
- 점도 옆 점과 가로·세로가 맞는 자리, 다른 공간의 모서리에 붙는다.
- 점을 옮겨도 그 공간 안의 카메라와 가구는 제자리에 있다.
- 네모 공간을 다각형으로 바꾸는 버튼을 넣어 ㄱ자 방을 만들 수 있게 한다.

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 네 모서리 모두에서 크기 바꾸기 | 승인 범위 밖. 오른쪽 아래 손잡이 그대로. 다각형의 점 손잡이와 겹칠 때도 없애지 않고 모서리 바깥으로 비켜 세운다(3.2) |
| 3D 화면에서의 스냅 | 승인 범위 밖. `mapSnap.ts`는 three.js 없이 만들어 나중에 기즈모가 부를 수 있게만 둔다 |
| 여러 개 고르기·묶어 옮기기, 겹친 네모를 따로 잡기 | 다음 묶음 ② |
| **그리기 도구**(사각형·타원·다각형)로 새로 그릴 때의 스냅·정수 맞춤 | 승인 문구의 스냅은 "옮기거나 크기를 바꿀 때"와 회전, 다각형 점 끌기다. 새 도형은 v1.130.0처럼 누르고 끈 자리 그대로 생기고(안내선 없음, 소수 좌표), 그린 뒤 옮기면 위치가, 크기를 바꾸면 길이가, 점을 끌면 그 점이 붙고 정리된다. 세 그리기 도구가 같은 규칙이다 |
| 기호를 놓을 때·카메라를 만들 때의 스냅 | 옮기기·크기 바꾸기가 아니다. 카메라는 고정 생성점(500, 340) 그대로 |
| **멀리 떨어진** 도형과 줄 맞추기 | 승인 문구는 "가까워지면 착 붙는다"다. 끄는 것에서 화면 48px 안에 있는 것의 가장자리·가운데에만 붙는다(6.1의 2·3). 도면 반대편 도형의 가장자리를 길게 늘인 선에는 붙지 않는다 |
| 다각형 점이 다른 도형의 변 중간·가운데, 기호·카메라, 도면 테두리에 붙기 | 승인 문구가 점에 대해 꼽은 것은 "옆 점과 가로·세로가 맞는 자리, 다른 공간의 모서리" 둘이다(7.1의 7) |
| 회전 각도를 정수로 맞추기 | 승인 문구는 위치·크기만 "소수점 없이". 각도는 0/90/180/270 걸림만 |
| 다각형 → 네모, 타원 → 다각형 바꾸기 | 승인 문구는 "네모 공간을 다각형으로" 한 방향뿐 |
| 카메라 몸통·기호 그림을 화면 크기로 고정 | 승인 문구는 "크기·회전 손잡이"만 |
| 확대 한계(400%) 올리기, 속성 칸 숫자 입력에 스냅 | 요청 없음 |

### 1.3 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | 평면 SVG·3D·보조 평면도는 `mapDocument.ts`의 초안 하나를 읽는다 | 문서 상태에 아무것도 더하지 않는다. `tests/backgroundMapDocument.test.ts:279`가 문서 키를 `coalescing·drafts·gesture·viewports` 넷으로 고정하고 있고 그대로 통과해야 한다 |
| R2 | 한 번의 끌기 = 되돌리기 한 단계 | 스냅·점 편집은 모두 `beginGesture → previewGesture… → finishGesture` 안에서 계산한다. 제스처가 끝난 뒤 따로 고쳐 쓰는 `update`는 없다 |
| R3 | 저장 자료·검증 계약 불변 | `types.ts`·`domain.ts`·SQL·`mapWorkflow.ts`·electron 쪽은 건드리지 않는다. 다각형 점은 지금 형식(상자 안 0~1 비율, 3~200개) 그대로 쓴다 |
| R4 | 3D 파일 불변 | `BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`·`BackgroundMapPlanPreview.tsx`·`mapPlanPreview.ts`·`mapCanvas.ts`·`mapSpatial.ts`를 고치지 않는다 |
| R5 | 상세 도면이 연결된 공간의 더블클릭은 그 도면으로 들어간다 | `openSpace` 분기를 이름 고치기보다 먼저 판정한다 |
| R6 | 늘 깔린 눈금 없음 | 안내선은 붙은 순간에만, 제스처가 끝나면 지운다. `<pattern>`·배경 격자를 추가하지 않는다 |
| R7 | 새 카메라는 `addMapCamera`의 고정 생성점 | `addCamera`(BackgroundMapEditor.tsx:283-293)는 손대지 않는다 |
| R8 | 배경 메뉴 노출 범위 불변 | `canAccessBackgroundLibrary`와 그 테스트는 건드리지 않는다 |
| R9 | 테스트는 Node type-stripping으로 돈다 | 새 `.ts` 모듈은 `.ts` 확장자 상대 import, 지울 수 있는 TypeScript만(enum·namespace·매개변수 속성 금지), 경로 별칭 금지 |

---

## 2. 현재 동작 (v1.130.0)

파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다.

| 주제 | 지금 | 위치 |
|---|---|---|
| 도구 | `select · hand · rect · ellipse · polygon · symbol`. 평면 도구줄은 선택·이동과 편집 중일 때 사각형·타원·다각형 | BackgroundMapEditor.tsx:24, :558-562 |
| 포인터 세션 | `PointerSession.mode` = `pan · click · move · resize · rotate · draw`. `initial`은 누른 순간의 초안, `matrix`는 누른 순간의 화면→도면 변환, `stack`은 겹친 카메라·기호 묶음 | :27-33 |
| 누르기 | 가드 → `preventDefault` → **SVG에 포커스**(열려 있던 숫자 칸이 여기서 확정된다) → 살아 있는 초안 읽기 → 겹친 묶음 판정 → 다각형 점 추가 / 기호 놓기 → 모드 결정 → `beginGesture` → 세션 기록 → 포인터 캡처 | :419-455 (포커스 :425, 초안 :428, 묶음 :430-437, 모드 :445-449) |
| 끌기 | 4px 넘게 움직여야 시작. `pan`은 보기만 옮기고, 나머지는 `session.initial`에서 다시 계산해 `previewGesture` 한 번 | :456-483 (move :466, draw :467-470, resize :471-474, rotate :475-481) |
| 화면 옮기기 | 빈 곳을 끌거나, 손 도구로 끌거나, 휠 버튼으로 끌면 `pan` 세션이 보기 값의 x·y만 바꾼다 | :420, :445, :463 |
| 떼기 | 움직였으면 `finishGesture`, 아니면 `cancelGesture`. 그리기가 끝나면 도구를 선택으로. **움직이지 않은 누름이 묶음 위였으면 여기서 다음 항목으로 넘긴다** | :485-503 (넘기기 :499-502) |
| 확대·축소 | 아래 버튼 − / ＋ 만. `zoomBy` → `zoomMapViewport`(보기 가운데 기준), 한계 0.25~4. SVG에 휠 처리 없음 | :504-508, :678 / mapDocument.ts:44, :174-179 |
| 맞춤 | `{ x: 0, y: 0, zoom: 1 }`로 되돌리기 | :678 |
| 보기 값 | 도면별 `MapViewport { x, y, zoom, selectedId }`. `set-viewport`는 저장·되돌리기와 무관 | mapDocument.ts:13, :130-134 |
| SVG | `viewBox = x y 1000/zoom 680/zoom`, 3D 모드에서는 **SVG가 통째로 내려간다** | :608, :660 |
| 캔버스 크기 | `ResizeObserver`가 `canvasSize`를 잰다. 효과의 의존값은 `[current?.id, mode]` | :146, :171-180 |
| 글자 크기 | `labelScale = clamp(1 / (min(w/1000, h/680) × zoom), 0.4, 4)`를 CSS 변수로 | :163, :608 / backgrounds-map.css:52-53, :71, :175 |
| 손잡이 | **도면 단위 고정**. 공간·기호: 회전 원 r 7(위로 28/25), 크기 네모 12×12. 카메라: 방향 원 r 7을 80 떨어진 곳에, 부채꼴이 짧으면(72 미만) 점선 | :647-659 |
| 그리는 중 다각형 점 | r = `4 / view.zoom` | :645 |
| 이름 | 속성 칸의 이름 입력뿐(`patchNode({ name }, 'name')`). 새 공간 이름은 '새 공간' | :684, :399-401 |
| 더블클릭 | 노드 `<g>`의 `onDoubleClick`으로 받게 쓰여 있다. 공간: 선택·이동 도구일 때 `openSpace`(살아 있는 상세 도면이 있을 때만 이동). 기호·카메라: 전파만 막는다. 빈 곳(SVG): 다각형 도구면 완성. **실제로는** 포인터를 캡처한 누름 뒤의 `click`·`dblclick`이 SVG로 가서 `<g>`의 처리기가 불리지 않는다. 그래서 상세 도면은 캡처 없이 끝나는 누름(보기 모드 + 선택 도구, 편집 중의 잠긴 공간)에서만 더블클릭으로 열리고, 편집 중의 보통 공간과 이동 도구에서는 열리지 않는다 | :409-412, :612, :623, :637, :608 / 캡처 :450-454 |
| 다각형 | 그릴 때 `polygonSpace`가 점들의 상자와 0~1 비율 점을 만든다(변 10 미만·넓이 1 미만·3점 미만은 거절). 그리기 도구는 직전 점에서 **도면 1단위** 안의 누름을 같은 점으로 보고 버린다. 완성 뒤에는 통째 이동·크기·회전만 | :402-408, :439-441 / mapGeometry.ts:63-73 / types.ts:14-16 / domain.ts:44-46 |
| 공간 변형 | `transformMapSpace`가 x·y·크기·회전 변화를 이동/비율로 보고 잠기지 않은 소속 카메라·기호를 함께 옮긴다 | mapGeometry.ts:27-50 |
| 키보드 | 루트 `onKeyDown`. Escape(제스처 취소 → 도구 초기화)는 입력 칸 가드 **앞**에서 처리. 그 뒤 Ctrl+D, Ctrl+Z/Y, Delete(노드 삭제 확인) | :509-522, :569 |
| 속성 숫자 칸 | 위치·크기·회전을 직접 입력할 수 있다 | :726-727 |
| 기기별 기억 | 도면 높이만 `localStorage`의 `bflow.background-map.panel-height.v1` | BackgroundMapPanels.tsx:4-17 |
| 3D의 휠 | three.js `OrbitControls`가 캔버스에 직접 건다. 배경 기능 안에 `wheel` 코드는 없다 | BackgroundMap3D.tsx:181, :658-661 |

### 이전 분석에서 바로잡은 것

| 이전 분석 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| "두 번째 누름은 `event.detail >= 2`로 알아낸다" | 누르기는 `onPointerDown`으로 받는다(:608, :612, :623, :637). 웹 표준에서 pointerdown의 `detail`은 0이고 클릭 횟수는 `click`·`dblclick`(과 mousedown)만 실어 온다. 게다가 누르기에서 `preventDefault`를 하므로(:423) mousedown은 오지 않는다. 앱 엔진 탐침에서 `click`의 `detail`은 1, 2로 왔다(아래 줄). 앱 안에서의 확인은 13절 E1 | 겹친 것 넘기기를 떼기(`pointerUp`)에서 **`click` 이벤트**로 옮기고 거기서 `detail`을 본다(5.6) |
| "더블클릭은 노드 `<g>`의 `onDoubleClick`에서 받는다. 지금도 편집 중에 공간을 더블클릭하면 상세 도면이 열린다" | 세션을 여는 누름은 모두 SVG가 포인터를 캡처한다(:453-454): 편집 중 선택 도구로 잠기지 않은 노드를 누르는 경우(move), 이동 도구(pan), 겹친 묶음 위의 누름이 다 여기에 든다. 캡처 없이 끝나는 것은 다각형 점 찍기(:438-443), 기호 놓기(:444), 묶음이 아닌 것 위의 단순 누름(:450 — 보기 모드의 노드, 편집 중의 잠긴 노드)뿐이다. 앱 엔진(Electron 33.4.11 / Chromium 130.0.6723.191)에 `pointerDown`과 같은 순서(`preventDefault` → SVG 포커스 → `setPointerCapture`)의 탐침 쪽을 띄워 실제 입력을 넣어 보면, 캡처한 누름 뒤의 `pointerup`·`click`(detail 1, 2)·`dblclick`의 대상은 모두 SVG이고 `<g>`의 `dblclick` 리스너는 불리지 않는다. React도 `nativeEvent.target`에서 위로 올라가므로 `<g>`의 prop을 건너뛴다 | 더블클릭을 **SVG 한 곳**에서 받고, 무엇을 눌렀는지는 누를 때 적어 둔 기록으로 판정한다(5.6). 승인된 "연결된 공간은 더블클릭하면 들어간다"가 편집 중에도 실제로 된다 |
| "위치·크기를 마지막에 모두 정수로" | 기존 노드는 소수 좌표다(244.65 등). 붙은 뒤 반올림하면 틈이 생긴다 | 붙은 축은 대상 값 그대로, 붙지 않은 축만 정수(6.4) |
| "가장자리·가운데는 `nodePlanOutline`에서" | 가운데±반으로 구한 오른쪽 끝은 `x + width`와 마지막 자리가 다르다(100 + 144.65/2 + 144.65/2 = 244.64999999999998) | 회전 0°·180°는 저장 값에서 직접(`x`, `x + width`) 구한다(6.2) |
| "`snapMove(initialMap, id, …)`" | 다음 묶음이 묶음 이동을 한다 | 처음부터 id **집합**과 기준 노드를 받는다(6.2) |
| "휠 리스너를 효과에서 SVG에 건다" | SVG는 3D 모드에서 내려갔다 다시 올라온다 | 효과 의존값을 기존 크기 재기 효과와 같이 `[current?.id, mode]`로(4.3) |
| "확대 한계만 0.1로" | 글자 크기 상한 4가 지금의 최소 확대 0.25와 짝이다 | 상한을 `1 / MAP_ZOOM_LIMITS.min`으로 묶는다(3.1) |
| "맞춤은 `mapPlanBounds`에 맞춘다" | 그대로 맞추면 삐져나온 도형이 캔버스 가장자리에 붙는다 | 삐져나온 쪽에만 여백을 준다. 기본 영역 안의 도면은 지금과 똑같이 100%·(0, 0)(4.2) |

---

## 3. 공통 바탕

### 3.1 화면 배율값 하나 (`mapDocument.ts`)

```ts
export const MAP_ZOOM_LIMITS = { min: 0.1, max: 4 } as const;            // min 0.25 → 0.1
/** Bounds of the label size factor. The upper bound follows the zoom floor. */
export const MAP_LABEL_SCALE_LIMITS = { min: 0.4, max: 1 / MAP_ZOOM_LIMITS.min } as const;   // { 0.4, 10 }
/** Map units covered by one CSS pixel of the plan canvas. */
export function mapScreenScale(zoom: number, canvas: { width: number; height: number }): number;
```

- `mapScreenScale` = `1 / (Math.min(canvas.width / MAP_PLAN_EXTENT.width, canvas.height / MAP_PLAN_EXTENT.height) × zoom)`. `canvas`의 값이 0 이하이거나 유한하지 않으면 기본 영역 크기(1000×680)로 계산한다. 지금 `labelScale` 식(:163)의 가운데 부분과 같은 식이다.
- 편집기는 렌더마다 한 번 `const screenScale = mapScreenScale(view.zoom, canvasSize)`를 구하고, **손잡이 크기·스냅 허용 거리와 닿는 거리·안내선 여유·점 손잡이** 모두 이 값 하나만 쓴다. 다음 묶음의 선택 상자 여유, 주석 핀도 이 값을 쓴다.
- `labelScale = Math.min(MAP_LABEL_SCALE_LIMITS.max, Math.max(MAP_LABEL_SCALE_LIMITS.min, screenScale))`. 결정 근거: 상한을 4로 두고 최소 확대만 0.1로 내리면 이름이 6px까지 줄어든다. 상한을 최소 확대의 역수로 묶으면 지금과 같은 관계가 유지된다: 1000×680 이상의 캔버스에서는 최소 확대까지 글자 크기가 그대로이고, 그보다 작은 캔버스에서는 지금처럼 최소 확대 근처에서 조금 줄어든다(새 10%에서의 글자 크기 = 지금 25%에서의 글자 크기).
- 확대 한계 결정: **10%~400%**. 10%면 10000×6800 단위가 한 화면에 들어온다. 더 낮추면 카메라 몸통(도면 단위 11)이 1px 아래로 내려가 눌러 고를 수 없다. 400%는 요청이 없어 그대로 둔다.

### 3.2 화면 크기 상수와 손잡이 배치 (`mapPlanEdit.ts`, 새 파일)

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
  | { kind: 'box'; radius: number; lift: number;
      /** The resize square. `shifted`: it stands diagonally outside the corner, clear of a point handle on that corner. */
      resize: { x: number; y: number; size: number; shifted: boolean } | null };
/** Handle geometry of the selected node, in the node's own frame (the frame of its <g> transform). */
export function planNodeHandles(node: BackgroundNode, scale: number, vertexHandles: boolean): PlanNodeHandles;

export type PlanVertexHandles = { vertices: BackgroundPoint[]; edges: { index: number; point: BackgroundPoint }[] };
/** Absolute plan positions of the point handles of a polygon space, or null when none are shown. */
export function planVertexHandles(space: BackgroundSpace, scale: number): PlanVertexHandles | null;

/** The node a double-click acts on: the target of its first press while that belongs to the pile under the pointer, else the node that was hit. */
export function doubleClickNodeId(firstPressId: string | null, hitId: string, pile: readonly string[]): string;

export const MAP_SNAP_PREFERENCE_KEY = 'bflow.background-map.snap.v1';
export function readSnapPreference(): boolean;          // 'off' → false, anything else or no storage → true
export function storeSnapPreference(enabled: boolean): void;   // writes 'on' / 'off'; storage errors are swallowed
```

`planNodeHandles` 규칙(s = `scale`):

- 공간·기호(`kind: 'box'`): `radius = 7s`, `lift = 28s`(공간) / `25s`(기호). 그리는 쪽은 회전 원을 `(width/2, −lift)`에, 줄기를 `(width/2, 0) → (width/2, −lift)`에 둔다.
- 크기 네모: 보통 `{ x: width − 6s, y: height − 6s, size: 12s, shifted: false }` (모서리 가운데 정렬, 지금과 같은 자리).
  - **없는 경우(`null`)는 하나뿐**: `Math.max(width, height) / s < 12` — 화면에서 긴 변이 12px보다 작은 도형(네모 손잡이 자체보다 작다). 네모가 몸통을 덮어, 옮기려던 끌기가 크기 바꾸기가 되는 사고를 막는다. 이때 몸통을 끌면 옮겨지고, 크기는 확대해서 바꾸거나 속성 칸에 입력한다. 문턱을 더 높이지 않는 이유: 도면 영역이 낮은 창에서는 100%에서도 도면 1단위가 화면 0.5px쯤이라, 40×40 기호가 20px 안팎이다. 그 크기에서는 손잡이가 계속 보여야 한다.
  - **비켜 서는 경우**: `vertexHandles`가 참이고 다각형의 어떤 점 p가 `(1 − p.x) × width < 15s && (1 − p.y) × height < 15s`이면(15 = 네모의 반 변 6 + 점 손잡이의 누르는 범위 9: 그 점의 누르는 범위가 네모에 닿는다) `{ x: width + 8s, y: height + 8s, size: 12s, shifted: true }` — 네모의 가운데가 모서리에서 가로·세로 14px(`resizeShift`)씩 바깥이다. 그리는 쪽은 모서리 `(width, height)`에서 네모의 가까운 모서리 `(x, y)`까지 짧은 줄기를 긋는다(9절).
    - 근거: 사각형에서 바꾼 다각형은 오른쪽 아래 모서리에 점 (1, 1)이 있고, ㄱ자·ㄴ자 방도 그 점을 계속 가진다. 점 손잡이(누르는 범위 9px)는 맨 위에 그려져 12px 네모를 덮는다. 네모를 없애면 이번 묶음이 만들게 하려는 바로 그 방들의 크기를 평면에서 끌어 바꿀 수 없게 된다(v1.130.0은 다각형에도 늘 네모가 있다, :657). 승인 범위는 "오른쪽 아래 손잡이 그대로"이므로 없애지 않고 비켜 세운다.
    - 비켜 선 네모의 가까운 모서리는 상자 모서리에서 약 11.3px(8√2) 떨어져 있어, 상자 안 어느 점의 누르는 범위(9px)와도 겹치지 않는다. 점과 네모를 각각 누를 수 있다.
    - 그 점을 모서리에서 멀리 옮기면 네모는 모서리로 돌아온다. 점 손잡이가 보이지 않을 때(다른 도구, 화면에서 32px보다 작음)는 겹칠 것이 없으므로 늘 모서리에 있다.
  - 네모가 어디에 서 있든 크기 바꾸기는 **누른 뒤 움직인 만큼** 모서리를 옮긴다(3.3). 비켜 선 네모를 눌러도 모서리가 포인터 자리로 튀지 않는다.
- 카메라(`kind: 'camera'`): `radius = 7s`, `distance = Math.max(80, 40s)`. **결정**: 방향 원은 지금처럼 부채꼴 끝(도면 80)에 두되, 그 거리가 화면에서 40px보다 짧아지면 40px에서 멈춘다. 근거: 멀리 축소했을 때 화면 크기 원이 카메라 몸통 위로 겹쳐, 카메라를 옮기려던 끌기가 방향 돌리기가 되는 것을 막는다.
- 카메라 점선: `fan = 80 × Math.hypot(direction.x, direction.y)`(지금의 `reach`, :648), `body = 수직이면 18, 아니면 12`. `fan < distance − 8s`이면 `guide = { from: Math.max(body, fan), to: distance − 7s }`, 아니면 `null`. s = 1일 때 지금 식(`reach < 72` → 12|18…73, :651)과 같다.

`planVertexHandles` 규칙: `space.shape !== 'polygon'`, `space.locked`, 점 3개 미만, `Math.max(width, height) / s < 32` 중 하나면 `null`(화면에서 32px보다 작은 다각형은 점 손잡이의 누르는 범위가 몸통을 다 덮는다). `vertices = nodePlanOutline(space)`(저장 순서 그대로의 절대 좌표). `edges`는 점이 200개 미만일 때, 화면 길이가 28px 이상인 변(`i` → `(i + 1) % n`)의 가운데점이며 `index = i`.

### 3.3 제스처 한 번의 미리보기를 순수 함수로 (`mapPlanGesture.ts`, 새 파일)

지금 `pointerMove` 안에 있는 move·draw·resize·rotate 계산(:465-481)을 순수 모듈로 옮기고, 스냅과 점 편집을 거기에 더한다. 편집기의 `pointerMove`는 "포인터 좌표를 구해 이 함수를 부르고 결과를 미리보기로 보낸다"만 남는다.

```ts
export type PlanGesture =
  | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
  | { mode: 'draw'; node: BackgroundSpace }
  | { mode: 'vertex'; nodeId: string; index: number; insert: boolean };
export type PlanGestureSnap = { candidates: SnapCandidates; /** map units */ tolerance: number;
  /** Map units: how far away on the other axis a target may be and still count (move and resize, 6.2). */ reach: number };
export type PlanGesturePreview = { map: BackgroundMap; guides: SnapGuide[] };

/** Snap targets of one gesture, from the map as it was at the press. */
export function planGestureCandidates(gesture: PlanGesture, initial: BackgroundMap): SnapCandidates;
/**
 * The draft a gesture shows for one pointer position. Pure: the same arguments give the same result whatever
 * was previewed before. `snap` null is the free drag: nothing sticks and nothing is rounded. Returns null when
 * this position cannot be shown (the caller keeps the last preview).
 */
export function previewPlanGesture(gesture: PlanGesture, initial: BackgroundMap, start: BackgroundPoint,
  point: BackgroundPoint, snap: PlanGestureSnap | null): PlanGesturePreview | null;
```

`delta = point − start`. 노드는 `initial.nodes`에서 `nodeId`로 찾고, 없으면 `null`.

| mode | `snap === null` (자유 끌기: 표 아래의 한 가지를 빼면 지금과 같아야 한다) | `snap` 있음 |
|---|---|---|
| move | `moveMapNode(initial, nodeId, delta)` | `r = snapMove(initial, [nodeId], nodeId, delta, candidates, tolerance, reach)` → `placeMapNode(initial, nodeId, r.position)`, 안내선 `r.guides`. `r`이 `null`이면 왼쪽 칸과 같다 |
| draw | `{ ...node, x: min(start.x, point.x), y: min(start.y, point.y), width: max(10, abs(delta.x)), height: max(10, abs(delta.y)) }`를 `initial.nodes` 끝에 붙인다 | **왼쪽 칸과 같다.** 그리기는 스냅 대상이 아니다(1.2). 안내선 없음 |
| resize | 카메라면 `initial` 그대로. 아니면 `corner = nodeResizeCorner(node) + delta`(6.3) → `resizeSpace(node, corner)` → 공간은 `transformMapSpace(initial, resized)`, 기호는 `replaceMapNode` | `snapResize(node, corner, candidates, tolerance, reach)`의 `node`로 같은 처리 |
| rotate | 카메라: `angle = normalizeDegrees(각도(point, 카메라))`. 공간·기호: `rotation = normalizeDegrees(node.rotation + 각도(point, 가운데) − 각도(start, 가운데))`. 공간은 `transformMapSpace`, 그 밖은 `replaceMapNode` | 위 각도를 `snapRotation`에 통과시킨다. 안내선 없음 |
| vertex | 다각형 공간이 아니면 `null`. `outline = nodePlanOutline(node)`, `base` = 옮기기면 `outline[index]`, 끼워 넣기면 `outline[index]`와 `outline[(index + 1) % n]`의 가운데점('+'가 그려진 자리). `target = base + delta`. `insert`면 `insertPolygonVertex(node, index, target)`, 아니면 `movePolygonVertex(node, index, target)`. 결과가 `null`이면 `null`, 아니면 `replaceMapNode(initial, shaped)` | `target` 대신 `snapPoint(target, candidates, tolerance).point`. 안내선은 그 결과 것. `reach`는 쓰지 않는다(점의 후보는 아래 표처럼 옆 점의 선과 다른 공간의 모서리뿐이다) |

`각도(a, c) = Math.atan2(a.y − c.y, a.x − c.x) × 180 / Math.PI`. 가운데 = `(x + width/2, y + height/2)`.

**손잡이를 누른 자리는 결과에 들어가지 않는다.** move·resize·vertex 모두 `delta`(누른 점에서 움직인 만큼)를 그 손잡이가 가리키는 기준점 — 노드의 저장 위치 / 오른쪽 아래 모서리(`nodeResizeCorner`) / 그 점 또는 변의 가운데 — 에 더한다. v1.130.0의 크기 바꾸기는 모서리를 포인터 자리로 가져갔다(`resizeSpace(node, point)`, :472): 네모의 가운데에서 벗어나 누르면 첫 움직임에 그만큼 모서리가 튀었다. 이번에는 크기 네모가 모서리 바깥에 설 수 있고(3.2), 점 손잡이의 누르는 범위(9px)가 스냅 허용 거리(6px)보다 넓다. 포인터 자리를 그대로 쓰면 비켜 선 네모는 모서리를 20px쯤 튀게 하고, 가로·세로가 맞아 있던 점은 가운데를 벗어나 누르기만 해도 붙는 범위 밖으로 나간다. 이 한 가지(첫 움직임에 튀지 않는다)를 빼면 `snap === null`의 결과는 v1.130.0과 같다.

`planGestureCandidates`:

| mode | 후보 |
|---|---|
| move · resize | `collectSnapCandidates(initial, snapTravellingIds(initial, [nodeId]))` — 그 노드와, 공간이면 함께 실려 가는 소속 항목을 뺀 6.1의 2의 대상 전부. 그 가운데 어느 것이 **가까이 있는지**는 포인터 자리마다 `snapMove`·`snapResize`가 `reach`로 거른다(6.2) |
| vertex | **승인 문구가 꼽은 둘뿐이다.** `withVertexNeighbours({ x: [], y: [], points: collectSnapCandidates(initial, new Set([nodeId])).points }, 옆 점 둘)`. ① `points` = 그 다각형을 뺀 **다른 공간**(사각형·다각형)의 꼭짓점 ② `x`·`y` = 옆 점 두 개의 가로·세로 선(축마다 2개)뿐. 옆 점 = 옮길 때 `(index ± 1) mod n`, 끼워 넣을 때 `index`와 `(index + 1) mod n`의 절대 좌표. 다른 도형의 가장자리·가운데 선, 기호·카메라(그 다각형 안에 있는 것 포함), 도면 테두리 선은 **넣지 않는다**(7.1의 7) |
| draw · rotate | 빈 후보 `{ x: [], y: [], points: [] }`(선을 쓰지 않는다) |

### 3.4 편집기의 포인터 흐름 (바뀌는 곳만)

```ts
type PlanHandle = 'resize' | 'rotate' | { index: number; insert: boolean };
/** What one press landed on. A double-click on the canvas is resolved from the last two of these (5.6). */
type PlanPress = {
  /** Topmost node under the press: the node whose element took the pointerdown. Null on empty canvas. */
  hitId: string | null;
  /** The node the press acted on (the pile member that was already picked). Null for a handle and for empty canvas. */
  targetId: string | null;
  handle: boolean;
};
type PointerSession = {
  mode: 'pan' | 'click' | 'move' | 'resize' | 'rotate' | 'draw' | 'vertex'; /* …기존 필드… */
  /** Map units per CSS pixel at the press: the snap tolerance and reach of the whole gesture. */
  scale: number;
  /** `vertex` mode: the dragged point, or the edge a new point is pulled out of. */
  vertex: { index: number; insert: boolean } | null;
  /** Snap targets, collected from `initial` on the first move that needs them. */
  candidates: SnapCandidates | null;
};
const NO_PRESSES: readonly [PlanPress | null, PlanPress | null] = [null, null];
const pressLog = useRef(NO_PRESSES);          // 편집기 안, 최근 두 번의 누름
```

**캔버스가 받지 않은 누름은 누름 기록을 비운다.** 기록의 두 칸이 "지금 이 더블클릭의 두 누름"이려면, 문서 안의 모든 누름이 기록에 적히거나(캔버스가 받은 누름) 기록을 비워야 한다(그 밖의 모든 누름). `pointerDown`은 SVG 안의 누름만 본다. 그래서 SVG 밖의 누름은 창 단위로 받아 비운다.

```ts
// A press the canvas did not take can never be the first half of a double-click on a node.
useEffect(() => {
  const forget = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !svgRef.current?.contains(event.target)) pressLog.current = NO_PRESSES;
  };
  window.addEventListener('pointerdown', forget, true);
  return () => window.removeEventListener('pointerdown', forget, true);
}, []);
```

- 막는 사고: 더블클릭의 **첫 클릭**이 캔버스 위에 떠 있다가 누르면 사라지는 것에 떨어지는 경우. 예 — 기존 공간 S 안에 다각형을 그린다(점을 찍는 누름마다 `hitId`가 S로 적힌다) → '다각형 완성' 버튼(`.bmap-polygon-actions`, 캔버스 위에 겹쳐 있다, backgrounds-map.css:82)을 더블클릭한다. 첫 클릭이 다각형을 끝내고 버튼 줄이 내려간다(:679는 다각형 도구일 때만 그린다). 둘째 클릭은 그 아래의 S에 떨어진다. 기록을 비우지 않으면 `[S(아까 찍은 점), S]`가 되어 S의 이름 칸이 열리거나(사용자는 새 방의 이름을 **S에** 치게 된다) S의 상세 도면으로 들어가 버린다. v1.130.0에서는 같은 더블클릭이 선택만 옮겼다. 같은 꼴: 다각형 줄의 '취소', 기호 팔레트의 항목(:602, 누르면 팔레트가 닫힌다), 닫히는 창의 버튼(`BackgroundModal`은 `<dialog>`를 포털로 그린다, BackgroundUI.tsx:36-37), 그리고 편집기 밖에서 그려져 캔버스를 덮을 수 있는 앱 단위의 창·알림.
- 창(window) 캡처에 거는 이유: 편집기 루트의 React 처리기로는 편집기 바깥에서 그려지는 것을 보지 못한다. 창 단위 하나면 포털·편집기 밖을 가리지 않고 "SVG 안이 아니면 비운다" 한 줄로 끝난다. `svgRef.current`는 누를 때 읽으므로 평면 ↔ 3D로 SVG가 바뀌어도 된다(3D에서는 SVG가 없어 늘 비운다). 시간·거리 상수는 쓰지 않는다.
- 운영체제가 둘째 클릭을 더블클릭으로 쳐서 `dblclick`을 SVG에 보내더라도(13절 E6에서 기록한다) 기록의 첫 칸이 비어 있어 아무 일도 하지 않는다. 보내지 않아도 결과는 같다.

`pointerDown(event, node?, handle?: PlanHandle)` — 기존 순서(:419-455)에 다음만 더한다.

1. 가드(:420)나 좌표 실패(:422)로 돌아갈 때는 그 전에 `pressLog.current = NO_PRESSES`. SVG 안의 누름이지만 편집기가 받지 않은 것(저장 중, 오른쪽 버튼, 이미 누르고 있는 포인터가 있음)이 낀 더블클릭도 아무 일도 하지 않게 된다(5.6). SVG 밖의 누름은 위의 창 단위 처리기가 비운다.
2. `svgRef.current?.focus()` 바로 뒤(초안을 읽기 전): `pendingCycle.current = null`. `handle`이 점 손잡이가 아니면 `setActiveVertex(null)`.
3. 겹친 묶음 판정(:430-437)이 끝난 뒤, 다각형 점 추가·기호 놓기로 돌아가기(:438-444) **전**: `pressLog.current = [pressLog.current[1], { hitId: node?.id ?? null, targetId: handle ? null : target?.id ?? null, handle: !!handle }]`. pointerdown은 캡처 전이라 실제로 눌린 요소의 처리기에 닿으므로, `node`는 포인터 아래 맨 위의 노드다.
4. 다각형 도구의 점 추가(:439-441): 같은 점으로 보는 거리를 도면 1단위에서 화면 4px로 바꾼다(4.3).
5. 모드 결정(:448): `mode = target.locked ? 'click' : typeof handle === 'object' ? 'vertex' : handle ?? 'move'`.
6. `mode === 'vertex'`이고 `beginGesture`가 성공하면, 끼워 넣기가 아닐 때 `setActiveVertex({ mapId, nodeId, index })`.
7. 세션에 `scale: screenScale`, `vertex`, `candidates: null`을 싣는다. 세션을 기록하는 그 자리에서 `if (event.altKey) altDrag.current = true;`(6.5).

`pointerMove` — 세션을 확인한 직후(:458 다음, 4px 문턱 앞)에 `if (event.altKey) altDrag.current = true;`(6.5)를 둔다. `pan`·`click` 분기(:463-464)는 그대로. 그 아래(:465-482)를 다음으로 바꾼다.

```ts
// 세션 → PlanGesture: draw 는 { mode, node: session.node }, vertex 는 { mode, nodeId, ...session.vertex }, 나머지는 { mode, nodeId }
const gesture = planGestureOf(session);
const snap = snapEnabled && !event.altKey
  ? { candidates: session.candidates ??= planGestureCandidates(gesture, session.initial),
      tolerance: MAP_SNAP.tolerancePx * session.scale, reach: MAP_SNAP.reachPx * session.scale }
  : null;
const preview = previewPlanGesture(gesture, session.initial, session.start, point, snap);
if (!preview) { showGuides(NO_GUIDES); return; }
doc.previewGesture(preview.map); showGuides(preview.guides);
```

`pointerUp` — 세션을 확인한 직후 `showGuides(NO_GUIDES)`. 확정 분기(:494-496)에서 그리기였으면 `setTool('select')` 뒤 `beginRename(session.node.id, true)`. 점 끼워 넣기였으면 `finishGesture` 뒤의 초안을 읽어, 그 다각형의 점이 `session.initial`보다 **하나 늘었을 때만** 새 점을 고른 점으로 한다.

```ts
if (session.mode === 'vertex' && session.vertex?.insert && session.node) {
  const points = (map: BackgroundMap | undefined) => {
    const item = map?.nodes.find(candidate => candidate.id === session.node!.id);
    return item?.type === 'space' ? item.points.length : -1;
  };
  const added = points(mapDraft(doc.getState(), session.mapId)?.value) === points(session.initial) + 1;
  setActiveVertex(added ? { mapId: session.mapId, nodeId: session.node.id, index: session.vertex.index + 1 } : null);
}
```

근거: 끄는 동안의 미리보기가 모두 거절되면(`previewPlanGesture`가 `null`: 넓이 1 미만, 한계 밖) 제스처는 바뀐 것 없이 끝난다(mapEditSession.ts:28-31). 그때 `index + 1`은 원래 있던 옆 점이라, 고른 점으로 두면 다음 Delete가 사용자가 고른 적 없는 점을 지운다.

넘기기(:499-502)는 `select` 대신 `pendingCycle.current = { ids, nodeId, mapId }`를 적어 두기만 한다(5.6).

`abortGesture`(:184-189) — `showGuides(NO_GUIDES)`를 더한다. `NO_GUIDES`는 편집기 파일 맨 위의 `const NO_GUIDES: readonly SnapGuide[] = [];` 하나다(매번 새 배열을 만들지 않게).

---

## 4. F9 확대·축소

### 4.1 동작 규칙

1. 평면 SVG 위에서 휠을 굴리면 **포인터가 가리키는 도면 좌표가 화면의 같은 자리에 남도록** 확대·축소한다. 보기 모드·편집 모드 모두, 저장 중(`disabled`)에도 된다(보기만 바뀐다).
2. 휠 한 칸(deltaY ±100)은 ×1.2214 / ×0.8187. 버튼(＋ ×1.25, − ×0.8)과 거의 같은 걸음이다.
3. 터치패드 두 손가락 벌리기(Chromium이 `ctrlKey`가 켜진 휠로 보낸다)는 더 잘게: 이벤트 하나에 최대 ×1.2214. Ctrl을 누른 채 굴리는 마우스 휠 한 칸도 같은 ×1.2214가 된다.
4. 한계는 10%~400%. 한계에서 더 굴리면 아무 일도 없다(페이지도 내려가지 않는다).
5. **SVG 위의 휠은 항상 `preventDefault`** 한다. 좁은 창(900px 이하, backgrounds-map.css:229-247)에서 도면 위 휠이 페이지를 내리지 않는다. 도구줄·기호 팔레트·아래 줄·이름 칸·속성 칸·이미지 그리드 위의 휠은 지금 그대로다(리스너를 SVG에만 건다).
6. 포인터를 누르고 있는 동안(`pointerRef.current`가 있거나 제스처가 진행 중)의 휠은 무시한다(`preventDefault`는 한다). 세션이 누른 순간의 변환과 보기 값을 들고 있기 때문이다(:453).
7. '맞춤' 버튼과 `0` 키: 그려 둔 것 전체가 보이게 맞춘다(4.2). 빈 도면과 기본 영역(0~1000 × 0~680) 안에만 그린 도면은 지금과 똑같이 100%·(0, 0)이 된다.
8. `+`(또는 `=`) / `-` 키: 버튼과 같은 걸음으로, 보기 가운데 기준.
9. 확대·축소·맞춤은 `set-viewport`만 보낸다. 저장되지 않고 되돌리기에 들어가지 않으며, 평면 ↔ 3D를 오가도 도면별로 남는다(지금과 같다).
10. 손잡이(회전 원·크기 네모·카메라 방향 원·점 손잡이)와 그리는 중인 다각형의 점은 확대 정도와 상관없이 같은 화면 크기다(3.2).

### 4.2 순수 함수 (`mapDocument.ts`)

```ts
/** Zoom while the plan point `anchor` keeps its place on screen. Same object back at a limit or for a broken input. */
export function zoomMapViewportAt(viewport: MapViewport, factor: number, anchor: BackgroundPoint): MapViewport;
/** Zoom factor of one wheel event. `pinch` is a ctrl-wheel (touchpad pinch). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number;
export const MAP_FIT_MARGIN = 0.04;
/** View that shows the whole plan bounds. A map inside the base extent gives { x: 0, y: 0, zoom: 1 }. */
export function fitMapViewport(map: BackgroundMap): Pick<MapViewport, 'x' | 'y' | 'zoom'>;
```

- `zoomMapViewportAt`: `zoom′ = clamp(zoom × factor, min, max)`. `zoom′`가 유한하지 않거나 `zoom`과 같거나 `anchor`가 유한하지 않으면 **받은 객체 그대로**. 아니면 `x′ = anchor.x − (anchor.x − x) × zoom / zoom′`, y도 같게. 근거: SVG는 `viewBox`를 캔버스 가운데에 맞춰 넣는데(`meet`), 좌우·상하 여백이 확대 값과 무관하므로 이 식이면 포인터 아래 점이 고정된다. 기존 `zoomMapViewport`(가운데 기준)는 버튼·키가 쓰므로 그대로 둔다.
- `wheelZoomFactor`: `deltaY`가 유한하지 않으면 1. `거리 = deltaY × (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)`. `pinch`면 `Math.exp(−clamp(거리, −20, 20) × 0.01)`, 아니면 `Math.exp(−clamp(거리, −180, 180) × 0.002)`. 간트의 휠 식(src/features/gantt/GanttCanvas.tsx:239-241)과 같은 꼴이다.
- `fitMapViewport`: `B = mapPlanBounds(map)`(기본 영역을 늘 포함한다, mapSpatial.ts:259-270). `g = MAP_FIT_MARGIN × Math.max(B.width, B.height × 1000 / 680)`. 왼쪽·위·오른쪽·아래 가운데 **기본 영역 밖으로 나간 쪽에만** `g`를 더해 상자 T를 만든다. `zoom = clamp(Math.min(1000 / T.width, 680 / T.height), min, max)`, `x = T 가운데 x − 1000 / (2 × zoom)`, `y = T 가운데 y − 680 / (2 × zoom)`.
  - 결정 근거: 캔버스 크기를 받지 않아도 된다(상자가 `viewBox` 안에 들어오면 어떤 캔버스 비율에서도 보인다). 여백을 나간 쪽에만 주므로 기본 영역 안의 도면은 정확히 지금의 처음 화면이 된다.
  - 내용이 10% 한계로도 다 들어오지 않을 만큼 넓으면(가로 약 10000 단위 초과) 10%로 두고 T의 가운데를 보여 준다.

설계 중 임시 스크립트로 계산한 값(테스트 기대값으로 쓴다):

| 호출 | 결과 |
|---|---|
| `zoomMapViewportAt(home, 2, {500, 340})` | `{ x: 250, y: 170, zoom: 2 }` (= `zoomMapViewport(home, 2)`) |
| `zoomMapViewportAt(home, 2, {0, 0})` / `{1000, 680}` | `{ x: 0, y: 0, zoom: 2 }` / `{ x: 500, y: 340, zoom: 2 }` |
| `zoomMapViewportAt(home, 0.5, {250, 170})` | `{ x: -250, y: -170, zoom: 0.5 }` |
| `wheelZoomFactor(100, 0, false)` / `(-100, 0, false)` | 0.8187307530779818 / 1.2214027581601699 |
| `wheelZoomFactor(3, 1, false)` / `(1000, 0, false)` | 0.9084640160687062 / 0.697676326071031 |
| `wheelZoomFactor(2, 0, true)` / `(100, 0, true)` | 0.9801986733067553 / 0.8187307530779818 |
| `fitMapViewport(빈 도면)`, `(기본 영역 안의 방 하나)` | `{ x: 0, y: 0, zoom: 1 }` |
| `fitMapViewport(방 x −500, y 100, 500×100)` | zoom ≈ 0.641026, x ≈ −560, y ≈ −190.4 |
| `fitMapViewport(방 x 50000, y 0, 100×100)` | `{ x: 21052, y: -3060, zoom: 0.1 }` |

(`home = { x: 0, y: 0, zoom: 1, selectedId: 'kept' }`. 결과의 `selectedId`는 그대로 남는다.)

### 4.3 편집기 배선

```ts
const onWheel = useEvent((event: WheelEvent) => {
  event.preventDefault();
  if (!current || pointerRef.current || doc.isGestureActive()) return;
  const anchor = pointFrom(event);
  if (!anchor) return;
  const live = mapViewport(doc.getState(), current.id);
  const zoomed = zoomMapViewportAt(live, wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey), anchor);
  if (zoomed !== live) updateView({ zoom: zoomed.zoom, x: zoomed.x, y: zoomed.y });
});
useEffect(() => {
  const svg = svgRef.current;
  if (!svg) return;
  svg.addEventListener('wheel', onWheel, { passive: false });
  return () => svg.removeEventListener('wheel', onWheel);
}, [onWheel, current?.id, mode]);
```

- **등록 위치 결정**: 네이티브 리스너를 SVG에, 의존값은 기존 크기 재기 효과(:171-180)와 같은 `[current?.id, mode]`. 근거: React의 `onWheel`은 passive라 `preventDefault`가 듣지 않는다. SVG는 3D 모드와 "도면 없음" 화면에서 내려가므로 평면 → 3D → 평면 뒤에 새 SVG에 다시 걸어야 한다. 바깥 `.bmap-canvas-wrap`에 걸면 3D 캔버스의 휠(OrbitControls)과 기호 팔레트의 스크롤을 가로채게 된다.
- 보기 값은 렌더 때의 `view`가 아니라 `doc.getState()`에서 읽는다(빠른 휠에서 이전 렌더 값으로 계산하지 않게).
- `zoomBy`(:504-508)는 그대로. `fitView()`를 더한다: `if (!current || pointerRef.current) return; updateView(fitMapViewport(current));`
- 아래 줄(:678): '맞춤' 버튼의 `onClick`을 `fitView`로, `title`을 `그려 둔 것 전체가 보이게 맞춤 (0)`으로. − / ＋ 버튼에 `title="축소 (−)"`, `title="확대 (+)"`를 더한다(`aria-label`은 그대로).
- `:163` → `screenScale`과 `labelScale`(3.1). `:645`의 `r={4 / view.zoom}` → `r={MAP_EDIT_MARK.polygonDot * screenScale}`.
- 다각형 도구가 같은 점으로 보는 거리(:441): `Math.hypot(last.x - point.x, last.y - point.y) < 1`(도면 단위) → `< MAP_EDIT_MARK.polygonDot * screenScale`(화면 4px, 끌기 문턱(:460)과 같은 거리).
  - 근거: 다각형을 더블클릭으로 끝내면 두 번째 누름도 점으로 찍힌 뒤에 완성된다(:438-443이 먼저 돌고 :608이 완성한다). 지금의 문턱은 도면 1단위인데, 화면 1px은 보통 캔버스의 100%에서 이미 도면 1단위를 넘고(좁은 창에서는 약 2.4단위) 새 최소 확대 10%에서는 10단위가 넘는다. 두 누름 사이의 1px 떨림이 끝점을 하나 더 만든다. v1.130.0에서는 보이지 않던 겹친 점이 F11에서는 겹친 점 손잡이 둘이 된다(하나를 끌면 다른 하나가 남고 '최소 3개' 계산에도 들어간다). 화면 배율값을 쓰는 다른 문턱과 같은 기준으로 맞춘다(3.1). 찍는 점의 좌표 자체는 지금처럼 포인터 자리 그대로다(1.2).
- `:647-659`의 손잡이 JSX는 `<MapNodeHandles>`로 옮긴다(9절).

### 4.4 키보드

`keyboard()`에서 Escape 분기(:510-515) 다음, **입력 칸 가드(:516-517) 앞**에 '평면 단축키' 묶음을 둔다. (Alt 키는 `keyboard()`가 아니라 창 단위 처리기 한 곳에서 다룬다, 6.5.) F2(5.4)도 이 묶음에서 처리한다. 조건(모두):

- `mode === 'plan'`
- Ctrl·Meta·Alt가 눌리지 않음, IME 조합 중이 아님(`event.nativeEvent.isComposing`)
- `event.target`이 `input, textarea, select, [contenteditable]:not([contenteditable="false"])` 안이 아니고 `dialog` 안이 아님

| 키 (`event.key`) | 동작 |
|---|---|
| `+` 또는 `=` | `preventDefault`, `zoomBy(1.25)` |
| `-` | `preventDefault`, `zoomBy(0.8)` |
| `0` | `preventDefault`, `fitView()` |
| `F2` | `selected`가 있으면 `preventDefault`, `renameSelected()`(5.4) |

처리한 키는 거기서 `return`한다.

- **버튼에 포커스가 있어도 듣는다.** 입력 칸 가드의 `interactive`에는 `button`이 들어 있어(:40), 가드 뒤에 두면 아래 줄의 − / ＋ / 맞춤(:678), 스냅, 도구 버튼, 오브젝트 목록의 줄(:112), 도면 트리의 줄을 누른 직후에는 캔버스를 다시 누를 때까지 키가 듣지 않는다. 버튼은 `+ = - 0`을 쓰지 않으므로 겹치지 않는다. 글자를 받는 곳(`input`·`textarea`·`select`·편집 가능한 영역)과 창(`dialog`) 안에서는 잡지 않는다.

일부러 잡지 않는 조합: **Ctrl(또는 Meta) + `+` / `=` / `-` / `0`**. 앱은 Electron 기본 메뉴를 바꾸지 않으므로(`electron/` 아래에 `setApplicationMenu` 호출이 없다) 이 조합은 앱 전체 화면 배율 단축키다. Alt 조합, 글자를 받는 칸에 포커스가 있을 때, 3D 모드도 잡지 않는다. 숫자 키패드의 + − 0 은 같은 `event.key`로 온다.

### 4.5 경계 상황

| 상황 | 동작 |
|---|---|
| 잠긴 노드 | 손잡이가 없다(지금과 같다). 확대·축소와 무관 |
| 보기 모드 | 휠·키·맞춤 모두 된다. 손잡이는 편집 중에만 |
| 끄는 중 | 휠·`zoomBy`·`fitView` 모두 무시 |
| 이름 칸이 열려 있을 때 | SVG 위 휠로 확대·축소되고 이름 칸이 노드를 따라간다. 키는 이름 칸의 글자로 들어간다 |
| 다각형을 그리는 중(점만 찍은 상태) | 확대·축소된다. 찍은 점은 도면 좌표라 제자리다 |
| 작은 도형 | 화면에서 긴 변이 12px보다 작으면 크기 네모가 없다. 회전 원은 몸통 밖(위로 25~28px)이라 남는다 |
| 돌려 놓은 도형 | 손잡이는 돌아간 `<g>` 안에 그리므로 회전과 무관하게 같은 크기 |
| 10% / 400% | 손잡이·안내선·점 손잡이 화면 크기 동일. 이름 글자는 `labelScale` 한계 안에서 유지 |
| 평면 → 3D → 평면 | 확대·위치가 남고 휠이 다시 듣는다 |
| 도면 전환 | 도면마다 자기 보기 값(지금과 같다) |

---

## 5. F1 이름 바로 짓기

### 5.1 동작 규칙

1. **열리는 때** (모두 평면 모드, 편집 가능(`canEdit`), 잠기지 않은 노드일 때만)
   - 사각형·타원을 끌어 그린 직후(`pointerUp`의 확정 분기).
   - 다각형을 완성한 직후(`finishPolygon` — '다각형 완성' 버튼, 빈 곳 더블클릭 둘 다).
   - 선택 도구로 더블클릭: 살아 있는 상세 도면이 **없는** 공간, 기호, 카메라.
   - F2: 선택된 노드(종류 무관, 상세 도면이 연결된 공간 포함).
2. 기호를 놓거나 카메라를 추가할 때는 열리지 않는다(기본 이름 유지).
3. 이름 칸은 노드 위에 뜬다: 공간·기호는 상자 가운데, 카메라는 카메라 점에서 화면 30px 아래. 현재 이름이 들어 있고 전체 선택된 채로 포커스를 받는다. 그 노드의 SVG 이름 글자는 열려 있는 동안 숨긴다.
4. **확정**: Enter, 또는 포커스가 다른 곳으로 감(다른 곳 클릭, 다른 창으로 전환 포함). 앞뒤 공백을 뗀 글자가 비었거나 원래 이름과 같으면 아무것도 바꾸지 않는다(되돌리기 단계도 없다).
5. **취소**: Esc. 이름은 그대로(새 공간이면 '새 공간'). 그리기 자체는 남는다.
6. Enter·Esc로 닫으면 포커스가 SVG로 돌아간다(Delete·Ctrl+Z가 바로 듣게). 포커스가 옮겨 가서 닫힌 경우에는 포커스를 건드리지 않는다. 글자를 친 뒤 SVG가 포커스를 받으면 도면 둘레에 기존 포커스 테두리가 보인다 — 지금도 속성 칸에 글자를 치고 도면을 누르면 보이는 것과 같은 테두리이며 바꾸지 않는다(5.4).
7. **그리기 + 이름 = 되돌리기 한 번**: 그린 직후 열린 칸에서 확정한 이름은 그리기 단계에 합쳐진다. 되돌리면 공간이 통째로 사라지고, 다시 실행하면 이름까지 돌아온다. 더블클릭·F2로 고친 이름은 보통의 한 단계다.
   - 그린 직후에는 포커스가 이름 칸에 있다. **아직 아무것도 치지 않은** 이름 칸에서 Ctrl+Z를 누르면 칸이 닫히고 도면의 되돌리기가 돈다 — 방금 그린 공간이 한 번에 사라진다(v1.130.0의 '그리고 바로 Ctrl+Z'가 그대로 된다). 글자를 친 뒤의 Ctrl+Z는 글자 입력의 되돌리기다(5.5).
8. 상세 도면이 연결된 공간의 더블클릭은 그 도면으로 들어간다(선택·이동 도구, 보기·편집 모두). v1.130.0은 그렇게 쓰여 있지만 실제로는 보기 모드 + 선택 도구(와 편집 중의 잠긴 공간)에서만 열렸다(2절). 더블클릭을 SVG에서 받으면서(5.6) 편집 중과 이동 도구에서도 열린다.
9. 보기 모드, 잠긴 노드, 3D 모드에서는 이름 칸이 열리지 않는다. 3D에서는 속성 칸의 이름 입력을 쓴다.

### 5.2 상태

편집기 화면 상태다(문서·저장과 무관).

```ts
type NameEdit = { mapId: string; nodeId: string; /** The draft value right after the creating edit; null for an existing node. */ created: BackgroundMap | null };
const [renaming, setRenamingState] = useState<NameEdit | null>(null);
const renamingRef = useRef<NameEdit | null>(null);       // handlers read this, so a late blur after a close is a no-op
function setRenaming(next: NameEdit | null) { renamingRef.current = next; setRenamingState(next); }
```

글자 버퍼는 `BackgroundMapNameBox` 안의 지역 상태다. 타이핑 중에는 초안을 건드리지 않는다.

### 5.3 순수 함수 (`mapGeometry.ts`)

```ts
/** Replace one node. Members of a space do NOT follow: use transformMapSpace when a space moves, turns or scales as a whole. */
export function replaceMapNode(map: BackgroundMap, next: BackgroundNode): BackgroundMap;
/** The map with the node renamed to the trimmed name. Blank or unchanged names, unknown and locked nodes return `map` itself. */
export function renameMapNode(map: BackgroundMap, id: string, name: string): BackgroundMap;
/** Plan point the name box of a node is centred on: the box centre of a space or symbol, the position of a camera. */
export function nodeNameAnchor(node: BackgroundNode): BackgroundPoint;
```

`replaceMapNode`는 지금의 비공개 `replaceNode`(mapGeometry.ts:127-128)를 모든 노드 종류로 넓혀 내보낸 것이고, `applyNodeWorldPose`의 두 호출(:145, :167)도 이것을 쓴다.

### 5.4 편집기 배선

```ts
/** Opens the name box. `created` true: the node was just drawn, so its name joins that undo step. */
function beginRename(id: string, created = false) {
  if (!current || mode !== 'plan' || !canEdit || pointerRef.current || doc.isGestureActive()) return;
  const value = mapDraft(doc.getState(), current.id)?.value;
  const node = value?.nodes.find(item => item.id === id);
  if (!value || !node || node.locked) return;
  select(id);
  setRenaming({ mapId: current.id, nodeId: id, created: created ? value : null });
}
// 세 처리기는 useEvent(:60-64)로 감싼다: 이름 칸이 언제 부르든 가장 최근 렌더의 canEdit·도면을 본다.
const commitName = useEvent((text: string, returnFocus: boolean) => {
  const edit = renamingRef.current;
  if (!edit) return;
  setRenaming(null);
  const draftNow = mapDraft(doc.getState(), edit.mapId);
  if (draftNow && canEdit) {
    const next = renameMapNode(draftNow.value, edit.nodeId, text);     // 살아 있는 초안에 없거나 잠긴 노드면 같은 도면이 돌아온다
    if (next !== draftNow.value) updateMap(next, edit.created && draftNow.value === edit.created ? { history: false } : undefined);
  }
  if (returnFocus) focusCanvas();
});
const cancelName = useEvent(() => { if (!renamingRef.current) return; setRenaming(null); focusCanvas(); });
/** Undo or redo asked for in a name box nothing was typed into: the box closes without a commit and the editor's own history runs. */
const passNameHistory = useEvent((redo: boolean) => { cancelName(); undo(redo); });
```

- **한 단계로 합치기**: 그리기가 끝난 직후의 초안 값 객체를 `created`로 기억한다. 확정할 때 초안 값이 **그 객체 그대로**면 `{ history: false }`로 값만 바꾼다(`replaceMapHistoryValue`, mapDocument.ts:84 / mapEditSession.ts:45-47). 되돌리기 목록의 마지막 항목은 "그리기 전 도면"이므로 되돌리기 한 번에 공간과 이름이 함께 사라진다.
- **보통 단계로 떨어지는 때**: `created`가 `null`(더블클릭·F2), 또는 그 사이에 초안 값이 다른 객체가 된 경우(다른 편집이 끼어듦). 이때는 `updateMap(next)` — 되돌리기 한 단계가 더 생긴다.
- **포커스 테두리(결정: 그대로 둔다)**: Enter·Esc(와 `passNameHistory`)는 키보드 처리기 안에서 스크립트로 SVG에 포커스를 준다. 앱 엔진은 직전 입력이 키보드였으면 스크립트 포커스에도 `:focus-visible`을 켜므로, 기존 규칙 `.bmap-canvas:focus-visible { outline:2px … }`(backgrounds-map.css:5)가 도면 둘레에 테두리를 그린다. 탐침(Electron 33.4.11)으로 확인한 것: ① 마우스로 다른 곳을 누른 뒤 도면을 누르면 테두리가 없다. ② 입력 칸에 글자를 친 뒤 도면을 **누르면** 테두리가 생긴다 — v1.130.0에서 속성 칸의 이름·숫자 칸에 글자를 치고 도면을 누를 때 이미 그렇다(누르기의 `svg.focus()`도 스크립트 포커스다, :425). ③ 글자를 치고 Enter로 돌아와도 같은 테두리가 생긴다. ④ 한번 생기면 SVG가 포커스를 잃을 때까지 남는다. 즉 이름을 지은 뒤의 테두리는 새 현상이 아니라 지금의 '글자를 친 뒤 도면에 포커스'와 같은 표시다. Enter 길만 숨기면 '치고 나서 도면을 누르는' 길과 어긋나고, 둘 다 숨기려면 기존 포커스 표시 규칙을 바꿔야 한다(승인 범위 밖). 그래서 손대지 않고 13절 N15에서 눈으로 확인해 기록한다.
- 호출하는 곳:
  - `pointerUp` 확정 분기: `if (session.mode === 'draw') { setTool('select'); if (session.node) beginRename(session.node.id, true); }`
  - `finishPolygon`(:407): `updateMap(…); select(node.id); setPolygon([]); setTool('select'); setError(''); beginRename(node.id, true);`
  - 더블클릭: 5.6의 `canvasDoubleClick`.
  - F2: `keyboard()`의 평면 단축키 묶음(4.4)에서 — 입력 칸 가드 **앞**이라 버튼에 포커스가 있어도 된다(오브젝트 목록에서 고른 뒤 F2).
    ```ts
    function renameSelected() {
      // 끄는 중·화면을 옮기는 중에는 보기 값도 건드리지 않는다: 세션이 누른 순간의 변환과 보기 값을 들고 있다(:453, 4.1의 6).
      if (!selected || !canEdit || selected.locked || pointerRef.current || doc.isGestureActive()) return;
      const revealed = revealPlanPoint(view, nodeNameAnchor(selected), 24);   // 화면 밖이면 보기만 옮긴다 (:290 과 같은 방식)
      if (revealed !== view) updateView({ x: revealed.x, y: revealed.y });
      beginRename(selected.id);
    }
    ```
- 렌더: `renaming`이 가리키는 노드를 지금 도면에서 찾아 유효할 때만 그린다.
  ```tsx
  const renamingNode = renaming && mode === 'plan' && canEdit && renaming.mapId === current?.id
    ? current.nodes.find(node => node.id === renaming.nodeId && !node.locked) : undefined;
  useEffect(() => { if (renaming && !renamingNode) setRenaming(null); }, [renaming, renamingNode]);
  …
  {renamingNode && <BackgroundMapNameBox key={renamingNode.id} svgRef={svgRef} anchor={nodeNameAnchor(renamingNode)}
    drop={renamingNode.type === 'camera' ? MAP_EDIT_MARK.nameBoxCameraDrop : 0} label={`${kindLabel(renamingNode)} 이름`}
    initial={renamingNode.name} positionKey={`${view.x}:${view.y}:${view.zoom}:${canvasSize.width}:${canvasSize.height}`}
    onCommit={commitName} onCancel={cancelName} onHistory={passNameHistory} />}
  ```
  이름 칸은 `.bmap-canvas-wrap` 안, SVG의 형제로 둔다(평면 모드일 때만). 이름을 고치는 노드의 `<g>`에는 `is-renaming` 클래스를 더한다. 유효하지 않게 되어 내려가는 이름 칸은 아무것도 확정하지 않는다(5.5의 '입력 칸이 내려갈 때의 blur').
- 문구: 아래 줄 힌트(:563-567)와 연결된 공간 안내(:687)를 10절의 문구로 바꾼다.

### 5.5 `BackgroundMapNameBox.tsx` (새 파일)

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

- **HTML `<input>`**이다(`foreignObject`를 쓰지 않는다: SVG 변환과 `--bmap-label-scale`을 그대로 물려받아 크기가 확대에 따라 변하고, 엔진별 포커스·IME 동작이 다르다).
- 속성: `className="bmap-name-box"`, `aria-label={label}`, `maxLength={160}`(저장 검증의 이름 길이, domain.ts:37), `spellCheck={false}`, `autoComplete="off"`.
- 위치(`useLayoutEffect`, 의존값 `anchor.x, anchor.y, drop, positionKey`): `svg.getScreenCTM()`으로 `anchor`를 화면 좌표로 바꾸고(누르기 좌표 변환 `pointFrom`(:413-418)과 같은 행렬의 역방향), `offsetParent`(`.bmap-canvas-wrap`)의 사각형을 빼서 `style.left / style.top`에 직접 쓴다. 입력 칸이 SVG 사각형 밖으로 나가지 않게 자기 반 크기 + 4px 안쪽으로 자른다. CSS가 `transform: translate(-50%, -50%)`로 가운데를 맞춘다. 첫 계산이 그리기 전에 끝나므로 엉뚱한 자리에서 깜빡이지 않는다.
- 포커스(`useLayoutEffect`, 마운트 때 한 번): `input.focus({ preventScroll: true }); input.select();`
- 키:
  ```ts
  onKeyDown={event => {
    if (event.key === 'Escape') event.stopPropagation();                    // 편집기의 Escape 처리로 올라가지 않게, 조합 중이어도
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;       // 한글 조합 중
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onCommit(text, true); }
    else if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    else if ((event.ctrlKey || event.metaKey) && !event.altKey && text === opened.current) {
      // 편집기의 되돌리기 조합(:519-520)과 같다: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') { event.preventDefault(); event.stopPropagation(); onHistory(key === 'y' || event.shiftKey); }
    }
  }}
  onBlur={() => { if (!leaving.current) onCommit(text, false); }}
  ```
  `opened`는 마운트 때의 `initial`을 담은 ref다(`const opened = useRef(initial)`). 글자 버퍼 `text`가 그 값과 같으면 "아직 아무것도 치지 않은" 칸이다. `leaving`은 이 칸이 내려가는 중임을 적는 ref다(아래 '입력 칸이 내려갈 때의 blur').
  ```ts
  const leaving = useRef(false);
  useLayoutEffect(() => { leaving.current = false; return () => { leaving.current = true; }; }, []);
  ```
- **Esc를 편집기에서 떼어 놓는 방법**: 편집기의 `keyboard()`는 Escape를 입력 칸 가드 앞에서 처리한다(:510-515 — 도구·그리던 다각형·팔레트 초기화). 이름 칸의 Escape는 React 이벤트의 `stopPropagation`으로 거기까지 올라가지 않는다. 조합 중 가드는 앱의 기존 방식(`src/components/widgets/my-tasks/components/QuickAdd.tsx:163`)과 같다. 같은 호출이 네이티브 전파도 끊으므로 전역 `bflow:escape`(src/hooks/useGlobalShortcuts.ts)도 울리지 않는다. 제스처 취소용 window 캡처 리스너(:193-199)는 제스처 중에만 걸려 있어, 이름 칸이 열려 있을 때는 없다.
- **이름 칸 안의 되돌리기**: 그린 직후에는 늘 이름 칸이 포커스를 가진다. 편집기의 `keyboard()`는 입력 칸에서 온 키를 Ctrl+Z 분기 앞에서 돌려보내므로(:516-519), 그대로 두면 이름 칸의 Ctrl+Z는 브라우저의 글자 되돌리기가 되고 아무것도 치지 않은 칸에서는 아무 일도 없다 — v1.130.0에서 되던 '그리고 바로 Ctrl+Z'가 Esc를 먼저 눌러야 되는 것으로 바뀐다. 그래서 **아무것도 치지 않은 칸**의 되돌리기·다시 실행 조합은 편집기로 넘긴다: 편집기는 확정 없이 칸을 닫고(`cancelName`) 자기 `undo(redo)`를 부른다(5.4의 `passNameHistory`). 그린 직후의 칸이면 되돌리기 목록의 마지막이 "그리기 전 도면"이라 공간이 한 번에 사라진다. 더블클릭·F2로 연 칸이면 v1.130.0에서 포커스가 SVG에 있을 때처럼 직전 편집이 되돌려진다. 글자를 한 번이라도 고친 뒤에는 가로채지 않는다(글자 입력의 되돌리기).
- **Delete·Backspace는 글자 편집이다.** 그린 직후에 Delete를 누르면 전체 선택된 '새 공간' 글자가 지워질 뿐, 노드 삭제 확인 창은 뜨지 않는다(편집기의 입력 칸 가드). 방금 그린 것을 없애려면 Ctrl+Z, 또는 Esc 뒤 Delete.
- **입력 칸이 내려갈 때의 blur**: 앱 엔진(Chromium 130)은 포커스를 가진 입력 칸이 DOM에서 빠질 때 그 자리에서 `blur`·`focusout`을 보낸다(탐침으로 확인: 제거가 끝나기 전, `isConnected`가 참인 채로 온다). 이름 칸이 유효성 때문에 내려가는 경우(`canEdit`을 잃음, 노드가 사라짐·잠김)나 편집기가 내려가는 경우에 그 blur가 확정으로 이어지면 '입력하던 글자를 버린다'(5.7)가 깨지고, 마지막으로 칸을 그린 렌더의 처리기가 그때의 `canEdit`(참)으로 초안에 쓰게 된다(그 순간 `renamingRef`는 아직 비워지지 않았다 — 효과는 커밋 뒤에 돈다). 두 겹으로 막는다.
  1. **내려가는 칸의 blur는 확정이 아니다.** 이름 칸은 레이아웃 효과의 정리 함수에서 `leaving`을 켠다. React는 컴포넌트의 DOM을 떼기 전에 레이아웃 효과의 정리를 먼저 부르므로, 제거 때문에 오는 blur는 `onBlur`의 첫 조건에서 돌아간다. 효과 본문에서 `false`로 되돌리는 것은 개발 모드의 효과 재실행 때문이다.
  2. `onCommit`·`onCancel`·`onHistory`는 `useEvent`로 감싼 것을 넘긴다(5.4). 언제 불리든 가장 최근 렌더의 `canEdit`을 보고, `renameMapNode`는 살아 있는 초안에 그 노드가 없거나 잠겨 있으면 도면을 그대로 돌려준다.

  이 blur가 React의 `onBlur`까지 실제로 닿는지는 React가 DOM을 고치는 동안 이벤트를 어떻게 다루느냐에 달려 있다. 닿든 닿지 않든 결과가 같도록 위 두 가지에만 기댄다.
- Enter·Esc로 닫힌 뒤 늦게 오는 blur(포커스 이동)도 `renamingRef`가 이미 `null`이라 아무 일도 하지 않는다.

### 5.6 더블클릭과 "다시 누르면 다음 것으로"

두 가지가 걸린다.

- 지금은 겹친 카메라·기호 묶음에서 이미 고른 것을 **다시 누르고 떼면** 다음 것으로 넘어간다(:433-435, :499-502). 더블클릭은 누름 두 번이므로, 그대로 두면 이름을 고치려는 더블클릭의 두 번째 누름이 선택을 넘겨 버린다.
- 편집 중에 선택 도구로 잠기지 않은 노드를 누르면 SVG가 포인터를 캡처한다(:453-454, 이동 도구의 누름도 같다). 캡처한 누름 뒤의 `click`·`dblclick`은 SVG가 대상이라 **노드 `<g>`의 `onDoubleClick`에는 닿지 않는다**(2절의 탐침). 이름 고치기는 바로 그 경우(편집 중, 잠기지 않은 노드)에만 있는 동작이므로, `<g>`에 걸면 한 번도 불리지 않는다. 연결된 공간으로 들어가는 더블클릭도 같은 이유로 편집 중과 이동 도구에서는 지금 되지 않는다.

결정:

1. **넘기기를 `pointerUp`에서 SVG의 `click`으로 옮긴다.** `pointerUp`은 `pendingCycle.current = { ids, nodeId, mapId }`만 적는다. SVG에 `onClick`을 더한다.
   ```ts
   onClick={event => {
     const cycle = pendingCycle.current; pendingCycle.current = null;
     if (!cycle || (event.detail >= 2 && canEdit)) return;        // 편집 중의 연속 클릭은 넘기지 않는다
     select(cycle.ids[(cycle.ids.indexOf(cycle.nodeId) + 1) % cycle.ids.length], cycle.mapId);
   }}
   ```
   - **두 번째 누름을 알아내는 방법**: `click`의 `detail`(연속 클릭 횟수). 운영체제의 더블클릭 판정을 그대로 쓰므로 시간·거리 상수를 따로 두지 않는다. pointerdown의 `detail`은 늘 0이라 쓸 수 없다. 캡처한 누름 뒤에도 `click`은 SVG에 오고 `detail`은 1, 2로 온다(탐침).
   - **편집 중의 우선순위 — 더블클릭 간격 안의 두 번 클릭은 더블클릭이지 두 번 넘기기가 아니다.** 편집 중에는 연속 클릭(`detail ≥ 2`)이 넘기지 않고, 그 더블클릭은 이름 고치기(또는 상세 도면으로 들어가기)가 된다. v1.130.0은 누름마다 넘겼으므로, 겹친 카메라를 **빠르게** 눌러 넘기던 동작은 편집 중에는 둘째 클릭에서 이름 칸이 열리는 것으로 바뀐다. 승인된 "카메라는 더블클릭하면 이름을 고친다"에서 따라 나오는 변화이며, 새 카메라는 늘 같은 자리에 생기므로(R7) 드문 경우가 아니다. 넘기려면 클릭 사이를 더블클릭 간격(윈도우 기본 0.5초)보다 길게 띄우거나 오브젝트 목록에서 고른다. 13절 N13에서 확인하고 완료 보고에 적는다(16절).
   - 보기 모드(`canEdit` 거짓)에서는 지금처럼 클릭마다 넘긴다(빠르게 눌러 넘기는 동작 유지). 근거: 묶음에는 카메라·기호만 들어가고(공간은 묶음을 만들지 않는다, mapGeometry.ts:174), 보기 모드의 더블클릭은 카메라·기호에 아무 일도 하지 않는다. 묶음에 공간이 들어가는 순간 이 근거는 깨진다(11절의 ② 항목).
   - 천천히 한 번씩 누르는 넘기기는 그대로다(시점만 pointerup → click으로 몇 ms 늦다).
2. **더블클릭은 SVG 한 곳에서 받고, 무엇을 눌렀는지는 누를 때 적어 둔 기록으로 판정한다.** pointerdown은 캡처 전이라 실제로 눌린 요소의 처리기에 닿으므로, "어느 노드를 눌렀는가"는 `pointerDown`만 안다. `pointerDown`이 최근 두 번의 누름을 `pressLog`에 적고(3.4), SVG의 `onDoubleClick` 하나가 그것을 읽는다. 공간·기호·카메라 `<g>`의 `onDoubleClick`(:612, :623, :637)은 **지운다**.
   ```ts
   // <svg … onDoubleClick={canvasDoubleClick}>  — 지금의 :608 을 대신한다
   function canvasDoubleClick(event: ReactMouseEvent<SVGSVGElement>) {
     const [first, last] = pressLog.current;
     if (!current || !last || last.handle || Date.now() - lastDrag.current <= 450) return;
     if (last.hitId === null) { if (tool === 'polygon') finishPolygon(); return; }        // 빈 곳: 지금과 같다 (:608)
     if (!first || first.hitId !== last.hitId) return;                                    // 첫 누름이 캔버스 밖이었거나(null, 3.4) 두 누름이 같은 노드 위가 아니다
     const node = current.nodes.find(item => item.id === last.hitId), point = pointFrom(event);
     if (!node) return;
     const pile = node.type === 'space' || !point ? [node.id] : planStackUnder(current, node.id, undefined, item => onPlanMark(item, point));
     const target = current.nodes.find(item => item.id === doubleClickNodeId(first.targetId, node.id, pile)) ?? node;
     if (target.type === 'space' && target.childMapId && maps.some(map => map.id === target.childMapId)) {
       if (tool === 'select' || tool === 'hand') openSpace(target.id);                    // :612 가 하려던 것
       return;
     }
     if (tool === 'select') beginRename(target.id);                                       // canEdit · 잠금은 beginRename 이 본다
   }
   ```
   - 아무 일도 하지 않는 더블클릭:
     - 마지막 누름의 기록이 없다 — 편집기가 받지 않은 누름이 끼었다(저장 중 등, 3.4의 1).
     - **첫 누름의 기록이 없다 — 더블클릭의 첫 클릭이 캔버스 밖이었다**(3.4의 창 단위 처리기가 기록을 비웠다). '다각형 완성'·'취소' 버튼, 기호 팔레트의 항목, 닫히는 창의 버튼처럼 누르면 사라지는 것을 더블클릭하면 둘째 클릭만 캔버스에 떨어진다. 그 둘째 클릭은 **보통 누름 하나**로 끝난다: 그 자리의 것이 선택되고(빈 곳이면 선택이 풀린다), 그 아래 공간의 이름 칸이 열리거나 상세 도면으로 들어가는 일은 없다. '다각형 완성'을 더블클릭했다면 방금 열린 새 공간의 이름 칸은 이 둘째 클릭에 닫힌다(캔버스를 누르면 확정된다는 5.7의 규칙 그대로 — 아무것도 치지 않았으므로 이름은 '새 공간', 되돌리기 단계는 늘지 않는다). 새 공간의 이름은 그 뒤에 더블클릭이나 F2로 붙인다. v1.130.0에서도 이 둘째 클릭은 선택을 옮겼다. 둘째 클릭을 삼켜 이름 칸을 지키려면 누름 시점에 "더블클릭의 둘째"임을 알아야 하는데, pointerdown은 클릭 횟수를 싣지 않아(2절) 시간 상수 없이는 알 수 없다. 넣지 않는다.
     - 마지막 누름이 **손잡이 위**다(회전 원, 크기 네모, 점 동그라미, '+'). 손잡이는 끄는 곳이다. 첫 클릭으로 선택되면서 그 자리에 손잡이가 나타난 경우도 여기에 든다: 도형의 오른쪽 아래 모서리나 다각형의 꼭짓점·변 가운데 위에서 더블클릭하면 이름 칸도 상세 도면도 열리지 않는다(몸통에서 더블클릭한다).
     - 직전 450ms 안에 끌기가 있었다(지금과 같다, `lastDrag`).
     - 두 누름이 같은 노드 위가 아니다. 예: 기호 도구로 놓은 직후의 둘째 누름이 방금 놓인 기호 위에 떨어진 경우 — 놓기는 이름 칸을 열지 않는다(5.1의 2).
   - 다각형 도구일 때 노드 위 더블클릭은 지금처럼 아무 일도 없다(`hitId`가 있고 도구가 선택·이동이 아니다). 빈 곳 더블클릭은 지금처럼 다각형을 완성한다 — 이 줄만은 v1.130.0(:608)처럼 첫 누름을 보지 않는다(둘째 누름이 빈 곳이고 다각형 도구이면 끝낸다). 첫 누름을 보는 것은 노드에 작용하는 두 가지, 이름 고치기와 상세 도면으로 들어가기다.
   - `doubleClickNodeId(first, hitId, pile)`: `first`가 `null`이 아니고 `hitId`와 같거나 `pile`에 들어 있으면 `first`, 아니면 `hitId`.
   - **더블클릭은 첫 누름이 가리킨 노드에 작용한다.** 묶음에서 이미 C를 골라 둔 채 더블클릭하면, 첫 클릭이 선택을 다음 것(A)으로 넘긴다(첫 클릭만으로는 더블클릭인지 알 수 없다). 두 번째 클릭은 넘기지 않고, `dblclick`에서 첫 누름의 대상(C)으로 선택을 되돌린 뒤 C의 이름 칸을 연다. 선택 표시가 한 번 깜빡일 수 있다.
   - 더블클릭 처리기 안에서 준 이름 칸의 포커스는 그대로 남는다(탐침: 캡처한 더블클릭의 `dblclick`에서 입력 칸에 포커스를 주면 뒤따르는 이벤트가 빼앗지 않는다).
3. 다음 묶음 ②(겹친 공간 넘기기)는 묶음 목록에 공간을 넣어 같은 길을 쓸 수 있다. 다만 그때 정해야 하는 것이 있다(11절).

### 5.7 닫히는 경우 전부

| 일어난 일 | 결과 | 닫는 장치 |
|---|---|---|
| Enter | 확정, 포커스는 SVG | `onKeyDown` |
| Esc | 취소, 포커스는 SVG | `onKeyDown` |
| 캔버스를 누름 | 확정 후 그 누름이 보통 누름으로 이어진다(선택·끌기·그리기) | `pointerDown`이 SVG에 포커스를 주는 순간(:425) blur → `commitName`. 그 다음 줄에서 읽는 초안(:428)에 새 이름이 이미 들어 있다 |
| 도구줄·속성 칸·오브젝트 목록·도면 트리·이미지 그리드·다른 창 클릭 | 확정 후 그 동작 | blur |
| 되돌리기·다시 실행 **버튼** | 확정 후 되돌리기(그리기에 합쳐졌으면 공간째, 아니면 방금 이름) | blur → 버튼 클릭 |
| 이름 칸 안에서 Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y — **아무것도 치지 않았을 때**(글자가 열릴 때 그대로) | 확정 없이 닫고 포커스를 SVG로 돌린 뒤 **도면의** 되돌리기·다시 실행. 그린 직후라면 Ctrl+Z 한 번에 그 공간이 사라진다 | 이름 칸의 `onKeyDown` → `onHistory` → `cancelName(); undo(redo)` |
| 〃 — 글자를 고친 뒤 | 글자 입력의 되돌리기(브라우저 기본). 도면은 그대로 | 이름 칸이 가로채지 않음 + `keyboard()`의 입력 칸 가드(:516-517) |
| 이름 칸 안에서 Delete·Backspace | 글자를 지운다. 노드 삭제 확인 창은 뜨지 않는다 | 입력 칸 가드 |
| '도면 저장' / '취소' / 평면·3D 전환 / 다른 도면으로 이동 | 확정 후 그 동작(저장에는 새 이름이 들어간다) | blur가 먼저 |
| 휠 확대·창 크기 변경 | 열린 채 노드를 따라간다 | `positionKey` |
| 저장 중이 되거나 편집 권한을 잃음(`canEdit` 거짓), 노드가 사라짐·잠김, 초안이 버려짐 | 입력하던 글자를 버리고 닫는다 | `renamingNode` 유효성 + 효과. 입력 칸이 내려가며 오는 blur는 확정이 아니다(5.5) |
| 편집기가 내려감 | 버린다 | 언마운트(내려가는 칸의 blur는 확정이 아니다, 5.5) |

### 5.8 경계 상황

- 잠긴 노드·보기 모드: 이름 고치기는 더블클릭·F2 모두 무동작. 연결된 공간으로 들어가는 더블클릭은 된다.
- 한글 입력: 조합 중의 Enter·Esc는 IME에 맡긴다(위 가드). 조합이 끝난 뒤의 Enter가 확정한다. 조합 중에 다른 곳을 눌러 닫으면 blur가 확정한다(마지막 글자까지 들어가는지는 13절 N14에서 확인).
- 이름 칸이 떠 있는 노드가 캔버스 가장자리에 걸리면 칸은 캔버스 안쪽으로 밀려 들어온다. F2로 열 때 노드가 화면 밖이면 보기를 먼저 옮긴다. 끄는 중·화면을 옮기는 중의 F2는 아무 일도 하지 않는다(보기도 옮기지 않는다).
- 그리기 직후 Esc → 나중에 더블클릭으로 이름을 고치면 별도의 되돌리기 단계다.
- 손 도구에서는 더블클릭으로 이름을 고치지 않는다(둘러보는 도구). 연결된 공간으로 들어가는 것만 된다(v1.130.0에서는 쓰인 것과 달리 열리지 않았다, 2절).
- 겹친 카메라·기호를 편집 중에 빠르게 연달아 누르면 둘째 클릭에서 이름 칸이 열린다. 천천히 누르면 지금처럼 하나씩 넘어간다(5.6의 1).
- 손잡이(회전 원·크기 네모·점 동그라미·'+') 위에서의 더블클릭은 아무 일도 하지 않는다(5.6의 2).
- 캔버스 위에 떠 있는 버튼('다각형 완성'·'취소', 기호 팔레트의 항목)을 더블클릭하면 둘째 클릭은 그 아래에 떨어진 보통 누름이다. 아래에 있던 공간의 이름 칸이 열리거나 상세 도면으로 들어가지 않는다. '다각형 완성'의 경우 방금 열린 이름 칸은 그 누름에 닫히고 새 공간은 '새 공간'으로 남는다(5.6의 2).
- 작은 도형·돌려 놓은 도형·확대 정도: 이름 칸은 HTML이라 늘 같은 화면 크기(168px)이고 돌아가지 않는다. 기준점은 회전과 무관한 상자 가운데(카메라는 그 점)다. 도형이 이름 칸보다 작아도 그 위에 뜬다.
- 다각형 도구일 때 노드 위 더블클릭은 지금처럼 아무 일도 없다.

---

## 6. F4 스냅

### 6.1 동작 규칙

1. 스냅이 켜져 있고 Alt를 누르지 않은 끌기에만 적용된다. 대상: 옮기기, 오른쪽 아래 손잡이로 크기 바꾸기, 회전(걸림), 다각형 점 끌기(7절). 그리기 도구로 새로 그리는 것은 대상이 아니다(6번).
2. **붙는 대상 — 옮기기와 크기 바꾸기**(제스처를 시작한 순간의 도면에서 한 번 모은다. 다각형 점이 붙는 곳은 이것이 아니라 7.1의 7이다)
   - 다른 공간·기호: 회전이 90° 단위(0·90·180·270, ±0.01°)이면 왼쪽·가운데·오른쪽, 위·가운데·아래. 그 밖의 각도로 돌려 놓았거나 기울인(pitch·roll) 기호는 **가운데만**.
   - 다른 카메라: 그 점.
   - 도면 테두리: x = 0, 1000 / y = 0, 680.
   - 뺀다: 끌고 있는 것, 그리고 그것과 함께 실려 가는 것(옮기는 공간의 잠기지 않은 소속 카메라·기호). 잠긴 소속 항목은 제자리에 있으므로 대상이다.
   - **가까이 있는 것만 대상이다.** 승인 문구는 "가까워지면 착 붙는다"다. 대상 선은 그것을 내놓은 도형의 범위만큼만 선이다: 세로 선(x = 값)은 그 도형의 위~아래, 가로 선(y = 값)은 왼쪽~오른쪽(카메라는 한 점. 돌려 놓은 도형은 가운데 선만 내놓지만 범위는 보이는 윤곽을 감싼 상자다. 테두리 선은 기본 영역의 한 변 전체). 끄는 것이 차지한 범위(돌려 놓은 도형은 윤곽을 감싼 상자)가 그 범위에서 **다른 축으로** 닿는 거리(3번, 화면 48px)보다 멀리 떨어져 있으면 그 선에는 붙지 않는다. 겹쳐 있거나 맞닿은 것(끄는 것을 품은 방, 바로 옆방)은 틈이 0이라 늘 대상이다. 붙는 축으로는 허용 거리 안이어야 하므로, 결국 **끄는 것에서 화면 48px 안에 있는 것**의 가장자리·가운데에만 붙는다. 도면 건너편 도형의 가장자리를 길게 늘인 선에는 붙지 않는다.
     - 근거: 범위를 두지 않으면(선이 끝없이 이어지면) 도면의 모든 것이 축마다 선 셋씩을 내놓는다. 도면 영역이 낮은 창의 100%에서 허용 거리 6px은 도면 12~15단위다(도면 1단위가 화면 0.4~0.5px, 3.2·7.1). 다른 방이 여섯만 있어도 (3 × 6 + 2)개 선 × 끄는 쪽 3개 선 × 붙는 폭 약 25단위가 가로 1000단위를 거의 덮는다(어림으로, 겹침을 빼도 가로 위치 넷 중 셋이 '붙은' 자리다). 기호는 60~210단위라(symbolCatalog.ts:9-13) 의자 하나의 세 선이 화면 15px 간격으로 서고, 가구를 놓은 도면에서는 어디에 놓아도 '붙은' 것이 된다. 그러면 안내선이 내내 켜져 있고, '붙지 않은 축은 정수'(7번)가 돌 틈이 없으며, 놓은 값은 상관없는 먼 도형의 소수 값을 물려받는다(기존·새 노드는 소수 좌표다, 1.2). 승인 문구 셋 — 가까워지면 붙는다 / 붙는 순간에만 안내선 / 붙지 않으면 소수점 없이 — 이 모두 약해진다.
     - 테두리 선도 같은 규칙이다. 기본 영역 안이나 그 둘레 48px 안에 있는 것에게는 늘 대상이고, 기본 영역 밖 멀리 나가 있는 것은 테두리를 늘인 선에 붙지 않는다.
3. **허용 거리와 닿는 거리**: **붙는 축**으로 화면 6px(`MAP_SNAP.tolerancePx`, = `6 × screenScale` 도면 단위) 안이면 붙는다. **다른 축**으로는 화면 48px(`MAP_SNAP.reachPx`) 안에 있는 것만 본다(2번). 둘 다 확대 정도와 상관없이 같은 화면 거리다.
   - 48px 결정 근거: 허용 거리의 8배. 맞닿은 방, 복도 하나 건너의 방, 한 줄로 놓은 의자는 잡고 도면 건너편은 버린다. 실제 도면에서의 느낌은 13절 S12에서 보고, 고칠 때는 이 상수 하나만 바꾼다(16절).
   - 좁히지 않은 것: 종류(방은 방에만, 가구는 같은 방의 것에만 같은 규칙)와 가장자리·가운데 사이의 우선순위는 두지 않는다. 승인 문구의 대상은 "다른 도형의 가장자리·가운데"이고, 종류로 거르는 것은 승인된 대상을 줄이는 결정이다. 방을 옮길 때 가까이(48px 안) 있는 다른 방의 가구·카메라에도 붙는다는 점은 완료 보고에 적는다(16절).
4. **옮기기**: 끄는 것의 왼쪽·가운데·오른쪽 가운데 대상 선에 가장 가까운 것이 허용 거리 안이면 가로가 붙고, 세로도 따로 같은 방식. 돌려 놓은(90° 단위가 아닌) 도형과 카메라는 가운데(점)로만 붙는다.
5. **크기 바꾸기**: 회전이 90° 단위인 도형은 끌고 있는 모서리의 가로·세로가 각각 대상 선에 붙는다(회전 90°·270°에서는 화면의 가로가 도형의 '세로 길이'를 정한다). 그 밖의 각도로 돌려 놓은 도형은 붙지 않고 길이만 정수가 된다. 붙은 결과가 최소 길이 10보다 작아지면 그 축은 붙지 않은 것으로 친다.
6. **그리기는 붙지 않는다.** 사각형·타원·다각형 도구로 새로 그리는 도형은 붙지 않고 정수로 맞추지도 않는다 — v1.130.0처럼 누르고 끈 자리 그대로 생기고 안내선도 없다. 승인 문구의 스냅은 "옮기거나 크기를 바꿀 때"다(1.2). 그린 뒤 옮기면 위치가, 크기를 바꾸면 길이가, 점을 끌면 그 점이 그때 붙고 정리된다.
7. **값 규칙**: 붙은 축은 대상의 값을 그대로 쓴다(반올림하지 않는다). 붙지 않은 축만 정수로 맞춘다 — 옮기기는 그 노드의 저장 x·y, 크기 바꾸기는 가로·세로 길이, 다각형 점은 그 점의 좌표.
8. **회전 걸림**: 결과 각도가 0·90·180·270에서 3° 안이면 정확히 그 값. 그 밖에서는 지금처럼 자유롭다(각도는 정수로 맞추지 않는다). 공간·기호의 회전 원, 카메라의 방향 원 모두. 안내선은 없다.
9. **안내선**: 붙은 축마다 한 줄. 붙은 순간에만 보이고, 떨어지거나 제스처가 끝나면(떼기·Esc·취소) 사라진다. 선은 끄는 것과 대상(같은 값에 걸린, 닿는 거리 안의 대상 전부)을 잇고 양 끝으로 화면 8px 더 나간다. 닿는 거리 밖의 도형까지 선이 뻗지 않는다.
10. **'스냅' 버튼**: 평면에서 편집 중일 때 아래 줄의 확대 버튼 묶음 맨 앞에 있다. 기기별로 기억하고 처음에는 켜져 있다. 끄면 v1.130.0처럼 놓은 자리 그대로다(붙지 않고, 정수로 맞추지도 않는다).
11. **Alt**: 누른 채 움직이는 동안은 꺼진 것과 같다. 포인터 이동마다 판정하므로 끌다가 Alt를 떼고 움직이면 다시 붙는다. 끌기에 쓴 Alt는 마우스를 먼저 떼든 Alt를 먼저 떼든 창 메뉴를 건드리지 않아, 놓은 뒤의 Delete·Ctrl+Z·F2·+ − 0이 바로 듣는다(6.5).
12. 속성 칸 숫자 입력, 3D 기즈모, 그리기 도구, 기호 놓기, 카메라 추가에는 적용하지 않는다.

### 6.2 `mapSnap.ts` (새 파일, three.js·DOM 없음)

```ts
export const MAP_SNAP = { tolerancePx: 6, reachPx: 48, quarterTurn: 0.01, rotationStops: [0, 90, 180, 270], rotationCapture: 3 } as const;

/**
 * A line things stick to: x = at ('x', a vertical line) or y = at. `from`/`to` is its extent along the other axis:
 * the stretch the target really covers. A moving box farther than the reach from that stretch does not stick to
 * the line, and the guide is drawn over it.
 */
export type SnapLine = { axis: 'x' | 'y'; at: number; from: number; to: number };
export type SnapGuide = SnapLine;
export type SnapBox = { left: number; right: number; top: number; bottom: number };
export type SnapCandidates = { x: readonly SnapLine[]; y: readonly SnapLine[]; points: readonly BackgroundPoint[] };

export function isQuarterTurn(rotation: number): boolean;
/** What a node offers to snapping: its box at quarter turns, a single point otherwise. */
export function nodeSnapBox(node: BackgroundNode): SnapBox;
/**
 * The plan area a node covers: what "near" is measured against and what the guides are drawn over.
 * The snap box at quarter turns, the bounds of the plan outline of a turned or tilted node, the point of a camera.
 */
export function nodeSnapSpan(node: BackgroundNode): SnapBox;
/** The moving nodes plus what travels with them: unlocked members of an unlocked moving space. */
export function snapTravellingIds(map: BackgroundMap, movingIds: readonly string[]): Set<string>;
export function collectSnapCandidates(map: BackgroundMap, excluded: ReadonlySet<string>): SnapCandidates;
/** Adds the x and y of neighbouring polygon points as lines. */
export function withVertexNeighbours(candidates: SnapCandidates, neighbours: readonly BackgroundPoint[]): SnapCandidates;

/** `tolerance`: how close on the snapping axis. `reach`: how far away on the other axis a line may be and still count. Map units. */
export function snapMove(map: BackgroundMap, movingIds: readonly string[], anchorId: string, delta: BackgroundPoint,
  candidates: SnapCandidates, tolerance: number, reach: number): { position: BackgroundPoint; delta: BackgroundPoint; guides: SnapGuide[] } | null;
/** Every given line and point counts, whatever its distance on the other axis: the caller passes only what a point may stick to. */
export function snapPoint(point: BackgroundPoint, candidates: SnapCandidates, tolerance: number): { point: BackgroundPoint; guides: SnapGuide[] };
/** `corner`: the plan point the bottom-right corner is dragged to. */
export function snapResize<T extends BackgroundSpace | BackgroundSymbol>(node: T, corner: BackgroundPoint,
  candidates: SnapCandidates, tolerance: number, reach: number): { node: T; guides: SnapGuide[] };
/** Degrees in [0, 360): a stop when within `capture` of it, else the normalised input. */
export function snapRotation(degrees: number, capture?: number): number;
export function sameSnapGuides(a: readonly SnapGuide[], b: readonly SnapGuide[]): boolean;
```

세부 규칙:

- `isQuarterTurn(r)`: `t = normalizeDegrees(r) % 90`, `Math.min(t, 90 − t) < 0.01`.
- `nodeSnapBox`
  - 카메라: 그 점(`left = right = x`, `top = bottom = y`).
  - 공간·기호, 회전이 90° 단위이고 기울지 않음: 회전이 0°·180° 쪽이면 **저장 값에서 직접** `left = x`, `right = x + width`, `top = y`, `bottom = y + height`. 90°·270° 쪽이면 가운데 `(x + width/2, y + height/2)`에서 가로 ±`height/2`, 세로 ±`width/2`. (어느 쪽인지는 `Math.round(normalizeDegrees(r) / 90) % 2`.)
  - 그 밖(자유 회전, pitch·roll이 0이 아닌 기호): 가운데 한 점.
- `nodeSnapSpan`(그 노드가 **차지한 범위** — 붙는 선이 아니라 "가까이 있는가"를 재는 데 쓴다)
  - 카메라: 그 점. 회전이 90° 단위이고 기울지 않은 공간·기호: `nodeSnapBox(node)`와 같은 값(따로 계산하지 않고 그 결과를 돌려준다).
  - 그 밖(자유 회전, 기운 기호): `nodePlanOutline(node)`(mapSpatial.ts:239-256) 점들의 가로·세로 최소·최대. 화면에 보이는 윤곽을 감싸는 상자다.
  - 근거: 돌려 놓은 도형은 가운데 선 하나만 내놓는다. 가까운지까지 그 **가운데 점**에서 재면, 화면에서 96px보다 큰 방은 가운데가 이웃에서 48px 넘게 떨어져 있어 맞닿아 있어도 붙지 않는다. 가까운지는 보이는 윤곽으로 잰다.
- `collectSnapCandidates`: 테두리 선 4개(`x = 0, 1000`은 `from 0 to 680`, `y = 0, 680`은 `from 0 to 1000`) + `excluded`에 없는 노드마다 `nodeSnapBox`의 선. 상자가 점이면 축마다 1개, 아니면 3개(시작·가운데·끝). 선의 `from/to`는 그 노드의 `nodeSnapSpan`의 다른 축 범위다 — 90° 단위의 도형에서는 `nodeSnapBox`의 범위와 같고, 돌려 놓은 도형의 가운데 선은 윤곽 상자의 범위를 가진다(닿는 거리 판정과 안내선이 이 범위를 쓴다). 여기서는 거르지 않고 모두 모은다 — 무엇이 가까운지는 포인터 자리마다 달라지므로 `snapMove`·`snapResize`가 거른다. `points`에는 `excluded`에 없는 **공간** 가운데 사각형·다각형의 꼭짓점(`nodePlanOutline`, 회전 무관)을 넣는다. 타원·기호·카메라는 넣지 않는다.
- `snapTravellingIds`: `movingIds` + (움직이는 공간이 잠기지 않았을 때) `type !== 'space' && spaceId === 그 공간 && !locked`인 노드. `transformMapSpace`가 실어 나르는 조건(mapGeometry.ts:32, :36)과 같다.
- `withVertexNeighbours`: 받은 후보를 바꾸지 않고, 옆 점 n마다 세로 선 `{ axis: 'x', at: n.x, from: n.y, to: n.y }`와 가로 선 `{ axis: 'y', at: n.y, from: n.x, to: n.x }`를 더한 새 후보를 돌려준다(`points`는 그대로). 범위가 그 점 하나라서 안내선은 옆 점에서 끄는 점까지 그어진다. 다각형 점의 후보는 이 선들과 다른 공간의 모서리가 전부다(3.3).
- **닿는 거리 안의 선**(`snapMove`와 `snapResize`가 같이 쓰는 판정, 6.1의 2): 화면 축 상자 Q와 후보 선 L에 대해, L이 세로 선(`axis: 'x'`)이면 `틈 = Math.max(0, L.from − Q.bottom, Q.top − L.to)`, 가로 선(`axis: 'y'`)이면 `틈 = Math.max(0, L.from − Q.right, Q.left − L.to)`. **`틈 ≤ reach`인 선만 후보로 본다.** `reach`가 유한하지 않거나 음수면 0으로 친다(겹치거나 맞닿은 것만 남는다). 노드의 선과 테두리 선을 가리지 않고 같은 식이다. 붙는 축의 거리(허용 거리)는 이 판정과 따로 본다.
- `snapMove`
  1. `anchor` = `anchorId` 노드. 없거나, `movingIds`에 없거나, `delta`가 유한하지 않으면 `null`(부르는 쪽이 자유 이동으로 처리한다). 결과의 `position`은 **기준 노드의 저장 x·y가 가질 값**이다.
  2. 움직이는 상자 M = `movingIds` 노드들의 `nodeSnapBox`를 합친 상자. 움직이는 선은 축마다 시작·가운데·끝(점이면 1개)이고, 각 선을 **기준 노드의 저장 좌표로부터의 거리** `offset = 선 − anchor.x`로 들고 있는다(왼쪽 끝이 곧 `anchor.x`면 `offset`은 정확히 0). 차지한 범위 S = 같은 노드들의 `nodeSnapSpan`을 합친 상자(90° 단위의 도형만 움직이면 M과 같다).
  3. 축마다: Q = S를 `delta`만큼 옮긴 상자(**붙이기 전** 자리다 — 한 축이 붙어도 다른 축의 판정은 바뀌지 않는다). 후보 선 가운데 Q에서 닿는 거리 안인 것만 남긴다. 남은 선과 움직이는 선의 모든 쌍에서 `|후보.at − (anchor.x + delta.x + offset)| ≤ tolerance`인 것 가운데 가장 가까운 쌍. 같으면 먼저 찾은 것(움직이는 선은 시작·가운데·끝 순, 후보는 모은 순서).
  4. 붙은 축: `position.x = 후보.at − offset`. 붙지 않은 축: `position.x = Math.round(anchor.x + delta.x)`.
  5. `delta = position − (anchor.x, anchor.y)`(묶음의 나머지 노드를 옮길 때 쓴다 — 다음 묶음).
  6. 안내선: 붙은 x축이면 `{ axis: 'x', at, from, to }`, `from/to`는 옮겨진(붙인 뒤의) S의 세로 범위와, 3에서 남긴(닿는 거리 안의) 후보 선 가운데 `|선.at − at| ≤ 1e-6`인 것들의 `from/to`를 합친 범위. y축도 같다. 같은 값이라도 닿는 거리 밖의 선은 안내선에 들어가지 않는다.
  7. `tolerance ≤ 0`이면 선에는 붙지 않고 정수 맞춤만 한다.
- `snapPoint`
  1. `points` 가운데 거리(`Math.hypot`)가 `tolerance` 이하인 가장 가까운 점이 있으면 **그 점 그대로**. 안내선은 그 점을 지나는 길이 0의 x·y 선 둘(그릴 때 양 끝 8px이 더해져 작은 십자가 된다).
  2. 없으면 축마다 가장 가까운 후보 선(허용 거리 안)이 있으면 `at`, 없으면 `Math.round`. 안내선의 범위는 후보(같은 값 전부)의 `from/to`와 결과 점을 합친 범위.
  3. **닿는 거리 판정이 없다.** 받은 선은 다른 축으로 얼마나 떨어져 있든 쓴다. 다각형 점이 받는 선은 옆 점의 가로·세로 선뿐이고(3.3), 그 선은 멀리 있는 옆 점과 줄을 맞추는 것이 쓰임이다. 점 후보는 그 자체가 허용 거리 안의 한 점이다.
- `snapResize`
  1. 고정점 = 돌아간 왼쪽 위 모서리(`resizeSpace`와 같다, mapGeometry.ts:14-15). 회전이 정확히 0이면 저장된 `(x, y)` 그대로다(6.3).
  2. 회전이 90° 단위이고 기울지 않았으면: Q = 고정점과 `corner`를 마주 보는 두 모서리로 하는 화면 축 상자(`left = Math.min(고정점.x, corner.x)`, `right = Math.max(…)`, `top`·`bottom`도 같게 — 90° 단위에서는 끌고 있는 도형의 붙이기 전 상자다). `corner`의 x·y를 각각, Q에서 닿는 거리 안인 후보 선 가운데 가장 가까운 것(허용 거리 안)에 붙인다(`points`는 쓰지 않는다).
  3. (붙인 점 − 고정점)을 도형의 자기 축으로 옮긴다. 90° 단위에서는 삼각함수 대신 **축 바꿈**으로 정확히 한다: k = `Math.round(normalizeDegrees(r) / 90) % 4`, `(dx, dy)` → k0 `(dx, dy)`, k1 `(dy, −dx)`, k2 `(−dx, −dy)`, k3 `(−dy, dx)`. 그 밖의 각도는 `nodeLocalPoint`(6.3).
  4. 가로 길이는 k가 짝수면 화면 x가, 홀수면 화면 y가 정한다(세로 길이는 반대). 그 축이 붙었고 값이 10 이상이면 그대로, 아니면 `Math.round`. 10~100000으로 자른다.
  5. `resizeSpaceTo(node, width, height)`로 결과를 만든다. 안내선은 실제로 붙은 화면 축마다 한 줄(범위 = 결과 도형의 `nodeSnapBox`와, 2에서 본 닿는 거리 안의 후보 가운데 같은 값인 것들의 합).
- `snapRotation(d, capture = 3)`: 유한하지 않으면 그대로. `t = normalizeDegrees(d)`, 각 정지 각도 s에 대해 `Math.abs(normalizeSignedDegrees(t − s)) ≤ capture`면 s, 없으면 t. (예: 357.5 → 0, 2.9 → 0, 3.1 → 3.1, 92 → 90, −91 → 270.)

### 6.3 `mapGeometry.ts`에 더하는 것

```ts
/** A plan point in the node's own unrotated frame, measured from its rotated top-left corner (the point a resize keeps fixed). */
export function nodeLocalPoint(node: BackgroundSpace | BackgroundSymbol, world: BackgroundPoint): BackgroundPoint;
/** Resize to a local size (clamped to 10..100000) while the rotated top-left stays fixed. */
export function resizeSpaceTo<T extends BackgroundSpace | BackgroundSymbol>(space: T, width: number, height: number): T;
/** Plan position of the bottom-right corner: the point the resize handle stands for. */
export function nodeResizeCorner(node: BackgroundSpace | BackgroundSymbol): BackgroundPoint;
/** Move a node so that its stored x/y become exactly `position`. Members of a space follow as in moveMapNode. Unknown or locked nodes return `map`. */
export function placeMapNode(map: BackgroundMap, id: string, position: BackgroundPoint): BackgroundMap;
```

- `resizeSpace(space, pointer)`(mapGeometry.ts:13-20)는 `const local = nodeLocalPoint(space, pointer); return resizeSpaceTo(space, local.x, local.y);`가 된다. 회전이 0이 아닐 때는 계산 순서를 지금과 같게 유지한다. 기존 고정 값(tests/backgroundMapGeometry.test.ts:13-20, :44-50, :71-75)이 그대로 통과해야 한다.
- **회전이 정확히 0일 때(`space.rotation === 0`, 가장 흔한 경우)는 가운데를 거치지 않는다.** `nodeLocalPoint` = `(world.x − x, world.y − y)`, `resizeSpaceTo` = `{ ...space, width, height }`(x·y는 받은 값 그대로), `nodeResizeCorner` = `(x + width, y + height)`.
  - 근거: 지금 식은 고정점을 `x + width/2 − width/2`로 구하고 새 x를 `고정점 + width′/2 − width′/2`로 되돌린다. 이 왕복이 마지막 자리를 흔든다(Node 22: `(244.65 + 30) − 30`은 244.64999999999998). 그대로 두면 이웃에 붙어 **정확히 같은 값**이 된 왼쪽·위 가장자리가 그 뒤의 크기 바꾸기 한 번에 어긋나고(승인 문구 "붙은 쪽은 상대 도형과 정확히 같은 값"), 같은 크기로 돌아온 끌기도 변경으로 남는다.
  - 기존 고정 값에는 영향이 없다: 회전 90의 값은 `near()` 비교이고, 회전 0의 경우(:19)는 가로·세로만 본다.
- 회전이 0이 아닐 때의 `nodeResizeCorner` = 고정점 + `rotate((width, height), rotation)`(고정점은 :14-15의 식).
- `placeMapNode`: 공간이면 `transformMapSpace(map, { ...selected, x: position.x, y: position.y })`, 그 밖은 `replaceMapNode`. 근거: `x + (대상 − x)` 같은 덧셈은 마지막 자리가 어긋날 수 있다. 저장 값을 직접 놓으면 왼쪽·위 가장자리가 붙었을 때 대상과 비트까지 같은 값이 되고, 붙지 않은 축은 정확한 정수가 된다. (오른쪽·아래·가운데로 붙은 경우의 `x + width`는 부동소수 오차 범위(1e-9 미만)에서 대상과 같다.)

### 6.4 값 규칙 한눈에

| 제스처 | 붙은 축 | 붙지 않은 축 | Alt 또는 스냅 끔 |
|---|---|---|---|
| 옮기기 | 저장 x(또는 y) = `대상 − offset` | 저장 x·y를 `Math.round` | v1.130.0 그대로(`start`로부터의 차이를 더한다) |
| 크기 바꾸기 (90° 단위) | 길이 = 붙인 모서리에서 계산 | 길이를 `Math.round` | `resizeSpace(node, 모서리 + 움직인 만큼)` 그대로(맞추지 않는다) |
| 크기 바꾸기 (그 밖의 회전) | — | 가로·세로 길이를 `Math.round` | 〃 |
| 회전 | 0·90·180·270 정확히 | 계산된 각도 그대로 | 계산된 각도 그대로 |
| 다각형 점 | 점 좌표 = 대상 값 | 점 좌표를 `Math.round` | 점(끼워 넣기는 변의 가운데) + 움직인 만큼 그대로 |
| 사각형·타원·다각형 **그리기** | 붙지 않는다 | 맞추지 않는다 | 누른 점·끄는 점·찍은 점 그대로(스냅과 무관하게 늘 이 칸) |

소속 카메라·기호는 공간을 따라갈 뿐 따로 맞추지 않는다(공간 크기를 바꾸면 지금처럼 비율로 따라간다). 크기 바꾸기와 다각형 점은 손잡이의 기준점에 움직인 만큼을 더한 자리를 쓴다(3.3): 누른 자리가 손잡이 가운데에서 벗어나 있어도 첫 움직임에 튀지 않는다.

### 6.5 편집기 배선

- 계산은 3.3·3.4의 한 줄기뿐이다. **스냅은 `previewPlanGesture` 안에서만** 일어나고, 그 입력은 (제스처 시작 도면, 누른 점, 지금 점, 후보, 허용 거리, 닿는 거리)다. 허용 거리와 닿는 거리는 `MAP_SNAP.tolerancePx`·`MAP_SNAP.reachPx`에 누른 순간의 화면 배율값(`session.scale`)을 곱한 도면 단위다(3.4). `finishGesture` 뒤에 좌표를 고쳐 쓰는 코드는 없다.
- 상태:
  ```ts
  const [snapEnabled, setSnapEnabled] = useState(readSnapPreference);
  const [guides, setGuides] = useState<readonly SnapGuide[]>(NO_GUIDES);
  const showGuides = (next: readonly SnapGuide[]) => setGuides(previous => sameSnapGuides(previous, next) ? previous : next);
  ```
- 버튼(:678의 `.bmap-zoom` 맨 앞, `mode === 'plan' && editing`일 때만):
  ```tsx
  <button type="button" className="bmap-snap-toggle" aria-pressed={snapEnabled}
    title={snapEnabled ? '스냅 켜짐: 가까운 가장자리·가운데에 붙어요 · Alt를 누른 채 끌면 잠깐 꺼져요' : '스냅 꺼짐: 놓은 자리 그대로예요'}
    onClick={() => { const next = !snapEnabled; setSnapEnabled(next); storeSnapPreference(next); }}>스냅</button>
  ```
- 안내선: 카메라들 다음, 손잡이 앞에 `<MapSnapGuides guides={guides} scale={screenScale} />`.
- Alt 키 — **끌기에 쓴 Alt는 뗄 때까지 창 메뉴로 보내지 않는다.**
  - 문제: 앱 창은 Electron 기본 메뉴 줄을 그대로 쓴다. `createWindow`(electron/main.ts:832-849)에 틀·메뉴 설정이 없고 `electron/` 아래에 `setApplicationMenu`·`setMenu`·`autoHideMenuBar` 호출이 없다(4.4가 기대는 것과 같은 기본 메뉴다. 미리보기 창 `scripts/preview-electron.cjs`도 같다). Windows의 Electron 기본 메뉴 줄은 Alt만 눌렀다 떼면 키보드 포커스를 가져가고, 그러면 그 다음의 Delete·Ctrl+Z·F2·`+ − 0`은 편집기에 오지 않는다(Electron의 알려진 기본 동작이다. 이 앱에서 직접 돌려 본 것은 아니어서 13절 E3의 ⑤에서 함께 본다).
  - 승인된 동작 "Alt를 누른 채 끈다"의 보통 순서는 **Alt 누름 → 마우스 누름 → 끌기 → 마우스 뗌 → Alt 뗌**이다. "Alt 키 이벤트가 올 때 포인터가 눌려 있는가"(`pointerRef.current`)로 막으면 이 순서에서 아무것도 막지 못한다: 마지막 Alt 뗌이 올 때는 이미 `pointerUp`이 `pointerRef.current`를 비웠고(:487), 마우스를 뗀 뒤 Alt를 떼기 전까지 오는 자동 반복 누름도 빠져나간다. 그래서 포인터 상태가 아니라 **"지금 눌려 있는 Alt가 끌기에 쓰였는가"**를 적어 둔다.
    ```ts
    /** The Alt key being held was used on a plan drag: its key events stay away from the window menu until it is released. */
    const altDrag = useRef(false);
    useEffect(() => {
      const key = (event: KeyboardEvent) => {
        if (event.key !== 'Alt') return;
        if (event.type === 'keydown' && pointerRef.current) altDrag.current = true;     // 끄는 중에 누른 Alt
        if (!altDrag.current) return;
        event.preventDefault();                                                          // 자동 반복 누름도 여기로 온다
        if (event.type === 'keyup') altDrag.current = false;                             // 그 Alt 를 뗐다
      };
      const forget = () => { altDrag.current = false; };                                 // Alt+Tab 등: 떼는 이벤트가 이 창에 오지 않는다
      window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true); window.addEventListener('blur', forget);
      return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); window.removeEventListener('blur', forget); };
    }, []);
    ```
  - **켜는 곳**(셋): `pointerDown`이 세션을 기록할 때 `event.altKey`면, `pointerMove`가 세션을 확인한 직후 `event.altKey`면(3.4), 그리고 포인터를 누르고 있는 동안 Alt를 누르면(위 처리기).
  - **끄는 곳**(둘): 그 Alt를 떼는 `keyup`(막은 다음에), 창이 포커스를 잃을 때. **마우스를 떼는 것으로는 끄지 않는다** — 그 뒤에 오는 Alt 뗌을 막는 것이 목적이다. 다른 키를 눌렀다고 끄지도 않는다(끄면 그 뒤의 Alt 뗌이 다시 빠져나간다).
  - 막는 것은 `event.key === 'Alt'`인 `keydown`·`keyup`뿐이다. 켜져 있는 동안의 다른 키(Alt+F4 등)는 건드리지 않는다. 끌기에 쓰지 않은 Alt(혼자 눌렀다 뗌)는 지금처럼 창 메뉴로 간다.
  - 맨 처음 Alt 누름(마우스를 누르기 전)은 막을 수 없다 — 끌기가 올지 아직 모른다. 그 뒤의 반복 누름과 **뗌**을 막는 것으로 충분하다고 본다: 메뉴 줄이 포커스를 가져가는 계기는 Alt의 뗌이다. 이 부분은 조건식과 Electron 기본 메뉴의 동작에서 따져 본 것이고 **앱에서 돌려 본 것이 아니다.** 13절 E3에서 두 가지 떼는 순서 모두를 확인한다(16절).
  - 창(window) 캡처 한 곳에 두는 이유: 포커스가 어디에 있든 듣고, 편집기의 다른 키 처리보다 먼저 돈다. `keyboard()`와 루트 `<div>`에는 Alt 처리를 두지 않는다(같은 규칙을 두 곳에 쓰지 않는다). `altDrag`는 평면의 포인터 세션에서만 켜지므로 3D 모드에서는 아무 일도 하지 않는다.
  - 남은 플래그가 할 수 있는 일은 "다음번 Alt 단독 누름 한 번이 창 메뉴로 가지 않는다"뿐이다(예: Alt+Space로 창 메뉴를 열어 뗌이 오지 않은 뒤). 편집 내용에는 닿지 않는다.

### 6.6 경계 상황

| 상황 | 동작 |
|---|---|
| 잠긴 노드 | 끌리지 않는다(`click` 모드, 지금과 같다). 붙는 대상으로는 쓰인다 |
| 보기 모드 | 제스처가 없다 |
| 끄는 중 Esc·포인터 취소·도면이나 모드 전환·저장 시작 | 지금처럼 취소되고 안내선도 지워진다 |
| 되돌리기·다시 실행·저장 | 제스처 중에는 지금처럼 막혀 있다 |
| 멀리 있는 도형과 줄이 맞는 자리(다른 축으로 화면 48px 넘게 떨어짐) | 붙지 않는다. 안내선도 없고, 그 축은 정수로 떨어진다 |
| 빈 자리(둘레 48px 안에 아무것도 없고 테두리와도 줄이 맞지 않음) | 붙을 것이 없다. 안내선 없이 저장 x·y가 정수 |
| 가구가 많은 방 안에서 의자를 옮김 | 그 방(품고 있으므로 늘 대상)과 48px 안의 가구에만 붙는다. 방 건너편 가구와는 줄이 맞아도 붙지 않는다 |
| 화면에서 24px보다 작은 도형(좁은 창 100%의 의자가 이쯤이다) | 시작·가운데·끝의 붙는 폭(각 ±6px)이 서로 이어진다. **가까이 있는** 것의 선 하나를 지나는 동안에는 계속 붙어 있고 안내선이 보인다(가장 가까운 선이 이긴다, 같으면 시작). 화면 12px보다 작으면 세 선이 한꺼번에 허용 거리 안에 든다. 이 크기에서 자유롭게 놓으려면 확대하거나 Alt를 누른다. 알고 넘어가는 것(16절) |
| 돌려 놓은 도형 | 가운데로만 붙고, 붙지 않은 축은 저장 x·y가 정수. 가까운지는 가운데 점이 아니라 **보이는 윤곽을 감싼 상자**로 잰다(`nodeSnapSpan`): 큰 방을 돌려 놓아도 옆방과 맞닿아 있으면 그 방의 가운데 줄에 붙는다. 돌려 놓은 도형이 상대일 때도 같다 |
| 10% / 400% | 허용 거리는 화면 6px, 닿는 거리는 화면 48px 그대로(도면 단위로는 달라진다). 멀리 축소하면 화면에서 가까운 것이 많아져 붙는 일이 잦다 — 화면 거리 기준이라 그렇다 |
| Alt를 누른 채 끌고 마우스를 먼저 뗀 뒤 Alt를 뗌 / 끄는 중에 Alt를 눌렀다 뗌 | 어느 순서든 창 메뉴가 포커스를 가져가지 않는다. 다음 Delete·Ctrl+Z·F2가 바로 듣는다(6.5) |
| 끌다가 제자리로 돌아옴 | 소수 좌표였던 노드는 가까운 정수로 정리될 수 있다(되돌리기 한 단계). Alt를 누르면 그대로 |
| 좌표가 ±100000 밖으로 나감 | 지금과 같다(평면 끌기는 자르지 않고, 저장할 때 검증이 거절한다) |
| 공간을 옮길 때 그 안의 의자 | 함께 가므로 대상이 아니다. 잠긴 의자는 남으므로 대상이다 |

---

## 7. F11 다각형 점 편집

### 7.1 동작 규칙

1. **점 손잡이가 보이는 조건**(모두): 평면 모드, 편집 가능, 선택 도구, 선택된 것이 잠기지 않은 다각형 공간 하나, 화면에서 긴 변이 32px 이상. 조건이 깨지면 바로 사라진다.
   - 마지막 조건(크기)만 맞지 않아 숨겨졌을 때는 아래 줄 힌트가 `확대하면 점을 고칠 수 있어요 · 휠로 확대`로 바뀐다(10.2). 좁은 창에서는 100%에서도 도면 1단위가 화면 0.4px쯤이라(도면 영역 330px에서 아래 줄 42px을 뺀 높이 ÷ 680) 도면 70단위짜리 방이 여기에 든다. 아무 표시 없이 동그라미가 안 나오면 기능이 없는 것처럼 보인다.
2. 꼭짓점마다 동그라미(화면 지름 10px, 누르는 범위 반지름 9px). 화면 길이 28px 이상인 변의 가운데에는 '+' 동그라미(점이 200개면 없음).
3. **점 끌기**: 그 점만 움직인다. 다른 점들은 화면에서 제자리다(돌려 놓은 다각형도). 공간의 x·y·가로·세로는 새 점들의 상자로 다시 계산되고 회전은 그대로다.
4. **'+' 끌기**: 그 변에 새 점이 생기며 바로 끌린다. 끌지 않고 누르기만 하면 아무것도 생기지 않는다.
5. **점 고르기**: 점을 누르면(끌지 않아도) 그 점이 고른 점이 된다(채워진 동그라미). '+'로 만든 점은 놓는 순간 고른 점이 된다.
6. **Delete**: 고른 점이 **화면에 보이고 있으면** 그 점을 지운다. 점이 3개뿐이면 지우지 않고 안내를 띄운다. 어느 쪽이든 노드 삭제 확인 창은 뜨지 않는다. 고른 점이 없거나 점 손잡이가 보이지 않으면(축소해서 숨겨짐, 잠금, 다른 도구) 지금과 똑같다: 노드 삭제 확인, 잠긴 노드면 무동작. 보이지 않는 점은 지워지지 않는다.
7. **스냅**(켜져 있고 Alt 없음): 승인 문구가 꼽은 **두 가지에만** 붙는다.
   - ① 옆 두 점의 가로·세로와 맞는 자리(직각을 만드는 자리). 옆 점이 얼마나 멀리 있든 그 점의 x 또는 y에서 화면 6px 안이면 붙는다.
   - ② 다른 공간(사각형·다각형)의 모서리. 그 모서리에서 화면 6px 안이면 그 점 그대로.
   - **붙지 않는 것**: 다른 도형의 변 중간·가운데 선, 기호와 카메라(그 다각형 안에 있는 가구·카메라 포함), 타원, 도면 테두리. 6.1의 2는 옮기기·크기 바꾸기의 대상이고 점에는 쓰지 않는다. 점이 방 안 의자의 줄에 붙으면 가구 놓인 방의 모양을 고칠 때마다 걸린다.
   - 붙지 않은 축은 그 **점의 좌표**를 정수로 맞춘다. 상자를 반올림하지 않으므로 다른 점은 움직이지 않는다.
8. 소속 카메라·기호는 제자리에 있다. 소속 관계(`spaceId`)도 그대로다(바뀐 모양 밖에 남아도 지금 규칙대로 소속은 유지).
9. **한계**: 결과의 상자 한 변이 10 미만이거나 100000 초과, 넓이 1 미만, 위치가 ±100000 밖이면 그 미리보기를 받지 않는다(마지막으로 유효했던 모양에 머문다). 옮기거나 끼운 점이 **옆 점과 같은 자리**가 되는 위치도 받지 않는다 — 옆 점의 가로·세로 선에 함께 붙으면 정확히 그 점 위에 놓여, 길이 0인 변과 겹친 점 손잡이 둘이 생기기 때문이다.
10. 되돌리기: 점 끌기 한 번, '+' 끌기 한 번, 점 지우기 한 번, 다각형으로 바꾸기 한 번이 각각 한 단계.
11. **'다각형으로 바꾸기'**: 편집 중 사각형 공간을 고르면 속성 칸에 나온다. 누르면 같은 자리·크기·회전의 네 점 다각형이 되고 점 손잡이가 바로 보인다. 타원 공간에는 버튼이 없다. 반대로 되돌리는 버튼은 없다(되돌리기로).
12. 변이 서로 엇갈리는 모양은 막지 않는다(그리기 도구도 지금 막지 않는다).
13. 3D와 보조 평면도는 같은 초안을 읽으므로 끄는 동안 함께 바뀐다(다각형 점은 3D 모양 키에 들어 있다, map3dScene.ts:87-93).

### 7.2 순수 함수 (`mapGeometry.ts`)

```ts
/**
 * A polygon space rebuilt from absolute plan points. The rotation is kept, the box becomes the bounding box of the
 * points in the space's own unrotated frame, and every point is normalised against it, so each point keeps its plan
 * position. Null when the result cannot be stored.
 */
export function polygonFromWorldPoints(space: BackgroundSpace, points: readonly BackgroundPoint[]): BackgroundSpace | null;
export function movePolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null;
/** Adds `point` between `index` and the next point. */
export function insertPolygonVertex(space: BackgroundSpace, index: number, point: BackgroundPoint): BackgroundSpace | null;
export function removePolygonVertex(space: BackgroundSpace, index: number): BackgroundSpace | null;
/** A rectangle as a four-point polygon with the same outline. Null for other shapes and for locked spaces. */
export function rectToPolygon(space: BackgroundSpace): BackgroundSpace | null;
```

`polygonFromWorldPoints`(P = 절대 좌표 점들, r = `space.rotation`, `rotate`는 mapGeometry.ts:6-9):

1. `c0 = (x + width/2, y + height/2)`. `L[i] = rotate(P[i] − c0, −r)`.
2. `minX, maxX, minY, maxY` = L의 범위. `width′ = maxX − minX`, `height′ = maxY − minY`. 넓이 = L의 신발끈 공식 절댓값 / 2.
3. `null`을 돌려주는 경우: 점이 3개 미만 또는 200개 초과, 유한하지 않은 값, `width′`나 `height′`가 10 미만 또는 100000 초과, 넓이 1 미만.
4. `c′ = c0 + rotate(((minX + maxX)/2, (minY + maxY)/2), r)`. `x′ = c′.x − width′/2`, `y′ = c′.y − height′/2`. `|x′|`나 `|y′|`가 100000을 넘으면 `null`.
5. `points[i] = { x: clamp01((L[i].x − minX) / width′), y: clamp01((L[i].y − minY) / height′) }`.
6. `{ ...space, x: x′, y: y′, width: width′, height: height′, points }`.

검산: 새 공간의 i번째 점 = `c′ + rotate(L[i] − 상자 가운데, r)` = `c0 + rotate(L[i], r)` = `P[i]`. 임시 스크립트에서 회전 37°의 네 점 다각형으로 한 점을 옮겼을 때 나머지 점의 오차는 3e-14 이하였다.

- `movePolygonVertex` / `insertPolygonVertex` / `removePolygonVertex`: 다각형이 아니거나, 잠겼거나, `index`가 정수 범위 밖이면 `null`. 절대 좌표 점들은 `nodePlanOutline(space)`(mapSpatial.ts:239-256, 다각형이면 저장 순서 그대로)에서 얻고, 하나를 바꾸거나 `index + 1` 자리에 끼우거나 뺀 뒤 `polygonFromWorldPoints`. 지우기는 점이 3개 이하면 `null`, 끼우기는 200개면 `null`.
- 옮기기·끼우기는 새 점이 양옆 점 가운데 하나와 `Math.hypot` 1e-6 미만이면 `null`. 양옆 = 옮기기는 `(index ± 1) mod n`, 끼우기는 `index`와 `(index + 1) mod n`(바꾸기 전 목록 기준).
- `rectToPolygon`: `shape === 'rect'`이고 잠기지 않았을 때 `{ ...space, shape: 'polygon', points: [{0,0}, {1,0}, {1,1}, {0,1}] }`. 사각형의 윤곽 순서(mapSpatial.ts:212)와 같아 `nodePlanOutline`이 바꾸기 전과 완전히 같다.
- **`transformMapSpace`를 거치지 않는다.** 그 함수는 x·y·크기가 달라지면 이동/비율로 보고 소속 항목을 옮긴다(mapGeometry.ts:30, :36-48). 점 편집 결과는 `replaceMapNode`로 그 노드만 바꿔 넣는다.

### 7.3 편집기 배선

- 상태(편집기 화면 상태): `const [activeVertex, setActiveVertex] = useState<{ mapId: string; nodeId: string; index: number } | null>(null);`
  - **고른 점은 화면에 보이는 점 손잡이에서만 나온다**(렌더마다, 점 손잡이를 구한 뒤).
    ```ts
    const activeIndex = vertexHandles && activeVertex && activeVertex.mapId === current.id && activeVertex.nodeId === selected?.id
      && activeVertex.index < vertexHandles.vertices.length ? activeVertex.index : null;
    ```
    `vertexHandles`가 `null`이면(화면에서 32px보다 작게 축소됨, 잠금, 선택 도구가 아님, 저장 중) 고른 점도 없는 것으로 친다. `setActiveVertex(null)`을 부르지 않는 길로 손잡이가 사라져도 — 휠 축소(누르기를 거치지 않는다), 속성 칸의 잠금, 기호 팔레트에서의 도구 전환(:602, 도구 버튼을 거치지 않는다) — Delete가 보이지 않는 점을 지우지 않는다. 손잡이가 다시 보이면(다시 확대) 같은 점이 고른 점으로 돌아온다.
  - 지우는 때: 점 손잡이가 아닌 곳을 누름(3.4), Esc(`keyboard()`의 Escape 분기에 `setActiveVertex(null)`), `undo()`(:309-313) 안, 도구를 바꿀 때(도구 버튼 `onClick`), '+' 끌기가 아무 점도 만들지 못했을 때(3.4), 그리고 `useEffect(() => setActiveVertex(null), [view.selectedId, current?.id, mode, canEdit])`.
- 점 손잡이:
  ```tsx
  const vertexHandles = mode === 'plan' && canEdit && tool === 'select' && selected?.type === 'space' && !selected.locked
    ? planVertexHandles(selected, screenScale) : null;
  …
  {selected && canEdit && !selected.locked && <MapNodeHandles node={selected} scale={screenScale} vertexHandles={!!vertexHandles}
    onHandleDown={(event, handle) => pointerDown(event, selected, handle)} />}
  {vertexHandles && selected?.type === 'space' && <MapVertexHandles handles={vertexHandles} scale={screenScale} activeIndex={activeIndex}
    onHandleDown={(event, handle) => pointerDown(event, selected, handle)} />}
  ```
  그리는 순서: 안내선 → 회전·크기 손잡이 → '+' → 꼭짓점(맨 위).
- 점 끌기는 3.3·3.4의 `vertex` 모드다(보통 제스처: 시작 → `session.initial`에서 다시 계산한 미리보기 → 끝 = 되돌리기 한 단계). 움직이지 않고 떼면 지금처럼 `cancelGesture`.
- Delete(`keyboard()`의 입력 칸 가드 뒤, 노드 삭제 줄(:521) **앞**). 위에서 구한 `activeIndex`를 읽는다(`activeVertex` 상태를 직접 읽지 않는다). 손잡이가 보이지 않으면 이 분기를 지나 노드 삭제 줄로 간다.
  ```ts
  if (event.key === 'Delete' && activeIndex !== null && selected?.type === 'space' && canEdit && !target.closest('dialog')) {
    event.preventDefault();
    if (pointerRef.current || doc.isGestureActive()) return;
    const shaped = removePolygonVertex(selected, activeIndex);
    if (shaped) { updateMap(replaceMapNode(current, shaped)); setActiveVertex(null); setError(''); }
    else setError(selected.points.length <= 3 ? '다각형에는 꼭짓점이 3개 이상 필요해요. 이 점은 지울 수 없어요.' : '이 점을 지우면 공간이 너무 작아져요.');
    return;                                                            // 노드 삭제로 넘어가지 않는다
  }
  ```
  누른 뒤의 포커스는 SVG에 있으므로(`pointerDown`이 준다) 키가 이 처리기에 닿는다.
- '다각형으로 바꾸기'(속성 칸, 공간의 연결 구역(:685-691) 다음·접이식 항목들 앞, `editing && selected.type === 'space'`):
  ```tsx
  <div className="bmap-shape-actions">
    {selected.shape === 'rect' && <><button type="button" className="bmap-text-button" disabled={fieldLocked || gestureActive}
      onClick={() => { const shaped = rectToPolygon(selected); if (shaped) updateMap(replaceMapNode(current, shaped)); }}>다각형으로 바꾸기</button>
      <p className="bmap-hint">꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.</p></>}
    {selected.shape === 'polygon' && <p className="bmap-hint">점을 끌어 모양을 고쳐요. 변 가운데의 +를 끌면 점이 생기고, 점을 고른 뒤 Delete를 누르면 지워져요.</p>}
  </div>
  ```
  위치 결정 근거: '위치·크기·잠금' 접이식 안에 넣으면 기본으로 접혀 있어 찾을 수 없다. 타원에는 아무것도 그리지 않는다.

### 7.4 경계 상황

| 상황 | 동작 |
|---|---|
| 잠긴 다각형·보기 모드·손 도구·그리기 도구 | 점 손잡이 없음 |
| 사각형·타원 | 점 손잡이 없음(사각형은 버튼으로 바꾼 뒤) |
| 화면에서 32px보다 작은 다각형 | 점 손잡이 없음 — 몸통을 끌면 옮겨진다. 아래 줄 힌트가 확대를 안내하고(10.2), 확대하면 나온다 |
| 10% / 400% | 점 손잡이·'+'·안내선은 화면 크기 그대로. 축소해서 변이 화면 28px보다 짧아지면 그 변의 '+'만 사라진다 |
| 상자 오른쪽 아래 모서리에 점이 있음(사각형에서 바꾼 직후, ㄱ자·ㄴ자 방) | 크기 네모가 모서리 바깥 대각선으로 비켜 서고 짧은 줄기로 모서리와 이어진다(3.2). 점과 네모를 각각 누를 수 있고, 네모를 끌면 지금처럼 전체 크기가 바뀐다. 그 점을 멀리 옮기면 네모가 모서리로 돌아온다 |
| 점을 고른 뒤 손잡이가 사라짐(축소·잠금·도구 전환) | 고른 점이 없는 것으로 친다. Delete는 지금처럼 노드 삭제 확인(잠겼으면 무동작) |
| 점 손잡이를 가운데에서 벗어나 누르고 끎 | 누른 자리와 상관없이 움직인 만큼만 옮겨진다(3.3). 맞아 있던 점이 누르기만으로 어긋나지 않는다 |
| 점을 옆 점 위로 끌어감 | 그 위치는 받지 않는다(마지막 유효 모양) |
| '+'를 끌었지만 받아들여진 위치가 하나도 없음 | 아무것도 생기지 않고 고른 점도 없다 |
| 돌려 놓은 다각형 | 점은 화면의 가로·세로 기준으로 붙고, 나머지 점은 제자리 |
| 점을 다른 방의 변 중간, 방 안의 의자·카메라 옆, 도면 테두리 가까이로 끌어감 | 붙지 않는다(안내선 없음). 그 점의 좌표가 정수로 떨어진다. 붙는 곳은 옆 점의 가로·세로와 다른 공간의 모서리뿐이다(7.1의 7) |
| 끄는 중 노드가 사라짐·권한을 잃음 | 지금처럼 제스처 취소 |
| 되돌리기 뒤 | 고른 점을 지운다(번호가 다른 점을 가리킬 수 있다) |
| 점 200개 | '+'가 없다 |
| 점을 끌어 상자가 10보다 좁아짐 | 그 위치는 받지 않는다(마지막 유효 모양) |
| 회전·크기 손잡이를 끄는 중 | 점 손잡이는 미리보기를 따라 함께 움직인다 |

---

## 8. 새 상태가 사는 곳

| 상태 | 사는 곳 | 저장·되돌리기 |
|---|---|---|
| 확대·위치 | 문서(`viewports`, 기존) | 아님 |
| 이름 칸(`renaming`), 안내선(`guides`), 고른 점(`activeVertex`) | 편집기 `useState` | 아님 |
| 최근 두 누름의 기록(`pressLog` — 캔버스가 받지 않은 누름마다 비운다, 3.4), 미뤄 둔 넘기기(`pendingCycle`) | 편집기 `useRef` | 아님 |
| 눌려 있는 Alt가 끌기에 쓰였는지(`altDrag`, 6.5) | 편집기 `useRef` | 아님 |
| 제스처의 화면 배율값·후보·점 번호 | `PointerSession`(ref) | 아님 |
| 스냅 켜기/끄기 | 편집기 `useState` + `localStorage` `bflow.background-map.snap.v1` (`on`/`off`, 없으면 켜짐) | 기기별 |
| 이름·점·위치·크기 | 초안(기존 필드만) | 예 |

문서(`mapDocument.ts`)의 상태 모양과 액션은 바뀌지 않는다.

---

## 9. 화면 조각 (`BackgroundMapPlanOverlays.tsx`, 새 파일)

모두 받은 값만 그리는 SVG 조각이다. 계산은 `mapPlanEdit.ts`·`mapSnap.ts`가 한다.

```tsx
export function MapSnapGuides({ guides, scale }: { guides: readonly SnapGuide[]; scale: number }): JSX.Element | null;
export function MapNodeHandles({ node, scale, vertexHandles, onHandleDown }: {
  node: BackgroundNode; scale: number; vertexHandles: boolean;
  onHandleDown(event: ReactPointerEvent<SVGElement>, handle: 'resize' | 'rotate'): void }): JSX.Element;
export function MapVertexHandles({ handles, scale, activeIndex, onHandleDown }: {
  handles: PlanVertexHandles; scale: number; activeIndex: number | null;
  onHandleDown(event: ReactPointerEvent<SVGElement>, handle: { index: number; insert: boolean }): void }): JSX.Element;
```

- `MapSnapGuides`: `<g className="bmap-snap-guides" pointerEvents="none" aria-hidden="true">`. x축 선은 `x1 = x2 = at`, `y1 = from − 8·scale`, `y2 = to + 8·scale`. y축 선은 그 반대. 없으면 `null`.
- `MapNodeHandles`: `planNodeHandles(node, scale, vertexHandles)`대로 지금의 마크업(`.bmap-handles`, `.bmap-camera-guide`, `.bmap-camera-direction`, `.bmap-rotate-handle`, `.bmap-resize-handle`, `<g>`의 `transform`은 :650, :656 그대로)을 그린다. `resize`가 `null`이면 크기 네모를 그리지 않고, `resize.shifted`면 네모 앞에 줄기 `<line x1={width} y1={height} x2={resize.x} y2={resize.y} />`를 하나 더 그린다(모양은 기존 `.bmap-handles line`).
- `MapVertexHandles`: `<g className="bmap-vertex-handles" aria-hidden="true">` 안에 '+'들(`<g className="bmap-vertex-add">`: 누르는 원 r `9·scale`, 보이는 원 r `5·scale`, 십자 `<path>`)을 먼저, 꼭짓점들(`<g className="bmap-vertex-handle" + (i === activeIndex ? ' is-active' : '')>`: 누르는 원 r `9·scale`, 보이는 원 r `5·scale`)을 나중에. 좌표는 절대 좌표(회전 그룹 밖).

---

## 10. CSS와 문구

### 10.1 새 클래스 (`backgrounds-map.css`)

| 클래스 | 쓰임 | 핵심 |
|---|---|---|
| `.bmap-snap-guides line` | 안내선 | `stroke:#ff7aa8`(밝은 화면 `#d6336c`), `stroke-width:1`, `vector-effect:non-scaling-stroke`, `pointer-events:none` |
| `.bmap-vertex-handle` | 꼭짓점 손잡이 | 누르는 원은 투명. 보이는 원은 `.bmap-handles circle`과 같은 채움·테두리, `cursor:move` |
| `.bmap-vertex-handle.is-active` | 고른 점 | 보이는 원을 `rgb(var(--color-accent-sub))`로 채움 |
| `.bmap-vertex-add` | 변 가운데 '+' | 보이는 원은 점선 테두리, 십자는 `stroke` 1.5, `cursor:copy` |
| `.bmap-name-box` | 이름 칸 | `position:absolute; z-index:3; width:168px; min-height:30px; padding:4px 8px; transform:translate(-50%,-50%); text-align:center; font-size:13px;` 강조색 테두리, 카드 배경, 옅은 그림자 |
| `.is-renaming text` | 이름을 고치는 노드의 SVG 글자 | `visibility:hidden` (`.bmap-space` · `.bmap-symbol` · `.bmap-camera`에 붙는다) |
| `.bmap-snap-toggle` | 스냅 버튼 | `margin-right:6px`. 켜졌을 때(`[aria-pressed="true"]`) 도구줄의 활성 버튼과 같은 글자색·배경(backgrounds-map.css:41). 선택자는 아래 |
| `.bmap-footer-hint` | 아래 줄 힌트(평면) | 두 줄 높이로 고정: `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; line-height:15px;` 선택자는 아래 |
| `.bmap-shape-actions` | 속성 칸의 모양 줄 | `margin:10px 0 4px` |

- 스냅 버튼의 켜진 모양은 `.bg-library .bmap-zoom .bmap-snap-toggle[aria-pressed="true"]`로 쓴다. 확대 버튼 공용 규칙 `.bg-library .bmap-zoom button { … background:transparent; }`(backgrounds-map.css:79, 특이도 0,2,1)가 `.bmap-snap-toggle[aria-pressed="true"]`(0,2,0)를 이기므로, 짧게 쓰면 배경이 적용되지 않는다. 밝은 화면에서도 켜짐·꺼짐이 구분되는지 본다(13절 R5).
- 아래 줄 힌트 `<span>`에 `className="bmap-footer-hint"`와 `title={mode === 'plan' ? footerHint : undefined}`를 단다. 고정 규칙의 선택자는 `.bmap-canvas-wrap:not(.is-3d) .bmap-footer-hint` — 평면에서만 건다(3D의 힌트와 아래 줄은 지금 그대로다).
  - 근거: 이번에 힌트가 **선택에 따라** 바뀐다(10.2). 창 너비 1200px 이하에서는 힌트가 180px로 묶여 줄이 바뀌므로(backgrounds-map.css:116), 문구에 따라 아래 줄 높이가 달라지면 그 위의 SVG(`flex:1`, :44)가 다시 맞춰진다. 더블클릭의 첫 클릭이 다각형을 고르는 순간 도면이 밀려 둘째 클릭이 다른 곳에 떨어질 수 있다. 두 줄로 고정하면 평면의 아래 줄은 늘 지금의 최소 높이 42px이다(글자 10px·줄 15px × 2 + 위아래 여백 12px, 버튼 줄은 26px + 12px).
  - 두 줄에 다 들어가지 않는 문구는 말줄임으로 잘리고 `title`로 전체를 볼 수 있다. 10.2의 문구는 180px 두 줄에 들어가도록 짧게 썼다(13절 R6에서 확인).
- 이름 칸의 선택자는 `.bg-library input.bmap-name-box:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"])`로 쓴다. 배경 화면 공용 입력 규칙(backgrounds.css의 `.bg-library input:not(…)…`, `width:100%`·`min-height:36px`)보다 구체적이어야 덮인다(같은 방식: backgrounds-map.css:207).
- 움직임 규칙: 새 요소에는 전환·애니메이션을 넣지 않는다. 이름 칸의 `transform`은 고정 값이다. 그래서 동작 줄이기용 짝 규칙도 필요 없다. `backdrop-filter`를 쓰지 않는다.
- 색은 어두운·밝은 화면 둘 다에서 확인한다(안내선은 `[data-color-mode="light"]` 짝을 둔다).

### 10.2 문구

| 자리 | 문구 |
|---|---|
| 아래 줄 힌트 — 평면·편집 중·점 손잡이가 보임(`vertexHandles`가 있음) | `점을 끌어 모양 고치기 · +를 끌어 점 추가 · 점 고르고 Delete` |
| 아래 줄 힌트 — 평면·편집 가능·선택 도구·잠기지 않은 다각형이 선택됐는데 작게 보여 점 손잡이가 숨겨짐(`vertexHandles`가 `null`) | `확대하면 점을 고칠 수 있어요 · 휠로 확대` |
| 아래 줄 힌트 — 평면·편집 중(그 밖) | `끌어 옮기기 · 모서리로 크기 · 원으로 회전 · 더블클릭 이름 · 휠 확대` |
| 아래 줄 힌트 — 평면·보기 | `클릭해서 선택 · 공간 더블클릭으로 상세 도면 열기 · 휠로 확대` |
| 아래 줄 힌트 — 다각형 도구, 기호 놓기, 3D | 지금 그대로 |
| 연결된 공간 안내(:687) — 편집 중 | `공간을 더블클릭해도 열립니다. 이름은 F2 키나 위의 이름 칸에서 바꿔요.` (보기 모드는 지금 문구) |
| 스냅 버튼·맞춤·확대 버튼의 `title`, 모양 줄, 점 지우기 안내 | 4.3, 6.5, 7.3에 적은 그대로 |

---

## 11. 파일 계획

새 파일

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapSnap.ts` | 스냅 대상 모으기, 가까이 있는 것만 거르기(닿는 거리), 옮기기·크기·점·회전의 붙이기와 정수 맞춤, 안내선 값 (순수, three.js·DOM 없음) |
| `src/features/backgrounds/mapPlanGesture.ts` | 평면 제스처 한 번의 미리보기: (시작 도면, 누른 점, 지금 점, 스냅) → (도면, 안내선) (순수) |
| `src/features/backgrounds/mapPlanEdit.ts` | 화면 크기 상수, 손잡이·점 손잡이 배치, 더블클릭 대상, 스냅 설정 읽기/쓰기 |
| `src/features/backgrounds/BackgroundMapNameBox.tsx` | 캔버스 위 이름 입력 칸(위치·포커스·Enter/Esc/blur) |
| `src/features/backgrounds/BackgroundMapPlanOverlays.tsx` | 안내선, 회전·크기 손잡이, 점 손잡이를 그리는 SVG 조각 |
| `tests/backgroundMapSnap.test.ts` · `tests/backgroundMapPlanGesture.test.ts` · `tests/backgroundMapPlanEdit.test.ts` · `tests/backgroundMapEditorWiring.test.ts` | 12절 |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `mapDocument.ts` | `MAP_ZOOM_LIMITS.min` 0.1, `MAP_LABEL_SCALE_LIMITS`, `mapScreenScale`, `zoomMapViewportAt`, `wheelZoomFactor`, `MAP_FIT_MARGIN`, `fitMapViewport`. 리듀서·상태 모양은 그대로 |
| `mapGeometry.ts` | `nodeLocalPoint`·`resizeSpaceTo`(기존 `resizeSpace`를 둘로 나눔, 회전 0은 저장 값 그대로), `nodeResizeCorner`, `placeMapNode`, `replaceMapNode`(공개·전 종류), `renameMapNode`, `nodeNameAnchor`, 다각형 점 함수 다섯 개 |
| `BackgroundMapEditor.tsx` | 휠 효과·맞춤·키, 세션 필드와 누름 기록, 창 단위 처리기 둘(캔버스 밖 누름에 누름 기록 비우기 3.4 / 끌기에 쓴 Alt 6.5 — 하는 일이 달라 효과도 따로 둔다), `pointerMove`를 `previewPlanGesture` 호출로, 넘기기를 `click`으로, 더블클릭을 SVG 한 곳으로(노드 `<g>`의 `onDoubleClick` 셋 제거), 다각형 도구의 같은 점 거리, 이름 칸·안내선·점 손잡이 배선, 스냅 버튼, 모양 줄, 문구. 손잡이 JSX와 제스처 계산이 밖으로 나가므로 줄 수는 크게 늘지 않는다 |
| `backgrounds-map.css` | 10.1 |
| `tests/backgroundMapDocument.test.ts` · `tests/backgroundMapGeometry.test.ts` | 12절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 14절 |

건드리지 않는 파일: `types.ts`, `domain.ts`, `mapSpatial.ts`, `mapEditSession.ts`, `useBackgroundMapDocument.ts`, `mapWorkflow.ts`, `mapCanvas.ts`, `mapPlanPreview.ts`, `BackgroundMapPlanPreview.tsx`, `BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapCameraGizmo.ts`, `electron/**`, `DEVLOG/migrations/**`, `src/features/playground/featureFlag.ts`.

모듈 의존: `mapPlanGesture.ts` → `mapSnap.ts` → `mapGeometry.ts` → `mapSpatial.ts`. `mapPlanEdit.ts` → `mapSpatial.ts`. 거꾸로 가는 import는 없다.

### 다음 묶음 ②를 막지 않는 점

- `snapMove`는 처음부터 id 집합과 기준 노드를 받고 `delta`를 돌려준다. 묶음 이동은 같은 `delta`를 나머지에 더하면 된다. 닿는 거리는 합친 상자에서 재므로 묶음에도 그대로 쓴다.
- 넘기기가 `click`으로 옮겨져 있고, 더블클릭이 SVG에서 누름 기록으로 판정되며, `doubleClickNodeId`가 묶음 목록을 받는다. ②의 "작은 공간이 먼저, 다시 누르면 아래로"는 묶음 목록에 공간을 넣어 같은 길을 쓸 수 있다. 막는 것은 없지만 **②가 정해야 하는 것**이 있다.
  - 이번의 넘기기 조건 `event.detail >= 2 && canEdit`은 "묶음에는 카메라·기호만 있고, 보기 모드의 더블클릭은 그것들에 아무 일도 하지 않는다"에 기댄 **임시 조건**이다. 공간이 묶음에 들어오면 깨진다: 연결된 공간의 더블클릭은 보기 모드에서도 그 도면으로 들어가므로(5.1의 8), 지금 조건 그대로면 보기 모드에서 두 번 넘긴 뒤 들어가게 된다.
  - ②의 규칙은 이렇게 잡아야 한다: 더블클릭이 첫 누름의 대상에 작용하는 경우(이름 고치기, 연결된 공간으로 들어가기)에는 **보기 모드에서도** 둘째 클릭이 넘기지 않는다. 편집 중에 겹친 공간을 빠르게 두 번 누르면 "아래 공간으로"가 아니라 이름 고치기 / 들어가기가 된다는 점(이번 카메라 묶음과 같은 우선순위, 5.6의 1)도 ② 설계에서 한솔에게 보여 준다.
- 손잡이·점 손잡이는 "선택된 것 하나"일 때만 그린다(지금의 `selectedId`). 여러 개 선택이 들어오면 그 조건만 바꾼다.
- 선택 상자의 여유는 `screenScale`을 쓴다.

---

## 12. 테스트

모두 `node --test ./tests/background*.test.ts`(`npm run test:background`)에 자동으로 들어간다.

### 12.1 고정 값이 바뀌는 기존 테스트

| 위치 | 지금 | 바뀐 뒤 |
|---|---|---|
| `tests/backgroundMapDocument.test.ts:339` | `assert.equal(zoomMapViewport(home, 0.001).zoom, 0.25)` | `0.1` |

이 한 줄뿐이다. 같은 테스트의 :337-338, :340-341, 그리고 `resizeSpace` 고정 값(`tests/backgroundMapGeometry.test.ts:13-20, :44-50, :71-75`), `polygonSpace`(:99-104), 문서 키(`tests/backgroundMapDocument.test.ts:279`), 보기 값 모양(:253-275)은 **손대지 않고 통과**해야 한다.

### 12.2 `tests/backgroundMapDocument.test.ts`에 더하는 것

- `zoomMapViewportAt`: 4.2 표의 값. 기준점의 화면 위치 불변(`(anchor.x − x) × zoom`이 전후 같다)을 임의의 기준점 세 개로. 가운데 기준점이면 `zoomMapViewport`와 같은 결과. 한계·`NaN` 배율·`NaN` 기준점에서 받은 객체 그대로. `selectedId` 유지.
- `wheelZoomFactor`: 4.2 표의 값, `0` → 1, `NaN` → 1, 위·아래 대칭(`f(d) × f(−d) ≈ 1`). 쪽 단위(`deltaMode` 2): `(0.25, 2, false)` → 0.8187307530779818(0.25쪽 = 100, ×400 가지를 잘림 없이 지난다), `(1, 2, false)` → 0.697676326071031(400이 180에서 잘린다).
- `fitMapViewport`: 4.2 표의 네 경우. 기본 영역 위로만 나간 도면은 위쪽에만 여백. 유한하지 않은 좌표의 노드는 무시(`mapPlanBounds`와 같다). 결과로 만든 `viewBox`가 도면 상자를 포함한다.
- `mapScreenScale`: (1, 1000×680) → 1, (1, 500×680) → 2, (1, 2000×680) → 1, (2, 1000×680) → 0.5, 크기 0 → `1 / zoom`. `MAP_LABEL_SCALE_LIMITS.max === 1 / MAP_ZOOM_LIMITS.min`.
- **그리기 + 이름 = 한 단계**(리듀서, 5.4가 기대는 것): `begin-editing` → `gesture-begin` → `gesture-preview`(공간 하나를 더한 도면) → `gesture-finish` → `update`(그 공간의 이름을 바꾼 도면, `history: false`). 확인: `past.length === 1`, `value`의 공간 이름이 새 이름, `undo` 뒤 `value`에 그 공간이 없음, `redo` 뒤 **새 이름의** 공간이 돌아옴. 지금의 `history: false` 테스트(:82, :161)에는 제스처가 끝난 뒤의 경우가 없다.

### 12.3 `tests/backgroundMapSnap.test.ts` (새)

- `isQuarterTurn`: 0, 90, 180, 270, 360, −90, 89.995 → 참 / 30, 89.9, 45 → 거짓.
- `nodeSnapBox`: 회전 0의 방(100, 100, 144.65×80)의 `right`가 정확히 `244.65`(`===`), 회전 90의 방은 가로·세로가 바뀐 상자, 회전 30은 가운데 점, 기운 기호는 가운데 점, 카메라는 그 점. 네 방향 모두: 방(100, 100, 60×40)이 회전 180이면 `{ left: 100, right: 160, top: 100, bottom: 140 }`(저장 값 그대로, `===`), 회전 270이면 `{ left: 110, right: 150, top: 90, bottom: 150 }`.
- `nodeSnapSpan`: 회전 0·90·180·270의 방은 `nodeSnapBox`와 네 값이 모두 `===` / 카메라는 그 점 / 회전 30의 방(500, 300, 80×40)은 윤곽을 감싼 상자 `{ left ≈ 495.359, right ≈ 584.641, top ≈ 282.679, bottom ≈ 357.321 }`(1e-3 안) / 기운 기호는 `nodePlanOutline`의 최소·최대와 같다.
- `snapTravellingIds`: 공간 + 잠기지 않은 소속 카메라·기호 / 잠긴 소속 항목과 다른 공간의 항목은 제외 / 잠긴 공간은 자기만 / 카메라 하나는 자기만.
- `collectSnapCandidates`: 테두리 4선, 방마다 3 + 3선, 돌려 놓은 방은 1 + 1선(그 선의 `from/to`는 한 점이 아니라 `nodeSnapSpan`의 범위), 카메라 1 + 1선, 제외한 id는 없음, `points`는 사각형·다각형 공간의 꼭짓점만(타원·기호 없음).
- `snapMove` (방 A = 100, 100, 144.65×80 / 끄는 방 B = 300.4, 120.3, 60×40, 허용 6, 닿는 거리 48. 아래 값은 설계 중 임시 스크립트로 계산했다. 손으로 만든 후보 선의 범위는 따로 적지 않으면 그 축의 기본 영역 전체 — 세로 선 `from 0, to 680`, 가로 선 `from 0, to 1000` — 로 준다)
  - **멀리 있는 것은 잡지 않는다**: `delta (−52, 300.4)` — B의 왼쪽 끝이 A의 오른쪽 끝에서 3.75 떨어진 자리지만 세로로 240.7 떨어져 있다 → `position = { x: 248, y: 421 }`, 안내선 없음. 같은 호출에 닿는 거리 1000을 주면 `position.x === 244.65`(이 테스트가 닿는 거리 판정을 지키고 있음을 보인다).
  - **닿는 거리 경계**: 방 C = 300, 300, 60×40. `delta (−52, −72)`(C의 위쪽 끝 228, A의 아래쪽 끝 180 — 틈이 정확히 48) → `position = { x: 244.65, y: 228 }`(`===`), 안내선 x 한 줄. `delta (−52, −71)`(틈 49) → `position = { x: 248, y: 229 }`, 안내선 없음. 닿는 거리 0: `delta (−52, −120)`(맞닿음) → `position.x === 244.65`, `delta (−52, −119)`(틈 1) → `position.x === 248`. 닿는 거리 `NaN`·음수는 0과 같은 결과.
  - **테두리 선도 같은 규칙**(후보는 테두리 4선뿐): 방(3.4, −200, 60×40)을 `delta (0, 0.2)` → `position = { x: 3, y: -200 }`, 안내선 없음(기본 영역 위로 159.8 나가 있어 왼쪽 테두리를 늘인 선에 붙지 않는다). 방(3.4, −80, 60×40)을 `delta (0, 0.2)`(틈 39.8) → `position = { x: 0, y: -80 }`.
  - **같은 값이라도 먼 선은 안내선에 들어가지 않는다**: A와 왼쪽 끝이 같은(x = 100) 방 E(100, 500, 80×60)를 더하고 B를 `delta (−198, 10.4)`(B의 왼쪽 끝 102.4가 x = 100에 붙는다) → 안내선 x의 범위가 A와 B만 덮는다(`from 100`, `to 180` — E의 500~560까지 뻗지 않는다).
  - `delta (−52, 10.4)`: `position = { x: 244.65, y: 131 }`(둘 다 `===`), 안내선 x 한 줄(`at 244.65`, `from 100`, `to 180`).
  - `delta (−158, −1.9)`(가운데끼리): `position ≈ { x: 142.325, y: 120 }`, 안내선 두 줄. 가운데·오른쪽·아래로 붙은 값은 1e-9 안에서 비교한다(왼쪽·위로 붙은 값과 정수로 맞춘 값만 `===`).
  - `delta (200.3, 300.3)`(붙을 것 없음): `position = { x: 501, y: 421 }`, 안내선 없음.
  - `delta (637, −117)`(테두리): `position ≈ { x: 940, y: 0 }`(오른쪽 끝이 1000에, 위쪽 끝이 0에 붙는다. y는 `=== 0`).
  - 허용 0: `position = { x: 248, y: 131 }`, 안내선 없음.
  - 회전 30의 방(500, 300, 80×40)을 `(−366, −182)`: 가운데로 붙어 `position ≈ { x: 132.325, y: 120 }`.
  - **돌려 놓은 도형의 '가까이'는 윤곽으로 잰다**: 회전 30의 방 G(280, 200, 200×100 — 가운데 (380, 250), 윤곽 상자의 왼쪽 끝 약 268.397)를 `delta (−3.75, −108.4)` — 가운데는 A의 오른쪽 끝에서 131.6 떨어져 있지만 윤곽은 약 20 떨어져 있다 → 가운데가 A의 가운데 줄(y = 140)에 붙어 `position ≈ { x: 276, y: 90 }`, 안내선 y 한 줄. `delta (50, −108.4)`(윤곽의 틈 약 73.75) → `position = { x: 330, y: 92 }`, 안내선 없음. 상대가 돌려 놓은 도형일 때: 후보가 G 하나(와 테두리)인 도면에서 방 H(600, 300, 60×40)를 `delta (−80.4, −68.6)` — H의 왼쪽 끝 519.6이 G의 윤곽 오른쪽 끝(약 491.603)에서 28 떨어져 있다 → H의 가운데가 G의 가운데 줄(y = 250)에 붙어 `position ≈ { x: 520, y: 230 }`.
  - 허용 거리 경계(정확히 6은 붙고 6.01은 안 붙음), 더 가까운 후보가 이김, 같은 값의 후보 둘이 모두 닿는 거리 안이면 안내선 범위가 둘을 모두 덮음.
  - **같은 거리일 때의 순서**(6.2의 3): 끄는 방(300, 500, 20×20)을 `delta (−205, 0)`로, 후보는 손으로 만든 `{ x: [x = 100, x = 110], y: [], points: [] }`. 왼쪽(95)·가운데(105)·오른쪽(115)이 각각 100, 100·110, 110과 5씩 떨어져 넷이 비긴다 → 먼저 찾은 (왼쪽, 100)이 이겨 `position.x === 100`.
  - id 둘을 넘기면 합친 상자의 가장자리로 붙고 `delta`가 두 노드에 공통.
  - 없는 `anchorId`·`movingIds`에 없는 기준·`NaN` 입력은 `null`. 입력 도면을 바꾸지 않음(전후 `JSON.stringify` 동일).
- `snapPoint`: 점 후보가 선보다 우선, 선에 붙는 축과 정수로 맞는 축이 섞인 경우, 허용 0이면 정수 맞춤만, `withVertexNeighbours`로 더한 옆 점의 x·y에 붙음. **닿는 거리가 없다**: 옆 점이 다른 축으로 500 떨어져 있어도 그 점의 x(또는 y)에 붙는다(`withVertexNeighbours({ x: [], y: [], points: [] }, [(100, 100)])`에 점 (102.4, 600.3), 허용 6 → `{ x: 100, y: 600 }`).
- `snapResize`(허용 6, 닿는 거리 48): 회전 0에서 오른쪽 끝이 이웃의 왼쪽 끝에 붙고(`x + width`가 대상과 1e-9 안) 세로는 정수 / 회전 90에서 화면 y가 가로 길이를 정함 / 회전 30은 붙지 않고 두 길이 모두 정수 / 붙은 값이 10 미만이면 무시 / 100000 상한 / 기호도 같은 규칙.
  - **멀리 있는 이웃에는 붙지 않는다**: 방(100, 100, 60×40)의 모서리를 `corner (198.4, 140.3)`로, 후보는 손으로 만든 세로 선 `x = 200` 하나. 선의 범위가 `from 100, to 180`(겹친다)이면 `width === 100`. `from 400, to 480`(끄는 상자의 아래쪽 끝 140.3에서 259.7 떨어짐)이면 붙지 않고 `width === 98`. 두 경우 모두 `height === 40`.
  - **축 바꿈의 부호(k2·k3)**: 방(100, 100, 60×40), 후보는 손으로 만든 선 하나(범위는 그 축의 기본 영역 전체 — 닿는 거리 안), 허용 6. 회전 180(고정점 (160, 140), 끄는 모서리는 화면 왼쪽 위 (100, 100)): `corner (80.3, 90.4)`, 후보 `x = 75` → `width === 85`, `height === 50`, 결과의 `x ≈ 75`, `y ≈ 90`. 회전 270(고정점 (110, 150), 끄는 모서리 (150, 90)): `corner (170.2, 69.6)`, 후보 `y = 65` → `width === 85`(화면 y가 가로 길이를 정한다), `height === 60`. 부호나 축이 뒤바뀌면 길이가 음수가 되어 10으로 잘리므로 이 값이 나오지 않는다.
  - 회전 0에서 `x`·`y`가 받은 값 그대로(`===`): 소수 좌표의 방(244.65, 120.3, …)을 어떤 크기로 바꿔도.
- `snapRotation`: 6.2의 예와 360 → 0, 45.5 → 45.5, `NaN` → `NaN`.
- `sameSnapGuides`: 같은 값의 다른 배열 → 참, 한 필드라도 다르면 거짓.

### 12.4 `tests/backgroundMapPlanGesture.test.ts` (새)

- 스냅 없음(`null`)일 때의 결과(3.3 표의 왼쪽 칸):
  - move = `moveMapNode(initial, id, delta)`.
  - 공간 resize = `transformMapSpace(initial, resizeSpace(node, nodeResizeCorner(node) + delta))`, **기호 resize** = `replaceMapNode(initial, resizeSpace(node, nodeResizeCorner(node) + delta))`, 카메라 resize = `initial`.
  - 카메라 rotate = 포인터 방향, 공간 rotate가 소속 카메라의 각도도 돌림, **기호 rotate** = 그 기호의 `rotation`만 바뀌고 다른 노드는 `===`.
  - draw = 최소 10인 상자가 끝에 붙음.
  - 누른 자리는 결과에 들어가지 않는다: `start`와 `point`를 같은 만큼 옮기면(같은 `delta`) resize·vertex의 결과가 같다. `start`가 모서리에서 (14, 14) 떨어져 있어도 `delta`가 (0, 0)이면 가로·세로가 처음 값과 1e-9 안에서 같다(모서리가 포인터 자리로 튀지 않는다).
- 스냅 있음(허용 6, 닿는 거리 48): move가 붙은 뒤 소속 카메라가 같은 만큼 따라감 / 공간이 자기 소속 의자에는 붙지 않음 / 잠긴 의자에는 붙음 / rotate 91.5° → 정확히 90, 소속 항목도 그 각도로.
  - **가까이 있는 것에만 붙는다**(후보는 `planGestureCandidates`로 모은다): 방(100, 100, 300×200)과 소속이 없는 의자(700, 451.5, 60×60)가 있는 도면에서 방을 `delta (0.3, 350.2)` — 방의 위쪽 끝 450.2가 의자의 위쪽 끝 451.5와 1.3 차이지만 가로로 299.7 떨어져 있다 → 방의 저장 위치 `(100, 450)`, 안내선 없음. 의자가 (430, 151.5)에 있는 도면에서 방을 `delta (0.3, 50.2)`(가로 틈 29.7) → 저장 y `=== 151.5`, 안내선 y 한 줄.
- draw는 스냅을 줘도 `null`일 때와 같은 도면이고 안내선이 없다(이웃의 모서리 바로 옆에서 시작하고 끝내도 붙지 않고 소수 좌표 그대로).
- vertex: 한 점만 움직이고 다른 점의 절대 좌표가 1e-9 안에서 같음(회전 0과 37 둘 다) / 소속 카메라·기호 객체가 `===`로 그대로 / 끼워 넣기는 점이 하나 늘고 `index + 1` 자리에 생기며, 마지막 변(`index = n − 1`, 다음 점이 0번)에서도 된다 / 옆 점의 x·y에 붙음 / 다른 공간의 모서리에 붙음 / **승인 문구 밖의 것에는 붙지 않는다**: 다른 방의 변 중간(그 변의 선에서 2 떨어진 자리, 모서리에서는 허용 거리 밖), 다른 방의 가운데 선, 그 다각형 안에 있는 의자의 가장자리·가운데 선, 카메라의 점, 도면 테두리(x = 2.4) 가까이로 끈 점은 붙지 않고 좌표가 정수이며 안내선이 없다 / 상자가 10보다 좁아지는 점은 `null` / 옆 점과 같은 자리가 되는 점은 `null`(옆 점의 x·y 선에 함께 붙는 위치).
  - 누른 자리의 어긋남: 점의 절대 좌표가 (200, 100)일 때 `start (206, 103)`, `point (216, 103)`, 스냅 `null` → 그 점이 (210, 100)(누른 자리만큼 밀리지 않는다).
- 순수성: 같은 인자면 같은 결과이고, 다른 점을 먼저 미리 본 뒤에도 같다(경로와 무관). `initial`을 바꾸지 않는다. 없는 노드는 `null`. 잠긴 노드의 move는 `initial`과 같은 값.
- `planGestureCandidates`: move·resize는 실려 가는 것을 뺀 전부(테두리 4선 포함) / **vertex는 승인된 둘뿐** — 다른 방 둘, 타원 방 하나, 그 다각형 안의 의자와 카메라가 있는 도면에서 `x`와 `y`의 길이가 각각 2(옆 점 둘의 선뿐: 테두리 선도, 다른 노드의 선도 없다), `points`는 다른 **사각형·다각형** 공간의 꼭짓점만(자기 다각형·타원·의자·카메라의 점 없음). 끼워 넣기(`insert`)의 옆 점은 그 변의 두 끝 / draw와 rotate는 빈 후보(`x`·`y`·`points` 모두 길이 0).

### 12.5 `tests/backgroundMapGeometry.test.ts`에 더하는 것

- `resizeSpaceTo` / `nodeLocalPoint`: `resizeSpace(node, p)`와 `resizeSpaceTo(node, …nodeLocalPoint(node, p))`가 같은 값(회전 0, 90, 37). 회전 0에서는 결과의 `x`·`y`가 받은 값과 `===`(소수 좌표 244.65, 120.3으로).
- `nodeResizeCorner`: 회전 0 → `(x + width, y + height)`(`===`). 방(100, 100, 60×40)의 회전 90 → (110, 150), 180 → (100, 100), 270 → (150, 90)(1e-9). `resizeSpace(node, nodeResizeCorner(node))`의 가로·세로가 처음 값과 1e-9 안(회전 0, 90, 37).
- `placeMapNode`: 저장 x·y가 정확히 그 값, 공간이면 소속 항목이 `moveMapNode`와 같은 만큼, 잠긴·없는 노드는 `map` 그대로.
- `replaceMapNode`: 공간을 바꿔 넣어도 소속 항목이 `===`로 그대로(같은 변화를 `transformMapSpace`에 주면 움직이는 것과 대비).
- `renameMapNode`: 공백을 뗀 이름, 빈 이름·같은 이름·잠긴 노드·없는 노드는 `map` 그대로(`===`).
- `nodeNameAnchor`: 공간·기호는 상자 가운데(회전과 무관), 카메라는 그 점.
- `polygonFromWorldPoints` 계열
  - 회전 0의 삼각형(20, 30, 100×50, 점 (0,0)(1,0)(0.5,1))의 셋째 점을 (70, 130)으로 → `{ x: 20, y: 30, width: 100, height: 100, points: [(0,0), (1,0), (0.5,1)] }`.
  - 회전 37의 네 점 다각형에서 한 점을 옮김 → 회전 37 그대로, 나머지 점의 절대 좌표 오차 1e-9 미만, 모든 `points`가 0~1.
  - 끼워 넣기(변 가운데점이면 상자·넓이 불변, 점 수 +1; `index = n − 1`이면 새 점이 목록 끝에 붙어 마지막 점과 0번 점 사이에 놓인다) / 지우기(4 → 3, 3개에서는 `null`) / 200개에서 끼워 넣기는 `null`.
  - 지우면 상자가 너무 좁아지는 경우(둘째 안내 문구가 기대는 `null`): 방(0, 0, 100×100)의 점 (0,0)(0.05,0)(1,0.5)(0.05,1)에서 2번 점을 지우면 가로가 5가 된다 → `null`(점은 넷이라 '3개 이하'가 아니다).
  - 옆 점과 같은 자리: 점을 `(index − 1)`번 점의 절대 좌표로 옮기면 `null`, `(index + 1)`번도 같다. 끼워 넣을 점이 그 변의 한쪽 끝과 같으면 `null`.
  - `null`: 상자 한 변 10 미만, 넓이 1 미만(세 점이 한 줄), 유한하지 않은 점, 잠긴 공간, 다각형이 아님, 범위 밖 `index`.
  - 결과가 `validateBackgroundEntity('map', …)`를 통과한다(점 0~1, 3~200개).
- `rectToPolygon`: `nodePlanOutline`이 전후 같음(회전 0과 37), 타원·다각형·잠긴 사각형은 `null`, 다른 필드(이름·연결·높이)는 그대로.

### 12.6 `tests/backgroundMapPlanEdit.test.ts` (새)

- `planNodeHandles`: 배율 1에서 지금 값(회전 원 r 7·위로 28/25, 네모 (w − 6, h − 6, 12), 카메라 80, 수평 카메라는 점선 없음, pitch 60° 카메라는 점선 40…73) / 배율 0.25와 4에서 화면 크기 불변(값 ÷ 배율이 같음) / 카메라 거리: 배율 1 → 80, 2 → 80, 5 → 200 / 긴 변이 화면 12px 미만이면 `resize: null`(10×10 기호는 배율 1에서 없고 0.5에서 있다, 400×12 벽은 배율 1에서 있다).
  - 비켜 서기(배율 1, 방 200×100): 사각형에서 바꾼 다각형(점 (1, 1)이 있음) + `vertexHandles` 참 → `resize`가 `{ x: 208, y: 108, size: 12, shifted: true }`(**`null`이 아니다**). 같은 다각형에 `vertexHandles` 거짓 → `{ x: 194, y: 94, size: 12, shifted: false }`. 모서리 점을 (0.9, 1)로 옮긴 다각형(모서리에서 가로 20px) + 참 → `shifted: false`. 점이 (0.93, 0.9)(가로 14px·세로 10px)이면 `shifted: true`. 배율 2에서는 같은 다각형의 값이 두 배(`x: 216, y: 116, size: 24`). 사각형·타원·기호는 `vertexHandles`와 무관하게 `shifted: false`.
- `planVertexHandles`: 사각형·타원·잠긴 다각형·긴 변이 화면 32px 미만 → `null` / 꼭짓점이 `nodePlanOutline`과 같음(회전 포함) / 화면 28px 미만인 변에는 '+' 없음 / 점 200개면 `edges`가 빔.
- `doubleClickNodeId`: 첫 누름이 묶음 안이면(또는 눌린 노드 자신이면) 첫 누름, 묶음 밖이거나 `null`이면 눌린 노드.
- `readSnapPreference` / `storeSnapPreference`: 저장소가 없으면 `true`이고 쓰기가 던지지 않음 / 가짜 `globalThis.localStorage`로 `'off'` → `false`, 그 밖 → `true`, 쓰기 값 `'on'`·`'off'`.

### 12.7 `tests/backgroundMapEditorWiring.test.ts` (새, 소스 앵커)

배경 기능은 이미 배선을 소스 앵커로 고정한다(`tests/backgroundAccess.test.ts:39-45`). 순수 테스트로 잡을 수 없는 것만 넣는다.

1. 편집기에 `addEventListener('wheel', …, { passive: false })`가 있고 그 효과의 의존값에 `current?.id, mode`가 있다. React `onWheel=` prop은 없다.
2. '맞춤'이 `fitMapViewport(`를 부르고, `updateView({ x: 0, y: 0, zoom: 1 })`은 남아 있지 않다.
3. `pointerMove`가 `previewPlanGesture(`를 부르고 그 뒤에 `doc.previewGesture(`가 온다. 편집기에 `resizeSpace(`·`moveMapNode(next`가 남아 있지 않다(제스처 계산이 한 곳에만 있다).
4. 이름 확정이 `{ history: false }`와 `=== edit.created` 판정을 함께 가진다.
5. 넘기기가 SVG의 `onClick`에 있고 `event.detail >= 2`를 본다. `pointerUp`은 `pendingCycle.current =`만 한다.
6. **더블클릭은 SVG 한 곳**: 편집기 소스에 `onDoubleClick=`이 정확히 한 번 나오고 그 값이 `canvasDoubleClick`이다(노드 `<g>`에 다시 달면 실패한다). `canvasDoubleClick`이 `pressLog.current`를 읽고, `pointerDown`이 `pressLog.current =`로 적는다.
7. 이름 칸: Escape에서 `stopPropagation`, `isComposing` 가드가 있다. `onHistory(`를 부르는 분기가 `text === opened.current` 조건을 가진다. `onBlur`가 `leaving.current`를 본다. 편집기는 `onHistory={passNameHistory}`를 넘기고 `passNameHistory`가 `cancelName()`과 `undo(`를 부른다.
8. 배경 기능의 `.tsx` 소스 어디에도 `<foreignObject` 마크업이 없다(정규식 `/<foreignObject/` — 설명 주석의 낱말에는 걸리지 않게 여는 꺾쇠까지 본다).
9. `mapSnap.ts`·`mapPlanGesture.ts`가 three.js를 import하지 않고 DOM을 만지지 않는다: `/from\s+['"]three/`와 `/\b(?:document|window)\.\w/`가 걸리지 않는다. 낱말만 찾지 않는 이유: 이 기능의 모듈 머리 주석은 "three is never imported here"처럼 그 낱말을 쓴다(mapSpatial.ts:8).
10. `BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`가 `mapSnap`·`mapPlanGesture`·`mapPlanEdit`을 import하지 않는다.
11. 편집기와 조각 파일에 `<pattern`이 없다(늘 깔린 눈금 없음).
12. Delete의 점 지우기 분기가 `activeIndex !== null`을 조건으로 하고, `activeIndex`를 구하는 식이 `vertexHandles &&`로 시작한다(보이지 않는 점은 지워지지 않는다). 분기 안에서 `activeVertex.index`를 직접 읽지 않는다.
13. 평면 단축키 묶음(`'F2'`와 `fitView()`·`zoomBy(1.25)`가 있는 곳)이 `target.closest(interactive)` 가드보다 **앞**에 있다(소스 위치 비교).
14. 다각형 도구의 같은 점 판정이 `MAP_EDIT_MARK.polygonDot * screenScale`을 쓴다(`< 1)`이 남아 있지 않다).
15. `pointerUp`의 끼워 넣기 분기가 점 수 비교(`=== points(session.initial) + 1`)를 거쳐 `setActiveVertex`를 부른다(받아들여진 위치가 없는 '+' 끌기는 손으로 재현하기 어려워 앵커로 지킨다).
16. **캔버스 밖 누름이 누름 기록을 비운다**: 편집기에 window의 `pointerdown` **캡처** 리스너(`addEventListener('pointerdown', …, true)`)가 있고, 그 처리기가 `svgRef.current?.contains(`를 본 뒤 `pressLog.current = NO_PRESSES`를 한다. `pointerDown`의 가드 쪽에도 `pressLog.current = NO_PRESSES`가 있다(SVG 안의 받지 않은 누름).
17. **Alt는 포인터 상태에 묶여 있지 않다**: 편집기에 window의 `keydown`·`keyup` 캡처 리스너와 `blur` 리스너가 있고, 키 처리기가 `altDrag.current`를 보고 `preventDefault`를 하며 `keyup`에서만 `altDrag.current = false`를 한다. `pointerDown`과 `pointerMove`에 `event.altKey`로 `altDrag.current = true`를 하는 줄이 있다. `pointerUp`과 `abortGesture`에는 `altDrag.current =`가 **없다**(마우스를 뗐다고 끄면 그 뒤의 Alt 뗌이 빠져나간다). 편집기 소스에 `event.key === 'Alt' && pointerRef.current` 꼴의 조건(누르고 있을 때만 막던 조건)이 없다.
18. 스냅 입력이 닿는 거리를 싣는다: `pointerMove`가 `reach: MAP_SNAP.reachPx * session.scale`을 넘긴다(상수 대신 `Infinity`나 고정 숫자를 넣으면 실패한다).

앵커는 **뮤테이션으로 확인**한다: 임시 복사본에서 앵커가 지키는 줄을 하나씩 깨뜨려 그 테스트가 실제로 실패하는지 본다(살아남는 앵커는 고친다).

### 12.8 통과 기준

`npm run typecheck`, `npm run test:background`, `npm run build:vite`. DB 실행 검사 3개는 지금처럼 PGlite 미지정 시 생략으로 보고한다(이번 변경과 무관).

---

## 13. 수동 검증 (앱 엔진: Electron 33)

방법: `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130), 미리보기 시험 계정(한솔)으로 로그인 → 배경 → 도면. **실제 입력**(마우스·휠·키보드)으로 누르고 화면을 본다. 자동으로 넣을 때는 `BFLOW_PREVIEW_DEBUG_PORT`를 열고 입력 이벤트(휠은 `mouseWheel`, 벌리기는 control 수식 키가 붙은 휠)를 보낸다. 창이 가려져 있으면 그리기가 멈추므로 보이는 창이나 offscreen 창에서 한다(인수인계 §13.7).

창 크기 **1440×900**과 **740×900** 둘 다, 어두운·밝은 화면 둘 다에서 본다. 모든 항목을 1440×900 어두운 화면에서 보고, 나머지 세 조합(1440×900 밝은 화면, 740×900 어두운·밝은 화면)에서는 ★ 항목을 다시 본다. '(740)'이 붙은 항목은 740×900에서 본다.

**가장 먼저 (엔진 동작 확인, 3.4·5.6·5.5·6.5가 기대는 것)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 | 카메라 세 대를 추가(같은 자리)하고 편집 중에 한 번씩 **천천히**(1초 간격) 클릭 | 클릭마다 다음 카메라로 넘어간다(넘기기가 `click`에서 돈다). 콘솔에 `click`의 `detail`과 `target`을 찍어 더블클릭 때 `detail` 2가 SVG에 오는지 확인 |
| E2 | 이름 칸에 한글 '과학실'을 치고 Enter | 이름이 정확히 '과학실'(마지막 글자 빠짐·겹침 없음). Enter를 한 번 눌렀는지 두 번 눌렀는지 기록 |
| E3 | 창 위쪽에 메뉴 줄(File·Edit…)이 보이는 창에서(미리보기 창도 앱과 같은 기본 메뉴다). 스냅은 켠 채로. ① **Alt를 먼저 누르고** 방을 눌러 끌어 놓는다 — **마우스를 먼저 떼고**, 1초 뒤 Alt를 뗀 다음 Delete ② ①과 같되 마우스를 뗀 뒤에도 Alt를 2초 넘게 더 누르고 있다가(그동안 자동 반복 누름이 온다) 뗀 다음 F2 ③ 방을 끄는 **중에** Alt를 눌렀다 떼고(마우스는 누른 채) 마우스를 뗀 다음 Ctrl+Z ④ 끄는 중에 Alt를 누르고 마우스를 먼저 뗀 뒤 Alt를 떼고 `0` ⑤ 끌지 않고 Alt만 눌렀다 뗀다 | ① 삭제 확인 창 ② 이름 칸 ③ 방금 끌기가 되돌려진다 ④ 맞춤 — 넷 모두 메뉴 줄에 강조·밑줄이 생기지 않고 키가 한 번에 듣는다(창 메뉴로 새지 않았다) ⑤ v1.130.0과 같은지 기록한다(끌기에 쓰지 않은 Alt는 바꾸지 않았다 — 기본 메뉴라면 메뉴 줄이 포커스를 받는다). ①~④ 가운데 하나라도 키가 먹히면 16절의 E3 줄대로 한다 |
| E4 | 이름 칸이 열린 채 다른 도면으로 이동(트리 클릭) | 이름이 확정된 뒤 이동한다. 돌아와서 이름이 맞다 |
| E5 | **편집 중**, 선택 도구로 ① 상세 도면이 없는 방의 몸통을 더블클릭 ② 상세 도면이 연결된 방의 몸통을 더블클릭 | ① 이름 칸이 열리고 포커스가 그 칸에 남는다 ② 그 도면으로 들어간다. 콘솔에 `dblclick`의 `target`을 찍어 SVG인지 기록한다(포인터 캡처 때문에 노드 `<g>`가 아니다 — 더블클릭을 SVG에서 받는 이유) |

| E6 | 상세 도면이 없는 방 S 안에 다각형 도구로 점 셋을 찍고 **'다각형 완성' 버튼을 더블클릭**한다(둘째 클릭이 S 위에 떨어지게 S를 버튼 아래까지 크게 둔다). 콘솔에 SVG의 `dblclick`과 `pressLog`를 찍는다 | `dblclick`이 SVG에 오는지 **기록한다**(첫 클릭은 사라진 버튼 위였다). 오든 오지 않든: S의 이름 칸이 열리지 않는다. 새 다각형이 생겨 있고, 둘째 클릭이 떨어진 것(S)이 선택돼 있으며, 방금 열렸던 이름 칸은 닫혀 있다(새 공간의 이름은 '새 공간'). `dblclick` 시점의 `pressLog` 첫 칸이 `null`이다 |

E1·E5가 실패하면 16절의 대체안으로 바꾼다. E3·E6은 16절의 해당 줄을 따른다.

**확대·축소**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| Z1 ★ | 방 모서리에 포인터를 두고 휠 위로 3칸, 아래로 3칸 | 모서리가 포인터 아래에 남는다(±1px). 표시가 100 → 122 → 149 → 182% → 다시 100% |
| Z2 | 계속 축소 / 계속 확대 | 10%와 400%에서 멈춘다. 10%에서 방 이름 글자가 v1.130.0을 25%로 줄였을 때보다 작지 않다(같은 창 크기에서 비교) |
| Z3 | Ctrl을 누른 채 휠(또는 터치패드 벌리기) | 부드럽게 확대·축소된다. 앱 전체 배율(다른 화면의 글자 크기)은 변하지 않는다 |
| Z4 ★ | 기본 영역 왼쪽 밖으로 방을 그리고 '맞춤' / 빈 도면에서 '맞춤' | 전체가 보이고 왼쪽에 여백이 있다 / 100%, 처음 화면 |
| Z5 ★ | 방을 고르고 25%, 100%, 400%에서 손잡이를 잰다 | 크기 네모 12px, 회전 원 지름 14px·위로 28px(기호는 25px). 카메라 방향 원(지름 14px): 400%에서 부채꼴 끝, 25%에서 카메라에서 40px 떨어진 곳 + 점선. 100%에서는 부채꼴 반지름이 화면 40px보다 길면 부채꼴 끝, 짧으면 40px |
| Z6 | 10%에서 의자를 고르고 끈다 | 크기 네모가 없고 의자가 옮겨진다(크기가 바뀌지 않는다) |
| Z7 | 캔버스를 한 번 누른 뒤 `+`, `=`, `-`, `0` / **아래 줄의 ＋ 버튼을 누른 직후**(포커스가 버튼에 있다) `+`, `-`, `0` / 오브젝트 목록의 줄을 누른 직후 `0` / 숫자 칸에서 `0` / Ctrl + `+` | 확대·확대·축소·맞춤 / 캔버스를 다시 누르지 않아도 확대·축소·맞춤 / 맞춤 / 숫자 칸에 0이 입력될 뿐 / 평면 확대(아래 줄의 %)가 바뀌지 않는다. **Ctrl + `+`는 Electron 기본 메뉴의 앱 전체 확대다(앱이 메뉴를 바꾸지 않는다). 화면 전체가 커졌으면 그 배율이 기억되므로, 확인 뒤 Ctrl + `0`으로 되돌린다** |
| Z8 | 방을 끄는 중에 휠 | 확대되지 않고 끌기가 이어진다 |
| Z9 ★ (740) | 도면 위에서 휠 / 속성 칸·이미지 그리드 위에서 휠 | 확대·축소되고 페이지 스크롤 위치가 그대로 / 지금처럼 스크롤 |
| Z10 | 평면 → 3D → 평면 / 트리에서 다른 도면으로 이동 / '새 도면'으로 첫 도면을 만든 직후 | 확대·위치가 그대로이고 휠이 다시 듣는다. 3D의 휠·버튼은 v1.130.0과 같다 / 옮겨 간 도면에서 휠이 듣는다 / 새 도면에서 휠이 듣는다(SVG가 새로 올라오는 세 경우) |
| Z11 | 기호 팔레트를 열고 그 위에서 휠 | 도면이 확대되지 않는다 |
| Z12 | '공간 편집'을 누르기 전(보기 모드)에 휠, `+` `-` `0`, 맞춤 | 모두 된다. 손잡이와 '스냅' 버튼은 없다 |
| Z13 | '도면 저장'을 누르고 저장이 도는 동안 도면 위에서 휠 | 확대·축소된다(보기만 바뀐다). 저장 결과는 정상 |

**이름**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| N1 ★ | 사각형을 그린다 → '교실' Enter → Ctrl+Z → Ctrl+Shift+Z | 가운데에 이름 칸('새 공간' 전체 선택) → 이름 '교실' → 방이 통째로 사라짐 → '교실'로 돌아옴 |
| N1b ★ | 사각형을 그린 **직후 아무것도 치지 않고** Ctrl+Z / 다시 그린 뒤 글자를 몇 자 치고 Ctrl+Z / 그린 직후 Delete | 이름 칸이 닫히고 방이 통째로 사라진다(v1.130.0의 '그리고 바로 Ctrl+Z') / 친 글자만 되돌아가고 방과 이름 칸은 그대로 / '새 공간' 글자만 지워지고 삭제 확인 창은 뜨지 않는다 |
| N2 | 타원을 그리고 Esc | '새 공간'으로 남고 도구는 선택 그대로. 되돌리기 한 번에 사라진다 |
| N3 | 그린 뒤 글자를 치고 빈 곳 클릭 / 다른 방을 눌러 바로 끌기 | 확정되고 선택이 풀린다 / 확정되고 그 방이 같은 누름에서 끌린다 |
| N4 | 다각형을 '다각형 완성' 버튼으로 / 더블클릭으로 완성 | 둘 다 이름 칸이 열린다. **더블클릭으로 끝낸 다각형의 점 수가 찍은 수와 같다**(다섯 곳을 누르고 마지막 자리에서 더블클릭 → 오브젝트를 고르면 점 동그라미 다섯 개, 겹친 동그라미 없음). 10%로 축소해서도 한 번 |
| N5 | 빈 글자로 Enter / 같은 이름으로 Enter | 이름 그대로, 되돌리기 버튼 상태가 변하지 않는다 |
| N6 ★ | 편집 중에 상세 도면 없는 방·기호·카메라의 몸통을 더블클릭 / 잠긴 것 / 편집 전 | 이름 칸(카메라는 아래쪽) / 무동작 / 무동작 |
| N7 ★ | 상세 도면이 연결된 방을 더블클릭: 보기 모드 / 편집 중 / 이동 도구 / 잠근 뒤. 고르고 F2 | 넷 다 그 도면으로 들어간다(v1.130.0은 보기 모드와 잠긴 방에서만 열렸다) / 이름 칸 |
| N8 | 겹친 카메라 셋 중 가운데 것을 목록에서 고르고 더블클릭 | 가운데 카메라의 이름 칸이 열린다(선택이 한 번 깜빡일 수 있다). 보기 모드에서 빠르게 두 번 누르면 v1.130.0처럼 두 번 넘어간다 |
| N9 | 화면 밖 노드를 목록에서 고르고 F2 / 방을 끄는 중에 F2 | 보기가 옮겨지고 이름 칸이 열린다 / 아무 일도 없고 끌기가 어긋나지 않는다 |
| N10 | 이름 칸이 열린 채 휠·창 크기 변경 / 3D 버튼 / '도면 저장' | 칸이 따라간다 / 확정되고 3D에 새 이름 / 저장된 이름이 새 이름 |
| N11 (740) | 캔버스 가장자리의 노드에서 이름 칸 | 칸이 캔버스 안에 있다 |
| N12 | 이름 칸에서 Esc, 그 뒤 한 번 더 Esc | 칸만 닫힌다 / 지금처럼 도구 초기화 |
| N13 ★ | 편집 중, 같은 자리의 카메라 셋을 **0.3초 간격**으로 연달아 클릭 / 1초 간격으로 클릭 | 첫 클릭에 선택, 둘째 클릭에 그 카메라의 이름 칸(넘어가지 않는다) / 클릭마다 다음 카메라로. 관찰한 그대로 완료 보고에 적는다(v1.130.0과 달라진 점) |
| N14 | 이름 칸에 한글을 치다가 **조합이 끝나기 전에**(마지막 글자에 밑줄이 있는 채) 빈 곳을 클릭 | 마지막 글자까지 들어간 이름으로 확정된다. 빠지면 16절의 E2 대체안 |
| N15 | 이름을 치고 Enter / Esc / 빈 곳 클릭으로 닫은 뒤 도면 둘레 | 포커스 테두리가 보이는지 기록한다. v1.130.0에서 속성 칸의 이름을 치고 도면을 눌렀을 때와 같은 테두리여야 한다(새 표시가 생기지 않았다) |
| N16 | 편집 중, 상세 도면이 연결된 **다각형** 방: 몸통을 더블클릭 / 꼭짓점 동그라미 위에서 더블클릭 / 크기 네모 위에서 더블클릭 | 들어간다 / 들어가지 않고 그 점이 골라진다 / 아무 일도 없다 |
| N17 | 기호 도구로 빈 곳을 더블클릭 | 기호가 놓일 뿐 이름 칸은 열리지 않는다 |
| N18 ★ | 큰 방 S 안에 다각형을 그리고(점을 S 위에 찍는다) **'다각형 완성'을 더블클릭**: S가 ① 상세 도면 없음 ② 상세 도면 연결됨 / 같은 상태에서 점을 찍다가 **'취소'를 더블클릭**(①·② 둘 다) / S를 한 번 눌러 고른 뒤 기호 팔레트를 열어 S 위에 겹친 **항목을 더블클릭** | ① S의 이름 칸이 열리지 않는다 ② S의 상세 도면으로 들어가지 않는다 — 둘 다 새 다각형이 생기고 둘째 클릭이 떨어진 것이 선택된다(새 공간의 이름 칸은 닫히고 '새 공간'으로 남는다. 그 뒤 새 공간을 더블클릭하면 이름 칸이 열린다) / 다각형 도구만 끝난다. S의 이름 칸도, 상세 도면 이동도 없다 / 기호가 하나 놓일 뿐 S의 이름 칸이 열리지 않는다 |

**스냅**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| S1 ★ | 방 B를 방 A의 오른쪽 끝 가까이로 끈다 | 착 붙고 분홍 안내선이 붙은 동안만 보인다. 놓은 뒤 B의 '가로 위치'가 A의 오른쪽 끝 값과 같다(A가 244.65면 244.65). 세로 위치는 정수 |
| S2 | 가운데끼리 / 도면 테두리(0, 1000, 680) | 붙는다 |
| S3 | Alt를 누른 채 끈다 → 끌던 중 Alt를 뗀다 | 붙지 않고 소수 값 → 다시 붙는다 |
| S4 | '스냅'을 끄고 끈다 → 새로 고침 | v1.130.0처럼 소수 값 → 꺼진 상태가 남아 있다. 새 프로필에서는 켜져 있다 |
| S5 | 크기 네모로 줄인다: 회전 0 / 90 / 180 / 270 / 30 | 이웃의 가장자리에 붙고 나머지는 정수(네 방향 모두 — 180·270에서 끄는 모서리가 화면의 왼쪽 위·오른쪽 위에 있어도 끄는 쪽으로 늘고 준다) / 30은 붙지 않고 가로·세로 길이가 정수 |
| S5b | 소수 좌표의 방(가로 위치 244.65)의 크기 네모를 끌었다 놓는다(회전 0) | '가로 위치'·'세로 위치'가 그대로다(244.65). 크기 네모의 가장자리를 눌러 끌어도 첫 움직임에 모서리가 튀지 않는다 |
| S6 | 스냅을 켠 채 이웃 모서리 근처에서 사각형·타원을 그린다 / 그린 것을 한 번 옮긴다 | 그릴 때는 붙지 않고 안내선도 없다(v1.130.0과 같다, 위치·크기에 소수가 남을 수 있다) / 옮기면 붙고 정리된다 |
| S6b | 30° 돌려 놓은 방을 다른 방 가까이로 옮긴다 | 가운데끼리만 붙는다(가장자리에는 붙지 않는다). 붙지 않은 축의 저장 위치는 정수 |
| S7 | 회전 원으로 돌린다 / 카메라 방향 원 | 0·90·180·270 근처(3°)에서 정확히 그 값, 그 밖은 자유 |
| S8 | 의자·카메라가 든 방을 옮긴다 / 의자를 잠그고 다시 | 함께 가고 방이 자기 의자에 붙지 않는다 / 의자는 남고 방이 의자에 붙는다 |
| S9 | 위 동작마다 Ctrl+Z 한 번 / 끄는 중 Esc | 한 번에 원래대로 / 원위치, 안내선 사라짐 |
| S10 | 25%와 400%에서 붙는 거리 / 닿는 거리 | 화면에서 비슷하다(붙는 거리 약 6px, 줄을 맞춰 주는 상대와의 거리 약 48px) |
| S11 | 3D에서 기즈모로 옮긴다 | 붙지 않는다(변화 없음). 안내선·눈금이 어디에도 남지 않는다 |
| S12 ★ | **실제 같은 도면**(방 8개 이상, 가구·문 20개 이상, 카메라 몇 대 — 일부는 소수 좌표)에서 100%와 50% 각각: ① 방 하나를 다른 것에서 화면 48px 넘게 떨어진 빈 자리로 끌어 놓는다(다섯 번, 자리를 바꿔 가며) ② 방을 멀리 있는 방·의자와 가로 또는 세로 줄이 맞는 자리로 천천히 지나가게 끈다 ③ 방을 옆방 가까이(48px 안)로 끈다 ④ 가구가 많은 방 안에서 의자를 이리저리 끈다 | ① 안내선이 뜨지 않고(테두리와 줄이 맞을 때만 테두리 안내선) 놓은 '가로 위치'·'세로 위치'가 다섯 번 모두 정수다 ② 줄이 맞는 순간에도 안내선이 뜨지 않고 걸리지 않는다 ③ 옆방의 가장자리·가운데에 붙고 안내선이 그 방까지만 그어진다 ④ 그 방의 벽·가운데와 바로 옆 가구에만 붙는다. 방 건너편 가구로 선이 뻗지 않는다. **끄는 동안 안내선이 내내 켜져 있지 않다** — ①~④를 하면서 안내선이 보이는 때와 안 보이는 때의 느낌(특히 50%에서, 작은 의자에서)을 그대로 적어 완료 보고에 옮긴다(16절). 너무 자주 붙거나 너무 안 붙으면 `MAP_SNAP.reachPx`만 고친다 |

**다각형 점**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| P1 ★ | 편집 중 다각형을 고른다 / 사각형·타원·잠긴 다각형·보기 모드 | 꼭짓점 동그라미와 긴 변의 '+' / 없음 |
| P2 ★ | 점 하나를 끈다(방 안에 의자·카메라를 둔 채) | 그 점만 움직이고 다른 점·의자·카메라는 제자리. 속성 칸의 위치·크기가 바뀐다 |
| P3 | 다각형을 30° 돌린 뒤 점을 끈다 | 다른 점이 화면에서 움직이지 않는다 |
| P4 | '+'를 끈다 / 누르기만 한다 | 점이 생겨 끌린다 / 아무것도 안 생긴다 |
| P5 | 점을 눌러 고르고 Delete / 세 점 다각형에서 / 고른 점 없이 Delete | 점이 지워진다(되돌리기 한 번) / 안내만 뜨고 삭제 확인 창 없음 / 지금처럼 삭제 확인 창 |
| P5b ★ | 점을 고른 뒤 **휠로 축소해 동그라미가 사라지게** 하고 Delete / 점을 고른 뒤 속성 칸에서 잠그고 Delete / 점을 고른 뒤 기호 팔레트에서 기호를 고르고 바로 Delete | 노드 삭제 확인 창(점은 지워지지 않는다) / 아무 일도 없다 / 노드 삭제 확인 창(점은 지워지지 않는다) |
| P6 | 점을 옆 점과 수평·수직이 되는 자리, 다른 방의 모서리 근처로 / 점을 옆 점 바로 위로 / **가구와 카메라가 든 다각형 방**의 점을 방 안 의자 옆, 다른 방의 변 중간, 도면 테두리 가까이로 | 붙고 안내선이 보인다 / 옆 점 위에는 놓이지 않는다(겹친 동그라미가 생기지 않는다) / 붙지 않고 안내선도 없다 — 의자 옆을 지나도 걸리지 않는다(점은 옆 점의 가로·세로와 다른 공간의 모서리에만 붙는다) |
| P6b | 가로·세로가 맞아 있는 점의 동그라미 가장자리를 눌러 살짝(5px) 끈다 / Alt를 누른 채 같은 동작 | 점이 누른 자리로 튀지 않고 맞은 자리에 붙어 있다 / 움직인 5px만큼만 옮겨진다 |
| P7 ★ | 사각형 방 → '다각형으로 바꾸기' → 변에 점 둘을 더하고 모서리를 안으로 끌어 ㄱ자 | ㄱ자가 된다. 3D와 보조 평면도도 ㄱ자. 저장 후 새로 고쳐도 그대로 |
| P8 | 타원 방 | 버튼 없음 |
| P9 ★ | 사각형에서 바꾼 직후 / 그 네모를 끈다 / 오른쪽 아래 점을 끈다 / ㄱ자 방(오른쪽 아래 점이 남은 모양) / 오른쪽 아래 점을 안으로 멀리 옮긴 뒤 | 크기 네모가 모서리 **바깥 대각선**에 짧은 줄기와 함께 보인다(없어지지 않는다) / 전체 크기가 바뀌고 첫 움직임에 모서리가 튀지 않는다 / 그 점만 움직인다(네모가 가로채지 않는다) / 네모가 바깥에 있고 끌면 ㄱ자 전체가 늘고 준다 / 네모가 상자 모서리로 돌아온다 |
| P10 | 점 편집 뒤 되돌리기·다시 실행 | 단계마다 하나씩. 고른 점 표시는 되돌리면 사라진다 |
| P11 | 10%에서 다각형 | 점 손잡이가 없고 몸통을 끌면 옮겨진다. 아래 줄 힌트가 `확대하면 점을 고칠 수 있어요 · 휠로 확대`다 |
| P12 ★ (740) | 100%에서 작은 다각형 방(도면 70단위쯤)을 고른다 → 휠로 확대 | 점 동그라미가 없는 대신 아래 줄에 확대 안내가 보인다 → 확대하면 동그라미가 나오고 힌트가 점 편집 문구로 바뀐다 |

**그대로여야 하는 것**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| R1 ★ | 카메라 추가 / 기호 놓기·Ctrl+D / 노드 삭제 / 손 도구와 휠 버튼으로 화면 옮기기 / 숫자 칸 | v1.130.0과 같다(카메라는 500, 340) |
| R2 | 3D에서 기즈모로 옮기고 되돌리기 / 보조 평면도 / 이 카메라 시점으로 보기 | 같다 |
| R3 | 저장 → 새로 고침 / 취소(버리기) / 상세 도면 만들기·연결 | 같다 |
| R4 ★ (740) | 도구줄·아래 줄(힌트, 스냅, − 100% ＋ 맞춤) | 버튼이 겹치거나 잘리지 않는다. 힌트는 두 줄 안에 있다(넘치면 말줄임, 마우스를 올리면 전체 문구) |
| R5 ★ | 안내선·점 손잡이·이름 칸·**'스냅' 버튼의 켜짐과 꺼짐** | 어두운·밝은 화면 모두에서 또렷하다. 스냅 버튼은 켜졌을 때 배경색이 실제로 들어가고(도구줄의 활성 버튼과 같은 모양) 꺼졌을 때와 구분된다 |
| R6 ★ | 창 너비 740과 1100에서, 편집 중에 다각형 방 ↔ 사각형 방 ↔ 빈 곳을 번갈아 누른다 / 다각형 방을 더블클릭 | 선택이 바뀌어도 **도면 크기와 위치가 흔들리지 않는다**(아래 줄 높이가 그대로) / 둘째 클릭이 같은 방에 떨어져 이름 칸 또는 상세 도면이 열린다 |

**배포 뒤 실기에서만 볼 수 있는 것**: 실제 터치패드의 두 손가락 벌리기(노트북), 한솔 PC의 마우스 휠 감도, 설치된 앱에서의 저장.

---

## 14. 배포 기록과 문서

- 버전: `package.json`의 `version`과 `package-lock.json`의 두 곳(맨 위 `version`, `packages[""].version`)을 `1.131.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다.
- `DEVLOG/update-notes.json` 맨 앞에 추가(비개발자 문구, 시험 공개 표기는 1.130.0과 같은 방식):

```json
{
  "version": "1.131.0",
  "title": "배경 도면을 그리고 고치기가 편해졌어요 (시험 중)",
  "items": [
    {
      "category": "feature",
      "summary": "도면을 마우스 휠로 확대·축소해요 (시험 중)",
      "description": "평면 도면 위에서 휠을 굴리면 마우스가 가리키는 곳을 중심으로 커지고 작아져요. 노트북 터치패드에서 두 손가락을 벌려도 되고, 키보드의 + − 0 으로도 돼요. '맞춤'을 누르면 그려 둔 것 전체가 한눈에 들어오고, 예전보다 더 멀리서 볼 수 있어요. 크기를 바꾸는 손잡이는 확대해도 늘 같은 크기로 보여요. 배경 화면은 아직 배한솔 계정에서만 시험하고 있어요."
    },
    {
      "category": "ux",
      "summary": "공간을 그리면 바로 이름을 붙여요 (시험 중)",
      "description": "네모·원·다각형을 그리면 그 자리에 이름 칸이 바로 열려요. 글자를 치고 Enter를 누르거나 다른 곳을 누르면 끝나요. 이미 있는 공간·기호·카메라는 더블클릭해서 이름을 고쳐요. 상세 도면이 연결된 공간은 지금처럼 더블클릭하면 안으로 들어가고, 이름은 F2 키나 오른쪽 속성 칸에서 바꿔요."
    },
    {
      "category": "feature",
      "summary": "옮기고 줄일 때 옆 도형에 착 붙어요 (시험 중)",
      "description": "평면 도면에서 도형을 옮기거나 크기를 바꿀 때 다른 도형의 가장자리나 가운데, 도면 테두리에 가까워지면 착 달라붙고, 붙는 순간에만 가는 안내선이 보여요. 붙지 않은 위치와 크기는 소수점 없이 깔끔하게 떨어져요. 돌릴 때는 수평·수직에서 살짝 걸려요. 도면 아래의 '스냅' 버튼으로 끄고 켤 수 있고, Alt 키를 누른 채 끌면 그때만 자유롭게 놓여요."
    },
    {
      "category": "feature",
      "summary": "다각형의 점을 끌어 모양을 고쳐요 (시험 중)",
      "description": "편집 중에 다각형 공간을 고르면 꼭짓점마다 작은 동그라미가 나타나요. 끌면 그 점만 움직이고, 변 가운데의 +를 끌면 점이 새로 생기고, 점을 고른 뒤 Delete를 누르면 지워져요. 네모 공간은 속성 칸의 '다각형으로 바꾸기'로 바꾼 뒤 ㄱ자 같은 모양으로 만들 수 있어요. 점을 옮겨도 그 안의 카메라와 가구는 제자리에 있어요."
    }
  ]
}
```

- 문서
  - `AGENTS.md` '배경 라이브러리 데이터 경계'의 "평면/3D 공동 도면" 항목 다음에 한 항목: 평면 편집 보조(v1.131.0) — 확대·맞춤은 보기 값만 바꾼다 / `mapSnap.ts`·`mapPlanGesture.ts`는 three.js·DOM 없는 순수 모듈이고 스냅은 진행 중인 제스처 안에서 (시작 도면, 포인터)의 순수 함수로만 계산한다(끝난 뒤 고쳐 쓰지 않는다) / 붙은 축은 대상 값 그대로, 붙지 않은 축만 정수 / 옮기기·크기 바꾸기는 **가까이 있는 것**(다른 축으로 화면 `MAP_SNAP.reachPx` 안)의 선에만 붙는다 — 선을 끝없이 늘이면 도면의 모든 것이 후보가 되어 늘 붙어 있게 된다 / 다각형 점이 붙는 곳은 옆 점의 가로·세로와 다른 공간의 모서리 둘뿐이다(다른 노드의 선·테두리 선을 넣지 않는다) / 다각형 점 편집은 `replaceMapNode`로 그 노드만 바꾸고 `transformMapSpace`를 거치지 않는다 / 안내선·이름 칸·고른 점은 화면 상태, 스냅 켜기/끄기만 기기별(`bflow.background-map.snap.v1`) / 늘 깔린 눈금은 만들지 않는다 / 평면의 더블클릭은 SVG 한 곳에서, 누를 때 적어 둔 기록으로 판정한다(편집 중의 누름은 포인터를 캡처하므로 `click`·`dblclick`이 노드 요소에 닿지 않는다 — 노드 `<g>`에 `onDoubleClick`을 달지 않는다). 캔버스가 받지 않은 누름은 그 기록을 비운다(창 단위 `pointerdown` 캡처) / 끌기에 쓴 Alt의 키 이벤트는 뗄 때까지 창 메뉴로 보내지 않는다(포인터가 눌려 있는지가 아니라 그 Alt가 끌기에 쓰였는지로 판정한다) / 크기 바꾸기·점 끌기는 손잡이의 기준점에 움직인 만큼을 더한다(누른 자리를 쓰지 않는다).
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절(:12-24)에 `- [x] 2026-10-08 ① 평면 편집 기본기(v1.131.0)` 한 줄, 맨 끝 버전 목록에 `### v1.131.0 배경 도면 ① 평면 편집 기본기` 절(네 기능, 남은 실기 확인).
  - `DEVLOG/background-3d-opus-handoff-2026-10-07.md`: `## 15. ① 평면 편집 기본기 (v1.131.0)` — 이 설계 문서 위치, 바뀐 파일, 뒤 묶음이 지켜야 할 것(화면 배율값 하나, `snapMove`의 id 집합과 닿는 거리, 넘기기는 `click`에서, 더블클릭은 SVG에서 누름 기록으로(캔버스 밖 누름은 기록을 비운다), ②가 정해야 하는 넘기기 조건(11절)).
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-08 ① 평면 편집 기본기 (v1.131.0)` — 12.8의 수치와 13절 결과(E1~E6, N13·N15·S12 관찰 포함), 확인하지 못한 것.
  - 완료 보고(한솔에게): 16절 '완료 보고에 적을 것'의 항목을 비개발자 문장으로 옮겨 적는다.
  - `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`: B1 절에 설계 문서 링크와 상태 한 줄.
  - `CLAUDE.md`는 고치지 않는다(구조 변경 없음).

---

## 15. 구현 순서 (커밋마다 typecheck·테스트가 통과하게)

1. **바탕**: `mapDocument.ts`(한계·화면 배율값·확대·맞춤) + 테스트(12.1, 12.2). 편집기의 `labelScale`만 새 상수로.
2. **F9**: `mapPlanEdit.ts`(상수·손잡이 배치) + `BackgroundMapPlanOverlays.tsx`의 `MapNodeHandles` + 편집기의 휠·맞춤·키 + 테스트(12.6 일부).
3. **제스처 모듈**: `mapGeometry.ts`의 `nodeLocalPoint`·`resizeSpaceTo`·`nodeResizeCorner`·`placeMapNode`·`replaceMapNode` + `mapPlanGesture.ts`(스냅 없이, `vertex` 없이) + 편집기의 `pointerMove` 교체. 이 시점의 동작은 크기 네모를 눌렀을 때 모서리가 튀지 않는다는 점만 빼고 v1.130.0과 같아야 한다(12.4의 "스냅 없음" 테스트).
4. **F4**: `mapSnap.ts`(닿는 거리 포함) + 제스처 모듈의 스냅 분기 + 안내선 + 스냅 버튼 + Alt(창 단위 처리기와 `altDrag`, 6.5) + 테스트(12.3, 12.4). **E3을 이 단계에서 먼저 확인**한다(Alt가 창 메뉴로 새지 않는지는 앱에서 돌려 본 적이 없다).
5. **F1**: `renameMapNode`·`nodeNameAnchor` + `BackgroundMapNameBox.tsx` + 넘기기를 `click`으로 + 누름 기록(캔버스 밖 누름에 비우는 창 단위 처리기 포함, 3.4)과 SVG의 `canvasDoubleClick`(노드 `<g>`의 `onDoubleClick` 제거) + F2 + 아래 줄 힌트 고정 + 테스트. **E1·E2·E4·E5·E6을 이 단계에서 먼저 확인**한다.
6. **F11**: 다각형 점 함수 + `vertex` 모드 + `MapVertexHandles` + 크기 네모 비켜 서기 + Delete + 버튼 + 다각형 도구의 같은 점 거리 + 테스트(12.5, 12.6, 12.4의 vertex).
7. 앵커 테스트(12.7)와 뮤테이션 확인, CSS 마무리, 문구, 수동 검증(13절), 버전·기록·문서(14절).

---

## 16. 열린 질문과 확인 필요

한솔에게 지금 다시 물어야 할 것은 없다(E3이 앱에서 실패할 때만 고를 것이 생긴다 — 아래 표). 아래는 **앱 엔진에서 확인할 것**이고, 각각 대체안을 정해 둔다. "탐침"은 설계 검토 때 앱과 같은 엔진(Electron 33.4.11 / Chromium 130.0.6723.191)의 숨긴 창에 `pointerDown`과 같은 순서의 시험 쪽을 띄워 실제 입력을 넣어 본 것이다. 앱 자체에서 본 것은 아니므로 13절에서 다시 확인한다.

| 확인할 것 | 탐침에서 본 것 / 기대 | 앱에서 다르면 |
|---|---|---|
| 누르기에서 `preventDefault`와 포인터 캡처를 쓴 뒤에도 `click`이 SVG에 오고 더블클릭의 두 번째 `detail`이 2인지 (E1) | 탐침: 온다(`click`의 대상은 SVG, `detail` 1 → 2). 끌고 난 뒤에도 `click`은 한 번 온다 | 넘기기를 `pointerUp`에 그대로 두고, 직전의 움직이지 않은 누름이 500ms·5px 안이었으면 편집 중일 때 넘기지 않는다(시간·거리 판정) |
| 캡처한 누름 뒤의 `dblclick`이 어디로 가는지 (E5) | 탐침: **SVG로 간다. 노드 `<g>`의 리스너는 불리지 않는다.** 캡처하지 않은 누름(보기 모드)의 `dblclick`은 눌린 요소에서 SVG로 올라온다. 어느 쪽이든 SVG의 처리기 하나가 받는다(5.6). `dblclick` 안에서 준 입력 칸의 포커스는 남는다 | `dblclick`이 SVG에 오지 않으면 SVG의 `onClick`에서 `event.detail === 2`일 때 `canvasDoubleClick`을 부른다(`click`이 `detail` 2로 SVG에 오는 것은 위 줄에서 확인된다) |
| 한글 조합 중 Enter (E2), 조합 중 다른 곳 클릭 (N14) | 이름이 온전히 확정된다(한 번 또는 두 번의 Enter) | 조합 가드는 유지한다. 글자가 빠지면 `compositionend` 뒤에 확정하도록 미룬다 |
| 끌기에 쓴 Alt가 창 메뉴로 새지 않는지 — 마우스를 먼저 떼는 순서, Alt를 먼저 떼는 순서, 길게 눌러 자동 반복이 낀 경우 (E3) | **탐침으로도 앱으로도 돌려 보지 않았다.** 조건식과 기본 메뉴 줄의 동작에서 따진 기대: 끌기에 쓴 Alt의 반복 누름과 뗌을 창 캡처 단계에서 `preventDefault`하면 메뉴 줄이 포커스를 가져가지 않는다(6.5). 맨 처음 Alt 누름은 막지 못한다 | 규칙은 6.5 그대로 둔다("눌려 있는 Alt가 끌기에 쓰였는가"로 판정, 떼는 순서와 무관). 그 `preventDefault`로도 메뉴 줄이 포커스를 가져가면 화면 쪽 코드로는 더 막을 길이 없다 — 창 메뉴는 `electron/**`의 일이고 이번 묶음은 그 파일을 건드리지 않는다(11절). 그때는 스냅의 나머지를 그대로 두고 한솔에게 둘 중 하나를 고르게 한다: ① 창 쪽에서 메뉴 줄이 Alt에 반응하지 않게 하는 수정을 따로 낸다 ② 그대로 두고 "Alt로 끈 뒤에는 도면을 한 번 눌러야 키가 듣는다"를 완료 보고에 적는다. 어느 쪽이든 '스냅' 버튼으로 끄는 길은 그대로 있다 |
| 첫 클릭이 누르면 사라지는 버튼 위, 둘째 클릭이 SVG 위인 더블클릭에서 `dblclick`이 SVG에 오는지 (E6) | 돌려 보지 않았다. 온다고 보고 설계했다(`dblclick`은 둘째 클릭 아래의 요소가 받는다) | 오든 오지 않든 동작이 같다: 첫 클릭에서 창 단위 처리기가 누름 기록을 비우므로 `canvasDoubleClick`은 아무 일도 하지 않는다(3.4). E6에서 기록의 첫 칸이 비어 있지 않으면(그 누름이 처리기에 오지 않았다) 그 누름이 지나는 길을 찾아 같은 처리기로 보낸다. 시간 상수로 막지 않는다 |
| 실제 같은 도면에서 안내선이 얼마나 자주 보이는지, 닿는 거리 48px이 적당한지 (S12) | 계산으로만 봤다: 빈 자리와 먼 도형의 줄에서는 붙지 않고 정수로 떨어진다. 가까운 것 옆에서만 붙는다 | 너무 자주 붙거나, 반대로 옆방과 줄이 잘 안 맞춰지면 `MAP_SNAP.reachPx` 하나만 고친다(24~96px 사이). 그래도 가구 때문에 거슬리면 아래 '완료 보고에 적을 것'의 선택지를 한솔에게 보인다 |
| 포커스를 가진 입력 칸이 내려갈 때 blur가 오는지 | 탐침: **온다.** 제거가 끝나기 전에 `blur`·`focusout`이 그 자리에서 온다. 이름 칸은 내려가는 중의 blur를 확정으로 치지 않고, 처리기는 가장 최근 렌더의 `canEdit`을 본다(5.5) | — (두 장치가 blur가 React까지 닿든 닿지 않든 같은 결과를 낸다) |
| 글자를 친 뒤 SVG가 포커스를 받을 때의 테두리 (N15) | 탐침: 글자를 친 뒤에는 Enter로 돌아오든 도면을 누르든 `:focus-visible`이 켜진다(v1.130.0의 '속성 칸에 치고 도면 누르기'와 같다). 손대지 않는다(5.4) | 거슬린다는 의견이 나오면 "도면의 포커스 테두리는 Tab으로 들어왔을 때만" 같은 규칙을 따로 정한다(기존 표시를 바꾸는 일이라 이번 범위가 아니다) |
| 터치패드의 실제 벌리기 감도 | 4.1의 걸음으로 자연스럽다 | `wheelZoomFactor`의 pinch 계수(0.01)만 조정한다 |

완료 보고에 적을 것(승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것):

- **겹친 카메라를 빠르게 누를 때**: 편집 중에는 빠른 두 번 클릭이 '다음 카메라로'가 아니라 '이름 고치기'가 된다(5.6). 천천히 누르면 지금처럼 넘어간다. 불편하면 대안은 "묶음 안에서는 둘째 클릭도 넘기고, 이름은 F2로만"인데, 이는 승인 문구("카메라는 더블클릭하면 이름을 고친다")를 묶음에서 접는 것이라 한솔이 골라야 한다.
- **새로 그린 도형의 소수 좌표**: 그리기 도구는 스냅 대상이 아니다(승인 문구는 "옮기거나 크기를 바꿀 때"). 새로 그린 사각형·타원·다각형과 새로 놓은 기호는 이번에도 소수 좌표로 생기고, 그 뒤에 옮기면 위치가, 크기를 바꾸면 길이가, 점을 끌면 그 점이 정리된다. 그릴 때부터 붙고 정수로 떨어지게 하려면 범위를 넓히는 결정이 필요하다.
- **상세 도면이 연결된 공간의 더블클릭**이 편집 중과 이동 도구에서도 열리게 된다. v1.130.0에서는 안내 문구("공간을 더블클릭해도 열립니다")와 달리 보기 모드에서만 열렸다.
- **멀리 있는 도형과는 줄을 맞춰 주지 않는다**: 붙는 상대는 끄는 것에서 화면 48px 안에 있는 것뿐이다(6.1). 승인 문구 "가까워지면 착 붙는다"를 그대로 따른 것이고, 이렇게 하지 않으면 도면에 방과 가구가 늘수록 어디에 놓아도 붙어서 소수점 값을 물려받는다. 도면 건너편 방과 윗변을 맞추는 식의 '멀리서 줄 맞추기'가 필요하면 닿는 거리를 늘리거나 따로 정해야 한다. S12에서 본 느낌을 함께 적는다.
- **방을 옮길 때 가까운 가구·카메라에도 붙는다**: 승인 문구의 대상이 "다른 도형의 가장자리·가운데"라 종류로 거르지 않았다. 옆방 벽 가까이 놓인 의자의 줄에 방이 걸릴 수 있다. 거슬리면 "방은 방과 도면 테두리에만, 가구·카메라는 자기 방과 그 방 안의 것에만 붙는다"로 좁힐 수 있다 — 승인된 대상을 줄이는 것이라 한솔이 골라야 한다.

알고 넘어가는 것:

- 다각형의 점은 승인 문구대로 **옆 점의 가로·세로**와 **다른 공간의 모서리**에만 붙는다. 다른 방의 벽 중간, 방 안의 가구·카메라, 도면 테두리에는 붙지 않는다(7.1의 7). 벽 중간에 점을 맞추려면 방을 옮기거나 크기를 바꿔 붙인다.
- 화면에서 24px쯤보다 작게 보이는 도형(멀리 축소했을 때의 의자 등)은 가까이 있는 것의 선을 지나는 동안 거의 계속 붙어 있다. 왼쪽·가운데·오른쪽 세 선이 화면에서 12px 이하 간격으로 서 있어 각각의 붙는 폭(±6px)이 서로 이어지기 때문이다(6.6). 확대하거나 Alt를 누르면 자유롭다.
- 캔버스 위에 떠 있는 버튼('다각형 완성' 등)을 더블클릭하면 둘째 클릭은 그 아래 도면에 떨어진 보통 누름이다. '다각형 완성'의 경우 방금 열린 이름 칸이 그 누름에 닫히고 새 공간은 '새 공간'으로 남는다(5.6). v1.130.0에서도 둘째 클릭은 아래의 것을 골랐다. 아래 공간의 이름을 고치거나 그 안으로 들어가는 일은 없다.

- 10%로도 다 들어오지 않을 만큼 멀리 떨어진 노드가 있으면 '맞춤'은 전체의 가운데를 보여 준다. 그런 노드는 오브젝트 목록에서 고른다.
- 운영체제의 더블클릭 간격을 길게 바꿔 둔 PC에서도 `click`의 `detail`과 `dblclick`이 기준이라 판정이 어긋나지 않는다(E1의 대체안으로 가면 500ms 고정이 된다).
- 붙은 가장자리가 오른쪽·아래·가운데일 때 `x + width`는 대상과 부동소수 오차 범위에서 같다. 저장 값 자체(`x`, `y`)가 붙은 왼쪽·위는 비트까지 같고, 회전 0의 도형은 그 뒤에 크기를 바꿔도 `x`·`y`가 그대로다(6.3). 돌려 놓은 도형(90° 단위 포함)의 크기 바꾸기는 지금처럼 가운데를 거쳐 계산하므로 마지막 자리가 달라질 수 있다.
- 도면 영역이 낮은 창(높이가 680px보다 낮은 캔버스)에서는 최소 확대 근처에서 이름 글자가 조금 작아진다. 새 10%에서의 크기는 지금 25%에서의 크기와 같고, 글자 크기 규칙 자체는 바꾸지 않았다.
- 화면에서 12px보다 작은 도형의 크기 네모, 32px보다 작은 다각형의 점 손잡이는 보이지 않는다. 휠로 확대하면 나온다. 점 손잡이가 크기 때문에 숨겨졌을 때는 아래 줄 힌트가 확대를 안내한다(10.2). 크기 네모에는 따로 안내가 없다(그 크기의 도형은 몸통을 끌어 옮기는 것이 먼저다).
- 손잡이 위에서의 더블클릭(다각형의 꼭짓점·변 가운데, 도형의 오른쪽 아래 모서리)은 이름 칸도 상세 도면도 열지 않는다. 몸통에서 더블클릭한다.
- 아래 줄 힌트는 평면에서 두 줄로 고정된다. 좁은 창에서 문구가 길면 말줄임으로 잘리고 마우스를 올리면 전체가 보인다.
