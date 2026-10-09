# 배경 도면 ③ 새 도면 요소 — 설계 (2026-10-09)

> 요청(한솔, 도면 피드백 2차): 기호에 계단 넣기(F2), 도로 넣기(F3), 카메라 색 바꾸기(F7)
> 승인: 2026-10-09 (아래 1.1이 승인 문구 그대로다)
> 버전: v1.133.0 · **운영 DB 변경 있음**(검증 함수 하나를 넓히는 migration 한 개. 기존 자료는 건드리지 않는다) · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: 브랜치 `claude/bg-map-new-elements` (= main v1.132.0, a0ca0542). 아래 줄 번호는 이 커밋에서 직접 확인했다.
> 바탕: ② 설계 `docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md`(이하 "② 설계")의 쌓임 순서(`mapStack.ts`)·선택 모델·상자 규칙 위에 쌓는다. 라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 F2·F3·F7 절, 4절(저장 내용이 바뀌는 묶음의 배포 규칙), 6절 보완을 읽고 지금 코드와 다시 맞췄다(2.5).

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 승인된 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다.** 승인 문구가 한 가지로 정하지 않는 여섯 곳은 이 설계의 답으로 정했고(1.1 끝의 표), 완료 보고에 적는다(14.3). 그 가운데 색 여섯의 색상(I6)만은 운영 DB를 적용하기 **전에** 화면으로 한솔에게 보인다(5.4의 1).

용어: **새 모양** = 이번에 저장 자료에 더해지는 세 가지(기호 종류 `stairs`, 공간의 `surface: 'road'`, 카메라의 `color`). **도로** = `surface`가 `'road'`인 공간. **방** = 도로가 아닌 공간(코드와 화면의 '공간' 그대로). **검증 함수** = 서버의 `public.background_library_validate_entity`. **기본 파일** = `DEVLOG/migrations/2026-09-21-background-library.sql`, **3D 파일** = `DEVLOG/migrations/2026-10-07-background-map-3d.sql`, **요소 파일** = 이번에 만드는 `DEVLOG/migrations/2026-10-09-background-map-elements.sql`. **이전 버전** = v1.130.0~v1.132.0(배경 화면이 든 배포판 전부). **업데이트 안내** = 새 읽기 장치가 띄우는 "업데이트가 필요해요" 화면(5.2). **보조 평면도** = 3D 옆의 작은 평면도. **쌓임 순서** = 겹친 공간 가운데 무엇이 위인가(`mapStack.ts`). **초안** = `mapDocument.ts`가 들고 있는 편집 중인 도면 값. **편집 중** = `canEdit`이 참.

---

## 1. 목표와 범위

### 1.1 만드는 것 (승인 문구 그대로)

**계단**
- 기호 목록에 '계단'이 생긴다. 평면에서는 디딤판 줄무늬와 올라가는 방향 화살표로, 3D에서는 층층이 올라가는 모양으로 보인다.
- 방향은 다른 기호처럼 돌려서 정하고, 크기와 높이도 똑같이 조절한다. 위·아래층 도면으로 넘어가는 연결 기능은 넣지 않는다.

**도로**
- '장소'로 만든다(공간의 한 종류). 그리기 도구에 '도로'가 생기고, 회색 바닥에 가운데 점선이 있는 길로 보인다. 3D에서는 벽 없는 납작한 바닥이다.
- 방처럼 배경 장소와 카메라를 연결할 수 있다. 건물과 겹치면 항상 건물 아래에 깔려서 건물을 누르는 데 방해되지 않는다.
- 꺾이는 길은 다각형으로 그린 뒤 점을 다듬어 만든다. 이미 그린 방을 도로로 바꾸거나 되돌릴 수도 있게 한다.

**카메라 색**
- 카메라를 고르면 속성 칸에 색 동그라미 여섯 개가 나오고, 누르면 그 카메라 색이 바뀐다. 평면·3D·작은 평면도·오른쪽 목록에 같은 색으로 보인다.
- 공간·선택 표시와 헷갈리는 보라색은 뺀다. 색을 고르지 않은 카메라는 지금과 같은 호박색이다.

**저장과 배포**
- 운영 DB에 저장 규칙을 한 번 추가한다. 새 종류를 허용하도록 넓히는 것뿐이고 기존 자료는 건드리지 않는다. DB를 먼저 적용하고 앱을 배포한다.
- 계단·도로·카메라 색을 한 번이라도 저장하면 1.132.0 이하 버전의 앱에서는 배경 화면이 열리지 않는다. 소유자가 쓰는 PC를 모두 새 버전으로 올린 뒤에 새 기능을 쓴다(다른 팀원은 배경 화면이 보이지 않아 영향이 없다).
- 새 버전부터는 이런 경우(앱이 모르는 종류가 저장돼 있음)에 오류 대신 "업데이트가 필요해요" 안내가 뜬다.

**승인 문구의 해석 — 묻지 않고 정한 것.** 승인 문구가 한 가지로 정하지 않는 여섯 곳이다. 여섯 다 운영 DB를 다시 건드리지 않고 고칠 수 있는 답으로 골랐고, 다른 답이 오면 고칠 곳을 적어 둔다. I4·I5는 승인 문구의 "건물과 겹치면 항상 건물 아래에"를 3D와 큰 방 안에서 어떻게 읽었는가이고, 이 설계에서 쓰는 사람에게 가장 크게 닿는 두 곳이다.

| # | 승인 문구 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| I1 | "색 동그라미 여섯 개가 나오고 … 색을 고르지 않은 카메라는 지금과 같은 호박색이다" | 동그라미는 **정확히 여섯 개**다(고르는 색 여섯). 호박색은 동그라미가 아니다 — 고른 색을 지우고 호박색으로 돌아가는 길은 동그라미 줄 끝의 **글자 버튼 '기본 색으로' 하나**다(8.2). 승인 문구는 되돌아가는 길을 말하지 않는다. 저장되는 색 이름은 여섯 개이고 호박색은 저장하지 않는다(키가 없는 것이 호박색이다, 3.1) | 되돌아가는 버튼이 필요 없으면 그 버튼만 뺀다(되돌리기 Ctrl+Z만 남는다). 서버가 받는 이름 여섯과 `setCameraColor`는 그대로다 |
| I2 | "회색 바닥에 가운데 점선이 있는 길" · "꺾이는 길은 다각형으로 그린 뒤 점을 다듬어 만든다" | 가운데 점선은 **곧은 길(사각형)**과 **띠 모양 다각형**(두 옆줄의 점이 같은 수로 마주 보는 것 — 7.4의 띠 규칙)에 그린다. 타원, 점이 홀수 개인 다각형, 띠 규칙에서 떨어지는 다각형에는 그리지 않고(회색 바닥만), 그때는 속성 칸이 까닭을 한 줄로 알려 준다(7.3) | "다각형에는 점선이 없어도 된다"면 `roadCentreLine`의 다각형 가지를 `null`로 바꾸고 그 테스트와 7.3의 안내 한 줄만 고친다 |
| I3 | "방처럼 배경 장소와 카메라를 연결할 수 있다" · "건물과 겹치면 항상 건물 아래에 깔려서" | 새 카메라의 소속: 생성점을 품은 **방**이 정확히 하나면 그 방(도로는 세지 않는다). 방이 없고 도로가 정확히 하나면 그 도로. 새 기호의 소속: 놓은 자리의 맨 위 공간 — 방이 있으면 가장 작은 방, 없으면 도로(7.8) | "도로에는 자동으로 속하지 않게"면 `addMapCamera`의 도로 가지를 빼고 그 테스트만 고친다. 속성 칸의 '카메라가 있는 공간'에서 도로를 고르는 길은 남는다 |
| I4 | "건물과 **겹치면** 항상 건물 아래에 깔려서 건물을 누르는 데 방해되지 않는다" — 3D에서 | **'겹친다' = 평면에서 넓이가 겹친다**(변이나 모서리만 맞닿은 것은 겹친 것이 아니다 — `spacesOverlap`, 7.6). 3D에서 도로는 **자기와 겹친 방에게만** 진다: 그 방의 바닥이든 벽이든, 높이가 어떻든, 같은 광선에 맞았으면 방이 잡힌다. 그래서 건물 밑에 깔린 도로에서 **그 건물의 벽 너머로 보이는 자리**는 처음 누르면 건물이고, 같은 자리를 천천히 한 번 더 누르면 도로다. **건물 옆을 지나는(겹치지 않는) 도로는 v1.132.0의 방과 같다** — 벽 너머로 보이는 자리도 처음 누를 때 도로가 잡히고, 더블클릭은 도로의 것이다. 조금이라도(1 도면 단위라도) 도로에 걸쳐 그린 건물은 겹친 것이다 | "겹치지 않아도 3D에서는 도로가 늘 건물에 지게"면 `roadsUnderRooms`의 겹침 검사를 뺀다(한 줄) — 그러면 길가에 건물이 늘어선 도면의 맞춤 보기에서 길이 보이는 자리의 94%가 처음 누를 때 앞 건물이다(7.6의 측정). "3D에서는 도로도 방처럼(벽 너머의 바닥이 먼저)"이면 `pickMapNode`의 그 걸음과 `mapSpacePile`을 뺀다 — 그러면 넓은 도로 위에 선 건물은 몸통의 55%에서 도로가 잡힌다. 어느 쪽이든 그 두 함수와 10.7의 표만 바뀐다 |
| I5 | "항상 건물 아래에 깔려서" · (이전 결정) "작은 공간이 위, 같은 자리를 천천히 다시 누르면 아래로" | '건물'을 **도로가 아닌 모든 공간**으로 읽는다(도로는 크기와 무관하게 모든 방 아래). 그래서 **더 큰 방(부지·마당) 안에 통째로 그린 도로**에서는 "작은 공간이 위"가 서지 않는다: 그 도로는 몸통을 바로 누를 수 없고, 이미 선택돼 있어도(방금 그렸거나 목록에서 골랐어도) 몸통을 끌면 **바깥 방이 소속 항목과 함께 움직인다**(7.7). 도로를 잡는 길은 같은 자리를 천천히 한 번 더 누르기, Shift+상자, 오른쪽 목록과 손잡이이고, 속성 칸의 도로 안내가 그 길을 말한다(7.3). 쌓임·누름 규칙 자체는 ②의 것 그대로다 | "방 안의 도로는 그 방보다 위"이면 쌓임의 층을 "도로는 **자기보다 작은** 방들 아래"로 다시 정해야 한다 — `stackedSpaces`가 한 줄 정렬이 아니게 되고 7.6·7.7·10.3의 표를 다시 쓴다(저장 계약은 그대로) |
| I6 | "색 동그라미 여섯 개" · "보라색은 뺀다" | 승인 문구가 정한 것은 **수(여섯)와 뺄 색 하나(보라)**다. 여섯의 색상(빨강·연두·초록·청록·파랑·분홍)과 주황·노랑·회색·흰색을 뺀 것은 이 설계의 선택이다(3.2). 운영 DB에 들어가는 것은 여섯 **칸의 이름**(`red` … `pink`)이고, 칸의 색과 화면 이름은 앱이 정한다 — 색을 다른 것으로 바꾸게 되어도 migration 없이 `mapCameraColor.ts`와 CSS만 고친다(3.1). 이름과 색이 어긋나는 일을 줄이려고 **DB를 적용하기 전에** 여섯 색의 화면을 한솔에게 보인다(5.4의 1) | 색을 바꾸자는 답이 DB 적용 **전에** 오면 이름까지 맞춰 고친다(상수·요소 파일·CSS·색 표를 같은 PR에서). 적용 **뒤에** 오면 값과 화면 이름만 고친다 — 저장된 이름은 칸 이름으로 그대로 두고 DB는 다시 건드리지 않는다 |

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 계단을 눌러 위·아래층 도면으로 넘어가기, 계단에 도면 연결 | 승인 문구: "연결 기능은 넣지 않는다" |
| 예전에 뺀 기호 넷(책상·소파·수납장·화분) 되살리기 | 한솔 확정(이전 결정). 저장된 것은 지금처럼 '기타 사물'로 보인다 |
| 계단의 디딤판 수·난간·꺾인 계단(ㄱ자, 돌음), 평면과 3D의 디딤판 수 맞추기 | 승인 문구에 없다. 평면 기호는 정해진 그림 하나, 3D의 단 수는 높이에서 정한다(6.3) |
| 네 번째 노드 종류 만들기 | 종류별 가지(`map3dScene.ts`, `mapSpatial.ts`, `mapGeometry.ts`, SQL)가 모두 셋을 전제한다. 도로는 공간의 선택 키 하나다 |
| 도로의 차선 수·폭 설정·횡단보도·가운데 점선 켜고 끄기, 도로 색 고르기 | 승인 문구는 "회색 바닥에 가운데 점선"뿐이다 |
| 꺾인 도로를 한 번에 그리는 전용 도구(점을 이어 폭이 있는 길 만들기) | 승인 문구: "다각형으로 그린 뒤 점을 다듬어 만든다" |
| 도로와 방의 앞뒤 순서를 손으로 바꾸기 | 승인 문구: "항상 건물 아래에". 쌓임 순서는 읽을 때 계산한다(저장하지 않는다) |
| 카메라 색을 자유롭게 고르기(색상 선택기·16진수 입력), 기호·공간에 색 주기 | 승인 문구: 동그라미 여섯 개, 카메라만 |
| '카메라 추가' 버튼·'이 카메라 시점으로 보기' 띠·위아래 방향 버튼의 호박색 바꾸기 | 그 색은 "카메라 일반"을 뜻하는 화면 색이다. 카메라 하나의 색이 아니다 |
| 색으로 카메라 걸러 보기·정렬, 여러 카메라의 색을 한꺼번에 바꾸기 | 요청 없음. 여러 개 선택의 요약(② 설계 6.5)은 그대로다 |
| 이전 버전 앱을 위한 호환 처리(모르는 값을 지우고 읽기, 서버가 옛 모양으로 내려 주기) | 모르는 값을 읽을 때 지우면 통째 저장이 그것을 지운다(라운드 계획 4절). 이전 버전은 화면을 열지 못하는 것이 맞고, 소유자 PC를 모두 올린 뒤 새 기능을 쓴다 |
| 배경 화면을 팀에 열기, 편집자 지정 | ④의 일. 이번 차례는 ④가 기대는 업데이트 안내까지만 만든다 |
| 도면 주석 | ⑤의 일(별도 표) |

### 1.3 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | **적용된 두 SQL 파일의 본문은 고치지 않는다**(운영에서 함수 본문 md5를 대조했다) | 머리말 주석 줄만 고친다(4.3). `BEGIN;`부터 파일 끝까지의 해시를 테스트로 고정한다(4.4) |
| R2 | 익명 직접 접근 없음, SECURITY DEFINER 세션 래퍼, `search_path` 고정 (CLAUDE.md 규칙 7) | 요소 파일은 검증 함수 하나만 바꿔 넣는다(`SECURITY INVOKER SET search_path = public, pg_temp` 그대로). 새 함수·표·권한이 없다. 끝에서 기본 파일과 같은 잠금 블록을 다시 돈다 |
| R3 | 서버는 검증만 하고 값을 채우거나 고쳐 쓰지 않는다 | 검증 함수는 `RETURNS VOID`다. 응답 유실 복구(`mapSaveWasApplied`, mapWorkflow.ts:7-14)가 보낸 도면과 저장된 도면을 글자 그대로 견준다 |
| R4 | 새 필드는 선택 키다. 없으면 지금의 동작, 기본값으로 되돌리면 키를 **지운다**(`null`·`undefined`로 두지 않는다) | **이미 있는 노드의** 이 키를 바꾸는(쓰고 지우는) 곳은 `setSpaceSurface`·`setCameraColor` 두 순수 함수뿐이다. 새 도로만은 `newSpace`가 처음부터 `surface: 'road'`를 넣어 만든다(3.3). `patchNode`로는 쓰지 않는다(합치기만 해서 지울 수 없다, BackgroundMapEditor.tsx:471-478) |
| R5 | 모르는 값을 읽을 때 지우지 않는다 | 검증은 여전히 통째로 거절한다. 거절의 **종류**만 가른다(5.2) |
| R6 | 평면 SVG·3D·보조 평면도는 `mapDocument.ts`의 초안 하나를 읽는다 | 세 화면 모두 노드의 `surface`·`color`·`symbol`을 초안에서 읽는다. 화면별 사본이 없다. `mapCanvas.ts`의 계약은 바뀌지 않는다 |
| R7 | 한 번의 끌기 = 되돌리기 한 단계 | 도로 그리기는 기존 `draw` 제스처 한 번, 방↔도로 바꾸기와 색 고르기는 `update` 한 번씩이다 |
| R8 | 쌓임 순서는 `mapStack.ts` 한 곳 | 도로는 비교 함수의 맨 앞 항 하나로 들어간다(② 설계 7.6). 쌓임 순서를 읽는 여섯 곳(2.4)의 읽는 줄은 고치지 않는다. 쌓임 순서가 닿지 않는 3D의 두 경우(광선이 방의 **벽**을 맞힌 때, **다른 높이의 바닥**을 맞힌 때 — 7.6)에만 `pickMapNode`에 "도로 바닥은 **자기와 평면에서 겹친 방**에 진다"는 규칙 하나를 더한다 — 겹치는지는 같은 모듈의 새 순수 함수 `spacesOverlap`(`mapStack.ts`)이 정한다(I4). 그 규칙으로 가려지는 도로에 닿을 수 있도록 같은 자리를 다시 누를 때의 더미(`mapSpacePile`)에 벽으로 잡힌 방을 도로 앞에 넣는다(7.6). `mapFloorPile`을 부르던 두 줄(`mapClickStep`, 손잡이 위의 클릭)이 `mapSpacePile`을 부르게 되고 `mapFloorPile` 자체는 그대로다. 방과 겹치지 않는 도로에는 v1.132.0의 누름 규칙이 그대로 쓰인다 |
| R9 | 상자는 공간의 **벽**에 닿아야 그 공간을 고른다. 작은 공간이 위, 같은 자리를 천천히 다시 누르면 아래로 | 도로도 공간이므로 같은 규칙이다. `mapPlanSelect.ts`·`mapPlanPreview.ts`의 판정 함수는 고치지 않는다 |
| R10 | 늘 깔린 눈금 없음, 새 카메라는 고정 생성점, 상세 도면이 연결된 공간의 더블클릭은 그 도면으로 | 건드리지 않는다. 도로도 상세 도면을 가질 수 있고 더블클릭 규칙이 같다 |
| R11 | 테스트는 Node type-stripping으로 돈다 | 새·바뀌는 `.ts` 모듈은 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만(`satisfies`·매개변수 속성·enum 금지), 경로 별칭 금지 |
| R12 | three.js 없는 모듈은 그대로 둔다 | `domain.ts`·`mapSpatial.ts`·`mapGeometry.ts`·`mapStack.ts`·`mapPlanPreview.ts`·새 `mapCameraColor.ts`는 three.js·DOM을 import하지 않는다. 3D 파일은 평면 편집 모듈을 import하지 않는다(앵커 10 불변) |
| R13 | 움직임 규칙 | 새 요소에 전환·애니메이션·`backdrop-filter`를 넣지 않는다 |
| R14 | 배경 메뉴 노출 범위 불변 | `src/features/playground/featureFlag.ts`를 건드리지 않는다 |

뒤 차례를 막지 않는 점: ④는 `background_library_snapshot`·`background_library_execute`를 다시 만드는 자기 migration을 쓴다 — 검증 함수는 건드리지 않으므로 이번 파일과 겹치지 않고, 적용 사슬의 넷째로 붙는다(4.2). ④가 화면을 다른 계정에 여는 버전은 반드시 업데이트 안내(5.2)가 든 버전(v1.133.0 이상)이어야 한다. ⑤의 주석은 별도 표라 이번 계약과 무관하다.

뒤 차례가 알고 들어와야 하는 두 가지(인수인계 17.4·17.5에 옮겨 적는다, 12절):

- **`CLAUDE.md` :3과 `AGENTS.md` :3의 안내 줄은 ④가 다시 쓴다**("배한솔 계정에만 열려 있다"가 든 시험 공개 안내다). 이번 차례는 그 줄에 적용 사슬 문장을 적지만(4.3), 계약 테스트(D4)는 그 줄의 글자를 **고정하지 않는다** — 옛 두 파일 문장이 남아 있지 않다는 것만 본다. 긍정 문구("그 뒤의 파일을 모두 순서대로 다시 실행한다")를 고정하는 곳은 ④가 지우지 않고 덧붙이기만 하는 곳이다: `AGENTS.md`의 데이터 경계 항목과 세 SQL 파일의 머리말. `npm run build`가 `test:background`를 돌리므로(package.json :25), 안내 줄의 글자를 고정했다면 ④가 그 줄을 다시 쓰는 순간 배포 빌드가 멈춘다. ④는 안내 줄을 다시 쓸 때 사슬 문장(또는 그것이 적힌 곳으로 가는 길)을 옮겨 적는다.
- **저장 모양을 넓히는 migration을 운영에 적용한 뒤 그 앱 버전의 배포가 끝날 때까지, 운영에 새 모양을 저장하지 않는다**(개발 빌드로도, 검증하면서도). 서버는 앱 버전을 모르므로 적용한 순간부터 새 모양을 받는다. 그 사이에 한 번이라도 저장되면, 그 모양을 모르는 PC — 그때 배포돼 있는 버전 전부 — 가 배경 화면 대신 업데이트 안내를 띄우고(v1.132.0 이하는 빨간 오류 띠, 2.2) 저장하지 않은 편집을 잃는데(5.2), **올릴 버전이 아직 없다.** 이번 차례는 4.5의 9번과 5.4의 6번이 이것을 지킨다. ④ 뒤에는 그 실수가 팀 전체에 닿는다.

---

## 2. 현재 동작 (v1.132.0)

파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다. 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

### 2.1 새 기호 종류·새 키가 지나야 하는 허용 목록

닫힌 목록이 여러 곳에 따로 적혀 있다. 하나라도 빠지면 저장이 막히거나 화면이 '기타 사물'로 그린다.

| # | 곳 | 위치 | 지금 | 새 기호 종류 | 공간의 새 키 | 카메라의 새 키 |
|---|---|---|---|---|---|---|
| 1 | 타입 | types.ts:35 (`BackgroundSymbolKind`), :12-21 (`BackgroundSpace`), :22-33 (`BackgroundCamera`) | 종류 아홉, 선택 키는 수직 값뿐 | 걸린다 | 걸린다 | 걸린다 |
| 2 | 앱 검증 — 키 | domain.ts:18 (`onlyKeys`), :41 (공간), :48 (카메라), :51 (기호) | 목록에 없는 키는 `'지원하지 않는 배경 속성이 포함되어 있습니다.'` | — | 걸린다 | 걸린다 |
| 3 | 앱 검증 — 종류 | domain.ts:52 | 문자열 아홉 개를 줄 안에 적어 둠. 아니면 `'사물 기호가 올바르지 않습니다.'` | 걸린다 | — | — |
| 4 | 서버 검증 — 키 | 3D 파일 :52-54(필수 키), :55-58(`spatial`: 선택 키), :59(`background_library_object(n-spatial,keys)`) | 선택 키를 뺀 나머지가 필수 키와 정확히 같아야 한다 | — | 걸린다 | 걸린다 |
| 5 | 서버 검증 — 종류 | 3D 파일 :73 (기본 파일 :106) | `n->>'symbol' IN (…아홉 개…)` | 걸린다 | — | — |
| 6 | 서버의 전체 재검사 | 기본 파일 :140-186 (`background_library_validate`), :145-146 | **쓰기마다, 지워지지 않은 모든 행**을 검증 함수로 다시 본다(:145의 `WHERE deleted_at IS NULL`, 호출은 변경을 적용한 뒤인 :274) | 좁은 검증 함수가 돌아오면, 새 모양이 든 도면을 **남겨 두는** 쓰기는 모두 막힌다 — 사실상 모든 편집이다. 그 도면을 지우거나 새 모양을 빼고 저장하는 쓰기만 지나간다(4.2) | 같다 | 같다 |
| 7 | 기본 높이 | mapSpatial.ts:30-32 (`SYMBOL_VOLUME_HEIGHTS: Record<BackgroundSymbolKind, number>`), :61-65 | 종류마다 값이 있어야 컴파일된다. 표에 없는 문자열은 `custom`의 80 | 걸린다(타입) | — | — |
| 8 | 기호 목록 | symbolCatalog.ts:3-14, :17-19 | 다섯 개. **목록에 없는 종류는 목록의 마지막 항목**으로 읽는다(:18 `symbolCatalog[symbolCatalog.length - 1]`) — 지금은 마지막이 `custom`이라 옛 종류 넷이 '기타 사물'이 된다 | 걸린다. 끝에 붙이면 옛 종류 넷이 계단이 된다 | — | — |
| 9 | 평면 기호 그림 | BackgroundSymbolGlyph.tsx:16 (`getSymbolPreset(storedSymbol).id`), :27-65 | 종류별 가지 다섯. 그림은 100×100 상자이고 편집기가 `scale(width/100 height/100)`으로 늘인다(:1016) | 걸린다 | — | — |
| 10 | 3D 기호 | map3dScene.ts:474-539 (`buildSymbol`), :475, :491-523 | 종류별 가지, 그 밖은 점선 상자. `shapeKey`(:88-94)에 종류·크기·높이가 든다 | 걸린다 | — | — |
| 11 | 3D 공간 | map3dScene.ts:445-471 (`buildSpace`) | 바닥 + 벽 + 테두리. 높이는 `nodeVolumeHeight` | — | 걸린다 | — |
| 12 | 3D 카메라 | map3dScene.ts:542-573 (`buildCamera`), :397-403(재질) | 색은 팔레트의 `camera` 하나 | — | — | 걸린다 |
| 13 | 보조 평면도 | BackgroundMapPlanPreview.tsx:43-52 (`PlanShape`), :81-89 (`PlanCamera`), mapPlanPreview.ts:19, :182-184, :202-207, :234-255 | 공간·기호는 윤곽 다각형, 카메라는 표시. 종류 이름 셋(`PLAN_KIND_LABELS`) | 지나간다(기호는 윤곽 상자로만 그린다) | 걸린다 | 걸린다 |
| 14 | 평면 편집기 | :35 (`Tool`), :79 (`isDrawTool`), :162 (`kindLabel`), :165-178 (`ObjectList`), :615-617 (`newSpace`), :931-936 (도구줄), :978-985 (기호 목록), :1000-1034 (그리기), :1072-1127 (속성 칸) | — | 걸린다 | 걸린다 | 걸린다 |
| 15 | 미리보기 저장소 | previewGateway.ts:36 (`validateBackgroundSnapshot`), :50 (`validateBackgroundRequest`), :56 (`applyBackgroundCommand`) | 같은 `domain.ts`를 쓴다. 따로 적힌 목록이 없다 | 2·3이 고쳐지면 지나간다 | 같다 | 같다 |
| 16 | 메인 프로세스 | electron/backgroundStore.ts:36, electron/backgroundIpc.ts:31 (`validateBackgroundRequest`) | 같은 `domain.ts`를 묶어 쓴다. 읽기는 모양만 본다(backgroundStore.ts:11-18) | 2·3이 고쳐지면 지나간다(소스는 그대로, 빌드만 새로) | 같다 | 같다 |

저장 한계는 그대로다: 도면당 노드 1000개(domain.ts:34), 다각형 점 200개(:44), 요청 28MB(:23).

### 2.2 읽을 때의 검증과 이전 버전의 동작

**읽는 길**: `BackgroundLibraryView`가 열리면 `initialize` → `refresh`(useBackgroundStore.ts:27-32). `refresh`는 `active.read()`로 받은 것을 `validateBackgroundSnapshot(snapshot)`(:30 → domain.ts:94-113)에 통째로 넣는다. 그 함수는 종류마다 모든 행을 `validateBackgroundEntity`로 본다(:96-98). 하나라도 던지면 `refresh`의 `catch`(:31)가 `loading: false, error: 그 문장`만 적고 `false`를 돌려준다 — **받은 것은 버리고**, 화면의 자료는 그 전 것(처음이면 빈 것) 그대로다. 메인 프로세스는 읽은 것의 모양(배열 다섯과 `canManage`)만 보고 넘긴다(electron/backgroundStore.ts:11-18).

**화면**: 오류 문장은 머리줄과 탭 아래의 빨간 띠 하나로 나온다(BackgroundLibraryView.tsx:126-130, `bg-error bg-global-error`, `role="alert"`). 띠 아래에는 그 전 자료로 그린 본문이 그대로 있다(:136-174).

**이전 버전(v1.130.0·v1.131.0·v1.132.0)이 새 모양을 만났을 때.** 세 버전의 `useBackgroundStore.ts`·`domain.ts`·`BackgroundLibraryView.tsx`·`electron/backgroundStore.ts`·`electron/backgroundIpc.ts`·`previewGateway.ts`·`symbolCatalog.ts`는 **바이트까지 같다**(d8325afb·a2cc1d38·a0ca0542에서 `git show <커밋>:<파일>`의 해시를 견줬다). 그래서 세 버전의 동작이 같다:

| 저장돼 있는 것 | 먼저 걸리는 줄 | 화면의 빨간 띠 |
|---|---|---|
| 기호의 `symbol`이 `'stairs'` | domain.ts:52 | `사물 기호가 올바르지 않습니다.` |
| 공간에 `surface` 키 | domain.ts:41 → :18 | `지원하지 않는 배경 속성이 포함되어 있습니다.` |
| 카메라에 `color` 키 | domain.ts:48 → :18 | `지원하지 않는 배경 속성이 포함되어 있습니다.` |

(여러 개가 있으면 도면 순서·노드 순서로 먼저 만난 것 하나의 문장이다.)

- **배경 화면을 새로 열 때**: 도면 하나에 새 모양이 하나만 있어도 **라이브러리 전체**가 거절된다 — 도면뿐 아니라 배경 목록·시점 묶음·에피소드별 배경 탭도 비어 보인다. 화면에는 위의 띠와, 빈 자료로 그린 본문이 나온다: 도면 탭은 '첫 도면을 만들어 보세요 / 관리자가 도면을 등록하면 이곳에서 탐색할 수 있습니다.'(:959, 빈 자료는 `canManage`가 거짓이다), 머리줄은 '라이브러리 보기'. 15초마다·창에 포커스가 올 때·변경 신호가 올 때 다시 읽고 다시 실패한다(BackgroundLibraryView.tsx:59-70). 아무것도 쓰지 않는다.
- **화면을 열어 둔 채였을 때**(다른 PC가 그 사이 새 모양을 저장): 다음 다시 읽기에서 띠가 뜨고, 화면에는 그 전 자료가 남아 **편집할 수 있는 채로** 있다. 거기서 저장하면: 서버는 (그 도면의 버전이 그대로면) 저장을 받아들이고 전체 자료를 돌려주는데, 앱이 그 응답을 검증하다 던지고(useBackgroundStore.ts:39), 복구 조회도 같은 이유로 던져(:46) 화면은 저장 전으로 돌아가고 오류가 보인다. **서버에는 저장이 반영돼 있다.** 같은 도면을 다시 저장하면 버전 충돌(40001)이다. 새 모양이 든 도면을 덮어쓰지는 못한다 — 이전 버전은 그 도면을 읽은 적이 없거나 옛 버전 번호로만 알고 있어 CAS에서 거절된다.
- **다른 화면**: 배경 저장소를 읽는 곳은 배경 화면 하나뿐이다(`src/views/viewLoaders.ts:22`만 이 기능을 불러온다). 다른 팀원의 앱에는 배경 메뉴가 없으므로 영향이 없다.

이것이 "소유자가 쓰는 PC를 모두 새 버전으로 올린 뒤에 새 기능을 쓴다"의 근거다. 이전 버전의 동작은 고칠 수 없다(이미 배포됐다).

### 2.3 카메라 색이 정해지는 곳

호박색이 네 군데에 따로 적혀 있다.

| 화면 | 위치 | 값 |
|---|---|---|
| 평면 SVG | backgrounds-map.css:59-70 | `#e6b578`과 그 반투명(`#e6b57820`·`…65`·`…40`·`…26`), 안쪽 표시 `#372715`. 선택된 카메라의 방향 손잡이·점선도 `#e6b578`(:69-70). **밝은 화면용 값이 따로 없다**(두 화면이 같은 색) |
| 오브젝트 목록 | backgrounds-map.css:129, :131 | `.bmap-node-kind.is-camera` `#e6b578`, 밝은 화면 `#a8701f` |
| 보조 평면도 | backgrounds-map-plan.css:2-3 | 뿌리의 변수 넷: `--bmap-plan-cam`(점) `#e6b578`, `--bmap-plan-cam-line`, `--bmap-plan-cam-edge`, `--bmap-plan-cam-soft`. 밝은 화면에서 선 `#a2670f`·테두리 `#8a560a`·옅은 채움이 바뀐다. 옆에서 본 그림(BackgroundMapPlanPreview.tsx:111-130)도 같은 변수를 쓴다 |
| 3D | map3dScene.ts:27-30 (`MAP3D_DARK_PALETTE.camera: 0xe6b578`, `cameraLens: 0x372715`), BackgroundMap3D.tsx:46 (밝은 화면도 같은 값), map3dScene.ts:397-403 | 재질 일곱: `camera`(몸통), `cameraLens`, `cameraLine`·`cameraLineOn`(시선·화면 틀·바닥 선), `cameraFar`·`cameraFarOn`(화면 틀 채움), `cameraRing`(바닥 고리). 재질은 이름으로 한 번 만들어 모든 카메라가 함께 쓰고(:365-410), 테마가 바뀌면 전부 버리고 다시 만든다(:216-224) |

선택·잠금은 색이 아니라 **굵기·진하기**로 읽힌다: 평면은 부채꼴이 진해지고 선이 굵어진다(:63, :66), 3D는 `…On` 재질(불투명도 0.6 → 1, 0.1 → 0.24), 보조 평면도는 굵은 선과 고리(backgrounds-map-plan.css:47-49). 잠금은 이름 앞의 자물쇠다. 그래서 카메라 색을 바꿔도 이 표시들은 그대로 읽힌다.

'카메라 일반'을 뜻하는 화면 색(카메라 하나의 색이 아니다): '카메라 추가' 아이콘(backgrounds-map.css:284-285), 위아래 방향·시점 보기 버튼의 눌린 테두리(:324), 3D의 '카메라 시점 미리보기' 띠와 돌아가기 버튼(backgrounds-map-3d.css:15-17, :23-24).

### 2.4 공간의 순서·누름·상자·소속

- **쌓임 순서**: `stackedSpaces`(mapStack.ts:18-25)가 `(넓이 내림차순, 배열 번호 오름차순)`으로 아래 → 위를 정한다(:24). 읽는 곳 여섯: 평면 SVG의 그리기(:1000), 같은 자리를 다시 누를 때 넘어가는 목록(`planPileAt`, mapPlanPreview.ts:145-150 → `spacesAt`), 보조 평면도(BackgroundMapPlanPreview.tsx:220), 3D의 같은 높이 바닥(`pickMapFloor`, map3dScene.ts:597-610 → `spaceStackRanks`), 3D에서 같은 자리를 다시 누를 때 넘어가는 바닥 목록(`mapFloorPile`, map3dScene.ts:632-646 → `spaceStackRanks`. `mapClickStep` :666과 손잡이 위의 클릭 BackgroundMap3D.tsx:562가 쓴다), 새 기호의 소속(`placeSymbol`, :504).
- **평면의 누름**: DOM에서 뒤에 그린 것이 누름을 받는다. 공간 → 기호 → 카메라 순으로 그리므로(:1000, :1008, :1021) 기호·카메라가 늘 공간 위다.
- **상자**: 공간은 벽(윤곽선)이 상자와 만나야 잡힌다(`planRectTouches`, mapPlanSelect.ts:60-76). 모양만 본다 — 공간의 종류를 읽는 줄이 없다.
- **3D의 누름**: 카메라·기호의 실체 → 포인터 아래 바닥(가까운 높이 먼저, 같은 높이는 쌓임 순서) → 바닥이 없으면 가까운 벽(`pickMapNode`, map3dScene.ts:617-630). **광선 위에 바닥이 하나라도 있으면 벽은 지고 그 바닥이 잡힌다**(:628-629) — 방의 벽을 눌렀는데 광선이 그 방을 지나 뒤의 더 큰 방 바닥에 닿으면 큰 방이 잡힌다(그 함수의 머리말 :612-615 — 벽은 그 안이나 뒤에 선 것의 클릭을 삼키지 않는다). 도로를 그대로 두면 건물 밑에 깔린 도로가 이 "뒤의 바닥"이 된다(7.6에서 막는다).
- **새 카메라의 소속**: 고정 생성점 (500, 340)을 품은 공간이 **정확히 하나**일 때만 그 공간(`addMapCamera`, mapGeometry.ts:261-266. `tests/backgroundMapGeometry.test.ts:235-255`가 고정).
- **새 기호의 소속**: 놓은 점에서 맨 위(가장 작은) 공간(`spacesAt(base, point)[0]`, :504). 바닥 높이도 그 공간 것(:506-508).
- **소속 항목의 이동**: `transformMapSpace`(mapGeometry.ts:54-77) 한 곳. 공간의 위치·크기·회전·바닥 높이가 바뀌면 `spaceId`가 그 공간이고 잠기지 않은 카메라·기호가 함께 간다.
- **공간의 세로 크기를 읽는 곳**: `nodeVolumeHeight`(mapSpatial.ts:61-65, 없으면 180). 읽는 곳 — 3D의 벽과 이름표 높이(map3dScene.ts:447-448), 3D 전체 범위(:696), 기즈모의 높이 방향 크기(mapGeometry.ts:315, :319), 속성 칸의 '입체 높이'(:1117-1118), 보조 평면도의 읽어 주는 값(mapPlanPreview.ts:205)과 옆에서 본 그림(:240-243).

### 2.5 이전 분석(라운드 계획)에서 바로잡은 것

| 라운드 계획의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| "v1.130.0이 라이브러리를 열지 못한다" | v1.131.0·v1.132.0도 읽는 코드가 바이트까지 같다(2.2) | 이전 버전 = v1.130.0~v1.132.0 전부 |
| "기호 목록에서 계단을 `custom` 앞에 끼운다(마지막 항목이 대체값이라서)" | 맞다(symbolCatalog.ts:18) | 앞에 끼우고, **대체값을 자리 대신 이름으로 찾게도 고친다**(6.1). 다음에 기호를 더할 때 같은 함정이 없다 |
| "색 표는 `mapSpatial.ts`에 한 벌" | 평면·보조 평면도는 CSS가, 3D는 숫자가 필요하다. `mapSpatial.ts`는 좌표 변환 모듈이다 | 3D용 숫자 표는 새 `mapCameraColor.ts`, 화면용은 CSS 변수. 두 벌이 같은지는 테스트가 본다(10.6) |
| "평면에 밝은 화면용 호박색을 더한다" | 승인 문구: "색을 고르지 않은 카메라는 지금과 같은 호박색" | 기본 카메라의 모습은 두 화면 모두 **지금 그대로** 둔다. 밝은 화면용 값은 새 여섯 색에만 준다 |
| "16진수+투명도 대신 `fill-opacity`를 쓴다" | 이 앱의 CSS는 색을 숫자 셋으로 두고 `rgb(var(--x) / 투명도)`로 쓴다(backgrounds-map.css 곳곳) | 같은 방식: `--bmap-cam`(숫자 셋)과 `rgb(var(--bmap-cam) / …)` |
| "도로의 가운데 점선은 사각형에만" | 사각형을 '다각형으로 바꾸기'로 바꾸는 순간 모양은 같은데 점선만 사라진다 | 띠 모양 다각형에도 그린다(I2, 7.4) |
| "속성 칸의 '공간 종류'는 다각형용" | 승인 문구: "이미 그린 방을 도로로 바꾸거나 되돌릴 수도 있게" | 모양과 무관하게 모든 공간에 낸다(7.3) |
| "옆에서 본 그림은 도로를 건너뛴다" | 세로 크기를 읽는 곳이 여섯이다(2.4) | 여섯 곳 모두 정한다(7.9) |
| "도로를 '품은 공간' 셈에서 뺀다" | 빼기만 하면 도로 위에 홀로 선 카메라가 도로에 속하지 못한다 | 방이 먼저, 방이 없으면 도로(I3, 7.8) |
| "3D 테스트의 자원 수 검사는 :613-632" | ②에서 줄이 밀렸다 | 지금은 `tests/backgroundMap3dScene.test.ts:793-848` |
| "두 적용 파일을 절대 고치지 않는다 / 사슬을 각 머리말에 적는다"(서로 어긋남) | 운영과 대조한 것은 함수 본문이다. 테스트는 머리말을 정규식으로만 본다(`tests/backgroundDatabaseContract.test.ts:36-37`, :73-74) | 본문만 얼린다. 머리말 주석은 고친다(4.3) |

---

## 3. 저장 모양

### 3.1 세 가지 추가

| 대상 | 추가 | 뜻 | 정한 이유(한 줄) |
|---|---|---|---|
| 기호 `symbol` | 값 `'stairs'` | 계단 | 종류 이름은 영어 소문자 한 단어(기존 아홉과 같은 꼴). 새 필드가 없다 — 방향은 `rotation`, 크기는 `width`·`height`, 높이는 `volumeHeight`가 이미 한다 |
| 공간 | 선택 키 `surface`, 값은 `'road'` 하나 | 있으면 도로, **없으면 방** | 참·거짓 대신 이름 붙은 값이라 나중의 바닥 종류(물·잔디)가 같은 키의 값 하나로 들어온다. 이전 자료는 키가 없으므로 그대로 방이다 |
| 카메라 | 선택 키 `color`, 값은 색 이름 여섯 가운데 하나 | 있으면 그 색, **없으면 지금의 호박색** | 16진수가 아니라 이름을 저장해야 어두운·밝은 화면이 각자 잘 보이는 값으로 풀 수 있고, 나중에 값을 다듬어도 저장 자료가 그대로다 |

**색 이름은 칸의 이름이다.** 서버가 아는 것은 문자열 여섯 개뿐이고, 그 칸이 어떤 색으로 보이고 화면에서 무엇이라 불리는지는 앱(`mapCameraColor.ts`와 CSS)이 정한다. 승인 문구가 정한 것은 수(여섯)와 뺄 색(보라)이고 여섯의 색상은 이 설계가 골랐으므로(I6), 나중에 한 칸의 색을 다른 색상으로 바꾸게 될 수 있다 — 그때도 **운영 DB와 저장된 자료는 건드리지 않고** 그 칸의 값과 화면 이름만 고친다(예: `pink` 칸을 주황으로. 코드의 이름과 보이는 색이 어긋나는 것은 받아들이고 `mapCameraColor.ts`의 그 줄에 주석으로 적는다). "저장 규칙을 한 번 추가한다"는 승인 문구는 색에 대한 답이 무엇이든 지켜진다. 다만 어긋남 자체를 피하려고 여섯 색은 DB 적용 전에 화면으로 한솔에게 보인다(5.4의 1).

```ts
// types.ts
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

```ts
// domain.ts — 닫힌 목록은 여기 한 곳. 요소 파일의 IN 목록이 같은 순서로 같아야 한다(4.4).
/** Closed lists of the stored map shape. Mirrored by DEVLOG/migrations/2026-10-09-background-map-elements.sql. */
export const BACKGROUND_SYMBOL_KINDS: readonly BackgroundSymbolKind[] = ['door', 'desk', 'chair', 'table', 'sofa', 'bed', 'cabinet', 'plant', 'custom', 'stairs'];
export const BACKGROUND_SPACE_SURFACES: readonly BackgroundSpaceSurface[] = ['road'];
export const BACKGROUND_CAMERA_COLORS: readonly BackgroundCameraColor[] = ['red', 'lime', 'green', 'teal', 'blue', 'pink'];
```

기호의 `hinge`·`swing`은 계단에도 그대로 저장된다(모든 기호의 필수 키다, domain.ts:54 · 3D 파일 :75). 새 계단은 `'left'`·`'inward'`로 만들어지고 화면 어디에도 쓰이지 않는다(문으로 종류를 바꾸는 길이 없으므로 보일 일도 없다).

한계: 새 키는 문자열 하나씩이고 숫자 범위가 없다. 도면당 노드 1000개·다각형 점 200개·요청 28MB는 그대로다. 도로도 공간이므로 `width`·`height` 10~100000, `shape` 셋, `points` 규칙이 같다.

### 3.2 색 표

저장되는 것은 **이름**(칸의 이름, 3.1)이다. 값과 화면 이름은 앱이 정하며 저장 자료·운영 DB와 무관하게 고칠 수 있다. 아래의 색상 여섯은 승인 문구가 아니라 이 설계가 고른 것이다(I6).

| 이름(저장) | 화면 이름 | 어두운 화면 | 밝은 화면 |
|---|---|---|---|
| (키 없음) | 호박색 — 동그라미가 없다. '기본 색으로' 버튼이 이 상태로 되돌린다(8.2) | `#e6b578` · `230 181 120` | 지금 그대로(2.3) |
| `red` | 빨강 | `#f2726b` · `242 114 107` | `#c2362f` · `194 54 47` |
| `lime` | 연두 | `#b7d84b` · `183 216 75` | `#5f7f0f` · `95 127 15` |
| `green` | 초록 | `#5fcf8b` · `95 207 139` | `#1f8a4c` · `31 138 76` |
| `teal` | 청록 | `#45cfc4` · `69 207 196` | `#0b8a82` · `11 138 130` |
| `blue` | 파랑 | `#63a9f7` · `99 169 247` | `#1e6fd0` · `30 111 208` |
| `pink` | 분홍 | `#f58fb8` · `245 143 184` | `#c23f7c` · `194 63 124` |

- 뺀 색: **보라**(공간과 선택 표시의 색 — `--color-accent` `108 92 231`, `--color-accent-sub` `162 155 254`), **주황·노랑**(호박색과 가깝다), **회색·흰색**(도로와 가깝다).
- 순서(빨강 → 분홍)는 색상환 순서이고 화면의 동그라미 순서다. 동그라미는 이 여섯 개가 전부다(승인 문구의 "여섯 개").
- 어두운 화면 값은 어두운 바탕(`15 17 23`) 위에서, 밝은 화면 값은 밝은 바탕 위에서 보이게 한 벌씩 골랐다. 실제로 잘 보이는지, 기호 색(`#89b8bf` — 청록과 가깝다)·스냅 안내선(`#ff7aa8` — 분홍과 가깝다)·선택 표시(보라 — 파랑과 가깝다)·도로와 헷갈리지 않는지는 앱 엔진에서 본다(11절 C8). **C8은 운영 DB 적용보다 먼저 끝낸다**(5.4의 1): 헷갈리는 칸이 있으면 그때는 이름까지 바꿀 수 있다. 적용한 뒤에는 값과 화면 이름만 고친다 — 어느 때든 값을 고치는 것으로는 저장 계약이 바뀌지 않는다.

### 3.3 최소 쓰기 규칙

- 보기·전환·선택은 아무것도 쓰지 않는다(지금과 같다).
- `surface`는 도로일 때만 `'road'`로 쓰고, 방으로 되돌리면 **키를 지운다**. `color`는 여섯 가운데 하나를 골랐을 때만 쓰고, '기본 색으로'를 누르면 **키를 지운다**. `null`·`undefined`·빈 문자열을 쓰지 않는다 — 앱 검증이 거절하고(키가 있으면 값을 본다), 끌기가 "바뀐 것이 없다"고 판정하는 깊은 비교(`sameValue`, mapEditSession.ts:9-18)와 응답 유실 복구가 키의 유무를 견주기 때문이다.
- **이미 있는 노드의** 이 두 키를 쓰고 지우는 곳은 순수 함수 둘뿐이다(새 도로의 `surface`만은 `newSpace`가 넣어 만든다 — 아래의 "새 도로는 …" 줄):

```ts
// mapGeometry.ts
/** A space as a road, or as a room again (`surface` null). The key is written only for a road and removed for a room. The same object back when nothing changes or the space is locked. */
export function setSpaceSurface(space: BackgroundSpace, surface: BackgroundSpaceSurface | null): BackgroundSpace;
/** A camera in a colour of the palette, or in the default again (`color` null). The key is removed for the default. The same object back when nothing changes or the camera is locked. */
export function setCameraColor(camera: BackgroundCamera, color: BackgroundCameraColor | null): BackgroundCamera;
```

  둘 다: 잠겼거나 `(node.key ?? null) === 받은 값`이면 받은 객체 그대로. 값이 있으면 `{ ...node, key: 값 }`. 지울 때는 `const next = { ...node }; delete next.key; return next;`(선택 속성이라 `delete`가 타입에 맞다).
- 도로로 바꿔도 `volumeHeight`는 지우지 않는다(있던 값 그대로). 방으로 되돌리면 예전 벽 높이가 돌아온다. 도로인 동안 `volumeHeight`를 새로 쓰는 길은 없다(7.9).
- 새 도로는 `newSpace`가 처음부터 `surface: 'road'`를 넣어 만든다(7.2). 새 계단은 `placeSymbol`이 `symbol: 'stairs'`로 만든다(기존 길 그대로). 새 카메라에는 `color`가 없다(`createMapCamera` 불변 — `tests/backgroundMapGeometry.test.ts:229` 불변).
- 노드를 통째로 펼쳐 복사하는 기존 길(`transformMapSpace`, `rectToPolygon`, `polygonFromWorldPoints`, `applyNodeWorldPose`, `previewPlanGesture`의 그리기, `duplicateSymbol`)은 새 키를 그대로 실어 나른다. 키를 하나씩 골라 새 객체를 만드는 곳이 없다(확인: 공간·카메라를 만드는 곳은 `newSpace`(:615-617), `createMapCamera`(mapSpatial.ts:94-98), `previewGateway.ts`의 시험 자료뿐이다).

### 3.4 서버가 검증하는 것

- 기호: `symbol`이 열 개 가운데 하나.
- 공간: `surface` 키가 있으면 값이 `'road'`. 카메라: `color` 키가 있으면 값이 여섯 가운데 하나. JSON의 `null`·숫자·참거짓·배열·객체는 모두 거절(22023).
- `surface`는 공간에만, `color`는 카메라에만. 다른 종류에 붙으면 "키 목록이 맞지 않는다"로 거절(22023, 기존 문장 `도면 배치 항목이 올바르지 않습니다.`).
- 서버는 값을 채우지도, 지우지도, 고쳐 쓰지도 않는다(R3). 기존 행을 건드리지 않는다(backfill 없음).

앱 검증(`domain.ts`)은 같은 규칙을 본다. **문장이 서버와 같은 것은 새 값 문장 둘**(`공간 종류가 올바르지 않습니다.`, `카메라 색이 올바르지 않습니다.`)이고, 나머지는 양쪽이 지금 쓰는 문장 그대로다 — 잘못 붙은 키는 서버가 `도면 배치 항목이 올바르지 않습니다.`, 앱이 `지원하지 않는 배경 속성이 포함되어 있습니다.`(`onlyKeys`. 10.2가 `/속성/`으로 본다)이고, 기호 종류는 서버가 `사물 기호 또는 연결 공간이 올바르지 않습니다.`, 앱이 `사물 기호가 올바르지 않습니다.`다:

```ts
// 공간 가지 — onlyKeys 목록에 'surface' 를 더하고, 세로 값 검사 뒤에:
if ('surface' in n) known(n.surface, BACKGROUND_SPACE_SURFACES, '공간 종류가 올바르지 않습니다.');
// 카메라 가지 — onlyKeys 목록에 'color' 를 더하고, 세로 값 검사 뒤에:
if ('color' in n) known(n.color, BACKGROUND_CAMERA_COLORS, '카메라 색이 올바르지 않습니다.');
// 기호 가지 — :52 의 줄을:
known(n.symbol, BACKGROUND_SYMBOL_KINDS, '사물 기호가 올바르지 않습니다.');
```

`known`은 5.2에서 정의한다(닫힌 목록에 없는 **문자열**이면 "모르는 값", 문자열이 아니면 "잘못된 값").

---

## 4. 세 번째 migration

### 4.1 파일과 구조

파일: `DEVLOG/migrations/2026-10-09-background-map-elements.sql`. 운영 기록 이름: `background_map_elements`. 줄 끝은 LF — **저장소에 든 것(blob)이** LF라는 뜻이다. 이 PC의 git은 `core.autocrlf=true`(시스템 설정)이고 `.gitattributes`가 `* text=auto`라, **새로 체크아웃한 작업 폴더에서는 세 SQL 파일이 모두 CRLF로 놓인다**(지금 이 워크트리의 두 적용 파일이 LF인 것은 여기서 직접 만든 파일이라서다 — `git ls-files --eol`로 확인: 다른 migration은 `i/lf w/crlf`). 그래서 글자를 견주는 테스트는 읽은 뒤 줄 끝을 맞추고(4.4의 D5), 운영에 넣는 글자와 md5의 기준은 작업 폴더가 아니라 blob에서 꺼낸다(4.5).

```sql
-- (머리말: 4.2)
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

CREATE OR REPLACE FUNCTION public.background_library_validate_entity(kind TEXT, v JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
-- 3D 파일 :32 ~ :103 을 글자 그대로 옮기고 아래 표의 다섯 줄만 다르다 (실제 파일에는 이 주석 줄이 없다)
END $$;

-- 3D 파일 :106 ~ :119 의 잠금 블록을 글자 그대로 (주석 한 줄 + DO 블록)
NOTIFY pgrst, 'reload schema';
COMMIT;
```

**검증 함수 본문 = 3D 파일의 본문 + 추가 셋.** 3D 파일의 `CREATE OR REPLACE FUNCTION public.background_library_validate_entity(`(:30)부터 `END $$;`(:104) 앞까지를 그대로 옮긴 뒤, **세 줄을 넓히고 두 줄을 더한다.** 그 밖의 줄은 한 글자도 다르지 않다.

| # | 3D 파일의 줄 | 요소 파일의 줄 |
|---|---|---|
| 넓힘 1 (도로) | :56 `    WHEN 'space' THEN ARRAY['elevation','volumeHeight']` | `    WHEN 'space' THEN ARRAY['elevation','volumeHeight','surface']` |
| 넓힘 2 (색) | :57 `    WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect']` | `    WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect','color']` |
| 넓힘 3 (계단) | :73 `… AND n->>'symbol' IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');` | `… AND n->>'symbol' IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom','stairs'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');` |
| 더함 1 (도로) | :64(공간의 바닥·입체 높이 검사) **바로 다음 줄에** | `    PERFORM public.background_library_require(NOT (n ? 'surface') OR n->>'surface' IN ('road'),'공간 종류가 올바르지 않습니다.');` |
| 더함 2 (색) | :71(카메라의 높이·각도·비율 검사) **바로 다음 줄에** | `    PERFORM public.background_library_require(NOT (n ? 'color') OR n->>'color' IN ('red','lime','green','teal','blue','pink'),'카메라 색이 올바르지 않습니다.');` |

- 변수 이름 `spatial`은 그대로 둔다(이제 세로 값이 아닌 선택 키 둘도 든다). 이름을 바꾸면 여러 줄이 달라져 "3D 본문 + 추가 셋"을 테스트로 고정할 수 없다. 머리말에 한 줄 적는다.
- 값 검사가 문자열만 통과시키는 이유: `n->>'surface'`는 JSON 문자열 `"road"`일 때만 `road`다(숫자·참거짓·배열·객체는 다른 글자가 되고, JSON `null`은 SQL `NULL`이라 조건이 `NULL` → `background_library_require`가 `IS DISTINCT FROM true`로 거절한다, 기본 파일 :35).
- `surface`가 카메라·기호에, `color`가 공간·기호에 붙으면 `n-spatial`에서 빠지지 않아 :59의 키 목록 검사에서 거절된다.
- 함수 본문 안에 주석을 넣지 않는다(본문 줄 비교가 주석까지 견준다).

**멱등**: 파일은 `CREATE OR REPLACE` 하나와 권한 정리뿐이라 몇 번을 돌려도 결과가 같다. 다시 돌릴 때의 가드: 이미 이 파일의 본문이어도 `n-spatial`이 들어 있으므로 통과한다. 표·행·다른 함수를 건드리지 않는다.

**가드가 막는 것**: 기본 파일조차 없는 DB(55000, 아무것도 남기지 않는다)와, 기본 파일만 돌린 DB(검증 함수에 `n-spatial`이 없다 → 55000). 뒤의 것은 기능으로는 필요 없지만(이 파일의 본문이 3D 본문을 포함한다) 적용 기록이 사슬 순서대로 남게 하려는 것이다.

### 4.2 머리말

```sql
-- Background library maps: stairs symbol, road spaces and camera colours.
-- Prerequisites: 2026-09-21-background-library.sql, then 2026-10-07-background-map-3d.sql. Apply this file
-- after both, and before the app version that writes these shapes (v1.133.0): app first means every save
-- that carries one of them fails with 22023.
-- Chain: base -> 3D -> this file. All three replace public.background_library_validate_entity, each with a
-- wider one, so the file that ran last decides what the server accepts.
-- Re-run this file after every run of either of them, not only after the first one. The base file puts back
-- the plan-only validator and the 3D file the validator without the additions below. Stored maps stay
-- readable and nothing is lost, but each write re-checks every map that is still stored, so one stored
-- stair, road or camera colour makes every write that leaves that map stored fail with 22023 (in practice
-- every edit) until this file is applied again. A write that deletes that map, or saves it without those
-- nodes, would pass: do not get round the error that way (a deleted map cannot be brought back), apply
-- the chain again. While no such map is stored yet, only saves that carry one of these shapes fail.
-- After a run of the base file, run the 3D file first: this file refuses to run on the base validator.
--
-- Replaces public.background_library_validate_entity and nothing else. The body is the 3D body with three
-- additions; tests/backgroundDatabaseContract.test.ts fails if they drift apart.
--   symbol: kind 'stairs' joins the closed list
--   space : optional surface, one of ('road'); omitted = a room
--   camera: optional color, one of ('red','lime','green','teal','blue','pink'); omitted = the amber it was
-- `spatial` now also lists these two optional keys; the name is kept so every other line stays the 3D line.
-- The lists mirror BACKGROUND_SYMBOL_KINDS, BACKGROUND_SPACE_SURFACES and BACKGROUND_CAMERA_COLORS in
-- src/features/backgrounds/domain.ts.
-- Both keys are optional. A map saved without them stays valid and is stored without them: the server
-- validates and never fills in or rewrites a value, because lost-reply recovery compares the complete
-- submitted map with the stored one. No stored row is touched by this file.
```

운영에 적용한 뒤 `-- Prerequisites:` 문단의 끝에 한 줄을 더한다(4.5의 '적는 것'): `-- Applied to production on <날짜> as <버전 번호> (background_map_elements), after the 3D file (20261008035155).`

**앞 파일만 다시 돌리면 깨지는 것** (세 파일의 머리말과 AGENTS.md·CLAUDE.md·인수인계 문서가 같은 말을 한다 — 옛 "기본 → 3D 두 파일" 규칙이 적힌 곳은 4.3에서 모두 고친다):

| 다시 돌린 것 | 그때 저장돼 있는 것 | 결과 | 고치는 법 |
|---|---|---|---|
| 기본 파일만 | 세로 값이나 새 모양이 든 도면이 하나라도 있다 | 검증 함수가 평면 전용으로 돌아간다. **그 도면을 남겨 두는 쓰기는 모두 22023**이다 — 쓰기마다 지워지지 않은 모든 행을 다시 보기 때문이고(2.1의 6), 장소 하나를 고치는 것까지 사실상 모든 편집이 막힌다. 읽기는 된다. 잃는 것 없음 | 3D 파일 → 요소 파일 순서로 다시 적용 |
| 3D 파일만(요소 파일 뒤에) | 계단·도로·색이 든 도면이 하나라도 있다 | 검증 함수가 3D 것으로 돌아간다. 그 도면을 남겨 두는 쓰기는 모두 22023. 읽기는 된다 | 요소 파일을 다시 적용 |
| 기본 파일만, 또는 3D 파일만 | 돌아온 좁은 검증 함수가 모르는 값이 든 도면이 **아직 하나도 없다**(요소 파일을 적용한 직후에 3D 파일만 다시 돌린 것이 이 상태다 — 새 모양은 아직 아무도 저장하지 않았다) | **눈에 보이는 것이 없다.** 지금 있는 자료의 편집은 모두 된다. 그 검증 함수가 모르는 모양을 **싣고 가는 저장만** 22023이다 — 그래서 조용히 지나가기 쉽다. 4.5의 (2)(본문 md5·`has_elements`)로만 알아챈다 | 같다(사슬을 끝까지 다시 적용) |
| 요소 파일만 | 무엇이든 | 아무 일도 없다(멱등) | — |

**막힌 쓰기를 도면을 지워서 풀지 않는다.** 좁은 검증 함수 아래에서도 **그 도면을 지우는 쓰기**와 **새 모양의 노드를 빼고 저장하는 쓰기**는 지나간다 — 지우기는 어떤 항목도 검증하지 않고(기본 파일 :233-237), 전체 재검사는 변경을 적용한 뒤에 지워지지 않은 행만 본다(:145, :274). 저장이 거듭 실패할 때 가장 손이 가기 쉬운 대응("깨진" 도면 지우기)이 그대로 성공하고, 지운 도면을 되살리는 명령은 없다. 그러니 22023이 거듭 나오면 도면을 건드리지 말고 사슬을 다시 적용한다. 세 파일의 머리말과 AGENTS.md가 같은 말을 한다(4.3). P4의 ③이 이 동작을 고정한다(4.4).

④의 파일이 생기면 사슬은 `기본 → 3D → 요소 → ④`가 되고, 기본 파일을 다시 돌리면 뒤의 셋을 모두 다시 돌린다(④는 `execute`·`snapshot`을 되돌려 놓는 것이라 검증 함수 사슬과 독립이지만 순서는 하나로 적는다). 그 줄은 ④가 자기 머리말과 이 세 파일의 머리말에 더한다.

### 4.3 다시 실행 규칙이 적힌 곳을 모두 고친다 (두 적용 파일의 머리말, AGENTS.md, CLAUDE.md, 인수인계 문서)

적용된 두 SQL 파일의 본문(`BEGIN;`부터)은 한 글자도 고치지 않는다. 주석 줄만 바꾼다. **이 머리말 수정으로 두 파일의 본문 줄 번호가 밀린다**(기본 파일은 세 줄, 3D 파일은 일곱 줄 아래로): 이 문서에 적은 두 파일의 줄 번호는 모두 고치기 전(a0ca0542)의 것이다 — 구현 중에도 1단계가 머리말을 고친 뒤에는 어긋나고, 머지 뒤에 읽는 4.5에서는 줄 번호 대신 함수 이름으로 가리킨다. 옛 규칙("기본 파일을 다시 실행하면 3D 파일도 다시 실행한다")은 이번 차례부터 **틀린 지시**다 — 그대로 따르면 3D 검증 함수가 남아, 계단·도로·카메라 색이 하나라도 저장된 뒤에는 그 도면을 남겨 두는 쓰기(사실상 모든 편집)가 22023으로 막힌다(4.2의 표). 그 문장이 적힌 곳은 아래가 전부이며(저장소 전체를 `다시 실행`·`재실행`·`다시 적용`·`Re-run`·`re-apply`로 찾았다. 라운드 계획과 3D 구현 계획에 남은 것은 그때의 계획 기록이라 고치지 않는다) **운영 지시로는 하나도 남기지 않는다.** D4가 지킨다(4.4).

**기본 파일 :5-7** — 지금:

```sql
-- Follow-up: 2026-10-07-background-map-3d.sql widens background_library_validate_entity for the
-- vertical-axis map fields. This file restores the narrower validator, so after EVERY run of this
-- file run the 3D file again; until then saves that touch a map carrying those fields are rejected.
```

바꾼 뒤:

```sql
-- Follow-up chain: 2026-10-07-background-map-3d.sql (vertical-axis map fields), then
-- 2026-10-09-background-map-elements.sql (stairs symbol, road spaces, camera colours). Each replaces
-- background_library_validate_entity with a wider one. This file restores the narrowest validator, so
-- after EVERY run of this file run both again, in that order; until then every write that leaves a map
-- with one of their fields stored is rejected with 22023 (in practice every edit). Do not delete or
-- strip such a map to get past the error: apply the chain again.
```

(주의: 기본 파일 전체에서 `jsonb_set(`이 정확히 한 번이어야 한다 — `tests/backgroundDatabaseContract.test.ts:54`. 머리말에 그 글자를 쓰지 않는다.)

**3D 파일** — :6(`-- Re-run this file after every run of 2026-09-21-background-library.sql, not only after the first one.`)은 테스트가 글자로 본다(`tests/backgroundDatabaseContract.test.ts:73-74`). **그 줄은 그대로 두고**, :9(`-- with a vertical field makes every background write fail with 22023 until this file is applied again.`) 다음에 일곱 줄을 더한다(:7-9의 기존 문장은 고치지 않는다 — "every background write"의 정확한 뜻을 더하는 줄이 풀어 적는다):

```sql
-- After this file, run 2026-10-09-background-map-elements.sql again as well: it replaces the same
-- function with a wider one (symbol 'stairs', space.surface, camera.color), and this file puts back
-- the validator without them. Run alone after that file, this one rejects with 22023 every write that
-- leaves a map with a stair, a road or a camera colour stored (in practice every edit).
-- "Every write" above and here means every write that leaves such a map stored: deleting the map, or
-- saving it without those nodes, passes. Do not get past the error that way (a deleted map cannot be
-- brought back): apply the chain again.
```

**AGENTS.md** '배경 라이브러리 데이터 경계':

- :106 "기호 종류·치수·경첩/열림 방향은 공용 domain과 SQL에서 함께 검증한다." → 끝에 덧붙인다: " 닫힌 목록(기호 종류, 공간의 `surface`, 카메라의 `color`)은 `domain.ts`의 `BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS` 한 곳이고 `DEVLOG/migrations/2026-10-09-background-map-elements.sql`의 IN 목록과 같아야 한다(테스트가 견준다)."
- :111의 "…이 SQL은 기본 migration 뒤에 적용하고 기본 migration을 다시 실행하면 이 SQL도 다시 실행한다." → "…적용 순서는 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` → `2026-10-09-background-map-elements.sql`이다. 셋 다 같은 검증 함수(`background_library_validate_entity`)를 더 넓은 것으로 바꿔 넣으므로, **앞의 파일을 다시 실행하면 그 뒤의 파일을 모두 순서대로 다시 실행한다.** 앞 파일만 다시 돌리면 좁은 검증 함수가 돌아와, 저장된 도면에 뒤 파일의 값(세로 값, 계단·도로·카메라 색)이 하나라도 있는 동안 **그 도면을 남겨 두는 쓰기가 모두** 22023으로 막힌다(사실상 모든 편집이다. 읽기는 되고 잃는 것은 없다). 그 도면을 지우거나 그 값을 빼고 저장하는 쓰기는 지나가지만 **그렇게 풀지 않는다**(지운 도면은 되살릴 수 없다) — 사슬을 다시 적용한다. 그런 도면이 아직 없을 때는 눈에 보이는 것이 없고 새 값을 실은 저장만 막힌다. 적용된 파일은 머리말 주석만 고치고 `BEGIN;` 아래는 고치지 않는다."
- :114 "새 설치는 `DEVLOG/migrations/2026-09-21-background-library.sql`이 필요하다." → "새 설치는 위의 세 파일을 그 순서로 적용한다."
- 새 항목(:113 다음)은 12절에 적는다.

**CLAUDE.md :3 과 AGENTS.md :3** (두 파일의 맨 위 안내 줄. 글자가 서로 같다 — 세션마다 가장 먼저 읽는 줄이라 옛 문장이 남으면 그것이 가장 먼저 따라진다). 그 줄의

> 운영 DB에는 2026-10-08에 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` 순서로 적용했다(기본 파일을 다시 실행하면 3D 파일도 다시 실행한다).

를 두 파일 모두 이렇게 바꾼다(PR에서):

> 운영 DB에는 2026-10-08에 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` 순서로 적용했다. 적용 사슬은 기본 → 3D → `2026-10-09-background-map-elements.sql`(v1.133.0)이며, **앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다**(앞 파일만 돌리면 배경 편집이 사실상 모두 막힐 수 있다. 그때 도면을 지워서 풀지 않는다 — AGENTS.md '배경 라이브러리 데이터 경계').

그리고 운영에 적용한 뒤(4.5의 '적는 것') 그 문장의 `(v1.133.0)` 바로 뒤에 ` — 요소 파일은 <날짜>에 <버전 번호>로 적용`을 두 파일에 똑같이 더한다. 줄의 나머지(노출 범위, 링크)는 건드리지 않는다. **이 두 줄의 글자는 테스트로 고정하지 않는다**(D4는 옛 문장이 없다는 것만 본다): ④가 화면을 열면서 이 안내 줄을 다시 쓰기 때문이다(1.3 끝).

**인수인계 문서 `DEVLOG/background-3d-opus-handoff-2026-10-07.md` §13.3 :266** — "…기본 migration을 다시 실행하면 좁은 검증 함수로 돌아가므로 3D SQL도 다시 실행한다(두 파일 머리말에 기록)." 그 문장 **바로 뒤, 같은 줄에** 덧붙인다: " **v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`. 앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다(§17.3).**" (그때의 결정을 적은 문장이라 지우지 않고, 같은 줄에서 바로잡는다.)

**같은 문서 §13 끝의 검토 기록 :297** — "…정책으로 남긴 2건(프리뷰 저장소 키 유지, 기본 migration 재실행 시 3D SQL 재실행)은 13.3에 적었다". 옛 두 파일 규칙을 `재실행`이라는 말로 한 번 더 적은 줄이다(`다시 실행`으로만 찾으면 빠진다). 그 괄호의 `3D SQL 재실행` **바로 뒤, 괄호 안에** 덧붙인다: " — v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`, §13.3·§17.3". 같은 줄의 "프리뷰 저장소 키 유지"는 14.4와 인수인계 17.4가 이번 차례의 값에 대해 다시 적는다.

### 4.4 계약 테스트 (`tests/backgroundDatabaseContract.test.ts`)

맨 위에 `sqlElements = migration('2026-10-09-background-map-elements.sql')`와 `domain.ts`의 세 상수 import, 그리고 `mapSpatial.ts`의 `SYMBOL_VOLUME_HEIGHTS` import(D3가 쓴다 — 그 파일에서 가져오는 지금의 줄 :9에 더한다)를 더한다. `migration()`(:11)은 파일을 **읽은 그대로** 돌려준다 — 새로 체크아웃한 작업 폴더에서는 CRLF다(4.1). 기존 검사들은 `\r?\n`으로 견디게 쓰여 있고(:37) `entityValidator`(:32. 그 위 :31이 주석을 빼는 `code`다)도 `/\r?\n/`으로 줄을 나눈다. 새 검사도 같은 식으로 쓴다: 줄 단위 비교는 `entityValidator`의 줄로, 여러 줄 정규식은 `\r?\n`으로, 글자 전체의 해시(D5)는 줄 끝을 먼저 LF로 맞춘 뒤에.

**정적 테스트 (PGlite 없이 늘 돈다)**

| # | 이름 | 내용 |
|---|---|---|
| D1 | 요소 파일은 검증 함수 하나만 바꿔 넣고, 기본값을 넣지 않고, 잠금을 다시 돈다 | 3D의 :34-58과 같은 꼴. 머리말: `/^-- Prerequisites: 2026-09-21-background-library\.sql, then 2026-10-07-background-map-3d\.sql/m`. 주석을 뺀 본문에 대해: `BEGIN;`·두 `SET LOCAL`·`COMMIT;`, `CREATE OR REPLACE FUNCTION public.\w+`가 검증 함수 **하나뿐**, 가드 둘(`to_regprocedure(…) IS NULL`, `position('n-spatial' IN body)=0`)과 `ERRCODE='55000'` 둘, `RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp`, 값을 만들거나 고쳐 쓰는 글자가 **없다** — 3D 파일의 같은 검사(:53)가 쓰는 정규식을 그대로 쓴다(`jsonb_set`·`jsonb_insert`·`jsonb_build_object`·`jsonb_strip_nulls`·`COALESCE`·이어 붙이기 연산자·`DEFAULT`·`INSERT`·`UPDATE`·`DELETE`·`ALTER`·`DROP`·`CREATE TABLE`, 대소문자 무시), `REVOKE … FROM PUBLIC`·`REVOKE … FROM %I`·`GRANT EXECUTE ON FUNCTION public.background_library_read(text),public.background_library_execute(text,text,jsonb) TO %I`, `NOTIFY pgrst, 'reload schema';` |
| D2 | 요소 파일은 3D 검증 함수의 모든 규칙을 글자 그대로 두고 정확히 셋을 더한다 | `base = entityValidator(sql3d)`, `next = entityValidator(sqlElements)`. `widened` = `base`의 각 줄에 세 치환(4.1의 넓힘 1~3. 찾는 글자는 줄 하나에만 있다: `WHEN 'space' THEN ARRAY['elevation','volumeHeight']` → `WHEN 'space' THEN ARRAY['elevation','volumeHeight','surface']`, `WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect']` → `WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect','color']`, `'plant','custom')` → `'plant','custom','stairs')`). `widened`와 `base`가 다른 줄이 **정확히 3**. `next.filter(line => widened.includes(line))`가 `widened`와 `deepEqual`(순서까지). `next`에만 있는 줄이 **정확히 2**이고, 그 둘이 **상수에서 만든 글자와 정확히 같다**(들여쓰기 네 칸까지. "키가 없으면 통과"라는 꼴 자체를 PGlite 없이 고정한다 — `n ? 'surface' AND …`처럼 잘못 쓰면 기존의 모든 방이 거절되는데, 그것을 잡는 P1은 기본 실행에서 건너뛰기 때문이다): ``const list = (names: readonly string[]) => names.map(name => `'${name}'`).join(',');`` 로 ``    PERFORM public.background_library_require(NOT (n ? 'surface') OR n->>'surface' IN (${list(BACKGROUND_SPACE_SURFACES)}),'공간 종류가 올바르지 않습니다.');`` 와 ``    PERFORM public.background_library_require(NOT (n ? 'color') OR n->>'color' IN (${list(BACKGROUND_CAMERA_COLORS)}),'카메라 색이 올바르지 않습니다.');`` — `deepEqual(added, [그 두 글자])`(순서: 공간 줄, 카메라 줄). 넓힘 3의 줄도 같은 식으로 고정한다: `next`에 ``n->>'symbol' IN (${list(BACKGROUND_SYMBOL_KINDS)}),'사물 기호 또는 연결 공간이 올바르지 않습니다.');`` 로 끝나는 줄이 정확히 하나. 그 두 줄의 자리: `next`에서 각각 `'공간의 바닥 높이 또는 입체 높이가 올바르지 않습니다.'` 줄과 `'카메라 높이, 위아래 각도, 기울기 또는 화면 비율이 올바르지 않습니다.'` 줄의 바로 다음 |
| D3 | SQL의 닫힌 목록은 앱이 검증에 쓰는 상수와 같다 | 주석을 뺀 요소 파일에서 `n->>'symbol' IN \(([^)]*)\)`, `n->>'surface' IN \(([^)]*)\)`, `n->>'color' IN \(([^)]*)\)`를 각각 **한 번씩** 찾아 따옴표 안 이름의 배열로 만들고 `BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS`와 `deepEqual`(순서까지). 색 목록에 `purple`·`amber`가 없다. `Object.keys(SYMBOL_VOLUME_HEIGHTS)`를 정렬한 것이 `BACKGROUND_SYMBOL_KINDS`를 정렬한 것과 같다(타입의 모든 종류가 목록에 있다) |
| D4 | 세 파일의 머리말과 운영 문서가 사슬 전체를 말하고, 옛 두 파일 규칙이 남아 있지 않다 | 요소 파일: `/^-- Chain: base -> 3D -> this file\./m`, `/^-- Re-run this file after every run of either of them/m`, 둘 다 `BEGIN;`보다 앞. 기본 파일: 머리말(`BEGIN;` 앞)에 `2026-10-09-background-map-elements.sql`이 있고 옛 문장의 `run the 3D file again`이 **없다**. 3D 파일: `/^-- After this file, run 2026-10-09-background-map-elements\.sql again as well/m`이 `BEGIN;`보다 앞(그리고 :73-74의 기존 검사 그대로 통과). **문서**(`readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8')`처럼 읽어 `/\r?\n/`으로 줄을 나눈다): `CLAUDE.md`와 `AGENTS.md` 각각 — **부정 검사**: `다시 실행`과 (`3D 파일도` 또는 `이 SQL도`)를 함께 담은 줄이 **없다**(옛 문장 둘 — :3의 "3D 파일도 다시 실행한다", AGENTS.md :111의 "이 SQL도 다시 실행한다"). **긍정 검사는 `AGENTS.md`의 데이터 경계 항목에만 건다**: `background_library_validate_entity`와 `2026-10-09-background-map-elements.sql`과 `그 뒤의 파일을 모두 순서대로 다시 실행한다`를 **한 줄에** 함께 담은 줄이 있다(:111의 항목. 맨 위 안내 줄 :3에는 그 함수 이름이 없어 이 검사에 걸리지 않는다). **`CLAUDE.md`와 두 파일의 :3에는 긍정 검사를 걸지 않는다** — 그 줄은 시험 공개 안내라 ④가 화면을 열 때 다시 쓰고, `npm run build`가 이 테스트를 돌리므로 글자를 고정하면 그 문구 수정이 배포 빌드를 멈춘다(1.3 끝). 인수인계 문서: `3D SQL도 다시 실행한다`를 담은 줄이 정확히 하나이고 그 줄에 `2026-10-09-background-map-elements.sql`이 있다. `3D SQL 재실행`을 담은 줄(:297)마다 그 줄에 `2026-10-09-background-map-elements.sql`이 있다(그런 줄이 하나 이상 있다) |
| D5 | 적용된 두 파일의 본문은 그대로다 | 파일마다: `const text = migration(name).replace(/\r\n/g, '\n'); const at = text.indexOf('\nBEGIN;\n'); assert.ok(at >= 0); const hash = createHash('sha256').update(text.slice(at + 1)).digest('hex');` (`createHash`는 이미 import돼 있다, :5). 기대값: 기본 파일 `9fae1b53f02379bf98af1a25f1cff04576d69d9fc59d7486da49b6cc6c4fd5eb`, 3D 파일 `2e785dc4fe674136d620c0fd236b460572de7f782ca481bd8888e9ce15fc23b3`. **줄 끝을 맞추는 줄과 `at >= 0` 검사를 빼지 않는다** — CRLF 작업 폴더에서는 `'\nBEGIN;\n'`이 없어 `indexOf`가 −1이 되고, 그러면 `slice(0)`이 파일 전체를 해시해 엉뚱한 까닭으로 실패한다(또는, 값이 우연히 맞게 고쳐지면 머리말까지 얼려 버린다). (두 값은 설계 중 LF 글자에서 계산했고 검토에서 다시 계산해 같았다. 머리말 주석은 이 범위 밖이라 4.3의 수정에 영향받지 않는다) |

**PGlite 실행 테스트 (`BFLOW_PGLITE_MODULE`이 있을 때)**

- **큰 실행 테스트(:107-374)**: 적용 줄(:110)을 `sql, sql, sql3d, sql3d, sqlElements, sqlElements`로 — 기존 하위 테스트 전부가 운영과 같은 검증 함수 위에서 돈다(두 번씩 돌려 멱등도 본다). :175의 종류 목록을 `BACKGROUND_SYMBOL_KINDS`로(계단까지 저장·왕복). :181의 `symbol: 'unknown'`은 그대로 거절돼야 한다. 그 안에 하위 테스트 둘을 더한다:
  - **P1 '계단·도로·카메라 색은 보낸 그대로 저장되고 없던 노드에는 아무것도 생기지 않는다'**: 도면 하나에 `{...symbol(), symbol:'stairs'}`, `{...space(), surface:'road'}`, 다각형 도로(`shape:'polygon'`, 점 넷, `surface:'road'`, `elevation: 30`), 색 여섯마다 카메라 하나(`{...camera(), color}`), 세로 값과 색을 함께 가진 카메라(`{...camera(), elevation:150, pitch:-20, color:'teal'}`), 그리고 평범한 `space()`·`camera()`·`symbol()`. 저장 결과가 `{...m, revision:1}`과 `deepEqual`. 평범한 세 노드에 `surface`·`color` 키가 없다(`Object.hasOwn`). 이름만 바꾼 저장(버전 1 → 2) 뒤에도 노드가 그대로. `mapSaveWasApplied(저장된 것, 명령)`이 참이고, 명령에서 색 하나를 다른 색으로 바꾸거나 `surface`를 뺀 것은 거짓. 일반 팀원 토큰으로 읽어도 같은 값.
  - **P2 '모르는 값·잘못된 타입·잘못 붙은 키는 22023으로 거절되고 아무것도 바뀌지 않는다'**: 기존 `refuse`와 같은 꼴(단독 저장과, 유효한 수정과 한 묶음인 저장 둘 다 거절, 전후 `read()` 동일). `surface`: `'river'`·`'room'`·`'Road'`·`''`·`null`·`true`·`1`·`[]`·`{}` → `/공간 종류/`. `color`: `'purple'`·`'amber'`·`'#ff0000'`·`'Red'`·`''`·`null`·`7`·`true`·`[]`·`{}` → `/카메라 색/`. 잘못 붙은 키: 카메라·기호에 `surface:'road'`, 공간·기호에 `color:'red'` → `/도면 배치 항목/`. 기호 `symbol:'elevator'` → `/사물 기호/`.
- **P3 (새 최상위 테스트) '3D 파일까지만으로는 새 모양이 거절되므로 요소 파일은 그 위에만 얹는다'**: 빈 DB에 요소 파일 → 55000(뒤이어 `ROLLBACK`, `background_library_%` 함수 0개). 기본 파일만 적용한 뒤 요소 파일 → 55000(`/3d/`), `ROLLBACK`, 검증 함수 본문에 `n-spatial`이 여전히 없다. 3D 파일 적용 → 평범한 도면과 세로 값 도면은 저장되고, 계단은 `/사물 기호/`, `surface`·`color`는 `/도면 배치 항목/`으로 22023. 요소 파일 적용 → 셋 다 보낸 그대로 저장된다. 그 전에 저장한 행은 읽어서 그대로다.
- **P4 (새 최상위 테스트) '앞 파일을 다시 돌려도 잃는 것이 없고 사슬을 다시 적용하면 고쳐진다'**: 세 파일 적용 뒤 `fresh`(계단 + 도로 + 색 카메라), `tall`(세로 값), `flat`(평범) 도면과 장소 하나를 저장하고 `before = read()`. ① 3D 파일만 다시 → `read()`가 `before`와 같다. 쓰기 넷(새 장소, 새 도면, `flat` 이름 바꾸기, `fresh` 이름 바꾸기)이 모두 22023. 요소 파일 다시 → `read()` 같고 쓰기가 된다. ② 기본 파일만 다시 → `read()` 같고 쓰기가 모두 22023. 여기서 요소 파일을 바로 → 55000(`ROLLBACK`). 3D 파일 → 쓰기는 여전히 22023(계단이 저장돼 있다). 요소 파일 → 쓰기가 되고 `fresh`·`tall`·`flat`이 그대로다. ③ **문서에 적은 "지나가는 쓰기"를 고정한다**(4.2 — 권하는 길이 아니라, 왜 22023 앞에서 도면을 지우면 안 되는지의 근거다): 3D 파일만 다시 → 위의 쓰기 넷이 다시 22023. 그 상태에서 `fresh`를 **지우는** 명령(`{ type: 'delete', kind: 'map', id: fresh.id, expectedRevision }`)은 **오류 없이 통과**하고, 그 뒤에는 새 장소 저장과 `flat` 이름 바꾸기도 통과한다(새 모양이 든 행이 더는 남아 있지 않다). `read()`에 `fresh`가 없고 `tall`·`flat`은 그대로다. 요소 파일을 다시 적용한다. 끝에 `anon`·`authenticated`가 실행할 수 있는 `background_library_%` 함수가 `execute`·`read` 둘뿐.
- 기존 최상위 테스트 둘(:376 '기본 파일만으로는 세로 값이 거절된다', :393 '기본 파일을 다시 돌려도…')은 기본·3D 두 파일의 관계를 보는 것이라 **그대로 둔다**.

### 4.5 운영 적용 절차 (오케스트레이터가 한다 — PR 머지 뒤, 앱 배포 전)

프로젝트 `mpqifkpxalwxgcrddchv`(인수인계 문서 14.3). 지금 적용 기록: `background_library`(20261008035103), `background_map_3d`(20261008035155).

**넣는 글자와 견주는 값은 저장소의 blob에서 꺼낸다 — 작업 폴더의 파일에서 꺼내지 않는다.** 머지 뒤 새로 체크아웃한 폴더의 SQL 파일은 CRLF다(4.1). 그것을 그대로 넣으면 운영의 함수 본문에 `\r`이 들어가 LF로 계산한 md5와 어긋나고, 까닭 없이 "적용 뒤 확인"이 실패한다.

- 글자: `git show <머지 커밋>:DEVLOG/migrations/2026-10-09-background-map-elements.sql`의 출력을 **바이트 그대로** 받는다(늘 LF). Bash 도구(Git Bash)에서 파일로 받거나 Node의 `execFileSync('git', ['show', '<머지 커밋>:<경로>'])`로 받는다. PowerShell의 `>`·파이프로 받지 않는다(줄을 나눴다 다시 이어 CRLF가 된다). 받은 글자에 `\r`이 하나도 없음을 확인한 뒤에 쓴다.
- 함수 본문의 md5: 같은 방법으로 받은 글자에서, 검증 함수의 `AS $$` 바로 뒤부터 그 함수를 닫는 `$$` 바로 앞까지(`prosrc`가 담는 범위)를 md5. 3D 파일의 것(적용 전의 기준)과 요소 파일의 것(적용 뒤의 기준) 둘이다.

**적용 전 — 읽기 전용 확인**

```sql
-- (1) 적용 기록: 위의 두 줄이 있고 background_map_elements 는 없다 (migration 목록 도구)
-- (2) 지금의 검증 함수가 3D 본문인지, 그리고 규칙 7 이 보는 속성(실행 권한 방식, search_path)
SELECT md5(p.prosrc) AS body, position('n-spatial' IN p.prosrc) > 0 AS is_3d, position('stairs' IN p.prosrc) > 0 AS has_elements,
       position(E'\r' IN p.prosrc) > 0 AS has_cr, p.prosecdef, p.proconfig
FROM pg_proc p WHERE p.oid = 'public.background_library_validate_entity(text,jsonb)'::regprocedure;
-- (3) 함수 13개의 본문 md5 (적용 뒤와 견줄 기준)
SELECT p.proname, md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'background_library_%' ORDER BY 1;
-- (4) 실행 권한
SELECT r.rolname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE n.nspname = 'public' AND p.proname LIKE 'background_library_%' AND has_function_privilege(r.rolname, p.oid, 'EXECUTE') ORDER BY 1, 2;
-- (5) 저장된 자료
SELECT kind, count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) AS total FROM public.background_library_entities GROUP BY kind ORDER BY 1;
SELECT count(*) FROM public.background_library_entities e CROSS JOIN LATERAL jsonb_array_elements(e.value->'nodes') n
WHERE e.kind = 'map' AND (n ? 'surface' OR n ? 'color' OR n->>'symbol' = 'stairs');
-- (6) 저장된 행 전부가 지금의 검증을 지나는지. 쓰기마다 도는 바로 그 함수다(기본 파일의
--     background_library_validate. background_library_execute 가 변경을 적용한 뒤에 부른다).
--     RETURNS VOID, SECURITY INVOKER, 읽기만 한다(PERFORM 과 SELECT 뿐). 소유자 권한으로 부른다.
SELECT public.background_library_validate();
-- (7) 두 표의 잠금: RLS, 정책 수, anon·authenticated 의 직접 권한 (적용 뒤와 견줄 기준. PUBLIC 에 준 권한도 여기에 잡힌다)
SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_direct,
       has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_direct
FROM pg_class c WHERE c.oid IN ('public.background_library_entities'::regclass, 'public.background_library_receipts'::regclass) ORDER BY 1;
```

기대:

- (2) `is_3d` 참, `has_elements` 거짓, `prosecdef` 거짓(SECURITY INVOKER), `proconfig`가 `search_path=public, pg_temp` 하나. `body`는 blob의 3D 파일에서 계산한 값이어야 하며 **받아들이는 값은 둘**이다:
  - `956240d88619d7b370d9116acb2a0213`(LF, `has_cr` 거짓) — 기대하는 값.
  - `5ec213a0ecb45a6c9b4b366edb3d3b5c`(같은 글자의 CRLF, `has_cr` 참) — 2026-10-08의 적용이 CRLF 작업 폴더의 글자로 들어갔다는 뜻이다(그때 "md5 일치"만 적고 값은 적어 두지 않아, 어느 쪽이었는지는 이 단계에서 처음 안다). 기능은 같다. **어느 쪽이었는지 적고 계속한다.**
  - **그 밖의 값이면 멈춘다.**
  (두 값 모두 설계 중 저장소의 LF 글자에서 계산했고 검토에서 다시 계산해 같았다.)
- (3) 13줄. (4) 역할마다 `background_library_execute`·`background_library_read` 둘뿐. (5) 둘째 줄 0.
- (6) 오류 없이 한 줄. 22023이면 **지금 이미 배경 편집이 사실상 모두 막혀 있다**는 뜻이다(저장된 행이 지금의 검증 함수에서 떨어진다 — 그 행을 남겨 두는 쓰기는 모두 거절된다, 4.2) — 적용하지 않고 멈춰 어느 행인지부터 찾는다.
- (7) 두 줄(`background_library_entities`, `background_library_receipts`). 둘 다 `relrowsecurity` 참, `policies` 0, `anon_direct`·`authenticated_direct` 거짓(2026-10-08 적용 뒤의 상태 그대로다, 인수인계 14.3).

**하나라도 어긋나면 적용하지 않고 멈춘다**((2)의 CRLF 값만 위에 적은 대로 예외다). 특히 (2)가 3D 본문이 아니면 누군가 앞 파일을 다시 돌린 것이다 — 3D 파일부터 다시 적용할지 한솔과 정한다.

**적용**: migration 도구로 이름 `background_map_elements`, 내용은 위에서 blob으로 받은 요소 파일 전체(LF, `\r` 없음, `BEGIN;`·`COMMIT;` 포함 — 앞의 두 파일과 같은 방식).

**적용 뒤 — 확인**

1. 적용 기록(migration 목록 도구): `background_map_elements`가 `background_map_3d`(20261008035155) **뒤에** 한 줄 생겼다. 그 버전 번호를 적는다.
2. (2)를 다시: `is_3d` 참, `has_elements` 참, `has_cr` 거짓, `prosecdef` 거짓, `proconfig`가 `search_path=public, pg_temp` 하나(적용 전과 같다), `body`가 blob의 요소 파일에서 계산한 검증 함수 본문 md5와 같다(값은 구현 뒤에 정해진다 — 적용하는 사람이 머지 커밋에서 계산해 적용 전에 적어 둔다). 다르면 아래 '적용 뒤 확인이 어긋났을 때'의 첫 항목대로 한다(되돌리지 않고 바른 글자를 다시 실행한다).
3. (3)을 다시: 검증 함수 한 줄만 바뀌고 **나머지 12개는 적용 전과 같다.**
4. (6)을 다시: 오류 없이 한 줄 — 저장된 행 전부가 새 검증 함수를 지난다(넓히기만 했으므로 적용 전에 지났으면 지금도 지난다. 그런데도 22023이면 아래 '적용 뒤 확인이 어긋났을 때'의 둘째 항목을 따른다). 이 확인이 없으면 "쓰기가 막힌 상태"를 배포된 앱의 첫 저장에서야 알게 된다.
5. (4)를 다시: 그대로 둘씩. `PUBLIC`에는 없다(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname LIKE 'background_library_%' AND has_function_privilege('public', p.oid, 'EXECUTE')` → 0줄).
6. (7)을 다시: 두 표 모두 RLS 켜짐, 정책 0, `anon`·`authenticated` 직접 권한 없음 — 적용 전의 (7)과 같다. (5)의 수가 적용 전과 같다(행을 건드리지 않았다).
7. 검증 함수 직접 호출(소유자 권한으로. 이 함수는 `VOID`이고 아무것도 쓰지 않는다):

```sql
SELECT public.background_library_validate_entity('map', $j${"id":"00000000-0000-4000-8000-000000000001","revision":0,"name":"점검","parentId":null,"placeId":null,"imageUrl":"","nodes":[
 {"id":"00000000-0000-4000-8000-000000000011","type":"space","name":"도로","placeId":null,"childMapId":null,"x":0,"y":0,"width":100,"height":40,"rotation":0,"shape":"rect","points":[],"locked":false,"surface":"road"},
 {"id":"00000000-0000-4000-8000-000000000012","type":"camera","name":"카메라","spaceId":null,"x":0,"y":0,"angle":0,"fov":60,"viewIds":[],"locked":false,"color":"teal"},
 {"id":"00000000-0000-4000-8000-000000000013","type":"symbol","name":"계단","symbol":"stairs","spaceId":null,"x":0,"y":0,"width":120,"height":240,"rotation":0,"locked":false,"hinge":"left","swing":"inward"}]}$j$::jsonb);
```

   오류 없이 한 줄. 같은 JSON에서 `"surface":"river"` / `"color":"purple"` / `"symbol":"elevator"`로 하나씩 바꾼 셋은 각각 22023.
8. 잘못된 토큰(익명 역할로, 호출마다 트랜잭션을 따로): `BEGIN; SET LOCAL ROLE anon; SELECT public.background_library_read('invalid'); ROLLBACK;` → 42501. 같은 식으로 `SELECT public.background_library_validate_entity('map','{}'::jsonb)` → 42501(실행 권한 없음), `SELECT * FROM public.background_library_entities` → 42501.
9. 실제 저장(쓰기) 호출은 운영에서 하지 않는다(운영 세션을 만들지 않는다 — 인수인계 14.3과 같은 원칙). 첫 저장은 배포된 앱에서 한솔 계정으로 확인한다.

**적는 것**: 적용 버전 번호와 시각, (2)·(3)의 md5 표(전·후. 적용 전의 본문이 LF 값이었는지 CRLF 값이었는지도), `prosecdef`·`proconfig`, (4)·(5)의 결과, (6)·(7)의 결과(전·후), 7·8번의 결과, 확인한 사람. 자리: 인수인계 문서 17.3, 검증 기록의 이번 절, 요소 파일 머리말의 `Applied to production …` 줄, `CLAUDE.md` :3과 `AGENTS.md` :3의 적용 기록(4.3), ROADMAP의 v1.133.0 절(12절). 이 문서 수정은 주석과 문서뿐이라 따로 커밋한다.

**적용 뒤 확인이 어긋났을 때**

- **검증 함수 본문의 md5가 blob의 값과 다르거나(2번), 7번의 호출 결과가 다를 때 — 가장 있을 법한 경우다.** 요소 파일의 글자는 파일째가 아니라 도구의 글자 인자로 한 번 더 옮겨져 들어가므로 옮기다 어긋날 수 있고, 그것을 잡는 것은 md5뿐이다. **이것은 되돌릴 일이 아니다.** 이 시점에는 새 모양이 아직 저장될 수 없다 — (5)의 둘째 줄이 여전히 0임을 다시 확인한다(배포된 앱은 새 모양을 만들지 못하고, 개발 빌드도 운영에 저장하지 않는다, 1.3 끝). 그 다음 blob에서 다시 받은 요소 파일의 글자를 **SQL을 그대로 실행하는 도구로 한 번 더 실행한다** — migration 도구로 다시 넣지 않는다(같은 이름의 적용 기록이 한 줄 더 생긴다). 파일은 멱등이라(4.1) 다시 실행해도 결과가 같다. 그 뒤 확인 2~8을 처음부터 다시 한다. 다시 실행한 사실과 시각을 '적는 것'에 함께 적는다.
- **바른 글자가 들어갔는데도 어긋날 때**(예: 4번의 (6)이 22023), 또는 바른 글자를 끝내 넣을 수 없을 때에만 되돌린다: 새 모양이 하나도 저장되지 않았음((5)의 둘째 줄 0)을 확인하고, 3D 파일을 blob에서 같은 방법으로 받아 **같은 길(SQL을 그대로 실행하는 도구)로** 실행한다 — 이것도 새 적용 기록을 만들지 않는다. 적용 기록에는 `background_map_elements`가 남으므로, 되돌렸다는 사실을 인수인계 17.3과 요소 파일 머리말에 적는다. 되돌린 뒤 (2)가 3D 본문(`956240d8…`, `has_cr` 거짓)임을 확인한다.
- 새 모양이 하나라도 저장된 뒤에는 되돌리지 않는다(그 도면을 남겨 두는 쓰기가 모두 막힌다, 4.2).

---

## 5. 호환성과 "업데이트가 필요해요"

### 5.1 이전 버전에서 일어나는 일 (받아들이는 범위)

2.2에 적은 대로다: 새 모양이 하나라도 저장되면 v1.130.0~v1.132.0은 **배경 화면 전체를 열지 못하고**(빨간 띠에 `사물 기호가 올바르지 않습니다.` 또는 `지원하지 않는 배경 속성이 포함되어 있습니다.`), 화면을 열어 둔 채였던 이전 버전은 저장이 **서버에는 반영되고 화면에는 실패로** 보일 수 있다. 자료는 잃지 않는다.

이것을 받아들이는 조건은 하나다: **배경 화면이 소유자(배한솔 계정)에게만 보이는 동안.** 소유자가 쓰는 PC를 모두 v1.133.0으로 올린 뒤에 새 모양을 처음 저장한다(5.4). 화면을 다른 계정에 여는 것(④)은 업데이트 안내가 든 버전에서만 한다.

### 5.2 새 읽기 장치 (v1.133.0부터)

**목표**: 읽은 자료가 앱 검증에서 떨어진 까닭이 "이 버전이 모르는 종류·키·값"(= 더 새 버전이 쓴 것으로 보임)이면, 빨간 오류 문장 대신 업데이트 안내를 보여 주고 보기·편집·저장을 막는다. 자료가 깨진 경우(타입이 틀림, 범위 밖, 참조가 끊김)는 지금처럼 오류 문장이다. **검증은 느슨해지지 않는다**: 두 경우 모두 통째로 거절하고, 모르는 값을 지우거나 건너뛰지 않는다(R5).

**(1) 검증 함수가 종류를 가른다 — `domain.ts`**

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

- `onlyKeys`(:18): 목록에 없는 키가 있으면 같은 문장으로 `BackgroundUnsupportedError`를 던진다(지금은 `requireValue` → `Error`).
- **`detail`**: 무엇을 몰랐는지(키 이름들, 또는 그 값)를 오류에 실어 둔다. **문장(`message`)은 한 글자도 바뀌지 않는다** — 서버 문장·기존 테스트의 정규식과 그대로 맞고, 화면의 안내에도 나오지 않는다. 쓰는 곳은 저장소의 콘솔 기록 하나다((2)). 길이를 자른다(값 80자, 키 여덟 개). 클래스 필드 선언(`readonly detail: string;`)은 지울 수 있는 TypeScript다(매개변수 속성을 쓰지 않는다, R11).
- 닫힌 문자열 목록을 보는 줄을 `known`으로 바꾼다. 문장은 그대로다:

| 줄 | 목록 | 문장(그대로) |
|---|---|---|
| :44 | `shape`: `rect`·`ellipse`·`polygon` | `공간 모양이 올바르지 않습니다.` |
| :52 | `symbol`: `BACKGROUND_SYMBOL_KINDS` | `사물 기호가 올바르지 않습니다.` |
| :54 | `hinge`: `left`·`right` / `swing`: `inward`·`outward` | `문의 경첩 방향이 올바르지 않습니다.` / `문 열림 방향이 올바르지 않습니다.` |
| :60 | `shot`: `wide`·`medium`·`closeup`·`detail` | `구도 분류를 확인해 주세요.` |
| :63 | `time`: `day`·`night`·`other` | `시간대 분류를 확인해 주세요.` |
| 새 줄 | `surface`, `color` | 3.4 |

- 노드의 `type`: 지금은 공통 검사(식별자·이름·좌표·잠금, :37-38) **뒤**의 마지막 가지에서 본다(:51 `requireValue(n.type==='symbol', '지원하지 않는 도면 오브젝트입니다.')`). 나중의 새 노드 종류는 좌표가 없을 수도 있으므로 **`object(n)` 바로 다음, 다른 검사보다 앞에서** `known(n.type, ['space','camera','symbol'], '지원하지 않는 도면 오브젝트입니다.')`를 부르고, :51의 그 `requireValue`는 뺀다(마지막 가지는 이제 늘 기호다).
- 요청의 `c.kind`·`c.type`(:87-88)은 **그대로 `requireValue`**다(저장된 자료가 아니라 이 앱이 만드는 요청이다).
- 최상위에 모르는 모음이 더 있는 것(예: 나중의 `notes`)은 지금처럼 **지나간다**(`validateBackgroundSnapshot`은 아는 다섯만 읽는다, :96).
- 여러 문제가 섞여 있으면 먼저 만난 것 하나가 던져진다(지금과 같다). 모르는 값과 깨진 값이 함께 있으면 순서에 따라 어느 쪽이든 될 수 있다 — 어느 쪽이든 화면은 열리지 않는다.
- `validateBackgroundRequest`·`applyBackgroundCommand`도 같은 도우미를 쓰므로 모르는 키가 든 요청은 `BackgroundUnsupportedError`로 거절된다. 문장이 같아서 기존 테스트(문장 정규식)는 그대로 통과한다.
- **이 장치가 "더 새 자료"로 알아보는 것은 두 가지뿐이다: 모르는 키, 그리고 닫힌 목록 밖의 문자열.** 숫자 범위(`number`·`spatial`), 값의 타입, 개수 한계(`array`)는 그대로 `requireValue` → `Error`다. 그러니 나중 차례가 저장 모양을 **다른 식으로** 넓히면(기존 키의 숫자 범위를 넓힘, 값의 타입을 바꿈, 배열 한계를 늘림) v1.133.0에는 업데이트 안내가 아니라 빨간 오류로 보이고, 화면에 남은 본문이 편집되는 예전 동작(2.2)이 그대로 난다. 뒤 차례가 지킬 규칙으로 적는다(12절의 AGENTS 항목, 인수인계 17.4): **저장 모양은 새 선택 키나 닫힌 목록의 새 문자열로만 넓힌다.**

**(2) 저장소 — `useBackgroundStore.ts`**

```ts
export interface BackgroundState {
  snapshot: BackgroundSnapshot; actorId: string | null; loading: boolean; pending: boolean; error: string | null;
  /** The stored library holds a kind, key or value this version does not know: nothing is shown and nothing is saved until the app is updated. */
  updateRequired: boolean;
  …
}
```

- `initialize`: `updateRequired: false`로 시작한다.
- `refresh`: 성공하면 `updateRequired: false`도 함께 적는다. `catch`에서 (낡은 응답이 아니면) `error instanceof BackgroundUnsupportedError`일 때 `{ loading: false, updateRequired: true, error: null }`, 아니면 지금처럼 `{ loading: false, error: message(error) }`. `snapshot`은 어느 쪽이든 건드리지 않는다.
- `execute`: 로그인 검사 다음 줄에 `if (get().updateRequired) throw new Error('앱을 업데이트한 뒤 다시 저장해 주세요.');` — 게이트웨이를 부르지 않는다. 그리고 실패 복구(:42-50)에서, 응답 검증이 던진 것이나 복구 조회가 던진 것이 `BackgroundUnsupportedError`면 `{ snapshot: restored, pending: false, updateRequired: true, error: null }`로 적고 원래 오류를 다시 던진다(지금은 `error: message(error)`). `mapSaveWasApplied`로 완료를 알아보는 줄(:47-49)은 그 앞에 그대로 있다.
- **까닭을 버리지 않는다 — 안내가 켜질 때 한 번만**: 위의 두 길(`refresh`의 `catch`, `execute`의 실패 복구) 모두 `updateRequired`가 **거짓에서 참으로 바뀌는 그때에만** `console.warn('[background] update required:', error.message, error.detail);`를 부른다 — `set` 바로 앞에서 `if (!get().updateRequired) console.warn(…);`(`error`는 그 `BackgroundUnsupportedError` — `execute`에서는 응답 검증이 던진 것, 그것이 아니면 복구 조회가 던진 것). 안내가 떠 있는 동안에도 화면은 15초마다·창에 포커스가 올 때마다·변경 신호마다 `refresh`를 부르고(BackgroundLibraryView.tsx:59-70, useBackgroundStore.ts:24) 그때마다 같은 까닭으로 실패하므로, 실패한 읽기마다 적으면 업데이트하지 않은 PC의 콘솔에 같은 줄이 끝없이 쌓인다. 읽기가 한 번 성공해 안내가 꺼진 뒤 다시 켜지면 그때 한 번 더 적는다(까닭이 달라졌을 수 있다). `execute`의 길은 안내가 꺼져 있을 때만 닿으므로(켜져 있으면 맨 앞에서 던진다) 늘 한 번 적는다. 화면의 `error`는 `null`로 두므로(안내에 개발자 글자를 섞지 않는다) 이 기록이 없으면, **이미 최신 버전인 PC**에서 안내가 뜰 때(미리보기 저장소를 손으로 고쳤거나, SQL로 직접 넣었거나, 앞서 나간 개발 빌드가 쓴 자료) 무엇이 걸렸는지 볼 길이 없다. 편집기의 3D 실패 기록(`console.warn('[background-map] 3D view unavailable:', …)`, BackgroundMapEditor.tsx:434)과 같은 방식이다. 새 상태 칸은 만들지 않는다.
- 앱 검증이 던지는 곳은 렌더러 안이라 `instanceof`가 그대로 통한다(IPC를 건너는 것은 검증 전의 자료다).

**(3) 화면 — `BackgroundLibraryView.tsx`**

- 저장소에서 `updateRequired`를 함께 읽는다(:31).
- 머리줄의 상태 글자(:92-98): `pending` → `loading` 다음에 `updateRequired ? '업데이트 필요'`.
- `updateRequired`면 **탭 줄(:112-125)·오류 띠(:126-130)·본문(:131-175)을 그리지 않고** 그 자리에 안내 하나를 그린다. 편집기가 화면에 없으므로 볼 수도 고칠 수도 없다(저장은 (2)가 한 번 더 막는다):

```tsx
<div className="bg-empty" role="alert">
  <RefreshCw size={28} strokeWidth={1.4} aria-hidden="true" />
  <h3>업데이트가 필요해요</h3>
  <p>이 PC의 B flow보다 새 버전에서 만든 도면 자료가 저장돼 있어서, 지금 버전으로는 배경 화면을 열 수 없어요. 화면 왼쪽 아래의 버전 버튼을 눌러 업데이트한 뒤 다시 열어 주세요. 저장된 자료는 그대로 안전하고, 업데이트하기 전까지 이 PC에서는 보거나 고칠 수 없어요.</p>
  <button type="button" className="bg-button bg-primary" disabled={loading || refreshing} onClick={() => void refresh()}>다시 확인</button>
</div>
```

  `.bg-empty`(backgrounds.css:250-271)와 이미 import된 `RefreshCw`를 쓴다. 새 CSS가 없다. 머리줄의 새로고침 버튼도 같은 일을 한다.
- **다시 시도하는 길**: 업데이트는 앱을 다시 시작하므로 화면이 처음부터 다시 읽는다. '다시 확인'·새로고침 버튼·15초 주기·창 포커스·변경 신호는 모두 `refresh`를 부르고, 성공하면 `updateRequired`가 꺼져 본문이 돌아온다.
- 안내가 뜨는 순간 편집기가 화면에서 내려가므로 **그 세션의 저장하지 않은 편집은 사라진다**(초안은 편집기 안의 상태다, useBackgroundMapDocument.ts:35). 업데이트하면 어차피 앱이 다시 시작된다. 알고 넘어가고 완료 보고에 적는다(14.3).

### 5.3 메인 프로세스·서버·미리보기

- **메인 프로세스**: 새로 하는 일이 없다. 읽기는 모양만 보고 넘기고(electron/backgroundStore.ts:11-18), 쓰기 요청은 같은 `domain.ts`로 본다. `electron/**`의 소스는 고치지 않는다(빌드에 새 `domain.ts`가 묶인다).
- **서버**: 새로 하는 일이 없다. 서버는 앱 버전을 모른다.
- **미리보기**: `previewGateway.ts`는 읽을 때(:36)와 쓸 때 같은 `domain.ts`로 검증하고, 미리보기의 `backgroundRead`는 그 오류를 그대로 던진다(src/mocks/devElectronAPI.ts:3738-3741). 같은 모듈의 같은 클래스라 `instanceof`가 통하므로 **고칠 것 없이** 같은 안내가 뜬다. 브라우저 저장소(`bflow-background-library-preview-v1`)에 모르는 종류를 넣어 보는 것이 수동 검증의 길이다(11절 U1).
  - **그 저장소 키는 같은 주소(origin)에서 도는 모든 빌드가 함께 쓴다**(previewGateway.ts:10. 키는 일부러 그대로 둔다 — 3D 때의 정책과 같다, 인수인계 §13.3 :267). 이번 차례의 검증이 거기에 계단·도로·카메라 색을 저장하거나(V1·V2) 모르는 종류를 심으면(U1·U2·U4), 같은 주소에서 v1.132.0 이하의 코드를 미리보기로 띄운 다른 세션·워크트리는 라이브러리 전체를 거절한다(빨간 띠 — 2.2의 이전 버전 동작이 미리보기에서 그대로 난다). 이 저장소에서는 세션이 여럿 함께 도는 일이 흔하다. 그래서 수동 검증은 **전용 주소(다른 포트)나 전용 저장소**에서 하고, 그럴 수 없으면 끝난 뒤 키를 되돌리거나 지우고 그 사실을 검증 기록에 적는다(11절 머리말, 14.4).

### 5.4 배포 순서

1. PR을 머지한다(코드, 요소 파일, 문서). 머지 직전에 `origin/main`의 버전을 다시 본다. **머지 확인을 받을 때 여섯 색의 화면을 함께 보인다**: C8(11절)을 마친 뒤 여섯 색 카메라가 방·도로·기호 옆에 놓인 평면과 3D의 화면(어두운·밝은)과 속성 칸의 동그라미 줄을 한솔에게 보이고, 색을 바꾸자는 답이면 이 단계에서 고친다 — 아직 운영 DB에 들어가기 전이므로 이름까지 맞춰 고칠 수 있다(I6). 이 확인 없이 2로 넘어가지 않는다: 2에서 색 이름 여섯이 운영의 검증 함수에 들어간다.
2. **운영 DB**: 4.5의 적용 전 확인 → 요소 파일 적용 → 적용 뒤 확인. 이 시점에 이전 버전 앱은 아무 영향이 없다(넓히기만 했다). **여기서부터 6까지는 운영에 새 모양을 저장하지 않는다**(개발 빌드로도, 검증하면서도 — 1.3 끝).
3. 적용 기록을 문서에 적는다(4.5의 '적는 것').
4. **앱**: `npm run build` → G드라이브 배포(파일 먼저, `manifest.json` 마지막 — 기존 원칙). 머지와 배포는 한솔 확인 뒤에 한다(기존 관례).
5. **한솔이 배경 화면을 쓰는 PC를 모두 v1.133.0으로 올린다**(각 PC의 왼쪽 아래 버전 글자로 확인).
6. 그 뒤에 계단·도로·카메라 색을 처음 저장한다. 설치된 앱에서 저장 → 새로 고침 뒤 그대로인지 본다(배포 뒤 실기 확인).
7. ④를 시작하기 전에: 화면을 여는 대상 PC가 v1.133.0 이상인지 확인한다.

순서가 뒤집히면: 앱이 먼저 나가고 DB가 아직이면 새 모양이 든 저장은 서버가 22023으로 거절한다(화면은 저장 전으로 돌아가고 서버 문장이 보인다). 자료는 잃지 않는다. DB를 적용하면 풀린다.

### 5.5 테스트

- `tests/backgroundDomain.test.ts`: `validateBackgroundSnapshot`에 — 모르는 기호 종류(`'elevator'`), 모르는 노드 종류(`type: 'note'`, 좌표 없이도), 노드·도면·장소·배경의 변형에 붙은 모르는 키, 모르는 `shape`·`surface`·`color`·`shot`·`time` → **`BackgroundUnsupportedError`**(`assert.throws(fn, BackgroundUnsupportedError)`)이고 문장이 기존 정규식에 맞는다. 타입이 틀린 값(`symbol: 42`, `color: 7`, `surface: true`, `shape: null`, `type` 없음), 범위 밖 숫자, `NaN` 좌표, 끊긴 참조 → `Error`이되 `BackgroundUnsupportedError`가 **아니다**. 최상위에 `notes: []`를 더한 자료는 통과한다. **`detail`**: 모르는 기호 종류 `'elevator'` → `error.detail`이 `'value "elevator"'`, 노드의 모르는 키 `future` → `'keys "future"'`. 두 경우 모두 `error.message`에는 `elevator`·`future`가 **없다**(문장은 그대로다). 300자짜리 모르는 값 → `detail`의 길이가 100 미만.
- `tests/backgroundStore.test.ts`: ① 첫 읽기에 모르는 기호 종류 → `updateRequired` 참, `error` `null`, `snapshot`은 빈 것, `execute`는 `/업데이트/`로 거절되고 게이트웨이의 `execute`가 불리지 않는다. **까닭이 남는다**: `t.mock.method(console, 'warn', () => {})`로 받아, `console.warn`이 정확히 한 번 불리고 인자가 `['[background] update required:', '사물 기호가 올바르지 않습니다.', 'value "elevator"']`다(③의 깨진 응답에서는 불리지 않는다. ④에서도 한 번 불린다). **안내가 떠 있는 동안에는 다시 적지 않는다**: 같은 응답으로 `refresh()`를 두 번 더 불러도(15초 주기·포커스·변경 신호가 하는 일이다) 둘 다 거짓이고 `updateRequired`는 참인 채이며 `console.warn`의 호출 수는 **1 그대로**다. ② 정상으로 읽은 뒤 모르는 키가 든 응답 → `refresh()`가 거짓, `updateRequired` 참, `snapshot`은 마지막으로 확인한 것 그대로, `console.warn` 한 번. 같은 응답으로 한 번 더 `refresh()` → 호출 수 그대로. 이어서 정상 응답 → `refresh()` 참, `updateRequired` 거짓. **꺼졌다가 다시 켜지면 한 번 더 적는다**: 그 뒤 모르는 키가 든 응답을 다시 주면 `console.warn`의 호출 수가 2가 된다. ③ 기존 :95-102(값이 깨진 응답)에 `updateRequired`가 거짓임을 더한다. ④ `execute`의 응답과 복구 조회가 모두 모르는 종류를 담고 있을 때 → 거절, `updateRequired` 참, `pending` 거짓, `snapshot`은 저장 전 것.
- `tests/backgroundPreview.test.ts`: 저장소에 모르는 기호 종류가 든 자료를 직접 넣고 `read()` → `BackgroundUnsupportedError`. 깨진 값(`x: 'a'`)이면 그 클래스가 아닌 `Error`.
- 화면(안내 문구·탭이 사라짐)은 앵커 46(10.9)과 수동 검증 U1~U3이 본다.

---

## 6. 계단 (F2)

### 6.1 목록과 대체값 — `symbolCatalog.ts`

바뀌는 것은 두 줄뿐이다: 목록에 계단 한 줄을 더하고, 대체값을 찾는 식을 바꾼다. **`symbolCatalog`의 타입 표기(:3-8)는 그대로 둔다** — 빼면 `id`가 `string`으로 추론돼 `getSymbolPreset(…).id`가 `BackgroundSymbolKind`가 아니게 되고, 그 좁은 타입에 기대는 곳(BackgroundMapEditor.tsx:485 `symbol: getSymbolPreset(selected.symbol).id`, :507 `symbol: preset.id`, :982 `setSymbolKind(item.id)`)에서 typecheck가 깨진다.

```ts
export const symbolCatalog: ReadonlyArray<{
  id: BackgroundSymbolKind;
  label: string;
  width: number;
  height: number;
}> = [
  { id: "door", label: "문", width: 100, height: 100 },
  { id: "chair", label: "의자", width: 60, height: 60 },
  { id: "table", label: "테이블", width: 180, height: 110 },
  { id: "bed", label: "침대", width: 130, height: 210 },
  { id: "stairs", label: "계단", width: 120, height: 240 },      // new
  { id: "custom", label: "기타 사물", width: 100, height: 80 },
];
/** Removed presets remain readable in saved maps, but use the generic object everywhere. */
export function getSymbolPreset(symbol: BackgroundSymbolKind) {
  return symbolCatalog.find(item => item.id === symbol) ?? symbolCatalog.find(item => item.id === "custom")!;   // was: symbolCatalog[symbolCatalog.length - 1]
}
```

- **자리**: `custom` 앞(목록의 다섯째). 기호 목록은 3칸 격자라(backgrounds-map.css:185) 여섯 개가 두 줄로 찬다.
- **대체값**: 자리(마지막 항목)가 아니라 이름(`custom`)으로 찾는다. 옛 종류 넷(`desk`·`sofa`·`cabinet`·`plant`)과 모르는 문자열은 '기타 사물'이다 — 계단이 되지 않는다(테스트 10.4).
- 기본 크기 120×240(가로×세로. 위쪽이 올라가는 쪽). 기본 입체 높이 **180**: `SYMBOL_VOLUME_HEIGHTS`에 `stairs: 180`(방의 기본 높이 `MAP_SPATIAL_DEFAULTS.spaceVolumeHeight`와 같다 — 한 층을 오르는 계단).

### 6.2 평면 기호 — `BackgroundSymbolGlyph.tsx`

다른 기호와 같은 100×100 상자에 그린다(위 = y 0). 올라가는 쪽은 **상자의 위쪽**이다(침대의 머리맡과 같은 쪽 — 3D의 −Z, map3dScene.ts:510-515). 가지 하나를 더한다:

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

- **디딤판**: 가로줄 다섯(여섯 칸). **화살표**: 아래의 점(오르기 시작하는 곳)에서 위로 가는 선과 화살촉.
- **선의 굵기는 다른 기호와 같은 방식이다 — 그림 단위.** 상자와 화살표는 바깥 `<g>`의 `strokeWidth` 3.2를 그대로 물려받고(의자·테이블·침대의 선과 같은 굵기, :23), 디딤판만 2에 불투명도 0.65로 한 걸음 물러나 화살표가 그 위에서 읽히게 한다. `vector-effect`는 쓰지 않는다. 그래서 계단은 다른 기호와 **함께** 굵어지고 가늘어진다: 아이콘에서는 다른 다섯 개와 같은 무게이고(16px에서 선 0.44px, 디딤판 0.28px), 평면에서는 확대하면 의자·침대와 같이 굵어진다. 검토 전의 설계는 계단에만 화면 굵기가 고정된 선(1·1.6·1.8px, `non-scaling-stroke`)을 주었는데, 그러면 아이콘에서는 계단만 이웃보다 두세 배 굵고 평면에서는 확대율에 따라 이웃과의 굵기 관계가 뒤집힌다(400%에서 의자의 선은 7px쯤인데 계단은 1.6px) — 택하지 않았다.
- **가로·세로를 다르게 늘였을 때**: 그림은 다른 기호처럼 상자에 맞춰 늘어난다(디딤판 간격과 화살표 길이가 따라 늘어난다. 디딤판 수는 늘 다섯 줄이다). 선의 굵기도 함께 늘어나므로 기본 크기 120×240에서는 가로줄(디딤판·상자의 위아래 변)이 세로줄의 두 배 굵기다 — 침대(130×210)의 가로줄이 그런 것과 같고, 받아들인다. 멀리 축소하면 다른 기호의 선처럼 흐려진다. 시작점의 동그라미와 화살촉도 상자와 함께 늘어난다(문의 경첩 점과 같다).
- `<pattern>`·`foreignObject`를 쓰지 않는다(앵커 8·11의 뜻).
- 같은 그림이 도구줄 아이콘·기호 목록·오브젝트 목록·속성 칸의 미리보기(`SymbolIcon`, :70-82)에 쓰인다. 16~28px 아이콘에서 줄무늬와 화살표로 읽히는지, 다른 다섯 아이콘과 무게가 어울리는지 앱 엔진에서 본다(11절 E1·E2, 대체안 14.2).

### 6.3 3D — `map3dScene.ts`의 `buildSymbol`

`kind === 'bed'` 가지 다음, 마지막 `else`(점선 상자) 앞에 가지 하나:

```ts
} else if (kind === 'stairs') {
  // Solid steps from the floor up, the lowest at the plan bottom (+Z) and the highest at the plan top (-Z), where the plan arrow points.
  const steps = Math.min(16, Math.max(3, Math.round(tall / 18)));
  for (let index = 0; index < steps; index++) part('stairs-step', -0.5, 0.5, 0, (index + 1) / steps, 0.5 - (index + 1) / steps, 0.5 - index / steps);
}
```

- **단 수**: `입체 높이 / 18`을 반올림해 3~16으로(기본 180 → 10단). 높이가 유한하지 않으면 이 함수는 그 전에 돌아간다(:477).
- **모양**: 단마다 바닥에서 그 단의 높이까지 꽉 찬 상자(가로 전체). 아래에서 `i`번째 단은 깊이 `1/steps`, 높이 `(i+1)/steps`. **평면의 위쪽(−Z)으로 올라간다** — 평면 화살표와 같은 쪽이다. 돌리면(`rotation`) 함께 돈다.
- **자원**: 기존 `part` 도우미가 공용 단위 상자(`this.geometry('box')`)와 공용 재질(`symbol`·`symbolOn`)로 메시만 만든다. 새 geometry·재질이 없어 **정리할 것이 늘지 않는다**(자원 수·해제 테스트 `tests/backgroundMap3dScene.test.ts:793-848` 그대로).
- **누름**: 단마다 `part`가 `'solid'`로 표시해 `entry.picks`에 넣는다(실체를 누르면 잡힌다). 상자 전체를 덮는 보이지 않는 대리 상자(`symbol-proxy`, :532-537)도 그대로라 계단 위쪽의 빈 곳을 눌러도 잡히되 실체보다 앞서지는 않는다. 문만 대리 상자를 바닥으로 줄인다 — 계단은 줄이지 않는다.
- **선택 표시**: `selected && kind !== 'custom'`의 점선 윤곽(:524-529)이 계단에도 붙는다. 이름표는 다른 기호처럼 선택됐을 때만(`labelSpec`, :101).
- `shapeKey`(:91)에 종류·크기·높이가 이미 들어 있어 높이를 바꾸면 단 수가 다시 계산된다.

### 6.4 편집기와 그 밖

- **기호 목록**(:978-985): 항목이 `symbolCatalog`에서 나오므로 '계단'이 자동으로 생긴다. 제목 `문과 사물` → `문·계단·사물`, 버튼의 `title` `문과 사물 기호` → `문·계단·사물 기호`.
- **놓기**: 기존 `placeSymbol`(:501-510) 그대로 — 이름 '계단', 크기 120×240, `hinge: 'left'`, `swing: 'inward'`, 놓은 자리의 맨 위 공간에 속하고 그 바닥 높이에 선다. 3D의 바닥 클릭으로도 놓인다.
- **속성 칸**: 미리보기 그림과 '계단' 이름(:1106), '90° 회전'·'기호 복제'·'소속 공간'(:1109-1111), '높이·기울기'(바닥 높이·입체 높이·앞뒤/좌우 기울기, :1117-1121), '위치·크기·잠금'. **경첩·열림 방향 버튼은 나오지 않는다** — 그 줄은 이미 `selected.symbol === 'door'`일 때만이다(:1108). 고칠 것이 없다.
- **이름표**: 평면에서는 선택됐을 때만(:1017 — `custom`만 늘 보인다). 종류 이름(`kindLabel`, :162)은 목록에서 '계단'.
- **스냅·상자·더미·복제**: 다른 기호와 같다(코드 변경 없음). 상자는 기호의 넓이로 잡고(`planRectTouches`), 같은 자리의 기호·카메라와 한 더미를 이룬다.
- **보조 평면도**: 모든 기호를 윤곽 상자로만 그린다(BackgroundMapPlanPreview.tsx:43-52). 계단도 상자다(기호 그림이 없다 — 지금의 문·의자와 같다).
- 아래 줄 힌트: 기호 도구일 때 `계단 놓을 곳을 클릭 · Esc 취소`(:937의 기존 식이 만든다).

---

## 7. 도로 (F3)

### 7.1 판별과 읽는 함수 — `mapSpatial.ts`

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

`surface`를 읽는 코드는 `isRoadSpace` 하나를 지난다(편집기·3D·보조 평면도·쌓임 순서·소속). `mapSpatial.ts`는 `mapGeometry.ts`와 `mapStack.ts`가 모두 import하는 가장 아래 모듈이라 순환이 없다.

### 7.2 그리기 도구

- `Tool`(:35)에 `'road'`를 더한다. `isDrawTool`(:79)에도 더한다 — 3D로 넘어가면 선택 도구로 돌아간다(:426).
- 도구줄(:934, 편집 중·평면): 사각형·타원·다각형 다음에 `{ id: 'road', label: '도로', title: '도로: 끌어서 곧은 길 그리기 · 꺾이는 길은 그린 뒤 다각형으로 바꿔 점을 다듬어요', icon: '═' }`. 커서는 다른 그리기 도구와 같다(backgrounds-map.css:46에 `.bmap-canvas.tool-road` 추가).
- **그리는 모양은 사각형 하나다.** 끌면 `shape: 'rect'`, `surface: 'road'`, 이름 `새 도로`인 공간이 그려진다. 기존 `draw` 제스처를 그대로 쓴다(한 번의 끌기 = 되돌리기 한 단계, 그리기는 스냅하지 않는다). 그린 뒤 도구가 '선택'으로 돌아가고 이름 칸이 열린다(:781 그대로).

```ts
function newSpace(shape: BackgroundSpace['shape'], origin: BackgroundPoint, road = false): BackgroundSpace {
  return { id: uuid(), type: 'space', name: road ? '새 도로' : '새 공간', placeId: null, childMapId: null, x: origin.x, y: origin.y, width: 10, height: 10, rotation: 0, shape, points: [], locked: false,
    ...(road ? { surface: 'road' as const } : {}) };
}
// pointerDown — 그리기 도구의 판정 (:692)
const drawing = canEdit && (isDrawTool(tool) || tool === 'symbol');
// pointerDown — 그리기 세션 (:721)
if (canEdit && (tool === 'rect' || tool === 'ellipse' || tool === 'road')) { mode = 'draw'; target = newSpace(tool === 'road' ? 'rect' : tool, point, tool === 'road'); }
```

- **꺾이는 길**(승인 문구 그대로 "다각형으로 그린 뒤 점을 다듬어"): ① 도로 도구로 곧은 길을 그린다 → 속성 칸의 '다각형으로 바꾸기'(:1085-1086, `rectToPolygon`이 `surface`를 그대로 싣는다) → 긴 두 변 가운데의 `+`를 하나씩 끌어 **마주 보는** 점 둘을 더하고 옮긴다(가운데 점선은 양쪽 옆줄의 점이 마주 볼 때 그려진다 — 한쪽에만 더한 동안에는 사라지고 속성 칸이 까닭을 알려 준다, 7.3·7.4). 또는 ② 다각형 도구로 모양을 그린 뒤 속성 칸에서 도로로 바꾼다(7.3). 다각형 도구 자체는 그대로 방을 만든다.
- 스페이스·휠 버튼의 화면 이동, Esc(도구를 '선택'으로), 다각형 도구의 점 찍기는 그대로다. `pointerDown`의 `mode = ` 대입은 여전히 셋이다(앵커 26).

### 7.3 방 ↔ 도로 바꾸기 (속성 칸)

모양 줄(:1083-1089) 다음, 카메라 가지(:1090) 앞에 — **편집 중이면 평면·3D 모두**, 공간일 때:

```tsx
{editing && selected.type === 'space' && <>
  <Field label="공간 종류"><select value={isRoadSpace(selected) ? 'road' : 'room'} disabled={fieldLocked || gestureActive}
    onChange={event => changeSpaceSurface(event.target.value === 'road' ? 'road' : null)}><option value="room">방</option><option value="road">도로</option></select></Field>
  <p className="bmap-hint">{isRoadSpace(selected) ? ROAD_HINT : '도로로 바꾸면 벽 없는 회색 바닥이 되고, 다른 공간 아래에 깔려요.'}</p>
  {/* The centre line is the look of a road: where the shape has none, say why, or it reads as a bug. */}
  {isRoadSpace(selected) && !roadCentreLine(selected) && <p className="bmap-hint">{selected.shape === 'ellipse' ? ROAD_HINT_ROUND : ROAD_HINT_NO_STRIP}</p>}
</>}
```

```ts
// BackgroundMapEditor.tsx, beside the other module constants
// The last sentence is how to get hold of a road that another space covers: it cannot be pressed there directly.
const ROAD_HINT = '도로는 벽 없는 바닥이에요. 다른 공간과 겹치면 늘 아래에 깔려요. 다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.';
const ROAD_HINT_ROUND = '둥근 도로에는 가운데 점선이 없어요.';
const ROAD_HINT_NO_STRIP = '가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요. 한쪽에 점을 더했으면 맞은편에도 하나 더해 주세요. 광장처럼 길 모양이 아닌 곳에는 그리지 않아요.';
```

```ts
function changeSpaceSurface(surface: BackgroundSpaceSurface | null) {
  if (!current || selected?.type !== 'space' || !canEdit) return;
  const next = setSpaceSurface(selected, surface);
  if (next !== selected) updateMap(replaceMapNode(current, next));     // one update, one undo step; the members stay where they are
}
```

- 모양(사각형·타원·다각형)과 무관하게 모든 공간에 나온다. 잠긴 공간은 바꿀 수 없다(칸이 꺼진다).
- **도로의 안내는 덮인 도로를 잡는 법까지 말한다**(`ROAD_HINT`의 셋째 문장). 도로는 늘 다른 공간 아래이므로 큰 방 안에 그린 도로는 몸통을 바로 누를 수 없고(7.7, I5), 그 도로를 방금 그렸거나 목록에서 골랐을 때 눈앞에 있는 글이 이 안내다 — "늘 아래에 깔려요"만으로는 어떻게 잡는지 알 수 없다. 도로가 실제로 덮여 있는지는 따지지 않고 도로면 늘 같은 세 문장을 보인다(덮였는지를 계산해 문장을 바꾸는 상태를 두지 않는다). 평면과 3D에서 같은 문장이다 — 3D에서도 덮인 자리는 천천히 한 번 더 눌러 내려간다(7.6).
- 바꾸는 것은 `surface` 키 하나다. 이름·장소 연결·상세 도면·소속 카메라와 기호·`volumeHeight`는 그대로다. `transformMapSpace`를 거치지 않는다(자리가 바뀌지 않으므로 소속 항목을 옮길 일이 없다).
- 되돌리기 한 번으로 돌아온다.
- **모양 줄의 안내**(:1083-1089, 평면에서만 나오는 묶음. 묶음의 조건과 버튼은 그대로다):

  | 고른 공간 | 안내 |
  |---|---|
  | 사각형 방 | 지금 그대로 `꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.` (:1087) |
  | 사각형 도로 | `꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.` |
  | 다각형(방·도로 모두) | 지금 그대로 `점을 끌어 모양을 고쳐요. 변 가운데의 +를 끌면 점이 생기고, 점을 고른 뒤 Delete를 누르면 지워져요.` (:1088) — 도로에서 점선이 사라진 동안에도 이 줄은 남는다(그때가 이 안내가 가장 필요한 때다) |
  | 타원 | 지금처럼 이 묶음에는 아무것도 없다 |

- **가운데 점선이 없는 도로의 안내**(위 코드의 셋째 줄 — '공간 종류' 칸 아래, 편집 중이면 평면·3D 모두): 고른 공간이 도로인데 `roadCentreLine`이 `null`이면 까닭을 한 줄로 말한다. 타원이면 `둥근 도로에는 가운데 점선이 없어요.`, 그 밖(다각형)이면 `가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요. 한쪽에 점을 더했으면 맞은편에도 하나 더해 주세요. 광장처럼 길 모양이 아닌 곳에는 그리지 않아요.` 점선이 있는 도로와 방에는 이 줄이 없다. 승인 문구의 "가운데 점선이 있는 길"과 "다각형으로 그린 뒤 점을 다듬어"가 만나는 자리다 — 점을 하나 더하는 순간 점선이 사라지므로(7.4), 화면에 까닭이 없으면 고장으로 읽힌다. 점의 짝이 맞아 점선이 돌아오면 이 줄도 사라진다(도면의 점선과 같은 `selected`에서 같은 함수로 계산한다 — 따로 든 상태가 없다).
- 머리 글자(:1072): 도로면 `선택한 도로`. `kindLabel`(:162): 공간 가지를 `node.type === 'space' ? (isRoadSpace(node) ? '도로' : '공간')`으로 — 오브젝트 목록의 종류 글자와 접근성 이름(`이름, 도로`), 이름 칸의 접근성 이름(`도로 이름`, :1061)이 따라온다. 오브젝트 목록의 아이콘(:171): 도로면 모양과 무관하게 `═`.

### 7.4 평면 그리기와 가운데 점선

공간을 그리는 줄(:1000-1007)에서:

```tsx
{stackedSpaces(current).map(node => {
  const isSelected = shownIds.has(node.id), road = isRoadSpace(node), centre = roadCentreLine(node);
  return <g key={node.id} className={`bmap-space ${road ? 'is-road ' : ''}${isSelected ? 'is-selected' : ''} ${node.locked ? 'is-locked' : ''}${node.id === renamingNode?.id ? ' is-renaming' : ''}`} … aria-label={`${node.name}${road ? ', 도로' : ''}${node.childMapId ? ', 상세 도면 연결' : ''}`} …>
    {node.shape === 'ellipse' ? <ellipse … /> : node.shape === 'polygon' ? <polygon … /> : <rect width={node.width} height={node.height} rx={road ? 0 : 4} />}
    {centre && <polyline className="bmap-road-line" fill="none" points={centre.map(point => `${point.x + node.width / 2},${point.y + node.height / 2}`).join(' ')} />}
    <text …>…</text>
    …
  </g>;
})}
```

- **회색 바닥**: `.is-road`의 채움과 선(9.4의 CSS). 사각형 도로는 모서리가 각지다(`rx` 0). 선택되면 다른 공간처럼 보라 테두리가 굵어지고 채움이 조금 진해진다. 잠기면 테두리가 점선이다(기존 규칙 그대로).
- **가운데 점선**은 `<g>` 안에(공간과 함께 돈다), 모양 요소 다음·이름 앞에, 누름을 받지 않게 그린다. `polyline`이라 공간의 채움 규칙(`.bmap-space>rect, >ellipse, >polygon`)에 걸리지 않는다. 화면에서 늘 같은 굵기·같은 점선 길이다(`vector-effect: non-scaling-stroke`). **`fill="none"`을 속성으로도 단다**(CSS 규칙에도 있다, 9.4): 꺾인 `polyline`의 SVG 기본 채움은 검정이라, 스타일 규칙이 빠지거나 클래스 이름이 어긋나면 꺾인 길 안쪽에 검은 쐐기가 칠해진다 — 속성이 있으면 그때도 선만 사라질 뿐이다(스타일시트의 규칙이 속성보다 앞서므로 평소 모습은 같다).
- **이름이 점선에 그어지지 않게 한다.** 공간의 이름은 상자 한가운데에 그려지고(:1004 `x={node.width / 2} y={node.height / 2}`, `dominantBaseline="central"`) 곧은 도로의 가운데 점선도 바로 그 점을 지난다. 공간 이름에는 카메라·기호 이름과 달리 글자 뒤 테두리가 없고(backgrounds-map.css:52. 카메라 :71과 기호 :198에는 `paint-order:stroke`가 있다), 점선 색(`--bmap-road-mark` `227 230 236`)은 글자 색(`232 232 238`)과 거의 같다 — 그대로 두면 **모든 곧은 도로의 이름이 자기 점선에 줄 그어져 보인다**(처음 그린 '새 도로'부터). 도로의 이름에만 카메라·기호 이름과 같은 바탕색 테두리를 준다(9.4의 `.bmap-space.is-road text`). 이름이 점선 뒤에 그려지고(`<polyline>` 다음에 `<text>`) 그 테두리가 글자 둘레의 점선을 가린다. '상세 도면 ↗' 작은 글자도 같은 규칙에 든다(세로 도로에서는 그 글자도 점선 위다). 방의 이름은 바뀌지 않는다. 앱 엔진에서 본다(11절 E3·R1, 14.2).
- **그 테두리의 굵기는 글자와 함께 화면 크기를 지킨다**: `stroke-width:calc(4px * var(--bmap-label-scale,1))`. 이름의 글자 크기는 `calc(15px * var(--bmap-label-scale,1))`이라 확대·축소와 무관하게 화면에서 같은 크기이고(backgrounds-map.css:52, 편집기 :267-268·:988이 그 변수를 SVG에 준다), 가운데 점선은 `non-scaling-stroke`라 화면에서 늘 1.5px이다. 테두리만 도면 단위의 고정값 4로 두면(카메라·기호 이름의 기존 규칙 :71·:198이 그렇다) 축소할수록 테두리가 가늘어져 **바로 E3가 요구하는 축소 구간에서 점선이 다시 이름을 긋는다** — 폭 900px 캔버스에서 25%면 전체 굵기 약 0.9px, 10%면 약 0.36px이고, 가로 3000짜리 도면의 '맞춤'이 이미 33% 근처다. 400%에서는 반대로 14px쯤으로 부푼다. 변수를 곱하면 테두리가 글자와 같은 비율로 움직인다: 글자가 화면에서 15px인 구간에서는 늘 약 4px(글자 가장자리 밖으로 2px씩)이고, 크게 확대해 글자가 커지는 구간(`MAP_LABEL_SCALE_LIMITS`의 아래 끝, mapDocument.ts:59)에서는 글자와 함께 커진다. 카메라·기호 이름의 기존 테두리는 이번에 고치지 않는다(그 이름들은 점선 위에 놓이지 않는다. 승인 범위 밖이다).

**`roadCentreLine`이 정하는 것** (좌표는 상자 가운데가 원점인, 돌리기 전의 틀 — `spaceOutline`과 같다):

| 모양 | 가운데 점선 |
|---|---|
| 도로가 아님 / 가로나 세로가 유한한 양수가 아님 | 없음(`null`) |
| 사각형(`rect`), 그리고 점이 셋 미만이라 상자로 그려지는 다각형 | **긴 쪽을 따라 끝에서 끝까지**: `width >= height`면 `[(-w/2, 0), (w/2, 0)]`, 아니면 `[(0, -h/2), (0, h/2)]`. 정사각형은 가로 |
| 돌린 사각형 | 같은 선이 공간과 함께 돈다(평면은 `<g>`의 회전, 그 밖은 `roadCentrePlanLine`) |
| 타원(`ellipse`) | **없음** — 광장·로터리는 회색 바닥만 |
| 다각형, 점이 홀수 개 | **없음** |
| 다각형, 점이 짝수 개(`n = 2k`) | **띠 규칙**(바로 아래)이 고른 선, 고르지 못하면 **없음** |

**띠 규칙.** 띠 = 두 옆줄의 점이 같은 수로 서로 마주 보는 길이다. 시작 번호 `s = 0, 1, … k−1`을 **차례로** 본다. `A_i = P[(s+i) % n]`, `B_i = P[(s−1−i+2n) % n]` (`i = 0 … k−1`, `P`는 `spaceOutline`의 점) — 두 옆줄의 점을 한쪽 끝에서부터 하나씩 짝지은 것이다. **가로대** `i`는 선분 `A_i–B_i`(맨 처음과 맨 끝 가로대는 다각형의 변, 곧 길의 두 끝이고 그 사이는 길을 가로지르는 선이다). **가운데 점** `M_i = (A_i + B_i) / 2`, 선은 `[M_0, … M_{k−1}]`. 그 시작 번호는 아래 넷을 **모두** 지나야 쓸 수 있다:

| | 조건 | 걸러 내는 것 |
|---|---|---|
| (가) | **칸마다 볼록하다**: `i = 0 … k−2`마다 사각형 `A_i, A_{i+1}, B_{i+1}, B_i`(잇닿은 두 가로대와 그 사이의 두 옆줄 구간)의 네 모서리에서 꺾이는 방향 — 잇닿은 두 변의 외적 부호 — 이 넷 다 같고 0이 아니다 | 스스로 엇갈린 모양(나비넥타이), 가로대끼리 엇갈리거나 포개지는 짝(십자) |
| (나) | **안쪽 가로대가 길을 가로지른다**: `i = 1 … k−2`마다 가로대 `R = B_i − A_i`와 그 자리의 길 방향 `T = M_{i+1} − M_{i−1}`이 이루는 각이 60° 이상 — `\|R·T\| ≤ 0.5·\|R\|·\|T\|`이고 두 길이가 모두 0보다 크다. **양 끝 가로대는 보지 않는다**(길의 끝은 비스듬히 잘려 있어도 된다. 네 점 다각형에는 안쪽 가로대가 없다) | 한쪽 옆줄에만 점이 더 많은 길, 마주 보는 두 점이 크게 어긋난 길, 끝이 뾰족한 길 |
| (다) | **선이 폭보다 길다**: 선의 길이 `Σ\|M_{i+1} − M_i\|`가 가장 긴 가로대의 길이 이상이고 0보다 크다 | 길을 가로지르는 쪽으로 짝지은 것, 길이보다 폭이 넓은 덩어리 |
| (라) | **선이 도로 안에 있다**: 모든 구간의 가운데 점이 그 다각형 안(짝-홀 판정 — `containsPoint`의 다각형 가지(mapGeometry.ts:249-254)와 같은 식을 이 틀의 점들에 쓴다. `mapSpatial.ts`는 `mapGeometry.ts`를 import하지 않으므로 그 몇 줄을 이 함수 곁에 둔다) | 뒤엉킨 다각형에서 밖으로 나가는 선 |

**쓸 수 있는 시작 번호 가운데 가장 작은 것**의 선이 결과다. 하나도 없으면 `null`.

- **왜 넷인가** — 처음 설계는 (라) 하나였고, 검토에서 그 규칙을 글자 그대로 돌려 보니 틀린 선이 나왔다: 300×100 사각형의 **한쪽 옆줄에만** 점 둘을 더하면 `(0,50) → (200,50) → (250,0)`(길 가장자리로 빠진다), 바깥 모서리만 둥글린 ㄱ자(바깥 다섯·안쪽 셋)는 다리 중간에서 바깥 가장자리로 끝나는 선, 나비넥타이에도 선. 점의 수가 짝수인 것만으로는 "마주 본다"가 되지 않는다 — (가)(나)(다)가 그것을 본다.
- **각을 재는 기준이 `M_{i+1} − M_{i−1}`인 까닭**: 직각으로 꺾인 ㄱ자의 모서리 가로대는 꺾이기 전·후의 어느 구간과도 45°다. 앞뒤 가운데 점을 이은 방향과는 90°다. 구간 하나와 재면 바른 ㄱ자가 떨어진다.
- **띠 규칙의 뜻**: 사각형을 '다각형으로 바꾸기'로 바꾼 네 점은 사각형과 **같은 선**이 나온다(긴 쪽 — (다)가 짧은 쪽 짝을 떨어뜨린다. 정사각형은 둘 다 쓸 수 있고 번호가 작은 가로 쪽이다). 긴 두 변에 점을 **마주 보게** 하나씩 더해 꺾으면 그 꺾임을 따라간다. 길 모양에서는 쓸 수 있는 시작 번호가 하나뿐이라 "가장 작은 것"은 정사각형 같은 덩어리에서만 뜻이 있다.
- **점선이 사라지는 때** (그때 속성 칸에 7.3의 안내가 뜬다): 한쪽에만 점을 하나 더한 동안(홀수), 한쪽에 둘을 더한 동안(짝수지만 마주 보는 짝이 없다 — 맞은편에도 둘을 더하면 돌아온다), 마주 보는 두 점을 길 방향으로 크게 어긋나게 끈 동안(가로대가 60°보다 누웠다).
- **설계 중 계산한 값**(임시 스크립트로 위 규칙을 글자 그대로 돌렸다. 점은 `(가로 비율, 세로 비율)`, 결과는 상자 가운데가 원점인 틀):

  | 모양 | 결과 |
  |---|---|
  | 300×100 사각형 / 100×300 사각형 | `[(-150,0),(150,0)]` / `[(0,-150),(0,150)]` |
  | 300×100 네 점 `(0,0)(1,0)(1,1)(0,1)` (점 순서를 뒤집어도) | `[(-150,0),(150,0)]` |
  | 100×300 네 점 `(0,0)(1,0)(1,1)(0,1)` | `[(0,-150),(0,150)]` — 시작 번호 0은 (다)에서 떨어지고 1이 쓰인다 |
  | 200×200 네 점 `(0,0)(1,0)(1,1)(0,1)` | `[(-100,0),(100,0)]` — 둘 다 쓸 수 있고 작은 번호 |
  | 200×200 ㄱ자 `(0,0)(1,0)(1,1)(0.6,1)(0.6,0.4)(0,0.4)` | `[(-100,-60),(60,-60),(60,100)]`. 시작 점을 하나 밀어 `(1,0)(1,1)(0.6,1)(0.6,0.4)(0,0.4)(0,0)`으로 적으면 같은 선이 거꾸로 `[(60,100),(60,-60),(-100,-60)]` |
  | 300×100 여섯 점 띠 `(0,0)(0.5,0)(1,0)(1,1)(0.5,1)(0,1)` | `[(-150,0),(0,0),(150,0)]`. 시작 점을 하나 밀어 `(0.5,0)(1,0)(1,1)(0.5,1)(0,1)(0,0)`으로 적으면 `[(150,0),(0,0),(-150,0)]` |
  | 400×200 두 번 꺾인 길 `(0,0)(0.5,0)(0.5,0.6)(1,0.6)(1,1)(0.3,1)(0.3,0.4)(0,0.4)` | `[(-200,-60),(-40,-60),(-40,60),(200,60)]` (안쪽 가로대의 각 82°·72°) |
  | 300×200 ∧ 모양(두 끝이 세로로 잘림) `(0,0.5)(0.5,0)(1,0.5)(1,1)(0.5,0.5)(0,1)` | `[(-150,50),(0,-50),(150,50)]` — 끝 가로대는 길 방향과 56°지만 보지 않는다 |
  | 200×100 비스듬한 길(평행사변형) `(0,0)(0.5,0)(1,1)(0.5,1)` | `[(-50,-50),(50,50)]` |
  | 400×100 조금 어긋난 짝 `(0,0)(0.25,0)(1,0)(1,1)(0.35,1)(0,1)` | `[(-200,0),(-80,0),(200,0)]` (68°) |
  | 400×100 크게 어긋난 짝 `(0,0)(0.25,0)(1,0)(1,1)(0.45,1)(0,1)` (51°) · 같은 꼴에서 아래 점만 `(0.75,1)` (27°) | `null` — (나)만이 거른다 |
  | 400×100 한쪽 옆줄에만 두 점 `(0,0)(0.25,0)(0.75,0)(1,0)(1,1)(0,1)` | `null` |
  | 200×200 바깥 모서리만 둥글린 ㄱ자 `(0,0)(0.75,0)(0.925,0.075)(1,0.25)(1,1)(0.75,1)(0.75,0.2)(0,0.2)` | `null` |
  | 400×100 끝이 뾰족한 길 `(0,0.5)(0.25,0)(0.75,0)(1,0.5)(0.75,1)(0.25,1)` | `null` |
  | 300×100 나비넥타이 `(0,0)(1,1)(1,0)(0,1)` | `null` — (가)만이 거른다 |
  | 300×300 십자 `(0.3,0)(0.7,0)(0.7,0.3)(1,0.3)(1,0.7)(0.7,0.7)(0.7,1)(0.3,1)(0.3,0.7)(0,0.7)(0,0.3)(0.3,0.3)` | `null` — (가)만이 거른다 |
  | 300×250 T자 `(0,0)(1,0)(1,0.32)(0.6,0.32)(0.6,1)(0.4,1)(0.4,0.32)(0,0.32)` | `null` |
  | 300×100 두 끝 변에 점을 더한 것 `(0,0)(1,0)(1,0.5)(1,1)(0,1)(0,0.5)` · 200×160 육각형 `(0.25,0)(0.75,0)(1,0.5)(0.75,1)(0.25,1)(0,0.5)` | `null` — (다)만이 거른다 |
  | 300×300 뒤엉킨 여덟 점 `(0.8,0.7)(0.2,0.7)(0,0.3)(0.7,0)(0.3,0.6)(0.6,0.6)(0,0.2)(0.7,0.2)` | `null` — (라)만이 거른다 |
  | 삼각형 · 한쪽에 하나만 더한 다섯 점 `(0,0)(0.5,0)(1,0)(1,1)(0,1)` · 200×200 오목 사각형 `(0,0)(0.5,0.4)(1,0)(0.5,1)` · 타원 · 방 | `null` |

- **넓적한 다각형**: 길이가 폭 이상이고 두 옆줄이 마주 보면 띠로 읽힌다 — 정사각형 도로에 가로 선이 그려지는 것과 같은 이치로, 세로가 가로만큼 긴 육각형 `200×200`(위와 같은 여섯 점)에는 `[(0,-100),(0,0),(0,100)]`이 그려진다. 광장을 점선 없이 두려면 타원으로 그린다. 알고 넘어가고 완료 보고에 적는다(14.3).
- T자·십자·갈림길은 한 다각형으로는 띠가 아니다(점선 없음). 도로 둘을 겹쳐 그리면 각자의 점선이 나온다(시험 도면의 교차로가 그렇다).

`roadCentrePlanLine(space)`: 위의 점들을 `space.rotation`만큼 돌려 공간 가운데(`x + width/2`, `y + height/2`)에 더한 것.

### 7.5 보조 평면도

- `PlanShape`(BackgroundMapPlanPreview.tsx:43-52): 도로면 클래스에 `is-road`를 더하고, `<polygon>` 다음에 `roadCentrePlanLine(node)`가 있으면 `<polyline className="bmap-plan-road-line" fill="none" points={…} />`(소수 둘째 자리까지 — 이 파일의 `pointList`. `fill="none"` 속성은 7.4와 같은 까닭이다). 회색 채움과 점선은 9.4의 CSS.
- 이름과 종류: `mapPlanPreview.ts`에 `planKindLabel(node)`를 더한다 — 도로면 `'도로'`, 아니면 `PLAN_KIND_LABELS[node.type]`(그 표는 그대로다, `tests/backgroundMapPlanPreview.test.ts:331` 불변). `planNodeLabel`·`planCameraReadout`·`planVolumeReadout`이 이것을 쓴다. 선택한 것을 읽어 주는 칸의 접근성 이름(:231)도 도로면 `선택한 도로`.
- 읽어 주는 값(`planVolumeReadout`): 도로는 **바닥 높이 한 줄만**(입체 높이 줄이 없다). 접힌 머리줄의 한 줄(`planNodeSummary`)도 `이름 · 바닥 높이 N`.
- 옆에서 본 그림(`planSideView`, :234-255): 도로는 **바닥 높이만** 범위에 넣는다(위쪽 = 바닥). 도로는 "공간이 하나도 없을 때의 기본 눈금"(:246) 판정에서 공간으로 세지 않는다 — 도로만 있는 도면에서도 카메라를 올리면 그림의 카메라가 올라간다. 카메라가 도로에 속해 있어도 **방 상자(`room`)는 `null`**이다(도로에는 높이가 없다).
- 누름·넘기기: `stackedSpaces` 순서로 그리므로 도로가 방 아래다. 고칠 것이 없다.

### 7.6 3D — `map3dScene.ts`의 `buildSpace`

```ts
private buildSpace(entry: Entry, node: BackgroundSpace, selected: boolean): void {
  const outline = …, count = outline.length;
  const road = isRoadSpace(node), height = spaceWallHeight(node);                     // 0 for a road
  entry.lift = (Number.isFinite(height) ? height : 0) + 4;
  if (count < 3 || !Number.isFinite(height)) return;
  const floor = new Mesh(…같은 ShapeGeometry…, this.material(road ? (selected ? 'roadFloorOn' : 'roadFloor') : (selected ? 'spaceFloorOn' : 'spaceFloor')));
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
  …지금의 벽·테두리 그대로…
}
```

- **벽 없는 납작한 바닥**: 바닥 채움 하나, 바닥 높이의 테두리 선, 가운데 점선. `space-walls`가 없다. 지붕도 없다.
- **재질**(새 이름 다섯, 기존 `material()`의 `switch`에): `roadFloor` `flat(palette.road, 0.28)`, `roadFloorOn` `flat(palette.road, 0.44)`, `roadLine` `line(palette.road, 0.75)`, `roadLineLocked` `dash(palette.road, 0.75, 12, 7)`, `roadCentre` `dash(palette.roadMark, 0.9, 14, 10)`. 선택된 도로의 테두리는 방과 같은 `spaceLineOn`·`spaceDashOn`(보라, 불투명도 1)을 쓴다. 모두 공용 재질 저장소에 들어가 테마가 바뀌면 함께 버려지고 `dispose`에서 한 번 해제된다. geometry 셋(바닥·테두리·점선)은 그 노드의 `entry.own`에 든다.
- **팔레트**: `Map3DPalette`에 `road`·`roadMark`(숫자) 둘을 더한다. `MAP3D_DARK_PALETTE`: `road: 0x9aa1ad`, `roadMark: 0xe3e6ec`. `readPalette`(BackgroundMap3D.tsx:34-49)는 다른 테마 색처럼 CSS 변수에서 읽는다: `road: hex('--bmap-road', base.road), roadMark: hex('--bmap-road-mark', base.roadMark)` — 밝은 화면 값이 CSS 한 곳에만 있다(9.4). `sameMap3DPalette`는 모든 키를 견주므로 고칠 것이 없다.
- **그리는 순서**(깜빡임 방지): 바닥 채움의 `renderOrder` — 기본 바닥 −3, 밑그림 −2, **도로 −1.5**, 방 −1. 모두 깊이를 쓰지 않는 반투명 재질이라(`depthWrite: false`) 같은 높이에 겹쳐도 깊이 다툼이 없고, 도로와 방은 `renderOrder`로 순서가 고정된다(보는 각도에 따라 뒤바뀌지 않는다). 도로끼리는 같은 재질·같은 색이라 순서가 바뀌어도 결과가 같다. 선(테두리·점선)은 기존 공간의 선처럼 기본 순서(0)라 바닥들 뒤에 그려진다.
- **이름표**: 바닥에서 4 위(`entry.lift`). 글자는 방과 같다(이름, 상세 도면이 있으면 `상세 도면 ↗`).
- **범위**: `mapWorldBounds`(:692-701)에서 공간의 위쪽을 `base + spaceWallHeight(node)`로 — 도로는 바닥만 범위에 든다(맞춤·위에서 보기·둘러보기 거리).
- **모양이 바뀌는 때**: `shapeKey`의 공간 줄(:93) 끝에 `|${isRoadSpace(node) ? 'road' : ''}`를 더한다 — 방 ↔ 도로를 바꾸면 다시 만든다.
- **누름 대상**: 도로의 누름 대상은 바닥 하나다(`pickPart: 'floor'`).
- **누름 — 도로는 자기 위에 선 방에 진다** (승인 문구: "건물과 **겹치면** 항상 건물 아래에 깔려서 건물을 누르는 데 방해되지 않는다" — I4). 쌓임 순서만으로는 3D에서 두 경우가 남는다(2.4): ① 도로 위에 선 건물의 **벽**을 눌렀는데 광선이 건물을 지나 건물 밖의 도로 바닥에 닿는 때 — `pickMapNode`는 바닥이 하나라도 있으면 벽을 버리므로 도로가 잡히고, 더블클릭도 도로의 것이 된다. ② 바닥 높이가 다른 때 — 눈에 가까운 바닥이 먼저라 건물 위로 올린 도로(고가)가 아래 건물보다 먼저 잡힌다. 둘 다 막되, **승인 문구의 조건 그대로 그 도로와 평면에서 겹친 방에 대해서만** 막는다. 건물과 겹치지 않고 옆을 지나는 도로에는 아무것도 더하지 않는다 — v1.132.0의 규칙 그대로 벽 너머의 바닥이 먼저이므로, 길가 건물의 벽 뒤로 보이는 길은 처음 누를 때 바로 잡히고 더블클릭은 그 길의 것이다(이전 결정 "상세 도면이 연결된 공간의 더블클릭은 그 도면으로"가 도로에서도 한 번에 선다). `pickMapNode`(map3dScene.ts:617-630)의 맨 앞에 한 걸음을 더하고, 그 걸음으로 가려지는 도로에 닿는 길을 `mapSpacePile`로 함께 만든다(아래).

  **"겹친다"의 판정 — `spacesOverlap`** (`mapStack.ts`에 더한다. 쌓임 순서와 같은 모듈이고 three.js·DOM이 없다 — 앵커 32. `isRoadSpace`와 함께 `nodePlanOutline`을 `mapSpatial.ts`에서 가져온다):

```ts
/** Slack of the overlap test, in plan units: outlines that only share an edge or a corner, or miss each other by rounding, do not overlap. */
const OVERLAP_SLACK = 1e-6;
/**
 * Whether two spaces share ground on the plan: an area, not only an edge or a corner. Read from the outlines the 3D
 * floors and the companion plan are drawn with (an ellipse as its 48-gon; the plan itself draws the true ellipse);
 * where an outline crosses itself, inside is counted the way containsPoint counts it.
 */
export function spacesOverlap(a: BackgroundSpace, b: BackgroundSpace): boolean {
  const first = nodePlanOutline(a), second = nodePlanOutline(b);
  if (first.length < 3 || second.length < 3 || ![...first, ...second].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const sides = (outline: BackgroundPoint[]) => outline.map((from, index) => [from, outline[(index + 1) % outline.length]] as const);
  const sidesA = sides(first), sidesB = sides(second), all = [...sidesA, ...sidesB];
  // Between two neighbouring xs of this list no outline turns and no two sides cross, of one outline or of both: one vertical line tells the whole strip.
  const xs = [...first, ...second].map(point => point.x);
  // Every pair of sides, two of one outline as well: an outline may cross itself. Neighbouring sides only add their shared corner again.
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [p, q] = all[i], [r, s] = all[j];
    const cross = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (cross === 0) continue;     // parallel sides add nothing: their ends are in the list
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / cross, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / cross;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) xs.push(p.x + t * (q.x - p.x));
  }
  xs.sort((left, right) => left - right);
  // Where the vertical line at x crosses an outline, lowest first: inside from the 1st crossing to the 2nd, from the 3rd to the 4th, and on.
  const cuts = (list: ReturnType<typeof sides>, x: number) =>
    list.filter(([p, q]) => (p.x > x) !== (q.x > x)).map(([p, q]) => p.y + (x - p.x) * (q.y - p.y) / (q.x - p.x)).sort((low, high) => low - high);
  for (let index = 1; index < xs.length; index++) {
    if (xs[index] - xs[index - 1] <= OVERLAP_SLACK) continue;
    const x = (xs[index] + xs[index - 1]) / 2, ya = cuts(sidesA, x), yb = cuts(sidesB, x);
    for (let m = 0; m + 1 < ya.length; m += 2) for (let n = 0; n + 1 < yb.length; n += 2)
      if (Math.min(ya[m + 1], yb[n + 1]) - Math.max(ya[m], yb[n]) > OVERLAP_SLACK) return true;
  }
  return false;
}
```

  - **뜻**: 두 공간의 평면 윤곽(`nodePlanOutline` — 3D 바닥과 보조 평면도가 그리는 바로 그 다각형이다. 타원은 48각형이고, 평면 자체는 참 타원을 그린다 — 14.4의 0.2%)이 **넓이를 나눠 가지면** 참이다. 한쪽이 다른 쪽 안에 통째로 든 것(스스로 엇갈린 윤곽이어도 — 안은 `containsPoint`처럼 홀짝으로 센다), 윤곽이 같은 것, 모서리 없이 가로지르는 것(십자), 조금이라도 걸친 것(0.01만큼이라도)은 참이다. **변이나 모서리만 맞닿은 것**(옮기기의 스냅으로 길에 붙인 건물)과 반올림 오차만큼 파고든 것은 거짓이다 — `OVERLAP_SLACK`(1e-6 도면 단위)보다 얇은 겹침은 세지 않는다(좌표가 100000까지 가도 계산 오차는 그보다 훨씬 작고, 손으로 걸친 겹침은 그보다 훨씬 크다). 윤곽에 유한하지 않은 값이 있으면 거짓. 두 인자의 순서는 결과와 무관하다.
  - **방법(세로 띠)**: 두 윤곽의 모든 꼭짓점과, 변끼리 만나는 점의 x를 모아 정렬한다. 변끼리 만나는 점은 **모든 변의 짝**에서 모은다 — 두 윤곽의 변끼리뿐 아니라 **한 윤곽의 변끼리**도(스스로 엇갈린 윤곽. 이웃한 두 변은 함께 쓰는 꼭짓점의 x를 한 번 더 넣을 뿐이다). 이웃한 두 x 사이의 띠 안에서는 어느 윤곽도 꺾이지 않고, 둘이 서로 가로지르지도, 어느 하나가 스스로 엇갈리지도 않으므로, 띠 한가운데의 세로선 하나가 그 띠 전체를 말한다. (검토 전의 블록은 두 윤곽의 변끼리 만나는 점만 모았다. 그러면 띠가 한 윤곽의 엇갈린 점을 걸칠 수 있고, 한가운데의 세로선이 바로 그 점을 지나면 안쪽 구간의 길이가 0이 된다 — 네 점 나비넥타이 `(0,0)(1,1)(1,0)(0,1)`이 도로 안에 통째로 들면, 그 방이 걸친 띠가 하나뿐이고 그 한가운데가 엇갈린 점이라 거짓이 나왔다. 일관성 검토에서 그 블록을 저장소의 `nodePlanOutline`으로 돌려 확인하고 고쳤다. 10.3의 나비넥타이 줄과 10.9의 ⑬이 고정한다.) 판정은 이렇다: 그 선이 두 윤곽의 안을 지나는 구간(홀짝 규칙 — `containsPoint`의 다각형 가지와 같은 셈)이 `OVERLAP_SLACK`보다 길게 겹치면 참이다. 폭이 `OVERLAP_SLACK` 이하인 띠는 건너뛴다. "한쪽의 모서리가 다른 쪽 안에 있는가"만 보는 식은 쓰지 않는다 — 방을 가로지르는 길(어느 모서리도 상대 안에 없다)과 같은 폭으로 나란히 걸친 두 사각형(모서리가 모두 상대의 변 위다)을 놓치고, 변이 맞닿은 건물을 계산 오차에 따라 겹친 것으로 읽는다(10.9의 변형으로 고정한다).
  - **셈의 양**: 사각형 둘이면 띠 몇 개다. 겹치지 않는 둘은 변끼리 가로지르는 점이 없어 띠가 꼭짓점 수만큼이고, 겹치는 둘은 겹친 띠를 만나는 대로 끝난다. 점이 200개씩인 다각형 둘(한계)에서도 한 번에 수 ms다(설계 때 200점 다각형 쌍 셋 — 별 모양 둘, 서로 가로지르는 빗 모양 둘, 떨어진 빗 모양 둘 — 에서 0.4~20ms. 큰 값은 첫 호출이다. 그 값은 두 윤곽의 변끼리만 보던 블록의 것이다 — 모든 변의 짝을 보게 고친 뒤(짝의 수가 두 배쯤 는다) 같은 세 꼴을 다시 만들어 재니 0.7~9ms였다). 누를 때만, 같은 광선에 함께 맞은 (방, 도로) 쌍에 대해서만 부른다. 기억해 두지 않는다.
  - **광선의 맞춤 점으로 가르지 않는 까닭**: "벽을 맞힌 점의 평면 좌표가 도로 안인가"로도 가를 수 있다(`MapPickHit`에는 `point`가 있고 `pickMapNode`는 도면을 받는다, :587·:617 — 검토 전의 설계가 "광선 하나로는 건물 밑의 도로와 건물 옆의 도로를 가를 수 없다"고 적은 것은 틀렸다). 그러나 길에 붙여 세운 건물의 뒷벽은 정확히 도로의 가장자리 위에 서므로 그 점의 안팎이 계산 오차로 뒤집히고, 도로에 반쯤 걸친 건물은 누른 자리마다 답이 달라지며, 고가 아래의 건물은 광선이 비스듬한 만큼 어긋난다. (방, 도로) 한 쌍의 겹침은 광선과 무관해서 같은 건물·같은 도로에는 어디를 눌러도 같은 답이고("겹치면 **항상**"), `point` 없이 손으로 만든 맞춤으로도 그대로 테스트된다.

  **돌려 본 것.** v1.132.0의 `src/features/backgrounds`와 `tests/backgroundMap3dScene.test.ts`를 저장소 밖 임시 폴더에 복사해 아래의 함수들(`spacesOverlap`, `roadsUnderRooms`, `pickMapNode`의 한 걸음, `mapSpacePile`, `mapClickStep`·`BackgroundMap3D.tsx`의 한 줄씩)과 이 테스트에 필요한 만큼의 도로(`isRoadSpace`, 벽 없는 바닥, 범위, 쌓임의 층)를 넣고 Node에서 광선을 쏘아 셌다("화면 점"은 1.6:1 화면을 320×200으로 나눈 점이다). 보는 곳은 맞춤 보기 `fitMapView(map, 1.6)` — 수평에서 38° 위, 평면의 아래쪽에서 본다(:708).

  | 도면 | 센 것 | 결과 |
  |---|---|---|
  | 넓은 도로 (0, 0, 1000×680) **위에** 건물 (300, 200, 200×150, 높이 180) 하나 | 화면에서 건물이 차지하는 점 1550개 가운데 **건물의 벽만 맞고 광선이 건물 밖의 도로에 닿는** 점 | 860개(55%). v1.132.0의 규칙(바닥이 벽을 이긴다)을 그대로 두면 이 점들이 모두 도로를 잡는다 — 건물 몸통의 한가운데를 눌러도 도로다. 아래의 걸음을 넣으면 860점 모두 건물이고, 그 자리의 더미가 `[건물, 도로]`라 천천히 다시 누르면 도로다. **겹친 건물에 대해 ①을 막지 않으면 승인 문구가 3D에서 지켜지지 않는다** |
  | 같은 도면에서 도로가 보이는 화면 점 | 처음 누를 때 도로가 아니라 건물이 잡히는 점 | 맞춤 보기 14523점 가운데 1360점(9%), '위에서 보기' 34804점 가운데 2214점(6%) — 건물이 놓인 자리와 그 둘레뿐이다 |
  | 길 (0, 300, 1000×80) 양쪽에 건물 150×150(높이 180)을 다섯 채씩, **길에 붙여서**(눈 쪽 y 380~530, 먼 쪽 y 150~300 — 변만 맞닿는다) | 길 위의 표본 392점에서 처음 잡히는 것 | **392점 모두 길**이다. 그 가운데 371점은 눈 쪽 건물의 벽 뒤다(화면 점으로는 길이 보이는 1602점 모두 길). 겹침을 보지 않고 "방이 맞으면 도로를 뺀다"로 하면(검토 전의 설계) 그 371점·화면 점 1506개(94%)가 앞 건물을 잡는다 — 겹치지 않는 건물이 길을 가로막는 것은 승인 문구에 없는 동작이다 |
  | 같은 도면에서 눈 쪽 건물을 길 쪽으로 **1만큼** 옮긴 것(y 379 — 겹친다) | 같은 392점 | 길 21점, 건물 371점(모두 벽만 맞은 점이고, 371점 모두에서 천천히 다시 누르면 길이다). **조금이라도 걸치면 겹친 것이다** — 승인 문구의 "겹치면 항상". 건물을 길에 딱 붙이려면 옮기기의 스냅을 쓴다(그리기는 스냅하지 않는다) |

  기존 61개 테스트는 손대지 않고 통과하고, 10.3의 겹침 표와 10.7의 누름 테스트(맞춤 표·장면 셋·뷰포트 둘·손잡이)에 해당하는 임시 테스트가 통과하며, 10.9에 적은 변형이 모두 잡힌다(어느 테스트가 잡는지까지 10.9에 적었다). `tests/backgroundMapEditorWiring.test.ts`는 앵커 31 하나만 글자가 바뀐다(10.1). 앱 화면에서 본 것은 아니다(수동 검증 R6·R6b).

  **그 뒤에 `spacesOverlap`의 블록을 한 곳 고쳤다**(일관성 검토 — 변끼리 만나는 점을 한 윤곽의 변끼리도 모은다, 위의 '방법'). 위의 측정과 임시 테스트는 고치기 전의 블록으로 돈 것이다. 고친 블록은 이 문서의 글자 그대로 저장소의 `nodePlanOutline`에 물려 다시 돌렸다: 10.3의 표 22줄(더한 나비넥타이 줄 포함)이 양쪽 순서로 통과한다. 위 표의 도면과 10.7의 조각(도로·방·큰 방·둘째 방·옆 방·골목·먼 골목·방 안의 작은 도로 조각, 길과 길가 건물 — 붙인 것과 1만큼 걸친 것. 모두 사각형이다)의 모든 쌍에서 고치기 전의 블록과 답이 같다 — 사각형에서는 더해지는 짝이 꼭짓점의 x만 다시 넣는다. 스스로 엇갈리지 않는 무작위 다각형·타원·돌린 사각형 4000쌍에서도 같았다. 그래서 위의 측정과 10.7의 기대값은 그대로 선다. 장면·뷰포트 테스트 자체를 고친 블록으로 다시 돌리지는 않았다 — 구현의 테스트가 본다.

  **한 걸음 — `pickMapNode`:**

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
  …지금의 본문(:618-629) 그대로, `hits` 자리에 `list`(`pickMapFloor(list, map)`까지)…
}
```

  - **빼는 것은 "같은 광선에 맞은 방과 평면에서 겹친 도로"의 맞춤뿐이다.** 남은 맞춤에는 **지금의 규칙을 그대로** 쓴다(카메라·기호의 실체 → 기호의 대리 상자 → 바닥(가까운 높이, 같은 높이는 쌓임 순서) → 벽). 도로가 빠지려면 그 광선에 방의 맞춤이 있어야 하므로, 빼고 나면 적어도 그 방이 남는다 — 아무것도 잡히지 않아 도로로 되돌아가는 둘째 걸음은 필요 없다.
  - 결과: 같은 높이의 방과 그 아래 깔린 도로 → 방(쌓임 순서로도 그랬다). **도로 위에 선 방의 벽 + 뒤의 그 도로 바닥 → 방**(새로). **방과 겹친 올린 도로 + 아래의 그 방 바닥 → 방**(새로). **도로 옆에 선 방의 벽 + 뒤의 도로 바닥 → 도로**(v1.132.0의 "바닥이 벽을 이긴다" 그대로). 도로 옆에 선 방보다 높이 올린 도로 + 그 방의 바닥 → 도로(가까운 높이의 바닥, 지금 그대로). 도로만 → 도로(도로끼리는 지금의 바닥 규칙: 가까운 높이, 같은 높이는 작은 도로). 방의 벽 + 뒤의 **더 큰 방** 바닥 → 큰 방(방끼리의 규칙은 건드리지 않는다). `map` 없이 부르면 지금과 같다.
  - 한 광선에 도로가 둘이고 방이 그 가운데 하나 위에만 서 있으면, 방 밑의 도로만 빠지고 다른 도로의 바닥은 남아 벽을 이긴다(그 도로가 잡힌다). 한 광선에 방의 벽이 둘이고 뒤의 방만 도로 위에 서 있으면, 도로는 빠지고 남은 것 가운데 가장 가까운 벽의 방(앞의 방)이 잡힌다 — "벽만 있으면 가까운 벽"이라는 지금의 규칙이다(14.4).
  - 더블클릭(`doubleClickNode`, BackgroundMap3D.tsx:573-575)과 클릭의 한 걸음(`mapClickStep` :654)은 이 함수를 부르므로 함께 따라온다. **`pickMapFloor`·`mapFloorPile`은 고치지 않는다**: 기호를 놓을 자리(`pickMapFloor`의 `point`, BackgroundMap3D.tsx:514)는 여전히 눈에 가까운 바닥 위의 점이고(소속과 높이는 7.8대로 그 점의 맨 위 공간이 정한다), 바닥 더미에는 도로가 그대로 들어 있다(같은 높이면 방들 다음, 올린 도로는 맨 앞).
  - `map3dScene.ts`는 `isRoadSpace`를 `mapSpatial.ts`에서, `spacesOverlap`을 `mapStack.ts`에서 가져온다(둘 다 이미 import하는 모듈이고 평면 편집 모듈이 아니다 — 앵커 10 불변).
  - **`roadsUnderRooms`의 자리**: 위의 블록대로 `pickMapFloor` 다음, `pickMapNode` 바로 앞이다. 기존 앵커 21이 `pickMapFloor`의 본문으로 읽는 조각(`'export function pickMapFloor('`부터 `'export function pickMapNode('`까지, `tests/backgroundMapEditorWiring.test.ts:318`)에 이 함수가 들어가게 되지만, 그 앵커의 두 검사(`spaceStackRanks(map)`가 있다, `map.nodes.findIndex(`가 없다)는 그대로 통과한다. "`pickMapFloor`에 도로 규칙이 없다"를 보는 앵커 49는 그 조각을 쓰지 않고 `'function roadsUnderRooms('` 앞까지로 자른다(10.9).

  **다시 누를 때의 더미 — `mapSpacePile`** (`map3dScene.ts`에서 `mapFloorPile` 다음에 내보낸다):

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

  - 쓰는 곳은 지금 `mapFloorPile`을 부르는 **두 줄**이고, 그 두 줄만 바꾼다. ① `mapClickStep`의 :666 `pile = mapFloorPile(hits, map);` → `pile = mapSpacePile(hits, map);` ② `BackgroundMap3D.tsx`:562(기즈모 손잡이 위에서 움직이지 않고 누른 클릭)의 `again ? mapFloorPile(hits, props.map) : []` → `again ? mapSpacePile(hits, props.map) : []`. 그 파일의 import(:8)는 `mapFloorPile`을 `mapSpacePile`로 바꾼다(그 파일에서 더 쓰이지 않는다). `mapClickStep`의 나머지 줄, 같은 자리인지를 정하는 줄(BackgroundMap3D.tsx:552), `doubleClickNode`·`mapClickAim`은 고치지 않는다. `mapClickStep`의 주석 둘은 바뀐 더미에 맞춘다 — :667-669의 "its floor and the floor the click picks are both in the pile"는 "it and what the click picks are both in the pile"로, :672는 `// A space hit on a wall only is no part of the pile, but for the room picked on a wall in front of the roads under it (mapSpacePile).`로.
  - **방과 겹친 도로가 광선에 없으면 `mapFloorPile`과 늘 같다** — 도로가 없는 도면에서도, 도로가 건물 옆을 지나기만 하는 도면에서도: 잡힌 공간은 바닥이 맞은 공간이거나(더미에 이미 있다) 바닥이 하나도 없을 때의 벽이다(더미가 비어 있다). 방의 벽 뒤에 다른 **방**의 바닥이나 **겹치지 않는 도로**의 바닥이 있으면 그 바닥의 공간이 잡히므로(바닥이 벽을 이긴다) 벽으로만 맞은 방은 지금처럼 더미에 들지 않는다 — ②의 겹친 방 규칙과 그 테스트(`tests/backgroundMap3dScene.test.ts:612-620`, :636-646, :2039-2058)는 그대로다.
  - 결과(같은 자리를 천천히 거듭 누를 때. "밑의 도로" = 그 방과 평면에서 겹친 도로, "옆의 도로" = 겹치지 않는 도로):

  | 포인터 아래 | 처음 | 다시 | 또 한 번 | `mapSpacePile` |
  |---|---|---|---|---|
  | 방의 바닥 + 같은 높이의 밑의 도로 바닥 | 방 | 도로 | 방 | `[방, 도로]` (바닥 더미 그대로) |
  | **방의 벽 + 뒤의 밑의 도로 바닥** | 방 | **도로** | 방 | `[방, 도로]` — 벽으로 잡힌 방을 앞에 넣는다 |
  | **방의 벽 + 뒤의 옆의 도로 바닥** | **도로** | 도로 | 도로 | `[도로]` — v1.132.0의 벽 규칙 그대로다. 그 방은 자기 바닥이 보이는 곳에서 누른다 |
  | 방의 벽 + 밑의 도로 바닥 둘(같은 높이) | 방 | 작은 도로 | 큰 도로(그 다음 방) | `[방, 작은 도로, 큰 도로]` |
  | 방의 벽 + 밑의 도로 바닥 + 옆의 도로 바닥(같은 높이) | 옆의 도로 | 밑의 도로 | 옆의 도로 | 바닥 더미 그대로(두 도로, 작은 것 먼저) — 방은 들지 않는다. 옆의 도로의 바닥이 벽을 이긴다 |
  | 방과 겹친 올린 도로의 바닥 + 아래의 그 방 바닥 | 방 | 도로 | 방 | `[도로, 방]` (바닥 더미 그대로 — 고른 것의 다음으로 돌아가며 넘긴다) |
  | 방의 벽 + 더 큰 방의 바닥 + 밑의 도로 바닥 | 큰 방 | 도로 | 큰 방 | `[큰 방, 도로]` — 벽으로만 맞은 방은 들지 않는다(②) |
  | 방의 벽만 | 방 | 방 | 방 | `[]` |
  | 카메라·기호 + 방의 벽 + 밑의 도로 바닥 | 카메라·기호 | ②의 규칙 그대로 | | `[도로]` — 방을 넣지 않는다 |
  | 도로 바닥만 | 도로 | 도로 | 도로 | `[도로]` |

  - 다른 곳을 누르다 온 첫 누름(`again`이 거짓)은 밑의 도로가 선택돼 있어도 맨 위의 것(방)이다. 빠른 둘째 클릭(`repeat`)은 넘기지 않고 고른 것을 그대로 둔다 — 둘 다 ②의 규칙이며 고치지 않는다.
  - **더블클릭**: 건물 **밑의** 도로가 그 건물의 벽 너머로 보이는 자리를 그냥 더블클릭하면 건물의 것이다(위의 걸음). 도로까지 내려간 뒤 그 자리를 더블클릭하면 **도로의 상세 도면**이 열린다 — ②의 규칙 그대로다(더블클릭의 첫 클릭이 도로에서 넘어가며 도로를 겨냥으로 남기고(`mapClickAim`), `doubleClickNode`가 상세 도면이 연결된 겨냥을 먼저 본다). 도로에 상세 도면이 없으면 맨 위의 것(건물)의 것이다(겹친 방과 같다). 건물 **옆의** 도로는 벽 너머의 자리에서도 더블클릭 한 번에 도로의 상세 도면이 열린다.
  - 건물 밑의 도로에서 그 건물에 가리지 않은 자리는 처음 누를 때 바로 잡힌다. 가린 자리는 건물이 놓인 곳과 그 둘레뿐이고(위의 측정에서 도로가 보이는 자리의 9%), 보조 평면도와 오브젝트 목록으로도 고른다. 완료 보고에 적는다(14.3).
- **기즈모**: 옮기기(바닥 높이 포함)·세로축 돌리기는 방과 같다. **크기 방식에서 높이 방향 손잡이가 없다**(7.9).

### 7.7 쌓임·누름·상자·스냅

`mapStack.ts`의 `stackedSpaces`에 층을 더한다(② 설계 7.6이 비워 둔 자리):

```ts
return { space, index, layer: isRoadSpace(space) ? 0 : 1, area: Number.isFinite(area) ? area : Infinity };
…
return entries.sort((a, b) => a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area).map(entry => entry.space);
```

- **도로는 크기와 무관하게 모든 방 아래**다. 도로끼리는 기존 넓이 규칙(작은 도로가 위, 같으면 배열에서 뒤의 것이 위). 넓이가 유한하지 않은 공간은 **자기 층의** 맨 아래다.
- 쌓임 순서를 읽는 여섯 곳(2.4)의 읽는 줄은 고치지 않는다 — 층 하나로 모두 따라온다. 따라서: 평면에서 방과 겹친 자리를 누르면 방이 잡히고, **같은 자리를 천천히 다시 누르면** 방들을 다 지난 뒤 도로로 내려간다(더미 = `spacesAt`: 작은 방 … 큰 방, 작은 도로 … 큰 도로). 연속 클릭은 넘기지 않는다(②의 규칙). 보조 평면도도, 3D의 같은 높이 바닥(`pickMapFloor`)과 다시 누를 때의 바닥 더미(`mapFloorPile` → `[방 …, 도로 …]`)도 같다. 3D에서 쌓임 순서가 닿지 않는 두 경우(벽, 다른 높이)는 7.6이 맡는다 — 처음 누름은 `pickMapNode`의 맨 앞 걸음(같은 광선의 방과 평면에서 겹친 도로의 바닥을 뺀다), 다시 누름은 `mapSpacePile`(벽으로 잡힌 방을 그 밑의 도로 앞에 넣은 더미). 방과 겹치지 않는 도로에는 그 걸음이 걸리지 않는다.
- **큰 공간 안에 통째로 든 도로는 몸통을 바로 누를 수 없다** — "항상 건물 아래"의 '건물'을 도로가 아닌 모든 공간으로 읽은 데서 따라 나오는 일이고, 이전 결정 "작은 공간이 위"가 이 한 경우에는 서지 않는다(I5 — 구현 전에 보이도록 1.1의 표에 올렸다). 부지나 마당을 먼저 그리고 그 안에 길을 그리는 흔한 도면에서 처음부터 만나게 되므로, 도로의 속성 칸 안내가 잡는 법을 말한다(7.3의 `ROAD_HINT`). 층 때문에 도로는 크기와 무관하게 모든 방 아래이므로, 마당·부지·주차장처럼 **더 큰 방** 안에 그린 도로에는 방에 덮이지 않은 자리가 없다(도로는 방의 옅은 채움 너머로 보인다). 그 자리를 누르면 방이 잡힌다. 도로가 **이미 선택돼 있어도** 마찬가지다: 방금 그렸거나(그리기가 끝나면 그 도로가 선택된다, :781) 오브젝트 목록에서 고른 도로의 몸통을 끌면, 누르는 순간 바깥 방이 선택되고 **그 방이 소속 항목과 함께 움직인다**(`resolvePlanPress`, mapPlanSelect.ts:144-145 — 겹친 공간의 아래 것은 "같은 자리를 다시 누른 때"(`again`)에만 대상이 되고, 그리기와 목록 선택은 그 기억(`lastSpot`)을 남기지 않는다. :156-162가 맨 위 노드를 잡는다). ②의 겹친 방 규칙 그대로이고 **코드를 고치지 않는다**(승인된 쌓임 규칙을 바꾸지 않는 한 고칠 수 없다). 그런 도로를 다루는 길:
  - 그 자리를 한 번 누르고(방이 잡힌다) **천천히 한 번 더** 누른다 → 도로가 잡힌다. 그 **같은 자리에서** 끌면 도로가 움직인다(`again`이 참이라 선택된 도로가 끌린다, :157-158).
  - **Shift를 누른 채** 방 안에서 끌어 도로의 **가장자리에 걸치는** 상자를 그린다(Shift 없이 방 안에서 끌면 방이 움직인다. 상자는 벽에 닿은 공간만 고르므로 바깥 방의 벽에 닿지 않게 그리면 도로만 잡힌다 — ②의 "Shift+끌기로 공간 위에서도 상자 그리기").
  - 오브젝트 목록에서 고른 뒤 속성 칸(이름·위치·크기·'공간 종류')이나 **손잡이**(크기·회전·다각형의 점 — 손잡이는 공간들 위에 그려져 바로 눌린다)를 쓴다. 3D에서는 기즈모.
  - 이름 바꾸기는 F2(선택된 것의 이름 칸을 연다) 또는 속성 칸의 이름.
  
  3D도 같다(같은 높이의 바닥은 쌓임 순서, 그 밖은 7.6): 큰 방 안의 도로는 처음 누르면 방, 천천히 다시 누르면 도로다. 수동 검증 R2b가 이 길들을 본다. 완료 보고에 적는다(14.3).
- **상자**: 도로도 벽(윤곽선)이 상자에 닿아야 잡힌다. 넓은 도로 안쪽에만 그린 상자는 도로를 고르지 않고 그 위의 것만 고른다. `planRectTouches`는 고치지 않는다.
- **옮기기·크기·회전·점 편집·잠금·삭제·묶음 동작**: 방과 같다. 도로를 옮기면 소속 카메라·기호가 함께 간다(`transformMapSpace`).
- **스냅**: 도로의 가장자리·가운데 선과 (타원이 아니면) 모서리가 다른 공간처럼 스냅 대상이다(`collectSnapCandidates` 불변). 그리기는 스냅하지 않는다(지금과 같다).
- **더블클릭**: 상세 도면이 연결돼 있으면 그 도면으로, 아니면 이름 칸(방과 같다).

### 7.8 소속 — 도로 위의 건물이 자기 것을 갖는다

| | 새 기호 (`placeSymbol`) | 새 카메라 (`addMapCamera`) |
|---|---|---|
| 규칙 | 놓은 점의 **맨 위 공간**(`spacesAt(base, point)[0]`). 쌓임 순서가 도로를 맨 아래에 두므로: 방이 있으면 가장 작은 방, 방이 없으면 가장 작은 도로 | 생성점을 품은 **방**이 하나라도 있으면 방만 센다 — 정확히 하나면 그 방, 둘 이상이면 소속 없음. 방이 없으면 도로를 센다 — 정확히 하나면 그 도로, 둘 이상이면 소속 없음 |
| 코드 | **고칠 것 없음**(7.7의 층 하나로 따라온다) | 아래 |
| 바뀌는 고정 테스트 | 없음 | 없음 — `tests/backgroundMapGeometry.test.ts:235-255`의 기대값은 그대로다(도로가 없는 도면에서는 규칙이 같다). 도로가 든 경우를 더한다(10.3) |

```ts
export function addMapCamera(map: BackgroundMap, id: string): { map: BackgroundMap; camera: BackgroundCamera } {
  const created = createMapCamera(id, nextMapCameraName(map.nodes));
  const containing = map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && containsPoint(node, created));
  // A road lies under what stands on it: the rooms decide first, and a road is joined only where no room holds the point.
  const rooms = containing.filter(space => !isRoadSpace(space)), candidates = rooms.length ? rooms : containing;
  const camera: BackgroundCamera = candidates.length === 1 ? { ...created, spaceId: candidates[0].id } : created;
  return { map: { ...map, nodes: [...map.nodes, camera] }, camera };
}
```

- 근거: 도로를 다른 공간처럼 세면, 길 위에 선 건물의 도면에서 생성점이 도로와 건물 둘에 들어 새 카메라가 늘 소속 없이 생긴다. 도로를 아예 빼면 길만 있는 도면의 카메라가 그 길에 속하지 못한다("방처럼 … 카메라를 연결할 수 있다"에 어긋난다).
- 기존 노드의 소속은 다시 계산하지 않는다(`spaceId`는 만들 때와 속성 칸에서만 정한다). 속성 칸의 '소속 공간'·'카메라가 있는 공간' 목록(:1110, :1116)에는 도로도 이름으로 나온다(지금의 식 그대로).
- 도로에 배경 장소를 연결하는 칸('배경 장소 연결', :1116), 내부 도면 만들기·기존 도면 연결(:1074-1080), 카메라의 시점 연결은 **방과 같은 코드를 그대로 지난다**(공간이면 나온다). 아래 이미지 그리드의 범위(`mapGallery.ts`)도 공간 기준이라 그대로다.

### 7.9 도로의 높이 — '입체 높이'는 없다

도로에는 벽이 없으므로 세로 크기를 읽는 여섯 곳(2.4)을 이렇게 정한다:

| 곳 | 도로일 때 |
|---|---|
| 3D의 벽·이름표 높이 | `spaceWallHeight` → 0 (7.6) |
| 3D 전체 범위 | `spaceWallHeight` → 바닥만 (7.6) |
| 속성 칸 '높이' (:1117-1121) | **'바닥 높이' 칸 하나만** 보인다. '입체 높이' 칸은 그리지 않는다. 머리줄 오른쪽 글자는 `입체 N` 대신 `바닥 N`. 안내: `바닥 높이를 바꾸면 이 도로에 속한 카메라와 사물도 같은 만큼 함께 오르내려요. 도로에는 벽이 없어서 입체 높이가 없어요.` |
| 기즈모의 크기 방식 | 높이 방향 손잡이를 감춘다: `mapGizmoSetup(type, mode, flat = false)` — `flat`이고 `scale`이면 `showY: false`(그 밖은 지금과 같다). `MapGizmoTarget`에 `flat?: boolean`을 더하고 `setTarget`이 넘긴다. `BackgroundMap3D.tsx`의 `applyGizmo`(:433-437)가 `flat: node.type === 'space' && isRoadSpace(node)`를 싣는다. three.js는 `showY`가 거짓이면 이름에 Y가 든 손잡이(Y, XY, YZ)를 모두 감춘다 |
| 3D 결과를 값으로 되돌리기 (`applyNodeWorldPose`, mapGeometry.ts:319) | 도로면 `volumeHeight`를 **쓰지 않는다**: `volumeHeight: node.type === 'space' && isRoadSpace(node) ? null : settle(…)`. 손잡이가 없어도 이 순수 함수가 규칙이다 |
| 보조 평면도의 읽어 주는 값·옆 그림 | 7.5 |

`nodeVolumeHeight` 자체는 고치지 않는다(저장된 값 또는 180을 돌려준다). 저장돼 있던 `volumeHeight`는 도로인 동안 쓰이지 않을 뿐 남아 있고, 방으로 되돌리면 그 높이의 벽이 다시 선다. 바닥 높이(`elevation`)는 도로에도 그대로 있다(고가·내리막의 높이, 소속 항목이 함께 오르내린다).

### 7.10 그 밖

- 여러 개 선택의 요약(`BackgroundMapSelectionSummary.tsx`)은 고치지 않는다 — 도로는 `공간 N`에 함께 센다.
- '도면 구성'의 `N개 공간`(:1135)도 도로를 함께 센다.
- 이름 칸의 기본 이름: `새 도로`. Esc면 그 이름으로 남는다(방의 `새 공간`과 같다).
- 미리보기의 시험 자료(`previewGateway.ts`의 `seed`)는 고치지 않는다.

---

## 8. 카메라 색 (F7)

### 8.1 색 표 모듈 — `mapCameraColor.ts` (새 파일, three.js·DOM 없음)

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

표의 줄 수가 곧 화면의 동그라미 수다(여섯). 호박색은 이 표에 없다 — 색이 아니라 "키가 없음"이다. DOM 화면(평면·보조 평면도·목록·동그라미)은 같은 값을 CSS 변수로 갖는다(8.3). 두 벌이 같은지는 테스트가 본다(10.6).

### 8.2 속성 칸의 색 동그라미 — `BackgroundMapCameraColor.tsx` (새 파일)

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

- **자리**: 카메라 가지(:1090)의 맨 앞 — 이름 칸 바로 아래, '카메라 설정' 묶음(:1093) 위. **편집 중일 때만** 그린다(보기 모드에는 고칠 것이 없고, 색은 도면에서 보인다). 평면·3D 모두.
- **동그라미는 정확히 여섯 개다**(I1, 승인 문구 "색 동그라미 여섯 개"): `MAP_CAMERA_COLORS`의 여섯 줄이 그대로 여섯 동그라미이고, 이 파일에 `bmap-color-swatch`는 그 한 군데뿐이다(앵커 45). 호박색 동그라미는 없다.
- **원래 색으로 돌아가는 길**: 동그라미 줄 끝의 **글자 버튼 '기본 색으로'**(기존 `.bmap-text-button` — 동그라미가 아니다). 누르면 `onChange(null)` → 키가 지워져 호박색이 된다(3.3). 색을 고르지 않은 카메라에서는 되돌릴 것이 없으므로 **흐리게** 보이고(`aria-disabled="true"`, 8.3의 `.bmap-color-reset` 규칙) 눌러도 아무 일도 없다. `disabled` 속성으로 끄지 않는 까닭: 색이 있는 카메라에서 이 버튼을 누르면 그 순간 버튼이 스스로 꺼진다. 포커스를 쥔 채 꺼진 버튼은 키 이벤트를 내보내지 않거나 포커스를 문서 바탕으로 잃는다(엔진에 따라 다르다 — 앱 엔진에서 어느 쪽인지는 확인하지 않았고, 어느 쪽이든 결과는 같다): 편집기의 키(`.bmap-layout`의 `onKeyDown`, :949 — 버튼에 포커스가 있을 때도 듣는 확대·맞춤·F2(:862-868)와 Esc)가 도면을 한 번 누를 때까지 닿지 않는다. '다각형으로 바꾸기' 버튼이 제 클릭으로 사라질 때 포커스를 도면으로 옮겨 두는 것(:1084의 주석)과 같은 함정이고, 여기서는 버튼이 남아 있으므로 끄지 않는 것으로 피한다. 잠긴 카메라·저장 중에는 동그라미와 함께 `disabled`다(그때는 포커스가 이 버튼에 있을 수 없다).
- **표시**: 지금 색의 동그라미가 `aria-pressed="true"`이고 바깥 고리가 생긴다(색만으로 구분하지 않는다). 색을 고르지 않은 카메라는 **어느 동그라미에도 고리가 없고** '기본 색으로'가 흐리다 — 그것이 "지금은 기본 색"이라는 표시다. 기존의 눌림 버튼 묶음(`role="group"` + `aria-pressed`, 위아래 방향 버튼 :1096)과 같은 꼴이다. 머리 글자는 기존 `.bmap-eyebrow`.
- **키보드**: 동그라미 여섯과 '기본 색으로'를 Tab으로 차례로 지나고 Enter·Space로 누른다(보통 버튼). 동그라미의 이름은 `aria-label`(색 이름), 마우스를 올리면 `title`.
- **포커스 고리는 눌림 고리 바깥에 그린다.** 포커스 고리는 편집기의 기존 규칙(backgrounds-map.css:5, backgrounds.css:47-53 — `outline:2px`, `outline-offset:2px`)이 그리는데, 그대로 두면 동그라미 가장자리에서 2~4px 띠를 차지한다. 지금 색의 눌림 고리(8.3의 `box-shadow` 두 겹 — 바깥 고리가 같은 2~4px 띠)와 정확히 겹쳐서, **키보드로 동그라미에 포커스를 둔 동안에는 그것이 지금 색인지 보이지 않고 Enter를 눌러도 동그라미에 변화가 없다.** 동그라미에만 `outline-offset:5px`을 주어(8.3) 포커스 고리를 5~7px 띠로 밀어낸다 — 눌림 고리(검은/흰 고리)와 포커스 고리(보라)가 1px 사이를 두고 함께 보인다. 이웃 동그라미의 눌림 고리와 닿지 않도록 동그라미 사이의 간격은 12px이다(포커스 고리의 바깥 7px + 이웃 눌림 고리의 4px = 11px).
- **잠긴 카메라·저장 중**: `disabled={fieldLocked}`(동그라미 여섯과 글자 버튼 모두).
- **누르면**: 편집기의

```ts
function changeCameraColor(color: BackgroundCameraColor | null) {
  if (!current || selected?.type !== 'camera' || !canEdit) return;
  const next = setCameraColor(selected, color);
  if (next !== selected) updateMap(replaceMapNode(current, next));     // one update per pick, one undo step
}
```

  한 번 누름 = `updateMap` 한 번 = 되돌리기 한 단계(같은 색을 다시 누르면 아무 일도 없다). 이어 붙이는 키(`coalesceKey`)를 쓰지 않는다 — 색을 세 번 바꾸면 되돌리기도 세 번이다. 끌기 도중에는 문서가 일반 수정을 받지 않는다(기존 규칙).

### 8.3 평면·목록·보조 평면도 — `data-camera-color`와 CSS 변수

카메라의 색을 아는 요소에 **`data-camera-color={node.color}`**를 단다(값이 없으면 React가 속성을 내지 않는다 → 기본 호박색):

| 화면 | 요소 |
|---|---|
| 평면 | 카메라 `<g className="bmap-camera …">`(:1027) |
| 평면의 손잡이 | `MapNodeHandles`의 카메라 가지 `<g className="bmap-handles">`(BackgroundMapPlanOverlays.tsx:35) — 방향 손잡이와 점선이 그 카메라 색 |
| 오브젝트 목록 | 종류 아이콘 `<span className="bmap-node-kind is-camera">`(:171) — 카메라일 때만 |
| 보조 평면도 | `PlanCamera`의 `<g>`(BackgroundMapPlanPreview.tsx:84), 선택된 카메라를 겹쳐 그리는 `<g className="bmap-plan-selected bmap-plan-camera">`(:225), 읽어 주는 칸 `<div className="bmap-plan-readout is-camera">`(:114, 옆에서 본 그림이 든다), 선택된 카메라의 안내 줄 둘(:227-228) |
| 속성 칸 | 색 동그라미(8.2) |

CSS는 색을 **숫자 셋**으로 든다(이 앱의 테마 색과 같은 방식). `backgrounds-map.css`:

```css
/* Colours of the map editor that are no theme colour: one camera (default = the amber it always was), and the road. */
.bmap-layout { --bmap-cam:230 181 120; --bmap-cam-mark:55 39 21; --bmap-road:154 161 173; --bmap-road-mark:227 230 236; }
[data-color-mode="light"] .bmap-layout { --bmap-road:93 100 112; --bmap-road-mark:58 63 71; }
.bmap-layout [data-camera-color] { --bmap-cam-mark:var(--color-bg-primary); }
.bmap-layout [data-camera-color="red"] { --bmap-cam:242 114 107; }
.bmap-layout [data-camera-color="lime"] { --bmap-cam:183 216 75; }
.bmap-layout [data-camera-color="green"] { --bmap-cam:95 207 139; }
.bmap-layout [data-camera-color="teal"] { --bmap-cam:69 207 196; }
.bmap-layout [data-camera-color="blue"] { --bmap-cam:99 169 247; }
.bmap-layout [data-camera-color="pink"] { --bmap-cam:245 143 184; }
[data-color-mode="light"] .bmap-layout [data-camera-color="red"] { --bmap-cam:194 54 47; }
[data-color-mode="light"] .bmap-layout [data-camera-color="lime"] { --bmap-cam:95 127 15; }
[data-color-mode="light"] .bmap-layout [data-camera-color="green"] { --bmap-cam:31 138 76; }
[data-color-mode="light"] .bmap-layout [data-camera-color="teal"] { --bmap-cam:11 138 130; }
[data-color-mode="light"] .bmap-layout [data-camera-color="blue"] { --bmap-cam:30 111 208; }
[data-color-mode="light"] .bmap-layout [data-camera-color="pink"] { --bmap-cam:194 63 124; }
```

이 블록은 **두 단계에 나뉘어 들어간다**(13절). 도로의 것 — 첫 줄의 `--bmap-road`·`--bmap-road-mark`와 밝은 화면의 둘째 줄 — 은 도로 화면 단계(5)에서 넣는다: 그 단계의 도로 규칙(9.4)이 이 두 변수를 쓰고 `readPalette`(7.6)가 밝은 화면의 값을 여기서 읽으므로, 카메라 색 단계로 미루면 그 사이 평면·보조 평면도의 도로 채움과 가운데 점선이 값 없이 그려지고(E3를 볼 수 없다) 3D의 도로는 밝은 화면에서도 어두운 화면의 회색이다. 카메라의 것 — 첫 줄의 `--bmap-cam`·`--bmap-cam-mark`와 `[data-camera-color]` 줄 전부 — 은 카메라 색 단계(6)에서 그 첫 줄에 더하고 아래에 잇는다. 다 넣은 뒤의 모습이 위의 블록이다.

그리고 평면 카메라의 규칙(:59-70)에서 **글자 색만 변수로 바꾼다**(선택자·굵기·그 밖은 그대로):

| 지금 | 바꾼 뒤 |
|---|---|
| `#e6b578` | `rgb(var(--bmap-cam))` |
| `#e6b57820` | `rgb(var(--bmap-cam) / .1255)` |
| `#e6b57865` | `rgb(var(--bmap-cam) / .3961)` |
| `#e6b57840` | `rgb(var(--bmap-cam) / .251)` |
| `#e6b57826` | `rgb(var(--bmap-cam) / .149)` |
| `#372715` (:62 화살촉, :67 수직 표시) | `rgb(var(--bmap-cam-mark))` |

- **기본 카메라는 그대로다**: 변수의 기본값이 지금의 색이고 투명도는 같은 값의 소수 표기다(0x20/255 = 0.1255 …). 밝은 화면에서도 지금과 같다(2.3). 수동 검증에서 계산된 색을 v1.132.0과 견준다(11절 C1).
- 색이 있는 카메라의 안쪽 표시(화살촉·수직 표시)는 바탕색(`--color-bg-primary`)이다 — 어두운 화면에서는 밝은 몸통 위의 어두운 표시, 밝은 화면에서는 어두운 몸통 위의 밝은 표시가 된다.
- 오브젝트 목록(:129, :131 **다음에** 둔다 — 밝은 화면의 기본 규칙과 특이도가 같아 뒤의 것이 이겨야 한다): `.bmap-node-kind.is-camera[data-camera-color] { color:rgb(var(--bmap-cam)); }`
- 색 동그라미:

```css
.bmap-color-field { margin:12px 0 8px; }
/* 12px between the circles and 8px above and below: room for a focus ring 7px out next to a pressed ring 4px out. */
.bmap-color-swatches { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:8px; }
.bg-library .bmap-color-swatch { width:22px; height:22px; min-height:22px; padding:0; border-radius:50%; border:1px solid rgb(var(--color-bg-border)); background:rgb(var(--bmap-cam)); }
/* The shared hover of the library would repaint it with the accent tint. */
.bg-library button.bmap-color-swatch:hover:not(:disabled) { background:rgb(var(--bmap-cam)); border-color:rgb(var(--color-text-primary)); }
.bg-library .bmap-color-swatch[aria-pressed="true"] { box-shadow:0 0 0 2px rgb(var(--color-bg-card)), 0 0 0 4px rgb(var(--color-text-primary)); }
/* The shared focus ring sits 2 to 4px out, exactly on the ring of the pressed colour: outside it, both are seen. */
.bg-library .bmap-color-swatch:focus-visible { outline-offset:5px; }
/* 'Back to the default colour' with nothing to reset: dimmed, and the hover of a text button does not light it. */
.bg-library .bmap-color-reset { margin-left:4px; }
.bg-library .bmap-color-reset[aria-disabled="true"],.bg-library .bmap-color-reset[aria-disabled="true"]:hover { color:rgb(var(--color-text-secondary) / .45); background:transparent; cursor:default; }
```

  (공용 버튼 규칙 `.bg-library button`이 높이 36px·안쪽 여백·배경을 주므로(backgrounds.css:21-42) 같은 뿌리 선택자로 덮는다. 전환은 공용 규칙의 것뿐이고 새로 넣지 않는다. 동그라미 여섯은 모두 `data-camera-color`를 달고 있어 `--bmap-cam`이 제 색이다 — 호박색(변수의 기본값)으로 칠해지는 동그라미는 없다. '기본 색으로'는 기존 `.bmap-text-button`(:157-158)의 모습 그대로이고, 흐린 상태의 규칙은 그 버튼의 hover 규칙(`.bg-library .bmap-text-button:hover`)과 공용 hover 규칙(`.bg-library button:hover:not(:disabled)`, backgrounds.css:38-41)보다 특이도가 높아 hover에서도 흐린 채다. 속성 칸이 좁으면 글자 버튼이 다음 줄로 넘어간다(`flex-wrap`). 포커스 규칙 `.bg-library .bmap-color-swatch:focus-visible`은 클래스 둘과 가상 클래스 하나라, 고리를 그리는 두 공용 규칙(`.bmap-layout button:focus-visible`, `.bg-library button:focus-visible` — 클래스 하나·가상 클래스 하나·요소 하나)보다 특이도가 높아 적는 자리와 무관하게 이긴다. 바꾸는 것은 `outline-offset`뿐이고 고리의 색과 굵기는 공용 규칙의 것이다. 동그라미 여섯의 폭은 22×6 + 12×5 = 192px로, 가장 좁은 속성 칸(1200px 이하에서 220px, 안쪽 여백을 빼면 196px — backgrounds-map.css:138)에 한 줄로 들어간다.)
- 보조 평면도(`backgrounds-map-plan.css`) — 기존 변수 넷을 그 요소 아래에서만 바꾼다. 점·시선·고리·부채꼴·옆 그림이 모두 그 변수를 쓰므로 다른 규칙은 고칠 것이 없다:

```css
/* A camera with a colour of its own: the four camera variables of this plan follow it, on both themes. */
.bmap-plan-preview [data-camera-color] { --bmap-plan-cam:rgb(var(--bmap-cam)); --bmap-plan-cam-line:rgb(var(--bmap-cam)); --bmap-plan-cam-edge:rgb(var(--color-bg-primary)); --bmap-plan-cam-soft:rgb(var(--bmap-cam) / .18); }
```

- 선택·잠금 표시는 그대로 굵기·진하기·자물쇠다(2.3). 평면에서 선택된 카메라의 부채꼴은 그 색으로 진해진다.
- '카메라 일반'의 호박색(카메라 추가 아이콘, 위아래·시점 버튼의 테두리, 3D의 시점 미리보기 띠)은 **고치지 않는다**.

### 8.4 3D — `map3dScene.ts`

- **재질은 색마다 한 벌, 필요할 때 만든다.** `material(key, color?)`: 저장소의 열쇠가 `color ? `${key}|${color}` : key`가 된다(`materials`는 `Map<string, Material>`). 색을 타는 재질 이름은 여섯이다 — `camera`(몸통), `cameraLine`·`cameraLineOn`(선), `cameraFar`·`cameraFarOn`(화면 틀 채움), `cameraRing`(바닥 고리). 그 가지들의 색: `color`가 있고 `cameraColorHex(color, palette.light)`가 값을 주면 그 값, 아니면 지금의 `palette.camera`. **렌즈(`cameraLens`)는 색을 타지 않는다**(어두운 렌즈 그대로).
- `buildCamera`(:542-573): `const tint = node.color;`를 두고 `this.material('camera', tint)`, `this.material(selected ? 'cameraLineOn' : 'cameraLine', tint)`, `this.material(selected ? 'cameraFarOn' : 'cameraFar', tint)`, `this.material('cameraRing', tint)`. `this.material('cameraLens')`와 `this.material('proxy')`는 그대로.
- **함께 쓰기**: 같은 색의 카메라는 같은 재질 객체를 쓴다(지금 모든 카메라가 한 벌을 쓰는 것과 같다). 색이 없는 카메라는 지금의 열쇠(색 없는 이름) 그대로다.
- **만들기·버리기**: 새 재질은 기존과 같이 공용 묶음(`shared`)에 들어간다. 테마가 바뀌면 `setPalette`가 저장소의 모든 재질을 버리고(:219-220, 열쇠가 문자열이어도 같은 줄이 돈다) 다시 그릴 때 그 테마의 값으로 만든다. `dispose`는 묶음을 한 번 해제한다. 한 번 쓴 색의 재질은 그 색의 카메라가 없어져도 테마가 바뀌거나 화면이 닫힐 때까지 남는다 — 많아야 색 여섯 × 이름 여섯 = 36개다.
- **다시 만드는 때**: `shapeKey`의 카메라 줄(:90) 끝에 `|${node.color ?? ''}`.
- **선택·잠금**: 선택은 지금처럼 `…On` 재질(선 0.6 → 1, 화면 틀 채움 0.1 → 0.24)이라 어느 색에서도 같은 차이로 읽힌다. 3D에는 마우스를 올렸을 때의 표시가 없다(지금과 같다). 잠금은 이름표의 자물쇠.
- **밝은 화면**: `palette.light`가 참이면 표의 `light` 값. 색이 없는 카메라는 지금처럼 두 화면에서 같은 `palette.camera`.
- **이 카메라 시점으로 보기**: 영향이 없다. 보는 동안 그 카메라는 감춰지고(`hiddenId`), 구도는 자세·화각·비율에서만 나온다. 미리보기 띠의 호박색은 화면 색이다.

---

## 9. 파일 계획

### 9.1 새 파일

| 파일 | 책임 |
|---|---|
| `DEVLOG/migrations/2026-10-09-background-map-elements.sql` | 검증 함수를 3D 본문 + 추가 셋으로 바꿔 넣는다(4절) |
| `src/features/backgrounds/mapCameraColor.ts` | 카메라 색 표(이름·화면 이름·어두운/밝은 값)와 `cameraColorHex` (순수, three.js·DOM 없음) |
| `src/features/backgrounds/BackgroundMapCameraColor.tsx` | 속성 칸의 색 동그라미 여섯 개와 '기본 색으로' 글자 버튼(받은 값만 그린다) |
| `tests/backgroundMapElements.test.ts` | 이번 차례의 순수 함수 테스트: 기호 목록의 대체값, 도로의 판별·가운데 선, 키를 쓰고 지우는 두 함수, 색 표와 CSS의 일치, 새 CSS 규칙이 그 변수를 실제로 쓰는지(10.4~10.6) |

### 9.2 바뀌는 파일

| 파일 | 내용 |
|---|---|
| `types.ts` | `BackgroundSymbolKind`에 `'stairs'`, `BackgroundSpaceSurface`, `BackgroundCameraColor`, 공간의 `surface?`, 카메라의 `color?` |
| `domain.ts` | 닫힌 목록 상수 셋, `BackgroundUnsupportedError`(`detail` 포함), `known`, `onlyKeys`의 오류 종류, 노드 종류 검사의 자리, 공간·카메라의 새 키와 값 검사 |
| `mapSpatial.ts` | `SYMBOL_VOLUME_HEIGHTS.stairs`, `isRoadSpace`, `spaceWallHeight`, `roadCentreLine`, `roadCentrePlanLine` |
| `mapStack.ts` | `stackedSpaces`의 층(맨 앞 항), `spacesOverlap`(두 공간이 평면에서 넓이를 나눠 갖는가 — 3D의 누름이 쓴다, 7.6) |
| `mapGeometry.ts` | `setSpaceSurface`, `setCameraColor`, `addMapCamera`의 도로 규칙, `applyNodeWorldPose`가 도로에 `volumeHeight`를 쓰지 않음 |
| `symbolCatalog.ts` | 계단 항목, 이름으로 찾는 대체값 |
| `BackgroundSymbolGlyph.tsx` | 계단 그림(가지 하나. 선 굵기는 다른 기호처럼 그림 단위, 6.2) |
| `mapPlanPreview.ts` | `planKindLabel`, 도로의 읽어 주는 값, 옆 그림에서 도로 다루기 |
| `BackgroundMapPlanPreview.tsx` | 도로의 클래스·가운데 점선(`fill="none"` 속성 포함), 카메라의 `data-camera-color` 다섯 곳, 도로의 접근성 이름 |
| `BackgroundMapPlanOverlays.tsx` | 카메라 손잡이 `<g>`의 `data-camera-color` |
| `map3dScene.ts` | 계단 가지, 도로 가지(재질 다섯·팔레트 둘·그리는 순서·범위·`shapeKey`), `pickMapNode`의 맨 앞 걸음과 `roadsUnderRooms`(도로 바닥은 같은 광선의, 자기와 겹친 방에 진다, 7.6), `mapSpacePile`(새로 내보낸다)과 `mapClickStep`이 그것을 부르는 한 줄(건물 벽 너머의, 그 건물 밑 도로로 내려가는 길, 7.6), 카메라 색 재질(`material`의 둘째 인자, `shapeKey`) |
| `BackgroundMap3D.tsx` | `readPalette`의 `road`·`roadMark`, `applyGizmo`의 `flat`, 손잡이 위 클릭의 더미(:562)와 import(:8)의 `mapFloorPile` → `mapSpacePile`(7.6) |
| `BackgroundMapCameraGizmo.ts` | `mapGizmoSetup`의 셋째 인자 `flat`, `MapGizmoTarget.flat`, `setTarget`이 넘김 |
| `BackgroundMapEditor.tsx` | 도로 도구(`Tool`·`isDrawTool`·도구줄·`newSpace`·`pointerDown`의 두 줄), 공간 그리기의 도로 클래스·모서리·가운데 점선, '공간 종류' 칸과 `changeSpaceSurface`, 도로의 높이 칸, 색 동그라미와 `changeCameraColor`, 카메라 `<g>`와 목록 아이콘의 `data-camera-color`, `kindLabel`·머리 글자·목록 아이콘, 도로의 안내 문구(`ROAD_HINT` — 덮인 도로를 잡는 법까지, 모양 줄, 가운데 점선이 없을 때), 기호 목록 제목. 판정과 계산은 순수 모듈에 있고 편집기에는 배선만 는다 |
| `useBackgroundStore.ts` · `BackgroundLibraryView.tsx` | 업데이트 안내(5.2). 저장소는 안내가 켜질 때 까닭을 콘솔에 한 번 남긴다 |
| `backgrounds-map.css` · `backgrounds-map-plan.css` | 9.4 |
| `DEVLOG/migrations/2026-09-21-background-library.sql` · `2026-10-07-background-map-3d.sql` | **머리말 주석만**(4.3) |
| `tests/backgroundDatabaseContract` · `backgroundDomain` · `backgroundStore` · `backgroundPreview` · `backgroundPersistence` · `backgroundSpatial` · `backgroundMapStack` · `backgroundMapGeometry` · `backgroundMapPlanSelect`(더하기만) · `backgroundMapPlanPreview` · `backgroundMap3dScene` · `backgroundMapEditorWiring` (.test.ts) | 10절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서(`AGENTS.md`, `CLAUDE.md` :3, `ROADMAP.md`, 인수인계(:266·:297과 새 17절)·검증 기록, 라운드 계획) | 12절, 4.3 |

### 9.3 건드리지 않는 파일

- `electron/**` — 소스 변경 없음(같은 `domain.ts`가 묶일 뿐이다).
- 적용된 두 SQL 파일의 `BEGIN;` 아래 — 한 글자도.
- `mapCanvas.ts` — 계약(`selectedId` 하나, 초안 하나)이 바뀌지 않는다. 색·도로·계단은 모두 `map`에서 읽는다. **고칠 필요가 없다.**
- `mapDocument.ts`, `useBackgroundMapDocument.ts`, `mapEditSession.ts`, `mapWorkflow.ts`, `mapPlanSelect.ts`(테스트만 더한다, 10.3), `mapPlanEdit.ts`, `mapPlanGesture.ts`, `mapSnap.ts`, `mapGallery.ts`, `previewGateway.ts`, `BackgroundMapNameBox.tsx`, `BackgroundMapSelectionSummary.tsx`, `BackgroundMapPanels.tsx`, `BackgroundMapGallery.tsx`, `BackgroundUI.tsx`, `backgrounds.css`, `backgrounds-map-3d.css`, `src/mocks/devElectronAPI.ts`, `src/features/playground/featureFlag.ts`.

**모듈 의존(한 방향, 새로 생기는 줄만)**

- `mapSpatial.ts → domain.ts`(지금 그대로). `isRoadSpace`·`roadCentreLine`은 여기 있다.
- `mapStack.ts → mapSpatial.ts`(`isRoadSpace`, `nodePlanOutline`) — 지금의 `mapStack.ts → mapGeometry.ts → mapSpatial.ts`와 같은 방향. `map3dScene.ts → mapStack.ts`는 지금도 있다(`spaceStackRanks`). `spacesOverlap`이 더해질 뿐이다.
- `mapGeometry.ts → mapSpatial.ts`(`isRoadSpace`). `mapGeometry.ts`는 여전히 `mapStack.ts`를 import하지 않는다.
- `mapCameraColor.ts → types.ts`(타입만). `map3dScene.ts → mapCameraColor.ts`, `BackgroundMapCameraColor.tsx → mapCameraColor.ts`.
- 3D 파일(`BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapCameraGizmo.ts`)은 `mapSnap`·`mapPlanGesture`·`mapPlanEdit`·`mapPlanSelect`를 여전히 import하지 않는다(앵커 10).
- Node로 도는 모듈(`map3dScene.ts`가 끌어오는 것 포함)의 새 import는 `.ts` 확장자를 붙인다.

### 9.4 CSS 요약

`backgrounds-map.css`:

| 선택자 | 내용 |
|---|---|
| 8.3의 변수 블록 | 카메라 색과 도로 색(숫자 셋). 도로의 두 변수(두 화면)는 5단계에서, 카메라의 변수와 `[data-camera-color]` 줄들은 6단계에서 넣는다(8.3, 13절) |
| :46 | `.bmap-canvas.tool-road`를 십자 커서 목록에 더한다 |
| :59-70 | 호박색 글자를 변수로(8.3의 표) |
| `.bmap-space.is-road>rect, .bmap-space.is-road>ellipse, .bmap-space.is-road>polygon` (공간의 기본 규칙 :48-51 **뒤에**) | `fill:rgb(var(--bmap-road) / .22); stroke:rgb(var(--bmap-road) / .6);` |
| `.bmap-space.is-road:hover>rect, …>ellipse, …>polygon` | `fill:rgb(var(--bmap-road) / .3); stroke:rgb(var(--bmap-road));` |
| (도로의 세 채움 규칙 모두 — 위의 둘과 바로 아래의 선택 규칙) | `stroke-dasharray`·`stroke-width`를 적지 않는다 — 잠긴 도로의 점선 테두리(`.bmap-space.is-locked>…`, :51)와 선택 굵기가 기존 규칙에서 그대로 온다 |
| `.bmap-space.is-road.is-selected>rect, …>ellipse, …>polygon` | `fill:rgb(var(--bmap-road) / .34); stroke:rgb(var(--color-accent-sub));` (굵기 2.5는 기존 선택 규칙이 준다) |
| `.bmap-road-line` | `fill:none; stroke:rgb(var(--bmap-road-mark) / .85); stroke-width:1.5; stroke-dasharray:9 7; vector-effect:non-scaling-stroke; pointer-events:none;` |
| `.bmap-space.is-road text` (공간 이름 규칙 :52-53 **뒤에**) | `paint-order:stroke; stroke:rgb(var(--color-bg-primary)); stroke-width:calc(4px * var(--bmap-label-scale,1)); stroke-linejoin:round;` — 카메라 이름(:71)·기호 이름(:198)과 같은 바탕색 테두리이되, **굵기에 글자 크기와 같은 변수를 곱한다**(그 둘의 고정값 4는 도면 단위라 축소하면 사라진다 — 7.4). 도로의 이름과 '상세 도면 ↗' 글자가 어느 확대율에서도 가운데 점선에 그어지지 않게 한다. 글자 크기·색·굵기는 기존 규칙 그대로이고 방의 이름에는 걸리지 않는다 |
| `.bmap-node-kind.is-camera[data-camera-color]` (:131-132 뒤) | `color:rgb(var(--bmap-cam));` |
| 색 줄의 여덟 규칙(`.bmap-color-field`, `.bmap-color-swatches`, 동그라미 넷 — 모습·hover·눌림 고리·포커스 고리의 자리, `.bmap-color-reset` 둘) | 8.3 |

`backgrounds-map-plan.css`:

| 선택자 | 내용 |
|---|---|
| `.bmap-plan-space.is-road>polygon` (**:26 바로 다음, :27 앞** — 반드시 키보드 포커스 규칙 :33보다 앞) | `fill:rgb(var(--bmap-road) / .24); stroke:rgb(var(--bmap-road) / .7);` — 포커스 규칙 `.bmap-plan-node:focus-visible>polygon`(:33)과 특이도가 같아서(클래스 둘·요소 하나) 뒤에 적힌 쪽이 이긴다. :33 뒤에 두면 포커스를 받은 도로의 테두리가 포커스 색으로 바뀌지 않는다 |
| `.bmap-plan-space.is-road:hover:not(:focus-visible)>polygon` (그 바로 다음 줄) | `fill:rgb(var(--bmap-road) / .34); stroke:rgb(var(--bmap-road));` — `:not(:focus-visible)` 없이 `.is-road:hover`로만 적으면 포커스 규칙보다 특이도가 높아, 포커스를 받은 도로에 마우스를 올린 동안 포커스 테두리 색이 사라진다(방은 hover 규칙 :26이 :33보다 앞이고 특이도가 같아 그런 일이 없다) |
| (위 둘 모두) | `stroke-dasharray`·`stroke-width`를 적지 않는다 — 잠긴 도로의 점선(`.bmap-plan-node.is-locked>polygon`, :29)이 그대로 온다 |
| `.bmap-plan-road-line` | `fill:none; stroke:rgb(var(--bmap-road-mark) / .8); stroke-width:1; stroke-dasharray:4 3; vector-effect:non-scaling-stroke; pointer-events:none;` (이 파일의 공용 `non-scaling-stroke` 규칙(:21)은 `polyline`을 세지 않으므로 여기 적는다) |
| `.bmap-plan-preview [data-camera-color]` | 8.3 |

전환·애니메이션·`backdrop-filter`가 없다. 동작 줄이기용 짝 규칙도 필요 없다.

---

## 10. 테스트

모두 `node --test ./tests/background*.test.ts`(`npm run test:background`)에 자동으로 들어간다.

### 10.1 고정 값이 바뀌는 기존 테스트

| 위치 | 지금 | 바뀐 뒤 |
|---|---|---|
| `tests/backgroundDomain.test.ts:113` | 종류 아홉 개를 적은 배열 | `BACKGROUND_SYMBOL_KINDS`(계단까지 저장·왕복) |
| 〃 `:282` | `[…kinds].sort()`가 아홉 개의 정렬 목록 | 열 개: `['bed','cabinet','chair','custom','desk','door','plant','sofa','stairs','table']`, 그리고 `BACKGROUND_SYMBOL_KINDS`를 정렬한 것과 같다 |
| `tests/backgroundSpatial.test.ts:72` | 높이 다섯 `[160, 70, 60, 45, 80]` | 그 줄은 그대로 두고 `SYMBOL_VOLUME_HEIGHTS.stairs === 180` 한 줄을 더한다 |
| 〃 `:313` | 종류·높이 쌍 아홉 | `['stairs', 180]`을 더한다(:315-316의 모르는 문자열 → 80은 그대로) |
| `tests/backgroundMap3dScene.test.ts:182-186` | `parts`에 다섯 종류, 반복 목록 아홉 | `parts`에 `stairs: ['stairs-step']`. 반복 목록은 `'stairs'`를 **옛 종류 넷 앞에** 끼운다: `['door', 'chair', 'table', 'bed', 'stairs', 'custom', 'desk', 'sofa', 'cabinet', 'plant']`(몸통 크기 `[120, 180, 90]`). **`'plant'`가 마지막이어야 한다** — 반복은 같은 노드(`symbol(30, …)`)를 종류만 바꿔 다시 맞추고, 반복 바로 뒤의 :194(`!rootOf(scene, symbol(30, 'plant')).getObjectByName('table-top')`, "없앤 종류는 기타 사물로 그린다")는 id로 뿌리를 찾으므로 **마지막으로 맞춘 종류**를 본다. `'stairs'`를 끝에 붙이면 그 줄은 계단을 보면서도 통과해 아무것도 지키지 않게 된다. 반복 안에 한 줄을 더한다: 종류가 `'stairs'`가 아니면 `assert.ok(!root.getObjectByName('stairs-step'), kind)` — 옛 종류 넷(`desk`·`sofa`·`cabinet`·`plant`)과 다른 기호가 3D에서도 계단이 되지 않는다 |
| `tests/backgroundMapEditorWiring.test.ts:404` (앵커 26) | `"const drawing = canEdit && (tool === 'rect' \|\| tool === 'ellipse' \|\| tool === 'polygon' \|\| tool === 'symbol');"` | `"const drawing = canEdit && (isDrawTool(tool) \|\| tool === 'symbol');"`. :402-403의 주석 "four drawing tools" → "five". 같은 앵커의 `mode = ` 셋(:411-412)은 그대로 통과해야 한다 |
| `tests/backgroundMapEditorWiring.test.ts:525`, `:527` (앵커 31) | `inOrder`의 가운데 글자 `'pile = mapFloorPile(hits, map);'`, 그리고 `count(step, /mapFloorPile\(/g)`가 1 | `'pile = mapSpacePile(hits, map);'`, 그리고 `count(step, /mapSpacePile\(/g)`가 1이면서 `count(step, /mapFloorPile\(/g)`가 0(`mapClickStep`은 바닥 더미를 직접 부르지 않는다, 7.6). 같은 `inOrder`의 앞뒤 글자(`'if (!again) return plain;'`, `'if (repeat) return pile.includes(selectedId) && …'`)와 이 앵커의 나머지 줄(:497-523)은 그대로 통과해야 한다 |
| `tests/backgroundDatabaseContract.test.ts:110`, `:175` | 두 파일을 두 번씩 / 종류 아홉 | 세 파일을 두 번씩 / `BACKGROUND_SYMBOL_KINDS` (4.4) |

**손대지 않고 통과해야 하는 것**: `tests/backgroundMapGeometry.test.ts:217-255`(카메라 생성점과 소속), `tests/backgroundMapStack.test.ts` 전부(도로가 없는 도면의 순서), `tests/backgroundMapPlanPreview.test.ts:317-320`·`:331-333`(방의 읽어 주는 값, 종류 이름 표), `tests/backgroundMap3dScene.test.ts:119-162`(방의 벽), `:793-848`(자원 해제), `:886-896`(`mapGizmoSetup`의 두 인자 호출), 같은 파일의 기존 누름 테스트 전부(`pickMapNode`·`pickMapFloor`·`mapFloorPile`·`resolveMapClick`·`mapClickAim`과 뷰포트의 클릭·더블클릭·손잡이 클릭 :1834-2183 — 도로가 없는 도면과 `map` 없이 부르는 호출의 결과는 그대로다. 설계 때 임시 복사본에서 61개 모두 통과함을 보았다, 7.6), `:1141-1147`·`:1774-1776`(기즈모의 손잡이), `tests/backgroundMapPlanSelect.test.ts`의 기존 것 전부(10.3의 둘을 더하기만 한다), `tests/backgroundDatabaseContract.test.ts:34-75`(3D 파일의 정적 검사)와 `:376-420`, `tests/backgroundStore.test.ts`의 기존 열 개(:95-102에는 5.5의 한 줄만 더한다), `tests/backgroundAccess.test.ts`, 앵커 1~25·27~30·32~39(앵커 26과 31은 위 표대로 글자 한 곳씩만 바뀐다).

### 10.2 `tests/backgroundDomain.test.ts`에 더하는 것

- **새 모양 왕복**: 계단, 도로(사각형·다각형), 색 여섯 카메라, 평범한 셋을 한 도면에 넣어 `applyBackgroundCommand`로 저장 → 보낸 그대로. 평범한 노드에 `surface`·`color`가 없다. `validateBackgroundSnapshot` 통과. 이름만 바꾼 저장과 `save-maps` 묶음에서도 그대로.
- **값 검사**: `surface` — `'river'`·`'room'`·`''` → `/공간 종류/`이고 `BackgroundUnsupportedError`. `null`·`undefined`·`true`·`1`·`[]`·`{}` → `/공간 종류/`이고 그 클래스가 아니다. `color` — `'purple'`·`'amber'`·`'#ff0000'`·`''` → `/카메라 색/`(모르는 값). `null`·`undefined`·`7`·`true`·`[]`·`{}` → `/카메라 색/`(잘못된 값).
- **잘못 붙은 키**: 카메라·기호의 `surface`, 공간·기호의 `color` → `/속성/`.
- 5.5의 오류 종류 검사.
- `BACKGROUND_SPACE_SURFACES`가 `['road']`, `BACKGROUND_CAMERA_COLORS`가 여섯 이름 그대로(순서까지)이고 `purple`·`amber`가 없다.

### 10.3 `tests/backgroundMapStack.test.ts` · `backgroundMapGeometry.test.ts` · `backgroundMapPlanSelect.test.ts`에 더하는 것

기존 시험 도면(`building()`: `closet`·`room`·`site`·`floor`)에 도로 둘을 더한다 — `street = space('street', 0, 300, 1000, 80, { surface: 'road' })`(넓이 80000), `lane = space('lane', 480, 0, 40, 680, { surface: 'road' })`(27200).

- `stackedSpaces`(배열 순서를 섞어도): `['street', 'lane', 'site', 'floor', 'room', 'closet']` — 도로가 맨 아래, 도로끼리는 큰 것이 아래.
- **작은 도로도 큰 방 아래다**: `patch = space('patch', 0, 0, 10, 10, { surface: 'road' })`와 `site` → `['patch', 'site']`(어느 순서로 주든).
- `spaceStackRanks`: `street 0, lane 1, site 2, floor 3, room 4, closet 5`.
- `spacesAt((490, 340))`: `['room', 'floor', 'site', 'lane', 'street']`. `spacesAt((490, 20))`(방 `floor` 밖, `site`·`lane` 안): `['site', 'lane']`. 도로만 있는 도면 `[street, lane]`의 (490, 340): `['lane', 'street']`.
- 넓이가 `NaN`인 도로는 도로 층의 맨 아래이고 방보다 위로 오지 않는다.
- 받은 노드 그대로 돌려주고 `map.nodes`를 바꾸지 않는다(기존 검사와 같은 꼴).

`spacesOverlap`(같은 파일. `space(id, x, y, width, height, 바꿀 값)` 꼴로 적는다. `길` = 도로 (0, 300, 1000×80). **줄마다 두 인자를 바꿔 불러도 같은 값**이어야 한다):

| 방(또는 다른 공간) | 도로 | 결과 | 지키는 것 |
|---|---|---|---|
| (25, 380, 150×150) — 길의 아래 변에 붙었다 | 길 | 거짓 | 변만 맞닿은 것은 겹친 것이 아니다 |
| (25, 379.99999999999994, 150×150) — 반올림 한 걸음만큼 파고듦 | 길 | 거짓 | 겹친 길이의 여유 |
| (39.999999999, 100, 100×100) — 10억분의 1만큼 옆으로 파고듦 | 도로 (0, 0, 40×680) | 거짓 | 띠 폭의 여유 |
| (25, 379.99, 150×150) — 0.01만큼 걸침 | 길 | **참** | 조금이라도 걸치면 겹친 것 |
| (300, 200, 200×150) | 도로 (0, 0, 1000×680) | 참 | 도로 안에 통째로 |
| (0, 300, 100×80) — 길 안에서 세 변이 길의 변 위 | 길 | 참 | 변을 함께 쓰면서 겹침 |
| (0, 300, 1000×80) — 윤곽이 같다 | 길 | 참 | 같은 윤곽 |
| (0, 0, 2×2) | 도로 (1, 0, 2×2) | 참 | 같은 폭으로 반씩 걸친 둘(어느 모서리도 상대 안에 있지 않고 모두 상대의 변 위다) |
| (1000, 380, 100×100) — 모서리 하나만 닿음 | 길 | 거짓 | 모서리 |
| (25, 500, 150×150) | 길 | 거짓 | 떨어져 있음 |
| (400, 0, 200×680) — 길을 가로지른다 | 길 | 참 | 십자(어느 모서리도 상대 안에 없다) |
| 마름모 (100, 380, 100×100, 점 `(0.5,0)(1,0.5)(0.5,1)(0,0.5)`) — 꼭짓점이 길에 닿음 / 같은 것을 y 370으로 | 길 | 거짓 / 참 | 다각형의 꼭짓점 |
| 타원 (100, 380, 200×100) / y 375 | 길 | 거짓 / 참 | 타원(48각형) |
| 45° 돌린 (100, 400, 150×150) / y 460 | 길 | 참 / 거짓 | 회전 |
| ㄱ자 (900, 200, 300×300, 점 `(0,0)(1,0)(1,1)(0.4,1)(0.4,0.3)(0,0.3)`) — 길의 끝을 감싸고 돈다 | 도로 (0, 300, 1010×80) | 거짓 | 상자는 겹치지만 모양은 겹치지 않음 |
| ㄷ자 (0, 0, 300×300, 점 `(0,0)(1,0)(1,1)(0.7,1)(0.7,0.3)(0.3,0.3)(0.3,1)(0,1)`) | 도로 (90, 90, 120×210) — 그 홈 안 | 거짓 | 오목한 모양 |
| 비스듬한 띠 (500, −50, 220×1000, 점 `(0,0)(20/220,0)(1,1)(200/220,1)`) | 도로 (−1000, 0, 2000×10) | 참 | 두 윤곽이 **꼭짓점 사이에서만** 만난다 — 변끼리 만나는 점의 x를 띠의 경계로 넣지 않으면 놓친다 |
| 나비넥타이 (0, 0, 300×100, 점 `(0,0)(1,1)(1,0)(0,1)`) — 스스로 엇갈린 방이 도로 안에 통째로 들어 있다 | 도로 (−100, −100, 500×300) | 참 | 스스로 엇갈린 윤곽 — **한 윤곽의 변끼리** 만나는 점의 x도 띠의 경계로 넣어야 한다(그 방이 걸친 띠가 하나뿐이고 그 한가운데 x 150이 엇갈린 점이다. `containsPoint`는 (75, 50)과 (225, 50)을 그 방 안으로 센다) |
| (25, 300, `NaN`×150) | 길 | 거짓 | 유한하지 않은 윤곽 |

(나비넥타이 줄은 일관성 검토에서 더했다. 그 줄을 뺀 21줄은 설계 때 임시 구현에서, 22줄 전부는 고친 블록을 저장소의 `nodePlanOutline`에 물려 양쪽 순서로 통과함을 보았다, 7.6.)

`addMapCamera`(생성점 (500, 340). 기존 `room`·`far`·`hall`에 `street`·`lane`을 같은 값으로):

| 도면 | 소속 |
|---|---|
| `[street]` | `'street'` |
| `[street, room]`, `[room, street]` | `'room'` |
| `[street, lane, room]` | `'room'` |
| `[street, room, hall]` (방 둘) | `null` |
| `[street, lane]` (도로 둘) | `null` |
| `[far, street]` | `'street'` |

`setSpaceSurface`: 방 → 도로는 `surface: 'road'`가 생기고 다른 키는 `deepEqual`. 도로 → 방은 `Object.hasOwn(next, 'surface')`가 거짓이고 `volumeHeight` 등은 그대로. 같은 값이면 받은 객체(`===`) — **키가 없는 것에 `null`을 주는 경우를 따로 적는다**: `setSpaceSurface(방, null) === 방`(`surface` 키가 없는 방), `setSpaceSurface(도로, 'road') === 도로`. 잠긴 공간은 받은 객체. 받은 객체를 고치지 않는다. `setCameraColor`: 같은 넷(색 → 다른 색, 색 → `null`로 키가 사라짐, 같은 값 `===`, 잠김 `===`)에 더해 **`setCameraColor(색 없는 카메라, null) === 그 카메라`**. (`node.key === 받은 값`으로만 견주는 구현은 `undefined !== null`이라 이 두 줄에서 새 객체를 돌려준다 — 편집기의 두 호출자 `changeSpaceSurface`·`changeCameraColor`는 "같은 객체가 돌아오면 아무것도 하지 않는다"에 기대어 빈 되돌리기 단계를 막으므로(3.3·7.3·8.2), 이 두 줄이 없으면 그 계약이 깨져도 나머지 경우가 모두 통과한다.)

`applyNodeWorldPose`(자세의 `position`·`quaternion`은 `nodeWorldPose(도로)`의 것 그대로, `scale`만 바꾼다): 도로(`volumeHeight` 없음)에 `scale: { x: 1, y: 3, z: 1 }` → 받은 도면 그대로(`===`). `scale: { x: 2, y: 3, z: 1 }` → **`x`와 `width`가 함께 바뀐다**(기즈모의 뿌리가 바닥 가운데라 가운데가 제자리에 남는다, mapGeometry.ts:314-319 — `width`는 두 배, `x`는 `road.x − road.width / 2`). `y`·`height`는 그대로이고 **`volumeHeight` 키는 생기지 않는다**: `assert.deepEqual(next, { ...road, x: road.x - road.width / 2, width: road.width * 2 })`와 `assert.equal(Object.hasOwn(next, 'volumeHeight'), false)`("`width`만 바뀐다"로 견주면 실패한다). `volumeHeight: 240`이 저장된 도로에 `y: 3`(가로·세로는 1) → 받은 도면 그대로이고 240이 남는다. 같은 자세를 방에 주면 지금처럼 `volumeHeight`가 바뀐다(`{ x: 1, y: 3, z: 1 }` → 540).

`rectToPolygon(도로)`·`polygonFromWorldPoints(도로, …)`·`transformMapSpace`로 옮긴 도로가 `surface`를 그대로 갖는다.

`resolvePlanPress`(`tests/backgroundMapPlanSelect.test.ts` — 큰 방 안의 도로, 7.7. 이 함수는 고치지 않는다. 지금의 규칙이 도로에 어떻게 나타나는지를 고정한다): 맨 위 노드가 방 `yard`, 더미가 `['yard', 'inner']`(`inner`는 도로), 선택이 `inner` 하나, 편집 중, Shift 없음.

| `again` | 끌면 | 누르는 순간 | 놓으면(움직이지 않았을 때) |
|---|---|---|---|
| 거짓(도로를 방금 그렸거나 목록에서 골랐다) | `drag: 'move'`, `nodeId: 'yard'` — **방이 움직인다** | `selectAtPress: 'yard'` | `click.kind: 'none'` |
| 참(그 자리를 눌러 도로까지 내려온 뒤) | `drag: 'move'`, `nodeId: 'inner'` — 도로가 움직인다 | `selectAtPress` 없음 | `click`이 `{ kind: 'step', ids: ['yard', 'inner'], from: 'inner', spaces: true }` |

### 10.4 `tests/backgroundMapElements.test.ts` (새) — 기호 목록과 도로

- `getSymbolPreset`: `'desk'`·`'sofa'`·`'cabinet'`·`'plant'` → `id`가 `'custom'`. `'stairs'` → `{ id: 'stairs', label: '계단', width: 120, height: 240 }`. 모르는 문자열(`'piano'`) → `'custom'`. `symbolCatalog`의 `id` 순서가 `['door','chair','table','bed','stairs','custom']`.
- `isRoadSpace`: `surface: 'road'`만 참. 키가 없으면 거짓. `spaceWallHeight`: 방 → `nodeVolumeHeight`와 같다(없으면 180, 있으면 그 값). 도로 → 0(`volumeHeight: 400`이 있어도).
- `roadCentreLine`: **7.4의 표에 적은 줄 전부**(값은 1e-9 안에서). 가로가 `NaN`·0인 도로 → `null`. 표의 줄마다 띠 규칙의 어느 조건을 지키는지가 정해져 있다 — 그 조건을 빼거나 바꾼 구현이 그 줄에서 실패한다(설계 중 스크립트로 조건을 하나씩 빼 보아 확인했다):

  | 뺀·바꾼 것 | 실패하는 줄(그 구현이 내는 값) |
  |---|---|
  | (가) 볼록 검사를 뺌 | 나비넥타이(`[(-150,0),(150,0)]`), 십자(`[(-60,-105),(-45,-105),(-45,0),(45,0),(45,105),(60,105)]`) |
  | (나) 각 검사를 뺌 | 크게 어긋난 짝 둘(`[(-200,0),(0,0),(200,0)]` 등), 끝이 뾰족한 길 |
  | (나)의 60°를 45°로 | 51° 어긋난 짝(`(…)(0.45,1)(0,1)` → `[(-200,0),(-60,0),(200,0)]`) |
  | (나)의 60°를 80°로 | 두 번 꺾인 길(72° → `null`), 68° 어긋난 짝(`null`) |
  | (나)를 양 끝 가로대에도 씀 | ∧ 모양(`null`), 비스듬한 길(`null`) |
  | (나)의 각을 앞뒤 구간 하나하나와 잼 | ㄱ자(`null`), 두 번 꺾인 길(`null`) |
  | (다) 길이 검사를 뺌 | 100×300 네 점(`[(-50,0),(50,0)]`), 두 끝 변에 점을 더한 것(`[(0,-50),(0,0),(0,50)]`), 200×160 육각형 |
  | (라) 안쪽 검사를 뺌 | 뒤엉킨 여덟 점(`[(-45,-105),(-75,45),(60,45),(-45,-90)]`) |
  | "가장 작은 시작 번호"를 "가장 큰 것"으로 | 200×200 네 점(`[(0,-100),(0,100)]`) |

- **성질**: 표에서 선이 나온 모든 줄에 대해 `roadCentrePlanLine`의 구간 가운데 점마다 `containsPoint(space, 점)`이 참(돌린 것 포함: 회전 0·37·90·250). 그리고 **돌려도 결과가 같다**: `roadCentreLine`은 `rotation`을 읽지 않는다(같은 공간에 회전 0·37·90·250을 주어 `deepEqual`).
- `roadCentrePlanLine`: (100, 100, 300×100) 도로 → `[(100,150),(400,150)]`. 90° 돌리면 `[(250,0),(250,300)]`(1e-9).

### 10.5 `tests/backgroundMapPlanPreview.test.ts` · `backgroundSpatial.test.ts`에 더하는 것

- `planKindLabel`: 도로 `'도로'`, 방 `'공간'`, 기호 `'기호'`, 카메라 `'카메라'`. `planNodeLabel(도로)` → `'이름, 도로'`.
- `planVolumeReadout(도로)`: `kind: '도로'`, `items`가 바닥 높이 한 줄뿐. `planNodeSummary(도로)` → `'이름 · 바닥 높이 0'`.
- `planSideView`: 도로(바닥 0, `volumeHeight: 400` 저장)만 있는 도면의 결과가 **공간이 없는 도면의 결과와 같다**(400이 범위에 들지 않고 기본 눈금이 쓰인다). 카메라가 그 도로에 속해도 `room`이 `null`. 바닥 300인 도로는 범위를 300까지 넓힌다. 방과 도로가 함께 있으면 방만 있을 때와 같은 결과(도로 바닥이 방의 범위 안일 때).

### 10.6 색 표와 CSS (`tests/backgroundMapElements.test.ts`)

- `MAP_CAMERA_COLORS.map(item => item.id)`가 `BACKGROUND_CAMERA_COLORS`와 같다(순서까지). 화면 이름 여섯이 서로 다르고 비어 있지 않다.
- `cameraColorHex('red', false)` → `0xf2726b`, `('red', true)` → `0xc2362f`, 여섯 모두 표의 값. 표에 없는 이름(`'purple' as BackgroundCameraColor`) → `null`.
- **CSS와 한 벌**: `backgrounds-map.css`를 글자로 읽어, 색마다 `.bmap-layout [data-camera-color="<이름>"] { --bmap-cam:<어두운 값의 숫자 셋>; }`과 `[data-color-mode="light"] .bmap-layout [data-camera-color="<이름>"] { --bmap-cam:<밝은 값의 숫자 셋>; }`이 있다(숫자 셋은 표의 값에서 계산). `data-camera-color="purple"`·`"amber"` 규칙이 없다. 기본값 `--bmap-cam:230 181 120`과 `--bmap-road:154 161 173`·`--bmap-road-mark:227 230 236`이 있고, 뒤의 둘은 `MAP3D_DARK_PALETTE.road`·`roadMark`와 같은 색이다. (도로의 두 값을 보는 검사는 그 변수와 팔레트가 생기는 5단계에서, 카메라의 것은 6단계에서 넣는다 — 13절. 아래 표에서는 라·마·바가 5단계, 가·나·다·사가 6단계다.)
- **규칙이 그 변수를 실제로 쓴다** (위의 검사는 변수가 **정의됐는지**만 본다. 정의만 되고 쓰이지 않아도 다른 자동 테스트가 모두 통과하므로, 두 CSS 파일을 글자로 읽어 아래를 본다 — 줄은 `/\r?\n/`으로 나눈다):

  | # | 보는 것 | 막는 것 |
  |---|---|---|
  | 가 | `backgrounds-map.css`에서 `.bmap-camera`로 시작하는 줄과 `.bmap-handles .bmap-camera-`로 시작하는 줄(그런 줄이 열 개 이상이다)에 `#e6b578`·`#372715`가 **없고**(대소문자 무시, 뒤에 투명도 두 자리가 붙은 꼴 포함), 그 줄들을 이은 글자에 `var(--bmap-cam)`과 `var(--bmap-cam-mark)`가 있다 | 호박색 글자 하나가 남아 색 카메라의 그 부분만 호박색으로 남는 것. (`.bmap-node-kind.is-camera`·`.bmap-toolbar-camera`·눌린 버튼 테두리의 호박색 글자는 이 줄들이 아니다 — 그대로 둔다, 8.3) |
  | 나 | `backgrounds-map-plan.css`에 `.bmap-plan-preview [data-camera-color] {`로 시작하는 줄이 하나 있고, 그 줄에 `--bmap-plan-cam:`·`--bmap-plan-cam-line:`·`--bmap-plan-cam-edge:`·`--bmap-plan-cam-soft:` 넷이 모두 있으며 `var(--bmap-cam)`이 있다 | 보조 평면도가 색을 무시하는 것(속성은 달려 있어 앵커 45는 통과한다) |
  | 다 | `backgrounds-map.css`에서 `.bmap-node-kind.is-camera[data-camera-color]`의 자리가 `[data-color-mode="light"] .bmap-node-kind.is-camera`의 자리보다 **뒤**다(`indexOf`) | 특이도가 같은 밝은 화면 규칙이 뒤에서 이겨, 밝은 화면의 목록 아이콘이 `#a8701f`로 남는 것 |
  | 라 | `backgrounds-map.css`의 `.bmap-road-line {` 줄과 `backgrounds-map-plan.css`의 `.bmap-plan-road-line {` 줄이 각각 하나 있고 둘 다 `fill:none`과 `vector-effect:non-scaling-stroke`를 담는다 | 규칙이 빠지거나 클래스 이름이 어긋나 꺾인 가운데 선이 검게 채워지는 것(SVG의 기본 채움). 속성 `fill="none"`(7.4·7.5)이 둘째 막음이고 앵커 41이 본다 |
  | 마 | `backgrounds-map.css`의 `.bmap-space.is-road text {` 줄에 `stroke-width:calc(4px * var(--bmap-label-scale,1))`이 있다 | 테두리 굵기가 고정값 4로 돌아가, 축소한 도면에서 점선이 이름을 긋는 것(7.4) |
  | 바 | `backgrounds-map-plan.css`에서 `.bmap-plan-space.is-road>polygon`의 자리가 `.bmap-plan-node:focus-visible>polygon`의 자리보다 **앞**이고, 도로의 hover 규칙이 `.bmap-plan-space.is-road:hover:not(:focus-visible)>polygon` 꼴이다(`.bmap-plan-space.is-road:hover>polygon`이 없다) | 포커스를 받은 도로의 포커스 테두리가 도로 규칙에 지는 것(9.4) |
  | 사 | `backgrounds-map.css`에 `.bg-library .bmap-color-swatch:focus-visible { outline-offset:5px; }`가 있다 | 포커스 고리가 눌림 고리를 덮는 것(8.2) |

### 10.7 `tests/backgroundMap3dScene.test.ts`에 더하는 것

- **계단**: 높이 180(기본) → `stairs-step` 메시 10개, 몸통 크기 `[가로, 180, 세로]`. 높이 20·54 → 3단, 63 → 4단, 288·1000 → 16단. 단의 높이(`scale.y`)가 `1/N … 1`로 오르고, 가장 높은 단의 세계 z가 가장 낮은 단보다 **작다**(평면 위쪽으로 오른다). 90° 돌리면 오르는 쪽도 돈다. 모든 단의 geometry가 다른 기호의 상자와 같은 객체다. `pickTargets`에 단 전부(`pickPart: 'solid'`)와 대리 상자(`'box'`)가 있다. 선택하면 `selection-outline`이 생긴다. 계단이 든 장면을 `dispose`하면 자원 수가 모두 0.
- **도로**: `space-floor`·`space-outline`이 있고 **`space-walls`가 없다**. 사각형 도로에 `road-centre`(꼭짓점 2), ㄱ자 도로에 꼭짓점 4, 타원 도로에는 없다. 바닥의 `renderOrder`가 −1.5이고 방은 −1. 모든 꼭짓점의 높이가 바닥 높이다(`elevation: 30`이면 30). `pickTargets`에 도로의 것은 바닥 하나(`pickPart: 'floor'`). 선택하면 바닥 재질의 불투명도가 커지고 테두리가 방의 선택 테두리와 같은 재질. 잠그면 테두리가 점선 재질이고 `lineDistance`가 있다. 방 → 도로로 바꿔 다시 맞추면 벽이 사라지고, 되돌리면 돌아온다(뿌리 객체는 같다).
- **누름** (7.6. 맞춤은 기존 테스트의 `hit(nodeId, pickPart, distance, nodeKind)` 꼴로 만든다 — `point`가 없다. 방과 도로가 겹치는지는 `map`에 든 모양에서 나온다. 도면의 조각: `도로` = 도로 (0, 0, 1000×680), `방` = (300, 200, 200×150) — 도로 위, `큰 방` = (100, 100, 700×500) — 도로 위이고 방을 품는다, `둘째 방` = (600, 400, 100×100) — 도로 위, `옆 방` = (0, 680, 300×100) — 도로의 아래 변에 붙었다(겹치지 않는다), `골목` = 도로 (480, 0, 40×680) — 방과 겹친다, `먼 골목` = 도로 (900, 0, 40×680) — 방과 겹치지 않는다. **카메라·기호가 나오는 줄의 `map`에는 그 카메라·기호 노드도 들어 있다**(없으면 `mapSpacePile`의 "공간인가" 검사를 빼도 그 줄이 통과한다)):

  | `map` | 맞춤(가까운 것부터) | `pickMapNode(hits, map)` | `mapSpacePile(hits, map)` | 그 밖 |
  |---|---|---|---|---|
  | 도로, 방 | 같은 거리의 바닥 둘(도로·방) | 방 (도면 순서를 바꿔도, 도로가 방 안의 작은 조각 (350, 250, 20×20)이어도) | `[방, 도로]` | `pickMapFloor` → 방. `mapFloorPile` → `[방, 도로]` |
  | 도로, 방 | **방의 벽(가깝다), 도로 바닥(멀다)** — 방이 도로 위에 서 있다 | **방** | **`[방, 도로]`** | `map` 없이 부르면 도로(지금의 결과). `mapFloorPile` → `[도로]`, `pickMapFloor` → 도로(둘 다 고치지 않았다). `resolveMapClick(map, 방, hits, true)` → **도로**, `(map, 도로, hits, true)` → 방. `again`이 거짓이면 선택이 방·도로·`null` 어느 것이든 방. `again`·`repeat`이 모두 참이면 선택 그대로(방 → 방, 도로 → 도로). `mapClickAim(map, 방, hits, true)` → 방, `(map, 도로, hits, true)` → 도로, `(map, 도로, hits, false)` → 방 |
  | 도로, 옆 방 | **옆 방의 벽(가깝다), 도로 바닥(멀다)** — 방이 도로 옆에 서 있다 | **도로** | **`[도로]`** | v1.132.0의 벽 규칙 그대로다: 선택이 옆 방·도로·`null` 어느 것이든, `again`이 참이든 거짓이든 `resolveMapClick` → 도로 |
  | 도로, 골목, 방 | 방의 벽, 같은 거리의 도로 바닥 둘(도로·골목 — 둘 다 방 밑) | 방 | `[방, 골목, 도로]` | 그 셋을 선택으로 `resolveMapClick(…, true)` → 차례로 골목, 도로, 방 |
  | 도로, 먼 골목, 방 | 방의 벽, 같은 거리의 도로 바닥 둘(도로 — 방 밑, 먼 골목 — 방 옆) | **먼 골목** | `[먼 골목, 도로]` (`mapFloorPile`과 같다) | 방 밑의 도로만 빠지고, 남은 도로의 바닥이 벽을 이긴다 |
  | 도로(`elevation: 200`), 방 | **올린 도로의 바닥(가깝다), 방의 바닥(멀다)** — 겹친다 | **방** | `[도로, 방]` (`mapFloorPile`과 같다) | `pickMapFloor` → 도로(고치지 않았다). `resolveMapClick(map, 방, hits, true)` → 도로, `(map, 도로, hits, true)` → 방, `again`이 거짓이면 어느 쪽에서든 방 |
  | 도로(`elevation: 200`), 옆 방 | 올린 도로의 바닥(가깝다), 옆 방의 바닥(멀다) — 겹치지 않는다 | **도로** | `[도로, 옆 방]` | 가까운 높이의 바닥이 먼저 — 지금 그대로 |
  | 도로, 골목, 방 | 도로 바닥 하나 | 도로 | `[도로]` | |
  | 도로, 골목, 방 | 도로 바닥 둘(같은 거리: 도로·골목) | 골목(작은 도로) | `[골목, 도로]` | |
  | 도로, 큰 방, 방 | 방의 벽, 큰 방의 바닥, 도로 바닥 | 큰 방 (방끼리의 규칙 그대로) | `[큰 방, 도로]` — 벽으로만 맞은 방은 들지 않는다 | `resolveMapClick(map, 방, hits, true)` → 큰 방(넘어간 것이 아니라 고른 것), `(map, 큰 방, hits, true)` → 도로 |
  | 도로, 둘째 방, 방 | 두 방의 벽(둘째 방이 가깝다 — 둘 다 도로 위), 도로 바닥 | 둘째 방 | `[둘째 방, 도로]` | |
  | 도로, 옆 방, 방 | 두 방의 벽(옆 방이 가깝다 — 뒤의 방만 도로 위), 도로 바닥 | 옆 방 | `[옆 방, 도로]` | 도로는 뒤의 방 때문에 빠지고, 남은 벽 가운데 가까운 것이 잡힌다(14.4) |
  | 도로, 방 | 방의 벽만 | 방 | `[]` | |
  | 도로, 방, 기호, 카메라 | 기호의 대리 상자(`'box'`), 도로 바닥 / 카메라, 도로 바닥 | 기호 / 카메라 | `[도로]` | |
  | 도로, 방, 기호, 카메라 | 기호의 대리 상자, 방의 벽, 도로 바닥 / 카메라, 방의 벽, 도로 바닥 | 기호 / 카메라 | `[도로]` — 위의 것이 잡히면 방을 넣지 않는다 | |
  | 큰 방, 방 (도로가 **없다**) | 방의 벽, 큰 방의 바닥 | 큰 방 | `[큰 방]` | `resolveMapClick(map, 방, hits, true)` → 큰 방 — v1.132.0과 같다 |
  | 어느 것이든 | 빈 맞춤 | `null` | `[]` | |

  장면으로 본다(기존 `cast(scene, 원점, 방향)`·`viewerFor`, :316-319의 `aim`):

  1. **넓은 도로 위의 건물**: 도로(0, 0, 1000×680) 위에 방(300, 200, 200×150, 높이 180). `cast(scene, [400, 300, 800], [0, -300, 180 - 800])` — 방의 벽을 지나 방 밖의 도로 (400, 180)에 닿는다(맞춤에 그 방의 `'wall'`만 있고 `'floor'`가 없으며 도로의 `'floor'`가 있음을 먼저 확인한다) → `pickMapNode(hits, map)`이 방, `mapSpacePile`이 `[방, 도로]`. 그 도로의 `surface`를 지운 같은 장면에서는 `pickMapNode`가 큰 공간이고 `mapSpacePile`이 `[큰 공간]`이다(방끼리의 규칙, 지금 그대로).
  2. **길가의 건물 — 길에 붙여 세웠다** (7.6에서 잰 도면): 길 = 도로 (0, 300, 1000×80). 눈 쪽 건물 다섯 = 방 (25 + 200·i, 380, 150×150), 먼 쪽 건물 다섯 = 방 (25 + 200·i, 150, 150×150), i = 0…4, 높이는 기본 180(변만 길과 맞닿는다). 보는 곳은 `viewerFor(fitMapView(map, 1.6), 1.6)`.
     - 길 한가운데 (500, 0, 340)을 겨눈 광선: 맞춤에 든 노드가 눈 쪽 셋째 건물(`'wall'`만)과 길(`'floor'`만) 둘뿐임을 먼저 확인한다 → **`pickMapNode`가 길**, `mapSpacePile`이 `[길]`. `resolveMapClick(map, 선택, hits, true)`가 선택 `null`·그 건물·길 어느 것에서든 길.
     - 길 위의 표본 392점(`x = 9 + 17.85·ix`, `ix` 0…55, `z = 306 + 11.3·iz`, `iz` 0…6)을 겨눈 광선마다: **처음 잡히는 것이 길**이고 `mapSpacePile`이 `[길]`이다. 그 가운데 눈 쪽 건물의 `'wall'` 맞춤이 든 점이 절반(196)을 넘는다(설계 때 371점 — 수를 글자로 고정하지는 않는다. 이 조건이 없으면 "벽 뒤의 길"을 하나도 보지 않고 통과할 수 있다). 같은 392점을 `viewerFor(topDownMapView(map, 1.6), 1.6)`에서 겨누어도 모두 길.
  3. **같은 도면에서 눈 쪽 건물 다섯을 길 쪽으로 1만큼 옮긴 것**(y 379 — 길과 겹친다): 같은 392점에서 처음 잡히는 것이 길이거나 눈 쪽 건물 하나다. 건물인 **모든** 점에서 그 건물의 맞춤이 `'wall'`뿐이고, `mapFloorPile`이 `[길]`, `mapSpacePile`이 `[그 건물, 길]`, `resolveMapClick(map, 그 건물, hits, true)`가 길, `(map, 길, hits, true)`가 그 건물. 길인 점과 건물인 점이 모두 있고 건물인 점이 더 많다(설계 때 21점 / 371점). 길 한가운데의 광선: `pickMapNode`가 눈 쪽 셋째 건물, `resolveMapClick(map, 선택, hits, true)`가 선택 `null`·그 건물·길에서 차례로 그 건물·**길**·그 건물.
- **뷰포트 — 건물 벽 너머의, 그 건물 밑 도로**(기존 `mountViewport`·`clickNth`·`partsUnder`·`selects`·`opened`, :1866-1893. 위 1의 도면(건물에는 상세 도면이 없다), 창은 `mountViewport`의 기본 크기 800×500. 누르는 점은 `editor.at(400, 0, 180)`이고, `partsUnder`로 건물이 `{'wall'}`, 도로가 `{'floor'}`임을 먼저 확인한다. `canEdit: false`):
  - 천천히 세 번(`clickNth` 세 번) → 선택이 건물 → **도로** → 건물.
  - 빠른 두 번(`detail` 1, 2)과 `dblclick` → `selects`가 `[건물, 건물]`, `opened`가 `[건물]`. 도로에 상세 도면(`childMapId`)을 연결한 도면에서도 `opened`가 `[건물]`이다(도로의 id가 아니다).
  - 도로에 상세 도면을 연결한 도면에서 천천히 두 번 눌러 도로까지 내려간 뒤 그 점을 더블클릭(`detail` 1, 2, `dblclick`) → `opened`가 `[도로]`.
  - 도로를 고른 채 연(`selectedId: 도로`) 뷰포트에서 그 점을 처음 누르면 건물.
  - `viewport.topDown()`·`editor.frame()` 뒤 `editor.at(400, 0, 120)`(건물에서 떨어진 도로 위의 점 — `partsUnder`로 건물의 맞춤이 없음을 먼저 확인한다)을 누르면 도로. (위에서 보아도 (400, 0, 180)은 원근 때문에 여전히 건물의 벽 뒤다 — 그 점을 쓰지 않는다.)
- **뷰포트 — 건물 옆의 도로**(위 2의 도면에서 길에 상세 도면을 연결한 것. 누르는 점은 `editor.at(500, 0, 340)`이고, `partsUnder`로 눈 쪽 셋째 건물이 `{'wall'}`, 길이 `{'floor'}`임을 먼저 확인한다. `canEdit: false`): 천천히 세 번 → `selects`가 `[길, 길, 길]`(벽 뒤의 자리에서도 처음부터 길이고, 넘어갈 것이 없다). 이어서 빠른 두 번과 `dblclick` → `opened`가 `[길]` — 건물 옆의 도로는 벽 너머에서도 더블클릭 한 번에 그 도로의 상세 도면이 열린다.
- **뷰포트 — 손잡이 위의 클릭**(위 1의 도면, 편집 중. `BackgroundMap3D.tsx`:562의 동작은 이 테스트만 지킨다 — 순수 함수 테스트와 위의 뷰포트 테스트들은 그 줄이 `mapFloorPile`로 남아도 통과한다(설계 때 그 변형이 이 테스트 하나에만 걸림을 보았다). 글자는 앵커 49가 본다): 누르는 점은 `editor.handle(건물, 'Y', 0.3)`(옮기기 기즈모의 위쪽 화살표 위의 점. 건물을 고른 뷰포트에서 한 번 구해, 같은 기본 보기의 뷰포트들에 쓴다. `partsUnder`로 건물 `{'wall'}`, 도로 `{'floor'}`를 먼저 확인한다). 그 점을 `clickNth`로 누르면 건물이 잡힌다. `editor.frame()`·`editor.move(점)` 뒤 `editor.dev().transform.axis`가 `'Y'`임을 확인하고(손잡이가 포인터 아래다) 같은 점을 한 번 더 누르면 `selects`가 `[건물, 도로]`이고 미리보기·되돌리기·취소 수가 모두 0이다(넘기기는 편집이 아니다). 건물을 고른 채 연(`selectedId: 건물`) 뷰포트에서 `editor.frame()`·`editor.move(점)`으로 같은 손잡이(`axis`가 `'Y'`)에 올린 뒤 처음 누르면 `selects`가 `[]`(②의 규칙 — 그 자리를 눌러 온 것이 아니면 손잡이는 아무것도 고르지 않는다).
- **범위**: 도로(`volumeHeight: 500` 저장)만 있는 도면의 `mapWorldBounds().max.y`가 0.
- **기즈모**: `mapGizmoSetup('space', 'scale', true)` → `showY: false`, `showX`·`showZ` 참. `('space', 'rotate', true)`·`('space', 'translate', true)`는 둘째 인자만 준 것과 같다. `('symbol', 'scale', true)`도 `showY: false`(값만 본다). 셋째 인자가 없으면 기존 결과 그대로.
- **`flat`이 손잡이까지 닿는다** (순수 함수만 보면 `setTarget`이 `target.flat`을 넘기지 않아도 통과한다 — 그러면 도로에 높이 손잡이가 남는다):
  - 하니스(기존 `gizmoHarness`, :1141-1147과 같은 꼴): `gizmo.setTarget({ id, type: 'space', root, flat: true }, 'scale')` 뒤 `[controls.showX, controls.showY, controls.showZ]`가 `[true, false, true]`. 같은 대상을 `flat` 없이 다시 주면 `[true, true, true]`. `flat: true`에 `'translate'`·`'rotate'`는 `flat` 없는 결과와 같다.
  - 뷰포트(기존 `mountViewport`, :1774-1776과 같은 꼴): 도로가 든 도면에서 `editor.render({ selectedId: 도로, gizmoMode: 'scale' })` → `transform.showY`가 거짓, `showX`·`showZ` 참. 그 도로를 방으로 되돌린 도면을 다시 주면(`surface` 키를 지운 같은 노드) `showY`가 참. 방을 고르면 처음부터 참.
- **카메라 색**: 어두운 팔레트에서 `color: 'red'`인 카메라의 몸통·시선·화면 틀·바닥 고리 재질의 색이 `0xf2726b`이고 렌즈는 `palette.cameraLens`. 색이 없는 카메라는 `palette.camera`. 빨간 카메라 둘은 같은 재질 객체를 쓰고, 빨간 것과 색 없는 것은 다른 객체다. `setPalette({ ...MAP3D_DARK_PALETTE, light: true })` 뒤 빨간 카메라는 `0xc2362f`(이전 재질은 모두 해제). 색을 `'blue'`로 바꿔 다시 맞추면 그 카메라가 다시 만들어지고 `0x63a9f7`. 선택하면 선의 불투명도가 0.6 → 1. `dispose`가 색 재질까지 **한 번씩** 해제하고 자원 수가 0(기존 :829-848의 장면에 색 카메라를 더한다).
- **도로 색은 테마의 CSS 변수에서 온다**(기존 뷰포트 테스트 'viewport: theme changes repaint…' :2456-2466에 더한다. 장면 테스트만으로는 `readPalette`가 `road`·`roadMark`를 `base`에서 채워도(CSS 변수를 읽지 않아도) 타입과 모든 테스트가 통과한다 — 테스트의 `getComputedStyle`은 모르는 변수에 빈 글자를 돌려주므로(:1313) 어두운 기본값이 그대로 나오기 때문이다. 그러면 밝은 화면에서 도로가 어두운 화면의 회색으로 남고, 그것은 수동 검증 C10만 볼 수 있다): 도면에 도로 하나(가운데 점선이 있는 사각형)를 넣고, `themeValues`에 `'--bmap-road': '93 100 112'`와 `'--bmap-road-mark': '58 63 71'`을 더한 뒤 변경 관찰자를 돌리고 한 프레임을 그린다 → 그 도로의 `space-floor` 재질 색이 `0x5d6470`, `road-centre` 재질 색이 `0x3a3f47`이다. `themeValues`를 비우고 다시 돌리면 `MAP3D_DARK_PALETTE.road`·`roadMark`(`0x9aa1ad`·`0xe3e6ec`)로 돌아온다.

### 10.8 `tests/backgroundPersistence.test.ts` · `backgroundPreview.test.ts`에 더하는 것

- 메인 저장소: 계단·도로·색 카메라가 든 도면을 그대로 넘기고(보낸 글자 그대로) 응답도 그대로 돌려준다. `surface: 'river'` → `/공간 종류/`, `color: 'purple'`·`color: null` → `/카메라 색/`, `symbol: 'elevator'` → `/사물 기호/`, 카메라의 `surface`·공간의 `color` → `/속성/` — SQL을 부르기 전에 멈춘다(호출 수 그대로).
- 미리보기: 새 모양이 든 도면을 저장하고 다시 열어도 그대로. 5.5의 읽기 오류 종류.

### 10.9 `tests/backgroundMapEditorWiring.test.ts` — 새 앵커

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| 40 | **도로 도구**: `type Tool`에 `'road'`. `isDrawTool`이 `'road'`를 센다. `pointerDown`에 `if (canEdit && (tool === 'rect' \|\| tool === 'ellipse' \|\| tool === 'road')) { mode = 'draw'; target = newSpace(tool === 'road' ? 'rect' : tool, point, tool === 'road'); }`. `newSpace`에 `name: road ? '새 도로' : '새 공간'`과 `...(road ? { surface: 'road' as const } : {})` | 도로 도구가 방을 그림 / `isDrawTool`에서 빠짐(3D로 가도 도구가 남는다) / `surface: road ? 'road' : undefined`로 씀(키가 `undefined`로 남아 저장이 거절된다) |
| 41 | **평면의 도로**: 공간을 그리는 줄에 `road = isRoadSpace(node)`, `${road ? 'is-road ' : ''}`, `rx={road ? 0 : 4}`, `<polyline className="bmap-road-line" fill="none"`가 있고 그 `<polyline`이 같은 `<g>`의 `<text`보다 **앞**이다. 편집기에 `stackedSpaces(current).map(`이 여전히 한 번이고 `shownIds.has(node.id)`가 셋. `backgrounds-map.css`에 `.bmap-space.is-road text {`로 시작하고 `paint-order:stroke`와 `var(--bmap-label-scale`을 담은 규칙(굵기의 글자 전체는 10.6의 마). **보조 평면도의 도로**: `BackgroundMapPlanPreview.tsx`의 `PlanShape`에 `isRoadSpace(`와 `is-road`가 있고, 그 안에서 `<polygon` **다음에** `<polyline className="bmap-plan-road-line" fill="none"`이 있으며(점은 `roadCentrePlanLine(`에서 온다), 그 파일에 `선택한 도로`가 있다. **도로의 말**: `kindLabel`에 `isRoadSpace(node) ? '도로' : '공간'`, 머리 글자에 `'선택한 도로'`, 목록 아이콘에 `'═'`, 편집기에 `둥근 도로에는 가운데 점선이 없어요.`와 `가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요.`가 있고 그 둘을 그리는 줄이 `isRoadSpace(selected) && !roadCentreLine(selected)` 아래다. `꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.`도 있다. `다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.`를 담은 상수 `ROAD_HINT`가 있고 `isRoadSpace(selected) ? ROAD_HINT :`로 쓰인다 | 도로를 따로 한 번 더 그림 / 점선을 `<polygon>`으로 그림(공간의 채움 규칙에 걸린다) / 점선을 이름 뒤에 그림·이름의 테두리 규칙을 뺌(이름에 줄이 그어진다) / 이름 테두리의 굵기를 고정값 4로 되돌림(축소한 도면에서 점선이 다시 이름을 긋는다) / `fill="none"` 속성을 뺌 / **보조 평면도가 도로를 방으로 그림**(클래스·가운데 점선·'선택한 도로'가 빠진다 — 편집기만 읽는 검사와 앵커 45는 통과한다) / 도로가 목록과 머리 글자에 '공간'으로 나옴 / 점선이 사라진 까닭의 안내가 빠짐 / 덮인 도로를 잡는 법의 안내가 빠짐 |
| 42 | **도로는 층으로 쌓인다**: `mapStack.ts`의 정렬 줄이 `a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area`이고 `layer: isRoadSpace(space) ? 0 : 1` | 층 항을 뺌 / 부호를 뒤집음 / 층을 넓이 뒤에 둠(큰 도로만 아래로 간다) |
| 43 | **있는 노드의 키는 순수 함수 둘만 바꾼다**(새 도로의 `surface`는 `newSpace`가 넣어 만든다 — 앵커 40): 편집기의 `changeSpaceSurface`에 `setSpaceSurface(selected, surface)`와 `updateMap(replaceMapNode(current, next))`, `changeCameraColor`에 `setCameraColor(selected, color)`와 같은 줄. 편집기에 `patchNode({ surface`·`patchNode({ color`·`surface: undefined`·`color: undefined`·`surface: null`·`color: null`이 **없다**. `mapGeometry.ts`의 두 함수에 `delete next.surface`·`delete next.color` | `patchNode`로 기본값을 씀(키가 남는다) / 지우는 대신 `undefined`를 씀 |
| 44 | **도로의 높이**: 속성 칸의 `label="입체 높이"` 칸이 도로가 아닐 때의 가지에만 있다. `applyNodeWorldPose`에 `isRoadSpace(node) ? null : settle(volumeHeight * scale.y`. `BackgroundMap3D.tsx`의 `applyGizmo`에 `flat: node.type === 'space' && isRoadSpace(node)`. `BackgroundMapCameraGizmo.ts`의 `setTarget`에 `mapGizmoSetup(target.type, mode, target.flat)`. `map3dScene.ts`의 `buildSpace`에 `floor.renderOrder = road ? -1.5 : -1;`, `mapWorldBounds`에 `spaceWallHeight(` | 도로에 입체 높이 칸이 나옴 / 3D에서 도로의 높이가 쓰임 / `setTarget`이 `flat`을 넘기지 않음(도로에 높이 손잡이가 남는다) / 그리는 순서를 같게 둠(겹친 곳이 깜빡인다) |
| 45 | **카메라 색의 배선**: 편집기에 `<BackgroundMapCameraColor`가 한 번, 카메라 가지 안·`editing` 아래. **동그라미는 여섯**: `BackgroundMapCameraColor.tsx`에 `className="bmap-color-swatch"`가 정확히 한 번이고 그것이 `MAP_CAMERA_COLORS.map(` 안이다(표가 여섯 줄임은 10.6이 본다). 같은 파일에 `기본 색으로`와 `onChange(null)`이 있고, 그 버튼의 `className`에 `bmap-color-swatch`가 없으며 `aria-disabled={color === undefined}`다(`color === undefined`가 `disabled=` 속성에 들어 있지 않다). 평면 카메라 `<g>`와 목록 아이콘, `BackgroundMapPlanOverlays.tsx`의 카메라 손잡이 `<g>`, `BackgroundMapPlanPreview.tsx`의 다섯 곳에 `data-camera-color=`. `map3dScene.ts`의 `shapeKey` 카메라 줄에 `node.color ?? ''`. `buildCamera`의 본문에서 `this.material(` 호출 가운데 둘째 인자 `tint` 없이 불리는 것은 `this.material('cameraLens')`와 `this.material('proxy')` **둘뿐**이다 — 색을 타는 이름 여섯(`camera`·`cameraLine`·`cameraLineOn`·`cameraFar`·`cameraFarOn`·`cameraRing`)의 호출은 모두 `, tint)`로 끝난다(8.4) | 한 화면에서 색이 빠짐 / 색을 바꿔도 3D가 다시 만들지 않음 / 렌즈까지 물듦 / 호박색 동그라미를 되살림(일곱 칸이 된다) / '기본 색으로'를 `disabled`로 끔(누른 뒤 키가 닿지 않는다) |
| 46 | **업데이트 안내**: `domain.ts`의 `onlyKeys`가 `BackgroundUnsupportedError`를 던지고 `domain.ts`에 `delete `가 없다(모르는 키를 지우지 않는다). `useBackgroundStore.ts`의 `refresh`에 `error instanceof BackgroundUnsupportedError`, `execute`의 로그인 검사 다음에 `if (get().updateRequired) throw`, 그리고 `console.warn('[background] update required:'`가 **두 번**(`refresh`의 `catch`와 `execute`의 실패 복구)이고 두 곳 모두 `if (!get().updateRequired) console.warn(`의 꼴이다(안내가 켜질 때만 적는다, 5.2). `BackgroundLibraryView.tsx`에 `업데이트가 필요해요`·`다시 확인`이 있고, 탭 줄과 본문이 `updateRequired`가 아닐 때의 가지에만 있다 | 모르는 키를 지우고 읽음 / 안내 아래에 편집기가 그대로 그려짐 / 저장이 막히지 않음 / 까닭을 남기지 않음 / 실패한 읽기마다 적음(업데이트하지 않은 PC의 콘솔에 15초마다 같은 줄이 쌓인다 — 동작은 5.5의 저장소 테스트가 잡는다) |
| 47 | **순수 모듈**: `mapCameraColor.ts`·`mapSpatial.ts`가 three.js를 import하지 않고 DOM을 만지지 않는다(앵커 9와 같은 정규식). 3D 세 파일의 import 목록(앵커 10)은 그대로 통과 | — |
| 48 | **기호 목록의 대체값은 이름으로, 계단에는 그림이 있다**: `symbolCatalog.ts`에 `item.id === "custom"`으로 찾는 대체값이 있고 `symbolCatalog.length - 1`이 없다. `symbolCatalog: ReadonlyArray<{`의 타입 표기가 그대로 있다. **계단 그림**(이 컴포넌트를 import하는 테스트가 없다 — 가지가 빠져도 목록(10.4)과 3D(10.7)의 테스트는 모두 통과한다): `BackgroundSymbolGlyph.tsx`에 `symbol === "stairs"` 가지가 있고 그 안에 디딤판의 `d="M10 19.33H90M10 34.67H90M10 50H90M10 65.33H90M10 80.67H90"`과 화살표의 `d="M50 86V16M40 28L50 14L60 28"`이 있다. 그 파일에 `<pattern`과 `vectorEffect`가 **없다**(계단의 선도 다른 기호처럼 그림 단위다, 6.2) | 자리로 되돌림(다음에 기호를 끝에 붙이면 옛 종류가 그것이 된다) / 타입 표기를 뺌(typecheck가 먼저 잡지만 여기서도 본다) / 계단 가지를 빼거나 종류 이름을 틀리게 적음(빈 `<g>`가 그려져 평면의 계단이 보이지 않고 도구줄·기호 목록·오브젝트 목록·속성 칸의 아이콘이 비어 보인다) / 계단에만 `vectorEffect`를 줌(아이콘과 평면에서 이웃 기호와 선 굵기가 어긋난다) |
| 49 | **3D에서 도로는 자기 위에 선 방에 지고, 그 방의 벽 너머로는 다시 눌러 내려간다**: `mapStack.ts`에 `export function spacesOverlap(`과 `OVERLAP_SLACK`이 있고 그 함수의 본문에 `nodePlanOutline(`이 있다. `map3dScene.ts`에 `function roadsUnderRooms(`가 있고 그 본문에 `rooms.some(room => spacesOverlap(room, space))`가 있다. `pickMapNode`의 본문에 `roadsUnderRooms(hits, map)`과 `hits.filter(hit => !under.has(String(hit.object.userData.nodeId)))`가 있다. `pickMapFloor`와 `mapFloorPile`의 본문에는 `isRoadSpace`·`roadsUnderRooms`·`spacesOverlap`이 **없다**(기호를 놓는 자리와 바닥 더미는 그대로다). **본문을 자르는 자리**: `roadsUnderRooms`가 `pickMapFloor`와 `pickMapNode` 사이에 놓이므로(7.6), 기존 앵커 21처럼 `piece(scene, 'export function pickMapFloor(', 'export function pickMapNode(')`로 자르면 그 조각에 `roadsUnderRooms`의 본문(`isRoadSpace`·`spacesOverlap`)이 들어가 **바른 구현에서 실패한다.** 이 앵커는 `pickMapFloor`를 `piece(scene, 'export function pickMapFloor(', 'function roadsUnderRooms(')`로, `roadsUnderRooms`를 거기서 `'export function pickMapNode('`까지로, `pickMapNode`를 `'export function mapFloorPile('`까지로, `mapFloorPile`을 `'export function mapSpacePile('`까지로, `mapSpacePile`을 `'function mapClickStep('`까지로 자른다(주석은 `read`가 이미 뺀다. 앵커 21의 조각과 검사는 그대로 둔다). `export function mapSpacePile(`의 본문에 `mapFloorPile(hits, map)`, `pickMapNode(hits, map)`, `pile.length > 0`, `node.type === 'space'`, `[picked, ...pile]`이 있고 `isRoadSpace`·`spacesOverlap`이 없다(도로인지, 겹치는지는 `pickMapNode`가 이미 갈랐다). `mapClickStep`이 그것을 부른다(앵커 31의 바뀐 글자, 10.1). `BackgroundMap3D.tsx`의 `pick`에 `again ? mapSpacePile(hits, props.map) : []`가 있고 그 파일 어디에도 `mapFloorPile`이 없다 | 그 걸음을 뺌(도로 위에 선 건물의 벽을 누르면 뒤의 도로가 잡힌다) / **겹침 검사를 뺌 — 방이 맞기만 하면 도로를 뺌**(겹치지 않는 길가 건물이 길을 가로막는다. 승인 문구에 없는 동작이고, 맞춤 보기의 길가 도면에서 길이 보이는 자리의 94%가 그렇게 된다, 7.6) / 도로를 바닥 더미에서 뺌(다시 눌러도 도로로 내려가지 못한다) / `pickMapFloor`에서 도로를 뺌(바닥을 올린 도로 위에 기호를 놓을 때 누른 자리가 아니라 그 아래 땅의 점이 잡힌다 — `floorPoint`, BackgroundMap3D.tsx:513-519) / `mapClickStep`이 `mapFloorPile`을 그대로 부름(건물 벽 너머의, 그 건물 밑 도로는 다시 눌러도 잡히지 않는다) / 손잡이 위의 클릭만 `mapFloorPile`로 남김(건물의 기즈모가 놓인 자리에서는 그 밑의 도로로 내려가지 못한다) / `mapSpacePile`이 카메라·기호를 더미 앞에 넣음(공간을 고른 채 그 위의 카메라·기호를 다시 누르면 그것이 잡히지 않고 아래 공간으로 넘어간다) |

앵커는 **뮤테이션으로 확인**한다(임시 복사본에서 표의 변형을 하나씩 넣어 실패하는지 본다). 순수 테스트도 표본을 뽑는다: `stackedSpaces`의 층 삭제, `addMapCamera`에서 `rooms.length ?` 삭제(도로를 방처럼 셈)와 도로를 아예 뺌, `roadCentreLine`의 띠 규칙 조건을 하나씩 빼거나 바꾼 아홉 가지(10.4의 표 — 줄마다 실패하는 테스트 값이 적혀 있다), 3D 누름의 열세 가지 — ① `pickMapNode`의 그 걸음 삭제(10.7의 "방의 벽 + 도로 바닥" 줄과 올린 도로 줄, 장면 1·3, 뷰포트) ② **겹침 검사 삭제**(`rooms.some(room => spacesOverlap(room, space))`를 `rooms.length > 0`으로 — 검토 전의 규칙이다. "옆 방"이 든 줄들, 장면 2, 뷰포트 '건물 옆의 도로') ③ `mapClickStep`의 `mapSpacePile`을 `mapFloorPile`로 되돌림(벽 줄의 `resolveMapClick`, 장면 3, 뷰포트의 "천천히 세 번") ④ `BackgroundMap3D.tsx`:562만 `mapFloorPile`로 되돌림(3D 테스트 가운데 **손잡이 테스트 하나만** 잡는다. 글자는 앵커 49) ⑤ `mapSpacePile`에서 `node.type === 'space'` 검사를 뺌(카메라·기호 줄 — 그 줄의 `map`에 카메라·기호 노드가 들어 있어야 잡힌다. 기존 :622-630의 의자 테스트도 잡는다) ⑥ `pile.length > 0` 검사를 뺌("방의 벽만" 줄) ⑦ 방을 더미의 뒤에 넣음(`[...pile, picked]` — 벽 줄의 `mapSpacePile` 순서, 도로 둘 줄, 장면 3) ⑧ `pickMapFloor`에서도 도로를 뺌(벽 줄·올린 도로 줄의 `pickMapFloor`와 `mapSpacePile`, 장면, 뷰포트) ⑨ `spacesOverlap`이 맞닿은 것을 겹친 것으로 셈(겹친 길이의 비교를 `>= 0`으로 — 10.3의 "변만 맞닿음"·"반올림 한 걸음"·"ㄷ자의 홈" 줄. "모서리" 줄은 이 변형에서도 통과한다 — 모서리만 닿은 둘은 함께 걸친 띠가 없어 그 비교까지 가지 않는다. 그리고 "옆 방"이 든 줄들, 장면 2, 뷰포트) ⑩ `spacesOverlap`을 "한쪽의 모서리가 다른 쪽 안에 있는가"로 바꿈(10.3의 표 — 가로지르는 길과 반씩 걸친 둘을 놓치고 맞닿은 건물을 겹친 것으로 읽는다. 누름 테스트들도 함께 실패한다) ⑪ 변끼리 만나는 점의 x를 띠의 경계에 하나도 넣지 않음(10.3의 "비스듬한 띠" 줄, 마름모를 y 370으로 옮긴 줄, 45° 돌린 (100, 400) 줄, "나비넥타이" 줄이 잡는다) ⑫ 띠 폭의 여유를 뺌(10.3의 "10억분의 1" 줄 **하나만** 잡는다) ⑬ 변끼리 만나는 점을 두 윤곽의 변끼리에서만 모음 — 한 윤곽의 변끼리는 보지 않음(검토 전의 블록이다. 10.3의 "나비넥타이" 줄 **하나만** 잡는다) (①~⑫는 설계 때 임시 복사본에서 모두 실패함을 보았다, 7.6. ⑨·⑪·⑫·⑬이 걸리는 10.3의 줄은 일관성 검토에서 고친 블록을 저장소의 `nodePlanOutline`에 물려 다시 돌린 결과다), `setSpaceSurface`가 `undefined`를 씀, `known`이 늘 `Error`를 던짐(안내가 뜨지 않는다)과 늘 `BackgroundUnsupportedError`를 던짐(깨진 자료에 안내가 뜬다), `getSymbolPreset`의 대체값을 마지막 항목으로, `cameraColorHex`가 밝은 값을 늘 돌려줌, 요소 파일에서 `'stairs'`를 뺌·`'road'`를 `'roads'`로(D2·D3), 더한 두 줄의 `NOT (n ? 'surface') OR`를 `n ? 'surface' AND`로(D2의 글자 비교 — PGlite 없이 잡혀야 한다), `CLAUDE.md` :3을 옛 문장으로 되돌림(D4의 부정 검사), `AGENTS.md` :111에서 사슬 문장을 뺌(D4의 긍정 검사), 인수인계 :297의 덧붙인 글을 뺌(D4), 10.6의 일곱 줄 각각(호박색 글자 하나를 남김 / 보조 평면도의 색 규칙을 뺌 / 목록 색 규칙을 밝은 화면 규칙 앞으로 옮김 / 가운데 선 규칙의 `fill:none`을 뺌 / 이름 테두리 굵기를 4로 / 보조 평면도의 도로 규칙을 포커스 규칙 뒤로 옮김 / 동그라미의 포커스 규칙을 뺌), `setCameraColor`를 `node.color === color`로만 견줌(10.3의 `null` 줄), `readPalette`가 도로 색을 `base`에서 채움(10.7의 테마 테스트), 저장소가 실패한 읽기마다 `console.warn`을 부름(5.5의 ①②), D5에서 줄 끝을 맞추는 줄을 빼고 CRLF 복사본에서 돌림.

### 10.10 통과 기준

`npm run typecheck`, `npm run test:background`, `npm run build:vite`. DB 실행 테스트는 `BFLOW_PGLITE_MODULE`을 지정해 **반드시 한 번 돌린다**(이번 차례는 SQL이 바뀐다 — 지정하지 않아 생략된 것을 통과로 적지 않는다. 지정하지 않은 실행의 생략 수는 지금의 3에서 5로 는다).

**언제 도는가**(13절): `npm run typecheck`와 `npm run test:background`는 단계마다. PGlite를 지정한 계약 테스트는 SQL이나 `domain.ts`를 고치는 1·2단계와 `addMapCamera`·`applyNodeWorldPose`를 고치는 4단계에서(계약 테스트는 그 둘을 PGlite 실행 부분에서만 부른다), 그리고 마지막 7단계에서 한 번 더. `npm run build:vite`와 아래의 CRLF 실행은 7단계에서(CRLF 실행은 계약 테스트를 쓰는 1단계에서도 한 번 한다). 이 절의 다섯 가지 — typecheck, `test:background`, `build:vite`, PGlite 실행, CRLF 실행 — 가 모두 마지막 상태에서 통과해야 끝난 것이다.

**CRLF 작업 폴더에서도 한 번 돌린다.** 계약 테스트(`tests/backgroundDatabaseContract.test.ts`)를 줄 끝이 CRLF인 파일들로 한 번 돌려 통과를 본다 — 이 워크트리의 두 적용 파일은 LF라서 여기서만 돌리면 D5의 줄 끝 처리가 시험되지 않는다. 방법: 새 워크트리를 하나 체크아웃해(그 폴더의 글자 파일은 처음부터 CRLF다 — `git ls-files --eol`로 세 SQL 파일이 `w/crlf`임을 먼저 확인한다) 거기서 `npm run test:background`를 돌리거나, 저장소 밖 임시 폴더에 그 테스트와 그것이 읽는 파일들(`src/features/backgrounds/`, `DEVLOG/migrations/`의 세 파일, `CLAUDE.md`, `AGENTS.md`, 인수인계 문서)을 같은 상대 경로로 복사해 세 SQL 파일과 세 문서의 줄 끝을 CRLF로 바꾼 뒤 그 테스트만 돌린다. 머지 뒤의 `npm run build`는 새 체크아웃에서 `test:background`를 돌리므로, 여기서 빠뜨리면 배포 빌드에서 처음 깨진다.

---

## 11. 수동 검증 (앱 엔진: Electron 33)

방법은 ②와 같다: `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130), 미리보기 시험 계정(한솔)으로 로그인 → 배경 → 도면. 실제 입력을 넣고 화면을 본다. 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고, 나머지 세 조합에서는 ★ 항목을 다시 본다. R13만은 창 폭 **1210·1300**에서도 본다(도구 이름이 보이는 가장 좁은 폭이다).

**미리보기 저장소는 이 검증 전용으로 쓴다.** 저장소 키(`bflow-background-library-preview-v1`)는 같은 주소에서 도는 모든 빌드가 함께 쓰고, 이 검증이 거기에 새 모양을 저장하거나(V1·V2) 모르는 종류를 심으면(U1·U2·U4) 그 주소에서 v1.132.0 이하의 코드를 띄운 다른 세션은 라이브러리 전체를 거절한다(5.3). ②의 검증처럼 **전용 포트**(다른 세션이 쓰지 않는 주소)와 도구 전용 저장소에서 돌린다. 그럴 수 없어 함께 쓰는 주소에서 돌렸으면: 시작할 때 키의 값을 따로 떠 두고, U1~U4가 끝나면 심은 값을 되돌리고, 검증이 모두 끝나면 떠 둔 값으로 되돌리거나 키를 지운다. 어느 쪽이었는지와 "이 주소의 미리보기 저장소에 새 모양이 들어 있다/없다"를 검증 기록에 적는다.

시험 도면: 큰 도로(가로로 긴 사각형) 위에 건물(방) 하나와 그 안의 작은 방, 건물 밖 도로 위에 계단 하나, 같은 자리의 카메라 셋(생성점), 세로 도로 하나(가로 도로와 교차). R2b에는 도면을 거의 덮는 큰 방(마당)과 그 **안에 통째로 든** 도로를 따로 그린다(미리보기 시험 자료의 '본관' 같은 큰 방 안에 그려도 된다). R6b에는 **길가 도면**을 따로 그린다: 가로로 긴 도로 하나와, 그 길의 평면 위쪽·아래쪽에 **길과 겹치지 않게** 세운 작은 건물 서너 채씩(높이는 기본값. 그린 뒤 옮기기의 스냅으로 길의 가장자리에 붙이거나 조금 띄운다 — 그리기는 스냅하지 않으므로 손으로만 그리면 조금 걸치기 쉽다), 그리고 눈 쪽 건물 가운데 **하나만 일부러 길에 조금 걸치게** 둔다.

**먼저 (엔진 동작 — 14.2의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 ★ | 계단을 의자·침대 옆에 놓는다. 10%·100%·400%에서 본다. 계단의 가로·세로를 크게 다르게 늘인다 | 계단의 선이 **다른 기호와 같은 식으로** 굵어지고 가늘어진다 — 어느 확대율에서도 계단만 유독 굵거나 가늘지 않다(10%에서 함께 흐려지고 400%에서 함께 굵다). 디딤판 다섯 줄과 화살표가 상자를 따라 늘어나고, 120×240에서 가로줄이 세로줄보다 굵은 것이 침대의 가로줄과 같은 정도다 |
| E2 ★ | 도구줄의 기호 버튼, 기호 목록, 오브젝트 목록, 속성 칸 미리보기의 계단 아이콘을 **다른 다섯 아이콘과 나란히** 본다 | 16~28px에서도 줄무늬와 화살표로 읽힌다(뭉쳐서 한 덩어리가 되지도, 흐려서 빈 상자로 보이지도 않는다). 선의 무게가 이웃 아이콘과 어울린다 |
| E3 ★ | 도로의 가운데 점선과 그 위의 이름을 **10%·25%·33%·100%·400%**에서 본다(가로 도로, 세로 도로, 상세 도면이 연결된 도로) | 점선의 길이와 굵기가 화면에서 같다. **어느 확대율에서도 이름과 '상세 도면 ↗'이 점선에 그어지지 않고 읽힌다** — 글자 둘레의 바탕색 테두리가 글자와 함께 화면 크기를 지킨다(10%에서 사라지지 않고, 400%에서 글자보다 크게 부풀지 않는다). 방의 이름은 v1.132.0과 같다(테두리가 없다) |
| E4 | 3D에서 도로와 방이 겹친 곳을 여러 각도로 돌려 본다. 교차한 두 도로도 | 겹친 곳의 색이 각도에 따라 바뀌거나 깜빡이지 않는다 |
| E5 | 3D의 도로 가운데 점선 | 보통의 거리에서 점선으로 읽힌다(실선이나 점으로 보이지 않는다) |

**계단**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| S1 ★ | 기호 목록을 연다 | 문·의자·테이블·침대·계단·기타 사물 여섯, 제목 '문·계단·사물' |
| S2 ★ | 계단을 놓는다 | 평면: 줄무늬와 위쪽 화살표, 이름은 선택했을 때만. 속성 칸에 경첩·열림 버튼이 **없다** |
| S3 ★ | 3D로 간다 | 10단이 평면의 위쪽으로 올라간다. 평면 화살표와 같은 쪽 |
| S4 | 90° 회전, 크기·입체 높이를 바꾼다(높이 40 / 300) | 방향이 함께 돈다. 3단 / 16단 |
| S5 | 3D에서 계단의 실체를 누른다 / 계단 위 빈 곳을 누른다 / 뒤의 카메라를 누른다 | 계단 / 계단 / 카메라(대리 상자가 실체를 가리지 않는다) |
| S6 | 스냅·상자·Ctrl+D·잠금 | 다른 기호와 같다 |
| S7 | 옛 종류(미리보기 저장소에 `symbol: 'desk'`를 넣는다) | '기타 사물'로 보인다 — 계단이 아니다 |

**도로**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| R1 ★ | 도구줄에 '도로'. 끌어 그린다 | 회색 바닥, 각진 모서리, 긴 쪽 가운데 점선. 이름 칸이 `새 도로`로 열린다(접근성 이름 '도로 이름'). 이름을 정하면 **이름이 점선에 가려지지 않는다**(두 화면 모두). 속성 칸의 머리 글자 '선택한 도로', 오브젝트 목록에 `═` 아이콘과 종류 '도로', 모양 줄의 안내 '꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.' 되돌리기 한 번에 사라진다 |
| R2 ★ | 건물을 **먼저** 그리고 그 위로 도로를 **나중에** 크게 그린다 | 건물이 위에 보이고 건물을 누르면 건물이 잡힌다. 같은 자리를 천천히 다시 누르면 도로로 내려간다. 빠르게 두 번 누르면 넘어가지 않는다 |
| R2b ★ | 큰 방(마당) **안에** 도로를 통째로 그린다. ① 그린 직후(도로가 선택돼 있다) 도로의 몸통을 끈다 ② 되돌리고, 도로 자리를 한 번 누른 뒤 천천히 한 번 더 누르고 그 자리에서 끈다 ③ Shift를 누른 채 방 안에서 도로의 가장자리에 걸치는 상자를 그린다 ④ 오브젝트 목록에서 도로를 골라 F2로 이름을 바꾸고, 속성 칸에서 위치를 바꾸고, 손잡이로 크기를 바꾸고, 다각형으로 바꿔 점을 끈다 ⑤ 3D에서 도로 자리를 누르고, 천천히 다시 누르고, 기즈모로 옮긴다 | 그린 직후 속성 칸의 '공간 종류' 아래에 `도로는 벽 없는 바닥이에요. 다른 공간과 겹치면 늘 아래에 깔려요. 다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요.`가 보인다. ① **바깥 방이 선택되고 방이 (소속 항목과 함께) 움직인다** — 쌓임 규칙의 결과다(7.7, I5). 되돌리기 한 번으로 돌아온다 ② 방 → 도로가 선택되고, 끌면 **도로만** 움직인다 ③ 도로만 선택된다 ④ 모두 된다(손잡이와 점은 방 위에 그려져 바로 눌린다) ⑤ 방 → 도로 → 기즈모가 도로를 옮긴다 |
| R3 | 도로 → '다각형으로 바꾸기' | 점선이 그대로다. ① 긴 변 하나의 `+`를 끌어 점을 더한다 → **점선이 사라지고** '공간 종류' 아래에 `가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요. 한쪽에 점을 더했으면 맞은편에도 하나 더해 주세요. 광장처럼 길 모양이 아닌 곳에는 그리지 않아요.` ② 맞은편 변에도 마주 보게 하나 더한다 → 점선이 돌아오고 안내가 사라진다. 두 점을 옮겨 ㄱ자·∧ 모양으로 만든다 → 점선이 꺾임을 따라간다 ③ **한쪽 변에만 둘을 더한다**(여섯 점이지만 마주 보는 짝이 없다) → 점선이 없고 같은 안내(길 가장자리로 빠지는 선이 그려지지 않는다) ④ 마주 보는 두 점 가운데 하나를 길 방향으로 멀리 끈다 → 어느 순간 점선이 사라지고, 되돌려 놓으면 돌아온다. 점선이 사라진 동안에도 모양 줄의 점 편집 안내는 그대로다 |
| R4 ★ | 방을 고르고 '공간 종류'를 도로로, 다시 방으로 | 회색 바닥 ↔ 보라 방. 머리 글자 '선택한 도로' ↔ '선택한 공간', 목록의 아이콘과 종류 글자도 함께 바뀐다. 소속 카메라·기호·장소 연결·이름이 그대로. 되돌리기 한 번씩. 방으로 되돌리면 3D의 벽 높이가 예전 값 |
| R5 | 타원 / 삼각형 다각형 / 십자 모양 다각형을 도로로 | 회색 바닥, 점선 없음. '공간 종류' 아래의 안내: 타원은 `둥근 도로에는 가운데 점선이 없어요.`, 다각형은 R3의 안내. 평면·3D 모두에서 보인다. 방으로 되돌리면 안내가 사라진다 |
| R6 ★ | 3D. **도로 위에 선** 작은 건물(시험 도면의 큰 도로 위 건물)을 여러 각도에서 누른다: ① 건물의 바닥 ② 건물의 **벽**(맞춤 보기에서 건물 몸통의 위쪽 절반 — 벽 너머로 도로가 보이는 곳), 낮은 각도에서 바깥벽 ③ 같은 곳을 더블클릭(건물에 상세 도면을 연결해 둔다) ④ ②의 자리를 천천히 한 번 더, 또 한 번 더 누른다 / 빠르게 두 번 누른다 ⑤ 도로에 상세 도면을 연결하고, ④처럼 도로까지 내려간 뒤 그 자리를 더블클릭한다 ⑥ 편집 중에 ②의 자리를 눌러 건물을 고르고(기즈모가 건물에 붙는다), 포인터 아래에 온 기즈모 손잡이를 움직이지 않고 한 번 더 누른다 ⑦ 건물에 가리지 않은 도로(건물에서 떨어진 곳) ⑧ 도로를 고른 채(목록에서) ②의 자리를 처음 누른다 ⑨ 도로의 바닥 높이를 건물보다 높이 올리고(고가) 건물과 겹친 곳을 누른 뒤 천천히 한 번 더 누른다 | 벽 없는 납작한 바닥, 테두리와 점선. 이름표가 바닥 바로 위. ① 건물 ② **건물**(도로가 아니다) ③ 건물의 상세 도면이 열린다 ④ 건물 → **도로** → 건물 / 건물 그대로(넘어가지 않는다) ⑤ 도로의 상세 도면이 열린다 ⑥ 건물 → 도로(손잡이가 가려도 내려간다. 아무것도 움직이지 않는다) ⑦ 도로(한 번에) ⑧ 건물(다른 데서 고른 뒤의 첫 누름은 맨 위의 것) ⑨ 건물 → 도로 |
| R6b ★ | 3D, 길가 도면, '맞춤'. ① 길과 **겹치지 않는** 눈 쪽 건물의 **벽 너머로 보이는 길**을 누른다. 같은 자리를 천천히 한 번 더 누른다 ② 길에 상세 도면을 연결하고 ①의 자리를 더블클릭한다 ③ 그 건물의 바닥이 보이는 곳 / 벽의 아래쪽(광선이 그 건물의 바닥에 닿는 곳)을 누른다 ④ **일부러 길에 걸쳐 둔** 건물의 벽 너머로 보이는 길을 누르고, 천천히 한 번 더 누른다 ⑤ 그 걸친 건물을 옮기기의 스냅으로 길 가장자리에 붙인 뒤 ④의 자리를 다시 누른다 ⑥ '위에서 보기'를 누르고 길을 누른다 ⑦ 보조 평면도에서 길을 누른다 / 오브젝트 목록에서 길을 고른다 | ① **길이 한 번에 잡힌다**(앞 건물이 아니다 — 겹치지 않는 건물의 벽은 지금의 방처럼 뒤의 바닥을 가리지 않는다). 다시 눌러도 길 ② **길의 상세 도면이 한 번에 열린다** ③ 그 건물 / 그 건물 ④ 건물 → 길(조금이라도 걸치면 겹친 것이다 — I4) ⑤ 길이 한 번에 잡힌다 ⑥ 길이 한 번에 잡힌다 ⑦ 길이 잡힌다 |
| R7 | 도로를 고르고 속성 칸의 '높이' | '바닥 높이'만 있다. 3D의 크기 방식에 높이 방향 손잡이가 없다(가로·세로 둘만). 바닥 높이를 올리면 소속 카메라·기호가 함께 오른다 |
| R8 | 도로 위에서 '카메라 추가'(건물이 생성점에 없을 때 / 있을 때) | 도로에 속한다 / 건물에 속한다 |
| R9 | 건물 안에 기호를 놓는다 / 도로 위(건물 밖)에 놓는다 | 가장 작은 방에 / 도로에 속한다. 도로를 옮기면 도로의 것이 함께 간다 |
| R10 | 넓은 도로 안쪽에만 상자를 그린다 / 도로의 가장자리를 걸친다 | 위의 것만 / 도로도 잡힌다 |
| R11 | 도로에 배경 장소 연결, 내부 도면 만들기, 더블클릭 | 방과 같다 |
| R12 ★ | 보조 평면도 | 도로가 회색, 점선, 방 아래. 도로를 고르면 '도로'와 바닥 높이만 읽어 준다. 도로에 속한 카메라의 옆 그림에 방 상자가 없다 |
| R13 (740 · 1210 · 1300) | 평면의 도구줄(편집 중) | **740**: 도구가 하나 늘어도 도면을 가리지 않고 줄이 넘치지 않는다(이 폭에서는 도구 이름이 감춰져 도구줄이 가장 좁다). **1210·1300**: 도구 이름이 보이는 가장 좁은 폭이다(1200px 이하에서 이름이 감춰진다, backgrounds-map.css:138) — 이름 붙은 도구가 여섯이 되면서 도구줄이 **두 줄로 접히는지** 본다. 접히면 v1.132.0의 같은 폭과 견주어 이번에 새로 접힌 것인지 적고 14.2의 대체안을 고른다. 접히지 않으면 그대로 둔다 |
| R14 | **잠긴 도로**: 도로를 잠근다(속성 칸의 잠금). 평면·보조 평면도·3D에서 본다. 잠긴 도로와 방 하나를 상자로 함께 골라 묶음을 끈다 | 평면: 테두리가 점선이다(회색 바닥과 가운데 점선은 그대로). 속성 칸의 '공간 종류' 칸이 꺼져 있고(다른 칸과 손잡이는 잠긴 방과 같다 — 손잡이가 없다). 보조 평면도: 테두리가 점선. 3D: 테두리가 점선이고 기즈모가 붙지 않는다. 묶음을 끌면 잠긴 도로는 제자리에 남는다. 잠금을 풀면 모두 돌아온다(잠긴 것을 읽는 표시는 자동 테스트가 재질만 본다, 10.7 — 화면의 점선은 여기서만 본다) |

**카메라 색**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| C1 ★ | 색이 없는 카메라 — v1.132.0과 나란히 놓고 평면·목록·보조 평면도·3D의 계산된 색을 견준다. **v1.132.0은 다른 포트(다른 주소)에서 띄운다** — 미리보기 저장소는 주소마다 따로이고, 같은 주소에서 새 모양을 한 번이라도 저장한 뒤에는 v1.132.0의 코드가 저장소 전체를 거절해 견줄 카메라 대신 빨간 띠와 빈 화면만 나온다(5.3). 같은 주소밖에 쓸 수 없으면 C1을 **새 모양을 하나도 저장하기 전에** 먼저 한다 | 두 화면 모두 **같다** |
| C2 ★ | 카메라를 고른다 | 이름 아래 '카메라 색': **동그라미 여섯 개**(빨강·연두·초록·청록·파랑·분홍)와 그 끝의 글자 버튼 '기본 색으로'. 호박색 동그라미는 없다. 색을 고르지 않은 카메라는 어느 동그라미에도 고리가 없고 '기본 색으로'가 흐리다. 색을 고르면 그 동그라미에 고리가 생기고 '기본 색으로'가 또렷해진다. 속성 칸이 좁아도 줄이 넘치지 않는다(740) |
| C3 ★ | 색을 누른다 | 평면(몸통·부채꼴·시선·방향 손잡이와 점선), 목록 아이콘, 보조 평면도(점·화살표·고리·부채꼴·옆 그림), 3D(몸통·시선·화면 틀·바닥 고리)가 그 색. 렌즈는 어둡다 |
| C4 | 색이 있는 카메라에서 '기본 색으로'를 누른다 → 도구줄의 되돌리기 → 다시 '기본 색으로' → 그대로 `+` 키(평면에서, 확대) → 저장 → 새로 고침. 색이 없는 카메라에서 흐린 '기본 색으로'를 누른다 | 호박색 → 고른 색이 돌아온다(한 단계) → 호박색 → **확대된다**(버튼을 누른 뒤에도 포커스가 버튼에 남아 편집기의 키가 닿는다). 저장된 자료에 `color` 키가 없다(미리보기 저장소에서 확인). 흐린 버튼은 아무 일도 하지 않는다('저장 전 변경사항'이 생기지 않는다) |
| C5 | 색을 세 번 바꾸고, 도면의 빈 곳을 한 번 누른 뒤 Ctrl+Z 세 번(또는 도구줄의 되돌리기 세 번) | 한 번에 하나씩 돌아간다. (버튼에 포커스가 있는 동안 Ctrl+Z는 지금도 듣지 않는다 — 편집기의 기존 규칙 :870이며 이번에 바꾸지 않는다) |
| C6 | 잠긴 카메라 / 보기 모드 | 동그라미와 '기본 색으로'가 모두 꺼져 있다 / 줄이 없다(색은 도면에 보인다) |
| C7 | Tab으로 동그라미 여섯과 '기본 색으로'를 지나 Enter·Space. **지금 색의 동그라미에 포커스를 둔다** / 지금 색이 아닌 동그라미에 포커스를 두고 Enter를 누른다 / 지금 색의 **이웃** 동그라미에 포커스를 둔다 | 포커스 고리가 보이고 눌린다. 화면 낭독기 이름이 색 이름. **눌림 고리와 포커스 고리가 함께 보인다**(포커스 고리가 눌림 고리의 바깥에 있다 — 포커스를 둔 채로도 그것이 지금 색인지 읽힌다) / Enter를 누르는 순간 그 동그라미에 눌림 고리가 생기는 것이 보인다 / 이웃의 눌림 고리와 포커스 고리가 겹치지 않는다. '기본 색으로'를 키보드로 누른 뒤에도 포커스가 그 버튼에 남는다 |
| C8 ★ | 여섯 색 카메라를 방·도로·기호 옆에 놓고 선택·잠금·수직(위/아래) 상태로 | 여섯이 서로, 그리고 방(보라)·기호·도로·스냅 안내선과 구분된다. 선택은 굵기로 읽힌다. 안쪽 표시가 보인다 |
| C9 | 색 카메라로 '이 카메라 시점으로 보기' | 구도는 그대로, 띠는 호박색 |
| C10 | 3D에서 밝은 ↔ 어두운 화면 전환 | 색 카메라와 도로가 그 화면의 값으로 바뀐다 |

**저장과 업데이트 안내**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| V1 ★ | 계단·도로(사각형·ㄱ자)·색 카메라를 저장 → 새로 고침 → 다른 도면에 갔다 온다 | 그대로다. 평면 ↔ 3D 전환만으로는 '저장 전 변경사항'이 생기지 않는다. (이 저장부터 이 주소의 미리보기 저장소에는 새 모양이 들어 있다 — 머리말의 주의) |
| V2 | **두 탭**(같은 주소, 같은 시험 계정). 탭 A에서 도면 하나를 연다. ① 탭 B에서 같은 도면에 도로 하나와 색 카메라 하나를 더해 저장한다 — 탭 A는 보기만 하고 있다 ② 탭 A에서 그 도면을 편집해 저장하지 않은 변경을 만든 채로, 탭 B에서 같은 도면에 도로를 하나 더 저장한다. 그 뒤 탭 A에서 저장한다 | ① 신호가 온 뒤(늦어도 15초 안에) 탭 A에 그 도로와 색 카메라가 **그 모습대로** 나타난다(회색 바닥·점선, 고른 색. 오류 띠나 업데이트 안내가 없다) ② 탭 A의 저장이 충돌 안내로 거절된다(v1.132.0의 충돌 동작 그대로). 탭 A의 초안은 남아 있다 |
| U1 ★ | 미리보기 저장소(`bflow-background-library-preview-v1`)에서 기호 하나의 `symbol`을 `'elevator'`로 바꾸고 새로고침 버튼 | 탭과 본문이 사라지고 **'업데이트가 필요해요'** 안내와 '다시 확인'. 빨간 오류 띠가 없다. 머리줄 '업데이트 필요'. 개발자 도구의 콘솔에 `[background] update required: 사물 기호가 올바르지 않습니다. value "elevator"` 한 줄(안내 화면에는 이 글자가 없다). **안내를 30초 넘게 띄워 두고 창의 포커스를 두어 번 옮겨도 그 줄은 한 줄 그대로다**(다시 읽기는 계속 돌지만 다시 적지 않는다) |
| U2 | 같은 식으로 노드에 모르는 키(`"future": 1`)를 / `x`를 `"a"`로 | 안내 / **빨간 오류 띠**(안내가 아니다) |
| U3 | 안내가 뜬 채 저장소를 되돌리고 '다시 확인' | 본문이 돌아온다 |
| U4 | 편집 중에 U1을 일으킨다(다른 탭에서 저장소를 고친다) | 안내로 바뀐다. 저장 버튼이 화면에 없다 |
| U5 | U1~U4가 끝나면 심은 값을 되돌린다(머리말의 주의) | 본문이 돌아오고 콘솔에 새 줄이 없다. 저장소에 `elevator`·`future`가 남아 있지 않다 |

**회귀(기존 기능)**: 방 그리기·이름·스냅·다각형 점, 상자·묶음 이동·잠금·삭제, 겹친 방의 넘기기(평면·3D·보조 평면도), 스페이스 화면 이동, 3D 기즈모(방의 크기 방식에 손잡이 셋), 3D에서 방의 벽을 눌렀을 때(뒤에 더 큰 방의 바닥이 있으면 큰 방, 없으면 그 방 — v1.132.0과 같다), 방의 이름 글자(테두리 없음), 새 카메라의 생성점 — 각각 한 번씩.

**배포 뒤 실기에서만 볼 수 있는 것**: 설치된 앱에서 새 모양의 첫 저장과 새로 고침, 한솔의 실제 도면에서 색 여섯의 구분, 다른 PC(이전 버전을 일부러 남겨 둔 것이 있다면)에서 배경 화면이 2.2의 문장으로 열리지 않는지.

---

## 12. 배포 기록과 문서

- 버전: `package.json`의 `version`과 `package-lock.json`의 두 곳(맨 위 `version`, `packages[""].version`)을 `1.133.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다.
- `DEVLOG/update-notes.json` 맨 앞에 추가(비개발자 문구, 시험 공개 표기는 1.132.0과 같은 방식). 업데이트 내역은 팀 전체가 읽는데 배경 화면은 배한솔 계정에만 보인다 — 넷째 항목은 "모두 업데이트하라"는 지시로 읽히지 않게 쓰고, 승인 문구의 "다른 팀원은 배경 화면이 보이지 않아 영향이 없다"를 그 항목 안에 적는다:

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

- 문서
  - `AGENTS.md` '배경 라이브러리 데이터 경계': 4.3의 세 줄(:106, :111, :114)과 맨 위 안내 줄(:3)을 고치고, "선택과 겹친 공간(v1.132.0)" 항목(:113) 다음에 한 항목 — **새 도면 요소(v1.133.0)**: 저장 모양의 추가는 셋이다(기호 종류 `stairs`, 공간의 선택 키 `surface: 'road'`, 카메라의 선택 키 `color`). 닫힌 목록은 `domain.ts`의 상수 셋 한 곳이고 요소 파일의 IN 목록과 같아야 한다 / 두 키는 없으면 지금의 동작이고, 기본으로 되돌릴 때는 **키를 지운다**(`null`·`undefined` 금지). 이미 있는 노드의 키를 바꾸는(쓰고 지우는) 곳은 `setSpaceSurface`·`setCameraColor` 둘뿐이고(새 도로의 `surface`만은 `newSpace`가 넣어 만든다) `patchNode`로 쓰지 않는다(합치기만 해서 지울 수 없다) / 서버는 검증만 한다. 저장 모양을 넓힐 때는 적용된 SQL 파일을 고치지 않고 사슬 끝에 새 파일을 더하며, DB를 먼저 적용하고 앱을 배포한다. **넓히는 migration을 운영에 적용한 뒤 그 앱 버전의 배포가 끝날 때까지는 운영에 새 모양을 저장하지 않는다**(개발 빌드로도, 검증하면서도 저장하지 않는다. 첫 저장은 배포된 버전에서, 그 화면을 여는 PC를 모두 올린 뒤에 한다) — 서버는 앱 버전을 모르므로 적용한 순간부터 새 모양을 받고, 그 사이에 하나라도 저장되면 그것을 모르는 PC가 모두 배경 화면 대신 업데이트 안내를 띄우는데 올릴 버전이 아직 없다. **저장 모양은 새 선택 키 또는 닫힌 목록의 새 문자열로만 넓힌다** — 기존 키의 숫자 범위·값 타입·개수 한계를 넓히면 이전 버전에는 업데이트 안내가 아니라 오류로 보인다(읽기 장치는 모르는 키와 목록 밖 문자열만 알아본다) / **읽은 자료에 이 버전이 모르는 키나 닫힌 목록 밖의 문자열이 있으면 `BackgroundUnsupportedError`** 이고 화면은 오류 대신 업데이트 안내를 띄워 보기·편집·저장을 막는다(무엇을 몰랐는지는 오류의 `detail`에 실려 콘솔에 남는다. 문장과 화면에는 넣지 않는다). 타입이 틀리거나 범위 밖이면 지금처럼 오류다. 어느 쪽이든 통째로 거절하며, **모르는 값을 지우고 읽지 않는다**(통째 저장이 그것을 지운다). 닫힌 목록을 보는 새 검사는 `known`을 쓴다 / 도로는 공간이다: `isRoadSpace` 하나로 읽고, 쌓임 순서의 맨 앞 항(도로가 모든 방 아래)으로 방과 갈린다. 쌓임 순서를 읽는 곳은 여섯이다(평면 그리기, `planPileAt`, 보조 평면도, `pickMapFloor`, `mapFloorPile`, `placeSymbol`). 3D에서 쌓임 순서가 닿지 않는 경우(방의 벽을 맞혔을 때, 바닥 높이가 다를 때)는 `pickMapNode`의 맨 앞 걸음이 맡는다 — **같은 광선에 맞은 방과 평면에서 겹친 도로**의 바닥 맞춤만 빼고(`roadsUnderRooms`), 남은 것에 지금의 규칙을 쓴다. 겹치는지는 `mapStack.ts`의 `spacesOverlap` 한 곳이 정한다: 넓이를 나눠 가져야 겹친 것이고, 변이나 모서리만 맞닿은 것은 아니다(승인 문구가 "건물과 **겹치면**"이다 — 겹치지 않는 건물 옆의 도로는 지금의 방처럼 벽 너머로도 한 번에 잡힌다. 겹침 검사를 빼면 길가 건물이 길을 가로막는다). 그래서 건물 **밑의** 도로는 그 건물의 벽 너머에서 처음 누를 때 건물에 지고, 같은 자리를 천천히 다시 눌러 내려간다: 다시 누를 때의 더미는 `mapSpacePile`(바닥 더미 앞에 벽으로 잡힌 방) 한 곳이며 `mapClickStep`과 손잡이 위의 클릭(`BackgroundMap3D.tsx`의 `pick`)이 **둘 다** 그것을 부른다 — 한쪽이라도 `mapFloorPile`을 직접 부르면 그 도로에 닿지 못한다. `pickMapFloor`·`mapFloorPile`에는 도로 규칙을 넣지 않는다(기호를 놓는 자리, 바닥끼리의 순서). 큰 방 안에 통째로 든 도로는 몸통을 바로 누를 수 없다(천천히 다시 누르기·Shift+상자·목록과 손잡이 — 도로의 속성 칸 안내 `ROAD_HINT`가 그 길을 말한다) — 쌓임 규칙의 결과이니 '고치지' 않는다. 벽이 없어 세로 크기는 `spaceWallHeight`(도로 0)로 읽는다 — `nodeVolumeHeight`는 저장된 값이며 도로인 동안 쓰지 않는다. 새 카메라의 소속은 방이 먼저이고 방이 없을 때만 도로다 / 가운데 점선은 `roadCentreLine` 한 곳(사각형과, 띠 규칙 넷을 지나는 다각형)이며 평면·보조 평면도·3D가 함께 읽는다. 점의 수가 짝수인 것만으로 그리지 않는다(한쪽 옆줄에만 점이 많으면 선이 가장자리로 빠진다). 점선이 없는 도로에는 속성 칸이 까닭을 말한다. 평면에서 도로의 이름에는 글자 테두리가 있고 그 굵기는 글자처럼 `--bmap-label-scale`을 곱한다(가운데 점선이 이름을 지난다. 고정값이면 축소한 도면에서 테두리가 사라진다) / 카메라 색은 이름으로 저장하고 값은 화면이 정한다: 3D는 `mapCameraColor.ts`, DOM은 `backgrounds-map.css`의 `--bmap-cam`(숫자 셋). 두 벌은 테스트가 견준다. 색이 없는 카메라의 모습은 바꾸지 않는다. 저장되는 색 이름은 **칸의 이름**이다 — 칸의 색과 화면 이름은 migration 없이 고칠 수 있고, 운영 DB의 여섯 이름은 다시 건드리지 않는다. 속성 칸의 동그라미는 여섯 개(승인된 수)이고 호박색으로 돌아가는 길은 동그라미가 아닌 '기본 색으로' 글자 버튼이다. 동그라미의 포커스 고리는 눌림 고리 바깥에 그린다 / 기호 목록의 대체값은 자리 아닌 이름(`custom`)으로 찾는다. 기호 그림의 선은 모든 종류가 그림 단위다(계단에만 화면 굵기를 주지 않는다) / 미리보기 저장소 키(`bflow-background-library-preview-v1`)는 그대로다: v1.133.0의 미리보기가 새 모양을 저장한 주소에서 그 이전 코드를 미리보기로 띄우면 라이브러리 전체를 거절한다(3D 값 때와 같은 정책) — 이전 코드와 견줄 때는 다른 포트를 쓴다.
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절의 ② 줄(:25) 다음에 `- [x] 2026-10-09 ③ 새 도면 요소(v1.133.0): 계단 기호, 도로(공간의 한 종류), 카메라 색. 저장 모양이 늘어 운영 DB에 검증 함수를 넓히는 파일 하나를 더하고(앱보다 먼저 적용), 모르는 종류가 저장돼 있으면 오류 대신 업데이트 안내를 띄운다. 설계: docs/superpowers/specs/2026-10-09-background-map-new-elements-design.md` 한 줄. 버전 목록의 v1.132.0 절(:1421-1427) 다음에 `### v1.133.0 배경 도면 ③ 새 도면 요소 (2026-10-09)` 절: 세 기능 각 한 줄, 업데이트 안내 한 줄, `- [ ] 운영 DB 적용: 2026-10-09-background-map-elements.sql (적용 버전 번호·함수 본문 대조 결과)`, `- [ ] 수동 검증(설계 11절 전체)`, `- [ ] 배포 뒤: 한솔의 PC를 모두 1.133.0으로 올린 뒤 새 요소의 첫 저장과 새로 고침`.
  - `DEVLOG/background-3d-opus-handoff-2026-10-07.md`: §13.3 :266과 검토 기록 :297에 사슬 문장을 덧붙이고(4.3), `## 17. ③ 새 도면 요소 (v1.133.0)` — 17.1 문서 위치(이 설계, 구현 계획 `docs/superpowers/plans/2026-10-09-background-map-new-elements.md`, 검증 기록의 절 이름) · 17.2 파일(9절의 표) · 17.3 운영 DB(4.5의 '적는 것': 적용 버전 번호·시각, 본문 md5 전·후, 권한, 점검 호출 결과, 사슬과 다시 실행 규칙) · 17.4 뒤 차례가 지켜야 할 것(저장 모양을 넓히는 법 — 새 파일을 사슬 끝에, DB 먼저 / **넓히는 migration을 운영에 적용한 뒤 그 앱 버전의 배포가 끝날 때까지 운영에 새 모양을 저장하지 않는다 — 개발 빌드로도, 검증하면서도. 첫 저장은 배포된 버전에서, 그 화면을 여는 PC를 모두 올린 뒤에 한다. 그러지 않으면 그 모양을 모르는 PC가 모두 업데이트 안내를 띄우는데 올릴 버전이 없다(④ 뒤에는 팀 전체다)** / 앞 파일만 다시 돌려 22023이 거듭 나올 때 도면을 지우거나 새 모양을 빼고 저장해 풀지 않는다(그 쓰기는 지나가고, 지운 도면은 되살릴 수 없다) — 사슬을 다시 적용한다 / **저장 모양은 새 선택 키 또는 닫힌 목록의 새 문자열로만 넓힌다. 기존 키의 숫자 범위·값 타입·개수 한계를 넓히면 이전 버전에는 업데이트 안내가 아니라 오류로 보인다** / 미리보기 저장소 키는 그대로 두었다: v1.133.0의 미리보기가 새 모양을 저장한 주소에서 v1.132.0 이하의 코드를 미리보기로 띄우면 라이브러리 전체를 거절한다(§13.3 :267의 3D 값과 같은 정책). 이전 코드와 견줄 일이 있으면 다른 포트를 쓴다 / 화면을 여는 버전은 업데이트 안내가 든 버전이어야 한다 / 닫힌 목록의 새 검사는 `known` / 선택 키는 지워서 되돌린다 / 도로는 `isRoadSpace`·`spaceWallHeight`·쌓임 순서의 층, 3D의 처음 누름은 `pickMapNode`의 맨 앞 걸음(같은 광선의 방과 `spacesOverlap`으로 겹친 도로만 진다 — 겹치지 않는 도로에는 v1.132.0의 규칙)이고 다시 누름의 더미는 `mapSpacePile` 한 곳(클릭과 손잡이 위의 클릭이 함께 쓴다) / 가운데 점선의 띠 규칙 넷 / 색은 이름(칸의 이름)으로, 동그라미는 여섯 / 1.1의 I1~I6에 다른 답이 왔을 때 고칠 곳) · 17.5 뒤 차례가 정할 것(④의 파일이 사슬의 넷째로 붙으며 세 머리말에 한 줄씩 더한다. **④가 `CLAUDE.md` :3·`AGENTS.md` :3의 시험 공개 안내 줄을 다시 쓸 때 사슬 문장을 옮겨 적는다** — 계약 테스트 D4는 그 두 줄의 글자를 고정하지 않고(옛 두 파일 문장이 없다는 것만 본다) 긍정 문구는 `AGENTS.md` 데이터 경계 항목과 SQL 머리말에서 본다. ④가 그 항목이나 머리말의 문장을 고치면 같은 변경에서 D4를 맞춘다. ⑤의 주석 핀이 도로·계단과 어떻게 놓이는지는 ⑤가 정한다).
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-09 ③ 새 도면 요소 (v1.133.0)`(검증한 날이 다르면 그 날짜로) — 10.10의 수치(PGlite를 지정한 실행의 DB 계약 수 포함), 11절 결과(E1~E5와 C1·C8의 관찰, U1~U5, R13의 세 폭), 검증에 쓴 미리보기 주소와 그 저장소에 새 모양이 남아 있는지(11절 머리말), 운영 DB 적용 결과(4.5), 확인하지 못한 것.
  - `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`: B3 절에 설계·구현 계획 링크와 상태 한 줄, 7절 진행 기록 표의 ③ 행(설계 문서 경로, 상태).
  - 요소 파일 머리말의 `Applied to production …` 줄(적용 뒤).
  - 완료 보고(한솔에게): 14.3을 비개발자 문장으로 옮겨 적는다.
  - `CLAUDE.md`: 맨 위 안내 줄(:3)의 다시 실행 문장을 세 파일 사슬로 고친다(4.3 — `AGENTS.md` :3과 같은 글자). 운영 적용 뒤 그 줄에 적용 기록을 더한다. 그 밖의 줄은 고치지 않는다(구조 변경 없음).

---

## 13. 구현 순서 (단계마다 typecheck·`test:background`가 통과하게)

**게이트와 누가 보는가.** 단계마다 `npm run typecheck`와 `npm run test:background`가 통과해야 다음 단계로 간다 — 그래서 각 단계의 테스트는 **그 단계까지 생긴 이름만** import한다(아직 없는 이름을 import하면 그 테스트 파일 전체가 실패한다). SQL이나 `domain.ts`를 고치는 1·2단계와, 계약 테스트가 PGlite 실행에서만 부르는 `addMapCamera`·`applyNodeWorldPose`를 고치는 4단계는 `BFLOW_PGLITE_MODULE`을 지정해 계약 테스트도 돌린다(지정하지 않으면 그 부분은 건너뛴다). `npm run build:vite`를 포함한 10.10의 전체 기준은 7단계에서 돈다. **단계 끝의 "…을 본다"(U1~U4, E1·E2, E3~E5, C1)는 구현자가 아니라 오케스트레이터가 한다** — 그 단계의 게이트가 통과한 뒤, 다음 단계를 시작하기 전에(14.2의 대체안이 걸린 확인이라 뒤 단계가 그 위에 쌓이기 전에 본다). 구현자는 자기 단계의 게이트까지만 한다.

1. **계약**: `types.ts`(종류·타입·선택 키), `domain.ts`(상수 셋, 새 키와 값 검사 — 이 단계에서는 `requireValue`로 두어도 되고 `known`을 먼저 넣어도 된다), `mapSpatial.ts`의 `SYMBOL_VOLUME_HEIGHTS.stairs`(타입이 요구한다), 요소 파일, 다시 실행 규칙이 적힌 곳 전부(4.3 — 두 적용 파일의 머리말, `AGENTS.md` :3·:106·:111·:114, `CLAUDE.md` :3, 인수인계 §13.3 :266과 :297), 계약 테스트(D1~D5, P1~P4. CRLF 복사본에서도 한 번, 10.10), 도메인·저장소 전달·미리보기 테스트(10.2의 왕복·값 검사·잘못 붙은 키와 10.8 — 오류의 **문장**까지. 오류의 **종류**를 보는 검사는 2단계에서 더한다), 고정 값 수정(10.1의 :113, :282, :72, :313, :110, :175). 이 시점에 앱과 서버 파일이 새 모양을 **받아들이지만** 만드는 화면은 아직 없다(계단은 '기타 사물'로 보인다). **PGlite를 지정해 DB 테스트를 돌린다.**
2. **읽기 장치**: `BackgroundUnsupportedError`·`known`·`onlyKeys`·노드 종류 검사의 자리, `useBackgroundStore.ts`, `BackgroundLibraryView.tsx` + 테스트(5.5). `domain.ts`를 다시 고치므로(`known`, `onlyKeys`, 노드 종류 검사의 자리) **PGlite를 지정해 계약 테스트를 다시 돌린다.** 오케스트레이터가 다음 단계를 시작하기 전에 U1~U4를 본다.
3. **계단**: `symbolCatalog.ts`(항목 + 대체값), `BackgroundSymbolGlyph.tsx`, `map3dScene.ts`의 가지, 기호 목록 제목 + 테스트(10.4의 목록, 10.7의 계단, 10.1의 :182-186). 오케스트레이터가 다음 단계를 시작하기 전에 E1·E2를 본다.
4. **도로 — 순수 부분**: `mapSpatial.ts`(판별·벽 높이·가운데 선), `mapStack.ts`(층), `mapGeometry.ts`(`setSpaceSurface`, `addMapCamera`, `applyNodeWorldPose`), `mapPlanPreview.ts` + 테스트 — **이 단계까지 생긴 함수의 것만**: 10.3의 `stackedSpaces`·`spaceStackRanks`·`spacesAt`, `addMapCamera`, `setSpaceSurface`, `applyNodeWorldPose`, `surface`를 싣고 가는 길(`rectToPolygon`·`polygonFromWorldPoints`·`transformMapSpace`) / 10.4의 `isRoadSpace`·`spaceWallHeight`·`roadCentreLine`·`roadCentrePlanLine`(표, 조건별 변형, 성질) / 10.5. 10.3의 `spacesOverlap` 표와 `resolvePlanPress`는 5단계의 것, `setCameraColor`는 6단계의 것이고, 10.4의 `getSymbolPreset`은 3단계에서 이미 넣었다. 계약 테스트도 `addMapCamera`와 `applyNodeWorldPose`를 부르는데 PGlite 실행 부분에서만이다(`tests/backgroundDatabaseContract.test.ts:342`, `:358`) — **PGlite를 지정해 계약 테스트를 한 번 돌린다.** 화면은 아직 도로를 만들지 못하지만, 저장된 도로는 방 아래에 쌓인다.
5. **도로 — 화면**: 편집기(도구·그리기·'공간 종류'·높이 칸·이름들), 보조 평면도, `map3dScene.ts`의 도로 가지와 팔레트, `mapStack.ts`의 `spacesOverlap`, `pickMapNode`의 맨 앞 걸음(`roadsUnderRooms`)과 `mapSpacePile`(`mapClickStep`의 한 줄, `BackgroundMap3D.tsx`:562와 import), `BackgroundMap3D.tsx`·`BackgroundMapCameraGizmo.ts`의 `flat`, CSS(**변수 블록의 도로 쪽** — `--bmap-road`·`--bmap-road-mark`, 두 화면(8.3). 이 단계의 도로 규칙이 모두 그 변수를 쓴다 — 그리고 9.4의 도로 규칙, 도로 이름의 테두리 포함) + 테스트(10.3의 `spacesOverlap` 표와 `resolvePlanPress` 둘, 10.7의 도로·누름(맞춤 표·장면 셋·뷰포트 둘·손잡이)·범위·기즈모·테마의 도로 색, 10.6의 도로 쪽 — 표의 라·마·바와, `--bmap-road`·`--bmap-road-mark`의 두 값이 CSS에 있고 `MAP3D_DARK_PALETTE.road`·`roadMark`와 같은 색이라는 검사 — , 앵커 26·31의 수정). 오케스트레이터가 다음 단계를 시작하기 전에 E3~E5를 본다.
6. **카메라 색**: `mapCameraColor.ts`, `setCameraColor`, `BackgroundMapCameraColor.tsx`, 편집기 배선, `data-camera-color` 여덟 곳, CSS(**변수 블록의 카메라 쪽** — `--bmap-cam`·`--bmap-cam-mark`와 `[data-camera-color]` 줄들(8.3) — ·호박색 치환·동그라미·보조 평면도), `map3dScene.ts`의 재질 + 테스트(10.3의 `setCameraColor`, 10.6의 나머지 — 색 표, 색마다의 CSS 규칙과 `--bmap-cam`의 기본값, 표의 가·나·다·사 — , 10.7의 색). 오케스트레이터가 다음 단계를 시작하기 전에 C1을 본다.
7. 앵커 40~49와 뮤테이션 확인(임시 복사본에서), 버전·기록·문서(12절), 그리고 그것까지 넣은 마지막 상태에서 **10.10의 전체 통과 기준**: `npm run typecheck`, `npm run test:background`, `npm run build:vite`, PGlite를 지정한 계약 테스트 한 번, CRLF 복사본에서 계약 테스트 한 번. 수동 검증(11절)은 그 뒤에 오케스트레이터가 한다(아래).

**오케스트레이터만 하는 일(구현자는 하지 않는다)**

- 앱 엔진 확인(11절)과 그 결과에 따른 14.2의 대체안 선택. 2·3·5·6단계 끝의 확인(U1~U4, E1·E2, E3~E5, C1)도 여기에 든다 — 그 단계가 끝난 뒤, 다음 단계를 시작하기 전에 본다. **C8을 마친 여섯 색의 화면을 머지 확인 때 한솔에게 보인다**(5.4의 1 — 운영 DB 적용보다 먼저).
- PR 머지(한솔 확인 뒤).
- **운영 DB 적용(4.5) — 머지 뒤, 앱 배포 전.** 적용 기록을 문서에 적는다.
- 빌드와 G드라이브 배포(한솔 확인 뒤), 배포 뒤 실기 확인의 안내.

---

## 14. 열린 질문과 확인 필요

### 14.1 한솔에게 물을 것

없다. 승인 문구가 수를 정한 곳은 그 수대로 만든다 — 색 동그라미는 여섯 개다(검토 전의 설계는 호박색 '기본' 동그라미를 더해 일곱을 그렸고, 그것은 승인된 수와 어긋났다. 여섯으로 바로잡았다). 승인 문구가 조건을 단 곳은 그 조건대로 만든다 — 3D에서 도로가 건물에 지는 것은 "건물과 **겹치면**"이다(검토 전의 설계는 겹치지 않는 건물에도 지게 했고, 그것은 승인 문구에 없는 동작이었다. 겹친 건물로 좁혔다 — I4). 승인 문구가 한 가지로 정하지 않는 여섯 곳(1.1의 I1~I6 — 호박색으로 돌아가는 길, 가운데 점선이 그려지는 모양, 새 카메라의 소속, 3D에서 "겹치면"의 판정, 큰 방 안에 통째로 든 도로, 여섯 색의 색상)은 운영 DB를 다시 건드리지 않고 고칠 수 있는 답으로 정했고, 완료 보고의 첫 여섯 줄로 알린다(14.3).

**저장 계약 가운데 승인 문구에서 그대로 나오는 것과 이 설계가 고른 것을 가른다.** 승인 문구에서 나오는 것: 기호에 계단이 생긴다는 것, 도로가 공간의 한 종류라는 것, 카메라 색이 **여섯**이고 보라가 없다는 것. 이 설계가 고른 것: 저장되는 글자(`stairs`, `surface: 'road'`, `color`)와 **색 이름 여섯(`red`·`lime`·`green`·`teal`·`blue`·`pink`) — 곧 여섯의 색상**이다. 검토 전의 이 절은 색 이름 여섯까지 "승인 문구에서 그대로 나온다"고 적었는데 틀렸다. 그 이름들은 운영 DB를 적용하는 순간 검증 함수에 들어가고, 그때까지 한솔은 색을 본 적이 없다. 그래서 둘을 한다: (가) 이름을 **칸의 이름**으로 정해, 색에 대한 답이 무엇이든 DB를 다시 건드리지 않고 앱에서 고치게 한다(3.1 — "저장 규칙을 한 번 추가한다"가 지켜진다). (나) C8과 여섯 색의 화면 확인을 DB 적용 **앞에** 둔다(5.4의 1). (나)는 구현 전에 묻는 것이 아니라 머지 확인을 받을 때 함께 보이는 것이다.

### 14.2 앱 엔진에서 확인할 것

각각 대체안을 정해 둔다. 설계 중에는 코드를 읽고 순수 함수의 값만 계산했다. 앱에서 돌려 본 것은 없다(3D의 누름 규칙과 겹침 판정만은 Node에서 장면 모듈과 뷰포트 클래스를 돌려 확인했다, 7.6 — 그것도 앱 화면은 아니다. CSS는 하나도 그려 보지 않았다).

| 확인할 것 | 기대와 근거 | 앱에서 다르면 |
|---|---|---|
| 계단의 선이 평면에서 다른 기호와 어울리는지 — 의자·침대 옆에서 10%·100%·400% (E1) | 계단의 상자와 화살표는 다른 기호와 같은 `<g>`의 굵기 3.2를 물려받는다(그림 단위. `vector-effect` 없음, 6.2) | 계단만 무겁거나 가벼우면 디딤판의 굵기(2)와 불투명도(0.65)만 고친다. `vector-effect`는 넣지 않는다(확대율에 따라 이웃 기호와의 굵기 관계가 뒤집힌다) |
| 16~28px 아이콘에서 디딤판 다섯 줄이 줄무늬로 읽히고 다른 다섯 아이콘과 무게가 어울리는지 (E2) | 16px에서 디딤판 선 0.28px·간격 2.1px, 상자와 화살표 0.44px(다른 아이콘의 선과 같다) | 뭉치거나 흐려서 읽히지 않으면 그림의 디딤판을 세 줄(y 27, 50, 73)로 줄이고 굵기를 3.2로 올린다(모든 자리에서 같은 그림이다 — 아이콘만 다른 그림을 쓰지 않는다). **디딤판의 수가 바뀌므로 같은 변경에서 함께 고친다**: 앵커 48이 고정한 디딤판의 `d` 글자(10.9), 6.2의 그림과 "다섯 줄" 서술, 11절 E1의 "디딤판 다섯 줄", 14.3의 "디딤판이 늘 다섯 줄" |
| 도로 가운데 점선의 점선 길이가 화면에서 일정한지 (E3) | 상자의 점선(`.bmap-marquee`)이 같은 조합(`stroke-dasharray` + `non-scaling-stroke`)이다 | 확대에 따라 변하면 그대로 받아들이고 완료 보고에 적는다(도면 단위 점선) |
| 3D에서 소수 `renderOrder`(−1.5)가 순서를 정하는지 (E4) | three 0.186.1은 `a.renderOrder - b.renderOrder`로 정렬한다(`WebGLRenderLists.js`) | 깜빡이면 정수로 다시 매긴다: 기본 바닥 −4, 밑그림 −3, 도로 −2, 방 −1(기존 두 값도 함께 옮긴다). **같은 변경에서 함께 고친다**: 앵커 44가 고정한 `floor.renderOrder = road ? -1.5 : -1;`(10.9), 10.7의 도로 줄("바닥의 `renderOrder`가 −1.5"), 7.6의 '그리는 순서' 줄. 기본 바닥과 밑그림의 값(지금 −3·−2)은 어느 테스트도 고정하지 않는다 |
| 3D 도로 점선(`dashSize` 14, `gapSize` 10)이 보통 거리에서 점선으로 읽히는지 (E5) | 잠긴 공간의 점선이 12·7이다 | 값만 고친다(화면 값이다) |
| 기본 카메라의 색이 v1.132.0과 같은지 (C1) | 변수의 기본값과 투명도가 지금 값의 다른 표기다 | 다르면 그 규칙만 지금의 16진수 글자로 되돌리고, 색 있는 카메라용 규칙을 `[data-camera-color]` 선택자로 따로 적는다. **그러면 `.bmap-camera` 줄에 16진수 글자가 남으므로 10.6의 '가'를 함께 고친다**(16진수 글자가 없어야 하는 줄을 `[data-camera-color]`가 든 줄로 좁히고, `var(--bmap-cam)`·`var(--bmap-cam-mark)`도 그 줄들에서 찾는다. 10.9의 변형 "호박색 글자 하나를 남김"도 그 줄에 넣는다) |
| 여섯 색이 두 화면에서 서로·방·기호·도로와 구분되는지 (C8) | 색상환에서 벌려 골랐다 | 값만 고친다(`mapCameraColor.ts`와 CSS 두 벌, 10.6의 테스트가 함께 맞는지 본다). 이름과 저장 계약은 그대로다 |
| 색 동그라미의 눌림 고리와 포커스 고리가 두 화면에서 보이는지, **지금 색의 동그라미에 포커스를 두었을 때 둘이 함께 보이는지**, '기본 색으로'의 흐린 상태가 읽히는지 (C2, C7) | 눌림 고리는 글자색과 카드색 두 겹(가장자리에서 2~4px), 포커스 고리는 `outline-offset:5px`로 그 바깥(5~7px)이다. 동그라미 사이는 12px. 흐린 글자는 보조 글자색의 45%다 | 고리의 굵기·간격·흐림 정도만 고친다. 그래도 둘이 엉겨 보이면 눌림 표시를 동그라미 **안쪽**으로 옮기고(`box-shadow:inset 0 0 0 2px 카드색, inset 0 0 0 4px 글자색`) 동그라미의 포커스 규칙을 뺀다(공용 고리로 돌아간다. 10.6의 '사'를 그에 맞춘다) |
| '기본 색으로'를 누른 뒤 포커스가 그 버튼에 남고 편집기의 키가 닿는지 (C4, C7) | `aria-disabled`는 포커스를 건드리지 않는다(`disabled`가 아니다) | 닿지 않으면 누른 뒤 `event.currentTarget.focus()`를 한 번 부른다 |
| 도로의 이름이 **10%~400% 어디서나** 가운데 점선 위에서 읽히는지, 테두리가 회색 바닥 위에서 얼룩처럼 보이지 않는지 (E3, R1) | 테두리는 카메라·기호 이름과 같은 꼴(`paint-order:stroke`, 바탕색)이고 굵기만 `calc(4px * var(--bmap-label-scale,1))`이다 — 글자 크기와 같은 변수를 곱해 화면에서 약 4px. 같은 `calc()` 꼴이 이 파일의 `font-size`와 `transform`에서 이미 쓰인다(:52-53, :71) | `stroke-width`의 `calc()`가 이 엔진의 SVG 글자에 듣지 않으면(테두리가 없거나 확대율에 따라 굵기가 변하면) 같은 값을 인라인으로 준다: 도로의 `<text>` 둘에 `style={{ strokeWidth: 4 * labelScale }}`(편집기가 이미 가진 `labelScale`, :268) — 10.6의 '마'와 앵커 41의 글자를 그에 맞춘다. 얼룩져 보이면 `4px`을 `3px`으로 줄인다(변수는 그대로 곱한다). 그래도 거슬리면 테두리를 빼고 이름을 가운데에서 아래로 옮긴다(`.bmap-space.is-road text { transform: translateY(calc(14px * var(--bmap-label-scale,1))); }` — 세로 도로에서는 점선이 여전히 이름을 지나므로 앞의 길들을 먼저 쓴다) |
| 740px에서 도구줄이 한 칸 늘어도 넘치지 않는지, **1210·1300px에서 이름 붙은 그리기 도구가 넷이 되면서 도구줄이 새로 두 줄로 접히는지** (R13) | 도구줄은 도면 위에 떠 있고 줄바꿈된다(backgrounds-map.css:38). 도구 이름은 1200px 이하에서 감춰지므로(:138) 도구줄이 가장 좁은 것은 740이고 **가장 넓은 것은 1201px 바로 위**다. 접히는 폭은 CSS에서 어림했고 앱에서 재지 않았다 | 740에서 도면을 가리면 도로 도구의 이름을 감춘다(이미 감춰져 있어 그럴 일은 적다). 1201~1400px 언저리에서 v1.132.0에는 없던 둘째 줄이 생기면: 기본은 **받아들이고 완료 보고에 적는다**(가리는 것은 도면 왼쪽 위의 한 줄 높이, 약 38px이다). 한솔이 거슬린다고 하면 그리기 도구 넷(사각형·타원·다각형·도로)의 이름만 한 단계 일찍 감춘다 — 그 네 버튼에 클래스 하나와 `@media(max-width:1400px)` 규칙 한 줄(`title`과 접근성 이름은 그대로 남는다) |

### 14.3 완료 보고에 적을 것

승인된 동작에서 따라 나오지만 한솔이 직접 고른 적은 없는 것이다. 첫 여섯 줄이 1.1의 I1~I6이다.

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

### 14.4 알고 넘어가는 것

- 가운데 점선의 띠 규칙(7.4)은 "양쪽이 마주 보는 길"만 고르도록 넷으로 좁혔지만, 길이가 폭 이상인 넓적한 다각형(세로가 가로만큼 긴 육각 광장 등)은 띠로 읽힌다. T자·십자, 한쪽에만 점이 많은 길, 끝이 뾰족한 길에는 그려지지 않는다. 다각형 밖으로 나가는 선은 그려지지 않는다((라)).
- 띠 규칙의 60°(안쪽 가로대가 길 방향과 이루는 각)는 화면 값이다 — 저장 계약과 무관하게 다듬을 수 있다. 점을 200개까지 가진 도로에서 `roadCentreLine`은 시작 번호마다 점을 한 번씩 훑는다(많아야 100 × 200번의 간단한 셈). 그릴 때마다 부르지만 따로 기억해 두지 않는다.
- 3D에서 올린 도로가 **두 방의 바닥 높이 사이**에 있는 자리(위층 방, 그 아래의 고가, 그 아래의 방 — 셋이 평면에서 겹친다)를 천천히 거듭 누르면 넘어가는 순서가 위층 방 → 도로 → 아래 방이다(바닥 더미는 가까운 높이부터이고 고치지 않았다). 평면의 순서(방을 다 지난 뒤 도로)와 다른 유일한 자리다. 처음 누를 때 잡히는 것은 그 도로와 겹친 방이 광선에 있는 한 방이다.
- 3D에서 건물 밑 도로의 벽 너머 자리(7.6)의 더미에 드는 방은 **처음 잡힌 방 하나**(가장 가까운 벽의 방)다. 그 광선에 벽만 걸친 다른 방은 들지 않는다 — 방끼리도 벽으로만 맞은 방은 넘기지 않는다(②). 그런 방은 그 방의 바닥이 보이는 곳에서 누른다. **그 처음 잡힌 방이 도로와 겹친 방이 아닐 수도 있다**: 한 광선에 도로 옆에 선 방의 벽(앞)과 도로 위에 선 방의 벽(뒤)이 함께 걸리면, 도로는 뒤의 방 때문에 빠지고 남은 것 가운데 가장 가까운 벽 — 앞의 방 — 이 잡힌다(바닥이 하나도 없을 때의 지금 규칙). 다시 누르면 도로다. 그 자리의 도로에 상세 도면이 없으면 도로를 고른 채 더블클릭해도 건물의 것이 된다(②의 겹친 방과 같다).
- 한 광선에 도로가 둘이고 방이 그 가운데 하나 위에만 서 있으면, 방 밑의 도로만 빠지고 다른 도로의 바닥이 벽을 이긴다 — 교차로 곁의 건물 벽 너머로 두 도로가 겹친 자리가 보이면 건물 밑이 아닌 쪽 도로가 잡힌다(그 도로는 그 건물과 겹치지 않으므로 승인 문구의 조건 밖이다).
- 도로가 겹친 방에 지는 것은 높이와 무관하다(7.6). 그래서 도로보다 **아래** 높이에 놓은 방(지하)이 그 도로와 평면에서 겹치면, 도로 표면을 눌러도 광선이 그 방에 닿는 자리에서는 그 방이 잡힌다. 평면에서 그 방이 도로 위에 그려지는 것과 같은 순서다.
- `spacesOverlap`은 1e-6 도면 단위보다 얇게 걸친 것을 겹친 것으로 세지 않고, 타원을 3D 바닥과 보조 평면도가 그리는 48각형으로 본다(평면 자체는 참 타원을 그리고 `containsPoint`도 참 타원으로 센다 — 48각형은 그보다 반지름의 0.2%쯤 안쪽이다). 누를 때마다 다시 셈하고 기억해 두지 않는다(7.6).
- 길가 건물을 그리기 도구로만 그리면(그리기는 스냅하지 않는다) 길과 조금 떨어지거나 조금 걸친다. 걸친 건물은 겹친 건물이다(I4) — 이것을 느슨하게 보는 여유(예: 몇 단위까지는 맞닿은 것으로)는 두지 않았다: 승인 문구가 "겹치면"이고, 얼마부터가 겹침인지에 대한 답이 없다.
- 3D에서 기호를 놓을 자리는 지금처럼 눈에 가까운 바닥 위의 점이다(올린 도로 위를 누르면 그 점). 소속과 선 높이는 평면의 쌓임 순서가 정하므로, 그 점 아래에 방이 있으면 기호는 그 방의 바닥에 선다(누른 고가 위가 아니다).
- 겹친 도로 둘의 평면 채움은 겹친 곳이 조금 더 진하다(반투명 채움 두 겹 — 겹친 방과 같다).
- 도로를 방으로, 방을 도로로 바꾸면 쌓임 순서가 바뀌어 그 `<g>`가 DOM에서 자리를 옮긴다. 바꾸는 칸은 속성 칸에 있어 포커스에 영향이 없다.
- 한 번 쓴 카메라 색의 3D 재질은 그 색의 카메라가 없어져도 테마가 바뀌거나 3D를 닫을 때까지 남는다(많아야 36개).
- 업데이트 안내는 "모르는 값"과 "깨진 값"이 함께 있을 때 먼저 만난 쪽을 따른다. 어느 쪽이든 화면은 열리지 않고 자료는 그대로다.
- 이미 최신 버전인 PC에서 업데이트 안내가 뜨는 경우(손으로 고친 미리보기 저장소, SQL로 직접 넣은 자료, 앞서 나간 개발 빌드)에는 안내가 사라지지 않는다. 무엇이 걸렸는지는 콘솔의 `[background] update required: …` 한 줄(문장과 `detail`)로 본다 — **안내가 켜질 때 한 번** 적히고, 떠 있는 동안의 다시 읽기(15초·포커스·신호)는 다시 적지 않는다. 그 사이에 까닭이 달라져도(다른 모르는 값이 더 저장돼도) 줄은 처음 것 하나다. 어느 도면의 어느 노드인지는 싣지 않는다(키 이름이나 값으로 찾는다).
- **미리보기 저장소 키는 그대로 두었다**(`bflow-background-library-preview-v1` — 3D 값 때와 같은 정책, 인수인계 §13.3 :267). v1.133.0의 미리보기가 계단·도로·카메라 색을 저장하거나 검증이 모르는 종류를 심은 주소(origin)에서 v1.132.0 이하의 코드를 미리보기로 띄우면, 그 코드는 라이브러리 전체를 거절한다(빨간 띠와 빈 화면 — 2.2의 이전 버전 동작이 미리보기에서 그대로 난다). 다른 세션·워크트리가 같은 주소를 쓰고 있으면 그쪽 화면이 깨져 보인다. 수동 검증은 전용 주소에서 하고, 끝나면 저장소의 상태를 검증 기록에 적는다(11절 머리말). 인수인계 17.4에도 적는다.
- 좁은 검증 함수가 돌아와 있는 동안에도 새 모양이 든 도면을 **지우는** 쓰기와 새 모양을 빼고 저장하는 쓰기는 지나간다(4.2). 그것을 막는 장치는 만들지 않았다(적용된 함수의 본문을 고쳐야 한다). 머리말·AGENTS.md의 경고와 P4의 ③으로 남긴다.
- 읽기 장치가 알아보는 "더 새 자료"는 모르는 키와 닫힌 목록 밖의 문자열 둘뿐이다(5.2). 다른 식으로 넓힌 저장 모양은 이 버전에 오류로 보인다 — 뒤 차례의 규칙으로 적었다(12절).
- 이전 버전의 동작(2.2)은 이미 배포된 것이라 고칠 수 없다. 소유자 PC를 모두 올린 뒤 새 요소를 쓰는 것이 유일한 막음이다.
- 2026-10-08의 운영 적용이 LF 글자로 들어갔는지 CRLF 글자로 들어갔는지는 기록에 없다(그때 "md5 일치"만 적고 값은 적지 않았다). 4.5의 적용 전 확인 (2)가 두 값(`956240d8…` LF, `5ec213a0…` CRLF)을 받아들이고 어느 쪽이었는지 적는다. 그 밖의 값이면 멈춘다. 요소 파일은 blob의 LF 글자로 넣는다.
- 작업 폴더의 줄 끝은 PC와 체크아웃 방식에 따라 다르다(4.1). `.gitattributes`에 SQL 파일의 줄 끝을 못 박는 규칙은 더하지 않는다 — 다른 세션의 작업 폴더에 있는 migration 파일들이 한꺼번에 "바뀐 파일"로 보이게 된다. 테스트가 줄 끝을 맞춰 읽고, 운영 적용은 blob에서 꺼내는 것으로 막는다.
- 터치 입력은 대상이 아니다.
