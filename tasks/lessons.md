# B flow — Lessons Learned

> 작업 중 배운 패턴, 실수, 개선사항을 기록한다.
> 세션 시작 시 반드시 검토할 것.

---

## 프로젝트 설정

### 2026-02-19: 초기 세팅

- **핵심 콘셉트는 "띄워놓고 작업"**: 슬랙 캔버스처럼 항상 켜두고 실시간 협업
  - Google Sheets가 단일 진실의 원천 (Single Source of Truth)
  - 체크박스 토글 → 낙관적 업데이트 → Sheets API → 다른 사용자 폴링으로 반영

- **데이터 저장 2층 구조**:
  - 작업 데이터 (체크박스, 씬, 에피소드): **Google Sheets** — 모든 사용자 공유
  - 개인 설정 (레이아웃, 테마): **%APPDATA%/Bflow-BGonly/** — 각 PC 로컬
  - ~~공유 드라이브에 users/ 폴더 만들기~~ → 불필요, AppData로 충분

- **AppData 활용**: Electron의 `app.getPath('userData')` 사용
  - Windows: `C:\Users\{사용자}\AppData\Roaming\Bflow-BGonly\`
  - `app.name = 'Bflow-BGonly'` 설정 필수

- **한글 경로 처리**: 배포 경로에 한글이 포함됨
  - `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly`
  - Node.js `path` 모듈 사용, 하드코딩 피하기, `{ encoding: 'utf-8' }` 명시

- **Bflow 원본**: 절대 수정하지 말 것. 참고 전용.
  - 위젯 시스템 참고: `react-grid-layout`, `ResponsiveGridLayout`
  - 상태 관리 참고: Zustand persist 패턴 (localStorage → AppData 파일로 교체)

### 2026-02-19: Electron + Vite 빌드 이슈

- **package.json에 `"type": "module"` 쓰지 말 것**
  - Electron은 CJS가 기본. ESM으로 하면 `__dirname` 미정의, preload 로딩 실패
  - `vite-plugin-electron`이 CJS로 빌드해야 `__dirname`이 자동으로 동작함
  - postcss.config.js, tailwind.config.js 모두 `module.exports` 사용 (ESM `export default` 아님)

- **빈 창 디버깅**: index.html에 로딩 표시 + 전역 에러 핸들러 유지
  - React 마운트 실패 시 하단 빨간 바에 에러 메시지 표시
  - `window.electronAPI` 없으면 방어적으로 처리 (preload 실패 대비)

- **실시간 동기화**: 폴링 대신 `fs.watch` 사용
  - 다른 사용자 변경 → 200ms debounce → IPC `sheet:changed` → 렌더러 리로드
  - 자기 쓰기 시 `ignoreNextChange` 플래그로 자기 반영 방지

---

## 규칙

1. **브런치명은 반드시 한글로** — 영어 브런치명 금지 (필수 요건)
2. **Bflow 원본 레포 수정 금지** — 읽기/참고만 가능
3. **작업 데이터는 Google Sheets에만** — 로컬에 작업 데이터 캐시하지 않음 (Sheets가 원본)
4. **개인 설정은 AppData에** — 공유 드라이브에 개인 데이터 저장하지 않음
5. **커밋 메시지 한글** — 변경 내용을 명확히 한글로 기술

---

## 실수 방지 체크리스트

- [ ] 작업 데이터를 로컬에 영구 저장하려 하진 않는가? (Google Sheets가 원본)
- [ ] 개인 설정을 공유 드라이브에 저장하려 하진 않는가? (AppData 사용)
- [ ] Google Sheets API 호출 시 에러 핸들링 있는가?
- [ ] 네트워크 실패 시 오프라인 큐잉 동작하는가?
- [ ] 낙관적 업데이트 실패 시 롤백 로직이 있는가?
- [ ] package.json에 `"type": "module"` 넣지 않았는가? (Electron CJS 필수)

---

## 2026-04-20: 낙관적 업데이트 × 인덱스 기반 ID 해석 — "엉뚱한 씬이 삭제됨"

### 증상
- 씬 삭제 시 고르지 않은 다른 씬이 삭제되거나 "씬 UUID를 찾을 수 없음" 에러
- 드래그 다중 선택 후 일괄 삭제 시 엉뚱한 씬 여러 개 삭제
- 씬 카드 클릭이 먹통 (여러 번 시도하면 동작)

### 근본 원인 — 순서 의존성
```ts
// 문제 패턴 (Before)
deleteSceneOptimistic(sheetName, sceneIndex);   // 1) 스토어 변경
await deleteScene(sheetName, sceneIndex);        // 2) 내부에서 resolveSceneUuid 가 "현재 스토어" 에서 인덱스 해석
//    → 이미 1)에서 스토어가 바뀌었으므로 엉뚱한 UUID 를 Supabase 로 보냄
```
배치 삭제는 더 나쁨: 낙관적 삭제 N개 → 배치 액션들이 실행 시점에 인덱스 해석 → 이미 축소된 배열에서 인덱스가 전부 밀려 **전혀 다른 씬들**이 Supabase 에서 삭제됨.

### 교훈 — "ID 를 먼저 캡처하고, 그 다음 낙관적 업데이트"
낙관적 업데이트와 원격 호출이 같은 스토어를 참조할 때:
1. **원격 호출에 필요한 식별자(UUID)는 낙관적 업데이트 *이전* 에 추출**해 둬라.
2. 원격 호출은 캡처된 UUID만 사용해야 한다. 스토어를 재조회하면 안 된다.
3. 배치 액션 빌더는 **인덱스가 아닌 UUID/영속 ID** 를 받아라 (`batchActions.deleteSceneByUuid(uuid)`).

### 적용 위치
- `src/views/ScenesView.tsx`: `handleDeleteSceneForSheet` 단일 삭제, 일괄 삭제 버튼
- `src/services/supabaseService.ts`: `batchActions.deleteSceneByUuid` 추가, `batchExecute` 에 새 케이스

### 부가 교훈 — 라쏘 선택 훅이 카드 클릭을 가로채지 않게
- 전역 `mousedown` 을 잡는 라쏘 훅은 mouseup 에서 "드래그 안 했으면 선택 초기화" 로직을 가지기 쉽다. 그런데 이게 **카드 내부 클릭**까지 가로채면 카드 onClick 이 먹통처럼 보인다.
- 해결: mousedown 시점에 `startedOnCard` 플래그를 저장해 두고, 카드 내부에서 시작된 클릭이면 라쏘 박스도 그리지 않고 선택 초기화도 하지 않는다.
- 임계값(8px → 10px) 상향도 손떨림에 유리.

### 실수 방지 체크리스트 (추가)
- [ ] 낙관적 업데이트 전에 원격 호출용 ID 를 변수로 캡처했는가?
- [ ] 배치 액션 빌더가 "인덱스" 를 캡처한 뒤 실행 시점에 재해석하는 구조라면, 낙관적 업데이트와 절대 섞지 마라 (UUID/영속 ID 시그니처로 교체).
- [ ] 전역 마우스 이벤트 훅이 카드/버튼의 클릭 이벤트를 silently 가로채고 있지는 않은가? (`startedOnCard` 플래그 패턴 검토)

---

## 2026-04-20: 병합 뷰(MergedScene) × 사용자 네이밍 변형

### 증상
- 전체 뷰에서 BG 의 `ac001` 과 ACT 의 `a001` 이 "같은 씬" 임에도 sceneId 가 달라 2 개의 분리된 카드로 노출.
- 상세 모달이 "BG 우선" 고정 로직 때문에 BG 만 단일 모달로 열려, BG+ACT 를 함께 편집 불가.

### 근본 원인
1. `mergedScenes` 빌더가 `sceneId` 완전 일치만 병합했다. 현실 데이터는 부서별로 접두사 컨벤션이 달라 완벽 일치가 깨진다.
2. `SceneDetailModal` 은 단일 `Scene` 전용 API 라서 양쪽 부서를 한 화면에 못 담았다. `UnifiedSceneCard` 더블클릭은 `bgScene` 이 있으면 BG 파트로 고정 라우팅.

### 교훈 — "뷰 레이어 병합은 정규화 키로, 데이터는 그대로"
- 사용자 입력에 어떤 접두사/자릿수 변형이 있든, **뷰에서는 정규화 키** (첫 숫자 그룹) 로 매칭하라. 2단계 매칭 (완전 일치 → 정규화 매칭) 으로 가장 보수적 동작 보장.
- 모달이 "단일 도메인" 을 전제하는 API 라면 억지로 확장하지 말고 **통합 전용 모달을 별도로 작성** 하라. 뷰 단에서 분기 (`selectedDepartment === 'all'`) 해서 렌더 모달을 다르게 하면 기존 단일 부서 UX 도 안전.
- 데이터 구조는 절대 건드리지 않는다. SSOT (BG/ACT 파트 분리) 는 유지하고 런타임 뷰만 병합.

### 적용 위치
- `src/utils/sceneIdKey.ts` (`normalizeSceneIdKey` 신규)
- `src/views/ScenesView.tsx` 의 `mergedScenes` 빌더 2단계화
- `src/components/scenes/UnifiedSceneCard.tsx` · `UnifiedSceneSheetView.tsx` 에 `onOpenMerged` 콜백 추가 (기존 `onOpenDetail` 폴백 유지)
- `src/components/scenes/UnifiedSceneDetailModal.tsx` 신규 (좌/우 분할, BG 전용 이미지 슬롯, 부서별 삭제 + 전체 삭제, merged 단위 네비, `+ 부서 추가`)

---

## 2026-04-20: 통합 뷰의 "한 씬 = 하나" 멘탈 모델 × 분리 저장 데이터

### 사용자 멘탈 모델
- **"1번 씬은 하나"** — 내부에 BG 담당자/체크박스와 ACT 담당자/체크박스가 같이 있는 한 덩어리.
- **댓글·리비전은 씬 단위로 하나**. BG 쪽에 달렸든 ACT 쪽에 달렸든 한 목록에 시간순.
- **이미지는 BG 전용**. ACT 전용 이미지 슬롯은 정책적으로 제거. 기존 데이터는 UI 에서 표시 안 함.

### 데이터 vs 뷰 정책
| 관점 | 데이터 (불변) | 뷰 (통합) |
|------|---------------|-----------|
| 씬 | BG 파트 · ACT 파트 별도 행 | `mergedScenes` 로 한 카드/한 모달 |
| 댓글 | `sheetName:sceneNo` 키로 부서별 분리 저장 | `CommentPanel` 의 `secondarySceneKey` 로 양쪽 조회 후 시간순 병합, `_sourceKey` 메타로 수정/삭제 원본 추적 |
| 리비전 | `EP:Part:sceneId` 키 (sheetName 의 부서 부분 제거) | **이미 공용 키** — 추가 작업 없이 RevisionPanel 그대로 재사용 |
| 이미지 | BG/ACT 각자 컬럼 | **BG 만 노출** — UnifiedSceneCard/SheetView 썸네일, SceneDetailModal 에서 ACT 일 때 이미지 섹션 숨김 |

### 교훈
- **사용자 멘탈 모델 ≠ DB 스키마**. DB 는 분리되어 있어도 UI/상호작용은 "하나"로 묶어야 할 수 있다. 뷰 레이어에서 우아하게 병합하는 게 SSOT 손상 없이 UX 를 맞추는 방법.
- 기존 컴포넌트(CommentPanel) 에 **"secondary key"** 같은 옵션 하나만 추가해도 통합 조회 + 원본별 수정/삭제가 가능. 신규 컴포넌트 두 개를 만드는 것보다 훨씬 유지보수 용이.
- "어디에 저장할지" 는 **primary 정책** (BG 우선) 로 못 박으면 사용자/개발자 모두 혼란 없음.

### 적용 위치 (2차 리팩토링)
- `src/components/scenes/CommentPanel.tsx` — `secondarySceneKey` 옵션 + `_sourceKey` 메타 기반 수정/삭제
- `src/components/scenes/UnifiedSceneDetailModal.tsx` — 레이아웃 재구성 (헤더 → 이미지 → 좌/우 → 하단 댓글/리비전 탭), 쿨다운 기반 중복 호출 방지
- `src/components/scenes/SceneDetailModal.tsx` — `department === 'bg'` 일 때만 이미지 섹션 렌더
- `src/components/scenes/UnifiedSceneCard.tsx` · `UnifiedSceneSheetView.tsx` — 썸네일/이미지 셀을 BG 전용으로 변경
- `src/views/ScenesView.tsx` — `onAddDept` 중복 체크, `handleSheetError` 에 `duplicate key` 사용자 친화적 메시지

---

## 2026-04-21: 모달 `click` 차단만으로는 부족함 — 배경 `mousedown` 리스너가 입력을 가로챔

### 증상
- ScenesView 에서 가끔 입력 모달이 첫 클릭에 포커스를 못 잡거나, 파트 우클릭 메뉴/메모 편집이 간헐적으로 불안정해 보임.

### 근본 원인
- 모달/컨텍스트 메뉴 패널은 `onClick={(e) => e.stopPropagation()}` 만 가지고 있었고, 배경의 드롭다운/셀렉트는 `document.addEventListener('mousedown', ...)` 로 외부 클릭을 감지하고 있었다.
- 그래서 **모달 안 클릭도 먼저 document `mousedown` 에 도달**해 배경 드롭다운이 닫히거나 상태를 바꾸고, 그 렌더가 입력 포커스/메뉴 상호작용과 충돌할 수 있었다.

### 교훈
- 바깥 클릭 닫기 로직이 `mousedown` 기반이면, 오버레이 패널 내부는 **`click` 뿐 아니라 `mousedown` 도 막아야 한다.**
- 우클릭으로 다른 메뉴를 여는 드롭다운은 기존 드롭다운을 즉시 닫아, 두 개의 팝업이 동시에 열린 상태를 남기지 마라.
- 전역 `keydown` 를 가진 드롭다운/팝업은 입력창(`input`/`textarea`/`select`/contenteditable) 에 포커스가 있으면 키를 가로채지 않게 해야 한다.

### 적용 위치
- `src/components/common/GlassDropdown.tsx` — 우클릭 컨텍스트 메뉴 시 즉시 닫기, 입력 필드 포커스 중 전역 키 처리 무시
- `src/components/ui/ContextMenu.tsx` — 패널 내부 `mousedown`/우클릭 전파 차단
- `src/views/ScenesView.tsx` — 파트 메모/에피소드 편집/일괄 편집/아카이브/에피소드 추가 모달 패널에 `onMouseDown` 차단 추가

---

## 2026-04-21: 통합 사이드바에서 "그룹 항목" 기능 누락

### 증상
- 씬 뷰 좌측 사이드바에서 파트를 우클릭했을 때, 개별 부서 모드에서는 되는데 전체 모드에서는 파트 메모가 안 뜨거나 일관되지 않음.

### 근본 원인
- 사이드바의 전체 모드는 `partId` 기준 그룹 행을 별도로 렌더링하고 있었는데, 이 그룹 행에는 `onContextMenu` 자체가 없었다.
- 파트 메모 로딩도 `현재 에피소드의 parts` 만 읽고 있어서, 사이드바에 보이는 다른 에피소드 파트 메모 상태와 어긋날 수 있었다.

### 교훈
- 개별 행과 그룹 행을 따로 렌더링할 때, "클릭/우클릭/배지/메모" 같은 상호작용을 한쪽에만 넣으면 전체 모드에서 조용히 기능이 빠진다.
- 사이드바처럼 여러 에피소드를 동시에 보여주는 UI 는 **선택된 항목 기준 로딩** 이 아니라 **현재 화면에 보이는 항목 기준 로딩** 으로 맞춰야 한다.
- 전체 모드의 그룹 항목에서 메모를 편집할 때는, 연결된 BG/ACT 파트들에 같은 메모를 같이 쓰는 정책이 가장 덜 놀랍다.

### 적용 위치
- `src/components/scenes/EpisodeTreeNav.tsx` — 그룹 파트에 우클릭/메모 표시 추가
- `src/views/ScenesView.tsx` — 파트 메모 타깃을 단일 sheetName 에서 다중 sheetNames 로 확장, 사이드바 표시 대상 전체 메모 로드
- `src/utils/partMemoHelpers.ts` — 그룹 파트 메모 합치기/동시 저장 헬퍼

---

## 2026-04-21: 큰 뷰 파일을 줄일 때는 "순수 규칙"과 "상태 오케스트레이션"을 먼저 분리

### 상황
- `ScenesView.tsx` 안에 통합 씬 계산, 파트 메모 로딩/저장, 상세 모달 동기화가 한 파일에 같이 들어 있어 읽기도 어렵고 수정 범위도 넓었다.

### 교훈
- 먼저 **순수 계산 규칙**을 유틸로 빼고 테스트로 고정한 뒤, 그 위에 **상태 훅**을 얹는 순서가 가장 안전하다.
- 이렇게 하면 구조는 정리되지만 사용자 동작은 그대로 유지할 수 있고, 회귀 테스트도 유틸 레벨에서 빠르게 돌릴 수 있다.
- 컴포넌트 파일에서 다른 컴포넌트 타입을 직접 끌어다 쓰기보다, 공용 타입/헬퍼 경계로 옮기는 편이 의존성이 덜 꼬인다.

### 적용 위치
- `src/utils/mergedSceneHelpers.ts` — 통합 씬 계산/상세 동기화 규칙 추가
- `src/utils/partMemoHelpers.ts` — 파트 메모 대상/표시 대상 계산 규칙 추가
- `src/hooks/useUnifiedScenes.ts` — 통합 씬 파생 상태 훅
- `src/hooks/usePartMemos.ts` — 파트 메모 로드/저장 훅
