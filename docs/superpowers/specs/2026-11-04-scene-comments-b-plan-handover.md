# 씬 댓글 B안 — 구현 인수인계서 (2026-11-04)

> 작성: Claude(Fable) × 한솔. 실행: Opus(또는 다른 Claude 세션).
> 이 문서 하나로 추론 없이 구현을 시작할 수 있게 썼다. 모르는 것이 나오면 추측하지 말고 §12 '결정 대기'에 적고 한솔에게 묻는다.

## 0. 한 줄 요약

씬 댓글 패널을 **Slack 모델(본문 = 원댓글 + 리테이크 카드, 답글은 스레드 창에서만)** 로 바꾸고, **알림 수신자 판정·슬랙 조립을 함수 하나로** 모으고, 댓글이 **서버를 불필요하게 깨우는 네 군데**를 끊는다. 데이터 모델은 바꾸지 않는다(마이그레이션 없음). PR 6개로 나눠 순서대로 진행하며, 각 PR 은 코덱스 리뷰 OK 뒤 **머지까지 진행한다**(한솔 2026-11-04 지시 — "PR 머지까지 진행해줘"). **G드라이브 배포는 한솔이 따로 말할 때만** 한다.

## 1. 왜 하는가 (점검 결론, 2026-11-04)

점검 보고서(아티팩트 "B flow 댓글 점검", 사본 `docs/superpowers/mockups/2026-11-04-scene-comments-review.html`)에서 검증된 것만 옮긴다.

- **UI**: 답글 진입점이 둘(말풍선 옆 호버 아이콘 + 항상 보이는 '답글' 알약), 같은 답글이 본문 들여쓰기 블록과 오른쪽 '스레드' 창에 **동시에** 그려짐, 스레드 창 메시지에도 '답글' 버튼이 있어 "답글의 답글"처럼 보이지만 저장은 항상 루트 아래(`buildCommentReplyTarget`). 내 글만 오른쪽·보라, 날짜 구분·아바타 없음, 글자 9~12px. 리테이크 댓글은 `revision_id` 평면이라 접히지 않고 최상위 말풍선으로 나열됨.
- **알림**: "누가 받나"를 서버가 아니라 **받는 PC** 가 정한다. 그 판정이 `src/App.tsx` 두 블록(realtime 1769~, broadcast 2747~) + 리테이크용 `dispatchRevisionCommentNotification`(593~)에 복제돼 있고, 슬랙 조립은 `CommentPanel.notifyCommentMentions`(1661~)와 `RevisionCommentThread.send`(372~)에 복제돼 있다. 답글 상대를 `mentions` 배열에 넣어 알림을 만들기 때문에 **답글마다 슬랙이 한 통씩** 가고 제목이 '태그했습니다'로 뜬다. 캐릭터 댓글 멘션은 어디로도 안 간다. 설정 '내 씬 댓글 알림' 토글이 멘션·리테이크까지 끈다. 50개 캡 단순 절단, 로그인마다 담당 리테이크 ≤50 재주입, 멘션 lastSeen 미갱신, 죽은 설정 3개(소리·동기화 완료·표시 시간), 댓글 수정으로 넣은 @는 알림 없음, 리테이크 스레드 @는 type 'revision'이라 종 안 울림.
- **서버 비용**: 댓글 수정·삭제 1건 = 모든 PC '전부 다시 받기'(`broadcastDataChange('comments')` 를 받는 쪽이 안 거름), 컴포지팅 대시보드 `useCommentCount.ts` 60초 폴링, 리테이크 허브는 댓글 1건마다 모든 시트 재조회, `loadPartComments` 진행 중 요청 합치기 없음, `invalidatePartCache()` 가 파트 구분 없이 전체를 비움.
- **코드**: `CommentPanel.tsx` 4,148줄 중 입력 카드 '답글 모드'(`replyTarget`) 약 150줄과 `CommentLightboxPortal` 130줄은 켜질 수 없는 죽은 코드. 테스트 4개가 npm 스크립트에 미등록. 미리보기 mock 은 댓글 저장 뒤 `comment-added` 방송을 안 내보내 알림 수신 경로가 미리보기에서 한 번도 돌지 않음.

## 2. 한솔이 결정한 것

1. **B안** 채택. A(인라인 유지)·C(해결됨 워크플로)는 하지 않는다.
2. 시안의 **왼쪽 세로 막대(안 읽음·멘션 강조 바, 패널 가장자리 발광) 전부 제거**. "AI 티 나는" 요소 금지 — 알약·칩 남발, 그림자 카드, 보라 막대 금지. 사람이 만든 것처럼 차분하게.
3. **라이트 모드 자연스럽게**. 토큰만 쓰고 하드코딩 색 금지. 라이트에서 멘션·링크는 accent 원색이 아니라 한 단계 어두운 보라(`accent` 토큰이 라이트 프리셋에서 어떻게 정의되는지 확인해 그대로 따른다 — 없으면 `color-mix(in srgb, rgb(var(--color-accent)) 80%, black)` 수준).
4. 시안은 **실제 앱 기준**(씬 상세 모달 안, 리테이크 포함). 시안 파일: `docs/superpowers/mockups/2026-11-04-scene-comments-b-plan.html` (브라우저로 열면 장면 탭·호버·클릭이 동작한다). 치수·토큰 표가 파일 끝에 있다.
5. PR 은 코덱스 리뷰 OK 뒤 머지까지. 배포는 별도 지시.

## 3. 범위

### 한다
- B안 화면(§5), 알림 함수 통일 + 작은 알림 버그(§6), 서버 비용 4곳(§7), 죽은 코드·테스트·미리보기 mock(§8), 알림 센터 씬 묶음 + 캡 정책(§9), 설정 재편(§6.4).

### 하지 않는다 (기록만)
- 댓글 '해결됨' 상태(C안), 슬랙 → B flow 양방향, 멘션을 이름 → user id 로 바꾸는 마이그레이션, `comment_notifications` 서버 테이블(메인 프로세스 알림 서비스) — **선택 단계 §10 에 설계만 남김**, 댓글 테이블 세션 래퍼 전환(CLAUDE.md 7 — 현황 메모만).
- `comments` 스키마 변경 없음. 리테이크 루트 카드는 `revision_id` 묶음을 **화면에서** 접는 것이다.

## 4. 코드 지도 (읽는 순서)

| 영역 | 파일 | 비고 |
|---|---|---|
| 패널 본체 | `src/components/scenes/CommentPanel.tsx` (4,148줄) | 렌더 2613~3967, 목록 mergeFeed 4121~, 답글 묶음 3063~3258, 스레드 창 3553~3917, 입력 카드 3287~3550 |
| 패널 틀·폭 | `src/components/scenes/CommentPanelResizable.tsx`, `src/utils/commentPanelResize.ts`, `src/hooks/useCommentPanelWidth.ts` | `key={sceneKey}` 로 씬마다 리마운트(288) |
| 스레드 규칙 | `src/utils/commentThreading.ts` | `buildCommentReplyTarget`(답글의 답글 → 루트), `orderCommentsForThreadedMainFlow`(리테이크 묶음 인접) |
| 리테이크 카드 안 스레드 | `src/components/scenes/RevisionCommentThread.tsx` (697줄) | 슬랙 복제본 372~390, 요청자 자동 멘션 없음 |
| 읽음 상태 | `src/services/commentReadStateService.ts`, 스레드 키 `src/utils/commentThreadKey.ts` | 씬 단위 `EP05:A:a001` |
| 팀 할 일 | `src/components/scenes/ThreadTodoSection.tsx`, `electron/threadTodoIpc.ts` | 세션 래퍼, 건드리지 않음 |
| 데이터 서비스 | `src/services/commentService.ts` (634줄) | `loadPartComments` 137~167(BG+ACT 합침), `invalidatePartCache` 283~292, `extractMentions` 583~ |
| 메인 저장 | `electron/supabase.ts` `addComment` 1791~, `editComment` 1873~, `deleteComment` 1894~, `fetchMissedMentions` 1524~ | `broadcastDataChange('comments', …)` 1887·2010 |
| 방송 | `electron/broadcast.ts` 391~417(`comment-added` 페이로드) | commentId·parentCommentId·partId·revisionId 포함 |
| 수신·알림 판정 | `src/App.tsx` 580~592(3초 dedupe), 593~672(리테이크 댓글), 1131~1217(멘션 catch-up), 1769~1931(realtime comments), 2747~2876(broadcast comment-added), 2878~2908(data-change) | 두 블록이 거의 복제 |
| 수신자 규칙 | `src/utils/sceneNotificationRecipients.ts` | 담당자·상대 부서·스레드 참여자(캐시 의존) |
| 슬랙 | `src/services/slackWebhookService.ts` `sendMentionWebhook`, `electron/main.ts` 3346~3370, `electron/slackWorkflowTransport.ts`, `electron/retakeNotificationService.ts` | 워크플로 변수 comment/EP/time/scene/name_my/name_target/part/deep_link |
| 알림 스토어·센터 | `src/stores/useNotificationStore.ts`(MAX 50), `src/components/NotificationPanel.tsx`, `src/utils/notificationGrouping.ts`, `notificationArrival.ts`, `lastSeenTracker.ts` | |
| 설정 | `src/components/settings/NotificationSection.tsx` | 7토글 중 3개 죽음 |
| 서버 비용 | `src/views/compositing-dashboard/useCommentCount.ts`(60초 폴링), `src/views/CompositingView.tsx` 434~487(허브 재조회), `src/views/ScenesView.tsx` 3286~3340(시트 배지) | |
| 미리보기 mock | `src/mocks/devElectronAPI.ts` `supabaseAddComment` 3036~, 반응 no-op 3080~, `src/mocks/devPreviewComments.ts` | |
| 스타일 | `src/styles/comment-panel.css`, 토큰 `src/index.css` | 글자 토큰·모션 규칙은 CLAUDE.md |

## 5. 화면 스펙 (B안)

시안 파일의 장면 탭 이름을 그대로 쓴다: **기본 / 스레드 열림 / 리테이크 스레드 / /re 빠른 리테이크 / 안 읽음 필터 / 댓글 없음**. 아래가 시안과 다르면 시안이 맞다.

### 5.1 패널 구조 (위 → 아래)
1. 헤더: `댓글` + `원댓글 N · 리테이크 M` + 우측 종 아이콘(알림 설정 팝오버 — 팔로우/끄기 상태, §6.4).
2. 필터 탭(밑줄 탭, 알약 아님): `전체 · 안 읽음 N · 리테이크 N · @나 N`. 숫자는 흐린 글자. 기존 '활동 감추기'·'re만' 버튼은 제거(활동은 §5.5 로 흡수).
3. 팀 할 일(기존 `ThreadTodoSection` 그대로, 스타일만 새 토큰).
4. 목록(§5.2~5.5).
5. 입력 카드(§5.6).
6. 스레드 창(§5.7) — 열렸을 때만 오른쪽.

### 5.2 목록 한 행 (원댓글)
- 격자: 아바타 30px(radius 9, 이니셜 = 이름 뒤 두 글자, 사용자별 고정 색 — `RevisionCommentThread.tsx` 86~94 `avatarColor` 를 공용 `src/utils/userAvatarColor.ts` 로 올려 재사용) + 본문 열.
- 머리 줄: 이름 13px/700 · 시각 11px(`formatCommentTime` 그대로: 오늘 '오후 2:30', 지난날 '5월 2일 오후 2:30') · 안 읽음이면 시각 뒤 6px accent 점. **왼쪽 막대 없음, 말풍선 없음, 내 글도 왼쪽.**
- 본문 13.5px/1.55. 멘션 칩은 글자색만(배경 없음), #태그는 기존 EntityText 색 유지.
- 이미지: 기존 그리드(1장 1열, 2장+ 2열) 유지, 최대 높이 112px.
- 반응 줄: 기존 `ReactionChip` 유지(칩 12px). 점선 '＋' 버튼은 행 호버 때만 .8 투명.
- 답글 요약 줄(답글이 1개 이상일 때만): `[참여자 아바타 최대 3] 답글 N개 · 마지막 HH:MM · (새 N)` 버튼. 누르면 스레드 창. **인라인 답글 블록(3063~3258)은 삭제.**
- 호버 툴바(행 우상단 -12px/right 10px, card 배경 + border + 그림자 0 6px 18px/.28, 120ms): `✅ 👍 👀 · 😊(이모지 창) · ↩ 답글 · ⋯`. `focus-within` 에도 표시(키보드). 기존 말풍선 옆 absolute 아이콘(2993~3026)과 상시 '답글' 알약(`ThreadReplyButton`)은 **삭제**.
- ⋯ 메뉴: `팀 할 일로 보내기 · 댓글 링크 복사 · 내용 복사 · ─ · (내 글) 수정 · 삭제 / (남의 글) 이 스레드 알림 끄기`. 수정·삭제 동작은 기존 핸들러 재사용. '팀 할 일로 보내기'는 `threadTodoAdd(threadKey, stripEntityTokens(text).slice(0, 200))`.
- 연속 댓글 묶음: 같은 사람 **5분 이내** 연속이면 아바타·머리 줄 생략, 아바타 자리에 호버 시 `HH:MM`(10px). 리테이크 댓글도 같은 규칙(지금은 리테이크면 묶지 않는 2843 분기 제거).
- 날짜 구분선: 날짜가 바뀌는 지점에 `─ 11월 3일 월요일 ─` / `─ 오늘 ─`(11px, 가는 선). 같은 날 시각은 `formatCommentTime` 이 이미 시간만 보여 준다.
- '새 댓글' 선: 기존 `UnreadCommentsDivider` 위치 규칙 유지, 모양만 가는 선 + 작은 글자(알약 아님).
- '수정됨' 은 italic 금지 → `(수정됨)` 11px 보조색.

### 5.3 리테이크 루트 카드
- `revision_id` 가 같은 댓글·활동 묶음을 **카드 하나**로 접는다. 위치는 첫 활동(등록) 시각. 카드 배경 `--comment-card-elev-rgb`, border, radius 12. 그림자 없음.
- 내용: `re#N` · 상태 칩(대기 회색 / 진행중 `--status-combine` / 담당 완료 노랑 / 해결됨 `--status-done`) · `요청 {이름} · 시각` / 설명 1~2줄 / `담당 {이름}`(내가 담당이면 '나(이름)') · `활동 N건` / 요약 줄 `댓글 N개 · 마지막 HH:MM` 버튼(스레드 창) · 우측 `상세`(상세 모달 리테이크 탭 열기 — 기존 `RevisionCommentBadge onJump` 경로).
- 메인 목록에는 리테이크 댓글 말풍선·활동 카드를 더 이상 그리지 않는다(`isRetakeThreadFollowup`, `.comment-retake-thread-followup`, `.comment-inline-event-*` 카드 제거). 일반 시스템 활동(단계 변경 등)은 §5.5.

### 5.4 스레드 창 (오른쪽 348px, 260~560 리사이즈 유지)
- 헤더: 제목(`스레드` / `리테이크 re#N`) + 부제(`{작성자} · a001` / `EP05 · A파트 · a001 · 요청 {이름}`) + **팔로우 토글**(§6.4) + 닫기. **Esc 로 닫힘.**
- 일반 스레드: `원댓글` 작은 라벨 → 원댓글 행(같은 행 컴포넌트, 툴바에서 '답글' 대신 `@이름`) → 구분선 `답글 N개` → 답글 행들.
- 리테이크 스레드: 카드(§5.3 와 같은 카드 + 동작 버튼) → 구분선 `활동 N건 · 댓글 N개` → 활동 행과 댓글 행을 시간순 한 줄기로. 활동 행은 `● {이름} 님이 리테이크를 등록했어요 / 작업을 시작했어요 / 담당 작업을 끝냈어요 / 해결로 표시했어요` 11.5px, 색은 상태 토큰.
- 리테이크 동작 버튼(카드 아래): 내가 담당이고 진행중 → `담당 완료`(primary). 담당 완료 상태이고 내가 요청자 → `해결`(primary) + `다시 진행`. 해결됨 → `다시 열기`. 모두 기존 `revisionService` 의 담당 상태·resolve 명령을 그대로 호출한다(새 API 금지). 권한이 없으면 버튼을 그리지 않는다.
- **스레드 안 행에는 '답글' 버튼이 없다.** 사람 지목은 툴바 `@이름` → 입력창에 `@이름 ` 삽입(사용자가 지울 수 있는 글자. 보이지 않는 자동 멘션 없음).
- 입력창: `답글 남기기…` / `리테이크에 댓글…`. 본문 입력 카드와 같은 모양(§5.6). 저장은 기존 `handleThreadSubmit`: 일반은 `parentCommentId = 루트 id`, 리테이크는 `revisionId` 만(변경 없음).
- `RevisionCommentThread.tsx`(리테이크 탭 카드 안 스레드)는 **이 스레드 창과 같은 행·입력 컴포넌트**를 쓰도록 바꾼다(가장 쉬운 길: 카드 안에는 요약 줄 + '스레드 열기' 버튼만 두고 댓글 패널의 스레드 창을 연다. 패널이 없는 화면(피드백 허브·컴포지팅)에서는 기존 인라인 목록을 유지하되 행 컴포넌트만 공용으로).

### 5.5 시스템 활동 (단계 변경 등)
- 한 줄 `● {내용}  HH:MM` 11.5px 보조색. 리테이크 등록/진행/해결은 메인 목록에서 **카드 안으로 흡수**되므로 여기 나오지 않는다. '활동 감추기' 토글은 제거하고 활동은 항상 보인다(가볍기 때문).

### 5.6 입력 카드
- 배경 `--comment-card-elev-rgb`, border, radius 12, 포커스 시 border 를 보조색으로(보라 링 없음).
- placeholder `{씬번호}에 댓글 남기기`. 하단 툴바: `📎 이미지 · @ 멘션(드롭다운 열기) · 😊 · /re 리테이크` 왼쪽, `Enter 보내기 · Shift+Enter 줄바꿈` 힌트 + 보내기(↑, 비어 있으면 비활성) 오른쪽.
- `/re` 빠른 리테이크 카드는 **기존 기능 그대로**(알림 받을 사람·담당자 칩, 선택 필요 표시, 이미지 1장 제한). 모양만 새 토큰.
- 죽은 '답글 모드' 헤더·보라 테두리·`replyTarget` 상태는 삭제(§8).

### 5.7 빈 상태·로딩·실패
- 빈: `아직 댓글이 없어요` / `첫 댓글을 남겨 보세요. @로 사람을 부르고, /re 로 리테이크를 등록할 수 있어요.` 용어는 '댓글' 하나로('의견' 금지).
- 로딩 스켈레톤·실패 '다시 불러오기'·보내기 실패 '다시 보내기 · 지우기'·삭제 5초 되돌리기 — 기존 동작 유지, 말풍선 모양만 행 모양으로.

### 5.8 접근성·움직임
- 호버 툴바·⋯ 메뉴·반응 추가 버튼은 `focus-within` 으로도 열림. 아이콘 버튼 전부 `aria-label`. 이미지 `alt="{이름}의 첨부 이미지 N"`.
- 움직임은 transform/opacity 120~180ms, '움직임: 최소'·OS 동작 줄이기면 전환 없음(CLAUDE.md 움직임 규칙). 새 댓글 떠오름(`bubbleRise`)은 유지.

## 6. 알림 규칙 (최종)

### 6.1 누가 받나 — 함수 하나
`src/utils/sceneCommentNotification.ts`(신규)에 **순수 함수** `decideSceneCommentNotification(input)` 하나를 두고, `App.tsx` 의 realtime 블록·broadcast 블록·`dispatchRevisionCommentNotification`·catch-up 복원이 모두 이 함수를 쓴다. 입력은 정규화된 댓글(`commentId, partId, sceneNo, sceneUuid?, userId, userName, text, mentions, parentCommentId, revisionId, characterId`) + `me` + 조회 함수(`findScene, isCommentByUser, hasUserCommentedOnScene, getRevision`). 출력은 `{ type, reason, title, body, metadata } | null`.

| 대상 | reason | 앱 알림 type | 토스트·종 | 슬랙 |
|---|---|---|---|---|
| 본문에 `@이름` 으로 직접 부른 사람 | `mention` | `mention` | 강함(종 흔들림, 안 읽은 멘션 수) | **보냄** |
| 답글의 루트 작성자(내가 쓴 댓글에 답글) | `reply` | `mention`(제목 '…님이 내 댓글에 답글을 남겼습니다') | 강함 | **보내지 않음**(한솔 결정 대기 §12-1, 기본값은 안 보냄) |
| 리테이크 댓글의 요청자·담당자·notifyUserIds | `retake` | `mention`(제목 '…님이 re#N 에 댓글을 남겼습니다', metadata.revisionId) | 강함 | 요청자에게만 보냄(두 입력칸 동일) |
| 씬 BG/ACT 담당자, 상대 부서 담당자, 스레드 참여자 | `auto` | `comment` | 조용함(토스트·소리 없음, 배지만) | 안 보냄 |
| 캐릭터 댓글의 직접 멘션 | `mention` | `mention`(metadata.characterId → 캐릭터 상세로 이동) | 강함 | 보냄 |
| 작성자 본인 | — | 없음 | | |

- **자동 멘션을 `mentions` 배열에 넣지 않는다.** 답글 상대는 `parent_comment_id`, 리테이크 요청자는 `revision.requesterId` 로 판정한다(`CommentPanel.tsx` 1831~1837·2228~2240 의 push 제거, 입력창 `@이름 ` 프리픽스도 제거 — 사용자가 직접 치는 것만 멘션).
- 리테이크 댓글 멘션도 `type: 'mention'` 으로 보내고 `notificationArrival.ts` 의 '나를 부른 알림' 과 `countUnreadMentions` 에 포함한다.
- 댓글 **수정**으로 새로 들어간 `@이름` 은 알림을 보낸다: 수정 저장 시 `이전 mentions 에 없던 이름` 만 골라 같은 경로로(슬랙 포함). 수신 측은 `editComment` 방송(§7.1 의 `comment-updated`)의 `addedMentions` 로 `mention` 알림을 만든다.
- dedupe: 3초 창 대신 `commentId(+reason)` 기반 집합(세션 동안, 상한 500)으로. 스토어가 identity 로 병합했으면 토스트·OS 알림을 띄우지 않는다(`dispatchNotification` 이 '새로 추가됨/병합됨' 을 받아 분기).
- 알림 본문은 `stripEntityTokens(text)` 뒤 60자. 제목 형식 통일 `'{이름} · EP05 a001'`.

### 6.2 슬랙 — 함수 하나
`src/services/slackWebhookService.ts` 에 `buildMentionWebhookPayloads({ comment, sceneKey, users, me, kind })` 순수 함수 + `notifyMentionsForComment(...)` 하나. `CommentPanel`·`RevisionCommentThread`(또는 공용 send 훅)가 이것만 호출한다. 변수 형식은 리테이크 서비스와 맞춘다: `EP` = `EP05`, `part` = `A`, `time` = `Intl ko-KR Asia/Seoul`, `name_my` = `slackId || 이름`(작성자 슬랙 ID 가 없어도 대상에게는 보낸다). 결과 `{ sent, missing, failed }` 를 돌려 받아 말풍선 아래 작은 상태(`슬랙 전달됨 · 1명은 슬랙 ID 없음` / `슬랙 전송 실패 · 다시 보내기`)를 보인다. 실패를 `console.error` 로 삼키지 않는다. 이미지만 있는 댓글은 `comment` 변수에 `(이미지 N장)`.
- 멘션 드롭다운(`useMentionAutocomplete`)에 슬랙 연결 안 된 사람은 흐리게 + '슬랙 없음' 표시.

### 6.3 복구(catch-up)·커서
- 실시간 멘션 수신 때도 `setLastSeenAt(me.id, createdAt)` 호출(다른 세 종류와 같게) → '놓친 알림 N개' 거짓 토스트 제거.
- `fetchMissedMentions` 는 `(created_at, id)` 복합 커서 + 필요한 컬럼만 select. 서버 필터가 어려우면 그대로 두되 select 컬럼 축소는 한다.
- 리테이크 담당 catch-up(`useRetakeNotifications` 32~49)은 알림 목록에 넣지 않고 **알림 창 상단 고정 한 줄 `담당 리테이크 N건 · 허브 열기`** 로 바꾼다(지워도 부활하는 문제 해소).

### 6.4 설정·팔로우
- `NotificationSection.tsx` 를 4토글로: `나를 부른 알림`(멘션·답글·배정·피드백 — 항상 켜짐, 스위치 비활성 표시) / `내 씬 자동 알림`(담당 씬 댓글·단계 변경, 기본 켜짐, 조용함) / `리테이크 알림`(등록·진행·해결) / `반응 알림`(기본 꺼짐). `Windows 알림`·`토스트 위치` 유지. **`알림 소리`·`동기화 완료 알림`·`표시 시간` 제거**(settingsService 타입과 저장값도 정리, 기존 저장값은 무시). 각 가드(`commentNotify` 사용처 App.tsx 610·1816·1984·2418·2801)를 새 키로 교체.
- 스레드 팔로우/끄기: `%APPDATA%` preferences 의 `commentThreadFollow: Record<threadKey, 'follow'|'mute'>`(PC 로컬, 서버 없음). `mute` 면 `auto` 알림 제외(직접 멘션은 유지). `follow` 면 그 스레드 새 댓글을 `comment`(강함 아님, 토스트 있음)으로. 스레드 키 = `{sceneThreadKey}#{rootCommentId | re:revisionId}`.

## 7. 서버 비용 (먼저 한다)

1. **수정·삭제 전부 다시 받기 끊기**: `electron/supabase.ts` `editComment`(1887)·`deleteComment`(2010)의 `broadcastDataChange('comments', …)` 를 `broadcast.ts` 의 새 이벤트 `comment-updated` / `comment-deleted`(`{ commentId, partId, sceneId, characterId, addedMentions?, text?, images? }`)로 바꾼다. `App.tsx` 2878~2908·`WidgetPopup.tsx` 762~779 의 data-change 분기에 `table === 'comments'` → 무시(또는 해당 파트만 무효화)를 추가해 혹시 남은 신호도 전체 재조회를 부르지 않게 한다. `commentService` 는 두 이벤트를 받아 캐시의 해당 댓글만 바꾼다(재조회 없음). 댓글 삭제 이벤트로 그 댓글의 알림(identity `scene_comment:{id}`)도 지운다.
2. **파트 지정 무효화**: `App.tsx` 1803·1929·2794·2873 의 `invalidatePartCache()` 를 `invalidatePartCache(sheetName)`(partId → sheetName 은 `useDataStore` 에서)으로. `CommentPanel` 1182 리스너·`CompositingView` 483·`ScenesView` 3286·`characterCommentSummaryService` 193 은 `event.detail.sheetName` 이 자기 표시 시트가 아니면 무시. `comment-added` 방송에는 댓글 전체가 있으니 패널은 캐시에 **끼워 넣고** 재조회하지 않는다(`absorbNew` 경로 재사용).
3. **60초 폴링 제거**: `useCommentCount.ts` 의 `setInterval(refresh, DONE_STALE_MS)` 와 `visibilitychange` 재조회를 없애고, `commentService` 의 `sheetPartCache` 를 같이 쓰며 `bflow:comments-invalidated(sheetName)` 에만 반응한다. 별도 캐시 삭제.
4. **진행 중 요청 합치기**: `commentService.loadPartComments` 에 `inFlight: Map<sheetName, Promise>`; `ScenesView` 'all' 모드의 bg/act 두 시트 호출은 한 번으로(이미 두 파트를 함께 읽음).
5. 리테이크 댓글 알림 판정에서 `loadRevisions()` 전량 조회 대신 dedupe 먼저 + 단건 조회(`App.tsx` 612~617).

판정 기준(배포 전 한 번 측정): 미리보기에서 댓글 1건 추가·수정·삭제 때 IPC 호출 수를 `window.electronAPI` 래퍼에 카운터를 걸어 세고, 각각 `읽기 ≤ 1`(추가: 끼워 넣기라 0), `전부 다시 받기 0` 임을 기록에 남긴다.

## 8. 정리 (죽은 코드·테스트·미리보기)

- 삭제: `replyTarget` 상태와 파생(708·847·862·947·1768·1890 의 null 호출, 1262~1287 effect, 1347 effect, handleSubmit 1783~1853 답글 분기, 입력 카드 3395 테두리·3410~3440 헤더, `replyDraftTarget` 739, `isReplyToReply` 1827), `CommentLightboxPortal` 3969~4100 + `createPortal`·Chevron import, `pickerAnchorRef`, `inputValueRef`, `renderText` 의 `_sourceKey`, `notificationHelper.ts` 106~116 `sendSlackNotification` 껍데기, Sheets 폴백(`commentService` 68~100·159~, `main.ts` 4059 `sheets:read-comments`)은 **사용 로그가 없는 것을 확인한 뒤** 제거(확인 못 하면 남기고 §12 에 적는다).
- 훅 추출(렌더는 그대로): `useImageAttachments`(본문/스레드 2벌 → 1벌), `useCommentSend`(begin/finish/fail/retry/discard/afterDelivered + 슬랙 호출), `useUndoDelete`, `useThreadComposer`. 각 훅은 DOM 없는 입력→출력으로 `node --test` 가능하게.
- 테스트: `tests/commentThreading.test.ts`, `commentThreadKey.test.ts`, `devPreviewComments.test.ts`, `useCommentPanelWidth.test.ts` 를 `test:entity` 에 등록. `tests/` 의 모든 `*.test.ts` 가 어느 스크립트에든 들어 있는지 확인하는 메타 테스트 1개 추가. 새 순수 함수(`decideSceneCommentNotification`, `buildMentionWebhookPayloads`, 그룹핑 5분 규칙, 리테이크 묶음 → 카드 변환) 에 동작 테스트. **소스 정규식 wiring 테스트는 UI 개편으로 다수 깨진다** — 동작을 말하는 것은 순수 함수 테스트로 옮기고, 문구·클래스 확인은 바뀐 파일만 한 번에 갱신한다(새 wiring 테스트를 늘리지 않는다).
- 미리보기 mock: `devElectronAPI.supabaseAddComment` 끝에서 실제 `broadcastCommentAdded` 와 같은 페이로드로 `emitMockSupabaseBroadcast({event:'comment-added', payload})` + 같은 주소 다른 탭에 BroadcastChannel(팀 할 일 패턴). 반응 3종 no-op 을 localStorage 배열로 구현. `supabaseFetchMissedMentions` 가 시드 중 `me.name` 멘션을 돌려주게. 이게 있어야 알림 수신 회귀를 미리보기에서 본다.

## 9. 알림 센터

- `notificationGrouping.ts`: `comment`/`mention`/`comment_reaction` 도 `thread:{sheet}:{sceneId}` 키로 묶는다. 묶음 한 장 = `EP05 · a001 · 새 댓글 N · 멘션 M` + 최근 세 줄 미리보기 + 동작 `댓글 열기 · 읽음 · 이 씬 알림 끄기`. 리테이크는 `revision:{id}` 한 장이 상태 바뀔 때 갱신(새 줄 추가 X). 반응은 `👍 반응 · 박정인 외 1명` 한 장, 조용함.
- 안 읽음 표시는 배경 톤 + 점. **왼쪽 막대 없음.**
- 캡: 50을 넘길 때 읽은 것 → `scene_change` → 오래된 `comment` 순으로 버리고 안 읽은 `mention`/`scene_assignment`/`acting_feedback` 은 보존. `scene_change` 는 같은 사람 5분 버킷으로 합침(`scene_change:{changedBy}:{bucket}`).
- '모두 읽음'·'전체 삭제' 는 종류별 id 를 모아 배치 1회(`markAllCommentReactionsRead` 등 기존 배치 API 사용).
- 멘션 Windows 알림 클릭 시 해당 댓글로 이동(`notification:show-native` 에 sceneJump 전달).

## 10. (선택, 별도 결정) 메인 프로세스 댓글 알림 서비스

지금은 하지 않는다. 할 때의 모양만: `electron/commentNotificationService.ts` 가 `addComment` 직후 수신자(멘션 id·답글 부모·담당자·상대 부서·참여자·리테이크 요청자)를 DB 조회로 계산 → `comment_notifications(recipient_id, comment_id, reason, read_at)` INSERT → 방송 → 슬랙 → `{inApp, slack}` 결과 반환. 렌더러는 '내 행이 왔다' 만 그림. 세션 토큰 래퍼(CLAUDE.md 7·10)와 함께. 마이그레이션 1장. 이걸 하면 §6.1 함수는 '내 행인가' 로 줄고 catch-up 2,000행 스캔이 사라진다.

## 11. PR 분할·순서·버전

버전은 **머지 직전 `origin/main` 의 `package.json` 을 다시 확인**해 정한다(2026-11-04 현재 main 1.144.0, PR #343 이 1.144.1 로 열려 있음 → 첫 PR 은 1.145.0 부터, #343 이 먼저 머지되면 그대로 1.145.0). `package.json`·`package-lock.json` 두 곳 모두. 각 PR 에 `DEVLOG/update-notes.json` 항목(비개발자 톤, CLAUDE.md 규칙) 추가.

| 순서 | PR | 내용 | 버전 | 크기 |
|---|---|---|---|---|
| 1 | 서버 비용 | §7 전부 | 1.145.0 | 하루 |
| 2 | 알림 함수 통일 | §6.1~6.4(팔로우 제외), 설정 재편 | 1.146.0 | 하루~이틀 |
| 3 | 정리 | §8 죽은 코드·훅 추출·테스트 등록·미리보기 mock | 1.146.1 | 하루 |
| 4 | B안 화면 | §5 전부(패널·스레드 창·리테이크 카드·입력 카드·RevisionCommentThread 통일), 라이트 모드 | 1.147.0 | 이틀~사흘, 커밋 여러 개 |
| 5 | 알림 센터 | §9 + 팔로우/끄기(§6.4) | 1.148.0 | 하루~이틀 |
| 6 | (선택) 메인 알림 서비스 | §10 — 한솔이 따로 "진행" 이라 할 때만 | — | — |

각 PR 공통 체크:
1. `npm run typecheck` → 관련 `test:*` → `npm run build:vite` 통과(로그로 확인, EXIT 코드만 믿지 않는다 — 메모리 '동시 세션 빌드 사고').
2. 화면을 바꿨으면 `npm run preview:electron` 으로 앱 엔진(Electron 33/Chromium 130)에서 확인. **한솔 PC 사용 중에는 보이는 창을 띄우지 않는다**(offscreen 하니스, 메모리 '보이는 창 띄우지 않기'). 라이트/다크 둘 다, 패널 폭 320·600·스레드 열림, 댓글 없음·로딩·실패·보내기 실패 상태.
3. PR 본문: `pr-creator` 스킬 형식(업데이트 요약은 비개발자 톤 / 상세 기술 / 난항 / 테스트 가이드). 시안 파일 경로와 이 문서 §번호를 적는다.
4. `codex-review-loop` 스킬로 코덱스 리뷰를 돌리고 P1/P2 를 반영한다. 코덱스가 명시적으로 OK 하면 **머지**(merge commit, squash 아님 — 기존 이력과 같게). 한도 초과로 코덱스가 못 돌면 로컬 5축 리뷰(정확성·데이터 안전·접근성·움직임·전송량)로 대체하고 PR 에 그렇게 적는다.
5. 머지 뒤 다음 PR 은 최신 main 에서 새 브랜치. **배포(`npm run build` + G드라이브)는 하지 않는다** — 한솔이 "배포" 라고 할 때 `bflow-release-deploy` 스킬로.

## 12. 결정 대기 (한솔에게 물을 것 — 기본값으로 먼저 진행)

1. 답글(내 댓글에 달린 답글)에 **슬랙**을 보낼지. 기본값: 보내지 않음(앱 알림만). 보내려면 §6.1 표의 `reply` 행만 바꾸면 된다.
2. 팔로우/끄기를 PC 로컬(기본값)로 둘지 서버에 저장할지.
3. Sheets 폴백 코드 제거 여부(사용 로그 확인 뒤).
4. 리테이크 탭 카드 안 스레드(`RevisionCommentThread`)를 '요약 + 스레드 열기' 로 줄일지(기본값), 인라인 목록을 유지할지.

## 13. 함정 (이 레포에서 실제로 걸린 것)

- `font-style: italic` 금지(메모·댓글 전부). `text-[9px]`·`9.5px` 같은 반픽셀 크기 금지, 글자 최소 10px.
- 움직임: transform/opacity 만, 반복 요소에 backdrop-filter 금지, `[data-motion-lite]`/`[data-motion-minimal]` 존재 속성만, 전역 전환은 `:where()`.
- 레이아웃 폭: 패널 폭 계산(`useCommentPanelWidth`)은 '본 최대 댓글 수' 로만 커진다 — 스레드 열림 +348 로 숫자만 바꾼다.
- 미리보기 mock 과 앱의 동등성: mock 에 같은 길을 처음부터(캘린더 새 창 때 코덱스 4건). `widgetOpenPopup` 등은 건드리지 않는다.
- 1000행 캡: 새 조회를 만들면 `(created_at, id)` 커서 + 명시 컬럼. `.in()` 은 100개씩.
- `users` 조회는 명시 컬럼(`select *` 금지).
- 커밋 메시지 한글. 브랜치는 `claude/…`. 워크트리에서 작업하면 `node_modules` 는 의존성이 같은 다른 워크트리로 junction(메인 체크아웃 node_modules 는 비어 있음), 지울 때 `cmd /c rmdir`.
- heredoc 에 역슬래시 넣지 않는다(Write/Edit 도구로).
- 두 세션이 같은 `dist` 에서 동시에 빌드하지 않는다.

## 14. 완료 정의

- 씬 상세에서 댓글 패널이 시안 '기본' 장면과 같은 구조로 보이고, 라이트/다크 모두 하드코딩 색 없이 자연스럽다.
- 답글은 스레드 창에서만 보이고 쓸 수 있다. 스레드 창·인라인 어디에도 '답글의 답글' 버튼이 없다.
- 리테이크는 카드 하나로 접히고, 스레드 창에서 담당 완료·해결이 된다. 리테이크 탭 카드 안에서 쓴 댓글과 패널에서 쓴 댓글이 같은 스레드에 보이고 같은 알림 규칙을 탄다.
- 댓글 추가·수정·삭제 때 다른 PC 가 씬·메타 전체를 다시 받지 않는다(측정 기록 첨부). 컴포지팅 대시보드에 주기 폴링이 없다.
- 멘션·답글·리테이크 댓글 알림이 함수 하나에서 나오고, 그 함수에 단위 테스트가 있다. 답글마다 슬랙이 가지 않는다(§12-1 기본값). 설정 토글 4개가 실제 동작과 일치한다.
- `CommentPanel.tsx` 에 죽은 답글 모드·라이트박스 포털이 없다. 미등록 테스트 0개. 미리보기에서 댓글을 쓰면 다른 탭에 알림이 뜬다.
- PR 1~5 가 코덱스 OK 뒤 main 에 머지돼 있고, 배포는 하지 않은 상태로 한솔에게 보고.
