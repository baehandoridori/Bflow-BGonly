# BAE경 작업대 시안 (구현 기준)

BAE경 화면을 만들 때 나란히 놓고 맞추는 시안이에요 (계획 `14b` 10-2, `14d`, `14e`).

| 무엇 | 내용 |
|---|---|
| 원본 | 캔버스 아티팩트 'BAE경 작업대 시안 (Bflow 메인 화면 · 景 아이콘)' — https://claude.ai/artifact/7ZJbWSKo7ARQYb3jYRes2i (6판, 2026-11-12) |
| 이 폴더 | `canvas/` — 그 캔버스의 원본 `.dc.html` 20장과 `canvas.json` (2026-11-13에 아티팩트에서 받은 판 `1794549433-92f6`) |
| 없는 것 | 계획이 말한 핸드오프 묶음 `BAE경_작업대_시안_핸드오프.zip`(미리보기 HTML 55장 · 그림 · 景 SVG 파일 · README)은 한솔 PC의 다운로드 폴더에 없었어요. 그래서 캔버스 원본만 넣었어요. 묶음을 찾으면 `preview/` · `assets/` · `icons/`를 이 폴더에 더해요 |

## 장 목록 (`canvas.json`의 순서)

| 파일 | 장 |
|---|---|
| `Main.dc.html` | 작업대 (기본) |
| `SideOpen.dc.html` | 작업대, 사이드바 펼침 |
| `Light.dc.html` | 작업대, 라이트 |
| `OrderingSmall.dc.html` | 작업대, 주문서 쓰는 중 |
| `Drawing.dc.html` | 작업대, 그리는 중 |
| `Dropping.dc.html` | 작업대, 그림을 끌어다 놓는 중 |
| `Ordering.dc.html` | 만드는 화면, 주문서 쓰는 중 |
| `Making.dc.html` | 만드는 화면, 그리는 중 |
| `Zoom.dc.html` | 작업대, 결과 크게 보기 |
| `Empty.dc.html` | 작업대, 비어 있음 |
| `Loading.dc.html` | 작업대, 불러오는 중 |
| `Error.dc.html` | 작업대, 오류 |
| `WinNew.dc.html` · `WinSame.dc.html` · `WinStyle.dc.html` · `WinLayers.dc.html` · `WinAngle.dc.html` · `WinUpscale.dc.html` · `WinDenoise.dc.html` | 팝업 창 일곱 개 (`14d`) |
| `Icon.dc.html` | 景 아이콘과 낙관 |

## 읽는 법

- 각 파일은 캔버스 런타임(`support.js`)으로 그려지는 Design Component 페이지예요. 그림은 아티팩트의 저장소(`/_blob/…`)에 있어서, 이 폴더만으로는 그림이 비어 보여요. 눈으로 볼 때는 위의 아티팩트 링크를 열어요.
- 색 · 간격 · 크기 값은 각 파일 머리의 `<style>`에 있어요 (`[data-mode]`가 다크, `[data-mode="light"]`가 라이트). 구현은 그 값을 `src/features/bae-gyeong/bae-gyeong.css`로 옮겼고, 클래스 이름은 `bae-` 접두어를 그대로 써요 (버튼 `.btn` → `.bae-btn`).
- 6판 시안에는 탭 줄에 '만들기'가 있지만 11-12 결정(`14e` 1장)으로 뺐어요. 만드는 창 · 투시 가이드는 시안이 없어 `14e`의 글대로 만들어요.
