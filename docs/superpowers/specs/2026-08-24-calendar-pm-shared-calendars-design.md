# B flow 캘린더 개편 — 팀/멤버 공유 캘린더 (PM 일정관리) 설계서

> 작성: 2026-08-24 · 승인: 한솔 (UI 시안 + 기술 설계 모두 "이대로 진행")
> 근거 조사: `docs/superpowers/research/2026-08-24-calendar-current-structure.md` (현재 구조 분석, 파일:줄 근거)
> 시안: https://claude.ai/code/artifact/f20a13b0-9d43-4af4-8ed5-b5c6dabd9126 (페이지 1 = 접근안 비교, 페이지 2 = A안 세부 화면 6장)
> 시안 원본: `docs/superpowers/specs/mockups/2026-08-24-calendar/` (M1~M6 .dc.html — 브라우저로 열면 렌더됨)

---

## 1. 배경과 목표

현재 "캘린더" 탭(코드명 `schedule`, `src/views/ScheduleView.tsx`)의 일반 일정은 **각자 자기 Google Calendar(primary)** 에 저장되고 자기 것만 읽는다. 팀이 같은 일정을 보는 장치가 앱 안에 없고, Google 미연동 팀원은 빈 달력을 본다(로드 전체가 `isAuthenticated` 가드 뒤: `ScheduleView.tsx:1253-1256` 등).

**목표**: Google 계정 연동 없이도 보이는, B flow 자체(팀 전체 또는 특정 팀원에게만 보이는) 캘린더들을 만들고·관리하고·공유하는 기능. PM(일정 관리자)의 주 용도는 ① 프로덕션 마일스톤(업로드일·가편·대본 등) ② 시간 단위 회의 ③ 소그룹 공유 일정.

### 확정 결정 (한솔, 2026-08-24)

| # | 결정 | 내용 |
|---|---|---|
| D1 | 용도 | 마일스톤 + 시간 단위 회의 + 소그룹 공유. **팀원별 작업 배정(담당자 개념)은 범위 제외** |
| D2 | 권한 | 소유자 + 사람별 보기/편집 지정(구글 공유 방식). **팀 전체 캘린더는 admin 만 생성** |
| D3 | 구글 | 같은 화면의 "내 구글" 레이어로 공존. 구글 일정 생성·편집 경로 유지 |
| D4 | 범위 | 공유 캘린더 본체 + **죽은 코드·중복 정리**. 타임라인 탭·휴가 모듈·대시보드 위젯 UI는 손대지 않음 |
| D5 | v1 알림 | **앱 내 알림(종)만**. 반복 일정·슬랙 알림·D-3 강조는 2차 |
| D6 | 태그 | 휴가 토글처럼 켜고 끄는 태그(업로드·가편·대본 등) 필터 축 추가 (한솔 추가 요청) |
| D7 | 구조 | 접근안 A "레이어형 단일 캘린더" (좌측 레일 + 겹쳐 보기) |

---

## 2. 범위 / 비범위

**범위**: Supabase 신규 테이블 5개, 메인 프로세스 IPC + 권한 강제, 캘린더 레일·태그 줄·신규 모달 UI, 시간 단위 일정, 실시간 전파, 앱 내 알림, "나만 보기" 일정의 개인 캘린더 이관, 구글 팀 캘린더(teamCalendarId) 잔재 제거, 죽은 코드 정리, ScheduleView 분해, 도메인 테스트, 프리뷰 mock seed.

**비범위(2차 이후)**: 반복 일정, 슬랙/리마인더 알림, D-3/D-1 임박 강조, 주/일 보기의 시간표 축(hour grid), 씬/파트/에피소드 테이블의 마감일 컬럼, 타임라인 탭(`CalendarView`) 개편, 휴가 모듈(GAS) 개편, Supabase Auth + RLS, 대시보드 `CalendarWidget` 코드 통합(데이터는 자동 반영됨), 부서/그룹 단위 공유.

---

## 3. UI 설계 (시안 M1~M6 기준)

### 3.1 화면 뼈대 (`schedule` 뷰 개편)

- **좌측 레일(기존 180px 사이드바 확장, 접기 유지)**: 위 = 기존 미니 달력(월)/주차 목록(주)/날짜 목록(오늘) 유지. 아래 = **캘린더 목록 카드** 신설:
  - 섹션 4개: `내 캘린더`(개인) / `팀 전체` / `나에게 공유됨` / `내 구글`.
  - 각 행 = 색 체크박스(캘린더 색, 체크 = 표시 켬) + 이름 + 배지(공유받은 캘린더: `편집`/`보기`) + hover 시 `⋯` 메뉴(설정 열기 / 이 캘린더 알림 끄기).
  - 맨 아래 `+ 새 캘린더`.
  - "내 구글": 연동자에게만 체크박스 활성. 미연동자는 회색 점 + "구글 캘린더 연동 안 됨 · 설정에서 연동하기"(M6 우측).
- **헤더**: `캘린더` 제목 + 월 네비 + `오늘` + 우측 `[월|2주|주|오늘]` + `+ 일정`. **기존 유형 필터(전체/일반/EP/파트/씬/휴가)·부서 필터(BG/ACT)·휴가 토글 버튼은 제거** — 태그 줄이 대체.
- **태그 줄(헤더 아래 한 줄)**: `태그` 라벨 + 칩: `전체` + 팀 태그들(색 틴트, 켬/끔 토글) + 내장 `휴가` 칩 + `+ 태그 관리`(admin). 켠 칩 = 색 틴트 배경, 끈 칩 = 회색.
- **통계 줄**: "이번 달 N개 · 오늘 N개 · 켜진 캘린더 N/M" (기존 통계 줄 위치).

### 3.2 일정 표시 규칙

- 칩/카드 색 = **캘린더 색** 틴트(≈22%) + 색 점. 시스템 소스는 고정색: 구글 `#8B8DA3`, 휴가 `#00B894`.
- 칩 텍스트: 종일 → `태그명 · 제목`, 시간 일정 → `HH:MM 제목`.
- 주/오늘 보기(카드 목록 방식 유지): 종일 카드 먼저, 그 아래 시간 일정 시각순. 부제 `14:00 – 15:00 · 태그명`. 시간표 축은 만들지 않는다(M2).
- 보기 전용(내 편집 권한 없는 캘린더·휴가·구글 아닌 소유 불가 항목): 드래그 불가(`isReadOnly` 기존 로직 재사용), 상세 패널에 편집/삭제 버튼 미노출 + `보기 전용` 표시.
- 필터 적용 순서: (켜진 캘린더) ∩ (켜진 태그). `전체` 태그 칩 = 태그 필터 해제. 태그 없는 일정은 태그 필터가 걸려 있어도 항상 표시(태그는 선택 사항이므로 숨기면 실종처럼 보임 — `전체`가 아닐 때는 숨김이 자연스럽다는 반론이 있으나, **태그 없는 일정은 항상 표시**로 확정. 숨고 싶으면 태그를 달면 된다).

### 3.3 새 일정 모달 (M3, 기존 `EventCreateModal` 개편)

필드 순서: ① 캘린더 선택 드롭다운(필수, **편집 권한 있는 캘린더만** + 연동 시 "내 구글 캘린더", 도움말 "편집 권한이 있는 캘린더만 보여요") ② 제목 ③ 종일 토글(기본 켬) — 끄면 시작/종료 날짜+시각 4칸 ④ 태그 칩 단일 선택(선택 사항, `없음` 가능) ⑤ 연결 세그먼트 `[없음|에피소드|파트|씬]`(기존 로직 유지) ⑥ 메모. 푸터: 좌측 "이 캘린더 멤버 N명에게 알림이 가요" 안내, 우측 취소/만들기.
**기존 "나만 보기" 체크박스 삭제** — "개인" 캘린더 선택이 대체.

### 3.4 캘린더 설정·공유 모달 (M4, 신규)

이름 + 색(기존 10색 `EVENT_COLORS` 프리셋) / 공개 범위 라디오 `나만 · 특정 팀원 · 팀 전체(admin만 활성)` / 멤버 섹션(특정 팀원일 때): 이름 검색 추가 + 행별 `[보기|편집]` 토글 + 제거, 소유자 행은 배지만. 하단 `캘린더 삭제`(소유자/admin, 확인 다이얼로그 필수 — 일정 N개 함께 삭제 경고). 헤더 아래 배지: 소유자·만든 날·일정 수.
멤버 선택 UI는 `RevisionRecipientPicker`(`src/components/scenes/RevisionRecipientPicker.tsx`) / `CompositorAssignPopover` 패턴 재사용(체크 팝오버 4대 체크리스트: 트리거 바깥클릭 제외 / 닫기 경로 일관성 / Esc stopPropagation / allSettled+재조회).

### 3.5 태그 관리 팝오버 (M5, 신규)

태그 줄 `+ 태그 관리` 에서 열림. 행 = 색 점 + 이름 + 정렬 핸들 + 연필(인라인 편집: 이름 + 색 스와치). `+ 새 태그`. **admin 만 편집**, 비 admin 은 읽기 전용으로 열람만. 안내: "휴가는 자동 태그라 여기서 바꿀 수 없어요". 태그 삭제 시 해당 일정의 태그는 `없음` 처리(경고 문구).

### 3.6 상세 패널 (기존 `EventSidePanel` 확장)

표시: 캘린더(색 점+이름), 태그 칩, 날짜(+시각 "9월 10일 (수) 14:00 – 15:00"), 연결, 만든이, 메모. 편집 가능 시 기존 인라인 편집 + **캘린더 이동/태그 변경도 여기서 가능하게**(기존의 "연결대상 생성 후 수정 불가" 공백 해소). 우클릭 퀵에디트(`EventQuickEdit`)는 색 편집 대신 **태그·캘린더 변경**으로 항목 교체(색은 캘린더 소속이므로 개별 일정 색 편집 제거).

### 3.7 알림 (M6 좌측)

기존 알림 센터(`useNotificationStore`)에 `calendar` 유형 추가. 문구: "{사람} 님이 [{캘린더}] 에 일정을 추가했어요 / '{제목}' 을 변경했어요(날짜 A → B) / 일정을 삭제했어요". 클릭 → `setView('schedule')` + 해당 날짜 이동(`bflow:navigate-to-date` 재사용).

---

## 4. 데이터 모델 (Supabase — 신규 마이그레이션 SQL)

```sql
-- DEVLOG/migrations/2026-08-XX-shared-calendars.sql
CREATE TABLE IF NOT EXISTS calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6C5CE7',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','members','team')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  is_personal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_personal ON calendars(owner_id) WHERE is_personal;

CREATE TABLE IF NOT EXISTS calendar_members (
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (calendar_id, user_id)
);

CREATE TABLE IF NOT EXISTS calendar_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  memo TEXT,
  tag_id UUID REFERENCES calendar_tags(id) ON DELETE SET NULL,
  all_day BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TEXT,          -- 'HH:MM' KST, all_day=false 일 때만
  end_time TEXT,
  linked_episode INTEGER,
  linked_part TEXT,
  linked_sheet_name TEXT,
  linked_scene_id TEXT,
  linked_department TEXT,
  linked_todo_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(calendar_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS calendar_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_name TEXT,
  calendar_id UUID,          -- FK 없음: 캘린더 삭제 후에도 알림 문구 보존
  calendar_name TEXT,
  event_id UUID,
  event_title TEXT,
  event_date TEXT,           -- 이동 대상 날짜 YYYY-MM-DD
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  detail TEXT,               -- 예: '9/25 → 9/26'
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_calendar_notif_recipient
  ON calendar_notifications(recipient_id, created_at DESC);
```

- 날짜는 `DATE`(supabase-js 가 'YYYY-MM-DD' 문자열로 반환 → 기존 렌더러 로직 그대로), 시각은 `TEXT 'HH:MM'`(KST 로컬, 전원 같은 시간대라 TZ 변환 없음).
- Realtime publication 에 `calendars`, `calendar_members`, `calendar_events`, `calendar_notifications` 추가 (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`). RLS 는 기존 관례대로 `allow_all`(한계는 §5).
- 씨드: `calendar_tags` 초기값 `업로드 #E17055 / 가편 #74B9FF / 대본 #FDCB6E / 회의 #A29BFE` (한솔이 태그 관리에서 수정 가능).
- `delete_user_cascade` RPC 갱신: `calendar_members`·`calendar_notifications` 삭제, 소유 캘린더는 **개인 캘린더만 삭제**(공유 캘린더는 남기고 owner 를 admin(배한솔 id)으로 이전 — 팀 자산 보존).

### 4.1 기존 데이터 이관 (같은 마이그레이션에서)

1. `private_calendar_events` 의 `user_id` 별로 개인 캘린더 upsert: `calendars(name='개인', color='#6C5CE7', visibility='private', owner_id=user_id, is_personal=true)`.
2. `private_calendar_events` → `calendar_events` 복사(id·created_at 유지, `calendar_id` = 그 사용자의 개인 캘린더, `all_day=true`).
3. `private_calendar_events` 테이블은 **이번엔 남겨둠**(롤백 대비). 다음 라운드에서 DROP.
4. 앱 레벨: 로그인 시 개인 캘린더가 없으면 메인 프로세스가 생성(`ensurePersonalCalendar`) — 신규 사용자 대응.

---

## 5. 권한 모델

순수 함수 모듈 `src/shared/calendarPermissions.ts` (메인·렌더러·테스트 공용, `@/` alias 없이 상대 import — node --test 직접 임포트 함정 회피):

```ts
canViewCalendar(cal, memberUserIds, userId): boolean
  = cal.owner_id === userId || cal.visibility === 'team' || memberUserIds.includes(userId)
canEditCalendarEvents(cal, members, userId): boolean
  = cal.owner_id === userId || members.some(m => m.user_id === userId && m.can_edit)
canManageCalendar(cal, user): boolean      // 이름·색·공개범위·멤버·삭제
  = cal.owner_id === user.id || user.role === 'admin'
canCreateCalendar(user, visibility): boolean
  = visibility !== 'team' || user.role === 'admin'
```

- **강제 지점 = 메인 프로세스 IPC 핸들러**(`getSessionUserIdOrThrow` + 위 함수). `private_calendar_events` 의 `assertPrivateEventOwnerOrThrow`(`electron/main.ts:2430-2435`) 패턴 확장. 읽기(`calendar:list`, `calendar:events:list`)도 멤버십으로 필터해 반환.
- 개인 캘린더(`is_personal`) 는 공개 범위 변경·삭제·멤버 추가 불가(항상 `private`).
- 팀 전체 캘린더의 편집자 = 소유자 + `calendar_members.can_edit`(팀 캘린더에서 members 행은 "추가 편집자" 목록으로 사용).
- **한계(명시)**: DB 는 anon key + `allow_all` RLS 그대로이므로 보안 수준은 기존 "나만 보기" 와 동일한 앱 레벨 강제다. Supabase Auth+RLS 는 별도 프로젝트.

---

## 6. IPC / 서비스 설계

### 6.1 신규 IPC (electron/main.ts + preload, 모두 세션 검증)

| 채널 | 동작 |
|---|---|
| `calendar:list` | 내가 볼 수 있는 캘린더 + 멤버 + 내 권한(canEdit/canManage 계산 포함) 반환 |
| `calendar:create` / `calendar:update` / `calendar:delete` | 캘린더 CRUD (권한 검증, delete 는 이벤트 CASCADE) |
| `calendar:set-members` | 멤버 전체 교체(추가/제거/권한 변경 일괄) |
| `calendar:events:list` | 내가 볼 수 있는 캘린더들의 일정(기간 파라미터, `.range()` 페이지네이션 — PostgREST 1000행 제한 대응) |
| `calendar:events:create/update/delete` | 일정 CRUD (canEditCalendarEvents 검증) + 알림 행 생성 + `broadcastCalendarChanged` |
| `calendar:tags:list/save` | 태그 목록 / admin 저장(추가·수정·삭제·정렬 일괄) |
| `calendar:notifications:catchup` / `:mark-read` | 시작 시 미읽음 로드 / 읽음 처리 |

구현 위치: `electron/supabase.ts` 에 CRUD 함수(기존 `sbAddPrivateEvent` 형식), `electron/calendarService.ts`(메인측 권한 검증+알림 생성 헬퍼) 신설. CLAUDE.md 규칙 5(렌더러 직접 Supabase 금지) 준수.

### 6.2 렌더러 (src/services/calendarService.ts 개편)

- `CalendarEvent` 타입 확장: `calendarId?`, `tagId?`, `allDay?`, `startTime?`, `endTime?`, `canEdit?`(파생), `source: 'bflow' | 'google' | 'vacation'`(파생). 기존 필드 유지(구글·휴가 경로 호환).
- `eventCache` 를 source 별 병합으로 재구성: `loadBflowEvents()`(항상) + `syncAll()`(구글, `isAuthenticated` 시만) + 휴가(기존). **B flow 로드는 구글 가드 밖** — 이것이 "구글 없이도 보이는" 핵심 변경.
- 낙관적 업데이트: 기존 add/update/delete 패턴 유지, `sourceCalendarId` 라우팅에 `bflow:` 케이스 추가.
- 캘린더 목록·태그 상태: 새 Zustand 스토어 `useCalendarStore`(calendars, tags, 알림 뮤트, 켬/끔 토글 — 토글은 localStorage persist).
- 태그·캘린더 켬/끔, "내 구글" 토글: 사용자 로컬 설정(서버 저장 안 함).

---

## 7. 실시간·전파

- `electron/realtime.ts` 구독 추가: `calendars`, `calendar_members`, `calendar_events`, `calendar_notifications`(INSERT, recipient 필터는 수신 후 클라이언트에서) → 렌더러 `bflow:calendar-changed` (+알림은 `bflow:calendar-notification`).
- `App.tsx` 의 broadcast `data-change` 전체 리로드 분기에서 `calendar%` 테이블 **제외** (`App.tsx:2458-2480` — 안 그러면 일정 하나에 앱 전체 reload).
- 기존 `broadcastCalendarChanged` 수신부(`App.tsx:2584-2595`)를 "B flow 이벤트 재조회(항상) + 구글 syncIncremental(인증 시)" 로 수정 — 현재는 구글 인증자만 재조회해 비공개/공유 변경이 미반영되는 버그 겸 해결(`electron/broadcast.ts:241-242` 주석 불일치 해소).
- 같은 PC 다중 창: 기존 `calendar:broadcast-change` IPC 유지. `WidgetPopup` 캘린더 팝업은 같은 캐시를 읽으므로 자동 반영.

---

## 8. 알림 파이프라인

1. 메인 프로세스: 일정 create/update/delete 성공 직후, 해당 캘린더를 볼 수 있는 사용자 전원(본인 제외) 몫의 `calendar_notifications` 행 insert (실패해도 일정 저장은 성공 처리 — 알림은 best-effort, `console.warn` 로그).
2. 수신: Realtime INSERT → 내 `recipient_id` 면 `useNotificationStore` 에 `type:'calendar'` push. 앱 시작 시 `catchup` 으로 미읽음 로드(씬 배정 알림 `scene_assignment_notifications` 캐치업 패턴 복제).
3. 클릭: `setView('schedule')` + `bflow:navigate-to-date`(`event_date`).
4. 뮤트: 레일 ⋯ 메뉴 "이 캘린더 알림 끄기" — 로컬 설정, 표시단 필터(행은 쌓이되 안 보여줌).
5. 오래된 알림: catchup 은 최근 30일 + 미읽음만. 서버측 정리는 이번 범위 아님(행 수 작음).

---

## 9. 구글 연동 처리

| 항목 | 처분 |
|---|---|
| `gcal:*` IPC, `electron/googleCalendar.ts`, watch/Edge Function | **유지** (내 구글 레이어) |
| 새 일정 모달의 "내 구글 캘린더" 선택 | 연동자에게만 노출, 기존 insert 경로(`addEvent` 공개 분기) 사용 |
| `teamCalendarId` (metadata `('gcal','teamCalendarId')`, `saveTeamCalendarId`, `syncAll` 의 팀 캘린더 읽기, `SheetsSection` 의 void 처리된 선택 UI) | **완전 제거** + metadata 행 정리 (팀 공유는 B flow 캘린더가 담당) |
| `getTargetCalendar(_type)` 잔재, `visibility:'private'` 도달 불가 분기(`calendarService.ts:434`), `isPrivate` 구버전 주석 | 제거/정정 |
| 할일→구글 미러(`personalTodoCalendarSync`) | 유지 (변경 없음) |
| 휴가(GAS) 오버레이 | 유지, 매핑 함수만 공용화(§10) |

---

## 10. 정리 작업 (PR1 — 동작 불변)

근거: research 문서 §3. **A급(확실한 dead) 삭제**: `EventCreateTooltip.tsx`(387줄) / `ScheduleView` 내 `EventDetailModal`(412-547)·`TodayView`(1091-1156)·도달 불가 편집모드(`editEvent`/`handleUpdateEvent`)·`detailEvent`·빈 `handleDateClick`·미사용 변수/prop/import / `types/calendar.ts` 의 `CalendarStore`·`vacationRowIndex` / `calendarService.ts` 의 `loadLegacyEvents`·`loadAllEvents`·`findEventByTodoId` / `bflow:todos-changed` dispatch 2곳. `tests/calendarIntegrationStatus.test.ts` 를 `test:ui` 스크립트에 연결.

**공용화**: 날짜 유틸 10곳 복제 → `src/utils/calendarDate.ts`(fmtDate/parseDate/addDays/daysBetween/hexToRgba/요일/ISO주차) / 휴가→CalendarEvent 매핑 3곳 → `src/utils/vacationEvents.ts`.

**분해**: `ScheduleView.tsx`(2111줄) → `CalendarGrid.tsx`, `EventCreateModal.tsx`, `OverflowPopup.tsx` 등 `src/components/calendar/` 로 분리(캐릭터 현황판 뷰 분해 선례). 분해는 이동 위주, 로직 변경 금지.

---

## 11. 테스트 · 프리뷰

- `node --test` 도메인 테스트: `calendarPermissions`(4함수 × 역할 매트릭스), 가시성/태그 필터 함수, `calendarDate` 유틸, 휴가 매핑. 상대 import (@/ alias 금지).
- 프리뷰 mock(`src/mocks/devElectronAPI.ts`): 캘린더 4개(개인/EP 마일스톤/스튜디오 공지/리드 회의) + 태그 4개 + 일정 ~15개 seed, 신규 IPC 전부 mock. 기존 `supabaseAddPrivateEvent` 고정 id `'mock-private'` 버그는 새 경로 전환으로 해소.
- 검증 루틴: `npm run typecheck` + 관련 테스트 + `npm run build:vite` + 프리뷰(`?preview=1`, mock 배한솔/1234) 실기 확인.

---

## 12. PR 분할 · 버전

| PR | 내용 | 버전(마이너) |
|---|---|---|
| PR1 | 정리: dead 삭제 + 유틸 공용화 + ScheduleView 분해 (동작 불변) | +1 |
| PR2 | 데이터: 마이그레이션 SQL(라이브 적용 포함) + 메인 IPC + 권한 모듈 + 렌더러 서비스 전환(기존 "나만 보기" 경로를 개인 캘린더로 스위치) + 테스트 | +1 |
| PR3 | UI: 레일·태그 줄·새 모달·상세 패널 개편·주/일 시간 표시·프리뷰 seed | +1 |
| PR4 | 알림 + realtime 구독 + teamCalendarId 제거 + update-notes(비개발자 톤) + 문서 | +1 |

- 버전 번호는 각 PR 시점의 `origin/main` 기준 재확인(package.json + lock 3자 일치).
- 마이그레이션 SQL 은 `DEVLOG/migrations/` 기록 + 라이브 적용은 PR2 머지 시점(G드라이브 배포 전, manifest 마지막 원칙과 동일하게 "DB 먼저, 앱 나중").
- PR2 배포 전 구버전 앱 호환: 신규 테이블 추가만이므로 구버전 앱은 영향 없음. `private_calendar_events` 는 이관 후에도 남겨 구버전 "나만 보기" 가 깨지지 않게 함(신·구 버전이 다른 테이블을 보는 창은 짧고, 개인 일정 특성상 충돌 위험 낮음 — 완전 전환은 전 팀원 업데이트 후 다음 라운드에서 구 테이블 DROP).

---

## 13. 리스크 · 미해결

1. **신구 버전 공존 창**: PR2~PR4 배포 사이 구버전 사용자는 공유 캘린더가 안 보임(정상 — 새 기능). "나만 보기" 는 §12 호환책으로 유지.
2. **알림 소음**: 팀 전체 캘린더에 일정 대량 등록 시 전원 알림. v1 은 캘린더별 로컬 뮤트로 대응, 사용해 보고 서버측 설정 필요하면 2차.
3. **태그 없는 일정 표시 규칙**(§3.2)은 사용 후 재평가 가능.
4. 주/2주/일 보기의 드래그 생성·이동은 기존과 동일하게 월 보기 전용(범위 제외).
5. `metadata` `type='feature-access'` orphan 행 재사용 금지(과거 게이트 잔재) — 새 키 사용.

---

## 14. 참조

- 현재 구조 분석: `docs/superpowers/research/2026-08-24-calendar-current-structure.md`
- 시안: https://claude.ai/code/artifact/f20a13b0-9d43-4af4-8ed5-b5c6dabd9126 · 원본 `docs/superpowers/specs/mockups/2026-08-24-calendar/`
- 선례: 비공개 일정 IPC(`electron/main.ts:2423-2457`), 씬 배정 알림 캐치업, `RevisionRecipientPicker`, 캐릭터 현황판 뷰 분해(#192)
