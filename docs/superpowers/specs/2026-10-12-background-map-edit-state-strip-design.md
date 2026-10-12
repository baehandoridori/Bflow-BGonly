# 배경 도면 다-1 편집 상태 띠 — 설계 (2026-10-12)

> 요청(한솔, 2026-10-10, 추가 요청 G2 — 말 그대로): "공간 편집 및 저장 버튼을 좀더 사용자친화적으로. 현재는 우상단에 떠있고, 편집 모드인지 일반 모드인지 제대로 안 나와서 편집 버튼 누르고 옮기고서 저장 안 하는 경우 빈번함."
> 방향(한솔, 2026-10-10): 직접 저장은 그대로 두고 편집 표시를 뚜렷하게 + 저장 안 한 내용은 이 PC에 보관. **두 번에 나눠 낸다(표시 먼저, 보관 다음).** 자동 저장은 넣지 않는다.
> 시안(2026-10-11, 전후 그림으로 보임)과 답(한솔, 2026-10-12, 말 그대로): **"저장한 뒤에 편집을 계속, 띠의 색은 테마 색상과 대비되는 색상으로."**
> 버전: v1.135.0 · **운영 DB·IPC·저장 모양 변경 없음**(화면 쪽 코드와 CSS뿐이다) · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: 브랜치 `claude/bg-map-edit-state-strip` (= main v1.134.0, 6731305a). 아래 줄 번호는 이 커밋에서 직접 확인했다.
> 바탕: 추가 요청 계획 `docs/superpowers/plans/2026-10-10-feedback-additions.md`의 G2 절(:143-153), 묶음 B3a(:62-66), 6절의 G2 보완 다섯 항목(:240-260)과 크기 항목(:286)을 읽고 지금 코드와 다시 맞췄다(2.8). ①~③의 설계(`docs/superpowers/specs/2026-10-08-*`, `2026-10-09-*`)가 정한 동작 위에 쌓는다.

이 문서는 **1차(보이는 상태)만** 다룬다. 2차(화면을 떠나거나 앱을 꺼도 남는 초안, 사이드바·탭의 점, "다른 곳에서 바뀜" 알림, 모두 저장, 권한을 잃은 초안)는 범위 밖이고, 1차가 2차를 막지 않도록 붙을 자리만 적는다(10.4).

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다.** 시안과 두 답이 한 가지로 정하지 않는 곳은 이 설계의 답으로 정했고, 완료 보고에 적는다(15.3). 앱 엔진에서 보았을 때 시안에 보인 것이 그대로 되지 않으면 **멈추고 묻는** 곳이 둘 있다(15.2: 띠가 화면을 따라오지 않을 때, 테두리가 도면 안의 같은 색상 표시 — 청록 테마의 기호와 청록 카메라, 호박 테마의 카메라와 3D의 카메라 시점 표시 — 와 섞여 보일 때) — 보인 것을 한솔 없이 빼지 않는다.

용어: **띠** = 편집 중에 도면 위에 늘 보이는 한 줄(`.bmap-edit-strip`). **테두리** = 편집 중에 도면 작업 영역 둘레에 그리는 2px 선. **초안** = `mapDocument.ts`가 들고 있는 편집 중인 도면 값(`MapDraft`). **편집 중** = 지금 보는 도면에 초안이 있고 편집 권한이 있다(`editing`, :265). `canEdit`(:266)은 거기에 "저장이 돌고 있지 않다"를 더한 것이다 — 이 문서는 둘을 가려 쓴다. **바뀜** = 초안에 저장하지 않은 편집이 있다(`mapDraftChanged`). **깨끗한 초안** = 바뀜이 아닌 초안. **다시 놓기** = 저장한 도면에서 깨끗한 초안을 새로 만들어 그 자리에 놓는 것(새 액션 `rebase-drafts`). **따라가기** = 깨끗한 초안이 라이브러리의 더 새 도면을 따라가는 것, 그리고 라이브러리에서 없어진 도면의 깨끗한 초안이 함께 없어지는 것(새 액션 `follow-saved`). **테마의 두 색** = 강조색(`--color-accent`, 설정의 '메인 액센트')과 보조 강조색(`--color-accent-sub`, '서브 액센트'). **저장소** = `useBackgroundStore`. **스크롤 상자** = 도면 탭의 `.bg-tab-content`.

테마 프리셋은 **화면에 보이는 이름**으로 적는다(설정 › 색상 테마의 카드, `src/themes.ts:27-108`): 바이올렛 드림(Violet Dream) · 공산당 레드(Cinema Red) · 윤성원 블루(Midnight Blue) · 에메랄드(Emerald) · 똥파리 골드(Amber Gold) · 이혜민 머쉬룸.

---

## 1. 목표와 범위

### 1.1 만드는 것

**시안 그대로(2026-10-11에 보인 것)**

- 편집 중에는 도면 작업 영역 둘레에 색 테두리가 생기고, 그 위에 늘 보이는 **띠**가 생긴다. 띠에는 '편집 중'과 '저장 안 한 변경 N개', 작은 'Ctrl+S' 표시, 버튼 둘('편집 끝내기', '도면 저장')이 있다. 평면과 3D에서 같은 자리이고, 화면을 내려도 따라온다.
- 보기만 할 때는 지금의 보라색 '공간 편집' 자리에 **조용한(테두리만 있는) '편집 시작' 버튼 하나**가 있다. 저장 버튼과 헷갈리지 않는다.
- 바꾼 것이 없으면 '편집 끝내기'는 "버릴까요?"를 묻지 않고 바로 끝난다. 저장 안 한 변경이 있으면 지금처럼 묻는다.
- '도면 저장'은 저장할 것이 있을 때만 켜진다.
- Ctrl+S로 저장한다. 저장하면 "도면을 저장했어요"라고 잠깐 알려 준다.

**한솔의 두 답**

1. **저장한 뒤에도 편집 중이다.** 지금은 저장하면 편집이 끝난다. 저장 전의 되돌리기 기록은 지금처럼 비워진다(한솔에게 알린 대로). 띠는 "저장 안 한 변경이 없다"는 상태를 보이고, 저장 버튼은 다음 변경까지 조용해진다.
2. **띠의 색은 테마 색과 대비되는 색이다.** **테마의 두 색**(강조색과 보조 강조색)에서 계산해 낸다 — 직접 고르는 테마는 두 색을 따로 고르고, 이 편집기가 선을 그리는 색은 대부분 보조 강조색이다(2.7). 여섯 프리셋과 직접 고른 두 색, 어두운·밝은 화면 모두에서 그 두 색과도 바탕과도 갈리고 글자가 읽힌다.

**시안과 두 답이 한 가지로 정하지 않는 곳 — 묻지 않고 정한 것.** 다른 답이 오면 고칠 곳을 적어 둔다.

| # | 정하지 않은 곳 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| I1 | 'N개'가 무엇의 수인가 | **끝난 편집의 수**(되돌리기 한 단계 = 1). 끌기 한 번, 칸 하나에 친 값, 공간 하나 그리기(첫 이름 포함), 묶음 지우기가 각각 1이다. 되돌리면 줄고 다시 실행하면 는다. 되돌리기 기록의 한계(50)를 넘어도 정확하다(3.2) | 숫자를 빼려면 `mapEditStatus`의 문구 한 줄만 고친다('저장 안 한 변경이 있어요') |
| I2 | 저장 뒤의 띠, 그리고 띠의 상태를 한눈에 가르는 법 | 깨끗함은 **"저장된 그대로예요"**(방금 편집을 시작한 때, 저장한 지 4초가 지난 때, 모두 되돌린 때가 같은 문구다 — 셋 다 참이다), 바뀜은 글자가 **채워진 알약 모양** 안에 든 "저장 안 한 변경 N개", 방금 저장함은 굵은 **"✓ 도면을 저장했어요"** 4초. 답 1로 띠가 늘 떠 있게 되므로 "띠가 있다"는 것만으로는 아무것도 알리지 못한다 — 세 상태가 문장의 꼬리가 아니라 **모양**으로 갈려야 한다(색과 움직임에 기대지 않는다, 3.3·6.8) | 문구는 `mapEditStatus`의 글자, 모양은 `data-phase` 규칙 세 줄 |
| I3 | "저장한 뒤에 편집을 계속"이 닿는 범위 | **저장은 저장한 도면의 편집을 끝내지 않는다 — 어느 저장 길에서든.** '도면 저장'·Ctrl+S뿐 아니라 '도면 설정 → 설정 저장', '기존 도면 연결'·'연결 해제', '내부 도면 만들기'가 함께 저장한 초안도 편집 중으로 남는다. **사용자가 편집을 끝내는 길은 '편집 끝내기' 하나다.** 이 규칙이 화면에서 달리 보이는 곳이 둘 있고, 둘 다 지금 동작 그대로 두어 완료 보고에 적는다(15.3): ① '기존 도면 연결'의 '연결하고 열기'는 저장한 뒤 **다른 도면으로 옮겨 간다** — 옮겨 간 도면이 편집 중이 아니었으면 띠가 사라진다(저장한 원래 도면은 편집 중으로 남아 있다. 띠는 지금 보는 도면의 것이다, 4.3·5.3). ② 응답을 잃은 '도면 만들기'를 다시 누르는 드문 복구 길은 저장한 부모 도면의 편집을 끝낸다(4.3 — 저장을 하고도 그 도면의 편집이 끝나는 하나뿐인 길이다). 그 밖에 편집이 끝나는 것은 도면이 없어질 때(이 화면에서 지웠거나, 다른 곳에서 지워졌거나)뿐이다(4.4) | "'도면 저장'만"이면 `persistMaps`의 다시 놓기를 `saveMap`으로 옮기고 나머지 셋은 `doc.discard`로 돌린다 — 그러면 '설정 저장' 뒤에 띠가 사라진다 |
| I4 | 저장 뒤 오래 편집 중인 채로 둔 화면 | 깨끗한 초안은 **다른 PC가 그 도면을 저장하면 조용히 따라가고, 그 도면을 지웠으면 함께 없어진다**(4.4 — 저장이 도는 동안과 편집기의 창이 열려 있는 동안에는 하지 않는다). 지금은 저장하면 편집이 끝나 화면이 라이브러리를 따라가는데, 답 1로 그 길이 없어지기 때문이다. 저장 안 한 편집이 있는 초안은 건드리지 않는다(그때의 알림은 2차) | 빼려면 `follow-saved` 액션과 effect를 뺀다 — 그러면 저장 뒤 편집 중인 화면은 '편집 끝내기' 전까지 다른 PC의 변경을 보지 못하고, 그 위에서 고쳐 저장하면 실패하며, 다른 곳에서 지운 도면이 이 PC의 목록에 "편집할 수 있는 도면"으로 남는다 |
| I5 | 띠 색을 고르는 규칙 | 주의색 **둘**(호박·청록) 가운데 **테마의 두 색에서 색상이 더 먼 쪽**. 둘 다 테마의 어느 색에 가까우면(60° 안) **예비색 보라**. 테마의 두 색에 색상이 없으면(회색·흰색·검정 계열) 호박. 바탕이 어두우면 밝은 톤 + 어두운 글자, 밝으면 짙은 톤 + 흰 글자(7절). 빨강 계열은 후보에 없다. 여섯 프리셋은 호박·청록뿐이고, 보라는 두 색을 따로 고른 테마에서만 나온다 | 색값만 바꾸려면 `MAP_EDIT_TONES`의 열두 값만. 예비색을 빼려면 그 표의 셋째 줄 — 그러면 두 색을 따로 고른 테마 가운데 일부(색상 쌍의 5.6%)에서 띠가 테마 색과 30° 안으로 붙는다(7.4) |
| I6 | 도면 목록의 '저장 안 한 점' | 표시·조건은 그대로, **색**을 띠와 같은 변수로(똥파리 골드 테마에서 고정 호박색 점이 묻히는 같은 문제다), **풍선 글자**를 띠와 같은 말("저장 안 한 변경이 있어요")로 바꾼다(6.7) | 두 줄을 되돌린다 |
| I7 | 좁은 창의 띠 | 창 폭 900px 이하에서는 띠가 두 줄(글자 줄 + 버튼 줄)이다. 'Ctrl+S' 표시는 버튼 줄에, 버튼 바로 왼쪽에 그대로 있다. 높이는 폭으로만 정해지고 글자에 따라 변하지 않는다(6.3) | 값만 고친다 |
| I8 | 저장했다는 알림의 자리 | **띠 안**(토스트 없음). 도면 위에 블록을 새로 끼우지 않는다 — 끼우면 도면 크기가 변한다(9절) | 토스트를 더하려면 `persistMaps`의 한 줄 |
| I9 | 그리다 만 다각형만 있고 초안은 안 바뀐 채 '편집 끝내기' | **묻는다**(지금의 '취소'도 묻는다). '돌아가기'를 누르면 찍던 점이 그대로 있다. 창의 제목과 글은 그 경우의 것이다("편집을 끝낼까요?" · "그리던 다각형이 사라져요.", 5.2). 작업을 잃지 않게 하는 요청에서, 묻던 것을 한솔 없이 묻지 않게 바꾸지 않는다 | 묻지 않게 하려면 `endEditing`의 조건에서 `\|\| polygon.length`를 뺀다 |
| I10 | 고친 것을 **모두 되돌린 뒤**의 '편집 끝내기' | **묻지 않고 끝난다.** 도면이 저장된 것과 같으므로 시안의 "바꾼 것이 없으면 바로 끝난다"에 든다. 되돌린 편집은 '다시 실행' 기록에만 남아 있었고, 편집이 끝나면 다시 실행할 수 없다(15.3에 적는다). 여기서도 물으면 "실수로 옮김 → 되돌리기 → 편집 끝내기"라는 가장 흔한 흐름이 매번 묻게 된다 | 물으려면 `endEditing`의 조건에 `\|\| draft.future.length`(저장소에서 읽은 초안)와 그 경우의 글 한 줄 |
| I11 | 편집에 들어갈 때의 머리줄 | '편집 시작'은 편집 중에 **자리를 지킨 채 보이지 않는다.** 버튼이 사라지며 옆의 '도면 설정'이 그 자리로 밀려오면, 더블클릭의 둘째 클릭이 설정 창을 연다(6.7) | 자리를 비우지 않으려면 그 버튼의 줄을 `!editing &&`로 감싼다 — 더블클릭 문제가 돌아온다 |
| I12 | '도면 저장'·Ctrl+S가 저장 대신 문장(거절·실패)으로 끝났는데 그 문장이 화면 밖에 있을 때 | 문장(빨간 띠)을 화면 안으로 끌어온다(9.3). 띠가 화면을 따라오고 Ctrl+S가 어디서든 듣게 되면서, 저장을 눌렀는데 아무 일도 없어 보이는 경우가 새로 생기기 때문이다(오늘은 저장 버튼과 그 문장이 같은 머리줄에 있어 함께 보이거나 함께 안 보인다) | 빼려면 `saveMap`의 세 곳과 effect 하나 |

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 초안을 화면 밖·앱 종료 뒤까지 보관하기, 다음에 "이어서 편집 / 버리기" 묻기 | 2차 |
| 사이드바의 배경 항목과 '도면 탐색' 탭의 점 | 2차 |
| **저장 안 한 편집이 있는** 초안의 도면이 다른 곳에서 바뀌었다는 알림, "최신으로 받기" | 2차. 1차는 저장 안 한 편집이 **없는** 초안만 따라가게 한다(I4) |
| '모두 저장', 권한을 잃은 초안의 처리 | 2차 |
| 자동 저장 | 한솔 결정(2026-10-10) |
| 저장되는 것(도면 모양, 버전 규칙), IPC, 메인 프로세스, 미리보기 저장소 바꾸기 | 필요 없다. `execute`의 서명도 그대로다 |
| 배경 메뉴의 노출 범위 바꾸기 | `src/features/playground/featureFlag.ts`는 건드리지 않는다 |
| 보기 모드에 '보기 중' 띠 두기 | 시안에 없다. 보기 모드의 변화는 버튼 하나의 모양과 이름뿐이다 |
| 저장 실패의 문구·자리 바꾸기, 메인 프로세스가 붙이는 오류 머리말 떼기 | 요청 밖. 실패는 지금의 빨간 띠 그대로다. 더하는 것은 하나 — '도면 저장'·Ctrl+S가 문장으로 끝났는데 그 문장이 화면 밖에 있으면 화면 안으로 끌어온다(I12, 9.3) |
| 다른 도면으로 갈 때 묻기, 다른 도면의 초안을 띠에 보이기 | 지금 동작 그대로 둔다(5.3). 2차가 다룬다 |
| 띠에 되돌리기·도구 버튼 넣기, 도구줄에 저장 버튼 넣기 | 도구줄은 1,231~1,310px에서 이미 두 줄이다(검증 기록 :331). 띠는 상태와 두 버튼만 |
| 버리기 확인 창에 '저장하고 끝내기' 버튼 | 시안에 없다 |

### 1.3 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | v1.131.0~v1.133.0이 낸 동작은 하나도 물러서지 않는다(확대·이름 칸·스냅·점 편집, 상자·묶음·겹친 공간, 계단·도로·카메라 색, 업데이트 안내) | 그 동작의 순수 모듈은 건드리지 않는다(10.3). 편집기(`BackgroundMapEditor.tsx`)에서 고치는 곳과 자리는 **10.2의 표가 전부다**: import 넷, 상수 `openDialogs`, 상태 둘(`refused`·`savedNotice`)과 ref 둘(`errorRef`·`saving`), `useMapEditColors(rootRef)` 호출, 새 함수 다섯(`followSaved`·`onSaveKey`·`leaveEditing`·`endEditing`·`requestSave`)과 effect 넷(따라가기, 알림 타이머, 거절된 저장의 까닭 보이기, Ctrl+S 리스너), `persistMaps`·`saveMap`의 본문과 `confirmAction`의 버리기 가지, 그리는 줄 아홉 곳(머리줄의 버튼과 '연결 해제' 버튼의 클릭 한 줄이 여기 든다). 일부러 달라지는 예전 문서의 줄은 2.9에 모았다 |
| R2 | **`BackgroundMapEditor.tsx`의 함수 순서** — 소스 앵커가 함수 표지에서 다음 표지까지를 잘라 읽는다(`tests/backgroundMapEditorWiring.test.ts:68-87`) | 새 함수의 자리를 정해 둔다(10.2). `function beginEditing(`의 글자와 자리는 그대로다(`placeSymbol` 조각의 끝 표지) |
| R3 | 끌기 도중에는 도면 위에 놓인 것이 생기거나 사라지지 않는다 — 끌기는 누를 때의 변환 행렬로 좌표를 바꾼다(:746, :754) | 띠는 `editing`에만 달려 있고 높이가 고정이다. 저장은 초안을 한 번의 dispatch로 다시 놓아 초안이 없는 렌더가 없다(4.1). 저장 알림은 띠 안의 글자다 |
| R4 | 읽기 전용 계정에는 편집 버튼도 띠도 없다 | `편집 시작`은 지금처럼 `snapshot.canManage &&` 안에, 띠는 `editing`(권한 포함) 아래에 있다. 안내 글도 그 계정에 없는 버튼의 이름을 말하지 않는다(6.7) |
| R5 | 업데이트 안내가 뜨면 탭과 본문이 통째로 빠진다(앵커 46) | `BackgroundLibraryView.tsx`는 건드리지 않는다. 편집기가 내려갈 때 타이머와 리스너를 뗀다 |
| R6 | 평면 SVG·3D·보조 평면도는 초안 하나를 읽는다. 표시 모드는 문서 상태가 아니다 | 띠는 모드와 무관한 자리(`.bmap-main`의 자식)에 한 번만 그린다 |
| R7 | 한 번의 끌기 = 되돌리기 한 단계 | 리듀서의 단계 규칙은 그대로다. 세는 값 하나(`dropped`)만 더한다 |
| R8 | 테스트는 Node type-stripping으로 돈다 | 새 순수 모듈은 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만, `@/` 별칭 없음 |
| R9 | 기다림(`await`) 뒤의 핸들러는 그 렌더의 상태를 쥐고 있다(tasks/lessons.md 2026-10-11) | 저장 뒤의 초안은 **명령에서** 만든다(4.1). "저장 중인가"는 ref로 보고, 일찍 돌아가는 검사 뒤에 켠다(4.2) |
| R10 | 네이티브 모달 창은 Tab이 끝을 지나면 포커스가 `body`에 놓인다(같은 항목) | Ctrl+S는 "창이 열려 있는가"를 이벤트 대상이 아니라 상태와 문서에 묻는다(8.2) |
| R11 | 움직임 규칙(CLAUDE.md) | transform·opacity만, 레이아웃 속성 전환 없음, 무한 반복 없음, `backdrop-filter` 없음. 들어올 때의 짧은 움직임은 `no-preference` 블록에만 쓴다(6.8) |
| R12 | 화면 글자는 비개발자의 말, 기울임 없음 | 3.3·5.2·13절의 문구 |

---

## 2. 현재 동작 (v1.134.0)

파일 이름만 쓴 것은 `src/features/backgrounds/` 아래다. 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

### 2.1 편집 중이라는 것 — 초안과 깃발

- 편집 문서는 편집기 하나마다 있는 작은 동기 저장소다: `useState(() => createMapDocumentStore())`(useBackgroundMapDocument.ts:35). 컴포넌트 상태라서 편집기가 내려가면 함께 사라진다.
- 초안은 `MapDraft = { value, baseRevision, past, future }`(mapDocument.ts:12)이고 도면마다 하나다(`drafts: Record<mapId, MapDraft>`, :26-32). 여는 곳은 `openDraft` 하나(:69-72): 값은 도면의 복제, `baseRevision`은 그 도면의 버전, 기록은 비어 있다.
- **"편집 모드"라는 깃발은 없다.** `const editing = !!draft && snapshot.canManage;`(:265) — 지금 보는 도면에 초안이 있고 권한이 있으면 편집 중이다. 그래서 도면마다 따로이고, 여러 도면이 동시에 초안을 가질 수 있다.
- 편집기가 그리는 도면은 스냅샷 위에 초안을 덮은 것이다: `effectiveMaps(snapshot, drafts)`(:248, mapWorkflow.ts:16-20). **초안은 스냅샷의 버전이 어디로 갔든 늘 이긴다.**
- 깃발들: `disabled = pending || busy`(:264 — `pending`은 저장소의 "어느 패널의 저장이든 도는 중", `busy`는 편집기 자신의 비동기 동작), `canEdit = editing && !disabled`(:266), `gestureActive`(:267).
- `canEdit`이 거짓이 되면 한꺼번에 일어나는 일: 끌던 것은 취소된다(`useLayoutEffect(() => { abortGesture(); }, [abortGesture, current?.id, mode, canEdit])`, :338), 열린 이름 칸은 **확정 없이** 닫힌다(:269-270, :404), 도면은 누름을 받지 않는다(:693), 다른 도면으로 가는 것이 막힌다(`navigate`, :426).
- `baseRevision === null`(이 PC에만 있는 도면)은 **오늘 편집기에서 생기지 않는다**: `openDraft`는 늘 숫자를 받고, 새 도면은 먼저 저장한 뒤 `revision: 1`로 들어간다(:592-597). 테스트의 손으로 만든 초안에만 있다(`tests/backgroundMapDocument.test.ts:52`).

### 2.2 들어가는 길과 나가는 길

**들어가는 길**

| 길 | 코드 | 함께 일어나는 일 |
|---|---|---|
| **공간 편집**(머리줄, 보라색 `bg-primary`) | :979 → `beginEditing`(:526-530) → `doc.beginEditing(current)`(초안이 있으면 아무 일도 없다, mapDocument.ts:100-102) | 도구 `select`, 오류 비움, 속성 칸 열림. 버튼 자신이 사라져 포커스가 `body`로 떨어진다(② 설계 :454에 적힌 대로) |
| **＋ 공간 그리기**(속성 칸, 아무것도 안 고른 때) | :1165 | 편집에 들어가고 평면으로 바꾸고 사각형 도구 |
| **도면 만들기**(여러 버튼 → `createMap`, :581-599) | `await persistMaps(createMapAndConnect(…))` 뒤 `enterNewMap({ ...map, revision: 1 })`(:596-597) | 새 도면으로 옮겨 편집 중으로 들어간다. 공간에서 만들면 **부모의 초안도 같은 명령으로 저장되고 버려진다** |

**나가는 길과 그때의 상태**

선택과 평면 보기는 `state.viewports[mapId]`에 있고 초안 액션은 그것을 건드리지 않는다(`tests/backgroundMapDocument.test.ts:262-265`). 3D의 둘러보기 자세는 도면 id별 ref다(`viewStates`, :245).

| 길 | 초안 | 되돌리기 기록 | 도구 |
|---|---|---|---|
| **취소** → 창 "도면 편집을 취소할까요?" → **변경사항 버리기**(:979, :564-567, :1202). **바뀐 것이 없어도 늘 묻는다** | 버림(`discard`) | 사라짐 | `select` |
| **도면 저장**, 성공(:536-547 → `persistMaps` :460-463) | **버림**(`dropDrafts`) — 편집이 끝난다 | 사라짐 | `select`(:545) |
| 도면 저장, 실패 | 그대로 | 그대로 | 그대로 |
| 다른 도면으로(`navigate`, :426) | 두 도면 것 모두 **그대로** — 떠난 도면은 보이지 않는 채 편집 중 | 그대로 | `select` |
| 배경 화면 안의 다른 탭(편집기는 `hidden`으로 남는다, BackgroundLibraryView.tsx:153) | 그대로 | 그대로 | 그대로 |
| 다른 메뉴로(`<LazyErrorBoundary key={currentView}>`, `src/App.tsx:3301`) · 계정 바뀜 · 업데이트 안내(BackgroundLibraryView.tsx:118-126) | **말없이 사라짐**(편집기가 내려간다) | 사라짐 | — |
| 권한을 잃음(`snapshot.canManage`가 거짓) | 문서에 남아 스냅샷을 가리지만 `editing`은 거짓 — 버튼이 모두 없다 | 닿을 수 없음 | `select`(:326) |

### 2.3 저장 길과 그 길을 함께 쓰는 넷

```
:536  async function saveMap() {
:537    if (!current || !draft || !canEdit) return;                        // 렌더 때의 상태
:538    if (!current.name.trim()) { setError('도면 이름을 입력해 주세요.'); return; }
:539    if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); return; }
:540    const settled = settle(), captured = settled.maps.find(map => map.id === current.id);
:542    setBusy(true); setError('');
:544      await persistMaps(saveMapChanges(snapshot, settled.drafts, [captured]));
:545      setTool('select');
:546    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
:460  async function persistMaps(command) { await execute(command); doc.dropDrafts(command.maps.map(item => item.entity.id)); }
```

- `settle()`(:410-414)은 끌던 것을 취소하고 **그 순간의 저장소**에서 초안을 읽는다. 같은 이벤트 안에서 앞서 확정된 것(blur)이 들어간다.
- **바뀐 것이 있는지 보지 않는다.** 손대지 않은 초안을 저장해도 쓰기가 나가고 버전이 하나 오른다(`applyBackgroundCommand`가 `revision:(expectedRevision??0)+1`로 적는다, domain.ts:146. 서버도 같다 — `DEVLOG/migrations/2026-09-21-background-library.sql:270-271`). 메인 프로세스는 저장마다 모든 창에 변경 신호를 낸다(`electron/backgroundIpc.ts:34`, `electron/main.ts:2561`).
- `execute`는 저장소의 것이고(`BackgroundLibraryView.tsx:31`, :157) `Promise<void>`다 — **부른 쪽은 스냅샷을 돌려받지 않는다.**
- 저장소(useBackgroundStore.ts:44-75): 로그인·진행 중·업데이트 필요를 먼저 거절(:45-46) → 그 순간의 스냅샷에 낙관 적용(:47-49. 여기서 버전 충돌이면 `'다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.'`, domain.ts:144) → `pending: true` → 게이트웨이 → **성공이면 받은 스냅샷으로 통째 바꾸고 `pending: false`**(:53, `execute`가 풀리기 **전에**) → 실패면 한 번 다시 읽어, 보낸 그대로가 다음 버전으로 들어가 있으면 성공으로 친다(`mapSaveWasApplied`, :62-64), 아니면 되돌리고 오류를 적고 다시 던진다(:65-71).
- **`pending`인 동안 저장소의 스냅샷은 아직 확인되지 않은 낙관 값이다**(:49). 실패하면 되돌아간다.
- 자기 저장의 메아리: 변경 신호가 `pending` 중에 오면 미뤄 두었다가(:26) `finally`에서 한 번 다시 읽는다(:72-74). 버전은 같다.

**`persistMaps`를 부르는 곳은 넷이다.** 넷 다 지금은 저장에 든 도면의 초안을 버린다(= 편집을 끝낸다).

| 부르는 곳 | 명령에 드는 도면 | 줄 |
|---|---|---|
| `saveMap` | 지금 도면(초안 그대로) | :544 |
| `createMap` | 새 도면. 공간에서 만들면 부모도(**편집한 그대로**) | :596 |
| `linkMap(childId)` · `linkMap(null)`(연결 해제) | 부모(편집한 그대로), 부모가 바뀌는 자식, 그 자식의 입구가 풀리는 다른 도면들(각각 편집한 그대로 — `effectiveMaps`, mapWorkflow.ts:72) | :606 |
| `saveSettings` | 설정 창을 열 때의 도면(초안 포함)에 창의 값을 얹은 것, 입구가 풀리는 다른 도면들 | :617 |

화면은 이미 그렇게 말한다: "연결할 때 현재 공간 편집 내용도 함께 저장됩니다."(:1099), "현재 공간의 편집 내용도 함께 저장됩니다."(:1180, :1189, :1198). `persistMaps`를 거치지 않는 저장은 도면 삭제 하나다(:575).

**실패했을 때 보이는 것**(바꾸지 않는다): 편집기의 `<div className="bg-error" role="alert">`(도면 **위**, :981 — 창이 열려 있으면 그 창 안에 같은 글자, :1181, :1190, :1199, :1202)와, 저장소의 오류를 보이는 라이브러리의 `bg-error bg-global-error`(BackgroundLibraryView.tsx:142-146). 초안은 그대로 남는다.

### 2.4 표시와 버튼, 버리기 확인 창

- 제목 옆 배지: `{editing && <span className="bmap-badge">{draftChanged ? '저장 전 변경사항' : '편집 중'}</span>}`(:978) — 10px 회색 글자(backgrounds-map.css:41). 첫 편집에서 더 넓은 글자로 바뀐다.
- 머리줄 버튼(`.bmap-actions`, :979): `속성 접기/열기` · [권한이 있으면] `도면 설정` · 편집 중이면 `취소` + `도면 저장`(저장 중에는 '저장 중…'), 아니면 `공간 편집`. **`공간 편집`과 `도면 저장`이 같은 자리, 같은 보라색(`bg-button bg-primary`)이다.**
- 도면 목록의 점: 바뀐 초안이 있는 도면마다 `<span className="bmap-draft-dot" title="저장 전 변경사항">●</span>`(:972). 색은 고정 `#eab76b`(backgrounds-map.css:30). 권한과 무관하게 그린다.
- 되돌리기·다시 실행 버튼은 도구줄에 있고 `draft.past`·`draft.future`가 비면 꺼진다(:1004).
- 버리기 확인 창(:1202): 제목 '도면 편집을 취소할까요?', 글 '이 도면에서 저장하지 않은 변경사항은 사라집니다.', 버튼 '돌아가기' / '변경사항 버리기'. 네이티브 `<dialog>`를 `showModal()`로 띄우고(`BackgroundModal`, BackgroundUI.tsx:26-61) 닫힐 때 열기 전의 요소가 문서에 남아 있으면 포커스를 돌려준다(:31-34).
- **저장 뒤에는 아무 알림이 없다.** 보라색 '도면 저장'이 같은 자리의 보라색 '공간 편집'으로 바뀔 뿐이다.

### 2.5 키보드

- `keyboard()`(:870-909)는 편집기 뿌리 `<div className="bmap-layout" ref={rootRef} onKeyDown={keyboard} tabIndex={-1}>`(:967)의 React 핸들러다. 평면 단축키(`+ = − 0 F2`, :880-885) 다음에 `if (target.closest(interactive)) return;`(:886 — `interactive`는 글자 칸과 **버튼**, :82-83)이 있고, 그 뒤에 Ctrl+D·Ctrl+Z·Ctrl+Y(:887-889)와 Delete가 있다.
- 그래서 **포커스가 버튼이나 칸에 있으면 Ctrl 단축키는 듣지 못하고, 포커스가 `body`에 있으면 `keyboard()`에 아예 닿지 않는다.**
- 창 단위(`window`, 캡처 단계) 리스너가 이미 넷 있다: 끌기 중의 Escape(:340-346), Alt(:348-362, 앵커 17), **Space**(`onSpaceKey` :367-388, 앵커 28 — `useEvent` 핸들러를 한 번 걸고 내릴 때 뗀다), 누름 기록 비우기(:390-396, 앵커 16).
- **Ctrl+S는 지금 아무 일도 하지 않는다.** 편집기에도, 앱의 전역 단축키 기본값에도 없다(`src/hooks/useGlobalShortcuts.ts:13-29`). 다만 사용자가 설정에서 아무 조합이나 직접 묶을 수 있고, 그 리스너는 `window`의 버블 단계다(:166).
- 칸의 값이 확정되는 때: 숫자 칸(`NumberField`, :133-149)은 범위 안의 값이면 곧바로, **덜 친 값·범위 밖의 값은 칸을 떠날 때**(:143-148. Enter는 blur다, :142). 평면의 이름 칸은 Enter나 blur에서(`BackgroundMapNameBox.tsx:52`, :60), 내려가는 중의 blur는 확정이 아니다(:27-29). 속성 칸의 이름 입력·선택 상자·체크는 곧바로다(:1093, :1111, :1151).
- 캔버스로 포커스를 보내는 함수: `focusCanvas()`(:425) — 평면이면 SVG, 3D면 `.bmap-3d-main`. 버튼이 자기 클릭으로 꺼지는 곳에서 이미 쓴다(:1106, :1160, :407).
- 앱은 Windows 전용이다(`package.json`의 빌드 대상이 `win` 하나, :93).

### 2.6 배치와 스크롤

```
<main class="flex-1 overflow-auto p-4">                         src/components/layout/MainLayout.tsx:63
 <section class="bg-library bg-library-shell bg-library-maps">    BackgroundLibraryView.tsx:84-87   backgrounds.css:13-20  overflow:hidden
  <div class="bg-library-body">                                   :152   backgrounds.css:188-192  overflow:hidden
   <div class="bg-tab-content">                                   :153   backgrounds.css:193-196  height:100%; overflow:auto   ← 스크롤 상자
    <div class="bmap-layout">                                     :967   backgrounds-map.css:1    display:flex; min-height:500px; height:100%; overflow:hidden
     <aside class="bmap-tree">                                    :968   :22
     <main class="bmap-main">                                     :977   :32   flex column; min-width:0; min-height:0; overflow:hidden
      <header class="bmap-header">                                :978-980  :33
      [오류 띠 .bg-error] [안내 .bmap-notice]                     :981, :982
      <div class="bmap-panels">                                   BackgroundMapPanels.tsx:67   :44  flex:1; min-height:380px
       <div class="bmap-workspace">                               BackgroundMapPanels.tsx:69   :43
        <section class="bmap-canvas-wrap [is-3d]">                :984   :53  position:relative; container:bmap-canvas / size
         도구줄 · (평면) <svg class="bmap-canvas"> / (3D) <div class="bmap-3d-split"> · 이름 칸 · 바닥줄   :985-1086
        <aside class="bmap-inspector">                            :1088
       <div class="bmap-panel-separator"> (40px)                  BackgroundMapPanels.tsx:70   :48
       <section class="bmap-gallery">                             :244  flex:0 0 clamp(248px,33dvh,370px)
```

그림의 왼쪽 번호는 그 요소를 그리는 줄이고(`.bg-library-body`·`.bg-tab-content`의 :152·:153은 바로 윗줄의 `BackgroundLibraryView.tsx`, `.bmap-layout`부터 줄 번호만 적은 것은 `BackgroundMapEditor.tsx`) 오른쪽 번호는 그 요소의 CSS 규칙이다 — `.bmap-layout`의 `backgrounds-map.css:1`부터 아래로 줄 번호만 적은 오른쪽 번호는 모두 `backgrounds-map.css`의 줄이다(번호가 하나뿐인 `.bmap-gallery`의 :244도 그 파일이다. 그 요소는 `BackgroundMapGallery.tsx:23`이 그린다). **이 절의 글머리에서는 CSS의 줄에 파일 이름을 붙이고**, 같은 문장에 편집기의 줄이 함께 나오면 그쪽에도 붙인다.

- 평면과 3D의 차이는 `.bmap-canvas-wrap` **안**에서만 난다(BackgroundMapEditor.tsx:1006의 SVG ↔ :1062의 `.bmap-3d-split`). 그 바깥은 같은 요소다.
- **누가 스크롤하나.** 900px보다 넓은 창에서는 `.bmap-layout`이 탭 높이에 맞고(`height:100%`), 탭이 최소 높이(평면 500px, 3D 760px — backgrounds-map.css:1, :326)보다 낮을 때만 `.bg-tab-content`가 스크롤한다. 탭 높이는 대략 창 안쪽 높이 − 180이라(같은 180이 BackgroundMapPanels.tsx:36에 있다) 1440×900의 3D에서는 이미 40px쯤 스크롤한다(계산). 900px 이하에서는 `.bmap-layout { height:auto; min-height:0; }`(backgrounds-map.css:281)이라 도면(330px, 3D 440px)·속성 칸(≤190px)·손잡이·이미지 목록(360px)이 세로로 쌓이고 늘 스크롤한다.
- **띠에서 스크롤 상자까지의 `overflow`**: `.bmap-main`의 `hidden`(backgrounds-map.css:32) → `.bmap-layout`의 `hidden`(backgrounds-map.css:1) → `.bg-tab-content`의 `auto`. 앞의 둘이 스크롤 컨테이너라서, 지금 그대로는 그 안의 `position:sticky`가 스크롤하지 않는 상자에 붙는다.
- **도면 크기와 끌기.** 평면 SVG의 크기는 flex 배치에서만 나온다(backgrounds-map.css:60). `viewBox`는 기본 `meet`라(BackgroundMapEditor.tsx:1006) 높이가 바뀌면 그림이 다시 맞춰진다. 끌기의 모든 이동과 놓음은 **누를 때 잡은 행렬**로 좌표를 바꾼다(BackgroundMapEditor.tsx:746, :754, :788). 그래서 끌기 도중에 SVG가 움직이거나 크기가 바뀌면 끌던 것이 포인터에서 어긋난다. 코드가 이미 지키는 곳: 오류 글자를 누를 때가 아니라 놓을 때 지운다(BackgroundMapEditor.tsx:778-781, 앵커 19), 바닥 안내는 평면에서 늘 두 줄 높이다(backgrounds-map.css:114-115).
- 도면 위에 놓이는 것은 오늘 오류 띠(BackgroundMapEditor.tsx:981)와 안내(:982), 그리고 900px 이하에서 줄바꿈되는 머리줄(backgrounds-map.css:283-284)이다.
- 3D는 `ResizeObserver`로 크기를 따르고(BackgroundMap3D.tsx:203-204) **도면 id가 바뀔 때만** 보기를 새로 연다(BackgroundMap3D.tsx:245-249). 도면 객체가 바뀌면 장면만 다시 맞춘다(BackgroundMap3D.tsx:423-428).

### 2.7 테마 색

- 테마는 숫자 셋("r g b") 일곱 개다(`ThemeColors`, `src/themes.ts:6-14`). 프리셋 여섯(:25-110), 밝은 화면은 프리셋과 무관한 고정 바탕(`getLightColors`, :262-275 — 바탕 `239 243 250`, 카드 `255 255 255`)이고 강조색은 그대로다.
- 적용: `applyTheme`(:278-292)가 `<html>`의 인라인 스타일에 변수 일곱을 쓰고 `data-color-mode`·`dark` 클래스를 맞춘다. 기본값은 `src/index.css:104-110`(바이올렛·어두운 화면)이다. **저장된 테마가 없으면 `applyTheme`은 불리지 않는다**(`src/App.tsx:993-996`) — 그때는 기본값이고 `data-color-mode`가 없다.
- 직접 고른 테마('커스텀'): `handleCustomApply`(`src/components/settings/ThemeSection.tsx:33-54`)는 **지금의 바탕을 그대로 두고** 강조색 둘만 바꾼다. 그 뒤 어두운·밝은 화면을 바꿔도 저장된 색을 그대로 쓰므로(`src/App.tsx:1576-1582`) **`data-color-mode`가 `light`인데 바탕이 어두운 경우(또는 반대)가 생길 수 있다.**
- **직접 고른 테마의 두 색은 서로 무관한 색일 수 있다.** 색 칸이 둘('메인 액센트', '서브 액센트' — 각각 `<input type="color">`, :199-222)이고 따로 고른다(:44-48). '커스텀'을 열면 두 칸이 **지금 쓰던 프리셋의 두 색**으로 채워져 있어서(:59-74), 메인 액센트만 바꾸고 '적용'을 누르는 평범한 흐름에서 **보조 강조색은 이전 프리셋의 것으로 남는다**(예: 똥파리 골드에서 메인만 파랑으로 → 강조색 파랑 + 보조 강조색 `251 191 36`). 여섯 프리셋에서는 두 색의 색상이 24° 안에 있다(가장 먼 것이 이혜민 머쉬룸의 11°·34°).
- **이 편집기가 선을 그리는 테마 색은 대부분 보조 강조색이다**: 모든 공간의 외곽선과 선택된 외곽선(backgrounds-map.css:64-66), 손잡이(:77-78, :106-109), 선택 상자(:101), 켜진 도구(:57), 고른 목록 줄(:29, :148), 포커스 고리(:21). 강조색은 옅은 채움(.08~.21)에 쓴다. 그래서 띠 옆에 실제로 놓이는 테마 색은 보조 강조색이다.
- 편집기가 열린 채 바뀔 수 있는 것은 앱 머리줄의 어두운·밝은 전환뿐이다(`src/components/layout/Header.tsx:110`). 프리셋과 직접 고르기는 설정 화면에 있고, 그 화면으로 가면 편집기가 내려간다(`src/App.tsx:3301`).
- **배경 화면은 새 창(위젯)에 뜨지 않는다.** `background-library`를 그리는 곳은 `src/App.tsx:3287` 하나다(`src/views/WidgetPopup.tsx`에 그 이름이 없고, `electron/`에서는 Realtime 채널 이름 — `electron/backgroundStore.ts:44` — 으로만 나온다).
- 이 기능 안의 선례: 3D 화면이 테마를 DOM에서 읽는다 — `getComputedStyle`로 변수를 읽고(`readPalette`, BackgroundMap3D.tsx:34-51), `<html>`의 `data-color-mode`·`class`·`style`을 `MutationObserver`로 지켜본다(:205-206, :414-421).
- 이 기능이 이미 쓰는 고정 주의색은 호박색이다: 저장 안 한 점 `#eab76b`, 카메라 `230 181 120`(색상 33°). 똥파리 골드(Amber Gold) 테마의 강조색(`217 119 6`, 색상 32°)과는 색상이 1~4°밖에 떨어져 있지 않고 대비가 1.7:1이다(계산) — 한솔이 짚은 "호박색 테마에서 묻힌다"가 이것이다.
- 이 기능의 또 다른 고정색은 **기호(문·의자·책상·계단…)의 회청록**이다: 평면의 기호 `#89b8bf`(backgrounds-map.css:214 — 밝은 화면에서도 같은 값이다), 오른쪽 목록의 기호 아이콘 `#89b8bf`(밝은 화면 `#3f7f89`, :153-155), 3D `0x89b8bf`(밝은 화면 `0x4f8f9a`, map3dScene.ts:33, BackgroundMap3D.tsx:46). 색상이 188°로 이 설계의 청록 후보와 같고, 채도는 낮다. **두 화면의 수치**(계산, 16절): 어두운 화면 — 기호 `#89b8bf` 대 밝은 청록 `86 204 222`는 채널 차 0.21 대 0.53, **밝기 대비 1.15:1**(밝기가 거의 같아 둘을 가르는 것은 채도뿐이다). 밝은 화면 — 3D의 기호 `0x4f8f9a` 대 짙은 청록 `0 102 117`은 채널 차 0.29 대 0.46(**채도가 더 가깝다**), 밝기 대비 1.81:1이고, 평면의 기호는 `#89b8bf` 그대로라 3.06:1, 목록의 아이콘 `#3f7f89`는 1.46:1이다(목록은 테두리 옆이 아니다). 그리고 v1.133.0의 **청록 카메라 색**(`teal` — `69 207 196`, 밝은 화면 `11 138 130`, backgrounds-map.css:9, :15)은 색상이 175~176°로 청록 후보에서 12~13°이고, 테두리와의 밝기 대비가 1.01:1(어두운 화면) · 1.57:1(밝은 화면)이다. 15.4와 수동 검증 C9에서 다룬다.

### 2.8 이전 분석(추가 요청 계획)에서 바로잡은 것

| 계획의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| 줄 번호(:260-261, :455-458, :521-532 …) | ③이 들어오며 밀렸다 | 이 문서의 줄 번호는 6731305a의 것이다 |
| "저장은 편집을 끝낸다"를 전제로 한 설계 | 한솔의 답 1이 뒤집었다 | 저장은 초안을 **다시 놓는다**(4절) |
| "`editStatus`: 단계 수, 50에서 '50+'" | 50을 넘긴 뒤 50번 되돌리면 `past`가 비어 "바뀐 것 없음"으로 읽힌다(`tests/backgroundMapDocument.test.ts:97-102`의 상황에서 이어 되돌린 것 — 임시 폴더에서 재현했다). 그 위에 "바뀐 것이 있을 때만 저장"과 "없으면 묻지 않고 끝내기"를 올리면 편집 열 개가 저장도 안 되고 말없이 버려진다 | 기록에서 밀려난 단계를 센다(`dropped`). 수는 한계를 넘어도 정확하다(3.2) |
| 보완: "'바뀜'을 기록 깊이가 아니라 값으로 정하라" | 1차에서는 깊이 + 밀려난 수가 정확하다(값 없이 단계가 생기는 길이 없다, 3.2). 값 비교가 필요한 것은 기록 없이 되살린 초안(2차)뿐이다 | 1차는 깊이 + `dropped`. 2차가 필요한 것은 10.4에 적는다 |
| "Ctrl+S를 `keyboard()`에" (보완이 이미 짚음) | 2.5 | 창 단위·캡처 단계(8절) |
| "`.bmap-canvas-wrap`에 안쪽 outline" | 안쪽 그림자나 outline은 상자 자신과 함께 그려져, 불투명한 3D 영역과 보조 평면도에 가려진다 | 가상 요소 오버레이(6.6) |
| "띠가 도면 영역 안" | 그 자리의 sticky는 도면 상자 안에서만 붙어, 좁은 창에서 속성 칸으로 내려가면 띠가 도면과 함께 올라가 버린다 | `.bmap-main`의 자식(6.2) |
| "저장 확인은 role=status" | 도면 위 블록으로 두면 도면 크기가 변한다(보완이 이미 짚음) | 띠 안의 글자 + 보이지 않는 알림 영역(9절) |

### 2.9 예전 문서의 줄 가운데 일부러 달라지는 것

회귀가 아니다. 검증할 때 예전 표를 그대로 대지 않도록 적어 둔다.

| 문서의 줄 | 예전 | 이제 |
|---|---|---|
| ② 설계 :297, :1812(G12) "도면 저장 … 보기 모드에서도 여러 개가 강조된 채 남는다. 묶음 동작 버튼은 없다" | 저장하면 보기 모드 | 저장해도 편집 중이라 묶음 버튼이 그대로 있다. "여러 개를 고른 채 보기 모드"는 '편집 끝내기'로 간다 |
| ② 설계 :454 "'공간 편집'을 누르면 … 포커스가 `body`로 떨어진다. '도면 저장'·'취소' 뒤 … 도 같다" | 포커스가 `body` | '편집 시작'·'도면 저장'·'편집 끝내기', 그리고 자기 클릭으로 사라지는 '연결 해제' 뒤 포커스가 캔버스로 간다(4.3, 5.1, 6.7, 8.3) |
| ① 설계 :651, :1283(N10) "저장에는 새 이름이 들어간다" | — | **그대로다.** Ctrl+S에도 같다(8.3) |
| ① 설계 :1267(Z13) "저장이 도는 동안 도면 위에서 휠 → 확대·축소" | — | 그대로다 |
| 검증 기록 :334 "'저장 전 변경사항'이 생기지 않는다" | 제목 옆 배지의 글자 | 배지가 없다. 같은 확인을 띠의 "저장된 그대로예요"로 한다 |
| ①~③의 수동 검증 표에서 '공간 편집'·'취소'·'변경사항 버리기'·'저장 전 변경사항'이라고 적힌 곳 | 그 이름의 버튼·글자 | '편집 시작'·'편집 끝내기'·'버리고 끝내기'·'저장 안 한 변경이 있어요'(5.2, 6.7) |

---

## 3. 상태 모델

### 3.1 순수 함수 하나 — `mapEditStatus.ts` (새 파일)

띠가 무엇을 보이는지는 순수 함수 하나가 정한다. DOM도 React도 없다.

```ts
import { mapDraftChanged, mapDraftSteps } from './mapDocument.ts';
import type { MapDraft } from './mapDocument.ts';

export type MapEditPhase = 'saving' | 'changed' | 'saved' | 'clean';
export type MapEditStatus = {
  phase: MapEditPhase;
  /** Something of this map is not saved. */
  changed: boolean;
  /** Finished edits that are not saved. */
  steps: number;
  /** The words beside the label. */
  detail: string;
  /** 도면 저장 can be pressed. */
  canSave: boolean;
  saveLabel: string;
  /** What a screen reader is told as it happens. Empty: nothing to tell. */
  announce: string;
};
/** The label of the strip: it is there in every state. */
export const MAP_EDIT_LABEL = '편집 중';
/** How long "saved" stays on the strip. */
export const MAP_SAVED_NOTICE_MS = 4000;

export function mapEditStatus(draft: MapDraft, saving: boolean, justSaved: boolean): MapEditStatus {
  const changed = mapDraftChanged(draft), steps = mapDraftSteps(draft);
  if (saving) return { phase: 'saving', changed, steps, detail: '저장 중…', canSave: false, saveLabel: '저장 중…', announce: '도면을 저장하는 중이에요' };
  if (changed) return { phase: 'changed', changed, steps, detail: draft.baseRevision === null ? '아직 저장한 적 없는 도면이에요' : `저장 안 한 변경 ${steps}개`, canSave: true, saveLabel: '도면 저장', announce: '' };
  if (justSaved) return { phase: 'saved', changed, steps, detail: '도면을 저장했어요', canSave: false, saveLabel: '도면 저장', announce: '도면을 저장했어요' };
  // Not a sentence that begins like the one for unsaved edits: the two are told apart at the first word.
  return { phase: 'clean', changed, steps, detail: '저장된 그대로예요', canSave: false, saveLabel: '도면 저장', announce: '' };
}
```

문구의 규칙 셋: (가) 깨끗함의 문장은 바뀜의 문장과 **첫 낱말부터** 다르다("저장된 …" / "저장 안 한 …") — 예전 안의 "저장 안 한 변경이 없어요"는 "저장 안 한 변경 3개"와 앞의 여덟 글자가 같았다. (나) 저장 중은 띠의 글자와 버튼이 같은 말('저장 중…' — 라이브러리 머리줄과 설정 창도 이 말이다). (다) "도면을 저장했어요" 앞의 ✓ 표시는 글자가 아니라 CSS가 그린다(6.8) — 읽어 주는 문장(`announce`)에는 기호가 없다.

세 입력을 편집기가 주는 값:

| 입력 | 값 | 까닭 |
|---|---|---|
| `draft` | 지금 보는 도면의 초안(렌더의 `draft`, :250) | 띠는 `editing`일 때만 그리므로 늘 있다 |
| `saving` | `pending`(저장소의 "저장이 도는 중") | 편집기의 `busy`는 밑그림 올리기에도 켜진다. `pending`은 정확히 "라이브러리에 쓰는 중"이다 |
| `justSaved` | `savedNotice?.mapId === current.id`(9절) | 이 도면의 저장이 방금 끝났고 알림이 아직 떠 있다 |

순서가 뜻이다: **저장 중 > 바뀜 > 방금 저장함 > 깨끗함.** 저장 알림이 떠 있는 4초 안에 다시 고치면 곧바로 "저장 안 한 변경 1개"가 된다.

### 3.2 '바뀜'과 수 — `mapDocument.ts`

**'바뀜'은 지금의 정의에 한 항을 더한 것이다.**

```ts
export type MapDraft = { value: BackgroundMap; baseRevision: number | null; past: BackgroundMap[]; future: BackgroundMap[];
  /** Finished edits the undo history no longer holds (it keeps the newest MAP_HISTORY_LIMIT). They are still unsaved. */
  dropped: number };

/** Finished edits of a draft that are not saved: what undo can still take back, and what the history no longer holds. */
export function mapDraftSteps(draft: MapDraft | undefined): number {
  return draft ? draft.dropped + draft.past.length : 0;
}
/** A new map, or a draft with at least one finished edit that was not undone, has something to save. */
export function mapDraftChanged(draft: MapDraft | undefined): boolean {
  return !!draft && (draft.baseRevision === null || draft.past.length > 0 || draft.dropped > 0);
}
```

`dropped`는 단계를 넣는 두 곳(리듀서의 `update` 가지와 `gesture-finish` 가지)에서, 기록이 가득 찬 채로 한 단계가 더 들어올 때 하나 는다. 두 곳의 `commitMapHistory(…)` 호출을 아래 함수로 바꾼다(`mapEditSession.ts`는 고치지 않는다 — `MAP_HISTORY_LIMIT`만 import에 더한다).

```ts
/** One finished edit of a draft: an undo step. A step the full history lets go of is counted, so it still reads as unsaved. */
function commitDraft(draft: MapDraft, next: BackgroundMap, entry?: BackgroundMap): MapDraft {
  const committed = commitMapHistory(draft, next, entry);
  return draft.past.length < MAP_HISTORY_LIMIT ? committed : { ...committed, dropped: draft.dropped + 1 };
}
```

**왜 이것으로 충분한가.** 초안은 `past`가 빈 채로 열린다. 값이 단계 없이 바뀌는 길은 셋뿐이고 셋 다 깨끗한 초안에서는 일어나지 않는다: 끌기의 미리보기(끝나면 단계가 되거나 시작 값으로 돌아간다, mapDocument.ts:141-153), 방금 그린 노드의 첫 이름(`history: false` — 그리기 단계가 이미 있다, :667), 같은 칸에 이어 친 값(합쳐지는 단계가 이미 있다, mapDocument.ts:114-117). 그래서 `past`가 비고 `dropped`가 0이면 값은 초안을 연 그 객체다.

**무엇이 달라지고 무엇이 그대로인가.**

| 상황 | 지금(`past.length > 0`) | 이제 |
|---|---|---|
| 방금 연 초안 / 5번 고치고 5번 되돌림 / 끌었다 제자리 | 바뀜 아님 | 같다(수 0) |
| 한 번 고침 / 되돌린 뒤 다시 실행 | 바뀜 | 같다(수 1) |
| 첫 끌기의 도중(아직 놓지 않음) | 바뀜 아님 | 같다 — 띠의 글자는 끌기 도중에 변하지 않는다 |
| 손으로 고쳤다가 손으로 되돌림(두 단계) | 바뀜 | 같다(수 2). 값이 같은지는 보지 않는다 |
| **60번 고치고 50번 되돌림** | **바뀜 아님(틀림)** — 값은 10번째 편집 뒤의 것이다 | **바뀜, 수 10** |
| 60번 고침 | 바뀜 | 바뀜, 수 60(`past` 50 + `dropped` 10) |
| `baseRevision === null`(오늘은 생기지 않는다) | 바뀜 | 같다. 문구는 '아직 저장한 적 없는 도면이에요' |

`tests/backgroundMapDocument.test.ts`가 고정한 `mapDraftChanged`의 결과(:31, :36, :45, :52, :53, :213, :289)는 모두 그대로다(임시 사본에서 바꾼 리듀서로 기존 52개 테스트 통과를 확인했다, 16절).

**수의 규칙.** `steps = dropped + past.length`. 한 단계 = 끌기 한 번(mapDocument.ts:141-147), 칸 하나에 친 값(합쳐진다, :109-118), 공간 하나 그리기와 그 첫 이름, 묶음 지우기 한 번(:559), 잠그기 한 번. 되돌리면 1 줄고 다시 실행하면 1 는다. 저장하면 0이다(초안이 새로 놓인다). **상한 표시는 없다** — 수가 정확하므로 "50개 이상" 같은 말이 필요 없다. 글자는 줄바꿈하지 않고 띠의 높이는 고정이라 자릿수가 늘어도 배치가 변하지 않는다(6.3).

**읽는 곳은 모두 같은 함수다**: 띠(`mapEditStatus`), '도면 저장'이 쓰기를 내보낼지(4.2), '편집 끝내기'가 물을지(5.1), 도면 목록의 점(:972), 세 안내 글(:1099, :1189, :1198).

### 3.3 상태 표

| 상태 | 조건 | 띠의 글자와 **모양** | 도면 저장 | 편집 끝내기 | 보이지 않는 알림 |
|---|---|---|---|---|---|
| 깨끗함 | 바뀜 아님, 알림 없음(방금 편집을 시작했거나, 저장한 지 4초가 지났거나, 모두 되돌렸다) | **편집 중** · 저장된 그대로예요 — 보통 굵기의 맨 글자 | '도면 저장', 흐림(`aria-disabled`), 풍선 '저장할 변경이 없어요' | 켜짐. 묻지 않고 끝낸다(그리다 만 다각형이 있으면 묻는다, 5.1) | — |
| 바뀜 | `steps ≥ 1` | **편집 중** · **저장 안 한 변경 N개** — 글자가 **채워진 알약 모양** 안에 있다(글자색 바탕에 띠 색 글자, 켜진 저장 버튼과 같은 칠) | '도면 저장', 켜짐(같은 칠), 풍선 '도면 저장 (Ctrl+S)' | 켜짐. 묻는다 | — |
| 저장 중 | `pending` | **편집 중** · 저장 중… — 맨 글자 | '저장 중…', 흐림 | 꺼짐(`disabled`) | "도면을 저장하는 중이에요" |
| 방금 저장함 | 바뀜 아님, 알림이 떠 있음(4초) | **편집 중** · **✓ 도면을 저장했어요** — 굵은 글자, 앞에 ✓ | '도면 저장', 흐림 | 켜짐. 묻지 않고 끝낸다 | "도면을 저장했어요" |
| 저장 실패 | 저장이 거절되거나 실패 | **바뀜으로 돌아온다**(초안과 수가 그대로다) | 켜짐 | 켜짐. 묻는다 | 오류는 지금의 빨간 띠(`role="alert"`)가 읽힌다(9.3) |
| 새 도면(저장한 적 없음) | `baseRevision === null` — 오늘은 닿지 않는다 | **편집 중** · 아직 저장한 적 없는 도면이에요 — 알약 모양(바뀜이다) | 켜짐 | 켜짐. 묻는다 | — |

- 띠에는 늘 '편집 중'이 있다(`MAP_EDIT_LABEL`). 뒤의 글자와 그 모양이 바뀐다.
- **세 상태는 색도 움직임도 없이 갈린다**: 맨 글자(깨끗함·저장 중) / 채워진 알약(바뀜) / ✓와 굵은 글자(방금 저장함). 알약이 나타나는 것이 "방금 한 일이 아직 저장되지 않았다"는 표시이고, 왼쪽의 알약과 오른쪽 끝의 켜진 저장 버튼이 같은 칠로 함께 켜지고 함께 꺼진다. 모양은 `data-phase`에 달린 CSS 규칙이고(6.8) 띠의 높이를 바꾸지 않는다.
- 저장할 것이 없을 때 '도면 저장'을 누르면 아무 일도 없고, Ctrl+S는 **쓰기를 내보내지 않는다** — 띠는 그대로이고 포커스만 도면으로 간다(8.3. 그리다 만 다각형이 있으면 그 문장이 뜬다, 4.2). 그때 "이미 저장돼 있다"를 말해 주는 것이 늘 떠 있는 "저장된 그대로예요"와 저장 버튼의 풍선이다.
- 편집기의 다른 동작이 도는 동안(`disabled`인데 `pending`은 아닌 때 — 밑그림 올리기)은 글자는 그대로이고 두 버튼만 눌리지 않는다.
- 되돌리기 버튼(:1004)은 지금 그대로다: 저장 뒤에는 `past`·`future`가 비어 둘 다 꺼진다.

---

## 4. 저장한 뒤에도 편집 중

### 4.1 `persistMaps` — 버리지 않고 다시 놓는다

**바뀌는 함수는 `persistMaps` 하나다.** 네 저장 길이 모두 이 함수를 지나므로(2.3) 규칙이 하나가 된다: **저장은 저장한 도면의 편집을 끝내지 않는다**(화면에서 달리 보이는 두 곳 — 다른 도면으로 옮겨 가는 '연결하고 열기', 드문 복구 길 — 은 I3과 4.3).

```ts
async function persistMaps(command: MapSaveCommand) {
  const shown = current?.id;                                              // the map on show as the save starts
  await execute(command);
  // Saving never ends edit mode: every saved map that was being edited goes on from what was saved. Built from the command.
  // After the wait this handler still holds the snapshot of the render that started the save, with the revision before it.
  doc.rebaseDrafts(savedMaps(command));
  if (shown && command.maps.some(item => item.entity.id === shown) && mapDraft(doc.getState(), shown)) setSavedNotice({ mapId: shown });
}
```

**`savedMaps` — `mapWorkflow.ts`의 새 순수 함수.** 저장이 끝난 도면을 명령에서 만든다. 버전 셈은 `applyBackgroundCommand`(domain.ts:146), `mapSaveWasApplied`(mapWorkflow.ts:12), 서버(SQL :270-271)와 같은 식이다.

```ts
/** The maps of a save as the library holds them once it went through: each on the revision that save gave it. */
export function savedMaps(command: MapSaveCommand): BackgroundMap[] {
  return command.maps.map(({ entity, expectedRevision }) => ({ ...entity, revision: (expectedRevision ?? 0) + 1 }));
}
```

**`rebase-drafts` — 리듀서의 새 액션.** 넘겨받은 도면 가운데 **초안이 있는 것만** 깨끗한 초안으로 바꿔 놓는다. 초안이 없던 도면에는 아무것도 열지 않는다 — 편집 중이 아니던 사람의 '설정 저장'이 편집을 켜지 않는다.

```ts
  | { type: 'rebase-drafts'; maps: readonly BackgroundMap[] }
  | { type: 'follow-saved'; maps: readonly BackgroundMap[] }

/** A draft with nothing unsaved in it, on the revision of `map`. */
function freshDraft(map: BackgroundMap): MapDraft {
  return { value: structuredClone(map), baseRevision: map.revision, past: [], future: [], dropped: 0 };
}
function openDraft(state: MapDocumentState, map: BackgroundMap): MapDocumentState {
  return { ...state, drafts: { ...state.drafts, [map.id]: freshDraft(map) }, gesture: state.gesture?.mapId === map.id ? null : state.gesture, coalescing: null };
}
/**
 * Each listed map that has a draft, and passes `only`, gets a fresh draft on that map. A map without a draft is left
 * alone: nothing here opens one. A gesture or a field edit on a replaced draft ends with it; the others go on.
 */
function rebaseDrafts(state: MapDocumentState, maps: readonly BackgroundMap[], only?: (draft: MapDraft, map: BackgroundMap) => boolean): MapDocumentState {
  const targets = maps.filter(map => { const draft = mapDraft(state, map.id); return !!draft && (!only || only(draft, map)); });
  if (!targets.length) return state;
  const drafts = { ...state.drafts }, replaced = new Set(targets.map(map => map.id));
  for (const map of targets) drafts[map.id] = freshDraft(map);
  return { ...state, drafts, gesture: state.gesture && replaced.has(state.gesture.mapId) ? null : state.gesture,
    coalescing: state.coalescing && replaced.has(state.coalescing.mapId) ? null : state.coalescing };
}
    case 'rebase-drafts':
      return rebaseDrafts(state, action.maps);
```

`useBackgroundMapDocument.ts`에 `rebaseDrafts(maps)`와 `followSaved(maps)`를 더하고, 부르는 곳이 없어지는 `dropDrafts`를 뺀다(리듀서의 `drop-drafts` 액션과 그 테스트는 그대로 둔다 — `discard`가 같은 함수를 쓴다).

**왜 명령에서 만드는가 — 틀린 길과 그 결과.** 저장이 끝나 `await` 뒤로 돌아온 핸들러는 저장을 **시작한 렌더**의 것이다. 그 `snapshot`과 `current`의 버전은 저장 전(N)이다. 거기서 `doc.dropDrafts(…); doc.beginEditing(current)`로 초안을 다시 열면 `baseRevision`이 N인 초안이 버전 N+1인 스냅샷 위에 놓이고, **다음 저장이 "다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요."로 거절된다**(자기 자신과의 충돌. 임시 폴더에서 실제 저장소로 재현했다, 16절). 명령에서 만든 도면은 저장소가 그 순간 들고 있는 도면과 깊은 비교로 같고, 다시 놓인 초안의 `baseRevision`은 N+1이며, 두 번째 저장이 통과한다(같은 실험).

- 저장소를 다시 읽을 필요가 없다. 초안이 새 버전을 스스로 들고 있으므로 "초안이 먼저냐 스냅샷이 먼저냐"가 문제가 되지 않는다(`execute`가 풀리는 모든 길은 그 전에 스냅샷을 바꿔 둔다, useBackgroundStore.ts:53, :63).
- **dispatch 한 번이다.** 초안이 없는 렌더가 없으므로 `editing`은 '도면 저장'을 누른 순간부터 끝까지 참이다. 띠가 사라졌다 나타나지 않고 도면 크기가 변하지 않는다(R3). 저장이 도는 동안 꺼지는 것은 `canEdit`뿐이다.
- `await` 뒤에 써도 되는 것: `command`, `shown`(기다리기 **전에** 잡았다), `doc`(동기 저장소 — `doc.getState()`는 늘 지금이다), setter. 쓰면 안 되는 것: 클로저의 `snapshot`·`current`·`draft`·`canEdit`·`mode`·`draftChanged`.

**저장 뒤 각 상태가 어떻게 되는가.**

| 것 | 저장 뒤 | 근거 |
|---|---|---|
| 초안 | 저장한 도면의 복제, `baseRevision` = 새 버전, 바뀜 아님 | `freshDraft` |
| 되돌리기 기록 | **비워진다**(한솔에게 알린 대로). 되돌리기·다시 실행 버튼이 꺼진다(:1004) | `past: [], future: []` |
| 선택(묶음 포함) | 그대로. 묶음 동작 버튼도 그대로 있다(편집 중이므로) | `viewports`는 같은 객체다(실험) |
| 평면 보기(위치·확대) | 그대로 | 같다 |
| 3D 둘러보기 자세 | 그대로 — 도면 id가 같아 보기를 새로 열지 않는다. 장면은 새 도면 객체로 한 번 다시 맞춘다 | BackgroundMap3D.tsx:245-249, :423-428 |
| 3D 기즈모 | 조절 방식(`gizmoMode`)은 그대로. 끌던 중이었다면 저장이 시작될 때 취소됐다(지금과 같다) | :338, BackgroundMap3D.tsx:221 |
| 열린 이름 칸 | 저장 **전에** 확정되고 닫힌다(버튼을 누르면 blur가 먼저, Ctrl+S는 8.3). 저장 뒤에는 열려 있지 않다 | `BackgroundMapNameBox.tsx:60`, :404 |
| 고른 점(다각형) | 저장이 시작될 때 풀린다(지금과 같다) | :402 |
| **도구** | **그대로다.** `saveMap`의 `setTool('select')`(:545)를 뺀다 — 편집이 이어지므로 손에 든 도구(화면 이동, 막 고른 사각형)가 저장 한 번에 풀릴 까닭이 없다 | 4.2 |
| 스냅 켜기/끄기 | 그대로(기기별 설정이다, `mapPlanEdit.ts`의 `readSnapPreference`) | 건드리지 않는다 |
| 속성 칸 | 열린 채, 같은 노드를 보인다 | 선택이 그대로다 |
| 그리다 만 다각형 | 저장이 거절된다(지금과 같은 문장, :539) | 4.2 |
| 포커스 | 캔버스 | 8.3 |

### 4.2 `saveMap` — 바뀐 것이 있을 때만, 겹쳐 돌지 않게

```ts
async function saveMap() {
  if (!current || !draft || !canEdit || saving.current) return;
  // Not saved: the reason is shown, and brought into view. It sits above the band and may be scrolled away, while the band and Ctrl+S are always at hand.
  // The points of a polygon that is being drawn are no part of the draft. Asked first: after the check below, Ctrl+S on a map with nothing else unsaved would end without a word.
  if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); setRefused(count => count + 1); return; }
  // Nothing unsaved: no write. A save of an untouched map would still raise its revision and signal every open screen.
  // Read from the store: the field that was being typed in has just been committed by leaving it.
  if (!mapDraftChanged(mapDraft(doc.getState(), current.id))) return;
  if (!current.name.trim()) { setError('도면 이름을 입력해 주세요.'); setRefused(count => count + 1); return; }
  const settled = settle(), captured = settled.maps.find(map => map.id === current.id);
  if (!captured) return;
  saving.current = true; setBusy(true); setError('');
  try {
    await persistMaps(saveMapChanges(snapshot, settled.drafts, [captured]));
  } catch (cause) { setError(message(cause)); setRefused(count => count + 1); } finally { saving.current = false; setBusy(false); }
}
```

저장되지 않은 까닭을 화면 안으로 끌어오는 장치(9.3):

```ts
/** Counts the saves of the map that ended in a message instead of a save. Each one brings that message into view. */
const [refused, setRefused] = useState(0);
const errorRef = useRef<HTMLDivElement>(null);            // the editor's own error block, above the band
useEffect(() => { if (refused) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [refused]);
```

- `saving`은 `const saving = useRef(false);`(`busy` 옆, :219 다음). Ctrl+S를 빠르게 두 번 누르면 `busy`가 그려지기 전에 두 번째가 들어올 수 있고, 그러면 저장소가 "진행 중인 저장이 끝난 뒤 다시 시도해 주세요."로 거절한 것이 오류로 보인다. **켜는 자리는 일찍 돌아가는 검사들 뒤다** — 앞에서 켜면 `finally`를 지나지 않는 길에서 영영 꺼지지 않는다(R9).
- 바뀜 검사는 **저장소에서 지금 읽는다**(`doc.getState()`). 렌더의 `draftChanged`(:941)를 쓰면 방금 blur로 확정된 칸의 값이 "바뀐 것 없음"으로 읽혀 저장이 조용히 버려진다.
- **검사의 차례는 가드 → 그리다 만 다각형 → 바뀜 → 이름이다.** 그리다 만 다각형이 있으면 초안이 깨끗하든 바뀌었든 지금의 문장으로 거절한다(지금도 그렇다, :539). 다각형 검사를 바뀜 검사 뒤에 두면, 찍던 점만 있고 초안은 깨끗한 도면에서 Ctrl+S가 말없이 끝난다 — 띠는 "저장된 그대로예요"인데 찍던 점은 저장되지 않았고, 지금 뜨는 문장이 그 경우에만 사라진다(찍던 점은 초안이 아니라 화면 상태라 띠가 알려 줄 수 없다, :198). 그 경우 띠의 저장 버튼은 흐려져 있어 눌러도 아무 일이 없으므로(6.1) 문장을 보이는 것은 Ctrl+S다. 이름 검사는 바뀜 검사 뒤여도 된다 — 저장 계약이 빈 이름을 받지 않고(domain.ts:50) 편집기에서 도면 이름을 고치는 곳은 곧바로 저장하는 설정 창뿐이라, 깨끗한 초안의 이름이 비어 있을 수 없다.
- **저장되지 않고 문장으로 끝나는 세 곳은 그 문장을 화면 안으로 끌어온다**(`setRefused` → effect의 `scrollIntoView`): 시작 전에 거절되는 둘(그리다 만 다각형, 그리고 이름이 비었다 — 위에 적은 대로 화면으로는 닿지 않는 방어 가드다)과 `catch`. 세는 값이라 같은 문장이 이미 떠 있어도 다시 끌어오고, `block: 'nearest'`라 이미 보이는 중이면 아무것도 움직이지 않는다. 빨간 띠는 띠보다 **위**에 놓여 있어(6.2) 끌어오면 스크롤 상자의 맨 위에 빨간 띠, 그 바로 아래에 띠가 온다 — 붙어 있던 띠에 가리지 않는다. `catch`까지 넣는 까닭: 쓰기가 나간 뒤의 실패는 스크롤 상자 밖의 라이브러리 띠에도 뜨지만(2.3), **쓰기가 나가기 전에 던져지는 것**(저장소가 그 자리에서 알아챈 버전 충돌 "다른 사용자가 내용을 변경했습니다…", "진행 중인 저장이 끝난 뒤…" — useBackgroundStore.ts:45-48은 오류를 적기 전에 던진다)은 편집기의 빨간 띠에만 뜬다. 자리: `refused`·`errorRef`는 `error`(:218) 다음, effect는 알림 타이머 effect 다음(10.2). `saveMap` 밖의 저장 길(설정·연결·만들기)은 창 안에 같은 문장을 보이거나 지금과 같은 자리라 건드리지 않는다.
- `setTool('select')`를 뺐다(4.1의 표).
- 실패하면 지금과 같다: 초안·기록·선택이 그대로이고 오류가 빨간 띠에 뜬다(2.3).

### 4.3 함께 저장하는 세 길 — 하나씩

`persistMaps`가 바뀌므로 세 길도 저장한 초안을 버리지 않는다. 각 길의 그 뒤 줄은 고치지 않는다(함수 본문은 그대로다. 고치는 것은 '연결 해제' **버튼의 클릭** 한 줄뿐이다 — 표 아래).

| 길 | 저장에 든 초안 | 그 뒤(지금의 줄 그대로) | 결과 | 까닭 |
|---|---|---|---|---|
| **설정 저장**(`saveSettings`, :611-621) | 지금 도면의 초안 → 창의 값(= 저장된 값)으로 다시 놓인다. 입구가 풀린 다른 도면의 초안도 | 창이 닫힌다 | **편집 중이었으면 계속 편집 중**(띠에 "도면을 저장했어요"). 편집 중이 아니었으면 보기 그대로(초안이 없어 아무것도 열리지 않는다) | 설정을 고치려고 창을 열었다 닫았을 뿐인데 편집이 끝나 띠가 사라지면 "저장한 뒤에 편집을 계속"과 어긋난다. 창은 이미 "현재 공간의 편집 내용도 함께 저장됩니다."라고 말한다 |
| **연결 해제**(`linkMap(null)`, :1097) | 지금 도면의 초안 | 도구 `select` | 계속 편집 중. 포커스는 캔버스(아래) | 편집하다 누르는 버튼이다 |
| **기존 도면 연결**(`linkMap(childId)`, :600-610 — 창의 버튼은 '연결하고 열기') | 부모의 초안, (부모가 바뀌는) 자식의 초안, 입구가 풀린 도면의 초안 | 자식 도면으로 옮겨 간다 | 부모는 **보이지 않는 채 편집 중**(깨끗함)으로 남고, 자식은 초안이 있었으면 편집 중, **없었으면 보기**(띠가 없다) | 지금도 편집 중에 다른 도면으로 가면 떠난 도면의 초안이 남는다(2.2). 그것과 같은 모습이다. 부모로 돌아오면 띠가 "저장된 그대로예요"로 있다. 옮겨 간 도면이 보기로 열리는 것도 지금과 같다 — '만들고 들어가기'(아래 줄)는 편집 중으로 열린다(15.3에 적는다) |
| **내부 도면 만들기**(`createMap`, 공간에서) | 부모의 초안 | `enterNewMap({ ...map, revision: 1 })` — 새 도면으로 들어가 편집 중 | 부모는 보이지 않는 채 편집 중(깨끗함), 새 도면은 지금처럼 편집 중 | 같다 |
| 도면 만들기(공간 없이) | 없음(새 도면에는 초안이 없었다 — `rebase-drafts`가 건너뛴다) | `enterNewMap` | 지금과 같다 | — |
| **도면 삭제**(`confirmAction`, :568-579) | — (`persistMaps`를 지나지 않는다) | `doc.discard(current.id)`, 부모로 | **지금 그대로.** 지운 도면에는 이어 편집할 것이 없다. 부모는 가지고 있던 상태 그대로다. **삭제가 실패해 확인 창이 오류와 함께 열린 채 남는 때도 지금 그대로다**: 창이 열려 있는 동안에는 따라가기가 돌지 않아 그 도면의 초안이 남고, '삭제'를 다시 눌러도 같은 도면에 대고 묻는다(4.4의 '창이 열려 있는 동안') | 고치지 않는다 |
| `createMap`의 다시 시도 가지(도면이 이미 있을 때, :585-591) | — | `doc.discard(createForm.parentId)` | **지금 그대로**(부모의 편집이 끝난다) | 드문 복구 길이다. 그 가지에는 `await`가 없고 부모의 편집은 첫 시도에서 저장됐다. 고치지 않는다(15.4) |

**'연결 해제'의 포커스.** 이 버튼은 연결이 있을 때만 그려지므로(`{linkedMap && <button …>연결 해제</button>}`, :1097) 자기 클릭의 저장이 끝나면 사라진다. 지금은 그 저장이 편집을 끝내서 문제가 아니었지만, 이제는 편집이 이어지는데 포커스가 사라진 요소(`body`)에 남아 Delete·Ctrl+Z·F2가 도면을 한 번 누를 때까지 듣지 못한다. '도면 저장'과 같은 방법으로, 저장을 시작하기 **전에** 포커스를 캔버스로 보낸다 — 버튼의 클릭에서만:

```tsx
onClick={() => { focusCanvas(); void linkMap(null, selected.id); }}
```

`linkMap`의 본문은 그대로다. 그 버튼이 눌릴 수 있는 때는 `linkMap`이 거절하지 않는 때다(잠김·그리다 만 다각형·`disabled`면 버튼이 꺼져 있다). 설정 창·연결 창·만들기 창의 저장은 창이 닫히며 `BackgroundModal`이 포커스를 돌려주므로 지금과 같다.

저장한 초안은 예외 없이 **저장된 값과 같다** — 명령의 도면은 모두 `effectiveMaps`(초안이 이기는 값)에서 만들고, `expectedRevision`은 초안의 `baseRevision`이다(mapWorkflow.ts:40-43). 그래서 다시 놓아도 잃는 편집이 없다. 저장이 도는 동안에는 `canEdit`이 거짓이라 초안이 그 사이에 바뀌지도 않는다.

저장이 도면의 정체나 트리를 바꾸는 경우: 도면의 id는 저장으로 바뀌지 않는다. 부모가 바뀌는 저장(설정의 '도면 위치', 연결)은 명령의 도면에 새 `parentId`가 들어 있고 다시 놓인 초안이 그 값을 가진다 — 트리는 `effectiveMaps`에서 그리므로 바로 맞는다. 새 도면(`expectedRevision`이 `null`)은 `savedMaps`가 버전 1로 만든다(`enterNewMap`이 쓰는 값과 같다).

### 4.4 깨끗한 초안은 라이브러리를 따라간다

**왜 필요한가.** 초안은 스냅샷이 어디로 갔든 늘 이긴다(2.1). 지금은 저장하면 초안이 사라져 화면이 다시 라이브러리를 따른다. 답 1 뒤에는 깨끗한 초안이 몇 시간이고 열려 있을 수 있다 — 사무실 PC를 편집 중인 채 두고 집 PC에서 같은 도면을 고치면, 사무실 PC는 '편집 끝내기' 전까지 옛 모습을 보이고 그 위에서 한 작업은 저장이 거절되며, 푸는 길은 버리고 다시 하는 것뿐이다. 깨끗한 초안에는 잃을 것이 없으므로 따라가게 한다.

**없어진 도면도 같은 까닭이다.** 초안은 스냅샷에 그 도면이 없어도 도면을 목록에 도로 넣는다(`effectiveMaps`, mapWorkflow.ts:16-20). 지금은 깨끗한 초안이 저장을 넘겨 살아남지 못하므로(`dropDrafts`, :462) 문제가 아니었다. 답 1 뒤에는 저장한 도면마다 깨끗한 초안이 남는다 — 보이지 않는 채 남는 것(연결·만들기의 부모)까지. 그 도면을 다른 PC가 지우면 이 PC의 목록에는 **편집 중인, 편집할 수 있어 보이는 도면**으로 남고, 고쳐서 저장하면 "다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요."로 거절되며(domain.ts:144 — 버전을 기대했는데 도면이 없다), 새로고침은 아무것도 풀지 못한다. 그래서 깨끗한 초안은 라이브러리에서 그 도면이 없어지면 함께 없어진다.

```ts
    case 'follow-saved': {
      // The library moved on under a draft with nothing unsaved in it: that draft follows. A draft with unsaved edits,
      // one that is being dragged, and one already on that revision or a later one are left as they are.
      const followed = rebaseDrafts(state, action.maps, (draft, map) => !mapDraftChanged(draft) && state.gesture?.mapId !== map.id && map.revision > (draft.baseRevision ?? Infinity));
      // A draft with nothing unsaved in it whose map the library no longer has (deleted elsewhere) goes: kept, it would put
      // the map back in the tree as one that can be edited and never saved. A map that was never saved counts as changed.
      const known = new Set(action.maps.map(map => map.id));
      const gone = Object.keys(followed.drafts).filter(id => !known.has(id) && !mapDraftChanged(followed.drafts[id]) && followed.gesture?.mapId !== id);
      if (!gone.length) return followed;
      const drafts = { ...followed.drafts };
      for (const id of gone) delete drafts[id];
      return { ...followed, drafts };
    }
```

`dropDrafts`를 쓰지 않는다 — 그 함수는 합치는 중인 칸 편집(`coalescing`)을 늘 끝내는데, 여기서 없어지는 초안은 깨끗해서 그런 편집이 없고, 다른 도면에서 치던 값의 단계를 끊을 까닭이 없다.

편집기(`useEffect(() => { if (!snapshot.canManage) …`, :326 다음에 둔다):

```ts
// Saving no longer ends edit mode, so a draft can stay open for hours. One with nothing unsaved in it follows the library
// when its map is saved elsewhere, and goes when its map is deleted there.
const followSaved = useEvent(() => {
  // Never while a save runs: the store then shows maps that are not confirmed yet. Never during a drag. And never under an
  // open dialog of the editor: it asks about the map on show, and that must still be the same map when it is answered.
  if (disabled || doc.isGestureActive() || confirmation || createForm || linkForm || settingsForm) return;
  const before = mapDraft(doc.getState(), current?.id);
  doc.followSaved(snapshot.maps);
  // The map on show was replaced under the picked point: its index may now name another point (as after an undo).
  if (mapDraft(doc.getState(), current?.id) !== before) setActiveVertex(null);
  // The map on show went with its draft: the screen moves on to another map without `navigate`, so what `navigate` clears is cleared here.
  if (before && !mapDraft(doc.getState(), current?.id)) { setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); }
});
// The four dialogs are in the list so that this runs again as one of them closes.
useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, confirmation, createForm, linkForm, settingsForm]);
```

**창이 열려 있는 동안에는 따라가지 않는 까닭.** 편집기의 창 넷(버리기·삭제 확인 `confirmation`, 도면 만들기 `createForm`, 기존 도면 연결 `linkForm`, 도면 설정 `settingsForm`)은 **보던 도면에 대고** 묻는다. 창을 그리는 조건(`{confirmation && current && …}`, :1202 — 도면별 `key`가 없고 제목에 도면 이름이 없다)도, 답하는 함수(`current.id`, :565, :575)도 그 렌더의 `current`를 읽는다. 편집 중에는 초안이 보던 도면을 붙들고 있어서(2.1), 보던 도면이 바뀌는 길은 모두 사용자의 동작이고 열려 있던 창을 함께 닫는다(`navigate` :426 — 확인 창. 새 도면으로 들어가기 :590·:597 — 만들기 창. 삭제 뒤 부모로 :571·:577 — 확인 창. 연결 뒤 자식으로 :607-608 — 연결 창). **따라가기의 "없어짐"은 사용자의 동작 없이 보던 도면을 목록의 첫 도면으로 바꾸는, 편집 중의 하나뿐인 길이다**(`maps.find(…) ?? maps[0]`, :249). 창이 열린 채 그 일이 일어나면 창이 다른 도면에 대고 답한다:

- **응답을 잃은 '도면 삭제'.** 삭제는 들어갔는데 답이 오지 않으면, 저장소는 다시 읽은 스냅샷(그 도면이 없다)을 놓고 던진다(useBackgroundStore.ts:59-71 — "들어갔는지" 확인해 성공으로 치는 길은 `save-maps`에만 있다). 편집기는 오류를 **열린 채인** 확인 창 안에 보이고 `busy`를 끈다(:578). 그때 따라가기가 돌면 깨끗한 초안이 없어져 보던 도면이 목록의 첫 도면이 되고, '삭제'를 다시 누르면 **그 첫 도면에 삭제가 나간다**(그 도면 자신의 버전으로 — 하위 도면과 연결이 없으면 통과한다. 임시 폴더에서 실제 저장소로 확인했다, 16절). 지금은 편집 중이면 초안이 지운 도면을 화면에 붙들어 두어, 다시 누른 삭제가 "다른 사용자가 내용을 변경했습니다…"로 거절된다(domain.ts:152). 답 1로 "깨끗한 초안으로 편집 중"이 저장할 때마다의 보통 상태가 되므로 그 보호를 그대로 둔다.
- **그리다 만 다각형만 있는 채 뜬 버리기 창(I9).** 창이 열린 동안 다른 PC가 그 도면을 지우면, '버리고 끝내기'의 `leaveEditing()`이 목록의 첫 도면의 초안을 버린다(`doc.discard(current.id)`, 5.1) — 그 도면의 저장 안 한 편집이 사라진다.
- 설정·연결·만들기 창은 열 때의 도면 값과 버전을 쥐고 있다(`settingsForm`·`settingsRevision`, `linkForm.spaceId`, `createForm.parentId`·`spaceId`). 그 밑에서 초안만 새 버전으로 바뀌어도 얻는 것이 없다.

그래서 넷 가운데 하나라도 열려 있으면 부르지 않고, effect의 의존 목록에 넷을 넣어 **창이 닫힐 때 다시 돈다.** 창 안에서 다시 누른 삭제는 지금처럼 남아 있는 초안을 만나 거절되고, '돌아가기'로 창을 닫으면 그때 그 도면이 목록에서 빠진다. 만들기·설정 창의 칸을 칠 때마다 effect가 다시 돌지만 첫 줄에서 돌아간다.

**보던 도면이 없어졌을 때 비우는 것.** `navigate`는 도면을 바꾸며 그 도면에 딸린 화면 상태를 비운다: 그리다 만 다각형의 점, 도구, 기호 목록, 3D의 초점 요청, 오류 글자, 확인 창(:426). 따라가기가 보던 도면의 초안을 치우면 `navigate` 없이 도면이 바뀌므로 같은 것을 그 자리에서 비운다(확인 창은 위의 가드 때문에 이때 열려 있지 않다). 비우지 않으면 찍던 점이 **다른 도면 위에** 그려지고(:1055는 `polygon.length`만 본다), 그 도면에서 '편집 시작'을 누르면 도구만 `select`로 돌아가서(:526-530) 다각형 줄(:1086 — 도구가 `polygon`일 때만 보인다)은 없는데 저장이 "그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요."로 거절된다(:539). 찍던 점은 버린다 — 그릴 도면이 없어졌다. 도면에 딸린 나머지는 이미 스스로 풀린다: 끌던 것·상자·화면 이동(:338), 카메라 시점(:398), 고른 점(:402), 이름 칸(:404), 저장 알림(`mapId`로 견준다, 9.2). 초안이 새 버전으로 **바뀐** 때(도면은 그대로다)는 고른 점만 푼다 — 찍던 점과 도구는 그대로 쓸 수 있다. `navigate`의 본문은 고치지 않는다(앵커 22).

**고른 점을 푸는 까닭.** 다각형의 고른 점(`activeVertex`)은 그 다각형의 점 **번호**다(:214). 점 손잡이를 눌렀다 떼기만 한 초안은 깨끗하므로 따라간다. 다른 PC의 저장이 그 다각형의 점을 바꿨다면 남은 번호는 다른 점을 가리키고(도면 id·노드 id·범위 검사를 모두 지난다, :279-280), Delete가 아무도 고르지 않은 점을 지운다(:892-896). 되돌리기가 같은 까닭으로 이미 푼다(:534). 고른 점을 푸는 기존 effect(:402)는 따라가기에서 변하지 않는 값들에 걸려 있어 이때 돌지 않는다. 보던 도면의 초안이 없어진 때도 같은 줄이 푼다.

| 경우 | 일어나는 일 |
|---|---|
| **자기 저장의 메아리**(저장 뒤의 다시 읽기, 15초마다의 읽기) | 버전이 같다 → 리듀서가 같은 상태를 돌려준다. **초안도, 다시 실행 기록도, 선택도 건드리지 않는다** |
| 깨끗한 초안 + 다른 PC의 저장 | 초안이 그 도면으로 다시 놓인다. 화면이 새 모습이 된다 |
| 모두 되돌려 깨끗해진 초안(`future`가 남아 있음) + 다른 PC의 저장 | 따라간다. **다시 실행 기록은 비워진다** — 옛 도면의 통째 값이라, 살려 두면 다시 실행한 뒤의 저장이 다른 PC의 변경을 덮는다 |
| **저장 안 한 편집이 있는 초안** + 다른 PC의 저장 | **건드리지 않는다.** 지금처럼 저장할 때 거절된다(알림은 2차) |
| 끌기 도중 | 건너뛴다. 끌기가 끝나면 effect가 다시 돈다(`gestureActive`) |
| **저장이 도는 동안**(`disabled`) | **부르지 않는다.** `pending`인 스냅샷은 낙관 값이다(2.3). 깨끗한 초안 위의 '설정 저장'이 실패하면, 그 사이에 따라간 초안은 실패한 값과 틀린 버전을 "깨끗한" 채로 쥐게 된다(임시 폴더에서 재현했다, 16절) |
| **편집기의 창이 열려 있는 동안**(버리기·삭제 확인, 도면 만들기, 기존 도면 연결, 도면 설정) | **부르지 않는다.** 창은 보던 도면에 대고 묻는다. 창이 닫히면 effect가 다시 돈다(의존 목록의 넷). 응답을 잃은 삭제 뒤 창 안에서 다시 누른 '삭제'는 남아 있는 초안을 만나 지금처럼 거절된다 |
| 초안이 없는 도면 | 아무것도 열지 않는다 |
| **라이브러리에서 없어진 도면의 깨끗한 초안** | **없어진다.** 그 도면이 목록에서 빠진다. 보고 있던 도면이었으면 화면은 지금의 보기 모드와 같이 목록의 첫 도면으로 가고(`maps.find(…) ?? maps[0]`, :249), 그 도면에 초안이 없으면 띠가 사라진다. **`navigate`를 지나지 않고 도면이 바뀌므로 `navigate`가 비우는 것을 그 자리에서 비운다**: 그리다 만 다각형의 점, 도구(`select`로), 기호 목록, 3D의 초점 요청, 오류 글자. 끌던 것·상자·화면 이동은 그리기 전에 취소되고(:338) 열린 이름 칸은 닫힌다(:404). 선택과 보기는 도면마다 따로라 건드리지 않는다 |
| 없어진 도면의 초안인데 **저장 안 한 편집이 있다** / 끌기 도중이다 / 저장한 적 없는 도면이다(`baseRevision === null`) | **건드리지 않는다.** 저장 안 한 편집이 있는 초안은 목록에 남고 저장은 거절된다(지금과 같다. 그 알림과 "새 도면으로 저장"은 2차) |
| 저장이 도는 동안의 "없음"(낙관 값의 삭제) | 부르지 않는다(`disabled`). 확인된 스냅샷에서만 본다 |
| 고른 점이 있던 다각형의 도면이 따라갔다 | 고른 점이 풀린다. 그 뒤의 Delete는 점을 지우지 않는다(고른 점이 없을 때의 Delete — 고른 배치를 지울지 묻는다, :905-908) |

**"없음"을 믿어도 되는 까닭.** 편집기가 그려지는 동안 스냅샷이 잠깐 비어 보이는 때가 없다: 저장소가 스냅샷을 비우는 것은 `initialize`뿐이고(useBackgroundStore.ts:25) 그때는 불러오는 중이라 편집기가 그려지지 않거나(BackgroundLibraryView.tsx:147) 계정이 바뀌어 편집기가 새로 올라온다(:152의 `key`). 읽기가 실패하면 앞의 스냅샷이 남고(:39), 저장 전에 떠난 읽기의 답은 버려진다(`readTicket`, :32, :48). 방금 만든 도면의 초안(`enterNewMap`)은 저장이 확인된 **뒤에** 열리므로(:596-597) 그 도면은 이미 스냅샷에 있다.

이것은 "다른 곳에서 바뀜" **알림**이 아니다(범위 밖). 아무것도 묻지 않고, 띠의 글자도 바뀌지 않는다.

---

## 5. 편집 끝내기와 그 밖의 나가는 길

### 5.1 '편집 끝내기'

```ts
/** Edit mode ends for the map on show: its draft goes, and what was not saved goes with it. */
function leaveEditing() {
  if (!current) return;
  doc.discard(current.id);
  setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setError(''); setSavedNotice(null);
}
/** 편집 끝내기. With nothing to lose edit mode ends at once; otherwise the question comes first. */
function endEditing() {
  if (!current || !editing || disabled) return;
  abortGesture();
  // Asked when something would be lost: unsaved edits (read from the store: the press on the button has just committed
  // the field that was being typed in), or the points of a polygon that is being drawn.
  if (mapDraftChanged(mapDraft(doc.getState(), current.id)) || polygon.length) { setError(''); setConfirmation('discard'); return; }
  // The button goes away with this click. The focus goes to the canvas, or the keys would reach nothing.
  leaveEditing(); focusCanvas();
  // The band goes with it, and what is below moves up by its height: the second click of a double-click would land on
  // whatever slides under the pointer (the canvas in a narrow window, where it drops the selection or enters a space).
  swallowSecondClick();
}
```

`confirmAction`의 버리기 가지(:564-567)는 같은 함수를 쓴다:

```ts
    if (confirmation === 'discard') {
      leaveEditing();
      focusAfterConfirm.current = true; setConfirmation(null); return;
    }
```

- **잃을 것이 없으면** 묻지 않고 끝난다: 초안이 사라지고(= `editing` 거짓) 띠와 테두리가 사라지고 머리줄의 '편집 시작'이 다시 보인다. 포커스는 캔버스로 간다.
- **저장 안 한 변경이 있으면** 버리기 확인 창이 뜬다. '돌아가기'를 누르면 `BackgroundModal`이 포커스를 '편집 끝내기' 버튼으로 돌려준다(버튼이 아직 있다. 그 `focus()`에는 `preventScroll`이 없지만 — BackgroundUI.tsx:33 — 띠의 두 버튼에는 `scroll-margin-top`을 주지 않으므로 띠가 붙어 있어도 화면이 움직이지 않는다, 6.4). '버리고 끝내기'를 누르면 버튼이 사라지므로 `focusAfterConfirm`(:406-407의 기존 장치)으로 창이 닫힌 뒤 캔버스에 포커스를 준다.
- **창이 답하는 도면은 창을 연 도면이다.** `leaveEditing`은 답하는 렌더의 `current.id`를 버린다. 창이 열려 있는 동안 그 도면은 바뀌지 않는다: 초안이 그 도면을 화면에 붙들고 있고, 그 초안을 치울 수 있는 따라가기는 창이 열려 있는 동안 돌지 않는다(4.4). 그 가드가 없으면, 다각형 점만 있는 채 뜬 창 밑에서 그 도면이 다른 곳에서 지워졌을 때 '버리고 끝내기'가 목록의 첫 도면의 초안을 버린다.
- 검사는 저장소에서 지금 읽는다. 버튼을 누르는 것 자체가 치던 칸을 떠나게 하므로(blur가 클릭보다 먼저다) 그 값은 이미 초안에 들어 있다.
- **확인 창에서 누른 Esc는 창만 닫는다(게이트 B에서 고친 것).** 창은 포털로 그려지지만 그 안의 키는 React 트리를 따라 편집기의 `keyboard()`까지 올라온다. v1.134.0까지는 그 Esc가 `keyboard()`의 Escape 가지를 그대로 지나 찍던 점과 손에 든 도구를 지웠다 — '돌아가기' 버튼은 점을 남기는데 Esc는 지웠다(I9가 지키려는 바로 그 점이다). Escape 가지의 둘째 줄이 `if ((event.target as HTMLElement).closest('dialog')) return;`이다(앵커 52). 설정·연결·만들기 창에서 누른 Esc도 같은 줄에서 멈춘다.
- **묻지 않고 끝난 직후의 둘째 클릭은 삼킨다(게이트 B에서 더한 것).** 띠가 사라지면 그 아래가 띠의 높이만큼(40px, 좁은 창은 72px) 올라온다. '편집 끝내기'를 더블클릭하면 둘째 클릭이 그 자리로 올라온 것에 닿는다 — 넓은 창에서는 속성 칸의 빈 곳이지만, 900px 이하의 두 줄 배치에서는 도면이다(게이트 B에서 본 것: 고른 것이 풀렸다. 그 자리에 연결된 공간이 있으면 그 도면으로 들어간다). I11이 '편집 시작'에서 막은 일의 짝이다. `swallowSecondClick()`이 더블클릭 한 번의 길이(`SECOND_CLICK_MS` = 500ms) 동안 창 단위 캡처에서 누름 여섯 가지(`pointerdown`·`mousedown`·`pointerup`·`mouseup`·`click`·`dblclick`)를 멈추고 스스로 떼어 낸다. 키보드는 막지 않는다. 확인 창을 거쳐 끝나는 길에는 없다(그때 띠는 창의 버튼을 누를 때 사라진다).
- **편집을 끝내면 기호 팔레트도 닫힌다(게이트 B에서 고친 것).** `leaveEditing`이 `setSymbolPaletteOpen(false)`를 부른다. 묻지 않고 끝나는 길이 생기면서, 팔레트를 연 채 '편집 끝내기' → '편집 시작' 두 번의 클릭으로 팔레트가 시키지 않았는데 열려 있었다.
- **그리다 만 다각형이 있으면 묻는다(I9).** 찍던 점(`polygon` — 초안의 일부가 아니라 화면 상태다)은 편집이 끝나면 사라지는 작업이다. 지금의 '취소'는 늘 묻고 '돌아가기'는 점을 그대로 둔다(확인 창은 `polygon`을 건드리지 않는다) — 그 보호를 그대로 둔다. `polygon`은 클릭으로만 바뀌는 React 상태라 이 클릭의 렌더가 쥔 값이 지금 값이다. 초안이 깨끗한 채 점만 있을 때의 창은 그 경우의 제목과 문장을 쓴다(5.2).
- **모두 되돌린 초안은 "잃을 것이 없다"에 든다(I10).** `mapDraftChanged`는 '다시 실행' 기록(`future`)을 보지 않는다(3.2). 열 번 고치고 열 번 되돌린 뒤 '편집 끝내기'를 누르면 묻지 않고 끝나고, 그 열 번은 다시 실행할 수 없게 된다. 저장과 따라가기도 그 기록을 비운다(4.1, 4.4) — 같은 규칙이다.
- 저장이 도는 동안에는 버튼이 꺼져 있다(`disabled`).
- '편집 끝내기'를 누른 뒤에도 선택과 보기는 그대로다(지금의 '취소'와 같다).

### 5.2 버리기 확인 창

| 곳 | 지금 | 이제 |
|---|---|---|
| 제목 — 저장 안 한 변경이 있을 때 | 도면 편집을 취소할까요? | **저장하지 않고 편집을 끝낼까요?** |
| 제목 — 초안은 깨끗하고 그리다 만 다각형만 있을 때 | (같은 제목) | **편집을 끝낼까요?** |
| 글 — 저장 안 한 변경이 있을 때 | 이 도면에서 저장하지 않은 변경사항은 사라집니다. | **이 도면에서 저장 안 한 변경은 사라져요.** |
| 글 — 초안은 깨끗하고 그리다 만 다각형만 있을 때 | (같은 글) | **그리던 다각형이 사라져요.** |
| 버튼 | 돌아가기 / 변경사항 버리기 | 돌아가기 / **버리고 끝내기** |

```tsx
title={confirmation === 'discard' ? (draftChanged ? '저장하지 않고 편집을 끝낼까요?' : '편집을 끝낼까요?') : confirmation === 'delete-map' ? …}
…
{confirmation === 'discard' ? (draftChanged ? '이 도면에서 저장 안 한 변경은 사라져요.' : '그리던 다각형이 사라져요.') : confirmation === 'delete-map' ? …}
…
{confirmation === 'discard' ? '버리고 끝내기' : '삭제'}
```

- 창을 여는 버튼의 이름이 '취소'에서 '편집 끝내기'로 바뀌었으므로 제목을 바꾼다. 창을 여는 곳은 이제 `endEditing` 하나다(편집기 전체에 `setConfirmation('discard')`가 한 번).
- **말은 하나로 쓴다.** 띠가 "저장 안 한 변경"이라고 하므로 창의 글과 도면 목록 점의 풍선(6.7)도 그 말을 쓴다(지금은 "저장하지 않은 변경사항" / "저장 전 변경사항"으로 셋이 달랐다). 버튼은 두 경우에 모두 맞는 '버리고 끝내기'다 — 다각형만 있을 때 '변경사항 버리기'는 띠의 "저장된 그대로예요"와 어긋난다.
- **제목도 같은 까닭으로 두 경우를 가른다.** 다각형만 있을 때는 띠가 "저장된 그대로예요"이고 저장 버튼이 흐려져 있으며, 찍던 점은 저장할 수 있는 것이 아니다(저장은 그 점들 때문에 거절된다, 4.2). 그때 "저장하지 않고 편집을 끝낼까요?"라고 물으면 저장할 것이 있는 것처럼 읽힌다 — 그 경우의 제목은 "편집을 끝낼까요?"다.
- 제목과 글은 렌더의 `draftChanged`(:941)로 고른다. 창이 떠 있는 렌더의 값이고, 창이 열려 있는 동안 초안은 바뀌지 않는다(편집은 창에 막혀 있고, 따라가기는 창이 열려 있는 동안 돌지 않는다 — 4.4). 둘 다 있을 때(바뀐 초안 + 그리다 만 다각형)는 바뀜 쪽의 제목과 글이다.
- 같은 라이브러리의 '에피소드별 배경' 탭은 자기 문구("저장 전 변경사항이 있습니다", BackgroundEpisodePanel.tsx:182)를 그대로 둔다 — 다른 탭이고 이번 범위 밖이다.

2026-10-11의 배움 가운데 이 창에 닿는 것: 이 창은 **사용자의 클릭으로** 뜨므로 "스스로 뜨는 창의 0.4초 유예"는 해당하지 않는다. 창 자체(`BackgroundModal`)는 고치지 않는다. 포커스가 창 밖(`body`)에 놓인 동안의 키는 새 Ctrl+S 리스너가 스스로 걸러 낸다(8.2) — 수동 검증에 따로 넣는다(K9).

### 5.3 그 밖의 길 — 바꾸지 않는다

| 길 | 동작(지금 그대로) |
|---|---|
| **Esc** | 끌던 것·상자를 취소하거나, 그리다 만 다각형을 버리고 도구를 `select`로 돌린다(:871-876). **편집을 끝내지 않는다** |
| **다른 도면으로**(트리·경로·하위 도면·더블클릭 → `navigate`, :426) | 묻지 않고 간다. 떠난 도면의 초안은 그대로 남고 트리의 점이 그 도면을 가리킨다. 간 도면에 초안이 없으면 띠가 없고(보기), 돌아오면 띠와 수가 그대로 있다. 저장이 도는 동안에는 가지 못한다 |
| 배경 화면 안의 다른 탭 | 편집기가 숨겨진 채 남는다. 돌아오면 그대로다. 숨겨진 동안 Ctrl+S는 듣지 않는다(8.2) |
| 다른 메뉴 · 로그아웃 · 앱 종료 · 업데이트 안내 | 편집기가 내려가고 초안이 사라진다(2차가 다룬다). 깨끗한 초안은 잃는 것이 없다 |
| 권한을 잃음 | `editing`이 거짓이 되어 띠·테두리가 사라진다. 초안은 문서에 남는다(2차) |

표에 없는, 편집이 끝나는 길은 셋이다: 도면 삭제와 `createMap`의 다시 시도 가지(둘 다 지금 그대로, 4.3), 그리고 깨끗한 초안의 도면이 다른 곳에서 지워졌을 때(새 동작, 4.4).

---

## 6. 띠와 테두리

### 6.1 컴포넌트 — `BackgroundMapEditStrip.tsx` (새 파일)

받은 것만 그린다. 상태도 타이머도 없다.

```tsx
import type { JSX } from 'react';
import { MAP_EDIT_LABEL } from './mapEditStatus';
import type { MapEditStatus } from './mapEditStatus';

/**
 * The band over the map while it is edited: what is unsaved, and the two buttons. One element for the plan and for 3D.
 * It draws what it is given, and its height never depends on what it says.
 */
export function BackgroundMapEditStrip({ status, disabled, onEnd, onSave }: {
  status: MapEditStatus;
  /** A save or another action of the editor is running: neither button does anything. */
  disabled: boolean;
  onEnd(): void; onSave(): void }): JSX.Element {
  const idle = !status.canSave || disabled;
  return <section className="bmap-edit-strip" data-phase={status.phase} aria-label="도면 편집 상태">
    <p className="bmap-edit-state"><strong>{MAP_EDIT_LABEL}</strong><span>{status.detail}</span></p>
    {/* Told as it happens, and only the save: the count changes with every edit and would be read out each time. */}
    <span className="sr-only" role="status">{status.announce}</span>
    <span className="bmap-edit-key" aria-hidden="true">Ctrl+S</span>
    <div className="bmap-edit-actions">
      <button type="button" className="bmap-edit-end" disabled={disabled} onClick={onEnd}>편집 끝내기</button>
      {/* Never `disabled`: it is dimmed and says why, stays in the Tab order, and a press on it while dimmed does nothing. */}
      <button type="button" className="bmap-edit-save" aria-disabled={idle} aria-keyshortcuts="Control+S"
        title={status.canSave ? '도면 저장 (Ctrl+S)' : status.phase === 'saving' ? undefined : '저장할 변경이 없어요'}
        onClick={() => { if (!idle) onSave(); }}>{status.saveLabel}</button>
    </div>
  </section>;
}
```

- `sr-only`는 앱이 이미 쓰는 Tailwind 클래스다(`src/components/calendar/EventQuickEdit.tsx:425`).
- '도면 저장'에 `disabled`를 쓰지 않는 까닭: 이 기능의 선례와 같다(`BackgroundMapCameraColor.tsx:19-21` — 할 일이 없을 때 `aria-disabled`로 흐리게). 흐린 버튼은 Tab으로 닿고 "저장할 변경이 없어요"를 말한다.
- 편집기에서 그리는 줄(안내 :982 다음, `<BackgroundMapPanels` 앞):

```tsx
{editing && draft && <BackgroundMapEditStrip status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id)} disabled={disabled} onEnd={endEditing} onSave={requestSave} />}
```

- **이 태그의 네 속성과 위 마크업의 꼴은 계약이다**(앵커가 글자 그대로 고정한다, 11.4). `onEnd`는 `endEditing`이다 — `leaveEditing`을 바로 이으면 저장 안 한 편집이 묻지 않고 사라진다(앵커 52, `disabled={disabled}`도 함께). `onSave`는 `requestSave`(앵커 53), `status`의 식은 앵커 57. 띠 파일의 `data-phase={status.phase}`와 `.bmap-edit-state` 안의 `<strong>`·`<span>`은 6.8의 CSS가 거는 자리다 — 속성 이름이 바뀌거나 글자가 `<span>` 밖으로 나가면 알약과 ✓가 그려지지 않아 세 상태가 모양으로 갈리지 않는다(I2, 앵커 54). 띠 파일의 `const idle = !status.canSave || disabled;`와 저장 버튼의 `title` 식도 계약이다(앵커 51) — `idle`이 `disabled`만 보면 저장할 것이 없을 때도 버튼이 켜진 모습이 되고(눌러도 `saveMap`이 돌아가므로 모습만 틀린다), 풍선의 '저장할 변경이 없어요'는 흐린 버튼이 왜 눌리지 않는지를 말해 주는 하나뿐인 글이다(3.3).

### 6.2 놓이는 자리 — 평면과 3D에 요소 하나

- **`.bmap-main`의 자식**이다: 머리줄 → [오류 띠] → [안내] → **띠** → `BackgroundMapPanels`. 평면과 3D가 갈리는 곳은 `.bmap-canvas-wrap` 안이므로(2.6) 모드를 바꿔도 **같은 DOM 요소**가 같은 자리에 있다.
- 띠의 붙는 범위는 `.bmap-main` 전체(머리줄부터 이미지 목록까지)다. 그래서 좁은 창에서 속성 칸이나 이미지 목록까지 내려가도 띠가 탭의 맨 위에 붙어 있다.
- `.bmap-main`에 편집 중 표시를 단다(:977의 둘째 가지. 도면이 없을 때의 `<div className="bmap-main">`은 그대로다):

```tsx
<main className={`bmap-main${editing ? ' is-editing' : ''}`}>
```

- **띠가 생기고 사라지는 때는 `editing`이 바뀔 때뿐이다**: 편집 시작(버튼·＋ 공간 그리기·도면 만들기), 편집 끝내기(바로 또는 확인 뒤), 도면 삭제, 다른 도면으로, 권한을 잃거나 얻음, 보던 도면이 다른 곳에서 지워져 깨끗한 초안이 없어짐(4.4). 어느 것도 끌기 도중일 수 없다 — `canEdit`이나 도면이 바뀌면 그리기 전에 끌던 것이 취소되고(`useLayoutEffect`, :338), 저장 중에는 누름을 받지 않는다(:693), 따라가기는 문서의 제스처가 도는 동안 부르지 않는다. 저장은 띠를 건드리지 않는다(4.1). `canEdit`에 달지 않는다 — 저장할 때마다 띠가 깜빡이고 도면이 흔들린다.
- 편집기의 빨간 띠(:981)에 `ref={errorRef}`를 단다(4.2). 그 줄의 조건과 글자는 그대로다.

### 6.3 높이는 고정이다

| 창 폭 | 띠 | 높이(`--bmap-edit-h`) |
|---|---|---|
| 901px 이상 | 한 줄: `편집 중 · 글자` … `Ctrl+S` `편집 끝내기` `도면 저장` | 40px |
| 900px 이하 | 두 줄: 글자 줄 / 버튼 줄(오른쪽 맞춤: `Ctrl+S` `편집 끝내기` `도면 저장`) | 72px |

- 높이는 **창 폭으로만** 정해진다. 글자(`.bmap-edit-state`)는 한 줄이고 줄바꿈하지 않으며(`white-space:nowrap; overflow:hidden`) 띠는 `height`가 못 박혀 있다. 수가 9에서 10, 99에서 100이 되어도, "저장 중…"이 "도면을 저장했어요"가 되어도, 글자가 알약 모양이 되어도(위아래 2px씩 — 한 줄 40px, 두 줄 72px 안에 든다: 23 + 6 + 28 = 57px) 높이가 변하지 않는다.
- **글자 줄의 높이도 글자에 따라 변하지 않는다**(`.bmap-edit-state`의 `min-height:23px`). 맨 글자의 줄은 18.6px(12px × 줄 높이 1.55 — backgrounds.css:11)이고 알약이 되면 22.6px이다. 한 줄 배치에서는 띠가 40px 한 줄이라 차이가 없지만, 두 줄 배치는 두 줄을 함께 가운데에 놓으므로(`align-content:center`) 첫 줄이 4px 커지면 **버튼 줄이 2px 내려간다**(버튼 줄의 위쪽: (72 − 52.6) ÷ 2 + 18.6 + 6 = 34.3px → (72 − 56.6) ÷ 2 + 22.6 + 6 = 36.3px, 계산) — 첫 편집에서 내려가고 저장하거나 모두 되돌리면 올라오며, 저장할 때는 누르고 있는 버튼이 포인터 밑에서 움직인다. 첫 줄을 늘 23px로 두면 위의 합(57px)이 어느 상태에서나 그대로다(E4가 위쪽 가장자리도 잰다).
- **가로 배치도 변하지 않는다.** 오른쪽의 `Ctrl+S`·두 버튼은 글자 길이와 무관하게 제자리다(글자 쪽이 남는 폭을 다 갖는다). 저장 버튼은 '도면 저장'과 '저장 중…' 사이에서, 그리고 켜짐과 흐림 사이에서 폭이 변하지 않게 굵기를 하나로 두고 최소 폭을 준다(6.8) — 그렇지 않으면 바뀜 → 저장 중 → 방금 저장함의 1초 사이에 옆의 '편집 끝내기'와 `Ctrl+S`가 두 번 몇 픽셀씩 밀린다.
- **글자가 다 들어가지 않으면 말줄임표로 끝난다**(`text-overflow:ellipsis`). 줄일 수 없는 글자는 표시 없이 잘려 나가고, 맨 먼저 잘리는 것이 수("N개")다 — 잘렸다는 것이 보여야 한다.
- 폭의 근거(계산 — 앱 엔진에서 잰다, E4·L2): 한 줄에 필요한 폭은 약 460px이다(좌우 여백 30 — 창 폭 1,100px 이하에서는 왼쪽을 머리줄에 맞춰 26, 6.8 — + '편집 중' 40 + 틈 8 + 알약 '저장 안 한 변경 100개' 약 145 + 틈 10 + `Ctrl+S` 44 + 틈 10 + 두 버튼 약 174). 901px 창에서 `.bmap-main`은 사이드바를 접으면 660px, **펼치면 532px**이다(901 − 사이드바 64 또는 192 − `<main>`의 여백 32 − 도면 목록 145: 목록 폭은 1,200px 이하에서 155, 1,100px 이하에서 145, 900px 이하에서 135다 — backgrounds-map.css:22, :162, :235, :282). 여유가 약 70px이고, 띠의 글자는 사용자가 고른 글꼴과 자간을 따른다(`src/index.css:20-25` — 여기서 못 박는 것은 크기뿐이다). 그래서 이 폭은 계산으로 약속하지 않고 **잰다**(E4: 901px에서 사이드바를 펼치고 가장 긴 글자들로). 740px 창에서는 509px(사이드바 접음) / 381px(펼침)이라 한 줄을 약속할 수 없다. 두 줄은 381px에서도 들어간다(글자 줄 약 220px, 버튼 줄 약 255px). 사이드바를 펼치면 창 폭은 그대로인데 `.bmap-main`이 128px 줄어들므로, 한 줄·두 줄의 경계를 이 파일의 다른 규칙처럼 900px에 둔다.

### 6.4 sticky와 `overflow` — 바뀌는 CSS 줄

띠는 `position:sticky; top:0`이다. 스크롤 상자(`.bg-tab-content`)까지의 조상 둘이 스크롤 컨테이너라서(2.6) 그 둘만 바꾼다.

| 줄 | 지금 | 이제 |
|---|---|---|
| backgrounds-map.css:1 `.bmap-layout { … }` | `overflow:hidden` | `overflow:clip` |
| backgrounds-map.css:32 `.bmap-main { … }` | `overflow:hidden` | `overflow:clip` |

**다른 것이 다르게 스크롤하지 않는다는 근거.**

- `clip`도 `hidden`과 같은 자리(패딩 상자)에서 잘라 낸다. 보이는 것이 같다.
- 다른 점은 둘이다. (가) `clip`은 스크롤 컨테이너가 아니다 — 그것이 목적이다. (나) 스크롤 컨테이너인 flex 항목은 자동 최소 크기가 0인데 `clip`은 아니다. `.bmap-main`은 `min-width:0; min-height:0`을 이미 적어 두었고(backgrounds-map.css:32), `.bmap-layout`은 flex 항목이 아니다(블록인 `.bg-tab-content`의 자식).
- 두 상자를 스크립트로 스크롤하는 곳이 없다: `src/features/backgrounds`에 `scrollIntoView`·`scrollTop`·`scrollTo`·`scrollBy`가 없다(grep). `hidden` 상자는 `focus()`가 안에서 스크롤시킬 수 있었는데(:698의 `svgRef.current?.focus()`는 `preventScroll`이 없다) `clip`은 그럴 수 없다 — 줄어드는 쪽이다. 이 설계가 더하는 `scrollIntoView` 하나(거절된 저장의 까닭, 4.2)는 스크롤 상자(`.bg-tab-content`)를 움직인다 — 두 상자는 더는 스크롤 컨테이너가 아니다.
- 안쪽의 스크롤 상자들(backgrounds-map.css — 트리 :22, 속성 칸 :128, 목록 :146, 이미지 목록 :262, 기호 목록 :207)은 손대지 않는다. 바깥의 `.bg-library-body`·`.bg-library-shell`(`hidden`)은 스크롤 상자보다 **위**라 sticky와 무관하다.
- 조상에 transform·filter·`contain: paint`가 없다(앱이 `<main>`에 일부러 두지 않는다, `src/components/layout/MainLayout.tsx:31-32`).
- `overflow:clip`은 Chromium 90부터 있다(앱은 130).

띠의 `z-index`는 5다 — 붙어 있는 동안 그 밑으로 지나가는 도구줄(2, backgrounds-map.css:54)과 이름 칸(3, backgrounds-map.css:125)보다 위다. **이 값이 없으면 띠가 도면 밑에 깔린다**: 띠 뒤에 오는 `.bmap-canvas-wrap`은 `container: … / size`(backgrounds-map.css:53)라 쌓임 맥락이고, 문서 순서가 뒤라 붙어 있는 띠 위에 그려진다(앵커 54가 이 값을 고정한다). 띠는 불투명하고 `backdrop-filter`가 없다.

**띠에 가리는 포커스.** 탭이 스크롤된 채 띠가 붙어 있을 때(900px 이하에서는 늘 그럴 수 있고, 1440×900의 3D에서도) Tab이나 Shift+Tab으로 화면 위쪽의 칸·버튼에 닿으면, 브라우저는 그것을 스크롤 상자의 맨 위에 맞춰 끌어온다 — 불투명한 띠 바로 밑이다. 편집 중에는 편집기 안의 칸과 버튼에 띠 높이만큼의 여백을 준다:

```css
.bmap-main.is-editing :is(button,input,select,summary) { scroll-margin-top:var(--bmap-edit-h); }
.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }
```

- **띠 자신의 두 버튼에는 주지 않는다(둘째 줄).** 띠도 `.bmap-main.is-editing` 안에 있어서 첫 줄이 '편집 끝내기'·'도면 저장'에도 걸린다. 띠가 붙어 있을 때 그 버튼은 스크롤 상자의 맨 위에서 6px 아래(두 줄 배치에서는 약 36px 아래)에 있는데, 여백 40px(72px)을 위로 더한 상자는 스크롤 상자 **위로** 삐져나간다 — 그러면 버튼이 온전히 보이는데도 포커스가 갈 때마다 탭이 삐져나간 만큼(약 34~36px, 계산) 위로 움직인다. Tab으로 두 버튼에 닿을 때, 그리고 버리기 창의 '돌아가기'가 포커스를 '편집 끝내기'로 돌려줄 때다(`BackgroundModal`의 `previous.focus()`에는 `preventScroll`이 없다, BackgroundUI.tsx:33). 띠의 버튼은 띠에 가릴 수 없으므로 여백이 필요 없다. 둘째 줄은 첫 줄보다 무겁고(클래스 셋) 바로 뒤에 온다(E10이 본다. 엔진에서 재지 않았다 — 첫 줄이 기대는 것과 같은 동작이다).
- **도면(`[tabindex]`)에는 주지 않는다.** 평면의 SVG는 누를 때 포커스를 받는데(:698 — `preventScroll`이 없다) 그 줄은 끌기의 좌표 행렬을 잡은(:694) **뒤**다. 여백을 주면 띠 밑에 걸친 도면을 누를 때 브라우저가 "덜 보인다"고 여겨 스크롤하고, 끌던 것이 포인터에서 어긋난다. 도면은 띠보다 훨씬 크므로 위쪽 가장자리만 가려진다.
- **이 규칙과 무관한, 지금도 있는 일 하나.** 도면의 위쪽이 스크롤 상자 **위로** 올라가 있을 때(붙은 띠에 가린 것이 아니라 화면 밖) 도면을 누르면, :698의 `focus()`가 일부만 보이는 요소를 끌어오느라 탭이 움직일 수 있다 — v1.134.0에서도 같고, 위의 두 줄은 도면에 걸리지 않으므로 원인이 아니다(엔진에서 재지 않았다). 이 설계는 그 줄을 고치지 않는다(`pointerDown`은 건드리지 않는다, 10.2. 15.4에 적는다). E10은 도면의 자리를 정해 두고, 화면이 움직였을 때 이 규칙의 탓인지를 먼저 가린다(12절, 15.2).
- 스크롤 상자에 `scroll-padding`으로 주지 않는 까닭도 같다(모든 포커스 스크롤에 걸린다). 그리고 `--bmap-edit-h`는 스크롤 상자에서 보이지 않는 변수다.
- 편집기 안의 다른 스크롤 상자(속성 칸·목록)에서는 포커스된 칸이 위에서 40px 더 내려와 서는 것으로 나타난다. 해가 없다.

### 6.5 편집을 시작할 때 도면 크기가 변하지 않게

띠는 배치에 끼어든다(떠 있게 하면 16px에 떠 있는 도구줄을 덮는다). 그 40px을 **도면이 아니라 이미지 목록이 낸다.**

```css
@media(min-width:901px) {
  /* (기존 세 줄 뒤에) While editing the band takes its height from the image list, not from the map: the canvas keeps its size as edit mode starts and ends. */
  .bmap-layout:has(.bmap-main.is-editing) { min-height:calc(500px + var(--bmap-edit-h)); }
  .bmap-layout:has(.bmap-main.is-editing):has(.bmap-canvas-wrap.is-3d) { min-height:calc(760px + var(--bmap-edit-h)); }
  .bmap-main.is-editing .bmap-panels:not(.is-sized)>.bmap-gallery { flex-basis:calc(clamp(248px,33dvh,370px) - var(--bmap-edit-h)); }
}
```

| 창 | 편집을 시작하면 |
|---|---|
| 901px 이상, 도면 높이를 손잡이로 정하지 않음 | 도면·속성 칸의 크기는 그대로다. 띠가 그 위에 끼고(도면이 40px 내려간다) 이미지 목록이 40px 짧아진다(기준 높이가 가장 낮을 때 208px이고, 창이 낮아 더 줄어들 때도 목록의 최소 높이 160px은 지킨다, backgrounds-map.css:45) |
| 901px 이상, 손잡이로 정함(`is-sized`) | 도면은 정한 높이 그대로이고 이미지 목록이 줄어든다. **정한 높이가 최대치에 닿아 있던 경우에만** 최대치가 40px 줄어 도면도 그만큼 줄어든다(BackgroundMapPanels.tsx:36-37) |
| 901px 이상, 창이 낮아 탭이 최소 높이보다 낮음(**1440×900의 3D가 여기다** — 탭 약 720px, 최소 높이 760px) | 최소 높이가 띠만큼 는다(500 → 540, 3D 760 → 800). **도면도 이미지 목록도 크기가 그대로이고 탭이 40px 더 스크롤한다**(1440×900의 3D: 도면 영역은 최소 높이 440px, 이미지 목록은 207px로 편집 전후가 같다 — 계산). 늘리지 않으면 오류 띠까지 뜬 때 이미지 목록의 아래가 잘리는 양이 지금의 약 19px에서 59px로 는다. **늘려도 그 19px은 지금처럼 남는다**(표 아래) |
| 900px 이하 | 높이가 모두 자동이다(backgrounds-map.css:281). 도면 크기는 그대로이고 페이지가 72px 길어진다 |

- **오류 띠가 떠 있는 낮은 창 — 지키는 것은 "지금보다 더 잘리지 않는다"다.** 최소 높이는 오류 띠(약 66px: 13px × 1.55 + 위아래 여백과 테두리 22 + 바깥 여백 24, backgrounds.css:233-241)를 셈에 넣지 않는다 — 지금도 그렇다. 머리줄 73 + 오류 띠 66 + 띠 40 + `.bmap-panels`의 최소 380 = 559px이 540px에 놓이므로 이미지 목록의 아래 약 19px이 `.bmap-main`의 자름에 잘린다(3D는 819px이 800px에). v1.134.0도 519px이 500px에 놓여 같은 19px이 잘린다. 달라지는 것은 그 일이 생기는 탭 높이다: 지금은 약 519px 아래에서, 편집 중에는 약 559px 아래에서(3D는 779px → 819px). 오류 띠는 잠깐 떠 있는 것이라 그 20px을 위해 최소 높이를 더 올리지 않는다(15.4에 적는다. L3은 "편집 중의 최소 높이가 띠의 높이만큼 늘어 있고, 잘리는 양이 오류 띠가 차지하는 높이를 넘지 않는다"로 본다 — 위의 19px은 어림이고, 게이트 A의 실측은 23.2px이다: 한 줄짜리 오류 띠 42.1px에 바깥 여백과 머리줄의 실제 높이가 더해진 값. 띠의 40px은 최소 높이의 40px과 상쇄되므로 v1.134.0의 같은 오류 띠가 자르는 양과 같다).
- 세 규칙은 반드시 `@media(min-width:901px)` 안이다. 밖에 두면 900px 이하의 `min-height:0`(backgrounds-map.css:281)과 `flex:none; height:360px`(backgrounds-map.css:293)을 이긴다.
- 특이도: `.bmap-layout:has(.bmap-main.is-editing)`은 3D 규칙(`.bmap-layout:has(.bmap-canvas-wrap.is-3d)`, backgrounds-map.css:326)과 같아서 **뒤에** 적고, 둘 다일 때의 규칙이 그 둘을 이긴다.
- 편집을 시작하고 끝낼 때 도면이 40px(좁은 창 72px) 오르내리는 것은 받아들인다 — 그 순간에는 끌기가 없다(6.2).

### 6.6 테두리

```css
.bmap-main.is-editing .bmap-canvas-wrap::after { content:""; position:absolute; inset:0; z-index:1; border:2px solid rgb(var(--bmap-edit)); pointer-events:none; }
```

- 대상은 **도면 작업 영역**(`.bmap-canvas-wrap` — 평면은 도면과 바닥줄, 3D는 도구줄·두 화면·바닥줄)이다. 이미 `position:relative`다(backgrounds-map.css:53).
- **가상 요소 오버레이**인 까닭: 진짜 `border`는 내용 상자를 줄여 도면 크기를 바꾼다. 바깥 `outline`은 `.bmap-main`의 자름에 잘린다. 안쪽 그림자·안쪽 `outline`은 상자 자신과 함께 그려져 불투명한 3D 영역(backgrounds-map.css:335, backgrounds-map-3d.css:2)과 보조 평면도에 가려진다. 오버레이는 배치를 바꾸지 않고, 상자 안이라 잘리지 않고, 뒤에 그려져 3D 위에도 보인다. 이 기능의 CSS에는 `::before`·`::after`가 아직 없다(grep).
- **가리지 않아야 하는 것**: `pointer-events:none`이라 가장자리 2px에 놓인 손잡이·공간도 그대로 눌린다. 도구줄(16px 안쪽, z 2)·이름 칸(가장자리에서 4px 띄운다, z 3)과 겹치지 않고 그보다 아래다(z 1).
- 띠는 속성 칸까지 걸쳐 있고(`.bmap-main` 폭) 테두리는 도면 영역만 두른다. 네 변을 모두 그려서, 띠가 스크롤로 떨어져 있을 때도 도면의 테두리가 온전하다.

### 6.7 머리줄 — 나가는 것과 남는 것, 조용한 '편집 시작', 예전 배지, 트리의 점

| 것 | 지금 | 이제 |
|---|---|---|
| `속성 접기/열기` | 머리줄 | 그대로 |
| `도면 설정` | 머리줄(권한이 있을 때) | 그대로 |
| `취소` | 머리줄(편집 중) | **없앤다.** 띠의 '편집 끝내기'가 대신한다 |
| `도면 저장` | 머리줄(편집 중), 보라색 | **띠로 옮긴다** |
| `공간 편집` | 머리줄(보기), 보라색 `bg-button bg-primary` | **`편집 시작`**, 클래스 `bg-button bmap-edit-start` — 모습은 이 라이브러리의 기본 버튼(1px 테두리, 카드 바탕, 본문 글자색. backgrounds.css:21-38) 그대로다. 두 화면 모두 테마 변수에서 색이 오므로 따로 적을 색이 없다. 옆의 `bmap-quiet`(테두리 없음) 둘보다는 또렷하고 보라색은 아니다. **편집 중에는 자리를 지킨 채 보이지 않는다**(아래) |
| 제목 옆 배지(:978) | '편집 중' / '저장 전 변경사항' | **없앤다.** 띠가 같은 말을 한다. 좁은 창에서 첫 편집에 머리줄 높이가 변하던 것도 함께 없어진다. 그 글자를 고정한 테스트는 없다 |
| 트리의 점(:972) | `#eab76b`, 풍선 "저장 전 변경사항" | **표시·조건은 그대로.** 색은 `rgb(var(--bmap-edit))`, 풍선은 띠와 같은 말 **"저장 안 한 변경이 있어요"**(I6) |

**'편집 시작'은 편집 중에도 자리를 지킨다.** 머리줄의 버튼들은 오른쪽으로 붙어 있다(`.bmap-header`의 `space-between`, backgrounds-map.css:33). '편집 시작'이 자기 클릭으로 **없어지면** 바로 왼쪽의 '도면 설정'이 그 자리로 밀려와 포인터 밑에 놓이고(두 버튼의 폭이 거의 같다), 더블클릭의 둘째 클릭이 설정 창을 연다 — 편집에 들어가자마자 창이 뜬다. 지금은 같은 더블클릭이 '도면 저장'에 떨어진다. 그래서 버튼을 빼지 않고 감춘다:

```tsx
<button type="button" className="bg-button bmap-edit-start" disabled={disabled || editing} aria-hidden={editing || undefined}
  onClick={() => { beginEditing(); setInspectorOpen(true); focusCanvas(); }}>편집 시작</button>
```

```css
.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }
```

- `visibility:hidden`인 요소는 자리를 차지하되 눌리지 않고, Tab으로 닿지 않고, 읽히지 않는다. `disabled`와 `aria-hidden`은 같은 뜻을 한 번 더 적은 것이다(CSS가 늦게 오거나 빠져도 눌리지 않게).
- 자리는 지금의 '공간 편집' 자리 그대로다(`snapshot.canManage &&` 안, '도면 설정' 다음). `{editing ? … : …}`의 갈림은 없어진다 — 편집 중의 두 버튼('취소', '도면 저장')이 띠로 갔기 때문이다.
- 클릭: 버튼이 자기 클릭으로 감춰지므로 포커스를 캔버스로 보낸다(지금은 `body`로 떨어져 Delete·Ctrl+Z가 닿지 않는다, 2.9).
- 편집 중의 머리줄은 보이는 버튼이 넷에서 둘로 줄고, 자리는 셋이다(지금의 넷보다 적다). **보기와 편집 사이에 머리줄의 배치가 변하지 않는다** — 900px 이하에서 줄바꿈된 머리줄의 높이도 같다.

옛 버튼 이름을 말하는 안내 글 셋을 함께 고친다(고정한 테스트 없음). **버튼의 이름('편집 시작')은 그 버튼이 화면에 있는 사람에게만 말한다** — 그 버튼은 편집 중에는 감춰져 있고(위) 읽기 전용 계정에는 없다(R4).

| 곳 | 누가 언제 보나 | 지금 | 이제 |
|---|---|---|---|
| :1084 빈 도면의 안내(보기 모드의 가지) | 편집 중이 **아닌** 사람 — 권한이 있는 사람과 읽기 전용 계정 모두(그 줄은 `editing`으로만 갈린다) | 도면 편집에서 공간·문·사물·카메라를 배치할 수 있습니다. | 권한이 있으면(`snapshot.canManage`) **'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다.** — 그 사람에게는 그 버튼이 보인다. 읽기 전용이면 **관리자가 공간을 배치하면 여기에 표시됩니다.** |
| BackgroundMapGallery.tsx:50 — 카메라를 골랐을 때 | 권한이 있는 사람, **보기와 편집 중 모두**(이미지 목록은 `editing`을 받지 않는다, :8-10) | 공간 편집에서 이 카메라에 배경 시점을 연결해 주세요. | **도면을 편집하면서 이 카메라에 배경 시점을 연결해 주세요.** |
| 같은 줄 — 그 밖 | 같다 | 도면 설정이나 공간 편집에서 배경 장소를 연결하면 여기에 모입니다. | **도면 설정에서, 또는 도면을 편집하면서 공간에 배경 장소를 연결하면 여기에 모입니다.** |

```tsx
<span>{editing ? '도형을 고르고 빈 곳을 드래그하거나 밑그림을 올려보세요.' : snapshot.canManage ? "'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다." : '관리자가 공간을 배치하면 여기에 표시됩니다.'}</span>
```

- 이미지 목록의 두 글은 버튼 이름을 말하지 않는다. 편집 중인 사람도 보는 글이라, 그 글에 버튼 이름을 넣으면 '편집 중' 띠 바로 아래에서 보이지 않는 버튼을 누르라고 하게 된다(답 1 뒤에는 그 상태가 저장한 뒤의 보통 상태다). 이미지 목록에 `editing`을 넘기지 않는다(받는 값은 그대로다).
- 빈 도면의 안내는 읽기 전용 계정에 없는 버튼을 말하지 않는다. 읽기 전용의 문장은 같은 화면의 다른 두 안내와 같은 말투다("관리자가 도면을 등록하면 …" :977, "관리자가 도면이나 공간에 연결한 배경이 …" BackgroundMapGallery.tsx:50).
- 편집기의 그 글은 지금 작은따옴표로 싼 문자열이다. 버튼 이름의 작은따옴표가 들어가는 한 문자열만 큰따옴표로 싼다(글자는 위의 것 그대로 — 앵커 58이 찾는다).

(:1099의 "현재 공간 편집 내용도 함께 저장됩니다."는 버튼 이름이 아니라 편집한 내용을 말한다 — 그대로 둔다.)

### 6.8 CSS 전체 — `backgrounds-map.css`

이 파일은 규칙 하나가 한 줄이다(`tests/backgroundMapElements.test.ts`가 줄 단위로 읽는다). 이 절에서 줄 번호만 쓴 것은 이 파일(`backgrounds-map.css`)의 줄이다(다른 파일 이름을 붙인 번호에 바로 이어 적은 번호 둘 — 테스트의 :288-290, `backgrounds.css`의 :39-42 — 만 그 파일의 것이다).

**놓는 자리 — `.bmap-main` 규칙(:32) 바로 다음 줄부터, 아래 덩어리를 통째로.** 파일의 끝에 붙이지 않는다(v1.133.0의 규칙들이 끝에 붙어 있어 그렇게 하기 쉽다). 까닭: 900px 이하의 두 줄 배치는 `@media(max-width:900px)` 블록(:280-298) 안의 덮어쓰기로 나오는데, 그 줄들은 아래 기본 규칙과 **특이도가 같다**(`.bmap-layout`, `.bmap-edit-strip`, `.bmap-edit-state`, `.bmap-edit-key` — 클래스 하나). 같은 특이도에서는 파일에서 뒤에 오는 쪽이 이긴다. 기본 덩어리가 그 블록보다 뒤에 놓이면 `--bmap-edit-h:40px`가 72px을 이기고, 띠는 40px 높이인 채 내용만 두 줄로 접혀(23 + 6 + 28 = 57px) `overflow:hidden`에 위아래가 잘린다 — 창 폭 800~900px 전부에서(앱 창의 최소 폭이 800이다, `electron/main.ts:839`). 자동 검사는 줄이 **있는지**만 보면 이것을 놓치므로 앵커 54가 **순서**를 본다(11.4).

```css
/* Edit mode: a band over the map and a frame around it, in two colours worked out from the theme (useMapEditColors sets them on this element; these are the values of the default theme). Keep this block before the media queries: the narrow layout overrides it with rules of the same weight. */
.bmap-layout { --bmap-edit:245 178 64; --bmap-edit-ink:28 22 8; --bmap-edit-h:40px; }
.bmap-edit-strip { position:sticky; top:0; z-index:5; flex:0 0 var(--bmap-edit-h); height:var(--bmap-edit-h); display:flex; align-items:center; gap:10px; padding:0 12px 0 18px; overflow:hidden; background:rgb(var(--bmap-edit)); color:rgb(var(--bmap-edit-ink)); font-size:12px; }
/* One height whatever it says: the words in a filled box are 4px taller than bare words, and in the two-line layout a taller first line would push the buttons down under the pointer. */
.bmap-edit-state { display:flex; flex:1; min-width:0; min-height:23px; align-items:center; gap:8px; margin:0; overflow:hidden; white-space:nowrap; }
.bmap-edit-state>strong { flex-shrink:0; font-weight:700; }
/* What the band says. Where it does not fit it ends in an ellipsis: never cut without a sign. */
.bmap-edit-state>span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
/* The states are told apart by shape, not by colour or motion. Unsaved edits: the words stand in a filled box, painted like the save button beside them. */
.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span { padding:2px 9px; border-radius:999px; background:rgb(var(--bmap-edit-ink)); color:rgb(var(--bmap-edit)); font-weight:600; }
/* Just saved: bold, with a tick before the words. */
.bmap-edit-strip[data-phase="saved"] .bmap-edit-state>span { font-weight:600; }
.bmap-edit-strip[data-phase="saved"] .bmap-edit-state>span::before { content:"✓"; margin-right:5px; }
.bmap-edit-key { flex-shrink:0; padding:1px 5px; border:1px solid rgb(var(--bmap-edit-ink) / .35); border-radius:4px; font-size:10px; opacity:.8; }
.bmap-edit-actions { display:flex; flex-shrink:0; gap:6px; }
.bg-library .bmap-edit-strip button { min-height:28px; padding:0 11px; border-color:rgb(var(--bmap-edit-ink) / .45); border-radius:6px; background:transparent; color:rgb(var(--bmap-edit-ink)); font-size:12px; white-space:nowrap; }
.bg-library .bmap-edit-strip button:hover:not(:disabled) { border-color:rgb(var(--bmap-edit-ink) / .7); background:rgb(var(--bmap-edit-ink) / .12); }
.bg-library .bmap-edit-strip button:focus-visible { outline:2px solid rgb(var(--bmap-edit-ink)); outline-offset:1px; }
/* One weight and one least width whatever it says and whether it is on or dimmed: nothing beside it moves. No fade: its words would show in the colour of the band on a box that is not filled yet. */
.bg-library .bmap-edit-strip .bmap-edit-save { min-width:80px; border-color:transparent; background:rgb(var(--bmap-edit-ink)); color:rgb(var(--bmap-edit)); font-weight:600; transition:none; }
.bg-library .bmap-edit-strip .bmap-edit-save:hover:not(:disabled) { border-color:transparent; background:rgb(var(--bmap-edit-ink) / .86); }
.bg-library .bmap-edit-strip .bmap-edit-save[aria-disabled="true"],.bg-library .bmap-edit-strip .bmap-edit-save[aria-disabled="true"]:hover:not(:disabled) { border-color:rgb(var(--bmap-edit-ink) / .3); background:transparent; color:rgb(var(--bmap-edit-ink) / .55); cursor:default; }
.bmap-main.is-editing .bmap-canvas-wrap::after { content:""; position:absolute; inset:0; z-index:1; border:2px solid rgb(var(--bmap-edit)); pointer-events:none; }
/* The band stays at the top of the tab while the page scrolls under it: a field or button the keyboard brings into view stops below it. Not the canvas: it takes the focus on a press, and must not scroll then. */
.bmap-main.is-editing :is(button,input,select,summary) { scroll-margin-top:var(--bmap-edit-h); }
/* Not the two buttons of the band itself: the band cannot hide them, and with the margin a focus on them would scroll the tab while the band is stuck. */
.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }
/* 편집 시작 keeps its place in the header while editing, unseen: nothing slides under the pointer of a double-click. */
.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }
/* The band and the frame come in with edit mode. Their box is there at once: only what is inside the band moves, and only where motion is wanted. */
@keyframes bmap-edit-in { from { opacity:0; transform:translateY(-4px); } }
@keyframes bmap-edit-frame-in { from { opacity:0; } }
@media (prefers-reduced-motion: no-preference) {
  .bmap-edit-strip>* { animation:bmap-edit-in var(--motion-base) var(--ease-out) both; }
  .bmap-main.is-editing .bmap-canvas-wrap::after { animation:bmap-edit-frame-in var(--motion-base) var(--ease-out) both; }
}
```

고치는 줄:

| 줄 | 변경 |
|---|---|
| :1 `.bmap-layout { … }` | `overflow:hidden` → `overflow:clip` |
| :30 `.bmap-draft-dot { … }` | `color:#eab76b` → `color:rgb(var(--bmap-edit))` |
| :32 `.bmap-main { … }` | `overflow:hidden` → `overflow:clip`. **이 줄 바로 다음에 위의 덩어리 전체** |
| `.bmap-layout { height:auto; min-height:0; }`(900px 이하 블록의 첫 줄, 지금의 :281) | 끝에 `--bmap-edit-h:72px;` |
| `@media(max-width:900px) {` 줄 **바로 앞**에 더하기(한 줄짜리 블록) | `@media(max-width:1100px) { .bmap-edit-strip { padding-left:14px; } }` — 띠의 왼쪽을 머리줄에 맞춘다. 머리줄의 좌우 여백은 1,100px 이하에서 18px이 아니라 14px이다(지금의 :235, :279). 맞추지 않으면 그 폭에서 띠의 '편집 중'이 바로 위의 도면 제목보다 4px 안쪽에서 시작한다. 기본 덩어리보다 뒤라서 이긴다(특이도가 같다) |
| 같은 900px 이하 블록 안에 더하기(세 줄) | `.bmap-edit-strip { flex-wrap:wrap; align-content:center; row-gap:6px; }` · `.bmap-edit-state { flex:1 0 100%; }` · `.bmap-edit-key { margin-left:auto; }` — 좌우 여백은 여기서 다시 적지 않는다(왼쪽 14px은 위의 1,100px 줄에서, 오른쪽 12px은 기본 규칙에서 온다) |
| `@media(min-width:901px)` 블록(지금의 :325-329) 안에 더하기 | 6.5의 세 줄 |

900px 이하의 세 줄이 하는 일: 글자 줄이 첫 줄을 다 차지하고(`flex:1 0 100%`), `Ctrl+S` 표시와 두 버튼이 둘째 줄로 내려가 오른쪽에 붙는다(`margin-left:auto`가 표시와 그 뒤의 버튼들을 함께 민다). 보이지 않는 알림 영역(`sr-only`)은 위치가 절대라 줄에 끼지 않는다. `Ctrl+S` 표시를 감추지 않는다 — 깨끗한 상태에서는 저장 버튼의 풍선이 "저장할 변경이 없어요"라서, 감추면 좁은 창에서는 단축키가 어디에도 보이지 않는다.

지켜야 하는 것:

- **순서**: 위의 기본 규칙은 모두 `@media(max-width:900px) {` 줄보다 앞이다(이 절의 첫 문단).
- 새 변수 줄은 **따로 한 줄**이다. `.bmap-layout {`로 시작하고 `--bmap-road`를 담은 줄과 `--bmap-cam:`을 담은 줄이 각각 정확히 하나여야 한다(`tests/backgroundMapElements.test.ts:159-164`, :288-290). 새 변수 이름에는 그 글자가 없다.
- 띠의 선택자는 `.bg-library …`로 무게를 준다 — 버튼의 모습이 모두 `.bg-library button`(backgrounds.css:21-38)과 그 hover(:39-42)에서 오고, 두 CSS 파일의 묶음 순서에 기댈 수 없다(편집기 파일이 자기 CSS를, 라이브러리 화면이 자기 CSS를 따로 import한다).
- 색은 모두 두 변수에서 온다. 띠·테두리·점의 규칙에 16진수나 숫자 셋을 직접 적지 않는다(기본값 한 줄만 예외).
- **움직임**: 띠의 상자는 높이를 곧바로 다 차지한다(레이아웃 속성 전환 없음). 들어올 때 띠 **안의 것들**이 4px 내려오며 나타나고(180ms) 테두리가 나타난다 — transform·opacity뿐이고 한 번이다. 나갈 때는 움직임 없이 사라진다. 글자가 바뀔 때도 움직임이 없다. 두 `animation` 선언은 `no-preference` 블록에만 있어서, OS의 동작 줄이기와 앱 설정 '움직임: 최소'(빌드 때 `scripts/postcss-motion-minimal.cjs`가 그 블록의 규칙을 '최소'에서 빠지게 한다)에서는 **처음부터 멈춰 있는 띠와 테두리**가 보인다. 정보는 움직임에 실려 있지 않다. `@keyframes`는 블록 밖에 둔다(블록 안에는 규칙만 — 그 플러그인의 조건이다. 이 조각을 플러그인에 넣어 경고 0을 확인했다, 16절).
- 띠는 스크롤을 따라오므로 `backdrop-filter`를 쓰지 않는다. 무한 반복(깜빡이는 점)도 없다. 상태를 가르는 알약 모양과 ✓는 **멈춰 있는 표시**다 — 동작 줄이기에서도 '움직임: 최소'에서도 그대로 보인다(정보를 알려 주는 표시는 정적 대체로 남긴다는 규칙이 여기서는 처음부터 정적이다).
- 저장 버튼의 `transition:none`은 움직임을 **빼는** 줄이다. 라이브러리의 모든 버튼에 걸린 150ms 바탕색 전환(backgrounds.css:34-37)이 글자색에는 걸려 있지 않아서, 그대로 두면 깨끗함 → 바뀜의 첫 프레임들에 띠 색 글자가 아직 투명한 버튼 위에 놓여 보이지 않는다.
- `scroll-margin-top`의 대상에 `[tabindex]`를 넣지 않는다(6.4). **띠의 두 버튼에서 그 여백을 빼는 줄**(`.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }`)은 그 줄 바로 뒤에 둔다 — 빼면 띠가 붙은 채 '편집 끝내기'·'도면 저장'에 포커스가 갈 때마다 탭이 움직인다(6.4). `.bmap-edit-start`의 감춤은 `display:none`이 아니라 `visibility:hidden`이다(6.7).
- `.bmap-edit-state`의 `min-height:23px`는 알약의 높이(18.6 + 위아래 2px씩 = 22.6px)를 덮는 값이다(6.3). 알약의 위아래 여백이나 글자 크기를 키우면 이 값도 함께 올린다 — 알약이 이 값보다 커지면 두 줄 배치에서 첫 편집과 저장 때 버튼 줄이 오르내린다.

### 6.9 접근성과 키보드 순서

- 띠는 `<section aria-label="도면 편집 상태">`다. 글자(`편집 중 · 저장 안 한 변경 3개`)는 평범한 문단이라, 편집할 때마다 읽히지 않는다.
- **알림 영역**은 보이지 않는 `<span className="sr-only" role="status">` 하나이고 편집 중 내내 달려 있다. 내용이 "도면을 저장하는 중이에요" → "도면을 저장했어요"로 바뀔 때 읽힌다(`role="status"`는 정중한 알림이다). **포커스는 옮기지 않는다.**
- 버튼의 이름은 보이는 글자다('편집 끝내기', '도면 저장'/'저장 중…'). 저장 버튼에는 `aria-keyshortcuts="Control+S"`와, 꺼졌을 때 `aria-disabled="true"`·풍선 '저장할 변경이 없어요'.
- Tab 순서(DOM 순서): 도면 목록 → 경로 → `속성 접기` → `도면 설정` → **`편집 끝내기` → `도면 저장`** → 도구줄 → 도면 → 속성 칸. 저장이 가장 오른쪽이고 뒤다. 감춰진 '편집 시작'은 순서에 없다.
- 포커스 고리: 띠 위에서는 강조색 고리가 묻힐 수 있어 글자색(`--bmap-edit-ink`)으로 그린다.
- 띠가 붙어 있는 동안 Tab으로 닿은 칸·버튼은 띠 밑에 가리지 않는다(`scroll-margin-top`, 6.4).
- 상태는 색 없이도 읽힌다: 글자 자체가 다르고("저장된 …" / "저장 안 한 …"), 모양이 다르다(3.3).

---

## 7. 띠의 색 — 테마와 대비

### 7.1 순수 함수 — `mapEditColor.ts` (새 파일)

```ts
/**
 * The colours of the edit band: one that stands apart from the two colours of the theme (its accent and its second
 * accent), in a tone that stands apart from the page. No DOM, no imports: the editor feeds it what is on screen, the
 * tests feed it the presets.
 */
export type MapEditColors = { /** Fill of the band, colour of the frame and of the unsaved dot. "r g b". */ strip: string; /** Text and button lines on the band. "r g b". */ ink: string };
/**
 * The hues the band can have, the first one preferred. None is near red: an editing band is no error.
 * `bright` goes on a dark page with dark text, `deep` on a light page with white text.
 */
export const MAP_EDIT_TONES: readonly { id: string; bright: MapEditColors; deep: MapEditColors }[] = [
  { id: 'amber', bright: { strip: '245 178 64', ink: '28 22 8' }, deep: { strip: '128 81 0', ink: '255 255 255' } },
  { id: 'cyan', bright: { strip: '86 204 222', ink: '6 28 34' }, deep: { strip: '0 102 117', ink: '255 255 255' } },
  { id: 'purple', bright: { strip: '220 150 255', ink: '24 10 34' }, deep: { strip: '134 46 178', ink: '255 255 255' } },
];
/** The first tones of the list are the ones the band normally has. Those after them are a reserve. */
export const MAP_EDIT_MAIN_TONES = 2;
/** With every main tone closer than this (degrees of hue) to a colour of the theme, the reserve is looked at. */
export const MAP_EDIT_RESERVE_BELOW = 60;
/** Below this spread of the three channels (of 1) a colour has no hue to stand apart from: a grey, near-white or near-black accent. */
export const MAP_EDIT_MIN_CHROMA = 0.08;

/** "r g b" as three numbers of 0 to 255, or null. Commas and slashes are read as spaces. */
export function colorTriple(text: string): [number, number, number] | null {
  const parts = String(text).trim().split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  return parts.length === 3 && parts.every(value => Number.isFinite(value) && value >= 0 && value <= 255) ? [parts[0], parts[1], parts[2]] : null;
}
/** Hue in degrees, or null for a colour without one. */
export function colorHue(rgb: readonly number[]): number | null {
  const [r, g, b] = rgb.map(value => value / 255), max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
  if (spread < MAP_EDIT_MIN_CHROMA) return null;
  return 60 * (max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4);
}
export function hueDistance(a: number, b: number): number {
  const apart = Math.abs(a - b) % 360;
  return apart > 180 ? 360 - apart : apart;
}
function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map(value => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two colours, 1 to 21. */
export function colorContrast(a: readonly number[], b: readonly number[]): number {
  const one = luminance(a), other = luminance(b);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}
const rgbOf = (colors: MapEditColors) => colorTriple(colors.strip) as [number, number, number];

export function mapEditColors(accent: string, accentSub: string, page: string): MapEditColors {
  // The colours of the theme that have a hue. A grey, a near-white, a near-black and an unreadable value have none.
  const hues = [accent, accentSub].map(text => { const rgb = colorTriple(text); return rgb ? colorHue(rgb) : null; }).filter((hue): hue is number => hue !== null);
  let pick = MAP_EDIT_TONES[0], farthest = -1;
  // Without a hue in the theme there is nothing to stand apart from: the first of the list.
  if (hues.length) MAP_EDIT_TONES.forEach((tone, index) => {
    // A reserve tone is looked at only while every main tone is too near a colour of the theme.
    if (index >= MAP_EDIT_MAIN_TONES && farthest >= MAP_EDIT_RESERVE_BELOW) return;
    // How far the tone is from the theme: its hue distance to the nearer of the theme's colours.
    const toneHue = colorHue(rgbOf(tone.bright)) as number, apart = Math.min(...hues.map(hue => hueDistance(hue, toneHue)));
    if (apart > farthest) { farthest = apart; pick = tone; }
  });
  // Of its two tones, the one that stands out more from the page as it is painted: no attribute is asked which mode this is.
  const pageRgb = colorTriple(page);
  return !pageRgb || colorContrast(rgbOf(pick.bright), pageRgb) >= colorContrast(rgbOf(pick.deep), pageRgb) ? pick.bright : pick.deep;
}
```

- 입력은 셋이다: **테마의 두 색**의 숫자 셋(`--color-accent`, `--color-accent-sub`)과 **화면 바탕의 숫자 셋**(`--color-bg-primary`). 보조 강조색을 받는 까닭은 2.7이다 — 직접 고른 테마에서는 두 색이 무관한 색일 수 있고, 띠 옆에 실제로 그려지는 것은 보조 강조색이다. "어두운·밝은 화면"은 깃발이 아니라 바탕색으로 받는다 — 직접 고른 테마에서는 `data-color-mode`와 실제 바탕이 어긋날 수 있다(2.7). 테스트는 프리셋마다 어두운 바탕(`getPreset(id).colors.bgPrimary`)과 밝은 바탕(`getLightColors(id).bgPrimary`)을 넣는다.
- 돌려주는 것은 둘이다(숫자 셋 — 이 앱의 CSS가 색을 두는 방식): 띠의 채움 `strip`과 그 위의 글자 `ink`. **테두리와 트리의 점은 `strip`**, **버튼의 선은 `ink`에 투명도**(CSS의 `rgb(var(--bmap-edit-ink) / .45)`), 저장 버튼과 바뀜의 알약은 `ink` 바탕에 `strip` 글자다. 값이 더 필요 없다.
- 지울 수 있는 TypeScript다(타입 서술 `hue is number`와 `as`뿐). 이 함수를 그대로 임시 폴더에서 Node로 돌려 아래 수치를 냈다(16절).

### 7.2 규칙

1. **테마와의 거리**: 후보 하나가 테마에서 떨어진 정도는, 색상이 있는 테마 색(강조색·보조 강조색) 가운데 **더 가까운 쪽**까지의 색상 거리다. 한 색에서 멀어도 다른 색에 붙어 있으면 가까운 것이다.
2. **색상**: 보통의 후보는 호박(38°)과 청록(188°) 둘이다. 그 가운데 테마에서 **더 먼 쪽**을 고른다. 같으면 앞(호박). 테마의 두 색에 모두 색상이 없으면(세 채널의 차가 0.08 미만 — 회색·흰색·검정 계열, 읽을 수 없는 값) 호박.
3. **예비색**: 둘 다 테마에서 60° 안이면 **보라(280°)**를 함께 보고, 보라가 더 멀면 보라를 고른다. 테마의 두 색이 같은 계열이면(여섯 프리셋 모두) 둘 가운데 먼 쪽이 늘 75° 이상이라 보라는 나오지 않는다(7.4).
4. **톤**: 고른 색의 두 톤 가운데 **화면 바탕과 대비가 더 큰 쪽**. 어두운 바탕에서는 밝은 톤(어두운 글자), 밝은 바탕에서는 짙은 톤(흰 글자)이 된다.

**왜 목록에서 고르는가.** 후보가 강조색의 보색처럼 "돌려서" 나오면 에메랄드(160°)의 보색은 분홍빛 빨강(340°), 청록(175°)의 보색은 빨강(355°)이다 — 편집 표시가 오류처럼 읽힌다. 목록에서 고르면 그런 색이 나올 수 없다.

**왜 보통은 둘이고, 하나가 예비인가.** 테마의 색이 **하나의 계열**이면 둘로 충분하다: 두 후보의 가운데(113°, 293°)에 놓인 색에서도 75° 떨어진다. 그런데 테마의 색은 **둘**이고 직접 고른 테마에서는 서로 무관할 수 있다(2.7). 후보가 둘뿐이면 한 색이 호박 쪽, 다른 색이 청록 쪽에 있을 때 띠가 갈 곳이 없다 — 색상 쌍의 5.6%에서 띠가 테마의 어느 색과 30° 안으로 붙고(12.5%에서 45° 안), 최악은 0°다. 드문 경우가 아니다: 똥파리 골드에서 '메인 액센트'만 파랑으로 바꾸면 호박은 남아 있는 보조 강조색과 5.5°, 청록은 새 강조색과 29°다 — 한솔이 짚은 "호박색 테마에서 묻힌다"가 그대로 돌아온다. 셋째 후보가 있으면 어떤 쌍에서도 46° 이상이 남는다(7.4). 셋을 **대등하게** 두지 않는 까닭: 대등하면 보라가 노랑~초록 계열(54°~159°)에서 늘 이기게 되어 에메랄드 프리셋(160°·158°)이 호박 120.3° 대 보라 119.9°로 겨우 갈리고, 여섯 프리셋의 답이 색값 하나에 흔들린다. 예비로 두면 한 계열 테마의 답은 **둘만 있을 때와 글자 그대로 같다**(7.3의 표가 그대로다). 남는 색상 가운데 보라인 까닭: 초록(113° 쪽 빈자리)은 "완료", 분홍·자홍(293° 넘어)은 경고에 가깝다. 보라 280°는 두 후보에서 92°·118°, 빨강에서 80° 떨어져 있다.

**왜 오류처럼 읽히지 않는가.** 세 색상 모두 빨강(0°)에서 약 38° 이상 떨어져 있다(가장 가까운 호박이 37.8°, 보라 80°, 청록 172°). 이 기능의 오류색(`#ed7e79`, `#ec8c8c`)은 빨강이고 옅은 바탕의 띠다. 편집 띠는 채도 높은 색의 꽉 찬 띠에 '편집 중'이라고 적혀 있다. 호박은 이 기능이 이미 "저장 안 함"에 쓰던 색이다(트리의 점).

**이 기능이 이미 쓰는 색과의 겹침**(15.4): 호박 후보는 카메라의 기본색(33°)·3D의 카메라 시점 표시와, 청록 후보는 기호의 회청록(188°)과 색상이 같고 청록 카메라 색(175°)과 12~13° 차이다(2.7). 띠는 도면 밖의 꽉 찬 줄이고 글자가 있어 섞이지 않는다. 볼 곳은 도면을 두르는 2px 테두리다 — 수동 검증 C9·C10. 두 경우의 길은 같다: 테두리를 굵게 하고, 그래도 섞여 보이면 게이트 A에서 멈춘다(15.2).

### 7.3 여섯 프리셋 × 두 화면

계산은 위의 함수 그대로다(임시 폴더에서 돌렸다). 색상 거리는 테마의 색과 고른 띠 색의 색상 차, 대비는 WCAG 비율이다. 프리셋의 이름은 화면에 보이는 이름이다.

| 프리셋 | 화면 | 강조색(색상) | 보조 강조색(색상) | 고른 것 | 띠 `strip` | 글자 `ink` | 강조색까지 | 보조색까지 | 글자 : 띠 | 띠 : 바탕 | 띠 : 카드 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 바이올렛 드림 | 어두운 | `108 92 231` (247°) | `162 155 254` (244°) | 호박·밝은 | `245 178 64` | `28 22 8` | 151° | 154° | 9.70 | 10.18 | 9.07 |
| 바이올렛 드림 | 밝은 | 같다 | 같다 | 호박·짙은 | `128 81 0` | `255 255 255` | 151° | 154° | 6.79 | 6.10 | 6.79 |
| 공산당 레드 | 어두운 | `225 29 72` (347°) | `251 113 133` (351°) | 청록·밝은 | `86 204 222` | `6 28 34` | 159° | 163° | 9.26 | 10.40 | 9.76 |
| 공산당 레드 | 밝은 | 같다 | 같다 | 청록·짙은 | `0 102 117` | `255 255 255` | 159° | 164° | 6.65 | 5.98 | 6.65 |
| 윤성원 블루 | 어두운 | `59 130 246` (217°) | `96 165 250` (213°) | 호박·밝은 | `245 178 64` | `28 22 8` | 179° | 175° | 9.70 | 10.15 | 9.36 |
| 윤성원 블루 | 밝은 | 같다 | 같다 | 호박·짙은 | `128 81 0` | `255 255 255` | 179° | 175° | 6.79 | 6.10 | 6.79 |
| 에메랄드 | 어두운 | `16 185 129` (160°) | `52 211 153` (158°) | 호박·밝은 | `245 178 64` | `28 22 8` | 122° | 120° | 9.70 | 10.36 | 9.59 |
| 에메랄드 | 밝은 | 같다 | 같다 | 호박·짙은 | `128 81 0` | `255 255 255` | 122° | 120° | 6.79 | 6.10 | 6.79 |
| **똥파리 골드** | 어두운 | `217 119 6` (32°) | `251 191 36` (43°) | **청록**·밝은 | `86 204 222` | `6 28 34` | 156° | 145° | 9.26 | 10.24 | 9.43 |
| **똥파리 골드** | 밝은 | 같다 | 같다 | **청록**·짙은 | `0 102 117` | `255 255 255` | 156° | 144° | 6.65 | 5.98 | 6.65 |
| 이혜민 머쉬룸 | 어두운 | `129 77 65` (11°) | `224 203 175` (34°) | 청록·밝은 | `86 204 222` | `6 28 34` | 177° | 154° | 9.26 | 10.18 | 9.34 |
| 이혜민 머쉬룸 | 밝은 | 같다 | 같다 | 청록·짙은 | `0 102 117` | `255 255 255` | 176° | 153° | 6.65 | 5.98 | 6.65 |

- **열두 줄의 `strip`·`ink`는 보조 강조색을 넣기 전의 규칙(강조색만 보던 안)과 글자 그대로 같다.** 여섯 프리셋에서는 둘 가운데 먼 쪽이 테마의 두 색 모두에서 120° 이상이라 예비색을 볼 일이 없다.
- 한솔이 든 경우: 똥파리 골드에서 띠는 청록이다. 지금의 고정 호박색(`#eab76b`)은 그 강조색과 색상이 3.8° 차이, 대비 1.74:1이었다.
- 띠와 **테마 색 사이의 밝기 대비**는 지키지 않는다(열두 줄에서 테마의 두 색에 대해 1.0~4.2:1 — 예: 밝은 화면의 이혜민 머쉬룸에서 짙은 청록은 갈색 강조색과 밝기가 같고(1.03:1), 같은 줄의 보조 강조색과는 4.22:1이다. 강조색만 보면 1.0~3.6:1). 그 둘을 가르는 것은 **색상뿐**이다 — 그래서 색상 거리를 테마의 두 색 모두에 대해 지킨다. 띠가 놓이는 바탕은 테마 색이 아니라 화면 바탕이다.
- 예비색 보라의 톤(프리셋에서는 나오지 않는다): 밝은 톤 `220 150 255` + 글자 `24 10 34`(글자 : 띠 8.91, 기본 어두운 바탕 8.85, 카드 7.89), 짙은 톤 `134 46 178` + 흰 글자(6.89, 밝은 바탕 6.19, 흰 카드 6.89). 두 톤 모두 색상 280.0°.

### 7.4 고르기 어려운 테마

**(가) 두 색이 같은 계열일 때**(보조 강조색 = 강조색으로 넣었다. 프리셋과, 한 가지 색으로 맞춘 직접 고른 테마가 여기다)

| 강조색 | 읽힌 색상 | 고른 것 | 색상 거리 |
|---|---|---|---|
| 회색 `128 128 128` · 거의 흰색 `242 242 242` · 거의 검정 `16 16 16` | 없음 | 호박 | — (띠의 채도가 가른다) |
| 따뜻한 회색 `140 132 120`(채널 차 0.078) | 없음 | 호박 | — |
| 그보다 한 눈금 진한 `140 130 119`(채널 차 0.082) | 31° | 청록 | 157° |
| 흰색에 가까운 연보라 `250 250 255`(HSL로는 채도 100%지만 채널 차 0.02) | 없음 | 호박 | — |
| 두 후보의 가운데 — 연두 `45 195 34`(116°) | 116° | 호박 | 78° |
| 두 후보의 반대쪽 가운데 — 자주 `210 60 221`(296°) | 296° | 청록 | 108° |
| 순수한 빨강 `255 0 0` | 0° | 청록 | 172° |
| 청록 계열 `20 184 170`(175°) | 175° | 호박 | 137° |
| 노랑 `242 223 13`(55°) | 55° | 청록 | 133° |
| 읽을 수 없는 값 둘(빈 글자 등) | — | 호박·밝은 | — |

**(나) 두 색이 다른 계열일 때**(직접 고른 테마)

| 테마(어떻게 생기나) | 강조색 | 보조 강조색 | 강조색만 보면 | 고른 것 | 강조색까지 | 보조색까지 |
|---|---|---|---|---|---|---|
| 똥파리 골드에서 메인만 파랑으로 | `59 130 246` (217°) | `251 191 36` (43°) | 호박 — 보조색과 5.5° | **보라** | 63° | 123° |
| 이혜민 머쉬룸에서 메인만 파랑으로 | `59 130 246` (217°) | `224 203 175` (34°) | 호박 — 보조색과 3.5° | **보라** | 63° | 114° |
| 에메랄드에서 메인만 빨강으로 | `225 29 72` (347°) | `52 211 153` (158°) | 청록 — 보조색과 30° | **보라** | 67° | 122° |
| 윤성원 블루에서 메인만 빨강으로 | `225 29 72` (347°) | `96 165 250` (213°) | 청록 — 보조색과 25° | **보라** | 67° | 67° |
| 바이올렛 드림에서 메인만 빨강으로 | `225 29 72` (347°) | `162 155 254` (244°) | 청록 | 청록 | 159° | 56° |
| 바이올렛 강조색 + 노랑 보조색 `#FDCB6E` | `108 92 231` (247°) | `253 203 110` (39°) | 호박 — 보조색과 1.2° | 청록 | 59° | 149° |
| 호박 강조색 + 청록 보조색 | `217 119 6` (32°) | `34 211 238` (188°) | 청록 — 보조색과 0° | **보라** | 112° | 92° |
| 회색 강조색 + 호박 보조색 | `128 128 128` (없음) | `251 191 36` (43°) | 호박 — 보조색과 5.5° | 청록 | — | 145° |
| 읽을 수 없는 강조색 + 호박 보조색 | — | `251 191 36` (43°) | 호박 | 청록 | — | 145° |
| **가장 나쁜 쌍** — 호박 `255 162 0` (38°) + 군청 `0 26 255` (234°) | 38° | 234° | 청록 — 46° | 보라(청록과 같은 거리) | 118° | **46°** |

- 색상을 `src/themes.ts`의 `rgbToHsl`로 읽지 않는다 — 회색에 색상 0(빨강)을 돌려주고 값을 정수로 반올림한다. 이 모듈은 채널의 차로 "색상 없음"을 직접 가린다.
- **훑어본 범위 1 — 한 계열**: 색상 0~359°(1° 간격) × 채도 넷(20·35·60·100%) × 밝기 다섯(15·30·50·70·85%)의 강조색 7,200개를(보조 강조색 = 강조색), 바탕 아홉(프리셋의 어두운 바탕 여섯, 밝은 바탕, 그 강조색에서 옛 방식으로 만든 어두운·밝은 바탕 — `deriveThemeFromAccent`. 옛 자료의 대체 길로 아직 쓰인다, `src/App.tsx:1576-1582`) 위에 놓았다(64,800가지). **가장 작은 값**: 색상 거리 74.97°(만든 쪽의 색상으로 재면 74.03° — 낮은 채도에서 숫자 셋으로 반올림하며 색상이 조금 움직인다), 글자 : 띠 6.65, 띠 : 바탕 4.94, 띠 : 카드 6.49. **보라는 한 번도 나오지 않는다**(0 / 64,800) — 강조색만 보던 안과 모든 답이 같다.
- **훑어본 범위 2 — 두 계열**: 강조색의 색상 × 보조 강조색의 색상을 1° 간격으로(129,600쌍, 채도·밝기는 100%·50% / 60%·50% / 35%·30% / 60%·70%의 넷), 기본 어두운 바탕과 밝은 바탕에서. **테마의 두 색 가운데 가까운 쪽까지의 색상 거리의 최소: 46.0°**(이론값은 이웃한 두 후보 사이의 가장 좁은 간격의 절반 = 92.1° ÷ 2). 45° 안으로 붙는 쌍이 없다. 보라가 나오는 쌍은 약 19%다. 글자 : 띠 6.65 이상, 띠 : 바탕 5.98 이상. **예비색 없이 둘뿐이면**: 최소 0.3°, 30° 안이 5.6%, 45° 안이 12.5%.
- **훑어본 범위 3 — 프리셋에서 메인만 바꾼 서른 가지**(프리셋 여섯의 보조 강조색 × 다른 다섯 프리셋의 강조색): 최소 56.3°(바이올렛 드림의 보조색 + 공산당 레드의 강조색 → 청록), 열두 가지가 보라다. 강조색만 보던 안에서는 같은 서른 가지 가운데 여럿이 보조색과 30° 안이었다(위 표의 5.5°·3.5°·25°).
- **모든 톤 × 모든 바탕**(세 후보의 여섯 톤을, 위의 바탕 종류 전부 — 옛 방식으로 만든 바탕은 색상 360가지씩 — 위에): 글자 : 띠 6.65, 띠 : 바탕 4.88, 띠 : 카드 6.49. 어떤 후보가 어떤 바탕을 만나도 기준 안이다.
- 톤이 뒤집히는 바탕은 회색 131~136 근처이고 그때의 대비는 1.8~1.9:1이다. 그런 바탕을 가진 테마는 없다(어두운 바탕은 밝기 5~8%, 밝은 바탕은 88% 이상).

### 7.5 테스트가 지키는 기준

| 기준 | 값 | 측정된 최소 |
|---|---|---|
| 테마가 한 계열일 때(보조 = 강조) 띠와의 색상 거리 | **70° 이상** | 74.97°(만든 쪽의 색상으로 74.03°) |
| 테마의 두 색이 어떤 쌍이든, 색상이 있는 색 가운데 가까운 쪽까지 | **45° 이상** | 46.0° |
| 여섯 프리셋에서 테마의 두 색 각각까지 | **70° 이상** | 120.1° |
| 글자 : 띠 | **6 이상** | 6.65 |
| 띠 : 화면 바탕 | **4.5 이상** | 4.94(모든 톤 × 모든 바탕: 4.88) |
| 띠 : 카드 | **4.5 이상** | 6.49 |
| 후보의 모든 톤이 빨강(0°)에서 | **30° 이상** | 37.8° |
| 후보의 모든 톤의 채널 차(회색 강조색과 갈리는 근거) | **0.4 이상** | 0.41 |
| 이웃한 후보 사이의 색상 간격(위의 45°가 여기서 나온다) | **90° 이상** | 92.1°(호박–청록 150.2°, 청록–보라 92.1°, 보라–호박 117.8°) |

**기준 밖에 일부러 둔 글자 하나 — 흐린 '도면 저장'.** 저장할 것이 없을 때의 저장 버튼 글자는 글자색의 55%다(6.8). 여섯 톤에서 띠와의 대비가 **3.14~3.30:1**(계산, 16절)이라 위의 "글자 : 띠 6 이상"에 들지 않는다 — 꺼진 표시로 보이게 하려는 값이고, 띠의 다른 글자는 모두 4.5 이상이다(`Ctrl+S` 표시 4.87~6.31, 켜진 저장 버튼의 hover 5.37~7.32). 다만 이 버튼은 `disabled`가 아니라 `aria-disabled`라 Tab으로 닿고, 저장한 뒤 늘 보이는 상태다 — '도면 저장'이라는 글자는 읽혀야 한다. 테스트가 지키는 값이 아니므로(CSS의 투명도다) C7에서 눈으로 본다. 읽기 어려우면 올릴 값은 정해 두었다: 투명도 .78(4.72~6.00:1 — 테두리 30%·투명한 바탕·기본 커서는 그대로라 채워진 켜짐과 여전히 갈린다, 15.2).

### 7.6 색이 적용되는 곳과 때 — `useMapEditColors.ts` (새 파일)

```ts
import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { mapEditColors } from './mapEditColor.ts';

/**
 * Paints the edit band of this editor in a colour that stands apart from the theme. The two accents and the page colour
 * are read as they are on screen, and again whenever the theme or the colour mode changes while the editor is open.
 */
export function useMapEditColors(rootRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      const theme = getComputedStyle(document.documentElement);
      const colors = mapEditColors(theme.getPropertyValue('--color-accent'), theme.getPropertyValue('--color-accent-sub'), theme.getPropertyValue('--color-bg-primary'));
      if (root.style.getPropertyValue('--bmap-edit') !== colors.strip) root.style.setProperty('--bmap-edit', colors.strip);
      if (root.style.getPropertyValue('--bmap-edit-ink') !== colors.ink) root.style.setProperty('--bmap-edit-ink', colors.ink);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] });
    return () => observer.disconnect();
  }, [rootRef]);
}
```

편집기에서: `useMapEditColors(rootRef);`(`const rootRef = …`, :243 다음 줄).

| 물음 | 답 |
|---|---|
| 어디에 쓰나 | 편집기 뿌리 `.bmap-layout`의 인라인 스타일에 변수 둘(`--bmap-edit`, `--bmap-edit-ink`). 띠·테두리·트리의 점이 모두 그 안에 있다 |
| 언제 처음 | 편집기가 올라올 때, 첫 그리기 **전**(`useLayoutEffect`). 편집 중이 아니어도 쓴다 — 트리의 점이 보기 모드에도 있다 |
| 무엇에서 읽나 | `<html>`의 계산된 스타일에서 변수 셋(`--color-accent`, `--color-accent-sub`, `--color-bg-primary`). `applyTheme`이 쓴 인라인 값이든, 저장된 테마가 없을 때의 `index.css` 기본값이든 **화면에 실제로 칠해진 값**이다 |
| 열린 채 테마가 바뀌면 | `<html>`의 `data-color-mode`·`class`·`style`이 바뀔 때 다시 계산한다(3D 화면이 쓰는 것과 같은 관찰, BackgroundMap3D.tsx:205-206). 열린 채 바뀔 수 있는 것은 어두운·밝은 전환이다(2.7). 프리셋과 직접 고르기는 설정 화면에 다녀오면서 편집기가 새로 올라온다 |
| 처음의 `apply();` | **빼면 안 되는 줄이다.** 관찰자는 그 뒤의 변화만 듣는다. 이 줄이 없으면 기본 테마가 아닌 모든 테마에서 CSS의 기본값(호박)이 어두운·밝은 전환을 누르기 전까지 남는다 — 똥파리 골드의 그 문제다(앵커 55가 호출과 그 순서를 고정한다) |
| 바뀌지 않았으면 | 같은 값은 다시 쓰지 않는다. 편집기 요소에 쓰므로 `<html>`을 지켜보는 관찰자(이것 자신과 3D 화면의 것)를 깨우지 않는다 |
| 스크립트가 돌기 전 | CSS의 기본값 한 줄(6.8 — 기본 테마의 계산 결과와 같다. 테스트가 견준다) |
| 새 창(위젯) | 배경 화면은 새 창에 뜨지 않는다(2.7). 뜨게 되더라도 이 훅은 자기 문서의 `<html>`을 읽으므로 그대로 맞는다 |
| `src/themes.ts`·`applyTheme` | **건드리지 않는다.** 앱 전체의 파일이고 그 줄들을 다른 테스트가 고정한다(`tests/characterBoardAssetWorkflow.test.ts:520-522`) |

---

## 8. Ctrl+S

### 8.1 어디서 듣나

**창 단위, 캡처 단계**다. `keyboard()`에 두면 포커스가 칸·버튼에 있을 때와 `body`에 있을 때 듣지 못한다(2.5). 본은 `onSpaceKey`(:367-388)다: `useEvent` 핸들러를 한 번 걸고 내릴 때 뗀다.

### 8.2 핸들러 — Space의 effect(:384-388) 바로 다음에 둔다

```ts
const openDialogs = 'dialog[open], [aria-modal="true"]';          // 모듈 상수: spaceEntry(:89) 다음 줄

/** Ctrl+S saves the map being edited. Heard on the window, like Space above: right after a button was pressed the focus is on nothing at all, and a field keeps its keys from the editor's own handler. */
const onSaveKey = useEvent((event: KeyboardEvent) => {
  if (event.code !== 'KeyS' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const root = rootRef.current, element = event.target instanceof Element ? event.target : null;
  // The key is the editor's only while it is on show and editing. While viewing, for a read-only account and in another tab of the library it is left alone.
  if (!root || root.offsetParent === null || !editing) return;
  // An open dialog keeps the key. Asked from the state and from the document, never from the target: once Tab has run past the last button of a modal, the focus (and so the target) is the body.
  if (createForm || linkForm || settingsForm || confirmation || document.querySelector(openDialogs)) return;
  // The key is the editor's while the focus is in the library, or on nothing at all. Elsewhere it belongs to what has the focus:
  // a window of the app that is neither a dialog element nor marked modal (changing the password, managing users), a button of the app's own frame.
  if (element && element !== document.body && !element.closest('.bg-library')) return;
  // Text typed outside the editor is not the editor's.
  if (element?.closest(textFields) && !root.contains(element)) return;
  event.preventDefault(); event.stopPropagation();
  // Taken, and nothing done: the repeats of a held key. A syllable still being composed is no reason to stop: the
  // focus leaves the field in requestSave, which ends the composition and commits it, as a press on 도면 저장 does.
  if (event.repeat) return;
  requestSave();
});
useEffect(() => {
  window.addEventListener('keydown', onSaveKey, true);
  return () => window.removeEventListener('keydown', onSaveKey, true);
}, [onSaveKey]);
```

| 지키는 것 | 방법 | 어기면 |
|---|---|---|
| 어느 키 | `event.code === 'KeyS'` + Ctrl(또는 Meta), Alt·Shift 없이. 자판의 자리로 본다(Space도 `code`로 본다, :368) — 한글 입력 상태와 무관해야 한다(E6에서 확인) | Ctrl+Shift+S·Ctrl+Alt+S까지 삼킨다 |
| 편집기가 보이고 편집 중 | `root.offsetParent !== null`(다른 탭에서는 숨겨져 있다) 그리고 `editing` | 보기 모드·읽기 전용 계정·다른 탭에서 키를 삼킨다 |
| **창이 열려 있지 않다** | 편집기의 네 창은 **상태로**(`createForm`·`linkForm`·`settingsForm`·`confirmation`), 라이브러리 화면이 여는 배경 상세 창과 앱의 다른 창은 **문서에** 묻는다(`dialog[open]`, 그리고 업데이트 내역 창처럼 네이티브가 아닌 창의 `aria-modal`). 그 표시가 하나도 없는 앱의 창 둘(비밀번호 변경·사용자 관리)은 문서에 물을 수 없어 아래의 포커스 줄이 맡는다 | 설정 창 아래에서 초안이 저장되고, 창의 '설정 저장'이 그 뒤 옛 버전으로 거절된다. **이벤트 대상에 물으면** Tab이 창의 마지막 버튼을 지난 순간(대상이 `body`)에 뚫린다(R10) |
| **포커스가 배경 화면 안이거나, 아무 데도 없다** | 대상이 `body`가 아니고 `.bg-library` 밖이면 넘긴다(삼키지도 않는다). 배경 화면 안의 버튼·칸·도면, 그리고 버튼이 사라져 포커스가 `body`에 놓인 때는 받는다 | 앱에는 `<dialog>`도 `aria-modal`도 아닌 창이 있다 — 비밀번호 변경 창과 사용자 관리 창은 어느 화면에서나 뜨는 평범한 덮개다(`src/App.tsx:3382`, :3391 — 두 파일에 `fixed inset-0`뿐이고 그 표시가 없다). 위의 "창이 열려 있지 않다"가 그 둘을 보지 못하므로, 그 창의 **버튼**에 포커스가 있을 때의 Ctrl+S가 창 밑의 도면을 저장하고 포커스가 덮개 밑의 도면으로 빠진다(글자 칸에서 친 것은 아래 줄이 넘긴다) |
| 편집기 밖의 글자 칸 | 대상이 글자 칸이고 편집기 밖이면 넘긴다(배경 화면 안이되 편집기 밖인 칸이 여기서 걸린다) | 편집기 밖의 칸에서 친 Ctrl+S가 도면을 저장한다 |
| **한글 조합 중** | **다른 때와 똑같이 저장한다.** `requestSave`가 캔버스로 포커스를 옮기면 조합이 끝나고 칸의 blur가 그 글자까지 확정한다 — 조합 중에 마우스로 '도면 저장'을 누를 때와 같은 길이다(8.3) | 조합 중을 "삼키고 아무것도 하지 않는다"로 두면(예전 안) **한글 이름을 치고 바로 Ctrl+S를 누르는 평범한 흐름이 말없이 저장되지 않는다.** 한글 입력기에서는 방금 친 마지막 글자가 다른 키·Enter·blur 전까지 조합 중으로 남고, Ctrl+S는 Enter와 달리 입력기가 조합을 끝내는 데 쓰는 키가 아니라서 다시 눌러도 된다는 보장이 없다 |
| 키 반복 | 삼키고 아무것도 하지 않는다 | 누르고 있으면 저장이 거듭 나간다 |
| 저장 중 · 끌기 중 | `requestSave`가 본다(8.3) | 끌던 것이 취소된 채 저장된다 |
| `preventDefault` + `stopPropagation` | 받기로 한 뒤 곧바로 | 브라우저 미리보기에서 페이지 저장 창이 뜬다. 사용자가 Ctrl+S에 묶어 둔 앱 단축키(`window`의 버블 단계, `useGlobalShortcuts.ts:166`)가 함께 나간다 — 화면 전환이었다면 편집기가 내려간다 |

- **보기 모드에서는 아무 일도 하지 않는다**(삼키지도 않는다).
- 편집 중에 받았는데 저장할 것이 없으면 **쓰기가 나가지 않는다**(4.2). 그때도 키는 삼키고 `requestSave`가 포커스를 도면으로 옮긴다(8.3) — 이미지 목록의 검색 칸에 있던 커서가 빠지고, 아무것도 치지 않은 채 열려 있던 이름 칸이 닫힌다. 그리다 만 다각형이 있으면 그 문장이 뜬다(4.2).
- **포커스 가드가 치르는 값과 남는 틈.** 앱 틀의 버튼(위쪽 줄의 어두운·밝은 전환, 왼쪽 메뉴를 접는 버튼)을 누른 직후에는 포커스가 그 버튼에 남아 있어 Ctrl+S가 듣지 않는다 — 배경 화면 안을 한 번 누르면 듣는다. 편집기의 다른 단축키(Ctrl+Z·Delete — 뿌리의 `onKeyDown`)는 지금도 그때 듣지 않으므로 같은 규칙이 된다(15.3에 적는다). 남는 틈: 비밀번호 변경·사용자 관리 창이 떠 있는데 포커스가 아무 데도 없을 때(창의 바탕을 누른 직후)의 Ctrl+S는 밑의 도면을 저장한다 — 그 두 창에는 문서에 물을 표시가 없다. 잃는 것은 없고(저장되는 것은 사용자의 편집이다) 그 두 파일은 이번 범위 밖이라 고치지 않는다(15.4).
- **다른 단축키와 부딪히지 않는다**: 앱의 기본 단축키에 Ctrl+S가 없고(`useGlobalShortcuts.ts:13-29`), 편집기의 Ctrl+Z·Y·D는 다른 키다. `keyboard()`에는 S를 넣지 않는다(규칙이 한 곳에 있다). 사용자가 설정에서 Ctrl+S에 직접 묶은 동작은 **편집 중인 동안** 나가지 않는다(15.4).
- Windows 전용 앱이다(2.5). `metaKey`는 편집기의 다른 단축키와 같은 꼴로 받아 줄 뿐이고 Mac은 대상이 아니다.
- 자리: `handler.onSpaceKey` 조각은 `const onSpaceKey = useEvent(`에서 **다음 `useEffect(`**까지다(앵커 28) — 새 핸들러를 그 사이에 두지 않는다. Alt의 effect(:348-362, 앵커 17) 안에도 두지 않는다.

### 8.3 `requestSave` — 치던 값을 먼저 확정한다 (`saveMap` 다음, `confirmAction` 앞)

```ts
/** 도면 저장 and Ctrl+S. The focus goes to the canvas first: leaving a field commits what was being typed in it, and afterwards the editor's keys work without a detour. */
function requestSave() {
  if (!current || !canEdit || saving.current || pointerRef.current || doc.isGestureActive()) return;
  focusCanvas();
  void saveMap();
}
```

`focusCanvas()`가 지금 포커스를 가진 칸을 떠나게 하고, blur 핸들러는 그 자리에서 동기로 돌고, 문서 저장소는 동기다. 그래서 바로 다음 줄의 `saveMap`이 `settle()`과 바뀜 검사에서 읽는 초안에는 그 값이 들어 있다(평면의 누름이 같은 순서에 기대고 있다, :698-704).

**포커스는 저장할 것이 있든 없든 옮긴다.** "저장할 것이 없다"는 칸을 떠난 **뒤의** 초안을 읽어야 알 수 있으므로(4.2의 바뀜 검사) 포커스를 옮기기 전에는 가릴 수 없다. 그래서 깨끗한 도면에서 누른 Ctrl+S도 포커스를 도면으로 옮긴다 — 쓰기는 나가지 않고 띠도 그대로다(K5).

| 치던 곳 | 칸을 떠날 때 | 저장에 들어가나 |
|---|---|---|
| 숫자 칸 — 범위 안의 값 | 이미 곧바로 적용됐다(:140). blur는 합치기만 끝낸다(`onDone` → `doc.endCoalescing`) | 예 |
| 숫자 칸 — 덜 친 값("-"), 범위 밖의 값 | 가장 가까운 한계로 적용되거나, 값이 그대로면 아무 일도 없다(:143-148) | 적용된 값이 |
| 평면의 이름 칸 | `onCommit(text, false)`(`BackgroundMapNameBox.tsx:60`) → `commitName`(:659-670) — 이때 `canEdit`은 아직 참이다 | 예. 칸이 닫힌다 |
| 속성 칸의 이름 입력 · 선택 상자 · 체크 | 이미 곧바로 적용됐다 | 예 |
| **평면의 이름 칸 — 한글을 조합 중** | 포커스가 떠나면 조합이 끝난다. 칸이 쥔 글자(`text`)는 조합 중에도 `onChange`가 글자마다 맞춰 두었으므로(`BackgroundMapNameBox.tsx:48`) blur의 확정에 마지막 글자가 들어 있다 | 예 — E6에서 실제 입력기로 본다 |
| **속성 칸의 이름 입력 — 한글을 조합 중** | 조합 중인 글자까지 이미 초안에 들어 있다(글자마다 적용한다, :1093). blur는 합치기만 끝낸다 | 예 — E6 |
| 이미지 목록의 검색 칸 | 확정할 것이 없다. 커서가 칸에서 빠지고 친 검색어는 그대로다 | — |

**조합 중의 근거와 남은 물음.** 검증 기록은 "조합 중 다른 곳을 누르면 글자가 온전히 확정"을 적어 두었다(`DEVLOG/background-library-verification-2026-09-21.md:254` — 다만 그때의 입력기는 흉내였다, :241). 조합 중에 마우스로 '도면 저장'을 누르는 길은 지금도 같은 blur로 이름 전체를 저장한다. Ctrl+S가 눌릴 때 입력기가 스스로 조합을 끝내는지, `isComposing`이 참인 채로 키가 오는지는 엔진에서 보지 않았다 — **어느 쪽이든 저장되게** 짰고, 실제 입력기로 보는 것이 E6이다(통과 기준은 "저장된다"다). 마지막 글자가 빠지거나 겹치면 대체안은 "먼저 확정하고 다음 작업에서 저장"이다(15.2). 말없이 아무 일도 하지 않는 것으로는 돌아가지 않는다.

**버튼으로 저장할 때도 같은 함수다**(`onSave={requestSave}`). 마우스로 누르면 치던 칸은 클릭보다 먼저 blur된다. 포커스를 캔버스로 보내는 것은 그 뒤의 키 때문이다 — 저장 버튼은 저장이 시작되면 흐려지고, 포커스가 버튼에 남아 있으면 `keyboard()`의 버튼 가드(:886)가 Ctrl+Z를 막는다.

끌기·화면 이동 도중에는 아무것도 하지 않는다(되돌리기·카메라 추가와 같은 가드, :532, :506). 3D에서도 같다 — 기즈모 끌기는 문서의 제스처다.

---

## 9. 저장했다는 알림

### 9.1 띠 안의 글자 하나 — 토스트 없음

- 저장이 끝나면 띠의 글자가 굵은 **"✓ 도면을 저장했어요"**가 되고 4초(`MAP_SAVED_NOTICE_MS`) 뒤 "저장된 그대로예요"로 돌아간다. 그 사이에 고치면 곧바로 알약 모양의 "저장 안 한 변경 1개"다.
- 저장을 누른 사람이 보는 것은 **세 가지가 한꺼번에**다: 왼쪽의 알약이 사라지고 ✓ 문장이 되고, 오른쪽의 저장 버튼이 채워진 모양에서 흐린 테두리로 꺼진다. 누른 버튼은 오른쪽 끝이고 문장은 왼쪽 끝이지만(1440px 창에서 약 1,000px 떨어져 있다) 양쪽이 같은 순간에 같은 뜻으로 변한다.
- 토스트를 쓰지 않는 까닭: 눈은 방금 누른 띠에 있고 토스트는 기본이 화면 오른쪽 아래다(`src/App.tsx:517`). 이 기능은 토스트를 하나도 쓰지 않는다. 그리고 띠의 글자는 높이가 고정된 상자 안이라 **도면 크기를 바꾸지 않는다** — 도면 위에 `.bmap-notice` 같은 블록을 끼우면 바뀐다.
- 보이지 않는 알림 영역이 같은 문장을 읽어 준다(6.9).

### 9.2 켜고 끄는 곳

```ts
/** The map whose save just went through, while the band still says so. */
const [savedNotice, setSavedNotice] = useState<{ mapId: string } | null>(null);

// "Saved" leaves the band by itself. Timed here, not in CSS: with reduced motion a CSS timer ends on its first frame.
useEffect(() => {
  if (!savedNotice) return;
  const timer = window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS);
  return () => window.clearTimeout(timer);
}, [savedNotice]);
```

- **켜는 곳은 `persistMaps` 하나**(4.1): 저장을 시작할 때 보던 도면이 명령에 들어 있고 그 도면에 초안이 있을 때. 그래서 '설정 저장'·'연결 해제'도 편집 중이었다면 같은 알림을 낸다. 편집 중이 아니던 사람의 저장에는 띠가 없으니 알림도 없다(지금과 같다).
- 저장할 때마다 새 객체라 타이머가 다시 4초부터 돈다.
- 다른 도면으로 가면 알림은 그 도면의 것이 아니므로 보이지 않는다(`savedNotice?.mapId === current.id`). '기존 도면 연결'·'내부 도면 만들기'는 다른 도면으로 옮겨 가므로 알림이 보이지 않는다.
- 끄는 곳: 타이머, `leaveEditing`, 편집기가 내려갈 때(effect의 정리 — 타이머를 지운다).
- 시간은 스크립트로 잰다. CSS 애니메이션으로 사라지게 하면 동작 줄이기에서 첫 프레임에 끝난다(전역 규칙이 길이를 0.01ms로 누른다, `src/index.css:1097-1104`).

### 9.3 실패하거나 거절됐을 때 — 문장과 자리는 그대로, 까닭이 화면 밖이면 끌어온다

- 초안·기록·선택이 그대로 남고 띠는 "저장 안 한 변경 N개"로 돌아온다(`pending`이 꺼지면 '바뀜').
- 오류는 지금의 자리에 지금의 글자로 뜬다: 편집기의 빨간 띠(:981, `role="alert"`)와, 저장소의 오류를 보이는 라이브러리의 띠. 문장은 2.3 그대로다.
- 빨간 띠는 도면 위에 놓이므로 뜨는 순간 도면이 내려간다 — 지금과 같고, 그 순간은 저장이 끝나는 때라 끌기가 없다.
- "저장하지 못했어요" 같은 새 문장을 띠에 더하지 않는다. 같은 일을 두 곳이 다른 말로 알리게 된다.
- **새로 생기는 빈틈과 그 막음(I12).** 편집기의 빨간 띠는 띠보다 **위**에 흐름대로 놓여 있어 스크롤하면 올라가 버린다. 오늘은 저장 버튼도 같은 머리줄에 있어서 둘이 함께 보이거나 함께 안 보인다. 이제 띠는 화면을 따라오고 Ctrl+S는 어디서든 듣는다 — 740px 창에서 속성 칸까지 내려가(또는 1440×900의 3D에서 조금 내려가) 다각형을 그리다 만 채 Ctrl+S를 누르면 **띠는 그대로이고 까닭은 화면 밖**이다. 저장을 눌렀는데 아무 일도 없는 것처럼 보인다. 그래서 '도면 저장'·Ctrl+S가 **저장 대신 문장으로 끝나면**(시작 전에 거절된 두 경우 — 그리다 만 다각형이 있다, 도면 이름이 비었다(뒤의 것은 화면으로는 만들 수 없는 방어 가드다, 4.2) — 와 저장 중의 실패) 빨간 띠를 화면 안으로 끌어온다(4.2의 `scrollIntoView({ block: 'nearest' })`). 이미 보이는 중이면 아무것도 움직이지 않는다. 끌어온 자리에는 그리다 만 다각형이 있는 도면도 함께 온다 — 고쳐야 할 것이 거기 있다.
- 쓰기가 나간 뒤의 실패는 스크롤 상자 밖의 라이브러리 띠에도 떠서(`BackgroundLibraryView.tsx:142-146`) 스크롤과 무관하게 보인다. 쓰기가 나가기 **전에** 저장소가 던지는 것(그 자리에서 알아챈 버전 충돌 등)은 편집기의 빨간 띠에만 뜬다 — 그래서 실패도 함께 끌어온다.

---

## 10. 파일 계획

### 10.1 새 파일

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapEditStatus.ts` | 띠가 보일 것을 정하는 순수 함수와 문구(3.1) |
| `src/features/backgrounds/mapEditColor.ts` | 띠의 색을 정하는 순수 함수와 색 표(7.1). import 없음 |
| `src/features/backgrounds/useMapEditColors.ts` | 그 색을 화면의 테마에서 읽어 편집기 뿌리에 쓰는 훅(7.6) |
| `src/features/backgrounds/BackgroundMapEditStrip.tsx` | 띠(6.1). 받은 것만 그린다 |
| `tests/backgroundMapEditStatus.test.ts` | 상태 표, 수, 저장 뒤 다시 놓기의 문서 단위 테스트(11.1, 11.3) |
| `tests/backgroundMapEditColor.test.ts` | 색 표와 기준, CSS와의 일치(11.2) |

### 10.2 바뀌는 파일

| 파일 | 내용 |
|---|---|
| `mapDocument.ts` | `MapDraft.dropped`, `freshDraft`, `rebaseDrafts`, `commitDraft`, 액션 `rebase-drafts`·`follow-saved`, `mapDraftSteps`, `mapDraftChanged`의 한 항, `MAP_HISTORY_LIMIT` import |
| `mapWorkflow.ts` | `savedMaps` |
| `useBackgroundMapDocument.ts` | `rebaseDrafts`·`followSaved` 더하기, `dropDrafts` 빼기 |
| `BackgroundMapEditor.tsx` | 아래 표 |
| `BackgroundMapGallery.tsx` | 안내 글 두 곳(6.7) |
| `backgrounds-map.css` | 6.8 — 새 기본 덩어리는 **`.bmap-main` 규칙 바로 다음**(미디어 블록들보다 앞), 900px 이하 블록과 901px 이상 블록 안에 덮어쓰기 |
| `tests/backgroundMapDocument.test.ts` · `backgroundMapWorkflow.test.ts` · `backgroundMapEditorWiring.test.ts` | 11절 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 13절 |

**`BackgroundMapEditor.tsx`에서 고치는 곳과 자리.** 앵커가 함수 표지 사이를 잘라 읽으므로 자리가 계약이다.

| 것 | 자리 | 걸리는 앵커 |
|---|---|---|
| import 넷(`savedMaps`, `mapEditStatus`·`MAP_SAVED_NOTICE_MS`, `BackgroundMapEditStrip`, `useMapEditColors`) | 맨 위 | — |
| `const openDialogs = …` | `spaceEntry`(:89) 다음 | 앵커 13·28이 고정한 두 선택자 상수의 글자는 그대로 |
| `const [refused, setRefused] = useState(0);` · `const errorRef = …` | `error`(:218) 다음 | — |
| `const saving = useRef(false);` · `savedNotice` 상태 | `busy`(:219) 다음. `saving`은 3단계에, `savedNotice`는 **5단계에** 선언한다(`leaveEditing`이 쓴다 — 11.4, 14절) | — |
| `useMapEditColors(rootRef);` | `rootRef`(:243) 다음 | 뿌리 줄의 시작 `<div className="bmap-layout" ref={rootRef} `는 그대로(앵커 28) |
| `followSaved`와 그 effect, 알림 타이머 effect, 까닭을 끌어오는 effect(이 차례로) | :326의 effect 다음, `abortGesture`(:329) 앞 | `listSelection` 조각(:288 → 다음 `useEffect(`, 앵커 36) 뒤, `abortGesture` 조각 앞 |
| `onSaveKey`와 그 effect | Space의 effect(:388) 다음, 누름 기록 effect(:390) 앞 | 앵커 28(`onSpaceKey` → 다음 `useEffect(`), 앵커 17(Alt의 effect 안이 아님) |
| `persistMaps`의 본문 | 제자리(:460-463) | 새 앵커 50 |
| `leaveEditing`, `endEditing` | **`beginEditing` 다음, `undo` 앞** | `placeSymbol` 조각은 `function beginEditing(`에서 끝난다 — 그 앞에 두면 그 조각에 들어간다 |
| `saveMap`의 본문 | 제자리(:536-547) | 새 앵커 51 |
| `requestSave` | **`saveMap` 다음, `confirmAction` 앞** | `confirmAction` 조각은 `async function createMap(`에서 끝난다 — `confirmAction` 뒤에 두면 그 조각에 들어간다 |
| `confirmAction`의 버리기 가지 | 제자리(:564-567) | 앵커 29가 읽는 `delete-group` 가지와 `focusAfterConfirm` effect·`focusCanvas`의 글자는 그대로 |
| 그리는 줄: 트리 점의 풍선(:972), `.bmap-main`의 클래스(:977), 배지 삭제(:978), 머리줄 버튼(:979 — '편집 시작'은 감춘 채 남긴다, 6.7), 빨간 띠의 `ref`(:981), 띠(:982 다음), 빈 도면 안내(:1084), '연결 해제'의 클릭(:1097), 창의 제목·글·버튼(:1202) | 제자리 | :972, :978-983, :1097은 어느 앵커에도 없다. `keyboard()`(앵커 12·13·28·29·30·38), `pointerDown`의 `setError(` 하나(앵커 19), `navigate`(앵커 22)는 건드리지 않는다 |

`createMap`·`linkMap`·`saveSettings`·삭제 가지의 본문은 **한 글자도 고치지 않는다**(`persistMaps`가 대신 달라진다). '연결 해제'는 `linkMap`을 부르는 **버튼의 클릭**에 `focusCanvas();`를 앞세울 뿐이다(4.3).

**모듈 의존(한 방향)**

- `mapEditStatus.ts → mapDocument.ts`(함수 둘과 타입).
- `mapEditColor.ts`는 아무것도 import하지 않는다. `src/themes.ts`에도 기대지 않는다(테스트만 프리셋을 그 파일에서 읽는다 — 그 파일은 import가 없고 DOM을 `applyTheme` 안에서만 만진다. `tests/motion/fx-comments-fixes.test.ts:18`이 이미 그렇게 읽는다).
- `useMapEditColors.ts → mapEditColor.ts`. `BackgroundMapEditStrip.tsx → mapEditStatus.ts`. 편집기가 넷을 쓴다.
- 3D 파일(`BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapCameraGizmo.ts`)과 보조 평면도는 고치지 않는다. `mapCanvas.ts`의 계약은 그대로다.
- Node로 도는 모듈의 새 import는 `.ts` 확장자를 붙인다. 새 모듈에 three.js·DOM·React가 없다(`useMapEditColors.ts`와 띠 컴포넌트만 예외 — 테스트가 import하지 않는다).

### 10.3 건드리지 않는 파일

| 파일 | 이유 |
|---|---|
| `src/features/playground/featureFlag.ts` | 노출 범위(`canAccessBackgroundLibrary`). 이번에 바뀌는 것이 없다 |
| `electron/**` | IPC·메인 프로세스 변경 없음. `execute`의 서명과 요청 모양이 그대로다 |
| `domain.ts`, `types.ts` | 저장 계약. 초안의 새 필드(`dropped`)는 화면의 문서 상태이고 저장되지 않는다 — 명령에는 `value`만 들어간다(mapWorkflow.ts:40-43) |
| `previewGateway.ts`, `src/mocks/devElectronAPI.ts` | 미리보기 저장소. 필요가 없다 |
| `useBackgroundStore.ts` | 저장소. 다시 읽지 않고 명령에서 만들기 때문에 `execute`가 스냅샷을 돌려줄 필요가 없다 |
| `BackgroundLibraryView.tsx` | 업데이트 안내와 탭(앵커 46). 탭의 점은 2차다 |
| `BackgroundUI.tsx`(`BackgroundModal`) | 창 자체는 그대로다 |
| `mapEditSession.ts` | 기록 함수. 세는 일은 문서 리듀서가 한다 |
| `BackgroundMapPanels.tsx`, `BackgroundMapNameBox.tsx`, `BackgroundMapSelectionSummary.tsx`, `BackgroundMapCameraColor.tsx`, `BackgroundMap3D.tsx`, `map3dScene.ts`, `BackgroundMapPlanPreview.tsx`, `backgrounds.css`, `backgrounds-map-3d.css`, `backgrounds-map-plan.css` | ①~③의 화면. 띠는 그 바깥에 놓인다 |
| `src/themes.ts`, `src/App.tsx`, `src/index.css` | 앱 전체의 테마. 색은 화면에서 읽는다(7.6) |
| DB(`DEVLOG/migrations/**`) | 변경 없음 |

### 10.4 2차가 붙을 자리

- **초안의 수명**: `useState(() => createMapDocumentStore())`(useBackgroundMapDocument.ts:35). `createMapDocumentStore(initial)`가 시작 상태를 받고 `subscribe`가 있으므로(mapDocument.ts:295-311) 2차는 리듀서를 고치지 않고 저장소를 컴포넌트 밖으로 들어내고(사용자별), 편집이 끝날 때마다 보관본을 쓴다. 1차는 편집기 상태가 화면과 함께 버려진다는 데 기대는 것을 더하지 않았다(알림 타이머는 내릴 때 지운다).
- **'바뀜'의 정의는 한 곳**(`mapDraftChanged`·`mapDraftSteps`)이다. 기록 없이 되살린 초안은 그대로면 "바뀐 것 없음"으로 읽힌다 — 2차는 되살릴 때 `dropped`를 1 이상으로 두거나, 필드를 하나 더해 "개수를 모름"을 낸다. `mapEditStatus`의 '바뀜' 가지에는 이미 숫자 없는 문구가 하나 있어(저장한 적 없는 도면) 같은 자리에 한 줄을 더하면 된다.
- **띠는 (초안, 저장 중, 방금 저장함)의 순수 함수**다. 2차의 상태("다른 곳에서 바뀜", "라이브러리에 연결되지 않음", 권한을 잃은 초안)는 `MapEditPhase`에 값을 더하고 띠에 버튼 자리 하나('모두 저장')를 더한다. 높이는 폭으로만 정해지므로 그대로다. **버튼이 하나 늘면 한 줄에 필요한 폭이 약 80px 는다**(460 → 540px) — 901px 창에서 사이드바를 펼친 532px에 더는 들어가지 않으므로, 그때는 띠가 두 줄로 바뀌는 폭을 올려야 하고 다시 재야 한다(올리는 것은 띠 자신의 규칙과 `--bmap-edit-h:72px`뿐이다, 15.2의 E4 줄). 권한을 잃은 초안은 지금 `editing`이 거짓이라 띠가 없다 — 2차가 띠를 `editing`이 아닌 조건으로 그리게 바꾼다. 그렇게 띠를 그리는 줄(조건·속성)과 띠의 마크업을 고칠 때는 그 글자를 고정한 앵커 52·53·54·57을 같은 커밋에서 맞춘다(11.4의 '띠 줄').
- **"다른 곳에서 바뀜"의 대상**은 따라가기가 남긴 것 그대로다: `mapDraftChanged(draft) && 스냅샷의 버전 > draft.baseRevision`, 그리고 **바뀐 초안인데 스냅샷에 그 도면이 없는 것**(다른 곳에서 지워졌다 — 1차는 깨끗한 초안만 치운다, 4.4). 그 알림의 자리는 띠 안이다(도면 위 블록이 아니다). 보던 깨끗한 도면이 지워져 화면이 말없이 첫 도면으로 넘어가는 자리(4.4의 비우는 줄)가 2차의 "지워졌어요"를 알릴 자리다. 2차가 편집기에 보던 도면에 대고 묻는 창을 더하면(예: "이어서 편집 / 버리기") 그 상태를 따라가기의 가드와 의존 목록에 함께 더한다.
- **초안을 보관하기 전에 2차가 정해야 하는 것**: 따라가기는 지금 편집기가 떠 있는 동안에만 돈다. 보관한 초안을 되살릴 때는 그 초안이 깨끗한지·그 도면이 아직 있는지·버전이 그대로인지를 **되살리는 자리에서** 같은 규칙으로 걸러야 한다(`follow-saved`를 되살린 직후 한 번 보내면 된다 — 같은 액션이다). 떠난 도면에 저장 안 한 편집이 8px짜리 트리 점 하나로만 남는 것(5.3)도 2차의 몫이다.
- **다시 놓기**(`rebase-drafts`)는 여러 도면을 한 번에 받는다 — '모두 저장'이 그대로 쓴다.
- **색의 범위**: 훅은 넘겨받은 요소에 변수를 쓴다. 탭의 점(`.bg-library` 안, `.bmap-layout` 밖)은 더 넓은 요소를 넘기면 되고, 사이드바의 점(기능 밖)은 순수 함수를 저장소의 테마 색으로 직접 부른다.
- **화면을 떠나는 두 곳**: `src/App.tsx:3301`의 `key={currentView}`와 `BackgroundLibraryView.tsx:55-57`의 저장소 초기화.

---

## 11. 테스트

모두 `node --test ./tests/background*.test.ts`(`npm run test:background`, package.json:32)에 들어간다. 지금 542개(537 통과, 5 건너뜀 — PGlite를 지정하지 않은 DB 계약).

### 11.1 상태 모델 — `tests/backgroundMapEditStatus.test.ts` (새)

상태 표를 자료로 둔다(줄마다 입력과 기대). **기대는 돌려받은 객체 전체다 — 줄마다 `assert.deepEqual(mapEditStatus(…), { phase, changed, steps, detail, canSave, saveLabel, announce })`로 일곱 값을 모두 견준다.** 값의 일부만 견주면, 편집할 때마다 수를 읽어 주는 구현(`announce`에 수를 넣음 — 띠의 주석이 금지한 것)이나 `changed: steps > 0`(7번 줄에서 틀린다)이 통과한다.

| # | 초안 | `saving` | `justSaved` | `phase` | `changed` | `steps` | `detail` | `canSave` | `saveLabel` | `announce` |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 방금 연 초안 | 거짓 | 거짓 | `'clean'` | `false` | `0` | `'저장된 그대로예요'` | `false` | `'도면 저장'` | `''` |
| 2 | 한 번 고침 | 거짓 | 거짓 | `'changed'` | `true` | `1` | `'저장 안 한 변경 1개'` | `true` | `'도면 저장'` | `''` |
| 3 | 한 번 고침 | 거짓 | **참** | 2번 줄과 같은 객체 — 바뀜이 저장 알림을 이긴다 | | | | | | |
| 4 | 한 번 고침 | **참** | 거짓 | `'saving'` | `true` | `1` | `'저장 중…'` | `false` | `'저장 중…'` | `'도면을 저장하는 중이에요'` |
| 5 | 방금 연 초안 | 참 | 참 | `'saving'` | `false` | `0` | `'저장 중…'` | `false` | `'저장 중…'` | `'도면을 저장하는 중이에요'` — 저장 중이 모든 것을 이긴다 |
| 6 | 방금 연 초안 | 거짓 | 참 | `'saved'` | `false` | `0` | `'도면을 저장했어요'` | `false` | `'도면 저장'` | `'도면을 저장했어요'` |
| 7 | `baseRevision: null`(손으로 만든 초안, `dropped: 0`) | 거짓 | 거짓 | `'changed'` | `true` | `0` | `'아직 저장한 적 없는 도면이에요'` | `true` | `'도면 저장'` | `''` |
| 8 | 12번 고침 | 거짓 | 거짓 | `'changed'` | `true` | `12` | `'저장 안 한 변경 12개'` | `true` | `'도면 저장'` | `''` |
| 9 | 60번 고치고 50번 되돌림 | 거짓 | 거짓 | `'changed'` | `true` | `10` | `'저장 안 한 변경 10개'` | `true` | `'도면 저장'` | `''` |
| 10 | 한 번 고침 | **참** | **참** | 4번 줄과 같은 객체 — 바뀜·저장 중·방금 저장함이 **한꺼번에** 참이어도 저장 중이 이긴다 | | | | | | |

10번 줄은 실제로 지나는 길이다(저장 → 알림이 떠 있는 4초 안에 고침 → 다시 저장). 3·4·5번 줄은 세 순서를 둘씩만 본다 — 10번 줄이 없으면 "알림이 떠 있는 동안의 바뀜"을 저장 중 검사보다 **앞에서** 따로 다루는 구현이 아홉 줄을 모두 지나고, 저장이 도는 동안 켜진 저장 버튼을 보인다.

그리고: `MAP_EDIT_LABEL === '편집 중'`, `MAP_SAVED_NOTICE_MS === 4000`. 깨끗함의 문장은 "저장 안 한"으로 시작하지 않는다(`!status.detail.startsWith('저장 안 한')` — 두 상태가 첫 낱말에서 갈린다는 규칙, 3.1). 모든 문구에 기울임을 뜻하는 표기와 개발 용어가 없다(문구는 위의 글자 그대로를 견준다).

### 11.2 색 — `tests/backgroundMapEditColor.test.ts` (새)

| # | 지키는 것 |
|---|---|
| C-0 | **계산 자체를 못 박는다**(기준을 재는 자가 이 모듈 자신의 함수라서, 자가 틀리면 아래의 기준이 모두 스스로를 통과시킨다 — 밝기 계산에서 감마를 빼거나 계수를 바꿔도 C-2·C-3·C-8은 초록이다): `colorContrast([28, 22, 8], [245, 178, 64])` = 9.70 ± 0.01, `colorContrast([255, 255, 255], [0, 102, 117])` = 6.65 ± 0.01, `colorContrast([255, 255, 255], [0, 0, 0])` = 21, `colorContrast(a, b) === colorContrast(b, a)`. `colorHue([245, 178, 64])` = 37.8 ± 0.05, `colorHue([86, 204, 222])` = 187.9 ± 0.05, `colorHue([220, 150, 255])` = 280.0 ± 0.05, `colorHue([255, 0, 0]) === 0`. `hueDistance(350, 10) === 20`, `hueDistance(10, 350) === 20`, `hueDistance(0, 180) === 180`. `MAP_EDIT_MIN_CHROMA === 0.08`, `MAP_EDIT_MAIN_TONES === 2`, `MAP_EDIT_RESERVE_BELOW === 60`. `MAP_EDIT_TONES`의 `id`가 차례로 `amber`·`cyan`·`purple` |
| C-1 | **여섯 프리셋 × 두 화면**: `THEME_PRESETS`(`../src/themes.ts`)를 돌며 `mapEditColors(preset.colors.accent, preset.colors.accentSub, 바탕)`을 어두운 바탕 `preset.colors.bgPrimary`와 밝은 바탕 `getLightColors(id).bgPrimary`로 불러, 7.3의 표와 **글자 그대로** 같은 `strip`·`ink`를 돌려준다(열두 줄). 보조 강조색 자리에 강조색을 넣어도 열두 줄이 같다(프리셋에서는 예비색을 보지 않는다) |
| C-2 | 같은 열두 줄에서: **강조색과 보조 강조색 각각**까지의 색상 거리 70° 이상, 글자 : 띠 6, 띠 : 바탕 4.5, 띠 : 카드 4.5(카드는 `bgCard`). 열두 줄 가운데 보라가 없다 |
| C-3 | **훑기 1 — 한 계열**: 7.4의 64,800가지(보조 강조색 = 강조색)에서 색상 거리 70°, 글자 : 띠 6, 띠 : 바탕 4.5, 띠 : 카드 4.5. **"색상이 있는가"와 강조색의 색상은 만든 쪽의 값으로 정한다**(색상 = 넣은 `h`, 채도 = `(1 − \|2L − 1\|) × S`가 **테스트가 따로 적은** 0.08 이상이면 색상이 있다) — 모듈의 `colorHue`로 정하면 문턱을 0.09~0.11로 바꾼 구현이 스스로를 면제한다. 색상이 없는 강조색(채도 20%·밝기 15%와 85%)에는 호박. 보라가 한 번도 나오지 않는다 |
| C-3b | **훑기 2 — 두 계열**: 강조색의 색상 × 보조 강조색의 색상을 1° 간격으로(129,600쌍, 채도 100%·밝기 50%), 두 바탕(`15 17 23`, `239 243 250`)에서. 고른 띠의 색상이 **두 색 각각에서 45° 이상**(색상은 넣은 값), 글자 : 띠 6, 띠 : 바탕 4.5. 그 가운데 보라를 고른 쌍이 있고(0보다 많다), 보라를 고른 모든 쌍에서 호박과 청록은 둘 다 테마의 어느 색에서 60° 안이다(예비색은 그때만 본다). **거꾸로도 본다 — 예비색을 보는 문턱이 실제로 60°라는 것**: 쌍마다 테스트가 답을 스스로 계산한다(모듈의 함수를 쓰지 않는다 — 넣은 두 색상과, 테스트가 따로 적은 세 후보의 색상 37.8°·187.9°·280.0°로. 한 후보의 거리 = 넣은 두 색상 가운데 가까운 쪽까지). 호박과 청록의 거리가 **둘 다 60° 미만이고** 보라의 거리가 그 둘 가운데 큰 쪽보다 크면 답은 보라, 아니면 호박·청록 가운데 먼 쪽이다. 고른 띠가 그 답의 후보여야 한다(`strip`이 그 후보의 두 톤 가운데 하나). 경계에 붙은 쌍은 건너뛴다 — 견주는 두 거리의 차(호박 대 청록, 보라 대 먼 쪽 주 후보)나, 먼 쪽 주 후보의 거리와 60°의 차가 0.5° 미만인 쌍(넣은 색상은 숫자 셋으로 반올림되며 0.1°쯤 움직인다) — 그리고 건너뛴 쌍이 전체의 3%를 넘지 않음을 함께 본다(계산 1.9%). 한쪽 방향 검사("보라면 둘 다 60° 안")와 45° 기준만으로는 **문턱을 52~59°로 적은 구현이 통과한다**(상수 `MAP_EDIT_RESERVE_BELOW`는 60인 채라 C-0도, C-3·C-3c도 통과한다 — 55~60° 떨어진 주 후보를 보라로 바꾸지 않고 쥐고 있을 뿐이다). 거꾸로 검사에서는 문턱 59°가 832쌍, 55°가 5,172쌍에서 틀린다(두 바탕 259,200쌍 가운데 — 16절) |
| C-3c | **프리셋에서 메인만 바꾼 서른 가지**: 프리셋 `P`의 `accentSub` × 다른 프리셋 `Q`의 `accent`. 서른 가지 모두 두 색 각각에서 45° 이상. 글자 그대로 고정하는 넷: 똥파리 골드의 보조색 + 윤성원 블루의 강조색 → 보라(`220 150 255` / `134 46 178`), 이혜민 머쉬룸의 보조색 + 윤성원 블루의 강조색 → 보라, 에메랄드의 보조색 + 공산당 레드의 강조색 → 보라, 바이올렛 드림의 보조색 + 공산당 레드의 강조색 → 청록 |
| C-4 | **색상 없음**: `128 128 128`·`242 242 242`·`16 16 16`·`140 132 120`·`250 250 255`를 두 색 자리에 모두 넣으면 어느 바탕에서든 호박을 돌려준다(빨강 쪽 후보로 읽히지 않는다). `colorHue`가 그 다섯에 `null`, `129 77 65`(이혜민 머쉬룸)에는 숫자. **문턱 바로 위**: `140 130 119`(채널 차 0.082)는 `colorHue`가 31.4 ± 0.1이고 청록을 고른다 — 문턱을 0.09로 올린 구현이 여기서 잡힌다. **한쪽만 색상이 없을 때**: 회색 강조색 + 보조색 `251 191 36` → 청록(색상이 있는 쪽에서 멀어진다), 회색 강조색 + 보조색 `34 211 238` → 호박 |
| C-5 | **두 후보의 가운데**: 경계(색상 약 112.9°와 292.9°)의 양쪽에서 먼 쪽을 고른다 — 채도 100%·밝기 50%의 색을 두 색 자리에 모두 넣어 110° → 청록, 116° → 호박, 290° → 호박, 296° → 청록. 네 경우 모두 색상 거리가 70° 이상이고 보라가 아니다. 목록의 순서가 뜻을 가진다는 것(색상이 없으면 앞의 것)은 C-4가 본다 |
| C-6 | **읽을 수 없는 입력 — 어느 인자가 읽히지 않는지 줄마다 적는다**: (가) 세 인자 모두 `''` → 호박·밝은 톤. (나) 강조색과 보조색이 `'abc'`·`'1 2'`·`'300 0 0'`이고 바탕이 `15 17 23` → 호박·밝은, 바탕이 `239 243 250` → **호박·짙은**(읽히지 않는 것은 테마 색이지 바탕이 아니다). (다) 테마 색은 `108 92 231`·`162 155 254`이고 바탕만 `''` → 호박·밝은(바탕을 모르면 밝은 톤). (라) 강조색 `''` + 보조색 `251 191 36` + 바탕 `239 243 250` → 청록·짙은. 쉼표와 슬래시가 든 글자(`'108, 92, 231'`), 앞뒤 공백이 든 글자를 읽는다 |
| C-7 | **톤**: 세 후보 모두 어두운 바탕 `15 17 23`에서는 밝은 톤, 밝은 바탕 `239 243 250`에서는 짙은 톤(보라는 C-3c의 쌍으로 부른다). **`data-color-mode`와 무관**하다는 것 — 함수의 인자에 모드가 없다 |
| C-8 | **후보 표**: `MAP_EDIT_TONES`의 여섯 톤 모두 빨강에서 30° 이상, 채널 차 0.4 이상, 글자 : 띠 6 이상. 한 후보의 두 톤은 색상이 1° 안이다. **이웃한 후보 사이의 색상 간격이 모두 90° 이상**(세 간격의 합은 360°) — 7.5의 45°가 여기서 나온다 |
| C-9 | **CSS와의 일치**: `backgrounds-map.css`에 `.bmap-layout { --bmap-edit:245 178 64; --bmap-edit-ink:28 22 8; --bmap-edit-h:40px; }` 한 줄이 있고, 그 두 색이 `mapEditColors('108 92 231', '162 155 254', '15 17 23')`(기본 테마, `src/index.css:104-110`의 값)의 결과와 같다 |
| C-10 | **규칙이 변수를 쓴다**: `.bmap-edit-strip {`로 시작하는 줄에 `background:rgb(var(--bmap-edit))`와 `color:rgb(var(--bmap-edit-ink))`, 테두리 줄에 `border:2px solid rgb(var(--bmap-edit))`, `.bmap-draft-dot {` 줄에 `color:rgb(var(--bmap-edit))`, 알약 줄(`.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {`)에 `background:rgb(var(--bmap-edit-ink))`와 `color:rgb(var(--bmap-edit))` — 이 넷은 줄 맨 앞에서 시작하는 기본 규칙의 줄에서 본다(앵커 54의 '줄을 찾는 법'). `.bmap-edit`·`.bg-library .bmap-edit`·`.bmap-main.is-editing`·`.bmap-draft-dot`로 시작하는 줄(변수를 정하는 `.bmap-layout { --bmap-edit:` 줄은 여기 들지 않는다. **줄의 앞 공백을 떼고 본다** — 미디어 블록 안에 들여쓴 덮어쓰기 줄도 본다)에 16진수 색과 `#eab76b`가 없고, **`rgb(` 다음이 `var(--bmap-edit`가 아닌 곳이 없다**(`/rgb\((?!var\(--bmap-edit)/`가 걸리지 않는다 — 저장 버튼에 `rgb(28 22 8)`을 적으면 호박·밝은 톤에서만 맞고 나머지 다섯 톤이 깨진다). **이름으로 적은 색과 `hsl(`도 없다**: `/(?<![\w-])(?:white\|black)(?![\w-])/`와 `/hsla?\(/`가 걸리지 않는다(`color:white`는 같은 종류의 잘못이고 여섯 톤 가운데 셋에서 틀린다. 낱말 경계 `\b`로 찾지 않는다 — 그 줄들에 있는 `white-space:nowrap`이 걸린다) |
| C-11 | **순수 모듈**: `mapEditColor.ts`에 **줄 맨 앞에서 시작하는 `import` 문이 없고**(`/^import\b/m` — 낱말 `import`가 있는지를 묻지 않는다: 7.1의 머리 주석에 "no imports"가 있어 `source.includes('import')`는 참조 코드 그대로에서 떨어진다) `document`·`window`·`getComputedStyle`이 없다. `mapEditStatus.ts`에 three.js·DOM이 없다(앵커 9·47과 같은 정규식) |

### 11.3 저장 뒤 다시 놓기 — 문서 단위

`tests/backgroundMapDocument.test.ts`에 더한다:

| # | 지키는 것 |
|---|---|
| D-1 | **밀려난 단계**: 60번 고치면 `past.length 50`, `dropped 10`, `mapDraftSteps 60`. 이어 50번 되돌리면 `past 0`, `future 50`, 값의 이름 `'10'`, **`mapDraftChanged true`**, `mapDraftSteps 10`. 한 번 더 고치면 11 |
| D-2 | 한계 안: 5번 고치고 5번 되돌리면 `mapDraftChanged false`, 수 0. 다시 실행 한 번이면 1 |
| D-3 | 끌기: 기록이 가득 찬(50) 초안에서 미리보기는 수를 바꾸지 않고(50), 놓으면 51·`dropped 1`. 제자리로 돌아온 끌기는 수를 바꾸지 않는다 |
| D-4 | **`rebase-drafts`**: 초안이 있는 도면은 넘겨받은 도면의 복제(같은 객체 아님)·`baseRevision` = 그 버전·`past []`·`future []`·`dropped 0`·바뀜 아님. **초안이 없던 도면에는 아무것도 열리지 않는다.** 다른 도면의 초안은 같은 객체. `viewports`는 같은 객체(선택과 보기 그대로). 할 일이 없으면 같은 상태 |
| D-5 | `rebase-drafts`: 바뀌는 초안 위의 제스처는 끝나고(`gesture null`) 다른 도면의 제스처는 이어진다. 합치는 중인 칸 편집(`coalescing`)도 같다 |
| D-6 | **`follow-saved` — 따라가기**(넘기는 목록에는 두 도면이 다 들어 있다): 깨끗한 초안 + 더 새 버전 → 따라간다. 같은 버전(자기 메아리) → **같은 상태**. 더 옛 버전 → 같은 상태. **바뀐 초안 → 같은 상태.** 모두 되돌린 초안(`future` 1) → 따라가고 `future`가 빈다. 끌기 도중 → 같은 상태. `baseRevision null` → 같은 상태. 초안이 없으면 열지 않는다 |
| D-6b | **`follow-saved` — 없어진 도면**(넘기는 목록에서 한 도면을 뺀다): 그 도면의 **깨끗한 초안은 없어지고** 다른 도면의 초안은 같은 객체, `viewports`도 같은 객체. **바뀐 초안 → 같은 상태**(남는다). 모두 되돌려 깨끗해진 초안(`future` 1) → 없어진다. 끌기 도중인 깨끗한 초안 → 같은 상태(제스처도 그대로). `baseRevision null` → 같은 상태. 한 번에 둘: 한 도면은 더 새 버전으로 따라가고 다른 도면은 없어진다. 다른 도면에서 합치는 중이던 칸 편집(`coalescing`)은 없어지는 초안과 무관하게 이어진다. 빈 목록 → 깨끗한 초안은 모두 없어지고 바뀐 초안은 남는다 |
| D-7 | 기존 테스트의 손으로 만든 초안(:52)에 `dropped: 0`을 더한다. 결과는 그대로다 |
| D-8 | "선택은 편집의 일부가 아니다"(:661-674)의 액션 목록 **끝에** 이 둘을 이 차례로 더한다: `{ type: 'rebase-drafts', maps: [mapA] }`, `{ type: 'follow-saved', maps: [{ ...mapA, revision: mapA.revision + 1 }, mapB] }`. 그 테스트는 목록의 액션마다 **상태가 달라졌는지도** 본다(`assert.notEqual(next, previous, action.type)`, :671) — `follow-saved`에 버전이 그대로인 도면들(`[mapA, mapB]`)을 넘기면 따라갈 것이 없어 같은 상태가 돌아와 실패한다(임시 사본에서 확인했다, 16절). 목록의 앞이 `begin-editing mapA`·`enter-new-map mapB`로 끝나므로 이 시점의 두 초안은 깨끗하다: 첫 액션은 A의 초안을 새 객체로 다시 놓고, 둘째는 A를 버전 4로 따라가게 한다. `mapB`를 함께 넘기는 것은 B의 초안이 "없어진 도면"으로 치워지지 않게 하려는 것이다. 둘 다 `viewports`를 건드리지 않는다 |

`tests/backgroundMapWorkflow.test.ts`에 더한다:

| # | 지키는 것 |
|---|---|
| W-1 | **`savedMaps`**: 명령의 도면마다 `revision`이 `(expectedRevision ?? 0) + 1`. 새 도면(`null`)은 1. 나머지 값은 그대로 |
| W-2 | `savedMaps(command)`의 도면들이 `applyBackgroundCommand(snapshot, command, …)`가 만든 스냅샷의 그 도면들과 깊은 비교로 같고, 그 스냅샷에 `mapSaveWasApplied`가 참이다(세 곳의 버전 셈이 같다) |

`tests/backgroundMapEditStatus.test.ts`에 둔다(저장소 + 리듀서 — 한솔의 답 1 전체를 화면 없이):

| # | 지키는 것 |
|---|---|
| F-1 | **저장 → 계속 편집 → 다시 저장.** 실제 저장소(`createBackgroundStore`)와 가짜 게이트웨이, 문서 저장소 하나. 편집 → `saveMapChanges` → `execute` → **그 뒤에도 저장을 시작할 때 잡아 둔 스냅샷의 버전은 옛 값**임을 확인 → `rebase-drafts`에 `savedMaps(command)` → 초안이 저장소의 도면과 깊은 비교로 같고 `baseRevision`이 새 버전·바뀜 아님·`viewports` 같은 객체 → 다시 편집 → 두 번째 저장이 통과(버전 +2) → 쓰기 두 번 |
| F-2 | **틀린 길은 거절된다**: 잡아 둔 옛 스냅샷의 도면으로 연 초안의 저장은 `/다른 사용자가 내용을 변경했습니다/`로 거절된다(왜 명령에서 만드는지의 기록) |
| F-3 | **자기 메아리**: 저장 뒤 저장소의 도면들로 `follow-saved` → 같은 상태 |
| F-4 | **저장 중에는 따라가지 않는다**(그래야 하는 까닭): 저장이 풀리지 않는 게이트웨이로 깨끗한 초안 위의 설정 저장을 시작 → `pending` 동안 저장소의 버전이 +1(낙관 값) → 저장을 실패시킨다 → 저장소가 되돌아간다. 그 `pending` 동안 `follow-saved`를 보냈던 사본의 초안은 `baseRevision`이 +1이고 실패한 이름을 쥔 채 "바뀜 아님" — 편집기가 `disabled`일 때 부르지 않는 까닭이다 |
| F-5 | **바뀐 것 없는 저장은 쓰지 않는다**의 근거: 손대지 않은 초안으로 만든 명령을 `execute`하면 쓰기가 한 번 나가고 버전이 오른다(그래서 편집기가 막는다) |

### 11.4 `tests/backgroundMapEditorWiring.test.ts` — 새 앵커

조각을 자르는 표지를 더한다: `persistMaps`(`async function persistMaps(` → `function enterNewMap(`), `leaveEditing`(`function leaveEditing(` → `function endEditing(`), `endEditing`(→ `function undo(`), `saveMap`(`async function saveMap(` → `function requestSave(`), `requestSave`(→ `async function confirmAction(`), `onSaveKey`(`const onSaveKey = useEvent(` → 다음 `useEffect(`), `followSaved`(`const followSaved = useEvent(` → `const abortGesture = useEvent(` — 따라가기와 그 effect, 알림 타이머 effect, 까닭을 끌어오는 effect가 이 조각에 든다), **띠 줄**(`<BackgroundMapEditStrip ` → 그 뒤의 첫 `/>` — 편집기가 띠를 그리는 태그 하나. 아래 표에서 "띠 줄"은 이 조각이다. `disabled={disabled}`는 지금 편집기에 스물아홉 번 나오므로 편집기 전체가 아니라 이 조각에서 찾는다). `mapDocument.ts`의 `follow-saved` 가지는 `block(source, "case 'follow-saved': {")`로 자른다. 새 파일을 읽는다: `BackgroundMapEditStrip.tsx`, `useMapEditColors.ts`, `mapDocument.ts`, `mapWorkflow.ts`, `BackgroundMapGallery.tsx`(앵커 58의 안내 글), `backgrounds-map.css`(주석을 빼지 않고 줄 단위로).

**표지는 그 단계에 있는 이름이어야 한다**(없는 표지로 자르면 그 앵커 전체가 실패한다, `piece` :25-31). 3단계에서 `saveMap` 조각은 `async function confirmAction(`까지로 자르고, `requestSave`가 생기는 6단계에서 `function requestSave(`까지로 좁힌다. `leaveEditing`·`endEditing` 조각은 그 함수들이 생기는 5단계에서 더한다(`beginEditing`의 조각은 만들지 않는다 — 50~59 가운데 그 조각을 읽는 앵커가 없고, 조각은 읽힐 때만 잘린다. 앵커 58은 '편집 시작' 버튼의 태그에서 `beginEditing();` 호출을 본다). 띠 줄의 조각은 띠가 생기는 4단계부터 있고, 그 안의 `onEnd={endEditing}`(앵커 52)는 5단계, `onSave={requestSave}`(53)는 6단계, `savedNotice?.mapId === current.id`(57)는 7단계에 생긴다 — 각 앵커를 그 단계에서 더한다.

**`savedNotice` 상태는 5단계에서 선언한다**(`const [savedNotice, setSavedNotice] = useState<{ mapId: string } | null>(null);` 한 줄, 9.2의 자리). 5단계의 `leaveEditing`이 `setSavedNotice(null)`을 부르고 앵커 52가 그 호출을 찾는다 — 선언을 7단계로 미루면 5단계는 typecheck에서 떨어지거나(없는 이름) 그 줄을 뺀 채 앵커 52에서 떨어진다. 5·6단계에는 그 값을 읽는 곳이 없어도 된다(쓰지 않는 지역 변수는 이 저장소의 typecheck에서 오류가 아니다 — `tsconfig.json:15`의 `noUnusedLocals: false`). 7단계가 더하는 것은 타이머 effect, `persistMaps`의 알림 줄, 띠 줄의 `justSaved`, `MAP_SAVED_NOTICE_MS`의 import다.

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| 50 | **저장은 저장한 도면의 편집을 끝내지 않는다**: `persistMaps` 조각에 `await execute(command);` 다음에 `doc.rebaseDrafts(savedMaps(command));`. 그 조각의 `await execute(command);` **뒤쪽**에 `snapshot`·`current`·`draft`(단어)·`doc.beginEditing`·`doc.enterNewMap`이 없다. 편집기 전체에 `dropDrafts`가 없고 `await persistMaps(`가 정확히 넷. `useBackgroundMapDocument.ts`에 `dropDrafts`가 없고 `type: 'rebase-drafts'`가 있다. `mapDocument.ts`의 `rebaseDrafts`에 `!!draft &&`(초안이 있는 것만)와 `freshDraft(map)`, `freshDraft`에 `past: [], future: [], dropped: 0`. `mapWorkflow.ts`의 `savedMaps`에 `revision: (expectedRevision ?? 0) + 1`. `saveMap` 조각에 `setTool(`이 없다 | 버리기로 되돌림(저장하면 띠가 사라진다) / 클로저의 `current`로 초안을 다시 엶(다음 저장이 거절된다) / `enterNewMap`으로 도면마다 엶(편집 중이 아니던 도면에 초안이 생긴다) / `saveMap`만 다시 놓고 나머지 셋은 버림 / 저장 뒤 도구를 `select`로 돌림 |
| 51 | **바뀐 것이 있을 때만, 겹치지 않게 저장한다**: `saveMap` 조각에 차례로 `if (!current \|\| !draft \|\| !canEdit \|\| saving.current) return;`, **`if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); setRefused(count => count + 1); return; }`**(바뀜 검사보다 **앞** — 4.2), `if (!mapDraftChanged(mapDraft(doc.getState(), current.id))) return;`, `if (!current.name.trim()) {`, `const settled = settle()`, `saving.current = true; setBusy(true);`, `finally { saving.current = false; setBusy(false); }`. 그 조각에 `draftChanged`가 없다. **저장 대신 문장으로 끝나는 세 곳이 그 문장을 끌어온다**: 그 조각에 `setRefused(count => count + 1)`가 정확히 셋(이름 줄, 다각형 줄, `catch`)이고, 편집기에 `useEffect(() => { if (refused) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [refused]);`와 `<div className="bg-error" role="alert" ref={errorRef}>`가 있다. 띠 파일에 **`const idle = !status.canSave \|\| disabled;`**, `aria-disabled={idle}`, `onClick={() => { if (!idle) onSave(); }}`, **`title={status.canSave ? '도면 저장 (Ctrl+S)' : status.phase === 'saving' ? undefined : '저장할 변경이 없어요'}`**가 글자 그대로 있고, `bmap-edit-save` 버튼의 태그에 ` disabled=`가 없다 | 바뀜 검사를 뺌(손대지 않은 도면의 버전이 오른다) / **다각형 검사를 바뀜 검사 뒤로 옮김**(찍던 점만 있는 깨끗한 도면에서 Ctrl+S가 말없이 끝난다) / **`idle`을 `disabled`만으로**(저장할 것이 없어도 저장 버튼이 켜진 모습이다 — `saveMap`이 돌아가므로 모습만 틀려서 다른 검사에 걸리지 않는다) / 풍선의 식을 빼거나 바꿈(흐린 버튼이 왜 눌리지 않는지 말해 주는 글이 없어진다) / 렌더의 `draftChanged`로 봄(방금 확정된 칸이 저장되지 않는다) / ref를 일찍 돌아가는 검사 앞에서 켬(그리다 만 다각형으로 한 번 거절되거나 저장할 것이 없을 때 Ctrl+S를 한 번 누른 뒤 영영 저장되지 않는다) / `finally`에서 끄지 않음 / 저장 버튼을 `disabled`로 끔 / 끌어오기를 뺌(좁은 창에서 Ctrl+S가 아무 일도 없어 보인다) / `block: 'nearest'`를 뺌(이미 보이는 문장 때문에 화면이 튄다) |
| 52 | **잃을 것이 없을 때만 묻지 않고 끝낸다**: `endEditing` 조각에 차례로 `if (!current \|\| !editing \|\| disabled) return;`, `abortGesture();`, `if (mapDraftChanged(mapDraft(doc.getState(), current.id)) \|\| polygon.length) { setError(''); setConfirmation('discard'); return; }`, `leaveEditing(); focusCanvas();`. 그 조각에 `future`가 없다(모두 되돌린 초안은 묻지 않는다, I10). `leaveEditing` 조각에 `doc.discard(current.id);`와 `setPolygon([])`와 `setSavedNotice(null)`. `confirmAction`의 `if (confirmation === 'discard') {` 가지에 `leaveEditing();`과 `focusAfterConfirm.current = true; setConfirmation(null); return;`. 편집기 전체에 `setConfirmation('discard')`가 정확히 한 번. **띠의 '편집 끝내기'가 `endEditing`에 이어져 있다**: 띠 줄에 `onEnd={endEditing}`과 `disabled={disabled}`가 있고, 띠 파일에 `<button type="button" className="bmap-edit-end" disabled={disabled} onClick={onEnd}>편집 끝내기</button>`가 글자 그대로 있다. **창의 제목과 글이 같은 값으로 갈린다**: 편집기에 제목의 식 `confirmation === 'discard' ? (draftChanged ? '저장하지 않고 편집을 끝낼까요?' : '편집을 끝낼까요?')`와 글의 식 `confirmation === 'discard' ? (draftChanged ? '이 도면에서 저장 안 한 변경은 사라져요.' : '그리던 다각형이 사라져요.')`가 글자 그대로 있고, 버튼 `'버리고 끝내기'`가 있으며 `'도면 편집을 취소할까요?'`·`'저장하지 않은 변경사항'`·`'변경사항 버리기'`가 없다 | 늘 물음 / 제목을 한 문장으로 되돌림(찍던 점만 있을 때 저장할 것이 있는 것처럼 묻는다, 5.2) / 제목과 글 가운데 한쪽의 갈림을 뒤집음 / 늘 묻지 않음(저장 안 한 편집이 말없이 사라진다) / 렌더의 `draftChanged`로 봄 / `\|\| polygon.length`를 뺌(찍던 점이 말없이 사라진다) / 머리줄에 묻지 않는 '취소'를 남김 / **띠의 `onEnd`를 `leaveEditing`에 이음**(저장 안 한 편집이 묻지 않고 사라진다 — `endEditing` 조각은 멀쩡하고 `setConfirmation('discard')`도 한 번 그대로라, 띠 줄을 보지 않으면 초록이다) / 띠의 '편집 끝내기' 버튼을 `onSave`에 이음 / 띠 줄의 `disabled`를 다른 값으로 바꿈(저장이 도는 동안 버튼이 눌리는 모습이 된다) |
| 53 | **Ctrl+S는 창 단위에서, 가드를 지나, 치던 값을 확정하고 저장한다**: `onSaveKey` 조각에 차례로 `if (event.code !== 'KeyS' \|\| !(event.ctrlKey \|\| event.metaKey) \|\| event.altKey \|\| event.shiftKey) return;`, `if (!root \|\| root.offsetParent === null \|\| !editing) return;`, `if (createForm \|\| linkForm \|\| settingsForm \|\| confirmation \|\| document.querySelector(openDialogs)) return;`, **`if (element && element !== document.body && !element.closest('.bg-library')) return;`**, `if (element?.closest(textFields) && !root.contains(element)) return;`, `event.preventDefault(); event.stopPropagation();`, `if (event.repeat) return;`, `requestSave();`. 그 조각에 `closest('dialog')`·`closest(textEntry)`가 없고(창을 대상에 묻지 않는다), **`isComposing`과 `229`가 없다**(조합 중을 막다른 길로 두지 않는다, 8.2). 편집기에 `const openDialogs = 'dialog[open], [aria-modal="true"]';`, `window.addEventListener('keydown', onSaveKey, true);`와 `window.removeEventListener('keydown', onSaveKey, true);`. `requestSave` 조각에 `if (!current \|\| !canEdit \|\| saving.current \|\| pointerRef.current \|\| doc.isGestureActive()) return;` 다음 `focusCanvas();` 다음 `void saveMap();`. `keyboard()` 조각에 `'KeyS'`와 `=== 's'`가 없다. 띠의 `onSave`가 `requestSave`다(편집기의 띠 줄에 `onSave={requestSave}`) | 버블 단계로 검 / 뿌리의 `onKeyDown`으로 옮김(포커스가 `body`일 때 듣지 못한다) / 창을 `closest('dialog')`로 물음(Tab이 끝을 지난 뒤 뚫린다) / 상태 넷 가운데 하나를 뺌 / **배경 화면 밖의 포커스를 넘기는 줄을 뺌**(비밀번호 변경 창의 버튼에서 누른 Ctrl+S가 창 밑의 도면을 저장한다) / 그 줄에서 `element !== document.body`를 뺌(포커스가 아무 데도 없을 때 — K4의 `body` — 듣지 못한다) / 반복 가드를 뺌 / 조합 중을 삼키고 아무것도 하지 않게 되돌림(한글 이름을 치고 바로 누른 Ctrl+S가 말없이 죽는다) / `preventDefault`를 뺌 / `!editing`을 뺌(보기 모드에서 삼킨다) / `focusCanvas()`를 뺌(치던 값·조합 중인 글자가 저장에서 빠진다) / 리스너를 떼지 않음 |
| 54 | **띠는 평면과 3D에 요소 하나이고, 도면 위에 고정 높이로 붙는다**: 편집기에 `<BackgroundMapEditStrip`이 정확히 한 번, `{editing && draft && <BackgroundMapEditStrip `의 꼴이고(`canEdit`이 아니다), 그 자리가 `<BackgroundMapPanels gallery={gallery}>`보다 앞이며 `{mode === 'plan' ? <svg ref={svgRef}`보다 앞이다. `.bmap-main`의 줄이 6.2의 글자 그대로다(`bmap-main${editing ? ' is-editing' : ''}`를 담는다). **띠의 마크업이 CSS가 거는 꼴 그대로다**: 띠 파일에 `<section className="bmap-edit-strip" data-phase={status.phase}`와 `<p className="bmap-edit-state"><strong>{MAP_EDIT_LABEL}</strong><span>{status.detail}</span></p>`가 글자 그대로 있고, `className="bmap-edit-key"`·`className="bmap-edit-actions"`·`className="bmap-edit-end"`·`className="bmap-edit-save"`가 각각 정확히 한 번 있다(아래 CSS 줄들이 거는 자리다 — CSS 줄만 보면 마크업이 어긋나도 초록이다). CSS — **줄을 찾는 법이 둘이다**: 기본 규칙의 줄(아래에서 그냥 '… 줄', '…로 시작하는 줄'이라고 적은 것)과 순서 검사의 네 줄은 **줄 맨 앞**(들여쓰지 않은 줄)에서 찾고, 미디어 블록 안의 줄(6.5의 세 줄, 좁은 창의 덮어쓰기)은 **앞 공백을 떼고** 찾는다. 기본 규칙을 앞 공백을 떼고 찾으면 900px 이하 블록의 같은 선택자 덮어쓰기까지 걸려 "하나씩"이 둘이 되고, 덮어쓰기를 떼지 않고 찾으면 찾지 못한다(테두리 줄도 같다 — `no-preference` 블록 안에 같은 선택자로 시작하는 들여쓴 줄이 있다. C-10의 "없다" 검사는 색을 보느라 들여쓴 줄까지 앞 공백을 떼고 본다 — 11.2). `.bmap-edit-strip {` 줄에 `position:sticky`, `top:0`, **`z-index:5`**, `flex:0 0 var(--bmap-edit-h)`, `height:var(--bmap-edit-h)`. `.bmap-edit-state {` 줄에 `white-space:nowrap`·**`min-width:0`**·**`min-height:23px`**, `.bmap-edit-state>span {` 줄에 `text-overflow:ellipsis`·**`overflow:hidden`**(말줄임표는 `nowrap`·`min-width:0`·`overflow:hidden`·`text-overflow`가 다 있어야 그려지고, 두 줄 배치의 버튼 줄은 `min-height`가 있어야 제자리다 — 6.3). `.bmap-layout {`로 시작하는 첫 줄과 `.bmap-main {` 줄에 `overflow:clip`이 있고 `overflow:hidden`이 없다. 테두리 줄이 `.bmap-main.is-editing .bmap-canvas-wrap::after {`로 시작하고 **`content:""`·`inset:0`**·`position:absolute`·`pointer-events:none`을 담는다. `.bmap-canvas-wrap {` 줄에 `border`가 없다. 6.5의 세 줄이 `@media(min-width:901px) {` 줄과 그 블록을 닫는 `}` 줄 사이에 있다. **순서(줄 번호로 본다)**: `.bmap-layout { --bmap-edit:`로 시작하는 줄, `.bmap-edit-strip {`·`.bmap-edit-state {`·`.bmap-edit-key {`로 시작하는 줄이 (줄 맨 앞에서) 각각 하나씩 있고 넷 다 `@media(max-width:900px) {` 줄보다 **앞**이다. **좁은 창의 덮어쓰기**(앞 공백을 떼고 찾는다): 그 `@media(max-width:900px) {` 줄과 그 블록을 닫는 `}` 줄 사이에, 들여쓴 `.bmap-layout { height:auto; min-height:0; --bmap-edit-h:72px; }`, `.bmap-edit-strip { flex-wrap:wrap`으로 시작하는 줄, `.bmap-edit-state { flex:1 0 100%`로 시작하는 줄, `.bmap-edit-key { margin-left:auto`로 시작하는 줄이 있다. 파일 어디에도 `.bmap-edit-key { display:none`이 없다. `@media(max-width:1100px) { .bmap-edit-strip { padding-left:14px; } }` 줄이 기본 `.bmap-edit-strip {` 줄보다 뒤, `@media(max-width:900px) {` 줄보다 앞에 있다(띠의 왼쪽을 머리줄에 맞춘다, 6.8). **상태의 모양**: `.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {` 줄에 `border-radius`와 `background:rgb(var(--bmap-edit-ink))`, `.bmap-edit-strip[data-phase="saved"] .bmap-edit-state>span::before {` 줄에 `content:"✓"`. **저장 버튼**: `.bg-library .bmap-edit-strip .bmap-edit-save {` 줄에 `min-width:`·`font-weight:600`·`transition:none`이 있고, **흐린 상태의 줄**(`.bg-library .bmap-edit-strip .bmap-edit-save[aria-disabled="true"],`로 시작하는 줄)이 **정확히 하나 있으며** `background:transparent`·`cursor:default`를 담고 `font-weight`가 없다(없는 줄에 대고 "`font-weight`가 없다"만 물으면 그 줄을 지워도 초록이다). **가리는 포커스**: `.bmap-main.is-editing :is(button,input,select,summary) { scroll-margin-top:var(--bmap-edit-h); }` 줄이 글자 그대로 있고(`[tabindex]`가 없다), **띠의 두 버튼에서 그 여백을 빼는 줄** `.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }`가 글자 그대로 있다 | 띠를 평면 가지 안에 둠 / `canEdit`에 닮(저장 때 깜빡인다) / `overflow:hidden`으로 되돌림(붙지 않는다) / 테두리를 진짜 `border`로(도면이 줄어든다) / 높이를 `auto`로 / 세 줄을 미디어 블록 밖으로(좁은 창의 높이 규칙을 이긴다) / **기본 덩어리를 파일 끝으로 옮김**(900px 이하에서 띠가 40px인 채 두 줄 내용이 잘린다) / 좁은 창의 `flex-wrap` 줄을 뺌(72px 한 줄에서 수가 잘린다) / `z-index:5`를 뺌(붙은 띠가 도면 밑에 깔린다) / 테두리의 `content:""`나 `inset:0`을 뺌(테두리가 그려지지 않는다) / 알약 줄을 뺌(바뀜이 문장의 꼬리로만 갈린다) / 흐린 저장 버튼의 굵기를 바꿈(옆의 것이 밀린다) / **흐린 저장 버튼의 줄을 지우거나 그 줄의 `background:transparent`를 뺌**(저장할 것이 없어도 채워진 버튼으로 보인다) / `scroll-margin-top`의 대상에 `[tabindex]`를 넣음(도면을 누를 때 화면이 움직인다) / **띠의 두 버튼에서 여백을 빼는 줄을 지움**(띠가 붙은 채 Tab으로 띠의 버튼에 닿거나 '돌아가기'로 포커스가 돌아올 때 탭이 움직인다) / **`.bmap-edit-state`의 `min-height:23px`를 지움**(두 줄 배치에서 첫 편집과 저장 때 버튼 줄이 2px 오르내린다) / **`.bmap-edit-state`의 `min-width:0`을 지움**(긴 글자가 두 버튼을 띠 밖으로 밀어 잘린다) / **`.bmap-edit-state>span`의 `overflow:hidden`을 지움**(글자가 표시 없이 잘린다) / **띠의 `data-phase={status.phase}`를 빼거나 속성 이름을 바꿈**(알약과 ✓가 영영 그려지지 않는다 — 세 상태가 모양으로 갈리지 않는다, I2) / **`{status.detail}`을 `<span>` 없이 두거나 다른 태그로 쌈**(`.bmap-edit-state>span`이 걸리지 않아 같은 결과다) / 띠의 클래스 이름 하나를 바꿈(그 규칙이 걸리지 않는다) |
| 55 | **띠의 색은 테마의 두 색과 바탕에서 온다**: `useMapEditColors.ts`에 `getComputedStyle(document.documentElement)`와, **호출 전체** `mapEditColors(theme.getPropertyValue('--color-accent'), theme.getPropertyValue('--color-accent-sub'), theme.getPropertyValue('--color-bg-primary'))`(세 인자와 그 차례까지), `root.style.setProperty('--bmap-edit', colors.strip)`, `root.style.setProperty('--bmap-edit-ink', colors.ink)`, **관찰의 호출 전체** `observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] })`, `observer.disconnect()`가 있고 `document.documentElement.style.setProperty`가 없다. **처음 한 번을 부른다**: `inOrder(source, 'apply();', 'new MutationObserver(apply)')`. 그 파일에 `data-color-mode`를 **읽는** 줄(`getAttribute`)이 없다. 편집기에 `useMapEditColors(rootRef);`가 한 번 | 색을 CSS에 못 박음 / 관찰하지 않음(화면을 바꿔도 띠 색이 그대로다) / `<html>`에 씀(자기 자신과 3D의 관찰자를 깨운다) / 모드 속성으로 톤을 정함(직접 고른 테마에서 어긋난다) / **처음의 `apply();`를 뺌**(기본이 아닌 모든 테마에서 호박이 남는다) / 인자의 차례를 바꿈(`mapEditColors(바탕, 강조색, …)`) / 보조 강조색을 읽지 않음(강조색을 두 번 넘김) / 뿌리(`root`)를 관찰함(테마가 바뀌어도 듣지 못한다) |
| 56 | **깨끗한 초안만, 저장이 돌지 않고 편집기의 창이 닫혀 있을 때만 따라간다. 보던 도면이 없어지면 다른 도면으로 갈 때처럼 비운다**: 편집기의 `const followSaved = useEvent(() => {`에서 그 effect까지에 차례로 **가드 줄 전체** `if (disabled \|\| doc.isGestureActive() \|\| confirmation \|\| createForm \|\| linkForm \|\| settingsForm) return;`, `const before = mapDraft(doc.getState(), current?.id);`, `doc.followSaved(snapshot.maps);`, `if (mapDraft(doc.getState(), current?.id) !== before) setActiveVertex(null);`, **비우는 줄 전체** `if (before && !mapDraft(doc.getState(), current?.id)) { setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); }`, **의존 목록까지** `useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, confirmation, createForm, linkForm, settingsForm]);`. `mapDocument.ts`의 `follow-saved` 가지(`block`으로 자른다)에 `!mapDraftChanged(draft)`, `state.gesture?.mapId !== map.id`, `map.revision > (draft.baseRevision ?? Infinity)`, 그리고 없어진 도면의 줄 `!known.has(id) && !mapDraftChanged(followed.drafts[id]) && followed.gesture?.mapId !== id`. 그 가지에 `dropDrafts(`가 없다 | `disabled` 가드를 뺌(실패한 저장의 값을 쥔다 / 낙관 값의 "없음"에 초안을 치운다) / 바뀐 초안도 따라감(편집이 사라진다) / `>`를 `>=`로(자기 메아리가 다시 실행 기록을 지운다) / 없어진 도면의 바뀐 초안까지 치움(편집이 사라진다) / 없어진 도면의 깨끗한 초안을 남김(지워진 도면이 편집할 수 있는 도면으로 남는다) / 고른 점을 풀지 않음(다른 PC가 바꾼 다각형에서 Delete가 엉뚱한 점을 지운다) / **가드에서 창 넷 가운데 하나를 뺌** — 넷을 하나씩(`confirmation`: 응답을 잃은 삭제 뒤 다시 누른 '삭제'가 목록의 첫 도면을 지운다, 버리기 창의 '버리고 끝내기'가 다른 도면의 편집을 버린다 / 나머지 셋: 창이 쥔 도면이 창 밑에서 바뀐다) / **의존 목록에서 창 넷을 뺌**(창을 닫아도 다음 읽기가 올 때까지 따라가지 않는다) / **비우는 줄을 뺌**(찍던 다각형 점이 다른 도면 위에 그려지고, 그 도면의 저장이 보이지 않는 다각형 때문에 거절된다) / 비우는 줄에서 `setPolygon([])`만, `setTool('select')`만 뺌 / 비우는 조건을 `!== before`로 넓힘(다른 PC가 저장할 때마다 찍던 점과 도구가 풀린다) |
| 57 | **저장 알림은 띠 안에서, 잠깐**: `persistMaps` 조각에 `const shown = current?.id;`가 `await` **앞**에 있고, `if (shown && command.maps.some(item => item.entity.id === shown) && mapDraft(doc.getState(), shown)) setSavedNotice({ mapId: shown });`. 타이머 effect에 차례로 `window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS)`, `return () => window.clearTimeout(timer);`, **`}, [savedNotice]);`**(의존이 빈 배열이면 "저장했어요"가 띠에서 영영 떠나지 않는다). 띠 줄에 `savedNotice?.mapId === current.id`와 `mapEditStatus(draft, pending,`. 띠 파일에 `<span className="sr-only" role="status">{status.announce}</span>`. 이 기능의 어느 `.tsx`에도 `sonner`가 없다. 편집기에 `setNotice(`가 저장 길(`persistMaps`·`saveMap` 조각)에 없다 | 타이머를 지우지 않음 / 타이머 effect의 의존을 `[]`로 / 다른 도면에서도 알림을 보임 / `busy`로 저장 중을 봄 / 알림을 도면 위 안내 블록으로 냄(도면이 흔들린다) |
| 58 | **머리줄과 문구**: 편집기에 `>편집 시작</button>`이 정확히 한 번 있고, 그 버튼의 태그에 `className="bg-button bmap-edit-start"`(보라색 `bg-primary`가 없다), `disabled={disabled \|\| editing}`, `aria-hidden={editing \|\| undefined}`, `onClick`에 `beginEditing(); setInspectorOpen(true); focusCanvas();`가 있다. 그 버튼이 `{editing ?`·`!editing &&`의 갈림 안에 있지 않다(같은 줄에서 `>도면 설정</button>` 바로 다음에 `<button type="button" className="bg-button bmap-edit-start"`가 온다). CSS에 `.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }`가 글자 그대로 있고 `display:none`이 그 줄에 없다. 편집기와 이미지 목록 파일에 `공간 편집에서`·`도면 편집에서`·`>공간 편집<`·`>취소</button>`(머리줄의 것 — `.bmap-actions` 줄 안)이 없다. **안내 글은 버튼이 보이는 사람에게만 버튼 이름을 말한다**(6.7): 이미지 목록 파일에 `도면을 편집하면서`가 정확히 둘이고 `편집 시작`이라는 글자가 없으며(편집 중인 사람도 보는 글이다), 편집기에 빈 도면의 안내 `snapshot.canManage ? "'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다." : '관리자가 공간을 배치하면 여기에 표시됩니다.'`가 글자 그대로 있다(읽기 전용 계정에는 그 버튼이 없다). 편집기에 `'저장 전 변경사항'`이 없고 `'편집 중'`이라는 글자가 없다(문구는 `mapEditStatus.ts`에 있다). 트리의 점 줄이 `mapDraftChanged(mapDraft(state, map.id)) && <span className="bmap-draft-dot" title="저장 안 한 변경이 있어요">●</span>`다(조건은 그대로, 풍선만 띠와 같은 말). '연결 해제' 버튼의 `onClick`이 `() => { focusCanvas(); void linkMap(null, selected.id); }`다 | '편집 시작'을 보라색으로 / 편집 중에 '편집 시작'을 DOM에서 뺌(더블클릭이 설정 창을 연다) / `visibility:hidden`을 `display:none`으로(같은 문제) / 배지를 남김 / 점의 조건을 띠의 상태로 바꿈 / '연결 해제'의 `focusCanvas()`를 뺌(저장 뒤 Delete·Ctrl+Z가 듣지 않는다) / 이미지 목록의 글에 '편집 시작'을 넣음('편집 중' 띠 아래에서 보이지 않는 버튼을 누르라고 한다) / 빈 도면의 안내에서 권한의 갈림을 뺌(읽기 전용 계정에 없는 버튼을 말한다) |
| 59 | **새 테스트 파일이 빌드에서 돈다**(11.5) | 파일이 지워지거나 이름이 무늬 밖으로 바뀜 / 테스트를 모두 건너뜀으로 바꿈 |

앵커는 **뮤테이션으로 확인**한다(임시 복사본에서 표의 변형을 하나씩 넣어 실패하는지 본다 — 저장소 밖 폴더에서). 순수 테스트도 표본을 뽑는다: `commitDraft`의 `dropped` 더하기를 뺌(D-1), `rebaseDrafts`의 `!!draft &&`를 뺌(D-4), `freshDraft`가 `future`를 남김(D-6), `follow-saved`의 세 조건 각각(D-6), `savedMaps`의 `+ 1`을 뺌(W-1·F-1), `follow-saved`의 없어진 도면 줄의 세 조건 각각(D-6b), `mapEditStatus`의 가지 순서 바꾸기 둘(11.1의 3·5), **알림이 떠 있는 동안의 바뀜을 저장 중 검사보다 앞에서 따로 다룸**(`if (changed && justSaved) return …`을 맨 앞에 — 11.1의 10), 바뀜에서 수를 읽어 줌(`announce`에 수 — 11.1의 2), `changed: steps > 0`(11.1의 7), `mapEditColors`가 톤을 늘 밝은 쪽으로(C-1·C-7), 가까운 쪽을 고름(C-1), 색상 없음을 빨강으로 읽음(C-4), 밝기 계산에서 감마를 뺌(C-0), 색상 없음의 문턱을 0.09로(C-4의 `140 130 119`), 보조 강조색을 보지 않음(C-3c·C-4), 예비색을 뺌(C-3b), 예비색을 두 후보와 대등하게 봄(C-3·C-5), **예비색을 보는 문턱을 55로 적음**(`farthest >= 55` — 상수는 60인 채. C-3b의 거꾸로 검사), 읽히지 않는 테마 색에 늘 밝은 톤(C-6의 나).

**살아남기 쉬운 변형 — 반드시 넣어 본다**(앵커가 조각의 글자만 보면 통과하던 것들이다): (1) `useMapEditColors`의 처음 `apply();`를 지움, (2) `mapEditColors`의 인자 차례를 바꿈, (3) `observer.observe(root, …)`로 바꿈, (4) `.bmap-edit-strip`의 `z-index:5`를 지움, (5) 테두리 줄의 `content:""`를 지움, (6) 테두리 줄의 `inset:0`을 지움, (7) 알림 타이머 effect의 의존을 `[]`로, (8) **6.8의 기본 덩어리를 파일 끝으로 옮김**, (9) 900px 이하 블록의 `.bmap-edit-strip { flex-wrap:wrap … }` 줄을 지움, (10) D-8의 둘째 액션을 같은 버전의 `maps: [mapA, mapB]`로 바꿈(테스트 쪽 변형 — 따라갈 것도 없어진 것도 없어 실패해야 한다), (11) `onSaveKey`에 `event.isComposing` 가드를 되살림, (12) '편집 시작'을 `!editing &&`로 감쌈, (13) `saveMap`의 `catch`에서 `setRefused`를 뺌, (14) **띠 줄의 `onEnd={endEditing}`을 `onEnd={leaveEditing}`으로 바꿈**(`endEditing` 조각과 "`setConfirmation('discard')`가 한 번"은 그대로라 띠 줄을 보지 않는 앵커 52는 초록이었다), (15) **띠 파일의 `data-phase={status.phase}`를 지움, 그리고 따로 `<span>{status.detail}</span>`을 `{status.detail}`로 바꿈**(둘 다 넣어 본다 — CSS 줄만 보는 앵커 54는 초록이었다), (16) 띠 파일의 `const idle = !status.canSave || disabled;`를 `const idle = disabled;`로 바꿈, (17) 흐린 저장 버튼의 CSS 줄을 통째로 지움, 그리고 따로 그 줄의 `background:transparent`만 지움, (18) `.bmap-edit-state {` 줄의 `min-width:0`을 지움, 그리고 따로 `.bmap-edit-state>span {` 줄의 `overflow:hidden`을 지움, (19) `.bmap-edit-state {` 줄의 `min-height:23px`를 지움, (20) `.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }` 줄을 지움, (21) 저장 버튼 줄에 `color:white`를 적음, 그리고 따로 900px 이하 블록의 들여쓴 `.bmap-edit-strip` 줄에 `background:#f5b240`을 적음(C-10 — 줄의 앞 공백을 떼지 않고 보면 뒤의 것이 초록이다), (22) `saveMap`의 다각형 검사를 바뀜 검사 뒤로 옮김, (23) `onSaveKey`에서 배경 화면 밖의 포커스를 넘기는 줄을 지움.

### 11.5 빌드 게이트 — 떨어진 파일을 알아채는 법

`test:background`는 파일 이름의 무늬(`./tests/background*.test.ts`)라서 새 파일 둘은 `package.json`을 고치지 않아도 들어간다. 거꾸로 **파일이 지워지거나 이름이 무늬 밖으로 바뀌면 조용히 초록불**이다. 앵커 59가 지킨다(무늬에 걸리는, 오래된 파일 안에 둔다):

- `tests` 폴더에 `backgroundMapEditStatus.test.ts`와 `backgroundMapEditColor.test.ts`가 있고, 각각 줄의 맨 앞에서 시작하는 `test(`가 셋 이상이며 `test.skip(`·`test.todo(`·`{ skip:`이 없다(건너뛰는 테스트만 든 파일도 초록불이다).
- `package.json`의 `scripts['test:background']`가 정확히 `node --test ./tests/background*.test.ts`다.
- `scripts.build`와 `scripts['build:vite']`가 `npm run test:background`를 담는다.

**앵커 59가 보지 못하는 것 — git에 올리지 않은 파일.** 앵커는 파일 시스템을 읽는다. 새 파일을 `git add`하지 않아도 작업 폴더에서는 모든 게이트가 초록이고, 커밋에는 그 파일이 없다. 이 저장소에는 CI가 없어서(`.github/workflows` 없음) 같은 폴더에서 빌드하면 끝내 드러나지 않는다. 그래서 PR을 만들기 전에 한 번 본다(14절의 9단계):

```
git status --porcelain -- src/features/backgrounds tests docs DEVLOG        # '??'로 시작하는 줄이 없어야 한다
git ls-files --error-unmatch src/features/backgrounds/mapEditStatus.ts src/features/backgrounds/mapEditColor.ts src/features/backgrounds/useMapEditColors.ts src/features/backgrounds/BackgroundMapEditStrip.tsx tests/backgroundMapEditStatus.test.ts tests/backgroundMapEditColor.test.ts
```

둘째 명령은 여섯 파일이 모두 git에 올라 있을 때만 성공한다(여섯 경로 가운데 무시 목록에 걸리는 것은 없다 — `git check-ignore`로 확인했다).

### 11.6 통과 기준

`npm run typecheck`, `npm run test:background`(542 + 새 테스트. 건너뜀 5는 그대로 — SQL이 바뀌지 않으므로 PGlite 실행은 필요 없다), `npm run test:motion`(CSS를 고친 단계부터 — `src`의 모든 CSS를 읽는다), 마지막에 `npm run build:vite`.

---

## 12. 수동 검증 (앱 엔진: Electron 33)

방법은 ②·③과 같다: `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130, 기본 주소 `http://localhost:5190/?preview=1`), 미리보기 시험 계정(배한솔)으로 로그인 → 배경 → 도면. 실제 마우스·키보드 입력을 넣고 화면을 본다. 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면(기본 테마)에서 보고, 나머지 세 조합에서는 ★ 항목을 다시 본다. 이번 차례는 저장 모양을 바꾸지 않으므로 미리보기 저장소를 다른 세션과 함께 써도 그 세션이 깨지지 않는다(저장한 도면 내용은 남는다 — 검증 기록에 주소를 적는다).

**이 목록을 그대로 따라 할 수 있게 — 방법 몇 가지**

- **테마를 바꾸는 길**: 설정 › '색상 테마'. 카드의 이름은 화면에 보이는 대로다 — 바이올렛 드림(Violet Dream) · 공산당 레드(Cinema Red) · 윤성원 블루(Midnight Blue) · 에메랄드(Emerald) · 똥파리 골드(Amber Gold) · 이혜민 머쉬룸. **설정으로 가면 편집기가 내려간다** — 테마를 바꿀 때마다 배경 › 도면으로 돌아와 '편집 시작'을 다시 누른다(저장 안 한 편집은 사라진다. 색을 볼 때는 저장해 두고 간다).
- **직접 고른 두 색**: 같은 곳의 '커스텀' 카드 → '메인 액센트'·'서브 액센트'의 색 칸(`<input type="color">` — 글자 칸이 따로 없다) → '적용'. 값을 넣는 법은 둘이다: 색 칸을 눌러 뜨는 색 고르기 창의 16진수 칸에 치거나, 개발 도구에서 넣는다 — `const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; const [main, sub] = document.querySelectorAll('input[type="color"]'); set(main, '#3b82f6');`. **'커스텀'을 열면 두 칸은 지금 쓰던 프리셋의 두 색으로 채워져 있다** — 항목이 서브 액센트를 말하지 않으면 그 값 그대로 둔다(무엇이 남아 있는지를 항목에 적어 두었다).
- **동작 줄이기**: OS의 설정을 바꾸지 않는다. 개발 도구 › 더 보기 › Rendering › 'Emulate CSS media feature prefers-reduced-motion: reduce'.
- **같은 저장소를 쓰는 둘째 창**: 개발 도구 콘솔에서 `window.open(location.href)`. 미리보기 저장소는 `localStorage`와 `BroadcastChannel`이라(previewGateway.ts:13-33) 같은 주소의 창끼리만 통한다 — 따로 연 Chrome은 다른 저장소다.
- **실제 한글 입력기**: 자동 입력이 만든 키는 조합을 일으키지 않는다. E6은 손으로 한글 입력기를 켜고 치거나(한솔의 PC에서 해도 된다), 원격 디버깅 포트를 연 미리보기에서 CDP `Input.imeSetComposition`으로 조합을 연 채 Ctrl+S를 보낸다. 어느 쪽으로 했는지 검증 기록에 적는다.

**먼저 (엔진 동작 — 15.2의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E1 ★ | 740×900 평면에서 편집을 시작하고 탭을 맨 아래(이미지 목록)까지 내린다. 3D에서도. 1440×900 3D에서도 내린다 | 띠가 탭의 맨 위에 붙어 있고 그 밑으로 도구줄·도면·속성 칸이 지나간다. 띠 위로 비쳐 보이는 것이 없다(도면·도구줄이 띠 **위에** 그려지지 않는다). 가로 스크롤이 생기지 않는다. **붙지 않으면 15.2의 첫 줄 — 붙지 않는 채로 넘어가지 않는다** |
| E2 ★ | 평면과 3D에서 테두리를 본다. 테두리 바로 안쪽 가장자리의 공간·손잡이를 누른다. 이름 칸을 가장자리 가까이 연다 | 네 변이 모두 보인다(3D 화면과 보조 평면도 위에서도). 가장자리의 것이 눌린다. 도구줄과 이름 칸이 테두리 위에 있다 |
| E3 ★ | 1440×900 평면: 편집 시작 전과 뒤의 SVG 크기(개발 도구로 `getBoundingClientRect`)를 잰다. 3D의 캔버스도. 740에서도 | 가로·세로가 같다. **평면**: 이미지 목록이 40px 짧아진다. **3D(1440×900)**: 이미지 목록의 높이도 그대로이고(약 207px) 탭이 40px 더 스크롤한다 — 탭이 이미 최소 높이보다 낮아서다(6.5의 셋째 줄). 740에서는 크기가 같고 72px 내려간다. 편집을 끝내면 제자리 |
| E4 ★ | 띠의 높이와 폭을 잰다: 깨끗함 / 변경 9개 / 10개 / 100개 넘게(검사 창의 자동 입력으로 같은 것을 거듭 옮긴다) / 저장 중 / 방금 저장함. **창 폭 1440, 901(앱 사이드바를 펼친 채 — 본문 약 532px), 900, 740(사이드바를 펼친 채 — 약 381px)** 에서 | 901 이상에서 늘 40px 한 줄, 900 이하에서 늘 72px 두 줄. 어느 폭에서도 글자가 줄바꿈되지 않고, **말줄임표(…)가 생기지 않는다**('저장 안 한 변경 100개'의 수가 끝까지 보인다). **깨끗함 → 바뀜(첫 편집) → 저장 중 → 방금 저장함 → 깨끗함, 그리고 바뀜 → 모두 되돌림**을 지나는 동안 `Ctrl+S` 표시와 두 버튼의 **왼쪽과 위쪽** 가장자리(`getBoundingClientRect()`의 `left`·`top`)가 1px도 움직이지 않는다 — **900과 740의 두 줄 배치에서는 `top`을 꼭 잰다**(알약이 생기고 사라질 때 버튼 줄이 2px 오르내리던 자리다, 6.3). 900 이하에서 `Ctrl+S` 표시가 버튼 줄의 버튼 왼쪽에 있다 |
| E5 ★ | 어두운 ↔ 밝은 화면을 편집 중에 바꾼다(평면, 3D) | 띠·테두리·트리의 점이 곧바로 그 화면의 톤이 된다(7.3). 3D 화면의 색도 지금처럼 바뀐다 |
| E6 | **실제 한글 입력기로**(위의 방법). (가) 공간을 그려 열린 평면의 이름 칸에 `주방`을 치고, 마지막 글자 `방`에 밑줄이 있는 채(조합 중) Ctrl+S를 **한 번**. (나) 속성 칸의 이름 입력에서 같은 일. (다) 한글 입력 상태에서 도면에 포커스를 두고 Ctrl+S, 숫자 칸에서 Ctrl+S | (가)(나) **저장된다**: 칸이 닫히고(가) 띠가 "✓ 도면을 저장했어요"가 되며, 새로 고침 뒤 이름이 정확히 `주방`이다 — 마지막 글자가 빠지지도(`주`) 겹치지도(`주방방`) 않는다. (다) 저장된다(`event.code`가 `KeyS`다). **(가)(나)에서 아무 일도 없으면 실패다** |
| E7 | '편집 시작'을 마우스로 누른 직후 Delete·Ctrl+Z·`+`를 누른다. '도면 저장'을 마우스로 누른 직후에도. '편집 끝내기' 뒤에 `+` | 클릭 없이 듣는다. 마우스로 눌렀을 때 도면에 포커스 고리가 거슬리게 남지 않는다 |
| E8 | 동작 줄이기를 흉내 낸 상태(위의 방법), 그리고 앱 설정 '움직임: 최소'에서 편집을 시작한다 | 띠와 테두리가 움직임 없이 곧바로 있다. 알약 모양과 ✓가 그대로 보인다. 저장 알림이 4초 동안 보인다 |
| E9 | **'편집 시작'을 더블클릭한다**(1440과 740에서, 마우스로 실제 더블클릭) | 편집에 들어가고 **'도면 설정' 창이 뜨지 않는다**. 편집 중의 머리줄에서 '도면 설정'이 보기 때와 같은 자리에 있다(`getBoundingClientRect().left`가 같다). 편집을 끝내면 '편집 시작'이 같은 자리에 다시 보인다 |
| E10 | 740×900에서 편집 중 탭을 내려 띠가 붙은 채: **(가)** Shift+Tab으로 화면 위쪽의 버튼·칸(도구줄의 버튼, 속성 칸의 이름 입력)에 차례로 닿는다. **(나)** Tab으로 띠의 `편집 끝내기`와 `도면 저장`에 닿는다. 이어서 공간 하나를 옮기고 `편집 끝내기` → 뜬 창에서 `돌아가기`. **(다)** 도면(SVG)의 **위쪽 가장자리가 스크롤 상자의 맨 위에서 0~72px 아래** — 붙은 띠에 가려진 자리 — 에 있고 아래쪽은 화면 안에 있게 탭을 맞춘 뒤, 포커스를 다른 곳(속성 칸의 칸)에 둔 채 도면을 마우스로 누른다. (가)(나)는 1440×900의 3D에서도 | (가) 포커스된 것이 띠 밑에 가리지 않는다(띠 바로 아래에 온전히 보인다). (나) **세 번 모두 화면이 움직이지 않는다**(앞뒤로 `.bg-tab-content`의 `scrollTop`이 같다) — 포커스는 그 버튼에 있다. (다) **화면이 움직이지 않는다**(`scrollTop`이 같다). (다)에서 화면이 움직이면 **먼저 가린다**: 개발 도구에서 `scroll-margin-top` 두 줄을 끄고 같은 자리에서 같은 누름을 되풀이한다 — 그래도 움직이면 이 설계의 규칙 탓이 아니라 지금도 있는 동작이다(:698, 6.4). 적어 두고 규칙은 둔다. **끄면 멈출 때만** 15.2의 그 줄이다. 도면의 위쪽이 스크롤 상자 **위로** 올라가 있는 자리에서는 재지 않는다 — 그 자리의 누름은 v1.134.0에서도 화면을 움직일 수 있다 |

**띠의 상태**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| S1 ★ | 보기 모드 | 머리줄에 `속성 접기` · `도면 설정` · **`편집 시작`**(테두리만, 보라색 아님). 띠·테두리·제목 옆 배지가 없다 |
| S2 ★ | `편집 시작` | 띠 "편집 중 · 저장된 그대로예요"(맨 글자), 'Ctrl+S', `편집 끝내기`, 흐린 `도면 저장`(풍선 '저장할 변경이 없어요'). 테두리. 머리줄에서 `편집 시작`이 보이지 않고(자리는 비어 있다) `취소`·`도면 저장`이 없다. 연결된 배경이 없는 도면이면 아래 이미지 목록의 안내가 "도면 설정에서, 또는 도면을 편집하면서 …"다 — 보이지 않는 `편집 시작`을 누르라고 하지 않는다(6.7) |
| S3 ★ | 공간 하나를 옮긴다 → 또 옮긴다 → 되돌리기 → 다시 실행. **3D에서도**(기즈모로 옮긴다) | "저장 안 한 변경 1개" → 2개 → 1개 → 2개, **채워진 알약 모양 안에**. `도면 저장`이 같은 칠로 켜진다. **끄는 도중에는 글자가 변하지 않는다.** 화면을 흑백으로 보아도(개발 도구 › Rendering › 'Emulate vision deficiencies: Achromatopsia') 깨끗함과 바뀜이 한눈에 갈린다. **"한눈에"의 기준(게이트 A에서 본다)**: 깨끗함(S2)과 바뀜의 화면을 하나씩 찍어 **25%로 줄여** 나란히 놓고, 어느 쪽이 저장 안 한 쪽인지 가를 수 있다 — 평면과 3D, 1440×900과 740×900, 어두운·밝은 화면의 여덟 쌍 모두에서. 띠와 테두리는 두 상태에서 같으므로 가르는 것은 왼쪽 끝의 알약(약 130×23px)과 오른쪽 끝의 저장 버튼(80×28px)뿐이고, 그 둘은 움직임 없이 나타난다. 갈리지 않는 쌍이 있으면 15.2의 그 줄 |
| S4 | 숫자 칸에 값을 한 글자씩 친다 | 그 칸에서 1개만 는다(합쳐진다) |
| S5 | 공간을 그리고 열린 이름 칸에 이름을 친다 | 1개(그리기와 첫 이름이 한 단계) |
| S6 | 모두 되돌린다 | "저장된 그대로예요"(알약이 사라진다), `도면 저장`이 흐려진다 |
| S7 | 같은 것을 51번 넘게 고친 뒤 되돌리기를 끝까지 누른다 | 수가 50이 아니라 실제 수에서 50 준 값으로 남고(예: 55 → 5), `도면 저장`이 켜져 있고, `편집 끝내기`가 묻는다 |

**저장**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| V1 ★ | 고친 뒤 `도면 저장` | "저장 중…"(버튼도 '저장 중…') → 굵은 **"✓ 도면을 저장했어요"** → 4초 뒤 "저장된 그대로예요". 알약이 사라지고 저장 버튼이 흐려지는 것이 같은 순간이다. **띠와 테두리가 그대로 있다**(편집 중). 도면 크기가 변하지 않는다. 라이브러리 머리줄의 '저장 중…'이 돌아온다. "저장 중…"과 "✓ 도면을 저장했어요" 사이에 "저장된 그대로예요"가 한 프레임 보일 수 있다 — 실패가 아니다(둘 다 깨끗한 상태의 글자다, 15.4) |
| V2 ★ | 이어서 고치고 다시 저장한다(세 번 되풀이) | 매번 통과한다. "다른 사용자가 내용을 변경했습니다"가 뜨지 않는다. 새로 고침해도 저장 내용이 같다 |
| V3 | 저장 직후 되돌리기·다시 실행 버튼 | 둘 다 꺼져 있다. Ctrl+Z가 아무것도 하지 않는다 |
| V4 | 여러 개를 고른 채 저장 / 평면을 옮기고 확대한 채 저장 / 3D에서 돌려 본 채 저장 / '화면 이동' 도구를 든 채 저장 | 선택(묶음 버튼 포함)·보기·3D 자세·도구가 그대로다 |
| V5 | 저장이 도는 동안 도면을 끌어 본다 / 휠 | 끌리지 않는다 / 확대·축소된다(지금과 같다). **끌기 도중에 Ctrl+S**는 아무 일도 하지 않고 끌기가 이어진다 |
| V6 | 저장 알림이 떠 있는 4초 안에 고친다 | 곧바로 "저장 안 한 변경 1개" |
| V7 | 그리다 만 다각형이 있는 채 저장(**이름을 비운 도면은 화면으로는 만들 수 없다** — 편집기에서 도면 이름을 고치는 곳은 설정 창뿐이고 그 창은 빈 이름을 받지 않는다, 4.2. `saveMap`의 이름 검사는 방어 가드이고 앵커 51이 본다). **그리고 다각형 점만 둘 찍고 다른 변경은 없는 도면에서 Ctrl+S** | 지금의 문장이 빨간 띠로 뜨고 띠는 "저장 안 한 변경 N개" 그대로. **다각형만 있는 도면에서도 같은 문장("그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.")이 뜬다** — 띠는 "저장된 그대로예요" 그대로이고 찍던 점도 그대로다(말없이 끝나지 않는다, 4.2). 그때 띠의 흐린 `도면 저장`을 마우스로 누르면 아무 일도 없다 |
| V7b ★ | **까닭이 화면 밖일 때**: 740×900에서 공간 하나를 옮기고(바뀜), 다각형 도구로 점을 둘 찍은 뒤, 탭을 속성 칸·이미지 목록까지 내려 머리줄이 보이지 않게 하고 **Ctrl+S**. 띠의 '도면 저장'을 눌러서도. 1440×900의 3D에서 머리줄이 가려질 만큼 내린 채로는 V8의 방법(저장을 실패시킨다)으로 — 3D에는 그리다 만 다각형이 없다 | 탭이 위로 움직여 **편집기의 빨간 띠가 화면 안에 온다**(맨 위에 빨간 띠, 그 바로 아래에 띠). 이미 보이는 중에 다시 누르면 화면이 움직이지 않는다 |
| V8 | 저장을 실패시킨다(개발 도구에서 `window.electronAPI.backgroundExecute`를 던지는 함수로 바꾼다) | 빨간 띠에 오류(화면 밖이었으면 화면 안으로 온다). 띠는 '바뀜'으로 돌아오고 초안·되돌리기 기록이 그대로다. 함수를 되돌린 뒤 다시 저장하면 통과 |
| V9 | 편집 중 **도면 설정 → 이름을 바꾸고 설정 저장** | 창이 닫히고 띠가 그대로 있으며 "✓ 도면을 저장했어요". 제목·트리에 새 이름. 이어서 고치고 저장하면 통과 |
| V10 | 편집 중이 **아닌** 채 도면 설정 → 설정 저장 | 보기 모드 그대로(띠가 생기지 않는다) |
| V11 | 편집 중 공간을 골라 **연결 해제** / **기존 도면 연결**(창의 '연결하고 열기') / **내부 도면 만들기**('만들고 들어가기') | 해제: 그 도면에서 계속 편집 중. 연결: 옮겨 간 도면이 **보기**로 열린다(띠가 없다 — 그 도면에 초안이 없었다면). 만들기: 새 도면이 **편집 중**으로 열린다. 둘 다 원래 도면으로 돌아오면 띠가 "저장된 그대로예요"로 있다 |
| V11b | **연결 해제**를 누른 직후(다른 곳을 누르지 않고) Delete, Ctrl+Z, F2를 누른다 | 클릭 없이 듣는다(연결 해제는 저장돼서 Ctrl+Z로 돌아오지 않는다 — 키가 **닿는지**를 본다: Delete가 고른 공간을 지울지 묻는다) |
| V12 | 깨끗한 편집 중 상태로 두고, 둘째 창(위의 방법)에서 그 도면을 고쳐 저장한 뒤 첫 창에서 15초 기다린다(또는 첫 창을 눌러 포커스를 준다) | 편집 중인 화면이 새 모습이 된다. 띠의 글자는 그대로다. 이어서 고치고 저장하면 통과 |
| V12b | **고른 점**: 첫 창에서 다각형 공간을 골라 점 하나를 눌러 고른다(끌지 않는다 — 깨끗한 채). 둘째 창에서 그 다각형의 점 하나를 지우고 저장한다. 첫 창이 따라간 뒤 Delete | **점이 지워지지 않는다.** 고른 점이 풀려 있고, Delete는 고른 점이 없을 때처럼 그 공간을 지울지 묻는다('돌아가기'로 닫는다) |
| V13 | V12와 같은 일을 **저장 안 한 변경이 있는** 상태에서 한다 | 화면이 그대로다(내 편집이 남는다). 저장하면 지금의 충돌 문장(2차에서 다룬다) |
| V14 | **다른 곳에서 지워진 도면**: 첫 창에서 하위 도면 하나를 깨끗한 편집 중 상태로 두고, 둘째 창에서 그 도면을 지운다(도면 설정 → 도면 삭제). 15초. 같은 일을, 그 도면을 편집 중인 채 **다른 도면을 보고 있을 때**도 | 그 도면이 첫 창의 목록에서 빠진다. 보고 있었다면 화면이 목록의 첫 도면으로 가고 띠가 없다(그 도면이 편집 중이 아니라면). 콘솔 오류가 없다 |
| V14b | 같은 일을 **저장 안 한 변경이 있는** 상태에서 | 도면이 목록에 남는다(내 편집이 남는다). 저장하면 지금의 충돌 문장 |
| V14c | **그리다 만 다각형이 있을 때**: V14와 같되, 첫 창에서 그 하위 도면에 다각형 도구로 점을 둘 찍어 둔 채(다른 변경 없이 — 띠는 "저장된 그대로예요") 둘째 창에서 그 도면을 지운다. 15초. 이어서, 옮겨 간 첫 도면에서 `편집 시작` → 공간 하나를 옮기고 `도면 저장` | 화면이 목록의 첫 도면으로 가고, **찍던 두 점이 그 도면 위에 그려져 있지 않다.** 다각형 줄('2개 점 · 다각형 완성 · 취소')이 없고 도구가 '선택'이다. 이어서 한 저장이 통과한다("그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요."가 뜨지 않는다) |
| V14d | **삭제 확인 창이 열린 채 — 응답을 잃은 삭제**: 하위 도면이 없는 도면 하나(목록의 첫 도면이 **아닌** 것)를 고쳐 저장해 깨끗한 편집 중으로 둔다. 개발 도구에서 "실행은 하고 답만 잃는" 함수로 바꾼다 — `const real = window.electronAPI.backgroundExecute; window.electronAPI.backgroundExecute = async request => { await real(request); throw new Error('응답 없음'); };` → 도면 설정 → 도면 삭제 → `삭제`. 오류가 뜬 직후와 20초 뒤에 창 뒤를 본다. 함수를 되돌리고(`window.electronAPI.backgroundExecute = real`) 열린 창에서 `삭제`를 다시 누른다. 그다음 `돌아가기` | 창이 오류와 함께 열린 채 남고, **20초 뒤에도 창 뒤의 도면(경로와 제목)이 지우려던 그 도면이다** — 목록의 첫 도면으로 바뀌지 않는다. 다시 누른 `삭제`는 "다른 사용자가 내용을 변경했습니다…"로 거절되고 **다른 도면이 하나도 지워지지 않는다**(목록의 도면 수가 그대로다. 새로 고침해도 같다). `돌아가기` 뒤에 그 도면이 목록에서 빠지고 화면이 첫 도면으로 간다 |
| V14e | **버리기 확인 창이 열린 채**: 목록의 첫 도면에서 공간 하나를 옮겨 둔다(저장하지 않는다 — 트리에 점). 하위 도면으로 가서 `편집 시작`, 다각형 점을 둘 찍고 `편집 끝내기` → 뜬 창("그리던 다각형이 사라져요.")을 닫지 않는다. 둘째 창에서 그 하위 도면을 지우고 20초. 첫 창에서 `버리고 끝내기` | 기다리는 동안 창의 글과 창 뒤의 도면이 그대로다. `버리고 끝내기` 뒤에 그 도면이 목록에서 빠지고 화면이 첫 도면으로 간다. **첫 도면의 저장 안 한 변경이 그대로 있다**(띠에 "저장 안 한 변경 1개", 옮긴 공간이 옮긴 자리에 있다) |

**편집 끝내기**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| X1 ★ | 아무것도 바꾸지 않고 `편집 끝내기` | 묻지 않고 끝난다. 띠·테두리가 사라지고 `편집 시작`이 같은 자리에 다시 보인다 |
| X2 ★ | 고친 뒤 `편집 끝내기` | 창 "저장하지 않고 편집을 끝낼까요?" · "이 도면에서 저장 안 한 변경은 사라져요." · `돌아가기` / `버리고 끝내기` |
| X3 | `돌아가기` / Esc | 창만 닫힌다. 편집 중 그대로, 포커스가 `편집 끝내기`에 있다. 띠가 붙어 있던 채였어도 화면이 움직이지 않는다(740에서는 E10의 (나)가 `scrollTop`으로 잰다) |
| X4 | `버리고 끝내기` | 편집이 끝나고 고친 것이 사라진다. 바로 `+`를 누르면 확대된다 |
| X5 | 저장한 뒤 곧바로 `편집 끝내기` | 묻지 않는다 |
| X6 | 고친 뒤 모두 되돌리고 `편집 끝내기` | 묻지 않는다(I10). 다시 `편집 시작`을 누르면 '다시 실행'이 꺼져 있다 — 되돌린 것은 돌아오지 않는다 |
| X7 | 숫자 칸에 값을 치고 칸을 떠나지 않은 채 `편집 끝내기`를 누른다 | 묻는다(그 값이 변경이다) |
| X8 | 다각형 점을 두 개 찍고(다른 변경 없이) `편집 끝내기` | **묻는다**: 창의 제목이 "편집을 끝낼까요?"이고("저장하지 않고 …"가 아니다 — 띠는 "저장된 그대로예요"다) 글이 "그리던 다각형이 사라져요."다. `돌아가기` → 찍은 두 점이 그대로 있고 이어서 찍을 수 있다. 다시 눌러 `버리고 끝내기` → 편집이 끝나고 점이 없다 |
| X8b | 공간을 하나 옮기고(바뀜) 다각형 점도 두 개 찍은 채 `편집 끝내기` | 묻는다. 제목은 "저장하지 않고 편집을 끝낼까요?", 글은 "이 도면에서 저장 안 한 변경은 사라져요." |
| X9 | 편집 중 Esc를 여러 번 | 편집이 끝나지 않는다 |
| X10 | 고친 채 트리에서 다른 도면으로 갔다 돌아온다 | 묻지 않고 간다. 간 도면에는 띠가 없고 트리의 원래 도면에 점(올려 두면 "저장 안 한 변경이 있어요", 색은 띠와 같다). 돌아오면 띠와 수가 그대로 |

**Ctrl+S**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| K1 ★ | 도면에 포커스를 두고 Ctrl+S | 저장된다 |
| K2 ★ | 숫자 칸에 범위 안의 값을 치고 칸을 떠나지 않은 채 Ctrl+S / 범위 밖의 값(바닥 높이에 큰 수)을 치고 Ctrl+S | 친 값이 저장된다 / 한계 값이 저장된다. 포커스가 도면으로 간다 |
| K3 ★ | 평면의 이름 칸에 새 이름을 치고 Enter 없이 Ctrl+S(영문·숫자 이름으로, 그리고 한글 이름을 다 친 뒤 — 조합이 열린 채의 Ctrl+S는 E6이 실제 입력기로 본다. 기대는 셋 다 같다) | 칸이 닫히고 새 이름이 저장된다 |
| K4 | 속성 칸의 이름 입력·선택 상자에서 Ctrl+S / 이미지 목록의 검색 칸에서 / 도구줄 버튼을 누른 직후 / 아무것도 누르지 않은 직후(`body`) | 모두 저장된다 |
| K5 | 저장할 것이 없을 때 Ctrl+S — 도면에 포커스를 두고 / 이미지 목록의 검색 칸에 검색어를 친 채 / 이름 칸을 열어 아무것도 치지 않은 채(F2) | **쓰기가 나가지 않는다**("저장 중…"이 뜨지 않는다. 띠는 "저장된 그대로예요" 그대로다. 버전이 오르지 않는다 — 새로 고침 뒤 다른 창의 초안이 영향받지 않는 것으로 본다). **포커스는 도면으로 간다**(8.3): 검색 칸에서는 커서가 칸에서 빠지고 검색어는 그대로다. 열어 둔 이름 칸은 닫히고 이름은 그대로다(변경이 생기지 않는다). 그리다 만 다각형이 있을 때는 V7이다 |
| K6 | Ctrl+S를 빠르게 두 번 / 누르고 있는다 | 저장이 한 번. 오류가 뜨지 않는다 |
| K7 ★ | 3D에서 Ctrl+S / 기즈모를 끄는 도중 Ctrl+S | 저장된다 / 아무 일도 없고 끌기가 이어진다 |
| K8 ★ | 보기 모드에서 Ctrl+S | 아무 일도 없다 |
| K9 ★ | **창이 열린 채 Ctrl+S**: 도면 설정 창 / 버리기 확인 창 / 연결 창 / 배경 상세 창(이미지 목록의 카드) / 앱의 업데이트 내역 창. 각각 **Tab을 끝까지 돌려 포커스가 사라진 순간**에도 누른다. **그리고 앱의 비밀번호 변경 창**(창이라는 표시가 없는 덮개다, 8.2) — 포커스를 그 창의 **버튼**에 둔 채, 그리고 글자 칸에 둔 채 | 어느 것도 저장하지 않는다. 설정 창을 닫지 않고 '설정 저장'을 누르면 통과한다. 비밀번호 변경 창: 버튼에서도 칸에서도 저장하지 않고, 포커스가 그 창에 그대로 있다(그 창의 바탕을 눌러 포커스가 아무 데도 없게 한 뒤의 Ctrl+S는 재지 않는다 — 알고 넘어가는 틈이다, 15.4) |
| K10 | 배경 화면의 다른 탭(배경 목록)에서 Ctrl+S / 앱 검색창에 포커스를 두고 Ctrl+S / **고친 뒤 앱 위쪽 줄의 어두운·밝은 전환 버튼을 누르고(포커스가 그 버튼에 남는다) 곧바로 Ctrl+S, 이어서 도면을 한 번 누르고 Ctrl+S** | 아무 일도 없다 / 아무 일도 없다 / **앞의 것은 아무 일도 없고**(띠의 알약이 그대로다 — 포커스가 배경 화면 밖에 있다, 8.2) **도면을 누른 뒤의 것은 저장된다** |
| K11 | Ctrl+Shift+S, Ctrl+Alt+S | 아무 일도 없다 |
| K12 | Ctrl+Z · Ctrl+Y · Ctrl+D · Delete · F2 · `+ − 0` · Space 끌기 | 지금과 같다 |

**색**

테마를 바꿀 때마다 편집을 다시 시작한다(이 절 맨 위의 방법). 색은 공간 하나를 고른 채로 본다 — 선택된 외곽선과 손잡이가 보조 강조색이다.

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| C1 ★ | 기본 — 바이올렛 드림(Violet Dream) | 어두운 화면: 밝은 호박 띠에 어두운 글자. 밝은 화면: 짙은 호박 띠에 흰 글자 |
| C2 ★ | **똥파리 골드(Amber Gold)** | 띠·테두리·트리의 점이 **청록**이다. 테마의 두 색(탭 밑줄, 선택된 공간의 외곽선·손잡이)과 갈린다. 두 화면 |
| C3 ★ | **에메랄드(Emerald)** | 호박 띠. 테마의 두 색과 갈린다. 두 화면 |
| C4 | 공산당 레드(Cinema Red) · 윤성원 블루(Midnight Blue) · 이혜민 머쉬룸 | 청록 · 호박 · 청록(7.3) |
| C5 ★ | **직접 고른 두 색 — 색상이 없는 색이 있거나 프리셋의 서브 액센트가 남은 경우(예비색 없이 호박·청록)**: 바이올렛 드림에서 '커스텀'을 열어 (가) 메인 액센트만 회색 `#808080`으로(서브 액센트는 바이올렛 드림의 `#A29BFE`가 남는다), (나) 메인·서브 둘 다 `#808080`으로, (다) 메인만 연두 `#7ED321`로 — 각각 '적용' | (가) 호박, (나) 호박, (다) 청록. 글자가 읽힌다 |
| C5b ★ | **직접 고른 두 색 — 다른 계열(예비색 보라)**: 똥파리 골드에서 '커스텀'을 열어 **메인 액센트만** 파랑 `#3B82F6`으로 바꾸고 '적용'(서브 액센트는 똥파리 골드의 `#FBBF24`가 남는다). 어두운 화면에서 한 번, 밝은 화면에서 한 번 — 밝은 화면은 **먼저** 밝은 화면으로 바꾸고 똥파리 골드 카드를 다시 고른 뒤 같은 일을 한다(이미 '커스텀'인 채로 화면만 바꾸면 바탕이 어두운 채 남는다 — 그것은 C6이다) | 띠·테두리·점이 **보라**다(어두운 화면: 밝은 보라 `220 150 255`에 어두운 글자, 밝은 화면: 짙은 보라 `134 46 178`에 흰 글자). 파란 채움과도, 노란 외곽선·손잡이와도 갈린다. 오류처럼 보이지 않는다. 글자와 두 버튼, 흐린 저장 버튼, 알약이 읽힌다 |
| C6 | 직접 고른 두 색을 어두운 화면에서 적용한 뒤 앱 머리줄에서 밝은 화면으로 바꾼다(`data-color-mode`는 `light`인데 바탕은 어두운 채 남는다, 2.7) | 띠가 **실제 바탕**에 맞는 톤이다: 바탕이 어두우므로 **밝은 톤에 어두운 글자**(밝은 화면의 짙은 톤 + 흰 글자가 아니다) |
| C7 | C1~C5b의 각 테마에서 띠의 두 버튼, 흐린 저장 버튼, 알약, 포커스 고리(Tab) | 읽힌다. 포커스 고리가 띠 위에서 보인다. **흐린 저장 버튼은 따로 본다**: 그 글자는 일부러 띠와 3.1~3.3:1이다(7.5 — 띠의 다른 글자는 4.5 이상). 통과 기준은 "꺼져 있다로 보이면서 '도면 저장'이라는 글자를 읽을 수 있다"이고, 여섯 톤(호박·청록·보라 × 두 화면)을 모두 본다. 어느 톤에서든 글자를 읽기 어려우면 15.2의 그 줄(투명도 .78) |
| C8 | 띠가 오류처럼 보이지 않는지: 저장을 실패시켜 빨간 띠와 나란히 둔다(호박·청록·보라 각각) | 둘이 다른 것으로 읽힌다 |
| C9 ★ | **청록 테두리와 기호**: 띠가 청록인 테마(똥파리 골드, 공산당 레드, 이혜민 머쉬룸)에서, 문·의자·계단 기호를 도면 작업 영역의 가장자리 가까이에 둔 도면을 평면과 3D로 본다. **카메라 하나의 색을 청록으로 바꿔**(속성 칸의 카메라 색) 같은 가장자리에 둔다. **두 화면을 모두 본다 — 한쪽만 보고 넘어가지 않는다**: 어두운 화면은 테두리와 기호·청록 카메라의 밝기가 거의 같고(1.15:1, 1.01:1), 밝은 화면의 3D는 기호의 채도가 테두리에 더 가깝다(2.7) | 테두리가 **테두리로** 읽힌다: 영역을 한 바퀴 두른 또렷한 선이고, 같은 색상의 회청록 기호(색상이 같고 채도가 낮다, 2.7)와 이어져 보이거나 기호의 일부로 보이지 않는다. 청록 카메라(색상이 12~13° 차이)도 테두리와 이어져 보이지 않는다. 그렇게 읽히지 않으면 15.2의 그 줄 |
| C10 | **호박 테두리와 카메라 시점**: 기본 테마(띠가 호박)의 3D에서 편집 중 카메라를 골라 '이 카메라 시점으로 보기'. 보조 평면도를 편 채, 접은 채. 윤성원 블루·에메랄드에서도. 어두운·밝은 화면 모두 | 테두리가 두 화면을 온전히 두르고 있다. 3D 화면 아래의 카메라 시점 표시(호박 테두리와 글자)와 '둘러보기로 돌아가기' 버튼이 읽히고, 띠나 테두리의 일부로 보이지 않는다. 평면의 호박색 카메라도 테두리와 섞이지 않는다. 그렇게 읽히지 않으면 15.2의 그 줄 — C9와 같은 길이다(테두리를 굵게, 그래도 섞이면 게이트 A에서 멈춘다) |

**배치와 회귀**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| L1 ★ | 창 폭 1210 · 1231 · 1300 · 1320에서 편집 중 도구줄 | 검증 기록 :331과 같다(1,231~1,310에서 두 줄, 그 밖은 그때와 같다). 띠는 어느 폭에서도 한 줄 |
| L2 | 창 폭 901과 900을 오간다 — 앱 사이드바를 **펼친 채**와 접은 채, 띠의 글자가 가장 긴 상태('저장 안 한 변경 100개'와 '저장 중…')로 | 띠가 한 줄(40px) ↔ 두 줄(72px). 901에서 한 줄 안에 글자·`Ctrl+S`·두 버튼이 모두 들어가고 말줄임표가 없다. 900에서 두 줄의 버튼이 잘리지 않는다(위아래가 띠 밖으로 나가지 않는다). 두 폭 모두에서 띠의 '편집 중'이 바로 위의 도면 제목과 같은 자리에서 시작한다(두 요소의 `getBoundingClientRect().left`가 같다 — 1,100px 이하에서 머리줄의 여백은 14px이다, 6.8) |
| L3 | 1440×900에서 창을 낮춰(높이 700 — 탭 약 520px) 편집을 시작한다. 이어서 오류 띠를 띄운다(V8의 방법, 또는 공간 하나를 옮기고 다각형 점을 찍은 채 `도면 저장`) | 오류 띠가 없을 때: 이미지 목록의 아래가 잘리지 않고 탭이 스크롤한다(`.bmap-gallery`의 `bottom`이 `.bmap-main`의 `bottom`을 넘지 않는다). **오류 띠가 떠 있는 동안: `.bmap-main`의 최소 높이가 편집 전보다 띠의 높이만큼(40px — 500 → 540) 늘어 있고, 이미지 목록의 아래가 잘리는 양(`.bmap-gallery`의 `bottom` − `.bmap-main`의 `bottom`)이 오류 띠가 차지하는 높이(띠의 높이 + 바깥 여백 24px)를 넘지 않는다** — 오류 띠는 최소 높이의 셈에 없어서, v1.134.0에서도 더 낮은 창이 같은 양만큼 잘린다(6.5의 어림은 약 19px, 게이트 A의 실측은 한 줄짜리 오류 띠 42.1px에서 23.2px). 오류 띠가 사라지면 돌아온다. **최소 높이가 띠만큼 늘지 않았거나 잘리는 양이 오류 띠가 차지하는 높이를 넘으면 실패다** |
| L4 | 도면 높이 손잡이를 끝까지 늘린 뒤 편집을 시작한다 | 도면이 많아야 40px 줄고 이미지 목록이 160px 아래로 내려가지 않는다 |
| L5 | 속성 접기 / 3D의 보조 평면도 접기 / 기호 목록 열기 | 띠와 테두리가 그대로다. 기호 목록이 띠에 가리지 않는다 |
| U1 ★ | **읽기 전용**: 개발 도구에서 `window.electronAPI.backgroundRead`를 `canManage: false`를 돌려주게 감싸고 라이브러리의 새로고침을 누른다(미리보기에서 배경 화면을 여는 계정은 관리자뿐이다) | `편집 시작`이 없다. 띠·테두리가 없다. Ctrl+S가 아무 일도 하지 않는다. 공간이 없는 빈 도면을 열면 안내가 "관리자가 공간을 배치하면 여기에 표시됩니다."다 — 없는 버튼(`편집 시작`)을 말하지 않는다(6.7). 같은 도면을 권한이 있는 계정의 보기 모드로 열면 "'편집 시작'을 누르면 …"이다 |
| U2 | 편집 중에 같은 방법으로 권한을 뺀다 | 띠·테두리가 사라진다(초안은 2차가 다룬다 — 지금과 같다) |
| U3 ★ | **업데이트 안내**: 깨끗한 편집 중 상태에서 저장소의 기호 하나를 모르는 종류로 바꾸고 새로고침 | 안내가 탭과 본문을 대신한다(③과 같다). 콘솔 오류가 없다 |
| R1 ★ | ①: 휠 확대, 이름 칸(F2·더블클릭·그리기 뒤), 스냅과 Alt, 다각형 점 편집 | 그대로다. 이름 칸이 띠 밑에서 제자리에 뜬다 |
| R2 ★ | ②: 상자로 여러 개 고르기, 묶음 옮기기·잠그기·지우기, 같은 자리 천천히 다시 누르기, Space 끌기, 더블클릭으로 상세 도면 | 그대로다 |
| R3 | ③: 계단·도로·카메라 색을 놓고 저장 → 계속 편집 → 다시 저장 | 그대로이고 두 번째 저장이 통과한다 |
| R4 | 3D: 기즈모로 옮기고 저장 → 계속 → 다시 옮기고 저장. 카메라 시점으로 보기 | 그대로다 |
| R5 | 도면 삭제(설정 창 → 삭제) / 새 도면 만들기 | 지금과 같다(삭제하면 부모로, 만들면 새 도면에서 편집 중) |
| R6 | 전 과정의 콘솔 | 경고·오류 0(V8에서 일부러 낸 것 제외) |

---

## 13. 배포 기록과 문서

- **버전**: `package.json`의 `version`(:3)과 `package-lock.json`의 두 곳(:3 맨 위 `version`, :9 `packages[""].version`)을 `1.135.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다.
- **`DEVLOG/update-notes.json` 맨 앞에 추가**(비개발자 문구, 항목마다 1~3문장, 시험 공개 표기는 1.133.0과 같은 방식):

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

- **문서**
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절의 ③ 줄(:26) 다음에 `- [x] 2026-10-12 다-1 편집 상태 띠(v1.135.0): 편집 중에는 도면 위의 색 띠와 테두리, 저장 안 한 변경의 수, '편집 끝내기'·'도면 저장'·Ctrl+S. 저장해도 편집이 이어지고, 띠의 색은 테마의 두 색(강조색·보조 강조색)과 대비되게 계산한다. 저장 자료·운영 DB·IPC 변경 없음. 설계: docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md` 한 줄. 버전 목록의 v1.134.0 절(파일의 끝) 다음에 `### v1.135.0 배경 도면 편집 상태 띠 (2026-10-12)` 절: 띠와 테두리 / 저장 뒤에도 편집 중(되돌리기 기록은 비워짐) / 바꾼 것이 있을 때만 저장, 없으면 묻지 않고 끝내기 / Ctrl+S / 띠 색의 규칙 한 줄, `- [ ] 수동 검증(설계 12절 전체)`, `- [ ] 배포`, `- [ ] 다-2(초안 보관·알림)는 다음 차례`.
  - `AGENTS.md` '배경 라이브러리 데이터 경계': "새 도면 요소(v1.133.0)" 항목(:136) 다음에 한 항목 — **편집 상태 띠(v1.135.0)**: 편집 중은 깃발이 아니라 "초안이 있음"이다(`editing`). **저장은 어느 저장 길에서든 저장한 도면의 편집을 끝내지 않는다** — `persistMaps` 한 곳이 저장한 도면의 초안을 다시 놓는다(`rebase-drafts`. 초안이 없던 도면에는 열지 않는다 — 그래서 '연결하고 열기'로 옮겨 간 도면은 편집 중이 아니었으면 보기로 열린다). 사용자가 편집을 끝내는 길은 '편집 끝내기'(`leaveEditing`) 하나이고, 그 밖에 초안이 없어지는 것은 도면 삭제, `createMap`의 다시 시도 가지(부모), 다른 곳에서 지워진 도면의 깨끗한 초안(`follow-saved`)뿐이다 / 다시 놓을 도면은 **명령에서** 만든다(`savedMaps`): 저장이 끝나 돌아온 핸들러의 `snapshot`·`current`는 저장 전의 버전이고, 거기서 초안을 열면 다음 저장이 자기 자신과 충돌한다 / '바뀜'은 `mapDraftChanged` 한 곳(되돌리지 않은 단계가 있거나, 기록에서 밀려난 단계 `dropped`가 있다), 수는 `mapDraftSteps`. 띠·저장 버튼·'편집 끝내기'·트리의 점이 같은 함수를 읽는다. 핸들러 안에서는 렌더의 `draftChanged`가 아니라 `doc.getState()`에서 읽는다(방금 blur로 확정된 값) / 바뀐 것이 없는 초안은 저장하지 않는다(쓰기가 나가면 버전이 오르고 모든 화면에 신호가 간다). `saveMap`의 그리다 만 다각형 검사는 그 검사보다 **앞**이다 — 찍던 점은 초안이 아니라서, 뒤에 두면 점만 있는 도면의 Ctrl+S가 말없이 끝난다 / 저장 안 한 편집이 없는 초안만 라이브러리의 더 새 도면을 따라가고, 라이브러리에서 없어진 도면의 그런 초안은 함께 없어진다(`follow-saved`). **저장이 도는 동안에는 부르지 않는다**(그때의 스냅샷은 낙관 값이다). **편집기의 창(확인·만들기·연결·설정)이 열려 있는 동안에도 부르지 않는다** — 창은 보던 도면에 대고 묻는데, 깨끗한 초안이 없어지면 `navigate` 없이 보던 도면이 목록의 첫 도면으로 바뀐다(응답을 잃은 삭제 뒤 다시 누른 '삭제'가 다른 도면을 지운다). 창이 닫힐 때 다시 돌게 effect의 의존 목록에 그 넷을 둔다. 바뀐 초안은 건드리지 않는다. 보던 도면의 초안이 바뀌면 고른 점(`activeVertex`)을 풀고, **없어지면 `navigate`가 비우는 것(그리다 만 다각형·도구·기호 목록·초점 요청·오류)을 그 자리에서 비운다** / 띠는 `.bmap-main`의 자식 하나(평면·3D 공용)이고 `editing`에만 달려 있으며 높이는 창 폭으로만 정해진다. 저장 알림·경고는 띠 안에 둔다 — 도면 위에 블록을 끼우면 끌기 도중 도면이 어긋난다. 띠가 붙으려면 `.bmap-layout`·`.bmap-main`이 `overflow:clip`이어야 한다(`hidden`으로 되돌리지 않는다). **띠의 기본 CSS 규칙은 `@media(max-width:900px)` 블록보다 앞에 둔다** — 좁은 창의 덮어쓰기와 특이도가 같아 뒤에 오는 쪽이 이긴다 / 띠의 상태(깨끗함·바뀜·방금 저장함)는 색이나 움직임이 아니라 글자와 모양(`data-phase`)으로 가른다 / 띠의 40px은 이미지 목록이 낸다(편집을 시작해도 도면 크기가 같다) / 띠의 색은 `mapEditColors`(강조색·보조 강조색·화면 바탕 → 호박·청록 가운데 테마의 두 색에서 색상이 먼 쪽, 둘 다 60° 안이면 예비색 보라, 바탕과 대비가 큰 톤)가 정하고 `useMapEditColors`가 화면의 테마에서 읽어 편집기 뿌리에 쓴다. **강조색만 보지 않는다** — 직접 고른 테마의 두 색은 무관할 수 있고 편집기의 선은 대부분 보조 강조색이다. 빨강 계열을 후보에 넣지 않는다. 띠·테두리·점의 CSS에 색을 직접 적지 않는다 / Ctrl+S는 창 단위·캡처 단계에서 듣고, 열린 창은 이벤트 대상이 아니라 상태와 문서에 묻고, 포커스가 배경 화면(`.bg-library`) 밖의 요소에 있으면 넘기고(앱에는 `dialog`도 `aria-modal`도 아닌 창이 있다), 캔버스로 포커스를 옮겨 치던 값을 확정한 뒤 저장한다. **한글 조합 중이라고 아무 일도 하지 않게 두지 않는다**(포커스를 옮기면 조합이 확정된다). `keyboard()`에 넣지 않는다 / '편집 시작'은 편집 중에 DOM에서 빼지 않고 `visibility:hidden`으로 자리를 지킨다(빼면 '도면 설정'이 포인터 밑으로 밀려와 더블클릭이 설정 창을 연다) / 띠가 붙어 있을 때 가리는 포커스는 편집기의 칸·버튼에 준 `scroll-margin-top`으로 막는다. 도면(`[tabindex]`)에는 주지 않는다 — 누를 때 화면이 움직이면 끌기가 어긋난다. 띠 자신의 두 버튼에서도 뺀다 — 붙어 있는 띠의 버튼에 포커스가 갈 때마다 탭이 움직인다 / 안내 글은 버튼이 화면에 있는 사람에게만 그 이름('편집 시작')을 말한다 — 편집 중에는 감춰져 있고 읽기 전용 계정에는 없다.
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-12 다-1 편집 상태 띠 (v1.135.0)`(검증한 날이 다르면 그 날짜로) — 11.6의 수치, 12절의 결과(E1~E10의 관찰과 쓴 대체안, 색을 본 테마와 화면, 폭), 검증에 쓴 미리보기 주소, 확인하지 못한 것.
  - `docs/superpowers/plans/2026-10-10-feedback-additions.md`: 7절 진행 기록 표의 '다' 줄(:298)을 `| 다. 편집 상태와 저장 지키기 (G2) | 1차: docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md, 아래 7.3 · 2차: - | 1차(보이는 상태) 구현·검증 상태 · 2차(보관) 대기 |`로 고치고, 7.2 절 뒤에 `### 7.3 다-1. 편집 상태 띠 — 만든 것과 확인한 것 (v1.135.0, 날짜)` 절을 7.1·7.2와 같은 꼴(만든 것 / 확인한 것 / 확인하지 못한 것 / 한솔의 두 답과 이 설계가 정한 것)로 더한다.
  - `CLAUDE.md`: 고치지 않는다(구조 변경 없음).
  - 완료 보고(한솔에게): 15.3을 비개발자 문장으로 옮겨 적는다.

---

## 14. 구현 순서 (단계마다 typecheck·`test:background`가 통과하게)

**게이트와 누가 보는가.** 단계마다 `npm run typecheck`와 `npm run test:background`가 통과해야 다음 단계로 간다 — 그래서 각 단계의 테스트는 **그 단계까지 생긴 이름만** import한다. CSS를 고치는 4단계부터는 `npm run test:motion`도 돌린다. `npm run build:vite`는 9단계에서 돈다. **단계 끝의 "…을 본다"는 구현자가 아니라 오케스트레이터가 한다** — 그 단계의 게이트가 통과한 뒤, 다음 단계를 시작하기 전에(15.2의 대체안이 걸린 확인이라 뒤 단계가 그 위에 쌓이기 전에 본다). 구현자는 앱·미리보기 서버를 띄우지 않는다.

1. **상태 모델**: `mapDocument.ts`(`dropped`, `commitDraft`, `freshDraft`, `rebaseDrafts`, 두 액션, `mapDraftSteps`, `mapDraftChanged`), `useBackgroundMapDocument.ts`에 `rebaseDrafts`·`followSaved` 더하기(`dropDrafts`는 아직 둔다 — `persistMaps`가 쓴다), `mapWorkflow.ts`의 `savedMaps`, `mapEditStatus.ts` + 테스트(11.1, 11.3의 D-1~D-8 — D-6b 포함 — ·W-1·W-2). 화면은 달라지지 않는다(새 액션을 부르는 곳이 없다). 달라지는 것 하나: 51번 넘게 고치고 끝까지 되돌린 도면의 트리 점이 꺼지지 않는다(맞게 고쳐진 것이다).
2. **색 함수**: `mapEditColor.ts`(세 인자, 후보 셋) + 테스트(11.2의 C-0~C-8 — C-3b·C-3c 포함 — , C-11. CSS를 읽는 C-9·C-10은 4단계에서 더한다).
3. **저장 뒤 다시 놓기**: `persistMaps`(다시 놓기까지 — 알림 줄은 7단계), `saveMap`(검사의 차례 — 그리다 만 다각형 → 바뀜 → 이름, 4.2 — ·`saving` ref·도구 유지·`refused`와 그 effect·빨간 띠의 `ref`), 따라가기 effect(4.4의 코드 그대로 — 창이 열려 있는 동안 건너뛰는 가드와 의존 목록, 고른 점 풀기, 보던 도면이 없어졌을 때 비우기까지), `useBackgroundMapDocument.ts`에서 `dropDrafts` 빼기 + 테스트(11.3의 F-1~F-5, 앵커 50·51의 편집기 쪽·56). 이 시점의 화면: 머리줄은 예전 그대로인데 저장해도 '취소'·'도면 저장'이 남는다(편집 중). 손대지 않은 도면의 '도면 저장'은 아무 일도 하지 않는다.
4. **띠와 배치**: `BackgroundMapEditStrip.tsx`, `useMapEditColors.ts`, CSS 전부(6.8 — **기본 덩어리는 `.bmap-main` 규칙 바로 다음에**, 파일 끝이 아니다), `.bmap-main`의 `is-editing`, 띠를 그리는 줄(`onEnd`는 이 단계에서 `() => { setError(''); setConfirmation('discard'); }`, `onSave`는 `() => void saveMap()`, `justSaved` 자리는 `false`), **머리줄에서 `취소`·`도면 저장`을 빼고 제목 옆 배지를 뺀다**(띠와 겹치지 않게), 트리 점의 색과 풍선 + 테스트(C-9·C-10, 앵커 54·55, 51의 띠 쪽. 앵커 54의 순서 검사를 이 단계에서 넣는다). **오케스트레이터가 다음 단계를 시작하기 전에 E1~E5(E4는 '방금 저장함'을 뺀 데까지 — 아래)·E10, S2·S3(띠의 두 상태 — 깨끗함과 바뀜이 S3의 기준으로 한눈에 갈리는가), C1~C3·C5b·C9·C10, L1~L4를 본다(게이트 A). E1(띠가 붙는가)과 C9·C10(테두리가 같은 색상의 표시 — 기호와 청록 카메라, 카메라 시점 표시 — 와 섞이는가)이 기대와 다르면 15.2대로 — 대체안으로도 안 되면 여기서 멈추고 한솔에게 묻는다.** 이 단계의 화면은 머리줄에 예전 '공간 편집' 버튼이 남아 있고 띠의 '편집 끝내기'는 바꾼 것이 없어도 묻는다(임시 함수) — S2의 머리줄 쪽은 5단계 뒤에 본다. **띠의 `justSaved` 자리가 `false`라 '방금 저장함'도 이 단계의 화면에는 나오지 않는다**(저장하면 "저장 중…"에서 곧바로 "저장된 그대로예요"가 된다) — 그래서 E4는 여기서 깨끗함·바뀜(9·10·100개)·저장 중의 높이와 폭, 그리고 깨끗함 → 바뀜 → 저장 중 → 깨끗함과 바뀜 → 모두 되돌림을 지나는 동안의 `left`·`top`까지만 재고, '방금 저장함'의 높이·폭과 저장 중 → 방금 저장함 → 깨끗함 동안의 `left`·`top`은 게이트 B에서 잰다(7단계). 게이트 A에서 보는 것은 띠·테두리·배치·색·스크롤이다.
5. **버튼과 나가기**: `편집 시작`(이름·클래스·포커스, 편집 중에는 감춘 채 자리를 지킨다 — 4단계에서는 그 버튼이 예전의 `{editing ? … : …}` 갈림 안에 남아 있다), `leaveEditing`·`endEditing`, **`savedNotice` 상태의 선언 한 줄**(`leaveEditing`이 `setSavedNotice(null)`을 부르고 앵커 52가 그 호출을 찾는다 — 선언만 이 단계이고 타이머·켜는 줄·읽는 곳은 7단계다, 11.4), **띠의 `onEnd={endEditing}`**(4단계의 임시 함수 `() => { setError(''); setConfirmation('discard'); }`를 이것으로 바꾼다 — 남겨 두면 `setConfirmation('discard')`가 두 번이 되고, `leaveEditing`을 이으면 묻지 않고 버린다), `confirmAction`의 버리기 가지, 창의 제목·글·버튼, 안내 글 셋(6.7), '연결 해제'의 클릭(4.3) + 테스트(앵커 52·58).
6. **Ctrl+S**: `openDialogs`, `onSaveKey`와 effect, `requestSave`, 띠의 `onSave={requestSave}` + 테스트(앵커 53. `saveMap` 조각의 끝 표지를 `function requestSave(`로 좁힌다 — 11.4).
7. **저장 알림**: 알림 타이머 effect와 `MAP_SAVED_NOTICE_MS`의 import(`savedNotice` 상태는 5단계에서 선언했다), `persistMaps`의 알림 줄, 띠의 `justSaved` + 테스트(앵커 57). **오케스트레이터가 다음 단계를 시작하기 전에 E6~E9, E4의 나머지('방금 저장함'의 높이·폭, 그리고 저장 중 → 방금 저장함 → 깨끗함 동안 `Ctrl+S` 표시와 두 버튼의 `left`·`top` — 4단계에는 그 상태가 없어 게이트 A에서 재지 못한 것), V1~V5·V7b, K1~K3·K7~K9, X1~X4·X8을 본다(게이트 B). E6은 실제 한글 입력기로 한다.**
8. **앵커와 뮤테이션**: 앵커 59, 11.4의 변형과 순수 테스트의 표본, 그리고 **'살아남기 쉬운 변형' 스물셋**(둘로 나뉜 것은 따로따로)을 저장소 밖 임시 복사본에서 하나씩 넣어 모두 잡히는지 본다. 살아남는 것이 있으면 앵커를 고친다(구현은 고치지 않는다).
9. **버전과 문서**(13절), 그리고 그것까지 넣은 마지막 상태에서 **11.6의 전체 통과 기준**: `npm run typecheck`, `npm run test:background`, `npm run test:motion`, `npm run build:vite`. **PR을 만들기 전에 git에 올리지 않은 파일이 없는지 본다**(11.5의 두 명령 — 새 파일 여섯이 `??`로 남아 있으면 작업 폴더에서는 모든 게이트가 초록인데 커밋에는 없다). 수동 검증(12절 전체)은 그 뒤에 오케스트레이터가 한다.

**오케스트레이터만 하는 일(구현자는 하지 않는다)**

- 앱 엔진 확인(12절)과 그 결과에 따른 15.2의 대체안 선택. 게이트 A·B도 여기에 든다.
- 색을 본 화면(바이올렛 드림·똥파리 골드·에메랄드 × 두 화면, 그리고 보라가 나오는 직접 고른 테마 하나 — C5b)을 머지 확인 때 한솔에게 보인다. 깨끗함과 바뀜을 나란히 둔 화면(S3의 것 — 15.2의 줄을 썼으면 쓴 뒤의 것)도 함께 보인다.
- PR 머지(한솔 확인 뒤), 빌드와 G드라이브 배포(한솔 확인 뒤). 운영 DB에 할 일은 없다.

---

## 15. 열린 질문과 확인 필요

### 15.1 한솔에게 물을 것

**구현 전에는 없다.** 시안에 보인 것은 보인 대로 만들고, 두 답은 답대로 만든다. 한 가지로 정해지지 않은 열두 곳(1.1의 I1~I12)은 이 설계의 답으로 정했고 완료 보고의 첫 줄들로 알린다(15.3). 시안에 보인 것 가운데 그대로 만들 수 없는 것은 없다(좁은 창에서도 'Ctrl+S' 표시가 버튼 줄에 있다 — 예전 안은 "자리가 없다"며 감췄지만 버튼 줄에 자리가 있다, 6.8).

**앱 엔진에서 본 뒤에 물을 수 있는 것이 둘 있다**(15.2에 굵게 적었다). 둘 다 시안에 보인 것이 걸려 있어서, 대체안으로도 안 되면 그것을 뺀 채 내지 않고 게이트 A에서 멈춘다: (가) 띠가 화면을 따라오지 않을 때 — "화면을 내려도 따라온다"는 한솔에게 보인 것이고, 좁은 창과 3D에서 저장 버튼이 스크롤로 사라지는 것을 푸는 장치다. (나) 테두리가 도면 안의 같은 색상 표시와 섞여 보일 때 — 띠가 청록인 테마의 기호와 청록 카메라(C9), 띠가 호박인 테마의 카메라와 3D의 카메라 시점 표시(C10). 한 가지 물음이다: 두 경우 모두 "보인 테두리가 테두리로 읽히지 않는다"이고, 먼저 해 보는 것(테두리를 굵게)도 같은 한 줄이다.

**이 문서의 마지막 검토가 "한솔에게 먼저 물으라"고 한 것들은 묻지 않고 완료 보고에 적는다**(15.3): I3의 두 곳('연결하고 열기'로 옮겨 간 도면이 보기로 열린다, 드문 복구 길), 띠가 지금 보는 도면의 것이라 다른 도면으로 가면 사라지는 것(5.3 — 지금 동작 그대로다), I3·I4·I9·I11처럼 한솔이 보게 되는 것이 시안과 두 답보다 넓어지는 곳. 어느 것도 틀린 곳은 찾지 못했고, 다른 답이 오면 고칠 곳은 1.1의 표에 있다. 완료 보고는 그 넷을 맨 앞에 전후 문장으로 적는다.

### 15.2 앱 엔진에서 확인할 것

각각 대체안을 정해 둔다. 설계 중에는 코드를 읽고 순수 함수의 값만 계산했다(16절). 앱에서 돌려 본 것은 없고 CSS는 하나도 그려 보지 않았다. **시안에 보인 것이 걸린 줄은 "받아들이고 보고에 적는다"로 끝내지 않는다 — 멈추고 묻는다.**

| 확인할 것 | 기대와 근거 | 앱에서 다르면 |
|---|---|---|
| `overflow:clip` 둘로 띠가 탭의 맨 위에 붙는지 (E1) | `clip`은 스크롤 컨테이너가 아니라 sticky가 그 위의 `.bg-tab-content`를 찾는다(Chromium 90 이상) | 붙지 않으면 개발 도구에서 띠와 `.bg-tab-content` 사이에 `overflow`가 `visible`·`clip`이 아닌 조상이 남았는지 본다. 남은 것이 없는데도 붙지 않으면 **붙지 않는 띠(`position:static`)로 내지 않는다.** 다음으로 볼 길은 띠를 스크롤 상자 **밖**(스크롤하지 않는 자리 — `.bg-tab-content` 위)에 그리는 것인데, 그것은 `BackgroundLibraryView.tsx`와 라이브러리의 배치를 건드리고(10.3이 건드리지 않겠다고 한 파일이다) 띠의 폭·색 변수의 범위·도면 크기 보정(6.5)이 함께 달라지는 설계 변경이다. **게이트 A에서 멈추고, 본 화면과 그 길을 한솔에게 보이고 정한다.** `hidden`으로 되돌린 채 다른 요소를 붙이려 하지 않는다 |
| `clip`으로 바꾼 뒤 가로 넘침이 생기지 않는지 (E1) | 잘라 내는 자리가 `hidden`과 같다 | 생기면 넘치는 요소를 찾아 그 요소에서 막는다(`min-width:0`). 두 줄을 `hidden`으로 되돌리지 않는다 |
| 테두리가 3D 화면과 보조 평면도 위에 보이는지, 도구줄·이름 칸을 가리지 않는지 (E2) | 위치를 가진 뒤쪽 형제이고 `z-index:1` — 도구줄(2)·이름 칸(3) 아래, 나머지 위 | 3D 위에서 가려지면 `z-index`를 4로 올린다(가장자리 2px이라 도구줄·이름 칸과 겹치지 않는다). 그래도 안 되면 테두리를 `.bmap-workspace`(도면 + 속성 칸)로 옮긴다: `.bmap-main.is-editing .bmap-workspace { position:relative; }`와 같은 `::after`. 앵커 54의 테두리 줄을 그에 맞춘다 |
| 편집을 시작해도 도면 크기가 같은지 (E3) | 띠의 40px을 이미지 목록의 `flex-basis`가 낸다(6.5). 탭이 이미 최소 높이보다 낮아 스크롤하던 화면(1440×900의 3D)에서는 목록도 그대로이고 최소 높이가 40px 늘어 탭이 그만큼 더 스크롤한다 | 도면이 줄어들면 줄어든 만큼(실측)을 적고, 이미지 목록의 식을 고친다. 고칠 수 없으면 받아들이고 완료 보고에 적는다(편집을 시작하는 순간 한 번 그림이 다시 맞춰진다) |
| 띠의 높이가 글자에 따라 변하지 않는지, 한 줄에 다 들어가는지 (E4, L2) | `height` 고정, 글자는 `nowrap`. 한 줄 약 460px(계산), 901px 창에서 사이드바를 펼친 본문이 532px이라 여유 약 70px(6.3). 사용자의 글꼴·자간에 따라 달라진다 | 901px 근처에서 한 줄에 넘치면(말줄임표가 생기면) **띠가 두 줄로 바뀌는 폭만** 올린다: 900px 이하 블록에 넣은 띠의 세 줄과 `--bmap-edit-h:72px`를 `@media(max-width:960px)` 같은 **따로 둔 블록**으로 옮긴다(그 블록도 기본 덩어리보다 뒤에 둔다). **옮기지 않는 것**: `.bmap-layout { height:auto; min-height:0; }`(backgrounds-map.css:281)의 900px, 6.5의 `min-width:901px` 블록, `BackgroundMapPanels.tsx:34`의 900px — 셋은 "세로로 쌓이는 배치인가"의 경계이고 서로 맞물려 있다. 6.5의 식은 변수(`--bmap-edit-h`)를 읽으므로 901~960px에서 저절로 72px을 뺀다. 앵커 54의 좁은 창 검사를 새 블록에 맞춘다. 740에서 두 줄의 버튼이 넘치면 버튼의 좌우 여백을 줄인다 |
| 어두운·밝은 전환에 띠 색이 곧바로 따라오는지 (E5) | `applyTheme`이 `<html>`의 스타일과 속성을 바꾸고 관찰자가 듣는다 | 한 박자 늦게(이전 화면의 값으로) 계산되면 `apply`를 `requestAnimationFrame` 한 번 뒤로 미룬다 |
| 한글 입력 상태에서 Ctrl+S의 `event.code`가 `KeyS`인지 (E6) | `code`는 자판의 자리다 | 다르면 조건을 `event.code === 'KeyS' \|\| event.key.toLowerCase() === 's'`로 넓히고 앵커 53의 첫 줄을 맞춘다 |
| **한글을 조합 중일 때의 Ctrl+S가 그 글자까지 저장하는지** (E6 — 실제 입력기로) | `requestSave`의 `focusCanvas()`가 조합을 끝내고, 칸의 blur가 그 글자까지 확정하고, 같은 호출 안의 `saveMap`이 그 값을 읽는다(8.3). 조합 중에 마우스로 '도면 저장'을 누르는 지금의 길과 같다 | **마지막 글자가 빠지거나 겹치면**(확정이 한 박자 늦게 온다는 뜻이다) 먼저 확정하고 다음 작업에서 저장한다: `requestSave`의 `void saveMap();`을 `window.setTimeout(saveLatest, 0);`으로 바꾸고 `const saveLatest = useEvent(() => { void saveMap(); });`를 둔다(그때의 렌더가 아니라 가장 새 렌더의 `saveMap`이 돈다. `saveMap`은 초안을 저장소에서 읽는다). 앵커 53의 `requestSave` 줄을 맞춘다. **어느 경우에도 "조합 중에는 아무 일도 하지 않는다"로 돌아가지 않는다** — 그것은 한글 이름을 치고 바로 누른 Ctrl+S가 말없이 죽는 길이다. `preventDefault`가 조합을 깨뜨리면 그 한 줄만 조합 중에 건너뛴다(저장은 그대로 한다 — 그때는 앵커 53의 "`isComposing`이 없다"를 "조합 중에 `return`하지 않는다"로 고친다) |
| 클릭 뒤 캔버스로 보낸 포커스에 고리가 거슬리게 보이는지 (E7) | 마우스 클릭 뒤의 스크립트 포커스에는 `:focus-visible`이 붙지 않는다 | 보이면 받아들인다(도면을 눌렀을 때와 같은 고리다) |
| 들어올 때의 움직임이 한 번만 도는지, 저장·모드 전환에 다시 돌지 않는지 (S2, V1) | 요소가 그대로 있어 애니메이션이 다시 시작하지 않는다 | 다시 돌면 `no-preference` 블록의 두 규칙을 뺀다(띠는 움직임 없이 나타난다). `@keyframes` 둘도 함께 뺀다 |
| `sr-only`가 이 화면에서 보이지 않게 되는지 (S2) | 앱이 이미 쓰는 Tailwind 클래스다 | 글자가 보이면 `.bmap-edit-strip>[role="status"] { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }` 한 줄을 더하고 클래스를 뺀다(앵커 57을 맞춘다) |
| 띠의 색이 여섯 테마 × 두 화면과 직접 고른 테마에서 읽히고 오류로 보이지 않는지 (C1~C8) | 7.3·7.4의 수치 | 값만 고친다(`MAP_EDIT_TONES`와 CSS 기본값 한 줄 — C-0·C-1·C-3c·C-9의 기대 글자를 함께). 7.5의 기준은 그대로 지킨다. **후보의 색상을 옮길 때는 이웃 후보와의 간격 90°를 지킨다**(C-8 — 두 계열 테마의 최소 거리가 그 간격의 절반이다) |
| **청록 테두리가 같은 색상의 기호·청록 카메라와 섞여 보이지 않는지** (C9) | 테두리는 채도 높은 청록의 이어진 2px 선이고, 기호는 채도 낮은 회청록의 가는 그림이다. **두 화면의 수치가 다르다**(2.7): 어두운 화면은 채널 차 0.21 대 0.53이고 밝기가 거의 같다(1.15:1 — 가르는 것은 채도뿐). 밝은 화면의 3D는 채널 차 0.29 대 0.46으로 **채도가 더 가깝고** 밝기는 1.81:1이다(평면의 기호는 3.06:1). 청록 카메라는 색상이 12~13° 차이이고 어두운 화면에서 밝기가 같다(1.01:1, 밝은 화면 1.57:1). 그래서 두 화면을 모두 보고, 어느 한쪽에서라도 섞이면 섞인 것이다 | 섞여 보이면 테두리를 3px로 굵게 한다(값 하나 — 테두리 줄의 `border:2px`. C-10의 글자를 맞춘다 — 굵기를 고정한 것은 C-10뿐이고 앵커 54의 테두리 검사는 굵기를 보지 않는다). **색상은 옮기지 않는다** — 청록을 파랑 쪽으로 20° 옮기면 예비색 보라와의 간격이 72°로 줄어 두 계열 테마의 최소 거리가 36°가 된다(7.5의 기준이 깨진다). 3px로도 섞여 보이면 **게이트 A에서 멈추고 본 화면을 한솔에게 보인다**(고를 것: 청록과 보라를 함께 옮긴다 / 띠가 청록인 테마에서만 테두리를 다른 모양으로 한다) |
| **호박 테두리가 같은 색상의 카메라, 3D의 카메라 시점 표시(호박 테두리와 글자)와 섞여 보이지 않는지** (C10) | 표시는 3D 화면 **안쪽** 아래의 작은 상자이고 테두리는 작업 영역의 가장자리다. 띠가 호박인 테마는 **기본 테마를 포함한 셋**(바이올렛 드림·윤성원 블루·에메랄드)이고, 카메라의 기본색(33°)과 표시의 `#e6b578`은 호박 후보(38°)와 색상이 같으며 어두운 화면에서 테두리와 밝기도 같다(1.01:1, 계산) | **C9와 같은 길이다.** 섞여 보이면 테두리를 3px로 굵게 한다(같은 한 줄이라 청록 테마에도 함께 걸린다 — C-10의 글자를 맞춘다). 고치는 것은 테두리 쪽이다(3D의 CSS는 건드리지 않는다, 10.3). **색상은 옮기지 않는다** — 호박을 옮기면 여섯 프리셋의 답과 이웃 간격(호박–청록 150.2°, 보라–호박 117.8°)이 함께 움직인다. 3px로도 섞여 보이면 **게이트 A에서 멈추고 본 화면을 한솔에게 보인다**(15.1의 (나) — 고를 것은 C9와 같은 둘이다: 그 후보의 색을 옮긴다 / 그 톤의 테마에서만 테두리를 다른 모양으로 한다) |
| 편집 중의 머리줄에서 감춘 '편집 시작'의 자리가 그대로인지, 더블클릭이 설정 창을 열지 않는지 (E9) | `visibility:hidden`은 자리를 지킨다 | 자리가 달라지면(감춘 버튼의 폭이 변하면) 그 버튼에 `min-width`를 준다. 더블클릭이 여전히 다른 것을 누르면 무엇을 눌렀는지 적고 고친다 |
| 띠가 붙은 채 Tab으로 닿은 칸이 띠 밑에 가리지 않는지, 띠의 두 버튼에 포커스가 갈 때와 도면을 누를 때 화면이 움직이지 않는지 (E10) | `scroll-margin-top`은 포커스가 끌어오는 스크롤에 적용된다(Chromium 130). 도면에는 주지 않았고, 띠 자신의 두 버튼에서는 뺐다(6.4) | 칸이 여전히 가리면 받아들이고 완료 보고에 적는다(사용자가 스크롤하면 보인다). **띠의 버튼에 포커스가 갈 때(E10의 나) 화면이 움직이면** 빼는 줄이 듣지 않은 것이다 — 그 줄을 지우고 첫 줄의 선택자 끝에 `:not(.bmap-edit-strip *)`를 붙이는 꼴로 바꾼 뒤 앵커 54의 두 줄을 맞춘다. **도면을 누를 때(E10의 다) 화면이 움직이면 먼저 가린다**: 개발 도구에서 `scroll-margin-top` 두 줄을 끄고 같은 자리에서 같은 누름을 되풀이한다. **끄면 멈출 때만** 그 규칙을 뺀다(끌기가 어긋나는 쪽이 더 나쁘다). 꺼도 움직이면 이 설계의 탓이 아니라 지금도 있는 동작이다(:698의 `focus()`에 `preventScroll`이 없다 — 그 규칙은 도면에 걸리지 않는다): 규칙은 그대로 두고, 본 자리와 움직인 양을 검증 기록과 완료 보고에 적는다(15.4) |
| 거절·실패한 저장의 문장이 화면 안으로 오는지, 이미 보일 때 화면이 튀지 않는지 (V7b) | `scrollIntoView({ block: 'nearest' })`는 스크롤 상자만 움직인다 | 스크롤 상자 밖(`<main>`)까지 움직이면 `errorRef.current`의 맨 위를 재서 `.bg-tab-content`의 `scrollTop`만 고치는 식으로 바꾼다(`rootRef.current.closest('.bg-tab-content')`) |
| 바뀜의 알약과 ✓가 글꼴에서 제대로 그려지는지 (S3, V1) | ✓(U+2713)는 이 편집기가 이미 쓰는 기호들(↖ ✥ ● ↶)과 같은 대체 글꼴에서 나온다 | ✓가 네모로 나오면 `content:"✓"`를 `content:""` + 테두리 둘로 그린 체크(8px, `border-right`·`border-bottom` 2px, 45° 회전)로 바꾼다. 알약이 띠의 높이를 넘으면 위아래 여백을 1px로 줄인다 |
| 저장 버튼의 흐린 상태가 "꺼짐"으로 읽히는지, 그 글자가 읽히는지 (S2, C7) | 글자색 55%, 테두리 30%. 그 글자는 띠와 3.14~3.30:1이다(여섯 톤, 계산 — 일부러 7.5의 기준 밖에 둔 꺼진 표시다) | 투명도만 고친다. **글자를 읽기 어려우면 글자색을 .78로 올린다**(4.72~6.00:1. .70이면 4.12~4.87:1로 짙은 톤 셋이 4.5에 못 미친다). 테두리 30%·투명한 바탕·기본 커서는 그대로 두어 채워진 켜짐과 갈리게 하고, 올린 뒤 S2("꺼짐으로 읽히는가")를 다시 본다 |
| **깨끗함과 바뀜이 한눈에 갈리는지** (S2·S3 — 게이트 A에서, S3의 기준으로) | 바뀜에서 왼쪽 끝의 알약과 오른쪽 끝의 저장 버튼이 같은 칠로 함께 켜진다(3.3). 띠와 테두리는 두 상태에서 같고, 그 둘은 움직임 없이 나타난다 — 한솔의 문제("옮기고서 저장 안 하는 경우")가 이 표시에 걸려 있다 | 25%로 줄인 화면에서 갈리지 않는 쌍이 있으면 **멈춰 있는 표시를 하나 더한다**: 바뀜일 때 띠의 아래 가장자리 전체에 글자색 줄 — `.bmap-edit-strip[data-phase="changed"] { box-shadow:inset 0 -3px 0 rgb(var(--bmap-edit-ink)); }` 한 줄(알약 줄 앞에 둔다). 안쪽 그림자라 띠의 높이와 배치를 바꾸지 않고, 색은 같은 변수에서 오고(C-10), 움직임이 아니라서 동작 줄이기에서도 그대로다. 띠 폭 전체에 걸치므로 눈이 도면에 있어도 도면 바로 위에서 보인다. 그래도 갈리지 않으면 두께만 올린다(6px까지 — 버튼 아래의 여백 안이다). 앵커 54의 '상태의 모양'에 그 줄을 더한다. **움직임(깜빡임·흔들림)으로 눈을 끌지 않는다** — 정보를 움직임에 싣지 않는다(R11, 6.8). 쓴 경우 완료 보고에 적고, 두 상태를 나란히 둔 화면을 머지 확인 때 한솔에게 보인다(14절) |
| 1,231~1,310px의 도구줄이 그때와 같은지 (L1) | 머리줄과 도구줄은 다른 상자다 | 달라졌으면 원인을 찾는다(띠는 도구줄의 폭에 닿지 않아야 한다) |

### 15.3 한솔에게 알릴 것 · 완료 보고에 적을 것

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

### 15.4 알고 넘어가는 것

- **저장 안 한 변경이 있는 초안의 도면이 다른 곳에서 바뀐 경우**는 지금과 같다: 화면은 내 초안을 보이고 저장은 거절되며, 푸는 길은 '편집 끝내기'로 버리고 다시 하는 것이다. 답 1로 편집 중인 시간이 길어지므로 이 일이 생길 자리도 늘어난다 — 따라가기(4.4)가 그 가운데 "저장 안 한 변경이 없는" 쪽을 없앤다. 나머지는 2차다.
- 따라가기는 다시 실행 기록을 비운다(모두 되돌린 뒤 다른 PC의 저장이 온 경우). 되돌린 편집을 다시 실행할 수 없게 된다.
- 따라가기는 읽기가 올 때 일어난다(15초마다·창에 포커스가 올 때·변경 신호). 저장이 돌거나 편집기의 창이 열려 있어 건너뛴 것은 저장이 끝나거나 창이 닫힐 때 한다. 그 사이에 깨끗한 초안 위에서 편집을 시작해 저장하면 충돌이다(지금의 보기 → 편집 사이와 같은 틈이다).
- **라이브러리에서 없어진 도면의 초안**: 깨끗하면 함께 없어진다(4.4 — 새 동작이다. 지금은 깨끗한 초안이 저장을 넘겨 남지 않아 이 경우가 없었다). 보고 있던 도면이었으면 화면이 말없이 목록의 첫 도면으로 간다(보기 모드의 지금과 같다 — "지워졌어요"라는 알림은 없다). 그때 **그리다 만 다각형의 점·손에 든 도구·기호 목록·오류 글자는 다른 도면으로 갈 때처럼 비워진다**(4.4 — 찍던 점은 말없이 사라진다. 끌던 것만 취소되는 것이 아니다). **편집기의 창(확인·만들기·연결·설정)이 열려 있는 동안에는 따라가지도 없어지지도 않고**, 창이 닫힌 뒤에 한다 — 그 사이 화면은 옛 모습이고, 창 안의 저장은 지금처럼 거절될 수 있다. **저장 안 한 편집이 있으면 남아서** 목록에 보이고 저장은 거절된다(지금과 같다. 2차).
- **보기 모드에서(초안 없이) 보던 도면이 없어지는 경우는 지금 그대로다.** 화면이 `navigate` 없이 목록의 첫 도면으로 가고(:249), 그때 열려 있던 창은 그 도면에 대고 답한다 — 응답을 잃은 '도면 삭제' 뒤 오류와 함께 열린 채 남은 확인 창에서 '삭제'를 다시 누르면 목록의 첫 도면에 삭제가 나간다(그 도면에 하위 도면과 연결이 없으면 통과한다. 저장소 쪽은 임시 폴더에서 확인했다, 16절). 지금(v1.134.0)도 있는 일이고 초안이 없는 화면의 일이라 이번에 고치지 않는다(따로 다룰 일로 완료 보고에 적는다, 15.3). 이번에 지킨 것은 **편집 중이 그 경우에 새로 들지 않게** 한 것이다(4.4의 가드 — 지금 편집 중에는 초안이 그 도면을 붙들어 다시 누른 삭제가 거절된다).
- 따라가기가 보던 도면을 바꿔 놓으면 다각형의 고른 점이 풀린다. 한 번 다시 눌러야 한다.
- `createMap`의 다시 시도 가지는 부모의 편집을 끝낸다(4.3). 저장을 하고도 편집이 끝나는 하나뿐인 길이고, 응답을 잃은 저장 뒤의 복구에서만 닿는다.
- 설정 창이 열린 동안의 Ctrl+Z는 창의 접는 줄(`summary`)에 포커스가 있으면 지금도 초안에 닿는다(앵커 38의 주석이 말하는 구멍이다). 그 뒤의 '설정 저장'은 창을 열 때의 값으로 저장하고 초안을 그 값으로 다시 놓는다 — 지금(버리고 스냅샷을 읽음)과 결과가 같다. 고치지 않는다.
- **저장이 끝나는 순간의 사이 렌더 — 보일 수 있는 것은 "저장된 그대로예요" 한 프레임이다.** 저장이 끝날 때의 렌더는 셋으로 나뉜다고 본다(React 18의 갱신 우선순위에서 따진 것이고 앱에서 재지 않았다): ① 저장소의 `pending`이 꺼진 렌더(띠가 "저장 안 한 변경 N개"로 계산된다), ② 다시 놓기의 렌더("저장된 그대로예요"), ③ `setSavedNotice`와 `setBusy(false)`의 렌더("✓ 도면을 저장했어요"). ①과 ②는 둘 다 바깥 저장소의 갱신이라(`useSyncExternalStore` — useBackgroundMapDocument.ts:36) 같은 마이크로태스크 묶음 안에서 잇달아 끝나고 그 사이에 화면이 그려지지 않는다 — **①은 보이지 않는다.** ③은 `await` 뒤에 부른 `setState`라 다음 작업에서 돈다(`createRoot`, `src/main.tsx:101`) — **②는 한 프레임 보일 수 있다**: "저장 중…" → (한 프레임) "저장된 그대로예요" → "✓ 도면을 저장했어요". 둘 다 깨끗한 상태의 글자라 알약이 다시 나타나지 않고, 그 프레임에도 `busy`가 켜져 있어 가드는 모두 그대로다. 받아들인다(V1에 적어 두었다 — 실패로 읽지 않는다). 한 렌더로 묶으려면 `persistMaps`의 두 줄을 react-dom의 `flushSync`로 싸면 되지만, 그 한 프레임을 위해 넣지 않는다.
- 같은 나뉨이 따라가기에도 있다: 초안이 바뀌는 렌더가 먼저 오고, 비우는 줄들(`setPolygon`·`setTool`·`setActiveVertex`)은 한 작업 뒤의 렌더다. 보던 도면이 다른 곳에서 지워졌을 때 찍던 다각형 점이 옮겨 간 도면 위에 한 프레임 그려질 수 있다(재지 않았다). 다음 렌더에서 비워진다.
- 저장 중을 `pending`으로 보므로 다른 패널의 저장(배경 상세 창)이 도는 동안에도 띠는 "저장 중…"이다. 그때는 그 창이 위에 떠 있다.
- 밑그림을 올리는 동안(`busy`만 켜짐)에는 띠의 글자가 그대로이고 버튼만 눌리지 않는다.
- 띠의 색과 테마의 색은 밝기가 비슷할 수 있다(7.3). 둘을 가르는 것은 색상이다. 색을 구분하기 어려운 사람에게도 띠는 글자('편집 중')와 꽉 찬 띠라는 모양으로 읽히고, 저장했는지 안 했는지는 글자와 알약 모양으로 읽힌다(색에 기대지 않는다).
- **후보의 색상이 이 기능의 고정색과 겹친다.** 호박 후보(38°)는 카메라의 기본색(33°)과, 청록 후보(188°)는 문·의자·계단 기호의 회청록(188°)과 색상이 같다(2.7). 띠는 도면 밖의 줄이고 글자가 있어 섞이지 않는다. 볼 곳은 도면을 두르는 2px 테두리다: 띠가 청록인 세 테마(공산당 레드·똥파리 골드·이혜민 머쉬룸)에서 테두리와 기호가 같은 색상이고(C9 — 채도는 테두리가 높다. 어두운 화면에서는 밝기가 거의 같고, 밝은 화면의 3D에서는 채도가 더 가깝다 — 2.7), **v1.133.0의 청록 카메라 색**은 그 테두리와 색상이 12~13° 차이에 어두운 화면에서 밝기가 같다. 띠가 호박인 세 테마(기본 테마 포함)에서는 카메라의 기본색, 3D의 '카메라 시점' 표시(호박 테두리와 글자)와 테두리가 같은 색상이다(C10). 앱에서 섞여 보일 때의 길은 두 경우가 같고 15.2에 정해 두었다(테두리를 굵게 → 그래도 섞이면 게이트 A에서 멈춘다).
- 테마의 색이 한 계열이면 띠와의 색상 차는 가장 나쁠 때 75°다(두 후보의 한가운데 113°·293° 근처). **두 색이 다른 계열이면 가까운 쪽까지 가장 나쁠 때 46°다**(한 색이 호박 자리에, 다른 색이 청록과 보라의 한가운데 234°에 있을 때 — 군청과 청록·보라가 갈리는 정도다). 그보다 가까워지는 쌍은 없다(7.4).
- 예비색 보라는 직접 고른 테마에서만 나온다. 색상 쌍의 약 19%, 프리셋에서 메인 액센트만 다른 프리셋의 색으로 바꾼 서른 가지 가운데 열두 가지다 — 드문 색이 아니므로 호박·청록과 같은 정도로 본다(C5b).
- **흐린 '도면 저장'의 글자는 띠와 3.14~3.30:1이다**(7.5). 띠의 글자 가운데 4.5:1에 못 미치는 하나뿐인 것이고, 꺼진 표시로 보이게 일부러 그렇게 두었다. `aria-disabled`라 Tab으로 닿고 저장한 뒤 늘 보이는 상태이므로 C7에서 글자가 읽히는지를 따로 본다. 읽기 어려우면 .78로 올린다(15.2).
- **창이 낮을 때 편집 중에 오류 띠가 뜨면 이미지 목록의 아래가 약 19~23px 잘린다**(게이트 A의 실측은 한 줄짜리 오류 띠에서 23.2px. 넓은 창에서 탭 높이가 약 520~560px일 때, 3D는 약 780~820px일 때 — 6.5). 최소 높이의 셈에 오류 띠가 없어서이고, 지금도 그보다 40px 낮은 창에서 같은 양이 잘린다. 오류 띠가 사라지면 돌아온다. 그 20px을 위해 최소 높이를 더 올리지 않았다.
- **도면의 위쪽이 화면 위로 올라가 있을 때 도면을 누르면 화면이 움직일 수 있다 — 지금도 있는 일이고 고치지 않았다.** 평면의 SVG는 누를 때 포커스를 받는데 그 `focus()`에 `preventScroll`이 없다(:698 — `focusCanvas` :425와 3D의 :1067에는 있다). 일부만 보이는 도면을 누르면 브라우저가 그것을 끌어오고, 끌기의 좌표는 그 전에 잡은 행렬이라 끌던 것이 움직인 만큼 어긋난다(엔진에서 재지 않았다). 좁은 창은 지금도 늘 스크롤하므로 새로 생기는 일이 아니다. 다만 띠가 화면을 따라오면서 스크롤한 채 편집하는 시간이 길어진다. `pointerDown`은 이번에 건드리지 않는다(10.2) — E10이 그 경우와 이 설계의 규칙을 가려서 보고(15.2), 본 것이 있으면 완료 보고에 "따로 고칠 일"로 적는다(한 낱말의 수정이다: `focus({ preventScroll: true })`).
- **Ctrl+S의 포커스 가드가 치르는 값과 남는 틈**(8.2). 앱 틀의 버튼(위쪽 줄·왼쪽 메뉴)에 포커스가 남아 있는 동안에는 Ctrl+S가 듣지 않는다 — 배경 화면 안을 누르면 듣는다. 비밀번호 변경·사용자 관리 창이 떠 있는데 포커스가 아무 데도 없을 때의 Ctrl+S는 밑의 도면을 저장한다(그 두 창에는 창이라는 표시가 없고, 이번에 고치는 파일이 아니다). 저장되는 것은 사용자의 편집이라 잃는 것은 없다.
- 도면 높이를 손잡이로 최대치까지 늘려 둔 경우에는 편집을 시작할 때 도면이 최대 40px 줄어든다(6.5).
- 편집을 시작하고 끝낼 때 도면이 띠의 높이만큼 오르내린다.
- Ctrl+S는 편집 중에만 받는다. 보기 모드의 브라우저 미리보기(Chrome)에서는 페이지 저장 창이 뜬다 — 앱에는 그 기본 동작이 없다.
- 사용자가 Ctrl+S에 묶어 둔 앱 단축키는 편집 중에 나가지 않는다(편집기가 그 키를 받는 때 — 포커스가 배경 화면 안이거나 아무 데도 없을 때).
- 띠의 수는 "끝난 편집의 수"이지 "달라진 것의 수"가 아니다. 옮겼다가 손으로 제자리에 돌려놓으면 2개다.
- 권한을 잃은 초안, 화면을 떠날 때 사라지는 초안은 지금과 같다(2차).
- 터치 입력은 대상이 아니다.

---

## 16. 설계 때 돌려 본 것

저장소 밖 임시 폴더에서 순수 모듈의 사본과 실제 저장소(`createBackgroundStore`, 가짜 게이트웨이)로 돌렸다. 폴더는 지웠고 작업 폴더는 깨끗하다. **앱과 화면은 띄우지 않았다.**

| | 물음 | 결과 |
|---|---|---|
| 기준 | 지금의 `npm run test:background` | 542개, 통과 537, 실패 0, 건너뜀 5 |
| 가 | 3.2·4.1·4.4의 리듀서 변경을 사본에 넣고 기존 문서·기록·작업 흐름 테스트(52개)를 그대로 돌림 | 52개 통과. 손으로 만든 초안(`dropped` 없음, :52)도 그대로 '바뀜' |
| 나 | 60번 고치고 50번 되돌림 | `past 0`, `future 50`, 이름 `'10'`, `mapDraftChanged` 참, 수 10. 한 번 더 고치면 11. 한계 안에서 모두 되돌리면 바뀜 아님 |
| 다 | `rebase-drafts` | 초안이 있는 도면만 바뀐다. `viewports`는 같은 객체. 바뀐 초안 위의 제스처·칸 편집만 끝난다 |
| 라 | `follow-saved` | 4.4의 표 그대로(같은 버전·옛 버전·바뀐 초안·끌기 도중은 같은 상태) |
| 마 | 저장 → 명령에서 다시 놓기 → 다시 저장 | 저장이 풀린 뒤에도 잡아 둔 스냅샷의 버전은 3(저장소는 4). 다시 놓인 초안은 저장소의 도면과 깊은 비교로 같고 `baseRevision` 4. 두 번째 저장 통과(버전 5). **잡아 둔 스냅샷의 도면으로 연 초안의 저장은 "다른 사용자가 내용을 변경했습니다…"로 거절** |
| 바 | 저장이 도는 동안의 스냅샷 | `pending` 동안 저장소의 버전이 4(낙관 값), 이름도 새 값. 그때 따라간 초안은 저장이 실패해 저장소가 3으로 돌아간 뒤에도 `baseRevision` 4·새 이름·"바뀜 아님" |
| 사 | 상태 표 — 11.1의 열 줄 | 지금의 문구(검토 반영에서 깨끗함의 문장과 저장 중의 문장을 바꿨다)로 다시 돌려 열 줄 모두 `deepEqual` 일치(아래의 '저') |
| 아 | 색: 여섯 프리셋 × 두 화면, 64,800가지 훑기, 7.4의 강조색들 | 7.3·7.4·7.5의 수치 |
| 자 | 6.8의 CSS 조각(변수 줄, 띠, 테두리, `@keyframes` 둘, `no-preference` 블록)을 `scripts/postcss-motion-minimal.cjs`에 넣음 | 경고 0. 블록의 두 규칙이 '최소'에서 빠지게 바뀐다 |

**검토를 반영하며 다시 돌려 본 것**(같은 방식 — 저장소 밖 임시 폴더, 폴더는 지웠다. 앱과 화면은 이번에도 띄우지 않았다)

| | 물음 | 결과 |
|---|---|---|
| 차 | 7.1의 `mapEditColor.ts`(세 인자, 후보 셋)를 **글자 그대로** 파일로 두고 Node로 돌림. 강조색만 보던 예전 함수도 나란히 | 예전 함수의 수치(7.3의 열두 줄, 훑기 74.97° / 6.65 / 4.94 / 6.49)가 그대로 다시 나온다. 새 함수는 여섯 프리셋에서 같은 `strip`·`ink`, 한 계열 훑기 64,800가지에서 같은 수치이고 보라 0번 |
| 카 | 두 계열: 색상 360 × 360쌍 × 두 바탕 × 채도·밝기 넷 | 가까운 쪽까지의 최소 46.0°, 보라 약 19%. 예비색을 뺀 둘뿐이면 최소 0.3°, 30° 안 5.6%, 45° 안 12.5%. 예비색을 대등하게 두면 최소는 같지만 에메랄드 프리셋이 0.4° 차이로 갈린다 |
| 타 | 프리셋에서 메인만 바꾼 서른 가지, 7.4 (나)의 쌍들, 읽을 수 없는 입력, 문턱 바로 위·아래의 회색 | 7.4의 표. 최소 56.3°, 보라 열두 가지. `140 130 119` → 청록, `140 132 120` → 호박 |
| 파 | 세 후보의 여섯 톤 × 모든 바탕 종류, 톤이 뒤집히는 회색 | 글자 : 띠 6.65, 띠 : 바탕 4.88, 띠 : 카드 6.49. 뒤집히는 회색은 136(호박·청록)·131(보라) |
| 하 | 4.4의 `follow-saved`(없어진 도면의 깨끗한 초안을 치우는 줄 포함)를 리듀서 사본에 넣고 기존 문서 테스트(40개)와 D-6b의 경우들을 돌림 | 40개 통과. 깨끗한 초안만 없어진다 — 바뀐 초안·끌기 도중·저장한 적 없는 도면은 같은 상태. 다른 도면의 칸 편집(`coalescing`)이 이어진다 |
| 거 | D-8: 기존 테스트의 액션 목록 끝에 `rebase-drafts [mapA]`와 `follow-saved`를 더함 | 버전이 그대로인 도면들을 넘긴 `follow-saved`는 **같은 상태**를 돌려줘 그 테스트의 `notEqual`에 걸린다(검토가 짚은 그대로). 11.3에 적은 두 값으로는 둘 다 상태가 달라지고 `viewports`는 같은 객체다 |
| 너 | 고친 6.8의 기본 덩어리 전체(알약·✓·저장 버튼·`scroll-margin-top`·'편집 시작' 감춤 포함)를 같은 플러그인에 넣음 | 경고 0, 규칙 23개가 읽힌다. C-10의 정규식에 걸리는 줄 0. 순서 검사가 찾는 네 줄이 하나씩 |
| 더 | **응답을 잃은 도면 삭제**를 실제 저장소(`createBackgroundStore`)와 "실행은 하고 답만 잃는" 가짜 게이트웨이로: 도면 둘(목록의 첫 도면 A, 보던 도면 X)에서 X를 지운다 | `execute`가 던지고, 저장소의 스냅샷에는 X가 없다(다시 읽은 값). X의 깨끗한 초안을 남기면 `effectiveMaps`에 X가 남고, 치우면 첫 도면이 A다. **남은 초안의 버전으로 X를 다시 지우면 "다른 사용자가 내용을 변경했습니다…"로 거절**되고(쓰기가 나가지 않는다), **A를 A 자신의 버전으로 지우면 통과**해 도면이 하나도 남지 않는다 — 4.4에서 창이 열려 있는 동안 따라가지 않게 한 까닭이다. 편집기 쪽(가드와 비우는 줄)은 돌려 보지 않았다 |

**마지막 검토(작은 지적 23건)를 반영하며 계산한 것**(같은 방식 — 저장소 밖 임시 폴더에서 Node로, 폴더는 지웠다. 앱과 화면은 이번에도 띄우지 않았다)

| | 물음 | 결과 |
|---|---|---|
| 러 | 흐린 저장 버튼의 글자(글자색을 그 투명도로 띠 위에 섞은 색)와 띠의 대비, 여섯 톤 | 투명도 .55에서 3.14~3.30, .70에서 4.12~4.87, .78에서 4.72~6.00. `Ctrl+S` 표시(.8) 4.87~6.31, 켜진 저장 버튼의 hover(.86) 5.37~7.32 |
| 머 | 테두리와 같은 색상의 고정색 | 2.7의 수치 — 기호 `#89b8bf` 대 밝은 청록 1.15:1(채널 차 0.21 대 0.53), 밝은 화면의 3D 기호 `0x4f8f9a` 대 짙은 청록 1.81:1(0.29 대 0.46), 평면의 기호 대 짙은 청록 3.06:1, 목록 아이콘 `#3f7f89` 1.46:1. 청록 카메라 175.2° · 176.2°, 1.01:1 · 1.57:1. 호박 테두리 대 카메라 기본색 1.01:1 |
| 버 | 두 줄 배치의 버튼 줄 위쪽(6.3), 머리줄과 오류 띠의 높이(6.5) | `min-height`가 없을 때 맨 글자 34.3px, 알약 36.3px. 머리줄 72.95px, 오류 띠 66.15px |
| 서 | C-3b의 거꾸로 검사(테스트가 스스로 계산한 답)를 7.1의 함수에, 두 바탕 259,200쌍으로 | 경계에서 0.5° 안의 쌍(1.86%)을 건너뛰면 틀린 쌍 0(건너뛰지 않으면 368쌍 — 넣은 색상의 반올림). 문턱을 52·55·58·59로 적은 함수는 8,204 · 5,172 · 1,656 · 832쌍에서 틀리고, 한쪽 방향 검사와 45° 기준은 넷 다 통과한다. 61·65는 한쪽 방향 검사에도 걸린다 |
| 어 | C-10에 더한 두 정규식을 6.8의 CSS 조각과 덮어쓰기 줄들에 댐 | 걸리는 줄 0(`white-space:nowrap`은 걸리지 않는다 — `\b`로 찾으면 걸린다). `color:white`와 들여쓴 줄의 16진수는 걸린다 |

**일관성 검토(지적 11건)를 반영하며 다시 돌려 본 것**(같은 방식 — 저장소 밖 임시 폴더에서 Node로, 폴더는 지웠다. 3.1과 7.1의 코드는 이 문서에서 글자 그대로 뽑아 파일로 두었고, 리듀서는 사본에 3.2의 변경을 넣었다. 앱과 화면은 이번에도 띄우지 않았다)

| | 물음 | 결과 |
|---|---|---|
| 저 | 11.1의 열 줄을 3.1의 `mapEditStatus`에 — 초안은 리듀서로 만든다(방금 엶, 1번·12번 고침, 60번 고치고 50번 되돌림. 7번 줄만 손으로 만든 `baseRevision: null`) | 열 줄 모두 돌려받은 객체 전체가 `deepEqual`로 같다. `MAP_EDIT_LABEL`·`MAP_SAVED_NOTICE_MS`와 3.2의 표(60번 고치면 `past 50`·`dropped 10`·수 60, 50번 되돌리면 수 10, 한 번 더 고치면 11, 5번 고치고 5번 되돌리면 0, 다시 실행하면 1)도 같다 |
| 처 | 7.3의 열두 줄, 그리고 그 줄들에서 띠와 테마의 **두 색** 사이의 밝기 대비 | `strip`·`ink`·색상 거리·대비가 표와 같다. 띠 대 테마의 두 색은 1.03~4.22:1(가장 큰 값은 밝은 화면의 이혜민 머쉬룸 — 짙은 청록 `0 102 117` 대 보조 강조색 `224 203 175`), 강조색만 보면 1.03~3.61:1. 후보의 색상은 호박 37.8°(짙은 톤 38.0°)·청록 187.9°(187.7°)·보라 280.0° |
| 커 | 12절 C5의 세 경우와 C5b를 7.1의 함수에(두 바탕) | (가) 회색 + `162 155 254` → 호박, (나) 회색 둘 → 호박, (다) `126 211 33`(88.7°) + `162 155 254`(244.2°) → 청록. C5b `59 130 246` + `251 191 36` → 보라 |
| 터 | C-11의 두 꼴을 7.1의 코드에 | `source.includes('import')`는 참이다(머리 주석의 'no imports'). `/^import\b/m`은 걸리지 않는다 |

**이번에 고친 것 가운데 돌려 보지 않은 것**: CSS에 더한 줄들(`.bmap-edit-state`의 `min-height:23px`, 띠의 버튼에서 `scroll-margin-top`을 빼는 줄, 1,100px 이하의 왼쪽 여백 줄)은 그려 보지 않았고 `scripts/postcss-motion-minimal.cjs`에도 다시 넣지 않았다(움직임 선언이 없는 줄들이다 — '너'의 규칙 수 23은 이 줄들을 더하기 전의 값이다). 저장이 끝나는 순간의 렌더 순서(15.4), 띠의 버튼에 걸리는 `scroll-margin-top`(6.4), 일부만 보이는 도면을 누를 때의 스크롤(:698)은 따진 것이고 재지 않았다. `saveMap`의 바뀐 검사 차례, `onSaveKey`의 포커스 줄, 창 제목의 갈림, 안내 글의 권한 갈림은 코드를 읽고 정한 것이다.

**돌려 보지 않은 것**: CSS가 실제로 그리는 모습 전부(띠가 붙는지, 좁은 창의 두 줄, 알약과 ✓, 감춘 '편집 시작'의 자리, `scroll-margin-top`이 포커스 스크롤에 듣는지), 한글 입력기에서의 Ctrl+S, `scrollIntoView`가 움직이는 상자, 따라가기 effect와 고른 점, 창이 열려 있는 동안의 건너뛰기와 보던 도면이 없어졌을 때의 비우기(V14c~V14e) — 모두 12절과 15.2에 확인할 것으로 적었다.
