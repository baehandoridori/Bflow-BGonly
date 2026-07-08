# 캐릭터 현황판 Tier 2 — 설계 & PR 로드맵

> Tier 1(v1.74.0, PR #206) 후속. animators1 피드백 중 큰 기능 5개.
> 작성 2026-07-08. base=main(299fb99, v1.74.0 포함). 아키텍트 에이전트 코드 전수 조사 기반.
> **진행 방식(한솔 결정)**: 마이그레이션까지 쭉 진행, 기능별 PR, 각 PR **머지 전 코덱스 리뷰 루프** 필수. **B11 슬랙 공지는 제일 마지막 PR**(웹훅 URL 받고). 이번 스코프 = 슬랙 제외 전부.

## 공통 규칙
- 레이어: electron/supabase.ts(Row snake) → main.ts(IPC) → preload.ts → src/types(camel+Row 중복) → supabaseService(매퍼) → useCharacterBoardStore(낙관+pending+롤백) → UI. electron↔src 상호 import 금지.
- 마이그레이션 추가 전용(DROP 없음), RLS allow_all, realtime `ALTER PUBLICATION`. 로드는 `loadAllRows()`(1000행 캡). 스토리지 정리는 DB 성공 후. **라이브 DB=mpqifkpxalwxgcrddchv, 마이그레이션 먼저 적용 후 코드 PR 머지.**
- 각 PR: typecheck + 신규 순수헬퍼 테스트(characterBoardStoreHelpers.test.ts) + test:character + build:vite → 코덱스 리뷰 클린 → 머지 → build → 배포(manifest 마지막·SHA256).

---

## PR1 — T2-2 복장별 출연 에피소드 (마이그레이션 없음, 가장 안전 · 먼저)
- **스키마 변경 불필요**: `episode_character_mapping.costume_id`가 `UNIQUE(episode_id,character_id)`에 미포함 → 같은 costume_id를 여러 매핑이 참조 가능(이미 다대다 지원). 기존 액션 `setEpisodeCostume`/`linkEpisode`/`unlinkEpisode` 재사용.
- **UI**: CostumeDetail(또는 CostumeIdentity 아래) "이 복장의 출연 에피소드" 칩 행. on = `episodeLinks.get(charId).find(l=>l.episodeNumber===ep)?.costumeId===costume.id`. 클릭 → `setEpisodeCostume(charId, ep, on?null:costume.id)`. 캐릭터가 그 에피소드 미연결이면 안내("먼저 출연 등록") 또는 link+set 콤보. 컴포넌트 로컬 useMemo로 시작(store 변경 불필요).
- 리스크: 한 편에 캐릭터당 복장 1개 제약(현행 동일). 미연결 에피소드 토글 불가 안내 필요.

## PR2 — T2-4 마감일 + 인원별 현황 (`due_date` 컬럼 1개)
- 마이그레이션: `ALTER TABLE character_costumes ADD COLUMN IF NOT EXISTS due_date DATE;` (realtime 불필요).
- Row/타입/매퍼: electron CharacterCostumeRow + src CharacterCostume `dueDate`/`due_date`, rowToCostume, updateCharacterCostume updates에 dueDate, store updateCostumeField whitelist에 `|'dueDate'`.
- UI: CostumeDetail "마감일" date input. CharacterBoardView 검색행 아래 담당자 미니카드 스트립(AssigneeCardsWidget 패턴, 진행중 디자인/리깅·지연 개수, 클릭→assigneeFilter). 나의할일(useMyCharacterTasks) dueDate 전달+마감배지+정렬. 신규 순수 `buildAssigneeResourceStats`(parseAssigneeNames 재사용, 전체 담당자 집계) + `dueDateBadge` 유틸(기존 날짜 유틸 재사용 우선 확인).
- 의존 방향: my-tasks→character-board 단방향 유지.

## PR3 — T2-3 px 기준 정렬 (`reference_height_px` 컬럼 1개, 옵트인)
- 마이그레이션: `ALTER TABLE characters ADD COLUMN IF NOT EXISTS reference_height_px INTEGER;` + CHECK(NULL or 0<v<5000). (컬럼명은 "실제 업로드 픽셀"과 혼동 방지 — 스튜디오 임의 기준값.)
- Row/타입/매퍼: CharacterRow/Character `referenceHeightPx`/`reference_height_px`, rowToCharacter. store `setCharacterReferenceHeight`(applyCharacterUpdate 래퍼).
- UI: CostumeDetail "키(기준값)" 숫자 입력(캐릭터 레벨). CharacterBoardView "키 비교 보기" 토글 → 그리드를 `flex flex-wrap items-end` 라인업으로, CharacterCard에 `imageHeightPx` prop(=clamp(90,320, base * char.ref / maxRefOfVisible), null이면 기본+"키 미설정" 배지). 기본 화면 무변화(옵트인).
- 리스크: 가시집합 max 기준이라 필터 시 크기 변동(안내 문구). DB CHECK + 클라 clamp 이중 방어.

## PR4 — T2-1 복장 다중 이미지 백엔드 (다크 배포, UI 무변경)
**A5(디자인+최종 2슬롯) + B12(복장당 여러 이미지) 통합**: 복장이 여러 이미지, 각 role(design/final/variant)+label, primary 1개, 순서, 이미지별 background/fit.
- 신규 테이블 `character_costume_images`(id, costume_id FK CASCADE, url, role CHECK, label, image_background, image_fit JSONB, is_primary, sort_order, created_at/updated_at, created_by). 부분 유니크 `WHERE is_primary`(복장당 primary 1개). realtime publication 추가.
- **트리거 `sync_costume_featured_image`**: primary 이미지 → `character_costumes.featured_image_url/image_background/image_fit` 자동 미러 → 기존 11개 소비처(카드/썸네일/라이트박스/에피소드에셋/나의할일) **코드 무변경 유지**.
- **RPC `set_primary_costume_image`**: 이전 primary 해제+신규 설정 원자적(부분 유니크 위반 방지).
- **1회성 백필**: 기존 featured_image_url → role='design', is_primary=true 행 이관(데이터 손실 0).
- **P1 필수**: deleteCharacter/deleteCharacterCostume 스토리지 정리에 `character_costume_images.url` 수집 추가(CASCADE로 행은 지워지나 스토리지 고아 방지).
- electron/supabase.ts: Row 타입 + load/add/update/delete/setPrimary 함수(삭제는 url 읽고 DB 후 removeCharacterStorageByUrl) + realtime tables에 4번째 추가. main.ts IPC 5개. preload 5개. src/types 5개 메서드+Row/도메인 타입+realtime table 유니온. supabaseService 매퍼+함수. store: costumeImages/imagesByCostume state + pendingCostumeImageFields + load 4번째 병렬 + 액션들(applyCostumeImageUpdate) + receiveRealtime 4번째 분기. helpers buildImagesByCostume/rebuildImagesByCostume(byCharacter 미러; reorderedCostumeSortOrders 재사용). devElectronAPI mock.
- UI 무변경(트리거 미러). typecheck+헬퍼 테스트+build:vite로 검증.

## PR5 — T2-1 UI
- FeaturedImageSlot 전면: "이 복장의 이미지들" 갤러리(다중 업로드+역할 드롭다운+primary 별표+드래그 재정렬+삭제, CostumeThumbCard 드래그 재사용). ContextMenu 이미지 단위 전환("primary 지정" 추가). CostumeThumbCard/CharacterCard는 primary(없으면 featuredImageUrl 폴백). 라이트박스는 최소변경(primary만 or 전체 스트립).

## PR6(백로그, 선택) — 정리
- updateCostumeField whitelist에서 featuredImageUrl/imageBackground/imageFit 직접쓰기 제거(트리거로 일원화).

## (최종 PR, 이번 스코프 밖) — B11 리깅 완료 슬랙 공지
- 한솔 웹훅 URL 받고 진행. 리깅 done 트리거 → 슬랙 + 앱내 공지.

---

## 로드맵 순서 (리스크 낮은 순)
PR1(T2-2) → PR2(T2-4) → PR3(T2-3) → PR4(T2-1 백엔드) → PR5(T2-1 UI) → [PR6 정리] → [B11 슬랙 최종]. 각 PR 머지 전 코덱스 리뷰 루프.

## 진행 로그
- 2026-07-08: 아키텍처 설계 완료(에이전트 조사). 코덱스는 머지된 #206 미리뷰(OPEN PR만) → Tier 2는 각 PR 열어 머지 전 코덱스 리뷰. PR1 착수 예정.
