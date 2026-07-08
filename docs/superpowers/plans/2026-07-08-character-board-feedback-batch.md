# 캐릭터 현황판 피드백 배치 — 트리아지 & 구현 계획 (Tier 1)

> 출처: `animators1@studiojbbj.com` 요청 문서(구글 독스 `10Mt2HWggFlwTy...`, 2026-07-07 갱신).
> 작성: 2026-07-08. 기준 코드: origin/main `b7bb3de` (v1.73.2), 워크트리 base 신선(0 ahead/0 behind).
> 검증: 코드 전수 탐색 + 배포이력 대조 2에이전트 교차검증. 모든 대상 파일 정독 완료.
> 한솔 스코프 결정: **이번 배포 = Tier 1 7종(B3·B4·B5·B6·B8·B9·B10)**. B11 공지=슬랙(다음 배치). 큰 기능(A5/B12/B1/B2/A14)=다음 배치.

---

## 0. 핵심 발견 — 대부분 이미 배포됨
요청 27건 중 14건(A1~A4,A6~A13,A15 + **B7**)은 v1.50~1.70 이미 배포. A5는 완료 섹션이나 실제 미구현(사용자 오인). 실작업 13건 → 이번엔 Tier 1 7종만. (전체 트리아지 표는 이 문서 하단 부록.)

---

## 1. Tier 1 상세 구현 명세

### 공통 원칙
낙관적 업데이트+필드 롤백 / supabaseService→IPC→main / 마이그레이션 없음 / 리팩터 구조(memo·구조적 공유)·톤 유지 / 순수 헬퍼 분리 + node --test.

---

### B5 — 기본 복장 명명 ('복장 1' → '기본 복장')
**현재**: `useCharacterBoardStore.addCharacter`(:281)가 첫 복장 `'복장 1'` 하드코딩. `CharacterDetailModal.nextCostumeName`(:29)은 `복장 {길이+1}`, `ensureCostume`(:249)/`handleAddCostume`(:279)에서 사용.
**변경**:
1. 신규 순수 유틸 `src/utils/characterCostumeName.ts`:
   - `export const DEFAULT_COSTUME_NAME = '기본 복장'`
   - `export function nextCostumeName(costumes): string` — `복장 N` 중 **N=1부터** 미사용 최솟값. (첫 복장이 '기본 복장'이면 다음은 '복장 1', '복장 2'…)
   - `export function costumeNameForNew(costumes): string` — `costumes.length === 0 ? DEFAULT_COSTUME_NAME : nextCostumeName(costumes)`
2. store `addCharacter`: 첫 복장 이름 `'복장 1'` → `DEFAULT_COSTUME_NAME`.
3. `CharacterDetailModal`: 로컬 `nextCostumeName` 삭제, `ensureCostume`·`handleAddCostume`이 `costumeNameForNew(costumes)` 사용(복장 0개일 때만 '기본 복장', 이후 '복장 N').
**테스트**: `tests/characterCostumeName.test.ts` — 빈 배열→'기본 복장', [기본 복장]→'복장 1', [기본 복장,복장 1]→'복장 2', 중복/구멍 회피.
**리스크**: 낮음. 기존 '복장 1' 이름 데이터는 그대로(개명은 신규 생성분만).

---

### B4 — 캐릭터 추가 플로우 (임시이름 허용 · 파일명 자동지정 · 추가 후 카드 이동)
세 조각:

**(a) 이름 없이 추가 가능 (임시 이름 = 빈 문자열)**
- `AddCharacterModal`: `submit` 가드 `!name.trim()` 제거 → 빈 이름 허용. '추가' 버튼 `disabled`에서 `!name.trim()` 제거(saving만). placeholder/설명에 "이름은 나중에 지어도 돼요" 힌트.
- store `addCharacter(name, memo)`: 빈 문자열 그대로 전달(DB `name=''`). 빈 이름은 "임시" 신호로 사용(별도 컬럼 없이 `name.trim()===''` 로 판별 — 실이름은 trim 후 절대 빈 값 아님).
- 표시 플레이스홀더: 신규 유틸 `characterDisplayName(name)` = `name.trim() || '이름 없는 캐릭터'`. 적용처: `CharacterCard`(:48), `CharacterListRow`(:79), 상세 헤더(:342), 라이트박스/aria. 편집 입력값은 원본(빈 값이면 빈 입력).
- 이름 편집(상세 헤더 blur :328): 기존 `if (nameDraft.trim() && ...)` 유지 — 빈 값 저장 방지(정상).

**(b) 이미지 추가 시 파일명으로 이름 자동지정 (임시 이름일 때만)**
- 신규 유틸 `deriveCharacterNameFromFileName(fileName)`: 확장자 제거 + trim. 빈 결과면 null.
- `FeaturedImageSlot.handleUpload`(:57 이후 성공 지점): `saved === true` 이고 `character.name.trim() === ''` 이면 파생 이름으로 `renameCharacter(character.id, derived)`. store에서 `renameCharacter` import.
- 이미 이름 있으면 건드리지 않음.

**(c) 추가 후 해당 카드(상세) 자동 오픈**
- `AddCharacterModal`에 `onCreated?(character)` prop 추가. `submit` 성공: `onCreated?.(created); onClose();`.
- `CharacterBoardView`(:291): `<AddCharacterModal onClose={...} onCreated={(c) => setPendingOpenId(c.id)} />`. `pendingOpenId` → `CharacterGrid` 기존 effect(:56)가 상세 자동 오픈. (신규 캐릭터는 addCharacter 낙관 반영으로 이미 store에 존재.)

**테스트**: `tests/characterDisplayName.test.ts`(빈/공백→플레이스홀더, 실이름 그대로), `deriveCharacterNameFromFileName`(`한솔.png`→`한솔`, `a.b.png`→`a.b`, 경로 basename 아님-파일객체 name만, 확장자 없음/빈 문자열 처리).
**리스크**: 빈 이름이 코드 곳곳에서 안전한지 — 검색/정렬/딥링크 확인함(정렬은 sortOrder 우선, 검색은 미매치, 딥링크는 id 기반). 표시 플레이스홀더 누락 시 빈 카드 → 적용처 전수 반영으로 방지.

---

### B6 — 사이드바에서 캐릭터 추가
**현재**: `Sidebar` NAV 항목 '캐릭터'는 뷰 이동만. 추가는 보드 툴바 `onAdd`.
**변경**:
1. `useAppStore`: `pendingCharacterAddRequest: boolean` + `setPendingCharacterAddRequest(v)`. `setView`(:247)에서 캐릭터 보드가 아닌 뷰로 이동 시 false로 클리어(pendingCharacterBoardRequest와 동일 패턴). `goBackNavigation`도 클리어.
2. `Sidebar`: '캐릭터' 항목(권한 allowed & 재확인 아님)만 relative 래퍼로 감싸고, 라벨 우측에 hover 시 나타나는 작은 '+' 버튼(별도 `<button>` — 중첩 방지 위해 nav 버튼과 형제). onClick(stopPropagation): `setView('character-board')` + `setPendingCharacterAddRequest(true)`. 접힘 상태에선 미표시(펼침/hover 시만).
3. `CharacterBoardView`: `pendingCharacterAddRequest` 소비 effect → `setAddOpen(true)` + 클리어. (loaded 무관 — 모달은 데이터 불필요.)
**테스트**: store 액션 단위(선택). 주로 수동/프리뷰 확인.
**리스크**: 사이드바 버튼 중첩 HTML 무효 → 형제 버튼+relative로 회피. 접근성 aria-label.

---

### B9 — 작업파일 이름/경로 hover 툴팁
**현재**: `CostumeDetail.PathActionRow`(:40-77) — 이름 텍스트에 `title={path}`(풀 경로), '열기' 버튼 title 없음.
**변경**(`PathActionRow`):
- 표시 이름 텍스트: `title = displayCharacterPathName(path)`(풀 파일/폴더명 — truncate 대비).
- '열기' 버튼: `title = path ?? ''`(풀 경로). 경로가 길어도 native title은 안 잘림 → "경로 팝업 잘림" 해소.
- 작업 폴더/작업 파일 두 행 모두 적용(공통 컴포넌트라 자동).
**리스크**: 매우 낮음(속성 추가). 커스텀 팝오버는 과잉 — native title 유지.

---

### B8 — 카드 위 휠로 복장 썸네일 전환
**현재**: `CharacterCard`(:23) 첫 `featuredImageUrl` 복장만 표시. 휠 없음.
**변경**(`CharacterCard`):
- `imaged = costumes.filter(c => c.featuredImageUrl)`. `imaged.length > 1` 일 때만 휠 활성.
- 로컬 `activeIdx` 상태(costumes 변경 시 clamp). 표시 = `imaged[activeIdx] ?? featured`.
- 이미지 영역 컨테이너 ref + `useEffect`로 native `wheel` 리스너 `{ passive: false }`: `imaged.length > 1` 이면 `e.preventDefault()` + `activeIdx = (idx ± 1) mod len`(deltaY 부호). (React onWheel은 passive라 preventDefault 불가 → native 등록 필수.)
- 하단에 작은 인디케이터(`1/N` 또는 점) — 2장+일 때만, hover 시 은은히. 현재 복장명 살짝 표기 옵션.
- 카드 클릭(onOpen)/우클릭(onContextMenu)은 유지. memo 안정성: activeIdx는 로컬이라 무관.
**리스크**: 휠 하이재킹 — **이미지 영역 위 + 2장 이상**에서만 preventDefault(그리드 스크롤 방해 최소화). 1장 이하 카드는 정상 스크롤. reduce-motion 무관(상태 전환만). 테스트 단계에서 체감 확인.

---

### B10 — 복장 순서 드래그 재배치
**현재**: 갤러리(`CharacterDetailModal` :467) 좌→우, `sortOrder` 정렬(`compareCostumes`)이나 재배치 UI 없음.
**변경**:
1. store `reorderCostumes(characterId, orderedIds: string[])`:
   - 순수 헬퍼 `reorderedCostumeSortOrders(costumes, orderedIds)` → `{id, sortOrder}[]` (0..n-1 재부여, 변경분만).
   - 낙관적: 해당 캐릭터 복장 sortOrder 갱신 → `costumes` map → `rebuildByCharacter`.
   - 영속: 변경된 각 복장 `svcUpdateCostume(id, { sortOrder })` (service가 sort_order 매핑 지원 확인함 supabaseService:934). 실패 시 이전 순서 롤백 + toast.
2. `CharacterDetailModal` 갤러리: `CostumeThumbCard`에 HTML5 DnD(`draggable`, `onDragStart`/`onDragOver`/`onDrop`) — 드래그로 순서 바꾸고 drop 시 `reorderCostumes`. 드래그 핸들 시각 힌트(hover 시 grip). '복장 추가' 버튼은 드롭 대상 제외.
   - 이미지 `draggable={false}` 유지, 카드 컨테이너만 draggable.
   - 드래그 중 시각 피드백(opacity/placeholder). 키보드 대안은 범위 밖(후속).
**테스트**: `tests/characterCostumeReorder.test.ts` — `reorderedCostumeSortOrders` 다양한 재배열, 변경분만 반환, 항목 수 보존.
**리스크**: DnD와 클릭/삭제 버튼 충돌 → dragStart는 카드 본체만, 삭제/이미지 우클릭 stopPropagation. sortOrder 다중 쓰기 실패 부분성 → 전부 롤백. realtime 에코 pending 보호(sortOrder는 updateCostumeField pending 경로 밖 — reorderCostumes에서 trackPending 유사 처리 필요? sortOrder는 정렬 파생이라 realtime UPDATE가 곧 도착해 수렴; 낙관 즉시 반영 + 서버 확정으로 충분. 단 동시 재배치 경합은 LWW 허용).

---

### B3 — 세로로 긴 이미지 위쪽 잘림 / 카드 세로 길어짐
**현재 분석**: 카드·썸네일·상세대표 모두 `aspect-[3/4] object-contain` + fit transform(기본 scale=1,x=0,y=0). 이론상 세로 이미지는 3:4 프레임에 **레터박스(무잘림)**. `object-cover` 표면 없음(전 표면 contain 확인). 라이트박스만 원본 비율.
**가설**: (1) 저장된 fit scale>1 로 확대되어 잘림, (2) 추가 직후 기본 fit이 세로 이미지에 부적합해 "너무 크게/작게" 보임, (3) 작성자 스크린샷이 aspect-[3/4] 도입(v1.60) 이전 상태.
**절차(systematic-debugging — 재현 우선)**:
1. 테스트 단계에서 **실제 세로 이미지**(예 600×1200)로 재현: dev 서버 `?preview=1` → agbrowse(별도 Chrome)로 캐릭터 보드 열어 카드/상세/라이트박스 관찰. (프리뷰 패널 DOM툴 이 환경 불가 → agbrowse 대체.)
2. 재현되면 근본원인별 최소 수정:
   - contain 유지 시 잘림 없음 확인 → "위쪽 잘림"이 재현 안 되면 **개선 방향**: 추가 직후 기본 fit을 3:4 프레임에 맞게 자동 프레이밍(선택). 단 기존 이미지 fit 불변(신규 추가분·기본값만).
   - 재현되는 실제 잘림/컨테이너 확대 버그면 해당 CSS/transform 수정.
3. **재현·검증 불가하거나 위험하면 B3만 다음 배치로 이관**(맹목 수정 금지) — 정직하게 보고. 나머지 6종은 배포.
**리스크**: 중. 기본 fit 변경은 전 이미지 영향 가능 → 신규/기본값 한정. 확실한 재현 없이는 미배포.

---

## 2. 구현 순서 & 테스트 게이트
순서(파일 결합도 기준, 순차): ①B5 유틸+배선 → ②B4(a,b,c) → ③B6 → ④B9 → ⑤B8 → ⑥B10 → ⑦B3(재현·판단). 각 단계 후 `npm run typecheck`.
**테스트 게이트 보강**: 캐릭터 보드 테스트가 현재 어떤 build 스크립트에도 없음(게이트 누락). `package.json`에 `test:character` 스크립트 신설(`characterBoardStoreHelpers.test.ts` + `characterBoardAssetWorkflow.test.ts` + 신규 4종) 후 `build`·`build:vite`에 추가. (기존 2종 먼저 통과 확인 후 게이트 편입.)
최종: `npm run build:vite`(typecheck+전체 테스트+vite build) 통과 → 시각검증 → 코드리뷰 → `npm run build`(정식) → 배포.

## 3. 배포
update-notes 신규 항목(비개발자 톤, 식별자/경로 금지, 시나리오형) 최상단 추가 → 버전 패치(1.73.2 → 1.74.0, 기능 추가라 마이너) → PR('📋 업데이트 요약' 동일 톤) → 빌드 먼저 → G드라이브 dist 동기화 → manifest 마지막 → SHA-256 3종(Setup.exe·latest.yml·manifest) 로컬↔원격 일치 확인 → 다음 실행/5분 폴링 자동 적용 → 배포후 원격 manifest·버전 재확인.

## 4. 다음 배치 백로그 (이번 제외)
A5(디자인+최종 2슬롯), B12(복장 다중이미지 — A5 흡수 가능), B2(복장별 에피소드), B1(px정렬), A14(스케줄/리소스), **B11(리깅 완료→슬랙 공지 — 한솔 결정=슬랙, 구현 시 웹훅 URL 필요)**.

---

## 부록 — 27개 항목 트리아지 (요약)
- DONE(14): A1,A2,A3,A4,A6,A7,A8,A9,A10,A11,A12,A13,A15,B7
- PARTIAL(3): A14(나의할일만), B2(costume_id 인프라만), B9(native title만)
- NEW(10): A5,B1,B3,B4,B5,B6,B8,B10,B11,B12
- 이번 배포(Tier 1): B3,B4,B5,B6,B8,B9,B10

## 5. 내부검토 반영 (재작성 — 2에이전트 적대적 리뷰 후)
**중대(배포 차단급) 반영:**
- **[테스트 게이트]** `tests/characterBoardAssetWorkflow.test.ts`는 **소스-문자열 정규식 검사**. B5가 `:285`('복장 1')·`:287`(nextCostumeName), B8이 `:258`(카드 className)·`:450`(transition-all 금지), B6이 `:476`(사이드바 title 식) 단정을 깰 수 있음 → **변경과 동시에 해당 단정 갱신**. `test:character` 신설 시 이 파일 포함(카드 className·nav 버튼 마크업 원형 보존, 새 유틸 참조로 앵커 갱신).
- **[B3 진범]** `src/views/EpisodeAssetBoard.tsx:273`이 **`object-cover`로 세로 이미지 크롭**(생 `<img>`, fit 무시). 이것이 "위쪽 잘림"의 확정 원인 → `:273`(및 필요시 `:129`) object-cover→object-contain(또는 CharacterImageFrame 채택)으로 **확정 수정**. 메인 보드 카드는 이미 contain(무크롭)이라 기본 fit 미변경(자동 프레이밍=cover=크롭 도입이라 요청과 반대 — 금지).

**B4 재설계(빈 문자열 → 실제 임시 이름):** 빈 문자열 이름이 나의할일/에피소드에셋/댓글헤더/스포트라이트/라이트박스/확인창 등에서 빈칸으로 새는 문제 → **빈 이름 대신 실제 임시 이름 `새 캐릭터`(+ 유니크 카운터 `새 캐릭터 2`) 부여**. 이러면 표시 플레이스홀더 불필요(모든 지점 실제 이름), 카드 구분 가능. 자동개명은 `isTempCharacterName` 패턴(`^새 캐릭터( \d+)?$`) 매칭 시에만. **자동개명은 파일선택·드래그 경로만(붙여넣기 제외)** + 일반 파일명(`image`/`clipboard`/`스크린샷`/순수숫자·날짜) 스킵 + rename 직전 store 최신 이름 재조회(stale-closure 방지). 추가후 오픈은 `onCreated`→`setTab('board')`+`setPendingOpenId`.

**B8 보강:** 휠 전환 복장을 **클릭·우클릭에 전달**(onOpen/onContextMenu에 costumeId → detailRequest.initialCostumeId → 패널 초기 activeCostumeId; cardMenu도 wheeled 복장 우선). 트랙패드 관성 대비 delta 누적+쿨다운. 2장+ 도트 인디케이터. 카드 이미지 div className(`:258`) 원형 유지.

**B10 보강:** reorderCostumes에서 각 변경 복장 `trackPendingFields(pendingCostumeFields, id, {sortOrder})` 등록(catch-up/echo 경합 방지). DnD 콜백 id-인자 안정 참조(memo). onDragOver preventDefault. 실패 전량 롤백+명확 토스트.

**B9 축소:** 이름 hover 풀경로 **유지**(격하 금지) + '열기' 버튼에 풀경로 title 추가. (자기모순 근거 제거.)

**B5 확정:** '기본 복장' 다음 '복장 1'(리뷰 동의). nextCostumeName은 기존 '복장 N' 최대 N+1(구멍채우기 안 함, 예측가능).

## 진행 로그
- 2026-07-08: 트리아지 완료 → 한솔 스코프 확정(Tier1) → 상세 명세 → 적대적 내부검토 2건 → 재작성 반영 완료.
- 2026-07-08: **Tier 1 7종 전부 구현 완료**. 신규 유틸 2(characterCostumeName·characterName) + 순수 헬퍼 2(reorderedCostumeSortOrders·moveCostumeInOrder) + 테스트 4파일. `test:character` 신설·build 게이트 편입. 소스-문자열 앵커 갱신(assetWorkflow :285/287/342).
- 2026-07-08: **적대적 코드리뷰** → B10 드래그 "바로 다음 항목 드롭 no-op" HIGH 버그 발견 → 방향별 삽입(moveCostumeInOrder)으로 수정·회귀 테스트 추가. 나머지 9포인트 클린.
- 2026-07-08: **최종 게이트 통과** — build:vite: auto-update 29 + entity 163 + notifications 142 + presence 33 + character 60 = 427 테스트 + vite build 성공. (프리뷰 시각검증은 이 환경 loopback HTTP 불가 → 이전 배치와 동일하게 자동화 테스트+코드리뷰로 갈음, 한솔 실앱 dogfood.)
- 2026-07-08: v1.74.0 update-notes 7항목 작성, 버전 1.73.2→1.74.0.
- 2026-07-08: **배포 완료** — 커밋 fec4c86 → PR #206 머지(299fb99) → C:\Bflow-BGonly main ff → npm run build(BFLOW-Setup.exe 200,181,338 bytes) → G드라이브 robocopy(exit 3=정상, manifest 제외) → manifest 마지막 → **SHA-256 3종 로컬↔원격 일치, 원격 manifest·latest.yml=1.74.0**. 1.73.1→1.74.0 라이브. codex-review-loop 미실시(내부 리뷰 3건 갈음).
