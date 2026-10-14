# 배경 도면 — 숫자 끌어 바꾸기 · 옆 그림의 카메라 높이 · 도면 바로 삭제 — 설계 (2026-10-13)

> 요청(한솔, 2026-10-13, 여섯 가지 가운데 이 문서의 셋 — 말 그대로): "카메라 눌렀을 떄, 옆에서 본 방향 있잖아. 여기서 카메라의 높이를 카메라 아이콘을 끌어서 높이조절을 할 수 잇게." · "속성탭에 높이 등의 수치들을 텍스트 수정이나 슬라이드로도 수치 수정이 편리하게 가능하게끔 해줘." · "도면 삭제 시 하위 도면을 해제해야하는 거 없이 바로 삭제되게, 도면에 하위 도면이 있다면 그 하위도 같이 삭제할건지, 분리할건지 선택해서."
> 여섯 가지는 세 번에 나눠 낸다. **이 문서는 1차(v1.136.0)다**: (b) 속성의 숫자 칸을 끌어서도 바꾼다 · (a) '옆에서 본 방향' 그림에서 카메라 점을 끌어 높이를 바꾼다 · (e) '도면 삭제'가 연결을 먼저 풀지 않아도 되고, 하위 도면은 남길지 함께 지울지 고른다.
> 버전: v1.136.0 · **운영 DB·IPC·메인 프로세스·저장 모양 변경 없음**(화면 쪽 코드와 CSS뿐이다) · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: 브랜치 `claude/bg-map-scrub-height-delete`, HEAD `42584da6`(= main v1.135.1 `a1436e9f` + 배포 기록 문서 커밋 하나. `src`·`tests`는 `a1436e9f`와 같다). 아래 줄 번호는 이 커밋에서 직접 확인했다.
> 바탕: 분석 `r1-analysis.json`(항목 a·b·e와 종합). 지금 코드와 다시 맞췄고, 분석과 달라진 곳은 2.5에 모았다. v1.131.0~v1.135.1의 설계(`docs/superpowers/specs/2026-10-08-*` ~ `2026-10-12-*`)가 정한 동작 위에 쌓는다.

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다** — 한솔에게 알린 것(아래)을 그대로 만들고, 코드가 한 가지로 정해 주지 않는 곳은 이 설계의 답으로 정해 완료 보고에 적는다(10.2).

**한솔에게 알린 것(2026-10-13) — 제품 결정이다. 바꾸지 않는다.**

- 속성의 숫자 칸마다 ↔ 끌개가 생겨, 끌개나 칸 이름을 좌우로 끌면 값이 바뀌고 도면·3D가 바로 따라온다. 직접 적는 방법은 그대로다. 화각·각도처럼 범위가 정해진 값에는 미는 막대도 붙고, Shift를 누르면 큰 걸음이다. 한 번 끈 것은 되돌리기 한 번이고, 끄는 도중 Esc는 원래 값으로 돌린다. 칸에 마우스를 올리면 나오던 작은 위·아래 화살표는 없어진다(키보드 ↑↓는 그대로).
- 카메라의 '옆에서 본 방향' 그림에서 카메라 점을 위아래로 끌면 높이가 10씩 바뀐다(세밀한 값은 속성의 '카메라 높이' 칸에서). 위아래 각도(화살표)를 끄는 것은 이번에 넣지 않는다.
- '도면 삭제'는 연결을 먼저 풀지 않아도 바로 된다(위 도면에서 이 도면을 열던 연결은 알아서 풀린다). 하위 도면이 있으면 '하위 도면은 남기기 / 하위 도면도 함께 삭제'를 고르고, 기본은 남기기다. 남는 하위 도면은 한 단계 위로 올라간다(학교 > 본관 > 2층에서 본관을 지우면 학교 > 2층. 위 도면이 없으면 맨 위 도면이 된다) — 삭제 창에 미리 적혀 있다. 장소·배경 이미지·에피소드별 사용 기록은 지워지지 않는다. 여러 도면을 지우는 일은 한 번에 처리되지 않으므로, 중간에 끊기면 어디까지 됐는지 창에 그대로 알려 주고 다시 누르면 남은 것만 이어서 지운다.
- 서버·DB 변경은 없다. 배경 메뉴가 보이는 계정(지금은 배한솔 계정)에서만 달라진다.

용어: **끌개** = 숫자 칸 왼쪽 끝의 ↔(`.bmap-num-grip`). **막대** = 범위가 정해진 값의 칸 아래에 놓이는 선과 점(`.bmap-num-track`). **끌기** = 끌개·칸 이름·막대·옆 그림의 손잡이를 눌러 움직이는 한 번의 동작. **옆 그림** = 보조 평면도의 '옆에서 본 방향' 그림(`.bmap-plan-side`). **손잡이** = 옆 그림의 카메라 점을 끌 수 있을 때의 그 점. **문서의 제스처** = `mapDocument.ts`의 `gesture-begin` → `gesture-preview`… → `gesture-finish`/`gesture-cancel`. **시작 도면** = 제스처가 시작될 때의 초안 값(`gestureStartMap`). **초안**·**깨끗한 초안**·**다시 놓기**·**따라가기**·**편집 중**(`editing`)·`canEdit`은 v1.135.0 설계의 뜻 그대로다. **연결** = 공간의 `childMapId`(그 공간에서 여는 상세 도면). **하위 도면** = `parentId`가 이 도면인 도면(바로 아래 한 단계). **아래 도면** = 하위 도면과 그 아래 전부. **저장 단계** = 삭제에 앞서 한 번 나가는 `save-maps` 명령.

## 1. 목표와 범위

### 1.1 만드는 것

| # | 만드는 것 | 한 줄 |
|---|---|---|
| (b) | 속성의 숫자 칸 14개 | 적는 법은 그대로. 칸 이름과 ↔ 끌개를 좌우로 끌면 값이 바뀐다. 범위가 정해진 일곱 칸에는 막대가 붙는다. Shift는 큰 걸음, Esc는 취소, 끌기 한 번은 되돌리기 한 단계 |
| (a) | 옆 그림의 카메라 높이 | 편집 중이고 잠기지 않은 카메라의 점을 위아래로 끌면 높이가 10씩 바뀐다. 눈금은 끄는 동안 얼어 있다 |
| (e) | 도면 삭제 | 연결은 알아서 풀린다. 하위 도면이 있으면 남기기(기본)·함께 삭제를 고른다. 삭제 창은 연 그 도면만 다룬다(v1.135.0 설계 15.4의 문제를 함께 고친다) |

**알린 것이 한 가지로 정하지 않는 곳 — 묻지 않고 정한 것.** 다른 답이 오면 고칠 곳을 적어 둔다. 완료 보고에 적는다(10.2).

| # | 정하지 않은 곳 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| J1 | 끌 때의 빠르기 | 4px 움직인 뒤부터, 2px에 한 걸음(Shift는 6px에 큰 걸음 하나). 앱에서 눈으로 맞춘다 — 상수 한 곳(`MAP_NUMBER_SCRUB`) | 그 상수의 숫자만 |
| J2 | 큰 걸음의 크기 | 높이·위치·길이 10, 각도(방향·회전·위아래·기울기) 15°, 화각 10° | 표(`MAP_NUMBER_FIELDS`)의 `big` |
| J3 | 끈 값의 모양 | 늘 그 걸음의 배수(정수, Shift면 10·15의 배수). 소수가 있던 값(244.65)은 첫 걸음에 가는 쪽의 배수로 맞춰진다(오른쪽 245, 왼쪽 244). **제자리로 돌아오면 처음 값 그대로**이고 아무것도 바뀌지 않는다("제자리"는 끌기가 시작된 자리다 — 누른 곳에서 처음 움직인 쪽으로 4px 간 곳, 3.3의 `from`) | `stepNumber`의 한 줄 |
| J4 | 막대를 그냥 눌렀을 때 | 그 자리로 값이 옮겨지고(되돌리기 한 단계) 이어서 끌면 따라온다. 점을 누르면 끌기 전에는 변하지 않는다 | 누름으로는 옮기지 않으려면 막대의 `immediate`를 늘 거짓으로 |
| J5 | 숫자 칸의 휠 | **그대로 둔다.** 알린 것은 작은 화살표가 없어지는 것뿐이다. 화살표는 그리지만 않고 요소는 남긴다(`appearance:none`) — 포커스가 있는 칸 위의 휠과 ↑↓가 고치기 전과 같게 듣는다(E2에서 견준다) | 화살표가 그래도 보이면 `display:none`으로. 그때는 휠이 듣지 않게 될 수 있고, 그렇게 됐으면 보고에 적는다(10.1) |
| J6 | 옆 그림에서 한 번에 갈 수 있는 높이 | 끌기 시작 때의 눈금에서 위아래로 4분의 1씩 더(0~180 도면이면 −40~230). 놓으면 그림이 다시 맞춰지고, 다시 끌면 더 간다 | `PLAN_SIDE_DRAG.reach` |
| J7 | 아주 낮은 도면의 옆 그림 | 걸음은 알린 대로 어느 도면에서든 10이다. 방과 카메라가 모두 아주 낮은 도면(눈금 범위 20쯤 아래)에서는 갈 수 있는 자리가 서넛 아래로 줄고, 끄는 동안 점이 그림 밖에 그려질 수 있다 — 그런 도면의 높이는 알린 대로 '카메라 높이' 칸에서 맞춘다(10.3) | `PLAN_SIDE_DRAG.step` |
| J8 | 옆 그림의 Shift·키보드 | 없다. 손잡이는 마우스·펜 전용이다. 세밀한 값과 키보드는 '카메라 높이' 칸(↑↓ 1씩)이고, 칸을 고치면 점이 바로 따라온다(4.5) | — |
| J9 | 삭제 뒤의 화면 | 위 도면. 위 도면이 없으면 지금처럼 목록의 첫 도면(또는 빈 화면) | `runMapDelete`의 `setCurrentId` 한 줄 |
| J10 | 지우는 버튼의 글 | 하위 도면이 없으면 '도면 삭제', 남기기면 '이 도면 1개만 삭제', 함께 삭제면 '도면 N개 모두 삭제' | `mapDeleteText`의 `confirm` |
| J11 | 연결을 풀어야 하는 위 도면(그 도면의 공간이 지울 도면을 열 때)·위로 옮겨질 하위 도면에 저장 안 한 변경이 있을 때 | 그 변경도 저장 단계에서 함께 저장하고, 창이 그 도면의 이름을 미리 말한다('연결'·'설정'이 오늘 하는 것과 같다 — 5.5). 지울 도면을 여는 공간이 없는 위 도면은 쓰지 않으므로 저장하지도 이름을 말하지도 않는다(5.2) | 거절로 바꾸려면 `planMapDelete`의 `refusal` 한 줄 |
| J12 | 저장 단계가 도면 100개를 넘을 때 | 나누지 않고 누르기 전에 거절한다(문장으로). 한 도면 바로 아래에 98개가 넘거나, 연결을 가진 도면이 한 가지에 100개가 넘는 경우다 | 나눠 보내려면 `planMapDelete`가 `save`를 여러 개로 |
| J13 | 삭제가 도는 동안의 Esc·X·돌아가기 | 듣지 않는다. 끝나거나 멈춘 뒤에 듣는다 | — |
| J14 | ↔ 끌개의 자리 | 숫자 칸의 **왼쪽 끝**. 속성 칸은 화면 오른쪽 끝에 붙어 있어, 작은 화살표가 있던 오른쪽 끝에 두면 오른쪽 끝이 속성 칸의 끝에 닿는 일곱 칸(오른쪽 줄의 방향·기울기·입체 높이·좌우 기울기·세로 위치·세로 길이, 그리고 한 줄을 다 쓰는 회전)은 값을 올리는 쪽으로 끌 자리가 45px쯤(한 번에 +20쯤)뿐이다. 왼쪽 끝이면 어느 칸이든 115px 이상(+55 이상, Shift면 +180 이상)이다 | 3.5의 두 줄(끌개의 `left`, 상자의 `padding-left`) |
| J15 | 끌개를 끌지 않고 누르기만 했을 때 | 그 칸에 포커스가 간다(칸 이름을 누른 것과 같다). 끌개가 덮은 자리는 예전에 눌러서 커서를 넣던 자리다 | `slide`의 `tap` 한 줄 |
| J16 | 함께 저장해야 하는 변경(J11)이 저장할 수 없는 값일 때(오브젝트 이름을 비워 둔 초안) | 누르기 전에 거절하고 그 도면의 이름을 말한다. 그대로 보내면 저장소가 도면 이름 없는 문장으로 매번 거절한다(5.2) | `planMapDelete`의 `unsavable` |

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 오브젝트 목록의 눈(보이기·숨기기)과 속이 안 보이는 박스로 보기 · 그림을 끌어다 놓기·붙여 넣기 · 저장 안 한 편집을 이 PC에 보관하기 | 차례로 2차 배포 · 3차 배포 · 3차 다음(편집 상태와 저장 지키기 2차). 이 설계는 그것들을 막지 않는다(6.5) |
| 옆 그림에서 위아래 각도(화살표) 끌기, 그림을 위·옆 두 칸으로 키우기 | 한솔에게 알린 대로. 지금 크기에서는 손잡이 둘이 겹친다 |
| 높이·위치·길이의 막대 | 끝이 정해지지 않은 값이다. 범위를 지어내면 지하나 높은 카메라에서 막대가 끝에 붙는다. 카메라 높이는 옆 그림에서 끈다 |
| Alt로 세밀하게 끌기, 화면 끝을 넘어 끝없이 끌기(포인터 잠금), 칸에서 Shift+↑↓, 더블클릭으로 되돌리기 | 요청 밖. Alt는 평면 끌기의 창 메뉴 가드(앵커 17)를 다시 써야 한다 |
| 저장되는 것(도면 모양·명령 종류·버전 규칙), IPC, 메인 프로세스, 미리보기 저장소, 운영 DB | 필요 없다. 쓰는 키는 모두 지금 있는 키이고 명령은 `save-maps`와 도면 `delete` 둘뿐이다 |
| 여러 도면 삭제를 "전부 아니면 전무"로 | 서버 함수가 요청 하나에 명령 하나, 삭제 하나에 도면 하나다(2.4). 그렇게 하려면 서버 함수를 바꾸는 새 migration이 든다 |
| 배경 메뉴의 노출 범위 | `src/features/playground/featureFlag.ts`는 건드리지 않는다 |
| 편집기의 다른 네 창(확인·만들기·연결·설정)의 동작 | 삭제만 새 창으로 옮긴다. 넷은 `dialogOpen` 한 줄을 읽게 될 뿐이다(6.1) |

### 1.3 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | v1.131.0~v1.135.1이 낸 동작은 하나도 물러서지 않는다 | 그 동작의 순수 모듈(`mapDocument.ts`·`mapEditSession.ts`·`mapGeometry.ts`·`mapSpatial.ts`·`mapWorkflow.ts`·`domain.ts`)과 3D 파일은 건드리지 않는다(6.4). 편집기에서 고치는 곳은 6.3의 표가 전부다 |
| R2 | **숫자 칸에 적는 법은 지금과 똑같다** | 적는 코드(글자 상태·파싱·`onChange`·Enter·`onBlur`)를 새 부품으로 글자 그대로 옮긴다(3.4, 앵커 63). 편집기의 `patchNode`·`moveSelected`와 14곳의 `onChange`·`onDone`은 한 글자도 고치지 않는다 |
| R3 | 한 번의 끌기 = 되돌리기 한 단계, 저장은 사용자가 누를 때 | 끌기는 문서의 제스처로 돈다. 합치는 편집(`coalesceKey`)으로 돌리지 않는다 — 제스처가 미리보는 동안의 `update`는 버려지고(mapDocument.ts:150-151) 합치기는 여러 끌기를 한 단계로 묶는다 |
| R4 | 사용자가 바꾼 값만 저장한다(AGENTS.md '배경 라이브러리 데이터 경계') | 쓰는 함수 `setMapNodeNumber`는 값이 지금 값과 같으면 **같은 도면 객체**를 돌려준다. 제자리로 돌아온 끌기는 키를 만들지 않는다 |
| R5 | 읽기 전용 계정·보기 모드에는 칸도 손잡이도 없다. 보기 모드의 옆 그림은 v1.135.1과 픽셀 단위로 같다 | 칸은 지금처럼 `editing` 안에만 있다. 옆 그림의 더한 요소는 모두 `draggable &&` 안에 있다(4.3) |
| R6 | 업데이트 안내가 뜨면 탭과 본문이 통째로 빠진다(앵커 46) | `BackgroundLibraryView.tsx`·`useBackgroundStore.ts`는 건드리지 않는다. 훅은 내려갈 때 리스너를 떼고 돌던 끌기를 취소한다 |
| R7 | 띠의 높이는 창 폭으로만 정해진다. 끌기 도중 도면 위에 놓인 것이 생기거나 사라지지 않는다 | 띠·머리줄·오류 띠는 건드리지 않는다. 끌기 도중 바뀌는 것은 속성 칸 안과 보조 평면도 안의 글자·색뿐이고, 옆 그림의 줄 수와 크기는 그대로다 |
| R8 | **`BackgroundMapEditor.tsx`의 함수 순서** — 소스 앵커가 함수 표지에서 다음 표지까지를 잘라 읽는다(`tests/backgroundMapEditorWiring.test.ts:68-96`) | 새 함수의 자리를 정해 둔다(6.3). 어느 조각 안에도 함수를 끼우지 않는다 |
| R9 | 테스트는 Node type-stripping으로 돈다 | 새 순수 모듈은 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만, `@/` 별칭 없음, DOM·three.js 없음 |
| R10 | 기다림(`await`) 뒤의 핸들러는 그 렌더의 상태를 쥐고 있다(tasks/lessons.md 2026-10-11) | 삭제의 계획·버전·돌아갈 자리를 첫 `await` **앞에서** 모두 정한다. 그 뒤에는 `snapshot`·`current`·`draft`·`maps`를 읽지 않는다(5.6, 앵커 66). 겹쳐 도는지는 ref로 본다 |
| R11 | 네이티브 모달 창(같은 항목): 포커스가 `body`에 놓인 순간의 키, 스스로 뜨는 창의 유예, Esc 두 번 | 삭제 창은 뜬 뒤와 실행이 멈춘 뒤 0.5초 동안 누름을 받지 않고, 떠 있는 동안 누른 키를 뒤 화면에 보내지 않고, 엔진이 닫아 버리면 다시 연다(5.4) |
| R12 | 움직임 규칙(CLAUDE.md) | **이 설계는 전환·애니메이션을 하나도 더하지 않는다.** 끌기는 손이 직접 움직이는 것이다. 그래서 동작 줄이기 짝도 없다. `backdrop-filter` 없음 |
| R13 | 화면 글자는 비개발자의 말(해요체), 기울임 없음 | 3.4·4.3·5.3과 8절의 문구 |

## 2. 현재 동작 (v1.135.1)

파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다. 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

### 2.1 숫자 칸 14개 — 적으면 어떻게 저장 전 편집이 되는가

- 숫자 칸은 편집기 안의 부품 하나다: `NumberField`(:136-156). `<Field>`(`<label class="bg-field"><span>이름</span>…</label>`, BackgroundUI.tsx:64-77) 안의 `<input type="number" step="any">`이고, 치는 글자를 자기 상태(`text`)에 둔다. 보이는 값은 `text ?? round(value)`(소수 둘째 자리, :82).
- **값이 들어가는 때**: 친 글자가 숫자이고 `min..max` 안이며 지금 값과 다르면 **글자마다 곧바로** `onChange`(:144-148). Enter는 blur다(:149). blur는 범위 밖의 값을 가까운 한계로 맞추고(그 한계가 지금 값과 다를 때만 `onChange`), 글자 상태를 비우고 `onDone`을 부른다(:150-155). Esc는 칸이 다루지 않는다 — 편집기의 `keyboard()`로 올라가 도구와 찍던 점을 비운다(:969-977). 친 값은 되돌아가지 않는다.
- **한 칸에 머문 동안 = 되돌리기 한 단계**: `patchNode(changes, field)`(:545-552)가 열쇠 `노드id:칸`을 만들고, 그 칸의 편집이 시작될 때의 도면(`fieldEditStartMap`, mapDocument.ts:259-262)에 값을 얹어 `updateMap(…, { coalesceKey })`로 보낸다. 리듀서는 같은 열쇠의 연이은 `update`를 한 단계로 합친다(mapDocument.ts:153-156). 공간은 `transformMapSpace`(mapGeometry.ts:54-77)를 지나 소속 카메라·기호가 함께 간다(잠긴 것은 남는다). 위치 둘은 `moveSelected`(:553-556) — `moveMapNode(current, id, 차이)`를 같은 식의 열쇠로. 합치기는 blur(`onDone={doc.endCoalescing}`), 선택 바뀜, 되돌리기, 제스처 시작에서 끝난다(mapDocument.ts:119, :165-166, :172).
- **14곳, 저장되는 숫자는 11가지**(`<NumberField label="…"`이 14번, 이름이 모두 다르다):

| 칸(이름) | 줄 | 노드 | 저장 키 | 오늘의 `min`·`max` | `onChange` |
|---|---|---|---|---|---|
| 카메라 높이 | :1224 | 카메라 | `elevation`(없으면 120으로 읽는다) | −100000~100000 | `patchNode({ elevation }, 'elevation')` |
| 방향 (°) | :1224 | 카메라 | `angle` | 없음 | `patchNode({ angle: normalizeAngle(angleValue) }, 'angle')` |
| 위아래 각도 (°) | :1225 | 카메라 | `pitch`(없으면 0) | −90~90 | `patchNode({ pitch }, 'pitch')` |
| 기울기 (°) | :1225 | 카메라 | `roll`(없으면 0) | −180~180 | `patchNode({ roll }, 'roll')` |
| 화각 (°) | :1228 | 카메라 | `fov` | 10~170 | `patchNode({ fov }, 'fov')` |
| 바닥 높이 | :1248 | 공간·기호 | `elevation`(없으면 0) | −100000~100000 | `patchNode({ elevation }, 'elevation')` |
| 입체 높이 | :1248 | 공간(도로 제외)·기호 | `volumeHeight`(없으면 방 180, 기호는 종류별) | 1~100000 | `patchNode({ volumeHeight }, 'volumeHeight')` |
| 앞뒤 기울기 (°) | :1249 | 기호 | `pitch` | −90~90 | `patchNode({ pitch }, 'pitch')` |
| 좌우 기울기 (°) | :1249 | 기호 | `roll` | −180~180 | `patchNode({ roll }, 'roll')` |
| 가로 위치 · 세로 위치 | :1254 | 모두 | `x` · `y` | −100000~100000 | `moveSelected({ x: x - selected.x, y: 0 }, 'x')` · `moveSelected({ x: 0, y: y - selected.y }, 'y')` |
| 가로 길이 · 세로 길이 | :1255 | 공간·기호 | `width` · `height` | 10~100000 | `patchNode({ width }, 'width')` · `patchNode({ height }, 'height')` |
| 회전 (°) | :1255 | 공간·기호 | `rotation` | 없음 | `patchNode({ rotation: normalizeAngle(rotation) }, 'rotation')` |

- 한계의 출처: 세로 값 넷은 `MAP_SPATIAL_LIMITS`(= `BACKGROUND_SPATIAL_LIMITS`, domain.ts:5), 위치·길이는 편집기의 `PLAN_LIMIT`·`MIN_PLAN_SIZE`(:107). 저장 검사(domain.ts:59, :63, :70-71, :76, :78)는 화각을 1~179, 방향·회전을 −360~360까지 받지만 칸은 그보다 좁게 쓴다(화각 10~170, 방향·회전은 늘 0 이상 360 미만으로 고쳐 넣는다).
- 칸은 **편집 중에만** 있다: 카메라 칸은 `{editing ? <section …> : <p>요약</p>}`(:1223-1231), 나머지는 `{editing && <>`(:1245) 안이다. 꺼지는 조건은 `fieldLocked = !canEdit || !!selected?.locked`(:1043) — 저장이 도는 동안과 잠긴 노드. 평면에서 여러 개를 고르면 폼이 없고 요약이 나온다(:272, :1259). 3D에서는 고른 하나의 폼이 남는다(:1192).
- 포커스가 칸·버튼에 있으면 편집기의 Ctrl+Z·Delete는 듣지 못한다(`interactive` 가드, :987). 캔버스로 포커스를 보내는 함수는 `focusCanvas()`(:484)이고, **칸에서 포커스가 떠나는 것이 덜 친 값을 확정한다** — 평면의 누름(:796-802)과 `requestSave`(:641-645)가 이미 그 순서에 기댄다.
- 미는 막대나 끌어 바꾸는 방법은 배경 기능 어디에도 없다. 작은 위·아래 화살표는 엔진의 기본 모양이다. 앱에는 `input[type="range"]`의 전역 모양이 있다(`src/index.css:850-865`).
- 속성 칸의 폭: 260px·안쪽 여백 18px(backgrounds-map.css:212 — :166의 248px과 :200의 220px을 뒤에서 덮는다), 창 폭 1100px 이하에서 230px·14px(:273), 900px 이하에서는 도면 아래에 창 폭 그대로·높이 190px까지(:333). 숫자 칸은 두 칸 줄(`.bmap-field-pair`, 간격 10px, :171)이라 한 칸이 약 107px·96px이고, 속성 칸에 세로 스크롤 막대(5px, `src/index.css:641-644`)가 생기면 104px·93px이다(편집 중에는 내용이 길어 늘 생긴다고 봐야 한다). '회전 (°)'만 두 칸 줄 밖이라 폭이 그 두 배다(:1255). **입력 상자의 모양은 라이브러리의 공용 규칙이 정한다**(`.bg-library input:not(…)…`, backgrounds.css:74-90 — 여백 8px 10px, 높이 36px 이상. 속성 칸의 규칙 backgrounds-map.css:168보다 특이도가 높다).

### 2.2 문서의 제스처와 편집기의 네 콜백

- 끌기 한 번은 문서의 제스처다(useBackgroundMapDocument.ts:52-59, mapDocument.ts:168-192): `beginGesture(mapId)`는 초안이 없거나 다른 제스처가 돌면 `false`를 돌려주고, 시작하면 그때의 초안 값을 `initial`로 잡는다. `previewGesture(map)`는 기록 없이 초안 값만 바꾼다. `finishGesture()`는 값이 `initial`과 **깊이 비교로 같으면 단계를 만들지 않고**(mapEditSession.ts:28-31) 다르면 단계 하나다. `cancelGesture()`는 `initial`로 돌린다. 띠의 수는 끝난 단계의 수라서(`mapDraftSteps`, mapDocument.ts:264-266) 놓을 때만 는다.
- 편집기는 그 넷을 감싼 안정된 콜백 넷을 3D 화면에 준다(:1016-1019, :1172-1173): `beginCanvasGesture`(평면의 포인터 세션이 없을 때만 시작, 결과는 버린다) · `previewCanvasGesture` · `finishCanvasGesture`(`canEdit`이 아니면 취소) · `cancelCanvasGesture`. 이 안정 콜백들이 놓인 :1013-1028은 앵커가 자르는 어느 함수 조각에도 들지 않는다(`keyboard` 조각이 `const selectNode = useEvent(`에서 끝난다).
- **어떤 제스처든 편집기가 취소하는 길**: 제스처가 도는 동안의 창 단위 Esc(:376-382 — `handledEscape`에 적어 `keyboard()`가 도구를 비우지 않게 한다), 포커스가 편집기 안에 있을 때의 `keyboard()`의 Esc(:975), 도면·모드·`canEdit`의 변화(:374), 편집기가 내려갈 때(:375). 제스처가 도는 동안 되돌리기(:620)·Delete(:1006)·휠 확대(:325)·`requestSave`(:642)는 아무 일도 하지 않고, 평면의 누름도 받지 않는다(:791). 이미지 목록과 오브젝트 목록은 제스처 시작 때의 도면을 읽는다(:295-300).
- 평면 끌기의 Alt 가드는 평면의 포인터 세션이 있을 때만 켜진다(:383-398, 앵커 17). 캔버스 밖에서 시작한 끌기는 켜지 않는다.
- HTML 요소의 끌기 선례는 도면 높이 조절선이다(BackgroundMapPanels.tsx:75-98): `pointerdown`에서 `preventDefault` + `setPointerCapture`, `pointercancel`·`lostpointercapture`는 취소, 키보드의 Shift는 더 큰 걸음. **검사 창의 가짜 입력에는 포인터 캡처가 걸리지 않는다**(검증 기록 :280, :322) — 캡처에만 기대는 끌기는 거기서 확인할 수 없다.

### 2.3 보조 평면도와 옆 그림

- 보조 평면도는 3D 모드에만 있고(`.bmap-3d-split`의 둘째 자식, :1164-1180) 보기 모드에서도 그려진다. 받는 것은 셋뿐이다: `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} />`(:1179, `MapPlanPreviewProps`, mapCanvas.ts:54. 앵커 23은 그 태그의 앞부분을 글자로 본다). 그 `selectedId`(`singleId`, :270)의 노드가 속성 칸의 `selected`(:272)와 같은 노드다.
- 카메라를 고르면 `CameraReadout`(BackgroundMapPlanPreview.tsx:114-133)이 글자 요약(방향 · 위아래 · 높이 · 화각 — `planCameraReadout`, mapPlanPreview.ts:196-204)과 옆 그림을 그린다: `<figure class="bmap-plan-side">` 안의 SVG 하나(`viewBox="0 0 132 84"`, `role="img"`)와 캡션 '옆에서 본 방향'. SVG에는 누름·키 핸들러가 하나도 없다. 보조 평면도의 노드는 고르기만 되고 끌 수 없다.
- **눈금**(`planSideView`, mapPlanPreview.ts:238-262; 상자는 `PLAN_SIDE_VIEW`, :225): 범위는 [0·카메라 높이·모든 공간의 바닥과 꼭대기 가운데 가장 낮은 것 … 가장 높은 것]이고(:241-251. 도로는 바닥만 든다), 방이 하나도 없으면 방의 기본 높이 180이 꼭대기다(:253). 그 범위를 y 62(아래)~22(위)의 **40단위**에 편다(:254 — 범위는 1 이상). 카메라는 x 44에 고정이다. 카메라가 속한 방(도로 아님)만 점선 상자로 그린다. 높이는 방 안에서의 높이가 아니라 도면의 절대 높이다(mapSpatial.ts:58-60, :112-117).
- **크기**(backgrounds-map-plan.css): SVG는 폭 100% × 높이 `clamp(54px,21cqh,96px)`(:68) — 그림 1단위가 화면 0.64~1.14px이라 40단위가 26~46px이다. 보조 평면도가 250px보다 낮으면 그림을 감추고(:78-82), 가로로 긴 칸(3:2 이상, 폭 300px 이상)에서는 글자 옆에 작게 다시 보인다(:88-103 — 그때 그림은 높이 38px쯤까지 줄어 1단위가 0.45px이다. 4.4의 계산).
- 높이를 바꾸는 길은 오늘 둘이고 둘 다 편집 중에만 된다: '카메라 높이' 칸, 3D 이동 손잡이의 위쪽 화살표(mapGeometry.ts:322-333). '이 카메라 시점으로 보기'(:285, :1232) 중에는 3D 화면이 매 프레임 초안에서 그 카메라의 자세를 읽으므로(BackgroundMap3D.tsx:365-379) 다른 곳에서 한 미리보기도 구도를 움직인다. 그동안 3D의 손잡이는 숨는다(BackgroundMap3D.tsx:430-431).
- 이 파일들을 읽는 앵커: 23(위의 태그, 그리고 `mapCanvas.ts`·`BackgroundMapPlanPreview.tsx`에 `selectedIds`가 없다), 34·39(`BackgroundMapPlanPreview.tsx`에서 `const forget = (event: PointerEvent) => {` · `const release = (event: PointerEvent) => {` · `const activate = useCallback<Activate>(`의 **첫** 자리와 그 뒤의 첫 `}, []);`), 45(요약 줄의 글자, 그 파일의 `data-camera-color=`가 정확히 다섯). `tests/backgroundMapPlanPreview.test.ts:237-336`이 `planSideView`의 값을 고정하고, `tests/backgroundMapElements.test.ts:327-336`이 `backgrounds-map-plan.css`에서 `.bmap-plan-preview [data-camera-color] {`로 시작하는 줄이 하나임을 본다.

### 2.4 도면 삭제 — 오늘 막히는 곳

- **들어가는 길**: 도면 설정 창의 '도면 삭제'(:1302) — `setSettingsForm(null); setError(''); setConfirmation('delete-map')`. 확인 창은 공용 창이다(`{confirmation && current && <BackgroundModal …`, :1304): 제목 '도면을 삭제할까요?', 글 '도면 배치만 삭제합니다. 장소와 배경 원본은 유지됩니다. 하위 도면이나 연결이 남아 있으면 먼저 해제해 주세요.', 버튼 '돌아가기' / '삭제'. 도면의 이름도 id도 쥐지 않는다.
- **답하는 길**: `confirmAction`의 삭제 가지(:666-677)가 명령 **하나**를 보낸다 — `{ type: 'delete', kind: 'map', id: current.id, expectedRevision: draft?.baseRevision ?? current.revision }`(:673). 되면 `doc.discard(current.id)`(:674), `setCurrentId(current.parentId)`(:675 — 위 도면으로. `null`이면 `maps.find(…) ?? maps[0]`(:263)이 목록의 첫 도면을 보인다). 실패하면 창이 오류와 함께 열린 채 남는다(:676).
- **왜 막히는가**: 저장소는 보내기 전에 명령을 지금 스냅샷에 적용해 본다(useBackgroundStore.ts:48). `applyBackgroundCommand`(domain.ts:138-158)는 그 줄을 지우고(:155) 전체를 검사한다(:157 → `validateBackgroundSnapshot`). 두 규칙에 걸린다:
  - domain.ts:127 — 도면마다 `parentId`를 따라 올라가며 `requireValue(parents.has(cursor),'참조한 상위 항목이 없습니다. 하위 항목의 연결을 먼저 해제해 주세요.')`. **하위 도면이 있는 도면은 지울 수 없다.**
  - domain.ts:131 — 공간마다 `requireValue(!n.childMapId||maps.get(n.childMapId)?.parentId===map.id,'상세 도면은 현재 도면의 하위 도면이어야 합니다. 사용 중인 연결을 먼저 해제해 주세요.')`. **위 도면의 공간이 여는 도면은, 하위 도면이 없어도 지울 수 없다.**
- **서버도 같다**(`DEVLOG/migrations/2026-09-21-background-library.sql`): `background_library_execute`는 요청 하나에 명령 하나를 받고(:229. 여러 엔티티를 담는 명령은 `save-maps`뿐이며 저장만 한다 — 1~100개, :222), 삭제는 줄 하나를 지움 표시한다(`deleted_at=now(), revision=e.revision+1`, :274). 그 뒤 `background_library_validate()`가 살아 있는 줄 전체를 본다(:277): `'상위 항목이 삭제되었거나 존재하지 않습니다.'`(:155), `'상세 도면은 현재 도면의 직계 하위 도면이어야 합니다.'`(:166). 딸린 줄을 함께 지우는 규칙은 없다. 뒤의 두 migration은 엔티티 검증 함수만 바꾸고 이 두 규칙은 건드리지 않는다. 메인 프로세스는 IPC 한 번에 요청 하나를 그대로 넘긴다(`electron/backgroundIpc.ts:29-37`).
- 도면을 가리키는 것은 **다른 도면뿐**이다: 하위 도면의 `parentId`, 그리고 **바로 위 도면**의 공간의 `childMapId`(domain.ts:131이 그 밖의 도면이 쥐는 것을 막는다). 장소·배경·묶음·사용 기록은 도면 id를 갖지 않는다(types.ts:57-83). 카메라가 배경을 가리키므로(viewIds), 도면을 지우면 그 카메라는 함께 없어지고 배경은 남는다.
- **저장소의 실패 복구**(useBackgroundStore.ts:54-71): 응답을 잃으면 한 번 다시 읽는다. "들어갔는지" 확인해 성공으로 치는 길은 `save-maps`에만 있다(`mapSaveWasApplied`, :62-64). 삭제는 다시 읽은 스냅샷(그 도면이 없다)을 놓고 던진다.
- **문서로 남겨 둔 위험**(v1.135.0 설계 4.4의 :561-563, 15.3의 :1795, 15.4의 :1804, 16절의 :1859; 검증 기록 :431): 확인 창과 `confirmAction`은 그 렌더의 `current`를 읽는다. **보기 모드에서** 삭제는 됐는데 답을 잃으면, 도면이 없어져 `current`가 말없이 목록의 첫 도면이 되고, 열린 채인 창에서 '삭제'를 다시 누르면 **그 첫 도면에 삭제가 나간다**(하위 도면과 연결이 없으면 통과한다). 편집 중에는 남은 초안의 버전 때문에 거절된다.
- 연결을 풀고 부모를 바꾸는 `save-maps`의 선례: `moveMapChanges`(mapWorkflow.ts:65-74 — 옮길 때 이전 부모의 연결을 같은 명령에서 푼다), `saveMapChanges`(:28-49 — 초안이 있는 도면은 초안 값을 초안의 `baseRevision`으로 보낸다). 창은 이미 "현재 공간의 편집 내용도 함께 저장됩니다."라고 말한다(:1282, :1291, :1300). 도면의 저장은 모두 `persistMaps`(:525-532)를 지나고 그 뒤 저장한 도면의 초안이 다시 놓인다(앵커 50). 삭제만 그 길 밖에 있다.
- 미리보기 저장소(previewGateway.ts:48-61)에는 삭제의 규칙이 따로 없다: 같은 `applyBackgroundCommand`를 돌리고(:56), 삭제한 id를 은퇴 목록에 적고(:57), 은퇴한 id로 새로 만드는 것만 막는다(:53-55). 미리보기의 기본 자료는 **학교 > 본관 > 2층 > 2-1 교실**이고 단계마다 공간이 아래 도면을 연다(:26-28).
- 창의 틀: `BackgroundModal`(BackgroundUI.tsx:15-62)은 네이티브 `<dialog>`를 `showModal()`로 띄우고(:30) `[data-autofocus]`에 포커스를 주며(:31) 닫힐 때 열기 전의 요소로 포커스를 돌린다(:33). Esc는 `onCancel`에서 막고 `onClose`를 부른다(:41-44). 폭은 `min(580px, 100vw - 32px)`(backgrounds.css:440-449), 버튼 줄은 줄바꿈하지 않는 flex다(backgrounds-map.css:198). `swallowSecondClick()`(:486-490)은 0.5초 동안 창 단위에서 누름을 멈추고(`click` 사건도 멈춘다 — 키보드의 Enter·Space로 누른 버튼도 그동안 듣지 않는다), 오늘 한 곳('편집 끝내기')에서만 부른다. 앱 창은 800px보다 좁아지지 않는다(`electron/main.ts:839`).

### 2.5 분석(`r1-analysis.json`)에서 바로잡은 것

| 분석의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| (a) `beginCanvasGesture`를 불리언을 돌려주게 바꾸고 `onNudge`·`onNudgeEnd`를 더한다 | 종합이 뒤집었다 | :1016은 그대로. 칸과 손잡이가 끌기 객체 하나(`fieldScrub`)를 쓴다 |
| (a) `planSideView`의 결과에 `ceilingY`를 더하고, 방 없는 카메라에는 천장 점선을 그린다 | 그 결과를 통째로 견주는 기존 테스트가 있다(`tests/backgroundMapPlanPreview.test.ts`) · 천장 줄은 요청에도 알린 것에도 없는 새 그림이다 | 결과 모양은 그대로 둔다. **천장 줄은 그리지 않는다** — 높이는 '높이 N' 글자와 얼어 있는 눈금이 알려 준다. 두 인자 호출은 오늘과 비트 단위로 같다(11절: 3,456가지를 견줬다) |
| (a) 옆 그림의 걸음은 눈금 범위에 따라 10 · 5 · 1 | 한솔에게는 "10씩"이라고 알렸고, 낮은 도면에서 10이 안 되는 까닭이 코드에 없다 | 어느 도면에서든 10(J7) |
| (a) 누름 영역은 22px 선 · 끌기의 문턱은 `PLAN_SIDE_DRAG.slop` | 그림이 가장 작을 때(1단위 0.45px) 22px 선은 26.1px이다 · 칸과 문턱이 둘이 된다 | 24px 선으로 둔다 — 그림 크기와 무관하게 선만으로 24px이다(4.4) · 문턱은 `MAP_NUMBER_SCRUB.slopPx` 하나 |
| (a)(b) 끌기의 기준은 문턱을 넘긴 첫 이동의 자리(칸), 누른 자리(옆 그림) | 첫 이동의 자리로 잡으면 값이 이동이 몇 번에 나뉘어 오는지에 달리고(검사 창은 한두 번에 보낸다), 누른 자리로 잡으면 옆 그림의 첫 값이 문턱 4px만큼(높이 16~40) 튄다 | 기준은 하나다: **누른 자리에서 문턱만큼 간 곳**(3.3의 `from`). 첫 값은 처음 값이고, 값은 포인터의 자리로만 정해진다 |
| (b) 끌개는 작은 화살표가 있던 오른쪽 끝에, 그림은 `ChevronsLeftRight` | 속성 칸이 화면 오른쪽 끝에 붙어 있다(MainLayout의 여백 16px + 속성 칸의 여백 18px) · 그 아이콘은 화살대 없는 꺾쇠 둘(‹ ›)이다 | 왼쪽 끝에 둔다(J14) · `MoveHorizontal`(↔) |
| (b) 끈 값의 올림은 칸의 ↑↓와 같다 | 칸은 `step="any"`다 — 엔진의 규칙으로는 ↑↓가 소수를 정수로 맞추지 않는다(읽은 것. 돌려 보지 않았다) | 끌기의 올림은 그 자체의 규칙이다(J3). ↑↓는 고치기 전과 뒤가 같은지만 본다(E2) |
| (b) 입력 상자는 속성 칸의 규칙(backgrounds-map.css:168)이 그린다 | 라이브러리의 공용 규칙이 이긴다(2.1) | 상자의 왼쪽 여백은 이름 칸의 선례(backgrounds-map.css:163)처럼 긴 선택자로 덮는다(3.5) |
| (b) 막대의 값은 늘 걸음의 배수 | 점을 눌렀다 제자리에 놓으면 소수가 있던 값이 정수로 바뀐다 | 막대와 옆 그림 모두 "걸음의 배수, 또는 그보다 가까우면 처음 값"(3.1, 4.2) |
| (e) 저장 단계가 100개를 넘으면 나눠 보낸다 | 가능하지만 단계가 하나 더 는다 | 거절한다(J12) |
| (e) 위 도면이 없을 때 남기기로 지우면 첫 하위 도면으로 간다 | — | 지금처럼 목록의 첫 도면(J9) |
| (e) 낡은 초안의 거절은 남는 도면에만 | 지울 도면도 저장 단계에 들면 다시 놓기가 그 초안을 덮는다 | 저장 단계에 드는 **모든** 도면의 저장 안 한 변경이 낡았으면 거절한다(5.2) |
| (e) 창은 `current.id`를 쥔다 | 보기 모드에서는 설정 창이 열린 동안에도 `current`가 바뀔 수 있다(다른 곳에서 지움) | 설정 창이 쥔 도면 id(`settingsForm.id`)를 넘겨받는다(5.6) |
| (e) 멈춘 문장은 센 횟수로 만든다 | 답을 잃은 삭제는 세어지지 않는다 | 누른 계획과 **지금의 라이브러리**를 견줘 만든다(`mapDeleteStopText`). 풀린 연결은 **지울 도면을 여는** 공간만 센다 — 남기기에서 지울 도면이 하위 도면을 열던 연결까지 세면, 아무것도 하기 전에 "풀었어요"가 나온다(5.1의 `links`) |
| (e) 좁은 창(520px)에서 버튼 줄이 줄바꿈된다 | 앱 창은 800px보다 좁아지지 않고, 그 폭에서 창은 580px이라 두 버튼이 한 줄에 선다 | 줄바꿈 규칙을 두지 않는다 |
| (e) 삭제가 도는 동안 Esc·X를 무시한다 | 엔진은 `cancel`을 한 번 막으면 다음 Esc에 창을 스스로 닫는다(lessons 2026-10-11). 그러면 멈춘 문장을 볼 창이 없다 | 창이 닫히면 다시 연다(5.4). 창이 떠 있는 동안의 키도 뒤 화면에 보내지 않는다 — Ctrl+숫자 같은 앱 단축키가 화면을 바꾸면 남은 삭제가 말없이 끊긴다 |
| 앵커: 새로 고치는 것은 50·52·53·56 | 새 테스트 파일의 이름은 앵커 59의 목록에 든다 | 59도 고친다(6.2) |
| "이 작업 폴더에서 v1.135.1 빌드가 돌고 있다" | 끝났다. ROADMAP의 v1.135.1 '배포' 줄도 `42584da6`에서 이미 체크됐다 | 8절은 그 줄을 다시 고치지 않는다 |

## 3. (b) 숫자 칸 — 끌어서도 바꾼다

### 3.1 순수 모듈 — `mapNumberField.ts` (새 파일)

숫자 칸의 규칙은 이 파일 하나에 있다: 한계·걸음의 표, 노드의 숫자를 읽고 쓰는 함수, 끌기와 막대의 셈 — **포인터의 자리를 값으로 바꾸는 셈도 모두 여기다**(`slideNumber`·`pressNumberTrack`. 부품에 두면 Node 테스트가 닿지 않는다). DOM도 React도 three.js도 없다.

```ts
import type { BackgroundMap, BackgroundNode } from './types.ts';
import { MAP_SPATIAL_LIMITS, cameraAngles, isRoadSpace, nodeAngles, nodeElevation, nodeVolumeHeight, normalizeDegrees } from './mapSpatial.ts';
import { placeMapNode, replaceMapNode, transformMapSpace } from './mapGeometry.ts';
/** A number of a map node that the inspector shows as a field. */
export type MapNumberKey = 'elevation' | 'volumeHeight' | 'angle' | 'pitch' | 'roll' | 'fov' | 'x' | 'y' | 'width' | 'height' | 'rotation';
/**
 * `min`/`max`: what typing accepts and a slide stops at (infinite for a direction). `step`/`big`: one step of a slide, and one with
 * Shift held. `wrap`: a direction, kept at 0 or more and under 360. `track`: the two ends of the bar, or null for no bar.
 */
export type MapNumberRule = { min: number; max: number; step: number; big: number; wrap: boolean; track: { min: number; max: number } | null };
export const MAP_NUMBER_FIELDS: Readonly<Record<MapNumberKey, MapNumberRule>>;        // the table below
/** Screen pixels of a slide. Tuned by eye in the app: tests read these names, never the numbers. `thumbPx` is the width of the dot in the stylesheet too: the two change together. */
export const MAP_NUMBER_SCRUB = { slopPx: 4, stepPx: 2, bigStepPx: 6, grabPx: 7, thumbPx: 10 } as const;
/** The number as the inspector shows it (a missing optional key reads as its default). Null: this kind of node has no such number. */
export function mapNodeNumber(node: BackgroundNode, key: MapNumberKey): number | null;
/** A value as it may be stored: a direction wrapped, anything else held inside its limits. NaN for a value that is no number. */
export function settleNumber(value: number, key: MapNumberKey): number;
/** The map with that number set, or the SAME map object when nothing is to be written: no optional key is invented. */
export function setMapNodeNumber(map: BackgroundMap, id: string, key: MapNumberKey, value: number): BackgroundMap;
/** Whole steps of a sideways drag of `dx` pixels: towards zero, so the first step takes a full step of travel. */
export function scrubSteps(dx: number, big: boolean): number;
/** `start` moved by whole steps. Zero steps: `start` itself, decimals and all. */
export function stepNumber(start: number, steps: number, key: MapNumberKey, big: boolean): number;
/** Where the dot of the bar stands, 0 to 1. 0 for a field without a bar. */
export function trackFraction(value: number, key: MapNumberKey): number;
/** The value at `fraction` of the bar: a whole step, or `start` itself where that is as near or nearer. `start` for a field without a bar. */
export function trackNumber(fraction: number, key: MapNumberKey, big: boolean, start: number): number;
/** A slide of a field in progress: the pointer x its steps are counted from and the value there, the grid it is on, and the value on show. */
export type MapNumberSlide = { anchorX: number; anchorValue: number; big: boolean; value: number };
/**
 * The value of a slide with the pointer at `x`: a matter of where the pointer is, never of how its moves arrive. `slide` is
 * brought up to date in place. Shift pressed or released on the way: it goes on from the value on show, on the other grid.
 */
export function slideNumber(slide: MapNumberSlide, x: number, big: boolean, key: MapNumberKey): number;
/**
 * A press on the bar at `x`, the bar standing at `left` and `width` wide on screen. On the dot (within `grabPx` of its centre)
 * the press keeps the offset it was grabbed with, and nothing changes until it is dragged. Anywhere else the value goes to the
 * press at once (`immediate`). `fraction` is where a pointer then stands on the bar, for trackNumber. Null: too narrow for its dot.
 */
export function pressNumberTrack(value: number, key: MapNumberKey, x: number, left: number, width: number): { immediate: boolean; fraction(x: number): number } | null;
```

**표 — 14칸이 읽는 하나뿐인 표.** 적을 때의 `min`·`max`도 여기서 온다(오늘의 값 그대로다, 2.1).

| 키 | 칸 | `min` | `max` | `step` | `big` | `wrap` | 막대(`track`) |
|---|---|---|---|---|---|---|---|
| `elevation` | 카메라 높이 · 바닥 높이 | `MAP_SPATIAL_LIMITS.elevation.min`(−100000) | `….max`(100000) | 1 | 10 | 아님 | 없음 |
| `volumeHeight` | 입체 높이 | `MAP_SPATIAL_LIMITS.volumeHeight.min`(1) | `….max`(100000) | 1 | 10 | 아님 | 없음 |
| `x` · `y` | 가로 위치 · 세로 위치 | −100000 | 100000 | 1 | 10 | 아님 | 없음 |
| `width` · `height` | 가로 길이 · 세로 길이 | 10 | 100000 | 1 | 10 | 아님 | 없음 |
| `angle` · `rotation` | 방향 (°) · 회전 (°) | `-Infinity` | `Infinity` | 1 | 15 | **맞음** | 0~359 |
| `pitch` | 위아래 각도 (°) · 앞뒤 기울기 (°) | `MAP_SPATIAL_LIMITS.pitch.min`(−90) | `….max`(90) | 1 | 15 | 아님 | −90~90 |
| `roll` | 기울기 (°) · 좌우 기울기 (°) | `MAP_SPATIAL_LIMITS.roll.min`(−180) | `….max`(180) | 1 | 15 | 아님 | −180~180 |
| `fov` | 화각 (°) | 10 | 170 | 1 | 10 | 아님 | 10~170 |

막대가 있는 칸은 일곱이다: 방향, 위아래 각도, 기울기, 화각(카메라) · 앞뒤 기울기, 좌우 기울기(기호) · 회전(공간·기호). 위치·길이의 100000과 10은 이 파일의 지역 상수로 둔다(`mapGeometry.ts`의 같은 수와 같은 뜻이다. 편집기의 `PLAN_LIMIT`·`MIN_PLAN_SIZE`는 없어진다 — 6.3).

**읽기 — `mapNodeNumber`.** 칸이 오늘 `value`에 넘기는 식 그대로다.

| 키 | 카메라 | 공간 | 기호 |
|---|---|---|---|
| `elevation` | `nodeElevation(node)` | 같음 | 같음 |
| `volumeHeight` | `null` | 도로면 `null`, 아니면 `nodeVolumeHeight(node)` | `nodeVolumeHeight(node)` |
| `angle` · `fov` | `node.angle` · `node.fov` | `null` | `null` |
| `pitch` · `roll` | `cameraAngles(node)`의 값 | `null` | `nodeAngles(node)`의 값 |
| `x` · `y` | `node.x` · `node.y` | 같음 | 같음 |
| `width` · `height` · `rotation` | `null` | `node.width` · `node.height` · `node.rotation` | 같음 |

**쓰기 — `setMapNodeNumber`.**

```ts
export function setMapNodeNumber(map: BackgroundMap, id: string, key: MapNumberKey, value: number): BackgroundMap {
  const node = map.nodes.find(item => item.id === id), current = node && !node.locked ? mapNodeNumber(node, key) : null;
  // Asked before the value is settled: a number stored outside the limits (a field of view of 175) is not rewritten by a drag that never moved.
  if (!node || current === null || !Number.isFinite(value) || value === current) return map;
  const next = settleNumber(value, key);
  if (next === current) return map;
  // A space carries its cameras and objects along, here as when the number is typed.
  if (key === 'x' || key === 'y') return placeMapNode(map, id, key === 'x' ? { x: next, y: node.y } : { x: node.x, y: next });
  const changed = { ...node, [key]: next } as BackgroundNode;
  return changed.type === 'space' ? transformMapSpace(map, changed) : replaceMapNode(map, changed);
}
```

이것이 `patchNode`가 친 값으로 만드는 도면과 같다(:549-550 — `{ ...노드, ...changes }`를 공간이면 `transformMapSpace`, 아니면 그 노드만 바꿔 넣기). 그래서 **끌어서 나올 수 있는 값 N(걸음의 배수, 또는 처음 값)에서는 N을 끌어 만든 도면과 N을 쳐서 만든 도면이 같다**: 위치 둘을 뺀 아홉 키는 깊이 비교로 같고, 위치는 친 쪽이 `지금 + (N − 지금)`으로 더하기 때문에 마지막 자리에서 다를 수 있어 1e-9 안에서 같다(끈 쪽이 정확히 N이다). 소수가 있는 방향·회전을 **치면** 편집기의 `normalizeAngle`(:80, `((v % 360) + 360) % 360`)이 마지막 자리를 흔든다(94.3 → 94.30000000000001 — 범위 안의 값을 그대로 돌려주는 `normalizeDegrees`와 다르다). 끌기는 그런 값을 만들지 않으므로 동작은 같다 — 쓰는 함수를 거기에 맞춰 고치지 않는다. 방의 가로 길이를 바꾸면 소속 카메라·기호가 시작 때의 크기에서 한 번 늘고, 바닥 높이는 같은 만큼 올리고, 회전은 함께 돌고, 잠긴 소속은 남는다 — 모두 `transformMapSpace`가 한다.

**다듬기와 걸음.**

```ts
export function settleNumber(value: number, key: MapNumberKey): number {
  const rule = MAP_NUMBER_FIELDS[key];
  if (!Number.isFinite(value)) return Number.NaN;
  return (rule.wrap ? normalizeDegrees(value) : Math.min(rule.max, Math.max(rule.min, value))) + 0;
}
export function scrubSteps(dx: number, big: boolean): number {
  return Number.isFinite(dx) ? Math.trunc(dx / (big ? MAP_NUMBER_SCRUB.bigStepPx : MAP_NUMBER_SCRUB.stepPx)) + 0 : 0;
}
export function stepNumber(start: number, steps: number, key: MapNumberKey, big: boolean): number {
  if (!steps || !Number.isFinite(start) || !Number.isFinite(steps)) return start;
  const rule = MAP_NUMBER_FIELDS[key], grid = big ? rule.big : rule.step;
  // Off the grid, the first step lands on the next grid value in the direction of travel.
  const base = (steps > 0 ? Math.floor(start / grid) : Math.ceil(start / grid)) * grid;
  return settleNumber(base + steps * grid, key);
}
export function trackNumber(fraction: number, key: MapNumberKey, big: boolean, start: number): number {
  const rule = MAP_NUMBER_FIELDS[key], track = rule.track;
  if (!track || !Number.isFinite(fraction)) return start;
  const grid = big ? rule.big : rule.step, raw = track.min + Math.min(1, Math.max(0, fraction)) * (track.max - track.min);
  const rounded = Math.round(raw / grid) * grid;
  // The ends of a bar are not always on the grid (359 with steps of 15): the last grid value inside the bar stands for them.
  const snapped = (rounded > track.max ? Math.floor(track.max / grid) * grid : rounded < track.min ? Math.ceil(track.min / grid) * grid : rounded) + 0;
  const shown = rule.wrap ? normalizeDegrees(start) : start;
  return Math.abs(raw - shown) <= Math.abs(raw - snapped) ? start : snapped;
}
export function slideNumber(slide: MapNumberSlide, x: number, big: boolean, key: MapNumberKey): number {
  if (big !== slide.big) { slide.anchorX = x; slide.anchorValue = slide.value; slide.big = big; }
  return slide.value = stepNumber(slide.anchorValue, scrubSteps(x - slide.anchorX, slide.big), key, slide.big);
}
export function pressNumberTrack(value: number, key: MapNumberKey, x: number, left: number, width: number): { immediate: boolean; fraction(x: number): number } | null {
  // The centre of the dot travels from half a dot inside one end to half a dot inside the other, as it is drawn (3.5).
  const half = MAP_NUMBER_SCRUB.thumbPx / 2, usable = width - MAP_NUMBER_SCRUB.thumbPx;
  if (!(usable > 0)) return null;
  const dotX = left + half + trackFraction(value, key) * usable, onDot = Math.abs(x - dotX) <= MAP_NUMBER_SCRUB.grabPx, offset = onDot ? dotX - x : 0;
  return { immediate: !onDot, fraction: pointerX => (pointerX + offset - left - half) / usable };
}
```

| 경우 | 값 |
|---|---|
| 0걸음 | 처음 값 그대로(244.65 → 244.65) |
| 244.65에서 +1 · +2 · −1 | 245 · 246 · 244 |
| 244.65에서 Shift +1 · −1, 240에서 Shift +1 · −1 | 250 · 240, 250 · 230 |
| 음수 | 높이 −3.5에서 +1 · −1 → −3 · −4, Shift +1 · −1 → 0 · −10(0은 `-0`이 아니다) |
| 한계 | 화각 170에서 +1 → 170. 입체 높이 3에서 −5 → 1. 길이 12에서 −5 → 10. 높이 99999에서 +5 → 100000 |
| 돌기 | 방향 359에서 +1 → 0, 0에서 −1 → 359, Shift로 350에서 +1 → 0, 0에서 −1 → 345. 저장돼 있던 −90에서 +1 → 271. 여러 바퀴: 0에서 +725 → 5, −725 → 355 |
| 한계 밖에 있던 값 | 화각 175에서 −1 → 170, +1 → 170(움직이는 순간 한계로 들어온다. 적을 때 칸을 떠나면 한계로 맞춰지는 것과 같다) |
| 한계에 닿은 뒤 더 끈 만큼 | 되돌아올 때 그만큼을 되짚어야 값이 움직인다 — 값은 "처음 값과 포인터의 자리"만의 함수다(끄는 도중 Shift를 누르거나 떼지 않는 한) |
| 걸음 수(`scrubSteps`) | `stepPx`의 1.5배 → 1, 0.9배 → 0, −0.9배 → 0(`-0`이 아니다), −1.5배 → −1. `bigStepPx`의 2배 → 2. `NaN` → 0 |
| 막대(`trackNumber`) | 화각: 0 → 10, 1 → 170, 0.5 → 90. 방향: 1 → 359, Shift면 345. 처음 값이 47인 위아래 각도에서 Shift로 47.2 자리 → 47(처음 값이 더 가깝다), 55 자리 → 60. 저장돼 있던 회전 −90에서 270.2 자리 → −90 그대로(돌려서 본 270이 더 가깝다) |
| 점의 자리(`trackFraction`) | 돌아가는 값은 0 이상 360 미만으로 고친 뒤(`normalizeDegrees`), `(값 − track.min) / (track.max − track.min)`을 0~1로 자른다. 수가 아니거나 막대가 없는 키는 0. 화각 175 → 1, 화각 5 → 0, 저장돼 있던 회전 −90 → 270/359 |
| 끌기(`slideNumber`) — 높이 120, 끌기가 x 104에서 시작 | 115까지 1px씩 · 3px씩 · 한 번에 가도 모두 **125**(값은 자리만 본다. 사건마다 걸음을 더하는 구현은 1px씩에서 120, 보이는 값에서 걸음을 세는 구현은 150을 낸다). 244.65는 106에서 245, 104로 돌아오면 244.65 그대로, 102에서 244 |
| 끄는 도중의 Shift | 123에서 110까지 끌어 126 → 거기서 Shift를 누르면 126 그대로(튀지 않는다)이고 116에서 130, 122에서 140 → 123에서 떼면 140 그대로, 125에서 141 |
| 막대를 누름(`pressNumberTrack`) — 왼쪽 0 · 폭 170(화각 1°가 1px, 90의 점은 x 85) | 점에서 4px 벗어난 89: `immediate` 거짓, 그 자리의 값 90 그대로, 90으로 가면 91, 99로 가면 100(잡은 어긋남을 지킨다 — 어긋남을 0으로 두면 누른 자리가 곧 94다). 점에서 30px 벗어난 115: `immediate` 참, 그 자리의 값 120. 점의 가장자리는 7px까지(8px은 점 밖). 폭이 10 이하이거나 수가 아니면 `null` |

끌기(`slideNumber`) · 끄는 도중의 Shift · 막대를 누름(`pressNumberTrack`) 세 줄에 적힌 px은 **오늘의 상수**(`stepPx` 2 · `bigStepPx` 6 · `grabPx` 7 · `thumbPx` 10)에서의 자리다. 상수를 맞추면 자리만 달라지고 값은 그대로다 — 그래서 테스트는 그 자리를 글자로 적지 않고 `MAP_NUMBER_SCRUB`의 이름에서 만든다(7.1의 N-6·N-7이 식을 적는다). `thumbPx`만은 스타일시트에도 같은 수가 있다 — 3.5의 점의 줄의 `width:10px`과 `left`의 `(100% - 10px)`: 점의 크기를 바꾸려면 셋을 함께 바꾸고, 그 `left`를 글자로 보는 앵커 63도 따라 고친다.

### 3.2 편집기의 끌기 객체 — `fieldScrub`

칸과 옆 그림의 손잡이가 **같은 객체 하나**를 받는다. 계약은 `mapCanvas.ts`에 둔다(보조 평면도의 props가 읽는다).

```ts
// mapCanvas.ts — 더하는 것
import type { MapNumberKey } from './mapNumberField.ts';
/** Where a drag of one number starts: its value, and the map every preview of that drag is computed from. */
export type MapScrubOrigin = { start: number; map: BackgroundMap };
/**
 * One number of the node in hand, dragged from outside the canvas: a field of the inspector, the lens of the side view.
 * One drag is one gesture of the document: any number of previews, at most one undo step.
 */
export type MapFieldScrub = {
  /** Starts the drag. Null: refused (nothing to edit, a locked node, a save or another drag running). */
  begin(field: MapNumberKey): MapScrubOrigin | null;
  /** Shows `value` in every view. */
  preview(field: MapNumberKey, value: number): void;
  finish(): void; cancel(): void;
  /** A drag is still running. False once the editor has cancelled it (Escape, a save starting, another map). */
  alive(): boolean;
};
/** Companion plan shown next to the 3D viewport. It reads the same in-progress draft. */
export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' | 'selectedId' | 'canEdit' | 'onSelect'> & { scrub: MapFieldScrub };
```

편집기에서의 자리는 **`cancelCanvasGesture`(:1019) 바로 다음, `placeAt`(:1020) 앞**이다(`keyboard` 조각은 `const selectNode = useEvent(`에서 끝난다 — 그 뒤의 안정 콜백 줄들은 어느 함수 조각에도 들지 않는다). :1016~:1019의 네 줄은 고치지 않는다.

```ts
  const cancelCanvasGesture = useEvent(() => doc.cancelGesture());
  /** A number of the node in hand slid from outside the canvas (a field of the inspector, the lens of the side view): one drag, one undo step. */
  const beginFieldScrub = useEvent((field: MapNumberKey) => {
    if (!current || !selected || selected.locked || !canEdit || pointerRef.current || doc.isGestureActive()) return null;
    // Leaving a field commits what was being typed in it, as an undo step of its own. The drag starts from the map after that,
    // read from the store: this handler still holds the map of the last render.
    focusCanvas();
    const map = mapDraft(doc.getState(), current.id)?.value, node = map?.nodes.find(item => item.id === selected.id);
    const start = node && !node.locked ? mapNodeNumber(node, field) : null;
    if (!map || start === null || !doc.beginGesture(current.id)) return null;
    return { start, map };
  });
  const previewFieldScrub = useEvent((field: MapNumberKey, value: number) => {
    const start = current && gestureStartMap(doc.getState(), current.id);
    // From the map of the start, never from the preview before: the members of a space are carried once.
    if (start && selected && canEdit) doc.previewGesture(setMapNodeNumber(start, selected.id, field, value));
  });
  const fieldScrub = useMemo((): MapFieldScrub => ({ begin: beginFieldScrub, preview: previewFieldScrub, finish: finishCanvasGesture, cancel: cancelCanvasGesture, alive: doc.isGestureActive }),
    [beginFieldScrub, previewFieldScrub, finishCanvasGesture, cancelCanvasGesture, doc.isGestureActive]);
```

- **덜 친 값이 먼저 확정된다.** `focusCanvas()`가 치던 칸의 blur를 그 자리에서 일으킨다(같은 칸의 끌개를 끌어도 같다): 범위 밖의 값은 한계로 들어가 자기 단계가 되고(`onChange`), 합치기가 끝난다(`onDone`). 문서 저장소는 동기라서 바로 다음 줄의 `doc.getState()`가 그 값을 본다. 끌기는 그다음 단계다(Ctrl+Z 두 번). 처음 값과 시작 도면은 **`begin`이 돌려준 것만** 쓴다 — 부품의 마지막 렌더가 아니다. 포커스를 쥔 것이 숫자 칸이 아니어도 같다: 평면의 이름 상자는 blur에서 이름을 확정하고 닫히며(BackgroundMapNameBox.tsx:60 → `commitName` — 자기 단계이고, 막 그린 노드면 그 그리기 단계에 합쳐진다), 속성의 '이름' 칸은 조합 중이던 한글까지 확정한 뒤 합치기를 끝낸다(:1195). 모두 `doc.beginGesture`보다 **앞**이다 — 뒤라면 제스처가 그 `update`를 말없이 버린다(앵커 61이 차례를 지킨다. 7.6의 N17·N18).
- **포커스는 캔버스에 남는다.** 끈 뒤에 Ctrl+Z·Delete·Ctrl+S·Esc가 도면을 누르지 않아도 듣는다. 평면의 SVG에 그려지는 고리는 v1.135.1의 규칙을 따른다: 마지막 클릭 뒤에 키를 누르지 않았으면 그려지지 않는다. 숫자를 치거나 Ctrl+Z를 누른 직후의 끌기는 엔진이 키보드로 간 포커스로 볼 수 있고, 그때는 키보드 고리(보조 강조색 2px)가 보인다 — **받아들인다**(편집 테두리의 색이 아니고, 오늘 '숫자를 치고 도면을 누름'도 같은 길이다. 10.1의 E4).
- **미리보기는 늘 시작 도면에서 만든다.** 값이 처음 값과 같으면 `setMapNodeNumber`가 시작 도면 그 객체를 돌려주고, 놓을 때 `finishMapGesture`가 단계를 만들지 않는다. 띠의 수는 놓을 때 1 늘고, 제자리로 돌아와 놓으면 그대로다.
- **Esc와 그 밖의 취소는 편집기가 이미 한다**(2.2). 훅은 `alive()`가 거짓이 된 것을 다음 포인터 사건에서 알아채고 손을 뗀다(3.3). 끄는 모습(칸의 강조, 옆 그림의 진한 고리와 얼린 눈금)은 그보다 먼저 꺼진다: 두 부품이 그릴 때 `scrub.alive()`도 함께 묻고, 편집기는 제스처가 끝나면 둘을 다시 그린다(3.4·4.3 — 그래서 두 부품과 보조 평면도는 `memo`로 감싸지 않는다). 도구와 찍던 다각형 점은 그대로다(창 단위 Esc는 `handledEscape`로, `keyboard()`의 Esc는 `doc.isGestureActive()` 가지로 — 어느 쪽이 먼저 들어도 도구를 비우는 줄에 닿지 않는다).
- `alive`는 "문서에 제스처가 돈다"다. 포인터 하나로는 그 사이에 다른 제스처가 시작될 수 없다(끌던 포인터가 눌려 있다). 펜과 손가락처럼 포인터가 둘인 경우는 10.3에 적는다.

### 3.3 포인터 세션 — `useMapScrubPointer.ts` (새 파일)

끌개·칸 이름·막대·옆 그림의 손잡이가 쓰는 하나뿐인 포인터 코드다. **이동과 놓음을 창(`window`)의 캡처 단계에서 듣는다** — 포인터 캡처가 걸리면 캡처한 요소로 가는 사건이 창을 지나고, 걸리지 않으면(검사 창) 포인터 밑의 요소로 가는 사건이 창을 지난다. 어느 쪽이든 같은 리스너가 듣는다. 캡처는 걸어 본다(창 밖으로 나간 진짜 마우스를 따라가려고).

```ts
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { MapFieldScrub, MapScrubOrigin } from './mapCanvas.ts';
import { MAP_NUMBER_SCRUB } from './mapNumberField.ts';
import type { MapNumberKey } from './mapNumberField.ts';
export type MapScrubPoint = { clientX: number; clientY: number; shiftKey: boolean };
/** What one control makes of a pressed pointer. Built at the press. */
export type MapScrubDrive<S> = {
  field: MapNumberKey;
  /** The direction the drag runs in: movement along the other one never starts it. */
  axis: 'x' | 'y';
  /** True: the press itself starts the drag (a press on the bar away from its dot). False: the first move past the slop does. */
  immediate: boolean;
  /**
   * The drag starts. `from` is where it starts: the press itself when `immediate`, else the press moved by the slop along the
   * axis, towards the pointer. Never where the pointer is by then: a fast start reads the same as a slow one, and the first
   * value is the one the drag started from. What this returns is kept until the drag ends.
   */
  open(origin: MapScrubOrigin, from: MapScrubPoint): S;
  /** The value at a pointer position. May re-anchor `drag` (Shift pressed or released on the way). */
  read(drag: S, at: MapScrubPoint): number;
  /** The press was released without becoming a drag. */
  tap?(): void;
  /** The drag is over, however it ended. Not called for a press that never became a drag, nor as the control is taken down. */
  close?(): void;
};
```

**본문은 아래 그대로 쓴다.** React 훅이라 Node 테스트가 닿지 않으므로 앵커 62가 이 줄들을 글자로 본다(11절: 가짜 창과 가짜 사건으로 아래 표를 열네 가지 경우로 돌려 봤다). `scrub`·`disabled`는 `latest` ref로 읽는다 — 누른 뒤에 바뀐 값도 본다.

```ts
/** One pressed pointer. `end` takes its listeners away; `giveUp` also cancels the drag it was running. */
type Session = { pointerId: number; press: MapScrubPoint; phase: 'pressed' | 'dragging' | 'dead'; last: number; end(): void; giveUp(): void };
export function useMapScrubPointer(scrub: MapFieldScrub, disabled: boolean): <S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => void {
  const latest = useRef({ scrub, disabled }), session = useRef<Session | null>(null);
  latest.current = { scrub, disabled };
  // Taken down with a press still on it (another node was picked, the pane was folded): the listeners go whatever the phase, and a drag still running is cancelled.
  useEffect(() => () => {
    const active = session.current;
    if (!active) return;
    if (active.phase === 'dragging' && latest.current.scrub.alive()) latest.current.scrub.cancel();
    active.end();
  }, []);
  return useCallback(<S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => {
    if (!event.isPrimary || event.button !== 0 || latest.current.disabled) return;
    // A session of this pointer that is still here was never released as far as this window heard: it is given up first. Another pointer waits.
    if (session.current) { if (session.current.pointerId !== event.pointerId) return; session.current.giveUp(); }
    event.preventDefault();
    const target = event.currentTarget, pointerId = event.pointerId;
    let drag: S;
    const active: Session = { pointerId, press: { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }, phase: 'pressed', last: Number.NaN, end, giveUp };
    function end() {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel); target.removeEventListener('lostpointercapture', cancel);
      // After the listeners: the lostpointercapture this raises is no cancel.
      try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch { /* no capture here */ }
      if (session.current === active) session.current = null;
    }
    function giveUp() {
      if (active.phase === 'dragging') { if (latest.current.scrub.alive()) latest.current.scrub.cancel(); drive.close?.(); }
      end();
    }
    function read(at: MapScrubPoint) {
      // The editor has cancelled the drag (Escape, a save starting): nothing more comes of this press.
      if (!latest.current.scrub.alive()) { active.phase = 'dead'; drive.close?.(); return; }
      const value = drive.read(drag, at);
      if (Number.isFinite(value) && value !== active.last) { active.last = value; latest.current.scrub.preview(drive.field, value); }
    }
    function begin(at: MapScrubPoint, along: number) {
      const origin = latest.current.scrub.begin(drive.field);
      // Beginning moves the focus, and what that commits is drawn at once: this control may have been taken down meanwhile.
      if (session.current !== active) { if (origin && latest.current.scrub.alive()) latest.current.scrub.cancel(); return; }
      if (!origin) { end(); return; }
      const slop = Math.sign(along) * MAP_NUMBER_SCRUB.slopPx;
      const from = drive.immediate ? active.press : { clientX: active.press.clientX + (drive.axis === 'x' ? slop : 0), clientY: active.press.clientY + (drive.axis === 'y' ? slop : 0), shiftKey: at.shiftKey };
      drag = drive.open(origin, from); active.last = origin.start; active.phase = 'dragging';
      read(at);
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== active.pointerId) return;
      // Letting go of the left button while another one is held arrives as a move, not as a release. So does a pointer that comes back after its button came up outside the window.
      if ((event.buttons & 1) === 0) { up(event); return; }
      if (active.phase === 'dragging') { read(event); return; }
      if (active.phase === 'dead') return;
      const along = drive.axis === 'x' ? event.clientX - active.press.clientX : event.clientY - active.press.clientY;
      if (Math.abs(along) >= MAP_NUMBER_SCRUB.slopPx) begin(event, along);
    }
    function up(event: PointerEvent) {
      if (event.pointerId !== active.pointerId) return;
      if (active.phase === 'pressed') { end(); drive.tap?.(); return; }
      if (active.phase === 'dragging') {
        read(event);                                                  // the place of the release
        if (active.phase === 'dragging') { latest.current.scrub.finish(); drive.close?.(); }
      }
      end();
      // The click that follows a drag is nobody's: on the name of a field it would put the caret in the box.
      const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener('click', swallow, true);
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    }
    function cancel(event: Event) {
      if ('pointerId' in event && event.pointerId !== active.pointerId) return;
      giveUp();
    }
    session.current = active;
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);
    // Not in the capture phase: the blur of the field that `begin` takes the focus from would be heard too, and cancel the drag as it starts.
    window.addEventListener('blur', cancel); target.addEventListener('lostpointercapture', cancel);
    try { target.setPointerCapture(pointerId); } catch { /* no capture here: the window listeners follow the pointer anyway */ }
    if (drive.immediate) begin(active.press, 0);
  }, []);
}
```

| 사건 | 그때의 상태 | 하는 일 |
|---|---|---|
| `pointerdown` — `isPrimary`, `button === 0`, `disabled` 아님 | 세션 없음 | `preventDefault()`(치던 칸의 포커스가 그대로 남는다 — 끌기가 시작될 때 `begin`이 옮긴다). 세션을 `pressed`로 적고 리스너 다섯을 건다. 캡처는 걸어 본다(없는 환경에서는 던질 수 있다). `drive.immediate`면 곧바로 **시작**한다 |
| 같은 `pointerdown` | **같은 포인터의** 세션이 남아 있다 — 놓음이 이 창에 닿지 않은 것이다(누른 요소가 사라진 뒤 창 밖에서 놓았다) | 남은 세션을 먼저 **버리고**(아래) 이 누름을 받는다. 무시하면 그 부품은 다시 그려질 때까지 눌리지 않는다 |
| 그 밖의 `pointerdown`(다른 포인터의 세션이 도는 중, 다른 버튼, `isPrimary` 아님, `disabled`) | — | 아무 일도 없다(`preventDefault`도 하지 않는다) |
| `pointermove`·`pointerup`·`pointercancel`·`lostpointercapture`, 다른 `pointerId` | — | 무시(`move`·`up`·`cancel`의 첫 줄. `blur`에는 `pointerId`가 없다 — 그대로 버림) |
| `pointermove`, 왼쪽 단추가 눌려 있지 않다(`(event.buttons & 1) === 0`) | 어느 상태든 | 그 자리의 `pointerup`으로 읽는다. 다른 단추를 누른 채 왼쪽 단추를 놓으면 놓음이 이동으로 온다(3D 화면의 같은 규칙, BackgroundMap3D.tsx:597-602). 창 밖에서 놓고 돌아온 포인터도 여기서 끝난다 |
| `pointermove` | `pressed`, **축 방향으로** 움직인 거리 < `slopPx` | 아무 일도 없다(다른 방향으로는 얼마를 가도) |
| `pointermove` | `pressed`, ≥ `slopPx` | **시작** |
| **시작** | — | `origin = scrub.begin(drive.field)`. 돌아와 보니 세션이 이 세션이 아니면(시작이 포커스를 옮기고, 그것이 확정한 것이 곧바로 그려져 이 부품이 내려갔다) 막 시작한 제스처를 취소하고 끝. `null`이면 세션을 끝낸다(누르지 않은 것과 같다 — 뒤따르는 클릭도 그대로 둔다). 아니면 `drag = drive.open(origin, from)`, `last = origin.start`, `dragging`, 그리고 포인터의 진짜 자리를 **읽는다** — 문턱을 15px에서 처음 넘겼으면 첫 읽기에 그 11px만큼의 값이 나온다(값은 포인터의 자리로만 정해지고, 이동이 몇 번에 나뉘어 오는지와 무관하다). `from`은 누른 자리를 축 방향으로 `Math.sign(움직인 쪽) * slopPx`만큼 옮긴 것이고 `shiftKey`는 그 이동 사건의 것이다(`immediate`면 누른 자리 그대로) |
| **읽기**(`pointermove`, `dragging`) | — | `scrub.alive()`가 거짓이면 `drive.close?.()`하고 `dead`(리스너는 놓을 때까지 둔다). 참이면 `value = drive.read(drag, at)`; 유한하고 `last`와 다를 때만 `scrub.preview(field, value)`, `last = value` |
| `pointermove` | `dead` | 무시 — 취소된 끌기는 그 누름이 끝날 때까지 아무것도 하지 않는다 |
| `pointerup` | `pressed` | 세션을 끝내고 `drive.tap?.()`을 부른다(숫자 칸: 칸에 포커스). 클릭은 그대로 간다 |
| `pointerup` | `dragging` | 놓은 자리를 한 번 더 **읽고**, 그래도 `dragging`이면(`alive()`) `scrub.finish()`와 `drive.close?.()`. 세션 끝, **뒤따르는 클릭 하나를 삼킨다** |
| `pointerup` | `dead` | 세션 끝, 클릭 하나를 삼킨다 |
| **버림** — `pointercancel` · 창의 `blur` · `lostpointercapture` · 같은 포인터의 새 누름 | `dragging` | `alive()`면 `scrub.cancel()`. `drive.close?.()`, 세션 끝 |
| 같은 것 | `pressed` · `dead` | 세션 끝 |
| 부품이 내려감(effect의 정리) | **어느 상태든** | `dragging`이고 `alive()`면 `scrub.cancel()`. 세션 끝(`close`는 부르지 않는다). 숫자 칸과 옆 그림은 다른 노드를 고르면 내려간다(`key`) — `pressed`의 리스너가 남으면 다음 이동이 **새로 고른 노드에서** 끌기를 시작한다 |
| Esc, 저장 시작, 다른 도면·모드 | `dragging` | **편집기가 취소한다**(2.2). 훅은 다음 `pointermove`·`pointerup`에서 `dead`로 간다(`close`도 그때다 — 끄는 모습은 기다리지 않고 꺼진다, 3.2) |

- **세션 끝**(`end`) = 리스너 다섯을 모두 떼고, 캡처가 있으면 놓고, ref를 비운다. 리스너를 **뗀 다음에** 캡처를 놓는다 — 놓을 때 생기는 `lostpointercapture`가 버림으로 읽히지 않게. 진짜 마우스에서 `pointerup` 뒤에 오는 `lostpointercapture`도 같은 까닭으로 닿지 않는다(리스너가 이미 없다).
- **`blur`는 캡처 없이 건다.** 캡처로 걸면 `begin`이 치던 칸에서 포커스를 옮길 때의 그 칸의 blur까지 들려 끌기가 시작하자마자 취소된다.
- **클릭 삼키기**: 클릭은 `pointerup`과 같은 작업 안에서 오므로 타이머(0)보다 앞이다. 삼키지 않으면 칸 이름에서 끝난 끌기가 칸에 커서를 넣는다(`<label for>`의 클릭). 캡처가 없는 검사 창에서는 클릭이 누른 곳과 놓은 곳의 공통 조상으로 간다 — 그것도 삼킨다.
- **읽는 보조키는 Shift 하나다**(`shiftKey`). Alt·Ctrl·Meta는 읽지 않는다. Shift는 `pointermove` 때의 값으로 본다(키 리스너를 달지 않는다).
- `React.StrictMode`의 이중 실행에서 정리 함수가 세션 없이 불린다 — 아무 일도 하지 않는다.

### 3.4 부품 — `BackgroundMapNumberField.tsx` (새 파일)

편집기는 `import { BackgroundMapNumberField as NumberField } from './BackgroundMapNumberField';`로 가져온다 — JSX의 태그 이름 `<NumberField label="…" `과 앵커 44의 글자가 그대로다. 편집기 안의 `NumberField`(:136-156)는 지운다.

```ts
export function BackgroundMapNumberField({ label, field, value, disabled = false, onChange, onDone, scrub }: {
  /** `field`: which number of the node this is. Its limits, its steps and its bar come from MAP_NUMBER_FIELDS. */
  label: string; field: MapNumberKey; value: number; disabled?: boolean;
  /** A typed value. A slide does not come this way: it goes through `scrub`. */
  onChange(value: number): void; onDone?(): void; scrub: MapFieldScrub }): JSX.Element
```

```tsx
const SLIDE_TITLE = '좌우로 끌어 값 바꾸기 · Shift를 누르면 큰 걸음 · 끄는 도중 Esc는 취소';
const BAR_TITLE = '눌러서 바로 맞추거나 점을 끌어요 · Shift를 누르면 큰 걸음';
…
  const id = useId(), box = useRef<HTMLInputElement>(null), { min, max, track } = MAP_NUMBER_FIELDS[field];
  return <div className={`bg-field bmap-num${lit ? ' is-dragging' : ''}`} data-disabled={disabled || undefined}>
    <label className="bmap-num-label" htmlFor={id} title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}>{label}</label>
    <div className="bmap-num-row">
      <input ref={box} id={id} type="number" step="any" value={text ?? round(value)} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} disabled={disabled}
        onChange={…} onKeyDown={…} onBlur={…} />
      <span className="bmap-num-grip" aria-hidden="true" title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}><MoveHorizontal size={14} strokeWidth={2} /></span>
    </div>
    {track && <div className="bmap-num-track" aria-hidden="true" title={disabled ? undefined : BAR_TITLE} onPointerDown={slideBar}>
      <span className="bmap-num-thumb" style={{ '--bmap-num-at': trackFraction(value, field) } as CSSProperties} />
    </div>}
  </div>;
```

- **적는 코드는 :141-155를 글자 그대로 옮긴다**: `const [text, setText] = useState<string | null>(null);`, `parse`, `onChange`의 세 줄(`if (next !== null && next >= min && next <= max && next !== value) onChange(next);`), `onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}`, `onBlur`의 네 줄. `round`는 편집기의 그 줄을 이 파일에도 둔다(`const round = (value: number) => Math.round(value * 100) / 100;`). 달라지는 것은 `min`·`max`가 props가 아니라 표에서 오는 것뿐이다.
- **이름은 `<label for>`로 칸과 이어진다**(예전에는 칸을 감싸는 `<label>`이었다). 칸의 접근성 이름과 역할(`spinbutton`)이 같고, 이름을 그냥 누르면 칸에 커서가 간다. **Tab 순서에 더해지는 것이 없다** — 끌개와 막대는 `aria-hidden`이고 `tabIndex`가 없다(키보드와 화면 낭독기는 칸 하나로 같은 값을 다룬다).
- 끌개의 그림은 `lucide-react`의 `MoveHorizontal`이다(양쪽 화살촉과 화살대 — 알린 대로 ↔. 설치된 0.303.0에 있다). 크기 14px은 앱에서 눈으로 맞춘다.
- **끌기**(`slide` — 이름과 끌개가 함께 쓴다). 4px을 넘기기 전에는 아무 일도 없고, 끌지 않고 놓으면 칸에 포커스가 간다(`tap` — 끌개는 그것이 유일한 길이고, 이름은 `<label for>`의 클릭으로도 간다):

```tsx
  const press = useMapScrubPointer(scrub, disabled);
  const [dragging, setDragging] = useState(false);
  // The editor can end a drag by itself (Escape, a save starting). It draws this again then, and the look goes at once: not at the next pointer event.
  const lit = dragging && scrub.alive();
  const slide = (event: ReactPointerEvent<Element>) => press(event, {
    field, axis: 'x', immediate: false,
    // The anchor is where the drag starts (the press moved by the slop), not where the pointer is by then. The arithmetic is slideNumber's.
    open: (origin, from): MapNumberSlide => { setDragging(true); return { anchorX: from.clientX, anchorValue: origin.start, big: from.shiftKey, value: origin.start }; },
    read: (drag, at) => slideNumber(drag, at.clientX, at.shiftKey, field),
    tap: () => box.current?.focus(),
    close: () => setDragging(false),
  });
```

- **막대**(`slideBar`): 점은 폭 10px이고 가운데가 `5px + 값의 자리 × (막대 폭 − 10px)`에 있다(양 끝에서 삐져나오지 않는다). 셈은 `pressNumberTrack`이 같은 식으로 한다: 점을 누르면 잡은 어긋남을 지킨 채 끌기 전에는 변하지 않고, 그 밖을 누르면 값이 누른 자리로 간다.

```tsx
  const slideBar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), bar = pressNumberTrack(value, field, event.clientX, rect.left, rect.width);
    if (!bar) return;
    press(event, { field, axis: 'x', immediate: bar.immediate,
      open: origin => { setDragging(true); return origin.start; },
      read: (start, at) => trackNumber(bar.fraction(at.clientX), field, at.shiftKey, start),
      close: () => setDragging(false) });
  };
```

- 범위 밖에 저장된 값(화각 175)은 점이 끝에 있다(`trackFraction`이 0~1로 자른다).
- **꺼진 상태**(`disabled` — 잠긴 노드, 저장이 도는 동안): 칸은 지금처럼 꺼지고, 이름·끌개·막대는 흐려지고 커서가 기본이며 눌러도 아무 일도 없다(훅이 받지 않는다). 풍선도 없다. 잠금 체크는 지금처럼 편집 중이면 켜져 있다(:1253).
- **칸이 없는 때**는 지금과 같다: 보기 모드(요약 글만), 평면에서 여러 개 선택(요약). 3D에서 묶음이 있을 때는 고른 하나의 칸이 보통처럼 끌린다(`selected`가 그 하나다).
- **14곳의 태그**는 `field`와 `scrub`을 얻고 `min`·`max`를 잃는다. `label`이 첫 속성이고 `onDone`·`onChange`는 그대로다 — `<NumberField label="카메라 높이" field="elevation" value={nodeElevation(selected)} disabled={fieldLocked} scrub={fieldScrub} onDone={doc.endCoalescing} onChange={elevation => patchNode({ elevation }, 'elevation')} />`. **`field`는 2.1의 표의 '저장 키'다**(칸 이름과 키의 짝 14개: 카메라 높이·바닥 높이 → `elevation`, 위아래 각도·앞뒤 기울기 → `pitch`, 기울기·좌우 기울기 → `roll`, 나머지는 하나씩). **`value`의 식도 오늘 그대로다**(앵커 60이 `label`·`field`·`value` 셋을 함께 본다): 카메라 높이·바닥 높이 `nodeElevation(selected)` · 방향 `selected.angle` · 위아래 각도 `angles.pitch` · 기울기 `angles.roll` · 화각 `selected.fov` · 입체 높이 `nodeVolumeHeight(selected)` · 앞뒤 기울기 `nodeAngles(selected).pitch` · 좌우 기울기 `nodeAngles(selected).roll` · 가로 위치 `selected.x` · 세로 위치 `selected.y` · 가로 길이 `selected.width` · 세로 길이 `selected.height` · 회전 `selected.rotation`.

### 3.5 CSS — `backgrounds-map.css`, `.bmap-field-pair`(:171) 바로 다음

한 줄에 규칙 하나다. 클래스 이름은 `.bmap-num-`으로 시작한다(`.bmap-edit`로 시작하면 앵커 54가 띠의 줄로 센다). 새 미디어 블록은 없다 — 폭은 칸이 스스로 맞춘다.

```css
/* Number fields of the inspector: the name and the grip slide the value, and a value with fixed ends has a bar under its box. Nothing here moves by itself. */
.bmap-num-label { align-self:flex-start; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:500; color:var(--bg-muted); cursor:ew-resize; touch-action:pan-y; }
.bmap-num-row { position:relative; }
/* The selector has to outweigh the shared input rule of the library, which sets the padding. */
.bg-library .bmap-num-row input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]) { padding-left:24px; font-variant-numeric:tabular-nums; }
/* The two small arrows of the engine are not drawn: the grip does their job. The element stays, so the arrow keys and the wheel over a focused field step the value as before. */
.bmap-num-row input::-webkit-inner-spin-button,.bmap-num-row input::-webkit-outer-spin-button { -webkit-appearance:none; appearance:none; margin:0; }
/* At the left end of the box: the inspector hugs the right edge of the screen, and a grip at the right end would leave no room to drag towards more. */
.bmap-num-grip { position:absolute; top:1px; left:1px; bottom:1px; display:grid; place-items:center; width:18px; border-right:1px solid rgb(var(--color-bg-border)); border-radius:6px 0 0 6px; color:rgb(var(--color-text-secondary)); cursor:ew-resize; touch-action:pan-y; }
/* Pointed at and dragged: the tint marks it, and the mark itself takes the text colour. The lighter accent would all but vanish on the tint in the light themes. */
.bmap-num-grip:hover,.bmap-num.is-dragging .bmap-num-grip { color:rgb(var(--color-text-primary)); background:rgb(var(--color-accent) / .14); }
.bmap-num.is-dragging .bmap-num-label { color:rgb(var(--color-text-primary)); }
.bmap-num-track { position:relative; height:14px; margin-top:-2px; cursor:pointer; touch-action:pan-y; }
.bmap-num-track::before { content:""; position:absolute; left:0; right:0; top:5px; height:4px; border-radius:2px; background:rgb(var(--color-bg-border)); }
/* The edge keeps the dot apart from the page where the accent of a theme is close to it. */
.bmap-num-thumb { position:absolute; top:2px; left:calc(var(--bmap-num-at,0) * (100% - 10px)); width:10px; height:10px; border-radius:50%; background:rgb(var(--color-accent)); box-shadow:inset 0 0 0 1px rgb(var(--color-text-secondary)); pointer-events:none; }
.bmap-num[data-disabled] :is(.bmap-num-label,.bmap-num-grip,.bmap-num-track) { cursor:default; opacity:.55; }
.bmap-num[data-disabled] .bmap-num-grip:hover { color:rgb(var(--color-text-secondary)); background:transparent; }
```

- 테스트가 읽는 것(앵커 63): 작은 화살표의 줄(글자 그대로 — 게이트 N에서 대체안 `display:none`으로 바꾸면 앵커의 글자도 함께 바꾼다, 10.1), `.bmap-num-label`·`.bmap-num-grip`·`.bmap-num-track`의 `touch-action:pan-y`, 끌개의 자리(`.bmap-num-grip {` 줄에 `left:1px`이 있고 ` right:`가 없으며, 상자의 줄에 `padding-left:24px`이 있다 — J14. 게이트 N이 28px에서 줄였다), 점의 `pointer-events:none`과 `left:calc(var(--bmap-num-at,0) * (100% - 10px))`, 그리고 `.bmap-num`이 든 어느 줄에도 `transition`·`animation`이 없다. 그 밖의 값(폭 18px, 높이 14px, 색의 진하기)은 앱에서 눈으로 맞춘다 — 점의 크기만은 `MAP_NUMBER_SCRUB.thumbPx`와 같은 수라 함께 바꾼다(3.1의 표 아래).
- **`touch-action:pan-y`**: 좌우 끌기는 이 부품이 받고, 위아래로 미는 터치·펜은 속성 칸을 스크롤한다(그때 엔진이 `pointercancel`을 내고 끌기는 취소된다). 마우스에는 영향이 없다.
- **폭**(스크롤 막대가 있을 때 — 2.1): **게이트 N에서 잰 값이다**(2026-10-14, Electron 33): 한 칸은 속성 칸 260px(창 1101px 이상)에서 98px, 230px(창 901~1100px)에서 87px이고, 12px 고정폭 숫자 `-100000`은 49px이다. 처음 적은 수(끌개 폭 22px · 상자의 `padding-left` 28px)로는 230px 배치에서 2px 잘렸다(`scrollWidth` 87 > `clientWidth` 85) — 그래서 끌개 폭을 **18px**, 상자의 `padding-left`를 **24px**로 줄였다(앵커 63의 그 수도 함께). 지금 글자 자리는 260px 배치에서 62px, 230px 배치에서 51px이다(여백 10 + 24, 테두리 2): `-100000`은 어느 배치에서든 들어가고(230px에서 여유 2px), 여덟 글자(`12345.67`, 약 55px)는 230px 배치에서 4px쯤 잘린다(스크롤하면 보인다). 900px 이하에서는 속성 칸이 창 폭이라 칸이 넓어질 뿐이다. 막대는 점이 가는 길이 두 칸 줄에서 83~96.5px이라 방향·기울기 1°가 0.23~0.27px이다(그냥 누르면 4°쯤의 간격으로만 닿는다 — 90은 Shift로 맞는다. 위아래 각도는 0.46~0.54px, 화각은 0.52~0.60px, 한 줄을 다 쓰는 회전은 0.52~0.59px) — 막대는 한 번에 대강 맞추는 길이고 정확한 값은 끌개·Shift·적기다.
- **대비**(`src/themes.ts`의 색으로 셈): 밝은 화면에서도 `--color-accent-sub`는 어두운 화면의 그 밝은 색이다(`getLightColors`). 그래서 가리키거나 끄는 동안의 ↔와 칸 이름은 글자색(`--color-text-primary`)으로 그린다 — 보조 강조색이면 옅은 강조 바탕 위에서 1.2~2.0:1까지 떨어진다. 평소의 ↔(`--color-text-secondary`)는 어느 화면에서든 5.8:1 이상이다. 막대의 선(`--color-bg-border`)은 어두운 화면 1.3~1.4:1, 밝은 화면 1.6:1로 옅다(10.1). 점은 값을 말하는데 강조색만으로는 테마에 따라 3:1에 못 미친다(밝은 에메랄드 2.3:1, 어두운 나메코 2.8:1) — 그래서 점 안쪽에 보조 글자색의 1px 테두리를 둔다(5.7:1 이상).
- **끄는 동안의 커서**는 캡처가 잡아 준다(캡처한 요소의 커서가 쓰인다). 검사 창에서는 포인터 밑 요소의 커서가 보인다 — 모양일 뿐이다.

### 3.6 달라지는 것과 그대로인 것

| 것 | 예전 | 이제 |
|---|---|---|
| 칸에 마우스를 올리면 나오던 작은 위·아래 화살표 | 있음(누르면 1씩) | 없음. ↔ 끌개는 칸의 왼쪽 끝에 있다(J14) |
| 키보드 ↑↓ · 포커스가 있는 칸 위의 휠 | 엔진의 걸음 | **그대로** — 화살표는 그리지만 않고 요소는 남는다(J5). 고치기 전과 뒤의 결과를 견준다(E2) |
| 칸 안의 왼쪽 끝(이제 끌개가 있는 자리)을 누름 | 칸에 커서 | 칸에 포커스(J15). 누른 채 끌면 값이 변한다 |
| 칸 이름을 누름 | 칸에 커서 | **그대로**. 누른 채 4px 넘게 끌면 값이 변한다(되돌리기 한 단계) |
| 적기, Enter, 범위 밖의 값, 한 칸 = 한 단계, Ctrl+S가 치던 값을 확정 | — | **그대로**(R2) |
| 끄는 동안의 다른 것 | — | 되돌리기 버튼·'공간 종류'·'다각형으로 바꾸기'가 잠깐 꺼지고(지금의 `gestureActive` 규칙), 오브젝트 목록·이미지 목록은 놓을 때 따라온다 |

## 4. (a) 옆 그림에서 카메라 높이

### 4.1 눈금 — 끄는 동안 얼어 있다

오늘의 그림은 카메라가 범위를 벗어나면 눈금 자체를 다시 맞춘다(카메라가 맨 위 줄에 붙고 방이 줄어든다, 2.3). 끄는 도중에 그러면 점이 포인터에서 달아난다. 그래서 **끌기가 시작될 때의 눈금을 잡아 두고** 그 끌기가 끝날 때까지 그 눈금으로 그린다: 바닥 줄·방 상자는 움직이지 않고 점·기둥·화살표만 움직인다. 놓으면 그림이 오늘처럼 다시 맞춰진다.

| 것 | 규칙 |
|---|---|
| 잡는 때 | 끌기가 **시작될 때**(누른 뒤 4px을 넘긴 첫 이동). 누르는 순간이 아니다 — `begin`이 치던 칸을 확정하면서 높이가 바뀌었을 수 있다. 눈금은 `begin`이 돌려준 도면에서 만든다 |
| 갈 수 있는 곳 | 잡아 둔 범위에서 위아래로 **4분의 1씩 더**: 그림의 y 12~72(여행 구간 22~62에 10씩). 0~180 도면이면 높이 −45~225 자리이고, 걸음에 맞춰 −40~230이 된다. 그리고 저장 한계 −100000~100000 안 |
| 점이 그려지는 곳 | 늘 그 값의 자리. 보통의 도면(눈금 범위 120 이상)에서는 y 10~74로 상자 높이 84 안이다. 걸음에 맞추며 반 걸음(5)까지 더 나갈 수 있어 낮은 도면일수록 더 나가고, 범위가 20쯤보다 좁은 도면에서는 상자 밖에 그려질 수 있다 — SVG는 넘친 것도 그린다(J7). **끌기가 시작된 자리**(누른 자리에서 문턱 4px만큼 간 곳 — 3.3의 `from`)와 점 사이의 어긋남을 끄는 내내 유지한다: 그 자리에서의 값이 처음 높이이고, 점이 포인터로 튀지 않는다. 누른 자리로 재면 문턱의 4px이 곧 높이 16~40이라 첫 값이 두세 걸음을 건너뛴다 |
| 값 | 포인터 자리의 높이에서 가장 가까운 **10의 배수, 또는 그만큼 가깝거나 더 가까우면 처음 값**. 123에서 위로: 130, 140… 제자리로 돌아오면 정확히 123. 문턱을 넘긴 뒤 1px씩 움직이면 어느 크기의 그림에서든 120 → 130 → 140, 아래로는 120 → 110 → 100이다(0~180 도면에서 한 걸음이 화면의 1.0~2.5px) |
| 걸음 | **어느 도면에서든 10**(알린 대로 — `PLAN_SIDE_DRAG.step`). 방이 하나라도 기본 높이(180)이거나 방이 없는 도면(180이 기준이다)은 −40~230의 스물여덟 자리 이상이다. 낮은 도면은 자리가 준다: 입체 높이 100인 방·높이 60인 카메라는 −20~130의 열여섯 자리, 30인 방·20인 카메라는 −10~40의 여섯 자리(J7) |

### 4.2 순수 함수 — `mapPlanPreview.ts`에 더하는 것

```ts
/** The vertical scale of the side view: the level on the bottom line of the travel, and the levels from there up to the top line (at least 1). */
export type PlanSideScale = { low: number; span: number };
/** A drag of the lens: how far past the scale it started on it may go, in drawing units (a quarter of the travel at each end), and the step of its heights (10 on every map, as the owner was told). */
export const PLAN_SIDE_DRAG = { reach: 10, step: 10 } as const;
/** The scale the side view of this camera is drawn on: what planSideView works out when it is given none. */
export function planSideScale(map: BackgroundMap, camera: BackgroundCamera): PlanSideScale;
/** The y of a level on a scale, and the level at a y. Neither is held inside the box. */
export function planSideY(scale: PlanSideScale, level: number): number;
export function planSideLevel(scale: PlanSideScale, y: number): number;
/** The height a drag of the lens gives at `y`: a whole step, or `start` itself where that is as near or nearer. `start` when `y` is no number. */
export function planSideDragLevel(scale: PlanSideScale, y: number, start: number): number;
export function planSideView(map: BackgroundMap, camera: BackgroundCamera, scale: PlanSideScale = planSideScale(map, camera)): PlanSideView;
```

- `planSideScale`은 오늘 `planSideView` 안의 범위 셈(:240-254의 `elevation`·`low`·`high`·`spaces`·`span`)을 **그대로** 들어낸 것이다: `{ low, span: Math.max(high - low, 1) }`. `planSideView`는 그 눈금으로 `y`를 만들고, 카메라의 방(`camera.spaceId`의 도로 아닌 공간, 바닥과 꼭대기가 유한할 때)은 따로 읽는다. 화살표의 길이에 `Math.max(0, …)`을 씌운다(`along(lens, unit, Math.max(0, Math.min(box.arrow, reach - box.head)))`) — 잡아 둔 눈금 밖의 점에서도 화살표가 뒤집히지 않게.
- **두 인자로 부른 `planSideView`는 오늘과 정확히 같은 값을 돌려준다.** 결과 모양(`PlanSideView`)에 더하는 필드도 없다. 점이 여행 구간(22~62) 안이면 `Math.max(0, …)`은 아무것도 바꾸지 않는다(길이가 13 이상이다). `tests/backgroundMapPlanPreview.test.ts:237-336`은 한 글자도 고치지 않는다.

```ts
export function planSideY(scale: PlanSideScale, level: number): number {
  return PLAN_SIDE_VIEW.bottom - (level - scale.low) / scale.span * (PLAN_SIDE_VIEW.bottom - PLAN_SIDE_VIEW.top);
}
export function planSideLevel(scale: PlanSideScale, y: number): number {
  return scale.low + (PLAN_SIDE_VIEW.bottom - y) / (PLAN_SIDE_VIEW.bottom - PLAN_SIDE_VIEW.top) * scale.span;
}
export function planSideDragLevel(scale: PlanSideScale, y: number, start: number): number {
  const box = PLAN_SIDE_VIEW, limits = MAP_SPATIAL_LIMITS.elevation, step = PLAN_SIDE_DRAG.step;
  if (!Number.isFinite(y)) return start;
  const level = planSideLevel(scale, clamp(y, box.top - PLAN_SIDE_DRAG.reach, box.bottom + PLAN_SIDE_DRAG.reach));
  const snapped = clamp(Math.round(level / step) * step, limits.min, limits.max) + 0;
  return Math.abs(level - start) <= Math.abs(level - snapped) ? start : snapped;
}
```

`MAP_SPATIAL_LIMITS`는 이 파일이 이미 읽는 `./mapSpatial.ts`에서 가져온다(표의 `elevation` 줄과 같은 상수다 — 한계는 한 곳이다). 쓰는 함수는 3.1의 `setMapNodeNumber(map, id, 'elevation', 값)` 하나이고 카메라만을 위한 쓰기 함수는 만들지 않는다.

### 4.3 부품 — `BackgroundMapPlanSide.tsx` (새 파일)

옆 그림(`<figure>`)을 `CameraReadout`에서 이 파일로 옮긴다. 끌기의 코드는 모두 여기에 있다 — `BackgroundMapPlanPreview.tsx`에는 포인터 코드가 들어가지 않는다(앵커 34·39·45가 그 파일의 리스너·`}, []);`·`data-camera-color=`의 자리와 수를 본다).

```ts
export function BackgroundMapPlanSide({ map, camera, canEdit, scrub, label }: {
  map: BackgroundMap; camera: BackgroundCamera;
  /** Editing is allowed right now. The lens can be dragged while it is, and the camera is not locked. */
  canEdit: boolean; scrub: MapFieldScrub;
  /** What the picture says, for a reader: `옆에서 본 방향: 아래 45°, 높이 120`. */
  label: string }): JSX.Element
```

```tsx
  const draggable = canEdit && !camera.locked, box = PLAN_SIDE_VIEW;
  const frozen = useRef<PlanSideScale | null>(null), [, redraw] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useMapScrubPointer(scrub, !draggable);
  // The scale is held only while its drag still runs. The editor can end the drag by itself (Escape, a save starting): it draws this again then.
  // It is held in a ref, not in state: the first step of a drag is drawn at once, before a state set in the same pointer event would arrive, and for that one frame the picture would be fitted anew.
  const live = frozen.current && scrub.alive() ? frozen.current : null;
  const scale = live ?? planSideScale(map, camera), side = planSideView(map, camera, scale);
  const lift = (event: ReactPointerEvent<SVGCircleElement>) => press(event, {
    field: 'elevation', axis: 'y', immediate: false,
    open: (origin, from) => {
      // The scale is taken from the map the drag starts on, not from what was drawn: a field that was being typed in has just been committed.
      const node = origin.map.nodes.find(item => item.id === camera.id), held = planSideScale(origin.map, node?.type === 'camera' ? node : camera);
      const inverse = svgRef.current?.getScreenCTM()?.inverse();
      const toY = (clientY: number) => inverse ? new DOMPoint(0, clientY).matrixTransform(inverse).y : Number.NaN;
      frozen.current = held; redraw(turn => turn + 1);
      // The lens keeps the offset it has where the drag starts: there the value is the height it started from, at any size of the picture.
      return { scale: held, start: origin.start, toY, grab: planSideY(held, origin.start) - toY(from.clientY) };
    },
    read: (drag, at) => planSideDragLevel(drag.scale, drag.toY(at.clientY) + drag.grab, drag.start),
    close: () => { frozen.current = null; redraw(turn => turn + 1); },
  });
```

**잡아 둔 눈금은 state가 아니라 ref에 둔다(게이트 S에서 고쳤다).** 처음에는 `useState`였다. 그런데 끌기의 첫 걸음은 문서 저장소를 거쳐 **곧바로** 그려지고(동기), 같은 포인터 사건 안에서 놓은 state는 그다음 그리기에 닿는다 — 그 한 프레임 동안 그림이 다시 맞춘 눈금으로 그려져 방 상자와 점이 흔들렸다(앱 엔진에서 잰 것: 높이 260인 카메라를 한 번에 12px 끌면 방 상자의 y가 34.28 → 39.5 → 34.28. 카메라가 자기 눈금의 맨 위나 맨 아래 줄에 있을 때 — 모든 방보다 높은 카메라, 범위 밖에 놓은 뒤의 두 번째 끌기 — 만 생긴다). ref는 그리는 그 순간에 읽히므로 첫 걸음부터 잡아 둔 눈금으로 그려진다. `redraw`는 값이 변하지 않은 걸음(문턱을 막 넘긴 때)에도 끄는 모습(진한 고리, '높이'의 색)이 켜지고 꺼지게 하는 다시 그리기일 뿐이다.

그리는 것 — **`draggable`이 거짓이면 오늘의 `<figure>`와 요소·속성·순서가 같다**(BackgroundMapPlanPreview.tsx:119-131을 그대로 옮긴다. `fixed`·`pointList` 두 줄짜리 도우미는 이 파일에도 둔다):

| 요소(그리는 차례) | 보기 모드 · 잠긴 카메라 · 저장 중 | 끌 수 있을 때 더해지는 것 |
|---|---|---|
| `<figure className>` | `bmap-plan-side` | ` is-draggable`, 끄는 동안(`live`가 있을 때) ` is-lifting` |
| `<svg viewBox role="img" aria-label={label}>` | 오늘 그대로(+ `ref`) | — |
| 방 상자 · 바닥 줄 · 빗금 여섯 · 기둥 · 수평 줄 · 화살표와 머리 | 오늘 그대로 | — |
| 고리 `<circle className="bmap-plan-side-ring">` | **없음** | 점의 자리, `r={box.dot}` — 점과 같은 반지름에 **화면 픽셀 6px의 옅은 선**(4.4): 어느 크기의 그림에서든 점 둘레로 3px 나온 띠가 된다. 그림의 단위로 그린 고리는 가장 작은 그림에서 점의 테두리와 0.2px 떨어져 구분되지 않는다 |
| 위·아래 표시 `<path className="bmap-plan-side-marks">` | **없음** | 점 왼쪽 14단위에 작은 꺾쇠 둘(위·아래): `x0 = box.cameraX - 14`, `M x0-3 y-4 L x0 y-8 L x0+3 y-4 M x0-3 y+4 L x0 y+8 L x0+3 y+4`. 가장 작은 배치(캡션이 감춰지는 가로로 긴 칸)에서는 그리지 않는다(4.4) |
| 점 `<circle className="bmap-plan-dot">` | 오늘 그대로 | — |
| 누름 영역 `<circle className="bmap-plan-side-grab" onPointerDown={lift}>` | **없음** | 점의 자리, `r={box.dot}`, 맨 위에 그린다. 안에 `<title>위아래로 끌어 카메라 높이 바꾸기 · 끄는 도중 Esc는 취소</title>` |
| `<figcaption>` | `옆에서 본 방향` | 뒤에 `<span className="bmap-plan-side-tip"> · 점을 끌어 높이 조절</span>` — 한 줄이 `<figcaption>옆에서 본 방향{draggable && <span className="bmap-plan-side-tip"> · 점을 끌어 높이 조절</span>}</figcaption>`이다. 긴 글(10px에서 141px)은 가로로 긴 칸의 좁은 그림(160px 이하, 흔히 70~110px)에서 늘 말줄임표로 잘리므로 그 배치에서는 덧붙인 말을 감춘다(4.4) |

- 끌 수 있는 때: **`canEdit`이고 그 카메라가 잠기지 않았을 때** — 3D의 도구(선택·둘러보기·기호 놓기)와 무관하고, '이 카메라 시점으로 보기' 중에도 된다(속성의 칸과 같다). 평면 모드에는 옆 그림이 없다(지금과 같다).
- 손잡이는 **포인터 전용이다**: `tabIndex`가 없고 `role="slider"`도 없으며 SVG는 `role="img"` 그대로다. 까닭 — ① 같은 값의 키보드 조작이 이미 한 곳에 있다('카메라 높이' 칸: 적기, ↑↓로 1씩). 탭 정지를 하나 더 만들면 같은 값에 되돌리기를 합치는 규칙이 둘이 된다. ② 포커스를 받는 SVG 요소는 마우스로 눌러도 엔진의 고리가 그려진다(v1.135.1이 도면에서 끈 그 고리다). ③ 보기 모드와 같은 마크업을 유지한다. **키보드로는**: 속성의 '카메라 높이' 칸에서 고치면 옆 그림의 점과 '높이' 글자가 글자마다 따라온다.
- `CameraReadout`(BackgroundMapPlanPreview.tsx:114)은 `canEdit`·`scrub`을 받아 넘기고 `<figure>…</figure>` 자리에 `<BackgroundMapPlanSide map={map} camera={camera} canEdit={canEdit} scrub={scrub} label={`옆에서 본 방향: ${pitchText}, ${heightText}`} />`을 그린다. 요약 줄(`<div className="bmap-plan-readout is-camera" data-camera-color={camera.color} …`)은 그대로다. 부르는 곳(:235)은 `<CameraReadout key={selected.id} …/>`로 — 다른 카메라를 고르면 끌던 상태가 새로 시작한다. 그 파일의 import에서 `PLAN_SIDE_VIEW`·`planSideView`가 빠진다.

### 4.4 누름 영역 · 커서 · CSS

**누름 영역은 화면에서 지름 28px 이상이다** — 그림이 가장 작을 때도. 투명한 원(`r = 4.5`단위)에 **화면 픽셀로 24px인 선**을 준다(이 평면의 도형은 모두 `vector-effect:non-scaling-stroke`다, backgrounds-map-plan.css:21). 지름 = `2 × (4.5 × 배율 + 12)`px이라 선만으로 24px이다.

| 배치 | SVG 상자 | 배율(1단위의 px) | 점의 반지름 | 여행 구간 | 누름 영역의 지름 |
|---|---|---|---|---|---|
| 가로로 긴 칸(3:2 이상, 폭 300px 이상), 도면 높이가 가장 낮을 때(180px) — **가장 작다** | 약 64~69 × 38px(높이가 정한다) | 0.45 | 2.0px | 18.1px | **28.1px** |
| 글자 아래(보통), 가장 낮을 때 | 높이 54px | 0.64 | 2.9px | 25.7px | 29.8px |
| 글자 아래, 가장 높을 때 | 높이 96px | 1.14 | 5.1px | 45.7px | 34.3px |

(배율은 `min(폭/132, 높이/84)`. 가장 작은 칸: 도면 높이 180px(BackgroundMapPanels.tsx:35)에서 3D 칸이 73px이고, 보조 평면도의 머리줄 26px과 테두리를 뺀 요약 칸이 46px, 그 안쪽 여백 4px씩(backgrounds-map-plan.css:100)을 뺀 38px이 그림의 높이다 — 캡션은 그 높이에서 감춰진다(:102). 폭은 요약 칸의 44%(:96)라 높이보다 넉넉하다. **1440×900에서는 '속성 접기'를 눌러야 이 배치가 된다** — 속성 칸이 열려 있으면 보조 평면도가 300px보다 좁아(캔버스의 30%, backgrounds-map.css:387) 낮은 칸에서 그림이 감춰질 뿐이다.) 보조 평면도가 250px보다 낮고 가로로 길지도 않으면 그림 자체가 없다(지금과 같다) — 그때의 높이 조절은 칸이다.

**끌 수 있다는 표시**는 그림의 크기를 따라 줄어들면 안 된다. 고리는 화면 픽셀의 선이라 어느 배율에서든 점의 테두리 밖으로 2.25px 보인다. 위·아래 표시는 그림의 단위라 줄어든다: 보통 배치의 가장 작은 그림(높이 54px)에서 3.9×2.6px이고 고리와 0.9px 떨어지며, 가장 작은 배치(38px)에서는 2.7×1.8px로 뭉개지고 고리와 겹친다 — 그 배치에서는 그리지 않고 고리·커서·풍선이 남는다.

`backgrounds-map-plan.css`, **마지막 규칙(`.bmap-plan-preview [data-camera-color] {`, :108)의 주석 줄 앞에** 둔다(그 주석은 자기 규칙에 붙은 채로 남는다). 색 이름도 호박색 값도 적지 않는다 — 카메라 변수만 쓴다(색 있는 카메라는 요약 칸의 `data-camera-color`가 그 변수를 바꿔 준다).

```css
/* The lens of the side view while its camera can be edited: a wider area takes the press, and a halo with a small up-down mark says it can be dragged. The halo is in screen pixels, so it shows at any size of the picture. Painted from the camera variables of this plan. Nothing here moves by itself. */
.bmap-plan-side-grab { fill:transparent; stroke:transparent; stroke-width:24px; pointer-events:all; cursor:ns-resize; touch-action:none; }
/* The engine reads touch-action from boxes only, never from a shape inside a picture: while the lens can be dragged the picture as a whole takes it, so a touch or a pen that starts on the lens is not taken for a scroll halfway. */
.bmap-plan-side.is-draggable>svg { touch-action:none; }
.bmap-plan-side-ring { fill:none; stroke:var(--bmap-plan-cam-line); stroke-opacity:.35; stroke-width:6px; pointer-events:none; }
.bmap-plan-side-marks { fill:none; stroke:var(--bmap-plan-cam-line); stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.bmap-plan-side.is-lifting .bmap-plan-side-ring { stroke-opacity:.7; }
/* The height in the summary is the number being dragged: its colour says so. Same size, same weight. */
.bmap-plan-readout:has(.bmap-plan-side.is-lifting) .is-elevation strong { color:var(--bmap-plan-cam-line); }
```

그리고 가로로 긴 칸의 두 컨테이너 블록에 한 줄씩 더한다(그 블록의 다른 줄은 그대로): `@container bmap-plan (min-aspect-ratio: 3/2) and (min-width: 300px) {`(:88)에 `.bmap-plan-side-tip { display:none; }`, 캡션을 감추는 `… and (max-height: 159px) {`(:99)에 `.bmap-plan-side-marks { display:none; }`.

커서는 누름 영역 위에서 `ns-resize`이고 끌 수 없을 때는 기본이다(누름 영역이 없다). 전환·애니메이션은 없다.

### 4.5 끄는 동안과 끝

| 것 | 일어나는 일 |
|---|---|
| 누르기만 함, 또는 옆으로만 움직임 | 아무것도 바뀌지 않는다. 되돌리기 단계도 띠의 수도 그대로다 |
| 위아래로 4px을 넘김 | 문서의 제스처가 시작되고 눈금이 얼어 붙는다. 치던 칸이 있으면 그 값이 먼저 확정된다(3.2) |
| 걸음마다 | 요약의 **'높이 N'**(끄는 동안 카메라 색), 옆 그림의 점·기둥·화살표, 3D 화면의 카메라, 속성의 **'카메라 높이' 칸**이 함께 바뀐다 — 모두 같은 초안을 읽는다. 바뀌는 것은 그 카메라의 `elevation`뿐이다 |
| '이 카메라 시점으로 보기' 중 | 3D 화면의 구도가 걸음마다 바뀐다(3D는 매 프레임 초안에서 자세를 읽는다, 2.3) |
| 놓음 | 되돌리기 **한 단계**, 띠의 수 **+1**. 처음 높이에서 놓으면 단계도 수도 그대로이고, 높이 키가 없던 카메라에는 키가 생기지 않는다 |
| 범위 밖에서 놓음 | 그림이 다시 맞춰진다(카메라가 맨 위나 맨 아래 줄, 방이 작아진다). 다음 끌기는 거기서 4분의 1을 더 간다 |
| Esc | 처음 높이, 단계 없음, 띠 그대로, 손에 든 도구 그대로. 고리가 곧바로 평소 진하기로 돌아오고 눈금이 풀린다(포인터를 움직이지 않아도 — `live`). 그 누름의 남은 움직임과 놓음은 아무것도 하지 않는다 |
| `pointercancel` · 창이 포커스를 잃음 · 캡처를 잃음 / 저장 시작 · 편집 권한을 잃음 · 다른 도면 · 평면으로 전환 · 다른 노드 선택 · 보조 평면도 접기 | 같다 — 앞의 셋은 훅이 취소하고, 뒤의 것들은 편집기가 취소하거나 부품이 내려가며 훅이 취소한다 |
| 평면에서 여러 개가 골라져 있음 | 3D가 다루는 그 카메라 하나만 바뀐다. 묶음은 그대로다 |
| Shift · Alt | 아무 뜻도 없다(J8) |

### 4.6 보조 평면도가 받는 것 — 앵커 23

편집기의 태그는 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} />`다. 앞의 세 속성은 글자와 차례가 그대로이고 둘을 **뒤에** 붙인다(앵커 23은 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode}`가 들어 있는지를 본다 — 고치지 않는다). `mapCanvas.ts`와 `BackgroundMapPlanPreview.tsx`에는 여전히 `selectedIds`라는 글자가 없다. `Map3DProps`와 3D 화면에 주는 네 콜백은 그대로다.

## 5. (e) 도면 삭제

### 5.1 계획 — `mapDelete.ts` (새 파일)

지우는 일은 순수 함수 하나가 **명령의 차례로** 풀어 준다. 편집기는 그 차례를 보낼 뿐이다. 창이 보이는 숫자와 문장도 같은 계획에서 나온다.

```ts
import type { BackgroundCommand, BackgroundMap, BackgroundSnapshot } from './types.ts';
import { validateBackgroundEntity } from './domain.ts';
import { mapDraftChanged } from './mapDocument.ts';
import type { MapDraft } from './mapDocument.ts';
import type { MapSaveCommand } from './mapWorkflow.ts';
import { cleanIpcErrorMessage } from '../../utils/ipcErrorMessage.ts';
export type MapDeleteMode = 'keep-children' | 'with-children';
export type MapDeleteCommand = Extract<BackgroundCommand, { type: 'delete' }>;
export type MapDeletePlan = {
  /** The map to delete, as the library holds it. Null: the library has no such map (any more); every list below is empty, and nothing is refused. */
  target: BackgroundMap | null; parent: BackgroundMap | null;
  /** Names of the parent's spaces that open the target. */
  entrances: string[];
  /** The maps right under the target; how many of them have maps under them; every map under the target, children before their parent. */
  children: BackgroundMap[]; nested: number; descendants: BackgroundMap[];
  /** The one save that comes first (null: nothing has to be saved). */
  save: MapSaveCommand | null;
  /** How many spaces open a map of `removed`: the save takes every one of them off. Not the spaces of the target that open children it keeps. */
  links: number;
  /** Ids of the maps that are deleted, in the order of deletion: the target last. */
  removed: string[];
  /** The commands, in order: `save` when there is one, then one delete for each id of `removed`. */
  steps: Array<MapSaveCommand | MapDeleteCommand>;
  /** Names of the maps that stay and whose unsaved edits the save step saves along, in the order of the save step. Not those of `unsavable`. */
  savedAlong: string[];
  /** Unsaved edits that go with a deleted map: the target's own, and the names of the maps under it that have some, in the order of `removed`. */
  lostEdits: { own: boolean; below: string[] };
  /** Names of the maps of the save step whose unsaved edits stand on a revision the library has left, in the order of the save step. */
  outdated: string[];
  /** Names of the maps of the save step whose unsaved edits the library would refuse to save (an emptied name of an object), in the order of the save step. */
  unsavable: string[];
  /** Why the plan must not be carried out. Null: it may. The plan is built in full either way, `save` and `steps` included. */
  refusal: 'rights' | 'outdated' | 'unsavable' | 'too-many' | null;
};
export const MAP_DELETE_SAVE_LIMIT = 100;
export function planMapDelete(snapshot: BackgroundSnapshot, drafts: Readonly<Record<string, MapDraft>>, mapId: string, mode: MapDeleteMode): MapDeletePlan;
export type MapDeleteText = { lead: string[]; keep: [string, string] | null; all: [string, string] | null; notes: string[]; refusal: string | null; confirm: string };
/** The words of the dialog for a plan. Null when the map is gone. */
export function mapDeleteText(plan: MapDeletePlan, mode: MapDeleteMode): MapDeleteText | null;
/** What a run that stopped has done, read from the library as it is now. */
export function mapDeleteStopText(pressed: MapDeletePlan, snapshot: BackgroundSnapshot): string;
/** Why a run stopped, as the dialog says it: never the wrapper Electron puts round what the main process throws, never an English sentence of the network. */
export function mapDeleteCauseText(cause: unknown): string;
```

- **구조는 저장된 라이브러리(`snapshot.maps`)에서만 읽는다**: 누가 위 도면이고, 누가 하위 도면이며, 어느 공간이 누구를 여는가. 두 검사(domain.ts, SQL)가 보는 것이 그것이다. 초안의 `parentId`나 `childMapId`는 구조를 정하지 않는다.
- **"저장 안 한 변경이 있는 초안"**은 `mapDraftChanged(drafts[id])`다(띠·저장 버튼과 같은 정의, mapDocument.ts:268-270). 깨끗한 초안은 없는 것으로 친다 — 값이 저장된 것과 같거나(따라가기가 맞춰 둔다) 낡았을 뿐이다.
- 아래 도면은 `parentId`를 따라 모으고 **하위가 먼저, 위가 나중**인 차례로 둔다(`descendants`): 하위 도면을 `snapshot.maps`의 차례로 돌며, 도면마다 그 아래 도면을 먼저 적고 자신을 적는다(깊이 우선). 같은 id를 두 번 밟지 않는다. `children`은 `snapshot.maps`의 차례다.
- 계획에 적는 이름은 모두 저장된 라이브러리의 이름이다. 지울 도면 자신인가 그 아래 도면인가는 이름이 아니라 자리로 가린다 — 하위 도면의 이름이 위 도면과 같을 수 있다(`lostEdits`의 `own`).

### 5.2 무엇을 쓰고 어떤 차례로 지우는가

T = 지울 도면, P = T의 위 도면(없을 수 있다), C = T의 하위 도면들, S = T와 T의 아래 도면 전부.

| | `'keep-children'` — 하위 도면은 남기기 | `'with-children'` — 하위 도면도 함께 삭제 |
|---|---|---|
| **저장 단계에 드는 도면**(저장된 값이 그 변경을 필요로 할 때만) | ① P — T를 여는 공간이 있으면, 그 연결을 `null`로 ② T — 하위 도면을 여는 공간이 있으면, 그 연결을 `null`로 ③ C의 모든 도면 — `parentId`를 T의 `parentId`로(`null`이면 최상위 도면이 된다) | ① P — 왼쪽과 같다 ② S의 도면 가운데 **S의 도면을 여는 공간이 있는 것 모두** — 그 연결을 `null`로 |
| 저장 단계가 없는 때 | P에 연결이 없고 T에 하위 도면이 없을 때 | P에 연결이 없고 S 안에 연결이 하나도 없을 때 |
| **지우는 차례**(`removed`) | T 하나 | `descendants`의 차례(하위가 먼저) 그대로, **T가 마지막** |
| 명령 수 | 1 또는 2 | S의 도면 수 + (저장 단계가 있으면 1) |
| 남는 것 | C는 T가 있던 자리(P 바로 아래, 또는 최상위)에. C의 아래 도면과 C의 공간이 그 아래 도면을 여는 연결은 **그대로**. P에는 C를 여는 공간이 없다(목록과 '하위 도면'에는 보인다) | P와 그 밖의 도면 |

**저장 단계 안의 차례.** P, T, 그다음 나머지를 `snapshot.maps`의 차례로(각각 저장 단계에 들 때만). 본관 남기기 → 학교·본관·2층·지하, 본관 함께 삭제 → 학교·본관·2층.

**저장 단계에 쓰는 값.** 그 도면에 저장 안 한 변경이 있는 초안이 있고 그 초안의 `baseRevision`이 저장된 버전과 같으면 **초안의 값**에 위의 변경을 얹는다. 그 밖에는 저장된 값에 얹는다. **연결을 푸는 것은 쓰는 값의 공간을 본다**: 그 값(초안이든 저장된 값이든)의 공간 가운데 `childMapId`가 풀 도면(남기기: T와 C · 함께 삭제: S)인 것을 **모두** `null`로 한다 — 저장된 공간의 id로 고르지 않는다(초안이 그 공간을 지웠으면 풀 것이 없고, 그 값 그대로 쓴다). 초안에 저장 안 한 변경이 있는데 버전이 다르면(다른 곳에서 먼저 바뀌었다) 그 도면의 이름을 `outdated`에 넣는다 — 남는 도면이든 지울 도면이든. **`expectedRevision`은 늘 저장된 버전이다** — 초안의 `baseRevision`이 아니다(`saveMapChanges`와 다른 점이다, mapWorkflow.ts:47. 깨끗한 초안은 삭제 창이 열린 동안 라이브러리를 따라가지 못해 낡아 있을 수 있고(6.1), 그 버전으로 보내면 창이 아무 말도 하지 않은 도면에서 거절된다). **초안의 값을 쓰는 도면은 보내기 전에 본다**: 쓸 값(위의 변경을 얹은 것)이 `validateBackgroundEntity('map', …)`에서 던지면 그 도면의 이름을 `unsavable`에 넣고 `savedAlong`에는 넣지 않는다. 속성의 '이름' 칸은 빈 글자도 초안에 넣는데(:1195) 저장 검사는 오브젝트 이름이 비면 거절한다(domain.ts:58) — 그대로 보내면 저장소가 첫 명령을 보내기도 전에 도면 이름 없는 문장('오브젝트 이름 형식 또는 길이를 확인해 주세요.')으로 거절하고, 다시 눌러도 매번 같다. 저장된 값은 저장될 때 그 검사를 지났으므로 보지 않는다.

**`links`.** 저장된 라이브러리에서 `childMapId`가 `removed`의 도면인 공간의 수다 — 남기기면 P가 T를 여는 연결(`entrances`의 수), 함께 삭제면 그것과 S 안의 연결 전부다. 남기기에서 T가 하위 도면을 열던 연결은 세지 않는다: 그것이 풀린 것은 "하위 도면을 위로 옮겼다"가 말한다(5.3). 본관 남기기 → 1, 본관 함께 삭제 → 3, 학교 남기기 → 0.

**버전.** 저장 단계가 쓴 도면은 버전이 1 오른다(domain.ts:146 `revision:(expectedRevision??0)+1`, SQL :270-271). 그래서 삭제 명령의 `expectedRevision`은 **저장된 버전, 저장 단계에 든 도면이면 그 +1**이다. 계획은 누르는 순간의 라이브러리에서 통째로 만들어지고, 사이에 다른 곳에서 바뀐 도면이 있으면 그 명령이 버전 검사(domain.ts:144, :152 · SQL :263-268)에 걸려 **거기서 멈춘다.**

**모든 중간 상태가 두 검사를 지난다.** 지켜야 하는 것은 둘이다 — (가) 살아 있는 모든 도면의 `parentId`가 살아 있는 도면을 따라 `null`까지 닿는다(domain.ts:127의 `requireValue(parents.has(cursor), …)`와 순환 검사 · SQL :153, :155), (나) 모든 공간의 `childMapId`는 `null`이거나 **그 공간의 도면을 부모로 둔 살아 있는 도면**이다(domain.ts:131의 `requireValue(!n.childMapId||maps.get(n.childMapId)?.parentId===map.id, …)` · SQL :166). 시작 상태는 (가)(나)를 지킨다(저장된 라이브러리다).

| 명령 뒤 | (가) 부모 사슬 | (나) 연결 |
|---|---|---|
| 남기기의 저장 단계 | C는 T의 부모였던 P(또는 `null`)를 부모로 갖는다 — 살아 있고, P는 T의 조상이라 C의 아래에 있지 않다(순환이 없다). 다른 사슬은 그대로다 | T를 열 수 있는 것은 (나)에 따라 P의 공간뿐이었고 모두 `null`이 됐다. C를 열 수 있는 것은 T의 공간뿐이었고 모두 `null`이 됐다. C가 아래 도면을 여는 연결은 그 도면들의 부모가 여전히 C라서 맞다 |
| 남기기의 삭제(T) | T를 부모로 둔 도면이 없다(C는 옮겨졌다) | T를 여는 공간이 없다 |
| 함께 삭제의 저장 단계 | `parentId`는 하나도 바뀌지 않는다 | S의 도면을 여는 공간은 P와 S 안에만 있었고(가·나) 모두 `null`이 됐다 |
| 함께 삭제의 삭제 하나(S의 X) | X의 하위 도면은 앞에서 이미 지워졌다(하위가 먼저다) — X를 부모로 둔 도면이 없다 | X를 여는 공간이 없다(저장 단계가 풀었다) |

그리고 엔티티 하나하나의 검사(`validateBackgroundEntity`, SQL의 `background_library_validate_entity`)는 `childMapId: null`과 `parentId`의 다른 id·`null`을 모두 받는다(domain.ts:55, :62). 11절: 깊이 3의 가지에서 두 방식의 **모든 앞부분**을 진짜 `applyBackgroundCommand`로 돌려 통과를 확인했다.

**한계.** `save-maps`는 도면 1~100개, 명령 28,000,000바이트까지다(domain.ts:102, :40-45 · SQL :222, :219).

| 누르기 전에 거절하는 것(`refusal`) | 문장(창 안, 지우는 버튼은 꺼진다) |
|---|---|
| `'rights'` — `snapshot.canManage`가 거짓 | `이 계정으로는 도면을 지울 수 없어요.` |
| `'outdated'` — 저장 단계에 드는 도면에 저장 안 한 변경이 있는데 그 도면이 다른 곳에서 먼저 바뀌었다 | `‘이름’, ‘이름’ 도면이 다른 곳에서 먼저 바뀌었어요. 그 도면의 편집을 끝낸 뒤 다시 삭제해 주세요.` |
| `'unsavable'` — 저장 단계에서 함께 저장할 변경(초안의 값)이 저장할 수 없는 값이다(J16) | `‘이름’ 도면에 저장할 수 없는 변경이 있어요. 그 도면에서 고치거나 편집을 끝낸 뒤 다시 삭제해 주세요.` |
| `'too-many'` — 저장 단계의 도면이 100개를 넘는다 | `함께 저장해야 하는 도면이 100개를 넘어서 한 번에 처리할 수 없어요. 하위 도면을 먼저 나누어 정리해 주세요.` |

차례는 위에서 아래다(권한 → 낡은 초안 → 저장할 수 없는 변경 → 개수). 거절이 있어도 계획은 통째로 만든다(`save`·`steps`까지 — `runMapDelete`가 거절을 보고 돌아간다). 바이트 한계는 미리 재지 않는다: 넘으면 첫 명령(저장 단계)이 저장소의 사전 검사에서 지금의 문장('배경 요청이 너무 큽니다. 도면을 나누어 저장해 주세요.')으로 거절되고 아무것도 쓰이지 않는다 — 밑그림을 자료째 쥔 미리보기에서만 생길 수 있다. 삭제 명령의 수에는 한계가 없다(하나씩 나간다).

**원자적이지 않다.** 명령 사이에 끊기면 일부만 된 상태가 남는다 — 그 상태도 위의 표대로 온전한 라이브러리이고, 다시 누르면 **지금의 라이브러리에서 계획을 새로 만든다**: 풀린 연결·옮겨진 도면·지워진 도면은 새 계획에 들지 않는다. 어느 앞부분에서 끊겼다 이어도 끝난 모습은 끊기지 않은 것과 같고, 어떤 도면도 두 번 쓰이지 않는다(11절에서 확인).

### 5.3 문구 — `mapDeleteText` · `mapDeleteStopText` · `mapDeleteCauseText`

세 함수가 돌려주는 글자는 모두 `mapDelete.ts`에 있고 테스트가 글자 그대로 본다(제목·`삭제 중…`·`돌아가기`·`닫기`·'이미 삭제됐어요'는 창 파일에 둔다). `N` = 하위 도면 수, `M` = 그 가운데 아래에 도면이 더 있는 수(`nested`), `D` = 아래 도면 전부의 수. 이름 여럿은 `‘가’, ‘나’`로 잇고, 이름이 여럿이어도 문장은 하나다. 낱말은 편집기의 다른 곳과 맞춘다: 위 도면이 없는 도면은 **최상위 도면**(:1279, :1289), 도면에 올린 그림은 **도면 밑그림**(:1297).

| 경우 | `lead`(차례대로 한 문단씩) |
|---|---|
| 늘 | `‘이름’ 도면을 지워요. 지운 도면은 되돌릴 수 없어요.` |
| 늘 — 밑그림이 없는 도면(`target.imageUrl`이 빈 글자) | `도면에 놓은 공간·카메라·기호가 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.` |
| 늘 — 밑그림이 있는 도면 | `도면에 놓은 공간·카메라·기호와 도면 밑그림이 함께 없어져요. 장소와 배경 이미지, 에피소드별 사용 기록은 그대로 남아요.`(밑그림은 도면과 함께 간다 — "그림은 남는다"로 읽히면 안 된다) |
| 위 도면의 공간이 이 도면을 연다 | `‘위 도면’ 도면의 ‘공간’ 공간에서 이 도면을 열던 연결은 함께 풀려요.`(공간이 둘이면 `‘본관’, ‘뒷문’ 공간에서`) |
| 하위 도면이 있다(`M`이 0) | `이 도면 아래에 하위 도면이 N개 있어요.` |
| 하위 도면이 있고 그 아래에도 있다 | `이 도면 아래에 하위 도면이 N개 있어요. 그중 M개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 D개예요.` |

| 것 | 글 |
|---|---|
| 제목 | `도면 삭제` |
| 선택 하나(기본) | **`하위 도면은 남기기`** — `하위 도면 N개가 ‘위 도면’ 바로 아래로 올라가요.`(위 도면이 없으면 `하위 도면 N개가 최상위 도면이 돼요.`) + (`M`이 있으면 ` 그 아래 도면들은 그대로 따라가요.`) + (**지울 도면의 공간 가운데 하위 도면을 여는 것이 있을 때만** — 저장된 `target.nodes`와 `children`에서 읽는다 — ` 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.`). '＋ 하위 도면 만들기'로 만든 하위 도면에는 그런 연결이 없다(:1271, :513-516) — 없는 연결이 없어진다고 말하지 않는다 |
| 선택 둘 | **`하위 도면도 함께 삭제`** — `이 도면과 아래 도면 D개를 모두 지워요.` |
| 지우는 버튼 | 하위 도면이 없으면 `도면 삭제` · 남기기면 `이 도면 1개만 삭제` · 함께 삭제면 `도면 (D+1)개 모두 삭제` |
| 도는 동안의 지우는 버튼 | `삭제 중… k/N`(지운 도면 수 / 지울 도면 수 — 버튼에 적혀 있던 그 수다. 저장 단계가 도는 동안은 `0/N`). 지울 도면이 하나면 `삭제 중…` |
| 다른 버튼 | `돌아가기` · (없어진 도면의 창) `닫기` |
| `notes` — 이 차례로, 있는 것만 | ① `savedAlong`: `‘이름’ 도면의 저장 안 한 변경은 이번에 함께 저장돼요.` ② `lostEdits.own`: `이 도면의 저장 안 한 변경은 함께 사라져요.` ③ `lostEdits.below`: `아래 도면 ‘이름’의 저장 안 한 변경도 함께 사라져요.`(몇 단계 아래든 든다 — '하위 도면'은 바로 아래 한 단계의 말이다) |
| 도면이 이미 없다 | `‘이름’ 도면은 이미 삭제됐어요.` |

네 경우의 창(미리보기의 기본 자료로):

| 지우는 도면 | 창이 보이는 것 |
|---|---|
| 하위도 연결도 없는 도면 | 두 문단. 선택 없음. `돌아가기` · `도면 삭제` |
| 2-1 교실(연결만 있다) | 두 문단 + `‘2층’ 도면의 ‘2-1 교실’ 공간에서 이 도면을 열던 연결은 함께 풀려요.` 선택 없음. `도면 삭제` |
| 2층(하위 1개) | + 연결 문단 + `이 도면 아래에 하위 도면이 1개 있어요.` 선택 둘(남기기가 골라져 있다). `이 도면 1개만 삭제` ↔ `도면 2개 모두 삭제` |
| 본관(하위의 하위가 있다) | + `이 도면 아래에 하위 도면이 1개 있어요. 그중 1개는 그 아래에 도면이 더 있어서, 아래 도면은 모두 2개예요.` 선택 둘. `이 도면 1개만 삭제` ↔ `도면 3개 모두 삭제` |

**멈춘 문장 — `mapDeleteStopText(pressed, snapshot)`.** 누른 계획과 지금의 라이브러리에서 사실만 읽는다(센 횟수가 아니다 — 답을 잃은 삭제도 된 것으로 읽힌다). "지금의 라이브러리"는 이 PC가 **마지막으로 읽은** 것이다: 명령이 실패하면 저장소가 곧바로 다시 읽고(명령이 도는 동안 변경 신호가 왔으면 한 번 더 — useBackgroundStore.ts:26, :73), 그 읽기를 모두 잃으면(인터넷이 끊긴 흔한 꼴) 그 명령 앞의 모습이 남는다(:59-61). 그래서 "된 것"은 라이브러리에서 본 것만 말하고, "안 됐다"는 단정하지 않는다 — 읽기가 다시 되는 때(15초마다, 그리고 창에 포커스가 돌아올 때 — BackgroundLibraryView.tsx:63-74)에 창이 스스로 다시 그려진다.

| 사실 | 문장 조각 |
|---|---|
| 지울 도면을 여는 연결이 있었고(`pressed.links > 0`), 지금 `pressed.removed`의 도면을 여는 공간이 하나도 없다 | `지울 도면을 열던 공간의 연결은 풀었어요.` |
| 남기기였고(`pressed.removed`가 하나), `pressed.children` 가운데 **지금도 있고** 부모가 그 도면이 아닌 것이 k개(1 이상 — 그사이 다른 곳에서 지워진 하위 도면은 세지 않는다) | `하위 도면 k개는 위로 옮겼어요.` |
| `pressed.removed` 가운데 지금 없는 것이 k개(1 이상) | `도면 (전체)개 가운데 k개를 지웠어요.` |
| 위의 어느 것도 아니다 | **`아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.`**(이 문장으로 끝난다. 가장 흔한 멈춤이다 — 첫 명령이 거절됐고 라이브러리는 이미 다시 읽혔다. 까닭은 그 위의 문장이 말하는데 저장소의 그 문장은 "새로고침 후 다시 저장"을 권하므로, 여기서 할 일 — 다시 누르기 — 은 이 문장이 말한다. 다시 누르는 것은 어느 경우에도 안전하다, 10.3) |
| 하나라도 있다 | 조각들을 빈칸으로 잇고 끝에 ` 남은 것은 아래에 다시 적었어요. 다시 누르면 남은 것만 이어서 처리해요.` |

지울 도면을 여는 공간이 없는 남기기(최상위 도면, 또는 `parentId`로만 달린 도면 — 미리보기의 학교가 그렇다)는 `links`가 0이라 첫 조각이 나오지 않는다: 아무것도 하기 전에는 "아직 바뀐 것이 보이지 않아요…"이고 저장 단계 뒤에는 "하위 도면 k개는 위로 옮겼어요"뿐이다.

**멈춘 까닭 — `mapDeleteCauseText(cause)`.** 설치된 앱에서 메인 프로세스가 던진 것은 Electron의 껍데기를 쓰고 온다(`Error invoking remote method 'background:execute': Error: …`, `src/utils/ipcErrorMessage.ts:1-6`. 서버의 거절도, 끊긴 연결의 `TypeError: fetch failed`도 — `electron/backgroundStore.ts:29`). 편집기의 `message()`(:79)는 그 글자를 그대로 낸다. 새 창의 빨간 첫 줄에 채널 이름이 든 영어가 뜨면 안 되므로, 이 창만 다듬는다: `cleanIpcErrorMessage(cause, '')`로 껍데기를 벗기고, 남은 글에 한글이 있으면(`/[가-힣]/` — 저장소·메인·서버가 쓴 문장은 모두 한글이다) 그대로, 없으면(연결 오류, 빈 글, `Error`가 아닌 것) **`서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.`** 미리보기에는 IPC가 없어 껍데기가 생기지 않는다 — 7.6의 끊김 넣기가 껍데기를 쓴 꼴로 던져 본다.

### 5.4 창 — `BackgroundMapDeleteDialog.tsx` (새 파일)

받은 것만 그린다. `BackgroundModal`(제목 `도면 삭제`) 안에 있고 **폼이 아니다**(Enter가 저절로 지우지 않는다).

```ts
export function BackgroundMapDeleteDialog({ name, plan, mode, progress, stopped, error, disabled, onMode, onClose, onConfirm }: {
  /** `name`: the name the dialog was opened with, said once the map is gone. `progress`: a run is in progress, maps deleted of how many. */
  name: string; plan: MapDeletePlan; mode: MapDeleteMode; progress: { done: number; total: number } | null;
  /** What a run that stopped has done. Null: none has stopped. */
  stopped: string | null; error: string; disabled: boolean;
  onMode(mode: MapDeleteMode): void; onClose(): void; onConfirm(): void }): JSX.Element
```

| 모습 | 조건 | 그리는 것 |
|---|---|---|
| **도는 중** | `progress`가 있다(낙관 스냅샷에서 도면이 이미 없어 보여도 이 모습이다) | **누른 때의 모습 그대로**, 선택과 두 버튼이 꺼지고 지우는 버튼이 `삭제 중… k/N`(5.3). 글자는 멈춰 있다: 창은 `progress`가 없을 때의 마지막 `mapDeleteText`를 ref에 쥐고(`if (live && !progress) kept.current = live;` — 렌더에서 쓰는 ref의 선례는 편집기 :296-297) 도는 동안 그것을 그린다. 계획은 명령마다 낙관 스냅샷에서 다시 만들어져, 그대로 그리면 하위 도면의 수와 선택이 실행 도중에 바뀌고 사라진다 |
| **없어짐** | `progress`가 없고 `plan.target`이 없다 | `‘이름’ 도면은 이미 삭제됐어요.`와 `닫기`(`type="button"`, `className="bg-button"`, `data-autofocus`, `ref={back}`, `onClick={onClose}`) 하나. 오류 글자는 보이지 않는다. 보낼 수 있는 명령이 없다 |
| **묻는 중**(멈춘 뒤 포함) | 그 밖 | 위에서부터: 멈춘 까닭(`<p className="bg-error" role="alert">` — 편집기가 `mapDeleteCauseText`로 다듬어 넘긴 `error`, 5.3) · 멈춘 문장(`<p className="bmap-move-note" role="status">`) · `lead`의 문단들(`.bmap-confirm-text`) · 선택 둘(하위 도면이 있을 때) · `notes`(`.bmap-hint`) · 거절 문장(`<p className="bg-error" role="alert">`) · 버튼 줄 |

- **선택**: `<fieldset className="bmap-delete-choices" disabled={!!progress || disabled}>`(이름은 `<legend className="sr-only">하위 도면을 어떻게 할까요</legend>`) 안의 `<label className="bmap-delete-choice"><input type="radio" name={group} checked={…} onChange={() => onMode(…)} /><span><strong>제목</strong>설명</span></label>` 둘, 세로로(`group`은 `useId()`). 기본은 남기기다. 창을 열 때마다 남기기로 시작한다(기억하지 않는다). 멈춘 뒤에 다른 쪽으로 바꿔 이어 가도 된다(계획은 지금의 라이브러리에서 새로 만들어진다).
- **버튼 줄**: `<div className="bmap-modal-actions">`(두 버튼은 앱 창의 가장 좁은 폭에서도 한 줄에 선다 — 줄바꿈 규칙을 두지 않는다) — `돌아가기`(`type="button"`, `className="bg-button"`, `data-autofocus`, `ref={back}`, `disabled={!!progress}`, `onClick={onClose}`) · 지우는 버튼(`type="button"`, `className="bg-button bmap-danger"`, `disabled={!!progress || disabled || !!text.refusal}`, `onClick={onConfirm}`, 글자는 도는 동안 `삭제 중… ${progress.done}/${progress.total}`(`progress.total`이 1이면 `삭제 중…`뿐), 아니면 `text.confirm`). `text`는 `mapDeleteText(plan, mode)`이고, 도는 동안에는 위의 쥐어 둔 것이다.
- **포커스와 키**: 열리면 포커스는 `돌아가기`다 — Enter는 돌아간다(뜬 뒤 0.5초가 지나서 — 아래). Esc와 ×는 `onClose`. 방향키·Space가 두 선택을 오간다(라디오의 기본). Tab 순서는 × → 선택 → 돌아가기 → 지우는 버튼. 멈춘 뒤에는 포커스를 `돌아가기`로, '없어짐' 모습이 되면 `닫기`로 돌려놓는다(`progress`가 없어지거나 도면이 없어질 때의 effect — 도는 동안 버튼이 꺼지며, 또는 `돌아가기`가 사라지며 포커스가 창에서 떨어진다). 닫히면 `BackgroundModal`이 포커스를 열기 전의 요소('도면 설정' 버튼)로 돌려준다(지금의 확인 창과 같다).
- **뜬 뒤 0.5초 동안은 누름을 받지 않는다.** 설정 창이 사라지고 이 창이 같은 자리에 뜨므로, '도면 삭제'를 더블클릭하면 둘째 클릭이 선택이나 버튼에 닿는다. 여는 함수가 `swallowSecondClick()`을 부른다(5.6 — v1.135.0의 그 함수, 창 단위·캡처 단계, `SECOND_CLICK_MS`. 앵커 52가 그 본문을 줄 단위로 고정한다 — 고치지 않는다). 그 함수는 `click` 사건도 멈추므로 **그 0.5초 동안은 키보드로 누른 것도 듣지 않는다**: `돌아가기`의 Enter·Space는 아무 일도 하지 않고, 방향키로 옮긴 선택은 되돌아간다(둘 다 클릭 사건을 거친다). **Esc는 바로 듣는다**(`cancel` 사건으로 온다). 지우는 쪽으로 새는 길은 없다. **실행이 멈춘 때에도 같은 0.5초를 둔다**(`runMapDelete`의 `catch`가 같은 함수를 부른다): 멈추는 순간 지우는 버튼과 두 선택이 포인터 밑에서 다시 켜지고, 위에 문단 둘이 생기며 버튼 줄이 내려간다. 지우는 버튼의 더블클릭에서 첫 클릭이 곧바로 거절되면(저장소는 보내기 전에도 거절한다 — useBackgroundStore.ts:45-48) 둘째 클릭이 읽지도 않은 새 계획을 보내거나, 밀려 내려온 다른 선택에 닿아 남기기를 함께 삭제로 바꾼다. 다른 곳의 삭제로 창이 '없어짐'으로 바뀔 때는 두지 않는다 — 그때 닿는 것은 `닫기`뿐이고 도면은 이미 없다.
- **창이 떠 있는 동안 누른 키는 뒤 화면에 닿지 않는다.** Tab이 마지막 버튼을 지나면 포커스가 `body`에 놓이고 그때의 키는 뒤 화면의 창 단위 단축키에 닿는다(lessons 2026-10-11). 버튼에 포커스가 있을 때도 같다: 앱의 전역 단축키(Ctrl+1~8로 화면 바꾸기, Ctrl+R — `src/hooks/useGlobalShortcuts.ts:13-29`, `window`의 버블 단계 `:166`)는 포커스가 글자 칸이 아니면 어디서 온 키든 듣는다. 그 단축키가 화면을 바꾸면 배경 저장소가 내려가(`BackgroundLibraryView.tsx:56`) **남은 삭제가 말없이 끊긴다** — 도는 동안의 포커스는 `body`나 ×다. 그래서 창이 떠 있는 동안 `window`의 캡처 단계에서 **모든** `keydown`의 `stopPropagation()`을 부르고 내릴 때 뗀다. Tab·Enter·Space·방향키·Esc의 기본 동작은 막지 않는다 — 엔진이 창 안에서 처리하고, 이 창에는 키를 듣는 React 핸들러가 없다(`BackgroundModal`의 Esc는 `cancel` 사건이다). 편집기 자신의 창 단위 리스너는 같은 자리에 먼저 걸려 있어 그대로 듣는다(Ctrl+S는 `dialogOpen`에서 돌아간다). **다만 키를 멈추면 뒤에서 그 키의 기본 동작을 막아 주던 처리기도 닿지 않는다 — 그 둘은 여기서 막는다**(`event.code`로 가린다 — 한글 입력 상태와 무관하게, `onSaveKey`처럼): ① **Ctrl+R**. 오늘은 앱의 처리기가 `preventDefault()`하고 자료만 다시 읽는다(`useGlobalShortcuts.ts:136-154`, `src/App.tsx:3180`). 그것이 닿지 않으면 키가 Electron의 기본 창 메뉴('보기 > 다시 불러오기' — 앱은 창 메뉴를 치우지 않는다, `electron/main.ts:832-850`)로 넘어가 **화면 전체가 다시 불려 온다**: 도는 삭제가 말없이 끊기고 모든 도면의 저장 안 한 편집이 사라진다(앱이 듣지 않는 Ctrl+Shift+R은 같은 메뉴의 '강제로 다시 불러오기'라 오늘도 그럴 것이다 — 같은 글쇠라 함께 막힌다). ② **Ctrl+Z·Ctrl+Y**. 버튼에 포커스가 있을 때의 이 키는 엔진의 "글자 되돌리기"로 가서 칸에 마지막으로 친 값을 되돌린다(검증 기록 :429). 창 밑의 칸에도 닿는지는 재 보지 않았는데, 닿으면 그 칸의 `onChange`가 창 밑의 초안을 고치고 창의 계획과 문장이 함께 바뀐다. 이 창에는 글자 칸이 없어 막아도 잃는 것이 없다. 창을 닫는 Ctrl+W는 그대로 둔다 — 창은 트레이로 숨을 뿐이고 페이지는 계속 돈다(`electron/main.ts:942-948`).
- **엔진이 닫아 버리면 다시 연다.** 도는 동안 Esc·×·돌아가기는 듣지 않는다(`onClose`가 돌아간다, J13). 그런데 엔진은 `cancel`을 한 번 막은 뒤의 다음 Esc에 창을 스스로 닫는다(같은 lessons 항목) — 그러면 React의 상태는 "떠 있음"인데 창이 없어, 멈춘 문장을 볼 곳이 없다. 이 부품이 자기 `<dialog>`(`closest('dialog')`)의 `close`를 듣고, 아직 붙어 있는데 닫혀 있으면 `showModal()`을 다시 부른다(effect, 내릴 때 뗀다).

```tsx
  const body = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = body.current?.closest('dialog');
    if (!dialog) return;
    // Two presses of Esc in a row close a native dialog whatever its cancel handler says. While this is mounted it is meant to be open.
    const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };
    // No key pressed while this dialog is up is for the page behind it (the shortcuts of the app hear every key that reaches the window).
    // Two keys are swallowed whole, default and all: Ctrl+R, which reloads the whole window once the handler of the app that swallows it is no
    // longer reached, and Ctrl+Z/Y, which the engine turns into an undo of the text last typed in a field of the page behind.
    const hold = (event: KeyboardEvent) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();
    };
    dialog.addEventListener('close', reopen); window.addEventListener('keydown', hold, true);
    return () => { dialog.removeEventListener('close', reopen); window.removeEventListener('keydown', hold, true); };
  }, []);
  useEffect(() => { if (!progress) back.current?.focus(); }, [progress, plan.target === null]);   // the focus dropped out of the dialog: back to the button that only closes
```

CSS — `backgrounds-map.css`, `.bmap-modal-actions>.bmap-text-button:first-child`(:238) 바로 다음. 전환 없음.

```css
/* The delete dialog of a map: what it says, and its two choices as cards. */
.bmap-delete-lead { display:flex; flex-direction:column; gap:8px; }
.bmap-delete-choices { display:flex; flex-direction:column; gap:8px; min-width:0; margin:14px 0; padding:0; border:0; }
.bmap-delete-choice { display:flex; align-items:flex-start; gap:10px; padding:11px 13px; border:1px solid rgb(var(--color-bg-border)); border-radius:8px; font-size:12px; line-height:1.7; color:rgb(var(--color-text-secondary)); cursor:pointer; }
.bmap-delete-choice:has(input:checked) { border-color:rgb(var(--color-accent)); background:rgb(var(--color-accent) / .09); }
.bmap-delete-choice strong { display:block; font-size:13px; font-weight:550; color:rgb(var(--color-text-primary)); }
.bmap-delete-choice input { flex-shrink:0; margin-top:5px; accent-color:rgb(var(--color-accent)); }
.bmap-delete-choices:disabled .bmap-delete-choice { cursor:default; opacity:.6; }
/* The paragraph reset of the library takes the margins of the stopped note and of the notes away: these keep them clear of the lead. */
.bmap-move-note + .bmap-delete-lead { margin-top:12px; }
.bmap-delete-lead ~ .bmap-hint { margin:10px 0 0; font-size:12px; }
```

끝의 두 줄은 **게이트 D에서 더했다**: 창 안의 문단은 라이브러리의 `.bg-library p { margin:0 }`에 눌려 `.bmap-move-note`와 `.bmap-hint`의 제 여백을 잃는다 — 멈춘 문장의 상자가 첫 문단에 붙고, 선택이 없는 창에서는 `notes`가 마지막 문단 바로 밑에 작은 글씨로 붙어 보였다(앱 엔진에서 본 것). 두 줄이 그 사이를 띄우고 `notes`를 12px로 올린다(선택자가 그 초기화보다 무겁다). 앵커 66의 규칙 목록에 두 줄이 더해졌다.

`lead`의 문단들은 `<div className="bmap-delete-lead" ref={body}>` 안에 둔다(없어짐 모습에서도 그 한 문단을 같은 div에 둔다 — `body` ref가 늘 있다). 창의 폭은 `BackgroundModal`의 것이다(`min(580px, 창 폭 − 32px)` — 앱 창이 가장 좁은 800px일 때도 580px이라, `돌아가기`와 가장 긴 `도면 N개 모두 삭제`가 한 줄에 선다).

### 5.5 초안 — 지워지는 도면과 저장 단계가 쓴 도면

| 초안 | 일어나는 일 |
|---|---|
| **저장 단계가 쓴 도면**(P, 옮겨지는 C, 연결을 가진 S의 도면)의 초안 | `persistMaps`가 지금의 규칙대로 **다시 놓는다**(`rebase-drafts`, v1.135.0): 편집 중이던 도면은 계속 편집 중이고 저장 안 한 변경이 없으며 되돌리기 기록이 비워진다. 저장 안 한 변경이 있었으면 **그 변경이 함께 저장됐다** — 창이 그 도면의 이름을 미리 말했다. 초안이 없던 도면에는 초안이 생기지 않는다 |
| 왜 함께 저장하나 | 그 도면을 쓰지 않고는 연결을 풀 수도 옮길 수도 없고, 저장된 값만 쓰면 다시 놓기가 저장 안 한 변경을 덮어 말없이 잃는다. **'기존 도면 연결'·'도면 설정'·'내부 도면 만들기'가 오늘 하는 것과 같다**: 그 셋도 얽힌 도면의 초안 값을 초안의 버전으로 함께 저장하고(`saveMapChanges`, mapWorkflow.ts:28-49) 창이 "현재 공간의 편집 내용도 함께 저장됩니다."라고 말한다(:1282, :1291, :1300) |
| **지워진 도면**의 초안 | 그 도면의 삭제가 **통과한 바로 다음 줄에서** 버린다(`doc.discard(step.id)`). 저장 안 한 변경이 있었으면 함께 사라진다 — 창이 미리 말했다 |
| 멈춘 실행에서 아직 남아 있는 도면의 초안 | 건드리지 않는다. 저장 단계가 쓴 도면이면 위의 첫 줄대로 다시 놓여 있다(변경은 저장됐다) |
| 답을 잃은 삭제로 지워진 도면의 초안 | 삭제는 됐는데 `execute`가 던져서 위의 줄을 지나지 않았다. 창을 닫을 때와 다시 누를 때, **이 창이 지우려던 도면 가운데 라이브러리에 없는 것**의 초안을 버린다(5.6의 `dropGoneDrafts`) — 남기면 지워진 도면이 목록에 "저장할 수 없는 편집 중인 도면"으로 남는다 |
| 얽히지 않은 도면의 초안 | 건드리지 않는다 |
| 지금 보던 도면(= 지운 도면)의 띠 | 도면과 함께 사라진다. 옮겨 간 위 도면은 가지고 있던 상태 그대로다 — 저장 단계가 쓴 도면이면 첫 줄대로 다시 놓여, 띠가 저장 알림 없이 **곧바로 `저장된 그대로예요`**다 |
| 띠의 `도면을 저장했어요` | `persistMaps`는 그 말을 **누를 때 보던 도면이 그 저장에 들어 있을 때만** 켠다(:526-531 — 앵커 57이 그 네 줄과 `setSavedNotice(`의 수를 고정한다. 고치지 않는다). 삭제에서 그 도면은 지울 도면 자신이라, 실행이 저장 단계 뒤에 멈춰 그 도면이 남았을 때만 보인다. 위 도면이나 옮겨진 하위 도면에는 뜨지 않는다 — 그 도면의 변경이 저장된다는 말은 창이 미리 했다(`savedAlong`) |

삭제는 되돌리기의 단계가 아니다(되돌릴 수 없다).

### 5.6 편집기 배선

**상태**(`confirmation`(:238) 다음에 둔다). `confirmation`의 종류에서 `'delete-map'`이 빠진다(`'discard' | 'delete-node' | 'delete-group' | null`).

```ts
  /** The delete dialog of a map. It holds the id of the map it was opened for, and acts on that map alone. */
  const [mapDelete, setMapDelete] = useState<{ mapId: string; name: string; parentId: string | null; mode: MapDeleteMode;
    progress: { done: number; total: number } | null;
    /** The plan of the press that stopped part-way. */
    stopped: MapDeletePlan | null } | null>(null);
  const deleting = useRef(false);                            // a run is in progress. A ref: a second press can come before `busy` is drawn
  /** Every map this dialog has set out to delete, over all its presses. */
  const deleteAimed = useRef<string[]>([]);
```

**핸들러 넷** — `uploadUnderlay`(:720-727) 다음, `function newSpace(`(:728) 앞. 그 자리는 어느 조각에도 들지 않는다(`confirmAction` 조각은 `async function createMap(`에서 끝나고, 앵커 40의 조각은 `function newSpace(`에서 시작한다). 이 차례로 둔다.

```ts
  /** The drafts of maps this dialog deleted without getting an answer: the library no longer has them. Only asked while nothing is being saved. */
  function dropGoneDrafts() { for (const id of deleteAimed.current) if (!snapshot.maps.some(map => map.id === id)) doc.discard(id); }
  /** 도면 삭제 of the settings dialog. The dialog is bound to the map those settings were opened for, never to the map on show. */
  function openMapDelete() {
    if (!settingsForm || disabled || !snapshot.canManage) return;
    const map = maps.find(item => item.id === settingsForm.id);
    deleteAimed.current = [];
    setMapDelete({ mapId: settingsForm.id, name: map?.name ?? settingsForm.name, parentId: map?.parentId ?? null, mode: 'keep-children', progress: null, stopped: null });
    setSettingsForm(null); setError('');
    // This dialog comes up where the settings dialog was: the second click of a double-click would land on a choice or a button of it.
    swallowSecondClick();
  }
  async function runMapDelete() {
    if (!mapDelete || disabled || deleting.current) return;
    dropGoneDrafts();
    // The whole plan, the revisions it expects and where the screen goes are settled here, before the first wait.
    const plan = planMapDelete(snapshot, settle().drafts, mapDelete.mapId, mapDelete.mode);
    if (!plan.target || plan.refusal) return;                // the dialog is drawn from the same plan and says why
    const steps = plan.steps, total = plan.removed.length, parentId = plan.target.parentId, opened = parentId ? mapPath(maps, parentId).map(map => map.id) : [];
    deleteAimed.current = [...new Set([...deleteAimed.current, ...plan.removed])];
    deleting.current = true; setBusy(true); setError('');
    // What is counted is maps deleted, the number the button named: the save that comes first counts for none.
    setMapDelete(previous => previous && { ...previous, progress: { done: 0, total }, stopped: null });
    let done = 0;
    try {
      for (const step of steps) {
        // The save comes first and goes the way every save of maps goes: the drafts of the maps it wrote are put back.
        if (step.type === 'save-maps') await persistMaps(step);
        // What was being edited on a map is let go only once that map itself is gone.
        else { await execute(step); doc.discard(step.id); done += 1; }
        setMapDelete(previous => previous && { ...previous, progress: { done, total } });
      }
      setCurrentId(parentId); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null);
      setCollapsed(previous => new Set([...previous].filter(id => !opened.includes(id))));
      setMapDelete(null);
    } catch (cause) {
      // Said in the dialog, in plain words: never the wrapper Electron puts round what the main process throws.
      setError(mapDeleteCauseText(cause));
      setMapDelete(previous => previous && { ...previous, progress: null, stopped: plan });
      // The dialog arms itself again under the pointer, and two more paragraphs push its buttons down: a click still on its way lands nowhere.
      swallowSecondClick();
    } finally { deleting.current = false; setBusy(false); }
  }
  /** 돌아가기, Esc, the close button and 닫기. Not while a run is in progress. */
  function closeMapDelete() {
    if (!mapDelete || disabled) return;
    dropGoneDrafts();
    // The map is gone (deleted here without an answer, or elsewhere): its draft goes with it and the screen moves to where it hung.
    if (!snapshot.maps.some(map => map.id === mapDelete.mapId)) {
      doc.discard(mapDelete.mapId);
      setCurrentId(mapDelete.parentId); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null);
    }
    setMapDelete(null); setError('');
  }
```

- **연 그 도면만 다룬다(15.4의 고침).** 창은 `mapDelete.mapId`를 쥐고, 계획·명령·문구가 모두 그 id에서 나온다. `runMapDelete`와 `closeMapDelete`에는 `current`라는 글자가 없다. 창은 `current`에 달려 그려지지도 않는다. 답을 잃은 마지막 삭제 뒤: 저장소가 다시 읽은 스냅샷에 그 도면이 없다 → 계획의 `target`이 `null` → 창이 '없어짐' 모습이 되고 **지우는 버튼 자체가 없다**. 다시 누를 것이 없으므로 다른 도면에 삭제가 나갈 길이 없다. `닫기`는 그 도면의 초안을 버리고 위 도면으로 간다. 보기 모드에서 `current`가 말없이 첫 도면으로 바뀌어도 창은 그것을 읽지 않는다.
- **기다림 뒤에는 그 렌더를 읽지 않는다.** `runMapDelete`의 첫 `await` 뒤에는 `snapshot`·`current`·`draft`·`maps`가 없다 — `steps`·`parentId`·`opened`·`plan`은 그 앞에서 만든 지역 값이고, 상태는 함수형 갱신으로 쓴다. 저장 단계는 늘 첫 명령이라 `persistMaps`는 기다림 앞에서 불린다.
- **겹쳐 돌지 않는다**: `deleting` ref를 일찍 돌아가는 검사 **뒤에** 켜고 `finally`에서 끈다(v1.135.0의 `saving`과 같은 꼴).
- **`settle()`**: 창 밑에서 끌기가 돌 수는 없지만, 초안은 그 순간의 저장소에서 읽는다.
- **끝난 뒤의 화면**: `setCurrentId(parentId)`(위 도면. 없으면 `null` — 목록의 첫 도면이나 빈 화면, 지금과 같다). `navigate`가 비우는 것(찍던 점·도구·기호 목록·초점 요청)을 비우고, 위 도면까지의 가지를 편다(옮겨 온 하위 도면이 보이게). 3D였으면 3D 그대로이고 카메라 시점 보기는 도면과 함께 끝난다(:457-459).
- **그리는 줄**(설정 창 다음에):

```tsx
    {mapDelete && deletePlan && <BackgroundMapDeleteDialog name={mapDelete.name} plan={deletePlan} mode={mapDelete.mode} progress={mapDelete.progress}
      stopped={mapDelete.stopped && mapDeleteStopText(mapDelete.stopped, snapshot)} error={error} disabled={disabled}
      onMode={mode => setMapDelete(previous => previous && { ...previous, mode })} onClose={closeMapDelete} onConfirm={() => void runMapDelete()} />}
```

  `const deletePlan = useMemo(() => mapDelete ? planMapDelete(snapshot, drafts, mapDelete.mapId, mapDelete.mode) : null, [snapshot, drafts, mapDelete?.mapId, mapDelete?.mode]);`를 `draftChanged`(:1042) 옆에 둔다. 창이 보이는 계획과 누를 때 만드는 계획은 같은 함수의 같은 입력이다.
- **설정 창의 버튼**: `onClick={openMapDelete}`(:1302). 설정 창은 지금처럼 닫히고(그 창에서 고치던 이름·위치는 버려진다 — 지금과 같다), `돌아가기`는 편집기로 돌아간다.
- **`confirmAction`**: 삭제 가지(:666-677)를 지운다. 그 가지의 `draft?.baseRevision === null`(라이브러리에 없고 초안만 있는 도면 — 지금의 흐름에서는 생기지 않는다, 초안은 늘 저장된 도면에서 열린다)의 일은 '없어짐' 모습의 `닫기`가 한다(초안을 버리고 위 도면으로). 함수 머리의 `async`는 남긴다(조각의 표지가 `async function confirmAction(`이다). 공용 확인 창(:1304)의 제목·글에서 `confirmation === 'delete-map' ? … :` 가지를 뺀다. 앵커 52가 보는 세 식(`confirmation === 'discard' ? (draftChanged ? …`, 버튼의 `confirmation === 'discard' ? '버리고 끝내기' : '삭제'`)과 창을 여는 줄은 글자 그대로다.

### 5.7 미리보기 저장소 · 다른 PC

- **미리보기는 같은 길이다.** 미리보기 저장소는 같은 명령을 같은 `applyBackgroundCommand`로 돌리고, 삭제마다 그 id를 은퇴 목록에 적는다(previewGateway.ts:56-57). 이 계획은 도면을 새로 만들지 않으므로 은퇴한 id와 부딪칠 일이 없다. 다시 누른 명령은 새 `requestId`로 나간다(useBackgroundStore.ts:51). `previewGateway.ts`·`src/mocks/devElectronAPI.ts`는 고치지 않는다.
- **다른 PC**: 명령마다 변경 신호가 나가므로 다른 화면은 중간 상태(연결이 풀린 뒤, 일부가 지워진 뒤)를 몇 초 동안 본다 — 모두 온전한 라이브러리다. 다른 PC가 사이에 얽힌 도면을 고치면 그 명령에서 멈추고 다시 누르면 새 계획이다.
- 창이 열려 있는 동안 깨끗한 초안은 라이브러리를 따라가지 않고(6.1), 닫힐 때 따라간다.

## 6. 함께 쓰는 것 — `dialogOpen`, 앵커, 파일

### 6.1 `dialogOpen` — 편집기의 창이 열려 있는가를 한 줄로

오늘은 "창이 열려 있다"를 세 곳이 네 상태를 하나하나 적어 묻는다: 따라가기의 가드와 의존 목록(:346, :355), Ctrl+S의 가드(:432), 편집기의 오류 띠(:1082). 창이 하나 늘 때마다 세 곳을 고쳐야 하고 앵커 53·56이 그 줄들을 글자로 고정한다. 한 줄로 모은다 — `gestureActive`(:281) 바로 다음에:

```ts
  /** A dialog of the editor is open. Each asks about a map it holds: nothing may change the maps under it, and the editor's own message is shown inside it. */
  const dialogOpen = !!(confirmation || createForm || linkForm || settingsForm || mapDelete);
```

| 읽는 곳 | 예전 | 이제 |
|---|---|---|
| 따라가기의 가드(:346) | `if (disabled \|\| doc.isGestureActive() \|\| confirmation \|\| createForm \|\| linkForm \|\| settingsForm) return;` | `if (disabled \|\| doc.isGestureActive() \|\| dialogOpen) return;` |
| 그 effect의 의존 목록(:355) | `[followSaved, snapshot.maps, disabled, gestureActive, confirmation, createForm, linkForm, settingsForm]` | `[followSaved, snapshot.maps, disabled, gestureActive, dialogOpen]` — 창이 닫혀 값이 거짓이 될 때 다시 돈다. 설정 창에서 삭제 창으로 넘어갈 때는 계속 참이라 그 사이에 돌지 않는다. 그 위의 주석(:354)은 `// An open dialog is in the list so that this runs again as it closes.`로 고친다 |
| Ctrl+S의 가드(:432) | `if (createForm \|\| linkForm \|\| settingsForm \|\| confirmation \|\| document.querySelector(openDialogs)) return;` | `if (dialogOpen \|\| document.querySelector(openDialogs)) return;` |
| 오류 띠(:1082) | `{error && !confirmation && !createForm && !linkForm && !settingsForm && <div className="bg-error" role="alert" ref={errorRef}>` | `{error && !dialogOpen && <div className="bg-error" role="alert" ref={errorRef}>` — 삭제 창이 열려 있으면 그 문장은 창 안에 있다 |

`dialogOpen`이라는 글자는 편집기에 주석을 빼고 정확히 다섯 번 나온다(만드는 줄, 가드, 의존 목록, Ctrl+S, 오류 띠 — 앵커는 주석을 지우고 읽는다, `tests/backgroundMapEditorWiring.test.ts:15-16`). 다음 차례가 편집기에 창을 더하면(3차의 장소 묻기, 보관의 "이어서 편집") 이 줄에 한 낱말을 더한다.

### 6.2 앵커 — `tests/backgroundMapEditorWiring.test.ts`

**일부러 고치는 기존 앵커(다섯).** 그 밖의 1~59는 한 글자도 고치지 않고 그대로 통과해야 한다(특히 17·21·23·34·36·39·41·44·45·54·57·58).

| # | 고치는 것 |
|---|---|
| 50 | `count(editor, /await persistMaps\(/g)`가 4 → **5**(도면 삭제의 저장 단계). 단언의 설명에 그 낱말을 더한다 |
| 52 | `count(editor, /\bswallowSecondClick\b/g)`가 2 → **4**(함수, `endEditing`, `openMapDelete`, `runMapDelete`의 `catch`). 창 조각과 세 식은 그대로 통과한다 |
| 53 | `steps`의 셋째 줄이 `if (dialogOpen \|\| document.querySelector(openDialogs)) return;` — 순서·"자기 줄"·핸들러 전체 비교가 그 줄로 돈다 |
| 56 | 가드 줄과 의존 목록 줄이 6.1의 글자. 주석의 "네 창"을 `dialogOpen`으로 |
| 59 | 이름 목록에 `backgroundMapNumberField.test.ts`·`backgroundMapDelete.test.ts`를 더하고 제목을 "the new test files run in the build"로 |

**새 조각**(읽힐 때만 잘린다): `fieldScrub` = `piece(editor, 'const beginFieldScrub = useEvent(', 'const placeAt = useEvent(')` · `dropGoneDrafts` = `'function dropGoneDrafts('` → `'function openMapDelete('` · `openMapDelete` = → `'async function runMapDelete('` · `runMapDelete` = → `'function closeMapDelete('` · `closeMapDelete` = → `'function newSpace('` · `numberTags` = `editor.split('<NumberField ').slice(1).map(part => part.slice(0, part.indexOf(' />')))`. 새 파일을 읽는다: `mapNumberField.ts`, `useMapScrubPointer.ts`, `BackgroundMapNumberField.tsx`, `BackgroundMapPlanSide.tsx`, `mapDelete.ts`, `BackgroundMapDeleteDialog.tsx`, `backgrounds-map-plan.css`(줄 단위).

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| 60 | **속성의 숫자는 모두 그 부품 하나이고, 표 하나와 끌기 객체 하나를 쓴다**: 편집기에 `import { BackgroundMapNumberField as NumberField } from './BackgroundMapNumberField';`가 있고 `function NumberField(`·`type="number"`·`PLAN_LIMIT`·`MIN_PLAN_SIZE`가 없다. `numberTags`가 정확히 14개이고, 각 태그가 `label="…" field="…" value={…} `로 시작하며 `(label, field, value)` 셋이 3.4의 목록(칸 이름 → 저장 키 → 값의 식)과 같다(차례 무관, 셋은 정확히). 각 태그에 `disabled={fieldLocked}`·`scrub={fieldScrub}`·`onDone={doc.endCoalescing}`가 있고 ` min=`·` max=`가 없다. 14곳의 `onChange`가 2.1의 표 그대로다(`patchNode({ elevation }, 'elevation')`가 둘, `moveSelected({ x: x - selected.x, y: 0 }, 'x')` …) | 칸 하나를 예전 부품에 남김 / 이름과 키가 어긋남('세로 길이'에 `width`) / 값의 식이 어긋남('가로 위치'와 '세로 위치'의 `value`를 맞바꿈 — 칸이 다른 숫자를 보이고 끌기는 또 다른 숫자에서 시작한다) / 한 칸에서 `scrub`을 뺌 / 한계를 다시 props로 줌(표와 둘이 된다) / 적는 길을 `scrub`으로 돌림(한 칸 = 한 단계가 깨진다) |
| 61 | **끌기는 문서의 제스처이고 시작 도면에서 만든다**: `fieldScrub` 조각에 차례로 `if (!current \|\| !selected \|\| selected.locked \|\| !canEdit \|\| pointerRef.current \|\| doc.isGestureActive()) return null;`, `focusCanvas();`, `mapDraft(doc.getState(), current.id)`, `const start = node && !node.locked ? mapNodeNumber(node, field) : null;`(그 `node`는 방금 읽은 초안의 것이다 — `map?.nodes.find(item => item.id === selected.id)`), `doc.beginGesture(current.id)`, `return { start, map };`, `const start = current && gestureStartMap(doc.getState(), current.id);`, `doc.previewGesture(setMapNodeNumber(start, selected.id, field, value));`, `finish: finishCanvasGesture, cancel: cancelCanvasGesture, alive: doc.isGestureActive`. 그 조각에 `updateMap(`·`doc.update(`·`coalesceKey`·`doc.finishGesture(`가 없다. `:1016`의 줄 `const beginCanvasGesture = useEvent(() => { if (current && canEdit && !pointerRef.current) doc.beginGesture(current.id); });`가 글자 그대로 있다. `mapNumberField.ts`의 `setMapNodeNumber`에 `value === current`를 묻는 줄이 `settleNumber(`보다 앞에 있고, `transformMapSpace(`·`replaceMapNode(`·`placeMapNode(`가 각각 있다 | `focusCanvas()`를 `beginGesture` 뒤로(덜 친 값의 확정이 제스처에 막혀 버려진다) / 처음 값을 렌더의 `selected`에서 읽음(`mapNodeNumber(selected, field)` — 치던 칸이 떠나며 확정한 값을 모른다: 입체 높이에 0을 치고 그 칸을 끌면 180에서 시작한다) / 미리보기를 `current`(앞의 미리보기)에서 만듦(방의 소속이 걸음마다 다시 늘어난다) / `updateMap`으로 미리봄(제스처 동안 버려져 아무것도 움직이지 않는다) / `finish`를 `doc.finishGesture`에 바로 이음(저장이 시작된 뒤의 놓음이 단계를 만든다) / 같은 값 검사를 빼거나 다듬은 뒤로 옮김(제자리 끌기가 키를 만들거나 한계 밖의 값을 고쳐 쓴다) / 잠긴 노드 검사를 뺌 |
| 62 | **포인터 세션은 창에서 듣고, 캡처는 걸어 보고, 어떻게 끝나든 리스너를 남기지 않는다**: `useMapScrubPointer.ts`에 3.3의 본문의 아래 줄들이 글자 그대로 있다. **리스너** — `window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);` · `window.addEventListener('blur', cancel); target.addEventListener('lostpointercapture', cancel);`과 같은 다섯의 `removeEventListener`(같은 깃발) · `try { target.setPointerCapture(pointerId); } catch`. **누름** — `if (!event.isPrimary \|\| event.button !== 0 \|\| latest.current.disabled) return;` · `if (session.current) { if (session.current.pointerId !== event.pointerId) return; session.current.giveUp(); }` · 그 뒤의 `event.preventDefault();`. **가드** — `event.pointerId !== active.pointerId`가 정확히 세 번(`move`·`up`·`cancel`). **이동** — `if ((event.buttons & 1) === 0) { up(event); return; }` · `const along = drive.axis === 'x' ? event.clientX - active.press.clientX : event.clientY - active.press.clientY;` · `if (Math.abs(along) >= MAP_NUMBER_SCRUB.slopPx) begin(event, along);`. **시작** — `if (session.current !== active) { if (origin && latest.current.scrub.alive()) latest.current.scrub.cancel(); return; }` · `if (!origin) { end(); return; }` · `const slop = Math.sign(along) * MAP_NUMBER_SCRUB.slopPx;` · `const from = drive.immediate ? active.press : {`로 시작하는 줄 · `drag = drive.open(origin, from); active.last = origin.start; active.phase = 'dragging';`이 있고 파일에 `.open(origin, at)`이 없다. **읽기** — `if (!latest.current.scrub.alive()) { active.phase = 'dead'; drive.close?.(); return; }` · `if (Number.isFinite(value) && value !== active.last) { active.last = value; latest.current.scrub.preview(drive.field, value); }`(`scrub.preview(`는 한 번). **놓음** — `if (active.phase === 'pressed') { end(); drive.tap?.(); return; }`(`drive.tap?.()`은 한 번) · `read(event);` 뒤의 `if (active.phase === 'dragging') { latest.current.scrub.finish(); drive.close?.(); }`(`scrub.finish()`는 한 번) · `window.addEventListener('click', swallow, true)`와 `window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)`. **버림** — `if (active.phase === 'dragging') { if (latest.current.scrub.alive()) latest.current.scrub.cancel(); drive.close?.(); }`. **내려갈 때** — `if (active.phase === 'dragging' && latest.current.scrub.alive()) latest.current.scrub.cancel();`의 다음 줄이 조건 없는 `active.end();`다. `scrub.cancel()`은 정확히 세 번(버림, 내려갈 때, 시작한 사이 세션이 바뀜)이고 모두 `alive()`를 물은 뒤다. 파일에 `altKey`·`ctrlKey`·`metaKey`·`addEventListener('keydown'`이 없다 | 창 리스너를 빼고 요소의 `onPointerMove`만 씀(검사 창에서 끌리지 않고, 진짜 마우스도 캡처에만 기댄다) / 끌기의 시작 자리를 포인터의 자리로(`from`을 `at`으로 — 빠르게 시작한 끌기가 그만큼의 값을 잃고, 옆 그림은 누른 자리로 재면 첫 값이 튄다) / `tap`을 부르지 않음(끌개를 그냥 누르면 아무 일도 없다) / 리스너를 떼지 않음 / `alive()` 없이 `finish`(Esc 뒤의 놓음이 다른 제스처를 끝낸다) / 버림에서 `finish`를 부름 / 값이 같아도 미리봄(픽셀마다 편집기가 다시 그려진다) / 클릭을 삼키지 않음(끈 뒤 칸에 커서가 들어간다) / 문턱을 뺌(이름을 누르기만 해도 제스처가 시작된다) / 문턱을 축과 무관한 거리로 잼(옆으로만 움직인 손잡이, 위로만 움직인 끌개가 끌기를 시작한다) / `pointerId` 가드를 뺌(둘째 포인터의 놓음이 끌기를 끝낸다) / `buttons` 줄을 뺌(다른 단추를 누른 채 왼쪽 단추를 놓으면 값이 계속 따라온다) / 남은 세션을 버리지 않음(`giveUp()` 대신 돌아감 — 놓음을 잃은 부품이 다시 눌리지 않는다) / 내려갈 때 `active.end();`를 조건 안으로 옮김(누른 채 다른 노드를 고르면 다음 이동이 그 노드에서 끌기를 시작한다) / 시작한 뒤 세션을 다시 보지 않음(내려간 부품이 연 제스처가 남는다) / Alt를 읽음 |
| 63 | **적는 법과 칸의 정체는 그대로이고, 끌기의 셈은 순수 모듈이 한다**: `BackgroundMapNumberField.tsx`에 `<label className="bmap-num-label" htmlFor={id}`와 칸의 줄 `<input ref={box} id={id} type="number" step="any" value={text ?? round(value)} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} disabled={disabled}`와 `const round = (value: number) => Math.round(value * 100) / 100;`이 있고, 적는 줄 아홉이 **이 차례로** 글자 그대로 있다(편집기 :141-155의 줄들 — `const [text, setText] = useState<string \| null>(null);` · `const parse = (raw: string) => { const next = raw.trim() === '' ? Number.NaN : Number(raw); return Number.isFinite(next) ? next : null; };` · `const raw = event.target.value, next = parse(raw);` · `setText(raw);` · `if (next !== null && next >= min && next <= max && next !== value) onChange(next);` · `onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}` · `const next = text === null ? null : parse(text), clamped = next === null ? value : Math.min(max, Math.max(min, next));` · `if (clamped !== next && clamped !== value) onChange(clamped);` · `setText(null); onDone?.();`). `MAP_NUMBER_FIELDS[field]`에서 `min`·`max`를 읽는다. 끌기의 줄들이 3.4의 글자 그대로 있다: `const press = useMapScrubPointer(scrub, disabled);` · `const lit = dragging && scrub.alive();` · `open: (origin, from): MapNumberSlide => { setDragging(true); return { anchorX: from.clientX, anchorValue: origin.start, big: from.shiftKey, value: origin.start }; },` · `read: (drag, at) => slideNumber(drag, at.clientX, at.shiftKey, field),` · `tap: () => box.current?.focus()` · `pressNumberTrack(value, field, event.clientX, rect.left, rect.width)` · `immediate: bar.immediate` · `read: (start, at) => trackNumber(bar.fraction(at.clientX), field, at.shiftKey, start),`. `onPointerDown={slide}`가 정확히 두 번(이름, 끌개), `onPointerDown={slideBar}`가 한 번이고, 파일에 `stepNumber(`·`scrubSteps(`가 없다(자리를 값으로 바꾸는 셈을 부품에 다시 적지 않는다 — 그 셈은 N-6·N-7이 돌려 본다). `className="bmap-num-grip" aria-hidden="true"`·`className="bmap-num-track" aria-hidden="true"`가 있고 파일에 `tabIndex`가 없다. `backgrounds-map.css`에 3.5의 작은 화살표 줄이 글자 그대로 있고, `.bmap-num`이 든 줄에 `transition`·`animation`이 없으며, 세 요소의 줄에 `touch-action:pan-y`, 점의 줄에 `pointer-events:none`과 `left:calc(var(--bmap-num-at,0) * (100% - 10px))`이 있고(점이 가는 길이다 — `pressNumberTrack`이 같은 식으로 센다), 끌개가 왼쪽 끝에 있다(`.bmap-num-grip {` 줄에 `left:1px`이 있고 ` right:`가 없다. 상자의 줄에 `padding-left:24px`). `mapNumberField.ts`에 three.js import와 `document.`·`window.`가 없다 | 이름을 칸과 잇지 않음(`htmlFor`를 뺌 — 칸의 이름이 없어진다) / 칸의 줄에서 `min=`·`max=`·`disabled=`를 뺌(엔진의 ↑↓가 한계를 모르고, 꺼진 칸에 적힌다) / `round`를 정수로(244.65가 245로 보인다) / 끌기의 기준 값을 렌더의 `value`로(`anchorValue: value` — 치던 칸이 떠나며 확정한 값을 모른다) / 이름이나 끌개에서 `onPointerDown`을 뺌 / 막대가 `bar.immediate`를 무시함(점을 누르기만 해도 제스처가 시작된다) / 셈을 부품에 다시 적음(`stepNumber(drag.value, …)` — 테스트가 닿지 않는 곳에서 사건마다 걸음을 더한다) / 적는 조건에서 `next !== value`를 뺌 / 범위 밖의 값을 한계로 맞추는 줄을 뺌 / 빈 글자를 0으로 읽음(`parse`의 앞부분을 뺌 — 칸을 비우는 순간 0이 들어간다) / `setText(raw)`를 뺌(덜 친 글자가 칸에서 사라진다) / 끄는 모습을 `dragging`만으로(Esc 뒤 강조가 남는다) / 끌개에 `tabIndex`를 줌 / 작은 화살표 줄을 지움 / 막대에 전환을 넣음 / 점의 `left`를 `calc(var(--bmap-num-at,0) * 100%)`로(점이 오른쪽 끝에서 막대 밖으로 나가고, 그려진 점이 `pressNumberTrack`이 세는 자리에서 10px까지 어긋난다) |
| 64 | **옆 그림의 손잡이는 편집할 수 있을 때만 있고, 포인터 전용이며, 눈금을 잡아 둔다**: `BackgroundMapPlanSide.tsx`에 `const draggable = canEdit && !camera.locked`, `useMapScrubPointer(scrub, !draggable)`, `field: 'elevation', axis: 'y', immediate: false`, `planSideScale(origin.map,`, `const toY = (clientY: number) => inverse ? new DOMPoint(0, clientY).matrixTransform(inverse).y : Number.NaN;`(화면의 y를 **그림의 단위로** 바꾼다), `frozen.current = held; redraw(turn => turn + 1);`, `grab: planSideY(held, origin.start) - toY(from.clientY)`, `planSideDragLevel(drag.scale, drag.toY(at.clientY) + drag.grab, drag.start)`, `const live = frozen.current && scrub.alive() ? frozen.current : null;`, `const scale = live ?? planSideScale(map, camera), side = planSideView(map, camera, scale);`, `close: () => { frozen.current = null; redraw(turn => turn + 1); }`이 있고, 잡아 둔 눈금을 쥐는 줄은 `const frozen = useRef<PlanSideScale | null>(null), [, redraw] = useState(0);`이다(state가 아니다 — 4.3). `bmap-plan-side-grab`·`bmap-plan-side-ring`·`bmap-plan-side-marks`가 든 JSX 줄이 모두 `{draggable && `로 시작하고, 파일에 `bmap-plan-side-ceiling`이 없으며, 캡션의 줄이 `<figcaption>옆에서 본 방향{draggable && <span className="bmap-plan-side-tip"> · 점을 끌어 높이 조절</span>}</figcaption>`이다. 파일에 `tabIndex`·`role="slider"`·`onKeyDown`·`data-camera-color=`가 없고 `role="img"`가 있다. 편집기의 보조 평면도 태그가 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} />`다. `BackgroundMapPlanPreview.tsx`에 `setPointerCapture`·`addEventListener('pointermove'`가 없고 `<CameraReadout key={selected.id} `가 있다. `backgrounds-map-plan.css`의 `.bmap-plan-side-grab {` 줄에 `stroke-width:24px`·`pointer-events:all`·`cursor:ns-resize`·`touch-action:none`이, `.bmap-plan-side.is-draggable>svg {` 줄에 `touch-action:none`이(최종 검토에서 10.1의 대체안을 썼다), `.bmap-plan-side-ring {` 줄에 `fill:none`·`stroke-width:6px`이 있고(화면 픽셀의 띠), 가로로 긴 칸의 두 블록에 각각 `.bmap-plan-side-tip { display:none; }`(`@container bmap-plan (min-aspect-ratio: 3/2) and (min-width: 300px) {`의 블록)과 `.bmap-plan-side-marks { display:none; }`(`… and (max-height: 159px) {`의 블록)이 있으며, 그 파일의 마지막 규칙 줄이 여전히 `.bmap-plan-preview [data-camera-color] {`로 시작하며, 새 줄에 `#`과 `transition`·`animation`이 없다. `mapPlanPreview.ts`에 `scale: PlanSideScale = planSideScale(map, camera)`가 있다 | 손잡이를 `canEdit` 없이 그림(보기 모드에서 끌린다) / 잠긴 카메라에서도 그림 / 눈금을 잡지 않음(`planSideView(map, camera)` — 점이 포인터에서 달아난다) / 눈금을 렌더의 도면에서 잡음(`origin.map`이 아니라) / 잡은 눈금을 state에 둠(`const [frozen, setFrozen] = useState<PlanSideScale | null>(null);` — 빨리 시작한 끌기의 첫 그림이 다시 맞춘 눈금으로 그려져 한 프레임 흔들린다) / 잡은 눈금을 그리는 데 쓰지 않음(`frozen.current = held;`를 뺌 — 셈은 얼린 눈금으로, 그림은 다시 맞춘 눈금으로 돌아 점이 포인터에서 달아난다) / 어긋남을 재지 않음(`grab: 0` — 점이 누른 자리로 튄다) / 어긋남을 누른 자리로 잼(첫 값이 두세 걸음을 건너뛴다) / 어긋남을 화면 픽셀로 잼(`toY`를 `clientY - rect.top`으로 — 그림이 작을수록 점이 포인터보다 덜 간다. 값은 그래도 10씩 바뀌어 다른 검사가 보지 못한다) / 얼린 눈금을 `frozen.current`만으로 씀(Esc 뒤 진한 고리와 얼린 눈금이 남는다) / 덧붙인 말을 가로로 긴 칸에서 감추지 않음(캡션이 늘 말줄임표로 잘린다) / 고리를 그림의 단위로(가장 작은 그림에서 점과 구분되지 않는다) / 손잡이에 `tabIndex`를 줌 / 누름 영역의 선 폭을 뺌(가장 작은 그림에서 4px이 된다) / 그림의 `touch-action:none`을 뺌(터치·펜의 끌기가 몇 픽셀 뒤 스크롤로 넘어가 취소된다) / 보조 평면도에 `scrub`을 주지 않음 |
| 65 | **`dialogOpen`은 한 줄이고 세 곳이 그것을 읽는다**: 6.1의 만드는 줄이 글자 그대로 있고 `count(editor, /\bdialogOpen\b/g) === 5`. 편집기에 `confirmation \|\| createForm`이 정확히 한 번(그 줄), `!confirmation && !createForm`과 `createForm \|\| linkForm \|\| settingsForm \|\| confirmation`이 없다. 오류 띠 줄이 `{error && !dialogOpen && <div className="bg-error" role="alert" ref={errorRef}>`다 | 줄에서 다섯 가운데 하나를 뺌(하나씩 — `mapDelete`를 빼면 삭제 창 밑에서 초안이 따라가고 오류가 창 밖에도 뜬다) / 오류 띠가 예전 넷을 그대로 적음 / 의존 목록에서 `dialogOpen`을 뺌(창을 닫아도 따라가지 않는다) |
| 66 | **삭제 창은 연 그 도면만 다루고, 계획의 차례대로 보내며, 초안은 자기 도면이 지워진 뒤에만 버린다**: `openMapDelete` 조각에 `if (!settingsForm \|\| disabled \|\| !snapshot.canManage) return;`, `mapId: settingsForm.id`, `mode: 'keep-children'`, `swallowSecondClick();`가 있고 렌더의 `current`가 없다(**렌더의 값을 찾는 정규식은 `/(?<![.\w])(?:이름)\b/`다 — ref의 `.current`는 세지 않는다. 아래의 "없다"도 같다**). `dropGoneDrafts` 조각은 그 한 줄뿐이다(빈 줄을 빼고 `['function dropGoneDrafts() { for (const id of deleteAimed.current) if (!snapshot.maps.some(map => map.id === id)) doc.discard(id); }']`). `runMapDelete` 조각에 차례로 `if (!mapDelete \|\| disabled \|\| deleting.current) return;`, `dropGoneDrafts();`, `planMapDelete(snapshot, settle().drafts, mapDelete.mapId, mapDelete.mode)`, `if (!plan.target \|\| plan.refusal) return;`, `deleteAimed.current = [...new Set([...deleteAimed.current, ...plan.removed])];`, `deleting.current = true; setBusy(true);`, `if (step.type === 'save-maps') await persistMaps(step);`, `else { await execute(step); doc.discard(step.id); done += 1; }`, `setCurrentId(parentId);`, `setError(mapDeleteCauseText(cause));`, `stopped: plan`, `swallowSecondClick();`, `finally { deleting.current = false; setBusy(false); }`. 그 조각에 `message(cause)`와 렌더의 `current`가 없고, **첫 `await` 뒤쪽**에 렌더의 `snapshot`·`current`·`draft`·`maps`가 없으며, `doc.discard(`가 정확히 한 번, `deleting.current = true`가 한 번, `dropGoneDrafts();`가 한 번이다. `closeMapDelete` 조각에 차례로 `if (!mapDelete \|\| disabled) return;`, `dropGoneDrafts();`가 있고, 초안을 버리고 화면을 옮기는 것은 **도면이 없을 때의 가지 안에서만**이다: `block(close, 'if (!snapshot.maps.some(map => map.id === mapDelete.mapId)) {')`에 `doc.discard(mapDelete.mapId);`와 `setCurrentId(mapDelete.parentId);`가 있고, 조각 전체에서 `doc.discard(`와 `setCurrentId(`가 각각 정확히 한 번이다. 그 조각에 렌더의 `current`와 `execute(`가 없다. 편집기에 `'delete-map'`·`먼저 해제해 주세요`·`도면을 삭제할까요`가 없고, `{mapDelete && deletePlan && <BackgroundMapDeleteDialog `가 있으며(`current &&`가 그 앞에 없다), 설정 창의 버튼이 `onClick={openMapDelete}>도면 삭제</button>`다. `mapDelete.ts`에 `mapDraftChanged(`와 `map.revision + (` … `? 1 : 0)`, `validateBackgroundEntity('map',`, `cleanIpcErrorMessage(`가 있고 three.js import와 `document.`·`window.`가 없다(저장 단계의 `expectedRevision`은 글자로 고정하지 않는다 — 삭제의 줄과 같은 글자로 시작해 가릴 수 없고, D-9가 돌려 본다). `BackgroundMapDeleteDialog.tsx`에 `const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };`와, `const hold = (event: KeyboardEvent) => {` 다음의 두 줄 `event.stopPropagation();` · `if ((event.ctrlKey \|\| event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();`가 글자 그대로 있고, `addEventListener('close', reopen)`·`window.addEventListener('keydown', hold, true)`와 두 `removeEventListener`, `useEffect(() => { if (!progress) back.current?.focus(); }, [progress, plan.target === null]);`, `data-autofocus`가 `돌아가기`·`닫기` 버튼에, 지우는 버튼에 `type="button"`이 있고 `<form`이 없다 | 실행이 `current.id`를 읽음(15.4의 문제가 돌아온다) / 여는 함수가 `current.id`를 쥠 / 삭제 앞에서 초안을 한꺼번에 버림(끊기면 남은 도면의 편집이 사라진다) / 닫을 때 초안을 버리는 줄을 `if` 밖으로 옮김(돌아가기·Esc·×가 저장 안 한 변경을 말없이 버리고 위 도면으로 간다) / `dropGoneDrafts`의 조건을 빼거나 뒤집음(멈춘 뒤 돌아가면 아직 있는 도면의 초안이 사라진다) / `dropGoneDrafts();`를 부르지 않거나 `deleteAimed`를 채우지 않음(답 없이 지워진 도면의 초안이 목록에 남는다) / `hold`를 빈 함수로(창이 뜬 채 누른 Ctrl+숫자가 화면을 바꿔 남은 삭제가 끊긴다) / `hold`에서 `preventDefault` 줄을 뺌(Ctrl+R이 화면 전체를 다시 불러와 실행이 끊기고 저장 안 한 편집이 사라진다) / 멈춘 까닭을 `message(cause)`로(설치된 앱에서 채널 이름이 든 영어 껍데기가 뜬다) / `catch`에서 `swallowSecondClick()`을 뺌(지우는 버튼의 둘째 클릭이 다시 켜진 창에 닿는다) / 포커스를 돌려놓는 effect를 뺌(멈춘 뒤 포커스가 창 밖에 남는다) / 저장 단계를 `execute`로 바로 보냄(초안이 다시 놓이지 않아 다음 저장이 거절된다) / 기다림 뒤에 `snapshot`에서 돌아갈 자리를 읽음 / `deleting`을 일찍 돌아가는 검사 앞에서 켬 / 기본을 `'with-children'`으로 / 여는 함수에서 `swallowSecondClick()`을 뺌 / 창을 `current &&`에 닮(도면이 하나도 안 남으면 '없어짐'을 볼 창이 없다) / 삭제 가지를 `confirmAction`에 남김 / 창의 다시 열기 리스너를 뺌 / 지우는 버튼을 폼의 제출 버튼으로 |

**구현하며 더 조인 것(Task 3~5의 검토에서 살아남은 변형 때문에 — 표의 행은 그대로 성립하고 앵커가 더 본다).** 62: 훅의 함수 전체를 줄 단위로 견준다(주석은 뺀다) — 표가 이름한 줄만으로는 `end();`를 빼거나 `swallow`의 본문을 비우는 변형이 살아남았다. 63: 부품 파일 전체를 줄 단위로 견주고(끌개 그림의 두 수만 아무 수), `.bmap-num` 규칙 열둘의 차례와 `MAP_NUMBER_SCRUB.thumbPx`가 점의 `width`·`left`의 수와 같은지도 본다 — 그래서 부품을 `memo`로 감싸도 실패한다. 60: 태그 14개를 통째로(속성 일곱의 차례까지), `NumberField`라는 낱말의 수(15)와 다른 꼴의 숫자 `input`이 없는지, 세 묶음이 고른 노드의 id를 `key`로 쥐는지를 본다. 61: `fieldScrub` 조각과 `setMapNodeNumber` 함수를 줄 단위로 견준다. 64: 옆 그림 부품 파일 전체를 줄 단위로 견주고(위·아래 표시의 `x0`의 수만 아무 수), 손잡이의 CSS 규칙 일곱을 차례째로, 보조 평면도가 넘겨주는 줄들(서명 · 태그 · `mapCanvas.ts`의 계약)과 그 파일에 `memo`가 더 없는지를 본다. 65: `dialogOpen`이 든 다섯 줄을 통째로, 파일의 차례대로 본다. 66: 삭제 창 부품의 줄들과 편집기의 네 핸들러를 줄 단위로, `mapDelete.ts`의 import 세 줄(`mapDraftChanged` · `validateBackgroundEntity` · `cleanIpcErrorMessage`를 스스로 다시 짜지 않았는지)과 삭제 창의 CSS 규칙 아홉을 차례째로 본다. 게이트의 대체안이나 뒤 Task가 이 줄들을 고치면 그 앵커도 같은 커밋에서 고친다.

### 6.3 파일 계획

| 파일(이름만 쓴 것은 `src/features/backgrounds/`) | 새로 · 고침 | 내용 |
|---|---|---|
| `mapNumberField.ts` | 새로 | 숫자 칸의 표와 읽기·쓰기·걸음·막대의 순수 함수(3.1) |
| `useMapScrubPointer.ts` | 새로 | 끌기의 포인터 세션(3.3). 칸과 옆 그림이 함께 쓴다 |
| `BackgroundMapNumberField.tsx` | 새로 | 숫자 칸(3.4) |
| `BackgroundMapPlanSide.tsx` | 새로 | 옆 그림과 손잡이(4.3) |
| `mapDelete.ts` · `BackgroundMapDeleteDialog.tsx` | 새로 | 삭제 계획과 문구(5.1~5.3) · 삭제 창(5.4) |
| `tests/backgroundMapNumberField.test.ts` · `tests/backgroundMapDelete.test.ts` | 새로 | 7.1 · 7.3 |
| `mapCanvas.ts` | 고침 | `MapScrubOrigin`·`MapFieldScrub`, `MapPlanPreviewProps`(3.2). `import type` 한 줄 |
| `mapPlanPreview.ts` | 고침 | 4.2의 더하기. `planSideView`의 셋째 인자. import에 `MAP_SPATIAL_LIMITS` |
| `BackgroundMapPlanPreview.tsx` | 고침 | props 둘을 받아 넘긴다. 옆 그림을 새 부품으로(4.3). 리스너·`activate`·요약 줄은 그대로 |
| `BackgroundMapEditor.tsx` | 고침 | 아래 표 |
| `backgrounds-map.css` · `backgrounds-map-plan.css` | 고침 | 3.5(`.bmap-field-pair` 다음)와 5.4(:238 다음) · 4.4(마지막 규칙의 주석 줄 앞, 그리고 가로로 긴 칸의 두 컨테이너 블록에 한 줄씩). `backgrounds-map.css`의 미디어 블록과 띠의 줄은 건드리지 않는다 |
| `tests/backgroundMapPlanPreview.test.ts` · `backgroundMapEditorWiring.test.ts` · `backgroundDatabaseContract.test.ts` | 고침 | 7.2 · 6.2 · 7.3의 끝 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 고침 | 8절 |

**`BackgroundMapEditor.tsx`에서 고치는 곳과 자리**

| 것 | 자리 | 걸리는 앵커 |
|---|---|---|
| import: 새 부품 둘, `planMapDelete`·`mapDeleteStopText`·`mapDeleteCauseText`와 타입 둘, `mapNodeNumber`·`setMapNodeNumber`와 `MapNumberKey`, `MapFieldScrub`. `MAP_SPATIAL_LIMITS`를 뺀다 | 맨 위 | 60 |
| 상수 `PLAN_LIMIT`·`MIN_PLAN_SIZE`와 그 주석(:106-107), 지역 `NumberField`와 그 주석(:136-156)을 지운다. `round`·`normalizeAngle`은 남는다(다른 곳이 쓴다) | 제자리 | 60. `SECOND_CLICK_MS`·`pressEvents`의 글자는 그대로(52) |
| `confirmation`의 종류에서 `'delete-map'`을 뺀다. `mapDelete` 상태, `deleting`·`deleteAimed` ref | `confirmation`(:238) 다음 | 66 |
| `const dialogOpen = …` | `gestureActive`(:281) 다음 — `listSelection` 조각(:302 → 다음 `useEffect(`)보다 앞 | 65 |
| 따라가기의 가드와 의존 목록, 그 위의 주석 | 제자리(:346, :354-355) | 56(고친다) |
| Ctrl+S의 가드 | 제자리(:432) | 53(고친다) |
| `dropGoneDrafts`·`openMapDelete`·`runMapDelete`·`closeMapDelete` | **`uploadUnderlay` 다음, `function newSpace(` 앞** | 66. `confirmAction` 조각 밖, 앵커 40의 `newSpace` 조각 밖 |
| `confirmAction`의 삭제 가지를 지운다(`async`는 남긴다) | 제자리(:666-677) | 23·29·52가 읽는 세 가지는 그대로 |
| `beginFieldScrub`·`previewFieldScrub`·`fieldScrub` | **`cancelCanvasGesture`(:1019) 다음, `placeAt` 앞** | 61. `keyboard` 조각은 `const selectNode = useEvent(`에서 끝난다 |
| `const deletePlan = useMemo(…)` | `draftChanged`(:1042) 옆 | — |
| 그리는 줄: 오류 띠의 조건(:1082), 보조 평면도 태그(:1179), 숫자 칸 14곳(:1224-1228, :1248-1249, :1254-1255), 설정 창의 '도면 삭제' 버튼(:1302), 공용 확인 창의 제목·글(:1304), 삭제 창(설정 창 다음) | 제자리 | 23(앞부분 그대로)·44(`{!selectedRoad && <NumberField label="입체 높이" ` 그대로)·45·52·54(`<div className="bg-error" role="alert" ref={errorRef}>` 그대로)·58(편집기에 '편집 중'이라는 글자가 생기지 않는다 — 삭제 창의 글자는 모두 `mapDelete.ts`와 창 파일에 있다) |

`patchNode`·`moveSelected`·`persistMaps`·`saveMap`·`requestSave`·`endEditing`·`leaveEditing`·`navigate`·`keyboard`·`pointerDown`~`pointerUp`·`createMap`·`linkMap`·`saveSettings`·`openSettings`의 본문은 한 글자도 고치지 않는다.

### 6.4 건드리지 않는 파일 · 의존 방향

**고치지 않는다**: `src/features/playground/featureFlag.ts`(노출 범위) · `electron/**`와 `DEVLOG/migrations/**`(IPC·메인 프로세스·DB 변경 없음) · `domain.ts`·`types.ts`·`mapWorkflow.ts`(저장 계약과 저장 명령 — 삭제 계획은 그 타입만 읽는다) · `mapDocument.ts`·`mapEditSession.ts`·`useBackgroundMapDocument.ts`(제스처와 초안의 규칙은 그대로 쓴다. 새 액션이 없다) · `mapGeometry.ts`·`mapSpatial.ts`(쓰기는 이미 있는 `transformMapSpace`·`replaceMapNode`·`placeMapNode`다) · `BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`·`backgrounds-map-3d.css`(3D는 초안을 읽어 따라올 뿐이다) · `previewGateway.ts`·`src/mocks/devElectronAPI.ts`·`useBackgroundStore.ts`(같은 두 명령을 같은 길로 보낸다) · `BackgroundUI.tsx`·`BackgroundLibraryView.tsx`·`BackgroundMapPanels.tsx`·`BackgroundMapEditStrip.tsx`·`mapEditStatus.ts`·`BackgroundMapGallery.tsx`·`backgrounds.css`·`src/index.css`(창의 틀·띠·이미지 목록·공용 모양).

의존(한 방향): `mapNumberField.ts → types · mapSpatial · mapGeometry` / `mapCanvas.ts → (타입) mapNumberField` / `useMapScrubPointer.ts → mapNumberField(상수) · (타입) mapCanvas` / `BackgroundMapNumberField.tsx → mapNumberField · useMapScrubPointer` / `BackgroundMapPlanSide.tsx → mapPlanPreview · useMapScrubPointer` / `BackgroundMapPlanPreview.tsx → BackgroundMapPlanSide` / `mapDelete.ts → mapDocument(mapDraftChanged) · domain(validateBackgroundEntity) · src/utils/ipcErrorMessage(껍데기 벗기기 — Node 테스트가 이미 그 파일을 `.ts`로 읽는다, `tests/ipcErrorMessage.test.ts`) · (타입) types · mapWorkflow` / `BackgroundMapDeleteDialog.tsx → BackgroundUI · mapDelete`. 편집기가 모두를 쓴다. Node로 도는 모듈(`mapNumberField.ts`·`mapDelete.ts`·`mapPlanPreview.ts`·`mapCanvas.ts`)의 import는 `.ts` 확장자를 붙이고, 훅 파일도 같은 꼴로 쓴다(`useMapEditColors.ts`처럼). `.tsx`는 지금처럼 확장자 없이 쓴다.

### 6.5 다음 차례를 막지 않는 것

**2차(눈 · 박스로 보기)** — 오브젝트 목록(`ObjectList`, 앵커 36)과 3D 장면은 건드리지 않았다. 끌기와 삭제는 늘 온전한 도면을 쓰므로 보는 방식의 거르기는 그리는 쪽에만 붙으면 된다. **3차(그림 끌어다 놓기)** — 장소를 묻는 창은 `dialogOpen`에 한 낱말로 들고, 핸들러의 자리(`uploadUnderlay` 다음)는 이어서 쓸 수 있다. **보관(편집 상태와 저장 지키기 2차)** — 삭제는 초안을 문서 저장소의 `discard`로만 버리므로 저장소를 컴포넌트 밖으로 들어내면 지운 도면의 보관본도 같은 길로 없어진다. 끌기는 문서의 공개 호출만 쓴다.

## 7. 테스트와 검증

모두 `node --test ./tests/background*.test.ts`(`npm run test:background`)에 들어간다. 지금 582개(577 통과, 5 건너뜀 — PGlite를 지정하지 않은 DB 계약). 새 테스트 파일 둘은 첫 줄이 `import test from 'node:test';`이고 낱말 `skip`·`todo`가 없다(앵커 59).

### 7.1 숫자 규칙 — `tests/backgroundMapNumberField.test.ts` (새)

바탕 도면: 방(회전 30°, 300×200) · 도로 · 그 방에 속한 카메라(높이 키 없음) · 그 방에 속한 의자(`x: 220.5`) · 그 방에 속한 **잠긴** 카메라. 카메라의 방향과 방·도로·의자의 회전은 정수로 둔다(소수가 있는 방향을 **친** 값은 마지막 자리가 흔들린다 — 3.1).

| # | 경우 | 기대 |
|---|---|---|
| N-1 | 표가 저장 모양 안에 있다: 키마다, 그 숫자가 있는 종류마다 `min`과 `max`(돌아가는 값은 0·359·359.9)를 쓴 도면 | `validateBackgroundEntity('map', …)`가 던지지 않는다. 그리고 표의 숫자가 2.1의 오늘 값과 같다(−100000·100000, 1·100000, 10·100000, −90·90, −180·180, 10·170, 돌아가는 둘은 무한) |
| N-2 | `mapNodeNumber`: 종류 × 키 | 3.1의 읽기 표 그대로(방 7가지, 도로 6가지 — 입체 높이 없음, 카메라 7가지, 기호 9가지). 기본값: 카메라 높이 120, 방의 입체 높이 180, 의자 70 |
| N-3 | **끈 값 = 친 값**: 네 노드 × 있는 키 × 값 넷(지금+7, 지금−3, 45, 12) — 친 쪽은 테스트 안에서 `patchNode`·`moveSelected`와 같은 식으로 만든다(`{ ...노드, [키]: 값 }`을 공간이면 `transformMapSpace`, 아니면 그 노드만 바꿈. 방향·회전은 0~360으로. 위치는 `moveMapNode(map, id, 차이)`) | 위치 둘은 모든 숫자가 1e-9 안에서 같고 키 목록이 같으며, 끈 쪽의 그 노드의 `x`·`y`는 정확히 N이다(`===` — 이 단언은 차이로 옮기는 구현을 가르지 못한다: `지금 + (N − 지금)`도 이 값들에서는 정확히 N이다. 그것은 앵커 61의 `placeMapNode(`가 지킨다). 나머지 아홉 키는 `deepEqual`(값이 모두 정수라 방향·회전도 같다). 결과가 저장 검사를 지난다 |
| N-4 | 같은 객체를 돌려주는 것: 없는 id, 잠긴 카메라, 그 종류에 없는 키(방의 `fov`, 도로의 `volumeHeight`), `NaN`, 지금 값(높이 키 없는 카메라에 120), 한계 밖에 저장된 값 그대로(화각이 175인 카메라에 175) | `map` 그 객체(`===`). 화각을 61로 바꾼 카메라에 `elevation` 키가 생기지 않는다. 화각 175인 카메라에 174 → 170 |
| N-5 | 소속이 한 번만 따라간다: 방의 `width` 600, `elevation` 50, `rotation` | 속한 카메라의 위치가 바뀌고 잠긴 카메라는 그 객체 그대로. 바닥 50이면 속한 카메라의 높이가 170 |
| N-6 | `stepNumber`·`scrubSteps`·`settleNumber`·`slideNumber` | 3.1의 표의 모든 줄 — **`slideNumber`의 두 줄 포함**: 같은 115까지를 1px씩·3px씩·한 번에 가서 모두 125(사건마다 걸음을 더하거나 보이는 값에서 걸음을 세는 구현은 여기서 떨어진다), 제자리는 `Object.is`로 244.65, 끄는 도중의 Shift는 누를 때도 뗄 때도 값이 튀지 않고 그 값에서 이어 센다. **그 두 줄의 자리(px)는 글자로 적지 않고 `MAP_NUMBER_SCRUB`의 이름에서 만든다**(괄호 안이 오늘의 상수에서의 값, 곧 표의 수다): 끌기가 시작된 자리 A(104)에서 `A + 5.5 × stepPx`(115)까지 — 1px씩·3px씩 갈 때도 마지막 이동은 그 자리다 — 가면 높이 120이 125이고, 244.65는 `A + stepPx`(106) · A · `A − stepPx`(102)에서 245 · 244.65 · 244다. Shift는 높이 123을 `A + 3 × stepPx`(110)까지 끌어 126인 곳에서 누르고(126 그대로), 거기서 `bigStepPx`(116) · `2 × bigStepPx`(122)만큼 더 가서 130 · 140, 1px 더 간 곳(123)에서 떼고(140 그대로) 거기서 다시 `stepPx`만큼(125) 가서 141이다. 음수(−3.5)와 여러 바퀴(±725)의 줄 포함: 올림을 `Math.trunc`로 하거나 한 바퀴만 돌리는 구현은 그 줄에서 떨어진다. 0걸음은 `Object.is`로 처음 값. `-0`이 나오지 않는다(`Object.is(…, 0)`: `scrubSteps`의 −0.9배, −3.5의 Shift +1). `scrubSteps`도 상수로 묻는다(표의 여섯 값 — −0.9배가 0인 것이 `Math.floor`를 잡는다) |
| N-7 | `trackFraction`·`trackNumber`·`pressNumberTrack` | **3.1의 표의 `pressNumberTrack` 줄 그대로**(점에서 4px 벗어나 잡으면 그 자리의 값이 처음 값이고 1px에 1°씩 간다 — 어긋남을 0으로 두는 구현은 94를 낸다. 점 밖은 `immediate`이고 그 자리의 값. 7px·8px의 가장자리. 좁은 막대는 `null`). **그 줄의 자리(px)도 `MAP_NUMBER_SCRUB`의 이름에서 만든다**(괄호 안이 오늘의 상수에서의 값, 곧 표의 수다): 막대는 왼쪽 0 · 폭 `160 + thumbPx`(170 — 화각 1°가 1px이다), 화각 v의 자리는 `thumbPx / 2 + (v − 10)`(90의 점이 85), 점 안에서 잡는 자리는 점에서 `Math.min(4, grabPx)`px(4 — x 89), 점 밖의 자리는 점에서 `Math.max(30, grabPx + 1)`px(30 — x 115, 그 자리의 값은 90에 그 px을 더한 120), 가장자리는 점에서 `grabPx`(7 — 점 안)와 `grabPx + 1`(8 — 점 밖), `null`은 폭이 `thumbPx`(10) 이하이거나 수가 아닐 때다. 막대가 있는 다섯 키의 범위 안 모든 정수가 `trackNumber(trackFraction(v, 키), 키, false, Number.NaN) === v`(처음 값이 수가 아니면 어느 자리보다도 가깝지 않다). 끝(0·1·범위 밖), Shift, "처음 값이 더 가까우면 처음 값", `trackFraction`의 세 보기(3.1의 표 — 화각 5가 0인 것이 아래쪽 자르기를 잡는다), 회전 −90의 270.2 자리가 `Object.is`로 −90(돌리지 않은 처음 값과 견주는 구현은 270을 낸다), 막대 없는 키는 처음 값 |
| N-8 | 리듀서로: 시작 → 미리보기 셋(`setMapNodeNumber(시작 도면, …)`) → 끝 | 끝나기 전 `mapDraftSteps` 0, 뒤 1. 제자리로 돌아온 끌기는 0걸음이고 초안 값이 시작 도면 그 객체. 취소는 시작 도면. 끌기 둘은 두 단계. 제스처 중의 `update`는 상태를 바꾸지 않는다 |

### 7.2 옆 그림 — `tests/backgroundMapPlanPreview.test.ts`에 더한다 (기존 단언은 그대로)

| # | 경우 | 기대 |
|---|---|---|
| S-1 | **수가 아닌 방**(들어낸 셈이 오늘의 줄 :246을 지키는가 — 두 인자 호출과 셋째 인자를 준 호출을 견주는 것은 같은 함수끼리라 아무것도 잡지 못한다. 두 인자 호출의 값은 기존 단언 :237-336이 그대로 쥔다): `volumeHeight`가 `NaN`인 방 하나뿐인 도면 / 거기에 높이 300인 방을 더한 도면 / 바닥(`elevation`)이 `NaN`인 방. 카메라는 그 방 소속 | `planSideScale` → `{ low: 0, span: 180 }` / `{ low: 0, span: 300 }` / `{ low: 0, span: 180 }`(그 방은 범위에도 기준에도 들지 않는다). `planSideView(map, camera).room`이 `null`이고 그림의 모든 수가 유한하다 |
| S-2 | `planSideScale`(카메라는 높이 키 없음 = 120) | 방 하나·방 없음 → `{ low: 0, span: 180 }`. 높이 720인 카메라 → span 720. 바닥 −90인 도로만 → `{ low: -90, span: 270 }`(방이 없어 180이 꼭대기다). 바닥 −90인 방만 → `{ low: -90, span: 210 }`(카메라 120이 꼭대기다). 도로는 바닥만 든다(바닥 300·입체 높이 400인 도로만 → span 300) |
| S-3 | `planSideY`·`planSideLevel` | 서로의 역(−40·0·37·120·180·225에서 1e-9). y 62 → low, 22 → low+span. `PLAN_SIDE_DRAG.step`이 10이다 |
| S-4 | `planSideDragLevel`(0~180 눈금) | 123에서: 123 자리 → 123, 124.9 → 123, 126.6 → 130, 121.4 → 120, 134 → 130. y 12와 −500 → 230, y 72와 500 → −40. `NaN` → 처음 값. **저장 한계는 양쪽 다**: 눈금 0~100000에서 y 12 → 100000(자리의 높이는 125000이다), 눈금 −100000~0(`{ low: -100000, span: 100000 }`)에서 y 72 → −100000(자리의 높이는 −125000이다). 자르지 않아도 한계인 y 22·62는 쓰지 않는다. **낮은 도면도 10씩**: 입체 높이 30인 방·높이 20인 카메라의 눈금(0~30)에서 y를 0부터 84까지 훑으면 나오는 값이 −10·0·10·20·30·40뿐이다 |
| S-5 | 잡아 둔 눈금: 방에 속한 카메라의 높이를 −40·0·60·180·230, 각도를 0·45·90·−90으로. 그리고 **낮은 도면**: 입체 높이 30인 방에서 높이 20인 카메라를 `planSideDragLevel(눈금, 12, 20)`(= 40)까지 올리고 각도 90 | `floorY`와 `room`이 처음 그림과 같다. 점의 y가 `planSideY(눈금, 높이)`. 화살표가 뒤집히지 않고(위를 보면 dy < 0) 모든 점이 상자(0~84) 안이다. 낮은 도면에서는 점의 y가 8.67이고 화살표 끝의 y가 그보다 크지 않다 — `Math.max(0, …)`이 듣는 곳은 여기뿐이다(없으면 끝이 9.00으로 점 아래에 찍힌다. 0~180 눈금의 스무 가지에서는 그 줄이 있으나 없으나 같다) |

### 7.3 삭제 계획 — `tests/backgroundMapDelete.test.ts` (새)

바탕 라이브러리(버전은 모두 1, `snapshot.maps`의 차례는 적은 차례): **학교 > 본관 > { 2층 > { 2-1 교실, 2-2 교실 }, 지하 }**, 그리고 최상위의 **별관 > 창고**. 연결: 학교의 공간 '본관' → 본관, 본관의 '2층' → 2층, 2층의 '2-1 교실' → 2-1 교실. 2-2 교실·지하·창고는 연결 없이 `parentId`만 있다('＋ 하위 도면 만들기'가 만드는 모양 — 별관은 하위 도면이 모두 그렇다). 장소·배경·묶음·사용 기록을 하나씩 둔다(2-1 교실의 카메라가 그 배경을 가리킨다). **모든 명령은 테스트 안에서 `validateBackgroundRequest`와 `applyBackgroundCommand`(domain.ts)로 돌린다** — 그것이 중간 상태의 검사다.

| # | 경우 | 기대 |
|---|---|---|
| D-1 | 오늘의 거절(바탕선) | 2-1 교실만 지우는 명령은 `상세 도면은 현재 도면의 하위 도면이어야 합니다`, 본관만 지우는 명령은 `참조한 상위 항목이 없습니다`로 던진다. 지하는 통과한다 |
| D-2 | 본관, 남기기 | `entrances` `['본관']`, 하위 `['2층', '지하']`, `nested` 1, 아래 도면 `['2-1 교실', '2-2 교실', '2층', '지하']`. 저장 단계의 도면 = 학교·본관·2층·지하(이 차례). `links` 1(학교가 본관을 여는 것 — 본관이 2층을 여는 것은 세지 않는다). `removed` = [본관]. 명령 = [저장, 삭제(버전 2)]. 끝: `2층<학교`, `지하<학교`, `2-1 교실<2층`, `2-2 교실<2층`, 2층의 공간은 여전히 2-1 교실을 연다 |
| D-3 | 본관, 함께 삭제 | 저장 단계 = 학교·본관·2층(이 차례 — 연결을 가진 것만. `links` 3). `removed`의 이름 = 2-1 교실, 2-2 교실, 2층, 지하, 본관. 삭제의 버전 = 1, 1, 2, 1, 2. 끝: 학교와 별관·창고만 |
| D-4 | 학교(최상위), 남기기 | 저장 단계 = 학교·본관. 본관의 `parentId`가 `null`. `links` 0(학교를 여는 공간은 없다). 끝: 본관이 최상위 |
| D-5 | 지하(하위도 연결도 없다), 두 방식 | 명령 하나(삭제, 버전 1). 2-1 교실 → [저장(2층 하나), 삭제] |
| D-6 | **모든 앞부분이 온전하다**: 도면 여덟 × 두 방식, 명령을 0개~전부까지 앞에서부터 돌린다 | 한 번도 던지지 않는다. 별관 남기기는 [저장(창고 하나), 삭제(버전 **1**)]이다 — 하위 도면이 있다고 지울 도면의 버전에 1을 더하는 구현은 여기서 `다른 사용자가 내용을 변경했습니다`로 멈춘다(지울 도면은 연결이 있을 때만 저장 단계에 든다) |
| D-7 | **끊겼다 이어도 같다**: 같은 조합의 모든 k에 대해, k개를 돌린 라이브러리에서 계획을 다시 만들어 끝까지 | 끝난 라이브러리(도면의 부모와 **버전**까지)가 끊기지 않은 것과 같다. k개 뒤 방식을 바꿔 이어도 던지지 않는다 |
| D-8 | 그 밖의 것 | 장소·배경·묶음·사용 기록이 `deepEqual`. 별관이 값과 버전 그대로 |
| D-9 | 초안(리듀서로 만든 진짜 `MapDraft`): 학교에 저장 안 한 변경(공간 하나 더함, 같은 버전) → 본관 함께 삭제 | 저장 단계의 학교가 **초안의 값**(공간 둘, 본관의 연결은 `null`). `savedAlong` `['학교']`. 깨끗한 초안은 값이 달라도 무시된다(저장된 값이 쓰인다). **깨끗한 초안이 낡은 버전 위에 있어도 그렇다**: 학교가 다른 곳에서 저장돼 버전 2인 라이브러리에서(초안은 버전 1에서 열었다) 거절이 없고, 저장 단계의 학교가 저장된 값이며 `expectedRevision`이 **2**이고, 명령을 끝까지 돌려도 던지지 않는다 — 초안의 `baseRevision`을 보내는 구현은 다른 모든 경우에서 같은 값을 내고 여기서만 `다른 사용자가 내용을 변경했습니다`로 멈춘다. 연결하던 공간을 지운 초안 → 학교가 그래도 저장 단계에 들고 그 공간이 없다 |
| D-10 | 낡은 초안: 학교의 초안이 버전 0 위에 있다 / 지울 2층의 초안이 버전 0 위에 있다 | 둘 다 `refusal` `'outdated'`, `outdated`에 그 이름. 저장 단계에 들지 않는 도면의 낡은 초안은 거절이 아니다 — 남는 별관은 아무 데도 적히지 않고, 지울 2-2 교실은 `lostEdits.below`에 든다 |
| D-11 | 지울 도면의 초안: 본관과 2층에 저장 안 한 변경 → 함께 삭제 / 2층에 저장 안 한 변경 → 남기기 / 2층의 저장된 이름이 '본관'인 라이브러리에서 그 도면만 고친 채 → 함께 삭제 | `lostEdits`가 `{ own: true, below: ['2층'] }`이고 `savedAlong`은 `[]`(지울 도면은 거기 들지 않는다), 저장 단계의 2층이 초안의 값 / `savedAlong` `['2층']`, `lostEdits`가 `{ own: false, below: [] }`, 끝난 2층이 초안의 이름과 `parentId` 학교 / `own`이 거짓이고 `below`가 `['본관']`(이름이 같아도 자리로 가린다) |
| D-12 | 한계: 하위 101개를 남기기 / 같은 것을 함께 삭제 / 하위 100개에 위 도면이 없는 남기기 | `'too-many'`(계획은 통째로 있다: `save`의 도면이 101개, `steps`가 둘) / 거절 없음, 명령 102개(저장 단계 없음) / 거절 없음, 저장 단계 100개 |
| D-13 | 권한 없음 · 없는 도면(권한이 있을 때와 없을 때) | `'rights'`(`steps`는 그대로 있다) · `target` `null`, `steps` 빈 배열, `refusal` `null`(권한이 없어도), `mapDeleteText`는 `null` |
| D-14 | `mapDeleteText`: 5.3의 네 경우와 두 방식 · 학교 남기기 · 별관 남기기(하위 도면이 모두 연결 없이 달렸다) · 학교에 본관을 여는 공간 '뒷문'을 더한 라이브러리의 본관 · 밑그림이 있는 도면 · 초안의 문장 셋(이름 둘을 한 문장으로 잇는 것, D-11의 이름이 같은 경우 포함 — 셋째는 `아래 도면 ‘2-1 교실’의 저장 안 한 변경도 함께 사라져요.`처럼 두 단계 아래의 도면에도 '아래 도면'이다) · 거절 문장 넷 | 글자 그대로. 학교: `하위 도면 1개가 최상위 도면이 돼요. 그 아래 도면들은 그대로 따라가요. 이 도면의 공간에서 하위 도면을 열던 연결은 없어져요.` 별관: `하위 도면 1개가 최상위 도면이 돼요.`에서 끝난다(없는 연결을 말하지 않는다). 뒷문: `‘학교’ 도면의 ‘본관’, ‘뒷문’ 공간에서 이 도면을 열던 연결은 함께 풀려요.` 밑그림: 둘째 문단이 `…기호와 도면 밑그림이 함께 없어져요.…` |
| D-15 | `mapDeleteStopText`: 계획을 k개 돌린 라이브러리로 — D-2(본관 남기기) · D-3(본관 함께 삭제) · D-5(지하) · **D-4(학교 남기기)** · 지하의 공간 하나가 새 하위 도면을 열게 한 라이브러리의 지하 남기기(지하는 본관에 `parentId`로만 달렸다) · D-2의 저장 단계 뒤 다른 곳에서 지하가 지워진 라이브러리 | k=0 → 어느 계획이든 `아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.` 글자 그대로. D-2 k=1 → `지울 도면을 열던 공간의 연결은 풀었어요. 하위 도면 2개는 위로 옮겼어요. 남은 것은 아래에 다시 적었어요. 다시 누르면 남은 것만 이어서 처리해요.` D-3 k=1 → 연결 문장과 꼬리뿐, k=3 → `…도면 5개 가운데 2개를 지웠어요.…`. **D-4 k=1과 지하 남기기 k=1 → `하위 도면 1개는 위로 옮겼어요. 남은 것은 아래에 다시 적었어요. 다시 누르면 남은 것만 이어서 처리해요.`뿐 — 연결 문장이 없다.** 지하가 지워진 경우 → `…하위 도면 1개는 위로 옮겼어요.…`(없어진 도면은 세지 않는다) |
| D-16 | 저장할 수 없는 초안(오브젝트 이름을 비운 변경, 같은 버전): 본관의 초안 → 두 방식 / 학교의 초안 → 본관 남기기 / 지하의 초안 → 본관 함께 삭제 / 학교의 초안이 낡았고 본관의 초안이 저장할 수 없음 → 남기기 | `refusal` `'unsavable'`, `unsavable` `['본관']`(그 명령을 그대로 돌리면 `오브젝트 이름 형식 또는 길이를 확인해 주세요`로 던진다) / `unsavable` `['학교']`이고 `savedAlong`은 `[]` / 거절 없음(지하는 저장 단계에 들지 않는다), `lostEdits.below` `['지하']` / `'outdated'`가 먼저다(`outdated` `['학교']`, `unsavable` `['본관']`) |
| D-17 | `mapDeleteCauseText` | 껍데기를 쓴 한글(`Error invoking remote method 'background:execute': Error: 다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.`) → 껍데기 없는 그 문장. 껍데기 없는 한글 → 그대로. 껍데기를 쓴 `TypeError: fetch failed` · 빈 글 · `Error`가 아닌 것(`null`, 영어 글자) → `서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.` |

`tests/backgroundDatabaseContract.test.ts`의 첫 묶음(진짜 SQL, `BFLOW_PGLITE_MODULE`이 없으면 건너뛴다)에 하위 테스트 하나: 도면 셋(위 → 가운데 → 아래, 연결 둘)을 저장하고 `planMapDelete`의 두 방식의 명령을 차례로 `run`해 통과하는 것, 그리고 저장 단계 없이 가운데를 지우면 22023인 것. 평소 게이트에서는 건너뛴다(건너뜀 5 그대로). PGlite가 있는 환경에서 한 번 돌려 결과를 검증 기록에 적고, 돌리지 못했으면 "확인하지 못한 것"에 적는다.

### 7.4 뮤테이션

앵커는 **뮤테이션으로 확인**한다(저장소 밖 임시 복사본에서 6.2의 변형을 하나씩 넣어 실패하는지 본다). 순수 테스트의 표본도 넣는다. **살아남기 쉬운 것 — 반드시 넣어 본다**: (1) `setMapNodeNumber`에서 `value === current`를 묻지 않고 다듬은 값으로만 물음 — `|| value === current`를 빼고 `if (next === current)`만 남긴다(N-4의 화각 175. 그 줄을 통째로 `settleNumber` 뒤로 옮기는 꼴은 동작이 같아 순수 테스트가 못 잡고 앵커 61의 줄 단위 견줌이 잡는다) (2) `stepNumber`의 `Math.floor`/`Math.ceil`을 `Math.round`로(N-6의 244.65) (3) `trackNumber`의 "처음 값이 더 가까우면" 줄을 뺌(N-7) (4) `planSideDragLevel`의 같은 줄을 뺌(S-4의 124.9) (5) `planSideDragLevel`의 y를 자르지 않음(S-4의 −500) (6) `planSideView`가 셋째 인자를 무시함(S-5) (7) 계획의 삭제 차례를 뒤집음(D-6) (8) 삭제의 버전에서 `+ 1`을 뺌(D-6) (9) 남기기에서 T의 연결을 풀지 않음(D-6 — 저장 단계 뒤에 T의 공간이 옮겨진 도면을 여전히 가리킨다. D-2의 저장 단계 목록도 잡는다) (10) 구조를 초안에서 읽음(D-9의 "연결하던 공간을 지운 초안") (11) 깨끗한 초안의 값을 씀(D-9) (12) 낡은 초안의 거절을 남는 도면에만(D-10의 2층) (13) `mapDeleteStopText`가 센 수를 받음(시그니처가 다르다 — D-15) (14) 편집기: `previewFieldScrub`의 `start`를 `current`로(앵커 61) (15) 훅: `up`에서 `read(event);` 뒤의 `if (active.phase === 'dragging')`를 뺌(62 — 편집기가 취소한 끌기의 놓음이 `finish`를 부른다) (16) 훅: 클릭 삼키기의 `setTimeout` 줄을 뺌(62 — 끈 뒤 화면의 클릭이 영영 먹지 않는다) (17) 옆 그림: `{draggable && `를 누름 영역 줄에서만 뺌(64) (18) `dialogOpen`의 줄에서 `mapDelete`를 뺌(65) (19) `runMapDelete`의 `doc.discard(step.id)`를 반복문 앞의 `for (const id of plan.removed) doc.discard(id)`로(66) (20) `openMapDelete`의 `settingsForm.id`를 `current.id`로(66) (21) 삭제 창의 `reopen` 리스너나 `hold` 리스너를 뺌, `hold`를 빈 함수로, `hold`를 `stopPropagation()`만 남김(66) (22) 14곳 가운데 '세로 위치'의 `field`를 `x`로, '가로 위치'와 '세로 위치'의 `value`를 맞바꿈(60) (23) `links`를 저장 단계가 푸는 연결 전부로 셈(D-15의 학교 남기기 k=0 — "풀었어요"가 아무것도 하기 전에 나온다) (24) 멈춘 문장의 둘째 줄이 없어진 하위 도면도 셈(D-15의 지하가 지워진 경우) (25) 삭제의 버전에 1을 더하는 조건을 "하위 도면이 있으면"으로(D-6의 별관 남기기) (26) `savedAlong`에 지울 도면도 넣음(D-11의 `[]`) (27) 남기기의 연결 문장을 늘 붙임(D-14의 별관) (28) 숫자 규칙: `scrubSteps`를 `Math.floor`로 / `stepNumber`의 내림을 `Math.trunc`로 / 한 바퀴만 돌림 / `trackFraction`을 위쪽만 자름 / `trackNumber`가 돌리지 않은 처음 값과 견줌(N-6·N-7의 새 줄들) (29) `planSideScale`에서 방의 유한 검사를 뺌, `planSideView`가 수가 아닌 자기 방을 그림(S-1) (30) 훅: 끌기의 시작 자리를 포인터의 자리로(62) (31) 편집기: `beginFieldScrub`의 처음 값을 렌더의 `selected`에서 읽음(61) (32) 부품: `parse`가 빈 글자를 0으로 읽음, `lit`을 `dragging`만으로(63) (33) 옆 그림: `frozen.current = held;`를 뺌, `grab`을 0으로, `live`를 `frozen.current`만으로, 잡아 둔 눈금을 ref 대신 state에 둠(64) (34) `closeMapDelete`의 `doc.discard(mapDelete.mapId)`와 `setCurrentId(…)`를 `if` 밖으로(66) (35) `dropGoneDrafts`의 조건을 빼거나 뒤집음(66) (36) `runMapDelete`에서 `dropGoneDrafts();`나 `deleteAimed`를 채우는 줄을 뺌(66) (37) 저장 단계의 `expectedRevision`을 초안의 `baseRevision`으로(D-9의 낡은 깨끗한 초안) (38) 계획이 초안의 값을 미리 보지 않음, `unsavable`의 도면을 `savedAlong`에도 넣음(D-16) (39) `slideNumber`가 사건마다 걸음을 더함 / 보이는 값에서 걸음을 셈(`stepNumber(slide.value, …)`) / Shift가 바뀔 때 기준을 옮기지 않음(N-6) (40) `pressNumberTrack`의 어긋남을 0으로 / `immediate`를 늘 참으로(N-7) (41) `planSideDragLevel`이 저장 한계의 아래쪽을 자르지 않음(S-4의 −100000) · `planSideView`의 `Math.max(0, …)`을 뺌(S-5의 낮은 도면) · 걸음을 눈금 범위에 따라 바꿈(S-4의 낮은 도면) (42) `mapDeleteCauseText`가 껍데기를 벗기지 않음 / 영어 글을 그대로 냄(D-17) · `runMapDelete`의 `catch`가 `message(cause)`를 씀, `swallowSecondClick();`을 뺌(66) (43) 훅: `pointerId` 가드 하나를 뺌 / 문턱을 `Math.hypot`으로 잼 / `buttons` 줄을 뺌 / 내려갈 때의 `active.end();`를 `dragging` 조건 안으로 / 남은 세션에서 `giveUp()` 대신 돌아감(62) (44) 부품: 칸의 줄에서 `max=`를 뺌 / `anchorValue`를 렌더의 `value`로 / 이름의 `onPointerDown`을 뺌(63) (45) 옆 그림: `toY`를 `clientY - rect.top`으로 / 캡션을 한 덩어리 글로(64) (46) 멈춘 문장의 '아무것도 아니다' 가지를 예전 글로(D-15) · 아래 도면의 문장을 '하위 도면'으로(D-14).

### 7.5 빌드 게이트와 통과 기준

- `test:background`는 파일 이름의 무늬라 새 파일 둘이 저절로 들어간다. 지워지거나 이름이 무늬 밖으로 바뀌면 조용히 초록불이므로 앵커 59의 목록에 둘을 더한다(각각 줄 맨 앞의 `test(`가 셋 이상, `skip`·`todo` 없음).
- 앵커는 파일 시스템을 읽으므로 **git에 올리지 않은 파일**을 보지 못한다. PR을 만들기 전에: `git status --porcelain -- src/features/backgrounds tests docs DEVLOG`에 `??`가 없고, `git ls-files --error-unmatch`가 새 파일 여덟(6.3)과 이 문서에 성공한다.
- 통과 기준: `npm run typecheck`, `npm run test:background`(582 + 새 테스트, 건너뜀 5 그대로), `npm run test:motion`(CSS를 고친 단계부터), 마지막에 `npm run build:vite`.

### 7.6 수동 검증 (앱 엔진: Electron 33)

방법은 v1.135.0과 같다: `npm run dev:renderer` + 화면 밖 검사 창(Electron 33 = Chromium 130, `http://127.0.0.1:5190/?preview=1`, 미리보기 시험 계정), 실제 마우스·키 입력, **페이지 포커스를 켠 채**(꺼져 있으면 칸의 값이 낡아 보인다). 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고 나머지 세 조합에서는 ★를 다시 본다. 저장 모양을 바꾸지 않으므로 미리보기 저장소를 다른 세션과 함께 써도 된다 — **삭제 항목은 저장소를 비우고**(`localStorage.removeItem('bflow-background-library-preview-v1')` 뒤 새로 고침 — 검사 창 자신의 프로필에서만. 같은 프로필을 쓰는 다른 세션이 있으면 그 자료도 지워진다) 기본 자료에서 시작한다. 검사 창에는 포인터 캡처가 없다 — 끌개를 누른 뒤 도면 위로 옮겨 놓아도 끌기가 이어지고 끝나야 한다(창 리스너). 그리고 포인터가 창 밖으로 나가지 못한다: 멀리 가는 값(한계까지, 470 → 600)은 Shift로 끌거나 여러 번 끈다. 이동은 한두 번에 보내도 된다 — 값은 포인터의 자리로만 정해진다(3.3. 그것 자체는 N1·N8·H2가 1px씩 보내서 본다). **이동 사건은 누른 왼쪽 단추를 실어 보낸다**(`sendInputEvent`의 `modifiers: ['leftButtonDown']`) — 단추 없이 온 이동은 훅이 놓음으로 읽는다(3.3. 3D 손잡이가 전부터 같은 것을 본다). 표의 **"제자리"**는 끌기가 시작된 자리, 곧 누른 곳에서 처음 움직인 쪽으로 4px 간 곳이다(누른 곳 자체가 아니다 — 거기는 숫자 칸에서 2걸음, 옆 그림에서 4px만큼의 높이가 처음 값과 다르다: 점이 포인터를 4px 뒤에서 따라온다). 표에서 번호 둘을 한 줄에 쓴 곳은 `‖`가 두 항목의 할 일과 봐야 할 것을 가른다.

- **끊김 넣기**(검사 창의 페이지에서): k번째 명령을 거절 — `(() => { const api = window.electronAPI, real = api.backgroundExecute.bind(api); window.__n = 0; api.backgroundExecute = async request => { if (++window.__n === K) throw new Error(WHY); return real(request); }; })()`(`K`에 수를 넣는다. 저장소는 부를 때마다 `api.backgroundExecute`를 읽는다 — useBackgroundStore.ts:16). **던지는 글 `WHY`는 설치된 앱의 꼴로 둘을 쓴다**(미리보기에는 IPC가 없어 껍데기가 저절로 생기지 않는다): 서버의 거절 `"Error invoking remote method 'background:execute': Error: 끊김(시험)"`, 끊긴 연결 `"Error invoking remote method 'background:execute': Error: TypeError: fetch failed"`. 실행은 하고 답만 잃기 — 같은 꼴에서 `const result = await real(request); if (++window.__n === K) throw new Error(WHY); return result;`. 호출 수 `window.__n`을 읽어 "더 나간 명령이 없다"를 확인한다. 느린 실행은 `await new Promise(done => setTimeout(done, 1500))`을 `real` 앞에 둔다. 답과 다시 읽기를 모두 잃기 — 답을 잃는 그 줄에서 `window.__lost = true`도 켜고, `api.backgroundRead`를 같은 꼴로 감싸 `if (window.__lost) throw new Error('읽기 실패(시험)');`를 앞에 둔다. **깃발은 검사하는 쪽이 끈다** — 미리보기 저장소는 자기 쓰기 뒤에 변경 신호를 내고(previewGateway.ts:60) 저장소는 그 신호로 곧바로 한 번 더 읽으므로(useBackgroundStore.ts:26, :73), 읽기를 한 번만 잃으면 뒤처진 모습이 몇 밀리초 만에 사라진다. 문장을 본 뒤 `window.__lost = false; window.dispatchEvent(new Event('focus'))`로 읽기를 살린다(BackgroundLibraryView.tsx:69).
- **다른 PC 흉내**: 미리보기 저장소(`localStorage`의 그 키)를 직접 고쳐 쓰고 `new BroadcastChannel('bflow-background-library-changed').postMessage({ changed: true })`.
- **읽기 전용 흉내**(v1.135.0의 U1·U2와 같다): `(() => { const api = window.electronAPI, real = api.backgroundRead.bind(api); api.backgroundRead = async () => ({ ...await real(), canManage: false }); })()` 뒤 라이브러리의 새로고침을 누르거나 변경 신호를 보낸다.

**먼저 — 엔진 동작(10.1의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 ★ | 칸 이름을 그냥 누른다. 끌개를 그냥 누른다. 이름·끌개를 6px 끌었다 놓는다 | 누르면 둘 다 그 칸에 포커스. 끌개의 그림이 ↔(화살대가 있다 — 꺾쇠 둘이 아니다). 끈 뒤에는 칸에 포커스가 없고 포커스가 도면(3D는 3D 영역)에 있다 |
| E2 ★ | **고치기 전에(9절의 0번)**: 소수가 있는 값(244.65)과 정수인 값의 숫자 칸에 포커스를 두고 ↑·↓를 한 번씩, 그리고 그 칸 위에서 휠 — 나온 값을 적어 둔다. **4단계 뒤**: 같은 것, 그리고 마우스를 올림 | ↑↓와 휠의 결과가 고치기 전에 적어 둔 것과 글자 그대로 같다(값이 무엇이든 — `step="any"`라 소수가 남을 수 있다. 달라졌으면 고칠 일이다). 작은 화살표가 없다 — 가리켜도, 칸에 포커스가 있어도(그래도 보이면 10.1의 대체안) |
| E3 ★ | 옆 그림 손잡이: 점 가운데에서 상·하·좌·우 11px과 13px의 `document.elementFromPoint`. 세 배치 — 1440의 글자 아래 / 740 / **가장 작은 칸: 1440에서 '속성 접기'를 누르고(보조 평면도가 300px 이상이 된다) 도면 높이를 가장 낮게(180px) — 조절선은 캡처로 끌려 검사 창에서 끌 수 없으므로, 조절선에 포커스를 주고 Home을 누르거나 `localStorage`의 `bflow.background-map.panel-height.v1`을 `180`으로 쓰고 새로 고친다** | 여덟 자리 모두 `.bmap-plan-side-grab`(누름 영역의 반지름이 14px 이상이다). 가장 작은 칸의 그림 높이가 38px 안팎이다(그 배치에 들어섰다는 확인) |
| E4 | 평면에서, 끈 뒤 도면의 `outline`을 읽는다: ① 마우스로만(마지막 클릭 뒤 키를 누르지 않고) 끌개를 끈다 ② 칸에 숫자를 친 직후, 그리고 Ctrl+Z를 누른 직후 끌개를 끈다 ③ 견줄 것(오늘과 같은 길이다): 칸에 숫자를 친 직후 도면을 누른다 | ①에는 고리가 없다(있으면 고친다). ②와 ③은 본 대로 적는다 — 보이면 보조 강조색 2px의 키보드 고리이고 ②와 ③이 같다. 받아들인다(10.1) |
| E5 | 삭제가 도는 동안(끊김 넣기를 느린 실행으로 바꿔) Esc를 두 번, ×를 누른다. 같은 동안 Ctrl+2, Ctrl+S, Ctrl+R을 누른다 | 창이 그대로 떠 있고 실행이 끝까지 간다(`window.__n`이 끝까지 는다). 화면이 바뀌지 않고, 저장이 나가지 않고, 페이지가 다시 불려 오지 않는다 |
| E6 ★ | 끌개를 누르고 → **한 번에** 속성 칸 밖(도면 위)으로 옮기고 → 놓는다. 740에서는 도면이 속성 칸 위에 있으므로 위로 가면서 **옆으로도 60px** 옮긴다(끌기는 옆으로 간 거리로만 시작되고 센다) | 옆으로 옮긴 거리만큼 값이 바뀌어 있고(누른 곳에서 4px 뒤부터 2px에 1씩 — 60px이면 +28) 놓으면 띠의 수가 1 는다. 놓은 자리의 도면에 클릭이 닿지 않는다(선택이 그대로다) |

**숫자 칸**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| N1 ★ | 카메라의 '카메라 높이' 끌개: 3px, 이어 오른쪽으로 12px 더(누른 곳에서 15px), 놓음, Ctrl+Z. **같은 15px을 1px씩 열다섯 번, 3px씩 다섯 번으로도**. Shift를 누른 채 16px을 1px씩 | 3px에서는 변화 없음. 15px에서 **처음 값 +5** — 한 번에 보내든 1px씩·3px씩 보내든 같다(4px 뒤부터 2px에 1씩. 진짜 마우스는 1~3px씩 보낸다). Shift의 16px은 큰 걸음 둘(+20). 칸·보조 평면도의 '높이'·3D의 카메라가 걸음마다 따라오고 띠는 놓을 때만 `저장 안 한 변경 1개`. Ctrl+Z 한 번에 처음 값 |
| N2 | 같은 것을 칸 이름으로. 왼쪽으로도 | 같다. 왼쪽은 줄어든다 |
| N3 ★ | 종류마다 모든 칸을 한 번씩, 평면과 3D에서: 카메라 일곱(높이·방향·위아래 각도·기울기·화각, 위치 둘), 방 일곱(바닥·입체 높이, 위치 둘, 길이 둘, 회전), 도로 여섯, 기호 아홉 | 끄는 동안 평면의 도형·3D의 상자가 따라온다. 방의 길이·회전·바닥 높이에서 속한 카메라·기호가 함께 간다 |
| N4 | Shift: 높이·위치·길이, 각도, 화각. 끄는 도중 Shift를 눌렀다 뗀다 | 10 · 15° · 10°의 배수. 누르고 뗄 때 값이 튀지 않는다 |
| N5 | 한계와 돌기(먼 값은 Shift로 끌거나 여러 번 끈다): 화각 170에서 오른쪽, 위아래 각도 ±90, 입체 높이를 1까지, 길이를 10까지, 방향 359 → 오른쪽, 0 → 왼쪽 | 한계에서 멈춘다. 방향은 359 → 0 → 1, 0 → 359 |
| N6 | 소수가 있는 값(평면에서 끌어 만든 위치): 한 걸음, 그리고 제자리로 돌아와 놓음 | 첫 걸음에 정수. 제자리에서는 처음 값 그대로이고 띠의 수가 그대로다 |
| N7 | 끄는 도중 Esc. 다각형 도구로 점을 둘 찍어 둔 채로도 | 처음 값, 띠 그대로, 도구와 찍던 점 그대로. 계속 움직여도, 놓아도 변화 없음 |
| N8 ★ | 막대(일곱 칸): 선을 누름, 이어 끎, 점을 누르기만 함, 점을 끎, Shift. **점의 가운데에서 4px 벗어난 곳을 잡아 1px씩 움직인다**. 저장소에 화각 175를 써 둔 카메라 | 누른 자리로 값이 가고 끌면 따라온다. 점을 누르기만 하면 변화 없음(띠 그대로). 벗어난 곳을 잡아도 값이 튀지 않고 1px에 그 막대의 1px만큼(화각 2°쯤, 방향 4°쯤)만 간다 — 4px만큼(화각 7°, 방향 15°) 튀면 어긋남을 잃은 것이다. Shift는 큰 걸음. 175는 점이 오른쪽 끝. 두 칸 줄의 막대는 그냥 누르면 4°쯤의 간격으로만 닿는다(90을 겨눠도 89나 93 — 흠이 아니다. Shift면 90). 점에 테두리가 있다. **어두운·밝은 화면 모두에서** 막대의 선이 보이는지 본다(안 보이면 10.1 — 두 화면에 함께 고친다) |
| N9 | 방의 '가로 길이'를 Shift로 600까지 끈 도면(기본 자료의 470에서)과, 같은 처음 도면에서 600을 친 도면을 각각 저장. **"같은 처음"은 저장소의 그 키의 글자를 첫 번째 앞에 떠 두었다가 두 번째 앞에 되돌려 놓아 만든다** — 저장소를 비우면 기본 자료가 새 id로 다시 만들어져(previewGateway.ts:21) 두 JSON이 id에서 갈린다 | 미리보기 저장소의 그 도면 JSON이 같다(속한 카메라·기호 포함. 버전까지). '바닥 높이'·'회전'도 |
| N10 | '입체 높이'에 `1000000`을 치고 포커스를 둔 채 '바닥 높이'의 끌개를 끈다. Ctrl+Z 두 번. 이어서 '입체 높이'에 `0`을 치고 포커스를 둔 채 **그 칸 자신의** 끌개를 오른쪽으로 끈다 | 입체 높이가 100000으로 확정되고(한 단계) 끌기가 다음 단계다. 두 번에 처음으로. `0`은 칸을 떠나며 1이 되고, 끌기는 **그 1에서** 시작한다(2, 3… — 화면에 그려져 있던 180에서 시작하지 않는다) |
| N11 | 잠긴 노드. 저장이 도는 동안(느린 저장 흉내) | 이름·끌개·막대가 흐리고 커서가 기본이며 눌러도 변화 없음 |
| N12 | 끈 직후 도면을 누르지 않고 Delete, Ctrl+Z, Ctrl+S | 모두 듣는다 |
| N13 ★ | 폭: 1440(속성 칸 260px), 창 1000(230px), 740(도면 아래) — 속성 칸에 세로 스크롤 막대가 있는 채로(편집 중의 보통 모습). 숫자 칸에 `-100000`을 쳐 두고 **잰다**: 그 `input`의 `scrollWidth <= clientWidth` | 세 폭 모두에서 참이다(눈으로 보지 않는다 — 1000에서는 여유가 4px쯤이다. 거짓이면 3.5의 대로 끌개 폭과 상자의 왼쪽 여백을 4px씩 줄인다). 두 칸 줄이 유지되고 끌개가 상자 안 왼쪽 끝에 있다. 막대와 점이 칸 폭 안이다. 740에서 속성 칸이 휠로 스크롤된다. **밝은 화면에서 끌개를 가리킬 때와 끄는 동안 ↔와 칸 이름이 또렷이 읽힌다** |
| N14 | 3D의 '이 카메라 시점으로 보기' 중 화각·위아래 각도·카메라 높이를 끈다 | 구도가 걸음마다 바뀐다 |
| N15 · N16 | 끄는 동안 오브젝트 목록·이미지 목록·되돌리기 버튼 ‖ 평면에서 여러 개 선택 / 3D에서 묶음이 있을 때 | 목록은 놓을 때 따라오고 버튼은 끄는 동안 꺼져 있다 ‖ 칸이 없다(요약) / 고른 하나의 칸이 끌리고 묶음은 그대로다 |
| N17 | 평면: F2로 이름 상자를 열어 이름을 고친 채(확정하지 않고) 끌개를 끈다. Ctrl+Z 두 번 | 이름이 확정되고 상자가 닫힌 뒤 끌기가 다음 단계다. 두 번에 처음으로 |
| N18 | 속성의 '이름' 칸에 한글을 조합하던 중(CDP)에 끌개를 끈다. Ctrl+Z 두 번 | 조합하던 글자까지 이름에 남는다. 이름과 끌기가 따로 한 단계씩이고 잃은 글자가 없다 |
| N19 | 끌개를 누르고 **위로만** 10px 움직였다 놓는다. 끄는 도중 왼쪽 단추 없이 오른쪽 단추만 실은 이동을 보낸다(`modifiers: ['rightButtonDown']` — 다른 단추를 누른 채 왼쪽 단추를 놓은 것) | 움직이는 동안 아무것도 바뀌지 않고(포커스도 그대로) 놓으면 누르기만 한 것과 같다(칸에 포커스) ‖ 끌기가 그 자리에서 끝난다: 띠 +1, 그 뒤의 이동에 값이 따라오지 않는다 |
| N20 | 끌개를 누른 채(움직이기 전) 스크립트로 다른 노드를 고르고(오브젝트 목록의 다른 줄을 `click()`) 10px 움직인다. 놓고, 새로 고른 노드의 끌개를 끈다 | 새로 고른 노드의 값이 변하지 않고 띠가 그대로다(내려간 칸의 리스너가 남아 있지 않다). 그 뒤의 끌기는 보통처럼 된다 |

**옆 그림의 높이**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| H1 ★ | 3D, 편집 중, 카메라를 고른다. 세 배치: 보통(글자 아래) / **가로로 긴 칸에 캡션이 보이는 크기**(보조 평면도가 폭 300px 이상·3:2 이상이면서 높이 160px 이상 — 1440에서 '속성 접기'를 누르고 도면 높이를 E3의 방법으로 조금씩 올려 맞춘다. 그림이 글자 옆에 있고 캡션이 보이면 그 배치다) / 가장 작은 칸(E3의 셋째 배치) | 보통: 점 둘레의 옅은 고리(점의 테두리 밖으로 2px쯤 — **점과 구분된다**)와 왼쪽의 작은 위·아래 표시, 캡션 `옆에서 본 방향 · 점을 끌어 높이 조절`(잘리지 않는다), 점 위에서 위아래 화살표 커서. 가로로 긴 칸: 캡션이 `옆에서 본 방향`뿐이고 말줄임표가 없다. 가장 작은 칸: 캡션과 위·아래 표시가 없고 고리가 점과 구분된다. 보통 배치의 가장 낮은 그림(54px)에서 표시가 고리와 붙어 보이면 10.1 |
| H2 ★ | 점 가운데를 누르고 3px, 이어 위로 12px(누른 곳에서 15px), 놓음, Ctrl+Z. 다시: 누른 뒤 **1px씩** 위로 8px — 그리고 아래로도. 점 가운데에서 10px 벗어난 자리(누름 영역 안)를 눌러서도 | 3px에서는 변화 없음. 4px에서도 처음 높이 그대로이고, 1px씩 올리면 **130을 거쳐 140**이 된다(건너뛰지 않는다 — 아래로는 110을 거쳐 100). 15px에서는 10의 배수다. 벗어난 자리를 눌러도 같다(점이 누른 자리로 튀지 않는다). **점이 포인터를 따라온다**: 15px 끈 뒤 점의 가운데(`getBoundingClientRect`)와 포인터 사이의 거리가 끌기가 시작될 때의 거리와 한 걸음(화면에서 1.0~2.5px) 안에서 같다 — 그림이 작은 배치(54px)에서도(어긋남을 화면 픽셀로 재면 점이 15px의 0.64배만 간다). 끄는 동안 '높이'가 카메라 색이고 3D의 카메라와 속성의 '카메라 높이' 칸이 따라온다. 바닥 줄과 방 상자는 움직이지 않는다. 놓으면 띠 +1, Ctrl+Z 한 번 |
| H3 | 높이 123인 카메라를 위로 끌었다 제자리로. 미리보기 기본 자료의 '교실 → 복도'(높이 키 없음)를 끌었다 제자리에 놓고, **다른 것(공간 하나)을 옮겨 저장한 뒤** 저장소의 그 카메라를 본다 | 130, 140 … 그리고 123. 제자리에 놓았을 때 띠 그대로. 저장된 그 카메라에 `elevation` 키가 없다(저장하지 않고 보면 예전 자료라 아무것도 말해 주지 않는다) |
| H4 | 아주 위로, 아주 아래로 끈다 — **범위 밖에 있는 동안 캡처한다**. 놓고 다시 끈다 | 0~180 도면에서 230과 −40에서 멈춘다. 끄는 동안의 캡처에서 바닥 줄과 방 상자가 끌기 전과 같은 자리다(눈금이 얼어 있다). 놓으면 그림이 다시 맞춰지고(카메라가 맨 위 줄에, 방이 작아진다) 다시 끌면 더 간다 |
| H5 | 끄는 도중 Esc — **그 뒤 포인터를 움직이지 않고 본다**. 끄는 도중 창이 포커스를 잃음(blur 사건) | 처음 높이, 띠 그대로, 고리가 평소 진하기로, '높이'가 평소 색으로 |
| H6 | '이 카메라 시점으로 보기'를 켠 채 끈다 | 3D의 구도가 바뀐다(전후 캡처) |
| H7 ★ | 잠긴 카메라 · 저장 중 · '편집 끝내기' 뒤 · 편집을 시작하기 전 | 점만 있다(고리·표시 없음), 캡션 `옆에서 본 방향`, 커서 기본, 눌러도 변화 없음. **편집을 시작하기 전의 그 `<figure>`의 `outerHTML`과 캡처가 고치기 전에 떠 둔 것(9절의 0번)과 같다** |
| H8 | 색 있는 카메라(청록·분홍) | 고리·표시·끄는 동안의 '높이'가 그 색 |
| H9 · H10 | 보조 평면도를 접음 / 250px보다 낮은 세로 칸 / **끄는 도중 스크립트로 접는다**(`document.querySelector('.bmap-plan-toggle').click()` — 포인터는 끌고 있다) ‖ 입체 높이 100인 방만 있고 카메라 높이가 60인 도면 / 30인 방만 있고 카메라 높이가 20인 도면 | 그림이 없다(지금과 같다) / 처음 높이로 돌아가고 띠 그대로다 ‖ 둘 다 10씩이다(알린 대로): 60 → 70 → 80…, 130과 −20에서 멈춘다 / 20 → 30 → 40에서 멈추고 아래로는 10 → 0 → −10(자리가 여섯뿐이다) |
| H12 | 점을 누르고 **옆으로만** 10px 움직였다 놓는다 | 아무 일도 없다(제스처가 시작되지 않는다 — 띠·되돌리기·포커스 그대로, 눈금이 얼지 않는다) |
| H11 | 속성의 '이름' 칸에 한글을 조합하던 중(CDP)에 점을 끈다. Ctrl+Z 두 번 | N18과 같다: 조합하던 글자까지 이름에 남고, 이름과 끌기가 따로 한 단계씩이다 |

**도면 삭제**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| D1 ★ | 2-1 교실에서 도면 설정 → 도면 삭제 | 창 `도면 삭제`, 세 문단(연결 문단 포함), 선택 없음, `돌아가기`(포커스) · `도면 삭제`. 누르면 2층으로 가고 2층의 '2-1 교실' 공간에 '상세 도면 ↗'이 없다. 예전의 "먼저 해제해 주세요"가 어디에도 없다 |
| D2 ★ | (비우고) 본관 삭제, 그대로(남기기) | 숫자 문단(하위 1개, 그중 1개…, 모두 2개), 남기기가 골라져 있음, `이 도면 1개만 삭제`. 끝: 학교 > 2층 > 2-1 교실, 2층의 공간은 2-1 교실을 여전히 연다, 화면은 학교이고 가지가 펴져 있다 |
| D3 | (비우고) 본관 삭제, 함께 삭제 | `도면 3개 모두 삭제`, 도는 동안 `삭제 중… k/3`(저장 단계 동안 `0/3` — 버튼에 적혀 있던 그 3이다)이고 문단·선택·숫자가 누른 때 그대로다(느린 실행으로 본다). 끝: 학교만 |
| D4 · D5 | (비우고) 학교 삭제, 남기기 — **K=1 거절로 한 번 멈춘 뒤 다시 누른다** ‖ 새로 만든 최상위 도면(공간 없이) 삭제 | `하위 도면 1개가 최상위 도면이 돼요. …`. 멈췄을 때는 `아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. …`다 — 아무것도 하지 않았으니 연결을 풀었다는 말이 없다(같은 것을 K=2 거절로 멈추면 `하위 도면 1개는 위로 옮겼어요. …`뿐). 끝: 본관이 최상위, 화면은 목록의 첫 도면 ‖ 두 문단, 명령 하나, 도는 동안 `삭제 중…` |
| D6 ★ | (비우고) 본관 함께 삭제에 끊김: K=1 거절(서버의 거절 꼴) / K=3 거절(끊긴 연결 꼴) 뒤 다시 누름 / 마지막 명령의 답만 잃음 — **보기 모드와 편집 중 각각** | 까닭 줄이 `끊김(시험)`뿐이고(**창 안에는 `Error invoking…`이 어디에도 없다** — 창 뒤 라이브러리의 빨간 줄은 10.3대로 껍데기째일 수 있다) 그 아래 `아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. …` / 까닭 줄이 `서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.`(영어가 없다), 멈춘 문장(`…도면 3개 가운데 1개를 지웠어요.…`), 창의 숫자가 남은 것으로 바뀜, 다시 누르면 끝까지 / `‘본관’ 도면은 이미 삭제됐어요.`와 `닫기`뿐, 닫으면 학교로. 멈춘 뒤 `document.activeElement`가 `돌아가기`이고('없어짐'에서는 `닫기`), 멈춘 직후 0.5초 동안은 누름이 듣지 않는다. **그 뒤 더 나간 명령이 없고 목록의 첫 도면의 버전이 그대로다**(15.4) |
| D7 | 2층을 고치고 저장하지 않은 채 목록으로 2-1 교실에 가서 삭제 | 창이 `‘2층’ 도면의 저장 안 한 변경은 이번에 함께 저장돼요.` 삭제 뒤 화면은 2층이고 편집 중이며, 띠는 저장 알림 없이 **곧바로** `저장된 그대로예요`다(되돌리기 꺼짐 — 누를 때 보던 도면은 지운 2-1 교실이었다, 5.5). 새로 고침 뒤에도 고친 것이 있다 |
| D8 | 지울 도면 자신을 고친 채 삭제 / 아래 도면을 고친 채 함께 삭제 | `이 도면의 저장 안 한 변경은 함께 사라져요.` / `아래 도면 ‘…’의 저장 안 한 변경도 함께 사라져요.` |
| D9 | 2층을 고친 채, 저장소에서 2층의 버전을 올려 둔다(다른 PC 흉내). 2-1 교실 삭제 창 ‖ 2층의 공간 이름을 비운 채(저장하지 않고) 2-1 교실 삭제 창 | 지우는 버튼이 꺼져 있고 `‘2층’ 도면이 다른 곳에서 먼저 바뀌었어요. …` ‖ 지우는 버튼이 꺼져 있고 `‘2층’ 도면에 저장할 수 없는 변경이 있어요. …`. 2층에서 이름을 다시 적으면 삭제가 된다 |
| D10 ★ | '도면 삭제'를 더블클릭 ‖ (K=1 거절을 걸고 — 저장소가 곧바로 거절한다) 삭제 창의 지우는 버튼을 더블클릭 | 창이 뜨고 선택과 버튼이 그대로다(0.5초). 그 뒤에는 눌린다 ‖ 나간 명령이 하나뿐이고(`window.__n`이 1) 선택이 남기기 그대로다. 0.5초 뒤에는 지우는 버튼이 다시 눌린다 |
| D11 | 뜬 뒤 0.5초 안의 Enter / 0.5초 뒤의 Enter / Esc(뜨자마자도) / ×(0.5초 뒤) / Tab을 한 바퀴 / 방향키·Space(0.5초 뒤) / **창을 열기 전에 숫자 칸에 값을 하나 쳐 둔다(엔진의 글자 되돌리기에 되돌릴 것이 있게). Tab을 끝까지 돌려 포커스가 창 밖에 놓인 뒤, 그리고 `돌아가기`와 ×에 포커스를 둔 채** Ctrl+S, Ctrl+2, Ctrl+Z, Ctrl+Y, Delete, **Ctrl+R, Ctrl+Shift+R** | 아무 일도 없다(창이 그대로다) / 돌아가기 / 닫힘 / 닫힘 / × → 선택 → 돌아가기 → 지우는 버튼 / 선택이 바뀜 / 뒤 화면에 아무 일도 없다: 화면이 바뀌지 않고(Ctrl+2는 앱의 화면 전환 단축키다), 쳐 둔 칸의 값과 띠의 수가 그대로이고(Ctrl+Z), **페이지가 다시 불려 오지 않는다**(Ctrl+R — 페이지에 심어 둔 `window.__mark`가 남아 있고 저장 안 한 변경이 그대로다). 창 메뉴가 없는 검사 창에서는 다시 불려 오지 않는 것이 아무것도 말해 주지 않으므로, 창이 뜬 뒤에 건 `window.addEventListener('keydown', e => …, true)`로 그 세 글쇠(R·Z·Y)의 `defaultPrevented`가 참인 것을 보고(먼저 걸린 `hold`가 막은 뒤다) 창 메뉴가 사는 창에서 다시 본다(아래 ④) |
| D12 ★ | 740×900(검사의 좁은 창. 앱 창은 800px보다 좁아지지 않는다) | 창이 화면 안이고 `돌아가기`와 `도면 3개 모두 삭제`가 한 줄에 선다. 선택 둘이 세로로 |
| D13 | 3D에서 같은 것. 카메라 시점 보기 중에 그 도면을 삭제 | 같다. 위 도면이 3D로 보인다 |
| D14 | 창이 열린 채 저장소에서 그 도면을 지운다(다른 PC 흉내) | `…이미 삭제됐어요.`와 `닫기`. 닫으면 위 도면 |
| D15 · D16 | 삭제 뒤 '배경 목록'·'에피소드별 배경' 탭 ‖ 읽기 전용 계정(위의 읽기 전용 흉내) / **삭제 창을 연 채** 읽기 전용이 된다(흉내를 걸고 변경 신호를 보낸다) | 장소·배경·사용 기록의 수가 그대로. 지운 도면의 카메라가 가리키던 배경이 남아 있다 ‖ '도면 설정' 자체가 없다(지금과 같다) / 창에 `이 계정으로는 도면을 지울 수 없어요.`가 뜨고 지우는 버튼이 꺼지며 `돌아가기`는 듣는다 |
| D17 | 본관과 2-1 교실을 고친 채(저장하지 않고) 본관의 삭제 창을 연다: 돌아가기 / Esc / × / 함께 삭제를 K=1 거절로 멈춘 뒤 돌아가기 | 어느 길로 닫아도 화면은 본관 그대로이고, 두 도면의 저장 안 한 변경이 그대로다(띠의 `저장 안 한 변경 N개`, 목록의 ●). 창은 남기기에서 `이 도면의 저장 안 한 변경은 함께 사라져요.`를, 함께 삭제를 고르면 `아래 도면 ‘2-1 교실’의…`도 보였다(창이 하위 도면이 1개라고 말한 그 창이다 — 2-1 교실은 두 단계 아래다) |
| D18 | 밑그림을 올려 둔 도면의 삭제 창 | 둘째 문단이 `도면에 놓은 공간·카메라·기호와 도면 밑그림이 함께 없어져요. …` |
| D19 | 답과 다시 읽기를 모두 잃기(보기 모드에서, 읽기는 깃발을 끌 때까지 계속 잃는다): 새로 만든 최상위 도면(공간 없이)의 삭제 / (비우고) 본관 함께 삭제의 마지막 명령 | `아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.` / 한 걸음 뒤처진 `…도면 3개 가운데 2개를 지웠어요.…` — 읽기가 죽어 있는 동안 그대로 남아 있고(1초 뒤에 다시 본다) 포커스는 `돌아가기`다. 깃발을 끄고 읽기를 살리면 `…이미 삭제됐어요.`와 `닫기`(포커스)로 바뀐다. 그동안 더 나간 명령이 없고(`window.__n`) 목록의 첫 도면의 버전이 그대로다 |

**물러서지 않은 것(회귀)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| V1 ★ | 숫자 칸에 적기: 범위 안의 값, `-`만, **칸을 비운 뒤 떠남**, 범위 밖의 값 뒤 Tab, Enter, 한 칸에서 여러 번 고친 뒤 Ctrl+Z, 칸에서 Ctrl+S | 글자마다 반영, 비운 칸은 값이 그대로이고(0이 되지 않는다) 떠나면 그 값이 다시 보인다, 떠날 때 한계로, Enter는 칸을 떠남, 한 칸 = 한 단계, 친 값이 저장된다(v1.135.0의 S4·K2·X7과 같다) |
| V2 | 속성의 이름 칸에 한글을 치다가 Ctrl+S(CDP로 조합) | 이름이 정확히 저장된다(v1.135.0의 E6) |
| V3 | 3D 손잡이(이동·회전·크기), 평면의 끌기·크기·회전·점 편집·Alt·상자 선택 | 지금과 같다. 한 번 = 한 단계 |
| V4 ★ | 띠: 높이(40px · 72px), 세 상태, 저장 뒤에도 편집 중, '편집 끝내기'의 더블클릭 | 지금과 같다. 끄는 동안 띠의 높이와 버튼 자리가 그대로다 |
| V5 | Ctrl+S: 설정 창·확인 창·연결 창·**삭제 창**이 열린 채 | 저장하지 않는다 |
| V6 · V7 | 삭제 창을 닫은 뒤, 창이 열린 동안 다른 곳에서 바뀐 깨끗한 초안 ‖ 기호·공간을 지우는 확인 창(Delete, '이 배치 삭제', 묶음 삭제), 버리기 확인 창 | 닫는 순간 따라간다 ‖ 제목·글·버튼이 지금과 같다 |
| V8 | 업데이트 안내(저장소에 모르는 키를 써서) | 탭과 본문이 빠지고 안내만 보인다 |

**진짜 마우스로만 볼 수 있는 것** — 검사 창에는 화면 끝도 포인터 캡처도 없다. 검증 기록의 "확인하지 못한 것"에 적어 두고, 배포 뒤 실기에서 본다: ① 최대화한 창에서 오른쪽 줄의 '입체 높이' 끌개를 오른쪽 화면 끝까지 끈다 — 한 번에 +55 안팎이고, Shift를 누른 채로는 180 → 300이 한 번에 된다(J14) ② 끄는 도중 포인터가 창 밖(다른 모니터)으로 나갔다 들어와도 끌기가 이어진다 ③ 끄는 도중 Alt를 눌렀다 뗀 뒤의 키보드(10.3). **창 메뉴가 사는 창에서 — 배포 전에 본다**: ④ 삭제 창이 뜬 채, 그리고 느린 삭제가 도는 동안 Ctrl+R·Ctrl+Shift+R을 눌러도 화면이 다시 불려 오지 않는다(10.1). 검사 창에 메뉴가 사는지는 삭제 창이 없을 때의 Ctrl+Shift+R이 페이지를 다시 불러오는지로 안다. 죽어 있으면 `npm run preview:electron`의 창에서 본다(기본 창 메뉴를 치우지 않는다 — `scripts/preview-electron.cjs`). **게이트 D에서 정한 것**: 검사 창의 메뉴는 죽어 있다(Chromium은 보이고 활성인 창에서만 메뉴의 단축키를 처리한다 — 게이트 0에서 확인). 메뉴가 사는 창은 한솔의 화면에 창을 띄워 키보드 포커스를 가져와야 해서 띄우지 않았고, 검사 창에서 그 글쇠들의 `defaultPrevented`가 참인 것까지 본 뒤 ④를 **배포 뒤 실기 목록의 첫 줄**로 옮겼다(오늘의 앱이 Ctrl+R을 막는 것과 같은 방법이다). **설치된 앱에서만**(배포 뒤): ⑤ 다른 PC가 먼저 고친 도면의 삭제가 거절될 때 창의 빨간 줄이 `Error invoking…` 없이 한글 문장뿐이다.

## 8. 배포 기록과 문서

- **버전**: `package.json`의 `version`(:3)과 `package-lock.json`의 두 곳(:3, :9)을 `1.136.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다(지금 1.135.1).
- **`DEVLOG/update-notes.json` 맨 앞에 추가**(비개발자 문구, 항목마다 1~3문장. 실제 파일에는 기존 항목과 같은 줄바꿈으로 넣는다):

```json
{
  "version": "1.136.0",
  "title": "배경 도면에서 숫자를 끌어서 바꾸고, 도면을 바로 지울 수 있어요 (시험 중)",
  "items": [
    { "category": "ux", "summary": "속성의 숫자를 좌우로 끌어서 바꿀 수 있어요 (시험 중)", "description": "예전에는 높이·위치·각도 같은 숫자를 직접 적거나 작은 위·아래 화살표를 눌러야 했어요. 이제 편집하는 동안에는 숫자 칸 왼쪽의 ↔ 표시나 칸 이름을 좌우로 끌면 값이 바뀌고, 도면과 3D 화면이 바로 따라 움직여요. Shift를 누른 채 끌면 큰 걸음으로 바뀌고, 끄는 도중 Esc를 누르면 원래 값으로 돌아가요." },
    { "category": "ux", "summary": "화각과 각도에는 미는 막대가 생겼어요 (시험 중)", "description": "화각, 방향, 기울기처럼 범위가 정해진 값은 숫자 칸 아래에 막대가 함께 보여요. 막대를 누르거나 점을 끌어서 한 번에 맞출 수 있어요. 숫자를 직접 적는 방법은 그대로이고, 칸에 마우스를 올리면 나오던 작은 화살표는 없어졌어요(키보드의 ↑↓는 그대로 돼요)." },
    { "category": "ux", "summary": "카메라 높이를 '옆에서 본 방향' 그림에서 끌어 바꿀 수 있어요 (시험 중)", "description": "3D에서 카메라를 고르면 나오는 '옆에서 본 방향' 그림은 보기만 됐어요. 이제 편집하는 동안에는 그림 속 카메라 점을 위아래로 끌어 높이를 바꿀 수 있고, 끄는 동안 3D 화면과 숫자가 함께 움직여요. 높이는 10씩 바뀌고, 더 세밀한 값은 속성의 '카메라 높이' 칸에서 맞춰요." },
    { "category": "ux", "summary": "도면을 연결부터 풀지 않고 바로 지울 수 있어요 (시험 중)", "description": "예전에는 도면을 지우려면 다른 도면에서 이어 둔 연결을 먼저 풀고, 하위 도면도 하나씩 정리해야 했어요. 이제 '도면 삭제'를 누르면 연결은 알아서 풀리고, 하위 도면이 있으면 '남기기(한 단계 위로 올라가요)'와 '함께 삭제' 가운데 고를 수 있어요. 장소와 배경 이미지, 에피소드별 사용 기록은 지워지지 않아요." },
    { "category": "bugfix", "summary": "삭제 창이 엉뚱한 도면을 지울 수 있던 드문 문제를 고쳤어요 (시험 중)", "description": "도면을 지우는 중에 인터넷이 잠깐 끊기면, 열려 있던 삭제 창에서 다시 눌렀을 때 다른 도면이 지워질 수 있었어요. 이제 삭제 창은 처음 연 그 도면만 다뤄요. 여러 도면을 지우다 중간에 끊기면 어디까지 됐는지 알려 주고, 다시 누르면 남은 것만 이어서 지워요." },
    { "category": "ux", "summary": "배경 화면은 아직 배한솔 계정에서만 보여요 (시험 중)", "description": "이번 변경도 배경 화면 안의 일이라, 배경 메뉴가 보이지 않는 분들은 달라지는 것이 없어요. 오브젝트 목록의 보이기·숨기기, 속이 안 보이는 박스로 보기, 그림을 끌어다 놓기·붙여 넣기는 다음 차례에 이어서 넣을 예정이에요." }
  ]
}
```

- **문서**
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절의 다-1 줄(:27) 다음에 `- [x] 2026-10-13 숫자 끌기·옆 그림의 높이·도면 바로 삭제(v1.136.0): …저장 자료·운영 DB·IPC 변경 없음. 설계: docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md` 한 줄. 파일 끝(v1.135.1 절 다음)에 `### v1.136.0 배경 도면 — 숫자 끌기 · 옆 그림의 높이 · 도면 바로 삭제 (2026-10-13)` 절: 세 가지를 한 줄씩, 15.4의 문제를 고친 것, `- [ ] 수동 검증(설계 7.6 전체)`, `- [ ] 배포`, `- [ ] 2차(눈·박스로 보기) · 3차(그림 끌어다 놓기)는 다음 차례`. **v1.135.1 절의 '배포' 줄은 `42584da6`에서 이미 체크돼 있다 — 고치지 않는다**(머지할 때 main과 겹치지 않는지만 본다).
  - `AGENTS.md` '배경 라이브러리 데이터 경계': 편집 상태 띠 항목(:137)의 "편집기의 창(확인·만들기·연결·설정)이 열려 있는 동안에도 부르지 않는다 … 의존 목록에 그 넷을 둔다"를 "`dialogOpen` 한 줄(확인·만들기·연결·설정·도면 삭제)이 참인 동안에는 부르지 않는다 … 의존 목록에 그 값을 둔다. 편집기에 창을 더하면 그 줄에 더한다"로 고치고, 그 항목 다음에 한 항목 — **숫자 끌기 · 옆 그림 · 도면 삭제(v1.136.0)**: 속성의 숫자는 부품 하나(`BackgroundMapNumberField`)와 표 하나(`MAP_NUMBER_FIELDS` — 적을 때와 끌 때의 한계가 같다) / 끌어서 바꾸는 값은 `setMapNodeNumber` 한 곳이 쓰고, 값이 같으면 같은 도면 객체를 돌려준다(키를 만들지 않는다) / 캔버스 밖의 끌기(칸, 옆 그림)는 `fieldScrub` 하나를 지나는 문서의 제스처이고 늘 **시작 도면에서** 미리본다(합치는 편집으로 돌리지 않는다. `beginCanvasGesture`는 그대로 둔다) / 포인터는 `useMapScrubPointer` 하나 — 창에서 듣고 캡처는 걸어 볼 뿐이다(검사 창에는 캡처가 없다). 끌기의 기준은 누른 자리에서 문턱만큼 간 곳이지 그때 포인터가 있는 곳이 아니다(값이 이동 사건의 끊김에 달리지 않는다). 보조키는 Shift뿐이고 Alt는 평면 끌기의 것이다. 어떻게 끝나든(놓음, 버림, 부품이 내려감) 창의 리스너를 남기지 않는다. 포인터의 자리를 값으로 바꾸는 셈(`slideNumber`·`pressNumberTrack`)은 부품이 아니라 순수 모듈에 둔다(테스트가 닿게) / 옆 그림의 손잡이는 `canEdit`이고 잠기지 않았을 때만 있고 포인터 전용이며, 보기 모드의 그림은 그대로다. 끄는 동안 눈금을 잡아 둔다 / 도면 삭제는 `planMapDelete`가 푼 차례 — 저장 단계 하나(`persistMaps`를 지난다) 뒤에 하위부터 하나씩 — 로 보내고 **원자적이지 않다**. 구조는 저장된 라이브러리에서 읽는다. 창은 연 도면의 id만 다루고(`current`를 읽지 않는다) 초안은 자기 도면의 삭제가 통과한 뒤에만 버린다. 멈춘 문장은 센 수가 아니라 지금의 라이브러리에서 읽고, 풀린 연결은 지울 도면을 여는 것만 센다. 저장 단계의 `expectedRevision`은 초안이 아니라 저장된 버전이고, 함께 저장할 초안의 값은 보내기 전에 검사한다. 삭제 창이 떠 있는 동안 키는 뒤 화면에 닿지 않는데, 뒤의 처리기가 막아 주던 기본 동작(Ctrl+R — 화면 전체가 다시 불려 온다 — 과 Ctrl+Z)은 그 창이 막는다. 멈춘 까닭은 `mapDeleteCauseText`로 다듬어 보인다(Electron의 영어 껍데기를 화면에 내지 않는다).
  - `docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md`: 4.3의 '도면 삭제' 줄(:502), 15.3의 "이번에 고치지 않은, 전부터 있던 드문 문제 하나"(:1795), 15.4의 "보기 모드에서(초안 없이) 보던 도면이 없어지는 경우"(:1804)의 끝에 각각 한 문장 — "v1.136.0에서 고쳤다: 삭제는 연 도면의 id만 다루는 창으로 옮겼다(`docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md` 5.6)."
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-13 숫자 끌기 · 옆 그림의 높이 · 도면 바로 삭제 (v1.136.0)`(검증한 날이 다르면 그 날짜로) — 7.5의 수치, 7.6의 결과(E1~E6의 관찰과 쓴 대체안, 맞춘 상수), 확인하지 못한 것. "따로 고칠 일로 남긴 것"의 삭제 줄(:431)에 "v1.136.0에서 고침"을 붙인다.
  - `docs/superpowers/plans/2026-10-10-feedback-additions.md`: 7절 진행 기록 표의 '마' 줄(:300)을 "G3(숫자 끌기)와 G6의 첫 조각(옆 그림의 높이)은 v1.136.0 — 아래 7.4 · G4·G5와 G6의 나머지는 대기"로 고치고, 표 끝에 `| 바. 2026-10-13 추가 요청 여섯 가지 | 1차: docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md, 아래 7.4 · 2차·3차: - | 1차 구현·검증 상태 · 2차(눈·박스) · 3차(그림 끌어다 놓기) 대기 |` 한 줄. 7.3 절 뒤에 `### 7.4 숫자 끌기 · 옆 그림의 높이 · 도면 바로 삭제 — 만든 것과 확인한 것 (v1.136.0, 날짜)`를 7.3과 같은 꼴(만든 것 / 확인한 것 / 확인하지 못한 것 / 한솔에게 알린 것과 이 설계가 정한 것)로 더한다.
  - `CLAUDE.md`: 고치지 않는다(구조 변경 없음).
  - 완료 보고(한솔에게): 10.2를 비개발자 문장으로 옮겨 적는다.

## 9. 구현 순서 (단계마다 typecheck · `test:background`가 통과하게)

단계마다 `npm run typecheck`와 `npm run test:background`가 통과해야 다음으로 간다 — 각 단계의 테스트는 **그 단계까지 생긴 이름만** import한다. CSS를 고친 단계부터 `npm run test:motion`도 돌린다. **"…을 본다"는 구현자가 아니라 오케스트레이터가 한다**(구현자는 앱·미리보기 서버를 띄우지 않는다).

0. **기준 뜨기(오케스트레이터, 고치기 전의 화면)**: 4단계가 숫자 칸을, 5단계가 옆 그림을 고치기 전에 — 1~3단계는 화면을 바꾸지 않으므로 그 사이 언제든 — E2의 "고치기 전"(소수가 있는 값과 정수인 값에서 ↑·↓, 그리고 휠)을 적어 두고, H7의 기준(보기 모드에서 카메라를 고른 옆 그림 `<figure>`의 `outerHTML`과 캡처, 1440×900의 어두운·밝은 화면)을 떠 둔다. E4의 ③(숫자를 친 직후 도면을 누름)도 여기서 한 번 본다 — 오늘의 모습이다.
1. **숫자 규칙**: `mapNumberField.ts` + `tests/backgroundMapNumberField.test.ts`(N-1~N-8) + 앵커 59에 그 파일 이름. 화면은 달라지지 않는다.
2. **옆 그림 규칙**: `mapPlanPreview.ts`의 더하기 + S-1~S-5. 화면은 달라지지 않는다(두 인자 호출이 같다).
3. **계약과 포인터 훅**: `mapCanvas.ts`의 `MapScrubOrigin`·`MapFieldScrub`(`MapPlanPreviewProps`는 5단계에서 — 지금 바꾸면 편집기가 typecheck에서 떨어진다), `useMapScrubPointer.ts`. 부르는 곳이 아직 없다.
4. **숫자 칸**: `BackgroundMapNumberField.tsx`, 편집기(지역 `NumberField`와 두 상수 지움, import, `fieldScrub` 셋, 14곳의 태그), CSS(3.5) + 앵커 60~63. **게이트 N — 오케스트레이터가 E1·E2·E4·E6, N1~N20, V1·V3·V4를 본다.** 빠르기 상수(J1)를 여기서 눈으로 맞춘다(바꾸면 값만 — 테스트는 이름으로 읽고, N-6·N-7의 자리(px)도 그 이름에서 만든다).
5. **옆 그림의 손잡이**: `BackgroundMapPlanSide.tsx`, `BackgroundMapPlanPreview.tsx`, `mapCanvas.ts`의 `MapPlanPreviewProps`, 편집기의 보조 평면도 태그, CSS(4.4) + 앵커 64. **게이트 S — E3, H1~H12.** H7의 "보기 모드가 그대로"가 다르면 여기서 고친다(뒤 단계로 넘기지 않는다).
6. **삭제 계획**: `mapDelete.ts` + `tests/backgroundMapDelete.test.ts`(D-1~D-17) + DB 계약의 하위 테스트 + 앵커 59에 그 파일 이름. 화면은 달라지지 않는다.
7. **`dialogOpen`**: `mapDelete` 상태의 선언(아직 켜는 곳이 없다 — 쓰지 않는 지역 값은 이 저장소의 typecheck에서 오류가 아니다, `tsconfig.json:15`), `dialogOpen` 줄, 세 곳 + 앵커 53·56을 고치고 65를 더한다. 화면은 달라지지 않는다.
8. **삭제 창과 배선**: `BackgroundMapDeleteDialog.tsx`, 편집기(ref 둘, 핸들러 넷, `deletePlan`, 그리는 줄, 설정 창의 버튼, `confirmAction`의 가지와 공용 창의 글자 빼기, `confirmation`의 종류), CSS(5.4) + 앵커 50·52를 고치고 66을 더한다. **게이트 D — E5, D1~D19, V5~V8, 그리고 창 메뉴가 사는 창에서의 Ctrl+R(7.6의 ④).**
9. **앵커와 뮤테이션**: 6.2의 변형과 7.4의 마흔여섯 줄을 저장소 밖 임시 복사본에서 하나씩 넣어 모두 잡히는지 본다. 살아남는 것이 있으면 앵커를 고친다(구현은 고치지 않는다).
10. **버전과 문서**(8절), 그리고 마지막 상태에서 7.5의 전체 통과 기준과 git 확인. 수동 검증(7.6 전체, 네 조합의 ★)은 그 뒤에 오케스트레이터가 한다.

**오케스트레이터만 하는 일**: 앱 엔진 확인과 10.1의 대체안 선택(게이트 N·S·D 포함), PR 머지(한솔 확인 뒤), 빌드와 G드라이브 배포(한솔 확인 뒤 — 빌드는 다른 세션과 겹치지 않게, 성공은 로그로 판정한다). 운영 DB에 할 일은 없다.

## 10. 확인 필요 · 알릴 것 · 알고 넘어가는 것

### 10.1 앱 엔진에서 확인할 것과 대체안

설계 중에는 코드를 읽고 순수 함수만 돌려 봤다(11절). 화면은 하나도 그려 보지 않았다.

| 확인할 것 | 기대와 근거 | 앱에서 다르면 |
|---|---|---|
| 끈 뒤의 클릭이 삼켜지는지 (E1·E6) | 클릭은 `pointerup`과 같은 작업 안에서 온다 | 떼는 때를 `setTimeout(…, 0)` 대신 다음 `pointerdown`(창 단위·캡처, 한 번)으로(앵커 62가 글자로 고정한 그 `setTimeout` 줄과, 그 줄을 빼는 변형 — 7.4의 (16) — 도 함께 바꾼다) |
| 작은 화살표가 `appearance:none`으로 사라지고, ↑↓와 휠이 고치기 전과 같게 듣는지 (E2) | 화살표 요소는 남고 그림만 없어진다 — 엔진은 화살표 키를 칸의 키로 처리하고, 휠은 그 요소가 있어야 듣는다(읽은 것). 오늘 ↑↓·휠이 내는 값은 재 보지 않았다(`step="any"`라 소수를 정수로 맞추지 않을 것으로 읽힌다) — 그래서 기대는 "고치기 전과 같다"이지 어떤 수가 아니다 | 화살표가 **그래도 보이면** 그 줄을 `display:none`으로 바꾼다(앵커 63의 글자도). 그러고도 ↑↓가 고치기 전과 같아야 한다 — 아무 일도 하지 않게 됐으면 부품의 `onKeyDown`에서 ↑↓를 받아 고치기 전에 적어 둔 결과를 그대로 낸다(`stepNumber`가 아니다. 그 함수는 소수를 정수로 맞춘다. 앵커 63이 글자 그대로 고정한 `onKeyDown` 줄도 그때 함께 바꾼다). 그때 휠이 듣지 않게 됐으면 그대로 두고 보고에 적는다(10.2). 값이 달라진 것은 대체안이 아니라 고칠 일이다 |
| 누름 영역이 선 폭(24px, 화면 픽셀)만큼 잡히는지 (E3) | Chromium은 `non-scaling-stroke`의 선을 누름 판정에도 쓴다 | 부품이 SVG의 배율을 재서(`getScreenCTM().a`, `useLayoutEffect` + `ResizeObserver` — 보조 평면도의 `size`와 같은 꼴) 누름 원의 반지름을 `14 / 배율`로 주고 선 폭을 뺀다(앵커 64가 고정한 `.bmap-plan-side-grab {` 줄의 `stroke-width:24px`와, 6.2의 변형 '누름 영역의 선 폭을 뺌'도 함께 바꾼다) |
| SVG `<circle>`의 `touch-action:none` | 요소와 조상의 값이 합쳐진다 | 터치·펜에서 끌기가 곧바로 취소되면 `.bmap-plan-side.is-draggable>svg`에 준다. **썼다(v1.136.0 최종 검토 — 코드에서 읽었고 엔진에서 터치로 재지는 않았다)**: Blink는 SVG 안의 도형(`display:inline`)에 적은 `touch-action`을 읽지 않고 조상의 값을 물려준다. 도형의 줄은 그대로 두고 그림에 한 줄을 더했다(4.4, 앵커 64) |
| 끈 뒤 도면에 고리가 그려지는지 (E4의 세 경우) | 끌개의 누름은 기본 동작이 막혀 있고 포커스는 스크립트로 간다 — 도면을 누를 때와 같은 길이다. ① 마우스만 쓴 뒤에는 그려지지 않는다(v1.135.1에서 그 길을 확인했다). ② 키를 누른 직후(숫자를 치거나 Ctrl+Z)에는 엔진이 "키보드를 쓰는 중"으로 보아 키보드 고리를 그릴 수 있다 — 재 보지 않았다 | ①에서 보이면 고친다(backgrounds-map.css:23의 규칙이 듣지 않는 것이다). ②에서 보이는 것은 **받아들이고** 보고에 적는다: 보조 강조색 2px의 키보드 고리이고 편집 테두리의 색이 아니며, ③(오늘의 '숫자를 치고 도면을 누름')과 같은 모습이다. 언제 없어지는지는 본 대로 적는다 — 미리 단정하지 않는다 |
| 도는 동안 Esc 두 번에 창이 닫혔다 다시 뜨는지 (E5) | `close`가 오고 `showModal()`이 다시 연다 | 깜빡임이 보이거나 다시 열리지 않으면, 도는 동안 `window`의 캡처 단계에서 Esc의 `keydown`에 `preventDefault()`(엔진의 닫기는 그 키의 기본 동작이다)를 더한다 |
| 방의 길이를 끌 때 3D가 걸음마다 다시 그려지는 무게 (N3) | 3D 손잡이의 크기 조절과 같은 급이다(값이 같으면 미리보지 않는다) | 버벅이면 훅의 미리보기를 프레임당 한 번으로 모은다(`requestAnimationFrame` — 놓을 때는 마지막 값을 먼저 보낸다. 앵커 62가 글자 그대로 고정한 훅의 줄 가운데 그래서 달라지는 것 — 적어도 미리보기 줄과 놓음의 줄 — 도 함께 바꾼다) |
| 옆 그림: 보기 모드의 `<figure>`가 예전과 같은지 (H7) | `draggable`이 거짓이면 더한 요소가 없다 | 다른 줄을 찾아 `draggable &&` 안으로 넣는다. 다른 채로 넘어가지 않는다 |
| 빠르기(2px에 1, Shift 6px에 큰 걸음) (게이트 N) | 손으로 정한 값이다 | 상수만 바꾼다. 끌 자리를 그것으로 벌지는 않는다(`stepPx`를 줄이면 모든 칸이 그만큼 빨라진다) — 자리는 끌개의 자리가 낸다(J14) |
| 옆 그림의 고리와 위·아래 표시가 어느 크기에서든 점과 구분되는지 (H1의 세 배치) | 고리는 화면 픽셀이라 늘 점의 테두리 밖으로 2.25px이다. 표시는 보통 배치의 가장 낮은 그림(54px)에서 고리와 0.9px 떨어진다(셈) — 붙어 보일 수 있다 | 붙어 보이면 `x0`를 `box.cameraX - 16`으로(2px쯤 떨어진다. 앵커는 그 수를 보지 않는다). 고리가 옅어 안 보이면 `stroke-opacity`를 올린다 |
| 막대의 선이 보이는지 (N8 — **어두운·밝은 화면 모두**) | 선은 `--color-bg-border`이고 어두운 화면에서 더 옅다(1.3~1.4:1, 밝은 화면 1.6:1). 값은 테두리를 두른 점이 말한다. 앱의 다른 막대(`input[type=range]`, `src/index.css:850-856`)의 선도 그만큼 옅다 | 어느 한쪽에서라도 안 보이면 `.bmap-num-track::before`의 색을 `rgb(var(--color-text-secondary) / .5)`로(두 화면 모두 2.2~2.7:1) |
| 삭제 창이 뜬 채의 Ctrl+R·Ctrl+Shift+R이 화면을 다시 불러오지 않는지 (D11, 7.6의 ④) | Electron은 페이지가 `preventDefault()`하지 않은 키만 창 메뉴의 단축키로 넘긴다(읽은 것 — 오늘 앱의 처리기가 같은 방법으로 Ctrl+R을 막는다). `hold`가 그 글쇠를 막는다 | 그래도 다시 불려 오면 **그대로 배포하지 않는다**(도는 삭제가 끊기고 저장 안 한 편집이 사라진다 — v1.135.1에는 없던 일이다): `hold`가 Ctrl+R만은 멈추지 않고 앱의 처리기에 넘기게 고쳐(오늘의 다른 창과 같은 길 — 앵커 66이 글자 그대로 고정한 `hold`의 두 줄과, 그 줄들을 겨눈 6.2·7.4의 변형도 함께 바꾼다) 다시 본다 |

### 10.2 한솔에게 알릴 것 · 완료 보고에 적을 것

알린 것은 그대로 만들었다. 아래는 알린 것에 없던 것이다(비개발자 문장으로 옮겨 적는다).

- **여섯 가지 가운데 이번은 셋이다**: 숫자 끌기 · 옆 그림의 카메라 높이 · 도면 바로 삭제. 오브젝트 목록의 눈(보이기·숨기기)과 박스로 보기는 2차, 그림을 끌어다 놓기·붙여 넣기는 3차에 이어서 낸다.
- **↔ 끌개의 자리**: 숫자 칸의 **왼쪽 끝**이다(작은 화살표가 있던 오른쪽 끝이 아니다). 속성 칸이 화면 오른쪽 끝에 붙어 있어서, 오른쪽 끝에 두면 오른쪽 줄의 칸은 값을 올리는 쪽으로 끌 자리가 거의 없다. 왼쪽 끝에서도 오른쪽 줄의 칸은 한 번에 +55쯤이다 — 더 멀리는 Shift를 누른 채 끌거나(+180 이상) 놓았다 다시 끈다(J14). 끌개를 끌지 않고 누르기만 하면 그 칸에 커서가 간다(J15).
- **끌 때의 걸음**: 숫자 칸은 2px에 1씩이고, Shift는 높이·위치·길이 10, 각도 15°, 화각 10°다. 끈 값은 늘 그 배수이고 소수가 있던 값은 첫 걸음에 정수가 된다. 제자리로 돌아오면 처음 값 그대로다(J1~J3).
- **막대를 그냥 누르면** 그 자리로 값이 옮겨진다(되돌리기로 돌아간다)(J4). 좁은 막대라 4°쯤의 간격으로만 닿는다 — 정확한 값은 Shift·끌개·적기다.
- **작은 화살표**: 그림만 없어지고 키보드 ↑↓와 칸 위의 휠은 고치기 전과 같다(J5). **게이트 N에서 견줬다**: ↑↓는 전처럼 1씩이고(소수가 있던 값은 소수가 남는다 — 969.81 → 970.81), 포커스가 있는 칸 위의 휠은 전에도 지금도 값을 바꾸지 않는다. 대체안은 쓰지 않았다.
- **끈 뒤의 포커스 고리**: 숫자를 치거나 Ctrl+Z를 누른 직후에 끌면 도면 둘레에 키보드 고리(보조 강조색)가 보일 수 있다고 봤다. **게이트 N에서 본 것**: 세 경우(마우스만 쓴 뒤 · 숫자를 치거나 Ctrl+Z를 누른 직후 · 숫자를 치고 도면을 누름) 모두 고리가 그려지지 않았다 — 알릴 것이 없다.
- **끌개의 폭**(게이트 N): 창 폭 901~1100px의 좁은 속성 칸에서 `-100000`이 2px 잘려 끌개를 22px에서 18px로 줄였다(3.5). 끌개나 칸 이름에 마우스를 올려 두면 뜨는 풍선은 끌개 위에 떠서 칸 이름을 잠깐 가린다(누르면 사라진다).
- **옆 그림**: 한 번에 갈 수 있는 높이는 가장 높은 방보다 조금 위(4분의 1)까지다. 놓았다 다시 끌면 더 간다. 걸음은 어느 도면에서든 알린 대로 10이라, 방과 카메라가 모두 아주 낮은 도면에서는 갈 수 있는 자리가 몇 곳뿐이다. Shift와 키보드는 없다 — 세밀한 값은 '카메라 높이' 칸이다(J6~J8). 보조 평면도가 낮아 그림이 감춰진 때에는 손잡이도 없다(지금 그림이 없는 그 경우다).
- **삭제 창의 말**: 위 도면이 없는 도면은 창에서 '최상위 도면'이라고 부른다(편집기의 다른 곳과 같은 낱말 — 알릴 때는 '맨 위 도면'이라고 했다). 밑그림을 올려 둔 도면이면 밑그림도 함께 없어진다고 적는다. 지우는 버튼의 글은 하위 도면이 없으면 `도면 삭제`, 남기기면 `이 도면 1개만 삭제`, 함께 삭제면 `도면 N개 모두 삭제`다(N은 이 도면과 아래 도면을 합친 수 — J10). 도는 동안 버튼은 `삭제 중… 1/3`처럼 **지운 도면 수**를 센다(버튼에 적혀 있던 그 수다). 끊겼을 때 아무것도 된 것이 안 보이면 "아무것도 바뀌지 않았어요"라고 단정하지 않고 `아직 바뀐 것이 보이지 않아요. 다시 눌러도 돼요. 인터넷이 끊겼던 거라면 잠시 뒤 이 창이 알아서 바뀔 수 있어요.`라고 한다 — 답과 다시 읽기를 모두 잃으면 이 PC는 그 명령이 됐는지 한동안 모르기 때문이다. 멈춘 까닭의 줄은 이 창에서만 다듬는다: 영어 껍데기를 벗기고, 연결이 끊긴 경우에는 `서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.`라고 한다.
- **삭제 뒤의 화면**: 위 도면으로 간다. 최상위 도면을 지우면 지금처럼 목록의 첫 도면이다(J9). 위 도면의 저장 안 한 변경이 함께 저장된 경우 그 도면의 띠는 '도면을 저장했어요' 없이 곧바로 '저장된 그대로예요'다(저장된다는 말은 삭제 창이 미리 했다).
- **함께 저장되는 것**: 연결을 풀어야 하는 위 도면(그 도면의 공간이 지울 도면을 열 때)이나 위로 옮겨지는 하위 도면에 저장 안 한 변경이 있으면 삭제할 때 함께 저장되고(창이 이름을 미리 말한다) 그 도면의 되돌리기 기록이 비워진다 — 저장할 때마다 그런 것과 같다(J11). 지울 도면을 여는 공간이 없는 위 도면은 저장되지 않고 창도 그 이름을 말하지 않는다. 지우는 도면의 저장 안 한 변경은 함께 사라진다 — 다만 첫 단계(연결 풀기·옮기기) 뒤에 멈춘 실행에서는, 지우려던 도면 가운데 아직 남아 있는 것의 변경이 이미 저장돼 있을 수 있다(그 단계가 연결을 푸느라 그 도면도 썼을 때 — 5.5).
- **여러 도면을 지우는 일은 한 번에 처리되지 않는다**(알린 대로). **도면 하나여도 그럴 수 있다**: 위 도면의 연결을 풀어야 하거나 하위 도면을 남기는 삭제는 두 단계(연결 풀기·옮기기 → 삭제)라서, 사이에 끊기면 연결만 풀리거나 하위 도면만 위로 옮겨진 채 도면이 남는다. 창이 그대로 알려 주고 다시 누르면 이어서 지운다. 중간에 끊겨 일부만 된 것은 되돌릴 수 없다. 도는 동안에는 Esc와 돌아가기가 듣지 않는다(J13). 창이 뜬 직후와 실행이 멈춘 직후 0.5초 동안은 마우스든 Enter든 누른 것이 듣지 않는다(더블클릭이 창에 닿지 않게 — Esc는 바로 듣는다). 삭제 창이 떠 있는 동안에는 Ctrl+숫자 같은 앱의 화면 전환 단축키와 Ctrl+R(자료 다시 읽기)·Ctrl+Z도 아무 일도 하지 않는다(지우는 도중에 화면이 바뀌면 남은 삭제가 끊기기 때문이다). 다만 앱 밖에서 오는 화면 이동(슬랙의 B flow 링크, 새 창의 다른 화면으로 가는 단추)은 막지 못한다 — 그때 도는 삭제는 앱을 끈 것처럼 끊긴다(10.3). 다른 PC는 중간 상태를 잠깐 본다.
- **한 번에 못 하는 경우**: 함께 저장해야 하는 도면이 100개를 넘으면 문장으로 알리고 하지 않는다(J12). 다른 곳에서 먼저 바뀐 도면에 저장 안 한 변경이 걸려 있어도, 함께 저장할 변경이 저장할 수 없는 것(이름을 비운 오브젝트)이어도 그렇다 — 어느 도면인지 창이 말한다(J16).
- **함께 고친 것**: 삭제 창이 엉뚱한 도면을 지울 수 있던 드문 문제(v1.135.0 완료 보고에 "따로 고칠 일"로 적었던 것).
- **이번에 넣지 않은 것**: 위아래 각도 끌기, 높이·위치·길이의 막대, Alt로 세밀하게 끌기.

### 10.3 알고 넘어가는 것

- **포인터가 둘인 경우(펜과 손가락, 마우스와 터치).** 끌기 하나가 도는 동안 다른 곳의 누름은 시작되지 않는다(문서가 제스처를 하나만 받는다). 다만 끌기가 Esc로 취소된 뒤 그 포인터를 떼기 전에 **다른 포인터가 3D 손잡이를 잡으면**, 먼저 끌던 쪽이 다음 움직임에서 그 새 제스처를 자기 것으로 읽을 수 있다(`alive`는 "제스처가 돈다"만 묻는다). 결과는 되돌리기 한 단계 안의 일이고 저장되지 않는다. 마우스 하나로는 생기지 않는다.
- **끌기 도중의 Alt.** 숫자 칸과 옆 그림의 끌기는 평면의 Alt 가드를 켜지 않는다. 습관으로 Alt를 누른 채 끌었다 떼면 Windows가 키보드를 창 메뉴로 넘긴다(지금 캔버스 밖 어디서나 그렇다). Alt를 뜻 있는 키로 쓰려면 앵커 17을 다시 써야 한다.
- **화면 오른쪽 끝.** 속성 칸은 화면 오른쪽에 붙어 있다. 끌개를 칸의 왼쪽 끝에 두어도(J14) 오른쪽 줄의 칸에서 오른쪽으로 끌 자리는 115~130px이다(한 번에 +55~63, Shift면 +180~210. 왼쪽 줄은 그 두 배). 캡처가 있어 창 밖으로 나가도 이어지지만 화면 끝에서는 멈춘다 — 더 멀리는 Shift를 쓰거나 놓았다 다시 끈다(10.2에 적는다. 화면 끝을 넘는 끌기는 포인터 잠금이 드는 따로 다룰 일이다). 그리고 칸 이름을 누르다 4px 넘게 미끄러지면 값이 변한다(되돌리기 한 단계이고 띠에 보인다).
- **끌기는 누른 곳에서 4px 간 곳부터 센다.** 그 4px이 "누르기만 한 것"과 끌기를 가른다. 그래서 끌다가 정확히 누른 곳으로 되돌아오면 처음 값이 아니다: 숫자 칸은 2걸음 지나쳐 있고, 옆 그림의 점은 포인터를 4px 뒤에서 따라온다. 처음 값은 끌기가 시작된 자리(4px 간 곳)에 있고, 사용자가 보는 것은 숫자와 점이다. 누른 곳을 가운데로 하는 방식(양쪽 4px의 죽은 구간)은 방향을 바꿀 때 점이 8px 동안 멈춰 서서 택하지 않았다.
- **옆 그림은 작다.** 여행 구간이 18~46px이라 정밀한 조절이 아니다. 그림을 키우는 것(위·옆 두 칸)은 따로 다룰 일이고 이 설계는 그것을 막지 않는다. 범위 밖으로 놓으면 그림이 한 번 다시 맞춰진다(방 상자가 줄어든다). **아주 낮은 도면**(방과 카메라가 모두 20쯤 아래 — 기본 높이 180·120에서는 일부러 낮춰야 생긴다)에서는 걸음 10이 눈금보다 커서, 갈 수 있는 자리가 서넛 아래이고 끄는 동안 점이 그림 위로 벗어나 그려질 수 있다(입체 높이 4.5인 방에서 0 → 10이면 그림 높이의 3분의 1만큼 위다). 놓으면 그림이 다시 맞춰진다. 알린 걸음을 지킨 값이다(J7) — 세밀한 값은 칸이다.
- **방에 속하지 않은 카메라**가 많다(끌어 옮겨도 소속은 바뀌지 않는다). 그런 카메라의 옆 그림에는 방 상자가 없다 — 지금과 같고, 높이는 '높이 N' 글자가 말한다(천장 줄은 넣지 않았다).
- **멈춘 문장은 이 PC가 마지막으로 읽은 라이브러리에서 읽는다.** 명령의 답과 다시 읽기를 모두 잃으면 창은 한 걸음 뒤처진 모습으로 말하고(`아직 바뀐 것이 보이지 않아요. …`, 또는 지운 수가 하나 적다), 읽기가 다시 되는 때(15초마다, 창에 포커스가 돌아올 때)에 스스로 고쳐진다 — 인터넷이 끊겨 있는 동안만 남는 모습이다(변경 신호가 닿는 동안에는 저장소가 곧바로 한 번 더 읽는다). 그 사이에 다시 누르면 같은 명령이 한 번 더 나간다: 이미 지운 도면의 삭제는 서버가 거절하고, 이미 된 저장은 저장소가 알아보고 이어 간다(`mapSaveWasApplied`) — 어느 쪽이든 그 도면들의 id로만 나가고 다른 도면은 건드리지 않는다.
- **삭제는 원자적이지 않다.** 실행 도중 앱을 끄면 문장 없이 일부만 된 상태가 남는다(온전한 라이브러리이고, 다시 지우면 이어진다). 앱 밖에서 오는 화면 이동도 같다(최종 검토가 코드에서 읽었다): 슬랙의 B flow 링크, 새 창의 다른 화면으로 가는 단추는 창의 키 막기를 거치지 않고 화면을 바꿔 편집기를 내리고, 도는 명령의 답은 버려진다. 내려간 편집기는 클릭 막기를 걸지 않는다(`if (rootRef.current)` — 걸면 다음 화면의 누름을 0.5초 먹는다). 전부 아니면 전무로 하려면 서버 함수를 바꾸는 migration이 든다. 그리고 긴 가지의 삭제는 느리다: 명령마다 왕복 한 번이고 서버가 매번 전체를 검사한다. 수십 개면 몇 초다. 취소 버튼은 없다.
- **멈춘 실행 뒤 라이브러리의 빨간 줄.** 저장소가 자기 오류 줄을 탭 위에 잠깐 보인다(지금의 동작 — 설치된 앱에서는 영어 껍데기가 붙은 채다). 창 안의 문장이 정확한 상태다.
- **함께 저장할 초안이 라이브러리 전체로는 저장되지 않는 경우**(Task 7의 검토에서 나왔다). 계획이 미리 보는 것은 그 도면 하나의 검사(`validateBackgroundEntity`)뿐이다. 위 도면의 카메라에 배경을 잇거나 공간에 장소를 잇고 **저장하지 않은 채** '배경 목록'에서 그 배경·장소를 지운 뒤(저장된 도면이 가리키지 않으니 지워진다) 하위 도면을 지우면, 창은 `‘2층’ 도면의 저장 안 한 변경은 이번에 함께 저장돼요.`라고 말하고 버튼이 켜져 있는데, 누르면 저장소가 보내기 전에 거절한다(`카메라가 참조한 배경이 없습니다. …`) — 그 아래 문장은 "다시 눌러도 돼요"지만 몇 번을 눌러도 같다. 아무것도 나가지 않고 잃는 것도 없으며, 그 도면의 '도면 저장'도 오늘 같은 까닭으로 거절된다. 그 초안에서 그 연결을 풀거나 편집을 버리면 지워진다. 미리 막으려면 계획이 저장 단계 전체를 `applyBackgroundCommand`로 한 번 돌려 봐야 하고 어느 도면 탓인지도 가려야 한다 — 다음 차례의 일로 둔다.
- **Enter를 누른 채로 있을 때의 고리**(게이트 M의 검토가 코드에서 읽은 것 — 엔진에서는 재지 않았다). 삭제 창의 '돌아가기'(기본 포커스)에서 Enter를 누른 채로 두면, 키 반복이 창을 닫은 뒤 포커스가 돌아간 머리의 '도면 설정'을 누르고, 이어서 설정 창의 폼을 보내 그 도면을 저장 안 한 편집까지 저장하고, 다시 '도면 설정'을 누르는 고리가 키를 떼기 전까지 돈다. 설정 창의 '취소'에서도 전부터 생기던 고리이고(설정 저장에는 '바뀐 것이 없으면 보내지 않음'이 없다), 삭제 창이 그 고리로 가는 길을 하나 더 냈을 뿐이다. 삭제가 두 번 나가지는 않는다(`deleting`과 멈춘 뒤의 0.5초). 키 반복을 받지 않게 하는 것은 따로 다룰 일이다.
- **지울 도면의 초안이 낡았을 때의 두 문장.** 지울 도면이 저장 단계에 들고(하위 도면을 여는 공간이 있다) 그 도면에 저장 안 한 변경이 있는데 다른 곳에서 먼저 바뀌었으면, 창은 `‘이름’ 도면이 다른 곳에서 먼저 바뀌었어요. …`(거절)와 `이 도면의 저장 안 한 변경은 함께 사라져요.`(안내)를 함께 보인다. 둘 다 사실이고 지우는 버튼은 꺼져 있다.
- **다른 네 창의 같은 틈.** 도는 동안의 Esc 두 번에 엔진이 창을 닫는 것, 창이 뜬 채 누른 키(포커스가 `body`나 버튼에 있을 때)가 앱 단축키에 닿아 화면이 바뀌는 것, 버튼에 포커스를 둔 Ctrl+Z가 뒤의 칸에 친 값을 되돌릴 수 있는 것은 설정·연결·만들기·확인 창에도 있다(도는 시간이 짧아 드물다). 이번에는 새 창에만 막았다 — 넷은 `BackgroundModal`을 고치는 따로 다룰 일이다. **오류 문장의 영어 껍데기**(`Error invoking remote method …`)도 같다: 그 네 창과 편집기의 오류 띠는 설치된 앱에서 지금처럼 껍데기째 보인다(전부터 그랬다 — `cleanIpcErrorMessage`를 배경 화면 전체에 쓰는 것은 따로 다룰 일이다).
- **보기 모드에서 설정 창이 열린 동안 그 도면이 다른 곳에서 지워지면** 설정 창은 지금처럼 쥔 값으로 남는다('설정 저장'은 거절된다). '도면 삭제'는 그 id로 창을 열고 '없어짐'을 보인다.
- **다른 곳에서 연결이 풀린 뒤에도 낡은 초안이 그 연결을 쥐고 있는 경우**(저장 안 한 변경이 있는 위 도면)는 건드리지 않는다. 그 초안은 지금처럼 저장할 때 거절된다(그 알림은 보관 차례의 일이다). 그리고 **지울 도면의 초안이 낡은 경우**(다른 곳에서 먼저 바뀐 도면을 고치던 중)에 그 도면이 저장 단계에 들지 않으면, 삭제는 지금의 라이브러리 버전으로 나가 통과한다 — 예전에는 편집 중이면 초안의 버전으로 나가 거절됐다. 창의 숫자와 문장은 지금의 라이브러리의 것이고, 고치던 것이 함께 사라진다는 문장도 나온다.

## 11. 설계 때 돌려 본 것

저장소 밖 임시 폴더에서, 이 문서의 순수 함수를 시안으로 써서 **진짜 모듈**(`domain.ts`·`mapDocument.ts`·`mapGeometry.ts`·`mapSpatial.ts`·`mapPlanPreview.ts`·`previewGateway.ts`)을 불러 `node --test`로 돌렸다(Node 22.18). 3.1과 4.2의 코드 블록은 이 문서에서 글자 그대로 뽑아 돌렸다. 그 순수 코드와 삭제 계획의 시안, 그리고 3.2의 끌기 객체 · 3.4와 4.3의 끌기 셋(`slide`·`slideBar`·`lift`) · 5.6의 실행 반복문은 저장소의 TypeScript(5.9.3, 저장소의 `tsconfig.json` 설정)로 진짜 모듈에 대고 형 검사도 했다(오류 없음 — 훅의 `S`가 `open`의 반환형에서 추론된다). 검토 뒤 고친 끌기 셋(`open(origin, from)`, `tap`, `lit`·`live`)과 5.6의 반복문도 같은 TypeScript로 다시 형 검사했다(React와 새 모듈은 선언만 두고 — 오류 없음). 화면과 CSS는 돌려 보지 않았다. 훅의 본문(3.3)은 화면 없이 가짜 창으로만 돌렸다(표에서 '훅의 본문' 줄부터 세 줄 — 두 번째 검토 뒤에 한 것. 그다음 한 줄은 마지막 점검에서 고친 것을 돌린 것이다). 시안은 지웠다 — 구현은 이 문서의 서명과 표를 따른다.

| 돌린 것 | 결과 |
|---|---|
| 삭제 계획(5.1~5.3의 시안): 7.3의 라이브러리(그때는 창고가 없는 도면 일곱)에서 도면 일곱 × 두 방식의 모든 앞부분을 `validateBackgroundRequest` + `applyBackgroundCommand`로 | 한 번도 던지지 않는다. 어느 앞부분에서 끊겼다 다시 계획해도 끝난 라이브러리가 부모·버전까지 같다. 끊긴 뒤 방식을 바꿔 이어 간 33가지도 던지지 않는다. 장소·배경·묶음·사용 기록을 하나씩 둔 라이브러리에서 그 넷이 그대로다 |
| 검토 뒤 고친 규칙(다시 쓴 시안): 창고를 더한 도면 여덟의 라이브러리에서 같은 것, 그리고 멈춘 문장 | 37개의 앞부분이 모두 통과하고 끊겼다 이어도 끝이 같다. `links`: 본관 남기기 1 · 함께 삭제 3 · 학교 남기기 0. 저장 단계의 차례와 삭제의 버전이 D-2~D-6의 표와 같다(별관 남기기의 삭제는 버전 1). 멈춘 문장이 D-15의 표와 같고, `links`를 예전 뜻(저장 단계가 푸는 연결 전부)으로 두면 학교 남기기가 아무것도 하기 전에 "풀었어요"를 낸다 |
| 미리보기 저장소(`createBackgroundPreviewGateway`, 메모리 저장소)의 기본 자료에서 네 도면 × 두 방식의 명령을 그 저장소의 `execute`로 차례로 | 모두 통과한다. 장소·배경·묶음이 그대로이고 은퇴 목록에 지운 도면의 id가 지운 차례로 적힌다 |
| 오늘의 거절 | 연결이 있는 잎 도면과 하위가 있는 도면의 삭제가 2.4의 두 문장으로 던진다. 연결도 하위도 없는 도면은 통과한다 |
| 초안과 한계 | D-9~D-13의 기대 그대로(초안 값이 쓰임 / 깨끗한 초안 무시 / 낡은 초안 거절 / 하위 101개 남기기 거절, 100개 통과) |
| 문구 | 미리보기의 기본 자료에서 5.3의 네 경우가 표의 글자대로 나오고, 본관 함께 삭제의 멈춘 문장이 7.6의 D6과 같다(명령 넷 가운데 0·1·2개 뒤) |
| 숫자 규칙(3.1의 코드): 네 종류 × 열한 키에서 끈 도면과 친 도면(116가지) | 위치 둘은 1e-9 안, 나머지는 `deepEqual`. 표의 양 끝 값이 `validateBackgroundEntity`를 지난다. 3.1의 걸음 표의 모든 줄과 막대의 왕복(다섯 키의 정수 1,423개, 처음 값 `NaN`)이 맞다 |
| 제스처(리듀서) | 미리보기 셋 뒤 끝 = 한 단계. 제자리로 돌아오면 단계 없음이고 초안 값이 시작 도면 그 객체다. 제스처 중의 `update`는 버려진다 |
| 옆 그림(4.2의 시안) | 두 인자 호출이 오늘의 `planSideView`와 3,456가지(도면 아홉 × 높이 열둘 × 각도 여덟 × 소속 넷)에서 `deepStrictEqual`. 0~180 눈금의 닿는 곳이 −40과 230이고 그때 점의 y가 70.9와 10.9다. 잡아 둔 눈금에서 화살표가 뒤집히지 않고 모든 점이 상자 안이다(y 2~82). 4.4의 표의 크기(배율 0.45·0.64·1.14에서 누름 영역 28.1·29.8·34.3px, 여행 구간 18.1·25.7·45.7px)도 여기서 셌다 |
| 검토 뒤 고친 규칙: 옆 그림의 어긋남을 재는 자리, 숫자 규칙의 새 줄, 수가 아닌 방 | 어긋남을 누른 자리로 재면 문턱 직후의 첫 값이 120에서 140·150·160이다(그림 높이 96·54·38px). 누른 자리에서 문턱만큼 간 곳으로 재면 세 크기 모두 120 → 130 → 140, 아래로 110 → 100이고 15px에서 10의 배수다. 칸은 15px에서 5걸음(첫 이동의 자리로 재면 0걸음). 3.1의 표에 더한 줄(−3.5, ±725, −0.9배, 화각 5, 회전 −90의 270.2 자리)이 그 코드에서 표대로 나온다. 오늘의 `planSideView`가 S-1의 세 도면에서 눈금 0~180 / 0~300 / 0~180, `room`이 `null`이다 |
| 훅의 본문(3.3의 글자를 이 문서에서 뽑아) — React의 세 훅을 흉내 내고 가짜 `window`·요소·사건으로. 그리고 그 훅 · 3.4의 부품 전체 · 4.3의 `lift`와 그리는 줄 · 5.4의 `hold`를 저장소의 TypeScript와 React 형(18.3)으로 형 검사 | 열네 가지가 3.3의 표대로다: 문턱과 시작 자리, 1px씩과 한 번에 보낸 이동이 같은 값, 누르기만 함, 축 밖의 이동, 다른 포인터·다른 단추, 거절된 시작, 편집기가 취소한 뒤(`dead`), 버림 셋, 놓음 뒤의 `lostpointercapture`, 캡처가 없는 환경, `immediate`, 다른 단추를 누른 채의 놓음, 놓음을 잃은 뒤의 새 누름, 세 상태에서 내려감(남는 리스너 0), 시작하는 사이에 내려감. 앵커 62가 이름한 스물다섯 줄이 그 글자에 있고 수가 맞다(가드 3 · `preview` 1 · `tap` 1 · `finish` 1 · `cancel` 3). 형 검사 오류 없음 |
| `slideNumber`·`pressNumberTrack`(3.1의 코드), 걸음을 10으로 둔 `planSideDragLevel`(4.2의 코드), `src/themes.ts`의 색 | 3.1의 표의 새 줄 그대로(1·2·3·5·11px씩 모두 125. 사건마다 더하면 120, 보이는 값에서 세면 150. 어긋남을 0으로 두면 94). S-4의 수가 그대로이고 양쪽 한계가 ±100000. 낮은 도면: 방 100·카메라 60 → −20~130, 방 30·카메라 20 → −10~40, 방 4.5·카메라 0 → 0과 10(점의 y −26.9). `Math.max(0, …)`은 0~180 눈금의 스무 가지에서 아무것도 바꾸지 않고, 방 30·높이 40·각도 90에서 갈린다(끝의 y 8.67 대 9.00). 대비는 3.5의 수 그대로(선 1.29~1.42 · 1.62, 점 2.32~7.48, 점의 테두리 5.68~7.23, 평소의 ↔ 5.78~7.32) |
| 삭제 계획의 고친 규칙(5.1~5.3에서 다시 쓴 시안): `unsavable`, 낡은 깨끗한 초안, 문구. 그리고 진짜 `createBackgroundStore` + 미리보기 저장소로 답과 읽기를 잃기 | 시안이 D-2~D-6의 표와 맞고 53개의 앞부분에서 끊겼다 이어도 끝이 같다. 이름을 비운 초안은 `'unsavable'`이고 그 명령을 그대로 돌리면 `오브젝트 이름 형식 또는 길이를 확인해 주세요`다. 학교가 버전 2인 라이브러리에서 버전 1의 깨끗한 초안은 무시되고 `expectedRevision`이 2이며, 초안의 버전으로 보내면 거절된다. 하위 101개 남기기는 거절이어도 `save`가 101개다. 읽기를 계속 잃는 동안 뒤처진 문장(`…도면 3개 가운데 2개…`)이 남고, 한 번만 잃으면 20ms 안에 따라잡는다. 껍데기를 쓴 글과 영어 글이 D-17대로 나온다 |
| 마지막 점검 뒤 고친 것(3.1의 코드와 3.3의 본문을 이 문서에서 다시 뽑아): 3.1의 표의 끌기·Shift·막대 세 줄을 N-6·N-7의 식으로 만든 자리에서 — 오늘의 상수와, 다른 상수 여섯 벌(`stepPx` 1~4 · `bigStepPx` 4~12 · `grabPx` 3~40 · `thumbPx` 8~14)에서. 7.4의 (15)를 고친 글대로 넣은 훅(가짜 창) | 일곱 벌 모두에서 표의 값 그대로다. 표의 px을 글자로 두면 `stepPx`가 2가 아닌 다섯 벌에서 104 → 115가 125가 아니라 122~131을 낸다. (15)는 글대로 넣을 수 있고, 앵커 62가 고정한 줄이 없어지며, 편집기가 취소한 끌기의 놓음이 `finish`를 부른다. 누른 곳에서 115px · 130px까지의 끌기는(문턱 4px을 빼고) +55 · +63, Shift로 +180 · +210이다(10.3) |
| `npm run test:background`(작업 전) | 582개 — 통과 577, 건너뜀 5 |
