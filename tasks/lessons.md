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

### 2026-04-21: 라이트 모드 표면 하드코딩 금지

- 라이트 모드 이슈의 대부분은 `rgba(26, 29, 39, ...)`, `#1E1E28`, `hover:bg-white/5` 같은 다크 전용 표면값 하드코딩에서 발생했다
- 토스트, 드롭다운, 툴팁, 상세 패널은 색을 직접 박지 말고 `bg-card`, `bg-border`, `text-*`, `glass` 계열 시맨틱 변수/유틸을 사용한다
- 라이트 모드에서 흰 카드 위 보조 표면은 `bg-primary`보다 `bg-card/70` 또는 `bg-border/저알파`가 더 자연스럽다
- 전역 배경 강도는 다크 기준 값을 라이트 모드에 그대로 재사용하면 씬 뷰처럼 회색 막이 낀다. 배경 그라데이션 강도는 색상 모드별로 분기해야 한다
- 1차 수정 뒤에는 보이는 화면만 끝내지 말고 `calendar/*`, `tooltip`, `side panel`, 미사용 후보 컴포넌트까지 색상 하드코딩을 grep으로 재점검해야 한다. 이번 누락은 `EventQuickEdit`, `EventSidePanel`, `MiniCalendar`, `EventCreateTooltip`이 그 단계에서 빠진 탓이었다
- 완료 축하 오버레이는 페이지 전체가 아니라 실제 콘텐츠 캔버스에만 씌워야 한다. 그래야 상단 필터/액션 버튼은 건드리지 않으면서도 화면 안에서 몰입감 있는 연출을 만들 수 있다
- 성취 메시지는 오버레이에 실어도 되지만, 완료자/완료 시각 같은 메타 정보는 상단 고정 카드에 계속 남겨야 사용자가 나중에 다시 확인할 수 있다
- 낙관적으로만 채운 완료 메타(`completedBy`, `completedAt`)는 다음 동기화에서 바로 사라진다. 축하 연출에 쓰이는 데이터라도 이후 화면에 남겨야 한다면 토글 직후 별도 필드 업데이트까지 함께 저장해야 한다
- 씬 뷰의 접기/펼치기 상태처럼 사용자별 선호가 갈리는 UI 상태는 전역 스토어보다 `preferences.json`에 context key(에피소드/파트/부서)로 저장하는 편이 재진입 경험이 안정적이다
- 드롭다운 잘림을 전역 포털로 우회하면 클릭/포커스 버그가 새로 생길 수 있다. 사용처가 제한된 경우에는 먼저 부모 래퍼의 `overflow`와 z-index를 바로잡고, 컴포넌트 자체는 단순한 로컬 레이어링을 유지하는 편이 안전하다

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

## 2026-05-08: TypeScript 백틱 안의 PowerShell 변수는 `${...}`로 쓰지 말 것

### 증상
- 자동 업데이트 토스트와 pending 다운로드는 성공했지만, `지금 업데이트` 클릭 후 앱만 종료되고 새 버전으로 교체되지 않았다.
- `%LOCALAPPDATA%\Bflow-BGonly\.swap-attempted`는 생겼지만 `swap.log`에 `[main] spawnSwapHelper start`조차 남지 않았다.

### 근본 원인
- `helperSwap.ts`의 PowerShell helper 스크립트가 TypeScript 백틱 문자열 안에 들어 있는데, PowerShell 변수 `$stepName`을 고치면서 `${stepName}`으로 작성했다.
- `${stepName}`은 PowerShell 문법이 아니라 JavaScript 템플릿 보간으로 먼저 평가된다. 런타임에 `stepName` JS 변수가 없어 `ReferenceError`가 발생했고, helper script 생성/earlyLog/spawn까지 도달하지 못했다.
- 기존 `tsc --noEmit`은 `src`만 검사해서 `electron/**` 타입 오류를 잡지 못했다.

### 교훈
- PowerShell 스크립트를 TypeScript 백틱 안에 넣을 때는 PowerShell 변수 보간을 `$($stepName)`처럼 쓴다.
- Electron main 코드 변경은 `npm run typecheck`로 `src`와 `electron`을 모두 검사해야 한다.
- 토스트 감지나 `.ready` 생성은 업데이트 성공이 아니다. 성공 판정은 다음 실행 버전, `.swap-attempted` 정리, `swap.log`의 `[main]`/`[helper]` 로그로 한다.
- 수동 설치로 현재 버전이 pending 버전보다 높아진 경우, 남은 `.ready + .swap-attempted`는 현재 버전 실패가 아니라 오래된 실패 찌꺼기다. 이때 `.swap-suppressed`를 현재 버전으로 쓰면 다음 업데이트 감지를 막는다.

### 적용 위치
- `electron/autoUpdate/helperSwap.ts` — `${stepName}` → `$($stepName)` 수정
- `tests/autoUpdateHelperSwap.test.ts` — 같은 회귀를 잡는 테스트 추가
- `electron/autoUpdate/failurePolicy.ts` — 수동 설치 후 오래된 pending 실패 상태 판별
- `package.json`, `tsconfig.node.json` — Electron main 타입체크와 자동 업데이트 회귀 테스트를 빌드 경로에 포함

---

## 2026-05-08: 실행 중 앱 폴더를 직접 swap하지 말고 installer를 실행할 것

### 증상
- `v1.22.12 → v1.22.13`에서 helper 실행 자체는 성공했지만, `bflow` 폴더를 `bflow-backup`으로 옮기는 단계가 실패했다.
- rename 실패 후 copy fallback이 몇 초 이상 걸리고, 결국 앱은 재시작되지 않았다.

### 근본 원인
- Windows/Defender/인덱서가 실행 직후 앱 설치 폴더를 잠깐 잡으면 directory rename/copy가 예측 불가능해진다.
- 앱 폴더를 직접 갈아끼우는 구조는 hotfix가 잦은 팀 배포에서 실패 비용과 대기 시간이 크다.

### 교훈
- Electron/NSIS 배포에서는 이미 만들어지는 `BFLOW-Setup.exe`를 업데이트 적용 단위로 삼는 편이 안전하다.
- 앱은 G드라이브에서 installer를 로컬 `installer-pending`으로 받아두고, 적용 시 앱 종료 후 installer helper가 `/S`로 실행한다.
- installer helper는 현재 BFLOW 프로세스가 완전히 종료된 뒤 installer를 실행해야 한다. helper를 띄웠다는 이유만으로 바로 `BFLOW-Setup.exe`를 시작하면 실행 중 앱 파일 잠금과 다시 충돌한다.
- 배포용 manifest는 `BFLOW-Setup.exe`가 있을 때만 생성해야 한다. installer 없는 manifest는 모든 클라이언트에게 쓸 수 없는 최신 버전을 알리는 사고가 된다.
- 사용자가 버튼을 누른 뒤 아무 화면도 없으면 실패처럼 느낀다. renderer는 `applying` 상태를 먼저 표시하고, 앱 종료 후 helper는 별도 진행 창을 띄워야 한다.

### 적용 위치
- `electron/autoUpdate/checker.ts` — win-unpacked mirror 대신 installer 캐시 다운로드
- `electron/autoUpdate/installerApply.ts` — installer helper + 진행 창 + 재실행
- `src/components/update/UpdateCenterModal.tsx` — 다운로드 진행률/적용 중 상태 표시
- `tests/autoUpdateInstallerFlow.test.ts` — win-unpacked swap 회귀 방지

---

## 2026-05-08: UI가 펼치기를 지원해도 manifest가 잘라내면 과거 내역은 안 보인다

### 증상
- 업데이트 모달에는 "이전 업데이트 내역 보기" UI가 있었지만, 실제 배포 manifest에는 최신 3개 release note만 들어갔다.
- 결과적으로 모달의 펼치기 기능이 있어도 사용자는 오래된 버전 내역을 볼 수 없었다.

### 근본 원인
- `UpdateCenterModal.tsx`는 `releaseNotes` 배열 전체를 펼칠 수 있게 만들었지만, `scripts/generate-manifest.js`가 `DEVLOG/update-notes.json`을 읽을 때 `.slice(0, 3)`으로 잘라냈다.
- UI 요구사항과 배포 데이터 생성 규칙을 같이 검토하지 않아 생긴 불일치다.

### 교훈
- 버전 모달처럼 manifest 데이터를 표시하는 UI를 바꿀 때는 `DEVLOG/update-notes.json` → `scripts/generate-manifest.js` → `dist/manifest.json` → renderer 표시까지 전체 파이프라인을 확인한다.
- `DEVLOG/update-notes.json`의 과거 항목은 앱에서 펼쳐 보는 사용자 기록이다. 삭제하지 말고, manifest 생성에서도 자르지 않는다.
- 자동 업데이트 관련 최신 운영 기준은 `DEVLOG/AUTO_UPDATE_OPERATIONS.md`를 우선한다. 옛 plan/spec의 directory swap 설명은 역사 기록이다.

### 적용 위치
- `scripts/generate-manifest.js` — releaseNotes 전체 이력 보존
- `tests/autoUpdateInstallerFlow.test.ts` — manifest 생성기가 releaseNotes를 최신 3개로 자르지 않는 회귀 테스트
- `DEVLOG/AUTO_UPDATE_OPERATIONS.md` — 현재 운영 기준 문서

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

---

## 2026-04-21: 통합 뷰에서는 "표시용 ID" 와 "내부 고유 키"를 절대 같은 값으로 쓰지 말 것

### 증상
- 통합 씬 번호를 `a001` 같은 공통 번호로 정규화한 뒤, 같은 숫자를 가진 레거시 씬(`a001`, `v2a001`)이 한 뷰 안에 같이 있을 때 벌크 토글/선택/React key가 서로 덮였다.
- 공용 리비전은 부서 라벨 없이 저장해야 하는데, Supabase 쪽 `part_uuid` 역조회는 실제 부서 정보가 필요해 ACT-only 파트에서 실패할 수 있었다.

### 교훈
- 사용자가 보는 번호(`sceneId`)는 **표시용** 으로만 두고, 선택/맵/React key/벌크 동작은 반드시 별도 내부 키(`mergedKey`)를 써라.
- "공용 데이터" 와 "저장 경로를 찾기 위한 힌트" 는 분리하라. 공용 리비전이라도 DB의 part UUID 를 찾기 위한 `lookupDepartment` 는 따로 전달해야 한다.

### 적용 위치
- `src/utils/mergedSceneHelpers.ts` — `mergedKey` 추가, 벌크 토글/상세 동기화에 내부 키 사용
- `src/views/ScenesView.tsx`, `src/components/scenes/UnifiedSceneCard.tsx`, `src/components/scenes/UnifiedSceneSheetView.tsx` — 선택/라쏘/React key를 `mergedKey` 기준으로 전환
- `src/services/revisionService.ts`, `electron/preload.ts`, `electron/main.ts`, `electron/supabase.ts`, `src/views/CompositingView.tsx` — 공용 리비전은 유지하면서 part UUID 역조회용 `lookupDepartment` 분리

---

## 2026-04-21: 씬번호 정규화 규칙은 병합/리비전/lookup 전부가 같은 헬퍼를 써야 한다

### 증상
- `ac001` 과 `a001` 을 같은 씬으로 보이게 하려고 끝자리 숫자만 보는 규칙을 여러 파일에 각각 넣었더니, `v2a001` 같은 버전형 ID 까지 `a001` 과 같은 씬으로 잘못 묶였다.
- 그 결과 전체 뷰 병합은 하나로 붙고, 리비전은 분리되거나, 반대로 이미지 fallback / 반대 부서 찾기에서 다른 씬을 잘못 집는 식으로 규칙이 서로 어긋났다.

### 교훈
- "같은 씬으로 취급할 수 있는 ID" 규칙은 한 곳에서만 정의하라.
- 그 규칙은 **숫자만 있는 ID**, **파트 접두사만 붙은 ID(`a001`, `ac001`)** 는 같은 씬으로 보고, **버전/별칭 접두사가 섞인 ID(`v2a001`)** 는 별도 씬으로 남겨야 한다.
- 표시용 씬번호, 전체 뷰 병합, 반대 부서 lookup, 공용 리비전 키가 서로 다른 정규화 규칙을 쓰면 같은 버그가 다른 형태로 반복된다.

### 적용 위치
- `src/utils/sceneIdKey.ts` — part-aware 씬 정규화/표시 ID 규칙 단일화
- `src/utils/mergedSceneHelpers.ts` — unmatched 병합과 통합 표시 ID 생성에 공용 규칙 사용
- `src/utils/revisionSceneKey.ts` — 리비전 키도 동일 규칙 재사용
- `src/views/ScenesView.tsx` — ACT 이미지 fallback, 반대 부서 씬 찾기 lookup 도 동일 규칙 사용

---

## 2026-05-23: 컴포지팅 대시보드 v1.30.0 시리즈 (PR 1~4)

### CSS 토큰 형태가 두 종류 섞여 있으면 함수 사용법이 갈린다

`--color-accent: 108 92 231` (RGB triplet) 과 `--part-a: #FF9F43` (full hex) 가 한 파일에 공존한다.
- triplet 은 `rgb(var(--color-accent) / 0.5)` 식 wrap 필요. 그냥 `var(--color-accent)` 은 invalid color.
- hex 는 `var(--part-a)` 그대로 color/border/color-mix() 슬롯에 사용 가능.
- 헬퍼(`partCssColor()`)를 두고 fallback 도 같은 형태(완성된 color 값)로 반환하게 통일. 코덱스가 이 함정을 3 라운드에 걸쳐 잡아냄.

### framer-motion `Reorder` 는 스크롤 컨테이너 안에서 측정값이 흔들린다

부모가 `overflow-y-auto` 면 Motion docs 가 unsupported 케이스로 명시. 스크롤 위치 변동 시 drag 좌표 drift.
- 대안: HTML5 native drag-drop (`draggable` + `onDragStart/Over/Drop`). edge auto-scroll 도 브라우저 기본.
- `splice(from, 1)` 후 `to` 인덱스 시프트 주의 — `from < to` 면 `to - 1` 로 조정.

### 모듈 스코프 캐시 + 리스너 패턴 — 여러 카드가 같은 partUuid 데이터를 공유

씬 카드 50개가 같은 partUuid 의 댓글 카운트를 보여줘야 할 때, 카드마다 fetch 하면 N 번 호출. 대신:
- 모듈 스코프 `Map<partUuid, Cache>` + `Map<partUuid, Set<listener>>`
- `fetchPartComments(partUuid)` 가 `shouldRefetch()` 로 dedupe (stale/error/done 상태 + 마지막 fetch 시각)
- 각 카드 hook 은 `useEffect` 안에서 listener 등록 + cleanup
- mutation 시 `invalidateCommentCountForPart()` 호출로 즉시 갱신, 또는 60s 주기 stale refresh + visibilitychange.

### 단일 lookup 출처 — 두 경로가 어긋나면 댓글이 가끔 안 불러와진다

`buildCardScenes(ep)` 가 한 번에 sheetName/partUuid/sceneIndex 를 다 계산해 `CardScene` 에 박는다.
상세 모달은 그 `CardScene` 의 필드만 읽고, 다시 `ep.parts` 를 들여다보지 않음 — 두 lookup 결과가 어긋날 여지 자체를 차단.

### useEffect deps 가 over-fire 하는 함정

- "EP 가 바뀔 때만 reset" 의도였지만 deps 에 `partGroups.map(...).join(',')` 추가하니 reorder 시에도 발화.
- partGroups 의 useMemo deps 가 episodeNumber 를 이미 포함하면, effect deps 는 `[episodeNumber]` 만으로 충분.
  closure 가 새 render 의 최신 partGroups 를 자동으로 본다.

### 낙관적 업데이트 + Realtime + Rollback 의 race

같은 씬에 두 사용자가 거의 동시에 다른 단계로 바꾸면:
1. 로컬 낙관적 업데이트 → Supabase 저장 시도
2. 그 사이 다른 사용자의 Realtime broadcast 가 도착 (더 최신 updatedAt)
3. 내 저장이 실패해서 rollback 시 — `prev` 로 덮으면 더 최신 Realtime 값을 잃음
**Fix**: rollback 전에 `current.updatedAt > prev.updatedAt` 비교. 더 최신이면 rollback skip.

또한 빠른 연속 클릭 시 응답이 out-of-order 도착 → 오래된 응답이 최신 값을 덮음:
**Fix**: 씬별 monotonic `sceneSeq` 카운터로 stale 응답 차단.

### update-notes 비개발자 톤 룰의 가치

`PostgREST`, `IPC`, `Tailwind` 같은 용어는 비개발자 매니저가 읽으면 무의미. "X 상황 → Y → Z" 시나리오로 풀어 쓰면
슬랙 그대로 공유 가능. 한솔 본인이 팀에 안내할 때 그대로 쓸 수 있어야 한다.
파일경로/컴포넌트명/IPC 채널명 노출 금지. PR 본문의 '📋 업데이트 요약' 섹션에도 같은 룰 적용.

### 코덱스 리뷰 루프의 실용성

PR #116 에서 12 라운드 (P1×3, P2×6, P3×2) 끝에 silent-done. Monitor 폴링으로 라운드 사이 idle 토큰 소모 거의 없음.
- 같은 P3 (`partCssColor` 폴백) 가 3 라운드에 걸쳐 다른 파일에서 다시 나옴 — 헬퍼 도입 후엔 호출처를 모두 한 번에 일관시킬 것.
- silent-done 신호: 새 코멘트 0 + 트리거 코멘트의 👀 반응 사라짐. 30분 응답 없으면 머지 게이트로 전환 OK.

### 적용 위치
- `src/utils/compositingLabels.ts` — `partCssColor()` 헬퍼 + `isCompositorForCompositing()` + `isCompletedStatus()`
- `src/views/compositing-dashboard/cardSceneHelpers.ts` — buildCardScenes 단일 lookup
- `src/views/compositing-dashboard/useCommentCount.ts` — 모듈 스코프 캐시 + listener 패턴 + stale refresh
- `src/views/compositing-dashboard/compositingActions.ts` — sequence guard + rollback skip
- `src/views/compositing-dashboard/timeline/TimelinePanel.tsx` — HTML5 native drag-drop

---

## 구현 계획의 "배선" 단계를 UI 재작성 중 누락 (2026-06-18, 리테이크 허브 2단계)

증상: `sideBarColorClass` 유틸 + index.css 4색 클래스 + node 테스트를 다 만들고 RevisionPanel 에 import 까지 했으나, 정작 카드 렌더에서 `sideBarColorClass(...)` 호출을 빠뜨려 좌측 4색 막대가 죽은 코드가 됨(계획 Step 2=import 는 했고 Step 4=배선을 건너뜀). `noUnusedLocals: false` 라 typecheck/build 모두 통과 → 6차원 심층 코드리뷰가 4회 중복으로 잡아냄.

교훈:
- 계획의 각 Step(특히 "기존 X 를 Y 로 교체")을 끝까지 추적. 유틸을 만들면 "import 했다"가 아니라 "호출처가 실제 렌더에 도달한다"까지 확인.
- 새 유틸/상수 추가 후 `grep` 으로 호출 0건(=import만 있고 미사용)이 아닌지 검증 — 배선 누락의 신호.
- UI 시각 요소는 typecheck 가 못 잡는다(noUnusedLocals=false, ESLint 빌드 미포함). 멀티에이전트 리뷰 또는 preview 로 별도 검증.
- 좋았던 패턴: 표현 컴포넌트를 store 비종속 props 기반으로 분리하면 카드/허브 양쪽 재사용 + 단위 테스트 + 리뷰가 쉬워진다.

---

## 2026-07-11: 승인 목업이 Git 밖에 있으면 구현 계획에서 시각 구조가 사라질 수 있다

### 증상

- 사용자가 승인한 배플레이그라운드 v3 목업에는 대형 게임 hero, 포인트 랭킹 레일, JBBJ 하우스 팀 챌린지가 있었지만 실제 구현은 중앙 추천 카드와 일반 카드 목록으로 축약됐다.
- 기능 이름과 이동 테스트는 모두 통과했지만 화면은 승인 목업과 크게 달랐다.

### 원인

- 최종 목업이 `.superpowers/` 아래에 있어 `.gitignore` 대상이었고 feature worktree와 구현 담당 에이전트가 원본을 보지 못했다.
- 구현 계획이 원본의 정보 계층·비율·아트·밀도를 명시하지 않고 문구 순서만 새로운 요구사항으로 고정했다.
- 테스트가 텍스트 존재만 확인하여 로컬 헤더, 2열 구조, hero, ranking rail 누락을 감지하지 못했다.

### 교훈

- 사용자가 승인한 최종 시각 목업은 구현 전에 반드시 Git이 추적하는 `docs/` 경로로 복사해 source of truth로 남긴다.
- UI 계획은 문구뿐 아니라 주요 영역, 열 비율, 정보 밀도, 전환 규칙, 반응형 붕괴 지점까지 acceptance criteria로 기록한다.
- 구현 후에는 현재 화면만 보는 것이 아니라 승인 목업과 1440·1024·390px 화면을 직접 나란히 비교한다.
- 구조 검증 테스트는 핵심 layout anchor와 상호작용 계약을 실행 가능한 형태로 확인하고, 텍스트 존재 테스트만으로 시각 완료를 판단하지 않는다.
