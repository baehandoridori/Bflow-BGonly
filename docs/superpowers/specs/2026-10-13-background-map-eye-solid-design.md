# 배경 도면 — 오브젝트 목록의 눈 · 방을 속이 안 보이는 박스로 보기 — 설계 (2026-10-13)

> 요청(한솔, 2026-10-13, 말 그대로 — 안이 비쳐 보이는 3D 화면과, 속성 칸의 오브젝트 목록을 찍은 그림과 함께): "… 이 오브젝트 탭에서는 눈을 키고 끄는것도 가능하게 해줘. 또한 속성탭에서 지금은 안이 와이어프레임처럼 다 보이는데, 안 보이게끔, 하나의 큰 박스로만 보이게끔도 해줘. … 이부분 수정해서 배포까지 진행해줘."
> 묶음: 그날의 요청 여섯을 세 번에 나눠 낸다. **이 문서는 2차 — (c) 눈, (d) 박스 — 만** 다룬다. 1차(숫자 끌기·카메라 높이 끌기·도면 바로 삭제, v1.136.0)가 머지된 **뒤에**, 그 main에서 만든다. 3차(그림 끌어다 놓기·붙여 넣기)와 "저장 안 한 편집을 이 PC에 보관"은 범위 밖이다.
> 한솔에게 알린 것(2026-10-13) — 이 설계의 제품 결정이다: ① 오브젝트 목록의 줄마다 눈 버튼이 생긴다. 끄면 그 항목이 평면·3D·옆의 작은 평면에서 사라지고 눌리지도 않는다. 숨긴 줄은 흐리게 남아 이름을 누르면 다시 보이고, 도면 아래에 '숨김 N개 · 모두 보이기'가 늘 떠 있다. ② 3D에서 방을 고르면 속성에 '속이 안 보이는 박스로 보기'가 생기고, 켜면 그 방이 뚜껑 덮인 한 덩어리로 보인다('모든 공간을 박스로 / 모두 비치게'도 있다). ③ 둘은 '보는 방식'이다: 이 PC의 내 계정에만 도면별로 기억하고, 도면에 저장되지 않아 다른 PC 화면은 바뀌지 않는다. 되돌리기(Ctrl+Z) 대상이 아니고 '저장 안 한 변경'에도 잡히지 않는다. ④ 방의 눈을 꺼도 그 안의 사물과 카메라는 그대로 보인다(그 줄만 숨긴다). ⑤ 서버·DB 변경은 없고, 배경 메뉴가 보이는 계정(지금은 배한솔)에서만 달라진다.
> 버전: v1.137.0(머지 직전에 `origin/main`을 다시 확인) · **운영 DB·IPC·메인 프로세스·저장 모양 변경 없음** · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: `56cbc744` — 1차(v1.136.0)를 구현한 가지 `claude/bg-map-scrub-height-delete`의 머지 직전 끝(1차의 최종 검토 반영까지). 그 밑은 main v1.135.1 `42584da6`(= a1436e9f + 배포 기록)이다. 이 문서는 처음에 `42584da6`에서 줄 번호를 확인했고, 1차가 구현된 뒤 1차가 고친 파일(`BackgroundMapEditor.tsx`·`backgrounds-map.css`·`BackgroundMapPlanPreview.tsx`·`mapCanvas.ts`·`mapPlanPreview.ts`·`tests/backgroundMapEditorWiring.test.ts`)을 가리킨 줄을 `56cbc744`의 줄로 고쳤다. 그 밖의 파일은 1차가 건드리지 않아 두 커밋의 줄이 같다. `42584da6`의 줄을 그대로 둔 곳(1차가 지운 줄, 12절의 기록)은 그 커밋을 함께 적었다. 머지 전에 1차가 더 고쳐지면 줄이 다시 밀린다 — 그래서 고칠 자리는 줄 번호와 함께 **그 줄의 글자**로 적었다(6.2). 1차가 바꾼 것 가운데 이 문서에 닿는 것은 2.8에 모았다.
> 자리: 저장소 밖에서 쓰고, 1차가 머지되고(PR #328, main `1e3dae22`) v1.136.0이 배포된 뒤(2026-10-14) 2차 가지 `claude/bg-map-eye-solid`에서 이 자리로 옮겼다. 1차의 설계(`docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md`)는 이 문서를 쓰는 동안 작업 폴더에 놓였다(커밋 전). 그 문서의 6절(편집기에서 고치는 자리, 앵커 50·52·53·56·59와 새 60~66, `dialogOpen`)과 8절(문서)을 읽고 2.8·6.5·9절을 맞췄다. 1차가 구현된 뒤 그 코드(`56cbc744`)와 다시 대조해 이 문서를 고쳤다(앵커 52의 수, 앵커 64가 고정하는 세 줄, 옆 그림이 쓰는 길, 줄 번호 — 2.8에 모았다). **머지된 1차가 그 코드와 달라진 곳은 2차의 첫 일로 다시 본다**(11.2의 마지막 줄) — 머지된 main `1e3dae22`의 `src`·`tests`는 `56cbc744`와 같다(2026-10-14 확인: 그 사이의 커밋은 문서 넷뿐).

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다.** 알린 다섯 가지가 한 가지로 정하지 않는 곳은 이 설계의 답으로 정했고(1.2) 완료 보고에 적는다(11.3). 바뀌지 않는 코드는 다시 적지 않는다: 코드를 그대로 적은 곳은 앵커가 글자로 고정할 줄, 잘못 읽으면 동작이 달라지는 줄, 화면의 글자뿐이다.

용어: **눈** = 오브젝트 목록의 줄마다 있는 숨기기 버튼. **숨김** = 이 PC의 이 계정이 그 도면에서 그 노드를 그리지 않기로 한 것(`hiddenIds`). **박스** = 3D에서 방을 여섯 면이 막힌 불투명한 덩어리로 그리는 것(`solidIds`). **보기 설정** = 숨김과 박스. **방** = 도로가 아닌 공간(이 문서의 말이다 — 화면과 업데이트 내역의 글자는 화면이 늘 쓰는 '공간'으로 적는다, :156). **묶음** = 평면에서 고른 여러 개(`selection.ids`). **손에 든 것** = 3D와 속성 칸이 다루는 한 노드(`singleId`). **품는다** = 닫힌 방이 어떤 노드를 온전히 안에 두고 있다(`spaceHoldsNode`, 5.1). **걸러 본 도면** = 숨긴 노드를 뺀 사본(`shownMap(map, hiddenIds)`). **쓰는 곳** = 도면 값을 문서에 적는 모든 길(평면의 포인터 세션, 3D의 기즈모, 속성 칸, 1차의 숫자 끌기와 옆 그림의 높이 끌기, 저장). 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다. 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

---

## 1. 목표와 범위

### 1.1 만드는 것

- **(c) 눈**: 오브젝트 목록의 줄마다 눈 버튼. 끄면 그 노드가 평면·3D·보조 평면도에서 그려지지 않고, 눌리지도 상자로 잡히지도 스냅에 붙지도 않으며, 숨긴 방은 새 기호를 받지도 않는다. 그 줄 하나만 숨긴다(④). 숨긴 줄은 제자리에 흐리게 남고, 이름을 누르면 다시 보이면서 선택된다. 목록 제목에 '숨김 M · N개'와 '모두 보이기', 도면 아래 바닥줄에 '숨김 M개 · 모두 보이기'가 떠 있다(평면·3D, 속성 칸을 접어도). 목록 아래에는 숨긴 것이 어떻게 되는지가 글로 늘 적혀 있다(4.2, J14).
- **(d) 박스**: 3D에서 방을 고르면 속성 칸에 '속이 안 보이는 박스로 보기' 체크 칸과 '모든 공간을 박스로'·'모두 비치게'. 켜면 그 방이 바닥·벽·뚜껑이 모두 막힌 불투명한 덩어리로 그려지고 **그 방이 온전히 품은 것은 3D에서 그리지 않는다**(고른 하나만 예외, 5.3) — 안이 어느 쪽에서도 보이지 않는다.
- **둘 다 보기 설정이다**: 이 PC의 `localStorage`에 계정별·도면별로 기억한다. 도면(초안·되돌리기 기록·저장)에는 아무것도 적지 않는다.

**한 가지 규칙**: **그리는 것과 가리키는 것만 거른다. 쓰는 것은 거르지 않는다.** 쓰는 곳에는 늘 전체 초안이 간다. 걸러 본 도면은 "포인터가 무엇 위에 있나"를 묻는 순수 함수의 인자로만 쓴다(4.4, 4.7).

### 1.2 알린 것이 한 가지로 정하지 않는 곳 — 묻지 않고 정한 것

| # | 정하지 않은 곳 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| J1 | **평면에서 방을 골랐을 때의 박스 스위치** | **없다. 스위치는 3D에서 방(도로 아님)을 골랐을 때만 속성 칸에 있다**(5.5). 까닭 넷: 박스는 도면의 값이 아니라 3D 화면을 보는 방식이다 — 도면의 값은 3D에서만 보이는 것도 두 모드에서 고치지만('입체 높이', :1302-1304), 보는 방식은 그것이 보이는 곳에서 준다(평면에서 켜면 화면에 달라지는 것이 없다) / 속성 칸은 이미 모드에 따라 보이는 칸을 쓴다 — 3D에만 있는 '이 카메라 시점으로 보기'(:1286), 평면에만 있는 '다각형으로 바꾸기'(:1259) / 평면의 공간 속성이 가장 긴 폼이다(900px 이하에서는 190px 높이) / 한솔에게 "3D에서 방을 고르면 속성에 생긴다"고 알렸다 | 조건의 `mode === '3d' &&`를 빼고 안내 문장을 '3D에서 볼 때만 달라져요. …'로 바꾼다(JSX 한 줄, 앵커 R2-6 한 줄) |
| J2 | 묶음 버튼 둘의 자리, 아무것도 고르지 않은 3D | 버튼 둘은 체크 칸 바로 아래, 같은 구역 안(방을 고른 3D에서만). 모든 방이 박스여도 박스를 누르면 그 방이 골라지므로 '모두 비치게'에 늘 닿는다. **아무것도 고르지 않은 3D의 '도면 구성'에는 스위치가 어디 있는지 한 줄만 둔다**: '공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.'(5.5) | '도면 구성'에도 버튼을 두려면 같은 두 버튼을 그 줄 아래에 한 번 더 그린다 |
| J3 | 고른 것을 숨길 때 | **숨긴 것은 선택되지 않는다.** 평면의 묶음에서 빠지고, 3D에서 손에 든 것이면 손에서 놓고, 3D가 적어 둔 고름에서도(지금 손에 있지 않아도) 지운다(4.5). 그래서 손잡이·기즈모·F2·Delete·카메라 시점이 보이지 않는 것에 닿지 않는다 | — (바꾸면 그 다섯 곳마다 가드가 필요하다) |
| J4 | 숨긴 방의 자리에 기호를 놓으면 | **숨긴 방은 기호를 받지 않는다**(눌리지 않는 것은 놓을 자리도 아니다 — ①). 새 기호는 그 자리의 **보이는 공간 가운데 맨 위의 것**에 속하고 그 바닥 높이에 선다(없으면 소속 없이 땅에). 3D에서 겨눠지는 바닥도 보이는 것뿐이다: 전체 도면에서 정하면, 위층을 숨기고 아래층 바닥을 눌러 놓은 의자가 숨긴 위층에 속한 채 그 높이에 떠서 저장된다(4.4). 새 카메라의 소속(정해진 자리, `addMapCamera`)과 '소속 공간' 목록은 숨김과 무관하다 | 숨긴 방도 받게 하려면 `placeSymbol`의 그 한 줄과 앵커 21·R2-1의 그 줄 |
| J5 | '맞춤'·이미지 목록·'도면 구성'의 수 | 숨김과 무관하다(전체를 본다). 숨긴 것이 멀리 있어도 '맞춤'은 그것까지 넣는다 | `fitView`·`fit()`에 걸러 본 도면을 넘긴다(쓰는 곳이 아니라 안전하다) |
| J6 | 칩의 자리 | 바닥줄의 오른쪽 끝(평면에서는 확대 버튼들 바로 왼쪽)에 **떠 있다** — 자리를 차지하지 않는 닻에 얹어, 칩이 생기고 사라져도 안내 글의 줄 수와 바닥줄·도면의 높이가 그대로다(4.3). **바닥줄에 빈 자리가 모자라면 칩이 안내 글 위에 놓인다**(누를 수 있는 것이 도움말을 이긴다 — 덮이는 폭은 11.4). 칩이 떠 있는 동안에는 3D의 안내 글에도 전체를 읽는 `title`을 단다(4.3) | 흐름 안에 두려면 6.3의 닻과 칩 두 줄을 11.2의 대체안으로(그때는 도면 높이가 1px 달라질 수 있다) |
| J7 | 박스의 색 | 테마의 카드색에 강조색을 35% 섞은 불투명색(고른 것은 60%). 기호와 같은 빛을 받는다. **덩어리를 읽게 하는 것은 화면마다 다르다**: 어두운 화면에서는 모서리의 선, 밝은 화면에서는 면끼리의 밝기 차이(5.1의 숫자) | 숫자 둘. 밝은 화면에서도 선이 필요하면 11.2 |
| J8 | 박스 안에 있는 것 | **박스가 온전히 품은 것은 3D에서 그리지 않는다 — 본체도 이름도 클릭 대상도.** 이름표는 무엇이든 뚫고 그려지고, 뚜껑·벽·바닥과 한 평면에 놓인 것(뚜껑 높이까지 오는 계단, 벽에 붙은 안쪽 방)은 면 위에 비치며 클릭도 받기 때문이다(5.1). 목록·보조 평면도에서 고른 하나는 그린다: 이름이(편집 중이면 기즈모도) 박스를 뚫고 보인다(5.3) | 5.1의 `held` 한 줄과 `visible` 줄의 끝 |
| J9 | 박스가 비켜서는 때 | 편집 중 기호 도구를 들고 있는 동안에는 모든 방이(저장이 도는 사이에도 — 저장할 때마다 박스가 닫혔다 열리지 않는다), '이 카메라 시점으로 보기'에서는 그 카메라가 서 있는 방이 비친다. 벽 선 위나 뚜껑 높이에 딱 맞춰 선 카메라도 그 방 안이다(5.1, 5.4) | 각각 한 줄 |
| J10 | 숨기기 뒤의 더블클릭 | **속성 칸에 보이는 것이 바뀔 때만** 0.5초 동안 누름을 받지 않는다(`swallowSecondClick`, v1.135.0의 같은 장치) — 그때 목록이 포인터 밑에서 움직인다. 묶음 셋 가운데 하나를 숨길 때처럼 속성 칸이 그대로면 받는다(눈을 잇달아 누를 수 있다). 그 0.5초에는 Enter·Space로 누르는 버튼도 듣지 않는다(4.5) | 그 한 줄을 뺀다(앵커 52의 수는 그때 1차의 4 그대로) |
| J11 | 기억하는 양 | 계정마다 도면 100개. 넘으면 가장 오래 손대지 않은 도면의 설정부터 잊는다(3절) | 상수 하나 |
| J12 | 보기 모드 · 편집 권한이 없는 계정 | **눈과 박스 스위치는 편집하지 않을 때도, 편집 권한이 없는 계정에서도 듣는다**(4.6, 5.5). 도면을 쓰지 않고 그 PC의 그 계정 화면만 바꾸기 때문이다. 화면이 팀에 열리면 누구나 자기 화면에서 숨기고 박스로 볼 수 있다 | 편집할 때만 듣게 하려면 두 핸들러의 가드에 `!canEdit` |
| J13 | 3D에서 눈을 꺼서 평면의 묶음이 하나 이하로 줄 때 | **손에 든 것이 손에 남는다.** 하나만 고른 선택은 평면과 3D가 함께 쓰므로(mapDocument.ts:235-239) 묶음의 남은 하나와 손에 든 것을 둘 다 둘 수는 없다. 묶음 밖의 다른 것을 손에 들고 있었으면 **그것이 선택이 되고**(그 카메라의 시점 미리보기도 이어진다) 묶음의 남은 하나가 대신 풀린다 — 3D에서는 그 묶음이 무엇인지 화면에 보이지도 않는다(속성 칸은 수만 말하고 목록은 손에 든 것만 표시한다). 손에 든 것이 묶음 안의 것이었거나 없었으면 남은 하나가 선택이고 손에 든 것이다 | 묶음의 남은 하나를 남기려면 `selectionWithout`의 3D 가지 한 줄을 뺀다 — 손에 든 것이 놓이고 그 카메라의 시점 미리보기가 끝난다 |
| J14 | "이 PC의 내 화면에서만 · 도면에는 그대로"를 어디서 말하나 | **늘 보이는 글로 한 번씩.** 눈은 오브젝트 목록 아래의 한 줄(4.2 — 숨긴 것이 없을 때도 있다. 눈을 누를 때 생기고 사라지면 목록이 눈 밑에서 움직인다), 박스는 체크 칸 아래의 글(5.5). 올려야 나오는 `title`만으로는 "숨긴 채 저장하면 지워지나"에 화면이 답하지 못한다 — 편집 중의 띠는 숨긴 것이 있어도 "저장된 그대로예요"라고만 한다. 칩과 제목의 '모두 보이기'에는 같은 글이 `title`로도 있다 | 목록 아래의 한 줄을 빼려면 `ObjectList`의 그 `<p>`와 CSS 한 줄(그때는 눈의 `title`에 `HIDDEN_NOTE` 전체를 단다) |

### 1.3 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 보기 설정을 도면에 저장해 모든 PC에서 같게 보이기 | 노드의 키는 닫힌 목록이다(domain.ts:62 — 공간은 `…,'elevation','volumeHeight','surface'`, 운영 DB의 검증 함수가 같다). 넓히려면 네 번째 migration과 승인, 구버전 앱의 '업데이트가 필요해요'가 따른다. 한솔이 요청하지 않았다(③) |
| 방을 숨길 때 그 안의 사물·카메라도 함께 숨기기, "이 방에 속한 것" 묶어 다루기 | ④. 소속(`spaceId`)은 만들 때 적히고, 그 노드를 다른 곳으로 끌어도 바뀌지 않는다 |
| 평면에서 박스를 다르게 그리기, 보조 평면도에 박스 표시 | 박스는 3D의 모습이다 |
| 저장 모양(`types.ts`·`domain.ts`), IPC, 메인 프로세스, 미리보기 저장소, DB, 노출 범위(`featureFlag.ts`) 바꾸기 | 필요 없다. 화면 쪽 코드와 CSS뿐이다 |
| 새 단축키, 여러 개를 한꺼번에 숨기는 묶음 버튼, 종류별 눈 | 요청 밖 |
| 숨긴 것을 흐린 윤곽으로 남겨 두기 | "사라지고 눌리지도 않는다"(①) |
| 1차(숫자 칸·높이 끌기·도면 삭제)와 3차(그림 추가)의 것, "저장 안 한 편집을 이 PC에 보관" | 다른 차례다. 보기 설정은 그 보관소로 옮기지 않고 `localStorage`에 둔다 |

### 1.4 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | v1.131.0~v1.135.1과 1차가 낸 동작은 하나도 물러서지 않는다 | 그 동작의 순수 모듈은 고치지 않는다(6.4). 편집기에서 고치는 곳과 자리는 6.2의 표가 전부다 |
| R2 | **숨긴 것도 박스도 없으면 도면을 그리는 모든 표면과 누르기가 지금과 똑같다**(새로 보이는 것은 눈 버튼, 목록 아래의 안내 한 줄, 3D의 박스 구역, 3D '도면 구성'의 안내 한 줄뿐이다) | 거르는 함수는 그때 **받은 그 객체**를 돌려준다(`shownMap`은 같은 도면, `mapViewPrefsOf`는 하나뿐인 빈 값, `visibleMapHits`는 같은 배열, `nodesHeldBy`는 하나뿐인 빈 묶음). 새 props는 선택 값이고 없으면 "없음"이다. 기존 장면·뷰포트 테스트 74개가 고치지 않고 통과한다(12절에서 돌려 봤다) |
| R3 | 쓰는 곳에는 전체 초안만 간다 | 4.7. 앵커 R2-1이 `shownMap(`의 네 자리와 `map={current}`·`initial: live`·새 기호를 적는 줄을 고정한다 |
| R4 | `BackgroundMapEditor.tsx`의 함수 순서 — 앵커가 표지에서 다음 표지까지를 잘라 읽는다(`tests/backgroundMapEditorWiring.test.ts:68-103`) | 새 핸들러는 표지 사이가 아닌 한 자리에 둔다(6.2) |
| R5 | 끌기 도중에는 도면 위에 놓인 것이 생기거나 사라지지 않는다 | 보기 설정은 포인터 세션·제스처 중에 바뀌지 않는다(4.6). 칩과 제목의 버튼은 배치를 바꾸지 않는다(4.3) |
| R6 | 3D·보조 평면도는 한 노드만 받는다. `mapCanvas.ts`와 3D 파일에 `selectedIds`라는 글자가 없다(앵커 23) | 새 props의 이름은 `hiddenIds`·`solidIds`다 |
| R7 | 3D 파일은 평면 편집 모듈(`mapSnap`·`mapPlanGesture`·`mapPlanEdit`·`mapPlanSelect`)을 import하지 않는다(앵커 10) | 3D 파일은 `mapViewPrefs.ts`도 import하지 않는다 — 도면이 아니라 id 묶음을 받는다 |
| R8 | 테스트는 Node type-stripping으로 돈다 | 새 순수 모듈은 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만, `@/` 별칭 없음 |
| R9 | 움직임 규칙(CLAUDE.md) | 새 전환·애니메이션 규칙이 없다. 흐려지는 줄은 `opacity` 하나이고, 그 150ms는 라이브러리 버튼의 기존 공용 전환(backgrounds.css:34-37)이며 동작 줄이기에서는 같은 파일의 기존 블록(:812-815)이 끈다(빌드가 '움직임: 최소' 짝을 만든다) |
| R10 | 화면 글자는 비개발자의 말(해요체), 기울임 없음 | 4.2·4.3·5.5·9절의 문구. 흐린 줄에 `font-style`을 쓰지 않는다 |

---

## 2. 현재 동작 (v1.136.0 — 1차까지)

1차가 바꾼 동작은 2.3(옆 그림이 도면을 쓴다)과 2.7(초안을 바꾸는 길이 하나 늘었다)에 적었다. 그 밖은 v1.135.1 그대로이고 줄만 밀렸다(2.8의 둘째 표). 줄 번호는 `56cbc744`의 것이다.

### 2.1 오브젝트 목록

- `ObjectList`(:158-172)는 편집기 파일 안의 `memo` 컴포넌트다. 순서는 카메라 → 기호 → 공간(:160), 제목은 `<strong>오브젝트</strong><span className="bmap-badge">{ordered.length}개</span>`(:162).
- **한 줄이 버튼 하나다**(:164-169): 종류 아이콘, 이름, 잠금 표시, 종류 글자. 누르면 `onSelect(node.id)`. 줄에 다른 조작은 없다. 버튼 안에 버튼을 넣을 수 없으므로 눈은 **형제 버튼**이어야 한다.
- 그리는 곳은 한 곳이다(:1328): `nodes`는 끌기가 시작될 때의 도면(`settledCurrent`), 표시는 `listSelection`(:294-299 — 평면은 묶음 전체, 3D는 손에 든 하나), 고르기는 `selectNode`(:1048).
- 줄은 어느 때에도 꺼지지 않는다(보기 모드, 읽기 전용 계정, 저장 중 모두 눌린다).
- CSS(이 글머리의 줄은 모두 `backgrounds-map.css`): `.bmap-node-list`(:202)는 세로 flex에 `max-height:264px`, 그 안의 **모든 버튼**에 `width:100%`·`min-height:32px`가 걸린다(:203). 속성 칸의 폭은 1100px 초과에서 260px(:230이 :218의 220px을 덮는다), 1100px 이하 230px(:302), **900px 이하에서는 도면 아래에 전체 폭으로 놓이고 높이가 190px로 제한된다**(:362).

### 2.2 평면 — 그리는 곳과 가리키는 곳

| 것 | 코드 | 읽는 도면 |
|---|---|---|
| 공간(아래에서 위로) · 기호 · 카메라 — 세 번에 나눠 그린다. 이름 글자는 각 `<g>` 안이다 | :1174-1183 · :1184-1196 · :1197-1210 | `current` 전체 |
| 손잡이·점 손잡이·이름 칸 | :1215 · :1217 · :1236 | `selected` 하나(:262) |
| 누름: 눌린 요소가 맨 위 노드를 정한다(`pointerDown(event, node)`) | :1176, :1189, :1203 → :820 | 그려진 것 |
| 차례로 넘어가는 더미(같은 자리 천천히 한 번 더, 겹친 카메라·기호) | :851 `planPileAt(live, …)` → mapPlanPreview.ts:145-150 → mapStack.ts:34-36 | 초안 전체 |
| 선택 상자: 놓을 때 고른다 / 끄는 동안의 미리 표시 | :922 `planMarqueeIds(live, …)`(mapPlanSelect.ts:79-81) / :265 | 초안 전체 |
| 스냅 후보: 그 끌기의 첫 이동에서 한 번 모은다 | :899 `planGestureCandidates(gesture, session.initial)`(mapPlanGesture.ts:49-63 → mapSnap.ts:89-103) | 누를 때의 도면 전체 |
| 끌기의 미리보기 = **쓰는 곳** | :879 세션의 `initial: live`, :902 `previewPlanGesture(gesture, session.initial, …)`, :904 | 누를 때의 도면 전체 |
| 더블클릭의 대상 | :969 `planPileAt(current, …)` — 첫 누름이 다룬 노드가 그 더미에 있는지만 본다 | 전체 |
| 새 기호의 소속 / 새 카메라 | :580 `spacesAt(base, point)[0]` / :568 `addMapCamera` | 전체 |
| 맞춤 | :999-1002 `fitMapViewport(current)` | 전체 |

### 2.3 보조 평면도 (3D 옆의 '평면 보기')

`BackgroundMapPlanPreview`(BackgroundMapPlanPreview.tsx:130 — 이 문단의 줄은 따로 적지 않으면 모두 그 파일)는 받은 `map`을 세 줄로 그리고(:216-218), 클릭은 `nextPlanSelection(now.map, …)`(:190 — `latest.current`의 도면, :159-160)으로 넘겨 `onSelect`만 부른다. **평면 그림은 도면을 쓰지 않는다**. 보기 상자는 `planViewBox(map, size)`(:156), props는 `map`·`selectedId`·`onSelect`·`canEdit`·`scrub` 다섯이다(mapCanvas.ts:70 — 뒤의 둘은 1차가 더했다). **1차부터 쓰는 곳이 하나 있다**: 고른 카메라의 읽음 칸(`CameraReadout`, :115 — 태그 :226)이 옆에서 본 그림(`BackgroundMapPlanSide.tsx`)에 받은 `map`·`canEdit`·`scrub`을 그대로 넘기고, 편집할 수 있고 그 카메라가 잠기지 않았을 때(`canEdit && !camera.locked`) 렌즈를 위아래로 끌면 카메라 높이가 편집기의 `fieldScrub`을 지나 문서의 제스처로 적힌다(전체 도면에서 미리본다 — 2.7).

### 2.4 3D

**장면 — `map3dScene.ts`**(아래 네 글머리의 줄은 모두 이 파일)

- 노드마다 뿌리 하나(`root`)와 따라다니는 것 하나(`aux` — 이름표, 카메라의 내림선)다. `sync`(:178-202)는 **한 노드**를 숨길 줄 안다: `hiddenId`(들여다보는 카메라)면 `root.visible`·`aux.visible`을 끄고(:197-198), 클릭 대상에서도 뺀다(`pickTargets`, :209-212 — three의 광선은 보임 여부를 보지 않는다).
- **방**(`buildSpace`, :459-503)은 **뚜껑 없는 상자**다: 바닥 채움(`spaceFloor` 9%, 고르면 20%), 벽(`spaceWall` 12% / 27%) — 모두 `transparent`, `depthWrite:false`, 양면(:379-380, :388-391) — 과 바닥·윗변·기둥의 선(`spaceLine` 55% / 100%, 잠기면 점선, :392-395). 바닥의 `renderOrder`는 −1(도로 −1.5, :468). 도로는 바닥뿐이다(:469-484). 한솔이 "와이어프레임처럼 다 보인다"고 한 모습이 이것이다.
- **이름표**(`makeLabel`, :110-139)는 `depthTest:false`·`renderOrder 20`의 스프라이트라 **무엇이든 뚫고** 그려진다(:135-136). 공간과 카메라는 늘, 기호는 고른 것과 '사물'만 이름표가 있다(:101-108). 방의 이름표는 벽 높이 + 4에 뜬다(:463).
- **고르기**(:634-751): 클릭 대상은 `pickPart`로 갈린다 — 공간의 `floor`·`wall`, 사물의 `solid`·`box`(:86-87). 카메라와 사물의 단단한 부분이 먼저, 그다음 **포인터 아래의 바닥**, 바닥이 없을 때만 벽이다("벽은 클릭을 삼키지 않는다", :663-680).

**뷰포트 — `BackgroundMap3D.tsx`**(아래 다섯 글머리의 줄은, 파일 이름을 따로 붙이지 않았으면 이 파일)

- `cast`(:507-511) 한 곳에서 광선을 쏘고 `pick`(:549-570), `floorPoint`(:516-522 — 기호를 놓을 바닥), `onDoubleClick`(:619-625)이 그것을 읽는다.
- **기즈모**는 `gizmoAllowed`(:430-434)가 허락할 때만 붙는다. 끌기는 `props.map`에서 시작해(:152) 그 도면에 뿌리의 자세를 되적는다(BackgroundMapCameraGizmo.ts:33-35, 같은 파일 :371) — **쓰는 곳**이다.
- **다시 맞추는 때**: `syncScene`(:423-428)은 `map`·`selectedId`·`holdId`·`hiddenId`가 **같은 객체**면 아무것도 하지 않는다(`shown`, :86).
- **카메라 시점 미리보기**는 같은 장면을 그 카메라의 자세로 그린다(:225-235, :365-379). **기호 놓기**는 포인터 아래의 공간 바닥(없으면 땅)의 평면 좌표를 편집기에 넘긴다(:538-543 → 편집기의 :1073 → :577).
- 개발 빌드는 `window.__bflowMap3d`(장면·카메라·`nodeScreenPoint`)를 내놓는다(:208-212) — 수동 검증이 장면을 읽는 길이다.

### 2.5 선택

- 묶음은 문서의 도면별 보기 값에 있다(`selectedIds`, mapDocument.ts:15-26). 편집기는 `selection`(:257)으로 읽고, 3D·속성 칸의 **한 노드**는 `singleId = singleViewId(current, selection, view.selectedId)`(:260)다: 하나 이하를 골랐으면 그 선택, 여러 개면 3D에서 따로 고른 것(`pick-one`)이고 **그것은 묶음 밖의 노드일 수 있다**(mapDocument.ts:235-239).
- 편집기의 고르기는 `select()` 한 줄이다(:470-472): 3D이고 여러 개가 골라져 있으면 `pick-one`(손에 든 것만), 아니면 `select`(바꿔 넣기). **평면에서 `select(null)`은 묶음 전체를 지운다.** `doc.selectMany`(바꿔 넣기 + 손에 든 것을 마지막 id로, mapDocument.ts:113-120)는 세 곳에서 부른다(:650, :922, :952).
- 앵커 23이 고정한다: 편집기에 `pick-one`이라는 글자가 없고, `doc.dispatch(`는 한 번, `doc.selectMany(`는 세 번이다(`tests/backgroundMapEditorWiring.test.ts:382-386`).

### 2.6 이 PC에 기억하는 것, 그리고 계정

- 기기별 값 둘: 스냅 켜기/끄기(`bflow.background-map.snap.v1`, mapPlanEdit.ts:84-92 — 읽기·쓰기를 `try`로 감싸고, 편집기는 `useState(readSnapPreference)`(:191)로 한 번 읽어 누를 때마다 적는다, :1241), 도면 높이(BackgroundMapPanels.tsx:4-17). 계정을 가리지 않는다.
- 도면별 보기 상태(3D 둘러보기 자세 :249, 평면의 보기·선택)는 편집기가 떠 있는 동안만 산다. 배경 화면은 다른 메뉴로 갈 때마다 내려간다(`src/App.tsx:3301`의 `key={currentView}`) — 기억하지 않으면 눈이 하루에도 여러 번 풀린다.
- **편집기는 지금 계정을 모른다**(`Props`, :43). 계정은 `BackgroundLibraryView.tsx:29`의 `user`이고, 본문이 `key={user?.id || "signed-out"}`(:152)라 **계정이 바뀌면 편집기가 새로 뜬다**.
- 선례: 간트의 눈이 숨긴 프로젝트를 계정별로 `localStorage`에만 기억한다(`src/features/gantt/GanttView.tsx:44`의 `bflow-gantt-view:${user?.id||''}`, 버튼은 `GanttTree.tsx:67` — lucide의 `Eye`/`EyeOff`, 이름은 동작으로 붙인다).

### 2.7 저장

`saveMap`(:616-631)은 `settle()`이 저장소에서 읽은 초안을 그대로 명령에 넣는다(:625, :629). 저장되는 도면은 초안의 값이고, 그 값을 바꾸는 길은 `updateMap`(:530)·`doc.previewGesture`뿐이다. `doc.previewGesture`는 셋이다: 평면의 끌기(:904), 3D의 기즈모(:1052), 그리고 1차가 더한 숫자 끌기·옆 그림의 높이(`previewFieldScrub`, :1069 — `beginFieldScrub`(:1056-1065)이 제스처를 연다). 셋째도 **전체 도면**에서 미리본다: 제스처의 시작 도면(`gestureStartMap`, :1067)에 그 한 값을 적은 것이다.

### 2.8 분석과 1차에서 가져온 것 가운데 바로잡은 것

| 분석·통합 결정의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| "숨길 때 손에 든 것이 숨는 것이면 먼저 `select(null)`, 그다음 묶음을 고쳐 쓴다" | 평면에서 `select(null)`은 묶음을 통째로 지운다(2.5). 묶음 밖의 것을 3D에서 손에 들었다가 평면으로 돌아와 그것을 숨기면 묶음이 사라진다 | `doc.selectMany(적을 선택)`이 먼저이고, **3D이면서 둘 이상 남을 때만** `select(손에 든 것 또는 null)`(4.5). 스물네 경우를 실제 문서 리듀서로 돌려 봤다(12절) |
| "숨긴 것이 손에 든 것인지만 묻는다" | 3D가 적어 둔 고름(`MapViewport.selectedId`)은 하나 이하를 골랐을 때 읽히지 않을 뿐 남아 있다(mapDocument.ts:197-202, :235-239). 묶음이 되돌리기로 하나가 된 사이에 그 노드를 숨기면, 다시 실행으로 묶음이 둘이 될 때 **숨긴 것이 손에 들린다** | `selectionWithout`이 적어 둔 고름도 함께 묻는다(3절). 그 경우를 돌려 봤다(V-12) |
| "칩은 높이가 고정인 바닥줄(42px)에 둔다" | 바닥줄은 `min-height:42px`(테두리 포함)이고 안내 글이 두 줄이면 계산으로는 43px이다(테두리 1 + 안여백 12 + 두 줄 30). 평면의 안내 글은 "두 줄까지"일 뿐 늘 두 줄이 아니고, 3D의 안내 글은 줄 수 제한이 없다(backgrounds-map.css:151, :153, :383). 흐름 안의 칩은 안내 글의 폭을 줄여 줄 수를 바꾼다 | 자리를 차지하지 않는 닻에 칩을 띄운다(4.3). 높이의 숫자를 못 박지 않고 앞뒤를 재서 견준다 |
| "뷰포트가 '박스 − 카메라가 선 방'을 계산해 넘긴다" | 매번 새 묶음이면 `syncScene`의 "같은 객체인가" 검사가 늘 어긋난다 | 장면이 `hiddenId`(들여다보는 카메라)로 스스로 연다(5.4). 뷰포트는 받은 묶음을 그대로 넘긴다 |
| "기호를 놓는 동안(`placing`)에는 뷰포트가 박스를 빈 묶음으로 바꾼다" | `placing`은 `tool === 'symbol' && canEdit`이고(:1228) `canEdit`은 저장이 도는 동안 거짓이다(:268-270, :627). 저장은 도구를 내려놓지 않는다 — 기호 도구를 든 채 저장하면 모든 박스가 닫혔다 열리고, 속성 칸의 안내 문장이 사라졌다 돌아와 목록이 두 번 뛴다. 다-1이 띠를 `canEdit`이 아니라 `editing`에 단 까닭이 이것이다(`tests/backgroundMapEditorWiring.test.ts:1158-1160`) | 박스를 여는 조건은 편집기의 `roomsOpen = tool === 'symbol' && editing` 한 줄이다. 그동안 편집기가 `<Map3D>`에 하나뿐인 빈 묶음을 주고, 안내 문장도 같은 값을 읽는다(5.4, 5.5). 뷰포트는 `placing`으로 박스를 바꾸지 않는다 |
| "카메라는 `containsPoint(방, 카메라)`이고 꼭대기 미만이면 품긴다" | `containsPoint`는 사각형의 네 변은 안으로, 다각형의 변은 절반만 안으로 읽는다(mapGeometry.ts:266, :267-272). 카메라는 벽 선 위에 쉽게 선다 — 스냅이 카메라의 점을 방의 왼쪽·가운데·오른쪽, 위·가운데·아래 선에 붙인다(mapSnap.ts:59-60, :89-103). 같은 방을 다각형으로 바꾸면 오른쪽·아래쪽 벽 위의 카메라가 밖이 되어, 그 시점 미리보기에서 방이 닫힌 채 안의 것이 그려지지 않는다(렌즈가 붙은 면만 가까운 쪽 한계(`near` 1, BackgroundMap3D.tsx:375)에 잘려 나가 **빈 방**이 보인다). 뚜껑 높이에 선 카메라도 같다(돌려 봤다 — 12절) | 카메라도 "같으면 안"이다: 벽 선 위와 뚜껑 높이는 안이고, 선 위인지는 여덟 방향으로 백만분의 일 떨어진 자리로 묻는다(5.1) |
| "없어진 노드의 id는 그 도면의 설정을 다음에 바꿀 때 치운다" | 그러면 되돌렸다가 다시 실행으로 되살린 노드가 숨긴 채로 오는지가 그 사이에 **아무 눈이나 박스를 눌렀는지**에 달린다 — 상관없는 누름이 정한다. 죽은 id는 읽을 때 해가 없다(읽는 곳은 모두 도면에 있는 노드만 본다) | 치우지 않는다: 숨겼던 것은 숨긴 채로, 박스였던 것은 박스로 돌아온다. 목록이 한도에 찼을 때만 자리를 내려고 버린다(3절) |
| "`visibleMapHits` = 가장 가까운 닫힌 면까지" | 걸쳐 겹친 높이가 같은 박스 둘의 뚜껑은 거리가 같다. 배열의 첫 것에서 자르면 도면의 순서가 고른다 | 그 면과 같은 거리(여유 1e-6)의 것은 남긴다 — 평면처럼 작은 공간이 위다 |
| "박스 안의 것은 깊이 검사가 가리고, 이름표만 끄면 된다" | 닫힌 면은 `polygonOffset`으로 깊이에서 물러나 있어 **그 면과 한 평면에 놓인 것이 깊이 검사를 이긴다**. 기본값끼리가 바로 그 경우다: 계단의 기본 키와 방의 기본 높이가 둘 다 180이라(mapSpatial.ts:28, :32) 맨 윗단이 뚜껑과 한 면이고, 벽에 붙은 안쪽 방의 선과 벽, 바닥에 선 다리의 밑면도 같다. 광선에서도 같은 거리라 `visibleMapHits`를 지나 **계단이 뚜껑을 뚫고 골라진다**(돌려 봤다 — S-4) | 닫힌 방이 온전히 품은 노드는 뿌리째 그리지 않는다(5.1, 5.3). 이름표는 뿌리를 따라 꺼진다 — 뿌리의 `visible`이라 장면 테스트로 본다(S-6) |
| "`spaceHoldsNode` = 가운데 점이 윤곽 안" | 가운데 점은 **둘러싼 방**에도 참이다: 큰 방 한가운데의 작은 박스가 큰 방을 "품고", 둘이 서로를 품는다 | 온전히 안에 있을 때만 품는다 — 윤곽의 가운데와 모든 꼭짓점, 바닥과 꼭대기(5.1). 윤곽과 높이가 같은 두 박스는 도면에서 앞에 있는 것이 품는다 |
| "숨긴 방의 자리에 놓은 기호는 그 방에 속한다" | `placeSymbol`은 전체 도면에서 맨 위 공간을 묻고(:580), 3D의 `floorPoint`는 보이는 바닥만 겨눈다(BackgroundMap3D.tsx:516-522) — 한 번의 누름에 답이 둘이다. 한 윤곽에 두 층이면 위층이 맨 위다(mapStack.ts:19-26) | `spacesAt(shownMap(base, hiddenIds), point)[0]` — 가리키는 것을 묻는 넷째 자리(4.4, J4) |
| "뷰포트 테스트가 정해진 필드 목록으로 props를 만드니 새 props는 선택 값이어야 한다" | 맞다 — 다만 그것을 지키는 것이 typecheck는 아니다: `npm run typecheck`는 `tests/background*.test.ts`를 읽지 않는다(`tsconfig.json:23`의 `"include": ["src"]`, `tsconfig.playground-tests.json:8`) | 선택 값인 까닭은 실행 때의 대역이고, 지키는 것은 앵커의 글자(`?:`)다(6.1, R2-4). 새 테스트 파일은 돌려서 본다(7.4) |
| 저장 모양 `{ maps: { [도면 id]: … } }` | 객체의 키 순서에 "최근 것"을 싣게 된다 | 배열(순서가 계약이다), 메모리에서는 `Map` |
| "다른 미리보기 계정에서는 숨겨져 있지 않다" | 미리보기에서 배경 화면을 여는 계정은 하나뿐이다(id `'1'`, `src/features/playground/featureFlag.ts:4`, :22-25) | 계정 갈림은 순수 테스트와 저장소의 열쇠 이름으로 본다(8절 N7) |
| "앵커 52는 손대지 않는다" · "새 앵커 60~63" · "보조 평면도 태그는 끝에 붙이기만 하면 된다" | J10이 `swallowSecondClick`을 한 번 더 부른다. 60~66은 1차의 것이다. 1차의 앵커 64가 2차가 바꾸는 보조 평면도의 줄 셋을 글자로 고정한다 — 편집기의 태그(`/>`까지), 보조 평면도의 함수 머리, `mapCanvas.ts`의 `MapPlanPreviewProps` 줄(`tests/backgroundMapEditorWiring.test.ts:2066`, :2069, :2084). 앵커 21이 `placeSymbol`의 그 줄을 고정한다 | 앵커 52의 수가 하나 는다(4 → 5 — 1차가 이미 넷으로 만들었다, 아래 표). 새 앵커는 R2-1~R2-6 = 67~72다. 앵커 64의 그 세 줄과 21의 그 한 줄을 고쳐 쓴다(6.5) |
| "속성 칸 220~260px" | 2.1 — 260 / 230 / 900px 이하는 도면 아래 전체 폭 | 8절 E1 |
| "스냅 후보는 `mapPlanEdit.ts`에서 모은다" | 모으는 곳은 `planGestureCandidates`(mapPlanGesture.ts:49) → `collectSnapCandidates`(mapSnap.ts:89)다. 겹침 더미는 `planPileAt`(mapPlanPreview.ts:145) → `spacesAt`(mapStack.ts:34), 선택 상자는 `planMarqueeIds`(mapPlanSelect.ts:79) | 넷 다 고치지 않는다 — 걸러 본 도면을 인자로 줄 뿐이다(4.4, 6.4) |

**1차(v1.136.0)가 바꾼 것**(1차 설계의 6절에서 읽었고, 1차가 구현된 `56cbc744`의 코드로 다시 봤다 — 1차의 게이트가 설계와 다르게 만든 것도 들였다. 머지된 main에서 0단계에 한 번 더 본다)

| 1차가 하는 일 | 이 문서에 닿는 곳 |
|---|---|
| 편집기에서 상수 둘과 그 주석(`42584da6`의 :106-107), 지역 `NumberField`와 그 주석(같은 커밋의 :136-156)을 지우고 부품을 같은 이름으로 들였다(`import { BackgroundMapNumberField as NumberField } from './BackgroundMapNumberField';`, :14). `mapDelete` 상태(:222), `dialogOpen`(:273 — `gestureActive` 다음), 삭제 핸들러 넷(:708-762 — `uploadUnderlay` 다음, `function newSpace(` 앞), `beginFieldScrub`·`previewFieldScrub`·`fieldScrub`(:1055-1072 — **`cancelCanvasGesture`(:1054) 다음, `placeAt` 앞**)을 더했다 | 이 문서의 편집기 줄 번호가 밀렸다: `42584da6`의 :14~:135(맨 위의 import와 모듈 상수)는 2~6줄 내려가고, :158~:727은 8~20줄 당겨지고, :728부터는 35~57줄 내려갔다. 이 문서는 `56cbc744`의 줄로 고쳐 적었고, 6.2의 자리는 글자로 찾는다. 다섯 핸들러의 자리(`clearSelection` 다음, `openView` 앞)는 1차의 `fieldScrub` 조각(`const beginFieldScrub = useEvent(` → `const placeAt = useEvent(`) **앞**이라 겹치지 않는다 |
| 보조 평면도 태그가 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} />`(:1233)가 되었고, 그 함수 머리는 `export function BackgroundMapPlanPreview({ map, selectedId, onSelect, canEdit, scrub }: MapPlanPreviewProps) {`(BackgroundMapPlanPreview.tsx:130), `MapPlanPreviewProps`는 `export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' \| 'selectedId' \| 'canEdit' \| 'onSelect'> & { scrub: MapFieldScrub };`(mapCanvas.ts:70)다. **1차의 앵커 64가 이 세 줄을 글자로 고정한다**(`tests/backgroundMapEditorWiring.test.ts:2066`, :2069, :2084 — 태그는 `/>`까지) | `hiddenIds`는 셋 모두 맨 **뒤에** 붙인다(태그에 ` hiddenIds={hiddenIds}`, 함수 머리에 `, hiddenIds`, 타입에 `; hiddenIds?: ReadonlySet<string>`). 앵커 64의 그 세 단언을 4단계의 같은 커밋에서 고친다(6.5) |
| `BackgroundMapPlanPreview.tsx`에서 옆 그림이 새 파일(`BackgroundMapPlanSide.tsx`)로 나갔다(리스너·`activate`·그리는 세 줄은 그대로) | 2.3·4.4가 가리키는 그 파일의 줄이 9줄 당겨졌다(`56cbc744`의 줄로 고쳐 적었다) — 글자로 찾는다 |
| 앵커 50·52·53·56·59를 다시 쓰고 **60~66**을 더했다. `swallowSecondClick`은 **넷**이 되었다 — 함수(:478), `endEditing`(:609), `openMapDelete`(:718), `runMapDelete`의 `catch`(:749 — 멈춘 실행이 창을 다시 세운다. 최종 검토가 그 호출을 `if (rootRef.current)` 안에 넣었다). 앵커 52가 그 수를 센다(`tests/backgroundMapEditorWiring.test.ts:1044`). 앵커 59의 목록에 테스트 파일 둘이 늘었다(넷) | 새 앵커 R2-1~R2-6은 **67~72**다. 앵커 52는 4 → 5 |
| 3D 파일(`BackgroundMap3D.tsx`·`map3dScene.ts`·기즈모)과 `ObjectList`는 건드리지 않았다. `Map3DProps`도 그대로다 | `map3dScene.ts`·`BackgroundMap3D.tsx`의 줄(2.4, 5.1·5.2, 5.4의 뷰포트)은 1차 뒤에도 같다. 편집기와 `backgrounds-map.css`의 줄(2.1, 5.4·5.5의 편집기, 6.2, 6.3)은 밀렸다 — `ObjectList`도 글자는 그대로이고 그 위에서 줄이 빠져 18줄 당겨졌다. 이 문서는 `56cbc744`의 줄로 고쳐 적었고, 자리는 글자로 찾는다 |
| 도면 삭제 창이 생겼다 | 보기 설정과 닿지 않는다. 지운 도면의 설정은 100개 한도에 밀려 나갈 때까지 남고, 읽히지 않는다 |

---

## 3. 보기 설정 저장소 — `mapViewPrefs.ts` (새 파일)

three.js·DOM·React가 없는 순수 모듈이다. `localStorage`에 닿는 곳은 `try` 안의 한 함수뿐이고, 나머지는 저장소를 인자로 받는다(테스트가 메모리 저장소를 넘긴다).

```ts
import { singleViewId } from './mapDocument.ts';
import type { MapSelection } from './mapDocument.ts';
import { isRoadSpace } from './mapSpatial.ts';
import type { BackgroundMap } from './types.ts';

/** How one map is shown on this PC: nodes that are not drawn, and rooms that 3D draws as closed boxes. Never part of the map. */
export type MapViewPrefs = { readonly hidden: ReadonlySet<string>; readonly solid: ReadonlySet<string> };
/** By map id, the map whose settings changed longest ago first. */
export type MapViewPrefsByMap = ReadonlyMap<string, MapViewPrefs>;
export type MapViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const MAP_VIEW_PREFS_KEY = 'bflow.background-map.view.v1';          // one entry per account: `${KEY}:${viewerId}`
export const MAP_VIEW_PREFS_LIMITS = { maps: 100, ids: 1000, idLength: 64 } as const;
export const NO_MAP_VIEW_PREFS: MapViewPrefs;                               // the one empty value: both sets are the same empty set

export function mapViewPrefsKey(viewerId: string): string;
export function parseMapViewPrefs(text: string | null | undefined): MapViewPrefsByMap;
export function serializeMapViewPrefs(prefs: MapViewPrefsByMap): string;
export function readMapViewPrefs(viewerId: string, storage?: MapViewStorage | null): MapViewPrefsByMap;
export function storeMapViewPrefs(viewerId: string, prefs: MapViewPrefsByMap, storage?: MapViewStorage | null): void;
export function mapViewPrefsOf(prefs: MapViewPrefsByMap, mapId: string | null | undefined): MapViewPrefs;
export function withHiddenNodes(prefs: MapViewPrefsByMap, map: BackgroundMap, ids: readonly string[], hidden: boolean): MapViewPrefsByMap;
export function withSolidSpaces(prefs: MapViewPrefsByMap, map: BackgroundMap, ids: readonly string[], solid: boolean): MapViewPrefsByMap;
export function shownMap(map: BackgroundMap, hidden: ReadonlySet<string> | undefined): BackgroundMap;
export function hiddenNodeCount(map: BackgroundMap | undefined, hidden: ReadonlySet<string>): number;
export function mapRoomIds(map: BackgroundMap): string[];
export function selectionWithout(map: BackgroundMap, selection: MapSelection, picked: string | null, gone: readonly string[], plan: boolean): { ids: readonly string[]; inHand: string | null; changed: boolean; moved: boolean };
```

**열쇠와 모양.** `localStorage`의 `bflow.background-map.view.v1:<계정 id>`(미리보기 계정은 `…:1`)에 문자열 하나:

```json
{"maps":[{"id":"<도면 id>","hidden":["<노드 id>","…"],"solid":["<공간 id>","…"]}]}
```

배열의 순서가 "오래된 것 먼저"다. 두 목록이 모두 빈 도면은 적지 않는다. 계정 id가 빈 문자열이면(로그인 전) 읽지도 적지도 않는다.

| 규칙 | 내용 |
|---|---|
| 읽기 — 던지지 않는다 | 글자가 없거나, JSON이 아니거나, `maps`가 배열이 아니면 **없음**. 항목은 하나씩 본다: 객체가 아니거나 `id`가 1~64자 문자열이 아니면 그 항목만 버린다. `hidden`·`solid`는 배열일 때만, 1~64자 문자열만, 겹치는 것은 한 번, **1000개까지** 읽는다(도면 하나의 노드 한도와 같다 — domain.ts:55의 `array(value.nodes,1000)`). 같은 도면이 두 번 나오면 뒤의 것이 뒤의 자리에. 끝에서 100개만 남긴다 |
| 쓰기 — 던지지 않는다 | `setItem`이 던지면(가득 참·막힘) 삼킨다: 그때는 화면이 열려 있는 동안만 기억한다. 저장소가 없을 때(`localStorage`에 닿는 것부터 던질 때)도 같다 |
| 바꾸기 (`withHiddenNodes`·`withSolidSpaces`) | 그 목록에 `ids`를 넣거나 뺀다. 넣는 것은 그 도면에 지금 있는 것만(`solid`는 공간만 — 도로도 공간이라 들어가지만 그릴 때 평평하다, 5.1). **다른 쪽 목록은 손대지 않는다** — 같은 `Set` 객체다(눈을 눌러도 `solidIds`가 새 객체가 되지 않는다). **없어진 노드의 id는 치우지 않는다**(아래 "없어진 노드의 id"). 버리는 때는 하나다: 목록이 한도(1000개)에 찬 채로 새 id를 넣을 때, 그 도면에 없는 id를 먼저 버려 자리를 낸다. **목록이 달라지지 않으면 받은 `prefs` 그 객체를 돌려준다**(상태도 저장소도 건드리지 않는다). 달라졌으면 그 도면을 **맨 뒤로**(가장 새것) 옮기고, 두 목록이 다 비면 항목을 없애고, 100개를 넘으면 앞에서 버린다 |
| 읽어 쓰기 (`mapViewPrefsOf`) | 항목이 없으면 `NO_MAP_VIEW_PREFS` — 늘 같은 객체, 같은 빈 묶음 |
| `shownMap` | 숨긴 노드가 그 도면에 **하나도 없으면 받은 도면 그 객체**. 있으면 `{ ...map, nodes: 남은 것 }`(얕은 사본, 원본은 그대로). "가리키는 것"을 묻는 데만 쓴다 — 쓰는 곳에 넘기지 않는다 |
| `hiddenNodeCount` | 그 도면에 **있는** 숨긴 노드의 수(없어진 노드의 id는 세지 않는다) |
| `mapRoomIds` | 도로가 아닌 공간의 id. 편집기에 `isRoadSpace(node)`를 더 쓰지 않으려고 여기 둔다(앵커 41이 그 글자를 셋으로 센다) |
| `selectionWithout` | 숨긴 뒤의 선택(4.5). 받는 것: 그 순간의 도면과 선택, 3D가 적어 둔 고름(`picked` = `MapViewport.selectedId`), 숨기는 id들, 평면인가(`plan`). 돌려주는 것: `ids` = 적을 선택 — 묶음에서 숨긴 것을 뺀 것(빠진 것이 없으면 **받은 배열**). **3D에서만 한 가지가 다르다(J13)**: 묶음이 하나 이하로 줄고, 숨기지 않은 손에 든 것이 그 밖에 있으면 `[손에 든 것]`이다(손에 든 것이 남고 묶음의 남은 하나가 풀린다) / `inHand` = 손에 든 것(`singleViewId` — 숨긴 것이면 `null`) / `changed` = 적어야 하나: 묶음에서 빠진 것이 있거나 **`picked`가 숨긴 것일 때**(지금 손에 있지 않아도 — 묶음이 다시 늘면 손에 들린다) / `moved` = 속성 칸에 보이는 것이 달라지나: 평면은 '묶음'이거나 그 한 노드, 3D는 손에 든 노드와 묶음 안내 줄의 유무 |

**"같은 객체를 돌려준다"가 계약인 세 함수**(돌려 본 구현 그대로다. `NO_IDS`는 모듈의 하나뿐인 빈 묶음, `trim`은 앞에서부터 버려 100개를 남기는 함수다):

```ts
/**
 * `ids` put into or taken out of one list of a map. The other list is not touched. The id of a node that is gone stays
 * listed, so a node that comes back (a redo) is shown as it was. Such ids go only to make room in a list that is full.
 */
function withIds(prefs: MapViewPrefsByMap, map: BackgroundMap, key: keyof MapViewPrefs, ids: readonly string[], on: boolean): MapViewPrefsByMap {
  const before = mapViewPrefsOf(prefs, map.id), list = before[key], next = new Set(list);
  const alive = new Set(map.nodes.filter(node => key === 'hidden' || node.type === 'space').map(node => node.id));
  for (const id of ids) {
    if (!on) next.delete(id);
    else if (alive.has(id) && !next.has(id)) {
      if (next.size >= MAP_VIEW_PREFS_LIMITS.ids) for (const listed of list) if (!alive.has(listed)) next.delete(listed);
      if (next.size < MAP_VIEW_PREFS_LIMITS.ids) next.add(id);
    }
  }
  // The same settings back when the list did not change: what reads them by identity is not woken.
  if (next.size === list.size && [...next].every(id => list.has(id))) return prefs;
  const changed: ReadonlySet<string> = next.size ? next : NO_IDS;
  const hidden = key === 'hidden' ? changed : before.hidden, solid = key === 'solid' ? changed : before.solid;
  const result = new Map(prefs);
  result.delete(map.id);                                  // written last: it is the newest
  if (hidden.size || solid.size) result.set(map.id, { hidden, solid });
  return trim(result);
}
export function shownMap(map: BackgroundMap, hidden: ReadonlySet<string> | undefined): BackgroundMap {
  return hidden?.size && map.nodes.some(node => hidden.has(node.id)) ? { ...map, nodes: map.nodes.filter(node => !hidden.has(node.id)) } : map;
}
/**
 * The selection once `gone` are hidden: what is hidden is never selected. `picked` is the stored pick of the views that
 * show one node (MapViewport.selectedId). It counts while it is not in hand too (one node or none selected): the group
 * can grow again, and it would be in hand. `ids`: the selection to write: the group without the hidden ones (the same
 * array when none was in it). One case apart, in the 3D view (`plan` false): the group shrinks to one node or none while
 * a node outside it is in hand. That node stays in hand, as the selection, and the last node of the group is let go.
 * `inHand`: the node in hand, kept while two or more stay selected (null: let go). `changed`: something has to be
 * written. `moved`: what the properties show changes (`plan`: a group is shown as one there), so the list under them moves.
 */
export function selectionWithout(map: BackgroundMap, selection: MapSelection, picked: string | null, gone: readonly string[], plan: boolean): { ids: readonly string[]; inHand: string | null; changed: boolean; moved: boolean } {
  const left = selection.ids.filter(id => !gone.includes(id)), kept = left.length === selection.ids.length;
  const before = singleViewId(map, selection, picked), inHand = before !== null && gone.includes(before) ? null : before;
  const ids = kept ? selection.ids : !plan && left.length <= 1 && inHand !== null && !left.includes(inHand) ? [inHand] : left;
  const shown = (count: number, node: string | null) => count > 1 ? (plan ? 'group' : `group:${node}`) : `one:${node}`;
  return { ids, inHand, changed: !kept || (picked !== null && gone.includes(picked)),
    moved: shown(selection.ids.length, before) !== shown(ids.length, ids.length > 1 ? inHand : ids[0] ?? null) };
}
```

`moved`의 뒤쪽 값은 4.5의 두 줄이 `ids`를 문서에 적고 난 뒤의 모습이다: 둘 이상 남으면 3D는 손에 든 것을 그대로 두거나 놓고(평면은 '묶음'), 하나 이하면 그 하나(없으면 없음)가 손에 든 것이다 — 3D에서 묶음 밖의 것을 손에 든 채 묶음이 하나 이하로 줄면 그 하나가 바로 손에 들고 있던 것이다(J13).

**읽기와 쓰기**(이것도 돌려 본 그대로다 — 위 표의 "던지지 않는다"와 한도가 이 줄들이다):

```ts
const NO_IDS: ReadonlySet<string> = new Set();
export const NO_MAP_VIEW_PREFS: MapViewPrefs = { hidden: NO_IDS, solid: NO_IDS };
const NOTHING: MapViewPrefsByMap = new Map();
function idList(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return NO_IDS;
  const ids = new Set<string>();
  for (const item of value) {
    if (ids.size >= MAP_VIEW_PREFS_LIMITS.ids) break;
    if (typeof item === 'string' && item.length > 0 && item.length <= MAP_VIEW_PREFS_LIMITS.idLength) ids.add(item);
  }
  return ids.size ? ids : NO_IDS;
}
/** The newest maps only: the oldest entries go. */
function trim(prefs: Map<string, MapViewPrefs>): Map<string, MapViewPrefs> {
  for (const id of [...prefs.keys()].slice(0, Math.max(0, prefs.size - MAP_VIEW_PREFS_LIMITS.maps))) prefs.delete(id);
  return prefs;
}
/** What a stored text holds. Anything of another shape reads as nothing, entry by entry. Never throws. */
export function parseMapViewPrefs(text: string | null | undefined): MapViewPrefsByMap {
  if (!text) return NOTHING;
  let stored: unknown;
  try { stored = JSON.parse(text); } catch { return NOTHING; }
  const maps = (stored as { maps?: unknown } | null)?.maps;
  if (!Array.isArray(maps)) return NOTHING;
  const prefs = new Map<string, MapViewPrefs>();
  for (const entry of maps) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, hidden, solid } = entry as { id?: unknown; hidden?: unknown; solid?: unknown };
    if (typeof id !== 'string' || !id || id.length > MAP_VIEW_PREFS_LIMITS.idLength) continue;
    const value = { hidden: idList(hidden), solid: idList(solid) };
    prefs.delete(id);                                   // listed twice: the later one, in the later place
    if (value.hidden.size || value.solid.size) prefs.set(id, value);
  }
  return prefs.size ? trim(prefs) : NOTHING;
}
export function serializeMapViewPrefs(prefs: MapViewPrefsByMap): string {
  return JSON.stringify({ maps: [...prefs].map(([id, { hidden, solid }]) => ({ id, hidden: [...hidden], solid: [...solid] })) });
}
function deviceStorage(): MapViewStorage | null { try { return localStorage; } catch { return null; } }
export function readMapViewPrefs(viewerId: string, storage: MapViewStorage | null = deviceStorage()): MapViewPrefsByMap {
  if (!viewerId || !storage) return NOTHING;
  try { return parseMapViewPrefs(storage.getItem(mapViewPrefsKey(viewerId))); } catch { return NOTHING; }
}
export function storeMapViewPrefs(viewerId: string, prefs: MapViewPrefsByMap, storage: MapViewStorage | null = deviceStorage()): void {
  if (!viewerId || !storage) return;
  try { storage.setItem(mapViewPrefsKey(viewerId), serializeMapViewPrefs(prefs)); } catch { /* A view setting must not block the editor: it then lasts while the screen is open. */ }
}
export function mapViewPrefsOf(prefs: MapViewPrefsByMap, mapId: string | null | undefined): MapViewPrefs {
  return (mapId != null && prefs.get(mapId)) || NO_MAP_VIEW_PREFS;
}
```

`withHiddenNodes`·`withSolidSpaces`는 `withIds`를 `'hidden'`·`'solid'`로 부르는 한 줄씩이고, `hiddenNodeCount`는 `map && hidden.size ? map.nodes.filter(node => hidden.has(node.id)).length : 0`, `mapRoomIds`는 `map.nodes.filter(node => node.type === 'space' && !isRoadSpace(node)).map(node => node.id)`다.

**없어진 노드의 id**(되돌리기로 없앴거나, 다른 PC에서 지웠거나, 초안을 버렸거나)는 읽을 때 해가 없고(읽는 곳 — `shownMap`·`hiddenNodeCount`·목록의 줄·장면의 `visible`과 `boxes` — 은 모두 도면에 있는 노드만 본다) **치우지 않는다. 그래서 돌아온 노드의 규칙은 하나다: 숨겼던 것은 숨긴 채로, 박스였던 것은 박스로 돌아온다**(그 사이에 다른 눈이나 박스를 눌렀든 아니든). 다르게 돌아오는 때는 목록을 통째로 비웠을 때뿐이다 — '모두 보이기'·'모두 비치게'는 그 목록의 id를 죽은 것까지 모두 뺀다(4.5, 5.5). 그 밖에 죽은 id가 버려지는 때는 목록이 한도에 찬 채로 새 id를 넣을 때 하나다(도면 하나의 노드가 1000개까지라, 죽은 것을 버리면 늘 자리가 난다). 숨긴 채로 돌아온 노드는 선택되어 있지 않다(숨길 때 적어 둔 선택에서 지웠다 — 4.5). **크기**: 노드 40개인 도면에서 전부 숨기고 전부 박스로 해도 3.2KB다. 한도까지 채우면 도면 하나에 78KB, 100개면 7.8MB로 `localStorage` 한도(약 5MB)를 넘는다 — 그때는 쓰기가 던지고 삼켜진다(위의 규칙). 실제 도면으로는 닿지 않는 크기다.

**문서가 아니다.** 이 값은 편집기의 React 상태(`viewPrefs`)와 `localStorage`에만 있다. `mapDocument.ts`의 상태·되돌리기 기록·`mapDraftChanged`·저장 명령 어디에도 들어가지 않고, `types.ts`·`domain.ts`에 새 키가 없다.

---

## 4. (c) 눈

### 4.1 편집기의 상태

```tsx
const [viewPrefs, setViewPrefs] = useState(() => readMapViewPrefs(viewerId));            // snapEnabled 다음 줄
const { hidden: hiddenIds, solid: solidIds } = mapViewPrefsOf(viewPrefs, current?.id);    // `const draft = …` 다음 줄
const hiddenCount = useMemo(() => hiddenNodeCount(settledCurrent, hiddenIds), [settledCurrent, hiddenIds]);   // settledSelected 다음 줄
```

`viewerId`는 새 prop이다: `BackgroundLibraryView.tsx`의 여러 줄짜리 태그(:154-160)에 `viewerId={user?.id ?? ''}` 한 줄(`execute={execute}` 다음). 편집기는 계정이 바뀌면 새로 뜨므로(2.6) 처음 한 번 읽는 것으로 충분하다. `hiddenIds`·`solidIds`는 눈·박스를 누를 때만 새 객체가 된다 — 목록(`memo`)과 3D의 "같은 객체인가" 검사가 끌기 도중에 깨어나지 않는다. **`hiddenIds`는 렌더 중에 읽으므로**(그리는 줄들) 그것을 쓰는 첫 줄보다 앞에 선언한다.

### 4.2 목록의 줄

```tsx
/** What the eye does, said under the object list at all times: hidden on this screen only, and still part of the map. A hidden node must never read as a deleted one. */
const HIDDEN_NOTE = '숨긴 것은 이 PC의 내 화면에서만 안 보여요. 도면에는 그대로 있어서, 저장해도 지워지지 않아요.';      // 모듈 상수: ROAD_HINT_NO_STRIP(:104) 다음 줄

const ObjectList = memo(function ObjectList({ nodes, selectedIds, primaryId, hiddenIds, hiddenCount, onSelect, onToggleHidden, onShowAll }: { nodes: BackgroundNode[]; selectedIds: readonly string[]; primaryId: string | null; hiddenIds: ReadonlySet<string>; hiddenCount: number; onSelect: (id: string) => void; onToggleHidden: (id: string) => void; onShowAll: () => void }) {
  const ordered = /* 지금 그대로 */;
  return <section className="bmap-objects" aria-label="오브젝트 목록">
    <div className="bmap-section-heading"><strong>오브젝트</strong>{hiddenCount > 0 && <button type="button" className="bmap-text-button bmap-show-all" title={HIDDEN_NOTE} onClick={onShowAll}>모두 보이기</button>}<span className="bmap-badge">{hiddenCount > 0 ? `숨김 ${hiddenCount} · ` : ''}{ordered.length}개</span></div>
    <span className="sr-only" role="status">{hiddenCount > 0 ? `숨긴 것 ${hiddenCount}개` : '숨긴 것이 없어요'}</span>
    {ordered.length ? <><ul className="bmap-node-list">{ordered.map(node => {
      const hidden = hiddenIds.has(node.id), name = node.name || '이름 없음';
      return <li key={node.id} className={hidden ? 'is-hidden' : undefined}>
        <button type="button" className={selectedIds.includes(node.id) ? 'is-selected' : ''} aria-current={node.id === primaryId ? 'true' : undefined} aria-label={`${name}, ${kindLabel(node)}${node.locked ? ', 잠김' : ''}${hidden ? ', 숨김' : ''}`} onClick={() => onSelect(node.id)}>
          {/* 네 개의 span은 지금 그대로(:165-168) */}
        </button>
        <button type="button" className="bmap-node-eye" aria-label={`${name} ${hidden ? '다시 보이기' : '숨기기'}`} title={hidden ? '다시 보이기' : '숨기기 · 이 PC에서만 안 보여요'} onClick={() => onToggleHidden(node.id)}>{hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}</button>
      </li>;
    })}</ul><p className="bmap-hint">{HIDDEN_NOTE}</p></> : <p className="bmap-hint">아직 배치된 것이 없어요.</p>}
  </section>;
});
```

- **버튼 둘이 형제다**(이름 버튼 → 눈 버튼). 이름 버튼의 `className={…} aria-current={…}` 줄은 글자 그대로 둔다(앵커 36) — 그래서 숨김 표시는 `<li>`의 `is-hidden`에 단다.
- 아이콘은 `lucide-react`의 `Eye`·`EyeOff`(간트가 이미 쓴다). 편집기의 import(:3)에 두 이름을 더한다.
- 눈의 이름은 **동작**이다: `'{이름} 숨기기'` / `'{이름} 다시 보이기'`. 상태를 말하는 `aria-pressed`는 달지 않는다(이름이 이미 바뀐다 — 둘을 함께 쓰면 "숨기기, 눌림"이 된다). 이름 버튼의 이름 끝에는 `', 숨김'`이 붙는다.
- 눈은 **늘 보인다**(올렸을 때만 나타나지 않는다). 눈을 눌러도 줄은 제자리이고 포커스는 그 눈에 남는다(목록의 `key`가 그대로다).
- 숨긴 줄은 이름 버튼만 `opacity:.7`로 흐리다. 눈은 흐려지지 않는다. 기울이지 않는다. **.7인 까닭**: 그 줄은 꺼진 버튼이 아니라 이름을 읽고 눌러 되살리는 줄이다 — 이름의 대비가 어두운 화면 3.4:1, 밝은 화면 3.3:1로 남는다(.5면 2.3:1 / 2.2:1로, 편집기의 꺼진 버튼(`opacity:.42`)과 구별되지 않는다). **그 줄의 종류 글자**(`.bmap-node-type` — '카메라'·'공간'·기호 이름, 10px)는 제 흐림(`opacity:.75`, backgrounds-map.css:215)을 그 줄에서만 푼다: 버튼의 .7과 곱해지면 .525가 되어 2.4:1 / 2.3:1로 떨어진다(풀면 이름과 같은 .7이다 — 6.3). 숨김은 흐림만이 아니라 '눈 가림' 아이콘과 이름 끝의 ', 숨김'으로도 알린다.
- **"숨긴 것이 어떻게 되는가"를 목록 아래에 늘 보이는 글로 말한다**(J14): 줄이 하나라도 있으면 목록 바로 아래에 `<p className="bmap-hint">{HIDDEN_NOTE}</p>` — **숨긴 것이 없을 때도** 있다(눈을 누른다고 생기거나 사라지지 않아, 그 누름으로 움직이는 것이 없다). 문장의 둘째 마디는 주어가 숨긴 **것**이다('도면에는 그대로 있어서, 저장해도 지워지지 않아요') — '도면에는 저장되지 않아요'라고 쓰면 "숨긴 것은 저장되지 않는다"로 읽혀, 숨긴 것이 지워진다는 정반대의 걱정을 만든다. 같은 글이 제목의 '모두 보이기'와 바닥줄의 칩(4.3 — 속성 칸을 접어도 남는 자리다)의 `title`에도 있다. 눈의 `title`은 짧게 `'숨기기 · 이 PC에서만 안 보여요'`(숨긴 줄에서는 `'다시 보이기'`)다. 박스는 체크 칸 아래의 글로 말한다(5.5).
- 읽어 주는 영역(`sr-only`, `role="status"`)은 숨긴 수가 바뀔 때 `'숨긴 것 M개'` / `'숨긴 것이 없어요'`를 말한다.
- 제목의 수는 숨긴 것이 없으면 지금과 같은 `'N개'`이고, 있으면 **숨긴 수를 앞에 둔** `'숨김 M · N개'`다(칩과 같은 차례다). 숨긴 수는 편집기가 센 `hiddenCount`(4.1) 하나를 받아 쓴다 — 목록이 따로 세지 않는다(칩과 같은 수다). '모두 보이기'는 숨긴 것이 있을 때만 수의 왼쪽에 나타난다. **제목 줄의 높이는 그 버튼이 있든 없든 같다**: 버튼이 배지보다 낮고, **줄이 꺾이지 않는다** — '오브젝트'와 버튼은 줄어들지 않고, 자리가 모자라면 수의 배지가 말줄임표로 줄어든다(6.3. 그대로 두면 '오브젝트'가 글자마다 꺾여 줄이 19px 높아진다). 눈을 누른 자리가 그 한 번의 누름으로 움직이면 안 되기 때문이다. **말줄임표는 뒤에서부터 자르므로 잘리는 것은 전체 수이고, 숨긴 수는 남는다.** 글자 폭으로 센 값(12절): '오브젝트' 44.9px + '모두 보이기' 54.3px + 틈 둘 16px = 115.2px이 고정이고 배지는 '숨김 1 · 8개' 60.4px, '숨김 12 · 40개' 72.4px, '숨김 100 · 128개' 82.6px이다. 260px 속성 칸(안쪽 223px)에서는 넓은 스크롤 막대(17px)가 서도 모두 들어간다. 230px 속성 칸(안쪽 201px)에서는 막대가 없으면 들어가고, 넓은 막대가 서면 배지에 68.8px이 남아 '숨김 12 · 40개'부터 뒤가 잘린다. 앱 엔진에서는 넓은 막대일 가능성이 높다 — `scrollbar-color`가 `html, body`에서 내려오는데(`src/index.css:635-638`), 표준 스크롤 막대 속성이 걸린 요소에서는 5px짜리 `::-webkit-scrollbar` 규칙(같은 파일 :641-644)이 듣지 않는다(E1에서 잰다).
- 제목의 '모두 보이기'는 글자만큼(54×15px)만 그려지되 **누르는 자리는 위아래로 5px씩 넓다**(`::after`, 배치는 그대로 — 6.3). 같은 일을 하는 큰 조작은 바닥줄의 칩(26px)이다.

### 4.3 바닥줄의 칩

```tsx
<div className="bmap-canvas-footer"><span className="bmap-footer-hint" title={mode === 'plan' || hiddenCount > 0 ? footerHint : undefined}>{footerHint}</span>{hiddenCount > 0 && <div className="bmap-hidden-slot"><button type="button" className="bmap-hidden-chip" title={HIDDEN_NOTE} onClick={showAll}>숨김 {hiddenCount}개 · 모두 보이기</button></div>}{mode === 'plan' && <div className="bmap-zoom">…
```

- 자리: 바닥줄(`.bmap-canvas-footer`, :1241)의 안내 글과 확대 버튼들 **사이**. 바닥줄은 평면과 3D가 함께 쓰는 요소이고 속성 칸(`aside`) 밖이라, 두 모드 모두에서, 속성 칸을 접어도 보인다. 3D에는 확대 버튼들이 없어 바닥줄의 오른쪽 끝에 놓인다.
- **칩은 바닥줄의 높이를 바꾸지 않는다 — 배치에서 차지하는 것이 0이다.** `.bmap-hidden-slot`은 폭 0·높이 0의 flex 항목이고, 오른쪽 여백 `-10px`이 자기가 더한 틈(바닥줄의 `gap:10px`) 하나를 되돌린다. 그래서 안내 글이 쓸 수 있는 폭이 칩이 없을 때와 **같고**, 줄 수도 바닥줄의 높이도 도면의 크기도 같다. 왼쪽 여백 `auto`가 닻을 오른쪽으로 밀고, 칩은 그 닻에 `position:absolute`로 얹혀 왼쪽으로 뻗는다(6.3의 두 줄). 평면에서는 칩의 오른쪽 끝이 확대 버튼들의 10px 왼쪽, 3D에서는 바닥줄 안쪽 끝이다.
- **빈 자리가 모자라면 칩이 안내 글 위에 놓인다**(바탕이 불투명하다). 안내 글은 도움말이고 칩은 누르는 것이라 칩이 이긴다. 1440×900에서는 덮지 않는다(글꼴의 글자 폭으로 계산: 칩은 117~130px이고, 앱 사이드바를 펼친 채로도 빈 자리가 평면 편집 중 231px 이상, 3D 309px 이상이다 — E3에서 잰다). 더 좁은 폭에서 덮이는 양은 11.4에 적었다. **칩이 있는 동안에는 안내 글 전체가 두 모드 모두 `title`에 있다**: 지금은 평면에서만 다는 `title`(:1241)을 숨긴 것이 있는 3D에서도 단다 — 칩이 가장 많이 덮는 곳이 3D의 긴 안내다. 숨긴 것이 없는 3D는 지금처럼 `title`이 없다(R2).
- 칩의 글자색은 본문색(`--color-text-primary`)이고 테두리만 강조색이다. 강조 보조색으로 쓰면 밝은 화면에서 흰 카드 위 2.4:1이라 읽히지 않는다(밝은 화면은 어두운 화면의 강조 보조색을 그대로 쓴다 — `src/themes.ts`의 `getLightColors`). 본문색은 13.8:1 / 16.9:1이다. 올리면 `HIDDEN_NOTE`가 나온다(4.2).
- 누르면 `showAll` — 이 도면의 숨긴 것을 모두 보이고 **포커스를 캔버스로** 보낸다(칩이 자기 누름으로 사라진다. 제목의 '모두 보이기'도 같다). 칩이 사라져도 그 자리로 밀려오는 것이 없다(닻이 자리를 차지하지 않았다) — 더블클릭의 둘째 클릭은 안내 글이나 빈 바닥줄에 닿는다.

### 4.4 어디서 걸러지나

| 표면 | 규칙 | 고치는 줄 |
|---|---|---|
| 평면: 공간·기호·카메라의 본체와 이름 | 숨긴 노드는 그리지 않는다 | 세 그리는 줄(아래) |
| 평면: 손잡이·점 손잡이·이름 칸·고른 점 | `selected` 하나에 달려 있고, 숨긴 것은 선택되지 않는다(4.5) | 고치지 않는다 |
| 평면: 누름(맨 위 노드), Shift+클릭, Tab·Enter | 눌리는 것은 그려진 요소뿐이다 | 고치지 않는다 |
| 평면: 넘어가는 더미 — 겹친 공간의 "같은 자리 천천히 한 번 더", 겹친 카메라·기호의 차례 | 걸러 본 도면에서 만든다. 가운데 낀 숨긴 공간을 건너뛴다 | :851 |
| 평면: 선택 상자 | 놓을 때 걸러 본 도면에서 고른다. 끄는 동안의 미리 표시(:265)는 그대로 둔다 — 숨긴 것은 그려지지 않아 표시될 것이 없다 | :922 |
| 평면: 스냅 후보(안내선) | 걸러 본 도면에서 모은다. **미리보기는 전체 도면으로 계산한다** — 숨긴 구성원도 공간을 따라 움직인다 | :899 |
| 평면: 더블클릭 | 그대로(눌린 것은 그려진 것이고, 더미에서 보는 것은 첫 누름이 다룬 노드뿐이다) | 고치지 않는다 |
| 평면·3D: 새 기호의 소속과 높이 | **걸러 본 도면에서** 그 자리의 맨 위 공간을 묻는다(J4). 숨긴 방은 받지 않는다. 새 기호를 더해 적는 도면은 전체다(`{ ...base, nodes: [...base.nodes, symbol] }` 그대로) | :580 — 앵커 21의 그 줄을 함께 |
| 평면: 새 카메라, '소속 공간' 선택 목록 | 숨김과 무관(카메라의 자리는 정해진 한 점이지 가리킨 곳이 아니다) | 고치지 않는다 |
| 평면: 맞춤 | 숨김과 무관(J5) | 고치지 않는다 |
| 보조 평면도: 그리기 | 숨긴 노드는 그리지 않는다 | BackgroundMapPlanPreview.tsx:216-218 |
| 보조 평면도: 클릭이 넘어가는 더미 | 걸러 본 도면에서 | 같은 파일 :159-160 |
| 보조 평면도: 보기 상자 | 전체 도면(눈을 눌러도 그림이 다시 맞춰지지 않는다) | 고치지 않는다 |
| 보조 평면도: 옆에서 본 그림 | 전체 도면 — 잣대도, **그 카메라가 속한 방의 높이 띠**(`.bmap-plan-side-room` — `planSideView`가 셈하고(mapPlanPreview.ts:274-293, 그 방은 :279-284) 옆 그림 `BackgroundMapPlanSide.tsx`가 그린다, :54)도 그 방을 숨겼든 아니든 그린다. 띠는 방을 그린 것이 아니라 카메라 높이를 재는 눈금이고, 1차가 그 눈금으로 높이를 끈다(11.3, 11.4) | 고치지 않는다 |
| 3D: 본체·이름표·카메라의 내림선과 시야 | `root.visible`·`aux.visible`을 끈다 | map3dScene.ts:197 |
| 3D: 클릭 | 보이지 않는 뿌리는 클릭 대상이 아니다(지금 그대로, map3dScene.ts:209-212). 뒤에 있는 것이나 빈 곳이 골라진다 | 고치지 않는다 |
| 3D: 기즈모 | 숨긴 것은 선택되지 않는다. 뷰포트도 숨긴 id에는 붙이지 않는다 | BackgroundMap3D.tsx:431 |
| 3D: 카메라 시점 미리보기 | 같은 장면이라 숨긴 것이 나오지 않는다 | — |
| 3D: 기호를 놓을 바닥 | 숨긴 방의 바닥은 겨눠지지 않는다(그 아래 보이는 바닥이나 땅 — 지금 그대로, BackgroundMap3D.tsx:516-522). 소속과 높이는 편집기가 걸러 본 도면에서 정하므로(위의 줄) 숨긴 방이 답이 되지 않는다(보이는 공간이 겹친 자리에서 어느 것인지는 지금처럼 평면의 쌓임이 정한다) | 뷰포트는 고치지 않는다 |
| 3D: 맞춤·위에서 보기 | 숨김과 무관 | 고치지 않는다 |
| 이미지 목록, '도면 구성'의 수, 하위 도면 | 숨김과 무관(`mapGallery.ts`는 선택만 본다) | 고치지 않는다 |
| 저장·되돌리기·편집 상태 띠·도면 트리의 점 | 숨김과 무관(4.7) | 고치지 않는다 |

**편집기의 줄들**(글자 그대로 — 앵커 R2-1·21·25·27):

```tsx
{stackedSpaces(current).map(node => {
  if (hiddenIds.has(node.id)) return null;
  const isSelected = shownIds.has(node.id), road = isRoadSpace(node), centre = roadCentreLine(node);
…
{current.nodes.filter((node): node is BackgroundSymbol => node.type === 'symbol' && !hiddenIds.has(node.id)).map(node => {
{current.nodes.filter((node): node is BackgroundCamera => node.type === 'camera' && !hiddenIds.has(node.id)).map(node => {
```
```tsx
pile: hit ? planPileAt(shownMap(live, hiddenIds), hit.id, point, undefined, item => planMarkCovers(item, point)) : [],                 // pointerDown
? { candidates: session.candidates ??= planGestureCandidates(gesture, shownMap(session.initial, hiddenIds)),                           // pointerMove
if (live && point) doc.selectMany(session.mapId, planMarqueeIds(shownMap(live, hiddenIds), planRect(session.start, point)));           // pointerUp
const containingSpace = spacesAt(shownMap(base, hiddenIds), point)[0];                                                                  // placeSymbol
```

`stackedSpaces(current).map(`·`{current.nodes.filter((node): node is BackgroundSymbol`·`road = isRoadSpace(node), centre = roadCentreLine(node);`의 글자는 그대로다(앵커 21·41이 읽고, 41은 그것으로 조각을 자른다). **편집기에 `shownMap(`은 이 넷뿐이다.** `placeSymbol`은 그 한 줄만 바뀐다: 그 아래의 `level`·새 기호·`updateMap({ ...base, nodes: [...base.nodes, symbol] })`는 그대로이고, `base`는 평면에서는 누른 순간의 초안(`live`), 3D에서는 `current`다 — 둘 다 전체 도면이다.

**보조 평면도**(`BackgroundMapPlanPreview.tsx`):

```tsx
export function BackgroundMapPlanPreview({ map, selectedId, onSelect, canEdit, scrub, hiddenIds }: MapPlanPreviewProps) {   // canEdit·scrub은 1차가 넣은 이름이다(:130). hiddenIds를 그 뒤에 — 이 줄은 1차의 앵커 64가 글자로 고정한다(6.5)
  // What a click can land on: the map without what the eye of the object list hides. Read by the click alone: the plan is framed and read out from the whole map.
  const pointed = useMemo(() => shownMap(map, hiddenIds), [map, hiddenIds]);
  const latest = useRef({ map: pointed, selectedId, onSelect, scale });
  latest.current = { map: pointed, selectedId, onSelect, scale };
  …
  {stackedSpaces(map).map(node => !hiddenIds?.has(node.id) && <PlanShape key={node.id} … />)}
  {map.nodes.map(node => node.type === 'symbol' && !hiddenIds?.has(node.id) && <PlanShape key={node.id} … />)}
  {map.nodes.map(node => node.type === 'camera' && !hiddenIds?.has(node.id) && <PlanCamera key={node.id} … />)}
```

`stackedSpaces(map).map(`의 글자(앵커 21)와 `nextPlanSelection(now.map, …)`의 호출(앵커 34)은 그대로다. 함수 머리는 1차의 앵커 64가 글자로 고정하므로 그 단언을 같은 커밋에서 고친다(6.5). `planViewBox(map, size)`·`planSelectedNode(map, selectedId)`·옆 그림(`CameraReadout`(:115)이 `BackgroundMapPlanSide`에 넘기는 `map`)은 **전체 도면** 그대로 읽는다 — 옆 그림의 높이 끌기는 쓰는 곳이다(1차의 `fieldScrub`). 숨긴 카메라는 선택되지 않으므로(4.5) 옆 그림에 나오지 않는다.

### 4.5 선택 규칙과 핸들러

| 한 일 | 결과 |
|---|---|
| 선택되지 않은 것의 눈을 끈다 | 선택은 그대로. 속성 칸도 그대로 |
| 평면: 하나 고른 것의 눈을 끈다 | 선택이 비고 속성 칸이 '도면 구성'으로 돌아간다. 손잡이가 없어진다 |
| 평면: 묶음 가운데 하나의 눈을 끈다 | 나머지가 그대로 골라져 있다(둘에서 하나가 되면 그 하나의 속성이 나온다) |
| 3D: 손에 든 것의 눈을 끈다 — 묶음이 둘 이상 남는다 | 손에 든 것이 없다(폼·기즈모가 없어지고, 카메라 시점이었으면 끝난다 — :449-451). 평면에서 고른 묶음은 남은 것끼리 그대로다 |
| 3D: 묶음 가운데 손에 들지 않은 것의 눈을 끈다 — 묶음이 둘 이상 남는다 | 손에 든 것은 그대로다(묶음 밖의 것을 들고 있었어도) |
| 3D: 눈을 꺼서 **묶음이 하나만 남는다** — 숨긴 것을 들고 있었거나, 남은 그것을 들고 있었거나, 아무것도 들지 않았다 | 남은 하나가 선택이고 손에 든 것이 된다 |
| 3D: 눈을 꺼서 묶음이 하나만 남는다 — **묶음 밖의 다른 것을 들고 있었다** | 손에 든 것이 그대로 손에 있고(폼·기즈모가 그대로이고, 그 카메라 시점이었으면 이어진다) **그것이 선택이 된다.** 묶음의 남은 하나는 풀린다 — 속성 칸에서는 묶음 안내 줄만 없어지고, 평면으로 돌아가면 손에 들었던 그 하나가 골라져 있다(J13) |
| 평면: 3D에서 손에 들었던 묶음 밖의 것을 평면에서 숨긴다 | 묶음은 그대로. 다음에 3D로 가면 묶음의 대표가 손에 있다 |
| 3D가 적어 둔 고름이 지금은 손에 없는데(묶음이 하나 이하다) 그 노드를 숨긴다 | 화면은 그대로이고 적어 둔 고름만 지워진다 — 묶음이 다시 늘어도 숨긴 것이 손에 들리지 않는다 |
| 숨긴 줄의 **이름**을 누른다 | 다시 보이고, 그것이 선택된다 |
| 숨긴 줄의 **눈**을 누른다 | 다시 보이기만 한다(선택은 그대로) |
| '모두 보이기'(제목·칩) | 모두 보인다. 선택은 그대로. 포커스가 캔버스로 간다 |

핸들러 다섯은 **`const clearSelection = useEvent(() => select(null));`(:1049) 바로 다음 줄**에 이 차례로 둔다(글자 그대로 — 앵커 R2-2):

```tsx
  // View settings of this PC: the eye of the object list and the closed box of a room in 3D. They write no map: no undo step, nothing to save.
  const setNodesHidden = useEvent((ids: readonly string[], hidden: boolean): boolean => {
    // Not during a drag: its session works on what was drawn and stacked at the press.
    if (!current || pointerRef.current || doc.isGestureActive()) return false;
    const next = withHiddenNodes(viewPrefs, current, ids, hidden);
    if (next !== viewPrefs) { setViewPrefs(next); storeMapViewPrefs(viewerId, next); }
    if (!hidden) return true;
    // What is hidden is never selected: it leaves the group picked on the plan, the hand of the 3D view, and the pick that view stored.
    const live = mapDraft(doc.getState(), current.id)?.value ?? current;
    const left = selectionWithout(live, liveSelection(current.id, live), mapViewport(doc.getState(), current.id).selectedId, ids, mode === 'plan');
    if (!left.changed) return true;
    doc.selectMany(current.id, left.ids);
    // In 3D, with a group still picked on the plan, the node in hand is a pick of its own: kept, or let go.
    if (mode === '3d' && left.ids.length > 1) select(left.inHand);
    // The list moves under the pointer only when the properties above it show something else.
    if (left.moved) swallowSecondClick();
    return true;
  });
  const toggleHidden = useEvent((id: string) => { setNodesHidden([id], !hiddenIds.has(id)); });
  const showAll = useEvent(() => { if (setNodesHidden([...hiddenIds], false)) focusCanvas(); });
  /** A row of the object list. A hidden one is shown first: nothing hidden is ever selected. */
  const selectFromList = useEvent((id: string) => { if (!hiddenIds.has(id) || setNodesHidden([id], false)) select(id); });
  const setSpacesSolid = useEvent((ids: readonly string[], solid: boolean) => {
    if (!current || pointerRef.current || doc.isGestureActive()) return;
    const next = withSolidSpaces(viewPrefs, current, ids, solid);
    if (next !== viewPrefs) { setViewPrefs(next); storeMapViewPrefs(viewerId, next); }
  });
```

- **`doc.selectMany`가 먼저다.** 선택을 `left.ids`로 바꿔 넣고(묶음에서 숨긴 것을 뺀 것 — J13의 경우에만 손에 든 것 하나다, 3절), 3D가 적어 둔 고름(`selectedId`)을 그 마지막으로 돌린다 — 묶음이 그대로여도 부른다: 묶음 밖의 것을 손에 들고 있다가 숨기는 경우, 그리고 **적어 둔 고름이 지금 손에 없는 채로 숨긴 것을 가리키는 경우**(하나 이하를 골랐을 때 그 값은 읽히지 않을 뿐 남아 있다 — 묶음이 되돌리기·다시 실행으로 둘이 되는 순간 다시 읽힌다). `left.changed`가 그 둘을 함께 센다(3절). 평면에서는 이것으로 끝이다.
- **3D이고 적은 선택이 둘 이상일 때만** 편집기의 `select()`로 손에 든 것을 바로잡는다: 숨긴 것이었으면 `null`(놓는다), 아니면 그것 그대로(묶음을 고쳐 쓰며 대표로 넘어간 것을 되돌린다). 하나 이하면 부르지 않는다 — 그때 `select()`는 바꿔 넣기라 그 하나를 지우고, 부를 것도 없다: 하나만 고른 선택은 그 하나가 손에 든 것이다(J13에서는 `left.ids`가 이미 손에 들고 있던 것이다). `select()`가 보는 `selection`은 이 누름 직전의 렌더 것이고, 그 길이가 둘 이상인 것으로 충분하다.
- `pick-one`을 직접 보내지 않는다(앵커 23: 편집기의 고르기는 `select()` 한 줄과 `doc.selectMany`뿐이다). `doc.selectMany(`는 넷이 된다.
- 눈을 켤 때(`hidden` 거짓)는 선택을 건드리지 않는다. `selectFromList`만이 켠 뒤에 고른다 — 켜는 것이 거절되면(끌기 도중) **고르지도 않는다**.
- `swallowSecondClick()`(:478-482)은 **속성 칸에 보이는 것이 바뀔 때만** 부른다(`left.moved`, J10): 고른 하나를 숨겨 '도면 구성'이 될 때, 묶음이 하나로 줄어 그 하나의 폼이 될 때, 3D에서 손에 든 것이 놓이거나 바뀔 때, 3D의 묶음 안내 줄이 없어질 때. 속성 칸이 그대로인 때 — 평면에서 셋 이상의 묶음 가운데 하나, 3D에서 손에 들지 않은 묶음의 것(둘 이상 남을 때), 적어 둔 고름만 지울 때 — 는 부르지 않아서, 고른 묶음의 눈을 잇달아 눌러도 둘 이상 남는 동안에는 다 듣는다. 삼키는 0.5초에는 창 단위·캡처 단계에서 `pointerdown`~`click`·`dblclick`을 멈춘다(:114): **마우스의 누름과, Enter·Space로 누르는 버튼**(그것도 `click`으로 온다)이 듣지 않는다. 편집기의 단축키(`keydown`)는 듣는다.
- 다섯 가운데 어느 것도 `updateMap`·`doc.update`·`doc.previewGesture`·`patchNode`를 부르지 않는다.

목록의 태그(:1328)는 이렇게 바뀐다(앵커 36): `<ObjectList nodes={settledCurrent?.nodes ?? current.nodes} selectedIds={listSelection.ids} primaryId={listSelection.primaryId} hiddenIds={hiddenIds} hiddenCount={hiddenCount} onSelect={selectFromList} onToggleHidden={toggleHidden} onShowAll={showAll} />`(`hiddenCount`는 목록이 받는 그 `settledCurrent`에서 센 수다 — 4.1). 3D와 보조 평면도는 지금처럼 `selectNode`를 받는다(그들이 알려 주는 id는 그려진 것뿐이다).

### 4.6 거절되는 때, 모드, 키보드

| 때 | 눈·'모두 보이기' |
|---|---|
| 보기 모드, 편집 중, 읽기 전용 계정, 저장이 도는 중(`disabled`) | **모두 된다**(J12 — 도면을 쓰지 않는다. 지금도 목록의 줄은 어느 때에나 눌린다) |
| 평면의 포인터 세션 중(끌기·화면 이동·선택 상자 — `pointerRef.current`), 문서의 제스처 중(3D 기즈모, 1차의 숫자 끌기 — `doc.isGestureActive()`) | 아무 일도 하지 않는다(말없이). 세션은 누를 때 그려진 것과 더미로 일한다 |
| 평면 / 3D, 속성 칸이 접힌 때 | 목록은 속성 칸과 함께 접히고, 칩은 남는다 |

키보드: Tab 차례는 (숨긴 것이 있을 때) 제목의 '모두 보이기' → 줄의 이름 → 그 줄의 눈 → 다음 줄이다. 눈은 버튼이라 Enter·Space로 눌린다(속성 칸이 바뀐 직후의 0.5초만 예외다 — 4.5). 새 단축키는 없다. `keyboard()`(:1003)는 고치지 않는다 — 버튼 위의 키는 지금처럼 그 가드(:1022)에서 돌아간다.

### 4.7 숨긴 채 저장해도 모든 노드가 저장된다

1. 저장되는 것은 초안의 값이다(2.7). 그 값을 적는 길은 `updateMap`과 제스처의 미리보기 둘뿐이다(제스처는 평면의 끌기, 3D의 기즈모, 1차의 숫자 끌기와 옆 그림의 높이 끌기 — 2.7).
2. 걸러 본 도면이 만들어지는 곳은 편집기의 네 자리와 보조 평면도의 한 자리이고, 다섯 다 **id의 목록·스냅 선·공간 하나를 돌려주는 순수 함수의 인자**다(`planPileAt`·`planMarqueeIds`·`planGestureCandidates`·`spacesAt`·`nextPlanSelection`). 그 결과는 도면이 아니다 — `placeSymbol`은 그렇게 찾은 공간의 id와 바닥 높이만 새 기호에 적고, 새 기호를 더하는 도면은 전체(`base`)다.
3. 쓰는 곳이 받는 도면은 그대로다: 포인터 세션의 `initial: live`(:879)와 `previewPlanGesture(gesture, session.initial, …)`(:902), `updateMap({ ...base, nodes: [...base.nodes, symbol] })`(:585), `<Map3D map={current}`(:1226 — 기즈모가 여기서 시작한다), 속성 칸의 `patchNode`(:537 — `current`와 문서에서 읽는다), 1차의 숫자 끌기와 옆 그림의 높이 끌기(`beginFieldScrub`·`previewFieldScrub`, :1056-1070 — 문서의 초안과 제스처의 시작 도면(`gestureStartMap`)에서 읽는다. 둘 다 전체 도면이다).
4. 3D와 장면은 도면을 거르지 않는다. id 묶음으로 `visible`만 끈다.

앵커 R2-1이 2와 3을 글자로 고정하고, 순수 테스트 V-13이 "걸러 본 후보로 스냅한 미리보기에 숨긴 노드가 그대로 들어 있고 저장 검증을 지난다"와 "숨긴 위층 아래에 놓은 기호가 아래층에 속한다"를 본다. 엔진에서는 N5가 숨긴 채 저장한 뒤 미리보기 저장소를 읽는다.

---

## 5. (d) 박스

### 5.1 장면이 그리는 것 — `map3dScene.ts`

5.1과 5.2에서 파일 이름 없이 적은 줄 번호는 `map3dScene.ts`의 것이다.

| 부분 | 닫힌 방 | 비치는 방(지금 그대로) |
|---|---|---|
| `space-floor` | 같은 지오메트리, 재질 `spaceSolid`(고르면 `spaceSolidOn`), `pickPart: 'shell'`. `renderOrder`는 그대로 −1 | `spaceFloor`/`spaceFloorOn`, `'floor'` |
| `space-walls` | 같은 지오메트리, 같은 닫힌 재질, `'shell'` | `spaceWall`/`spaceWallOn`, `'wall'` |
| `space-lid` (새) | **바닥의 지오메트리 그 객체**를 한 번 더 쓴 메시(새 지오메트리 없음), `position.y = 벽 높이`, 같은 재질, `'shell'` | 없다 |
| `space-outline` | 그대로: `spaceLine` 55% / 고르면 100%, 잠기면 점선(`spaceDash`) | 같다 |
| 이름표 | 그대로: 벽 높이 + 4 = 뚜껑 위 4 | 같다 |
| 그 방이 온전히 품은 노드 | **뿌리와 따라다니는 것(이름표·내림선)을 그리지 않고, 클릭 대상에서도 뺀다**. 고른 노드만 예외(5.3) | 그린다 |
| 뿌리의 자식 순서 | `space-floor`, `space-walls`, `space-lid`, `space-outline` | `space-floor`, `space-walls`, `space-outline`(`tests/backgroundMap3dScene.test.ts:270`이 고정) |

**닫힌 재질**(`material()`에 두 가지, 공용 — 테마가 바뀌면 다른 재질처럼 다시 만든다. 모듈 상수 둘 — `mixHex`와, `sync`가 읽는 빈 묶음 `NO_IDS` — 은 `finite`(:70) 다음에 이 차례로 둔다):

```ts
// Every face of a room that is drawn closed: opaque, so it hides what is inside and behind. Pushed back a little, so the outline on its edges is not fought over.
const closed = (share: number) => new MeshLambertMaterial({ color: mixHex(palette.card, palette.accent, share), side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
…
case 'spaceSolid': return closed(0.35);
case 'spaceSolidOn': return closed(0.6);
```
```ts
/** The colour `share` of the way from one colour to another, channel by channel. */
const mixHex = (from: number, to: number, share: number) =>
  [16, 8, 0].reduce((hex, shift) => hex | (Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * share) << shift), 0);
/** Nothing hidden, no closed room: the one set an option that is absent reads as. */
const NO_IDS: ReadonlySet<string> = new Set();
```

- 불투명이다: `transparent` 거짓, `opacity` 1, `depthWrite`·`depthTest` 참(모두 기본값이라 적지 않는다). 그래서 불투명한 것들과 함께 **먼저** 그려지고 깊이를 적는다 — **면 뒤에 있는 것**(박스 뒤의 사물과 카메라, 다른 방의 비치는 면과 선)은 깊이 검사에서 떨어져 그려지지 않고, 앞에 있는 비치는 면은 지금처럼 그 위에 섞인다. 바닥의 `renderOrder`가 무엇이든 이 차례는 같다.
- `polygonOffset`은 면을 깊이에서 조금 뒤로 민다. 면의 모서리에 정확히 놓인 외곽선이 면과 다투지 않고 또렷하다. 면 뒤쪽의 선은 가려진다(상자 뒷모서리가 비치지 않는다). **같은 까닭으로 면과 한 평면에 놓인 다른 것도 면을 이긴다** — 뚜껑 높이까지 오는 계단의 윗단, 벽에 붙은 안쪽 방의 선과 벽, 바닥에 선 다리의 밑면(아래에서 볼 때). 밀기를 빼면 그 자리가 깜빡일 뿐이라 답이 아니다. 그래서 **깊이 검사에만 맡기지 않고, 닫힌 방이 온전히 품은 노드는 아예 그리지 않는다**(아래 `sync`).
- **색의 출처**: 테마의 카드색(`--color-bg-card`)에 강조색(`--color-accent`)을 섞는다 — `readPalette`가 이미 읽는 두 값이다(BackgroundMap3D.tsx:44-45). 기본 테마의 어두운 화면에서 `#37336a`(고르면 `#4b439a`), 밝은 화면(카드 `#ffffff`)에서 `#ccc6f7`(고르면 `#a79df1`) — 돌려 본 값이다. 다른 테마는 그 테마의 강조색으로 같은 식이다.
- 빛은 기호와 같은 것을 받는다(`AmbientLight` 2.2 + `DirectionalLight` 1.5, :169-170): 면의 밝기는 뚜껑 1.10, 해 쪽 벽 0.92·0.84, 그늘진 벽과 아래에서 본 면 0.70배다(주변광이 커서 차이가 작다 — 기호도 같다). 양면(`DoubleSide`)이라 안쪽에서 보아도 막혀 있다. **계산한 모습**(기본 테마):

  | | 면의 색(뚜껑 / 벽 둘 / 그늘) | 면끼리의 밝기 차이(L\*) | 외곽선(강조 보조색 55%)의 대비 | 박스와 땅 |
  |---|---|---|---|---|
  | 어두운 화면 | `#3a366f` / `#353166`·`#322e62` / `#2d2a59` | 2.4 · 1.4 · 2.2 — **거의 한 색** | 면 위에서 2.4~2.7:1 — **모서리가 덩어리를 읽게 한다** | L\* 10~17 차이 |
  | 밝은 화면 | `#d5cfff` / `#c5bfee`·`#bdb7e5` / `#aea9d3` | 5.8 · 2.9 · 5.4 — **면이 갈린다** | 면 위에서 1.05~1.3:1 — 선은 면에 묻힌다(잠근 박스의 점선도) | L\* 15~29 차이 |

  두 화면 모두 고른 박스는 더 진하다(뚜껑의 L\*가 어두운 화면 25.8 → 35.2, 밝은 화면 85.0 → 71.2). 눈으로 본 뒤의 대체안은 11.2다.
- **도로는 닫히지 않는다**: `buildSpace`의 도로 가지(:469-484)는 닫힌 재질을 보지 않는다. 방을 도로로 바꾸면 평평하게 그려지고, 다시 방으로 바꾸면 박스다(id가 `solidIds`에 남아 있다).

**`buildSpace(entry, node, selected, solid)`** — 바뀌는 줄만(앵커 R2-4):

```ts
    // Drawn closed: one opaque material on the floor, the walls and a lid. A road is never closed.
    const shell = solid && !road ? this.material(selected ? 'spaceSolidOn' : 'spaceSolid') : null;
    const floor = new Mesh(entry.own.track(new ShapeGeometry(…).rotateX(Math.PI / 2)),
      shell ?? this.material(road ? (selected ? 'roadFloorOn' : 'roadFloor') : (selected ? 'spaceFloorOn' : 'spaceFloor')));
    floor.renderOrder = road ? -1.5 : -1;                                   // 그대로(앵커 44)
    …
    const walls = new Mesh(wallGeometry, shell ?? this.material(selected ? 'spaceWallOn' : 'spaceWall'));
    …
    floor.name = 'space-floor'; walls.name = 'space-walls'; edges.name = 'space-outline';
    const faces = [floor, walls];
    if (shell) {
      // The lid is the floor once more, at the top of the walls: the same geometry, not a second one.
      const lid = new Mesh(floor.geometry, shell);
      lid.position.y = height; lid.name = 'space-lid';
      faces.push(lid);
    }
    for (const mesh of faces) { tag(mesh, node.id, 'space', shell ? 'shell' : mesh === floor ? 'floor' : 'wall'); entry.picks.push(mesh); }
    entry.root.add(...faces, edges);
```

**`sync`** — 바뀌는 줄만:

```ts
    const holdId = options.holdId ?? null, hiddenId = options.hiddenId ?? null, hiddenIds = options.hiddenIds ?? NO_IDS, solidIds = options.solidIds ?? NO_IDS;
    this.last = { map, selectedId, options: { holdId, hiddenId, hiddenIds, solidIds } };
    // The camera that is looked through: the room it stands in opens, or the preview would show the inside of a box.
    const lens = hiddenId !== null && solidIds.size ? map.nodes.find(node => node.id === hiddenId) : undefined;
    // The rooms drawn closed, read from the map before any entry is touched: what they hide does not depend on the order of the nodes. A road is never closed.
    const boxes = solidIds.size ? map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && solidIds.has(node.id) && !isRoadSpace(node) && !(lens && spaceHoldsNode(node, lens))) : [];
    const boxIds = new Set(boxes.map(space => space.id));
    // What stands whole inside a closed room that is on show is not drawn: lying on a face of the box it would show on it, and take the click. The selected node is drawn.
    const held = nodesHeldBy(map, boxes.filter(space => !hiddenIds.has(space.id)));
    const seen = new Set<string>();                                                                     // 그대로
    …
      const selected = node.id === selectedId, solid = boxIds.has(node.id);
      if (node.id !== holdId) {
        if (entry.dirty || entry.node !== node || entry.selected !== selected || entry.solid !== solid) this.refresh(entry, node, selected, solid);
      } else if (entry.dirty && entry.node) {
        this.redraw(entry, entry.node, entry.selected, entry.solid);
        entry.dirty = false;
      }
      const visible = entry.valid && node.id !== hiddenId && !hiddenIds.has(node.id) && (selected || !held.has(node.id));
      if (entry.root.visible !== visible) { entry.root.visible = visible; entry.aux.visible = visible; this.picks = null; }   // 그대로
```

- **보이고 안 보이고는 이 한 줄(`visible`)이 정한다**: 자세가 온전하고, 들여다보는 카메라가 아니고, 눈으로 숨기지 않았고, 닫힌 방이 품지 않았다(고른 노드는 품겼어도 그린다). 뿌리와 따라다니는 것(`aux` — 이름표, 카메라의 내림선과 고리)이 함께 꺼지고, `pickTargets`는 지금처럼 보이는 뿌리만 준다(:209-212) — 그래서 품긴 것은 그려지지도 눌리지도 않는다. 이름표를 따로 끄는 줄은 없다.
- **`boxes`와 `held`는 노드를 돌기 전에 도면에서만 만든다.** 앞의 노드가 뒤의 박스에 품겼는지를 `entry`의 앞선 상태로 묻지 않는다(도면의 순서와 처음 맞추는 때에 기대지 않는다 — S-6).
- **품는 것은 그려지는 박스뿐이다**: 눈으로 숨긴 박스는 `held`를 만들 때 뺀다(숨긴 박스는 아무것도 가리지 않는다). 다른 박스에 품겨 그려지지 않는 박스는 빼지 않아도 된다 — 그것이 품은 것은 바깥 박스도 품는다(오목한 윤곽의 어림은 11.4). 자세나 높이가 숫자가 아닌 박스는 아무것도 품지 않는다(`spaceHoldsNode`의 비교가 모두 거짓이다).
- 박스가 하나도 없으면 `held`는 하나뿐인 빈 묶음이고 `visible` 줄은 지금과 같은 값이다(R2).

그 밖에: `Map3DSyncOptions`에 `hiddenIds?: ReadonlySet<string>`·`solidIds?: ReadonlySet<string>`(없으면 이 모듈의 빈 묶음 `NO_IDS` — 위에 선언한 그 상수다. 뷰포트의 `NO_IDS`(5.4)나 `mapViewPrefs.ts`의 것을 가져오지 않는다: import의 방향이 거꾸로이고 R7에 어긋난다), `Entry`에 `solid: boolean`(만들 때 거짓, `refresh`가 적는다), `MaterialKey`에 두 이름, `PickPart`에 `'shell'`, `redraw`·`refresh`·`buildSpace`가 `solid`를 한 인자 더 받는다. `shapeKey(node, selected, solid = false)`는 **공간의 열쇠 끝에만** `${solid ? '|solid' : ''}`를 붙인다 — 카메라의 줄은 손대지 않는다(앵커 45). 그래서 박스를 켜고 끄면 그 방의 메시만 다시 만들어지고 뿌리는 그대로다. `setPalette`는 마지막 옵션으로 다시 맞추므로(:230) 테마를 바꿔도 박스와 숨김이 남는다 — **`this.last`의 옵션에 네 값이 모두 있어야 한다**(둘 가운데 하나가 빠지면 테마를 바꾸는 순간 그것이 풀리고, 뷰포트는 "같은 객체"라며 다시 맞추지 않는다). `nodesHeldBy`·`spaceHoldsNode`는 이미 있는 `./mapStack.ts` import 줄(:14)에 이름을 더한다.

**`spaceHoldsNode` · `nodesHeldBy`** — `mapStack.ts`에 더한다(순수 — 앵커 32. `nodeElevation`·`nodeVolumeHeight`·`spaceWallHeight`를 `mapSpatial.ts`에서, `BackgroundNode` 타입을 더 가져온다. 돌려 본 구현 그대로다):

```ts
/** Slack of the hold test: a share of the way from a corner towards the middle of its two neighbours, plan units around a camera or a corner, and level units. What stands flush against a wall, on the floor or up to the top is inside. */
const HOLD_SLACK = 1e-6;
/** The eight directions around a plan point. */
const AROUND: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** No node is held: one set for every time, so nothing that reads it by identity is woken. */
const NONE_HELD: ReadonlySet<string> = new Set();
/**
 * Whether a room holds a node whole: its plan outline (every corner of a space or a symbol, and the middle of its box
 * where that middle is a point of the node; the position of a camera) lies inside the outline of the room or on it, and
 * it stands between the floor and the top of the walls, both included. A road has no volume, and a room does not hold itself.
 */
export function spaceHoldsNode(space: BackgroundSpace, node: BackgroundNode): boolean {
  if (node.id === space.id || isRoadSpace(space)) return false;
  const floor = nodeElevation(space), top = floor + spaceWallHeight(space), level = nodeElevation(node);
  // A camera is a point: it has no height of its own.
  const height = node.type === 'camera' ? 0 : node.type === 'space' ? spaceWallHeight(node) : nodeVolumeHeight(node);
  if (!(level >= floor - HOLD_SLACK && level + height <= top + HOLD_SLACK)) return false;
  // A camera on a wall line is inside, whatever the shape of the room: containsPoint reads the edges of a polygon half open, so the point is asked a hair away on every side.
  if (node.type === 'camera') return AROUND.some(([dx, dy]) => containsPoint(space, { x: node.x + dx * HOLD_SLACK, y: node.y + dy * HOLD_SLACK }));
  const middle = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  // Inside an outline or on it: a hair away on one side or another is inside, as a camera is asked.
  const near = (area: BackgroundSpace, point: BackgroundPoint) => AROUND.some(([dx, dy]) => containsPoint(area, { x: point.x + dx * HOLD_SLACK, y: point.y + dy * HOLD_SLACK }));
  // The middle of the box is asked where it is a point of the node. A space may not hold it: it lies outside an L or a U
  // (not asked) and on the long side of a right triangle (asked, and then it may lie on a wall of the room).
  if (!containsPoint(space, middle) && (node.type !== 'space' || (near(node, middle) && !near(space, middle)))) return false;
  // Each corner is asked a hair towards the middle of its two neighbours (for a rectangle, its middle), or on the outline:
  // a wall the node stands flush against does not put it outside, whatever its shape. The first finds the inside at a
  // sharp corner, the second at a corner that turns inwards or lies on a straight stretch of outline.
  return nodePlanOutline(node).every((point, index, outline) => {
    const before = outline[(index + outline.length - 1) % outline.length], after = outline[(index + 1) % outline.length];
    return containsPoint(space, { x: point.x + ((before.x + after.x) / 2 - point.x) * HOLD_SLACK, y: point.y + ((before.y + after.y) / 2 - point.y) * HOLD_SLACK }) || near(space, point);
  });
}
/**
 * The nodes that rooms drawn closed in 3D hold whole: what is not drawn there. `boxes`: those rooms. Two of them that
 * hold each other (the same outline on the same levels) are told apart by the map: the earlier one, which lies below on
 * the plan, holds the later one. The one empty set when there is no such room.
 */
export function nodesHeldBy(map: BackgroundMap, boxes: readonly BackgroundSpace[]): ReadonlySet<string> {
  if (!boxes.length) return NONE_HELD;
  const order = new Map(map.nodes.map((node, index) => [node.id, index])), at = (id: string) => order.get(id) ?? -1;
  const held = new Set<string>();
  for (const node of map.nodes)
    if (boxes.some(box => spaceHoldsNode(box, node) && !(node.type === 'space' && boxes.includes(node) && at(node.id) < at(box.id) && spaceHoldsNode(node, box)))) held.add(node.id);
  return held.size ? held : NONE_HELD;
}
```

| 묻는 것 | 답 |
|---|---|
| **온전히 안** | 공간·기호: 평면 윤곽(`nodePlanOutline` — 기울인 사물은 드리운 윤곽)의 **모든 꼭짓점**과, 노드 상자의 가운데가 **그 노드의 점일 때** 그 가운데가 방의 윤곽 안이고, 바닥이 방의 바닥 이상, 꼭대기(바닥 + 벽 높이 / 사물의 키)가 방의 꼭대기 이하다. **같으면 안이다** — 벽에 딱 붙은 방, 뚜껑 높이까지 오는 계단이 바로 가려야 하는 것이다(꼭짓점은 **이웃한 두 꼭짓점의 가운데 쪽으로** 백만분의 일 당긴 자리나, 여덟 방향으로 백만분의 일 떨어진 자리 가운데 하나가 안이면 안이다: `containsPoint`의 다각형 가지는 경계 위의 점을 밖으로 읽기도 한다 — 사각형을 다각형으로 바꾼 방의 모서리가 그렇다) |
| 카메라 | 지금 서 있는 점과 높이: 윤곽 안이거나 **윤곽 위**이고, 바닥 이상·꼭대기 이하다 — **카메라도 같으면 안이다.** 벽 선 위에 딱 선 카메라(스냅이 그렇게 놓는다 — 2.8)와 뚜껑 높이에 선 카메라는 품긴다: 방이 사각형이든 그것을 다각형으로 바꾼 것이든, 네 벽과 모서리 어디서든 답이 같다. 윤곽 위인지는 여덟 방향으로 백만분의 일 떨어진 자리 가운데 하나라도 윤곽 안인지로 묻는다(가운데 쪽으로 당기는 방법은 ㄱ자 방의 파인 벽에서 밖을 가리킨다. 가로세로 넷만으로는 돌리지 않은 다각형 방의 모서리를 놓친다. 대각선 넷만으로는 45° 돌린 다각형 방의 모서리에서 안을 가리키는 방향이 없어 — 두 대각선이 벽 위에 정확히 놓인다 — 답이 반올림에 달리고, 방이 놓인 자리에 따라 자주 놓친다(K-1이 놓치는 자리를 정해 둔다) — 돌려 봤다). **이 답이 '이 카메라 시점으로 보기'에서 열리는 방도 정한다**(5.4): 밖으로 읽히면 방이 닫힌 채 안의 것이 그려지지 않아, 렌즈가 붙은 면만 잘려 나간 빈 방이 보인다. 벽 가까이에서 밖으로 뻗는 시야 선도 함께 그리지 않는다 |
| 둘러싼 방 · 걸친 것 | 품기지 않는다: 큰 방 한가운데의 작은 박스는 큰 방을 품지 않고, 벽을 가로지른 사물·박스보다 키가 큰 안쪽 방·서로 걸쳐 겹친 두 방은 어느 쪽도 품지 않는다(그대로 그려진다) |
| 윤곽과 높이가 같은 두 박스 | 서로를 품는다 → **도면에서 앞에 있는 것(평면에서 아래에 깔리는 것)이 뒤의 것을 품는다.** 하나는 그려진다. 박스와 꼭 같은 자리의 비치는 방은 순서와 무관하게 박스에 품긴다 |
| 도로 | 품지 않는다(부피가 없다). 박스 바닥에 깔린 도로는 품긴다 |

**구현 때 고친 것(작업 3의 검토, 2026-10-14)**: 처음의 규칙은 노드 상자의 가운데를 늘 묻고 꼭짓점을 그 가운데 쪽으로 당겼다. ㄱ자·ㄷ자 공간은 상자의 가운데가 자기 파인 곳(밖)에 있고, 직각삼각형은 빗변 위에 있어, 벽을 따라 붙은 ㄱ자 복도가 ㄱ자 건물에 품기지 않았고(꼭짓점이 파인 곳 쪽으로 당겨져 밖이 된다), 꼭 같은 ㄱ자·T자·직각삼각형 박스 둘이 서로를 품지 못해 둘 다 그려졌다(겹친 면이 일렁인다). 그래서 가운데는 그 노드의 점일 때만 묻고, 꼭짓점은 이웃한 두 꼭짓점의 가운데 쪽(사각형이면 상자의 가운데와 같다)으로 당기거나 여덟 방향 가운데 하나가 안이면 안이다. 사각형·타원·기호의 답은 처음 규칙과 같다(무작위 14만 가지로 견줬다 — 달라진 것은 모두 다각형 공간이 새로 품기는 쪽이다). K-1·K-2에 그 경우들을 더했다(ㄱ자 건물 안의 ㄱ자 복도 둘, 파인 곳의 벽에 붙은 방, 파인 곳을 건너는 막대와 탁자, 여섯 모양을 다섯 각도로 돌린 꼭 같은 박스 둘 — 두 순서). 11.2의 첫 대체안(`HOLD_SLACK`을 `1e-4`로)을 쓰면 K-1에서 백만분의 일을 고정한 단언 넷도 함께 고친다.

### 5.2 누르기

`pickMapFloor` **앞에**(`hitNode` 다음에) 둘을 둔다 — 앵커 21·49가 `pickMapFloor`부터 조각을 자르므로 그 앞이어야 어느 조각에도 들지 않는다:

```ts
/**
 * What a ray can reach: nothing behind the first room on it that is drawn closed. What lies on that very face stays, so
 * two lids on one level are still told apart as the plan stacks them. The same list back when the ray meets no such room.
 */
export function visibleMapHits<T extends MapPickHit>(hits: T[]): T[] {
  let face = Infinity;
  for (const hit of hits) if (hit.object.userData.pickPart === 'shell' && hit.distance < face) face = hit.distance;
  if (face === Infinity) return hits;
  const reach = face + 1e-6 * Math.max(1, face);
  return hits.filter(hit => hit.distance <= reach);
}
/** A hit a space is stood on for a click: its floor, or any face of a room that is drawn closed. */
const landsOnSpace = (hit: MapPickHit) => { const node = hitNode(hit); return node?.kind === 'space' && (node.part === 'floor' || node.part === 'shell'); };
```

`pickMapFloor`(:636)와 `mapFloorPile`(:684)의 `hits.filter(hit => { … node.part === 'floor'; })`를 `hits.filter(landsOnSpace)`로 바꾼다(두 곳, 다른 글자는 그대로 — 도로 규칙을 더하지 않는다, 앵커 49). 뷰포트는 `cast`(BackgroundMap3D.tsx:510)의 마지막 줄만 `return visibleMapHits(this.raycaster.intersectObjects(this.scene3d.pickTargets(), false));`로 바꾼다. `pickMapNode`·`mapSpacePile`·`mapClickStep`·`pick`은 고치지 않는다.

| 포인터 아래 | 고르는 것 |
|---|---|
| 박스의 어느 면(뚜껑·벽·아래에서 본 바닥) | 그 방 |
| 앞에 선 비치는 방의 **벽**, 그 뒤에 박스 | 박스(벽은 클릭을 삼키지 않는다 — 닫힌 면이 바닥처럼 센다) |
| 앞에 선 비치는 방의 **바닥** | 그 방(더 가까운 바닥이다) |
| 박스 앞에 선 카메라·사물 | 그것 |
| 박스가 품은 것(안에 온전히 든 사물·카메라·방 — 뚜껑 높이의 계단도) | 고를 수 없다 — 클릭 대상이 아니다(5.1의 `visible`). 박스가 골라진다 → 목록이나 보조 평면도에서 고른다 |
| 박스 뒤의 것 | 고를 수 없다 — 광선이 닫힌 면에서 잘린다(`visibleMapHits`). 박스가 골라진다 |
| 박스에 걸친 것(벽을 가로지른 사물, 뚜껑 위로 솟은 안쪽 방)의 밖으로 나온 부분 | 그것(그려져 있다) |
| 박스가 품었지만 **고른** 것 | 닫힌 면과 한 거리에 놓인 부분(뚜껑 높이의 윗단)을 누르면 그것, 그 밖의 자리는 박스 — 고른 것은 기즈모로 다룬다 |
| 박스 위에 떠 있는 비치는 방의 바닥 | 그 방. 같은 자리를 천천히 한 번 더 누르면 박스 |
| 박스를 같은 자리에서 천천히 한 번 더 | 그대로다(아래 것으로 넘어가지 않는다 — 보이지 않는 것을 고르지 않는다) |
| 박스 안에 온전히 든 박스(높이가 같든 낮든) | **바깥 박스**(안의 것은 그려지지 않는다) |
| 걸쳐 겹친 높이가 같은 박스 둘, 겹친 자리의 뚜껑 | 작은 것(두 뚜껑이 한 거리라 둘 다 남고, 평면의 겹침처럼 작은 것이 위다) |
| 박스 더블클릭 | 상세 도면이 있으면 들어간다(지금 그대로) |

### 5.3 박스가 품은 것

그려지는 닫힌 방이 **온전히 품은** 노드(5.1의 표)는 3D에서 없는 것처럼 다룬다: 본체·이름표·카메라의 내림선과 시야 선을 그리지 않고, 누를 수도 없다. 두 가지를 한 규칙으로 막는다 — 이름표는 깊이를 보지 않아(2.4) 박스 위에 떠서 안을 드러내고, 박스의 면과 한 평면에 놓인 것은 깊이 검사를 이겨 면 위에 비치며 클릭도 받는다(5.1).

- **고른 노드는 예외다**: 목록이나 보조 평면도에서 고르면 그 하나는 그려진다. 본체는 박스의 면 뒤라 가려지고(면과 한 평면인 부분과 박스 밖으로 나가는 시야 선은 보인다), 이름표와 — 편집 중 선택 도구일 때 — 기즈모(둘 다 깊이를 보지 않는다)가 박스를 뚫고 보여 옮길 수 있다. 선택을 풀면 다시 그려지지 않는다.
- 박스 자신과 그 이름, 뚜껑 위에 올려 둔 것, 박스를 둘러싼 방, 박스에 걸친 것은 그대로 그려진다. 걸친 것 가운데 박스 안쪽 부분은 깊이 검사로 가려진다.
- **박스 뒤에 선 것의 이름은 박스 위에 겹쳐 보인다.** 이름표는 깊이를 보지 않는다(2.4 — 벽이 비치는 지금은 그것이 자연스럽다). 박스 뒤의 카메라나 이름 있는 공간은 본체가 가려지고 눌리지도 않는데(5.2) 이름만 박스의 면 위에 뜬다. 안에 든 것이 아니라 뒤에 있는 것의 이름이지만 "안이 비친다"로 읽힐 수 있다 — 본 화면을 한솔에게 보이고(11.3), 거슬린다면 11.2의 대체안이다.
- 평면·보조 평면도·오브젝트 목록은 달라지지 않는다 — 품긴 것을 고르는 길이 거기다.
- 기즈모로 끄는 동안에도 같은 규칙이 미리보기의 도면으로 매번 다시 돈다: 박스를 옮겨 다른 것을 덮으면 그것이 그려지지 않고, 벗어나면 다시 그려진다. 박스에 속한 것은 박스를 따라가므로 품긴 채다.

### 5.4 박스가 비켜서는 때

| 때 | 동작 | 곳 |
|---|---|---|
| 편집 중 기호 도구를 들고 있는 동안(`roomsOpen = tool === 'symbol' && editing`) | **모든 방이 비친다.** 바닥을 겨눠야 하기 때문이다. 도구를 내려놓으면 박스가 돌아온다. **저장이 도는 사이에도 비친 채다**: `placing`(`canEdit`이 들어 있다)에 달면 기호 도구를 든 채 저장할 때마다 모든 박스가 닫혔다 열리고, 속성 칸의 안내 문장이 사라졌다 돌아와 그 밑의 목록이 두 번 뛴다(2.8) | **편집기** — 그동안 `<Map3D>`에 하나뿐인 빈 묶음을 준다(아래). 뷰포트와 장면은 받은 묶음을 그대로 쓴다 |
| '이 카메라 시점으로 보기' | **그 카메라가 서 있는 방만** 비치고(겹쳐 선 방이 여럿이면 모두) 그 방이 품었던 것이 그려진다. 다른 박스는 박스다(품은 것도 그려지지 않는다). 돌아오면 다시 닫힌다. 서 있는 방은 `spaceHoldsNode`가 정한다(5.1): 벽 선 위나 뚜껑 높이에 딱 선 카메라도 그 방 안이고, 윤곽 밖이나 뚜껑보다 높이 선 카메라에게는 그 방도 박스다 | 장면의 `sync` — `lens` |
| 방을 숨겼다(눈) | 그려지지 않고, 아무것도 가리지 않는다(품었던 것이 다시 그려진다) | `held`를 만들 때 눈으로 숨긴 박스를 뺀다 |
| 기즈모로 끄는 중 | 잡힌 뿌리는 지금처럼 다시 만들지 않는다. 뚜껑은 뿌리의 자식이라 함께 움직이고 늘어난다 | 고치지 않는다 |

뷰포트(`BackgroundMap3D.tsx`) — 바뀌는 줄만:

```ts
/** Nothing hidden, no closed room: one set for both, so the scene is not synced again for a new empty one. */
const NO_IDS: ReadonlySet<string> = new Set();
…
  private syncScene(map: BackgroundMap): void {
    const selectedId = this.props.selectedId, holdId = this.gizmo.draggedId, hiddenId = this.look?.id ?? null, shown = this.shown;
    // View settings of this PC, handed on as they come: when the rooms are see-through is the editor's to say.
    const hiddenIds = this.props.hiddenIds ?? NO_IDS, solidIds = this.props.solidIds ?? NO_IDS;
    if (shown && shown.map === map && shown.selectedId === selectedId && shown.holdId === holdId && shown.hiddenId === hiddenId && shown.hiddenIds === hiddenIds && shown.solidIds === solidIds) return;
    this.scene3d.sync(map, selectedId, { holdId, hiddenId, hiddenIds, solidIds });
    this.shown = { map, selectedId, holdId, hiddenId, hiddenIds, solidIds };
  }
```

같은 파일에서 `shown`의 타입(BackgroundMap3D.tsx:86)에 두 필드를 더하고, `gizmoAllowed`의 첫 줄(BackgroundMap3D.tsx:431) 조건 끝에 `|| props.hiddenIds?.has(id)`를 더한다(그리지 않는 것에 기즈모를 붙이지 않는다). `NO_IDS`는 `DOUBLE_CLICK_GUARD`(BackgroundMap3D.tsx:20) 다음 줄이다. props가 없거나 같은 객체면 다시 맞추지 않는다 — 지금과 같다(W-2). **`syncScene`은 `placing`을 읽지 않는다.**

편집기 — 바뀌는 줄만(`roomsOpen`은 `const selectedRoad = …`(:1099) 다음 줄):

```tsx
  /** In 3D every room is see-through while the symbol tool is in hand: a floor has to be aimed at. It hangs on `editing`, not on `canEdit`: that one goes with every save, and each box would close and open with it. */
  const roomsOpen = tool === 'symbol' && editing;
  …
  <Map3D map={current} … onUnavailable={leave3D} hiddenIds={hiddenIds} solidIds={roomsOpen ? NO_MAP_VIEW_PREFS.solid : solidIds} />
```

`NO_MAP_VIEW_PREFS.solid`는 `mapViewPrefs.ts`의 하나뿐인 빈 묶음이다 — 도구를 든 동안 렌더가 몇 번 돌든 같은 객체라 장면이 한 번만 다시 맞춰지고, 박스가 하나도 없는 도면에서는 `solidIds`가 이미 그 객체라 도구를 들어도 다시 맞추지 않는다(R2). 속성 칸의 안내 문장(5.5)도 `roomsOpen`을 읽는다 — 화면과 글이 같은 값에 달린다. `placing`(`tool === 'symbol' && canEdit`, :1228)은 고치지 않는다: 누름을 '놓기'로 읽는 조건이고, 저장 중에는 놓지 않는 것이 맞다.

### 5.5 속성 칸의 스위치

속성 칸에서 **'공간 종류' 구역을 닫는 `</>}`(:1272) 바로 다음 줄, `{selected.type === 'camera' && (() => {`(:1273) 바로 앞**에 둔다. 그 구역은 편집 중에만 그려지므로(`editing &&`, :1266) 보기 모드에서는 '이 공간 안으로' 바로 아래이고, 편집 중에는 그 사이에 '공간 종류'가 낀다(이름 → 연결 → [편집 중: 공간 종류] → 이 구역 → [편집 중: 접힌 구역들]). **'공간 종류'보다 아래여야 한다**: 이 구역은 도로에서는 그려지지 않으므로, 그 선택 칸에서 '도로'를 고르는 순간 구역(체크 칸·서너 줄의 글·두 버튼, 150px 안팎)이 없어진다 — 선택 칸 위에 있으면 방금 누른 선택 칸과 그 밑의 것이 포인터 밑에서 위로 뛴다:

```tsx
{/* A view setting of this PC, not a property of the space: there while viewing too, and never switched off by a lock or a save. In 3D only, where it shows. Below the kind of the space: a road has no such section, and nothing above that select may move when it is switched. */}
{mode === '3d' && selected.type === 'space' && !selectedRoad && <section className="bmap-solid" aria-label="3D에서 보는 방식">
  <label className="bmap-check"><input type="checkbox" checked={solidIds.has(selected.id)} onChange={event => setSpacesSolid([selected.id], event.target.checked)} />속이 안 보이는 박스로 보기</label>
  <p className="bmap-hint">이 PC에서 3D를 보는 방식만 바뀌어요. 도면에는 저장되지 않아요. 박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요.{roomsOpen ? ' 기호를 놓는 동안에는 모든 공간이 비쳐 보여요.' : ''}</p>
  <div className="bmap-link-actions"><button type="button" className="bmap-text-button" onClick={() => setSpacesSolid(mapRoomIds(current), true)}>모든 공간을 박스로</button><button type="button" className="bmap-text-button" onClick={() => setSpacesSolid([...solidIds], false)}>모두 비치게</button></div>
</section>}
```

아무것도 고르지 않은 3D의 '도면 구성'에는 한 줄을 더한다 — `<p className="bmap-hint">공간을 선택하면 내부 도면을 만들거나 연결할 수 있습니다.</p>`(:1320) 바로 다음 줄(J2):

```tsx
{mode === '3d' && <p className="bmap-hint">공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.</p>}
```

**글자.** 화면은 방을 '공간'이라고 부른다(목록의 종류 글자, '선택한 공간', 'N개 공간', 바로 윗줄의 '공간을 선택하면 …' — :156, :1248, :1319-1320. '방'은 '공간 종류'의 선택지 하나뿐이다, :1268). 새 문장 둘도 '공간'이다 — 도로는 화면에서 '도로'라 불리므로 묶음 버튼처럼 도로를 빼고 읽힌다. 안내 글의 셋째·넷째 문장은 **늘 있다**(체크를 켠다고 생기지 않는다 — 누름으로 움직이는 것이 없다): 박스로 한 방이 품은 것은 3D에서 본체도 이름도 사라지는데(5.3), 그것이 어디로 갔고 어떻게 닿는지를 화면이 말하지 않으면 지워진 것으로 읽힌다. 목록은 방향 없이 '오브젝트 목록'이라 부른다(창이 좁으면 속성 칸이 도면 아래에 놓여 '오른쪽'이 아니다).

| 때 | 보이는 것 |
|---|---|
| 3D, 방을 손에 들었다 — 보기 모드·편집 중·읽기 전용 계정·잠긴 방·저장 중 | 구역 전체. 체크 칸과 두 버튼은 **꺼지지 않는다**(`editing`·`fieldLocked`·`disabled`에 달지 않는다) |
| 3D, 방을 손에 든 채 **편집 중 기호 도구를 들었다**(`roomsOpen` — 방은 골라진 채다, :1156) | 구역 전체 + 안내 글 끝에 '기호를 놓는 동안에는 모든 공간이 비쳐 보여요.' 체크는 그때도 기억되고(저장소에 적힌다), 화면에는 도구를 내려놓은 뒤에 박스로 나타난다(5.4). 그 한 문장이 없으면 눌러도 달라지지 않는 스위치로 읽힌다. 그 문장도 비치는 모습도 저장이 도는 사이에 그대로다(5.4) |
| 3D, 방을 손에 든 채 '공간 종류'를 도로로 바꿨다 | 구역이 없어진다. 그 선택 칸과 그 위의 것은 제자리다(이 구역이 그 아래에 있다) |
| 3D, 도로를 손에 들었다 / 카메라·기호 | 없다 |
| 3D, 아무것도 손에 없다('도면 구성') | 구역은 없고, 한 줄: '공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.'(J2) |
| **평면**(방 하나를 골랐든 여럿이든, 아무것도 안 골랐든) | **없다**(J1) — 그 한 줄도 없다 |
| 끌기 도중 | 눌러도 바뀌지 않는다(4.6과 같은 가드) |

- 기본은 꺼짐이다(지금의 비치는 모습). 나중에 그린 방은 비치는 채로 시작한다.
- '모든 공간을 박스로'는 **그때 이 도면에 있는 방**(도로 아님)을 모두 박스로 한다. '모두 비치게'는 이 도면의 박스를 모두 푼다. 둘은 스스로 꺼지지 않는다(이미 그 상태면 아무 일도 없다 — 누른 버튼이 포커스를 든 채 꺼져 키가 닿지 않는 일을 만들지 않는다).
- 체크 칸은 버튼·입력이라 편집기의 키 처리(:1016, :1022)가 지금처럼 비켜 간다.

### 5.6 눈과 함께

숨긴 박스는 그려지지 않고 아무것도 가리지 않는다(품었던 것이 3D에 다시 그려진다). 박스 속의 것을 숨기면 그것은 평면·보조 평면도에서도 사라진다. **둘은 방향이 다르다**: 눈은 그 줄 하나만 숨기고(방을 숨겨도 안의 것은 남는다 — ④), 박스는 그 방이 품은 것을 3D에서 함께 가린다(한 덩어리로 보이는 것이 박스다 — ②). 박스는 평면과 보조 평면도를 바꾸지 않는다 — 박스 속의 것을 고르는 길이 거기와 목록이다. 숨긴 방은 3D에서 고를 수 없으므로 스위치에 닿으려면 먼저 보이게 한다(목록의 이름).

---

## 6. 공통 배선

### 6.1 props의 길

`mapCanvas.ts`:

```ts
export type Map3DProps = MapCanvasProps & {
  …
  /** View settings of this PC, never part of the map (mapViewPrefs.ts). Nodes that are not drawn and cannot be clicked. Absent: none. */
  hiddenIds?: ReadonlySet<string>;
  /** Rooms drawn as closed boxes. Absent: none. */
  solidIds?: ReadonlySet<string>;
};
/** Companion plan shown next to the 3D viewport. … `hiddenIds`: what the eye of the object list hides — not drawn, not clicked. Absent: none. */
export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' | 'selectedId' | 'canEdit' | 'onSelect'> & { scrub: MapFieldScrub; hiddenIds?: ReadonlySet<string> };
```

(`MapPlanPreviewProps`의 줄은 1차가 남긴 줄 `export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' | 'selectedId' | 'canEdit' | 'onSelect'> & { scrub: MapFieldScrub };`(mapCanvas.ts:70)에 `hiddenIds` 하나를 더한 것이다. **1차의 앵커 64가 그 줄을 글자로 고정한다**(`tests/backgroundMapEditorWiring.test.ts:2084`) — 그 단언을 같은 커밋에서 이 줄의 글자로 고친다(6.5).)

**둘 다 선택 값이어야 한다** — 편집기가 넘기지 않아도 뷰포트와 장면이 지금처럼 돌아야 한다(R2): 뷰포트 테스트의 대역이 **실행 때** 정해진 필드 목록으로 props를 만든다(`tests/backgroundMap3dScene.test.ts:2006`, :2016-2017). 이것을 지키는 것은 typecheck가 아니다 — `npm run typecheck`는 `src`와 `tests/playground*.test.ts`만 읽고 `tests/background*.test.ts`는 읽지 않는다(`tsconfig.json:23`, `tsconfig.playground-tests.json:8`). 지키는 것은 앵커 R2-4의 글자(`?:`)와, props 없이 도는 기존 뷰포트 테스트·W-2다. 편집기의 두 태그는 앞머리가 고정이고(앵커 23) 새 속성은 **끝에** 붙인다:

- `<Map3D map={current} selectedId={singleId} canEdit={canEdit} onSelect={selectNode}` … `onUnavailable={leave3D} hiddenIds={hiddenIds} solidIds={roomsOpen ? NO_MAP_VIEW_PREFS.solid : solidIds} />`(1차는 이 태그를 고치지 않는다. `roomsOpen`은 5.4).
- `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} hiddenIds={hiddenIds} />` — `canEdit`·`scrub`까지가 1차의 태그(:1233)이고 **1차의 앵커 64가 그 태그를 `/>`까지 글자로 고정한다**(테스트 :2066). 앵커 64는 보조 평면도의 함수 머리(:2069)와 `MapPlanPreviewProps`의 줄(:2084)도 글자로 고정하는데, 4.4와 위의 타입이 그 둘도 바꾼다 — **세 단언을 같은 커밋에서** 새 글자로 고쳐 쓴다(6.5).

**`map`에는 늘 `current`(전체 초안)가 간다.**

```
편집기 viewPrefs ─ mapViewPrefsOf ─┬─ hiddenIds ─┬─ 평면: 세 그리는 줄 + shownMap 넷(더미·상자·스냅 후보·새 기호의 공간)
                                    │             ├─ <BackgroundMapPlanPreview hiddenIds>  ─ 세 그리는 줄 + shownMap 하나(클릭)
                                    │             ├─ <ObjectList hiddenIds hiddenCount> · 칩(hiddenCount)
                                    │             └─ <Map3D hiddenIds> ─ syncScene ─ sync({ hiddenIds }) ─ root.visible
                                    └─ solidIds ──┬─ 속성 칸의 체크 칸
                                                  └─ <Map3D solidIds(roomsOpen이면 하나뿐인 빈 묶음)> ─ syncScene ─ sync({ solidIds, hiddenId }) ─ buildSpace · 품긴 것의 root.visible
```

### 6.2 `BackgroundMapEditor.tsx`에서 고치는 곳과 자리

| 것 | 자리(`56cbc744`의 줄과 그 줄의 글자) | 걸리는 앵커 |
|---|---|---|
| import: `Eye`·`EyeOff`(lucide), `mapViewPrefs`의 `NO_MAP_VIEW_PREFS`·`hiddenNodeCount`·`mapRoomIds`·`mapViewPrefsOf`·`readMapViewPrefs`·`selectionWithout`·`shownMap`·`storeMapViewPrefs`·`withHiddenNodes`·`withSolidSpaces`. `mapViewport`·`mapDraft`와 `spacesAt`은 이미 있다(:21, :17) | 맨 위 | — |
| 모듈 상수 `HIDDEN_NOTE`(4.2) | `const ROAD_HINT_NO_STRIP = …`(:104) 다음 줄 | 41(그 위 세 상수의 글자는 그대로) |
| `Props`에 `viewerId: string`, 인자 풀기에 `viewerId` | :43, :174 | — |
| `viewPrefs` 상태 | `const [snapEnabled, …`(:191) 다음 줄 | — |
| `hiddenIds`·`solidIds` | `const draft = mapDraft(state, current?.id);`(:254) 다음 줄 | :257·:260(앵커 23)은 그대로 |
| `hiddenCount` | `const settledSelected = …`(:292) 다음 줄, 목록 표시의 주석 앞 | 앵커 36의 조각(`const listSelection = useMemo(` → 다음 `useEffect(`) 밖 |
| 핸들러 다섯(4.5) | `const clearSelection = …`(:1049) 다음 줄, `const openView = …`(:1050) 앞 | `keyboard` 조각은 `const selectNode = useEvent(`에서 끝난다. 새 조각 R2-2는 `const setNodesHidden = useEvent(` → `const openView = useEvent(` |
| `ObjectList`의 본문(4.2) | :158-172 | 36(이름 버튼의 줄), 41(`isRoadSpace(node)` 셋), 45(`data-camera-color=` 둘) |
| 새 기호의 공간(4.4) — `placeSymbol`의 `containingSpace` 한 줄 | :580 | **21**(그 줄 — 고쳐 쓴다), 26(`placeSymbol(point, live)`의 호출은 그대로) |
| 더미 · 스냅 후보 · 상자(4.4) | :851 · :899 · :922 | 25 · 18(그 줄은 `.*`로 읽는다)·3 · 27·23 |
| 세 그리는 줄(4.4) | :1174-1175 · :1184 · :1197 | 21·41(표지 둘), 27(`shownIds.has(node.id)` 셋 그대로) |
| `<Map3D>`의 끝 · 보조 평면도 태그의 끝(6.1) | :1230 · :1233 | 23(앞머리 — 그대로 통과), 31, **1차의 64**(보조 평면도 태그 — 고쳐 쓴다. 64는 보조 평면도의 함수 머리와 `MapPlanPreviewProps`의 줄도 고정한다 — 6.1) |
| 바닥줄: 안내 글의 `title` 조건과 칩(4.3) | :1241 — `title={mode === 'plan' ? footerHint : undefined}`의 조건에 `\|\| hiddenCount > 0`, 칩은 안내 글 `</span>`과 `{mode === 'plan' && <div className="bmap-zoom">` 사이 | — (바닥줄을 읽는 앵커는 없다) |
| `roomsOpen`(5.4) | `const selectedRoad = …`(:1099) 다음 줄 | 44(`selectedRoad` 줄 그대로 — 그 앵커는 그 줄의 글자만 본다) |
| 박스 구역(5.5) | '공간 종류' 구역의 마지막 줄 `{isRoadSpace(selected) && !roadCentreLine(selected) && <p className="bmap-hint">…</p>}`(:1271) 다음의 `</>}`(:1272) 다음 줄, `{selected.type === 'camera' && (() => {`(:1273) 앞 | 41(도로 안내의 줄들)·43(선택 칸의 `onChange` 줄)은 그 글자만 본다 — 이 자리를 잘라 읽는 조각은 없다 |
| 3D '도면 구성'의 안내 한 줄(5.5) | `<p className="bmap-hint">공간을 선택하면 내부 도면을 만들거나 연결할 수 있습니다.</p>`(:1320) 다음 줄 | — |
| `<ObjectList>` 태그 | :1328 | 36 |

**1차 뒤의 자리.** 위 표의 줄 번호는 1차가 구현된 `56cbc744`의 것이다. 머지 전에 1차가 더 고쳐지면 또 밀린다 — **자리는 그 줄의 글자로 찾는다.** 1차와 겹치는 곳은 둘이다: ① 보조 평면도의 세 줄(1차가 `canEdit`·`scrub`을 붙인 태그·함수 머리·`MapPlanPreviewProps`의 뒤에 `hiddenIds` — 셋 다 1차의 앵커 64가 글자로 고정한다, 6.1), ② 핸들러의 자리 — 1차의 `fieldScrub` 조각은 `const beginFieldScrub = useEvent(`(:1056, `cancelCanvasGesture` 다음)에서 `const placeAt = useEvent(`(:1073)까지이고, 1차의 앵커 61은 `const beginCanvasGesture = …` 줄(:1051)을 글자로 고정하고 3D의 콜백 넷이 `beginFieldScrub` 바로 앞에 서 있는지 본다 — 모두 `openView`(:1050) 다음이라, `clearSelection`(:1049)과 `openView` 사이에 놓는 다섯 핸들러는 어느 것에도 닿지 않는다(`56cbc744`에서 봤다: 그 둘은 이웃한 줄이고, 그 사이를 읽는 조각이 없다). 1차의 삭제 핸들러(:708-762 — `uploadUnderlay` 다음, `function newSpace(` 앞)와 `dialogOpen`(:273, `gestureActive` 다음)도 이 표의 자리와 겹치지 않는다. **머지된 main에서 `const clearSelection`과 `const openView` 사이를 어떤 조각이 읽고 있으면** 다섯 핸들러를 `const gallery = useMemo(` 바로 앞으로 옮기고 R2-2의 끝 표지를 그 줄로 한다.

**지켜야 하는 것.** 표지 사이에 함수를 끼우지 않는다(핸들러는 위의 한 자리뿐이다) / 편집기에 `isRoadSpace(node)`를 더 쓰지 않는다(`mapRoomIds`와 `selectedRoad`를 쓴다) / `pointerDown`·`pointerUp`에 `select(`를 더하지 않는다(앵커 5가 센다) / `keyboard()`·`select()`·`navigate()`·`switchMode()`·`fitView()`·`doubleClickIntent()`·`saveMap()`·`persistMaps()`는 한 글자도 고치지 않는다. `placeSymbol()`은 `containingSpace` 한 줄만 고친다(새 기호를 적는 `updateMap` 줄은 그대로다).

### 6.3 CSS 전체 — `backgrounds-map.css`

이 절의 줄 번호는 `56cbc744`의 `backgrounds-map.css`의 것이다. 1차가 `.bmap-field-pair`(:171) 다음에 18줄(숫자 칸), `42584da6`의 :238(지금 :256) 다음에 11줄(삭제 창)을 더해 :172~:238은 18줄, 그 아래는 29줄 밀렸다 — **자리는 앞 줄의 선택자 글자로 찾는다**. 한 줄에 규칙 하나. 새 미디어 블록·전환·애니메이션·`font-style`이 없다. 선택자에 `.bmap-edit…`·`.bmap-main.is-editing`이 없다(앵커 54가 그 줄들을 훑는다). 기존 `lineOf()` 검사가 "하나뿐"이라고 보는 머리(`.bmap-canvas-wrap {`, `.bmap-main {` …)로 시작하는 줄이 없다.

`.bmap-node-type` 줄(:215) 다음에:

```css
/* A row is two buttons side by side: the name picks, the eye hides. Their sizes are spelled out: a button is a flex item whose default stretch differs between engines. */
.bmap-node-list li { display:flex; align-items:center; gap:2px; }
.bg-library .bmap-node-list li>button:not(.bmap-node-eye) { flex:1 1 0; width:auto; min-width:0; }
.bg-library .bmap-node-list .bmap-node-eye { flex:0 0 28px; width:28px; min-width:28px; padding:0; gap:0; justify-content:center; }
/* Hidden: the name is dimmed, by opacity alone, and stays readable (it is pressed to bring the node back). The fade is the shared one of the library's buttons, and reduced motion takes it away there. The eye keeps its full strength. */
.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye) { opacity:.7; }
/* Its focus ring is drawn inside it and would fade with it: under the keys the name is at full strength again (the eye beside it still shows it is hidden). */
.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye):focus-visible { opacity:1; }
/* The word for the kind is dimmed once, with its row: its own dimming on top of that would leave it unreadable. */
.bg-library .bmap-node-list li.is-hidden .bmap-node-type { opacity:1; }
/* 모두 보이기 beside the count: never taller than the badge, so the heading keeps its height as it comes and goes. */
.bg-library .bmap-objects .bmap-show-all { position:relative; flex-shrink:0; min-height:0; margin-left:auto; padding:0 2px; font-size:11px; line-height:1.4; white-space:nowrap; }
/* It is pressed on a taller area than its words: 5px more above and below, and no layout changes for it. */
.bg-library .bmap-objects .bmap-show-all::after { content:""; position:absolute; inset:-5px 0; }
/* The heading never wraps: its word and the button keep their width, and in a narrow panel the count gives way with an ellipsis. */
.bmap-objects .bmap-section-heading>strong { flex-shrink:0; }
.bmap-objects .bmap-badge { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; }
/* What hiding does, under the rows at all times: an eye that is pressed moves nothing. */
.bmap-objects>.bmap-node-list+.bmap-hint { margin-top:8px; }
```

`.bg-library .bmap-zoom .bmap-snap-toggle[aria-pressed="true"]` 줄(:160) 다음에:

```css
/* How many nodes the eye hides, and the way back. The anchor takes no room at all: no width, no height, and its right margin gives back the one gap it adds (keep it equal to the gap of the footer). So the hint beside it wraps exactly as without it, and the footer keeps its height. The chip floats on the anchor, over the free end of the footer. */
.bmap-hidden-slot { position:relative; flex:0 0 0; width:0; height:0; margin:0 -10px 0 auto; }
.bg-library .bmap-hidden-chip { position:absolute; right:10px; top:-13px; height:26px; min-height:26px; padding:0 10px; border-color:rgb(var(--color-accent) / .45); border-radius:13px; background:rgb(var(--color-bg-card)); color:rgb(var(--color-text-primary)); font-size:11px; white-space:nowrap; box-shadow:0 0 0 3px color-mix(in srgb, rgb(var(--color-bg-card)) 40%, rgb(var(--color-bg-primary))); }
/* Opaque under the pointer too: the shared hover is a see-through wash, and the hint may lie under the chip. */
.bg-library .bmap-hidden-chip:hover:not(:disabled) { border-color:rgb(var(--color-accent-sub)); background:rgb(var(--color-bg-card)); }
```

`.bmap-shape-actions` 줄(:239) 다음에:

```css
/* A view setting of this PC under the properties of a room, in 3D. */
.bmap-solid { margin:14px 0 8px; }
.bmap-solid .bmap-check { margin:0 0 6px; }
.bmap-solid .bmap-hint { margin-bottom:2px; }
```

- 줄의 두 버튼: 기존 규칙(:203)이 목록의 **모든** 버튼에 `width:100%`를 준다 — 새 두 줄이 더 센 선택자로 덮는다. 줄의 높이는 지금과 같은 32px이다.
- 제목 줄(`.bmap-section-heading`, :25)은 flex 한 줄이고 꺾임을 막는 것이 없다: 버튼(전역 규칙 `button { white-space:nowrap }`, `src/index.css:80-82`)과 배지(:79)는 줄바꿈이 없어, 자리가 모자라면 **'오브젝트'가 글자마다 꺾인다**(한글은 글자 사이에서 꺾인다). 제목의 세 줄(버튼, `strong`, 배지)이 그것을 뒤집는다: '오브젝트'와 버튼은 줄어들지 않고(버튼의 `nowrap`은 전역 규칙에 기대지 않게 한 번 더 적는다), 배지가 줄어든다. 배지는 flex 상자(`inline-flex`, :79)라 그대로는 말줄임표가 생기지 않아 이 제목 안에서만 `display:block`으로 바꾼다 — 높이는 같은 한 줄이다(숨긴 것이 없을 때의 제목 줄 높이를 G1에서 지금 값과 견준다).
- 숨긴 줄의 `opacity:.7`, 그 줄에서 종류 글자의 `opacity:1`(버튼의 .7과 곱해져 .7이 된다 — 기존 `.bmap-node-type`의 .75(:215)를 그 줄에서만 덮는다), 칩의 본문색은 4.2·4.3의 대비 숫자가 까닭이다. 숨긴 이름에 **키보드 포커스가 오면** 불투명도를 1로 돌린다: 포커스 테두리(라이브러리의 `.bg-library button:focus-visible`, 목록 안에서 `outline-offset:-2px`)는 그 버튼 안에 그려져 함께 .7로 흐려진다 — 바이올렛에서 어두운 화면 3.8:1 → 2.5:1, 밝은 화면 4.5:1 → 2.7:1(최종 검토). 숨긴 것은 옆의 눈(감은 눈)과 이름의 ', 숨김'이 그대로 말한다. 마우스로 숨긴 이름을 누르면 그 노드가 다시 보이므로 마우스에는 상관이 없다.
- '모두 보이기'의 `::after`는 절대 위치라 버튼 안의 flex 배치에 끼지 않고(버튼의 `position:relative`가 기준이다) 제목 줄의 높이도 바꾸지 않는다. 위아래로 5px 나가도 첫 줄에 닿지 않는다(제목 줄 아래 여백이 8px이다, :200).
- 목록 아래의 안내 글은 기존 `.bmap-objects>.bmap-hint`(:201)가 아래 여백을 0으로 한다 — 새 줄은 위 여백만 준다. 선택자의 `+`가 목록 **다음**의 글만 잡으므로 '아직 배치된 것이 없어요.'는 지금 그대로다.
- 닻의 계산: 평면에서 항목은 안내 글·닻·확대 버튼들이다. 닻의 바깥 크기는 0 − 10 = −10px이고 틈이 하나 늘어(+10px) 합이 0이다. 닻의 상자는 확대 버튼들의 왼쪽 끝에 놓이고 칩은 거기서 10px 떨어진다. 3D에서는 닻이 마지막 항목이라 바닥줄 안쪽 끝에서 10px 밖(안여백 12px 안)에 놓이고, 칩의 오른쪽 끝이 안쪽 끝과 맞는다.
- 칩의 폭은 글자의 폭이다: 폭 0인 닻 안에서 절대 위치의 상자는 가장 좁은 폭으로 줄어들므로 **`white-space:nowrap`이 있어야** 한 줄로 선다(없으면 글자마다 꺾인다).
- 닻은 `<div>`다 — `.bmap-canvas-footer>span`의 폭 제한(:218)이 걸리지 않는다.

### 6.4 파일 계획

| 새 파일 | 책임 |
|---|---|
| `mapViewPrefs.ts` | 3절 |
| `tests/backgroundMapViewPrefs.test.ts` | 저장소, 숨기기의 선택 규칙, 평면의 네 질문(7.1) |

| 바뀌는 파일 | 내용 |
|---|---|
| `BackgroundMapEditor.tsx` | 6.2 |
| `BackgroundLibraryView.tsx` | 편집기 태그에 `viewerId={user?.id ?? ''}` 한 줄(앵커 46은 태그의 앞머리만 본다) |
| `BackgroundMapPlanPreview.tsx` · `mapCanvas.ts` | 4.4 · 6.1 |
| `mapStack.ts` | `spaceHoldsNode`·`nodesHeldBy`(5.1) |
| `map3dScene.ts` · `BackgroundMap3D.tsx` | 5.1·5.2 · 5.2·5.4 |
| `backgrounds-map.css` | 6.3 |
| `tests/backgroundMapEditorWiring.test.ts` · `backgroundMap3dScene.test.ts` · `backgroundMapStack.test.ts` | 6.5 · 7절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 9절 |

| 건드리지 않는 파일 | 이유 |
|---|---|
| `src/features/playground/featureFlag.ts` | 노출 범위 |
| `electron/**`, `previewGateway.ts`, `src/mocks/**`, `useBackgroundStore.ts`, `DEVLOG/migrations/**` | IPC·메인·미리보기 저장소·DB 변경 없음. 미리보기도 같은 화면 코드라 똑같이 돈다(열쇠가 미리보기 저장소의 `bflow-background-library-preview-v1`과 겹치지 않는다) |
| `types.ts`, `domain.ts`, `mapWorkflow.ts` | 저장 계약. 새 키가 없다 |
| `mapDocument.ts`, `useBackgroundMapDocument.ts`, `mapEditSession.ts`, `mapEditStatus.ts` | 문서 상태. 보기 설정은 문서가 아니다 |
| `mapPlanSelect.ts`, `mapPlanGesture.ts`, `mapSnap.ts`, `mapPlanPreview.ts`, `mapPlanEdit.ts`, `mapGeometry.ts`, `mapSpatial.ts`, `mapGallery.ts` | ①~③의 순수 모듈. 걸러 본 도면을 인자로 받을 뿐이다 |
| `BackgroundMapCameraGizmo.ts`, `BackgroundMapPlanOverlays.tsx`, `BackgroundMapNameBox.tsx`, `BackgroundMapSelectionSummary.tsx`, `BackgroundMapEditStrip.tsx`, `BackgroundMapGallery.tsx`, `BackgroundMapPanels.tsx`, `backgrounds.css`, `backgrounds-map-3d.css`, `backgrounds-map-plan.css` | 그대로 |
| 1차의 새 파일(숫자 칸·끌기 훅·옆 그림·도면 삭제) | 닿지 않는다 |

**모듈 의존(한 방향)**: `mapViewPrefs.ts → mapSpatial.ts`(`isRoadSpace`)·`mapDocument.ts`(`singleViewId`와 타입 — 둘 다 three도 DOM도 없는 모듈이다) + 타입(`types.ts`). `mapStack.ts → mapGeometry.ts`·`mapSpatial.ts`(지금 그대로, 이름 셋을 더 가져온다). `map3dScene.ts → mapStack.ts`(이미 import하는 줄에 이름 둘). `BackgroundMap3D.tsx → map3dScene`(이름 하나). `BackgroundMapPlanPreview.tsx → mapViewPrefs`(`shownMap`). 편집기 → `mapViewPrefs`. **3D 파일 셋은 `mapViewPrefs`를 import하지 않고 `shownMap`이라는 글자가 없다.**

### 6.5 앵커

**일부러 다시 쓰는 기존 앵커**(같은 커밋에서):

| # | 바뀌는 것 |
|---|---|
| 21 | `placeSymbol`의 한 줄만: `assert.match(handler.placeSymbol(), /spacesAt\(shownMap\(base, hiddenIds\), point\)\[0\]/);`(주석: 새 기호는 그 자리에서 **보이는** 맨 위 공간에 속한다). 그 앵커의 나머지 — `stackedSpaces(…).map(` 둘, `spaceStackRanks(map)`, `reverse().find(` 없음 — 는 그대로 통과한다 |
| 23 | `count(editor, /\bdoc\.selectMany\(/g)` 3 → **4**(주석: 상자, Shift+클릭, 묶음 지우기, 숨기기). 나머지 줄 — 두 태그의 앞머리, `pick-one` 없음, `doc.dispatch(` 하나 — 은 그대로 통과한다 |
| 25 | `resolvePlanPress` 줄의 정규식에서 `planPileAt\(live, hit\.id,` → `planPileAt\(shownMap\(live, hiddenIds\), hit\.id,` |
| 27 | 상자를 놓는 줄의 글자 → `'doc.selectMany(session.mapId, planMarqueeIds(shownMap(live, hiddenIds), planRect(session.start, point)));'` |
| 36 | 목록 태그의 정규식 → 4.5의 태그(`hiddenIds={hiddenIds} hiddenCount={hiddenCount} onSelect={selectFromList} onToggleHidden={toggleHidden} onShowAll={showAll}`) |
| 52 | `count(editor, /\bswallowSecondClick\b/g)`(`tests/backgroundMapEditorWiring.test.ts:1044`) — 1차가 4로 만든 수(함수, `endEditing`, `openMapDelete`, `runMapDelete`의 `catch`)가 **5**(+ 숨기기). 창 조각과 나머지 식은 그대로 통과한다 |
| 59 | 1차가 넷으로 늘린 이름 목록에 `'backgroundMapViewPrefs.test.ts'`를 더한다(다섯). 그 파일도 `^test(`가 셋 이상이고, 첫 줄이 `import test from 'node:test';`이며, `skip`·`todo`라는 낱말이 없어야 한다 |
| 64 (1차의 것) | 2차가 바꾸는 보조 평면도의 세 줄을 글자 그대로 찾는 단언 셋(`tests/backgroundMapEditorWiring.test.ts:2066`, :2069, :2084)만 — 셋 다 4단계의 커밋에서: 편집기의 태그 → `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} hiddenIds={hiddenIds} />`, 보조 평면도의 함수 머리 → `export function BackgroundMapPlanPreview({ map, selectedId, onSelect, canEdit, scrub, hiddenIds }: MapPlanPreviewProps) {`(:2069는 네 글자를 도는 목록의 첫째다 — 나머지 셋은 그대로), `mapCanvas.ts`의 계약 → `export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' \| 'selectedId' \| 'canEdit' \| 'onSelect'> & { scrub: MapFieldScrub; hiddenIds?: ReadonlySet<string> };`. 하나라도 고치지 않으면 4단계의 `test:background`가 떨어진다. 그 앵커의 나머지(옆 그림의 손잡이와 그 CSS, `<CameraReadout key={selected.id} `와 그 둘레의 두 줄, `memo` 셋, 보조 평면도에 끌기 코드가 없는 것)는 그대로 통과한다 |

**고치지 않고 통과해야 하는 것**: 1~20, 22, 24, 26, 28~35, 37~49, 51, 54, 55, 57, 58과 1차가 다시 쓴 50·53·56, 1차의 새 앵커 60~63·65·66. 특히 3(미리보기는 `session.initial`), 5(누름과 놓음의 `select(` 수), 26(`placeSymbol(point, live)` 하나), 31·35(3D의 `pick`·`this.turn = null` 여덟), 34·39(보조 평면도의 리스너와 `nextPlanSelection(now.map, …)`), 41(`isRoadSpace(node)` 셋, `stackedSpaces(` 하나), 44(`floor.renderOrder = road ? -1.5 : -1;`), 45(`data-camera-color=` 둘·다섯, 카메라의 `shapeKey` 줄), 49(`pickMapFloor`·`mapFloorPile`에 도로 규칙 없음), 60(`<NumberField ` 태그 열넷 — 박스 구역에 숫자 칸을 넣지 않는다), 65(`dialogOpen` 다섯 번 — 이 차례는 창을 더하지 않는다).

**새 앵커 — R2-1~R2-6 = 67~72.** 1차가 60~66을 쓴다(1차 설계 6.2). 1차가 다른 번호로 끝났으면 그 다음의 빈 번호를 차례로 쓴다.

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| R2-1 | **거르는 것은 그리기와 가리키기뿐이고, 쓰는 곳은 전체 도면을 받는다.** 편집기에 `shownMap(`이 정확히 넷이고 각각 4.4의 네 줄 안이다(`pointerDown`·`pointerMove`·`pointerUp`의 상자 가지·`placeSymbol`). `pointerDown` 조각에 `const live = mapDraft(doc.getState(), current.id)?.value ?? current;`(그 `live`가 어떻게 만들어지는지 — :837의 글자 그대로)와 `initial: live,`, `pointerMove` 조각에 `previewPlanGesture(gesture, session.initial, session.start, point, snap)`, `placeSymbol` 조각에 `const containingSpace = spacesAt(shownMap(base, hiddenIds), point)[0];`와 `updateMap({ ...base, nodes: [...base.nodes, symbol] });`(그 조각에 `shownMap(`은 하나). 공간 조각(앵커 41의 표지)의 첫 문장이 `if (hiddenIds.has(node.id)) return null;`이고 그 뒤에 `const isSelected = shownIds.has(node.id)`. 기호·카메라의 두 `filter` 줄이 4.4의 글자다. **편집기에 `hiddenIds.has(`가 정확히 여섯**(목록의 줄, `toggleHidden`, `selectFromList`, 공간을 그리는 줄, 두 `filter`)이고, `pointerDown`·`pointerMove`·`pointerUp`·`placeSymbol` 조각마다 `hiddenIds`라는 글자가 **정확히 하나**다(그 `shownMap(` 안의 것). 두 3D 태그가 `map={current}`로 시작하고, `<Map3D>` 태그는 `onUnavailable={leave3D} hiddenIds={hiddenIds} solidIds={roomsOpen ? NO_MAP_VIEW_PREFS.solid : solidIds} />`로 끝난다(보조 평면도 태그의 끝은 앵커 64). 보조 평면도 파일에 `shownMap(`이 하나(`const pointed = useMemo(() => shownMap(map, hiddenIds), [map, hiddenIds]);`), `latest.current = { map: pointed, selectedId, onSelect, scale };`, `planViewBox(map, size)`, 세 그리는 줄의 `!hiddenIds?.has(node.id) &&`. `BackgroundMap3D.tsx`·`map3dScene.ts`·`BackgroundMapCameraGizmo.ts`에 `shownMap`·`mapViewPrefs`가 없다 | 세션의 `initial`에 걸러 본 도면(**다음 끌기에서 숨긴 노드가 도면에서 지워진다**) / 같은 일을 다른 글자로 — `live`를 만드는 줄에서 거르거나(`shownMap(`의 수를 맞춰 다른 자리의 것을 빼고), `hiddenIds`로 직접 `filter`함(그 조각의 `hiddenIds`가 둘이 된다) / `previewPlanGesture`에 걸러 본 도면(같다) / `<Map3D map={shownMap(current, hiddenIds)}`(기즈모가 숨긴 노드를 지운다) / 더미를 전체 도면에서(숨긴 공간으로 넘어가 **숨긴 것이 선택된다**) / 상자를 전체 도면에서(같다) / 스냅 후보를 전체에서(보이지 않는 것에 붙는다) / 새 기호의 공간을 전체 도면에서(`spacesAt(base, point)[0]` — **숨긴 위층에 속한 채 그 높이로 저장된다**) / 새 기호를 걸러 본 도면에 더해 적음(`{ ...shownMap(base, hiddenIds), nodes: … }` — 숨긴 노드가 지워진다) / 세 그리는 줄 가운데 하나의 건너뜀을 뺌 / `<Map3D>`에서 `solidIds`를 빼거나 `hiddenIds`와 맞바꿈 / 그 태그에서 `roomsOpen ? NO_MAP_VIEW_PREFS.solid :`를 뺌(기호 도구를 들어도 박스가 닫힌 채다) / 보조 평면도의 보기 상자를 걸러 본 도면으로(눈을 누를 때마다 그림이 뛴다) / 보조 평면도의 클릭을 전체 도면에서 |
| R2-2 | **숨긴 것은 선택되지 않고, 보기 설정은 도면을 쓰지 않는다.** 조각(6.2의 표지)의 줄이 4.5의 코드와 한 줄씩 같다(`block`으로 `setNodesHidden`을 잘라 줄 목록을 견준다 — 앵커 53·56의 방식). 그 조각에 `updateMap(`·`doc.update(`·`doc.previewGesture(`·`patchNode(`·`doc.beginGesture(`가 없다. `storeMapViewPrefs(`가 편집기에 정확히 둘이고 **둘 다 이 조각 안**이다(effect에서 적지 않는다). `readMapViewPrefs(viewerId)`가 하나(상태의 처음 값)이고 `setViewPrefs(`가 정확히 둘이다. 편집기에 `const { hidden: hiddenIds, solid: solidIds } = mapViewPrefsOf(viewPrefs, current?.id);`가 글자 그대로 **정확히 하나**이고 `mapViewPrefsOf(`가 그 하나뿐이다. `selectionWithout(`의 호출이 4.5의 글자다(다섯 인자 — 도면, 그 순간의 선택, `mapViewport(doc.getState(), current.id).selectedId`, `ids`, `mode === 'plan'`) | 가드 줄을 뺌(끌기 도중 눈이 듣는다) / `doc.selectMany` 줄을 뺌(**숨긴 것이 선택된 채 남는다**) / `select(left.inHand)` 줄을 뺌(3D에서 묶음 밖의 것을 숨겨도 손에 남는다 — 폼·Delete·카메라 시점이 숨긴 것에 닿는다) / 그 줄의 `left.ids.length > 1`을 뺌(묶음이 하나 남았을 때 그 하나까지 풀린다) / `mode === '3d' &&`를 뺌(평면에서 묶음이 통째로 풀린다) / `selectFromList`가 보이기 전에 고름·거절돼도 고름 / `if (left.moved) swallowSecondClick();`을 빼거나 조건 없이 부름(고른 묶음의 눈을 잇달아 누르면 둘째부터 먹지 않는다) / 눈을 켤 때도 선택을 고침(`if (!hidden) return true;`를 뺌) / 렌더마다 저장소에 적음 / 설정을 `currentId`로 읽음(`mapViewPrefsOf(viewPrefs, currentId)` — 처음 열린 도면은 `currentId`가 `null`이라(:253) **새로 고친 뒤 첫 도면의 숨김과 박스가 풀려 보인다**) / 적어 둔 고름 대신 손에 든 것만 넘김(V-12의 "다시 늘어난 묶음"이 순수 테스트에서 떨어진다 — 앵커는 호출의 글자를 본다) |
| R2-3 | **목록의 줄과 제목.** `ObjectList` 조각에 `<button`이 정확히 셋(제목, 이름, 눈). 눈의 태그가 4.2의 글자다(`className="bmap-node-eye"` 하나, 이름은 `` `${name} ${hidden ? '다시 보이기' : '숨기기'}` ``, `onClick={() => onToggleHidden(node.id)}`, 그 안의 그림이 `{hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}` — 속성만이 아니라 **어느 아이콘이 어느 쪽인지**까지). 눈이 이름 버튼의 **뒤 형제**다(`</button>` 다음에 눈의 `<button`, 그 `</button>` 다음이 `</li>`). `<li key={node.id} className={hidden ? 'is-hidden' : undefined}>`. 제목 줄이 4.2의 글자(``<span className="bmap-badge">{hiddenCount > 0 ? `숨김 ${hiddenCount} · ` : ''}{ordered.length}개</span>`` — 숨긴 수가 **앞**이다, `title={HIDDEN_NOTE} onClick={onShowAll}>모두 보이기</button>`). 목록 아래의 글이 `</ul><p className="bmap-hint">{HIDDEN_NOTE}</p></>`로 글자 그대로 있다(`hiddenCount`에 달지 않는다). 읽어 주는 줄(``<span className="sr-only" role="status">{hiddenCount > 0 ? `숨긴 것 ${hiddenCount}개` : '숨긴 것이 없어요'}</span>``)과 이름 버튼의 `${hidden ? ', 숨김' : ''}`, 눈의 `title={hidden ? '다시 보이기' : '숨기기 · 이 PC에서만 안 보여요'}`가 글자 그대로 있다. **목록은 숨긴 수를 세지 않는다**: 그 조각에 `hiddenCount`는 인자로 들어오고 `.filter(node => hiddenIds.has(` 같은 셈이 없다(`hiddenIds.has(node.id)`는 줄을 그리는 한 번뿐이다). **세는 곳은 편집기의 한 줄이다**: `const hiddenCount = useMemo(() => hiddenNodeCount(settledCurrent, hiddenIds), [settledCurrent, hiddenIds]);`가 글자 그대로 하나이고 편집기에 `hiddenIds.size`라는 글자가 없다. 편집기에 `const HIDDEN_NOTE = '숨긴 것은 이 PC의 내 화면에서만 안 보여요. 도면에는 그대로 있어서, 저장해도 지워지지 않아요.';`가 하나이고 `HIDDEN_NOTE`가 그 밖에 정확히 세 번 쓰인다(제목의 버튼, 목록 아래의 글, 칩 — R2-5). 박스 구역의 안내 글에 있는 `도면에는 저장되지 않아요`가 편집기에 한 번뿐인지는 R2-6이 센다(6단계 — 그 구역이 생기기 전인 3단계에는 그 수가 0이라, 여기 두면 3단계의 게이트에서 떨어진다). 그 조각에 `onSelect(node.id)`가 정확히 하나이고(눈은 고르지 않는다) `aria-pressed`가 없다. 태그는 앵커 36 | 눈을 이름 버튼 안에 넣음 / 눈이 `onSelect`를 부름 / 숨김 표시를 이름 버튼의 클래스로(앵커 36이 먼저 잡는다) / 눈의 이름을 상태로 고정('숨기기'만) / 눈의 두 아이콘을 맞바꿈(숨긴 줄에 뜬 눈이 그려진다) / 제목의 수에서 숨김을 빼거나 뒤로 보냄(좁은 속성 칸에서 숨긴 수부터 잘린다) / 목록이, 또는 **편집기가** `hiddenIds.size`로 셈(없어진 노드의 id까지 센다 — 죽은 id는 치우지 않으므로 수와 칩이 틀린다) / 읽어 주는 줄을 뺌 / 이름 버튼의 ', 숨김'을 뺌 / 목록 아래의 글을 빼거나 숨긴 것이 있을 때만 그림(눈을 누를 때 목록이 움직인다) / `HIDDEN_NOTE`를 "도면에는 저장되지 않아요"로 되돌림("숨긴 것은 저장되지 않는다"로 읽힌다) / "이 PC에서만"을 말하는 `title`을 뺌 |
| R2-4 | **3D — 숨김과 박스.** 장면: `sync` 안에 5.1의 줄들이 글자 그대로 — `this.last = { map, selectedId, options: { holdId, hiddenId, hiddenIds, solidIds } };`, `boxes` 줄 전체, `const held = nodesHeldBy(map, boxes.filter(space => !hiddenIds.has(space.id)));`, `solid = boxIds.has(node.id)`, `entry.solid !== solid`, `const visible = entry.valid && node.id !== hiddenId && !hiddenIds.has(node.id) && (selected \|\| !held.has(node.id));`. `boxes`·`held`의 줄이 `for (const node of map.nodes) {`보다 **앞**이다. `map3dScene.ts`에 `.label.visible`·`label.visible =`이 없다(이름표는 뿌리를 따라 꺼진다). `map3dScene.ts`에 `const NO_IDS: ReadonlySet<string> = new Set();`가 하나 있다. `mapStack.ts`에 `spaceHoldsNode`·`nodesHeldBy`가 5.1의 글자로 있다(`nodePlanOutline(node).every(`, `level + height <= top + HOLD_SLACK`, 카메라의 줄 `if (node.type === 'camera') return AROUND.some(([dx, dy]) => containsPoint(space, { x: node.x + dx * HOLD_SLACK, y: node.y + dy * HOLD_SLACK }));`, 여덟 쌍의 `AROUND` 줄, `boxes.includes(node) && at(node.id) < at(box.id) && spaceHoldsNode(node, box)`). 그 함수에 `containsPoint(space, node)`와 `level < top`이 없다. `buildSpace` 조각에 `const shell = solid && !road ?`, `lid.position.y = height; lid.name = 'space-lid';`, `new Mesh(floor.geometry, shell)`, `shell ? 'shell' : mesh === floor ? 'floor' : 'wall'`. `material`에 `closed(0.35)`·`closed(0.6)`와 `polygonOffset: true`. `shapeKey` 조각의 공간 줄 끝에 `${solid ? '\|solid' : ''}`. `visibleMapHits`가 `export function pickMapFloor(`보다 **앞**에 있고 `pickMapFloor`·`mapFloorPile` 조각에 `hits.filter(landsOnSpace)`가 하나씩. 뷰포트: `cast`의 끝이 `return visibleMapHits(`, `syncScene` 조각(`private syncScene(` → `private gizmoAllowed(`)에 `const hiddenIds = this.props.hiddenIds ?? NO_IDS, solidIds = this.props.solidIds ?? NO_IDS;`와 `shown.hiddenIds === hiddenIds && shown.solidIds === solidIds`가 있고 **`placing`이라는 글자가 없다**, `gizmoAllowed`에 `props.hiddenIds?.has(id)`. `mapCanvas.ts`의 세 필드(`Map3DProps`의 `hiddenIds`·`solidIds`, `MapPlanPreviewProps`의 `hiddenIds`)가 `?:`다 | 대부분은 장면·뷰포트·`mapStack` 테스트가 잡는다(7.2, 7.3). 앵커가 잡아야 하는 것: `visibleMapHits`를 `pickMapFloor` 뒤로 옮김(앵커 21·49의 조각이 그것을 삼킨다) / `cast`에서 뺌(박스 **뒤**의 것이 눌린다 — W-3도 잡는다) / `this.last`의 옵션에서 `hiddenIds`나 `solidIds`를 뺌(S-1·S-2도 잡는다) / `boxes`·`held`를 노드를 도는 루프 안에서 `entry`로 만듦(순서에 기댄다 — S-6도 잡는다) / 뷰포트가 `placing`으로 박스를 다시 바꿈(저장마다 박스가 닫혔다 열린다 — 5.4) / props를 필수로(`?`를 뺌 — **이 글자 검사가 유일한 지킴이다**: typecheck는 뷰포트 테스트를 읽지 않고(6.1), 대역은 props 없이 돌기만 한다) |
| R2-5 | **CSS와 칩.** 6.3의 열일곱 줄이 글자 그대로 있다(줄 맨 앞에서, 각각 하나). 그 줄들에 `transition`·`animation`·`font-style`·`backdrop-filter`가 없다. **새 클래스를 적은 줄은 그 줄들뿐이다** — 시트 전체에서(주석 줄과 미디어 블록 안까지) 그 이름이 든 줄의 수가 `bmap-node-eye` 4, `bmap-hidden-chip` 2, `bmap-hidden-slot` 1, `bmap-show-all` 2, `is-hidden` 3, `bmap-solid` 3이다(앵커 58이 `bmap-edit-start`를 세는 방식 — `tests/backgroundMapEditorWiring.test.ts:1408`. 6.3의 주석은 클래스 이름을 적지 않는다). `.bmap-hidden-slot {` 줄에 `flex:0 0 0`·`width:0`·`height:0`·`margin:0 -10px 0 auto`, `.bmap-canvas-footer {` 줄에 `gap:10px`(둘은 같은 숫자여야 한다). 숨긴 줄의 줄에 `opacity:.7`, 그 줄의 종류 글자 줄(`li.is-hidden .bmap-node-type`)에 `opacity:1`, 키보드 포커스가 온 숨긴 이름의 줄(`li.is-hidden>button:not(.bmap-node-eye):focus-visible`)에 `opacity:1`, 칩의 줄에 `color:rgb(var(--color-text-primary))`(`--color-accent-sub`가 아니다), 제목의 줄들에 `flex-shrink:0` 둘과 `text-overflow:ellipsis`, '모두 보이기'의 줄에 `position:relative`와 그 `::after` 줄에 `position:absolute`·`inset:-5px 0`, 목록 아래 글의 줄이 `.bmap-objects>.bmap-node-list+.bmap-hint { margin-top:8px; }`. 편집기에 4.3의 칩 태그가 글자 그대로 하나(`title={HIDDEN_NOTE} onClick={showAll}`), 그 자리가 `{footerHint}</span>`과 `{mode === 'plan' && <div className="bmap-zoom">` 사이다. 안내 글의 `title={mode === 'plan' \|\| hiddenCount > 0 ? footerHint : undefined}` | 닻의 `width:0`이나 음수 여백을 뺌(칩이 안내 글의 폭을 먹어 줄 수와 도면 높이가 달라진다) / 칩을 `position:absolute`가 아니게 / 칩을 평면 가지 안으로(3D에 없다) / 칩을 속성 칸 안으로(접으면 없다) / 줄의 `min-width:0`을 뺌(긴 이름이 눈을 밀어낸다) / 흐린 줄을 `font-style:italic`으로 / 숨긴 줄을 `.5`로(읽히지 않는다) / 종류 글자의 줄을 뺌(숨긴 줄에서 .525가 되어 2.4:1) / 뒤의 다른 규칙이 새 클래스를 다시 건드림(`@media(max-width:900px)` 안의 `.bmap-node-eye { display:none; }` 같은 것 — 열여섯 줄은 그대로인데 좁은 창에서 눈이 없다) / '모두 보이기'의 `::after`에서 `position:absolute`를 뺌(제목 줄이 높아진다) / 칩의 글자를 강조 보조색으로(밝은 화면에서 2.4:1) / 제목의 `flex-shrink:0`이나 배지의 말줄임을 뺌(좁은 속성 칸에서 제목이 두 줄이 되어 목록이 눈 밑에서 움직인다) / 3D 안내 글의 `title` 조건을 뺌 / 숨긴 이름의 포커스 줄을 뺌(키보드로 다시 찾은 숨긴 이름의 포커스 테두리가 이름과 함께 .7로 흐려져 3:1 아래가 된다 — 최종 검토) |
| R2-6 | **박스 스위치와 보기 설정의 자리.** 편집기에 5.5의 구역이 글자 그대로 하나: 조건이 `{mode === '3d' && selected.type === 'space' && !selectedRoad && <section className="bmap-solid"`이고 **그 자리가 '공간 종류' 구역의 바로 뒤다**: `ROAD_HINT_ROUND : ROAD_HINT_NO_STRIP}</p>}`와 `{selected.type === 'camera' && (() => {` 사이에 있고, 그 둘 사이의 글자는 (공백과, 구역의 주석이 지워져 남는 `{}`를 빼면) '공간 종류' 구역을 닫는 `</>}` 하나와 이 구역뿐이다(`editing &&` 안이 아니고, '공간 종류'의 선택 칸보다 위도 아니다). 그 구역에 ` disabled=`가 없다. 문구 — 체크 칸의 `속이 안 보이는 박스로 보기`, 안내 글 `이 PC에서 3D를 보는 방식만 바뀌어요. 도면에는 저장되지 않아요. 박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요.`, 두 버튼의 글 — 와 `setSpacesSolid(mapRoomIds(current), true)`·`setSpacesSolid([...solidIds], false)`, 안내 글 끝의 `{roomsOpen ? ' 기호를 놓는 동안에는 모든 공간이 비쳐 보여요.' : ''}`. 편집기에 `도면에는 저장되지 않아요`라는 글자는 한 번뿐이다(이 안내 글 — 주어가 '보는 방식'인 문장이다. R2-3에서 옮겨 왔다: 3단계에는 이 구역이 없다). 편집기에 `const roomsOpen = tool === 'symbol' && editing;`가 하나이고 `roomsOpen`이 그 밖에 정확히 두 번 쓰인다(그 문장, `<Map3D>` 태그 — R2-1). '도면 구성'의 한 줄 `{mode === '3d' && <p className="bmap-hint">공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.</p>}`가 `공간을 선택하면 내부 도면을 만들거나 연결할 수 있습니다.</p>` 바로 다음에 하나 있다. `mapViewPrefs.ts`에 `from 'three'`와 `document.`·`window.`가 없고 `MAP_VIEW_PREFS_KEY = 'bflow.background-map.view.v1'`이다. 그 저장소는 앱을 껐다 켜도 남는 이 PC의 것이다: `deviceStorage`가 `try { return localStorage; } catch { return null; }`이고, 그 파일에 `sessionStorage`라는 글자가 없으며, 읽기와 적기의 머리 둘 다 `storage: MapViewStorage | null = deviceStorage())`로 끝난다(V-5는 그 기본값에 닿지 못한다 — Node에는 그 저장소가 없고 V-5는 인자 없이 적지 않는다. 최종 검토). `types.ts`·`domain.ts`·`mapWorkflow.ts`·`mapDocument.ts`에 낱말 `hidden`·`solid`가 없다(`/\b(?:hidden\|solid)(?:Ids)?\b/`). `BackgroundLibraryView.tsx`에 `viewerId={user?.id ?? ''}`와 `key={user?.id \|\| "signed-out"}` | 구역을 `editing &&` 안으로(보기 모드에 없다) / 구역을 '공간 종류' 위로 올림(도로로 바꾸는 순간 방금 누른 선택 칸이 위로 뛴다) / `fieldLocked`·`disabled`로 끔 / 평면에서도 그림(J1을 뒤집을 때만) / 도로에도 그림 / 묶음 버튼이 도로까지 넣음 / '도면 구성'의 한 줄을 평면에서도 그림·뺌 / 기호를 놓는 동안의 문장을 뺌 / `roomsOpen`을 `canEdit`에 닮(기호 도구를 든 채 저장하면 박스가 닫혔다 열리고 그 문장이 사라졌다 돌아온다) / 박스 안의 것이 어디 있는지 말하는 두 문장을 빼거나 체크했을 때만 그림 / 새 문장의 '공간'을 '방'으로 / 열쇠에서 계정을 뺌 / 노드 타입에 `hidden` 키를 더함(저장이 통째로 거절된다) / 본문의 `key`를 뺌(계정이 바뀌어도 앞 계정의 설정을 든 채다) / 눈 쪽 글(눈의 `title`, 칩, 목록 아래 글)에 '도면에는 저장되지 않아요'를 더 씀(숨긴 것이 지워진다로 읽힌다) / 저장소를 세션 저장소로(앱을 껐다 켜면 숨김과 박스를 잊는다 — 새로 고침과 메뉴 이동은 견뎌 N6·B13이 못 잡는다) / 읽기나 적기의 기본 저장소를 뺌(아무것도 기억하지 못한다) |

앵커는 **뮤테이션으로 확인**한다(저장소 밖 임시 복사본에서 표의 변형을 하나씩 넣어 실패하는지 본다). **살아남기 쉬운 변형 — 반드시 넣어 본다**: (1) 세션의 `initial: shownMap(live, hiddenIds)`, (2) `<Map3D map={shownMap(current, hiddenIds)}`, (3) `setNodesHidden`에서 `doc.selectMany` 줄을 지움, (4) 같은 곳의 `left.ids.length > 1 &&`를 지움, (5) `selectFromList`를 `(id) => { setNodesHidden([id], false); select(id); }`로(거절돼도 고른다), (6) `cast`에서 `visibleMapHits`를 뺌(W-3 — 박스 뒤의 카메라가 눌린다), (7) `visibleMapHits`를 "배열에서 처음 만나는 닫힌 면까지"로(`hits.slice(0, 첫 'shell'의 자리 + 1)` — 걸쳐 겹친 같은 높이의 뚜껑에서 도면 순서가 고른다, S-4), (8) `landsOnSpace`에서 `'shell'`을 뺌(앞의 비치는 벽이 박스를 이긴다 — S-3), (9) `sync`의 `lens` 조건을 뺌(카메라 시점이 박스 속을 본다 — S-5), (10) `visible` 줄의 `selected ||`를 뺌(고른 것이 그려지지 않는다 — S-4·S-6), (11) `held`를 만들 때 `!hiddenIds.has(space.id)`를 뺌(숨긴 박스가 안의 것을 가린다 — S-6), (12) 편집기의 `<Map3D>` 태그에서 `roomsOpen ? NO_MAP_VIEW_PREFS.solid :`를 뺌(기호 도구를 들어도 박스가 닫힌 채다 — R2-1의 태그 글자), (13) `withIds`가 내용이 같아도 새 객체를 돌려줌(V-6), (14) `shownMap`이 늘 사본을 돌려줌(V-10 — R2가 깨진다), (15) 닻의 `margin:0 -10px 0 auto`를 `margin-left:auto`로, (16) `visible` 줄에서 `held`를 통째로 뺌(이름표만 끄던 첫 판 — 뚜껑 높이의 계단이 비치고 눌린다, S-4), (17) `spaceHoldsNode`를 가운데 점만 묻게(둘러싼 방의 이름이 사라진다 — K-1·S-6), (18) 꼭짓점을 당기지 않음(`HOLD_SLACK` — 다각형 박스의 모서리에 붙은 방이 품기지 않는다, K-1), (19) `nodesHeldBy`의 맞품기 가르기를 뺌(꼭 같은 두 박스가 둘 다 사라진다 — K-2·S-4), (20) `this.last`의 옵션에서 `hiddenIds`를 뺌(테마를 바꾸면 숨긴 것이 그려지고 눌린다 — S-2), (21) `withIds`가 적지 않는 쪽 목록을 비움(눈을 한 번 누르면 박스가 모두 풀리고 저장소에서도 지워진다 — V-6), (22) `withIds`가 바꿀 때마다 없어진 노드의 id를 추림(되살린 노드가 숨긴 채로 오는지가 그 사이의 다른 누름에 달린다 — V-7), (23) `mapViewPrefsOf`가 항목 없는 도면에 새 빈 값을 돌려줌(끌 때마다 목록과 3D가 깨어난다 — V-14), (24) 방을 숨길 때 그 방에 속한 것도 숨김(`shownMap`에서, 또는 장면의 `visible`에서 `spaceId`로 — ④를 뒤집는다: V-10·S-2·W-1), (25) `selectionWithout`의 `changed`에서 적어 둔 고름을 뺌(V-12의 "다시 늘어난 묶음"), (26) `moved`를 `changed`와 같게(고른 묶음의 눈이 0.5초씩 먹지 않는다 — V-12), (27) `placeSymbol`의 `shownMap(`을 뺌(R2-1 · V-13), (28) 카메라를 서 있는 점 그대로 물음(`containsPoint(space, node)` — 다각형 방의 오른쪽·아래쪽 벽 선 위에 선 카메라가 밖으로 읽혀, 그 시점 미리보기가 빈 방을 보인다: K-1·S-5), (29) `AROUND`를 대각선 넷으로 또는 가로세로 넷으로(45° 돌린 다각형 방의 모서리 / 돌리지 않은 다각형 방의 모서리 — K-1. 대각선 판은 방이 놓인 자리에 따라 잡히지 않는다 — K-1이 그 자리를 정해 둔다), (30) 카메라의 꼭대기를 밖으로(`level < top` — 뚜껑 높이에서 내려다보는 카메라의 미리보기가 빈 방이다: K-1·S-5), (31) `selectionWithout`의 3D 가지를 뺌(둘을 묶고 3D에서 다른 카메라의 시점을 보다가 묶음의 하나를 숨기면 손이 남은 하나로 넘어가고 미리보기가 끝난다 — V-12), (32) 한도에 찬 목록이 죽은 id를 버리지 않음(새 눈이 듣지 않는다 — V-4), (33) `roomsOpen`을 `tool === 'symbol' && canEdit`으로(R2-6의 그 줄 글자), (34) 눈의 두 아이콘을 맞바꿈(R2-3), (35) 편집기가 `hiddenIds.size`로 셈(R2-3). **(6)~(11)·(13)·(14)·(16)~(21)·(23)~(26)은 그 줄들이 바뀌기 전의 코드에, (6)·(9)·(10)·(13)·(16)~(19)·(21)·(22)·(25)·(26)·(28)~(32)는 지금 코드(3절·5.1·5.2·5.4)의 임시 사본에 넣어 보았고 모두 잡혔다**(12절). (12)·(33)~(35)는 편집기의 글자를 앵커가 읽는 변형이라 설계 때는 넣어 보지 못했다 — 7단계에서 넣는다.

---

## 7. 테스트

모두 `npm run test:background`(`node --test ./tests/background*.test.ts`)에 들어간다. 1차가 구현된 `56cbc744`에서 619개 — 614 통과, 5 건너뜀(PGlite를 지정하지 않은 DB 계약. 1차 앞의 `42584da6`은 582개였다). 2차의 기준 수는 0단계에서 머지된 main으로 다시 적는다. SQL이 바뀌지 않으므로 PGlite 실행은 필요 없다.

### 7.1 `tests/backgroundMapViewPrefs.test.ts` (새)

첫 줄은 `import test from 'node:test';`, `skip`·`todo`라는 낱말이 없다(앵커 59). 저장소는 `getItem`·`setItem`만 있는 메모리 객체를 넘긴다.

| # | 본다 |
|---|---|
| V-1 | 왕복: 숨김 둘·박스 하나를 적으면 열쇠가 `bflow.background-map.view.v1:u1` 하나이고 글자가 3절의 모양이며, 읽으면 같은 내용이다 |
| V-2 | 계정: `u1`에 적은 것이 `u2`로는 읽히지 않는다. 빈 계정 id로는 읽지도 적지도 않는다 |
| V-3 | 쓰레기: `null`, `''`, `'x'`, `'[]'`, `'{}'`, `'{"maps":{}}'`, `'{"maps":"a"}'`, `'null'`, `'3'`, 항목이 `1`·`null`·`"a"`·`{"id":3}`·`{"id":""}`·`{"id":"m"}`(목록 없음)·목록이 문자열이거나 문자열 아닌 것만 든 경우 → 모두 없음. 섞인 것: 쓸 수 있는 항목만 남고, 같은 도면이 두 번이면 뒤의 것이 뒤의 자리에. **두 목록은 따로 읽는다**: `{"id":"m","hidden":["a"],"solid":"x"}` → 숨김 [a]·박스 없음, `{"id":"n","hidden":7,"solid":["s"]}` → 숨김 없음·박스 [s](한쪽이 배열이 아니라고 항목을 통째로 버리지 않는다) |
| V-4 | 한도: 도면 130개 → 100개(처음 것이 서른한째), id 1500개 → 1000개, 65자 도면 id·노드 id는 버림. **찬 목록**: 1000개가 찬 숨김 목록(그 가운데 셋은 도면에서 없어진 노드)에 새 노드를 숨기면 죽은 셋이 빠지고 새것이 들어가 998개다. 차지 않은 목록에서는 죽은 id가 그대로 남는다. 산 노드 1000개로 찬 목록에 한 개 더는 들어가지 않고 받은 그 객체가 돌아온다 |
| V-5 | 저장소가 없음(`null`) · 던지는 저장소(`getItem`·`setItem`이 던진다) → 읽으면 없음, 적어도 던지지 않는다. 인자를 주지 않고 **읽기만** 한 번: 던지지 않는다(이 저장소의 Node 22에는 전역 `localStorage`가 없어 없음으로 읽힌다 — 그 수는 단언하지 않는다. 인자 없이 적는 호출은 테스트에 두지 않는다: 전역 저장소가 있는 Node에서는 그 저장소에 적힌다) |
| V-6 | 같은 객체: 이미 숨긴 것을 숨김 / 숨기지 않은 것을 보임 / 없는 노드를 숨김 / 기호를 박스로 → 받은 `prefs` 그 객체. **두 방향 모두**: 박스를 바꿔도 `hidden`은 같은 `Set` 객체이고 내용이 그대로, **눈을 눌러도 `solid`는 같은 `Set` 객체이고 내용이 그대로**다(숨김 → 박스 → 다시 눈의 차례로 적어도 박스가 남는다) |
| V-7 | **죽은 id는 남는다**: 노드 둘(`hidden`에 든 카메라, `solid`에 든 방)이 없어진 도면에서 — 없어진 노드는 세지 않고(`hiddenNodeCount` 0, `shownMap`은 받은 도면 그 객체) **다른 눈과 다른 박스를 켰다 꺼도 두 목록에 그 id가 그대로 있다.** 그 노드가 돌아온 도면에서는 다시 숨김(박스)으로 읽힌다(3절의 규칙). 헛일인 바꾸기(없는 노드를 숨김, 기호를 박스로)는 죽은 id가 있어도 받은 `prefs` 그 객체다(지나가며 치우지 않는다). 목록의 id를 모두 빼면('모두 보이기'·'모두 비치게'가 하는 일) 죽은 id까지 비고, 두 목록이 다 비면 그 도면의 항목이 없어진다 |
| V-8 | 새것이 뒤: 도면 105개를 차례로 → 100개, 처음이 여섯째. 그 여섯째를 다시 바꾸면 맨 뒤로 간다 |
| V-9 | 박스는 공간만: 기호·카메라·없는 id는 들어가지 않는다. 도로는 들어간다(`mapRoomIds`는 도로를 뺀다) |
| V-10 | `shownMap`: 빈 묶음·`undefined`·없어진 노드의 id뿐 → **받은 도면 그 객체**. 숨긴 것이 있으면 그 노드만 빠진 사본이고 원본의 노드 수·`id`·`revision`은 그대로. **방만 숨기면 그 방에 속한(`spaceId`) 의자와 카메라는 사본에 그대로 있다**(같은 노드 객체 — ④) |
| V-11 | `hiddenNodeCount`(없어진 id는 세지 않는다, 도면이 없으면 0), `mapRoomIds` |
| V-12 | **숨기기의 선택 규칙** — 편집기의 길을 그대로 옮긴 작은 함수(`selectionWithout` → `changed`면 `select-many` → 3D이고 둘 이상 남으면 누르기 전의 선택으로 만든 `pickAction`)를 실제 `createMapDocumentStore`에 돌린다. **경우마다 넷을 본다**: 남은 묶음 / 손에 든 것(`singleViewId`) / `changed` / `moved`. 그리고 모든 경우에 — 숨긴 id가 묶음에도, 손에도, **적어 둔 고름(`selectedId`)에도** 없고, `moved`가 "앞뒤의 문서 상태로 따로 계산한, 속성 칸에 보이는 것이 달라졌나"와 같다. 평면: 하나를 숨김 → 빔, `moved` / 묶음 [A,B,C]에서 B → [A,C], **`moved` 아님** / C(대표) → [A,B], 아님 / 묶음 밖의 D를 3D에서 손에 들었던 채 D → 묶음 그대로, 손에 든 것 C, `changed`이되 **`moved` 아님** / [A,B]에서 A → [B], `moved` / **[A,B]에 D를 3D에서 손에 들었던 채 평면에서 A → [B]**, 손에 든 것 B, `moved`(평면은 묶음을 지킨다 — 3D의 가지가 듣지 않는다) / 아무것도 안 골랐을 때·고르지 않은 것을 숨김 → `changed` 거짓, 묶음 배열이 같은 객체. 3D: 하나 → 빔, `moved` / [A,B,C]에서 손에 든 C → [A,B], 손에 든 것 없음, `moved` / 손에 든 A, B를 숨김 → [A,C], 손에 든 것 **A**, **`moved` 아님** / 묶음 밖의 D를 손에 들고 D → 묶음 그대로, 손에 든 것 **없음**, `moved` / D를 손에 들고 B → [A,C], 손에 든 것 D, 아님 / 손에 든 것이 없을 때 B → 없음 그대로, 아님 / [A,B]에서 손에 든 B → [A], 손에 든 것 A, `moved` / [A,B]에서 A를 손에 든 채 B → [A], 손에 든 것 A, **`moved`**(묶음 안내 줄이 없어진다) / **[A,B]에서 묶음 밖의 D를 손에 든 채 A → 선택 [D], 손에 든 것 D**(J13 — 손에 든 것이 남고 B가 풀린다. 적어 둔 고름도 D), `moved`(묶음 안내 줄이 없어진다). 대표 B를 숨겨도 같다 / [A,B]에서 D를 손에 든 채 **D 자신** → 묶음 그대로, 손에 든 것 없음, `moved` / [A,B]에서 아무것도 들지 않은 채 A → [B], 손에 든 것 B, `moved` / 한꺼번에 셋 → 빔 / [A,B,C]에서 D를 손에 든 채 한꺼번에 둘이나 셋 → [D]. **다시 늘어나는 묶음**: [A,B]에 D를 3D에서 들었다가 B가 도면에서 없어진 사이(묶음은 [A]로 읽히고 `selectedId`는 D로 남아 있다) D를 숨김 → 화면은 그대로(`moved` 아님)인데 `changed`이고, 적은 뒤 B가 돌아온 도면에서 **손에 든 것이 D가 아니다**(고치기 전의 물음 — 손에 든 것만 — 으로는 D가 다시 손에 들린다는 것도 같은 테스트가 보인다) |
| V-13 | **평면의 네 질문과 "쓰는 곳은 전체"**: 한 윤곽의 두 층(아래층 바닥 0, 위층 바닥 180 — 도면에서 뒤) — 전체 도면에서는 그 자리의 맨 위가 위층(180)이고, **위층을 숨긴 걸러 본 도면에서는 아래층(0)**이다. 큰 방 위의 작은 방을 숨기면 큰 방, 그 자리의 공간을 모두 숨기면 없음(땅). 묻는 데 쓴 도면이 무엇이든 원본의 노드 수는 그대로다 / 큰 방 안의 방 안의 작은 방 — 가운데 방을 숨기면 더미가 [작은 방, 큰 방]이고 `resolvePlanPress`의 넘기기가 그 둘이다 / 겹친 카메라 셋에서 가운데를 숨기면 차례가 둘 / 상자가 닿은 둘 가운데 숨긴 것은 빠진다 / 스냅 후보: 숨긴 기호의 선 여섯(축마다 셋)이 빠진다 / **그 후보로 스냅한 `previewPlanGesture(gesture, 전체 도면, …)`의 결과에 숨긴 노드가 그대로 있고 `validateBackgroundEntity('map', …)`를 지난다** / 숨긴 구성원이 공간을 따라 움직인다 / `nextPlanSelection`이 걸러 본 도면에서는 큰 방으로, 전체에서는 가운데 방으로 넘어간다 |
| V-14 | **하나뿐인 빈 값**: `mapViewPrefsOf(prefs, 모르는 도면 / null / undefined) === NO_MAP_VIEW_PREFS`, `NO_MAP_VIEW_PREFS.hidden === NO_MAP_VIEW_PREFS.solid`(빈 묶음). 두 도면이 저마다의 항목을 갖고, 같은 도면을 두 번 읽으면 같은 객체다 |

### 7.2 `tests/backgroundMapStack.test.ts`

| # | 본다 |
|---|---|
| K-1 | `spaceHoldsNode` — **카메라의 높이**(바닥 40·벽 100인 방): 바닥 높이(40) 안 / 139.9 안 / **140(꼭대기) 안** / 141 밖 / 39 밖 / 높이 없는 카메라(기본 120) 안 / 윤곽 밖 / 높이가 숫자가 아니면 밖 / 도로는 품지 않는다 / 자기 자신 아님. **벽 선 위의 카메라**(400×300 방, 상자의 왼쪽 위를 (0, 0)에): 사각형과 그것을 다각형으로 바꾼 것(`rectToPolygon`), 둘을 0°·17°·45°·90°·213° 돌린 것 **모두에서** 네 벽의 가운데와 네 모서리에 선 카메라가 품긴다(열 가지 방 × 여덟 자리 — 다각형 방의 오른쪽·아래쪽 벽과, 45° 돌린 다각형 방의 모서리가 그 가운데 있다. **방의 자리는 (0, 0)으로 정한다**: 45° 돌린 다각형 방의 모서리에서는 대각선 둘이 벽 위에 정확히 놓여 대각선 넷만의 답이 반올림에 달린다 — (0, 0)에서는 모서리 하나를 놓쳐 뮤테이션 (29)의 대각선 판이 잡히고, (300, 200)에서는 넷을 다 잡아 그 판이 살아남는다(12절)) / 벽에서 0.5 밖, 모서리에서 대각선으로 0.4 밖은 밖 / ㄱ자 방의 파인 두 벽과 그 안쪽 모서리 위는 안, 파인 곳 안쪽은 밖 / 둥근 방의 둘레 위는 안, 그 상자의 모서리는 밖 / 원점에서 99000 떨어진 방에서도 같다(벽 위 안, 0.01 밖은 밖). **공간·기호 — 온전히 안일 때만**(900×600 건물, 높이 기본): 한가운데의 200×200 방은 건물에 품기고 **건물은 그 방에 품기지 않는다** / 건물을 가로지르는 복도도 건물을 품지 않는다 / 모서리에 딱 붙은 같은 높이의 방은 품긴다 / 걸쳐 겹친 두 방은 서로 품지 않는다 / 벽을 0.5 넘은 방, 1 더 높은 방, 바닥이 1 낮은 방은 밖 / 높이가 같은 방은 안 / 바닥에 깔린 도로는 안 / **기본 높이의 계단은 안**(윗단이 뚜껑) / 벽을 가로지른 탁자는 가운데가 안이든 밖이든 밖 / 지붕 위의 것, 뚜껑을 뚫는 것은 밖 / 기울인 탁자는 드리운 윤곽으로(벽 쪽으로 기울면 밖, 안쪽으로 기울면 안) / 키가 숫자가 아니면 밖. **벽에 붙은 것과 박스의 모양**: 사각형 박스, 그것을 다각형으로 바꾼 박스(`rectToPolygon`), 둘을 17°·45°·90°·213° 돌린 것 모두에서 모서리에 붙은 방이 품긴다 / 둥근 박스는 가운데의 방만 품는다 / ㄱ자 박스의 파인 곳에 든 방은 밖 |
| K-2 | `nodesHeldBy` — 박스가 없으면 **하나뿐인 빈 묶음**(아무것도 품지 않는 박스도 그 묶음) / 한가운데 방만 박스: 그 안의 의자와, **그 벽 선 위에 선 카메라·뚜껑 높이에 선 카메라**만(둘러싼 건물, 벽에서 10 밖의 카메라, 뚜껑보다 20 높은 카메라는 아니다) / 건물·한가운데 방·모서리 방이 모두 박스: 건물만 빼고 안의 것 전부 / **윤곽과 높이가 같은 두 박스**: 도면의 순서를 두 가지로, `boxes`의 순서를 두 가지로 — 늘 도면에서 뒤의 것 하나만 품긴다 / 박스와 꼭 같은 자리의 비치는 방은 도면의 순서와 무관하게 품긴다 / 걸쳐 겹친 두 박스는 아무것도 품지 않는다 |

### 7.3 `tests/backgroundMap3dScene.test.ts`

기존 74개는 **고치지 않고** 통과한다. 고치는 것은 뷰포트 대역의 타입 한 줄뿐이다(그 파일의 :2006 — `EditorState`에 `& { hiddenIds?: ReadonlySet<string>; solidIds?: ReadonlySet<string> }`. 이 줄은 typecheck가 읽지 않는다 — 읽는 사람을 위한 것이고, 틀려도 테스트는 돈다). S는 장면만(`Map3DScene`과 실제 광선 — 그 파일의 `cast` 도우미에 `visibleMapHits`를 씌워 쓴다), W는 뷰포트 대역(`mountViewport`)으로 돈다.

| # | 본다 |
|---|---|
| S-1 | 닫힌 방: 뿌리가 그대로이고 자식이 `['space-floor','space-walls','space-lid','space-outline']`, 옆의 방은 셋 그대로, 도로는 `solidIds`에 있어도 그대로. 세 면이 **한 재질**이고 `transparent` 거짓·`opacity` 1·`depthWrite` 참·`side` 양면·`polygonOffset` 참(1, 1), 색이 `37336a`(어두운 기본 팔레트). 뚜껑의 지오메트리가 바닥의 그 객체이고 `position.y`가 180. 세 면의 `pickPart`가 `'shell'`, 바닥의 `renderOrder` −1. 고르면 `4b439a`와 100% 외곽선, 잠그면 점선. 끄면 자식 셋과 비치는 벽 재질. **팔레트를 바꿔도 박스가 남고 그 팔레트의 색이다**(밝은 팔레트 `ccc6f7`, 고르면 `a79df1`). `dispose` 뒤 자원 0 |
| S-2 | 숨김: **방만** `hiddenIds`로 → 방의 뿌리와 따라다니는 것이 안 보이고, **그 방에 속한(`spaceId`) 의자와 카메라는 보이며 의자 자리를 위에서 쏜 광선이 의자를 고른다**(④), 방의 빈 바닥 자리는 아무것도 고르지 않는다. 의자와 카메라를 숨기면 의자 자리가 방을 고른다. **둘을 숨긴 채 `setPalette`** → 두 뿌리가 여전히 안 보이고 `pickTargets()`에 없다. `hiddenId`(들여다보는 카메라)는 함께 써도 그대로 듣는다. 옵션 없이 다시 맞추면 모두 보인다 |
| S-3 | 누르기: 박스 앞에 비치는 방, 박스 안에 의자와 카메라, 박스 **뒤**에 카메라, 맨 앞에 의자, 박스 벽을 가로지른 탁자. 안의 둘은 뿌리가 안 보이고 `pickTargets()`에 없다. 뒤의 카메라와 걸친 탁자는 보인다. 정면 광선 — 자르지 않으면 **뒤의 카메라**가 골라지고, `visibleMapHits`를 지나면 마지막 것이 `'shell'`이며 **박스**가 골라진다. 위에서: 의자 자리는 박스(`pickMapFloor`도 박스, `mapSpacePile`은 `[박스]`). 맨 앞의 의자는 의자. 박스 옆은 앞의 방. 탁자의 박스 밖 부분은 탁자. 닫힌 면이 없는 광선은 **같은 배열**. 박스가 큰 방 위에 있을 때 `mapSpacePile`이 `[박스]`뿐이고 "같은 자리 다시"가 박스에 머문다(자르지 않으면 큰 방으로 넘어간다) |
| S-4 | **면과 한 평면인 것**: 기본 높이의 방 안에 기본 높이의 계단과, 모서리에 붙은 같은 높이의 방 — **도면에서 박스보다 앞에 둔다**. 비칠 때는 윗단을 내리쏜 광선이 계단을 고른다. 닫으면(처음 맞추는 그때) 둘의 뿌리가 안 보이고 `pickTargets()`에 없으며, 윗단 자리의 광선에 그 방의 것만 남아 방이 골라진다. (계단의 메시를 대상에 억지로 넣으면 `visibleMapHits`를 지나고도 계단이 골라진다 — 이 규칙이 막는 것이다.) 계단을 고르면 그것은 보이고 윗단 자리에서 골라진다. 안의 방까지 박스로 해도 안의 것은 안 보이고 **바깥 박스**가 골라진다. 걸쳐 겹친 같은 높이의 박스 둘(도면 순서 두 가지): 둘 다 보이고, 겹친 자리의 두 뚜껑이 남으며 작은 것이 골라진다. 윤곽이 같은 두 박스(순서 두 가지): 앞의 것만 보인다. 박스 위의 비치는 다락: 다락이 골라지고 더미가 `[다락, 박스]` |
| S-5 | 카메라 시점: 안에 선 카메라를 `hiddenId`로 → 그 방은 자식 셋, 다른 박스는 넷, **그 방이 품었던 의자가 보인다**. **네 벽 선 위, 모서리, 뚜껑 높이(180, 내려다보는 카메라)에 선 카메라도 같다 — 방이 사각형이든 그것을 다각형으로 바꾼 것이든**(아홉 자리 × 두 모양). 카메라가 윤곽에서 20 밖으로 나가거나 뚜껑보다 1 높이 서면 그 방도 넷이고 의자는 안 보인다. `hiddenId`가 없으면 넷이고, 고른 그 카메라는 보인다(품겼어도). 고르지 않으면 품긴 카메라(안·벽 위·뚜껑 높이)는 안 보이고 밖의 카메라는 보인다 |
| S-6 | **품긴 것과 둘러싼 것**(뿌리와 따라다니는 것의 `visible` — 이름표 대역이 필요 없다): 큰 홀, 그 한가운데의 방(박스), 그 방 안의 작은 방과 카메라, 홀의 다른 자리의 카메라, 뚜껑 위의 사물. **안의 카메라와 작은 방을 도면에서 박스보다 앞에 두고, 박스를 켠 첫 `sync` 바로 뒤에 본다**: 안의 둘은 거짓, **홀은 참**(이름도), 박스·밖의 카메라·뚜껑 위의 사물은 참. 안의 카메라를 고르면 참. 박스를 눈으로 숨기면 안의 것이 모두 참(박스만 거짓). 안에서 들여다보는 동안 작은 방이 참. **홀까지 모두 박스로**: 맨 바깥 홀만 참(뚜껑 위의 사물도 참), 안의 것은 모두 거짓. 박스를 끄면 모두 참. 노드의 순서를 뒤집은 도면에서도 같은 답 |
| W-1 | 뷰포트·숨김: 숨긴 의자와 카메라의 뿌리가 안 보이고, 의자 자리의 클릭이 방을, 카메라 자리의 클릭이 `null`을 고른다. 숨긴 것이 `selectedId`여도 기즈모가 없고, 보이면 붙는다. **방만 숨기면 그 방의 의자는 보이고 의자 자리의 클릭이 의자를 고른다** |
| W-2 | 뷰포트·다시 맞추기: 장면의 `sync`를 세어 — 같은 도면·같은 두 묶음으로 다시 그리면 0번, 새 묶음이면 1번, 같은 빈 묶음을 다시 주면 0번, **`placing`만 바뀌면 0번**(뷰포트는 그것으로 박스를 바꾸지 않는다 — 5.4). props가 아예 없으면 `placing`을 켰다 꺼도 처음 뒤로 0번 |
| W-3 | 뷰포트·박스: 박스 속 의자는 뿌리가 안 보이고, 그 화면 자리를 누르면 방. **박스 뒤에 선 카메라(보인다)의 화면 자리를 누르면 박스** — `cast`가 광선을 자른다(자르지 않으면 그 카메라가 골라진다). 더블클릭은 그 방의 상세 도면. `placing`만 켜면(묶음은 그대로) 넷 그대로다. **기호 도구를 든 때처럼 `placing`과 하나뿐인 빈 `solidIds`를 함께 주면** 자식이 셋이고 의자가 보이며 클릭이 그 방의 바닥 좌표를 알린다. **저장이 도는 때처럼 `placing`과 `canEdit`만 꺼졌다 켜져도**(빈 묶음은 그대로) 셋 그대로이고 `sync`가 더 돌지 않는다. 묶음을 되돌려 주면 넷 |
| W-4 | 뷰포트·카메라 시점: 안의 카메라로 들여다보면 그 방은 셋, 다른 박스는 넷. 돌아오면 넷 |
| W-5 | 뷰포트·기즈모: 박스를 끌어 옮기면 시작·끝이 한 번씩이고(미리보기는 한 번 이상) 끄는 동안과 뒤에 자식이 넷 그대로다. 방을 따라간 의자는 여전히 안 보인다. **박스가 품은 의자를 고르면 그려지고 기즈모가 그 뿌리에 붙으며, 고름을 풀면 다시 그려지지 않는다**(최종 검토 — 그것을 묻는 테스트가 없었다) |

### 7.4 통과 기준과 놓치기 쉬운 것

`npm run typecheck`, `npm run test:background`, CSS를 고친 단계부터 `npm run test:motion`(`src`의 모든 CSS를 읽는다), 마지막에 `npm run build:vite`. **typecheck는 `src`만 읽는다**(`tsconfig.json:23` — `tests/background*.test.ts`는 어느 설정에도 없다): 새 테스트 파일과 고친 테스트의 타입 오류는 typecheck에서 드러나지 않고, Node는 타입을 지우고 돌릴 뿐이다. 그 파일들은 **돌려서** 본다(단계마다 `node --test tests/<그 파일>`이 통과하고, 표의 경우가 빠짐없이 단언으로 있는지 눈으로 견준다). **앵커 59는 파일 시스템을 읽는다** — 새 파일을 `git add`하지 않아도 작업 폴더에서는 초록이다. PR 전에: `git status --porcelain -- src/features/backgrounds tests docs DEVLOG`에 `??` 줄이 없고, `git ls-files --error-unmatch src/features/backgrounds/mapViewPrefs.ts tests/backgroundMapViewPrefs.test.ts docs/superpowers/specs/2026-10-13-background-map-eye-solid-design.md`가 성공해야 한다.

---

## 8. 수동 검증 (앱 엔진: Electron 33)

방법은 다-1과 같다: `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130, `http://localhost:5190/?preview=1`), 미리보기 시험 계정(배한솔, id `1`) → 배경 → 도면. 화면에 띄우지 않은 창에 실제 마우스·키 입력을 넣고 화면 값과 캡처로 본다. 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고, 나머지 세 조합에서는 ★ 항목을 다시 본다. 폭을 따로 적은 줄(E1·E2의 1100, E3의 1280·910)은 그 폭에서도 본다. 저장 모양이 바뀌지 않으므로 미리보기 저장소를 다른 세션과 함께 써도 깨지지 않는다.

**검사 창의 사정과 읽는 법**

- **장면을 읽는 법**(`const d = window.__bflowMap3d`, 개발 빌드 — BackgroundMap3D.tsx:208-212): 뿌리들은 `d.scene.getObjectByName('map-nodes').children`, 따라다니는 것들은 `d.scene.getObjectByName('map-companions').children`이고 **두 목록은 같은 자리끼리 한 노드다**(함께 붙고 함께 떨어진다 — map3dScene.ts:292-308. id는 뿌리의 `userData.nodeId`에만 있다). 노드 `id`의 자리 `i`를 뿌리 쪽에서 찾아 읽는다 — 숨김·품김: `map-nodes.children[i].visible === false`이고 `map-companions.children[i].visible === false` / 박스: 뿌리의 `getObjectByName('space-lid')`와 그 `position.y`, `children.map(c => c.name)`, 면의 `userData.pickPart === 'shell'`, `getObjectByName('space-walls').material`의 `transparent`·`opacity`·`depthWrite`·`color.getHexString()` / 이름표: 따라다니는 것 안의 `isSprite`인 자식 / 기즈모가 붙었는가: `d.transform.object`가 그 노드의 뿌리다(없으면 `undefined` — BackgroundMapCameraGizmo.ts:257). 누를 자리는 `d.nodeScreenPoint(id)` — 뿌리의 자리(공간·기호는 바닥의 가운데, 카메라는 렌즈)다.
- **뿌리가 아닌 자리를 누르는 법**(뚜껑 높이의 윗단, 박스 옆의 바닥, 박스 밖으로 나온 탁자 — B3·E4): 평면의 (x, y)와 높이 h는 장면의 (x, h, y)다. `d.render()` 뒤에 `const v = d.camera.position.clone().set(x, h, y).project(d.camera), r = d.renderer.domElement.getBoundingClientRect();` → 화면의 점은 `[r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]`다(카메라 시점 미리보기 밖에서 — 미리보기는 캔버스의 일부만 쓴다).
- **보는 자리를 옮기는 법**(입력으로 돌리는 것은 믿을 수 없고, 둘러보기는 수평 아래로 내려가지 않는다 — `maxPolarAngle`, BackgroundMap3D.tsx:187): `d.orbit.target.set(…); d.camera.position.set(…); d.orbit.update(); d.render();`. 아래에서 올려다볼 때는 `orbit.update()` 없이 `d.camera.position.set(…); d.camera.lookAt(…); d.render();`.
- **가려졌는지를 읽는 법**: `d.render()`를 부른 **그 태스크 안에서**(그리기 버퍼는 남지 않는다) `const gl = d.renderer.getContext()`의 `gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 버퍼)` — `x`·`y`는 캔버스 안 좌표에 `d.renderer.getPixelRatio()`를 곱하고 `y`를 아래에서부터 센다. 박스 **뒤**에 선 노드의 `nodeScreenPoint` 자리와, 같은 면 위에서 12px 옆 자리의 색이 채널마다 3 안에서 같으면 가려진 것이다(이름표가 없는 사물로 본다 — 이름표는 뚫고 그려진다).
- **준비물을 놓는 법**: 방 안의 방 안의 방, 한 자리의 카메라 셋, 띄운 방, 기본 계단이 든 방 같은 것은 손으로 그리지 않는다 — `localStorage['bflow-background-library-preview-v1']`의 `snapshot.maps`에 도면을 적어 넣고 새로 고친다(읽을 때 저장 검증을 지나야 뜬다 — previewGateway.ts:35-36). 도면과 노드 id도 거기서 읽는다.
- 보기 설정: `localStorage.getItem('bflow.background-map.view.v1:1')`. 검사 창의 `localStorage`는 그 창만의 것이고 창을 새로 고쳐도 남는다.
- **속성 칸이 바뀌는 숨기기(고른 하나, 둘에서 하나로 주는 묶음) 뒤에는 0.6초 기다렸다가 다음 누름을 넣는다**(J10 — 그 사이의 마우스 누름과 Enter·Space로 누르는 버튼은 버려진다. `+`·Delete 같은 편집기의 단축키는 듣는다).
- 눈을 누른 뒤 포커스는 그 눈에 있다. Delete·Ctrl+Z·Ctrl+D 같은 편집기의 키는 **지금도 버튼 위에서는 듣지 않는다**(:1022 — 목록의 줄을 누른 뒤도 같다). 그 키를 볼 때는 **도면을 누르지 않고 스크립트로 포커스를 준다** — 평면은 `document.querySelector('.bmap-canvas').focus({ preventScroll: true })`, 3D는 `document.querySelector('.bmap-3d-main').focus({ preventScroll: true })`(편집기의 `focusCanvas()`가 하는 일이다, :476). **도면의 빈 곳을 누르면 선택이 바뀐다**: 평면에서는 선택이 풀리고, 3D에서는 손에 든 것이 놓이며(묶음이 있을 때 — 적어 둔 고름이 지워진다) 하나만 골랐을 때는 그 선택이 풀린다(BackgroundMap3D.tsx:561-569 → :470-472). 선택이 풀렸는지·남았는지를 보는 줄(S8·S10)이 그 누름 때문에 통과해 버린다. 되돌리기·다시 실행만 필요하면 도구 막대의 ↶·↷를 눌러도 된다(선택을 건드리지 않는다, :1160).
- 넣는 입력에는 포인터 캡처가 없다. 새 조작(눈, 칩, 체크 칸, 버튼)은 모두 한 번 누르기다. **끌기가 드는 줄은 P5·P6·P7·P10·N2·N5·B11·B14와 회귀 줄**이고, 그 방법은 ②·다-1·1차의 기록대로다(평면은 SVG에, 3D의 기즈모는 캔버스에 누름·움직임·놓음을 넣는다).
- 같은 자리를 "천천히" 누르는 줄(P3·P4·T3·B3)은 누름 사이를 0.6초 띄운다(그보다 빠르면 더블클릭으로 읽힌다).
- **테마를 그 자리에서 바꾸는 법**: 설정 화면에 다녀오면 편집기가 새로 뜬다(`src/App.tsx:3301`). 그 자리에서 보려면 `<html>`의 `data-color-mode`와 `--color-*` 변수들을 직접 바꾼다(뷰포트가 그 속성과 `style`을 지켜본다 — BackgroundMap3D.tsx:205-206. 값은 `src/themes.ts`의 것).
- 개발 빌드는 `StrictMode`다. 상태의 처음 값을 두 번 읽는다(쓰지 않는다). 한 번 눌렀는데 저장소에 두 번 적히는 것은 없다(핸들러에서 적는다).
- 창이 하나다. 계정 갈림은 N7처럼 열쇠로 본다.

**먼저 (엔진 동작 — 11.2의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 ★ | 목록의 줄을 본다: 속성 칸 260px(1440), 230px(창 폭 1100), 도면 아래로 내려간 배치(740). 이름이 긴 노드를 하나 둔다. 노드를 아홉 넘게 두어 목록과 속성 칸이 스크롤되게 한다 | 줄마다 한 줄이다: 이름 버튼 + 오른쪽 끝의 눈(28×32px). 긴 이름은 말줄임표로 줄고 눈은 줄바꿈되거나 밀려나지 않는다. 목록에 가로 스크롤이 없다. 줄 높이가 예전과 같다(32px). 눈이 **모든 줄에 늘 보인다**. 고른 줄의 보라 바탕은 이름 버튼에만 있다. **목록 바로 아래에 `HIDDEN_NOTE`가 글로 있다 — 숨긴 것이 없는 지금도**(위 여백 8px, 아래 여백 0). **속성 칸의 세로 스크롤 막대의 폭을 적는다**(`offsetWidth − clientWidth`에서 왼쪽 테두리 1px을 뺀 값 — 5px의 얇은 막대인지 넓은 기본 막대인지에 따라 제목 줄의 여유가 달라진다: 230px 속성 칸의 안쪽 폭이 201px에서 196px, 넓은 막대(17px)면 184px이 된다 — 4.2) |
| E2 ★ | **고르지 않은** 노드의 눈을 하나 끄기 **전과 뒤**에 잰다(`getBoundingClientRect`): 목록 제목 줄, 눌린 눈 버튼, 바닥줄, 도면(평면의 SVG / 3D의 캔버스). 평면과 3D, 그리고 마지막 하나를 다시 켤 때도. **창 폭 1100(속성 칸 230px)에서 한 번 더**: 노드 40개에 12개를 숨긴 도면('숨김 12 · 40개')과 노드 128개에 100개를 숨긴 도면('숨김 100 · 128개' — 둘 다 준비물로 적어 넣는다)으로, 속성 칸이 스크롤되는 채로. 속성 칸을 맨 아래까지 스크롤한 채로도 한 번(마지막 하나를 다시 켤 때) | **넷 모두 앞뒤가 같다**(위치와 크기). 제목에 '모두 보이기'와 '숨김 1 · N개', 바닥줄에 칩이 생긴다. 목록 아래의 글은 앞뒤가 같다(생기지도 사라지지도 않는다). 1100에서도 **제목이 한 줄**이다(높이가 숨긴 것이 없을 때와 같다) — 자리가 모자라면 수의 배지가 말줄임표로 줄고 '오브젝트'와 '모두 보이기'는 온전하다. **잘리는 것은 배지의 뒤쪽(전체 수)이고 '숨김 M'은 온전히 읽힌다**(배지의 `scrollWidth > clientWidth`일 때 보이는 글자를 캡처로 본다). 제목의 '모두 보이기'는 글자 위아래 5px 밖(버튼의 `getBoundingClientRect()`에서 위로 4px 벗어난 자리)을 눌러도 듣는다. 다르면 11.2 |
| E3 ★ | 칩의 자리: 평면(보기·편집), 3D, 속성 칸을 접은 때. 창 폭 1440·740에 더해 **1280(앱 사이드바를 펼친 때 — 칩이 평면 편집의 안내 글 끝을 몇 px만 덮어, 글자 하나가 말줄임표 없이 잘려 보이는 폭이다)**과 **910**(사이드바를 접은 때와 펼친 때 — 도면이 가장 좁은 폭이다) | 평면에서 확대 버튼들의 바로 왼쪽(10px), 3D에서 바닥줄의 오른쪽 끝. 세로 가운데. 1440에서 안내 글을 덮지 않는다. 1280·740·910에서 덮는 폭, 910에서 사이드바를 펼쳤을 때 칩의 왼쪽이 잘리는 폭을 적는다(11.4의 계산과 견준다). **1280과 740의 캡처로 칩 옆에서 반쯤 잘린 글자가 거슬리는지 본다 — 거슬리면 11.2의 고리.** **밝은 화면에서 칩의 글자가 읽힌다**(`getComputedStyle(칩).color`가 본문색이다). 칩과 제목의 '모두 보이기'의 `title`이 `HIDDEN_NOTE`, 눈의 `title`이 '숨기기 · 이 PC에서만 안 보여요'다. **칩이 있는 3D에서 안내 글에 `title`이 있고**(숨긴 것이 없는 3D에는 없다), 평면에는 지금처럼 늘 있다 |
| E4 ★ | 3D에서 방 하나를 박스로. 그 방에: 기본 계단(키 180 — 윗단이 뚜껑 높이), 모서리에 붙인 같은 높이의 안쪽 방, 바닥의 의자, 카메라. 방 **뒤**에 사물 하나와 **이름 있는 카메라 하나·이름 있는 공간 하나**, 벽을 가로지른 탁자 하나. 보는 자리를 옮겨(위의 법) 사방·위·낮은 곳에서 본다. 고른 때와 아닌 때, 어두운·밝은 화면 | 안의 넷은 뿌리와 따라다니는 것의 `visible`이 거짓이고 화면 어디에도 없다 — **뚜껑 위에 계단의 네모가, 벽에 안쪽 방의 선이 비치지 않는다**. 뒤의 사물은 `visible`이 참인데 그 자리의 픽셀이 옆 자리와 같다(가려졌다 — 위의 법). 걸친 탁자는 박스 밖 부분만 보인다. 돌리는 동안 선과 면이 깜빡이지 않는다. **어두운 화면**: 모서리의 선이 면 위에서 또렷하다(면끼리는 거의 한 색이다 — 설계대로). **밝은 화면**: 뚜껑과 벽이 서로 다른 밝기로 갈린다(선은 면에 묻힌다 — 설계대로). 두 화면 모두 고른 박스가 더 진하고, 땅·배경과 갈리며, 이름이 뚜껑 위에 뜬다. **눈으로만 보지 않는다**: 기본 화면(3D의 '맞춤')에서 뚜껑, 앞쪽(평면의 아래쪽) 벽, 오른쪽 벽의 한가운데와, 뒤로 돌아가 본 뒤쪽 벽의 한가운데에서 한 픽셀씩 읽어(위의 `readPixels`) 5.1의 표의 네 색과 견준다(채널마다 4 안 — 어두운 화면 `#3a366f`·`#353166`·`#322e62`·`#2d2a59`, 밝은 화면 `#d5cfff`·`#c5bfee`·`#bdb7e5`·`#aea9d3`). **박스 뒤의 카메라와 공간의 이름은 박스 위에 겹쳐 보인다**(설계대로 — 5.3. 그 본체의 자리는 가려져 있고, 이름 자리를 누르면 박스가 골라진다): 이 화면을 캡처해 머지 확인 때 한솔에게 보인다. 다르면 11.2 |
| E5 ★ | 숨긴 줄: 눈을 끄는 순간. 동작 줄이기를 켠 상태에서도 — 검사 창에는 개발 도구의 Rendering 패널이 없으므로 `<html>`에 `data-motion-minimal`을 달거나 CDP의 `Emulation.setEmulatedMedia`(`prefers-reduced-motion: reduce`)로 켠다 | 이름 버튼의 `getComputedStyle(…).opacity`가 200ms 뒤 `'0.7'`이다(동작 줄이기에서는 누른 직후에 이미 `'0.7'`). 기울지 않는다(`font-style: normal`). 눈 아이콘이 '눈 가림'으로 바뀌고(그 버튼 안의 `svg`가 `lucide-eye-off`다 — 뜬 눈은 `lucide-eye`) 눈 버튼의 `opacity`는 `'1'`이다. **그 줄의 종류 글자(`.bmap-node-type`)의 `opacity`가 `'1'`이다**(숨기지 않은 줄에서는 `'0.75'` 그대로). 이름과 종류 글자가 읽힌다(두 화면 모두) |
| E6 | **고르지 않은** 줄의 눈을 Tab으로 찾아 Enter, 이어서 Space. 다음에 고른 줄의 눈에서 Enter → **0.6초 뒤** Space | 켜고 꺼지며 **포커스가 그 눈에 남는다**. Tab 차례가 이름 → 눈 → 다음 줄이다. 고른 줄에서는 Enter로 숨겨진 뒤 0.5초 안의 Space는 듣지 않고(4.5), 0.6초 뒤의 Space는 다시 보이게 한다. 숨긴 줄의 눈에서 Shift+Tab으로 그 이름에 가면 이름이 흐리지 않고(불투명도 1) 포커스 테두리가 다른 줄과 같은 색이다(최종 검토) |
| E7 | **고른 노드의 눈을 더블클릭**(1440과 740). 다음에 셋을 묶어 고르고 그 가운데 **두 줄의 눈을 0.3초 간격으로** 누른다 | 한 번만 꺼진다(숨김 상태로 끝난다). 둘째 클릭이 다른 줄이나 '도면 구성'의 버튼을 누르지 않는다. 묶음에서는 **둘 다 꺼진다**(첫 누름 뒤 속성 칸이 '2개 선택'으로 그대로라 삼키지 않는다. 둘째 누름으로 하나가 남아 속성 칸이 바뀌면 그 뒤 0.5초를 쉰다) |

**눈 — 평면**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| P1 ★ | 공간·기호·카메라의 눈을 하나씩 끈다. 방에 속한 의자와 카메라가 있는 도면에서 **그 방만** 끈다 | SVG에서 그 `<g>`가 없어진다(`.bmap-space`·`.bmap-symbol`·`.bmap-camera`의 수가 하나씩 준다). 이름 글자도 없다. 줄은 제자리에 흐리게 남는다. **방을 숨겨도 그 방에 속한 기호·카메라는 그대로 그려지고 눌린다**(④ — 그 `<g>`들이 남아 있고, 누르면 골라진다) |
| P2 | 숨긴 공간이 있던 자리를 누른다(밑에 다른 공간이 있을 때 / 없을 때) | 밑의 공간이 골라진다 / 선택이 풀린다 |
| P3 | 큰 방 안에 방, 그 안에 작은 방. 가운데 방을 숨기고 작은 방을 고른 뒤 같은 자리를 천천히(0.6초 뒤) 한 번 더 | 큰 방이 골라진다(숨긴 방을 건너뛴다). 숨긴 방의 줄에 선택 표시가 생기지 않는다 |
| P4 | 한 자리에 카메라 셋. 하나를 숨기고 그 자리를 0.6초 간격으로 거듭 누른다 | 남은 둘만 번갈아 골라진다 |
| P5 | 편집 중, 숨긴 것 위로 선택 상자를 끈다 | 끄는 동안에도 놓은 뒤에도 숨긴 것의 줄에 표시가 없다. 묶음의 수('N개 선택')에 들지 않는다 |
| P6 | 스냅을 켜고 의자를 숨긴 책상의 왼쪽 가장자리(x = 책상의 `x`) 가까이로 끈다 → 눈을 켜고 다시. 방의 가장자리·가운데나 도면 테두리와 겹치지 않는 자리의 책상을 쓴다(그것들도 스냅 선이다) | 숨긴 동안에는 **책상의 그 값에 선 안내선이 없고**(`.bmap-snap-guides line`의 `x1`이 그 값이 아니다) 놓은 의자의 가장자리가 그 값이 아니다. 켜면 그 값의 안내선이 생기고 붙는다 |
| P7 | 숨긴 의자가 속한 방을 끌어 옮긴 뒤 의자의 눈을 켠다 | 의자가 방과 함께 옮겨져 있다 |
| P8 | **한 윤곽의 두 층**(아래층 바닥 0, 위층 바닥 180 — 준비물)에서 위층을 숨기고 그 자리에 기호 도구로 의자를 놓는다 → 위층을 다시 보인다. 다음에 방 하나뿐인 자리에서 그 방을 숨기고 놓는다 | 의자의 '소속 공간'이 **아래층**이고(편집 중 속성) 바닥 높이가 0이다(저장소의 그 노드에 `elevation` 키가 없다). 방 하나뿐인 자리에서는 '공간 밖 / 미지정'이고 땅 높이다(J4). 두 번 다 도면의 노드 수가 하나씩만 는다(숨긴 것이 그대로 있다) |
| P9 | 숨긴 것이 있는 채로 '맞춤'(0), 이미지 목록, '도면 구성'의 수 | 지금과 같다(숨긴 것까지 넣는다) |
| P10 | 끌기 도중(공간을 누르고 움직인 채)에 눈을 누른다 — 검사 창에서는 그 버튼의 `click()`을 부른다 | 아무 일도 없다(줄도 저장소도 그대로). 끌기가 이어지고, 놓으면 한 단계로 끝난다 |
| P11 | 보기 모드 / 저장이 도는 동안(개발 도구에서 `window.electronAPI.backgroundExecute`를 2초 늦춘 것으로 감싼다) | 눈이 듣는다 |

**눈 — 3D와 보조 평면도**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| T1 ★ | 3D에서 공간·기호·카메라를 하나씩 숨긴다. 방에 속한 의자와 카메라가 있는 도면에서 **그 방만** 숨긴다 | 그 뿌리와 따라다니는 것(이름표·카메라의 내림선)의 `visible`이 거짓이다. 보조 평면도에서 그 `.bmap-plan-node`가 없어진다. 보조 평면도의 그림 크기(보기 상자)는 그대로다. **방을 숨겨도 그 방에 속한 기호·카메라는 뿌리가 보이고, 그 자리를 누르면 골라진다**(④) |
| T2 | 숨긴 의자가 있던 화면 자리(숨기기 전의 `nodeScreenPoint`)를 누른다 | 뒤의 바닥(방)이나 빈 곳이 골라진다 |
| T3 | 보조 평면도에서 숨긴 방이 낀 자리를 0.6초 간격으로 거듭 누른다 | 숨긴 방으로 넘어가지 않는다 |
| T4 | 카메라를 하나 숨기고 다른 카메라로 '이 카메라 시점으로 보기' | 미리보기에 숨긴 카메라와 숨긴 사물이 없다 |
| T5 | **한 윤곽의 두 층**(P8의 준비물)에서 위층을 숨기고 3D에서 기호 도구로 **아래층의 바닥**을 눌러 놓는다. 다음에 방 하나뿐인 자리에서 그 방을 숨기고 그 자리의 땅을 누른다 | 기호의 뿌리가 **누른 바닥의 높이(0)**에 있고(`position.y`), 속성의 소속이 아래층이다 — 숨긴 위층의 높이(180)에 뜨지 않는다. 방 하나뿐인 자리에서는 땅(0)에 놓이고 소속이 없다(J4) |
| T6 | 3D의 '맞춤' | 숨긴 것까지 화면에 넣는다 |
| T7 | 3D에서 둘을 숨긴 채 어두운 ↔ 밝은 화면을 그 자리에서 바꾼다(위의 법) | 둘의 뿌리가 여전히 `visible` 거짓이고, 그 자리를 눌러도 골라지지 않는다 |
| T8 | 방에 속한 카메라를 고르고(보조 평면도에 옆 그림이 나온다) 그 방을 숨긴다 | 보조 평면도의 평면에서 방이 없어진다. **옆에서 본 그림의 방 띠(`.bmap-plan-side-room`)는 남는다**(4.4 — 높이의 눈금이다) |

**선택 규칙**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| S1 ★ | 평면: 고른 방의 눈을 끈다(편집 중) | 손잡이가 없어지고 속성 칸이 '도면 구성'이 된다. 줄에 `aria-current`가 없다 |
| S2 | 평면: 셋을 묶어 고르고 하나의 눈을 끈다 → 하나 더 | '2개 선택' → 남은 하나의 속성 |
| S3 ★ | 3D: 고른 카메라로 시점을 보다가 그 카메라의 눈을 끈다 | 시점 미리보기가 끝나고, 폼과 기즈모가 없다 |
| S4 | 평면에서 셋을 묶고 3D로 가서 **묶음 밖의** 의자를 누른 뒤 그 의자의 눈을 끈다 | 손에 든 것이 없다('평면에서 고른 3개는 그대로…' 안내 + '도면 구성'). 평면으로 돌아가면 셋이 그대로 골라져 있다 |
| S5 | 같은 준비에서 묶음 **안의** 하나를 3D에서 손에 들고, 묶음의 다른 것의 눈을 끈다 | 손에 든 것과 그 폼이 그대로다. 평면으로 돌아가면 둘이 골라져 있다 |
| S6 ★ | 흐린 줄의 이름을 누른다 / 흐린 줄의 눈을 누른다 | 다시 보이고 골라진다(`aria-current`) / 다시 보이기만 한다 |
| S7 | 제목의 '모두 보이기' / 바닥줄의 칩 | 모두 보인다. 버튼과 칩이 사라진다. **`document.activeElement`가 캔버스**(평면은 SVG, 3D는 `.bmap-3d-main`)이고 곧바로 `+`·Delete가 듣는다 |
| S8 | 고른 것을 숨긴 뒤 F2, 그리고 **스크립트로** 도면에 포커스를 준 뒤(위의 법 — 도면을 누르면 그 누름이 선택을 푼다) Delete·Ctrl+D | 아무 일도 없다 — 이름 칸도 삭제 확인 창도 뜨지 않고 복제도 생기지 않는다 |
| S9 | 평면에서 **둘**을 묶고 3D로 가서 묶음 밖의 카메라를 골라 '이 카메라 시점으로 보기' → 묶음의 하나의 눈을 끈다(그 카메라 앞을 막은 것을 숨기는 흔한 길이다) → 0.6초 뒤 평면으로 돌아간다. **셋**을 묶은 준비로 한 번 더 | **카메라가 손에 든 채이고 시점 미리보기가 이어진다**(속성 칸이 그 카메라의 폼 그대로, `.bmap-3d`에 `is-looking`). 속성 칸에서는 묶음 안내 줄만 없어지고(그래서 0.5초 동안 다음 누름을 받지 않는다), 평면으로 돌아가면 **그 카메라 하나가 골라져 있다**(묶음의 남은 하나는 풀렸다 — J13). 셋을 묶은 준비에서는 안내 줄이 '2개'로 남고 미리보기가 이어지며(쉬지 않는다) 평면에 둘이 골라져 있다 |
| S10 | **이 줄에서는 도면을 누르지 않는다(위의 법).** 편집 중 평면에서 공간 B를 새로 그리고 A를 Shift+클릭으로 더해 둘을 묶는다 → 3D에서 묶음 밖의 D를 누른다 → **읽는다 ①** → Ctrl+Z를 B가 목록에서 없어질 때까지(D를 누른 뒤라 포커스가 이미 3D 화면에 있다) → **읽는다 ②** → 목록에서 D의 눈을 끈다 → `.bmap-3d-main`에 포커스를 주고 Ctrl+Y(또는 도구 막대의 ↷ — B가 돌아온다) | ①: 속성 칸이 D의 폼이고 그 위에 '평면에서 고른 2개는 그대로 있어요…' 줄이 있다(적어 둔 고름이 D다 — 이것이 없으면 이 줄은 아무것도 재지 않는다). ②: A의 폼이고 그 줄이 없다. D를 숨기는 순간 화면은 그대로다(A의 폼, D의 줄만 흐려진다 — 쉬지 않는다). B가 돌아온 뒤 **속성 칸은 A의 폼 그대로이고 묶음 안내 줄이 없다**(숨기며 선택을 다시 적을 때 그때 없던 B가 빠졌다 — 11.4). **고치지 않은 코드의 모습: 그 줄과 함께 D의 폼이 나온다**(숨긴 D가 손에 들린다 — Delete가 D를 묻는다) |

**저장되지 않는다 · 기억한다**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| N1 ★ | 편집 중, 저장할 것이 없는 채로 눈을 여러 번 누른다(게이트 A). **게이트 C에서 박스의 체크 칸과 두 버튼으로 한 번 더** | 띠가 "저장된 그대로예요" 그대로, '도면 저장'이 흐린 채, 도면 트리에 점이 없다. Ctrl+S가 아무것도 쓰지 않는다(미리보기 저장소의 그 도면 `revision`이 그대로) |
| N2 | 공간 하나를 옮긴 뒤(1개) 다른 것의 눈을 누른다 → 스크립트로 도면에 포커스를 주고(위의 법) Ctrl+Z | 수가 1 그대로였다가 0이 된다. Ctrl+Z는 옮긴 것만 되돌린다 — **숨긴 것은 돌아오지 않는다** |
| N3 | 눈을 누른 직후 '편집 끝내기'(게이트 A). **게이트 C에서 박스를 켠 직후에 한 번 더** | 묻지 않고 끝난다. 숨김과 박스는 그대로다 |
| N4 | 보기 모드에서 눈(게이트 C에서는 박스도 — J12. 미리보기 계정은 관리자라 읽기 전용 계정은 화면으로 볼 수 없다: 핸들러에 `canManage`·`editing` 조건이 없다는 것은 앵커 R2-2·R2-6이 본다) | 듣는다. 편집 버튼이나 띠가 생기지 않는다 |
| N5 ★ | 편집 중 둘을 숨긴 채 **쓰는 길 넷을 모두 지난다**(4.7의 3): 평면에서 다른 것을 끌어 옮기고, 3D로 가서 또 하나를 기즈모로 옮기고, 기호 하나를 놓고, 속성의 숫자 칸 하나를 고친다 → **저장** → 미리보기 저장소를 읽는다 → 창을 새로 고친다 → '모두 보이기' | 저장된 도면의 노드 수가 **전보다 꼭 하나 많고**(놓은 기호) 숨긴 노드 둘이 그대로 있다(id와 값이 숨기기 전과 같다). 새로 고친 뒤 둘은 여전히 숨겨져 있고 칩이 있다. '모두 보이기' 뒤 모두 그려진다 |
| N6 | 라이브러리의 다른 탭 → 돌아옴 / 앱의 다른 메뉴 → 돌아옴 / 창 새로 고침 / 다른 도면 → 돌아옴 | 숨김과 박스가 그대로다. 다른 도면에는 그 도면의 것만 있다 |
| N7 | 저장소의 열쇠를 본다. 콘솔에서 `…view.v1:someone`에 다른 숨김을 적고 새로 고친 뒤 **눈을 하나 더 누른다**. 다음에 `…view.v1:1`을 지우고 새로 고친다 | 열쇠가 `bflow.background-map.view.v1:1` 하나이고 모양이 3절과 같다. 남의 열쇠는 화면에 닿지 않고, **눈을 누른 뒤에도 `…:someone`의 값이 글자 그대로다**(읽지 않을 뿐 아니라 덮어쓰지도 않는다). 자기 열쇠를 지우면 모두 보인다(오류 없음). 값에 쓰레기(`'x'`)를 넣고 새로 고쳐도 화면이 뜬다 |
| N8 | **돌아온 노드**(3절 — 되돌리기·다시 실행은 도구 막대의 ↶·↷로 누른다). ① 편집 중 공간을 하나 그리고 그것을 숨긴 뒤 ↶를 그 줄이 목록에서 없어질 때까지(노드가 초안에서 없어진다) → **다른 눈을 하나 껐다가 다시 켠다** → 저장소를 읽는다 → ↷를 그 줄이 돌아올 때까지. ② 같은 준비에서 ↶ 뒤 다른 것을 하나 숨기고 **'모두 보이기'** → ↷. 박스도 한 번(게이트 C): 방을 그려 박스로 하고 ①(다른 방의 박스를 켰다 끈다)과 ②('모두 비치게') | 없어진 순간부터 수('숨김 M')가 그것을 세지 않는다. ①: 다른 눈을 눌러도 저장소의 목록에 그 id가 **남아 있고**, 돌아온 공간은 **숨긴 채**다(수가 돌아오고 줄이 흐리다). 선택되어 있지는 않다. ②: '모두 보이기' 뒤 저장소에 그 id가 없고, 돌아온 공간은 **보인다**. 박스도 같다(①은 박스로, ②는 비치는 채로 돌아온다) |

**박스**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| B1 ★ | 3D에서 방을 고른다(보기 모드 / 편집 중 / 잠긴 방) → 체크. 아무것도 고르지 않은 3D와 평면의 '도면 구성'도 본다 | 속성 칸에 체크 칸·안내·두 버튼 — 보기 모드에서는 '이 공간 안으로' 바로 아래, 편집 중에는 **'공간 종류'와 그 안내 글 아래**(접힌 구역들 위). 안내 글이 **체크하기 전에도 뒤에도 같은 글자**다: '이 PC에서 3D를 보는 방식만 바뀌어요. 도면에는 저장되지 않아요. 박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요.'(체크를 켜고 끌 때 구역의 높이와 그 밑 목록의 자리가 그대로다). 켜면 뿌리에 `space-lid`가 생기고 벽 재질이 `transparent` 거짓·`opacity` 1·`depthWrite` 참. 평면으로 바꾸면 그 구역이 **없다**. 도로·카메라·기호를 고르면 없다. 아무것도 고르지 않은 **3D**의 '도면 구성'에 '공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.' 한 줄이 있고, 평면의 '도면 구성'에는 없다 |
| B2 ★ | 박스를 사방에서, 위에서, **아래에서** 본다: 바닥에 의자와 침대가 놓인 방의 바닥 높이를 300으로 올리고(속한 것이 따라 오른다) 아래에서 올려다본다(위의 법). 그 밑에 카메라를 두고 위아래 각도 +60으로 시점을 본다. **끝으로 둘러보는 자리를 박스 안으로 넣는다**(위의 법으로 `d.camera.position`을 방 안에) | 어느 쪽에서도 안이 보이지 않는다. 아래에서 본 면이 한 색으로 막혀 있다 — **의자 다리나 침대 틀의 밑면이 바닥 면에 네모로 비치지 않는다**(그것들의 뿌리가 `visible` 거짓이다). 박스 안에서 보면 막힌 벽뿐인 **빈 방**이다(설계대로 — 품긴 것은 그리지 않는다. 11.3의 1로 알린다) |
| B3 | 누르기: 박스 속 의자의 화면 자리 / 박스의 뚜껑 가운데 기본 계단의 윗단이 있는 자리 / 박스 뒤에 선 카메라의 화면 자리 / 박스 앞에 둔 의자 / 박스 앞에 선 비치는 방의 벽 너머의 박스 / 박스를 같은 자리에서 천천히(0.6초 뒤) 한 번 더 / 박스(상세 도면 있음) 더블클릭 | 방 / 방(계단이 아니다) / 방 / 의자 / 박스 / 그대로 박스 / 상세 도면으로 들어간다 |
| B4 | 큰 방 한가운데에 작은 방을 두고 **작은 방만** 박스로 한다. 박스 안에 카메라와 더 작은 방을 둔다 → 목록에서 그 카메라를 고른다 → (편집 중, 선택 도구) 기즈모로 옮긴다 → 보기 모드에서도 목록에서 고른다 → **모든 공간을 박스로** | 처음에는 안의 둘이 그려지지 않는다(뿌리 `visible` 거짓). **둘러싼 큰 방은 그려지고 이름이 보인다.** 고르면 그 카메라의 이름과 기즈모가 박스를 뚫고 보이고 옮겨진다. 박스 밖으로 나가면 고르지 않아도 그려진다. 보기 모드에서는 이름만 뚫고 보인다(기즈모는 편집 중에만 있다). 모두 박스로 하면 **맨 바깥 박스가 그려지고 그 이름이 뚜껑 위에 뜬다**(안의 박스들은 그려지지 않는다) |
| B5 ★ | 편집 중 박스인 방을 손에 든 채 기호 도구를 든다 → 속성 칸을 본다 → **저장할 변경이 있는 채로 Ctrl+S**(P11처럼 2초 늦춘 저장 — 도는 동안 0.2초마다 읽는다) → 그 방의 바닥을 눌러 놓는다 → 도구가 돌아온 뒤 | 도구를 든 동안 `space-lid`가 어디에도 없고 모든 방이 비치며, 박스 구역의 안내 글 끝에 '기호를 놓는 동안에는 모든 공간이 비쳐 보여요.'가 있다(체크는 켜진 채다). **저장이 도는 동안에도 `space-lid`가 한 번도 생기지 않고, 그 문장과 그 밑 목록의 자리가 그대로다**(박스가 닫혔다 열리지 않는다 — 5.4). 저장이 끝난 뒤 누르면 기호가 그 바닥에 놓인다. 뒤에 뚜껑이 돌아오고 그 문장이 없어진다. 새 기호는 박스가 품었지만 고른 것이라 그려진다 — 본체는 가려지고 이름과 기즈모가 보인다. 다른 것을 고르면 그려지지 않는다 |
| B6 ★ | 박스 속 카메라를 목록에서 골라 '이 카메라 시점으로 보기' → 돌아가기. 다른 박스가 화면에 들어오게 한다 | 미리보기에서 그 카메라가 선 방은 비치고(안의 사물이 보인다) 다른 박스는 박스다. 돌아오면 다시 닫힌다 |
| B7 | '모든 공간을 박스로' → 도로가 있는 도면에서 / 새 방을 평면에서 그린 뒤 3D로 / '모두 비치게' | 방은 모두 박스, 도로는 평평. 새 방은 비친다. '모두 비치게' 뒤 뚜껑이 하나도 없다. 두 버튼을 누른 뒤 포커스가 그 버튼에 있다 |
| B8 | 박스인 방을 편집 중(3D) '공간 종류'에서 도로로 → 다시 방으로. 바꾸기 전과 뒤에 그 선택 칸의 자리를 잰다(`getBoundingClientRect`) | 평평한 도로 → 다시 박스. 도로일 때 구역이 없다. **선택 칸의 자리가 두 번 다 그대로다**(없어지고 생기는 구역이 그 아래에 있다 — 5.5) |
| B9 | 박스를 숨긴다(목록의 눈) | 박스가 없고, 그것이 품었던 것(의자, 카메라와 그 이름표)이 다시 그려진다 |
| B10 | 박스를 켠 채 평면과 보조 평면도, 오브젝트 목록 | 체크 전과 같다(DOM을 견준다) — 박스가 품은 것도 거기서는 그대로 그려지고 골라진다 |
| B11 | 박스를 기즈모로 옮기고·돌리고·크기를 바꾼다. 박스를 옮겨 밖에 있던 의자를 온전히 덮었다가 벗어난다. 되돌린다 | 뚜껑이 함께 움직이고 늘어난다. 한 번에 한 단계다. 덮인 동안 그 의자가 그려지지 않고(끄는 도중에도), 벗어나면 다시 그려진다 |
| B12 ★ | 어두운 ↔ 밝은 화면을 박스가 있는 채 **그 자리에서** 바꾼다(위의 법). 테마를 하나 더: **에메랄드의 밝은 화면을 '위에서 보기'로**(뚜껑만 보인다 — 여섯 테마 × 두 화면 가운데 뚜껑과 땅이 가장 덜 갈리는 조합이다: 계산으로 뚜껑 `#b3f1dc`, 땅 `#fdfeff`, 1.26:1) | 박스가 곧바로 그 화면의 색이 되고 남아 있다(`space-lid`가 그대로이고 벽 재질의 색이 바뀐다). 품긴 것은 여전히 그려지지 않는다. 땅·배경과 갈린다. 덩어리를 읽게 하는 것은 E4대로다(어두운 화면은 선, 밝은 화면은 면). 에메랄드의 그 화면에서 뚜껑의 한 픽셀이 `#b3f1dc`(채널마다 4 안)이고, **캡처에서 박스가 땅과 갈려 보이는지를 본다** — 갈리지 않으면 11.2(밝은 화면의 선·비율) |
| B13 | 새로 고침 / 다른 메뉴에 다녀옴 | 박스가 그대로다 |
| B14 | 3D에서 기즈모로 끄는 도중에 박스의 체크 칸을 누른다 — 검사 창에서는 그 입력의 `click()`을 부른다. 두 묶음 버튼도 | 아무 일도 없다(체크도 저장소도 그대로). 끌기가 이어지고, 놓으면 한 단계로 끝난다 |

**회귀 (숨긴 것도 박스도 없는 채로 — R2)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| G1 ★ | 목록: 줄을 눌러 고르기(평면·3D), 묶음 표시, 겹친 카메라를 목록에서 고르기, 키보드로 줄 고르기. 제목 줄의 높이와 배지의 크기를 main(고치기 전)에서 잰 값과 견준다 | 예전과 같다 — 줄마다의 눈과 목록 아래의 글 한 문단만 새로 보인다. 제목은 'N개', 칩이 없다. **제목 줄과 배지의 크기가 고치기 전과 같다**(배지의 `display`만 바뀌었다 — 6.3). 숨긴 것이 없는 3D의 안내 글에 `title`이 없다 |
| G2 | ②의 선택 도구: 상자, Shift+클릭, 묶음 끌기, 겹친 공간의 천천히 한 번 더, 더블클릭으로 상세 도면·이름 | ②의 검증 표대로 |
| G3 | ①의 스냅과 점 편집, ③의 도로(방 밑의 도로를 천천히 한 번 더로 고르기 — 평면과 3D) | 그대로 |
| G4 | 3D: 클릭·같은 자리 다시·더블클릭, 기즈모 세 모드, 기호 놓기, 카메라 시점, 맞춤 | 그대로 |
| G5 | 다-1의 띠: 편집 시작·수·저장·Ctrl+S·편집 끝내기, 1차의 숫자 끌기·높이 끌기·도면 삭제 | 그대로(1차의 검증 표에서 ★만) |
| G6 | 콘솔 | 오류·경고가 없다(three의 재질 경고 포함) |

---

## 9. 배포 기록과 문서

- **버전**: `package.json`의 `version`과 `package-lock.json`의 두 곳(맨 위 `version`, `packages[""].version`)을 `1.137.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다(1차가 1.136.0이 아닌 번호로 나갔으면 그 다음 마이너).
- **`DEVLOG/update-notes.json` 맨 앞에 추가**:

```json
{
  "version": "1.137.0",
  "title": "배경 도면에서 항목을 눈으로 숨기고, 공간을 박스로 볼 수 있어요 (시험 중)",
  "items": [
    {
      "category": "feature",
      "summary": "오브젝트 목록의 눈 버튼으로 항목을 숨길 수 있어요 (시험 중)",
      "description": "도면에 공간과 사물이 많아지면 뒤에 있는 것을 보거나 누르기가 어려웠어요. 이제 오브젝트 목록의 줄마다 눈 버튼이 있어서, 끄면 그 항목이 평면과 3D에서 사라지고 눌리지도 않아요. 숨긴 줄은 목록에 흐리게 남아 있고, 이름을 누르거나 도면 아래의 '숨김 N개 · 모두 보이기'를 누르면 다시 보여요."
    },
    {
      "category": "feature",
      "summary": "3D에서 공간을 속이 안 보이는 박스로 볼 수 있어요 (시험 중)",
      "description": "3D에서는 공간의 벽이 늘 비쳐서 안에 있는 것이 다 보였어요. 이제 3D에서 공간을 고르면 속성에 '속이 안 보이는 박스로 보기'가 있고, 켜면 그 공간이 뚜껑 덮인 한 덩어리로 보여요(안에 든 것은 그동안 3D에서 보이지 않고, 오브젝트 목록에서 고를 수 있어요). '모든 공간을 박스로'와 '모두 비치게'로 한 번에 바꿀 수도 있어요."
    },
    {
      "category": "ux",
      "summary": "숨기기와 박스 보기는 이 PC에서 보는 방식만 바꿔요 (시험 중)",
      "description": "눈과 박스 보기는 도면 내용을 바꾸지 않아서 '저장 안 한 변경'에 잡히지 않고, 되돌리기(Ctrl+Z)로 돌아가지도 않아요. 이 PC의 내 계정에 도면별로 기억되고, 다른 PC의 화면은 바뀌지 않아요. 숨긴 채 저장해도 숨긴 것은 그대로 저장돼요."
    },
    {
      "category": "ux",
      "summary": "배경 화면은 아직 배한솔 계정에서만 보여요 (시험 중)",
      "description": "이번 변경도 배경 화면 안의 일이라, 배경 메뉴가 보이지 않는 분들은 달라지는 것이 없어요. 그림을 끌어다 놓는 기능은 다음 차례에 이어서 넣을 예정이에요."
    }
  ]
}
```

  (실제 파일에는 기존 항목과 같은 줄바꿈으로 넣는다. 문구는 비개발자의 말이다 — 파일·함수·저장소의 이름을 적지 않는다.)

- **문서** (1차가 같은 문서에 남기는 것은 1차 설계 8절에서 읽었다 — 그 뒤에 잇는다)
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절에서 **1차의 줄(`- [x] 2026-10-13 숫자 끌기·옆 그림의 높이·도면 바로 삭제(v1.136.0): …`) 다음에** `- [x] 2026-10-13 눈과 박스(v1.137.0): 오브젝트 목록의 줄마다 눈으로 숨기기(평면·3D·보조 평면도에서 그리지 않고 눌리지 않는다), 3D에서 방을 속이 안 보이는 박스로 보기. 둘 다 이 PC의 계정별·도면별 보기 설정이고 도면에 저장하지 않는다. 저장 자료·운영 DB·IPC 변경 없음. 설계: docs/superpowers/specs/2026-10-13-background-map-eye-solid-design.md` 한 줄. 1차가 만든 `### v1.136.0 …` 절의 `- [ ] 2차(눈·박스로 보기) · 3차(그림 끌어다 놓기)는 다음 차례`를 `- [x] 2차(눈·박스로 보기) — v1.137.0`과 `- [ ] 3차(그림 끌어다 놓기)는 다음 차례` 두 줄로 나눈다. 파일 끝(그 절 다음)에 `### v1.137.0 배경 도면 — 눈과 박스 (2026-10-13)` 절: 눈 / 박스 / 보기 설정은 저장하지 않는다 한 줄씩, `- [ ] 수동 검증(설계 8절 전체)`, `- [ ] 배포`, `- [ ] 3차(그림 끌어다 놓기)는 다음 차례`.
  - `AGENTS.md` '배경 라이브러리 데이터 경계': 1차가 더한 항목(**숫자 끌기 · 옆 그림 · 도면 삭제(v1.136.0)**) 다음에 한 항목 — **보기 설정 — 눈과 박스(v1.137.0)**: 오브젝트 목록의 눈(숨김)과 3D의 박스는 **도면이 아니라 이 PC의 보기 설정**이다(`mapViewPrefs.ts`, `localStorage`의 `bflow.background-map.view.v1:<계정 id>`, 도면별 `hidden`·`solid`). 저장 모양·IPC·DB에 넣지 않는다(넣으려면 닫힌 목록을 넓히는 새 migration이다). 없어진 노드의 id는 목록에서 치우지 않는다 — 되살린 노드는 숨긴 채·박스인 채로 돌아온다. 그래서 숨긴 수는 `hiddenNodeCount`로 센다(`hiddenIds.size`는 죽은 id까지 센다). 화면의 글은 숨긴 **것**을 주어로 쓴다("도면에는 그대로 있어서, 저장해도 지워지지 않아요" — "도면에는 저장되지 않아요"는 숨긴 것이 지워진다로 읽힌다) / **걸러 본 도면(`shownMap`)은 "포인터가 무엇 위에 있나"를 묻는 데만 쓴다** — 평면의 겹침 더미·선택 상자·스냅 후보·새 기호가 속할 공간, 보조 평면도의 넘기기. 쓰는 곳(포인터 세션의 `initial`, `previewPlanGesture`, 새 기호를 더해 적는 `base`, 3D와 보조 평면도의 `map`, 기즈모, 1차의 숫자 칸·옆 그림 끌기 `beginFieldScrub`·`previewFieldScrub` — 문서의 초안과 제스처의 시작 도면)에는 늘 전체 초안을 준다: 걸러 본 도면을 넘기면 다음 끌기에서 숨긴 노드가 도면에서 지워진다. 3D는 도면을 거르지 않고 id 묶음(`hiddenIds`·`solidIds`)을 받는다. 눈은 그 줄 하나만 숨긴다(방을 숨겨도 그 방에 속한 것은 남는다) / **숨긴 것은 선택되지 않는다**: 숨기는 길(`setNodesHidden`)이 평면의 묶음, 3D의 손에 든 것, 3D가 적어 둔 고름(`MapViewport.selectedId` — 지금 손에 없어도)에서 빼고(`selectionWithout` → `doc.selectMany` 다음, 3D이고 둘 이상 남을 때만 `select()`. 3D에서 묶음이 하나 이하로 줄 때 묶음 밖의 것을 손에 들고 있었으면 그것이 선택이 된다 — 손에 든 것은 손에 남는다), 목록의 이름은 `selectFromList`가 먼저 보이게 한 뒤 고른다. 고르는 길을 새로 더할 때는 숨긴 노드가 선택될 수 없는지 본다 / 보기 설정의 핸들러는 `updateMap`·`doc.update`·`patchNode`를 부르지 않고(되돌리기 단계와 저장 안 한 변경이 생기지 않는다) 끌기 도중에는 아무것도 바꾸지 않는다. 보기 모드와 편집 권한이 없는 계정에서도 듣는다 / 박스: 닫힌 방의 세 면(바닥·벽·뚜껑)은 `pickPart: 'shell'`이고 `visibleMapHits`가 그 **뒤**의 것을 클릭에서 뺀다(뷰포트의 `cast` 한 곳). **닫힌 방이 온전히 품은 노드(`spaceHoldsNode`·`nodesHeldBy`, `mapStack.ts`)는 뿌리째 그리지 않는다 — 고른 노드만 예외**: 깊이 검사에만 맡기면 면과 한 평면에 놓인 것(뚜껑 높이의 계단, 벽에 붙은 방)이 면 위에 비치고 눌린다. 품는지는 온전히 안에 있는지로 묻는다(가운데 점으로 물으면 둘러싼 방이 품긴다). 카메라도 "같으면 안"이다 — 벽 선 위(스냅이 그렇게 놓는다)와 뚜껑 높이에 선 카메라는 품기고, 선 위인지는 `containsPoint`에 점 그대로 묻지 않는다(다각형의 변을 절반만 안으로 읽는다). `boxes`와 `held`는 노드를 돌기 전에 도면에서 만든다. 편집 중 기호 도구를 든 동안에는 모든 방이 비친다 — 편집기가 `<Map3D>`에 하나뿐인 빈 묶음을 준다(`roomsOpen`. `canEdit`이 아니라 `editing`에 단다: 저장마다 박스가 닫혔다 열린다). 카메라 시점에서는 그 카메라가 선 방이 비친다. 도로는 박스가 되지 않는다. `this.last`의 옵션에 네 값이 모두 있어야 테마를 바꿔도 숨김과 박스가 남는다 / 칩은 바닥줄에서 **자리를 차지하지 않는 닻**(`.bmap-hidden-slot`)에 떠 있다 — 흐름에 넣으면 안내 글의 줄 수와 도면의 높이가 달라진다. 닻의 음수 여백은 바닥줄의 `gap`과 같은 숫자다. 목록 제목은 꺾이지 않아야 한다(배지가 말줄임으로 줄어든다) / 숨기기로 **속성 칸에 보이는 것이 바뀔 때만** `swallowSecondClick()`을 부른다(`selectionWithout`의 `moved` — 그때 목록이 포인터 밑에서 움직인다. 선택이 바뀔 때마다 부르면 고른 묶음의 눈을 잇달아 누를 수 없다).
  - `DEVLOG/background-library-verification-2026-09-21.md`: 1차의 절이 있으면 그 다음에, 없으면 파일 끝(`### v1.135.1 — 편집을 끝낸 뒤 남던 주황색 선 (2026-10-13)` 절 다음)에 `## 2026-10-13 눈과 박스 (v1.137.0)`(검증한 날이 다르면 그 날짜로). `56cbc744`에는 1차의 절이 없다 — 1차는 v1.135.0 절의 한 줄에 'v1.136.0에서 고침'만 더했고, 1차의 수동 검증은 ROADMAP의 `### v1.136.0` 절에 `- [ ] 수동 검증(설계 7.6 전체)`로 남아 있어 그 절은 그 검증 때 생긴다. 어느 쪽인지는 0단계에서 본다. 적을 것 — 7.4의 수치, 8절의 결과(E1~E7의 관찰과 쓴 대체안, 속성 칸의 스크롤 막대 폭, 박스의 색을 본 테마와 화면, 칩이 안내 글을 덮은 폭 — 11.4의 계산과 나란히), 검증에 쓴 주소, 확인하지 못한 것.
  - `docs/superpowers/plans/2026-10-10-feedback-additions.md`: 7절 진행 기록의 표에서 1차가 더한 '바' 줄을 고친다 — 둘째 칸의 `2차·3차: -`를 `2차: docs/superpowers/specs/2026-10-13-background-map-eye-solid-design.md, 아래 7.5 · 3차: -`로, 셋째 칸을 `1차 v1.136.0(그때의 상태) · 2차 구현·검증 상태 · 3차(그림 끌어다 놓기) 대기`로. 1차의 7.4 절 뒤에 `### 7.5 눈 · 박스로 보기 — 만든 것과 확인한 것 (v1.137.0, 날짜)`를 7.3·7.4와 같은 꼴(만든 것 / 확인한 것 / 확인하지 못한 것 / 한솔에게 알린 것과 이 설계가 정한 것 — 1.2의 J1~J14)로 더한다.
  - 1차의 설계 문서(`docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md`): 고치지 않는다. 그 문서 6.5의 "2차" 문단은 "보는 방식의 거르기는 그리는 쪽에만 붙으면 된다"고 적었는데, 이 설계는 가리키는 쪽(평면의 겹침 더미·선택 상자·스냅 후보·새 기호의 공간, 보조 평면도의 넘기기)도 거른다 — 그 문단이 지키려던 것("쓰는 쪽은 거르지 않는다")은 같다. 그 문서는 1차의 기록이라 두고, 2차의 규칙은 이 문서의 1.1이다.
  - `CLAUDE.md`: 고치지 않는다(구조 변경 없음).
  - 완료 보고(한솔에게): 11.3을 비개발자 문장으로 옮겨 적는다(항목마다 1~3문장 — 11.3의 머리).

---

## 10. 구현 순서 (단계마다 `npm run typecheck`와 `npm run test:background`가 통과하게)

**게이트와 누가 보는가.** 단계마다 typecheck와 `test:background`가 통과해야 다음으로 간다 — 그래서 각 단계의 테스트와 앵커는 **그 단계까지 생긴 이름만** 읽는다. typecheck는 `src`만 지킨다: 테스트 파일은 돌려서 본다(7.4). CSS를 고친 3단계부터 `npm run test:motion`도 돌린다. `npm run build:vite`는 8단계에서 돈다. **"…을 본다"는 구현자가 아니라 오케스트레이터가 한다**(구현자는 앱·미리보기 서버를 띄우지 않는다). 대체안이 걸린 확인이라 다음 단계가 그 위에 쌓이기 전에 본다.

0. **시작 전에**(코드를 고치지 않는다): 1차가 머지된 `origin/main`에서 가지를 딴다. 이 문서를 `docs/superpowers/specs/2026-10-13-background-map-eye-solid-design.md`로 옮긴다. 11.2의 마지막 줄대로 1차 뒤의 자리 여섯을 확인하고(이 문서는 머지 직전의 가지 `56cbc744`에 맞춰 두었다), 달라진 것이 있으면 이 문서의 그 줄부터 고친다. 누적 검증 기록에 1차의 절이 생겼는지 본다(9절의 자리). `npm run test:background`의 수를 적어 둔다(1차 뒤의 기준 — 7절의 619는 `56cbc744`의 수다).
1. **저장소**: `mapViewPrefs.ts` 전부 + `tests/backgroundMapViewPrefs.test.ts`(V-1~V-14), 앵커 59의 목록. 화면은 달라지지 않는다(부르는 곳이 없다).
2. **품는가**: `mapStack.ts`의 `spaceHoldsNode`·`nodesHeldBy` + K-1·K-2.
3. **눈 — 평면**: `viewerId`(편집기와 `BackgroundLibraryView.tsx`), `HIDDEN_NOTE`, 상태와 세 값, **핸들러 다섯 모두**(`solidIds`와 `setSpacesSolid`는 6단계에서야 쓰이지만 여기서 선언한다 — R2-2가 그 조각을 한 줄씩 견주고, 쓰지 않는 지역 변수는 이 저장소의 typecheck에서 오류가 아니다, `tsconfig.json:15`), `ObjectList`, 세 그리는 줄과 `shownMap` 넷(`placeSymbol`의 한 줄 포함), 바닥줄의 칩과 안내 글의 `title`, CSS(줄·제목·목록 아래 글·칩의 열세 줄) + 앵커 21·23·25·27·36·52를 다시 쓰고 R2-1(편집기 쪽 — 두 3D 태그의 끝은 4·6단계)·R2-2·R2-3·R2-5(칩과 줄). **오케스트레이터가 E1~E3·E5~E7, P1~P11, S1·S2·S6·S7·S8, N1~N5·N7·N8의 눈 쪽을 본다(게이트 A).** E2(제목·눈·바닥줄·도면이 움직이지 않는가)가 기대와 다르면 11.2대로 고치고 넘어간다. 이 시점의 3D와 보조 평면도는 숨긴 것을 아직 그린다.
4. **눈 — 보조 평면도와 3D**: `mapCanvas.ts`의 세 필드(`Map3DProps`의 둘, `MapPlanPreviewProps`의 하나 — 6.1), 보조 평면도(4.4), 장면의 옵션 두 필드·`this.last` 줄·`sync`의 `visible` 줄에서 `hiddenIds`까지(장면은 5단계까지 `solidIds`를 읽지 않는다: `boxes`·`held`와 `visible` 줄의 끝은 5단계), 뷰포트의 `NO_IDS`·`shown`·`syncScene` 전체(5.4)·`gizmoAllowed`, 편집기의 두 태그에 `hiddenIds`(1차의 앵커 64가 글자로 고정하는 보조 평면도의 세 줄 — 편집기의 태그, 보조 평면도의 함수 머리, `MapPlanPreviewProps` — 이 이 단계에서 바뀌므로 그 세 단언을 같은 커밋에서 새 글자로 고친다, 6.5) + S-2, W-1, W-2, R2-1(나머지 — `<Map3D>`의 끝 글자는 6단계), R2-4(숨김과 뷰포트의 `syncScene` 쪽). **게이트 B: T1~T8, S3~S5·S9·S10, N6, 그리고 N5를 3D의 기즈모와 기호 놓기까지 넣어 다시**(게이트 A의 N5는 평면의 끌기와 숫자 칸이다).
5. **박스 — 장면과 `cast`**: 5.1·5.2 전부(뷰포트는 `cast`의 한 줄) + S-1, S-3~S-6, W-3~W-5(대역에 `solidIds`를 넘긴다), R2-4(나머지). 이 시점의 화면은 달라지지 않는다(편집기가 `solidIds`를 아직 넘기지 않는다).
6. **박스 — 속성 칸**: 5.5의 구역과 '도면 구성'의 한 줄(3단계에서 선언한 `solidIds`·`setSpacesSolid`를 여기서 쓴다), `roomsOpen`과 `<Map3D>` 태그의 `solidIds`(5.4), CSS 세 줄 + R2-1(`<Map3D>`의 끝)·R2-5(나머지)·R2-6. **게이트 C: E4, B1~B14, 그리고 N1·N3·N4·N8의 박스 쪽.** E4(품긴 것이 정말 없는가, 선이 깜빡이지 않는가, 두 화면에서 저마다의 방식으로 읽히는가)가 기대와 다르면 11.2.
7. **앵커와 뮤테이션**: 6.5의 변형 표와 '살아남기 쉬운 변형' 서른다섯을 저장소 밖 임시 복사본에서 하나씩 넣어 모두 잡히는지 본다. 살아남는 것이 있으면 앵커나 테스트를 고친다(구현은 고치지 않는다).
8. **버전과 문서**(9절), 마지막 상태에서 7.4의 전체 기준과 git에 올리지 않은 파일 확인. 수동 검증의 나머지(G1~G6, ★의 세 조합)는 그 뒤에 오케스트레이터가 한다.

**오케스트레이터만 하는 일**: 앱 엔진 확인(8절)과 11.2의 대체안 선택 / 박스를 본 화면(어두운·밝은, 고른 것·아닌 것, **박스 뒤의 이름이 박스 위에 겹친 화면**, 에메랄드의 밝은 화면을 위에서 본 것)과 숨긴 줄·목록 아래의 글·칩의 화면을 완료 보고에 붙여 한솔에게 보인다 / PR 머지와 G드라이브 배포 — 한솔의 "이부분 수정해서 배포까지 진행해줘"(2026-10-13)와 "그대로 진행해줘. 나머지 배포까지 쭉 진행해"로 맡겨진 일이라 따로 묻지 않는다(11.1의 멈춤 — 게이트 C에서 박스가 안 되는 경우 — 만 예외). 운영 DB에 할 일은 없다.

---

## 11. 열린 질문과 확인 필요

### 11.1 한솔에게 물을 것

**구현 전에는 없다.** 알린 다섯 가지는 그대로 만든다. 그 가운데 코드로 만들 수 없는 것은 없었다. 알린 문장에서 한 발 벗어나는 곳은 하나다 — 숨긴 방의 높이 띠가 옆에서 본 작은 그림에는 남는다(4.4. 눈금이라 남겼고 11.3의 11로 알린다). 알린 문장의 '방'은 화면에서 '공간'이다(화면이 늘 그렇게 부른다 — 11.3의 4). 알린 것보다 넓어지거나 좁아지는 곳(J1~J14)은 이 설계의 답으로 정했고, 다른 답이 오면 고칠 곳을 1.2에 적었다. 엔진에서 본 뒤에 멈추고 물을 수 있는 것은 하나다: 박스가 **어느 대체안으로도 안을 가리지 못하거나 덩어리로 읽히지 않을 때**(11.2의 첫 두 줄) — 요청의 알맹이라 그것을 뺀 채 내지 않는다. 그때는 눈만 먼저 내고(4단계까지가 스스로 선다) 박스는 본 화면을 보이고 정한다.

### 11.2 앱 엔진에서 다르면

설계 중에는 코드를 읽고 순수 함수·장면·뷰포트를 Node에서 돌려 봤다(12절). **CSS와 React 쪽은 하나도 그려 보지 않았다.**

| 확인할 것 | 기대와 근거 | 앱에서 다르면 |
|---|---|---|
| 박스가 안과 뒤를 가리는지 (E4, B2) | 품긴 것은 그리지 않고(S-4·S-6), 뒤의 것은 불투명 재질의 깊이가 가린다(S-1) | **품긴 것이 보이면** 그 뿌리의 `visible`을 읽는다: 참이면 `held`에 들지 않은 것이다 — 그 노드가 정말 온전히 안인지(벽을 0.01이라도 넘었는지, 꼭대기가 뚜껑보다 높은지) 도면의 값으로 본다. 값이 안인데 참이면 `HOLD_SLACK`을 `1e-4`로 키운다(K-1의 경우들을 함께). **뒤의 것이 비치면** `depthWrite`·`transparent`를 본다(다른 재질이 붙었는지). **박스에 걸친 것**의 면에 붙은 부분이 비치는 것은 설계대로다(11.4). 그래도 안이 보이면 **게이트 C에서 멈추고 본 화면을 한솔에게 보인다** |
| 박스가 덩어리로 읽히는지 (E4, B12) | 5.1의 계산: 어두운 화면은 모서리의 선(면 위에서 2.4~2.7:1), 밝은 화면은 면의 밝기 차이(L\* 5.8·2.9·5.4) | 섞는 비율(0.35/0.6)과 `polygonOffset`은 이 둘을 바꾸지 못한다. **밝은 화면에서 밋밋하면** 닫힌 방의 외곽선만 강조색 그대로(불투명도 1)로 그린다 — `MaterialKey`에 `spaceSolidLine`(`line(palette.light ? palette.accent : palette.accentSub, 1)`)과 점선 짝 `spaceSolidDash`를 더해 `buildSpace`가 `shell`일 때 고른다(면 위에서 밝은 화면 2.2~3.3:1, 어두운 화면 4.5~5.5:1. 고른 밝은 박스 위에서는 1.5~2.2:1이라 선보다 진해진 면이 고름을 알린다). S-1의 외곽선 단언을 함께 고친다. **어두운 화면에서 면이 뭉개져 거슬리면** 같은 선을 쓰는 것으로 족하다(선이 4.5:1 이상이 된다). 땅·배경과 갈리지 않으면 밝은 화면에서만 비율을 올린다(`palette.light ? 0.5 : 0.35` — S-1의 색 글자를 함께) |
| 외곽선이 면과 다투지 않는지 (E4) | `polygonOffset` 1/1 | 깜빡이면 2/2로(S-1의 숫자를 함께). 걸쳐 겹친 높이가 같은 박스 둘의 뚜껑이 겹친 자리에서 일렁이는 것은 받아들인다(11.4) |
| 줄의 두 버튼이 한 줄에 놓이는지 (E1) | 줄이 flex이고 두 버튼의 크기를 모두 적었다 | 눈이 내려가거나 이름 버튼이 0이 되면 줄을 격자로: `.bmap-node-list li { display:grid; grid-template-columns:minmax(0,1fr) 28px; gap:2px; }`(두 버튼의 `flex` 선언을 뺀다). R2-5의 그 줄을 맞춘다 |
| 제목 줄의 높이가 '모두 보이기'로 달라지지 않는지 (E2 — 1440과 1100) | 버튼(11px × 1.4 = 15.4px)이 배지(21.5px)보다 낮고, 줄이 꺾이지 않는다: '오브젝트'(44.9px)와 버튼(54.3px)은 줄어들지 않고 배지가 말줄임으로 줄어든다(6.3) | **줄이 꺾였으면**(높이가 약 19px 는다) 6.3의 세 줄 가운데 빠진 것을 찾는다 — `strong`의 `flex-shrink:0`, 버튼의 `flex-shrink:0`·`nowrap`, 배지의 `min-width:0`·`overflow:hidden`. 배지가 줄지 않으면 `display:block`이 먹었는지 본다. **꺾이지 않았는데 높이가 다르면** 그 버튼에 `height:16px`를 주고, 그래도 다르면 제목 줄에 재어 본 높이를 `min-height`로 준다(숨긴 것이 없을 때의 높이와 같아야 한다). 배지를 `block`으로 바꾼 것만으로 높이가 달라졌으면(G1) 그 줄에 `line-height`를 재어 본 값으로 적는다 |
| 눈을 눌렀을 때 그 눈이 제자리인지 (E2) | 목록 위의 것(속성)은 선택이 바뀔 때만 바뀐다 | 고르지 않은 것의 눈인데 움직였으면 무엇이 밀었는지 찾는다(제목 줄이 가장 먼저다) |
| 닻과 칩의 자리, 바닥줄·도면이 그대로인지 (E2, E3) | 닻의 바깥 크기와 늘어난 틈의 합이 0이다(6.3) | 칩이 엉뚱한 곳에 있거나 안내 글의 폭이 달라지면: 칩을 흐름 안으로 옮긴다 — `.bmap-hidden-slot { flex:0 0 auto; margin-left:auto; }`, 칩의 `position`·`right`·`top`을 빼고, `.bmap-canvas-footer:has(.bmap-hidden-chip) .bmap-footer-hint`에 평면과 같은 두 줄 제한을 준다. **그때는 칩이 생길 때 안내 글이 한 줄 늘어 도면이 1px(평면) 달라질 수 있다 — 잰 값을 검증 기록과 완료 보고에 적는다.** R2-5의 닻 줄을 맞춘다 |
| 칩이 1440에서 안내 글을 덮지 않는지 (E3) | 빈 자리 231px 이상, 칩 117~130px(글꼴의 글자 폭으로 계산 — 4.3) | 덮이면 칩의 글자를 `숨김 M · 모두 보이기`로 줄인다(문구 한 곳 — 9절의 글과 4.3을 함께). 더 좁은 폭에서 덮이는 것은 설계대로다(J6) |
| 칩이 안내 글을 덮은 자리가 지저분하지 않은지 (E3, 1280·740·910) | 칩(26px)이 두 줄 안내(30px)의 가운데를 덮어 위아래 2px씩 글자 끝이 비칠 수 있다. 덮는 폭이 몇 px뿐인 폭(1280의 평면 편집, 740의 평면)에서는 안내 글의 마지막 글자가 말줄임표 없이 반쯤 잘려 보인다 | 거슬리면 칩에 바닥줄 색의 고리를 둘러 가린다: `box-shadow:0 0 0 3px color-mix(in srgb, rgb(var(--color-bg-card)) 40%, rgb(var(--color-bg-primary)))`(배치를 바꾸지 않는다). R2-5의 칩 줄을 맞춘다. **썼다(게이트 A, 2026-10-14)**: 1280의 평면 편집과 740의 3D 편집에서 안내 글의 마지막 글자 획이 칩 테두리에 닿아 깨진 것처럼 보였다 — 고리를 두르면 그 사이에 3px 틈이 생긴다. 6.3의 칩 줄과 앵커 71이 그 글자를 읽는다 |
| 칩과 숨긴 줄이 읽히는지 (E3, E5 — 두 화면) | 칩의 글자는 본문색(13.8:1 / 16.9:1), 숨긴 줄의 이름과 종류 글자는 `opacity:.7`(3.4:1 / 3.3:1 — 종류 글자는 제 흐림을 풀어 이름과 같다, 4.2) | 숨긴 줄이 그래도 흐리면 `.75`(3.7:1쯤)까지 올린다 — 고르지 않은 줄(5.7:1 / 6.6:1)과의 차이가 남아야 한다. R2-5의 그 줄을 맞춘다 |
| 박스 뒤의 이름이 박스 위에 겹쳐 보이는 것 (E4, B2) | 이름표는 깊이를 보지 않는다(map3dScene.ts:135-136) — 벽이 비치는 지금은 자연스럽고, 품긴 것을 골랐을 때 그 이름이 박스를 뚫고 보이는 것도 이 덕이다(5.3) | 한솔이 본 화면에서 거슬린다고 하면: **닫힌 방이 하나라도 그려지는 동안에는 고르지 않은 노드의 이름표가 깊이를 보게 한다** — `sync`의 노드 루프 끝(`this.place(entry)` 다음)에 `if (entry.label) entry.label.material.depthTest = boxes.length > 0 && !selected;`(고른 것의 이름은 지금처럼 뚫고 보인다. 박스가 없으면 지금 그대로다 — R2). 기즈모로 끄는 동안 잡힌 노드는 `selected`라 달라지지 않는다. S-6에 그 값을 읽는 단언을(이름표 대역이 필요하다 — `document`가 없는 Node에서는 이름표가 만들어지지 않는다, map3dScene.ts:111), R2-4에 그 줄을 더한다 |
| 흐려지는 줄의 전환 (E5) | 공용 버튼 규칙의 `opacity .15s`, 동작 줄이기에서는 없음 | 전환이 거슬리면 그 줄에 `transition:none`(동작 줄이기와 같아진다) |
| `sr-only`가 보이지 않는지 | 띠가 이미 쓴다(다-1에서 확인) | — |
| 닫힌 재질에서 three가 경고를 내는지 (G6) | 표준 옵션뿐이다 | 경고의 옵션을 뺀다 |
| 머지된 1차가 이 문서가 본 1차와 같은지 (0단계) | 2.8의 표. 이 문서는 1차의 설계로 쓰고, 머지 직전의 가지(`56cbc744`)에서 아래 여섯을 글자로 다시 봤다(줄 번호도 그 커밋의 것이다) | 머지된 main에서 여섯 가지를 글자로 본다: ① 보조 평면도 태그 `<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} />`(앵커 64의 첫째 단언), ② `MapPlanPreviewProps`의 줄(mapCanvas.ts — 앵커 64의 셋째 단언), ③ `const clearSelection`과 `const openView` 사이가 비어 있고 어느 조각도 그 사이를 읽지 않는지, ④ `swallowSecondClick`의 수(4), ⑤ 앵커의 마지막 번호(66)와 앵커 59의 이름 목록(넷), ⑥ `BackgroundMapPlanPreview.tsx`의 함수 머리 `export function BackgroundMapPlanPreview({ map, selectedId, onSelect, canEdit, scrub }: MapPlanPreviewProps) {`(앵커 64의 둘째 단언), `latest` 두 줄과 그리는 세 줄. 다른 것이 있으면 6.1·6.2·6.5의 그 줄을 실제 글자로 고쳐 쓰고 시작한다. 동작의 결정(1.2, 4절, 5절)은 바뀌지 않는다 |

### 11.3 한솔에게 알릴 것 · 완료 보고에 적을 것

알린 다섯 가지에서 달라지거나 넓어진 것부터 적는다(1~4). 나머지는 알린 것 안에서 정한 것이다. 아래는 알릴 것을 빠짐없이 적은 것이라 1·4·5·8이 길다 — **완료 보고에는 항목마다 1~3문장(상황 → 영향 → 결과)으로 줄여 옮긴다**.

1. **박스로 한 방 안에 온전히 들어 있는 것은 3D에서 그리지 않아요 — 보이지도 눌리지도 않아요**(J8). 뚜껑 높이까지 오는 계단이나 벽에 붙은 안쪽 방처럼 박스의 면에 딱 붙은 것이 박스 겉에 비치고 눌리던 것을 막으려는 거예요. 오브젝트 목록이나 옆의 작은 평면에서 고르면 그 하나만 이름이(편집 중이면 손잡이도) 박스를 뚫고 보여요. 벽에 걸쳐 박스 밖으로 나온 것은 그대로 보여요. **박스 안으로 화면을 밀어 넣으면 빈 방처럼 보여요 — 안의 것은 지워진 것이 아니라 3D에서만 그리지 않는 거예요.** 그래서 박스 스위치 아래에 "박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요."라고 늘 적어 뒀어요. '모든 공간을 박스로'를 누르면, 다른 방을 둘러싼 큰 방이 있는 도면에서는 큰 박스 하나만 남고 그 안의 방·카메라는 3D에서 보이지 않아요. 눈은 반대로 그 줄 하나만 숨겨요(방을 숨겨도 안의 것은 남아요 — 알린 그대로).
2. **숨긴 방은 새 기호를 받지 않아요**(J4). 숨긴 방의 자리에 기호를 놓으면 그 아래 보이는 방(없으면 땅)에 놓이고 거기에 속해요. 위층을 숨기고 아래층에 가구를 놓을 수 있어요. 방 하나뿐인 자리에서 그 방을 숨기고 놓으면 소속 없이 땅에 놓여요.
3. **눈과 박스 스위치는 편집하지 않을 때도, 편집 권한이 없는 계정에서도 들어요**(J12). 자기 화면만 바뀌고 도면은 그대로라서요. 화면을 팀에 열면 누구나 자기 화면에서 쓸 수 있어요. 끌고 있는 동안에는 듣지 않아요.
4. **박스 스위치는 3D에서 방을 골랐을 때만 속성에 나와요.** 평면에서는 켜도 달라지는 것이 없어서 두지 않았어요(J1). 3D에서 아무것도 고르지 않았을 때는 속성에 "공간을 고르면 속이 안 보이는 박스로 볼 수 있어요"라고 적혀 있어요(J2). 도로에는 없어요. 편집 중에는 '공간 종류' 아래에 있어요(그 칸에서 도로로 바꿀 때 누른 칸이 움직이지 않게요). **화면과 업데이트 내역의 글자는 '방'이 아니라 '공간'이에요** — 목록과 속성이 방을 늘 '공간'이라고 불러서 맞췄어요.
5. **고른 것을 숨기면 선택이 풀려요.** 속성 칸의 내용이 바뀌는 그때에만 0.5초 동안 클릭(과 Enter·Space로 누르는 버튼)이 듣지 않아요 — 목록이 움직여 더블클릭이 엉뚱한 것을 누르지 않게 하려는 거예요(J10). 여러 개를 골라 둔 채 하나씩 숨길 때는, 고른 것이 둘 이상 남아 있는 동안에는 잇달아 눌러도 다 들어요. **3D에서 손에 들고 있던 것은 다른 것을 숨겨도 손에 남아요**(J13): 평면에서 둘을 골라 둔 채 3D에서 다른 카메라의 시점을 보다가 그 둘 가운데 하나를 숨겨도 카메라 시점이 이어져요. 대신 그때는 평면에서 골라 둔 나머지 하나가 풀리고, 평면으로 돌아가면 그 카메라가 골라져 있어요.
6. **기호 도구를 들고 있는 동안에는 모든 방이(저장하는 사이에도), '이 카메라 시점으로 보기'에서는 그 카메라가 선 방이 잠깐 비쳐 보여요**(J9). 벽 선 위나 천장 높이에 딱 맞춰 세운 카메라도 그 방 안에 있는 것으로 쳐요(박스로 한 방에서는 3D에 그리지 않고, 그 카메라 시점으로 보면 방이 열려요). 기호 도구를 든 채 박스를 켜면 도구를 내려놓은 뒤에 박스가 돼요(속성에 그렇게 적혀 있어요).
7. **'맞춤'과 아래 이미지 목록은 숨긴 것까지 넣어요**(J5). 카메라 시점 미리보기에는 숨긴 것이 나오지 않아요. 끌 때 숨긴 것에는 달라붙지 않아요(스냅).
8. **기억은 이 PC의 내 계정에, 도면 100개까지예요**(J11). 다른 PC에서는 다시 눌러야 해요. **숨긴 채 저장해도 숨긴 것은 그대로 저장돼요.** 그것을 화면이 늘 말하게 했어요(J14 — 알린 것에 없던 한 줄이에요): 오브젝트 목록 아래에 "숨긴 것은 이 PC의 내 화면에서만 안 보여요. 도면에는 그대로 있어서, 저장해도 지워지지 않아요."가 늘 적혀 있고, '모두 보이기'와 도면 아래의 '숨김 N개'에 마우스를 올려도 같은 글이 나와요. 눈에 올리면 "숨기기 · 이 PC에서만 안 보여요"예요.
9. **박스의 색은 쓰고 있는 테마 색에서 만들어요**(J7). 어두운 화면에서는 모서리 선으로, 밝은 화면에서는 면의 밝기 차이로 한 덩어리로 읽혀요. 본 화면을 함께 보여 드려요.
10. **창이 좁으면 '숨김 N개 · 모두 보이기'가 도면 아래 안내 글의 끝을 덮을 수 있어요**(J6). 안내 글의 보이는 부분에 마우스를 올리면 전체가 나와요(평면과 3D 모두).
11. **숨긴 방에 속한 카메라를 고르면 옆에서 본 작은 그림에는 그 방의 높이 띠가 그대로 나와요.** 방을 그린 것이 아니라 카메라 높이를 재는 눈금이라 남겨 뒀어요.
12. **숨긴 것을 되돌리기(Ctrl+Z)로 없앴다가 다시 실행으로 되살리면 숨긴 채로 돌아와요**(박스로 본 방은 박스로요). 그 사이에 '모두 보이기'(박스는 '모두 비치게')를 눌렀을 때만 보이는 채로 돌아와요.
13. **박스 뒤에 서 있는 카메라나 공간의 이름은 박스 위에 겹쳐 보여요.** 이름은 원래 무엇이든 뚫고 보이게 그려 왔어요(벽이 비칠 때는 그게 자연스러웠어요). 본체는 박스에 가려지고 거기서는 눌리지 않아요. 본 화면을 함께 보여 드리고, 거슬리면 박스가 있는 동안에는 이름도 가려지게 바꿀 수 있어요(11.2).
14. **목록 제목의 수는 숨긴 수를 앞에 적어요**('숨김 2 · 8개'). 속성 칸이 좁아 다 못 적을 때 숨긴 수가 아니라 전체 수가 잘리게 하려는 거예요.
15. 엔진에서 대체안을 쓴 곳이 있으면 그 줄(11.2)과 잰 값.

### 11.4 알고 넘어가는 것

- **칩이 안내 글을 덮는 폭**(J6). 빈 자리가 칩과 틈 10px보다 적을 때다. 글꼴(Pretendard)의 글자 폭으로 계산했다 — 칩 117px(숨김 1개)·123px(12개)·130px(100개), 확대 버튼들 171px(편집 중)·128px(보기), 안내 글 한 줄의 폭은 평면 편집 277px(묶음일 때 323px), 3D 편집 407~427px, 3D 보기 356px. 배치는 앱 사이드바 64px/192px, 본문 여백 32px, 트리와 속성 칸의 폭으로 셌고, 아래는 숨김 12개일 때다(E3에서 재어 견준다). **1,440**: 어느 상태에서도 덮지 않는다. **1,280(사이드바 펼침)**: 평면 편집 약 6px(묶음일 때 약 52px), 3D는 덮지 않는다. **1,100(펼침)**: 평면 편집 약 8px(1,200 이하에서는 평면의 안내 글이 180px 폭의 두 줄이다 — backgrounds-map.css:218), 3D 편집 약 73px. **901~925 — 도면이 가장 좁다**(속성 칸이 아직 옆에 서 있다): 접으면 평면 약 79px(901) · 70px(910). **펼치면 도면이 302px(901) · 311px(910)이라 칩이 안내 글 전부를 덮고, 칩의 왼쪽이 도면 영역 밖으로 나가 약 15px(901) · 6px(910) 잘린다**(창 폭 901~925쯤에서 사이드바를 펼친 때만. 글자 '숨김'의 앞머리가 잘릴 뿐 누르는 데는 지장이 없고, 그때도 목록 제목의 '모두 보이기'가 있다). **740**(속성 칸이 도면 아래로 내려가 도면이 넓어진다): 접으면 평면 편집은 닿을락 말락(0~2px)·3D 편집 약 65px·3D 보기는 덮지 않고, 펼치면 칩이 안내 글 위에 통째로 놓이되 잘리지 않는다. 덮인 채로도 칩은 온전히 눌리고, 안내 글 전체는 `title`에 있다(4.3).
- **속성 칸이 바뀌는 숨기기 뒤 0.5초 안의 다음 누름은 버려진다**(고른 하나를 숨겼을 때, 묶음이 하나로 줄었을 때, 3D에서 손에 든 것이 놓이거나 바뀌었을 때). 마우스의 누름과 Enter·Space로 누르는 버튼이 그렇고, 편집기의 단축키는 듣는다. 속성 칸이 그대로인 숨기기 뒤에는 쉬지 않는다. 그 "그대로"는 내용으로 본 것이다: 묶음의 종류 줄('공간 2 · 기호 1 …')이 한 종류 줄어 두 줄에서 한 줄이 되면(좁은 속성 칸에서 드물게) 목록이 한 줄만큼 움직이는데 그때는 쉬지 않는다.
- **3D에서 묶음이 하나만 남을 때, 손에 든 것과 묶음의 남은 하나를 둘 다 둘 수는 없다**(J13 — 하나만 고른 선택은 평면과 3D가 함께 쓴다). 묶음 밖의 것을 손에 들고 있었으면 그것이 남고 **묶음의 남은 하나가 말없이 풀린다** — 3D의 목록은 손에 든 것만 표시하므로 그 차이는 평면으로 돌아가야 보인다. 손에 든 것이 없었으면 남은 하나가 손에 들린다(누르지 않은 것의 폼이 나온다).
- **평면에서 묶음 밖의 것(3D에서 손에 들었던 것)을 숨기면** 손에 든 것이 묶음의 대표로 돌아간다(평면에서는 보이지 않는 차이다).
- **숨기기가 선택을 적을 때, 그때 도면에 없는 노드의 id는 적어 둔 선택에서도 떨어진다**(Shift+클릭이 지금 그렇게 한다 — :950-952). 되돌리기로 없어졌던 그 노드가 돌아와도 선택되어 있지 않다.
- `select()`는 누르기 전 렌더의 선택을 본다(3D의 숨기기 길에서 `pick-one`인지 가르는 데 쓴다). 눈을 누르는 그 이벤트 안에서 선택을 먼저 바꾸는 것은 없다.
- **선택 상자의 미리 표시**(:265)와 **더블클릭의 더미**(:969)는 전체 도면을 읽는다. 숨긴 id가 섞여도 그려지는 것도 고르는 것도 없다.
- **박스에 걸친 것은 그려진다**(온전히 안에 있지 않은 것 — 벽을 가로지른 사물, 박스보다 키가 큰 안쪽 방, 걸쳐 겹친 방). 박스 안쪽 부분은 깊이 검사로 가려지되, **박스의 면과 한 평면인 부분은 비친다**(뚜껑 높이에서 걸친 계단의 윗단, 아래에서 볼 때 바닥에 닿은 다리). 밖으로 나와 있는 것이 보이는 채라 안을 드러내지는 않는다.
- **품는지는 가운데와 꼭짓점으로 본다.** 오목한(ㄱ자) 박스에서 꼭짓점은 모두 안인데 변이 파인 곳을 가로지르는 사물은 품긴 것으로 세어, 파인 곳에 나와 있는 부분까지 그려지지 않는다. 기울인 사물의 꼭대기는 기울이지 않은 키로 센다. **카메라는 서 있는 점으로 본다**: 벽 선 위와 뚜껑 높이는 안이다(그 카메라는 박스에 반쯤 묻혀 그려지는 대신 그려지지 않고, 그 시점으로 보면 방이 열린다). 벽 선에서 백만분의 일 밖까지를 선 위로 치며, 45°보다 뾰족한 꼭짓점에 정확히 선 카메라는 밖으로 읽힐 수 있다(여덟 방향 가운데 그 안쪽을 가리키는 것이 없을 때 — 그때는 지금까지처럼 그려진다).
- **고른 것은 박스가 품었어도 그려진다**: 본체는 가려지고, 면과 한 평면인 부분과 박스 밖으로 나가는 카메라의 시야 선은 보인다. 고른 카메라의 클릭 대상(반지름 20의 보이지 않는 공)이 벽 가까이에서는 벽 밖으로 나온다.
- **걸쳐 겹친 높이가 같은 박스 둘**은 겹친 자리의 두 뚜껑이 한 면이라 일렁일 수 있다. 누르면 작은 것이 골라진다. (한쪽이 다른 쪽에 온전히 들면 안의 것은 그려지지 않고, 윤곽과 높이가 같은 두 박스는 도면에서 앞의 것만 그려진다 — 일렁이지 않는다.)
- **박스 안으로 둘러보기 카메라가 들어가면** 안쪽 벽이 막혀 보이고 안은 비어 보인다(품긴 것은 그리지 않는다 — 11.3의 1로 알린다).
- **박스 뒤에 선 것의 이름은 박스 위에 겹쳐 보인다**(5.3). 이름표가 깊이를 보지 않아서다. 본체는 가려지고 거기서는 눌리지 않는다. 11.3의 13으로 알리고, 대체안은 11.2에 있다.
- **평면에는 그 방이 3D에서 박스라는 표시가 없다.** 박스가 품어 3D에 없는 것도 평면·보조 평면도·목록에는 그대로 있고, **그 줄은 목록에서 여느 줄과 같다**(뜬 눈). 3D에 없다는 것과 닿는 길은 박스 구역의 글이 말한다(5.5) — 줄마다 표시하지는 않는다.
- **없어진 노드의 id는 목록에 남는다**(3절). 되살아난 노드는 숨긴 채(박스인 채)로 돌아오고, 수와 칩이 그것을 알려 준다. 영영 돌아오지 않는 노드(버린 초안의 것, 다른 PC에서 지운 것)의 id도 남는다 — '모두 보이기'·'모두 비치게'를 누르거나 그 목록이 1000개에 찰 때까지다. 읽을 때 해가 없고 id 하나가 39자다. 죽은 숨김만 남은 도면에는 칩도 제목의 버튼도 없다(셀 것이 없다). 지운 도면의 설정은 100개 한도에 밀릴 때까지 남는다(읽히지 않는다). 저장소가 가득 차면 화면이 열려 있는 동안만 기억한다(말없이).
- **기호를 놓을 때 숨긴 방은 없는 것으로 친다**(J4). 숨긴 방 하나뿐인 자리에 놓은 기호는 소속이 없고 땅 높이다 — 방을 다시 보이면 그 방의 바닥이 아니라 땅에 서 있다(높이 뜬 방이면 그 아래에). 새 카메라의 소속은 숨김과 무관하게 정해진 자리의 방이다.
- **옆에서 본 그림의 방 띠는 숨김을 따르지 않는다**(4.4). 숨긴 방에 속한 카메라를 고르면 그 방의 높이 띠가 나온다.
- **눈과 박스는 보기 모드와 편집 권한이 없는 계정에서도 듣는다**(J12). 화면이 팀에 열리면 "내 화면에서만 숨겼다"는 것을 목록 아래의 글과 박스의 안내 글이 말한다(J14). 속성 칸을 접으면 그 글은 보이지 않고 칩의 `title`만 남는다.
- **숨긴 구성원**도 공간을 따라 움직이고, 공간을 지우면 연결이 풀린다 — 숨김은 도면의 관계를 바꾸지 않는다.
- 3차와 "이 PC에 보관"이 초안의 수명을 바꿔도 보기 설정은 이 열쇠에 남는다. 그 보관소가 계정별 파일로 가도 옮기지 않는다(마지막 한 번의 누름을 잃어도 해가 없는 값이다).

---

## 12. 설계 때 돌려 본 것

저장소 밖 임시 폴더에서, 저장소의 모듈을 읽기만 하며(고친 사본은 임시 폴더에만 두었다) Node로 돌렸다. 세 번 돌렸다 — 첫 판을 쓸 때와, 검토를 받아 고칠 때 두 번. 표에서 **[지금 코드]**라 적은 것은 이 문서에 실린 코드 그대로 돌린 것이고, **[앞선 판]**이라 적은 것은 그 뒤에 글자가 바뀐 코드(`withIds`, `selectionWithout`, `spaceHoldsNode`의 카메라, 뷰포트의 `syncScene`)가 바뀌기 전에 돌린 것이다 — 그 경우들이 지나는 줄은 지금도 같은 값을 낸다. 그 폴더들은 스크래치패드에서 치웠다 — 돌려 본 경우는 7절의 표에 있고, 돌려 본 코드(저장소 모듈, `spaceHoldsNode`·`nodesHeldBy`, 장면과 뷰포트의 고친 줄)는 3절·5.1·5.2·5.4에 그대로 옮겨 적었다(줄마다 견줘 봤다). 4.5의 핸들러는 React 코드로 돌리지 않았다(그 차례를 옮긴 함수로 돌렸다). **[1차 구현 뒤]**라 적은 것은 1차가 구현된 뒤 그 코드(`56cbc744`)에 대고 다시 본 것이다.

| 돌려 본 것 | 결과 |
|---|---|
| **[지금 코드]** `mapViewPrefs.ts`(3절, 모듈 전체) — 왕복·계정·쓰레기(두 목록을 따로 읽는 것까지)·한도(찬 목록이 죽은 id를 버리는 것까지)·같은 객체(두 방향)·죽은 id가 남는 것과 목록을 비우면 함께 비는 것·새것이 뒤·박스는 공간만·`shownMap`(방만 숨김)·하나뿐인 빈 값. 저장소의 설정(`strict`·`isolatedModules`·`allowImportingTsExtensions`)으로 typecheck | 통과(V-1~V-11, V-14), 진단 0. 크기: 40개 노드 3,197자, 1000개 노드 78,077자 |
| **[지금 코드]** 숨기기의 선택 규칙 — 4.5의 차례를 실제 `createMapDocumentStore`·`pickAction`·`singleViewId`에 스물네 경우(평면 여덟, 3D 열다섯, 다시 늘어나는 묶음). 경우마다 선택·손에 든 것·`changed`·`moved`와, 숨긴 id가 적어 둔 고름에 남지 않는지, `moved`가 문서 상태로 따로 계산한 "속성 칸에 보이는 것이 달라졌나"와 같은지 | 통과(V-12의 표가 그 결과다). "다시 늘어나는 묶음"은 고치기 전의 물음으로는 숨긴 것이 손에 들린다는 것까지 같은 실행에서 보았다 |
| **[앞선 판]** 평면의 질문 — 실제 `planPileAt`·`resolvePlanPress`·`planMarqueeIds`·`planGestureCandidates`·`previewPlanGesture`·`nextPlanSelection`·`validateBackgroundEntity`, 그리고 한 윤곽의 두 층에서 `spacesAt(전체)[0]`은 위층·`spacesAt(shownMap(…))[0]`은 아래층 | 통과(V-13 — `shownMap`과 그 순수 모듈들은 그대로다) |
| **[지금 코드]** 품는가 — 5.1의 두 함수(typecheck 진단 0): 카메라의 높이(바닥·꼭대기 포함), **벽 선 위와 모서리의 카메라**(사각형과 `rectToPolygon`, 0°·17°·45°·90°·213° — 열 가지 방 × 열다섯 자리), ㄱ자 방의 파인 벽, 둥근 방, 원점에서 먼 방. 공간·기호: 둘러싼 방, 모서리에 붙은 방(열 가지 박스), 벽을 넘은 것·더 높은 것·더 낮은 것, 도로, 기본 계단, 걸친 탁자, 지붕 위, 걸쳐 겹친 방, 둥근 박스, 꼭 같은 두 박스. **[앞선 판]** 기울인 탁자, ㄱ자 박스의 파인 곳에 든 방, 박스와 꼭 같은 자리의 비치는 방 | 통과(K-1, K-2). 카메라를 점 그대로 묻던 줄은 다각형 방의 오른쪽·아래쪽 벽에서, 꼭대기를 밖으로 치던 줄은 뚜껑 높이에서 떨어진다(같은 테스트에 넣어 봤다). 대각선 넷만으로 45° 다각형 방의 모서리를 놓치는지는 방이 놓인 자리에 달렸다 — 표의 마지막 줄 |
| **[지금 코드]** 장면 — `map3dScene.ts`의 사본에 5.1·5.2의 줄을 그대로 넣고(`NO_IDS`의 선언까지 — 없으면 돌지 않는다) 실제 three.js(0.186.1)로: 닫힌 방의 자식과 재질·두 팔레트의 색, **들여다보는 카메라가 안·네 벽 선 위·모서리·뚜껑 높이에 섰을 때 방이 열리고 품었던 의자가 그려지는 것**(아홉 자리 × 사각형·다각형), 박스 뒤의 카메라로 가는 광선이 닫힌 면에서 잘리는 것. **[앞선 판]** 숨김, 누르기의 나머지, 면과 한 평면인 것(기본 계단의 윗단을 내리쏜 광선이 닫기 전에는 계단을, 닫은 뒤에는 방을 고르고, 계단의 메시를 대상에 넣으면 `visibleMapHits`를 지나고도 계단이 골라진다는 것까지), 품긴 것과 둘러싼 것 | 통과(S-1~S-6). 색 `37336a`·`4b439a`·`ccc6f7`·`a79df1` |
| **[지금 코드]** 뷰포트 — `BackgroundMap3D.tsx`의 사본에 5.2·5.4의 줄을 넣고(`syncScene`에 `placing` 없음), 저장소의 뷰포트 대역을 옮긴 것(esbuild 묶음 + 렌더러 대역, 장면은 위의 사본)으로: `sync`를 세는 것, 박스 뒤의 카메라 자리를 누르면 박스, **`placing`과 빈 묶음을 함께 주면 열리고 바닥 좌표를 알리는 것, 저장처럼 `placing`·`canEdit`만 꺼졌다 켜질 때 박스가 닫히지 않고 `sync`가 돌지 않는 것**. **[앞선 판]** 숨긴 것의 클릭과 기즈모, 카메라 시점, 기즈모로 박스 끌기(셋 다 `placing`을 쓰지 않는다) | 통과(W-1~W-5) |
| **[앞선 판]** 기존 `tests/backgroundMap3dScene.test.ts` 74개를 고친 장면·뷰포트에, `tests/backgroundMapStack.test.ts` 27개를 고친 `mapStack.ts`에 | **모두 통과**(고친 것은 대역의 타입 한 줄). 그 뒤에 바뀐 줄은 박스가 없으면 지나지 않거나(`boxes`가 비면 `spaceHoldsNode`를 부르지 않는다) 같은 값을 낸다(props가 없으면 `solidIds`는 어느 쪽이든 빈 묶음이다). 수는 다시 셌다(74·27) |
| 뮤테이션 — **[앞선 판]** 6.5의 (6)~(11)·(13)·(14)·(16)~(21)·(23)~(26)((24)는 `shownMap`과 장면에 한 번씩)과 그 밖의 일곱(`this.last`에서 `solidIds`를 뺌, 꼭대기를 묻지 않음, 도면에서 앞에 있는 비치는 쌍둥이, `moved`를 손에 든 것만으로, 평면의 묶음을 3D처럼, 숨긴 노드의 기즈모, 렌더마다 `sync`). **[지금 코드]** 스물다섯: 저장소 열((13)·(21)·(22)·(25)·(26)·(31)·(32)와, J13을 평면에서도 듣게·차지 않은 목록에서도 죽은 id를 버림·한쪽 목록이 배열이 아니면 항목을 버림), 품기 여덟((17)~(19)·(28)·(29)의 둘·(30)과, 카메라에 벽의 키를 줌), 장면 여섯((9)·(10)·(16)과, 고치기 전의 카메라 줄 둘, `this.last`에서 `solidIds`를 뺌), 뷰포트 하나((6)) | 모두 잡혔다. 첫 판에서 살아남은 하나("`cast`가 자르지 않음")는 W-3에 박스 뒤의 카메라를 누르는 경우를 더해 잡았다 |
| **[지금 코드]** 글자 폭 — 저장소의 Pretendard(`node_modules/pretendard`의 otf, Regular와 Bold)를 `opentype.js`로 읽어 제목 줄·배지·칩의 폭 | '오브젝트' 44.9px, '모두 보이기' 54.3px, 배지 60.4 / 72.4 / 82.6px, 칩 116.7 / 123.2 / 129.8px(4.2·4.3·11.4). 안내 글·확대 버튼들의 폭과 빈 자리는 **[앞선 판]**의 값이고, 11.4의 덮는 폭은 거기에 이 칩 폭을 넣은 것이다. 엔진의 실제 폭은 E2·E3에서 잰다 |
| **[지금 코드]** 색 — 닫힌 면의 색을 장면의 빛(주변광 2.2 + 해 1.5)으로 선형 공간에서 계산(여섯 테마 × 두 화면), 숨긴 줄의 이름·종류 글자의 대비 | 5.1의 표와 같다(뚜껑 1.10, 벽 0.92·0.84, 그늘 0.70배). 뚜껑과 땅이 가장 덜 갈리는 조합은 에메랄드의 밝은 화면이다(`#b3f1dc` / `#fdfeff`, 1.26:1 — B12). 숨긴 줄: 이름 .7은 3.40:1 / 3.31:1, 종류 글자 .525는 2.44:1 / 2.33:1(4.2). 외곽선·칩의 대비는 **[앞선 판]**의 값이다. 엔진에서의 모습은 E3~E5 |
| **[앞선 판]** `npm run test:background`(42584da6, 고치지 않은 저장소) | 582개: 577 통과, 5 건너뜀 |
| 이 문서가 인용한 파일:줄과 "몇 번 나온다"고 적은 글자의 수 — 첫 판의 198곳은 스크립트로, 고치며 더한 곳은 그 줄을 읽어 저장소(42584da6)와 대조 | 모두 일치 |
| 1차의 설계 문서(작업 폴더, 커밋 전) — 3.2·4.3·4.6·6절·8절 | 읽었다. 2.8·6.1·6.2·6.5·9절에 맞췄다(앵커 64의 태그, 52의 수, 59의 목록, 새 번호 67~72, 문서의 자리) |
| **[1차 구현 뒤]** 1차의 가지 끝 `56cbc744`에서: 1차가 고친 파일을 가리킨 줄을 `42584da6`에서 `git diff -U0`의 덩어리로 옮겨 그 줄의 글자를 대조, 앵커 52·64의 단언, `npm run test:background`. 5.1의 카메라 줄을 실제 `containsPoint`·`rectToPolygon`에 — K-1의 400×300 방을 여러 자리에 놓고 | 줄은 이 문서에 고쳐 적었다(인용한 글자는 모두 그대로 있다). 앵커 52는 이미 넷을 세고(2.8), 64는 2차가 바꾸는 보조 평면도의 세 줄을 글자로 고정한다(6.5). 619개: 614 통과, 5 건너뜀. 대각선 넷만으로는 (0, 0)에 둔 방의 45° 다각형 모서리 하나를 놓치지만 (300, 200)에 둔 방에서는 넷 다 잡는다 — 그래서 K-1이 자리를 (0, 0)으로 정한다(크기와 자리를 뽑은 140개 가운데 93개에서 놓친다). 가로세로 넷만으로는 돌리지 않은 다각형 방의 모서리를 140개 모두에서 놓친다. 여덟 방향은 (0, 0)의 열 가지 방에서 벽 위와 모서리를 모두 잡고, 벽에서 0.5·모서리에서 0.4 밖은 잡지 않는다 |

돌려 보지 못한 것: 편집기(React)의 핸들러와 마크업, CSS 전부, 앱 엔진에서의 모습(박스의 색과 깊이, 줄의 배치, 닻과 칩), 그리고 **머지된 1차**(1차의 코드는 머지 직전의 가지 `56cbc744`에서 다시 봤다 — 위 표의 마지막 줄. 머지 때 달라지는 줄 번호·앵커의 글자·테스트의 수). 앞의 셋은 8절과 11.2가, 마지막은 0단계가 맡는다.
