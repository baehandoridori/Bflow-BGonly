# 배경 도면 다-2 — 저장 안 한 편집을 이 PC에 보관하고 알려 주기 — 설계 (2026-10-15)

> 요청(한솔, 2026-10-10, G2): "공간 편집 및 저장 버튼을 좀더 사용자친화적으로. … 편집 버튼 누르고 옮기고서 저장 안 하는 경우 빈번함." — 정한 방향(같은 날): **"직접 저장은 그대로 두고 표시를 뚜렷하게 + 저장 안 한 내용은 이 PC에 보관하고 알려 주기. 두 번에 나눠 낸다(표시 먼저, 보관 다음). 자동 저장은 넣지 않는다."** 표시(1차)는 v1.135.0으로 나갔다. **이 문서는 보관(2차)만** 다룬다.
> 한솔의 답(2026-10-13, 말 그대로): "셋 다 추천대로." — ① 껐다 켠 뒤에는 **묻지 않고 그대로 되살린다**(그 도면이 고친 모습 그대로 '편집 중'으로 열리고 한 번 알려 준다. 버리는 길은 '편집 끝내기 → 버리고 끝내기') ② 같은 도면이 다른 PC에서 먼저 저장됐거나 지워졌으면 **'내 편집을 새 도면으로 저장' + '내 편집 버리고 최신 내용 받기'**(덮어쓰기·합치기는 없다) ③ **'모두 저장'은 이번에 넣지 않는다.** 한솔에게 보인 요약(①~⑤)은 바꾸지 않는 제품 결정이다. 그 말이 오늘 코드에서 그대로는 맞지 않는 곳은 가장 덜 놀라운 쪽으로 정하고 13.2에 적었다.
> 버전: **v1.140.0**(머지 직전에 `origin/main`이 1.139.0인지 다시 본다) · **운영 DB·서버·저장 모양 변경 없음** · 메인 프로세스에 IPC 채널 둘(`background-kept:list`·`background-kept:put`)과 계정별 파일 하나가 는다 · 배경 메뉴는 계속 배한솔 계정 한정(`canAccessBackgroundLibrary`는 건드리지 않는다).
> 기준 코드: `fbb80bb6`(= main `a01d4cad` v1.139.0 + 문서 커밋 둘. `src`·`tests`·`electron`은 `a01d4cad`와 같다). **이 문서의 줄 번호는 모두 이 커밋의 것이다.** 이름만 쓴 파일은 `src/features/backgrounds/` 아래이거나 저장소에 그 이름이 하나뿐인 파일(`main.ts`·`preload.ts`·`Sidebar.tsx`·`themes.ts` 같은 것)이고, 줄 번호만 쓴 것은 `BackgroundMapEditor.tsx`다.
> 바탕: 조사 `da2-design.json`·추천 설계 `da2-input.md`(2026-10-13, v1.135.x 코드에 대고 씀 — 줄 번호와 몇 가지 서술이 낡았다, 2.11), 1차 설계 `2026-10-12-background-map-edit-state-strip-design.md`(**계약**: 저장은 편집을 끝내지 않고 `persistMaps`로 초안을 다시 놓는다 · 깨끗한 초안은 다른 PC를 따라가되 열린 창 밑에서는 아니다 · 띠의 높이는 40/72px 고정 · 10.4가 문서 저장소를 들어내라고 적어 두었다), 이후 차례의 설계 셋(v1.136.0 숫자·삭제 창, v1.137.0 눈·박스, v1.139.0 그림 넣기)과 만든 코드.

이 문서 하나로 구현할 수 있게 썼다. 여기 적힌 동작이 범위의 전부이고 적히지 않은 동작은 만들지 않는다. **구현 전에 한솔에게 물을 것은 없다**(13.1). 바뀌지 않는 코드는 다시 적지 않는다: 코드를 그대로 적은 곳은 앵커가 글자로 고정할 줄, 잘못 읽으면 동작이 달라지는 줄, 화면과 파일의 글자뿐이다. 설계하며 이 커밋의 사본에 새 코드를 넣어 테스트·타입 검사를 돌려 봤다(14절) — 첫 판의 줄은 그 사본에서 돈 것이고, 검토로 고친 줄은 글자 검사와 순수 함수 실험까지만 했다(14절 끝).

용어: **초안** = 문서 저장소에 든 도면 하나의 편집(`MapDraft`). **바뀐 초안** = `mapDraftChanged`가 참인 초안(저장 안 한 변경이 있다). **문서** = 초안·보기 값·선택·제스처를 쥔 저장소(`MapDocumentStore`). **세션** = 로그인한 계정 하나의 문서와 그 보관을 쥔 것(`MapDraftSession`, 새 파일). **보관본** = 이 PC의 파일에 적힌 도면 하나의 편집(`KeptMapEdit`). **보관 파일** = 계정 하나의 보관본을 모은 JSON(메인이 쓴다). **신호** = 앱의 늘 실린 부분이 보관 상태를 아는 작은 저장소(`useKeptMapEdits`, 새 파일). **되살리기** = 보관본을 초안으로 다시 넣는 것. **선 자리**(standing) = 바뀐 초안이 라이브러리에 대해 선 자리: 그대로(`current`) / 다른 곳에서 먼저 저장됨(`moved`) / 다른 곳에서 지워짐(`gone`). **선택 창** = `moved`·`gone`인 도면에서 '도면 저장'을 누르면 뜨는 창. **다른 메뉴 왕복** = 배경 화면을 떠났다(사이드바·단축키·검색·알림·`bflow://`·업데이트 필요 안내·오류 경계) 같은 실행 안에서 돌아오는 것. **검사 창** = 1~3차가 쓴 화면 밖 Electron 33 창(`npm run preview:electron`, 미리보기 `?preview=1`).

---

## 1. 목표와 범위

### 1.1 만드는 것

- **다른 메뉴 왕복**: 문서를 편집기 밖(계정별 세션)으로 들어낸다. 돌아오면 보던 도면·편집 중·초안·되돌리기 기록·'저장 안 한 변경 N개'·선택·평면의 보기 값이 그대로다. 묻는 것이 없다. 그러려고 라이브러리 화면은 그 계정으로 라이브러리를 읽은 뒤에야 본문을 그리고(4.4), 저장의 답을 받기 전에 떠났던 도면은 돌아올 때 저장된 것으로 다시 놓인다(8.1).
- **이 PC에 보관**: 도면 하나의 편집이 끝나면(끌기를 놓은 때, 칸에 친 때) 0.3초 안에 — 쉬지 않고 이어 고쳐도 0.3초마다 — 그 도면의 그때 모습을 메인 프로세스가 계정별 파일에 적는다. 저장·버림·모두 되돌림이면 곧바로 지운다. 트레이 '종료'·'지금 업데이트'·'로그아웃' 직전에 남은 것을 마저 적는다.
- **되살리기**: 로그인마다 한 번, 보관 목록을 읽었고 배경 화면이 편집 권한으로 라이브러리를 읽은 첫 순간에 보관본을 초안으로 넣는다(묻지 않는다). 가장 나중에 보관한 도면이 '편집 중'으로 보이고, 도면 위 안내 한 줄이 한 번 알린다. 수는 끄기 전의 수, 되돌리기는 거기서 멈춘다. 목록을 읽지 못하면 되살리지도 쓰지도 않고, 편집기가 다시 올라올 때 다시 읽는다(4.1).
- **점**: 저장 안 한 도면 편집이 있으면(보관본이든 이번 실행의 바뀐 초안이든) 왼쪽 메뉴의 '배경'과 '도면 탐색' 탭에 점, 도면 목록의 **접어 둔** 줄에도 점. 마지막 하나를 저장하거나 버리면 꺼진다(이 버전이 되살릴 수 없는 보관본이 남으면 사이드바·탭의 점은 켜진 채다 — K8).
- **다른 곳에서 먼저 바뀜**: 보는 도면의 바뀐 초안이 `moved`·`gone`이면 띠가 '다른 곳에서 먼저 저장됐어요' / '다른 곳에서 지워졌어요'라고 한다. 그때 '도면 저장'(과 Ctrl+S)은 아무것도 보내지 않고 선택 창을 연다: 돌아가기 / 내 편집 버리고 최신 내용 받기(지워졌으면 '내 편집 버리기') / 내 편집을 새 도면으로 저장.
- **보관 실패를 말한다**: 보관이 거절된(또는 목록을 읽지 못해 보내지 않은) 도면을 보고 있으면 띠가 '이 PC에 보관하지 못했어요'. 다른 곳에서 먼저 바뀐 도면이면 선택 창이 그 말을 한다(8.4).
- **업데이트 필요 안내**가 저장 안 한 편집이 보관돼 있다고 한 문장 더 말한다.
- **편집기가 그리다 깨지면**: 문서가 화면보다 오래 살아 다른 메뉴에 다녀와도·껐다 켜도 같은 초안이 다시 그려지므로, 도면 탐색 탭이 한 문장과 버튼 하나('저장하지 않은 편집을 버리고 다시 열기')를 보인다(4.7).
- 덤으로 고치는 것 하나: '내부 도면 만들기'의 다시 시도 가지가 공간 연결이 없을 때도 부모의 저장 안 한 편집을 버리던 것(이제 그 편집이 보관되므로 조용한 손실이 된다, 8.9).

### 1.2 알린 것이 한 가지로 정하지 않는 곳 — 묻지 않고 정한 것

완료 보고에 적는다(13.2). 다른 답이 오면 고칠 곳을 함께 적는다.

| # | 정하지 않은 곳 | 이 설계의 답 | 다른 답이 오면 |
|---|---|---|---|
| K1 | 보관 자리 | `%APPDATA%\Bflow-BGonly\background-map-kept.<계정 id>.json`. 메인이 읽고 쓴다(화면의 `localStorage`가 아니다 — 2.7) | 3절 |
| K2 | 쓰는 때 | 도면마다 편집이 끝나고 **0.3초 안에** 그때의 모습을 한 번 — 이어 고치는 동안에도 0.3초마다 한 번이라, 앱이 갑자기 꺼지면(멈춤·강제 종료·앱을 켜 둔 채 Windows를 끔) 빠지는 것은 마지막 0.3초 안쪽의 편집뿐이다(끌기 도중에는 쓰지 않는다). PC 전원이 갑자기 나가면 Windows가 아직 디스크에 굳히지 않은 마지막 몇 초가 빠질 수 있다 — 파일이 깨져 보관본을 통째로 잃지는 않는다(3.2). 저장돼 다시 놓였을 때·버렸을 때·모두 되돌렸을 때·최신 내용을 받았을 때는 **곧바로** 지운다 | `MAP_KEEP_DELAY_MS` |
| K3 | 보관하는 것 | 마지막 모습(도면 값)·연 때의 버전·저장 안 한 변경 수·적은 시각. **되돌리기 기록·선택·보기 값은 적지 않는다.** 밑그림이 `data:` 그림이면 빼고 적고 되살릴 때 라이브러리의 것을 붙인다(밑그림은 초안에서 바뀌지 않는다, 2.3) | `keptEntryOf` |
| K4 | 되살리는 때 | 로그인마다 한 번. 보관 목록을 읽었고, 라이브러리를 **편집 권한으로** 읽었고, 저장(그림 넣기의 저장 실행 포함)·끌기·편집기의 창이 없는 첫 순간(배경 화면을 연 직후, 첫 그리기 전). 그림을 올리는 동안은 기다리지 않는다 | 6.1 |
| K5 | 되살린 뒤 보이는 도면 · 알림 | 가장 나중에 보관한 도면. 도면 위 안내 한 줄: `지난번에 저장하지 않은 편집이 있던 도면 N개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요.`(수는 도면의 수 — 띠의 '변경 N개'와 섞이지 않게) 창은 뜨지 않는다 | 6.4 |
| K6 | 되살린 초안의 수와 되돌리기 | 수는 끄기 전의 수(`dropped = max(1, steps)`). 되돌리기·다시 실행은 꺼져 있다. 더 고치면 N+1… 되돌리면 N에서 멈춘다 | 6.3 |
| K7 | 라이브러리와 내용이 같은 보관본 | 말없이 지운다(저장 뒤 지우기가 닿기 전에 꺼진 것) | 6.2 |
| K8 | 되살릴 수 없는 보관본 | 도면 값이 이 버전의 도면이 아닌 것(다른 버전이 쓴 모르는 키·깨진 값)만이다 — 초안이 쥘 수 있는 값(빈 이름, 160자를 넘는 이름)은 되살린다(6.2). 그런 것은 파일에 그대로 두고 화면에 넣지 않는다(콘솔에 한 줄). 점은 켜진 채다 — 끌 길은 팀 공개(④) 때 함께 만든다. 보관본의 겉모양부터 다른 것(항목에 모르는 키 등, 3.1)은 목록에 오지도 않는다: 파일에 그대로이고 점도 콘솔 줄도 없다 | 13.3 |
| K9 | 다른 메뉴 왕복에서 남지 않는 것 | 평면/3D(평면으로), 도구, 그리던 다각형, 열린 창, 접은 도면 줄, 3D의 둘러보기 자세, 이미지 목록의 알림 줄·'추가됨'. 평면의 이름 상자에 치던 글자와 범위를 벗어나 아직 들어가지 않은 숫자는 **칸이 포커스를 쥔 채 화면이 바뀔 때**(이 창에서 아무것도 누르지 않은 채 — 업데이트 필요 안내가 뜰 때처럼)만 버려진다 — 다른 곳을 누르거나 다른 창·앱으로 가면(알림·`bflow://` 링크를 누를 때 포함 — 이 창이 포커스를 잃으면 칸도 떠나진다) 칸을 떠날 때처럼 들어간다(범위 밖 숫자는 가장 가까운 끝값). 칸에 커서가 있는 동안 Ctrl+숫자·검색 단축키는 화면을 바꾸지 않는다(지금 그대로). 속성 칸의 이름과 범위 안의 숫자는 칠 때마다 도면에 들어가 남는다. **도는 중인 그림 넣기는 지금처럼 거기서 그친다**(4.6) | 4.4 |
| K10 | 다른 계정으로 바뀌면 | 앞 계정의 세션을 메모리에서 버린다(보내지 못한 0.3초 안쪽의 쓰기도). 그 계정의 보관 파일은 그대로 — 다시 로그인하면 되살린다 | 4.5 |
| K11 | 로그아웃 | 씬 저장을 마저 보낸 뒤, 보관할 것을 마저 적는다(최대 3초). 그다음 로그아웃 | 4.5 |
| K12 | 띠의 새 글자와 모양 | `다른 곳에서 먼저 저장됐어요` · `다른 곳에서 지워졌어요`(테두리만 있는 알약 + 앞의 `!`) · `이 PC에 보관하지 못했어요`(바뀜의 채운 알약 그대로). 버튼은 늘지 않는다 | 8.2 |
| K13 | 다른 곳에서 바뀐 때의 '도면 저장' | 이름과 풍선(`도면 저장 (Ctrl+S)`)은 그대로이고 켜져 있다. 누르면 보내지 않고 선택 창을 연다 | 8.3 |
| K14 | 선택 창의 단추 | 돌아가기 · (위험 색)버리기 · (주 단추)새 도면으로 저장. 처음 포커스는 '돌아가기'. 폼이 아니다(Enter 하나로 고르지 않는다) | 8.4 |
| K15 | 새 도면 | 이름 `<원래 이름> (내 편집)`(160자에 맞춰 자른다), 원래 도면의 부모가 있으면 그 아래, 없으면 최상위. 하위 도면 연결·없어진 장소·없어진 시점은 빠진다. 저장한 뒤 그 새 도면이 **편집 중으로** 보이고(새 도면을 만들 때처럼 — 저장해도 편집이 끝나지 않는다는 1차의 약속 그대로, 띠 '저장된 그대로예요'), 원래 도면의 초안과 보관본은 사라진다 | `rescueMapCopy` |
| K16 | 지워진 도면의 '내 편집 버리기' | 초안이 없어져 그 도면이 목록에서 사라지고, 화면은 그 도면이 달렸던 위 도면으로 간다 | 8.5 |
| K17 | 점의 색과 자리 | 강조색에 글자 보조색의 1px 테두리(어느 테마·밝기에서도 바탕과 3:1 이상 — 강조색만으로는 몇 테마에서 모자란다). 사이드바는 캘린더 연결 점과 같은 크기·자리, 탭은 글자 뒤에 겹쳐 띄운다(폭이 그대로), 접은 줄은 지금의 점(●)과 같다 | 7절 |
| K18 | 보관 실패 | 도면마다 기억한다. 그 도면을 보고 있으면 띠가 말하고(보지 않는 도면에는 표시가 없다), 그 도면을 다시 고치거나 종료·로그아웃 때 다시 적어 본다. 그 초안을 저장하거나 버리면 잊는다 | 8.7 |
| K19 | 보관 목록을 읽기 전의 '편집 시작'·'＋ 공간 그리기' | 둘 다 흐리다(로그인 직후 한순간, 답이 없어도 5초까지 — 새 초안이 보관본 위에 쓰이지 않게) | 6.1 |
| K20 | 다시 시도 가지 | 부모의 초안은 **공간 연결이 있었을 때만**(잃은 명령에 부모가 들어 있었다) 버린다 | 8.9 |
| K21 | 업데이트 필요 안내 | 이 PC에 보관된 도면이 있으면 `이 PC에 저장 안 한 편집이 있는 도면 N개가 그대로 보관돼 있어요. 업데이트한 뒤 배경 화면을 열면 이어서 고칠 수 있어요.`(보관하지 못한 것은 세지 않는다) | 8.8 |
| K22 | 답을 받지 못한 이 PC의 저장 | 라이브러리가 바뀐 초안과 같은 내용을 다른 버전으로 갖고 있으면 '다른 곳에서 먼저 저장됨'이 아니다 — 그 도면으로 다시 놓는다(저장 중에 배경을 떠나면 생긴다) | 8.1 |
| K23 | 보관 목록을 읽지 못함(5초 안에 답이 없음 포함) | 읽힐 때까지 되살리지도, 쓰지도, 지우지도 않는다 — 읽지 않은 보관본을 덮어쓰지 않게. 편집은 막지 않고 바뀐 초안은 띠가 '이 PC에 보관하지 못했어요'. 편집기가 올라올 때마다 다시 읽고, 읽히면 그때 되살린다 | 4.1 |
| K24 | 편집기가 그리다 깨짐 | 도면 탐색 탭만 한 문장과 버튼 하나 — '저장하지 않은 편집을 버리고 다시 열기'(묻지 않고 모든 초안을 버린다. 다른 메뉴에 다녀오는 것이 버리지 않고 다시 그려 보는 길이다). 다른 탭은 그대로 | 4.7 |

### 1.3 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 자동 저장, 두 내용을 합치기, 다른 곳에서 저장한 내용을 내 것으로 덮어쓰기 | 한솔의 결정(2026-10-10·13) |
| '모두 저장' | 질문 3 — 다음 차례 후보(13.3) |
| 되살릴 때 '이어서 편집 / 버리기'를 묻는 창 | 질문 1 |
| 껐다 켠 뒤의 되돌리기 기록, 보기 값·선택 | 기록은 도면 50벌이다(`MAP_HISTORY_LIMIT`, mapEditSession.ts:38) |
| 그리던 다각형, 열린 창의 내용(올렸지만 저장하지 않은 밑그림 포함), 평면의 이름 상자에 치던 글자, 범위를 벗어나 아직 들어가지 않은 숫자 | 초안이 아니다(속성 칸에 치는 이름과 범위 안의 숫자는 칠 때마다 초안에 들어가 보관된다) |
| 떠나기·종료·업데이트·로그아웃 직전에 묻거나 알리기 | 조용히 보관한다. 종료는 화면에서 막을 수 없다(main.ts:5644) |
| 배경 화면을 닫아 둔 동안의 '다른 곳에서 바뀜', 보고 있지 않은 도면의 그 표시 | 그때는 라이브러리를 읽지 않는다. 그 도면을 열면 띠가 말한다 |
| 편집 권한을 잃은 계정·읽을 수 없는 보관본을 버리는 길, 보관본의 만료, 다른 PC와 맞추기 | 지금은 한솔 계정만 쓴다. 팀 공개(④) 때 권한 규칙과 함께 |
| '에피소드별 배경' 탭의 저장 전 목록, '도면 설정'·'기존 도면 연결'이 거절될 때의 문장 다듬기 | 다른 탭·다른 일 |
| 운영 DB·서버 함수·저장 모양(`types.ts`·`domain.ts`) | 쓰는 명령은 오늘의 `save-maps` 하나뿐이다 |
| 배경 메뉴의 노출 범위 | `src/features/playground/featureFlag.ts`는 건드리지 않는다 |

### 1.4 계속 지켜야 하는 규칙

| # | 규칙 | 지키는 방법 |
|---|---|---|
| R1 | v1.130.0~v1.139.0이 낸 동작은 물러서지 않는다 | 기존 앵커 가운데 72개는 한 글자도 고치지 않고 지난다. 일부러 고치는 것은 50·57·65(이 설계의 줄에 떨어진다 — 사본에서 확인했다), 52(안내 ×의 두 번 누름 막기로 수 7 → 8 — 글자로 셌다, 14절), 58('편집 시작'의 흐림 — 그 태그를 글자로 본다), 59(새 테스트 파일 이름)와 `tests/motion/fx3-retry-session.test.ts`의 정규식 하나뿐이다(9.2). 편집기가 깨질 때 v1.139.0은 다른 메뉴 왕복으로 풀렸다 — 문서가 화면보다 오래 살아 그 길이 없어지므로 도면 탐색 탭의 경계가 대신한다(4.7) |
| R2 | 렌더러 → IPC → 메인. 세션 토큰은 메인 밖으로 나가지 않는다. 신원은 메인의 세션이 정한다 | 두 채널은 preload가 세션 epoch를 싣고, 계정은 `getSessionOriginOrThrow()`가 준다(3.3). 화면은 계정 id를 보내지 않는다. 파일에 토큰·세션이 없다 |
| R3 | 자동 저장이 없다. 보관과 되살리기는 라이브러리에 아무것도 보내지 않는다 | 세션·규칙·신호 파일에 `execute`·`useBackgroundStore`·`backgroundExecute`가 없다(앵커 80). 선택 창의 새 도면 저장만 `persistMaps`를 지난다 |
| R4 | '바뀜'은 한 곳(`mapDraftChanged`·`mapDraftSteps`) | 되살린 초안은 기존 필드 `dropped`로 바뀜이 된다. 두 함수와 `freshDraft`는 그대로다(앵커 50이 그 글자를 본다) |
| R5 | 띠의 높이는 창 폭으로만 정해진다(40/72px). 글자는 한 줄이고 넘치면 말줄임, Ctrl+S 표와 두 버튼은 움직이지 않는다 | 새 상태는 `data-phase`의 모양과 글자뿐이다. 버튼을 더하지 않는다. 글자 폭은 게이트에서 잰다(12절) |
| R6 | 따라가기(`followSaved`)는 저장·끌기·편집기의 창 밑에서 돌지 않는다. 편집기에 창을 더하면 `dialogOpen` 한 줄에 더한다 | 선택 창의 상태 `staleChoice`를 그 줄에 더한다. 되살리기도 같은 조건을 본다 |
| R7 | 도면의 저장은 모두 `persistMaps`를 지난다. 편집기는 `doc.dispatch(`를 한 곳(`select`, :491)에서만 부른다(앵커 23이 센다) | 새 도면 저장은 7번째 `await persistMaps(`. 되살리기의 dispatch는 세션 안이다 |
| R8 | 편집기의 함수 순서 — 앵커가 표지에서 표지까지 잘라 읽는다 | 새 줄과 고친 줄의 자리는 9.3의 표가 전부다. 어느 조각 안에도 끼우지 않는다 |
| R9 | node --test로 도는 모듈은 `.ts` 상대 import, `import type`, 지울 수 있는 TypeScript, `@/` 없음 | `mapDraftKeep.ts`·`mapDraftSession.ts`·`mapKeptSignal.ts`·`src/shared/backgroundKeptEdits.ts`. 메인 모듈은 `electron` import가 없고 esbuild로 묶어 돈다(`tests/backgroundPersistence.test.ts`의 `load`) |
| R10 | 네이티브 모달(tasks/lessons.md 2026-10-11): `body`에 놓인 포커스의 키, 두 번의 Esc, 누르고 있던 키 | 선택 창은 1차 삭제 창의 세 장치(BackgroundMapDeleteDialog.tsx:26-41)를 그대로 쓰고 키 되풀이를 막는다(8.4) |
| R11 | 움직임 규칙 | 점은 정지한 표시(움직임·숫자 없음). 띠의 새 줄에 `animation`·`transition` 없음 |
| R12 | 화면 글자는 비개발자의 말(해요체), 기울임 없음, 식별자 없음 | 새 글자는 순수 모듈 셋에 모은다(`mapEditStatus.ts`·`mapDraftKeep.ts`·`mapKeptSignal.ts`). 다른 창과 같은 단추 이름만 그 창들처럼 그 자리에 쓴다: 선택 창의 `돌아가기`(삭제 창의 단추와 같다, BackgroundMapDeleteDialog.tsx:60)와 도는 동안의 `저장 중…`(설정 창의 단추와 같다, :1553) |
| R13 | 늘 실린 앱의 부분은 배경 기능의 작은 모듈만 import한다 | 사이드바·사용자 메뉴는 `mapKeptSignal.ts`·`BackgroundKeptDot.tsx`만(zustand와 타입, 이미 첫 묶음에 있는 `useAuthStore`뿐). `mapDocument.ts`와 편집기는 `BackgroundLibraryView-*.js` 묶음에 남는다(9.4) |

---

## 2. 현재 동작 (`fbb80bb6`)

### 2.1 문서의 수명 — 지금은 편집기와 함께 죽는다

- 문서는 편집기의 상태다: `const [store] = useState(() => createMapDocumentStore());`(useBackgroundMapDocument.ts:37). 편집기는 라이브러리 화면이 떠 있는 동안 산다(탭은 `hidden`으로 숨길 뿐이다, BackgroundLibraryView.tsx:153-161). 화면을 떠나면 앱이 그 화면을 내린다(`` <LazyErrorBoundary key={currentView} name={`View:${currentView}`}> ``, src/App.tsx:3301) — **초안·기록·선택·보기 값이 사라지고**, 라이브러리 저장소도 비워진다(`initialize(null)`, BackgroundLibraryView.tsx:55-57). 업데이트 필요 안내는 본문 대신 그려져(BackgroundLibraryView.tsx:118-126) 편집기를 내린다. 계정이 바뀌면 본문이 계정 id로 다시 그려진다(`key={user?.id || "signed-out"}`, BackgroundLibraryView.tsx:152).
- **다시 열면 편집기는 먼저 빈 저장소에 대고 한 번 올라온다.** 본문을 막는 조건은 `loading && !snapshot.maps.length && !snapshot.places.length`(BackgroundLibraryView.tsx:147)뿐인데, 앞 화면이 내려가며 부른 `initialize(null)`이 `loading: false`·빈 라이브러리·`canManage: false`를 남기고(useBackgroundStore.ts:25), `initialize(user.id)`는 화면의 effect에서야 돈다(BackgroundLibraryView.tsx:51-58. 앱을 켠 뒤 처음 열 때도 저장소의 처음 상태가 같다, useBackgroundStore.ts:22). 그래서 첫 그림은 편집기를 빈 라이브러리에 대고 그리고, effect는 자식부터 돌아 따라가기(:355-367)가 `followSaved([])`로 깨끗한 초안을 모두 지운다(mapDocument.ts:139-146). 곧이어 읽기가 시작되며 본문이 '불러오고 있습니다'로 바뀌고, 읽기가 끝나면 편집기가 다시 올라온다. 오늘은 문서가 편집기와 함께 새로 생겨 해가 없다. 문서를 들어내면 그 한 번이 깨끗한 초안(저장한 뒤의 편집 중, 모두 되돌린 초안과 그 다시 실행)을 지우고 보던 도면을 바꾼다 — 이 차례가 본문의 문을 고친다(4.4). 첫 읽기가 실패하면 빈 라이브러리·`canManage: false`로 그려진다(useBackgroundStore.ts:39).
- **내릴 때의 정리는 이미 있다**: `useEffect(() => abortGesture, [abortGesture]);`(:387, v1.130.0)가 도는 끌기를 취소한다(`doc.cancelGesture()`, :381). 칸에 이어 치던 묶음(`coalescing`)은 끝내지 않는다 — 칸이 포커스를 쥔 채 내려가면(그때의 `blur`는 화면에 닿지 않는다, 4.4) 문서가 화면보다 오래 살 때 돌아와 같은 칸에 처음 친 값이 앞의 되돌리기 단계에 합쳐진다(다른 곳을 눌러 떠나면 칸의 `blur`가 `onDone`으로 먼저 끝낸다, :1502).
- 그림 넣기(3차)는 내릴 때 거기서 그친다: `alive`(useMapImageAdd.ts:49)와 `gone()`(useMapImageAdd.ts:62)이 올리기 뒤·기다림 중·명령마다 본다(useMapImageAdd.ts:78·82·90·105·122). 이어 주기(`linkAddedImages`)는 그 뒤로 부르지 않는다.
- **저장이 도는 중에 떠나면 그 답은 버려진다**: `initialize(null)`이 세대를 올리고(useBackgroundStore.ts:24), 서버에서 끝난 저장의 답은 `로그인 세션이 변경되어 저장 응답을 폐기했습니다.`로 던져진다(useBackgroundStore.ts:52·55). 그래서 `persistMaps`의 다시 놓기(:542)와 삭제 실행의 `doc.discard`(:772)에 닿지 않는다. 오늘은 초안이 화면과 함께 사라져 드러나지 않는다(이 차례에서는 8.1).

### 2.2 '바뀜'과 수

`mapDraftSteps = dropped + past.length`, `mapDraftChanged = baseRevision === null || past.length > 0 || dropped > 0`(mapDocument.ts:264-270). `dropped`는 "기록이 더는 쥐지 않지만 저장되지 않은 단계"다(mapDocument.ts:12-14). 새 초안은 `freshDraft`(mapDocument.ts:74-76 — `past: [], future: [], dropped: 0`, 앵커 50이 글자로 본다). 지금은 `baseRevision === null`인 초안이 생기지 않는다(새 도면은 저장한 뒤 버전 1로 연다, :694-695).

### 2.3 저장 · 다시 놓기 · 따라가기 · 거절

- 도면의 저장은 모두 `persistMaps`(:537-544): `await execute(command)` → `doc.rebaseDrafts(savedMaps(command))`(초안이 있던 도면만 깨끗한 초안으로) → 띠의 '저장했어요'. 부르는 곳 여섯(`saveMap` :649, `createMap` :694, `linkMap` :704, `saveSettings` :715, `linkAddedImages` :739, `runMapDelete` :770 — 앵커 50이 6을 센다).
- `saveMap`(:636-651): 다각형(:640) → 바뀐 것 없음이면 쓰지 않음(:643) → 이름(:644) → 저장.
- **거절**: 저장은 도면마다 버전 비교다(domain.ts:144 `다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.`). 실패하면 저장소가 다시 읽고 붉은 줄을 켠다(useBackgroundStore.ts:59-71). 초안의 `baseRevision`은 그대로라 **다시 눌러도, 새로고침해도 또 거절된다** — 풀 길은 '편집 끝내기 → 버리고 끝내기'뿐이다.
- 깨끗한 초안만 라이브러리를 따라가고(`follow-saved`, mapDocument.ts:135-147), 라이브러리에서 없어진 깨끗한 초안은 사라진다. 저장 중·끌기·편집기의 창이 열린 동안에는 부르지 않는다(:355-367).
- 저장 중(`pending`)의 스냅샷은 낙관 값이고(useBackgroundStore.ts:48-49), 응답이 온 뒤 다시 놓기 전까지 저장한 도면은 초안보다 한 버전 앞이다 — 편집기의 `busy`(:225)가 그 사이를 덮는다(`saveMap`은 `finally`에서야 끈다, :650).
- 초안의 밑그림(`imageUrl`)은 초안 쓰기로 바뀌지 않는다: 바꾸는 곳은 설정 창(:724-725)뿐이고 그 창은 바로 저장한다(:715). 그림 넣기의 이어 주기도 장소·시점만 바꾼다(mapImageDrop.ts).

### 2.4 끝나는 길

사용자가 편집을 끝내는 길은 '편집 끝내기'(`endEditing` :619-630 → 물음 → `leaveEditing` :613-617). 그 밖에 초안이 없어지는 곳: 도면 삭제(:772, :793, `dropGoneDrafts` :744), 다른 곳에서 지워진 도면의 깨끗한 초안(따라가기), **`createMap`의 다시 시도 가지**(:683-689 — 공간 연결이 없어도 부모의 초안을 버린다, :687).

### 2.5 종료 · 업데이트 · 로그아웃 · 강제 종료

- 창의 X는 트레이로 숨긴다(main.ts:942-949). 트레이 '종료'는 `app.quit()`(main.ts:244), '지금 업데이트'는 650ms 뒤 `app.quit()`(main.ts:1104).
- `before-quit`(main.ts:5531-5647): 모든 창에 정리 신호를 보내 답을 기다리고(`waitForRendererQuitFlush`, main.ts:5588-5598 — 답이 없어도 최대 3초, rendererQuitFlush.ts:18), 메인의 대기 작업과 함께 기다린 뒤(main.ts:5605-5630) 설치 도우미를 띄우고(main.ts:5632-5640) `app.exit(0)`(main.ts:5644) — 화면의 unload는 오지 않는다. 화면 쪽 등록 통로는 `onBeforeQuitFlush`(preload.ts:195, 타입 src/types/index.ts:1109)이고 쓰는 곳은 둘(CommentPanel.tsx:264, sceneSaveRetry.ts:38).
- 사용자의 로그아웃은 한 곳: `handleLogout`(UserMenu.tsx:24-31) — `await flushSceneSavesBeforeLogout();`(최대 3초, sceneSaveRetry.ts:94-104) → `await logout();`. 이 모양을 `tests/motion/fx3-retry-session.test.ts:388`이 정규식으로 본다. 계정이 지워져 밀려나는 길(`authoritativeUserSession.ts`)은 보내 보지 않는다.
- 크래시·작업 관리자·전원·강제 로그아웃·창 새로 고침에는 정리 통로가 없다. **앱을 트레이에 둔 채 Windows를 끄거나 다시 시작하거나 로그오프할 때도 없다** — Windows에서는 그때 `before-quit`이 오지 않고(Electron의 정해진 동작), main.ts에는 `session-end`를 듣는 곳이 없다.

### 2.6 메인 쪽 선례

- `settings:read/write`(main.ts:1276-1292): 쓰기가 원자적이 아니고 읽기는 모든 오류를 `null`로 접는다 — 잠긴 파일이 "없음"으로 읽혀 다음 쓰기가 지운다. **쓰지 않는다.**
- `PersonalTodoRecoveryJournal`(electron/personalTodoRecoveryJournal.ts:48-131): 프로미스 사슬 하나로 읽고-고치고-쓰기, 임시 파일 + 이름 바꾸기(쓴 내용을 디스크까지 내리지는 않는다, electron/personalTodoRecoveryJournal.ts:75-76 — 3.2는 내린다), `ENOENT`만 빈 것, `flush()`가 꼬리를 기다린다. 테스트는 임시 폴더로 직접 import한다(tests/personalTodoDataWiring.test.ts:90-111).
- ICS 구독 저장소(electron/icsSubscriptions.ts:488-550, main.ts:2640-2671): 읽을 수 없는 것과 없는 것을 가르고(백신의 잠김 `EBUSY`/`EPERM`을 빈 것으로 접지 않는다, main.ts:2647-2649), 깨진 파일은 한 번 옮겨 두고 새로 쓴다.
- 배경 IPC(electron/backgroundIpc.ts:14-23): `originFor(requestEpoch)` — 화면이 보낸 epoch가 지금 세션의 것이 아니면 거절, 기다린 뒤 `current(origin)`. 세션은 `getSessionOriginOrThrow()`(main.ts:2537-2553). 등록은 main.ts:2557-2565.
- 앱 폴더: `getDataPath()` = `app.getPath('userData')`(main.ts:749-751) = `%APPDATA%\Bflow-BGonly`. 모듈 맨 위에서 불러도 된다(복구 일지가 그렇게 쓴다, main.ts:1675).

### 2.7 왜 화면의 `localStorage`가 아닌가

`app.exit(0)` 앞에서 화면 저장소를 디스크에 비우는 호출이 없고(`flushStorageData` 없음), 출처의 한도를 앱 전체가 나눠 쓰며, 그 한도를 넘는 쓰기를 화면이 알릴 길이 없다. 메인이 계정별 파일을 원자적으로 쓰면 이 셋이 없어지고, 읽고-고치고-쓰기를 메인이 하므로 늦거나 실패한 화면의 읽기가 멀쩡한 보관본을 지울 수 없다. 2차의 보기 설정(눈·박스, `bflow.background-map.view.v1:<계정 id>`)은 잃어도 되는 값이라 `localStorage`에 그대로 둔다 — 이 차례와 섞지 않는다.

### 2.8 미리보기와 검사 창

- 미리보기 저장소는 `localStorage`의 `bflow-background-library-preview-v1` 하나(previewGateway.ts:10)이고, 쓸 때마다 `BroadcastChannel('bflow-background-library-changed')`로 신호한다(previewGateway.ts:13). mock의 배경 멤버는 `requireBackgroundPreviewSession()`(devElectronAPI.ts:150-158)으로 계정과 epoch를 본다(devElectronAPI.ts:3764-3802).
- mock의 `onBeforeQuitFlush`는 `noop`이다(devElectronAPI.ts:2704 — tests/motion/comments-notify-review-fix.test.ts:151이 그 글자를 본다. 고치지 않는다).
- 검사 창(`scripts/preview-electron.cjs`)은 preload를 싣지 않고 자기 폴더(`%TEMP%\bflow-preview-electron`)를 쓴다 — 설치된 B flow의 `%APPDATA%\Bflow-BGonly`에 닿지 않는다. 메인 쪽 코드는 검사 창에서 돌지 않는다.

### 2.9 늘 실린 부분 · 사이드바

- 사이드바의 배경 항목은 문(`canAccessBackgroundLibrary`)을 지난 계정에만 있다(Sidebar.tsx:235, tests/backgroundAccess.test.ts:42). 아이콘 칸(`<span className="shrink-0 w-12 flex justify-center relative">`, Sidebar.tsx:453-491)에 캘린더 연결 점(Sidebar.tsx:455-473)과 숫자 배지 둘이 있다. 사이드바는 로그인한 동안 `MainLayout`(src/components/layout/MainLayout.tsx:59)과 함께 늘 떠 있고, 로그아웃하면 내려간다(src/App.tsx:3342-3352).
- 이 worktree의 빌드(`dist/assets`)에서: `domain.ts`의 문장은 **이미 첫 묶음**(`index-*.js`)에 있다 — mock이 `previewGateway.ts` → `domain.ts`를 부른다. `mapDocument.ts`(낱말 `rebase-drafts`·`follow-saved` — 묶음은 `"rebase-drafts"`처럼 큰따옴표로 쓴다)는 `BackgroundLibraryView-*.js`에만 있다. 지킬 경계는 "문서·편집기 코드는 배경 묶음에"다.

### 2.10 사이드바를 읽는 테스트

`Sidebar.tsx`를 글자로 읽는 테스트는 열네 파일이다: backgroundAccess · sidebarCharacterPopout · calendarIntegrationStatus · calendarPopup · characterBoardAssetWorkflow · characterFeedback4 · characterFeedbackBatch · sceneNavigatorReferenceWiring · playgroundNavigationWiring · autoUpdateInstallerFlow · motion/buttonMotionRestore · motion/chrome-sliding-indicator · motion/chrome-tooltip-anchor · motion/view-transition-view-transition(calendarTransitionPerf·calendarSharedUi에 나오는 사이드바는 달력의 `WeekSidebar`·`DaySidebar`다 — 셋째 검토). 묶음으로는 test:background 하나, test:ui 셋, test:character 셋, test:motion 넷, test:entity·test:playground·test:auto-update 하나씩이다. 아이콘 칸에 닿는 규칙은 둘이다: nav 블록에 버튼 안의 버튼이 없다(sidebarCharacterPopout), `title={isVisuallyExpanded ? undefined : item.label}`이 없다(chrome-tooltip-anchor). 점은 `span`이고 그 글자를 쓰지 않는다 — 사본에서 돌려 새로 떨어지는 것이 없었다(14절).

### 2.11 조사(`da2-*`)에서 바로잡은 것

| 조사의 서술 | 오늘의 코드 | 이 설계 |
|---|---|---|
| 내릴 때 끌기를 취소하는 정리가 없다(그 조사의 :374) | 있다(:387, v1.130.0) | 새로 더하는 것은 칸 묶음 끝내기(`end-coalescing`)다. 훅이 둘을 함께 보낸다(4.3) |
| 앵커 50이 `persistMaps`를 넷 센다 | 여섯(1차의 삭제, 3차의 이어 주기) | 일곱(새 도면 저장) |
| 선택 창은 `confirmation`의 새 값 `'stale'` | 물음의 줄(:1558)은 앵커 52·66이 글자와 자리(삭제 창 바로 뒤, 그 뒤가 `</div>;`)를 고정하고, 어떤 값이든 단추 둘로 그린다 | 1차 삭제 창·3차 장소 창처럼 **연 도면을 쥔 별도 상태**(`staleChoice`)와 부품(`BackgroundMapKeptDialog.tsx`). `dialogOpen`에 한 낱말 — 따라가기·Ctrl+S·붉은 줄·그림 넣기의 넷이 저절로 본다 |
| `dialogOpen`을 읽는 곳 셋 | 일곱(3차가 넷을 더했다) | 아홉(되살리기의 가드와 의존 목록) |
| 메인은 before-quit의 두 `Promise.all`에 쓰기 큐를 넣는다 | 두 목록은 창의 정리 답과 **같은 때에** 만들어진다 — 창이 정리하며 보낸 쓰기는 그 뒤에 시작된다 | 기다림들이 끝난 **뒤**, 설치 도우미 앞에 한 줄(3.4) |
| 늘 실린 부분이 `domain.ts`를 부르면 안 된다 | 이미 mock을 통해 첫 묶음에 있다(2.9) | 지킬 것은 `mapDocument.ts`·편집기다. 빌드 뒤 묶음을 글자로 본다(10.5) |
| 점은 `currentColor` | 사이드바의 쉬는 항목은 흐린 회색이라 점이 묻힌다. 탭은 `--bmap-edit` 밖이다 | 강조색(K17) |
| stale에서 저장 버튼의 풍선을 바꾼다 | 그 풍선의 식을 앵커 51이 글자로 본다 | 그대로(K13). 띠의 글자와 창이 말한다 |
| '다른 곳에서 지워진 도면이에요' | 901px·사이드바를 연 창에서 남는 폭이 약 70px이다(1차 10.4) | `다른 곳에서 지워졌어요`(K12). 두 문장 다 게이트에서 잰다 |
| 앵커 46·52·53·54가 움직인다 | 이 설계의 줄로 고칠 기존 앵커는 50·52·57·58·59·65다(R1). 첫 판을 사본에서 돌려 떨어진 것은 50·57·65(+59의 이름 목록)이고, 52는 검토 뒤 더한 안내 ×(6.4) 때문에 수만, 58은 검토 뒤 더한 '편집 시작'의 흐림(6.1) 때문에 그 태그의 `disabled`만 바뀐다. 46은 안내 안의 문장과 본문의 문을 막지 않는다. 53·54는 그대로다 | 9.2 |
| 로그아웃은 `flushSceneSavesBeforeLogout` 옆에서 | 그 함수 줄과 `logout()` 줄이 붙어 있는지를 fx3의 정규식이 본다 | 그 정규식을 일부러 고친다(9.2) |

---

## 3. 보관 파일과 두 채널 (메인)

### 3.1 공용 모듈 — `src/shared/backgroundKeptEdits.ts` (새로)

import가 하나도 없는 순수 모듈이다. 메인(`electron/backgroundKeptEdits.ts`)과 mock이 같은 검사·한도·파일 이름을 쓰고, 화면은 타입만 가져간다. `tsconfig.node.json`의 `include`에 `src/shared`가 이미 있다.

```ts
export type KeptMapEdit = {
  /** The revision of the map the draft was opened on. Null: a map never saved (no path makes one today). */
  baseRevision: number | null;
  /** Finished edits not saved (mapDraftSteps): the count the band shows again after a restart. */
  steps: number;
  /** When it was written (ms since 1970). The newest is the map on show after a restart. */
  keptAt: number;
  /** The map as its draft held it once the edit settled. Opaque here: the renderer checks it as a map before it is restored. */
  value: unknown;
  /** The underlay was a data: picture and was left out (imageUrl ''): a restore takes the library's. */
  imageOmitted?: true;
};
export const KEPT_EDITS = { version: 1, maxEntryChars: 4_000_000, maxEntries: 100 } as const;
export const KEPT_EDITS_REFUSAL = {
  shape: '보관할 도면 편집의 모양이 올바르지 않아요.',
  size: '보관할 도면 편집이 너무 커요.',
  count: '이 PC에 보관할 수 있는 도면 편집은 100개까지예요.',
  version: '보관한 도면 편집 파일을 이 버전에서 읽을 수 없어요. 앱을 업데이트해 주세요.',
} as const;
/** Why an entry may not be written, or null when it may. */
export function keptEntryProblem(mapId: unknown, entry: unknown): string | null;
/** The entries of a stored document that pass the check. The others stay in the file and are never handed out. */
export function keptEntriesOf(entries: unknown): Record<string, KeptMapEdit>;
/** The file of one account in the app's folder. */
export function keptEditsFileName(userId: string): string;
```

| 함수 | 규칙 |
|---|---|
| `keptEntryProblem` | `mapId`가 UUID 문자열(domain.ts:11과 같은 식)이고, `entry`가 키 `baseRevision`·`steps`·`keptAt`·`value`·`imageOmitted` **밖의 키가 없는** 객체이고, `baseRevision`이 `null` 또는 0 이상의 안전한 정수, `steps`가 0 이상의 안전한 정수, `keptAt`이 0 이상의 유한수, `value`가 객체이고 `value.id === mapId`, `imageOmitted`는 없거나 `true` — 아니면 `shape`. 그다음 `JSON.stringify(entry).length > 4_000_000`이면 `size`. 모두 맞으면 `null` |
| `keptEntriesOf` | 객체가 아니면 `{}`. 키마다 `keptEntryProblem(key, value) === null`인 것만 |
| `keptEditsFileName` | `/^[a-z0-9_-]{1,64}$/`에 맞는 id(Supabase의 소문자 UUID, 미리보기의 `'1'`)는 그대로, 아니면(대문자가 하나라도 있으면 그것도) `=` + UTF-8 바이트의 소문자 16진수 — `background-map-kept.<그것>.json`. 대문자를 그대로 두지 않는 것은 Windows의 파일 이름이 크고 작은 글자를 가리지 않아서다. 그래서 두 id가 한 파일을 쓰지 않고(`'A'` → `=41`, `'a'` → `a`), 어느 id도 폴더 밖으로 나가지 않는다(`'../x'` → `=2e2e2f78`) |

**파일 모양**: `{"version":1,"entries":{"<도면 id>":{…KeptMapEdit},…}}` — 들여쓰기 없이 한 줄. 항목이 모두 지워져도 파일은 `{"version":1,"entries":{}}`로 남는다.

### 3.2 저장소 — `electron/backgroundKeptEdits.ts` (새로)의 `createKeptEditsStore(folder, files, now)`

`electron`을 import하지 않는다(폴더를 받는다). import는 `node:fs/promises`·`node:path`·`'../src/shared/backgroundKeptEdits'`(확장자 없이 — 메인 빌드의 규칙. 테스트는 esbuild로 묶어 부른다). 파일 함수 넷과 시계도 받는다 — 테스트가 잠긴 파일의 오류(`EBUSY` 등)·쓰는 차례·같은 ms의 두 번 깨짐을 넣어 보는 길이고, 메인은 넘기지 않는다.

```ts
export type KeptEditsFiles = Pick<typeof import('node:fs/promises'), 'readFile' | 'open' | 'rename' | 'mkdir'>;
export type KeptEditsStore = {
  list(userId: string): Promise<Record<string, KeptMapEdit>>;
  put(userId: string, mapId: unknown, entry: unknown): Promise<void>;   // entry null: remove
  flush(maxMs?: number): Promise<void>;                                  // default 2000
};
export function createKeptEditsStore(folder: string, files: KeptEditsFiles = fs, now: () => number = Date.now): KeptEditsStore;
/** The last step of quitting for this file (3.4): after the windows answered or gave up, what main still writes is waited for. Never throws. */
export async function finishKeptEditsBeforeExit(deps: { rendererFlush: Promise<unknown>; store: Pick<KeptEditsStore, 'flush'>; maxMs?: number }): Promise<void> {
  await deps.rendererFlush.catch(() => undefined);
  await deps.store.flush(deps.maxMs);
}
/** A file antivirus software holds for a moment is waited out: three tries, 80 ms apart. Any other error, or a lock that stays, is thrown. */
async function waitOutLock<T>(work: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try { return await work(); }
    catch (error) { if (tries >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException)?.code ?? '')) throw error; }
    await new Promise(done => setTimeout(done, 80));
  }
}
```

| 규칙 | 내용 |
|---|---|
| 한 줄로 | 모든 계정의 읽기·쓰기가 **프로미스 사슬 하나**에서 차례로 돈다(복구 일지의 `runExclusive`와 같은 꼴: `const result = tail.then(work, work); tail = result.catch(() => undefined);`). 앞의 일이 실패해도 다음 일은 돈다 |
| 잠김 | 파일을 읽기(`readFile`)·임시 파일 쓰기(열기~닫기 한 덩이)·이름 바꾸기(`rename` — 쓴 임시 파일의 것과 깨진 파일을 옮기는 것 둘 다)는 저마다 `waitOutLock`으로 한다 — 백신이 막 쓴 파일을 잠깐 쥐는 일(main.ts:2647-2649)이고, 이 차례는 편집하는 동안 0.3초마다 쓴다. 세 번 다 잠겨 있으면 그 오류를 던진다(**빈 것으로 읽지 않는다**) |
| 읽기 | `files.readFile` → `ENOENT`이면 빈 문서 · **그 밖의 읽기 오류는 그대로 던진다**(`EISDIR` 등, 잠김은 세 번 해 본 뒤 — 파일을 건드리지 않는다) · `JSON.parse`가 실패하면 그 파일을 `` `${file}.broken-${now()}-${++broken}` ``(`broken`은 이 저장소가 옮긴 수)로 **옮기고** 빈 문서(덮어쓰지 않는다 — 손으로 살릴 수 있게. Windows의 이름 바꾸기는 있던 파일을 말없이 바꿔 치므로, 같은 ms에 두 번 깨져도 첫 것을 잃지 않게 번호까지 붙인다). **이 옮기기도 `waitOutLock`으로 한다** — 세 번 다 잠겨 있거나 다른 오류면 그 오류를 던져 그 `list`·`put`이 거절되고 아무것도 쓰지 않는다(깨진 파일은 제 이름 그대로 남는다. 빈 문서로 읽으면 다음 쓰기가 그것을 덮으므로 그렇게 읽지 않는다) · `version !== 1`이거나 `entries`가 객체가 아니면 `KEPT_EDITS_REFUSAL.version`을 던진다(파일은 그대로) |
| `list` | 읽은 문서의 `keptEntriesOf(entries)` |
| `put` | `entry`가 `null`이면 `mapId`가 문자열인지만 보고, 아니면 `keptEntryProblem`이 `null`이어야 한다(아니면 그 문장을 던진다) → 읽기 → 지우기: 없으면 **아무것도 쓰지 않는다** / 넣기: 새 키인데 이미 100개면 `count`를 던진다(있던 키를 바꾸는 것은 100개여도 된다) → 쓰기: `files.mkdir(folder, { recursive: true })` 다음 아래 세 줄. **읽은 문서의 다른 키는 그대로 쓴다**(검사를 지나지 못하는 항목도 — 지우는 것은 그 도면의 `put(…, null)`뿐이다) |
| `flush(maxMs = 2000)` | 사슬의 꼬리 또는 `maxMs` 가운데 먼저 오는 것. 던지지 않는다 |

```ts
    const temp = `${file}.tmp`, text = JSON.stringify(document);
    await waitOutLock(async () => { const handle = await files.open(temp, 'w'); try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); } });
    await waitOutLock(() => files.rename(temp, file));
```

**디스크까지 내린 뒤에 이름을 바꾼다**(`handle.sync()`가 `rename` 앞): 전원이 갑자기 나가면 Windows는 이름 바꾸기를 기록해 두고도 새 파일의 내용은 아직 캐시에 둘 수 있다 — 내리지 않으면 0으로 찬 파일이 남고, 읽기가 그것을 `.broken-`으로 옮겨 **모든 도면의 보관본**을 잃는다(복구 일지는 내리지 않는다, 2.6). 내린 뒤에는 그 이름에 늘 온전한 파일이 있다: 새 것이거나, Windows가 이름 바꾸기를 아직 굳히지 않았으면 앞의 것(그것도 같은 길로 내렸다). 이름 바꾸기 자체를 곧바로 굳히는 길은 Node에 없어서, 전원이 나가면 마지막 몇 초가 빠질 수 있다(K2). `sync`가 실패하면 이름을 바꾸지 않고 그 `put`이 거절된다.

### 3.3 두 채널 — 같은 파일의 `registerKeptEditsIpc(deps)`

`deps = { ipc: { handle(channel, handler) }, getSessionOriginOrThrow(): { userId; epoch }, store: KeptEditsStore }` — `backgroundIpc.ts`와 같은 주입이다. `originFor(requestEpoch)`는 backgroundIpc.ts:15-19와 같은 글자다.

```ts
  deps.ipc.handle('background-kept:list', async (_event, requestEpoch) => {
    const origin = originFor(requestEpoch);
    const entries = await deps.store.list(origin.userId);
    const now = deps.getSessionOriginOrThrow();
    if (now.userId !== origin.userId || now.epoch !== origin.epoch) throw new Error('로그인 세션이 변경되어 보관 목록 응답을 폐기했습니다.');
    return entries;
  });
  // The store is called before any wait: puts and removes of one map keep the order they were sent in.
  deps.ipc.handle('background-kept:put', async (_event, mapId, entry, requestEpoch) => { const origin = originFor(requestEpoch); await deps.store.put(origin.userId, mapId, entry); });
```

- **계정은 메인의 세션이다.** 화면은 계정을 보내지 않는다. 다른 세션의 epoch를 실은 호출은 거절한다(로그아웃 뒤에 도착한 쓰기는 들어가지 않는다).
- `put`은 쓰기가 끝난 뒤 세션을 다시 보지 않는다: 쓴 곳은 부른 순간의 계정 파일이다(맞는 파일이다). `list`는 읽는 사이 세션이 바뀌면 그 답을 버린다 — 버리는 것은 그 답이지 파일의 보관본이 아니고, 문장도 backgroundIpc.ts:22의 `…배경 응답을 폐기했습니다.`와 같은 꼴이다.
- 서버·Supabase에 아무것도 보내지 않는다. 권한(`canManage`)도 묻지 않는다 — 자기 계정의 이 PC 파일이다.

### 3.4 `electron/main.ts` — 세 곳

1. import: `import { registerBackgroundIpc } from './backgroundIpc';`(main.ts:27) 바로 다음 줄 `import { createKeptEditsStore, finishKeptEditsBeforeExit, registerKeptEditsIpc } from './backgroundKeptEdits';`
2. `registerBackgroundIpc({ … });`(main.ts:2557-2565) 바로 다음:
   ```ts
   // The unsaved map edits this PC keeps, one file per account in the app's folder. Nothing of it goes to Supabase.
   const backgroundKeptEdits = createKeptEditsStore(getDataPath());
   registerKeptEditsIpc({ ipc: ipcMain, getSessionOriginOrThrow, store: backgroundKeptEdits });
   ```
3. `before-quit`의 비동기 사슬에서 대기 작업의 `if`/`else`(main.ts:5607-5630)가 끝난 뒤, `// ★ 자동 업데이트 적용 (마지막 step)`(main.ts:5632) 앞:
   ```ts
      // 배경 도면의 보관 파일: 창이 마저 보낸 쓰기까지 끝난 뒤에 끈다(최대 2초).
      await finishKeptEditsBeforeExit({ rendererFlush, store: backgroundKeptEdits });
   ```
   창의 정리 답(`rendererFlush`)은 창의 쓰기가 끝난 뒤에 오므로, 이 자리에서 기다리는 것은 그 뒤에도 메인이 쓰고 있는 것이다(창이 3초 안에 답하지 못했을 때 등). `try` 안이고, 던지지 않는다. 그 차례(창의 답 → 사슬의 꼬리 → `app.exit`)는 3.2의 `finishKeptEditsBeforeExit` 하나에 들어 있어 node 테스트가 가짜 `ipc`·임시 폴더로 몬다(KE-5). main.ts에 남는 것은 그 한 줄의 자리뿐이다(앵커 83).

### 3.5 preload · 타입

- `electron/preload.ts`, `backgroundReadClipboardFile`(preload.ts:499) 바로 다음 두 줄:
  ```ts
  backgroundKeptList: () => ipcRenderer.invoke('background-kept:list', canonicalSessionEpoch),
  backgroundKeptPut: (mapId: string, entry: unknown) => ipcRenderer.invoke('background-kept:put', mapId, entry, canonicalSessionEpoch),
  ```
- `src/types/index.ts`, `backgroundReadClipboardFile`(src/types/index.ts:1064) 바로 다음 — **둘 다 필수 멤버**(mock이 빠뜨리면 타입 검사가 멈춘다):
  ```ts
  /** The unsaved map edits this PC keeps for the signed-in account (v1.140.0): the main session names the account. */
  backgroundKeptList: () => Promise<Record<string, import('../shared/backgroundKeptEdits').KeptMapEdit>>;
  backgroundKeptPut: (mapId: string, entry: import('../shared/backgroundKeptEdits').KeptMapEdit | null) => Promise<void>;
  ```

### 3.6 미리보기 mock — `src/mocks/devElectronAPI.ts`

- import(맨 위, previewGateway의 import 다음): `import { KEPT_EDITS, KEPT_EDITS_REFUSAL, keptEntriesOf, keptEntryProblem } from '../shared/backgroundKeptEdits';`와 `import type { KeptMapEdit } from '../shared/backgroundKeptEdits';`
- 모듈 함수 둘(`type MockCalendarRow` 앞): 키 `const PREVIEW_KEPT_KEY = 'bflow:preview:background-map-kept:';` + `encodeURIComponent(userId)`. 값은 메인의 파일과 같은 `{ version: 1, entries }`. `readPreviewKept(userId)`: 없으면 `{}`, `version`이 1이 아니면 `KEPT_EDITS_REFUSAL.version`을 던진다. `writePreviewKept(userId, mapId, entry)`: 메인의 `put`과 같은 순서(검사 → 지우기는 없으면 그대로 / 101번째는 `count`) → `window.localStorage.setItem(…)` — **`setItem`이 던지면(한도 등) 그대로 거절된다**. 검사 창은 그 키의 `setItem`만 던지게 해서 보관 실패를 본다(10.3의 `refuseKept`).
- 멤버 둘(`backgroundPickImages` 앞):
  ```ts
  backgroundKeptList: async () => { const { actor, assertCurrent } = requireBackgroundPreviewSession(); const entries = keptEntriesOf(readPreviewKept(actor.id)); assertCurrent(); return entries; },
  backgroundKeptPut: async (mapId, entry) => { const { actor, assertCurrent } = requireBackgroundPreviewSession(); assertCurrent(); writePreviewKept(actor.id, mapId, entry); },
  ```
- `onBeforeQuitFlush: noop`(devElectronAPI.ts:2704)은 그대로다. 검사 창에서 '종료'는 그 함수를 감싸 부른다(10.3).

---

## 4. 문서를 화면 밖으로 — 세션

### 4.1 신호 — `mapKeptSignal.ts` (새로, 늘 실린다)

import는 `zustand`와 `import type { KeptMapEdit } from '../../shared/backgroundKeptEdits.ts';`뿐이다.

```ts
export type KeptSignal = {
  userId: string | null;
  /**
   * 'loading' while the list of this login is read. 'unavailable': the read failed, or gave no answer within KEPT_LIST_TIMEOUT_MS.
   * Until it is 'ready' nothing is restored, written or removed: an entry this login has not read is never written over.
   */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** The entries as listed at login: what a restore reads. */
  listed: Readonly<Record<string, KeptMapEdit>>;
  /** Ids of the maps the file holds now, as far as this PC knows: listed, plus each put sent, minus each remove sent. */
  kept: readonly string[];
  /** Ids of the maps whose draft has unsaved edits in this run. */
  changed: readonly string[];
  /** Ids of the maps whose last put was refused, or held back while the list could not be read. */
  failed: readonly string[];
};
export const useKeptMapEdits = create<KeptSignal>(() => IDLE);   // IDLE: null · 'idle' · {} · [] · [] · []
export const KEPT_DOT_TEXT = '저장 안 한 도면 편집이 있어요';
export const KEPT_LIST_TIMEOUT_MS = 5000;
export function keptMapEditCount(signal: KeptSignal): number { return new Set([...signal.kept, ...signal.changed]).size; }
/** The maps the update notice says are kept: those the file holds as far as this PC knows, less those whose last write was refused. */
export function keptMapEditsStored(signal: KeptSignal): number { return signal.kept.filter(id => !signal.failed.includes(id)).length; }
export function primeKeptMapEdits(userId: string): void;
export function releaseKeptMapEdits(userId: string): void;
export function setKeptMapFlush(flush: (() => Promise<void>) | null): void;
export async function flushKeptMapEditsBeforeLogout(maxWaitMs = 3000): Promise<void>;
```

- `primeKeptMapEdits(userId)`: 빈 id거나, 신호가 그 계정이고 `loading`·`ready`면 아무것도 하지 않는다(`idle`·다른 계정·`unavailable`이면 읽는다). 부름 번호를 하나 올리고(`const call = ++calls`), 다른 계정이었으면 `{ ...IDLE, userId, status: 'loading' }`, 같은 계정을 다시 읽는 것이면 `{ status: 'loading' }`만(세션이 쥔 `kept`·`changed`·`failed`는 그대로). `window.electronAPI?.backgroundKeptList`가 없으면 곧바로 `unavailable`. 있으면 부르고 `KEPT_LIST_TIMEOUT_MS` 타이머를 건다. 답은 **부름 번호가 그대로이고 신호가 그 계정일 때만** 받고(받으면 그 타이머를 푼다): 목록이면 `{ status: 'ready', listed: entries, kept: Object.keys(entries) }`(5초를 넘겨 온 답도 — 그사이에는 아무것도 쓰지 않았다), 실패면 `console.warn('[background] kept map edits not read:', …)` 한 줄과 `{ status: 'unavailable' }`. 타이머도 같은 셈이다: **부름 번호가 그대로이고 신호가 그 계정이고 아직 `loading`일 때만** `unavailable`로 바꾼다 — '편집 시작'이 끝없이 기다리지 않게. 늦게 온 앞 부름의 답과 그 타이머(로그아웃 뒤 5초 안에 같은 계정으로 다시 로그인 등)는 번호가 달라 아무것도 바꾸지 않는다.
- `releaseKeptMapEdits(userId)`: 부름 번호를 올리고(오는 중인 답을 버린다) 신호가 그 계정이면 `IDLE`로.
- `flushKeptMapEditsBeforeLogout(maxWaitMs)`: 세션이 걸어 둔 함수를 부르고 그것과 `maxWaitMs` 가운데 먼저 오는 것을 기다린다. 걸린 것이 없으면 곧바로. 걸린 함수가 던지거나 거절해도 던지지 않는다.
- 이 모듈은 `window`·타이머를 부를 때만 읽는다 — node 테스트가 가짜 `window.electronAPI`와 가짜 타이머로 몬다(10.1의 KS).
- **한 계정의 신호다**: 화면에서 읽는 쪽(사이드바의 점, 라이브러리 화면의 `keptCount`·`keptStored`, 편집기의 `keptStatus`·`keptFailed`)은 모두 `signal.userId === 그 계정`을 함께 본다 — 도면 id는 계정 사이에 같아서, 보지 않으면 다른 계정의 `failed`·`kept`를 읽는다. 세션은 `ready()`·`catchUp`에서 계정을 보고, 계정이 바뀌면 신호가 다음 계정으로 바뀌기 전에 그 자리에서 없어진다(4.5).

### 4.2 세션 — `mapDraftSession.ts` (새로, 순수 팩토리)

```ts
export type MapDraftSessionDeps = {
  userId: string;                                                  // '': a document that keeps nothing
  put(mapId: string, entry: KeptMapEdit | null): Promise<void>;
  signal: { read(): KeptSignal; write(patch: Partial<KeptSignal>): void };
  timers: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };
  now(): number;
};
export type MapDraftSession = {
  readonly userId: string;
  readonly store: MapDocumentStore;       // created here, once: createMapDocumentStore()
  shownMapId: string | null;              // the map picked on the screen in this run; null: none picked (the first map is on show)
  /** Each read of the library, with nothing running (6.5): own saves whose answer was lost are put back on it, and once per login what this PC kept comes back. */
  catchUp(snapshot: BackgroundSnapshot): { count: number; mapId: string | null } | null;
  /** Every draft goes, at once (4.7: the editor could not draw them). Their copies on this PC go as any discarded draft's do (5). */
  discardAll(): void;
  flush(): Promise<void>;                 // never rejects
  dispose(): void;
};
export function createMapDraftSession(deps: MapDraftSessionDeps): MapDraftSession;
```

import: `./types.ts`(타입) · `../../shared/backgroundKeptEdits.ts`(타입) · `./mapDocument.ts`(`createMapDocumentStore`·`gestureStartMap`·`mapDraftChanged`, 타입) · `./mapDraftKeep.ts`(`MAP_KEEP_DELAY_MS`·`keptEntryOf`·`mapDraftSavedAlready`·`planKeptRestore`) · `./mapKeptSignal.ts`(**타입만**). DOM·React·`window` 없음. 보관 규칙은 5절, 되살리기와 따라잡기는 6절.

### 4.3 계정의 세션 하나 — `useBackgroundMapDocument.ts`

훅 파일이 모듈 수준의 세션 하나를 쥔다(씬 저장의 `sceneSaveRetry.ts`와 같은 꼴). 이 파일은 node 테스트가 import하지 않는다(React·`@/stores/useAuthStore`).

```ts
let active: MapDraftSession | null = null;
let hooked = false;
export function mapDraftSessionOf(userId: string): MapDraftSession {
  if (active?.userId === userId) return active;
  active?.dispose();
  active = createMapDraftSession({
    userId,
    put: (mapId, entry) => window.electronAPI.backgroundKeptPut(mapId, entry),
    signal: { read: useKeptMapEdits.getState, write: patch => useKeptMapEdits.setState(patch) },
    timers: { set: (run, ms) => window.setTimeout(run, ms), clear: handle => window.clearTimeout(handle as number) },
    now: Date.now,
  });
  if (!hooked) {
    hooked = true;
    // Tray 종료 and 지금 업데이트: main waits up to three seconds for what each window has to finish. 로그아웃 waits as well, while the session is alive.
    window.electronAPI?.onBeforeQuitFlush?.(() => active?.flush());
    setKeptMapFlush(() => active?.flush() ?? Promise.resolve());
    useAuthStore.subscribe((now, before) => { if (now.currentUser?.id !== before.currentUser?.id) { active?.dispose(); active = null; } });
  }
  return active;
}
```

- 훅의 서명이 `useBackgroundMapDocument(userId: string)`로 바뀌고, 저장소 줄이 바뀐다: `const [session] = useState(() => mapDraftSessionOf(userId));` · `const store = session.store;`. 그 아래 **내릴 때의 정리 한 줄**: `useEffect(() => () => { store.dispatch({ type: 'gesture-cancel' }); store.dispatch({ type: 'end-coalescing' }); }, [store]);` — 문서가 남으므로 도는 끌기를 취소하고 이어 치던 칸을 끝낸다(편집기의 `abortGesture` 정리 :387도 그대로 돈다 — 포인터 캡처를 놓는다. 두 번 취소해도 둘째는 아무 일도 아니다). 그다음 **다시 읽기 한 줄**: `useEffect(() => { if (userId) primeKeptMapEdits(userId); }, [userId]);` — 편집기가 올라올 때마다 목록을 읽지 못한 채(`unavailable`)면 다시 읽는다(`loading`·`ready`면 아무 일도 없다). 로그인 때의 첫 읽기는 사이드바의 점이 한다(7.1). 그리는 도중(`mapDraftSessionOf`)이 아니라 effect에서 부른다 — 신호를 바꾸면 사이드바가 다시 그려진다.
- `BackgroundMapDocument` 타입에 멤버 하나: `/** The account's document and its copy on this PC: what outlives the screen. */ session: MapDraftSession;` — `actions`의 `useMemo`에 `session`을 넣고 의존 목록은 `[store, session]`.
- 앵커 50이 보는 두 줄(`rebaseDrafts: …`, `followSaved: …`)은 글자 그대로다(변수 이름 `store`도).
- 편집기: `const doc = useBackgroundMapDocument(viewerId);`(:188) · `const { state, session } = doc, drafts = state.drafts;`(:189) · `const [currentId, setCurrentId] = useState<string | null>(() => session.shownMapId);   // the map picked when this screen was last up in this run`(:190). `viewerId`는 2차부터 오는 값이다(BackgroundLibraryView.tsx:158 — `user?.id ?? ''`. 화면은 로그인한 계정에만 그려지므로 빈 값은 실제로 오지 않는다. 와도 그 세션은 아무것도 보관하지 않는다).

### 4.4 다른 메뉴 왕복 — 본문의 문, 남는 것과 남지 않는 것

**본문의 문** — `BackgroundLibraryView.tsx`의 두 줄. `useBackgroundStore()`의 줄(BackgroundLibraryView.tsx:31)이 `actorId`도 꺼낸다: `const { snapshot, loading, pending, error, updateRequired, execute, actorId } = useBackgroundStore();` · 본문을 막는 조건(BackgroundLibraryView.tsx:147)이 `{(loading || actorId !== (user?.id ?? null)) && !snapshot.maps.length && !snapshot.places.length ? (`가 된다. 저장소가 이 계정으로 초기화되기 전(앞 화면이 비운 그대로, 앱을 켠 뒤 처음)에는 '불러오고 있습니다'를 그린다 — 편집기는 언제나 이 계정으로 읽은 라이브러리에 대고 처음 올라와, 2.1의 빈 저장소 한 번이 없다(오늘 한 틀 비치던 빈 도면 화면도 없어진다). 첫 읽기가 실패해도 `initialize`가 `actorId`를 곧바로 정하므로 본문은 지금처럼 그려진다(13.3). 따라가기(:355-367)는 고치지 않는다(앵커 56). 앵커 46이 보는 안내 조각과 그 밖의 모양은 그대로다.

| 남는다 (세션) | 남지 않는다 (편집기의 상태) |
|---|---|
| 모든 초안과 그 `past`·`future`·`dropped`, 띠의 수, 편집 중(초안이 있음) — 깨끗한 초안도(저장한 뒤의 편집 중, 모두 되돌린 초안과 그 다시 실행) | 평면/3D(평면으로), 도구(선택으로), 그리던 다각형, 기호 목록 |
| 도면마다의 평면 보기 값·선택(`viewports`) | 열린 창(만들기·연결·설정·삭제·장소·선택 창과 물음) |
| 고른 도면(`session.shownMapId`) — 초안 없이 보기만 하던 도면도 | 접은 도면 줄, 속성 칸의 열림, 3D의 둘러보기 자세(`viewStates`) |
| 보관과 그 실패의 표시(신호) | 띠의 '저장했어요', 도면 위 안내, 오류 줄, 이미지 목록의 알림 줄·흐린 카드·'추가됨'·맨 앞에 둔 새 카드 |
| 속성 칸의 이름과 범위 안의 숫자: 칠 때마다 초안에 들어가 있다. **다른 곳을 누르거나 다른 창·앱으로 가면**(사이드바, 알림·`bflow://` 링크를 누를 때 — 누름이 포커스를 옮기고, 이 창이 포커스를 잃으면 칸도 `blur`를 받는다) 범위를 벗어나 아직 들어가지 않은 숫자('150'으로 가는 길의 '1')도 그 칸의 `blur`가 가장 가까운 끝값으로 넣는다(BackgroundMapNumberField.tsx:57-62, 칸을 떠날 때와 같은 한 단계) | **칸이 포커스를 쥔 채 화면이 바뀌면**(이 창에서 아무것도 누르지 않은 채 — 업데이트 필요 안내가 뜰 때처럼) 칸이 그대로 내려가고, 그때의 `blur`는 화면에 닿지 않는다(React 18.3.1은 그리는 동안 이벤트를 받지 않는다 — react-dom의 `prepareForCommit`). 그래서 범위 밖의 숫자와 평면의 이름 상자에 치던 글자는 버려진다(이름 상자는 눌러서 떠나면 그 `blur`가 넣는다, BackgroundMapNameBox.tsx:26-29·60). 칸에 커서가 있는 동안 Ctrl+숫자·검색 단축키는 화면을 바꾸지 않는다(useGlobalShortcuts.ts:136 — 지금 그대로) |

고른 도면은 세션에 적는다: `useEffect(() => { session.shownMapId = currentId; }, [session, currentId]);` — 자리는 `gallery` 메모(:1264-1265) 다음, `const treeRows` 바로 앞이다(3단계). 4단계가 6.5의 되살리기 effect를 이 줄 바로 앞에 넣어, 6.5의 글자처럼 되살리기 → 이 줄의 차례로 붙는다. 보이는 도면(`current`)이 아니라 **고른 것**(`currentId`, 아직 고르지 않았으면 `null`)이다 — 보이는 첫 도면을 적으면, 되살리기가 늦어진 채(목록이 늦음·창 밑에서 기다림) 떠났다 돌아왔을 때 `currentId === null`이 다시 오지 않아 가장 나중 도면이 보이지 않는다(6.4). 고른 도면이 그 사이 지워졌으면 지금처럼 목록의 첫 도면이다(`maps.find(…) ?? maps[0]`, :271). 다시 열면 따라가기(:367)가 깨끗한 초안을 새 라이브러리로 옮기고, 3차의 '없는 시점 빼기' effect(:1256-1263)가 모든 초안을 다듬는다 — 둘 다 지금 그대로다. 저장이 도는 중에 떠났던 도면은 돌아올 때 되살리기의 effect가 다시 놓는다(8.1).

### 4.5 계정이 바뀔 때 · 로그아웃

- 계정 id가 바뀌거나 없어지면(로그아웃·다른 계정) 4.3의 구독이 **그 자리에서** 앞 세션을 `dispose()`한다: 걸린 타이머를 모두 풀어 보내지 않은 쓰기를 버리고, 그 뒤 도착하는 답은 신호를 건드리지 않는다. 그 계정의 보관 파일은 그대로다 — 같은 계정으로 다시 로그인하면 새 세션이 되살린다(로그인마다 한 번).
- 사이드바의 점이 로그인과 함께 생기고 내려간다(7.1). 점이 내려갈 때 **로그인한 계정이 그 계정이 아니게 됐으면**(로그아웃·다른 계정) `releaseKeptMapEdits(userId)`가 신호를 비운다 — 다음 계정이 앞 계정의 목록을 보지 않는다. 같은 로그인에서 점이 다시 그려질 때는 비우지 않는다: 세션이 쥔 `kept`·`changed`·`failed`와 상태가 그대로 남는다(비우면 '편집 시작'이 흐려지고 쓰기가 멈춘다).
- **사용자가 누른 로그아웃**(UserMenu.tsx:24-31): `await flushSceneSavesBeforeLogout();` 다음 줄에 주석 한 줄과 `await flushKeptMapEditsBeforeLogout();`, 그다음 `await logout();`. 세션이 살아 있을 때 0.3초 안쪽의 쓰기를 마저 보낸다(최대 3초 — 둘을 합쳐 최악 6초, 보통 몇 ms).
- 강제 로그아웃·창 새로 고침·크래시·작업 관리자, 그리고 앱을 트레이에 둔 채 Windows를 끄거나 다시 시작하거나 로그오프할 때(2.5)는 정리 통로가 없다: 마지막 0.3초 안쪽의 편집이 빠질 수 있다(K2 — 그 앞의 쓰기는 이미 메인이 파일에 썼다). PC 전원이 갑자기 나가면 마지막 몇 초가 빠질 수 있다(Windows가 이름 바꾸기를 아직 굳히지 않았을 수 있다). 어느 때든 파일은 반쯤 쓰이거나 0으로 찬 채 남지 않는다(디스크까지 내린 임시 파일 + 이름 바꾸기, 3.2).

### 4.6 도는 중인 그림 넣기 — 지금 규칙 그대로

화면을 떠나면 3차의 넣기는 거기서 그친다(2.1): 올리는 중이면 저장하지 않고, 저장하는 중이면 그때까지 저장된 배경만 남고 이어 주지 않는다. **바뀌는 것은 하나다**: 떠나기 전에 이미 초안에 넣은 이어 주기는 이제 초안과 함께 남고 보관된다(3차 설계 13.2가 "이 PC에 보관이 이 틈을 닫는다"고 알린 것). 그림 넣기 코드(`useMapImageAdd.ts`·`mapImageDrop.ts`·`linkAddedImages`)는 한 글자도 고치지 않는다. 그림 넣기 밖의 저장(도면 저장·연결·설정·내부 도면 만들기·새 도면으로 저장·도면 삭제)이 도는 중에 떠나는 것은 8.1과 13.2다.

### 4.7 편집기가 그리다 깨지면 — 도면 탐색 탭의 작은 오류 경계 (`BackgroundLibraryView.tsx`)

v1.139.0에서는 편집기가 그리다 깨지면 앱의 오류 경계(src/App.tsx:140-149 — 아무것도 그리지 않고, 화면이 바뀔 때만 새로 선다, src/App.tsx:3301)가 배경 화면을 통째로 비우고, 다른 메뉴 왕복이 새 문서로 풀었다(초안은 사라졌다). 이제 문서는 화면보다 오래 살고 0.3초 안에 이 PC에 적히므로, 초안이 원인이면 같은 실행에서 몇 번을 돌아와도, 껐다 켜도(되살리기) 같은 초안이 다시 그려져 다시 깨진다. 그래서 라이브러리 화면이 편집기만 감싼다:

```tsx
/** The map editor alone. Drawn again it would fail again on the same drafts: they outlive the screen and come back after a restart. */
class MapEditorGuard extends Component<{ children: ReactNode; onDiscard(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('[background] map editor failed:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="bg-empty" role="alert"><p>{MAP_KEEP_TEXT.broken}</p><button type="button" className="bg-button bg-primary" onClick={() => { this.props.onDiscard(); this.setState({ failed: false }); }}>{MAP_KEEP_TEXT.brokenDiscard}</button></div>;
  }
}
```

- 자리: 같은 파일, `const tabs`(BackgroundLibraryView.tsx:21-26) 다음, 화면 함수 앞. import: `react`의 `Component`·`type ReactNode`, `./useBackgroundMapDocument`의 `mapDraftSessionOf`, 그리고 7.2가 적은 `import { MAP_KEEP_TEXT } from "./mapDraftKeep";` — 경계와 함께 **3단계에** 넣는다(`mapDraftKeep.ts`와 그 글자는 2단계에 생긴다. 7.2의 나머지 import는 4단계).
- 그리는 줄: `<BackgroundMapEditor … />`(BackgroundLibraryView.tsx:154-161)를 `<MapEditorGuard onDiscard={() => { if (user) mapDraftSessionOf(user.id).discardAll(); }}>`와 `</MapEditorGuard>`로 감싼다(도면 탐색 탭의 `div` 안). 다른 탭과 머리글은 그대로 쓸 수 있다.
- 세션의 `discardAll()`: `store.dispatch({ type: 'drop-drafts', mapIds: Object.keys(store.getState().drafts) })` 한 줄. 보관은 5절 그대로다 — 이 세션이 쓰거나 되살린 보관본은 P2·P6이 지우고, 되살리기는 로그인마다 한 번이라 이미 했으면 다시 하지 않는다. 보기 값·선택(`viewports`)은 남는다.
- 글자(`mapDraftKeep.ts`의 `MAP_KEEP_TEXT`): `broken` = `도면 화면을 그리지 못했어요. 저장하지 않은 도면 편집 때문일 수 있어요.` · `brokenDiscard` = `저장하지 않은 편집을 버리고 다시 열기`. 묻지 않는다: 그대로 두면 도면 탐색을 쓸 수 없고, 버리지 않고 다시 그려 보는 길은 다른 메뉴에 다녀오는 것이다(그때 경계가 새로 선다). 움직임 없음.
- 깨지는 것이 초안 때문이 아니면 버린 뒤에도 다시 이 글자다 — 그때는 지금처럼 편집기의 결함이다(보기 값이 원인이면 앱을 다시 켜야 풀린다, 13.3).

---

## 5. 보관 — 언제 쓰고 언제 지우나

세션은 살아 있는 동안 문서를 구독한다. 편집기가 떠 있든 아니든 같다.

| # | 규칙 | 코드의 줄(앵커 80이 본다) |
|---|---|---|
| P1 | **놓인 상태에서만 본다**: 알림이 왔을 때 제스처가 돌면 아무것도 하지 않는다(끌기의 미리보기는 쓰지 않는다. 놓으면 다음 알림이 본다) | `if (disposed \|\| !keeps \|\| state.gesture !== null) return;` |
| P2 | 초안마다 지난번에 본 객체와 견준다. 바뀐 초안 → 그 도면에 걸린 타이머가 **없을 때만** 0.3초로 건다(이미 걸려 있으면 그대로 — 쉬지 않고 이어 고쳐도 0.3초마다 한 번은 쓴다. 다시 걸면 이어 고치는 동안 아무것도 쓰지 않아 K2의 약속이 깨진다). 깨끗해진 초안 → 지우기. 없어진 초안 → 지우기. 그다음 본 것을 지금의 `drafts`로 | `if (mapDraftChanged(draft)) arm(mapId); else drop(mapId);` · `for (const mapId of Object.keys(seen)) if (!(mapId in drafts)) drop(mapId);` · `function arm(mapId: string) { if (!timers.has(mapId)) timers.set(mapId, deps.timers.set(() => fire(mapId), MAP_KEEP_DELAY_MS)); }` — `fire`의 첫 줄은 `timers.delete(mapId);` |
| P3 | 신호의 `changed`를 **같은 틱에** 바꾼다(바뀐 목록이 달라졌을 때만) — 점이 편집과 함께 켜지고 꺼진다 | — |
| P4 | 타이머가 울리면(`fire`): 목록이 `ready`가 아니면 쓰지 않고 0.3초 뒤로 다시 건다 — `unavailable`이면 그 도면을 `failed`에 넣는다(띠가 '이 PC에 보관하지 못했어요'. 읽지 않은 보관본을 덮어쓰지 않는다) / 초안이 깨끗하거나 없으면 아무것도 / 아니면 **놓인 값**으로 쓴다 — 그 도면에서 끌기가 돌고 있으면 끌기를 시작한 값 | `if (!ready()) { if (deps.signal.read().status === 'unavailable') fail(mapId); arm(mapId); return; }` · `send(mapId, keptEntryOf(draft, gestureStartMap(state, mapId) ?? draft.value, deps.now()));` — `ready()`는 신호가 이 계정이고 `ready`인지 |
| P5 | 쓰기를 **보내는 순간** 그 도면을 `owned`에 넣는다(답을 기다리지 않는다 — 쓰기가 오가는 사이 초안이 깨끗해지면 그 지우기가 쓰기 뒤에 곧바로 나가야 한다. 답을 받은 뒤에 넣으면 지우기가 나가지 않아, 되돌린 편집이 파일에 남아 점이 켜진 채이고 다시 켜면 되살아난다). **지우기는 `owned`에 든 것만 보낸다** — 읽지 못한 것·되살리지 않은 것·이번 실행에 쓰지 않은 것은 지우지 않는다 | `if (!owned.delete(mapId)) return;` |
| P6 | `drop`(깨끗해짐·없어짐)은 그 도면의 타이머와 `failed` 표시를 **먼저** 비우고, 그다음 `owned`를 본다 — 보내지 못한 도면(목록을 읽지 못한 동안 고친 것)의 타이머가 남으면 P4가 0.3초마다 다시 걸며 `failed`를 다시 채워, 목록이 읽힌 뒤의 첫 편집이 '보관하지 못했어요'로 시작한다. 지우기는 곧바로 보낸다 | `function drop(mapId: string) { unarm(mapId); unfail(mapId); if (!owned.delete(mapId)) return; send(mapId, null); }` |
| P7 | 신호의 `kept`: 쓰기를 보낼 때 더하고 지우기를 보낼 때 뺀다(답을 기다리지 않는다) | — |
| P8 | 쓰기가 거절되면 콘솔 한 줄, 그리고 **그 답이 온 때 그 도면에 아직 바뀐 초안이 있을 때만** `failed`에 그 도면. 답이 오기 전에 그 초안이 저장되거나 버려졌으면(P6이 이미 뺐다) 넣지 않는다 — 넣으면 그 도면의 다음 편집이 받아들여지는 쓰기 전까지 '보관하지 못했어요'로 시작한다. 그 도면의 쓰기가 받아들여지거나, 그 초안이 깨끗해지거나 없어지면(P6) 뺀다(저장하거나 버린 도면의 다음 편집이 '보관하지 못했어요'로 시작하지 않게). 지우기가 거절되면 그 도면을 세션의 `unremoved`에 두고(화면에는 아무 표시도 없다), 세션이 다음에 무엇이든 보낼 때와 `flush`에서 다시 보낸다 — **그때 그 도면에 바뀐 초안이 없을 때만**(바뀐 초안이 있으면 그 쓰기가 자리를 갖고, 깨끗해지면 P6이 지운다). 지우기가 받아들여지면 뺀다 | — |
| P9 | `flush()`: 목록이 `ready`일 때만 — 걸린 타이머를 모두 풀어 지금 쓰고 → `failed`에 든 도면 가운데 아직 바뀐 것을 다시 쓰고 → `unremoved`에 든 도면 가운데 바뀐 초안이 없는 것을 다시 지우고 → **이 세션이 보낸 쓰기·지우기 가운데 아직 답이 없는 것을 모두** 기다린다(`Promise.allSettled`) — 이 `flush`가 보낸 것뿐 아니라 그 전에 보내 아직 오가는 것(종료·로그아웃 몇 ms 전에 울린 타이머의 쓰기 등)까지. `ready`가 아니면 곧바로 끝난다(그때는 보낸 것이 없다) | — |
| P10 | `dispose()`: 타이머를 모두 풀고 그 뒤로 아무것도 보내지 않는다 | — |

**값의 모양** — `mapDraftKeep.ts`의 `keptEntryOf(draft, value, keptAt)`:

```ts
export function keptEntryOf(draft: MapDraft, value: BackgroundMap, keptAt: number): KeptMapEdit {
  const inline = value.imageUrl.startsWith('data:');
  return { baseRevision: draft.baseRevision, steps: mapDraftSteps(draft), keptAt, value: inline ? { ...value, imageUrl: '' } : value, ...(inline ? { imageOmitted: true as const } : {}) };
}
```

`past`·`future`·선택·보기 값은 들어가지 않는다. `export const MAP_KEEP_DELAY_MS = 300;`

**다른 동작과 만나는 곳** — 세션은 문서만 본다. 그래서 아래는 따로 코드가 없다.

| 동작 | 보관에 일어나는 일 |
|---|---|
| '도면 저장'·Ctrl+S·연결·설정·내부 도면 만들기(`persistMaps`) | 저장한 도면의 초안이 다시 놓여 깨끗해진다 → 지우기. 함께 저장된 다른 도면도 같다. 저장 중(`pending`)에는 초안이 바뀌지 않는다 |
| 저장이 거절됨 | 초안이 그대로다 → 보관본도 그대로 |
| 따라가기(깨끗한 초안만) | 깨끗한 초안은 쓴 적이 없다(바뀌는 순간 쓰고, 깨끗해지는 순간 지웠다) → 아무 일 없음 |
| 되돌리기로 깨끗해짐 | 지우기. 다시 실행으로 바뀌면 0.3초 안에 쓰기 |
| 편집 끝내기 → 버리고 끝내기 | 초안이 없어진다 → 지우기 |
| 도면 삭제 창(1차) | 지운 도면의 초안은 `doc.discard`로 없어진다 → 지우기(하위 도면도 함께 지웠으면 그 초안들도). 저장 단계가 함께 저장한 도면(남기는 하위 도면 등)은 깨끗해진다 → 지우기(그 편집은 저장됐다). 그 밖의 초안은 그대로 남는다 |
| 그림 넣기(3차) | 이어 주기가 초안에 들어가면 바뀐 초안 → 0.3초 안에 쓰기. 바로 저장(보기 모드)이면 초안이 없다 → 아무 일 없음. 저장 실행이 잠근 동안에도 같은 규칙 |
| 3차의 '없는 시점 빼기'(`history: false`) | 바뀐 초안의 값이 바뀐다 → 쓰기 |
| 선택 창: 최신 내용 받기 / 버리기 / 새 도면으로 저장 | 다시 놓임 → 지우기 / 없어짐 → 지우기 / 원래 도면의 초안이 없어짐 → 지우기(새 도면의 깨끗한 초안은 쓰지 않는다) |
| 다른 메뉴로 감 | 내릴 때의 취소로 끌기의 값이 시작 값으로 돌아간다 → 그 값으로 쓰기. 다른 곳을 누르거나 다른 창으로 가서 떠나면 속성 칸에 치던 값이 칸의 `blur`로 들어간다(4.4) → 쓰기. 걸려 있던 타이머는 화면 밖에서도 울린다. 저장이 도는 중이었으면 그 답이 버려져 초안이 바뀐 채 남는다 → 보관본도 점도 남고, 돌아올 때 다시 놓여(8.1) 지우기 |

---

## 6. 되살리기

### 6.1 언제

편집기가 그릴 때마다 아래 조건을 보고 세션의 `catchUp(snapshot)`을 부른다(6.5). 되살리기는 그 안에서 **로그인마다 한 번만** 한다(세션의 `restored`):

- 이 계정의 보관 목록이 끝났다(`keptSettled` — `ready` 또는 `unavailable`). 되살리기는 `ready`에서만 한다. `unavailable`이면 아무것도 하지 않고 **끝난 것으로 치지 않는다**: 편집기가 다시 올라올 때 목록을 다시 읽고(4.3), 읽히면 그때 되살린다(`keptStatus`가 effect의 의존 목록에 있어 `ready`가 되는 렌더에 돈다)
- `snapshot.canManage` — 라이브러리를 **편집 권한으로 읽었다**는 증거다(빈 스냅샷·실패한 첫 읽기·내린 화면은 모두 `canManage: false`, domain.ts:46·useBackgroundStore.ts:25). 그래서 '읽었음' 깃발을 따로 만들지 않는다
- 저장 중·편집기의 일(`disabled` — 그림 넣기의 저장 실행도 편집기를 잠가 여기에 든다, useMapImageAdd.ts:91)이 없고, 끌기(`gestureActive`)·편집기의 창(`dialogOpen`)이 없다. **그림을 올리는 동안(잠그기 전, useMapImageAdd.ts:69-85)은 기다리지 않는다**: 올리기는 초안을 건드리지 않고 이어 주기는 그때의 초안을 읽는다(`linkAddedImages`, :730-734). 기다리면 그 사이 켜져 있는 '편집 시작'으로 연 새 초안이 보관본을 덮어쓴다(6.2의 'drafted' — 그 편집은 말없이 사라진다)

`canManage`가 거짓이거나 목록을 읽지 못했으면 되살리지도 지우지도 않는다 — 보관본은 기다린다(읽지 못한 동안은 쓰지도 않는다, P4). **목록을 읽기 전에는 '편집 시작'과 '＋ 공간 그리기'가 흐리다**: '편집 시작'(:1321)의 `disabled={disabled || editing}`이 `disabled={disabled || editing || !keptSettled}`(앵커 58이 그 태그를 글자로 본다 — 일부러 고친다, 9.2), '＋ 공간 그리기'(:1516)의 `disabled={disabled}`가 `disabled={disabled || !keptSettled}`(누르면 '편집 시작'을 거쳐 평면의 사각형 도구를 든다)가 되고, `beginEditing`의 첫 줄도 `if (!current || !snapshot.canManage || disabled || !keptSettled) return;`(:608)이다. 로그인 직후 사이드바의 점이 목록을 읽으므로 실제로는 한순간이고, 답이 없어도 5초 뒤에는 `unavailable`이라 켜진다(4.1). 그렇게 하지 않으면 보관본이 있는 도면을 목록보다 먼저 열어 고친 새 초안이 그 보관본을 덮어쓴다(6.2의 'drafted').

`keptStatus`·`keptSettled`는 편집기의 새 두 줄이다(9.3): `const keptStatus = useKeptMapEdits(signal => signal.userId === viewerId ? signal.status : 'idle');` · `const keptSettled = keptStatus === 'ready' || keptStatus === 'unavailable';`

### 6.2 보관본마다 — `planKeptRestore` (`mapDraftKeep.ts`)

```ts
export type MapKeptRestorePlan = {
  restore: MapRestoredDraft[];                                    // for restore-drafts
  equal: string[];                                                // removed without a word
  skipped: { mapId: string; reason: 'drafted' | 'invalid' }[];    // left in the file, not shown
  newest: string | null;                                          // the restored map kept last
};
export function planKeptRestore(listed: Readonly<Record<string, KeptMapEdit>>, snapshot: BackgroundSnapshot, drafts: Readonly<Record<string, MapDraft>>): MapKeptRestorePlan;
```

목록의 차례대로, 보관본마다 처음 맞는 줄:

| # | 경우 | 결과 |
|---|---|---|
| 1 | 그 도면에 **바뀐** 초안이 이미 있다 | `skipped: 'drafted'` — 그 초안이 이긴다(세션이 곧 그것으로 덮어쓴다). 6.1의 가드로, 목록을 읽지 못한 동안 고친 도면에서만 생긴다(13.3) |
| 2 | (`imageOmitted`면 먼저 `imageUrl`을 라이브러리의 그 도면 것으로, 없으면 `''`로 채운다) 값이 **초안이 쥘 수 있는 도면**이 아니다, 또는 `value.id`가 다르다. 검사는 문자열인 이름(도면의 `name`, 노드마다의 `name`)을 `'이름'`으로 바꾼 사본에 `validateBackgroundEntity('map', …)`를 부르는 것이다 — 이름은 문자열이기만 하면 된다. 속성 칸의 이름 칸은 칠 때마다 초안에 들어가(:1437, `maxLength` 없음) 빈 이름·160자를 넘는 이름도 초안에 있다(mapDelete.ts:30). 되살리는 것은 원래 값이고, 그 도면을 저장하면 지금처럼 이름 문장으로 거절된다 | `skipped: 'invalid'` — 다른 버전이 쓴 것(모르는 키·값)이나 깨진 것. 파일에 그대로. 콘솔에 `[background] kept map edit not restored:`와 도면 id·까닭 한 줄(내용은 적지 않는다) |
| 3 | 라이브러리에 그 도면이 있고 내용이 같다(버전만 다르다) — `mapSaveWasApplied(snapshot, { type: 'save-maps', maps: [{ entity: value, expectedRevision: saved.revision - 1 }] })`(mapWorkflow.ts:7-14, 견주는 코드를 새로 쓰지 않는다) | `equal` — 그 보관본을 지운다 |
| 4 | 그 밖(라이브러리에 같은 버전·다른 버전으로 있다, 없다) | `restore`에 `{ value, baseRevision, steps }`. 다른 버전이면 되살린 뒤 띠가 '다른 곳에서 먼저 저장됐어요', 없으면 '다른 곳에서 지워졌어요'다(8절) |

`newest` = 되살린 것 가운데 `keptAt`이 가장 큰 도면.

### 6.3 리듀서의 새 액션 — `restore-drafts` (`mapDocument.ts`)

```ts
/** A kept draft brought back after a restart (restore-drafts): its value, its revision and the count it had (mapDraftSteps). */
export type MapRestoredDraft = { value: BackgroundMap; baseRevision: number | null; steps: number };
// MapDocumentAction에 한 줄, follow-saved 다음:
  | { type: 'restore-drafts'; drafts: readonly MapRestoredDraft[] }
/**
 * Kept drafts come back after a restart, each as one value on its base revision. The undo history did not survive: the edits
 * it holds count as edits the history no longer holds (`dropped`), at least one, so it reads as unsaved with the count it had.
 * A draft with unsaved edits is never replaced; a clean one is. A gesture or a field edit on a replaced draft ends with it.
 */
function restoreDrafts(state: MapDocumentState, restored: readonly MapRestoredDraft[]): MapDocumentState {
  const targets = restored.filter(item => !mapDraftChanged(mapDraft(state, item.value.id)));
  if (!targets.length) return state;
  const drafts = { ...state.drafts }, replaced = new Set(targets.map(item => item.value.id));
  for (const item of targets) drafts[item.value.id] = { value: structuredClone(item.value), baseRevision: item.baseRevision, past: [], future: [], dropped: Math.max(1, item.steps) };
  return { ...state, drafts, gesture: state.gesture && replaced.has(state.gesture.mapId) ? null : state.gesture,
    coalescing: state.coalescing && replaced.has(state.coalescing.mapId) ? null : state.coalescing };
}
```

- 자리: 함수는 `dropDrafts`(mapDocument.ts:92-99) 바로 다음, `commitDraft` 앞(앵커 50이 `function rebaseDrafts(` → `function dropDrafts(`를 잘라 읽는다 — 그 사이에 두지 않는다). 리듀서의 가지는 `case 'follow-saved': { … }` 다음, `case 'update':` 앞에 `case 'restore-drafts': return restoreDrafts(state, action.drafts);`.
- `mapDraftChanged`·`mapDraftSteps`·`freshDraft`·`rebaseDrafts`·`follow-saved`는 그대로다. 되살린 직후: `mapDraftSteps` = 보관한 수(0이면 1), 되돌리기·다시 실행이 꺼져 있다, 따라가기가 건드리지 않는다(바뀐 초안), '편집 끝내기'가 묻는다, '도면 저장'이 된다. 둘 더 고치면 N+2, 둘 되돌리면 N.

### 6.4 보이는 도면 · 알림

- 다시 열 때 보이는 도면: 같은 실행이면 세션의 `shownMapId`(4.4 — 고른 도면). 껐다 켠 뒤면 그것이 없으므로 **되살린 도면 가운데 가장 나중에 보관한 것**(`newest`) — 단, 이 로그인에서 아직 도면을 고르지 않았을 때만(`currentId === null`, 되살리기가 늦어져 그 사이 다른 메뉴에 다녀왔어도). 되살린 것이 없으면 지금처럼 목록의 첫 도면.
- 되살린 것이 하나라도 있으면 도면 위 안내(:1324의 `bmap-notice`, `role="status"`, × 버튼)에 한 번: `MAP_KEEP_TEXT.restored(n)` = `` `지난번에 저장하지 않은 편집이 있던 도면 ${n}개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요.` `` — 수는 도면의 수다(바로 밑 띠의 '저장 안 한 변경 N개'는 편집의 수라, '편집 N개'라고 쓰면 둘이 섞인다). 이 안내는 화면의 상태라 다른 메뉴 왕복 뒤에는 다시 뜨지 않는다. 3D로 바꾸면 지금처럼 지워진다(:509).
- **안내의 ×는 두 번 누름의 둘째를 막는다**: 편집 중이면 안내 바로 밑이 띠이고(앵커 54가 오류 줄 → 안내 → 띠의 차례를 본다), 안내(바깥 여백까지 62px)가 사라지면 띠가 그만큼 올라와 × 자리에 '도면 저장'이 놓인다 — 둘째 누름이 되살린 도면을 저장하거나 선택 창을 연다. ×의 줄이 `onClick={() => setNotice('')}`에서 `onClick={() => { setNotice(''); swallowSecondClick(); }}`가 된다(편집 끝내기 :629, 이미지 목록의 ×와 같은 장치. 3D 안내 등 이 자리의 다른 안내도 같은 ×다). 앵커 52의 수가 7 → 8이 된다.
- **창은 스스로 뜨지 않는다** — 시작할 때도, 배경에 들어올 때도, 도면을 열 때도.

### 6.5 편집기의 effect — 두 개

자리: `gallery` 메모(:1264-1265) 바로 다음, `const treeRows` 앞(3차의 `imageBlock` 조각 밖이다).

```tsx
  // Each read of the library, before the first paint it can: a save of this PC whose answer was lost (the screen was left while it ran)
  // is put back on what the library holds, and once per login what this PC kept comes back as drafts, without a question, said once.
  // Only against a library read as an editor's, with no save (a batch of pictures locks the editor for its saves), drag or dialog running.
  useLayoutEffect(() => {
    if (!keptSettled || !snapshot.canManage || disabled || gestureActive || dialogOpen) return;
    const restored = session.catchUp(snapshot);
    if (!restored?.count) return;
    if (restored.mapId && currentId === null) setCurrentId(restored.mapId);
    setNotice(MAP_KEEP_TEXT.restored(restored.count));
  }, [session, keptStatus, snapshot, disabled, gestureActive, dialogOpen, currentId]);
  useEffect(() => { session.shownMapId = currentId; }, [session, currentId]);
```

`useLayoutEffect`라서 껐다 켠 뒤 첫 그림이 목록의 첫 도면을 한 틀 보였다가 바뀌지 않고, 답을 잃은 저장의 도면이 한 틀이라도 '저장 안 한 변경'으로 비치지 않는다. 의존 목록은 `keptSettled`가 아니라 `keptStatus`다 — `unavailable`에서 늦게 온 답으로 `ready`가 되면(4.1) 그 렌더에 다시 돈다. 편집기는 여기서 `doc.dispatch(`를 부르지 않는다(앵커의 "편집기의 dispatch는 한 곳" 그대로 — dispatch는 세션의 `catchUp` 안이다).

**세션의 `catchUp(snapshot)`**: ① **늘**: 바뀐 초안 가운데 `mapDraftSavedAlready(draft, snapshot)`(8.1)인 것들의 라이브러리 도면을 모아, 있으면 `store.dispatch({ type: 'rebase-drafts', maps })` — 그 초안은 깨끗해지고 P2가 보관본을 지운다(답을 잃은 이 PC의 저장을 `persistMaps`가 했을 일 그대로 끝낸다). ② **로그인마다 한 번**: 이미 했거나·보관하지 않는 세션이거나·신호가 이 계정이 아니거나·`ready`가 아니면 `null`(`unavailable`이어도 `restored`를 세우지 않는다). 아니면 `restored = true` → `planKeptRestore(signal.listed, snapshot, store.getState().drafts)` → `skipped`마다 콘솔 한 줄 → `restore`가 있으면 `store.dispatch({ type: 'restore-drafts', drafts: plan.restore })`, 되살린 id를 `owned`에 넣고 **그 dispatch가 건 타이머를 곧바로 푼다**(이미 파일에 있다 — 되살리기는 쓰지 않는다) → `equal`마다 `owned`에 넣고 지우기 → `{ count: plan.restore.length, mapId: plan.newest }`. `owned`에 넣는 것은 되살린 것과 `equal`뿐이다(`invalid`·`drafted`는 넣지 않는다 — 그 도면을 열었다 닫아도 그 보관본을 지우지 않는다).

---

## 7. 점

세 점은 같은 뜻이다: **이 계정에 저장 안 한 도면 편집이 있다**(보관본이든 이번 실행의 바뀐 초안이든). 수를 보이지 않고 움직이지 않는다. 마지막 하나를 저장하거나 버리면 꺼진다 — 이 버전이 되살릴 수 없는 보관본(K8)은 목록에 남아 사이드바·탭의 점을 켜 둔다.

### 7.1 사이드바의 '배경' — `BackgroundKeptDot.tsx` (새로, 늘 실린다)

```tsx
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { KEPT_DOT_TEXT, keptMapEditCount, primeKeptMapEdits, releaseKeptMapEdits, useKeptMapEdits } from './mapKeptSignal';

/**
 * The dot of the 배경 menu item: map edits of this account are not saved, kept on this PC or open in this run. Drawn only
 * inside the item the gate lets through, so the list is read for that account alone. Static: no number, no motion.
 */
export function BackgroundKeptDot({ userId }: { userId: string | null }) {
  const shown = useKeptMapEdits(state => !!userId && state.userId === userId && keptMapEditCount(state) > 0);
  useEffect(() => {
    if (!userId) return;
    primeKeptMapEdits(userId);
    // The list goes with the login, not with this dot: drawn anew for the same account, the marks the session keeps in the signal stay.
    return () => { if (useAuthStore.getState().currentUser?.id !== userId) releaseKeptMapEdits(userId); };
  }, [userId]);
  if (!shown) return null;
  return <span className="absolute -top-0.5 right-1.5 h-2.5 w-2.5 rounded-full border border-bg-card bg-accent shadow-[0_0_0_1px_rgb(var(--color-text-secondary))]" title={KEPT_DOT_TEXT}><span className="sr-only">{KEPT_DOT_TEXT}</span></span>;
}
```

`Sidebar.tsx`의 변경은 **두 줄**이다: import 한 줄(`import { canAccessBackgroundLibrary, canAccessPlayground } …`(Sidebar.tsx:10) 다음 `import { BackgroundKeptDot } from '@/features/backgrounds/BackgroundKeptDot';`)과 아이콘 칸의 자식 한 줄(`{item.id === 'compositing-revisions' && (`(Sidebar.tsx:475) 바로 앞) `{item.id === 'background-library' && <BackgroundKeptDot userId={currentUser?.id ?? null} />}`. 문의 줄(Sidebar.tsx:235)과 `featureFlag.ts`는 그대로다 — 점은 문을 지난 항목 안에만 있으므로 **목록은 문을 지난 계정에서만 읽는다**. 접힌 사이드바·펼친 사이드바·배경을 보고 있을 때 모두 보인다. 자리와 크기는 캘린더 연결 점(Sidebar.tsx:460)과 같다. 채움은 강조색이고, 바깥 1px 테두리는 글자 보조색이다 — 강조색만으로는 몇 테마에서 바탕과의 대비가 3:1에 못 미친다(밝은 화면의 에메랄드 — 페이지 2.28:1·카드 2.54:1, 호박 — 페이지 2.86:1(카드에는 3.19:1), 어두운 화면의 이혜민 머쉬룸 — 카드 2.59:1·페이지 2.82:1, themes.ts:36-106·267-268). 보조색 테두리는 여섯 테마의 두 밝기에서 페이지·카드 모두와 5:1을 넘는다(가장 낮은 것은 바이올렛 어두운 화면의 카드 5.15:1, 강조색으로 만든 사용자 테마(`deriveThemeFromAccent`)는 5.36:1 이상). 보조색을 쓰는 것은 3차가 밝은 화면에서 강조색을 비킨 것과 같은 까닭이다(backgrounds-map.css:387). 아이콘과의 사이는 카드색 테두리가 그대로 띄운다.

### 7.2 '도면 탐색' 탭 — `BackgroundLibraryView.tsx`

- import 둘: `import { KEPT_DOT_TEXT, keptMapEditCount, keptMapEditsStored, useKeptMapEdits } from "./mapKeptSignal";`, `import { MAP_KEEP_TEXT } from "./mapDraftKeep";`(둘째는 3단계에 4.7의 경계와 함께 이미 들어와 있다 — 4단계가 더하는 것은 첫째다)
- `useBackgroundStore()`의 줄(BackgroundLibraryView.tsx:31 — 4.4에서 `actorId`도 꺼낸다) 다음 두 줄: `const keptCount = useKeptMapEdits(signal => signal.userId === user?.id ? keptMapEditCount(signal) : 0);` · `const keptStored = useKeptMapEdits(signal => signal.userId === user?.id ? keptMapEditsStored(signal) : 0);`
- 탭 버튼 안, `{label}`(BackgroundLibraryView.tsx:138) 다음 줄: `{id === "maps" && keptCount > 0 && <span className="bg-tab-dot"><span className="sr-only">{KEPT_DOT_TEXT}</span></span>}` — `title`은 두지 않는다(점은 누름을 받지 않아 풍선이 뜨지 않는다. 숨은 글자가 말한다)
- 업데이트 필요 안내 아래에서는 탭이 그려지지 않으므로 이 점도 없다(사이드바의 점은 있다). 그 안내의 문장은 8.8.

### 7.3 도면 목록의 접은 줄 — 편집기

- `const draftChanged = mapDraftChanged(draft);`(:1279) 바로 다음:
  `/** Maps over a map with unsaved edits: a collapsed row says what it hides. */`
  `const changedBelow = useMemo(() => { const ids = new Set<string>(); for (const id of Object.keys(drafts)) if (mapDraftChanged(drafts[id])) for (const above of mapPath(maps, id).slice(0, -1)) ids.add(above.id); return ids; }, [maps, drafts]);`
- 줄의 버튼(:1314)에서 지금의 점 식(앵커 58이 글자로 본다) **바로 뒤에** 식 하나: `{collapsed.has(map.id) && !mapDraftChanged(mapDraft(state, map.id)) && changedBelow.has(map.id) && <span className="bmap-draft-dot" title={MAP_KEEP_TEXT.below}>●</span>}` — `MAP_KEEP_TEXT.below` = `'접어 둔 하위 도면에 저장 안 한 변경이 있어요'`. 그 줄 자신이 바뀌었으면 그 점 하나만 보인다. 색은 지금의 점과 같다(`--bmap-edit`).

### 7.4 CSS — `backgrounds.css`

- `.bg-library-tabs button {`(backgrounds.css:174)의 규칙에 `position: relative;` 한 줄을 더한다.
- `.bg-library-tabs button.selected { … }`(backgrounds.css:183-187) 다음에 새 규칙:
  ```css
  /* Unsaved map edits are kept on this PC: a dot over the end of the tab, so the tab keeps its width. The ring keeps it 3:1 on the page in every theme. It does not move. */
  .bg-tab-dot {
    position: absolute;
    top: 7px;
    right: 2px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgb(var(--color-accent));
    box-shadow: 0 0 0 1px rgb(var(--color-text-secondary));
    pointer-events: none;
  }
  ```
  탭의 오른쪽 안쪽 여백 안이다: '도면 탐색' 탭이 골라져 있으면 모든 탭이 어느 폭에서나 8px·13px(backgrounds-map.css:338이 760px 규칙보다 세다), 다른 탭이 골라져 있으면 15px, 760px 이하에서 10px(backgrounds.css:174-182·769-772). 점은 테두리까지 오른쪽 끝에서 1~10px라 가장 좁은 10px 여백에도 글자 칸에 닿지 않는다. 사이드바의 점은 Tailwind 클래스뿐이다(새 CSS 없음).

---

## 8. 다른 곳에서 먼저 바뀐 도면

### 8.1 선 자리 — 순수 함수와 얼리기

```ts
export type MapDraftStanding = 'current' | 'moved' | 'gone';
/**
 * The library holds what the draft holds, on another revision: a save of this PC whose answer the screen never saw (it was
 * left while the save ran), or the same edits saved elsewhere. Nothing is lost by putting the draft back on that map.
 */
export function mapDraftSavedAlready(draft: MapDraft, snapshot: BackgroundSnapshot): boolean {
  const saved = snapshot.maps.find(map => map.id === draft.value.id);
  return !!saved && mapDraftChanged(draft) && saved.revision !== draft.baseRevision
    && mapSaveWasApplied(snapshot, { type: 'save-maps', maps: [{ entity: draft.value, expectedRevision: saved.revision - 1 }] });
}
/** Against the library itself (never the list the drafts shadow). A clean draft follows the library and is always current. */
export function mapDraftStanding(draft: MapDraft | undefined, snapshot: BackgroundSnapshot): MapDraftStanding {
  if (!draft || !mapDraftChanged(draft) || draft.baseRevision === null) return 'current';
  const saved = snapshot.maps.find(map => map.id === draft.value.id);
  if (!saved) return 'gone';
  return saved.revision === draft.baseRevision || mapDraftSavedAlready(draft, snapshot) ? 'current' : 'moved';
}
```

편집기는 **보는 도면을 편집 중일 때만** 렌더에서 읽고, **편집기의 일이 도는 동안(`disabled` = `pending || busy`)에는 앞의 값을 그대로 둔다** — 저장 중의 스냅샷은 낙관 값이고, 응답 뒤 다시 놓기 전까지 자기 저장이 "다른 곳에서 먼저 저장됨"으로 읽힌다(2.3. 같은 내용이면 위의 규칙이 `current`로 읽지만 연결·설정처럼 초안과 다른 값을 보내는 저장은 그렇지 않다). 자리: `dialogOpen`의 줄(:292) 바로 다음, `keptStatus`·`keptSettled`(6.1)·`keptFailed`와 함께:

```tsx
  const keptFailed = useKeptMapEdits(signal => signal.userId === viewerId && !!current && signal.failed.includes(current.id));
  /** How the map on show stands against the library. Held while a save of this editor runs: the store shows that save before it is confirmed, and until its draft is put back an own save would read as one made elsewhere. */
  const standingRef = useRef<MapDraftStanding>('current');
  if (!disabled) standingRef.current = editing && current ? mapDraftStanding(draft, snapshot) : 'current';
  const standing = standingRef.current;
```

`snapshot` 자체를 넘긴다 — `maps`(초안이 가린 목록)의 그 도면은 초안의 값이라 늘 `current`가 된다. 다른 곳의 변경이 화면에 닿는 때는 지금 그대로다: 변경 신호, 창에 포커스, 15초마다의 읽기(BackgroundLibraryView.tsx:63-74).

**답을 받지 못한 이 PC의 저장(K22)** — 저장이 도는 중에 배경 화면을 떠나면(사이드바·단축키·검색·알림·`bflow://`) 저장은 서버에서 끝나지만 그 답은 버려지고, 초안은 바뀐 채 옛 버전에 남는다(2.1). 돌아오면 라이브러리는 그 초안과 **같은 내용**을 새 버전으로 갖고 있다 — `mapDraftSavedAlready`가 참이다. 그 초안은 '다른 곳에서 먼저 저장됨'이 아니라 이미 저장된 것이므로 `mapDraftStanding`이 `current`로 읽고, 되살리기의 effect가 세션의 `catchUp`으로 그 라이브러리 도면에 다시 놓는다(6.5 — `persistMaps`가 했을 일 그대로: 깨끗해지고 보관본이 지워지고 점이 꺼진다). 견주는 코드는 새로 쓰지 않는다(`mapSaveWasApplied`, 6.2의 3과 같다). 떠나 있는 동안은 초안이 바뀐 채라 점이 켜져 있다(13.2). 연결·설정·내부 도면 만들기(공간에 연결할 때 — 그때만 명령에 부모가 든다, 8.9)·새 도면으로 저장·도면 삭제가 그렇게 끊기면 보낸 값이 초안과 달라(링크를 단 값, 새 도면, 지운 도면) 이 규칙에 들지 않고 돌아온 뒤 '다른 곳에서 …'로 읽힌다 — 13.2에 알린다.

### 8.2 띠 — `mapEditStatus.ts`

```ts
export type MapEditPhase = 'saving' | 'stale' | 'changed' | 'saved' | 'clean';
/** What the editor knows besides the draft: the map was saved or deleted elsewhere first, or its edits could not be kept on this PC. */
export type MapEditNote = 'moved' | 'gone' | 'unkept' | null;
export function mapEditStatus(draft: MapDraft, saving: boolean, justSaved: boolean, note: MapEditNote = null): MapEditStatus {
  const changed = mapDraftChanged(draft), steps = mapDraftSteps(draft);
  if (saving) return /* 지금 그대로 */;
  // Saved or deleted elsewhere first. 도면 저장 stays on: a press asks what to do with the edits of this PC.
  if (changed && (note === 'moved' || note === 'gone')) return { phase: 'stale', changed, steps, detail: note === 'moved' ? '다른 곳에서 먼저 저장됐어요' : '다른 곳에서 지워졌어요', canSave: true, saveLabel: '도면 저장',
    announce: note === 'moved' ? '이 도면이 다른 곳에서 먼저 저장됐어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' : '이 도면이 다른 곳에서 지워졌어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' };
  if (changed) return { phase: 'changed', changed, steps, detail: note === 'unkept' ? '이 PC에 보관하지 못했어요' : draft.baseRevision === null ? '아직 저장한 적 없는 도면이에요' : `저장 안 한 변경 ${steps}개`, canSave: true, saveLabel: '도면 저장',
    announce: note === 'unkept' ? '저장 안 한 변경을 이 PC에 보관하지 못했어요. 도면 저장을 눌러 주세요' : '' };
  /* justSaved, clean: 지금 그대로 */
}
```

| 차례 | 상태 | 조건 | 글자(`detail`) | 모양 | 저장 버튼 | 읽어 주는 말 |
|---|---|---|---|---|---|---|
| 1 | 저장 중 | `pending` | 저장 중… | 맨 글자 | '저장 중…', 흐림 | 지금 그대로 |
| 2 | **다른 곳에서 바뀜** | 바뀜 + `moved`/`gone` | 다른 곳에서 먼저 저장됐어요 / 다른 곳에서 지워졌어요 | **테두리만 있는 알약, 앞에 `!`** | '도면 저장', 켜짐, 풍선 그대로 → 누르면 선택 창 | 위의 두 문장(바뀌는 그 렌더에 한 번) |
| 3 | 바뀜 | 바뀜 | 저장 안 한 변경 N개 / (보관 실패면) 이 PC에 보관하지 못했어요 | 채운 알약 | 켜짐 | '' / 보관 실패의 문장 |
| 4 | 방금 저장함 | 지금 그대로 | | | | |
| 5 | 깨끗함 | 지금 그대로 | | | | |

- 기존의 열 줄(tests/backgroundMapEditStatus.test.ts:22-47)은 세 인자로 부르므로 통째로 같다. 새 키는 없다.
- 편집기가 넘기는 넷째 인자: `standing !== 'current' ? standing : keptFailed ? 'unkept' : null`. 띠를 그리는 줄(:1325)이 이렇게 된다(앵커 57이 고친 글자로 본다):
  `{editing && draft && <BackgroundMapEditStrip status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id, standing !== 'current' ? standing : keptFailed ? 'unkept' : null)} disabled={disabled} onEnd={endEditing} onSave={requestSave} />}`
- `BackgroundMapEditStrip.tsx`는 고치지 않는다(`data-phase={status.phase}`가 새 값을 그대로 싣는다).
- CSS(`backgrounds-map.css`) — `[data-phase="saved"]`의 두 줄(backgrounds-map.css:46-47) 바로 다음(`.bmap-edit-key`의 줄 backgrounds-map.css:48 앞), 좁은 창 블록보다 앞:
  ```css
  /* Saved or deleted elsewhere first: the words in an outlined box with a mark before them. Not filled like unsaved edits, and the same height. */
  .bmap-edit-strip[data-phase="stale"] .bmap-edit-state>span { padding:1px 8px; border:1px solid rgb(var(--bmap-edit-ink)); border-radius:999px; font-weight:600; }
  .bmap-edit-strip[data-phase="stale"] .bmap-edit-state>span::before { content:"!"; margin-right:5px; font-weight:700; }
  ```
  채운 알약(`padding:2px 9px`)과 바깥 크기가 같다(테두리 1px + 여백 1px). 색은 띠의 두 변수뿐, 붉은색 없음(1차 7.2). **글자 폭**: 901px·사이드바를 연 창에서 띠에 남는 폭이 약 70px이다(1차 10.4). '저장 안 한 변경 3개'보다 '다른 곳에서 먼저 저장됐어요'는 약 60px 넓다 — 게이트 S에서 잰다(12절의 대체안: `다른 곳에서 저장됐어요`).

### 8.3 '도면 저장'과 Ctrl+S — `saveMap`의 한 줄

`if (!mapDraftChanged(mapDraft(doc.getState(), current.id))) return;`(:643) 바로 다음, 이름 검사(:644) 앞:

```tsx
    // Saved or deleted elsewhere first: nothing is sent. What to do with the edits of this PC is asked.
    if (standing !== 'current') { setError(''); setStaleChoice({ mapId: current.id }); return; }
```

다각형 검사가 먼저다(그리던 점이 있으면 그 문장). 바뀐 것이 없으면 묻지 않는다(바뀐 것이 없으면 `standing`도 `current`다). Ctrl+S는 `requestSave` → `saveMap`이라 같은 길이다(앵커 53의 줄들은 그대로). 창이 열린 동안 Ctrl+S는 `dialogOpen`으로 듣지 않는다.

상태(`fileDrag`의 줄 :243 바로 다음):

```tsx
  /** The choice about a map that was saved or deleted elsewhere first, asked by 도면 저장. It holds the map it was opened for, and acts on that alone. */
  const [staleChoice, setStaleChoice] = useState<{ mapId: string } | null>(null);
```

### 8.4 선택 창 — `BackgroundMapKeptDialog.tsx` (새로)

```tsx
export function BackgroundMapKeptDialog({ gone, kept, copyName, error, busy, disabled, onBack, onDiscard, onCopy }: {
  /** The library no longer has the map: its edits can be dropped or saved as a new map, nothing else. */
  gone: boolean;
  /** The edits are kept on this PC. False when their last write was refused: then the dialog does not say they are kept. */
  kept: boolean; copyName: string; error: string; busy: boolean; disabled: boolean;
  onBack(): void; onDiscard(): void; onCopy(): void }): JSX.Element {
  const text = gone ? MAP_STALE_TEXT.gone : MAP_STALE_TEXT.moved;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = back.current?.closest('dialog');
    if (!dialog) return;
    // As the delete dialog of a map does (BackgroundMapDeleteDialog): two presses of Esc close a native dialog whatever its cancel handler says.
    const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };
    const hold = (event: KeyboardEvent) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();
      // A key held down as the dialog came up (Enter on 도면 저장) answers nothing: its repeats are no press.
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    };
    dialog.addEventListener('close', reopen); window.addEventListener('keydown', hold, true);
    return () => { dialog.removeEventListener('close', reopen); window.removeEventListener('keydown', hold, true); };
  }, []);
  useEffect(() => { if (!disabled) back.current?.focus(); }, [disabled]);
  return <BackgroundModal title={text.title} onClose={() => { if (!disabled) onBack(); }}>
    <p className="bmap-confirm-text">{text.lead} {kept ? MAP_STALE_TEXT.kept : MAP_STALE_TEXT.unkept}</p>
    <p className="bmap-confirm-text">{MAP_STALE_TEXT.copy(copyName)}</p>
    {error && <p className="bg-error" role="alert">{error}</p>}
    <div className="bmap-modal-actions">
      <button type="button" className="bg-button" data-autofocus ref={back} disabled={disabled} onClick={onBack}>돌아가기</button>
      <button type="button" className="bg-button bmap-danger" disabled={disabled} onClick={onDiscard}>{text.drop}</button>
      <button type="button" className="bg-button bg-primary" disabled={disabled} onClick={onCopy}>{busy ? '저장 중…' : MAP_STALE_TEXT.save}</button>
    </div>
  </BackgroundModal>;
}
```

글자(`mapDraftKeep.ts`의 `MAP_STALE_TEXT`):

| 키 | 다른 곳에서 먼저 저장됨 (`moved`) | 다른 곳에서 지워짐 (`gone`) |
|---|---|---|
| `title` | 다른 곳에서 이 도면이 먼저 저장됐어요 | 다른 곳에서 이 도면이 지워졌어요 |
| `lead` | 이 PC에서 고친 내용과 다른 곳에서 저장한 내용은 하나로 합칠 수 없어요. | 지워진 도면에는 이 PC에서 고친 내용을 저장할 수 없어요. |
| `kept` (그 도면의 마지막 쓰기가 받아들여졌다) | 고르기 전까지 이 PC의 편집은 그대로 보관돼요. | 같음 |
| `unkept` (거절됐거나 목록을 읽지 못해 보내지 않았다 — `failed`) | 이 PC에 보관하지 못한 편집이에요. 고르기 전에 앱을 끄면 사라질 수 있어요. | 같음 |
| `drop` | 내 편집 버리고 최신 내용 받기 | 내 편집 버리기 |
| `copy(name)` | `` `새 도면은 ‘${name}’이라는 이름으로 생기고, 하위 도면으로 들어가는 연결과 다른 도면에서 들어오는 입구는 따라오지 않아요.` `` (이름은 늘 '(내 편집)'으로 끝나 조사는 '이라는'이다) | 같음 |
| `save` | 내 편집을 새 도면으로 저장 | 같음 |

- **네이티브 모달의 네 가지**(tasks/lessons.md 2026-10-11): ① 창이 떠 있는 동안 창 밖에서 온 키(Tab이 끝을 지나 `body`에 놓인 포커스의 키 포함)는 창 단위·캡처 단계에서 멈춘다(`hold`) — 뒤의 Ctrl+S·Delete·Space·화살표·앱 단축키가 듣지 않는다. Ctrl+R·Z·Y는 기본 동작까지 막는다 ② 두 번의 Esc로 엔진이 닫아도 다시 연다(`reopen`) — 닫는 길은 `onBack`뿐이다 ③ '도면 저장'을 Enter로 누른 채 있으면 그 되풀이가 창의 단추를 누르지 않는다(`event.repeat`) ④ 저장이 도는 동안 꺼졌던 단추에서 포커스가 빠지면 끝난 뒤 '돌아가기'로 돌아온다. 이 창은 사용자가 누른 버튼으로 뜨고 바깥 누름으로 닫히지 않으므로 0.4초 유예는 두지 않는다.
- 폼이 아니다: Enter는 포커스가 있는 단추만 누른다(처음엔 '돌아가기'). Esc와 X는 '돌아가기'다.
- 창은 편집기의 다른 창처럼 `document.body`로 포털되고(BackgroundUI.tsx:36-61) 편집기의 `error`를 창 안에 그린다 — 창 밑의 붉은 줄은 지금의 조건(`!(dialogOpen && !placePrompt)`)으로 감춰진다.
- 긴 이름: `.bmap-confirm-text`의 규칙(backgrounds-map.css:242)에 `overflow-wrap:anywhere;`를 더한다. 새 도면의 이름은 원래 이름을 통째로 싣는데(160자까지), 띄어쓰기 없는 긴 라틴 글자면 지금의 규칙으로는 줄을 바꾸지 못해 창(`.bg-modal-content`는 `overflow: auto`, backgrounds.css:468-471)이 옆으로 밀린다. 한글은 음절마다 끊겨 지금도 바뀐다. 같은 규칙을 쓰는 삭제 창·물음의 글자도 함께 줄을 바꾼다(그 줄을 글자로 보는 앵커는 없다).

편집기가 그리는 줄 — **`createForm` 창의 끝 줄 `</form></BackgroundModal>}`(:1536) 바로 다음, `{linkForm && current && <BackgroundModal`(:1537) 앞**의 한 줄(앵커 66·77이 붙어 있기를 보는 줄들 밖이다):

```tsx
    {staleChoice && <BackgroundMapKeptDialog gone={!snapshot.maps.some(map => map.id === staleChoice.mapId)} kept={!keptFailed} copyName={rescueMapName(mapDraft(state, staleChoice.mapId)?.value.name ?? '')} error={error} busy={busy} disabled={disabled} onBack={() => void answerStale('back')} onDiscard={() => void answerStale('discard')} onCopy={() => void answerStale('copy')} />}
```

`gone`은 그릴 때마다 라이브러리에서 읽는다: 창이 열린 사이 그 도면이 지워지면 창이 '지워짐'의 글자로 바뀐다(창 밑에서는 따라가기도 편집도 돌지 않으므로 그 밖에는 바뀌지 않는다). 창은 지금 보는 도면에 매달리지 않는다(`current &&`가 없다). `kept`는 보는 도면의 `keptFailed`(8.1)다 — 창은 '도면 저장'으로 보는 도면에 대해서만 열리고, 열린 동안 창 밖은 누를 수 없어 보는 도면이 바뀌지 않는다. 띠는 `stale`이 보관 실패보다 앞서므로(8.2) 보관하지 못했다는 말은 이 창이 한다(8.7). 단추의 이름에 `onDrop`·`onPaste`를 쓰지 않는다 — 3차의 앵커 74가 편집기에 그 글자가 없기를 본다.

### 8.5 답 — `answerStale` (편집기)

자리: `saveSettings`(:709-719) 바로 다음, `async function uploadUnderlay(`(:720) 앞(그 사이를 자르는 앵커가 없다 — 3차의 `linkAddedImages` 조각은 `uploadUnderlay` 뒤에서 시작한다).

```tsx
  /** The answer about a map saved or deleted elsewhere first. Nothing is merged, and nothing is written over what was saved there. */
  async function answerStale(choice: 'back' | 'discard' | 'copy') {
    if (!staleChoice || disabled) return;
    const mapId = staleChoice.mapId, held = mapDraft(doc.getState(), mapId), saved = snapshot.maps.find(map => map.id === mapId);
    if (choice === 'back' || !held) { setStaleChoice(null); setError(''); return; }
    if (choice === 'discard') {
      // Moved: the draft goes on from what was saved elsewhere, and editing goes on. Gone: the draft goes, and the screen moves to where the map hung.
      if (saved) doc.rebaseDrafts([saved]);
      else { doc.discard(mapId); setCurrentId(held.value.parentId); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); }
      setPolygon([]); setActiveVertex(null); setStaleChoice(null); setError(''); return;
    }
    // A new map of the edits of this PC, saved the way every save of maps goes, and edited on as a new map is. The map saved elsewhere is not touched.
    const copy = rescueMapCopy(snapshot, held.value, uuid()), command: MapSaveCommand = { type: 'save-maps', maps: [{ entity: copy, expectedRevision: null }] };
    setBusy(true); setError('');
    try {
      await persistMaps(command);
      doc.discard(mapId); doc.beginEditing(savedMaps(command)[0]);
      setCurrentId(copy.id); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setStaleChoice(null);
      if (copy.parentId) expandPath(copy.parentId);
    } catch (cause) { setError(mapDeleteCauseText(cause)); } finally { setBusy(false); }
  }
```

| 답 | 일어나는 일 | 보내는 것 |
|---|---|---|
| 돌아가기(·Esc·X) | 창만 닫힌다. 초안·보관본·띠 그대로 | 없음 |
| 최신 내용 받기(`moved`) | 초안이 라이브러리의 그 도면으로 **다시 놓인다**(`rebase-drafts`) — 편집 중 그대로, 띠 '저장된 그대로예요', 보관본 지움 | 없음 |
| 내 편집 버리기(`gone`) | 초안이 없어져 그 도면이 목록에서 사라지고, 화면은 그 도면이 달렸던 위 도면(없으면 첫 도면). `navigate`가 비우는 것을 비운다. 보관본 지움 | 없음 |
| 새 도면으로 저장 | 새 도면 하나를 `persistMaps`로(일곱째) 저장 → 원래 도면의 초안 없앰(보관본 지움) → 새 도면이 저장된 그 모습(버전 1)으로 **편집 중**이 되어 보이고(`createMap`이 새 도면을 버전 1로 여는 것과 같다, :695 — 띠 '저장된 그대로예요', 도구는 선택), 그 위 줄들이 펼쳐진다. 원래 도면(라이브러리의 것)은 건드리지 않는다. 실패하면 창 안에 까닭(`mapDeleteCauseText` — Electron의 껍데기를 벗긴 말)이 뜨고 아무것도 바뀌지 않는다. 이름을 비웠거나 160자를 넘긴 배치가 있으면 '도면 저장'과 같이 `오브젝트 이름 형식 또는 길이를 확인해 주세요.`로 거절된다(저장소가 명령을 미리 적용해 보는 검사, useBackgroundStore.ts:48 — 보내지 않는다). 돌아가 이름을 넣고 다시 고르면 된다 | `save-maps` 하나(`expectedRevision: null`) |

기다린 뒤에는 렌더의 `snapshot`·`current`·`draft`·`maps`를 읽지 않는다 — 보낼 명령까지 기다리기 전에 정했다(`mapId`·`copy`·`command`. 명령을 기다리는 줄 안에서 만들면 그 줄의 `'save-maps'`·`maps:`가 앵커 81의 검사에 걸린다). 새 도면의 초안은 그 명령이 저장한 값(`savedMaps(command)[0]`)으로 연다. `expandPath`는 기다리기 전부터 있던 위 도면을 편다.

**새 도면 — `rescueMapCopy` · `rescueMapName`** (`mapDraftKeep.ts`):

```ts
const COPY_SUFFIX = ' (내 편집)';
/** The name of the copy: the name, cut by whole characters so that with the suffix it fits the 160 the library counts (UTF-16 units). */
export function rescueMapName(name: string): string {
  let kept = '';
  for (const char of name.trim()) { if (kept.length + char.length > 160 - COPY_SUFFIX.length) break; kept += char; }
  return `${kept.trimEnd()}${COPY_SUFFIX}`;
}
/** A new map of the edits of this PC, to save beside a map that was saved or deleted elsewhere. What it cannot carry is left out. */
export function rescueMapCopy(snapshot: BackgroundSnapshot, value: BackgroundMap, id: string): BackgroundMap {
  const places = new Set(snapshot.places.map(place => place.id)), views = new Set(snapshot.views.map(view => view.id));
  const place = (placeId: string | null) => placeId !== null && places.has(placeId) ? placeId : null;
  return {
    id, revision: 0, name: rescueMapName(value.name), imageUrl: value.imageUrl,
    parentId: value.parentId !== null && snapshot.maps.some(map => map.id === value.parentId) ? value.parentId : null,
    placeId: place(value.placeId),
    nodes: value.nodes.map(node => node.type === 'space' ? { ...node, childMapId: null, placeId: place(node.placeId) }
      : node.type === 'camera' ? { ...node, viewIds: node.viewIds.filter(viewId => views.has(viewId)) } : node),
  };
}
```

노드 id는 그대로다(도면 안에서만 겹치지 않으면 된다). 이름이 같은 도면이 둘이 되어도 된다(도면 이름에는 겹침 규칙이 없다). 이 값이 진짜 `applyBackgroundCommand`를 지나는지는 10.1의 KP-7이 원래 도면이 옮겨졌을 때·지워졌을 때·이은 장소가 지워졌을 때·시점이 지워졌을 때 본다(바탕은 저마다 그 자체로 맞는 라이브러리다 — 10.1에 짜는 법).

### 8.6 서버가 거절한 저장 (이 PC가 아직 새 버전을 읽지 못했을 때)

지금 그대로 붉은 줄(`다른 사용자가 내용을 변경했습니다. 새로고침 후 다시 저장해 주세요.`)이 뜨고, 저장소가 다시 읽는다(useBackgroundStore.ts:59-71). `busy`가 꺼지는 렌더에서 선 자리가 `moved`가 되어 띠가 바뀌고, 다음 누름은 선택 창을 연다 — 이 첫 누름만은 '누르기 전에 띠가 알린다'는 말과 다르다(13.2). **만들지 않는 것**: 합치기, 새 버전 위에 내 값을 쓰기, 내 값을 둔 채 초안의 `baseRevision`만 라이브러리의 것으로 옮기기(같은 내용일 때 라이브러리의 도면으로 다시 놓는 8.1의 규칙은 그것이 아니다 — 내 값이 이미 그 버전의 값이다). '도면 설정'·'기존 도면 연결'·'내부 도면 만들기'(공간에 연결)도 그 도면의 초안을 옛 버전으로 보내므로 다른 곳에서 바뀐 도면에서는 지금처럼 이 붉은 줄로 거절된다 — 이 차례는 그 길을 고치지 않는다(1.3, 13.2).

### 8.7 보관하지 못함

쓰기가 거절된 도면(디스크·잠김·크기·100개·버전) — 또는 목록을 읽지 못해 쓰지 않은 도면(P4) — 을 보고 있고 다른 곳에서 바뀌지 않았으면 띠가 '이 PC에 보관하지 못했어요'(채운 알약, '도면 저장' 켜짐)이고 읽어 주는 말이 한 번 `저장 안 한 변경을 이 PC에 보관하지 못했어요. 도면 저장을 눌러 주세요`. 편집은 막지 않는다. 그 도면의 다음 쓰기(다음 편집, 종료·로그아웃의 마저 쓰기)가 받아들여지거나, 그 초안을 저장하거나 버리면 원래 글자로 돌아온다. 다른 곳에서도 바뀐 도면이면 띠는 `stale`이고, 보관하지 못했다는 말은 선택 창이 한다(8.4의 `unkept`). 보지 않는 도면의 보관 실패는 따로 표시하지 않는다(그 도면을 열면 띠가 말한다).

### 8.8 업데이트 필요 안내의 한 문장 — `BackgroundLibraryView.tsx`

안내의 `<p>`(BackgroundLibraryView.tsx:123) 바로 다음 줄: `{keptStored > 0 && <p>{MAP_KEEP_TEXT.update(keptStored)}</p>}` — `` `이 PC에 저장 안 한 편집이 있는 도면 ${n}개가 그대로 보관돼 있어요. 업데이트한 뒤 배경 화면을 열면 이어서 고칠 수 있어요.` `` 수는 `keptMapEditsStored`(4.1) — 파일에 있는 도면에서 마지막 쓰기가 거절된 것을 뺀 수다(아직 0.3초 안이라 보내지 않은 것은 곧 들어가지만 세지 않는다. 점의 수 `keptCount`와 다르다). 안내 아래에서는 편집기가 그려지지 않지만 세션은 산다 — 초안과 보관본이 남는다. 앵커 46은 그 줄을 막지 않는다(안내 조각 안의 `<h3>`와 '다시 확인' 버튼만 본다).

### 8.9 '내부 도면 만들기'의 다시 시도 가지

:687의 줄을 `if (createForm.parentId && createForm.spaceId) doc.discard(createForm.parentId);`로. 응답을 잃은 첫 시도의 명령에 부모가 든 것은 공간 연결이 있을 때뿐이다(`createMapAndConnect`, mapWorkflow.ts:91-100) — 그때 부모의 초안 값은 이미 저장돼 있다. 연결이 없으면 부모의 저장 안 한 편집과 그 보관본이 남는다.

---

## 9. 함께 쓰는 것

### 9.1 `dialogOpen`

:292의 줄에 한 낱말: `const dialogOpen = !!(confirmation || createForm || linkForm || settingsForm || mapDelete || placePrompt || staleChoice);`

| 읽는 곳 | 선택 창이 열린 동안 |
|---|---|
| 따라가기의 가드와 그 effect | 깨끗한 초안이 라이브러리를 따라가지 않는다. 닫힐 때 다시 돈다 |
| Ctrl+S | 듣지 않는다 |
| 그림 넣기의 넷(`idle`·`addImages`·붙여 넣기·끌기) | 넣기를 받지 않고 저장 실행을 시작하지 않는다 |
| **되살리기(새)** — 가드와 의존 목록 | 되살리지 않고 답을 잃은 저장도 다시 놓지 않는다. 닫힐 때 다시 본다 |
| 붉은 줄 | 감춘다(까닭은 창 안에 있다) |

글자 `dialogOpen`은 편집기에 **열한 번**, 열한 줄에 하나씩 나온다: 만드는 줄 → 따라가기의 가드 → 그 effect → Ctrl+S → `idle` → `addImages` → 붙여 넣기의 `dialog:` → 끌기의 가드 → **되살리기의 가드** → **되살리기의 의존 목록** → 붉은 줄.

### 9.2 앵커 — `tests/backgroundMapEditorWiring.test.ts`와 테스트 하나

**일부러 고치는 기존 앵커.** 그 밖은 한 글자도 고치지 않고 지나야 한다(첫 판의 줄을 사본에 넣고 돌려 75개가 지났다. 검토로 고친 줄은 14절).

| # | 지금 | 고친 뒤 |
|---|---|---|
| 50 | `assert.equal(count(editor, /await persistMaps\(/g), 6, …)` | **7**, 설명에 `the copy of the edits of this PC over a map saved or deleted elsewhere` |
| 52 | `assert.equal(count(editor, /\bswallowSecondClick\b/g), 7, …)`와 그 위 주석 | **8**, 설명에 `the × of the editor's notice, which takes the notice away from over the band`. 그 줄 `onClick={() => { setNotice(''); swallowSecondClick(); }}`(6.4)이 편집기에 한 번인지도 본다 |
| 57 | 띠 조각에 `'status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id)}'` | `"status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id, standing !== 'current' ? standing : keptFailed ? 'unkept' : null)}"`(앞의 두 조각 `'mapEditStatus(draft, pending,'`·`'savedNotice?.mapId === current.id'`는 그대로) |
| 58 | '편집 시작'의 태그 통째로 `… disabled={disabled \|\| editing} …` | `'<button type="button" className="bg-button bmap-edit-start" disabled={disabled \|\| editing \|\| !keptSettled} aria-hidden={editing \|\| undefined} onClick={() => { beginEditing(); setInspectorOpen(true); focusCanvas(); }}>편집 시작</button>'`(6.1), 주석에 "and off until this PC's list of kept edits is read" — 그 밖의 검사는 그대로 |
| 59 | 새 테스트 파일 이름 여섯 | + `'backgroundMapKeep.test.ts'`, `'backgroundKeptEdits.test.ts'` |
| 65 | 만드는 줄 `… \|\| placePrompt);`, 수 9, 줄 목록 아홉 | 만드는 줄 `… \|\| placePrompt \|\| staleChoice);`, 수 **11**, 줄 목록은 9.1의 차례 — 끌기의 가드 다음에 `'if (!keptSettled \|\| !snapshot.canManage \|\| disabled \|\| gestureActive \|\| dialogOpen) return;'`와 `'}, [session, keptStatus, snapshot, disabled, gestureActive, dialogOpen, currentId]);'`, 그다음 붉은 줄. 이름과 주석: "seven places read it" → "**nine** places read it"(되살리기의 가드와 그 의존 목록). `confirmation \|\| createForm`이 한 번뿐인 것은 그대로 |
| — | `tests/motion/fx3-retry-session.test.ts:388`의 정규식 | `/const handleLogout = async \(\) => \{\n(?:\s+\/\/.*\n)*\s+await flushSceneSavesBeforeLogout\(\);\n(?:\s+\/\/.*\n)*\s+await flushKeptMapEditsBeforeLogout\(\);\n\s+await logout\(\);\n\s+setCurrentUser\(null\);/` — 테스트 이름에 "배경 도면의 보관도 마저 적은 뒤"를 더한다 |

**새 조각**(읽힐 때만 자른다): `answerStale` = `piece(editor, 'async function answerStale(', 'async function uploadUnderlay(')` · `restoreEffect` = `piece(editor, 'useLayoutEffect(() => {\n    if (!keptSettled', 'const treeRows')`(주석을 지운 편집기에서) · 새 파일을 읽는다: `useBackgroundMapDocument.ts`·`mapDraftSession.ts`·`mapDraftKeep.ts`·`mapKeptSignal.ts`·`BackgroundKeptDot.tsx`·`BackgroundMapKeptDialog.tsx`·`BackgroundLibraryView.tsx`·`backgrounds.css`, 그리고 저장소 뿌리에서 `src/components/layout/Sidebar.tsx`·`src/components/auth/UserMenu.tsx`·`electron/backgroundKeptEdits.ts`·`electron/main.ts`·`electron/preload.ts`·`src/types/index.ts`·`src/mocks/devElectronAPI.ts`·`src/shared/backgroundKeptEdits.ts`(3차 앵커 78처럼 날것으로 읽는다).

**새 앵커 — 79~83.**

| # | 지키는 것 | 잡아야 하는 변형 |
|---|---|---|
| 79 | **문서는 계정의 것이고 화면보다 오래 산다.** 훅 파일에 `const [session] = useState(() => mapDraftSessionOf(userId));`·`const store = session.store;`·내릴 때의 정리 줄·다시 읽기 줄(4.3의 글자)이 있고 `createMapDocumentStore`가 없다 · `mapDraftSessionOf`가 4.3의 글자이고(`if (active?.userId === userId) return active;`·`active?.dispose();`, `createMapDraftSession({` 안의 네 줄 `put:`·`signal:`·`timers:`·`now:`가 줄째로 그 글자, 그 안에 `primeKeptMapEdits(`가 없다), 세 줄 `window.electronAPI?.onBeforeQuitFlush?.(() => active?.flush());`·`setKeptMapFlush(() => active?.flush() ?? Promise.resolve());`·`useAuthStore.subscribe((now, before) => { if (now.currentUser?.id !== before.currentUser?.id) { active?.dispose(); active = null; } });`가 **줄째로** 파일에 각각 한 번이며 셋 다 `if (!hooked) {` 블록 안이다 · `mapDraftSession.ts`에 `createMapDocumentStore()`가 한 번, `discardAll`의 몸이 4.7의 한 줄 · 편집기에 `const doc = useBackgroundMapDocument(viewerId);`·`const { state, session } = doc, drafts = state.drafts;`·`useState<string \| null>(() => session.shownMapId)`·4.4의 `useEffect(() => { session.shownMapId = currentId; }, [session, currentId]);`, 그리고 `useEffect(() => abortGesture, [abortGesture]);`가 그대로 있다 · 라이브러리 화면에 4.7의 경계(`getDerivedStateFromError`·`console.error('[background] map editor failed:'`·버튼의 `onClick` 줄이 그 글자)가 있고 `<BackgroundMapEditor`가 `<MapEditorGuard onDiscard={() => { if (user) mapDraftSessionOf(user.id).discardAll(); }}>`부터 `</MapEditorGuard>`까지의 조각 안에 한 번이고 그 조각에 `<BackgroundAssetPanel`이 없다 | 훅이 제 저장소를 만듦(왕복에서 초안이 사라진다) / 정리에서 `end-coalescing`을 뺌 / 계정이 바뀌어도 세션을 그대로 둠(`userId` 검사를 뺌 — B가 A의 초안을 본다) · 구독에서 `dispose`를 뺌 / 신호 쓰기가 통째로 바꿈(`setState(patch, true)` — 계정과 상태가 지워져 아무것도 보관하지 않는다) / 종료 정리가 세션을 부르지 않음(`() => active?.flush` 등) · 로그아웃 정리가 빈 약속 / 종료 정리를 세션마다 등록(로그인마다 하나씩 쌓인다) / 다시 읽기를 그리는 도중에(`mapDraftSessionOf` 안) / 보던 도면을 `null`에서 시작 · 보이는 도면(`current?.id`)을 적음(고르지 않은 채 왕복하면 늦은 되살리기가 가장 나중 도면을 보이지 않는다) / 경계가 없음·본문 전체를 감쌈 / 버튼이 초안을 버리지 않음(같은 초안으로 다시 깨진다) · 상태를 되돌리지 않음(버린 뒤에도 글자뿐) |
| 80 | **보관 규칙과 되살리기.** `mapDraftSession.ts`에 5절 P1·P2(`arm`의 줄 포함)·P4·P6(`drop`의 줄 — P5의 줄을 품는다)의 줄이 글자 그대로 · `mapDraftKeep.ts`에 `export const MAP_KEEP_DELAY_MS = 300;` · 세 파일(`mapDraftSession.ts`·`mapDraftKeep.ts`·`mapKeptSignal.ts`)에 `execute`·`useBackgroundStore`·`backgroundExecute`·`localStorage`가 없고, 앞의 둘에는 `window`·`document`도 없다(타이머와 쓰기는 주입된다) · 편집기에 6.5의 두 effect가 글자 그대로(`restoreEffect` 조각), `session.catchUp(`이 한 번, `doc.dispatch(`는 여전히 한 번 · `beginEditing`의 첫 줄이 6.1의 글자이고 '＋ 공간 그리기'의 버튼에 `disabled={disabled \|\| !keptSettled}` · 다시 시도 가지의 줄이 8.9의 글자이고 `if (createForm.parentId) doc.discard(`가 없다 · `keptStatus`·`keptSettled`의 두 줄이 6.1의 글자 | 제스처 중에도 씀(P1을 뺌) / 바뀔 때마다 타이머를 다시 걺(뒤끝 — 이어 고치는 동안 아무것도 쓰지 않는다) / 지우기가 `owned`를 보지 않음(읽지 않은 보관본을 지운다) · `drop`이 `owned`를 먼저 봄(보내지 못한 도면의 타이머·`failed`가 남는다) / 목록 전·읽지 못한 동안에도 씀(`ready()` 대신 `loading`만 봄) / 끌기의 미리보기를 씀(`gestureStartMap`을 뺌) / 되살리기가 창·저장·끌기 밑에서 돎(가드에서 하나씩 뺌) · 그림을 올리는 동안 되살리기를 미룸(가드에 `imageAdd.view.running`을 더함 — 그 사이 연 초안이 보관본을 덮는다) / `canManage`를 보지 않음(빈 라이브러리에 대고 되살린다) / 되살리기를 `useEffect`로 / 의존 목록에 `keptStatus` 대신 `keptSettled`(늦게 읽힌 목록을 되살리지 않는다) / 편집기가 `doc.dispatch({ type: 'restore-drafts'` / 다시 시도 가지를 되돌림 / `beginEditing`이 목록을 기다리지 않음 · '＋ 공간 그리기'가 흐려지지 않음('편집 시작'의 흐림은 앵커 58) |
| 81 | **다른 곳에서 먼저 바뀜.** `dialogOpen`의 줄 바로 다음 여섯 줄(주석을 지우고)이 이 차례로 글자 그대로: `keptStatus` → `keptSettled`(6.1) → `keptFailed` → `standingRef` → `if (!disabled) standingRef.current = editing && current ? mapDraftStanding(draft, snapshot) : 'current';` → `const standing = standingRef.current;` · 8.3의 줄이 `saveMap`에서 바뀐 것 없음 검사 **다음**, 이름 검사 **앞**이고 `setStaleChoice({`가 편집기에 한 번 · 상태 줄 · 8.4의 그리는 줄(`kept={!keptFailed}` 포함)이 `createForm` 창의 끝 줄 바로 다음이고 그 다음 줄이 `{linkForm && current && <BackgroundModal`로 시작 · `answerStale` 조각이 8.5의 글자(줄 단위)이고 그 안에 `execute(`가 없고, 보낼 명령(`command: MapSaveCommand`)이 첫 `await` 앞에서 만들어지고, 첫 `await`부터 끝까지 `snapshot`·`current`·`draft`·`maps`가 없다(앵커 66의 정규식) · 대화 상자 파일에 `<form`이 없고 `data-autofocus`가 한 번(돌아가기 단추), `hold`·`reopen`·포커스 effect의 줄과 첫 문단의 줄(`{text.lead} {kept ? …}`)이 8.4의 글자, 단추의 차례가 돌아가기 → 버리기 → 새 도면 · `mapEditStatus.ts`의 `stale`·`changed` 두 줄이 8.2의 글자 · CSS의 두 줄이 글자 그대로이고 `animation`·`transition`이 없다 | 얼리지 않음(`if (!disabled)`를 뺌 — 자기 저장마다 띠가 깜빡인다) / 초안이 가린 목록을 넘김(늘 그대로다) / 저장 버튼이 그냥 보냄(8.3의 줄을 뺌) · 그 줄을 다각형 검사 앞으로 / `dialogOpen`에서 `staleChoice`를 뺌(창 밑에서 따라가고 그림이 들어온다) / 창을 물음의 줄 뒤에(앵커 66이 떨어진다) / 새 도면을 `execute`로 / 원래 초안을 저장 전에 없앰 / 새 도면을 보기 모드로 둠(`doc.beginEditing`을 뺌) / 최신 받기를 `followSaved`로(바뀐 초안은 따라가지 않는다) / 창이 폼(Enter로 고른다) / 되풀이 줄을 뺌 / `reopen`을 뺌 / 창이 보관 실패를 모름(`kept`를 늘 참으로) · `keptFailed`가 신호의 계정을 보지 않음(다른 계정의 실패 표시를 읽는다 — 도면 id는 계정 사이에 같다) / stale을 채운 알약으로(바뀜과 모양이 같다) |
| 82 | **점과 본문의 문.** `Sidebar.tsx`에 `BackgroundKeptDot`이 import 한 번, 쓰는 줄 한 번(7.1의 글자)이고 그 줄은 아이콘 칸 안이다 — 칸은 `<span className="shrink-0 w-12 flex justify-center relative">`부터 그다음 `className="text-sm font-medium`까지로 자른다(칸 안의 캘린더 점이 `</span>`을 품고 있어 첫 `</span>`에서 자르면 새 줄이 칸 밖으로 읽힌다) · 문의 줄 그대로 · 점 파일의 import가 `react`·`@/stores/useAuthStore`·`./mapKeptSignal`뿐, `shown`의 줄·정리 줄·태그가 7.1의 글자 · `mapKeptSignal.ts`의 import가 `zustand`와 타입 하나뿐(`domain`·`mapDocument`·`mapDraft`라는 글자가 import 줄에 없다), `KEPT_DOT_TEXT`의 글자, `keptMapEditCount`·`keptMapEditsStored`의 몸 · 라이브러리 화면의 `actorId`를 꺼내는 줄과 본문의 문 줄(4.4 — `) : (`부터 `</section>`까지의 조각 안), `keptCount`·`keptStored` 줄·탭 점의 줄(7.2, `title` 없음)·안내 문장의 줄(8.8 — `{updateRequired ? (`부터 `) : (`까지의 조각 안) · 편집기의 `changedBelow` 줄과 접은 줄의 점 식(7.3) — 앵커 58의 식 바로 뒤 · `backgrounds.css`의 `.bg-tab-dot` 규칙(`position: absolute`·`right: 2px`·`box-shadow`·`pointer-events: none`, `animation`·`transition` 없음)과 `.bg-library-tabs button`의 `position: relative` · `UserMenu.tsx`의 import와 두 `await`의 차례(씬 → 보관 → 로그아웃) | 점이 문 밖에 있음(다른 항목에도 그림) / 신호의 계정을 보지 않음(앞 계정의 점) / 점이 내려갈 때마다 신호를 비움(같은 로그인에서 다시 그려지면 '편집 시작'이 흐려진다) / 신호가 문서 모듈을 import(첫 묶음이 커진다) / 본문의 문에서 `actorId`를 뺌(편집기가 빈 저장소에 대고 올라와 깨끗한 초안을 지운다) / 탭 점이 수를 보지 않음 / 접은 줄의 점이 접히지 않은 줄에도 / 안내 문장이 보관하지 못한 것까지 셈 / 로그아웃 뒤에 마저 씀(세션이 없어 거절된다) |
| 83 | **파일과 두 채널: 네 곳, 메인 모듈 하나.** `main.ts`에 3.4의 import·두 줄(그 등록 블록 바로 다음)·`await finishKeptEditsBeforeExit({ rendererFlush, store: backgroundKeptEdits });`(before-quit에서 `rendererFlush,` 두 목록이 모두 끝난 **뒤**, `// ★ 자동 업데이트 적용` **앞**), `'background-kept:`는 main.ts에 없다(채널은 모듈 안이다) · preload의 두 줄 · 타입의 두 줄이 필수(`backgroundKeptList:`·`backgroundKeptPut:` — `?:`가 없다) · mock의 두 멤버와 `PREVIEW_KEPT_KEY`의 글자, 쓰기가 `keptEntryProblem(`을 부른다 · `electron/backgroundKeptEdits.ts`에 `from 'electron'`·`supabase`가 없고, 3.2의 쓰기 세 줄(`files.open(temp, 'w')` → `handle.sync()` → `files.rename(temp, file)`, 이 차례)·`waitOutLock`과 `finishKeptEditsBeforeExit`의 몸·`` `${file}.broken-${now()}-${++broken}` ``이 글자 그대로, `'ENOENT'`, `keptEntryProblem(`, 3.3의 두 핸들러가 글자 그대로(목록의 문장 `보관 목록 응답을 폐기했습니다` 포함) · `src/shared/backgroundKeptEdits.ts`에 `import`가 없다 | 화면이 계정을 보냄(핸들러가 사용자 인자를 받음) / epoch를 보지 않음 / 바로 본 파일에 씀(반쯤 쓰인 파일) / 디스크까지 내리지 않음(`sync`를 뺌 — 전원이 나가면 0으로 찬 파일이 `.broken-`으로 옮겨져 모든 보관본을 잃는다) · 이름을 바꾼 뒤에 내림 / 모든 읽기 오류를 빈 것으로 / 잠김을 다시 해 보지 않음 / 깨진 파일을 덮어씀 · 이름에서 번호를 뺌 / 마저 쓰기를 대기 작업 목록 안에(창이 보낸 쓰기를 기다리지 못한다) / 타입이 선택 멤버(mock이 빠져도 지난다) |

앵커는 **뮤테이션으로 확인**한다(10.2).

### 9.3 파일 계획

| 파일(이름만 쓴 것은 `src/features/backgrounds/`) | 새로 · 고침 | 내용 |
|---|---|---|
| `src/shared/backgroundKeptEdits.ts` | 새로 | 3.1 |
| `electron/backgroundKeptEdits.ts` | 새로 | 3.2·3.3 |
| `mapKeptSignal.ts` · `BackgroundKeptDot.tsx` | 새로(늘 실린다) | 4.1 · 7.1 |
| `mapDraftKeep.ts` | 새로(순수) | 5절 `keptEntryOf`·`MAP_KEEP_DELAY_MS`, 6.2, 8.1의 두 함수, 8.5의 두 함수, 글자 `MAP_KEEP_TEXT`(`restored`·`update`·`below`·`broken`·`brokenDiscard`)·`MAP_STALE_TEXT` |
| `mapDraftSession.ts` | 새로(순수 팩토리) | 4.2·5절·6.5의 `catchUp`·4.7의 `discardAll` |
| `BackgroundMapKeptDialog.tsx` | 새로 | 8.4 |
| `tests/backgroundMapKeep.test.ts` · `tests/backgroundKeptEdits.test.ts` | 새로 | 10.1 |
| `mapDocument.ts` | 고침 | 6.3(타입 하나·액션 한 줄·함수 하나·가지 하나) |
| `mapEditStatus.ts` | 고침 | 8.2 |
| `useBackgroundMapDocument.ts` | 고침 | 4.3 |
| `BackgroundMapEditor.tsx` | 고침 | 아래 표 |
| `BackgroundLibraryView.tsx` · `backgrounds.css` · `backgrounds-map.css` | 고침 | 4.4(본문의 문)·4.7(편집기의 경계)·7.2·8.8 · 7.4 · 8.2·8.4(`.bmap-confirm-text`의 `overflow-wrap`) |
| `src/components/layout/Sidebar.tsx` · `src/components/auth/UserMenu.tsx` | 고침(두 줄씩) | 7.1 · 4.5 |
| `electron/main.ts` · `electron/preload.ts` · `src/types/index.ts` · `src/mocks/devElectronAPI.ts` | 고침 | 3.4~3.6 |
| `tests/backgroundMapEditorWiring.test.ts` · `tests/motion/fx3-retry-session.test.ts` | 고침 | 9.2 |
| `package.json` · `package-lock.json` · `DEVLOG/update-notes.json` · 문서 | 고침 | 11절 |

**`BackgroundMapEditor.tsx`에서 고치는 곳**(이 커밋의 줄 — 함께 적은 글자로 찾는다)

| 것 | 자리 | 걸리는 앵커 |
|---|---|---|
| import(4단계): `import { MAP_KEEP_TEXT } from './mapDraftKeep';` · `import { useKeptMapEdits } from './mapKeptSignal';` | `MapImageDropOverlay` import(:44) 다음 | — |
| import(5단계 — 대화 상자 파일이 이 단계에 생긴다): `import { BackgroundMapKeptDialog } from './BackgroundMapKeptDialog';` · 4단계의 `./mapDraftKeep` import에 `mapDraftStanding, rescueMapCopy, rescueMapName`을 더함 · `import type { MapDraftStanding } from './mapDraftKeep';` | 4단계의 import 다음 | — |
| `doc`·`state, session`·`currentId`의 세 줄(4.3) | :188-190 | 79 |
| 상태 `staleChoice`(8.3) | `fileDrag`의 줄(:243) 다음, `const deleting = useRef(false);` 앞 | 81 |
| `dialogOpen`에 `\|\| staleChoice`(9.1) | :292 | 65 |
| `keptStatus` → `keptSettled`(6.1) → `keptFailed` → 선 자리의 세 줄(8.1), 이 차례로 | :292 바로 다음 | 80 · 81 |
| `beginEditing`의 첫 줄(6.1) | :608 | 80 |
| `saveMap`의 한 줄(8.3) | :643 다음 | 51(그대로 지난다) · 81 |
| 다시 시도 가지(8.9) | :687 | 80 |
| `answerStale`(8.5) | `saveSettings` 다음, `uploadUnderlay` 앞 | 50 · 81 |
| `shownMapId` effect(4.4 — 3단계) | `gallery` 메모(:1264-1265) 다음, `const treeRows` 바로 앞 | 79 · 80(조각) |
| 되살리기 effect(6.5 — 4단계) | `shownMapId` effect 바로 앞(두 effect가 6.5의 글자 그대로 붙는다) | 65 · 80 |
| `changedBelow`(7.3) | :1279 다음 | 82 |
| 접은 줄의 점 식(7.3) | :1314, 앵커 58의 식 바로 뒤 | 58(그대로) · 82 |
| '편집 시작'의 `disabled`(6.1) | :1321 | 58(일부러 — 9.2) |
| 안내 ×의 `onClick`(6.4) | :1324 | 52(수 8) · 54(그대로) |
| 띠의 줄(8.2) | :1325 | 57 · 52·53·54(이 줄로는 그대로) |
| '＋ 공간 그리기'의 `disabled`(6.1) | :1516 | 80 |
| 선택 창의 줄(8.4) | :1536 다음, :1537 앞 | 66·77(그대로) · 81 |

**한 글자도 고치지 않는 본문**: `persistMaps`·`requestSave`·`endEditing`·`leaveEditing`·`confirmAction`·`linkMap`·`saveSettings`·`uploadUnderlay`·`linkAddedImages`·삭제 창의 넷·`navigate`·`followSaved`와 그 effect·`onSaveKey`·`keyboard`·`swallowSecondClick`·그림 넣기 블록, 물음의 줄(:1558). 편집기에 `doc.dispatch(`·`setSavedNotice(`를 더하지 않고, `swallowSecondClick(`는 안내의 × 하나만 더한다.

**건드리지 않는 파일**: `src/features/playground/featureFlag.ts` · `types.ts`·`domain.ts`·`mapWorkflow.ts`·`DEVLOG/migrations/**` · `useBackgroundStore.ts`·`previewGateway.ts` · `mapEditSession.ts` · `BackgroundMapEditStrip.tsx` · `mapDelete.ts`·`BackgroundMapDeleteDialog.tsx` · `mapImageDrop.ts`·`useMapImageAdd.ts`·`BackgroundMapImageAdd.tsx`·`BackgroundMapGallery.tsx` · `mapViewPrefs.ts` · `BackgroundUI.tsx` · 3D 파일 · `electron/backgroundIpc.ts`·`electron/backgroundStore.ts`·`electron/rendererQuitFlush.ts` · `src/services/sceneSaveRetry.ts` · `src/App.tsx`·`src/components/layout/MainLayout.tsx`.

### 9.4 의존 방향 · 화면 묶음

- `src/shared/backgroundKeptEdits.ts` ← 메인 모듈 · mock · (타입) 신호·규칙·세션·`src/types/index.ts`
- `mapKeptSignal.ts` → `zustand`, (타입) shared. ← 점·사용자 메뉴·훅·편집기·라이브러리 화면, (타입) 세션
- `BackgroundKeptDot.tsx` → `react`, `@/stores/useAuthStore`(이미 첫 묶음 — 사이드바가 부른다), `./mapKeptSignal`. ← 사이드바
- `mapDraftKeep.ts` → (타입) `types`·shared·`mapDocument`, `domain`(`validateBackgroundEntity`), `mapDocument`(`mapDraftChanged`·`mapDraftSteps`), `mapWorkflow`(`mapSaveWasApplied`)
- `mapDraftSession.ts` → `mapDocument`·`mapDraftKeep`, (타입) `types`·shared·`mapKeptSignal`
- `useBackgroundMapDocument.ts` → `react`·`mapDocument`(타입)·`mapDraftSession`·`mapKeptSignal`·`@/stores/useAuthStore`
- `BackgroundMapKeptDialog.tsx` → `react`·`BackgroundUI`·`mapDraftKeep` / 편집기 → 새 셋 / 라이브러리 화면 → 신호·규칙·`useBackgroundMapDocument`(`mapDraftSessionOf`, 4.7)
- node로 도는 파일(`mapDraftKeep.ts`·`mapDraftSession.ts`·`mapKeptSignal.ts`·shared)은 `.ts` 확장자를 붙여 import하고 `@/`가 없다. 메인 모듈은 확장자 없이(메인 빌드의 규칙).
- **첫 묶음**: 사이드바·사용자 메뉴가 부르는 것은 신호와 점뿐이다 — 빌드 뒤 `dist/assets/index-*.js`에 `저장 안 한 도면 편집이 있어요`가 있고 리듀서의 낱말 `restore-drafts`·`rebase-drafts`·`follow-saved`가 **없다**(10.5 — 따옴표 없이 찾는다. 묶음은 그 글자를 큰따옴표로 쓴다).

---

## 10. 테스트와 검증

순수 테스트는 모두 `npm run test:background`(`node --test ./tests/background*.test.ts`)에 든다. 새 파일의 첫 줄은 `import test from 'node:test';`이고 `skip`·`todo`라는 낱말이 없다(앵커 59).

### 10.1 순수 테스트

**`tests/backgroundMapKeep.test.ts`(새)** — 바탕 라이브러리: 장소 둘(학교 > 교실), 배경 하나(시점 V), 도면 셋: '본관'(버전 2, 공간 '2층'이 아래 도면을 연다) > '2층'(버전 5, 도면의 장소 '학교', 공간 '교실'이 '교실 안'을 열고 장소 '교실'에 이어져 있다, 카메라 하나가 V를 본다) > '교실 안'(버전 1). 모든 판정은 진짜 `domain.ts`·`mapDocument.ts`·`mapWorkflow.ts`로 한다. 신호 모듈(KS)은 가짜 `window.electronAPI`와 node의 가짜 타이머로 몬다.

| # | 대상 | 확인하는 것 |
|---|---|---|
| KP-1 | `restore-drafts` | 수 3으로 되살리면 `[mapDraftChanged, mapDraftSteps, canUndoMap, dropped, past.length]`가 `[true, 3, false, 3, 0]` · 띠가 `저장 안 한 변경 3개` · 둘 더 고치면 5, 둘 되돌리면 3이고 값이 되살린 값, `canUndoMap` 거짓 · 더 새 버전의 `follow-saved`가 **같은 상태 객체**를 돌려준다 · 수 0은 `dropped` 1 · 바뀐 초안 위에는 같은 상태 객체 · 깨끗한 초안은 바뀐다 · 그 도면의 제스처·칸 묶음이 끝난다(다른 도면의 것은 남는다) · 넘긴 값을 나중에 고쳐도 저장소의 값은 그대로(`structuredClone`) · 넣을 것이 없으면 같은 상태 객체 |
| KP-2 | `mapEditStatus`의 넷째 인자 | 새 줄을 **통째로** 견준다: 바뀜+`moved` → `{ phase: 'stale', changed: true, steps: 2, detail: '다른 곳에서 먼저 저장됐어요', canSave: true, saveLabel: '도면 저장', announce: '이 도면이 다른 곳에서 먼저 저장됐어요. 도면 저장을 누르면 어떻게 할지 고를 수 있어요' }` · `gone`도 같은 꼴 · 저장 중이면 `saving` · 깨끗한 초안에 `moved`면 `clean` · `unkept`면 `changed`에 `이 PC에 보관하지 못했어요`와 그 읽어 주는 말 · 방금 저장함+바뀜+`moved`면 `stale` · 넷째 인자 없이 부른 기존 열 줄은 기존 테스트가 그대로 본다. 넷째 인자는 하나라 `moved`·`gone`과 보관 실패가 함께 오지 않는다 — 둘이 겹칠 때 `stale`이 이기는 것은 편집기가 넘기는 식 `standing !== 'current' ? standing : keptFailed ? 'unkept' : null`(8.2)이 정하고 앵커 57이 그 글자를 본다(`mapEditStatus`로는 쓸 수 없는 경우다) |
| KP-3 | `keptEntryOf` | 값을 통째로: https 밑그림은 그대로이고 `imageOmitted` 키가 없다 / `data:` 밑그림은 `imageUrl: ''`와 `imageOmitted: true` · 키가 정확히 `baseRevision`·`imageOmitted?`·`keptAt`·`steps`·`value` · `steps`가 `mapDraftSteps` — 수 3으로 되살린 초안을 한 번 고친 것이 4(`past.length`만 세면 1) · 결과가 `keptEntryProblem`을 지난다 |
| KP-4 | `planKeptRestore` | 6.2의 네 줄과: 모르는 키가 든 값 → `invalid`(파일에 그대로) · 숫자 칸에 문자열(`x: '1'`) → `invalid` · `value.id`가 다름 → `invalid` · **빈 오브젝트 이름**이 든 값 → `restore`(되살린 값의 이름은 빈 그대로) · 오브젝트 이름 161자 → `restore` · 같은 버전 같은 내용 → `equal` · **예전 버전에 적힌 같은 내용**(저장 뒤 지우기를 잃음) → `equal` · `imageOmitted`인데 라이브러리의 밑그림을 붙이면 라이브러리와 같다 → `equal`(붙이기 전에 견주면 `restore`가 된다) · 다른 버전의 다른 내용 → `restore` · 라이브러리에 없음 → `restore` · `imageOmitted` → 라이브러리의 밑그림을 붙인다 / 도면이 없으면 `''` · 바뀐 초안이 있음 → `drafted` · 깨끗한 초안이 있음 → `restore`(그 보관본과 같은 버전이든, 이 PC가 그 사이 저장해 더 새 버전이든 — 13.3) · `newest`는 `keptAt`이 가장 큰 것(목록의 차례가 아니다) |
| KP-5 | `mapDraftStanding`·`mapDraftSavedAlready` | 초안 없음 · 깨끗함(라이브러리가 더 새 버전이어도) · `baseRevision: null` → `current` · 같은 버전 → `current` · 다른 버전의 다른 내용 → `moved` · **라이브러리가 더 낮은 버전 + 다른 내용 → `moved`**(크고 작음이 아니라 같음을 본다) · **다른 버전인데 내용이 같다 → `current`**(답을 잃은 내 저장) · 라이브러리에 없음 → `gone` · 깨끗한데 라이브러리에 없음 → `current` · `mapDraftSavedAlready`는 다른 버전의 같은 내용에서만 참(깨끗한 초안·같은 버전·라이브러리에 없음·다른 내용에서 거짓). 같은 버전의 거짓은 **같은 버전에 내용도 같은 바뀐 초안**(고쳤다가 다시 고쳐 원래 값으로 — `past`가 둘)으로 본다 — 내용이 다른 초안이면 버전을 보지 않는 변형도 거짓을 내 떨어지지 않는다 |
| KP-6 | `rescueMapName` | `2층` → `2층 (내 편집)` · `'가'.repeat(160)` → 정확히 160(`.length` — `domain.ts`가 세는 UTF-16 단위)이고 ` (내 편집)`으로 끝남 · **자르는 자리에 대리 쌍이 걸리면 그 글자를 통째로 뺀다**: `'가'.repeat(152) + '😀😀'` → `'가'.repeat(152) + ' (내 편집)'`(159) · 자른 끝의 공백을 지운다(`'가'.repeat(152) + ' 나'` → `'가'.repeat(152) + ' (내 편집)'`) · 이름 앞뒤의 공백을 지운다 |
| KP-7 | `rescueMapCopy` | 통째로 한 번: 새 id·`revision: 0`·부모 그대로·하위 도면 연결 `null`·장소 그대로 · 결과를 `applyBackgroundCommand(…, { type: 'save-maps', maps: [{ entity: copy, expectedRevision: null }] }, { canManage: true })`에 넣어 **던지지 않는다**. 바탕은 저마다 그 자체로 맞는 라이브러리다 — `applyBackgroundCommand`는 결과 전체를 `validateBackgroundSnapshot`으로 보므로 바탕이 틀리면 사본이 아니라 바탕 때문에 던진다(이 줄의 예전 글자대로 짠 바탕 둘이 그랬다 — 14절의 셋째 검토): 원래 도면(2층)이 다른 곳에서 버전 6으로 저장됐을 때(그 뒤에도 원래 도면의 버전·내용이 그대로), 원래 도면과 그 부모가 지워졌을 때 — **본관 아래를 통째로**(본관·2층·교실 안) 지운 바탕에서(2층과 본관만 지우면 '교실 안'이 없는 부모에 매달린다) 부모가 `null`, 이은 장소와 시점이 지워졌을 때 — 라이브러리의 2층을 먼저 다른 곳에서 버전 6으로 저장해 도면의 '학교'·공간의 '교실'·카메라의 V를 뗀 뒤(그래서 원래 도면은 옮겨진 것이기도 하다) '학교'·'교실'과 V를 지운 바탕에서(떼지 않으면 라이브러리의 2층이 없는 장소·시점을 가리킨다) 도면과 공간의 `placeId`가 `null`, 카메라의 `viewIds`가 빈 목록, 이름이 160자에 그림 글자가 섞였을 때 · **이름을 비운 배치**가 든 값의 사본은 `/오브젝트 이름/`으로 던진다(초안이 쥘 수 있는 값이라 사본도 그대로 싣는다 — 8.5의 표, 창 안의 그 문장과 '아무것도 바뀌지 않음'은 10.3 T11b) |
| KP-8 | 세션(가짜 타이머·가짜 신호·가짜 `put`) | **첫 편집 직후**(타이머가 돌기 전) 신호의 `changed`에 그 도면(P3 — 같은 틱) · **K2의 수**: 100ms 간격으로 세 번 고침 → 0번, 300ms 더 → 정확히 1번(`steps` 3) · 그때 신호의 `changed`가 그 도면 하나 · **120ms마다 열 번 고침 → 마지막 편집 때까지 3번**(0.3초마다 — 다시 거는 뒤끝이면 0번), 그 0.3초 뒤 4번째가 열 번째 값(`steps` 10) · **세 번 고쳐 한 번 쓴 뒤**(바뀐 초안) 제스처 시작 + 미리보기 열 번(사이마다 500ms) → 쓰기 그대로 1번, 놓은 뒤 300ms → 2번이고 값이 놓은 값 · 타이머가 끌기 도중에 울리면 끌기를 시작한 값을 쓴다 · 저장(`rebase-drafts`) → 곧바로 지우기 하나, 그 뒤 1초에 쓰기 0번, 신호의 `changed`·`kept`가 빈 목록 · 쓰지 않은 초안을 버리면 0번 · 목록 전(`loading`)에는 900ms에 0번, `ready`로 바꾼 뒤 300ms에 1번 · **`unavailable`이면 1초 뒤에도 0번이고 그 도면이 `failed`에**, `ready`로 바꾸면 0.3초 안에 1번이고 `failed`가 빈다 · **`unavailable` → 고침 → 0.4초 → 저장(깨끗)** → `failed`가 곧바로 비고 1초 뒤에도 비어 있으며 걸린 타이머가 없다(P6 — `drop`이 `owned`보다 먼저 비운다) · **쓰기가 오가는 사이 깨끗해짐**: 답을 미뤄 둔 가짜 `put` → 고친 지 0.3초에 쓰기가 나감 → 답이 오기 전에 되돌려 깨끗 → 지우기가 정확히 하나, 그 쓰기 바로 뒤에 나간다(P5 — 보내는 순간 `owned`) · 쓰기가 실패하면 신호의 `failed`에 그 도면, `flush()`가 다시 보내 성공하면 빈 목록 · **실패한 도면을 저장(깨끗)하거나 버리면 `failed`가 곧바로 빈다** · **쓰기가 오가는 사이 저장(깨끗)한 뒤 그 쓰기가 거절됨**(답을 미뤄 둔 가짜 `put`) → `failed`가 빈 채이고 그 도면을 다시 고친 직후에도 없다(P8) · **`flush()`는 그 전에 보내 아직 답이 없는 쓰기도 기다린다**: 답을 미뤄 둔 가짜 `put`으로 쓰기 하나가 나간 뒤 `flush()` → 그 답을 풀기 전에는 `flush`의 약속이 끝나지 않는다(P9) · **지우기 거절 → 다시 고침 → 쓰기 받아들여짐 → `flush()` → 그 도면의 지우기 0번**(가짜 파일에 새 항목이 남는다) · **지우기 거절(초안 없음) → 다른 도면의 쓰기 → 그 지우기가 함께 다시 나간다** · **고친 뒤 0.3초 안에 `dispose()` → 1초 뒤에도 0번이고, `dispose()` 바로 뒤 가짜 타이머에 걸린 것이 0개**(`fire`·`send`가 따로 `disposed`를 봐도 '타이머를 두고 감'이 떨어지게), 그 뒤 고쳐도 0번 · **되살리기**: 목록(되살릴 것 A, 같은 내용 B, 도면 값 안에 모르는 키가 든 C) → `catchUp`이 `{ count: 1, mapId: A }`, 두 번째는 `null`, 보낸 것은 B의 지우기 하나뿐(1초 뒤에도 쓰기 0번), 신호의 `kept`가 A와 C, 그 뒤 A를 버리면 A의 지우기 · **C를 '편집 시작'으로 열었다 끝내도**(깨끗한 초안이 생겼다 없어짐) C는 끝까지 아무 호출도 받지 않는다 · 목록 `unavailable`이면 `catchUp`이 `null`이고 호출 0번, 그 뒤 `ready`로 바꾸면 다음 `catchUp`이 되살린다 · **답을 잃은 저장**: 바뀐 초안 A(버전 5, 한 번 쓰임)와 라이브러리 A(버전 6, 같은 내용) → `catchUp` → 초안이 깨끗(버전 6), A의 지우기 하나, `changed`가 빈 목록 / 내용이 다르면 아무 일 없음 · **`discardAll()`**(4.7): 되살린 A·이번에 쓴 D·쓰지 않은 E(0.3초 안)의 초안이 모두 없어지고, 지우기는 A와 D에 하나씩(E는 없음), 1초 뒤에도 쓰기 0번, `changed`가 빈 목록, 그 뒤 `catchUp`이 되살리지 않는다 · 빈 id의 세션은 고쳐도 0번 |
| KS | `mapKeptSignal.ts`(가짜 `window.electronAPI`·가짜 타이머) | `primeKeptMapEdits('1')` → `loading`, 목록이 오면 `ready`·`listed`·`kept` · 같은 계정의 두 번째 prime은 부르지 않는다(셈) · 목록이 거절 → `unavailable`과 콘솔 한 줄 · API가 없으면 곧바로 `unavailable` · 5초 안에 답이 없으면 `unavailable`이고, 그 뒤 온 같은 부름의 답은 `ready`로 받는다 · **prime('1') → 3초 → release('1') → prime('1') → 2.1초 → 아직 `loading`**(앞 부름의 타이머가 둘째를 끊지 않는다), 둘째의 5초에 `unavailable` · `unavailable`에서 다시 prime → `loading`이고 `kept`·`changed`·`failed`는 그대로 · prime('1') → release('1') → prime('1') 뒤에 첫 부름의 답(거절)이 와도 둘째의 `ready`가 남는다 · 다른 계정의 prime 뒤 '1'의 늦은 답은 버린다 · release는 그 계정일 때만 `IDLE` · `flushKeptMapEditsBeforeLogout(3000)`: 걸린 것이 없으면 곧바로, 걸린 함수가 끝나지 않으면 3초에, 그 함수가 거절하거나 던지면 곧바로 — 셋 다 던지지 않는다 · `keptMapEditCount`(합집합)·`keptMapEditsStored`(`kept`에서 `failed`를 뺀 수) |

**`tests/backgroundKeptEdits.test.ts`(새)** — 메인 모듈은 `tests/backgroundPersistence.test.ts`의 `load()`(esbuild로 묶어 `data:` URL로 import)로, mock은 `tests/backgroundImageFile.test.ts:118-141`의 꼴(가짜 `window`·`localStorage`로 묶어 돌리고 `loginCanonicalSession({ name: '배한솔', password: '1234', rememberMe: false })`)로 부른다. 메인 쪽은 **임시 폴더**(`mkdtempSync(join(tmpdir(), 'bflow-kept-'))`, `finally`에서 지운다)만 쓴다.

| # | 대상 | 확인하는 것 |
|---|---|---|
| KE-1 | 공용 모듈 | `keptEntryProblem`: 맞는 항목 → `null` · 모르는 키(`token`) · `value.id` 다름 · 음수 `steps` · 문자열 `baseRevision` · `imageOmitted: false` · UUID가 아닌 `mapId` → `shape` · 4,000,001자 → `size` · `keptEntriesOf`가 나쁜 것만 빼고 남은 것을 그대로 · `keptEditsFileName`: 소문자 UUID와 `'1'`은 그대로, `'a.b'` → `background-map-kept.=612e62.json`, `'../x'` → `…=2e2e2f78.json`, `'A'` → `…=41.json`이고 `'a'` → `…a.json`(대문자는 늘 바꾼다 — 크고 작은 글자만 다른 두 id가 한 파일을 쓰지 않는다) |
| KE-2 | 저장소(임시 폴더) | 넣고 읽기 · **두 계정이 두 파일**이고 서로 보이지 않는다 · 폴더에 `.tmp`가 남지 않는다 · 파일이 한 줄 JSON `{"version":1,"entries":{…}}` · 기다리지 않고 보낸 넣기 → 지우기 → 마지막에 없음 / 지우기 → 넣기 → 마지막에 있음 · 없는 키 지우기는 파일을 쓰지 않는다(수정 시각 그대로) · 마지막 항목을 지우면 `{"version":1,"entries":{}}` · 깨진 JSON → 읽기가 `{}`, `.broken-`이 생기고 다음 넣기가 새 파일을 쓴다 · **고정 시계**(`() => 1700000000000`)로 깨짐 → 읽기 → 넣기 → 깨짐 → 읽기 → `.broken-1700000000000-1`과 `-2` 둘(같은 ms의 둘째가 첫째를 덮지 않는다) · `version: 2` → `list`·`put` 모두 `/업데이트/`로 거절, 파일 글자 그대로 · 파일 자리에 폴더(`EISDIR`) → 거절(빈 것으로 읽지 않는다, `readFile`은 한 번) · **잠김**(진짜 파일 함수를 감싼 가짜 `files`): `readFile`이 `EBUSY`를 한 번 던지고 그다음 성공 → `list`가 받는다(`readFile` 두 번) / `EACCES`·`EPERM`·`EBUSY`를 늘 던지면 세 번 해 본 뒤 `list`·`put` 모두 그 오류로 거절하고 `open`·`rename`을 부르지 않는다 / `rename`이 `EPERM`을 한 번 → `put`이 성공하고 파일에 있다 / 깨진 JSON인데 그것을 옮기는 `rename`이 늘 `EPERM` → 그 `rename` 세 번 뒤 `list`·`put` 모두 그 오류로 거절, 깨진 파일의 글자 그대로, `.broken-`도 `open`도 없음 · **쓰는 차례**(가짜 `files`가 부른 것을 적는다): `open(…tmp, 'w')` → `writeFile` → `sync` → `close` → `rename(…tmp, …json)` / `sync`가 던지면 `close`는 하고 `rename`은 없으며 `put`이 거절된다 · 100개째까지 받고 101번째 새 키는 `/100개/`, 있던 키를 바꾸는 것은 된다 · 4,000,001자 → `/너무 커요/` · `token` 키 → `/모양/` · `flush()`가 도는 쓰기를 기다린다(넣기를 부르고 기다리지 않은 채 `flush` → 파일에 있다) |
| KE-3 | 채널(가짜 `ipc`·가짜 세션) | 두 핸들러의 이름 · 낡은 epoch → `/세션/`으로 거절하고 저장소를 부르지 않는다(셈) · 계정은 세션의 것이다(세션을 '1'에서 '2'로 바꾸면 '2'의 빈 목록) · `list`가 읽는 사이 세션이 바뀌면(느린 가짜 `store.list`) `/보관 목록 응답/`으로 거절 · `put` 핸들러는 저장소를 기다림 없이 부른다(두 `put`을 연달아 부르면 저장소가 받은 차례가 보낸 차례) |
| KE-4 | mock의 거울 | 로그인 전 → `/로그인/` · 넣고 읽기가 키 `bflow:preview:background-map-kept:1`에 `{ version: 1, entries }`로 · 다른 계정은 다른 키 · 101번째 → 거절 · `setItem`이 던지는 가짜 저장소(한도) → `put`이 거절 · `version: 2` → `list` 거절 |
| KE-5 | 끄기 직전(`finishKeptEditsBeforeExit`, 가짜 `ipc`·임시 폴더·`rename`을 50ms 늦추는 가짜 `files`) | 창의 답(`rendererFlush`)은 이미 왔는데(시간 초과) 넣기 하나가 아직 쓰이는 중 → 그 함수가 끝난 뒤 부른 가짜 `exit` 때 파일에 그 항목이 있고 `.tmp`가 없다 · 창의 답이 20ms 뒤에 오고 그 사이 넣기가 도착 → 같다 · `rename`이 끝나지 않으면 `maxMs`(100)에 끝난다 · 창의 답이 거절돼도 던지지 않는다 |

**고치는 파일**: `tests/backgroundMapEditorWiring.test.ts`(9.2) · `tests/motion/fx3-retry-session.test.ts`(9.2). 기존 `tests/backgroundMapDocument.test.ts`·`tests/backgroundMapEditStatus.test.ts`는 고치지 않고 지난다(사본에서 확인).

### 10.2 뮤테이션

저장소 밖 임시 복사본에서 하나씩 넣어 **떨어지는지** 본다. 9.2의 변형 전부와, 살아남기 쉬운 것 — 반드시: (1) `restoreDrafts`의 `Math.max(1, …)`를 뺌(수 0이 깨끗하게 읽힌다, KP-1) (2) 바뀐 초안 위에도 되살림(KP-1) (3) `mapDraftStanding`이 깨끗한 초안에도 `moved` · 버전을 `>`로 견줌 · 같은 내용 규칙을 뺌 / `mapDraftSavedAlready`가 버전을 보지 않음(KP-5) (4) `planKeptRestore`가 검사를 건너뜀 · 이름까지 검사함(빈 이름의 초안을 버린다) · 이름 밖까지 건너뜀(모르는 키를 되살린다) · `equal`을 건너뜀 · 밑그림을 붙이기 전에 견줌 · 밑그림을 붙이지 않음 · `newest`를 목록의 차례로(KP-4) (5) `rescueMapCopy`가 `childMapId`를 남김 · 없어진 장소를 남김(공간의 것, 도면의 것 따로) · 없어진 시점을 남김 · 없어진 부모를 남김(모두 KP-7의 `applyBackgroundCommand`가 던진다) (6) `rescueMapName`이 글자 수(`Array.from`)로 자름(그림 글자가 섞이면 160을 넘는다) · `slice`로 대리 쌍을 가름 · 끝 공백을 남김(KP-6, KP-7의 마지막 줄) (7) `keptEntryOf`가 `data:` 밑그림을 그대로 씀 · `steps`를 `past.length`로(KP-3) (8) 세션 — P1을 뺌 · P3을 타이머 뒤로(점이 0.3초 늦게 켜진다) · 바뀔 때마다 타이머를 다시 걺 · `owned`를 보지 않음 · `owned`에 답을 받은 뒤에야 넣음(쓰기가 오가는 사이 되돌린 초안의 지우기가 나가지 않는다) · `drop`이 `owned`를 먼저 봄(보내지 못한 도면의 타이머·`failed`가 남는다) · 되살리기가 목록의 모든 id를 `owned`에 넣음 · 목록 전·읽지 못한 동안에도 씀 · 읽지 못한 동안 `failed`에 넣지 않음 · 미리보기 값을 씀 · 되살리기가 건 타이머를 풀지 않음 · `flush`가 실패한 것을 다시 보내지 않음 · 거절된 지우기를 `flush`에서만 다시 보냄 · `dispose`가 타이머를 두고 감 · 성공해도 `failed`를 비우지 않음 · 깨끗해져도 `failed`를 비우지 않음 · 늦게 온 쓰기 거절이 깨끗해진 도면을 `failed`에 넣음 · `flush`가 제가 보낸 것만 기다림 · `unavailable`에서 되살리기를 끝난 것으로 침 · 답을 잃은 저장을 다시 놓지 않음 · `discardAll`이 보이는 도면의 초안만 버림(KP-8). 거절된 지우기를 그 도면의 쓰기 뒤에도 `unremoved`에 두는 것은 같은 결과라 넣지 않는다(다시 보내는 것은 그 도면에 바뀐 초안이 없을 때뿐이고, 그때의 지우기는 P6이 어차피 보낸다) (9) 저장소 — 모든 읽기 오류를 빈 것으로 · 버전 검사를 뺌 · 깨진 파일을 덮어씀(`.broken-` 없음) · 깨진 파일을 옮기지 못해도 빈 문서로 읽음 · 깨진 파일을 옮길 때 잠김을 다시 해 보지 않음 · 깨진 파일을 늘 같은 이름으로 옮김 · 이름에서 번호를 뺌(고정 시계에서 둘째가 첫째를 덮는다) · `sync`를 뺌 · `sync`를 `rename` 뒤로 · `sync`가 실패해도 이름을 바꿈 · 잠김을 다시 해 보지 않음 · 잠김을 세 번 넘게 해 봄 · 잠김이 아닌 오류(`EISDIR`)도 다시 해 봄 · 100개 검사를 `>`로 · 크기 검사를 뺌 · 모르는 키를 받음 · 프로미스 사슬 없이 함(넣기·지우기의 차례가 깨진다)(KE-2) · `finishKeptEditsBeforeExit`가 창의 답을 기다리지 않음 · 사슬을 기다리지 않음 · 창의 답의 거절을 다시 던짐(KE-5) (10) 채널 — epoch를 보지 않음 · `list`의 뒤 검사를 뺌(KE-3) (11) 파일 이름의 허용 글자에 `.`을 더함(`'../x'`가 폴더 밖) · 대문자를 그대로 둠(KE-1) (12) mock이 한도를 보지 않음 · `setItem`의 오류를 삼킴(KE-4) (13) 편집기가 넘기는 넷째 인자의 식이 보관 실패를 선 자리보다 앞에 둠(`keptFailed ? 'unkept' : standing !== 'current' ? standing : null` — 앵커 57이 떨어뜨린다. `mapEditStatus` 안의 가지 차례를 바꾸는 변형은 넷째 인자가 하나라 늘 같은 결과를 내므로 넣지 않는다) (14) 신호 — prime의 `catch`를 뺌(`loading`에 머물러 '편집 시작'이 흐린 채다) · 시간 초과를 뺌 · 부름 번호를 보지 않음(앞 부름의 늦은 답이 덮는다) · 시간 초과가 부름 번호를 보지 않음(앞 부름의 타이머가 다시 로그인한 둘째를 끊는다) · `unavailable`에서 다시 읽지 않음 · 다시 읽을 때 세션의 표시를 비움 · release가 다른 계정도 비움 · 로그아웃 정리가 기다림 없이 걸린 함수만 기다림 · 걸린 함수의 오류를 다시 던짐(KS).

### 10.3 수동 검증 — 검사 창 (앱 엔진: Electron 33)

방법은 3차 10.3과 같다: `npm run dev:renderer` + 검사 창(`http://127.0.0.1:5190/?preview=1`, 미리보기 시험 계정 배한솔), 창 **1440×900**과 **740×900**, 어두운·밝은 화면. 모든 줄을 1440×900 어두운 화면에서 보고 ★는 나머지 세 조합에서 다시 본다.

**지킬 것(넘지 않는 선)**: ① 설치된 앱(`dist\win-unpacked\BFLOW.exe`)과 설치 파일을 띄우지 않는다 ② 진짜 `%APPDATA%\Bflow-BGonly`를 읽거나 쓰지 않는다 — 검사 창은 자기 폴더를 쓰고 보관은 mock의 `localStorage` 거울로만 돈다 ③ 시스템 클립보드를 쓰지 않는다 ④ 메인 쪽 코드(파일·채널·before-quit)는 여기서 돌지 않는다 — 10.1의 KE와 10.5의 빌드 묶음 검사가 맡는다.

**흉내** — 검사 도구가 페이지에서 부른다:

```js
// 종료 흉내: dom-ready마다(새로 고친 뒤에도) 정리 통로를 잡아 둔다. mock의 noop은 그대로이고, 이 페이지에서만 감싼다.
(() => { const api = window.electronAPI, kept = []; api.onBeforeQuitFlush = callback => { kept.push(callback); return () => {}; }; window.__quit = () => Promise.allSettled(kept.map(run => run())); })();
// 보관 거울 읽기
const keptOf = () => JSON.parse(localStorage.getItem('bflow:preview:background-map-kept:1') ?? '{"version":1,"entries":{}}');
// 다른 PC가 저장 / 지움: 미리보기 저장소에 쓰고 변경 신호를 보낸다(편집기의 저장소를 거치지 않는다)
const other = async (mapId, change) => { const lib = await window.electronAPI.backgroundRead(), map = lib.maps.find(item => item.id === mapId);
  return window.electronAPI.backgroundExecute({ requestId: crypto.randomUUID(), command: change === 'delete' ? { type: 'delete', kind: 'map', id: mapId, expectedRevision: map.revision }
    : { type: 'save-maps', maps: [{ entity: { ...map, name: `${map.name} 다른 PC` }, expectedRevision: map.revision }] } }); };
// 신호 없이 버전만 올림(T9 — 이 PC가 아직 읽지 못한 저장)
const silently = mapId => { const key = 'bflow-background-library-preview-v1', all = JSON.parse(localStorage.getItem(key)), map = all.snapshot.maps.find(item => item.id === mapId);
  map.revision += 1; map.name += ' 몰래'; localStorage.setItem(key, JSON.stringify(all)); };
// 미리보기 저장소를 직접 고치고 변경 신호를 보낸다(누르지 않고 일어나는 일 — 같은 페이지의 다른 BroadcastChannel 객체도 받는다)
const edit = change => { const key = 'bflow-background-library-preview-v1', all = JSON.parse(localStorage.getItem(key)); change(all.snapshot); localStorage.setItem(key, JSON.stringify(all));
  const channel = new BroadcastChannel('bflow-background-library-changed'); channel.postMessage({ changed: true }); channel.close(); };
// 누르지 않고 화면이 바뀜(K3·K3b·K4): 첫 도면에 모르는 키를 넣으면(true) 업데이트 필요 안내가 커서가 칸에 있는 채로 편집기를 내리고, 빼면(false) 다시 그린다
const needUpdate = on => edit(snapshot => { if (on) snapshot.maps[0].newer = 1; else delete snapshot.maps[0].newer; });
// 보관 거절(F1·F2): 거울 키의 setItem만 한도 오류로 던진다(mock의 진짜 거절 길 — 저장소를 채우면 남는 틈에 작은 거울이 들어가고, 미리보기 라이브러리의 쓰기까지 막힌다). 돌려준 함수로 푼다. 프로토타입에 건다 — Storage는 `localStorage.setItem = …`을 항목으로 저장한다
const refuseKept = () => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (String(key).startsWith('bflow:preview:background-map-kept:')) throw new DOMException('흉내', 'QuotaExceededError'); return real.call(this, key, value); }; return () => { Storage.prototype.setItem = real; }; };
// 편집기를 깨뜨림(G1): 되살리기가 값을 복사하는 순간(restore-drafts의 structuredClone) 던진다. 돌려준 함수로 푼다
const breakClone = () => { const real = window.structuredClone; window.structuredClone = () => { throw new Error('편집기 깨짐 흉내'); }; return () => { window.structuredClone = real; }; };
// 첫 읽기 실패(R2) · 늦게 오는 보관 목록(R3) — 새로 고친 직후, 로그인·배경 열기 전에 건다
const failFirstRead = () => { const api = window.electronAPI, real = api.backgroundRead.bind(api); let left = 1; api.backgroundRead = async () => { if (left-- > 0) throw new Error('읽기 실패 흉내'); return real(); }; };
const slowList = ms => { const api = window.electronAPI, real = api.backgroundKeptList.bind(api); api.backgroundKeptList = async () => { await new Promise(done => setTimeout(done, ms)); return real(); }; };
// 다음 저장 하나를 거절(T11) — 1차 설계 7.6의 '끊김 넣기'와 같은 꼴, 설치된 앱의 껍데기를 붙여서
const refuseNext = () => { const api = window.electronAPI, real = api.backgroundExecute.bind(api); let left = 1; api.backgroundExecute = async request => { if (left-- > 0) throw new Error("Error invoking remote method 'background:execute': Error: 저장하지 못했어요(흉내)."); return real(request); }; };
// 저장은 곧바로 되고 답만 늦게 온다(K1e — 답이 오기 전에 떠나기)
const slowSave = ms => { const api = window.electronAPI, real = api.backgroundExecute.bind(api); api.backgroundExecute = async request => { const reply = await real(request); await new Promise(done => setTimeout(done, ms)); return reply; }; };
```

- **재시작** = 페이지 새로 고침(세션과 초안이 사라지고 거울만 남는다). **종료** = `await __quit()` 뒤 새로 고침. **강제 종료** = 마지막 편집 뒤 0.3초 안에 새로 고침. 새로 고친 뒤 로그인이 필요하면 미리보기 시험 계정으로 들어간다.
- 지울 수 있는 도면이 필요하면(T7·T10) 먼저 '＋ 새 도면'으로 최상위 도면 Z를 만든다 — 미리보기의 처음 도면은 모두 위 도면의 공간이 열거나 하위 도면이 있어 삭제 명령이 연결 검사에 걸린다(previewGateway.ts:28, domain.ts:127·131).
- 띠의 글자 폭: `const fits = () => { const span = document.querySelector('.bmap-edit-state>span'); return span.scrollWidth <= span.clientWidth; };` · 자리: `document.querySelector('.bmap-edit-key').getBoundingClientRect().x`와 두 버튼의 `x`·띠의 `height`를 '저장 안 한 변경 3개'일 때와 견준다.
- 띠의 상태는 `data-phase`로 읽는다. 자기 저장의 깜빡임(T8)은 저장 전에 `new MutationObserver(r => r.forEach(m => seen.add(m.target.dataset.phase))).observe(strip, { attributes: true, attributeFilter: ['data-phase'] })`로 모은다.

| # | 하는 일 (흉내) | 봐야 할 것 |
|---|---|---|
| K1 ★ | 도면 X에서 편집 시작 → 공간 셋을 옮김(평면) → 줌·선택을 바꿈 → 사이드바 '씬' → 다시 '배경' | X가 보이고 편집 중, 띠 `저장 안 한 변경 3개`, 되돌리기 켜짐(Ctrl+Z 한 번에 2), 선택·줌 그대로, 평면. 아무것도 묻지 않는다. 거울에 X 하나 |
| K1b ★ | X를 고쳐 '도면 저장'(띠 `저장된 그대로예요`, 편집 중) → '씬' → '배경' | X가 편집 중 그대로, 띠 `저장된 그대로예요`(빈 저장소에 대고 올라오는 한 번이 없어 깨끗한 초안이 지워지지 않는다). 배경에 들어올 때 첫 틀이 '불러오고 있습니다'이고 빈 도면 화면이 비치지 않는다 |
| K1c | Y를 고쳐 둔 채 X를 보기만 함(초안 없음) → '씬' → '배경' | X가 보인다(보기 모드) — Y로 바뀌지 않는다 |
| K1d | X를 세 번 고치고 세 번 되돌림(띠 `저장된 그대로예요`, 다시 실행 켜짐) → '씬' → '배경' | 편집 중 그대로, Ctrl+Y가 세 번 다시 한다 |
| K1e ★ | `slowSave(2000)` → X를 고쳐 '도면 저장' → '저장 중…'인 동안 사이드바 '씬'(사이드바의 '배경' 점이 켜져 있다) → 3초 뒤 '배경' | 띠 `저장된 그대로예요`(편집 중), `!다른 곳에서 …`가 한 번도 없다(MutationObserver), '도면 저장'을 눌러도 창이 뜨지 않는다(바뀐 것 없음), 거울에 X 없음, 점이 꺼진다. 미리보기 저장소의 영수증은 하나. **`stale`이 없다는 것과 창이 뜨지 않는다는 것은 선 자리와 선택 창이 있는 코드에서야 뜻이 있다** — 게이트 K(4단계)에서는 저절로 지나므로 게이트 S가 5단계의 코드로 이 줄 전체를 다시 본다(12절) |
| K2 | 평면에서 공간을 끄는 도중(검사 도구의 진짜 입력으로 누른 채 옮김) 사이드바의 다른 메뉴 단축키(Ctrl+숫자)로 떠났다 돌아옴 · 3D로 본 채 떠났다 돌아옴 | 끌기가 취소돼 그 공간이 시작 자리이고 거울의 X 값도 시작 자리 · 평면으로 돌아와 있다 |
| K3 | 속성의 '가로 위치'에 `150`을 친 채(커서는 칸에) `needUpdate(true)` → 안내 → `needUpdate(false)` → 같은 칸에 `200`을 치고 Enter → Ctrl+Z 한 번 | 150으로 돌아간다(200만 되돌린다 — 내릴 때의 정리가 칸 묶음을 끝냈다. 눌러서 떠나면 칸의 `blur`가 먼저 끝내므로 이 정리를 보지 못한다) |
| K3b | 공간을 고르고 속성의 '가로 길이'에 `1`만 친 채(150으로 가는 길) 사이드바 '씬'을 누름 → '배경' / 같은 것을 `needUpdate(true)` → `needUpdate(false)`로(누르지 않고) / 칸에 커서를 둔 채 Ctrl+2 | 누름: 가로 길이가 10(가장 가까운 끝값)이고 되돌리기 한 번에 원래 값 — 칸을 떠날 때와 같다 / 누르지 않음: 가로 길이가 그대로('1'은 버려진다) / Ctrl+2: 화면이 바뀌지 않는다(지금 그대로). 평면의 이름 상자(F2)에 친 글자도 누름으로 떠나면 들어가고, 누르지 않고 떠나면 버려진다 |
| K4 | 업데이트 필요 흉내: `needUpdate(true)` → 안내 → `needUpdate(false)` | 안내에 `이 PC에 저장 안 한 편집이 있는 도면 1개가 그대로 보관돼 있어요. …` · 탭이 없고 사이드바 점은 있다 · 안내가 걷히면 돌아온 편집기에 초안이 그대로 |
| K5 | 도면 X·Y를 고침(X 2단계, 0.5초 뒤 Y 1단계) → `__quit()` → 새로 고침 → 로그인 → 배경 | **Y**가 편집 중으로 보이고 띠 `저장 안 한 변경 1개`, 안내 `지난번에 저장하지 않은 편집이 있던 도면 2개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요.`, 되돌리기·다시 실행 꺼짐, 목록의 X·Y에 점. 첫 그림에 다른 도면이 비치지 않는다(새로 고침 직후 프레임을 찍는다) · 안내의 ×를 빨리 두 번 눌러도 안내만 닫힌다(저장도 창도 없다 — 영수증 그대로) · X를 열면 `저장 안 한 변경 2개` · Y를 둘 더 고치면 3, 둘 되돌리면 1에서 멈춤 |
| K6 | 고친 직후(0.3초 안) 새로 고침 / 120ms마다 열 번 고친 직후 새로 고침 | 그 마지막 편집만 빠지고 앞의 것은 돌아온다 / 마지막 0.3초 안쪽만 빠지고 그 앞은 돌아온다(이어 고치는 동안에도 쓰였다) |
| K7 | 되살린 Y에서 '편집 끝내기' → '버리고 끝내기' / 되살린 X를 '도면 저장' | Y의 거울 항목이 곧바로 없어진다 / X는 '도면을 저장했어요', 거울 항목 없음. 마지막 하나가 없어지면 사이드바·탭의 점이 꺼진다 |
| K8 | 고친 직후 사용자 메뉴의 '로그아웃'(0.3초 안) → 다시 로그인 → 배경 | 그 편집까지 돌아온다(로그아웃이 마저 썼다) |
| R1 | 거울에 손으로 넣은 항목 셋: 라이브러리와 내용이 같은 것, 도면 값 안에 모르는 키가 든 것, 라이브러리에 없는 도면의 것 → 새로 고침 | 같은 것은 거울에서 없어지고, 모르는 키는 그대로 남고(콘솔 한 줄, 화면에 없음), 없는 도면은 목록에 편집 중으로 생기고 띠 `다른 곳에서 지워졌어요`(띠의 이 글자는 5단계의 선 자리와 띠의 줄이 있어야 나온다 — 게이트 K에서는 `저장 안 한 변경 N개`이고, 게이트 S가 다시 본다, 12절) |
| R1b | 공간 하나의 속성 이름 칸을 비움(저장하지 않음) → `__quit()` → 새로 고침 → 로그인 → 배경 | 그 도면이 편집 중으로 돌아오고 그 이름 칸이 비어 있다(되살린다), 안내가 뜬다. '도면 저장'은 지금처럼 이름 문장으로 거절된다 |
| R2 | 되살릴 것이 있는 채 새로 고침 → `failFirstRead()` → 로그인 → 배경 → 15초 기다림 | 실패한 동안(붉은 줄, 편집 버튼 없음) 되살리지 않고 거울도 그대로. 읽기가 성공한 그 렌더에 되살리고 알림이 뜬다 |
| R3 | 되살릴 것이 있는 채 새로 고침 → `slowList(3000)` → 로그인 → 곧바로 배경 → '편집 시작'을 눌러 봄 → '도면 설정' 창을 열어 둔 채 목록을 기다림 → 창을 닫음 | '편집 시작'과 '＋ 공간 그리기'가 흐리다(목록 전 — 눌러도 아무 일 없다) · 창이 열린 동안 되살리지 않는다 · 닫는 그 렌더에 되살린다 |
| R4 | 되살릴 것(A)이 있는 채 새로 고침 → `slowList(7000)` → 로그인 → 곧바로 배경 | 5초 동안 '편집 시작'이 흐리다가 그 뒤 켜진다 · 그때 B(보관본 없는 도면)를 고치면 띠 `이 PC에 보관하지 못했어요`, 거울에 B 없음 · 7초에 목록이 오면 A가 되살아나고 알림이 뜨며, 0.3초 안에 B가 거울에 들어가고 띠가 `저장 안 한 변경 N개`로 돌아온다(띠의 두 글자는 5단계의 `keptFailed`와 띠의 줄이 있어야 바뀐다 — 게이트 K에서는 띠가 늘 `저장 안 한 변경 N개`이고, 게이트 S가 다시 본다, 12절) |
| D1 ★ | 사이드바 접힘·펼침·배경을 보는 중·다른 메뉴, 어두운·밝은 화면 | 배경 아이콘 오른쪽 위의 강조색 점(캘린더 점과 같은 크기·자리 — 둘의 `getBoundingClientRect()`를 견준다)과 그 바깥 1px의 글자 보조색 테두리(`getComputedStyle(dot).boxShadow`), 수 없음, `getAnimations().length` 0. `title`과 숨은 글자가 `저장 안 한 도면 편집이 있어요`. 테두리와 바탕의 대비는 themes.ts의 여섯 테마 × 두 밝기로 계산해 모두 3:1 이상인지 본다(설계 때 계산: 가장 낮은 것 5.15:1) — 검사 창에서는 기본 테마의 계산된 색으로 그 계산이 맞는지 한 번 확인한다 |
| D2 ★ | 도면 탐색 탭 — 도면 탐색을 보는 중과 다른 탭을 보는 중, 1440과 740 | 글자 뒤 위쪽의 점(테두리 포함), 탭의 폭이 점이 없을 때와 같다(`getBoundingClientRect().width`), 점이 글자 칸과 겹치지 않는다(740·다른 탭 — 여백 10px), 점에 풍선이 없고 숨은 글자는 있다 |
| D3 | 부모를 접은 채 아래 도면을 고침 | 접은 줄에 점, 풍선 `접어 둔 하위 도면에 저장 안 한 변경이 있어요`. 펼치면 그 줄의 점은 없고 아래 줄에 점 |
| D4 | '움직임: 최소'와 OS 동작 줄이기 | 세 점이 그대로 보인다 |
| T1 ★ | X를 고친 채 `other(X)` | 다음 렌더에 띠 `!다른 곳에서 먼저 저장됐어요`(테두리 알약), 읽어 주는 영역에 그 문장, 창은 뜨지 않는다. 편집은 계속된다 |
| T2 ★ | T1 뒤 '도면 저장' / Ctrl+S | 아무것도 보내지 않고(미리보기 저장소의 영수증 수 그대로) 창 `다른 곳에서 이 도면이 먼저 저장됐어요`, 포커스 '돌아가기' |
| T3 | 창에서 Esc / X / 돌아가기 / 포커스된 '돌아가기'에 Enter / Tab을 끝까지 돌려 포커스가 빠진 순간 Ctrl+S·Delete·Space·→ / Esc 두 번 빨리 | 앞의 넷은 창만 닫히고 초안·띠 그대로 / 다섯째는 뒤에서 아무 일도 없다 / 여섯째는 창이 닫힌다(한 번의 돌아가기) |
| T4 | 도면 저장 버튼에 Enter를 누른 채 1초 | 창이 뜨고 그대로 있다(되풀이가 단추를 누르지 않는다) |
| T5 | '내 편집 버리고 최신 내용 받기' | 띠 `저장된 그대로예요`, 편집 중 그대로, 도면이 다른 PC의 내용, 거울 항목 없음, 보낸 것 없음 |
| T6 | 다시 고친 뒤 `other(X)` → '내 편집을 새 도면으로 저장' | 같은 부모 아래 `X (내 편집)`이 생겨 **편집 중으로** 보이고(띠 `저장된 그대로예요`, 도구는 선택) 위 줄이 펼쳐짐 · 새 도면을 고치면 `저장 안 한 변경 1개`, '도면 저장'이 그냥 저장한다 · X는 다른 PC의 내용 그대로(버전 그대로) · X의 초안·거울 항목 없음 · 영수증이 하나 늘었다 |
| T7 ★ | 지울 수 있는 도면 Z를 고친 채 `other(Z, 'delete')` → 띠 → 저장 → 창 → (한 번) '내 편집 버리기' / (다시) '새 도면으로 저장' | 띠 `!다른 곳에서 지워졌어요`, 창 `다른 곳에서 이 도면이 지워졌어요`·`내 편집 버리기` / 버리기: Z가 목록에서 사라지고 위 도면이 보임 / 새 도면: `Z (내 편집)`이 최상위에 |
| T8 | 바뀐 X를 다섯 번 저장(사이마다 고침) | 모은 `data-phase`에 `stale`이 없다 |
| T9 | X를 고친 채 `silently(X)` → '도면 저장' | 붉은 줄 `다른 사용자가 내용을 변경했습니다. …` → 띠가 `stale`로 바뀌고 → 다음 누름이 창을 연다 |
| T10 | 지울 수 있는 도면 Z를 고친 채 `other(Z)` → '도면 저장' → 창이 열린 채 `other(Z, 'delete')`(그 사이 지워짐) | 창의 글자가 '지워짐'으로 바뀐다 |
| T11 | 창을 연 뒤 `refuseNext()` → '새 도면으로 저장' | 창 안에 `저장하지 못했어요(흉내).`(껍데기 없음), 새 도면도 없고 X의 초안·거울 항목 그대로, 단추가 다시 켜지고 포커스 '돌아가기'. 한 번 더 누르면 저장된다 |
| T11b | X의 공간 하나의 속성 이름 칸을 비운 채 `other(X)` → '도면 저장' → 창 → '새 도면으로 저장' | 창 안에 `오브젝트 이름 형식 또는 길이를 확인해 주세요.`, 새 도면도 없고 X의 초안·거울 항목·영수증 그대로 · '돌아가기' → 이름을 넣음 → '도면 저장' → 창 → '새 도면으로 저장'이 된다 |
| F1 ★ | `const allow = refuseKept()` → 듣는지 본다(`localStorage.setItem('bflow:preview:background-map-kept:probe', '')`가 던진다) → X를 고침 → 0.5초 | 띠 `이 PC에 보관하지 못했어요`(채운 알약), 읽어 주는 말 한 번. `allow()` → 한 번 더 고침 → `저장 안 한 변경 N개` · 다시 `refuseKept()` → 고침(보관 실패) → 풂 → '도면 저장' → 한 번 고침 → 0.3초 안의 띠가 `저장 안 한 변경 1개`(저장할 때 보관 실패를 잊었다 — 남아 있으면 그 0.3초 동안 `이 PC에 보관하지 못했어요`) |
| F2 | `refuseKept()` → X를 고침 → `other(X)`(미리보기 라이브러리의 쓰기는 막히지 않는다) → 띠 `!다른 곳에서 먼저 저장됐어요` → '도면 저장' | 창의 첫 문단 끝이 `이 PC에 보관하지 못한 편집이에요. 고르기 전에 앱을 끄면 사라질 수 있어요.`(보관됐다고 말하지 않는다) · 풀고 다시 고쳐 창을 열면 `고르기 전까지 이 PC의 편집은 그대로 보관돼요.` |
| G1 | 되살릴 것(A)이 있는 채 새로 고침 → `slowList(3000)` → 로그인 → 곧바로 배경(편집기가 올라옴) → 목록이 오기 전에 `const mend = breakClone()` → 목록이 옴 | 도면 탐색 탭에 `도면 화면을 그리지 못했어요. 저장하지 않은 도면 편집 때문일 수 있어요.`와 버튼 `저장하지 않은 편집을 버리고 다시 열기`, 콘솔에 `[background] map editor failed:` 줄, 머리글과 다른 탭은 그대로 쓸 수 있다(배경 화면 전체가 비지 않는다) · `mend()` → 버튼 → 편집기가 초안 없이 다시 그려지고, '씬' → '배경'을 오가도 다시 깨지지 않는다(이 흉내에서는 되살리기가 던져 A가 초안에 들지 않았으므로 거울의 A는 남는다 — 다음 로그인에 되살아난다) |
| W1 ★ | 901×900에서 사이드바를 펼친 채, 그리고 740×900에서 — `moved`·`gone`·보관 실패 | 세 글자 모두 `fits()`가 참, Ctrl+S 표와 두 버튼의 `x`가 `changed`일 때와 같다, 띠의 높이 40 / 72 |
| W2 ★ | 창의 두 글자 — 한글 이름 160자 도면, 그리고 띄어쓰기 없는 라틴 이름 160자 도면(`'A'.repeat(160)`). 만들기·설정 창의 이름 칸은 120자까지라(:1531·:1547) 최상위 도면 Z의 이름을 `edit(snapshot => { snapshot.maps.find(map => map.id === Z).name = …; })`로 직접 쓰고, Z를 고친 채 `other(Z, 'delete')`(`other(Z)`는 이름 끝에 글자를 붙여 160을 넘는다) → '도면 저장' | 문단이 줄을 바꾸고 말줄임표가 없다, 창이 옆으로 밀리지 않는다(`.bg-modal-content`의 `scrollWidth <= clientWidth`), 단추가 창 안에 |
| W3 | 내부 도면 만들기의 다시 시도 가지 | 검사 창에서 만들지 않는다(응답을 잃고 다시 읽기도 실패해야 닿는다) — 앵커 80이 그 줄의 글자를 본다 |

검사가 끝나면 거울 키를 지우고 `refuseKept`·`breakClone`을 풀고, 미리보기 저장소를 처음 상태로 돌린다.

### 10.4 배포 뒤 실기 — 한솔 PC (검사 창에서 볼 수 없다. 검증 기록의 "확인하지 못한 것"에 적는다)

한솔님이 자기 PC의 설치된 앱으로 한다 — 오케스트레이터와 구현자는 부탁하고 결과를 기록만 한다(설치된 앱·설치 파일을 띄우지 않고 진짜 `%APPDATA%\Bflow-BGonly`에 손대지 않는다).

**먼저 — 진짜 종료의 길 1~6**(이 차례가 검사 창에서 한 번도 돌리지 못한 것이다. 업데이트 내역은 이것들을 확인했다고 쓰지 않는다):

1. 도면을 고치고 곧바로(1초 안) **트레이 '종료'** → 다시 켬 → 배경: 그 편집까지 돌아오는가.
2. 다음 버전을 받아 둔 채 고치고 곧바로 **'지금 업데이트'** → 새 버전으로 켜짐 → 배경: 돌아오는가(다음 배포 때 — 이번 배포로는 받을 새 버전이 없다).
3. 고치고 곧바로 **'로그아웃'** → 같은 계정 로그인 → 배경: 돌아오는가.
4. 고치고 2초 뒤 **작업 관리자로 끔** → 다시 켬: 돌아오는가. `%APPDATA%\Bflow-BGonly\background-map-kept.fcc4b438-2696-4e88-a03f-d6f34e73e08f.json`이 한 줄 JSON으로 열리고 `.tmp`가 없는가.
5. B flow를 트레이에 둔 채 고치고 1초쯤 뒤 **Windows '다시 시작'** → 앱을 켬 → 배경: 돌아오는가(Windows는 그때 정리 신호를 주지 않는다 — 빠질 수 있는 것은 마지막 0.3초 안쪽뿐이다, 2.5).
6. **전원이 갑자기 나감** — 한솔님이 원하실 때만(다른 프로그램의 작업을 모두 저장한 뒤): 고치고 몇 초 뒤 전원 버튼을 길게 눌러 끔 → 켬 → 배경: 돌아오는가(마지막 몇 초는 빠질 수 있다), 그 파일이 한 줄 JSON으로 열리는가. 하지 않으면 검증 기록에 "전원은 보지 않았다 — 파일이 0으로 차지 않게 하는 것은 디스크까지 내린 뒤 이름을 바꾸는 쓰기(3.2)와 그 차례를 보는 KE-2뿐이다"라고 적는다(작업 관리자로 끄기는 Windows의 캐시가 살아 있어 이것을 갈음하지 못한다).

그다음: 7. 그 파일에 토큰·비밀번호·세션이 없는가(도면 값뿐), 모두 저장한 뒤 `"entries":{}`인가 · 8. **진짜 두 번째 PC**에서 같은 도면을 먼저 저장 → 15초 안에 띠, 창, 새 도면 저장이 운영 라이브러리에서 · 9. 진짜 사이드바의 점(접힘·펼침·밝은 화면) · 10. 여러 도면을 남긴 채 다시 켜 가장 나중 것이 보이는가 · 11. 설치된 앱의 창 새로 고침(Ctrl+R이 듣는다면)은 강제 종료와 같은가 · 12. 도면 탐색이 '도면 화면을 그리지 못했어요'로 바뀌는 일이 있었다면(일어나면 안 된다) 콘솔 줄을 받아 두고 그 버튼으로 풀렸는가(4.7).

### 10.5 통과 기준

`npm run typecheck`(메인 쪽 `tsconfig.node.json` 포함) · `npm run test:background`(지금의 수 + 새 두 파일, 건너뜀 5 그대로) · `npm run test:character`(main·preload·타입·mock의 글자를 보는 `tests/characterFeedback3.test.ts`) · `npm run test:ui`(사이드바) · `npm run test:motion`(fx3 · comments-notify-review-fix의 `onBeforeQuitFlush: noop` 그대로) · 마지막에 `npm run build:vite`(그 사슬이 나머지 묶음도 돈다 — 사이드바를 읽는 `test:entity`·`test:playground`·`test:auto-update`의 셋, main·preload·타입·mock을 읽는 거의 모든 묶음). **빌드 묶음 검사**(오케스트레이터, build:vite 뒤): `dist-electron/main.js`에 `background-kept:list`·`background-kept:put`·`background-map-kept.`이 있고, `dist-electron/preload.js`에 `background-kept:put`이 있고, `dist/index.html`이 부르는 `assets/index-*.js`에 `저장 안 한 도면 편집이 있어요`가 있고 낱말 `restore-drafts`·`rebase-drafts`·`follow-saved`가 **없으며**, `assets/BackgroundLibraryView-*.js`에는 그 셋이 **있다**(문서는 배경 묶음에) — 따옴표 없이 찾는다(묶음은 큰따옴표로 쓴다. 작은따옴표째로 찾으면 늘 없어 검사가 떨어질 수 없다). 있어야 할 곳에 있는지를 함께 봐서 검사가 거짓으로 지나지 않게 한다. 앵커는 파일 시스템을 읽으므로 PR 전에 `git status --porcelain -- src electron tests docs DEVLOG`에 `??`가 없고 `git ls-files --error-unmatch`가 새 파일 아홉(9.3 — 새 모듈 일곱과 테스트 둘)과 이 문서에 성공해야 한다.

---

## 11. 배포 기록과 문서

- **버전**: `package.json`의 `version`과 `package-lock.json`의 두 곳(package-lock.json:3·9)을 `1.140.0`으로. 머지 직전에 `origin/main`이 1.139.0인지 다시 본다(아니면 그다음 부 버전으로 다시 매기고 이 머리말·업데이트 내역·ROADMAP을 함께 고친다).
- **`DEVLOG/update-notes.json` 맨 앞에**(비개발자 문구 — 바뀐 것을 말하는 항목은 '예전에는 … 이제 …'이고 셋째·일곱째는 알림이라 그 꼴이 아니다, 항목마다 1~3문장, '(시험 중)'. 실제 파일에는 기존 항목과 같은 줄바꿈으로):

```json
{
  "version": "1.140.0",
  "title": "배경 도면에서 저장하지 않은 편집이 이 PC에 남아요 (시험 중)",
  "items": [
    { "category": "ux", "summary": "다른 메뉴에 다녀와도 고치던 도면이 그대로예요 (시험 중)", "description": "예전에는 도면을 고치다 씬이나 캘린더 같은 다른 메뉴로 가면 저장하지 않은 편집이 말없이 사라졌어요. 이제 돌아오면 고치던 도면이 그 모습 그대로 '편집 중'이고, '저장 안 한 변경' 수와 되돌리기(Ctrl+Z)도 그대로예요. 3D로 보고 있었다면 평면으로, 손에 든 도구는 '선택'으로 돌아오고, 넣던 도중의 그림은 예전처럼 도면에 이어지지 않아요(그때까지 저장된 그림은 '배경 목록'에 남아요)." },
    { "category": "ux", "summary": "앱을 껐다 켜도 저장하지 않은 편집이 돌아와요 (시험 중)", "description": "예전에는 앱을 끄거나 업데이트하거나 로그아웃하면 저장하지 않은 편집이 그 순간 사라졌어요. 이제 고칠 때마다 이 PC에 조용히 보관해 두었다가, 다시 켜서 배경 화면을 열면 그 도면을 고친 모습 그대로 '편집 중'으로 열고 한 번 알려 줘요. 보관한 편집은 고친 그 PC에서 그 계정으로 로그인했을 때만 보이고, 다른 사람에게 보이려면 지금처럼 '도면 저장'을 직접 눌러야 해요." },
    { "category": "ux", "summary": "배경 도면을 고치던 중이면 업데이트 전에 '도면 저장'을 눌러 두세요 (시험 중)", "description": "보관은 이번 버전부터 하는 일이라, 이번 업데이트를 받는 그 순간 열려 있던 저장 안 한 도면 편집은 예전처럼 사라져요. 업데이트 전에 '도면 저장'을 눌러 두면 안전하고, 다음 업데이트부터는 그 순간의 편집도 보관돼요." },
    { "category": "ux", "summary": "저장하지 않은 편집이 남아 있으면 점으로 알려 줘요 (시험 중)", "description": "예전에는 도면 목록의 그 줄에만 점이 있어서, 다른 메뉴에 가 있거나 도면 묶음을 접어 두면 저장하지 않은 편집이 남았는지 알 수 없었어요. 이제 왼쪽 메뉴의 '배경'과 '도면 탐색' 탭, 접어 둔 도면 묶음에 점이 켜지고, 마지막 하나를 저장하거나 버리면 꺼져요(다시 열 수 없는 편집이 드물게 남으면 켜진 채예요). 필요 없는 편집은 '편집 끝내기 → 버리고 끝내기'로 버리면 돼요." },
    { "category": "ux", "summary": "다른 곳에서 먼저 저장된 도면은 저장하기 전에 알려 줘요 (시험 중)", "description": "예전에는 같은 도면을 다른 PC에서 먼저 저장했으면 '도면 저장'을 누른 뒤에야 빨간 글씨로 거절됐고, 새로고침해도 풀리지 않았어요. 이제 다른 곳의 저장이 이 PC에 전해지면(배경 화면을 보고 있으면 보통 15초 안) 편집 띠가 '다른 곳에서 먼저 저장됐어요'라고 미리 알려 주고, 저장을 누르면 '내 편집을 새 도면으로 저장'과 '내 편집 버리고 최신 내용 받기' 가운데 고를 수 있어요. 두 내용을 하나로 합쳐 주지는 않아요." },
    { "category": "ux", "summary": "껐다 켠 뒤에는 마지막 모습만 남아요 (시험 중)", "description": "예전에는 껐다 켜면 저장하지 않은 편집이 하나도 남지 않았어요. 이제 마지막 모습은 남지만 그 전 단계로 되돌릴 수는 없고, 그리다 만 다각형과 열어 둔 창의 내용은 보관되지 않아요. 앱이 갑자기 꺼지면 마지막 0.3초, PC 전원이 갑자기 나가면 마지막 몇 초 안쪽의 편집은 빠질 수 있고, 보관하지 못했을 때는 편집 띠가 '이 PC에 보관하지 못했어요'라고 알려 줘요." },
    { "category": "ux", "summary": "배경 화면은 아직 배한솔 계정에서만 보여요 (시험 중)", "description": "이번 변경도 배경 화면 안의 일이라, 배경 메뉴가 보이지 않는 분들은 달라지는 것이 없어요." }
  ]
}
```

세 한계(그 PC·그 계정에서만 / 저장은 여전히 직접 / 합쳐 주지 않음)가 둘째와 다섯째 항목에 있다. 셋째 항목은 이 업데이트를 받기 **전에** 업데이트 창에서 읽힌다(내역은 배포 정보에 실려 예전 버전의 창에 뜬다, scripts/generate-manifest.js:118-146) — 그 순간의 설치는 보관하지 않는 1.139.0이 한다. PR의 `📋 업데이트 요약`은 이 일곱 항목을 그대로 쓴다. 진짜 종료의 길(10.4의 1~6)을 확인했다고 쓰지 않는다 — 여섯째 항목의 '0.3초'·'몇 초'는 설계의 약속이고, 전원의 '몇 초'와 파일이 깨지지 않는 것은 디스크까지 내리는 쓰기(3.2)에 기대며 한 번도 해 보지 않았다. 배포를 알리는 말(한솔에게, 슬랙에 올릴 때)에도 셋째 항목의 한 줄을 넣는다.

- **문서**
  - 이 문서를 커밋한다(구현의 첫 커밋, 12절의 0단계).
  - `ROADMAP.md`: '2026-09-21 배경 라이브러리' 절(ROADMAP.md:12)의 3차 줄(ROADMAP.md:30) 다음에 `- [x] 2026-10-15 저장 안 한 편집 보관(v1.140.0): 다른 메뉴에 다녀와도 초안·되돌리기가 그대로, 고칠 때마다 이 PC의 계정별 파일에 보관하고 다시 켜면 묻지 않고 되살림, 사이드바·탭·접은 줄의 점, 다른 곳에서 먼저 저장·삭제된 도면은 띠가 알리고 저장을 누르면 '새 도면으로 저장 / 버리고 최신 받기'. 운영 DB 변경 없음, IPC 채널 둘. 설계: docs/superpowers/specs/2026-10-15-background-map-keep-unsaved-design.md` 한 줄. v1.139.0 절의 `- [ ] 다음: 저장 안 한 편집을 이 PC에 보관`을 `- [x] 다음: 저장 안 한 편집을 이 PC에 보관 — v1.140.0`으로. 파일 끝에 `### v1.140.0 배경 도면 — 저장 안 한 편집 보관 (2026-10-15)` 절: 다른 메뉴 왕복 · 보관과 되살리기 · 점 · 다른 곳에서 먼저 바뀜을 한 줄씩, `- [ ] 수동 검증(설계 10.3 전체)`, `- [ ] 배포`, `- [ ] 배포 뒤 실기(설계 10.4 — 진짜 종료의 길 1~6이 먼저)`, `- [ ] 다음: '모두 저장'(한솔이 원하면) · 마의 나머지`.
  - `AGENTS.md` '배경 라이브러리 데이터 경계'(AGENTS.md:124-): ① '편집 상태 띠(v1.135.0)' 항목(AGENTS.md:137)의 "그 밖에 초안이 없어지는 것은 …"을 "도면 삭제, `createMap`의 다시 시도 가지(**공간 연결이 있었을 때의** 부모), 다른 곳에서 지워진 도면의 깨끗한 초안(`follow-saved`), 다른 곳에서 먼저 바뀐 도면의 선택 창('내 편집 버리기', 새 도면으로 저장한 뒤의 원래 도면)뿐이다"로, 그 항목의 `dialogOpen` 괄호 목록에 '다른 곳에서 바뀐 도면'을 더한다. ② '그림 넣기(v1.139.0)' 항목 다음에 새 항목 — **저장 안 한 편집 보관(v1.140.0)**: 문서는 편집기가 아니라 **계정의 세션**(`mapDraftSessionOf` — `useBackgroundMapDocument.ts`)이 쥔다. 다른 메뉴 왕복에서 초안·기록·보기 값·고른 도면이 남고, 계정이 바뀌면 세션을 버린다. 그래서 라이브러리 화면은 저장소가 그 계정으로 초기화된 뒤에야 본문을 그리고(`actorId` — 편집기가 앞 화면이 비운 저장소에 대고 올라오면 따라가기가 깨끗한 초안을 지운다), 편집기를 작은 오류 경계(`MapEditorGuard`)로 감싼다(초안 때문에 깨지면 왕복으로도 재시작으로도 풀리지 않으므로 모든 초안을 버리는 버튼을 보인다) / 보관은 메인이 쓰는 `%APPDATA%\Bflow-BGonly\background-map-kept.<계정 id>.json`(`{version:1, entries}`, 임시 파일을 디스크까지 내린 뒤(`sync`) 이름 바꾸기 — 전원이 나가도 0으로 찬 파일이 남지 않게, 백신의 잠김(`EBUSY`·`EPERM`·`EACCES`)은 세 번까지 다시, `ENOENT`만 빈 것, 깨진 JSON은 `.broken-<시각>-<번호>`로 옮김, 다른 버전은 거절, 파일 이름에 대문자를 그대로 두지 않는다)이고 채널은 `background-kept:list`·`background-kept:put` — 계정은 메인의 세션이 정하고 epoch가 낡으면 거절한다. 화면의 `localStorage`에 두지 않는다(종료 전에 비워지지 않는다) / 쓰는 때는 **놓인 상태**(제스처 없음)에서 도면마다 0.3초 안에 한 번(걸린 타이머가 있으면 다시 걸지 않는다 — 이어 고쳐도 0.3초마다 쓴다), 지우기는 곧바로, **지우는 것은 이 세션이 쓰거나(보내는 순간부터) 되살린 것뿐**이고 거절된 지우기는 그 도면에 바뀐 초안이 없을 때 다시 보낸다. 보관과 되살리기는 라이브러리에 아무것도 보내지 않는다 / 되살리기는 로그인마다 한 번, 목록을 읽고(`ready`) 라이브러리를 **편집 권한으로** 읽었고(`canManage`) 저장(그림 넣기의 저장 실행 포함)·끌기·창이 없을 때 — 그림을 올리는 동안은 기다리지 않는다(기다리면 그 사이 연 초안이 보관본을 덮는다). `restore-drafts`가 `dropped = max(1, steps)`로 바뀜을 만든다('바뀜'의 정의는 그대로). 이름은 초안처럼 본다(빈 이름도 되살린다). 목록 전에는 '편집 시작'·'＋ 공간 그리기'가 흐리다. 목록을 읽지 못하면(5초 안에 답이 없음 포함) 되살리지도 쓰지도 지우지도 않고, 편집기가 올라올 때 다시 읽는다. 신호를 비우는 것은 계정이 바뀌었을 때뿐이다(점이 다시 그려질 때가 아니다) / 다른 곳에서 먼저 바뀜은 `mapDraftStanding`(라이브러리 자체에 대고, 저장 중에는 얼린다)이고 띠의 `stale` 상태와 선택 창(`staleChoice` — `dialogOpen`에 든다)으로 말한다. 라이브러리가 초안과 같은 내용을 다른 버전으로 가지면 `current`이고 세션의 `catchUp`이 다시 놓는다(저장 중에 화면을 떠나 답을 잃은 이 PC의 저장). 합치기·덮어쓰기는 없다. 새 도면은 `rescueMapCopy`(하위 연결·없어진 장소·시점 뺌)이고 저장한 뒤 편집 중으로 연다 / 종료·업데이트는 `onBeforeQuitFlush`, 로그아웃은 `flushKeptMapEditsBeforeLogout`이 마저 쓰고, 메인은 before-quit의 기다림 뒤에 `finishKeptEditsBeforeExit`로 파일을 끈다(앱을 트레이에 둔 채 Windows를 끌 때는 정리 통로가 없다) / 늘 실린 부분(사이드바·사용자 메뉴)은 `mapKeptSignal.ts`·`BackgroundKeptDot.tsx`만 부른다 — 문서 모듈을 import하지 않는다.
  - `docs/superpowers/plans/2026-10-10-feedback-additions.md`: 7절 진행 표의 '다' 줄(2026-10-10-feedback-additions.md:299)을 `| 다. 편집 상태와 저장 지키기 (G2) | 1차: docs/superpowers/specs/2026-10-12-background-map-edit-state-strip-design.md, 아래 7.3 · 2차: docs/superpowers/specs/2026-10-15-background-map-keep-unsaved-design.md, 아래 7.7 | 1차 v1.135.0 배포 완료(…그대로) · 2차(보관) 구현·검증 상태 (v1.140.0) |`로. 7절 끝에 `### 7.7 다-2. 저장 안 한 편집 보관 — 만든 것과 확인한 것 (v1.140.0, 날짜)`을 7.6과 같은 꼴(만든 것 / 확인한 것 / 확인하지 못한 것 — 10.4 전부 / 한솔에게 알린 것과 이 설계가 정한 것 — 13.2)로.
  - `DEVLOG/background-library-verification-2026-09-21.md`: `## 2026-10-1x 저장 안 한 편집 보관 (v1.140.0)`(검증한 날짜) — 앞 절과 같은 소제목(자동 검사 · 화면 검증 결과 · 게이트가 찾아 고친 것 · 최종 검토 · 마지막 상태에서 다시 본 것 · **확인하지 못한 것(설계 10.4 전부 — 진짜 종료의 길 1~6이 맨 앞. 전원을 보지 않았으면 10.4의 6에 적은 그 말까지)** · 알고 넘어가는 것(13.3) · 배포).
  - `CLAUDE.md`: 메인이 쓰는 계정별 파일과 채널 둘이 느는 아키텍처 변경이라('문서 갱신 규칙'), '데이터' 단락(CLAUDE.md:49 — 무엇을 어디에 두는지 적은 단락) 끝에 한 문장만 더한다: `배경 도면의 저장 안 한 편집(v1.140.0~)은 메인 프로세스가 계정별 파일 %APPDATA%\Bflow-BGonly\background-map-kept.<계정 id>.json 에 쓴다(채널 background-kept:list·background-kept:put, 계정은 메인의 세션이 정하고 Supabase에 보내지 않는다 — AGENTS.md '배경 라이브러리 데이터 경계').` 그 밖은 고치지 않는다(작업 트리의 `CLAUDE.md`는 CRLF다 — 그대로 둔다).
  - 완료 보고에 13.2를 비개발자 문장으로 옮겨 적는다.

---

## 12. 구현 순서 (단계마다 `npm run typecheck`·`npm run test:background`가 통과하게)

각 단계의 테스트와 코드는 **그 단계까지 생긴 이름만** import한다(편집기의 import는 4·5단계로 나뉜다, 9.3). 기존 앵커를 떨어뜨리는 단계는 **같은 단계에서** 그 앵커를 9.2대로 고친다. **1단계와 4단계는 `npm run build:vite`까지 돌린다** — 그 사슬이 모든 테스트 묶음을 돈다. 1단계가 고치는 main·preload·타입·mock은 거의 모든 묶음의 테스트가 글자로 읽는다(그 가운데 `tests/motion/comments-notify-review-fix.test.ts`는 before-quit의 `lastIndexOf('rendererFlush,')`를 보는데 3.4의 새 줄도 그 글자를 품는다 — 그 줄이 `// ★ 자동 업데이트 적용` 앞이라 그대로 지난다, 14절). 4단계가 고치는 사이드바는 2.10의 열넷 가운데 셋(sceneNavigatorReferenceWiring · playgroundNavigationWiring · autoUpdateInstallerFlow)이 `test:entity`·`test:playground`·`test:auto-update`에만 있고, 사용자 메뉴는 `test:motion`의 둘(fx3-retry-session · popups-panels-popup-rhythm)이 읽는다. 2·3·5단계가 고치는 파일은 배경 테스트만 읽는다(6단계의 게이트 M이 배경 밖의 테스트를 고치면 그 묶음도 돌린다). "…을 본다"는 구현자가 아니라 오케스트레이터가 한다(구현자는 앱·미리보기 서버를 띄우지 않는다).

0. **기준 다시 보기**: 이 문서를 커밋한다. `origin/main`이 `a01d4cad`(1.139.0)에서 움직였으면 9.3의 표가 가리키는 글자(`dialogOpen`의 줄, `saveMap`의 바뀐 것 없음 검사, `fileDrag`의 줄, `saveSettings`·`uploadUnderlay`의 순서, `gallery` 메모와 `const treeRows`, :1536-1537의 두 줄, 앵커의 끝 78, `await persistMaps(`의 수 6)를 다시 보고, 다르면 만든 코드를 따르고 PR에 적는다.
1. **파일과 채널**: `src/shared/backgroundKeptEdits.ts` · `electron/backgroundKeptEdits.ts` · main.ts의 세 곳 · preload · 타입(필수 두 멤버) · mock + `tests/backgroundKeptEdits.test.ts`(KE-1~5). 부르는 화면이 아직 없다.
2. **순수 층**: `mapDraftKeep.ts`(9.3의 내용 전부 — 8.1의 두 함수와 글자 `MAP_KEEP_TEXT`·`MAP_STALE_TEXT` 포함) · `restore-drafts` · `mapEditStatus`의 넷째 인자 + `tests/backgroundMapKeep.test.ts`의 KP-1~7 · 앵커 59의 두 이름. 화면은 그대로다.
3. **세션**: `mapKeptSignal.ts` · `mapDraftSession.ts` · 훅(4.3) · 편집기의 세 줄(4.3)과 `shownMapId` effect(`const treeRows` 바로 앞, 4.4) · **라이브러리 화면의 본문의 문(4.4)과 편집기의 경계(4.7 — `MAP_KEEP_TEXT`의 import도 이 단계)** — 문서를 들어내는 이 단계에 함께 넣는다(문을 빼면 왕복이 깨끗한 초안을 지우고 보던 도면을 바꾸고, 경계를 빼면 편집기가 깨질 때 왕복으로 풀리지 않는다) + KP-8·KS. 이 단계부터 다른 메뉴 왕복이 초안을 지키고 보관이 쓰인다(되살리기와 답을 잃은 저장의 다시 놓기는 아직 없다).
4. **되살리기·점·로그아웃**: 편집기의 import 둘(`MAP_KEEP_TEXT`·`useKeptMapEdits`, 9.3)·`keptStatus`·`keptSettled`·되살리기 effect(`shownMapId` effect 바로 앞, 6.5)·`beginEditing`·'편집 시작'(앵커 58)과 '＋ 공간 그리기'의 흐림·다시 시도 가지·접은 줄의 점·안내 ×의 두 번 누름 막기(앵커 52) · 라이브러리 화면의 탭 점과 안내 문장 · `BackgroundKeptDot.tsx`와 사이드바의 두 줄 · 사용자 메뉴의 두 줄 · `backgrounds.css` · `.bmap-confirm-text`의 `overflow-wrap` + 앵커 65(되살리기의 두 줄 — 이 단계의 `dialogOpen`은 아직 `staleChoice` 없이 수 11) · fx3의 정규식. **게이트 K — K1~K8(K1b~K1e·K3b 포함), R1~R4(R1b 포함), D1~D4, G1.** 이 단계에는 선 자리·`keptFailed`·띠의 넷째 인자(5단계)가 없어 띠는 늘 지금의 글자다: R1의 띠 `다른 곳에서 지워졌어요`와 R4의 띠 `이 PC에 보관하지 못했어요`는 여기서 보지 않고(그때 띠는 `저장 안 한 변경 N개`다), K1e의 '`stale`이 한 번도 없다'·'창이 뜨지 않는다'는 저절로 지난다 — 셋 다 게이트 S가 다시 본다.
5. **다른 곳에서 먼저 바뀜**: 편집기의 import(대화 상자·`mapDraftStanding`·`rescueMapCopy`·`rescueMapName`·`type MapDraftStanding`, 9.3) · 선 자리 · `keptFailed` · 띠의 줄(앵커 57) · CSS 두 줄 · `staleChoice`와 `dialogOpen`의 낱말(앵커 65) · `saveMap`의 한 줄 · `BackgroundMapKeptDialog.tsx` · `answerStale`(앵커 50) · 그리는 줄. **게이트 S — T1~T11(T11b 포함), F1·F2, W1~W2, 이 단계의 코드로 R1·R4를 띠의 글자까지 다시, 그리고 네 조합의 ★**(10.3의 ★ 모두 — 게이트 K의 K1·K1b·K1e·D1·D2도 이 단계의 코드로 네 조합에서. 그래서 K1e, 곧 답을 잃은 내 저장이 `stale`로 비치지 않는다는 K22의 약속을 선 자리와 선택 창이 있는 코드에서 여기서 처음 본다). 6·7단계는 구현을 고치지 않으므로(게이트 M은 앵커와 테스트만, 7단계는 버전과 문서) 이것이 마지막 코드의 화면 검증이다. 대체안을 쓴 곳은 글자(9.2·8.2)도 함께 고친다.
6. **새 앵커 79~83과 뮤테이션**(10.2). **게이트 M** — 살아남는 변형이 있으면 앵커나 테스트를 고친다(구현은 고치지 않는다).
7. **버전과 문서**(11절), 그리고 마지막 상태에서 10.5 전체와 빌드 묶음 검사와 git 확인.

**오케스트레이터만 하는 일**: 검사 창 확인과 대체안 선택(게이트 K·S), PR 머지, 빌드와 G드라이브 배포(빌드는 다른 세션과 겹치지 않게 자기 작업 폴더에서, 성공은 `electron-builder`·`generate-manifest`의 로그로 판정하고 `manifest.json`은 마지막에). 운영 DB에 할 일은 없다. **10.4는 한솔님이 자기 PC에서 한다** — 오케스트레이터는 부탁하고 결과를 검증 기록에 적기만 한다. **설치된 앱과 설치 파일은 띄우지 않고 진짜 `%APPDATA%\Bflow-BGonly`에 손대지 않는다** — 진짜 종료의 길은 한솔 PC에서 처음 본다.

**검사 창에서 다르면 — 대체안**

| 확인할 것 | 기대와 근거 | 다르면 |
|---|---|---|
| 띠의 새 글자가 901px·사이드바 펼침과 740px에서 한 줄에 다 들어가는지 (W1) | 남는 폭 약 70px(1차 10.4), '다른 곳에서 먼저 저장됐어요'는 약 +60px | 말줄임이면 `다른 곳에서 저장됐어요`로 바꾸고 8.2·KP-2·11절 업데이트 내역의 따옴표 속 글자와 13.2를 함께 바꾼다. 버튼 자리나 두 줄로 바뀌는 폭은 옮기지 않는다 |
| 되살리기가 첫 그림 전에 끝나는지 (K5) | `useLayoutEffect` 안의 저장소 dispatch와 상태 변경은 그리기 전에 다시 그린다 | 한 틀 비치면 그대로 두고 적는다(같은 렌더의 일이라 고칠 자리가 없다) — 바꾸지 않는다 |
| `onBeforeQuitFlush`를 잡을 수 있는지 (K5·K8) | mock은 얼리지 않은 객체다 | 잡지 못하면 마지막 편집 뒤 0.5초를 기다린 뒤 새로 고친다(쓰기가 이미 나갔다). 정리 통로는 KP-8과 앵커 79가 맡았다고 적는다 |
| 탭 점이 좁은 창의 탭 스크롤 상자에서 잘리지 않는지 (D2, 740) | 점은 버튼 안이다 | 잘리면 `top`·`right`를 버튼 여백 안으로 줄인다 |
| 사이드바 점이 펼침 애니메이션(350ms) 동안 아이콘과 겹쳐 흔들리지 않는지 (D1) | 아이콘 칸은 `w-12` 고정이다 | 흔들리면 그대로 적는다(캘린더 점과 같다) |
| 새 도면 저장 뒤 편집 중의 새 도면이 보이는지 (T6) | `execute`는 받은 스냅샷을 놓은 뒤에 돌아오므로(useBackgroundStore.ts:53) `setCurrentId(copy.id)`의 렌더에 새 도면과 그 초안이 있다 | 첫 도면이 보이면 결함이다 — 그 렌더의 `snapshot.maps`에 새 도면이 있는지부터 보고 고친다(대체안이 아니다) |
| 저장 중에 떠났다 돌아온 도면이 첫 틀부터 '저장된 그대로예요'인지 (K1e — `stale`이 비치는지는 게이트 S에서) | 되살리기의 effect는 `useLayoutEffect`이고 선 자리도 같은 내용을 `current`로 읽는다 | 한 틀 '저장 안 한 변경'이 비치면 그대로 두고 적는다(선 자리가 `stale`을 말하지 않는 것이 핵심이다). `stale`이 비치면 결함이다 |
| 자기 저장 동안 `stale`이 한 번도 없는지 (T8) | `disabled`가 저장 끝까지 켜져 있다(:650) | 비치면 얼리는 조건에 `pending`의 직전 값을 더한다(얼린 값을 `pending`이 꺼진 뒤 한 렌더 더 둔다) — 8.1의 줄과 앵커 81을 함께 고친다 |
| `BackgroundModal`이 두 번의 Esc 뒤 다시 열리는지 (T3) | 1차 삭제 창이 같은 장치로 지났다 | 다르면 1차 창과 같이 고친다(둘 다) |
| 누르지 않고 떠날 때 범위 밖의 숫자와 이름 상자의 글자가 버려지는지 (K3b) | 칸이 포커스를 쥔 채 내려가고, React는 그리는 동안의 `blur`를 처리하지 않는다(4.4) | 끝값으로 들어가면 그대로 두고 1.2 K9·4.4·13.2의 글자를 '들어간다'로 고친다(어느 쪽이든 칸을 떠날 때의 값이거나 버림이다 — 고칠 코드는 없다) |
| 보관 거절로 띠가 바뀌는지 (F1·F2) | `refuseKept`는 그 키의 `setItem`만 던지게 한다 | 띠가 그대로면 코드를 의심하기 전에 흉내가 잡혔는지 본다(F1 첫 단계의 `setItem`이 던지는가 — `localStorage.setItem = …`으로 걸면 항목으로 저장될 뿐이다) |
| 흉내가 편집기를 깨뜨리는지 (G1) | 되살리기의 `restore-drafts`만 그 3초 사이 `structuredClone`을 부른다 | 다른 곳이 먼저 부르거나 깨지지 않으면 G1을 그만두고 앵커 79와 KP-8로 갈음했다고 적는다 |

---

## 13. 열린 질문 · 알릴 것 · 알고 넘어가는 것

### 13.1 한솔에게 물을 것

없다. 세 질문은 "셋 다 추천대로"로 정해졌고, 그 말이 한 가지로 정하지 않는 곳은 1.2가 정했다.

### 13.2 한솔에게 알릴 것 · 완료 보고에 적을 것

**알린 말과 다른 곳 — 먼저 알린다**

- **이번 업데이트를 받는 그 순간은 아직 예전 버전(1.139.0)이 일해서 보관하지 않는다** — 그때 열려 있던 저장 안 한 도면 편집은 예전처럼 사라진다. 업데이트 전에 '도면 저장'을 눌러 두시라고 먼저 알린다(업데이트 내역 셋째 항목, 배포 알림에도 한 줄).
- ① "돌아오면 고치던 도면이 그 모습 그대로" — 도면·초안·'저장 안 한 변경' 수·되돌리기·선택·확대는 그대로지만, **3D로 보던 것은 평면으로, 손에 든 도구는 선택으로** 돌아온다. 그리다 만 다각형·열어 둔 창은 남지 않는다. 치던 칸은 이렇다: 왼쪽 메뉴 등 **다른 곳을 누르거나 다른 창으로 가서** 떠나면 오른쪽 속성 칸과 평면 위 이름 상자에 치던 것이 칸을 떠날 때처럼 들어간다(범위를 넘은 숫자는 가장 가까운 끝값으로 — 예: '가로 길이'에 150을 치다 1에서 누르고 떠나면 10). **이 창에서 아무것도 누르지 않은 채 화면이 바뀌면**(업데이트 안내가 뜰 때 등) 범위를 넘은 숫자와 이름 상자의 글자는 사라진다(속성 칸의 이름과 범위 안의 숫자는 칠 때마다 이미 들어가 있다). 칸에 커서가 있는 동안 Ctrl+숫자는 지금처럼 다른 메뉴로 가지 않는다. 그림을 넣는 **도중에** 다른 메뉴로 가면 그 그림은 지금처럼 도면에 이어지지 않는다 — 그때까지 저장된 그림은 '배경 목록'에 남고, 도면에 이어 주지 않을 뿐이다(이미 도면에 이어 준 것은 이제 남는다).
- ① '도면 저장'을 누르고 저장이 끝나기 전에(보통 1초 안) 다른 메뉴로 가면, 저장은 되지만 배경 화면으로 돌아올 때까지 왼쪽 '배경'의 점이 켜진 채다 — 돌아오면 '저장된 그대로예요'로 바뀌고 점이 꺼진다. '기존 도면 연결'·'도면 설정'·'내부 도면 만들기'(공간에 연결할 때)·'내 편집을 새 도면으로 저장'·'도면 삭제'가 도는 중에 떠나면, 저장 안 한 편집이 있던 그 도면은 돌아온 뒤 '다른 곳에서 먼저 저장됐어요'('지워졌어요')로 보인다 — 이때는 '내 편집 버리고 최신 내용 받기'('내 편집 버리기')를 고르면 된다(보낸 것은 이미 들어가 있다).
- ② 다시 켠 뒤의 알림은 고친 '편집'의 수가 아니라 **도면의 수**와 버리는 길까지 말한다: "지난번에 저장하지 않은 편집이 있던 도면 2개를 다시 열었어요. 필요 없으면 '편집 끝내기'에서 버릴 수 있어요." 바로 밑 띠의 '저장 안 한 변경 N개'와 섞이지 않게 했다. 여러 도면이면 **가장 나중에 고친 도면**이 열리고 나머지는 목록의 점으로 보인다.
- ② 이 PC의 보관 목록을 읽지 못하면(오래 잠긴 파일 등 — 백신이 잠깐 쥐는 정도는 다시 해 본다, 5초 안에 답이 없을 때 포함) 읽힐 때까지 되살리지 않고, 묻거나 알리지도 않는다. 그동안 고친 도면은 띠가 '이 PC에 보관하지 못했어요'라고 말한다(읽지 못한 보관본을 덮어쓰지 않으려고 쓰지 않는다). 배경 화면에 다시 들어올 때마다 다시 읽어, 읽히면 같은 로그인 안에서도 그때 되살리고 알린다.
- ④ 지워진 도면의 띠 글자는 "다른 곳에서 지워진 도면이에요"가 아니라 **"다른 곳에서 지워졌어요"**(좁은 창에서 한 줄에 들어가게). 그때의 '도면 저장' 버튼은 이름도 풍선도 그대로이고, 누르면 창이 뜬다.
- ④ "누르기 전에 띠가 알려요"는 이 PC가 다른 곳의 저장을 읽은 뒤의 일이다(변경 신호, 창에 돌아올 때, 15초마다). 읽기 전에 '도면 저장'을 누르면 그 첫 누름은 예전처럼 빨간 글씨로 거절되고, 곧 띠가 바뀌어 다음 누름부터 고르는 창이 뜬다.
- ④ 다른 곳에서 먼저 바뀐 도면에서는 '도면 설정'·'기존 도면 연결'·'내부 도면 만들기'(공간에 연결)가 예전처럼 빨간 글씨로 거절된다 — 먼저 '도면 저장'을 눌러 고른 뒤에 하면 된다.
- ⑤ "보관에 실패하면 띠가 알려요"는 **보고 있는 도면**의 일이다(다른 도면은 열면 띠가 말한다). 다른 곳에서도 먼저 바뀐 도면이면 띠는 '다른 곳에서 …'를 말하고, 보관하지 못했다는 말은 고르는 창이 한다.
- ⑤ "PC가 갑자기 꺼지면 마지막 0.3초 안쪽의 편집 하나는 빠질 수 있어요"는 **앱이** 갑자기 꺼질 때(멈춤·작업 관리자로 끔)의 일이다. **PC 전원이** 갑자기 나가면 Windows가 디스크에 굳히지 않은 마지막 몇 초가 빠질 수 있다 — 대신 파일이 깨져 보관해 둔 편집을 통째로 잃는 일은 없게 썼다(디스크까지 내린 뒤 이름을 바꾼다). B flow를 트레이에 둔 채 Windows를 끄거나 다시 시작할 때도 마지막 0.3초 안쪽은 빠질 수 있다(Windows가 그때 정리할 틈을 주지 않는다).
- 진짜 앱의 **종료·지금 업데이트·로그아웃·강제 종료·Windows 다시 시작 뒤에 돌아오는지는 배포 뒤 한솔님 PC에서 처음 본다**(검사 창은 앱 본체를 띄우지 않는다). 업데이트는 그다음 배포 때에야 볼 수 있다. 전원을 갑자기 끄는 것은 원하실 때만(다른 작업을 모두 저장한 뒤) 보시면 되고, 보지 않으면 위의 '몇 초'와 파일이 깨지지 않는다는 것은 설계로만 지킨 것이다(작업 관리자로 끄는 것으로는 갈음되지 않는다).

**알린 것에 없던 것**

- 로그아웃이 최악의 경우 3초 더 기다릴 수 있다(보통은 바로).
- 앱을 켠 직후 한순간은 '편집 시작'과 '＋ 공간 그리기'가 흐리다(보관 목록을 읽는 동안 — 답이 없어도 5초까지).
- '내 편집을 새 도면으로 저장'을 고르면 그 새 도면이 **편집 중으로** 열린다(새 도면을 만들 때처럼 — 저장해도 편집이 끝나지 않는다는 1차의 약속 그대로).
- 업데이트가 필요하다는 안내에 한 문장이 붙는다: "이 PC에 저장 안 한 편집이 있는 도면 N개가 그대로 보관돼 있어요. 업데이트한 뒤 배경 화면을 열면 이어서 고칠 수 있어요."(보관하지 못한 것은 세지 않는다)
- 다시 열어 준다는 안내의 ×는 빨리 두 번 눌러도 밑의 '도면 저장'을 누르지 않는다(안내가 사라지며 띠가 올라오는 자리).
- 보관한 편집은 `%APPDATA%\Bflow-BGonly\background-map-kept.<계정>.json`에 있다. 회사 PC의 Windows 계정에 접근할 수 있는 사람은 열어 볼 수 있다(지금의 다른 개인 설정 파일과 같다). B flow의 다른 계정으로는 보이지 않는다.
- 도면 값을 이 버전이 되살릴 수 없는 보관본(다른 버전이 쓴 것·깨진 것)이 남으면 점이 꺼지지 않는다 — 끌 길은 팀 공개 때 만든다. 이름을 비워 둔 채 끈 도면은 되살린다(저장할 때 지금처럼 이름을 넣으라고 한다 — '내 편집을 새 도면으로 저장'도 같아서, 돌아가 이름을 넣은 뒤 다시 고르면 된다).
- 드물게 도면 탐색이 "도면 화면을 그리지 못했어요."로 바뀌면 그 아래 '저장하지 않은 편집을 버리고 다시 열기'를 누르면 된다 — 저장하지 않은 도면 편집이 모두 버려지고 저장한 모습으로 다시 열린다(다른 메뉴에 다녀오면 버리지 않고 한 번 더 그려 본다). 예전에는 배경 화면이 통째로 비고, 다른 메뉴에 다녀오면 편집이 사라지며 풀렸다. 이제는 편집이 이 PC에 남아 다녀와도·껐다 켜도 같은 화면이 되풀이되므로 이 버튼을 두었다. 그런 일이 있으면 알려 주시면 고친다.
- '내부 도면 만들기'를 다시 눌렀을 때 공간 연결이 없으면 부모 도면의 저장 안 한 편집을 이제 버리지 않는다.
- 점은 강조색에 얇은 회색 테두리다(캘린더 연결 점과 같은 자리·크기). 몇 테마(밝은 화면의 에메랄드·호박, 어두운 화면의 이혜민 머쉬룸)에서 강조색만으로는 잘 안 보여서다.
- 배경에 들어올 때 한 틀 비치던 빈 도면 화면이 없어지고 곧바로 '불러오고 있습니다'가 보인다.

### 13.3 알고 넘어가는 것

- **초안 때문에 편집기가 깨지면**(이번 실행의 초안이든 되살린 것이든) 문서가 화면보다 오래 살아, 다른 메뉴 왕복으로도 재시작으로도 풀리지 않는다(v1.139.0은 왕복이 새 문서로 풀었다). 4.7의 경계가 도면 탐색 탭에 한 문장과 버튼을 보이고, 버튼이 모든 초안을 버린다(보관본도 P6으로 지워진다). 값은 이름 밖의 도메인 검사를 지나야 되살아나므로 편집기의 버그가 있어야 생긴다(빈 이름은 편집기가 늘 그리던 값이다). 원인이 보기 값·선택(`viewports` — 세션에 남고 보관하지 않는다)이면 버튼으로 풀리지 않고 앱을 다시 켜야 한다. G1이 경계를 검사 창에서 본다.
- 첫 읽기가 실패한 채 같은 실행에서 돌아오면 본문은 지금처럼 빈 라이브러리로 그려진다(본문의 문은 `actorId`만 기다린다): 읽기가 성공할 때까지 목록에 초안의 도면만 읽기 전용으로 보이고, 따라가기가 그 빈 라이브러리에 대고 **깨끗한** 초안만 치우며(1차 4.4 그대로 — 저장 안 한 편집은 건드리지 않는다), 초안 없이 고른 도면은 그동안 다른 도면으로 비친다(읽기가 성공하면 고른 도면으로 돌아온다 — 세션은 고른 것을 적는다, 4.4).
- 이번 실행에서 처음 고친 도면에, 되살리지 못한 보관본(다른 버전이 쓴 것·깨진 것 — 목록에 오지 않은 것도)이 있으면 새 편집이 그 위에 쓰인다(도면마다 한 칸). 목록을 읽지 못한 동안 고친 도면도 같다: 나중에 목록이 읽히면 그 도면은 되살리지 않고(`drafted`) 새 편집이 그 보관본의 자리를 갖는다.
- **되살리기가 늦어진 사이 이 PC가 그 도면을 저장했으면**(목록을 읽지 못한 동안 '편집 시작'으로 연 초안의 저장, 목록이 늦게 와 '도면 설정'·'기존 도면 연결' 창 밑에서 되살리기가 기다리는 동안의 그 저장) 나중에 되살린 보관본이 그 버전보다 낡아, 띠가 이 PC의 저장을 두고 '다른 곳에서 먼저 저장됐어요'라고 한다. 잃는 것은 없다(선택 창에서 새 도면으로 남기거나 최신을 받는다). 깨끗한 초안 위에는 되살리지 않는 길도 있었지만, 그러면 보관본이 보이지 않은 채 점만 켜져 남고 그 도면의 다음 편집이 덮는다 — 되살리는 쪽을 둔다(KP-4).
- 저장 중에 떠났다가, 앞의 저장이 서버에 닿기 전에 돌아와 그 도면을 또 고치면(드묾) 그 도면은 같은 내용 규칙에 들지 않아 '다른 곳에서 먼저 저장됐어요'로 읽힐 수 있다 — 앞의 저장까지는 '최신 내용 받기'에 들어 있다. 연결·설정 등이 끊긴 경우(13.2)와 함께, 보낸 것을 세션이 기억해 맞춰 보는 길은 이번에 만들지 않는다(`persistMaps`·삭제 실행의 줄을 앵커 50·57·66이 글자로 본다).
- 거절된 지우기는 그 도면에 바뀐 초안이 없는 동안 세션이 다음에 무엇을 보낼 때와 종료·로그아웃 때 다시 보낸다. 그 전에 강제 종료되면 버린 편집이 다음에 다시 열린다(드묾 — 쓰기도 지우기도 거절되는 동안의 일이다).
- 되살린 초안의 밑그림이 `data:` 그림이었고 그 사이 다른 곳에서 밑그림이 바뀌었으면, 되살린 초안은 새 밑그림을 보인다(밑그림은 보관하지 않는다).
- 미리보기에서 두 탭이 한 거울 키를 나눠 쓰면 나중 쓴 것이 이긴다. 설치된 앱의 편집기 창은 하나다.
- `%APPDATA%`는 로밍 프로필 폴더다. 로밍 프로필을 쓰는 PC라면 파일이 Windows 계정을 따라갈 수 있다(스튜디오 PC는 쓰지 않는 것으로 안다).
- '모두 저장'(다음 후보): 저장소·리듀서 일이 더 들지 않는다. 띠가 아니라 도면 목록 아래 한 줄('저장 안 한 도면 N개 · 모두 저장'), `mapDraftStanding`이 `current`인 것만 한 `save-maps`로(다시 놓기는 여러 도면을 받는다), 다른 곳에서 바뀐 것은 빼고 수를 말한다.

---

## 14. 설계 때 돌려 본 것

모두 저장소 밖 임시 폴더에서 했고 끝난 뒤 지웠다. 저장소에는 이 문서만 썼다.

- **기존 앵커**: `fbb80bb6`의 사본(테스트·`src/features/backgrounds`·`package.json`·main·preload·타입·mock·사이드바·사용자 메뉴)에 9.3의 편집기 줄·리듀서·`mapEditStatus`·라이브러리 화면·CSS·사이드바·사용자 메뉴의 고침과 새 파일 일곱을 넣고 `node --test tests/backgroundMapEditorWiring.test.ts` — **75 통과, 50·57·65만 떨어짐**(9.2대로). 처음 시안의 선택 창 단추 이름 `onDrop`이 3차 앵커 74(편집기에 `onDrop=`이 없다)에 걸려 `onDiscard`로 바꿨다.
- **배경 테스트 전체**: 같은 사본을 저장소의 `node_modules`로 풀어(import 해석 훅) `tests/background*.test.ts` — 사본 환경 탓에 원본 사본도 떨어지는 40개를 빼면 **새로 떨어진 것은 위의 셋뿐**. `backgroundMapDocument`·`backgroundMapEditStatus`·`backgroundPersistence`는 고친 리듀서·`mapEditStatus`로 68개 모두 통과.
- **새 코드의 실험 테스트 일곱**(10.1의 KP·KE의 바탕): `restore-drafts`의 수·되돌리기·따라가기, 선 자리와 띠, 되살리기 계획(모르는 키·같은 내용·없는 도면·밑그림 붙이기·`newest`), 새 도면이 진짜 `applyBackgroundCommand`를 지나는지(옮겨짐·지워짐·장소와 시점 지워짐), 세션의 K2 수(세 번 고침 → 1, 끌기 열 번 → 0, 놓음 → 1, 저장 → 지우기 1), 끌기 도중 울린 타이머의 값, 되살리기 한 번·같은 내용 지우기·되살린 것에 쓰기 없음·목록 전 멈춤·실패와 `flush`·`dispose`, 메인 저장소를 임시 폴더로(두 계정, 차례, `.broken`, 버전, 폴더 자리의 오류, 100개, 크기, 모르는 키, `.tmp` 없음, 채널의 epoch와 계정) — **7개 모두 통과**. 그 뒤 새 도면의 이름 규칙을 따로 재서, 시안(`Array.from`으로 153자를 남김)이 그림 글자가 섞인 이름에서 `domain.ts`가 세는 160(UTF-16)을 넘는 것을 찾았다 — 8.5의 글자는 고친 것이고(`'가'.repeat(152) + '😀😀'` → 159, `'😀'.repeat(100)` → 159, 끝에 짝 잃은 대리 문자 없음), KP-6·KP-7이 그 경우를 본다.
- **타입 검사**: 사본을 저장소의 TypeScript와 `@types`로 `strict` 검사 — 새 코드에서 나온 오류 없음(사본 환경의 원래 오류 7개만). 메인 모듈·preload·공용 모듈은 `tsconfig.node.json`과 같은 설정으로 오류 없음.
- **사이드바를 읽는 테스트**: 사본에서 그때 센 열다섯(셋째 검토에서 calendarTransitionPerf는 달력의 사이드바를 읽는 것으로 드러나 지금은 열넷이다, 2.10) 가운데 import가 풀리는 것을 고치기 전·후로 돌려 같은 결과(새 실패 없음). 사용자 메뉴의 fx3 정규식은 고친 뒤 떨어짐을 확인했다(9.2에서 고친다).
- **빌드 묶음**: 이 worktree의 `dist/assets`에서 `domain.ts`의 문장이 이미 `index-*.js`에 있고(mock 경유) 낱말 `rebase-drafts`·`follow-saved`는 `BackgroundLibraryView-*.js`에만 있음을 봤다(2.9). 묶음은 그 글자를 큰따옴표로 쓴다(`"rebase-drafts"`) — 작은따옴표째로 찾으면 어느 묶음에도 없어 검사가 늘 지난다. 10.5는 따옴표 없이 찾고, 있어야 할 묶음에 있는지도 본다.
- **검토로 고친 줄**(2026-10-16 첫 검토 — 본문의 문, 0.3초마다, 이름을 초안처럼 보기, 같은 내용 규칙과 `catchUp`, 신호의 부름 번호·시간 초과·다시 읽기와 점의 정리 줄, 보관 거절의 규칙, 안내의 ×, '＋ 공간 그리기', 선택 창의 `kept`, 새 도면의 편집 중, 저장소의 `files`·`.broken-`, 파일 이름의 대문자 · 둘째 검토 — 디스크까지 내리는 쓰기·잠김 다시·`.broken-`의 번호·`finishKeptEditsBeforeExit`, '편집 시작'의 흐림(앵커 58), 되살리기가 그림 올리기를 기다리지 않음, 고른 도면을 적는 effect, 편집기의 경계와 `discardAll`, `owned`·`drop`의 차례, 신호 타이머의 부름 번호, 검사 창의 흉내)은 **사본에서 앵커·테스트·타입 검사를 다시 돌리지 않았다** — 구현의 단계마다 typecheck·test:background와 게이트 M이 맡는다. 돌려 본 것은 넷이다. ① 지금의 편집기·라이브러리 화면·사이드바에 이 판의 편집기 줄(9.3의 표 가운데 `dialogOpen`·여섯 줄·안내 ×·두 effect·`answerStale`·선택 창의 줄·'＋ 공간 그리기')과 본문의 문을 글자로 넣고 앵커의 규칙을 그대로 셌다: `swallowSecondClick` 8(앵커 52의 새 수), 오류 줄 → 안내 → 띠의 차례(54), `dialogOpen` 열한 번·열한 줄과 그 차례(65), `answerStale`의 첫 `await` 뒤에 렌더의 값 없음(앵커 66의 정규식 — 첫 판의 기다리는 줄은 `'save-maps'`·`maps:`에서 걸렸다), `await persistMaps(` 7·`execute(` 2·`doc.dispatch(` 1, `onDrop=`·`onPaste=` 없음(74), '편집 시작'의 글자는 둘 그대로(58 — 그 태그의 `disabled`는 둘째 검토가 일부러 고친다), 앵커 46의 모양 그대로, 사이드바 아이콘 칸의 첫 `</span>`이 새 줄보다 앞(앵커 82를 첫 `</span>`에서 자르면 안 되는 까닭). ② 저장소의 `mapWorkflow.ts`·`mapDocument.ts`를 그대로 불러 8.1의 두 함수를 돌렸다: 같은 내용·다른 버전은 `current`, 다른 내용은 낮은 버전이어도 `moved`, `follow-saved`는 그 바뀐 초안을 건드리지 않고 `rebase-drafts`가 깨끗하게 만든다, 빈 목록의 `follow-saved`는 깨끗한 초안(다시 실행이 남은 것 포함)을 지운다 — 모두 통과. ③ 점의 테두리 대비를 themes.ts의 여섯 테마 × 두 밝기로 계산했다(가장 낮은 것 5.15:1. 강조색 채움만으로는 밝은 화면의 에메랄드·호박, 어두운 화면의 이혜민 머쉬룸이 카드나 페이지에 대고 2.28~2.86:1). ④ 3.2의 쓰기·잠김·깨진 이름·끄기 직전을 글자대로 순수 JS로 옮겨 이 PC(Windows, Node 22)의 임시 폴더에서 돌렸다: 부르는 차례가 `readFile` → `open` → `writeFile` → `sync` → `close` → `rename`, `sync`가 실패하면 `close`만 하고 `rename` 없이 거절, `EBUSY` 한 번은 넘기고(읽기 둘) 늘 그러면 세 번 뒤 거절(`open` 없음), `EISDIR`은 한 번, 고정 시계로 두 번 깨지면 `.broken-…-1`·`-2` 둘(이 PC의 `rename`은 있던 파일을 말없이 바꿔 친다 — 번호가 없으면 첫 것을 잃는다), 쓰는 중인 넣기가 `finishKeptEditsBeforeExit` 뒤에 디스크에 있고 끝나지 않는 `rename`은 `maxMs`에 돌아온다 — 모두 통과.
- **셋째 검토**(2026-10-16 — 게이트 K·S의 나눔(R1·R4의 띠, K1e), KP-7의 바탕, 단계마다의 import와 effect의 자리, 단계마다 돌리는 묶음, `keptFailed`의 계정, P8의 늦은 거절·P9의 기다림, 깨진 파일을 옮기는 이름 바꾸기, KP-2·KP-5·KP-8과 뮤테이션 (13), R12의 단추 이름, 업데이트 내역과 13.2의 문장, 점의 대비 숫자, 줄 번호의 파일 이름, 사이드바를 읽는 테스트의 수, `CLAUDE.md`의 한 문장)도 사본에서 앵커·테스트·타입 검사를 다시 돌리지 않았다. 돌려 본 것은 넷이다. ① 8.5의 `rescueMapName`·`rescueMapCopy`를 글자대로 옮겨 10.1의 바탕 라이브러리에 대고 이 커밋의 `domain.ts`(진짜 `applyBackgroundCommand`)로 돌렸다: KP-7의 예전 글자대로의 바탕 둘은 **사본이 아니라 바탕 때문에** 던졌다(2층·본관만 지움 → `참조한 상위 항목이 없습니다. …`, 장소·시점만 지움 → `참조한 장소가 없습니다. …`). 고친 바탕(본관 아래를 통째로 지움 / 2층을 먼저 버전 6으로 저장해 연결을 뗀 뒤 지움)에서는 사본이 지나고 부모·장소가 `null`, 카메라의 시점이 빈 목록이었다. 옮겨짐(원래 도면의 버전 6·내용 그대로), 그림 글자가 섞인 이름(159), 이름을 비운 배치(`오브젝트 이름 형식 또는 길이를 확인해 주세요.`)도 10.1대로였고, 10.2 (5)의 다섯 변형(하위 연결·도면의 장소·공간의 장소·시점·부모를 남김)은 저마다 고친 바탕 가운데 하나 이상에서 던졌다. ② 8.1의 `mapDraftSavedAlready`를 이 커밋의 `mapDocument.ts`·`mapWorkflow.ts`로: 같은 버전에서 고쳤다가 다시 고쳐 원래 값인 초안(`past` 둘)은 거짓이고 버전 검사를 빼면 참, 같은 버전의 다른 내용은 둘 다 거짓(KP-5에 더한 경우). ③ themes.ts의 여섯 테마 × 두 밝기 — 채움이 3:1에 못 미치는 것: 에메랄드 밝은 페이지 2.28·카드 2.54, 호박 밝은 페이지 2.86(카드 3.19), 이혜민 머쉬룸 어두운 카드 2.59·페이지 2.82. 테두리는 가장 낮은 것 5.15(바이올렛 어두운 카드), `deriveThemeFromAccent`의 색상각 0~359는 5.36 이상(7.1). ④ 이 커밋의 main.ts에 3.4의 새 줄을 메모리에서 넣고 `tests/motion/comments-notify-review-fix.test.ts:133-144`의 before-quit 검사를 그대로 돌렸다: `lastIndexOf('rendererFlush,')`가 새 줄에 떨어지지만 업데이트 적용의 `if` 앞이라 지난다(12절). 그 밖에 글자로 센 것: 줄 번호만 쓴 곳 가운데 다른 파일을 뜻하던 여섯 줄(useBackgroundStore.ts · BackgroundLibraryView.tsx 두 줄 · electron/personalTodoRecoveryJournal.ts · src/App.tsx · backgrounds-map.css)에 파일 이름을 붙였고, 2.1의 `LazyErrorBoundary` 인용을 src/App.tsx:3301의 글자 그대로 고쳤다. `Sidebar.tsx`를 읽는 테스트는 열넷이다(2.10).
- 돌리지 않은 것: 검사 창·설치된 앱·`npm run build:vite`(이 작업의 규칙상) — 10.3·10.4·10.5가 맡는다.
