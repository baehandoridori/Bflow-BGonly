# AGENTS.md — B flow

> **배경 라이브러리 시험 공개 (v1.130.0, 2026-10-08):** 배경 라이브러리(장소·도면·배경·에피소드별 배경)와 평면/3D 공동 도면을 main에 통합했다. **메뉴와 화면은 배한솔 계정에만 열려 있다** — 사이드바 노출과 화면 진입이 모두 `src/features/playground/featureFlag.ts`의 `canAccessBackgroundLibrary`를 거치므로, 공개 범위를 넓힐 때는 그 함수만 바꾼다(화면 노출만 막는 장치다. 서버 권한은 별개로, 읽기는 로그인한 누구나·장소/도면/배경 편집은 관리자·에피소드별 사용 기록은 팀원도 가능하다). 운영 DB에는 2026-10-08에 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` 순서로 적용했다. 적용 사슬은 기본 → 3D → `2026-10-09-background-map-elements.sql`(v1.133.0 — 요소 파일은 2026-10-10에 20261010090509로 적용)이며, **앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다**(앞 파일만 돌리면 배경 편집이 사실상 모두 막힐 수 있다. 그때 도면을 지워서 풀지 않는다 — AGENTS.md '배경 라이브러리 데이터 경계'). 결정·미검증 항목은 [구현 인수인계](DEVLOG/background-3d-opus-handoff-2026-10-07.md) §13~§14, 검증 내역은 [누적 검증 기록](DEVLOG/background-library-verification-2026-09-21.md)을 본다.

> **프로젝트**: Studio JBBJ 프로덕션 진행 현황 대시보드 (BG + 액팅)
> **타입**: Electron + React + TypeScript 독립 앱
> **현재 상태**: Phase 0-1~0-3 완료, Phase 1~2 완료, Phase 4-1~4-3 완료, Phase 6 Step 1~4 완료, Phase 7-1~7-5 완료, Phase 8-0~8-1, 8-3~8-5 완료, Playground v3 배한솔 한정 테스트 중
> **로드맵**: `ROADMAP.md` 참조 | **세션 가이드**: `CONTEXT.md` 참조
>
> **이력**: 원래 BG(배경) 전용 현황판(`Bflow-BGonly`)으로 시작했으나, 액팅까지 포함한 통합 앱이 되면서 정식 명칭 **B flow**로 전환됨. 레포 이름(`Bflow-BGonly`)과 `app.name`은 기존 사용자 데이터 경로(`%APPDATA%\Bflow-BGonly\`) 호환을 위해 유지.

---

## ⚠️ 필수 규칙

1. **Bflow 레포 (`/home/user/Bflow`)는 참고 전용이다. 절대 직접 수정하지 말 것.**
   - 코드 구조, 패턴 참고만 가능
   - 파일 수정, 커밋, 푸시 일절 금지
   - 모든 개발은 반드시 `Bflow-BGonly` 레포에서만 진행
2. **빌드 검증**: 코드 변경 후 반드시 `npm run typecheck` + 관련 테스트 + `npm run build:vite` 통과 확인. 정식 배포는 `npm run build`까지 확인
3. **낙관적 업데이트 패턴**: 모든 데이터 변경은 즉시 UI 반영 → Supabase 동기화 → 실패 시 롤백
4. **테스트 모드 동등성**: 모든 기능은 테스트 모드에서도 100% 동작해야 함
5. **자동 업데이트 배포 원칙**: G드라이브에는 빌드 파일을 먼저 모두 올리고 `manifest.json`을 마지막에 갱신할 것. 앱은 manifest를 보고 최신 버전을 감지하므로, 반쯤 올라간 빌드가 최신으로 보이면 안 됨.

---

## 프로젝트 개요

Studio JBBJ 팀(~20명)이 에피소드별 BG/액팅 씬의 진행 상황을 실시간 추적하는 Electron 앱.
Supabase(PostgreSQL + Realtime)를 단일 진실의 원천(SSOT)으로 사용. Google Sheets/Drive 계열 코드는 이미지·레거시 호환 일부에 남아 있다.

**동기화**: 체크박스 토글 → 로컬 즉시 반영(낙관적) → Supabase 저장 → 실패 시 롤백. 다른 사용자 변경은 Realtime WebSocket으로 수신.

### 외부 캘린더 구독 (v1.126.0)

- 캘린더 설정에서 소유자가 명시적으로 발급한 주소만 공개한다. `calendarSubscriptionIpc`는 canonical 세션 epoch를 검사하고 상태 조회는 서버 세션으로 소유자·팀 공유·명시적 공유 멤버를 확인하고, 발급·교체·중지는 소유자만 허용한다. 관리자 전체 조회만으로 구독 주소를 읽을 수 없다.
- `calendar_external_feeds`는 256비트 구독 토큰의 SHA256만 보관한다. 재조회용 별칭 원문은 Supabase Vault에 암호화하고 `calendar_feed_private.aliases`는 해시·비밀 참조만 보관한다. 기존 발급 주소도 계속 유효하며, 공유 멤버는 상태 조회로 별칭 주소를 반복 확인한다. 원문 주소는 로그·개인 설정에 보관하지 않는다. revision 비교로 오래된 창의 교체·중지를 거절한다.
- `calendar-feed` Edge Function은 URL 토큰을 직접 인증하므로 이 함수만 `verify_jwt=false`다. 서비스 전용 `calendar_feed_read`가 해당 캘린더의 원본·간트 projection만 반환한다. 링크 중지·교체·소유권 이전·삭제로 기존 주소를 무효화한다.
- 종일 일정 종료일은 ICS에서 다음 날로 변환하고, 시간 일정은 서울 시간에서 UTC로 변환한다. 읽기 전용 URL 구독이며 외부 앱의 갱신 주기를 따른다. 프리뷰 주소는 `.invalid`로 실제 외부 구독이 불가능함을 표시한다.

### 반복 일정 데이터 경계 (v1.125.0)

- 반복 원본은 `calendar_events.recurrence_rule`, 날짜별 예외는 `calendar_event_exceptions`에 저장한다. `calendar_session_recurrence_events/execute`는 canonical session과 원본 revision을 검사한다.
- 화면 ID `recurrence:<UUID>:<원래 날짜>`는 표시용이다. 저장·알림 외래키에는 원본 UUID만 사용한다. `src/shared/calendarRecurrence.ts`로 각 화면의 날짜 구간에서 펼치며, 간트의 저장 snapshot에는 펼친 작업을 쓰지 않는다.
- 알림은 메인 프로세스가 조회 권한·한국 시간·사용자별 전달 기록을 검사한다. 종일 일정은 오전 9시, 재시작 catch-up은 최근 30분이며 관리자 전체 열람만으로 알림 대상이 되지 않는다. 앱이 종료된 동안 Windows 알림을 보장하지 않는다.
- 외부 구독은 RRULE/EXDATE/RECURRENCE-ID를 출력한다. 시간 지정 반복은 Asia/Seoul TZID를 유지하고, 매월 없는 날짜는 건너뛴다.

### 간트 데이터 경계 (v1.111.0)

- v1.117.4부터 새 로그인은 `SessionManager` → `app_login` 서버 결과만 사용한다. 로컬 `users.dat`나 사용자 디렉터리를 새 로그인 인증·미등록·비밀번호 불일치 판정의 근거로 사용하지 않는다. 서버 불가 시 연결·업데이트 안내 후 보류하며 자격 증명을 자동 재전송하지 않는다. 기존 토큰 복원·데이터 파일은 이 변경으로 삭제하지 않는다.

- 타임라인은 `src/features/gantt/GanttView.tsx`를 사용한다. `domain.ts`는 계층·선행 일정·기간·권한의 공용 계산이며, 프로젝트 하나의 작업을 revision CAS로 함께 저장한다.
- 프로젝트 간 작업·그룹 이동은 `saveProjectPair`로 양쪽 프로젝트와 폴더 revision을 함께 검사하고 원자 저장·실행 취소한다. `20260905193555_gantt_project_pair.sql`이 필요하며 기존 세션 인증·ACL을 유지한다. 차트의 계산된 진행률·입력 초안은 정본 저장 객체로 사용하지 않는다.
- 삭제·복원에도 revision은 증가한다. 비공개 `gantt_entity_revisions`와 preview의 revision 기록을 유지하며, 과거 삭제 기록에서 최종 revision을 복구할 수 없는 ID는 재사용을 거부한다. 새 DB에는 `20260905173804_gantt_revision_ledger.sql`까지 적용한다.
- 실제 앱은 preload → 세션 epoch를 확인하는 `ganttIpc.ts` → `ganttStore.ts` → 서버 로그인 토큰을 받는 `gantt_session_read/gantt_session_execute` RPC를 사용한다. 내부 `gantt_read/gantt_execute`와 테이블 직접 접근은 anon에 허용하지 않는다. 폴더와 프로젝트 정본은 `gantt_spaces`/`gantt_projects`이다.
- 연결 캘린더 일정은 작업의 projection(`gantt:<projectId>:<taskId>`)이다. `calendar_events`에 별도 복제하지 않는다. UUID만 받는 기존 이벤트 RPC/알림 외래키로 이 ID를 보내지 않는다.
- 캘린더 전체 → 간트 연결은 별도 binding과 원본 일정·공유 권한으로 매번 계산하는 폴더/프로젝트다. 원본 이벤트 UUID를 작업 식별자로 쓰며, 기존 Gantt → 캘린더 projection 필드를 재사용하거나 이벤트·멤버를 복제하지 않는다. 연결 프로젝트의 일반 간트 저장·공유·이동은 차단하고, 일정 수정은 원본 캘린더 편집 경로를 사용한다. 연결 해제는 binding만 제거한다.
- 캘린더 → 간트 가져오기는 읽을 수 있는 B flow 일정의 독립 복사본을 기존 프로젝트에 `saveProject` revision CAS로 저장한다. 원본은 수정하지 않으며, `tasks[].importedCalendarEvent` 출처 정보로 프로젝트 안 중복을 막는다. 출처는 권한이나 역방향 연결이 아니므로 `calendarId/calendarEventId`를 채우지 않고 간트 projection은 다시 가져오지 않는다.
- 연결 일정의 `gantt_color`/`ganttColor`는 작업 → 가장 가까운 상위 그룹 → 프로젝트 순서로 상속한 색이다. 일반 일정의 캘린더 색 규칙과 구분하며 `20260905210416_gantt_calendar_color.sql`을 적용한다. 시간표의 마일스톤 표시 높이는 화면용이고 정본 기간은 0분을 유지한다.
- `linked_gantt_task_kind`가 확인된 마일스톤만 시작·종료가 같은 시각을 허용한다. 캘린더 삭제는 작업을 보존하고 연결만 해제한다. 원격 로그인 사용 시 복원 토큰이 없는 기억된 계정은 재로그인 화면으로 안내한다.
- preview는 공용 명령·권한을 사용하되 localStorage를 Web Locks로 직렬화한다. 기존 캘린더 authority 전체를 덮어쓰지 않는다. Realtime/BroadcastChannel은 재조회 신호만 전송한다.
- 새 DB에는 간트 기본 스키마, containment, app-sessions 인증, password-lockdown 및 후속 간트 릴리스 migration을 순서대로 적용한다. 운영 적용 기록을 먼저 확인해 이전 권한을 다시 열지 않는다. `app_login`이 확인한 세션 토큰과 DB ACL을 함께 사용하며, 호출자가 보낸 actor 인자를 본인 인증으로 해석하지 않는다.

### 캘린더 관리자 열람·다중 태그 (v1.120.0)

- `calendar_session_list/events`는 main의 서버 세션 토큰으로 조회한다. 배한솔의 고정 사용자 ID와 `admin` 역할을 모두 확인한 경우에만 다른 사용자의 미공유 캘린더를 읽을 수 있다. `isAdminOverview` 행은 접힌 관리자 목록에 표시하며, 일정 표시 체크는 기본 on이다. 열람 특례는 일정 편집이나 간트 프로젝트 열람 권한을 추가하지 않는다.
- 일정 태그의 정본은 `calendar_events.tag_ids` 배열이며 `tag_id`는 첫 태그로 동기화해 기존 클라이언트와 호환한다. 빈 배열은 전체 해제, 기존 단일 태그만 있는 행은 한 항목 배열로 읽는다. 여러 태그 중 켜진 태그가 하나라도 있으면 일정을 표시한다.
- 태그 카탈로그 변경은 `calendar_session_tags_save`가 서버 세션과 관리자 역할을 검증한다. 삭제는 일정 자체를 보존하고 해당 태그 연결만 제거한다. 새 앱 배포 전 `DEVLOG/migrations/2026-09-16-calendar-admin-overview-tags.sql` 적용이 필요하며, 적용 후 구버전 태그 관리 화면은 업데이트가 필요하다.
- 생성 확인은 `loadAll({ waitForLatest: true })`로 실시간 재조회의 최종 결과를 기다린다. 간트 생성 응답이 유실되면 동일한 생성 ID·내용이 정본에 저장됐는지 확인하며, 확인 없이 쓰기를 재전송하지 않는다.

### 팀 할 일 경계 (v1.118.0)

- 씬·캐릭터 댓글 패널 위 '팀 할 일'의 정본은 `comment_thread_todos` 테이블이다. 스레드 키는 `CommentPanel`의 `effectiveSceneThreadKey`(씬 `EP05:A:a001` — BG/ACT 공통, 캐릭터 `char:{uuid}`)이고, 키가 비면 섹션을 그리지 않는다. 개인용 '나의 할일'과는 별개다.
- 테이블은 RLS on·정책 0개·anon/authenticated 권한 회수 상태로 둔다. 앱은 `app_login` 세션 토큰을 받는 SECURITY DEFINER 래퍼 `comment_thread_todos_session_list/add/set_done/delete`만 호출하고, 호출자·작성자 이름·관리자 판정은 서버가 `app_session_user_id`와 `users` 명시 컬럼으로 확정한다. renderer → preload(요청 epoch) → `electron/threadTodoIpc.ts` → `electron/threadTodoStore.ts` 경로만 쓰며 토큰은 main 밖으로 내보내지 않는다. `users` FK는 두지 않는다(사용자 삭제 경로 회귀 방지).
- 규칙: 공백 정제·1~200자, 완료는 최초 완료자 유지(해제 시 세 칸 모두 비움), 삭제는 작성자 또는 admin(남의 항목 42501, 없는 항목 `deleted:false`). 커밋 뒤 세션이 바뀌면 IPC가 다른 창에 먼저 알린 뒤 `THREAD_TODO_RESPONSE_DISCARDED`로 응답만 폐기하고, 섹션은 롤백·오류 토스트 없이 다시 읽는다.
- 동기화: 테이블을 publication에 넣지 않는다. statement 트리거가 `realtime.send`로 내용 없는 `thread-todos-changed` 신호만 보내고, main은 그 신호·자기 창 IPC 변경·Realtime 재연결 성공 때 모든 창에 `thread-todos:changed`를 보낸다. 섹션은 300ms 디바운스 후 래퍼로 다시 읽는다. 섹션 높이가 늦게 커져도 댓글 패널이 최신 댓글 위치를 보정한다(`src/utils/commentListAnchor.ts`).
- preview: `src/mocks/threadTodoPreviewStore.ts`가 같은 규칙·문구로 localStorage에 저장하고 Web Locks로 쓰기를 직렬화하며, BroadcastChannel로 다른 창에 재조회 신호만 보낸다. 저장소 읽기·쓰기가 실패하면 그 창 메모리로 전환한다. preview의 `widgetOpenPopup`은 Electron과 같은 `#widget-popup/{widgetId}` 경로를 브라우저 새 창으로 연다.
- 새 DB에는 `DEVLOG/migrations/2026-09-14-comment-thread-todos.sql`을 적용하고 `DEVLOG/verification/2026-09-14-comment-thread-todos-smoke.sql`(BEGIN…ROLLBACK)로 확인한다.

### 씬 작업 링크 한꺼번에 연결 (v1.134.0)

- 제안은 `saveWorkLinkPathGuarded`의 성공 줄 뒤 한 곳에서만, 대표 파일일 때만, 기다리지 않고 시작한다.
- 한꺼번에 연결과 되돌리기는 저장소의 `upsertLink`·`deleteLink`를 직접 부른다(가드를 다시 지나면 제안이 되풀이된다).
- 파일 이름을 읽는 규칙은 `src/utils/sceneFileNameList.ts` 한 곳이고 "틀린 목록보다 묻지 않기"가 원칙이다: 자릿수가 같아야 목록, 하이픈은 범위도 구분자도 아님(글자와 숫자 사이의 틈일 뿐), 글자가 맞고 번호가 둘 이상인 목록은 **연결한 씬 자신의 번호가 없어도** 읽는다(P4 — `requireOwnNumber: false`, 한솔 2026-10-10. 번호가 하나뿐인 목록과 글자 없는 목록은 손잡이와 무관하게 자기 번호가 있어야 한다), 글자 없는 목록은 세 자리부터 믿는다, 글자가 맞는 목록이 글자 없는 목록보다 먼저다, **글자 붙은 씬 목록이 이름에 따로 있으면 글자 없는 조각은 이 씬의 목록으로 읽지 않는다**(같은 파일은 어느 씬에서 연결해도 같은 목록이어야 한다), 받아들이지 않은 `~` 바로 뒤의 목록은 버린다.
- **이름이 다른 씬들을 가리키면(`namesOtherScenes` — 다른 파트의 목록처럼 글자가 다른 목록) 레이아웃 묶음까지 묻지 않는다**(글자는 맞고 자기 번호만 빠진 목록은 여기에 들지 않는다 — 이름에 적힌 씬들을 권한다).
- 번호 견주기는 `normalizeSceneIdKey`를 가족 글자로 부른다(`sceneRefKey`).
- 대상은 연결한 씬의 `Part` 하나(같은 화·파트·부서)이고 필터를 거치지 않은 `useDataStore.episodes`에서 찾는다.
- 상태를 매기기 전에 후보의 링크를 반드시 읽는다(링크는 보이는 씬 것만 읽혀 있다).
- 누르는 순간과 되돌리는 순간에 그 씬들의 링크를 한 번 다시 읽고(`reloadLinks`) 칸을 다시 본다(`planBulkLink`·`planBulkUndo`). **다시 읽기를 마치지 못하면(실패·1.5초 넘김) 한꺼번에 연결도 되돌리기도 쓰지 않는다 — 낡았을지 모르는 값으로 쓰지 않는다. 되돌리기는 읽지 못했거나 일부가 실패하면 못 되돌린 것을 들고 '되돌리기'를 다시 건다**(바뀐 씬의 예전 경로는 그 동작만 들고 있다 — 빨간 알림으로 끝내면 잃는다). 연결한 씬 자신의 칸이 그 사이 달라졌으면 아무것도 쓰지 않는다.
- 누르는 순간 지금의 씬 자료로 묶음을 다시 찾아(`findBulkLinkScope`) 번호·레이아웃이 바뀐 씬에는 쓰지 않는다.
- 되돌리기는 경로가 그대로이고 **마지막으로 고친 사람도 자기일 때만** 그 칸을 자기가 쓴 것으로 본다(`updatedBy`).
- 쓰기가 모두 돌아오면 그 씬들을 한 번 읽어 저장소를 서버와 맞춘다(`refreshLinks` — 기다리지 않는다. 저장소는 고치지 않았다).
- 창은 Enter로 연결하지 않는다(여러 씬의 파일이 한 번의 Enter로 바뀌지 않게 — 버튼만), 창 안에서는 `title`·말줄임을 쓰지 않는다(맨 위 층의 창에서는 풍선이 보이지 않는다), 창의 키 입력·붙여넣기는 창에서 멈춘다(대상이 창 밖 `body`인 것 — 체크 칸·버튼에서의 붙여넣기, Tab이 마지막 버튼을 지나 포커스가 한 번 `body`에 놓인 동안의 키 — 은 `window` 캡처 단계의 `stopPasteAtWindow`·`stopOutsideKeyAtWindow`가 멈추고, 창이 닫힐 때 뗀다), 다른 파일이 걸린 줄의 표시는 그 줄의 체크를 따르고("→ 이 파일로 바뀜" / "체크하면 이 파일로 바뀜") 바뀌는 파일의 수는 버튼 위에 늘 보인다.
- 다른 모달이 떠 있으면 제안은 물러난다.
- 작업 링크 칸의 `savePath`는 저장이 도는 중에 다시 불리면 아무것도 하지 않는다(붙여넣기 칸의 겹친 Enter가 헛확인 창을 띄워 제안을 버리게 하지 않도록).
- 바꿀 수 있는 값: `SCENE_NAME_RULES`, `BULK_LINK_DEFAULTS`(테스트는 `rules`·`defaults` 인자로 값을 뒤집어 본다. 부르는 코드는 넘기지 않는다).
- main은 링크 행 변화를 `createTrailingDebounce`로 모아 표 다시 읽기와 감지기 초기화를 한 번만 한다. 렌더러로 가는 행 신호는 모으지 않는다.
- 새 창(`WidgetPopup`)은 `scene_work_links` 신호에 자료를 다시 받지 않는다(작업 링크는 새 창에 보이지 않는다 — 새 창이 링크를 보여 주게 되면 그 줄을 저장소 반영으로 바꾼다).
- 개발용 `?preview=feedback-hub` 뿌리에는 창의 호스트가 없다(거기서는 묻지 않는 것이 맞다).
- 씬 작업 링크 테스트는 `npm run test:scene-links`.

### 리테이크 알림·바로가기 경계 (v1.116.0)

- `bflow://retake/<revisionId>`는 공용 파서 → renderer 리스너 준비 확인 → 로그인/데이터 연결 대기 → ID로 최신 리테이크 단건 조회를 거쳐 소속 세트와 해당 항목을 연다. 창 로딩 중에는 main이 링크를 보관하며 조회 실패를 삭제된 항목으로 처리하지 않는다. 전체 리테이크 목록도 DB 행 제한에 잘리지 않도록 페이지 단위로 끝까지 조회한다.
- 재알림은 `retakeNotificationService`가 main의 현재 사용자·세션과 정규화한 DB 리테이크로 권한·미완료 담당자를 확인한다. 기존 Slack workflow 변수를 사용하며 전송 실패는 저장 성공을 되돌리지 않는다.
- 리테이크 화면과 세트 허브의 씬 상세는 `RetakeSceneModalProvider` 안에 연다. 상세의 BG/ACT 선택과 닫기는 허브의 화면·필터를 바꾸지 않는다.
- 내 리테이크 위젯은 공용 담당 상태 명령을 사용한다. 로그인 시 미완료 배정 조회로 알림을 보강하지만 오프라인 중 개별 재알림 방송 이력은 별도 DB에 저장하지 않는다.

### 캐릭터 댓글 배지 (v1.116.0)

- 배지는 댓글 본문 대신 캐릭터별 댓글 수·다른 사람이 마지막으로 작성한 시각을 일괄 조회한다. main의 현재 사용자·세션을 기준으로 집계하고 DB 행 제한을 넘는 댓글은 페이지 단위로 읽는다.
- 읽음 상태 변경은 댓글 재조회와 분리한다. 캐릭터가 특정된 댓글 변경은 해당 요약만 갱신하고, 전체 변경 신호는 표시 중인 캐릭터를 묶어서 갱신한다.

### 배플레이그라운드 v3 데이터 경계

- **시세**: `shared/playgroundMarketModel.mjs`의 결정론 모델이 장 전체·업종·종목·이벤트 입력으로 로컬 계산한다. 실제 시장 API나 별도 시세 DB를 사용하지 않는다.

- **화면과 체결**: renderer preview는 같은 공용 모델로 시세와 주문 확인값을 보여 주고, Electron의 `MarketAccountService`가 체결 직전 canonical 가격·거래정지·revision을 다시 검증한다.
- **계좌**: 실제 앱의 예수금·보유 종목·거래 결과는 Supabase가 정본이다. 테스트 모드는 로컬 preview gateway로 같은 명령·rollback 계약을 지킨다.
- **긴 차트**: 완료된 과거 봉만 제한된 cache에 재사용하고 점진 계산한다. 현재 진행 봉은 실제 시간으로 다시 계산하며 오래된 비동기 요청은 중단한다.
- **아케이드 포인트**: 지갑·출석·게임 기록·도전과제는 Supabase가 정본이며, 모든 포인트 변경은 원장과 같은 트랜잭션의 RPC(`playground_arcade_read`/`playground_arcade_execute`)를 거친다. renderer는 IPC → main `ArcadeService`만 경유하고, 밸런스 수치는 `src/features/playground/arcade/constants.ts`가 정본이다(SQL·계약 테스트로 동기화). 우상단 포인트 배지·출석/업무 적립·게임별 순위표가 여기에 연결된다.
- **아케이드 게임**: 스네이크·테트리스 엔진은 부작용 없는 순수 모듈이다. 난수는 `crypto` 시드 → 결정론 PRNG로만 만들고 `Math.random()`/`Date.now()`를 엔진에 쓰지 않는다(리플레이·테스트 재현성). 게임 시작/종료는 `request_id` 멱등이라 재시도·중복 제출에도 입장료 중복 차감·이중 지급이 없다. 신기록 슬랙은 전체 최고 기록 경신 + 관리 토글 on + 주소 설정 시에만 발송된다.

### 배경 라이브러리 데이터 경계 (v1.130.0 시험 공개)

- **노출 범위**: 메뉴와 화면은 `canAccessBackgroundLibrary`(배플레이그라운드와 같은 계정 판정)를 통과한 계정에만 보인다. 사이드바 필터와 `resolveAllowedView`가 같은 함수를 쓰며 `tests/backgroundAccess.test.ts`가 둘 다 고정한다. 새 진입 경로(단축키·검색·새 창·딥링크)를 더할 때도 이 함수를 거치게 한다. 서버와 메인 프로세스는 계정을 가리지 않으므로 이 장치는 화면 노출용이다.
- `src/features/backgrounds`는 장소·도면·배경/변형/수정본·시점 묶음·에피소드 사용을 분리한다. 도면 노드 삭제는 원본 자산과 사용 기록을 지우지 않는다.
- 도면 노드는 공간·카메라·`symbol`(문/사물 기호)로 구분한다. 기호는 배경 시점 ID를 갖지 않으며 같은 도면의 공간에만 연결한다. 공간 변형에 소속 기호도 따라가되 잠금은 보존하고 공간 삭제 시 연결만 해제한다. 기호 종류·치수·경첩/열림 방향은 공용 domain과 SQL에서 함께 검증한다. 닫힌 목록(기호 종류, 공간의 `surface`, 카메라의 `color`)은 `domain.ts`의 `BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS` 한 곳이고 `DEVLOG/migrations/2026-10-09-background-map-elements.sql`의 IN 목록과 같아야 한다(테스트가 견준다).
- preload epoch → `backgroundIpc.ts` → `backgroundStore.ts` → `background_library_read/execute`로 저장한다. DB는 `app_session_user_id`로 사용자를 확정하고 관리자는 자산 편집, 로그인 사용자는 에피소드 연결을 편집한다.
- 엔티티별 revision CAS, requestId 멱등, 삭제 ID 재사용 차단을 유지한다. 화면은 낙관 반영 후 실패 복구하며 session generation과 refresh ticket으로 오래된 응답을 배제한다.
- 도면 생성·연결·위치 변경은 관리자 전용 `save-maps` 원자적 명령을 사용한다. 1~100개 도면의 CAS를 모두 확인한 뒤 최종 참조/순환을 검사한다. 다른 부모로 옮길 때 이전 공간의 입구 연결도 같은 명령에서 해제하며, 응답 유실은 전체 제출 내용과 정확한 다음 revision이 일치할 때만 완료로 복구한다.
- `background-library` Realtime 채널은 데이터 없는 변경 신호만 전달한다. Preview는 같은 domain과 Web Locks/localStorage를 사용한다. 운영에 샘플을 자동 주입하지 않는다.
- 평면/3D 공동 도면: 도면 노드의 x/y/width/height/rotation/angle은 평면 값 그대로이며 `height`는 평면 세로 길이다. 수직 축은 선택 필드(공간 `elevation`·`volumeHeight`, 카메라 `elevation`·`pitch`·`roll`·`aspect`, 기호 `elevation`·`volumeHeight`·`pitch`·`roll`)로만 더한다. 없는 값은 `mapSpatial.ts`가 읽을 때 기본값으로 풀이하며, 보기·전환만으로는 쓰지 않고 사용자가 바꾼 값만 저장한다. 범위는 `domain.ts`의 `BACKGROUND_SPATIAL_LIMITS`와 `DEVLOG/migrations/2026-10-07-background-map-3d.sql`이 같아야 하며, 적용 순서는 `2026-09-21-background-library.sql` → `2026-10-07-background-map-3d.sql` → `2026-10-09-background-map-elements.sql`이다. 셋 다 같은 검증 함수(`background_library_validate_entity`)를 더 넓은 것으로 바꿔 넣으므로, **앞의 파일을 다시 실행하면 그 뒤의 파일을 모두 순서대로 다시 실행한다.** 앞 파일만 다시 돌리면 좁은 검증 함수가 돌아와, 저장된 도면에 뒤 파일의 값(세로 값, 계단·도로·카메라 색)이 하나라도 있는 동안 **그 도면을 남겨 두는 쓰기가 모두** 22023으로 막힌다(사실상 모든 편집이다. 읽기는 되고 잃는 것은 없다). 그 도면을 지우거나 그 값을 빼고 저장하는 쓰기는 지나가지만 **그렇게 풀지 않는다**(지운 도면은 되살릴 수 없다) — 사슬을 다시 적용한다. 그런 도면이 아직 없을 때는 눈에 보이는 것이 없고 새 값을 실은 저장만 막힌다. 적용된 파일은 머리말 주석만 고치고 `BEGIN;` 아래는 고치지 않는다. 평면 SVG·3D 화면·보조 평면도는 `mapDocument.ts`의 초안 하나를 읽고(별도 3D 저장소 없음), 한 번의 드래그는 되돌리기 한 단계다. 새 카메라는 `addMapCamera`의 고정 생성점에만 만든다. three.js는 3D 모드에서만 지연 로드한다.
- 평면 편집 보조(v1.131.0): 확대·맞춤은 보기 값만 바꾼다. `mapSnap.ts`·`mapPlanGesture.ts`는 three.js·DOM 없는 순수 모듈이고 스냅은 진행 중인 제스처 안에서 (시작 도면, 포인터)의 순수 함수로만 계산한다(끝난 뒤 고쳐 쓰지 않는다). 붙은 축은 대상 값 그대로, 붙지 않은 축만 정수로 둔다. 옮기기·크기 바꾸기는 **가까이 있는 것**(다른 축으로 화면 `MAP_SNAP.reachPx` 안)의 선에만 붙는다 — 선을 끝없이 늘이면 도면의 모든 것이 후보가 되어 늘 붙어 있게 된다. 다각형 점이 붙는 곳은 옆 점의 가로·세로와 다른 공간의 모서리 둘뿐이다(다른 노드의 선·테두리 선을 넣지 않는다). 다각형 점 편집은 `replaceMapNode`로 그 노드만 바꾸고 `transformMapSpace`를 거치지 않는다. 안내선·이름 칸·고른 점은 화면 상태이고 스냅 켜기/끄기만 기기별(`bflow.background-map.snap.v1`)로 기억한다. 늘 깔린 눈금은 만들지 않는다. 평면의 더블클릭은 SVG 한 곳에서, 누를 때 적어 둔 기록으로 판정한다(편집 중의 누름은 포인터를 캡처하므로 `click`·`dblclick`이 노드 요소에 닿지 않는다 — 노드 `<g>`에 `onDoubleClick`을 달지 않는다). 캔버스가 받지 않은 누름은 그 기록을 비운다(창 단위 `pointerdown` 캡처). 끌기에 쓴 Alt의 키 이벤트는 뗄 때까지 창 메뉴로 보내지 않는다(포인터가 눌려 있는지가 아니라 그 Alt가 끌기에 쓰였는지로 판정한다). 크기 바꾸기·점 끌기는 손잡이의 기준점에 움직인 만큼을 더한다(누른 자리를 쓰지 않는다).
- 선택과 겹친 공간(v1.132.0): 선택 묶음은 문서의 도면별 보기 값에 날것으로 두고(`selectedIds`, 대표는 마지막) 읽을 때 `mapSelection`이 사라진 노드를 거른다(리듀서는 되돌리기·초안 버리기에서 선택을 건드리지 않는다). 선택 액션은 `select`·`select-many` 둘뿐이고 둘 다 바꿔 넣기다: 날것 목록에 더하거나 빼는 액션은 만들지 않는다(사라진 노드가 묶음에 끼어든다. Shift+클릭은 편집기가 살아 있는 선택에서 새 목록을 만든다). 평면 ↔ 3D 전환은 선택을 바꾸지 않고, 3D·보조 평면도는 하나만 받는다(`mapCanvas.ts` 계약 불변). 그 하나는 `selectedId`를 `singleViewId`로 읽은 것이다: 선택이 하나 이하면 그 선택, 여러 개면 처음에는 대표이고 3D에서 고른 것으로 따로 움직인다. **3D 모드에서 하는 고르기는 묶음(`selectedIds`)을 바꾸지 않는다**: 편집기의 `select` 한 곳이 `pickAction`으로 액션을 정해, 3D 모드에서 여러 개가 선택돼 있으면 `pick-one`(`selectedId`만)을, 그 밖에는 `select`를 보낸다. 3D·보조 평면도가 알려 주는 id는 눌린 노드가 아니라 넘기기를 거친 결과라서(겹친 카메라의 다음 것, 아래 바닥) "대표를 눌렀는가, 묶음 안인가"로 가르지 않는다. 3D 모드에 `select(…)`를 부르는 길을 더할 때는 그 편집기 함수를 지나게 한다(`doc.select`를 직접 부르지 않는다). 묶음 동작(함께 옮기기·지우기·잠그기)과 묶음을 푸는 일은 평면에서만 한다. 편집기의 `selected`는 "하나를 다루는 도구가 붙는 노드"이며 평면의 여러 개 선택에서는 비어 있다. '선택' 도구의 누름은 `resolvePlanPress`(순수)가 정하고 편집기는 실행만 한다. 상자는 화면 상태이고 문서 제스처가 아니다(되돌리기 단계 없음). Shift를 누른 채 그린 상자도 선택을 바꿔 넣는다. 공간은 **벽**이 상자에 닿아야 잡힌다(상자가 공간 안쪽에만 있으면 그 공간은 잡히지 않는다 — 넓이로 재면 가구를 고르는 상자가 방과 건물 외곽을 늘 함께 잡는다). 묶음 이동은 제스처 한 번이고 `moveMapNodes`가 공간마다 `transformMapSpace`를 한 번 불러 소속 항목을 한 번만 싣는다. 잠긴 것은 옮기지도 지우지도 않는다(`moveMapNodes`·`removeMapNodes` 안의 규칙). 겹친 공간의 순서는 `mapStack.ts` 한 곳(작은 넓이가 위, 같으면 배열 순서)이며 평면 그리기·같은 자리를 다시 누를 때 넘어가는 목록(`planPileAt`)·보조 평면도·3D `pickMapFloor`·새 기호의 소속이 모두 읽는다. 배열(`nodes`)은 다시 정렬하지 않는다. **처음 누르는 자리에서는 늘 맨 위(가장 작은) 공간이 잡힌다. 아래 공간이 대상이 되는 것은 같은 자리를 다시 누를 때뿐이다**(`again`: 평면은 `lastSpot`+`sameSpotAgain`, 3D와 보조 평면도는 각자의 `turn`). 공간의 더미는 그 점을 품은 공간 전부라서, 이 조건을 빼면 큰 공간이 선택된 동안 안쪽 방의 누름·끌기·더블클릭이 모두 큰 공간에 작용한다. 평면의 자리 기억은 그 누름이 눌린 노드를 고르거나 옮겼을 때만 남는다: 끌려서 화면 이동(보기 모드)이나 상자가 된 누름은 남기지 않는다(남기면 골라 둔 바깥 공간이 그 방의 대상이 된다). 카메라·기호의 더미는 v1.131.0의 규칙 그대로다. **자리 기억은 세 화면에서 같은 때에 끝난다**: 고르는 누름이 아닌 캔버스 누름(화면만 옮기는 누름, 왼쪽 주 버튼이 아닌 누름, 취소된 끌기)과 캔버스 밖의 누름 뒤에는 그 자리를 다시 눌러도 처음 누름이다. 3D는 `onPointerDown`·`onPointerUp`·취소 줄과 창 캡처 `pointerdown`(`onPressElsewhere`)이, 보조 평면도는 창 캡처 `pointerdown`(`forget`)과 창 캡처 `pointerup`·`pointercancel`(`release` — 보조 평면도 위에서 누른 뒤 밖에서 떼거나 취소되어 클릭이 되지 못한 누름)이 `turn`을 지운다. 끝까지 간 기즈모 끌기만 평면의 옮기기처럼 기억을 남긴다. 3D나 보조 평면도에 누름을 받는 길을 더할 때는 설계(`docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md`) 7.3 끝의 표에 맞춘다. **공간의 더미는 연속 클릭(클릭 횟수 2 이상)에 넘어가지 않는다 — 그 더블클릭이 할 일이 있든 없든.** 넘기는 것은 새 클릭 묶음을 시작하는 클릭뿐이다(평면: SVG `click`의 `cycle.spaces`, 3D: `resolveMapClick`의 `repeat`, 보조 평면도: `nextPlanSelection`의 `repeat`). "할 일이 없으면 넘긴다"로 되돌리면 보기 모드·잠긴 방·3D에서 방을 더블클릭할 때마다 선택이 아래 공간으로 바뀐다. 카메라·기호의 더미만 "연속 클릭이고 그 더블클릭이 무언가를 할 때" 건너뛴다(`doubleClickIntent` 하나를 그 넘기기와 더블클릭이 함께 쓴다. 첫 누름의 대상에 할 일이 없으면 맨 위 것의 일을 한다). 더블클릭으로 들어간 공간은 선택된 채 남는다(`openSpace`). 3D는 `mousedown`의 `detail`로, 보조 평면도는 `click`의 `detail`로 연속 클릭을 안다(`pick`·`doubleClickNode`, `activate`). 화면 이동은 휠 버튼·'화면 이동' 도구·스페이스다. 스페이스는 **추적과 삼키기가 따로다**: 창 캡처로, 평면 모드이고 편집기가 화면에 보이면 포커스가 어디에 있든(편집기 밖의 버튼, 체크 칸 포함) 누르고 있음을 적는다 — 스페이스가 글자이거나 열린 창의 것일 때(`spaceEntry`: 글자 칸·`select`·`contenteditable`·`dialog`. 체크 칸은 아니다)만 뺀다. 기본 동작은 편집기 안의 빈 곳과 `body`에서만 막는다(버튼·체크 칸·접기 줄과 편집기 밖의 것은 건드리지 않는다). 추적 조건에 포커스 자리를 넣으면 밖의 버튼이나 잠금 체크 칸을 누른 직후 스페이스+끌기가 방을 옮긴다. 보기 모드에서는 어디를 끌어도 화면이 움직이고 선택은 움직이지 않고 뗄 때 바뀐다. Esc는 선택을 풀지 않는다. 새 카메라의 소속 규칙("정확히 하나")은 그대로다.
- 새 도면 요소(v1.133.0): 저장 모양의 추가는 셋이다(기호 종류 `stairs`, 공간의 선택 키 `surface: 'road'`, 카메라의 선택 키 `color`). 닫힌 목록은 `domain.ts`의 상수 셋 한 곳이고 요소 파일(`DEVLOG/migrations/2026-10-09-background-map-elements.sql`)의 IN 목록과 같아야 한다. 두 키는 없으면 지금의 동작이고, 기본으로 되돌릴 때는 **키를 지운다**(`null`·`undefined` 금지). 이미 있는 노드의 키를 바꾸는(쓰고 지우는) 곳은 `setSpaceSurface`·`setCameraColor` 둘뿐이고(새 도로의 `surface`만은 `newSpace`가 넣어 만든다) `patchNode`로 쓰지 않는다(합치기만 해서 지울 수 없다). 서버는 검증만 한다. 저장 모양을 넓힐 때는 적용된 SQL 파일을 고치지 않고 사슬 끝에 새 파일을 더하며, DB를 먼저 적용하고 앱을 배포한다. **넓히는 migration을 운영에 적용한 뒤 그 앱 버전의 배포가 끝날 때까지는 운영에 새 모양을 저장하지 않는다**(개발 빌드로도, 검증하면서도 저장하지 않는다. 첫 저장은 배포된 버전에서, 그 화면을 여는 PC를 모두 올린 뒤에 한다) — 서버는 앱 버전을 모르므로 적용한 순간부터 새 모양을 받고, 그 사이에 하나라도 저장되면 그것을 모르는 PC가 모두 배경 화면 대신 업데이트 안내를 띄우는데 올릴 버전이 아직 없다. **저장 모양은 새 선택 키 또는 닫힌 목록의 새 문자열로만 넓힌다** — 기존 키의 숫자 범위·값 타입·개수 한계를 넓히면 이전 버전에는 업데이트 안내가 아니라 오류로 보인다(읽기 장치는 모르는 키와 목록 밖 문자열만 알아본다). **읽은 자료에 이 버전이 모르는 키나 닫힌 목록 밖의 문자열이 있으면 `BackgroundUnsupportedError`** 이고 화면은 오류 대신 업데이트 안내를 띄워 보기·편집·저장을 막는다(무엇을 몰랐는지는 오류의 `detail`에 실려 콘솔에 남는다. 문장과 화면에는 넣지 않는다). 타입이 틀리거나 범위 밖이면 지금처럼 오류다. 어느 쪽이든 통째로 거절하며, **모르는 값을 지우고 읽지 않는다**(통째 저장이 그것을 지운다). 닫힌 목록을 보는 새 검사는 `known`을 쓴다. 도로는 공간이다: `isRoadSpace` 하나로 읽고, 쌓임 순서의 맨 앞 항(도로가 모든 방 아래)으로 방과 갈린다. 쌓임 순서를 읽는 곳은 여섯이다(평면 그리기, `planPileAt`, 보조 평면도, `pickMapFloor`, `mapFloorPile`, `placeSymbol`). 3D에서 쌓임 순서가 닿지 않는 경우(방의 벽을 맞혔을 때, 바닥 높이가 다를 때)는 `pickMapNode`의 맨 앞 걸음이 맡는다 — **같은 광선에 맞은 방과 평면에서 겹친 도로**의 바닥 맞춤만 빼고(`roadsUnderRooms`), 남은 것에 지금의 규칙을 쓴다. 겹치는지는 `mapStack.ts`의 `spacesOverlap` 한 곳이 정한다: 넓이를 나눠 가져야 겹친 것이고, 변이나 모서리만 맞닿은 것은 아니다(승인 문구가 "건물과 **겹치면**"이다 — 겹치지 않는 건물 옆의 도로는 지금의 방처럼 벽 너머로도 한 번에 잡힌다. 겹침 검사를 빼면 길가 건물이 길을 가로막는다). 그래서 건물 **밑의** 도로는 그 건물의 벽 너머에서 처음 누를 때 건물에 지고, 같은 자리를 천천히 다시 눌러 내려간다: 다시 누를 때의 더미는 `mapSpacePile`(바닥 더미 앞에 벽으로 잡힌 방) 한 곳이며 `mapClickStep`과 손잡이 위의 클릭(`BackgroundMap3D.tsx`의 `pick`)이 **둘 다** 그것을 부른다 — 한쪽이라도 `mapFloorPile`을 직접 부르면 그 도로에 닿지 못한다. `pickMapFloor`·`mapFloorPile`에는 도로 규칙을 넣지 않는다(기호를 놓는 자리, 바닥끼리의 순서). 큰 방 안에 통째로 든 도로는 몸통을 바로 누를 수 없다(천천히 다시 누르기·Shift+상자·목록과 손잡이 — 도로의 속성 칸 안내 `ROAD_HINT`가 그 길을 말한다) — 쌓임 규칙의 결과이니 '고치지' 않는다. 벽이 없어 세로 크기는 `spaceWallHeight`(도로 0)로 읽는다 — `nodeVolumeHeight`는 저장된 값이며 도로인 동안 쓰지 않는다. 새 카메라의 소속은 방이 먼저이고 방이 없을 때만 도로다. 가운데 점선은 `roadCentreLine` 한 곳(사각형과, 띠 규칙 넷을 지나는 다각형)이며 평면·보조 평면도·3D가 함께 읽는다. 점의 수가 짝수인 것만으로 그리지 않는다(한쪽 옆줄에만 점이 많으면 선이 가장자리로 빠진다). 점선이 없는 도로에는 속성 칸이 까닭을 말한다. 평면에서 도로의 이름에는 글자 테두리가 있고 그 굵기는 글자처럼 `--bmap-label-scale`을 곱한다(가운데 점선이 이름을 지난다. 고정값이면 축소한 도면에서 테두리가 사라진다). 카메라 색은 이름으로 저장하고 값은 화면이 정한다: 3D는 `mapCameraColor.ts`, DOM은 `backgrounds-map.css`의 `--bmap-cam`(숫자 셋). 두 벌은 테스트가 견준다. 색이 없는 카메라의 모습은 바꾸지 않는다. 저장되는 색 이름은 **칸의 이름**이다 — 칸의 색과 화면 이름은 migration 없이 고칠 수 있고, 운영 DB의 여섯 이름은 다시 건드리지 않는다. 속성 칸의 동그라미는 여섯 개(승인된 수)이고 호박색으로 돌아가는 길은 동그라미가 아닌 '기본 색으로' 글자 버튼이다. 동그라미의 포커스 고리는 눌림 고리 바깥에 그린다. 기호 목록의 대체값은 자리 아닌 이름(`custom`)으로 찾는다. 기호 그림의 선은 모든 종류가 그림 단위다(계단에만 화면 굵기를 주지 않는다). 미리보기 저장소 키(`bflow-background-library-preview-v1`)는 그대로다: v1.133.0의 미리보기가 새 모양을 저장한 주소에서 그 이전 코드를 미리보기로 띄우면 라이브러리 전체를 거절한다(3D 값 때와 같은 정책) — 이전 코드와 견줄 때는 다른 포트를 쓴다. 띠 규칙·3D의 누름·승인 문구의 풀이는 설계(`docs/superpowers/specs/2026-10-09-background-map-new-elements-design.md`) 7.4·7.6·1.1에 있다.
- 새 설치는 위의 세 파일을 그 순서로 적용한다. 이미지 미리보기는 기존 `scene-images`의 `backgrounds/` 경로를 사용하고 원본 파일/장소 폴더는 별도 경로로 보존한다.
- 파일 연결은 변형의 선택적 `workFilePath`와 수정본의 선택적 `sourceImagePath`로 구분한다. 기존 수정본 `filePath`는 작업파일 호환용이며 명시적인 빈 경로를 구형 값으로 되살리지 않는다. 이미지 갱신은 새 수정본을 추가하고 연결 해제는 원본·미리보기를 삭제하지 않는다.
- `background:read-image-file`은 읽기 전후 세션/admin을 확인하고 로컬·공유 경로 PNG/JPG/WebP를 20MB 이내로 제한한다. main의 nativeImage로 검증·1600px 이내 축소하며 투명도를 보존한다. renderer에서 100개 수정본 제한을 읽기/업로드 전에 확인하고 domain/SQL에서도 검증한다.

---

## 경로

| 구분 | 경로 |
|------|------|
| 개발 | `C:\Bflow-BGonly` |
| 배포 | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\` |
| 개인 설정 | `%APPDATA%\Bflow-BGonly\` (layout.json, preferences.json) |

**데이터**: 씬/에피소드/체크박스/메모/개인일정 → Supabase, 위젯 레이아웃/개인 설정 → %APPDATA% 로컬 파일

### 제약 사항

- **한글 경로 인코딩**: 배포 경로에 한글 포함 → Node.js `path` 모듈 사용, 경로 하드코딩 금지
- **동시 편집 충돌**: Last-Write-Wins 전략 (Google Sheets 기본 동작). 폴링 주기로 충돌 창 최소화

---

## 기술 스택

Electron + React 18 + TypeScript + Tailwind CSS + Zustand + react-grid-layout + Lightweight Charts 5.2.0 + googleapis

### 디자인 토큰

```
배경: #0F1117 | 카드: #1A1D27 | 보더: #2D3041
텍스트: #E8E8EE | 텍스트 약: #8B8DA3 | 액센트: #6C5CE7

단계: LO=#74B9FF  완료=#A29BFE  검수=#FDCB6E  PNG=#00B894
```

---

## 위젯 목록

| 위젯 ID | 이름 | 설명 |
|---------|------|------|
| overall-progress | 전체 진행률 | 원형 멀티컬러 진행률 |
| stage-bars | 단계별 진행률 | LO/완료/검수/PNG 바 차트 |
| assignee-cards | 담당자별 현황 | 담당자 카드 목록 |
| episode-summary | 에피소드 요약 | EP별 × 파트별 현황 |
| dept-comparison | 부서별 비교 | BG vs 액팅 비교 (통합 모드) |

---

## 워크플로우 규칙

1. **플랜 우선**: 비자명한 작업(3단계+)은 플랜 모드 진입. 틀어지면 STOP 후 재계획.
2. **서브에이전트 활용**: 리서치/탐색/병렬 분석은 서브에이전트에 위임. 메인 컨텍스트 깨끗하게 유지.
3. **자기개선**: 수정 받으면 `tasks/lessons.md`에 패턴 기록. 동일 실수 반복 방지.
4. **완료 전 검증**: 작동 증명 없이 완료 표시 금지. tsc + 빌드 + 동작 확인.
5. **자율 버그 수정**: 버그 리포트 받으면 지시 없이 바로 수정. 로그/오류 직접 추적.
6. **단순함 우선**: 최소한의 코드 영향. 과잉 설계 금지. 근본 원인 해결.
7. **프리뷰 로그인 필수**: 로컬 preview/mockup/브라우저 검증에서 로그인 화면이 보이면 이름 `배한솔`, 비밀번호 `1234`로 반드시 로그인한 뒤 화면을 확인한다. 로그인 전 화면만 보고 검증 완료로 판단하지 말 것. 이 값은 preview 확인용 테스트 데이터로만 사용한다.

---

## 자동 업데이트 원칙

- 팀원은 로컬 PC에 설치된 BFLOW 본체를 실행한다. G드라이브는 배포 파일을 받아오는 창고 역할만 한다.
- 앱 시작 시 스플래시에서 업데이트 상태를 안내하고, 최신 버전 준비는 최대 10초까지만 기다린다. 준비 완료 시 installer helper가 로컬 `BFLOW-Setup.exe`를 실행해 최신 버전으로 갱신하고, 10초 초과/실패 시 현재 버전으로 먼저 연다.
- 앱 사용 중에는 5분 주기로 manifest를 다시 확인해 새 버전을 백그라운드로 받아두고, 토스트 + 좌하단 버전 버튼 + 업데이트 모달로 계속 표시한다. 모달에는 현재 버전과 최신 버전을 명확히 강조한다.
- 실제 적용은 `지금 업데이트` 클릭 시 즉시 수행하거나, 일반 종료 후 다음 앱 실행의 startup gate에서 자동 수행된다. 앱 폴더를 직접 rename/copy하지 말 것. 토스트가 떴다는 것만으로 성공 판단 금지. 다음 실행 버전과 `%LOCALAPPDATA%\Bflow-BGonly\swap.log`의 `[installer-main]`/`[installer]` 로그를 확인한다.
- installer helper는 현재 BFLOW 프로세스가 완전히 종료된 뒤 `BFLOW-Setup.exe /S`를 실행해야 한다. 앱이 살아있는 동안 installer를 시작하면 Windows 파일 잠금으로 실패할 수 있다.
- 앱 시작 자동 적용은 `.installer-attempted` 시작 확인 마커가 생긴 뒤에만 종료해야 한다. helper 시작 확인 없이 앱을 닫으면 사용자가 바로가기를 눌러도 앱이 계속 안 뜨는 루프가 생긴다.
- 좌하단 버전 버튼은 업데이트 유무와 무관하게 항상 업데이트 내역 모달을 열어야 한다. 모달은 열자마자 자동 확인하지 않고, 사용자가 `새로고침`을 눌렀을 때만 `update:check-now`로 배포 상태를 다시 확인한다. 새로고침 중에는 기존 표시 내용을 유지해 중간 상태 때문에 레이아웃이 흔들리지 않게 한다.
- 업데이트 내역 모달은 최신 몇 개 내역을 기본 표시하고, 과거 release note는 사용자가 펼쳐 볼 수 있어야 한다. `DEVLOG/update-notes.json` 항목을 누락하지 말 것.
- 배포용 `manifest.json`은 `BFLOW-Setup.exe`가 있을 때만 생성한다. `--allow-missing-installer`는 개발용 `build:vite`에서만 사용한다.
- 설치/적용 중에는 사용자가 상황을 알 수 있어야 한다. renderer는 `applying` 상태를 표시하고, 앱 종료 후 helper는 별도 진행 창을 띄운다.
- PowerShell helper를 TypeScript 백틱 문자열 안에 넣을 때 PowerShell 변수는 `$($name)` 형태로 쓴다. `${name}`은 JavaScript 보간으로 실행되어 helper 시작 전 `ReferenceError`를 만들 수 있다.

---

## Git 규칙

- **커밋 메시지**: 한글로 작성, 변경 내용 명확히 설명
- **Bflow 원본 레포**: **절대 수정 금지** (참고 전용)

---

## 참조 문서

- **`CONTEXT.md`** — 세션 컨텍스트 가이드 (아키텍처, 파일 맵, 알려진 이슈, 스킬 활용법)
- **`ROADMAP.md`** — 전체 개발 로드맵 (Phase 0~7, 기능별 상세 스펙)
- **`DEVLOG/AUTO_UPDATE_OPERATIONS.md`** — 자동 업데이트 운영 기준 (최신 배포 방식의 1차 기준)
- **`DEVLOG/auto-update-test-scenario.md`** — 자동 업데이트 E2E 테스트 체크리스트
- `tasks/lessons.md` — 과거 실수/패턴 기록 (세션 시작 시 검토)
- `BG_DASHBOARD_PLAN.md` — 초기 구현 계획서
- Bflow 원본 (`/home/user/Bflow`) — 패턴 참고만 (읽기 전용, 수정 금지)

---

## 문서 갱신 규칙

1. **ROADMAP.md**: 항목 착수/완료 시 상태 갱신
2. **AGENTS.md**: 아키텍처 변경 시 업데이트
3. **package.json**: 기능 추가 → 마이너 버전, 버그 수정 → 패치 버전

---

*문서 버전: 2026-07-13*
*작성: Codex × 한솔 (Studio JBBJ)*
