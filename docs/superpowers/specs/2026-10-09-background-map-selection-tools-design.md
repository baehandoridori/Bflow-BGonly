# 배경 도면 ② 선택 도구 개편 — 설계 (2026-10-09)

> 요청(한솔, 도면 피드백 2차): '선택' 도구의 의미(F5), 끌어서 여러 개 고르기(F6), 네모로 나눈 공간이 따로 잡히게(F8)
> 승인: 2026-10-09 (아래 1.1이 승인 문구 그대로다)
> 버전: v1.132.0 · 운영 DB 변경 없음 · 저장 자료 변경 없음 · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: 브랜치 `claude/bg-map-selection-tools` (= main v1.131.0, a2cc1d38). 아래 줄 번호는 이 커밋에서 직접 확인했다.
> 바탕: ① 설계 `docs/superpowers/specs/2026-10-08-background-map-editing-basics-design.md`(이하 "① 설계")의 제스처 모듈·스냅·누름 기록·넘기기 위에 쌓는다. 라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 F5·F6·F8 절과 6절 보완을 읽고 지금 코드와 다시 맞췄다(2.5).

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 승인된 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. 승인 문구가 한 가지로 정하지 않는 한 곳(1.1 끝의 표 Q1)은 이 설계의 답으로 써 두었고, **구현 전에 한솔의 답을 받는다**(16절).

용어: **묶음**(선택 묶음) = 지금 고른 노드 id 목록, 특히 둘 이상일 때. **대표** = 그 목록의 마지막 것(가장 나중에 고른 것). **3D의 하나** = 3D와 보조 평면도, 그리고 3D 모드의 속성 칸·기즈모가 다루는 노드 하나(`selectedId`). 선택이 하나 이하면 그 선택 자체이고, 여러 개가 선택돼 있으면 처음에는 대표, 3D에서 다른 것을 고르면 그것(없음일 수도 있다)이다 — 그때도 묶음은 그대로다(3.3). **상자** = 끌어서 그리는 선택 상자. **더미** = 같은 자리를 다시 누를 때 차례로 넘어가는 노드 목록(코드의 pile·stack. ① 설계 5.6은 이것을 '묶음'이라고 불렀다 — 이 문서에서는 여러 개 선택과 헷갈리지 않게 '더미'라고 쓴다). **같은 자리를 다시 누름** = 바로 앞의 누름이 같은 맨 위 노드에 떨어졌고 그 누름이 남긴 선택이 그대로일 때(6.1의 `again`). 처음 누르는 자리에서는 늘 맨 위의 것이 잡힌다. **연속 클릭** = 운영체제의 더블클릭 간격 안에 같은 자리를 거듭 누른 둘째 이후의 클릭(클릭 횟수 `detail` ≥ 2). **천천히 다시 누름** = 연속 클릭이 아닌 다시 누름, 곧 새 클릭 묶음을 시작하는 클릭(`detail` 1)으로 같은 자리를 다시 누른 것 — 겹친 공간은 이 클릭에만 아래로 넘어간다(7.2). **쌓임 순서** = 겹친 공간 가운데 무엇이 위인가. **차례** = 라운드 계획의 배포 단위(①~⑤). **화면 배율값** = `screenScale`(① 설계 3.1). **초안** = `mapDocument.ts`가 들고 있는 편집 중인 도면 값. **보기 모드** = 초안이 없는 상태(`editing`이 거짓), **편집 중** = `canEdit`이 참.

---

## 1. 목표와 범위

### 1.1 만드는 것 (승인 문구 그대로)

**도구 정리**
- '선택'은 고르고 옮기는 도구다. 편집 중에 빈 곳을 끌면 화면이 움직이는 대신 선택 상자가 나온다.
- '이동'은 이름을 '화면 이동'으로 바꾼다. 화면은 휠 버튼으로 끌거나, 스페이스를 누른 채 끌어도 옮길 수 있다.
- 편집 중이 아닐 때는 어디를 끌어도 화면이 움직인다. 지금은 방 위에서 끌면 안 움직이는데, 이것도 고친다.

**여러 개 고르기**
- 상자에 닿은 것이 모두 선택되고, Shift+클릭으로 하나씩 더하거나 뺀다.
- 함께 옮기고(스냅 포함), 함께 지우고, 함께 잠그거나 푼다. 한 번에 옮긴 것은 되돌리기 한 번으로 돌아온다.
- 큰 공간이 화면을 덮고 있으면, 그 공간을 잠가 두거나 Shift를 누른 채 끌어 그 위에서도 상자를 그린다.
- 3D에서는 지금처럼 하나만 다루고, 평면으로 돌아오면 여러 개 선택이 그대로 남는다.

**겹친 공간**
- 그린 순서와 상관없이 작은 공간이 먼저 잡힌다. 같은 자리를 천천히 다시 누르면 아래 공간으로 넘어간다. 3D에서도 같다.
- 빠른 더블클릭은 ①과 같은 규칙으로 이름 수정 또는 상세 도면 들어가기다.

**승인 문구의 해석 — 구현 전에 한솔에게 확인한다.** 승인 문구가 한 가지로 정하지 않는 한 곳이다. 아래 '이 설계의 답'으로 설계했다. 답을 받으면 '확인' 칸에 날짜와 함께 적고, 다른 답이 오면 16절에 적어 둔 곳만 고친다.

| # | 승인 문구 | 이 설계의 답 | 확인 |
|---|---|---|---|
| Q1 | "상자에 닿은 것이 모두 선택되고" | 공간은 **벽**이 상자에 닿아야 잡힌다. 방 안쪽에만 그린 상자는 그 방을 고르지 않고 안의 가구·카메라만 고른다(6.2) | 2026-10-09 한솔 확인 — 이 설계의 답 그대로(벽에 닿아야 방이 잡힌다) |

"3D에서는 지금처럼 하나만 다루고, 평면으로 돌아오면 여러 개 선택이 그대로 남는다"는 **두 절을 모두 글자 그대로** 만든다(물을 것이 없다). 3D에서는 지금처럼 무엇이든 하나를 골라 다루고(묶음 밖의 것, 빈 바닥을 눌러 비우기, 목록에서 고르기, 카메라 추가까지), 그 어느 것도 평면에서 고른 묶음을 바꾸지 않는다. 평면으로 돌아오면 같은 묶음이 같은 순서로 선택돼 있다(3D에서 지운 노드만 빠진다 — 3.3, 3.4, 6.7). 3D에서 새로 고른 것은 평면의 선택이 되지 않는다는 점만 완료 보고에 적는다(16.3).

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 여러 개의 크기·회전을 한꺼번에 바꾸기, 줄 맞추기·간격 맞추기 | 승인 문구의 "이번에 넣지 않는 것" |
| 3D에서 여러 개를 함께 옮기기·지우기, 3D 캔버스 안의 상자 | 승인 문구: "3D에서는 지금처럼 하나만 다룬다". `mapCanvas.ts`의 계약(`selectedId` 하나)과 `BackgroundMapCameraGizmo.ts`는 고치지 않는다 |
| 보조 평면도(3D 옆)에서 여러 개 고르기 | 3D 화면의 일부다. 3D의 하나만 표시한다 |
| 3D 모드에서 묶음을 풀거나 다른 선택으로 바꾸기 | 승인 문구: "평면으로 돌아오면 여러 개 선택이 그대로 남는다". 묶음은 평면에서 만들고 평면에서 푼다. 3D 모드에서 하는 고르기는 3D의 하나만 바꾼다(6.7). 3D에서 지운 노드만 묶음에서 빠진다 |
| Ctrl+A(모두 고르기) | 승인 문구에 없다. 포커스가 버튼에 있을 때 브라우저의 '전체 선택'과 갈리고, 잠긴 것·보기 모드를 어떻게 할지도 정해야 한다. '맞춤' 뒤 큰 상자 하나로 같은 일을 한다 |
| 오브젝트 목록에서 Shift+클릭으로 더하기 | 승인 문구의 Shift+클릭은 도면 위의 동작이다. 목록의 클릭은 지금처럼 그것 하나를 고른다(평면에서는 묶음이 그것 하나로 풀리고, 3D 모드에서는 3D의 하나만 바뀐다 — 3.4) |
| Esc로 선택 풀기 | 승인 문구에 없다. 여러 개 선택은 요약의 `×`, 빈 곳을 눌렀다 떼기, 다른 것 누르기로 푼다. Esc는 지금처럼 하던 일(끌기·상자·그리던 다각형·도구)만 되돌리고 선택은 그대로 둔다(6.6) |
| 지금 선택에 **더하는** 상자 | 승인 문구의 Shift는 두 가지뿐이다: Shift+클릭으로 하나 더하기·빼기, Shift+끌기로 공간 위에서도 상자 그리기. Shift를 누른 채 그린 상자도 보통 상자처럼 선택을 **바꿔 넣는다**(6.1) |
| 방향키로 조금씩 옮기기, 묶음 복제(Ctrl+D는 지금처럼 기호 하나) | 요청 없음 |
| 공간 자르기·합치기, 공간끼리의 소속(큰 공간을 옮기면 안쪽 방이 따라오기), 앞뒤 순서 바꾸기 | 한솔 확정: "네모로 나눈 공간을 분리"는 겹친 공간이 따로 잡히는 것뿐이다 |
| 새 카메라의 소속 규칙 바꾸기 | 7.5에서 비교하고 그대로 두기로 했다(`addMapCamera`, 고정 테스트 불변) |
| 저장 자료에 순서·묶음 정보 넣기 | 쌓임 순서와 선택은 읽을 때 계산하는 화면 값이다. `types.ts`·`domain.ts`·SQL 불변 |
| 기호·카메라와 공간을 한 더미로 섞어 넘기기 | 더미는 종류를 섞지 않는다(7.2). 무엇이 카메라·기호의 한 더미인가는 ①과 같다(`planStackUnder` 그대로) |

### 1.3 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | 평면 SVG·3D·보조 평면도는 `mapDocument.ts`의 초안 하나를 읽는다 | 선택 묶음도 문서의 도면별 보기 값(`viewports`) 안에 둔다. 문서 키는 `coalescing·drafts·gesture·viewports` 넷 그대로다(`tests/backgroundMapDocument.test.ts:279` 불변) |
| R2 | **평면 ↔ 3D 전환은 초안·선택·되돌리기 기록을 바꾸지 않는다** | 전환은 여전히 문서 액션이 아니다(`tests/backgroundMapDocument.test.ts:277-288` 불변). `switchMode`·`leave3D`·`navigate`는 선택 액션을 부르지 않는다(12.8 앵커 22). 3D는 하나만 다루고(처음에는 대표), 3D 모드에서 무엇을 고르든 묶음(`selectedIds`)은 그대로다(`pick-one`, 3.2). 묶음은 평면에서만 쓰고 평면에서만 바뀐다 |
| R3 | **보기 값(`viewports`)은 되돌리기·다시 실행·초안 버리기를 거쳐도 같은 객체다** | 리듀서는 그 액션들에서 선택을 건드리지 않는다(`tests/backgroundMapDocument.test.ts:262-265`의 `assert.equal(next.viewports, state.viewports)` 불변). 사라진 노드의 id는 저장된 목록에 남기고, 읽을 때 걸러 낸다(3.3) |
| R4 | 한 번의 끌기 = 되돌리기 한 단계 | 묶음 이동은 `beginGesture → previewGesture… → finishGesture` 한 번이다. 묶음 지우기·잠그기는 `update` 한 번씩이다 |
| R5 | 상자·선택은 편집 내용이 아니다 | 상자는 편집기의 화면 상태이고 문서 제스처를 열지 않는다. 선택 액션은 초안과 기록을 건드리지 않는다. 되돌리기 단계가 생기지 않는다 |
| R6 | 잠긴 노드는 움직이지 않는다 | 묶음 이동은 잠긴 것을 건너뛴다(6.3). 묶음 지우기도 잠긴 것을 남긴다(6.4) |
| R7 | 소속 항목은 자기 공간에 한 번만 실려 간다 | 묶음 이동은 공간마다 기존 `transformMapSpace`를 한 번 부르고, 그 공간이 실어 나른 항목은 묶음에 들어 있어도 다시 옮기지 않는다(6.3) |
| R8 | 상세 도면이 연결된 공간의 더블클릭은 그 도면으로 들어간다(보기 모드·편집 중 모두). 이름은 더블클릭(연결 없음) 또는 F2 | 더블클릭이 하는 일을 순수 함수 하나(`planDoubleClickAction`)로 정하고, 카메라·기호 더미의 넘기기와 더블클릭 처리기가 같은 판정을 쓴다(7.2). 공간의 더미는 연속 클릭에 넘어가지 않으므로(그 더블클릭이 할 일이 있든 없든) 넘기고 나서 들어가는 일이 없다. **다른 공간이 선택돼 있어도** 처음 누르는 자리의 대상은 눈에 보이는 맨 위 공간이다(6.1의 `again`). 넘겨서 골라 둔 아래 공간에 더블클릭이 할 일이 없으면 맨 위 공간의 일을 한다. 들어간 공간은 선택된 채 남는다(되풀이해 더블클릭해도 번갈아 어긋나지 않는다) |
| R9 | 늘 깔린 눈금 없음, 새 카메라는 고정 생성점 | 건드리지 않는다(`addCamera`, `addMapCamera`) |
| R10 | 저장 자료·검증 계약·배경 메뉴 노출 범위 불변 | `types.ts`·`domain.ts`·SQL·`mapWorkflow.ts`·electron·`featureFlag.ts`를 건드리지 않는다 |
| R11 | 테스트는 Node type-stripping으로 돈다 | 새 `.ts` 모듈은 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만, 경로 별칭 금지 |
| R12 | 스냅은 진행 중인 제스처 안에서만 계산한다 | 묶음 이동도 `previewPlanGesture` 안에서 `snapMove` 한 번이다. 끝난 뒤 고쳐 쓰지 않는다. `mapSnap.ts`는 고치지 않는다 |
| R13 | 평면의 더블클릭은 SVG 한 곳에서, 누름 기록으로 판정한다. 캔버스가 받지 않은 누름은 기록을 비운다 | 그대로 둔다. Shift 누름과 스페이스 누름은 "더블클릭의 반쪽이 아니다"로 기록을 비운다(9.1) |
| R14 | 움직임 규칙 | 새 요소에 전환·애니메이션을 넣지 않는다. `backdrop-filter` 없음 |

뒤 차례(③~⑤)를 막지 않는 점: ③의 도로는 쌓임 순서 비교 함수의 맨 앞 항 하나로 들어간다(7.6). ④의 편집 권한은 `canEdit` 한 값으로 들어오므로 이번 규칙(상자·묶음 동작은 `canEdit`일 때만)이 그대로 맞는다. ⑤의 주석 핀에 대해 이번 차례가 정하는 것은 없다: 상자·더미·쌓임 순서의 코드는 공간·기호·카메라 세 종류만 읽고 주석 핀에 기대지 않는다. 핀이 상자에 잡히는지는 ⑤가 정한다.

---

## 2. 현재 동작 (v1.131.0)

파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다. 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

### 2.1 도구와 누름

도구는 `Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'polygon' | 'symbol'`(:31). 평면 도구줄은 선택·이동과, 편집 중일 때 사각형·타원·다각형(:787-789). 3D는 선택·둘러보기(:790-791)이고 `hand`가 `look`으로 넘어간다(:898).

포인터 세션의 모드는 `pan · click · move · resize · rotate · draw · vertex`(:37). `pan`과 `click`은 문서를 건드리지 않는다. 끌기는 화면 4px을 넘어야 시작한다(:635).

| 도구 · 상태 | 누른 곳 | 누를 때 | 끌 때 | 떼기(안 움직임) · 더블클릭 |
|---|---|---|---|---|
| 선택 · 편집 중 | 잠기지 않은 공간 | 그 공간 선택(:601), `move` 세션(:618) | 소속 항목과 함께 옮겨진다(스냅) | 더블클릭: 연결된 도면으로 / 이름 칸(:702-706) |
| 〃 | 기호·카메라 | 선택. 같은 자리 더미에서 이미 고른 것이 있으면 그것이 대상(:598-600) | 대상이 옮겨진다 | 더미면 다음 것으로(:684-687 → SVG `click` :841-845). 더블클릭: 이름 칸 |
| 〃 | 잠긴 노드 | 선택. `click` 모드라 세션 없이 끝난다(:618-620) | 아무 일도 없다 | 더블클릭: 연결된 공간이면 들어간다 |
| 〃 | 손잡이(크기·회전·점·+) | `resize`·`rotate`·`vertex` 세션 | 그 제스처 | 더블클릭 무동작(:695) |
| 〃 | 빈 곳 | 선택 해제(:601) | **화면이 움직인다**(기본 모드가 `pan`, :615, :638) | — |
| 선택 · 보기 모드 | 노드 | 선택(더미 규칙 같음) | **아무 일도 없다** — `click` 모드(:619)는 더미가 아니면 세션 없이 끝나고(:620), 더미여도 `pointerMove`가 돌아간다(:639) | 더미면 클릭마다 다음 것으로(:843의 `canEdit`이 거짓). 더블클릭: 연결된 공간만 들어간다 |
| 〃 | 빈 곳 | 선택 해제 | 화면이 움직인다 | — |
| 이동(`hand`) · 둘 다 | 어디든 | 선택하지 않는다(:595) | 화면이 움직인다(:616, :619가 `hand`를 뺀다) | 더블클릭: 연결된 공간이면 들어간다(:703) |
| 휠 버튼 · 어느 도구든 | 어디든 | 선택하지 않는다(:595의 `event.button === 0`) | 화면이 움직인다(:582가 버튼 1을 받고 :616·:619가 뺀다) | — |
| 사각형·타원 · 편집 중 | 어디든 | `draw` 세션(:617) | 새 공간이 그려진다 | 그린 뒤 이름 칸(:668) |
| 다각형 · 편집 중 | 어디든 | 점 추가(:605-613) | — | 빈 곳 더블클릭: 완성(:696) |
| 기호 · 편집 중 | 어디든 | 기호를 놓는다(:614) | — | — |

저장 중(`disabled`)에는 `pointerDown`이 맨 앞에서 돌아가므로(:582), 그 아래에서는 `canEdit`과 `editing`이 같은 값이다.

### 2.2 선택이 사는 곳과 "하나"를 전제한 곳

저장: 도면별 `MapViewport { x, y, zoom, selectedId }`(mapDocument.ts:13). 액션 `select`(:41, 리듀서 :127-131)가 `selectedId`를 바꾸고 진행 중인 필드 편집을 끝낸다. 손대지 않은 도면은 기본값을 읽는다(:47, :146-148). 훅의 `select(mapId, id)`(useBackgroundMapDocument.ts:28, :56), 편집기의 `select(id, mapId?)`(:335).

`selectedId` 하나를 전제한 곳 전부:

| # | 읽는 곳 | 위치 | 지금 |
|---|---|---|---|
| 1 | 선택된 노드 | :219-220 | `selected = current.nodes.find(id === view.selectedId)` |
| 2 | 속성 칸 | :915-972 | `selected`가 있으면 그 노드의 양식, 없으면 도면 구성(:973-982) |
| 3 | 회전·크기 손잡이 | :885 | `selected && canEdit && !selected.locked` |
| 4 | 다각형 점 손잡이·고른 점 | :231-237, :887, :325 | `selected`가 잠기지 않은 다각형일 때. 고른 점은 `view.selectedId`가 바뀌면 풀린다 |
| 5 | 이름 칸 | :539-546, :563-569 | `beginRename`이 그 노드를 선택한다. F2는 `selected`(:732) |
| 6 | 키보드 | :732, :735, :740, :750 | F2 · Ctrl+D(기호 하나) · Delete(고른 점 → 노드 하나 삭제 확인) |
| 7 | 숫자 칸·속성 변경 | :388-399 | `patchNode`·`moveSelected`가 `selected` 하나를 고친다 |
| 8 | 삭제 확인 창 | :452-456, :1013 | `selected` 하나를 지우고 선택 해제. 제목이 그 이름 |
| 9 | 이미지 그리드(갤러리) | :243, :768 / mapGallery.ts:9, :54-64 / BackgroundMapGallery.tsx:8-50 | `settledSelected` 하나의 범위(카메라의 시점 / 공간 / 기호의 공간). 없으면 도면 전체 |
| 10 | 3D 화면 | :896 / BackgroundMap3D.tsx:415-431, :523-547, :606-613 / map3dScene.ts:170-183 | `selectedId` 하나를 강조하고 기즈모를 붙인다. 클릭은 `onSelect(id)` 하나 |
| 11 | 보조 평면도 | :903 / BackgroundMapPlanPreview.tsx:157-172, :188-193 / mapPlanPreview.ts:109-111, :144-147 | `selectedId` 하나를 다시 그리고 읽어 준다 |
| 12 | 이 카메라 시점으로 보기 | :228, :321-323, :946 | `selected`가 카메라이고 그 id일 때. 선택이 바뀌면 끝난다 |
| 13 | 오브젝트 목록 | :151-164, :983 | `selectedId`인 줄 하나를 강조 |
| 14 | 누를 때의 선택 | :595-602 | 누른 것으로 **바꿔 넣는다**(더미에서 이미 고른 것만 예외) |
| 15 | 끌기가 끝난 뒤 | :667 | 끈 노드 하나를 다시 선택한다 |
| 16 | 리듀서의 이른 반환 | mapDocument.ts:129 | `selectedId`가 같으면 아무 일도 하지 않는다 |
| 17 | 아래 줄 힌트 | :794-797 | `selected`가 다각형인지에 따라 바뀐다 |
| 18 | 계약 | mapCanvas.ts:11, :54 | `selectedId: string \| null` |

되돌리기 버튼에는 동작 이름이 없다(고정 문구 `되돌리기 (Ctrl+Z)`, :839). 선택에 따라 바뀌는 되돌리기 문구는 없다.

### 2.3 겹친 것의 순서와 고르기

- **평면의 그리는 순서**: 공간 전부(:847) → 기호 전부(:855) → 카메라 전부(:868), 각각 **배열 순서**다. 새 공간은 배열 끝에 붙는다(:531, mapPlanGesture.ts:58). 그래서 나중에 그린 큰 공간이 먼저 그린 작은 방을 덮고 누름을 다 가져간다.
- **평면의 더미**: 누른 것이 기호·카메라일 때만 `planStackUnder`(mapPlanPreview.ts:135-139)로 같은 자리(기준점 12단위 안, mapGeometry.ts:302-315)이면서 포인터 아래(`onPlanMark`, :84-85)인 것을 모은다. 공간은 더미를 이루지 않는다: `stackedMapNodeIds`는 공간에 `[id]`를 돌려주고(mapGeometry.ts:305) `planNodeCovers`는 공간에 늘 거짓이다(mapPlanPreview.ts:118).
- **넘기기 조건**: SVG `click`에서 `if (!cycle || (event.detail >= 2 && canEdit)) return;`(:843). ① 설계가 임시 조건이라고 적어 둔 줄이다(① 설계 11절).
- **더블클릭**: SVG의 `canvasDoubleClick`(:693-707)이 누름 기록 두 칸(:209, :604)으로 대상을 정한다. 공간이면 더미를 `[node.id]`로 본다(:700).
- **3D**: `pickMapNode`(map3dScene.ts:615-628) — 카메라·기호의 실체가 먼저, 그다음 포인터 아래 바닥(`pickMapFloor`, :596-608), 바닥이 없으면 가까운 벽. 같은 높이의 바닥끼리는 **배열에서 뒤에 있는 것**이 이긴다(:601-606, 머리말 :592-595). `resolveMapClick`(:634-647)은 카메라·기호 더미만 넘긴다(":643 A space is a pile of one").
- **보조 평면도**: 공간을 배열 순서로 그리고(BackgroundMapPlanPreview.tsx:188), 클릭은 `nextPlanSelection`(mapPlanPreview.ts:144-147)이 카메라·기호 더미만 넘긴다.
- **새 기호의 소속**: 놓은 점을 품은 공간 가운데 **배열에서 마지막 것**(:421). **새 카메라의 소속**: 고정 생성점을 품은 공간이 **정확히 하나**일 때만(mapGeometry.ts:225-230, `tests/backgroundMapGeometry.test.ts:234-254`).

### 2.4 소속 항목이 공간을 따라가는 길

`transformMapSpace`(mapGeometry.ts:54-77) 한 곳이다. 공간의 위치·크기·회전이 바뀌면 `spaceId`가 그 공간이고 잠기지 않은 카메라·기호를 같은 변환으로 옮긴다. 공간끼리는 따라가지 않는다(:63). `moveMapNode`(:84-89)·`placeMapNode`(:92-97)가 공간일 때 이 함수를 부른다. 스냅은 함께 실려 가는 것을 대상에서 뺀다(`snapTravellingIds`, mapSnap.ts:78-83). `snapMove`는 이미 id **집합**과 기준 노드를 받는다(mapSnap.ts:154-174, `tests/backgroundMapSnap.test.ts:282`). 공간을 지우면 남은 항목의 연결만 푼다(`removeMapNode`, mapGeometry.ts:115-117).

### 2.5 이전 분석에서 바로잡은 것

| 라운드 계획(F5·F6·F8)의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| "3D로 넘어가면 대표 하나만 남긴다(`switchMode`가 접는다)" | 전환이 선택을 바꾸지 않는다는 것이 문서의 규칙이고(mapDocument.ts:6-11) 테스트가 고정한다(:277-288) | 전환은 아무것도 하지 않는다. 3D는 하나만 **읽고**(처음에는 대표), 3D에서 무엇을 고르든 묶음은 그대로다(3.3, 6.7) |
| "리듀서에서 사라진 id를 늘 걸러 낸다" | 되돌리기·다시 실행·초안 버리기 뒤에도 `viewports`가 같은 객체여야 한다(:262-265) | 저장은 날것 그대로, 읽을 때 `mapSelection`이 거른다(3.3) |
| "3D 파일과 3D 테스트는 건드리지 않는다" | 같은 높이 바닥의 순서가 `pickMapFloor`에 있고 테스트가 배열 순서를 고정한다(`tests/backgroundMap3dScene.test.ts:340-353, :367`) | `map3dScene.ts`·`BackgroundMap3D.tsx`와 그 테스트를 의도적으로 고친다(7.3, 12.1, 12.6) |
| "상자 판정은 `nodePlanOutline`의 상자로(`nodesInRect`)" | 감싼 상자로 재면 돌려 놓은 방·타원·ㄱ자 방의 빈 귀퉁이에서도 잡힌다 | 모양 그대로 잰다. 공간은 **벽**에 닿아야 한다(6.2) |
| "누를 때 묶음 안의 것이면 떼는 순간에 선택을 바꾼다 / 끌기가 끝나면 다시 선택하는 줄(:667)이 묶음을 접는다 / `select`의 이른 반환이 묶음을 못 접는다" | 맞다(:595-602, :667, mapDocument.ts:129) | 셋 다 반영(6.1, 9.3, 3.2) |
| "보기 모드: 누를 때의 선택은 그대로 두고 끌면 화면 이동" | 누를 때 고르면 화면을 옮길 때마다 선택과 아래 이미지 그리드의 범위가 바뀐다 | 보기 모드의 선택은 **움직이지 않고 뗄 때** 바뀐다(5.4) |
| "넘기기는 `event.detail >= 2`면 건너뛴다" | 보기 모드의 카메라 더미는 더블클릭에 할 일이 없어 지금도 클릭마다 넘어간다(:843). 공간은 지금 더미를 이루지 않아, 방을 더블클릭하면 어느 모드에서든 그 방이 선택된 채 남는다 | 종류에 따라 가른다(7.2). 카메라·기호의 더미: "그 더블클릭이 무언가를 하는가"로 판정한다(①의 뜻 그대로). **공간의 더미: 연속 클릭이면 늘 건너뛴다** — 더블클릭이 할 일이 없어도 아래 공간으로 넘어가지 않는다 |
| "새 기호·카메라의 소속을 모두 '가장 작은 공간'으로" | 두 규칙은 일부러 다르다(2.3) | 기호만 맨 위(가장 작은) 공간으로. 카메라는 그대로(7.5) |
| "Ctrl+A, Esc로 선택 해제, 오브젝트 목록의 Ctrl/Shift-클릭" | 승인 문구에 없다 | 셋 다 넣지 않는다(1.2) |
| "Shift는 상자를 어디서든 시작하게 한다" | 승인 문구도 같다("Shift를 누른 채 끌어 그 위에서도 상자를 그린다") | Shift+상자는 보통 상자와 같은 결과다(바꿔 넣기). 더하는 상자는 넣지 않는다(1.2) |
| "F8은 지금의 넘기기(겹친 카메라의 '이미 고른 것이 대상')를 겹친 공간으로 넓힌다" | 카메라·기호의 더미는 12단위 안이라 "더미에 든 것"이 곧 같은 자리다. 공간의 더미는 그 점을 품은 공간 전부라서 바깥 공간이 안쪽 어디에서나 더미에 든다 | 공간의 더미에서는 **같은 자리를 다시 누를 때만** 이미 고른 것이 대상이다(6.1) |
| 줄 번호 전부 | ① 이전의 번호다 | 2.1~2.4의 번호가 지금 번호다 |

---

## 3. 선택 모델

### 3.1 어디에 두는가

**결정: 문서의 도면별 보기 값에 `selectedId` 옆으로 둔다.** 근거: 평면·3D·보조 평면도가 같은 문서를 읽으므로 전환해도 그대로 남고(R2), 도면마다 따로 기억되며(지금의 `selectedId`와 같다), 문서 키가 늘지 않는다(R1).

```ts
// mapDocument.ts
export type MapViewport = { x: number; y: number; zoom: number;
  /**
   * The node the views that show one node (the 3D view, its companion plan) work on. `select` and `select-many` set it
   * to the last id of `selectedIds` (the primary), or to null when nothing is selected. `pick-one` moves it alone and
   * leaves the selection as it is: a pick in 3D while several are selected. Read through singleViewId.
   */
  selectedId: string | null;
  /**
   * Every selected node id in the order it was picked. Raw: an id whose node an undo, a discard or a refresh
   * removed stays listed, and is left out where the selection is read (mapSelection).
   */
  selectedIds: readonly string[] };
```

- **선택은 `selectedIds`다.** `selectedId`는 선택이 아니라 "3D의 하나"를 적어 두는 자리다. 평면은 `selectedId`를 읽지 않는다.
- 불변식: `select`·`select-many`를 거친 뒤에는 늘 `selectedId === (selectedIds.length ? selectedIds[selectedIds.length - 1] : null)`. `pick-one`을 거친 뒤에는 `selectedIds`가 그 전과 **같은 배열**(`===`)이다.
- `DEFAULT_VIEWPORT`(:47)는 `selectedIds: NO_SELECTION`을 갖는다. `const NO_SELECTION: readonly string[] = [];` 하나를 빈 선택마다 돌려 쓴다(빈 배열을 매번 만들지 않는다).
- `zoomMapViewport`·`zoomMapViewportAt`·`revealPlanPoint`는 받은 보기 값을 펼쳐 돌려주므로(:180, :193, :226) 손대지 않아도 `selectedIds`가 실려 간다. `set-viewport`(:132-136)도 같다.
- `selectedId`를 없애지 않고 이 뜻으로 쓰는 이유: 3D와 보조 평면도의 계약이 `selectedId` 하나이고(`mapCanvas.ts:11`), 3D 통합 테스트와 보기 값 테스트가 이 필드를 읽는다(`tests/backgroundMap3dScene.test.ts:1949, :2055`). 하나만 선택했을 때의 값은 v1.131.0과 같다. 필드를 하나 더 만들지 않는다.
- 근거(3D의 하나를 선택과 따로 두기): 승인 문구의 두 절 — "3D에서는 지금처럼 하나만 다루고"(3D에서 무엇이든 하나를 고를 수 있어야 한다)와 "평면으로 돌아오면 여러 개 선택이 그대로 남는다"(그 고르기가 묶음을 바꾸면 안 된다) — 을 함께 지키려면 3D가 다루는 하나와 평면의 묶음이 서로 다른 값이어야 한다. 선택 하나에 둘을 겸하게 하면 3D의 클릭 한 번(빈 바닥, 묶음 밖의 것, 겹친 카메라의 다음 것)이 묶음을 접는다.

### 3.2 액션

```ts
export type MapDocumentAction = /* …기존… */
  | { type: 'select'; mapId: string; id: string | null }              // 그것 하나로 바꿔 넣기 · 비우기 (기존 액션, 규칙만 바뀜)
  | { type: 'select-many'; mapId: string; ids: readonly string[] }    // 그 목록으로 바꿔 넣기
  | { type: 'pick-one'; mapId: string; id: string | null };           // 3D의 하나만 옮기기 · 비우기. 선택(selectedIds)은 그대로
```

| 액션 | 결과 `selectedIds` | 결과 `selectedId` |
|---|---|---|
| `select`, `id` 있음 | `[id]` | `id` |
| `select`, `id: null` | `[]` | `null` |
| `select-many` | `ids`에서 중복을 뺀 것(먼저 나온 자리 유지). 빈 목록이면 `[]` | 마지막 것(대표). 빈 목록이면 `null` |
| `pick-one` | **그대로(같은 배열)** | `id` |

**선택 액션(`select`·`select-many`)은 모두 "바꿔 넣기"다. 저장된 목록에 더하거나 빼는 액션은 두지 않는다.** 저장된 목록은 날것이라 되돌리기로 사라진 노드의 id가 남아 있을 수 있고(3.3), 리듀서는 도면을 몰라 그것을 걸러 낼 수 없다. 날것에 붙이는 액션이 있으면: 공간 S를 그린다(선택 `[S]`) → 되돌리기(S가 사라진다, 저장은 `[S]`) → 의자를 Shift+클릭(저장 `[S, 의자]`, 화면에는 하나) → 다시 실행 → 고른 적 없는 2개 묶음이 생긴다. 그래서 하나 더하기·빼기(Shift+클릭)는 편집기가 **살아 있는 선택**(`mapSelection`)에서 새 목록을 만들어 `select-many`로 보낸다(9.3). 사라진 노드의 id는 선택을 손대는 그 순간에 떨어진다. 선택을 손대지 않고 되돌리기·다시 실행만 하면 지금처럼 그대로 돌아온다(3.3).

`select`·`select-many`의 공통 규칙(리듀서 안의 `withSelection(state, mapId, viewport, ids)` 하나):

- 결과 목록이 지금 목록과 **같은 id, 같은 순서**이고 `selectedId`도 이미 그 마지막 것(빈 목록이면 `null`)이면 받은 `state` 그대로 돌려준다(같은 선택을 다시 고르는 것은 필드 편집을 끝내지 않는다 — `tests/backgroundMapDocument.test.ts:173, :269` 불변). 목록은 같은데 `selectedId`만 다르면(3D에서 `pick-one`으로 옮겨 둔 뒤 평면에서 같은 묶음을 다시 고름) `selectedId`를 대표로 되돌린 새 보기 값이다.
- 달라졌으면 그 도면의 보기 값만 새 객체로 바꾸고 `coalescing: null`(지금의 `select`와 같다, :130).
- 지금의 이른 반환 `if (viewport.selectedId === action.id) return state;`(:129)는 **없앤다**. 그대로 두면 평면에서 묶음의 대표를 눌렀다 떼도(6.1의 4번), 오브젝트 목록에서 대표를 골라도 묶음이 하나로 접히지 않는다. 이 규칙 때문에 `select(id)` 액션은 어디서 보내든 묶음을 그것 하나로 접는다. **3D 모드에서 여러 개가 선택돼 있는 동안에는 그래서 `select`를 보내지 않고 `pick-one`을 보낸다**(3.3의 `pickAction`, 6.7).
- 리듀서는 id가 그 도면의 노드인지 확인하지 않는다(초안이 없는 보기 모드에서는 도면 값을 모른다. 지금의 `select`도 확인하지 않는다).

`pick-one`의 규칙:

- `selectedId`가 이미 `action.id`면 받은 `state` 그대로다.
- 아니면 그 도면의 보기 값만 `{ ...viewport, selectedId: action.id }`로 바꾸고 `coalescing: null`. **`selectedIds`는 건드리지 않는다**(같은 배열이 실려 간다 — 3.3의 메모와 12.2의 `===` 검사가 기댄다).
- 리듀서는 "여러 개가 선택돼 있는가"를 보지 않는다(도면을 몰라 살아 있는 개수를 셀 수 없다). 언제 이 액션을 보낼지는 `pickAction`이 정한다(3.3).

그 밖의 액션(`update`·`undo`·`redo`·`gesture-*`·`discard`·`drop-drafts`·`begin-editing`·`enter-new-map`·`set-viewport`의 선택 부분)은 `selectedIds`도 `selectedId`도 건드리지 않는다.

훅(`useBackgroundMapDocument.ts`)에 하나를 더한다. `pick-one`은 훅에 따로 이름을 두지 않는다: 편집기의 `select` 한 곳이 `doc.dispatch(pickAction(…))`로 보낸다(6.7. 훅은 이미 `dispatch`를 내준다, :11).

```ts
selectMany(mapId: string, ids: readonly string[]): void;   // dispatch({ type: 'select-many', mapId, ids })
```

### 3.3 읽기: 살아 있는 선택, 3D의 하나, 하나를 고르는 액션

```ts
export type MapSelection = { /** Selected ids that are nodes of the map, in picked order. */ ids: readonly string[]; /** The last of them. */ primaryId: string | null };
/** The selection as it is on a map right now: the stored list (`MapViewport.selectedIds`) without the ids whose node is gone. Nothing is written. */
export function mapSelection(map: BackgroundMap | undefined, selectedIds: readonly string[]): MapSelection;
/**
 * The node a view that shows one node (the 3D view, its companion plan) works on. With at most one node selected it is
 * that selection. With several it is `selectedId` (`MapViewport.selectedId`), which such a view moves alone: null when
 * nothing is picked there, and the primary again when the node it named is gone.
 */
export function singleViewId(map: BackgroundMap | undefined, selection: MapSelection, selectedId: string | null): string | null;
/**
 * The action that picks one node, or none (`id` null). On the plan the pick is the selection (`select`). In a view that
 * shows one node (`singleView`), while several are selected, it only moves the node that view works on (`pick-one`):
 * the group is left as it is for the plan.
 */
export function pickAction(mapId: string, id: string | null, singleView: boolean, selection: MapSelection): MapDocumentAction;
```

`mapSelection`

- `map`이 없거나 저장된 목록이 비었으면 `{ ids: NO_SELECTION, primaryId: null }`(상수 객체 하나).
- 저장된 id가 모두 그 도면의 노드면 **저장된 배열 그대로**를 `ids`로 돌려준다(새 배열을 만들지 않는다). 아니면 살아 있는 것만 거른 **새 배열**이다 — 부를 때마다 새로 생기므로, 렌더에서 읽는 곳은 `useMemo`로 감싼다(3.5, 10.1). 그러지 않으면 사라진 id가 하나라도 남아 있는 동안 프레임마다 새 배열이 메모된 자식에게 넘어간다.
- `primaryId` = `ids`의 마지막(없으면 `null`).
- 둘째 인자가 보기 값이 아니라 저장된 목록인 이유: 메모의 의존값이 `[map, view.selectedIds]`가 된다. 화면을 옮기거나 확대해도(보기 값 객체는 바뀌지만 `selectedIds` 배열은 그대로 실려 간다, 3.1) 선택을 다시 계산하지 않는다.
- 근거(읽을 때 거르기): 되돌리기로 방금 그린 공간이 사라져도 저장된 id는 남고, 다시 실행하면 그 공간이 다시 선택된다(지금의 `selectedId`가 이미 이렇게 돈다, :220).

`singleViewId` — 3D의 하나를 읽는 한 곳

| 살아 있는 선택 | `selectedId` | 결과 |
|---|---|---|
| 하나 이하 | 무엇이든 | `selection.primaryId` — 선택이 곧 3D의 하나다(v1.131.0과 같다. 없으면 `null`) |
| 여러 개 | `null` | `null` — 3D에서 빈 곳을 눌렀거나 `×`로 비웠다. 3D에는 강조된 것이 없다 |
| 여러 개 | 그 도면에 있는 노드(묶음 안이든 밖이든) | 그 id |
| 여러 개 | 그 도면에 없는 id(되돌리기·초안 버리기로 사라진 노드) | `selection.primaryId` — 대표로 돌아간다 |

- 여러 개를 평면에서 막 골랐을 때는 `selectedId`가 대표이므로(3.2) 3D로 가면 대표가 강조된다. 넷째 줄은 그 대표가 되돌리기로 사라진 채 3D로 갔을 때도 "3D는 대표 하나를 다룬다"가 서게 한다.
- 선택이 하나 이하일 때 `selectedId`를 보지 않는 이유: `pick-one`으로 옮겨 둔 뒤 되돌리기로 묶음이 하나로 줄었다면, 평면에 보이는 그 하나가 3D의 하나이기도 해야 한다(선택이 하나일 때 평면과 3D가 다른 것을 가리키면 안 된다 — v1.131.0과 같다).

`pickAction` — "하나를 고른다"가 보내는 액션

| `singleView` | 살아 있는 선택 | 액션 |
|---|---|---|
| 거짓(평면) | 무엇이든 | `{ type: 'select', mapId, id }` — 그것 하나로 바꿔 넣는다(묶음이면 접힌다) |
| 참(3D 모드) | 하나 이하 | `{ type: 'select', mapId, id }` — 지금의 3D와 같다 |
| 참(3D 모드) | **여러 개** | **`{ type: 'pick-one', mapId, id }`** — 3D의 하나만 바뀌고 묶음은 그대로다 |

- `id`가 묶음 안의 것인지 밖의 것인지, `null`인지는 **보지 않는다.** 3D와 보조 평면도가 알려 주는 id는 "눌린 노드"가 아니라 넘기기를 거친 결과다: 강조된 카메라가 같은 자리에 겹친 카메라들 가운데 하나면 그것을 누를 때마다 **다음 카메라**가 오고(`resolveMapClick`, map3dScene.ts:634-646 · `nextPlanSelection`, mapPlanPreview.ts:144-147 — 새 카메라는 늘 한 자리에 생기므로 겹친 카메라는 흔하다), 강조된 공간을 같은 자리에서 천천히 다시 누르면 아래 바닥이 온다(7.3). "대표를 눌렀는가, 묶음 안인가 밖인가"로 가르는 판정은 이 계약에서 믿을 수 없다. 무엇이 오든 `pick-one`이면 묶음은 건드려지지 않는다.
- 두 함수 모두 순수 함수이고 `mapDocument.ts`에 둔다(12.2가 단위 테스트한다).

### 3.4 선택에 일어나는 일 전부

| 일어난 일 | 저장된 목록(`selectedIds`) | 화면에 보이는 선택 |
|---|---|---|
| 되돌리기 · 다시 실행 | 그대로(R3) | 사라진 노드만 빠지고, 돌아오면 다시 든다 |
| 편집 취소(초안 버리기) | 그대로(R3) | 초안에만 있던 노드가 빠진다 |
| 도면 저장 | 그대로 | 그대로(보기 모드에서도 여러 개가 강조된 채 남는다. 묶음 동작 버튼은 없다, 6.5) |
| 다른 사람의 저장으로 도면이 새로 읽힘 | 그대로 | 사라진 노드만 빠진다 |
| 다른 도면으로 이동 | 도면마다 따로다. 떠난 도면의 선택은 남고, 간 도면은 자기 선택을 보인다(지금과 같다) | — |
| **평면 ↔ 3D 전환** | **그대로**(R2) — `selectedId`도 그대로 | 평면: 묶음 전체. 3D: 3D의 하나(`singleViewId` — 처음에는 대표) |
| **3D 모드에서 하나를 고르는 일 전부**(아래 목록) — 하나 이하 선택 중 | `select`로 바꿔 넣는다 | 그 하나(빈 곳·`×`면 풀린다). 지금과 같다. 평면으로 돌아와도 그것이 선택돼 있다 |
| 〃 — **여러 개 선택 중** | **그대로(같은 배열)**. `pick-one`으로 `selectedId`만 바뀐다 | 3D: 고른 그 하나(빈 곳·`×`면 강조된 것이 없다). **평면으로 돌아오면 묶음이 같은 순서로 그대로다** |
| 평면에서 오브젝트 목록을 누름 | `select`로 바꿔 넣는다 | 그 하나(묶음이면 풀린다, 1.2). 지금과 같다 |
| 평면에서 Shift+클릭 | 살아 있는 선택에 그것을 더하거나 뺀 목록으로 `select-many`(9.3) | 더해지거나 빠진다. 사라진 노드의 id는 이때 떨어진다 |
| 평면의 상자 | 닿은 것들로 `select-many` | 닿은 것들(없으면 풀린다) |
| 평면에서 묶음 삭제(`'delete-group'`) | 지운 id를 뺀 살아 있는 나머지로 `select-many`(6.4) | 잠겨서 지워지지 않은 것(없으면 풀린다) |
| 하나 삭제(`'delete-node'`) — 평면, 3D의 하나 이하 선택 | 지금처럼 `select(null)` → `[]` | 풀린다. 지금과 같다 |
| 〃 — 3D의 여러 개 선택(3D의 하나를 지운다) | 그대로. 같은 `select(null)`이 `pick-one(null)`이 된다. 지운 id는 읽을 때 빠진다 | 3D: 강조된 것이 없다. 평면으로 돌아오면 묶음의 나머지(지운 것이 묶음 밖의 것이었으면 묶음 그대로). 나머지가 하나뿐이면 그것이 곧 선택이라 3D도 바로 그것을 강조한다 |
| 카메라 추가·기호 놓기·기호 복제 | `select(그것)` — 평면과 3D의 하나 이하 선택에서는 바꿔 넣고, 3D의 여러 개 선택에서는 `pick-one` | 평면: 그 하나. 3D의 여러 개 선택: 새로 만든 것이 3D의 하나가 되고 묶음은 그대로 |
| 그리기·이름 칸 열기(평면 전용) | `select`로 그 하나 | 그 하나(지금과 같다) |
| 더블클릭으로 상세 도면에 들어감(평면·3D) | 들어가기 직전, 그 공간이 다루는 하나(`singleId`)가 아니면 떠나는 도면에서 `select(그 공간)`(7.2) — 평면에서는 바꿔 넣고, 3D의 여러 개 선택에서는 `pick-one` | 돌아왔을 때 들어갔던 공간이 선택돼 있다(3D의 여러 개 선택에서는 3D의 하나로. 묶음은 그대로) |
| 상세 도면 연결 뒤 그 도면으로 들어감 | 들어간 도면만 `select(null)`(:500, 지금과 같다. 다른 도면에는 늘 `select`다) | — |

**3D 모드에서 하나를 고르는 길 전부**(v1.131.0 코드에서 센 것. 모두 편집기의 `select(id)` 한 곳을 지난다 — 6.7): ① 3D 캔버스의 클릭(노드, 빈 바닥은 `null`, 손잡이 위에서 넘기기 — BackgroundMap3D.tsx:534, :546) ② 보조 평면도의 클릭(노드, 바탕은 `null` — BackgroundMapPlanPreview.tsx:167, :185) ③ 오브젝트 목록(:983) ④ 속성 칸의 `×`(:916) ⑤ 카메라 추가(:410) ⑥ 바닥에 기호 놓기(:426) ⑦ 기호 복제(Ctrl+D·버튼, :404) ⑧ 뷰포트가 시점 보기의 카메라를 알려 올 때(:764 — 지금의 뷰포트는 `null`만 보내므로 실제로는 선택을 건드리지 않는다) ⑨ 이미지 그리드의 '도면 전체'(:755) ⑩ 하나를 지운 뒤(:455) ⑪ 더블클릭으로 상세 도면에 들어갈 때(7.2의 `openSpace`).

**3D 모드에서 하는 어떤 고르기도 묶음을 풀거나 바꾸지 않는다.** 여러 개가 선택돼 있는 동안 위의 열한 가지는 모두 `pick-one`이 되어 3D의 하나만 옮긴다 — 묶음 밖의 것을 눌러도, 빈 바닥을 눌러도, 목록에서 골라도, `×`를 눌러도, 강조된 카메라를 눌러 겹친 다음 카메라로 넘어가도 그렇다. 전환, 궤도 돌리기, 기즈모·속성 칸으로 3D의 하나를 고치는 것도 묶음과 무관하다. 묶음에 든 노드가 달라지는 것은 3D에서 그 노드를 **지웠을 때**(지운 것이 빠진다)와 되돌리기·다시 실행(사라진 노드가 빠지고, 돌아오면 다시 든다)뿐이다. 묶음을 풀거나 다른 선택으로 바꾸는 것은 평면에서 한다(6.1, 6.5의 `×`). 하나 이하가 선택돼 있을 때는 v1.131.0 그대로다: 3D에서 고른 것이 곧 선택이다("3D에서는 지금처럼 하나만 다룬다").

3D에서 옮겨 둔 `selectedId`는 평면에서 선택을 바꾸기 전까지 남는다: 평면에 갔다가 선택을 건드리지 않고 3D로 돌아오면 3D는 아까 고른 그 하나를 다시 보인다. 평면에서 선택을 바꾸면(`select`·`select-many`) 그 선택의 대표로 돌아간다(3.2).

### 3.5 편집기가 읽는 값

```ts
// Keyed on the stored list, not on the viewport: a pan or a zoom keeps `selectedIds` and so keeps this value.
const selection = useMemo(() => mapSelection(current, view.selectedIds), [current, view.selectedIds]);
const multiple = selection.ids.length > 1;
/** The node the 3D view and its companion plan work on: the selection itself, or while several are selected the one picked there. */
const singleId = singleViewId(current, selection, view.selectedId);
/** The one node the single-node tools work on: none on the plan while several are selected. */
const selected = mode === 'plan' && multiple ? undefined : current?.nodes.find(node => node.id === singleId);
/** The selected nodes, in map order: what the summary counts and the group actions work on. */
const groupNodes = useMemo(() => current ? current.nodes.filter(node => selection.ids.includes(node.id)) : [], [current, selection]);
```

**결정: `selected`의 뜻을 "하나를 다루는 도구들이 붙는 노드"로 좁힌다.** 2.2의 1~8, 12, 17번은 모두 `selected`를 읽으므로, 이 한 줄로 평면의 여러 개 선택에서는 한꺼번에 물러서고(손잡이·점 손잡이·F2·Ctrl+D·숫자 칸·이름 칸·모양 줄·하나 삭제), 3D에서는 3D의 하나에 그대로 붙는다. 읽는 곳마다 조건을 다는 것보다 빠뜨릴 곳이 없다. 평면에서 선택이 하나 이하일 때 `singleId`는 그 선택(`selection.primaryId`)이므로(3.3) `selected`는 v1.131.0과 같은 노드다.

| 2.2의 # | 바뀌는 것 |
|---|---|
| 1 | 위의 줄들(`selection`·`multiple`·`singleId`·`selected`·`groupNodes`) |
| 2 | `selected`가 있으면 지금 양식. 없고 `mode === 'plan' && multiple`이면 묶음 요약(6.5). 그 밖은 도면 구성. 3D에서 여러 개가 선택돼 있으면 어느 경우든 그 위에 안내 한 줄(6.5) |
| 3·4·5·6·7·17 | 코드 그대로(`selected`가 `undefined`라 물러선다). 고른 점을 푸는 효과(:325)의 의존값은 `view.selectedId` 대신 `selected?.id` |
| 8 | 하나: 그대로. 묶음: 새 확인 `'delete-group'`(6.4) |
| 9 | `settledSelected = settledCurrent?.nodes.find(node => node.id === selected?.id)` — 평면의 묶음이면 도면 전체 범위 |
| 10·11 | `selectedId={singleId}`를 넘긴다. `onSelect={selectNode}`는 그대로다(계약 불변. 묶음을 지키는 것은 편집기의 `select` 한 곳이다, 6.7). 3D와 보조 평면도는 3D의 하나만 강조한다 |
| 12 | 시점 보기를 끝내는 효과(:321-323)의 의존값과 비교를 `singleId`로 |
| 13 | 평면: 목록은 묶음에 든 줄을 모두 강조하고 `aria-current`는 대표에만. 3D: 3D의 하나인 줄만 강조한다(10.1) |
| 14·15·16 | 6.1, 9.3, 3.2 |
| 18 | `mapCanvas.ts` 불변 |

평면의 노드 강조(:848, :856, :874의 `node.id === selected?.id`)는 `shownIds.has(node.id)`로 바꾼다(`shownIds`는 9.4).

---

## 4. 공통 바탕: 쌓임 순서 하나 (`mapStack.ts`, 새 파일)

"겹친 공간 가운데 무엇이 위인가"를 **한 곳**에서 정하고 평면의 그리기·누름, 더미 목록, 보조 평면도, 3D의 바닥 고르기, 새 기호의 소속이 모두 그것을 읽는다. 한 곳이라도 따로 정하면 평면과 3D가 다른 방을 고른다.

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

- **규칙**: 평면 넓이가 작은 공간이 위. 넓이가 같으면 배열에서 뒤에 있는 것이 위(지금의 그리기 순서와 같은 쪽).
- `spacePlanArea`: 사각형 `width × height`. 타원 `width × height × π / 4`. 다각형은 저장된 0~1 점들의 신발끈 넓이의 **절댓값** × `width × height` — 점이 도는 방향(시계·반시계)과 무관하다. 부호를 남기면 거꾸로 돈 다각형이 음수 넓이가 되어 "가장 작은 것"으로 맨 위에 올라가, 그 안의 방을 다 덮는다(`mapGeometry.ts`의 `outlineArea`(:120-125)도 `Math.abs`를 쓴다. 모듈 안의 함수라 가져다 쓰지 않고 같은 식을 쓴다). (점이 3개 미만이면 윤곽을 상자로 보므로 `width × height` — `spaceOutline`, mapSpatial.ts:211-212. 그런 공간은 저장되지 않는다). 회전은 넓이를 바꾸지 않는다.
- `stackedSpaces`: 공간만 골라 `(넓이 내림차순, 배열 번호 오름차순)`으로 정렬한다. 넓이가 유한하지 않으면 `Infinity`(맨 아래). 노드 객체는 받은 것 그대로다(복사하지 않는다). 배열 자체(`map.nodes`)는 바꾸지 않는다 — 아무것도 저장되지 않는다.
- `spaceStackRanks`: `stackedSpaces`의 번호표.
- `spacesAt`: `stackedSpaces(map)` 가운데 `containsPoint(space, point)`(mapGeometry.ts:208-219 — 회전·타원·다각형을 그대로 본다)인 것을 **위에서부터**.
- 쓰는 곳 다섯: ① 평면 SVG의 공간 그리기(:847 → `stackedSpaces(current).map`) — DOM에서 뒤에 그린 것이 누름을 받으므로 누름도 따라온다 ② 더미 목록(`planPileAt`, 7.2) ③ 보조 평면도(BackgroundMapPlanPreview.tsx:188) ④ 3D `pickMapFloor`의 같은 높이 순서(7.3) ⑤ 새 기호의 소속(7.5).
- 의존: `mapStack.ts → mapGeometry.ts → mapSpatial.ts`. `mapGeometry.ts`는 `mapStack.ts`를 import하지 않는다(그래서 `addMapCamera`는 이 모듈을 쓰지 않는다 — 7.5에서 쓰지 않기로 한 것과 맞는다).
- 근거(넓이): 안쪽 방은 그것을 품은 공간보다 늘 작으므로 "작은 것이 위"면 안쪽 방이 그린 순서와 무관하게 눌린다. 승인 문구 "그린 순서와 상관없이 작은 공간이 먼저 잡힌다" 그대로다.
- 크기를 바꾸는 끌기 도중에 넓이 순서가 뒤바뀌면 그 프레임부터 그리는 순서도 바뀐다(공간의 채움은 반투명이라 눈에 띄는 것은 겹친 곳의 누름 순서뿐이다). 끄는 동안의 포인터는 SVG가 잡고 있어 영향이 없다.

---

## 5. F5 도구 정리

### 5.1 도구 목록

`Tool` 타입(:31)은 그대로다. 평면 도구줄의 두 항목(:788)만 바꾼다.

| id | 라벨(`aria-label`) | `title` | 아이콘 |
|---|---|---|---|
| `select` | `선택` | 편집 중: `선택: 눌러 고르고 끌어 옮기기 · 빈 곳을 끌어 여러 개 고르기` / 보기 모드: `선택: 눌러 고르기 · 끌면 화면이 움직여요` | `↖` (그대로) |
| `hand` | `화면 이동` | `화면 이동: 끌어서 화면만 옮기기 · 스페이스를 누른 채 끌거나 휠 버튼으로 끌어도 돼요` | `✥` (그대로) |
| `rect`·`ellipse`·`polygon` | 그대로 | 그대로 | 그대로 |

- 3D 도구줄(선택·둘러보기, :790-791)과 기즈모의 '이동'(:75)은 그대로다. 평면에서 '이동'이라는 낱말이 사라지므로 "평면의 이동 = 화면, 3D의 이동 = 물체"라는 겹침이 없어진다.
- 창 너비 1200px 이하에서는 라벨이 숨는다(backgrounds-map.css:136). 두 아이콘은 지금도 서로 다르다.

### 5.2 화면을 옮기는 길 셋

누름이 **화면 이동**이 되는 조건(셋 가운데 하나면 된다. 다른 어떤 판정보다 먼저 본다):

1. 휠 버튼(`event.button === 1`) — 어느 도구, 어느 모드에서든. 지금과 같다.
2. '화면 이동' 도구(`tool === 'hand'`) — 지금과 같다.
3. **스페이스를 누르고 있음**(`spaceHeld.current`) — 새로. 어느 도구에서든 그 누름은 화면 이동이다: 그리기 도구여도 그리지 않고, 다각형 도구여도 점을 찍지 않고, 기호 도구여도 놓지 않고, 손잡이 위여도 손잡이를 잡지 않는다.

셋 모두 선택을 바꾸지 않는다. 세션의 종류는 **누른 순간에 정해진다**: 끄는 도중 스페이스를 떼어도 마우스를 뗄 때까지 화면 이동이고, 다른 끌기 도중에 스페이스를 눌러도 그 끌기는 바뀌지 않는다.

누름 기록(① 설계 3.4): 휠 버튼과 '화면 이동' 도구의 누름은 지금처럼 적는다('화면 이동' 도구로 연결된 공간을 더블클릭하면 들어간다, :703). 스페이스를 누른 채의 누름은 적지 않고 기록을 비운다(스페이스 + 더블클릭은 아무 일도 하지 않는다).

### 5.3 스페이스 키

**스페이스를 "누르고 있다"고 적는 것(추적)과 그 키의 기본 동작을 막는 것(삼키기)은 서로 다른 조건이다.** 추적은 넓게(포커스가 어디에 있든), 삼키기는 좁게(편집기 안의 빈 곳과 `body`만) 잡는다. 한 조건으로 묶으면 둘 중 하나가 틀린다: 좁은 쪽에 맞추면 편집기 밖의 버튼('도면 탐색' 탭, 새로고침, 앱 사이드바)을 누른 직후나 속성 칸의 잠금 체크 칸을 누른 직후에 스페이스가 듣지 않아, 스페이스를 누른 채 끈 것이 방을 옮기거나 상자를 그린다. 넓은 쪽에 맞추면 편집기 밖 요소의 스페이스를 가로챈다.

```ts
// 지금 있는 상수 셋(:69-72)은 글자 그대로 둔다(앵커 13이 읽는다):
//   textFields = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
//   interactive = `${textFields}, button`      textEntry = `${textFields}, dialog`
// 그 아래에 둘을 더한다. (textFields 위의 주석 "Both selectors below"는 "The selectors below"로 고친다.)
/** Inputs Space ticks and never types into. For the Space key they are controls, like a button. */
const tickInputs = 'input:is([type="checkbox"], [type="radio"])';
/** Where Space is text (it types, or opens the list of a select) or belongs to an open dialog: `textEntry` without the inputs Space only ticks. */
const spaceEntry = `:is(${textEntry}):not(${tickInputs})`;

/** Space is held for panning. The ref is what a press reads; the state only drives the cursor. */
const spaceHeld = useRef(false);
const [spacePan, setSpacePan] = useState(false);
const rootRef = useRef<HTMLDivElement>(null);                 // 편집기 루트 <div className="bmap-layout"> (:802)
const onSpaceKey = useEvent((event: KeyboardEvent) => {
  if (event.code !== 'Space') return;
  const hold = (held: boolean) => { if (spaceHeld.current !== held) { spaceHeld.current = held; setSpacePan(held); } };
  if (event.type === 'keyup') { hold(false); return; }
  const root = rootRef.current, element = event.target instanceof Element ? event.target : null;
  // Tracking: Space is held for the plan wherever the focus is while the plan is on show. On the canvas, on nothing at all
  // (the body), on a button or a checkbox, inside the editor or outside it (a tab of the library, its refresh button, the
  // app's sidebar): the next press on the canvas pans.
  if (mode !== 'plan' || !root || root.offsetParent === null || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  // Never where Space is text or belongs to an open dialog.
  if (element?.closest(spaceEntry)) return;
  hold(true);
  // Swallowing is the narrower matter: only where Space would scroll the page and is nobody's key, which is inside the
  // editor off its controls, and on the body. A button, a checkbox, a disclosure and everything outside the editor keep
  // their own Space.
  if (element === document.body || (element && root.contains(element) && !element.closest(`${interactive}, summary`))) event.preventDefault();
});
useEffect(() => {
  const release = () => { if (spaceHeld.current) { spaceHeld.current = false; setSpacePan(false); } };
  window.addEventListener('keydown', onSpaceKey, true); window.addEventListener('keyup', onSpaceKey, true); window.addEventListener('blur', release);
  return () => { window.removeEventListener('keydown', onSpaceKey, true); window.removeEventListener('keyup', onSpaceKey, true); window.removeEventListener('blur', release); };
}, [onSpaceKey]);
```

- **어떻게 추적하나**: 창(window) 캡처의 `keydown`·`keyup`과 `blur`. 끌기에 쓴 Alt(:297-311)와 같은 자리, 같은 꼴이다. 포커스가 누르는 도중에 SVG로 옮겨 가도(누르면 SVG가 포커스를 받는다, :587) 떼는 이벤트를 놓치지 않는다. 창이 포커스를 잃으면 푼다(Alt+Tab).
- **추적하는 상태**: 평면 모드이고 편집기가 화면에 보이면(`root.offsetParent !== null`) **포커스가 어디에 있든** 스페이스 `keydown`마다 켠다. 포커스의 자리를 조건에 넣지 않는 까닭 — 아래는 모두 "방금 그 버튼을 눌렀을 뿐"인데 스페이스가 듣지 않으면 안 되는 길이다:
  - 포커스가 아무 데도 없다(`document.body`): '공간 편집'을 누르면 그 버튼이 '취소 / 도면 저장'으로 바뀌어 사라지고(:814) `beginEditing`은 포커스를 옮기지 않으므로(:428-431) 포커스가 `body`로 떨어진다. '도면 저장'·'취소' 뒤, 확인 창이 닫힌 뒤(창을 연 버튼이 사라졌을 때)도 같다.
  - 포커스가 **편집기 밖의 버튼**에 있다: 배경 화면의 탭 버튼('도면 탐색' — 다른 탭에 갔다가 돌아온 직후, `BackgroundLibraryView.tsx:112-125`), 머리줄의 새로고침 버튼(`BackgroundLibraryView.tsx:100-109`), 앱 사이드바의 버튼(접기·펼치기 등, `src/components/layout/Sidebar.tsx`). 모두 편집기 루트(`.bmap-layout`) 밖이다.
  - 포커스가 **편집기 안의 버튼·체크 칸**에 있다: 도구줄 버튼, 속성 칸의 '위치와 속성 잠금' 체크 칸(:967)을 마우스로 누른 직후(그 방이 방금 잠겼으므로, 스페이스가 듣지 않으면 그 위의 끌기는 상자를 그린다).
  - 편집기가 화면에 보이는지는 늘 본다: 편집기는 배경 화면의 다른 탭을 볼 때도 숨겨진 채 붙어 있어서(`BackgroundLibraryView.tsx:137`의 `hidden` → `.bg-tab-content[hidden] { display:none }`, 이때 `offsetParent`가 `null`) 그 탭에서는 추적도 삼키기도 하지 않는다. 배경 화면을 떠나면 편집기가 떼어지므로 리스너도 없다.
- **추적하지 않는 상태**: ① 3D 모드 ② 편집기가 화면에 없을 때(위) ③ **스페이스가 글자이거나 열린 창의 것일 때**(`spaceEntry`, 아래) ④ Ctrl·Meta·Alt와 함께(Alt+Space는 창 메뉴) ⑤ 한글 조합 중. 이 다섯 말고는 없다 — "포커스가 편집기 밖에 있다"는 까닭이 아니다.
- **"스페이스가 글자인 곳"의 뜻**(`spaceEntry` — `event.target.closest(spaceEntry)`가 있으면 추적하지 않는다): 지금의 `textEntry`(`input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog`, :69-72)에서 **스페이스가 체크만 하는 `input`**(`tickInputs` = `type="checkbox"`·`type="radio"`)을 뺀 것이다.
  - 글자 칸으로 치는 `input` = `type`이 `checkbox`도 `radio`도 아닌 모든 `input`: `type`이 없는 것, `text`·`number`·`search`·`file` 등(편집기의 이름 칸·숫자 칸·검색 칸·이름 상자). 모르는 종류는 글자 칸으로 본다(스페이스를 그 칸에 남겨 두는 쪽이 안전하다).
  - `textarea`, `select`(스페이스가 목록을 연다), 고칠 수 있는 `contenteditable`(그 안의 어느 요소든), 열린 `dialog`(그 안의 버튼·체크 칸까지 — 창은 `body` 아래에 따로 붙고, 창이 열려 있는 동안 스페이스는 창의 것이다).
  - **체크 칸은 글자 칸이 아니다.** `textEntry`를 그대로 쓰면 `input`이라는 까닭으로 체크 칸까지 빠져, 잠금 체크 칸을 누른 직후 스페이스가 듣지 않는다. 평면의 다른 단축키(`+ − 0`·F2, :728)는 지금처럼 `textEntry`를 본다 — 이 구분은 스페이스 추적에만 쓴다.
  - `:is(…):not(…)` 꼴로 `textEntry` 위에 지어, 글자 칸의 종류가 늘면 함께 따라온다(Chromium 130이 지원한다). 창 안의 체크 칸은 자신은 빠져도 조상인 `dialog`가 걸리므로 추적하지 않는다.
- **기본 동작 막기(삼키기)**: 둘 중 하나일 때만 `preventDefault`한다 — ⓐ 대상이 `document.body` ⓑ 대상이 **편집기 안**에 있고 버튼·입력 요소·접기 줄(`` `${interactive}, summary` ``)이 아닐 때(캔버스·노드·편집기 바탕). 막지 않으면 페이지가 스크롤되는 좁은 창(① 설계 1.1의 휠과 같은 상황, backgrounds-map.css:250-268)에서 스페이스가 페이지를 내린다.
  - 편집기 안의 **버튼·체크 칸·접기 줄(`summary`)** 은 막지 않는다: 스페이스는 그 요소의 키로 남는다(키보드로 도구를 고르고, 체크 칸을 바꾸고, 줄을 접고 펴는 길을 막지 않는다).
  - **편집기 밖의 요소는 무엇이든 막지 않는다**(버튼이든 스크롤되는 영역이든). 편집기는 자기 밖의 키를 가로채지 않는다.
  - 막지 않을 때도 `spaceHeld`는 켜져 있다(추적은 위의 조건뿐이다). 그래서 버튼이나 체크 칸에 포커스를 둔 채 스페이스를 누르고 캔버스를 끌면 화면이 움직인다.
- **그 버튼·체크 칸은 눌리지 않는다**: 버튼과 체크 칸은 스페이스를 **뗄 때**, 포커스가 아직 자기에게 있으면 눌린다. 스페이스를 누른 채 캔버스를 누르면 그 순간 포커스가 SVG로 가므로(:587) 뗄 때의 대상은 SVG이고, 탭이 바뀌거나 새로고침이 다시 돌거나 잠금이 다시 풀리지 않는다(E10, 16.2). 캔버스를 누르지 않고 스페이스만 눌렀다 떼면 그 버튼·체크 칸은 지금처럼 눌린다(T9).
- 자동 반복 누름은 같은 길을 지난다(다시 켜도 변화 없음, 삼키는 곳에서는 페이지 스크롤을 매번 막는다). 누른 채 포커스가 캔버스로 옮겨 온 뒤의 반복 누름은 캔버스가 대상이라 ⓑ로 막힌다.
- 편집기에 `keyboard()`(:718)의 스페이스 분기는 두지 않는다(같은 규칙을 두 곳에 쓰지 않는다).

### 5.4 보기 모드: 어디를 끌어도 화면이 움직인다

- 보기 모드에서 '선택' 도구의 왼쪽 누름은 **늘 `pan` 세션**이다. 노드 위에서 시작해도 4px을 넘게 끌면 화면이 움직인다(지금은 `click` 모드라 움직이지 않는다, 2.1). 겹친 카메라 위에서 시작한 끌기도 같다.
- **선택은 움직이지 않고 뗄 때 바뀐다**: 노드 위였으면 맨 위의 그것을 고르고(6.1의 `from`이 있으면 — 겹친 카메라에서 이미 고른 것이 있거나, 겹친 공간의 같은 자리를 다시 누른 것이면 — 더미의 다음 것으로 넘어간다. 공간의 더미는 천천히 다시 누른 클릭에만 넘어가고 연속 클릭에는 그대로다, 7.2), 빈 곳이었으면 선택을 푼다. 끌었으면 선택은 그대로다. 여러 개가 선택된 채(저장 뒤) 그중 하나를 눌렀다 떼면 그 하나가 된다.
  - 근거: 지금처럼 누를 때 고르면, 방 위에서 화면을 옮길 때마다 그 방이 선택되고 아래 이미지 그리드가 그 방의 배경으로 바뀐다. 보기 모드는 둘러보는 모드다.
  - 달라지는 점: v1.131.0은 빈 곳을 **끌기만 해도** 선택이 풀렸다(누를 때 풀었다, :601). 이제 끌면 그대로이고, 빈 곳을 **눌렀다 떼야** 풀린다. 완료 보고에 적는다.
- 편집 중의 '선택' 도구는 6.1.

### 5.5 끌기 문턱

지금의 한 줄(:635, 화면 4px)을 그대로 쓴다. 화면 이동·상자·옮기기·그리기 모두 `pointerMove`의 같은 줄을 지나므로 문턱이 종류마다 달라질 수 없다. 새 상수를 만들지 않는다.

### 5.6 커서

- '화면 이동' 도구이거나 스페이스를 누르고 있으면 캔버스와 그 위의 모든 것(노드·손잡이)이 `grab`. 화면을 옮기는 중(어느 길로든 `pan` 세션이 4px을 넘은 뒤)에는 `grabbing`.
- 상태: `spacePan`(위)과 `const [panning, setPanning] = useState(false)` — `pointerMove`가 `pan` 세션의 첫 움직임에 켜고, `pointerUp`·`abortGesture`가 끈다. SVG의 `className`에 `is-space-pan`·`is-panning`을 붙인다(CSS는 10.2).
- `is-space-pan`은 `spacePan && !gestureActive && !marquee`일 때만 붙인다. 방을 옮기거나 상자를 그리는 **도중에** 스페이스를 누르면 그 끌기는 바뀌지 않으므로(5.2) 커서도 손 모양으로 바뀌지 않는다.
- 그리기·기호 도구에서도 같다: 스페이스를 누르고 있으면 바탕의 십자 커서 대신 손 모양이다(CSS의 순서, 10.2).
- '선택' 도구의 커서는 지금 그대로다(바탕은 기본 화살표, 노드 위는 `pointer`). 상자를 그리는 동안에도 바꾸지 않는다.

---

## 6. F6 여러 개 고르기

### 6.1 '선택' 도구의 왼쪽 누름 (`resolvePlanPress`, 순수 함수)

'선택' 도구(보기 모드에서는 `hand`가 아닌 모든 도구 — 지금의 `tool === 'select' || !editing`, :595)의 왼쪽 누름이 손잡이 위가 아니고 5.2의 화면 이동도 아닐 때, 무엇을 할지를 순수 함수 하나가 정한다. 편집기는 그 결과를 실행만 한다.

```ts
// mapPlanSelect.ts
export type PlanPressClick =
  | { kind: 'none' }
  | { kind: 'select'; id: string | null }                              // 그것 하나로 (null: 풀기)
  | { kind: 'toggle'; id: string }                                     // 묶음에 더하기/빼기
  /** 더미의 다음 것으로 — SVG의 click이 실행한다(7.2). `spaces`: the pile is one of spaces, which a repeated click never steps through. */
  | { kind: 'step'; ids: readonly string[]; from: string; spaces: boolean };
export type PlanPressPlan = {
  /** What a drag past the threshold does. */
  drag: 'pan' | 'marquee' | 'move';
  /** `move`: the node the drag is anchored on. */
  nodeId: string | null;
  /** `move`: every selected node that travels along, or null for that one node. */
  groupIds: readonly string[] | null;
  /** A node to select at the press itself. Absent: the selection is left as it is. */
  selectAtPress?: string;
  /** What a release without movement does. */
  click: PlanPressClick;
  /** The node this press counts as for a double-click: the pile member that was already picked, else the node under it. Null on empty canvas. */
  targetId: string | null;
  /** False: the press is no half of a double-click (the press log is emptied). */
  logged: boolean;
};
export function resolvePlanPress(input: {
  canEdit: boolean; shift: boolean;
  /** Topmost node under the press, from the live draft. Null on empty canvas. */
  hit: BackgroundNode | null;
  /** The nodes that take turns at this point (planPileAt). Empty on empty canvas. */
  pile: readonly string[];
  /** The live selection. */
  selection: MapSelection;
  /**
   * The same spot pressed again: the select tool pressed this same topmost node last, and the one node that press
   * left selected is still the selection. Only a pile of spaces asks: without it a space under the top one is no target.
   */
  again: boolean;
  /** A node of the live map. */
  node(id: string): BackgroundNode | undefined;
}): PlanPressPlan;
```

`from`("이 자리에서 이미 골라 둔 더미의 것") = 아래 조건이 **모두** 참일 때의 대표, 아니면 없음.

1. 하나만 선택돼 있다(`selection.ids.length === 1`).
2. 그 대표가 `pile`에 들어 있고 `pile.length > 1`이다.
3. 눌린 것(`hit`)이 **공간이면 `again`이 참**이다. 카메라·기호면 이 조건은 보지 않는다.

- **카메라·기호의 더미는 ①과 같은 조건이다**(1·2뿐). 그 더미는 기준점 12단위 안에 겹친 것들이라 "더미에 들어 있다"가 곧 "같은 자리"이고, 오브젝트 목록에서 고른 아래 카메라가 그 자리의 끌기 대상이어야 한다(① 설계 5.6).
- **공간의 더미에서는 같은 자리를 다시 누를 때만이다**(3). 공간의 더미는 그 점을 품은 공간 **전부**(`spacesAt`)라서, 바깥 공간은 그 안쪽 어디에서나 더미에 든다. 1·2만 보면 바깥 공간 O가 선택돼 있는 동안(복도를 눌러 골랐다, 방금 그렸다, 목록에서 골랐다) 안쪽 방 I를 **처음** 누른 것까지 "O를 다시 누른 것"이 된다: I를 끌면 O가 통째로 움직이고, 세 겹에서 가운데가 선택된 채 맨 위 것을 누르면 더 아래 것이 잡히고, I의 더블클릭이 O에 작용해 연결된 I로 들어갈 수 없다(R8). 승인 문구는 "작은 공간이 먼저 잡힌다 / **같은 자리를** 천천히 **다시** 누르면 아래로"이고, v1.131.0에서도 공간을 누르면 늘 눌린 그 공간이 잡혔다.

**`again`(같은 자리를 다시 누름)** 은 셋이 모두 참일 때다.

1. 편집기가 바로 앞에 받은 캔버스 누름이 **'선택' 도구가 노드를 눌러 그 노드를 고르거나 옮긴 것**이었다. 화면 이동·그리기·손잡이·Shift·빈 곳 누름이 아니고(그런 누름이 끼면 거짓이다), **'선택' 도구의 누름이라도 끌려서 화면 이동(보기 모드에서 노드 위에서 시작한 끌기)이나 상자(잠긴 것 위에서 시작한 끌기)로 끝난 것도 아니다.** 그런 누름은 그 노드를 고르지 않았다 — 화면 이동은 선택을 그대로 두고, 상자는 상자에 닿은 것을 고른다.
2. 그 누름의 맨 위 노드가 이번에 눌린 맨 위 노드와 같다(같은 도면).
3. 그 누름이 남긴 선택 하나(누를 때나 뗄 때 고른 것, 넘겼으면 넘어간 것)가 **지금도 그대로** 유일한 선택이다. 그 사이에 캔버스 밖을 눌렀으면(오브젝트 목록·속성 칸·도구줄·3D) 거짓이고, 키보드로 선택이 다른 것으로 바뀌어 있어도 거짓이다.

1번의 끝 문장이 빠지면 이번에 새로 생기는 기본 동작("보기 모드에서는 어디를 끌어도 화면이 움직인다")이 곧바로 덫이 된다: 바깥 공간 O를 골라 둔 채 안쪽 방 I 위에서 끌어 화면을 옮기면, 선택은 여전히 O인데 "I를 눌렀고 O가 남았다"는 기억이 생긴다. 그다음 I를 누르면 "O를 다시 누른 것"이 되어, 세 겹에서는 더 아래 공간이 잡히고 I의 더블클릭이 O에 작용한다(R8 위반).

편집기는 앞 누름을 `lastSpot` 하나로 들고 있고(1번과 "밖을 눌렀으면"은 그 기억을 쓰고 지우는 자리가 지킨다 — 7.2, 9.1, 9.3), 2·3번의 판정은 순수 함수다:

```ts
// mapPlanSelect.ts
/** What the select tool's last press on a node left behind: the topmost node there, and the one node it left selected (null: none, or several). */
export type PlanSpot = { mapId: string; hitId: string; pickedId: string | null };
/** Whether a press on the topmost node `hitId` of a map is the same spot pressed again: the remembered spot is that node, and the node left selected then is still the one selection. */
export function sameSpotAgain(spot: PlanSpot | null, mapId: string, hitId: string | null, selection: MapSelection): boolean;
```

`sameSpotAgain` = `spot`과 `hitId`가 있고, `spot.mapId === mapId`, `spot.hitId === hitId`, `selection.ids.length === 1`, `selection.primaryId === spot.pickedId`.

| 상황 | `again` | 결과 |
|---|---|---|
| 아무것도 고르지 않았거나 다른 것을 고른 채 겹친 자리를 누름 | 거짓 | 맨 위(가장 작은) 공간이 잡힌다(끌면 그것이 움직인다) |
| 바깥 공간 O를 다른 길로 골라 둔 채(복도를 눌러서 · 방금 그려서 · 목록에서 · 3D에서 · 키보드로) 안쪽 방 I를 누름 | 거짓 | **I**가 잡힌다. 더블클릭도 I에 작용한다 |
| 세 겹에서 가운데 것을 다른 자리에서 골라 둔 채 맨 위 것을 누름 | 거짓 | 맨 위 것 |
| 보기 모드: O(또는 세 겹의 가운데 것)를 골라 둔 채 **I 위에서 끌어 화면을 옮긴 뒤** I를 누름 | 거짓(끌려서 화면 이동이 된 누름은 자리 기억을 남기지 않는다) | **I**(맨 위 것). 더블클릭도 I에 작용한다 |
| 편집 중: 잠긴 방 L 위에서 끌어 상자를 그린 뒤(상자가 다른 것 하나를 골랐다) L을 누름 | 거짓(상자로 끝난 누름도 남기지 않는다) | L이 잡힌다(10번) |
| 방금 누른 그 자리를 다시 누름 | 참 | 천천히 누를 때마다 다음 아래 공간으로(빠른 연속 클릭은 넘기지 않는다 — 7.2). 넘겨서 고른 아래 공간은 그 자리에서 끌 수 있다 |
| 넘겨서 O를 고른 뒤 속성 칸에서 O의 값을 고치고 돌아와 그 자리를 누름 | 거짓(밖을 눌렀다) | 다시 맨 위 것부터 |

**보기 모드**(`canEdit` 거짓. Shift는 보지 않는다)

| 누른 곳 | `drag` | 누를 때 | `click` | `targetId` |
|---|---|---|---|---|
| 빈 곳 | `pan` | — | `select null` | `null` |
| 노드, `from` 있음 | `pan` | — | `step { ids: pile, from, spaces }` | `from` |
| 노드, 그 밖 | `pan` | — | `select hit.id` | `hit.id` |

**편집 중**(`canEdit` 참) — 위에서부터 먼저 맞는 줄

| # | 조건 | `drag` | 누를 때 | `click` | `targetId` · `logged` |
|---|---|---|---|---|---|
| 1 | Shift, 빈 곳 | `marquee` | — | `none` | `null` · 거짓 |
| 2 | Shift, 노드 | `marquee` | — | `toggle hit.id` | `null` · 거짓 |
| 3 | 빈 곳 | `marquee` | — | `select null` | `null` · 참 |
| 4 | 여러 개 선택 중이고 누른 것이 그 안에 있으며 **잠기지 않음** | `move`, `nodeId = hit.id`, `groupIds = selection.ids` | — | `select hit.id`(묶음을 그것 하나로) | `hit.id` · 참 |
| 5 | 〃 **잠김** | `marquee` | — | `select hit.id` | `hit.id` · 참 |
| 6 | `from` 있음, 그 노드가 잠기지 않음 | `move`, `nodeId = from` | — | `step` | `from` · 참 |
| 7 | `from` 있음, 그 노드가 잠김, 누른 것(맨 위)은 잠기지 않음 | `move`, `nodeId = hit.id` | `selectAtPress = hit.id` | `step`(여전히 `from`에서 다음으로) | **`hit.id`** · 참 |
| 8 | `from` 있음, 둘 다 잠김 | `marquee` | — | `step` | `from` · 참 |
| 9 | 그 밖, 누른 것이 잠기지 않음 | `move`, `nodeId = hit.id` | `selectAtPress = hit.id` | `none` | `hit.id` · 참 |
| 10 | 그 밖, 누른 것이 잠김 | `marquee` | — | `select hit.id` | `hit.id` · 참 |

적지 않은 칸은 `nodeId: null`, `groupIds: null`, `logged: true`다. 1·2번은 4번보다 먼저 본다: 묶음에 든 것을 Shift+클릭하면 묶음 이동이 아니라 그것이 묶음에서 빠진다.

두 표의 `step`은 늘 `{ kind: 'step', ids: pile, from, spaces: hit.type === 'space' }`다. 더미는 종류를 섞지 않으므로(7.2) 눌린 것이 공간이면 공간의 더미(`spaces` 참), 카메라·기호면 그 더미(`spaces` 거짓)다. `step`은 "움직이지 않고 떼면 다음 것으로 넘겨 달라"는 **요청**이고, 실제로 넘길지는 뒤따르는 `click`의 클릭 횟수가 정한다: 공간의 더미는 새 클릭 묶음을 시작하는 클릭(`detail` 1)에만 넘어간다(7.2).

결정과 근거(한 줄씩):

- **Shift + 끌기는 어디서 시작하든 상자**(1·2): 승인 문구 "Shift를 누른 채 끌어 그 위에서도 상자를 그린다". 그 상자의 결과는 Shift 없이 그린 상자와 같다 — 닿은 것으로 선택을 **바꿔 넣는다**(아무것도 닿지 않으면 풀린다). 지금 선택에 더하는 상자는 넣지 않는다(1.2): 승인 문구에 없고, 승인 문구가 말하는 바로 그 상황에서 덫이 된다. 화면을 덮은 큰 공간 O는 대개 선택돼 있는데(빈 곳처럼 보이는 데를 누르면 O가 잡히고, 방금 그렸어도 선택돼 있다), 더하는 상자로 의자들을 감싸면 묶음이 `[O, 의자들]`이 되고 의자 하나를 끄는 순간 O와 그 안의 모든 것이 함께 끌려간다.
- **Shift + 클릭은 눌린 맨 위 노드를 더하거나 뺀다**(2): 승인 문구 그대로. 더미의 아래 것이 아니라 눈에 보이는 맨 위 것이다(`from`을 보지 않는다). Shift 누름은 더블클릭의 반쪽이 아니다(두 번 누르면 더했다가 뺀다).
- **빈 곳을 끌면 상자, 눌렀다 떼면 선택 해제**(3): 승인 문구. 누르는 순간에는 풀지 않는다(끌면 상자의 결과가 선택이 된다).
- **묶음에 든 것을 누르면 묶음을 유지한 채 끌 수 있고, 움직이지 않고 떼면 그것 하나로 접힌다**(4): 누를 때 접으면 묶음을 끌 수 없고, 뗄 때도 접지 않으면 묶음에서 하나를 고를 길이 없다.
- **잠긴 것 위에서 끌면 상자**(5·8·10): 잠긴 것은 움직이지 않으므로 그 위의 끌기는 지금 아무 일도 하지 않는다. 승인 문구 "그 공간을 잠가 두거나 … 그 위에서도 상자를 그린다". 잠긴 것은 **뗄 때** 선택된다(끌면 상자의 결과가 선택이 된다).
- **이미 고른 아래 것이 끌기의 대상**(6): ①의 카메라 더미와 같은 규칙이 공간에도 선다 — 공간에서는 **같은 자리를 다시 눌러 넘겨 둔 것**에 한해서다(`from`의 3번 조건). 넘겨서 고른 아래 공간을 그 자리에서 끌 수 있어야 한다(아래 공간이 드러난 자리가 화면 밖일 수 있다). 다른 길로 골라 둔 바깥 공간은 여기에 들지 않는다: 그때 안쪽 방을 끌면 9번으로 안쪽 방이 움직인다.
- **잠긴 것은 끌기의 대상이 되지 않는다**(7): 넘겨서 고른 아래 공간(또는 목록에서 고른 아래 카메라)이 잠겨 있으면, 그 자리의 끌기는 맨 위의 것을 옮긴다(잠긴 것이 대상이면 상자가 나와 버린다). 움직이지 않고 떼면 넘기기는 정확히 `from`의 다음으로 간다 — 잠긴 것이 가운데 낀 세 겹에서도 맨 아래까지 넘어간다. 더블클릭의 대상(`targetId`)도 이 경우에는 누른 맨 위 것이다(잠긴 것은 이름을 고칠 수 없다). 바깥 공간을 고른 뒤 속성 칸에서 잠그고 안쪽 방을 끄는 흔한 길은 처음 누름이라(`again` 거짓) 9번이다: 안쪽 방이 선택되고 움직인다.
- **여러 개 선택 중에는 `from`을 보지 않는다**: 묶음에 든 것이 다른 것 아래에 가려진 자리를 누르면 위의 것이 잡힌다(4번이 아니면 9·10번). 묶음을 끌 때는 묶음에 든 것이 맨 위에 보이는 자리를 잡는다. 규칙을 하나 줄인다.
- 6~8번은 공간의 더미와 카메라·기호의 더미에 같은 표로 선다(`from`이 서는 조건만 다르다). 카메라·기호 더미에서 ①과 달라지는 것은 골라 둔 것이 **잠겨 있을 때**뿐이다(①에서는 그 자리를 끌어도 아무 일이 없었다. 이제 7번은 맨 위의 것을 옮기고 8번은 상자를 그린다). 넘기기의 순서와 더블클릭은 ①과 같다.

### 6.2 상자

**상태**: 편집기의 `const [marquee, setMarquee] = useState<PlanRect | null>(null)`. 세션 모드 `marquee`는 `pan`과 같은 부류다 — 문서 제스처를 열지 않고(`beginGesture` 없음), 되돌리기 단계가 없고, 초안을 건드리지 않는다(R5).

**좌표**: 누른 점과 지금 점을 **도면 좌표**로 들고 있는다(`pointFrom(event, session.matrix)` — 누른 순간의 변환, 다른 끌기와 같다). 평면 SVG는 돌아가지 않고 가로·세로 배율이 같으므로(`viewBox`, :841) 도면 좌표의 축 정렬 상자가 곧 화면의 축 정렬 상자다. SVG 안에 `<rect>`로 그리므로 확대·위치를 따로 계산하지 않는다. 끄는 동안에는 보기 값이 바뀌지 않는다(휠은 누르고 있는 동안 무시된다, :261. `+ − 0`과 '맞춤'도, :709, :715). 선의 굵기와 점선은 `vector-effect: non-scaling-stroke`로 화면 크기가 같다. 여유(패딩)는 두지 않는다 — 화면 거리는 5.5의 문턱 하나뿐이다.

```ts
// mapPlanSelect.ts
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

**"닿았다"의 정의** (상자는 닫힌 상자다 — 가장자리에 걸친 것도 닿은 것이다)

| 종류 | 판정 | 근거 |
|---|---|---|
| 공간 — 사각형·다각형 | **윤곽선**(벽)이 상자와 만난다: `nodePlanOutline(space)`(mapSpatial.ts:239-256, 회전이 들어간 절대 좌표)의 닫힌 변 가운데 하나라도 상자와 만나면 참. 변–상자는 선분을 상자로 잘라(Liang–Barsky) 남는 것이 있는지로 본다 | 아래 |
| 공간 — 타원 | 정확히 잰다. 상자의 네 꼭짓점을 타원의 자기 좌표로 옮긴다: `u = rotate(p − 가운데, −rotation)`, `q = (u.x / (width/2), u.y / (height/2))`. `near` = 원점에서 그 네 점이 이루는 볼록 사각형(속 포함)까지의 거리(원점이 안이면 0), `far` = 네 점 가운데 원점에서 가장 먼 거리. **`near ≤ 1 && far ≥ 1`** 이면 참 | 윤곽(단위원)이 상자와 만나는 것과 같다. 48각형 근사를 쓰지 않는다 |
| 기호 | **넓이**가 상자와 겹친다. 기호의 자기 상자(가운데에서 `±width/2, ±height/2`를 `rotation`만큼 돌린 네 점 — 평면이 그리고 누름을 받는 그 상자, :862)의 변이 상자와 만나거나, 상자의 한 꼭짓점이 그 사각형 안이면 참. 기울인(pitch·roll) 기호가 드리우는 점선 윤곽(:859)은 세지 않는다 | 기호는 누를 수 있는 곳과 상자에 잡히는 곳이 같다 |
| 카메라 | 몸통 원이 상자와 겹친다: 카메라 점에서 상자까지의 거리(안이면 0)가 `MAP_EDIT_MARK.cameraBody`(12, 도면 단위) 이하. 수직으로 보는 카메라는 고리 `MAP_EDIT_MARK.cameraRing`(18). **부채꼴은 세지 않는다** | 카메라만 "누를 수 있는 곳"과 다르다: 부채꼴은 눌리지만(채움이 있고 카메라 `<g>` 안이다, :874-878 · backgrounds-map.css:60 · `planMarkCovers`) 상자에는 세지 않는다. 부채꼴(반지름 80)까지 세면 옆의 것을 고르려던 상자가 카메라를 늘 끌고 오고, 그대로 끌면 카메라가 함께 움직인다. 완료 보고에 적는다(16절) |
| 좌표가 유한하지 않은 노드·상자 | 거짓 | — |

**공간은 벽에 닿아야 잡힌다.** 상자가 벽을 가로지르거나 공간을 통째로 감싸면 그 공간이 잡히고, 상자가 **공간 안쪽에만** 그려지면 그 공간은 잡히지 않는다.

- 근거: 가구와 카메라는 늘 방 안에 있고, 방은 건물 외곽 안에 있다. 넓이로 재면 의자 넷을 고르려는 상자가 그 방과 건물 외곽까지 늘 함께 잡고, 그대로 끌면 방과 건물이 통째로 움직인다. 그러면 여러 개 고르기는 방을 일일이 잠가 둔 뒤에만 쓸 수 있다. 승인 문구의 "큰 공간이 화면을 덮고 있으면 … Shift를 누른 채 끌어 그 위에서도 상자를 그린다"도 그 큰 공간을 고르려는 것이 아니라 그 위의 것들을 고르려는 것이다.
- 따라 나오는 것: 방 하나만 있는 곳에서 그 방 안에 작은 상자를 그리면 아무것도 잡히지 않는다(방은 눌러서 고른다).
- 승인 문구는 "상자에 닿은 것이 모두"라고만 한다. 이 규칙은 그 문구의 해석이므로 **구현 전에 한솔에게 확인한다**(1.1의 Q1, 16절). 답이 "넓이가 겹치면 고른다"로 오면 바뀌는 곳은 `planRectTouches`의 공간 두 줄(사각형·다각형, 타원)과 그 테스트뿐이다: 벽 판정에 "상자의 한 꼭짓점이 공간 안"(`containsPoint`)을 더한다.

**잠긴 노드도 상자에 잡힌다.** 근거: 승인 문구는 "상자에 닿은 것이 모두"이고, 잠긴 것 여럿을 한꺼번에 풀려면 고를 수 있어야 한다. 잠긴 것은 묶음 이동에서 제자리에 있고 묶음 삭제에서 남으므로(6.3, 6.4) 잡혀도 잃는 것이 없다. 잠가 둔 큰 공간은 위의 벽 규칙 때문에 그 안에 그린 상자에는 어차피 잡히지 않는다.

**끄는 동안**: `pointerMove`가 `setMarquee(planRect(session.start, point))`. 상자를 그리고(10.1), 닿은 것을 **선택된 모양으로 미리 보여 준다** — `marqueeIds = planMarqueeIds(current, marquee)`를 렌더에서 구해 강조만 한다(9.4). 문서의 선택은 떼기 전까지 바뀌지 않는다(속성 칸·이미지 그리드가 끄는 동안 출렁이지 않는다).

**뗄 때**(움직였고, 취소가 아니고, `canEdit`): 살아 있는 초안에서 `planMarqueeIds`를 다시 구해 `doc.selectMany(mapId, ids)` — Shift를 누른 채 그렸든 아니든 닿은 것으로 바꿔 넣는다. 대표는 그 목록의 마지막(배열 순서로 맨 뒤의 것)이다. 움직이지 않았으면 6.1의 `click`.

**취소**: Esc(6.6), 포인터 취소·캡처를 잃음, 다른 도면·모드 전환·저장 시작(`abortGesture`)은 상자를 지울 뿐이다. 되돌릴 것이 없다.

### 6.3 묶음 이동

**한 번의 제스처, 한 번의 되돌리기.** 6.1의 4번으로 시작한 `move` 세션은 `groupIds`를 들고, `planGestureOf`가 새 제스처 꼴로 넘긴다.

```ts
// mapPlanGesture.ts
export type PlanGesture =
  | { mode: 'move' | 'resize' | 'rotate'; nodeId: string }
  /** Several selected nodes moved as one. `nodeId` is the pressed one. */
  | { mode: 'move-group'; nodeId: string; ids: readonly string[] }
  | { mode: 'draw'; node: BackgroundSpace }
  | { mode: 'vertex'; nodeId: string; index: number; insert: boolean };

// mapGeometry.ts
/**
 * Moves several nodes by one delta in one step. Locked nodes stay. A space carries its unlocked members as in
 * moveMapNode, and a listed node that such a space carries is not moved a second time. With `anchor`, that node's
 * stored x/y become exactly `anchor.position` instead. Returns `map` itself when nothing moves.
 */
export function moveMapNodes(map: BackgroundMap, ids: readonly string[], delta: BackgroundPoint,
  anchor?: { id: string; position: BackgroundPoint }): BackgroundMap;
```

`moveMapNodes` 규칙:

1. 움직이는 것 = `ids`에 있고 도면에 있으며 **잠기지 않은** 노드. 없으면 `map` 그대로.
2. 갈 자리 = `anchor`의 노드면 `anchor.position`, 아니면 저장 x·y에 `delta`를 더한 값.
3. 움직이는 **공간**마다 `transformMapSpace(지금까지의 도면, { ...space, 갈 자리 })`를 한 번씩 부른다. 그 공간의 잠기지 않은 소속 항목은 여기서 **한 번** 실려 간다(묶음에 들어 있든 아니든). 잠긴 소속 항목은 남는다(묶음에 들어 있어도).
4. 그다음, 움직이는 것 가운데 공간이 아니고 **3에서 실려 가지 않은 것**(자기 공간이 움직이는 공간이 아닌 것)만 갈 자리로 옮긴다.
5. 따라서: 공간 + 그 공간의 의자를 함께 골라도 의자는 한 번만 간다. 잠긴 공간 + 그 안의 잠기지 않은 의자를 골랐으면 공간은 남고 의자는 간다. id 하나만 주면 `moveMapNode(map, id, delta)`와 같은 값이다.

`previewPlanGesture`의 `move-group` 분기:

```ts
// 묶음에서 실제로 움직이는 것: 도면에 있고 잠기지 않은 것(도면 순서)
const moving = initial.nodes.filter(node => gesture.ids.includes(node.id) && !node.locked).map(node => node.id);
if (!moving.length) return { map: initial, guides: [] };
const anchorId = groupAnchorId(initial, moving, gesture.nodeId);
const stuck = snap && snapMove(initial, moving, anchorId, delta, snap.candidates, snap.tolerance, snap.reach);
return stuck ? { map: moveMapNodes(initial, moving, stuck.delta, { id: anchorId, position: stuck.position }), guides: stuck.guides }
  : { map: moveMapNodes(initial, moving, delta), guides: [] };
```

- `groupAnchorId`(모듈 안의 함수): 누른 노드. 다만 누른 것이 움직이는 공간에 **실려 가는** 항목(자기 공간이 `moving` 안의 공간)이면 그 공간이 기준이다(실려 가는 항목의 저장 값은 직접 놓을 수 없다). 누른 것이 `moving`에 없으면 `moving[0]`.
- `planGestureCandidates`의 `move-group`: `collectSnapCandidates(initial, snapTravellingIds(initial, moving))` — 묶음과, 묶음의 공간이 실어 나르는 것을 뺀 전부. 묶음에 든 **잠긴** 것은 제자리에 있으므로 붙는 대상이다.

**묶음의 스냅**(기존 `snapMove` 그대로, mapSnap.ts:154-174):

- 붙는 선: 움직이는 것들의 스냅 상자(`nodeSnapBox`)를 **합친 상자**의 시작·가운데·끝. 묶음 안의 노드끼리는 서로에게 붙지 않는다.
- 닿는 거리: 움직이는 것들이 차지한 범위(`nodeSnapSpan`)를 합친 상자에서 잰다(화면 48px, `MAP_SNAP.reachPx`).
- 안내선: 붙은 축마다 한 줄, 놓인 합친 상자와 대상을 잇는다.
- 값: 붙은 축은 기준 노드의 저장 값이 `대상 − 떨어진 거리`가 되고, 붙지 않은 축은 **기준 노드의 저장 값만** 정수가 된다. 나머지는 기준과 같은 만큼(`stuck.delta`) 움직여 **서로의 간격이 그대로다**(하나씩 따로 정수로 맞추면 간격이 달라진다). 그래서 기준이 아닌 노드에는 소수가 남을 수 있고, 붙은 가장자리가 기준이 아닌 노드의 것이면 대상과 부동소수 오차 범위(1e-9)에서 같다.
- Alt 또는 '스냅' 끔: `moveMapNodes(initial, moving, delta)` 그대로(붙지 않고 맞추지도 않는다).

편집기: `pointerDown`이 `doc.beginGesture` 한 번, `pointerMove`가 미리보기, `pointerUp`이 `finishGesture` 한 번(9절). 끌기가 끝난 뒤의 "끈 것을 다시 선택"(:667)은 **묶음 이동에서는 하지 않는다**(묶음이 접힌다).

### 6.4 묶음 지우기 · 잠그기

```ts
// mapGeometry.ts
/**
 * Removes the listed nodes in one step. Locked nodes stay, as in moveMapNodes. Members of a removed space that stay
 * are detached from it, as in removeMapNode. Returns `map` itself when nothing is removed.
 */
export function removeMapNodes(map: BackgroundMap, ids: readonly string[]): BackgroundMap;
/** Sets the lock of every listed node that differs. Returns `map` itself when nothing changes. */
export function lockMapNodes(map: BackgroundMap, ids: readonly string[], locked: boolean): BackgroundMap;
```

**지우기**

- 대상: 묶음 가운데 **잠기지 않은 것**. 잠긴 것은 남는다(하나일 때도 잠긴 노드는 지울 수 없다, :750, :970). **이 규칙은 순수 함수 안에 있다**: `removeMapNodes`가 잠긴 것을 건너뛴다(`moveMapNodes`와 같은 자리. 단위 테스트가 잡는다, 12.5). 편집기는 묶음 전체를 넘기기만 한다. 하나를 지우는 `removeMapNode`는 그대로다(잠금은 지금처럼 부르는 쪽이 본다).
- 길: Delete 키(6.6) 또는 요약의 버튼 → `setConfirmation('delete-group')`(확인 상태의 합집합 :202에 `'delete-group'`을 더한다) → 확인 → `settle()`로 진행 중인 것을 정리한 도면에서 `const next = removeMapNodes(source, selection.ids); updateMap(next)` **한 번**(되돌리기 한 단계) → `doc.selectMany(current.id, selection.ids.filter(id => next.nodes.some(node => node.id === id)))`(잠겨서 남은 것이 선택된 채 남는다. 없으면 선택이 풀린다) → `focusAfterConfirm.current = true; setConfirmation(null)`.
- **끝난 뒤의 포커스는 캔버스다.** 확인 창이 닫히면 창은 열기 전에 포커스가 있던 곳으로 돌려준다(`BackgroundUI.tsx:32-34`). Delete 키로 열었으면 그곳이 캔버스라 문제가 없지만, 요약의 삭제 버튼으로 열었으면 그 버튼은 요약과 함께 사라졌거나 비활성이 되어 포커스가 `body`에 남고, 바로 뒤의 Ctrl+Z가 닿을 곳이 없다(`keyboard()`는 편집기 안의 키만 듣는다, :802). 창이 열려 있는 동안에는 창 밖에 포커스를 줄 수 없으므로(모달 `<dialog>`), **창이 사라진 뒤에** 준다:
  ```ts
  /** Set by a group delete: once its confirmation is gone, the keyboard goes back to the canvas. */
  const focusAfterConfirm = useRef(false);
  useEffect(() => { if (!confirmation && focusAfterConfirm.current) { focusAfterConfirm.current = false; focusCanvas(); } }, [confirmation]);
  ```
  (창의 정리 함수가 먼저 돌고 이 효과가 그다음에 돈다.) 하나를 지우는 지금의 길(`'delete-node'`)은 건드리지 않는다.
- 확인 창: 제목 `` `선택한 ${n}개 삭제` ``(n = 지워질 개수). 본문:
  `` `선택한 배치 ${n}개를 지웁니다. 공간을 지우면 함께 고르지 않은 카메라와 사물 기호는 도면에 남고 공간 연결만 해제됩니다. 원본 장소와 배경은 유지됩니다.` ``
  잠긴 것이 m개(> 0)면 뒤에 `` ` 잠긴 ${m}개는 지워지지 않습니다.` ``. 버튼은 지금과 같다(`돌아가기` / `삭제`).
- 지워질 것이 없으면(모두 잠김) 확인 창을 열지 않고 버튼은 비활성이다.
- 하나를 지우는 길(`'delete-node'`, :452-456)은 **코드 그대로다**(지운 뒤의 `select(null)`, :455 포함). 평면에서는 하나만 골랐을 때만 이 길이 열리고 지금처럼 선택이 풀린다. 3D에서 여러 개가 선택된 채 3D의 하나를 지우면 그 `select(null)`이 `pick-one(null)`이 되어(6.7 — `select`는 그 렌더의 `selection`, 곧 지우기 전의 묶음을 읽는다) 3D의 하나만 비고 `selectedIds`는 그대로다. 지운 id는 읽을 때 빠지므로 묶음의 나머지가 남는다(3.4).

**잠그기 · 풀기**

- 요약의 버튼 둘: `모두 잠그기`(잠기지 않은 것이 있을 때만 활성) → `updateMap(lockMapNodes(current, selection.ids, true))`, `잠금 풀기`(잠긴 것이 있을 때만 활성) → `…false`. 각각 `update` 한 번 = 되돌리기 한 단계.
- **두 버튼 모두 끝에 `focusCanvas()`를 부른다.** 누른 버튼은 제 할 일이 끝나는 순간 비활성이 된다(잠글 것·풀 것이 남지 않는다). 포커스가 그 버튼에 남으면 Ctrl+Z·Delete가 듣지 않는다(`keyboard()`는 포커스가 버튼에 있으면 그 키들을 넘긴다, :734). 편집기의 `onLock`: `locked => { updateMap(lockMapNodes(current, selection.ids, locked)); focusCanvas(); }`.
- 공간을 잠그는 것은 좌표를 바꾸지 않으므로 소속 항목은 그대로다.

### 6.5 속성 칸 (묶음 요약) — `BackgroundMapSelectionSummary.tsx`, 새 파일

평면에서 여러 개가 선택됐을 때(`mode === 'plan' && multiple`) 속성 칸의 양식 자리에 **요약 하나**를 보인다. 노드마다의 양식 N개를 늘어놓지 않는다.

```tsx
export function BackgroundMapSelectionSummary({ nodes, canAct, disabled, onClear, onLock, onDelete }: {
  nodes: readonly BackgroundNode[];
  /** Editing on the plan: the group actions are offered. */
  canAct: boolean; disabled: boolean;
  onClear(): void; onLock(locked: boolean): void; onDelete(): void }): JSX.Element;
```

| 자리 | 내용 |
|---|---|
| 머리 | `여러 개 선택`(`.bmap-eyebrow`) + `×` 버튼(`aria-label="선택 해제"`, 지금의 :916과 같은 모양) → `select(null)` |
| 제목 | `` `${nodes.length}개 선택` ``(`.bmap-selected-name`) |
| 구성 | `공간 2 · 기호 3 · 카메라 1`(0인 종류는 뺀다). 잠긴 것이 있으면 뒤에 `` ` · 잠긴 것 ${m}` `` |
| 안내(`canAct`) | `고른 것 가운데 하나를 끌면 함께 옮겨져요. 잠긴 것은 제자리에 있어요.` |
| 버튼 줄(`canAct`, `.bmap-symbol-actions`의 두 칸 격자를 그대로 쓴다) | `모두 잠그기` · `잠금 풀기` |
| 삭제(`canAct`) | `` `선택한 ${n}개 삭제` ``(`.bmap-text-button.bmap-danger`, n = 잠기지 않은 개수, 0이면 비활성) |
| 안내(`canAct`) | `크기와 회전은 하나만 골랐을 때 바꿀 수 있어요.` |

- `canAct` = `canEdit`(평면에서만 이 요약이 보이므로 모드 조건은 겹친다). 보기 모드에 남은 여러 개 선택(저장 뒤)은 머리·제목·구성만 보인다.
- 그 아래의 오브젝트 목록은 그대로 이어진다.
- **3D에서 여러 개가 골라져 있을 때**(`mode === '3d' && multiple`): 속성 칸은 지금처럼 3D의 하나의 양식이고, 3D에서 빈 곳을 눌렀거나 `×`로 비웠으면 지금처럼 도면 구성이다. 어느 쪽이든 **속성 칸 맨 위**(`<aside className="bmap-inspector">`의 첫 줄, :914 바로 안)에 한 줄을 더한다: `` `평면에서 고른 ${n}개는 그대로 있어요. 3D에서는 하나씩만 다루고, 평면으로 돌아가면 ${n}개가 다시 선택돼 있어요.` ``(`.bmap-hint`, `n = selection.ids.length`). 양식의 `×`(:916)는 지금처럼 `select(null)`이다: 3D의 하나만 비우고 묶음은 그대로다(6.7). 3D 모드에는 묶음을 푸는 버튼을 두지 않는다(1.2).

### 6.6 키보드

| 키 | 하나 선택 | 평면 · 여러 개 선택 | 3D · 여러 개 선택 |
|---|---|---|---|
| Delete | 지금과 같다(고른 점 → 노드 삭제 확인) | 편집 중이고 잠기지 않은 것이 있으면 `'delete-group'` 확인 | 3D의 하나만(지금의 길. 3D의 하나가 없으면 아무 일도 없다). 묶음의 나머지는 남는다(6.4) |
| Esc | 지금과 같다(선택을 풀지 않는다) | 지금과 같다(선택을 풀지 않는다). 상자를 그리는 중이면 상자만 취소 | 지금과 같다 |
| F2 · Ctrl+D | 지금과 같다 | 아무 일도 없다(`selected`가 없다) | 3D의 하나에 지금처럼(F2는 평면 전용이라 무동작. Ctrl+D로 만든 복제는 3D의 하나가 되고 묶음은 그대로다) |
| Ctrl+Z · Ctrl+Y | 지금과 같다 | 지금과 같다(선택은 3.4대로) | 지금과 같다 |
| Shift | — | 누름의 뜻만 바꾼다(6.1) | — |
| Ctrl+A | 넣지 않는다(1.2) | 넣지 않는다 | 넣지 않는다 |

**Esc의 우선순위**(위에서부터, 한 번 누를 때 하나의 단계만):

1. 이름 칸이 열려 있으면 그 칸이 먹는다(지금과 같다, BackgroundMapNameBox.tsx:50).
2. 문서 제스처가 진행 중이면 취소한다(지금과 같다, :289-295, :722).
3. **상자를 그리는 중이면 상자만 취소한다**(`pointerRef.current?.mode === 'marquee'` → `abortGesture()`).
4. 지금의 되돌림: 그리던 다각형·도구·기호 팔레트·고른 점(:723).

**Esc는 선택을 풀지 않는다 — 하나든 여러 개든.** 승인 문구에 없는 동작이다(1.2). 여러 개 선택은 요약의 `×`(6.5), 빈 곳을 눌렀다 떼기(6.1의 3번), 다른 것 누르기로 푼다. 새로 생기는 것은 3번 하나다: 상자도 진행 중인 끌기이므로 다른 끌기처럼 Esc로 취소된다.

`keyboard()`(:718-751)에서 바뀌는 두 곳:

```ts
if (event.key === 'Escape') {
  if (event.nativeEvent === handledEscape.current) return;
  // A drag in progress, a marquee included, is cancelled first; the tool is left as it is.
  if (pointerRef.current?.mode === 'marquee' || doc.isGestureActive()) { abortGesture(); return; }
  setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setActiveVertex(null);     // 지금 그대로. 선택은 건드리지 않는다
}
// …고른 점을 지우는 분기(:740-747)는 그대로. 그 아래의 노드 삭제 줄(:750)을 다음으로:
if (event.key === 'Delete' && !event.repeat && canEdit && !pointerRef.current && !doc.isGestureActive()) {
  if (selected && !selected.locked) { event.preventDefault(); setConfirmation('delete-node'); }
  else if (mode === 'plan' && multiple && groupNodes.some(node => !node.locked)) { event.preventDefault(); setConfirmation('delete-group'); }
}
```

Delete는 지금처럼 버튼·입력 칸에 포커스가 있을 때는 듣지 않는다(:734의 가드 뒤에 있다).

### 6.7 3D와 보조 평면도

- `Map3D`와 `BackgroundMapPlanPreview`에는 `selectedId={singleId}`를 넘긴다(:896, :903. `singleId`는 3.5). `mapCanvas.ts`의 계약은 그대로다. 3D는 그 하나만 강조하고 기즈모를 붙인다. 여러 개를 고른 채 3D로 막 넘어왔을 때 그 하나는 대표다.
- 3D에서 일어나는 편집(기즈모·속성 칸·Delete·시점 보기)은 3D의 하나에만 닿는다. 저장된 목록은 줄지 않는다(지운 노드의 id가 읽을 때 빠질 뿐이다).
- **3D 모드에서 하는 고르기는 묶음을 건드리지 않는다 — 한 곳에서 지킨다.** 3D 모드에서 하나를 고르는 길은 열한 가지이고(3.4의 목록: 두 화면의 클릭, 오브젝트 목록, `×`, 카메라 추가, 기호 놓기·복제 …) 모두 편집기의 `select(id)`를 지난다. 길마다 따로 막지 않고 그 함수 하나를 바꾼다:
  ```ts
  /**
   * Picks one node, or none. On the plan that is the selection. In 3D, while several are selected on this map, it is
   * only the node the 3D view works on: the group picked on the plan is left as it is (pickAction).
   */
  function select(id: string | null, mapId = current?.id) {
    if (mapId) doc.dispatch(pickAction(mapId, id, mode === '3d' && mapId === current?.id, selection));
  }
  ```
  - `selection`은 그 렌더의 살아 있는 선택(3.5)이다. 같은 처리기 안에서 도면을 먼저 고친 뒤 `select`를 부르는 길(카메라 추가, 기호 놓기·복제, 하나 삭제)은 고치기 **전의** 묶음으로 판정한다: 둘이던 묶음에서 하나를 지운 직후에도 `pick-one`이라 남은 하나가 선택에서 떨어지지 않는다(6.4).
  - 다른 도면을 가리키는 호출(`select(null, childId)`, :500)은 늘 `select` 액션이다(이 렌더의 `selection`은 지금 도면의 것이다).
  - `selectNode`·`clearSelection`(:754-755)은 그대로이고, `<Map3D … onSelect={selectNode}`, `<BackgroundMapPlanPreview … onSelect={selectNode} />`, `<ObjectList … onSelect={selectNode} />`도 v1.131.0 그대로다. 평면 모드에서는 `select`가 늘 `select` 액션을 보내므로 평면의 동작은 6.1대로다.
  - 편집기에서 `doc.select(`를 직접 부르는 곳은 없어진다(지금도 `select` 한 곳뿐이다, :335).
- **두 화면이 알려 주는 id는 눌린 노드가 아니다.** `onSelect`로 오는 것은 넘기기를 거친 결과다: 강조된 카메라·기호가 같은 자리에 겹친 것들 가운데 하나면 그것을 누를 때마다(3D의 평범한 클릭, 손잡이를 끌지 않고 누른 클릭, 보조 평면도의 클릭 모두) 다음 것이 오고, 강조된 공간을 같은 자리에서 천천히 다시 누르면 아래 바닥이 온다(7.3, 7.4). 새 카메라는 늘 한 자리에 생기므로 겹친 카메라는 흔한 상태다. 그래서 "강조된 대표를 눌렀으면 그대로, 묶음 밖이면 새 선택" 같은 판정을 두지 않는다 — 대표가 겹친 카메라면 대표를 한 번 누른 것이 "묶음 밖의 카메라"로 보고되어 묶음이 접힌다. 여러 개가 선택돼 있는 동안에는 무엇이 오든 3D의 하나만 바뀐다:

  | 3D·보조 평면도에서 한 일(여러 개 선택 중) | 3D의 하나 | 묶음(`selectedIds`) |
  |---|---|---|
  | 강조된 것을 누름(겹친 것이 없다) | 그대로(`pick-one`이 같은 id라 아무 일도 없다) | 그대로 |
  | 강조된 카메라·기호를 누름(같은 자리에 겹친 것이 있다) · 그 손잡이를 끌지 않고 누름 | 겹친 다음 것(묶음 안이든 밖이든) | 그대로 |
  | 강조된 공간을 같은 자리에서 천천히 다시 누름 | 아래 바닥의 공간 | 그대로 |
  | 강조된 공간을 같은 자리에서 빠르게 다시 누름(연속 클릭) | 그대로(넘어가지 않는다. 연결된 공간이면 더블클릭이 들어간다) | 그대로 |
  | 묶음 안의 다른 것 · 묶음 밖의 것을 누름 | 그것 | 그대로(순서도 대표도) |
  | 빈 바닥·보조 평면도의 바탕을 누름 | 없음 | 그대로 |
  | 더블클릭으로 연결된 공간에 들어감 | 그 공간(7.2의 `openSpace`) | 그대로 |
- 하나 이하가 선택돼 있을 때는 지금과 같다: `select`가 `select` 액션을 보내고, 3D에서 고른 것이 곧 선택이다(같은 것을 다시 누르면 리듀서가 받은 상태를 그대로 돌려준다, 3.2).
- 오브젝트 목록도 같은 `selectNode`다: 평면에서는 그것 하나로 바꿔 넣고(묶음이 풀린다, 1.2), 3D 모드에서 여러 개가 선택돼 있으면 3D의 하나만 바뀐다. 3D 모드의 목록은 3D의 하나인 줄만 강조한다(10.1).
- 평면으로 돌아오면 `selected`가 물러서고 묶음 전체가 다시 강조된다. 전환 자체는 아무것도 부르지 않는다. 3D에서 새로 고른 것(묶음 밖의 것, 새로 만든 카메라·기호)은 평면의 선택에 들지 않는다(완료 보고, 16.3).

### 6.8 경계 상황

| 상황 | 동작 |
|---|---|
| 상자가 아무것에도 닿지 않음 | 선택이 풀린다(Shift를 누른 채 그렸어도 같다) |
| 큰 공간 O가 선택된 채 Shift+상자로 의자들을 감쌈 | 의자들만 선택된다(O는 벽이 닿지 않아 빠지고, 상자는 바꿔 넣는다). 의자를 끌어도 O는 움직이지 않는다 |
| 묶음에 든 것을 Shift+클릭 | 그것이 묶음에서 빠진다(묶음 이동이 시작되지 않는다). 둘이던 묶음이면 하나가 남아 손잡이가 다시 보인다 |
| 그린 공간을 되돌리기로 없앤 뒤 다른 것을 Shift+클릭하고 다시 실행 | 선택은 Shift+클릭한 그 하나다. 돌아온 공간이 묶음에 끼어들지 않는다(3.2) |
| 보기 모드에서 여러 개가 선택된 채(저장 뒤) 그중 하나를 눌렀다 뗌 | 그 하나가 된다(넘기지 않는다 — `from`은 하나만 선택됐을 때의 것이다) |
| 여러 개를 고른 채 3D로 가서 묶음 밖의 것을 누름 / 빈 바닥을 누름 / 목록에서 고름 / 카메라를 추가함 → 평면으로 | 3D에서는 그때그때 그 하나(또는 없음)만 강조된다. 평면으로 돌아오면 처음의 묶음이 그대로 선택돼 있고, 3D에서 고르거나 만든 것은 선택에 없다(6.7) |
| 여러 개를 고른 채 3D로 가서 강조된 카메라를 누름 — 같은 자리에 카메라가 셋 | 3D의 하나가 다음 카메라로 넘어간다(누를 때마다). 묶음은 그대로다 |
| 둘을 고른 채 3D로 가서 그중 하나를 지움 | 남은 하나가 곧 선택이다: 3D가 바로 그것을 강조하고, 평면으로 돌아와도 그것 하나다. 다른 것을 고르기 전에 되돌리면 둘이 다시 묶음이다 |
| 여러 개를 고른 채 3D로 갔는데 대표가 되돌리기로 사라져 있음(방금 그린 공간까지 상자로 고른 뒤 Ctrl+Z) | 3D는 남은 것들의 대표를 강조한다(3.3의 `singleViewId` 넷째 줄) |
| 상자 안에 겹친 카메라 셋 | 셋 다 잡힌다(오브젝트 목록 없이 같은 자리 카메라를 한꺼번에 고르는 길) |
| 묶음을 끌었는데 모두 잠김 | 6.1의 4번은 누른 것이 잠기지 않았을 때만이다. 누른 것만 풀려 있으면 그것만 움직인다 |
| 묶음에 공간과 그 공간의 소속 의자가 함께 있음 | 의자는 공간에 실려 한 번만 간다(6.3) |
| 묶음 이동 중 Esc · 포인터 취소 | 지금의 끌기 취소와 같다(원위치, 기록 없음) |
| 묶음 이동이 끝난 뒤 | 묶음이 그대로 선택돼 있다. Ctrl+Z 한 번에 모두 돌아온다 |
| 묶음을 누르고 움직이지 않고 뗌 | 누른 것 하나로 접힌다. 이어서 빠르게 한 번 더 누르면 더블클릭이다(이름 칸 / 들어가기) |
| 다각형의 점 손잡이·크기 네모가 보이던 하나에 Shift+클릭으로 하나를 더함 | 손잡이가 사라진다(하나일 때만 그린다) |
| 이름 칸이 열린 채 캔버스를 Shift+클릭 | 캔버스가 포커스를 받는 순간 이름이 확정된다(① 설계 5.7). 그 뒤 더해진다 |
| 그리기 도구·기호 도구 | Shift·상자는 '선택' 도구의 것이다. 다른 도구의 누름은 지금 그대로다 |
| 보기 모드에서 Shift+클릭 | 그냥 클릭이다(여러 개 고르기는 편집 중의 동작이다) |
| 상자를 그리다 캔버스 밖으로 나감 | SVG가 포인터를 잡고 있어 상자가 이어진다. 밖에서 떼도 적용된다 |
| 도면 저장이 시작됨·편집 권한을 잃음 | `abortGesture`가 상자와 진행 중인 끌기를 지운다(:287) |

---

## 7. F8 겹친 공간

### 7.1 규칙 한 줄

겹친 공간은 4절의 쌓임 순서로 그리고 누른다: **작은 공간이 위**. 어떤 자리든 **처음 누르면 맨 위(가장 작은) 공간**이 잡힌다 — 다른 공간이 선택돼 있어도 그렇다. **같은 자리를 천천히 다시 누르면** 그 아래 공간으로 넘어가고, 맨 아래에서 다시 맨 위로 돈다. **빠른 더블클릭**은 넘기지 않고 ①과 같은 일을 한다(이름 고치기 / 연결된 도면으로 들어가기). 평면·보조 평면도·3D가 같은 순서와 같은 "다시 누름"의 뜻을 쓴다(평면 6.1의 `again`, 3D 7.3, 보조 평면도 7.4 — 화면마다 자기 누름을 기억한다).

세 화면에 똑같이 서는 규칙 둘:

- **넘기는 것은 새 클릭 묶음을 시작하는 클릭뿐이다.** 공간의 더미에서 연속 클릭(클릭 횟수 2 이상 — 더블클릭의 둘째 클릭과 그 뒤)은 **그 더블클릭이 할 일이 있든 없든** 넘기지 않는다. 할 일이 없는 곳(보기 모드의 연결 없는 공간, 잠긴 연결 없는 공간, 3D와 보조 평면도)에서 빠르게 두 번 누르면 아무 일도 없이 첫 클릭이 남긴 공간이 선택된 채 남는다 — v1.131.0에서 방을 더블클릭하면 그 방이 선택된 채 남던 것과 같다. 근거: 승인 문구가 "**천천히** 다시 누르면"이다. (카메라·기호의 더미는 ①의 규칙 그대로다 — 7.2.)
- **"같은 자리를 다시 누름"의 기억은 세 화면에서 같은 때에 끝난다.** 고르는 누름이 아닌 캔버스 누름(화면만 옮기는 누름, 왼쪽 주 버튼이 아닌 누름, 취소된 끌기)과 **캔버스 밖의 누름**(속성 칸·오브젝트 목록·도구줄·다른 화면) 뒤에는, 그 자리를 다시 눌러도 처음 누름이다(맨 위 공간이 잡힌다). 방을 누른 뒤 화면을 둘러보거나 속성 칸에 글자를 치고 돌아와 그 방을 다시 누르면 — 평면에서도 3D에서도 보조 평면도에서도 — 그 방이 그대로 선택돼 있다. 화면별 장치와 표는 7.3의 끝.

### 7.2 평면

**더미 목록** (`mapPlanPreview.ts`에 더한다 — `planStackUnder`·`nextPlanSelection` 옆)

```ts
/**
 * The nodes that take turns on a click at `point`, the first picked one first. Kinds are not mixed: on a camera or
 * symbol it is the stack of planStackUnder; on a space it is every space that holds the point, the smallest first.
 */
export function planPileAt(map: BackgroundMap, hitId: string, point: BackgroundPoint, tolerance?: number, covers?: (node: BackgroundNode) => boolean): string[];
```

- 눌린 맨 위 요소(`hitId`)가 **카메라·기호**면 `planStackUnder(map, hitId, tolerance, covers)` 그대로다(①과 같다).
- **공간**이면 `spacesAt(map, point)`의 id들(작은 것부터). 눌린 공간이 그 안에 없으면(테두리 선의 바깥 반쪽을 눌렀을 때 — 선은 눌리지만 `containsPoint`는 거짓이다) `[hitId]`.
- "포인터 아래"의 뜻: 카메라는 몸통(12, 수직이면 고리 18)이나 부채꼴 안, 기호는 자기 상자 안(`planMarkCovers` = 지금의 `onPlanMark`, :84-85), 공간은 `containsPoint`(사각형은 상자 안, 타원은 타원 안, 다각형은 다각형 안 — 회전 포함).
- 더미는 종류를 섞지 않는다. 의자를 거듭 눌러도 그 아래 방으로 내려가지 않는다(방은 의자 옆의 바닥을 누른다). 근거: 카메라·기호 더미의 뜻("같은 자리에 겹친 것")을 ①에서 바꾸지 않고, "겹친 공간"만 더한다.

**누름**: 6.1의 `from`이 공간에도 선다 — 같은 자리를 다시 누를 때만. 편집기는 `planPileAt(live, hit.id, point, undefined, item => planMarkCovers(item, point))`로 `pile`을, `lastSpot`으로 `again`을 구해 `resolvePlanPress`에 넘긴다(9.1).

**같은 자리의 기억**(`lastSpot`, 편집기의 ref 하나): '선택' 도구가 마지막으로 노드를 눌러 **그 노드를 고르거나 옮긴** 자리의 맨 위 노드와, 그 누름이 남긴 선택 하나.

```ts
/**
 * The spot where the select tool last picked or moved a node: the topmost node there, and the one node that press (and
 * the step its click took) left selected. A press that was dragged into a pan or a marquee leaves none.
 */
const lastSpot = useRef<PlanSpot | null>(null);                 // PlanSpot: mapPlanSelect.ts (6.1)
```

| 언제 | 하는 일 |
|---|---|
| 캔버스가 받은 누름마다(`pointerDown`, 가드를 지난 뒤) | 읽어서 `again`을 구하고 **비운다**. 화면 이동·그리기·손잡이·빈 곳 누름은 그대로 비워 둔 채 끝난다 |
| '선택' 도구가 노드를 누른 것(누름 기록에 적는 누름)이 끝날 때(`pointerUp`, 취소가 아니면) — **움직이지 않고 뗐거나, 끌어서 노드를 옮겼을 때**(`move` 세션) | `{ 그 도면, 눌린 맨 위 노드, 지금 유일하게 선택된 것(하나가 아니면 null) }`을 적는다 |
| 〃 — **끌어서 화면 이동이나 상자가 됐을 때**(문턱을 넘은 `pan`·`marquee` 세션: 보기 모드에서 노드 위에서 시작한 끌기, 잠긴 것 위에서 시작한 상자) | **적지 않는다**(누를 때 비운 그대로다). 그 누름은 그 노드를 고르지 않았다: 화면 이동은 선택을 그대로 두므로 "지금 유일하게 선택된 것"은 다른 길로 골라 둔 것이고, 상자의 선택은 상자에 닿은 것이다. 적으면 다음에 그 노드를 처음 누르는 것이 "다시 누름"이 된다(6.1의 `again` 1번) |
| SVG의 `click`이 넘기기를 실행한 직후 | `pickedId`를 넘어간 것으로 고친다(이것이 빠지면 세 겹에서 둘째까지만 넘어가고 처음으로 돌아간다) |
| 캔버스 밖의 누름 | 따로 지우지 않는다. 그 누름은 누름 기록을 비우고(창 단위 처리기, :313-319 — 고치지 않는다), **누름 기록이 비어 있으면 자리 기억을 읽지 않는다**(아래 9.1의 `pressLog.current[1] ? … : null`). Shift·스페이스 누름 뒤에도 같다 |

`again` = `sameSpotAgain(읽은 자리 기억, 도면 id, 눌린 맨 위 노드, 살아 있는 선택)`(6.1).

**더블클릭이 하는 일** (`mapPlanEdit.ts`에 더한다)

```ts
export type PlanDoubleClickAction = 'open' | 'rename' | null;
/**
 * What a double-click on a node does on the plan. A space with a detail map opens it, in view and edit mode, before
 * any renaming; anything else that can be renamed here gets its name box.
 */
export function planDoubleClickAction(node: BackgroundNode, context: { tool: string; canEdit: boolean; hasDetailMap: boolean }): PlanDoubleClickAction;
```

| 대상 | 조건 | 결과 |
|---|---|---|
| 공간이고 `hasDetailMap` | 도구가 `select` 또는 `hand` | `'open'`(보기 모드·편집 중·잠김 모두) |
| 〃 | 그 밖의 도구 | `null` |
| 그 밖의 모든 노드 | 도구가 `select`, `canEdit`, 잠기지 않음 | `'rename'` |
| 〃 | 그 밖 | `null` |

지금의 `canvasDoubleClick`(:702-706)과 `beginRename`의 가드(:540-543)가 하는 판정을 옮긴 것이다. `hasDetailMap` = `node.type === 'space' && node.childMapId`이고 그 도면이 `maps`에 있음(:702).

**넘기기 조건** — ①의 임시 조건 `event.detail >= 2 && canEdit`(:843)을 다음으로 바꾼다.

> **공간의 더미**: 새 클릭 묶음을 시작하는 클릭(`detail` 1)만 넘긴다. 연속 클릭(`detail ≥ 2` — 더블클릭의 둘째 클릭과 그 뒤)은 **그 더블클릭이 할 일이 있든 없든 넘기지 않는다.**
>
> **카메라·기호의 더미**: ①의 뜻 그대로다. 연속 클릭이고 **그 더블클릭이 무언가를 한다면**(`'open'` 또는 `'rename'`) 넘기지 않는다. 그 밖에는 넘긴다(보기 모드의 겹친 카메라는 지금처럼 클릭마다 넘어간다).

- 근거(공간): 승인 문구는 "같은 자리를 **천천히** 다시 누르면 아래 공간으로 넘어간다"이다. 빠른 둘째 클릭은 천천히 누른 것이 아니다. 그리고 v1.131.0에서 방을 더블클릭하면 — 보기 모드든, 잠긴 방이든, 3D든 — 그 방이 선택된 채 남는다. "더블클릭이 할 일이 없으면 넘긴다"로 하면 그런 곳에서 방을 더블클릭할 때마다 선택이 아래 공간으로 바뀐다.
- 근거(카메라·기호): 승인 문구 "빠른 더블클릭은 ①과 같은 규칙". ①이 정한 더미(같은 자리에 겹친 카메라·기호)의 동작은 바꾸지 않는다: 연속 클릭은 그 더블클릭이 첫 누름의 노드에 무언가를 할 때만 건너뛴다.
- 어느 종류의 더미인지는 누름이 정한다(`step`의 `spaces`, 6.1). 더미는 종류를 섞지 않는다.

더블클릭이 작용하는 노드: **첫 누름의 대상**(누름 기록의 `targetId`)이 먼저다. 그 노드에 할 일이 없으면(`planDoubleClickAction`이 `null`) **눌린 맨 위 노드**에 할 일이 있는지 본다. 둘 다 없으면 아무 일도 없다(둘째 클릭은 카메라·기호의 더미에서는 보통 클릭처럼 넘기고, 공간의 더미에서는 넘기지 않는다 — 첫 클릭이 남긴 공간이 선택된 채 남는다).

```ts
/** What the double-click made of the last two presses does, and to which node. Null: nothing (the second click then steps on through cameras and symbols, never through spaces). */
function doubleClickIntent(point: BackgroundPoint | null): { node: BackgroundNode; action: 'open' | 'rename' } | null {
  const [first, last] = pressLog.current;
  if (!current || !first || !last || last.handle || last.hitId === null || first.hitId !== last.hitId || Date.now() - lastDrag.current <= 450) return null;
  const node = current.nodes.find(item => item.id === last.hitId);
  if (!node) return null;
  const pile = point ? planPileAt(current, node.id, point, undefined, item => planMarkCovers(item, point)) : [node.id];
  const target = current.nodes.find(item => item.id === doubleClickNodeId(first.targetId, node.id, pile)) ?? node;
  // The node of the first press comes first. With nothing to do there, the topmost node is asked: a linked room that
  // can be seen is entered even while a space picked from under it can be neither opened nor renamed.
  for (const item of target === node ? [node] : [target, node]) {
    const action = planDoubleClickAction(item, { tool, canEdit,
      hasDetailMap: item.type === 'space' && !!item.childMapId && maps.some(map => map.id === item.childMapId) });
    if (action) return { node: item, action };
  }
  return null;
}
function canvasDoubleClick(event: ReactMouseEvent<SVGSVGElement>) {
  const [, last] = pressLog.current;
  if (!current || !last || last.handle || Date.now() - lastDrag.current <= 450) return;
  if (last.hitId === null) { if (tool === 'polygon') finishPolygon(); return; }        // 빈 곳: 지금과 같다
  const intent = doubleClickIntent(pointFrom(event));
  // The space that is entered is the selected one when this map is come back to. The hand tool selects nothing.
  if (intent?.action === 'open') openSpace(intent.node.id, tool !== 'hand');
  else if (intent) beginRename(intent.node.id);
}
/** Enters the detail map of a space. `pick`: the space is picked first, unless it is the one node in hand already. */
function openSpace(id: string, pick = false) {
  const node = current?.nodes.find(item => item.id === id);
  if (disabled || node?.type !== 'space' || !node.childMapId || !maps.some(map => map.id === node.childMapId)) return;
  if (pick && id !== singleId) select(id);
  navigate(node.childMapId);
}
// <svg … onClick>
const cycle = pendingCycle.current; pendingCycle.current = null;
// A repeated click (the second click of a double-click, and every one after it) never steps through spaces, whatever the
// double-click does: only a click that starts a new click sequence does. Through cameras and symbols it steps unless
// that double-click renames or opens a node.
if (!cycle || (event.detail >= 2 && (cycle.spaces || doubleClickIntent(pointFrom(event))))) return;
const next = cycle.ids[(cycle.ids.indexOf(cycle.from) + 1) % cycle.ids.length];
select(next, cycle.mapId);
// The step is what that press left selected: a press on the same spot goes on from it.
if (lastSpot.current?.mapId === cycle.mapId) lastSpot.current = { ...lastSpot.current, pickedId: next };
```

- **한 곳의 판정**: 카메라·기호 더미의 넘기기와 더블클릭 처리기가 `doubleClickIntent` 하나를 쓴다. 그 더미에서는 "넘기지 않았는데 더블클릭도 아무 일을 안 했다"나 "넘기고 나서 이름 칸이 열렸다"가 생길 수 없다. 공간의 더미는 연속 클릭이면 판정을 묻지 않고 넘기지 않으므로(`cycle.spaces ||`가 앞에 있다) "넘기고 나서 들어갔다"가 생길 수 없고, "넘기지 않았고 더블클릭도 할 일이 없다"는 정해진 동작이다(그 공간이 선택된 채 남는다).
- **연속 클릭의 누름은 스스로 선택을 바꾸지 않는다.** 같은 자리의 둘째 누름은(첫 클릭이 그 자리의 노드를 골랐으므로 `again`이 참이다) 6.1의 `from`이 서서(6·8번, 보기 모드의 `step` 줄) 누를 때 아무것도 고르지 않고 `step`을 요청할 뿐이며, 그 요청을 위의 줄이 버린다. (첫 누름이 Shift였거나 자리 기억이 그 사이에 끝났으면 `again`이 거짓이고, 둘째 누름은 처음 누름이다: 맨 위 것이 잡힌다 — 넘기기가 아니다. 3D의 `again` 거짓 · `repeat` 참과 같다, 7.3.) 그래서 첫 클릭이 남긴 공간이 — 맨 위 것이든, 넘겨서 고른 아래 것이든 — 그대로 남는다(맨 위로 되돌아가지도 않는다). 7번(골라 둔 것이 잠겼고 맨 위 것은 잠기지 않았을 때)만 누를 때 맨 위 것을 고른다: 끌기의 대상이 그것이기 때문이다(6.1). 7번은 편집 중이고 맨 위 것이 잠기지 않았을 때뿐이라 그 더블클릭에는 늘 할 일이 있고(맨 위 것의 이름 칸이나 들어가기), 선택은 그 더블클릭이 작용하는 노드로 간다.
- **들어간 공간은 선택된 채 남는다**(`openSpace`의 `pick`). 이름 칸이 그 노드를 선택하는 것(`beginRename`, :544)과 같은 짝이다. v1.131.0에서도 더블클릭의 첫 누름이 그 공간을 골랐으므로 돌아오면 그 공간이 선택돼 있었다. 이것이 없으면 "넘겨진 아래 공간이 선택된 채" 상세 도면으로 떠나게 되고, 돌아와서 다시 더블클릭할 때 대상이 번갈아 어긋난다. 그 공간이 이미 다루는 하나(`singleId`, 3.5)면 아무것도 보내지 않는다. 평면에서 '선택' 도구로 한 더블클릭의 첫 누름은 선택을 늘 하나로 만들어 두므로(6.1의 표에서 노드를 누른 줄은 모두 누를 때나 뗄 때 하나를 고르거나 하나로 넘긴다. Shift 누름은 더블클릭의 반쪽이 아니다) 이때 `singleId`는 그 하나이고 `select(id)`는 바꿔 넣기다. 3D에서 여러 개가 선택돼 있으면 같은 `select(id)`가 3D의 하나만 바꾸므로(6.7) 묶음은 그대로다. '화면 이동' 도구의 더블클릭은 들어가기만 하고 선택은 그대로다(5.2). 3D의 더블클릭도 같은 `openSpace`를 지난다(7.3).
- `pendingCycle`은 `{ ids, from, mapId, spaces }`가 된다(지금의 `nodeId`를 `from`으로 — 6.1의 7번에서 끄는 노드와 넘기기의 출발점이 다를 수 있다. `spaces`는 `step`의 것을 그대로 싣는다, 9.3).
- 결과 — 겹친 **공간**(둘째 클릭은 어느 줄에서도 넘기지 않는다):

| 상황 | 둘째 클릭 | 더블클릭 |
|---|---|---|
| 편집 중, 겹친 공간(연결 없음)을 빠르게 두 번 | 넘기지 않는다 | 첫 누름의 대상의 이름 칸 |
| 편집 중·보기 모드, 연결된 공간을 빠르게 두 번 | 넘기지 않는다 | 그 도면으로 들어간다 |
| 보기 모드, 연결 없는 겹친 공간을 빠르게 두 번 | **넘기지 않는다**(더블클릭이 할 일이 없어도) | 아무 일도 없다. 첫 클릭이 고른 공간이 선택된 채 남는다(v1.131.0과 같다) |
| 편집 중, 겹친 것이 모두 잠긴 연결 없는 공간 | **넘기지 않는다** | 아무 일도 없다. 첫 클릭이 고른 공간이 선택된 채 남는다 |
| 빠르게 세 번·네 번(`detail` 3, 4 …) | 넘기지 않는다(연속 클릭은 모두 같다) | 지금과 같다(브라우저가 `dblclick`을 보낼 때 위의 줄들대로) |
| **바깥 공간 O가 다른 길로 선택된 채**(복도를 눌러서·방금 그려서·목록에서) 연결된 안쪽 방 I를 빠르게 두 번 — 보기 모드·편집 중 | 넘기지 않는다 | **I의 도면으로 들어간다**(첫 누름이 처음 누름이라 대상이 I다). 연결이 없고 편집 중이면 I의 이름 칸 |
| 연결된 I를 빠르게 두 번 → 돌아옴 → 다시 빠르게 두 번 … 을 되풀이 | 넘기지 않는다 | 매번 I로 들어간다. 돌아올 때마다 I가 선택돼 있다 |
| 같은 자리를 천천히 눌러 **O까지 넘겨 둔 뒤** 그 자리를 빠르게 두 번 — O에 할 일이 있다(연결돼 있다 / 편집 중이고 잠기지 않았다) | 넘기지 않는다 | O에 작용한다(O의 도면 / O의 이름 칸) |
| 〃 — O에 할 일이 없고(보기 모드의 연결 없는 O, 편집 중의 잠긴 연결 없는 O) 맨 위의 I에는 있다 | 넘기지 않는다 | I에 작용한다(I의 도면 / I의 이름 칸) |
| 〃 — O에도 I에도 할 일이 없다(보기 모드, 둘 다 연결 없음) | 넘기지 않는다. 그 빠른 두 번의 **첫 클릭**은 새 클릭 묶음의 시작이라 한 칸 넘겼고(O → 다음 것), 둘째 클릭은 거기서 멈춘다(세 겹이면 맨 위로 되돌아가지도 않는다) | 아무 일도 없다 |
| 어느 모드든 천천히 한 번씩 | 클릭마다 넘긴다 | — |

겹친 **카메라·기호**(①과 같다):

| 상황 | 둘째 클릭 | 더블클릭 |
|---|---|---|
| 편집 중, 겹친 카메라를 빠르게 두 번 | 넘기지 않는다 | 첫 누름의 대상의 이름 칸 |
| 보기 모드의 겹친 카메라를 빠르게 두 번 | 넘긴다(더블클릭이 할 일이 없다 — 지금과 같다). 편집 중이라도 첫 누름의 대상과 맨 위 것이 모두 잠겨 있으면 같다 | 아무 일도 없다 |
| 천천히 한 번씩 | 클릭마다 넘긴다 | — |

- 첫 누름의 대상 = 누름 기록의 `targetId`(6.1의 표). 처음 누르는 자리에서는 눌린 맨 위 것이고, 같은 자리를 다시 눌러 아래 공간을 골라 둔 상태에서는 그 아래 공간이다. 뒤의 경우 그 자리를 빠르게 두 번 누르면, 첫 클릭이 넘기고(첫 클릭만으로는 더블클릭인지 모른다) 둘째 클릭은 넘기지 않으며, 더블클릭이 **골라 두었던 아래 공간**에 작용한다(이름 칸은 그 공간을 다시 선택한다. 선택 표시가 한 번 깜빡일 수 있다 — ① 설계 5.6과 같다).
- `openSpace`의 자리(:534-537)와 순서는 그대로 두고 본문만 위처럼 바꾼다. 부르는 곳은 `canvasDoubleClick`과 `openSpaceFrom3D`(:767) 둘이다(속성 칸의 '상세 도면 열기'는 지금처럼 `navigate`를 바로 부른다 — 그 공간이 이미 선택돼 있다).
- "천천히"의 기준은 운영체제의 더블클릭 간격이다(윈도우 기본 0.5초). 시간·거리 상수를 따로 두지 않는다.

### 7.3 3D

**같은 높이 바닥의 순서**(`map3dScene.ts`): `pickMapFloor`(:596-608)의 `order(hit)`를 배열 번호(`map.nodes.findIndex`) 대신 **쌓임 번호**(`spaceStackRanks(map).get(id) ?? -1`)로 바꾼다. 나머지 줄(가장 가까운 바닥, 같은 높이 판정 `1e-6`, 번호가 큰 것이 이긴다)은 그대로다. `map` 없이 부르면 지금처럼 가장 가까운 바닥이다. 바닥 위 기호 놓기(`floorPoint`, BackgroundMap3D.tsx:507-513)도 같은 함수라 따라온다.

**넘기기**(`map3dScene.ts`):

```ts
/** The spaces whose floor a ray lands on, in the order a click picks them: the nearest level first, and floors on one level as the plan stacks them, the smaller first. */
export function mapFloorPile(hits: readonly MapPickHit[], map: BackgroundMap): string[];
/**
 * Selection after a click. `again`: the same spot clicked again (the caller remembers its last click). `repeat`: the
 * click is a repeated one of its click sequence (the second click of a double click, and on). A selected camera or
 * symbol steps through its pile as before, whatever the two say. A selected space steps on to the floor under it only
 * with `again` and without `repeat`: a repeated click on the same spot leaves it selected.
 */
export function resolveMapClick(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again?: boolean, repeat?: boolean): string | null;
/** The node a click is aimed at: the pile member that is already selected when the click steps on from it, else what the click picks. */
export function mapClickAim(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again?: boolean): string | null;
```

- `mapFloorPile`: 바닥에 맞은 것(`pickPart === 'floor'`)을 거리 오름차순으로 놓고, 같은 높이(앞의 것에서 `1e-6 × max(1, 거리)` 안)끼리는 쌓임 번호가 큰 것(위)부터. `mapFloorPile(hits, map)[0]`은 `pickMapFloor(hits, map)`의 공간과 같다.
- `resolveMapClick`(:634-647) — 넷째 인자 `again`과 다섯째 인자 `repeat`(둘 다 기본 `false`)을 받고, 선택된 것이 공간일 때의 가지만 더한다.
  1. `picked = pickMapNode(hits, map)`. 선택이 없거나, 고른 것이 없거나, 선택된 것이 광선에 맞지 않았으면 `picked`(지금과 같다).
  2. 선택된 것이 **공간**이면:
     - `again`이 아니면 더미가 없다 → `picked`(맨 위 것. `repeat`은 보지 않는다).
     - `again`이고 **`repeat`이면 `selectedId` 그대로** — 넘기지도 않고 맨 위 것으로 되돌리지도 않는다(연속 클릭은 첫 클릭이 남긴 공간을 둔다).
     - `again`이고 `repeat`이 아니면 더미 = `mapFloorPile(hits, map)`.

     그 밖(카메라·기호)이면 지금의 더미(`stackedMapNodeIds(map, selectedId)` 가운데 광선에 맞은 것) — `again`도 `repeat`도 보지 않는다(3D의 겹친 카메라는 지금처럼 클릭마다 넘어간다).
  3. 더미가 둘 이상이고, 선택된 것과 `picked`가 모두 그 안에 있으면 선택된 것의 **다음**. 아니면 `picked`.
- 따라서: 큰 공간이 선택된 채 안쪽 방을 **처음** 누르면 안쪽 방(`picked`)이다. 세 겹에서 가운데가 선택된 채 맨 위 것을 처음 눌러도 맨 위 것이다. 같은 자리를 **천천히** 다시 누를 때만 다음 아래 바닥으로 넘어가고, 빠른 연속 클릭은 선택을 그대로 둔다. 카메라·기호가 포인터 아래 있으면 지금처럼 그것이 먼저 잡히고(실체가 바닥보다 먼저), 바닥끼리만 서로 넘어간다. 벽만 맞은 공간은 넘기기에 들지 않는다. 높이가 다른 바닥(위층)은 가까운 것부터다.
- 인자 셋으로 부르면(`again` 없음) 공간은 넘어가지 않는다 — v1.131.0과 같은 결과다(`tests/backgroundMap3dScene.test.ts:449-453` 불변).
- `mapClickAim`은 같은 판정으로 "넘겼다면 선택돼 있던 것, 아니면 `picked`"를 돌려준다(둘은 모듈 안의 함수 하나를 함께 쓴다).

**뷰포트의 기억 둘**(`BackgroundMap3D.tsx`의 `Map3DViewport`)

```ts
/** What the last pick landed on (the node on top there) and what it left selected: the same spot clicked again is told from it. */
private turn: { hitId: string; pickedId: string | null } | null = null;
/** The node the last first click (mousedown detail 1) with the select tool was aimed at. Null after any other click. */
private aimed: string | null = null;
```

| | `turn` (같은 자리를 다시 눌렀는가) | `aimed` (더블클릭의 첫 클릭이 겨눈 것) |
|---|---|---|
| 적는 곳 | 고르는 클릭마다(`pick`): `{ 맨 위 노드, 이 클릭이 남긴 선택 }` | 고르는 **첫** 클릭마다(`pick`, `repeat`이 아닐 때): `mapClickAim(…)` |
| 지우는 곳 | ① 도면이 바뀔 때(:239-243의 `mapChanged` 분기) ② 고르는 클릭이 아닌 클릭(둘러보기 도구·기호 놓기·시점 보기) ③ 선택이 다른 길로 바뀌었을 때(`update()`에서 `props.selectedId !== this.turn.pickedId`) ④ **왼쪽 주 버튼이 아닌 누름**(`onPointerDown` — 오른쪽 버튼의 둘러보기, 휠 버튼의 화면 옮기기, 둘째 손가락) ⑤ **끌렸지만 기즈모 끌기가 아닌 왼쪽 누름**(`onPointerUp` — '둘러보기' 도구의 끌기, '선택' 도구의 빈 끌기) ⑥ **캔버스 밖의 누름**(창 캡처 `pointerdown`, `onPressElsewhere`) ⑦ 취소된 끌기(기즈모 끌기를 Esc 등으로 취소 — `onCancelGesture`, 포인터 취소 — `onPointerCancel`) | 도면이 바뀔 때 · 고르는 클릭이 아닌 클릭 · 선택된 것이 포인터 아래 없는 손잡이 클릭 |

`again` = 이번 클릭의 맨 위 노드(`pickMapNode`)가 `turn.hitId`와 같고 `turn.pickedId`가 지금의 `props.selectedId`다. ④~⑦은 평면의 규칙을 3D에 옮긴 것이다(아래 '기억이 끝나는 때'): 평면에서는 '선택' 도구가 노드를 고르거나 옮긴 누름이 아닌 캔버스 누름과 캔버스 밖의 누름이 모두 자리 기억을 끝낸다. **끝까지 간 기즈모 끌기는 지우지 않는다** — 평면의 옮기기(`move`)가 자리 기억을 남기는 것과 같다(넘겨서 고른 아래 공간을 끈 뒤에도 그 자리의 대상은 그 공간이다).

**빠른 더블클릭**(`BackgroundMap3D.tsx`): 3D의 더블클릭이 하는 일은 연결된 공간으로 들어가기뿐이다(이름 고치기는 평면 전용이다).

- 3D의 클릭은 `pointerup`에서 처리한다(:568-575). pointerup은 클릭 횟수를 싣지 않지만, 3D 캔버스는 누름에서 `preventDefault`를 하지 않으므로(OrbitControls·TransformControls 모두) **`mousedown`이 오고 그 `detail`이 클릭 횟수다.** 뷰포트는 이미 `mousedown`을 듣는다(:197, :586).
- `Press`(:23)에 `repeat: boolean`을 더한다(`onPointerDown`에서 `false`). `onMouseDown`(:586)에 한 줄: `if (event.button === 0 && this.press) this.press.repeat = event.detail >= 2;`. `onPointerUp`(:573-574)은 `press.repeat`을 `clickHandle`과 `click`에 넘긴다.
- **누름이 자리 기억(`turn`)을 끝내는 줄들**(위 표의 ④~⑦). 누름 처리기 셋과 기즈모의 콜백 하나에 한 줄씩, 그리고 창 캡처 리스너 하나다:
  ```ts
  // start(): 캔버스 리스너들 옆(:191-198). dispose()에서 같은 인자로 뗀다(:292-298 옆).
  window.addEventListener('pointerdown', this.onPressElsewhere, true);
  /** A press anywhere but on the canvas (the bar over it, the companion plan, the inspector, the object list, the toolbar, a dialog): the same spot is pressed anew after it. */
  private readonly onPressElsewhere = (event: PointerEvent): void => { if (event.target !== this.canvas) this.turn = null; };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.host.focus({ preventScroll: true });
    this.press = event.isPrimary && event.button === 0
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, gizmo: this.gizmo.hovering || this.gizmo.dragging, repeat: false } : null;
    // Any other button (the right one turns the world, the wheel button pans it) and any other pointer picks nothing.
    if (!this.press) this.turn = null;
  };
  // onPointerUp(:568-575)의 끌린 누름 가지
  if (press.moved || Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_SLOP) {
    this.lastDragAt = performance.now();
    // A left drag that was no gizmo drag turned the world (the look tool) or did nothing at all: it picked nothing.
    // A gizmo drag keeps the memory, like a move on the plan.
    if (!press.gizmo) this.turn = null;
    return;
  }
  // 기즈모 host의 onCancelGesture(:173-177)와 onPointerCancel(:576): 취소된 끌기는 평면에서처럼 기억을 끝낸다
  onCancelGesture: () => { if (this.press) this.press.moved = true; this.turn = null; this.props.onCancelGesture(); },
  private readonly onPointerCancel = (): void => { this.press = null; this.turn = null; };
  ```
  - `press.gizmo`는 누름이 손잡이 위였거나(`hovering`) 그 누름으로 기즈모 끌기가 시작됐을 때(`beginDrag`, :147-151) 참이다. 손잡이 위에서 문턱(`CLICK_SLOP`, 기즈모의 `slop`과 같은 값 — :178)을 넘은 누름이 곧 기즈모 끌기다. 크기 기즈모의 한가운데는 손잡이가 아니다(지금도 그렇다, BackgroundMapCameraGizmo.ts:313-319): 거기서 시작한 끌기는 ⑤로 기억을 끝낸다.
  - 창 캡처 리스너는 캔버스의 누름도 받지만 대상이 캔버스라 지나친다. 캔버스 위에 뜬 아래 줄의 버튼(확대·축소·맞춤·위에서 보기, :657-662)은 캔버스의 형제라 "밖"이다. 편집기가 누름 기록에 쓰는 것과 같은 장치다(창 캡처 `pointerdown`, BackgroundMapEditor.tsx:313-319 — 포털로 붙는 창과 캔버스 위에 그려진 것까지 본다).
  - 다른 버튼이 이미 눌린 채 누른 버튼은 `pointerdown`이 아니라 `pointermove`로 온다(:561). 그 드문 경우는 ④에 들지 않는다(16.2의 대체안).
  - `aimed`는 이 줄들이 건드리지 않는다: 고르는 첫 클릭이 늘 새로 적는다(아래).
- `click`·`clickHandle`(:523-547)을 다음으로 바꾼다. 고르는 일은 `pick` 하나가 한다.
  ```ts
  private click(clientX: number, clientY: number, repeat: boolean): void {
    const props = this.props;
    // Only a pick with the select tool is remembered. After any other click a double click falls back to what is under the pointer.
    if (this.look || props.placing || props.tool !== 'select') { this.aimed = null; this.turn = null; }
    /* 지금의 세 갈래 그대로: if (this.look) return; · props.placing 블록 · if (props.tool !== 'select') return; */
    this.pick(clientX, clientY, repeat, false);
  }
  /** A press on a handle that never moved. The handles cover the selected item, so there only a step on from it is taken. */
  private clickHandle(clientX: number, clientY: number, repeat: boolean): void { this.pick(clientX, clientY, repeat, true); }
  private pick(clientX: number, clientY: number, repeat: boolean, onHandle: boolean): void {
    const props = this.props, selectedId = props.selectedId, hits = this.cast(clientX, clientY);
    // A handle press counts only while the selected item is under the pointer (as before).
    if (onHandle && !(selectedId && hits.some(hit => hit.object.userData.nodeId === selectedId))) { this.aimed = null; return; }
    const top = pickMapNode(hits, props.map);
    // The same spot again: the last pick landed on this same top node, and what it left selected is still the selection.
    const again = top !== null && this.turn?.hitId === top && this.turn.pickedId === selectedId;
    if (!repeat) this.aimed = mapClickAim(props.map, selectedId, hits, again);
    // The second click of a double click that opens a space steps nowhere.
    else if (this.opens(this.doubleClickNode(hits))) return;
    // A repeated click never steps through spaces, whether or not the double click does anything: with `again` and
    // `repeat` the selected space stays (resolveMapClick). Cameras and symbols step on every click, as before.
    const next = resolveMapClick(props.map, selectedId, hits, again, repeat);
    if (onHandle) {
      // Never a fresh pick from a handle: only the next of the pile the selected item is in.
      const selected = props.map.nodes.find(node => node.id === selectedId);
      const pile = !selected ? [] : selected.type !== 'space' ? stackedMapNodeIds(props.map, selected.id) : again ? mapFloorPile(hits, props.map) : [];
      if (!selected || next === null || next === selected.id || !pile.includes(selected.id) || !pile.includes(next)) return;
    }
    this.turn = top === null ? null : { hitId: top, pickedId: next };     // before onSelect: the props that come back must find it
    props.onSelect(next);
  }
  /** Whether a double click on this node enters a detail map: a space with one. */
  private opens(id: string | null): boolean {
    return id !== null && this.props.map.nodes.some(node => node.id === id && node.type === 'space' && !!node.childMapId);
  }
  /** The node a double click here is about: what its first click was aimed at while that is a linked space still under the pointer, else what is on top. */
  private doubleClickNode(hits: MapPickHit[]): string | null {
    const aimed = this.aimed;
    return aimed !== null && this.opens(aimed) && hits.some(hit => hit.object.userData.nodeId === aimed) ? aimed : pickMapNode(hits, this.props.map);
  }
  ```
  - 연속 클릭(`repeat`)이 같은 자리(`again`)의 선택된 공간에 떨어지면 `next`가 `selectedId` 그대로다: `turn`은 같은 값으로 다시 적히고 `onSelect`는 같은 id를 다시 알릴 뿐이라 아무것도 바뀌지 않는다(편집기의 `select`는 같은 선택에 받은 상태를 그대로 돌려준다, 3.2). 손잡이 위였으면 `next === selected.id`에서 돌아간다. 연속 클릭인데 같은 자리가 아니면(`again` 거짓 — 그 사이에 기억이 끝났다) 처음 누름과 같다: 맨 위 것이 잡힌다.
- `update()`(:212-254)에 한 줄: `if (this.turn && props.selectedId !== this.turn.pickedId) this.turn = null;` — 오브젝트 목록·보조 평면도·평면에서 선택이 바뀌었으면 그다음 3D 클릭은 처음 누름이다. `mapChanged` 분기에 `this.aimed = null; this.turn = null;`. 선택이 **같은 것으로 다시 골라졌을 때**(오브젝트 목록에서 지금 선택된 그 방을 누름)는 이 줄이 잡지 못하고, 위의 창 캡처 리스너(⑥)가 잡는다.
- `onDoubleClick`(:577-583): 가드는 그대로. 대상을 고르는 줄만 바꾼다. `pick`의 둘째 클릭 판정과 **같은 함수**를 쓴다("넘기지 않았는데 다른 것이 열렸다"가 생길 수 없다).
  ```ts
  const id = this.doubleClickNode(this.cast(event.clientX, event.clientY));
  if (id && props.map.nodes.some(node => node.id === id && node.type === 'space')) props.onOpenSpace(id);
  ```
- **`aimed`는 그 더블클릭의 첫 클릭 것이다.** 고르는 첫 클릭이 적고, 그 밖의 클릭(둘러보기 도구, 기호 놓기, 시점 보기)은 지운다. 그래서 둘러보기 도구로 연결된 안쪽 방을 더블클릭하면, 그 전에 '선택' 도구로 바깥 방을 눌러 두었더라도 v1.131.0처럼 포인터 아래의 방(안쪽 방)이 열린다. 지우지 않으면 예전에 겨눈 바깥 방이 바닥으로든 벽으로든 광선에 걸리는 한 그것이 열린다(`onDoubleClick`에는 도구 검사가 없고, 편집기는 기호 도구만 빼고 연다, :767).
- **할 일이 없는 `aimed`는 맨 위 것에 자리를 내준다**(`doubleClickNode`): 같은 자리를 눌러 연결 없는 바깥 방까지 넘겨 둔 뒤 그 자리를 빠르게 두 번 누르면, 첫 클릭이 겨눈 것은 바깥 방이지만 열리는 것은 맨 위의 연결된 안쪽 방이다(평면의 7.2와 같은 규칙).
- **손잡이 위의 클릭**(`clickHandle`): 손잡이는 선택된 것을 덮는다. 작은 안쪽 방을 누르면 그 한가운데에 기즈모가 뜨므로, "같은 자리를 다시 누름"이 손잡이에 떨어진다. ①이 겹친 카메라에서 이미 한 것처럼(:536-539), 이제 **선택된 공간의 손잡이 위에서도 넘어간다** — `again`이고 선택된 공간과 다음 것이 모두 포인터 아래의 바닥 더미에 있을 때만이다. 손잡이를 처음 누른 것(끌지 않고 뗀 것)은 지금처럼 아무것도 고르지 않는다: 바깥 방의 기즈모가 안쪽 방 위에 떠 있어도 그 손잡이를 한 번 누른 것으로 안쪽 방이 선택되지 않는다. 더블클릭의 첫 클릭이 손잡이에 떨어졌을 때도 `aimed`와 둘째 클릭 판정이 같은 길(`pick`)을 지난다.
- 결과: 평면의 표(7.2)와 같은 줄이 3D에도 선다 — 연결된 공간을 빠르게 두 번 누르면 넘기지 않고 들어가고(다른 공간이 선택돼 있었어도 눌린 맨 위 공간으로), **연결 없는 겹친 공간도 빠른 둘째 클릭에는 넘어가지 않는다**: 3D에는 이름 고치기가 없어 그 더블클릭은 아무 일도 하지 않고, 첫 클릭이 남긴 공간이 선택된 채 남는다(v1.131.0의 3D에서 방을 더블클릭하면 그 방이 선택된 채 남던 것과 같다). 겹친 카메라·기호는 3D에서 지금처럼 클릭마다 넘어간다(빠르게 눌러도).
- 편집기 쪽: `openSpaceFrom3D`(:767)는 `if (tool !== 'symbol') openSpace(id, tool !== 'hand');`가 된다 — 들어가기 전에 그 공간이 3D의 하나가 아니면 고른다(7.2의 `openSpace`. 여러 개가 선택돼 있으면 3D의 하나만 바뀌고 묶음은 그대로다. 3D의 '둘러보기'는 편집기의 `hand`라 고르지 않는다). 연결된 도면이 없는 공간이면 `openSpace`가 아무것도 하지 않으므로 선택도 바뀌지 않는다. `mapCanvas.ts`는 그대로다.

**기억이 끝나는 때 — 세 화면이 같다**(7.1의 둘째 규칙). 장치는 화면마다 다르다: 평면은 누름마다 비우고 고르거나 옮긴 누름이 새로 적는다(`lastSpot`, 7.2). 3D와 보조 평면도는 고르는 클릭이 적고 아래의 일들이 지운다(`turn`). 결과는 같다.

| 한 일(방 I를 누른 뒤) | 평면 | 3D | 보조 평면도 | 그 뒤 I 자리를 다시 누르면 |
|---|---|---|---|---|
| 캔버스 밖을 누름: 속성 칸(글자를 치려고)·오브젝트 목록·도구줄·기즈모 방식 버튼·3D 아래 줄의 버튼·다른 화면 | 끝난다(누름 기록이 비어 읽지 않는다, 9.1) | 끝난다(⑥ `onPressElsewhere`) | 끝난다(7.4의 `forget`) | I 그대로 |
| 화면만 옮기는 누름 | 끝난다: 휠 버튼·'화면 이동' 도구·스페이스, 보기 모드에서 끌어 옮긴 누름 | 끝난다: 오른쪽 버튼(둘러보기)·휠 버튼(옮기기) ④, '둘러보기' 도구의 끌기 ⑤와 클릭 ② | (화면을 옮기는 누름이 없다) | I 그대로 |
| 왼쪽 주 버튼이 아닌 누름(끌지 않아도) | 끝난다. 오른쪽 버튼: 가드가 누름 기록을 비운다(:582). 휠 버튼: 가드를 지나는 화면 이동 누름이라 자리 기억을 비운 채 끝난다(9.1 — `lastSpot`을 비우고 `spotId`가 `null`이다) | 끝난다 ④ | 끝난다(`forget`) | I 그대로 |
| 그리기·기호 놓기·빈 곳 누름 | 끝난다 | 끝난다(기호 놓기 ②, 빈 바닥은 `turn`을 `null`로 적는다) | 바탕을 누르면 선택이 풀려 끝난다 | I(맨 위 것) |
| 취소된 끌기(Esc·포인터 취소) | 끝난다(세션이 사라져 적지 않는다) | 끝난다 ⑦ | — | I 그대로 |
| **고른 것을 옮긴 끌기** | **남는다**(`move`, 9.3) | **남는다**(끝까지 간 기즈모 끌기) | — | 넘어간다(그 자리의 맨 위가 여전히 I면) |
| 선택이 다른 길로 다른 것이 됨 | 끝난다(`again`의 3번 조건 — 선택이 다른 것인 동안이다. 키보드만으로 되돌렸을 때는 16.4) | 끝난다 ③ | 끝난다(렌더의 검사) | I(맨 위 것) |
| 휠로 확대·축소, 선택을 바꾸지 않는 키보드 조작 | 남는다 | 남는다 | 남는다(보조 평면도의 노드를 키보드로 고르는 것만 끝낸다 — 7.4) | 넘어간다 |

- 평면과 3D가 다른 곳은 손잡이뿐이고, 일부러 그렇다. 평면의 손잡이(크기·회전·점)는 선택된 것의 가장자리에 있어 "같은 자리"가 아니고, 그 누름은 기억을 끝낸다. 3D의 기즈모는 선택된 것의 한가운데를 덮으므로, 손잡이를 끌지 않고 누른 것이 "같은 자리를 다시 누름"이 될 수 있어야 하고(위의 '손잡이 위의 클릭'), 기즈모로 끈 것(이동·회전·크기 어느 방식이든)은 평면의 옮기기처럼 기억을 남긴다.
- 그래서 "방 I를 누른다 → 둘러본다 / 화면을 옮긴다 / 기즈모 방식을 바꾼다 / 속성 칸에 글자를 친다 / 오브젝트 목록을 누른다 → I를 다시 누른다"는 세 화면 모두에서 I를 그대로 둔다. 사이에 아무것도 누르지 않고 천천히 다시 누를 때만 아래 공간으로 넘어간다.

### 7.4 보조 평면도

- 공간을 `stackedSpaces(map)` 순서로 그린다(BackgroundMapPlanPreview.tsx:188). 기호·카메라의 줄(:189-190)은 그대로다.
- 클릭: `nextPlanSelection`에 인자 셋을 더한다 — 여섯째 `point?: BackgroundPoint`, 일곱째 `again = false`, 여덟째 `repeat = false`(연속 클릭인가).
  - 눌린 것이 카메라·기호: 지금과 같다(`planStackUnder`. `point`·`again`·`repeat`을 보지 않는다 — 겹친 카메라는 지금처럼 클릭마다 넘어간다).
  - 눌린 것이 **공간**: `point`가 있고 `again`이면 더미 = `planPileAt(map, hitId, point, tolerance, covers)`이고, 선택된 것이 그 안에 있으면 — **`repeat`이면 선택된 것 그대로**(넘기지도, 맨 위 것으로 되돌리지도 않는다), 아니면 그 다음 것. 그 밖에는 `hitId`(맨 위 것).
- 노드의 클릭이 클릭 횟수를 함께 알린다: `Activate`(:15)를 `(id: string, cycle: boolean, point?: BackgroundPoint, repeat?: boolean) => void`로 넓히고, `nodeButton`의 `onClick`(:31)이 `onActivate(node.id, true, clickPoint(event), event.detail >= 2)`를 부른다. 키보드로 고르는 길(`onActivate(node.id, false)`, :34)은 그대로다.
- `activate`(:163-168)가 받은 `point`·`repeat`과, 자기 기억으로 구한 `again`을 넘긴다:
  ```ts
  /** What the last click landed on and what it left selected: the same spot clicked again is told from it. */
  const turn = useRef<{ hitId: string; pickedId: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);                       // <svg className="bmap-plan-svg" ref={svgRef} …> (:185)
  // A selection made elsewhere ends it (written during render like `latest`, never drawn from).
  if (turn.current && turn.current.pickedId !== selectedId) turn.current = null;
  // So does a press that is no left press on this plan: anywhere else (the 3D view, the inspector, the object list, the
  // toolbar), or on the plan with another button. The same spot is pressed anew after it, as on the main plan.
  useEffect(() => {
    const forget = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !svgRef.current?.contains(event.target) || !event.isPrimary || event.button !== 0) turn.current = null;
    };
    window.addEventListener('pointerdown', forget, true);
    return () => window.removeEventListener('pointerdown', forget, true);
  }, []);
  // …activate 안에서 (id, cycle, point, repeat = false):
  const again = cycle && turn.current?.hitId === id && turn.current.pickedId === now.selectedId;
  const next = cycle ? nextPlanSelection(now.map, id, now.selectedId, Math.max(12, PLAN_MARK.dot * 2 * now.scale), covers, point, again, repeat) : id;
  // Only a click leaves a spot behind. A keyboard pick (`cycle` false) pressed no spot: the first click after it is a first press.
  turn.current = cycle ? { hitId: id, pickedId: next } : null;
  now.onSelect(next);
  ```
- **자리 기억은 클릭만 적는다**(`cycle`). 키보드로 고른 것(노드에 포커스를 두고 Enter·Space — `cycle` 거짓, :32-35)은 눌린 자리가 없으므로 적지 않고 비운다. 적으면 키보드로 안쪽 방을 고른 뒤 그 방을 **처음** 클릭한 것이 "다시 누름"이 되어(`turn.hitId`가 그 방이고 `pickedId`가 지금 선택이다. 그 클릭의 누름은 보조 평면도 위의 왼쪽 누름이라 `forget`도 지나친다) 바깥 방으로 넘어간다 — "처음 누르면 맨 위 공간"(7.1)에 어긋난다. 평면에서도 키보드로 고르는 길(노드의 Enter → `select(node.id)`, BackgroundMapEditor.tsx:849, :860, :874)은 자리 기억(`lastSpot`)을 적지 않는다.
- **기억이 끝나는 때**는 평면·3D와 같다(7.3 끝의 표). 보조 평면도 밖의 누름 — 3D 캔버스에서 고르거나 둘러보기, 속성 칸에 글자 치기, 오브젝트 목록, 도구줄 — 과 보조 평면도 위의 왼쪽 주 버튼이 아닌 누름이 `turn`을 지운다. 편집기의 누름 기록(BackgroundMapEditor.tsx:313-319)과 같은 꼴의 창 캡처 리스너다(`useEffect`를 이 파일의 react import에 더한다). 보조 평면도를 접으면 SVG가 없으므로(`viewBox`가 `null`, :183) 어느 누름이든 지운다. 선택이 **같은 것으로 다시 골라졌을 때**(오브젝트 목록에서 지금 선택된 그 방을 누름)는 렌더의 검사가 잡지 못하고 이 리스너가 잡는다.
- **연속 클릭은 공간을 넘기지 않는다**(7.1의 첫째 규칙). 보조 평면도에는 더블클릭 동작이 없지만, 방을 빠르게 두 번 눌러도 아래 공간으로 넘어가지 않는다: 둘째 클릭은 `repeat`이라 첫 클릭이 남긴 공간을 그대로 둔다(같은 id를 다시 알릴 뿐이다). 천천히 다시 누르면 클릭마다 넘어간다. 겹친 카메라·기호는 지금처럼 빠르게 눌러도 클릭마다 넘어간다. 바탕을 누르면 지금처럼 `onSelect(null)`이다(:185).
- 기존 호출(인자 다섯 이하)의 결과는 그대로다(`tests/backgroundMapPlanPreview.test.ts:357-429` 불변).

### 7.5 "어느 공간에 속하는가" 두 규칙

| | 새 기호(`placeSymbol`, :421) | 새 카메라(`addMapCamera`, mapGeometry.ts:225-230) |
|---|---|---|
| 지금 | 놓은 점을 품은 공간 가운데 **배열에서 마지막** = 그 자리에서 맨 위에 그려진 것 | 고정 생성점을 품은 공간이 **정확히 하나**일 때만. 겹치면 소속 없음 |
| 점을 고르는 사람 | 사용자가 놓을 자리를 누른다 | 아무도 고르지 않는다(늘 (500, 340)) |
| 이번 | **`spacesAt(base, point)[0]`** — 그 자리에서 맨 위(가장 작은) 공간. 바닥 높이도 그 공간 것(:423) | **그대로** |

- 기호: "놓은 자리에서 눌리는 그 공간에 속한다"는 뜻을 유지한다. 맨 위의 뜻이 배열 순서에서 넓이 순서로 바뀌었으므로 따라 바꾼다. 3D의 바닥 놓기도 같은 `placeSymbol`을 지난다(:761).
- 카메라: 생성점은 사용자가 고른 자리가 아니다. 건물 외곽 안에 방을 그린 도면(이번 차례가 겨냥한 바로 그 도면)에서는 생성점이 외곽과 방 둘에 들기 쉽고, "가장 작은 공간"으로 바꾸면 새 카메라가 우연히 그 점을 덮은 방에 자동으로 묶인다. 카메라를 다른 방으로 옮겨도 소속은 따라오지 않으므로(소속은 만들 때와 속성 칸의 '카메라가 있는 공간'에서만 정한다, :960), 그 방을 옮길 때 엉뚱한 카메라가 끌려간다. 모호하면 소속 없음이 안전하다. **고정 테스트(`tests/backgroundMapGeometry.test.ts:234-254`)는 바뀌지 않는다.**
- 저장 자료는 어느 쪽도 바뀌지 않는다(`spaceId`는 그대로 id 하나다. 기존 노드의 소속을 다시 계산하지 않는다).

### 7.6 ③의 도로가 들어올 자리

도로(공간의 한 종류, 다른 공간 **아래**에 그린다)는 `mapStack.ts`의 비교 함수에 **맨 앞 항 하나**(층: 도로 0, 그 밖 1)를 더하면 끝난다. `stackedSpaces`·`spaceStackRanks`·`spacesAt`을 읽는 다섯 곳(4절)은 고칠 것이 없다. 새 카메라의 "정확히 하나" 셈에서 도로를 빼는 것은 ③의 일이다(라운드 계획 6절).

---

## 8. 새 상태가 사는 곳

| 상태 | 사는 곳 | 저장·되돌리기 |
|---|---|---|
| 선택 묶음(`selectedIds`)과 3D의 하나(`selectedId` — 선택 액션 뒤에는 대표, 3D에서 `pick-one`으로만 따로 움직인다) | 문서(`viewports`, 도면별) | 아님. 전환·되돌리기·저장에 그대로(3.4) |
| 그리는 중인 상자(`marquee` — `PlanRect \| null`) | 편집기 `useState` | 아님 |
| 스페이스를 누르고 있는지(`spaceHeld` ref + `spacePan` state — 포커스가 어디에 있든 적는다, 5.3), 화면을 옮기는 중인지(`panning`) | 편집기 | 아님 |
| 묶음 이동의 id들(`groupIds`)·뗄 때 할 일(`click`)·자리 기억에 적을 맨 위 노드(`spotId`) | `PointerSession`(ref) | 아님 |
| 미뤄 둔 넘기기(`pendingCycle` — `{ ids, from, mapId, spaces }`. `spaces`: 공간의 더미인가 — 연속 클릭은 그 더미를 넘기지 않는다, 7.2) | 편집기 `useRef`(기존) | 아님 |
| 같은 자리의 기억(`lastSpot` — `{ mapId, hitId, pickedId }`, 7.2) | 편집기 `useRef` | 아님 |
| 묶음 삭제 뒤 캔버스로 포커스(`focusAfterConfirm`, 6.4) | 편집기 `useRef` | 아님 |
| 3D: 같은 자리의 기억(`turn` — 고르는 클릭이 적고, 고르는 누름이 아닌 캔버스 누름과 캔버스 밖의 누름이 지운다, 7.3), 첫 클릭이 겨눈 노드(`aimed`), 누름이 연속 클릭인지(`Press.repeat`) | `Map3DViewport`의 필드 | 아님 |
| 보조 평면도: 같은 자리의 기억(`turn` — 클릭만 적는다. 밖의 누름, 왼쪽 주 버튼이 아닌 누름, 키보드로 고르기가 지운다, 7.4) | 컴포넌트의 `useRef` | 아님 |
| 쌓임 순서 | 어디에도 없다. 읽을 때 `mapStack.ts`가 계산한다 | — |
| 위치·잠금·삭제 | 초안(기존 필드만) | 예 |

---

## 9. 편집기의 포인터 흐름 (바뀌는 곳만)

### 9.1 타입과 `pointerDown`

```ts
type PointerSession = {
  mode: 'pan' | 'marquee' | 'move' | 'resize' | 'rotate' | 'draw' | 'vertex';      // 'click' 이 사라지고 'marquee' 가 생긴다
  /* pointerId, mapId, initial, node, start, clientX, clientY, matrix, view, moved, scale, vertex, candidates: 그대로 */
  /** `move`: every selected node that travels along, or null for the one node. */
  groupIds: readonly string[] | null;
  /** What a release without movement does. */
  click: PlanPressClick;
  /**
   * The topmost node of a select-tool press that the press log took. Null for every other press. Written to `lastSpot`
   * on release, unless the press was dragged into a pan or a marquee (9.3).
   */
  spotId: string | null;
};                                                                                 // `stack` 필드는 없앤다(`click.kind === 'step'` 이 대신한다)
const NO_CLICK: PlanPressClick = { kind: 'none' };
/** The selection as the store has it right now (a handler may run before the next render), read against `map`. */
function liveSelection(mapId: string, map: BackgroundMap): MapSelection { return mapSelection(map, mapViewport(doc.getState(), mapId).selectedIds); }   // 컴포넌트 안, `select` 옆
```

`pointerDown(event, node?, handle?)` — 맨 앞부터 살아 있는 초안을 읽는 줄까지(:576-593)는 **그대로**다(`pendingCycle` 비우기, 가드 둘과 누름 기록 비우기, `preventDefault`, 팔레트 닫기, SVG 포커스, 고른 점 풀기, `live`). 그 아래(:594-626)를 다음 순서로 바꾼다. `hit` = `live`에서 다시 찾은 눌린 노드(지금의 `target` 첫 값, :594).

```ts
// The wheel button, the hand tool and a held Space only move the view, whatever was pressed.
const panning = event.button === 1 || tool === 'hand' || spaceHeld.current;
const drawing = canEdit && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'symbol');
const held = liveSelection(current.id, live);                                       // the selection at this very moment
// The same spot again: the select tool pressed this same topmost node last, and the one node that press left selected
// is still the selection. Every press the canvas takes ends that memory; a select-tool press that picks or moves the node it
// landed on writes it anew on release (a press dragged into a pan or a marquee does not).
// An emptied press log (a press outside the canvas since then) ends it as well: it is read here, before this press is logged.
const spot = pressLog.current[1] ? lastSpot.current : null; lastSpot.current = null;
const again = sameSpotAgain(spot, current.id, hit?.id ?? null, held);
// The select tool (while viewing: any tool but the hand): what this press does is decided in one pure place.
const plan = panning || drawing || handle ? null : resolvePlanPress({ canEdit, shift: event.shiftKey, hit: hit ?? null,
  pile: hit ? planPileAt(live, hit.id, point, undefined, item => planMarkCovers(item, point)) : [],
  selection: held, again, node: id => live.nodes.find(item => item.id === id) });
if (plan?.selectAtPress !== undefined) select(plan.selectAtPress);
// A press with Space held, and one the plan does not log (Shift), is no half of a double-click.
const press: PlanPress | null = plan ? (plan.logged ? { hitId: hit?.id ?? null, targetId: plan.targetId, handle: false } : null)
  : spaceHeld.current ? null : { hitId: hit?.id ?? null, targetId: handle ? null : hit?.id ?? null, handle: !!handle };
pressLog.current = press ? [pressLog.current[1], press] : NO_PRESSES;
if (!panning && canEdit && !handle && tool === 'polygon') { /* 지금의 점 추가 블록(:606-612) 그대로 */ return; }
if (!panning && canEdit && !handle && tool === 'symbol') { placeSymbol(point, live); return; }
let mode: PointerSession['mode'] = 'pan', target = hit;
if (!panning) {
  if (canEdit && (tool === 'rect' || tool === 'ellipse')) { mode = 'draw'; target = newSpace(tool, point); }
  else if (plan) { mode = plan.drag; target = plan.nodeId === null ? undefined : live.nodes.find(item => item.id === plan.nodeId); }
  else if (handle && canEdit && target && !target.locked) mode = typeof handle === 'object' ? 'vertex' : handle;
}
// One drag is one gesture of the shared document. A pan and a marquee never touch it.
if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;
```

- 그 뒤(점 손잡이의 `setActiveVertex`, 세션 기록 **한 곳**, `altDrag`, 포인터 캡처, :623-628)는 그대로이고 세션에 `groupIds: plan?.groupIds ?? null`, `click: plan?.click ?? NO_CLICK`, `spotId: plan?.logged && hit ? hit.id : null`을 싣는다.
- `lastSpot`을 읽고 비우는 줄은 가드 둘(:582, :584)을 지난 뒤에 있다(맨 앞의 줄들과 그 앵커는 그대로다). 편집기가 받지 않은 누름(저장 중, 오른쪽 버튼)은 가드에서 누름 기록을 비우므로 자리 기억도 거기서 끝난다. 화면 이동·그리기·손잡이·빈 곳·Shift 누름은 `spotId`가 `null`이라 비운 채 끝난다(6.1의 `again` 1번 조건). `spotId`가 선 누름이라도 끌려서 화면 이동이나 상자로 끝나면 `pointerUp`이 적지 않으므로(9.3) 역시 비운 채 끝난다.
- 캔버스 밖을 누르면 자리 기억이 끝난다: 그 누름은 누름 기록을 비우고(창 단위 처리기, :313-319), 위의 줄은 누름 기록의 마지막 칸이 비어 있으면 자리 기억을 읽지 않는다. 창 단위 처리기와 그 앵커(16)는 고치지 않는다. 캔버스가 받지 않은 누름은 더블클릭의 반쪽도, "같은 자리를 다시 누름"의 앞 누름도 아니다. 이 줄은 이번 누름을 누름 기록에 적는 줄보다 **앞**에 있어야 한다(뒤에 두면 방금 적은 자기 자신을 본다).
- 누름 기록을 적는 줄은 지금처럼 다각형·기호 도구의 이른 반환보다 **앞**에 한 번 있다(지금의 :604).
- 손잡이와 그리기 도구의 결과는 지금과 같다(사각형·타원 도구에서는 손잡이를 눌러도 그린다, 다각형·기호 도구에서 손잡이를 누르면 손잡이가 듣는다 — v1.131.0 그대로). '화면 이동' 도구·휠 버튼의 누름 기록도 지금과 같다.
- 보기 모드에서 도구 값이 그리기 도구로 남아 있더라도 `drawing`이 `canEdit`을 요구하므로 `resolvePlanPress`로 간다. 지금의 `tool === 'select' || !editing`(:595)과 같은 뜻이다.
- 살아 있는 선택을 읽는다(`liveSelection` — `doc.getState()`): SVG가 포커스를 받으며 숫자 칸이 확정됐을 수 있다(지금의 `live`와 같은 이유).
- `onPlanMark`(:84-85)는 지우고 `planMarkCovers`(mapPlanSelect.ts)를 import한다. 숫자는 같다(`MAP_EDIT_MARK.cameraRing` 18 / `cameraBody` 12 / `cameraFan` 80, mapPlanEdit.ts:7).
- `planGestureOf`(:91-97): 제외 목록의 `'click'`을 `'marquee'`로 바꾸고, 그 줄 앞에 `if (mode === 'move' && node && session.groupIds) return { mode: 'move-group', nodeId: node.id, ids: session.groupIds };`를 둔다.

### 9.2 `pointerMove`

4px 문턱(:635)까지 그대로. 그 아래:

```ts
const first = !session.moved;                                                       // 문턱을 넘은 첫 움직임
session.moved = true;
const delta = { x: point.x - session.start.x, y: point.y - session.start.y };
if (session.mode === 'pan') { if (first) setPanning(true); updateView({ x: session.view.x - delta.x, y: session.view.y - delta.y }, session.mapId); return; }
if (session.mode === 'marquee') { setMarquee(planRect(session.start, point)); return; }
if (!canEdit || !session.node) return;
// 이하(:640-649, previewPlanGesture → doc.previewGesture → showGuides) 그대로
```

### 9.3 `pointerUp`

세션 확인부터 `lastDrag` 갱신(:653-661)까지 그대로이고, `setPanning(false)`를 더한다. 그 아래:

```ts
if (session.mode === 'marquee') {
  setMarquee(null);
  if (!cancel && session.moved && canEdit) {
    const live = mapDraft(doc.getState(), session.mapId)?.value, point = pointFrom(event, session.matrix);
    if (live && point) doc.selectMany(session.mapId, planMarqueeIds(live, planRect(session.start, point)));
  }
} else if (session.mode !== 'pan') {
  if (cancel || !canEdit || !session.moved) doc.cancelGesture();
  else {
    doc.finishGesture();
    // A group stays selected as it is; a single node is the selection after its own drag.
    if (!session.groupIds && session.node) select(session.node.id, session.mapId);
    /* 그리기 뒤의 도구·이름 칸(:668), 끼워 넣은 점(:672-679): 그대로 */
  }
}
const liveMap = mapDraft(doc.getState(), session.mapId)?.value ?? session.initial;       // 보기 모드에는 초안이 없다
// A press that did not move does what resolvePlanPress said: pick, add or remove, or ask for the step to the next pile item.
if (!cancel && !session.moved) {
  const click = session.click;
  if (click.kind === 'select') select(click.id, session.mapId);
  else if (click.kind === 'toggle') {
    // Added to or taken out of the selection as it is now: the id of a node that is gone is dropped here, never carried along.
    const ids = liveSelection(session.mapId, liveMap).ids;
    doc.selectMany(session.mapId, ids.includes(click.id) ? ids.filter(id => id !== click.id) : [...ids, click.id]);
  }
  else if (click.kind === 'step') pendingCycle.current = { ids: click.ids, from: click.from, mapId: session.mapId, spaces: click.spaces };
}
// A select-tool press that picked or moved the node it landed on is remembered with the one node it left selected:
// the next press on the same spot may go on from it. A press dragged into a pan or a marquee picked nothing there.
if (!cancel && session.spotId !== null && !(session.moved && session.mode !== 'move')) {
  const left = liveSelection(session.mapId, liveMap);
  lastSpot.current = { mapId: session.mapId, hitId: session.spotId, pickedId: left.ids.length === 1 ? left.primaryId : null };
}
```

- 넘기기는 여전히 `pendingCycle`에 적어 두기만 하고 SVG의 `click`이 실행한다(7.2). 실행할지는 그 `click`의 클릭 횟수가 정한다: 공간의 더미(`spaces`)는 연속 클릭이면 넘기지 않고, 카메라·기호의 더미는 그 더블클릭이 무언가를 할 때만 넘기지 않는다. `pointerUp`은 클릭 횟수를 모른다(`pointerup`은 싣지 않는다). `select`·`toggle`은 여기서 바로 한다 — 더블클릭의 둘째 누름이 그 결과를 봐야 한다.
- `pointerUp` 안의 `select(` 호출은 정확히 둘이다: 끌기가 끝난 뒤의 `select(session.node.id, session.mapId)`와 클릭의 `select(click.id, session.mapId)`. 넘기기를 여기서 바로 하는 줄(`select(click.ids[…])`)은 없다(12.8 앵커 5).
- **자리 기억은 그 누름이 눌린 자리의 노드를 고르거나 옮겼을 때만 적는다**(`!(session.moved && session.mode !== 'move')`). `spotId`가 선 세션의 모드는 `resolvePlanPress`가 정한 `pan`·`marquee`·`move` 셋뿐이므로(9.1), 이 조건은 다음과 같다:

  | 그 누름 | 적는가 | 까닭 |
  |---|---|---|
  | 움직이지 않고 뗌(어느 모드든) | 적는다 | 뗄 때 그 노드를 골랐거나(`select`), 누를 때 골랐거나(`selectAtPress`), 넘기기를 맡겼다(`step` — 실행되면 SVG의 `click`이 `pickedId`를 고친다, 7.2) |
  | 끌어서 노드를 옮김(`move`) | 적는다 | 넘겨서 고른 아래 공간을 그 자리에서 끈 뒤에도, 다시 그 자리를 누르면 그 공간이 대상이어야 한다(13절 O7) |
  | 끌어서 화면이 움직임(`pan` — 보기 모드에서 노드 위에서 시작한 끌기) | **적지 않는다** | 아무것도 고르지 않았다. 적으면 "지금 유일하게 선택된 것"(다른 길로 골라 둔 것)이 "이 누름이 남긴 것"으로 적혀, 그 노드를 다음에 처음 누르는 것이 다시 누름이 된다: 세 겹에서 가운데를 골라 둔 채 작은 방 위에서 화면을 옮긴 뒤 작은 방을 누르면 맨 아래 것이 잡히고, 연결된 방의 더블클릭이 골라 둔 바깥 공간에 작용한다(6.1) |
  | 끌어서 상자가 됨(`marquee` — 잠긴 것 위에서 시작한 끌기, 6.1의 5·8·10번) | **적지 않는다** | 선택은 상자에 닿은 것이지 눌린 노드가 아니다 |

  묶음이 선택된 채 끝난 누름은 `pickedId`가 `null`이라 다음 누름이 처음 누름이다.
- `pan` 세션도 맨 아래 두 블록을 지난다: 움직이지 않았으면 고르고(보기 모드의 "움직이지 않고 떼면 고른다") 자리 기억을 적으며, 움직였으면 둘 다 하지 않는다. 지금의 `if (session.mode === 'pan') return;`(:662)은 없앤다.

### 9.4 `abortGesture` · 그리기 · 그 밖

- `abortGesture`(:279-285)에 `setMarquee(null); setPanning(false);`를 더한다.
- 렌더에서:
  ```ts
  const marqueeIds = useMemo(() => marquee && current ? planMarqueeIds(current, marquee) : null, [marquee, current]);
  // While a box is drawn, what it touches is shown as the selection it will become.
  const shownIds = useMemo(() => new Set(marqueeIds ?? selection.ids), [marqueeIds, selection]);
  ```
  공간·기호·카메라의 `is-selected`(와 기호 이름을 보이는 조건, :864)는 `shownIds.has(node.id)`.
- 공간은 `stackedSpaces(current).map(...)`로 그린다(:847).
- 상자: 안내선(:883) 다음, 손잡이 앞에 `{marquee && <MapMarquee rect={marquee} />}`.
- SVG의 `className`: `` `bmap-canvas tool-${tool}${spacePan && !gestureActive && !marquee ? ' is-space-pan' : ''}${panning ? ' is-panning' : ''}` ``(5.6).
- `placeSymbol`(:421): `const containingSpace = spacesAt(base, point)[0];`
- `confirmAction`·`keyboard`·속성 칸·도구줄·힌트: 6.4, 6.6, 6.5, 5.1, 10.3.
- `select`(:335)의 본문을 6.7대로 바꾼다(`doc.dispatch(pickAction(…))` 한 줄). `selectNode`·`clearSelection`(:754-755)과 그것을 받는 세 곳(`Map3D` :896, `BackgroundMapPlanPreview` :903, `ObjectList` :983)의 `onSelect={selectNode}`는 그대로다. 두 화면에 넘기는 `selectedId`만 `singleId`로 바꾸고(3.5), `openSpaceFrom3D`(:767)는 7.3대로 바꾼다.

---

## 10. 화면 조각 · CSS · 문구

### 10.1 조각

- `BackgroundMapPlanOverlays.tsx`에 더한다: `export function MapMarquee({ rect }: { rect: PlanRect }): JSX.Element` — `<rect className="bmap-marquee" x={rect.left} y={rect.top} width={rect.right - rect.left} height={rect.bottom - rect.top} pointerEvents="none" aria-hidden="true" />`. 받은 값만 그린다.
- `BackgroundMapSelectionSummary.tsx`(새 파일, 6.5). 편집기의 속성 칸에서 `selected ? 지금의 양식 : mode === 'plan' && multiple ? <BackgroundMapSelectionSummary … /> : 지금의 도면 구성`. 그 앞, 속성 칸의 첫 줄에 `{mode === '3d' && multiple && <p className="bmap-hint">…</p>}`(6.5의 3D 안내 한 줄).
- `ObjectList`(:151-164): props를 `{ nodes, selectedIds, primaryId, onSelect }`로. 줄의 `is-selected`는 `selectedIds.includes(node.id)`, `aria-current`는 `node.id === primaryId`일 때만. 넘기는 값은 제스처가 시작될 때의 도면으로 구하고 **메모한다**. 평면에서는 묶음 전체와 그 대표, 3D 모드에서는 3D의 하나뿐이다(3D 화면이 강조하는 것과 목록이 강조하는 것이 같다):
  ```ts
  const listSelection = useMemo((): MapSelection => {
    const group = mapSelection(settledCurrent, view.selectedIds);
    if (mode === 'plan') return group;
    const id = singleViewId(settledCurrent, group, view.selectedId);                       // 3D: the one node the 3D view marks
    return id === null ? mapSelection(undefined, group.ids) : { ids: [id], primaryId: id }; // none: the shared empty selection
  }, [settledCurrent, view.selectedIds, view.selectedId, mode]);
  ```
  → `selectedIds={listSelection.ids} primaryId={listSelection.primaryId} onSelect={selectNode}`. 끄는 동안 다시 그리지 않게 하려는 것이다(지금의 `settledCurrent`와 같은 이유, :983). 메모가 없으면, 사라진 노드의 id가 저장된 목록에 남아 있는 동안 `mapSelection`이 부를 때마다 새 배열을 돌려주어(3.3) `memo`로 감싼 목록(:151)이 미리보기 프레임마다 다시 그려진다.

### 10.2 CSS (`backgrounds-map.css`)

| 선택자 | 내용 |
|---|---|
| `.bmap-marquee` | `fill:rgb(var(--color-accent) / .08); stroke:rgb(var(--color-accent-sub)); stroke-width:1; stroke-dasharray:4 3; vector-effect:non-scaling-stroke; pointer-events:none;` — 변수라서 어두운·밝은 화면 모두 따라간다 |
| `.bmap-canvas.is-space-pan` | `cursor:grab;` |
| `.bmap-canvas:is(.tool-hand,.is-space-pan) *` | `cursor:grab;` — 노드(`.bmap-space` 등의 `pointer`)와 손잡이 위에서도 같은 커서 |
| `.bmap-canvas.is-panning, .bmap-canvas.is-panning *` | `cursor:grabbing;` — 위 두 규칙 뒤에 둔다 |

- **커서 규칙 셋의 자리: 파일에서 캔버스의 커서를 정하는 마지막 규칙보다 뒤**, 곧 `.bmap-canvas.tool-symbol { cursor:crosshair; }`(:177)와 `.bmap-symbol { cursor:pointer; }`(:188)의 뒤에 이 순서로 둔다. `.bmap-canvas.is-space-pan`·`.bmap-canvas.is-panning`은 `.bmap-canvas.tool-symbol`·`.bmap-canvas.tool-rect`(:46)와 특이도가 같아서(클래스 둘) **뒤에 온 것이 이긴다**. :69 근처에 두면 기호 도구에서는 스페이스를 누르고 있어도, 화면을 옮기는 중에도 바탕이 십자 커서로 남는다(자식에 거는 `*` 규칙은 자식만 고친다). `*` 규칙은 `.bmap-handles .bmap-camera-direction`(:69)과 특이도가 같으므로 그 뒤여야 하는데, :188 뒤면 함께 채워진다.
- 전환·애니메이션·`backdrop-filter`를 넣지 않는다(R14). 동작 줄이기용 짝 규칙도 필요 없다.
- 묶음 요약의 버튼 줄은 기존 `.bmap-symbol-actions`(:202-203)를 그대로 쓴다. 새 클래스를 만들지 않는다.
- 여러 개가 선택됐을 때의 강조는 기존 `.is-selected` 그대로다.

### 10.3 문구

| 자리 | 문구 |
|---|---|
| 도구줄 | 5.1 |
| 아래 줄 힌트 — 평면 · '화면 이동' 도구 | `끌어서 화면 이동 · 휠로 확대 · 배치는 움직이지 않아요` |
| 〃 — 평면 · 편집 중 · 여러 개 선택 | `끌어 함께 옮기기 · Shift+클릭으로 더하고 빼기 · Delete 삭제 · 빈 곳 클릭으로 풀기` |
| 〃 — 평면 · 편집 중(그 밖. 점 손잡이·확대 안내·다각형·기호의 문구는 지금 그대로 먼저 본다, :792-796) | `끌어 옮기기 · 빈 곳 끌어 여러 개 선택 · Shift+클릭 추가 · 더블클릭 이름` |
| 〃 — 평면 · 보기 | `클릭해 선택 · 끌어 화면 이동 · 공간 더블클릭으로 상세 도면 · 휠 확대` |
| 〃 — 3D | 지금 그대로 |
| 묶음 요약·확인 창·3D의 한 줄 | 6.4, 6.5 |

평면의 힌트를 고르는 순서(:792-797의 사슬에 둘을 끼운다): 기호 놓기 → 다각형 도구 → **'화면 이동' 도구** → 점 손잡이가 보임 → 점 손잡이가 숨겨진 다각형 → **편집 중 · 여러 개 선택** → 편집 중 → 보기.

평면의 아래 줄 힌트는 ①에서 두 줄로 고정돼 있다(backgrounds-map.css:90). 좁은 창에서 넘치면 말줄임이고 `title`로 전체가 보인다. 선택에 따라 문구가 바뀌어도 도면이 밀리지 않는다.

---

## 11. 파일 계획

새 파일

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapStack.ts` | 겹친 공간의 쌓임 순서 하나: 넓이, 아래→위 목록, 번호표, 한 점을 품은 공간들 (순수. 평면과 3D가 함께 쓴다) |
| `src/features/backgrounds/mapPlanSelect.ts` | '선택' 도구의 누름 판정(`resolvePlanPress`)과 "같은 자리를 다시 눌렀는가"(`PlanSpot`·`sameSpotAgain`), 상자의 모양별 "닿았다"(`planRect`·`planRectTouches`·`planMarqueeIds`), 카메라·기호의 "포인터 아래"(`planMarkCovers`) (순수, three.js·DOM 없음) |
| `src/features/backgrounds/BackgroundMapSelectionSummary.tsx` | 여러 개 선택의 속성 칸 요약(개수·구성·묶음 동작 버튼) |
| `tests/backgroundMapStack.test.ts` · `tests/backgroundMapPlanSelect.test.ts` | 12절 |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `mapDocument.ts` | `MapViewport.selectedIds`와 `selectedId`의 새 뜻(3D의 하나), 액션 `select-many`·`pick-one`, `select`의 규칙, `mapSelection`·`MapSelection`·`singleViewId`·`pickAction`. 문서 키는 그대로 |
| `useBackgroundMapDocument.ts` | `selectMany` |
| `mapGeometry.ts` | `moveMapNodes`·`removeMapNodes`·`lockMapNodes` |
| `mapPlanGesture.ts` | `PlanGesture`의 `move-group`, 그 미리보기와 후보 |
| `mapPlanEdit.ts` | `planDoubleClickAction` |
| `mapPlanPreview.ts` | `planPileAt`, `nextPlanSelection`의 여섯째~여덟째 인자(`point`, `again`, `repeat`) |
| `BackgroundMapPlanPreview.tsx` | 공간을 쌓임 순서로 그리기, 클릭 점·`again`·연속 클릭 여부 넘기기(`turn` ref, `Activate`의 넷째 인자), 밖의 누름에 `turn` 지우기(창 캡처 `pointerdown`, `svgRef`) |
| `BackgroundMapPlanOverlays.tsx` | `MapMarquee` |
| `map3dScene.ts` | `pickMapFloor`의 순서, `mapFloorPile`·`mapClickAim`, `resolveMapClick`의 공간 더미와 `again`·`repeat` |
| `BackgroundMap3D.tsx` | `Press.repeat`, `turn`·`aimed`, `click`·`clickHandle`을 `pick` 하나로, `opens`·`doubleClickNode`, `onMouseDown`·`onPointerUp`·`onDoubleClick`·`update`의 해당 줄, `turn`을 끝내는 줄들(`onPointerDown`·`onPointerUp`·`onPointerCancel`·기즈모의 `onCancelGesture`)과 창 캡처 `pointerdown`(`onPressElsewhere` — `start`에서 붙이고 `dispose`에서 뗀다) |
| `BackgroundMapEditor.tsx` | 3.5의 읽는 값, 9절의 포인터 흐름(`lastSpot` 포함), 스페이스(5.3 — `tickInputs`·`spaceEntry` 상수와 `onSpaceKey`), 도구줄·힌트 문구, 넘기기와 `doubleClickIntent`·`openSpace`, `select`의 3D 규칙(`pickAction`)과 3D 안내 한 줄, 묶음 삭제·잠금·Delete와 그 뒤의 포커스, Esc의 상자 취소, 속성 칸 분기, `ObjectList` props, 쌓임 순서로 그리기, 새 기호의 소속. 판정은 순수 모듈로, 요약은 새 컴포넌트로 나가므로 편집기에는 배선만 는다 |
| `backgrounds-map.css` | 10.2 |
| `tests/backgroundMapDocument.test.ts` · `backgroundMapGeometry` · `backgroundMapPlanGesture` · `backgroundMapPlanEdit` · `backgroundMapPlanPreview` · `backgroundMap3dScene` · `backgroundMapEditorWiring` | 12절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 14절 |

건드리지 않는 파일: `types.ts`, `domain.ts`, `mapSpatial.ts`, `mapEditSession.ts`, `mapSnap.ts`, `mapWorkflow.ts`, `mapCanvas.ts`, `mapGallery.ts`, `BackgroundMapGallery.tsx`, `BackgroundMapNameBox.tsx`, `BackgroundMapCameraGizmo.ts`, `BackgroundMapPanels.tsx`, `electron/**`, `DEVLOG/migrations/**`, `src/features/playground/featureFlag.ts`.

모듈 의존(한 방향):

- `mapStack.ts → mapGeometry.ts → mapSpatial.ts`
- `mapPlanPreview.ts → mapStack.ts`(+ 지금의 `mapGeometry.ts`·`mapSpatial.ts`)
- `mapPlanSelect.ts → mapPlanEdit.ts`·`mapPlanPreview.ts`·`mapSpatial.ts`, 그리고 `mapDocument.ts`에서 `import type`만
- `mapPlanGesture.ts → mapSnap.ts → mapGeometry.ts`(지금 그대로)
- `map3dScene.ts → mapStack.ts`(+ 지금의 import). 3D 파일은 `mapPlanSelect`·`mapPlanEdit`·`mapPlanGesture`·`mapSnap`을 import하지 않는다(12.8 앵커 10)
- `mapGeometry.ts`·`mapDocument.ts`는 새 모듈을 import하지 않는다

---

## 12. 테스트

모두 `node --test ./tests/background*.test.ts`(`npm run test:background`)에 자동으로 들어간다. 아래 숫자는 설계 중 임시 스크립트로 지금의 `containsPoint`·`nodePlanOutline`·`snapMove`·`transformMapSpace`에 대고 계산했다.

### 12.1 고정 값이 바뀌는 기존 테스트

| 위치 | 지금 | 바뀐 뒤 |
|---|---|---|
| `tests/backgroundMapDocument.test.ts:256` | `{ x: 30, y: -20, zoom: 2, selectedId: camera.id }` | `selectedIds: [camera.id]`를 더한다 |
| 〃 `:257` | `{ x: 0, y: 0, zoom: 1, selectedId: 'space-in-b' }` | `selectedIds: ['space-in-b']`를 더한다 |
| 〃 `:258` | `{ x: 0, y: 0, zoom: 1, selectedId: null }` | `selectedIds: []`를 더한다 |
| 〃 `:268` | `{ x: 0, y: 0, zoom: 0.5, selectedId: camera.id }` | `selectedIds: [camera.id]`를 더한다 |
| `tests/backgroundMap3dScene.test.ts:340-353` | 주석 "the later space is on top", `top = nested.nodes[1]` — `mapOf([inner, outer])`에서는 `outer`가 위 | 주석 "the smaller space is on top, whatever the order in the map", **`top = inner`**(두 순서 모두) |
| 〃 `:367` | `pickMapNode([…outer 80, inner 80.00000001], mapOf([inner, outer]))` → `outer.id` | → **`inner.id`** |
| 〃 `:1616` | `mapOf([classroom, corridor, nook])` | **`mapOf([nook, classroom, corridor])`** — 안쪽 방을 배열 맨 앞에 둔다. 그 아래의 기대값(:1617-1634)은 한 글자도 바뀌지 않는다(옛 규칙이면 :1624가 실패한다) |

`tests/backgroundMap3dScene.test.ts:449-453`(주석 "…and a space never cycles")은 **그대로**다: 인자 셋으로 부른 `resolveMapClick`은 `again`이 없어 공간을 넘기지 않는다(7.3).

같은 파일의 :262-265(`viewports` 정체), :277-288(전환은 액션이 아니다, 문서 키), :368-370, :1700-1730, 그리고 `tests/backgroundMapGeometry.test.ts:234-254`(카메라 소속), `:426-443`(`stackedMapNodeIds`), `tests/backgroundMapPlanPreview.test.ts:357-429`는 **손대지 않고 통과**해야 한다. 확대·보기 테스트(`tests/backgroundMapDocument.test.ts:320-372`)는 손으로 만든 보기 값을 펼쳐 돌려받으므로 그대로 통과한다(테스트는 타입 검사를 받지 않는다 — `tsconfig.json`의 `include`는 `src`뿐이다).

### 12.2 `tests/backgroundMapDocument.test.ts`에 더하는 것

- `select`: 묶음 `[a, b]`(대표 b)에서 `select b` → `[b]`(이른 반환이 없어졌다). `select null` → `[]`, `selectedId: null`. 같은 선택을 다시 → 받은 `state` 그대로(`===`).
- `select-many`: 바꿔 넣기(중복 제거, 순서 유지, 대표는 마지막), 빈 목록 → 풀림, 같은 id·같은 순서의 목록 → 받은 `state` 그대로(`===`), 다른 도면의 보기 값은 `===`. `set-viewport`(화면 옮기기·확대) 뒤에도 `selectedIds`가 **같은 배열**(`===`)이다(3.3의 메모가 기대는 성질).
- 더하기·빼기 액션은 없다: `{ type: 'toggle-select', … }`와 `add: true`를 실은 `select-many`를 보내도 각각 "받은 `state` 그대로"와 "바꿔 넣기"다(리듀서가 `add`를 읽지 않는다).
- 불변식: `select`·`select-many`를 섞은 열 번의 진행마다 `selectedId === (selectedIds[selectedIds.length - 1] ?? null)`.
- **`pick-one`은 선택을 건드리지 않는다**: 묶음 `[a, b]`에서 `pick-one x` → `selectedIds`가 그 전과 **같은 배열**(`===`), `selectedId`가 `'x'`, `coalescing`이 `null`, `drafts`가 `===`. `pick-one null` → `selectedId: null`, 목록은 같은 배열. 같은 id를 다시 → 받은 `state` 그대로(`===`). 다른 도면의 보기 값은 `===`. 이어서 `set-viewport` → `selectedId`가 그대로 실려 간다.
- **평면의 선택 액션은 `selectedId`를 대표로 되돌린다**: 위의 `pick-one x` 뒤에 `select-many [a, b]`(같은 목록) → 받은 `state`가 아니라 `selectedId: 'b'`인 새 보기 값(목록만 같으면 그대로 돌려주는 구현이 여기서 떨어진다). 한 번 더 같은 `select-many` → 이번에는 받은 `state` 그대로(`===`). `pick-one x` 뒤에 `select a` → `['a']`·`selectedId: 'a'`.
- **사라진 id는 선택을 손댈 때 떨어진다**(3.2의 순서 그대로): 공간 S를 더하고 `select S` → `undo`(S가 없다. 저장 목록은 `[S]`, `mapSelection(초안, 저장 목록).ids`는 `[]`) → 편집기의 Shift+클릭과 같은 식으로 `select-many`에 `[...mapSelection(…).ids, 의자]`를 보낸다 → `redo` → `mapSelection(…).ids`가 `['의자']`(S가 끼어들지 않는다). 견주는 경우: 선택을 손대지 않고 `undo` → `redo`만 하면 `['S']`가 돌아온다.
- `singleViewId`(3.3의 표. 도면에 `a`·`b`·`c`·`x`가 있다): 선택 `[a]`·`selectedId` `'a'` → `'a'`. 선택 `[a]`인데 `selectedId`가 `'x'`(묶음이 하나로 줄기 전에 옮겨 둔 값) → `'a'`. 빈 선택 → `null`(`selectedId`가 무엇이든). 선택 `[a, b]`·`selectedId` `'b'` → `'b'`. `'a'` → `'a'`. 묶음 밖의 `'x'` → `'x'`. `null` → `null`. 도면에 없는 `'gone'` → `'b'`(대표로). 도면이 `undefined` → `null`.
- `pickAction`(3.3의 표): 선택 `[a, b]`·`singleView` 참 → `{ type: 'pick-one', mapId, id }` — `id`가 `'b'`(대표)·`'a'`(묶음 안)·`'x'`(묶음 밖)·`null` 넷 모두. 같은 선택·`singleView` 거짓 → 넷 모두 `{ type: 'select', mapId, id }`. 선택 `[a]`와 빈 선택은 `singleView`가 참이어도 `select`. 사라진 노드가 섞인 저장 목록 `[a, gone]`은 살아 있는 선택이 하나라 `select`.
- **3D에서 고른 것은 묶음을 바꾸지 않는다**(리듀서와 두 함수를 이어서, 편집기의 3D 모드 `select`와 같은 식으로 `reduce(state, pickAction(mapId, id, true, mapSelection(도면, mapViewport(state, mapId).selectedIds)))`): `select-many [a, b, c]` 뒤에 `x`, `null`, `a`, `c`, `x`를 차례로 고른다 → 매번 `selectedIds`가 처음의 그 배열(`===`)이고 `singleViewId(…)`가 방금 고른 것이다. 보조 평면도가 보내는 넘기기 결과도 같다: 같은 자리의 카메라 셋(`camA`·`camB`·`camC`)에서 `[a, camB]`를 고르고 `nextPlanSelection(도면, 'camA', 'camB')`의 결과(`'camC'`, 묶음 밖)를 같은 식으로 보낸다 → `selectedIds`는 같은 배열, `singleViewId`는 `'camC'`. 견주는 경우: 선택이 `[a]`일 때 같은 식으로 `x`를 고르면 `selectedIds`가 `['x']`다(지금의 3D와 같다).
- 선택이 달라지면 `coalescing`이 `null`, 같으면 유지.
- **선택은 편집과 무관하다**: `[a, b]`를 고른 뒤 `gesture-begin/preview/finish`, `undo`, `redo`, `discard`, `drop-drafts`를 차례로 — 매번 `viewports`가 같은 객체(`===`). 초안·`past`·`future`는 선택 액션으로 바뀌지 않는다(`drafts`가 `===`).
- **전환은 여전히 액션이 아니다**: 여러 개를 고른 상태에서 지금의 `set-mode` 반복(:281-282)을 돌려도 `state` 그대로.
- `mapSelection(map, 저장 목록)`: 모두 살아 있으면 `ids`가 저장된 배열과 `===`. 노드 하나를 뺀 도면이면 그 id만 빠지고 대표는 남은 것의 마지막. 대표가 죽었으면 그 앞의 것이 대표. 도면이 `undefined`거나 선택이 비었으면 `{ ids: [], primaryId: null }`이고 두 번 불러 같은 객체. 되돌리기로 노드가 사라졌다가 다시 실행으로 돌아오면 `ids`에 다시 든다.
- 스토어: `select-many`가 구독자에게 한 번 알리고, 같은 선택은 알리지 않는다.

### 12.3 `tests/backgroundMapStack.test.ts` (새)

- `spacePlanArea`: 사각형 800×520 → `416000`. 타원 160×140 → `17592.91886010284`(1e-9). 삼각형(100×50, 점 (0,0)(1,0)(0.5,1)) → `2500`. ㄱ자(200×100, 점 (0,0)(1,0)(1,0.4)(0.4,0.4)(0.4,1)(0,1)) → `12800`(1e-9). 점이 둘뿐인 다각형(100×50) → `5000`. 회전 37로 바꿔도 같은 값. **점의 순서를 거꾸로 뒤집은 삼각형과 ㄱ자도 같은 값**(`2500`, `12800` — 음수가 아니다. 부호를 남긴 구현이 여기서 떨어진다).
- `stackedSpaces`: `outer`(100, 80, 800×520)와 `inner`(400, 260, 160×140 타원) — `[inner, outer]`와 `[outer, inner]` 모두 `['outer', 'inner']`. **거꾸로 돈 큰 다각형**(0, 0, 400×400, 점 (0,0)(0,1)(1,1)(1,0)) 안의 작은 사각형(100, 100, 50×50): 두 순서 모두 `['큰 다각형', '작은 사각형']`이고 `spacesAt((120, 120))`이 `['작은 사각형', '큰 다각형']`. 같은 넓이 둘(`twinA`(0, 0, 100×100), `twinB`(50, 50, 100×100)): `[twinA, twinB]` → `['twinA', 'twinB']`, 거꾸로 주면 `['twinB', 'twinA']`(뒤에 있는 것이 위). 도면 `[closet(320, 220, 60×40), room(300, 200, 200×150), site(0, 0, 1000×680), floor(100, 80, 800×520), 의자, 카메라]` → `['site', 'floor', 'room', 'closet']`. 가로가 `NaN`인 공간은 맨 아래. 돌려받은 노드가 받은 객체와 `===`이고 `map.nodes`의 순서가 그대로다(전후 `JSON.stringify` 동일).
- `spaceStackRanks`: 위 도면에서 `site 0, floor 1, room 2, closet 3`. 공간이 아닌 id는 없다.
- `spacesAt`(위 도면): (340, 240) → `['closet', 'room', 'floor', 'site']`, (450, 300) → `['room', 'floor', 'site']`, (150, 100) → `['floor', 'site']`, (50, 50) → `['site']`, (−5, −5) → `[]`. 돌려 놓은 방·타원·다각형은 `containsPoint`와 같은 답.

### 12.4 `tests/backgroundMapPlanSelect.test.ts` (새)

`planRect`: 어느 쪽으로 끌어도 같은 상자(`(310, 210) → (90, 90)`과 그 반대).

`planRectTouches` — 방 R = (100, 100, 200×100)

| 대상 | 상자 | 결과 |
|---|---|---|
| R | (150,120)–(250,180) 안쪽 | 거짓 |
| R | (280,120)–(320,180) 오른쪽 벽을 가로지름 | 참 |
| R | (90,90)–(310,210) 통째로 감쌈 | 참 |
| R | (310,90)–(400,210) 밖 | 거짓 |
| R | (300,120)–(340,160) 벽에 딱 닿음 / (300.5,120)–(340,160) | 참 / 거짓 |
| R | 크기 0인 상자 (150,150) / (300,150) | 거짓 / 참 |
| R, 회전 30 (윤곽 ≈ (138.397, 56.699) (311.603, 156.699) (261.603, 243.301) (88.397, 143.301)) | (100,100)–(110,110) / (190,140)–(210,160) / (130,50)–(145,60) / (286,100)–(300,108) | 참 / 거짓(안쪽) / 참 / 거짓(돌리기 전 상자 안이지만 돌린 방 밖) |
| 타원 E = (100, 100, 200×100) | (180,130)–(220,170) 안 / (100,100)–(115,108) 감싼 상자의 귀퉁이 / (100,140)–(110,160) / 감쌈 / (301,140)–(320,160) / (300,140)–(320,160) 접함 | 거짓 / 거짓 / 참 / 참 / 거짓 / 참 |
| E, 회전 45 | (262,212)–(275,225) 긴 축의 끝 / (195,145)–(205,155) 가운데 | 참 / 거짓 |
| 가운데 아래가 파인 다각형 U = (100, 100, 200×200, 점 (0,0)(1,0)(1,1)(0.6,1)(0.6,0.5)(0.4,0.5)(0.4,1)(0,1)) | (150,220)–(250,280) 네 꼭짓점이 모두 안이지만 파인 곳을 걸침 / (120,220)–(160,280) 왼쪽 팔 안 / (190,220)–(210,280) 파인 곳 안 | 참 / 거짓 / 거짓 |
| 의자 (300, 300, 40×40) | (310,310)–(320,320) 안 / (335,335)–(360,360) / (341,300)–(360,320) | 참 / 참 / 거짓 |
| 의자, 회전 45 | (300,300)–(304,304) 돌리기 전 귀퉁이 / (318,290)–(322,293) 돌린 꼭짓점 | 거짓 / 참 |
| 의자, pitch 60 · 입체 높이 200 (드리운 윤곽이 y 503까지) | (310,400)–(330,420) 드리운 윤곽 안 / (310,310)–(330,330) | 거짓 / 참 |
| 카메라 (500, 340) | (512,330)–(520,350) 정확히 12 / (512.5,…) / (560,335)–(570,345) 부채꼴만 / (490,330)–(510,350) / (508,348)–(520,360) 대각 11.3 / (509,349)–(520,360) 12.7 | 참 / 거짓 / 거짓 / 참 / 참 / 거짓 |
| 수직 카메라 (pitch 90) | (517,330)–(530,350) / (519,330)–(530,350) | 참 / 거짓 |
| R | 상자의 값 하나가 `NaN` | 거짓 |

`planMarqueeIds` — 도면 `[site(0, 0, 1000×680), R, locked(600, 100, 100×100, 잠김), 의자 c(300, 300, 40×40), 카메라 cam(500, 340)]`: (90,90)–(310,210) → `['R']`(안에 든 상자라 `site`는 없다). (150,120)–(250,180) → `[]`. (−10,−10)–(1010,690) → `['site', 'R', 'locked', 'c', 'cam']`(도면 순서, 잠긴 것 포함). (590,150)–(610,160) → `['locked']`. 입력 도면을 바꾸지 않는다. **카메라에 가려 누를 수 없는 작은 공간**(16절): 위 도면의 끝에 `tiny(540, 335, 10×10)`(카메라가 오른쪽을 볼 때 그 부채꼴 아래. 카메라 점에서 40 떨어져 있다)와 `under(495, 335, 10×10)`(카메라 몸통 바로 아래)를 더하면 — (535,330)–(555,350) → `['tiny']`(부채꼴은 세지 않으므로 카메라가 끼지 않는다), (480,320)–(520,360) → `['cam', 'under']`(도면 순서. 이 묶음에서 카메라를 Shift+클릭으로 빼면 `under`만 남는다).

`planMarkCovers`: `planNodeCovers(node, point, 카메라면 수직 18 / 그 밖 12 · 기호면 0, 80)`과 같은 답(카메라 몸통·부채꼴·수직 고리, 기호 상자, 공간은 거짓) — `tests/backgroundMapPlanPreview.test.ts:384`의 `mainPlan`과 같은 점들로.

`sameSpotAgain` — 자리 기억 `{ mapId: 'm', hitId: 'I', pickedId: 'O' }`: (`'m'`, `'I'`, 선택 `[O]`) → 참. 선택 `[I]`(그 누름이 남긴 것이 아니다) → 거짓. 선택 `[O, c]`(여러 개) → 거짓. 선택 없음 → 거짓. 눌린 것이 `'J'`(다른 맨 위 노드) → 거짓. 눌린 것이 `null`(빈 곳) → 거짓. 도면이 `'n'` → 거짓. 자리 기억이 `null` → 거짓. `pickedId`가 `null`인 기억(묶음이 선택된 채 끝난 누름)은 어떤 선택에도 거짓.

`resolvePlanPress` — 6.1의 표를 줄마다. 노드: 방 `I`(안쪽), 방 `O`(바깥), 의자 `c`, 잠긴 방 `L`, 같은 자리의 카메라 `camA`·`camB`. `I` 위의 더미는 `[I, O]`. 따로 적지 않으면 `again`은 거짓이다. `step`에는 늘 `spaces`가 실린다 — 아래의 `step` 줄마다 함께 본다: 눌린 것이 방이면(`I`·`O`·`L`의 더미) `spaces: true`, 카메라·기호면(`camA`·`camB`의 더미) `spaces: false`. (`spaces`를 늘 거짓이나 늘 참으로 돌려주는 구현이 여기서 떨어진다.)

- 보기 모드: 빈 곳 → `pan`·`select null`. `I`(선택 없음) → `pan`·`select I`·`targetId I`. `I`(선택 `[I]`, `again` 참) → `step { ids: [I, O], from: I, spaces: true }`·`targetId I`. `I`(선택 `[O]`, `again` 참) → `step … from: O`·`targetId O`. Shift를 줘도 같은 결과. 어느 줄에도 `selectAtPress`가 없다.
- **보기 모드 · 처음 누름**(`again` 거짓): `I`(선택 `[I]`) → `select I`·`targetId I`(넘기지 않는다). **`I`(선택 `[O]`) → `select I`·`targetId I`**(O가 대상이 아니다).
- 보기 모드 · 여러 개 선택(저장 뒤): 선택 `[I, c]`에서 `c` → `pan`·`select c`·`step`이 아니다. `again`을 참으로 줘도 같다.
- 편집 1~3: Shift+빈 곳 → `marquee`·`none`·`logged` 거짓. Shift+`c` → `toggle c`·`logged` 거짓. 빈 곳 → `marquee`·`select null`·`logged` 참.
- **Shift는 다른 줄보다 먼저다**: 선택 `[I, c]`에서 Shift+`c` → `marquee`·`toggle c`·`groupIds` `null`·`nodeId` `null`(묶음 이동이 아니다). 선택 `[O]`에서 Shift+`I`(더미 `[I, O]`, `again` 참이어도) → `toggle I`(O에서 넘어가지 않는다, `step`이 아니다).
- 편집 4·5: 선택 `[I, c]`에서 `c` → `move`·`nodeId c`·`groupIds`가 받은 `selection.ids`와 `===`·`click select c`·`selectAtPress` 없음. 선택 `[I, L]`에서 `L` → `marquee`·`select L`.
- 편집 6(`again` 참): 선택 `[O]`에서 `I` 위(더미 `[I, O]`) → `move`·`nodeId O`·`step from O`·`selectAtPress` 없음.
- **편집 · 처음 누름**(`again` 거짓): 선택 `[O]`에서 `I` 위(더미 `[I, O]`) → **9번**: `move`·`nodeId I`·`selectAtPress I`·`click none`·`targetId I`. 네 겹(더미 `[closet, room, floor, site]`)에서 선택 `[floor]`, `closet` 위 → 9번(`selectAtPress closet`). 같은 것에 `again` 참 → 6번(`nodeId floor`·`step from floor`).
- 편집 7(`again` 참): `O`가 잠김, 선택 `[O]`, `I` 위 → `move`·`nodeId I`·`selectAtPress I`·`step from O`·`targetId I`. `again` 거짓이면 9번(`click none`).
- 편집 8(`again` 참): `O`와 `I` 모두 잠김 → `marquee`·`step from O`. `again` 거짓이면 10번(`select I`).
- 편집 9·10: 선택 없음, `I` → `move`·`selectAtPress I`·`none`. `L`(더미 `[L]`) → `marquee`·`select L`·`selectAtPress` 없음.
- **카메라·기호의 더미는 `again`을 보지 않는다**: 선택 `[camB]`, `camA` 위(더미 `[camA, camB]`), `again` 거짓 → 6번(`nodeId camB`·`step { ids: [camA, camB], from: camB, spaces: false }`) — 목록에서 고른 아래 카메라가 그 자리의 대상이다(①과 같다). 보기 모드에서도 `step from camB`·`spaces: false`.
- 여러 개 선택 중에는 `from`을 보지 않는다: 선택 `[O, c]`에서 `I` 위(더미 `[I, O]`, `again` 참) → 9번(`selectAtPress I`).
- 선택이 하나이고 그것이 더미에 없으면 `from`이 없다: 선택 `[c]`, `I` 위(`again` 참) → 9번.
- 더미가 하나뿐이면 `from`이 없다: 선택 `[I]`, 더미 `[I]`(`again` 참) → 9번(`click none`).

### 12.5 `tests/backgroundMapGeometry.test.ts` · `backgroundMapPlanGesture.test.ts` · `backgroundMapPlanEdit.test.ts` · `backgroundMapPlanPreview.test.ts`에 더하는 것

`moveMapNodes` — 도면 `[A(100, 100, 144.65×80), B(300.4, 120.3, 60×40), chairB(310, 130, 20×20, B 소속), lockedB(330, 130, 20×20, B 소속·잠김), free(400.5, 200.25, 30×30), camB(320, 140, B 소속), LS(600, 300, 100×100, 잠김), mLS(620, 320, 20×20, LS 소속)]`

- `ids = [B, chairB, free, LS, mLS, lockedB]`, `delta (10, −5)` → B (310.4, 115.3), chairB (320, 125)(한 번만), camB (330, 135)(묶음에 없어도 실려 간다), free (410.5, 195.25), mLS (630, 315)(잠긴 공간의 잠기지 않은 항목은 자기가 묶음에 있어 간다), **LS·lockedB·A는 그대로**(`===`). (1e-9 비교.)
- id 하나: `moveMapNodes(map, [B], d)`가 `moveMapNode(map, 'B', d)`와, `[free]`가 `moveMapNode(map, 'free', d)`와 `deepEqual`.
- 움직일 것이 없으면(`[LS, lockedB, 'missing']`) 받은 `map` 그대로(`===`).
- `anchor`: `{ id: 'B', position: { x: 244.65, y: 113 } }` → B의 저장 x·y가 정확히 그 값(`===`), 나머지는 `delta`만큼. 입력 도면을 바꾸지 않는다.

`removeMapNodes`: `[B, free]`를 지우면 chairB·lockedB·camB가 남고 `spaceId`가 `null`, mLS는 `LS` 그대로. `removeMapNode`를 차례로 부른 것과 `deepEqual`. 없는 id뿐이면 `map` 그대로(`===`). **잠긴 것은 남는다**: `[B, lockedB, LS, free]` → B와 free만 지워진다 — lockedB는 남되 `spaceId`가 `null`(자기 공간이 지워졌다), LS와 mLS는 받은 객체 그대로(`===`). 잠긴 것뿐이면(`[LS, lockedB]`) `map` 그대로(`===`). (잠금 검사를 뺀 구현이 여기서 떨어진다 — 편집기는 묶음 전체를 넘기므로 이 규칙을 지키는 곳은 이 함수뿐이다, 6.4.)

`lockMapNodes`: 섞인 묶음을 잠그면 모두 `locked: true`, 이미 잠긴 노드 객체는 `===`. 모두 이미 그 값이면 `map` 그대로(`===`). 좌표·`spaceId`는 바뀌지 않는다.

`previewPlanGesture`의 `move-group` — 도면 `[A(100, 100, 144.65×80), B(300.4, 120.3, 60×40), free(400.5, 126.25, 30×30)]`, `ids [B, free]`, 허용 6, 닿는 거리 48, 후보는 `planGestureCandidates`로

- 스냅 없음: `moveMapNodes(initial, [B, free], delta)`와 `deepEqual`.
- 기준 B, `delta (−52, −7.6)`: B (244.65, 113)(`===` — 합친 상자의 왼쪽 끝이 A의 오른쪽 끝에 붙고, 붙지 않은 세로는 기준의 저장 값이 정수), free (344.75, 118.95)(1e-9 — 기준과 같은 만큼, 간격 유지), 안내선 x 한 줄(`at 244.65`, `from 100`, `to 180`).
- 기준 free(누른 것이 free), 같은 `delta`: free (344.75, 119), B ≈ (244.65, 113.05)(1e-9). 간격은 두 경우 모두 처음과 같다.
- 붙을 것 없음 `delta (200.3, 300.3)`: B (501, 421), 안내선 없음.
- 묶음 안의 노드에는 붙지 않는다: 후보에 B와 free의 선이 없다(`planGestureCandidates`의 x·y 선 수 = 테두리 2 + A의 3).
- 공간과 그 소속 의자를 함께 넘김(`[B, chairB]`, `delta (10, 5)`): `moveMapNode(initial, 'B', delta)`와 같은 좌표(의자가 두 번 가지 않는다).
- 누른 것이 실려 가는 항목이면 기준은 그 공간: 위 도면에 `chairB(310, 130, 20×20, B 소속)`를 더하고 `{ mode: 'move-group', nodeId: 'chairB', ids: ['B', 'chairB'] }`를 `delta (−52, −7.6)`으로 → B의 저장 위치가 `(244.65, 113)`(`===`), 의자는 (254.25, 122.7)(1e-9). 의자가 기준이었다면 정수가 되는 것은 의자의 세로(122)이고 B의 세로는 112.3이 된다 — 이 값이 나오면 기준이 잘못 잡힌 것이다.
- 잠긴 것만 든 묶음: `map`이 `initial`과 `===`, 안내선 없음. 잠긴 것이 섞이면 그것만 `===`로 남는다.
- 순수성: 같은 인자 = 같은 결과, 다른 점을 먼저 미리 본 뒤에도 같다. `initial`을 바꾸지 않는다.

`planDoubleClickAction`: 7.2의 표 그대로(연결된 공간 × 도구 select·hand·rect / 연결 없는 공간·기호·카메라 × `canEdit` × 잠김).

`planPileAt` · `nextPlanSelection`(12.3의 겹친 도면에 카메라 셋을 같은 자리에 더한 것): 공간 위 (340, 240) → `['closet', 'room', 'floor', 'site']`. 눌린 공간이 그 점을 품지 않으면 `[hitId]`. 카메라 위에서는 `planStackUnder`와 같은 목록(공간이 섞이지 않는다). `nextPlanSelection`의 여덟 인자(…, 점, `again`, `repeat`). 따로 적지 않으면 `repeat`은 거짓이다:

- `again` 참: `(map, 'closet', 'closet', undefined, undefined, 점, true)` → `'room'`, 선택 `'room'` → `'floor'`, 선택 `'site'` → `'closet'`(돈다), 선택이 더미 밖이면 `'closet'`.
- **`again` 거짓(처음 누름)은 늘 맨 위 것**: 선택 `'closet'` → `'closet'`, 선택 `'room'` → `'closet'`, **선택 `'floor'` → `'closet'`**(`'site'`가 아니다).
- **연속 클릭은 공간을 넘기지 않는다**(`again` 참 · `repeat` 참, `(map, 'closet', 선택, undefined, undefined, 점, true, true)`): 선택 `'closet'` → **`'closet'`**(`'room'`이 아니다). 선택 `'room'` → **`'room'`**(넘기지도 않고 맨 위의 `'closet'`으로 되돌리지도 않는다). 선택 `'site'` → `'site'`(돌지 않는다). 선택이 더미 밖이면 `'closet'`. `again` 거짓 · `repeat` 참 → 처음 누름과 같다: 선택이 무엇이든 `'closet'`.
- 점 없이 부르면(`again`이 참이어도) 지금처럼 `'closet'`.
- 카메라 더미는 `again`·`repeat`과 무관하다: 카메라 셋의 자리에서 선택이 둘째 카메라면 `again` 거짓이어도, `repeat` 참이어도 셋째 카메라.
- **이어서 누르기**(보조 평면도의 `activate`가 하는 그대로 — `turn`을 손으로 들고 간다. `again` = "`turn`의 `hitId`가 눌린 것이고 `pickedId`가 지금 선택"): `'closet'` 자리를 천천히 세 번(`repeat` 거짓) → `'closet'`, `'room'`, `'floor'`. 이어서 **빠르게 두 번**(`repeat` 거짓, 참) → `'site'`, `'site'`(첫 클릭만 넘긴다). 천천히 한 번 눌러 `'closet'`을 고른 뒤 **`turn`을 비우고**(밖의 누름) 다시 누른다 → `'closet'` 그대로(`'room'`이 아니다). 비우지 않고 다시 누르면 `'room'`. **키보드로 고른 뒤의 첫 클릭**: 선택 없이 시작해 `'closet'`을 키보드로 고른다(`activate`의 `cycle` 거짓 가지 그대로 — 고른 것은 `'closet'`, `turn`은 적지 않고 비운다) → `'closet'` 자리를 클릭한다 → `'closet'` 그대로(그 아래의 `'room'`이 아니다. 키보드로 고를 때 `turn`에 `{ hitId: 'closet', pickedId: 'closet' }`을 적으면 `'room'`이 나온다).

### 12.6 `tests/backgroundMap3dScene.test.ts`에 더하는 것

- 규칙(손으로 만든 hit): 같은 높이에서 넓이가 같은 두 공간은 배열에서 뒤에 있는 것이 위. `mapFloorPile` — 같은 높이 셋(작은 것부터), 높이가 다른 둘(가까운 것부터, 넓이와 무관), `mapFloorPile(hits, map)[0]`이 `pickMapFloor(hits, map)`의 공간.
- `resolveMapClick` 실제 광선(안쪽 타원 방 + 바깥 방, 위에서 내려다봄. 넷째 인자 `again`, 다섯째 인자 `repeat` — 따로 적지 않으면 `repeat`은 거짓이다):
  - `again` 참: 선택 없음 → 안쪽. 안쪽이 선택됨 → 바깥. 바깥이 선택됨 → 안쪽(돈다).
  - **`again` 거짓(처음 누름)**: 안쪽이 선택됨 → 안쪽 그대로. **바깥이 선택됨 → 안쪽**(넘어가서가 아니라 맨 위라서). 세 겹(가장 작은·가운데·큰)에서 가운데가 선택됨 → **가장 작은 것**(`again` 참이면 큰 것).
  - **연속 클릭은 공간을 넘기지 않는다**(`again` 참 · `repeat` 참): 안쪽이 선택됨 → **안쪽 그대로**(바깥이 아니다). 바깥이 선택됨 → **바깥 그대로**(안쪽으로 돌지 않는다). 세 겹에서 가운데가 선택됨 → **가운데 그대로**(큰 것으로 넘어가지도, 가장 작은 것으로 되돌아가지도 않는다). `again` 거짓 · `repeat` 참 → 처음 누름과 같다(바깥이 선택됨 → 안쪽). 선택 없음 · `repeat` 참 → 안쪽.
  - 카메라 셋이 같은 자리: 둘째 카메라가 선택됨 → `again`·`repeat`이 무엇이든(네 조합) 셋째 카메라.
  - 어느 쪽이든: 바깥만 있는 자리 → 바깥 그대로. 그 자리에 의자가 있으면 의자(공간으로 넘어가지 않는다). 선택된 공간이 벽으로만 맞았으면 고른 것 그대로.
- `mapClickAim`: 넘기는 클릭이면 선택돼 있던 것, 아니면 고른 것. `again` 거짓에서 바깥이 선택된 채 안쪽 자리 → 안쪽(바깥이 아니다).
- 뷰포트(`mountViewport`, 연결된 안쪽 방 `nook`과 바깥 방 `classroom`이 겹친 자리. 누름의 `extra`로 `{ detail: 1 }`·`{ detail: 2 }`를 준다. 클릭은 실제 순서대로 `pointerdown` → `mousedown` → `pointerup`을 보낸다. 따로 적지 않으면 `canEdit: false`다 — 기즈모가 없어 누름이 바닥에 떨어진다):
  - **손잡이 준비**(아래에서 '손잡이'를 누른다고 적은 줄 모두에 쓴다 — 지금의 :1742-1746이 손잡이를 누르는 방식): `gizmoMode`는 기본값 `'translate'` 그대로 둔다(이동 기즈모는 한가운데가 손잡이다). `frame()`으로 기즈모가 뜬 뒤 선택된 것의 한가운데(`editor.screen(id)`)로 먼저 `editor.move(…)`를 보내고, 누르기 **전에** `editor.dev().transform.axis === 'XYZ'`를 확인한다. :1638-1666(크기 기즈모 테스트)의 준비는 쓰지 않는다: `gizmoMode: 'scale'`에서는 한가운데가 손잡이가 아니라서(BackgroundMapCameraGizmo.ts:313-319, :351-352 — 그 테스트가 보는 것이 바로 한가운데에서 `axis`가 `null`이라는 것이다) 그 누름이 `clickHandle`이 아니라 `click`을 지나는 보통의 고르기가 되고, "`select` 기록이 없다" 같은 기대가 손잡이의 길을 시험하지 못한다.
  - 천천히 두 번(`detail` 1, 1) → `nook` → `classroom`. 한 번 더 → `nook`.
  - 빠르게 두 번(`detail` 1, 2) + `dblclick` → 둘째 클릭이 넘기지 않는다(`select` 기록이 한 번), `open`이 `nook`.
  - **`classroom`을 다른 자리에서 골라 둔 채**(그 방만 있는 자리를 눌러서, 또는 `selectedId`로 넘겨서) `nook` 자리를 한 번 → `nook`(넘기기가 아니다). 그 자리를 빠르게 두 번 + `dblclick` → `open`이 **`nook`**.
  - **세 번 되풀이**: `nook` 자리를 빠르게 두 번 + `dblclick`을 세 번 거듭한다. `open`이 보고될 때마다 편집기가 하듯 그 공간을 선택으로 돌려준다(`render({ selectedId: nook })` — 7.2의 `openSpace`). `open`이 세 번 다 `nook`이고, 어느 사이에도 `classroom`이 열리지 않는다. (실제 편집기에서는 열 때마다 도면이 바뀌어 뷰포트의 기억이 지워진다. 이 테스트는 도면이 바뀌지 않아도 어긋나지 않음을 본다.)
  - 같은 자리를 천천히 눌러 `classroom`까지 넘긴 뒤(`detail` 1, 1) 그 자리를 빠르게 두 번 + `dblclick` → `open`이 **`classroom`**(첫 클릭이 겨눈 것이고 연결돼 있다).
  - `classroom`에 연결이 없는 도면에서 같은 일 → `open`이 **`nook`**(겨눈 것에 할 일이 없으면 맨 위 것), 둘째 클릭은 넘기지 않는다.
  - **연결 없는 두 방 — 빠른 둘째 클릭은 넘기지 않는다**: 빠르게 두 번(`detail` 1, 2) → `state.selectedId`가 안쪽 방 그대로이고 `select` 기록 어디에도 바깥 방이 없다(둘째 클릭은 같은 안쪽 방을 다시 알릴 뿐이다). 세 번째 연속 클릭(`detail` 3)도 같다. `dblclick`의 `open`은 맨 위의 안쪽 방으로 보고된다(뷰포트는 공간이면 늘 보고하고, 연결된 도면이 없으면 편집기가 아무것도 열지 않는다 — 지금과 같다). 견주는 경우: 같은 두 방을 천천히 두 번(`detail` 1, 1) → 안쪽 → 바깥.
  - **넘겨 둔 뒤의 빠른 두 번**(연결 없는 세 겹 — 가장 작은 `S`·가운데 `M`·큰 `B`): 천천히 두 번 눌러 `M`까지 넘긴 뒤(`detail` 1, 1) 빠르게 두 번(`detail` 1, 2) → 첫 클릭에 `B`, 둘째 클릭 뒤에도 **`B` 그대로**(`S`로 되돌아가지 않는다. `select` 기록: `S`, `M`, `B`, `B`).
  - **손잡이 위의 연속 클릭**(`canEdit: true`, 연결 없는 두 방): 안쪽 방을 누른다 → 기즈모가 뜬 뒤 한가운데 손잡이를(손잡이 준비대로: `move`로 올리고 `axis === 'XYZ'` 확인) `detail` 2로 끌지 않고 누른다(더블클릭의 둘째 클릭이 손잡이에 떨어진 것) → `select` 기록이 늘지 않고 선택이 안쪽 방 그대로다.
  - 겹친 카메라 셋: `detail` 2를 줘도 클릭마다 넘어간다(지금과 같다). 다른 자리에서 골라 둔 카메라가 있어도 지금처럼 넘어간다(`again`을 보지 않는다).
  - **둘러보기 도구**: '선택' 도구로 `classroom`만 있는 자리를 누른 뒤 `render({ tool: 'look' })` → `nook` 자리를 두 번 누르고(`detail` 1, 2) `dblclick` → `select` 기록이 없고 `open`이 **`nook`**(예전에 겨눈 `classroom`이 아니다).
  - **손잡이**(`canEdit: true`): `nook`을 누른다 → 기즈모가 뜬 뒤 `nook`의 바닥 위에 놓인 손잡이(한가운데 `editor.screen(nook.id)` — 손잡이 준비대로: 지금의 :1742-1746이 손잡이를 누르는 방식. `move`로 올리고 `axis === 'XYZ'` 확인)를 `detail` 1로 끌지 않고 누른다 → `classroom`으로 넘어간다. 견주는 경우: `selectedId: classroom`으로 시작해(자리 기억 없음) 그 기즈모의 한가운데 손잡이를(같은 손잡이 준비대로 — `editor.screen(classroom.id)`. `nook`의 바닥이 그 한가운데 아래에 오는 도면에서) 끌지 않고 한 번 누른다 → `select` 기록이 없다(손잡이 아래에 다른 방의 바닥이 있어도 고르지 않는다).
  - **첫 클릭이 손잡이인 더블클릭**(`canEdit: true`): `selectedId: nook`으로 시작해 한가운데 손잡이를(손잡이 준비대로: `move`로 올리고 `axis === 'XYZ'` 확인) 빠르게 두 번 + `dblclick` → `open`이 `nook`, `select` 기록이 없다.
  - **다른 길로 바뀐 선택**: `nook` 자리를 한 번 누른 뒤(`nook`) `render({ selectedId: classroom })`으로 선택을 밖에서 바꾸고 다시 `nook`으로 돌려놓은 다음 그 자리를 누른다 → `nook` 그대로(넘어가지 않는다: 자리 기억이 지워졌다).
  - **자리 기억이 끝나는 누름**(7.3의 ④~⑦. 줄마다 새로 시작한다: `nook` 자리를 한 번 눌러 `nook`을 고른다 → 아래의 일을 한다 → 그 자리의 화면 좌표를 `editor.at(…)`으로 **다시 구해**(화면이 돌았을 수 있다) `detail` 1로 누른다. 기대는 모두 "**`nook` 그대로** — `select` 기록 어디에도 `classroom`이 없다". 줄마다 견주는 경우를 함께 둔다: 그 일을 빼면 둘째 누름이 `classroom`이다):
    - **오른쪽 버튼으로 둘러봄**: 그 자리에서 `press(at, { button: 2, buttons: 2 })` → `move(…, { buttons: 2 })`로 30px → `release(…, { button: 2, buttons: 0 })`(지금의 :1297-1299가 둘러보는 방식. 화면이 돈다 — `view()`가 달라졌는지 본다).
    - 오른쪽 버튼을 끌지 않고 눌렀다 뗌(`button: 2`) / 휠 버튼으로 끌어 옮김(`press(at, { button: 1, buttons: 4 })` …, 지금의 :1304 방식).
    - **캔버스 밖의 누름**: `window.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, isPrimary: true }))`(대상이 캔버스가 아니다 — 지금의 :1754가 창에 `keydown`을 보내는 방식).
    - '둘러보기' 도구의 끌기: `render({ tool: 'look' })` → 왼쪽 버튼으로 30px 끌고 뗀다 → `render({ tool: 'select' })`. / '선택' 도구에서 왼쪽 버튼으로 빈 끌기(바닥 위에서 30px — 아무것도 움직이지 않는다).
    - 포인터 취소: `press(at)` 뒤 캔버스에 `pointercancel`.
  - **손잡이 클릭에서도 같다**(`canEdit: true`): `nook`을 누른다 → `frame()`(기즈모가 뜬다) → 오른쪽 버튼으로 누르고 끌고 뗀다 → `nook` 한가운데의 손잡이(`editor.screen(nook.id)`를 다시 구한다. 손잡이 준비대로 먼저 `move`로 올려 두고 `axis === 'XYZ'`를 확인한다)를 끌지 않고 `detail` 1로 누른다 → `select` 기록이 늘지 않는다(`classroom`으로 넘어가지 않는다). 같은 일을 캔버스 밖 `pointerdown`으로 해도 같다. 견주는 경우는 위의 **손잡이** 줄이다(사이에 아무것도 없으면 `classroom`으로 넘어간다).
  - **기즈모 끌기는 기억을 지키고, 취소는 끝낸다**(`canEdit: true`): `nook`을 누른다 → `frame()` → X 화살표(`editor.handle(nook.id, 'X')`)를 20px 끌고 뗀다(`finish` 한 번, `nook`이 `classroom` 안에서 조금 옮겨진다) → `frame()` → 옮겨진 `nook` 한가운데의 손잡이를(손잡이 준비대로 — `editor.screen(nook.id)`를 다시 구해 `move`로 올리고 `axis === 'XYZ'` 확인) 끌지 않고 누른다 → **`classroom`으로 넘어간다**(평면에서 끈 뒤와 같다). 같은 준비에서 화살표를 끄는 도중 창에 Escape(`cancel` 한 번, 지금의 :1754 방식) → 뗀다 → 한가운데 손잡이를(같은 손잡이 준비대로) 누른다 → 넘어가지 않는다.
  - **정리**: `dispose` 뒤 창에 `pointerdown` 리스너가 남지 않는다 — 지금의 :2085 목록(`'keydown', 'keyup', 'pointermove', 'pointerup'`)에 `'pointerdown'`을 더한다.
- 통합(문서 스토어 연결, 지금의 :1940대 방식을 편집기의 3D 모드처럼 잇는다. `onSelect`는 `value => store.dispatch(pickAction(mapId, value, true, mapSelection(초안, mapViewport(store.getState(), mapId).selectedIds)))`, 뷰포트에 넘기는 `selectedId`는 `singleViewId(초안, mapSelection(…), mapViewport(…).selectedId)`다. 아래에서 `group`은 `select-many` 직후의 `mapViewport(…).selectedIds` 배열이다):
  - 문서에 `[a, b]`를 고르고(`select-many`) 3D에 그 하나(대표 `b`)가 강조된 채 기즈모로 끌고 `finish` → `selectedIds`가 `group` 그대로(`===`).
  - **3D에서 무엇을 눌러도 묶음은 같은 배열이다**: 대표 `b`를 누른다(겹친 것이 없는 자리) → `selectedIds === group`, 뷰포트의 `selectedId`는 `b` 그대로, 스토어 알림이 없다. 묶음 안의 `a` → `selectedIds === group`, 뷰포트의 `selectedId`가 `a`. 묶음 밖의 `c` → `selectedIds === group`, `c`. 빈 바닥 → `selectedIds === group`, `null`(강조된 것이 없다). 다시 `a` → `selectedIds === group`, `a`.
  - **대표가 겹친 카메라 셋 가운데 하나**(지금의 :1739대 도면처럼 카메라 셋이 같은 자리, `[의자, 둘째 카메라]`를 고른다): 강조된 둘째 카메라를 한 번 누른다 → 뷰포트가 알리는 것은 셋째 카메라(묶음 밖)다. `selectedIds === group`이고 뷰포트의 `selectedId`만 셋째 카메라다. 두 번 더 누르면 첫째 → 둘째로 돌아오고 그동안 `selectedIds === group`. 같은 일을 `canEdit: true`로 **손잡이를 끌지 않고 눌러서** 해도 같다(`clickHandle`의 길 — 위 뷰포트 줄들의 손잡이 준비대로: 강조된 카메라의 한가운데로 `move`, `axis === 'XYZ'` 확인. 지금의 :1742-1746과 같다).
  - **대표인 방을 같은 자리에서 천천히 두 번**(`[의자, nook]`, `detail` 1, 1): 뷰포트가 `nook` → `classroom`(아래 바닥, 묶음 밖)을 알린다. `selectedIds === group`.
  - 견주는 경우 — 하나만 고른 문서(`['a']`)에서는 지금과 같다: `c`를 누르면 `selectedIds`가 `['c']`, 빈 바닥이면 `[]`.
  - 평면으로 돌아와 선택을 바꾼 것처럼 `select-many ['a', 'b']`(같은 목록)를 보낸다 → `mapViewport(…).selectedId`가 다시 `'b'`.

### 12.7 통과 기준

`npm run typecheck`, `npm run test:background`, `npm run build:vite`. DB 실행 검사 3개는 지금처럼 PGlite 미지정 시 생략으로 보고한다(이번 변경과 무관).

### 12.8 `tests/backgroundMapEditorWiring.test.ts` (소스 앵커)

`handler` 표에 `doubleClickIntent`(`'function doubleClickIntent('` ~ `'function canvasDoubleClick('`)를 더하고, `pointerUp`의 끝 표지를 `'function doubleClickIntent('`로 바꾼다(편집기에서 `pointerUp` → `doubleClickIntent` → `canvasDoubleClick` → `zoomBy` 순서로 둔다).

바뀌는 앵커

| # | 새 내용 | 잡아야 하는 변형 |
|---|---|---|
| 5 | SVG `onClick`의 줄이 순서대로: `pendingCycle.current = null` → `if (!cycle \|\| (event.detail >= 2 && (cycle.spaces \|\| doubleClickIntent(pointFrom(event))))) return;` → `const next = cycle.ids[(cycle.ids.indexOf(cycle.from) + 1) % cycle.ids.length];` → `select(next, cycle.mapId);`. 그 `if` 줄은 이 글자 그대로 한 번이고, `cycle.spaces`가 `doubleClickIntent(`보다 **앞**이다(공간의 더미는 판정을 묻지 않는다). `pointerUp`은 넘기기를 `pendingCycle.current = { ids: click.ids, from: click.from, mapId: session.mapId, spaces: click.spaces };`로 적어 두기만 한다: `pointerUp` 안의 `\bselect\(`가 **정확히 둘**이고 그 둘이 `select(session.node.id, session.mapId)`와 `select(click.id, session.mapId)`이며, `click.ids[`와 `indexOf(click.from`이 `pointerUp` 어디에도 없다(지금의 "한 번" 검사와 `session.stack` 표지 검사(:110-112)를 이것으로 바꾼다). 끌기가 끝난 뒤의 선택은 `if (!session.groupIds && session.node) select(session.node.id, session.mapId);` 한 줄 | 조건을 `canEdit`으로 되돌림 / `detail` 검사를 뺌 / **`cycle.spaces \|\|`를 뺌**(보기 모드의 겹친 방·잠긴 겹친 방을 더블클릭하면 선택이 아래 공간으로 넘어간다) / `spaces`를 `pendingCycle`에 싣지 않음(같은 결과) / 공간까지 `doubleClickIntent`만으로 가름(같은 결과) / `pointerUp`에서 바로 넘김(`select(click.ids[…])` — 옛 철자 `select(cycle`·`select(ids[`만 막는 검사는 이것을 놓친다) / `!session.groupIds`를 뺌(묶음이 접힌다) |
| 6 | `onDoubleClick=`은 편집기·조각 파일을 통틀어 한 번. `canvasDoubleClick`이 `doubleClickIntent(`를 부르고, `doubleClickIntent`가 `pressLog.current`를 읽으며 `first.hitId !== last.hitId`, `doubleClickNodeId(first.targetId, node.id, pile)`, `for (const item of target === node ? [node] : [target, node])`, `planDoubleClickAction(item,`을 순서대로 갖는다. 편집기 전체에서 `doubleClickIntent(` 호출이 정확히 둘(넘기기와 더블클릭). `canvasDoubleClick`에 `openSpace(intent.node.id, tool !== 'hand')`, `openSpace`에 `if (pick && id !== singleId) select(id);`가 `navigate(`보다 앞에 있다. `pointerDown`의 누름 기록 줄 `pressLog.current = press ? [pressLog.current[1], press] : NO_PRESSES;` | 넘기기 쪽이 다른 판정을 씀 / 첫 누름 검사를 뺌 / 노드 `<g>`에 `onDoubleClick`을 닮 / 맨 위 것으로 넘어오는 판정을 뺌(넘겨 둔 아래 공간에 할 일이 없으면 연결된 방에 못 들어간다) / 들어갈 때 선택하지 않음 |
| 10 | 3D 세 파일이 import하지 않는 목록에 `mapPlanSelect`를 더한다 | 3D가 평면 전용 모듈을 끌어옴 |

새 앵커

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| 21 | **쌓임 순서는 한 곳**: 편집기에 `stackedSpaces(current).map(`가 있고 `nodes.filter((node): node is BackgroundSpace`가 없다. 보조 평면도에 `stackedSpaces(map).map(`. `map3dScene.ts`의 `pickMapFloor`에 `spaceStackRanks(map)`가 있고 `map.nodes.findIndex(`가 없다. `placeSymbol`에 `spacesAt(base, point)[0]`이 있고 편집기에 `reverse().find(`가 없다 | 넷 가운데 하나를 배열 순서로 되돌림 |
| 22 | **전환·이동은 선택을 건드리지 않는다**: `switchMode`·`leave3D`·`navigate`의 본문에 `select(`·`selectMany(`가 없다 | 3D로 갈 때 대표 하나로 접는 줄을 넣음 |
| 23 | **3D와 보조 평면도는 하나만 받고, 3D 모드의 고르기는 묶음을 건드리지 않는다**: `<Map3D map={current} selectedId={singleId} canEdit={canEdit} onSelect={selectNode}`와 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode}`. `const singleId = singleViewId(current, selection, view.selectedId);`. 편집기의 `select` 본문이 `if (mapId) doc.dispatch(pickAction(mapId, id, mode === '3d' && mapId === current?.id, selection));` 한 줄이고, 편집기 어디에도 `doc.select(`가 없으며 `pick-one`이라는 글자도 없다(그 액션은 `pickAction`만 만든다). `confirmAction`의 `'delete-node'` 분기가 여전히 `select(null)`로 끝난다. `mapCanvas.ts`·`BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`·`BackgroundMapPlanPreview.tsx`에 `selectedIds`라는 글자가 없다 | 3D에 묶음을 넘김 / `select`가 3D에서도 `doc.select`를 부름(3D에서 묶음 밖의 것·빈 바닥·겹친 다음 카메라를 한 번 누르면 묶음이 접힌다) / 3D에 `view.selectedId`나 `selection.primaryId`를 그대로 넘김(사라진 id가 넘어가거나, 3D에서 고른 것이 강조되지 않는다) / `mode === '3d'` 조건을 뺌(평면에서 묶음에 든 것을 눌러도 하나로 접히지 않는다) |
| 24 | **하나를 다루는 도구는 평면의 여러 개 선택에서 물러선다**: `const selected = mode === 'plan' && multiple ? undefined : current?.nodes.find(node => node.id === singleId);`가 그대로 있고, 손잡이 줄이 여전히 `selected && canEdit && !selected.locked`로 시작한다. 속성 칸의 3D 안내 줄이 `mode === '3d' && multiple` 조건 아래에 있다 | 조건을 빼 평면의 여러 개 선택에서 하나에 손잡이·양식이 붙음 |
| 25 | **누름의 판정은 순수 함수**: `pointerDown`에 `resolvePlanPress(`가 정확히 한 번 있고 `view.selectedId`가 없다. `planGestureOf`에 `{ mode: 'move-group', nodeId: node.id, ids: session.groupIds }`. `pointerUp`의 `toggle` 분기가 `liveSelection(`으로 읽은 목록으로 `doc.selectMany(`를 부른다. `mapDocument.ts`에 `toggle-select`와 `add?:`라는 글자가 없다 | 편집기 안에서 따로 판정함 / 묶음 제스처를 하나짜리로 넘김 / 저장된 날것 목록에 붙이는 액션을 되살림(사라진 노드가 묶음에 끼어든다) |
| 33 | **같은 자리의 기억**(`lastSpot`): `pointerDown`에 `const spot = pressLog.current[1] ? lastSpot.current : null; lastSpot.current = null;`, `const again = sameSpotAgain(spot, current.id, hit?.id ?? null, held);`, `resolvePlanPress(`, `pressLog.current = press ?`가 **이 순서로** 있다. 세션에 `spotId: plan?.logged && hit ? hit.id : null`. `pointerUp`의 `if (!cancel && session.spotId !== null && !(session.moved && session.mode !== 'move'))` 아래에 `lastSpot.current = { mapId: session.mapId, hitId: session.spotId, pickedId:`가 있다(조건 줄은 이 글자 그대로 한 번이고, `session.spotId !== null`만으로 끝나는 `if`는 없다). SVG `onClick`의 `select(next, cycle.mapId);` 뒤에 `lastSpot.current = { ...lastSpot.current, pickedId: next };`. 편집기 전체에서 `lastSpot.current =`(대입)가 정확히 셋이다 | 판정을 `pressLog`의 `hitId` 비교만으로 바꿈(화면 이동·그리기 누름이 "앞 누름"이 된다) / 넘긴 뒤 고치지 않음(세 겹에서 맨 아래로 못 간다) / 누름 기록이 비어도 읽음(목록에서 고른 큰 공간이 대상이 된다) / 누를 때 비우지 않음 / 누름 기록을 적은 뒤에 읽음 / **`!(session.moved && session.mode !== 'move')`를 뺌**(보기 모드에서 방 위에서 끌어 화면을 옮긴 누름, 잠긴 것 위에서 그린 상자가 자리 기억을 남긴다 — 골라 둔 바깥 공간이 그 방의 대상이 된다) / 그 조건을 `!session.moved`로 좁힘(넘겨 둔 아래 공간을 끈 뒤 그 자리에서 다시 끌 수 없다, O7) |
| 26 | **화면 이동의 세 길**: `pointerDown`에 `const panning = event.button === 1 \|\| tool === 'hand' \|\| spaceHeld.current;`가 있고, 다각형·기호의 이른 반환 둘이 `if (!panning && canEdit && !handle && tool ===`으로 시작하며, 모드를 정하는 묶음이 `if (!panning) {` 안에 있다. `resolvePlanPress(`를 부르는 줄이 `panning \|\| drawing \|\| handle ? null :`로 시작한다 | 스페이스를 누른 채 그리기 도구가 그림 / 스페이스를 누른 채 선택이 바뀜 |
| 27 | **상자는 문서 제스처가 아니다**: `pointerDown`의 `if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;`. `pointerMove`의 상자 분기가 `setMarquee(` 뒤 `return`으로 끝나고 `previewPlanGesture(`보다 앞. `pointerUp`의 상자 분기에 `doc.selectMany(`가 있고 `doc.finishGesture(`가 없다. `abortGesture`에 `setMarquee(null)` | 상자가 되돌리기 단계를 만듦 / 취소 때 상자가 남음 |
| 28 | **스페이스 — 추적과 삼키기는 따로다**: 편집기에 창 캡처 `keydown`·`keyup` 리스너와 `blur` 리스너(`onSpaceKey`)가 있다. 상수 `const tickInputs = 'input:is([type="checkbox"], [type="radio"])';`와 ``const spaceEntry = `:is(${textEntry}):not(${tickInputs})`;``가 글자 그대로 있다(`textFields`·`interactive`·`textEntry`는 앵커 13대로 그대로다). `onSpaceKey` 안에 다음이 **이 순서로** 있다: `if (event.code !== 'Space') return;` → 추적 조건 `if (mode !== 'plan' \|\| !root \|\| root.offsetParent === null \|\| event.ctrlKey \|\| event.metaKey \|\| event.altKey \|\| event.isComposing) return;` → `if (element?.closest(spaceEntry)) return;` → `hold(true);` → 삼키는 줄 ``if (element === document.body \|\| (element && root.contains(element) && !element.closest(`${interactive}, summary`))) event.preventDefault();``. **`hold(true)`보다 앞에는 `root.contains(`도 `document.body`도 없다**(추적은 포커스의 자리를 보지 않는다). `onSpaceKey` 안에 `closest(textEntry)`가 없다(체크 칸을 글자 칸으로 세지 않는다). `event.preventDefault()`는 `onSpaceKey` 안에 그 한 줄뿐이다. `keyboard()` 안에는 `'Space'`가 없다. SVG의 `className`에 `spacePan && !gestureActive && !marquee ? ' is-space-pan'` | **추적에 포커스 자리 조건을 되살림**(`root.contains(element) \|\| element === document.body`를 `hold(true)` 앞에 둠 — '도면 탐색' 탭·새로고침·사이드바 버튼을 누른 직후 스페이스가 듣지 않아 방이 옮겨지거나 상자가 그려진다) / **`spaceEntry`를 `textEntry`로 되돌림**(잠금 체크 칸을 누른 직후 스페이스가 듣지 않는다) / `tickInputs`에서 `checkbox`를 뺌(같은 결과) / `spaceEntry` 검사를 뺌(글자 칸에서 스페이스를 먹는다 — 이름을 치는 도중의 빈칸이 화면 이동을 켠다) / **삼키는 줄에서 `root.contains(element) &&`를 뺌**(편집기 밖 요소의 스페이스를 가로챈다) / 삼키는 줄에서 `` `${interactive}, summary` `` 검사를 뺌(편집기 안 버튼·체크 칸·접기 줄의 스페이스가 막힌다) / 삼키는 줄에서 `document.body`를 뺌('공간 편집' 직후 좁은 창에서 스페이스가 페이지를 내린다) / 보이는지 검사(`root.offsetParent === null`)를 뺌(다른 탭에서 `body`의 스페이스를 가로챈다) |
| 29 | **묶음 삭제·잠금**: `confirmAction`의 `'delete-group'` 분기가 `removeMapNodes(source, selection.ids)`(묶음 전체 — 잠긴 것을 남기는 것은 그 함수의 일이고 12.5의 단위 테스트가 잡는다), 그 뒤의 `doc.selectMany(`, `focusAfterConfirm.current = true`를 갖고, 편집기에 `if (!confirmation && focusAfterConfirm.current)` 효과가 있다. 요약에 넘기는 `onLock`이 `lockMapNodes(current, selection.ids, locked)` 뒤에 `focusCanvas()`를 부른다. `keyboard`의 Delete가 고른 점 → 하나 → 묶음 순이고 묶음 줄이 `mode === 'plan' && multiple`을 조건으로 한다 | 3D에서 묶음을 지움 / 지운 뒤 선택을 그대로 둠 / 잠근 뒤 포커스가 비활성 버튼에 남음(Ctrl+Z가 듣지 않는다) |
| 30 | **Esc**: Escape 분기가 `pointerRef.current?.mode === 'marquee' \|\| doc.isGestureActive()`에서 `abortGesture()`로 돌아간다. Escape 분기 안에 `select(`·`selectMany(`가 **없다** | 상자를 그리다 Esc가 도구를 되돌리고 상자가 남음 / Esc가 선택을 풂(승인 문구에 없다) |
| 31 | **3D의 같은 자리·빠른 더블클릭**(`BackgroundMap3D.tsx`): `onMouseDown`에 `this.press.repeat = event.detail >= 2`. `pick`에 `const again = top !== null && this.turn?.hitId === top && this.turn.pickedId === selectedId;`, `if (!repeat) this.aimed = mapClickAim(props.map, selectedId, hits, again);`, `else if (this.opens(this.doubleClickNode(hits))) return;`, `resolveMapClick(props.map, selectedId, hits, again, repeat)`(다섯 인자 — 파일에 `resolveMapClick(` 호출이 이 하나뿐이다), 그리고 `props.onSelect(next)`보다 **앞에** `this.turn =`. `click`에 `if (this.look \|\| props.placing \|\| props.tool !== 'select') { this.aimed = null; this.turn = null; }`. `clickHandle`의 본문이 `this.pick(` 한 줄. `onPointerUp`이 `press.repeat`을 `this.clickHandle(`과 `this.click(` 둘 다에 넘긴다. `onDoubleClick`에 `this.doubleClickNode(`(같은 함수). `update`에 `if (this.turn && props.selectedId !== this.turn.pickedId) this.turn = null;`, 도면이 바뀌는 분기에 `this.aimed = null; this.turn = null;`. `map3dScene.ts`의 `resolveMapClick`에서 공간 더미가 `again` 조건 아래에 있고, 공간의 가지에 `repeat`이면 `selectedId`를 돌려주는 줄이 있다 | 둘째 클릭이 겨눈 것을 덮어씀 / 도면을 옮긴 뒤 옛 것을 겨눔 / 둘러보기 도구의 클릭이 `aimed`를 지우지 않음(예전에 겨눈 방이 열린다) / `again` 없이 공간을 넘김(큰 방이 선택된 채 안쪽 방을 누르면 더 아래가 잡힌다) / **`repeat`을 `resolveMapClick`에 넘기지 않음**(연결 없는 겹친 방을 3D에서 더블클릭하면 선택이 아래 방으로 넘어간다) / 손잡이 클릭에 `repeat`을 넘기지 않음(편집 중 둘째 클릭이 기즈모에 떨어질 때 넘어간다) / 손잡이 클릭이 다른 판정을 씀 / 둘째 클릭과 `dblclick`이 다른 노드를 고름 |
| 35 | **3D의 자리 기억이 끝나는 곳**(`BackgroundMap3D.tsx` — 평면의 규칙과 같게): `start`에 `window.addEventListener('pointerdown', this.onPressElsewhere, true);`, `dispose`에 같은 인자의 `window.removeEventListener(`. `onPressElsewhere`의 본문이 `if (event.target !== this.canvas) this.turn = null;`. `onPointerDown`에서 `this.press =`를 정한 **뒤에** `if (!this.press) this.turn = null;`. `onPointerUp`의 끌린 누름 가지에 `this.lastDragAt = performance.now();` 다음 `if (!press.gizmo) this.turn = null;` 다음 `return;`이 이 순서로 있다. 기즈모 host의 `onCancelGesture`와 `onPointerCancel`에 `this.turn = null;`. 파일 전체에서 `this.turn = null`이 이 다섯 곳과 앵커 31의 세 곳(`click`, `update`의 두 줄)뿐이고, `onPointerUp`의 끌린 누름 가지에 조건 없는 `this.turn = null;`이 없다 | **창 리스너를 뺌**(방을 누른 뒤 속성 칸에 글자를 치거나 목록·기즈모 방식 버튼을 누르고 돌아와 그 방을 다시 누르면 아래 방으로 넘어간다) / 캡처(`true`)를 뺌(누름의 전파를 멈추는 요소 위의 누름을 놓친다) / `event.target !== this.canvas` 조건을 뺌(캔버스의 누름마다 지워져 3D에서 아예 넘어가지 않는다) / **`if (!this.press) this.turn = null;`을 뺌**(오른쪽 버튼으로 둘러보거나 휠 버튼으로 옮긴 뒤 그 방을 다시 누르면 넘어간다) / **`if (!press.gizmo) this.turn = null;`을 뺌**('둘러보기' 도구로 끈 뒤 넘어간다) / 그 줄의 `!press.gizmo` 조건을 뺌(기즈모로 끈 뒤 그 자리에서 다시 넘길 수 없다 — 평면의 O7과 어긋난다) / 취소 줄을 뺌(끌기를 Esc로 취소한 뒤 넘어간다) / `dispose`에서 떼지 않음(3D를 닫은 뒤에도 창 리스너가 남는다 — 12.6의 정리 테스트도 잡는다) |
| 34 | **보조 평면도의 같은 자리**(`BackgroundMapPlanPreview.tsx`): `nodeButton`의 `onClick`이 `onActivate(node.id, true, clickPoint(event), event.detail >= 2)`를 부른다. `activate`에 `const again = cycle && turn.current?.hitId === id && turn.current.pickedId === now.selectedId;`가 있고 `nextPlanSelection(`의 마지막 세 인자가 `point, again, repeat`이며, `turn.current = cycle ? { hitId: id, pickedId: next } : null;`이 글자 그대로 `now.onSelect(next)`보다 앞이다(자리 기억은 클릭만 적는다, 7.4). 렌더에 `if (turn.current && turn.current.pickedId !== selectedId) turn.current = null;`. 창 캡처 리스너 `forget`의 본문이 `if (!(event.target instanceof Node) \|\| !svgRef.current?.contains(event.target) \|\| !event.isPrimary \|\| event.button !== 0) turn.current = null;`이고 `window.addEventListener('pointerdown', forget, true);`로 붙으며 정리 함수가 뗀다. 평면 SVG 태그에 `ref={svgRef}`. `mapPlanPreview.ts`의 `nextPlanSelection`에서 공간의 더미가 `again` 조건 아래에 있고, 그 가지에 `repeat`이면 `selectedId`를 돌려주는 줄이 있다 | `again` 없이 공간을 넘김 / 다른 길로 바뀐 선택 뒤에도 넘김 / **키보드로 고른 것까지 자리 기억에 적음**(`turn.current = { hitId: id, pickedId: next };`로 되돌림 — 키보드로 고른 안쪽 방을 처음 클릭하면 바깥 방으로 넘어간다) / **클릭 횟수를 넘기지 않음**(`event.detail >= 2`를 뺌 — 보조 평면도에서 방을 빠르게 두 번 누르면 아래 방으로 넘어간다) / `repeat`을 `nextPlanSelection`에 넘기지 않음(같은 결과) / **창 리스너를 뺌**(보조 평면도에서 방을 누른 뒤 3D를 둘러보거나 속성 칸·목록을 누르고 돌아와 다시 누르면 넘어간다) / `svgRef`를 SVG에 달지 않음(모든 누름이 "밖"이 되어 보조 평면도에서 아예 넘어가지 않는다) / 리스너의 `contains` 조건을 뒤집음 |
| 32 | 새 순수 모듈(`mapStack.ts`·`mapPlanSelect.ts`)이 three.js를 import하지 않고 DOM을 만지지 않는다(앵커 9와 같은 정규식) | — |

기존 앵커 1~4, 7~9, 11~20은 그대로 통과해야 한다(특히 16·17·19가 읽는 `pointerDown`의 가드 두 줄, 세션 기록이 한 곳이고 바로 뒤가 `altDrag` 줄이라는 것, `setError(`가 다각형 분기 한 곳뿐이라는 것, 그리고 13이 글자 그대로 읽는 `textFields`·`textEntry` 두 상수 — 스페이스용 `tickInputs`·`spaceEntry`는 그 둘을 고치지 않고 아래에 따로 더한다. `keyboard()`의 단축키 가드도 여전히 `textEntry`를 본다).

앵커는 **뮤테이션으로 확인**한다: 임시 복사본에서 표의 "잡아야 하는 변형"을 하나씩 넣어 그 앵커가 실제로 실패하는지 본다(살아남는 앵커는 고친다). 새 순수 테스트도 같은 방식으로 표본을 뽑아 본다(쌓임 비교의 부호, `spacePlanArea`의 절댓값 삭제, 벽 판정을 넓이 판정으로, `moveMapNodes`의 "실려 간 것은 건너뛴다" 줄 삭제, `removeMapNodes`의 잠금 검사 삭제, `resolvePlanPress`·`resolveMapClick`·`nextPlanSelection`에서 공간 더미의 `again` 조건 삭제, `resolveMapClick`·`nextPlanSelection`에서 공간 가지의 `repeat` 줄 삭제(연속 클릭이 넘긴다)와 그 줄이 `selectedId` 대신 맨 위 것을 돌려주게 바꿈(세 겹에서 맨 위로 되돌아간다), `resolvePlanPress`의 `step`이 `spaces`를 늘 거짓으로 돌려줌, `resolvePlanPress`에서 Shift 줄을 4번 뒤로 옮김, `sameSpotAgain`의 `pickedId` 비교 삭제, `pickAction`에서 "여러 개" 조건이나 `singleView` 조건 삭제, `pick-one`이 `selectedIds`를 새 배열로 바꿈, `withSelection`이 목록만 같으면 그대로 돌려줌, `singleViewId`의 "하나 이하" 줄이나 "사라졌으면 대표" 줄 삭제).

**평면의 누름 흐름 전체**(누름 → 뗌 → `click` → `dblclick`에 걸친 `lastSpot`·넘기기·더블클릭의 맞물림)는 편집기 안에 있어 순수 테스트가 닿지 않는다. 판정 조각(`resolvePlanPress`·`sameSpotAgain`·`planDoubleClickAction`·`doubleClickNodeId`)은 12.4·12.5가, 배선은 앵커 5·6·25·33이 잡고, 흐름 자체는 13절의 O14~O18과 O23~O25(★ — 앱 엔진에서 실제 입력으로)가 본다. 특히 "끌려서 화면 이동·상자가 된 누름은 자리 기억을 남기지 않는다"(9.3)는 누름 → 끌기 → 뗌 → 다음 누름에 걸친 흐름이라 앵커 33의 조건 줄과 O23~O25가 함께 지킨다. "연속 클릭은 공간의 더미를 넘기지 않는다"는 평면에서 SVG `click`의 한 줄이라 앵커 5와 O6·O26(★)이 지킨다(`step`의 `spaces`는 12.4가 잡는다). 3D의 같은 흐름 — 연속 클릭, 그리고 자리 기억이 끝나는 누름(둘러보기·캔버스 밖의 누름·취소된 끌기) — 은 뷰포트 테스트(12.6)가 실제 이벤트 순서로 돌고 앵커 31·35가 배선을 잡는다. **보조 평면도의 흐름**(클릭 → `turn` → 밖의 누름 → 다시 클릭)은 컴포넌트 안에 있고 이 기능에는 컴포넌트를 띄우는 테스트가 없다: 판정은 `nextPlanSelection`의 여덟 인자와 "이어서 누르기"(12.5)가, 배선은 앵커 34가, 흐름은 O6·O26·O28(★)이 본다.

---

## 13. 수동 검증 (앱 엔진: Electron 33)

방법은 ① 설계 13절과 같다: `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130), 미리보기 시험 계정(한솔)으로 로그인 → 배경 → 도면. **실제 입력**(마우스·휠·키보드)을 넣고 화면을 본다. 자동으로 넣을 때는 `BFLOW_PREVIEW_DEBUG_PORT`. 창이 가려지면 그리기가 멈추므로 보이는 창이나 offscreen 창에서 한다.

창 크기 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고, 나머지 세 조합에서는 ★ 항목을 다시 본다. '(740)'은 740×900에서 본다.

시험 도면: 큰 방 O(건물 외곽) 안에 방 I·J, 방마다 의자 둘. 상세 도면을 O에만 연결한 것, I에만 연결한 것, O와 I 둘 다 연결한 것, **어느 것도 연결하지 않은 것** 네 벌. 연결 없는 세 겹(작은 S·가운데 M·큰 B) 한 벌(O26이 쓴다. O9·O17·O24의 세 겹도 이것으로 본다 — O9는 가운데를 잠근다). 카메라 셋(같은 자리). O는 **나중에** 그린다(옛 규칙이면 I·J를 덮는다).

**가장 먼저 (엔진 동작 확인 — 16절의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 (740) | 캔버스를 한 번 누른 뒤 스페이스를 2초 누르고 있는다 / 누른 채 끈다 / 끄는 도중 스페이스를 뗀다 | 페이지가 내려가지 않는다. 커서가 손 모양 / 화면이 움직이고 선택은 그대로 / 마우스를 뗄 때까지 계속 움직인다 |
| E2 | Tab으로 도구줄의 '사각형' 버튼에 포커스를 두고 스페이스 / 이름 칸·속성 칸의 이름·검색 칸에서 스페이스 / 속성 칸의 '위치·크기·잠금' 줄에 포커스를 두고 스페이스 / 속성 칸의 '화면 비율'(`select`)에 포커스를 두고 스페이스 / (편집 중) 속성 칸의 이름 칸에 커서를 둔 채 스페이스를 누르고 잠기지 않은 방 위에서 끈다 | 그 도구가 골라진다 / 빈칸이 쳐진다(커서가 손 모양으로 바뀌지 않는다) / 줄이 펴지고 접힌다 / 목록이 열린다 / 화면 이동이 **아니다**: 이름 칸에 빈칸이 쳐지고, 그 끌기는 보통의 끌기라 방이 옮겨진다(글자 칸의 스페이스는 글자다, 16.4) |
| E3 | Shift+클릭 여러 번, Shift+끌기 | 화면 어디에도 글자 선택(파란 강조)이 생기지 않는다 |
| E4 | 상자를 속성 칸 위까지 끌고 거기서 뗀다 / 끄는 중 Esc / 끄는 중 Alt+Tab으로 다른 창에 갔다 온다 | 상자가 따라가고 뗀 순간 적용된다 / 상자가 사라지고 선택이 그대로다 / 상자가 없고 다음 누름이 정상이다 |
| E5 | 보기 모드에서 방을 누른다(콘솔에 SVG `click`의 `detail`·`target`을 찍는다) → 연결된 방을 더블클릭 | 보기 모드의 누름도 이제 포인터를 잡는다: `click`이 SVG에 `detail` 1, 2로 온다 → 그 도면으로 들어간다 |
| E6 | 3D에서 방을 더블클릭(콘솔에 캔버스 `mousedown`의 `detail`을 찍는다) / 보조 평면도에서 방을 더블클릭(콘솔에 그 노드 `click`의 `detail`을 찍는다) | 둘 다 1, 2로 온다. 오지 않거나 늘 1이면 16절의 대체안 |
| E7 | 보기 모드와 편집 중에 방 위에서 휠 버튼으로 끈다 | 화면이 움직인다. 자동 스크롤 표시가 뜨지 않는다 |
| E8 ★ | **'공간 편집'을 누른 직후, 캔버스를 누르지 않은 채** 스페이스를 누르고 방 위에서 끈다 / '도면 저장' 직후 / 확인 창('변경사항 버리기' 취소, 묶음 삭제)을 닫은 직후 / 요약의 '모두 잠그기'를 누른 직후 | 넷 다 화면이 움직이고 아무것도 옮겨지거나 선택되지 않는다(포커스가 `body`나 캔버스에 있다. 콘솔에 `document.activeElement`를 찍어 적는다) |
| E9 | 배경 화면의 다른 탭(배경 목록)에서 스페이스(빈 곳을 누른 뒤 / 그 탭의 버튼에 포커스를 두고) / '도면 탐색' 탭으로 돌아와 도면 트리의 버튼에 포커스를 두고 스페이스 / **편집기 밖의 버튼**('도면 탐색' 탭 버튼, 새로고침 버튼)에 포커스를 두고 스페이스를 눌렀다가 끌지 않고 뗀다 | 그 탭의 동작이 그대로다(스페이스가 막히지 않는다. 편집기가 숨겨져 있어 추적도 하지 않는다) / 그 버튼이 눌린다 / 그 버튼이 지금처럼 눌린다(편집기가 밖의 스페이스를 가로채지 않는다) |
| E10 ★ | **편집 중**, 아래를 하나씩 한 **바로 뒤에** — 캔버스를 누르지 않은 채 — 스페이스를 누르고 방 위에서 끈 다음, 마우스를 떼고 나서 스페이스를 뗀다: ① '배경 목록' 탭에 갔다가 **'도면 탐색' 탭 버튼**을 눌러 돌아온다 ② 머리줄의 **새로고침 버튼**을 누른다(도는 것이 멈춘 뒤) ③ 속성 칸의 **'위치와 속성 잠금' 체크 칸**을 눌러 방을 잠근다(그 잠긴 방 위에서 끌고, 잠기지 않은 다른 방 위에서도 끈다) ④ **앱 사이드바의 접기·펼치기 버튼**을 누른다. 넷 다 콘솔에 스페이스 `keydown`·`keyup`의 `target`과 그 버튼·체크 칸의 `click`을 찍는다 | 넷 다 **화면이 움직이고 아무것도 고쳐지지 않는다**: 방이 옮겨지지 않고, 상자가 그려지지 않고, 선택이 그대로이고, 되돌리기 버튼이 새로 켜지지 않는다. 스페이스를 누르는 동안 캔버스 위의 커서가 손 모양이다. **스페이스를 뗄 때 밖의 버튼·체크 칸이 눌리지 않는다**(`click`이 찍히지 않는다): ① 탭이 그대로 ② 새로고침이 다시 돌지 않는다 ③ 체크 칸이 그대로다(잠금이 풀리지 않는다) ④ 사이드바가 다시 접히거나 펴지지 않는다. `keydown`의 `target`은 그 버튼·체크 칸(또는 `body`), `keyup`의 `target`은 SVG다. 다르면 16.2의 대체안 |
| E11 | 3D 캔버스 위에서 오른쪽 버튼·휠 버튼을 누른다(콘솔에 캔버스 `pointerdown`의 `button`을 찍는다) / 편집기 밖(탭 버튼·앱 사이드바)과 확인 창의 버튼을 누른다(콘솔에 창 캡처 `pointerdown`의 `target`을 찍는다) | `button` 2·1로 온다 / 누름마다 온다(대상이 3D 캔버스가 아니다). 오지 않으면 16.2의 대체안 |

**도구**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| T1 ★ | 도구줄 | '선택'과 '화면 이동'. 마우스를 올리면 5.1의 설명. 3D의 '선택 / 둘러보기'와 기즈모 '이동'은 그대로 |
| T2 ★ | 보기 모드: 방 위에서 끈다 / 빈 곳에서 끈다 / 방을 눌렀다 뗀다 / 빈 곳을 눌렀다 뗀다 | 화면이 움직이고 선택·아래 이미지 그리드가 그대로 / 〃 / 그 방이 선택된다 / 선택이 풀린다 |
| T3 ★ | 편집 중 '선택': 빈 곳에서 끈다 | 화면이 움직이지 않고 상자가 나온다 |
| T4 | '화면 이동' 도구: 방 위·빈 곳·손잡이 위에서 끈다 | 화면만 움직인다. 아무것도 선택·이동되지 않는다. 커서가 손 모양, 끄는 동안 쥔 손 |
| T5 | 스페이스를 누른 채: 사각형 도구로 끈다 / 다각형 도구로 누른다 / 기호 도구로 누른다 / 크기 네모를 끈다 | 넷 다 화면만 움직인다(그려지지 않고, 점이 찍히지 않고, 기호가 놓이지 않고, 크기가 바뀌지 않는다). **커서**: 사각형·다각형·기호 도구 모두 스페이스를 누르고 있는 동안 바탕과 노드 위가 손 모양(십자가 아니다), 끄는 동안 쥔 손 |
| T6 | 방을 끄는 도중 스페이스를 누른다 / 상자를 그리는 도중 스페이스 / 스페이스를 누른 채 방을 더블클릭 | 끌기가 그대로 이어지고 **커서가 손 모양으로 바뀌지 않는다** / 〃 / 아무 일도 없다 |
| T7 | 3D에서 스페이스 | 아무 일도 없다(페이지가 내려가는지는 v1.131.0과 같은지만 기록). 스페이스로 화면 옮기기는 평면 전용이다(완료 보고) |
| T9 | 도구줄의 버튼에 포커스를 둔 채 스페이스를 눌렀다가 끌지 않고 뗀다 / 속성 칸의 잠금 체크 칸에 포커스를 둔 채 같은 일 / 도구줄 버튼에 포커스를 둔 채 스페이스를 누르고 **방 위에서 끈 뒤** 뗀다 | 그 버튼이 눌린다(도구가 바뀐다). 손 모양 커서가 남지 않는다 / 체크 칸이 바뀐다(잠금이 켜지거나 꺼진다) / 화면이 움직이고 그 버튼은 눌리지 않는다(도구가 그대로다) |
| T10 | 보기 모드: 겹친 카메라 셋 위에서 끈다 / 방을 Shift+클릭 | 화면이 움직이고 선택은 그대로 / 보통 클릭처럼 그 방 하나가 선택된다 |
| T8 (740) | 도구줄·아래 줄 | 라벨이 숨어도 두 아이콘이 구분된다. 힌트는 두 줄 안(넘치면 말줄임, 올리면 전체) |

**여러 개 고르기**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| M1 ★ | 빈 곳에서 의자 둘과 카메라를 감싸는 상자 | 끄는 동안 닿은 것이 선택된 모양이 되고, 떼면 속성 칸이 `3개 선택` |
| M2 ★ | 방 I **안쪽에만** 상자를 그려 의자 둘을 감싼다(Shift를 누른 채 시작) | 의자 둘만 잡힌다. 방 I와 O는 잡히지 않는다 |
| M3 | 상자가 방 I의 벽을 가로지른다 / 방 I를 통째로 감싼다 | 방 I가 잡힌다 |
| M4 | 30° 돌린 방·타원 방·ㄱ자 방의 빈 귀퉁이(감싼 상자 안, 모양 밖)에 작은 상자 | 잡히지 않는다 |
| M5 | 카메라의 부채꼴만 걸치는 상자 / 몸통에 걸치는 상자 | 안 잡힘 / 잡힘 |
| M6 ★ | Shift+클릭으로 하나 더하기, 다시 Shift+클릭 / 묶음에 든 것을 Shift+클릭 / Shift+상자 | 더해지고 빠진다 / 그것만 빠진다(묶음이 끌리지 않는다) / 보통 상자와 같다: 닿은 것으로 **바뀐다** |
| M13 ★ | 잠기지 않은 큰 방 O를 눌러 고른 채(화면을 덮고 있다), Shift를 누른 채 O 위에서 끌어 의자 둘을 감싼다 → 의자 하나를 끈다 | 의자 둘만 선택된다(O는 묶음에 없다) → 의자 둘만 움직이고 O와 다른 것은 제자리 |
| M14 | 공간을 하나 그린다 → Ctrl+Z → 의자를 Shift+클릭 → Ctrl+Y | 선택은 의자 하나다. 돌아온 공간은 선택돼 있지 않고 `2개 선택`이 뜨지 않는다 |
| M15 | 이름 칸이 열린 채(글자를 몇 개 친 뒤) 다른 것을 Shift+클릭 / 빈 곳에서 상자 | 이름이 확정되고 그것이 더해진다 / 이름이 확정되고 상자가 그려진다 |
| M16 | 잠긴 방 위에서 끌어 상자를 그리다 Esc | 상자만 사라진다. 선택과 도구가 그대로다 |
| M17 | 도면 A에서 셋을 고른다 → 도면 트리로 다른 도면에 갔다가 돌아온다 | A의 셋이 그대로 선택돼 있다. 간 도면은 자기 선택을 보인다 |
| M7 ★ | O를 잠근다 → O의 빈 바닥에서 Shift 없이 끈다 | 상자가 나온다. 그 상자가 O의 벽에 닿지 않으면 O는 잡히지 않는다 |
| M8 | 잠기지 않은 O 위에서 Shift+끌기 | 상자가 나온다(O는 끌리지 않는다) |
| M9 | 묶음에 든 의자를 눌렀다 뗀다 / 묶음 밖의 것을 누른다 / 빈 곳을 눌렀다 뗀다 | 그 의자 하나 / 그것 하나 / 풀린다 |
| M10 | 25%와 400%에서 상자 | 상자의 선 굵기·점선이 같고 포인터를 정확히 따라온다 |
| M11 | 상자를 그리는 중 휠 / `+` | 확대되지 않는다 |
| M12 | 하나를 고른 뒤(손잡이가 보인다) Shift+클릭으로 하나 더 | 손잡이·점 손잡이가 사라지고 요약이 뜬다 |

**묶음 동작**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| G1 ★ | 방 I + 의자(다른 방 것) + 카메라를 고르고 그중 하나를 끈다 → Ctrl+Z | 함께 움직인다. 방 I의 의자·카메라도 따라간다 → 한 번에 모두 돌아온다. 묶음은 선택된 채 |
| G2 ★ | 묶음을 다른 방의 벽 가까이로 끈다 / Alt를 누른 채 | 묶음 전체의 가장자리가 붙고 안내선이 붙은 동안만 보인다. 서로의 간격이 그대로 / 붙지 않는다 |
| G3 | 방 I와 **그 방의 의자**를 함께 골라 끈다 | 의자가 방과 같은 만큼만 간다(두 배로 가지 않는다) |
| G4 | 묶음에 잠긴 의자를 Shift+클릭으로 넣고 끈다 | 잠긴 의자만 제자리 |
| G5 ★ | 묶음 + Delete / 요약의 삭제 버튼 → 두 경우 모두 **마우스를 더 누르지 않고** Ctrl+Z | `선택한 N개 삭제` 확인 창 → 한꺼번에 지워진다 → Ctrl+Z 한 번에 모두 돌아온다(확인 뒤 포커스가 캔버스에 있다) |
| G6 | 잠긴 것이 섞인 묶음을 지운다 / 모두 잠긴 묶음 | 문구에 `잠긴 M개는 지워지지 않습니다` → 잠긴 것만 남아 선택돼 있다 / Delete에 반응 없음, 버튼 비활성 |
| G7 ★ | 요약의 `모두 잠그기`를 누른다 → **마우스를 더 누르지 않고** Ctrl+Z → 다시 `모두 잠그기` → `잠금 풀기` → Ctrl+Z 두 번 → 이어서 Delete | 한꺼번에 잠기고(점선·자물쇠) Ctrl+Z로 풀린다 / 되돌리기는 한 단계씩 / 버튼을 누른 뒤의 포커스가 캔버스라 키가 바로 듣는다(삭제 확인 창이 뜬다) |
| G8 | 묶음 상태에서 F2 · Ctrl+D | 아무 일도 없다 |
| G9 | 묶음 + Esc / 하나 선택 + Esc / 다각형을 그리다 Esc 두 번 | 셋 다 선택이 그대로다(Esc는 선택을 풀지 않는다). 다각형은 첫 번째에 도구가 되돌려진다 |
| G10 ★ | 묶음 상태에서 3D로 → 기즈모로 강조된 것(대표)을 옮긴다 → **강조된 대표를 한 번 누른다**(겹친 것이 없는 자리) → 궤도를 돌린다 → 평면으로 | 3D에서는 대표 하나만 강조되고 속성 칸 맨 위에 6.5의 한 줄. 돌아오면 묶음이 그대로 |
| G17 ★ | **대표가 겹친 카메라일 때**: 의자를 고른 뒤 같은 자리의 카메라 셋을 Shift+클릭한다(맨 위 카메라가 대표가 된다) → 3D로 → 강조된 카메라를 한 번 누른다 / (편집 중) 그 카메라의 손잡이를 끌지 않고 한 번 누른다 / 보조 평면도에서 그 카메라를 누른다 → 평면으로 | 세 경우 모두 3D의 강조가 같은 자리의 **다음 카메라**(묶음 밖)로 넘어간다. 돌아오면 묶음이 그대로다: 의자와 처음의 카메라, 둘 |
| G11 ★ | 묶음 상태에서 3D로 가 **묶음 안의 다른 것**을 누른다 → 보조 평면도에서 또 다른 묶음 안의 것을 누른다 → 평면으로 | 3D의 강조·기즈모·속성 칸이 누른 것으로 옮겨 간다. 돌아오면 묶음이 그대로다(개수도 순서도 같다) |
| G18 ★ | **대표인 방을 천천히 두 번**: 의자와 방 I를 고른 채(I가 대표, I 아래에 O가 있다) 3D로 가 I의 바닥을 1초 간격으로 두 번 누른다 → 평면으로 | 3D의 강조가 I → O로 넘어간다(O는 묶음 밖이다). 돌아오면 묶음이 그대로다: 의자와 I |
| G15 ★ | 묶음 상태에서 3D로 가 다음을 하나씩 하고 그때마다 평면으로 돌아와 본다: **묶음 밖의 것**을 누른다 / **빈 바닥**을 누른다 / 보조 평면도의 바탕을 누른다 / 오브젝트 목록에서 묶음 밖의 것을 고른다 / 속성 칸의 `×` / 카메라 추가 / 바닥에 기호 놓기 | 3D에서는 그때그때 그 하나만 강조된다(빈 바닥·바탕·`×`면 강조된 것이 없고 속성 칸은 안내 한 줄 + 도면 구성, 목록은 그 하나의 줄만 강조). **일곱 경우 모두 평면으로 돌아오면 처음의 묶음이 그대로 선택돼 있다**(3D에서 고르거나 만든 것은 선택에 없다) |
| G16 | 묶음 상태의 3D에서 연결된 방을 더블클릭해 들어갔다가 경로 줄로 돌아온다 — 그 방이 묶음의 대표일 때 / 묶음 밖의 방일 때 → 평면으로 | 돌아온 3D에는 들어갔던 방이 강조돼 있다. 평면에서는 두 경우 모두 묶음이 그대로다 |
| G19 | 셋을 고른 채 3D로 가 그중 하나(3D에서 눌러 고른 것)를 Delete로 지운다 → 평면으로 → Ctrl+Z / 둘을 고른 채 같은 일 | 3D에는 강조된 것이 없고, 평면에 나머지 둘이 선택돼 있다 → 되돌리면 셋이 다시 묶음 / 3D가 남은 하나를 바로 강조하고 평면에서도 그것 하나 |
| G20 | 하나만 고른 채 3D로 가 다른 것을 누른다 / 빈 바닥을 누른다 → 평면으로 | 그것이 선택돼 있다 / 선택이 풀려 있다(v1.131.0과 같다) |
| G12 | 묶음 상태에서 `도면 저장` / `취소` | 저장 뒤에도 여러 개가 강조된 채, 요약에 버튼이 없다 / 초안에만 있던 것이 빠진다 |
| G13 | 묶음 상태의 이미지 그리드 | 도면 전체 범위 |
| G14 | 묶음을 끌다 Esc | 원위치, 묶음 그대로 |

**겹친 공간**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| O1 ★ | 나중에 그린 큰 방 O 안의 방 I를 누른다(평면·보조 평면도·3D 각각) | 셋 다 I가 잡힌다 |
| O2 ★ | 같은 자리를 **1초 간격**으로 거듭 누른다(평면 편집 중·보기 모드, 보조 평면도, 3D 보기 모드, 3D 편집 중) | I → O → I … (3D 편집 중에는 둘째 누름이 I 한가운데에 뜬 기즈모 손잡이에 떨어져도 넘어간다) |
| O3 ★ | 편집 중, 연결 없는 I를 빠르게 두 번 | 이름 칸이 I에 열린다(넘어가지 않는다) |
| O4 ★ | I에 상세 도면이 연결된 도면: I를 빠르게 두 번(보기 모드 / 편집 중 / 3D) | 셋 다 그 도면으로 들어간다. 넘어가지 않는다 |
| O5 | O에만 연결된 도면: I가 있는 자리를 천천히 두 번 눌러 O까지 넘긴 뒤 **다른 곳을 누르지 않고** 그 자리를 빠르게 두 번(평면 / 3D) | O의 도면으로 들어간다 |
| O6 ★ | **더블클릭이 할 일이 없는 곳에서 빠르게 두 번** — 연결 없는 겹친 방 I·O, 아무것도 고르지 않은 채 I를 빠르게 두 번 누른다: 평면 보기 모드 / 평면 편집 중(I·O 모두 잠가 둔 채) / 보조 평면도 / 3D 보기 모드 / 3D 편집 중(둘째 클릭이 I 한가운데의 기즈모 손잡이에 떨어진다). 이어서 빠르게 세 번도 눌러 본다 | 다섯 다 **I가 선택된 채 남는다**(O로 넘어가지 않는다 — v1.131.0에서 방을 더블클릭하면 그 방이 선택된 채 남던 것과 같다). 세 번 눌러도 같다 |
| O26 ★ | **넘겨 둔 뒤의 빠른 두 번** — 연결 없는 세 겹(작은 S·가운데 M·큰 B): S를 눌러 고르고 1초 쉰 뒤 그 자리를 빠르게 두 번 누른다 → 다시 1초 쉬고 빠르게 두 번: 평면 보기 모드 / 보조 평면도 / 3D | 셋 다 첫 번째 빠른 두 번에 **M에서 멈춘다**(첫 클릭이 한 칸 넘기고 둘째 클릭은 넘기지 않는다), 두 번째 빠른 두 번에 B에서 멈춘다. 어느 둘째 클릭도 S로 되돌리지 않는다 |
| O7 | I가 있는 자리를 천천히 두 번 눌러 O까지 넘긴 뒤 그 자리에서 끈다 / 끈 뒤 그 자리에서 한 번 더 끈다 | 두 번 다 O가 움직인다 |
| O8 ★ | O를 고르고 잠근다 → I를 끈다 / 다시 O를 고른 뒤(잠긴 채) I를 빠르게 두 번 | I가 움직이고 선택이 I로 바뀐다 / I의 이름 칸이 열린다(O로 넘어가지 않는다) |
| O9 | 세 겹(작은·잠긴 가운데·큰)에서 천천히 거듭 누른다 / 잠긴 가운데까지 넘긴 자리에서 끈다 | 작은 → 가운데 → 큰 → 작은 / 작은 것이 움직인다 |
| O14 ★ | **O를 다른 길로 골라 둔 채 I를 끈다** — 세 가지로: O의 복도(I가 없는 자리)를 눌러서 / O를 방금 그려서(이름 칸을 Enter로 닫은 뒤) / 오브젝트 목록에서 O를 눌러서 | 셋 다 **I가 움직이고** 선택이 I로 바뀐다. O는 제자리다 |
| O15 ★ | I에만 연결된 도면: O를 다른 길로 골라 둔 채(O14의 세 가지 가운데 하나) I를 빠르게 두 번 — 평면 보기 모드 / 평면 편집 중 / 3D | 셋 다 **I의 도면으로 들어간다** |
| O16 ★ | I에만 연결된 도면: I를 빠르게 두 번 → 경로 줄로 돌아온다, 를 **세 번** 되풀이 — 평면 보기 모드 / 평면 편집 중 / 3D | 세 번 다 들어간다. 돌아올 때마다 I가 선택돼 있다(O가 아니다) |
| O17 ★ | 세 겹(작은·가운데·큰): 가운데를 **다른 자리**(작은 것이 없는 자리)에서 눌러 고른 뒤 작은 것을 누른다 — 평면 보기·편집, 보조 평면도, 3D | 넷 다 작은 것이 잡힌다(큰 것이 아니다). 이어서 그 자리를 천천히 거듭 누르면 가운데 → 큰 → 작은 |
| O18 | I에만 연결된 도면, 보기 모드: I 자리를 천천히 두 번 눌러 O까지 넘긴 뒤 그 자리를 빠르게 두 번(평면 / 3D) / 같은 일을 편집 중에 | I의 도면으로 들어간다(O에는 더블클릭이 할 일이 없다) / O의 이름 칸이 열린다(완료 보고에 적을 것) |
| O19 | 오브젝트 목록에서 O를 고른 뒤, 휠 버튼으로 I 위에서 화면을 옮기고, 이어서 I를 끈다 | I가 움직인다(화면 이동 누름은 "앞 누름"이 아니다) |
| O23 ★ | **보기 모드**, O와 I가 모두 연결된 도면: O를 복도(I가 없는 자리)에서 눌러 고른다 → **I 위에서 왼쪽 버튼으로 끌어 화면을 옮긴다** → I를 한 번 누른다 / 같은 준비(O를 고르고 I 위에서 끌어 화면을 옮김)를 다시 한 뒤, 1초쯤 쉬고 I를 빠르게 두 번 | I가 선택된다 / **I의 도면**으로 들어간다(O의 도면이 아니다). 끌어서 화면을 옮긴 누름은 "앞 누름"이 아니다 |
| O24 ★ | **보기 모드**, 세 겹(작은·가운데·큰): 가운데를 다른 자리(작은 것이 없는 자리)에서 눌러 고른다 → 작은 것 위에서 끌어 화면을 옮긴다 → 작은 것을 한 번 누른다 | **작은 것**이 잡힌다(큰 것이 아니다). 이어서 그 자리를 천천히 거듭 누르면 가운데 → 큰 → 작은 |
| O25 | 편집 중, 서로 걸친 두 방(잠긴 작은 방 L, 큰 방 X — X의 벽이 L 안을 지난다): L 안에서 끌어 상자로 X의 벽만 건드린다 → 두 방이 겹친 자리(L이 위)에서 끈다 / 그 자리를 한 번 누른다 | X 하나가 선택된다 → 상자가 다시 나온다(X가 움직이지 않는다) / L이 선택된다. 상자로 끝난 누름은 "앞 누름"이 아니다 |
| O20 | 3D 편집 중: O를 골라 둔 채(기즈모가 I 위에 떠 있다) 그 손잡이를 끌지 않고 한 번 누른다 | 선택이 그대로 O다 |
| O21 ★ | 3D '둘러보기' 도구: '선택' 도구로 O의 복도를 눌러 둔 뒤 '둘러보기'로 바꿔 연결된 I를 더블클릭 | I의 도면으로 들어간다(O가 아니다. 선택은 바뀌지 않는다) |
| O22 | 카메라의 부채꼴 아래에만 있는 작은 공간을 누른다 → 상자로 그 공간을 감싼다 / 기호 아래에 통째로 깔린 작은 공간 | 눌러서는 카메라가 잡힌다 → 상자로는 그 공간이 잡힌다(16절의 알고 넘어가는 것) / 상자에 기호도 함께 잡히면 기호를 Shift+클릭으로 뺀다 |
| O10 | I의 크기 네모로 O보다 크게 키운다 | 끌기가 끊기지 않는다. 놓은 뒤에는 O가 위다 |
| O11 | 겹친 방 위에 기호를 놓는다(평면 / 3D 바닥) | '소속 공간'이 작은 방이다 |
| O12 | 겹친 방이 생성점을 덮은 도면에서 카메라 추가 | v1.131.0과 같다(겹치면 소속 없음) |
| O13 | 겹친 카메라 셋 | ①과 같다: 편집 중 천천히 넘기기 / 빠르게 두 번이면 이름 칸. 보기 모드는 빠르게 눌러도 클릭마다 넘어간다(지금과 같다 — 연속 클릭에 넘어가지 않는 것은 공간의 더미뿐이다). 3D와 보조 평면도도 클릭마다 넘어간다 |
| O27 ★ | **3D: 다른 일을 한 뒤 같은 방을 다시 누른다** — 3D에서 I를 눌러 고른 뒤 아래를 하나씩 하고(할 때마다 I를 새로 눌러 고르고 시작한다), 1초 뒤 I의 같은 자리를 다시 누른다: ⓐ 오른쪽 버튼으로 끌어 둘러본다(I가 여전히 보이게 조금만) ⓑ 휠 버튼으로 끌어 화면을 옮긴다 ⓒ 오른쪽 버튼을 끌지 않고 한 번 누른다 ⓓ (편집 중) 기즈모 방식 버튼('회전')을 누른다 ⓔ (편집 중) 속성 칸의 이름 칸을 눌러 글자를 친다 ⓕ 오브젝트 목록에서 I를 누른다 ⓖ 3D 아래 줄의 '확대' 버튼을 누른다 ⓗ '둘러보기' 도구로 바꿔 왼쪽 버튼으로 끌고 '선택'으로 돌아온다 ⓘ (편집 중) 기즈모 화살표를 끄는 도중 Esc. 견주는 경우 둘: ⓙ 아무것도 누르지 않고 휠로 확대만 한 뒤 다시 누른다 ⓚ (편집 중) 기즈모 화살표로 I를 조금 끌어 옮긴 뒤 I 한가운데를 다시 누른다 | ⓐ~ⓘ 모두 **I 그대로**다(O로 넘어가지 않는다. 편집 중에는 둘째 누름이 기즈모 손잡이에 떨어져도 같다). ⓙ·ⓚ는 O로 넘어간다(ⓚ: 평면에서 끈 뒤와 같다, O7) |
| O28 ★ | **보조 평면도: 다른 일을 한 뒤 같은 방을 다시 누른다** — 3D 옆의 보조 평면도에서 I를 눌러 고른 뒤 아래를 하나씩 하고, 1초 뒤 보조 평면도의 I를 다시 누른다: ⓐ 3D 화면을 오른쪽 버튼으로 끌어 둘러본다 ⓑ (편집 중) 속성 칸의 이름 칸을 눌러 글자를 친다 ⓒ 오브젝트 목록에서 I를 누른다 ⓓ 도구줄의 버튼을 누른다 ⓔ 보조 평면도의 I 위에서 오른쪽 버튼을 한 번 누른다. 견주는 경우: ⓕ 아무것도 누르지 않고 1초 뒤 다시 누른다 | ⓐ~ⓔ 모두 **I 그대로**다. ⓕ는 O로 넘어간다 |
| O29 | **세 화면이 같다** — O27의 ⓑ·ⓔ·ⓕ를 평면에서 한다: 평면에서 I를 눌러 고른 뒤 휠 버튼으로 화면을 옮긴다 / (편집 중) 속성 칸의 이름 칸에 글자를 친다 / 오브젝트 목록에서 I를 누른다 → I의 같은 자리를 1초 뒤 다시 누른다 | 셋 다 I 그대로다(3D·보조 평면도와 같은 결과) |

**그대로여야 하는 것**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| R1 ★ | ①의 기능: 휠 확대·맞춤, 그리자마자 이름, 하나 옮기기·크기·회전의 스냅과 Alt, 다각형 점 편집, F2 | v1.131.0과 같다 |
| R2 | 3D의 기즈모·둘러보기·시점 보기·기호 놓기, 보조 평면도의 표시 | 같다 |
| R3 | 저장 → 새로 고침 / 상세 도면 만들기·연결 | 같다. 저장된 도면의 노드 순서가 바뀌지 않았다 |
| R4 ★ | 어두운·밝은 화면에서 상자, 여러 개의 강조, 요약 | 또렷하다 |
| R5 (740) | 요약과 오브젝트 목록 | 버튼이 잘리지 않는다 |

**배포 뒤 실기에서만 볼 수 있는 것**: 한솔 PC의 마우스로 "천천히 다시 누르기"와 "빠른 더블클릭"이 헷갈리지 않는지(윈도우의 더블클릭 간격 설정), 실제 도면(방과 가구가 많은)에서 상자의 느낌, 설치된 앱의 창에서 스페이스.

---

## 14. 배포 기록과 문서

- 버전: `package.json`의 `version`과 `package-lock.json`의 두 곳(맨 위 `version`, `packages[""].version`)을 `1.132.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다.
- `DEVLOG/update-notes.json` 맨 앞에 추가(비개발자 문구, 시험 공개 표기는 1.131.0과 같은 방식):

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

- 문서
  - `AGENTS.md` '배경 라이브러리 데이터 경계'의 "평면 편집 보조(v1.131.0)" 항목(:112) 다음에 한 항목: **선택과 겹친 공간(v1.132.0)** — 선택 묶음은 문서의 도면별 보기 값에 날것으로 두고(`selectedIds`, 대표는 마지막) 읽을 때 `mapSelection`이 사라진 노드를 거른다(리듀서는 되돌리기·초안 버리기에서 선택을 건드리지 않는다). 선택 액션은 `select`·`select-many` 둘뿐이고 둘 다 바꿔 넣기다: 날것 목록에 더하거나 빼는 액션은 만들지 않는다(사라진 노드가 묶음에 끼어든다. Shift+클릭은 편집기가 살아 있는 선택에서 새 목록을 만든다) / 평면 ↔ 3D 전환은 선택을 바꾸지 않고, 3D·보조 평면도는 하나만 받는다(`mapCanvas.ts` 계약 불변). 그 하나는 `selectedId`를 `singleViewId`로 읽은 것이다: 선택이 하나 이하면 그 선택, 여러 개면 처음에는 대표이고 3D에서 고른 것으로 따로 움직인다. **3D 모드에서 하는 고르기는 묶음(`selectedIds`)을 바꾸지 않는다**: 편집기의 `select` 한 곳이 `pickAction`으로 액션을 정해, 3D 모드에서 여러 개가 선택돼 있으면 `pick-one`(`selectedId`만)을, 그 밖에는 `select`를 보낸다. 3D·보조 평면도가 알려 주는 id는 눌린 노드가 아니라 넘기기를 거친 결과라서(겹친 카메라의 다음 것, 아래 바닥) "대표를 눌렀는가, 묶음 안인가"로 가르지 않는다. 3D 모드에 `select(…)`를 부르는 길을 더할 때는 그 편집기 함수를 지나게 한다(`doc.select`를 직접 부르지 않는다). 묶음 동작(함께 옮기기·지우기·잠그기)과 묶음을 푸는 일은 평면에서만 / 편집기의 `selected`는 "하나를 다루는 도구가 붙는 노드"이며 평면의 여러 개 선택에서는 비어 있다 / '선택' 도구의 누름은 `resolvePlanPress`(순수)가 정하고 편집기는 실행만 한다 / 상자는 화면 상태이고 문서 제스처가 아니다(되돌리기 단계 없음). Shift를 누른 채 그린 상자도 선택을 바꿔 넣는다. 공간은 **벽**이 상자에 닿아야 잡힌다(상자가 공간 안쪽에만 있으면 그 공간은 잡히지 않는다 — 넓이로 재면 가구를 고르는 상자가 방과 건물 외곽을 늘 함께 잡는다) / 묶음 이동은 제스처 한 번이고 `moveMapNodes`가 공간마다 `transformMapSpace`를 한 번 불러 소속 항목을 한 번만 싣는다. 잠긴 것은 옮기지도 지우지도 않는다(`moveMapNodes`·`removeMapNodes` 안의 규칙) / 겹친 공간의 순서는 `mapStack.ts` 한 곳(작은 넓이가 위, 같으면 배열 순서)이며 평면 그리기·같은 자리를 다시 누를 때 넘어가는 목록(`planPileAt`)·보조 평면도·3D `pickMapFloor`·새 기호의 소속이 모두 읽는다. 배열(`nodes`)은 다시 정렬하지 않는다 / **처음 누르는 자리에서는 늘 맨 위(가장 작은) 공간이 잡힌다. 아래 공간이 대상이 되는 것은 같은 자리를 다시 누를 때뿐이다**(`again`: 평면은 `lastSpot`+`sameSpotAgain`, 3D와 보조 평면도는 각자의 `turn`). 공간의 더미는 그 점을 품은 공간 전부라서, 이 조건을 빼면 큰 공간이 선택된 동안 안쪽 방의 누름·끌기·더블클릭이 모두 큰 공간에 작용한다. 평면의 자리 기억은 그 누름이 눌린 노드를 고르거나 옮겼을 때만 남는다: 끌려서 화면 이동(보기 모드)이나 상자가 된 누름은 남기지 않는다(남기면 골라 둔 바깥 공간이 그 방의 대상이 된다). 카메라·기호의 더미는 ①의 규칙 그대로다 / **자리 기억은 세 화면에서 같은 때에 끝난다**: 고르는 누름이 아닌 캔버스 누름(화면만 옮기는 누름, 왼쪽 주 버튼이 아닌 누름, 취소된 끌기)과 캔버스 밖의 누름 뒤에는 그 자리를 다시 눌러도 처음 누름이다. 3D는 `onPointerDown`·`onPointerUp`·취소 줄과 창 캡처 `pointerdown`(`onPressElsewhere`)이, 보조 평면도는 창 캡처 `pointerdown`(`forget`)이 `turn`을 지운다. 끝까지 간 기즈모 끌기만 평면의 옮기기처럼 기억을 남긴다. 3D나 보조 평면도에 누름을 받는 길을 더할 때는 이 표(설계 7.3 끝)에 맞춘다 / **공간의 더미는 연속 클릭(클릭 횟수 2 이상)에 넘어가지 않는다 — 그 더블클릭이 할 일이 있든 없든.** 넘기는 것은 새 클릭 묶음을 시작하는 클릭뿐이다(평면: SVG `click`의 `cycle.spaces`, 3D: `resolveMapClick`의 `repeat`, 보조 평면도: `nextPlanSelection`의 `repeat`). "할 일이 없으면 넘긴다"로 되돌리면 보기 모드·잠긴 방·3D에서 방을 더블클릭할 때마다 선택이 아래 공간으로 바뀐다. 카메라·기호의 더미만 "연속 클릭이고 그 더블클릭이 무언가를 할 때" 건너뛴다(`doubleClickIntent` 하나를 그 넘기기와 더블클릭이 함께 쓴다. 첫 누름의 대상에 할 일이 없으면 맨 위 것의 일을 한다). 더블클릭으로 들어간 공간은 선택된 채 남는다(`openSpace`). 3D는 `mousedown`의 `detail`로, 보조 평면도는 `click`의 `detail`로 연속 클릭을 안다(`pick`·`doubleClickNode`, `activate`) / 화면 이동은 휠 버튼·'화면 이동' 도구·스페이스. 스페이스는 **추적과 삼키기가 따로다**: 창 캡처로, 평면 모드이고 편집기가 화면에 보이면 포커스가 어디에 있든(편집기 밖의 버튼, 체크 칸 포함) 누르고 있음을 적는다 — 스페이스가 글자이거나 열린 창의 것일 때(`spaceEntry`: 글자 칸·`select`·`contenteditable`·`dialog`. 체크 칸은 아니다)만 뺀다. 기본 동작은 편집기 안의 빈 곳과 `body`에서만 막는다(버튼·체크 칸·접기 줄과 편집기 밖의 것은 건드리지 않는다). 추적 조건에 포커스 자리를 넣으면 밖의 버튼이나 잠금 체크 칸을 누른 직후 스페이스+끌기가 방을 옮긴다. 보기 모드에서는 어디를 끌어도 화면이 움직이고 선택은 움직이지 않고 뗄 때 바뀐다 / Esc는 선택을 풀지 않는다 / 새 카메라의 소속 규칙("정확히 하나")은 그대로다.
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절의 ① 줄(:24) 다음에 `- [x] 2026-10-09 ② 선택 도구 개편(v1.132.0): 상자로 여러 개 고르기와 묶음 옮기기·지우기·잠그기, '화면 이동' 도구와 스페이스·휠 버튼, 겹친 공간에서 작은 방이 먼저. 저장 자료·운영 DB는 그대로다. 설계: docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md` 한 줄. 버전 목록의 v1.131.0 절(:1411-1418) 다음에 `### v1.132.0 배경 도면 ② 선택 도구 개편 (2026-10-09)` 절(세 기능 각 한 줄, 수동 검증, 배포 뒤 실기 확인).
  - `DEVLOG/background-3d-opus-handoff-2026-10-07.md`: `## 16. ② 선택 도구 개편 (v1.132.0)` — 16.1 문서 위치(이 설계, 구현 계획 `docs/superpowers/plans/2026-10-09-background-map-selection-tools.md`, 검증 기록의 절 이름) · 16.2 파일(11절의 표) · 16.3 뒤 차례가 지켜야 할 것(쌓임 순서는 `mapStack.ts` 한 곳이고 ③의 도로는 비교 함수의 맨 앞 항 / 선택은 날것으로 두고 읽을 때 거른다. 선택 액션은 바꿔 넣기뿐이다 / `selected`의 뜻 / 전환은 선택을 건드리지 않는다. `selectedId`는 선택이 아니라 3D의 하나이고(`singleViewId`로 읽는다), 3D 모드의 고르기는 편집기의 `select` → `pickAction` 한 곳을 지나 묶음을 건드리지 않는다 / 누름 판정은 `resolvePlanPress`에만. 공간의 더미에서 아래 것이 대상이 되는 것은 `again`일 때뿐이다 / 자리 기억이 끝나는 때는 평면·3D·보조 평면도가 같다(설계 7.3 끝의 표) / 공간의 더미는 연속 클릭에 넘어가지 않는다(세 화면 모두). 카메라·기호 더미의 넘기기와 더블클릭은 `doubleClickIntent` 하나 / 스페이스는 추적(포커스가 어디에 있든)과 삼키기(편집기 안의 빈 곳과 `body`만)가 따로다 / ④에서 편집 권한이 넓어져도 묶음 동작은 `canEdit` 하나를 본다) · 16.4 뒤 차례가 정할 것(⑤의 주석 핀이 상자에 잡히는지는 ⑤가 정한다. 이번 차례의 상자·더미·쌓임 순서 코드는 공간·기호·카메라만 읽는다).
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-09 ② 선택 도구 개편 (v1.132.0)` — 12.7의 수치, 13절 결과(E1~E11, G10·G11·G15·G17·G18·O6·O14~O18·O23·O24·O26~O29·M2·M13 관찰 포함. E10은 네 경우마다 스페이스 `keydown`·`keyup`의 대상과 밖의 버튼이 눌렸는지를 적는다), Q1에 받은 답, 확인하지 못한 것.
  - `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`: B2 절에 설계·구현 계획 링크와 상태 한 줄, 7절 진행 기록 표의 ② 행(설계 문서 경로, 상태).
  - 완료 보고(한솔에게): 16절 '완료 보고에 적을 것'을 비개발자 문장으로 옮겨 적는다.
  - `CLAUDE.md`는 고치지 않는다(구조 변경 없음).

---

## 15. 구현 순서 (단계마다 typecheck·`test:background`가 통과하게)

0. **구현 전**: Q1(1.1)의 답을 받는다. 답이 이 설계와 같으면 그대로 간다. 다르면 16절에 적은 곳만 고친 뒤 그 단계를 한다. 답에 걸리는 곳은 4단계의 `planRectTouches` 공간 판정뿐이므로, 1~3단계는 답을 기다리는 동안 해도 된다.
1. **쌓임 순서**: `mapStack.ts` + `tests/backgroundMapStack.test.ts`. 평면 SVG와 보조 평면도의 그리는 순서, `pickMapFloor`의 번호, `placeSymbol`의 소속을 바꾸고 3D의 고정 테스트 셋(12.1의 :340-353, :367, :1616)을 고친다. 이 시점에 "작은 방이 먼저 잡힌다"가 평면·3D에서 된다(넘기기는 아직 없다).
2. **선택 모델**: `mapDocument.ts`(필드·액션 `select-many`·`pick-one`·`mapSelection`·`singleViewId`·`pickAction`) + 훅 + 테스트(12.1의 넷, 12.2). 편집기는 3.5의 줄들과 표의 읽는 곳만 바꾼다(`singleId`를 3D·보조 평면도로, `select`의 본문을 `pickAction`으로, `ObjectList` props). 여러 개를 고를 길이 아직 없으므로 동작은 v1.131.0과 같아야 한다(하나 이하 선택에서는 `pickAction`이 늘 `select`이고 `singleId`가 그 선택이다).
3. **묶음 계산**: `mapGeometry.ts`의 `moveMapNodes`·`removeMapNodes`·`lockMapNodes`, `mapPlanGesture.ts`의 `move-group` + 테스트(12.5의 앞부분). 편집기는 아직 부르지 않는다.
4. **판정 모듈**: `mapPlanSelect.ts`(`resolvePlanPress`·`sameSpotAgain`·상자·`planMarkCovers`), `mapPlanPreview.ts`의 `planPileAt`, `mapPlanEdit.ts`의 `planDoubleClickAction` + 테스트(12.4, 12.5의 뒷부분). 편집기는 아직 부르지 않는다.
5. **편집기의 포인터 흐름**(9절): 화면 이동의 세 길과 스페이스, 보기 모드의 화면 이동과 뗄 때 선택, `resolvePlanPress`와 `lastSpot` 배선, 상자(`MapMarquee`·CSS), 묶음 이동, Shift, 넘기기 조건(`cycle.spaces`와 `doubleClickIntent`)·`openSpace`, 도구줄·힌트 문구. **E1~E5·E7~E10을 이 단계에서 먼저 확인**한다(E10: 편집기 밖의 버튼·잠금 체크 칸을 누른 직후의 스페이스).
6. **묶음 동작**: `BackgroundMapSelectionSummary.tsx`, 삭제 확인(`'delete-group'`)·잠금과 그 뒤의 포커스, Delete, Esc의 상자 취소, 3D의 한 줄 안내.
7. **3D와 보조 평면도의 넘기기**: `mapFloorPile`·`mapClickAim`·`resolveMapClick`의 `again`·`repeat`, 뷰포트의 `repeat`·`turn`·`aimed`·`pick`·`doubleClickNode`와 `turn`을 끝내는 줄들(창 캡처 `pointerdown` 포함), `nextPlanSelection`의 점과 `again`·`repeat`, 보조 평면도의 `turn`·클릭 횟수 넘기기·창 캡처 `pointerdown` + 테스트(12.5의 뒷부분, 12.6). **E6·E11을 이 단계에서 먼저 확인**한다.
8. 앵커(12.8)와 뮤테이션 확인, 수동 검증(13절), 버전·기록·문서(14절).

---

## 16. 열린 질문과 확인 필요

### 16.1 구현 전에 한솔에게 확인할 것 (하나)

승인 문구가 한 가지로 정하지 않는 한 곳이다(1.1의 표). 이 설계는 아래 '이 설계의 답'으로 썼다. 완료 보고로 미루지 않고 **구현 전에** 묻고, 받은 답을 1.1의 '확인' 칸에 적는다.

| # | 물을 말(비개발자 문장) | 이 설계의 답 | 다른 답이 오면 고칠 곳 |
|---|---|---|---|
| Q1 | "상자로 고를 때, 방은 **벽에 상자가 닿아야** 잡히게 할게요. 방 안쪽에만 상자를 그리면 그 방은 안 잡히고 안에 있는 가구·카메라만 잡혀요. 이렇게 하지 않으면 의자 몇 개를 고르려는 상자가 그 방과 건물 외곽까지 늘 같이 잡아서, 끌면 건물이 통째로 움직여요. 괜찮을까요? (다른 길: 상자가 방 안쪽에만 있어도 그 방을 잡는다 — 그러면 방을 잠가 둔 뒤에만 가구를 상자로 고를 수 있어요.)" | 벽에 닿아야 잡힌다 | `planRectTouches`의 공간 판정에 "상자의 한 꼭짓점이 공간 안"을 더하고(6.2), 12.4의 '안쪽' 줄들과 M2·M7·M13의 기대, 6.8의 둘째 줄, 완료 보고의 문장을 고친다 |

"3D에서는 지금처럼 하나만 다루고, 평면으로 돌아오면 여러 개 선택이 그대로 남는다"는 묻지 않는다. 앞선 초안은 "3D에서 묶음 밖의 것이나 빈 바닥을 누르면 묶음이 풀린다"를 기본으로 두고 이것을 물으려 했으나, 그 기본은 "그대로 남는다"를 어기고, 함께 적었던 다른 길("3D에서는 무엇을 눌러도 묶음 밖의 것이 골라지지 않는다")은 "지금처럼 하나만 다루고"를 어긴다. 이 설계는 두 절을 모두 글자 그대로 만든다(3.2의 `pick-one`, 3.3의 `pickAction`): 3D에서는 무엇이든 하나를 고를 수 있고, 그 고르기는 묶음을 바꾸지 않는다. 따라 나오는 점(3D에서 새로 고른 것은 평면의 선택이 되지 않는다, 묶음은 평면에서 푼다)은 완료 보고에 적는다(16.3).

### 16.2 앱 엔진에서 확인할 것

각각 대체안을 정해 둔다. 설계 중에는 코드를 읽고 순수 함수의 값만 계산했다. 앱에서 돌려 본 것은 없다.

| 확인할 것 | 기대와 근거 | 앱에서 다르면 |
|---|---|---|
| 스페이스의 `preventDefault`가 페이지 스크롤을 막는지, 버튼·체크 칸·접기 줄과 편집기 밖 요소의 스페이스는 그대로인지 (E1, E2, E9) | 창 캡처의 `keydown`에서 막으면 스크롤 기본 동작이 서지 않는다. 버튼·체크 칸·접기 줄과 편집기 밖에서는 막지 않으므로 그 요소가 지금처럼 눌린다 | 스크롤이 남으면 삼키는 줄의 대상 판정(`element === document.body`·`root.contains(element)`와 `closest`)이 실제 포커스 대상과 맞는지부터 본다. 버튼·접기 줄이 눌리지 않게 되면 삼키는 조건을 "대상이 SVG이거나 그 안, 또는 `body`"로 좁힌다(추적 조건은 그대로 둔다) |
| 버튼이 사라진 직후(공간 편집·도면 저장·확인 창)와 '모두 잠그기' 직후에 스페이스가 듣는지 (E8). 다른 탭에서는 추적도 삼키기도 하지 않는지 (E9) | 사라진 요소에 있던 포커스는 `body`로 간다. `keydown`의 대상이 `body`다. 숨긴 탭 안의 편집기는 `offsetParent`가 `null`이다 | 추적은 포커스의 자리를 보지 않으므로, 대상이 `body`가 아닌 다른 요소로 와도 화면 이동은 된다. 달라질 수 있는 것은 페이지 스크롤 막기뿐이다: 그 요소가 편집기 밖이고 스페이스가 페이지를 내리면, 그 요소를 삼키는 조건에 더하지 말고 `beginEditing`·`saveMap`·확인 창이 닫힌 뒤에 `focusCanvas()`를 부른다(포커스가 캔버스에 있으면 삼키는 줄의 `root.contains` 가지가 막는다) |
| **편집기 밖의 버튼이나 속성 칸의 잠금 체크 칸을 누른 직후에 스페이스가 듣는지** (E10): '도면 탐색' 탭 버튼, 새로고침 버튼, 앱 사이드바의 버튼(셋 다 편집기 밖), 잠금 체크 칸(편집기 안) | 스페이스 `keydown`의 대상은 포커스가 있는 그 버튼·체크 칸이다(새로고침 버튼은 도는 동안 비활성이라 `body`일 수 있다). 어느 쪽이든 추적 조건(평면 모드, 편집기가 보임, 글자 칸·창이 아님)에 든다. 창 캡처 리스너라 편집기 밖 요소의 `keydown`도 받는다 | 화면이 움직이지 않으면 콘솔에 찍은 `target`이 `spaceEntry`에 걸리는지 본다(걸리면 그 요소가 글자 칸이 아닌데도 `input`이라는 뜻이다 — 그 `type`을 `tickInputs`에 더한다). `keydown`이 아예 오지 않으면(그 요소가 전파를 캡처 단계에서 멈춘다) 그 버튼을 누른 뒤 캔버스를 한 번 눌러야 하는 것으로 두고 완료 보고에 적는다(편집기 밖 요소를 고치지 않는다) |
| 스페이스를 누른 채 캔버스를 누르면, 포커스가 있던 버튼·체크 칸이 뗄 때 눌리지 않는지 (E10, T5, T9) — 편집기 안의 것과 밖의 것 모두 | 버튼과 체크 칸은 스페이스 `keyup`이 자기에게 올 때 눌린다. 누르는 순간 포커스가 SVG로 가므로(:587) 뗄 때의 대상은 SVG다 | 눌리면: 그 스페이스 누름이 화면 이동에 쓰였음을 적어 두고(`spaceUsed` ref — `pointerDown`이 `spaceHeld.current`를 읽어 화면 이동을 시작할 때 켠다) `onSpaceKey`의 `keyup` 가지가 그때만 `event.preventDefault()`한 뒤 끈다. 끌기에 쓴 Alt(`altDrag`, :297-311)와 같은 꼴이다. 화면 이동에 쓰이지 않은 스페이스의 `keyup`은 건드리지 않으므로 버튼·체크 칸은 지금처럼 눌린다(E9, T9). 이때 앵커 28의 "`preventDefault`는 한 줄뿐"을 두 줄로 고친다 |
| Shift+클릭·Shift+끌기에 글자 선택이 생기지 않는지 (E3) | 캔버스는 `user-select:none`이고(:44) 누름에서 `preventDefault`를 한다 | 생기면 `.bmap-canvas-wrap`에 `user-select:none`을 더한다(CSS 한 줄). 그래도 남으면 그 요소에 `onSelectStart={event => event.preventDefault()}`. (`onMouseDown`으로 막는 길은 쓸 수 없다: 누름에서 `preventDefault`를 하므로(:585) 평면에는 `mousedown`이 오지 않는다 — ① 설계 2절) |
| 묶음 삭제를 확인한 뒤 포커스가 캔버스로 가는지 (G5) | 창의 정리 함수(열기 전 포커스로 돌려주기)가 먼저 돌고 `focusAfterConfirm` 효과가 그다음에 돈다(6.4) | 순서가 반대면 효과 안에서 `requestAnimationFrame`으로 한 프레임 미룬다 |
| 상자를 그리는 동안의 포인터 캡처: 캔버스 밖에서도 이어지고, 캡처를 잃으면 취소되는지 (E4) | 다른 끌기와 같은 캡처(:628)와 `onLostPointerCapture`(:841)를 쓴다 | — (같은 장치를 이미 v1.131.0이 쓰고 있다) |
| 보기 모드의 누름이 포인터를 잡은 뒤에도 `click`·`dblclick`이 SVG에 오는지 (E5) | ①에서 확인한 것과 같은 꼴이다(캡처한 누름 뒤의 `click`은 SVG에 `detail` 1, 2로 온다 — ① 검증 기록) | ① 설계 16절의 E1·E5 대체안과 같다 |
| 3D 캔버스의 `mousedown`이 오고 `detail`이 1, 2인지 (E6) | OrbitControls·TransformControls가 `pointerdown`에서 `preventDefault`를 하지 않고(three 0.186.1 소스에서 확인: OrbitControls가 막는 것은 키 입력·휠·컨텍스트 메뉴뿐이고 TransformControls에는 `preventDefault`가 없다), 뷰포트가 이미 `mousedown`을 듣는다(BackgroundMap3D.tsx:197) | 고르는 일(`pick`)을 평면처럼 캔버스의 `click` 이벤트로 옮긴다: `pointerup`은 누른 자리와 손잡이 여부를 적어 두기만 하고, `click`이 `event.detail >= 2`를 `repeat`으로 넘겨 `pick`을 부른다(`turn`·`aimed`·`doubleClickNode`는 그대로 쓴다). 이때 뷰포트 테스트의 클릭은 `click` 이벤트를 함께 보낸다 |
| 보조 평면도의 노드 `click`이 `detail` 1, 2로 오는지 (E6) | 보조 평면도는 포인터를 잡지도 누름을 막지도 않는다. 노드 `<g>`의 `click`은 보통의 클릭이라 클릭 횟수를 싣는다 | 늘 1이면 3D와 같은 꼴로 바꾼다: 보조 평면도 SVG의 `onMouseDown`이 `event.detail >= 2`를 ref에 적어 두고 `nodeButton`의 `onClick`이 그 값을 `repeat`으로 넘긴다 |
| 3D와 보조 평면도의 자리 기억이 다른 누름으로 끝나는지 (E11, O27, O28): 오른쪽·휠 버튼 누름이 캔버스의 `pointerdown`으로 오는지, 편집기 밖과 포털 창의 누름이 창 캡처 `pointerdown`으로 오는지 | OrbitControls가 `pointerdown`을 막지 않으므로 뷰포트의 캔버스 리스너(BackgroundMap3D.tsx:191)가 어느 버튼의 누름이든 받는다. 창 캡처 `pointerdown`은 편집기의 누름 기록이 ①부터 쓰는 장치다(BackgroundMapEditor.tsx:313-319 — ① 검증에서 확인) | 오른쪽·휠 버튼의 누름이 `pointerdown`으로 오지 않으면(다른 버튼이 이미 눌린 채면 `pointermove`로 온다) OrbitControls의 `start` 이벤트에서도 지운다: `this.orbit.addEventListener('start', …)` — 둘러보기·옮기기가 시작될 때마다 온다(뷰포트는 이미 그 컨트롤의 `end`를 듣는다, :190). 그 컨트롤은 휠 확대에도 `start`를 보내므로, 이 대체안을 쓰면 3D에서는 휠 확대도 기억을 끝낸다(7.3 끝의 표의 마지막 줄이 3D에서만 달라진다 — 완료 보고에 적는다). 창 캡처가 어떤 요소의 누름을 놓치면(그 요소가 캡처 단계에서 전파를 멈춘다) 그 요소만 예외로 적고 고치지 않는다 |
| 휠 버튼 끌기가 방 위에서도 자동 스크롤 없이 도는지 (E7) | 누름의 `preventDefault`(:585)가 막는다. v1.131.0에서 빈 곳과 방 위 모두 같은 줄을 지난다 | — |
| 넓이 순서가 바뀌는 순간(크기 바꾸기 도중) 공간 `<g>`가 DOM에서 자리를 옮긴다 (O10) | 포인터는 SVG가 잡고 있어 끌기가 이어진다. 키보드 포커스가 그 `<g>`에 있었다면 포커스를 잃을 수 있다(Tab으로 공간에 포커스를 둔 채 속성 칸이 아닌 곳에서 크기가 바뀌는 길은 없다) | 끌기가 끊기면, 제스처 중에는 제스처 시작 도면의 순서로 그린다(`gestureStartMap`, mapDocument.ts:153-155) |

### 16.3 완료 보고에 적을 것

승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이다. Q1은 구현 전에 이미 물었으므로(16.1) 받은 답과 함께 한 줄만 다시 적는다.

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

### 16.4 알고 넘어가는 것

- 묶음에 든 것이 다른 것 아래에 가려진 자리를 누르면 묶음이 아니라 위의 것이 잡힌다(6.1). 묶음은 묶음에 든 것이 맨 위에 보이는 자리를 잡아 끈다.
- **카메라의 부채꼴이나 기호의 상자에 통째로 덮인 작은 공간은 평면에서 눌러 고를 수 없다.** 누름이 카메라·기호에 떨어지고, 거듭 눌러도 그 더미 안에서만 돈다(더미는 종류를 섞지 않는다, 7.2). ①에도 있던 성질이며 이번에 바꾸지 않았다. 고르는 길은 둘이다: 오브젝트 목록에서 고르거나, 상자로 그 공간을 감싼다(부채꼴은 상자에 세지 않으므로 카메라가 끼지 않는다. 몸통이나 기호가 함께 잡혔으면 Shift+클릭으로 뺀다). 12.4의 `planMarqueeIds` 테스트와 O22가 이 길을 잡아 둔다.
- **평면에서만**: 키보드만으로(캔버스 밖을 한 번도 누르지 않고) 선택을 다른 것으로 바꿨다가 넘겨 두었던 바로 그 공간으로 되돌린 뒤 그 자리를 누르면 "다시 누름"으로 본다(`again`의 3번 조건은 지금의 선택만 본다 — `sameSpotAgain`). 그 자리에서 그 공간까지 넘겨 본 적이 있을 때만 생긴다. 3D와 보조 평면도에서는 생기지 않는다: 선택이 다른 것이 된 첫 렌더에서 자리 기억이 이미 끝났으므로(3D의 `update()` — `props.selectedId !== this.turn.pickedId`, 보조 평면도의 렌더 검사 — 7.3, 7.4) 선택을 되돌린 뒤의 누름은 처음 누름이고 맨 위 것이 잡힌다. 해롭지 않은 차이라 맞추지 않았다. 누름에 대해서는 세 화면이 같다 — 자리 기억을 끝내는 것은 **누름**이다(세 화면 모두): 누르지 않고 하는 일 — 휠로 확대·축소, 선택을 바꾸지 않는 키보드 조작(Tab으로 속성 칸에 가서 글자를 치는 것 포함. 보조 평면도의 노드를 키보드로 고르는 것만은 그 화면의 기억을 끝낸다, 7.4) — 뒤에는 같은 자리를 다시 누르면 넘어간다.
- 3D에서 다른 버튼이 이미 눌린 채로 누른 버튼은 누름(`pointerdown`)이 아니라 움직임으로 온다. 왼쪽 버튼을 누른 채 오른쪽 버튼을 더 눌러 둘러본 드문 경우는 자리 기억을 끝내는 누름으로 세지 못할 수 있다(v1.131.0에도 있는 두 버튼 누름의 성질이다, BackgroundMap3D.tsx:561. 이번에 고치지 않았다 — 필요하면 16.2의 대체안이 이 경우도 덮는다).
- **글자 칸에 커서를 둔 채 누른 스페이스는 화면 이동이 아니다**(5.3 — 스페이스는 그 칸의 글자다). 그대로 캔버스를 끌면 보통의 끌기다(방이 옮겨지거나 상자가 그려진다). 누르는 순간 포커스가 캔버스로 오므로, 그 끌기를 마친 뒤 스페이스를 여전히 누르고 있으면(자동 반복 누름이 캔버스에서 온다) 다음 누름부터는 화면 이동이다. v1.131.0에는 스페이스 화면 이동이 없었으므로 잃는 것은 없다.
- 스페이스를 누르고 있는 동안 포커스가 편집기 밖의 스크롤되는 요소에 있으면 그 요소는 지금처럼 스크롤된다(편집기는 자기 밖의 스페이스를 막지 않는다 — 5.3). 포커스가 아무 데도 없을 때(`body`)와 편집기 안의 빈 곳일 때만 막는다.
- 3D 모드에서는 여러 개 선택을 풀 수 없다(평면으로 가서 푼다). 3D에서는 묶음이 아무 일도 하지 않으므로 풀 까닭도 없다: 3D의 동작은 모두 3D의 하나에만 닿는다.
- 3D에서 따로 골라 둔 하나는, 되돌리기로 묶음이 하나 이하로 줄어 있는 동안에는 3D에 보이지 않는다(남은 그 선택이 3D의 하나다, 3.3). 다시 실행으로 묶음이 돌아오면 다시 3D의 하나가 된다.
- 넓이가 꼭 같은 두 공간이 겹치면 나중에 그린 것이 위다(지금과 같다).
- 공간의 테두리 선 바깥 반쪽(화면 1px 안쪽)을 누르면 그 공간은 잡히지만 넘기기 목록에는 그 공간 하나뿐이다.
- 묶음에서 붙은 가장자리가 잡고 끈 노드의 것이 아니면, 그 값은 상대와 부동소수 오차 범위(1e-9)에서 같다(① 설계 16절의 오른쪽·아래 가장자리와 같은 성질).
- 3D에서 더블클릭의 첫 클릭이 사라지는 창의 버튼 위였고 둘째 클릭이 캔버스였을 때, 포인터 아래의 연결된 공간이 열릴 수 있다. v1.131.0에도 있는 동작이며(3D의 더블클릭은 누름 기록을 쓰지 않는다) 이번에 고치지 않았다. 달라지는 것은 하나다: 그 전에 '선택' 도구로 마지막에 겨눈 공간(`aimed`)이 연결된 공간이고 아직 포인터 아래 있으면, 맨 위의 것 대신 그 공간이 열린다. `aimed`가 낡는 길은 이것 하나다 — 캔버스에 떨어진 첫 클릭은 어느 도구든 `aimed`를 새로 적거나 지우고(7.3), 끌기로 끝난 누름 뒤의 더블클릭은 지금처럼 `lastDragAt` 가드가 막는다(:579).
- 3D의 뷰포트는 연결된 도면이 실제로 있는지 모른다(`childMapId`가 있는지만 본다). 도면이 지워져 연결만 남은 공간을 빠르게 두 번 누르면 아무것도 열리지 않는다(편집기의 `openSpace`가 연다). 둘째 클릭이 넘기지 않는 것은 평면과 같다(공간의 더미는 연속 클릭에 넘어가지 않는다). 남는 차이는 하나다: 같은 자리를 눌러 **연결만 남은 바깥 공간**까지 넘겨 둔 뒤 그 자리를 빠르게 두 번 누르면, 평면은 `maps`를 보고 맨 위의 연결된 방으로 들어가지만 3D는 겨눈 바깥 공간을 "열 수 있는 것"으로 보아 아무것도 열지 않는다.
- 터치 입력은 대상이 아니다(한 손가락 끌기는 왼쪽 버튼과 같다: 편집 중에는 상자, 보기 모드에서는 화면 이동).
