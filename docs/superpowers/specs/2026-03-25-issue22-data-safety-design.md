# Issue #22: Supabase 마이그레이션 누락 항목 점검 및 로컬 데이터 안전성 개선

> **날짜**: 2026-03-25
> **이슈**: https://github.com/baehandoridori/Bflow-BGonly/issues/22
> **접근법**: GCal 우선, Supabase 최소화 (접근법 A)

---

## 요약

B flow의 로컬 전용 데이터(할일, 메모, 캘린더, 이미지 캐시)를 안전한 저장소로 이관한다.
캘린더는 Google Calendar을 SSOT로 사용하고, 할일/메모만 Supabase에 저장한다.

### 결정 사항

| 항목 | 결정 | SSOT |
|------|------|------|
| 할일 (MyTasks) | Supabase 이관 (개인 동기화만) | Supabase `personal_todos` |
| 메모 위젯 | Supabase 이관 (개인 전용) | Supabase `memos` |
| 캘린더 | Google Calendar 연동 (양방향) | Google Calendar |
| 이미지 캐시 | Drive 업로드 보장 + 캐시 크기 제한 | Google Drive |
| 화이트보드 | 현행 유지 (사용 빈도 낮음) | G드라이브 JSON |

### 제약 조건

- Supabase 무료 플랜 유지 (DB 500MB, Realtime 200연결, Edge Function 50만회/월)
- ~20명 동시 사용자
- Electron 데스크탑 앱 (공개 URL 없음 → Edge Function을 webhook 수신자로 활용)

---

## 1. 할일 (MyTasks) — localStorage → Supabase

### 현재 상태
- `MyTasksWidget.tsx`에서 브라우저 `localStorage`에 저장
- 키: `bflow_my_task_views`, `bflow_assigned_personal_todos`, `bflow_assigned_scene_keys`
- 캐시 삭제/재설치 시 완전 유실, PC간 동기화 불가

### 테이블 설계

```sql
CREATE TABLE personal_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  memo TEXT DEFAULT '',
  completed BOOLEAN DEFAULT false,
  start_date DATE,
  end_date DATE,
  add_to_calendar BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_personal_todos_user ON personal_todos(user_id);
```

### 데이터 흐름

```
MyTasksWidget
  → supabaseService.saveTodo()
  → IPC ('supabase:saveTodo')
  → electron/supabase.ts
  → Supabase personal_todos 테이블
```

- 낙관적 업데이트 패턴: UI 즉시 반영 → Supabase 저장 → 실패 시 롤백
- Realtime 구독 불필요 (개인 데이터, 앱 시작 시 fetch + 변경 시 즉시 저장)

### 마이그레이션

- 최초 실행 시 `localStorage`의 기존 할일을 Supabase로 자동 이관
- 이관 완료 후 localStorage 키 삭제
- 이관 대상 키: `bflow_assigned_personal_todos`, `bflow_my_task_views`, `bflow_assigned_scene_keys`

### 수정 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/supabase.ts` | personal_todos CRUD 함수 추가 |
| `electron/main.ts` | IPC 핸들러 추가 (`supabase:loadTodos`, `supabase:saveTodo`, `supabase:deleteTodo`) |
| `src/services/supabaseService.ts` | IPC 래퍼 함수 추가 |
| `src/components/widgets/MyTasksWidget.tsx` | localStorage → supabaseService 호출로 교체, 마이그레이션 로직 |

---

## 2. 메모 위젯 — 로컬 JSON → Supabase

### 현재 상태
- `%APPDATA%/Bflow-BGonly/memo.json`에 저장
- `settingsService`의 `settings:write` IPC로 읽기/쓰기
- 재설치 시 유실, PC간 동기화 불가

### 테이블 설계

```sql
CREATE TABLE memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tabs JSONB NOT NULL DEFAULT '[]',
  active_tab_id TEXT,
  font_size INT DEFAULT 14,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_memos_user ON memos(user_id);
```

- 사용자당 1개 row (현재 구조와 동일 — 위젯 하나에 여러 탭)
- `tabs` JSONB: `[{"id": "...", "title": "탭1", "content": "메모 내용..."}]`
- 개인 전용 (공유 메모가 필요하면 화이트보드 활용)

### 데이터 흐름

```
MemoWidget
  → supabaseService.saveMemo()
  → IPC ('supabase:saveMemo')
  → electron/supabase.ts
  → Supabase memos 테이블
```

- 낙관적 업데이트 패턴
- 저장 타이밍: 탭 전환/내용 변경 시 디바운스(1~2초) 후 자동 저장 + 앱 종료 시
- Realtime 구독 불필요 (개인 데이터)

### 마이그레이션

- 최초 실행 시 `memo.json`이 존재하면 Supabase로 자동 이관
- 이관 완료 후 로컬 파일은 백업으로 유지 (삭제하지 않음)

### 수정 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/supabase.ts` | memos CRUD 함수 추가 |
| `electron/main.ts` | IPC 핸들러 추가 (`supabase:loadMemo`, `supabase:saveMemo`) |
| `src/services/supabaseService.ts` | IPC 래퍼 함수 추가 |
| `src/components/widgets/MemoWidget.tsx` | settings:read/write → supabaseService 호출로 교체, 마이그레이션 로직 |

---

## 3. 캘린더 — Google Calendar 양방향 연동

### 현재 상태
- `%APPDATA%/Bflow-BGonly/calendar-events.json`에 로컬 저장
- `calendarService.ts`에서 관리
- 팀 공유 불가, 재설치 시 유실

### 아키텍처 변경

```
[현재]
CalendarWidget → calendarService → settings:write → calendar-events.json (로컬)

[변경 후]
CalendarWidget → googleCalendarService → IPC → electron/googleCalendar.ts → Google Calendar API
                                                  ├─ 팀 GCal (작업일정 + 휴가)
                                                  └─ 개인 GCal (개인 일정)

[GCal → B flow 실시간 알림]
GCal 변경 → Google Push Notification
          → Supabase Edge Function (webhook 수신)
          → Supabase Realtime Broadcast
          → Electron 클라이언트 수신
          → incremental sync 실행
```

**Google Calendar이 SSOT. B flow 캘린더 위젯은 뷰어 + 리모컨 역할만.**

### OAuth2 인증 플로우

```
1. 사용자가 설정에서 "Google Calendar 연동" 클릭
2. Electron이 시스템 브라우저로 Google OAuth2 consent 화면 오픈
3. 사용자가 Google 계정 로그인 + 권한 승인
4. redirect URI (localhost loopback)로 authorization code 수신
5. code → access_token + refresh_token 교환
6. 토큰을 %APPDATA%/google-tokens.json에 암호화 저장
7. 이후 refresh_token으로 자동 갱신
```

- 기존 `googleapis` 의존성 활용
- Google Cloud Console에서 OAuth2 Client ID 생성 필요 (Desktop App 타입)
- 스코프: `https://www.googleapis.com/auth/calendar`
- 팀원 각자 개인 Gmail 계정으로 인증

### 이벤트 타입 → GCal 매핑

| B flow 타입 | 대상 캘린더 | GCal 이벤트 형태 |
|------------|-----------|----------------|
| `custom` (개인 일정) | 개인 GCal | 일반 이벤트, 제목/메모/색상 매핑 |
| `vacation` (휴가) | 팀 GCal | 종일 이벤트, `[휴가] 홍길동 - 연차` |
| `episode` (에피소드 마감) | 팀 GCal | 종일 이벤트, `[EP01] 마감` |
| `part` (파트 마감) | 팀 GCal | 종일 이벤트, `[EP01-A-BG] 마감` |
| `scene` (씬 마감) | 팀 GCal | 종일 이벤트, `[EP01-A-BG] S001 마감` |

- GCal 이벤트의 `extendedProperties.private`에 B flow 메타데이터 저장
  - `bflow_type`: 'custom' | 'vacation' | 'episode' | 'part' | 'scene'
  - `bflow_linked_id`: linkedEpisode, linkedPart 등
  - `bflow_department`: 'bg' | 'acting'
- 이를 통해 B flow에서 GCal 이벤트를 읽을 때 타입 구분 가능
- `extendedProperties`가 없는 GCal 이벤트 = 순수 외부 이벤트 → B flow에서 읽기 전용으로 표시

### 동기화 방식

**B flow → GCal (즉시)**:
- 이벤트 생성/수정/삭제 시 바로 GCal API 호출
- 낙관적 업데이트: UI 즉시 반영 → API 호출 → 실패 시 롤백

**GCal → B flow (실시간, Edge Function Webhook)**:
- Google Calendar Watch API로 팀 GCal + 개인 GCal 변경 감시 등록
- 변경 발생 → Google이 Supabase Edge Function webhook으로 알림
- Edge Function이 Supabase Realtime Broadcast로 해당 사용자에게 전파
- Electron 클라이언트가 Broadcast 수신 → incremental sync 실행 (syncToken 기반)
- Watch 채널은 7일마다 자동 갱신

**앱 시작 시**:
- 전체 동기화 1회 수행 (syncToken 획득)
- Watch 채널 등록/갱신

**Edge Function 호출량 추정**:
- ~20명 × 하루 5회 변경 × 30일 = ~3,000회/월
- 중복 알림 포함 ~1만회/월 → 50만회 한도의 2% (여유)

### 캘린더 설정 UI

설정 탭에 "Google Calendar 연동" 섹션 추가:
- Google 계정 연결/해제 버튼
- 연결 상태 표시 (연결됨/미연결)
- 팀 캘린더 선택 (드롭다운: 접근 가능한 캘린더 목록)
- 동기화 상태 표시 (마지막 동기화 시각)

### 기존 데이터 처리

- `calendar-events.json`의 기존 데이터는 무시 (새로 시작)
- GCal 연동 후 GCal에 있는 이벤트가 캘린더 위젯에 표시됨
- OAuth 미연동 시 캘린더 위젯에 연동 안내 표시

### 수정 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/googleCalendar.ts` | **신규** — Google Calendar API CRUD, OAuth2, Watch 관리 |
| `electron/main.ts` | GCal IPC 핸들러 추가 |
| `src/services/googleCalendarService.ts` | **신규** — IPC 래퍼 (기존 calendarService.ts 대체) |
| `src/services/calendarService.ts` | 삭제 또는 deprecated 처리 |
| `src/types/calendar.ts` | GCal 연동 타입 추가/수정 |
| `src/components/calendar/` | GCal 기반으로 리팩토링 |
| `src/components/widgets/MyTasksWidget.tsx` | 캘린더 연동 부분을 GCal 서비스로 교체 |
| `supabase/functions/gcal-webhook/` | **신규** — Edge Function (webhook 수신 → Broadcast) |

---

## 4. 이미지 캐시 정리

### 현재 상태
- `%APPDATA%/Bflow-BGonly/images/`에 저장
- Google Drive 업로드 기능 존재하나, 업로드 보장 안 됨
- 캐시 크기 제한 없음

### 변경 내용

**Drive 업로드 보장**:
- 이미지 저장 시 로컬 저장 + Google Drive 업로드를 동시에 수행
- Drive 업로드 실패 시 재시도 큐에 넣고 백그라운드에서 재시도 (최대 3회)
- 업로드 성공 여부를 이미지 메타데이터에 기록

**캐시 크기 제한**:
- `images/` 폴더에 최대 크기 제한: 500MB
- 초과 시 가장 오래된 캐시부터 자동 삭제 (Drive에 원본이 있는 것만)
- Drive URL이 있는 이미지는 삭제해도 필요 시 재다운로드

### 수정 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/main.ts` | `image:save` 핸들러에 Drive 업로드 보장 로직 추가 |
| `electron/main.ts` | 캐시 크기 확인 + 자동 정리 로직 추가 |

---

## 5. 화이트보드 — 현행 유지

사용 빈도가 낮으므로 이번 사이클에서는 변경하지 않는다.
G드라이브 JSON 폴링 방식(2.5초) 그대로 유지.
추후 사용 빈도가 높아지면 Supabase Realtime 전환 검토.

---

## 구현 순서

| 순서 | 항목 | 핵심 작업 | 난이도 | 비고 |
|------|------|----------|--------|------|
| **1차** | 할일 (MyTasks) | Supabase 테이블 + localStorage 이관 + IPC | 낮음 | 기존 패턴 활용 |
| **2차** | 메모 위젯 | Supabase 테이블 + memo.json 이관 + IPC | 낮음 | 1차와 동일 패턴 |
| **3차** | 캘린더 GCal 연동 | OAuth2 + GCal API + Edge Function + calendarService 교체 | **높음** | 가장 큰 변경 |
| **4차** | 이미지 캐시 | Drive 업로드 보장 + 캐시 크기 제한 | 중간 | 기존 핸들러 보강 |

---

## Supabase 무료 플랜 영향 분석

| 리소스 | 한도 | 이번 변경으로 추가 | 총 예상 사용 | 여유 |
|--------|------|-------------------|-------------|------|
| DB 크기 | 500MB | ~5MB (todos + memos) | ~60MB | 88% 여유 |
| Realtime 연결 | 200 | 0 (개인 데이터) | ~20 | 90% 여유 |
| Edge Function | 50만/월 | ~1만/월 (GCal webhook) | ~1만/월 | 98% 여유 |

---

## 에러 처리

### 공통
- 모든 Supabase/GCal API 호출은 try-catch로 감싸고 실패 시 롤백
- 네트워크 오류 시 토스트 알림 + 재시도 옵션

### GCal 특화
- OAuth 토큰 만료 → refresh_token으로 자동 갱신, 실패 시 재인증 안내
- GCal API 할당량 초과 → 지수 백오프 재시도
- Watch 채널 만료 → 앱 실행 시 자동 재등록
- 오프라인 → 캘린더 위젯에 "오프라인" 표시, 온라인 복귀 시 전체 sync

---

*작성: 2026-03-25*
*작성자: Claude × 한솔 (Studio JBBJ)*
