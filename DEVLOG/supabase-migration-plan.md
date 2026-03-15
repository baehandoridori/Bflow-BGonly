# Supabase 마이그레이션 계획서

> **작성일**: 2026-03-13
> **작성**: Claude × 한솔 (Studio JBBJ)
> **목적**: Google Sheets(GAS) → Supabase 전환을 위한 상세 실행 계획
> **대상 브랜치**: 별도 브랜치에서 개발 (메인과 독립)
> **문서 용도**: Claude Code 세션이 이 문서를 읽고 자율적으로 구현할 수 있도록 최적화

---

## 0. 의사결정 요약 (Decision Log)

아래는 한솔님과의 인터뷰로 확정된 사항이다. 구현 시 이 결정을 절대 변경하지 말 것.

| 항목 | 결정 | 비고 |
|------|------|------|
| Supabase 플랜 | **Cloud 무료** | 500MB DB, 1GB Storage, 200 동시 Realtime |
| 인증 시스템 | **미정** — 두 옵션 모두 문서화 | Supabase Auth vs 현행 유지, 구현 시 한솔님과 재확인 |
| Realtime 범위 | **전체** | scenes, comments, comp_revisions, registry, metadata 모두 구독 |
| 테스트 모드 | **제거** | `testSheetService.ts`, `--test-mode` 플래그, `if(sheetsConnected)` 분기 전부 삭제 |
| 이미지 업로드 | **GAS 유지** | DB는 Supabase, 이미지 업로드만 기존 GAS 경유. `drive-img://` 프로토콜 그대로 |
| 다운타임 | **반나절 허용** | 퇴근 후 또는 주말에 컷오버 |
| 마이그레이션 데이터 | **활성 에피소드만** | 아카이브(AC_EP*)는 시트에 보관 |
| 시트 원본 처리 | **당분간 유지** | 전환 후에도 시트 삭제하지 않음 (백업) |
| 환경변수 배포 | **하드코딩** | Supabase URL/anon key를 빌드에 포함 |
| 팀 규모 | **20명 고정** | 무료 플랜 내 운영 |

---

## 1. 현재 아키텍처 (AS-IS)

```
Electron 앱 (렌더러: React + Zustand)
    ↕ IPC (preload.ts)
Electron 메인 프로세스 (electron/main.ts)
    ↕ HTTP GET/POST
Google Apps Script (apps-script/Code.gs)
    ↕
Google Sheets (SSOT)
    ├── EP##_#_BG / EP##_#_ACT  (씬 데이터)
    ├── _REGISTRY               (에피소드/파트 레지스트리)
    ├── _USERS                  (사용자 계정)
    ├── _COMMENTS               (댓글)
    ├── _COMP_REVISIONS         (컴포지팅 리비전)
    └── _METADATA               (에피소드 제목/메모 등)

Google Drive
    └── 이미지 파일 (스토리보드/가이드)
```

### 핵심 문제

1. **크로스 머신 실시간 동기화 없음**: `broadcastSheetChanged()`는 같은 PC 내 윈도우끼리만 IPC 전파. 다른 PC의 변경을 감지하는 메커니즘이 전무 (위젯 팝업의 120초 emergency poll만 존재)
2. **GAS 재배포 필수**: Code.gs 수정 시 매번 수동으로 "새 배포" 해야 반영
3. **인증 없음**: GAS가 ANYONE_ANONYMOUS — URL만 알면 누구나 데이터 수정 가능

---

## 2. 목표 아키텍처 (TO-BE)

```
Electron 앱 (렌더러: React + Zustand)
    ↕ IPC (preload.ts)
Electron 메인 프로세스 (electron/main.ts)
    ├── @supabase/supabase-js  →  Supabase (PostgreSQL + Realtime)
    │     ├── scenes, episodes, parts    (씬 데이터)
    │     ├── registry                   (레지스트리)
    │     ├── users                      (사용자)
    │     ├── comments                   (댓글)
    │     ├── comp_revisions             (리비전)
    │     └── metadata                   (메타데이터)
    │
    └── HTTP (GAS)  →  Google Drive      (이미지 업로드만 유지)

Supabase Realtime (WebSocket)
    └── 모든 테이블 변경 → 구독 중인 모든 클라이언트에 즉시 push
```

### 핵심 변화

1. **실시간 동기화**: Supabase Realtime WebSocket으로 모든 클라이언트에 즉시 push (~100ms)
2. **GAS 역할 축소**: 이미지 업로드만 담당 (DB 역할 완전 제거)
3. **테스트 모드 제거**: `if(sheetsConnected)` 분기 전부 삭제, Supabase 단일 경로
4. **폴링 제거**: `syncInBackground()` 기반 동기화 → Realtime 이벤트 기반으로 전환

---

## 3. Supabase 스키마 설계

### 3-1. episodes 테이블

현재 시트에서 에피소드는 탭 이름(EP01_A_BG)으로 암시적 표현. Supabase에서는 명시적 테이블로.

```sql
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number INTEGER NOT NULL,
  title TEXT,                          -- 에피소드 제목 (현재 _METADATA에 저장)
  memo TEXT,                           -- 에피소드 메모 (현재 _METADATA에 저장)
  status TEXT DEFAULT 'active',        -- 'active' | 'archived'
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_number)
);
```

> **매핑**: 현재 `_REGISTRY`의 에피소드 행 + `_METADATA`의 제목/메모 → 이 테이블로 통합.

### 3-2. parts 테이블

```sql
CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,                -- 'A', 'B', 'C' ...
  department TEXT NOT NULL,             -- 'bg' | 'acting'
  status TEXT DEFAULT 'active',         -- 'active' | 'archived'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_id, part_id, department)
);
```

> **매핑**: 현재 시트 탭 하나 = parts 행 하나. `EP01_A_BG` → episode_number=1, part_id='A', department='bg'

### 3-3. scenes 테이블

현재 시트의 각 행(A~K열)이 하나의 씬.

```sql
CREATE TABLE scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_number TEXT NOT NULL,           -- 'S001', 'S002' 등 (현재 B열)
  sort_order INTEGER NOT NULL,          -- 정렬용 (현재 A열 No)
  memo TEXT,                            -- C열
  storyboard_url TEXT,                  -- D열
  guide_url TEXT,                       -- E열
  assignee TEXT,                        -- F열
  lo BOOLEAN DEFAULT false,             -- G열
  done BOOLEAN DEFAULT false,           -- H열 (완료)
  review BOOLEAN DEFAULT false,         -- I열 (검수)
  png BOOLEAN DEFAULT false,            -- J열
  layout TEXT,                          -- K열
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(part_id, scene_number)
);

-- 체크박스 토글 성능을 위한 인덱스
CREATE INDEX idx_scenes_part_id ON scenes(part_id);
CREATE INDEX idx_scenes_assignee ON scenes(assignee);
```

> **매핑**: 시트 EP01_A_BG의 각 행 → scenes 테이블 행. `part_id`가 FK로 에피소드/파트/부서를 식별.

### 3-4. comments 테이블

```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,                  -- 현재 commentId (UUID 문자열)
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,               -- 씬 번호 (scenes.scene_number 참조용)
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,   -- 멘션된 사용자 ID 배열
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ,

  CONSTRAINT fk_scene FOREIGN KEY (part_id, scene_id)
    REFERENCES scenes(part_id, scene_number) ON DELETE CASCADE
);

CREATE INDEX idx_comments_part_scene ON comments(part_id, scene_id);
```

> **매핑**: `_COMMENTS` 시트 → 이 테이블. `sheetName` → `part_id`(FK), `sceneId` → `scene_id`.

### 3-5. comp_revisions 테이블

```sql
CREATE TABLE comp_revisions (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  status TEXT DEFAULT 'open',           -- 'open' | 'resolved'
  description TEXT,
  image_url TEXT,
  department TEXT,
  requester_id TEXT,
  requester_name TEXT,
  assignee TEXT,
  resolved_by TEXT,
  resolved_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_comp_revisions_part_scene ON comp_revisions(part_id, scene_id);
```

> **매핑**: `_COMP_REVISIONS` 시트 → 이 테이블. `sceneKey` 파싱하여 `part_id` + `scene_id`로 분해.

### 3-6. users 테이블

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                  -- userId
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',             -- 'admin' | 'user'
  password TEXT,                        -- base64 인코딩 (현행 유지 옵션)
  slack_id TEXT,
  hire_date TEXT,
  birthday TEXT,
  is_initial_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

> **참고**: 인증 방식은 미정. Supabase Auth 전환 시 이 테이블은 `auth.users` + profiles 테이블로 대체됨. 현행 유지 시 이 테이블 그대로 사용.

### 3-7. metadata 테이블

```sql
CREATE TABLE metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                   -- 'episode-title', 'episode-memo' 등
  key TEXT NOT NULL,                    -- 에피소드 번호 등
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(type, key)
);
```

> **참고**: 에피소드 제목/메모가 episodes 테이블에 직접 들어가므로, 이 테이블은 기타 메타데이터 전용. 만약 현재 _METADATA에 episode-title/episode-memo만 있다면 이 테이블은 불필요할 수 있다. 구현 시 `_METADATA` 시트 내용을 확인하고 판단할 것.

---

## 4. Realtime 구독 설계

### 4-1. 구독 채널 구조

```typescript
// 모든 테이블 변경을 하나의 채널로 구독 (무료 플랜 연결 수 절약)
const channel = supabase
  .channel('bflow-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' }, handleSceneChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, handleCommentChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'comp_revisions' }, handleRevisionChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'episodes' }, handleEpisodeChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, handlePartChange)
  .subscribe();
```

### 4-2. 이벤트 핸들링 전략

| 이벤트 | 처리 |
|--------|------|
| `scenes` UPDATE (체크박스 토글) | `useDataStore`에서 해당 씬의 필드만 갱신. full reload 하지 않음 |
| `scenes` INSERT/DELETE | 해당 파트의 씬 목록 부분 갱신 |
| `comments` INSERT/UPDATE/DELETE | 댓글 캐시 무효화 + 해당 씬의 댓글 수 갱신 |
| `comp_revisions` 변경 | 리비전 캐시 갱신 |
| `episodes`/`parts` 변경 | 에피소드 목록 갱신 (빈도 낮음) |

### 4-3. 낙관적 업데이트 + Realtime 공존

```
사용자 A가 체크박스 토글:
  1. 로컬 Zustand 즉시 업데이트 (낙관적)
  2. Supabase UPDATE 요청
  3. 성공 → 끝 (Realtime 이벤트도 수신되지만 이미 반영된 상태 → 무시 or 무해)
  4. 실패 → 롤백

다른 사용자 B:
  1. Realtime 이벤트 수신 → Zustand 즉시 업데이트
  2. 자기가 변경한 것이 아니므로 낙관적 업데이트 충돌 없음
```

**자기 변경 필터링**: Realtime 이벤트에서 자신이 방금 보낸 변경인지 구분 필요.
- 방법 1: 이벤트의 `updated_at`과 로컬 낙관적 업데이트 시각 비교
- 방법 2: 변경 시 `updated_by` 컬럼에 userId 기록, 자기 userId면 스킵
- **추천**: 방법 2 — `scenes` 테이블에 `updated_by TEXT` 컬럼 추가

---

## 5. 코드 변경 계획

### 5-1. 새로 생성할 파일

| 파일 | 역할 |
|------|------|
| `electron/supabase.ts` | Supabase 클라이언트 초기화 + DB CRUD 함수 |
| `electron/realtime.ts` | Realtime 구독 관리 (채널 생성, 이벤트 핸들링, 재연결) |
| `src/services/supabaseService.ts` | 렌더러→IPC 래퍼 (기존 `sheetsService.ts` 대체) |

### 5-2. 대폭 수정할 파일

| 파일 | 현재 줄 수 | 변경 내용 |
|------|-----------|----------|
| `electron/main.ts` | ~900줄 | IPC 핸들러: sheets 관련 → supabase 관련으로 교체. Realtime 이벤트를 렌더러에 전달하는 새 IPC 추가 |
| `src/views/ScenesView.tsx` | ~2980줄 | `if(sheetsConnected)` 분기 전부 제거. `sheetsService` → `supabaseService` 호출로 교체. `syncInBackground()` → Realtime 이벤트 핸들러로 대체 |
| `src/App.tsx` | ~2000줄 | `onSheetChanged` 리스너 → Realtime 이벤트 리스너로 교체. 초기 데이터 로딩 경로 변경 |
| `src/stores/useDataStore.ts` | ~200줄 | Realtime 이벤트로 부분 갱신하는 액션 추가 (기존 `setSceneStageValue` 패턴 확장) |
| `src/stores/useAppStore.ts` | ~160줄 | `sheetsConnected`, `isTestMode` 상태 제거 → `supabaseConnected` 상태 추가 |
| `electron/preload.ts` | ~150줄 | sheets 관련 IPC 메서드 → supabase 관련으로 교체 |

### 5-3. 삭제할 파일/코드

| 대상 | 이유 |
|------|------|
| `electron/sheets.ts` | GAS HTTP 통신 전체 (이미지 업로드 제외 — 별도 분리 후 삭제) |
| `electron/gas-fetch.ts` | GAS 리다이렉트/재시도 로직 (이미지용으로 일부 보존 필요) |
| `src/services/sheetsService.ts` | `supabaseService.ts`로 대체 |
| `src/services/testSheetService.ts` | 테스트 모드 제거 |
| `test-data/` 디렉토리 | 테스트 모드 제거 |
| 모든 `if(sheetsConnected) / else` 분기 | 단일 경로화 |
| `syncInBackground()` 함수 | Realtime으로 대체 |
| `WidgetPopup.tsx`의 120초 emergency poll | Realtime으로 대체 |

### 5-4. 보존할 파일/코드

| 대상 | 이유 |
|------|------|
| `apps-script/Code.gs` 중 이미지 업로드 부분 | GAS 이미지 업로드 유지 |
| `electron/main.ts` 중 `drive-img://` 프로토콜 핸들러 | 이미지 표시 기능 유지 |
| `electron/main.ts` 중 `bflow-img://` 프로토콜 핸들러 | 로컬 이미지 캐시 유지 |
| `electron/main.ts` 중 `image:save` IPC 핸들러 | 로컬 이미지 저장 유지 |
| `broadcastSheetChanged()` → `broadcastDataChanged()`로 리네임 | 같은 PC 내 다중 창 동기화는 여전히 필요 |

---

## 6. 마이그레이션 스크립트

### 6-1. 데이터 추출 (Sheets → JSON)

GAS에 일회성 `exportAll` 액션 추가하거나, 기존 `readAllEpisodes` 응답을 JSON으로 저장.

```
추출 대상:
  - 활성 에피소드의 모든 시트 탭 (EP##_#_BG, EP##_#_ACT)
  - _REGISTRY (활성 항목만)
  - _USERS
  - _COMMENTS
  - _COMP_REVISIONS
  - _METADATA

제외:
  - 아카이브 탭 (AC_EP*)
```

### 6-2. 데이터 변환 (JSON → SQL INSERT)

Node.js 스크립트로 시트 데이터를 Supabase 스키마에 맞게 변환.

```
변환 규칙:
  - 시트 탭명 EP01_A_BG → episodes(episode_number=1) + parts(part_id='A', department='bg')
  - 시트 행 → scenes(part_id=<위의 parts.id>, scene_number=B열, ...)
  - _COMMENTS 행 → comments(part_id=<sheetName으로 parts 조회>, ...)
  - _COMP_REVISIONS 행 → comp_revisions(part_id=<sceneKey 파싱>, ...)
  - _METADATA → episodes.title / episodes.memo로 병합, 나머지는 metadata 테이블
```

### 6-3. 데이터 적재 (SQL → Supabase)

Supabase JS 클라이언트 또는 SQL 직접 실행으로 INSERT.

```
순서 (FK 의존성):
  1. users
  2. episodes
  3. parts (episodes.id 참조)
  4. scenes (parts.id 참조)
  5. comments (parts.id 참조)
  6. comp_revisions (parts.id 참조)
  7. metadata
```

### 6-4. 검증

```
검증 항목:
  - episodes 행 수 == 활성 에피소드 수
  - parts 행 수 == 활성 시트 탭 수
  - scenes 행 수 == 모든 활성 시트의 데이터 행 합계
  - comments 행 수 == _COMMENTS 시트 행 수
  - 샘플 씬 3개의 체크박스 값 일치 확인 (수동)
```

---

## 7. 실행 페이즈

### Phase M-0: 준비 (앱 중단 없음)

```
소요: 반나절

작업:
  □ Supabase 프로젝트 생성 (supabase.com)
  □ SQL로 테이블 생성 (섹션 3의 스키마)
  □ Realtime 활성화 (Supabase 대시보드 → Database → Replication)
  □ RLS 정책 설정 (anon key로 읽기/쓰기 허용 — 내부 팀 전용이므로)
  □ anon key + project URL 확인
```

**RLS 정책 참고**:
```sql
-- 내부 팀 전용이므로 anon key로 전체 접근 허용
-- (향후 Supabase Auth 도입 시 사용자별 정책으로 강화)
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON episodes FOR ALL USING (true) WITH CHECK (true);
-- 나머지 테이블도 동일
```

### Phase M-1: 마이그레이션 스크립트 개발 (앱 중단 없음)

```
소요: 반나절~하루

작업:
  □ electron/migration/ 디렉토리에 일회성 스크립트 작성
  □ sheets-to-json.ts: GAS에서 전체 데이터 추출
  □ json-to-supabase.ts: JSON → Supabase INSERT
  □ verify-migration.ts: 데이터 정합성 검증
  □ 테스트 실행 (별도 Supabase 프로젝트 또는 같은 프로젝트의 테스트 테이블)
```

### Phase M-2: Supabase 클라이언트 구현 (앱 중단 없음)

```
소요: 1~2일

작업:
  □ npm install @supabase/supabase-js
  □ electron/supabase.ts 작성 — 클라이언트 초기화, CRUD 함수
  □ electron/realtime.ts 작성 — Realtime 구독, 이벤트→IPC 전달
  □ src/services/supabaseService.ts 작성 — IPC 래퍼
  □ electron/preload.ts에 새 IPC 메서드 추가
  □ electron/main.ts에 새 IPC 핸들러 등록
```

**electron/supabase.ts 핵심 구조**:
```typescript
import { createClient } from '@supabase/supabase-js';

// 하드코딩 (의사결정 #환경변수 참조)
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// CRUD 예시
export async function readAllEpisodes() { ... }
export async function updateSceneField(sceneId: string, field: string, value: unknown) { ... }
export async function addEpisode(episodeNumber: number) { ... }
export async function addScene(partId: string, sceneData: Partial<Scene>) { ... }
// ... 기존 sheetsService 함수와 1:1 대응
```

**electron/realtime.ts 핵심 구조**:
```typescript
export function setupRealtimeSubscription(
  onSceneChange: (payload) => void,
  onCommentChange: (payload) => void,
  onRevisionChange: (payload) => void,
  onEpisodeChange: (payload) => void,
) {
  const channel = supabase.channel('bflow-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' }, onSceneChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, onCommentChange)
    // ...
    .subscribe((status) => {
      // 연결 상태 관리 — 끊김 시 자동 재연결은 supabase-js가 처리
      // 상태를 렌더러에 전달하여 연결 표시 UI 갱신
    });

  return () => channel.unsubscribe();
}
```

### Phase M-3: 뷰/스토어 전환 (앱 중단 없음)

```
소요: 2~3일 (가장 큰 작업)

작업:
  □ useAppStore: sheetsConnected/isTestMode 제거 → supabaseConnected 추가
  □ useDataStore: Realtime 부분 갱신 액션 추가
  □ ScenesView.tsx: sheetsService → supabaseService 교체, 모든 if(sheetsConnected) 분기 제거
  □ App.tsx: onSheetChanged → Realtime 이벤트 리스너 교체
  □ WidgetPopup.tsx: emergency poll 제거, Realtime 구독 추가
  □ CommentPanel.tsx: commentService 내부를 Supabase 호출로 교체
  □ SettingsView.tsx: Sheets 연결 설정 UI → Supabase 연결 상태 표시로 변경
  □ 기타 모든 뷰에서 sheets 참조 제거
```

**ScenesView.tsx 변경 패턴**:
```typescript
// BEFORE (현재)
const handleToggle = async (sceneId, field) => {
  toggleSceneStageOptimistic(sceneId, field);
  try {
    if (sheetsConnected) {
      await updateSheetCell(sheetName, sceneId, field, value);
    } else {
      await testToggleScene(sheetName, sceneId, field, value);
    }
    syncInBackground();
  } catch { syncInBackground(); }
};

// AFTER (Supabase)
const handleToggle = async (sceneId, field) => {
  toggleSceneStageOptimistic(sceneId, field);
  try {
    await updateSceneField(sceneId, field, value);
    // syncInBackground 불필요 — Realtime이 다른 클라이언트에 전파
  } catch {
    rollbackToggle(sceneId, field);  // 실패 시 명시적 롤백
  }
};
```

### Phase M-4: 테스트 모드 제거 (앱 중단 없음)

```
소요: 반나절

작업:
  □ src/services/testSheetService.ts 삭제
  □ test-data/ 디렉토리 삭제
  □ 모든 파일에서 isTestMode, TEST_MODE, --test-mode 참조 제거
  □ electron/main.ts에서 테스트 모드 관련 IPC 핸들러 제거
  □ electron/main.ts에서 test-data 파일 워처 제거
```

### Phase M-5: 정리 및 빌드 검증 (앱 중단 없음)

```
소요: 반나절

작업:
  □ electron/sheets.ts에서 이미지 업로드 관련 코드를 electron/drive-image.ts로 분리
  □ electron/sheets.ts 삭제 (이미지 분리 후)
  □ electron/gas-fetch.ts에서 이미지 업로드에 필요한 부분만 남기고 정리
  □ src/services/sheetsService.ts 삭제
  □ src/config.ts에서 DEFAULT_WEB_APP_URL 제거 (이미지용 URL은 유지)
  □ broadcastSheetChanged → broadcastDataChanged 리네임
  □ tsc --noEmit 통과 확인
  □ vite build 통과 확인
  □ 불필요한 타입 정의 정리 (SheetDelta 등 → RealtimeDelta로 교체)
```

### Phase M-6: 컷오버 (다운타임 불필요)

```
의사결정 (2026-03-15):
  - 기존 Sheets 데이터 이관 없이 새로 시작
  - 사용자 계정도 새로 만들기
  - → 마이그레이션 스크립트(M-1) 불필요

순서:
  1. 새 빌드 생성 (npm run build → Electron 패키징)
  2. 공유 드라이브에 복사
  3. 팀에 공지: "새 앱 사용 시작, 계정 새로 만들어주세요"
  4. 한솔님이 먼저 테스트
     - 에피소드/씬 추가 → 데이터 생성 확인
     - 씬 체크박스 토글 → 다른 PC에서 즉시 반영 확인
     - 댓글 작성 → 다른 PC에서 즉시 확인
  5. 문제 없으면 팀 전체 사용 시작
```

---

## 8. 롤백 계획

전환 실패 시:

1. **앱 롤백**: 공유 드라이브의 이전 빌드(.exe)를 복원 — 시트 기반 앱으로 즉시 복귀
2. **데이터 롤백**: 시트 원본을 삭제하지 않으므로, 이전 앱은 시트 데이터를 그대로 읽음
3. **Supabase 데이터**: 롤백 후에도 유지 (다음 시도를 위해). 삭제하지 않음

> **핵심**: 시트를 당분간 유지하기로 결정했으므로, 롤백은 "이전 빌드 복사"만으로 완료.

---

## 9. 인증 시스템 옵션 (미정 — 구현 전 한솔님과 확인)

### 옵션 A: 현행 유지

- `users` 테이블에 base64 비밀번호 저장 (현재와 동일)
- 앱에서 직접 비밀번호 확인
- **장점**: 변경 최소, 기존 사용자 경험 유지
- **단점**: 보안 취약 (base64는 암호화가 아님), 세션 관리 수동

### 옵션 B: Supabase Auth

- Supabase의 내장 인증 사용 (이메일+비밀번호)
- `auth.users` 테이블 자동 관리, bcrypt 해싱
- RLS 정책을 사용자별로 세분화 가능
- **장점**: 보안 강화, 세션/토큰 자동 관리
- **단점**: 기존 사용자 계정 마이그레이션 필요, 로그인 흐름 변경

### 구현 시 확인 사항

```
한솔님에게 물어볼 것:
  1. Supabase Auth를 쓸 경우, 기존 사용자들에게 비밀번호 재설정을 요청할 수 있는가?
  2. 이메일 기반 로그인으로 전환해도 괜찮은가? (현재는 이름+비밀번호)
  3. 인증 전환은 DB 마이그레이션과 동시에 할 것인가, 나중에 별도로 할 것인가?
```

---

## 10. 주의사항 (구현 세션이 반드시 읽을 것)

### 10-1. GAS 이미지 업로드 보존

이미지 업로드는 GAS를 계속 사용한다. 따라서:
- `electron/sheets.ts`에서 이미지 업로드 관련 코드(`uploadImage` action)를 먼저 분리
- `electron/drive-image.ts` (또는 유사 이름)로 추출
- 그 후에 `sheets.ts`를 삭제

GAS 웹 앱 URL은 이미지 업로드 전용으로 유지해야 하므로:
- `src/config.ts`의 `DEFAULT_WEB_APP_URL`은 `DEFAULT_GAS_IMAGE_URL`로 리네임
- SettingsView의 GAS URL 입력 필드는 "이미지 서버 URL"로 라벨 변경

### 10-2. IPC 구조 유지

현재 아키텍처에서 렌더러는 직접 네트워크 호출하지 않고 IPC 경유.
Supabase 클라이언트도 **메인 프로세스**에서 생성하고, 렌더러는 IPC로 요청.

```
렌더러 → IPC → 메인(supabase.ts) → Supabase API
                메인(realtime.ts) → WebSocket → IPC → 렌더러
```

이 구조를 변경하지 말 것. 렌더러에서 직접 `@supabase/supabase-js`를 import하면 안 됨.

### 10-3. 낙관적 업데이트 패턴 유지

Supabase 전환 후에도 낙관적 업데이트 패턴은 유지:
1. Zustand에 즉시 반영
2. Supabase에 비동기 요청
3. 실패 시 롤백

다만 `syncInBackground()` (full reload)는 제거하고, 실패 시 **해당 필드만 롤백**하는 세밀한 롤백으로 교체.

### 10-4. Realtime 재연결 핸들링

Supabase JS 클라이언트가 자동 재연결을 처리하지만, 장시간 끊김 후 재연결 시 놓친 이벤트가 있을 수 있다.

```
재연결 시:
  1. 연결 상태 변경 → 렌더러에 알림 (UI에 "재연결 중..." 표시)
  2. 재연결 성공 → full reload 1회 실행 (놓친 변경 보정)
  3. 재연결 성공 → 렌더러에 알림 (UI 정상 표시)
```

### 10-5. 배치 작업 전환

현재 GAS 배치 엔드포인트(`gasBatch`)는 Supabase에서 불필요.
Supabase는 여러 INSERT/UPDATE를 하나의 요청으로 보낼 수 있다:

```typescript
// 에피소드 + 파트 동시 생성
const { data: episode } = await supabase.from('episodes').insert({ episode_number: 4 }).select().single();
const { data: parts } = await supabase.from('parts').insert([
  { episode_id: episode.id, part_id: 'A', department: 'bg' },
  { episode_id: episode.id, part_id: 'A', department: 'acting' },
]).select();
```

원자성이 필요한 경우 Supabase의 `rpc()` (PostgreSQL 함수)를 사용:

```sql
CREATE OR REPLACE FUNCTION add_episode_with_parts(
  p_episode_number INTEGER,
  p_part_ids TEXT[],
  p_departments TEXT[]
) RETURNS VOID AS $$
BEGIN
  INSERT INTO episodes (episode_number) VALUES (p_episode_number);
  -- ... parts INSERT
END;
$$ LANGUAGE plpgsql;
```

### 10-6. 빌드 검증 필수

코드 변경 후 반드시:
```bash
npx tsc --noEmit    # 타입 체크
npx vite build      # 빌드 확인
```

이 두 명령이 에러 없이 통과해야 한다. CLAUDE.md의 필수 규칙.

---

## 11. 파일별 변경 체크리스트

구현 세션에서 아래 체크리스트를 순서대로 따를 것.

```
[ ] package.json: @supabase/supabase-js 설치
[ ] electron/supabase.ts: 생성 — 클라이언트 + CRUD
[ ] electron/realtime.ts: 생성 — 구독 관리
[ ] electron/drive-image.ts: sheets.ts에서 이미지 관련 코드 추출
[ ] electron/preload.ts: supabase 관련 IPC 메서드 추가
[ ] electron/main.ts: supabase IPC 핸들러 + Realtime 설정
[ ] src/services/supabaseService.ts: 생성 — IPC 래퍼
[ ] src/services/commentService.ts: Supabase 호출로 교체
[ ] src/types/index.ts: Supabase 관련 타입 추가, 시트 관련 타입 제거
[ ] src/stores/useAppStore.ts: sheetsConnected → supabaseConnected
[ ] src/stores/useDataStore.ts: Realtime 부분 갱신 액션 추가
[ ] src/App.tsx: 초기 로딩 + Realtime 리스너 교체
[ ] src/views/ScenesView.tsx: 전면 교체 (가장 큰 작업)
[ ] src/views/WidgetPopup.tsx: emergency poll 제거, Realtime 추가
[ ] src/views/SettingsView.tsx: Sheets 설정 → Supabase 상태 표시
[ ] src/views/EpisodeView.tsx: sheets 참조 제거
[ ] src/views/Dashboard.tsx: sheets 참조 있으면 제거
[ ] src/config.ts: URL 상수 정리
[ ] 테스트 모드 관련 전부 삭제 (testSheetService.ts, test-data/, --test-mode)
[ ] electron/sheets.ts: 삭제 (이미지 분리 후)
[ ] electron/gas-fetch.ts: 이미지 업로드용으로만 축소 또는 삭제
[ ] src/services/sheetsService.ts: 삭제
[ ] tsc --noEmit 통과
[ ] vite build 통과
```

---

## 12. Supabase 무료 플랜 제한 사항

구현 시 인지해야 할 제한:

| 항목 | 제한 | 20명 팀 예상 사용량 | 여유도 |
|------|------|-------------------|--------|
| DB 용량 | 500MB | ~10-50MB (텍스트 데이터) | 충분 |
| Realtime 동시 연결 | 200 | 20명 × 1~2창 = 20~40 | 충분 |
| API 요청 | 무제한 (공정 사용) | 문제 없음 | 충분 |
| Edge Functions | 500K/월 | 사용 안 함 | 해당 없음 |
| Storage | 1GB | 사용 안 함 (이미지는 Drive) | 해당 없음 |
| 프로젝트 일시정지 | **7일 미사용 시** | 매일 사용 | **주의: 긴 연휴 시 정지될 수 있음** |

> **중요**: 무료 플랜은 7일간 API 요청이 없으면 프로젝트가 자동 일시정지됨.
> 대응: 간단한 keep-alive 요청을 주기적으로 보내거나, 연휴 전에 수동으로 앱을 한 번 실행.

---

*이 문서는 구현 세션이 독립적으로 작업할 수 있도록 작성되었다.*
*모호한 부분은 섹션 9(인증)에 명시했으며, 구현 전 한솔님과 확인 후 진행할 것.*
*문서 버전: 2026-03-13 v1.0*
