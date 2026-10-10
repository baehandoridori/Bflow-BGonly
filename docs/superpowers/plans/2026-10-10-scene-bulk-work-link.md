# 씬 대표 파일 한꺼번에 연결 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬의 대표 파일을 연결하거나 바꾸는 저장이 성공한 바로 뒤에, 같은 파일을 쓸 다른 씬(파일 이름에 번호가 적힌 씬, 연결한 씬과 레이아웃 번호가 같은 씬)을 찾아 체크 목록 창으로 묻고, 고른 씬에 한꺼번에 연결한 뒤 10초 '되돌리기'를 준다 — v1.134.0. 운영 DB·IPC·미리보기 mock은 바꾸지 않는다. 함께 넣는 것 셋: 링크 행이 한꺼번에 바뀔 때 main의 표 다시 읽기와 감지기 초기화를 한 번으로 모으기, 새 창(위젯)이 링크 행 신호에 자료를 통째로 다시 받지 않게 하기, 경로 붙여넣기 칸의 겹친 Enter 막기.

**Architecture:** 판정은 모두 React·DOM 없는 순수 모듈 둘에 두고 `node --test`로 값을 고정한다 — 파일 이름을 읽는 규칙(`sceneFileNameList.ts`: "틀린 목록을 내느니 묻지 않는다")과 대상·상태·실행 계획·되돌리기 계획·문구(`sceneBulkWorkLink.ts`). 창은 `ConfirmDialog`와 같은 "호스트 하나 + 부르는 객체 하나"이고 네이티브 `<dialog>`를 `showModal()`로 띄운다(호스트는 `App.tsx`에 하나). 제안은 `saveWorkLinkPathGuarded`의 성공 줄 뒤 한 곳에서만, 대표 파일일 때만, 기다리지 않고 시작한다. 실행과 되돌리기(`sceneBulkWorkLinkActions.ts`)는 저장소 액션(`loadForSceneUuids`·`upsertLink`·`deleteLink`)만 부른다 — 상태를 매기기 전에 읽고, 누르는 순간과 되돌리는 순간에 다시 읽고, 다시 읽지 못했으면 쓰지 않는다. 바꿀 수 있는 값은 상수 둘(`SCENE_NAME_RULES`, `BULK_LINK_DEFAULTS`)이고 부르는 코드는 그 값을 넘기지 않는다. main은 링크 행 신호를 순수 도우미 `createTrailingDebounce`로 모은다(렌더러로 가는 행 신호는 모으지 않는다).

**Tech Stack:** Electron 33(Chromium 130) · React 18 · TypeScript · Tailwind CSS · Zustand · sonner · node:test(Node 22 type-stripping) · Vite

---

## 모든 Task 공통 규칙

- **작업 위치**: `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`, 브랜치 `claude/scene-bulk-work-link`(= main v1.133.0, 70d9bfb2 위). 다른 워크트리·상위 checkout은 건드리지 않는다.
- **계약은 설계 문서다**: `docs/superpowers/specs/2026-10-10-scene-bulk-work-link-design.md`(아래 "설계"). 머리말의 용어(대표 파일·칸·연결한 씬·창·이름 묶음·레이아웃 묶음·가족·자기 번호·다른 씬들의 목록)와 각 Task의 **Read first**에 적힌 절을 먼저 읽는다. 설계에 적히지 않은 동작은 만들지 않는다. 이 계획과 설계가 어긋나면 설계가 맞다 — 멈추고 보고한다. **설계의 코드 블록·한글 문구·표의 값은 글자(띄어쓰기·주석 포함) 그대로 옮긴다. 설계에 없는 주석을 더하지 않는다** — Task 11의 앵커가 새 파일을 주석째 글자로 읽는다(`sceneBulkWorkLinkActions.ts`에는 `sceneWorkLinkActions`·`saveWorkLinkPathGuarded`·`chooseAndLinkWorkPath`·`electronAPI`·`supabase`라는 글자가, `BulkWorkLinkDialog.tsx`에는 `title=`·`truncate`·`'Enter'`·`electronAPI`·`supabase`가, `reloadLinks` 본문에는 둘째 `true`가, `trailingDebounce.ts`에는 `import`라는 글자가 주석으로도 있으면 안 된다).
- **한솔의 답(2026-10-10)은 이미 설계에 들어 있다**: P1 `SCENE_NAME_RULES.tildeRange: true`(물결표 범위를 읽는다. 스튜디오는 파일 이름에 물결표를 쓰지 않아 드물게 만나는 길이다 — 설계대로 두고 더 키우지 않는다) · P2 `BULK_LINK_DEFAULTS.checkNamedReplace: true` · P3 `offerLayoutOnly: true`·`checkLayoutOnly: false` · **P4 `requireOwnNumber: false`**("물어보기" — 글자가 맞고 번호가 둘 이상인 목록은 연결한 씬의 번호가 없어도 읽는다. 글자 없는 목록과 번호가 하나뿐인 이름은 여전히 자기 번호가 있어야 한다). 답을 기다리는 문턱은 없다. 답이 없는 물음 둘(꼬리표 꼴 "A_BG_001,003", 파트를 넘는 레이아웃 번호)은 지금 규칙대로 나가는 후속 항목이다 — 그 둘을 위한 코드를 만들지 않는다.
- **줄 번호**: 설계의 `:55-64` 같은 번호는 main v1.132.1(b3ca096e)에서 잰 것이다. 씬·작업 링크·저장소·electron·테스트 스크립트의 줄은 v1.133.0에서도 같지만 Task가 지나면 밀린다 — **인용한 코드로 찾는다**(Grep). 달라진 것은 버전 줄뿐이다: `package.json`의 `version`과 `DEVLOG/update-notes.json`의 첫 항목이 `1.133.0`이다.
- **명령**: 테스트 파일 하나 `node --test tests/<file>.test.ts` · `npm run typecheck` · `npm run test:scene-links`(Task 1이 만든다) · `npm run test:presence` · 전체 게이트 `npm run build:vite`(typecheck → 모든 테스트 스크립트 → `vite build` → 개발용 manifest). 시작 기준: `npm run test:presence` **tests 38 / fail 0**, `node --test tests/sceneWorkLinks.test.ts tests/sceneWorkLinkCardBadges.test.ts` **tests 10 / fail 0**(이 둘은 아직 어느 스크립트에도 없다). **매 Task 끝에 셋을 모두 돌린다** — `npm run typecheck` 오류 없음, `npm run test:scene-links` fail 0, `npm run test:presence` fail 0(감시 테스트와 모으기 테스트는 `test:presence`에서만 돈다). 기대: 테스트 수가 직전보다 많거나 같고 fail 0. 수와 실패는 출력 끝의 요약 줄로 본다 — 파이프·파일로 받으면 `# tests N`·`# fail 0`, 터미널에 바로 찍으면 `ℹ tests N`·`ℹ fail 0` 꼴이다.
- **테스트 규칙(Node type-stripping)**: `.ts` 확장자를 붙인 상대 import, 지울 수 있는 TypeScript만(enum·namespace·`satisfies`·매개변수 속성 금지), 경로 별칭(`@/`) 금지. 타입은 반드시 `import type { … }` — 타입 제거 실행에서는 `import { 타입 }`이 지워지지 않아 `does not provide an export named …`로 파일 전체가 실패한다. 새 순수 모듈(`src/utils/sceneFileNameList.ts`·`sceneBulkWorkLink.ts`·`electron/presence/trailingDebounce.ts`)도 같은 규칙이다. `.tsx`·서비스 파일에서 그 모듈을 import할 때는 설계대로 `@/utils/sceneBulkWorkLink`처럼 확장자 없이 쓴다. **`npm run typecheck`는 새 테스트 파일을 검사하지 않는다**(tsconfig의 include는 `src`·`electron`·`tests/playground*.test.ts`) — 테스트의 실수는 실행으로만 드러난다. **각 Task의 테스트는 그 Task까지 생긴 이름만 import한다.**
- **테스트 먼저**(@superpowers:test-driven-development): 실패하는 테스트 → 구현. 없는 모듈을 import한 테스트 파일은 `ERR_MODULE_NOT_FOUND`로, 없는 export는 `SyntaxError: The requested module … does not provide an export named '…'`로 **파일 전체가** 실패한다 — 그것이 기대하는 실패다. 화면과 배선(Task 6·7·8·10)은 순수 테스트로 잡을 수 없으므로(설계 11.6 끝: 창을 띄우는 테스트는 두지 않는다) Task 끝의 **자가 점검(grep)** 으로 조각이 글자 그대로 있는지 보고, Task 11의 앵커가 고정한다. 자가 점검의 "N곳"은 나타난 횟수다: `grep -oF '<조각>' <파일> | wc -l`.
- **소스를 글자로 읽는 테스트**: 기존 소스는 작업 트리에서 CRLF다. 읽은 뒤 `\r\n`을 `\n`으로 맞추고, 표지·정규식에 줄바꿈 글자를 넣지 않고, 찾는 표지가 있음을 먼저 단언한다. '없음'을 보는 검사는 표지를 단언한 조각에만 건다.
- **하지 않는 것**: dev 서버·Electron·미리보기 창을 띄우지 않는다(`npm run dev*`, `npm run preview:electron`, `npm run electron:dev`, `npm run build` 금지 — `npm run build:vite`는 된다). push·PR·머지·배포를 하지 않는다. **Supabase·운영 DB 도구(`mcp__…__execute_sql`·`apply_migration`·`list_tables` 등 이름이 무엇이든)에 닿지 않는다 — 읽기 전용 조회도 하지 않는다**(이 기능은 DB를 바꾸지 않는다). **오케스트레이터가 띄워 둔 dev 서버와 검사 창이 떠 있을 수 있다 — 끄지도, 다시 띄우지도, 그 포트·프로세스를 건드리지도 않는다.** 화면 확인은 오케스트레이터의 관문이다.
- **건드리지 않는 파일**(설계 10절): `src/stores/useSceneWorkLinkStore.ts`, `src/services/sceneWorkLinkService.ts`, `src/utils/sceneWorkLinks.ts`·`sceneIdKey.ts`·`sceneSort.ts`·`partId.ts`, `src/types/index.ts`, `SceneContextMenu.tsx`, 우클릭 메뉴를 부르는 네 곳(`ScenesView.tsx`·`UnifiedSceneCard.tsx`·`SceneSheetView.tsx`·`UnifiedSceneSheetView.tsx`), 묶어 보기 네 곳, `src/components/common/ConfirmDialog.tsx`·`UndoToast.tsx`, `src/mocks/devElectronAPI.ts`, `src/views/FeedbackHubPreviewApp.tsx`, `electron/supabase.ts`·`preload.ts`·`realtime.ts`, `electron/presence/`의 기존 파일, `tests/calendarRealtimeFanout.test.ts`, `DEVLOG/migrations/**`, `CLAUDE.md`. `SceneWorkLinksPanel.tsx`와 `WidgetPopup.tsx`는 각 Task의 한 줄 말고는 건드리지 않는다.
- **줄 끝**: 이 PC는 `core.autocrlf=true`이고 작업 트리에는 CRLF·LF 파일이 섞여 있다. **이 계획이 고치는 기존 파일은 지금 모두 `i/lf w/crlf`다**(`package.json`·`package-lock.json`·`DEVLOG/update-notes.json`·`AGENTS.md`·`ROADMAP.md`·진행 기록 문서·`src/App.tsx`·`src/services/sceneWorkLinkActions.ts`·`SceneWorkLinksPanel.tsx`·`WidgetPopup.tsx`·`electron/main.ts`·`tests/sceneLinkIndex.test.ts`). **각 파일의 지금 줄 끝을 그대로 둔다** — 고치기 전후에 `git ls-files --eol <파일>`이 같아야 하고(`w/mixed`가 되면 되돌리고 다시 한다), `git diff --stat`에 의도한 줄만 보여야 한다(파일 전체가 바뀐 것으로 보이면 줄 끝을 바꾼 것이다). **새 파일은 LF로 만든다.**
- **커밋**: Task마다 한 번, 그 Task의 **Files**만 `git add` 한다. 형식: `git commit -m "<한글 메시지>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. 설계 문서(` M`)와 이 계획(`??`)은 **오케스트레이터가 Task 1 전에** 커밋한다(`문서: 씬 대표 파일 한꺼번에 연결 — 한솔의 답(P1~P4) 반영과 구현 계획`) — 작업자는 그 둘을 커밋에 넣지 않는다.
- **스크래치는 저장소 밖에**: 스크래치 스크립트·추출한 자료·빌드 로그·뮤테이션 사본은 저장소 밖 임시 폴더(둘 수 없을 때만 `.gitignore`에 있는 `.superpowers/` 아래)에 두고 그 Task가 끝나기 전에 지운다. 워크트리의 다른 자리에 만들면 `??`로 남아 뒤 Task의 `git status --short` 확인(Task 11 Step 4, Task 12 Step 7)에 걸린다. **매 Task의 커밋 뒤 `git status --short`는 비어 있어야 한다**(`dist/`는 `.gitignore`에 있다).
- **관문은 오케스트레이터의 일이다**(설계 14절 끝의 "진행을 맡은 쪽만 하는 일"): 관문 A(Task 7 뒤 — 엔진 확인 E1~E6과 V1·V2 일부·K3b), 관문 B(Task 8 뒤 — 되돌리기 V2·V3·V5·F11·F12), **관문 C(Task 11 뒤 — 뮤테이션 결과 판정)**, 최종 수동 검증(Task 12 뒤 — 설계 12절 전체), 내보내기(PR·머지·`npm run build`·배포). 관문은 그 Task의 게이트가 통과한 뒤, 다음 Task를 시작하기 전에 본다 — 설계 15.2의 대체안이 뒤 Task(특히 Task 11의 앵커)가 읽는 글자를 바꾸고, 뮤테이션에서 무엇이 '잡힘'인지는 넣은 쪽이 스스로 확정하지 않기 때문이다. **관문의 결과 줄을 이 계획 파일에 적은 뒤에는 계획 파일만 따로 커밋한다** — 다음 Task가 시작될 때 `git status --short`가 비어 있어야 한다. Task 작업자는 자기 Task의 게이트까지만 하고 앱을 띄우지 않는다.

## File structure

새 파일

| 파일 | 책임 |
|---|---|
| `src/utils/sceneFileNameList.ts` | 파일 이름을 읽는 규칙(설계 3절). 순수 |
| `src/utils/sceneBulkWorkLink.ts` | 대상 찾기·상태·처음 체크·실행 계획·되돌리기 계획·문구(설계 4절). 순수 |
| `src/components/scenes/BulkWorkLinkDialog.tsx` | 창과 호스트(설계 6절) |
| `src/services/sceneBulkWorkLinkActions.ts` | 제안·한꺼번에 연결·되돌리기(설계 7절) |
| `electron/presence/trailingDebounce.ts` | 모아서 한 번 부르기(설계 9.2). 순수, import 없음 |
| `tests/sceneFileNameList.test.ts` · `tests/sceneBulkWorkLink.test.ts` · `tests/sceneBulkWorkLinkWiring.test.ts` · `tests/presenceTrailingDebounce.test.ts` | 설계 11절 |

바뀌는 파일

| 파일 | 내용 |
|---|---|
| `package.json` | `test:scene-links`(다섯 파일)와 두 빌드 줄, `test:presence` 끝의 새 파일, 버전 |
| `tests/sceneLinkIndex.test.ts` | 감시 테스트 하나(설계 11.5의 첫째) |
| `src/services/sceneWorkLinkActions.ts` | import 한 줄과 성공 가지(설계 8.1) |
| `src/components/scenes/SceneWorkLinksPanel.tsx` | `savePath` 맨 앞의 `if (saving) return;`(설계 8.4) |
| `src/App.tsx` | import 한 줄, `<BulkWorkLinkDialogHost />` 한 줄 |
| `electron/main.ts` | import 한 줄, 모으기 선언, `onSceneWorkLinkChange`의 본문, `stopEditingPresenceService`의 한 줄(설계 9.3) |
| `src/views/WidgetPopup.tsx` | `if (table === 'scene_work_links') return;`과 주석(설계 9.4) |
| `package-lock.json` · `DEVLOG/update-notes.json` · `ROADMAP.md` · `AGENTS.md` · `docs/superpowers/plans/2026-10-10-feedback-additions.md` | 버전 1.134.0, 업데이트 내역, 문서(설계 13절) |

**import 방향(거꾸로 가지 않는다)**: `sceneFileNameList.ts → sceneIdKey.ts` · `sceneBulkWorkLink.ts → sceneFileNameList.ts`·`sceneIdKey.ts`·`sceneSort.ts`·`partId.ts`·`sceneWorkLinks.ts`, 타입은 `import type … from '../types/index.ts'` · `BulkWorkLinkDialog.tsx → @/utils/sceneBulkWorkLink`·`@/utils/cn` · `sceneBulkWorkLinkActions.ts →` 두 저장소·`BulkWorkLinkDialog`·`UndoToast`·`@/utils/sceneBulkWorkLink`·`@/utils/sceneWorkLinks` · `sceneWorkLinkActions.ts → sceneBulkWorkLinkActions.ts`(반대 방향 없음). 순수 모듈 둘은 React·sonner·저장소·`window`·`document`를 쓰지 않는다.

Task와 설계 14절의 단계: 1=Task 1 · 2=Task 2–3 · 3=Task 4–5 · 4=Task 6 · 5=Task 7과 관문 A · 6=Task 8과 관문 B · 7=Task 9–10 · 8=Task 11과 관문 C · 9=Task 12와 최종 수동 검증 · 10=내보내기. 나눈 곳은 "순수 모듈 + 테스트" 커밋의 경계다(읽기/고르기, 대상/계획·문구, 도우미/배선).

---

## Chunk 1: 빌드 게이트와 파일 이름 규칙 (설계 14절 1·2단계)

### Task 1: 씬 작업 링크 테스트를 빌드에 넣는다 — `test:scene-links`와 감시 테스트

**Files:**
- Modify: `package.json`, `tests/sceneLinkIndex.test.ts`

**Read first:** 설계 11.5 전부, 14절 1단계, 1.4의 R10, 2.7의 마지막 불릿 · `package.json`의 `"test:presence"`·`"build"`·`"build:vite"` 줄 · `tests/sceneLinkIndex.test.ts` 전체(42줄) · 본보기: `tests/characterName.test.ts`의 `'피드백 55·57 배선 테스트 파일이 test:character 게이트에 등록돼 있다'`(남의 스크립트를 감시하는 꼴).

- [ ] **Step 1: 기준을 확인한다** — `npm run test:presence` → tests 38 / fail 0. `node --test tests/sceneWorkLinks.test.ts tests/sceneWorkLinkCardBadges.test.ts` → tests 10 / fail 0. 다르면 멈추고 보고한다.
- [ ] **Step 2: 감시 테스트를 쓴다** — `tests/sceneLinkIndex.test.ts`의 import에 `import { readFileSync } from 'node:fs';`를 더하고 파일 끝에 `test('씬 작업 링크 테스트가 빌드에 들어 있다', …)` 하나: `const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };` 뒤 `assert.match(scripts['test:scene-links'], /\.\/tests\/sceneWorkLinks\.test\.ts/)`, `assert.match(scripts['test:scene-links'], /\.\/tests\/sceneWorkLinkCardBadges\.test\.ts/)`, `assert.match(scripts.build, /npm run test:scene-links &&/)`, `assert.match(scripts['build:vite'], /npm run test:scene-links &&/)`. 테스트 위에 주석 한 줄: 이 확인을 `test:scene-links`의 파일 안에 두면 그 스크립트가 빌드에서 빠질 때 감시도 함께 사라진다 — 그래서 `test:presence`의 이 파일이 지킨다. (Task 2·4·11이 파일 줄을 하나씩 더해 다섯이 된다.)
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/sceneLinkIndex.test.ts` → 새 테스트 하나만 실패(`scripts['test:scene-links']`가 `undefined`), 기존 셋은 통과.
- [ ] **Step 4: `package.json`** — `"test:presence": …` 줄 바로 다음에 `"test:scene-links": "node --test ./tests/sceneWorkLinks.test.ts ./tests/sceneWorkLinkCardBadges.test.ts",`. `"build"`와 `"build:vite"` 두 줄 모두 `npm run test:presence && ` 바로 뒤에 `npm run test:scene-links && `를 넣는다. 다른 글자는 바꾸지 않는다.
- [ ] **Step 5:** `npm run test:scene-links` → tests 10 / fail 0. `npm run test:presence` → tests 39 / fail 0. `npm run typecheck` → 오류 없음.
- [ ] **Step 6: 줄 끝과 범위** — `git diff --numstat package.json` → `3	2	package.json`. `git ls-files --eol package.json tests/sceneLinkIndex.test.ts` → 둘 다 `w/crlf` 그대로.
- [ ] **Step 7: 커밋** — 두 파일 / `테스트: 씬 작업 링크 테스트를 빌드에 넣는다 — test:scene-links를 두 빌드 줄에 더하고 감시 테스트로 고정`

**v1.133.0과 달라지는 것:** 두 빌드 줄(`build`·`build:vite`)이 씬 작업 링크 테스트 10개를 돌린다 — 지금까지는 어느 스크립트에도 없어 깨져도 빌드가 통과했다. 이 뒤의 모든 Task가 이 스크립트로 막힌다.
**이 Task가 끝나면 앱은:** v1.133.0과 같다(코드 변경 없음).

### Task 2: 파일 이름에서 번호 목록 읽기 — `readSceneNameLists`와 씬 번호 도우미

**Files:**
- Create: `src/utils/sceneFileNameList.ts`, `tests/sceneFileNameList.test.ts`
- Modify: `package.json`, `tests/sceneLinkIndex.test.ts`

**Read first:** 설계 3.1, 3.2, 3.3 전부(문법과 표), 3.6의 맨 위부터 `refKey`까지, **3.7 전부**(표기 줄과 번호 붙은 표 열셋 — #1~#144), 15.1의 "P1을 끄면" 표, 11.1 전부, 2.1의 `normalizeSceneIdKey` 표, 3.4 끝의 `sceneRefKey` 표, 1.4의 R5 · `src/utils/sceneIdKey.ts` 전체.

- [ ] **Step 1: 자료 표 `ROWS`를 만든다 — 손으로 다시 치지 않는다.** `tests/sceneFileNameList.test.ts`에 `const ROWS = [[번호, 경로, sceneId, partId, 읽힌 목록 전부, 이 씬의 목록], …]`(144줄). **줄의 출처는 설계 3.7의 번호 붙은 표뿐이다**: 설계 파일에서 `### 3.7 입력과 출력`부터 `**다른 씬들의 목록인가`까지의 줄 가운데 `| <숫자> |`로 시작하는 줄이 정확히 144개다. 스크래치 스크립트(공통 규칙의 스크래치 자리에 둔다 — 커밋하지 않는다)로 뽑는다 — 줄 끝의 `\r`을 떼고, 칸을 `|`로 가르고(칸 안에 `|`는 없다), 2·4·5번째 칸에서는 **첫 백틱 구간의 글자만** 쓰고(뒤의 괄호 설명과 첫 표의 여섯째 칸 '창에서는'은 옮기지 않는다), `연결한 씬` 칸 `a001 / A`는 `' / '`(빗금 앞뒤에 빈칸 하나씩)로 갈라 `sceneId`·`partId`로, `(없음)`은 그 글자로, `null`은 문자열 `'null'`로 쓴다. 경로는 `JSON.stringify`로 찍어 `\`가 `\\`가 되게 한다. 뽑은 뒤 **손으로 고치는 줄은 일곱**이다:
  - #40(빈 경로): 경로 `''`.
  - #85: 두 열 모두 표의 `a: 1 2* … 49* 50` 대신 상수 `RANGE_50 = 'a: 1 ' + Array.from({ length: 48 }, (_, i) => (i + 2) + '*').join(' ') + ' 50'`.
  - 코드 값으로 쓰는 다섯(붙여 넣는 사이 보통 글자로 바뀌면 그 줄이 지키던 규칙이 조용히 풀린다): #34 `String.fromCharCode(0xFF21, 0x3000, 0xFF10, 0xFF10, 0xFF11, 0xFF0C, 0xFF10, 0xFF10, 0xFF13) + '.moho'` · #80 `'a001' + String.fromCharCode(0x301C) + '003.moho'` · #121 `'a001' + String.fromCharCode(0x223C) + '003.moho'` · #114 `'a' + '  ' + '001,003.moho'`(빈칸 **둘**) · #134 `'a001' + String.fromCharCode(0x3001) + '003.moho'`.
  - 옮긴 것을 눈으로 견줄 표본: #1 `['a 001,003,005,007.moho', 'a001', 'A', 'a: 1 3 5 7', 'a: 1 3 5 7']` · #9 `['b 001,003.moho', 'a001', 'A', 'b: 1 3', 'null']` · #21 경로 `'G:\\act\\A_014\\main.clip'`, `'(없음)'`, `'null'` · #39 경로 `'G:\\show\\a001,003\\'` · #72 `sceneId 'A001'`, `partId 'a'` · #144 `['ep005_001,003.moho', 'a001', 'A', 'ep: 5 1 3', 'null']`.
  - 손잡이 표도 자료로 둔다: `P1_OFF`(번호 → `[읽힌 목록 전부, 이 씬의 목록]`)는 **설계 15.1 "P1을 끄면" 표의 열아홉 줄** — 10·76·78·79·80·81·84·92·116·121·122·123 → `['a: 1', 'null']` / 77·85·91 → `['a: 1', 'a: 1']` / 82 → `['a: 1 3', 'a: 1 3']` / 83 → `['a: 3 2', 'a: 3 2']` / 125 → `['∅: 325 ; a: 1 3', 'a: 1 3']` / 139 → `['a: 1 10', 'a: 1 10']`. 이 Task는 다섯째 열과 `P1_OFF`의 첫 값만 단언한다(여섯째 열은 Task 3).
- [ ] **Step 2: 테스트를 쓴다(설계 11.1 — 읽기 쪽)** — import: `SCENE_NAME_RULES, readSceneNameLists, refKey, sceneFamily, sceneRefKey, splitSceneId, workFileName`(`../src/utils/sceneFileNameList.ts`). 표기 도우미(설계 3.7의 표기 줄과 같다): `show(list)` = `(list.prefix || '∅') + ': ' + list.refs.map((ref) => refKey(ref) + (ref.ranged ? '*' : '')).join(' ')`, `showAll(lists)` = 목록마다 `show`를 `' ; '`로 잇고 하나도 없으면 `'(없음)'`. 실패 글에 줄 번호(`#n`)를 넣는다.
  - **자료의 줄 수**: `ROWS.length === 144`이고 번호가 1부터 144까지 차례다.
  - **보통 글자가 아니다(다섯 단언)**: #34의 경로에서 `.moho` 앞 부분에 `/[A0-9,]/`가 없다 · #80·#121에 `~`가 없다 · #114에 `'  '`가 있다 · #134에 `,`가 없다.
  - **읽힌 목록 전부**: 줄마다 `showAll(readSceneNameLists(경로))`(`rules`를 넘기지 않는다)가 다섯째 열과 같다.
  - **#85**: `readSceneNameLists('a001~050.moho')[0].refs`가 50개이고 `ranged`가 거짓인 것은 양 끝(1과 50) 둘뿐이다.
  - **P1을 끈다**: `{ ...SCENE_NAME_RULES, tildeRange: false }`로 144줄 모두 — `P1_OFF`에 있는 줄은 그 첫 값과, 없는 줄은 다섯째 열과 같다. `Object.keys(P1_OFF).length === 19`.
  - **넘긴 손잡이를 듣는다**: `{ ...SCENE_NAME_RULES, maxRangeCount: 60 }`으로 #86의 경로 → 60개이고 양 끝만 `ranged`가 거짓 · `{ ...SCENE_NAME_RULES, maxDigits: 5 }`로 #50의 경로 → `'a: 1 3'`.
  - **`width`**: `readSceneNameLists('a 001,003.moho')[0].width` → `3`, `'a1,3,5.moho'` → `1`, `'a0001~0003.moho'` → `4`.
  - **`workFileName`**: `'G:\\show\\EP2\\B030.moho'` → `'B030.moho'` · `'G:/a/b/c.psd'` → `'c.psd'` · `'  G:\\x\\y.moho  '` → `'y.moho'` · `'G:\\x\\folder\\'`·`'G:/x/folder/'`·`''`·`'   '` → `''`.
  - **`splitSceneId`**: `'a001'`·`'A001'` → `{ letters: 'a', number: 1, suffix: '' }` · `'001'` → 글자 `''` · `'ac001'` → `'ac'` · `'sc012'` → `{ letters: 'sc', number: 12, suffix: '' }` · `'a001A'` → 접미 `'A'` · `'a001abc'` → `'ABC'` · `' a7 '` → `{ letters: 'a', number: 7, suffix: '' }` · `'a001abcd'`·`'v2a001'`·`'bg3-001'`·`'b018_act'`·`''`·`null` → `null`.
  - **`sceneFamily`**: `('a001','A')` → `'a'` · `('ac001','A')` → `'ac'` · `('sc012','A')` → `'sc'` · `('001','A')` → `'a'` · `('001',' A ')` → `'a'` · `('001','')` → `''` · `('v2a001','A')` → `null`.
  - **`sceneRefKey`**: 설계 3.4 끝의 표 전부(씬 번호 열하나 × 가족 `a`·`ac`·`sc`·`''` — 예: `('a003','a')` → `'3'`, `('sc003','sc')` → `'3'`, `('a003A','ac')` → `'3A'`, `('003','')` → `'3'`, `('b003', 어느 가족)` → `null`, `('v2a001', 어느 가족)` → `null`).
  - **상수 고정**: `SCENE_NAME_RULES`가 `{ tildeRange: true, maxRangeCount: 50, maxDigits: 4, minSceneDigits: 3, requireOwnNumber: false }`와 `deepEqual`.
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/sceneFileNameList.test.ts` → `ERR_MODULE_NOT_FOUND`(파일 전체).
- [ ] **Step 4: `src/utils/sceneFileNameList.ts`** — 맨 위에 `import { normalizeSceneIdKey } from './sceneIdKey.ts';`, 그 아래 설계 3.1의 선언(`SceneNameRules`와 필드 주석, `SCENE_NAME_RULES`, `SceneNameRef`, `SceneNameList`, `SceneIdParts` — 3.1 끝의 `export function …;` 시그니처 줄은 옮기지 않는다. 본문은 3.6이다), 그 아래 설계 3.6의 코드를 `refKey`까지 **글자 그대로**. 이 Task에 생기는 것:
  - `LETTER`·`DIGIT`·`ALNUM`·`SPACE`(정규식 넷) · `interface NumberToken { prefix: string; digits: string; suffix: string; closed: boolean; end: number }`.
  - `workFileName(path: string): string` — 앞뒤 공백을 뗀 경로를 `\`·`/`로 가른 마지막 조각. 폴더로 끝나거나 빈 경로면 `''`.
  - `normalizeName(path: string): string`(비공개) — NFKC → 소문자 → U+301C·U+223C를 `~`로 → 공백류를 빈칸 하나로 → 앞뒤 떼기.
  - `run(s: string, from: number, re: RegExp): number`(비공개) — `re`에 맞는 글자가 이어지는 끝 자리.
  - `readNumber(s: string, from: number, rules: SceneNameRules): NumberToken | null`(비공개) — `(글자)(틈 하나: 빈칸·_·-)숫자{1,maxDigits}(접미 1~3자)`. 접미가 아닌 글자가 붙으면 `closed`.
  - `readSeparator(s: string, from: number): number`(비공개) — 빈칸들과 `,`·`_`·`+`·`&` 하나.
  - `readSceneNameLists(path: string, rules: SceneNameRules = SCENE_NAME_RULES): SceneNameList[]` — 이름 속 목록을 왼쪽부터 모두. 자릿수·글자가 머리와 같은 항목만 잇고, 범위는 P1의 조건을 모두 채울 때만 펼치고, 받아들이지 않은 `~` 바로 뒤에서 시작하는 목록은 버린다.
  - `splitSceneId(sceneId: string | null | undefined): SceneIdParts | null` · `sceneFamily(sceneId: string | null | undefined, partId: string | null | undefined): string | null`(씬 번호 자신의 글자, 없으면 파트 첫 글자) · `sceneRefKey(sceneId: string | null | undefined, family: string): string | null`(`normalizeSceneIdKey(글자+숫자, family)`가 숫자만이면 `숫자 + 접미`) · `refKey(ref: { number: number; suffix: string }): string`.
  - `sceneLikeWidth`·`sceneListForScene`·`namesOtherScenes`는 **Task 3**이다 — 여기서 쓰지 않는다.
- [ ] **Step 5:** `node --test tests/sceneFileNameList.test.ts` → 통과. 실패하는 줄이 있으면 먼저 그 줄을 설계 3.7과 견준다(옮긴 자료가 틀렸는지) — 자료가 맞으면 구현을 3.6과 글자로 견준다. **기대값을 구현에 맞춰 고치지 않는다.**
- [ ] **Step 6: 스크립트와 감시** — 감시 테스트에 `assert.match(scripts['test:scene-links'], /\.\/tests\/sceneFileNameList\.test\.ts/)`를 더하고(`node --test tests/sceneLinkIndex.test.ts` → 그 줄에서 실패), `package.json`의 `test:scene-links` 끝에 ` ./tests/sceneFileNameList.test.ts`를 더한다.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음. `npm run test:scene-links` → tests가 10보다 많음, fail 0. `npm run test:presence` → tests 39 / fail 0.
- [ ] **Step 8: 커밋** — 네 파일 / `씬 한꺼번에 연결: 파일 이름에서 씬 번호 목록 읽기 — 구분자·틈·접미·자릿수·물결표 범위(sceneFileNameList)와 설계 3.7의 144줄 자료 테스트`

**이 Task가 끝나면 앱은:** v1.133.0과 같다(새 모듈을 부르는 화면이 없다).

### Task 3: 이 씬의 목록 고르기 — `sceneListForScene`·`namesOtherScenes`

**Files:**
- Modify: `src/utils/sceneFileNameList.ts`, `tests/sceneFileNameList.test.ts`

**Read first:** 설계 3.4 전부(가족·관문·자기 번호·5-1~5-3·다른 씬들의 목록), 3.5, 3.6의 `sceneLikeWidth`부터 끝까지, 3.7의 마지막 표("다른 씬들의 목록인가" 스무 줄)와 그 아래 두 문단, 15.1의 "P4를 켜면" 표와 "P4 — 추천한 값과 고른 값", 11.1의 손잡이·"어느 씬에서 연결해도 같은 목록"·`namesOtherScenes` 불릿.

- [ ] **Step 1: 테스트를 더한다(설계 11.1 — 고르기 쪽)** — import에 `namesOtherScenes, sceneListForScene`. `showOne(list)` = `list ? show(list) : 'null'`. `P4_ON = [59, 60, 61, 62, 109, 123, 126, 128]`(설계 15.1 "P4를 켜면" 표의 여덟 줄).
  - **이 씬의 목록**: 144줄마다 `showOne(sceneListForScene(경로, { sceneId, partId }))`(`rules` 없이)가 여섯째 열과 같다. #85는 50개·양 끝만 `ranged` 거짓.
  - **P1을 끈다**: `tildeRange: false`로 144줄 — `P1_OFF`에 있는 줄은 그 둘째 값과, 없는 줄은 여섯째 열과 같다.
  - **P4를 켠다**: `{ ...SCENE_NAME_RULES, requireOwnNumber: true }`로 144줄 — `P4_ON`의 여덟 줄은 `'null'`, 나머지는 여섯째 열과 같다.
  - **번호가 하나뿐인 이름은 정해진 값(끔)에서도 자기 번호여야 한다**(`rules` 없이): `('a012.moho', a005 / A)`, `('b030-피드백.moho', b031 / B)`, `('ep2-b030-retake.moho', b012 / B)` → 모두 `null`. 글자 없는 목록도: `('001,003,005.moho', a007 / A)` → `null`.
  - **나머지 손잡이 셋**: `minSceneDigits: 2`로 #94 → `'∅: 10 12'` · `maxRangeCount: 60`으로 #86 → 60개이고 양 끝만 `ranged` 거짓 · `maxDigits: 5`로 #50 → `'a: 1 3'`.
  - **어느 씬에서 연결해도 같은 목록**: 줄마다(#40과 씬 번호를 가를 수 없는 #74·#75는 건너뛴다) 그 줄의 씬 번호에서 글자와 숫자 자릿수를 따 씬 서른 개를 만든다(`a001` → `a001`~`a030`, `a1` → `a1`~`a30`, `001` → `001`~`030`, 접미는 뗀다). 그 줄의 `partId`로 서른 번 `sceneListForScene`을 돌려 **번호가 둘 이상인 결과**를 `글자: 열쇠들`(범위 표시 `*` 없이) 문자열의 집합으로 모은다. **기본값에서는 모든 줄에서 집합의 크기가 1 이하다 — 예외가 없다**(#132의 이름도 `a: 1 3` 하나뿐임을 따로 단언). 같은 검사를 `requireOwnNumber: true`로 한 번 더: #132에서만 정확히 둘(`a: 1 3`, `a: 1 5`), 나머지는 1 이하.
  - **`namesOtherScenes`**: 설계 3.7 마지막 표의 스무 줄 그대로(참 여섯 — `b 001,003.moho`(a001/A), `a001,003.moho`(v2a001/A), `take 001,002.moho`(a001/A), `b001,003-005,007.moho`(a005/A), `A_BG_001,003.moho`(a001/A), `sc 001,003.moho`(a001/A) — 나머지 열넷은 거짓). 이 표도 손으로 다시 치지 않고 Task 2와 같은 방법으로 뽑는다: 설계 파일의 `**다른 씬들의 목록인가`부터 `이 표는 스무 줄이다`까지에서 `|` 다음이 백틱으로 시작하는 줄이 정확히 스무 개다(첫 칸의 첫 백틱 구간이 경로, 둘째 칸이 씬, 셋째 칸이 `**참**`이면 참·`거짓`이면 거짓). 자료의 줄 수 20과 참의 수 6도 단언한다.
  - **그 함수의 손잡이 둘**: `requireOwnNumber: true`를 넘기면 `('a 001,003.moho', a005/A)`, `('a001~005.moho', a007/A)`, `('005_006 a 005,007.moho', a006/A)`, `('a001,003-005,007.moho', a005/A)`가 참이고 `('b 001,003.moho', a001/A)`·`('b001,003-005,007.moho', a005/A)`는 그대로 참 · `tildeRange: false`를 넘기면 `('a001~005.moho', a007/A)`는 거짓.
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/sceneFileNameList.test.ts` → `does not provide an export named 'namesOtherScenes'`(또는 `sceneListForScene`). 파일 전체가 실패한다(Task 2의 테스트도 함께 실패로 보이는 것이 맞다).
- [ ] **Step 3: 구현** — `refKey` 아래에 설계 3.6의 나머지를 글자 그대로(주석 포함):
  - `sceneLikeWidth(width: number, sceneId: string, rules: SceneNameRules): boolean`(비공개) — 자릿수가 `minSceneDigits` 이상이거나 연결한 씬 번호의 자릿수와 같다.
  - `sceneListForScene(path: string, scene: { sceneId: string; partId: string }, rules: SceneNameRules = SCENE_NAME_RULES): SceneNameList | null` — 글자 있는 목록은 관문(가족 또는 가족의 첫 글자)을 지나고 **번호가 둘 이상이거나 자기 열쇠가 있어야** 맞는다(`requireOwnNumber`를 켜면 늘 자기 열쇠). 글자 없는 목록은 자기 열쇠 + 씬 번호처럼 쓴 자릿수. 글자 있는 맞는 목록이 먼저(5-1), 없는데 글자 붙은 씬 목록이 따로 있으면 `null`(5-2), 그 밖에는 글자 없는 맞는 목록(5-3). 여럿이면 번호가 둘 이상인 것, 그래도 여럿이면 왼쪽 것.
  - `namesOtherScenes(path: string, scene: { sceneId: string; partId: string }, rules: SceneNameRules = SCENE_NAME_RULES): boolean` — 이 씬의 목록이 없고, 글자가 붙고 번호가 둘 이상이고 씬 번호처럼 쓴 목록이 하나라도 있다. 두 읽기 모두 넘겨받은 `rules`를 쓴다.
- [ ] **Step 4:** `node --test tests/sceneFileNameList.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links` → 테스트 수 증가, fail 0. `npm run test:presence` → tests 39 / fail 0.
- [ ] **Step 6: 커밋** — 두 파일 / `씬 한꺼번에 연결: 이 씬의 목록 고르기 — 가족·관문·자기 번호(글자가 맞고 번호가 둘 이상이면 없어도 읽는다)·글자 붙은 목록 우선, 다른 씬들의 목록 판정`

**이 Task가 끝나면 앱은:** v1.133.0과 같다.

---

## Chunk 2: 대상 찾기 (설계 14절 3단계)

### Task 4: 대상과 상태 — `findBulkLinkScope`·`buildBulkLinkOffer`

**Files:**
- Create: `src/utils/sceneBulkWorkLink.ts`, `tests/sceneBulkWorkLink.test.ts`
- Modify: `package.json`, `tests/sceneLinkIndex.test.ts`

**Read first:** 설계 4절 머리말, 4.1~4.6 전부, 4.9의 import 줄과 `sameWorkPath`부터 `buildBulkLinkOffer`까지, 11.2의 공통 자료 블록과 `findSceneLocation`부터 `sameWorkPath`까지의 불릿(`planBulkLink`·`planBulkUndo`·문구는 Task 5), 2.1·2.2·2.5 · `src/utils/sceneSort.ts`의 `compareScenesByNumberThenSuffix`, `src/utils/partId.ts`의 `findPartById`, `src/utils/sceneWorkLinks.ts`의 `getWorkLinkSlotKey`, `src/types/index.ts`의 `Scene`·`Part`·`Episode`·`SceneWorkLink`.

- [ ] **Step 1: 공통 자료를 옮긴다** — 설계 11.2의 코드 블록(`scene` 도우미, `bgA`·`actA`·`bgB`·`bgC`·`actC`·`bgP`, `episodes`, `FILE`)을 글자 그대로. 선언을 `makeEpisodes()` 함수로 감싸 부를 때마다 새 객체가 나오게 한다(Task 5가 씬 하나만 고친 자료를 만든다). 링크 지도 도우미: `link(sceneUuid, department, path, updatedBy = 'me')` → `[getWorkLinkSlotKey(sceneUuid, department, 'primary_file'), { id: 'l-' + sceneUuid + department, sceneUuid, department, linkKind: 'primary_file', path, label: null, sortOrder: 0, createdBy: null, createdAt: '', updatedBy, updatedAt: '' }]`, `new Map([link(…), …])`로 쓴다(`getWorkLinkSlotKey`는 `../src/utils/sceneWorkLinks.ts`).
- [ ] **Step 2: 테스트를 쓴다(값은 설계 11.2의 글자 그대로 — 아래는 빠뜨리지 않기 위한 목록이다)**. 묶음은 `sceneId`의 배열로 견준다.
  - `findSceneLocation`: `'act-3'` → 파트 `sheetName` `'EP05_A_ACT'`, 화 번호 5 · `'nope'`·`''` → `null`.
  - `effectiveLayout` 여섯: 액팅 `A001` → `'12'`(배경 짝) · 배경 `a003` → `'12'`(액팅 짝) · 배경 `a003A` → `''` · 배경 `a009`(`' 12 '`) → `'12'` · 짝 파트가 `undefined`면 자기 것만 · 배경 `c003` → `'12'`(짝 쪽의 빈칸도 다듬는다).
  - `findBulkLinkScope(episodes, 'bg-1', 'bg', FILE)`: 이름 묶음 `a003, a005, A007`(이 순서), 레이아웃 묶음 `a002, a009, a010`, 없는 씬 `['a011']`, `layoutValue` `'12'`. 액팅 씬·파트 B·6화의 씬이 하나도 없다.
  - 액팅 `('act-1', 'acting', FILE)`: 이름 묶음 `A003, A005, A007`, 레이아웃 묶음 `A002`, 없는 씬 `['A011']`.
  - 부서가 어긋나면 `('bg-1', 'acting', FILE)` → `null`.
  - `('bg-5', 'bg', 'G:\\x\\main.psd')` → `null` · `('bg-5', 'bg', 'G:\\x\\a005.moho')` → `null`.
  - 레이아웃이 빈 씬끼리는 묶음이 아니다: `('bg-7', 'bg', 'G:\\x\\main.psd')` → `null`.
  - 이름에 자기뿐이지만 레이아웃이 같은 씬: `('bg-2', 'bg', 'G:\\x\\a002.moho')` → 이름 묶음 없음, 레이아웃 묶음 `a001, a003, a009, a010`.
  - 이름이 다른 씬들을 가리키면 레이아웃 묶음도 없다: `('bg-1', 'bg', 'G:\\x\\b 001,003.moho')` → `null` · 번호 하나짜리 다른 글자는 해당 없음: `('bg-1', 'bg', 'G:\\x\\b030.moho')` → 이름 묶음 없음, 레이아웃 묶음 `a002, a003, a009, a010`.
  - **자기 번호가 빠진 목록도 이 씬의 목록이다(P4)**: `('bg-2', 'bg', 'G:\\x\\a 003,005.moho')` → 이름 묶음 `a003, a005`, 레이아웃 묶음 `a001, a009, a010`, 없는 씬 없음(`null`이 아니다).
  - 순서와 같은 번호의 씬: `('c-1', 'bg', 'G:\\x\\c 001,003,005.moho')` → 이름 묶음 `c003, c005`(번호 순, `C001` 없음), 레이아웃 묶음 없음.
  - 접미 씬: `('bg-3', 'bg', 'G:\\x\\a 001,003,003A.moho')` → 이름 묶음 `a001, a003A`, 없는 씬 없음.
  - 범위 셋: `'G:\\x\\a001~003.moho'`(bg-1) → 이름 묶음 `a002, a003`, 레이아웃 묶음 `a009, a010`, 없는 씬 없음 · `'G:\\x\\a001~004.moho'` → 이름 묶음 `a002, a003`, 없는 씬 `['a004']` · `'G:\\x\\a001~005.moho'` → 이름 묶음 `a002, a003, a005`, 없는 씬 `[]`.
  - 다른 파트·다른 화: `('bgb-1', 'bg', 'G:\\x\\b 001,003.moho')` → 이름 묶음 `b003`, 레이아웃 묶음 없음 · `('e6-1', 'bg', 'G:\\x\\a 001,003.moho')` → 이름 묶음이 uuid `'e6-3'` 하나뿐.
  - 없는 씬의 표시 글자 셋: `('bg-1', 'bg', 'G:\\x\\a 001,003,005B.moho')` → 이름 묶음 `a003`, 레이아웃 묶음 `a002, a009, a010`, 없는 씬 `['a005B']` · `('p-1', 'bg', 'G:\\x\\p1,3,5.moho')` → 이름 묶음 `p3`, 없는 씬 `['p5']` · `('bg-1', 'bg', 'G:\\x\\a0001,0003,0011.moho')` → 이름 묶음 `a003`, 없는 씬 `['a0011']`.
  - 글자 붙은 목록 뒤의 조각 셋: `('bg-1', 'bg', 'G:\\x\\a001,003-009,011.moho')` → 이름 묶음 `a003`, 레이아웃 묶음 `a002, a009, a010`, 없는 씬 없음 · 같은 경로를 `'bg-9'`에 → 이름 묶음 `a001, a003`, 레이아웃 묶음 `a002, a010`, 없는 씬 없음 · `('bg-5', 'bg', 'G:\\x\\b001,003-005,007.moho')` → `null`.
  - 시그니처 길이: `findBulkLinkScope.length === 4`, `buildBulkLinkOffer.length === 4`.
  - 손잡이 셋(`D = { checkNamedReplace: true, offerLayoutOnly: true, checkLayoutOnly: false }`, 마지막 인자): `findBulkLinkScope(episodes, 'bg-1', 'bg', FILE, { ...D, offerLayoutOnly: false })` → 이름 묶음 그대로, 레이아웃 묶음 `[]` · `('bg-2', 'bg', 'G:\\x\\a002.moho', { ...D, offerLayoutOnly: false })` → `null` · 아래 제안을 `{ ...D, checkNamedReplace: false }`로 → `checked`가 `[true, false, false, false, false, false]` · `{ ...D, checkLayoutOnly: true }`로 → `[true, true, false, true, true, false]`.
  - `buildBulkLinkOffer`(첫 호출의 결과 + 링크 `bg-5` → `'G:\\old\\a005.moho'`, `bg-7` → `'g:/show/ep5/A 001,003,005,007,011.MOHO'`, `bg-2` → `'G:\\old\\layout12.moho'`): 후보가 순서대로 `a003 named empty true 'bg-3'` / `a005 named replace true 'bg-5'` / `A007 named same false 'bg-7'` / `a002 layout replace false 'bg-2'` / `a009 layout empty false 'bg-9'` / `a010 layout unavailable false 'no:8:a010'`. `fileName` `'a 001,003,005,007,011.moho'`, `layout` `'12'`, `linkedSceneId` `'a001'`, `linkedSceneUuid` `'bg-1'`, `notFound` `['a011']`, `a005`의 `currentPath` `'G:\\old\\a005.moho'`.
  - 할 일이 없으면 `null` 둘: 파트 B 호출의 결과 + 링크 `bgb-3` → `'G:/x/B 001,003.moho'` → `null` · 후보가 uuid 없는 씬뿐(파트 `{ partId: 'D', department: 'bg', … scenes: [scene('d-1', 1, 'd001'), uuid 없는 d003] }`에서 `'d-1'`에 `'G:\\x\\d 001,003.moho'`) → `null`.
  - 액팅 칸만 읽는다: 액팅 호출의 결과 + 링크 `act-3`의 **배경** 칸 → `'G:\\bg\\other.psd'`, `act-5`의 **액팅** 칸 → `'G:\\old\\A005.moho'` → 상태가 차례로 `A003 empty`, `A005 replace`, `A007 empty`, `A002 empty`.
  - 상수 고정: `BULK_LINK_DEFAULTS`가 `{ checkNamedReplace: true, offerLayoutOnly: true, checkLayoutOnly: false }`와 `deepEqual`.
  - `sameWorkPath`: `('G:/a/B.moho', 'g:\\a\\b.MOHO ')` → 참 · `('', '')`·`(null, 'x')`·`(undefined, undefined)` → 거짓.
- [ ] **Step 3: 실패를 확인한다** — `node --test tests/sceneBulkWorkLink.test.ts` → `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 4: `src/utils/sceneBulkWorkLink.ts`** — 맨 위에 설계 4.9의 import 여섯 줄(글자 그대로 — 타입은 `import type … from '../types/index.ts'`), 그 아래 설계 4.1의 선언(`BulkLinkDefaults`·`BULK_LINK_DEFAULTS`·`BulkLinkGroup`·`BulkLinkState`·`BulkLinkCandidate`·`SceneLocation`·`BulkLinkScope`·`BulkLinkOffer` — 주석 포함. 4.1 끝의 `export function …;` 시그니처 줄은 옮기지 않는다), 그 아래 설계 4.9의 함수 다섯을 글자 그대로:
  - `sameWorkPath(a: string | null | undefined, b: string | null | undefined): boolean` — `trim`·`/`→`\`·소문자로 맞춘 값이 비지 않았고 같다.
  - `findSceneLocation(episodes: readonly Episode[], sceneUuid: string): SceneLocation | null` — 화 → 파트 → 씬을 돌아 `scene.id === sceneUuid`인 첫 씬.
  - `effectiveLayout(scene: Scene, part: Part, twinPart: Part | undefined): string` — 자기 `layoutId`(다듬은 값), 비었으면 짝 파트에서 `normalizeSceneIdKey`가 같은 첫 씬의 것.
  - `findBulkLinkScope(episodes: readonly Episode[], sceneUuid: string, department: SceneWorkLinkDepartment, path: string, defaults: BulkLinkDefaults = BULK_LINK_DEFAULTS): BulkLinkScope | null` — 부서가 어긋나면 `null` → `namesOtherScenes`면 `null` → 그 `Part` 하나에서 이름 묶음·없는 씬·레이아웃 묶음 → 둘 다 비면 `null`.
  - `buildBulkLinkOffer(scope: BulkLinkScope, path: string, department: SceneWorkLinkDepartment, linkMap: ReadonlyMap<string, SceneWorkLink>, defaults: BulkLinkDefaults = BULK_LINK_DEFAULTS): BulkLinkOffer | null` — 후보마다 상태(`unavailable`·`empty`·`same`·`replace`)와 처음 체크. `empty`·`replace`가 하나도 없으면 `null`.
- [ ] **Step 5:** `node --test tests/sceneBulkWorkLink.test.ts` → 통과(기대값을 구현에 맞춰 고치지 않는다 — 설계 11.2와 견준다).
- [ ] **Step 6: 스크립트와 감시** — 감시 테스트에 `/\.\/tests\/sceneBulkWorkLink\.test\.ts/` 줄을 더하고(실패 확인), `test:scene-links` 끝에 ` ./tests/sceneBulkWorkLink.test.ts`.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음. `npm run test:scene-links` → 테스트 수 증가, fail 0. `npm run test:presence` → tests 39 / fail 0.
- [ ] **Step 8: 커밋** — 네 파일 / `씬 한꺼번에 연결: 대상 찾기 — 같은 파트의 이름 묶음과 레이아웃 묶음, 없는 씬, 칸의 상태와 처음 체크(sceneBulkWorkLink)`

**이 Task가 끝나면 앱은:** v1.133.0과 같다.

### Task 5: 실행 계획·되돌리기 계획·문구

**Files:**
- Modify: `src/utils/sceneBulkWorkLink.ts`, `tests/sceneBulkWorkLink.test.ts`

**Read first:** 설계 4.7, 4.8, 4.9의 `planBulkLink`부터 끝까지, 6.2의 문구 표, 7.3과 7.4의 문구 표, 11.2의 "액팅에서 연결하면" 불릿의 뒤 두 줄과 `planBulkLink`·`planBulkUndo`·문구 불릿 전부.

- [ ] **Step 1: 테스트를 더한다(값은 설계 11.2의 글자 그대로)** — import에 `BULK_LINK_TEXT, bulkLinkConfirmLabel, bulkLinkLayoutHeading, bulkLinkLead, bulkLinkNotFoundText, bulkLinkRecheckFailedText, bulkLinkReplaceNote, bulkLinkResultText, bulkLinkRowParts, bulkLinkSourceChangedText, bulkUndoResultText, planBulkLink, planBulkUndo, sceneIdList`. `제안`·`첫 호출의 결과`는 Task 4의 `buildBulkLinkOffer` 테스트의 것이다.
  - `planBulkLink(제안, ['bg-3', 'bg-5', 'bg-2', 'bg-7'], 링크, 첫 호출의 결과)`: 링크가 그대로면 `writes`가 `[{ sceneUuid: 'bg-3', sceneId: 'a003', before: null }, { 'bg-5', 'a005', before: 'G:\\old\\a005.moho' }, { 'bg-2', 'a002', before: 'G:\\old\\layout12.moho' }]`, `same`·`changed`는 `[]` · 그 사이 `bg-3`에 `'G:\\someone\\else.moho'` → `changed` `['a003']`, `writes`에 a003 없음 · 그 사이 `bg-3`이 이 파일 → `same` `['a003']` · 고르지 않은 `bg-9`와 uuid 없는 `no:8:a010`은 어디에도 없다.
  - **그 사이 씬 자료가 바뀌었다**(링크는 그대로, 넷째 인자만 `makeEpisodes()`로 새로 만든 자료에서 씬 하나를 고쳐 다시 찾은 묶음): `bg-3`의 번호 → `a013`: `changed` `['a003']`, `writes`는 a005·a002 · `bg-5`의 번호 → `a011`: `changed` `['a005']`, `writes`는 a003·a002 · `bg-2`의 레이아웃 → `'99'`: `changed` `['a002']`, `writes`는 a003·a005 · 연결한 씬 `bg-1`의 번호 → `A003`: `changed` `['a003']`, `writes`는 a005·a002 · `bg-3`이 지워지고 `a003`으로 다른 씬(uuid `'bg-3x'`): `changed` `['a003']`, `writes`는 a005·a002 · `bg-1`의 번호 → 파일 이름에 없는 `a021`: `writes`가 a003·a005·a002 셋, `same`·`changed`는 `[]`(P4) · `bg-1`의 번호 → `b021`(다시 찾은 묶음이 `null`): `writes`·`same`은 `[]`, `changed` `['a003', 'a005', 'a002']`.
  - `planBulkLink.length === 4`.
  - 액팅: `planBulkLink(액팅 제안, ['act-3', 'act-5'], 같은 링크, 액팅 호출의 결과)` → `writes`가 `[{ 'act-3', 'A003', before: null }, { 'act-5', 'A005', before: 'G:\\old\\A005.moho' }]` · `planBulkUndo([{ 'act-3', 'A003', before: null }], FILE, 'acting', 링크(act-3의 액팅 칸 → FILE, 배경 칸 → 'G:\\bg\\other.psd'), 'me')` → `steps` `[{ kind: 'delete', sceneUuid: 'act-3', sceneId: 'A003' }]`, `kept` `[]`.
  - `planBulkUndo(위 writes 셋, FILE, 'bg', 링크, 'me')`: 링크가 `bg-3` → `FILE`, `bg-5` → `'G:\\other\\changed.moho'`, `bg-2` → `FILE`(고친 사람 모두 `'me'`)이면 `steps` `[{ kind: 'delete', 'bg-3', 'a003' }, { kind: 'restore', 'bg-2', 'a002', path: 'G:\\old\\layout12.moho' }]`, `kept` `['a005']` · 링크가 하나도 없으면 `steps` `[]`, `kept` `['a003', 'a005', 'a002']` · **경로는 같은데 고친 사람이 다르면 손대지 않는다**: `bg-3` → `FILE`(`'someone'`), `bg-5` → `FILE`(`'me'`), `bg-2` → `FILE`(`null`), 다섯째 인자 `'me'` → `steps` `[{ kind: 'restore', 'bg-5', 'a005', path: 'G:\\old\\a005.moho' }]`, `kept` `['a003', 'a002']` · `userId`가 `null`일 때: `bg-3` → `FILE`(`null`), `bg-5` → `FILE`(`null`), 다섯째 인자 `null` → `steps`가 삭제 a003·복원 a005, `kept` `['a002']`.
  - 문구(글자 그대로): `BULK_LINK_TEXT`의 열 값(설계 4.8 — `deepEqual`) · `bulkLinkLead({ linkedSceneId: 'a001', department: 'bg' })` → `'방금 a001의 배경 대표 파일로 연결했어요. 아래에서 고른 씬에도 배경 대표 파일로 연결해요.'`, `'acting'`이면 두 곳 모두 `액팅` · `bulkLinkLayoutHeading('12')` → `'같은 레이아웃(#12)인 씬'` · `bulkLinkRowParts({ state: 'replace', currentPath: 'G:\\old\\a005.moho' }, true)` → `{ text: '지금: a005.moho', mark: '→ 이 파일로 바뀜', path: 'G:\\old\\a005.moho' }`, 둘째 인자 `false`면 `mark`만 `'체크하면 이 파일로 바뀜'`, 경로가 이름뿐(`'a005.moho'`)이면 `path` `null`, 폴더로 끝나는 경로(`'G:\\old\\folder\\'`)면 `text` `'지금: G:\\old\\folder\\'`·`path` `null` · 나머지 셋(둘째 인자와 무관): `empty` → `{ text: '비어 있음', mark: null, path: null }`, `same`(`currentPath`가 있어도) → `{ text: '이미 이 파일', mark: null, path: null }`, `unavailable` → `{ text: '아직 저장 중인 씬이라 연결할 수 없어요', mark: null, path: null }` · `bulkLinkNotFoundText(['a011', 'a013'])` → `'파일 이름에는 있지만 이 파트에 없는 씬: a011, a013'` · `bulkLinkSourceChangedText('a001')` → `'그 사이 a001의 파일이 바뀌어서 다른 씬에는 연결하지 않았어요'` · `bulkLinkRecheckFailedText('a001')` → `'연결 상태를 확인하지 못해서 다른 씬에는 연결하지 않았어요. a001의 상세 창에서 대표 파일의 연필(수정) 버튼으로 같은 파일을 다시 저장하면 다시 물어봐요'` · `bulkLinkConfirmLabel(3)` → `'선택한 3개에 연결'`, `(0)` → `'연결할 씬을 골라 주세요'` · `sceneIdList(['a003','a005','a007','a009'])` → `'a003, a005, a007 외 1개'` · `bulkLinkReplaceNote(3)` → `'이 중 3개는 지금 연결된 파일이 바뀌어요'`, `(1)` → `'이 중 1개는 지금 연결된 파일이 바뀌어요'`, `(0)` → `''`.
  - 결과 문구: `bulkLinkResultText({ linked: ['a003','a005','a007'], failed: [], changed: [] })` → `'씬 3개에 연결했어요'` · `({ linked: ['a003'], failed: ['a005','a007'], changed: ['a009'] })` → `'씬 1개에 연결했어요 · 2개는 연결하지 못했어요(a005, a007) · 1개는 그 사이 바뀌어서 그대로 뒀어요(a009)'` · `({ linked: [], failed: ['a003','a005','a007','a009'], changed: [] })` → `'4개는 연결하지 못했어요(a003, a005, a007 외 1개)'` · 셋 다 비면 `'이미 모두 이 파일에 연결돼 있어요'` · `bulkUndoResultText({ undone: ['a003','a005'], failed: [], kept: [] })` → `'씬 2개를 되돌렸어요'` · `({ undone: ['a003'], failed: ['a005'], kept: ['a007'] })` → `'씬 1개를 되돌렸어요 · 1개는 되돌리지 못했어요(a005) · 1개는 그 뒤에 바뀌어서 그대로 뒀어요(a007)'` · 셋 다 비면 `'되돌릴 것이 없어요'`.
- [ ] **Step 2: 실패를 확인한다** — `does not provide an export named '…'`(파일 전체. Task 4의 테스트도 함께 실패로 보인다).
- [ ] **Step 3: 구현** — 4.1의 선언 아래에 설계 4.7의 타입(`BulkLinkWrite`·`BulkLinkPlan`·`BulkUndoStep`·`BulkUndoPlan`)과 4.8의 `BULK_LINK_TEXT`·`BulkLinkRowParts`를, `buildBulkLinkOffer` 아래에 설계 4.9의 나머지를 글자 그대로:
  - `planBulkLink(offer: BulkLinkOffer, selectedKeys: readonly string[], linkMap: ReadonlyMap<string, SceneWorkLink>, scope: BulkLinkScope | null): BulkLinkPlan` — 고른 후보(uuid 있고 `empty`·`replace`)마다: 다시 찾은 묶음에 uuid도 번호 글자도 같은 씬이 없으면 `changed` → 이미 이 파일이면 `same` → 창을 열 때 본 경로와 다르면 `changed` → 그대로면 `writes`(`before` = 지금 경로).
  - `planBulkUndo(writes: readonly BulkLinkWrite[], path: string, department: SceneWorkLinkDepartment, linkMap: ReadonlyMap<string, SceneWorkLink>, userId: string | null): BulkUndoPlan` — 경로가 그대로이고 `updatedBy`도 `userId`일 때만 내 것: `before === null`이면 `delete`, 있으면 `restore`. 아니면 `kept`.
  - `DEPARTMENT_LABEL`(비공개, `{ bg: '배경', acting: '액팅' }`) · `bulkLinkLead(offer: Pick<BulkLinkOffer, 'linkedSceneId' | 'department'>): string` · `bulkLinkLayoutHeading(layout: string): string` · `bulkLinkRowParts(candidate: Pick<BulkLinkCandidate, 'state' | 'currentPath'>, checked: boolean): BulkLinkRowParts`(`replace` 줄의 표시는 체크를 따른다) · `bulkLinkNotFoundText(ids: readonly string[]): string` · `bulkLinkConfirmLabel(count: number): string` · `bulkLinkReplaceNote(replaceCount: number): string`(0이면 `''`) · `sceneIdList(ids: readonly string[], max = 3): string` · `bulkLinkResultText(result: { linked: readonly string[]; failed: readonly string[]; changed: readonly string[] }): string` · `bulkLinkSourceChangedText(linkedSceneId: string): string` · `bulkLinkRecheckFailedText(linkedSceneId: string): string` · `bulkUndoResultText(result: { undone: readonly string[]; failed: readonly string[]; kept: readonly string[] }): string`. 화면에 보이는 글에 "칸"이라는 낱말은 없다.
- [ ] **Step 4:** `node --test tests/sceneBulkWorkLink.test.ts` → 통과.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links` → 테스트 수 증가, fail 0. `npm run test:presence` → tests 39 / fail 0.
- [ ] **Step 6: 커밋** — 두 파일 / `씬 한꺼번에 연결: 누르는 순간의 실행 계획과 되돌리기 계획(경로와 마지막으로 고친 사람), 창과 알림의 문구`

**이 Task가 끝나면 앱은:** v1.133.0과 같다(순수 모듈 둘이 다 됐고 아직 아무 화면도 부르지 않는다).

---

## Chunk 3: 창과 배선 (설계 14절 4·5·6단계)

### Task 6: 체크 목록 창과 호스트 — `BulkWorkLinkDialog.tsx`, `App.tsx`

**Files:**
- Create: `src/components/scenes/BulkWorkLinkDialog.tsx`
- Modify: `src/App.tsx`

**Read first:** 설계 6.1~6.4 전부, 2.7(확인 창·네이티브 `<dialog>`·풍선), 1.4의 R6~R8, 11.4의 앵커 4·8(Task 11이 읽을 글자), 15.2의 "앱 엔진에서 확인할 것" 표 · 본보기: `src/features/backgrounds/BackgroundUI.tsx`의 `BackgroundModal`(`showModal()`과 포커스 되돌리기), `src/components/common/ConfirmDialog.tsx` 전체 · `src/App.tsx`의 `<ConfirmDialogHost />` 줄과 그 import 줄.

테스트를 먼저 쓰지 않는다(설계 11.6 끝 — 창의 판단은 모두 Task 4·5의 순수 함수에 있다). 자가 점검과 Task 11의 앵커 8이 고정한다.

- [ ] **Step 1: 호스트와 부르는 객체** — import: `useEffect, useId, useRef, useState`(react), `createPortal`(react-dom), `cn`(`@/utils/cn`), 그리고 `@/utils/sceneBulkWorkLink`에서 `BULK_LINK_TEXT, bulkLinkConfirmLabel, bulkLinkLayoutHeading, bulkLinkLead, bulkLinkNotFoundText, bulkLinkReplaceNote, bulkLinkRowParts, type BulkLinkCandidate, type BulkLinkOffer`. 그 아래 설계 6.1의 첫 코드 블록(`type Pending` · `let externalShow` · `let pending` · `settle` · `BulkWorkLinkDialog` · `BulkWorkLinkDialogHost`)을 **주석까지 글자 그대로**, 그리고 설계 6.3의 `const stop = (event: React.SyntheticEvent) => { event.stopPropagation(); };`와 그 위 주석 한 줄(`React.SyntheticEvent`는 이 저장소의 다른 컴포넌트처럼 import 없이 쓰는 타입 이름이다).
- [ ] **Step 2: 창 본체 `BulkWorkLinkWindow`** — 설계가 조각으로 준 것을 아래 꼴로 잇는다. 이름 둘을 지킨다: 체크된 열쇠의 집합은 `checkedKeys`, 줄 하나의 참·거짓은 `checked`(설계 6.1은 둘을 모두 `checked`라 부른다 — 한 함수 안에서 겹치지 않게 집합 쪽 이름만 바꿨다. 앵커는 `bulkLinkRowParts(row, checked)`를 읽는다).
  ```tsx
  function BulkWorkLinkWindow({ offer, onClose }: { offer: BulkLinkOffer; onClose: (keys: string[] | null) => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const leadId = useId();
    const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(
      () => new Set(offer.candidates.filter((row) => row.checked).map((row) => row.key)),
    );
    useEffect(() => {
      const previous = document.activeElement as HTMLElement | null;
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')?.focus();
      return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const toggle = (key: string) => setCheckedKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    const picked = offer.candidates.filter((row) => checkedKeys.has(row.key) && (row.state === 'empty' || row.state === 'replace'));
    const count = picked.length;
    const replaceCount = picked.filter((row) => row.state === 'replace').length;
    const submit = () => { if (count > 0) onClose(picked.map((row) => row.key)); };
    const renderRow = (row: BulkLinkCandidate) => {
      const checked = checkedKeys.has(row.key);
      const disabled = row.state === 'same' || row.state === 'unavailable';
      const parts = bulkLinkRowParts(row, checked);
      return (…설계 6.1의 줄 블록 — <label key={row.key} className={cn(…)}> … </label>…);
    };
    const renderGroup = (group: BulkLinkCandidate['group'], legend: string) => {
      const rows = offer.candidates.filter((row) => row.group === group);
      if (rows.length === 0) return null;
      return (
        <fieldset className="mt-2 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-[10.5px] font-bold text-text-secondary">{legend}</legend>
          <div className="flex flex-col gap-1.5">{rows.map(renderRow)}</div>
        </fieldset>
      );
    };
    return createPortal(…설계 6.1의 <dialog ref={dialogRef} …> 블록…, document.body);
  }
  ```
  - `…`로 적은 두 자리에는 설계의 JSX를 넣는다(주석으로 남기지 않는다 — 이 파일은 설계의 주석 말고는 주석을 갖지 않는다).
  - `<dialog>` 블록은 설계 6.1의 것을 속성·클래스까지 글자 그대로 쓴다(`aria-labelledby={titleId}`, `aria-describedby={leadId}`, `onCancel`, `onKeyDown={stop}`, `onPaste={stop}`, 뒤 배경 누름의 `onMouseDown`, 머리·목록 칸·버튼 칸). 목록 칸 안의 주석 두 줄 자리에는 `{renderGroup('named', BULK_LINK_TEXT.named)}`, `{renderGroup('layout', bulkLinkLayoutHeading(offer.layout))}`, `{offer.notFound.length > 0 && <p className="mt-3 text-[11px] text-text-secondary">{bulkLinkNotFoundText(offer.notFound)}</p>}`를 이 순서로 넣는다. 빈 묶음은 머리글째 그리지 않는다.
  - 줄(`<label>`)은 설계 6.1의 블록 그대로: 체크 칸 `checked={checked} disabled={disabled} onChange={() => toggle(row.key)}`, 씬 번호, `parts.text`·`parts.path`, `parts.mark`(체크돼 있으면 상자, 풀려 있으면 흐린 글씨).
  - 버튼 둘은 `type="button"`. 오른쪽 버튼만 `onClick={submit}`이다. **Enter를 따로 다루는 코드를 쓰지 않는다**(`onKeyDown`은 `stop` 하나뿐). `title` 속성과 `truncate` 클래스를 쓰지 않는다 — 긴 이름·경로는 `break-all`로 줄을 바꾼다. 새 CSS 파일·새 클래스·새 애니메이션 없음(`bf-modal-in`만).
- [ ] **Step 3: `src/App.tsx`** — import 줄 `import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';` 다음에 `import { BulkWorkLinkDialogHost } from '@/components/scenes/BulkWorkLinkDialog';`. `<ConfirmDialogHost />` 줄 바로 아래에 같은 들여쓰기로 `<BulkWorkLinkDialogHost />`. `WidgetPopup.tsx`·`FeedbackHubPreviewApp.tsx`에는 달지 않는다.
- [ ] **Step 4: 자가 점검** — `BulkWorkLinkDialog.tsx`: `showModal()`·`type="checkbox"` 각 1곳 이상 · `aria-labelledby={titleId}`·`onCancel=`·`onKeyDown={stop}`·`onPaste={stop}`·`event.stopPropagation();`·`isOpen: (): boolean => pending !== null`·`bulkLinkRowParts(row, checked)`·`bulkLinkReplaceNote(replaceCount)` 각 1곳 · `submit`이 **정확히 2곳**(`const submit = `과 `onClick={submit}`) · `externalShow = null;` 다음 줄이 `settle(null);` · **0곳이어야 하는 글자**: `window.confirm`, `'Enter'`, `"Enter"`, `title=`, `truncate`, `openNow`, `electronAPI`, `supabase`. `src/App.tsx`: `<BulkWorkLinkDialogHost />`가 정확히 1곳이고 `<ConfirmDialogHost />`보다 뒤.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links`·`npm run test:presence` → fail 0(수는 그대로).
- [ ] **Step 6: 전체 게이트** — `src/App.tsx`는 다른 스크립트의 테스트 여럿이 글자로 읽는 파일이다. `npm run build:vite`를 로그 파일(공통 규칙의 스크래치 자리)로 받아(몇 분 걸린다 — 시간 제한을 넉넉히) 본다: `# fail 0` 줄이 테스트 스크립트 수만큼(13)이고 `# fail [1-9]`가 없다, `vite build`의 `built in` 줄, 마지막 `[generate-manifest] … manifest.json 생성` 줄.
- [ ] **Step 7: 커밋** — 두 파일(`dist/`는 올리지 않는다) / `씬 한꺼번에 연결: 체크 목록 창과 호스트 — 네이티브 dialog로 띄우고, Enter로는 연결하지 않고, 키 입력과 붙여넣기는 창에서 멈춘다(아직 띄우는 곳 없음)`

**이 Task가 끝나면 앱은:** v1.133.0과 같다. 호스트가 `App`에 달렸지만 `BulkWorkLinkDialog.show`를 부르는 곳이 없어 창은 뜨지 않는다.

### Task 7: 배선 — 제안과 한꺼번에 연결, 붙여넣기 칸의 겹친 저장 막기

**Files:**
- Create: `src/services/sceneBulkWorkLinkActions.ts`
- Modify: `src/services/sceneWorkLinkActions.ts`, `src/components/scenes/SceneWorkLinksPanel.tsx`

**Read first:** 설계 5절 전부, 7.1, 7.2, 7.3, 8.1, 8.2, 8.4, 1.4의 R1~R4, 11.4의 앵커 1~6·12, 14절 5단계 · `src/services/sceneWorkLinkActions.ts` 전체(95줄) · `SceneWorkLinksPanel.tsx`의 `const savePath = async (nextPath: string) => {`부터 `const handleChoose`까지 · `src/stores/useSceneWorkLinkStore.ts`의 `loadForSceneUuids`·`upsertLink` · `src/utils/sceneWorkLinks.ts`의 `getSceneWorkLinkSlots`.

- [ ] **Step 1: `sceneBulkWorkLinkActions.ts`(이 Task의 꼴)** — 파일의 차례는 끝까지 이렇다: import 블록 → 상수 셋 → `let offerRun = 0;` → `otherModalOpen` → `reloadLinks` → (`refreshLinks` — Task 8) → `offerBulkWorkLink` → `runBulkWorkLink` → (`undoBulkWorkLink` — Task 8). 앵커가 이 차례로 본문을 자른다.
  - 설계 7.1의 코드 블록을 **`refreshLinks` 함수와 그 위 주석만 빼고** 글자 그대로(주석 포함). import 블록은 통째로 쓴다 — 이 Task에서 아직 쓰지 않는 이름 넷(`showUndoToast`, `BULK_LINK_TEXT`, `bulkUndoResultText`, `planBulkUndo`)은 Task 8이 쓴다(`noUnusedLocals`가 꺼져 있어 타입 검사를 지난다). 상수 셋 `BULK_LINK_OFFER_MAX_WAIT_MS = 3000`·`BULK_LINK_RECHECK_MAX_WAIT_MS = 1500`·`BULK_LINK_UNDO_MS = 10_000`도 지금 넣는다.
  - `otherModalOpen(): boolean` — `[role="dialog"][aria-modal="true"]`이거나 `dialog[open]`인 요소가 문서에 있다.
  - `reloadLinks(sceneUuids: string[]): Promise<boolean>` — 그 씬들을 다시 읽고 **제때 마쳤을 때만 참**. 실패하거나 1.5초를 넘기면 거짓.
  - `offerBulkWorkLink(input: { sceneUuid: string; department: SceneWorkLinkDepartment; path: string; userId: string | null; savedToastId?: string | number }): Promise<void>` — 던지지 않는다(함수 전체가 `try`/`catch`). 차례: 창이 떠 있으면 돌아감 → `findBulkLinkScope` → 후보의 링크 읽기 → 그 사이 다른 저장이 있었거나 창이 떴으면 돌아감 → 3초를 넘겼으면 돌아감 → 연결한 씬의 칸이 아직 이 파일인지 → `buildBulkLinkOffer` → 다른 모달이 떠 있으면 돌아감 → `BulkWorkLinkDialog.show` → `runBulkWorkLink`.
  - `runBulkWorkLink(offer: BulkLinkOffer, selectedKeys: string[], userId: string | null, savedToastId: string | number | undefined): Promise<void>` — **이 Task에서는 설계 7.2의 블록에서 세 곳만 다르다**(Task 8이 설계의 글자로 되돌린다): ① 맨 앞의 주석 한 줄과 `if (savedToastId !== undefined) toast.dismiss(savedToastId);` 한 줄이 아직 없다(매개변수는 있고 쓰지 않는다) ② `// 쓰기의 응답이 모두 돌아왔다 …` 주석과 `refreshLinks(plan.writes.map((write) => write.sceneUuid));` 줄이 아직 없다 ③ 끝의 `showUndoToast({ … });` 자리가 `toast.success(message);` 한 줄이다. 나머지(다시 읽기 → `if (!fresh)` → 상태 꺼내기 → 연결한 씬의 칸 확인 → 지금의 씬 자료로 묶음 다시 찾기 → `planBulkLink` → `Promise.allSettled` → `done`·`failed` → 결과 글자 → 하나도 못 했을 때의 `toast.error`/`toast`)는 7.2 그대로다.
- [ ] **Step 2: `sceneWorkLinkActions.ts`(설계 8.1)** — import에 `import { offerBulkWorkLink } from '@/services/sceneBulkWorkLinkActions';`. `saveWorkLinkPathGuarded`의 성공 가지에서 `toast.success(existingPath ? '작업 링크를 변경했습니다' : '작업 링크를 연결했습니다');` 줄을 설계 8.1의 다섯 줄로 바꾼다(`const savedToastId = toast.success(…);` → 주석 → `if (linkKind === 'primary_file') {` → `void offerBulkWorkLink({ sceneUuid, department, path, userId: userId ?? null, savedToastId });` → `}`), 그 뒤 `return true;`는 그대로. `chooseAndLinkWorkPath`와 부르는 여섯 군데는 고치지 않는다. `git diff --numstat` → `6	1	src/services/sceneWorkLinkActions.ts`.
- [ ] **Step 3: `SceneWorkLinksPanel.tsx`(설계 8.4)** — `const savePath = async (nextPath: string) => {` 바로 다음 줄에 `    if (saving) return;   // 저장이 도는 중에는 또 저장하지 않는다(붙여넣기 칸의 Enter는 버튼과 달리 막혀 있지 않다)`. 그 밖에는 한 글자도 바꾸지 않는다. `git diff --numstat` → `1	0	src/components/scenes/SceneWorkLinksPanel.tsx`.
- [ ] **Step 4: 자가 점검** — `sceneWorkLinkActions.ts`: `offerBulkWorkLink(` 1곳, `await offerBulkWorkLink(` 0곳, `if (linkKind === 'primary_file') {` 1곳, `const savedToastId = toast.success(` 1곳이고 `await useSceneWorkLinkStore.getState().upsertLink(`보다 뒤, **그 뒤 처음 나오는** `} catch (err) {`보다 앞(파일의 첫 `} catch (err) {`는 저장 전 읽기의 것이라 `upsertLink`보다 앞에 있다 — 그것과 견주지 않는다). `sceneBulkWorkLinkActions.ts`: `sceneWorkLinkActions`·`saveWorkLinkPathGuarded`·`chooseAndLinkWorkPath`·`electronAPI`·`supabase` 각 0곳 · `offerBulkWorkLink(` 1곳(선언) · `if (BulkWorkLinkDialog.isOpen()) return;` 1곳이고 `try {` 바로 다음 줄 · `if (otherModalOpen()) return;` 1곳 · `store.upsertLink(` 1곳 · `Promise.allSettled(` 1곳 · `Promise.all(` 0곳 · `const store = useSceneWorkLinkStore.getState();`가 `const fresh = await reloadLinks(`보다 뒤. `SceneWorkLinksPanel.tsx`: `if (saving) return;` 1곳이고 `setSaving(true);`보다 앞.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links`·`npm run test:presence` → fail 0.
- [ ] **Step 6: 커밋** — 세 파일 / `씬 한꺼번에 연결: 대표 파일 저장이 성공하면 같은 파일을 쓸 씬을 찾아 묻고 고른 씬에 연결한다 — 누르는 순간 다시 읽고, 읽지 못했으면 쓰지 않는다. 붙여넣기 칸의 겹친 Enter는 한 번만 저장`

**v1.133.0과 달라지는 것(이 Task에서 기능이 켜진다):**
- 대표 파일(`primary_file`) 저장이 성공하면 — 우클릭 메뉴든 상세 창이든 — 같은 파트의 이름 묶음·레이아웃 묶음을 찾아 창을 띄운다. 폴더 저장, 실패한 저장, 확인을 취소한 저장은 지금과 한 글자도 다르지 않다. `saveWorkLinkPathGuarded`가 돌려주는 `true`의 때도 그대로다(제안을 기다리지 않는다).
- **(기능 밖의 한 줄) 경로 붙여넣기 칸에서 저장이 도는 중에 친 둘째 Enter는 아무 일도 하지 않는다.** 전에는 저장을 또 불러, 방금 넣은 그 경로를 두고 "이미 연결된 경로가 있어요" 헛확인 창이 떴다. 지키는 것: 관문 A의 K3b, Task 11의 앵커 12.
- 이 Task에서는 결과 알림이 되돌리기 없는 `toast.success`이고 한 칸 알림("작업 링크를 연결했습니다")도 닫지 않는다 — 두 장이 함께 보일 수 있다. Task 8이 고친다.
**이 Task가 끝나면 앱은:** 창이 뜨고 "선택한 N개에 연결"로 연결된다. 되돌리기는 아직 없다.

### 관문 A — 엔진 확인 E1~E6, V1·V2(일부), K3b (Task 7 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

방법: 설계 12절 머리말 그대로(`npm run dev:renderer` + `npm run preview:electron`, Electron 33, 미리보기 시험 계정, **실제 입력**, 주소는 `?preview=1` — `?preview=feedback-hub`에서 창이 안 뜨는 것은 고장이 아니다). 1440×900 어두운 화면에서 모두 보고 ★ 항목은 740×900·밝은 화면에서 다시 본다. 경로는 상세 창의 "경로 붙여넣기"로 넣고, 도구 T1~T6은 설계 12절의 글자 그대로 콘솔에 넣는다. 설계 14절 5단계가 적은 것은 E1~E6과 V1·V2다. **K3b는 이 계획이 여기에 더했다** — 8.4의 한 줄이 Task 7에서 들어오고, 그 대체안(설계 15.2)이 앵커 12가 읽을 글자를 바꾸기 때문이다.

| 확인(할 일과 봐야 할 것은 설계 12절의 그 항목 그대로) | 요약 | 다르면(설계 15.2) |
|---|---|---|
| E1 ★ | 창이 상세 창 **위**에 뜨고 뒤가 눌리지 않고 Tab이 창 밖으로 나가지 않는다 | `ConfirmDialog` 꼴로 바꾼다: `fixed inset-0 z-[9999]` 포털 `<div>` + `role="dialog" aria-modal="true"`인 상자, Tab은 `onKeyDown`에서 첫·끝 요소 사이를 돌린다. 문구와 6.3의 규칙은 그대로 |
| E2 ★ · E2b ★ · E2c | Esc는 이 창만 닫고, 화살표·숫자 1~6·Ctrl+V가 뒤의 창에 닿지 않는다(버튼에 포커스가 있을 때도) | 창이 떠 있는 동안 `window`에 캡처 리스너를 달아 **대상이 창 안인 모든 `keydown`·`paste`**에 `stopImmediatePropagation`. Escape만은 리스너가 직접 `onClose(null)` |
| E3 | 뒤 어두운 곳을 누르면 닫히고, 창 안의 빈 곳은 닫히지 않는다 | 바깥 누름으로 닫기를 뺀다(완료 보고에 적는다) |
| E4 ★ | 뒤 배경이 반투명 검정, "→ 이 파일로 바뀜"과 "체크하면 이 파일로 바뀜"이 밝은·어두운 화면에서 읽힌다(V4의 준비가 필요하다) | 배경이 투명하면 `[&::backdrop]:bg-black/50` · 표시의 대비가 모자라면 바탕만 `bg-accent/15` · 풀린 줄의 글자가 안 읽히면 그 글자색만 `text-text-primary/80` |
| E5 | 닫힌 뒤 Tab이 사라진 요소에 갇히지 않는다 | 대체안 없음 — 원인을 찾는다(@superpowers:systematic-debugging) |
| E6 ★ | 풍선이 뜨지 않고, 잘린 글자("…")가 어디에도 없다 | 머리가 너무 길면 머리의 경로 줄에만 `max-h-16 overflow-y-auto`. **말줄임과 `title`로 돌아가지 않는다** |
| V1 ★ | 알림 "작업 링크를 연결했습니다" 뒤 창. 안내·파일 이름·경로, a003·a005 "비어 있음" ☑, "파일 이름에는 있지만 이 파트에 없는 씬: a011", 버튼 "이 씬만"/"선택한 2개에 연결" | 대체안 없음 — 원인을 찾는다 |
| V2(일부) | 창이 바로 닫히고 a003·a005에 파일이 걸린다. **알림 한 장·'되돌리기'·10초 막대는 관문 B에서 본다** | 같다 |
| K3b ★ | `slowRead(1000, 'a001')` 뒤 빈 칸에 붙여 넣고 1초 안에 Enter 두 번 → 확인 창이 **뜨지 않고** 알림 한 장과 이 창 | 상태 대신 ref: `const savingRef = useRef(false)`, `savePath` 맨 앞에서 `if (savingRef.current) return; savingRef.current = true;`, `finally`에서 `false` |

- **대체안을 골랐으면** 그 변경을 따로 커밋하고(`씬 한꺼번에 연결: 관문 A — <고른 대체안>`), 이 절 끝에 `관문 A 결과:` 한 줄로 무엇을 어떻게 바꿨는지 적는다 — Task 8·11·12의 작업자가 읽는다. 대체안은 Task 11의 앵커가 읽는 글자를 바꾼다: E1 → 앵커 8의 `showModal()`·`onCancel=`, E2 → 앵커 8의 `onKeyDown={stop}`·`onPaste={stop}`, K3b → 앵커 12의 `if (saving) return;`. 그 앵커는 고른 구현의 글자로 쓰고, `AGENTS.md` 절과 완료 보고의 그 줄도 구현대로 적는다.
- 대체안 없이 통과했으면 `관문 A 결과: 대체안 없음` 한 줄을 적는다.
- 결과 줄을 적은 뒤 **계획 파일만 따로 커밋한다**(`문서: 씬 한꺼번에 연결 관문 A 결과`) — Task 8이 시작될 때 `git status --short`가 비어 있어야 한다.

**관문 A 결과: 대체안 없음** (2026-10-10, HEAD 6c8d379f, 검사 창 Electron 33·1440×900·어두운 화면, ★는 밝은 화면도). E1 창이 상세 창 위에 뜨고 뒤가 눌리지 않는다 — Tab은 체크 칸 → '이 씬만' → 연결 버튼 → (문서 본문에 한 번 머묾: `showModal()`의 기본 동작이며 뒤의 어떤 버튼도 포커스를 받지 않는다) → 다시 첫 체크 칸. E2·E2b·E2c Esc는 이 창만 닫고, 버튼에 포커스가 있을 때의 좌우 화살표·숫자 2·3·5가 뒤의 상세 창(씬 화면과 컴포지팅 대시보드)에 닿지 않는다. 붙여넣기는 버튼에서 낸 이벤트가 `window`에 닿지 않는 것으로 봤다(실제 그림을 클립보드에 넣지는 않았다). E3 뒤의 어두운 곳을 누르면 닫히고 창 안의 빈 곳은 닫히지 않는다. E4 뒤 배경 `rgba(0,0,0,0.5)`, '→ 이 파일로 바뀜'(상자)과 '체크하면 이 파일로 바뀜'(흐린 글씨)이 두 화면에서 읽힌다. E5 닫힌 뒤 Tab은 갇히지 않고 문서의 첫 요소(사이드바)로 간다 — 붙여넣기 칸이 저장 뒤 사라져 돌려줄 자리가 없기 때문이며 v1.133.0의 한 칸 저장 뒤와 같다. E6 `title` 0개, 말줄임 0개. V1 문구·줄·버튼이 설계 그대로. V2(일부) 창이 바로 닫히고 a003·a005에 파일이 걸린다. K3b 저장 전 읽기를 1초 늦추고 Enter 두 번 → 확인 창 없음, 알림 한 장과 이 창. D3 컴포지팅 대시보드의 씬 창에서도 창이 뜬다. 콘솔 경고·오류 0.

### Task 8: 되돌리기 — `showUndoToast`·`undoBulkWorkLink`·정리 읽기·한 칸 알림 닫기

**Files:**
- Modify: `src/services/sceneBulkWorkLinkActions.ts`

**Read first:** 관문 A 결과 줄 · 설계 7.1의 `refreshLinks`, 7.2 전부(코드와 불릿), 7.3, 7.4 전부, 5절의 끝 세 문단, 11.4의 앵커 6, 15.2의 V2·F11/F12 행 · `src/components/common/UndoToast.tsx`의 `showUndoToast` · `useSceneWorkLinkStore.ts`의 `deleteLink`.

- [ ] **Step 1: `refreshLinks`** — `reloadLinks` 바로 아래, `offerBulkWorkLink` 위에 설계 7.1의 `refreshLinks(sceneUuids: string[]): void`를 주석까지 글자 그대로(쓰기가 모두 돌아온 뒤의 정리 읽기 — 기다리지 않고 `void`, 실패는 삼킨다. 본문에 `await`가 없다).
- [ ] **Step 2: `runBulkWorkLink`를 설계 7.2의 글자로** — Task 7에서 뺀 세 곳을 넣는다: ① 맨 앞의 주석과 `if (savedToastId !== undefined) toast.dismiss(savedToastId);` ② `Promise.allSettled` 결과를 가른 뒤의 주석과 `refreshLinks(plan.writes.map((write) => write.sceneUuid));` ③ 끝의 `toast.success(message);`를 `showUndoToast({ message, durationMs: BULK_LINK_UNDO_MS, onUndo: () => { void undoBulkWorkLink(offer, done, userId); }, onExpire: () => {} });`(설계의 줄 나눔 그대로). 끝나면 이 함수는 설계 7.2의 블록과 글자가 같다.
- [ ] **Step 3: `undoBulkWorkLink`** — 파일 끝에 설계 7.4의 `undoBulkWorkLink(offer: BulkLinkOffer, writes: BulkLinkWrite[], userId: string | null): Promise<void>`를 주석까지 글자 그대로: `offerAgain`(못 되돌린 것을 들고 '되돌리기'를 다시 건다) → 다시 읽기 → 읽지 못했으면 **쓰지 않고** `offerAgain(BULK_LINK_TEXT.undoRecheckFailed, writes);` 뒤 `return` → 상태 꺼내기 → `planBulkUndo(writes, offer.path, offer.department, store.linkMap, userId)` → `Promise.allSettled`(삭제는 `store.deleteLink`, 복원은 `store.upsertLink`) → 실패한 것은 `before`를 다시 만들어 모으고 `console.warn`에 예전 경로를 남긴다 → `refreshLinks` → 실패가 있으면 `offerAgain(message, failed)`, 아니면 `toast.success`/`toast`. **이 함수에는 `toast.error`가 없다.**
- [ ] **Step 4: 자가 점검** — 파일이 "설계 7.1 블록 + 7.2 블록 + 7.4 블록"을 이어 붙인 것과 같다(관문 A에서 고친 곳이 있으면 그것만 다르다). 횟수: `Promise.allSettled(` 2 · `showUndoToast(` 2 · `toast.dismiss(savedToastId)` 1 · `Promise.all(` 0 · `refreshLinks(` 3(선언 1 + 호출 2) · `reloadLinks(` 3 · `offerAgain(` 2 · `store.deleteLink(` 1 · `store.upsertLink(` 2 · `planBulkUndo(writes, offer.path, offer.department, store.linkMap, userId)` 1 · `async function undoBulkWorkLink(`부터 파일 끝까지에 `toast.error(` 0, `showUndoToast(` 1. 금지 낱말 다섯(Task 7의 Step 4)은 여전히 0곳.
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links`·`npm run test:presence` → fail 0.
- [ ] **Step 6: 커밋** — 한 파일 / `씬 한꺼번에 연결: 10초 되돌리기 — 읽지 못했거나 못 되돌린 것은 들고 다시 걸고, 쓰기 뒤 한 번 읽어 맞추고, 한 칸 알림은 결과 알림이 잇는다`

**v1.133.0과 달라지는 것:** "선택한 N개에 연결"을 누르면 한 칸 알림이 닫히고 결과 알림 한 장("씬 N개에 연결했어요 · 되돌리기", 10초 — 다른 되돌리기는 5초)이 뜬다. 되돌리기는 경로가 그대로이고 마지막으로 고친 사람도 자기인 칸만 되돌리고, 처음 연결한 씬은 건드리지 않는다. "이 씬만"으로 닫으면 추가 알림이 없다.
**이 Task가 끝나면 앱은:** 설계 1.1의 동작 전부(창 → 연결 → 되돌리기)가 된다.

### 관문 B — 되돌리기 V2·V3·V5·F11·F12 (Task 8 뒤 · **오케스트레이터가 한다**)

방법은 관문 A와 같다. 할 일과 봐야 할 것은 설계 12절의 그 항목 그대로다.

| 확인 | 요약 | 다르면(설계 15.2) |
|---|---|---|
| V2 ★ | 알림 **한 장** "씬 2개에 연결했어요 · 되돌리기"(앞의 "작업 링크를 연결했습니다"는 사라졌다), 막대가 10초 동안 줄어든다 | 두 장이 겹치면 한 칸 알림에 고정 id(`'scene-work-link-saved'`)를 주고 그 id를 닫는다 — 앵커 1·6이 읽는 글자(`const savedToastId = toast.success(`, `toast.dismiss(savedToastId)`)가 바뀌므로 `관문 B 결과`에 적는다 |
| V3 ★ · V5 ★ | 되돌리면 비어 있던 씬은 비고, 바뀐 씬은 예전 파일로 돌아온다. a001은 그대로. 창이 다시 뜨지 않는다 | 대체안 없음 — 원인을 찾는다 |
| F11 ★ · F12 ★ | 읽지 못했거나 쓰기가 실패하면 되돌리기 알림이 **다시 뜨고**, 다시 누르면 되돌려진다. F12는 콘솔에 예전 경로가 적힌 경고 한 줄 | 새 알림이 뜨지 않으면 `offerAgain`에서 `setTimeout(…, 0)`으로 한 틱 미뤄 띄운다 |

- 관문 A와 같이 결과를 `관문 B 결과:` 한 줄로 이 절 끝에 적는다. 대체안을 골랐으면 따로 커밋한다.
- 결과 줄을 적은 뒤 **계획 파일만 따로 커밋한다**(`문서: 씬 한꺼번에 연결 관문 B 결과`) — Task 9가 시작될 때 `git status --short`가 비어 있어야 한다.

**관문 B 결과: 대체안 없음** (2026-10-10, HEAD dad21fd5, 검사 창 Electron 33·1440×900·어두운 화면). V2 연결 뒤 알림이 한 장 '씬 2개에 연결했어요 · 되돌리기'뿐이고(앞의 '작업 링크를 연결했습니다'는 사라졌다) 4초 뒤에도 떠 있다. V3 되돌리면 a003·a005가 다시 비고 '씬 2개를 되돌렸어요', a001은 그대로, 창이 다시 뜨지 않는다. V5 다른 파일이 있던 a003을 바꿨다가 되돌리면 `G:\old\a003.moho`로 돌아온다. F11 되돌리기의 다시 읽기를 실패시키면 '연결 상태를 확인하지 못해서 아직 되돌리지 않았어요 · 되돌리기'가 다시 뜨고(파일은 그대로), 읽기를 되살린 뒤 다시 누르면 되돌려진다. F12 되돌리기의 저장을 실패시키면 '1개는 되돌리지 못했어요(a003) · 되돌리기'가 다시 뜨고 콘솔에 `[sceneBulkWorkLink] 되돌리기 실패 a003 G:\old\a003.moho` 한 줄, 저장을 되살린 뒤 다시 누르면 예전 파일로 돌아온다. 알림을 한 틱 미루는 대체안은 필요 없었다.

---

## Chunk 4: 행 신호의 부담 줄이기 (설계 14절 7단계)

### Task 9: 모아서 한 번 부르기 — `createTrailingDebounce`

**Files:**
- Create: `electron/presence/trailingDebounce.ts`, `tests/presenceTrailingDebounce.test.ts`
- Modify: `package.json`

**Read first:** 설계 9.1, 9.2, 11.3, 11.4의 앵커 7(끝 문장) · `package.json`의 `"test:presence"` 줄.

- [ ] **Step 1: 테스트를 쓴다(설계 11.3)** — 가짜 시계: `let t = 0`, 타이머 목록, `now: () => t`, `setTimer: (fn, ms) => { const handle = { fn, at: t + ms }; timers.push(handle); return handle; }`, `clearTimer`는 목록에서 뺀다, `advanceTo(ms)`는 `at <= ms`인 타이머를 이른 것부터 `t = at`으로 맞추고 부른 뒤 `t = ms`. `run`은 횟수를 센다. `waitMs: 400`, `maxWaitMs: 2000`. 테스트마다 새 도우미와 새 시계를 만든다(아래 첫 두 줄만 한 테스트에서 이어서 본다).
  - 0·100·200·300·400ms에 다섯 번 예약 → 799ms까지 0번, 800ms에 **한 번**.
  - 그 뒤 1000ms에 예약 → 1400ms에 두 번째.
  - 3000ms부터 300ms마다 끊임없이 예약 → 5000ms에 한 번(첫 예약 + 2000). 6000ms에 마지막으로 예약하면 6400ms에 다음 것.
  - 예약 뒤 `cancel` → 돌지 않고 남은 타이머가 없다. `cancel`하고 3000ms 뒤에 다시 예약하면 그로부터 399ms까지는 돌지 않고 400ms에 돈다(`cancel`이 첫 예약 시각을 지우지 않으면 바로 돈다).
- [ ] **Step 2: 실패를 확인한다** — `node --test tests/presenceTrailingDebounce.test.ts` → `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 3: 구현** — 설계 9.2의 코드 블록을 주석까지 글자 그대로: `TrailingDebounce`(`schedule`·`cancel`), `TrailingDebounceOptions`(`waitMs`·`maxWaitMs`·`now?`·`setTimer?`·`clearTimer?`), `createTrailingDebounce(run: () => void, options: TrailingDebounceOptions): TrailingDebounce` — 마지막 예약에서 `waitMs` 뒤에 한 번, 끊이지 않아도 첫 예약에서 `maxWaitMs` 안에 한 번. **이 파일에는 import가 없다**(그 낱말을 주석에도 쓰지 않는다).
- [ ] **Step 4:** `node --test tests/presenceTrailingDebounce.test.ts` → 통과.
- [ ] **Step 5: 스크립트** — `package.json`의 `test:presence` 끝에 ` ./tests/presenceTrailingDebounce.test.ts`를 더한다(이 파일의 감시는 Task 11의 앵커 10이 한다).
- [ ] **Step 6:** `npm run typecheck` → 오류 없음(`electron/`은 `tsconfig.node.json`이 검사한다). `npm run test:presence` → tests가 39보다 많음, fail 0. `npm run test:scene-links` → fail 0.
- [ ] **Step 7: 커밋** — 세 파일 / `작업 링크: 모아서 한 번 부르기 도우미(createTrailingDebounce)와 가짜 시계 테스트`

**이 Task가 끝나면 앱은:** Task 8과 같다(도우미를 부르는 곳이 아직 없다).

### Task 10: main의 캐시 갱신 모으기, 새 창의 다시 받기 끄기

**Files:**
- Modify: `electron/main.ts`, `src/views/WidgetPopup.tsx`

**Read first:** 설계 9.3, 9.4, 2.5, 2.6, 11.4의 앵커 9·11 · `electron/main.ts`에서(인용으로 찾는다) `import { sceneWorkFileEntries } from './presence/sceneLinkIndex';`, `onSceneWorkLinkChange: (payload) => {`부터 `onPresenceSync:`까지, `async function refreshSceneWorkLinkCache(): Promise<void> {`, `function stopEditingPresenceService(): void {` · `src/views/WidgetPopup.tsx`의 `if (table === 'calendar_notifications') return;`부터 `// 그 외 → 디바운스 full reload`까지.

- [ ] **Step 1: `main.ts` import** — presence import 줄들 옆에 `import { createTrailingDebounce } from './presence/trailingDebounce';`.
- [ ] **Step 2: 모으기 선언(설계 9.3의 첫 블록)** — `refreshSceneWorkLinkCache` 함수가 끝나는 `}` 바로 아래에: 새 주석 두 줄(`// 링크 행이 한꺼번에 여러 개 바뀌어도(한꺼번에 연결·되돌리기) 표 다시 읽기와 감지기 초기화는 한 번만 한다.`, `// 행마다 하면 PC마다 N번 표를 읽고 PowerShell을 N개 띄운다.`), 그 아래 **지금 `onSceneWorkLinkChange` 안에 있는 주석 다섯 줄**(`// 프레즌스 basename→씬 매칭에 쓰는 캐시를 최신화(전체 재로드) 후 재평가.`부터 `// (신선한 캐시를 쓰도록 refresh 완료 후 reset — 그 전 reset은 stale 캐시로 재평가됨)`까지 — 들여쓰기만 맨 앞으로)을 옮기고, 그 아래 `const SCENE_WORK_LINK_REFRESH_WAIT_MS = 400;`, `const SCENE_WORK_LINK_REFRESH_MAX_WAIT_MS = 2000;`, `const sceneWorkLinkRefresh = createTrailingDebounce(() => { … }, { waitMs: SCENE_WORK_LINK_REFRESH_WAIT_MS, maxWaitMs: SCENE_WORK_LINK_REFRESH_MAX_WAIT_MS });`를 설계의 글자 그대로. 설계 블록의 괄호 친 주석 줄("(지금 onSceneWorkLinkChange 안에 있는 주석 다섯 줄 … 옮긴다)")은 지시문이다 — 옮겨 적지 않는다. **콜백 `() => { … }` 안에는 주석을 넣지 않는다**(세 줄뿐: 다시 읽기 → 끝난 뒤 `try { editingPresence?.reset(); } catch { /* ignore */ }`).
- [ ] **Step 3: `onSceneWorkLinkChange`** — 본문을 두 줄로: `broadcastSupabaseEvent('scene_work_links', payload);`와 `sceneWorkLinkRefresh.schedule();`(주석 다섯 줄과 `void refreshSceneWorkLinkCache().then(…)` 세 줄이 빠진다). 렌더러로 가는 `broadcastSupabaseEvent`는 지금처럼 행마다 바로 간다.
- [ ] **Step 4: `stopEditingPresenceService`** — 본문의 첫 줄에 `sceneWorkLinkRefresh.cancel();`. 복장 쪽(`refreshCostumeFileCache`)은 건드리지 않는다.
- [ ] **Step 5: `WidgetPopup.tsx`(설계 9.4)** — `if (table === 'calendar_notifications') return;` 줄 바로 아래에 빈 줄, `      // 작업 링크는 새 창 어디에도 보이지 않는다(연결도 표시도 본 창). 행마다 자료를 통째로 다시 받지 않는다.`, `      if (table === 'scene_work_links') return;` 세 줄. `git diff --numstat` → `3	0	src/views/WidgetPopup.tsx`.
- [ ] **Step 6: 자가 점검** — `main.ts`: `onSceneWorkLinkChange: (payload) => {`부터 `onPresenceSync:`까지에 `refreshSceneWorkLinkCache(`·`editingPresence?.reset()`이 0곳이고 `sceneWorkLinkRefresh.schedule();`이 `broadcastSupabaseEvent('scene_work_links', payload);` 뒤에 1곳 · 파일에 `createTrailingDebounce` 2곳(import와 선언) · `sceneWorkLinkRefresh.cancel();` 1곳이고 `function stopEditingPresenceService(): void {` 안 · `refreshSceneWorkLinkCache(`는 3곳 그대로(정의·모으기 콜백·처음 읽기). `WidgetPopup.tsx`: `if (table === 'scene_work_links') return;` 1곳이고 `// 그 외 → 디바운스 full reload`보다 앞, 두 표지는 각각 1곳.
- [ ] **Step 7:** `npm run typecheck` → 오류 없음. `npm run test:presence`·`npm run test:scene-links` → fail 0. `npm run test:calendar` → fail 0(`calendarRealtimeFanout.test.ts`의 2,500자 창과 `userIpcAuthorization.test.ts`가 그대로 통과).
- [ ] **Step 8: 전체 게이트** — `electron/main.ts`와 `WidgetPopup.tsx`는 여러 스크립트의 테스트가 글자로 읽는다. `npm run build:vite`를 로그로 본다(Task 6의 Step 6과 같은 기준).
- [ ] **Step 9: 커밋** — 두 파일 / `작업 링크: 행이 한꺼번에 바뀌어도 main의 표 다시 읽기와 감지기 초기화는 한 번 — 새 창은 링크 행 신호에 자료를 통째로 다시 받지 않는다`

**v1.133.0과 달라지는 것(둘 다 이 기능을 쓰지 않을 때에도, 모든 PC에서 달라진다):**
- **main의 모으기**: 링크 행이 바뀐 뒤 표 전체 다시 읽기와 감지기 초기화가 행마다가 아니라 마지막 변화에서 0.4초 뒤(변화가 이어지면 첫 변화에서 길어야 2초 안)에 **한 번** 돈다. 한 씬만 연결할 때도 '작업 중' 표시가 새 링크를 따라오기까지 0.4초쯤 더 걸린다(감지 주기가 4초라 눈에 띄지 않는다). 렌더러로 가는 행 신호는 모으지 않는다. 지키는 것: `tests/presenceTrailingDebounce.test.ts`(Task 9), Task 11의 앵커 9.
- **새 창(위젯)**: 지금까지는 누가 링크 하나를 바꿀 때마다 떠 있는 모든 새 창이 자료 전체를 다시 받았다. 이제 받지 않는다(새 창에는 작업 링크가 보이지 않아 화면은 달라지지 않는다). 지키는 것: Task 11의 앵커 11, 기존 `tests/calendarRealtimeFanout.test.ts`. 미리보기에는 실시간이 없어 화면으로는 볼 수 없다 — 배포 뒤 실기 확인 항목이다.
**이 Task가 끝나면 앱은:** 화면에 보이는 것은 Task 8과 같다.

---

## Chunk 5: 앵커·뮤테이션·마무리 (설계 14절 8·9단계)

### Task 11: 배선 앵커 열둘과 뮤테이션 확인

**Files:**
- Create: `tests/sceneBulkWorkLinkWiring.test.ts`
- Modify: `package.json`, `tests/sceneLinkIndex.test.ts`(살아남은 뮤테이션이 있으면 그 테스트 파일도 · 앵커가 빠진 배선을 잡으면 그 소스 파일도 — Step 2)

**Read first:** 관문 A·B 결과 줄(대체안을 골랐으면 그 앵커는 고른 구현의 글자로 쓴다) · 설계 11.4 전부(표의 두 열), 11.5, 11.6 전부, 1.4의 R1~R5·R10.

- [ ] **Step 1: 앵커를 쓴다** — 앵커마다 `test()` 하나(열둘). 도우미: `read(path)` = `readFileSync(path, 'utf8').replace(/\r\n/g, '\n')` · `piece(source, from, to?)` = `from`의 첫 자리부터, `from`이 끝난 뒤 처음 나오는 `to`의 **끝까지(`to` 포함)**. `to` 인자를 주지 않으면 파일 끝까지. `from`이나 (준) `to`를 찾지 못하면 단언으로 실패한다 · `inOrder(source, [조각…])` = 앞 조각의 자리 뒤에서 다음 조각을 찾는다 · `count(source, 조각)` = `source.split(조각).length - 1`. **조각은 설계 11.4 표의 글자 그대로다**(표를 옆에 두고 쓴다 — 아래는 자르는 자리와 빠뜨리기 쉬운 것).
  - **1 · 2**(`src/services/sceneWorkLinkActions.ts`): 본문은 `'export async function saveWorkLinkPathGuarded('`~`'export async function chooseAndLinkWorkPath('`. 그 안에 여섯 조각이 순서대로(`await useSceneWorkLinkStore.getState().upsertLink(` → `const savedToastId = toast.success(` → `if (linkKind === 'primary_file') {` → `void offerBulkWorkLink({ sceneUuid, department, path, userId: userId ?? null, savedToastId });` → `return true;` → `} catch (err) {`). 파일에 `offerBulkWorkLink(`가 정확히 1, `await offerBulkWorkLink(`가 0.
  - **3 · 4**(`src/services/sceneBulkWorkLinkActions.ts`, `src/components/scenes/BulkWorkLinkDialog.tsx`): 서비스에 `sceneWorkLinkActions`·`saveWorkLinkPathGuarded`·`chooseAndLinkWorkPath`가 없고 `offerBulkWorkLink(`는 1(`export async function offerBulkWorkLink(`), `runBulkWorkLink`·`undoBulkWorkLink` 본문에 `store.upsertLink(`, `undoBulkWorkLink`에 `store.deleteLink(`. 두 파일 모두 `electronAPI`·`supabase`가 없다.
  - **5**: `offerBulkWorkLink` 본문은 `'export async function offerBulkWorkLink('`~`'async function runBulkWorkLink('`. 아홉 조각이 순서대로(아홉째 `runBulkWorkLink(`는 끝 표지의 글자에도 들어 있다 — 순서는 본문에서 끝 표지를 뗀 글로 본다), 본문이 `try {` … `} catch (err) {` 안, `try {` 다음의 첫 문장이 `if (BulkWorkLinkDialog.isOpen()) return;`. `otherModalOpen` 본문은 `'function otherModalOpen('`~`'async function reloadLinks('`이고 그 안에 `[role="dialog"][aria-modal="true"]`와 `dialog[open]`.
  - **6**: `runBulkWorkLink` 본문은 `'async function runBulkWorkLink('`~`'async function undoBulkWorkLink('`, `undoBulkWorkLink` 본문은 거기서 파일 끝까지, `reloadLinks`는 `'async function reloadLinks('`~`'function refreshLinks('`, `refreshLinks`는 `'function refreshLinks('`~`'export async function offerBulkWorkLink('`. 두 본문의 순서 목록(설계 표의 열두 조각과 여덟 조각), `if (!fresh) {`부터 그 뒤 처음 나오는 `}`까지(`piece(본문, 'if (!fresh) {', '}')` — 닫는 `}`가 든다)를 `.replace(/\s+/g, '')` 한 것이 각각 `if(!fresh){toast.error(bulkLinkRecheckFailedText(offer.linkedSceneId));return;}`·`if(!fresh){offerAgain(BULK_LINK_TEXT.undoRecheckFailed,writes);return;}`와 **같다**. `undoBulkWorkLink` 본문에 `showUndoToast(` 1·`toast.error(` 0. `reloadLinks` 본문에 `loadForSceneUuids(sceneUuids)`·`Promise.race(`·`() => true,`·`return false;`·`resolve(false)`가 있고 `true`는 **정확히 1**. `refreshLinks` 본문에 `void useSceneWorkLinkStore.getState().loadForSceneUuids(sceneUuids).catch(`가 있고 `await`가 없다. 파일 전체: `Promise.allSettled(` 2 · `showUndoToast(` 2 · `toast.dismiss(savedToastId)` 1 · `Promise.all(` 0.
  - **7**(`src/utils/sceneFileNameList.ts`, `src/utils/sceneBulkWorkLink.ts`, `electron/presence/trailingDebounce.ts`): 두 순수 모듈의 모든 `from '…'`이 `./`나 `../`로 시작해 `.ts`로 끝나고, `@/`·`react`·`sonner`·`zustand`·`window.`·`document.`이 없고, `../types/index.ts`는 `import type` 줄에만 온다. 도우미 파일에는 `import`가 없다.
  - **8**(`src/App.tsx`, `BulkWorkLinkDialog.tsx`): `<BulkWorkLinkDialogHost />`가 정확히 1이고 `<ConfirmDialogHost />` 뒤. 창 파일에 있어야 하는 열 조각, `/externalShow = null;\s*settle\(null\);/`, 없어야 하는 여섯(`window.confirm`, `'Enter'`, `"Enter"`, `title=`, `truncate`, `openNow`), `submit`이 정확히 2.
  - **9**(`electron/main.ts`): `onSceneWorkLinkChange: (payload) => {`~`onPresenceSync:`에 두 조각이 순서대로 있고 `refreshSceneWorkLinkCache(`·`editingPresence?.reset()`이 없다. `const sceneWorkLinkRefresh = createTrailingDebounce(() => {`부터 그 뒤 처음 나오는 `}, { waitMs: SCENE_WORK_LINK_REFRESH_WAIT_MS, maxWaitMs: SCENE_WORK_LINK_REFRESH_MAX_WAIT_MS });`까지에 `refreshSceneWorkLinkCache().then(` → `editingPresence?.reset()` 순서. `function stopEditingPresenceService(): void {`~`function broadcastSupabaseEvent(`에 `sceneWorkLinkRefresh.cancel();`.
  - **10**(`package.json`): `scripts['test:presence']`가 `./tests/presenceTrailingDebounce.test.ts`와 `./tests/sceneLinkIndex.test.ts`를 품고, `scripts.build`와 `scripts['build:vite']`가 각각 `/npm run test:presence &&/`에 맞는다.
  - **11**(`src/views/WidgetPopup.tsx`): `if (table === 'calendar_notifications') return;`~`// 그 외 → 디바운스 full reload`에 `if (table === 'scene_work_links') return;`. 두 표지는 파일에 한 번씩.
  - **12**(`src/components/scenes/SceneWorkLinksPanel.tsx`): `const savePath = async (nextPath: string) => {`부터 그 뒤 처음 나오는 `setSaving(true);`까지에 `if (saving) return;`.
- [ ] **Step 2:** `node --test tests/sceneBulkWorkLinkWiring.test.ts` → 열둘 통과. 실패하는 앵커가 있으면 배선이 빠진 것이다 — **소스를 고친다**: 그 배선을 만든 Task(6·7·8·10)의 Files에 든 소스 파일만. 고친 파일은 이 Task의 커밋에 함께 넣고 커밋 본문에 어느 앵커가 무엇을 잡았는지 적는다. 정규식·표지가 틀렸거나 관문의 대체안과 어긋난 경우에만 테스트를 고친다.
- [ ] **Step 3: 스크립트와 감시** — 감시 테스트에 `/\.\/tests\/sceneBulkWorkLinkWiring\.test\.ts/` 줄을 더하고(다섯 줄이 된다 — 실패 확인), `test:scene-links`를 설계 11.5의 글자로 맞춘다: `"test:scene-links": "node --test ./tests/sceneWorkLinks.test.ts ./tests/sceneWorkLinkCardBadges.test.ts ./tests/sceneFileNameList.test.ts ./tests/sceneBulkWorkLink.test.ts ./tests/sceneBulkWorkLinkWiring.test.ts",`.
- [ ] **Step 4: 뮤테이션 확인(사본에서만 — 작업 트리의 소스에는 넣지 않는다)**
  - **사본의 자리**: 저장소 밖의 임시 폴더를 먼저 고른다(오케스트레이터의 dev 서버가 워크트리를 지켜보고 있을 수 있다). 밖에 둘 수 없을 때만 워크트리 안의 `.superpowers/mutation-scratch/`(`.gitignore`에 있다). 같은 상대 경로로 `package.json`, `tests/`, `src/`, `electron/`을 복사한다(`node_modules`는 복사하지도, junction·symlink로 걸지도 않는다 — 사본을 지우다 원본이 지워진 사고가 있었다. 이 묶음의 테스트는 패키지를 끌어오지 않는다). 테스트는 **사본의 뿌리를 작업 폴더로** 돌린다(소스를 상대 경로로 읽는다).
  - **뮤테이션을 넣기 전에 바탕부터**: 사본에서 `test:scene-links`의 다섯 파일과 `tests/sceneLinkIndex.test.ts`·`tests/presenceTrailingDebounce.test.ts`를 그대로 돌려 모두 통과함을 확인한다. `ERR_MODULE_NOT_FOUND`나 import 오류·문법 오류로 **파일 전체가** 실패한 것은 '잡힘'으로 세지 않는다 — 잡힌 것은 그 뮤테이션을 겨눈 단언이 실패한 것이다. 넣으려는 자리의 글자를 사본에서 찾지 못한 것도 잡힘이 아니다(뮤테이션을 넣지 못한 것이다).
  - **넣을 것은 설계 11.6의 목록 전부다**, 하나씩 넣고 되돌린다('/'로 나뉜 것과 "따로따로"는 각각): 규칙 — 읽기 / 규칙 — 범위 / 규칙 — 고르기(`requireOwnNumber`를 보지 않는 변형은 "늘 끈 것처럼"과 "늘 켠 것처럼" 둘 다) / 규칙 — 다른 씬들의 목록 → `tests/sceneFileNameList.test.ts`가 잡는다 · 대상 / 계획 / 문구 → `tests/sceneBulkWorkLink.test.ts` · 앵커 — 설계 11.4 표의 "잡아야 하는 변형" 전부 → `tests/sceneBulkWorkLinkWiring.test.ts`의 그 번호(앵커 10의 변형은 `package.json`에서 파일·스크립트를 빼 본다 — 감시 쪽 `tests/sceneLinkIndex.test.ts`도 같은 방법으로 본다) · 모으기 셋(`maxWaitMs` 상한 삭제 / `cancel`이 `firstAt`을 지우지 않음 / 예약마다 타이머를 지우지 않음) → `tests/presenceTrailingDebounce.test.ts`.
  - 설계 중의 확인에서는 규칙·대상·계획·문구의 변형이 하나도 살아남지 않았다(11.6 끝 문단). **구현에서 살아남는 것이 나오면 테스트를 설계의 자료대로 옮기지 않은 것이다** — 작업 트리의 테스트를 설계 11.1·11.2·11.4와 견줘 고치고(구현을 고치는 것이 아니다), 다시 복사해 반복한다. `workFileName`의 폴더 경로 검사는 목록에 없다(지울 코드가 없다).
  - 끝나면 사본 폴더만 지우고, `git status --short`에 이 Task의 Files 말고 새 항목이 없는지(뮤테이션이 새지 않았는지) 본다.
  - **결과는 변형마다 한 줄인 표로 오케스트레이터에게 돌려준다**: 묶음 · 변형 · 넣은 파일과 자리 · 결과(실패한 테스트의 이름과 단언 / `생존` / `넣지 못함`). 설계 11.6의 목록에 든 변형이 하나도 빠지지 않게, '/'로 나뉜 것과 "따로따로"는 줄을 나눠 적는다. 처음에 살아남아 테스트를 고친 변형은 고친 테스트와 다시 돌린 결과를 그 줄에 적는다. 커밋 본문에는 묶음별 합계(넣은 수·잡힌 수)만 적는다. **작업자는 결과를 확정하지 않는다 — 판정은 관문 C다.**
- [ ] **Step 5:** `npm run typecheck` → 오류 없음. `npm run test:scene-links` → 테스트 12개 증가, fail 0. `npm run test:presence` → fail 0.
- [ ] **Step 6: 커밋** — 바뀐 파일 / `테스트: 씬 한꺼번에 연결 배선 앵커 12개와 뮤테이션 확인 — test:scene-links 다섯 파일을 감시로 고정`(본문: 뮤테이션의 묶음별 합계, 앵커가 잡아 고친 배선이 있으면 그것). 변형별 표는 커밋하지 않고 보고에 담아 돌려준다.

**이 Task가 끝나면 앱은:** Task 10과 같다(앵커에서 빠진 배선을 찾아 고쳤으면 그만큼만 다르다).

### 관문 C — 뮤테이션 결과 판정 (Task 11 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

설계 14절 끝의 "진행을 맡은 쪽만 하는 일" 가운데 하나다. Task 11의 작업자가 돌려준 변형별 표(Step 4)를 설계 11.6·11.4 옆에 두고 아래 넷을 본다. 앱은 띄우지 않는다.

- **(a) 빠진 변형이 없다** — 설계 11.6의 목록이 표에 한 번씩 있다: 규칙(읽기 / 범위 / 고르기 / 다른 씬들의 목록), 대상, 계획, 문구, 11.4 표의 "잡아야 하는 변형" 전부(앵커 1~12), 모으기 셋. '/'로 나뉜 것과 "따로따로"는 각각 한 줄이다(고르기는 스무 줄, 다른 씬들의 목록은 여섯 줄 — 11.6 끝 문단).
- **(b) '잡힘'이 진짜다** — 잡힌 줄마다 실패한 테스트의 이름과 단언이 적혀 있고, 그것이 그 변형을 겨눈 단언이다. 파일 전체의 실패(`ERR_MODULE_NOT_FOUND`·import 오류·문법 오류)와 `넣지 못함`은 잡힘으로 세지 않는다 — 그런 줄은 다시 넣어 돌리게 한다.
- **(c) 생존이 0이다** — 처음에 살아남은 변형이 있었다면 테스트를 설계 11.1·11.2·11.4에 견줘 고쳤고(구현을 고친 것이 아니다) 그 변형을 다시 넣어 잡힌 것이 표에 있다. 설계의 자료대로 옮겼는데도 살아남는 변형은 넘기지 않는다 — 원인을 찾는다(@superpowers:systematic-debugging).
- **(d) 새지 않았다** — `git status --short`가 비어 있고, Task 11의 커밋(`git show --stat HEAD`)에 그 Task의 Files 말고 다른 파일이 없다. `npm run test:scene-links`·`npm run test:presence` → fail 0.

- 어긋난 줄이 있으면 그 줄만 작업자에게 되돌려 고치게 하고(따로 커밋: `테스트: 씬 한꺼번에 연결 관문 C — <고친 것>`) 다시 판정한다. **Task 12는 이 관문이 통과하기 전에 시작하지 않는다.**
- 결과를 `관문 C 결과:` 한 줄로 이 절 끝에 적는다(묶음별 넣은 수와 잡힌 수, 넣지 못함 0·생존 0, 테스트를 고친 변형이 있었으면 그것). 결과 줄을 적은 뒤 **계획 파일만 따로 커밋한다**(`문서: 씬 한꺼번에 연결 관문 C 결과`) — Task 12가 시작될 때 `git status --short`가 비어 있어야 한다.

**관문 C 결과: 통과** (2026-10-11, 변형을 돌린 기준 9870b563 · 다시 돌린 기준 ef51a292). 넣은 변형 237 · 잡힘 237 · 생존 0 · 넣지 못함 0 · 파일 전체의 실패로만 잡힌 것 0 — 규칙 65(읽기 22 · 범위 15 · 고르기 22 · 다른 씬들의 목록 6), 대상 34, 계획 12, 문구 4, 모으기 3, 앵커 1~12 112, 감시 7. (a) 설계 11.6·11.4·11.5의 177줄이 표에 모두 있다(목록 191 + 보탬 46 — 표가 목록으로 센 'Task 8 리뷰' 여섯 줄 A3-R2·A3-R3·A6-R1·A6-R5·A6-R6·A6-R6b는 보탬이다. 고르기 20줄·다른 씬들의 목록 6줄). (b) 독립 검토 셋이 따로 확인했다: 목록 대조 통과 / ef51a292에서 237개를 다시 넣어 모두 그 줄이 겨눈 단언(ERR_ASSERTION)으로 잡힘 / 줄마다 겨눈 단언인지 237줄 통과. 설계의 말과 조금 다르게 넣은 다섯 줄(A11-2·A8-05b·A6-09·A5-2·A6-16)은 말 그대로의 꼴로 다시 넣어 같은 앵커가 잡는 것을 봤다. (c) 설계 표의 글자만으로는 22개가 살아남아, Task 11과 그 리뷰 커밋(ef51a292)이 앵커 1·2·3·5·6·8·9에 '설계 표에 없는 보탬' 줄을 더했다 — 구현은 고치지 않았다. 리뷰가 더 넣어 본 38개 가운데 37개가 잡히고, 남은 하나(창이 닫힐 때 포커스를 돌려주는 정리)는 수동 E5가 본다. 관문에서 더한 것 둘: 체크를 푼 줄까지 넘기는 변형 넷을 앵커 8이 잡게 했고(e20ec310), 최종 수동 검증에서 찾은 '포커스가 창 밖에 놓인 동안의 키'를 고치며 앵커 8에 네 줄을 더했다(e536a502, 변형 6개 모두 잡힘). (d) `git status --short` 비어 있음 · Task 11의 커밋은 그 Task의 세 파일뿐 · `npm run test:scene-links` 94 · `npm run test:presence` 43, fail 0.

### Task 12: 버전 1.134.0·업데이트 내역·문서·전체 게이트

**Files:**
- Modify: `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`, `ROADMAP.md`, `AGENTS.md`, `docs/superpowers/plans/2026-10-10-feedback-additions.md`

**Read first:** 관문 A·B·C 결과 줄(관문 C 결과 줄이 없으면 시작하지 않는다) · 설계 13절 전부(JSON 블록과 그 아래의 설명, 문서별 내용), 15.1의 "한솔의 답"과 "함께 물은 것 둘", 15.3 · `DEVLOG/update-notes.json`의 첫 12줄(들여쓰기) · `ROADMAP.md`의 마지막 절(`### v1.133.0 배경 도면 ③ 새 도면 요소 (2026-10-10)`) · `AGENTS.md`의 `### 리테이크 알림·바로가기 경계 (v1.116.0)` 머리와 그 앞 절의 문체 · 진행 기록 문서의 `## 7. 진행 기록` 표와 `### 7.1` 절의 꼴.

- [ ] **Step 1: 버전** — `git fetch origin main` 뒤 `git show origin/main:package.json`의 `version`이 `1.133.0`인지 본다(이미 1.134.0 이상이면 멈추고 보고한다). `package.json`의 `"version"`, `package-lock.json`의 맨 위 `"version"`과 `packages[""]`의 `"version"` 세 곳을 `1.134.0`으로. 확인: `git diff --numstat package.json package-lock.json` → `2	2	package-lock.json`과 `1	1	package.json`.
- [ ] **Step 2: `DEVLOG/update-notes.json`** — 다시 직렬화하지 않는다(파일 전체가 바뀐다). **글자로 끼워 넣는다**: 첫 줄 `[` 바로 다음, 지금의 첫 항목(`"version": "1.133.0"`)의 `  {` 앞에 블록 **16줄**(`{`부터 `}`까지)을 넣는다. **블록의 글자는 설계 13절의 JSON 블록(첫 줄이 0칸의 `{`)에서 가져와** 각 줄 앞에 공백 2칸을 더하고 마지막 줄을 `  },`로 한다 — 아래 블록은 견줘 보라고 옮긴 같은 글자이고, 이 목록 안에 있어 이 계획의 원문에서는 줄마다 이미 2칸이 들여져 있다(그것을 복사해 2칸을 또 더하면 4칸이 된다). **넣은 뒤 파일의 2번째 줄은 정확히 `  {`(공백 2칸), 3번째 줄은 `    "version": "1.134.0",`(공백 4칸), 17번째 줄은 `  },`, 18번째 줄은 기존의 `  {`다.** 본문은 한 글자도 바꾸지 않는다. 줄 끝은 그 파일의 것(작업 트리에서 CRLF)에 맞춘다.

  ```json
  {
    "version": "1.134.0",
    "title": "파일 하나를 여러 씬에 한꺼번에 연결해요",
    "items": [
      {
        "category": "feature",
        "summary": "대표 파일을 연결하면 같은 파일을 쓰는 다른 씬에도 한꺼번에 연결할지 물어봐요",
        "description": "모호 파일 하나에 여러 씬이 들어 있으면, 예전에는 씬마다 같은 파일을 하나씩 다시 연결해야 했어요. 이제 씬에 대표 파일을 연결하면 파일 이름에 적힌 다른 씬 번호를 읽어서(예: 'a 001,003,005,007') 그 씬들에도 연결할지 물어봐요. 번호는 쉼표·띄어쓰기·밑줄로 이어 쓰면 되고, 'a001~005'처럼 물결표를 쓰면 1번부터 5번까지로 읽어요. 비플로우에서 같은 레이아웃 번호로 묶어 둔 씬도 목록 아래쪽에 체크하지 않은 채로 함께 보여 줘요. 그래서 파일 이름에 씬 번호가 없어도, 같은 레이아웃 번호로 묶어 둔 씬이 있으면 물어봐요. 파일 이름에 적힌 씬은 처음부터 체크돼 있어요(이미 다른 파일이 연결된 씬도요). 목록에서 연결할 씬만 체크해 두고 '선택한 N개에 연결'을 누르면 한 번에 연결되고, 이미 다른 파일이 연결된 씬은 '이 파일로 바뀜'이라고 미리 알려 줘요. 잘못 눌렀으면 바로 뜨는 '되돌리기'로 원래대로 돌릴 수 있어요. 필터로 가려 둔 씬이나 다른 사람이 맡은 씬도 번호가 맞으면 목록에 나와요."
      },
      {
        "category": "ux",
        "summary": "파일 하나를 여러 씬에 연결하면 '작업 중' 표시가 그 씬들 모두에 떠요",
        "description": "한 파일을 여러 씬에 연결해 두면, 누군가 그 파일을 모호에서 열었을 때 연결된 씬 모두에 '작업 중'이 표시돼요. 파일이 하나라서 그 가운데 어느 씬을 만지고 있는지는 가려내지 못해요."
      }
    ]
  }
  ```

  - 확인 1: `git diff --numstat DEVLOG/update-notes.json` → `16	0	DEVLOG/update-notes.json`(더해진 줄 16, 지워진 줄 0). `git ls-files --eol DEVLOG/update-notes.json` → `w/crlf` 그대로(`w/mixed`가 아니다).
  - 확인 2: `node -e "const n=require('./DEVLOG/update-notes.json');if(n[0].version!=='1.134.0'||n[0].items.length!==2||n[0].items.map(i=>i.category).join()!=='feature,ux'||n[1].version!=='1.133.0')process.exit(1);console.log(n[0].title)"` → 제목이 찍히고 종료 코드 0.
  - 확인 3(들여쓰기 — 위 둘은 4·6·8칸으로 넣어도 통과한다): `node -e "const l=require('fs').readFileSync('DEVLOG/update-notes.json','utf8').split(/\r?\n/);console.log(JSON.stringify([l[1],l[2],l[16],l[17]]))"` → 정확히 `["  {","    \"version\": \"1.134.0\",","  },","  {"]`(2·3·17·18번째 줄, 앞 공백 2·4·2·2칸).
  - 글에는 기술 용어·파일 이름·함수 이름이 없다(CLAUDE.md의 업데이트 내역 규칙) — 설계의 글자를 그대로 넣으면 지켜진다. 고쳐 쓰지 않는다.
- [ ] **Step 3: `ROADMAP.md`** — 파일 끝(`### v1.133.0 …` 절 다음)에 `### v1.134.0 씬 대표 파일 한꺼번에 연결 (YYYY-MM-DD)` 절(괄호 안은 구현한 날의 날짜 — `date +%F`가 찍는 값)과 설계 13절 '문서'의 ROADMAP 줄에 적힌 다섯 줄을 글자 그대로: `- [x] 대표 파일을 저장한 바로 뒤, 파일 이름에 번호가 적힌 씬과 레이아웃이 같은 씬에 같은 파일을 한꺼번에 연결할지 묻는 체크 목록 창. 되돌리기 포함. 운영 DB·IPC 변경 없음. 설계: docs/superpowers/specs/2026-10-10-scene-bulk-work-link-design.md` / `- [x] 링크가 한꺼번에 바뀔 때 '작업 중' 감지 준비를 PC마다 한 번으로 모음` / `- [x] 새 창(위젯)은 작업 링크가 바뀔 때 자료를 통째로 다시 받지 않음 · 경로 붙여넣기 칸의 겹친 Enter는 한 번만 저장` / `- [ ] 수동 검증(설계 12절)` / `- [ ] 배포 뒤 실기 확인: 진짜 파일 선택창, 다른 PC 반영, 한 파일·여러 씬의 '작업 중'`.
- [ ] **Step 4: `AGENTS.md`** — `### 리테이크 알림·바로가기 경계 (v1.116.0)` 절 **앞에** `### 씬 작업 링크 한꺼번에 연결 (v1.134.0)` 절. 내용은 설계 13절 '문서'의 AGENTS.md 줄에 `/`로 나뉘어 적힌 항목을 **그 순서대로 모두** 불릿으로 옮긴다(제안이 시작되는 한 곳 / 한꺼번에 연결과 되돌리기는 저장소 액션을 직접 / 파일 이름을 읽는 규칙과 원칙 — P4 `requireOwnNumber: false`(한솔 2026-10-10)와 손잡이와 무관한 둘 / `namesOtherScenes`면 레이아웃 묶음까지 묻지 않는다 / `sceneRefKey` / 대상은 `Part` 하나·필터를 거치지 않은 자료 / 매기기 전에 읽는다 / 누르는 순간·되돌리는 순간의 다시 읽기, 읽지 못하면 쓰지 않고 되돌리기는 다시 건다 / 씬 자료도 다시 본다 / 되돌리기는 경로와 `updatedBy` / `refreshLinks` / 창의 규칙 — Enter·`title`·키 입력·표시와 버튼 위의 수 / 다른 모달이 떠 있으면 물러난다 / `savePath`의 겹친 저장 / 바꿀 수 있는 값 둘 / main의 모으기 / 새 창의 한 줄 / 개발용 뿌리에는 호스트가 없다 / `npm run test:scene-links`). 굵게 적힌 구절은 굵게 옮긴다. 관문에서 대체안으로 바뀐 것이 있으면 그 구현대로 적는다. (`AGENTS.md`를 글자로 읽는 테스트는 둘이다 — `tests/backgroundDatabaseContract.test.ts`(`test:background`. 배경 SQL의 다시 실행 규칙: `다시 실행`이 `3D 파일도`·`이 SQL도`와 한 줄에 있으면 실패한다 — 새 절에 "다시 실행"이라는 낱말을 쓰지 않는다. 설계의 글에도 없다)와 `tests/threadTodoWiring.test.ts`(`test:entity`. `### 팀 할 일 경계 (v1.118.0)` 절을 다음 `### `까지 읽는다 — 새 절은 줄 맨 앞의 `### ` 머리로 시작하고 팀 할 일 절 안에 끼워 넣지 않는다: 그 절의 마지막 불릿과 빈 줄 다음, `### 리테이크 …` 머리 바로 앞이다). Step 6의 `test:background`·`test:entity`가 본다.)
- [ ] **Step 5: 진행 기록**(`docs/superpowers/plans/2026-10-10-feedback-additions.md`) — 아래의 `YYYY-MM-DD`는 Step 3과 같은 날짜다. `## 7. 진행 기록` 표의 "나" 행을 `| 나. 같은 레이아웃 씬 한꺼번에 연결 (G8) | docs/superpowers/specs/2026-10-10-scene-bulk-work-link-design.md, 아래 7.2 | YYYY-MM-DD 구현 완료 (v1.134.0) · 수동 검증·배포 대기 |`로 바꾸고, 파일 끝에 `### 7.2 나. 한꺼번에 연결 — 만든 것과 확인한 것 (v1.134.0, YYYY-MM-DD)` 절을 7.1과 같은 꼴로: **만든 것**(이 계획의 File structure — 새 파일과 바뀐 파일, 하는 일 한 줄씩) / **확인한 것**(`npm run typecheck`, `npm run test:scene-links`·`npm run test:presence`의 테스트 수, `npm run build:vite`, 뮤테이션 수와 잡힌 수(관문 C의 결과 줄 그대로), 관문 A·B의 결과 줄) / **확인하지 못한 것**(설계 12절 끝의 "배포 뒤 실기에서만 볼 수 있는 것" 전부. 최종 수동 검증의 결과는 오케스트레이터가 검증 뒤 이 절에 더한다고 적는다) / **P1~P4에 받은 답**(한솔의 말 그대로 — "1- 범위로 읽기. 파일명에 물결 안 씀. 2-추천대로. 3- 추천대로. 4- 물어보기. 쭉 진행해서 배포까지!" — 과 네 값, 그리고 함께 물었고 답이 없는 둘은 "지금 규칙대로 나갔다 — 후속 항목"). 다른 줄은 손대지 않는다.
- [ ] **Step 6: 전체 게이트** — `npm run build:vite`를 로그 파일(공통 규칙의 스크래치 자리)로 받아 **로그로 판정한다**(종료 코드만 보지 않는다): 테스트 스크립트 열셋(`test:playground`·`test:auto-update`·`test:entity`·`test:notifications`·`test:presence`·`test:scene-links`·`test:character`·`test:calendar`·`test:ui`·`test:gantt`·`test:background`·`test:vacation`·`test:motion`)마다 `# fail 0`이고 `# fail [1-9]`가 하나도 없다 · `vite build`의 `built in` 줄들 · 마지막 `[generate-manifest] … manifest.json 생성 — v1.134.0` 줄. `npm run build`(배포 빌드)는 돌리지 않는다. `CLAUDE.md`는 고치지 않는다.
- [ ] **Step 7: 커밋** — 여섯 파일(`dist/`는 올리지 않는다) / `v1.134.0: 씬 대표 파일 한꺼번에 연결 — 버전·업데이트 내역·문서`. 커밋 전에 `git status --short`를 본다: 이 Task의 여섯 파일 말고 남은 것이 있으면 넣지 말고 보고한다.

**이 Task가 끝나면 앱은:** 코드는 Task 11과 같고, 업데이트 내역 맨 위에 1.134.0 항목이 보인다.

### 최종 수동 검증 — 설계 12절 전체 (Task 12 뒤 · **오케스트레이터가 한다. Task 작업자는 하지 않는다**)

- 방법과 범위: 설계 12절 머리말 그대로 — `npm run dev:renderer` + `npm run preview:electron`(Electron 33 = Chromium 130), 미리보기 시험 계정, 주소 `?preview=1`, **실제 입력**. 창 크기 1440×900과 740×900, 어두운·밝은 화면. 모든 항목을 1440×900 어두운 화면에서 보고 ★ 항목은 나머지 세 조합에서 다시 본다. 도구 T1~T6(레이아웃은 T3으로 넣는다 — 화면에서 넣은 레이아웃은 미리보기에 남지 않는다).
- 항목 전부: E1~E6(E2b·E2c 포함) · V1~V10(V9b 포함) · L1~L4 · D1~D3 · K1~K4(K3b 포함) · F1~F12(F6b·F6c·F8b·F9b 포함) · 창이 떠 있는 동안 콘솔 오류·경고 0(F3). 미리보기 자료로 열 수 없는 화면(D3)은 "확인하지 못함"으로 적는다.
- 조정할 때: 설계 15.2의 표를 따른다(관문 A·B에 옮겨 적은 것과 같다). 대체안이 앵커·테스트가 읽는 글자를 바꾸면 **같은 변경에서** 그 앵커·테스트와 `AGENTS.md` 절·완료 보고의 그 줄을 맞추고 `npm run test:scene-links`·`npm run test:presence`·`npm run build:vite`를 다시 돌린다. 그 밖에 설계와 다른 동작이 보이면 고치기 전에 원인을 찾는다(@superpowers:systematic-debugging).
- 결과를 진행 기록 문서의 7.2 절 "확인한 것"·"확인하지 못한 것"에 더하고 `ROADMAP.md`의 `- [ ] 수동 검증(설계 12절)`을 `[x]`로 바꿔 `문서: 씬 한꺼번에 연결 수동 검증 기록 (v1.134.0)`으로 따로 커밋한다. 조정으로 소스·앵커를 고쳤으면 그것도 따로 커밋한다.

### 내보내기 — 설계 14절 10단계 (최종 수동 검증 뒤 · **오케스트레이터가 한다**)

PR → 리뷰 → 머지(직전에 `origin/main`의 버전을 다시 본다 — 그 사이 다른 것이 1.134.0을 썼으면 그 위에 얹는다) → `npm run build`(성공은 electron-builder와 `generate-manifest`의 로그로 판정한다) → G드라이브 배포(빌드 파일을 먼저 모두 올리고 `manifest.json`을 마지막에 — CLAUDE.md 필수 규칙 6) → 배포 뒤 실기 확인(설계 12절 끝) → 완료 보고. 배포까지 이어 가는 것은 한솔이 승인했다(2026-10-10). 운영 DB에 적용할 것은 없다.

---

## 완료 보고에 적을 것

설계 15.3 "한솔에게 알릴 것"에서 그대로 옮겼다(괄호 안의 절 번호 — 15.1, 7.4, 12절 등 — 는 설계의 것이다). 비개발자 문장으로 옮겨 적고, **(가)의 항목은 하나도 빼지 않는다.** 관문 A·B와 최종 수동 검증에서 대체안으로 바꾼 것이 있으면 그 줄을 그 구현대로 고쳐 적고(예: 바깥 누름으로 닫기를 뺐다 — E3), 미리보기로 열 수 없었던 화면(D3)과 배포 뒤 실기에서만 볼 수 있는 것은 "확인하지 못한 것"에 적는다.

**(물어서 정한 것 — P4.)** "파일 이름에 방금 연결한 씬 자신의 번호가 있어야 묻는다"와, 그 번호가 빠진 목록일 때 "레이아웃이 같은 씬도 권하지 않는다"는 여기(알릴 것)에 있다가 묻는 것으로 옮겼던 규칙이다(1.2, 15.1). 2026-10-10에 답을 받았고, **그 규칙은 넣지 않았다** — 한솔의 답은 "물어보기"다: 파일 이름에 연결한 씬의 번호가 없어도 이름에 적힌 씬들을 권하고 레이아웃이 같은 씬도 보여 준다. **권하는 그 씬들은 처음부터 체크된 채 뜬다**(비어 있는 씬도, 다른 파일이 걸린 씬도 — P2). 완료 보고에는 그 답과 그 답대로 나간 동작, 그리고 뜬 창에서 그대로 버튼을 누르면 그 씬들의 대표 파일이 이 파일이 된다는 것(다른 파일이 걸려 있던 씬은 바뀐다)을 적는다((다)의 첫 줄).

**(가) 시안과 달라졌거나, 시안이 정하지 않아 이 설계가 정한 것.** 하나도 빼지 않고 알린다. 검토에서 "시안대로는 되지 않거나 쓰는 사람이 속을 수 있다"고 나온 것을 가장 덜 놀라운 쪽으로 고친 것들이다.

1. **파일 이름이 다른 파트의 씬들을 가리키면 레이아웃이 같은 씬도 권하지 않는다.** 파트 a에서 "b 001,003.moho"를 연결하면, 레이아웃이 같은 씬이 있어도 창이 뜨지 않는다. 시안의 "다른 파트라 묻지 않음"과 "레이아웃이 같은 씬은 파일 이름에 없어도 보여 준다"가 부딪치는 자리를 이렇게 정했다. 씬 목록이 아닌데 꼴이 같은 이름("take 001,002.moho")도 같이 걸린다. 번호가 하나뿐인 이름("b030.moho", "…_v3")은 해당하지 않아 레이아웃 묶음이 그대로 뜬다. (글자는 맞는데 연결한 씬의 번호만 빠진 목록은 여기에 들지 않는다 — P4의 답대로 이름에 적힌 씬들을 권한다.)
2. **Enter로는 연결되지 않는다.** 창이 뜨면 포커스는 첫 체크 칸에 있고, 거기서 Enter를 눌러도 아무 일이 없다. "선택한 N개에 연결"을 **눌러야** 한다(키보드로는 Tab으로 그 버튼에 간 뒤 Enter). 이 창은 저장 직후 스스로 뜨고 다른 파일이 걸린 씬이 처음부터 체크돼 있어서(P2), 습관처럼 친 Enter 하나로 여러 씬 — 남이 맡은 씬 포함 — 의 파일이 바뀌는 것을 막았다. 지금도 링크 하나를 바꿀 때 확인 창의 기본이 '취소'다.
3. **창의 글자 다섯이 시안과 다르다.**
   - 시안에 없던 안내 한 줄을 더했다: "방금 a001의 배경 대표 파일로 연결했어요. 아래에서 고른 씬에도 배경 대표 파일로 연결해요."
   - '없는 씬' 줄: 시안의 "a011은 이 파트에 없는 씬이에요" → "파일 이름에는 있지만 이 파트에 없는 씬: a011"(은/는이 번호마다 달라지고 번호가 여럿일 수 있어서).
   - "바뀜" 줄: 시안의 한 줄 "지금: 〈파일 이름〉 → 이 파일로 바뀜"을 세 조각으로 나눴다 — 지금 파일 이름, 그 아래 지금 경로 전체, 오른쪽에 따로 선 표시 "→ 이 파일로 바뀜". 파일 이름이 길어도 "바뀜"이 잘리지 않는다.
   - **체크를 푼 줄은 "체크하면 이 파일로 바뀜"으로 보인다.** 시안은 다른 파일이 걸린 줄에 늘 "→ 이 파일로 바뀜"을 보였는데, 체크하지 않은 줄(레이아웃이 같은 씬은 처음부터 풀려 있다)에 그 글자가 있으면 "체크하지 않아도 바뀐다"로 읽힌다. 체크하면 "→ 이 파일로 바뀜"이 된다.
   - **버튼 위에 "이 중 N개는 지금 연결된 파일이 바뀌어요"를 더했다.** 씬이 여덟쯤을 넘으면 목록이 스크롤되는데, 아래쪽에 가려진 줄에 "바뀜"이 있어도 버튼은 "선택한 N개에 연결"이라고만 한다. 누르기 전에 바뀌는 파일이 몇 개인지 늘 보이게 했다.
4. **창 안에서는 마우스를 올려도 풍선이 뜨지 않는다.** 대신 파일 이름과 경로를 자르지 않고 줄을 바꿔 다 보여 준다.
5. **묻지 않고 조용히 넘어가는 때가 있다.** 다른 씬들의 연결 정보를 3초 안에 읽지 못했을 때, 읽기에 실패했을 때, 그 사이 다른 확인 창이 떠 있을 때, 그 사이 그 씬의 파일이 또 바뀌었을 때. 알림은 없다(방금 한 연결이 실패한 것처럼 읽히지 않게). **다시 묻게 하려면 그 씬의 상세 창에서 대표 파일의 연필(수정) → "경로 붙여넣기" → "저장"으로 같은 파일을 다시 저장한다**(경로는 이미 채워져 있다). 우클릭 메뉴로는 되지 않는다 — 메뉴는 이미 파일이 있는 칸을 열기만 한다.
6. **"연결"을 누르면 고른 씬들을 한 번 더 확인하고 쓴다**(보통 0.몇 초).
   - **확인하지 못했으면 아무 데도 연결하지 않는다.** 인터넷이 잠깐 끊겼거나 1.5초 안에 답이 오지 않으면 빨간 알림 "연결 상태를 확인하지 못해서 다른 씬에는 연결하지 않았어요. a001의 상세 창에서 대표 파일의 연필(수정) 버튼으로 같은 파일을 다시 저장하면 다시 물어봐요"가 뜬다. 오래된 화면을 믿고, 그 사이 다른 사람이 연결해 둔 파일을 모르는 채 덮어쓰지 않기 위해서다. 처음 연결한 그 씬의 연결은 건드리지 않는다. 알림이 말하는 대로 하면 다시 묻는다(위 5와 같은 길이다).
   - 그 사이 처음 연결한 그 씬의 파일이 바뀌었으면 **아무 데도 연결하지 않고** "그 사이 a001의 파일이 바뀌어서 다른 씬에는 연결하지 않았어요"라고 알린다.
   - 그 사이 다른 사람이 바꾼 씬은 건너뛰고 몇 개인지 알린다. **창이 떠 있는 동안 씬 번호나 레이아웃이 바뀐 씬도 건너뛴다**(누가 a003을 a013으로 고쳤다면 그 씬에는 쓰지 않는다). 되돌리기도 그 뒤에 다른 사람이 바꾼 씬은 그대로 둔다 — **같은 파일이라도 그 뒤에 다른 사람이 다시 연결한 것이면** 그대로 둔다.
   - **'되돌리기'도 확인하지 못하면 되돌리지 않는다. 대신 되돌리기 알림을 다시 띄운다** — "연결 상태를 확인하지 못해서 아직 되돌리지 않았어요 · 되돌리기". 일부만 되돌려졌을 때도 못 되돌린 씬만 들고 다시 띄운다("씬 1개를 되돌렸어요 · 1개는 되돌리지 못했어요(a005) · 되돌리기"). 다시 뜬 알림도 10초다. **그것까지 그냥 지나가면 바뀐 씬의 예전 파일은 화면에서 되찾을 수 없다** — 그 씬에서 예전 파일을 직접 다시 연결해야 한다.
7. **레이아웃이 같은 씬은 같은 파트 안에서만 찾는다.** 파트를 넘어 같이 쓰는지는 2026-10-10에 P3과 함께 물었고 답이 없다(15.1). 이번에는 같은 파트 안에서만 찾는 채로 나가고, 파트를 넘어 묶는 것은 답을 보고 따로 정하는 후속 항목이다.
8. **나중에 파일을 바꿀 때 못 찾아 주는 경우가 있다.** 여러 씬에 걸어 둔 파일을 새 판으로 바꿀 때, 새 파일의 이름에도 씬 번호 목록이 있거나 비플로우의 레이아웃이 같으면 다시 물어 한꺼번에 바꾼다. 이름에 목록이 없고(예: "a001_합본.moho") 레이아웃도 비어 있으면 묻지 않아, 나머지 씬은 하나씩 바꿔야 한다. "예전 파일을 같이 쓰던 씬"을 따로 찾아 주는 것은 넣지 않았다.

**(나) 파일 이름을 읽는 규칙.** 시안의 예에서 따라 나오지만 한솔이 직접 고른 적은 없다.

- **숫자는 자릿수가 같아야 한 목록이다.** "a001_2"의 2, "a001,003_0325"의 0325, "a001,003 (2)"의 2는 씬이 아니다. "a001,3"은 a001 하나로 읽는다.
- **0을 채우지 않아 자릿수가 넘어가는 목록은 넘어가는 데서 끊긴다.** "a 8,9,10,11.moho"를 a008에 연결하면 a009만 권한다. "a 008,009,010,011"로 쓰면 다 읽는다.
- **글자 없이 적은 번호는 세 자리부터 믿는다.** "001,003,005.moho"는 읽고 "1,3,5.moho"는 읽지 않는다("a1,3,5"는 읽는다). 날짜를 "24_10_12"처럼 끊어 써도 씬 번호로 읽지 않는다.
- **글자 없이 적은 번호 목록은, 지금 연결하는 씬의 번호가 그 안에 있을 때만 읽는다.** "001,003,005.moho"를 a001에 연결하면 묻고, a007에 연결하면 묻지 않는다. **P4의 답("물어보기")은 글자가 붙은 목록의 것이고, 글자 없는 목록은 그와 무관하게 이렇다** — 글자도 없고 지금 씬의 번호도 없는 숫자 줄은 날짜일 수 있다. 씬 하나뿐인 이름("a012.moho")도 다른 씬에 연결하면 이름으로는 묻지 않는다(시안).
- **글자 붙은 번호 목록이 이름에 따로 있으면, 글자 없이 남은 숫자는 읽지 않는다.** "a001,003-005,007.moho"는 a001·a003의 파일로만 읽는다 — a005에 연결하면 a001·a003을 권하고(P4) 하이픈 뒤의 007은 권하지 않는다(하이픈·점·괄호·한글 뒤로는 목록이 이어지지 않는다). 목록 앞에 적은 화 번호·날짜("005_006 a 005,007")도 목록이 되지 않는다. 다른 파트의 파일("b001,003-005,007.moho")을 파트 a에서 연결해도 뒤의 005·007을 지금 파트의 씬으로 읽지 않는다. **하나는 막지 못한다**: 다른 파트 글자의 번호 **하나** 뒤에 남은 숫자 — "b001-003,005.moho"를 a003에 연결하면 a005를 권한다(창에 뜬 씬 번호를 보고 "이 씬만"을 누른다).
- **하이픈은 범위도 구분도 아니다.** "a001-005"는 묻지 않는다. 범위는 물결표로 쓴다(P1). 글자와 숫자 사이의 하이픈("b-001,003")은 "b 001,003"과 같이 읽는다.
- **쉼표·띄어쓰기·밑줄 말고 `+`와 `&`도 번호를 잇는 것으로 읽는다**("a001+003&005").
- **범위 하나는 50개까지**이고, 거꾸로 쓴 범위("a005~001")는 읽지 않는다. 범위 안에 없는 번호는 조용히 빠지고, a003A 같은 추가 씬은 범위에 들지 않는다(이름에 직접 적어야 든다). 범위로 읽히지 않는 `~`가 있으면 그 바로 뒤에 이어 쓴 번호들은 읽지 않는다. 범위를 이어 쓰면("a001~050,051~100") 그만큼 더 읽는다 — 한 번에 연결할 수 있는 씬 수의 끝은 그 파트의 씬 수다.
- **글자는 그 씬 번호의 글자와 같아야 한다**(또는 글자가 없어야 한다). "take 001,002", "SWver12", "bg-001,003"은 읽지 않는다.
- **파트 글자와 번호 사이에 다른 글자를 넣은 이름은 읽지 못한다.** "A_BG_001,003", "EP05_A_ACT_001,003"(비플로우의 시트 이름과 같은 꼴), a 씬에 연결한 "sc 001,003"·"ac001,003", 화 번호를 세 자리로 쓴 "ep005_001,003". 이런 이름은 다른 씬들의 파일로 쳐서 **레이아웃이 같은 씬도 묻지 않는다** — 조용히 아무 일도 없다. 실제 파일 이름이 이런 꼴인지는 2026-10-10에 P1과 함께 물었고 답이 없다 — 지금 규칙대로 나가고 후속 항목이다(15.1).
- **글자와 번호 사이에 점·괄호·한글이 끼면 글자를 놓친다.** "b.001,003", "B) 001,003", "A파트 001,003"은 지금 파트의 001·003으로 읽힌다. 다른 파트의 파일이면 틀린 목록이 뜬다 — 창에 뜬 씬 번호를 보고 "이 씬만"을 누른다.
- **숫자에 바로 붙은 영문 1~3자는 추가 씬 표시로 읽는다.** "a003fix"는 a003FIX라는 씬으로 읽혀, 그런 씬이 없으면 a003은 권하지 않는다. 메모는 밑줄이나 하이픈, 한글로 띄어 쓰면 된다("a001,003_fix", "a001,003수정").
- **씬 번호와 자릿수가 같은 판·테이크·프레임 번호를 빈칸·밑줄·쉼표로 이어 쓰면 씬으로 읽힌다.** "a001 002", "a003_001.moho", "a001,003_002.moho"가 그렇고, 그 뒤에 물결표를 쓴 "a001_010~020.moho"는 a010부터 a020까지로 읽힌다. 가를 방법이 없다(시안의 "a001_003_005"와 같은 꼴이다). **이 자리는 묻지 않는 쪽이 아니라 묻는 쪽으로 틀린다** — 그 번호의 씬이 처음부터 체크돼 뜨고(P2), 다른 파일이 걸린 씬이면 "→ 이 파일로 바뀜"으로 뜬다. 창에서 "이 씬만"을 누른다. 판 번호에 글자를 붙이거나("a003_v001") 자릿수를 다르게 쓰면("a003_01") 읽지 않는다.
- **'파일 이름에는 있지만 이 파트에 없는 씬' 줄에는 씬이 아닌 숫자가 오를 수 있다.** 목록 끝에 자릿수가 같은 다른 숫자를 이어 쓰면("a001,003 100%.moho", "a001,003_720p.moho") a100, a720P로 적힌다(연결은 일어나지 않는다). 이 줄의 번호는 파일 이름에 적힌 자릿수대로 보인다 — 번호를 0 없이 쓰는 파트라면 a005가 아니라 a5.
- **폴더 이름은 읽지 않는다**(파일 이름만).

**(다) 그 밖에 알릴 것.**

- **P1~P4에 받은 답(2026-10-10)과, 그 답대로 나간 동작.** P1 — 물결표는 범위로 읽는다(스튜디오는 파일 이름에 물결표를 쓰지 않으므로 드물게 만나는 길이다). P2 — 파일 이름에 적힌 씬은 다른 파일이 걸려 있어도 처음부터 체크돼 뜬다. P3 — 레이아웃만 같은 씬은 체크가 풀린 채 함께 뜬다. **P4 — "물어보기"**: 파일 이름에 지금 연결하는 씬의 번호가 없어도 이름에 적힌 씬들을 권하고, 레이아웃이 같은 씬도 평소대로 보여 준다("a 001,003,005,007.moho"를 a009에 연결하면 a001·a003·a005·a007을 묻는다). **그 씬들은 처음부터 체크된 채 뜬다 — 비어 있는 씬도, 다른 파일이 걸린 씬도(P2. 그 줄에는 "→ 이 파일로 바뀜").** 그래서 파일을 이름에 없는 씬(a009)에 연결하고, 뜬 창에서 그대로 "선택한 N개에 연결"을 누르면 a001·a003·a005·a007에 이 파일이 걸린다 — 다른 파일이 걸려 있던 씬은 그 파일이 이 파일로 바뀐다(Enter로는 눌리지 않고, 바뀌는 파일의 수가 버튼 위에 보이고, 되돌리기는 10초다 — (가)2·3과 아래의 되돌리기 줄). 대가 둘도 함께 적는다: 파일을 엉뚱한 씬에 걸어도 그 파일 이름에 적힌 씬들을 **체크된 채로** 묻는다는 것(그대로 누르면 그 씬들의 대표 파일이 이 파일이 된다), 파트 글자가 판 글자와 같은 파트(V 파트)에서는 판 글자를 붙여 판 번호를 둘 이상 이어 쓴 이름이 — 자릿수와 무관하게("main_v1_v2", "main_v01_02", "main_v001_v002") — 씬 목록으로 읽힌다는 것(15.1). **함께 물은 둘**(파일 이름에 "A_BG_…" 같은 꼴을 쓰는가, 레이아웃 번호를 파트를 넘어 같이 쓰는가)은 "물었고 답이 없어 이번에는 지금 규칙대로 나갔다 — 후속 항목"으로 적는다.
- **레이아웃이 같은 씬이 있으면 파일 이름에 번호가 없어도 창이 뜬다**(P3). 그 씬들은 체크가 풀려 있다.
- **레이아웃은 글자 그대로 견준다**('12'와 '012'는 다르다 — 묶어 보기 화면과 같다). 자기 레이아웃이 비었으면 배경↔액팅 짝 씬의 레이아웃을 따른다. 묶어 보기 화면이 씬을 묶는 방식은 손대지 않았다.
- **되돌리기는 10초**다(다른 되돌리기는 5초). 바뀌는 파일이 있어 조금 길게 두었다. 되돌리는 것은 한꺼번에 연결한 씬들뿐이고, 처음 연결한 그 씬은 그대로다. 못 되돌려 다시 뜬 되돌리기도 10초다((가)6).
- **"이 씬만"·Esc·바깥 누르기는 모두 같은 뜻**이고 추가 알림이 없다.
- **우클릭 메뉴는 지금처럼 빈 칸만 연결한다.** 이미 파일이 있는 씬의 파일을 바꾸면서 묻게 하려면 상세 창의 연필(수정)을 쓴다.
- **한 파일을 여러 씬에 걸면 그 파일을 열 때 그 씬 모두에 '작업 중'이 뜬다**(알려 둔 점).
- **(이 기능 말고도 달라지는 것 1) '작업 중' 표시를 다시 계산하는 일을 잠깐 모아서 한다.** 링크가 여러 개 한꺼번에 바뀔 때 PC가 버벅이지 않도록, 링크가 바뀐 뒤 '작업 중' 표시를 다시 계산하는 일을 0.4초(바뀜이 이어지면 길어야 2초) 모았다가 한 번만 하게 했다. **한 씬만 연결할 때도 같다** — 링크를 바꾼 뒤 '작업 중' 표시가 따라오기까지 0.4초쯤 더 걸린다(감지가 4초마다 돌아 눈에 띄지는 않는다). 모든 PC에 해당한다.
- **(이 기능 말고도 달라지는 것 2) 새 창(위젯)은 작업 링크가 바뀔 때 자료를 다시 받지 않는다.** 지금은 누가 링크 하나를 바꿀 때마다, 떠 있는 새 창이 모두 자료를 통째로 다시 받고 있었다 — 새 창에는 작업 링크가 보이지도 않는데. 여러 씬에 한꺼번에 연결하면 그것이 씬 수만큼 겹치므로 껐다. 새 창에 보이는 것은 달라지지 않는다.
- **(이 기능 말고도 달라지는 것 3) 경로 붙여넣기 칸에서 Enter를 빠르게 두 번 쳐도 저장은 한 번만 된다.** 지금은 빈 칸에서 그렇게 하면, 방금 넣은 바로 그 경로를 두고 "이미 연결된 경로가 있어요 … 새 경로로 바꿀까요?"라는 헛확인 창이 뜨곤 했다. 그 확인 창 때문에 이 창이 묻지 못하거나 가려지는 일을 막으려고 함께 고쳤다.
- **넣지 않은 것**: 작업 폴더·추가 파일, '레이아웃 #N' 머리줄이나 여러 씬 선택 막대에서 연결하기, 파일이 없는 씬에서 거꾸로 묻기, 창의 '모두 선택', 예전 파일을 같이 쓰던 씬 찾기. 필요하면 따로 정한다.
- **확인하지 못한 것**: 12절 끝의 "배포 뒤 실기에서만 볼 수 있는 것"(새 창을 띄워 둔 PC의 부담, 실제 망에서 겹친 Enter 포함), 미리보기로 열 수 없었던 화면(D3), 진짜 실시간이 걸린 경우(미리보기에서는 흉내로만 봤다 — F7~F9b).
- **답 없이 나가는 것은 함께 물은 둘뿐이다.** P1~P4는 모두 답을 받은 값으로 나간다(위 첫 줄).
