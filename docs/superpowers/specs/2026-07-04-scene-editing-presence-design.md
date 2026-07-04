# 실시간 "작업 중(파일 열림)" 프레즌스 — 설계 문서

> **작성일**: 2026-07-04
> **작성**: Claude × 한솔 (Studio JBBJ)
> **상태**: 설계 승인 완료 (UX 전 항목), 구현 계획(writing-plans) 대기
> **토대**: `2026-06-25-scene-work-links-design.md` (씬에 작업 파일 경로를 연동하는 기능)

---

## 1. 개요 / 목표

씬에 **연동된 제작 파일(Moho `.moho`)** 을 팀원 누군가가 지금 열어 작업 중이면, B flow 안에서 **실시간으로** 그 씬에 "누가 편집 중"을 표시한다. 목적은 **동시 편집 충돌(구글 드라이브가 조용히 `[충돌]` 사본을 만드는 사고)의 사전 인지**다.

표시는 세 곳에 나타난다: **카드뷰 / 시트뷰 / 상세 모달**. 시각 언어는 **회전하는 무지개 테두리 + 무지개 이름표**로 통일한다.

### 성공 기준
- 팀원 A가 연동된 `.moho`를 열면, 다른 팀원들의 B flow 카드/시트/모달에 **수 초 내(≤ ~6초)** A의 이름과 무지개 표시가 뜬다.
- A가 그 파일을 닫거나 B flow/앱이 종료되면, 표시가 **자동으로 사라진다** (유령 잔상 없음).
- 같은 파일을 2명 이상이 동시에 열면, 상세 모달에 **전원 이름 + 경고 톤**으로 뜬다.
- 다크/라이트 모드, 모션 최소화 설정에서 모두 올바르게 렌더된다.

---

## 2. 배경 — 감지 방식이 이 형태인 이유 (요약)

사전 타당성 조사(2026-07-04)의 확정 결론:

- **구글 드라이브(`G:\공유 드라이브`)는 신호를 주지 않는다.** `.moho` 같은 일반 바이너리 파일에 대해 "누가 지금 열고 있나"를 사용자 간 실시간으로 알려주는 기능이 없다(실시간 presence는 MS Office 전용). 따라서 드라이브/파일 시스템 관찰 방식은 불가능.
- **Moho는 파일 잠금을 유지하지 않는다.** `.moho`는 ZIP 컨테이너라 열 때 메모리로 읽고 핸들을 닫을 공산이 크다. 오토세이브도 파일 옆이 아니라 `%APPDATA%`. → OS 파일 잠금 폴링은 신뢰 불가.
- **유일하게 견고한 길 = 앱 자체 프레즌스.** 각 팀원의 B flow가 로컬에서 "내가 이 파일을 열었다"를 감지해 서로에게 방송한다. (Figma/구글독스 멀티플레이어와 동일 원리.)
- **로컬 감지 = 창 제목 읽기 (실측 확정).** Moho 창 제목은 `b030.moho -Moho` 형식으로 **활성 탭 파일명(확장자 포함)** 을 노출한다(폴더 경로는 미노출). Moho는 한 창 안에서 탭으로 여러 파일을 열며 **창 제목은 활성 탭만 반영**한다. → 감지 단위는 **활성 탭 파일 1개**.

이 배경에서 나오는 두 가지 근본 경계(비목표 아님, 수용된 한계):
1. 감지되려면 그 사람 PC에 **B flow가 켜져 있어야** 한다.
2. **백그라운드 탭에 열어만 둔 파일**은 감지되지 않는다(활성 탭이 되는 순간 즉시 잡힘).

---

## 3. 비목표 (YAGNI / 명시적 제외)

- ❌ **"방금까지 편집(노란색 유예)" 상태 없음.** 상태는 **켜짐/꺼짐 이진값**만. 활성 탭이면 표시, 아니면 즉시 제거.
- ❌ **B flow 없이 연 사람 감지 불가.** 드라이브/서버를 관찰하는 완전 자동 감지는 구현하지 않는다(2절 참조).
- ❌ **파일 편집 잠금/차단 없음.** 이 기능은 **표시(인지)** 전용이다. 실제로 열기를 막거나 강제 잠그지 않는다.
- ❌ **편집 이력/감사 로그 적재 없음.** 프레즌스는 휘발성이며 DB에 영구 기록하지 않는다.
- ❌ **팀원별 색상 구분 없음.** 이름표는 **무지개 통일**(사용자 결정). 신원은 이름 텍스트로 구분한다.
- ❌ **SMB/NAS 전환 없음.** Moho 특성상 서버를 바꿔도 반쪽이므로 이 기능만을 위해 저장소를 옮기지 않는다.

---

## 4. 아키텍처

메인(Electron) 프로세스가 **감지 + 프레즌스 송수신**을 담당하고, 렌더러는 **표시**만 한다(IPC 규칙: 렌더러는 Supabase 직접 호출 금지).

### 유닛 분해 (각 유닛은 경계·인터페이스가 명확하고 독립 테스트 가능)

**U1. Moho 창 제목 감지기 (main)**
- 책임: 실행 중인 Moho 창 제목을 주기적으로 읽는다.
- 구현: `process.platform === 'win32'` 일 때만 동작. `setInterval`(기본 4초)마다 PowerShell 1회 실행 —
  `Get-Process -Name *moho* -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }`
  (모든 Moho 인스턴스의 MainWindowTitle을 줄 단위로 반환. `spawn`은 `electron/autoUpdate/installerApply.ts`의 기존 패턴을 따른다.)
- 순수 코어(I/O 분리, 단위 테스트 대상): `parseMohoTitles(rawLines: string[]): string[]`
  - 각 줄에서 후행 ` -Moho`(및 앞뒤 공백) 제거 → 남은 문자열에서 파일명 추출 → 미저장 표시 `*` 제거 → 소문자화 → 빈 값/비-moho 줄 제외 → 정규화된 basename 배열 반환.
  - 예: `"b030.moho -Moho"` → `"b030.moho"`; `"b030-피드백.moho* -Moho"` → `"b030-피드백.moho"`.
- 인터페이스: `onActiveTitles(callback: (basenames: string[]) => void)` — 폴링 결과가 **이전과 다를 때만** 콜백.

**U2. 씬 링크 인덱스 (main)**
- 책임: `scene_work_links`의 `primary_file` 경로들로부터 **basename(소문자) → Set\<sceneUuid\>** 매핑을 유지한다.
- 데이터원: `electron/supabase.ts`의 `readSceneWorkLinks()` (타입 `SupabaseSceneWorkLink`, `path`/`linkKind`/`sceneUuid`/`department` 필드). basename은 `path.basename(link.path)`.
- 갱신: 메인은 이미 `bflow-realtime` 채널로 `scene_work_links` 변경을 수신하므로(realtime.ts), 해당 콜백에서 인덱스를 무효화·재구축한다. 최초 1회는 앱 데이터 로드 시 채운다.
- 인터페이스: `resolveScenes(basenames: string[]): string[]` — 매칭되는 sceneUuid 목록(중복 제거).
- **콜리전 규칙**: 한 basename이 여러 sceneUuid에 매핑되면(폴더만 다른 동명 파일) **전부** 반환하고, 그 basename에 대해 **1회만** 경고 로그를 남긴다(스팸 방지). 창 제목엔 폴더가 없어 구분 불가 — 수용된 한계.
- 대상 linkKind: `primary_file`만(대표 파일). `folder`/`extra_file`은 제외.

**U3. 프레즌스 발행기 (main)**
- 책임: (U1 결과 → U2 resolve) 로 **로컬 사용자가 지금 편집 중인 sceneUuid 집합**을 만들고, 변할 때만 Supabase에 track한다.
- 구현: `bflow-realtime` 채널(기존)에서 `channel.track({ userId, username, editingSceneUuids: string[], updatedAt })`.
  - 추가 회선 없음(같은 채널에 presence 얹기). presence key = userId(사용자당 1 연결).
- **연결 소유권(중요)**: `track()`은 **메인 프로세스만** 호출한다(메인이 유일한 Supabase 연결 보유). 렌더러/위젯 창은 절대 track하지 않는다 — 같은 userId로 두 연결이 생기면 한쪽이 다른 쪽의 `editingSceneUuids`를 덮어쓸 수 있으므로 금지.
- **페이로드 크기**: `editingSceneUuids`는 활성 탭이 1개이므로 사실상 원소 1개(콜리전 시에만 소수). presence 페이로드는 항상 작음 — 크기 한계 우려 없음.
- 디바운스: 최소 발행 간격(예: 1.5초)으로 탭 빠른 전환 시 과발행 방지.
- 재연결: 소켓 재구독 시 현재 집합으로 재track.

**U4. 프레즌스 수신기 (main)**
- 책임: `channel.on('presence', ...)` **sync/join/leave 3개 이벤트**(Supabase presence는 `'*'` 와일드카드 미지원) 및 `presenceState()`로 **전체 프레즌스**를 받아 **sceneUuid → EditingUser[]** 맵으로 합치고, 렌더러/위젯으로 전달한다.
- 전달: 기존 `broadcastSupabaseEvent` 패턴을 본뜬 `broadcastSupabasePresence(snapshot)` — IPC 채널 `'supabase:presence-event'`로 `mainWindow` + 모든 `widgetWindows`에 **전체 스냅샷**을 보낸다(델타 아님, 단순·안전).
- `EditingUser` = `{ userId: string; username: string }`.

**U5. IPC 브리지 + 렌더러 스토어**
- Preload: `onSupabasePresence(callback)` 추가(`preload.ts`의 `onSupabaseRealtime` 패턴과 동일, 채널만 `'supabase:presence-event'`).
- 렌더러 스토어: 신규 `useEditingPresenceStore` (Zustand) — `presenceByScene: Map<string, EditingUser[]>` 보관. `applyPresenceSnapshot(snapshot)` 로 통째 교체.
- 선택자 훅: `useSceneEditingPresence(sceneUuid?: string | null): EditingUser[]` — 해당 씬의 편집자 목록, **현재 로그인 사용자는 제외**(자기 화면엔 자기 표시 안 함).

**U6. 표시 컴포넌트 (renderer)**
- `EditingPresenceBeam` — 자식(카드/행/모달 본체)을 회전 무지개 테두리로 감싸는 wrapper. 편집자 0명이면 아무 효과 없이 자식 그대로 통과(레이아웃 불변). 2명 이상이면 경고 톤(붉은 기 도는 무지개) variant.
- `EditingNameLabels` — 무지개 이름표. 카드/시트: 최대 2개 나란히 + 초과분 `+N`. 모달 배너: 전원 나열.
- 적용 지점:
  - 카드: `UnifiedSceneCard.tsx` 최상위 `motion.div`(`data-scene-id`) 를 `EditingPresenceBeam`으로 감싸고, 기존 `SceneWorkLinkBadges`와 겹치지 않는 코너에 `EditingNameLabels` 배치. sceneUuid는 `bgScene?.id`/`actScene?.id`(둘 중 편집자 있는 부서).
  - 시트: `UnifiedSceneSheetView.tsx`의 행 최상위 wrapper를 `EditingPresenceBeam`으로(행 전체 테두리 회전) + 행 우측 끝 이름칩.
  - 상세 모달: `UnifiedSceneDetailModal.tsx` 본체 wrapper 상단에 프레즌스 배너(`○○ 님이 지금 작업 중 · 파일 열려 있음`, 2명+ 경고 톤).

**U7. 무지개 테두리 스타일 (renderer, 공용 CSS)**
- 회전: CSS `@property --angle` + `conic-gradient(from var(--angle), ...무지개...)` + `@keyframes spin`. 테두리 두께는 wrapper `padding` + 내부 요소가 중앙을 덮는 방식.
- 테마: 내부 요소는 기존 토큰(`bg-bg-card` 등, `src/themes.ts`의 CSS 변수 + `.dark` 클래스)을 그대로 써 **다크/라이트 자동 대응**. 무지개 그라디언트는 두 모드 공통.
- 모션: `@media (prefers-reduced-motion: reduce)` 에서 회전 애니메이션 제거(정지 무지개). (앱은 이미 `matchMedia('(prefers-reduced-motion: reduce)')` 를 `SceneContinuityTransition.tsx`에서 사용 — 동일 기준.)
- 폴백: `@property` 미지원 환경에선 정지 그라디언트로 자연 저하(Electron Chromium은 지원).

---

## 5. 데이터 흐름

```
[Moho 탭(활성 파일)] 
   │ U1: PowerShell 폴링(4초) → parseMohoTitles
   ▼ basenames[]
[U2 씬 링크 인덱스] resolveScenes → 로컬 편집 sceneUuid[]
   │ U3: 변경 시에만 channel.track({ editingSceneUuids })   (bflow-realtime, presence)
   ▼
[Supabase Realtime presence]
   │ 모든 클라이언트로 전파
   ▼ U4: on('presence') → sceneUuid→EditingUser[] 스냅샷
[broadcastSupabasePresence] → IPC 'supabase:presence-event' → mainWindow + widgetWindows
   ▼ U5: preload onSupabasePresence → useEditingPresenceStore.applyPresenceSnapshot
[useSceneEditingPresence(sceneUuid)]  (자기 자신 제외)
   ▼ U6/U7
[카드/시트/모달: 무지개 테두리 + 이름표 / 배너]
```

---

## 6. UI 사양 (확정)

- **비주얼**: 회전 무지개 테두리(편집 중인 씬만), 무지개 이름표(테두리 안에 팀원 이름 + 라이브 점).
- **카드뷰**: 카드 테두리 회전, 우상단 이름표. 최대 2개 + `+N`.
- **시트뷰**: 행 전체 테두리 회전(카드와 통일), 우측 끝 이름칩. 최대 2개 + `+N`.
- **상세 모달**: 상단 배너 `○○ 님이 지금 작업 중 · 파일 열려 있음`. 여러 명이면 전원 나열.
- **여러 명 동시**: 2명 이상 → 경고 톤(붉은 기 도는 무지개 테두리 + 배너 강조). "나 말고 또 누가 이거 만지네"를 즉시 인지시키기 위함.
- **자기 자신**: 내 화면엔 내 무지개/이름표를 표시하지 않음(내가 연 건 내가 아니까). 단 내 상태는 남에게 정상 방송됨.
- **다크/라이트**: 둘 다 대응. 내부 표면은 테마 토큰을 따르고 무지개는 공통.
- **모션 최소화**: 회전 없이 정지 무지개.
- **레이아웃 불변**: 편집자 0명일 때 컴포넌트가 자식을 그대로 통과시켜 기존 카드/행/모달 크기·정렬에 영향 없음.

---

## 7. 엣지 케이스 / 에러 처리

| 상황 | 처리 |
|------|------|
| 비-Windows(개발용 mac/linux) | U1 감지 no-op. 프레즌스 **수신·표시는 정상**(남의 편집은 보임). |
| Moho 미설치 / 창 없음 | PowerShell 결과 공백 → 편집 집합 빈 값. 오탐 없음. |
| PowerShell 실행 실패/예외 | 해당 폴링만 빈 결과로 처리, 스로틀드 경고 로그. 폴링 루프는 계속. |
| Moho 프로세스명 편차(버전별) | `-Name *moho*` 와일드카드로 매칭. 그래도 없으면 빈 값. (PR1에서 실제 프로세스명 실측 확인.) |
| 창 제목 형식 편차(버전/미저장 `*`/확장자 없음) | `parseMohoTitles`가 ` -Moho` 접미사·`*`·공백을 관대하게 제거. 매칭 실패 줄은 조용히 스킵. |
| basename 콜리전(동명 파일 다른 폴더) | 전 sceneUuid에 표시 + basename당 1회 경고 로그. |
| 탭 빠른 전환 | U3 디바운스로 과발행 방지. |
| Supabase 연결 끊김 | presence 자동 소멸(타 클라이언트 `leave`). 재연결 시 현재 집합 재track. |
| 앱/ B flow 강제 종료 | 소켓 종료 → 자동 소멸(유령 없음). |
| 위젯 팝업 창 | `broadcastSupabasePresence`가 `widgetWindows`에도 스냅샷 전달(기존 realtime 패턴 동일). 단 현재 위젯들(전체 진행률·단계별 등)은 씬 카드/행을 렌더하지 않아 무지개를 그릴 표면이 없음 — 전달은 안전한 단순화이자 향후 대비이며, 지금은 소비 UI 없음. |
| 무료 플랜 회선 수 | 기존 `bflow-realtime` 채널 재사용 → **추가 회선 0**. |

---

## 8. 테스트 전략

**단위 테스트**
- `parseMohoTitles`: `b030.moho -Moho`, `b030-피드백.moho* -Moho`, 다중 인스턴스(여러 줄), 공백/빈 줄, 비-moho 줄, 확장자 없는 경우, 대소문자 → 기대 basename 배열.
- `SceneLinkIndex.resolveScenes`: 정상 매칭, 대소문자 무시, 콜리전(1 basename → 다중 sceneUuid), 미매칭.
- 프레즌스 스냅샷 병합: presence state → `sceneUuid→EditingUser[]` 변환, 중복 제거.
- `useSceneEditingPresence` 선택자: 자기 자신 제외, 씬별 필터링.
- 이름표 로직: 편집자 수 → `≤2 + "+N"`, 2명+ 경고 톤 플래그.

**컴포넌트 테스트 (RTL)**
- 카드/시트/모달: 편집자 0명(효과 없음)·1명·2명·3명(+N) 렌더, 경고 톤, 자기 제외, 다크/라이트 클래스, `prefers-reduced-motion` 정지.

**수동 E2E (미리보기 모드 2계정)**
- 동일 `.moho`를 A가 열기 → B 화면 해당 씬에 A 무지개+이름 (≤6초). A 닫기 → 사라짐. A·B 동시 → 모달에 둘 다 + 경고 톤.

**빌드 검증 (CLAUDE.md 필수)**: 각 PR에서 `npm run typecheck` + 관련 테스트 + `npm run build:vite` 통과. 최종 PR에서 `npm run build`.

---

## 9. 단계별 PR 분해 (각 PR = 독립 브랜치 → 코덱스 리뷰 루프 → 최종 코드리뷰/테스트 → 머지)

- **PR0 (문서)**: 이 설계 문서 + 구현 계획 문서. 자체 검수 + 한솔 검토.
- **PR1 — 감지 엔진(main)**: U1(`parseMohoTitles` 순수 코어 + PowerShell 폴러, win32 가드) + U2(씬 링크 인덱스, 콜리전 규칙). 단위 테스트. UI 없음(내부 이벤트/로그로 검증). PowerShell 프로세스명 실측 확인 포함.
- **PR2 — 프레즌스 전송(main+renderer 배선)**: U3(track) + U4(수신·스냅샷) + IPC(`supabase:presence-event`, preload) + U5(`useEditingPresenceStore` + 선택자). **완료 기준(검증 가능)**: 개발 전용 오버레이(예: 화면 구석에 `sceneUuid → [이름]` 목록을 텍스트로 렌더, `import.meta.env.DEV` 가드)를 붙여 미리보기 모드 2계정으로 — A가 연동 파일 열기 → B의 오버레이에 A 이름이 해당 sceneUuid로 나타나고, 닫으면 사라짐을 확인. 이 오버레이는 PR3에서 실제 UI로 대체·제거.
- **PR3 — UI**: U6/U7(무지개 테두리 + 이름표) 카드·시트·모달 적용, 다크/라이트, 모션 최소화, 다중 편집자/경고 톤, 자기 제외. 컴포넌트 테스트.
- **PR4 — 마무리**: 테스트 보강, 접근성/성능 점검, `DEVLOG/update-notes.json`(비개발자 톤) 추가, 버전 상향(신규 기능 → **1.71.0**), 최종 코드리뷰 + `npm run build`. 머지.

> 각 구현 PR은 직전 PR 머지 후의 `main`에서 분기한다. `bflow-release-deploy`/`codex-review-loop` 스킬 사용. **머지까지가 이번 작업 범위**이며, G드라이브 배포/매니페스트 갱신은 별도 지시 시에만.

---

## 10. 미해결 / 실측 필요 (PR1에서 확정)

- **Moho 실제 프로세스명**: `Get-Process -Name *moho*` 가 잡는 정확한 이름(예: `Moho`, `Moho Pro`, `MohoPro13`). 실측 후 필요 시 필터 조정.
- **최소화/비포커스 시 MainWindowTitle 유지 여부**: 캡션은 포커스와 무관하게 유지되는 것으로 판단하나 PR1에서 실측 확인.
- **폴링 주기 최종값**: 기본 4초. 체감/부하 보고 조정(2~6초 범위).

---

*이 문서는 승인된 UX 결정과 확인된 통합 지점에 기반한다. 구현 계획(writing-plans)에서 파일·함수 단위로 세분한다.*
