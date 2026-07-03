# 캐릭터 현황판 심층 리뷰 & 수정 계획서

> **작성일**: 2026-07-03 | **대상 브랜치 기준**: `claude/elated-bouman-24e566` (main 최신과 동일 상태)
> **목적**: 캐릭터 현황판의 UI/UX 문제점·코드 품질 문제를 근거(파일:라인)와 함께 진단하고, 사용자 피드백 9건을 포함한 수정 계획을 **실행 에이전트(Opus/Codex)가 이 문서 하나만 보고 구현할 수 있는 수준**으로 기술한다.
> **방법론**: 멀티에이전트 정적 리뷰 — 구조 지도 1 + 차원별 리뷰 4(UX/비주얼/인터랙션·접근성/코드 품질) + 피드백 설계 4그룹, 이후 **전 항목 적대적 검증**(발견 52건 + 계획 9건 각각 별도 에이전트가 코드를 다시 열어 반박 시도). 판정: 발견 52건 = CONFIRMED 43 / CORRECTED 9 / REFUTED 0, 계획 9건 = CONFIRMED 3 / CORRECTED 6. UX 평가 기준은 Nielsen 10 휴리스틱 + 인지부하 체크 + 페르소나 워크스루(impeccable 스킬 critique 방법론).

---

## 0. 실행 에이전트 지침 (필독)

1. **CLAUDE.md 필수 규칙 준수**: 렌더러에서 직접 Supabase 호출 금지(IPC → 메인 → Supabase), 모든 데이터 변경은 낙관적 업데이트 + 실패 시 롤백, 새 기능은 supabaseService 경유. 커밋 메시지는 한글.
2. **검증 게이트**: 각 PR 단위로 `npm run typecheck` + `node --test tests/characterBoardAssetWorkflow.test.ts`(및 신규 테스트) + `npm run build:vite` 통과를 확인한 뒤 완료로 표시한다.
3. **교정 우선 규칙**: §6 카탈로그의 각 항목에 붙은 `검증 교정` 블록은 적대적 검증자가 원 설계의 오류를 바로잡은 것이다. **본문 fix와 교정이 충돌하면 교정이 우선한다.** §5(피드백 9건)는 교정을 이미 본문에 병합한 최종본이므로 그대로 따르면 된다.
4. **실행 순서 준수**: §4의 PR 분할·순서 제약을 지킬 것. 특히 "좌측 3버튼"처럼 **한쪽 계획이 삭제하는 요소를 다른 항목이 제자리 수정하지 않도록** §4.3 충돌 해결 규칙을 먼저 읽는다.
5. **게이트**: PR 생성까지만 자동으로 진행한다. **머지·G드라이브 배포·라이브 DB 마이그레이션 적용·슬랙 공지는 한솔 명시 승인 후에만** 수행한다. `DEVLOG/update-notes.json`과 PR의 "업데이트 요약"은 비개발자 톤 규칙(CLAUDE.md)을 따른다.
6. **테스트 특성 주의**: `tests/characterBoardAssetWorkflow.test.ts`는 소스 파일을 `readFileSync`로 읽어 **문자열/정규식으로 원문을 고정**하는 회귀 테스트다. 코드를 옮기거나 문구를 바꾸면 테스트 앵커도 함께 갱신해야 한다(각 항목의 위험 절에 개별 명시).

---

## 1. 대상 파일과 현재 구조

### 1.1 파일 목록

| 파일 | 줄수 | 책임 |
|---|---|---|
| `src/views/CharacterBoardView.tsx` | 1618 | 메인 뷰 (모놀리스 — §6 CQ-1) |
| `src/components/characters/CharacterImageFrame.tsx` | 88 | 배경 + fit transform 표시 전용 |
| `src/components/characters/CharacterImageContextMenu.tsx` | 117 | 이미지 우클릭 메뉴 |
| `src/components/characters/CharacterImageFitEditor.tsx` | 500 | "썸네일 맞추기" 편집기 (3:4 크롭 프레임) |
| `src/components/characters/CharacterImageLightbox.tsx` | 149 | 크게보기 |
| `src/stores/useCharacterBoardStore.ts` | 583 | 데이터/낙관적 업데이트/Realtime 머지 |
| `src/hooks/useCharacterBoardAccess.ts` | 73 | metadata 기반 fail-closed 접근 게이팅 |
| `src/utils/characterAssets.ts` | 64 | fit/background 정규화 + 폴더 유도 |
| `src/views/EpisodeAssetBoard.tsx` | — | '에피소드 에셋' 탭 |
| `src/components/spotlight/SpotlightSearch.tsx` | 728 | Ctrl+Space 전역 검색 (**캐릭터 미통합**) |
| `electron/main.ts`, `electron/preload.ts`, `electron/supabase.ts`, `electron/storage.ts` | — | IPC/Realtime/스토리지 |
| `tests/characterBoardAssetWorkflow.test.ts` | 195 | 소스 문자열 회귀 테스트 |

### 1.2 컴포넌트 트리 (라인 앵커 포함)

```
CharacterBoardView (CharacterBoardView.tsx:1578)  ← 탭 전환 + load()/startRealtime()
├─ CharacterGrid (:1460)  ← 검색/태그필터/카드그리드/로딩·에러
│  ├─ CharacterCard (:414)  ← 카드 1장 (대표이미지 aspect-[4/3] + 복장수 + 디자인/리깅 배지)
│  └─ CharacterDetailModal (:1316)  ← 전체화면 오버레이 (좌 목록 / 우 상세 / 댓글)
│     ├─ CharacterListRow (:915)  ← 좌측 목록 행 (raw <img> object-cover — fit/배경 미적용 유일 지점)
│     ├─ CharacterDetailPanel (:1012)  ← 우측 상세 본체
│     │  ├─ FeaturedImageSlot (:551) — 대표 이미지(3:4) + 업로드 + 하단 3버튼 + 우클릭 메뉴/FitEditor
│     │  ├─ CostumeIdentity (:709) / CostumeMemoInput (:690)
│     │  ├─ CostumeThumbCard (:951) — 복장 갤러리 썸네일(3:4)
│     │  ├─ CostumeDetail (:791) — 버전/작업경로(PathActionRow :752)/StageRail(:335)/태그(TagChipSection :471)
│     │  └─ CharacterImageContextMenu·FitEditor·Lightbox (조건부 :1277-1311)
│     └─ CommentPanelResizable (sceneKey=`char:{id}`) (:1391)
├─ EpisodeAssetBoard ('에피소드 에셋' 탭)
└─ AddCharacterModal (:1413)
```

### 1.3 "작업 폴더 / 작업 파일" 3중 노출 (피드백 4의 실체)

동일한 데이터(폴더=`characters.work_folder_path` 캐릭터 단위, 파일=`character_costumes.work_file_path` 복장 단위)에 대한 진입점이 상세 패널 안에 3곳:

1. **좌측 FeaturedImageSlot 하단 3버튼 (:624-649)** — `작업 폴더`(:627): 등록돼 있으면 열기, 없으면 OS 폴더 선택(= 등록 겸용 **이중 동작**). `작업 파일`(:635) 동일. `이미지 복사`(:641).
2. **우측 CostumeDetail "작업 경로" PathActionRow 2박스 (:843-856)** — `선택`(경로 설정) + `열기`(출력) 버튼 분리.
3. **이미지 우클릭 메뉴 (CharacterImageContextMenu.tsx:112-113)** — 열기 전용(미등록 시 disabled).

**그리드 카드 우클릭(:1563-1567)은 메뉴 없이** 폴더가 등록돼 있으면 즉시 탐색기를 열고, 없으면 toast만 띄운다. CharacterImageContextMenu는 카드에 연결되어 있지 않다.

### 1.4 이미지 파이프라인

1. 업로드(:572-592): `resizeBlob(file, 800, png?0.92:0.8)` → IPC `storage:upload-character-image` → `scene-images` 버킷 `characters/{characterId}/{costumeId}/{uniq}.{ext}` → public URL.
2. 저장: `updateCostumeField({featuredImageUrl})`. 실패 시 방금 올린 파일 삭제(:583-585). **이전 이미지는 메인 프로세스가 DB 업데이트 성공 후 스토리지에서 즉시 영구 삭제**(electron/supabase.ts:3981-4007).
3. 썸네일 맞추기: 산출물 = `CharacterImageFit {scale, scaleX, scaleY, x, y, lockAspect}` (원본 무수정, 표시 변환만) → `character_costumes.image_fit` JSONB. **편집기 크롭 프레임은 3:4 고정**(CharacterImageFitEditor.tsx:335).
4. 배경: `image_background` TEXT, **DB DEFAULT 'black'**(2026-06-29 마이그레이션:16), 4값 CHECK.
5. 표시(CharacterImageFrame): `object-contain` `<img>`에 `transform: translate(x%,y%) scale(sx,sy)` origin center(:72-76). translate %는 이미지 자신의 contain 박스 기준 → **프레임 비율이 같으면 구도가 1:1 재현, 다르면 왜곡**.
6. 비율 현황: FitEditor 3:4, 상세 대표 3:4(:606), 복장 썸네일 3:4(:976), **그리드 카드만 4:3**(:436), 라이트박스는 화면 크기 가변 프레임에 **fit을 그대로 재적용**(CharacterImageLightbox.tsx:106-112).

### 1.5 상태 흐름

- store: 단일 zustand store. `characters / costumes / byCharacter(파생 Map) / episodeLinks / loaded / loading / loadError`. 복장 update는 공통 헬퍼 `applyCostumeUpdate`(store:520-558) — 낙관 반영 → IPC → 실패 시 **필드 단위 조건부 롤백**. add 계열은 낙관 없이 서버 결과 머지(:205-220, :286-301).
- Realtime: 메인이 단일 채널 `public:character_board`에서 3테이블 구독(electron/supabase.ts:4112-4140) → 전 창 broadcast(`character-board:realtime`) → `receiveRealtime`(store:420-484) 머지. **이 채널은 앱 실행 중 항상 켜져 있다**(위젯 합류의 기반 — FB-8).
- 접근 게이팅: `useCharacterBoardAccess`(fail-closed) — 사이드바 노출 + App.tsx:2808-2809 뷰 분기(`'character-board'`, 무권한 시 Dashboard 렌더).
- 순서 강제: 이미지 업로드/작업 파일 선택은 복장(costume)이 있어야 함 — 가드가 **파일 선택이 끝난 뒤**에 toast로 거부(:573, :1088-1091). 첫 복장은 수동 "디자인 추가"(:1248-1256, `복장 N` 자동 명명 :1122-1129)로만 생성.

---

## 2. 종합 진단 (Executive Summary)

### 2.1 잘 만들어진 것 (유지할 자산)

- **store의 낙관적 업데이트 설계가 견실하다**: 복장 update의 필드 단위 조건부 롤백(동시 편집 보호), 업로드 실패 시 고아 파일 정리, 동일 단계 재클릭 no-op, UNIQUE 충돌 회피 자동 명명. 실패 토스트도 전부 비개발자 문장.
- **표시 계층 분리**: CharacterImageFrame(표시) / FitEditor(저작) / ContextMenu(조작)의 역할 분리는 올바른 구조다 — 문제는 이 좋은 부품들이 **프레임 비율·적용 규칙 없이** 조립된 것.
- **StageRail·태그 칩·에피소드 칩** 등 인식형(recognition) UI 문법과 디자인 토큰 준수(다크 기준)는 앱의 다른 뷰와 잘 정렬돼 있다.

### 2.2 Nielsen 휴리스틱 채점 — 22/40 (Acceptable: 사용자 만족 전 상당한 개선 필요)

| # | 휴리스틱 | 점수 | 핵심 근거 |
|---|---|---|---|
| 1 | 시스템 상태 가시성 | 3 | 로딩/업로드 중/에러+재시도 양호. 작업 폴더·파일 버튼이 등록 여부를 라벨에 안 드러냄(:627,:635), 권한 없음은 무언 폴백 |
| 2 | 시스템-실세계 일치 | 3 | 도메인 용어 적절. '디자인'이 엔티티(복장)와 공정 단계를 동시에 지칭하는 중의성(:1233 vs :459) |
| 3 | 사용자 제어와 자유 | 2 | 삭제·이미지 교체·연결 해제 전부 undo 부재, 이미지 교체는 이전본 영구 삭제(:580), archived(soft-delete)는 UI 미노출 |
| 4 | 일관성과 표준 | **1** | 우클릭 3원화(:1563/:610/:929 무반응), window.confirm vs 앱 표준 ConfirmDialog, 작업 경로 UI 3종, 목록 썸네일만 fit 미적용(:939). **최약점** |
| 5 | 오류 예방 | 2 | 좋은 방어(no-op, UNIQUE 회피)와 나쁜 순서(파일 선택 후 거부 :573, 미등록 버튼 클릭이 조용히 경로 등록 :627) 혼재 |
| 6 | 회상보다 인식 | 2 | 우클릭 기능 3곳 완전 비가시, 칩 툴팁이 우클릭 동작만 설명(:1217), 상세 진입 시 그리드 필터 컨텍스트 소실 |
| 7 | 유연성과 효율성 | 2 | 미시 효율(휠 가로 스크롤, 방향키)은 챙겼으나 Spotlight 미색인·정렬·일괄 작업 부재로 규모 효율 없음 |
| 8 | 미학·미니멀 | 3 | 토큰 준수·위계 명확. 빈 카드 0/0 배지 소음, 작업 경로 3중 중복 감점 |
| 9 | 오류 인식·복구 | 3 | 비개발자 문장 토스트·인라인 에러+재시도 견실. 원인/다음 행동 미안내만 아쉬움 |
| 10 | 도움말 | **1** | 숨은 기능(우클릭 3종)이 title 한 줄 또는 무표기. 첫 사용 순서를 알려주는 장치가 토스트 거절뿐 |

### 2.3 심각도 분포와 4대 근본 테마

**P0: 0건 / P1: 9건 / P2: 20건 / P3: 23건** (총 52건, §6 카탈로그).

이 52건과 피드백 9건은 대부분 아래 4개 근본 원인으로 수렴한다:

- **T1. 프레임 비율·fit 적용 규칙의 부재** — fit 데이터는 3:4 기준으로 저작되는데 카드는 4:3, 라이트박스는 가변 프레임에 재적용, 목록 행은 미적용. → 피드백 2·5, VD-2, UX-13. **§4.3 규칙 R2로 일괄 해결.**
- **T2. 동일 행동=동일 UI 위반** — 우클릭 3원화, 이중 동작 버튼, 작업 경로 3중 노출, window.confirm 혼용. → 피드백 4, UX-2·3·4, INT-5·7. **피드백 4의 재구성 + 규칙 R1·R4로 해결.**
- **T3. 위계(캐릭터→복장→이미지)를 사용자에게 전가** — 첫 사용 흐름이 토스트 거절로 학습됨. → 피드백 6, UX-1. **자동 생성(A+B 병행)으로 해결.**
- **T4. 피처 자급 구조의 고립** — 캐릭터 store가 앱의 검색(Spotlight)·개인 업무(나의 할일)·담당자 집계에 미합류. → 피드백 1·8, UX-5. **딥링크 페이로드 + 위젯 합류로 해결.**

코드 품질 측면은 **1618줄 모놀리스(CQ-1)** 와 **죽은 코드 3건(CQ-4: 미사용 ImageLightbox :526-548, AssigneeNamePicker 'stack' variant, store.updateCharacterMemo)** 이 대표적이며, 아키텍처 규칙 위반(렌더러 직접 Supabase 호출)은 **발견되지 않았다**.

---

## 3. (요약) 사용자 피드백 9건 ↔ 계획 매핑

| # | 피드백 요지 | 계획 ID | 근본 원인 (한 줄) |
|---|---|---|---|
| 1 | Ctrl+Space에서 캐릭터 검색 | FB-1 | Spotlight가 캐릭터 store 이전에 만들어져 검색 소스에 미등록 + 권한 게이팅 설계 필요 |
| 2 | 카드에서 기본모습 전신이 보이게 | FB-2 | 카드만 4:3 — 3:4로 저작된 fit이 다른 비율 창으로 재해석되어 상하가 잘림 |
| 3 | '이미지 복사' 버튼 줄바꿈 + 전역 방지 | FB-3 | 76px 셀 < 라벨 최소폭 + 전역 `white-space` 기본값 부재 |
| 4 | 폴더/파일 UI 중복 정리 + 카드 우클릭 메뉴 | FB-4 | 진입점 3중 설계 + 카드 우클릭이 MVP 하드코딩(즉시 열기)으로 잔존 |
| 5 | 크게보기 비율 이상 | FB-5 | 썸네일용 fit transform을 라이트박스 대형 가변 프레임에 재적용 |
| 6 | 첫 작업 자동화(복장1 자동 생성) | FB-6 | 위계 노출 + 가드가 파일 선택 이후에 위치 |
| 7 | 기본 배경 투명 | FB-7 | 기본값 'black'이 4곳에 중복 정의 (DB DEFAULT/상수/prop/fallback) |
| 8 | 리깅 작업 리소스 포함, 인원별 현황 | FB-8 | 나의 할일 위젯이 씬+개인 할일만 아는 폐쇄 인터페이스 |
| 9 | 캐릭터 폴더 만들기 버튼 | FB-9 | 폴더 생성 IPC 전무 + 팀 공용 기준 경로 개념 부재 |

---

## 4. 실행 순서 · PR 분할 · 충돌 해결 규칙

### 4.1 PR 분할 (권장 8개 + 백로그 1개)

| PR | 내용 | 포함 항목 | 선행 조건 |
|---|---|---|---|
| **A. 이미지 표시 정합** | 카드 3:4 전환, 라이트박스 fit 제거, 기본 배경 투명, 죽은 라이트박스 삭제 | FB-2, FB-5, FB-7, CQ-4(ImageLightbox 삭제분) | 없음 — 즉시 착수 가능 |
| **B. 상세 패널·워크플로우 재구성** | 복장 자동 생성 → 좌/우 영역 정리 + 카드 우클릭 메뉴 → 버튼 줄바꿈(국소+전역) → 용어 통일 | FB-6 → FB-4 → FB-3, UX-7, (자동 해소: UX-1·UX-2 좌측분·UX-3·INT-5·VD-3 좌측분) | A와 독립, 병렬 가능 |
| **C. 검색·딥링크** | Spotlight 캐릭터 카테고리 + pendingCharacterBoardRequest | FB-1 | 없음 |
| **D. 폴더 만들기** | path:create-folder IPC + 기준 경로 설정 + 만들기 버튼 | FB-9 | **B의 FB-6 머지 이후** (버튼 도달성) |
| **E. 나의 할일 합류** | 캐릭터 작업(디자인/리깅) 위젯 합류 | FB-8 | **C 머지 이후** (딥링크 재사용) |
| **F. 안전·접근성·인터랙션** | ConfirmDialog+보관(archive), Escape 계층화, 포커스/타겟/키보드 | UX-4, UX-8, UX-9, UX-10, INT-1, A11Y-2, A11Y-3, INT-4, A11Y-8, A11Y-9, INT-10, INT-12, INT-13, INT-14, MO-11, INT-6 | B 이후 권장(좌측 버튼 삭제 반영) |
| **G. 비주얼 토큰·라이트 모드** | 단계색 CSS 변수화, 대비 회복, z-index 체계, 빈 상태 | VD-1, VD-4~VD-11, UX-6, UX-11, UX-12, UX-13, UX-14 | B 이후 권장 |
| **H. 코드 품질 리팩터링** | 모놀리스 분해(동작 변경 없음), 중복 제거, 타입 강화, 성능 | CQ-1~CQ-13 (잔여분) | **A~G 머지 이후 마지막** — 기능 변경과 순수 이동을 섞지 않는다 |
| **I. 견고성 백로그** | 이미지 onError, Realtime 재연결 catch-up, echo 레이스, 동시 생성, 삭제 고지, 게이팅 재시도 | GAP-A~E, GAP-H (§7) | 별도 논의 후 |

### 4.2 필수 순서 제약 (위반 시 재작업 발생)

1. **FB-6 → FB-9**: '폴더 만들기' 버튼의 권장 위치(작업 경로 행)는 복장이 있어야 렌더된다. FB-6(캐릭터 생성 시 '복장 1' 자동 생성)이 먼저 들어가야 신규 캐릭터에서 버튼이 항상 도달 가능하다.
2. **FB-4 → FB-3 1단계**: FB-3의 좌측 버튼 재구성은 FB-4가 '작업 폴더/작업 파일' 버튼을 삭제한 **뒤의** 2버튼 레이아웃을 전제로 한다. 같은 PR에서 FB-4 먼저.
3. **UX-7(용어 통일) → FB-6**: 자동 생성 이름('복장 1')과 버튼 라벨이 어긋나지 않도록, 같은 PR에서 용어 통일을 먼저 적용한다. **통일 결정: 엔티티는 '복장'** (§4.3 R3).
4. **FB-1 → FB-8**: FB-8의 위젯 행 클릭 네비게이션은 FB-1이 만드는 `pendingCharacterBoardRequest`를 재사용한다 (검증 교정으로 CustomEvent 방식 폐기).

### 4.3 충돌 해결 규칙 (여러 항목이 같은 코드를 다르게 바꾸려는 지점)

- **R1. 좌측 3버튼(:624-649)은 '고치지 말고 없앤다'.** UX-2(상태 기반 라벨 분기), VD-3 1안(compact-label), A11Y-8(해당 버튼 타겟 확대)의 좌측 버튼 제자리 수정안은 **실행하지 않는다** — FB-4가 두 버튼을 삭제하고 FB-3이 남는 2버튼을 재구성하는 것으로 대체된다. UX-2의 잔여 가치(등록 성공 toast, 우측 '선택'과의 역할 분담)는 FB-4 설계에 이미 포함.
- **R2. fit 적용 규칙 명문화**: "**축소 요약 표면**(그리드 카드·복장 썸네일·상세 대표·좌측 목록 행)은 fit+배경을 **적용**하고, **원본 확인 표면**(라이트박스)은 fit을 **미적용**(배경은 적용)한다." — FB-5(라이트박스 fit 제거)와 UX-13(목록 행에 fit 적용)은 이 규칙 아래 서로 모순이 아니다. 이 규칙을 CharacterImageFrame 사용처 주석으로 남길 것.
- **R3. 용어 통일 = 엔티티 '복장'**: UI 라벨을 '복장'으로 통일(:1233 '복장', :1251/:1255 '복장 추가', :1270 빈 상태 문구, :573/:1089 토스트). 공정 단계를 뜻하는 '디자인 단계' 레일(:861)·'디자인 N/M' 배지(:459)는 그대로 → 중의성 해소. FB-6 자동 이름 '복장 N'과 정합.
- **R4. 삭제 확인 = ConfirmDialog.show**: `window.confirm` 3곳(캐릭터 :1173, 복장 :1002, EpisodeAssetBoard.tsx:193)을 전부 `ConfirmDialog.show({ message, confirmLabel: '삭제', tone: 'danger' })`로 교체한다(API는 `.show`이지 `.confirm`이 아님 — INT-7 교정). Host는 App.tsx:2948에 이미 마운트됨.
- **R5. FB-7(투명 기본) × VD-1(라이트 모드)**: 투명 배경은 카드 배경(`bg-bg-border/30`, 라이트 모드에선 밝음) 위에 그려지므로, 밝은 선화/흰 의상 이미지가 라이트 모드에서 소실될 수 있다. **PR G에서 라이트 모드 QA 시 '투명 배경 + 라이트 모드' 조합을 체크리스트에 포함**하고, 문제가 확인되면 투명일 때만 체커 힌트 배경(매우 옅은 체커)을 라이트 모드 한정 적용하는 후속안을 검토한다(선반영 금지 — 실측 후 결정).
- **R6. z-index 체계**: 현재 z-50(상세 모달)/60(죽은 코드)/70(라이트박스)/80(컨텍스트 메뉴)/85(담당자 모달)/90(FitEditor) 임의 사다리. PR G에서 시멘틱 상수(모달 < 라이트박스 < 메뉴 < 편집기)로 정리하되, **상대 순서는 현행 유지**(동작 변경 없음).

---

## 5. Part A — 사용자 피드백 9건 상세 수정 계획

> 각 항목은 적대적 검증(CONFIRMED/CORRECTED)을 통과했고, **교정 사항은 본문에 이미 병합**되어 있다. 아래 설계를 그대로 구현하면 된다.

---

### FB-1. Ctrl+Space 검색에서 캐릭터 이름으로 진입 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "컨트롤-스페이스를 통한 검색 기능에서, 캐릭터 이름을 검색하여 들어갈 수 있도록 수정."

**현재 동작**: Spotlight(SpotlightSearch.tsx)의 ResultCategory는 `scene|assignee|episode|part|memo|event|action` 7종뿐(:18)이고, 결과 빌드(:220-531)는 useDataStore·캘린더·metadata만 소스로 쓴다. useCharacterBoardStore는 import조차 없어 캐릭터 이름을 입력하면 '검색 결과가 없습니다'(:639-643). 캐릭터 데이터는 CharacterBoardView 마운트 시에만 load()되므로(:1586-1590) 현황판을 연 적 없는 세션에서는 store가 비어 있다. '특정 캐릭터 상세 자동 오픈' 배관(pendingOpenId → setDetailId, :1475-1477)은 이미 있으나 **뷰 로컬 state(:1584)라 외부에서 설정 불가**.

**왜 문제인가**: 캐릭터 현황판만 전역 검색에서 소외된 기능 섬이다. 캐릭터가 늘수록(50+) 사이드바 → 현황판 → 그리드 검색의 3단 이동을 반복하게 되고, 다른 엔티티(씬/담당자/에피소드)는 다 되는데 캐릭터만 안 되는 비일관이 학습을 방해한다. 접근 게이팅(fail-closed) 때문에 단순히 카테고리만 추가하면 무권한 사용자가 검색으로 진입 시도 → Dashboard로 떨어지는 어긋난 동선이 생기므로 권한 분기가 함께 필요하다.

**수정 설계**:

1. **[useAppStore에 딥링크 페이로드]** `pendingSceneModalRequest`(:63-77, :282-283)와 동일한 store 기반 요청 패턴을 미러링한다(커스텀 이벤트는 lazy 뷰 마운트 레이스로 유실 — 주석 :57-61의 기존 결정 준수). `pendingCharacterBoardRequest: { characterId: string } | null` + `setPendingCharacterBoardRequest(req)` 추가. `goBackNavigation`(:250-280)이 pendingSceneModalRequest를 청소하는 지점(:273) 옆에 이 필드도 null 청소 추가.
2. **[CharacterBoardView에서 소비]** CharacterBoardView(:1578)에 effect 추가: `pendingReq`와 `loaded`를 구독해 **loaded=true일 때만** `setTab('board'); setPendingOpenId(pendingReq.characterId); setPendingCharacterBoardRequest(null)`. loaded 게이트가 핵심 — 로드 전이면 detailId 정리 효과(:1472)가 모달 오픈을 무산시킨다. 삭제된 캐릭터면 :1472가 조용히 정리(우아한 실패). **[교정 병합 ①]** 로드 지연/에러 중 사용자가 사이드바로 이탈하면 요청이 무기한 잔류하므로, **CharacterBoardView 언마운트 cleanup에서 미소비 요청을 null로 청소**한다.
3. **[재선택 보장 — 교정 병합 ②]** 상세 모달이 열린 채 좌측 목록으로 내부 이동(selectedId 변경)한 뒤 Spotlight로 최초 캐릭터를 재선택하면 detailId가 이미 같아 아무 일도 안 일어난다. **CharacterGrid의 detailId 상태를 `{ id: string; nonce: number } | null`로 확장**하고, pendingOpenId 소비와 카드 클릭 시 nonce를 증가시키며, `<CharacterDetailModal key={`${id}:${nonce}`}>`로 리마운트를 강제한다.
4. **[Spotlight 데이터 소스 + 권한 + 지연 로드]** (a) `useCharacterBoardAccess()` 호출(Sidebar.tsx:212와 동일 자급 패턴). (b) `characters`/`byCharacter` 구독. (c) Spotlight가 열릴 때 1회 로드: `if (isOpen && hasAccess && !loaded && !loading) void load({ silent: true })` — **무권한 사용자는 IPC 로드 자체를 트리거하지 않는다**(fail-closed 유지; 이 가드를 빼면 '메뉴는 안 보이는데 검색은 되는' 노출 구멍).
5. **[load silent 옵션]** useCharacterBoardStore.load(:163-197) 시그니처를 `load(opts?: { silent?: boolean })`로 확장, catch의 toast.error(:195)를 `if (!opts?.silent)`로 감싼다(Spotlight만 열었는데 현황판 에러 토스트가 뜨는 어긋남 방지). loadError는 그대로 세팅 → 보드 진입 시 재시도 UI(:1508-1520) 정상.
6. **[카테고리/매칭/표시]** ResultCategory에 `'character'`, CATEGORY_LABELS에 `캐릭터`, CATEGORY_ORDER는 `['action','scene','part','assignee','character','episode','memo','event']`(이름으로 찾는 엔티티라 assignee 뒤). 아이콘은 사이드바와 동일한 lucide `Drama`(Sidebar.tsx:53). 매칭: 이름 `fuzzyScore` 1.0배 + 복장 태그(structureTags/assetTags) 0.8배 — 그리드 필터가 이름+태그인 것과 정합(:1493-1501). `status==='archived'` 제외. 부제: 이름 매칭 시 `복장 N개 · M편 등장`, 태그 매칭 시 `태그 "{matchedTag}" · 복장 N개`(매칭 근거를 같은 화면에 — 기억 다리 금지). pct/meta 미부여(디자인·리깅 2축을 단일 %로 뭉개면 오해). action: `setView('character-board')` + `setPendingCharacterBoardRequest({ characterId })` + close. `pushNavigationBackTarget`는 기존 Spotlight 동선과 동일하게 미호출. placeholder(:620)는 권한 보유 시 '씬번호, 담당자, 캐릭터, 에피소드 검색...'으로 분기. (선택) 빈 쿼리 빠른 액션에 권한 보유 시 '캐릭터 현황판' 이동 1개 추가.
7. **[테스트]** 기존 스타일에 맞춰: 권한 게이트 하에서만 캐릭터 결과 push, goBackNavigation의 요청 청소, loaded 게이트 소비를 소스 문자열로 검증.

**UX 결정(근거 포함)**: 선택 시 **상세 모달 직행**(카드 하이라이트 아님) — (1) 원문이 '검색하여 들어갈 수 있도록'(진입), (2) 에피소드 에셋 탭의 '캐릭터 현황판에서 보기'가 이미 상세 직행이라 동일 행동=동일 UI, (3) highlightSceneId식 글로우 인프라 신설보다 코드 영향이 작다.

**변경 파일**: `src/components/spotlight/SpotlightSearch.tsx`, `src/stores/useAppStore.ts`, `src/views/CharacterBoardView.tsx`, `src/stores/useCharacterBoardStore.ts`, `tests/characterBoardAssetWorkflow.test.ts`

**수용 기준**:
- 현황판을 한 번도 열지 않은 세션에서 Ctrl+Space로 캐릭터 이름(부분/퍼지 포함) 검색 → '캐릭터' 카테고리 결과 표시.
- 선택 시 현황판 '캐릭터 현황판' 탭 전환 + 로드 완료 후 해당 캐릭터 상세 모달 자동 오픈. **모달이 이미 열려 있고 내부에서 다른 캐릭터로 이동한 상태에서도 재선택이 동작**(nonce 리마운트).
- 무권한 사용자에게 캐릭터 카테고리 미노출 + 캐릭터 IPC 로드 미발생.
- 복장 태그 검색 매칭 + 부제에 태그 표시. archived 미노출. 선택 직후 타인이 삭제한 캐릭터면 에러 없이 그리드만 표시. silent 로드 실패 시 토스트 없음.
- typecheck + 테스트 + build:vite 통과.

**위험·완화**: ① useCharacterBoardAccess 3번째 마운트로 시작 시 metadata 조회 1회 추가 — 의도적 무캐시 설계와 동일 패턴, 허용. ② Spotlight 선로드 데이터는 Realtime 미구독이라 이름 변경이 즉시 반영 안 될 수 있음 — 현황판 진입 시 load() 재호출(:1587)로 최신화. ③ silent 실패 후 loadError=true → Spotlight 재오픈 시 `!loaded && !loading` 재시도 조건 성립(자동 재시도) 확인. ④ 테이블 RLS는 allow_all — 이 게이팅은 기존과 동일한 UI 게이팅 수준(보안 후퇴 없음).

---

### FB-2. 카드가 캐릭터 전신을 보여주도록 — 그리드 카드 3:4 전환 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "기본적으로 보여지는 카드가 캐릭터의 기본모습이 다 보일 정도로 세팅되면 좋겠음. 썸네일 맞추기 기능을 통해 제작한 그 이미지를 그대로 보여주게끔."

**현재 동작**: 카드 이미지 영역은 가로형 `aspect-[4/3]`(:436), '썸네일 맞추기' 크롭 프레임은 세로형 `aspect-[3/4]` 고정(FitEditor:335). 상세 대표(:606)·복장 썸네일(:976)은 3:4로 편집기와 일치하고 **카드만 4:3**. fit의 translate %는 이미지의 contain 박스 기준이라 **프레임 비율이 3:4로 같으면 크기와 무관하게 편집기 구도가 1:1 재현**되지만, 4:3 카드에서는 crop window가 달라져 편집기에서 확대(scale>1)해 잡은 구도의 **위아래(머리/발)가 잘린다**. 예: 600×800 원화 → 240×180(4:3) 프레임에서 contain 박스 135×180, 1.3배 구도는 세로 234px → 상하 54px 소실. 이것이 '기본모습이 다 안 보인다'의 실체다.

**왜 문제인가**: 사용자가 편집기에서 정성껏 맞춘 구도가 정작 가장 많이 보는 표면(그리드 카드)에서만 다르게 렌더된다 — 저작 도구와 소비 표면의 계약 위반. 세로형 캐릭터 전신 원화에 가로형 프레임 자체가 부적합하다.

**수정 설계**:
1. CharacterCard 이미지 컨테이너(:436) `aspect-[4/3]` → `aspect-[3/4]`. **이 한 줄로 편집기·카드 프레임 비율이 일치**해 FitEditor 구도가 카드에 그대로 재현된다. 상세 대표·복장 썸네일은 이미 3:4라 무변경. 기존 image_fit 데이터는 애초 3:4 기준 저작이므로 **마이그레이션 불필요**.
2. 그리드 밀도: `minmax(180px,1fr)`(:1556) **유지 권장** — 전신 표시가 목적이므로 세로 공간 사용이 맞다. 한 화면 카드 수 감소가 과하면 `minmax(160px,1fr)` 대안(기본은 180 유지).
3. fit 기본값 카드도 object-contain이라 전신이 전부 보이고, 세로형 원화 기준 좌우 여백이 줄어 더 크게 보인다.
4. 회귀 방지: 테스트에 카드 이미지 영역 `aspect-[3/4]` 존재 + `aspect-[4/3]` 부재 assert 추가(:99 블록에 편입).

**변경 파일**: `src/views/CharacterBoardView.tsx`, `tests/characterBoardAssetWorkflow.test.ts`

**수용 기준**: FitEditor에서 저장한 구도가 카드·복장 썸네일·상세 대표 3곳에서 동일하게 보임(편집기 미리보기와 육안 비교 어긋남 없음). fit 초기값 복장의 전신 세로형 이미지가 카드에서 잘리지 않음. typecheck + 테스트 + build:vite 통과.

**위험·완화 (교정 반영)**: ① 카드 세로 증가 — 이미지 영역 높이는 0.75×w → 1.333×w(**약 +78%**), 정보 영역(~90px) 포함 **카드 전체 높이 약 +45~50%** 증가(폭 180~240px 기준). 이 실측치를 기준으로 밀도(180 유지 vs 160 축소)를 판단할 것. ② '비율만 맞으면 1:1 재현'은 이미지가 양쪽 프레임 모두에서 contain 제약을 받을 때 성립 — 통상 업로드(최대 800px, 축소만 수행)는 성립하지만, 프레임보다 작은 초소형 이미지는 natural size 렌더로 미세하게 어긋날 수 있음(기존 3:4 표시 지점에도 동일하게 존재하던 한계 — 수정 차단 사유 아님). ③ FB-7과 같은 파일 — 같은 PR(A)에서 순서만 조율.

---

### FB-3. '이미지 복사' 줄바꿈 + 앱 전역 버튼 줄바꿈 방지 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "이미지 복사 버튼 텍스트 줄바꿈 현상. 앱 전역적으로 이런 줄바꿈 현상이 일어나지 않도록 일관된 디자인 설정을 유지할 수 있게 수정."

**현재 동작**: `w-[240px]`(:599) 컨테이너 안 `grid grid-cols-3 gap-1.5`(:624)의 3버튼. 셀 유효 폭 = (240−12)/3 ≈ 76px에서 패딩 12px + 아이콘 12px + gap 4px를 빼면 라벨 가용 폭 ≈ 48px — '이미지 복사'(11px 한글 5자+공백 ≈ 58px)는 **물리적으로 줄바꿈**된다. 게다가 index.css:48-54의 타이포 스케일이 `text-[11px]`에 배율을 곱하므로 글자 크기 설정을 키우면 다른 화면 라벨도 줄바꿈 위험. **전역 방지 장치는 없음** — 공용 Button 컴포넌트가 존재하지 않고(src/components/ui = Confetti/ContextMenu/GlobalTooltip 뿐), index.css의 버튼 전역 규칙은 테마 트랜지션(:226)과 Sonner 토스트 한정 nowrap(:874)뿐. 코드베이스 전체에서 `whitespace-nowrap`을 개별 버튼마다 수동으로 붙이는 방식이다.

**왜 문제인가**: 라벨이 두 줄로 꺾인 버튼은 깨진 UI로 읽히고(피드백이 실제로 그렇게 인지), 동일한 실패가 글자 배율×좁은 컨테이너 조합으로 앱 어디서든 재발할 수 있는 구조적 문제다.

**수정 설계**:

1. **[국소 — FB-4와 같은 PR, FB-4 이후]** FB-4가 좌측 3버튼 중 '작업 폴더/작업 파일'을 삭제하므로, 남는 액션을 `grid grid-cols-2 gap-1.5` 한 행으로 재구성: **[이미지 추가/바꾸기(기존 :615-623 버튼을 이 행으로 이동)] [이미지 복사(:641-648, text-xs로 승격)]**. 두 버튼 모두 `whitespace-nowrap` 명시. **[교정 반영]** 셀당 라벨 가용 폭 실측 ≈ **76px**(셀 117px − 패딩 20 − 아이콘 13 − gap 6 − 보더 2) — '업로드 중...'(≈63px)은 기본 배율에서 안전하고, 배율 1.2×부터 근접하지만 nowrap이라 실패 모드는 줄바꿈이 아닌 오버플로(발견·수정 용이).
2. **[전역 장치]** 공용 Button 신설+수백 개 마이그레이션은 이 코드베이스 스타일(인라인 Tailwind)에 과잉. **index.css의 기존 관례('@layer base에 두면 Tailwind utilities가 언제나 이긴다', :57-58 주석)를 따라** 추가:
   ```css
   @layer base {
     /* 라벨형 버튼 줄바꿈 금지 — 글자 배율/좁은 컨테이너에서 라벨이 두 줄로 꺾이는 것 방지 */
     button { white-space: nowrap; }
     /* 카드형 버튼 안의 멀티라인 본문은 유지 — line-clamp 은 줄바꿈을 전제로 동작 */
     button [class*="line-clamp-"],
     button p { white-space: normal; }
   }
   ```
   line-clamp는 white-space를 설정하지 않아 부모 nowrap을 상속하면 1줄로 붕괴하므로 카운터 규칙 필수(확인된 사례: RetakeHubView.tsx:80-94 세트 카드 = `<button>` + 제목 line-clamp-2). **[교정 반영]** 현재 코드베이스에 whitespace 유틸리티를 단 `<button>`은 **0개**(grep 확인: whitespace-pre-wrap/normal 14곳 전부 비버튼) — 보존해야 할 기존 opt-out이 없어 도입이 안전하며, 필요해지면 유틸리티(`whitespace-normal`)가 base를 이기는 표준 opt-out 경로가 이미 있다.
3. **[회귀 감사]** `rg "line-clamp" src`에서 버튼 조상을 가진 지점(RetakeHubView.tsx:92, SceneCard.tsx:173, ProgressKanbanSection.tsx:219, ImageVersionDropdown.tsx:110, RevisionImportModal.tsx:226, ScenesView.tsx:1158, ScheduleView.tsx:334)을 육안 QA. line-clamp 없이 자연 줄바꿈에 의존하는 버튼 본문이 발견되면 그 요소에 `whitespace-normal` 명시(문서화된 opt-out).

**변경 파일**: `src/views/CharacterBoardView.tsx`, `src/index.css`

**수용 기준**: '이미지 복사' 라벨이 기본·최대 글자 배율에서 한 줄 표시. 글자 배율 최대에서 캐릭터 현황판/씬 뷰/리테이크 허브의 라벨형 버튼에 줄바꿈 미발생. 리테이크 허브 세트 카드 제목·나의 할일 카드 todo·칸반 카드 본문의 2줄 클램프 정상 유지. typecheck + 테스트 + build:vite 통과.

**위험·완화**: 전역 nowrap은 기존의 '조용한 줄바꿈'을 '오버플로'로 바꿀 수 있음 — 오버플로는 더 쉽게 발견·수정되는 실패 모드이고 유틸리티로 즉시 opt-out 가능. 3단계 감사 목록(리테이크 허브·나의 할일·컴포지팅 칸반·씬 상세·댓글 패널·설정)을 배포 전 육안 확인. 테마 트랜지션 규칙(:226)과 속성이 안 겹쳐 충돌 없음.

---

### FB-4. 작업 폴더/파일 UI 중복 정리 + 카드 우클릭 메뉴 (검증: CONFIRMED)

**피드백 원문**: "카드 내부에 작업폴더 박스·작업파일 박스가 두 공간에 있어 중복된 기능 같음. 오른쪽(설정 공간)만 남기고 왼쪽에서는 삭제, 왼쪽은 이미지 바꾸기/복사만 깔끔하게. 카드 우클릭 시 자동으로 폴더만 열리는 대신 메뉴([폴더 열기/파일 열기/이미지 복사])가 뜨게 — 리깅 시 카드 우클릭→복사→바로 사용."

**현재 동작**: §1.3 참조 — 진입점 3중 + 카드 우클릭 즉시 실행. IPC 경로: 열기=`shell:open-path`, 폴더 선택=`path:choose-folder`, 파일 선택=`path:choose-file`, 이미지 복사=렌더러 클립보드(copyImageToClipboard, imageActions.ts:49 — PNG 변환 포함, IPC 아님).

**왜 문제인가**: '어디서든 닿게' 하려던 설계가 동일 데이터에 3개 진입점을 만들었고, 좌측 버튼의 이중 동작(열기/등록 겸용)은 클릭 결과를 예측 불가로 만든다(UX-2). 카드 우클릭 즉시 열기는 같은 제스처가 화면마다 다르게 동작하는 비일관(INT-5)이자, 메뉴가 없어 이미지 복사 같은 빠른 워크플로우를 막는다.

**수정 설계**:

**[A. 좌측 정리 — 이미지 액션만]** FeaturedImageSlot에서 '작업 폴더'/'작업 파일' 버튼(:625-640) **삭제**, props `onPickFolder`/`onPickFile`(:556-557, :563-564) 제거, 호출부(:1194-1195) 정리(우클릭 메뉴의 onOpenFolder/onOpenFile은 character/shownCostume에서 직접 읽으므로 무영향). 하단은 FB-3 설계대로 `grid grid-cols-2` = [이미지 추가/바꾸기] [이미지 복사]. 우측 CostumeDetail '작업 경로' 2박스(:843-856)는 **유일한 등록+열기 지점**으로 유지 — handlePickFolder(:1081-1085)/handlePickFile(:1087-1101)은 CostumeDetail(:1265-1266)로만 전달.

**[B. 카드 우클릭 → 컨텍스트 메뉴]** CharacterImageContextMenu에 `variant?: 'full' | 'card'`(기본 'full') prop 추가. 'card'면 배경 표기 섹션(:88-108)과 '썸네일 맞추기'(:110)를 렌더하지 않고 **[작업 폴더 열기 / 작업 파일 열기 / 이미지 복사]** 3항목만(피드백 명시 순서, 가시 옵션 ≤ 4 규칙 충족). `background`/`onBackground`/`onEditFit`은 optional로 완화. 위치 클램프(:86)의 하드코딩 상수(232/290)는 variant별 예상 높이 분기(card ≈ 130px) 또는 **마운트 후 ref.offsetHeight 실측 보정**(권장 — INT-10도 함께 해소).

CharacterGrid에 `cardMenu: { characterId: string; x: number; y: number } | null` 상태 추가, 카드 onContextMenu(:1563-1567)를 setCardMenu로 교체(기존 toast 분기 삭제). 메뉴 대상 데이터: `const cs = byCharacter.get(characterId) ?? []; const featured = cs.find(c => c.featuredImageUrl) ?? null;`(카드 대표 선정 :425와 동일) — onCopyImage=`copyCharacterImage(featured?.featuredImageUrl)`, onOpenFolder=`openStoredPath(character.workFolderPath, '작업 폴더')`, onOpenFile=`openStoredPath(featured?.workFilePath ?? cs.find(c => c.workFilePath)?.workFilePath, '작업 파일')`(대표 복장 우선, 없으면 파일 등록된 첫 복장 — 카드 레벨에는 활성 복장 개념이 없으므로). hasImage/hasFolder/hasFile로 미등록 항목 disabled(기존 메뉴 관례 동일). → 리깅 워크플로우 = 카드 우클릭 → 이미지 복사, **클릭 2번 완결**.

**[C. 유지]** FeaturedImageSlot/CostumeThumbCard의 기존 'full' 메뉴(배경+썸네일 맞추기 포함)는 그대로.

**변경 파일**: `src/views/CharacterBoardView.tsx`, `src/components/characters/CharacterImageContextMenu.tsx`

**수용 기준**:
- 상세 좌측에는 이미지 버튼(추가/바꾸기, 복사)만 있고 작업 폴더/파일 버튼이 없다.
- 등록('선택')과 열기는 우측 '작업 경로' 한 곳(+ 우클릭 메뉴의 열기 전용)에서만.
- 카드 우클릭 시 폴더가 즉시 열리지 않고 3항목 메뉴가 커서 위치에 뜨며 미등록/이미지 없음은 비활성.
- 카드 메뉴 '이미지 복사' 후 외부 앱 PNG 붙여넣기 동작(기존 copyImageToClipboard 재사용).
- 카드 메뉴에 배경 표기/썸네일 맞추기 미노출, 상세 내 이미지 메뉴는 기존 그대로.
- 테스트의 '작업 폴더/작업 파일/이미지 복사' 문자열 검사(:111-113)가 우측 PathActionRow 라벨로 계속 통과.
- typecheck + 테스트 + build:vite 통과.

**위험·완화**: ① 기존 습관(우클릭=폴더 즉시) 파괴 — update-notes.json에 비개발자 톤 시나리오 안내 필수('카드에서 우클릭하면 이제 메뉴가 떠서 폴더·파일·이미지 복사를 고를 수 있어요'). ② FeaturedImageSlot props 변경 — 호출부 1곳, typecheck가 검출. ③ 카드 레벨 '작업 파일'은 복장 다수일 때 모호 — 메뉴 항목 title 툴팁에 파일명 노출(displayPathName 재사용). ④ 메뉴 높이 클램프 — 실측 보정으로 완화.

---

### FB-5. 크게보기 비율 이상 — 라이트박스에서 fit 미적용 (검증: CONFIRMED)

**피드백 원문**: "썸네일을 클릭하면 이미지가 이상하게 보이는 현상이 있습니다."

**현재 동작·원인**: 대표 이미지 클릭(:609 → :1193) → CharacterImageLightbox가 화면 크기 가변 프레임(`absolute inset-0`)에 CharacterImageFrame을 놓으며 **썸네일용 fit을 그대로 전달**(:110 `fit={current.fit}`). 업로드 이미지는 최대 800px 리사이즈라 라이트박스 프레임(1000px+)보다 작아 원본 크기로 렌더된 뒤 썸네일 구도용 scale/offset이 재적용된다 → scale>1이면 확대·잘림, x/y 오프셋이면 중앙에서 밀림, scaleX≠scaleY면 왜곡. **재현 조건: imageFit이 기본값이 아닌 모든 복장**(기본값 복장은 정상으로 보여 '일부만 이상하다'로 체감). 과거 수정(브랜치 codex/character-fit-editor-transform-fix, PR #177)은 편집기↔썸네일 일치만 해결하고 라이트박스 재적용 문제는 남겼다.

**왜 문제인가**: '크게보기'는 원본 확인 용도인데 썸네일 구도 변환이 재적용되어 원본을 볼 수 없다. §4.3 R2 규칙(원본 확인 표면 = fit 미적용) 위반의 유일 사례.

**수정 설계**:
1. CharacterImageLightbox.tsx:106-112의 CharacterImageFrame 호출에서 **`fit={current.fit}` 라인 제거** → 기본값 DEFAULT_CHARACTER_IMAGE_FIT(scale 1, offset 0)이 적용되어 transform이 항등, object-contain 원본 표시. `background={current.background}`는 **유지**(투명 PNG 확인 용도, FB-7 정합).
2. 내부 FitEditor 호출(:136-145)의 `fit={current.fit}`은 **반드시 유지** — 편집은 저장값에서 시작. CharacterImageLightboxEntry의 fit 필드(:8-14)도 이 때문에 유지.
3. 회귀 방지: 테스트 라이트박스 블록(:125-128 인근)에 'CharacterImageFrame 호출부에 fit 전달 없음 + CharacterImageFitEditor 호출부에 fit={current.fit} 있음' 정규식 assert 추가.
4. 원본이 프레임보다 작아 확대되지 않는 것은 자연스러운 동작 — 별도 처리하지 않음.

**변경 파일**: `src/components/characters/CharacterImageLightbox.tsx`, `tests/characterBoardAssetWorkflow.test.ts`

**수용 기준**: scale 2, x/y ±100, scaleX≠scaleY 등 어떤 fit 값이 저장돼 있어도 라이트박스에서 전체가 잘림·왜곡 없이 중앙 표시. ←→ 순회 시 각 이미지 원본 비율. 라이트박스 '썸네일 맞추기'는 저장값에서 시작, 적용 시 카드/썸네일에는 여전히 fit 반영. 카드·썸네일·상세 대표의 fit 표시는 회귀 없음. typecheck + 테스트 + build:vite 통과.

**위험·완화**: '라이트박스에서도 썸네일 구도 그대로 크게'라는 상반 기대 가능 — 피드백 원문이 이를 버그로 인식하므로 원본 표시가 정답(추후 토글 여지). 표시 전용 변경이라 낙관적 업데이트·Realtime·DB 무영향.

---

### FB-6. 첫 작업 자동화 — '복장 1' 자동 생성 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "처음 카드를 만들고 이미지 추가를 누르면 파일 경로 찾기까지 떠놓고, 파일을 지정하면 '먼저 디자인을 추가하세요'라고 하니 귀찮음. 캐릭터 추가 시 자동으로 복장1이 추가되어 있거나, 이미지 추가 시 자동으로 복장1이 추가되게."

**현재 동작**: 캐릭터는 복장 0개로 생성(store:205-220). 업로드 버튼(:615-623)은 복장 없어도 항상 노출·활성이고, 클릭하면 무조건 OS 파일 선택기부터 띄운 뒤 **파일을 고르고 나서야** 가드(:573)가 toast로 거부 — 피드백 그대로. 작업 파일 선택도 동일 패턴(:1088-1091). 수동 추가는 handleAddCostume(:1122-1129)이 `복장 ${n}`(공백 포함, 미사용 번호 탐색 — UNIQUE(character_id,name) 충돌 회피).

**왜 문제인가**: 데이터 위계(캐릭터→복장→이미지)를 사용자에게 그대로 노출했고, 가드가 파일 선택이라는 비용을 다 치른 뒤에 거부한다(오류 예방 실패 + 최악의 타이밍).

**수정 설계 — A(생성 시 자동) 주 + B(업로드 시 폴백) 병행**. A만으로는 이미 존재하는 복장 0개 캐릭터(라이브 데이터)가 구제되지 않고, B만으로는 상세가 계속 빈 상태로 시작하기 때문.

**[A. store.addCharacter 확장]** useCharacterBoardStore.ts:205-220의 try에서 svcAddCharacter 성공·머지 후 `svcAddCostume({ characterId: created.id, name: '복장 1', createdBy })` 호출·머지(id 중복 체크 패턴 :290-293 동일). **복장 생성 실패는 캐릭터 생성을 실패시키지 않는다**(catch에서 console.warn만 — '복장 0개' 상태로 degrade, B가 커버). 명명은 기존 관례 **'복장 1'(공백 포함**, :1126과 동일 — 피드백 표기 '복장1'과 다르니 관례 유지). 새 캐릭터는 복장 0개라 UNIQUE 충돌 불가. add 계열은 서버 결과 머지 패턴이라 롤백 설계 불필요. DB 마이그레이션 불필요.

**[B. 업로드 시 자동 생성 폴백]** CharacterDetailPanel에 `ensureCostume(): Promise<CharacterCostume | null>` 헬퍼 — activeCostume 있으면 반환, 없으면 미사용 번호로 addCostume 후 setActiveCostumeId. **번호 생성 로직은 handleAddCostume(:1123-1126)과 공용 함수로 추출**(중복 제거). FeaturedImageSlot에 `onEnsureCostume` prop을 넘기고 handleUpload 가드(:573)를 `const target = costume ?? await onEnsureCostume(); if (!target) return;`으로 교체, 이후 uploadCharacterImage/updateCostumeField가 target 사용. 실패 시 addCostume 내부 toast(:298)가 이미 뜨므로 추가 toast 불필요. **handlePickFile 가드(:1088-1091)도 동일 교체** — **[교정 병합]** 이때 테스트 :119-121이 `targetCostume` 변수명을 원문 고정하므로 **새 변수 도입 대신 파라미터 재할당**으로 유지한다: `targetCostume = targetCostume ?? await ensureCostume(); if (!targetCostume) return;` (또는 테스트 문자열 동반 갱신 — 재할당 방식 권장).

**[동시성/Realtime]** 두 사용자가 동시에 같은 캐릭터 첫 업로드(B) 시 늦은 쪽이 UNIQUE 위반 throw → toast 후 재시도 시 realtime으로 도착한 '복장 1'이 activeCostume이 되어 정상 진행(수용 가능한 희귀 케이스, LWW 정책과 일관). A는 캐릭터 id가 달라 충돌 불가. 자동 생성 복장은 realtime INSERT로 ~100ms 내 타 창 전파, 본인 창은 id 중복 체크로 이중 삽입 방지.

**변경 파일**: `src/stores/useCharacterBoardStore.ts`, `src/views/CharacterBoardView.tsx`

**수용 기준**:
- 캐릭터 추가 직후 상세를 열면 '복장 1'이 선택돼 있고 빈 상태 문구가 없다.
- 복장 0개인 기존 캐릭터에서 '이미지 추가' → 파일 선택 → 자동으로 '복장 1' 생성 + 업로드 완료('먼저 …추가해주세요' 토스트 소멸).
- 자동 이름이 수동 관례('복장 N', 공백 포함)와 동일하고 이후 '복장 추가' 시 UNIQUE 충돌 없이 '복장 2'.
- 타 사용자 창에 캐릭터+복장 1 실시간 반영, 복장 중복 생성 없음.
- 자동 생성 실패 시에도 캐릭터 생성은 성공하고 업로드 시 폴백이 재시도.
- typecheck + 테스트 + build:vite 통과.

**위험·완화**: ① A 부분 실패(캐릭터만 생성) — B 폴백이 최종 안전망. ② B 동시성 — 희귀, 재시도 해소. ③ '복장 1'이 실명으로 바뀌어야 할 수 있음 — CostumeIdentity 인라인 rename 즉시 가능, update-notes에 '자동으로 첫 디자인 칸이 만들어져요. 이름은 눌러서 바꿀 수 있어요' 안내. ④ FeaturedImageSlot props 추가 — 호출부 1곳. ⑤ handleUpload 의존 배열에 onEnsureCostume 추가(stale closure 방지). ⑥ 테스트 :108(`const shownCostume = activeCostume;`)은 건드리지 않음.

---

### FB-7. 썸네일 기본 배경 투명 (검증: CONFIRMED)

**피드백 원문**: "기본 표기가 투명이면 편하겠음. 지금은 검정이 기본이라 계속 투명으로 바꿔주고 있음."

**현재 동작**: 기본값 'black'이 **4곳에 중복 정의** — (1) DB: `image_background TEXT NOT NULL DEFAULT 'black'`(2026-06-29 마이그레이션:16-17), INSERT가 컬럼 미지정이라 새 복장은 항상 black. (2) `characterAssets.ts:3` DEFAULT_CHARACTER_IMAGE_BACKGROUND = 'black'(normalize fallback :61-64 동일). (3) `CharacterImageFrame.tsx:29` 기본 prop 'black'. (4) `CharacterBoardView.tsx:595` `?? 'black'`. 그 외 mock(devElectronAPI.ts:260, :1106)도 black, 메뉴 옵션 순서(ContextMenu:6-11)도 검정이 첫 번째.

**왜 문제인가**: 팀 원화가 투명 PNG 위주인데 기본값이 실사용 패턴과 어긋나 복장마다 수동 전환을 반복(피드백 그대로). 기본값이 4곳 분산이라 한 곳만 바꾸면 불일치가 생기는 구조 자체도 결함.

**수정 설계**:
1. **DB**: 신규 마이그레이션 `DEVLOG/migrations/2026-07-03-character-image-background-default.sql` — `ALTER TABLE character_costumes ALTER COLUMN image_background SET DEFAULT 'transparent';` (CHECK 유지, 신규 행에만 영향). **라이브 적용은 한솔 승인 후**(§0-5), 적용 후 migrations에 기록.
2. `characterAssets.ts:3` → `'transparent'` (normalize fallback 자동 추종).
3. `CharacterImageFrame.tsx:29` 기본 prop을 하드코딩 대신 `DEFAULT_CHARACTER_IMAGE_BACKGROUND`로(이미 :4에서 import 중, 심볼만 추가).
4. `CharacterBoardView.tsx:595` `?? 'black'` → `?? DEFAULT_CHARACTER_IMAGE_BACKGROUND` (단일 소스화).
5. mock 2곳 'transparent'로(미리보기 모드 일관성).
6. ContextMenu BACKGROUND_OPTIONS 순서를 **투명 첫 번째**로(기본값=첫 옵션 원칙, '투명/검정/흰색/체커').
7. **기존 데이터 방침(한솔 결정 필요)**: **일괄 전환하지 않고 유지 권장** — NOT NULL DEFAULT라 '의도적 검정'과 '기본값 방치'를 데이터로 구분할 수 없고, 일괄 UPDATE는 의도적 선택을 비가역 소실시킨다. 한솔이 '기존 것도 전부 투명'을 명시하면 one-shot `UPDATE character_costumes SET image_background='transparent' WHERE image_background='black';` — 실행 전 대상 행 수 SELECT 보고 + 비가역 고지 + Realtime으로 전 사용자 화면 즉시 변경됨을 고지.
8. update-notes.json에 비개발자 톤 항목('새 디자인을 올리면 배경이 처음부터 투명으로 보여요').
9. **배포 순서 무관**: 코드 먼저여도 DB가 항상 값을 내려주므로 표시 불일치 없음, DB DEFAULT 먼저여도 구버전 normalize가 'transparent'를 유효값으로 통과.

**변경 파일**: 신규 마이그레이션 SQL, `src/utils/characterAssets.ts`, `src/components/characters/CharacterImageFrame.tsx`, `src/views/CharacterBoardView.tsx`, `src/mocks/devElectronAPI.ts`, `src/components/characters/CharacterImageContextMenu.tsx`, `DEVLOG/update-notes.json`

**수용 기준**: (DB 적용 후) 새 복장+이미지의 배경이 자동 '투명'이고 메뉴에서 '투명'이 선택 상태. 기존 검정/흰색/체커 복장 표시 불변(일괄 전환 미실시 기준). mock 모드도 투명 기본. 'black' 하드코딩 fallback이 코드에 안 남음(단일 상수 수렴). typecheck + 테스트 + build:vite 통과.

**위험·완화**: 라이브 마이그레이션 전까지 신규 복장은 여전히 검정 생성(코드-표시 불일치는 없음). §4.3 R5(라이트 모드 × 투명) QA 항목 참조. FB-2와 같은 파일 — PR A에서 함께.

---

### FB-8. 캐릭터 디자인·리깅 작업을 '나의 할일'에 합류 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "캐릭터 리깅 작업 또한 작업 리소스에 포함. 인원별 현황·작업 스케줄·업무 배분 확인. 리깅은 거의 나만 하지만 디자인은 다른 분들도 하고, 내 업무를 한번에 확인하기에 캐릭터 리깅까지 포함되면 관리하기 좋겠다."

**현재 동작**: 나의 할일 위젯 데이터 소스는 2종뿐 — ① 씬(useDataStore.episodes 평탄화 후 `scene.assignee` 쉼표 분리 이름을 currentUser.name과 정확 일치 매칭, useMyTasksData.ts:549-564) ② 개인 할일(personal_todos). 통계도 이 둘만(statsUtils.ts:48-106). 담당자별 현황 위젯도 씬 기반 assigneeStats만(calcStats.ts:126-149). 복장에는 `designAssignee`/`riggingAssignee`(쉼표 자유 문자열)와 단계가 이미 있으나 어떤 개인 업무 집계에도 미합류. **메인의 character_board Realtime 채널은 항상 켜져 있고 위젯 팝업 창까지 broadcast**(electron/main.ts:2569-2577) — 합류 기반은 이미 존재.

**왜 문제인가**: 캐릭터 작업이 개인 업무 시야 밖에 있어 담당자가 자기 배분을 한 곳에서 못 본다. "방향성" 피드백이므로 **MVP + 후속 확장**으로 설계한다.

**MVP 선택 근거**: (A) 나의 할일 합류 = 원문 "내 업무를 한번에" 직접 대응, 매일 보는 위젯 재사용 → **채택**. (B) 담당자별 현황 확장 = 씬 %와 복장 건수의 단위가 달라 카드 산식 왜곡 + 팀 뷰라 목적 불일치 → 후속. (C) 현황판 내 담당자 필터 = 보드를 열어야 해 "한 곳" 미충족 → 후속.

**수정 설계 (MVP)**:
1. **타입**: my-tasks/types.ts에 `CharacterTaskItem` — `{ key: 'char:${costumeId}:${'design'|'rigging'}', kind, characterId, characterName, costumeId, costumeName, stage, stageLabel, stageColor, done }`, done = stage === 'done'.
2. **단계 메타 공용화**: CharacterBoardView 로컬 DESIGN_STAGE_META/RIGGING_STAGE_META(:49-61)를 `src/utils/characterStageMeta.ts`로 추출(뷰·위젯 색/라벨 단일 소스). **[교정 병합 ④]** `parseAssigneeNames`도 CharacterBoardView.tsx:96-101의 **로컬 미export 함수**이므로 공용 유틸(characterStageMeta.ts 또는 별도 utils)로 함께 추출한다.
3. **공유 구독**: useCharacterBoardStore에 `ensureLoadedAndRealtime()` 헬퍼 — 모듈 레벨 refcount로 startRealtime IPC 리스너 중복 등록 방지 + loaded/loading 가드로 load() 1회.
4. **신규 훅** `my-tasks/hooks/useMyCharacterTasks.ts`: `enabled = useCharacterBoardAccess()`(fail-closed — 무권한자는 항목 생성도 fetch도 안 함). enabled && currentUser일 때 ensureLoadedAndRealtime(). useMemo로 각 복장의 design/rigging 두 축에 대해 parseAssigneeNames(...) 결과가 currentUser.name과 정확 일치(trim)하면 CharacterTaskItem 생성(씬 매칭 :552-555와 동일 규칙). 반환 `{ pendingCharacterTasks, doneCharacterTasks }`.
5. **렌더링**: MyTasksWidget 진행 중 섹션(:724-726)과 완료 섹션(:759-762)에 캐릭터 작업 렌더. 신규 `my-tasks/components/CharacterTaskRow.tsx`(리스트/카드 겸용) — SceneRow 시각 문법 미러: 좌측 kind 배지('디자인'/'리깅'), 본문 '캐릭터명 · 복장명', 우측 현재 단계 칩(stageColor). **MVP에서는 행에서 단계를 바꾸지 않는다**(복장 단계는 enum 레일이라 씬 체크박스와 조작 문법이 달라 오조작 위험). **[교정 병합 ②]** 행 클릭 네비게이션은 CustomEvent 방식 금지(lazy 뷰 마운트 레이스로 유실) — **FB-1이 만든 `useAppStore.pendingCharacterBoardRequest` + setView('character-board')를 그대로 재사용**한다(store 기반 pull 소비 — FB-1 선행 필수). 팝업(플로팅 위젯) 창에서는 MVP에선 이동 비노출(본체 창 아님) — 후속에서 widgetNavigateMain 패턴 확장.
6. **통계**: **[교정 병합 ①]** computeMyTasksStats의 현재 시그니처는 `(scenes, personalTodos, now: Date)`로 3번째 인자를 now가 점유(statsUtils.ts:48-52, 호출부 :580) — characterTasks는 **4번째 옵셔널 인자**(기본 [])로 추가하고 total/fullyDone/pct에 1건=1슬롯(개인 할일과 동일 가중) 합산. **동시 수정 4지점**: (a) stats useMemo(:579-582), (b) 콘페티 pendingCount(:404-412), (c) 빈 상태 판정(:636-640), **(d) [교정 병합 ③] 완료 카운트 배지(:744 — `doneScenes.length + donePersonalTodos.length` 하드코딩)** — 네 곳을 함께 반영해야 '모든 할일 완료' 오판·배지 불일치가 없다.

**후속 확장(별도 PR, MVP 제외)**: 담당자별 현황 위젯에 "캐릭터 N건 (완료 M)" 보조 라인(위젯에서 별도 집계 — 씬 %와 단위 혼합 방지) / 현황판 툴바 '담당자' 필터 칩(내 작업만) / 일정·스케줄(character_costumes에 due_date 신설 선행 필요) / 담당자 이름의 userId 정규화.

**이름 매칭 한계(명시)**: assignee는 자유 문자열이라 오타·별칭·퇴사자 이름은 위젯에 안 잡힘(useAuthStore users.name 정확 일치만). 씬 assignee와 동일한 기존 한계, userId 전환은 후속.

**변경 파일**: my-tasks/types.ts, my-tasks/hooks/useMyCharacterTasks.ts(신규), my-tasks/components/CharacterTaskRow.tsx(신규), my-tasks/statsUtils.ts, my-tasks/hooks/useMyTasksData.ts, MyTasksWidget.tsx, useCharacterBoardStore.ts, CharacterBoardView.tsx(META 추출), src/utils/characterStageMeta.ts(신규), tests(statsUtils 확장 + 담당자 매칭 순수 함수 단위 테스트)

**수용 기준**:
- 복장의 디자인 또는 리깅 담당자에 내 이름 포함(쉼표 다중 포함) 시 진행 중 목록에 캐릭터명·복장명·단계 행 표시.
- 해당 단계 done 시 완료 섹션 이동 + 도넛 통계 반영 + **완료 배지 수와 목록 일치**.
- 타 사용자 단계 변경이 재시작 없이 위젯 반영(Realtime).
- 무권한 사용자에게 캐릭터 작업 미표시 + 캐릭터 fetch 미발생.
- 메인 창 행 클릭 시 현황판 해당 캐릭터 상세 오픈.
- 씬 0·할일 0·캐릭터 작업만 있는 상태에서 빈 상태 문구가 아닌 목록 렌더, 캐릭터 작업까지 완료해야 '모든 할일 완료'.
- typecheck + 기존/신규 테스트 + build:vite 통과.

**위험·완화**: ① 이름 매칭 누락이 사용자에겐 안 보임 — AssigneeNamePicker가 미등록 이름 구분 표시 중, 후속 userId 정규화. ② 권한자 한정 상시 로드 IPC 3회(수백 행) — 부하 미미. ③ startRealtime 다중 구독 — refcount로 방지(머지가 id 기준이라 이중 호출도 파괴는 없음). ④ 통계 4지점 동시 수정 필수(위 6번). ⑤ 팝업 창 currentUser 수신 지연 — 기존 가드 패턴 사용. ⑥ META 추출 시 테스트 정규식 앵커 확인.

---

### FB-9. '폴더 만들기' 원클릭 — 생성 + 연결 (검증: CORRECTED → 교정 병합 완료)

**피드백 원문**: "캐릭터를 추가했을 때 버튼 하나로 `G:\공유 드라이브\사우스 코리안 파크\[]사코팍 캐릭터 세팅` 경로에 캐릭터 이름으로 폴더가 만들어지고 연결까지. 현재는 추가 → 탐색기에서 폴더 만들기 → 연결의 3단계. '만들기' 같은 직관적 버튼."

**현재 동작**: 작업 폴더 등록 경로 3가지 전부 '기존 폴더 선택'뿐(§1.3). **폴더를 생성하는 렌더러 노출 IPC는 전무** — main.ts의 mkdir/ensureDir(:695-698 등)은 내부용이고 preload에는 choose-folder/choose-file/dirname/open-path/pathExists/shellShowItem만 있다. 기준 경로 보관소도 없다. 의도된 MVP 스코프였다(types/index.ts:179 주석 '경로만 저장').

**왜 문제인가**: 신규 캐릭터마다 3단계 수동 반복. 팀 공용 기준 경로가 앱에 없어서 자동화가 원천 불가.

**수정 설계**:

**[1. 기준 경로 보관 — Supabase metadata 팀 공용 설정]** `type='character-board', key='work-folder-root', value=경로 문자열 평문`(part-memo와 동일 패턴 — 단일 값이라 JSON 불필요). 근거: CLAUDE.md 한글 경로 하드코딩 금지 충족 / 팀 전원 공유(개인 %APPDATA%는 부적합) / metadata 변경 브로드캐스트 인프라 기존재. **설정 UI**: SettingsView 'admin-access' 탭(SettingsView.tsx:98-104, FeatureGatingSection 아래)에 `CharacterFolderRootSection` 신설 — 현재 경로 표시 + '폴더 선택'(chooseFolderPath) + writeMetadataToSupabase(supabaseService.ts:295-297) 저장. 관리자 탭인 이유: 팀 전체 폴더 생성 위치를 좌우하는 공용 값. **초기 세팅은 한솔이 설정 화면에서 1회 지정**(한글 경로 SQL 마이그레이션보다 안전). **[교정 병합 ②]** `readMetadataFromSupabase` 반환은 `{type,key,value}` row **또는** value 문자열 양쪽 가능(useCharacterBoardAccess.ts:23-28의 parseConfig, usePartMemos.ts:52-54의 `data?.value` 언래핑 참조) — characterFolderService에서 **value 언래핑을 반드시 처리**한다.

**[2. 신규 IPC `path:create-folder`]** main.ts의 path:* 핸들러 군(:1115-1130) 옆에 추가.
- 시그니처: `(parentPath: string, folderName: string) → { ok: boolean; path?: string; existed?: boolean; error?: string; code?: 'parent-missing'|'invalid-name'|'permission'|'unknown' }`
- 메인 프로세스 검증: ① parentPath 비문자열/공백 거부. ② `fs.existsSync(parentPath)` 아니면 `parent-missing`(드라이브 미연결/오설정 안내 분기). ③ folderName sanitize: Windows 금지 문자 `[\\/:*?"<>|]`·제어문자 제거, 끝의 점·공백 제거, 예약어(CON/PRN/AUX/NUL/COM1-9/LPT1-9)는 '_' 부착, 100자 절단, 결과가 비면 `invalid-name`. ④ 경로 탈출 방지: `path.resolve(path.join(parent, sanitized))`가 `path.resolve(parent)+path.sep`로 시작하는지 검사. ⑤ 이미 존재하면 mkdir 생략 `{ ok:true, existed:true, path }`(동명 폴더 재사용 = 자연스러운 '그냥 연결'). ⑥ `fs.promises.mkdir(full, { recursive: false })` — 부모 필수 존재로 오설정 조기 노출. EPERM/EACCES → `permission`.
- preload에 `pathCreateFolder` 노출 + types/index.ts:836-842 electronAPI 타입 추가. **sanitize·경로 탈출 로직은 공용 유틸로 분리해 node:test 단위 테스트**로 커버.

**[3. 렌더러 서비스]** 신규 `src/services/characterFolderService.ts`의 `createAndLinkCharacterFolder(character)`: ① 기준 경로 read(+value 언래핑) ② 미설정 → toast.error('폴더 기준 경로가 아직 설정되지 않았어요. 설정 → 관리자 탭에서 지정해주세요') 중단 ③ pathCreateFolder(root, character.name) ④ ok → **기존 낙관적 경로 updateCharacterFolder(character.id, res.path) 재사용**(store:234-244 — 롤백·Realtime 기존 그대로) + toast.success(existed ? '이미 있던 폴더를 작업 폴더로 연결했어요' : '폴더를 만들고 작업 폴더로 연결했어요') ⑤ 실패 코드별 안내: parent-missing → '기준 경로를 찾을 수 없어요. G드라이브 연결을 확인해주세요', permission → '폴더를 만들 권한이 없어요', 그 외 → '폴더 만들기에 실패했어요'.

**[4. 버튼 위치 — CostumeDetail 작업 폴더 PathActionRow]** PathActionRow(:752-788)에 옵셔널 `onCreate` prop 추가, **작업 폴더 행(:844-849)에만** 전달. workFolderPath **미등록일 때만** '만들기' 버튼을 '선택' 왼쪽에 노출(등록 후 숨김 — 행당 가시 버튼 2개 유지, 인지부하 규칙). 라벨 '만들기' + title='기준 경로에 캐릭터 이름으로 폴더를 만들어 연결'. **[교정 병합 ① — 도달성]** CostumeDetail은 activeCostume이 있어야 렌더된다(:1261-1272) — **FB-6(캐릭터 생성 시 '복장 1' 자동 생성)이 선행 머지되면 신규 캐릭터의 1차 시나리오('추가 → 만들기')에서 항상 도달 가능**해지므로 §4.2 순서 제약 1을 반드시 지킨다. 잔여 엣지(복장 0개 레거시 캐릭터)는 '복장 추가' 1클릭 후 도달 가능하며, FB-6 B 폴백(첫 업로드 시 자동 생성)으로도 자연 해소된다. AddCharacterModal 내 체크박스 안(排除 근거): 기준 경로 미설정·드라이브 오류 시 캐릭터 추가 흐름 자체가 막힘. FeaturedImageSlot 쪽은 FB-4가 버튼을 삭제하므로 진입점 부적합. 후속 UX: 캐릭터 추가 직후 상세 모달 자동 오픈으로 '추가→만들기' 한 호흡 연결.

**변경 파일**: electron/main.ts, electron/preload.ts, src/types/index.ts, src/services/characterFolderService.ts(신규), src/views/CharacterBoardView.tsx(PathActionRow onCreate), src/components/settings/CharacterFolderRootSection.tsx(신규), src/views/SettingsView.tsx, tests(sanitize·경로 탈출 단위 테스트)

**수용 기준**:
- 관리자 설정에서 기준 경로 지정·저장 → 다른 팀원 앱에서도 동일 값 읽힘(재시작 후 포함).
- 작업 폴더 미등록 캐릭터 상세의 작업 폴더 행에 '만들기' 노출, 등록된 캐릭터에는 미노출.
- '만들기' 1클릭으로 `{기준경로}\{캐릭터명}` 폴더 실제 생성 + workFolderPath 연결 + 성공 토스트, 직후 '열기' 동작.
- 동명 폴더 기존재 시 오류 없이 연결 + '이미 있던 폴더를 연결했어요'.
- 금지 문자 포함 이름('A/B: C?')도 sanitize된 이름으로 생성.
- 기준 경로 미설정/드라이브 미연결/권한 오류 각각 구분된 한국어 안내, 앱 상태 불변.
- '..' 경로 탈출이 기준 경로 밖 생성으로 이어지지 않음(단위 테스트 검증).
- typecheck + 신규 단위 테스트 + build:vite 통과.

**위험·완화**: ① 캐릭터 이름 변경 시 폴더명 불일치 — renameCharacter(store:246-256)는 폴더 rename 안 함(공유 드라이브 rename은 파일 잠금·부분 동기화 위험이 커 **의도적 배제**, 후속 검토). 경로는 계속 유효해 기능은 동작. ② characters.name은 UNIQUE 아님(2026-06-25 마이그레이션:23-27) — 동명 캐릭터 2개가 같은 폴더에 연결 가능, existed 토스트로 인지시키는 수준 수용. ③ sanitize로 폴더명≠캐릭터명 가능 — PathActionRow가 연결 폴더명 표시. ④ 기준 경로 오설정 시 팀 전체 영향 — 관리자 탭 배치 + 현재 경로 상시 표시. ⑤ G드라이브 가상 드라이브 특성상 mkdir 직후 열기 지연 가능 — 기존 실패 토스트 경로. ⑥ 파일시스템 쓰기 IPC 신설 — 존재 검증+경로 탈출 차단으로 방어. ⑦ 순서: 폴더 생성(실 부수효과) → DB 연결 — DB 실패 시 폴더는 남지만 무해(재시도 시 existed 연결).

---

## 6. Part B — UI/UX·코드 품질 진단 카탈로그 (52건)

> 4개 차원(UX 14 / VD 11 / INT·A11Y·MO 14 / CQ 13), 차원 내 심각도순. 각 항목의 `검증 교정`은 적대적 검증자가 원 서술·설계를 바로잡은 것으로 **본문 fix와 충돌 시 교정이 우선**한다(§0-3).
>
> **연계 주의(§4.3 요약)**: UX-2·UX-3·INT-5·VD-3(좌측 버튼 부분)·UX-1은 §5의 FB-4·FB-3·FB-6이 구조적으로 해소하므로 **제자리 수정 금지**(규칙 R1). UX-13①은 규칙 R2(축소 요약 표면 = fit 적용)에 따라 실행. UX-7은 규칙 R3의 근거 항목. UX-4·INT-7은 규칙 R4로 통합 실행.

### 6.1 UX / 정보구조 (UX-1 ~ UX-14)

**차원 총평**: 캐릭터 현황판은 시각 완성도(토큰 준수, 단계 레일, FitEditor의 크롭 워크스페이스)와 데이터 견고함(낙관적 업데이트+필드 단위 롤백, 고아 이미지 정리)은 수준급이지만, 인터랙션 문법의 일관성이 그 완성도를 따라가지 못한다. 가장 심각한 축은 '같은 행동이 위치마다 다르게 동작'하는 문제군이다: 우클릭이 3가지로 갈리고(카드=폴더 즉시 열기/이미지=메뉴/목록=무반응), 작업 폴더·파일 버튼은 등록 여부라는 숨은 상태로 열기와 OS 등록을 오가며, 에피소드 칩은 툴팁이 클릭이 아닌 우클릭 동작을 설명한다. 첫 사용 흐름은 캐릭터 추가→상세→디자인 추가→이미지 업로드로 4단계인데, 유일한 순서 강제가 파일 선택을 마친 뒤의 거절 토스트라 신규 사용자가 첫 시도에서 좌절한다. 파괴적 작업은 앱 표준 ConfirmDialog 대신 네이티브 window.confirm이고 undo·보관(archived 스키마 존재) 경로가 없으며, 이미지 교체는 확인 없이 이전본을 영구 삭제한다. 50+명 규모 대응(정렬·에피소드 필터·Spotlight 색인)이 전무해 파워유저의 최단 경로도 막혀 있다. 요약하면 '한 사람이 조심스럽게 쓰는 도구'로는 우아하지만 '20명이 공유 데이터를 다루는 도구'로서의 방어선과 규모 탐색이 다음 과제다.

#### UX-1 [P1] 이미지 업로드의 선행 조건(복장 필요)을 파일을 다 고른 뒤에야 에러 토스트로 알려준다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:573 - if (!costume) { toast.error('먼저 디자인(복장)을 추가해주세요'); return; }` / `src/views/CharacterBoardView.tsx:615-623 - 업로드 버튼 disabled={uploading} (복장 유무와 무관하게 항상 활성)` / `src/views/CharacterBoardView.tsx:655 - onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); ... }}`
- **확인된 사실**: FeaturedImageSlot의 업로드 버튼은 복장이 0개여도 활성 상태다(:618의 disabled 조건은 uploading뿐). 클릭 시 숨은 file input이 열리고, 사용자가 OS 파일 선택기에서 이미지를 고른 뒤에야 handleUpload(:572) 첫 줄의 가드(:573)가 실행되어 '먼저 디자인(복장)을 추가해주세요' 토스트로 거절된다.
- **왜 문제인가**: Nielsen 5번(오류 예방) 위반의 전형. 막다른 길을 미리 막지 않고, 사용자가 탐색기에서 파일을 찾는 수십 초의 노력을 들인 뒤 사후 통보한다. 신규 캐릭터의 첫 사용 흐름(캐릭터 추가 → 상세 진입 → 이미지 올리고 싶음)에서 가장 자연스러운 첫 클릭이 바로 이 버튼인데, 정작 올바른 다음 단계(디자인 추가 버튼)는 화면 우측 갤러리 끝에 있어 시선 동선과 어긋난다.
- **일으키는 문제**: 신규 팀원(Jordan)이 캐릭터를 만들고 이미지를 올리려다 파일 선택까지 마친 뒤 거절당하고, '디자인을 추가하라'는 토스트가 사라진 뒤에는 어디서 추가하는지 다시 찾아야 한다(기억 다리 발생). 첫 사용 경험에서 가장 먼저 만나는 좌절 지점.
- **수정 계획**: CharacterDetailPanel의 handleAddCostume(:1122)을 FeaturedImageSlot에 onAddCostume prop으로 내려주고, handleUpload(:572)의 가드를 '거절'에서 '자동 생성 후 계속'으로 바꾼다: if (!costume) { const created = await onAddCostume(); if (!created) return; costume = created; } 형태로 복장을 만들고 업로드를 이어간다(업로드 성공 시 해당 복장이 activeCostumeId가 되도록 handleAddCostume의 기존 setActiveCostumeId 유지). 자동 생성이 과하다고 판단되면 차선책으로 costume이 null일 때 버튼 라벨을 '디자인 추가 후 이미지 올리기'로 바꾸고 클릭 시 onAddCostume만 실행한다. 토스트 가드는 백스톱으로 유지.

#### UX-2 [P1] '작업 폴더'/'작업 파일' 버튼이 등록 여부라는 보이지 않는 상태에 따라 '열기'와 'OS 선택기 띄우기'로 전혀 다른 동작을 한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:627 - onClick={character.workFolderPath ? () => openStoredPath(...) : onPickFolder}` / `src/views/CharacterBoardView.tsx:635 - onClick={shownCostume?.workFilePath ? () => openStoredPath(...) : onPickFile}` / `src/views/CharacterBoardView.tsx:629 - title={character.workFolderPath ?? '작업 폴더 등록'} (구분 단서는 title 툴팁뿐)` / `src/views/CharacterBoardView.tsx:752-788 - PathActionRow는 동일 기능을 '선택'/'열기' 버튼 분리로 제공`
- **확인된 사실**: FeaturedImageSlot 하단 버튼 2개는 라벨('작업 폴더', '작업 파일')·아이콘·스타일이 등록 전후 동일하고, onClick만 삼항으로 분기한다. 반면 같은 화면 우측 CostumeDetail의 PathActionRow(:843-856)는 같은 데이터를 '선택'+'열기' 버튼 쌍으로 분리해 제공하고, 우클릭 메뉴(CharacterImageContextMenu.tsx:112-113)는 열기 전용(미등록 시 disabled)이다.
- **왜 문제인가**: 동일 행동=동일 UI 원칙과 Nielsen 1번(상태 가시성)·4번(일관성) 위반. 버튼의 결과를 클릭 전에 예측할 수 없고(폴더가 열릴지 OS 다이얼로그가 뜰지), 미등록 상태에서 '열어보려고' 클릭했다가 뜬 폴더 선택기에서 아무 폴더나 확인하면 그 경로가 조용히 팀 공유 데이터(characters.work_folder_path)로 저장된다. 같은 개념이 화면 안에서 3가지 다른 인터랙션 문법으로 존재해 학습 비용이 3배다.
- **일으키는 문제**: 팀원이 남의 캐릭터에서 '작업 폴더'를 눌렀다가 의도치 않게 잘못된 경로를 전 팀에 등록하는 사고가 가능(20명 협업, Last-Write-Wins). '버튼을 눌렀는데 이상한 창이 떠요' 수준의 서포트 문의 유발.
- **수정 계획**: FeaturedImageSlot(:624-649)의 두 버튼을 상태 기반 라벨·스타일로 분기한다: 등록됨 → 'FolderOpen 아이콘 + 폴더 열기'(현행 스타일), 미등록 → 'Plus 아이콘 + 폴더 등록' + border-dashed + text-text-secondary/70. 등록 클릭 시에는 선택 직후 toast.success('작업 폴더를 등록했어요')로 부수효과를 명시한다. 파일 버튼도 동일 패턴('파일 열기'/'파일 등록'). 등록 변경(재선택)은 우측 PathActionRow '선택'에만 남겨 역할을 분담한다.

#### UX-3 [P1] 우클릭 동작이 위치마다 3가지로 갈린다 — 그리드 카드=폴더 바로 열기, 상세 이미지=컨텍스트 메뉴, 목록 행=없음

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1563-1567 - 카드 onContextMenu: workFolderPath 있으면 즉시 openStoredPath, 없으면 toast.info` / `src/views/CharacterBoardView.tsx:610-614 - FeaturedImageSlot 우클릭 → setContextMenu (메뉴 표시)` / `src/views/CharacterBoardView.tsx:984-988 - CostumeThumbCard 이미지 우클릭 → onImageContextMenu (메뉴 표시)` / `src/views/CharacterBoardView.tsx:929-947 - CharacterListRow에는 onContextMenu 핸들러 없음`
- **확인된 사실**: 같은 '캐릭터 이미지'라는 시각 대상에 대해: 그리드 카드는 우클릭 즉시 작업 폴더를 열고(미등록 시 '상세 화면에서 작업 폴더를 먼저 등록해주세요' 토스트), 상세의 대표 이미지와 복장 썸네일은 배경/썸네일 맞추기/복사/열기 메뉴를 띄우며, 좌측 목록 행 썸네일은 아무 반응이 없다. 카드 우클릭 기능은 화면 어디에도 표기·힌트가 없다.
- **왜 문제인가**: 동일 행동=동일 UI의 정면 위반(Nielsen 4번). 우클릭이라는 하나의 제스처가 컨텍스트마다 '즉시 실행'과 '메뉴'로 갈리면 사용자는 어느 쪽도 신뢰하지 못한다. 특히 즉시 실행형(카드)은 메뉴 없이 부작용이 발생해 가장 위험하고 가장 발견 불가능하다.
- **일으키는 문제**: 파워유저(Alex)가 카드에서 '이미지 복사' 메뉴를 기대하고 우클릭하면 갑자기 탐색기 창이 열린다. 반대로 상세에서 배운 우클릭 메뉴를 카드에서 기대하는 사용자는 기능 자체를 발견하지 못한다. 기능은 있는데 아무도 못 쓰는 상태.
- **수정 계획**: CharacterGrid(:1563-1567)의 onContextMenu를 즉시 실행 대신 CharacterImageContextMenu 표시로 교체한다: CharacterGrid에 cardMenu 상태({characterId,x,y})를 추가하고, 카드의 대표 복장(featured)을 찾아 hasImage/hasFolder/hasFile을 채워 동일 메뉴를 렌더링(onEditFit은 카드 맥락에선 숨기거나 detail을 열도록). '작업 폴더 열기'는 메뉴 항목으로 흡수되어 현재의 숨은 즉시 실행이 사라진다. CharacterListRow(:929)에도 동일 메뉴를 달거나 최소한 아무 동작도 안 하는 현행을 유지하되 카드와 상세는 반드시 통일한다.

#### UX-4 [P1] 캐릭터/복장 삭제가 OS 네이티브 window.confirm을 쓰고, 복구 수단이 전혀 없다 (스키마의 archived 상태는 UI 미노출)

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1173 - if (window.confirm(`'${character.name}' 캐릭터를 삭제할까요? 복장도 함께 삭제됩니다.`)) deleteCharacter(character.id)` / `src/views/CharacterBoardView.tsx:1002 - if (window.confirm(`'${costume.name}' 복장을 삭제할까요?`)) onDelete()` / `src/components/common/ConfirmDialog.tsx:71-72 - export const ConfirmDialog = { show(opts): Promise<boolean> } (앱 표준 확인창, ScenesView·RetakeHub 등 9개 파일에서 사용)` / `DEVLOG/migrations/2026-06-25-character-board-mvp.sql:26 - status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))`
- **확인된 사실**: 앱에는 디자인 토큰을 따르는 공용 ConfirmDialog.show()(danger 톤 지원)가 있고 씬/리테이크 허브가 이미 사용 중인데, 캐릭터 현황판만 window.confirm 2곳을 쓴다. DB에는 characters.status='archived'가 정의돼 있고 UI도 archived를 필터링(:1327, :1479)하지만, 보관 처리하거나 복원하는 UI는 어디에도 없다 — 사용자에게 주어진 유일한 파괴 수단은 hard delete(복장·이미지 스토리지까지 연쇄 삭제)뿐이다.
- **왜 문제인가**: Nielsen 3번(사용자 제어와 자유: 되돌리기)·4번(일관성) 동시 위반. window.confirm은 OS 룩앤필로 앱의 다크 테마를 깨고, Electron에서 렌더러를 블로킹한다. 복장 삭제 확인문은 대표 이미지·작업 파일 경로·버전 이력이 함께 사라진다는 사실을 알리지 않는다. 스키마가 이미 soft-delete를 설계해 두고 UI가 이를 버린 것은 설계 의도 미구현.
- **일으키는 문제**: 20명이 공유하는 데이터에서 한 명의 오클릭 → confirm 반사적 확인 → 캐릭터 전체(복장 N개+이미지+댓글 스레드) 영구 소실. Realtime으로 다른 사용자 화면에서도 즉시 사라지며 복구 경로가 없다. 프로덕션 트래킹 도구에서 가장 비싼 사고 유형.
- **수정 계획**: ① :1173과 :1002의 window.confirm을 ConfirmDialog.show({ message, confirmLabel: '삭제', tone: 'danger' })로 교체(비동기이므로 핸들러를 async로). 복장 삭제 메시지에 '대표 이미지와 작업 파일 연결도 함께 삭제됩니다' 명시. ② 캐릭터 삭제 버튼(:1171-1177)을 '보관'으로 바꾸고 svcUpdateCharacter(id, { status: 'archived' })를 호출하는 archiveCharacter 액션을 store에 추가, 그리드 툴바에 '보관된 캐릭터 N' 토글(또는 필터 칩)로 복원 경로 제공. hard delete는 보관 목록 안에서만 노출.
- **검증 교정(우선 적용)**: ① 'ScenesView·RetakeHub 등 9개 파일에서 사용' → 실제 ConfirmDialog.show 사용 파일은 5개(ScenesView, RetakeHubView, retake-hub/RetakeHubItemRow, scenes/RevisionPanel, scenes/SceneWorkLinksPanel). ② '캐릭터 현황판만 window.confirm 2곳' → 같은 기능의 EpisodeAssetBoard.tsx:193에도 1곳 더 있어 캐릭터 현황판 기능 내 총 3곳(앱의 나머지 window.confirm은 ConfirmDialog.tsx:75 폴백뿐). 주장을 약화시키지 않고 오히려 범위가 넓어지는 교정.

#### UX-5 [P1] 캐릭터 50+명 탐색 수단 부재 — 정렬 없음, 에피소드 필터 없음, Spotlight(Ctrl+Space) 미통합

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1493-1501 - filtered: 이름 부분일치 + 태그 AND 필터만` / `src/views/CharacterBoardView.tsx:1531-1549 - 툴바: 검색 input + 캐릭터 추가 버튼 + 태그 칩 (정렬/에피소드 필터 없음)` / `src/components/spotlight/SpotlightSearch.tsx:41 - 캐릭터 관련 코드는 '// character-by-character fuzzy' 주석(문자열 매칭 알고리즘 설명)뿐, 캐릭터 현황판 데이터 소스 없음` / `src/views/CharacterBoardView.tsx:1556 - grid-cols-[repeat(auto-fill,minmax(180px,1fr))] (표시 순서 = DB sortOrder 고정)`
- **확인된 사실**: 그리드 순서는 항상 등록순(store load 결과 그대로)이고 정렬 UI가 없다. 필터는 이름 검색과 태그 칩뿐인데, 태그(구조/에셋: '담배', '핸드폰' 등)는 복장의 세부 속성이라 '캐릭터를 찾는' 용도와 어긋난다. characters.episodeIds가 이미 로드돼 있음에도 '3화 등장 캐릭터만 보기' 같은 필터가 없다. 전역 검색(Ctrl+Space) SpotlightSearch는 씬/에피소드만 다루고 캐릭터를 색인하지 않는다.
- **왜 문제인가**: 50+명 규모에서 '등록순 그리드 + 이름 검색'은 이름을 정확히 기억할 때만 작동한다(회상 의존). 에피소드 작업 중인 팀원의 실제 질문은 '이번 화에 나오는 캐릭터들 리깅 어디까지 됐지?'인데 이 경로가 없다. 파워유저의 최단 경로(전역 검색 → 바로 상세)도 막혀 있다.
- **일으키는 문제**: Alex는 Ctrl+Space에 캐릭터 이름을 쳐도 아무것도 안 나와 매번 사이드바 → 캐릭터 현황판 → 검색창 3단계를 거친다. 100명 상태(Riley)에서는 스크롤 탐색이 사실상 유일한 수단이 되어 기능 사용률 자체가 떨어진다.
- **수정 계획**: ① CharacterGrid 툴바(:1532-1540)에 정렬 select 추가: sortKey 상태('registered'|'name'|'designProgress'|'riggingProgress'), filtered 뒤에 useMemo 정렬(이름은 localeCompare(ko), 진행률은 done/총복장 비율). ② 같은 툴바에 에피소드 필터 select(useDataStore.episodes 기반, 선택 시 c.episodeIds.includes(ep)로 필터). ③ SpotlightSearch.tsx에 캐릭터 소스 추가: useCharacterBoardStore.characters를 읽어 이름 fuzzy 매칭 섹션을 만들고, 선택 시 setCurrentView('character-board') + window.dispatchEvent(new CustomEvent('bflow:open-character', { detail: id })) → CharacterBoardView가 이 이벤트를 수신해 기존 pendingOpenId(:1584) 경로로 상세를 연다(접근 게이팅은 useCharacterBoardAccess로 소스 등록 자체를 조건부 처리).

#### UX-6 [P2] 상세 모달 좌측 캐릭터 목록이 그리드의 검색·필터 상태를 무시한 전체 목록이고, 목록 내 검색도 없다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1327 - activeCharacters = characters.filter((c) => c.status !== 'archived') (필터/검색어 미반영)` / `src/views/CharacterBoardView.tsx:1362-1372 - aside w-[200px]: 닫기 버튼 + 전체 목록 스크롤 (검색 input 없음)` / `src/views/CharacterBoardView.tsx:1468-1469 - query/activeTags는 CharacterGrid 로컬 상태 (모달에 전달 안 됨)`
- **확인된 사실**: CharacterDetailModal은 initialCharacterId만 받고 그리드의 query·activeTags는 받지 않는다. 좌측 목록은 항상 전체 캐릭터를 등록순으로 나열하며 필터·검색 수단이 없다.
- **왜 문제인가**: 사용자가 '교복' 태그로 5명을 추려 첫 카드를 열면, 좌측 목록에는 갑자기 전체 80명이 나타난다 — 방금 만든 작업 컨텍스트가 모달 진입과 동시에 증발한다(기억 다리 발생, Nielsen 6번). 마스터-디테일 패턴의 마스터가 바깥 그리드와 다른 집합을 보여주는 것은 같은 데이터에 대한 두 개의 진실을 만든다.
- **일으키는 문제**: 필터로 추린 캐릭터들을 순서대로 검토하려던 사용자가 모달 안에서 다시 스크롤로 대상을 찾아야 한다. 50+명이면 모달을 닫고 그리드로 돌아가 다음 카드를 여는 우회가 오히려 빨라져, 좌측 목록의 존재 이유가 사라진다.
- **수정 계획**: CharacterDetailModal에 filteredIds?: string[] prop을 추가하고 CharacterGrid(:1573)에서 filtered.map(c=>c.id)를 전달한다. activeCharacters(:1327)를 filteredIds 순서로 정렬·제한하되, 목록 상단에 '필터 결과 N명 · 전체 보기' 토글을 둬 전체 목록으로 전환 가능하게 한다. 추가로 aside 헤더(:1363-1367)에 소형 검색 input(목록 로컬 필터)을 넣는다.

#### UX-7 [P2] 같은 개념을 '복장'과 '디자인'으로 혼용 — 라벨·버튼·토스트·자동 이름이 서로 다른 단어를 쓴다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1233 - 섹션 라벨 "디자인 (복장)"` / `src/views/CharacterBoardView.tsx:1255 - 버튼 "디자인 추가" / :1127 - 자동 이름 `복장 ${n}`` / `src/views/CharacterBoardView.tsx:1270 - "복장이 없습니다. \"디자인 추가\"로 첫 복장을 만들어보세요."` / `src/views/CharacterBoardView.tsx:452 - 카드 통계 "복장 {costumes.length}" / :573 - 토스트 "먼저 디자인(복장)을 추가해주세요"`
- **확인된 사실**: '디자인 추가' 버튼을 누르면 '복장 1'이 생성된다. 카드에는 '복장 2'로 세고, 빈 상태 문구는 한 문장 안에서 두 단어를 오간다. 삭제 확인(:1002)은 '복장', 섹션 라벨은 '디자인 (복장)', 진행 배지(:459)는 '디자인 N/M'(이때 '디자인'은 복장이 아니라 designStage 단계를 뜻함)이다.
- **왜 문제인가**: 하나의 엔티티에 두 이름 + '디자인'이라는 단어가 엔티티(복장)와 공정 단계(designStage) 양쪽을 지칭하는 삼중 중의성. 신규 사용자는 '디자인 2/3'이 복장 수인지 공정 상태인지 매번 해석해야 한다(Nielsen 2번·4번).
- **일으키는 문제**: Jordan이 '디자인 추가'를 눌렀는데 '복장 1'이 생기면 자기가 맞는 걸 눌렀는지 의심한다. 팀 대화에서도 '그 캐릭터 디자인 3개야'가 복장 수인지 완료된 디자인 단계 수인지 갈린다.
- **수정 계획**: 엔티티 명칭을 '복장' 하나로 통일한다(팀 실무 용어이자 DB 명칭). 수정 지점: :1233 라벨 → '복장', :1251/:1255 → '복장 추가', :1270 → '복장이 없습니다. "복장 추가"로 시작해보세요.', :573 → '먼저 복장을 추가해주세요', :1089 동일. 공정 단계를 뜻하는 '디자인 N/M' 배지(:459)와 '디자인 단계' 레일(:861)은 그대로 두면 중의성이 해소된다.

#### UX-8 [P2] '이미지 바꾸기'가 확인 없이 이전 대표 이미지를 스토리지에서 영구 삭제한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:580 - // 이전 대표 이미지 정리는 서버(updateCharacterCostume)가 DB 업데이트 성공 후 처리` / `src/views/CharacterBoardView.tsx:622 - {uploading ? '업로드 중...' : shownUrl ? '이미지 바꾸기' : '이미지 추가'}` / `src/views/CharacterBoardView.tsx:655 - 파일 선택 즉시 handleUpload 실행 (미리보기/확인 단계 없음)`
- **확인된 사실**: 이미지가 있는 복장에서 '이미지 바꾸기' → 파일 선택 → 즉시 업로드·DB 반영되며, 서버가 이전 이미지를 스토리지에서 삭제한다(주석 :580, electron/supabase.ts의 updateCharacterCostume 정리 로직). 교체 전 확인이나 되돌리기가 없고, 업로드본은 800px 리사이즈본이라 앱 안에는 원본도 없다.
- **왜 문제인가**: 파괴적 결과(이전 이미지 영구 소실)를 수반하는 행동이 비파괴적 행동(추가)과 동일한 원클릭 플로우다. 삭제에는 confirm을 두면서(:1002) 사실상 같은 손실을 일으키는 교체에는 아무 장치가 없는 것은 보호 수준의 비일관성이다(Nielsen 3번·5번).
- **일으키는 문제**: 다른 복장을 보고 있는 줄 착각하고 이미지를 바꾸면 이전 이미지는 복구 불가. 원본 파일이 작업 폴더에 있으면 재업로드로 만회되지만, 썸네일 맞추기로 잡아둔 구도까지는 되살릴 수 없어 재작업이 된다.
- **수정 계획**: handleUpload(:572)에서 shownUrl이 이미 있을 때 업로드 전에 ConfirmDialog.show({ message: '현재 이미지를 새 이미지로 바꿀까요?\n이전 이미지는 복구할 수 없어요.', confirmLabel: '바꾸기', tone: 'danger' })를 거치게 한다. 더 나은 안: 파일 선택 직후 새 이미지 미리보기 + '적용/취소' 2버튼의 소형 오버레이(FitEditor 셸 재사용)를 띄워 확인과 첫 구도 조정을 한 번에 처리.

#### UX-9 [P2] 출연 에피소드 칩 — 툴팁은 우클릭 기능('릴 파일')을 설명하는데 실제 클릭은 연결 토글이라 안내가 서로 어긋난다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1212 - onClick={() => (linked ? unlinkEpisode(...) : linkEpisode(...))}` / `src/views/CharacterBoardView.tsx:1213-1216 - onContextMenu → handleEpisodeReel(ep) (릴 열기/등록)` / `src/views/CharacterBoardView.tsx:1217 - title={ep.reelFilePath ? '릴 파일 보기' : '릴 파일 등록'}` / `src/views/CharacterBoardView.tsx:1103-1108 - handleEpisodeReel: 미등록이면 파일 선택기 → 경로 등록`
- **확인된 사실**: 칩에 마우스를 올리면 '릴 파일 등록' 툴팁이 뜨지만, 클릭하면 릴이 아니라 에피소드 연결이 토글된다(연결 해제는 확인 없음). 릴 기능은 우클릭에만 있고 그 사실을 알려주는 표기는 없다. 우클릭 시 릴이 미등록이면 곧바로 OS 파일 선택기가 떠 UX-2와 같은 '조용한 등록' 패턴이 반복된다.
- **왜 문제인가**: 유일하게 제공되는 힌트(title)가 주 동작이 아닌 숨은 보조 동작을 설명해, 안내가 없느니만 못한 적극적 오도가 된다(Nielsen 1번·2번). 연결된 에피소드 칩을 '확인하려고' 클릭하면 연결이 해제되는 것도 인식(보기)과 조작(토글)이 한 타깃에 겹친 설계다.
- **일으키는 문제**: 툴팁을 믿고 클릭한 사용자는 릴 파일 대신 에피소드 연결이 풀리는 걸 목격한다 — 데이터 변경 + 기대 배반 이중 사고. 릴 파일 기능 자체는 우클릭을 우연히 눌러본 사람만 발견한다.
- **수정 계획**: ① title(:1217)을 클릭 동작 기준으로 교체: linked ? '클릭: 연결 해제 · 우클릭: 릴 파일' : '클릭: 이 에피소드에 연결'. ② 릴 기능을 우클릭에서 꺼내 가시화: 칩 옆 또는 칩 hover 시 나타나는 Film 아이콘 버튼으로 분리하고, 미등록 상태에서 아이콘을 점선 스타일로 구분. ③ unlinkEpisode 호출 전 ConfirmDialog는 과할 수 있으니 대신 toast에 '실행 취소' 액션(sonner action)으로 재연결을 제공한다.
- **검증 교정(우선 적용)**: 앵커 세부: 미등록 → 파일 선택기 → 등록 흐름은 :1103-1108이 아니라 :1108-1114(함수 전체는 :1103-1120). 주장 내용에는 영향 없음.

#### UX-10 [P2] 복장 삭제 버튼이 hover 시에만 나타나는 X 아이콘이고 키보드로 접근 불가 — X는 '닫기' 관습과 충돌

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:998-1006 - span role="button" tabIndex={-1} ... opacity-0 group-hover:opacity-100 ... <X size={12} />` / `src/views/CharacterBoardView.tsx:1001 - aria-label={`${costume.name} 삭제`} (라벨은 삭제인데 아이콘은 X)` / `src/views/CharacterBoardView.tsx:1176 - 캐릭터 삭제는 <Trash2 size={14} /> 삭제 (같은 화면에서 다른 아이콘 문법)`
- **확인된 사실**: CostumeThumbCard 우상단 삭제 트리거는 tabIndex={-1}의 span이라 Tab 포커스가 불가능하고, opacity-0 → group-hover로만 나타난다. 같은 패널의 캐릭터 삭제(:1176)는 Trash2 아이콘 + '삭제' 텍스트를 쓴다. 선택된 썸네일에는 X가 '선택 해제'로 오독될 여지가 크다.
- **왜 문제인가**: 파괴적 액션이 ① 발견 불가(hover 전에는 없음) ② 키보드 도달 불가 ③ 관습 충돌(X=닫기/해제, 여기선 영구 삭제) 3중 문제를 갖는다. 같은 화면 안에서 삭제 아이콘이 X와 Trash2로 갈리는 것도 일관성 위반(Nielsen 4번).
- **일으키는 문제**: 터치패드/펜 사용자와 키보드 사용자는 복장 삭제 경로를 찾지 못하고, 반대로 마우스 사용자는 '이 썸네일 선택을 해제하려고' X를 눌렀다가 삭제 확인창을 만난다. confirm이 마지막 방어선이지만 반사적 확인으로 뚫리기 쉽다.
- **수정 계획**: ① :998-1006의 span을 button으로 바꾸고 tabIndex 제거(기본 0), 아이콘을 X → Trash2로 교체. ② hover 전용 노출은 유지하되 focus-visible에서도 나타나도록 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 추가. ③ 장기적으로는 썸네일 위 X 대신 복장 이미지 우클릭 메뉴(CharacterImageContextMenu)에 '복장 삭제' 항목을 추가해 파괴 액션을 메뉴로 모으는 편이 오클릭 면적을 없앤다.

#### UX-11 [P3] 접근 권한이 없거나 회수되면 안내 없이 Dashboard로 바꿔치기된다

- **판정**: CONFIRMED
- **코드 앵커**: `src/App.tsx:2808-2809 - case 'character-board': return hasCharacterBoardAccess ? <CharacterBoardView /> : <Dashboard />;` / `src/hooks/useCharacterBoardAccess.ts:69 - if (!currentUser || !config) return false; (로딩 중에도 false)`
- **확인된 사실**: 권한 미보유·조회 실패·조회 중(fail-closed) 모두 hasCharacterBoardAccess=false가 되고, character-board 뷰 요청은 아무 메시지 없이 Dashboard 렌더로 대체된다. 사용 중 권한이 회수되면(metadata broadcast 수신) 보고 있던 화면이 설명 없이 Dashboard로 바뀐다.
- **왜 문제인가**: 시스템 상태 가시성(Nielsen 1번) 결여. '내가 뭘 잘못 눌렀나'와 '권한이 없구나'를 구분할 정보가 0이다. fail-closed 자체는 옳은 보안 결정이지만, 그 결과를 사용자에게 침묵으로 전달할 이유는 없다.
- **일으키는 문제**: 권한 협의가 진행 중인 팀원이 링크/기억으로 진입을 시도하면 대시보드만 반복해서 보게 되고, '캐릭터 현황판이 안 열려요'라는 서포트 문의가 한솔에게 온다. 실제 원인(권한 미부여)을 스스로 알 방법이 없다.
- **수정 계획**: App.tsx:2809의 폴백을 <Dashboard /> 대신 소형 안내 컴포넌트로 교체: 중앙 정렬 카드에 Lock 아이콘 + '캐릭터 현황판은 접근 권한이 필요해요' + '관리자에게 요청해주세요' 문구(로딩 중과 구분하려면 useCharacterBoardAccess가 boolean 대신 'loading'|'granted'|'denied' 3상태를 반환하도록 확장하고 loading에는 스피너). 신규 파일 src/views/CharacterBoardAccessDenied.tsx 정도의 20줄짜리면 충분하다.

#### UX-12 [P3] 복장 0개 카드에 '디자인 0/0'·'리깅 0/0' 배지가 그대로 노출되고, 그리드 빈 상태에 행동 버튼이 없다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:457-464 - 배지 2개 무조건 렌더링 (costumes.length===0이면 0/0)` / `src/views/CharacterBoardView.tsx:1551-1552 - 빈 상태: 텍스트만 "아직 캐릭터가 없습니다. \"캐릭터 추가\"로 시작해보세요."` / `src/views/CharacterBoardView.tsx:452 - "복장 0" 카운트도 함께 표시`
- **확인된 사실**: CharacterCard의 진행 배지는 복장 수와 무관하게 항상 렌더링되어 방금 만든 캐릭터는 '복장 0 · 디자인 0/0 · 리깅 0/0' 세 개의 0을 단다. 첫 진입 빈 상태는 py-16 텍스트 한 줄뿐이고 '캐릭터 추가' 버튼은 화면 우상단 툴바에 따로 있다(문구가 버튼 위치를 지시하지 않음).
- **왜 문제인가**: 0/0은 정보가 아니라 소음이며, 색 틴트 배지(#A29BFE/#00B894)라 오히려 '뭔가 진행된 것 같은' 인상을 준다. 빈 상태는 다음 행동을 그 자리에서 제공해야 하는데(인식>회상), 문구로 다른 위치의 버튼을 '설명'만 한다.
- **일으키는 문제**: 첫 사용자(Riley의 0개 상태)가 빈 화면에서 시선을 한 바퀴 돌려 버튼을 찾아야 하고, 캐릭터를 만든 직후에는 0/0 배지의 의미를 해석하느라 멈칫한다. 치명적이진 않지만 첫인상 구간의 마찰.
- **수정 계획**: ① CharacterCard(:457-464)에서 costumes.length===0이면 배지 2개 대신 단일 안내 배지 '복장을 추가해주세요'(text-text-secondary, 배경 bg-bg-border/30)로 교체. ② 빈 상태(:1551-1552)를 아이콘(ImageIcon) + 문구 + 그 자리의 <Plus /> 캐릭터 추가 버튼(onAdd 재사용)으로 구성된 empty state 블록으로 교체.

#### UX-13 [P3] 상세 모달 좌측 목록의 초록 진행바는 의미 표기가 없고, 썸네일은 유일하게 fit/배경 설정을 무시한 raw 크롭이다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:910-913 - riggingRatio: 리깅 done 비율 (디자인 단계는 미반영)` / `src/views/CharacterBoardView.tsx:943-944 - 라벨·툴팁 없는 1px 높이 바, backgroundColor '#00B894'` / `src/views/CharacterBoardView.tsx:938-939 - <img src={thumb} ... object-cover /> (CharacterImageFrame 미사용)`
- **확인된 사실**: 목록 행의 진행바는 리깅 완성 복장 비율만 표시하는데 라벨·title·aria가 전혀 없다. 썸네일은 raw <img> object-cover라서, 사용자가 '썸네일 맞추기'로 공들여 잡은 구도와 배경 설정이 카드·상세·갤러리에는 적용되고 이 목록에서만 무시된다.
- **왜 문제인가**: 무표기 시각화는 각자 다르게 해석된다(디자인 진행률? 전체 완성도?). 썸네일 맞추기의 산출물이 화면마다 적용/미적용이 갈리면 사용자는 그 기능의 효과 범위를 신뢰할 수 없게 된다(동일 데이터=동일 표현 위반).
- **일으키는 문제**: 목록에서 초록바가 꽉 찬 캐릭터를 '다 끝난 것'으로 읽었는데 디자인 단계는 피드백 중일 수 있다. 얼굴이 위쪽에 있는 세로 이미지는 object-cover 중앙 크롭으로 목록에서 얼굴이 잘리는데, 사용자는 썸네일 맞추기를 이미 했으므로 버그로 인식한다.
- **수정 계획**: ① CharacterListRow(:938-939)의 raw img를 CharacterImageFrame(url, background, fit, className="w-full h-full")로 교체 — 대표 복장 객체(costumes.find(c=>c.featuredImageUrl))를 그대로 넘긴다. ② 진행바(:943)에 title={`리깅 완성 ${done}/${total}`} 추가하고, 색을 RIGGING_STAGE_META.done과 동일 근거로 유지. 여유가 되면 디자인/리깅 2단 미니 바 또는 단일 바에 두 색 분절로 확장.

#### UX-14 [P3] 상세 모달이 고정 1024px + 댓글 패널 기본 열림이라 좁은 화면에서 모달 내부가 가로 스크롤된다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1352 - w-[1024px] shrink-0 고정 폭` / `src/views/CharacterBoardView.tsx:1350 - overflow-x-auto overflow-y-hidden (넘치면 가로 스크롤)` / `src/views/CharacterBoardView.tsx:1330 - const [commentOpen, setCommentOpen] = useState(true); (기본 열림)`
- **확인된 사실**: 모달 본체는 1024px 고정에 shrink-0이고, 댓글 패널(CommentPanelResizable)이 기본으로 항상 함께 열린다. 두 패널 합이 뷰포트를 넘으면 컨테이너 overflow-x-auto가 모달 자체를 가로 스크롤시킨다. 1366×768급 노트북에서는 1024 + 댓글 패널 + gap/패딩이 뷰포트를 초과한다.
- **왜 문제인가**: 모달은 한 화면에 온전히 담겨야 하는 컨테이너인데, 열자마자 우측(댓글)이나 좌측(목록)이 잘린 채 시작하면 사용자는 잘림을 인지조차 못 하거나 모달 안에서 수평 스크롤이라는 이질적 조작을 해야 한다. '관련 정보는 한 화면에 공존' 원칙 위반.
- **일으키는 문제**: 노트북 사용자는 캐릭터 상세를 열 때마다 댓글 패널이 화면 밖에 있어 댓글 존재 자체를 모르거나, 단계 레일을 조작하려고 좌우로 스크롤하게 된다. 매 사용마다 반복되는 저강도 마찰.
- **수정 계획**: ① :1352의 고정 폭을 w-[min(1024px,calc(100vw-2rem))]로 바꿔 뷰포트에 맞춰 수축시키고, 내부 좌측 목록(:1362 w-[200px])은 좁을 때 숨김(hidden lg:flex). ② commentOpen 초기값(:1330)을 window.innerWidth 기준 분기(useState(() => window.innerWidth >= 1440))로 바꾸거나, 뷰포트가 부족하면 댓글 패널을 모달 위에 겹치는 오버레이 모드로 전환한다.

### 6.2 비주얼 디자인 / 일관성 (VD-1 ~ VD-11)

**차원 총평**: 캐릭터 현황판의 비주얼 완성도는 앱의 기존 다크 테마 관례(bg-card/bg-border/text-secondary 토큰, 스피너 패턴, accent 버튼)를 대체로 따르고 있으나, 두 가지 구조적 문제가 크다. 첫째, 단계색·배지·진행바가 다크 모드 기준 hex로 하드코딩되어 있어 앱이 공식 지원하는 라이트 모드(themes.ts getLightColors, 흰색 카드)에서 대비가 1.5~2.5:1로 붕괴한다 — 컴포지팅 대시보드가 이미 CSS 변수 + 라이트 오버라이드 패턴(index.css --status-*)을 확립했는데 이를 따르지 않았다. 둘째, "썸네일 맞추기" 편집기(3:4)·상세 대표(3:4)·복장 썸네일(3:4)과 달리 그리드 카드만 4:3이라, 사용자가 편집기에서 맞춘 프레이밍이 정작 첫 화면인 카드에서 다르게 렌더링되고 전신 캐릭터가 필러박스로 작게 보인다. 그 외 240px 폭 3버튼 줄바꿈(앱 공용 장치 CompactIconLabel 미사용), text-secondary/50~/70 저대비 남용(2.3~3.4:1), 위험색·radius·z-index·오버레이 토큰의 국소적 비일관이 확인됐다. 전반적으로 P0급 차단 요소는 없고, 토큰화와 비율 통일이 핵심 개선 축이다.

#### VD-1 [P1] 단계색·배지·진행바가 다크 전용 hex로 하드코딩되어 라이트 모드에서 대비가 붕괴함 (1.5~2.5:1)

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:49-61 - DESIGN_STAGE_META/RIGGING_STAGE_META: color: '#8B8DA3' / '#74B9FF' / '#FDCB6E' / '#A29BFE' / '#00B894' / '#6C5CE7'` / `src/views/CharacterBoardView.tsx:458 - style={{ backgroundColor: '#A29BFE22', color: '#A29BFE' }} (카드 '디자인 n/n' 배지)` / `src/views/CharacterBoardView.tsx:461 - style={{ backgroundColor: '#00B89422', color: '#00B894' }} (카드 '리깅 n/n' 배지)` / `src/views/CharacterBoardView.tsx:944 - backgroundColor: '#00B894' (좌측 목록 진행바)` / `src/views/CharacterBoardView.tsx:357 - style={{ color: curColor }} (단계 라벨 텍스트에 hex 직접 사용)` / `src/index.css:124-129, 178-183 - 컴포지팅은 --status-* CSS 변수 + [data-color-mode="light"] 오버라이드로 동일 문제를 이미 해결한 선례` / `src/themes.ts:262-275 - getLightColors: 라이트 모드 bgCard = '255 255 255' (흰색 카드)`
- **확인된 사실**: CharacterBoardView.tsx:49-61의 단계 META가 hex 리터럴로 고정되어 있고, StageRail 라벨(:357, :402), 노드 글로우(:394 `${m.color}33`), 카드 배지(:458, :461), 진행바(:944)가 모두 이 값을 그대로 텍스트/배경색으로 사용한다. 앱은 라이트 모드를 공식 지원하며(themes.ts:262 getLightColors, useAppStore colorMode) 라이트 모드 카드가 순수 흰색이다. 컴포지팅 대시보드는 같은 계열 색을 index.css:124-129에 CSS 변수로 두고 :178-183에서 라이트 오버라이드(#FDCB6E→#C99224 등)까지 마련했지만, 캐릭터 현황판은 이 패턴을 사용하지 않았다.
- **왜 문제인가**: 테마 시스템(CSS 변수 기반)이 존재하는 앱에서 상태색을 컴포넌트에 hex로 박으면 테마·모드 전환이 해당 화면만 비껴간다. WCAG 기준 흰 배경 위 #FDCB6E=1.5:1, #74B9FF=2.1:1, #A29BFE=2.4:1, #00B894=2.5:1, #8B8DA3=3.3:1로 전부 4.5:1(본문)은 물론 3:1(큰 텍스트)에도 미달한다.
- **일으키는 문제**: 라이트 모드 사용자는 단계 라벨('피드백', '벡터화' 등)과 카드의 디자인/리깅 배지를 사실상 읽을 수 없다. 특히 노랑 #FDCB6E(피드백)은 흰 카드에서 거의 소실된다. 같은 앱 안에서 컴포지팅 뷰는 라이트 모드에서 색이 진해지는데 캐릭터 현황판만 흐릿해져 품질 낙차가 체감된다.
- **수정 계획**: 1) src/index.css :root에 RGB triplet 변수 추가: --char-stage-waiting: 139 141 163; --char-stage-progress: 116 185 255; --char-stage-rigging: 108 92 231; --char-stage-feedback: 253 203 110; --char-stage-done: 162 155 254; --char-stage-complete: 0 184 148;. [data-color-mode="light"] 블록에 컴포지팅 값을 차용해 오버라이드(--char-stage-progress: 46 134 222; --char-stage-feedback: 201 146 36; --char-stage-complete: 0 165 137; --char-stage-waiting: 107 114 128; --char-stage-done: 108 92 231 등). 2) META의 color 필드를 hex 대신 triplet 변수명 문자열로 바꾸고(예: cssVar: '--char-stage-done'), 사용처를 `rgb(var(${cssVar}))`, 글로우는 `rgb(var(${cssVar}) / 0.2)`, 배지 배경은 `rgb(var(${cssVar}) / 0.13)` 형태로 치환 — 현재 `${m.color}33` 같은 hex+alpha 접미사 방식은 var()와 호환되지 않으므로 반드시 rgb(var()/alpha) 문법으로 바꿀 것. 대상: :357, :384, :392-394, :402, :458, :461, :944. 3) VD-9의 공용 상수 모듈 추출과 함께 진행하면 EpisodeAssetBoard도 동시 해결됨.

#### VD-2 [P1] 그리드 카드만 4:3 가로 비율이라 편집기(3:4)에서 맞춘 프레이밍과 다르게 보이고 전신 캐릭터 표시에 부적합함

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:436 - <div className="aspect-[4/3] bg-bg-border/30 ..."> (그리드 카드 이미지 영역)` / `src/views/CharacterBoardView.tsx:606 - 'group aspect-[3/4] w-full rounded-xl ...' (상세 대표 이미지)` / `src/views/CharacterBoardView.tsx:976 - <div className="aspect-[3/4] w-full ..."> (복장 썸네일)` / `src/components/characters/CharacterImageFitEditor.tsx:335 - className="... h-[72%] max-h-[390px] min-h-[280px] aspect-[3/4] ..." (썸네일 맞추기 크롭 프레임)` / `src/components/characters/CharacterImageFrame.tsx:72-76 - object-contain + transform translate(%)·scale, 컨테이너 비율에 따라 contain 기준 박스가 달라짐` / `src/views/CharacterBoardView.tsx:1556 - grid-cols-[repeat(auto-fill,minmax(180px,1fr))]`
- **확인된 사실**: 같은 imageFit(scale/x/y)이 상세 대표·복장 썸네일·FitEditor 크롭 프레임에서는 모두 3:4 컨테이너에 적용되는데, 그리드 카드(:436)만 4:3 컨테이너에 적용된다. CharacterImageFrame은 object-contain 기반이라 컨테이너 비율이 바뀌면 이미지의 기준 크기와 잘리는 영역(overflow-hidden)이 함께 바뀐다. FitEditor의 크롭 프레임(:335)은 3:4 고정이므로, 사용자가 편집기에서 확인한 구도는 3:4 표면에서만 재현된다.
- **왜 문제인가**: 편집 미리보기와 실제 표시가 달라지는 것은 WYSIWYG 원칙 위반이다. 또한 캐릭터 디자인 자료는 통상 세로형 전신 이미지인데, 4:3 가로 프레임은 180px 카드에서 이미지를 약 101×135px로 축소시키고 양옆에 배경색 필러박스를 만들어 기능의 핵심 목적(캐릭터 한눈에 보기)에 불리하다.
- **일으키는 문제**: 사용자가 '썸네일 맞추기'로 공들여 구도를 잡아도 정작 가장 많이 보는 첫 화면(카드 그리드)에서는 머리/발이 다르게 잘리거나 필러박스가 생긴다. '맞췄는데 왜 카드는 이렇죠?'라는 서포트 문의 수준의 혼란을 유발한다. 라이트박스(CharacterImageLightbox.tsx:106-112)도 가변 비율 컨테이너에 fit을 적용해 세 번째 변형이 생긴다.
- **수정 계획**: 1) CharacterBoardView.tsx:436의 aspect-[4/3]를 aspect-[3/4]로 변경해 편집기·상세·썸네일과 비율을 통일. 카드가 세로로 길어지므로 :1556의 minmax(180px,1fr)를 minmax(160px,1fr)로 낮춰 밀도를 보정(선택). 2) 라이트박스는 '크게 보기' 목적이므로 fit 적용을 빼고 원본 object-contain으로 보여주는 것을 검토 — CharacterImageLightbox.tsx:106-112에서 fit prop을 DEFAULT_CHARACTER_IMAGE_FIT으로 고정하면 됨(단, 이 경우 '썸네일 맞추기' 진입점은 유지). 최소한 1)은 필수.

#### VD-3 [P2] 상세 좌측 3버튼('작업 폴더/작업 파일/이미지 복사')이 76px 셀에서 줄바꿈됨 — 앱 공용 라벨 축약 장치 미사용

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:624 - <div className="grid grid-cols-3 gap-1.5"> (부모 w-[240px], 셀당 약 76px)` / `src/views/CharacterBoardView.tsx:628 - className="flex items-center justify-center gap-1 rounded-md border border-bg-border px-1.5 py-1 text-[11px] ..." (whitespace-nowrap·truncate 없음)` / `src/views/CharacterBoardView.tsx:631, 639, 647 - 라벨 '작업 폴더' / '작업 파일' / '이미지 복사' (공백 포함 → 공백에서 줄바꿈)` / `src/components/common/CompactIconLabel.tsx:37 - 공용 컴포넌트는 min-w-0 whitespace-nowrap 내장` / `src/index.css:337-384 - .compact-label-container: 좁은 화면에서 아이콘을 자동 축약하는 전역 장치 (ScenesView·CompositingView에서 사용 중)`
- **확인된 사실**: 3버튼은 w-[240px](:599) 안의 grid-cols-3 gap-1.5(:624)라 셀 폭이 (240−12)/3 = 76px. 버튼 콘텐츠 가용폭은 76 − 12(px-1.5) − 2(border) − 16(아이콘 12+gap 4) = 약 46px인데, '이미지 복사'는 11px 한글 5자+공백 ≈ 58px, '작업 폴더'는 ≈ 47px로 가용폭을 초과한다. 라벨에 공백이 있고 whitespace-nowrap이 파일 전체에 한 번도 없어(grep 확인) 공백 지점에서 두 줄로 꺾인다. 앱에는 이미 CompactIconLabel + .compact-label-container(whitespace-nowrap + 좁을 때 아이콘 자동 숨김 + reduced-motion 가드)가 있고 ScenesView:5725, CompositingView:565 등에서 사용 중이지만 캐릭터 현황판은 미사용.
- **왜 문제인가**: 버튼 라벨이 줄바꿈되면 3버튼 행의 높이가 서로 달라져 정렬이 깨지고, 두 줄 버튼은 '버튼 라벨은 줄바꿈으로 깨지면 안 된다'는 기준 위반이다. 사용자 커스텀 글꼴 설정(FontColorSection 존재)으로 글자폭이 커지면 확실히 재현된다.
- **일으키는 문제**: 기본 폰트에서도 '이미지 복사'가 '이미지\n복사' 두 줄로 렌더링되어 옆 버튼과 높이가 어긋나고, 상세 패널 좌측 하단이 조악해 보인다. 커스텀 폰트 사용자는 세 버튼 모두 깨진다.
- **수정 계획**: 세 버튼(:625-648)의 라벨을 CompactIconLabel로 감싸고(icon={<FolderOpen size={12}/>} label="작업 폴더" 형식), 3버튼 그리드 부모에 compact-label-container 클래스를 부여해 좁을 때 아이콘이 자동 축약되게 한다. CompactIconLabel 도입이 부담이면 최소 수정으로 각 버튼에 whitespace-nowrap + 아이콘에 shrink-0을 추가하고 라벨을 '폴더'/'파일'/'복사'로 축약 + title 속성으로 전체 라벨 제공.
- **검증 교정(우선 적용)**: fix 1안의 기전 결함: .compact-label-container의 아이콘 자동 축약은 컨테이너 폭이 아니라 @media (max-width: 1040px) 뷰포트 기준(index.css:365-375). 문제의 셀은 뷰포트와 무관하게 항상 76px 고정이므로, 넓은 창(>1040px)에서는 compact-label-container를 붙여도 아이콘이 숨지 않고, CompactIconLabel의 whitespace-nowrap+max-width/overflow:hidden(index.css:357-363)으로 줄바꿈 대신 말줄임 없는 클리핑이 발생한다. 이 케이스의 올바른 해법은 finding의 대안 fix(whitespace-nowrap + 라벨 축약 '폴더'/'파일'/'복사' + title 속성) 쪽이며, CompactIconLabel 도입은 단독으로는 이 셀의 문제를 해결하지 못한다. '작업 폴더'/'작업 파일'(≈47px)은 폰트에 따라 경계선상 — 확정 재현은 '이미지 복사'.

#### VD-4 [P2] text-secondary에 /50~/70 투명도를 얹은 저대비 텍스트 다수 — 다크 기본 테마에서 2.3~3.4:1로 4.5:1 미달

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:732 - text-[11px] text-text-secondary/70 (복장 이름 옆 v{versionNo})` / `src/views/CharacterBoardView.tsx:996 - text-[10px] text-text-secondary/70 (썸네일 카드 v{versionNo}, 10px)` / `src/views/CharacterBoardView.tsx:402 - color: 'rgb(var(--color-text-secondary) / 0.5)' (StageRail 미도달 단계 라벨, 11px 클릭 타깃 라벨)` / `src/views/CharacterBoardView.tsx:263 - text-text-secondary/60 ('미지정')` / `src/views/CharacterBoardView.tsx:1227 - text-text-secondary/60 ('등록된 에피소드가 없어요')` / `src/views/CharacterBoardView.tsx:255, 1545 - text-text-secondary/70 ('해제', '필터 해제' 액션 버튼)` / `src/components/characters/CharacterImageContextMenu.tsx:88 - text-[11px] uppercase text-text-secondary/70 ('배경 표기' 섹션 헤더)` / `src/views/CharacterBoardView.tsx:203 - placeholder:text-text-secondary/50`
- **확인된 사실**: 기본 Violet Dream 테마에서 text-secondary(#8B8DA3)는 bg-card(#1A1D27) 위 5.1:1로 통과하지만, /70 합성 시 3.2:1(카드)·3.4:1(배경), /60은 2.7:1, /50은 2.3:1로 계산된다(알파 블렌딩 후 WCAG 상대휘도 계산). 해당 조합이 10~12px 초소형 텍스트와 클릭 가능한 라벨('해제', '필터 해제', StageRail 단계명)에 사용되고 있다.
- **왜 문제인가**: 본문/기능성 텍스트 4.5:1 기준 위반. 특히 StageRail 미도달 단계 라벨(:402)은 '클릭해서 단계를 설정하는' 버튼의 유일한 텍스트인데 2.3:1이면 어떤 단계로 옮길 수 있는지 읽기 어렵다. 이미 muted인 색 위에 opacity를 다시 얹는 이중 감쇠 패턴이 근본 원인.
- **일으키는 문제**: 버전 표기(v1, v2)와 단계명, 보조 액션이 어두운 환경·저품질 모니터에서 식별 불가에 가까워진다. 20명 팀 중 시력이 낮은 구성원은 리깅/디자인 단계 전환 시 목표 라벨을 읽지 못해 잘못 클릭할 수 있다.
- **수정 계획**: 1) 클릭 가능/정보성 텍스트는 투명도 제거: :402를 'rgb(var(--color-text-secondary))'로(미도달 구분은 노드 채움 여부로 이미 표현됨), :255·:1545·ContextMenu:88을 text-text-secondary로 상향. 2) v{versionNo}(:732, :996)는 text-text-secondary(/70 제거)로 올리고 :996의 text-[10px]는 text-[11px]로. 3) '미지정'·빈 문구(:263, :1227)는 /60 → /80 이상. 4) placeholder(/50)는 관례상 허용 범위지만 /60까지 상향 권장.

#### VD-5 [P3] 썸네일 맞추기 편집기의 크롭 프레임·그리드·코너 핸들이 전부 흰색이라 흰색/체커 배경에서 소실됨

- **판정**: CONFIRMED
- **코드 앵커**: `src/components/characters/CharacterImageFitEditor.tsx:341 - shadow-[0_0_0_2px_rgba(255,255,255,0.94),...] (크롭 프레임 외곽 흰 링)` / `src/components/characters/CharacterImageFitEditor.tsx:360 - bg-[linear-gradient(...rgba(255,255,255,0.18)...)] (3분할 그리드 라인)` / `src/components/characters/CharacterImageFitEditor.tsx:362-365 - border-white 코너 핸들 4개` / `src/components/characters/CharacterImageFitEditor.tsx:312 - style={getCharacterImageBackgroundStyle(background)} (워크스페이스가 선택된 배경색을 그대로 사용)` / `src/components/characters/CharacterImageFrame.tsx:8-17 - 'white'는 #ffffff, 'checker'는 #ffffff 베이스`
- **확인된 사실**: 편집기 워크스페이스(:306-312)는 복장에 설정된 imageBackground를 그대로 배경으로 깔며, white/checker는 #ffffff 기반(CharacterImageFrame.tsx:8-17)이다. 크롭 프레임의 시각 요소는 외곽 2px 흰 링(rgba 255,255,255,0.94), 흰색 코너 핸들(border-white), 흰색 18% 그리드 라인으로 전부 흰색 계열이다. 프레임 밖 dim 오버레이(bg-black/28, :287)와 1px 검정 inset(:341)이 있어 영역 자체는 구분되지만, 링·코너·그리드는 흰 배경에서 대비가 2:1 미만으로 떨어진다.
- **왜 문제인가**: 편집 도구의 기준선(크롭 경계·3분할 그리드)은 어떤 배경에서도 보여야 한다. 배경이 사용자 데이터(흰색 PNG 확인용 배경)에 따라 변하는 화면에서 단일색 UI 크롬을 쓰는 것은 자기 파괴적 조합이다.
- **일으키는 문제**: 흰색/체커 배경 복장을 편집할 때 3분할 그리드가 완전히 사라지고 코너 핸들이 흐릿해져, 구도를 정밀하게 맞추는 도구의 정확도가 떨어진다. 우회는 가능(배경을 잠시 검정으로 바꾸기)하나 사용자가 그 우회를 떠올리기 어렵다.
- **수정 계획**: 1) 코너 핸들(:362-365)에 drop-shadow(0 0 2px rgba(0,0,0,0.7)) 또는 이중 보더(안쪽 흰색+바깥 검정)를 추가. 2) 그리드 라인(:360)을 흰색 단일 대신 mix-blend-difference를 적용하거나, 흰 1px + 검정 1px 오프셋 이중 라인으로 교체. 3) 외곽 링(:341)의 box-shadow에 0 0 0 3px rgba(0,0,0,0.45)를 한 겹 더 추가해 밝은 배경에서도 경계가 남게 한다.

#### VD-6 [P3] 삭제/위험 색상이 앱 관례(text-red-400 계열)와 다른 임의 hex hover:text-[#FF6B6B] 사용

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1003 - hover:text-[#FF6B6B] (복장 썸네일 삭제 X)` / `src/views/CharacterBoardView.tsx:1174 - hover:text-[#FF6B6B] (캐릭터 삭제 버튼)` / `src/views/EpisodeAssetBoard.tsx:194 - hover:text-[#FF6B6B] (매핑 제거)` / `src/views/ScenesView.tsx:1121 - hover:text-red-400 hover:bg-red-500/10 (앱 관례 예시)` / `src/views/RetakeHubView.tsx:197 - hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/10 (앱 관례 예시)`
- **확인된 사실**: 캐릭터 현황판 계열 3곳만 arbitrary value hover:text-[#FF6B6B]를 쓰고, ScenesView·RetakeHubView·VacationView·Dashboard·ScheduleView 등 기존 뷰의 삭제/취소 액션은 일관되게 Tailwind red-400/red-500 유틸리티(hover:text-red-400, bg-red-500/10 등)를 사용한다(grep으로 대조 확인). #FF6B6B는 라이트 모드 흰 카드에서 2.8:1로 대비도 미달.
- **왜 문제인가**: 동일한 의미(파괴적 액션)에 화면마다 다른 색을 쓰면 위험 신호의 학습이 흐려진다. 또한 red-400 계열은 Tailwind 팔레트라 유지보수가 쉬운 반면 임의 hex는 전수 치환 대상이 된다.
- **일으키는 문제**: 시각적 차이는 미묘하지만(FF6B6B vs F87171), 코드베이스에 위험색 표기가 두 계열로 갈라져 이후 라이트 모드 위험색 조정 같은 전역 작업에서 캐릭터 현황판만 누락될 위험이 있다.
- **수정 계획**: CharacterBoardView.tsx:1003·:1174, EpisodeAssetBoard.tsx:194의 hover:text-[#FF6B6B]를 hover:text-red-400으로 교체하고, :1174 캐릭터 삭제 버튼에는 관례대로 hover:bg-red-500/10을 함께 부여.

#### VD-7 [P3] 모달 radius(18px 인라인)와 X 아이콘 크기(12/15/17/18/20/24 6종)가 규칙 없이 혼재

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1353 - style={{ borderRadius: 18, boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }} (상세 모달, 인라인 스타일)` / `src/views/CharacterBoardView.tsx:1400 - className="rounded-[18px]" (댓글 패널 — 모달과 맞추기 위한 arbitrary value)` / `src/views/CharacterBoardView.tsx:1429 - rounded-2xl (캐릭터 추가 모달, 16px)` / `src/components/characters/CharacterImageFitEditor.tsx:294 - rounded-2xl (편집기 모달, 16px)` / `src/views/CharacterBoardView.tsx:161 - <X size={17} /> (담당자 모달 닫기 — 앱에서 유일한 17px)` / `src/views/CharacterBoardView.tsx:1005, 1365, 1179 - X size 12 / 15 / 18, CharacterImageLightbox.tsx:100 - X size 20, CharacterBoardView.tsx:544 - X size 24`
- **확인된 사실**: 같은 기능 안에서 모달 컨테이너 radius가 18px(인라인 style)·18px(arbitrary class)·16px(rounded-2xl)로 갈리고, 상세 모달만 Tailwind 클래스 대신 인라인 스타일을 쓴다. 닫기(X) 아이콘은 12, 15, 17, 18, 20, 24 여섯 가지 크기가 쓰이며 size 17은 이 파일 외 용례가 없는 단독 값이다.
- **왜 문제인가**: radius와 아이콘 크기는 반복 노출되는 요소라 미세한 편차가 '어딘가 어긋난' 인상을 만든다. 인라인 스타일 radius는 Tailwind 스캔·테마 정비에서 빠지고, 댓글 패널의 rounded-[18px]처럼 맞춤용 arbitrary 값을 연쇄적으로 낳는다.
- **일으키는 문제**: 즉각적 사용성 문제는 없으나, 모달 간 시각 리듬이 어긋나고 이후 디자인 정비 시 18px 인라인 값이 누락되기 쉽다.
- **수정 계획**: 1) :1353의 인라인 borderRadius를 제거하고 rounded-2xl로 통일(:1400의 rounded-[18px]도 rounded-2xl로). 18px을 유지하고 싶으면 tailwind.config.js theme.extend.borderRadius에 modal: '18px'을 등록해 rounded-modal로 클래스화. 2) X 아이콘을 3단계로 정리: 인라인 칩 삭제=12, 패널/모달 헤더 닫기=18, 전체화면 오버레이 닫기=20. :161의 17을 18로, :1365의 15를 18로 조정.
- **검증 교정(우선 적용)**: 두 가지 소교정: (1) X size 24(:544)는 미사용 죽은 코드 ImageLightbox(:526-548) 내부이므로 라이브 코드의 닫기 아이콘 크기는 6종이 아니라 5종(12/15/17/18/20) — 죽은 코드 삭제(VD-8 fix)와 함께 자연 해소. (2) 앵커 :161은 button 요소이고 X는 :162. 추가로 같은 기능의 EpisodeAssetBoard.tsx:196에 X size={13}이 또 존재해 혼재 주장 자체는 오히려 강화됨(fix의 3단계 정리 대상에 포함 권장).

#### VD-8 [P3] 오버레이 레이어 z-index가 의미 체계 없는 임의값 사다리(z-50/60/70/80/85/90)로 하드코딩됨

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1349 - z-50 (상세 모달)` / `src/views/CharacterBoardView.tsx:534 - z-[60] (죽은 코드 ImageLightbox)` / `src/components/characters/CharacterImageLightbox.tsx:77 - z-[70]` / `src/components/characters/CharacterImageContextMenu.tsx:85 - z-[80]` / `src/views/CharacterBoardView.tsx:154 - z-[85] (담당자 추가 모달)` / `src/components/characters/CharacterImageFitEditor.tsx:293 - z-[90]` / `src/components/common/GlassDropdown.tsx:194 - z-[80] (동일 값의 무관 컴포넌트)`
- **확인된 사실**: 캐릭터 현황판 오버레이 5종이 각 파일에 z-50/[70]/[80]/[85]/[90]으로 개별 하드코딩되어 있다. 상호 순서는 현재 올바르게 동작하지만, 순서 규칙이 코드 어디에도 선언되어 있지 않고 GlassDropdown(z-[80]) 등 무관한 컴포넌트와 값이 겹친다. 앱 전역도 z-[9999] 류가 흔하지만 이 기능은 신규 작성이라 정리 기회였다.
- **왜 문제인가**: 리뷰 기준의 'z-index는 의미 체계(dropdown<sticky<modal<toast<tooltip), 임의값 금지' 위반. 레이어 5개가 암묵 순서에 의존하면 새 오버레이(예: 라이트박스 안 컨텍스트 메뉴) 추가 시 어긋난 값을 고르기 쉽다.
- **일으키는 문제**: 현재 시각적 버그는 없으나, 향후 라이트박스(70) 위에서 컨텍스트 메뉴(80)·담당자 모달(85)·FitEditor(90) 조합이 바뀌거나 GlassDropdown이 같은 화면에 뜨면 겹침 순서를 예측할 수 없다.
- **수정 계획**: src/constants/zIndex.ts를 신설해 캐릭터 현황판 레이어를 상수화: CHARACTER_LAYER = { modal: 50, lightbox: 70, contextMenu: 80, subModal: 85, fitEditor: 90 }. 각 컴포넌트에서 style={{ zIndex: CHARACTER_LAYER.x }} 또는 Tailwind theme.extend.zIndex 등록 후 클래스 사용. 죽은 코드 ImageLightbox(CharacterBoardView.tsx:526-548, z-[60])는 삭제.

#### VD-9 [P3] 리깅 단계 META 색표가 CharacterBoardView와 EpisodeAssetBoard에 중복 정의되어 탭 간 색상 분기 위험

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:55-61 - RIGGING_STAGE_META (waiting #8B8DA3 ... done #00B894)` / `src/views/EpisodeAssetBoard.tsx:32-36 - 동일 라벨·hex의 META 테이블 재정의`
- **확인된 사실**: 같은 도메인 개념(리깅 5단계)의 라벨과 색이 두 파일에 각각 리터럴로 정의되어 있다. 두 탭은 같은 화면(CharacterBoardView 탭 전환)에서 나란히 쓰인다.
- **왜 문제인가**: 단일 진실 원천 위반. 한쪽만 색·라벨을 바꾸면 '캐릭터 현황판' 탭과 '에피소드 에셋' 탭에서 같은 단계가 다른 색으로 표시되는 조용한 불일치가 생긴다.
- **일으키는 문제**: 현재는 값이 일치하지만, VD-1의 라이트 모드 토큰화 같은 후속 수정을 한 파일에만 적용하면 즉시 탭 간 색이 갈라진다.
- **수정 계획**: src/constants/characterStages.ts(신규)로 DESIGN_STAGE_META·RIGGING_STAGE_META를 이동하고 두 뷰에서 import. VD-1의 CSS 변수화를 이 모듈에서 한 번에 적용하면 두 탭이 동시에 라이트 모드 대응된다.

#### VD-10 [P3] 빈 상태가 텍스트 한 줄뿐이고 CTA 버튼이 없으며, 로딩이 카드 그리드에 어울리지 않는 단일 스피너임

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1551-1552 - '아직 캐릭터가 없습니다. "캐릭터 추가"로 시작해보세요.' (클릭 불가 텍스트만)` / `src/views/CharacterBoardView.tsx:1553-1554 - 필터 결과 없음 문구 (필터 해제 액션 없음)` / `src/views/CharacterBoardView.tsx:1522-1526 - 로딩: h-40 중앙 6px 스피너 하나` / `src/views/CharacterBoardView.tsx:1537-1539 - 실제 '캐릭터 추가' 버튼은 툴바에 존재 (onAdd)`
- **확인된 사실**: 첫 진입 빈 상태는 py-16 중앙 텍스트 한 줄로, 문구가 '"캐릭터 추가"로 시작해보세요'라며 화면 우상단 버튼을 말로만 가리킨다(기억 다리). 필터 미일치 상태에도 '필터 해제' 버튼이 없다(태그 행의 해제 버튼은 별도 위치). 로딩은 카드 그리드 자리에 스피너 1개만 표시되어, 로드 완료 시 레이아웃이 통째로 바뀐다.
- **왜 문제인가**: 빈 상태는 신규 기능의 첫인상이며, 행동을 문구로 지시하는 것보다 행동 자체(버튼)를 제자리에 두는 것이 인지부하가 낮다. 카드 그리드에는 스켈레톤이 표준 패턴으로, 스피너→그리드 전환은 시각적 점프를 만든다.
- **일으키는 문제**: 처음 열어본 팀원이 텍스트를 읽고 시선을 다시 툴바로 옮겨야 하며, 로딩→표시 전환 시 화면 구성이 갑자기 바뀐다. 우회는 쉬우나 신규 기능의 완성도 인상을 깎는다.
- **수정 계획**: 1) :1551 빈 상태를 아이콘(ImageIcon 등) + 문구 + <button onClick={onAdd}> 'Plus 캐릭터 추가' 버튼(툴바와 동일 스타일)으로 구성. 2) :1553 필터 빈 상태에 '필터 해제' 버튼(setActiveTags([]) + setQuery(''))을 인라인 배치. 3) :1522 로딩을 카드 스켈레톤으로 교체: 그리드 컨테이너(:1556과 동일 클래스) 안에 aspect-[3/4](VD-2 반영) rounded-xl bg-bg-border/30 animate-pulse 카드 6개 — animate-pulse는 opacity 기반이라 reduced-motion 부담이 작지만 motion-reduce:animate-none 병기.

#### VD-11 [P3] 오버레이 배경이 같은 기능 안에서 시멘틱 토큰(bg-overlay)과 bg-black 하드코딩으로 갈라짐

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1349 - bg-overlay/60 (상세 모달 — 토큰 사용)` / `src/views/CharacterBoardView.tsx:1428 - bg-black/50 (캐릭터 추가 모달)` / `src/views/CharacterBoardView.tsx:154 - bg-black/55 (담당자 추가 모달)` / `src/components/characters/CharacterImageFitEditor.tsx:293 - bg-black/70` / `src/index.css:103-104, 157-158 - --color-overlay + --overlay-alpha(다크 0.55 / 라이트 0.3) 시멘틱 토큰 정의`
- **확인된 사실**: 앱에는 라이트 모드에서 오버레이를 옅게(0.3) 조정하는 시멘틱 토큰 --color-overlay/--overlay-alpha가 있고 상세 모달(:1349)은 bg-overlay/60으로 이를 사용하지만, 같은 파일의 다른 두 모달(:154, :1428)과 FitEditor(:293)는 bg-black 고정값을 쓴다. (라이트박스 bg-black/85는 이미지 감상용 암실 연출이므로 의도적 예외로 볼 수 있음.)
- **왜 문제인가**: 동일 위계의 오버레이가 화면마다 다른 어둡기를 갖고, 라이트 모드에서 일부 모달만 다크 모드 수준으로 어두운 배경이 깔려 모드 전환 일관성이 깨진다.
- **일으키는 문제**: 라이트 모드에서 캐릭터 추가/담당자 추가 모달을 열면 상세 모달보다 눈에 띄게 어두운 딤이 깔려 이질감을 준다.
- **수정 계획**: CharacterBoardView.tsx:154·:1428, CharacterImageFitEditor.tsx:293의 bg-black/NN을 bg-overlay/55·bg-overlay/50·bg-overlay/70으로 교체(=rgb(var(--color-overlay))에 알파). 라이트박스(:77 bg-black/85)는 암실 연출 목적이므로 유지하되 주석으로 의도 명시.
- **검증 교정(우선 적용)**: 임팩트 서술의 기전 오류 교정: tailwind.config.js:23이 overlay를 'rgb(var(--color-overlay) / <alpha-value>)'로 정의하므로 bg-overlay/60은 --overlay-alpha(0.55/0.3)를 전혀 소비하지 않고 고정 0.6 알파를 쓴다. 게다가 --color-overlay는 다크(index.css:103)·라이트(index.css:157) 모두 '0 0 0'으로 동일해, 현재 bg-overlay/60은 bg-black/60과 두 모드 모두에서 시각적으로 완전 동일하다. --overlay-alpha가 실제 적용되는 곳은 인라인 스타일 3곳뿐(SpotlightSearch.tsx:582, WhiteboardModal.tsx:273, SceneDetailModal.tsx:1302). 따라서 '라이트 모드에서 일부 모달만 어둡게 깔린다'는 모드 전환 불일치는 현재 존재하지 않으며, 이 항목은 시각 버그가 아니라 토큰 위생/미래 대비(--color-overlay를 라이트에서 바꿀 경우 bg-black 사용처만 누락) 이슈로 강등해야 한다. 제안된 fix(bg-black/NN→bg-overlay/NN)는 오늘 기준 시각적 no-op이지만 관례 정렬로서는 무해·타당. 심각도는 P3 유지하되 하한.

### 6.3 인터랙션 / 모션 / 접근성 (INT·A11Y·MO 14건)

**차원 총평**: 캐릭터 현황판의 인터랙션 기본기는 탄탄한 편이다 — 카드·단계 레일·태그 칩이 모두 실제 button에 aria-pressed를 갖추고, 낙관적 업데이트는 store 전 경로에 실패 toast+필드 단위 롤백이 있으며(useCharacterBoardStore.ts:520-558), 업로드는 진행 표시·중복 클릭 방지·고아 파일 정리까지 갖췄고, prefers-reduced-motion은 전역 가드(index.css:963-971)로 충족된다. 그러나 가장 큰 결함은 키보드 레이어링이다: Escape 이벤트를 소비하는 오버레이가 FitEditor 하나뿐이라 라이트박스·컨텍스트 메뉴·담당자 모달·이름 편집에서 Escape 한 번에 상세 모달까지 연쇄로 닫힌다(P1) — 같은 코드베이스의 씬 라이트박스가 이미 올바른 capture+claim 패턴을 갖고 있어 이식만 하면 된다. 그 외 모달 3종의 dialog 시맨틱·포커스 관리 부재, hover 전용 tabIndex=-1 삭제 버튼, 드래그 아웃 시 모달 닫힘, 카드 우클릭의 즉시 탐색기 실행(메뉴 관례 불일치), 씬 모달에는 있는 드롭/붙여넣기 업로드 부재, window.confirm 사용, 32px 미달 클릭 타겟 다수가 P2로 모여 있다. 모션은 위반이라기보다 폴리시 수준(듀레이션/이징 혼재, 진입 모션 부재)이고, 나머지는 갤러리 휠 하이재킹·버전 keystroke 커밋·비활성 처리 누락 같은 국소 P3다.

#### INT-1 [P1] 중첩 오버레이(라이트박스·컨텍스트 메뉴·담당자 모달·이름 편집)에서 Escape가 전파 차단 없이 상세 모달까지 한꺼번에 닫힘

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1342-1346 - CharacterDetailModal: `onKey = (e) => { if (e.key === 'Escape') onClose(); }` window keydown(버블) 등록` / `src/components/characters/CharacterImageLightbox.tsx:63-72 - 라이트박스 Escape/화살표 핸들러가 stopPropagation 없이 window keydown 등록` / `src/components/characters/CharacterImageContextMenu.tsx:71-79 - 컨텍스트 메뉴 Escape 핸들러도 전파 차단 없음` / `src/views/CharacterBoardView.tsx:197-200 - AssigneeNamePicker input Escape: preventDefault만 하고 stopPropagation 없음` / `src/views/CharacterBoardView.tsx:725 - CostumeIdentity 이름 편집 input Escape: 편집만 취소, 전파 차단 없음` / `src/components/scenes/AttachmentImageLightbox.tsx:89-111 - 씬 라이트박스는 capture+stopImmediatePropagation으로 올바르게 처리하는 선례`
- **확인된 사실**: CharacterDetailModal이 window 버블 단계에 Escape→onClose 리스너를 등록한다(:1342-1346). 그 위에 뜨는 CharacterImageLightbox(:63-72), CharacterImageContextMenu(:71-73), AssigneeNamePicker 모달(input onKeyDown :197-200), CostumeIdentity 이름 편집(:725) 모두 Escape를 처리하되 stopPropagation/stopImmediatePropagation을 호출하지 않는다. 유일하게 CharacterImageFitEditor(:142-151)만 capture+stopImmediatePropagation으로 가드한다. window 버블 리스너는 등록 순서대로 실행되므로 모달(먼저 마운트)의 핸들러가 항상 먼저 실행된다.
- **왜 문제인가**: 레이어드 UI의 기본 원칙은 'Escape는 최상단 레이어 하나만 닫는다'이다. 이벤트 소비(claim) 없이 같은 window에 다층 리스너를 쌓으면 한 번의 키 입력이 모든 레이어에 도달한다. 같은 코드베이스의 씬 첨부 라이트박스(AttachmentImageLightbox.tsx:89-111)는 이미 capture+stopImmediatePropagation 패턴으로 해결한 선례가 있어 명백한 회귀적 불일치다.
- **일으키는 문제**: 라이트박스에서 이미지를 크게 보다 Escape → 라이트박스와 상세 모달이 동시에 닫혀 그리드로 튕겨나간다(보던 캐릭터·선택 복장·스크롤 위치 전부 유실). 복장 이름 편집 중 Escape로 취소하려 해도 상세 모달 전체가 닫힌다. 담당자 추가 입력창에서 Escape를 눌러도 마찬가지. 이미지 우클릭 메뉴를 Escape로 닫아도 모달째 닫힌다. 하루에도 수십 번 쓰는 화면에서 반복되는 컨텍스트 파괴로, '캐릭터 창이 자꾸 저절로 꺼져요' 류 문의가 나올 수준.
- **수정 계획**: AttachmentImageLightbox.tsx:89-111의 claimKey 패턴을 이식한다. (1) CharacterImageLightbox.tsx:63-72 — onKey에서 Escape/ArrowLeft/ArrowRight 처리 시 e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() 호출하고 addEventListener('keydown', onKey, true)로 capture 등록. (2) CharacterImageContextMenu.tsx:71-73 — 동일하게 capture 등록 + stopImmediatePropagation. (3) CharacterBoardView.tsx:197-200 (AssigneeNamePicker input)과 :725 (CostumeIdentity input) — 기존 preventDefault에 event.stopPropagation() 추가. (4) :1140-1148 헤더 캐릭터 이름 input에도 Escape 핸들러(draft 롤백 + setEditingName(false) + stopPropagation) 추가. CharacterDetailModal(:1342-1346)은 최하위 레이어이므로 그대로 둔다. capture 리스너는 버블 리스너보다 항상 먼저 실행되므로 마운트 순서와 무관하게 안전하다.

#### A11Y-2 [P2] 모달 3종에 dialog 시맨틱·포커스 이동·포커스 트랩이 전무하고, AddCharacterModal은 Escape로 닫을 수도 없음

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1349 - CharacterDetailModal 오버레이: `<div className="fixed inset-0 z-50 ..." onClick={onClose}>` — role/aria-modal 없음` / `src/views/CharacterBoardView.tsx:1428-1429 - AddCharacterModal 오버레이+카드 — role 없음, Escape 리스너 없음 (컴포넌트 전체 :1413-1446에 keydown 처리 부재)` / `src/views/CharacterBoardView.tsx:154-155 - AssigneeNamePicker 모달(z-[85]) — role 없음` / `src/components/common/ConfirmDialog.tsx:41 - 같은 프로젝트에 role="dialog" 선례 존재`
- **확인된 사실**: CharacterDetailModal(:1349), AddCharacterModal(:1428), AssigneeNamePicker 모달(:154) 모두 일반 div 오버레이다. role="dialog", aria-modal, aria-label이 없고, 열릴 때 포커스를 모달 안으로 옮기지 않으며(그리드 카드 버튼에 포커스 잔류), Tab 순환 트랩이 없어 모달 뒤 배경(그리드·사이드바)으로 포커스가 새어나간다. 닫을 때 포커스 복원도 없다. AddCharacterModal은 Escape 핸들러 자체가 없어 오버레이 클릭 또는 '취소' 버튼으로만 닫힌다(:1413-1446 범위에 keydown 처리 없음). 프로젝트 내 ConfirmDialog.tsx:41 등 10개 파일에는 role="dialog"/aria-modal 선례가 있다.
- **왜 문제인가**: aria-modal 없는 오버레이는 스크린리더가 배경 콘텐츠를 계속 읽고, 포커스가 배경으로 빠지면 키보드 사용자는 보이지 않는 요소를 조작하게 된다(WCAG 2.4.3 Focus Order). Escape 닫기 부재는 같은 앱 안에서 모달마다 닫는 방법이 다르다는 뜻으로 '동일 행동=동일 UI' 원칙 위반이다.
- **일으키는 문제**: 키보드 사용자가 상세 모달에서 Tab을 계속 누르면 포커스가 모달 뒤 그리드 카드로 이동해 화면상 아무 변화 없이 Enter로 다른 캐릭터 모달을 여는 등 예측 불가 동작이 생긴다. 캐릭터 추가 창에서 습관적으로 Escape를 눌러도 닫히지 않아 혼란.
- **수정 계획**: (1) 세 모달의 콘텐츠 카드에 role="dialog" aria-modal="true" aria-label(예: '캐릭터 상세', '캐릭터 추가', `${label} 추가`) 부여. (2) AddCharacterModal에 window keydown Escape→onClose useEffect 추가(INT-1의 전파 규칙과 함께 stopImmediatePropagation은 불필요 — 단독 레이어). (3) 각 모달 카드 루트에 tabIndex={-1} + ref를 주고 mount 시 ref.current.focus(), unmount cleanup에서 이전 document.activeElement 복원. (4) 포커스 트랩은 간단 구현으로 충분: 카드 keydown에서 Tab 시 카드 내부 focusable 첫/끝 요소 순환. 공통 훅 useModalFocus(ref)를 src/hooks/에 만들어 3곳에서 재사용.
- **검증 교정(우선 적용)**: 초기 포커스 이동은 3종 중 2종에 이미 존재: AddCharacterModal은 이름 input에 autoFocus(:1433), AssigneeNamePicker는 mount 시 setTimeout으로 input focus(:133-137). '그리드 카드 버튼에 포커스 잔류'는 CharacterDetailModal에만 해당. 따라서 결함은 'dialog 시맨틱 전무 + 포커스 트랩/복원 전무 + AddCharacterModal Escape 부재 + 상세 모달만 초기 포커스 미이동'으로 좁혀야 정확. fix (3)의 mount focus는 상세 모달에만 필요. 심각도 P2는 유지 타당.

#### A11Y-3 [P2] 복장 삭제 버튼이 hover 시에만 보이는 tabIndex=-1 span이라 키보드·터치로는 복장을 삭제할 방법이 없음

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:998-1006 - `<span role="button" tabIndex={-1} ... className="... opacity-0 group-hover:opacity-100 ...">` — 삭제 X 버튼`
- **확인된 사실**: CostumeThumbCard의 삭제 버튼은 span에 role="button" tabIndex={-1}로 되어 있고(:999-1000) onKeyDown이 없으며, opacity-0 group-hover:opacity-100으로 마우스 hover 시에만 나타난다(:1003). 복장 삭제 경로는 이 버튼이 유일하다(상세 패널·컨텍스트 메뉴에 삭제 항목 없음).
- **왜 문제인가**: tabIndex=-1은 Tab 순서에서 제외되고 onKeyDown도 없어 키보드로는 도달·실행이 모두 불가능하다. hover-only 노출은 group-focus-within 병행 없이는 포커스 사용자에게 영구히 보이지 않는다(WCAG 2.1.1 Keyboard). 부모 카드가 role=button div인 상황에서 진짜 button 중첩을 피하려 span을 쓴 것으로 보이나, 접근성 결과가 기능 차단이다.
- **일으키는 문제**: 마우스 없이 작업하는 사용자(또는 향후 태블릿 사용)는 잘못 만든 복장을 삭제할 수 없다. 또한 hover 발견성에만 의존해 신규 팀원은 삭제 기능 존재 자체를 모를 수 있다.
- **수정 계획**: src/views/CharacterBoardView.tsx:998-1006의 span을 `<button type="button" tabIndex={0}>`으로 교체하고(부모가 button 요소가 아닌 role=button div이므로 DOM 중첩 문제 없음), className에 `focus-visible:opacity-100 group-focus-within:opacity-100`을 추가해 키보드 포커스 시에도 노출. onClick의 stopPropagation은 유지, Enter/Space는 button 기본 동작으로 처리됨. aria-label 기존 유지.

#### INT-4 [P2] 상세 모달·캐릭터 추가 모달이 onClick 기반 오버레이 닫기라, 모달 안에서 드래그를 시작해 밖에서 놓으면 모달이 통째로 닫힘

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1349 - CharacterDetailModal: 오버레이 `onClick={onClose}`, 내부 래퍼 :1350 `onClick={(e) => e.stopPropagation()}`` / `src/views/CharacterBoardView.tsx:1428 - AddCharacterModal: 오버레이 `onClick={onClose}`` / `src/views/CharacterBoardView.tsx:154 - AssigneeNamePicker는 onMouseDown 기반이라 이 문제가 없음 (올바른 선례)`
- **확인된 사실**: CharacterDetailModal(:1349)과 AddCharacterModal(:1428)은 오버레이 div의 onClick으로 닫는다. 브라우저는 mousedown과 mouseup의 타깃이 다르면 click 이벤트를 두 타깃의 공통 조상에서 발생시키므로, 모달 내부 textarea(메모, :695-704 — input/textarea는 전역 user-select:none 예외라 텍스트 드래그 가능, index.css:204-207)에서 드래그 선택을 시작해 오버레이 위에서 마우스를 놓으면 공통 조상인 오버레이에서 click이 발생해 onClose가 실행된다. 같은 파일의 AssigneeNamePicker(:154)는 onMouseDown 기반이라 안전하다.
- **왜 문제인가**: 드래그 아웃으로 모달이 닫히는 것은 잘 알려진 안티패턴이다. 닫힘은 '오버레이에서 누르기 시작해서 오버레이에서 놓았을 때'만 일어나야 한다. 같은 파일 안에 안전한 패턴(onMouseDown)과 위험한 패턴(onClick)이 공존해 일관성도 깨진다.
- **일으키는 문제**: 메모 textarea의 텍스트를 드래그로 선택하다 커서가 모달 밖으로 나간 채 놓으면 상세 모달 전체가 닫힌다. CostumeMemoInput은 blur 시점에 커밋하는데 React는 unmount 시 onBlur를 호출하지 않으므로 작성 중이던 메모 draft가 소리 없이 유실된다. 캐릭터 추가 모달에서도 이름 입력 드래그 중 동일 사고 가능.
- **수정 계획**: 두 오버레이의 닫기 로직을 mousedown 타깃 기준으로 변경: `onClick={onClose}`를 제거하고 `onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}`로 교체(:1349, :1428). 내부 래퍼의 stopPropagation은 각각 onMouseDown으로 옮긴다(:1350, :1429). AssigneeNamePicker(:154)와 동일한 패턴으로 통일.

#### INT-5 [P2] 그리드 카드 우클릭은 예고 없이 탐색기를 즉시 여는 반면 상세의 이미지 우클릭은 메뉴를 띄움 — 같은 제스처가 화면마다 다르게 동작

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1563-1567 - 카드 onContextMenu: `if (c.workFolderPath) void openStoredPath(...)` 즉시 실행, 없으면 toast.info` / `src/views/CharacterBoardView.tsx:610-613 - FeaturedImageSlot 이미지 우클릭: setContextMenu({x, y}) 로 메뉴 표시` / `src/views/CharacterBoardView.tsx:984-988 - CostumeThumbCard 이미지 우클릭: onImageContextMenu 로 메뉴 표시`
- **확인된 사실**: 그리드의 CharacterCard 우클릭(:1563-1567)은 컨텍스트 메뉴 없이 즉시 openStoredPath로 작업 폴더(탐색기 창)를 연다. 반면 상세 모달의 대표 이미지(:610-613)와 복장 썸네일(:984-988) 우클릭은 CharacterImageContextMenu를 띄워 항목을 고르게 한다. 카드 어디에도 우클릭 동작을 예고하는 표시(title, 아이콘)가 없다.
- **왜 문제인가**: '동일 행동=동일 UI' 원칙 위반. 우클릭이라는 동일 제스처가 한 곳에서는 메뉴, 다른 곳에서는 즉시 파일시스템 액션이다. 메뉴 없는 즉시 실행은 취소 기회가 없고, 기능 발견성도 0이다(우연히 눌러야만 알게 됨). 실수로 우클릭하면 의도치 않은 탐색기 창이 뜬다.
- **일으키는 문제**: 사용자가 카드에서 '이미지 복사'나 배경 변경을 기대하고 우클릭하면 갑자기 탐색기 창이 열려 앱 밖으로 컨텍스트가 튄다. 반대로 폴더 미등록 캐릭터에선 toast만 떠서 우클릭에 메뉴가 있다고 오해할 여지도 없다. 기능은 있는데 아무도 모르는 상태가 되기 쉽다.
- **수정 계획**: CharacterGrid에 contextMenu 상태 `{ characterId, x, y } | null`을 추가하고, 카드 onContextMenu(:1563-1567)에서 즉시 열기 대신 이 상태를 세팅해 CharacterImageContextMenu를 재사용해 띄운다. 카드 맥락에서는 대표 복장(featured)을 대상으로 hasImage/hasFolder/hasFile을 계산해 '작업 폴더 열기 / 작업 파일 열기 / 이미지 복사'만 활성화하고 배경·썸네일 맞추기는 숨기거나(전용 prop `mode: 'card' | 'image'` 추가) disabled 처리한다. 이렇게 하면 우클릭=메뉴로 전 화면이 통일된다.

#### INT-6 [P2] 이미지 업로드가 파일 선택기만 지원 — 씬 상세 모달이 지원하는 드래그앤드롭·클립보드 붙여넣기가 캐릭터 현황판에는 없음

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:650-656 - 숨김 `<input type="file" accept="image/*">` 가 유일한 업로드 진입점` / `src/views/CharacterBoardView.tsx:615-623 - '이미지 추가/바꾸기' 버튼 → fileRef.click()` / `src/components/scenes/UnifiedSceneDetailModal.tsx:576-609 - 씬 상세는 window paste 리스너로 Ctrl+V 업로드 지원` / `src/components/scenes/UnifiedSceneDetailModal.tsx:947 - 씬 이미지 슬롯은 onDropBlob 으로 드롭 업로드 지원`
- **확인된 사실**: FeaturedImageSlot의 업로드 경로는 숨김 file input(:650-656)과 버튼 클릭(:615-623)뿐이다. onDrop/onDragOver/onPaste 핸들러가 CharacterBoardView.tsx 전체에 없다. 반면 씬 상세 모달은 Ctrl+V 붙여넣기(UnifiedSceneDetailModal.tsx:576-609)와 이미지 슬롯 드롭(onDropBlob, :947, :963)을 모두 지원한다. 업로드 중 표시(:622 '업로드 중...')·disabled 중복 방지(:618)·실패 toast(:588)는 잘 되어 있다.
- **왜 문제인가**: 같은 앱에서 '이미지를 넣는다'는 동일 작업의 인터랙션 문법이 화면마다 다르다. 씬 모달에서 드롭·붙여넣기에 익숙해진 팀원이 캐릭터 현황판에서 같은 행동을 하면 아무 일도 일어나지 않고 피드백도 없다(조용한 실패). 원화·디자인 이미지는 대개 폴더에서 드래그하거나 포토샵에서 복사해오는 워크플로라 파일 선택기 강제는 마찰이 크다.
- **일으키는 문제**: 디자이너가 탐색기에서 이미지를 대표 이미지 프레임에 드롭 → 무반응(혹은 브라우저 기본 동작으로 이미지가 창에서 열려 화면 이탈 위험). '씬에서는 되는데 여기는 왜 안 돼요' 류 혼란.
- **수정 계획**: (1) FeaturedImageSlot의 CharacterImageFrame 래퍼(:600-614)에 onDragOver={(e)=>e.preventDefault()} / onDrop={(e)=>{ e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith('image/')) handleUpload(f); }} 추가, 드래그 중 border-accent 하이라이트 상태 표시. (2) CharacterDetailPanel mount 동안 UnifiedSceneDetailModal.tsx:576-609 패턴의 window paste 리스너를 달아 클립보드 이미지 blob을 handleUpload로 연결(INPUT/TEXTAREA 포커스 시 무시 가드 동일 적용, 라이트박스/FitEditor 열림 시 무시). handleUpload의 기존 costume 가드(:573)·업로드 중 상태·실패 정리 로직은 그대로 재사용.

#### INT-7 [P2] 캐릭터·복장 삭제 확인이 네이티브 window.confirm — 프로젝트 공용 ConfirmDialog를 두고 OS 다이얼로그를 사용

- **판정**: CORRECTED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1002 - 복장 삭제: `if (window.confirm(\`'${costume.name}' 복장을 삭제할까요?\`)) onDelete()`` / `src/views/CharacterBoardView.tsx:1173 - 캐릭터 삭제: `if (window.confirm(...)) deleteCharacter(character.id)`` / `src/components/common/ConfirmDialog.tsx:71-75 - 공용 ConfirmDialog.confirm API 존재 (Host 미마운트 시에만 window.confirm 폴백)`
- **확인된 사실**: 복장 삭제(:1002)와 캐릭터 삭제(:1173)가 window.confirm을 직접 호출한다. 프로젝트에는 앱 토큰으로 스타일링된 공용 ConfirmDialog(src/components/common/ConfirmDialog.tsx, role="dialog" :41)가 있고 window.confirm은 Host 미마운트 시 폴백으로만 쓰도록 설계돼 있다(:74-75).
- **왜 문제인가**: Electron에서 window.confirm은 렌더러를 동기 블로킹하는 OS 네이티브 창이라 앱 디자인 언어와 완전히 단절되고, 확인 후 포커스가 원래 요소로 돌아오지 않는 크로미움 포커스 유실 문제가 알려져 있다. 다크 테마 앱 위에 밝은 시스템 창이 떠 시각적으로도 이질적이다. 공용 컴포넌트가 있는데 안 쓰는 것은 단일 경로 원칙 위반.
- **일으키는 문제**: 삭제 같은 파괴적 액션에서 앱 톤이 갑자기 깨지고, confirm 이후 키보드 포커스가 유실돼 키보드 사용자 흐름이 끊긴다. 다른 화면(ConfirmDialog 사용처)과 확인 UI가 달라 학습 일관성 저하.
- **수정 계획**: 두 호출부를 async로 바꿔 `const ok = await ConfirmDialog.confirm({ message: \`'${costume.name}' 복장을 삭제할까요?\` }); if (ok) onDelete();` 형태로 교체(:1002, :1173). ConfirmDialogHost는 이미 앱 루트에 마운트되어 있는지 확인하고(미마운트라면 App 루트에 추가), CostumeThumbCard의 onClick 핸들러는 void 비동기 호출로 감싼다.
- **검증 교정(우선 적용)**: API 명칭 오류: ConfirmDialog.tsx:71-78의 메서드는 `ConfirmDialog.confirm`이 아니라 `ConfirmDialog.show(opts)`다. fix 코드는 `await ConfirmDialog.show({ message: ..., tone: 'danger' })` 형태로 수정 필요. 또한 'Host 마운트 확인 후 미마운트면 추가' 단계는 불필요 — App.tsx:2948에 이미 마운트됨.

#### A11Y-8 [P2] 클릭 타겟 32px 미달이 광범위 — 버전 ±(28px), 이름 편집 연필(약 12-14px), 헤더 닫기 X(약 18px), 에피소드 칩(약 22px), 경로 선택/열기(약 26px)

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:817 - 버전 내리기: `w-7 h-7` (28px)` / `src/views/CharacterBoardView.tsx:833 - 버전 올리기: `w-7 h-7` (28px)` / `src/views/CharacterBoardView.tsx:733-740 - CostumeIdentity 연필: `<Pencil size={12} />` 패딩 없는 버튼` / `src/views/CharacterBoardView.tsx:1152-1154 - 헤더 이름 편집 연필: size 14, 패딩 없음` / `src/views/CharacterBoardView.tsx:1178-1180 - 상세 헤더 닫기: `<X size={18} />` 패딩 없음` / `src/views/CharacterBoardView.tsx:1218-1221 - 에피소드 칩: `px-2 py-0.5 text-xs` (높이 약 22px)` / `src/views/CharacterBoardView.tsx:770-784 - PathActionRow 선택/열기: `px-2 py-1 text-xs` (높이 약 26px)`
- **확인된 사실**: 버전 ± 버튼은 w-7 h-7=28px(:817, :833), 복장 이름 연필은 패딩 없는 12px 아이콘(:733-740), 헤더 연필 14px(:1152-1154), 헤더 닫기 X는 18px 아이콘 단독(:1178-1180), 에피소드 칩은 py-0.5로 약 22px(:1219), PathActionRow의 선택/열기는 py-1로 약 26px(:773, :781)이다. 반면 FitEditor는 min-h-10 min-w-10(40px, CharacterImageFitEditor.tsx:288)으로 기준을 지키고 있고, AssigneeNamePicker도 min-h-8을 쓴다(:176).
- **왜 문제인가**: 최소 클릭 타겟 32px(권장 40-44px) 기준 미달. 매일 반복 클릭하는 컨트롤(단계 변경 옆 버전 조정, 에피소드 연결 토글, 모달 닫기)이 작을수록 미스클릭률과 조작 시간이 늘어난다(피츠의 법칙). 같은 기능 안에서 FitEditor만 40px을 지켜 내부 일관성도 없다.
- **일으키는 문제**: 에피소드 칩을 누르려다 옆 칩을 눌러 엉뚱한 에피소드가 연결/해제되는 미스클릭이 실사용에서 발생 가능(연결 토글은 즉시 서버 반영). 닫기 X와 삭제 버튼이 인접(:1171-1180)한데 둘 다 작아 위험한 오클릭 조합.
- **수정 계획**: 시각 크기를 유지하며 히트 영역만 확장: (1) 버전 ±를 w-8 h-8(32px)로(:817, :833). (2) 연필·닫기·삭제 아이콘 버튼에 p-1.5~p-2 추가하고 -m-1.5로 시각 위치 보정(:737, :1152, :1178, 그리고 :1171-1177 삭제 버튼). (3) 에피소드 칩 py-0.5→py-1 + min-h-7(:1219). (4) PathActionRow 버튼 py-1→py-1.5(:773, :781). (5) CostumeThumbCard 삭제 X p-1→p-1.5(:1003).

#### A11Y-9 [P3] 썸네일 맞추기 편집기의 슬라이더가 전역 outline:none 때문에 키보드 포커스 표시가 전혀 없음

- **판정**: CONFIRMED
- **코드 앵커**: `src/index.css:733-739 - `input[type="range"] { ... outline: none; }` 전역 리셋` / `src/components/characters/CharacterImageFitEditor.tsx:289 - `sliderClass = 'h-2 w-full cursor-pointer accent-accent'` — focus-visible 스타일 없음` / `src/components/characters/CharacterImageFitEditor.tsx:384-418, 436-461 - 확대/위치 슬라이더 5개가 모두 sliderClass 사용` / `src/index.css:1071-1073 - 체크박스 focus-visible box-shadow 선례`
- **확인된 사실**: index.css:738이 모든 range input의 outline을 제거하는데, FitEditor의 확대·가로/세로 확대·X/Y 위치 슬라이더(:384-418, :436-461)는 sliderClass(:289)에 focus-visible 대체 스타일이 없다. 같은 에디터의 크롭 프레임은 focus-visible:ring-2 ring-accent/80을 갖춰(:341) 대비된다.
- **왜 문제인가**: outline 제거 시 대체 포커스 표시는 필수(WCAG 2.4.7 Focus Visible). 슬라이더는 키보드 화살표로 조작 가능한 컨트롤인데 어느 슬라이더에 포커스가 있는지 보이지 않으면 키보드 정밀 조정(픽셀 맞추기라는 이 기능의 핵심 용도)이 사실상 불가능하다.
- **일으키는 문제**: Tab으로 확대 슬라이더에 도달해도 화면 변화가 없어 사용자는 포커스 위치를 잃는다. 화살표를 눌렀을 때 어떤 값이 왜 변하는지 알 수 없는 상태가 된다.
- **수정 계획**: sliderClass(:289)에 `focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-card rounded-full` 추가. 또는 전역 해결로 index.css의 range 블록(:733-739) 아래에 `input[type="range"]:focus-visible { box-shadow: 0 0 0 2px rgb(var(--color-accent) / 0.5); }` 를 추가(체크박스 선례 :1071-1073과 동일 패턴) — 전역 쪽이 다른 화면 슬라이더(오퍼시티 등)도 함께 고쳐 권장.

#### INT-10 [P3] 컨텍스트 메뉴 화면 밖 방지가 하드코딩 상수(232/290)이고, 스크롤·리사이즈 시 닫히지 않으며 menu 시맨틱이 없음

- **판정**: CONFIRMED
- **코드 앵커**: `src/components/characters/CharacterImageContextMenu.tsx:86 - `style={{ left: Math.min(x, window.innerWidth - 232), top: Math.min(y, window.innerHeight - 290) }}`` / `src/components/characters/CharacterImageContextMenu.tsx:66-80 - 닫힘 조건: pointerdown 외부 + Escape 뿐 (scroll/resize/blur 없음)` / `src/components/characters/CharacterImageContextMenu.tsx:83-87 - role="menu" 없음, 방향키 탐색 없음`
- **확인된 사실**: 메뉴 위치는 렌더 시점에 width 232px/height 290px 고정 가정으로 클램프한다(:86). 실제 높이는 헤더+배경 2행+메뉴 4행 구성으로 render 조건과 무관하게 고정 가정이며, 실측(ref)이 아니다. 닫힘은 window pointerdown(외부)과 Escape만 처리(:66-80)하고, 상세 본문은 overflow-y-auto(:1185)라 휠 스크롤(pointerdown 미발생)로 콘텐츠가 흘러가도 fixed 메뉴는 원래 좌표에 남는다. role=menu/menuitem, 방향키 이동, 열림 시 포커스 이동이 없다.
- **왜 문제인가**: 매직 넘버 기반 클램프는 메뉴 구성이 한 줄만 바뀌어도 소리 없이 어긋난다(이미 실제 높이와 불일치). 컨텍스트 메뉴는 앵커 대상과 시각적으로 붙어 있어야 하는데 스크롤 시 대상만 흘러가면 '무엇에 대한 메뉴인지'가 끊긴다. 데스크톱 관례상 스크롤/창 포커스 아웃 시 메뉴는 닫혀야 한다.
- **일으키는 문제**: 화면 하단 가까이에서 우클릭하면 커서와 메뉴 사이가 과도하게 벌어지거나(과보정), 메뉴가 열린 채 휠을 굴리면 엉뚱한 이미지 위에 메뉴가 떠 있는 상태로 배경 변경을 실행할 수 있다(activeCostumeId는 우클릭 시점에 이미 바뀌어 있어 데이터 사고는 아니지만 시각적 혼란).
- **수정 계획**: (1) useLayoutEffect에서 ref.current.getBoundingClientRect()로 실측 후 `left = Math.min(x, innerWidth - rect.width - 8)`, `top = Math.min(y, innerHeight - rect.height - 8)`로 보정(초기 렌더는 visibility:hidden → 측정 후 표시). (2) :66-80 effect에 window 'wheel'(capture, passive)·'resize'·'blur' 리스너 추가해 onClose. (3) 메뉴 루트에 role="menu", 각 버튼에 role="menuitem" 부여, 열릴 때 첫 항목 focus + ArrowUp/Down 순환은 선택 사항.

#### MO-11 [P3] 모션 토큰 불일치 — duration 150/200/300 혼재, ease 미지정(기본 ease-in-out 계열), transition-all·width 트랜지션 사용, 모달/라이트박스 진입 모션 부재

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:83 - TagPill: `transition-all duration-150`` / `src/views/CharacterBoardView.tsx:434 - CharacterCard: `transition-colors duration-200`` / `src/views/CharacterBoardView.tsx:944 - 리깅 진행 바: `transition-[width] duration-300` (레이아웃 속성 애니메이션)` / `src/views/CharacterBoardView.tsx:1349, 1428 - 상세/추가 모달: 진입 애니메이션 없음 (즉시 표시)` / `src/index.css:963-971 - 전역 prefers-reduced-motion 가드 존재 (transition/animation 0.01ms) — reduce 대응 자체는 충족`
- **확인된 사실**: duration이 150(:83)/200(:390, :434)/300(:944)으로 혼재하고 모두 ease 클래스 미지정이라 Tailwind 기본 cubic-bezier(0.4,0,0.2,1)(ease-in-out 계열)로 동작한다. TagPill은 transition-all(:83)로 불필요한 속성까지 감시하고, 목록 행 진행 바는 width라는 레이아웃 속성을 300ms 트랜지션한다(:944). 상세 모달·추가 모달·라이트박스·컨텍스트 메뉴는 모두 진입 모션 없이 즉시 나타난다. prefers-reduced-motion은 index.css:963-971 전역 가드가 모든 CSS transition/animation을 0.01ms로 죽이므로 커버된다(이 기능은 framer-motion 미사용이라 JS 모션 누수 없음).
- **왜 문제인가**: 리뷰 기준(transform/opacity 위주, ease-out, duration 일관)에 대한 위반이 산발적으로 존재한다. transition-all은 의도치 않은 속성(레이아웃 포함)까지 애니메이션할 수 있고, width 트랜지션은 매 프레임 레이아웃을 유발한다(이 경우 요소가 작아 실측 영향은 미미). 진입 모션 부재는 z-50 전체 화면 오버레이가 '팟' 하고 나타나 앱의 다른 오버레이(컴포지팅 대시보드 bf-cascade-in 등)와 질감 차이를 만든다.
- **일으키는 문제**: 기능 문제는 없으나 화면 간 모션 언어가 달라 폴리시 부족으로 느껴진다. 특히 상세 모달은 backdrop-blur+글로우 등 시각 완성도가 높은데 진입이 순간 전환이라 부조화.
- **수정 계획**: (1) TagPill(:83)을 transition-colors로 축소하고 duration-200 ease-out으로 통일. (2) CharacterCard(:434)·StageRail(:390) 등에 ease-out 명시, duration 200 표준화. (3) 진행 바(:944)는 유지 가능하나 통일하려면 `transform: scaleX(ratio)` + origin-left로 전환. (4) 상세/추가 모달 오버레이에 opacity 진입(예: index.css에 `@keyframes char-modal-in { from { opacity: 0; transform: scale(0.98); } }` 140ms ease-out, 카드에만 적용) 추가 — 전역 reduce 가드(:963-971)가 자동으로 무력화하므로 별도 가드 불필요.

#### INT-12 [P3] 복장 갤러리 위에서 세로 휠이 무조건 가로 스크롤로 하이재킹되어, 갤러리가 스크롤할 필요가 없어도 페이지 스크롤이 막힘

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1048-1058 - galleryRef wheel 리스너: `el.scrollLeft += e.deltaY; e.preventDefault();` (passive:false)` / `src/views/CharacterBoardView.tsx:1234 - 갤러리 컨테이너 `overflow-x-auto``
- **확인된 사실**: 갤러리 wheel 핸들러(:1051-1054)는 deltaY!==0이면 조건 없이 preventDefault하고 가로 스크롤로 변환한다. 복장이 1-2개뿐이라 가로 오버플로가 없어도 동일하게 동작하며, 이 경우 scrollLeft 증가는 no-op이고 preventDefault만 남아 상세 본문(overflow-y-auto, :1185)의 세로 스크롤이 죽는다. 트랙패드의 가로 제스처(deltaX)는 브라우저 기본 동작으로 이미 처리되므로 변환이 필요 없는 경우에도 세로 휠을 빼앗는다.
- **왜 문제인가**: 스크롤 하이재킹은 오버플로가 실제로 존재하고 그 방향으로 더 스크롤할 수 있을 때만 정당화된다. 무조건 preventDefault는 사용자의 주 스크롤 의도(본문 훑기)를 차단하는 데드존을 만든다.
- **일으키는 문제**: 복장 썸네일 줄 위에 커서가 놓인 채 휠을 굴리면 페이지가 안 움직여 '스크롤이 고장났다'고 느낀다. 갤러리는 본문 상단에 넓게 자리해 커서가 자주 지나가는 영역이다.
- **수정 계획**: :1051-1055를 조건부로 변경: `const canScroll = el.scrollWidth > el.clientWidth; if (!canScroll || e.deltaY === 0 || e.shiftKey) return; const before = el.scrollLeft; el.scrollLeft += e.deltaY; if (el.scrollLeft !== before) e.preventDefault();` — 오버플로가 있고 실제로 스크롤이 일어난 경우에만 기본 동작을 막아, 끝에 도달하면 세로 스크롤로 자연스럽게 넘어간다.

#### INT-13 [P3] 버전 숫자 입력이 키 입력마다 서버 쓰기 — '12' 입력 시 1→12 두 번 저장되고 실시간·활동 잡음 발생

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:822-829 - `<input type="number" ... onChange={(e) => { ... setVersion(costume.id, Math.floor(n)); }}` — onChange 즉시 커밋` / `src/stores/useCharacterBoardStore.ts:337-339 - setVersion → applyCostumeUpdate → 즉시 IPC 쓰기` / `src/views/CharacterBoardView.tsx:690-706 - CostumeMemoInput 은 의도적으로 blur 커밋 (주석: 동시 쓰기 경합·텍스트 유실 방지)`
- **확인된 사실**: 버전 input의 onChange(:827)는 유효 숫자일 때마다 setVersion을 호출하고, setVersion(store:337-339)은 applyCostumeUpdate로 즉시 낙관 반영+서버 update를 보낸다. 디바운스가 없어 '12'를 타이핑하면 1, 12 두 번의 서버 쓰기가 발생한다. 같은 파일의 메모 입력(:690-706)은 정확히 이 문제 때문에 blur 커밋으로 설계됐다는 주석이 있다.
- **왜 문제인가**: 같은 상세 패널 안에서 커밋 시점 정책이 필드마다 다르다(메모=blur, 이름=blur, 버전=keystroke). keystroke 커밋은 중간값(오타 포함)이 Realtime으로 20명에게 전파되고, 실패 시 롤백도 키 입력 단위로 쪼개져 UX가 불안정해진다.
- **일으키는 문제**: 버전 30을 입력하려고 '3'을 지우고 다시 치는 동안 다른 사용자 화면에서 버전이 3→30으로 깜빡이며 바뀐다. 네트워크가 느릴 때 타이핑 중간값이 역순으로 도착하면 LWW로 잘못된 값이 남을 수도 있다.
- **수정 계획**: CostumeMemoInput(:690-706) 패턴을 재사용해 로컬 draft 상태를 두고 blur 또는 Enter에서만 setVersion을 호출하도록 :822-829를 변경. ±버튼(:814-821, :830-837)은 명시적 단일 액션이므로 현행 즉시 커밋 유지. costume.versionNo 외부 변경(Realtime) 시 포커스 없을 때만 draft 동기화하는 focused ref 가드도 동일하게 적용.

#### INT-14 [P3] 복장이 없는 캐릭터에서 우클릭 메뉴의 배경 4옵션이 활성으로 보이지만 눌러도 아무 일도 일어나지 않음

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:666-668 - onBackground: `if (shownCostume) void updateCostumeField(...)` — 복장 없으면 조용히 무시` / `src/components/characters/CharacterImageContextMenu.tsx:92-107 - 배경 옵션 버튼에 disabled 처리 없음 (다른 항목은 hasImage/hasFolder/hasFile 로 disabled)` / `src/views/CharacterBoardView.tsx:610-613 - 이미지·복장 유무와 무관하게 우클릭 시 메뉴가 항상 열림`
- **확인된 사실**: FeaturedImageSlot은 복장이 0개여도 프레임 우클릭으로 메뉴를 연다(:610-613). 메뉴의 '썸네일 맞추기/이미지 복사/폴더/파일'은 hasImage 등으로 disabled 되지만(ContextMenu:110-113), 배경 4옵션(:92-107)은 항상 활성이다. 클릭하면 onBackground(:666-668)가 shownCostume 부재로 조용히 리턴하고 메뉴만 닫힌다(ContextMenu:97 — onClose는 무조건 호출).
- **왜 문제인가**: 활성으로 보이는 컨트롤은 눌렀을 때 가시적 결과가 있어야 한다. '클릭 → 메뉴 닫힘 → 변화 없음'은 조용한 실패로, 시스템 상태 피드백 원칙 위반이다. 같은 메뉴 안에서 다른 항목들은 disabled 규칙을 지키고 있어 내부 불일치이기도 하다.
- **일으키는 문제**: 새 캐릭터에 이미지를 넣기 전 배경을 미리 지정하려던 사용자가 '흰색'을 눌러도 반응이 없어 앱 버그로 오해한다. 저빈도 경로라 피해는 작지만 신뢰를 깎는다.
- **수정 계획**: CharacterImageContextMenu에 `canSetBackground: boolean` prop을 추가하고 배경 옵션 버튼(:94-107)에 `disabled={!canSetBackground}` + 기존 MenuButton과 동일한 disabled:opacity-40 스타일 적용. FeaturedImageSlot 호출부(:658-674)에서 `canSetBackground={!!shownCostume}`, CharacterDetailPanel 호출부(:1277-1292)는 menuCostume이 항상 존재하므로 true 전달.

### 6.4 코드 품질 / 모듈화 (CQ-1 ~ CQ-13)

**차원 총평**: 캐릭터 현황판은 아키텍처 규칙(렌더러→IPC→메인 단일 경로, 낙관적 업데이트, supabaseService 경유)을 전 구간에서 준수하고 있고, store의 applyCostumeUpdate 필드 단위 조건부 롤백처럼 성숙한 설계도 보인다 — 직접 Supabase 호출이나 경로 우회는 발견되지 않았다. 그러나 CharacterBoardView.tsx가 컴포넌트 20개를 품은 1618줄 모놀리스이고, 회귀 테스트가 이 파일의 소스 문자열을 정규식으로 고정하고 있어 분해 자체가 잠긴 구조가 가장 큰 부채다(CQ-1·CQ-2가 한 몸). 중복(릴 파일 로직 2벌, 경로 파서 2벌, transform 산식 2벌)과 죽은 코드(~80줄), mutation 절반의 스냅샷 통짜 롤백, byCharacter 전체 재구축으로 인한 광역 리렌더, IPC 경계의 any 일색이 그 뒤를 잇는다. P0급 결함은 없으며, 권장 순서는 dead code 제거 → 테스트를 동작 기반으로 보강 → 모놀리스 분해 → 타입/성능 강화다.

#### CQ-1 [P1] CharacterBoardView.tsx가 1618줄 모놀리스로, 12개 이상의 컴포넌트·유틸·훅이 한 파일에 응집 없이 동거한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:108 - function AssigneeNamePicker({ (186줄 규모 범용 피커가 뷰 파일 내 정의)` / `src/views/CharacterBoardView.tsx:335 - function StageRail<T extends string>({ (제네릭 재사용 컴포넌트)` / `src/views/CharacterBoardView.tsx:551 - function FeaturedImageSlot({ (업로드 파이프라인 + 메뉴 + FitEditor 소유)` / `src/views/CharacterBoardView.tsx:1012 - function CharacterDetailPanel({ (300줄 규모 상세 패널)` / `src/views/CharacterBoardView.tsx:1316 - function CharacterDetailModal({` / `src/views/CharacterBoardView.tsx:1460 - function CharacterGrid({ onAdd, pendingOpenId, onConsumeOpen }` / `src/views/CharacterBoardView.tsx:1578 - export function CharacterBoardView()`
- **확인된 사실**: 한 파일에 TagPill(:68), AssigneeNamePicker(:108), 경로 유틸 4종(:296-331), StageRail(:335), CharacterCard(:414), TagChipSection(:471), 죽은 ImageLightbox(:526), FeaturedImageSlot(:551), CostumeMemoInput(:690), CostumeIdentity(:709), PathActionRow(:752), CostumeDetail(:791), CharacterListRow(:915), CostumeThumbCard(:951), CharacterDetailPanel(:1012), CharacterDetailModal(:1316), AddCharacterModal(:1413), TabButton(:1448), CharacterGrid(:1460), CharacterBoardView(:1578)가 정의돼 있다. 반면 이미지 관련 4개 컴포넌트는 이미 src/components/characters/ 로 분리돼 있어 분리 기준이 절반만 적용된 상태다.
- **왜 문제인가**: 단일 파일에 그리드·모달·상세·폼·유틸이 섞여 있으면 변경 지점 탐색 비용이 크고, git 충돌 표면이 넓으며(20명 협업), 컴포넌트 단위 재사용·테스트가 불가능하다. 이미 characters/ 디렉터리가 존재하는데 절반만 분리돼 구조 일관성 원칙도 깨진다.
- **일으키는 문제**: 복장 상세 하나 고치려 해도 1618줄을 열어 스크롤로 탐색해야 하고, 서로 무관한 기능(카드 그리드 vs 담당자 피커) 수정이 같은 파일에서 충돌한다. 후속 기능(정렬, 아카이브, 스포트라이트 연동 등) 추가 시 파일이 계속 비대해진다.
- **수정 계획**: 동작 변경 없는 순수 리팩터링. src/components/characters/ 아래로 추출: (1) board/stageMeta.ts — DESIGN_STAGE_META·RIGGING_STAGE_META·STRUCTURE_TAG_PALETTE·ASSET_TAG_PALETTE(:47-65). (2) src/services/characterPathActions.ts — displayPathName·openStoredPath·copyCharacterImage·resolveFolderAfterFilePick(:296-331, toast 의존이라 utils 아닌 services). (3) AssigneeNamePicker.tsx — parseAssigneeNames/formatAssigneeNames 포함(:96-294), props { label: string; value: string | null; onChange: (v: string | null) => void } (CQ-4의 dead 'stack' variant 제거 후 variant prop 삭제). (4) StageRail.tsx(:335-412) — 제네릭 시그니처 그대로. (5) TagChips.tsx — TagPill+TagChipSection(:68-94, :471-523). (6) CharacterCard.tsx(:414-468) — React.memo 적용(CQ-6 연계). (7) FeaturedImageSlot.tsx(:551-687)와 CostumeIdentity.tsx(CostumeMemoInput 동거, :690-750). (8) CostumeDetail.tsx(:752-908, PathActionRow는 내부 유지). (9) CharacterDetailModal.tsx(:915-1411) — CharacterListRow·CostumeThumbCard·CharacterDetailPanel 내부 유지(모달 단위 응집). (10) AddCharacterModal.tsx(:1413-1446). (11) src/hooks/useCharacterWorkPaths.ts — handlePickFolder/handlePickFile(:1081-1101)을 (character: Character, activeCostume: CharacterCostume | null) => { pickFolder(): Promise<void>; pickFile(target?: CharacterCostume | null): Promise<void> } 로. 뷰에는 TabButton·CharacterGrid·CharacterBoardView만 남겨 ~300줄. 과잉 분해 금지: ListRow/ThumbCard/PathActionRow/MemoInput은 부모 파일에 co-locate. 순서: dead code 제거(CQ-4) → 상수·유틸 → leaf 컴포넌트 → 모달 → 훅, 단계마다 npm run typecheck + node --test tests/characterBoardAssetWorkflow.test.ts. 주의: 테스트가 CharacterBoardView.tsx 원문을 정규식으로 고정하므로(CQ-2) readFileSync 대상 경로를 이동 파일로 분산 갱신해야 한다.

#### CQ-2 [P2] 테스트가 소스 문자열 정규식 회귀 검사 위주라 리팩터링을 잠그고, store·realtime 핵심 로직은 미커버다

- **판정**: CORRECTED
- **코드 앵커**: `tests/characterBoardAssetWorkflow.test.ts:13 - const characterBoard = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');` / `tests/characterBoardAssetWorkflow.test.ts:108 - 'const shownCostume = activeCostume;' (소스 한 줄을 문자 그대로 고정)` / `tests/characterBoardAssetWorkflow.test.ts:119 - assert.ok(characterBoard.includes('const saved = await updateCostumeField(targetCostume.id, { workFilePath: filePath });'));` / `tests/characterBoardAssetWorkflow.test.ts:155 - assert.match(characterBoard, /const extra = tags\.filter\(\(t\) => !palette\.includes\(t\)\)/` / `src/stores/useCharacterBoardStore.ts:520 - async function applyCostumeUpdate( (필드 단위 롤백 로직, 테스트 0건)` / `src/stores/useCharacterBoardStore.ts:420 - receiveRealtime: (payload) => { (3테이블 머지 로직, 테스트 0건)`
- **확인된 사실**: 195줄 테스트 중 동작 테스트는 characterAssets 유틸 3개(getParentFolderPath 등)뿐이고, 나머지는 8개 소스 파일을 readFileSync 로 읽어 특정 코드 문자열 존재/부재를 정규식으로 검사한다(:99-142, :154-195). 반면 applyCostumeUpdate의 조건부 롤백(store:540-554), receiveRealtime의 신규 캐릭터+매핑 선도착 episodeIds 파생(store:443-446), buildEpisodeLinks/upsertLink/removeLink, rowToCostume의 assignee fallback(supabaseService:803-819)은 어떤 테스트도 없다.
- **왜 문제인가**: 소스 문자열 고정 테스트는 '그 코드가 그 파일에 그 모양으로 존재하는가'만 검증하므로 동작이 같아도 변수명·공백·파일 위치가 바뀌면 깨진다. 즉 리팩터링(CQ-1)과 정면 충돌하는 테스트 설계다. 정작 회귀가 무서운 순수 로직(롤백·머지)은 검증되지 않는다.
- **일으키는 문제**: CQ-1 분해나 CQ-4 정리처럼 동작 불변 변경조차 테스트 대량 수정을 강제해 리팩터링 비용을 인위적으로 키운다. 롤백/머지 로직에 회귀가 생겨도 테스트는 통과한다(예: applyCostumeUpdate 롤백 조건을 잘못 고쳐도 감지 불가).
- **수정 계획**: 동작 변경 없는 테스트 보강. (1) 신규 tests/characterBoardStore.test.ts: useCharacterBoardStore.getState() 기반으로 svc* 를 모킹하기 어려우므로 순수 함수부터 — buildByCharacter·buildEpisodeLinks·upsertLink·removeLink 를 store 파일에서 export 하고 단위 테스트. applyCostumeUpdate 는 (set,get) 주입형이므로 가짜 set/get 으로 '실패 시 낙관값 그대로인 필드만 롤백, 더 나중 편집은 보존' 시나리오를 직접 검증. (2) 신규 tests/characterRowMapping.test.ts: rowToCostume 에 design_assignee 컬럼 유/무 두 케이스를 넣어 fallback 검증(현재 정규식 테스트 :86-97 대체). (3) receiveRealtime 은 store 인스턴스에 payload 주입해 INSERT/UPDATE/DELETE 3케이스 + '캐릭터보다 매핑 선도착' 케이스 검증. (4) 소스 정규식 테스트는 위 동작 테스트가 자리 잡은 뒤 파일 이동에 맞춰 축소·재배치(전부 삭제하지 말고 마이그레이션 SQL 토큰 검사류 :70-97 는 유지 가치 있음).
- **검증 교정(우선 적용)**: evidence의 '8개 소스 파일' → 실제는 11개 파일 readFileSync(tests:10-20: types/index.ts, supabaseService.ts, electron/supabase.ts, CharacterBoardView.tsx, useCharacterBoardStore.ts, EpisodeAssetBoard.tsx, ScenesView.tsx, CharacterImageLightbox.tsx, CharacterImageFitEditor.tsx, devElectronAPI.ts, 마이그레이션 SQL) + CharacterImageFrame.tsx 인라인 read(:122)로 총 12개. 문자열/정규식 검사 범위도 :99-142/:154-195만이 아니라 :56-195 전반(타입 토큰 :56-68, snake_case 매핑 :70-84, assignee fallback 정규식 :86-97 포함).

#### CQ-3 [P2] 릴 파일 열기/등록 낙관적 업데이트 로직이 CharacterBoardView와 EpisodeAssetBoard에 통째로 중복이다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:1103 - const handleEpisodeReel = useCallback(async (episode: typeof episodes[number]) => {` / `src/views/CharacterBoardView.tsx:1110 - const prev = useDataStore.getState().episodes; (낙관 반영→저장→실패 롤백)` / `src/views/EpisodeAssetBoard.tsx:398 - const handleEpisodeReel = async () => {` / `src/views/EpisodeAssetBoard.tsx:407 - const prev = useDataStore.getState().episodes; (동일 패턴 반복)`
- **확인된 사실**: 두 함수 모두 reelFilePath 있으면 openWorkPath 로 열고, 없으면 chooseWorkFile → setEpisodes 낙관 반영 → updateEpisodeReelPath → 실패 시 setEpisodes(prev) 롤백 + 동일 토스트 문구('릴 파일 경로를 등록했어요'/'릴 파일 경로 저장에 실패했어요')까지 문자 단위로 일치한다. 차이는 log prefix([character-board] vs [episode-assets])와 대상 에피소드를 인자로 받느냐 상태에서 읽느냐뿐이다.
- **왜 문제인가**: 동일 도메인 동작(릴 파일 이중 동작 버튼)이 2벌 존재하면 한쪽만 수정되는 드리프트가 필연이다. 실제로 CharacterBoardView 쪽은 열기 실패 토스트를 openStoredPath 공용 함수에 위임하는데 EpisodeAssetBoard 쪽은 직접 토스트를 띄워 이미 미세하게 갈라졌다(:401-402 vs View:304-312).
- **일으키는 문제**: 릴 파일 동작 정책이 바뀌면(예: 등록 확인 다이얼로그 추가) 두 곳을 찾아 고쳐야 하고 누락 시 탭에 따라 다른 동작이 된다.
- **수정 계획**: 동작 변경 없는 순수 리팩터링. src/hooks/useEpisodeReel.ts 신규: export function useEpisodeReel(): (episode: Episode) => Promise<void> — 내부에 open-or-register 로직과 낙관 반영/롤백/토스트를 단일 구현. CharacterBoardView:1103-1120 과 EpisodeAssetBoard:398-417 을 이 훅 호출로 대체. log prefix 는 '[episode-reel]' 로 통일. 부수 효과: CharacterBoardView 쪽 useCallback dep 배열의 episodes(:1120)가 타입 주석용으로만 쓰이며 콜백을 매 에피소드 변경마다 재생성시키는 문제도 함께 사라진다.

#### CQ-4 [P2] 죽은 코드 3건 — 미사용 로컬 ImageLightbox, AssigneeNamePicker의 'stack' variant, store의 updateCharacterMemo

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:526 - function ImageLightbox({ url, alt, onClose }: ... (전 코드베이스에서 <ImageLightbox 사용처 0건)` / `src/views/CharacterBoardView.tsx:247 - return ( ... variant='stack' 렌더 분기 (:247-293)` / `src/views/CharacterBoardView.tsx:871 - variant="inline" / :887 - variant="inline" (호출 2곳 모두 inline)` / `src/stores/useCharacterBoardStore.ts:222 - updateCharacterMemo: async (id, memo) => { (호출처 grep 결과 store 자신뿐)` / `src/views/CharacterBoardView.tsx:561 - shownCostume: CharacterCostume | null; (costume 과 항상 동일값)` / `src/views/CharacterBoardView.tsx:1068 - const shownCostume = activeCostume;`
- **확인된 사실**: (1) 로컬 ImageLightbox(:526-548)는 정의만 있고 렌더되지 않는다 — 실제 라이트박스는 CharacterImageLightbox(:1304) 사용. (2) AssigneeNamePicker 의 기본값 variant='stack' 분기(:247-293, 47줄)는 두 호출부(:871, :887) 모두 inline 이라 도달 불가. (3) updateCharacterMemo(store:108, :222-232)는 어떤 컴포넌트도 호출하지 않는다 — AddCharacterModal 이 생성 시 memo 를 저장하지만(:1422) 이후 캐릭터 memo 를 표시·수정하는 UI 자체가 없다. (4) FeaturedImageSlot 의 costume/shownCostume 이중 prop 은 호출부에서 항상 동일값이고, 테스트(:108)가 이 동일성을 문자열로 고정하고 있다.
- **왜 문제인가**: 도달 불가 코드는 읽는 사람에게 '어딘가에서 쓰이나?' 탐색 비용을 강제하고, 특히 이중 prop 은 '언제 둘이 달라지는가'라는 존재하지 않는 시나리오를 상정하게 만든다. updateCharacterMemo 는 죽은 API 인 동시에 '입력은 받는데 다시는 볼 수 없는 데이터'(캐릭터 memo)라는 미완성 기능의 흔적이다.
- **일으키는 문제**: 1618줄 파일에서 ~80줄이 순수 노이즈다. 캐릭터 추가 시 입력한 메모는 DB에 저장만 되고 UI 어디에도 나타나지 않아, 팀원이 적은 메모가 증발한 것처럼 보인다.
- **수정 계획**: 순수 리팩터링 + 1건은 제품 결정 필요. (1) ImageLightbox(:526-548) 삭제 — 동작 불변. (2) 'stack' 분기(:247-293)와 variant prop 삭제, inline 렌더만 유지 — 동작 불변. (3) FeaturedImageSlot 의 shownCostume prop 삭제하고 costume 하나로 통합(내부 shownUrl 등은 costume 기반으로), 호출부(:1190-1196)와 테스트(:108, :117 인접 정규식) 동반 수정 — 동작 불변. (4) updateCharacterMemo 는 한솔에게 확인: 캐릭터 메모 표시/편집 UI 를 붙일 계획이면 CharacterDetailPanel 헤더 아래에 CostumeMemoInput 재사용으로 노출(동작 추가), 아니면 store 액션과 AddCharacterModal 의 memo 입력 필드를 함께 제거(동작 수정).

#### CQ-5 [P2] 낙관적 업데이트 롤백 전략이 이원화 — 복장 update만 필드 단위 조건부 롤백이고 나머지 9개 mutation은 전체 스냅샷 롤백이라 동시 변경을 덮어쓴다

- **판정**: CONFIRMED
- **코드 앵커**: `src/stores/useCharacterBoardStore.ts:538 - // 전체 스냅샷을 되돌리면 그 사이 성공한 다른 업데이트/실시간 머지를 덮어쓴다. (문제를 자각한 주석)` / `src/stores/useCharacterBoardStore.ts:544 - const reverted = cur.map((c) => { (applyCostumeUpdate 의 필드 단위 롤백)` / `src/stores/useCharacterBoardStore.ts:229 - set({ characters: prev }); (updateCharacterMemo — 스냅샷 통짜 롤백)` / `src/stores/useCharacterBoardStore.ts:241 - set({ characters: prev }); (updateCharacterFolder)` / `src/stores/useCharacterBoardStore.ts:253 - set({ characters: prev }); (renameCharacter)` / `src/stores/useCharacterBoardStore.ts:274 - set({ characters: prevChars, costumes: prevCostumes, ... (deleteCharacter)` / `src/stores/useCharacterBoardStore.ts:370 - set({ characters: prevChars, episodeLinks: prevLinks }); (linkEpisode)`
- **확인된 사실**: applyCostumeUpdate(:520-558)는 '이 업데이트가 바꾼 필드만, 아직 낙관값 그대로일 때만' 되돌리는 정교한 롤백을 구현했다. 반면 updateCharacterFolder/renameCharacter/deleteCharacter/deleteCostume/linkEpisode/unlinkEpisode/setEpisodeMemo/setEpisodeCostume 은 요청 시작 시점의 배열/Map 스냅샷(prev)을 통째로 set 한다. 요청 실패까지의 수백 ms 사이에 realtime 머지(receiveRealtime)나 다른 낙관 업데이트가 도착하면 그 변경들이 스냅샷에 없어 함께 소멸한다.
- **왜 문제인가**: 같은 store 안에서 mutation 마다 일관성 보장 수준이 다르면, 코드 자체가 남긴 주석(:538-539)이 지적하는 결함을 절반의 경로에만 고친 셈이다. '모든 데이터 변경은 낙관적 업데이트→실패 시 롤백' 규칙의 '롤백'이 다른 사용자 변경까지 되돌리는 건 규칙의 취지 위반이다.
- **일으키는 문제**: 예: A가 캐릭터 이름 변경 요청 → 그 사이 B의 복장 단계 변경이 realtime 으로 도착 → A의 rename 이 네트워크 오류로 실패하면 롤백이 B의 단계 변경 반영까지 지운다. 다음 realtime/재로드까지 A 화면만 stale. 저빈도지만 '방금 바꿨는데 되돌아갔다' 류의 신뢰 문제를 만든다.
- **수정 계획**: 동작 수정(실패 경로 한정, 성공 경로 불변). (1) applyCharacterUpdate(set, get, id, updates, errorMsg) 헬퍼를 applyCostumeUpdate(:520-558)와 동일 패턴으로 신설(characters 배열 대상, 필드 단위 조건부 롤백)하고 updateCharacterMemo/updateCharacterFolder/renameCharacter 가 사용. (2) 삭제 계열(deleteCharacter/deleteCostume)은 필드 단위가 불가하므로 롤백을 '현재 state 에 해당 id 가 없을 때만 삭제했던 항목을 재삽입'으로 바꿔 스냅샷 전체 복원을 제거. (3) linkEpisode/unlinkEpisode/setEpisodeMemo/setEpisodeCostume 은 이미 존재하는 upsertLink/removeLink(:488-517)로 역연산 롤백(실패 시 removeLink/upsertLink 호출)하도록 변경. 각 케이스를 CQ-2 의 store 테스트로 고정.

#### CQ-6 [P2] 복장 하나만 바뀌어도 byCharacter Map 전체가 재구축돼 모든 카드·목록 행이 리렌더된다 (memo 부재 + 구조적 공유 없음)

- **판정**: CONFIRMED
- **코드 앵커**: `src/stores/useCharacterBoardStore.ts:54 - function buildByCharacter(costumes: CharacterCostume[]): Map<string, CharacterCostume[]> { (전 캐릭터 배열을 매번 새로 생성)` / `src/stores/useCharacterBoardStore.ts:532 - set({ costumes: next, byCharacter: buildByCharacter(next) }); (단건 필드 변경에도 전체 재구축)` / `src/views/CharacterBoardView.tsx:414 - function CharacterCard({ (React.memo 없음)` / `src/views/CharacterBoardView.tsx:1557 - {filtered.map((c) => ( <CharacterCard ... costumes={byCharacter.get(c.id) ?? []}` / `src/views/CharacterBoardView.tsx:915 - function CharacterListRow({ (모달 좌측 목록도 memo 없음)`
- **확인된 사실**: buildByCharacter 는 costumes 평면 배열에서 Map 을 통째로 다시 만들어 변경 없는 캐릭터의 복장 배열 identity 까지 전부 갱신한다. applyCostumeUpdate(:532)·receiveRealtime(:462, :473)·deleteCostume(:344) 등 모든 복장 변경 경로가 이를 호출한다. CharacterGrid 는 byCharacter 를 구독(:1462)하므로 다른 사용자가 복장 단계 하나를 realtime 으로 바꿔도 그리드 전체가 리렌더되고, CharacterCard/CharacterListRow/CostumeThumbCard 에 React.memo 가 없어 모든 카드 함수가 재실행된다. 카드 이미지에 fit transform 계산(normalizeCharacterImageFit)이 렌더마다 수행된다(CharacterImageFrame:47).
- **왜 문제인가**: '변경된 것만 다시 그린다'는 파생 상태 설계 원칙 위반. memo 를 붙여도 배열 identity 가 매번 새로워 무력하므로, 구조적 공유(변경된 key 만 새 배열)가 선행돼야 한다.
- **일으키는 문제**: 캐릭터 수십~수백 개 규모에서 체크 한 번, realtime 수신 한 번마다 전체 카드 그리드 + 모달 좌측 목록의 가상 DOM 재생성이 발생한다. 지금 규모(20명 팀)에선 프레임 드랍 수준은 아니지만 캐릭터·복장 데이터가 늘수록 선형으로 나빠지고, 상세 모달을 열어둔 채 타 사용자 변경이 오면 입력 중 버벅임으로 나타날 수 있다.
- **수정 계획**: 동작 변경 없는 성능 리팩터링, 2단계. (1) store 에 patchByCharacter(map: Map<string, CharacterCostume[]>, characterId: string, allCostumes: CharacterCostume[]): Map 헬퍼 신설 — 새 Map 은 만들되 characterId 키의 배열만 재생성하고 나머지 키는 기존 배열 참조 재사용. applyCostumeUpdate(:532)와 receiveRealtime 의 costume UPDATE 경로(:473)에서 buildByCharacter 대신 사용(INSERT/DELETE·load 는 buildByCharacter 유지). (2) CharacterCard(:414)·CharacterListRow(:915)·CostumeThumbCard(:951)를 React.memo 로 감싸기 — (1) 덕분에 미변경 캐릭터의 costumes prop identity 가 유지돼 실효. onOpen/onContextMenu 콜백은 c.id 기반이므로 useCallback 없이도 memo 비교에서 걸리지만, 그리드 map 내 인라인 콜백은 캐릭터별로 안정화(예: 콜백을 CharacterCard 내부로 이동해 character.id 사용)한다.

#### CQ-7 [P2] DB row 매핑·realtime payload·IPC 반환이 전부 any라 캐릭터 데이터 경로에 타입 검증 지점이 없다

- **판정**: CORRECTED
- **코드 앵커**: `src/services/supabaseService.ts:787 - export function rowToCharacter(row: any): Character {` / `src/services/supabaseService.ts:802 - export function rowToCostume(row: any): CharacterCostume {` / `src/services/supabaseService.ts:977 - return window.electronAPI.onCharacterBoardRealtime((payload: any) => {` / `src/stores/useCharacterBoardStore.ts:149 - row: any | null; old: any | null;` / `src/types/index.ts:1335 - supabaseLoadCharacters: () => Promise<any[]>; (electronAPI 캐릭터 IPC 12종 전부 any)` / `src/stores/useCharacterBoardStore.ts:543 - const prevRec = prevCostume as unknown as Record<string, unknown>; (4중 as unknown as 캐스트)` / `src/stores/useCharacterBoardStore.ts:308 - ? { designStage: value as CharacterCostume['designStage'] } (union 인자 + 캐스트)`
- **확인된 사실**: electron 쪽에는 이미 CharacterRow/CharacterCostumeRow/EpisodeCharacterMapRow 타입이 정의돼 있으나(electron/supabase.ts:3754, :3766, :3790) 렌더러는 IPC 경계에서 any 로 받아 rowToCharacter/rowToCostume 에 any 로 넘긴다. 컬럼명 오타(row.work_folder_pat 같은)는 컴파일이 못 잡는다. updateCostumeStage(store:115-119)는 value 를 designStage|riggingStage union 으로 받아 stage='design' 에 리깅 값 'vectorized' 를 넘겨도 타입 오류가 없다. applyCostumeUpdate 롤백(:542-551)은 as unknown as 를 4회 사용한다.
- **왜 문제인가**: IPC 는 이 앱의 아키텍처상 유일한 데이터 관문인데 그 경계가 any 면 '타입은 있으나 검증되는 곳이 없는' 구조다. 특히 rowTo* 는 snake→camel 필드명이 수기 매핑이라 오타에 가장 취약한 지점이다.
- **일으키는 문제**: DB 컬럼 추가/개명 시 매핑 누락이 런타임 undefined 로만 나타나고(과거 sceneId 대소문자 사건과 같은 부류), 단계 값 교차 전달 같은 실수가 컴파일을 통과한다.
- **수정 계획**: 동작 변경 없는 타입 강화. (1) src/types/index.ts 에 CharacterRow/CharacterCostumeRow/EpisodeCharacterMapRow 렌더러용 타입을 추가(electron/supabase.ts:3754-3800 정의를 이관해 electron 쪽도 import 로 공유)하고 electronAPI 캐릭터 IPC 시그니처(types:1335-1345)를 Promise<CharacterRow[]> 등으로 교체, rowToCharacter/rowToCostume 인자를 해당 Row 타입으로. rowToCostume 의 hasOwnProperty fallback 은 CharacterCostumeRow 의 design_assignee?: string | null 옵셔널로 표현. (2) updateCostumeStage 를 판별 유니온 인자 하나로 변경: updateCostumeStage(id: string, change: { stage: 'design'; value: CostumeDesignStage } | { stage: 'rigging'; value: CostumeRiggingStage }) — 내부 as 캐스트 제거, 호출부 2곳(:865, :881) 수정. (3) receiveRealtime payload 의 row/old 를 CharacterRow | CharacterCostumeRow | EpisodeCharacterMapRow | null 판별 유니온(table 기준)으로. (4) applyCostumeUpdate 롤백은 (Object.keys(updates) as (keyof CharacterCostume)[]) 로 순회해 as unknown as 제거.
- **검증 교정(우선 적용)**: fix (1)의 '타입을 src/types 로 이관해 electron 쪽도 import 로 공유' 부분 교정 필요: electron/ 디렉터리는 현재 src 를 일절 import 하지 않으며(grep '@/|../src' 0건), tsconfig.node.json include 가 ["vite.config.ts", "electron"] 뿐이라 electron→src import 는 빌드 설정 변경을 요구한다. 이 코드베이스의 기존 관행은 경계 양쪽 중복 정의(예: CostumeActivityLogContext 가 electron/main.ts:1441 과 src/types/index.ts:247 에 각각 존재). 따라서 Row 타입도 렌더러 쪽(src/types)에 중복 정의하고 electron/supabase.ts 의 기존 정의는 그대로 두는 방식이 관행에 맞다. 나머지 fix((2) 판별 유니온, (3) payload 유니온, (4) keyof 순회)와 발견 자체는 유효.

#### CQ-8 [P3] lockAspect 스케일 해석과 transform 문자열 생성 로직이 CharacterImageFrame과 FitEditor에 2벌 존재한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/components/characters/CharacterImageFrame.tsx:48 - const sx = normalized.lockAspect ? normalized.scale : (normalized.scaleX ?? normalized.scale);` / `src/components/characters/CharacterImageFrame.tsx:74 - transform: `translate(${normalized.x}%, ${normalized.y}%) scale(${sx}, ${sy})`,` / `src/components/characters/CharacterImageFitEditor.tsx:52 - function scalesOf(fit: CharacterImageFit): { scaleX: number; scaleY: number } {` / `src/components/characters/CharacterImageFitEditor.tsx:81 - transform: `translate(${normalized.x}%, ${normalized.y}%) scale(${scaleX}, ${scaleY})`,` / `tests/characterBoardAssetWorkflow.test.ts:122 - Frame 쪽 transform 문자열 정규식 / :186 - FitEditor 쪽 동일 문자열 정규식 (중복을 테스트도 2벌로 고정)`
- **확인된 사실**: 'lockAspect 면 scale 단일, 아니면 scaleX/scaleY' 해석과 translate+scale transform 템플릿이 두 파일에서 독립 구현돼 있고, 테스트도 두 문자열을 각각 검사한다. 이 값은 '편집기에서 본 것 = 썸네일에서 보이는 것'을 보장해야 하는 표시 계약인데 구현이 분리돼 있다.
- **왜 문제인가**: 편집기와 표시부의 transform 산식이 갈라지면 사용자가 맞춘 썸네일이 실제 카드에서 다르게 보이는 종류의 버그가 된다. 지금은 우연히 동일하지만 구조가 동일성을 보장하지 않는다.
- **일으키는 문제**: 예: 향후 회전(rotate) 추가 시 한쪽만 반영되면 FitEditor 미리보기와 카드 썸네일이 어긋난다. 수정 시 테스트 2곳도 함께 갱신해야 하는 유지비.
- **수정 계획**: 동작 변경 없는 순수 리팩터링. src/utils/characterAssets.ts 에 (1) export function resolveFitScales(fit: CharacterImageFit): { scaleX: number; scaleY: number } (FitEditor 의 scalesOf 이관), (2) export function getFitTransformStyle(fit: CharacterImageFit): CSSProperties (transform+transformOrigin 반환) 를 추가. CharacterImageFrame:47-49·:73-76 과 FitEditor:52-58·:77-84 를 이 함수 호출로 대체. 테스트는 두 컴포넌트의 문자열 검사 대신 resolveFitScales/getFitTransformStyle 단위 테스트(lockAspect true/false 케이스)로 교체.

#### CQ-9 [P3] 경로 문자열 파싱 로직이 뷰의 displayPathName과 characterAssets의 getParentFolderPath에 중복이다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:296 - function displayPathName(path: string | null | undefined): string { (normalize + lastIndexOf 백슬래시/슬래시로 basename)` / `src/utils/characterAssets.ts:14 - export function getParentFolderPath(filePath: string): string { (동일 normalize + lastIndexOf 로 dirname)` / `src/views/CharacterBoardView.tsx:299 - const normalized = value.replace(/[\\/]+$/, ''); / characterAssets.ts:17 - const normalized = trimmed.replace(/[\\/]+$/, '');`
- **확인된 사실**: 두 함수 모두 trim → 끝 구분자 제거(동일 정규식) → Math.max(lastIndexOf('\\'), lastIndexOf('/')) 로 분할 지점을 찾는다. 한쪽은 뒤(basename), 한쪽은 앞(dirname)을 반환할 뿐이다. displayPathName 은 테스트가 없고 getParentFolderPath 는 있다(tests:22-35).
- **왜 문제인가**: 한글 경로·트레일링 슬래시 등 엣지 처리가 두 벌이면 한쪽만 고쳐지는 드리프트가 생긴다(CLAUDE.md 의 한글 경로 주의 제약과 직결). 유틸 파일이 이미 존재하는데 뷰에 파서가 사는 것 자체가 배치 오류다.
- **일으키는 문제**: 예: UNC 경로(\\\\server\\share)나 드라이브 루트(G:\\) 처리 개선이 필요해질 때 표시명과 폴더 유도가 서로 다른 규칙을 갖게 된다.
- **수정 계획**: 동작 변경 없는 순수 리팩터링. characterAssets.ts 에 내부 헬퍼 function splitPathAt(path: string): { normalized: string; index: number } 를 두고 getParentFolderPath 와 신규 export function getPathBaseName(path: string | null | undefined): string 이 공유. 뷰의 displayPathName(:296-302)은 getPathBaseName 호출 + '미등록' fallback 만 남기고 (CQ-1 의 characterPathActions.ts 로 이동). tests 에 getPathBaseName 케이스(트레일링 슬래시, 한글 경로, 빈 값) 추가.

#### CQ-10 [P3] CharacterImageContextMenu 콜백 8종 조립이 FeaturedImageSlot과 CharacterDetailPanel에 2벌 반복된다

- **판정**: CONFIRMED
- **코드 앵커**: `src/views/CharacterBoardView.tsx:658 - <CharacterImageContextMenu x={contextMenu.x} ... (FeaturedImageSlot 쪽, :657-674)` / `src/views/CharacterBoardView.tsx:1278 - <CharacterImageContextMenu x={imageMenu.x} ... (DetailPanel 쪽, :1277-1292)` / `src/views/CharacterBoardView.tsx:666 - onBackground={(background: CharacterImageBackground) => { if (shownCostume) void updateCostumeField(...) }} / :1286 - onBackground={(background...) => updateCostumeField(menuCostume.id, ...)}`
- **확인된 사실**: background/hasImage/hasFolder/hasFile/onBackground/onEditFit/onCopyImage/onOpenFolder/onOpenFile 9개 prop 을 costume+character 에서 계산해 넘기는 코드가 두 곳에서 거의 동일하게 반복된다. 차이는 대상 costume 의 출처(활성 복장 vs 우클릭한 썸네일 복장)와 FitEditor 열기 방식(boolean vs costumeId)뿐이다.
- **왜 문제인가**: 메뉴 항목이 하나 추가될 때마다(props 1개) 두 조립부를 모두 수정해야 한다. 콜백 나열형 인터페이스는 이미 9개로, 항목 추가마다 prop 이 늘어나는 확장 방식 자체가 한계다.
- **일으키는 문제**: 메뉴 확장(예: '이미지 삭제' 추가) 시 한쪽 누락으로 위치에 따라 메뉴 구성이 달라지는 회귀가 나기 쉽다.
- **수정 계획**: 동작 변경 없는 순수 리팩터링. CharacterImageContextMenu 를 데이터 중심으로 재정의: props 를 { x; y; character: Character; costume: CharacterCostume; onBackground(costumeId, bg); onEditFit(costumeId); onClose } 로 바꾸고 hasImage/hasFolder/hasFile/onCopyImage/onOpenFolder/onOpenFile 은 내부에서 costume.featuredImageUrl·character.workFolderPath·costume.workFilePath 와 characterPathActions(CQ-1) 로 계산. 두 사용처(:657-674, :1277-1292)는 대상 costume 만 다르게 전달. CharacterImageContextMenu 가 캐릭터 도메인 전용 컴포넌트이므로 도메인 타입 의존 추가는 응집도 향상이지 결합 증가가 아니다.

#### CQ-11 [P3] IPC 채널·함수 명명 불일치 — 복장 채널만 character- 접두 누락, getUserColor는 컴포넌트 파일에서 import

- **판정**: CONFIRMED
- **코드 앵커**: `electron/main.ts:2875 - ipcMain.handle('supabase:add-costume', ... / :2882 - 'supabase:update-costume' / :2896 - 'supabase:delete-costume'` / `electron/preload.ts:613 - supabaseLoadCharacterCostumes: () => ipcRenderer.invoke('supabase:load-character-costumes'), (로드만 character- 접두)` / `src/views/CharacterBoardView.tsx:43 - import { getUserColor } from '@/components/common/AssigneeSelect';` / `src/services/supabaseService.ts:949 - updateEpisodeCharacterMapping vs preload.ts:635 - 'supabase:update-episode-character-map' (mapping/map 혼용)`
- **확인된 사실**: 같은 테이블(character_costumes)에 대해 load 는 'supabase:load-character-costumes', 쓰기는 'supabase:add-costume'/'update-costume'/'delete-costume' 로 접두가 갈린다. 서비스 함수명(updateEpisodeCharacterMapping)과 채널명(update-episode-character-map)도 단수형이 다르다. getUserColor 는 유틸 함수인데 AssigneeSelect 컴포넌트 모듈에서 export 돼 뷰가 컴포넌트 파일에 의존한다.
- **왜 문제인가**: 채널명은 grep 기반 추적(이 코드베이스의 주 탐색 방식)의 키인데 접두 불일치는 'costume 관련 채널 전부 찾기'를 두 패턴 검색으로 만든다. 유틸의 컴포넌트 모듈 기생은 순환 의존 위험과 번들 경계 흐림을 만든다.
- **일으키는 문제**: 실수 유발형 마찰: 새 복장 채널 추가 시 어느 컨벤션을 따를지 모호하고, 채널 rename 은 preload/main/타입 3곳 동기 수정이라 지금 고치지 않으면 불일치가 굳는다.
- **수정 계획**: (1) 채널 rename 은 preload/main 이 한 배포 단위라 안전: 'supabase:add-character-costume'/'update-character-costume'/'delete-character-costume' 으로 통일 — preload.ts:621-626, main.ts:2875-2901 동시 수정, 렌더러 함수명은 유지. 동작 불변. (2) getUserColor 를 src/utils/userColor.ts 로 이동하고 AssigneeSelect.tsx 는 re-export(기존 import 호환 유지) — 동작 불변. 두 작업 모두 다른 PR 과 충돌 표면이 넓으니 CQ-1 분해 직전에 단독 커밋으로.

#### CQ-12 [P3] 에피소드 매핑 realtime 수신마다 매핑 테이블 전체를 재조회한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/stores/useCharacterBoardStore.ts:478 - if (table === 'episode_character_mapping') { ... void reloadEpisodeMappings(set, get); (payload 무시하고 전체 재로드)` / `src/stores/useCharacterBoardStore.ts:561 - async function reloadEpisodeMappings( ... svcLoadMap() (전체 SELECT)` / `electron/supabase.ts:4112 - export function startCharacterBoardRealtime( (payload 를 그대로 중계, episode_number 미해석)`
- **확인된 사실**: episode_character_mapping 의 payload row 에는 episode_id(UUID)만 있고 episodeNumber 가 없어, store 는 INSERT/UPDATE/DELETE 를 구분하지 않고 매번 loadEpisodeCharacterMap 전체 조회로 대응한다(주석 :479-482 가 자각). characters/costumes 테이블은 부분 머지를 하는 것과 대비된다. 이 테이블은 조인 조회(episodes(episode_number), electron/supabase.ts:3853)라 행수 증가 시 비용이 더 크다.
- **왜 문제인가**: '다른 사용자 변경은 ~100ms 내 부분 수신' 아키텍처에서 이 테이블만 O(전체) 재조회다. 원인은 메인 프로세스가 payload 를 해석 없이 중계해서이며, episode_id→episodeNumber 해석은 메인이 가장 싸게 할 수 있는 위치다.
- **일으키는 문제**: 누군가 에피소드 토글/이 편 메모를 연타하면 접속 중인 모든 클라이언트가 그 횟수만큼 매핑 전체 SELECT 를 수행한다. 20명·수백 행 규모에선 견디지만 에피소드·캐릭터가 늘수록 PostgREST 1000행 제한 이슈(과거 사례)와 같은 성장통 후보다.
- **수정 계획**: 동작 수정(효율 개선, 렌더 결과 동일). (1) electron/supabase.ts startCharacterBoardRealtime 에서 table==='episode_character_mapping' 이면 row/old 의 episode_id 를 episodes 테이블 단건 select(또는 메인이 이미 보유한 에피소드 캐시)로 episode_number 로 해석해 payload.row.episode_number 에 주입. (2) store receiveRealtime 의 매핑 분기를 eventType 별 부분 머지로: INSERT/UPDATE 는 upsertLink(:488) + characters[].episodeIds 추가, DELETE 는 removeLink(:508) + episodeIds 제거. (3) episode_number 해석 실패 시에만 기존 reloadEpisodeMappings fallback 유지. CQ-2 테스트로 3 이벤트 케이스 고정.

#### CQ-13 [P3] 카드 그리드·목록 썸네일 이미지에 lazy loading이 없어 모든 캐릭터 이미지를 즉시 로드한다

- **판정**: CONFIRMED
- **코드 앵커**: `src/components/characters/CharacterImageFrame.tsx:68 - <img src={url} alt={alt} draggable={false} ... (loading/decoding 속성 없음 — grep 0건)` / `src/views/CharacterBoardView.tsx:939 - {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : ... (모달 좌측 목록 raw img, 동일)` / `src/views/CharacterBoardView.tsx:1556 - <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"> (뷰포트 밖 카드도 img 마운트)`
- **확인된 사실**: characters 컴포넌트 디렉터리 전체에서 loading=/decoding= 속성이 0건이다. 그리드는 필터된 전 캐릭터의 CharacterImageFrame 을 마운트하고, 상세 모달 좌측 목록(:1369-1371)도 활성 캐릭터 전원의 썸네일 img 를 마운트한다. 이미지는 Supabase Storage public URL(800px 리사이즈)이다.
- **왜 문제인가**: 브라우저 기본 eager 로딩은 뷰포트 밖 수십~수백 장의 네트워크 요청을 첫 진입에 몰아넣는다. 한 줄짜리 표준 속성으로 해결되는 문제를 방치하는 것은 비용 대비 명백한 손해다.
- **일으키는 문제**: 캐릭터가 100+ 로 늘면 보드 첫 진입 시 이미지 요청 폭주로 초기 표시가 늦어지고(특히 사무실 공용 회선), 상세 모달을 열 때마다 좌측 목록 썸네일이 일괄 재요청될 수 있다.
- **수정 계획**: 동작 변경 없는 개선. CharacterImageFrame 의 img(:68-77)에 loading="lazy" decoding="async" 를 기본 적용하되, 라이트박스·FitEditor 처럼 즉시 표시가 필요한 곳을 위해 eager?: boolean prop(기본 false)을 추가해 CharacterImageLightbox:106 사용처만 eager 전달. CharacterListRow 의 raw img(:939)에도 동일 속성 추가. FitEditor 의 img 2곳(:319, :345)은 편집 대상이므로 eager 유지(속성 미추가).


---

## 7. Part C — 심층 리뷰가 추가로 발견한 견고성 갭 (백로그 PR I)

> 완전성 비판 단계에서 기존 52건·피드백 9건이 커버하지 않는 갭으로 확인된 항목. 각각 코드 앵커까지 검증됨. 우선순위 논의 후 별도 PR로.

### GAP-A. 이미지 로딩 실패 상태 — 전면 미커버
- `CharacterImageFrame.tsx:67-77` — `<img>`에 onError 없음. URL이 죽으면 브라우저 깨진 이미지 아이콘만 노출(placeholder 폴백·재시도 없음).
- `CharacterImageFitEditor.tsx:349-352` — 크롭 초기화가 onLoad에만 의존, onError 경로 없음 → 로드 실패 시 편집기 영구 미초기화.
- **실제 발생 가능**: '이미지 바꾸기'가 서버에서 이전 스토리지 객체를 즉시 영구 삭제하므로(electron/supabase.ts:3996-4005), realtime이 끊긴 다른 클라이언트는 삭제된 URL을 계속 표시한다.
- 제안: CharacterImageFrame에 onError 시 placeholder 폴백(기존 placeholder prop 재사용) + FitEditor에 로드 실패 안내.

### GAP-B. Realtime 재연결 catch-up 부재 + 메모 draft 유실
- `electron/supabase.ts:4136` — `channel.subscribe()`를 상태 콜백 없이 호출. CHANNEL_ERROR/TIMED_OUT/재연결 처리 코드 0건(grep 확인). 채널 단절 중 타 사용자 변경은 영구 유실, 복구는 뷰 재마운트 전체 reload뿐 — 뷰를 열어둔 채로는 무한 stale.
- 부수: 낙관적 업데이트 실패 롤백 시 CostumeMemoInput draft가 이전 값으로 리셋(:693, :699)되어 사용자가 쓴 메모 텍스트 유실(재시도 수단 없음).
- 제안: subscribe 상태 콜백에서 재연결 시 load() 재실행(catch-up) + 메모 저장 실패 시 draft 보존·재시도 UI.

### GAP-C. Realtime 자기-echo가 더 새로운 낙관 상태를 되돌리는 레이스
- `useCharacterBoardStore.ts:467-474` — costume UPDATE 수신 시 전체 row 교체. 연속 편집(예: 버전 입력 키 입력마다 쓰기 :827) 시 쓰기#1의 echo가 쓰기#2의 낙관값 반영 후 도착하면 UI가 옛 값으로 튕겼다 돌아온다.
- 제안: INT-13(버전 입력 debounce/blur 커밋)으로 발생 빈도부터 낮추고, 필요 시 updated_at 비교 머지로 보강.

### GAP-D. 동시 생성 충돌
- 캐릭터/복장 이름 중복 검사·경고 전무(electron/supabase.ts:3868-3891 무조건 INSERT) — 동시 생성 시 중복 카드 2장, 병합 수단 없음(삭제는 영구 파괴라 위험).
- sort_order max+1이 read-then-write(:3874-3891, :3959-3977) — 동시 추가 시 동률로 클라이언트 간 정렬 불안정.
- 제안: 추가 시 동명 존재 경고(막지는 않음) + sort_order 동률 시 id 보조 정렬.

### GAP-E. 삭제의 blast radius 미고지
- `electron/supabase.ts:3933-3949` — 캐릭터 삭제가 복장 이미지 전부 + **댓글 첨부 이미지까지** 스토리지에서 즉시 영구 삭제. confirm 문구(:1173 "복장도 함께 삭제됩니다")가 댓글 스레드·첨부 소멸을 미고지.
- 제안: UX-4(보관 전환)와 함께 confirm 문구에 '댓글과 첨부 이미지도 함께 삭제됩니다' 명시.

### GAP-H. 권한 게이팅 — 로딩/실패 상태
- `useCharacterBoardAccess.ts:8-10, 68-69` — fail-closed라 매 세션 시작 시 config 확인 전까지 메뉴 깜빡임(주석이 자인), metadata 조회 일시 실패 시 권한자도 기능이 통째로 사라짐(:50 catch → 차단), 재시도 UI 없음.
- 제안: 조회 실패 시 1회 자동 재시도 + 실패 상태를 사이드바 툴팁으로 구분 표시(보안 원칙 fail-closed는 유지).

---

## 8. 검증 체크리스트 (전 PR 공통)

1. `npm run typecheck` 통과.
2. `node --test tests/characterBoardAssetWorkflow.test.ts` + 신규 테스트 통과 (소스 문자열 앵커 갱신 포함 — §0-6).
3. `npm run build:vite` 통과. (정식 배포 전에는 `npm run build`까지 — 배포는 한솔 승인 게이트.)
4. 수동 QA 시나리오 (미리보기 모드: dev + `?preview=1`, mock '배한솔'):
   - [PR A] fit 저작 → 카드/썸네일/상세/라이트박스 4표면 비교, 투명 기본 배경, 라이트 모드 × 투명 조합(R5).
   - [PR B] 신규 캐릭터 생성 → '복장 1' 자동 → 이미지 추가 원샷 / 카드 우클릭 메뉴 3항목 / '이미지 복사' 한 줄 라벨 / 글자 배율 최대에서 앱 전역 버튼 줄바꿈 없음.
   - [PR C] 콜드 세션에서 Ctrl+Space 캐릭터 검색 → 상세 직행, 무권한 계정으로 미노출 확인.
   - [PR D] 기준 경로 설정 → 만들기 → 열기, 오류 3종(미설정/미연결/권한) 토스트.
   - [PR E] 디자인/리깅 담당 지정 → 나의 할일 행 표시 → 단계 done → 완료 이동 + 배지 일치 + 콘페티 오판 없음.
5. DB 마이그레이션(FB-7)은 **파일 작성·PR 포함까지만**. 라이브 적용과 기존 데이터 일괄 전환 여부(§5 FB-7-7)는 한솔 결정 대기.
6. `DEVLOG/update-notes.json` 항목은 비개발자 톤(상황+영향+결과 시나리오, 기술 용어·식별자 금지).

---

## 9. 한솔 결정 대기 항목 (구현 착수는 가능, 해당 지점만 보류)

| # | 결정 | 기본값(미결정 시) |
|---|---|---|
| 1 | FB-7: 기존 'black' 복장 일괄 투명 전환 여부 | 전환하지 않음(신규만 투명) |
| 2 | FB-2: 카드 세로 +45~50% 증가에 따른 그리드 최소 폭(180px 유지 vs 160px 축소) | 180px 유지 |
| 3 | UX-4: 캐릭터 '삭제'를 '보관(archived)'으로 전환 + 보관 목록 UI 추가 | PR F에서 보관 전환 채택 |
| 4 | FB-9: 기준 경로 초기값 — 한솔이 설정 화면에서 직접 지정 | 미설정 시 안내 토스트만 |

*리뷰 산출: 에이전트 18개(구조 지도 1, 차원 리뷰 4, 계획 설계 4, 적대 검증 8, 완전성 비판 1), 도구 호출 443회. 전 발견·계획이 코드 재확인 검증을 통과함.*
