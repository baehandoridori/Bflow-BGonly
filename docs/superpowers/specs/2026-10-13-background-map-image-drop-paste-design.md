# 배경 도면 — 그림 끌어다 놓기 · 붙여 넣기 · ＋ 이미지 추가 — 설계 (2026-10-13)

> 요청(한솔, 2026-10-13, 말 그대로): "… 그리고 이미지를 드래그 드롭이나 공간이나 카메라 선택 후 복사 붙여넣기, 드래그 드랍으로 이미지 추가가 안돼. 이부분 수정해서 배포까지 진행해줘." — 처음 요청(2026-10-10, G1): "도면 클릭 - 배경 이미지 하단에 활성화되면 이미지 드래그/드롭 혹은 복사 및 붙여넣기로 해당 도면/공간에 이미지 추가하는 방식도 지원하게끔. (시각적 피드백 애니메이션 줄 것)"
> 묶음: 그날의 요청 여섯을 세 번에 나눠 낸다. **이 문서는 3차(v1.138.0)만** 다룬다 — 1차(숫자 끌기·카메라 높이·도면 바로 삭제, v1.136.0)와 2차(눈·박스로 보기, v1.137.0)가 머지된 **뒤에**, 그 main에서 만든다. 이어서 "저장 안 한 편집을 이 PC에 보관"(편집 상태와 저장 지키기 2차)이 온다.
> 한솔에게 알린 것(2026-10-13) — 제품 결정이다. 바꾸지 않는다: ① 도면 화면 어디에든 그림 파일을 끌어다 놓거나 Ctrl+V로 붙여 넣으면 바로 배경으로 들어간다. 공간을 골랐으면 그 공간에, 카메라를 골랐으면 그 카메라의 시점으로, 아무것도 안 골랐으면 도면 전체에 들어가고, 끌고 들어올 때 어디에 들어갈지 화면에 먼저 알려 준다. ② 배경 장소가 아직 없는 공간이면 그 자리에서 '이 공간 이름으로 장소 만들기 / 기존 장소 고르기'를 한 번만 묻는다. 넣는 동안 아래 목록에 흐린 카드와 진행 표시가 보이고, 끝나면 '추가됨' 표시가 잠깐 붙는다. ③ 그림은 놓는 즉시 저장된다. 공간·카메라에 이어 주는 것만은 도면의 변경이라, 편집 중이면 '저장 안 한 변경'에 하나 더해져 '도면 저장' 때 함께 저장되고, 편집 중이 아니면 그 자리에서 바로 저장된다. ④ 서버·DB 변경은 없다. 배경 메뉴가 보이는 계정(지금은 배한솔 계정)에서만 달라진다.
> 버전: v1.138.0(머지 직전에 `origin/main`을 다시 확인) · **운영 DB·저장 모양 변경 없음** · 메인 프로세스에는 읽기 전용 IPC 채널 하나(`background:read-clipboard-file`)가 는다 · 배경 메뉴는 계속 배한솔 계정 한정
> 기준 코드: `633e7afb`(= main v1.137.0 `af63b1cb` — 1차·2차가 머지·배포된 main — + 2차의 배포 기록 문서 커밋 하나. `src`·`tests`·`electron`은 `af63b1cb`와 같다). 처음에는 v1.135.1(`7b10e46d`)에 대고 썼고, 2026-10-15에 이 커밋의 코드에 대고 다시 맞췄다 — 만든 1차·2차가 설계와 다른 곳은 만든 코드를 따랐다. **줄 번호는 이 커밋의 것이다. 2절만 예외다**: 2절은 설계를 쓴 때(v1.135.1)의 동작을 적은 절이라 그 안의 `BackgroundMapEditor.tsx`·`backgrounds-map.css` 줄 번호는 `7b10e46d`의 것이다(1차·2차가 그 사이에 줄을 더했다 — 자리는 함께 적은 글자로 찾는다). 2절에서도 2.1의 새 기호의 물음(2차가 그 글자를 바꿨다)과 2.3의 AGENTS.md 줄은 이 커밋의 번호를 함께 적었다. 두 차례가 바꿔 놓은 것 가운데 이 문서에 닿는 것은 2.8에 모았다.
> 자리: `docs/superpowers/specs/2026-10-13-background-map-image-drop-paste-design.md`(저장소 안 — 2026-10-15에 옮겨 3차의 첫 커밋 `20ddff30`으로 넣었다, 12절의 0단계).
> 바탕: 분석 `r3-analysis.json`(항목 f와 종합), 추가 요청 계획 `docs/superpowers/plans/2026-10-10-feedback-additions.md`의 G1 절(:131-141)과 4절의 열린 결정(:94-100 — 한솔이 묻지 않고 만들라고 했으므로 **추천안**으로 간다), 6절의 G1 보완(:231-239, :261-268). 1차 설계(`docs/superpowers/specs/2026-10-13-background-map-scrub-height-delete-design.md`)의 5.5·5.6·6절과 2차 설계 초안(`…-eye-solid-design.md`)의 6절을 읽고 맞췄다.

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 범위의 전부이며, 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다.** 알린 네 가지가 한 가지로 정하지 않는 곳은 이 설계의 답으로 정했고(1.2), 알린 말이 코드에서 그대로는 맞지 않는 곳("놓는 즉시"의 뜻, 막힌 대상, 글자 칸의 붙여 넣기, 저장이 도는 동안 누른 뒤의 붙여 넣기, 저장 하나가 실패한 뒤의 남은 그림)은 가장 덜 놀라운 쪽으로 정했다 — 둘 다 완료 보고에 적는다(13.2). 바뀌지 않는 코드는 다시 적지 않는다: 코드를 그대로 적은 곳은 앵커가 글자로 고정할 줄, 잘못 읽으면 동작이 달라지는 줄, 화면의 글자뿐이다.

용어: **넣기** = 끌어다 놓기·붙여 넣기·'＋ 이미지 추가' 한 번으로 들어온 그림 묶음을 배경으로 등록하는 일 전체. **대상** = 그 그림이 들어갈 곳(카메라·공간·도면). **배경** = 화면이 '배경'·'시점'이라고 부르는 엔티티 `view`(그림은 그 안의 변형의 수정본이다). **장소** = `place`. **이어 주기** = 도면 쪽에 남는 변경 — 공간의 `placeId`, 도면의 `placeId`(대표 장소), 카메라의 `viewIds`. **저장 실행** = 올리기가 끝난 뒤 편집기를 잠그고 장소 → 배경들 → 이어 주기를 차례로 내보내는 짧은 구간. **덮개** = 파일을 끌고 들어온 동안 도면 칸 위에 뜨는 안내(`.bmap-drop`). **흐린 카드** = 넣는 중인 그림의 자리 카드(`.bmap-gallery-ghost`). **알림 줄** = 이미지 목록 안의 한 줄(`.bmap-gallery-notice`). **장소 창** = 대상에 장소가 없을 때 먼저 뜨는 창. **초안**·**편집 중**(`editing`)·`canEdit`·**다시 놓기**·**따라가기**·`dialogOpen`은 v1.135.0과 1차 설계의 뜻 그대로다. 파일 이름만 쓴 것은 `src/features/backgrounds/` 아래, 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.

---

## 1. 목표와 범위

### 1.1 만드는 것

- **끌어다 놓기**: 도면 탐색 탭에서, 파일을 실은 끌기가 편집기(도면 목록·머리줄·띠·평면·3D·보조 평면도·속성 칸·이미지 목록) 위에 들어오면 도면 칸 위에 덮개 하나가 뜨고 어디에 들어갈지 말한다. 놓으면 넣는다.
- **Ctrl+V**: 같은 탭에서 글자 칸 밖이면, 클립보드의 그림(화면 캡처, '이미지 복사', 탐색기에서 복사한 그림 파일)을 넣는다.
- **＋ 이미지 추가**: 이미지 목록 머리줄의 버튼. 파일을 여러 개 골라 넣는다.
- **대상은 고른 것이 정한다**(포인터가 놓인 자리가 아니다): 카메라 → 그 카메라의 시점, 공간(도로 포함) → 그 공간, 기호 → 그 기호가 속한 공간(없으면 도면), 아무것도·평면에서 여러 개 → 도면. 이미지 목록의 머리줄이 이름하는 범위와 늘 같다.
- **넣기 한 번 = 그림마다 배경 하나**(낮 변형 하나, 수정본 하나, 원본 경로를 알면 함께). 장소가 없으면 장소 창이 한 번 묻는다. 이어 주기는 편집 중이면 초안에(되돌리기 한 단계, 띠의 수 +1), 아니면 그 자리에서 저장.
- **표시는 모두 이미지 목록 안**: 흐린 카드와 단계 표시, 알림 줄 하나, 새 카드의 '추가됨' 6초. 도면(SVG·3D)의 **크기**는 넣기 전·도중·뒤에 같다. 자리도 넓은 창에서는 같다 — 좁은 창에서는 넣기를 시작할 때 알림 줄을 보이려고 탭이 한 번 스크롤될 수 있다(K13). 저장이 실패해도 같다: 이 기능이 보낸 저장은 라이브러리의 붉은 줄을 남기지 않고, 까닭은 알림 줄이 말한다(5.5).

### 1.2 알린 것이 한 가지로 정하지 않는 곳 — 묻지 않고 정한 것

다른 답이 오면 고칠 곳을 적어 둔다. 완료 보고에 적는다(13.2).

| # | 정하지 않은 곳 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| K1 | 카메라에 넣은 그림의 '소속 장소' | **그 카메라가 서 있는 공간**의 장소 → 없으면 도면의 대표 장소 → 그것도 없으면 장소 창. 서 있는 공간은 평면의 점을 품은 맨 위 공간이다. 어디에도 서 있지 않을 때만 속성의 '카메라가 있는 공간'(`spaceId`)을 본다 — 그 값은 만들 때 적히고 옮겨도 그대로라서(2.1) 서 있는 방과 다르기 일쑤다. 창이 정한 장소는 **그 공간에**(없거나 잠겼으면 도면에) 이어진다. '카메라가 있는 장소'는 그 공간의 장소일 때만 채운다(3.2). **덮개와 알림 줄이 그 장소의 이름을 말한다**(3.3, 7.4) | `resolveMapImageTarget`의 카메라 가지 |
| K2 | 새 배경의 기본값 | 이름 = 파일 이름(확장자 제외), 구도 '전체 전경', 변형 '낮' 하나, 수정본 하나, 태그·메모 없음. 화면 캡처처럼 이름이 없는 그림은 `붙여 넣은 그림 14:05`. 같은 장소에 같은 이름이 있으면 ` (2)`, ` (3)`… | `buildMapImageView` · `mapImageBaseName` |
| K3 | 한 번에 몇 장 | **10장**. 넘는 것은 넣지 않고 알림 줄이 수를 말한다. PNG·JPG·WebP, 장당 20MB('배경 등록' 창과 같은 한계) | `MAP_IMAGE_ADD.maxFiles` |
| K4 | 같은 원본을 다시 넣으면 | 같은 장소에 **같은 원본 경로**의 배경이 이미 있으면 새로 만들지 않는다. 대상이 카메라면 그 배경을 그 카메라에 이어 준다(초안을 버려 연결만 잃은 뒤 다시 넣어도 둘이 되지 않는다). 그림을 고쳐 다시 넣어도 새 수정본이 되지는 않는다 — 알림 줄이 **그 배경의 이름**과 그 길(카드의 '이미지파일 연결')을 말한다(7.4) | `planMapImageAdd`의 `reused` 가지를 뺀다 |
| K5 | 덮개의 자리 | 도면 칸(`.bmap-main`) 전체 위. 글자 상자는 화면에 보이는 높이의 35% 자리에 붙어 다닌다 — 좁은 창에서 아래로 내려가 있어도 보인다 | 7.1의 두 줄 |
| K6 | 탐색기에서 복사한 **파일**의 붙여 넣기 | 이벤트에 파일이 실려 오면 그대로 넣는다. 실려 오지 않으면 메인 프로세스가 클립보드의 파일 경로를 읽어 넣는다 — **첫 파일 하나, PNG·JPG만**. 그 길로 넣은 넣기의 알림 줄은 "한 번에 한 장만 들어온다"고 덧붙인다(여러 개를 복사했는지는 알 수 없다). WebP 파일은 그 길로 읽을 수 없어 까닭을 말한다(끌어다 놓기와 버튼으로는 된다) | 4.3·4.4 |
| K7 | 저장 실행을 시작하는 때 | 올리기는 곧바로, 그동안 편집기는 그대로 쓴다. 저장 실행은 **끌던 것을 놓고, 그리던 다각형을 마치고, 평면의 이름 칸이 닫히고, 열린 창이 없고, 다른 저장이 끝난 뒤**에 시작한다(시작이 끌기를 취소하거나, 찍는 점을 놓치거나, 치던 이름을 버리지 않게). 기다리는 동안 흐린 카드가 '저장 기다리는 중'이다. **파일을 끌고 들어오면 열려 있던 이름 칸은 도면을 누를 때처럼 확정되며 닫힌다** — 그 칸을 연 채 놓은 넣기가 끝없이 기다리지 않게(4.2). 속성의 이름 칸·숫자 칸은 기다리지 않는다 — 기다리면, 칸에 커서를 둔 채 그림을 끌어다 놓았을 때 저장이 끝내 시작되지 않는다. 대신 잠그기 직전에 **'도면 저장'을 누를 때처럼 그 칸을 떠나** 치던 값을 확정한다(9.3, 치르는 값은 13.3) | 편집기의 `idle`·`lock` 두 줄 |
| K8 | 이어 주기를 초안에 둘지 바로 저장할지 정하는 때 | **이어 주는 그 순간의 문서**로 정한다. 올리는 동안 '편집 시작'이나 '편집 끝내기'를 눌렀으면 그 뒤의 상태를 따른다 | — |
| K9 | 장소 창의 기본 선택 | **같은 부모 아래에 같은 이름으로 있고 어느 도면도 쓰지 않는 장소**(이 창이 앞서 만들었다가 초안과 함께 연결만 잃은 것)가 있으면 '기존 장소에서 고르기'에 그 장소가 골라져 있고, 없으면 '새 장소 만들기'에 공간(도면) 이름이 적혀 있다. 다른 도면의 '복도'나 옆의 '새 공간'이 쓰는 장소는 — 저장된 도면이 쓰든, 편집 중인 초안이 쓰든 — 골라 두지 않는다: Enter 한 번에 남의 장소로 들어간다. 포커스는 '이 장소로 넣기'. 뜬 뒤 0.4초 동안은 그 버튼과 Enter가 듣지 않고, **누르고 있던 키의 되풀이는 그 뒤에도 답하지 않는다**(Esc·취소는 바로) | 6절 |
| K10 | 흐린 카드의 그림 | 올리기 전에는 그림 없이 이름과 단계 표시·막대만, 올린 뒤에는 올라간 미리보기. PC의 원본을 화면에서 따로 풀어 보이지 않는다(큰 그림 열 장을 한꺼번에 풀면 화면이 멎는다) | 7.3 |
| K11 | 새 카드의 자리 | 이 화면을 연 뒤 넣은 그림은 목록의 **맨 앞**에 온다(화면을 떠날 때까지 — 6초 뒤에 카드가 제자리로 뛰지 않게). '추가됨' 표시만 6초 | `recent`를 `marked`와 함께 비운다 |
| K12 | 알림 줄이 사라지는 때 · 낡지 않게 | 스스로 사라지지 않는다. 닫기(×)와 다음 넣기가 지운다(시간으로 사라지면 그 아래 카드가 포인터 밑에서 올라온다). 넣은 도면의 목록에 보이고, **그 도면이 없어졌으면 지금 보는 도면의 목록에** 보인다. **초안에 이어 둔 넣기의 문장은 그 연결의 지금 모습을 따라 글만 바뀐다** — '도면 저장' 뒤, 되돌린 뒤, 버린 뒤. 넣은 그림을 모두 지운 뒤에는 어느 넣기의 줄이든 그렇게 말한다(7.4) | — |
| K13 | 목록이 화면 밖이거나 내려가 있을 때 | 넣기가 **시작될 때**와 알림 줄이 까닭을 말할 때만(사용자가 방금 한 일이다) 알림 줄을 화면 안으로 끌어온다(`scrollIntoView({ block: 'nearest' })` — 보이면 움직이지 않는다). 시작할 때는 카드 상자도 맨 위로 올린다(흐린 카드가 맨 앞이다). **끝날 때**와 목록이 다시 그려질 때는 아무것도 움직이지 않는다 — 끝나는 때에는 도면을 끌고 있을 수 있다 | 갤러리의 effect |
| K14 | 초안에만 이어 둔 그림을 카드에서 지우면 | 초안의 그 연결도 함께 빠진다. 남기면 '도면 저장'이 "카메라가 참조한 배경이 없습니다"로 막히고, 시점 목록에는 풀 칸이 없다(8.5) | 그 effect를 뺀다 — 막힌 초안은 되돌리기로만 풀린다 |
| K15 | '편집 끝내기'의 덧붙는 문장 | 초안이 저장된 도면에 **없는 연결을 더했을 때만** 한 문장이 더 나온다(연결을 푼 것만 있으면 나오지 않는다) | `mapLinksAdded` |
| K16 | 막힌 대상에서 | '＋ 이미지 추가'는 흐려지고 풍선이 까닭을 말한다(띠의 '도면 저장'과 같은 방식 — `disabled`가 아니라 `aria-disabled`). 끌어다 놓기는 덮개가 까닭을 말하고 포인터가 '놓을 수 없음'이 된다 — **놓아도 아무 일도 없다**(엔진이 놓기를 보내지 않는다, 4.2). 붙여 넣기는 알림 줄이 까닭을 말한다 | — |
| K17 | 미리보기(테스트 모드) | 올린 그림을 긴 변 480px로 줄여 보관한다(미리보기 저장소는 그림을 한 덩어리의 `localStorage`에 두 번 담는다). 확인용 훅 하나로 파일 경로·클립보드 파일·파일 선택을 흉내 낸다. **앱 엔진의 검사 창에서는 훅을 걸지 않아도 '＋ 이미지 추가'가 파일 창을 열지 않는다** | 9.4 |
| K18 | 글자 칸에 커서가 있을 때의 Ctrl+V | 그 칸의 붙여 넣기 그대로다. 클립보드에 **그림만** 있으면(이벤트에 실려 오지 않는 '복사한 그림 파일'은 메인 프로세스에 물어서) 알림 줄이 까닭과 할 일을 한 줄로 말한다 — 공간을 그리면 이름 상자가 스스로 열려 커서를 쥐고 속성의 이름 칸은 Enter로 빠져나오지 않아서, 말이 없으면 "고른 뒤 붙여 넣어도 안 된다"가 되풀이된다 | 4.3의 그 가지 |
| K19 | 브라우저·메일 창에서 끌어온 그림 | 넣는다. **원본 경로는 적지 않는다** — 엔진이 끌기 동안 만든 임시 파일이라 그 경로는 곧 없어진다(2.7) | 4.2의 `disk` 줄 |
| K20 | 저장이 도는 동안 도면을 누른 뒤의 붙여 넣기 | 그 누름은 여느 저장 때처럼 받지 않는다(고른 것이 바뀌지 않는다, 2.4). **그 뒤의 첫 붙여 넣기는 넣지 않고** 알림 줄이 `저장하는 동안 도면을 누른 것은 골라지지 않았어요. 넣을 곳을 다시 누른 뒤 붙여 넣어 주세요.`라고 한다 — 붙여 넣기는 어디에 들어갈지 미리 보이지 않아서, 바꾸려던 선택에 말없이 들어가면 안 된다. 놓기(덮개)와 버튼(머리줄의 이름·풍선)은 대상을 먼저 보인다 | 4.3의 `pasteImages` |
| K21 | 배경 하나의 저장이 실패하면 | **남은 그림은 보내지 않는다** — 한 장을 실패시킨 것(연결, 서버, 없어진 장소)은 다음 장도 실패시키고, 실패마다 저장소가 라이브러리를 다시 읽는 동안 편집기가 잠겨 있다. 그때까지 들어간 그림은 남고 도면에 이어 준다(5.2) | `run`의 `stopped` 줄 |

### 1.3 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 이미 있는 카드 위에 놓아 **새 수정본**으로 넣기, 낮·밤 파일 짝 묶기 | 실수 위험. 써 본 뒤에 정한다(추가 요청 계획 :137) |
| 포인터가 놓인 자리로 대상을 정하기, 놓은 자리에 카메라 만들기, 카드를 카메라로 끌기 | "고른 뒤에 넣기"가 요청이다. 평면·3D의 겹친 공간 판정이 따로 든다 |
| '배경 목록' 탭에서 끌어다 놓기 | 요청은 도면 화면이다. 그 탭은 지금처럼 '배경 등록' 창 |
| GIF·BMP·PSD, 20MB 넘는 그림, 한 번에 10장 넘게 | '배경 등록'의 한계를 넓히지 않는다 |
| 실패한 넣기가 남긴 저장소의 미리보기 정리, 넣기 취소 버튼, "방금 넣은 것 되돌리기", 넣는 중에 온 넣기를 줄 세우기 | 저장소에 지우는 길이 없다('배경 등록' 창도 같다). 잘못 넣은 그림은 카드에서 지운다(지우는 법은 13.2). 도는 중의 넣기는 까닭을 말하고 받지 않는다(5.5) |
| 그림마다 올리자마자 저장하기 | 저장마다 편집기가 잠긴다 — 올리기를 모두 마친 뒤 한 번의 잠긴 구간에서 저장한다(5.3). 그 전에 화면을 떠나면 그 넣기는 들어가지 않는다(13.2에 알린다) |
| 글자가 함께 든 클립보드를 넣기로 치지 않기, 포커스의 자리로 붙여 넣기를 가르기 | 앞의 것은 재 보지 못한 채 넣으면 붙여 넣기가 말없이 안 된다(4.3). 뒤의 것은 사건이 그 자리를 알려 주지 않는다(2.6) |
| 탐색기에서 복사한 파일 **여러 개**를 메인 프로세스 길로 한꺼번에, WebP 파일을 그 길로 | 그 클립보드 형식에는 첫 파일의 경로만 있고, 메인 프로세스는 PNG·JPG만 푼다(2.3) |
| 저장 모양(`types.ts`·`domain.ts`)·명령 종류·운영 DB·서버 함수 | 쓰는 것은 오늘의 `save`(place·view)와 `save-maps`뿐이다. 여러 건을 한 번에 저장하는 서버 명령은 새 migration과 승인이 든다 |
| 배경 메뉴의 노출 범위 | `src/features/playground/featureFlag.ts`는 건드리지 않는다 |
| 1차·2차의 것, "저장 안 한 편집을 이 PC에 보관" | 다른 차례다. 이 설계는 그것을 막지 않는다(9.5) |

### 1.4 계속 지켜야 하는 규칙

| # | 규칙 | 이 설계에서 지키는 방법 |
|---|---|---|
| R1 | v1.130.0~v1.137.0이 낸 동작은 하나도 물러서지 않는다 | 순수 모듈(`mapDocument.ts`·`mapWorkflow.ts`·`domain.ts`·`mapGallery.ts`…)과 3D 파일, `useBackgroundStore.ts`, `BackgroundLibraryView.tsx`, '배경 등록' 창은 고치지 않는다(9.3). 편집기에서 고치는 곳은 9.3의 표가 전부다 |
| R2 | 렌더러 → IPC → 메인 → Supabase. 권한은 메인이 본다. 세션 토큰은 메인 밖으로 나가지 않는다 | 올리기·파일 읽기·저장은 오늘의 채널 그대로(메인이 `canManage`를 다시 본다). 새 채널은 메인·preload·타입·미리보기 mock을 함께 고친다(4.4) |
| R3 | **한 번에 명령 하나.** 배경(과 새 장소)은 그것을 가리키는 도면보다 **먼저** 저장돼 있어야 한다 | 저장 실행은 `execute`를 하나씩 기다린다. 차례는 장소 → 배경들 → 이어 주기(5.3). `Promise.all` 없음 |
| R4 | 저장이 시작되면 끌던 것이 취소된다(:377 — `useLayoutEffect(() => { abortGesture(); }, […, canEdit])`). 제스처가 미리보는 동안의 `update`는 버려진다(mapDocument.ts:150-151) | 저장 실행은 끌기·제스처가 없을 때만 시작하고, 시작부터 끝까지 편집기를 잠근다(5.2). 이어 주기는 그 잠긴 구간 안에서 한다 |
| R5 | 끌기 도중에는 도면 위에 놓인 것이 생기거나 사라지지 않는다. 띠의 높이는 창 폭으로만 정해진다 | 덮개는 자리를 차지하지 않는다(`position:absolute`). 나머지 표시는 바깥 높이가 고정인 이미지 목록 안이다. 편집기의 오류 띠·안내(`setError`·`setNotice`)에 이 기능은 아무것도 쓰지 않는다. 토스트 없음(앵커 57). 탭을 스크롤하는 것은 넣기를 시작할 때뿐이고, 끝날 때는 아무것도 움직이지 않는다(K13 — 끌기는 누를 때 잡은 변환으로 자리를 센다, :890의 `pointerRef.current = { … }`, :898의 `pointFrom(event, session.matrix)`) |
| R6 | 기다림(`await`) 뒤의 핸들러는 그 렌더의 상태를 쥐고 있다(tasks/lessons.md 2026-10-11) | 기다린 뒤에는 라이브러리를 저장소(`useBackgroundStore.getState()`)에서, 문서를 `doc.getState()`에서 읽는다. 편집기의 함수는 그때의 렌더 것을 부른다(5.2). "도는 중인가"는 ref |
| R7 | 도면의 저장은 모두 `persistMaps`를 지난다. 편집을 끝내는 길은 `leaveEditing`뿐. 편집기에 `doc.dispatch`·`doc.selectMany`를 더하지 않는다 | 보기 모드의 이어 주기만 `persistMaps`를 한 번 더 부른다(앵커 50). 나머지는 건드리지 않는다 |
| R8 | **`BackgroundMapEditor.tsx`의 함수 순서** — 앵커가 표지에서 다음 표지까지를 잘라 읽는다 | 새 함수의 자리는 둘뿐이다(9.3): `uploadUnderlay` 바로 다음, `openSpaceFrom3D` 바로 다음. 어느 조각 안에도 끼우지 않는다 |
| R9 | 편집기에 '편집 중'과 셋째 '편집 시작'이 생기지 않는다. 이미지 목록의 안내 식은 글자 그대로다(앵커 58) | 이 기능의 문장은 모두 `mapImageDrop.ts`와 새 부품 파일에 둔다 |
| R10 | 테스트는 Node type-stripping으로 돈다 | `mapImageDrop.ts`는 `.ts` 확장자 상대 import, `import type`, 지울 수 있는 TypeScript만, `@/` 별칭·DOM·three.js 없음 |
| R11 | 네이티브 모달 창(같은 lessons 항목): `body`에 놓인 포커스의 키, 스스로 뜨는 창의 유예, 모달 밑의 알림, 기다림 뒤의 낡은 상태 | 6.4 |
| R12 | 움직임 규칙(CLAUDE.md) | transform·opacity만, 레이아웃 속성 전환 없음, 무한 반복 없음, `backdrop-filter` 없음. 움직임은 `no-preference` 블록에만 쓰고 정보(글자·표시)는 그 밖에 둔다(7.6) |
| R13 | 화면 글자는 비개발자의 말(해요체), 기울임 없음 | 3.3·6.2·7.4·11절의 문구 |

---

## 2. 현재 동작 (v1.135.1)

### 2.1 이미지 목록과 범위

- 목록은 **보기 전용**이다(BackgroundMapGallery.tsx:8-55): 받는 것은 `snapshot`·`maps`·`current`·`selected`와 콜백 셋(:8-11). 머리줄에 수(:26)와 범위의 이름·설명(:18-20, :27), 검색·구도·낮밤(:29-34), '도면 전체'·'배경 목록 →'(:35-38). 결과 상자는 선택·필터가 바뀔 때마다 `key`로 다시 놓인다(:40). 카드는 상세 창을 여는 버튼(:44), 빈 상태의 문장은 세 갈래(:50 — 읽기 전용 / 카메라를 고름 / 그 밖. 앵커 58이 그 식을 글자로 본다).
- 편집기는 **제스처 시작 때의 도면**과 "하나를 다루는 도구가 붙는 노드"를 준다: `settledCurrent`·`settledSelected`(:299-300), `gallery` 메모(:1027-1028). 그 노드(`selected`, :272)는 평면에서 여러 개를 고르면 없고, 3D에서는 손에 든 하나다.
- 범위(`selectMapBackgroundViews`, mapGallery.ts:5-66): 카메라 → 그 카메라의 `viewIds`만(:54-55). 공간 → 그 공간의 장소에 얽힌 배경 + 그 공간에 속한 카메라의 시점 + 그 공간의 상세 도면 아래 전부(:46-52). 기호 → 그 기호의 공간, 없으면 도면 전체(:58-61). 아무것도 → 도면의 대표 장소·모든 공간의 장소·모든 카메라의 시점·하위 도면 전부(:30-45). "장소에 얽힌"은 소속·카메라가 있는 장소·보이는 장소·관련 장소 가운데 하나라도 그 장소인 것이다(`relation:'related'`, domain.ts:173). **장소가 없으면 아무것도 모으지 않는다**(:26).
- **카메라의 소속(`spaceId`)은 서 있는 자리가 아니다.** 만들 때 고정 자리(500, 340 — mapSpatial.ts:35, :99-103)가 방 하나(방이 없으면 도로 하나)에만 들 때 그 공간으로 적히고(mapGeometry.ts:279-286), 카메라를 옮겨도 바뀌지 않는다(:104-116). 바꾸는 곳은 접힌 '시점 연결' 안의 '카메라가 있는 공간' 칸 하나다(:1246). 그래서 흔한 카메라는 '공간 미지정'이거나(보기 모드의 속성이 그렇게 적는다, :1048, :1231) 평면 가운데의 방에 속해 있다. 공간을 골랐을 때의 목록은 카메라를 이 값으로만 모은다(mapGallery.ts:48-50). 평면의 점을 품은 맨 위 공간을 묻는 길은 `spacesAt(map, point)[0]`이다(mapStack.ts:34-36 — 방은 작은 것부터, 방이 없으면 도로. 2차도 "카메라가 서 있는 방"을 자리로 정한다). 새 기호의 소속을 정하는 물음도 이 함수지만 **같은 물음은 아니다**: v1.135.1에서는 온전한 도면에 물었고(:588의 `spacesAt(base, point)[0]`), 2차 뒤에는 눈으로 숨긴 방을 빼고 묻는다(이 커밋의 :591 — `spacesAt(shownMap(base, hiddenIds), point)[0]`). 카메라의 공간(3.2)은 온전한 도면에 묻는다 — 숨긴 방도 방이다(3.2의 선택).

### 2.2 배경 한 건과 검증

- 그림은 배경(`BackgroundView`, types.ts:72-77) 안의 변형(:66-71) 안의 수정본(:61-65)이다. `placeId`는 **반드시** 있는 장소(domain.ts:82, :129), `cameraPlaceId`는 없어도 된다. 변형과 수정본은 하나 이상(:83, :86), 수정본의 `imageUrl`은 빈 글자·`https://…`·2,000,000자 이하의 data URL(:35), `filePath`는 글자(빈 글자 가능), `sourceImagePath`·`workFilePath`는 선택 키(:86-89). 이름은 1~160자(:50).
- 도면 쪽: 공간의 `placeId`(types.ts:13)와 도면의 `placeId`(:58)는 없어도 된다. **새로 그린 공간은 `placeId: null`로 시작한다**(:729) — "장소 없는 공간에 넣기"가 가장 흔한 처음이다. 카메라의 `viewIds`(types.ts:26)는 겹치지 않는 1000개 이하이고(domain.ts:31, :70) 모두 있는 배경이어야 한다(:132).
- 전체 검사(`validateBackgroundSnapshot`, domain.ts:117-136)는 **저장된 라이브러리만** 본다. 초안은 보지 않는다 — 초안의 카메라가 가리키는 배경을 지우는 삭제는 통과한다(8.5).

### 2.3 배경을 등록하는 길 — 올리기와 두 채널

- 배경을 새로 만드는 곳은 '배경 목록' 탭의 '배경 등록' 하나다(BackgroundAssetPanel.tsx:184-192 — 장소가 하나도 없으면 꺼져 있다, :187). 창의 기본값: 구도 `wide`, 변형 '낮' 하나, 그 첫 수정본은 빈 그림(BackgroundAssetDialog.tsx:24-56). 그림을 올리면 둘째 수정본이 붙고 원본 경로를 `getPathForFile`로 적는다(:146-168 — 경로가 없으면 안내 글, :160). 창 안의 그림 칸만 파일을 받는다(:241 — 첫 파일 하나, 끌고 있는 동안의 표시 없음). 붙여 넣기는 없다.
- **`uploadBackgroundImage(file)`**(BackgroundUI.tsx:128-156): `file.type`이 PNG·JPEG·WebP가 아니면 `PNG, JPG, WebP 이미지를 선택해 주세요.`(:129-130), 20MB를 넘으면 `이미지는 20MB 이하로 등록해 주세요.`(:131-132). 긴 변 1600 → 1200 → 900 → 650px로 다시 그려 data URL이 2,000,000자 이하가 되는 첫 것을 쓴다(JPEG는 JPEG로, 나머지는 PNG로 — :134-140). 그 뒤 `window.electronAPI.backgroundUploadImage(data)`(:150).
- **`background:upload-image`**(`electron/backgroundIpc.ts:38-51`): 세션 epoch → 형식 → **라이브러리 전체를 한 번 읽어** `canManage` 확인(:44-46) → 저장소에 `scene-images/backgrounds/<uuid>.png|jpg`로(긴 변 1600px 이하, `electron/backgroundStorage.ts:6-30`). 지우는 길은 없다. 권한·세션·형식의 거절은 **던진다** — 화면에는 Electron의 껍데기(`Error invoking remote method …`)가 붙어 온다.
- **`background:read-image-file`**(`electron/backgroundIpc.ts:52-65`): 읽기 전과 뒤에 `canManage`를 보고, 경로의 파일을 메인이 읽어 `{ dataUrl, filePath }`를 돌려준다. **받는 경로는 PNG·JPG뿐이다**(`electron/backgroundImageFile.ts:24-38`): 드라이브·공유 경로의 전체 경로여야 하고, **`.webp`는 `WebP 파일은 경로로 연결할 수 없습니다. …`로 거절**(:35), 그 밖의 확장자는 `PNG, JPG, JPEG 이미지 파일만 경로로 연결할 수 있습니다.`(:36). 20MB(:53, :62), 내용이 PNG·JPEG인지(:77-79), 1600px(:86-89), 2,000,000자(:91-99). AGENTS.md(:142 — "`background:read-image-file`은 … PNG/JPG/WebP를 20MB 이내로 제한한다". 설계를 쓴 때는 :140)는 이 채널이 WebP도 받는다고 적고 있다 — **틀렸다.** 이번에 고친다(11절).
- preload: `backgroundUploadImage`·`backgroundReadImageFile`이 세션 epoch를 함께 보낸다(`electron/preload.ts:495-498`). 타입은 `src/types/index.ts:1059-1064`.
- **미리보기 mock**(`src/mocks/devElectronAPI.ts`): 올리기는 받은 data URL을 **그대로** 주소로 돌려준다(:3752-3757 — 미리보기 저장소는 그것을 스냅샷과 요청 영수증에 한 번씩, 하나의 `localStorage` 값에 담는다: previewGateway.ts:10, :58-59). 파일 읽기는 예제 경로 하나만 그려 준다(:3758-). `getPathForFile`은 늘 `''`(:2653 — `tests/backgroundImageFile.test.ts:140`이 그 값을 본다), `clipboardReadImageFile`은 늘 `null`(:2775 — `tests/characterFeedback3.test.ts:64`). 권한은 mock 계정의 역할로 본다(:150-158). 검사 창(`scripts/preview-electron.cjs:35`)은 preload를 싣지 않으므로 이 mock으로 돈다.

### 2.4 저장소 — 한 번에 명령 하나, `pending`이 편집기에 하는 일

- `execute`(useBackgroundStore.ts:44-75): 로그인 없음·**도는 저장이 있음**(`진행 중인 저장이 끝난 뒤 다시 시도해 주세요.`)·업데이트 필요를 먼저 거절(:45-46) → 그 순간의 스냅샷에 적용해 보고(:48 — 여기서 검증에 걸리면 `pending` 없이 던진다) → `pending: true`(:49) → 보내기 → 되면 받은 스냅샷으로 바꾸고 `pending: false`(:53). 실패하면 `pending`을 쥔 채 한 번 다시 읽고(:59-61), `save-maps`만 "들어갔는지" 알아봐 성공으로 친다(:62-64). **배경·장소의 저장은 알아봐 주지 않는다** — 다시 읽은 스냅샷을 놓고 저장소의 오류 줄을 켠 뒤 던진다(:65-71).
- **그 오류 줄은 도면을 줄이거나 민다.** 보낸 뒤에 실패한 명령은 저장소의 `error`에 받은 글을 그대로 적고(:69 — Electron의 껍데기가 붙은 글), 라이브러리가 그것을 탭 줄과 본문 사이의 붉은 줄로 그린다(BackgroundLibraryView.tsx:142-146 — 탭의 스크롤 상자 **밖**이다, :152). 그 높이(한 줄이면 66px쯤)만큼 본문이 줄어든다: 넓은 창의 평면에서는 도면 칸이 그만큼 낮아지고(backgrounds-map.css:1의 `height:100%`), 3D와 좁은 창에서는 편집기의 크기는 그대로이고 탭이 그만큼 덜 보인다. 다음 명령(:49)이나 다음 읽기(:32 — 15초마다, 창에 포커스가 올 때)가 지우면 제자리로 온다. 오늘의 모든 저장('도면 저장' 포함)이 그렇다. 보내기 전에 걸린 검증(:48)과, 응답을 잃었지만 들어간 `save-maps`(:62-64 — 저장소가 스스로 `error: null`로 둔다)에는 뜨지 않는다.
- 화면을 떠나면 저장소가 비워진다(`initialize(null)`, BackgroundLibraryView.tsx:55-57). 저장소는 모듈에 하나라서, 떠났다 돌아온 뒤에도 **예전 화면이 쥔 `execute`는 새 세션에 그대로 닿는다**.
- 편집기에서 `disabled = pending || busy`(:278), `canEdit = editing && !disabled`(:280). `canEdit`이 거짓이 되면: 끌던 것이 취소되고(:374), 평면의 이름 칸이 **확정 없이** 닫히고(:283-284, :463), 그 뒤의 누름을 받지 않는다(`pointerDown`의 첫 가드는 `disabled`다, :791 — 보기 모드의 누름도). 도면 목록·도구·속성의 버튼이 꺼지고 띠는 `저장 중…`이다(:1084).
- 서버는 요청 하나에 명령 하나다(`background_library_execute`, `DEVLOG/migrations/2026-09-21-background-library.sql:211`). 배경 N건은 요청 N번이고, 번마다 라이브러리 전체가 돌아오며 모든 화면에 변경 신호가 간다(`electron/backgroundIpc.ts:29-37`).

### 2.5 도면 저장 길과 초안 밖의 저장

- 도면의 저장은 모두 `persistMaps(command)`(:525-532)를 지난다: `await execute(command)` → 저장한 도면 가운데 **초안이 있던 것만** 다시 놓는다(`doc.rebaseDrafts(savedMaps(command))` — 초안이 없던 도면에는 열지 않는다, mapDocument.ts:84-91) → 누를 때 보던 도면이 그 저장에 들어 있고 초안이 있으면 띠의 '도면을 저장했어요'(:531). 부르는 곳은 넷(`saveMap` :637, `createMap` :694, `linkMap` :704, `saveSettings` :715 — 앵커 50이 수를 센다. 1차가 다섯으로 만든다).
- `saveMapChanges(snapshot, drafts, changes)`(mapWorkflow.ts:28-49)는 도면마다 `expectedRevision`을 정한다: 초안이 있으면 초안의 `baseRevision`, 없으면 라이브러리의 버전(:47).
- **초안을 기다리지 않는 저장이 이미 있다**: '기존 도면 연결'·'연결 해제'(`linkMap` :698-708), '설정 저장'(`saveSettings` :709-719 — 대표 장소가 여기서 저장된다, :1299), '내부 도면 만들기'. 얽힌 도면의 초안 값이 함께 저장되고 창이 그렇게 말한다(:1201, :1282, :1291, :1300).
- 이어 주기는 오늘 **편집 중에만** 된다: 공간의 '배경 장소 연결'과 카메라의 '시점 연결'은 `editing` 안의 속성 칸이고(:1245-1246) `patchNode`로 초안을 고친다(:545-552). 보기 모드에서 그림을 노드에 이을 길은 없다.
- 초안에 쓰는 길: `updateMap(next)`(:538-540) → `doc.update` — 키 없이 부르면 **되돌리기 한 단계**다(mapDocument.ts:153-156). 어느 도면의 초안이든(지금 보는 도면이 아니어도) 쓴다. 초안이 없는 도면에는 아무 일도 없다(:151).

### 2.6 창 단위의 끌기·놓기·붙여 넣기 리스너, 전역 `user-drag`

- **편집기와 이미지 목록에는 끌기·놓기·붙여 넣기를 듣는 것이 하나도 없다.** 그래서 지금은 아무 일도 일어나지 않는다. 배경 기능의 놓기 대상은 '배경 등록' 창의 그림 칸 하나다(BackgroundAssetDialog.tsx:241 — 창은 `document.body`로 포털된다, BackgroundUI.tsx:36-61).
- **창·문서 단위의 `dragover`·`drop` 리스너는 앱에 없다**(`src/App.tsx`에도). 요소에 다는 것 하나(`src/utils/dragAutoScroll.ts:39-42` — 씬 목록용)와 다른 화면의 React 핸들러뿐이다. 메인 창은 `navigateOnDragDrop`을 켜지 않는다(`electron/main.ts:844-848`) — 아무도 받지 않는 파일 놓기는 앱에서 아무 일도 하지 않는다(브라우저 미리보기에서는 그 파일이 탭에 열린다).
- **창·문서 단위의 `paste` 리스너는 다섯 군데 있다** — 모두 다른 화면의 것이다: 캐릭터 그림 칸(`src/components/characters/FeaturedImageSlot.tsx:485`), 리깅 공지 창(`RiggingAnnounceModal.tsx:178`), 씬 상세 둘(`SceneDetailModal.tsx:880`, `UnifiedSceneDetailModal.tsx:738`), 씬 화면(`src/views/ScenesView.tsx:1156`, `document`). 앱은 한 번에 한 화면만 그리므로(`src/App.tsx:3286-3287`, `<LazyErrorBoundary key={currentView}>` :3301) 배경 화면이 떠 있는 동안 이들은 없다. 늘 떠 있는 것은 '한꺼번에 연결' 창의 호스트뿐이고(`src/App.tsx:3398`) 그 창은 **떠 있는 동안에만** 창 단위·캡처 단계에서 붙여 넣기를 멈춘다(`BulkWorkLinkDialog.tsx:81-85`).
- **진짜 붙여 넣기 사건의 대상은 커서가 든 글자 칸이고, 그 밖의 포커스에서는 `body`다.** 버튼·체크 칸에 포커스가 있을 때의 붙여 넣기도 `body`로 온다(tasks/lessons.md:861 — v1.134.0에서 앱 엔진으로 잰 것. 앱은 글자 칸 밖의 선택도 막는다, `src/index.css:246-250`). 그래서 붙여 넣기의 대상으로 가를 수 있는 것은 **글자 칸인가 아닌가**뿐이고, "포커스가 어느 버튼에 있는가"는 알 수 없다.
- 전역 `*, *::before, *::after { -webkit-user-drag:none; }`(`src/index.css:246-250`, 복원은 :254-256)은 **요소를 끌어 내는 것**을 막는 규칙이다. 밖에서 들어오는 파일의 놓기와는 무관하다.
- 편집기의 창 단위 리스너는 키와 누름뿐이다(Esc :376-382, Alt :387-398, Space :420-424, Ctrl+S :444-447, 누름 기록 :449-455). Ctrl+S의 가드(:426-443)가 "창이 열려 있는가는 이벤트 대상이 아니라 상태와 문서에 묻는다(`openDialogs`, :93) · 글자 칸은 `textFields`(:85)"의 선례다. 그 가드의 셋째 — 포커스가 배경 화면(`.bg-library`) 밖이면 넘긴다 — 는 **키 사건이라서** 된다(키 사건의 대상은 포커스가 있는 요소다). 붙여 넣기에는 옮겨 올 수 없다(위).

### 2.7 파일과 클립보드 그림이 화면에 닿는 길 (Electron 33 = Chromium 130)

| 길 | 화면이 읽는 것 | 근거 |
|---|---|---|
| 파일을 끌고 들어옴 | `dragenter`·`dragover`의 `event.dataTransfer.types`에 `'Files'`, `items[i].kind === 'file'`과 `type`(확장자에서 온다. 모르는 확장자는 빈 글자). **`files`는 이때 비어 있다** | 엔진의 규칙(읽은 것). `types.includes('Files')`는 앱이 이미 쓴다(BackgroundAssetDialog.tsx:241) |
| 놓음 | `drop`의 `event.dataTransfer.files` — 이벤트가 끝나면 비워지므로 **그 자리에서** 읽는다. `dragover`를 `preventDefault()`하지 않으면 `drop`이 오지 않는다 | 같은 줄(:241)이 설치된 앱에서 도는 길이다 |
| 받지 않는 놓기 | `dragover`에서 `dropEffect`가 `'none'`이면 놓는 순간 `drop`이 오지 않고 **`dragleave`로 끝난다**(HTML의 끌기 처리 모델: 지금의 끌기 동작이 "none"이면 `drop` 대신 `dragleave`) | 읽은 것. 앱의 하나뿐인 놓기 대상은 늘 `'copy'`만 적어서(:241) 이 길은 앱에서 재 본 적이 없다(10.4) |
| 원본 경로 | `File.path`는 없다(Electron 32+). preload의 `getPathForFile(file)`(`electron/preload.ts:164` — **이미 열려 있다**, 타입 `src/types/index.ts:1064`)가 디스크에서 온 파일의 전체 경로를, 자료뿐인 파일에는 빈 글자를 준다 | BackgroundAssetDialog.tsx:156 |
| 브라우저·메일 창에서 끌어온 그림 | `types`에 `'Files'`와 함께 `text/uri-list`·`text/html`이 실린다(탐색기의 파일 끌기는 `'Files'`뿐이다). 놓인 `File`은 엔진이 끌기 동안 만든 임시 파일일 수 있고, 그때 `getPathForFile`은 곧 없어질 임시 경로를 줄 수 있다 | 읽은 것 — 둘 다 재 보지 않았다(10.4의 실기 목록). 그래서 그 경로는 쓰지 않는다(K19) |
| 복사한 그림(화면 캡처, '이미지 복사') | `paste`의 `event.clipboardData.items` 가운데 `kind === 'file'`인 것의 `getAsFile()` — 이름 `image.png`, 경로 없음 | 캐릭터 그림 칸이 설치된 앱에서 쓰는 길(`FeaturedImageSlot.tsx:468-474`) |
| 탐색기에서 복사한 **파일** | 이벤트에 실려 오는지는 환경에 따라 다르다고 적혀 있다(같은 파일 :476). 메인 프로세스는 등록 형식 `'FileNameW'`에서 **첫 파일의 경로**를 읽는다(`electron/clipboardFiles.ts:11-17`. `readBuffer('CF_HDROP')`는 늘 빈 버퍼다, :7-9). 지금의 채널 `clipboard:read-image-file`(`electron/main.ts:4459-4476`)은 그 파일의 **내용**을 30MB까지 data URL로 돌려주고 경로는 주지 않는다(`{ fileName, dataUrl }` — 그 타입과 mock을 `tests/characterFeedback3.test.ts:59-67`이 글자로 본다). `clipboard:read-image`(:4440-4453)는 800px JPEG라 쓸 수 없다 | 재 보지 않은 것: 앱의 붙여 넣기 이벤트에 탐색기 파일이 실리는지(10.4의 실기 목록) |

### 2.8 분석에서 바로잡은 것 · 1차·2차가 바꿔 놓는 것

| 분석(`r3-analysis.json`)의 서술 | 코드로 확인한 것 | 이 설계 |
|---|---|---|
| "창 단위의 `paste` 리스너는 앱 어디에도 없다" | 다섯 군데 있다(2.6). 배경 화면과 함께 떠 있지 않을 뿐이다 | 가드는 열린 창과 글자 칸을 스스로 본다(4.3) |
| 장소 창의 상태는 컨트롤러에 두고 따라가기의 가드에는 넣지 않는다 | 종합이 뒤집었다. 그리고 `dialogOpen`은 컨트롤러 훅을 부르는 줄보다 한참 앞에서 만들어진다 | 장소 창의 상태는 **편집기의 상태**(`placePrompt`)이고 `dialogOpen`에 든다(9.1) |
| 새 핸들러는 `uploadUnderlay`와 `newSpace` 사이 | 1차가 그 사이에 삭제 핸들러 넷을 두고, 마지막 조각이 `function newSpace(`까지다(1차 설계 6.2) | `linkAddedImages`는 `uploadUnderlay` **바로 다음**, 1차의 `function dropGoneDrafts(` 앞(9.3) |
| 붙여 넣기 핸들러는 Ctrl+S effect 다음에 | 그 자리도 되지만 흩어진다 | 이 기능의 훅·핸들러·effect는 `openSpaceFrom3D` 다음 한 곳에 모은다 |
| 새 앵커 60~63 | 1차가 60~66, 2차가 67~72를 쓴다 | **73~78**(R3-1~R3-6) |
| 흐린 카드에 PC 원본의 미리보기(object URL) | 20MB 그림 열 장을 한꺼번에 풀게 된다 | 올린 뒤의 미리보기만(K10) |
| 다 된 카드는 6초 동안 맨 앞 | 6초 뒤 카드가 목록 끝으로 뛴다 | 맨 앞은 화면을 떠날 때까지, 표시만 6초(K11) |
| 이어 주기는 장소가 `null`일 때만 놓는다 | 대상 판정은 "없어진 장소를 가리키는 값"도 없음으로 본다 — `null`만 보면 그 경우 늘 "이어 주지 못했어요"다 | 노드가 **대상을 정할 때의 값 그대로**일 때 놓는다(3.4의 `was`) |
| `mapUnsavedLinks`: 연결이 저장된 것과 다르면 | 연결을 **푼** 초안에도 "이어 둔 것이 사라져요"가 나온다 | 더한 연결만(K15) |
| 붙여 넣은 그림은 `clipboardData`의 파일에서 | 앱이 설치본에서 쓰는 길은 `items` → `getAsFile()`이다 | 그 길로 읽는다(4.3) |
| 검증: CDP의 끌기 이벤트에 실제 경로, `clipboard.writeImage` + `webContents.paste()` | **검사는 한솔의 데스크톱 세션에서 돈다 — 시스템 클립보드를 읽거나 덮어쓰면 안 되고, 네이티브 파일 창을 띄우면 안 된다** | 페이지에서 만든 `File`을 실은 가짜 `DragEvent`·`ClipboardEvent`와 mock 훅으로 본다. 진짜 끌기·붙여 넣기·파일 창은 배포 뒤 실기 목록(10.4) |
| (종합) AGENTS.md의 "PNG/JPG/WebP 경로" | 2.3 — `.webp` 경로는 거절된다 | 탐색기에서 복사한 WebP는 까닭을 말하고(K6), 그 문장을 고친다 |
| — (새로 찾은 것) | 초안에만 이어 둔 배경을 카드에서 지우면 그 도면을 저장할 수 없고 풀 길도 없다(오늘도 '시점 연결'로 만들 수 있는 막힌 길이다) | K14, 8.5 |
| 카메라의 장소는 "그 카메라의 공간"(`spaceId`)의 장소 | `spaceId`는 만들 때만 적히고 옮겨도 그대로다(2.1) — 서 있는 방과 다르기 일쑤다 | 서 있는 공간이 먼저, `spaceId`는 그 다음(K1, 3.2) |
| Ctrl+V는 "포커스가 배경 화면 안이거나 아무 데도 없을 때"만 | 진짜 붙여 넣기의 대상은 글자 칸이 아니면 늘 `body`다(2.6) — 그 조건은 앱에서 한 번도 걸리지 않고, 가짜 사건으로만 "지켜진다" | 가드에 두지 않는다. 글자 칸만 비켜 간다(4.3). 치르는 값은 13.3 |
| 막힌 대상·도는 중에 놓으면 까닭과 함께 거절한다(`dropEffect` none) | `dropEffect: 'none'`이면 `drop`이 아예 오지 않는다(2.7) — 놓은 뒤에 말할 자리가 없다 | 덮개가 말한 것으로 끝난다(K16) |
| — (새로 찾은 것) | 저장 실행이 도는 동안 저장소가 명령마다 라이브러리를 바꿔 놓아(useBackgroundStore.ts:49, :53) 공간·도면 대상에서는 방금 저장된 배경의 진짜 카드가 흐린 카드와 함께 선다 | 도는 넣기의 배경은 끝날 때까지 흐린 카드로만 그린다(7.2) |
| — (새로 찾은 것) | 보낸 뒤 실패한 저장은 라이브러리의 붉은 줄(껍데기가 붙은 글)을 띄워 도면을 줄이거나 민다(2.4) | 이 기능이 보낸 저장에서는 그 줄을 곧바로 끈다 — 까닭은 알림 줄이 다듬어 말한다(5.2의 `hush`, 5.5) |
| — (새로 찾은 것) | 저장이 도는 동안의 도면 누름은 말없이 버려진다(:791) — 그 뒤의 붙여 넣기가 바꾸려던 선택에 들어간다 | 그런 누름 뒤의 첫 붙여 넣기는 넣지 않고 까닭을 말한다(K20) |
| — (새로 찾은 것) | 대상의 장소가 **초안에만** 이어져 있어도(같은 편집에서 앞서 넣은 넣기) 그 공간은 "장소가 있는 대상"이다 — "바로 저장됐어요"라고 하면 띠의 말과 어긋난다 | 넣기는 늘 **기대는 장소 연결**(임자와 장소)을 싣고, 그것이 저장된 도면에 없으면 초안의 것으로 말한다(3.2의 `placeKept`, 3.4, 5.4) |
| — (새로 찾은 것) | 저장 실행이 잠근 동안 깨끗한 초안은 라이브러리를 따라가지 못한다(:346) — 그 사이 다른 PC가 그 도면을 저장했으면 이어 주기가 옛 버전 위에 얹혀 다음 '도면 저장'이 거절된다 | 이어 주기 직전에 깨끗한 초안을 라이브러리의 것으로 다시 놓는다(5.4) |

**1차(v1.136.0)·2차(v1.137.0)가 바꿔 놓은 것**(두 설계에서 읽었고, 2026-10-15에 만든 코드 `633e7afb`로 다시 봤다 — 아래 표는 만든 코드와 맞는다. 12절의 0단계)

| 앞 차례가 하는 일 | 이 문서에 닿는 곳 |
|---|---|
| 1차: `dialogOpen` 한 줄(`gestureActive` 다음)과 그것을 읽는 세 곳, 앵커 65 | 그 줄에 `placePrompt` 한 낱말을 더하고, 오류 띠의 조건을 장소 창에서만 띠가 남게 고치고, 앵커 65를 고친다(9.1·9.2) |
| 1차: `mapDelete` 상태(`confirmation` 다음), 삭제 핸들러 넷(`uploadUnderlay` 다음), `await persistMaps(`가 다섯 | 상태는 그 다음 줄에, 핸들러는 그 넷의 **앞**에. 앵커 50은 5 → **6** |
| 1차: `mapDelete.ts`의 `mapDeleteCauseText(cause)`(Electron의 껍데기를 벗기고, 한글이 없으면 `서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.`) | 실패의 까닭을 같은 함수로 다듬는다(5.5 — mapDelete.ts:144-148에 그대로 있다) |
| 1차: 공용 확인 창에서 `'delete-map'` 가지가 빠진다. 앵커 52가 보는 세 식은 그대로 | 버리기 창에 한 문장을 더한다 — 물음의 그 한 줄 안에 식 하나로(줄을 나누지 않는다: 앵커 66이 그 줄의 시작·끝과 다음 줄을 본다, 8.1). 그 세 식은 건드리지 않는다 |
| 1차·2차: `swallowSecondClick`의 수(앵커 52) | 이 차례는 그 함수를 부르지 않는다 |
| 2차: `Props`에 `viewerId`, 보기 설정 핸들러 다섯(`clearSelection` 다음, `openView` 앞 — 설계의 첫 자리 그대로다), `ObjectList`·바닥줄·박스 구역, `BackgroundLibraryView.tsx`의 편집기 태그 한 줄 | 이 차례의 블록은 `openSpaceFrom3D` **바로 다음**이라 2차의 어느 자리와도 겹치지 않는다. 이미지 목록(`BackgroundMapGallery.tsx`·`mapGallery.ts`)은 2차가 건드리지 않는다. 눈으로 숨긴 노드는 선택되지 않으므로(2차) 대상이 되지 않는다 — 목록에서 이름을 눌러 다시 보이게 하면 대상이다. 박스로 보는 방 안의 것은 목록에서 고르면 대상이다 |
| 1차·2차: `backgrounds-map.css`에 줄이 는다(전환·애니메이션 없음, 새 미디어 블록 없음) | 새 규칙의 자리는 앞 줄의 선택자 글자로 찾는다(7.6) |

---

## 3. 대상과 문구 — `mapImageDrop.ts` (새 파일)

DOM·React·three.js가 없는 순수 모듈이다(`mapEditStatus.ts`처럼 문구도 여기 둔다). import는 `./types.ts`(타입), `./mapStack.ts`의 `spacesAt`(3.2 — three.js·DOM 없는 순수 모듈이다), `./mapDelete.ts`의 `mapDeleteCauseText`(5.5)뿐이다. 14절에서 아래 서명 그대로 시안을 만들어 진짜 `domain.ts`·`mapGallery.ts`·`mapStack.ts`·`mapDocument.ts`·`mapWorkflow.ts`·저장소에 대고 돌렸다.

### 3.1 서명

```ts
export const MAP_IMAGE_ADD = { maxFiles: 10, maxBytes: 20 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] as readonly string[],
  nameLimit: 160, pathLimit: 4096, viewLimit: 1000, addedMarkMs: 6000, promptGraceMs: 400 } as const;
/** What a background made here starts as (K2). The ghost card shows the same two words. */
export const MAP_IMAGE_DEFAULTS = { shot: 'wide', time: 'day', variantName: '낮' } as const;
export type MapImageScope = 'map' | 'space' | 'camera'; export type MapImageBlock = 'read-only' | 'no-map' | 'locked-camera' | 'locked-space';
/** What the pictures are added to. `nodeId` is null for the map itself; `name` is the name the image list shows. */
export type MapImageAim = { mapId: string; scope: MapImageScope; nodeId: string | null; name: string; cameraId: string | null };
export type MapImageTarget =
  | { status: 'blocked'; reason: MapImageBlock; name: string }
  /** `placeNodeId`: who holds that place, a space id or null for the map. `placeKept`: the saved map holds it there too (false: only the draft does, tied since the last save). */
  | (MapImageAim & { status: 'ready'; placeId: string; placeName: string; cameraPlaceId: string | null; placeNodeId: string | null; placeKept: boolean })
  /** `placeNodeId`: who gets the place, a space id or null for the map. `placeWas`: what that node holds now (null, or the id of a place that is gone). */
  | (MapImageAim & { status: 'needs-place'; placeNodeId: string | null; placeWas: string | null; ownerKind: 'space' | 'map'; ownerName: string;
    suggestedName: string; parentPlaceId: string | null; sameNamePlaceId: string | null });
export type MapImageOpenTarget = Exclude<MapImageTarget, { status: 'blocked' }>;
/** The target is what the image list names: the selected camera, the selected space (or that of a selected symbol), else the map. The pointer never decides.
 *  `maps`: the maps as the editor shows them, a draft standing in for its saved map. Read for one thing only: which places are in use (3.2). */
export function resolveMapImageTarget(snapshot: BackgroundSnapshot, maps: readonly BackgroundMap[], map: BackgroundMap | undefined, selected: BackgroundNode | undefined): MapImageTarget;
export type MapImageWords = { title: string; detail: string; blocked: boolean };
export function mapImageTargetWords(target: MapImageTarget, facts: { editing: boolean; running: boolean; wrongType: boolean }): MapImageWords;
export function mapImagePlaceWords(target: Extract<MapImageTarget, { status: 'needs-place' }>, count: number, drafted: boolean, parentName: string | null): { lead: string; ask: string; parent: string; note: string };
/** A file as the rules see it. `byPath`: the main process reads it from `path` (a file copied in Explorer). `pasted`: it came in a paste. */
export type MapImageFileFacts = { name: string; type: string; size: number; path: string; lastModified: number; byPath: boolean; pasted: boolean }; export type MapImageRefusal = 'type' | 'size' | 'webp-path';
/** A picture on its way in, as far as the rules read it: a file of the page (four fields of a `File`: a real one fits), or a path the main process reads. */
export type MapImageSourceLike = { kind: 'file'; file: { readonly name: string; readonly type: string; readonly size: number; readonly lastModified: number }; path: string; pasted: boolean } | { kind: 'path'; path: string };
export function mapImageSourceFacts(source: MapImageSourceLike): MapImageFileFacts;
export function mapImagePathFacts(path: string): MapImageFileFacts;
export function sortMapImageFiles(files: readonly MapImageFileFacts[]): { accepted: number[]; refused: { index: number; reason: MapImageRefusal }[]; over: number };
export const MAP_IMAGE_REFUSAL_TEXT: Record<MapImageRefusal, string>;
export function mapImageRefusedList(files: readonly MapImageFileFacts[], refused: readonly { index: number; reason: MapImageRefusal }[]): { name: string; reason: string }[];
/** True only when at least one file item is dragged, every file item names its type (not ''), and none of them is PNG, JPEG or WebP. Items that are not files are not counted: text alone is false. */
export function mapImageDragRefused(items: readonly { kind: string; type: string }[]): boolean;
export function mapImageBaseName(file: Pick<MapImageFileFacts, 'name' | 'path' | 'pasted'>, at: Date): string;
export function uniqueMapImageName(base: string, taken: ReadonlySet<string>): string;
export function findSameSourceView(snapshot: BackgroundSnapshot, placeId: string, path: string): BackgroundView | undefined;
export type MapImagePlaceChoice = { kind: 'existing'; placeId: string } | { kind: 'new'; name: string };
/** `newPlace` is saved first when it is not null. `place`: the tie the pictures stand on, the node that holds or is given the place (`nodeId` a space id, or null for the map)
 *  and what it held when the target was read (`was`: the place itself for a target that had one, else null or the id of a place that is gone).
 *  `items`: one for each picture that is uploaded (`index`: its place in the list handed in, not among the accepted ones). `reused`: backgrounds that are there already, to which a camera is tied; `reusedNames`: their names, in that order. */
export type MapImagePlan = { mapId: string; scope: MapImageScope; targetName: string; placeId: string; placeName: string; newPlace: BackgroundPlace | null;
  place: { nodeId: string | null; was: string | null }; cameraId: string | null; cameraPlaceId: string | null;
  items: { index: number; viewId: string; name: string }[]; reused: string[]; reusedNames: string[]; refused: { index: number; name: string; reason: MapImageRefusal }[]; over: number };
export function planMapImageAdd(snapshot: BackgroundSnapshot, target: MapImageOpenTarget, choice: MapImagePlaceChoice | null, files: readonly MapImageFileFacts[], at: Date, newId: () => string): MapImagePlan;
export function buildMapImageView(plan: Pick<MapImagePlan, 'placeId' | 'cameraPlaceId'>, item: { viewId: string; name: string }, upload: { imageUrl: string; sourceImagePath: string }, createdAt: string, newId: () => string): BackgroundView;
/** The saves of a batch in the order they are sent: the new place first, then one background for each uploaded picture. The link comes after them and is no command of its own. */
export function mapImageSaves(plan: MapImagePlan, uploads: readonly { viewId: string; imageUrl: string; sourceImagePath: string }[], createdAt: string, newId: () => string): BackgroundCommand[];
/** What a batch ties to the map, and stands on: the place of its owner (`place`, `placeId`: set when the owner still holds `was`, and done already for a target that had its place), and for a camera the views. `viewIds`: the backgrounds of the batch that are in the library, reused and added. */
export type MapImageLink = { place: { nodeId: string | null; was: string | null }; placeId: string; cameraId: string | null; viewIds: readonly string[] };
/** `library`: what is there to be tied. A background that is gone is left out and a place that is gone is not set: `complete` is false then. */
export function linkMapImages(map: BackgroundMap, link: MapImageLink, library: Pick<BackgroundSnapshot, 'places' | 'views'>): { map: BackgroundMap; complete: boolean };
/** Where a link stands now. 'gone': every background it named has been deleted since. Else the saved map holds it ('kept'), only the map on show does ('draft'), or neither ('undone': taken back, discarded, changed since). */
export function mapImageLinkNow(saved: BackgroundMap | undefined, shown: BackgroundMap | undefined, link: MapImageLink, library: Pick<BackgroundSnapshot, 'places' | 'views'>): 'kept' | 'draft' | 'undone' | 'gone';
/** There is something to tie: a background of the batch is in the library, or a place was asked for and is there. */
export function mapImageLinkWanted(link: MapImageLink, library: Pick<BackgroundSnapshot, 'places'>): boolean;
export function mapLinksAdded(saved: BackgroundMap | undefined, draft: BackgroundMap): boolean;
export function dropMissingViews(map: BackgroundMap, views: ReadonlySet<string>): BackgroundMap;
export function mapImagePasteWanted(facts: { shown: boolean; canManage: boolean; hasMap: boolean; dialog: boolean; text: boolean; dragging: boolean }): boolean;
/** `link`: how what was to be tied to the map went. 'none': nothing was to be tied, or it is there and saved already. 'draft' | 'saved': it is the draft's (put there now, or since the last save), or was saved at once (`partial`: only some of it could be).
 *  'kept' | 'undone' | 'gone': it was the draft's and was saved with it since, or is there no longer; or the pictures themselves were deleted (only mapImageOutcomeNow says these). 'missed': none of it could be tied. 'failed': the save of the map was refused (`linkCause`).
 *  `reusedName`: the name of the first background that was there already. `failed`: how many pictures are in the list of those that did not go in. `byPath`: the batch came from a file copied in Explorer. */
export type MapImageOutcome = { scope: MapImageScope; targetName: string; placeName: string; added: number; reused: number; reusedName?: string; failed: number; over: number; byPath?: boolean;
  link: 'none' | 'draft' | 'saved' | 'kept' | 'undone' | 'gone' | 'missed' | 'failed'; partial?: boolean; linkCause?: string };
/** A batch that ended, as it stands now. Every background it put in has been deleted since: 'gone', whatever its link was. Its link was the draft's, whole ('draft' and not `partial`): where that link is now (mapImageLinkNow). Anything else: the outcome itself, as it ended. */
export function mapImageOutcomeNow(outcome: MapImageOutcome, link: MapImageLink, saved: BackgroundMap | undefined, shown: BackgroundMap | undefined, library: Pick<BackgroundSnapshot, 'places' | 'views'>): MapImageOutcome;
export function mapImageSummary(outcome: MapImageOutcome): string;
export const mapImageBusyText: (scope: MapImageScope, targetName: string, count: number) => string;
export const mapImageCauseText: (cause: unknown) => string;      // = mapDeleteCauseText of mapDelete.ts (5.5)
export const MAP_IMAGE_STEPS: { readonly [step in 'ready' | 'uploading' | 'waiting' | 'saving' | 'failed']: { readonly label: string; readonly part: number } };
export type MapImageStep = keyof typeof MAP_IMAGE_STEPS; export const MAP_IMAGE_HINT: string, MAP_LINKS_LOST_NOTE: string, MAP_IMAGE_FIELD_NOTE: string, MAP_IMAGE_PRESS_NOTE: string;
```

### 3.2 대상과 장소 — `resolveMapImageTarget`

들어오는 값은 **이미지 목록이 받는 넷**이다(`selectMapBackgroundViews`와 같다): 라이브러리, 편집기가 지금 보이는 도면들(`maps` — 초안이 있으면 초안의 값), 지금 보는 도면, "하나를 다루는 도구가 붙는 노드"(`selected`, :272). 대상을 정하는 것은 뒤의 둘이라 대상은 목록 머리줄의 이름과 늘 같다. `maps`는 "그 장소를 쓰는 도면이 있는가"(아래의 `sameNamePlaceId`)에만 읽힌다. 차례대로 본다.

| # | 조건 | 결과 |
|---|---|---|
| 1 | 도면이 없다 | `blocked: 'no-map'`, `name: ''` |
| 2 | `!snapshot.canManage` | `blocked: 'read-only'`, `name: ''`(화면에는 덮개도 버튼도 없다 — 4.1) |
| 3 | 카메라를 골랐고 잠겨 있다 | `blocked: 'locked-camera'`, `name` = 카메라 이름 — 이어 주면 잠긴 노드의 `viewIds`가 바뀐다 |
| 4 | 카메라(잠기지 않음) | `scope: 'camera'`, `cameraId`·`nodeId` = 그 카메라, `name` = 카메라 이름. 장소 = **카메라의 공간의 장소** → 없으면 **도면의 대표 장소** → 둘 다 없으면 `needs-place`. `cameraPlaceId` = 고른 장소가 카메라의 공간의 장소일 때 그 id, 아니면 `null`. `ready`의 임자(`placeNodeId`) = 그 장소를 쥔 쪽 — 카메라의 공간(잠겨 있어도), 대표 장소로 갔으면 도면(`null`). `needs-place`의 임자 = 카메라의 공간(있고 잠기지 않았을 때), 아니면 도면 |
| 5 | 공간(도로 포함), 또는 기호가 속한 공간(`spaceId`가 가리키는 이 도면의 공간) | `scope: 'space'`, `nodeId` = 그 공간, `name` = 공간 이름, `cameraId: null`, **`cameraPlaceId: null`**. 장소 = **그 공간의 장소만**(도면의 대표 장소로 넘기지 않는다 — 그 장소의 배경은 이 공간을 골랐을 때 목록에 보이지 않는다). 없으면: 잠겼으면 `blocked: 'locked-space'`(`name` = 공간 이름), 아니면 `needs-place`(임자 = 그 공간). **장소가 있는 잠긴 공간은 `ready`다**(도면을 바꾸지 않는다). 어느 쪽이든 `placeNodeId` = 그 공간 |
| 6 | 그 밖(아무것도 안 고름, 평면에서 여러 개 고름, 공간 없는 기호) | `scope: 'map'`, `nodeId: null`, `name` = 도면 이름, `cameraId: null`, **`cameraPlaceId: null`**, `placeNodeId: null`. 장소 = 도면의 대표 장소, 없으면 `needs-place`(임자 = 도면) |

- **"장소가 있다"**는 그 id가 `snapshot.places`에 있다는 뜻이다. 없어진 장소를 가리키는 값(초안에만 남은 것)은 없는 것으로 친다 — 카메라의 공간이 그런 값을 쥐고 있어도 같다. `ready`의 `placeName`은 그 장소의 이름이다.
- **`ready`의 `placeKept`**: **저장된 도면**(`snapshot.maps`의 그 도면)도 그 임자(`placeNodeId`)에 그 장소를 쥐고 있는가다. 보기 모드에서는 받은 도면이 곧 저장된 도면이라 늘 참이다. 거짓인 때는 그 연결이 초안에만 있을 때다 — 같은 편집에서 앞서 넣은 넣기가 장소 창의 답으로 이은 것, 속성의 '배경 장소 연결'에서 고르고 아직 저장하지 않은 것. 그 대상은 장소를 다시 묻지 않고 받되(`ready`), 넣은 그림이 기대는 연결이 아직 '도면 저장'에 달려 있으므로 덮개와 알림 줄이 그렇게 말한다(3.3, 5.4).
- **카메라의 공간**(K1): ① 카메라의 평면 점(`x`·`y`)을 품은 맨 위 공간 — `spacesAt(map, camera)[0]` ② 어느 공간 안에도 서 있지 않으면 `spaceId`가 가리키는 **이 도면의** 공간(속성의 '카메라가 있는 공간'. 이 도면에 없는 id면 없는 것이다) ③ 둘 다 없으면 없다. ①이 있으면 ②는 보지 않는다 — '창고'에 서 있는 카메라는 속성이 다른 방을 가리켜도 '창고'의 카메라다. 눈으로 숨긴 방(2차)도 방이다: 대상은 온전한 도면에서 정하고, 장소를 물을 때는 창이 그 방의 이름을 말한다.
- `needs-place`의 값: `placeNodeId` = 임자 공간의 id(도면이면 `null`) · `placeWas` = 그 임자가 지금 쥔 `placeId`(`null`이거나 없어진 장소의 id) · `ownerKind`·`ownerName` · `suggestedName` = 임자 이름의 앞뒤 공백을 지우고 160자로 자른 것(비면 `새 장소`) · `parentPlaceId` = 임자가 공간이면 도면의 대표 장소(있을 때), 도면이면 `null` · `sameNamePlaceId` = **이름(앞뒤 공백 제외)이 `suggestedName`과 같고, 부모가 `parentPlaceId`와 같고, 어느 도면도 쓰고 있지 않은** 장소 — 라이브러리의 차례로 첫째, 없으면 `null`(K9). "쓰고 있다" = **저장된 도면(`snapshot.maps`), 편집기가 보이는 도면(`maps` — 다른 도면의 초안 포함), 받은 도면** 가운데 어느 하나라도 그 장소를 대표 장소로, 또는 어느 공간의 `placeId`로 쥐고 있다. 세 묶음을 모두 본다: 부모가 같은 도면은 흔하고(하위 도면은 들어온 공간의 장소를 대표 장소로 물려받고, 맨 위에 만든 도면은 대표 장소가 없어 부모가 모두 `null`이다 — :518의 `placeId: space?.placeId ?? null`, :681의 `placeId: createForm.placeId`), 연결이 초안에만 있는 장소도, 초안이 풀어 놓았지만 저장된 도면이 아직 쥔 장소도 남의 것이다. 남는 것은 이 창이 만들었다가 연결만 잃은 장소와, 아직 아무 도면도 쓰지 않는 배경 목록의 장소다.
- **3D에서 여러 개가 골라져 있을 때**는 손에 든 하나가 대상이다(목록이 그렇게 보인다). 평면에서 여러 개면 도면이다. 포인터가 어디에 있든, 평면이든 3D든 결과는 같다. 대상은 **넣는 순간**(놓는 순간, 붙여 넣는 순간, 파일을 고른 뒤)에 한 번 정한다.

### 3.3 문구 — 덮개와 까닭 (`mapImageTargetWords`)

이름은 편집기의 창들처럼 ‘ ’로 감싼다(빈 이름은 `이름 없음`). 조사가 이름의 받침에 따라 바뀌는 꼴은 쓰지 않는다. 위에서부터 먼저 맞는 줄이 답이다.

| 경우 | `title` | `detail` | `blocked` |
|---|---|---|---|
| `no-map` | `여기에는 넣을 수 없어요` | `도면을 먼저 만들어 주세요.` | ✓ |
| `read-only` | `여기에는 넣을 수 없어요` | `이 계정으로는 그림을 넣을 수 없어요.` | ✓ |
| 넣기가 도는 중(`running`) | `지금은 넣을 수 없어요` | `앞에 넣던 그림을 마치는 중이에요. 끝난 뒤에 다시 넣어 주세요.` | ✓ |
| 끌고 온 것이 모두 못 넣는 형식(`wrongType`) | `넣을 수 없는 파일이에요` | `PNG·JPG·WebP 그림만 넣을 수 있어요.` | ✓ |
| `locked-camera` | `‘카메라 2’에는 넣을 수 없어요` | `잠긴 카메라예요. 도면을 편집하면서 속성의 ‘위치·크기·잠금’에서 잠금을 해제하고 다시 넣어 주세요.` | ✓ |
| `locked-space` | `‘창고’에는 넣을 수 없어요` | `잠겨 있어서 배경 장소를 이어 줄 수 없어요. 도면을 편집하면서 속성의 ‘위치·크기·잠금’에서 잠금을 해제하고 다시 넣어 주세요.` | ✓ |
| `needs-place` | 아래의 제목 | `놓으면 배경 장소부터 정해요.` | |
| `ready`, 카메라, 편집 중 | 아래의 제목 | `그림은 ‘2-1 교실’ 장소에 바로 저장되고, 카메라에 이어 주는 것은 '도면 저장' 때 저장돼요.` | |
| `ready`, 카메라, 보기 | 아래의 제목 | `놓으면 ‘2-1 교실’ 장소에 바로 저장돼요.` | |
| `ready`, 그 밖(공간·도면), `placeKept` | 아래의 제목 | `놓으면 바로 저장돼요.` | |
| `ready`, 그 밖, 그 장소가 초안에만 이어져 있다(`!placeKept`) | 아래의 제목 | `그림은 바로 저장되고, 배경 장소를 이어 둔 것은 '도면 저장' 때 저장돼요.` | |

- 제목은 **무엇으로 들어가는지**를 말한다: 공간 `‘2-1 교실’의 배경으로 추가` · 카메라 `‘카메라 2’의 시점으로 추가` · 도면 `‘2층’ 도면의 배경으로 추가`('도면에 추가'라고만 하면 '도면 밑그림'으로 읽힌다). 카메라의 둘째 줄은 그림이 들어갈 **장소의 이름**(`placeName`)을 말한다 — 카메라의 그림이 어느 장소로 가는지는 화면의 다른 어디에도 없다(K1).
- 공간과 도로를 가르는 낱말(공간·도로)은 쓰지 않는다 — 이름만 적는다(화면은 도로를 '도로'라고 부른다, :159의 `kindLabel`, :1290의 `'선택한 도로'`). 잠금의 말은 속성 칸의 '잠금을 해제하면'(:1296)을 따르고, **어디서 푸는지**를 함께 말한다 — 잠금 칸은 편집 중에만(:1347의 `{editing && <>`), 접힌 '위치·크기·잠금' 안에 있어서(:1354-1355) 보기 모드에서는 화면에 없다. 그 말은 이미지 목록의 말('도면을 편집하면서')로 한다.
- 화면의 이름은 그대로 둔다: 머리줄은 '배경 이미지', 버튼은 '＋ 이미지 추가'(알린 이름)다. 문장 속의 '그림'은 알린 말 그대로이고(13.2) 무엇으로 들어가는지는 제목이 말한다.
- 막힌 까닭을 알림 줄에 적을 때는 `` `${title}. ${detail}` ``로 잇는다. 이 모듈의 어느 문장에도 '편집 중'·'편집 시작'이 없다(테스트가 본다).

### 3.4 이어 주기 — `linkMapImages`

`linkMapImages(map, link, library)`는 장소를 먼저, 그 결과에 시점을 잇는다. **바뀐 것이 없으면 받은 그 객체**를 돌려주고, `complete`는 "부탁받은 것이 돌려준 도면에서 모두 참인가"다. `library`는 이어 주는 순간의 라이브러리다 — **거기에 없는 것은 잇지 않는다**: 올리는 동안 카드에서 지운 배경, 그 사이 지워진 장소를 도면이 가리키면 바로 저장은 거절되고("카메라가 참조한 배경이 없습니다"), 초안에 들어가면 '도면 저장'을 막는다.

| 부탁 | 조건(위에서부터 먼저 맞는 줄) | 결과 |
|---|---|---|
| 장소(`link.place` — 늘 있다) — 임자가 도면(`nodeId === null`)이면 도면의 `placeId`, 아니면 그 id의 공간의 `placeId` | 임자인 공간이 없다 | `complete: false` |
| | `link.placeId`가 `library.places`에 없다 | 건드리지 않는다. `complete: false` |
| | 이미 `link.placeId`다 | 그대로 둔다(된 것이다 — 잠겨 있어도) |
| | 임자가 **대상을 정할 때 쥐고 있던 값 그대로**(`=== link.place.was`)이고, 공간이면 잠기지 않았다 | `link.placeId`로 놓는다 |
| | 그 밖(잠겼다 · 그 사이 다른 장소가 이어졌다 — 공간이든 **도면의 대표 장소든** 덮지 않는다) | 건드리지 않는다. `complete: false` |
| 시점(`link.cameraId`가 있고 `viewIds`가 하나 이상) | `viewIds`(겹침을 뺀 것) 가운데 `library.views`에 없는 id가 있다 | 그 id는 뺀다. `complete: false`(남은 것은 아래 줄로 간다) |
| | 그 카메라가 없다 | `complete: false` |
| | 더할 것(남은 id 가운데 그 카메라에 아직 없는 것)이 없다 | 그대로 둔다(된 것이다 — 잠겨 있어도) |
| | 더할 것이 있는데 잠겼다 | 건드리지 않는다. `complete: false` |
| | 그 밖 | 지금의 목록 **뒤에, 받은 차례대로** 붙인다 — 모두 1000개(`viewLimit`)까지만. 다 넣지 못했으면 `complete: false` |

- 다른 노드와 다른 키는 건드리지 않는다. 두 번 부르면 둘째는 같은 객체다. `cameraId`가 없으면 `viewIds`는 보지 않는다.
- **`link.place`는 넣기가 기대는 장소 연결이다 — 장소가 이미 있던 대상(`ready`)에서도 싣는다**(임자와 그 장소, `was`도 그 장소). 그 대상에서는 표의 셋째 줄('이미 `link.placeId`다')에서 끝나 장소를 쓰지 않는다: 장소가 있는 공간·도면은 **같은 객체**가 돌아오고(도면을 쓰지 않는다), 카메라는 시점만 붙는다. 그 사이 임자가 없어졌거나 다른 장소로 바뀌었으면 `complete: false`다 — 그 그림이 그 공간(도면)의 목록에 보이지 않게 됐는데 "바로 저장됐어요"라고 하지 않는다.
- **`mapImageLinkNow(saved, shown, link, library)`** — 그 연결이 지금 어디에 있는가. ① `link.viewIds`가 하나 이상인데 라이브러리에 **하나도 남아 있지 않으면 `'gone'`**(넣은 그림을 모두 지웠다 — 연결을 따질 것이 없다). ② 아니면 라이브러리에 없는 id를 빼고(그 뒤에 카드에서 지운 그림은 세지 않는다) 묻는다: "쥐고 있다" = 그 도면이 있고 `linkMapImages(도면, 남은 것, library)`가 **그 객체를 돌려주며 `complete`가 참**이다. 저장된 도면이 쥐고 있으면 `'kept'`, 아니고 보이는 도면(초안의 값)이 쥐고 있으면 `'draft'`, 둘 다 아니면 `'undone'`. 장소가 초안에만 이어진 공간에 넣은 넣기는 그래서 `'draft'`이고, '도면 저장' 뒤에는 `'kept'`, 버린 뒤에는 `'undone'`이다.
- **`mapImageLinkWanted(link, library)`** — 이을 것이 있는가: `link.viewIds`가 하나 이상이거나, **장소를 새로 정한 넣기**(`link.place.was !== link.placeId`)이고 그 장소가 라이브러리에 있다. 거짓인 두 경우에는 이어 주기를 부르지 않는다: 새 장소가 저장되지 않았다(이을 장소가 없다) / 장소가 있던 대상인데 그림이 하나도 들어가지 않았다(5.2).
- **`mapImageOutcomeNow(outcome, link, saved, shown, library)`** — 끝난 넣기의 지금 모습(알림 줄이 그릴 때마다 읽는다, 7.4). `mapImageLinkNow`가 `'gone'`이면 `link: 'gone'`(어떤 넣기든). 아니고 그 넣기의 연결이 **온전히 초안의 것**이었으면(`outcome.link === 'draft'`이고 `partial`이 아니다) `link`를 `mapImageLinkNow`의 답으로 바꾼다. 그 밖(`'saved'` · `'none'` · `'missed'` · `'failed'` · 일부만 이은 것)은 **받은 그 객체**다.

---

## 4. 들어오는 세 길

### 4.1 한 함수 — `addImages`

세 길은 모두 편집기의 한 함수로 들어온다(자리는 9.3). 넣을 것은 `MapImageSource`다(`useMapImageAdd.ts`): `{ kind: 'file'; file: File; path: string; pasted: boolean }`(끌어다 놓은 것·붙여 넣은 것·고른 것 — `path`는 `mapImageFilePath(file)`: `getPathForFile`의 값, 실패하면 `''`. 브라우저·메일 창에서 끌어온 것은 늘 `''` — K19) 또는 `{ kind: 'path'; path: string }`(탐색기에서 복사한 파일 — 메인 프로세스가 읽는다). 규칙이 읽는 꼴(`MapImageFileFacts`)로 바꾸는 것은 순수 모듈의 `mapImageSourceFacts`다(4.6).

```ts
  /** The one way in for a drop, a paste and the picker. What the pictures are added to is read here, at this moment: what the image list names. */
  const addImages = useEvent((sources: readonly MapImageSource[]) => {
    if (!sources.length || !current || !snapshot.canManage || dialogOpen || document.querySelector(openDialogs)) return;
    const target = resolveMapImageTarget(snapshot, maps, current, selected), files = sources.map(mapImageSourceFacts);
    const words = mapImageTargetWords(target, { editing, running: imageAdd.view.running, wrongType: false });
    if (target.status === 'blocked' || words.blocked) { imageAdd.say(current.id, `${words.title}. ${words.detail}`); return; }
    const sorted = sortMapImageFiles(files);
    // Nothing of it can be added: said at once, and no place is asked for.
    if (!sorted.accepted.length) { imageAdd.say(current.id, mapImageSummary({ scope: target.scope, targetName: target.name, placeName: '', added: 0, reused: 0, failed: sorted.refused.length, over: sorted.over, link: 'none' }), mapImageRefusedList(files, sorted.refused)); return; }
    if (target.status === 'needs-place') { setPlacePrompt({ target, sources, count: sorted.accepted.length, drafted: !!mapDraft(doc.getState(), current.id) }); return; }
    imageAdd.start(planMapImageAdd(snapshot, target, null, files, new Date(), uuid), sources);
  });
```

| 걸리는 곳 | 일어나는 일 |
|---|---|
| 도면이 없다 · 읽기 전용 계정 · 창이 열려 있다 | 아무 일도 없다(읽기 전용 계정에는 덮개도 버튼도 안내 줄도 없다) |
| 막힌 대상 · 넣기가 도는 중 | 알림 줄에 까닭(3.3). **줄 세우지 않는다** — 끝난 뒤에 다시 넣는다. 이 가지에 닿는 것은 **붙여 넣기**다: 진짜 놓기는 막힌 대상에서 오지 않고(4.2) 버튼은 눌리지 않는다(4.5) |
| 받을 수 있는 그림이 하나도 없다 | 알림 줄에 `넣은 그림이 없어요. 1장은 넣지 못했어요(아래 목록).`과 못 넣은 파일의 목록. 장소 창은 뜨지 않는다 |
| 장소가 필요하다 | 장소 창(6절). 아직 아무것도 올리지 않는다 |
| 그 밖 | 계획을 세워(5.1) 넣기를 시작한다 |

`current`·`selected`·`snapshot`·`maps`(:261 — 초안이 저장된 도면을 대신한 목록)는 그 순간의 렌더 것이다(`useEvent`). 붙여 넣기의 메인 프로세스 길은 한 번 기다린 뒤에 이 함수를 부르므로, 대상도 그때 다시 읽힌다.

### 4.2 끌어다 놓기

리스너는 **편집기 뿌리(`.bmap-layout`, `rootRef`)의 네이티브 리스너 넷**이다(`dragenter`·`dragover`·`dragleave`·`drop`). React 핸들러가 아닌 까닭: **편집기 자신의 창들**(만들기·연결·설정·확인, 1차의 도면 삭제, 이 차례의 장소 창)은 편집기가 그리는 포털이라, 뿌리에 React 끌기 핸들러를 달면 그 창 위의 끌기도 편집기까지 올라온다. DOM에서는 그 창들이 뿌리 밖(`document.body`)이라 네이티브 리스너에는 닿지 않는다. (배경 상세·'배경 등록' 창은 편집기의 자식이 아니다 — 라이브러리가 그린다, BackgroundLibraryView.tsx:190의 `{mapAssetView && <AssetDialog`. 그 창의 그림 칸(:241)은 어느 쪽으로도 편집기에 닿지 않는다.) 뿌리 밖(라이브러리의 탭·머리줄, 앱의 사이드바)은 아무것도 바뀌지 않는다. 다른 탭을 보는 동안에는 편집기가 `hidden`이라 사건이 오지 않는다.

```ts
  /** The element of the editor the drag went into last. */
  const dragInside = useRef<EventTarget | null>(null);
  /** Files dragged over the editor, wherever in it: one overlay says what they would be added to, and a drop adds them. Any other drag is none of its business. */
  const onFileDrag = useEvent((event: DragEvent) => {
    const data = event.dataTransfer;
    if (!data || !Array.from(data.types).includes('Files') || !current || !snapshot.canManage || dialogOpen || document.querySelector(openDialogs)) return;
    if (event.type === 'dragleave') {
      // From one child to another is no leave, and either of two things tells it: the engine names the element gone into, and that element has had its dragenter first.
      // Out of the editor, out of the window, or let go where nothing is taken: the overlay goes.
      const within = event.relatedTarget instanceof Node && !!rootRef.current?.contains(event.relatedTarget);
      if (!within && event.target === dragInside.current) { dragInside.current = null; setFileDrag(null); }
      return;
    }
    dragInside.current = event.type === 'drop' ? null : event.target;
    event.preventDefault();
    // A name box left open is settled as a press on the plan settles it: the overlay then names what was typed, and the save run does not wait on the box.
    if (renamingRef.current) focusCanvas();
    const refused = mapImageDragRefused(Array.from(data.items, item => ({ kind: item.kind, type: item.type })));
    // 'none': the pointer shows that nothing is taken here, and the engine then sends no drop at all. Such a drag ends in a dragleave.
    data.dropEffect = mapImageTargetWords(resolveMapImageTarget(snapshot, maps, current, selected), { editing, running: imageAdd.view.running, wrongType: refused }).blocked ? 'none' : 'copy';
    if (event.type !== 'drop') { setFileDrag(refused ? 'type' : 'ok'); return; }
    setFileDrag(null);
    // A picture dragged out of a browser or a mail window is a file the engine made up for the drag: its path does not last, so none is kept.
    const disk = Array.from(data.types).every(type => type === 'Files');
    // Read here, while the event lasts: afterwards the list is empty.
    addImages(Array.from(data.files, file => ({ kind: 'file' as const, file, path: disk ? mapImageFilePath(file) : '', pasted: false })));
  });
  useEffect(() => {
    const root = rootRef.current, types = ['dragenter', 'dragover', 'dragleave', 'drop'] as const;
    if (!root) return;
    for (const type of types) root.addEventListener(type, onFileDrag);
    return () => { for (const type of types) root.removeEventListener(type, onFileDrag); };
  }, [onFileDrag]);
  // The overlay never outlives its drag: while files are dragged the page gets no pointer event at all, so the first one says the drag is over.
  useEffect(() => {
    if (!fileDrag) return;
    const over = () => setFileDrag(null);
    window.addEventListener('pointermove', over, true); window.addEventListener('pointerdown', over, true);
    return () => { window.removeEventListener('pointermove', over, true); window.removeEventListener('pointerdown', over, true); };
  }, [fileDrag]);
```

- **핸들러가 읽는 것**(가짜 사건도 같은 길을 지난다): `event.dataTransfer.types`(`'Files'`가 있어야 한다. `drop`에서는 `'Files'`뿐인지도 — K19), `dataTransfer.items[i].kind`·`.type`(끌고 있는 동안의 형식 판정), `drop`에서 **`dataTransfer.files`**, `dragleave`의 `relatedTarget`, 그리고 **사건의 대상(`event.target`)** — 어느 요소인가를 기억했다가 `dragleave`의 대상과 견줄 뿐, 그 요소가 무엇인지는 보지 않는다. `isTrusted`는 보지 않는다. 핸들러가 **적는** 것은 `dropEffect` 하나다.
- **열려 있던 이름 칸은 닫는다**: 파일을 실은 끌기가 편집기에 들어오면(받아들인 첫 사건에서) 평면의 이름 상자가 도면을 누를 때처럼 확정되며 닫힌다 — `focusCanvas()`가 그 칸에서 포커스를 가져가고, 칸의 `blur`가 치던 이름을 확정한다(BackgroundMapNameBox.tsx:60). 설치된 앱에서는 탐색기를 누르는 순간 창이 포커스를 잃으며 이미 그렇게 됐을 것이다(재 보지 않았다 — 그래서 여기서도 닫는다). 놓는 순간이 아니라 들어올 때 닫는 까닭: 덮개와 장소 창이 **친 이름**을 말하고(같은 틱에 닫으면 그 틱의 대상은 예전 이름이다), 그 칸을 연 채 놓은 넣기가 저장을 끝없이 기다리지 않는다(K7).
- **파일을 실은 끌기만** 덮개를 띄운다. 글자·링크의 끌기는 첫 줄에서 돌아가고 기본 동작이 그대로다. 읽기 전용 계정·도면 없음·열린 창에서도 첫 줄에서 돌아간다: 덮개 없음, `preventDefault` 없음(앱에서는 아무 일도 없다).
- 상태 `fileDrag`는 `'ok' | 'type' | null`이다. `dragover`마다 같은 값을 다시 넣으므로 다시 그려지지 않는다. 덮개의 글은 그릴 때 대상에서 만든다(7.1).
- **형식 판정**(`mapImageDragRefused`): 세 가지가 모두 맞을 때만 참(`'type'`)이다 — 파일 항목(`kind === 'file'`)이 **하나 이상** 있고, 그 **모두**가 빈 글자가 아닌 형식을 밝혔고, 그 가운데 PNG·JPEG·WebP가 하나도 없다. 파일이 아닌 항목(글자·링크)은 세지 않는다 — 글자 항목만 있으면 거짓이다(M-3. "모두"만 적으면 파일 항목이 없을 때 저절로 참이 된다). 형식이 빈 글자인 항목(모르는 확장자)이 하나라도 있으면 판정하지 않는다 — 놓은 뒤에 목록으로 말한다.
- **막힌 경우(잠긴 대상·도는 중·형식)에는 놓기가 오지 않는다.** `preventDefault()`는 하고 `dropEffect`는 `'none'`이다: 포인터가 '놓을 수 없음'이 되고, 놓는 순간 엔진은 `drop` 대신 `dragleave`를 보낸다(2.7) — 덮개가 꺼지고, 그 밖의 일은 없다. **까닭은 덮개가 이미 말했다**(K16). 그러니 `drop` 가지가 `addImages`를 부르는 것은 받을 수 있는 대상에서뿐이고, `addImages`의 막힌 가지(4.1)는 붙여 넣기의 것이다. 가짜 사건으로 볼 때도 막힌 줄에서는 `drop`을 보내지 않는다(10.3 — 앱에서 오지 않는 사건이다).
- **브라우저·메일 창에서 끌어온 그림**(K19): `types`에 `'Files'` 말고 다른 것이 있으면(`text/uri-list`·`text/html`) 그 파일의 경로를 적지 않는다(`disk`). 그림은 들어가고, 원본 경로가 없으므로 K4의 "같은 원본"에도 걸리지 않는다. 탐색기에서 끌어온 파일은 `'Files'`뿐이라 경로가 적힌다 — 그 둘을 실기에서 본다(10.4).
- **덮개가 남지 않게**: ① `drop` ② 편집기 밖으로 나가는 `dragleave`(창 밖으로 나가거나, Esc로 끌기를 그만두거나, **막힌 대상 위에서 놓으면** 엔진이 `relatedTarget` 없는 `dragleave`를 보낸다) ③ 그 뒤의 첫 포인터 사건(둘째 effect — 끌기 도중에는 페이지에 포인터 사건이 오지 않으므로, 하나라도 오면 끌기는 끝난 것이다). ③은 ②가 엔진에서 달리 올 때의 그물이다 — 진짜 OS 끌기는 검사 창에서 볼 수 없다(10.4).
- **자식에서 자식으로 넘어갈 때는 끄지 않는다 — 둘 가운데 하나만 맞으면 된다.** ⓐ 엔진이 `dragleave`의 `relatedTarget`에 들어가는 요소를 싣는다(뿌리 안이면 나간 것이 아니다 — `within`). ⓑ 엔진이 들어가는 요소의 `dragenter`를 **먼저** 보내고 떠나는 요소의 `dragleave`를 뒤에 보낸다(HTML의 끌기 처리 모델의 차례) — 그러면 떠나는 요소는 '마지막으로 들어간 요소'(`dragInside`)가 아니다. 정말 나갈 때 — 편집기 밖, 창 밖, Esc, 막힌 대상 위에서 놓음 — 는 `relatedTarget`이 뿌리 밖이거나 없고, 떠나는 요소가 마지막으로 들어간 그 요소다. **둘 다 읽은 것이고 진짜 끌기로는 재 보지 못했다**: 가짜 사건은 검사가 넣은 값과 차례를 볼 뿐이다. 10.3의 E1이 두 길을 따로 보고, 깜빡이지 않는지는 실기 1에서 본다(12절의 대체안).

### 4.3 Ctrl+V

`window`의 `paste`를 버블 단계에서 듣는다(캐릭터 그림 칸과 같은 자리 — '한꺼번에 연결' 창이 떠 있으면 그 창이 캡처 단계에서 멈춰 여기까지 오지 않는다).

```ts
  /** A press on the plan that was not taken because a save was running: what was pressed is not selected. A paste shows nothing beforehand of where it goes, so the next one must not land on the selection that press meant to change. */
  const pressMissed = useRef(false);
  const notePress = useEvent((event: PointerEvent) => {
    if (event.isPrimary && event.button === 0 && event.target instanceof Node && svgRef.current?.contains(event.target)) pressMissed.current = disabled;
  });
  useEffect(() => {
    window.addEventListener('pointerdown', notePress, true);
    return () => window.removeEventListener('pointerdown', notePress, true);
  }, [notePress]);
  /** What a paste adds. After a press that was not taken it adds nothing, once, and says so. */
  const pasteImages = useEvent((sources: readonly MapImageSource[]) => {
    if (pressMissed.current && current) { pressMissed.current = false; imageAdd.say(current.id, MAP_IMAGE_PRESS_NOTE); return; }
    addImages(sources);
  });
  /** The cursor is in a field of the editor and the clipboard holds a picture and no text: the field keeps its paste (of a picture it takes nothing), and one line says why no picture came in. */
  const noteFieldPaste = useEvent(() => { if (current) imageAdd.say(current.id, MAP_IMAGE_FIELD_NOTE); });
  /** A picture file copied in Explorer may not be in the paste event at all: only the main process can read its path from the clipboard. `inField`: the cursor is in a field of the editor. */
  const pasteClipboardFile = useEvent(async (inField: boolean) => {
    const found = await window.electronAPI.backgroundReadClipboardFile().catch(() => null), root = rootRef.current;
    // The answer comes a moment later: not into a tab that was left meanwhile, and not under a drag that began meanwhile.
    if (!found || !root || root.offsetParent === null || pointerRef.current || doc.isGestureActive()) return;
    if (inField) noteFieldPaste(); else pasteImages([{ kind: 'path', path: found.filePath }]);
  });
  /** Ctrl+V adds the picture on the clipboard. Heard on the window: unless the cursor is in a text field a paste arrives at the body, whatever has the focus. A field keeps its own paste. */
  const onImagePaste = useEvent((event: ClipboardEvent) => {
    const root = rootRef.current, element = event.target instanceof Element ? event.target : null;
    const facts = { shown: !!root && root.offsetParent !== null, canManage: snapshot.canManage, hasMap: !!current,
      dialog: dialogOpen || !!document.querySelector(openDialogs), text: !!element?.closest(textFields), dragging: !!pointerRef.current || doc.isGestureActive() };
    const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file);
    const pictures = files.some(file => file.type.startsWith('image/'));
    if (!mapImagePasteWanted(facts)) {
      // Nothing but the cursor in a field of the editor is in the way, and the clipboard holds no text. A picture in the event is said at once; with no file in it at all the main process is asked whether a picture file was copied.
      if (root?.contains(element) && mapImagePasteWanted({ ...facts, text: false }) && !Array.from(event.clipboardData?.types ?? []).includes('text/plain')) {
        if (pictures) noteFieldPaste(); else if (!files.length) void pasteClipboardFile(true);
      }
      return;
    }
    if (pictures) {
      event.preventDefault();
      pasteImages(files.map(file => ({ kind: 'file' as const, file, path: mapImageFilePath(file), pasted: true })));
    } else if (!files.length) void pasteClipboardFile(false);
  });
  useEffect(() => {
    window.addEventListener('paste', onImagePaste);
    return () => window.removeEventListener('paste', onImagePaste);
  }, [onImagePaste]);
```

**가드 — `mapImagePasteWanted`는 여섯이 모두 맞을 때만 참이다**(하나라도 어긋나면 사건을 건드리지 않고 돌아간다):

| 값 | 참이어야 하는 것 | 어긋나는 경우 |
|---|---|---|
| `shown` | 편집기가 화면에 있다(`offsetParent`) | 라이브러리의 다른 탭 |
| `canManage` · `hasMap` | 편집 권한이 있고 도면이 있다 | 읽기 전용 계정, 첫 도면을 만들기 전 |
| `!dialog` | 열린 창이 없다 — **상태(`dialogOpen`)와 문서(`dialog[open]`, `[aria-modal="true"]`)에 묻는다.** 이벤트 대상에 묻지 않는다: 창 안의 버튼·체크 칸에 포커스가 있을 때와 Tab이 끝을 지나 `body`에 놓였을 때의 붙여 넣기는 대상이 `body`다 | 편집기의 여섯 창(장소 창 포함), 배경 상세 창, 앱의 확인 창 |
| `!text` | 사건의 대상이 글자 칸(`textFields`) 안이 아니다. **진짜 붙여 넣기는 커서가 든 글자 칸을 대상으로 오고, 그 밖의 어떤 포커스(버튼·체크 칸·`select`·아무 데도 없음)에서든 `body`로 온다**(2.6) — 이 값은 "커서가 글자 칸에 있는가"와 같다 | 이름 칸, 숫자 칸, 이미지 검색, 평면의 이름 상자, 앱 머리줄의 검색 칸 — 그 칸의 붙여 넣기 그대로다(그림만 든 클립보드면 아래의 한 줄) |
| `!dragging` | 평면의 누름도 문서의 제스처도 없다 | 끄는 도중의 Ctrl+V |

- **포커스가 어느 버튼에 있는가는 보지 않는다 — 볼 수도 없다**(2.6). 앱의 사이드바에서 '배경'을 눌러 막 들어온 때(포커스는 그 버튼에 있다)에도 받는다: "아무것도 안 고르고 붙여 넣으면 도면 전체에 들어간다"가 그 순간에도 맞다. 치르는 값은 13.3.
- **핸들러가 읽는 것**(가짜 사건도 같은 길을 지난다): `event.target`(**글자 칸 안인가** — 그것만), `event.clipboardData.items[i].kind`와 `getAsFile()`로 꺼낸 파일의 `type`, `event.clipboardData.types`(`'text/plain'`이 있는가 — 아래의 한 줄에만). `document.activeElement`·`isTrusted`는 보지 않는다. 검사는 진짜 사건이 가는 곳으로 보낸다: 글자 칸의 줄에서는 그 칸에, **그 밖에는 늘 `document.body`에**(10.3).
- **글자 칸에 커서가 있는데 그림만 든 클립보드**(K18): 어긋난 것이 `text` 하나뿐이고, 그 칸이 편집기 안이고, `'text/plain'`이 없을 때 — ① 이벤트에 그림 파일이 있으면 곧바로, ② **파일 항목이 하나도 없으면 메인 프로세스에 물어**(4.4) 클립보드에 그림 파일이 있을 때(탐색기에서 복사한 파일이 이벤트에 실려 오지 않는 환경 — 한솔이 말한 '복사 붙여넣기'가 그 길일 수 있다) 알림 줄에 `MAP_IMAGE_FIELD_NOTE`를 적는다 — `글자 칸에 커서가 있어서 그림을 넣지 않았어요. 넣을 공간이나 카메라를 한 번 누른 뒤(도면 전체에 넣으려면 빈 곳을 누른 뒤) 다시 붙여 넣어 주세요.` 사건은 건드리지 않는다(그 칸은 그림을 받지 않으니 아무것도 붙지 않는다). 글자가 함께 든 클립보드(엑셀의 셀)는 그 칸에 글자가 붙고 이 줄은 없다. 편집기 밖의 글자 칸에서는 말하지 않는다.
- **저장이 도는 동안 도면을 누른 뒤의 붙여 넣기는 넣지 않는다**(K20). 저장 실행이든 '도면 저장'이든, 편집기가 잠긴 동안 평면을 누르면 그 누름은 버려지고 고른 것이 그대로다(:837 — `pointerDown`의 첫 가드 `if (!current || disabled || …)`, 보기 모드에서도). 창 단위의 `pointerdown`(캡처)이 **평면(SVG) 안의 주 버튼 누름마다** 그때 잠겨 있었는가를 `pressMissed`에 적는다 — 받아들여진 누름은 그 값을 지운다. 붙여 넣기(`pasteImages` — 이벤트의 그림과 메인 프로세스의 경로, 두 길 모두)는 그 값이 켜져 있으면 넣지 않고, 값을 끄고, 알림 줄에 `MAP_IMAGE_PRESS_NOTE`를 적는다: `저장하는 동안 도면을 누른 것은 골라지지 않았어요. 넣을 곳을 다시 누른 뒤 붙여 넣어 주세요.` 한 번뿐이다 — 다시 붙여 넣으면 지금 고른 것에 들어간다. 놓기와 버튼은 이 값을 보지 않는다(덮개와 머리줄이 대상을 먼저 보인다). 3D와 오브젝트 목록의 고르기는 잠긴 동안에도 듣는다(:481-483의 `function select(` — `disabled`를 보지 않는다) — 값은 평면의 누름만 적는다.

**이벤트에서 그림으로 치는 것**: `clipboardData.items` 가운데 `kind === 'file'`인 것을 `getAsFile()`로 꺼낸 파일들. 그 가운데 **형식이 `image/`로 시작하는 것이 하나라도 있으면** 이 붙여 넣기는 넣기다 — `preventDefault()`하고 그 파일들을 모두 `pasteImages`에 준다(놓친 누름이 없으면 그대로 `addImages`로 간다. 받을 수 없는 것은 4.6의 까닭과 함께 목록에 적힌다). 파일은 있는데 그림이 하나도 없으면(탐색기에서 복사한 `.psd`가 이벤트에 실려 온 경우) **말없이** 아무 일도 없다. 글자 항목은 넣기를 가르지 않는다: 글자와 그림이 함께 든 클립보드(엑셀의 셀, 문서의 그림)도 그림이 있으면 넣기다. 글자가 있으면 넣지 않는 방법은 쓰지 않는다 — 어떤 프로그램이 그림에 글자를 곁들이는지 재 볼 수 없고(검사는 진짜 클립보드를 쓰지 않는다), 틀리면 붙여 넣기가 말없이 안 된다(13.3, 실기 4).

**파일 항목이 하나도 없으면** 메인 프로세스에 클립보드의 그림 파일 경로를 묻는다(4.4). 없으면(`null`) 말없이 끝난다 — 글자를 복사해 둔 채 누른 Ctrl+V는 아무 일도 하지 않는다. 있으면 그 경로 하나를 `{ kind: 'path' }`로 넣는다: `.png`·`.jpg`·`.jpeg`는 `backgroundReadImageFile` → `backgroundUploadImage`로 올라가고 **원본 경로가 배경에 적힌다**. `.webp`는 `webp-path`, `.gif`·`.bmp`는 `type`의 까닭으로 목록에 적힌다(말없이 끝나지 않는다). 이 길로 들어간 넣기의 알림 줄은 끝에 `탐색기에서 복사한 파일은 한 번에 한 장만 들어와요. 여러 장은 끌어다 놓아 주세요.`를 덧붙인다(7.4) — 그 클립보드 형식에는 첫 파일의 경로만 있어서, 여러 개를 복사했는지 알 수 없다.

대상은 고른 것이고, 아무것도 고르지 않았으면 도면이다(3.2). 넣기가 도는 중이면 까닭을 말한다.

### 4.4 새 채널 — `background:read-clipboard-file` (읽기 전용)

클립보드에 있는 **그림 파일의 경로 하나**를 돌려준다. 파일을 읽지도, 서버에 가지도 않는다. 권한(`canManage`)은 여기서 보지 않는다 — 내 PC의 경로 글자일 뿐이고, 그 파일을 읽는 다음 채널(`background:read-image-file`)이 읽기 전후에 본다. 세션 epoch는 다른 배경 채널처럼 본다.

| 곳 | 고치는 것 |
|---|---|
| `electron/clipboardFiles.ts` | 순수 함수 하나(테스트가 가짜 읽개를 준다): `export function clipboardImageFilePath(readBuffer: (format: string) => Buffer): string \| null { try { const target = parseFileNameWBuffer(readBuffer('FileNameW')); return target && imageMimeForPath(target) ? target : null; } catch { return null; } }` — 형식 이름은 `'FileNameW'`다(`'CF_HDROP'`는 늘 빈 버퍼). 첫 파일이 그림 확장자(png·jpg·jpeg·webp·gif·bmp)일 때만 그 경로, 아니면 `null` |
| `electron/backgroundIpc.ts` | `BackgroundIpcDependencies`에 `readClipboardFilePath?(): string \| null;`. 핸들러: `deps.ipc.handle('background:read-clipboard-file', async (_event, requestEpoch) => { originFor(requestEpoch); const filePath = deps.readClipboardFilePath?.() ?? null; return filePath ? { filePath } : null; });` |
| `electron/main.ts` | `registerBackgroundIpc({ … })`(:2557-2564)에 `readClipboardFilePath: () => clipboardImageFilePath(format => clipboard.readBuffer(format)),` 한 줄. import에 `clipboardImageFilePath`(:101). **`clipboard:read-image-file`(:4459-4476)은 한 글자도 고치지 않는다** |
| `electron/preload.ts` | `backgroundReadImageFile` 줄(:498) 다음에 `backgroundReadClipboardFile: () => ipcRenderer.invoke('background:read-clipboard-file', canonicalSessionEpoch),` |
| `src/types/index.ts` | `backgroundReadImageFile` 줄(:1063) 다음에 `backgroundReadClipboardFile: () => Promise<{ filePath: string } \| null>;`와 `backgroundPickImages?: () => Promise<File[] \| undefined>;`(4.5 — 미리보기 mock만 갖는다) |
| `src/mocks/devElectronAPI.ts` | 9.4 |

화면은 받은 경로를 그대로 `backgroundReadImageFile`에 넘긴다. 그 채널의 거절(없는 파일, 20MB 초과, 손상, 권한)은 그 그림의 실패 까닭이 된다(5.5). 이 채널을 부르는 곳은 `pasteClipboardFile` 하나이고, 붙여 넣기 한 번에 많아야 한 번이다: 글자 칸 밖에서는 이벤트에 파일 항목이 없을 때, 편집기의 글자 칸에서는 이벤트에 파일도 글자도 없을 때(그때는 경로를 쓰지 않고 "그림 파일이 있다"만 읽는다 — K18).

### 4.5 ＋ 이미지 추가

이미지 목록 머리줄의 버튼(7.2)이다. 편집 권한이 있는 계정에만 있고, 보기 모드와 편집 중 모두에서 듣는다.

```tsx
  const input = useRef<HTMLInputElement>(null);
  /** ＋ 이미지 추가. The files come from the page's own file dialog. Only the mock of the preview has `backgroundPickImages`: what it answers is taken as it is, an empty list too, and the dialog opens only when it answers nothing at all. */
  const pickImages = () => {
    const mock = window.electronAPI.backgroundPickImages;
    if (!mock) { input.current?.click(); return; }
    void mock().then(files => { if (files) onAddFiles?.(files); else input.current?.click(); });
  };
```

- 파일은 감춘 입력의 `onChange`에서 받는다. 태그는 글자 그대로다(R3-6) — **목록을 먼저 읽고, 그 다음에 값을 비운다**(차례가 바뀌면 늘 빈 목록이다. BackgroundAssetDialog.tsx:251-255의 차례다). 설치된 앱에서 이 버튼이 도는 길은 이 한 줄뿐이고, 검사 창에서는 mock이 대신 답해 이 줄을 지나지 않으므로 10.3의 V6b가 이 입력에 직접 파일을 넣어 본다. 고른 파일에는 원본 경로가 있다.

```tsx
          <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="추가할 그림 파일" tabIndex={-1} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) onAddFiles?.(files); }} />
```

- **파일을 얻는 길은 이 함수 하나이고, 파일 창을 여는 줄은 이 함수의 둘뿐이다**(이 파일에 `input.current?.click()`은 정확히 두 번 — R3-6). 앱의 preload에는 `backgroundPickImages`가 없어(넣지 않는다) 첫 가지로 곧바로 파일 창이 열린다 — 누름과 같은 틱이다. 미리보기 mock만 그 호출을 갖는다: 훅의 `pick`이 있으면 그 파일들을, **앱 엔진의 검사 창이면 훅이 없어도 빈 목록을**, 브라우저 탭이면 `undefined`를 준다(9.4). 빈 목록은 "고른 것이 없다"이지 "파일 창을 열어라"가 아니다 — `if (files)`를 `if (files?.length)`로 쓰면 검사 창에서 파일 창이 뜬다.
- 편집기는 `onAddFiles`로 받은 파일을 `addImages(files.map(file => ({ kind: 'file' as const, file, path: mapImageFilePath(file), pasted: false })))`로 넘긴다(`addPickedImages`).
- 막힌 대상이거나 넣기가 도는 중이면 버튼은 `aria-disabled`이고 누름은 아무 일도 하지 않는다(파일 창을 열고 나서 거절하지 않는다). 풍선(`title`): 되면 3.3의 제목(`‘2-1 교실’의 배경으로 추가`), 막혔으면 `` `${title}. ${detail}` ``.

### 4.6 받는 파일 — `sortMapImageFiles` · 이름

들어온 차례대로 한 건씩, 아래 순서로 본다.

| # | 조건 | 결과 |
|---|---|---|
| 1 | 이 목록에서 **앞에 온 어느 파일**(받았든, 거절했든, 넘쳐서 빠졌든)과 같은 파일 | **말없이 한 번으로 친다**(거절된 파일도 목록에 한 번만 적히고, 넘친 파일의 겹침은 `over`에 다시 세지 않는다). 둘 다 경로가 있으면 경로가 같을 때(앞뒤 공백 제외, `/`와 `\` 구분 없음, 대소문자 구분 없음). 둘 다 경로가 없고 **둘 다** 붙여 넣은 것이 아니면 이름·크기·고친 시각이 **모두** 같을 때(이름만 같고 크기가 다르면 다른 파일이다). 그 밖 — 한쪽만 경로가 있다, 한쪽이라도 붙여 넣은 자료다 — 은 다른 파일이다 |
| 2 | 메인 프로세스가 읽을 파일(`byPath`)이고 형식이 `image/webp` | 거절 `webp-path` — `WebP 파일은 복사해서 붙여 넣을 수 없어요. 끌어다 놓거나 '＋ 이미지 추가'로 넣어 주세요.` |
| 3 | 형식이 PNG·JPEG·WebP가 아니다 | 거절 `type` — `PNG·JPG·WebP 그림만 넣을 수 있어요.`(덮개가 같은 까닭에 하는 말 그대로다, 3.3) |
| 4 | 20MB를 넘는다(정확히 20MB는 받는다) | 거절 `size` — `20MB보다 큰 그림은 넣을 수 없어요.` |
| 5 | 받은 것이 이미 10장 | `over`에 하나 더한다(목록에 이름을 적지 않는다 — 알림 줄이 `한 번에 10장까지예요. 나머지 N장은 넣지 않았어요.`라고 한다). **맨 뒤에 묻는다**: 열 장 뒤에 온 `.psd`는 넘친 것이 아니라 형식이 맞지 않는 것으로 적힌다 |
| 6 | 그 밖 | 받는다 |

두 거절의 문장은 '배경 등록' 창의 것(`PNG, JPG, WebP 이미지를 선택해 주세요.` · `이미지는 20MB 이하로 등록해 주세요.` — 파일을 고르는 창의 말이다, BackgroundUI.tsx:130, :132)과 다르다. 올리기 함수의 그 두 문장은 이 기능에서 뜨지 않는다: 같은 조건을 여기서 먼저 거른다.

**규칙이 읽는 꼴**(`MapImageFileFacts`)은 `mapImageSourceFacts(source)`가 만든다. 페이지의 파일은 `File`의 이름·형식·크기·고친 시각 그대로이고 `path`·`pasted`는 넘겨받은 값, `byPath`는 거짓이다. 경로로만 아는 파일(`mapImagePathFacts(path)`)은 `path`가 앞뒤 공백을 지운 경로, 이름이 마지막 `\`·`/` 뒤의 조각, 형식이 **소문자로 바꾼** 마지막 확장자에서 온다(`png` → `image/png`, `jpg`·`jpeg` → `image/jpeg`, `webp`, `gif`, `bmp`. 탐색기의 `사진.PNG`도 PNG다. 그 밖은 빈 글자). 크기와 고친 시각은 0이고(20MB는 메인 프로세스가 본다) `byPath`·`pasted`는 참이다.

**이름**(`mapImageBaseName` → `uniqueMapImageName`):

| 경우 | 이름 |
|---|---|
| 붙여 넣은 자료(붙여 넣었고, 경로가 없고, 파일 이름이 엔진이 붙인 `image.png`·`image.jpg`·`image.jpeg`·`image.webp` — **소문자 그대로일 때만**. `IMAGE.PNG`는 제 이름이다) | `붙여 넣은 그림 HH:MM`(넣는 순간의 이 PC 시각, 24시간, 두 자리씩 — `붙여 넣은 그림 09:07`) |
| 그 밖 — 붙여 넣었어도 제 이름이 있거나(`교실.png`) 경로가 있으면 여기다 | 파일 이름(없으면 경로의 마지막 조각)에서 **마지막 점과 그 뒤**를 떼고 앞뒤 공백을 지운 것. `교실_낮.v2.png` → `교실_낮.v2`, ` 교실 .png` → `교실`. 비면(`.png`) `이름 없는 그림`. 점이 없으면 이름 그대로다. 확장자 없이 점이 든 이름도 마지막 점 뒤가 떨어진다(`화면 14.05.33` → `화면 14.05`) — 디스크에서 온 받는 파일에는 늘 확장자가 있어서(형식이 확장자에서 온다) 손으로 만든 파일에서만 생긴다 |
| 160자를 넘는다 | 160자에서 자르고(글자의 반쪽 — 대리 쌍 — 에서 자르지 않는다) 끝에 남은 공백을 지운다 |
| **같은 장소의** 배경, 또는 **이 넣기의 앞 그림**과 이름이 글자 그대로 같다(다른 장소의 같은 이름은 상관없다) | ` (2)`, ` (3)`…을 붙인다 — 한 넣기 안의 같은 이름 둘도 `교실`·`교실 (2)`가 된다. 붙인 뒤에도 160자 안이다: 자리를 내려고 자를 때도 대리 쌍을 가르지 않고, **자른 끝에 남은 공백을 지운다**(번호 앞의 공백이 둘이 되지 않는다) |

---

## 5. 넣기 한 번 — 계획 · 올리기 · 저장 실행

### 5.1 계획 — `planMapImageAdd`

넣기가 시작되는 순간의 라이브러리에서 한 번 세운다. id는 여기서 모두 만든다(`newId` — 편집기는 `crypto.randomUUID`를 준다).

| 값 | 정하는 법 |
|---|---|
| `placeId` · `placeName` · `newPlace` | `ready`면 대상의 장소와 그 이름. 장소 창의 답이 '기존 장소'면 그 장소와 그 이름. '새 장소'면 `newPlace = { id: newId(), revision: 1, name: (앞뒤 공백을 지우고 160자로 자른 이름 — 비면 `새 장소`), parentId: target.parentPlaceId, folderPath: '' }`이고 `placeId`는 그 id, `placeName`은 그 이름 |
| `place` | 늘 있다 — 넣기가 기대는 장소 연결이다(3.4): `{ nodeId: target.placeNodeId, was }`. `was`는 `ready`면 그 장소(`target.placeId` — 이미 이어져 있다), `needs-place`였으면 `target.placeWas` |
| `cameraId` · `cameraPlaceId` | `ready`면 대상의 것. `needs-place`였으면: 대상이 카메라이고 임자가 공간(카메라의 공간)일 때 `cameraPlaceId = placeId`, 임자가 도면이면 `null`. 대상이 공간·도면이면 늘 `null` |
| `items` | 받은 파일 가운데 새로 만들 것마다 `{ index, viewId: newId(), name }` — 이름은 4.6, 겹침은 그 장소의 배경 이름과 앞의 `items`에서 본다. **`index`는 넘겨받은 목록(`files`)에서의 자리다** — 받은 것끼리의 차례도, `items` 안의 차례도 아니다. 컨트롤러가 그 번호로 올릴 파일을 집는다(`sources[item.index]`): `[스케치.psd, 교실.png, 복도.png]`의 `items`는 `index` 1과 2다(0과 1이면 `.psd`가 '교실'로 올라간다) |
| `reused` | 받은 파일 가운데 **경로가 있고, 같은 장소에 그 경로를 `sourceImagePath`로 가진 수정본이 있는 배경**(`findSameSourceView` — 경로 비교는 4.6의 1번과 같다. 작업 파일의 옛 자리인 `filePath`는 보지 않는다)의 id. 새 장소면 비어 있다(막 만든 id 아래에는 배경이 없다). 같은 id는 한 번만. `reusedNames`는 그 배경들의 이름이다(라이브러리의 것, 같은 차례 — 알림 줄이 첫 이름을 말한다) |
| `refused` · `over` | `sortMapImageFiles`의 것(이름을 붙여서. `refused[].index`도 넘겨받은 목록에서의 자리다) |

- `needs-place`인데 답(`choice`)이 없거나, '기존 장소'로 답한 id가 라이브러리에 없으면 **던진다**(편집기는 그렇게 부르지 않는다 — 창이 같은 틱에 같은 목록으로 확인한 값이다, 6.3).
- `newId`를 부르는 차례는 새 장소(있을 때) → `items`의 차례다. `buildMapImageView`는 변형, 수정본의 차례로 두 번 부른다.

### 5.2 컨트롤러 — `useMapImageAdd.ts` (새 파일)

React 상태만 쥔다(`localStorage` 없음). 편집기가 부르고, 이미지 목록이 `view`를 그린다. 저장소는 **기다린 뒤의 값**을 읽으려고(`useBackgroundStore.getState()`), 그리고 실패한 저장이 켠 오류 줄을 끄려고(`setState` 한 줄 — `hush`) 직접 쓴다.

```ts
/** A picture on its way in: a file of the page (dropped, pasted or picked), or a file the main process reads from its path (copied in Explorer). */
export type MapImageSource = { kind: 'file'; file: File; path: string; pasted: boolean } | { kind: 'path'; path: string };
/** How the link to the map was made, and whether all of it could be. */
export type MapImageLinked = { how: 'none' | 'draft' | 'saved'; complete: boolean };
/** `id` is the id of the background the picture becomes: the list draws a saved one as its ghost until the batch ends. */
export type MapImageJob = { id: string; name: string; step: MapImageStep; imageUrl: string };
/** `live`: a batch that reached its save run, with what it tied to the map. The line of such a batch is written anew at every draw, from how it stands by then (mapImageOutcomeNow): its link still to be saved, saved since or taken back, its pictures deleted. */
export type MapImageNotice = { mapId: string; text: string; failed: { name: string; reason: string }[]; live?: { outcome: MapImageOutcome; link: MapImageLink } };
/** What the image list draws. `mapId`: the map the running batch belongs to. `recent`: added since the screen was opened, newest first. `marked`: those that still wear 추가됨.
 *  `seq`: goes up when a batch starts and when `say` speaks, the two moments the line is brought into view. Never as a batch ends. */
export type MapImageAddView = { mapId: string | null; running: boolean; jobs: MapImageJob[]; notice: MapImageNotice | null; recent: readonly string[]; marked: readonly string[]; seq: number };
export const MAP_IMAGE_IDLE: MapImageAddView = { mapId: null, running: false, jobs: [], notice: null, recent: [], marked: [], seq: 0 };
export function mapImageFilePath(file: File): string;                      // getPathForFile; '' when it throws or has none
export function useMapImageAdd(deps: {
  execute(command: BackgroundCommand): Promise<void>;
  /** The editor is at rest: nothing is dragged, drawn or being named, it runs nothing of its own, no dialog is open. */
  idle(): boolean;
  lock(on: boolean): void;
  link(mapId: string, link: MapImageLink, library: BackgroundSnapshot): Promise<MapImageLinked>;
}): { view: MapImageAddView; start(plan: MapImagePlan, sources: readonly MapImageSource[]): void;
  say(mapId: string, text: string, failed?: { name: string; reason: string }[]): void; dismiss(): void };
```

훅의 본문 — 앵커 R3-3이 이 줄들을 글자로 본다.

```ts
  const [view, setView] = useState<MapImageAddView>(MAP_IMAGE_IDLE);
  const latest = useRef(deps); latest.current = deps;        // after a wait: the functions of the editor as it is rendered now
  const alive = useRef(true), running = useRef(false);        // refs: a second batch can be asked for before `view` is drawn
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // 추가됨 leaves by itself. Timed here, not in CSS: with reduced motion a CSS timer ends on its first frame.
  useEffect(() => {
    if (!view.marked.length) return;
    const timer = window.setTimeout(() => setView(now => ({ ...now, marked: [] })), MAP_IMAGE_ADD.addedMarkMs);
    return () => window.clearTimeout(timer);
  }, [view.marked]);

  async function run(plan: MapImagePlan, sources: readonly MapImageSource[]) {
    if (running.current) return;
    running.current = true;
    const actor = useBackgroundStore.getState().actorId;
    /** The screen was left or the account changed: nothing more is sent, nothing more is drawn. */
    const gone = () => !alive.current || useBackgroundStore.getState().actorId !== actor;
    /** The library's own error line is not left up for a save of this feature: the line of the image list says why, in plain words. Never once the screen was left: the store may be another session's by then. */
    const hush = () => { if (!gone()) useBackgroundStore.setState({ error: null }); };
    const step = (id: string, patch: Partial<MapImageJob>) => setView(now => ({ ...now, jobs: now.jobs.map(job => job.id === id ? { ...job, ...patch } : job) }));
    const failed = plan.refused.map(item => ({ name: item.name, reason: MAP_IMAGE_REFUSAL_TEXT[item.reason] }));
    const uploads: { viewId: string; name: string; imageUrl: string; sourceImagePath: string }[] = [], added: string[] = [];
    let tie: Pick<MapImageOutcome, 'link' | 'partial' | 'linkCause'> = { link: 'none' }, link: MapImageLink | null = null;
    setView(now => ({ ...now, mapId: plan.mapId, running: true, jobs: plan.items.map(item => ({ id: item.viewId, name: item.name, step: 'ready', imageUrl: '' })),
      notice: { mapId: plan.mapId, text: mapImageBusyText(plan.scope, plan.targetName, plan.items.length + plan.reused.length), failed: [] }, seq: now.seq + 1 }));
    try {
      // 1. The previews, one after another. The editor stays in use.
      for (const item of plan.items) {
        const source = sources[item.index];
        step(item.viewId, { step: 'uploading' });
        try {
          const imageUrl = source.kind === 'file' ? await uploadBackgroundImage(source.file) : await uploadFromPath(source.path);
          if (gone()) return;
          uploads.push({ viewId: item.viewId, name: item.name, imageUrl, sourceImagePath: source.path });
          step(item.viewId, { step: 'waiting', imageUrl });
        } catch (cause) {
          if (gone()) return;
          failed.push({ name: item.name, reason: mapImageCauseText(cause) }); step(item.viewId, { step: 'failed' });
        }
      }
      if (uploads.length || plan.reused.length) {
        // 2. The saves, in one run during which the editor is locked as during any save. It starts only when nothing is dragged,
        // nothing is being saved and no dialog is open: starting it never cancels a drag.
        const quiet = () => { const store = useBackgroundStore.getState(); return !store.loading && !store.pending && latest.current.idle(); };
        while (!quiet()) { await sleep(120); if (gone()) return; }
        latest.current.lock(true);
        try {
          /** One command. A reply that was lost is no failure when the library that was read again holds what was saved. */
          const save = async (command: BackgroundCommand, held: (library: BackgroundSnapshot) => boolean) => {
            try { await latest.current.execute(command); return ''; }
            catch (cause) { hush(); return !gone() && held(useBackgroundStore.getState().snapshot) ? '' : mapImageCauseText(cause); }
          };
          let stopped = '';
          for (const command of mapImageSaves(plan, uploads, new Date().toISOString(), uuid)) {
            if (command.type !== 'save') continue;
            const id = command.entity.id, job = uploads.find(upload => upload.viewId === id);      // none: the new place, which comes first
            if (stopped) { if (job) { failed.push({ name: job.name, reason: stopped }); step(id, { step: 'failed' }); } continue; }
            if (job) step(id, { step: 'saving' });
            const why = await save(command, library => (command.kind === 'place' ? library.places : library.views).some(item => item.id === id));
            if (gone()) return;
            if (!why) { if (job) added.push(id); continue; }
            if (job) { failed.push({ name: job.name, reason: why }); step(id, { step: 'failed' }); }
            stopped = why;      // what failed this save (the connection, the server, a place that is gone) fails the next one as well: the rest is not sent
          }
          // 3. The link, last: every background it names is in the library by now, and what is gone from it meanwhile is left out by linkMapImages.
          // Asked for only when there is something to tie: not for a new place that could not be saved, and not for a place that was there with no picture put in.
          const library = useBackgroundStore.getState().snapshot;
          link = { place: plan.place, placeId: plan.placeId, cameraId: plan.cameraId, viewIds: [...plan.reused, ...added] };
          if (mapImageLinkWanted(link, library)) {
            try {
              const done = await latest.current.link(plan.mapId, link, library);
              tie = done.how === 'none' ? { link: done.complete ? 'none' : 'missed' } : { link: done.how, partial: !done.complete };
            } catch (cause) { hush(); tie = { link: 'failed', linkCause: mapImageCauseText(cause) }; }
          }
        } finally { latest.current.lock(false); }
      }
      if (gone()) return;
      const outcome: MapImageOutcome = { scope: plan.scope, targetName: plan.targetName, placeName: plan.placeName, added: added.length, reused: plan.reused.length, reusedName: plan.reusedNames[0],
        failed: failed.length, over: plan.over, byPath: sources.some(source => source.kind === 'path'), ...tie };
      // `seq` stays as it is: nothing is scrolled as a batch ends. The plan may be under a drag just then.
      setView(now => ({ ...now, running: false, jobs: [], recent: [...added, ...now.recent], marked: added,
        notice: { mapId: plan.mapId, text: mapImageSummary(outcome), failed, ...(link ? { live: { outcome, link } } : {}) } }));
    } finally {
      running.current = false;
      if (alive.current) setView(now => now.running ? { ...now, running: false, jobs: [], notice: null } : now);
    }
  }
```

- `start(plan, sources)`는 `void run(plan, sources)`다. `say`는 알림 줄만 바꾸고 `dismiss`는 도는 중이 아닐 때 지운다 — `const say = useCallback((mapId: string, text: string, failed: { name: string; reason: string }[] = []) => setView(now => ({ ...now, notice: { mapId, text, failed }, seq: now.seq + 1 })), []);` · `const dismiss = useCallback(() => setView(now => now.running ? now : { ...now, notice: null }), []);`(`useCallback`으로 고정한다 — 이미지 목록의 메모가 깨지지 않게).
- **`seq`가 오르는 곳은 둘뿐이다**: `run`의 첫 `setView`(넣기의 시작)와 `say`. 끝의 `setView`에는 없다 — 넣기가 끝나는 때는 사용자가 고르지 않고, 올리기에서 모두 실패한 넣기는 조용해지기를 기다리지도 않아 도면을 끄는 도중에 끝날 수 있다(K13).
- **저장 하나가 실패하면 남은 것은 보내지 않는다**(`stopped` — K21). 장소든 배경이든 같다: 그 뒤의 그림은 흐린 카드가 `넣지 못했어요`가 되고 같은 까닭으로 목록에 적힌다. 응답만 잃은 저장은 실패가 아니다(`held`) — 멈추지 않는다. 잠긴 시간은 그래서 실패한 저장 한 번(과 아래의 이어 주기 한 번)이다.
- **이어 주기는 멈춘 뒤에도 한다 — 이을 것이 있을 때만**(`mapImageLinkWanted`, 3.4). 그때까지 들어간 그림은 도면에 이어지고(편집 중이면 보내는 것이 없고, 보기 모드면 명령 하나다), 새 장소가 저장되지 않았거나 장소가 있던 대상에 아무것도 들어가지 않았으면 부르지 않는다(`tie`는 `'none'`). 결과는 `link`의 답을 옮긴다 — 도면을 바꾸지 않았으면 `'none'`(다 돼 있고 저장돼 있다) 아니면 `'missed'`(하나도 못 이었다), 바꿨거나 **기대는 연결이 초안의 것이면** `'draft'`, 바로 저장했으면 `'saved'`, 그리고 `partial`(일부만 이었다). 바로 저장이 거절되면 `'failed'`와 그 까닭이다.
- **끝난 넣기는 연결(`link`)을 알림에 싣는다**(`live` — 저장 실행에 들어간 넣기는 모두). 목록이 그릴 때마다 그것으로 지금의 모습을 읽는다(`mapImageOutcomeNow` — 7.4): 초안의 연결이 저장됐는가·되돌려졌는가, 넣은 그림이 지워졌는가.
- **`hush` — 이 기능이 보낸 저장은 라이브러리의 붉은 줄을 남기지 않는다.** 저장소는 보낸 뒤에 실패한 명령마다 `error`에 받은 글(껍데기가 붙은 글)을 적어 그 줄을 켠다(2.4). 실패를 받은 그 자리에서 `error`를 비운다 — 배경의 저장(`save`의 `catch`)과 보기 모드의 이어 주기(`link`의 `catch`), 두 곳이다. 까닭은 알림 줄이 다듬어 말하고, 도면은 줄지도 밀리지도 않는다. **화면을 떠난 뒤에는 건드리지 않는다**(`gone()` — 그때의 저장소는 새 화면의 것일 수 있다). 지워지는 것은 방금 받은 실패의 글이다(보낸 명령은 시작할 때 `error`를 비운다, useBackgroundStore.ts:49). 보내기 전에 거절된 명령(:45-48)에서는 저장소가 아무것도 적지 않았으므로, 그때 지워지는 것이 있다면 앞선 **읽기** 실패의 글이다 — 연결이 그대로 끊겨 있으면 다음 읽기(15초 안)가 다시 켠다(오늘과 같다. 이 기능의 것이 아니다).
- `uploadFromPath(path)`: `const read = await window.electronAPI.backgroundReadImageFile(path), result = await window.electronAPI.backgroundUploadImage(read.dataUrl); if (!result.ok || !result.url) throw new Error(result.error || '이미지를 올리지 못했습니다. 다시 시도해 주세요.'); return result.url;`(BackgroundAssetDialog.tsx:175-178의 순서 그대로). `mapImageFilePath(file)`의 본문은 `try { return window.electronAPI.getPathForFile(file) || ''; } catch { return ''; }` 한 줄이다.
- `uuid`는 `() => crypto.randomUUID()`, `sleep(ms)`는 `window.setTimeout`의 Promise다. **편집기의 함수는 `latest.current`로 부른다** — 기다린 뒤에는 그때 그려진 편집기의 `idle`·`link`다(R6).

### 5.3 무엇을 어떤 차례로 보내는가

| 차례 | 보내는 것 | `expectedRevision` | 편집기 |
|---|---|---|---|
| 1. 올리기 | 그림마다: 파일이면 `uploadBackgroundImage(file)`(화면에서 다시 그려 `background:upload-image`), 경로면 `background:read-image-file` → `background:upload-image`. **하나씩, 들어온 차례대로** | — | **그대로 쓴다**: 옮기고, 고르고, 편집하고, '도면 저장'도 된다(`pending`·`busy`를 건드리지 않는다) |
| (기다림) | 120ms마다 본다: 저장소가 읽는 중·저장 중이 아니고 편집기가 쉬는가(`idle` — 9.3) | — | 흐린 카드가 `저장 기다리는 중` |
| 2-가. 새 장소 | `{ type: 'save', kind: 'place', entity: plan.newPlace, expectedRevision: null }`(있을 때만, **맨 먼저**) | `null` | 잠김(`lock(true)` = 속성 칸에서 치던 것을 확정하고 `setBusy(true)` — 9.3) |
| 2-나. 배경 | 올라간 그림마다 `{ type: 'save', kind: 'view', entity: buildMapImageView(…), expectedRevision: null }` — `items`의 차례대로 | `null` | 잠김 |
| 3. 이어 주기 | `link(mapId, { place, placeId, cameraId, viewIds: [...reused, ...added] }, 저장소의 지금 라이브러리)` — 이을 것이 있을 때만(`mapImageLinkWanted`), 5.4 | 5.4 | 잠김. 끝나면 `lock(false)`(`finally`) |

- **잠그는 줄과 첫 명령 사이에는 기다림이 없다**: `quiet()`가 참인 그 틱에 `lock(true)`를 부르고 곧바로 첫 `execute`(저장소가 그 자리에서 `pending`을 켠다)가 나간다. 그 사이에 누름이 끼어들 수 없다(`lock`이 칸을 떠나게 하는 것도 그 틱 안의 일이다 — 떠나며 확정된 값은 이어 주기가 읽는 초안에 들어 있다). 조용한지를 본 뒤이므로 **시작이 끌기를 취소하지 않는다.** 잠긴 동안의 누름은 여느 저장 때처럼 받지 않는다(:837) — 그 누름 뒤의 붙여 넣기는 K20.
- **배경의 저장이 하나 실패하면 그 뒤의 것은 보내지 않는다**(5.2의 `stopped`). 새 장소가 실패해도 같다.
- 명령 사이에도 기다림 뒤 곧바로 다음 명령이 나가, 다른 저장이 끼어들 틈이 없다(저장소가 `pending`을 끈 것과 같은 마이크로태스크 줄이다). 띠는 그동안 `저장 중…`이다.
- 배경 하나의 모습(`buildMapImageView`): `{ id: viewId, revision: 1, name, placeId, cameraPlaceId, visiblePlaceIds: [], relatedPlaceIds: [], shot: 'wide', tags: [], memo: '', variants: [{ id, name: '낮', time: 'day', workFilePath: '', activeRevisionId, revisions: [{ id, imageUrl, filePath: '', sourceImagePath, createdAt }] }] }` — `shot`·변형의 `name`·`time`은 `MAP_IMAGE_DEFAULTS`의 값이다(흐린 카드가 같은 두 낱말을 보인다, 7.3). `cameraPlaceId`는 계획의 값 그대로이고 `relatedPlaceIds`에 넣지 않는다. `sourceImagePath`는 원본 경로(없으면 `''`, 4096자를 넘으면 `''`), `createdAt`은 저장 실행을 시작한 시각의 ISO 글자.
- `mapImageSaves`는 **올라간 그림의 배경만** 만든다(`uploads`에 있는 `viewId`). 올리지 못한 그림의 명령을 내면 컨트롤러가 그것을 일거리 없는 명령 — 새 장소 — 처럼 다뤄, 그림 없는 배경이 말없이 저장된다.

### 5.4 이어 주기 — 편집기의 `linkAddedImages`

```ts
  /** Added pictures are tied to the map: the place of a space or of the map, the views of a camera. That is a change of the drawing: with a draft open it goes into the draft, as one undo step; with none it is saved at once, as a save of that map alone. */
  async function linkAddedImages(mapId: string, link: MapImageLink, library: BackgroundSnapshot): Promise<MapImageLinked> {
    const saved = library.maps.find(map => map.id === mapId), held = mapDraft(doc.getState(), mapId);
    // A draft with nothing unsaved in it goes on from the library first. While this save run held the lock it could not follow, and a link put on the revision before would have the map refused at its next save.
    if (held && saved && !mapDraftChanged(held) && saved.revision > (held.baseRevision ?? Infinity)) doc.rebaseDrafts([saved]);
    const draftNow = mapDraft(doc.getState(), mapId), base = draftNow?.value ?? saved;
    if (!base) return { how: 'none', complete: false };
    const next = linkMapImages(base, link, library);
    // Nothing to change. What the pictures stand on may still be the draft's alone (a place tied since the last save): then it is kept by 도면 저장, like any edit.
    if (next.map === base) return { how: draftNow && next.complete && mapImageLinkNow(saved, base, link, library) === 'draft' ? 'draft' : 'none', complete: next.complete };
    if (!draftNow) { await persistMaps(saveMapChanges(library, doc.getState().drafts, [next.map])); return { how: 'saved', complete: next.complete }; }
    updateMap(next.map);
    return mapDraft(doc.getState(), mapId)?.value === next.map ? { how: 'draft', complete: next.complete } : { how: 'none', complete: false };
  }
```

| 그 순간의 문서 | 일어나는 일 | 알림 줄(7.4) |
|---|---|---|
| 그 도면에 **초안이 있다**(편집 중 — 지금 보는 도면이 아니어도) | 초안에 `updateMap` **한 번**: 되돌리기 한 단계, 띠의 수 +1. 장소 이어 주기와 카메라의 시점들이 그 한 단계에 함께 든다. 저장은 '도면 저장' 때 | `…도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` — 그 뒤로는 그 연결의 지금 모습을 따른다(7.4) |
| 초안이 **없다**(보기) | `persistMaps(saveMapChanges(library, 초안들, [그 도면]))` — **그 도면 하나**, 이어 준 키만 달라진 값, `expectedRevision`은 라이브러리의 버전. 편집 모드에 들어가지 않고 띠가 뜨지 않는다(`persistMaps`는 초안이 없던 도면에 초안을 열지 않고 저장 알림도 켜지 않는다). 응답을 잃어도 저장소가 알아본다(`mapSaveWasApplied`) | `도면에 이어 준 것까지 바로 저장됐어요.` |
| 새로 이을 것이 없다(장소가 있는 공간·도면) · 이미 다 이어져 있다 — **그 연결이 저장된 도면에도 있다** | 같은 객체 → **도면을 쓰지 않는다.** 단계도 버전도 그대로. `{ how: 'none', complete: true }` | `바로 저장됐어요.` |
| 새로 이을 것이 없는데 **그 연결이 초안에만 있다**(같은 편집에서 앞서 넣은 넣기가 이은 장소, 속성 칸에서 고르고 저장하지 않은 장소 — `mapImageLinkNow`가 `'draft'`) | 같은 객체 → 도면을 쓰지 않고 **되돌리기 단계도 늘지 않는다.** 답은 `{ how: 'draft', complete: true }`다 — 그 그림이 기대는 연결이 '도면 저장'에 달려 있다 | `…도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` — 위의 첫 줄처럼 그 연결의 지금 모습을 따른다(버리면 `…지금은 남아 있지 않아요.`) |
| 초안이 **깨끗한데**(저장 안 한 변경이 없다) 라이브러리의 그 도면이 더 새 버전이다(이 저장 실행이 잠근 동안 다른 PC가 저장했다 — 잠긴 동안에는 따라가기가 돌지 않는다, :349의 `if (disabled \|\| doc.isGestureActive() \|\| dialogOpen) return;`) | **먼저 그 초안을 라이브러리의 도면으로 다시 놓고**(`doc.rebaseDrafts([saved])` — 따라가기의 규칙 그대로: 깨끗하고, 더 새 버전일 때만) 그 위에 잇는다. 놓지 않으면 옛 버전의 초안이 저장 안 한 변경을 갖게 돼 더는 따라가지 못하고, 다음 '도면 저장'이 "다른 사용자가 내용을 변경했습니다"로 거절된다 | 위의 줄들과 같다 |
| 도면이 없어졌다 · 노드가 없어졌거나 잠겼다 · 그 사이 다른 장소가 이어졌다(장소가 있던 대상의 임자도 — 그 그림은 이제 그 공간의 목록에 보이지 않는다) · 카메라의 시점이 1000개에 닿았다 · **이을 배경이나 장소가 그 사이 지워졌다**(올리는 동안 카드에서 지운 '이미 있는 그림', 다른 곳에서 지운 장소) | **될 수 있는 것만 잇는다**(`linkMapImages` — 3.4). 하나도 못 이었으면 `{ how: 'none', complete: false }` → `'missed'`. 일부를 이었으면 `how`는 그대로(`'draft'`·`'saved'`)이고 `complete: false` → `partial`. **그림은 그 장소에 남는다.** 다시 시도하지 않는다 | `다만 도면에 이어 주지는 못했어요. …` / `다만 도면에 다 이어 주지는 못했어요. … 이어 준 만큼은 …` — 끝에 손으로 잇는 길(7.4) |
| 바로 저장이 거절됐다(다른 곳에서 그 도면이 먼저 바뀜, 연결 끊김, 권한을 잃음) | 던진다 → `'failed'`. 그림은 남는다. 저장소가 켠 붉은 줄은 컨트롤러가 끈다(`hush`) | `다만 도면에 이어 주지는 못했어요. 까닭: … 그림은 …` — 끝에 손으로 잇는 길 |

- **언제 초안이고 언제 바로 저장인가는 이 함수가 불리는 순간에 정해진다**(K8). 올리는 동안 '편집 끝내기'를 눌렀으면 바로 저장이고, '편집 시작'을 눌렀으면 초안이다.
- 함수 안에 렌더의 `snapshot`·`current`·`draft`·`maps`가 없다. 라이브러리는 인자(`library` — 컨트롤러가 저장소에서 방금 읽은 것: 마지막 명령이 끝난 뒤라 **확인된** 값이다. 없는 배경·장소를 잇지 않는 검사도, 저장된 도면(`saved`)도 그것에서 읽는다), 문서는 `doc.getState()`다. `updateMap`은 지금의 그 함수다(:541-543).
- **초안을 다시 놓는 것은 `doc.rebaseDrafts`다**(문서의 공개 호출 — `persistMaps`가 쓰는 그것). `doc.followSaved`는 부르지 않는다: 그 호출은 편집기에 하나뿐이어야 하고(앵커 56), 모든 초안을 훑으며 없어진 도면의 초안까지 버린다 — 여기서 다시 놓는 것은 **이어 줄 그 도면 하나**다. 다시 놓인 초안은 되돌리기 기록이 비어 있고(깨끗한 초안이다 — 잃는 것은 따라가기가 잃는 것과 같다: 다 되돌린 뒤의 '다시 실행' 기록), 이어 주기가 그 위의 첫 단계가 된다.
- 잠긴 구간 안이라 제스처가 없다 — 그래도 `update`가 버려졌으면(초안의 값이 `next.map`이 아니면) 이어지지 않은 것으로 답한다. 저장 실패의 편집기 오류 띠(`setError`)는 쓰지 않는다. 까닭은 알림 줄에 간다.

### 5.5 실패 · 끊김 · 겹침

| 경우 | 일어나는 일 |
|---|---|
| 한 장이 올라가지 않았다(형식·20MB — 다시 걸린 경우, 읽을 수 없는 그림, 미리보기가 너무 큼, 연결 끊김, 권한) | 그 장만 실패한다(흐린 카드 `넣지 못했어요`). **나머지의 올리기는 계속 간다**(올리기는 그림마다 따로 실패한다 — 큰 그림, 깨진 파일. 멈추는 것은 저장의 실패다, 아래). 까닭은 `mapImageCauseText(cause)` — 1차의 `mapDeleteCauseText`를 그대로 쓴다(`export const mapImageCauseText = mapDeleteCauseText;`): Electron의 껍데기(`Error invoking remote method …`)를 벗기고, 한글이 없는 글(영어의 연결 오류 등)은 `서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요.` |
| 새 장소가 저장되지 않았다 | 그 장소 아래의 배경은 **하나도 보내지 않는다**(모두 그 까닭으로 실패). 이어 주기도 부르지 않는다(이을 장소가 없다 — `mapImageLinkWanted`). 알림 줄: `넣은 그림이 없어요. N장은 넣지 못했어요(아래 목록).` |
| 배경 한 건의 저장이 실패했다 | **그 장부터 남은 것을 모두 보내지 않는다**(K21) — 그 장과 그 뒤의 장이 같은 까닭으로 목록에 적힌다. 그때까지 들어간 그림은 그 장소에 남고 **이어 준다**(편집 중이면 초안에 — 보내는 것이 없다. 보기 모드면 명령 하나, 실패하면 `다만 도면에 이어 주지는 못했어요. 까닭: …`). 권한을 잃어 멈춘 경우도 같은 길이다: 보기 모드의 이어 주기는 보내기 전에 거절돼 까닭(`배경 관리자가 편집할 수 있습니다.`)이 적히고, 편집 중이면 초안이 받지 않아 `'missed'`다 — 어느 쪽도 "바로 저장됐어요"가 아니다 |
| **보낸 뒤에** 거절되거나 끊긴 명령(그림 한 장의 저장, 보기 모드의 이어 주기) | 까닭은 알림 줄에 다듬어 적힌다. 저장소가 그 명령에 켠 **라이브러리의 붉은 줄**(2.4 — 껍데기가 붙은 글)은 컨트롤러가 그 자리에서 끈다(`hush` — 5.2). 화면에 그려지지 않고, 도면은 줄지도 밀리지도 않는다 |
| 저장의 **응답을 잃었다** | 저장소가 한 번 다시 읽은 라이브러리에 그 id가 있으면 **넣은 것으로 친다**(`held`) — 멈추지 않고 다음 장으로 간다. 없으면 실패다. 다시 보내지 않는다 — 응답과 다시 읽기를 모두 잃은 드문 경우는 13.3 |
| 일부만 됐다 | 된 것만 이어 준다. 알림 줄이 넣은 수와 못 넣은 수(`N장은 넣지 못했어요(아래 목록).`)를 말하고 못 넣은 것을 목록으로 든다 |
| 새 장소는 저장됐는데 배경이 하나도 안 됐다 | 장소는 남고, **그 장소는 그 공간(도면)에 이어진다**(답한 대로다. 다음에 넣을 때 다시 묻지 않는다). 알림 줄은 그림이 들어간 것처럼 말하지 않는다: `넣은 그림이 없어요. … ‘창고’ 장소를 도면에 이어 준 것은 바로 저장됐어요.`(편집 중이면 `… '도면 저장'을 눌러야 남아요.` — 7.4) |
| **화면을 떠났다** · 로그아웃 · 계정 바뀜 · 업데이트 안내 | 편집기가 내려가며 `alive`가 꺼진다. 돌던 기다림이 돌아오는 대로 `gone()`에서 **끝낸다**: 그 뒤로 아무것도 보내지 않는다(저장소가 새 화면의 것으로 다시 열려 있어도 — 계정까지 견준다). 이미 저장된 배경은 그 장소에 남고, 이어 주기는 되지 않았다(같은 파일을 다시 넣으면 K4가 이어 준다). 올리기만 된 미리보기는 저장소에 남는다. **말해 줄 화면이 없다** — 저장은 올리기가 모두 끝난 뒤에야 시작하므로(5.3), 올리는 중에 떠나면 그 넣기의 그림은 **하나도 들어가지 않는다.** 그래서 도는 동안의 알림 줄이 미리 말한다(7.4), 13.2 |
| 도는 중에 한 번 더 넣는다 | **거절한다. 줄 세우지 않는다.** 끌어다 놓기: 덮개가 `지금은 넣을 수 없어요`라고 하고 놓아도 아무 일도 없다(4.2). 버튼: 흐려져 있고 눌리지 않는다. 붙여 넣기: 알림 줄이 `지금은 넣을 수 없어요. 앞에 넣던 그림을 마치는 중이에요. 끝난 뒤에 다시 넣어 주세요.`로 바뀐다(끝나면 결과 문장이 된다) |
| 올리는 동안 다른 도면으로 갔다 | 넣기는 **처음의 도면 id**로 끝까지 간다. 흐린 카드와 알림은 그 도면의 목록에 보인다(7.2) |
| 넣는 동안 그 도면이 없어졌다(다른 PC에서, 또는 1차의 삭제 창으로) | 그림은 그 장소에 들어가고 이어 주기는 `'missed'`다. 흐린 카드와 알림 줄은 **지금 보는 도면의 목록**에 보인다(7.2 — 돌아갈 도면이 없다) |
| 올리는 동안 창을 열었다(도면 설정, 배경 상세…) | 저장 실행은 창이 닫힐 때까지 기다린다(`idle`). 창 밑에서 편집기가 잠기거나 초안이 바뀌지 않는다 — '도면 설정'은 연 때의 도면 값을 통째로 저장하므로, 그 밑에서 초안을 고치면 고친 것이 말없이 덮인다 |

### 5.6 검증을 지나는 증명

14절의 시안이 아래를 진짜 `domain.ts`로 돌렸다(열 가지 대상 × 그림 셋, 초안 있음·없음).

| 단계 뒤의 라이브러리 | `validateBackgroundSnapshot`을 지나는 까닭 |
|---|---|
| 새 장소 | 닫힌 키 다섯(`id`·`revision`·`name`·`parentId`·`folderPath`), 이름 1~160자, `parentId`는 있는 장소이거나 `null`(대상을 정할 때 본 값 — 그 사이 그 장소가 지워졌으면 저장소가 보내기 전에 거절하고, 5.5의 둘째 줄이 된다) |
| 배경 하나씩 | `validateBackgroundEntity('view', …)`: 닫힌 키 그대로, 이름 1~160자(4.6), `placeId`는 방금 저장했거나 이미 있는 장소, `cameraPlaceId`는 있는 장소이거나 `null`, 변형 하나·수정본 하나·`activeRevisionId`가 그 수정본, `imageUrl`은 저장소의 `https://…`(미리보기에서는 data URL), `filePath: ''`, `sourceImagePath` 4096자 이하, `createdAt`은 ISO 글자. 변형 id는 새로 만든 것이라 다른 배경과 겹치지 않는다 |
| 이어 준 도면(바로 저장) | 공간·도면의 `placeId`는 **그 순간 라이브러리에 있는** 장소. 카메라의 `viewIds`는 그 순간 라이브러리에 있는 배경뿐이고(실패한 것은 `added`에 없고, 그 사이 지워진 것은 `linkMapImages`가 뺀다) 겹치지 않으며(없는 것만 더한다) 1000개 이하. 다른 키는 그대로다 |
| 초안에 이어 준 도면을 나중에 '도면 저장' | 같은 까닭. 그 사이 그 배경을 지웠으면 8.5가 초안에서 뺀다 |

---

## 6. 장소를 묻는 창

### 6.1 언제 뜨는가

대상이 `needs-place`이고 받을 수 있는 그림이 한 장 이상일 때, **아무것도 올리기 전에**, 넣기 한 번에 **한 번** 뜬다(4.1). 막힌 대상(잠긴 카메라, 장소 없는 잠긴 공간)에는 뜨지 않는다. 상태는 편집기에 있다 — 1차의 `mapDelete` 상태(:231-234 — `const [mapDelete, setMapDelete] = useState<`부터 `stopped: MapDeletePlan | null } | null>(null);`까지) 바로 다음 줄, `const deleting = useRef(false);`(:235) 앞:

```ts
  /** The question that comes first when the pictures need a place. It holds what it was opened for, and acts on that alone. */
  const [placePrompt, setPlacePrompt] = useState<{ target: Extract<MapImageTarget, { status: 'needs-place' }>; sources: readonly MapImageSource[]; count: number; drafted: boolean } | null>(null);
```

`target`(도면 id·임자의 id·이름·그때 쥔 값)과 `sources`는 **열 때 잡은 것**이고, 답한 뒤의 일은 모두 그것으로 한다. `drafted`는 열 때 그 도면에 초안이 있었는가(안내 문장용)다.

### 6.2 모습과 문구 — `MapImagePlacePrompt` (`BackgroundMapImageAdd.tsx`)

`BackgroundModal`(제목 `배경 장소 정하기`) 안의 `<form>`이다. 문장은 `mapImagePlaceWords(target, count, drafted, parentName)`이 만든다(`parentName` = `target.parentPlaceId`의 장소 이름, 없으면 `null`).

| 자리 | 글자 |
|---|---|
| 첫 문단(`.bmap-dialog-context`) — `lead` + 빈칸 + `ask` | 공간·도로가 임자: `‘창고’에는 아직 배경 장소가 없어요.`(이름만 적는다 — 3.3) · 도면이 임자: `‘별관’ 도면에는 아직 대표 장소가 없어요.` · 대상이 카메라면 앞에 `‘카메라 2’ 카메라가 있는 `이 붙는다(`‘카메라 2’ 카메라가 있는 ‘창고’에는 아직 배경 장소가 없어요.` — 그 공간은 카메라가 서 있는 공간이다, 3.2). 이어서 `그림 3장을 넣을 장소를 정해 주세요. 정한 장소는 ‘창고’의 배경 장소가 돼요.`(도면: `…정한 장소는 이 도면의 대표 장소가 돼요.`) |
| 선택 1(라디오) | **`새 장소 만들기`** + `parent`: `‘학교’ 아래에 만들어져요.` / 부모가 없으면 `맨 위 장소로 만들어져요.` — 고르면 그 아래에 `<Field label="장소 이름"><input maxLength={160} …></Field>`(처음 값 `target.suggestedName`) |
| 선택 2(라디오) | **`기존 장소에서 고르기`** + `배경 목록에 있는 장소 가운데 골라요.` — 장소가 하나도 없으면 라디오가 꺼지고 글이 `아직 등록된 장소가 없어요.` — 고르면 그 아래에 `<Field label="장소"><select>`와 `<PlaceOptions places={places} />`(전체 경로 `학교 / 2-1 교실`, BackgroundUI.tsx:173-196) |
| 안내(`.bmap-hint`) — `note` | 열 때 초안이 있었으면 `장소와 그림은 바로 저장돼요. ‘창고’에 이어 주는 것은 다른 편집처럼 '도면 저장' 때 저장돼요.` · 없었으면 `장소와 그림, ‘창고’에 이어 주는 것까지 바로 저장돼요.`(도면이 임자면 `‘창고’` 자리에 `이 도면`) |
| 오류(`<p className="bg-error" role="alert">`) | `장소 이름을 적어 주세요.` · `넣을 장소를 다시 골라 주세요.` |
| 버튼 줄(`.bmap-modal-actions`) | `취소`(`type="button"`, `bg-button`) · **`이 장소로 넣기`**(`type="submit"`, `bg-button bg-primary`, `data-autofocus`) |

- **기본 선택**: `target.sameNamePlaceId`가 있으면 '기존 장소에서 고르기'에 그 장소가 골라져 있다(초안을 버려 연결만 잃은 뒤 다시 넣을 때 같은 이름의 장소가 둘이 되지 않는다). 그 값은 **같은 부모 아래의 같은 이름이고 어느 도면도 쓰지 않는 장소**일 때만 있다(3.2, K9 — 저장된 도면도, 편집 중인 초안도 본다) — 포커스가 '이 장소로 넣기'에 있으므로, 다른 도면의 '복도'나 옆방이 쓰는 '새 공간'을 골라 두면 Enter 한 번에 남의 장소로 들어가고 그 방의 목록에 서로의 그림이 섞인다. 없으면 '새 장소 만들기'에 임자의 이름이 적혀 있다. 창을 열 때마다 새로 정한다(기억하지 않는다).
- 라디오 묶음은 `<fieldset className="bmap-place-choices"><legend className="sr-only">그림을 넣을 배경 장소</legend>` 안의 `<label className="bmap-place-choice">` 둘이다(`name`은 `useId()`).
- 장소 목록(`places`)은 그리는 순간의 라이브러리다 — 창이 열린 동안 다른 곳에서 지워진 장소는 목록에서 빠지고, 그것을 골라 둔 채 누르면 `넣을 장소를 다시 골라 주세요.`다.

### 6.3 답

```tsx
  // It comes up by itself, after a drop, a paste or the file dialog: a press that was on its way must not answer it. Esc and 취소 are heard at once.
  const armed = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => { armed.current = true; }, MAP_IMAGE_ADD.promptGraceMs);
    return () => window.clearTimeout(timer);
  }, []);
  const submit = () => {
    if (!armed.current) return;
    if (mode === 'new') { if (name.trim()) onConfirm({ kind: 'new', name }); else setError('장소 이름을 적어 주세요.'); }
    else if (places.some(place => place.id === placeId)) onConfirm({ kind: 'existing', placeId });
    else setError('넣을 장소를 다시 골라 주세요.');
  };
  // A key that was held as the dialog came up goes on repeating after the grace, and to the button in focus a repeat is a press: no repeat of Enter answers, and no held Space arms a button.
  const noRepeat = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.repeat && (event.key === 'Enter' || (event.key === ' ' && event.target instanceof HTMLButtonElement))) event.preventDefault();
  };
```

폼의 태그는 `<form onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={noRepeat}>`다.

| 누른 것 | 일어나는 일 |
|---|---|
| `이 장소로 넣기` · 어느 칸에서든 Enter(폼의 제출) | 뜬 지 0.4초(`promptGraceMs`)가 지났을 때만 듣는다. **누르고 있던 키의 되풀이는 그 뒤에도 듣지 않는다**(`noRepeat` — Enter의 되풀이는 어디서든, Space의 되풀이는 버튼 위에서 막는다. 이름 칸에 Space를 누르고 있는 것은 그대로 띄어쓰기다). 새로 누른 키와 누름은 듣는다. 편집기의 `answerPlacePrompt(choice)`: 창을 닫고 `imageAdd.start(planMapImageAdd(snapshot, placePrompt.target, choice, placePrompt.sources.map(mapImageSourceFacts), new Date(), uuid), placePrompt.sources)` — **대상은 열 때의 것, 라이브러리는 답하는 순간의 것**이다 |
| `취소` · Esc · × | **바로** 닫힌다(유예 없음). 아무것도 올리지 않고, 장소를 만들지 않고, 알림도 남기지 않는다 |
| 닫힌 뒤의 포커스 | `BackgroundModal`이 열기 전의 요소로 돌려준다(도면, 버튼 — BackgroundUI.tsx:32-34) |

포커스는 열리면 `이 장소로 넣기`에 간다(`data-autofocus`). Tab 순서: × → 라디오 → 그 선택의 칸 → 취소 → 이 장소로 넣기.

### 6.4 네이티브 모달의 네 가지 (tasks/lessons.md 2026-10-11)

| 배운 것 | 이 창에서 |
|---|---|
| **스스로 뜨는 창은 뜨는 순간 이미 오던 누름을 받는다** | 이 창은 놓기·붙여 넣기·파일 창 뒤에 스스로 뜬다. 파일 창에서 파일을 더블클릭한 둘째 누름, 누르고 있던 Enter가 **읽지도 않은 창에 답해 장소를 만들면** 안 된다 — 답(`submit`)은 0.4초 뒤부터 듣는다. 가리는 값은 상태가 아니라 **ref**(`armed`)다. **유예는 시간일 뿐이라 그보다 오래 누르고 있던 키는 막지 못한다**: 포커스가 놓인 버튼에 Enter의 되풀이는 그때마다 누름이고, 되풀이된 Space는 뗄 때 누름이 된다 — 폼이 그 되풀이의 기본 동작을 막는다(`noRepeat`. 놓는 순간 화면 이동의 Space를 누르고 있던 손, 파일 창을 닫은 Enter를 떼지 않은 손). Esc에는 유예를 두지 않는다(`cancel`을 한 번 막으면 엔진이 다음 Esc에 창을 스스로 닫는다) |
| **포커스가 `body`에 놓인 순간의 키는 뒤 화면에 닿는다** | 이 창 뒤에서 그 키를 듣는 것과 그 결과: ① 이 기능의 붙여 넣기 — 대상이 아니라 `dialogOpen`과 문서에 물어 **넘긴다**(4.3). 창 안의 라디오·버튼에 포커스가 있을 때의 붙여 넣기도 같다 ② Ctrl+S — 같은 가드로 넘긴다(:435의 `if (dialogOpen \|\| document.querySelector(openDialogs)) return;`) ③ Space — 화면 이동 깃발만 켠다(모달 밑의 도면은 눌리지 않는다) ④ 앱의 화면 전환 단축키(Ctrl+숫자) — 화면이 바뀌면 편집기와 함께 창이 사라진다. **이 창은 도는 일을 쥐고 있지 않다**(아직 아무것도 올리지 않았다) — 취소한 것과 같다. 그래서 1차의 삭제 창과 달리 창 단위의 키 막기를 두지 않는다 |
| **모달 밑의 알림은 눌리지 않고, 그 시간은 흐른다** | 이 창이 뜨는 때는 넣기의 **앞**이라 이번 넣기의 알림은 아직 없다. 앞선 넣기의 알림 줄(닫기 ×)은 창 밑에서 눌리지 않고 '추가됨'의 6초는 흐른다 — 둘 다 잃는 것이 없다(알림 줄은 창을 닫은 뒤에도 남는다). 저장 실행은 어떤 창이든 열려 있는 동안 시작하지 않으므로(5.5), 저장할 것이 있는 넣기의 **결과 문장은 창 밑에서 생기지 않는다**(올리기에서 모두 실패한 넣기만 창 밑에서 끝날 수 있다 — 그 문장도 닫을 때까지 남는다) |
| **기다림 뒤의 핸들러는 낡은 상태를 쥔다** | 창은 열 때 잡은 `target`의 id만 다룬다 — 지금 보는 도면(`current`)을 읽지 않는다. 창이 열린 동안 깨끗한 초안은 라이브러리를 따라가지 않는다(`dialogOpen` — 9.1). 보기 모드에서 그 도면이 다른 곳에서 지워져 화면이 말없이 다른 도면이 돼도, 답은 잡아 둔 도면 id로 가고 이어 주기가 "도면이 없다"로 끝난다(5.4의 '도면이 없어졌다' 줄 — 그림은 장소에 남고, 흐린 카드와 알림 줄은 지금 보는 도면의 목록에 뜬다: 돌아갈 도면이 없다, 7.2) |

---

## 7. 목록 안의 표시

모든 표시는 이미지 목록(`.bmap-gallery`) 안과, 자리를 차지하지 않는 덮개다. 목록의 바깥 높이는 그 안의 것으로 달라지지 않으므로(backgrounds-map.css:339의 `.bmap-gallery {`, 좁은 창 :392, 편집 중 :431) 그 안에서 무엇이 생기고 사라져도 **평면 SVG와 3D 캔버스의 크기는 넣기 전·도중·뒤에 같다**(10.3의 E5·F1이 너비와 높이를 잰다). 자리도 같다 — 하나를 빼고: 좁거나 낮은 창에서 **넣기를 시작할 때** 알림 줄을 보이려는 한 번의 스크롤(K13 — 끝날 때는 없다). 그래서 자리는 스크롤을 뺀 값(탭의 스크롤 상자에 대한 위치)으로 잰다. **저장이 실패한 넣기에서도 같고**(이 기능의 저장은 라이브러리의 붉은 줄을 남기지 않는다 — 5.2의 `hush`), **편집기의 오류 띠가 떠 있는 채 장소 창이 열리고 닫힐 때도 같다**(그 띠는 장소 창 밑에서 그대로 그려진다 — 9.1).

### 7.1 덮개 — `MapImageDropOverlay` (`BackgroundMapImageAdd.tsx`)

```tsx
export function MapImageDropOverlay({ words }: { words: MapImageWords }): JSX.Element {
  return <div className="bmap-drop" data-blocked={words.blocked || undefined} aria-hidden="true"><p className="bmap-drop-label"><strong>{words.title}</strong><span>{words.detail}</span></p></div>;
}
```

편집기는 `<main>`의 **마지막 자식**으로 그린다(`</BackgroundMapPanels>`(:1379) 다음, `</main>}`(:1380) 앞 — `<BackgroundMapPanels gallery={gallery}>`의 글자는 그대로다, 앵커 54):

```tsx
      {fileDrag && <MapImageDropOverlay words={mapImageTargetWords(resolveMapImageTarget(snapshot, maps, current, selected), { editing, running: imageAdd.view.running, wrongType: fileDrag === 'type' })} />}
```

- `.bmap-main`에 `position:relative`를 더하고(그 한 줄 — 7.6) 덮개는 그 안의 `position:absolute; inset:0`이다: 머리줄·띠·도면·속성 칸·이미지 목록을 한 장으로 덮고, 자리를 차지하지 않고, 누름을 받지 않는다(`pointer-events:none` — 끌기 사건은 그 아래의 요소에 그대로 닿는다). 도면 목록(왼쪽)은 덮지 않지만 그 위에 놓아도 받는다.
- 글자 상자는 `position:sticky; top:35%`다 — 탭이 스크롤되는 좁은 창에서도 보이는 높이의 35% 자리에 선다(붙는 상대는 띠와 같은 `.bg-tab-content`다. `.bmap-main`·`.bmap-layout`이 `overflow:clip`이라 가능하다).
- 막힌 경우(`data-blocked`)는 테두리 색과 **글자**로 가른다(색만으로 가르지 않는다). 제목은 한 줄에 넘치면 줄을 바꿔 **다 보인다**(말줄임표로 끝을 자르지 않는다 — 긴 이름 뒤의 `…의 시점으로 추가`·`…에는 넣을 수 없어요`가 잘리면 무엇이 되는지가 사라진다).
- 화면 읽기에는 숨긴다(`aria-hidden`) — 마우스로 끄는 동안만 있는 안내이고, 같은 말이 버튼의 풍선과 알림 줄에 있다.

### 7.2 이미지 목록이 받는 것 — `BackgroundMapGallery.tsx`

새 props 넷(모두 선택 값 — 없으면 오늘의 목록이다): `adding?: MapImageAddView`(기본 `MAP_IMAGE_IDLE`), `saving?: boolean`(기본 `false` — 저장소가 저장 중이다: 편집기의 `pending`), `onAddFiles?: (files: File[]) => void`, `onDismissNotice?: () => void`. 편집기의 `gallery` 메모가 넘긴다(9.3). 목록은 **자기 도면의 것**을 그린다 — 그 도면이 없어졌으면 지금 보는 도면이 대신 보인다(결과를 말할 곳이 달리 없다):

```tsx
  /** A batch and its line belong to one map. When that map is gone meanwhile (deleted here or elsewhere) they are shown on the map on show: how it went must still be told somewhere. */
  const mine = (mapId: string | null | undefined) => !!mapId && (mapId === current.id || !maps.some(map => map.id === mapId));
  const jobs = mine(adding.mapId) ? adding.jobs : MAP_IMAGE_IDLE.jobs, notice = mine(adding.notice?.mapId) ? adding.notice : null;
  // A picture that is saved while its batch still runs is in the library already. Until the batch ends it is drawn once, as its ghost: not as a card too, and not in the count.
  const scopedViews = useMemo(() => selectMapBackgroundViews(snapshot, maps, current, selected).filter(view => !jobs.some(job => job.id === view.id)), [snapshot, maps, current, selected, jobs]);
  const ordered = useMemo(() => adding.recent.length ? [...adding.recent.flatMap(id => views.filter(view => view.id === id)), ...views.filter(view => !adding.recent.includes(view.id))] : views, [views, adding.recent]);
  const words = mapImageTargetWords(resolveMapImageTarget(snapshot, maps, current, selected), { editing: false, running: adding.running, wrongType: false });
  // While a save runs the store shows a library that is not confirmed yet: the line is read against the library as it was before that save.
  const confirmed = useRef(snapshot);
  if (!saving) confirmed.current = snapshot;
  // The line of a batch says how that batch stands now: its link still to be saved, saved since or taken back, its pictures deleted.
  const noticeText = notice?.live ? mapImageSummary(mapImageOutcomeNow(notice.live.outcome, notice.live.link, confirmed.current.maps.find(map => map.id === notice.mapId), notice.mapId === current.id ? current : undefined, confirmed.current)) : notice?.text;
```

`mine`·`jobs`·`notice`는 지금의 `scopedViews` 줄(:15) **앞**에 두고, 그 줄을 위의 것으로 바꾼다(`views`(:16)·머리줄의 수·빈 상태가 모두 그 값을 읽는다). `ordered`부터는 `views` 줄 뒤다. ref는 `confirmed` 말고 둘이다: `const noticeRef = useRef<HTMLDivElement>(null), resultsRef = useRef<HTMLDivElement>(null);`.

- **저장이 도는 동안에는 확인된 라이브러리로 읽는다**(`confirmed`). 저장소는 명령을 보내는 동안 아직 확인되지 않은 낙관 값을 보인다(useBackgroundStore.ts:49) — 그것으로 읽으면 '도면 저장'을 누른 순간 띠는 `저장 중…`인데 이 줄이 먼저 `…'도면 저장'으로 저장됐어요`라고 하고, 그 저장이 거절되면 `…눌러야 남아요`로 되돌아간다. 카드에서 그림을 지우는 동안에도 같다(지워진 것으로 읽었다가 실패하면 돌아온다). 저장이 끝나면(`saving`이 거짓) 그때의 라이브러리로 다시 읽는다. 편집기가 `settledMaps`를 쥐는 방식이다(편집기 :298-300).

| 자리 | 더하는 것 |
|---|---|
| 머리줄의 버튼들(`.bmap-gallery-actions`, :35-38)의 **맨 앞** | `{snapshot.canManage && onAddFiles && <>` 감춘 파일 입력(4.5) + `<button type="button" className="bmap-gallery-add" aria-disabled={words.blocked} title={words.blocked ? `${words.title}. ${words.detail}` : words.title} onClick={() => { if (!words.blocked) pickImages(); }}>＋ 이미지 추가</button>` `</>}` |
| 머리줄과 결과 상자 사이 | 알림 줄(7.4) — `notice`가 있을 때 |
| 결과 상자(:40-53) | `ref={resultsRef}`를 단다. 그리드를 그리는 조건이 `views.length \|\| jobs.length`가 된다(흐린 카드가 있으면 빈 상태 대신 그리드). 그리드의 **앞**에 흐린 카드(7.3), 이어서 `ordered`의 카드. 결과 상자의 `key`(:40)는 그대로다 |
| 카드(:44) | `adding.marked`에 든 배경은 `className`에 ` is-added`, 버튼 안 맨 앞에 `<span className="bmap-gallery-mark">추가됨</span>`, `aria-label` 끝에 `, 방금 추가됨` |
| 빈 상태(:50) | 지금의 `<p>`(앵커 58이 보는 식 — **글자 그대로 둔다**) 다음에 `{snapshot.canManage && onAddFiles && !scopedViews.length && <p>{MAP_IMAGE_HINT}</p>}` — `그림 파일을 이 화면에 끌어다 놓거나, 복사한 그림을 Ctrl+V로 붙여 넣어도 돼요.` |

- **한 그림은 한 번만 그린다**: 저장 실행이 도는 동안 저장소는 명령마다 라이브러리를 바꿔 놓으므로(2.8), 대상이 공간·도면이면 방금 저장된 배경이 곧바로 범위에 든다. 넣기가 끝날 때까지 그 배경은 **흐린 카드로만** 있다(`scopedViews`가 도는 일거리의 id를 뺀다 — 일거리의 `id`가 배경의 id다). 머리줄의 수도 끝날 때 한꺼번에 는다.
- **순서**: 이 화면을 연 뒤 넣은 배경(`recent`, 새것이 앞)이 목록의 맨 앞이고, 나머지는 지금의 차례다(K11). 다시 쓴 배경(`reused`)은 앞으로 옮기지도 표시하지도 않는다 — 어느 카드인지는 알림 줄이 **그 배경의 이름**으로 말한다(7.4. 이름을 바꿔 둔 뒤에는 파일 이름으로 찾을 수 없다).
- **필터**: 방금 넣은 카드가 검색·구도·낮밤에 가려지면 필터를 푼다 — `useEffect(() => { if (hasFilters && adding.marked.some(id => scopedViews.some(view => view.id === id) && !views.some(view => view.id === id))) resetFilters(); }, [adding.marked]);`. 가리지 않으면 건드리지 않는다. 흐린 카드는 배경이 아니라서 필터와 무관하게 보인다.
- **화면 안으로**(K13) — 넣기가 시작될 때와 알림 줄이 까닭을 말할 때만이다. 끝날 때는 `seq`가 오르지 않고(5.2), 목록이 다시 그려질 때(도면을 옮겨 `key`가 바뀔 때)는 `seen`이 그때의 값에서 시작하므로 아무것도 움직이지 않는다:

```tsx
  // Brought into view as a batch starts and as the line speaks up. Never as a batch ends (the plan may be under a drag then), and never on a mere redraw: `seen` starts at the value of this mount.
  const seen = useRef(adding.seq);
  useEffect(() => {
    if (adding.seq === seen.current) return;
    seen.current = adding.seq;
    if (adding.running && resultsRef.current) resultsRef.current.scrollTop = 0;      // the ghosts stand at the front of the list
    noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [adding.seq]);
```

- 이 파일에 '편집 시작'이라는 글자를 넣지 않는다. '도면을 편집하면서'는 지금의 둘 그대로다(앵커 58).

### 7.3 흐린 카드

```tsx
        {jobs.map((job, index) => <div key={job.id} className="bmap-gallery-card bmap-gallery-ghost" data-step={job.step} aria-hidden="true">
          <span className="bmap-gallery-step"><i style={{ '--bmap-step': MAP_IMAGE_STEPS[job.step].part } as CSSProperties} /></span>
          <div className="bg-thumbnail">{job.imageUrl ? <img src={job.imageUrl} alt="" /> : <span><ImageIcon size={25} /></span>}</div>
          <span className="bmap-gallery-mark">{MAP_IMAGE_STEPS[job.step].label} · {index + 1}/{jobs.length}</span>
          <div className="bmap-gallery-card-body"><strong>{job.name}</strong><span><span>{shotLabel[MAP_IMAGE_DEFAULTS.shot]}</span><span>{MAP_IMAGE_DEFAULTS.variantName}</span></span></div>
        </div>)}
```

| 단계(`MAP_IMAGE_STEPS`) | 표시의 글자 | 막대(`part`) | 그림 |
|---|---|---|---|
| `ready` | `준비 중 · 1/3` | 0.08 | 없음(아이콘) |
| `uploading` | `올리는 중 · 1/3` | 0.4 | 없음 |
| `waiting` | `저장 기다리는 중 · 1/3` | 0.7 | 올라간 미리보기 |
| `saving` | `저장하는 중 · 1/3` | 0.9 | 올라간 미리보기 |
| `failed` | `넣지 못했어요 · 1/3` | 1 | 그때까지의 것 |

- 카드는 누를 수 없는 `<div>`이고 카드의 모양(`.bmap-gallery-card`)을 그대로 쓴다. 그림 칸과 글 두 줄 — 이름, 그리고 다 됐을 때 그 카드가 보일 `전체 전경`·`낮`(K2의 기본값 그대로다) — 이 진짜 카드와 같고 막대는 카드에 **겹쳐** 놓이므로(7.6) **높이가 같다**: 다 됐을 때 진짜 카드가 같은 자리에, 같은 글로 선다(표시의 글이 '추가됨'이 될 뿐이다).
- **단계의 글과 막대는 카드의 맨 위에 있다**: 글은 그림 칸 왼쪽 위의 표시(`.bmap-gallery-mark` — '추가됨'과 같은 자리, 같은 모양), 막대는 카드 위쪽 가장자리. 목록이 낮아 카드의 윗부분만 보일 때도 — 편집 중의 1440×900(카드 상자 155px쯤), 구분선으로 도면을 한껏 키운 때(목록 160px, 카드 상자 60px 남짓) — 둘 다 보인다. 글자를 카드 아래쪽 줄에 두면 그 두 경우에 잘린다.
- 흐리게 하는 것은 **그림 칸뿐**이다(카드 전체를 흐리면 10px 글자가 바탕에 묻힌다 — 대비 3.3:1). 흐린 카드임은 점선 테두리와 표시의 글이 말한다.
- 넣기가 끝나면 흐린 카드는 모두 사라진다: 된 것은 진짜 카드로(맨 앞, '추가됨'), 안 된 것은 알림 줄의 목록으로. 그때까지 저장된 배경의 진짜 카드는 서지 않는다(7.2). 화면 읽기에는 숨긴다 — 시작과 끝은 알림 줄이 읽어 준다.

### 7.4 알림 줄

```tsx
    {notice && <div className="bmap-gallery-notice" ref={noticeRef}>
      <div><p role="status">{noticeText}</p>{notice.failed.length > 0 && <ul role="alert" aria-label={`넣지 못한 그림 ${notice.failed.length}장`}>{notice.failed.map((item, index) => <li key={index}><strong>{item.name}</strong> — {item.reason}</li>)}</ul>}</div>
      {!adding.running && <button type="button" aria-label="안내 닫기" title="안내 닫기" onClick={onDismissNotice}>×</button>}
    </div>}
```

**줄은 하나**이고, 넣기가 시작될 때 생겨 끝날 때 **글만 바뀐다**(끝나는 순간 줄이 새로 생겨 카드를 밀어내지 않는다). 글이 한 줄이면 도는 동안과 끝난 뒤의 높이가 같고(`min-height:40px` — 닫기 버튼이 있든 없든), 줄 수가 달라지면 그 줄 수만큼 그 아래의 카드가 오르내린다: 넓은 창에서는 도는 동안의 글과 흔한 결과의 글이 모두 한 줄이고, 좁은 목록(740px)에서는 도는 동안이 두 줄, 끝난 뒤가 한 줄에서 석 줄이라 **끝날 때 카드가 한두 줄만큼 움직인다**(10.3의 F1이 본 대로 적는다). 목록 안의 일이고 도면은 그대로다. 닫기(×)나 다음 넣기까지 남는다(K12). 닫기의 이름은 편집기의 안내 줄(:1178)과 같은 '안내 닫기'다. 문장(`mapImageSummary` — 있는 조각을 **표의 차례대로** 빈칸으로 잇는다):

| 조각 | 조건 | 글자 |
|---|---|---|
| 도는 동안 | — | 공간 `‘2-1 교실’의 배경으로 그림 3장을 넣는 중이에요.` · 카메라 `‘카메라 2’의 시점으로 그림 3장을 넣는 중이에요.` · 도면 `‘2층’ 도면의 배경으로 그림 3장을 넣는 중이에요.` — 이어서 `끝나기 전에 다른 메뉴로 가면 그림이 들어가지 않아요.`(`mapImageBusyText` — 수는 새로 만들 것과 다시 쓸 것. 어디에 들어가는지를 말하므로, 도는 동안 다른 것을 골라도 흐린 카드가 누구의 것인지 알 수 있다) |
| 넣음 | `added > 0` | 공간 `‘2-1 교실’의 배경으로 그림 3장을 넣었어요.` · 카메라 `‘카메라 2’의 시점으로 그림 3장을 ‘2-1 교실’ 장소에 넣었어요.`(장소의 이름 — K1) · 도면 `‘2층’ 도면의 배경으로 그림 3장을 넣었어요.` |
| 이미 있음 | `reused > 0` | `이미 있는 그림 1장(‘교실 전경’)은 새로 만들지 않았어요.` · 여러 장이면 `이미 있는 그림 3장(‘교실 전경’ 외 2장)은 새로 만들지 않았어요.` — 괄호 안은 그 배경의 **라이브러리의 이름**이다(`reusedName` — 첫째 것. 파일 이름과 다를 수 있다) — 이어서 `그림을 고쳤다면 그 카드를 열어 '이미지파일 연결'로 새 수정본을 넣어 주세요.`(K4) |
| 없음 | 둘 다 0 | `넣은 그림이 없어요.` |
| 지워짐 | `link === 'gone'` — 위의 세 조각과 이어 주기의 조각 **대신** | 공간 `‘2-1 교실’의 배경으로 넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.` · 카메라 `‘카메라 2’의 시점으로 넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.` · 도면 `‘2층’ 도면의 배경으로 넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.` |
| 넣지 못함 | `failed > 0` | `2장은 넣지 못했어요(아래 목록).` — 못 넣은 것이 있다는 말이 문장 안에 있다(목록은 좁은 줄에서 스크롤해야 보일 수 있다) |
| 이어 주기 — 넣은 그림이 있다(`added + reused > 0`) | `'draft'` | `added > 0`이면 `그림은 바로 저장됐고, 도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` · 아니면 `도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` |
| | `'draft'`, `partial` | `다만 도면에 다 이어 주지는 못했어요. 그 사이 도면이나 배경 목록에서 지워졌거나, 잠겼거나, 다르게 이어졌어요. 이어 준 만큼은 다른 편집처럼 '도면 저장' 때 함께 저장돼요. 그림은 배경 목록의 ‘2-1 교실’ 장소에 있어요.` + **잇는 길**(아래) |
| | `'saved'` | `도면에 이어 준 것까지 바로 저장됐어요.` |
| | `'saved'`, `partial` | `다만 도면에 다 이어 주지는 못했어요. 그 사이 도면이나 배경 목록에서 지워졌거나, 잠겼거나, 다르게 이어졌어요. 이어 준 만큼은 바로 저장됐어요. 그림은 배경 목록의 ‘2-1 교실’ 장소에 있어요.` + 잇는 길 |
| | `'kept'` | `added > 0`이면 `그림은 바로 저장됐고, 도면에 이어 준 것도 '도면 저장'으로 저장됐어요.` · 아니면 `도면에 이어 준 것도 '도면 저장'으로 저장됐어요.` |
| | `'undone'` | `도면에 이어 준 것은 그 뒤에 되돌리거나 버려서 지금은 남아 있지 않아요. 그림은 배경 목록의 ‘2-1 교실’ 장소에 그대로 있어요.` |
| | `'missed'` | `다만 도면에 이어 주지는 못했어요. 그 사이 도면이나 배경 목록에서 지워졌거나, 잠겼거나, 다르게 이어졌어요. 그림은 배경 목록의 ‘2-1 교실’ 장소에 있어요.` + 잇는 길 |
| | `'failed'` | `다만 도면에 이어 주지는 못했어요. 까닭: 서버에서 답을 받지 못했어요. 인터넷 연결을 확인해 주세요. 그림은 배경 목록의 ‘2-1 교실’ 장소에 있어요.` + 잇는 길 — 까닭(`linkCause`)은 괄호에 넣지 않고 `까닭: ` 뒤에 그대로 잇는다(온전한 문장이 온다) |
| | `'none'`이고 `added > 0` | `바로 저장됐어요.` |
| 이어 주기 — 넣은 그림이 없다(`added + reused === 0`. 이은 것은 장소뿐이다) | `'draft'` | `‘창고’ 장소를 도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` |
| | `'saved'` | `‘창고’ 장소를 도면에 이어 준 것은 바로 저장됐어요.` |
| | `'kept'` | `‘창고’ 장소를 도면에 이어 준 것은 '도면 저장'으로 저장됐어요.` |
| | `'undone'` | `‘창고’ 장소를 도면에 이어 준 것은 그 뒤에 되돌리거나 버려서 지금은 남아 있지 않아요.` |
| | `'missed'` | `‘창고’ 장소를 도면에 이어 주지도 못했어요. 그 사이 도면이나 배경 목록에서 지워졌거나, 잠겼거나, 다르게 이어졌어요.` |
| | `'failed'` | `‘창고’ 장소를 도면에 이어 주지도 못했어요. 까닭: (다듬은 까닭)` |
| 넘침 | `over > 0` | `한 번에 10장까지예요. 나머지 2장은 넣지 않았어요.` |
| 복사한 파일 | `byPath` | `탐색기에서 복사한 파일은 한 번에 한 장만 들어와요. 여러 장은 끌어다 놓아 주세요.`(K6) |

- **잇는 길** — 이어지지 않은 그림이 남는 세 문장(`'missed'` · `'failed'` · `partial`)의 끝에 붙는 한 문장이다. 대상에 따라: 카메라 `도면을 편집하면서 속성의 ‘시점 연결’에서 이어 줄 수 있어요.` · 공간 `도면을 편집하면서 속성의 ‘배경 장소 연결’에서 이어 줄 수 있어요.` · 도면 `‘도면 설정’의 ‘대표 장소’에서 이어 줄 수 있어요.` 화면의 이름 그대로다(:1348, :1175, :1402). 같은 파일을 다시 넣어 이어 주는 길(K4)은 경로가 있는 파일에만 듣는다 — 화면 캡처를 다시 붙여 넣으면 배경이 하나 더 생긴다.
- **넣은 그림이 없는데 장소만 이은 넣기**(새 장소는 저장됐는데 배경이 모두 실패했다 — 5.5)는 그림이 그 장소에 있는 것처럼 말하지 않는다: 첫 조각이 `넣은 그림이 없어요.`이고, 이어 주기의 조각은 **무엇을 이었는지**(그 장소)를 이름으로 말하며 `그림은 … 장소에 있어요`가 없다.
- **줄은 낡지 않는다**(K12). 저장 실행에 들어간 넣기의 알림은 그 연결을 싣고 있고(`live` — 5.2), 목록은 그릴 때마다 지금의 모습을 읽어(`mapImageOutcomeNow` — 3.4) 글을 쓴다. ① **넣은 그림을 모두 지웠으면**(카드에서, '배경 목록'에서, 다른 PC에서) 어떤 넣기의 줄이든 `…넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.`가 된다 — 방금 지운 그림을 두고 "그 장소에 그대로 있어요"라고 하지 않는다. ② 연결이 **온전히 초안의 것**이었던 넣기는 이어 주기의 조각이 그 연결을 따라간다: 아직 초안에만 있으면 `…'도면 저장'을 눌러야 남아요.`, '도면 저장'으로 저장됐으면 `'kept'`의 문장, 되돌렸거나(Ctrl+Z) '버리고 끝내기'로 버렸으면 `'undone'`의 문장, 다시 실행하면(Ctrl+Shift+Z) 처음의 문장. **줄이 생기거나 사라지지 않고 글만 바뀐다.** 띠가 '저장했어요'라고 하는데 이 줄이 "눌러야 남아요"라고 하는 일이 없고, 띠가 `저장 중…`인 동안 이 줄이 먼저 "저장됐어요"라고 하는 일도 없다(7.2의 `confirmed`). ③ 그 밖 — 보기 모드에서 바로 저장한 넣기(`'saved'`), 일부만 이은 넣기(`partial` — 그 문장은 띠에 맡기는 말로 적었다), 이을 것이 없던 넣기, 이어지지 않은 넣기 — 의 줄은 넣었을 때의 문장 그대로다(①만 빼고).
- **못 넣은 그림**은 그 아래의 목록(`role="alert"`, 이름 `넣지 못한 그림 N장`)에 한 줄씩이다: `스케치.psd — PNG·JPG·WebP 그림만 넣을 수 있어요.` 처음부터 받지 않은 파일은 파일 이름으로, 올리거나 저장하다 실패한 그림은 흐린 카드에 적혀 있던 이름으로 적는다. 문장과 목록은 한 상자에서 함께 스크롤한다(높이 62px까지) — 그래서 못 넣은 것이 있다는 말은 문장에도 있다(위의 '넣지 못함'). 긴 파일 이름은 어디서든 줄을 바꾼다(`overflow-wrap:anywhere` — 가로 스크롤 막대가 생기지 않는다). 글자색은 어두운 화면에서 라이브러리의 오류색(`#ed7e79`), 밝은 화면에서는 더 짙은 `#b3362f`다 — 앞의 색은 밝은 바탕에서 대비가 2.2:1뿐이다(7.6).
- 막힌 대상에 붙여 넣었을 때, 도는 중에 붙여 넣었을 때의 까닭(3.3), 글자 칸의 한 줄(K18), 저장 중에 누른 뒤의 한 줄(K20)도 이 줄에 적힌다(`say`).
- 읽어 주기: 문장은 `role="status"`(시작과 끝, 그리고 연결의 모습이 바뀔 때 바뀐다 — 장마다 바뀌는 수는 흐린 카드에만 있다), 못 넣은 목록은 `role="alert"`.

### 7.5 '추가됨'

넣기가 끝나면 새 카드에 `추가됨` 글자 표시가 6초(`addedMarkMs`) 붙는다. 시간은 컨트롤러가 잰다(CSS로 재지 않는다 — 동작 줄이기에서 CSS의 시간은 첫 프레임에 끝난다). 표시는 색이 아니라 글자이고, **카드의 바탕색과 글자색**으로 그린 뒤 테두리만 강조색이다 — 강조색 위의 흰 글자는 테마에 따라 읽히지 않는다(기본 보라 4.9:1, 파랑 3.7:1, 노랑 3.2:1, 초록 2.5:1). 6초 안에 다음 넣기가 끝나면 그 넣기의 카드로 바뀐다.

### 7.6 CSS — `backgrounds-map.css`

**고치는 줄 하나**: `.bmap-main {`(:34)에 `position:relative;`를 더한다 — `.bmap-main { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; overflow:clip; position:relative; }`. 그 안의 절대 위치 요소는 모두 자기 기준 상자가 있다(`.bmap-canvas-wrap`·`.bmap-3d-main`·도구줄, :91, :92, :413, :438. 1차·2차가 더한 절대 위치 요소도 제 상자 안이다 — `.bmap-hidden-slot` :162, `.bmap-num-row` :179, `.bmap-num-track` :189, `.bmap-show-all` :232). `overflow:clip`은 그대로다(앵커 54).

**더하는 줄** — `.bmap-gallery-empty>svg` 줄(:373) 다음, `@media(max-width:1100px)`(:374 — 갤러리 그리드의 것. 그 다음 줄 :375도 같은 미디어 조건이다) 앞. 한 줄에 규칙 하나. 선택자에 `.bmap-edit`·`.bmap-main.is-editing`이 없다(앵커 54가 그 줄들을 훑는다).

```css
/* Pictures added from this screen (mapImageDrop.ts): the ones on their way, the ones just added, the one line that says how it went. All of it is inside the image list, whose own height is fixed: the map above never moves for it. */
.bmap-gallery-notice { display:flex; flex:0 1 auto; gap:8px; min-height:40px; margin:0 18px 8px; padding:6px 6px 6px 12px; border:1px solid rgb(var(--color-accent) / .35); border-radius:8px; background:rgb(var(--color-accent) / .08); font-size:12px; line-height:1.6; }
.bmap-gallery-notice>div { flex:1; min-width:0; min-height:0; max-height:62px; overflow-y:auto; overflow-wrap:anywhere; }
.bmap-gallery-notice ul { margin:2px 0 0; padding:0; list-style:none; color:#ed7e79; }
[data-color-mode="light"] .bmap-gallery-notice ul { color:#b3362f; }
.bg-library .bmap-gallery-notice button { flex-shrink:0; align-self:flex-start; width:26px; min-height:26px; padding:0; border:0; background:transparent; color:rgb(var(--color-text-secondary)); font-size:15px; }
.bg-library .bmap-gallery-add[aria-disabled="true"],.bg-library .bmap-gallery-add[aria-disabled="true"]:hover { color:rgb(var(--color-text-secondary) / .5); background:transparent; border-color:transparent; cursor:default; }
.bg-library .bmap-gallery-ghost,.bg-library .bmap-gallery-ghost:hover { position:relative; border-style:dashed; border-color:rgb(var(--color-bg-border)); }
.bmap-gallery-ghost .bg-thumbnail { opacity:.55; }
.bg-library .bmap-gallery-ghost[data-step="failed"] { border-color:rgb(237 126 121 / .55); }
.bmap-gallery-step { position:absolute; inset:0 0 auto; z-index:1; height:3px; background:rgb(var(--color-bg-border) / .6); }
.bmap-gallery-step>i { display:block; height:100%; background:rgb(var(--color-accent-sub)); transform-origin:left center; transform:scaleX(var(--bmap-step,0)); }
[data-color-mode="light"] .bmap-gallery-step>i { background:rgb(var(--color-text-secondary)); }
.bg-library .bmap-gallery-card.is-added { position:relative; border-color:rgb(var(--color-accent-sub) / .8); }
.bmap-gallery-mark { position:absolute; top:9px; left:6px; z-index:1; padding:1px 7px; border:1px solid rgb(var(--color-accent-sub)); border-radius:999px; background:rgb(var(--color-bg-card)); color:rgb(var(--color-text-primary)); font-size:10px; font-weight:600; }
/* Files dragged over the editor: one sheet over the map column. It takes no room and no press, and its words stay in the part of the tab that is on screen. */
.bmap-drop { position:absolute; inset:0; z-index:6; display:flex; justify-content:center; align-items:flex-start; border:2px dashed rgb(var(--color-accent-sub)); background:rgb(var(--color-bg-primary) / .55); pointer-events:none; }
.bmap-drop-label { position:sticky; top:35%; display:flex; flex-direction:column; align-items:center; gap:4px; max-width:min(520px,calc(100% - 32px)); margin:0; padding:12px 18px; border:1px solid rgb(var(--color-accent-sub) / .6); border-radius:10px; background:rgb(var(--color-bg-card)); font-size:12px; text-align:center; }
.bmap-drop-label>strong { max-width:100%; overflow-wrap:anywhere; font-size:14px; font-weight:650; }
.bmap-drop[data-blocked] { border-color:rgb(237 126 121 / .7); }
.bmap-drop[data-blocked] .bmap-drop-label { border-color:rgb(237 126 121 / .6); }
/* The choices of the place prompt. */
.bmap-place-choices { display:flex; flex-direction:column; gap:8px; min-width:0; margin:12px 0; padding:0; border:0; }
.bmap-place-choice { display:flex; align-items:flex-start; gap:10px; font-size:12px; line-height:1.7; color:rgb(var(--color-text-secondary)); cursor:pointer; }
.bmap-place-choice strong { display:block; font-size:13px; font-weight:550; color:rgb(var(--color-text-primary)); }
.bmap-place-choice input { flex-shrink:0; margin-top:5px; accent-color:rgb(var(--color-accent)); }
/* The second paragraph of the question of 편집 끝내기 (MAP_LINKS_LOST_NOTE): the paragraph reset of the library takes its margin away. Only right inside a dialog: the lead of the delete dialog spaces its paragraphs by its own gap. */
.bg-modal-content>.bmap-confirm-text+.bmap-confirm-text { margin-top:8px; }
/* What moves, and only where motion is wanted: the sheet and its words come in, a card that was just added rises, the bar of a step grows. Everything that tells something is drawn above, without these. */
@keyframes bmap-drop-in { from { opacity:0; } }
@keyframes bmap-rise-in { from { opacity:0; transform:translateY(6px); } }
@media (prefers-reduced-motion: no-preference) {
  .bmap-drop { animation:bmap-drop-in var(--motion-fast) var(--ease-out) both; }
  .bmap-drop-label { animation:bmap-rise-in var(--motion-base) var(--ease-out) both; }
  .bmap-gallery-card.is-added { animation:bmap-rise-in var(--motion-base) var(--ease-out) both; }
  .bmap-gallery-step>i { transition:transform var(--motion-base) var(--ease-out); }
}
```

- **움직임**: opacity와 transform뿐이다(덮개 120ms, 글자 상자·새 카드 180ms로 6px 올라옴, 막대의 `scaleX`). 반복 없음, `backdrop-filter` 없음, 레이아웃 속성 전환 없음. `@keyframes`는 블록 **밖**, `animation`·`transition`은 그 `no-preference` 블록 **안**에만 있다 — 빌드의 `scripts/postcss-motion-minimal.cjs`가 그 블록을 '움직임: 최소'에서 빼 준다(블록 안에 규칙이 아닌 것이 있으면 경고가 나고 `npm run test:motion`이 떨어진다). OS의 동작 줄이기와 '최소'에서는 덮개·카드·막대가 **그냥 그 자리에 있고**, 글자·'추가됨'·막대의 길이는 그대로 보인다.
- **이 블록은 띠의 `no-preference` 블록(:67-70)보다 뒤에 온다** — 앵커 54가 시트의 **첫** 그런 블록을 띠의 것으로 읽는다(이 커밋의 시트에는 그 블록 하나뿐이라, 새 블록이 둘째다).
- **버리기 창의 덧붙는 문단(8.1)의 간격**: 그 창도 `<dialog className="bg-library bg-modal">`이라(BackgroundUI.tsx:39) 라이브러리의 문단 초기화(`.bg-library p { margin:0 }`, backgrounds.css:110-115)가 문단의 여백을 지우고, `.bmap-confirm-text`(이 시트의 :241)에도 창의 본문(`.bg-modal-content`, backgrounds.css:468-472)에도 간격이 없다 — 규칙이 없으면 둘째 문단이 첫 문단에 붙는다(1차의 삭제 창이 같은 초기화 때문에 이 시트의 :294-295 두 줄을 더했다). 선택자는 **창 본문의 바로 아래**(`.bg-modal-content>`)로 좁힌다: 삭제 창은 첫 문단들을 `.bmap-delete-lead`(이 시트의 :286 — `gap:8px`의 세로 flex) 안에 나란히 두므로, `.bmap-confirm-text+.bmap-confirm-text`만 쓰면 그 창의 문단 사이가 16px로 벌어진다(1차가 물러선다).
- 좁은 창(900px 이하)의 덮어쓰기는 필요 없다: 목록의 높이는 360px 고정이고(:392), 머리줄은 이미 줄바꿈한다(:340, :393) — 버튼이 하나 늘어 머리줄이 두 줄이 되면 그만큼 결과 상자가 줄 뿐 목록의 바깥 높이는 같다. 그리드는 지금의 `minmax(180px,1fr)`(1100px 이하 150px)를 그대로 쓴다.
- **높이가 같게**: 알림 줄은 `min-height:40px`라 닫기 버튼(26px)이 있든 없든 한 줄짜리 글의 높이가 같고(그 값이 없으면 버튼이 없는 동안 33px로 줄어 끝날 때 카드가 7px 밀린다), 막대는 흐름에서 빠져(`position:absolute`) 흐린 카드가 진짜 카드보다 3px 높지 않다. 표시(`.bmap-gallery-mark`)와 막대의 기준 상자는 카드다(`.bmap-gallery-ghost`·`.is-added`의 `position:relative`).
- **목록이 낮을 때 알림 줄이 잘리지 않게**: 알림 줄은 목록이 모자라면 40px까지 **줄어들고**(`flex:0 1 auto` — 머리줄은 제 높이를 지키고, 카드 상자는 이미 0에서 시작한다) 그 안의 글 상자가 그 높이에 맞춰 스크롤한다(`min-height:0`, 줄의 `align-items`는 기본값 `stretch` — 닫기 버튼만 `align-self:flex-start`로 제 크기다). 줄어들지 않으면: 창 폭 901~1100px에서는 검색 줄이 머리줄의 둘째 줄로 내려가(:374) 머리줄이 106px쯤이고, 구분선으로 목록을 160px까지 줄였을 때 못 넣은 목록이 붙은 알림 줄이 목록 밖으로 30px쯤 넘쳐 `.bmap-main`의 `overflow:clip`에 잘린다. 그 폭·그 높이에서는 **도는 동안 카드 상자가 6px쯤이라 흐린 카드가 보이지 않는다** — 넣는 중이라는 말은 알림 줄이 한다(받아들인다. 10.3의 F8이 1000px에서 본다).
- **색과 대비**(`src/themes.ts`의 값으로 셈한 것 — 10.3의 F5가 눈으로 본다): 표시는 카드 바탕 위의 본문 글자색이라 13.8:1(어두운 화면)·16.9:1(밝은 화면)이고 어느 강조색 테마에서도 같다. 못 넣은 목록은 `#ed7e79`가 어두운 화면에서 6.4:1, 밝은 화면에서는 `#b3362f`로 5.0:1(그 색을 어두운 화면에 쓰면 2.9:1이라 밝은 화면에만 덮어쓴다 — 시트가 :137·:215·:408에서 하는 방식). 흐린 카드의 글은 진짜 카드의 글과 같다(5.2:1·7.2:1). **막대**는 어두운 화면에서 강조색 그대로 5.8:1~9.8:1이지만, 밝은 화면에서는 강조색이 막대의 바탕(흰 카드 위의 테두리색 60%) 위에서 1.1:1~1.9:1뿐이라(보라 1.7, 빨강 1.9, 파랑 1.8, 초록 1.4, 노랑 1.2, 버섯 1.1) 길이가 보이지 않는다 — 밝은 화면에서는 보조 글자색으로 덮어쓴다(어느 강조색에서나 5.2:1). 덮개의 점선 테두리(밝은 화면에서 1.4~2.4:1)와 막힌 테두리(1.8:1)는 그대로 둔다: 무엇이 되는지와 막혔는지는 글자 상자의 글이 말하고, 테두리는 자리를 두를 뿐이다. 그 밖의 색은 강조색 변수와 라이브러리가 오류에 쓰는 `#ed7e79`(backgrounds.css:235)뿐이다.

---

## 8. 편집 끝내기 · 되돌리기 · 도면 저장 · 띠

### 8.1 '편집 끝내기' — 한 문장이 더 나오는 때

버리기 확인 창(:1410 — `{confirmation && current && <BackgroundModal `로 시작하는 줄. 1차가 `'delete-map'` 가지를 뺀 모습)의 제목·글·버튼은 그대로다(앵커 52가 세 식을 글자로 본다). **그 창은 편집기에서 한 줄(물리적인 한 줄)이다** — 그 줄 안에서, 그 줄의 첫 `</p>`(글 문단 `<p className="bmap-confirm-text">…</p>`를 닫는 것) **바로 뒤**, `{error && <div className="bg-error" role="alert">` 앞에 다음 식을 끼운다:

```tsx
{confirmation === 'discard' && linksAdded && <p className="bmap-confirm-text">{MAP_LINKS_LOST_NOTE}</p>}
```

- **줄을 나누지 않는다.** 1차의 앵커 66이 삭제 창의 세 줄 바로 다음 줄을 본다 — `{confirmation && current && <BackgroundModal `로 시작하고 `{confirmation === 'discard' ? '버리고 끝내기' : '삭제'}</button></div></BackgroundModal>}`로 끝나며, 그 다음 줄이 `</div>;`다(tests/backgroundMapEditorWiring.test.ts:2296-2312). 이 식을 새 줄로 내리면 물음이 여러 줄이 돼 첫 줄이 그 글자로 끝나지 않는다.
- 두 문단 사이의 간격은 7.6의 한 줄이 준다(`.bg-modal-content>.bmap-confirm-text+.bmap-confirm-text { margin-top:8px; }` — 라이브러리의 문단 초기화가 여백을 지운다).
- `const linksAdded = useMemo(() => !!draft && !!current && mapLinksAdded(snapshot.maps.find(map => map.id === current.id), draft.value), [snapshot.maps, draft, current?.id]);`를 `draftChanged`(:1134) 옆에 둔다.
- `MAP_LINKS_LOST_NOTE` = `이 도면에서 이어 둔 배경(도면의 대표 장소, 공간의 배경 장소, 카메라의 시점)도 함께 풀려요. 배경 목록의 그림은 그대로 남아요.` — `mapLinksAdded`가 보는 셋을 모두 적고, 넣기로 이었든 속성 칸에서 이었든 맞는 말로 적는다('넣은 그림'이라고 하지 않는다).
- `mapLinksAdded(saved, draft)`가 참인 때: 초안의 도면에 저장된 것과 다른 대표 장소가 **있다** / 초안의 어느 공간에 저장된 그 공간과 다른 장소가 **있다**(새로 그린 공간 포함) / 초안의 어느 카메라가 저장된 그 카메라에 없는 시점을 **갖고 있다**. 연결을 푼 것(값이 `null`이 됐거나 시점이 빠진 것)만 있으면 거짓이다. 넣기로 이었든 속성 칸에서 이었든 같다.
- 바뀐 것이 없으면 묻지 않고 끝나는 규칙(v1.135.0)은 그대로다 — 이어 준 초안은 바뀐 초안이라 늘 묻는다.

### 8.2 되돌리기

| 넣기 | 되돌리기 단계 |
|---|---|
| 편집 중, 이어 줄 것이 있다(카메라 대상, 또는 장소를 새로 이은 공간·도면) | **넣기 한 번에 정확히 하나**(장소 이어 주기와 시점 N개가 함께) |
| 보기 모드 | 없다(바로 저장한 것은 되돌리기 대상이 아니다) |
| 도면을 바꾸지 않는 넣기(장소가 있는 공간·도면) | 없다. 띠의 수도 버전도 그대로다. **그 장소가 초안에만 이어져 있었으면**(같은 편집에서 앞서 넣은 넣기가 이었다) 단계는 그 앞의 넣기가 만든 하나 그대로이고, 이 넣기의 줄도 `…'도면 저장'을 눌러야 남아요.`라고 한다(5.4) — 그 한 단계를 되돌리거나 초안을 버리면 이 넣기의 줄이 `…지금은 남아 있지 않아요.`가 된다 |

**넣은 뒤의 Ctrl+Z**(편집 중): 그 한 단계가 되돌아간다 — 카메라의 시점에서 그 그림들이 빠지고, 새로 이은 장소가 풀린다. **그림(과 새 장소)은 배경 목록에 남는다.** 카메라를 고른 채였다면 목록에서 그 카드들이 사라져 보인다(그 카메라의 시점이 아니게 됐다) — Ctrl+Shift+Z로 다시 잇는다. **알림 줄은 그 연결의 지금 모습을 말한다**(7.4): 되돌린 동안에는 `…도면에 이어 준 것은 그 뒤에 되돌리거나 버려서 지금은 남아 있지 않아요. 그림은 배경 목록의 ‘…’ 장소에 그대로 있어요.`, 다시 실행하면 처음의 문장이다. '버리고 끝내기' 뒤에도 같은 문장이다. 넣은 그림을 카드에서 모두 지웠으면(8.5) `…넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.`다.

### 8.3 '도면 저장'과 띠

- 편집 중에 이어 준 넣기 뒤 띠는 `저장 안 한 변경 N+1개`가 된다(`mapDraftSteps` — 손대지 않는다). '도면 저장'·Ctrl+S가 그 초안을 저장한다: 가리키는 배경과 장소는 **이미 라이브러리에 있다**(5.6). 저장되면 알림 줄의 `…'도면 저장'을 눌러야 남아요.`가 `…도면에 이어 준 것도 '도면 저장'으로 저장됐어요.`로 바뀐다(7.4 — 띠의 말과 어긋나지 않는다). **바뀌는 때는 저장이 확인된 뒤다**: 띠가 `저장 중…`인 동안에는 앞의 문장 그대로이고, 그 저장이 거절되면 바뀌지 않는다(7.2의 `confirmed`).
- 올리는 동안 '도면 저장'을 눌러도 된다 — 저장 실행은 그 저장이 끝난 뒤에 시작하고, 이어 주기는 저장 뒤의 초안에 든다(띠는 `저장 안 한 변경 1개`).
- 저장 실행이 도는 동안 띠는 `저장 중…`이고 두 버튼은 꺼진다(여느 저장과 같다 — `pending`). 띠의 높이는 그대로다.
- 보기 모드의 바로 저장은 띠를 띄우지 않고 '도면을 저장했어요'도 없다(알림 줄이 말한다).

### 8.4 다른 PC

배경마다, 그리고 바로 저장한 도면마다 변경 신호가 나간다 — 다른 화면은 그림이 하나씩 늘어나는 것을 본다(모두 온전한 라이브러리다). 보기 모드의 바로 저장은 그 도면의 버전을 올린다: 같은 도면에 **저장 안 한 편집을 쥔 다른 PC**는 다음 저장이 거절된다('기존 도면 연결'·'설정 저장'이 오늘 그런 것과 같다 — 13.3).

**이 PC의 저장 실행이 도는 동안 다른 PC가 그 도면을 저장했을 때**: 잠긴 동안에는 깨끗한 초안도 따라가지 못하고(:349), 그 저장은 이 실행의 명령들이 돌려받는 라이브러리에 실려 온다. 이어 주기는 그래서 **깨끗한 초안을 먼저 라이브러리의 도면으로 다시 놓고** 그 위에 잇는다(5.4) — 놓지 않으면 그림만 넣었을 뿐인데 다음 '도면 저장'이 거절된다. 저장 안 한 변경이 이미 있던 초안은 오늘처럼 그대로이고(따라가지 않는다), 그 도면의 다음 저장은 오늘처럼 거절된다.

### 8.5 초안에만 이어 둔 그림을 지웠을 때

배경의 삭제는 저장된 도면만 본다(2.2). 편집 중에 넣은 그림은 연결이 초안에만 있어서 **카드에서 지울 수 있고**, 지우면 초안의 카메라가 없는 배경을 가리킨다 — 그 도면은 "카메라가 참조한 배경이 없습니다"로 저장되지 않고, '시점 연결' 목록에는 그 줄이 없어 풀 수도 없다(되돌리기로만 풀린다). "잘못 넣은 그림을 지운다"가 곧바로 그 길이라, 초안이 스스로 놓게 한다(9.3의 블록 안):

```ts
  // A background that a draft still ties to a camera was deleted (from its card): the draft lets go of it. Kept, the map could never be saved, and the list of views has no row left to untick.
  const knownViews = useMemo(() => new Set(snapshot.views.map(item => item.id)), [snapshot.views]);
  useEffect(() => {
    // Not while a save runs: the library is not confirmed then. And not against a library that was not read as an editor's: an empty one would empty every camera.
    if (disabled || !snapshot.canManage || doc.isGestureActive()) return;
    for (const item of Object.values(doc.getState().drafts)) {
      const next = dropMissingViews(item.value, knownViews);
      if (next !== item.value) doc.update(next, { history: false });
    }
  }, [knownViews, drafts, disabled, snapshot.canManage, gestureActive]);
```

- `dropMissingViews`는 카메라의 `viewIds`에서 라이브러리에 없는 id만 뺀다. 뺄 것이 없으면 **같은 객체**라 아무 일도 없다(평소에는 초안마다 한 번 훑고 끝난다).
- 되돌리기 단계를 만들지 않는다(`history: false` — 사용자가 한 편집이 아니다). 띠의 수는 그대로다. 되돌리기로 그 id가 든 옛 값이 돌아오면(`drafts`가 바뀌므로) 다시 뺀다.
- 저장이 도는 동안에는 하지 않는다(그때의 라이브러리는 확인되지 않은 낙관 값이다 — 삭제가 실패해 되돌아오면 연결을 잃는다). **편집 권한으로 읽은 라이브러리가 아닐 때도 하지 않는다**(`!snapshot.canManage`): 저장소는 화면을 열고 닫을 때와 첫 읽기 전에 빈 라이브러리를 쥐고(domain.ts:46, BackgroundLibraryView.tsx:54-56), 빈 라이브러리에 대면 모든 카메라의 시점이 "없는 배경"이다. 이 차례에는 초안이 그런 라이브러리와 함께 있는 때가 없지만(초안은 화면과 함께 사라진다), 초안을 보관하는 다음 차례에는 있다(9.5). 저장된 도면이 가리키는 배경은 삭제가 거절되므로(domain.ts:132) 여기에 걸리지 않는다 — 빠지는 것은 초안에만 있던 연결뿐이다. 장소는 다루지 않는다: 초안의 공간이 없어진 장소를 가리키면 속성의 '배경 장소 연결'에서 '나중에 연결'로 풀 수 있다(오늘과 같다).

---

## 9. 함께 쓰는 것 — `dialogOpen` · 앵커 · 파일

### 9.1 `dialogOpen`

1차가 만든 한 줄(:283 — 그 위 :282는 그 줄의 주석)에 한 낱말을 더한다: `const dialogOpen = !!(confirmation || createForm || linkForm || settingsForm || mapDelete || placePrompt);`

| 읽는 곳 | 장소 창이 열려 있는 동안 |
|---|---|
| 따라가기의 가드와 의존 목록(1차가 고친 줄 — 글자 그대로) | 깨끗한 초안이 라이브러리를 따라가지 않는다. 닫힐 때 다시 돈다 |
| Ctrl+S의 가드(같음) | 저장하지 않는다 |
| 오류 띠 — **이 줄은 고친다**: `{error && !(dialogOpen && !placePrompt) && <div className="bg-error" role="alert" ref={errorRef}>` | **띠를 그대로 그린다.** 다른 다섯 창은 편집기의 `error`를 창 안에 그리고 닫힐 때 비우므로(:1381~:1410의 창들 — 삭제 창은 `closeMapDelete`의 `setError('')`, 나머지는 제 닫기의 `setError('')`) 창 밑의 띠를 감춘다. 장소 창은 그 글을 그리지도 비우지도 않는다(자기 문장은 창 안의 상태다, 6.3) — 1차의 조건 그대로면 떠 있던 띠가 창이 열릴 때 사라졌다가 닫힐 때 돌아와 도면이 그 높이만큼 두 번 움직인다 |
| **새로 읽는 넷**: `addImages` · `onFileDrag` · `onImagePaste`의 가드, `idle` | 넣기를 받지 않는다 · 저장 실행을 시작하지 않는다 |

`dialogOpen`이라는 글자는 편집기에 **아홉 번**, 아홉 줄에 하나씩 나온다(1차의 다섯 — 오류 띠의 줄에 그대로 하나 — + 넷). 주석은 세지 않는다. 파일의 차례로는 ① 만드는 줄(:283) ② 따라가기의 가드(:349) ③ 그 effect(:358) ④ Ctrl+S의 가드(:435) ⑤ `imageAdd`의 `idle:` 줄 ⑥ `addImages`의 가드 ⑦ `onImagePaste`의 `dialog:` 줄 ⑧ `onFileDrag`의 가드 ⑨ 오류 띠(:1177)다 — 새 넷은 `openSpaceFrom3D` 다음의 블록(9.3)에 있어 그리는 부분의 띠보다 앞이다. 앵커 65가 이 아홉 줄을 이 차례로 본다(9.2). 장소 창은 다른 창과 함께 열리지 않으므로(`addImages`가 창이 열려 있으면 돌아간다) `dialogOpen && !placePrompt`는 "다른 다섯 가운데 하나가 열려 있다"와 같다.

### 9.2 앵커 — `tests/backgroundMapEditorWiring.test.ts`

**잘라 보는 법.** 이 절이 `block`으로 본다고 적은 조각은 여는 줄이 `{`로 끝나고 그 짝인 닫는 `}`에서 끝난다 — 코드가 `});`로 끝나면 줄로 견줄 때 그 마지막 줄을 `}`로 적는다. 여는 줄이 하나뿐이 아닌 것(effect의 `useEffect(() => {`)은 구현 계획의 '앵커 규칙'이 정한 표지로 자른다(2026-10-15, 계획을 쓰며 바로잡음).

**일부러 고치는 기존 앵커(셋).** 그 밖은 한 글자도 고치지 않고 통과해야 한다 — 특히 13·16·17·23·28·36·46·52·53·54·56·57·58과 1차의 60~64·66, 2차의 67~72. 66은 장소 창의 줄이 `</main>}` 다음에 서고(9.3) 버리기 창의 덧붙는 식이 물음의 한 줄 안에 들어갈 때(8.1) 그대로 지난다 — 이 문서가 편집기에 넣는 줄을 모두, 7.6의 CSS와 함께 이 커밋의 사본에 넣어 이 테스트 파일을 돌려 봤다(2026-10-15: 50·65만 떨어지고 나머지 70개는 지난다. 장소 창을 삭제 창 다음이나 물음 다음에 두면, 또는 덧붙는 식을 새 줄로 내리면 66도 떨어진다).

| # | 고치는 것 |
|---|---|
| 50 | `count(editor, /await persistMaps\(/g)`가 1차의 5 → **6**(보기 모드에서 넣은 그림의 이어 주기). 단언의 설명에 그 낱말을 더한다 |
| 59 | 이름 목록에 `'backgroundMapImageDrop.test.ts'`를 더한다(`^test(`가 셋 이상, 첫 줄 `import test from 'node:test';`, 낱말 `skip`·`todo` 없음) |
| 65 (1차의 것) | 만드는 줄이 9.1의 글자, `count(editor, /\bdialogOpen\b/g)`가 5 → **9**. `confirmation \|\| createForm`이 한 번뿐이라는 것은 그대로다. 오류 띠 줄은 9.1의 새 글자(`{error && !(dialogOpen && !placePrompt) && <div className="bg-error" role="alert" ref={errorRef}>`)이고, 편집기에 `{error && !dialogOpen && `이 없다. **`dialogOpen`이 든 줄의 목록**(`assert.deepEqual(lines.filter(line => /\bdialogOpen\b/.test(line)), […])` — 주석을 지우고 앞뒤 공백을 뗀 줄)이 다섯에서 **아홉**이 되고, 차례는 파일의 차례 그대로다: ① `made`(9.1의 새 글자) ② `guard` `if (disabled \|\| doc.isGestureActive() \|\| dialogOpen) return;` ③ `waited` `useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, dialogOpen]);` ④ `key` `if (dialogOpen \|\| document.querySelector(openDialogs)) return;` ⑤ `idle: () => !pointerRef.current && !doc.isGestureActive() && !renamingRef.current && !polygon.length && !busy && !dialogOpen && !document.querySelector(openDialogs) });`(9.3) ⑥ `if (!sources.length \|\| !current \|\| !snapshot.canManage \|\| dialogOpen \|\| document.querySelector(openDialogs)) return;`(4.1) ⑦ `dialog: dialogOpen \|\| !!document.querySelector(openDialogs), text: !!element?.closest(textFields), dragging: !!pointerRef.current \|\| doc.isGestureActive() };`(4.3) ⑧ `if (!data \|\| !Array.from(data.types).includes('Files') \|\| !current \|\| !snapshot.canManage \|\| dialogOpen \|\| document.querySelector(openDialogs)) return;`(4.2) ⑨ `{error && !(dialogOpen && !placePrompt) && <div className="bg-error" role="alert" ref={errorRef}>{error}</div>}`(마지막 — 새 넷은 그리는 부분보다 위의 블록에 있다). 앵커의 이름과 주석은 "세 곳이 읽는다"에서 **일곱 곳**(따라가기 · Ctrl+S · 띠 · `idle` · `addImages` · 붙여 넣기 · 끌기)으로 고친다 — 잡아야 하는 변형: 띠의 조건을 1차의 것 그대로 둠(떠 있던 오류가 장소 창이 열릴 때 사라졌다가 닫힐 때 돌아와 도면이 두 번 움직인다) · 새 넷 가운데 하나에서 `dialogOpen`을 뺌(목록이 여덟 줄이 된다) |

**새 조각**(읽힐 때만 잘린다): `linkAdded` = `piece(editor, 'async function linkAddedImages(', 'function dropGoneDrafts(')`(1차의 삭제 핸들러 넷의 첫 표지 — 이 커밋에 그대로 있다. 그 사이의 `dropGoneDrafts`의 문서 주석은 `read`가 지운다) · `imageBlock` = `piece(editor, 'const imageAdd = useMapImageAdd(', 'const gallery = useMemo(')`. 새 파일을 읽는다: `mapImageDrop.ts`·`useMapImageAdd.ts`·`BackgroundMapImageAdd.tsx`·`BackgroundMapGallery.tsx`, 그리고 `electron/backgroundIpc.ts`·`electron/clipboardFiles.ts`·`electron/main.ts`·`electron/preload.ts`·`src/types/index.ts`·`src/mocks/devElectronAPI.ts`(저장소 뿌리에서).

**새 앵커 — R3-1~R3-6 = 73~78.** 2차의 마지막 앵커가 72다(이 커밋에서 봤다).

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| R3-1 (73) | **세 길은 한 함수로 들어오고, 그 함수가 그 순간의 대상을 읽는다. 붙여 넣기만은 놓친 누름을 먼저 보고, 잠그기 전에 치던 칸을 확정한다.** `imageBlock`에 4.1의 `addImages`가 줄 단위로 글자 그대로 있다(`block`으로 잘라 견준다). 편집기에 `addImages(`의 호출이 정확히 셋(놓기, `pasteImages`, 버튼의 `addPickedImages`), `pasteImages(`의 호출이 정확히 둘(이벤트의 그림, 메인 프로세스 길), `planMapImageAdd(`가 정확히 둘(`addImages`, `answerPlacePrompt`), `resolveMapImageTarget(`이 정확히 셋이고 셋 다 `resolveMapImageTarget(snapshot, maps, current, selected)`다(`addImages`, `onFileDrag`, 덮개를 그리는 줄), `imageAdd.start(`가 둘, `imageAdd.say(`가 넷(`addImages`의 둘, `pasteImages`, `noteFieldPaste`). `answerPlacePrompt`에 `placePrompt.target`과 `placePrompt.sources`가 있고 `resolveMapImageTarget(`이 없다. `pasteImages`의 본문이 4.3의 두 줄이다 — `if (pressMissed.current && current) { pressMissed.current = false; imageAdd.say(current.id, MAP_IMAGE_PRESS_NOTE); return; }` 다음에 `addImages(sources);`. `notePress`의 줄이 `if (event.isPrimary && event.button === 0 && event.target instanceof Node && svgRef.current?.contains(event.target)) pressMissed.current = disabled;`이고, 그 리스너가 `window.addEventListener('pointerdown', notePress, true);`와 같은 꼴의 `removeEventListener`다. `imageAdd`를 만드는 줄들이 9.3의 글자다: `lock: on => { if (on) { const active = document.activeElement; if (active instanceof HTMLElement && active.matches(textFields) && active.closest('.bmap-inspector')) active.blur(); } setBusy(on); },`와 `idle: () => !pointerRef.current && !doc.isGestureActive() && !renamingRef.current && !polygon.length && !busy && !dialogOpen && !document.querySelector(openDialogs) });` | 창이 열린 채 받음(가드에서 `dialogOpen`을 뺌) / 막힌 대상에 말없이 돌아감(`say`를 뺌) / 받을 것이 없는데 장소 창을 띄움(순서를 바꿈) / 도는 중에 한 번 더 시작함(`running`을 뺌) / 장소 창의 답이 대상을 다시 읽음(창이 열린 사이 바뀐 선택에 들어간다) / 버튼의 길이 `addImages`를 건너 바로 `start`를 부름 / 대상이 편집기의 도면들을 받지 않음(`maps` 자리에 `snapshot.maps` — 다른 도면의 초안이 쓰는 장소가 골라져 뜬다) / 붙여 넣기가 `pasteImages`를 건너 `addImages`를 부름(저장 중에 놓친 누름 뒤의 그림이 바꾸려던 선택에 들어간다) / `pressMissed`를 끄지 않음(그 뒤의 붙여 넣기가 모두 거절된다) / 놓친 누름을 평면 밖에서도 적음(`svgRef` 검사를 뺌 — 저장 중에 버튼을 눌렀을 뿐인데 다음 붙여 넣기가 거절된다) / 받아들여진 누름이 값을 지우지 않음(`= disabled`를 `if (disabled) … = true`로) / `lock`이 칸을 떠나게 하지 않음(`blur`의 줄을 뺌 — 덜 친 수가 칸에 남은 채 커서만 빠진다) / `lock`이 풀 때도 떠나게 함(`if (on)`을 뺌) / `lock`이 버튼과 목록에서도 포커스를 뺌(`active.matches(textFields)`를 뺌 — `.bmap-inspector`에는 2차의 오브젝트 목록도 들어 있어, 그 줄·눈이나 속성 칸의 버튼에 있던 포커스가 `body`로 떨어지고 저장 뒤 F2·+·-·0이 편집기를 다시 누를 때까지 듣지 않는다 — 그 키들은 버튼에 포커스가 있어도 듣는 단축키다) / `lock`이 속성 칸 밖의 글자 칸에서도 커서를 뺌(`.bmap-inspector` 검사를 뺌 — 이미지 목록의 검색 칸에 치던 커서가 저장 실행이 시작될 때 빠진다) / `idle`에서 `polygon.length`나 `renamingRef`를 뺌(찍던 점이 버려지고, 치던 이름이 확정 없이 닫힌다) |
| R3-2 (74) | **놓기와 붙여 넣기의 가드, 읽는 것, 리스너.** `onFileDrag`와 그 두 effect, `onImagePaste`와 그 effect, `pasteClipboardFile`, `noteFieldPaste`가 4.2·4.3의 글자 그대로다(각각 `block`). 고정하는 것: `Array.from(data.types).includes('Files')`가 첫 가드에 있다 · `dragleave` 가지의 두 줄 — `const within = event.relatedTarget instanceof Node && !!rootRef.current?.contains(event.relatedTarget);`와 `if (!within && event.target === dragInside.current) { dragInside.current = null; setFileDrag(null); }` · 그 가지 바로 **뒤**의 `dragInside.current = event.type === 'drop' ? null : event.target;` · `event.preventDefault();`가 그 다음 줄이다 · `if (renamingRef.current) focusCanvas();`가 `preventDefault` 뒤, `dropEffect`의 줄 앞에 있다 · `dropEffect`의 줄이 `.blocked ? 'none' : 'copy';`로 끝난다 · `Array.from(data.files, …)`가 `drop`에서만 읽힌다 · `const disk = Array.from(data.types).every(type => type === 'Files');`와 `path: disk ? mapImageFilePath(file) : ''` · 뿌리에 거는 넷과 떼는 넷이 같은 이름·같은 함수다 · 둘째 effect가 `pointermove`·`pointerdown`을 `true`로 걸고 같은 깃발로 뗀다 · 붙여 넣기의 `facts`가 4.3의 여섯 값 그대로이고, `text`가 `!!element?.closest(textFields)`, `element`가 `event.target`에서 온다(`imageBlock`에 `document.activeElement`는 `lock`의 줄 한 번뿐이다) · 글자 칸 가지의 조건이 `root?.contains(element) && mapImagePasteWanted({ ...facts, text: false }) && !Array.from(event.clipboardData?.types ?? []).includes('text/plain')`이고 그 안이 `if (pictures) noteFieldPaste(); else if (!files.length) void pasteClipboardFile(true);` 한 줄, 그 가지의 끝이 `return;`이다 · `noteFieldPaste`가 `if (current) imageAdd.say(current.id, MAP_IMAGE_FIELD_NOTE);`뿐이다 · `event.clipboardData?.items`에서 `kind === 'file'`만 `getAsFile()` · `event.preventDefault();`가 `imageBlock`에 정확히 둘(끌기의 것, 붙여 넣기에서 그림이 있을 때의 가지 **안**의 것) · 그 가지가 `pasteImages(`를 부르고 마지막 가지가 `void pasteClipboardFile(false);`다 · `window.addEventListener('paste', onImagePaste);`와 같은 꼴의 `removeEventListener` · `pasteClipboardFile`의 가드가 `if (!found \|\| !root \|\| root.offsetParent === null \|\| pointerRef.current \|\| doc.isGestureActive()) return;`이고 그 다음 줄이 `if (inField) noteFieldPaste(); else pasteImages([{ kind: 'path', path: found.filePath }]);`다 · `backgroundReadClipboardFile(`의 호출이 편집기에 그 한 번이다. 편집기에 `navigator.clipboard`·`clipboardReadImage`·`onDrop=`·`onPaste=`가 없다 | 파일 없는 끌기에 덮개(첫 가드에서 `'Files'`를 뺌) / 자식을 넘을 때의 깜빡임, 두 길을 하나씩 — `within`을 뺌(차례가 달리 오는 엔진에서 깜빡인다) · `event.target === dragInside.current`를 뺌(`relatedTarget`을 싣지 않는 엔진에서 자식을 넘을 때마다 깜빡인다) · 둘을 `\|\|`로 이음(자식에서 자식으로 건널 때마다 덮개가 깜빡인다 — 편집기 밖으로 나갈 때는 그래도 꺼진다. 2026-10-15 Task 11이 바로잡음) / `dragInside`를 `dragenter`에서만 적음(창이 열려 있어 첫 `dragenter`를 놓친 끌기에서 덮개가 꺼지지 않는다) / `dragover`를 막지 않음(놓기가 오지 않는다) / 놓기 뒤에 `files`를 읽음(비어 있다) / 리스너를 떼지 않음 / 그물 effect를 뺌 / 막힌 대상에 `'copy'`('놓을 수 없음' 포인터가 사라지고, 덮개가 막혔다고 한 것을 놓을 수 있다) / 브라우저에서 끌어온 그림에 임시 경로를 적음(`disk`를 뺌) / 이름 칸을 닫는 줄을 뺌(그 칸을 연 채 놓은 넣기가 끝없이 기다린다) · 그 줄을 `drop`에서만 부름(덮개와 장소 창이 예전 이름을 말한다) / 가드의 `text`를 뺌(이름 칸에 붙여 넣은 글 대신 그림이 등록된다) / `text`를 `document.activeElement`에 물음(`select`에 포커스가 있을 때 달라지고, 검사가 보내는 사건과 진짜 사건이 다른 길을 간다) / `dialog`를 이벤트 대상에 물음(`element?.closest('dialog')`) / `dragging`을 뺌 / 그림이 없는데 `preventDefault` / 글자 칸 가지가 `preventDefault`를 부름 / 글자가 든 클립보드에도 글자 칸의 한 줄(`'text/plain'` 검사를 뺌 — 이름을 붙여 넣을 때마다 안내가 뜬다) / 편집기 밖의 글자 칸에서도 그 줄(`root?.contains`를 뺌) / 글자 칸에서 메인 프로세스에 묻지 않음(`pasteClipboardFile(true)`를 뺌 — 탐색기에서 복사한 그림 파일을 칸에 붙여 넣으면 다시 아무 말이 없다) · 글자 칸에서 물은 답으로 그림을 넣음(`inField`를 버림 — 칸에 커서를 둔 채 그림이 등록된다) / 탭을 떠난 뒤 돌아온 메인 프로세스의 답으로 넣음(`offsetParent` 검사를 뺌) / 끌기가 시작된 뒤에 온 답으로 넣음(시작의 스크롤이 끌던 것을 어긋나게 한다) / 붙여 넣기를 React의 `onPaste`로 옮김(대상이 `body`면 듣지 못한다) |
| R3-3 (75) | **실행은 올리기 → 잠근 채 저장 → 이어 주기이고, 하나씩 기다리며, 저장이 실패하면 남은 것을 보내지 않는다.** `useMapImageAdd.ts`의 `run`이 5.2의 글자다. 차례로: `if (running.current) return;` → `running.current = true;` → 올리기 반복문의 `const source = sources[item.index];`와 `await uploadBackgroundImage(source.file)` → `while (!quiet()) { await sleep(120); if (gone()) return; }` → `latest.current.lock(true);` → 바로 다음 줄 `try {` → `for (const command of mapImageSaves(plan, uploads, new Date().toISOString(), uuid)) {` → `await save(command,` → `stopped = why;`(그 줄 앞에 조건이 없다) → `const library = useBackgroundStore.getState().snapshot;` → `link = { place: plan.place, placeId: plan.placeId, cameraId: plan.cameraId, viewIds: [...plan.reused, ...added] };` → `if (mapImageLinkWanted(link, library)) {` → `await latest.current.link(plan.mapId, link, library)` → `} finally { latest.current.lock(false); }` → 바깥 `finally`의 `running.current = false;`. `lock(true)`와 `lock(false)`가 각각 정확히 한 번. `quiet`의 줄이 `!store.loading && !store.pending && latest.current.idle()`. `hush`의 줄이 `const hush = () => { if (!gone()) useBackgroundStore.setState({ error: null }); };`이고, `useBackgroundStore.setState(`가 파일에 그 한 번, `hush();`의 호출이 정확히 둘(`save`의 `catch`, 이어 주기의 `catch`)이다. `save`의 `catch`가 `catch (cause) { hush(); return !gone() && held(useBackgroundStore.getState().snapshot) ? '' : mapImageCauseText(cause); }`다. 답을 옮기는 줄이 5.2의 글자다(`tie = done.how === 'none' ? { link: done.complete ? 'none' : 'missed' } : { link: done.how, partial: !done.complete };`). 끝의 `setView`에 `...(link ? { live: { outcome, link } } : {})`가 있고, 결과의 줄들에 `reusedName: plan.reusedNames[0]`·`failed: failed.length`·`byPath: sources.some(source => source.kind === 'path')`가 있다. **`seq: now.seq + 1`이 파일에 정확히 둘**(`run`의 첫 `setView`, `say`)이고 끝의 `setView`에 `seq`가 없다. `if (gone()) return;`이 정확히 다섯 번(올리기의 성공과 실패, 기다림, 명령 하나 뒤, 저장 실행 뒤 — 5.2의 자리). `gone`이 `!alive.current`와 `actorId`를 둘 다 본다. `uploadFromPath`의 세 줄이 5.2의 글자이고(`if (!result.ok \|\| !result.url) throw new Error(`가 있다) `mapImageFilePath`가 `try { return window.electronAPI.getPathForFile(file) \|\| ''; } catch { return ''; }`다. 파일에 `Promise.all`·`Promise.allSettled`·`localStorage`·`sonner`·`shut`이 없고, `.execute(`의 호출이 `save` 안의 한 번뿐이다(`latest.current.execute(command)`). `MAP_IMAGE_ADD.addedMarkMs`의 타이머와 그 `clearTimeout` | 명령을 한꺼번에 보냄(`Promise.all` — 저장소가 둘째부터 거절한다) / 이어 주기를 배경 저장 앞으로(없는 배경을 가리켜 거절된다) / `lock(false)`를 `finally` 밖으로(던지면 편집기가 영영 잠긴다) / `quiet`를 기다리지 않음(끌던 것이 취소된다) / `quiet`에서 `idle()`을 뺌 / `lock(true)`와 첫 명령 사이에 기다림을 넣음 / 응답을 잃은 저장을 실패로 침(`held`를 뺌 — 들어간 그림이 "못 넣었어요"로 뜨고 그 뒤의 그림을 보내지 않는다) / 실패한 뒤에도 다음 그림을 보냄(`stopped = why;`에 조건을 닮 — 끊긴 연결에서 열 장이 열 번 기다린다) / 멈춘 뒤 이어 주지 않음(`if (!stopped && …)` — 들어간 그림이 초안에도 이어지지 않는다) / 이을 것이 없는데 이어 주기를 부름(`mapImageLinkWanted`를 뺌 — 저장되지 않은 새 장소를 두고 "이어 주지도 못했어요"라고 한다) / 이어 줄 때의 라이브러리를 반복문 앞에서 읽음(방금 저장한 배경이 없는 값이라 이어지지 않는다) / 실패한 저장이 켠 붉은 줄을 그대로 둠(`hush();`를 하나씩 뺌 — 껍데기가 붙은 글이 화면 위에 뜨고 도면이 줄어든다) / 떠난 화면이 저장소를 건드림(`hush`에서 `gone()`을 뺌 — 새 화면의 오류 줄을 지운다) · `held`를 `gone()` 없이 물음(떠난 뒤의 실패가 새 세션의 라이브러리로 "넣었다"가 된다) / 기다린 뒤 편집기의 옛 함수를 부름(`latest.current` 대신 `deps`) / `gone()` 하나를 뺌(떠난 화면이 새 세션에 쓴다) / `running`을 상태로 봄 / 실패한 그림을 `added`에 넣음(없는 배경을 카메라에 잇는다) / 올릴 파일을 반복의 번호로 집음(`sources[item.index]`를 뺌 — 거절된 파일이 앞에 있으면 남의 그림이 그 이름으로 올라간다) / 일부만 이은 것을 `'missed'`로 뭉갬(`partial`을 버림 — 초안이 바뀌었는데 '도면 저장'을 말하지 않는다) / 끝난 넣기가 연결을 싣지 않음(`live`를 뺌 — 줄이 낡는다) / 끝의 `setView`가 `seq`를 올림(넣기가 끝나는 순간 탭이 스크롤돼, 끌던 것이 어긋난다) / `uploadFromPath`가 `result.ok`를 보지 않음(올리지 못한 그림이 주소 없이 저장으로 간다) / `mapImageFilePath`가 던짐을 받지 않음 / '추가됨'의 타이머를 떼지 않음 |
| R3-4 (76) | **이어 주기는 도면의 변경이다: 초안이 있으면 초안에 한 번, 없으면 그 도면 하나의 바로 저장. 깨끗한 초안은 먼저 라이브러리의 것으로 다시 놓고, 초안에만 있는 연결에 기대는 넣기는 초안의 것으로 답한다.** `linkAdded` 조각의 줄이 5.4의 줄들과 한 줄씩 같다(주석을 지우면 머리줄에서 닫는 중괄호까지 열한 줄). 그 가운데: `const saved = library.maps.find(map => map.id === mapId), held = mapDraft(doc.getState(), mapId);` · `if (held && saved && !mapDraftChanged(held) && saved.revision > (held.baseRevision ?? Infinity)) doc.rebaseDrafts([saved]);` · `const draftNow = mapDraft(doc.getState(), mapId), base = draftNow?.value ?? saved;`(다시 놓은 **뒤**에 읽는다) · `const next = linkMapImages(base, link, library);` · `if (next.map === base) return { how: draftNow && next.complete && mapImageLinkNow(saved, base, link, library) === 'draft' ? 'draft' : 'none', complete: next.complete };`. 그 조각에 `updateMap(`이 정확히 한 번, `persistMaps(`가 한 번이고 `if (!draftNow)` 줄 안이다, `doc.rebaseDrafts(`가 한 번, `doc.getState()`가 네 번, `doc.followSaved(`가 없다(편집기 전체에 여전히 하나 — 앵커 56), 렌더의 `snapshot`·`current`·`draft`·`maps`가 없다 — 정규식은 `/(?<![.\w'])(?:snapshot\|current\|draft\|maps)\b/`다: 1차의 앵커 66의 것(`(?<![.\w])`)에 **작은따옴표를 더했다.** 이 함수는 `'draft'`라는 글자를 세 번 적으므로 따옴표가 없으면 그 글자에 걸려 설계의 글자가 스스로 떨어진다. `execute(`·`setError(`·`setNotice(`·`doc.beginEditing`이 없다. (`linkMapImages`·`mapImageLinkNow`의 규칙은 글자가 아니라 M-7이 돌려 본다.) 편집기에 8.5의 effect가 글자 그대로 있고(`doc.update(next, { history: false })`가 편집기에 그 한 번, 가드가 `disabled \|\| !snapshot.canManage \|\| doc.isGestureActive()`, 의존 목록이 `[knownViews, drafts, disabled, snapshot.canManage, gestureActive]`), 버리기 창의 덧붙는 식이 8.1의 글자로 물음의 한 줄 안(그 줄의 첫 `</p>` 바로 뒤)에 있으며, `linksAdded`의 줄이 `const linksAdded = useMemo(() => !!draft && !!current && mapLinksAdded(snapshot.maps.find(map => map.id === current.id), draft.value), [snapshot.maps, draft, current?.id]);`다 | 초안이 있는데 바로 저장함(다른 편집까지 저장되고 되돌리기 기록이 비워진다) / 초안이 없는데 편집을 시작함(`doc.beginEditing` — 띠가 뜨고, 화면을 떠나면 연결을 잃는다) / 라이브러리를 렌더의 `snapshot`에서 읽음(방금 저장한 배경이 없는 값이라 저장이 거절된다) / `linkMapImages`에 라이브러리를 주지 않음(그 사이 지워진 배경을 가리켜 저장이 거절된다) / 시점마다 `updateMap`(N단계가 된다) / 깨끗한 초안을 다시 놓지 않음(그 줄을 뺌 — 잠긴 사이 다른 PC가 저장한 도면에서 다음 '도면 저장'이 거절된다) · 저장 안 한 변경이 있는 초안까지 다시 놓음(`!mapDraftChanged(held)`를 뺌 — 편집이 말없이 사라진다) · 같은 버전에서도 다시 놓음(`>`를 `>=`로 — 넣을 때마다 다시 실행 기록이 비워진다) · 다시 놓기 전의 초안에 이음(`draftNow`를 그 줄 앞에서 읽음) / 초안에만 있는 연결에 기대는 넣기를 `'none'`으로 답함(그 줄의 앞 가지를 뺌 — 띠는 '저장 안 한 변경'인데 줄은 "바로 저장됐어요"다) · 그 답을 초안이 없을 때도 함(`draftNow &&`를 뺌) / 없는 배경을 빼는 effect를 저장 중에도 돌림 · 빈 라이브러리에 대고 돌림(`!snapshot.canManage`를 뺌 — 보관한 초안의 모든 시점이 빠진다) / 그 effect가 단계를 만듦(`history: false`를 뺌 — 띠의 수가 저절로 는다) / `linksAdded`의 두 인자를 맞바꿈(연결을 푼 초안에만 문장이 나온다) |
| R3-5 (77) | **장소 창은 `dialogOpen`에 들고, 연 때의 것만 다루며, 0.4초 뒤부터 새로 누른 것에만 답한다.** 편집기에 `placePrompt` 상태 줄(6.1)과 `{placePrompt && <MapImagePlacePrompt target={placePrompt.target} count={placePrompt.count} drafted={placePrompt.drafted} places={snapshot.places} onCancel={() => setPlacePrompt(null)} onConfirm={answerPlacePrompt} />}`가 있고, 그 줄은 `</main>}` 바로 다음 줄이며 그 다음 줄이 `{createForm && <BackgroundModal title=`로 시작한다(9.3 — 지금 보는 도면에 매달린 `<main>` 밖이라 그 도면이 없어져도 창이 남고, 앵커 66이 붙어 있기를 보는 줄들 사이가 아니다). `BackgroundMapImageAdd.tsx`에 6.3의 줄들이 글자 그대로: `const armed = useRef(false);`, `window.setTimeout(() => { armed.current = true; }, MAP_IMAGE_ADD.promptGraceMs);`, `return () => window.clearTimeout(timer);`, `submit`의 네 줄 — `if (!armed.current) return;`가 **첫 줄**이고 이어서 `if (mode === 'new') { if (name.trim()) onConfirm({ kind: 'new', name }); else setError('장소 이름을 적어 주세요.'); }` · `else if (places.some(place => place.id === placeId)) onConfirm({ kind: 'existing', placeId });` · `else setError('넣을 장소를 다시 골라 주세요.');` —, 그리고 `noRepeat`의 줄 `if (event.repeat && (event.key === 'Enter' \|\| (event.key === ' ' && event.target instanceof HTMLButtonElement))) event.preventDefault();`. 폼의 태그가 `<form onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={noRepeat}>`, 넣는 버튼이 `type="submit"`이고 `data-autofocus`가 그 버튼에 하나, `취소`가 `type="button"`이고 `onClick={onCancel}`, `<BackgroundModal title="배경 장소 정하기" onClose={onCancel}>`. 기본 선택의 두 줄(`target.sameNamePlaceId ? 'existing' : 'new'`, `target.sameNamePlaceId ?? places[0]?.id ?? ''`) — 그 값이 언제 있는가는 글자가 아니라 M-1이 본다. `mapImageDrop.ts`에 `promptGraceMs: 400`. 그 파일에 `addEventListener('keydown'`·`sonner`·`current`(렌더의 값)가 없다 | 창을 `dialogOpen`에서 뺌(창 밑에서 초안이 따라가고, 붙여 넣기가 또 들어온다) / 유예를 뺌 / 유예를 상태로 봄 / 유예를 취소에도 걺(Esc가 듣지 않는다) / Enter가 유예를 비켜 감(버튼을 `onClick`으로만 막음) / 누르고 있던 키가 유예 뒤에 답함(`onKeyDown={noRepeat}`를 뺌) · 새로 누른 Enter까지 막음(`event.repeat`를 뺌 — 키보드로 답할 수 없다) / 이름 칸에서 Space를 누르고 있을 수 없음(`HTMLButtonElement` 검사를 뺌) / 지워진 장소로 답함(`places.some`의 줄을 뺌 — 창이 닫힌 뒤 계획이 던져, 아무 말 없이 끝난다) / 빈 이름으로 답함(`name.trim()` 검사를 뺌) / 포커스를 이름 칸에 둠(K9를 뒤집을 때만) / 같은 이름의 장소가 있어도 새로 만들기가 기본 / 창이 `current`를 읽음 |
| R3-6 (78) | **표시는 목록 안, 움직임은 그 블록 안, 파일 창은 한 함수, 새 채널은 네 곳, 순수 모듈은 순수하다.** CSS: `.bmap-main {` 줄에 `position:relative`와 `overflow:clip`이 있고 `overflow:hidden`이 없다 · 7.6의 기본 규칙 **스물네 줄**(버리기 창의 문단 간격 `.bg-modal-content>.bmap-confirm-text+.bmap-confirm-text { margin-top:8px; }` 포함)과 `@keyframes` 두 줄이 줄 맨 앞에서 글자 그대로(각각 하나) · `.bmap-drop {` 줄에 `position:absolute`·`inset:0`·`pointer-events:none` · `.bmap-drop-label {` 줄에 `position:sticky` · `.bmap-drop-label>strong {` 줄에 `overflow-wrap:anywhere`가 있고 `text-overflow`·`nowrap`이 없다 · `.bmap-gallery-notice {` 줄에 `min-height:40px`·`flex:0 1 auto`가 있고 `align-items`·`flex-shrink:0`이 없다 · `.bmap-gallery-notice>div {` 줄에 `min-height:0`·`max-height:62px`·`overflow-wrap:anywhere` · `.bmap-gallery-step {` 줄에 `position:absolute` · `[data-color-mode="light"] .bmap-gallery-step>i { background:rgb(var(--color-text-secondary)); }`가 있다 · `.bmap-gallery-mark {` 줄에 `background:rgb(var(--color-bg-card))`·`color:rgb(var(--color-text-primary))`가 있고 `#fff`가 없다 · `bmap-gallery-ghost`가 든 줄 가운데 `opacity`가 든 것은 `.bmap-gallery-ghost .bg-thumbnail { opacity:.55; }` 하나다 · 새 클래스(`bmap-drop`·`bmap-gallery-ghost`·`bmap-gallery-notice`·`bmap-gallery-step`·`bmap-gallery-mark`·`bmap-gallery-add`·`bmap-place-choice`·`is-added`)가 든 줄 가운데 `animation`·`transition`이 든 것은 **둘째** `@media (prefers-reduced-motion: no-preference) {` 블록 안뿐이고 · 그 블록의 줄은 7.6의 넷뿐이며 `@keyframes`가 그 안에 없다 · 새 줄 어디에도 `backdrop-filter`·`infinite`·`font-style`이 없다 · 그 블록이 `.bmap-edit-strip>* { animation:`의 블록보다 **뒤**다. 갤러리: 앵커 58의 식이 그대로 있고 · 7.2의 줄들(`mine`, `jobs`와 `notice`, `scopedViews`, `confirmed`의 두 줄 — `const confirmed = useRef(snapshot);` · `if (!saving) confirmed.current = snapshot;` —, `noticeText`)과 `seen`의 effect — 7.2의 블록에서 주석을 지운 **일곱 줄**(`const seen = useRef(adding.seq);`부터 `}, [adding.seq]);`까지. 앵커는 이 파일을 `read`로, 주석을 지우고 읽는다: 머리의 주석 한 줄과 `scrollTop` 줄 끝의 주석이 빠진다) — 이 글자 그대로 있고 `scrollIntoView`가 파일에 그 한 번이다 · `noticeText`의 줄에 `mapImageOutcomeNow(`와 `confirmed.current`가 있고 `snapshot.maps`·`mapImageLinkNow(`가 없다 · **4.5의 `pickImages` 다섯 줄과 감춘 입력의 태그가 글자 그대로이고**(`multiple`이 있고, `onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) onAddFiles?.(files); }}` — 읽는 것이 비우는 것보다 앞이다) **`input.current?.click()`이 파일에 정확히 둘**이다 · 버튼의 태그에 `onClick={() => { if (!words.blocked) pickImages(); }}`가 있다 · `resolveMapImageTarget(snapshot, maps, current, selected)`가 파일에 하나다 · `{MAP_IMAGE_HINT}`·`role="status"`·`role="alert"`·`aria-disabled={words.blocked}`·`aria-label="안내 닫기"`·`{noticeText}`가 있고, `{notice.text}`·`편집 시작`·`sonner`·`createObjectURL`이 없다 · 흐린 카드의 태그 안이 `bmap-gallery-step` → `bg-thumbnail` → `bmap-gallery-mark` → `bmap-gallery-card-body`의 차례이고 표시의 글이 `{MAP_IMAGE_STEPS[job.step].label} · {index + 1}/{jobs.length}`다. 편집기: 덮개의 줄(7.1)이 `</BackgroundMapPanels>`와 `</main>` 사이에 있고 `<BackgroundMapPanels gallery={gallery}>`가 글자 그대로다. `gallery` 메모의 태그가 `adding={imageAdd.view} saving={pending} onAddFiles={addPickedImages} onDismissNotice={imageAdd.dismiss} /> : null,`로 끝나고 그 의존 목록이 `imageAdd.view, pending, addPickedImages, imageAdd.dismiss]);`로 끝난다. 채널: `electron/backgroundIpc.ts`에 `'background:read-clipboard-file'`과 `originFor(requestEpoch);` · `electron/clipboardFiles.ts`는 함수 하나만 잘라 본다 — `block(…, 'export function clipboardImageFilePath(readBuffer: (format: string) => Buffer): string \| null {')`에 `readBuffer('FileNameW')`가 있고 `CF_HDROP`이 없다(이 파일은 주석을 지우는 `read`의 폴더 밖이라 날것으로 읽는데, 파일 머리의 주석 :7-8에 `readBuffer('CF_HDROP')`라는 글자가 있다 — 그 길이 늘 비어 있다는 설명이다. 파일 전체에 묻으면 앵커가 스스로 떨어진다) · `electron/main.ts`에 `readClipboardFilePath: () => clipboardImageFilePath(format => clipboard.readBuffer(format)),`가 있고 `ipcMain.handle('clipboard:read-image-file'`의 핸들러가 지금의 글자 그대로다 · `electron/preload.ts`에 `backgroundReadClipboardFile: () => ipcRenderer.invoke('background:read-clipboard-file', canonicalSessionEpoch),`가 있고 `backgroundPickImages`가 **없다** · `src/types/index.ts`에 4.4의 두 줄 · mock에 `backgroundReadClipboardFile`·`__bflowMockBackgroundAdd`와 9.4의 `backgroundPickImages` 줄이 글자 그대로 있다. `mapImageDrop.ts`에 `from 'three'`·`document.`·`window.`·`@/`·`react`가 없다. `types.ts`·`domain.ts`·`mapWorkflow.ts`·`mapDocument.ts`·`mapStack.ts`·`useBackgroundStore.ts`·`featureFlag.ts`는 이 차례에 바뀌지 않는다(그 파일들에 `mapImage`라는 글자가 없다) | 덮개를 흐름 안에 둠(끌고 들어오는 순간 도면이 밀린다) / 덮개가 누름을 받음(끌기 사건이 편집기에 닿지 않는다) / 덮개를 도면 칸 안으로 옮김(좁은 창에서 목록 위로 끌면 보이지 않는다) / `animation`을 블록 밖에 둠('최소'에서도 움직인다) / `@keyframes`를 블록 안에 둠(빌드의 짝 만들기가 경고한다) / 새 블록을 띠의 블록 앞에 둠(앵커 54가 띠의 줄을 못 찾는다) / '추가됨'을 색만으로 · 강조색 위의 흰 글자로 / 흐린 카드 전체를 흐리게(글자가 묻힌다) / 막대를 흐름에 둠(흐린 카드가 3px 높다) / 단계의 글을 카드 아래쪽 줄에 둠(낮은 목록에서 잘린다) / 알림 줄을 목록 밖(도면 위)에 둠 / 저장된 그림이 흐린 카드와 함께 섬(`scopedViews`의 `.filter`를 뺌) / 갤러리가 다른 도면의 흐린 카드를 그림(`mine`을 뺌) / 없어진 도면의 넣기가 어디에도 보이지 않음(`mine`을 `=== current.id`로) / 알림 줄이 넣었을 때의 문장만 그림(`noticeText` 대신 `notice.text`) / 목록이 다시 그려질 때마다 스크롤(`seen` 없이 `if (adding.seq)`) / 빈 목록에 파일 창을 엶(`if (files)`를 `if (files?.length)`로) / mock에 묻기 전에 파일 창을 엶 / mock이 검사 창에서 `undefined`를 줌 / 흐린 카드가 PC 원본을 풀어 보임 / preload에 파일 고르기를 넣음 / 새 채널이 `CF_HDROP`을 읽음(늘 비어 있다) / 예전 클립보드 채널을 고침(캐릭터 현황판의 테스트가 떨어진다) / 순수 모듈이 DOM을 씀 / 감춘 입력이 값을 먼저 비우고 읽음(고른 파일이 늘 빈 목록이다 — 설치된 앱에서 버튼이 아무 일도 하지 않는다) · 입력에서 `multiple`을 뺌 · `onChange`가 `onAddFiles`를 부르지 않음 / 막힌 대상에서 버튼이 파일 창을 엶(`onClick`의 `words.blocked` 검사를 뺌) / 메모가 `adding`을 넘기지 않음 · 의존 목록에서 `imageAdd.view`를 뺌(목록이 얼어 흐린 카드도 알림 줄도 뜨지 않는다) / 저장 중의 낙관 값으로 줄을 읽음(`confirmed.current` 대신 `snapshot` — 띠가 `저장 중…`인데 줄이 먼저 "저장됐어요"라고 한다) · `saving`을 넘기지 않음 / 줄이 그림이 지워진 것을 읽지 않음(`mapImageOutcomeNow` 대신 넣었을 때의 `notice.text`) / 밝은 화면의 막대 줄을 뺌(막대의 길이가 보이지 않는다) / 알림 줄을 줄어들지 않게(`flex-shrink:0` — 낮은 목록에서 잘린다) · 글 상자에서 `overflow-wrap`을 뺌(빈칸 없는 긴 파일 이름에 가로 스크롤 막대가 생긴다) / 덮개의 제목을 말줄임표로 자름 / 버리기 창의 문단 간격 줄을 뺌(덧붙는 문단이 첫 문단에 붙는다) · 그 줄에서 `.bg-modal-content>`를 뺌(1차의 삭제 창에서 `.bmap-delete-lead` 안의 첫 문단들 사이가 `gap` 8px에 여백 8px이 더해져 16px이 된다) |

앵커는 **뮤테이션으로 확인**한다(저장소 밖 임시 복사본에서 표의 변형을 하나씩 넣어 실패하는지 본다 — 10.2).

### 9.3 파일 계획

| 파일(이름만 쓴 것은 `src/features/backgrounds/`) | 새로 · 고침 | 내용 |
|---|---|---|
| `mapImageDrop.ts` | 새로 | 3절·4.6·5.1의 순수 규칙과 문구 |
| `useMapImageAdd.ts` | 새로 | 컨트롤러(5.2) |
| `BackgroundMapImageAdd.tsx` | 새로 | `MapImageDropOverlay`(7.1) · `MapImagePlacePrompt`(6절) |
| `tests/backgroundMapImageDrop.test.ts` | 새로 | 10.1 |
| `BackgroundMapGallery.tsx` | 고침 | 7.2~7.4 |
| `BackgroundMapEditor.tsx` | 고침 | 아래 표 |
| `backgrounds-map.css` | 고침 | 7.6 |
| `electron/clipboardFiles.ts` · `electron/backgroundIpc.ts` · `electron/main.ts` · `electron/preload.ts` · `src/types/index.ts` | 고침 | 4.4 |
| `src/mocks/devElectronAPI.ts` | 고침 | 9.4 |
| `tests/backgroundMapEditorWiring.test.ts` · `tests/backgroundPersistence.test.ts` · `tests/backgroundImageFile.test.ts` | 고침 | 9.2 · 10.1 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 고침 | 11절 |

**`BackgroundMapEditor.tsx`에서 고치는 곳과 자리**(줄 번호는 `633e7afb`의 것 — 자리는 함께 적은 그 줄의 글자로 찾는다)

| 것 | 자리 | 걸리는 앵커 |
|---|---|---|
| import: `mapImageDrop`의 이름들(`mapImageSourceFacts`·`mapImageLinkNow`·`MAP_IMAGE_FIELD_NOTE`·`MAP_IMAGE_PRESS_NOTE` 포함), `useMapImageAdd`의 `MAP_IMAGE_IDLE`을 뺀 이름들(`mapImageFilePath`·`useMapImageAdd`와 타입 둘), `MapImageDropOverlay`·`MapImagePlacePrompt`. `mapDraftChanged`는 이미 들어와 있다(:22) | 맨 위 | — |
| 상태 `placePrompt`(6.1), `fileDrag`(`useState<'ok' \| 'type' \| null>(null)`) | 1차의 `mapDelete` 상태(:231-234 — `stopped: MapDeletePlan \| null } \| null>(null);`로 끝난다) 바로 다음, `const deleting = useRef(false);`(:235) 앞 | R3-5 |
| `dialogOpen`에 `\|\| placePrompt` | 1차의 그 줄(:283 — `gestureActive`(:281)와 그 줄의 주석(:282) 다음) | 65(고친다) |
| 오류 띠의 조건을 `!(dialogOpen && !placePrompt)`로(9.1) | 제자리(:1177 — 1차가 고친 그 줄 `{error && !dialogOpen && <div className="bg-error" role="alert" ref={errorRef}>{error}</div>}`) | 65(고친다) · 54(`<div className="bg-error" role="alert" ref={errorRef}>` 그대로) |
| `async function linkAddedImages(…)`(5.4) | **`uploadUnderlay`(:711-718) 바로 다음** — 1차의 `function dropGoneDrafts(`(:720)와 그 문서 주석(:719) 앞. `confirmAction` 조각(→ `async function createMap(`) 밖, 1차의 삭제 조각 넷 밖 | R3-4, 50(고친다) |
| **블록**: `const imageAdd = useMapImageAdd({ … });`(아래의 네 줄) → `addImages`(4.1) → `answerPlacePrompt` → `addPickedImages` → `pressMissed`·`notePress`와 effect → `pasteImages` → `noteFieldPaste` → `pasteClipboardFile` → `onImagePaste`와 effect(4.3) → `dragInside` → `onFileDrag`와 두 effect(4.2) → `knownViews`와 effect(8.5) | **`const openSpaceFrom3D = useEvent(…)`(:1118) 바로 다음, `const gallery = useMemo(`(:1119) 앞.** `keyboard` 조각은 `const selectNode = useEvent(`(:1060)에서 끝나고, 2차의 조각(`const setNodesHidden = useEvent(` :1063 → `const openView = useEvent(` :1089)과 1차의 `fieldScrub` 조각(`const beginFieldScrub = useEvent(` :1095 → `const placeAt = useEvent(` :1112)은 이보다 앞이다 | R3-1·R3-2·R3-4 |
| `gallery` 메모: 태그 끝에 `adding={imageAdd.view} saving={pending} onAddFiles={addPickedImages} onDismissNotice={imageAdd.dismiss}`, 의존 목록 끝에 `imageAdd.view, pending, addPickedImages, imageAdd.dismiss` | :1119-1120 | 36(그 메모의 앞부분은 보지 않는다 — `settledSelected` 줄만) · R3-6(태그의 끝과 의존 목록의 끝) |
| `const linksAdded = useMemo(…)`(8.1) | `draftChanged`(:1134) 옆 | R3-4 |
| 그리는 것 셋: ① 덮개(7.1) — `</BackgroundMapPanels>`(:1379) 다음, `</main>}`(:1380) 앞의 한 줄 ② 장소 창 — **`</main>}`(:1380) 바로 다음, `{createForm && <BackgroundModal title=`(:1381) 바로 앞의 한 줄**: 편집기의 다른 창들 **앞**이고, 지금 보는 도면에 매달린 `<main>` 밖이다. 삭제 창(:1407-1409)과 물음(:1410) 사이, 물음과 `</div>;`(:1411) 사이에는 두지 않는다 — 앵커 66이 설정 창의 끝 `</form></BackgroundModal>}` → 삭제 창 세 줄 → 물음 → `</div>;`가 붙어 있는지와, `{createForm && <BackgroundModal title=`부터 파일 끝까지 주석을 지운 것과 날것이 같은지를 본다(이 줄은 그 앞이다) ③ 버리기 창의 덧붙는 식(8.1) — 물음의 한 줄(:1410) 안, 첫 `</p>` 바로 뒤 | 제자리 | 54(`<BackgroundMapPanels gallery={gallery}>` 그대로) · 52(창 조각의 두 식 그대로, `setPolygon(`·`setTool(` 없음) · 66(위의 줄들이 그대로 붙어 있고 물음이 한 줄이다) · R3-5·R3-6 |

- `answerPlacePrompt` = `useEvent((choice: MapImagePlaceChoice) => { if (!placePrompt) return; setPlacePrompt(null); imageAdd.start(planMapImageAdd(snapshot, placePrompt.target, choice, placePrompt.sources.map(mapImageSourceFacts), new Date(), uuid), placePrompt.sources); })`. `addPickedImages` = `useEvent((files: File[]) => addImages(files.map(file => ({ kind: 'file' as const, file, path: mapImageFilePath(file), pasted: false }))))`.
- 블록의 첫 네 줄 — 글자 그대로다(R3-1):

```ts
  const imageAdd = useMapImageAdd({ execute, link: linkAddedImages,
    // As 도면 저장 does: what is being typed in a field of the inspector is settled by leaving it, before the fields go dead. A field that is disabled under the cursor gets no blur of its own.
    lock: on => { if (on) { const active = document.activeElement; if (active instanceof HTMLElement && active.matches(textFields) && active.closest('.bmap-inspector')) active.blur(); } setBusy(on); },
    idle: () => !pointerRef.current && !doc.isGestureActive() && !renamingRef.current && !polygon.length && !busy && !dialogOpen && !document.querySelector(openDialogs) });
```

- **`idle`이 보는 일곱**: 평면의 누름(`pointerRef`) · 문서의 제스처(3D 손잡이, 1차의 숫자·옆 그림 끌기 포함) · 평면의 이름 상자(`renamingRef` — 잠기면 치던 이름이 확정 없이 닫힌다) · **그리던 다각형**(`polygon.length` — 잠긴 동안의 누름은 버려져 찍은 점이 빠진다. 편집기의 모든 저장이 다각형을 그리는 동안에는 거절하는 것과 같은 까닭이다, :631, :672, :691, :522의 `if (polygon.length) { setError('그리는 중인 다각형을 …`) · 편집기 자신의 일(`busy`) · 편집기의 창(`dialogOpen`) · 그 밖의 열린 창(`openDialogs` — 배경 상세 창 등). 저장소의 읽는 중·저장 중은 컨트롤러가 직접 본다. 이름 상자와 다각형은 스스로 끝나지 않는 기다림이다 — 그동안 흐린 카드가 `저장 기다리는 중`이다(13.3). **속성의 글자 칸에 커서가 있는 것은 보지 않는다**(K7): 기다리게 하면 이름 칸에 커서를 둔 채 그림을 끌어다 놓은 넣기가 `저장 기다리는 중`에서 끝나지 않는다.
- **`lock`은 잠그기 전에 속성 칸에서 치던 것을 확정한다.** 편집기의 다른 저장은 모두 그렇게 시작한다: '도면 저장'과 Ctrl+S는 포커스를 도면으로 옮기고(`requestSave`의 `focusCanvas()`, :646 — "칸을 떠나면 치던 것이 확정된다"), 나머지는 버튼이나 창에서 시작해 칸이 이미 포커스를 잃었다. 저장 실행은 사용자가 고르지 않은 때에 잠그는 첫 길이라, 칸에 커서가 든 채 잠길 수 있다 — 엔진은 커서 밑에서 꺼지는 칸에 `blur`를 보내지 않으므로(읽은 것), 숫자 칸은 덜 친 글자를 쥔 채 남고(그 글자는 `onBlur`에서만 지워진다 — 1차가 그 줄들을 새 부품으로 옮겼다, BackgroundMapNumberField.tsx:57-62, 글자의 상태는 :24) 다음에 그 칸을 떠날 때 엉뚱한 때에 반영된다. 그래서 잠그기 **직전에**, 포커스가 속성 칸(`.bmap-inspector`) 안의 **글자 칸**(`textFields`, 편집기 :92 — 이름 칸·숫자 칸 같은 `input`, `select`)에 있으면 `blur()`를 부른다: `canEdit`이 아직 참인 때라 칸의 규칙이 그대로 돈다('도면 저장'을 누를 때와 같다) — 범위 밖의 수는 가장 가까운 한계 값으로 들어가고, 숫자가 아닌 덜 친 글자(빈 칸, `-`)는 버려져 칸이 지금 값을 다시 보이며(BackgroundMapNumberField.tsx:58-61), 이름 칸은 한 단계로 묶던 것을 끝내고(`doc.endCoalescing`), 조합 중이던 한글은 확정된다. 포커스를 도면으로 옮기지는 않는다(치던 손의 다음 글쇠가 도면의 단축키 — `+`·`-`·`0` — 가 된다). **글자 칸이 아닌 포커스는 건드리지 않는다** — 도면, 이미지 목록, 그리고 같은 `.bmap-inspector`(편집기 :1286-1378) 안이어도 2차의 오브젝트 목록(:1377 — 줄의 이름·눈 버튼)과 속성 칸의 버튼: 버튼에는 확정할 것이 없고, 떠나게 하면 포커스가 `body`로 떨어져 버튼에서도 듣던 편집기의 단축키(F2·`+`·`-`·`0`, 편집기의 `keyboard`)가 편집기를 다시 누를 때까지 듣지 않는다. 이 일은 `lock(true)`의 그 틱 안에서 끝나고, 확정된 값은 이어 주기가 읽는 초안(`doc.getState()`)에 들어 있다.
- **한 글자도 고치지 않는 본문**: `persistMaps`·`saveMap`·`requestSave`·`endEditing`·`leaveEditing`·`confirmAction`·`createMap`·`linkMap`·`saveSettings`·`openSettings`·`uploadUnderlay`·`navigate`·`select`·`keyboard`·`pointerDown`~`pointerUp`·`followSaved`·`onSaveKey`·`swallowSecondClick`, 뿌리 태그(`<div className="bmap-layout" ref={rootRef} onKeyDown={keyboard} tabIndex={-1}>`), 1차·2차가 더한 함수들. 편집기에 `doc.dispatch(`·`doc.selectMany(`·`setSavedNotice(`·`setError(`·`setNotice(`를 더하지 않는다. '편집 중'·'편집 시작'이라는 글자를 더하지 않는다.

**건드리지 않는 파일**: `src/features/playground/featureFlag.ts`(노출 범위) · `types.ts`·`domain.ts`·`mapWorkflow.ts`·`DEVLOG/migrations/**`(저장 계약 — 새 키도 새 명령도 없다) · `mapDocument.ts`·`mapEditSession.ts`·`useBackgroundMapDocument.ts`·`mapEditStatus.ts`·`BackgroundMapEditStrip.tsx`(문서와 띠 — 공개 호출 `getState`·`update`·`rebaseDrafts`만 쓰고, `mapDraft`·`mapDraftChanged`를 읽는다) · `mapGallery.ts`·`mapStack.ts`(범위 규칙, 평면의 점을 품은 공간 — `spacesAt`은 **부르기만** 한다) · `useBackgroundStore.ts`·`previewGateway.ts`·`BackgroundLibraryView.tsx`·`BackgroundUI.tsx`(저장소·창의 틀·올리기 — 이 기능의 실패한 저장이 켠 오류 글을 끄는 것은 저장소의 `setState`를 밖에서 부르는 한 줄이다, 5.2의 `hush`. `BackgroundLibraryView.tsx`는 2차가 편집기 태그에 `viewerId`를 더한 그대로다 — `pending`은 이미 편집기에 온다) · `BackgroundAssetDialog.tsx`·`BackgroundAssetPanel.tsx`·`fileLinks.ts`('배경 등록' 창과 그 그림 칸의 놓기 — 그대로다) · 3D 파일 셋과 `BackgroundMapPlanPreview.tsx`·`BackgroundMapPanels.tsx` · `electron/backgroundStorage.ts`·`electron/backgroundImageFile.ts`·`electron/backgroundStore.ts`(올리기·파일 읽기·RPC) · `backgrounds.css`·`src/index.css` · 1차·2차의 새 파일(`mapDelete.ts`는 **읽기만** 한다).

**의존(한 방향)**: `mapImageDrop.ts → (타입) types · mapStack(spacesAt) · mapDelete(mapDeleteCauseText)` / `useMapImageAdd.ts → mapImageDrop · BackgroundUI(uploadBackgroundImage) · useBackgroundStore · (타입) types` / `BackgroundMapImageAdd.tsx → BackgroundUI · mapImageDrop` / `BackgroundMapGallery.tsx → mapImageDrop · useMapImageAdd(타입과 MAP_IMAGE_IDLE)` / 편집기 → 넷 모두. Node로 도는 `mapImageDrop.ts`의 import는 `.ts` 확장자를 붙인다. 훅 파일과 `.tsx`는 이 폴더의 다른 파일처럼 쓴다.

### 9.4 미리보기 mock — `src/mocks/devElectronAPI.ts`

| 고치는 것 | 내용 |
|---|---|
| `DevPreviewWindow`(:202-205)에 훅 하나 | `__bflowMockBackgroundAdd?: { filePath?: (file: File) => string; clipboardFile?: string; pick?: () => File[] };` — 확인하는 쪽이 건다. 걸지 않으면 mock은 지금과 같다 |
| `getPathForFile`(:2653) | `(file: File) => (window as DevPreviewWindow).__bflowMockBackgroundAdd?.filePath?.(file) ?? ''` — 기본 `''`(`tests/backgroundImageFile.test.ts:140` 그대로 통과) |
| `backgroundReadClipboardFile`(새) | `async () => { requireBackgroundPreviewSession(); const filePath = (window as DevPreviewWindow).__bflowMockBackgroundAdd?.clipboardFile; return filePath ? { filePath } : null; }` — 기본 `null`. 훅에 예제 경로(`G:\공유 드라이브\JBBJ\배경\교실\교실_낮.png`)를 걸면 지금의 `backgroundReadImageFile` mock(:3758-)이 그 그림을 준다 |
| `backgroundPickImages`(새) | `async () => { const hook = (window as DevPreviewWindow).__bflowMockBackgroundAdd; return hook?.pick ? hook.pick() : /\bElectron\//.test(navigator.userAgent) ? [] : undefined; }` — 훅의 `pick`이 있으면 그 파일들. 없으면 **앱 엔진에서는 빈 목록, 브라우저 탭에서는 `undefined`**(화면의 파일 창이 열린다 — 손으로 볼 때). 앱 엔진에서 이 mock이 도는 곳은 preload를 싣지 않는 검사 창 하나뿐이므로(설치된 앱은 mock을 쓰지 않는다 — `installDevElectronAPI`는 `file:` 주소이거나 쓸 수 있는 `electronAPI`가 있으면 아무것도 하지 않는다, :2561-2563), **검사 창에서는 훅을 걸었든 아니든, 페이지를 새로 고쳤든 아니든 '＋ 이미지 추가'가 네이티브 파일 창을 열지 않는다.** 훅을 걸어야 안전한 것이 아니라, 걸지 않아도 안전하다 |
| `backgroundUploadImage`(:3752-3757) | 검사는 그대로 두고, 돌려주는 주소만 줄인다: 받은 data URL을 긴 변 480px 이하로 다시 그린 `image/webp`(품질 0.8)의 data URL(`Image` → `canvas` → `toDataURL`). 그리지 못하면(테스트의 가짜 `document` 등) 받은 것을 그대로 돌려준다. 까닭: 미리보기 저장소는 그림을 스냅샷과 요청 영수증에 한 번씩, 하나의 `localStorage` 값에 담는다(2.3) — 큰 그림 두세 장이면 한도를 넘어 넣기가 실패로 끝난다 |

mock의 권한 판정(역할 `admin`, :150-158)과 예제 경로는 그대로다.

### 9.5 다음 차례를 막지 않는 것

**보관(편집 상태와 저장 지키기 2차)** — 이 기능의 결과 가운데 잃을 수 있는 것은 초안에만 든 이어 주기다(화면을 떠나면 초안이 사라진다, `src/App.tsx:3301`). 보관이 그 틈을 닫는다. 컨트롤러는 문서의 공개 호출(`getState`·`update`·`rebaseDrafts`)과 편집기의 `updateMap`만 쓰므로 문서 저장소를 컴포넌트 밖으로 들어내도 고칠 것이 없고, 보관의 "이어서 편집" 창은 `dialogOpen`에 한 낱말로 든다. **보관한 초안은 읽지 않은 라이브러리에 대고 다듬으면 안 된다**: 초안이 화면보다 오래 살면, 저장소가 빈 라이브러리를 쥔 때(화면을 여닫을 때, 첫 읽기 전, 첫 읽기가 실패한 채)에도 초안이 있다 — 8.5의 effect는 그래서 편집 권한으로 읽은 라이브러리일 때만 돈다(`snapshot.canManage`). 그 가드가 없으면 보관한 초안의 카메라 시점이 화면을 열 때마다 모두 빠진다. **팀 공개** — 편집 권한이 넓어지면 붙여 넣기의 조건과 mock의 역할 판정·'관리자만' 문구를 그때 다시 정한다(13.3).

---

## 10. 테스트와 검증

순수 테스트는 모두 `node --test ./tests/background*.test.ts`(`npm run test:background`)에 들어간다. 새 파일의 첫 줄은 `import test from 'node:test';`이고 낱말 `skip`·`todo`가 없다(앵커 59).

### 10.1 순수 테스트

**`tests/backgroundMapImageDrop.test.ts`(새)** — 바탕 라이브러리: 장소 '학교' > '2-1 교실', 도면 둘(대표 장소가 있는 '2층', 없는 '별관' — 노드는 같다): 장소 있는 공간 '2-1 교실' · 장소 없는 공간 '창고' · 장소 없는 **잠긴** 공간 · **장소 있는 잠긴 공간** · 도로 · **'2-1 교실' 안에 그린 작은 장소 없는 방 '벽장'**(이 둘만 겹친다 — "맨 위 공간"이 "먼저 찾은 공간"·"장소가 있는 공간"과 갈리는 곳이다. 그 밖의 공간은 서로 겹치지 않게 놓는다) · 카메라 여덟 — **서 있는 자리와 속성(`spaceId`)을 따로 준다**: 장소 있는 공간 안에 서 있고 속성은 비어 있음 / '창고' 안에 서 있고 속성은 장소 있는 공간 / 어느 공간 안에도 서 있지 않고 속성은 장소 있는 공간 / 어디에도 서 있지 않고 속성도 비어 있음 / 잠김 / 장소 없는 잠긴 공간 안에 서 있음 / **'벽장' 안에 서 있음** / **장소 있는 잠긴 공간 안에 서 있음** · 기호 둘(**'창고'에 속함** / 소속 없음). **라이브러리(`snapshot.maps`)에 둘 수 없는 값은 대상 판정에 넘기는 도면 값(초안)에만 둔다** — 속성이 이 도면에 없는 id인 카메라, 없어진 장소를 가리키는 공간과 도면: 그런 도면이 라이브러리에 있으면 저장 검사가 던져(domain.ts:130-132) M-5·M-6의 모든 `applyBackgroundCommand`가 실패한다. 모든 판정은 **진짜** `domain.ts`·`mapGallery.ts`·`mapStack.ts`·`mapDocument.ts`·`mapWorkflow.ts`로 한다. id는 세는 함수로 만든다(부르는 차례는 5.1).

| # | 대상 | 확인하는 것 |
|---|---|---|
| M-1 | `resolveMapImageTarget` | 3.2의 표 전부. **`ready`와 `needs-place`의 줄은 값을 통째로 견준다**(`deepEqual` — 한 키만 보면 `cameraPlaceId`에 제 장소를 넣은 구현이 지나간다. `ready`의 값에는 `placeNodeId`·`placeKept`가 든다): 도면 없음 · 읽기 전용(둘 다 `name: ''`) · 아무것도(도면 — `cameraId: null`, `cameraPlaceId: null`, `placeNodeId: null`, `placeKept: true`) · 대표 장소 없는 도면(`needs-place`, `placeNodeId: null`, `parentPlaceId: null`) · 장소 있는 공간(`cameraPlaceId: null`, `placeNodeId` = 그 공간) · 그 공간이 잠겨도 `ready` · '창고'(`needs-place`, `placeWas: null`, `parentPlaceId` = 도면의 대표 장소) · 잠긴 '창고'(`locked-space`, `name`) · 도로 · 기호(**'창고'의 기호는 '창고'의 대상과 `deepEqual`이다** / 소속 없는 기호는 도면) · **카메라의 공간**: 장소 있는 방에 서 있으면 속성이 비어 있어도 그 장소(`cameraPlaceId` = 그 장소, `placeNodeId` = 그 방) / '창고'에 서 있으면 속성이 장소 있는 방을 가리켜도 도면의 대표 장소(`cameraPlaceId: null`, `placeNodeId: null`) / **'벽장'에 서 있으면 — 겹친 두 방의 맨 위는 작은 방이다 — '2층'에서는 도면의 대표 장소·`cameraPlaceId: null`, '별관'에서는 `needs-place`이고 `placeNodeId`가 '벽장'이다**('2-1 교실'의 장소로 `ready`가 되지 않는다) / **장소 있는 잠긴 방에 서 있으면 그 장소로 `ready`**(`placeNodeId` = 그 방) / 어디에도 서 있지 않으면 속성의 방 / 둘 다 없으면 도면 / 속성이 이 도면에 없는 id면 도면 · 잠긴 카메라 · 장소 없는 도면의 카메라(임자 = 서 있는 공간 / 어디에도 없으면 도면 / **잠긴 공간에 서 있으면 도면**) · 없어진 장소를 가리키는 공간(`needs-place`, `placeWas` = 그 id) · **없어진 장소를 가리키는 '창고'에 선 '별관'의 카메라**(`needs-place`, `placeNodeId` = '창고', `placeWas` = 그 id — 그 장소로 `ready`가 되지 않는다) · **대표 장소가 없어진 도면의 '창고'**(`parentPlaceId: null`) · **`placeKept`**: 받은 도면(초안)의 '창고'에만 장소가 이어져 있고 저장된 도면에는 없으면 `ready`이고 `placeKept: false`, 저장된 도면에도 있으면 `true` · `sameNamePlaceId`: 같은 부모 아래의 같은 이름(앞뒤 공백 무시)이고 어느 도면도 쓰지 않으면 → 그 장소 / **다른 부모 아래의 같은 이름뿐 → `null`** / **이 도면의 다른 공간이 쓰는 같은 이름 → `null`**(둘 다 '새 공간'인 두 방) — **그 연결이 받은 도면(초안)에만 있고 저장된 도면에는 없을 때도** / **다른 도면의 공간이 쓰는 같은 이름 → `null`** — 두 도면의 대표 장소가 같을 때, 두 도면 모두 대표 장소가 없을 때(부모가 `null`인 맨 위 장소), 그 연결이 `maps`에 넘긴 초안에만 있을 때, 저장된 도면에만 있을 때(`maps`의 초안은 풀었다) 각각 / 쓰던 공간이 어디에서도 연결을 잃으면 다시 그 장소 |
| M-2 | `mapImageTargetWords` · `mapImagePlaceWords` | 3.3의 열한 줄과 제목 셋, 6.2의 문장이 글자 그대로(카메라의 둘째 줄에 장소의 이름이 있고, 도로가 임자인 문장에 '공간'이라는 낱말이 없다 · 잠긴 두 문장에 `속성의 ‘위치·크기·잠금’에서`가 있다 · 장소 있는 공간·도면의 둘째 줄이 `placeKept`에 따라 둘이다 — 초안에만 이어진 장소면 `…'도면 저장' 때 저장돼요.`). 어느 문장에도 `편집 중`·`편집 시작`이 없다 |
| M-3 | `sortMapImageFiles` · `mapImageSourceFacts` · `mapImagePathFacts` · `mapImageDragRefused` · `MAP_IMAGE_REFUSAL_TEXT` · `mapImageRefusedList` | **파일은 `mapImageSourceFacts`를 지나 만든다**(페이지의 파일과 경로뿐인 파일을 값 통째로 한 번씩 견준다 — 경로뿐인 것은 `byPath`·`pasted`가 참, 크기와 고친 시각이 0). 4.6의 여섯 줄: 같은 파일 둘(경로가 `C:\x\e.JPG`와 `c:/x/E.jpg`) · **경로 없는 같은 이름인데 크기가 다르면 둘**, 이름·크기·고친 시각이 같으면 하나 · 한쪽만 경로가 있으면 둘 · 붙여 넣은 자료 둘은 둘 다 받는다 · 거절된 파일을 두 번 주면 목록에 한 번 · 20MB 정확히(받음)와 +1바이트(`size`) · `.psd`(형식 없음 → `type`) · GIF · 경로의 WebP(`webp-path`) · **`사진.PNG`·`그림.WEBP`의 경로**(형식이 `image/png`·`image/webp`) · 12장(받음 10, `over` 2) · **넘친 파일과 같은 파일을 한 번 더 주면 `over`가 그대로 2다** · **좋은 것 10장 뒤의 `.psd`**(`refused`에 `type`, `over` 0) · **사진 11장과 그 가운데에 낀 `.psd` 하나**(모두 12건 — 받음 10, `refused` 1, `over` 1). `accepted`와 `refused[].index`는 넘겨받은 목록에서의 자리다. 끌기 판정: 모두 못 넣는 형식 → 참, **받을 수 있는 것과 못 넣는 것이 섞임(`[png, gif]`) → 거짓**(하나라도 받을 수 있으면 놓게 둔다), 형식 없는 것이 섞임 → 거짓, 글자 항목만 → 거짓. `MAP_IMAGE_REFUSAL_TEXT`의 세 문장(4.6)이 글자 그대로이고, `mapImageRefusedList`가 받은 차례대로 파일 이름과 그 문장을 준다 |
| M-4 | `mapImageBaseName` · `uniqueMapImageName` | 4.6의 이름 표: `붙여 넣은 그림 14:05` · **`붙여 넣은 그림 09:07`**(두 자리) · 끌어다 놓은 `image.png`는 `image` · **붙여 넣었어도 제 이름이 있으면 그 이름**(`교실.png` → `교실`, `IMAGE.PNG` → `IMAGE` — 엔진의 이름은 소문자 그대로일 때만이다) · 경로가 있으면 붙여 넣었어도 파일 이름 · `교실_낮.v2.png` · **` 교실 .png` → `교실`**(앞뒤 공백) · 점이 없는 이름은 그대로 · `.png` → `이름 없는 그림` · 한글 159자 + 그림 글자 하나(대리 쌍)는 159자로 · ` (3)` · 160자 이름의 ` (2)`도 160자 · **번호를 붙이려고 자르는 자리에 대리 쌍이 걸리면 그 글자를 통째로 뺀다** · **자른 끝이 공백이면 그 공백을 지운다**(`가` 155자 + ` 나다`가 이미 있으면 `가` 155자 + ` (2)` — 공백이 둘이 아니다) |
| M-5 | 계획과 명령 — 초안 없음 | 대상 열(장소 있는 공간 · 도면 · 카메라 둘 · 기호 · '창고'에 새 장소 / 기존 장소 · 대표 장소 없는 도면에 새 장소 · 그 도면의 카메라 둘) × 그림 셋(경로 있는 PNG, JPG, 붙여 넣은 자료): `mapImageSaves`의 종류가 `[place?] view view view`이고 모두 `expectedRevision: null` · 명령마다 `validateBackgroundEntity`와 `applyBackgroundCommand`를 지난다(**중간 라이브러리가 모두 온전하다**) · 이어 주기는 `saveMapChanges(…, {}, [도면])`의 **도면 하나**, `expectedRevision` = 그 도면의 버전 · 끝난 라이브러리가 `validateBackgroundSnapshot`을 지난다 · **새 배경 셋이 `selectMapBackgroundViews`에서 넣은 그 범위에 보인다** — 카메라에 넣은 것은 그 카메라가 **서 있는 방**을 골랐을 때도 보인다(속성이 비어 있어도, 장소로). **만든 배경 하나를 5.3의 모습과 통째로 견준다**(변형·수정본의 id만 빼고) — 카메라 대상(`cameraPlaceId` = 그 장소)과 공간 대상(`null`) 각각. **장소가 필요한 카메라 둘의 `plan.cameraPlaceId`**: 임자가 공간이면 `placeId`, 도면이면 `null`. **`plan.place`를 통째로 견준다**: 장소 있는 공간 `{ nodeId: 그 공간, was: 그 장소 }` · 장소 있는 도면 `{ nodeId: null, was: 대표 장소 }` · '창고'에 새 장소 `{ nodeId: 창고, was: null }` · **없어진 장소를 쥔 '창고'**(초안 값) `{ nodeId: 창고, was: 그 id }`(`null`이 아니다). **`items[].index`는 넘겨받은 목록에서의 자리다**: `[스케치.psd, a.png, 같은 a.png, b.png]`의 계획에서 `items.map(item => item.index)`가 `[1, 3]`이고 `refused[0].index`가 0이다. **한 넣기 안의 이름**: `C:\a\교실.png` · `C:\b\교실.png` · 붙여 넣은 자료 둘 → `교실`, `교실 (2)`, `붙여 넣은 그림 14:05`, `붙여 넣은 그림 14:05 (2)`. **셋 가운데 둘만 올라갔을 때 저장되는 것은 정확히 그 둘**이다. '기존 장소'의 id가 라이브러리에 없거나 답이 없으면 던진다. 장소가 있는 공간·도면은 `linkMapImages`가 같은 객체다(연결은 `mapImageLinkNow`가 `'kept'`) |
| M-6 | 초안 | `createMapDocument` + `reduceMapDocument`: 다른 편집 하나 뒤에 그림 셋을 카메라에 이으면 `mapDraftSteps`가 **2**(넣기 = 한 단계) · 그 초안의 저장이 온전한 라이브러리를 만든다 · 되돌리기 한 번에 시점 셋이 빠지고 앞의 편집은 남으며 배경 셋은 라이브러리에 그대로다 · 제스처 중의 `update`는 버려진다(상태가 같은 객체) · **깨끗한 초안과 라이브러리의 더 새 버전**(5.4의 다시 놓기): 5판에서 연 깨끗한 초안, 라이브러리의 그 도면은 6판 — `rebase-drafts`로 다시 놓은 뒤 이으면 `baseRevision`이 6이고 단계가 1이며 그 초안의 저장이 통과한다(7판). 다시 놓지 않고 이으면 같은 저장이 `다른 사용자가 내용을 변경했습니다`로 던진다 · 저장 안 한 변경이 있는 초안은 그 조건(`!mapDraftChanged`)에 걸리지 않는다 |
| M-7 | `linkMapImages` · `mapImageLinkNow` · `mapImageLinkWanted` · `mapImageOutcomeNow` | 카메라 없음 · 잠김(`complete: false`, 같은 객체) · 한 번 잇고 다시 부르면 같은 객체 · 잠겼지만 이미 다 이어져 있으면 `complete: true` · 999개인 카메라에 둘(하나만 들어가고 `false`) · **이미 있는 시점 뒤에, 받은 차례대로 붙는다** · 공간의 장소: 놓임 / 다른 장소가 있으면 덮지 않음 / 잠김 / 잠겼지만 이미 그 장소 · 도면의 장소: 놓임 / **대표 장소가 이미 있으면 덮지 않는다** · **`was`**: 임자가 없어진 장소의 id를 쥐고 있고 `was`가 그 id면 놓인다 / 같은 임자에 `was: null`이면 건드리지 않는다(같은 객체, `false`) · **장소가 있던 대상의 연결**(`was` = 그 장소): 그대로면 같은 객체·`true`, 임자가 그 사이 다른 장소를 쥐었으면 같은 객체·`false`, 임자가 없어졌으면 `false` · 장소는 못 놓고 카메라만 이은 경우(`false`인데 도면은 바뀜) · **라이브러리에 없는 배경은 빠지고 `false`, 남은 것은 이어진다** · **라이브러리에 없는 장소는 놓지 않는다**(같은 객체, `false`). `mapImageLinkNow`: 초안에만 있으면 `'draft'` / 저장된 도면에도 있으면 `'kept'` / 되돌린 초안·초안 없음·도면 없음은 `'undone'` / 그 뒤에 지운 그림은 세지 않는다(셋 가운데 하나를 지워 초안이 그것을 놓았으면 여전히 `'draft'`) / **셋 다 지웠으면 `'gone'`** — 연결이 저장돼 있든, 초안에 있든, 되돌렸든 / `viewIds`가 처음부터 빈 연결(장소만 이은 것)은 `'gone'`이 아니다 / **장소가 초안에만 이어진 공간에 넣은 넣기**: `'draft'`, 그 초안이 저장되면 `'kept'`, 버리면 `'undone'` / 장소가 저장된 도면에 이어진 공간에 넣은 넣기: `'kept'`. `mapImageLinkWanted`: 그림이 있으면 참 / 장소를 새로 정했고 그 장소가 라이브러리에 있으면 그림이 없어도 참 / **새 장소가 라이브러리에 없으면 거짓** / **장소가 있던 대상에 그림이 없으면 거짓**. `mapImageOutcomeNow`: 온전한 `'draft'`만 따라간다(`'kept'`·`'draft'`·`'undone'`) / `partial`인 `'draft'`와 `'saved'`·`'none'`·`'missed'`·`'failed'`는 **받은 그 객체** / 그림을 모두 지웠으면 그 가운데 어느 것이든 `link: 'gone'` / 그림 없이 장소만 이은 `'draft'`도 따라간다 |
| M-8 | 같은 원본 · 다시 넣기 | 경로 있는 그림을 카메라에 넣은 뒤(연결은 버렸다고 치고) 같은 경로(대소문자·빗금이 다른)와 새 그림을 **이 차례로** 다시: `reused` 하나(`reusedNames`가 그 배경의 라이브러리 이름), `items` 하나이고 **그 `index`가 1**이다(새 그림은 목록의 둘째다), 이어 줄 id가 둘 · 다른 장소에서는 새 배경 · **같은 경로가 옛 `filePath`에만 있으면 같은 원본이 아니다** · 같은 이름은 `a (2)`·`a (3)` · **다른 장소의 같은 이름에는 번호가 붙지 않는다** · '창고'에 새 장소로 넣은 뒤 연결을 잃은 그 공간을 다시 대상으로 하면 `sameNamePlaceId`가 그 장소다 |
| M-9 | `mapLinksAdded` · `dropMissingViews` · `mapImagePasteWanted` | 같은 도면 → 거짓 · 연결을 푼 것만 → 거짓 · 시점 하나 더함 / 공간에 장소 / 도면에 대표 장소 → 참 · **저장된 도면에 없는 새 공간(장소 있음)과 새 카메라(시점 있음) → 참, 저장된 도면이 없을 때(`undefined`)도 같다**. 없는 id만 빠지고, 뺄 것이 없으면 같은 객체. 가드: 여섯이 다 맞으면 참, **하나씩 뒤집으면 모두 거짓**(4.3의 표). 글자 칸만 어긋난 값은 `text`를 거짓으로 바꾸면 참이 되고, 다른 것도 함께 어긋났으면(창이 열려 있다, 다른 탭이다) 바꿔도 거짓이다 — 글자 칸의 한 줄(K18)이 그 식으로 가른다 |
| M-10 | `mapImageSummary` · `mapImageBusyText` · `mapImageCauseText` · 상수 | 7.4의 표의 문장이 글자 그대로: 넣음 셋(카메라의 문장에 장소의 이름) · 이미 있음 둘(한 장 `…1장(‘교실 전경’)은…`, 여러 장 `…3장(‘교실 전경’ 외 2장)은…` — 둘 다 '이미지파일 연결'의 문장이 따른다) · 0장 · **지워짐 셋**(대상마다 — 그 문장에 `넣었어요`·`이미 있는`과 이어 주기의 조각이 없다) · **넣지 못함**(`2장은 넣지 못했어요(아래 목록).`) · 이어 주기, 그림이 있을 때 아홉(`draft` · `draft`와 `partial` · `saved` · `saved`와 `partial` · `kept` · `undone` · `missed` · `failed` — 까닭이 `까닭: ` 뒤에 오고 괄호가 없다 · `none` — `바로 저장됐어요.`이고, 새로 넣은 것이 없으면(`added: 0`) 그 조각이 없다) · **잇는 길 셋**(카메라·공간·도면 — `missed`·`failed`·`partial` 둘의 끝에 있고, 그 밖의 문장에는 없다) · **이어 주기, 그림이 없을 때 여섯**(`‘창고’ 장소를 도면에 이어…` — `그림은`으로 시작하는 조각이 없다) · `over` · **복사한 파일**(`byPath`) · 도는 동안의 문장 셋(끝에 '다른 메뉴로 가면'). **조각을 모두 가진 한 문장을 통째로 견준다**(넣음 2 · 이미 있음 1 · 넣지 못함 1 · `draft` · 넘침 2 — 차례가 표의 차례다): `‘카메라 2’의 시점으로 그림 2장을 ‘2-1 교실’ 장소에 넣었어요. 이미 있는 그림 1장(‘교실 전경’)은 새로 만들지 않았어요. 그림을 고쳤다면 그 카드를 열어 '이미지파일 연결'로 새 수정본을 넣어 주세요. 1장은 넣지 못했어요(아래 목록). 그림은 바로 저장됐고, 도면에 이어 준 것은 '도면 저장'을 눌러야 남아요. 한 번에 10장까지예요. 나머지 2장은 넣지 않았어요.` **이미 있는 것만 다시 이은 초안의 문장**(`added: 0`, `reused: 1`, `draft`)에 `그림은 바로 저장됐고`가 없다 · 새 장소만 이은 문장(`added: 0`, `reused: 0`, `failed: 3`, `saved`)이 `넣은 그림이 없어요. 3장은 넣지 못했어요(아래 목록). ‘창고’ 장소를 도면에 이어 준 것은 바로 저장됐어요.`다. **그림이 있는 넣기의 `failed`·`missed`·`undone`·`gone` 문장에는 `바로 저장됐어요`가 없다**(이어지지 않은 넣기가 다 저장된 것처럼 읽히지 않는다) · `MAP_IMAGE_FIELD_NOTE`·`MAP_IMAGE_PRESS_NOTE`·`MAP_LINKS_LOST_NOTE`의 글자(뒤의 것에 `도면의 대표 장소`가 있고 `넣은 그림`이 없다) · 이 모듈이 내는 어느 문장에도 `편집 중`·`편집 시작`이 없다 · 껍데기를 쓴 한글 오류는 한글만, 영어 오류는 `서버에서 답을 받지 못했어요. …` · `MAP_IMAGE_STEPS`의 다섯 단계 · `MAP_IMAGE_DEFAULTS`(`wide` · `day` · `낮`) · `MAP_IMAGE_ADD`의 값(10 · 20MB · 6000 · 400) |

**그 밖의 파일에 더하는 것**

| 파일 | 더하는 테스트 |
|---|---|
| `tests/backgroundPersistence.test.ts` | `background:read-clipboard-file` 핸들러(지금의 `load('electron/backgroundIpc.ts')` 꼴): 낡은 epoch → `/세션/`으로 거절하고 읽개를 부르지 않는다 · 읽개가 없으면 `null` · 읽개가 `null`이면 `null` · 경로를 주면 `{ filePath }` · **`store.read`를 한 번도 부르지 않는다** |
| `tests/backgroundImageFile.test.ts` | `clipboardImageFilePath`를 **가짜 읽개**로: 읽은 형식 이름이 정확히 `['FileNameW']` · 한글 경로의 PNG → 그 경로 · `.WEBP`·`.gif` → 그 경로(화면이 까닭을 말한다) · `.psd`·확장자 없음·빈 버퍼 → `null` · 읽개가 던지면 `null` · 경로 둘이 실린 버퍼 → 첫째. 그리고 mock(지금의 묶어 돌리는 꼴, :118-141): 로그인 전의 `backgroundReadClipboardFile` → `/로그인/` · 기본 `null` · 훅을 걸면 그 경로 · **`backgroundPickImages()`**: 지금의 가짜 `navigator`(`{}` — 브라우저 탭의 길)로는 훅이 없을 때 `undefined`, 빈 훅 객체여도 `undefined`, 훅의 `pick`이 있으면 그 파일들. **`userAgent`에 `Electron/33.0.0`이 든 가짜 `navigator`로 한 번 더 묶어 돌리면 훅이 없어도·빈 훅 객체여도 `[]`**(검사 창의 길 — 파일 창을 열라는 답이 나오지 않는다), `pick`이 있으면 그 파일들 · `getPathForFile`이 훅의 값을 준다. **:140의 줄은 그대로 통과한다** |

`npm run test:character`(캐릭터 현황판 — `clipboardReadImageFile`의 타입과 mock을 글자로 본다)가 고치지 않고 통과해야 한다.

### 10.2 뮤테이션

앵커와 순수 테스트의 표본을 **저장소 밖 임시 복사본**에서 하나씩 깨뜨려 실패하는지 본다. 9.2의 변형 전부와, **살아남기 쉬운 것 — 반드시 넣어 본다**: (1) `linkAddedImages`의 두 가지를 맞바꿈(초안이 있을 때 바로 저장) (2) 그 함수가 `library` 대신 `snapshot`을 씀 (3) `run`에서 `lock(false)`를 `finally` 밖으로 (4) `quiet`에서 `latest.current.idle()`을 뺌 (5) `save`의 `held` 검사를 뺌 (6) 이어 줄 id에 실패한 것까지 넣음(`uploads.map(…)`) (7) `gone()` 가운데 명령 뒤의 것을 뺌 (8) `mapImageSaves`가 장소를 배경 뒤에 둠(M-5) (9) `linkMapImages`의 `was` 검사를 `=== null`로(M-7의 `was` 두 줄 — 없어진 장소의 id를 쥔 임자) / `planMapImageAdd`가 `was`를 늘 `null`로 · 장소가 있던 대상에 `place`를 싣지 않음(M-5의 `plan.place` 통째 비교) (10) 같은 함수에서 잠긴 카메라 검사를 뺌(M-7) (11) `resolveMapImageTarget`이 장소 없는 공간에 도면의 대표 장소를 씀(M-1 · M-5의 "그 범위에 보인다") (12) 카메라의 `cameraPlaceId`를 늘 `placeId`로(M-1) (13) `sortMapImageFiles`의 20MB를 `>=`로(M-3) (14) 붙여 넣은 자료 둘을 같은 파일로 침(M-3) (15) `mapImageBaseName`이 확장자를 모두 뗌(`교실_낮.v2` → `교실_낮`, M-4) (16) `planMapImageAdd`가 다른 장소의 배경까지 같은 원본으로 찾음(M-8 — "새 장소에서도 찾음"은 넣지 않는다: 막 만든 id 아래에는 배경이 없어 어떤 테스트로도 가를 수 없는 같은 동작이다) (17) `mapLinksAdded`가 "다르면 참"(M-9의 푼 것만) (18) `mapImagePasteWanted`에서 `text`를 뺌(M-9) (19) 붙여 넣기 핸들러가 `preventDefault`를 가지 밖에서 부름(R3-2) (20) `onFileDrag`의 `dragleave` 가지에서 두 검사를 하나씩 뺌(`within` / `event.target === dragInside.current`) · 둘을 `||`로 이음 · 이름 칸을 닫는 줄을 뺌(R3-2) (21) `submit`의 `armed` 줄을 뺌 / `armed`를 상태로 / `places.some`의 줄을 뺌 / 폼에서 `onKeyDown={noRepeat}`를 뺌 · `noRepeat`에서 `event.repeat`를 뺌(R3-5) (22) `dialogOpen`에서 `placePrompt`를 뺌 / 오류 띠의 조건을 `!dialogOpen`으로 되돌림(65) (23) 8.5의 effect에서 `disabled` 가드를 뺌 / `!snapshot.canManage`를 뺌 / `history: false`를 뺌(R3-4) (24) CSS의 `animation` 줄 하나를 블록 밖으로 / 새 블록을 띠의 블록 앞으로(R3-6 · 54) (25) `clipboardImageFilePath`가 `'CF_HDROP'`을 읽음(10.1) (26) 핸들러가 epoch를 보지 않음(10.1) (27) 갤러리의 `mine`을 뺌(다른 도면의 흐린 카드) / `mine`을 `=== current.id`로(없어진 도면의 결과가 사라진다)(R3-6) (28) mock의 `backgroundPickImages`가 앱 엔진에서 훅 없이 `undefined`를 줌(10.1 — 검사 중에 진짜 파일 창이 뜬다) (29) `pickImages`의 `if (files)`를 `if (files?.length)`로 / mock에 묻기 전에 `input.current?.click()`(R3-6 — 같은 까닭) (30) 카메라의 공간을 `spaceId`부터 봄(M-1의 "'창고'에 선 카메라") / 맨 위가 아니라 맨 아래 공간을 봄(`spacesAt(…).at(-1)`) · 그 점을 품은 공간 가운데 장소가 있는 첫 공간을 봄 · 노드의 차례로 첫 공간을 봄(셋 다 M-1의 '벽장'에 선 카메라) / 장소 없는 공간의 기호를 도면으로 보냄(M-1의 "'창고'의 기호") / 잠긴 방에 선 카메라가 그 방을 건너뜀(M-1의 "장소 있는 잠긴 방") / 없어진 장소를 쥔 공간을 임자로 치지 않음 · `placeWas`를 `null`로(M-1의 '별관'의 카메라) / `parentPlaceId`를 도면의 `placeId` 그대로 씀(M-1의 "대표 장소가 없어진 도면") / `placeKept`를 늘 참으로 · `ready`의 `placeNodeId`를 늘 `null`로(M-1의 통째 비교) (31) 공간·도면 대상의 `cameraPlaceId`에 제 장소를 넣음(M-1의 통째 비교) (32) 장소가 필요한 카메라의 `cameraPlaceId`를 늘 `null`로 / 늘 새 장소로(M-5) (33) `buildMapImageView`가 `cameraPlaceId`를 버림 / `relatedPlaceIds`에도 넣음(M-5의 통째 비교) (34) `mapImageSaves`가 올리지 못한 그림의 명령도 냄(M-5의 "셋 가운데 둘") (35) `mapImagePathFacts`가 확장자를 적힌 그대로 읽음(`사진.PNG`가 거절된다, M-3) (36) 없어진 장소를 가리키는 공간에 선 카메라를 `ready`로(M-1) (37) `mapLinksAdded`가 저장된 도면에 없는 노드를 건너뜀(M-9) (38) `linkMapImages`가 도면의 대표 장소를 덮음 / 라이브러리를 보지 않음 / 새 시점을 앞에 붙임(M-7) (39) `mapImageLinkNow`가 저장된 도면을 보지 않음 / 지운 그림도 셈(M-7) (40) `findSameSourceView`가 옛 `filePath`도 견줌(M-8) (41) 제 이름으로 붙여 넣은 파일을 `붙여 넣은 그림`으로 / 시각의 앞자리 0을 뺌 / 번호 자리에서 대리 쌍을 가름(M-4) (42) 이름의 겹침을 라이브러리 전체에서 봄(M-8) / 10장의 한도를 형식·크기보다 먼저 물음 / 경로 없는 파일을 이름만으로 같은 파일로 침(M-3) (43) `sameNamePlaceId`를 부모를 보지 않고 찾음 / 쓰는 장소도 내놓음 / **"쓰는 장소"를 이 도면에서만 봄**(다른 도면의 '복도'가 골라져 뜬다) / 저장된 도면에서만 봄(받은 도면과 `maps`의 초안을 보지 않음 — 이름을 고치지 않은 두 '새 공간'의 둘째가 첫째의 장소로 뜬다) / 편집기의 도면에서만 봄(초안이 풀어 둔, 저장된 연결을 보지 않음) — 넷 다 M-1 (44) 갤러리의 `scopedViews`에서 `.filter`를 뺌(R3-6 — 저장된 그림이 흐린 카드와 함께 선다) (45) `run`의 끝의 `setView`가 `seq`를 올림 / 갤러리의 `seen`을 빼고 `if (adding.seq)`로(R3-3 · R3-6) (46) `run`의 `stopped = why;`에 조건을 닮(실패한 뒤에도 다음 그림을 보낸다) / 멈춘 뒤 이어 주지 않음 / `mapImageLinkWanted` 검사를 뺌 / `partial`을 버리고 `'missed'`로 / `hush();`를 하나씩 뺌 · `hush`에서 `gone()`을 뺌 / 끝의 알림에서 `live`를 뺌 / `sources[item.index]`를 반복의 번호로(R3-3) (47) 붙여 넣기의 글자 칸 가지에서 `'text/plain'` 검사를 뺌 / 그 가지에서 `pasteClipboardFile(true)`를 뺌 / `pasteClipboardFile`이 `inField`를 버림 / 끌기의 `disk`를 뺌 / `pasteClipboardFile`의 끌기 검사를 뺌(R3-2) (48) `linkAdded` 조각의 정규식에서 작은따옴표를 뺌 — **앵커가 설계의 글자에서 떨어져야 한다**(R3-4: 앵커 자신의 확인) (49) **`items[].index`를 받은 것끼리의 차례로**(`sorted.accepted.map((fileIndex, index) => ({ index, … }))`) / **새로 만들 것끼리의 차례로**(둘 다 M-5의 `[1, 3]`과 M-8의 `index`가 1 — 앞에 거절된 파일이나 같은 원본이 없으면 세 번호가 같아 갈리지 않는다) (50) 이름의 겹침을 그 넣기의 앞 그림에서 보지 않음(M-5의 한 넣기 안의 이름) / 이름의 앞뒤 공백을 지우지 않음 · 번호를 붙이려고 자른 끝의 공백을 남김 · 엔진의 이름을 대소문자 없이 견줌(M-4) / 끌기 판정을 "하나라도 못 넣으면 참"으로(M-3의 `[png, gif]`) · 끌기 판정이 파일 항목이 없어도 참(M-3의 글자 항목만 — "모두"가 빈 목록에 저절로 참이 된다) / 넘친 파일의 겹침을 `over`에 다시 셈(M-3) (51) `mapImageLinkNow`가 `'gone'`을 내지 않음 · 그림 없이 장소만 이은 연결을 `'gone'`으로 · 장소가 초안에만 이어진 공간의 넣기를 `'kept'`로(M-7) / `mapImageOutcomeNow`가 `'saved'`나 `partial`인 `'draft'`를 따라감 · 그림이 모두 지워진 `'saved'`를 그대로 둠(M-7) / `mapImageLinkWanted`가 늘 참 · 새 장소가 라이브러리에 없어도 참(M-7) (52) 요약이 그림 없는 넣기에 `그림은 … 장소에 있어요`를 붙임 / 지워진 넣기에 `넣었어요`를 남김 / 잇는 길을 뺌 · 모든 문장에 붙임 · 대상을 가리지 않고 한 문장으로 / 까닭을 괄호에 넣음 / 넣지 못한 수를 문장에서 뺌 / 다시 쓴 배경의 이름을 뺌(M-10) (53) `linkAddedImages`에서 다시 놓는 줄을 뺌 · `!mapDraftChanged(held)`를 뺌 / 초안에만 있는 연결을 `'none'`으로 답함(R3-4 · M-6) (54) `lock`에서 `blur`의 줄을 뺌 · `lock`에서 `active.matches(textFields)`를 뺌(오브젝트 목록의 줄에 있던 포커스가 떨어진다) / `idle`에서 `polygon.length`를 뺌 / 붙여 넣기가 `pasteImages`를 건너뜀 · `pressMissed`를 끄지 않음(R3-1) (55) 감춘 입력이 값을 먼저 비움 · `multiple`을 뺌 / `gallery` 메모가 `adding`을 넘기지 않음 · 의존 목록에서 `imageAdd.view`를 뺌 / `noticeText`가 `confirmed.current` 대신 `snapshot`을 읽음 / `linksAdded`의 두 인자를 맞바꿈(R3-6 · R3-4).

### 10.3 수동 검증 (앱 엔진: Electron 33)

방법은 1차와 같다: `npm run dev:renderer` + 화면 밖 검사 창(Electron 33 = Chromium 130, `http://127.0.0.1:5190/?preview=1`, 미리보기 시험 계정), 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고 나머지 세 조합에서는 ★를 다시 본다. 저장 모양을 바꾸지 않으므로 미리보기 저장소를 다른 세션과 함께 써도 된다.

**이 검사는 한솔의 데스크톱 세션에서 돈다. 지킬 것 셋**: ① **시스템 클립보드를 읽지도 덮어쓰지도 않는다** — `navigator.clipboard`, `webContents.paste()`·`copy()`, Electron의 `clipboard` 모듈, 실제 Ctrl+V 키 입력을 쓰지 않는다(키 입력은 진짜 붙여 넣기를 일으킨다). 붙여 넣기는 가짜 `ClipboardEvent`로만 넣는다 ② **네이티브 파일 창을 띄우지 않는다 — 절차가 아니라 장치 둘로 막는다.** (가) 검사 창에서 mock의 `backgroundPickImages`는 훅을 걸지 않아도, 페이지를 새로 고친 뒤에도 빈 목록을 준다(9.4 — E0에서 먼저 본다): '＋ 이미지 추가'는 무엇을 잊어도 파일 창을 열지 않는다. (나) 검사 도구는 **페이지가 실릴 때마다**(`dom-ready`) 아래의 가드를 건다 — 파일 입력에 닿는 누름을 창 단위에서 막고 센다. mock을 지나지 않는 **기존의 파일 입력 셋**('배경 등록'·상세 창의 '이미지파일 연결' BackgroundAssetDialog.tsx:262, 그 창의 파일 고르기 :325, 도면 설정의 '도면 밑그림' BackgroundMapEditor.tsx:1400)도 이 가드에 걸린다. 그 셋은 그래도 **누르지 않는다**: 파일을 줄 때는 그 입력에 `files`를 넣고 `change`를 보낸다(`input.files = carry([pic('x.png')]).files; input.dispatchEvent(new Event('change', { bubbles: true }))`). 검사가 끝났을 때 `window.__fileDialogs`는 0이어야 한다(0이 아니면 그 줄에서 파일 창이 뜰 뻔한 것이다 — 기록한다) ③ 진짜 OS 끌기를 만들지 않는다 — 가짜 `DragEvent`로만 넣는다.

```js
// 가드 — 검사 도구의 메인 쪽에서: win.webContents.on('dom-ready', () => win.webContents.executeJavaScript(guard)). 새로 고쳐도 다시 걸린다.
addEventListener('click', event => { if (event.target instanceof HTMLInputElement && event.target.type === 'file') { event.preventDefault(); window.__fileDialogs = (window.__fileDialogs ?? 0) + 1; } }, true);
// 준비 — 검사 창의 페이지에서. 그림은 페이지에서 만든다(디스크의 파일도 클립보드도 쓰지 않는다). 훅은 [버튼]·[클립]·[경로]의 줄에서만 건다.
const pic = (name, type = 'image/png', width = 320) => { const c = document.createElement('canvas'); c.width = width; c.height = 200; const g = c.getContext('2d'); g.fillStyle = `hsl(${Math.random() * 360} 60% 50%)`; g.fillRect(0, 0, width, 200);
  return new File([Uint8Array.from(atob(c.toDataURL(type).split(',')[1]), ch => ch.charCodeAt(0))], name, { type, lastModified: Date.now() }); };
const carry = files => { const data = new DataTransfer(); for (const file of files) data.items.add(file); return data; };
const drag = (type, files, onto = document.querySelector('.bmap-canvas, .bmap-3d-main'), relatedTarget = null) => onto.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, relatedTarget, dataTransfer: carry(files) }));
const over = (files, onto) => { drag('dragenter', files, onto); return drag('dragover', files, onto); };                    // 끌고 들어와 그 위에 있다
const drop = (files, onto) => { over(files, onto); return drag('drop', files, onto); };                                       // 받는 대상에서만
const leave = (files, from) => drag('dragleave', files, from);                                                                // 막힌 대상에서 놓았을 때, 창 밖으로 나갈 때 엔진이 보내는 것 — 마지막으로 들어간 그 요소에, relatedTarget 없이
const cross = (files, from, to, related = to) => { drag('dragenter', files, to, from); drag('dragleave', files, from, related); return drag('dragover', files, to); };   // 자식에서 자식으로: 들어가는 쪽이 먼저다
const paste = (files, onto = document.body, text = '') => { const data = carry(files); if (text) data.setData('text/plain', text); return onto.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); };
const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], '큰 그림.png', { type: 'image/png' }), psd = new File(['x'], '스케치.psd', { type: '' }), gif = new File(['x'], '움짤.gif', { type: 'image/gif' });
```

- 표의 꼬리표: **[끌기]** = 위의 `over`·`drop`·`leave`·`cross`(핸들러가 읽는 `dataTransfer.types`·`items`·`files`, `relatedTarget`, 사건의 대상을 그대로 지난다. `leave`는 **마지막으로 `over`한 그 요소**에 보낸다 — 인자를 주지 않으면 둘 다 도면이다) · **[붙임]** = `paste`(핸들러가 읽는 `clipboardData.items`·`types`와 사건의 대상을 지난다) · **[버튼]** = `window.__bflowMockBackgroundAdd = { pick: () => [pic('a.png')] }`를 걸고 '＋ 이미지 추가'를 누른다 · **[클립]** = `window.__bflowMockBackgroundAdd = { clipboardFile: '…경로' }`를 걸고 **빈** `paste([])`를 보낸다(메인 프로세스 길의 화면 쪽) · **[경로]** = `window.__bflowMockBackgroundAdd = { filePath: file => 'C:\\art\\' + file.name }`.
- **가짜 사건은 진짜 사건이 가는 길로만 보낸다.** [붙임]은 **늘 `document.body`에** 보낸다 — 진짜 붙여 넣기는 버튼·체크 칸에 포커스가 있어도 `body`로 온다(2.6). 글자 칸의 줄에서만 그 칸에 `focus()`한 뒤 **그 칸에** 보낸다. 버튼이나 도면을 대상으로 보내지 않는다(앱에서 일어나지 않는 사건이다). [끌기]의 **막힌 줄에서는 `drop`을 보내지 않는다** — 앱에서는 오지 않는다(4.2): `over`로 덮개를 보고 `leave`로 끝낸다. 막혔는지는 덮개의 `data-blocked`로 본다(가짜 `DataTransfer`는 `dropEffect`를 받지 않을 수 있다 — E1에서 본다. 그러면 그 값은 앵커의 글자와 실기로만 확인된다).
- **읽는 때**: 네이티브 리스너에서 바꾼 상태는 `dispatchEvent`가 돌아온 **뒤에** 그려진다. 덮개와 알림 줄은 사건을 보낸 다음 프레임에 읽는다(`await new Promise(requestAnimationFrame)`을 두 번, 또는 50ms 뒤).
- **`pic`의 이름**: 만든 파일에는 경로가 없어 이름·크기·고친 시각이 같으면 한 파일로 친다(4.6의 1번 — 같은 밀리초에 만든 같은 크기의 그림이 그렇다). 여러 장을 넣는 줄에서는 **이름을 모두 다르게** 준다(`pic('a1.png')`, `pic('a2.png')`…). **이름이 같고 크기가 다른 둘**은 셋째 인자(가로)로 만든다 — `pic('a.png', 'image/png', 320)`과 `pic('a.png', 'image/png', 640)`: 가로가 같으면 바이트 수가 같을 수 있어 한 파일로 쳐질 때가 있다. 쓰기 전에 두 파일의 `size`가 다른지 본다.
- **움직임을 재는 법**(E6): 화면 밖의 검사 창에서 120~180ms의 움직임은 눈으로 볼 수 없다. 요소가 생긴 그 프레임에 `getComputedStyle(el).animationName`과 `el.getAnimations().length`를 읽고(덮개 `bmap-drop-in`, 글자 상자와 새 카드 `bmap-rise-in` — 움직임이 꺼진 때에는 `none`과 0), 막대(`.bmap-gallery-step>i`)는 `getComputedStyle(bar)`의 `transitionProperty`와 `transitionDuration`을 읽는다 — 움직일 때는 `transform`과 0이 아닌 시간이고, 꺼진 때에는 그 짝이 아니다(이 규칙이 빠진 값: 기본값 `all`·`0s`이거나 앱의 전역 전환의 것 — 본 값을 적는다).
- **다시 읽기와 새로 고침**: **다시 읽기** = 라이브러리 머리줄의 ↻(`배경 라이브러리 새로고침`) — 화면도 초안도 그대로이고 미리보기 저장소를 다시 읽는다. **페이지 새로 고침** = 검사 창이 주소를 다시 싣는 것 — 초안과 흉내가 모두 사라지고 **저장된 것만** 남는다(가드는 `dom-ready`가 다시 건다. 훅과 느린 올리기·거절 감싸기는 다시 걸어야 한다). 표에는 둘을 가려 적었다.
- 느린 올리기·끊김: `(() => { const api = window.electronAPI, real = api.backgroundUploadImage.bind(api); api.backgroundUploadImage = async data => { await new Promise(done => setTimeout(done, 1500)); return real(data); }; })()`. 저장의 거절·응답 잃기·**느린 저장**은 1차 설계 7.6의 `backgroundExecute` 감싸기 그대로(던지는 글은 설치된 앱의 꼴로, 느린 저장은 같은 자리에 `await`를 넣는다). 다른 PC 흉내·읽기 전용 흉내도 그 절의 것이다.
- **도면 재기**: `const box = () => { const r = document.querySelector('.bmap-canvas, .bmap-3d-main canvas').getBoundingClientRect(), s = document.querySelector('.bg-tab-content:not([hidden])'); return { w: r.width, h: r.height, top: r.top - s.getBoundingClientRect().top + s.scrollTop }; }` — 너비·높이와, **스크롤을 뺀** 위치(탭의 스크롤 상자에 대한 것)다. 넣기 전·흐린 카드가 뜬 동안·끝난 뒤에 견준다. 화면에서의 위치(`r.top`)는 좁은 창에서 시작의 스크롤(K13)만큼 달라질 수 있다.

**먼저 — 엔진 동작(12절의 대체안이 걸려 있다)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| E0 ★ | **페이지가 실린 직후, 아무것도 누르기 전에**(페이지를 새로 고친 뒤에도 한 번 더): `navigator.userAgent` · `await window.electronAPI.backgroundPickImages()` · 감춘 파일 입력을 하나 붙여 `input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` | `Electron/`이 들어 있다 · 훅 없이 `[]`다(파일 창을 열라는 `undefined`가 아니다) · `false`가 돌아오고 `window.__fileDialogs`가 1이다(가드가 걸려 있다 — 본 뒤 0으로 되돌리고 그 입력을 뗀다). **하나라도 다르면 여기서 멈춘다**: '＋ 이미지 추가'와 파일 입력이 있는 창을 건드리는 줄(V6 · V6b · F3 · H2 · S9)을 하지 않고 까닭을 적는다 |
| E1 ★ | [끌기] `over([pic('a.png')])` 뒤 평면·3D·속성 칸·이미지 목록·도면 목록을 차례로 `cross(files, 앞 요소, 다음 요소)` — **세 가지로 한 바퀴씩**: ⓐ 그대로(들어가는 쪽이 먼저, `relatedTarget` = 다음 요소) ⓑ `relatedTarget` 없이(`cross(files, 앞, 다음, null)` — 그 값을 싣지 않는 엔진) ⓒ 차례를 뒤집어 `dragleave`를 먼저(`drag('dragleave', files, 앞, 다음)` → `drag('dragenter', files, 다음)` → `drag('dragover', files, 다음)` — 차례가 다른 엔진). 그리고 평면의 이름 상자를 연 채(F2) 한 번 더 `over` | 덮개가 **하나** 뜨고 세 바퀴 모두 그동안 한 번도 사라지지 않는다(사건마다 다음 프레임에 `.bmap-drop`이 있다 — ⓑ는 "마지막으로 들어간 요소"가, ⓒ는 `relatedTarget`이 지킨다). 글자 상자가 화면 안에 있다 — 740에서 탭을 맨 아래로 내린 채로도(보이는 높이의 35%쯤). `box()`가 그대로다. `drag('dragover', …)`가 `false`를 돌려준다(핸들러가 막았다). 한 번은 `carry`로 만든 것을 변수에 쥔 채 `dragover`를 보내고 그 `dropEffect`를 읽어 **적어 둔다**: `'copy'`면 가짜 사건으로도 그 값을 볼 수 있고, `'none'` 그대로면 볼 수 없다(막힌 줄은 `data-blocked`로만 본다). 이름 상자: `over`의 다음 프레임에 상자가 닫혀 있고 친 이름이 그 노드에 들어가 있으며, 덮개의 제목이 **친 이름**이다. **이 줄이 보이는 것은 핸들러의 두 길이 맞게 적혔다는 것까지다** — 엔진이 진짜 끌기에서 그 값과 차례를 주는지는 실기 1이다 |
| E2 ★ | [끌기] 덮개가 뜬 채 ① `leave(files)`(마지막으로 들어간 요소에, `relatedTarget` 없는 `dragleave`) ② 다시 띄우고 편집기 밖으로: `drag('dragleave', files, 도면, document.querySelector('.bg-library-tabs'))` ③ 다시 띄우고 `window.dispatchEvent(new PointerEvent('pointermove'))` ④ 다시 띄우고 `drop` ⑤ 다시 띄우고, 마지막으로 들어간 요소가 **아닌** 요소에 `relatedTarget` 없는 `dragleave`(`over(files, 도면)` 뒤 `leave(files, 속성 칸)`) | ①~④는 덮개가 다음 프레임에 없어진다. ⑤는 **그대로 있다**(떠난 것이 마지막으로 들어간 요소가 아니다 — 본 뒤 `leave(files)`로 끈다) |
| E3 | [끌기] 파일 없는 끌기: `new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: (d => (d.setData('text/plain', 'x'), d))(new DataTransfer()) })` | 덮개 없음, `dispatchEvent`가 `true`를 돌려준다(건드리지 않았다) |
| E4 ★ | [붙임] `paste([pic('image.png')])`(`body`에) | 넣기가 시작된다(가짜 사건의 `clipboardData.items`가 읽힌다). `paste(…)`가 `false`를 돌려준다 |
| E5 | 실패 없는 넣기 한 번의 앞·도중·뒤에 `box()` — 평면과 3D, 1440과 740. **저장이 거절되는 넣기에서 한 번 더**(S6의 둘째 배경 거절). **편집기의 오류 띠를 띄워 둔 채**(다각형을 두 점 찍고 Ctrl+S → `그리는 중인 다각형을…`, 그 뒤 Esc로 다각형을 버린다 — 띠는 남는다) 장소 없는 공간에 놓아 장소 창을 열고, 닫는다(취소로 한 번, 답해서 한 번) | 너비와 높이가 세 번 다 같다(1px도). 스크롤을 뺀 위치(`top`)도 같다. 1440에서는 화면에서의 위치도 같다. 거절되는 넣기에서도 같고, 그동안 `document.querySelector('.bg-global-error')`가 없다. 오류 띠: 장소 창이 열려 있는 동안에도 띠(`.bmap-main>.bg-error`)가 그대로 있고, 창이 열릴 때와 닫힐 때 `box()`가 달라지지 않는다 |
| E6 ★ | 덮개·새 카드·막대: 보통 / 동작 줄이기 흉내(`emulateMedia`) / 설정 '움직임: 최소' — **눈이 아니라 값으로 잰다**(위의 '움직임을 재는 법') | 보통: 덮개의 `animationName`이 `bmap-drop-in`, 글자 상자와 새 카드가 `bmap-rise-in`이고 `getAnimations()`가 하나씩 있으며, 막대의 전환이 `transform`이다. 나머지 둘: `animationName`이 `none`, `getAnimations()`가 비어 있고 막대에 그 전환이 없다 — **움직임 없이 그 자리에 있고** 글자·'추가됨'·막대의 길이(`transform`의 `scaleX`)는 그대로다 |

**대상 · 덮개 · 놓기**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| T1 ★ | [끌기] 보기 모드와 편집 중 각각 `over`: 아무것도 안 고름 / 장소 있는 공간 / 기호 / 카메라 / 평면에서 둘 고름 / 3D에서 둘 고른 채 하나를 손에 듦. 카메라는 둘로 본다 — **장소 있는 방 안으로 끌어 옮겨 둔 것**(속성은 '공간 미지정' 그대로다)과 어느 방 안에도 없는 것 | 덮개의 제목이 이미지 목록 머리줄의 이름을 말한다(`‘2층’ 도면의 배경으로 추가` · `‘2-1 교실’의 배경으로 추가` · `‘교실 → 복도’의 시점으로 추가`…). 둘째 줄: `놓으면 바로 저장돼요.` — 카메라에는 **장소의 이름**이 있다: 방 안의 카메라는 그 방의 장소(`놓으면 ‘2-1 교실’ 장소에 바로 저장돼요.`), 방 밖의 카메라는 도면의 대표 장소. 편집 중의 카메라는 `그림은 ‘…’ 장소에 바로 저장되고, 카메라에 이어 주는 것은 '도면 저장' 때 저장돼요.` |
| T2 | [끌기] `over`: 새로 그린 공간(장소 없음) / 잠근 카메라 / 장소 없는 잠근 공간 / `gif` 하나만 / `[pic('a.png'), gif]` / `psd` 하나만. 잠근 카메라의 줄은 **이름을 80자쯤으로 길게 바꾼 카메라**로도 본다 | `놓으면 배경 장소부터 정해요.` / 막힌 두 문장(3.3 — `…속성의 ‘위치·크기·잠금’에서 잠금을 해제하고…`)과 붉은 테두리(`data-blocked`) / `PNG·JPG·WebP 그림만 넣을 수 있어요.`(같음) — **막힌 셋은 `leave`로 끝낸다: 덮개가 꺼지고, 알림 줄도 넣기도 없다** / 받을 수 있는 것이 섞여 있으면 보통 덮개다(막히지 않는다) / `psd`는 보통 덮개(형식을 모른다) — `drop`하면 알림 줄에 `넣은 그림이 없어요. 1장은 넣지 못했어요(아래 목록).`과 `스케치.psd — PNG·JPG·WebP 그림만 넣을 수 있어요.` 긴 이름: 제목이 줄을 바꿔 **끝(`…에는 넣을 수 없어요`)까지 보인다** |
| T3 ★ | [끌기] 장소 있는 공간에 `drop([pic('a.png'), pic('b.jpg', 'image/jpeg'), pic('c.webp', 'image/webp')])` — 평면에, 3D 캔버스에, 속성 칸에, 이미지 목록에, 도면 목록에 각각. **한 번은 느린 저장으로**(명령마다 1초) | 어디에 놓아도 같다: 흐린 카드 셋 → 진짜 카드 셋(맨 앞, '추가됨'), 알림 줄 `‘…’의 배경으로 그림 3장을 넣었어요. 바로 저장됐어요.` 띠의 수와 도면의 버전이 그대로다. '배경 목록' 탭에 셋이 그 장소 아래에 있다. **느린 저장으로 보는 동안 어느 순간에도 카드의 수(흐린 것 + 진짜)가 '넣기 전 + 3'이고**, 머리줄의 수는 끝날 때 한꺼번에 3 는다 |
| T4 | [끌기] 읽기 전용 흉내 뒤 `over` / 편집기 밖(라이브러리의 탭 줄 `.bg-library-tabs`, 앱의 사이드바)에 `over` / '도면 설정' 창을 연 채 그 창 위에 `over` | 덮개가 없고 `over(…)`가 `true`를 돌려준다(막지 않았다 — 그러니 진짜 놓기는 오지 않는다). 굳이 `drop`을 보내도 넣기가 없다(읽기 전용은 버튼과 안내 줄도 없다). 가짜 사건을 **감춰진** 편집기 뿌리에 직접 보내는 것은 검사가 아니다 — 진짜 끌기는 보이지 않는 요소에 닿지 않는다 |
| T5 | [끌기] 12장(**이름이 모두 다른 것**) / `[pic('a.png'), big, psd]` / **거절되는 파일이 맨 앞인** `[psd, pic('a.png'), pic('b.png')]`([경로] 훅을 건 채) / 같은 `File` 객체 둘 / 이름이 같고 크기가 다른 둘(`pic('a.png', 'image/png', 320)`과 `pic('a.png', 'image/png', 640)` — 두 `size`가 다른 것을 먼저 본다) | 10장만 들어가고 `… 한 번에 10장까지예요. 나머지 2장은 넣지 않았어요.` / 한 장만 들어가고 `… 2장은 넣지 못했어요(아래 목록). …`과 목록에 두 줄(`20MB보다 큰 그림은 넣을 수 없어요.` · `PNG·JPG·WebP 그림만 넣을 수 있어요.`) / **카드 'a'의 상세 창에 `C:\art\a.png`, 카드 'b'에 `C:\art\b.png`가 적혀 있다**(제 그림이 제 이름으로 올라갔다 — 한 칸씩 밀리지 않았다) / 한 장 / 두 장(뒤의 것은 이름에 ` (2)`) |
| T6 | [끌기][경로] 경로 훅을 건 채 카메라에 `a.png` → (편집 중이면 Ctrl+Z로 연결을 되돌리고) 그 카드를 열어 이름을 `교실 전경`으로 바꾼 뒤 같은 이름의 파일로 다시. 그리고 **브라우저에서 끌어온 것처럼**: 같은 훅을 건 채 `text/uri-list`를 함께 실어 놓는다(`const d = carry([pic('web.png')]); d.setData('text/uri-list', 'https://example.com/web.png')` — 그 `d`를 실은 `dragenter`·`dragover`·`drop`) | 둘째는 새 카드가 없고 `이미 있는 그림 1장(‘교실 전경’)은 새로 만들지 않았어요. 그림을 고쳤다면 그 카드를 열어 '이미지파일 연결'로 새 수정본을 넣어 주세요. …` — **괄호 안이 바꾼 이름이다**. 그 카메라의 목록에 그 카드가 다시 보인다. 첫 카드의 상세 창에 원본 경로가 적혀 있다. 브라우저의 것은 들어가고, 그 카드의 상세 창에 **원본 경로가 없다** |

**붙여 넣기 · 버튼**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| V1 ★ | [붙임] 카메라를 고르고 `paste([pic('image.png')])` / 아무것도 안 고르고 / **앱 사이드바의 버튼에 `focus()`해 둔 채**(`body`에 보낸다 — 사이드바에서 막 들어온 때다) | 그 카메라의 시점으로 / 도면에 / 도면에(포커스가 어느 버튼에 있든 받는다 — 4.3). 이름이 `붙여 넣은 그림 HH:MM`. 같은 분에 한 번 더 → ` (2)` |
| V2 ★ | [붙임] 이미지 검색 칸, 속성의 이름 칸, 숫자 칸, 평면의 이름 상자(F2 키로 연 것)에 각각 `focus()`하고 **그 칸에** `paste([pic('image.png')], 칸)`. 이어서 글자를 함께 실어 `paste([pic('image.png')], 칸, '글자')`. **[클립] 훅에 예제 경로를 걸고 속성의 이름 칸에 빈 `paste([], 칸)`**(탐색기에서 복사한 그림 파일이 이벤트에 실려 오지 않는 환경), 같은 훅으로 `paste([], 칸, '글자')`, 훅 없이 `paste([], 칸)` | 아무것도 들어가지 않고 `paste(…)`가 `true`를 돌려준다(그 칸의 붙여 넣기를 막지 않았다). 알림 줄이 `글자 칸에 커서가 있어서 그림을 넣지 않았어요. …`다. 글자를 함께 실은 것에는 그 줄도 없다. 훅을 건 빈 붙임: **같은 줄이 뜨고 그림은 들어가지 않는다**(`backgroundUploadImage` 호출 0) / 글자가 있으면 줄이 없고 `backgroundReadClipboardFile`도 부르지 않는다 / 훅이 없으면 줄이 없다 |
| V3 | [붙임](`body`에) 장소 창·'도면 설정'·배경 상세 창을 연 채 — 포커스를 창 안의 버튼에 둔 때와 Tab을 끝까지 돌려 `body`에 둔 때 / 다른 탭에서 / 평면에서 끄는 도중(누른 채) | 모두 아무 일도 없다 |
| V4 | [붙임] `paste([psd])` / 글자만 든 붙여 넣기 `paste([], document.body, '글자')`(훅 없이) | 말없이 아무 일도 없다(알림 줄도 없다) |
| V5 ★ | [클립] 훅에 예제 경로(9.4) → `paste([])` / `'C:\\art\\그림.webp'` / `'C:\\art\\없는.png'` | 배경 `교실_낮`이 들어가고 상세 창에 그 경로, **알림 줄의 끝이 `탐색기에서 복사한 파일은 한 번에 한 장만 들어와요. 여러 장은 끌어다 놓아 주세요.`다** / `넣은 그림이 없어요. 1장은 넣지 못했어요(아래 목록).`과 `그림.webp — WebP 파일은 복사해서 붙여 넣을 수 없어요. …` / 흐린 카드가 `넣지 못했어요`가 되고 목록에 미리보기 mock의 문장 |
| V6 ★ | [버튼] 훅 `pick`을 걸고 누름: 장소 있는 공간 / 잠근 카메라 / 넣기가 도는 중. **훅을 걸지 않고도 한 번 누른다** | 들어간다 / 버튼이 흐리고 풍선이 까닭, 눌러도 아무 일도 없다 / 같다. 키보드(Tab → Enter)로도 눌린다. 훅 없이 누르면 아무 일도 없다. **어느 경우에도 파일 창이 뜨지 않고 `window.__fileDialogs`가 0이다** |
| V6b ★ | **설치된 앱에서 버튼이 도는 길**(누르지 않는다 — 클립보드도 파일 창도 쓰지 않는다): 카메라를 고르고 [경로] 훅을 건 채 `const input = document.querySelector('input[aria-label="추가할 그림 파일"]'); input.files = carry([pic('p1.png'), pic('p2.png')]).files; input.dispatchEvent(new Event('change', { bubbles: true }))` | 두 장이 그 카메라의 시점으로 들어가고(카드의 상세 창에 `C:\art\p1.png`·`C:\art\p2.png`), 끝난 뒤 `input.value === ''`이고 `input.files.length === 0`이며 `window.__fileDialogs`가 0이다. 같은 두 파일을 곧바로 한 번 더 넣을 수 있다(값이 비워져 `change`가 다시 온다) |
| V7 | 넣기가 도는 동안(느린 올리기) [끌기] `over`로 한 번 더 / [붙임]으로 한 번 더 | 덮개가 `지금은 넣을 수 없어요`이고 `data-blocked`다 — `leave`로 끝내면 덮개가 꺼지고 알림 줄은 넣는 중의 문장 그대로다 / 알림 줄이 `지금은 넣을 수 없어요. 앞에 넣던 그림을 마치는 중이에요. …`로 바뀌었다가 끝나면 결과 문장이 된다. 넣기는 하나뿐이다 |
| V8 | **저장 중에 다음 대상을 누른 뒤의 붙여 넣기**(K20): 카메라 A를 고르고 [붙임] → 느린 저장으로 저장 실행이 도는 동안 평면에서 카메라 B를 누른다(가짜 누름을 B의 요소에: `new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 1 })`과 같은 꼴의 `pointerup` — 핸들러가 읽는 것은 `isPrimary`·`button`·사건의 대상이다) → 첫 넣기가 끝난 뒤 [붙임] → 다시 [붙임] → B를 눌러 고르고 [붙임]. 따로 한 번: 저장 중의 누름 뒤에 **오브젝트 목록**에서 B를 고르고 [붙임]. 저장 중에 버튼(도구줄)만 누른 뒤 [붙임] | 저장 중의 누름 뒤 A가 그대로 골라져 있다. 그 뒤의 첫 붙임은 **아무것도 넣지 않고** 알림 줄이 `저장하는 동안 도면을 누른 것은 골라지지 않았어요. 넣을 곳을 다시 누른 뒤 붙여 넣어 주세요.`다(`backgroundUploadImage` 호출이 늘지 않고 `paste(…)`가 `false`를 돌려준다 — 그림을 받은 가지다). 둘째 붙임은 들어간다 — A에(한 번만 막는다). B를 눌러 고른 뒤의 붙임은 B에 들어가고 문장이 `‘B’의 시점으로 …`다. 목록에서 고른 경우: 첫 붙임이 같은 줄로 한 번 거절되고 다음 붙임이 B에 들어간다(13.3). 버튼만 누른 뒤의 붙임은 거절되지 않는다. 첫 넣기가 **도는 중에** 온 붙임은 누름과 무관하게 넣지 않는다(V7) |

**장소 창**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| Q1 ★ | [끌기] 새로 그린 공간 '창고'(저장해 둔 것)에 셋 | **아무것도 올라가기 전에** 창이 뜬다(`backgroundUploadImage` 호출 0). 6.2의 글자, '새 장소 만들기'에 `창고`, `‘학교’ 아래에 만들어져요.`, 포커스가 `이 장소로 넣기` |
| Q2 ★ | 뜬 지 0.4초 안에 Enter·버튼 / 0.4초 뒤 / 뜨자마자 Esc / × / 취소. **누르고 있던 키의 되풀이**(0.4초가 지난 뒤, 포커스가 놓인 '이 장소로 넣기'에): `button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }))`, 같은 꼴로 `key: ' '`, 그리고 이름 칸에 `key: ' ', repeat: true` / `repeat` 없는 `key: 'Enter'` | 아무 일도 없다 / 넣기가 시작된다 / 셋 다 바로 닫히고 올린 것·만든 장소·알림이 없다. 되풀이: 앞의 둘은 `dispatchEvent`가 `false`를 돌려준다(폼이 기본 동작을 막았다 — 가짜 키는 어차피 버튼을 누르지 못하므로, 볼 수 있는 것은 이 값이다) / 이름 칸의 Space 되풀이와 새로 누른 Enter는 `true`다(막지 않는다). 진짜 키를 누르고 있을 때는 실기 8 |
| Q3 | 보기 모드에서 '새 장소'로 답 / 편집 중에 답 | 장소 '창고'가 생기고 그림 셋이 그 아래, 공간의 '배경 장소'가 '창고'다 — 보기: 페이지를 새로 고쳐도 남아 있고 `도면에 이어 준 것까지 바로 저장됐어요.` / 편집 중: 띠 +1, `…'도면 저장'을 눌러야 남아요.` |
| Q4 | 편집 중에 Q3 뒤 '편집 끝내기 → 버리고 끝내기', 다시 편집을 시작해 같은 공간에 다시 놓음. 그리고 **이름을 고치지 않은 새 공간 둘**('새 공간')에 차례로 넣음 — **둘 다 편집 중에 답한다**(첫째에 '새 장소'로 답한 뒤, 저장하지 않고 둘째에: 첫째의 연결은 초안에만 있다). **다른 도면에서도**: 도면 A의 '거실'에 '새 장소'로 넣고(편집 중, 저장하지 않은 채) 대표 장소가 같은(또는 둘 다 없는) 도면 B로 가서 '거실'을 그리고 넣음. A를 저장한 뒤 한 번 더 | 버리기 창에 8.1의 한 문장(첫 문단과 띄어져 있다 — 7.6의 간격). 다시 놓으면 창이 '기존 장소에서 고르기'에 `학교 / 창고`를 골라 둔 채 뜬다(둘째 '창고'가 생기지 않는다). 둘째 '새 공간'의 창은 **'새 장소 만들기'**로 뜬다(첫 공간이 쓰는 장소를 골라 두지 않는다). 도면 B의 '거실'의 창도 **'새 장소 만들기'**로 뜬다 — A의 연결이 초안에만 있을 때도, 저장된 뒤에도(남의 도면이 쓰는 '거실'을 골라 두지 않는다) |
| Q5 | 대표 장소 없는 도면(새로 만든 것)에 아무것도 안 고르고 놓음 / 그 도면의 카메라에 — 방 안에 선 것과 방 밖의 것 | `‘…’ 도면에는 아직 대표 장소가 없어요.` / 방 안: `‘…’ 카메라가 있는 ‘(그 방)’에는 아직 배경 장소가 없어요.` — 답하면 그 방의 '배경 장소'가 그 장소다 / 방 밖: `‘…’ 카메라가 있는 ‘…’ 도면에는 아직 대표 장소가 없어요.` — 답하면 도면 설정의 대표 장소가 그 장소다 |
| Q6 | 창이 열린 채(보기 모드) 다른 PC 흉내로 그 도면을 지운 뒤 답한다 | 그림은 그 장소에 들어가고, **지금 보이는 도면의 목록**에 흐린 카드와 알림 줄이 뜬다(돌아갈 도면이 없다): `… 다만 도면에 이어 주지는 못했어요. …` 지금 보이는 도면은 바뀌지 않았다(버전 그대로) |
| Q7 | 창이 열린 채 Tab을 끝까지 돌려 포커스가 창 밖에 놓인 뒤 [붙임]`paste([pic('image.png')])`, Ctrl+S | 아무 일도 없다 |
| Q8 | 창이 열려 '기존 장소에서 고르기'에 장소 하나가 골라져 있는 채, 다른 PC 흉내로 **그 장소를 지운 뒤**(미리보기 저장소에서 지우고 ↻ 대신 변경 신호로 다시 읽게 한다) `이 장소로 넣기` | 창 안에 `넣을 장소를 다시 골라 주세요.`가 뜨고 창은 그대로다. 올린 것이 없다(`backgroundUploadImage` 호출 0). 다른 장소를 고르거나 '새 장소 만들기'로 바꾸면 들어간다 |

**저장 규칙 · 이어 주기**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| S1 ★ | 편집 중, 다른 편집 둘을 한 뒤 카메라에 셋을 놓음 → Ctrl+Z → Ctrl+Shift+Z → '도면 저장'(**느린 저장으로** — 저장이 도는 동안의 줄을 읽는다). 따로 한 번씩: 넣은 뒤 '편집 끝내기 → 버리고 끝내기' / 넣은 뒤 **'도면 저장'이 거절되게**(`save-maps`의 거절) / **장소 없는 새 공간에 12장을 놓아**(장소 창에 답한다 — 10장) 남은 둘을 같은 공간에 다시 놓음 | 띠가 `저장 안 한 변경 3개`(넣기 = +1). 배경 셋은 '배경 목록'에 이미 있다(↻로 다시 읽어도). 알림 줄: `… 그림은 바로 저장됐고, 도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.` **Ctrl+Z** → 그 카메라의 목록에서 셋이 빠지고 띠 2개, 배경은 그대로, 알림 줄이 `… 도면에 이어 준 것은 그 뒤에 되돌리거나 버려서 지금은 남아 있지 않아요. …` **Ctrl+Shift+Z** → 돌아오고 알림 줄도 처음의 문장. **'도면 저장'** → 띠가 `저장 중…`인 동안 알림 줄은 **아직 `…눌러야 남아요.`**이고, 저장이 끝나면 `… 도면에 이어 준 것도 '도면 저장'으로 저장됐어요.`가 된다(줄이 생기거나 사라지지 않고 글만 바뀐다. 띠의 말과 어긋나지 않는다), 페이지를 새로 고쳐도 카메라에 셋. **버리고 끝낸 뒤**의 알림 줄은 되돌렸을 때의 문장이다. **거절된 저장**: 알림 줄이 한 번도 "저장됐어요"가 되지 않는다. **둘째 넣기**(장소가 초안에만 이어진 공간): 장소 창이 다시 뜨지 않고, 덮개의 둘째 줄이 `그림은 바로 저장되고, 배경 장소를 이어 둔 것은 '도면 저장' 때 저장돼요.`, 끝난 줄이 `… 그림 2장을 넣었어요. 그림은 바로 저장됐고, 도면에 이어 준 것은 '도면 저장'을 눌러야 남아요.`다(`바로 저장됐어요.`로 끝나지 않는다). 띠의 수는 첫 넣기의 +1 그대로다 |
| S2 ★ | 보기 모드, 카메라에 셋 | 띠가 뜨지 않고 '편집 시작'이 그대로다. 알림 줄이 `… 도면에 이어 준 것까지 바로 저장됐어요.` 페이지를 새로 고쳐도 카메라에 셋. 도면의 버전 +1 |
| S3 | 느린 올리기 중에: 평면을 옮기고, 다른 것을 고르고, 방을 끌어 옮기고, '도면 저장'을 누른다. **방을 누른 채 올리기가 끝나게 둔다.** 따로 한 번씩, 올리기가 끝날 때: 속성의 이름 칸에 글자를 치고 있는다 / 화각 칸에 범위 밖의 수(`500`)를 친 채 / 화각 칸에 `-`만 친 채 / **평면의 이름 상자를 올리는 도중에 열어 둔 채** / **다각형을 두 점 찍어 둔 채**. 그리고 **평면의 이름 상자를 연 채(이름을 고쳐 치고 Enter를 누르지 않는다) 그 노드에 `over`**, 한 프레임 뒤에 `drop` | 올리는 동안 모두 된다. 누르고 있는 동안 흐린 카드가 `저장 기다리는 중`이고 끌기가 취소되지 않는다. 놓으면 저장 실행이 돌고(띠 `저장 중…`) 끝난다. 속성의 칸: 저장 실행이 **기다리지 않고** 돈다 — 치던 것이 '도면 저장'을 누를 때처럼 **확정된 뒤** 칸이 꺼진다: 친 이름은 남고, `500`은 한계 값 `170`으로 들어가며, `-`는 버려지고 **칸이 지금 값을 다시 보인다**(덜 친 글자가 칸에 남아 있지 않다). 저장이 끝난 뒤 그 칸에 다시 커서를 넣었다 빼도 값이 달라지지 않는다. 커서는 돌아오지 않는다(13.3). 이름 상자·다각형을 둔 채: 흐린 카드가 `저장 기다리는 중`에서 기다리고, 상자를 닫거나(Enter·Esc) 다각형을 완성·취소하면 저장이 돈다 — 그동안 친 이름과 찍은 점이 그대로다. 이름 상자를 연 채 끌고 들어오면: `over`의 다음 프레임에 상자가 닫히고 고친 이름이 들어가 있으며, 덮개와 알림 줄이 **고친 이름**을 말하고, 올리기가 끝나면 기다리지 않고 저장이 돈다 |
| S4 | 느린 올리기 중에 '편집 끝내기'(보기로) / 보기에서 시작해 올리는 중에 '편집 시작' | 이어 주기가 바로 저장된다 / 초안에 든다(띠 +1) |
| S5 | 느린 올리기 중에 그 카메라를 지움(편집 중) / 잠금 / **같은 원본을 다시 넣는 중에('이미 있는 그림') 그 카드를 열어 지움** / 새 그림과 함께 다시 넣는 중에 그 카드만 지움 / **그 도면을 1차의 삭제 창으로 지움** / **장소 있는 공간에 넣는 중에 그 공간의 '배경 장소'를 다른 장소로 바꿈**(편집 중) | `… 다만 도면에 이어 주지는 못했어요. 그 사이 … 그림은 배경 목록의 ‘…’ 장소에 있어요. 도면을 편집하면서 속성의 ‘시점 연결’에서 이어 줄 수 있어요.` 그림은 그 장소에 있다 / 같음 / 같음(이을 것이 그것뿐이었다) / 새 그림은 이어지고 `다만 도면에 다 이어 주지는 못했어요. … 이어 준 만큼은 …` — 보기 모드에서도 그 저장이 거절되지 않는다 / 그림은 장소에 들어가고 흐린 카드와 알림 줄이 **옮겨 간 도면의 목록**에 보인다 / `바로 저장됐어요.`가 아니라 `… 다만 도면에 이어 주지는 못했어요. … 도면을 편집하면서 속성의 ‘배경 장소 연결’에서 이어 줄 수 있어요.`다(그림은 예전 장소에 들어갔고, 그 공간의 목록에는 보이지 않는다) |
| S6 | 저장의 거절(`backgroundExecute` 감싸기 — 명령마다 1초의 느린 저장과 함께): 셋 가운데 둘째 배경 / 새 장소 / 새 장소 뒤의 첫 배경 / 보기 모드의 이어 주기(마지막 명령 `save-maps`) / **둘째 배경에서 권한을 잃게 함**(보기 모드에서 — 그 거절과 함께 읽기 전용 흉내를 켠다). 응답 잃기: 둘째 배경 / 그 `save-maps` | **둘째에서 멈춘다**: 첫 장만 들어가고(카메라에 이어진다), 둘째와 셋째가 같은 까닭으로 목록에 적히며(다듬은 까닭 — `Error invoking…`이 없다) **셋째는 보내지 않았다**(`backgroundExecute` 호출이 배경 둘 + 도면 하나), 줄은 `… 그림 1장을 … 넣었어요. 2장은 넣지 못했어요(아래 목록). 도면에 이어 준 것까지 바로 저장됐어요.` / 모두 실패, 장소 없음, 그 뒤로 나간 명령이 없다(`넣은 그림이 없어요. 3장은 넣지 못했어요(아래 목록).`) / 장소는 생기고 그 공간에 이어지며 줄이 `넣은 그림이 없어요. 3장은 넣지 못했어요(아래 목록). ‘창고’ 장소를 도면에 이어 준 것은 바로 저장됐어요.`다 / `… 다만 도면에 이어 주지는 못했어요. 까닭: 끊김(시험) 그림은 배경 목록의 … 장소에 있어요. 도면을 편집하면서 속성의 ‘시점 연결’에서 이어 줄 수 있어요.` — 배경 셋은 들어가 있다 / 첫 장은 들어가 있고 셋째는 보내지 않았으며 `… 다만 도면에 이어 주지는 못했어요. 까닭: 배경 관리자가 편집할 수 있습니다. …`다(`바로 저장됐어요`가 아니고, 그 이어 주기는 보내기 전에 거절돼 `save-maps`가 나가지 않았다) / 셋 다 들어간 것으로 나온다(멈추지 않는다) / 이어진 것으로 나온다(`…바로 저장됐어요.`). **어느 줄에서도 라이브러리의 붉은 줄이 뜨지 않는다**: 거절마다, 그리고 끝난 뒤에 `document.querySelector('.bg-global-error')`가 없고 `box()`가 넣기 전과 같다(느린 저장으로 도는 동안에도 잰다) |
| S7 | 느린 올리기 중에 다른 메뉴(씬 목록)로 갔다가 돌아옴 | 떠나기 전의 알림 줄이 `… 끝나기 전에 다른 메뉴로 가면 그림이 들어가지 않아요.`였다. 돌아온 화면에 흐린 카드·알림이 없고, 그 뒤로 나간 `backgroundExecute`가 없으며(호출 수) '배경 목록'에 그 그림이 **하나도 없다**(13.2에 알린 대로다) |
| S8 | 편집 중 카메라에 넣은 뒤(저장하지 않고) 그 카드를 열어 '배경 원본 삭제'(셋 가운데 하나, 이어서 남은 둘) → 다른 편집 하나 → '도면 저장' | 저장된다(예전에는 "카메라가 참조한 배경이 없습니다"). 띠의 수가 삭제로 달라지지 않는다. 알림 줄: 하나를 지운 뒤에는 그대로 `…'도면 저장'을 눌러야 남아요.`, **셋을 다 지운 뒤에는 `‘…’의 시점으로 넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요.`**다("그 장소에 그대로 있어요"가 아니다) |
| S9 | 올리는 동안 다른 도면으로 갔다가 끝난 뒤 돌아옴 / 올리는 동안 '도면 설정'을 열어 둠(그 창의 '도면 밑그림' 입력은 누르지 않는다) | 다른 도면의 목록에는 흐린 카드가 없고, 돌아오면 카드와 알림이 있다(돌아올 때 탭이 스크롤되지 않는다) / 창을 닫을 때까지 `저장 기다리는 중`, 닫으면 끝난다. 설정 창의 값이 그대로다 |
| S10 | **저장 실행이 도는 동안 다른 PC가 그 도면을 저장한다**: 편집 중이고 저장 안 한 변경이 없는 도면의 카메라에 한 장을 놓고, 느린 저장으로 저장 실행이 도는 동안 다른 PC 흉내로 그 도면의 이름을 바꿔 저장한다 → 넣기가 끝난 뒤 '도면 저장'. 따로 한 번: 저장 안 한 변경이 **있는** 초안으로 같은 일 | 넣기가 끝났을 때 머리줄의 도면 이름이 다른 PC가 바꾼 이름이고 띠가 `저장 안 한 변경 1개`다. '도면 저장'이 **통과한다**(거절되지 않는다). 변경이 있던 초안: 이름이 바뀌지 않고(초안이 따라가지 않았다) '도면 저장'이 오늘처럼 `다른 사용자가 내용을 변경했습니다…`로 거절된다 — 넣기 전부터 그랬을 일이다 |

**표시 · 좁은 창**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| F1 ★ | 넣기 한 번을 처음부터 끝까지(느린 올리기와 느린 저장) — 카메라 대상과 공간 대상 | 흐린 카드: 표시가 `준비 중 · 1/3` → `올리는 중 · 1/3` → (그림이 보이고) `저장 기다리는 중`·`저장하는 중`, 막대가 카드 위쪽 가장자리에서 자란다. 글 두 줄은 이름과 `전체 전경`·`낮`이다. **도는 동안 어느 그림도 두 번 서지 않는다**(흐린 카드와, 같은 그림의 진짜 카드가 함께 없다). 끝나면 진짜 카드가 **같은 높이로** 서고(표시가 '추가됨'), 6초 뒤 표시만 사라지고 카드는 그 자리에 남는다. 알림 줄은 처음부터 하나이고 글만 바뀐다. **자리**: 1440에서는 도는 동안의 글도 끝난 뒤의 글도 한 줄이라(40px) 진짜 카드가 흐린 카드의 **그 자리**에 선다. 740에서는 글의 줄 수가 달라(도는 동안 두 줄, 끝난 뒤 한 줄~석 줄) 끝날 때 카드가 그 차이만큼 오르내린다 — **줄 수와 움직인 px을 적는다**(7.4). 어느 폭에서도 이미지 목록의 바깥 높이와 `box()`는 그대로다 |
| F2 | 검색어·구도 '클로즈업'·'밤'을 건 채 넣음 / 필터가 가리지 않는 경우 | 필터가 풀리고 새 카드가 보인다 / 필터가 그대로다 |
| F3 ★ | 740×900: 탭을 맨 위에 둔 채 넣음. 머리줄에 버튼이 하나 더 있는 모습. **알림 줄이 남은 채 다른 도면에 갔다 옴. 평면에서 방을 끄는 도중에 넣기가 끝나게 둠**(느린 올리기를 모두 실패시킨다 — 조용해지기를 기다리지 않고 끝나는 넣기다) | 넣기를 **시작할 때** 알림 줄이 화면 안으로 온다. 머리줄이 두 줄이 돼도 목록의 높이가 360px 그대로이고 버튼이 잘리지 않는다. 돌아왔을 때 탭이 스크롤되지 않는다. 끄는 도중에 끝나도 탭이 스크롤되지 않고, 끌던 방이 포인터 밑에 그대로 있다 |
| F4 | 빈 목록(관리 계정 / 읽기 전용) · 알림 줄의 × · 못 넣은 것이 다섯인 목록 · **빈칸 없는 긴 이름**(`pic('a'.repeat(120) + '.gif', 'image/gif')`을 다른 그림과 함께) | 안내 한 줄이 더 있다 / 없다 · 닫힌다(카드가 한 줄만큼 올라온다) · 문장에 `5장은 넣지 못했어요(아래 목록).`이 있고 줄 안에서 스크롤된다 · 긴 이름이 줄을 바꾸고 **가로 스크롤 막대가 없다**(`div.scrollWidth === div.clientWidth`) |
| F5 ★ | 밝은 화면: 덮개, 막힌 덮개, 흐린 카드(표시와 글 두 줄, **막대**), '추가됨', 알림 줄, **못 넣은 목록**. 그리고 강조색이 초록·노랑인 테마에서 '추가됨'과 **막대** | 글자가 또렷이 읽힌다(못 넣은 목록은 짙은 붉은색, 표시는 카드 바탕 위의 본문색 — 7.6의 수치). **막대의 채워진 길이가 보인다**(밝은 화면에서는 보조 글자색이다 — 강조색이 아니다. 초록·노랑 테마의 어두운 화면에서는 강조색 그대로 보인다). 기울임 글자가 없다 |
| F6 | 미리보기에서 그림 20장(10장씩 두 번) | 저장소 오류 없이 모두 들어간다 |
| F7 | 카드가 여러 줄인 목록을 아래로 내려 둔 채 넣음 | 넣기를 시작할 때 카드 상자가 맨 위로 올라와 흐린 카드가 보인다. 끝날 때는 움직이지 않는다 |
| F8 ★ | 구분선으로 도면을 한껏 키운 뒤(이미지 목록 160px) 넣음. 편집 중 1440×900의 기본 높이에서도 한 번. **창 폭 1000px에서도 한 번**(머리줄이 두 줄이다) — 못 넣는 파일 셋을 함께 넣어 목록이 붙게 한다 | 카드 상자가 60px 남짓이어도 흐린 카드의 **표시(단계의 글)와 막대가 보인다**. 넣기가 끝나고 못 넣은 것의 목록까지 뜨면 카드는 가려지지만 알림 줄과 그 목록은 읽힌다(줄 안에서 스크롤). 1000px·160px: 도는 동안 카드 상자가 몇 px뿐이라 **흐린 카드는 보이지 않는다**(받아들인 것이다 — 7.6. 넣는 중이라는 말은 알림 줄에 있다). 알림 줄은 **목록 밖으로 넘치지 않는다**: 줄의 아래 끝(`getBoundingClientRect().bottom`)이 이미지 목록의 아래 끝을 넘지 않고, 줄이 40px까지 줄어 그 안에서 스크롤된다. 넘치면 12절의 대체안 |

**물러서지 않은 것(회귀)**

| # | 할 일 | 봐야 할 것 |
|---|---|---|
| H1 ★ | 띠(40px · 72px), 세 상태, 저장 뒤에도 편집 중, Ctrl+S, '편집 끝내기'(바뀐 것 없이 / 있이) | 지금과 같다. 이어 준 것이 없는 초안의 버리기 창에는 덧붙는 문장이 없다 |
| H2 | '배경 등록' 창의 그림 칸에 파일 놓기(가짜 `drop`을 그 칸에), 그 창의 '이미지파일 연결'(**누르지 않는다** — 감춘 입력에 `files`를 넣고 `change`를 보낸다) | 지금과 같다(편집기의 덮개가 뜨지 않는다). `window.__fileDialogs`가 0이다 |
| H3 | 1차: 숫자 끌기·옆 그림·도면 삭제 창 / 2차: 눈·박스 — 각각 한 번씩. 눈으로 숨긴 카메라의 이름을 목록에서 눌러(다시 보인다) 넣기, 박스로 보는 방 안의 카메라를 목록에서 골라 넣기 | 지금과 같다(도면 삭제 창의 첫 문단이 여럿일 때 그 사이도 그대로다 — 7.6의 간격 줄이 그 창에 닿지 않는다). 두 카메라 모두에 들어간다 |
| H4 | 평면의 끌기·상자·Space·Alt, 3D 손잡이. 이름 상자·숫자 칸·이미지 검색의 **글자** 붙여 넣기는 가짜 사건으로는 글자가 들어가지 않으므로, 여기서는 "이 기능이 그 사건을 막지 않는다"(V2의 `true`)까지만 본다 — 진짜 Ctrl+V는 10.4 | 지금과 같다 |
| H5 | 업데이트 안내(저장소에 모르는 키) — 넣기가 도는 중에 | 탭과 본문이 빠지고, 그 뒤로 나간 명령이 없다 |

### 10.4 배포 뒤 실기에서 볼 것 (검사 창에서는 볼 수 없다 — 검증 기록의 "확인하지 못한 것"에 적는다)

1. **진짜 끌기**: 탐색기에서 그림 1장·5장·12장을 평면·3D·이미지 목록 위에 놓는다. **끌고 다니는 동안 덮개가 깜빡이지 않는지**(도구줄·속성 칸·목록의 카드처럼 자식이 촘촘한 곳을 천천히 넘나들며 — 4.2의 두 길은 읽은 것이고 여기서 처음 잰다. 깜빡이면 12절의 대체안), 창 밖으로 나가면·Esc로 그만두면 사라지는지. 넣은 카드의 상세 창에 **원본 경로**가 적혀 있다(없으면 탐색기의 끌기에도 `'Files'` 말고 다른 형식이 실린다는 뜻이다 — 12절의 대체안). 평면의 이름 상자를 연 채 탐색기로 가서 끌어올 때 그 상자가 언제 닫히는지도 적는다(창이 포커스를 잃을 때 / 편집기에 들어올 때).
2. **막힌 대상 위에서 놓기**: 잠근 카메라 위에서, 넣기가 도는 동안, GIF 하나만 끌고 — 포인터가 '놓을 수 없음'이고, 놓으면 덮개가 사라지며 아무것도 들어가지 않는다(알림 줄도 바뀌지 않는다). `.psd` 하나를 끌 때 어느 덮개가 뜨는지도 적는다(포토샵이 깔린 PC는 그 형식을 알아, 놓기 전에 '넣을 수 없는 파일'이 뜰 수 있다).
3. **브라우저에서 끌어온 그림**(크롬의 그림을 도면 위로): 들어가는가, 그 카드의 상세 창에 원본 경로가 **없는가**(K19).
4. **화면 캡처 붙여 넣기**(Win+Shift+S 뒤 Ctrl+V)와 브라우저의 '이미지 복사' 뒤 Ctrl+V. 엑셀의 셀·문서의 그림처럼 **글자가 함께 든 클립보드**에서 무엇이 들어가는지도 적는다(4.3 — 팀 공개 전에 다시 정할 재료다).
5. **포커스가 편집기 밖에 있을 때의 Ctrl+V**: 사이드바에서 '배경'을 눌러 막 들어온 직후(들어가야 한다 — 도면에), 비밀번호 변경·사용자 관리 창을 띄운 채(그 창의 글자 칸에 커서가 없으면 그 밑에서 들어간다 — 13.3에 적은 대로인지).
6. **글자 칸의 붙여 넣기가 그대로인지**: 평면의 이름 상자, 속성의 숫자 칸, 이미지 검색에 글자를 Ctrl+V(지금처럼 붙는다). 그 칸에 커서를 둔 채 화면 캡처를 Ctrl+V(아무것도 붙지 않고 알림 줄이 까닭을 말한다 — K18).
7. **탐색기에서 복사한 파일**(Ctrl+C 뒤 Ctrl+V): PNG 하나 → 들어가고 원본 경로가 적힌다 · `.webp` 하나 → 들어가거나(이벤트에 실려 오면) 까닭이 나온다 · 여러 개 → 모두 들어가거나(이벤트) 첫째만 들어가고 알림 줄의 끝이 `…한 번에 한 장만 들어와요…`다 · **속성의 이름 칸에 커서를 둔 채 같은 Ctrl+V** → 그림은 들어가지 않고 글자 칸의 한 줄이 뜬다(K18 — 이벤트에 실려 오지 않는 환경에서도) — **본 대로 적는다**(13.2).
8. **'＋ 이미지 추가'의 파일 창**: 여러 개 고르기(카드마다 **원본 경로**가 적혀 있는 것), 취소, 파일을 더블클릭해 닫은 직후 장소 창이 답하지 않는 것. 놓거나 붙여 넣는 순간 Space·Enter를 **누르고 있었을 때** 장소 창이 그 키에 답하지 않는 것 — 1초 넘게 누르고 있어도(되풀이), 그리고 뗄 때도.
9. **걸리는 시간**: 그림 한 장을 붙여 넣어 진짜 카드가 설 때까지, 큰 그림(6000px 안팎) 10장을 놓았을 때 올리는 시간과 잠기는 시간. 도는 동안 다른 PC의 화면. **올리는 중에 다른 메뉴로 갔다 오면** 그 그림이 들어가지 않는 것(13.2에 알린 대로 — 저장하는 도중에 떠났으면 그때까지 저장된 것만 이어지지 않은 채 남는다). **한 번에 10장이 맞는 수인지는 여기서만 정할 수 있다**(미리보기의 저장은 곧바로 끝난다 — 12절).
10. 설치된 앱에서 실패의 까닭 줄(알림 줄)에 `Error invoking…`이 없는 것, 그리고 그때 **탭 위에 라이브러리의 붉은 줄이 뜨지 않는 것**(5.2의 `hush` — 일부러 실패시키려면 넣는 도중에 인터넷 연결을 끊어 본다. 끊긴 채로 두면 15초 안에 주기적인 읽기의 붉은 줄이 뜨는데, 그것은 오늘과 같다).
11. **저장 중에 다음 대상을 누른 뒤의 Ctrl+V**(K20): 카메라 A에 화면 캡처를 붙여 넣고, 표시가 끝나기 전에 평면에서 카메라 B를 누른 뒤 다시 Ctrl+V — B가 골라졌으면 B에 들어가고, 골라지지 않았으면(저장 중의 누름) 넣지 않고 알림 줄이 다시 누르라고 한다. 어느 쪽이든 **A에 말없이 들어가지 않는다.**
12. **속성 칸에 치는 도중에 저장이 시작될 때**: 그림을 놓은 뒤 화각 칸에 수를 덜 친 채, 이름 칸에 한글을 조합하는 채로 기다린다 — 저장이 시작될 때 치던 것이 '도면 저장'을 누를 때처럼 확정되는지(9.3. 진짜 조합 입력은 검사 창에서 만들 수 없다).

### 10.5 통과 기준

`npm run typecheck`(메인 프로세스 쪽 `tsconfig.node.json` 포함) · `npm run test:background`(앞 차례의 수 + 새 테스트, 건너뜀 5 그대로) · `npm run test:character` · CSS를 고친 단계부터 `npm run test:motion`(경고 0) · 마지막에 `npm run build:vite`. 앵커는 파일 시스템을 읽으므로 git에 올리지 않은 파일을 보지 못한다 — PR 전에 `git status --porcelain -- src electron tests docs DEVLOG`에 `??`가 없고 `git ls-files --error-unmatch`가 새 파일 넷(9.3)과 이 문서에 성공해야 한다.

---

## 11. 배포 기록과 문서

- **버전**: `package.json`의 `version`과 `package-lock.json`의 두 곳을 `1.138.0`으로. 머지 직전에 `origin/main`의 버전을 다시 확인한다(1.137.0이어야 한다).
- **`DEVLOG/update-notes.json` 맨 앞에 추가**(비개발자 문구, 항목마다 1~3문장. 실제 파일에는 기존 항목과 같은 줄바꿈으로 넣는다):

```json
{
  "version": "1.138.0",
  "title": "배경 도면에 그림을 끌어다 놓거나 붙여 넣어서 추가할 수 있어요 (시험 중)",
  "items": [
    { "category": "ux", "summary": "도면 화면에 그림 파일을 끌어다 놓으면 배경으로 들어가요 (시험 중)", "description": "예전에는 그림을 넣는 길이 '배경 목록'의 '배경 등록' 창 하나뿐이라, 도면에 끌어다 놓아도 아무 일도 일어나지 않았어요. 이제 도면 화면 어디에든 그림 파일을 끌어다 놓으면 배경으로 들어가요. 그림이 다 올라가면 곧바로 저장되고, 한 번에 10장까지 넣을 수 있어요." },
    { "category": "ux", "summary": "복사한 그림은 Ctrl+V로 붙여 넣을 수 있어요 (시험 중)", "description": "화면 캡처나 다른 곳에서 복사한 그림을 도면 화면에서 Ctrl+V로 붙여 넣으면 배경으로 들어가요. 이름을 적는 칸에 커서가 있을 때는 지금처럼 그 칸의 붙여 넣기가 되고, 그림만 복사해 둔 때에는 아래 목록이 그 까닭을 알려 줘요. 아래 목록의 '＋ 이미지 추가' 버튼으로 파일을 골라 넣어도 돼요." },
    { "category": "ux", "summary": "어디에 들어갈지는 고른 것이 정해요 (시험 중)", "description": "공간을 골랐으면 그 공간에, 카메라를 골랐으면 그 카메라의 시점으로, 아무것도 고르지 않았으면 도면 전체에 들어가요. 그림을 끌고 들어오면 어디에 들어갈지 화면에 먼저 알려 줘요. 이름은 파일 이름(화면 캡처는 '붙여 넣은 그림 14:05')으로, 구도와 낮·밤은 기본값으로 들어가고 카드를 눌러 바로 고칠 수 있어요." },
    { "category": "ux", "summary": "배경 장소가 없는 공간이면 한 번만 물어봐요 (시험 중)", "description": "새로 그린 공간처럼 배경 장소가 아직 없는 곳에 그림을 넣으면, 그 자리에서 '새 장소 만들기'와 '기존 장소에서 고르기' 가운데 하나를 물어봐요. 답하면 그림이 그 장소에 들어가고 공간에도 이어져요." },
    { "category": "ux", "summary": "넣는 동안과 넣은 뒤가 목록에 보여요 (시험 중)", "description": "그림을 넣는 동안 아래 목록에 흐린 카드와 진행 표시가 보이고, 끝나면 새 카드가 맨 앞에 오면서 '추가됨' 표시가 잠깐 붙어요. 넣지 못한 그림은 까닭과 함께 알려 줘요. 다 들어가기 전에 다른 메뉴로 가면 그 그림은 들어가지 않으니, 표시가 끝날 때까지 기다려 주세요." },
    { "category": "ux", "summary": "그림은 알아서 저장되고, 도면에 이어 주는 것은 '도면 저장' 때 저장돼요 (시험 중)", "description": "넣은 그림은 다 올라가면 곧바로 저장돼요. 카메라나 공간에 이어 주는 것은 도면을 고치는 일이라, 편집 중이면 '저장 안 한 변경'에 하나 더해졌다가 '도면 저장'을 누를 때 함께 저장돼요. 편집 중이 아니면 그것까지 그때 함께 저장돼요." },
    { "category": "ux", "summary": "배경 화면은 아직 배한솔 계정에서만 보여요 (시험 중)", "description": "이번 변경도 배경 화면 안의 일이라, 배경 메뉴가 보이지 않는 분들은 달라지는 것이 없어요." }
  ]
}
```

- 첫 항목의 '10장'은 `MAP_IMAGE_ADD.maxFiles`를 따른다 — 그 수를 바꾸면 이 문장과 13.2의 수를 함께 바꾼다(화면의 문구는 상수에서 나온다).
- **문서**
  - 이 문서를 커밋한다(3차의 첫 커밋 `20ddff30`, 2026-10-15).
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절(:12)의 2차 줄 다음에 `- [x] 2026-10-13 그림 끌어다 놓기·붙여 넣기(v1.138.0): … 저장 자료·운영 DB 변경 없음, 읽기 전용 IPC 채널 하나. 설계: (이 문서)` 한 줄. 파일 끝에 `### v1.138.0 배경 도면 — 그림 끌어다 놓기 · 붙여 넣기 (2026-10-13)` 절: 세 길, 대상 규칙, 저장 규칙을 한 줄씩, `- [ ] 수동 검증(설계 10.3 전체)`, `- [ ] 배포`, `- [ ] 배포 뒤 실기(설계 10.4)`, `- [ ] 다음: 저장 안 한 편집을 이 PC에 보관`.
  - `AGENTS.md` '배경 라이브러리 데이터 경계': ① **틀린 문장을 고친다**(:142) — "`background:read-image-file`은 … 로컬·공유 경로 PNG/JPG/WebP를 20MB 이내로 제한한다"를 "… 로컬·공유 경로의 **PNG/JPG**를 20MB 이내로 받는다(`.webp` 경로는 거절한다 — 메인의 `nativeImage`가 풀지 못한다. WebP는 화면이 다시 그려 올리는 길로만 들어온다: 파일 선택, 끌어다 놓기)"로. ② 편집 상태 띠 항목(1차가 고친 뒤의 문장)의 창 목록에 '장소 정하기'를 더한다. ③ 그 항목들 다음에 한 항목 — **그림 넣기(v1.138.0)**: 세 길(놓기·붙여 넣기·버튼)은 편집기의 `addImages` 하나로 들어오고 대상은 그 순간 이미지 목록이 이름하는 것(`resolveMapImageTarget` — 포인터의 자리가 아니다). 카메라의 그림이 들어갈 장소는 **카메라가 서 있는 공간**(`spacesAt`)의 것이 먼저다 — `spaceId`는 만들 때 적히고 옮겨도 바뀌지 않는다. 장소 창이 골라 두는 기존 장소는 **어느 도면도 쓰지 않는 것**뿐이다(저장된 도면도, 편집 중인 초안도 본다) / **붙여 넣기는 글자 칸만 비켜 간다**: 진짜 붙여 넣기 사건의 대상은 커서가 든 글자 칸이 아니면 늘 `body`라서, 포커스가 어느 버튼에 있는지로는 가를 수 없다(가짜 사건도 그 길로만 보낸다). **저장이 도는 동안 평면을 누른 뒤의 첫 붙여 넣기는 넣지 않는다**(`pasteImages` — 그 누름은 버려져 고른 것이 그대로이고, 붙여 넣기는 대상을 미리 보이지 않는다). 막힌 대상에는 `dropEffect: 'none'` — 놓기는 오지 않고 `dragleave`로 끝난다. 자식을 넘는 `dragleave`는 두 가지로 가른다(`relatedTarget`이 뿌리 안이다 / 떠나는 요소가 마지막으로 들어간 요소가 아니다) / **저장 규칙은 하나다**: 도면 밖의 것(배경, 장소)은 그 자리에서 저장하고, 도면의 변경(공간·도면의 장소, 카메라의 시점)은 초안이 있으면 초안에 한 단계로, 없으면 그 도면 하나의 바로 저장(`persistMaps`)으로 — 정하는 때는 이어 주는 순간이다. 초안이 없는 도면에 편집을 시작하지 않는다. 넣기는 **기대는 장소 연결**(임자와 장소)을 늘 싣는다 — 그 연결이 초안에만 있으면 "바로 저장됐다"고 하지 않고 초안의 것으로 답하며, 깨끗한 초안은 잇기 직전에 라이브러리의 것으로 다시 놓는다(`doc.rebaseDrafts` — 잠긴 동안에는 따라가기가 돌지 않는다. `doc.followSaved`는 편집기에 한 곳뿐이다) / 차례는 올리기(편집기는 그대로) → 조용해지면 잠그고 장소 → 배경들 → 이어 주기. 명령은 하나씩 기다리고, 잠그는 줄과 첫 명령 사이에 기다림을 두지 않으며, 조용한지(끌기·그리던 다각형·이름 상자·열린 창·도는 저장)를 보지 않고 시작하지 않는다. 잠그기 직전에 속성 칸의 글자 칸에서 치던 것을 떠나게 해 확정한다('도면 저장'이 포커스를 도면으로 옮기는 것과 같은 까닭 — 꺼지는 칸은 `blur`를 받지 못한다. 글자 칸만이다: 오브젝트 목록·버튼의 포커스는 그대로 둔다). **저장 하나가 실패하면 남은 것은 보내지 않고**, 들어간 것은 이어 준다 / 기다린 뒤에는 저장소(`getState`)와 문서(`doc.getState()`)에서 읽고, 화면을 떠났거나 계정이 바뀌었으면(`gone`) 더 보내지 않고 저장소도 건드리지 않는다. 응답을 잃은 저장은 다시 읽은 라이브러리에 그 id가 있으면 된 것이다. 이 기능의 실패한 저장이 켠 라이브러리의 오류 줄은 그 자리에서 끈다(`hush` — 까닭은 알림 줄이 다듬어 말한다). 이어 줄 때 라이브러리에 없는 배경·장소는 잇지 않는다(`linkMapImages`의 셋째 인자) / 장소 창은 `dialogOpen`에 들고 연 때의 대상만 다루며 0.4초 뒤부터 답을 듣고(ref), 누르고 있던 키의 되풀이에는 답하지 않는다. 편집기의 오류 띠는 이 창 밑에서만은 그대로 그린다(이 창은 그 글을 안에 그리지 않는다) / 표시는 이미지 목록 안과 자리를 차지하지 않는 덮개뿐이다(도면 위에 블록을 끼우지 않는다). 도는 넣기의 배경은 끝날 때까지 흐린 카드로만 그리고, 탭을 스크롤하는 것은 넣기를 시작할 때뿐이며(끝날 때는 끌기가 있을 수 있다), 끝난 넣기의 알림은 그릴 때마다 지금의 모습을 읽어 적는다(`mapImageOutcomeNow` — 초안의 연결이 저장됐는가·되돌려졌는가, 넣은 그림이 지워졌는가. 저장이 도는 동안에는 확인된 라이브러리로 읽는다). 움직임은 그 `no-preference` 블록에만 쓰고 띠의 블록보다 뒤에 둔다 / 초안에만 이어 둔 배경이 지워지면 초안이 그 연결을 놓는다(`dropMissingViews` — 저장이 도는 동안과, 편집 권한으로 읽은 라이브러리가 아닐 때는 하지 않는다: 빈 라이브러리에 대면 모든 시점이 빠진다) / 새 채널 `background:read-clipboard-file`은 클립보드의 그림 파일 경로 하나만 돌려준다(`'FileNameW'`. 권한은 다음 채널이 본다). `clipboard:read-image-file`은 캐릭터 현황판의 것이니 고치지 않는다 / 파일 고르기는 화면의 파일 창이고 preload에 넣지 않는다 — 미리보기 mock의 `backgroundPickImages`와 `__bflowMockBackgroundAdd`는 확인용이고, **앱 엔진의 검사 창에서는 훅이 없어도 그 mock이 파일 창을 열게 하지 않는다**(검사는 시스템 클립보드와 네이티브 파일 창을 쓰지 않는다. 검사 도구는 페이지가 실릴 때마다 파일 입력의 누름을 막는 가드를 건다).
  - `docs/superpowers/plans/2026-10-10-feedback-additions.md`: 7절 진행 기록 표의 '라' 줄(:299)을 `| 라. 끌어다 놓아 이미지 추가 (G1) | docs/superpowers/specs/2026-10-13-background-map-image-drop-paste-design.md, 아래 (새 절) | 구현·검증 상태 (v1.138.0) |`로 고치고, 4절의 그 결정(:94-100) 끝에 "한솔이 묻지 않고 만들라고 했다(2026-10-13) — 추천안으로 만들었다" 한 줄. 7절 끝에 `### 7.N 라. 그림 끌어다 놓기 · 붙여 넣기 — 만든 것과 확인한 것 (v1.138.0, 날짜)`를 7.3과 같은 꼴(만든 것 / 확인한 것 / 확인하지 못한 것 / 한솔에게 알린 것과 이 설계가 정한 것)로 더한다(번호는 1차·2차가 쓴 다음 것).
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-13 그림 끌어다 놓기 · 붙여 넣기 (v1.138.0)`(검증한 날이 다르면 그 날짜로) — 10.5의 수치, 10.3의 결과(E0~E6의 관찰 — 가짜 `DataTransfer`가 `dropEffect`를 받는지 포함 — 과 쓴 대체안, 끝났을 때의 `window.__fileDialogs`), **확인하지 못한 것**(10.4 전부).
  - `CLAUDE.md`는 고치지 않는다. 완료 보고(한솔에게)에는 13.2를 비개발자 문장으로 옮겨 적는다.

---

## 12. 구현 순서 (단계마다 typecheck · `test:background`가 통과하게)

단계마다 `npm run typecheck`와 `npm run test:background`가 통과해야 다음으로 간다 — 각 단계의 테스트는 **그 단계까지 생긴 이름만** import한다. CSS를 고친 단계부터 `npm run test:motion`도 돌린다. **2단계부터는 `npm run test:character`도 돌린다**: 2단계가 고치는 `electron/clipboardFiles.ts`를 `tests/clipboardFilePaste.test.ts`가 import하고, `electron/main.ts`·`electron/preload.ts`·`src/types/index.ts`·`src/mocks/devElectronAPI.ts`의 글자를 `tests/characterFeedback3.test.ts:57-69`가 본다(둘 다 `test:character`) — 그 단계의 게이트에 없으면 거기서 생긴 회귀가 8단계(10.5)에서야 드러난다. **"…을 본다"는 구현자가 아니라 오케스트레이터가 한다**(구현자는 앱·미리보기 서버를 띄우지 않는다).

0. **기준 다시 보기**: 이 문서를 커밋한다(3차의 첫 커밋 `20ddff30`, 2026-10-15). 기대는 이름은 2026-10-15에 `633e7afb`(v1.137.0)에서 봤고 모두 설계대로다 — `dialogOpen`의 줄(:283)과 그것을 읽는 줄 넷, `mapDelete` 상태(:231-234)와 `function dropGoneDrafts(`(:720)의 자리, `mapDelete.ts`의 `mapDeleteCauseText`(:144-148), `await persistMaps(`의 수(5), 앵커 번호의 끝(72), `const openSpaceFrom3D`(:1118) 다음 줄이 `const gallery = useMemo(`인 것, `.bmap-main {` 줄(:34), 첫 `no-preference` 블록이 띠의 것(:67-70)인지. 구현을 시작할 때 `origin/main`이 그 뒤로 움직였으면 같은 것을 다시 보고, 다르면 만든 코드를 따르고 그 사실을 PR에 적는다.
1. **순수 규칙**: `mapImageDrop.ts` + `tests/backgroundMapImageDrop.test.ts`(M-1~M-10) + 앵커 59에 그 파일 이름. 화면은 달라지지 않는다.
2. **채널과 mock**: `electron/clipboardFiles.ts`의 함수, `electron/backgroundIpc.ts`의 핸들러, `electron/main.ts`의 한 줄, preload, `src/types/index.ts`의 두 줄, mock(9.4) + 10.1의 두 파일의 테스트. 부르는 화면이 아직 없다. 게이트에 `npm run test:character`를 더한다(위).
3. **컨트롤러**: `useMapImageAdd.ts`. 부르는 곳이 아직 없다.
4. **이미지 목록**: `BackgroundMapGallery.tsx`(선택 props — 편집기가 아직 넘기지 않으므로 화면은 그대로다)와 CSS(7.6 전부, `.bmap-main`의 한 낱말 포함). `npm run test:motion`.
5. **편집기**: `BackgroundMapImageAdd.tsx`, 상태 둘, `dialogOpen`의 한 낱말과 오류 띠의 조건(앵커 65), `linkAddedImages`(앵커 50), 블록, `gallery` 메모, `linksAdded`, 그리는 것 셋(덮개의 줄, `</main>}` 다음의 장소 창 줄, 물음의 줄 안의 식 하나 — 9.3) + 앵커 R3-1~R3-6. **게이트 A — 오케스트레이터가 E0~E6, T1~T6, V1~V8(V6b 포함), Q1~Q8을 본다**(E0이 맞지 않으면 그 뒤를 하지 않는다).
6. **게이트 B — S1~S10, F1~F8, H1~H5**, 네 조합의 ★. 대체안을 쓴 곳은 앵커의 글자도 함께 고친다.
7. **앵커와 뮤테이션**(10.2): 살아남는 것이 있으면 앵커를 고친다(구현은 고치지 않는다).
8. **버전과 문서**(11절), 그리고 마지막 상태에서 10.5의 전체 통과 기준과 git 확인.

**오케스트레이터만 하는 일**: 앱 엔진 확인과 대체안 선택(게이트 A·B), PR 머지, 빌드와 G드라이브 배포(빌드는 다른 세션과 겹치지 않게 자기 작업 폴더에서, 성공은 `electron-builder`·`generate-manifest`의 로그로 판정하고, `manifest.json`은 마지막에), 배포 뒤 실기(10.4)와 그 기록. 운영 DB에 할 일은 없다.

**앱 엔진에서 다르면 — 대체안**

| 확인할 것 | 기대와 근거 | 다르면 |
|---|---|---|
| 가짜 `DragEvent`·`ClipboardEvent`가 핸들러의 길을 지나는지 (E1·E4) | 스크립트로 만든 `DataTransfer`의 `types`·`items`·`files`는 읽을 수 있고 생성자가 `dataTransfer`·`clipboardData`를 받는다(읽은 것) | 생성자가 그 값을 받지 않으면 사건을 만든 뒤 `Object.defineProperty(event, 'dataTransfer', { value: data })`(`clipboardData`도)로 붙여 보낸다 — 핸들러는 고치지 않는다 |
| 글자 상자가 보이는 자리에 붙는지 (E1, 740) | `.bmap-main`·`.bmap-layout`이 `overflow:clip`이라 띠처럼 `.bg-tab-content`에 붙는다(v1.135.0이 같은 조상에서 확인한 것) | `.bmap-drop-label`을 `position:absolute; top:16px`으로(도면 칸의 위쪽에 고정) — 좁은 창에서 아래로 내려가 있으면 글자 상자는 보이지 않고 점선 테두리와 옅은 덮개만 보인다. 보고에 적는다 |
| 자식을 넘을 때 덮개가 깜빡이지 않는지 (**실기 1에서만 잴 수 있다** — E1은 핸들러의 두 길이 맞게 적혔는지만 본다) | 둘 가운데 하나만 맞으면 된다(4.2): 엔진이 자식으로 넘어갈 때 `dragleave`의 `relatedTarget`에 들어가는 요소를 싣는다 / 들어가는 요소의 `dragenter`를 먼저 보낸다. 둘 다 HTML의 끌기 처리 모델에서 읽은 것이고, 앱 엔진에서 잰 적이 없다(앱의 `dragAutoScroll.ts`는 어느 쪽이어도 돌아서 근거가 되지 못한다) | 실기에서 깜빡이면 패치 배포로: 끄는 것을 80ms 늦추고 그 사이의 `dragenter`·`dragover`가 취소하게 한다(타이머 ref 하나, 내릴 때 뗀다. `drop`과 포인터 사건의 그물은 바로 끈다 — R3-2의 그 두 줄도 함께 고친다) |
| 덮개가 남지 않는지 (E2, 실기 1) | 창 밖·Esc에서 마지막으로 들어간 요소에 `relatedTarget` 없는 `dragleave`가 오고, 안 와도(다른 요소에 와도) 첫 포인터 사건이 끈다 | 그래도 남으면 `window`의 `blur`와 `dragend`도 끄는 쪽에 더한다 |
| 덮개가 누름·끌기를 막지 않는지 (E1) | `pointer-events:none` | 3D 캔버스 위에서 사건이 뿌리에 닿지 않으면 덮개를 그 순간의 대상 요소가 아니라 `rootRef`의 `capture` 단계 리스너로 듣는다(`addEventListener(type, onFileDrag, true)`) |
| 검사 창에서 파일 창이 뜰 길이 없는지 (E0) | 검사 창의 `navigator.userAgent`에 `Electron/`이 있어 mock이 훅 없이도 빈 목록을 준다(`scripts/preview-electron.cjs`는 그 값을 바꾸지 않는다). 파일 입력의 `click`을 창 단위에서 `preventDefault`하면 파일 창이 열리지 않는다(읽은 것) | `Electron/`이 없으면 mock의 그 식을 검사 창이 가진 다른 표지로 바꾼다(그리고 9.4·R3-6의 글자와 10.1 '그 밖의 파일' 표의 가짜 `navigator`도 — 같은 커밋에서). 가드가 `false`를 돌려주지 않으면 그 줄들(V6·V6b·F3·H2·S9)을 하지 않고 까닭을 적는다 — 파일 창을 띄워 보며 확인하지 않는다 |
| 가짜 `DataTransfer`가 `dropEffect`를 받는지 (E1) | 받지 않는다(스크립트로 만든 것은 끌기용이 아니라 엔진이 무시한다 — 읽은 것) | 받으면 막힌 줄에서 그 값이 `'none'`인지도 본다. 받지 않으면 그 값은 앵커 R3-2의 글자와 실기 2로만 확인된다 |
| 막힌 대상 위에서 놓으면 정말 `drop`이 오지 않는지 (실기 2) | `dropEffect: 'none'`이면 `dragleave`로 끝난다(2.7) | `drop`이 온다면: `addImages`의 막힌 가지가 알림 줄에 까닭을 적는다(코드는 이미 그렇게 돼 있다 — 해가 없다). 본 대로 적는다 |
| 탐색기 끌기의 `types`가 `'Files'`뿐인지, 브라우저 끌기의 경로가 무엇인지 (실기 1·3) | 탐색기는 `'Files'`뿐, 브라우저는 `text/uri-list`·`text/html`이 함께(2.7) | 탐색기 끌기에도 다른 형식이 실려 원본 경로가 비면 `disk`를 `!types.some(type => type === 'text/uri-list' \|\| type === 'text/html')`로 바꾼다(그리고 R3-2의 글자도) |
| 알림 줄을 끌어오는 것이 좁은 창에서 과한지 (F3) | `nearest`라 보이면 움직이지 않고, 넣기를 시작할 때에만 한다 | 도면이 화면에서 완전히 밀려나 불편하면 그 effect의 `scrollIntoView` 줄을 빼고(K13) 보고에 적는다 — 그때 좁은 창에서는 내려가야 표시가 보인다 |
| 흐린 카드의 표시와 막대가 낮은 목록에서 보이는지 (F8) | 표시는 카드 위에서 9px, 막대는 맨 위 3px이다 | 가려지면 표시의 `top`을 줄인다. 그래도 안 보이는 높이면 본 대로 적는다(그때도 알림 줄의 '넣는 중'은 보인다) |
| 막대의 전환·새 카드의 움직임이 '최소'에서 꺼지는지 (E6) | 빌드의 짝 만들기가 `no-preference` 블록을 '최소'에서 뺀다 — **개발 서버에서도** PostCSS가 돈다 | 꺼지지 않으면 그 블록의 선택자를 플러그인이 읽는 꼴(한 줄에 선택자 하나)로 다시 쓴다. `test:motion`이 경고를 낸다 |
| 미리보기의 480px 미리보기 (F6, H2) | `canvas.toDataURL('image/webp', 0.8)` | WebP로 나오지 않으면 `image/jpeg`(투명 부분은 흰색)로. 미리보기에서만의 일이다 |
| 저장 실행의 길이 (**실기 9에서만 잴 수 있다** — 미리보기의 저장은 곧바로 끝난다) | 그림마다 왕복 한 번 — 열 장이면 몇 초 | 지나치게 길면 패치 배포로 `maxFiles`를 줄인다(5). 화면의 문구는 상수에서 나오고, 업데이트 내역(11절)과 13.2에 적은 '10장'은 그 수로 함께 고친다 — 한솔에게 알릴 수가 바뀌므로 실기 9의 결과와 함께 묻는다 |
| 속성 칸에 커서를 둔 채 잠글 때 치던 것이 확정되는지 (S3, 실기 12) | 잠그기 직전의 `blur()`가 칸의 `onBlur`를 부른다(`canEdit`이 아직 참이다). 엔진은 커서 밑에서 꺼지는 칸에 `blur`를 보내지 않는다(읽은 것 — 그래서 직접 부른다. 보낸다 해도 그때는 `blur()`가 먼저 끝나 두 번 돌지 않는다) | 확정되지 않으면(칸이 덜 친 글자를 쥔 채 남으면) `lock`의 그 줄을 `requestSave`처럼 포커스를 도면으로 옮기는 것으로 바꾼다(`focusCanvas()` — 치던 손의 다음 글쇠가 도면의 단축키가 되는 값을 13.3에 적고, R3-1의 글자도 함께 고친다) |
| 알림 줄이 낮은 목록에서 넘치지 않는지 (F8의 1000px) | 줄이 40px까지 줄고 그 안의 글 상자가 스크롤한다(`flex:0 1 auto`·`min-height:0` — 세로로 쌓인 목록에서 머리줄은 제 높이를 지키고 카드 상자는 0에서 시작하므로, 모자란 높이는 이 줄이 받는다) | 넘치면 못 넣은 목록을 접힌 `<details>`로 바꿔(요약 `넣지 못한 그림 N장`) 줄이 문장의 높이를 넘지 않게 한다 — 문장의 `N장은 넣지 못했어요(아래 목록).`은 그대로다. 7.4의 태그와 R3-6의 글자를 함께 고치고 보고에 적는다 |
| 1차·2차의 구현이 설계와 다른 곳 (0단계) | 2.8의 표 — 2026-10-15에 `633e7afb`에서 봤다: `mapDeleteCauseText`(mapDelete.ts:144-148), 편집기의 삭제 핸들러의 첫 표지 `function dropGoneDrafts(`(편집기 :720)와 `dialogOpen`(편집기 :283), 앵커의 끝 72, 2차의 핸들러 다섯의 첫 자리(`clearSelection` 다음) — 모두 있다 | 대체안이 필요 없다. 그 뒤로 `origin/main`이 움직여 다르면 만든 코드를 따르고 PR에 적는다 |

---

## 13. 열린 질문 · 알릴 것 · 알고 넘어가는 것

### 13.1 한솔에게 물을 것

없다. 4절의 열린 결정(추가 요청 계획 :94-100)은 추천안으로 정해 알렸다. 알린 것이 한 가지로 정하지 않는 곳은 1.2가 정했다('배경 목록' 탭의 놓기는 범위 밖이다 — 13.2에 적는다).

### 13.2 한솔에게 알릴 것 · 완료 보고에 적을 것

알린 네 가지는 그대로 만들었다. 아래는 알린 것에 없던 것과, **알린 말이 그대로는 맞지 않는 곳**이다(비개발자 문장으로 옮겨 적는다).

**알린 말과 다른 곳 — 먼저 알린다**

- **"놓는 즉시 저장된다"는 "올리기가 모두 끝난 뒤에 저장된다"이다.** 그림은 한 장씩 올라가고, 다 올라간 뒤에(그리고 끌던 것을 놓은 뒤에) 한꺼번에 저장된다 — 한 장이면 곧바로지만 큰 그림 열 장이면 수십 초가 걸릴 수 있다. **올리는 동안 다른 메뉴로 가면 그 넣기의 그림은 들어가지 않고, 저장하는 도중이면 그때까지 저장된 것만 남는다**(남은 것은 도면에 이어지지 않는다 — PC에 있는 같은 파일을 다시 넣으면 새로 만들지 않고 이어 준다, K4. 어느 쪽이든 말해 줄 화면은 없다, 5.5). 그래서 넣는 동안의 알림 줄이 "끝나기 전에 다른 메뉴로 가면 그림이 들어가지 않아요"라고 한다 — 기다리게 하려는 짧은 말이라 저장 도중의 경우는 적지 않았다. 업데이트 내역(11절)도 "놓는 즉시"라고 하지 않고 "다 올라가면 곧바로 저장돼요"라고 적는다. 걸리는 시간은 실기에서 재서 함께 알린다(10.4의 9).
- **넣는 중에 한 번 더 넣는 것은 받지 않는다**(줄 세우지 않는다). 끌어다 놓으면 "지금은 넣을 수 없어요"가 뜨고, 붙여 넣으면 알림 줄이 그렇게 말한다. 끝난 뒤에 다시 넣는다.
- **저장이 도는 동안 도면을 누른 뒤의 붙여 넣기는 한 번 넣지 않는다**(K20). "고르고 붙여 넣고, 다음 것을 고르고 붙여 넣기"를 빠르게 이어 하면, 저장이 도는 몇 초 동안은 여느 저장처럼 도면의 누름이 받아들여지지 않아 "다음 카메라"가 골라지지 않은 채일 수 있다. 그때의 붙여 넣기는 **앞의 카메라에 말없이 들어가지 않는다** — 넣지 않고 알림 줄이 "저장하는 동안 도면을 누른 것은 골라지지 않았어요. 넣을 곳을 다시 누른 뒤 붙여 넣어 주세요."라고 한다. 다시 누르고 붙여 넣으면 된다.
- **그림 하나의 저장이 실패하면 그 뒤의 그림은 보내지 않는다**(K21) — 한 장을 막은 것(끊긴 연결 등)이 나머지도 막고, 실패할 때마다 편집기가 잠긴 채 기다리기 때문이다. 그때까지 들어간 그림은 남고 이어지며, 못 넣은 그림은 까닭과 함께 목록에 나온다. 다시 놓으면 된다(같은 파일은 둘이 되지 않는다 — K4).
- **넣는 중에 떠나거나 저장에 실패한 그림의 미리보기 파일은 저장소에 남는다** — 넣기 한 번에 많아야 10개, 아무것도 가리키지 않는 파일이고 지금은 지우는 길이 없다('배경 등록' 창에서 올리다 그만둔 그림도 같다). 진행 중인 저장소 정리에서 `backgrounds/` 아래의 주인 없는 파일로 함께 다룰 대상이다.
- **잠긴 카메라, 배경 장소가 없는 잠긴 공간에는 넣을 수 없다.** 까닭과 푸는 자리(편집하면서 속성의 '위치·크기·잠금' 안의 '위치와 속성 잠금')가 덮개·버튼의 풍선·알림 줄에 나온다.
- **글자 칸에 커서가 있으면 붙여 넣기가 그 칸의 것이 된다**(K18). 공간을 막 그렸을 때(이름 상자가 열려 있다)와 속성의 이름 칸에 이름을 친 직후가 그렇다 — 그림만 복사해 둔 때에는 알림 줄이 "글자 칸에 커서가 있어서 그림을 넣지 않았어요 …"라고 알려 준다. 넣을 공간이나 카메라를 한 번 누른 뒤 다시 붙여 넣는다.
- **막힌 채 놓으면 아무 일도 없다**(K16): 덮개가 까닭을 말하고 포인터가 '놓을 수 없음'이 된다. 놓은 뒤에 따로 남는 안내는 없다.

**알린 것에 없던 것**

- **장소 창의 두 선택의 글자**: 알릴 때는 '이 공간 이름으로 장소 만들기 / 기존 장소 고르기'라고 했다. 창에는 `새 장소 만들기`(이름 칸에 그 공간의 이름이 적혀 있고 고칠 수 있다)와 `기존 장소에서 고르기`로 적힌다 — 뜻은 같다. '기존 장소에서 고르기'가 골라진 채 뜨는 것은 **같은 자리(같은 상위 장소 아래)에 같은 이름으로 있고 어느 도면도 쓰지 않는 장소**가 있을 때뿐이다(K9 — 앞서 만들었다가 연결만 잃은 장소다. 다른 도면이 쓰는 같은 이름은, 그 도면을 아직 저장하지 않았어도 골라 두지 않는다 — Enter 한 번에 남의 장소로 들어가지 않게). **새 장소는 그 도면의 대표 장소 아래에 만들어지고**(대표 장소가 없으면 맨 위에) 창이 그 자리를 적는다. 대표 장소가 없는 도면에 넣을 때도 같은 창이 뜬다(그때는 도면의 이름).
- **들어가는 배경의 기본값**(K2): 이름은 파일 이름(확장자 제외)이고, 화면 캡처처럼 이름이 없는 그림은 `붙여 넣은 그림 14:05`(넣은 시각)다. 같은 장소에 같은 이름이 있으면 ` (2)`, ` (3)`이 붙는다. 구도는 '전체 전경', 낮·밤은 '낮' 하나로 들어가고 카드에서 고친다.
- **대상**: 기호를 골랐으면 그 기호가 속한 공간에, 평면에서 여러 개를 골랐으면 도면에 들어간다. 놓는 자리는 대상을 정하지 않는다(도면 목록 위에 놓아도 된다).
- **카메라에 넣은 그림의 장소**(K1): 그 카메라가 **서 있는** 공간의 장소, 없으면 도면의 대표 장소, 그것도 없으면 물어본다. 어느 공간 안에도 서 있지 않은 카메라만 속성의 '카메라가 있는 공간'에 적힌 공간을 따른다(그 칸은 카메라를 옮겨도 저절로 바뀌지 않는다). **어느 장소로 들어가는지는 덮개의 둘째 줄과 알림 줄이 이름으로 말한다.**
- **문장의 '그림'과 화면의 '이미지'**: 알린 말대로 문장은 '그림'이라고 하고, 버튼과 머리줄은 화면의 이름('＋ 이미지 추가', '배경 이미지') 그대로다. 덮개와 알림 줄은 "‘2-1 교실’의 배경으로"처럼 무엇으로 들어가는지를 말한다('도면 밑그림'과 헷갈리지 않게).
- **한 번에 10장, PNG·JPG·WebP, 장당 20MB**(K3). 넘는 것과 못 넣은 것은 까닭과 함께 목록으로 알려 준다. 10장이 맞는 수인지는 실기에서 걸리는 시간을 재 보고 함께 알린다(10.4의 9 — 줄이게 되면 업데이트 내역의 수도 함께 고친다).
- **같은 파일을 다시 넣으면 새로 만들지 않는다**(K4). 그림을 고쳐서 다시 넣어도 새 수정본이 되지 않는다 — 알림 줄이 **그 배경의 이름**과 함께 "그림을 고쳤다면 그 카드를 열어 '이미지파일 연결'로 새 수정본을 넣어 주세요"라고 알려 준다. 화면 캡처처럼 파일이 아닌 그림, 브라우저에서 끌어온 그림(K19 — 원본 경로를 적지 않는다)은 넣을 때마다 새 배경이다.
- **탐색기에서 '복사'한 파일의 붙여 넣기**(K6): 실기에서 본 대로 적는다 — 이벤트에 실려 오면 여러 개·WebP도 되고, 아니면 첫 파일 하나(PNG·JPG)만 되며 그때 알림 줄이 "한 번에 한 장만 들어와요. 여러 장은 끌어다 놓아 주세요"라고 덧붙인다.
- **저장은 조용할 때 시작한다**(K7): 그림을 올리는 동안에는 도면을 그대로 쓸 수 있고, 끌던 것을 놓고, 그리던 다각형을 마치고, 평면의 이름 칸과 열린 창을 닫은 뒤에 저장이 돈다(그동안 흐린 카드가 '저장 기다리는 중'이다 — 무엇을 기다리는지는 적지 않는다, 13.3). 저장이 도는 몇 초 동안은 여느 저장처럼 도면이 눌리지 않는다. 그때 속성 칸에 글자를 치고 있었다면 치던 것이 '도면 저장'을 누를 때처럼 확정되고 커서가 빠진다(13.3). 글자 칸이 아닌 곳(오브젝트 목록의 줄·눈, 버튼)의 포커스는 저장이 시작될 때 건드리지 않는다(9.3).
- **넣을 때 목록이 스스로 움직이는 두 가지**: 방금 넣은 카드가 검색어·구도·낮밤에 가려지면 그 조건이 풀린다(7.2). 좁은 창에서는 넣기를 시작할 때 알림 줄이 보이게 탭이 한 번 스크롤된다(K13 — 끝날 때는 움직이지 않는다).
- **같은 편집에서 장소를 막 이은 공간에 한 번 더 넣으면** 장소를 다시 묻지 않는다. 그림은 바로 저장되지만 그 공간과 장소의 연결이 아직 저장 전이라, 덮개와 알림 줄이 "'도면 저장'을 눌러야 남아요"라고 말한다(띠의 '저장 안 한 변경'과 같은 말이다).
- **이어 주지 못했을 때**(그 사이 지워졌거나, 잠겼거나, 저장이 거절됐다): 그림은 그 장소에 남고, 알림 줄의 끝이 손으로 잇는 자리를 말한다 — 카메라는 편집하면서 속성의 '시점 연결', 공간은 '배경 장소 연결', 도면은 '도면 설정'의 '대표 장소'.
- **편집 중에 넣었을 때**: Ctrl+Z는 "이어 준 것"만 되돌린다 — 그림은 배경 목록에 남고, 카메라를 고른 목록에서는 사라져 보인다. '편집 끝내기 → 버리고 끝내기'도 같고, 그때 창이 한 문장으로 알려 준다. 알림 줄은 그때마다 지금의 모습을 말한다('도면 저장' 뒤에는 "저장됐어요", 되돌리거나 버린 뒤에는 "지금은 남아 있지 않아요"). **다른 메뉴로 갔다 오면 저장 안 한 편집이 사라지는 것은 지금과 같아서, 이어 준 것도 함께 사라진다**(넣기가 끝난 뒤라면 그림은 남는다. 같은 파일을 다시 넣으면 새로 만들지 않고 이어만 준다) — 다음 차례(이 PC에 보관)가 이 틈을 닫는다.
- **잘못 넣은 그림을 지우는 법.** 공간·도면에 넣은 것, 편집 중에 카메라에 넣고 아직 '도면 저장'을 하지 않은 것은 카드를 열어 '배경 원본 삭제'로 바로 지운다(초안의 연결도 알아서 빠진다 — K14). **카메라에 넣었고 그 연결이 이미 저장된 것**(편집 중이 아닐 때 넣었거나, 넣은 뒤 '도면 저장'을 했다)은 네 걸음이 든다: ① '편집 시작' ② 그 카메라의 '시점 연결'에서 그 그림의 체크를 푼다 ③ '도면 저장' ④ 카드를 열어 '배경 원본 삭제'. 넣은 그림을 모두 지우면 알림 줄이 "넣은 그림은 그 뒤에 지워서 지금은 배경 목록에 없어요"로 바뀐다.
- **파일을 끌고 들어오면 열려 있던 평면의 이름 칸은 닫힌다** — 치던 이름은 도면을 누를 때처럼 그대로 들어간다(K7).
- **붙여 넣기의 조건**: 도면 탭이 보이고, 글자 칸에 커서가 없고, 창이 떠 있지 않을 때다. 포커스가 어느 버튼에 있는지는 가리지 않는다(사이드바에서 막 들어온 때에도 된다). 그때 클립보드에 그림이 있으면 Ctrl+V 한 번으로 바로 등록된다 — 실수로 눌렀으면 위의 법으로 지운다.
- **새 카드는 목록의 맨 앞에 온다**(화면을 떠날 때까지). 알림 줄은 닫을 때까지 남는다.
- **저장이 실패하면** 까닭이 알림 줄에 사람의 말로 나온다. 지금의 다른 저장 실패에서 화면 위쪽에 뜨는 붉은 줄(영어가 섞인 긴 글)은 이 기능의 저장에서는 뜨지 않는다 — 도면이 그 줄만큼 줄거나 밀리지 않는다.
- **이번에 넣지 않은 것**: 카드 위에 놓아 새 수정본으로 넣기, 낮·밤 짝 묶기, 놓은 자리로 대상 정하기, '배경 목록' 탭의 놓기, 넣기 취소 버튼, 넣기를 줄 세우기.
- 대체안을 쓴 곳(12절의 표)과 실기에서 본 것(10.4)을 본 대로 적는다.

### 13.3 알고 넘어가는 것

- **실수로 누른 Ctrl+V.** 엑셀의 셀이나 문서의 그림을 복사해 둔 채 도면 탭에서 Ctrl+V를 누르면 그 그림이 배경으로 등록된다(표시는 뜬다). 한 번에 되돌리는 버튼은 없다 — 지우는 법은 13.2의 것이고, 편집 중이 아닐 때 카메라를 고른 채였다면 네 걸음이다. 글자가 함께 든 클립보드를 넣기로 치지 않는 방법은 쓰지 않았다(4.3 — 어떤 프로그램이 그림에 글자를 곁들이는지 재 보지 못했다. 실기 4에서 적는다). 배한솔 계정 한정인 동안은 받아들인다 — **팀에 열기 전에 다시 정한다**(편집 권한을 넓히면 mock의 역할 판정과 '관리자만' 문구도 그때 함께).
- **글자 칸에 커서가 없으면 포커스가 어디에 있든 받는다.** 진짜 붙여 넣기의 대상은 글자 칸이 아니면 늘 `body`라서(2.6) "포커스가 편집기 밖에 있을 때는 넘긴다"는 가드를 둘 수 없다. 그래서 앱의 사이드바·머리줄의 버튼에 포커스가 있을 때도, **`dialog`도 `aria-modal`도 아닌 앱의 창**(비밀번호 변경, 사용자 관리 — `src/components/auth/`)이 떠 있을 때도 그 창의 글자 칸에 커서가 없으면 붙여 넣기가 그 밑에서 들어간다(`body`에 포커스가 있을 때만이 아니다). 사이드바에서 막 들어온 때에 붙여 넣기가 되는 것은 바라는 동작이고, 그 두 창 밑에서 들어가는 것이 치르는 값이다 — Ctrl+S의 같은 틈(v1.135.0)보다 넓다. 실기 5에서 본다.
- **응답과 다시 읽기를 모두 잃은 저장**: 이 PC는 그 배경이 들어갔는지 모른다 — "넣지 못했어요"로 나오고 이어지지 않으며, 그 뒤의 그림은 보내지 않는다(K21). 읽기가 살아나면 카드가 목록에 나타난다(그 장소 아래, 이어지지 않은 채). 다시 넣으면 경로가 있는 파일은 K4가 이어 주고, 없는 그림은 하나 더 생긴다.
- **저장소에 남는 미리보기**: 올리기는 됐는데 저장이 안 된 그림, 화면을 떠나 끊긴 넣기의 그림은 저장소(`scene-images/backgrounds/`)에 남는다. 지우는 길이 없다('배경 등록' 창도 같다).
- **원자적이지 않다.** 넣기 한 번은 명령 여러 개다(장소 → 배경들 → 도면). 사이에 끊기면 일부만 된 상태가 남고(모두 온전한 라이브러리다) 알림 줄이 어디까지 됐는지 말한다. 한 번에 처리하려면 서버 함수를 바꾸는 migration이 든다.
- **비용**: 그림마다 메인 프로세스가 권한을 보려고 라이브러리를 한 번 읽고, 저장마다 라이브러리 전체가 돌아오며 모든 화면에 신호가 간다. 열 장이면 왕복 스무 번 남짓이다. 재 보지 않았다(10.4의 9).
- **넣기는 올리기가 모두 끝나야 저장을 시작한다.** 그 전에 화면을 떠나면 그 넣기의 그림은 하나도 들어가지 않고, 말해 줄 화면도 없다(5.5, 1.3 — 도는 동안의 문장과 13.2로 알린다).
- **연결이 끊긴 동안 라이브러리의 붉은 줄은 여전히 뜬다 — 읽기의 것이다.** 이 기능은 자기가 보낸 저장의 붉은 줄만 끈다(5.2의 `hush`). 연결이 끊긴 채면 15초마다의 읽기가 실패하며 그 줄을 켜고(껍데기가 붙은 글, 도면이 그 높이만큼 줄거나 밀린다 — 2.4), 다음에 읽기가 되면 꺼진다. 오늘과 같은 일이고, 이 차례는 저장소와 라이브러리 화면을 고치지 않는다. 드물게 `hush`가 그 읽기의 글을 지울 수 있다(보내기 전에 거절된 명령 — 5.2): 다음 읽기가 다시 켠다.
- **멈춘 뒤에도 이어 주기는 한 번 보낸다.** 보기 모드에서 배경의 저장이 실패해 멈췄을 때, 그때까지 들어간 그림을 도면에 잇는 `save-maps` 하나가 더 나간다 — 연결이 끊겨 멈춘 것이면 그 하나도 실패하고(까닭이 알림 줄에 적힌다), 잠긴 시간은 실패한 저장 두 번이다(열 번이 아니다). 편집 중이면 초안에 잇는 것이라 보내는 것이 없다.
- **`저장 기다리는 중`은 무엇을 기다리는지 말하지 않는다.** 끌던 것, 다른 저장, 열린 창은 곧 끝나지만 **평면의 이름 상자와 그리던 다각형은 스스로 끝나지 않는다** — 올리는 도중에 이름 상자를 열거나 다각형을 찍다 만 채 자리를 비우면 그동안 저장이 시작되지 않고, 그 채로 다른 메뉴로 가면 그 넣기는 들어가지 않는다(도는 동안의 문장이 그렇게 말해 둔다). 파일을 끌고 들어올 때 열려 있던 이름 상자는 닫히므로(4.2) 남는 것은 올리는 도중에 연 경우다. 기다리는 까닭을 흐린 카드에 적는 것은 써 본 뒤에 정한다.
- **저장 중에 놓친 누름 뒤, 평면이 아닌 곳에서 고르면 붙여 넣기가 한 번 더 거절된다.** 놓친 누름의 표시는 평면의 다음 누름이 지운다. 그 사이 오브젝트 목록이나 3D에서 다른 것을 골랐어도 표시는 남아, 첫 붙여 넣기가 `…다시 누른 뒤 붙여 넣어 주세요`로 한 번 거절된다(다시 붙여 넣으면 고른 곳에 들어간다). 잘못 들어가는 쪽이 아니라 한 번 더 누르는 쪽으로 틀린다.
- **편집 중에 권한을 잃은 넣기의 까닭.** 저장 도중에 편집 권한이 없어지면(드물다) 멈춘 뒤의 이어 주기가 초안에 들어가지 못하고 줄이 `…이어 주지는 못했어요. 그 사이 … 지워졌거나, 잠겼거나, 다르게 이어졌어요.`라고 한다 — 권한이라는 말이 없다. 권한의 까닭은 못 넣은 그림의 목록에 적혀 있다.
- **그림을 일부만 지운 넣기의 줄은 넣었을 때의 수를 말한다.** 셋을 넣고 하나를 지워도 `그림 3장을 … 넣었어요`다(모두 지웠을 때만 줄이 바뀐다 — 7.4).
- **보기 모드의 바로 저장은 그 도면의 버전을 올린다.** 같은 도면에 저장 안 한 편집을 쥔 다른 PC(한솔의 다른 PC 포함)는 다음 저장이 거절된다 — '기존 도면 연결'·'설정 저장'과 같다.
- **큰 PNG는 작게 보관된다**: 미리보기가 2,000,000자에 들도록 650~900px까지 줄 수 있다(지금의 올리기 그대로). 원본은 경로로 이어진다.
- **속성의 칸에 치는 도중에 저장이 시작되면**: 저장 실행은 속성의 이름 칸·숫자 칸을 기다리지 않는다(K7). 잠그기 직전에 그 칸을 떠나게 해 **'도면 저장'을 누를 때와 똑같이 확정한다**(9.3의 `lock` — 친 이름과 범위 안의 수는 이미 초안에 있고, 범위 밖의 수는 가장 가까운 한계 값으로 들어가며, 숫자가 아닌 덜 친 글자는 버려지고 칸이 지금 값을 다시 보이고, 조합 중이던 한글은 확정된다). 그 뒤 저장이 도는 몇 초 동안 칸이 꺼지고 **커서는 돌아오지 않는다**(떠나게 하는 것은 글자 칸뿐이다 — 오브젝트 목록의 줄·눈이나 버튼의 포커스는 건드리지 않는다. 목록의 줄·눈은 저장 중에도 꺼지지 않으므로 그 손의 F2·`+`·`-`·`0`은 저장 뒤에도 듣는다). '도면 저장'과 다른 것은 하나다 — 그 일이 사용자가 고르지 않은 때에 일어난다(`150`을 치려고 `1`까지 친 화각이 `10`으로 들어간다. Ctrl+Z로 되돌린다).
- **장소만 생기는 경우**: 새 장소는 저장됐는데 그림이 모두 실패하면 빈 장소가 남고 그 공간에 이어진다. '배경 목록'에서 지울 수 있다(연결을 푼 뒤).

---

## 14. 설계 때 돌려 본 것

저장소 밖 임시 폴더에서, 3.1의 서명 그대로 쓴 `mapImageDrop.ts`의 시안을 **진짜 모듈**(`domain.ts`·`mapGallery.ts`·`mapStack.ts`·`mapWorkflow.ts`·`mapDocument.ts`·저장소 — 작업 폴더의 것을 읽기만 했고, 돌린 날 그 파일들은 `7b10e46d`와 같았다)에 대고 `node --test`로 돌렸다(Node 22.18). 세 번이다: 처음 판, 리뷰 뒤에 고친 판, 두 번째 리뷰 뒤의 판. **아래는 마지막 판의 결과다** — 그 판에서는 시안을 다시 쓰고(대상, 계획, 이어 주기의 네 함수, 문장), 5.2의 `run`과 5.4의 `linkAddedImages`를 이 문서의 글자대로 옮겨 돌렸으며, 문서의 `ts`·`tsx` 코드 블록을 한 줄씩 그 파일들과 견줬다(3.1의 선언과 5.2의 타입 선언을 뺀 모든 줄이 형 검사를 지난 파일의 줄과 글자 그대로 같다). †는 앞의 판에서만 돌린 것이다(그 길은 그 뒤 고치지 않았다). 화면·CSS·앱 엔진은 그려 보지 않았다(10.3). 시안은 지웠다 — 구현은 이 문서의 서명과 표를 따른다.

| 돌린 것 | 결과 |
|---|---|
| 대상과 장소 — 겹친 방('벽장')과 잠긴 방을 넣은 도면 둘, 값 통째 비교 | 3.2대로다. 장소 있는 방에 선 카메라는 속성이 비어 있어도 그 장소(`placeNodeId` = 그 방), '창고'에 선 카메라는 속성이 다른 방을 가리켜도 도면의 대표 장소(`cameraPlaceId: null`, `placeNodeId: null`), **겹친 두 방에서는 맨 위의 작은 방**이 카메라의 공간이고, 장소 있는 잠긴 방에 서 있으면 그 장소, 장소 없는 잠긴 방에 서 있으면 도면이 임자다. '창고'의 기호는 '창고'의 대상과 같다. 없어진 장소를 쥔 '창고'가 임자이고 `placeWas`가 그 id이며, 대표 장소가 없어진 도면은 `parentPlaceId: null`이다 |
| `sameNamePlaceId` — 여섯 경우 | 어느 도면도 쓰지 않는 같은 부모의 같은 이름 → 그 장소(대표 장소가 없는 도면에서는 맨 위의 것). 대표 장소가 같은 다른 도면의 공간이 쓰면 `null` · 둘 다 대표 장소가 없는 도면이면 `null` · 받은 도면(초안)의 다른 방만 쓰면 `null` · `maps`의 다른 도면의 초안만 쓰면 `null` · 저장된 도면만 쓰면(초안이 풀었다) `null` |
| 계획 — 번호와 이름 | `[스케치.psd, a.png, 같은 a.png, b.png]`의 `items`가 `index` 1과 3이고 `refused[0].index`가 0이다. `plan.place`는 장소 있는 공간에서 `{ 그 공간, 그 장소 }`, '창고'에서 `{ 창고, null }`. 한 넣기 안의 같은 이름과 붙여 넣은 자료 둘이 `교실`·`교실 (2)`·`붙여 넣은 그림 14:05`·`… (2)`가 되고, 번호 자리에서 자른 끝의 공백이 지워지며, `[png, gif]`의 끌기는 막히지 않는다 |
| `linkMapImages` · `mapImageLinkNow` · `mapImageLinkWanted` · `mapImageOutcomeNow` | 3.4대로다. 장소가 있던 대상의 연결은 같은 객체·`complete`이고 `'kept'`다. **장소가 초안에만 이어진 공간**은 `placeKept: false`로 받고, 그 연결은 `'draft'` → 저장하면 `'kept'` → 버리면 `'undone'`, 그림을 모두 지우면 `'gone'`이다. 임자가 그 사이 다른 장소를 쥐었으면 같은 객체·`false`. `was`가 없어진 장소의 id면 놓이고 `null`이면 놓이지 않는다. 그림 없이 장소만 정한 연결은 그 장소가 라이브러리에 있을 때만 "이을 것이 있다". `mapImageOutcomeNow`는 온전한 `'draft'`만 따라가고, 그림이 모두 지워진 `'missed'`는 `'gone'`이 된다 |
| 계획 → 명령 → 이어 주기 — 대상 열 × 그림 셋, 초안 없음·있음(스무 가지. 진짜 `validateBackgroundEntity`·`applyBackgroundCommand`·`saveMapChanges`·`selectMapBackgroundViews`·`reduceMapDocument`) | 스무 가지 모두: 명령의 종류가 `[place?] view view view`이고 명령마다 검증을 지나며 중간 라이브러리가 모두 온전하다. 이어 주기는 장소를 새로 정했거나 카메라 대상일 때만 도면을 바꾸고 — 초안이 없으면 도면 하나의 `save-maps`(그 도면의 버전), 있으면 단계 하나다. 끝난 라이브러리(와 그 초안의 저장)가 검증을 지나고, 새 배경 셋이 넣은 범위에 보이며, `cameraPlaceId`가 5.1대로다(방 안의 카메라 = 그 장소, 임자가 공간인 새 장소 = 그 장소, 그 밖 `null`) |
| `run`과 `linkAddedImages`를 그 글자대로 — 진짜 `useBackgroundStore`, 메모리 게이트웨이(거절·응답 잃기·다른 PC의 저장을 흉내 낸다), 진짜 문서 저장소(React의 훅만 손으로 만든 것) — 열한 장면 | ① 보기·카메라: `잠금 → 배경 셋 → 도면 → 풀림`, `seq`는 시작의 1 그대로. 그 뒤 그림을 모두 지우면 줄이 `…넣은 그림은 그 뒤에 지워서…` ② 편집 중·카메라: 배경만 보내고 초안에 한 단계 — 줄이 되돌리면 `…남아 있지 않아요`, 다시 실행하면 처음의 문장, 저장하면 `…저장됐어요` ③ 편집 중에 넣고 카드에서 지움: `…지워서 지금은 배경 목록에 없어요` ④ **새 장소를 초안에만 이은 공간에 둘째 넣기**: 장소를 묻지 않고, 단계가 늘지 않고, 줄이 `…'도면 저장'을 눌러야 남아요`, 초안을 버리면 `…남아 있지 않아요`, 다시 대상으로 하면 그 장소가 `sameNamePlaceId`다 ⑤ **둘째 배경이 거절됨**: 셋째를 보내지 않고(`배경, 배경, 도면`) 첫 장이 이어지며 저장소의 `error`가 `null`이다 ⑥ 응답을 잃은 저장은 넣은 것으로 치고 멈추지 않는다. 거절된 바로 저장은 `…까닭: 끊김(시험) 그림은 … 있어요. … ‘시점 연결’에서 이어 줄 수 있어요.`이고 `error`가 `null`이다 ⑦ 저장되지 않는 새 장소: 명령이 그 하나뿐이고 줄이 `넣은 그림이 없어요. 2장은 넣지 못했어요(아래 목록).` / 새 장소 뒤의 첫 배경이 거절되면 `장소, 배경, 도면`이고 줄이 `… ‘창고’ 장소를 도면에 이어 준 것은 바로 저장됐어요.` ⑧ 올리기가 모두 실패하면 잠금도 명령도 없다. 장소가 있던 대상에 아무것도 들어가지 않으면 이어 주기를 부르지 않는다 ⑨ 올리는 중에 떠나면 보낸 명령이 없다. 저장이 나가 있는 사이에 떠나면 그 뒤로 보내지 않고 **저장소의 `error`를 건드리지 않는다** ⑩ **깨끗한 초안(5판)과 도는 동안 다른 PC가 저장한 도면(6판)**: 이어 준 초안의 `baseRevision`이 6이고 그 저장이 통과한다(7판). 다시 놓지 않은 같은 일은 `다른 사용자가 내용을 변경했습니다…`로 거절된다 ⑪ 둘째 배경에서 권한을 잃으면(보기) 셋째도 도면도 보내지 않고 줄이 `…까닭: 배경 관리자가 편집할 수 있습니다. …`다 |
| 형 검사 — 저장소의 TypeScript 5.9.3(`strict`, 저장소의 옵션)으로 시안 + 이 문서의 코드(훅 전체, 갤러리 전체, 장소 창, 편집기에 더하는 줄 전부 — 상태 둘, `dialogOpen`, `linkAddedImages`, 블록, `gallery` 메모, `linksAdded`, 오류 띠·덮개·장소 창·버리기 창의 줄) | 오류 없음(일부러 넣은 틀린 줄 — 대상에 `maps`를 주지 않음, `say`에 숫자 — 은 잡힌다) |
| 9.2의 수와 정규식을 그 코드에 대고 셈 | 표의 수 그대로다(`addImages(` 3 · `pasteImages(` 2 · `resolveMapImageTarget(` 3 · `imageAdd.say(` 4 · 블록의 `dialogOpen` 4 · `event.preventDefault();` 2 · `if (gone()) return;` 5 · `hush();` 2 · `linkAddedImages`의 `doc.getState()` 4). `linkAddedImages`의 열한 줄에 1차의 정규식은 `'draft'` 셋에 걸리고, 작은따옴표를 더한 것은 걸리지 않는다 |
| 3.3·7.4의 문장, 7.6의 대비 | 문장은 시안이 찍어 낸 것을 옮겨 적었다(7.4의 표와 M-10의 통째 문장). 대비는 `src/themes.ts`의 값으로 셈했다 — 막대의 밝은 화면 1.1~1.9:1과 덮어쓴 5.2:1, 덮개 테두리의 1.4~2.4:1을 포함한다 |
| 앞의 판에서만† | 파일 받기의 경계(20MB, 경로의 대소문자·빗금, `사진.PNG`, 좋은 것 열 장 뒤의 `.psd`), 이름의 대리 쌍과 `09:07`, 만든 배경 하나의 통째 비교, 셋 가운데 둘만 올라갔을 때의 명령, '이미 있는 그림'을 올리는 사이 지웠을 때, `clipboardImageFilePath`를 가짜 읽개로(읽은 형식이 `FileNameW` 하나, PNG·WEBP·GIF는 경로, PSD·빈 버퍼·던짐은 `null`, 경로 둘이면 첫째), `git diff --stat a1436e9f 7b10e46d -- src tests electron`이 비어 있는 것 |
| 2026-10-15 — 만든 1차·2차(`633e7afb`)에 대고 다시 | 이 문서가 편집기에 넣는 줄 모두(9.3의 자리대로)와 7.6의 CSS(간격 줄 포함)를 그 커밋의 사본에 넣어 `tests/backgroundMapEditorWiring.test.ts`를 돌렸다: 72개 가운데 50·65만 떨어진다(이 차례가 고치는 둘 — 5 → 6, 그리고 `dialogOpen` 아홉 줄의 목록, 9.2). 장소 창의 줄을 삭제 창 다음이나 물음 다음에 두면, 또는 버리기 창의 덧붙는 식을 새 줄로 내리면 66도 떨어진다(9.3·8.1). 그 사본에서 `await persistMaps(` 6 · `swallowSecondClick` 5 · `execute(` 2 · `shownMap(` 4 · `hiddenIds.has(` 6. `mapImageDragRefused`의 규칙을 예전 글자 그대로 옮기면 글자 항목만인 끌기가 참이 된다(M-3과 어긋난다 — 4.2를 고쳤다) |
| **돌리지 않은 것** | 미리보기 mock(식만 적었다), 진짜 `mapDeleteCauseText`(1차가 아직 머지되지 않았다 — 시안은 같은 두 줄을 제 것으로 썼다), 6.2의 창 문장(`mapImagePlaceWords` — 글자만 적었다), 엔진의 동작 모두(끌기의 차례와 `relatedTarget`, 꺼지는 칸의 `blur`, 누르고 있는 키의 되풀이, 줄어드는 알림 줄 — 12절의 대체안이 걸려 있다) |
