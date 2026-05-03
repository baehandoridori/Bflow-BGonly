# 리비전 기능 전면 재설계 — 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B flow 리비전 기능을 등록·진행·완료의 양방향 협업 흐름과 씬 댓글 통합까지 완성한다.

**Architecture:** Supabase 단일 경로 유지 (IPC → 메인 → Supabase). 알림은 `comp_revisions`/`comments` Realtime 변경 감지 → 각 클라이언트가 `notify_user_ids`에 본인 포함 여부 판단 후 자체 발송 (Push 서버 불필요). 댓글은 단일 `comments` 테이블 + `revision_id` 외래키로 일반 씬 댓글과 리비전 댓글을 통합. CSS 변수 `--color-accent`로 모든 강조 색이 테마 변경에 자동 반응.

**Tech Stack:** TypeScript / React 18 / Electron / Supabase (PostgreSQL + Realtime + Storage) / Zustand / Tailwind CSS / Lucide icons / framer-motion.

**Spec:** [docs/superpowers/specs/2026-05-03-revision-feature-design.md](../specs/2026-05-03-revision-feature-design.md)

---

## 작업 원칙 (B flow 환경 특수)

- **테스트 환경**: 단위 테스트 프레임워크 거의 없음. 각 Task의 검증은 (1) `tsc --noEmit` 통과 + `vite build` 통과 (2) 명시된 수동 시나리오 통과로 갈음.
- **낙관적 업데이트 패턴**: 데이터 변경은 즉시 UI 반영 → Supabase 동기화 → 실패 시 롤백 (CLAUDE.md).
- **커밋 메시지**: 한국어로 작성. 구조 `[v1.18.0-step-N] 변경 요약`.
- **Bflow 원본 레포 절대 수정 금지** (참고 전용).
- **CSS 변수만 사용**: 강조 색은 `rgb(var(--color-accent) / <alpha>)` 또는 Tailwind `text-accent`/`bg-accent`. hex 하드코딩 금지 (긴급/위험 색만 예외 — 본 기능은 우선순위 제거되었으니 빨강 사용 없음).

---

## 파일 구조 — 신규/수정 맵

### 신규 파일
- `DEVLOG/2026-05-03-revision-redesign-migration.sql` — 마이그레이션 SQL
- `src/utils/revisionRecipients.ts` — 자동 체크 대상 계산 헬퍼
- `src/components/settings/CompositorSection.tsx` — 어드민 컴포지터 지정 화면
- `src/components/scenes/RevisionCommentBadge.tsx` — `[re#]` 배지 컴포넌트 (재사용)
- `src/components/scenes/RevisionRecipientPicker.tsx` — 알림 받을 사람 칩 + 검색 (재사용)

### 수정 파일
| 파일 | 핵심 변경 |
|---|---|
| `src/types/index.ts` | `CompRevision.notifyUserIds`, `User.compositorDept`, `Comment.revisionId` 추가 |
| `src/stores/useNotificationStore.ts` | `'revision'` 타입 + 메타 |
| `src/stores/useRevisionStore.ts` | `notifyUserIds` 처리, Realtime 알림 자체 발송 로직 |
| `src/services/revisionService.ts` | `notifyUserIds` 인자, `addRevision`/`updateRevision` 시그니처 |
| `src/services/commentService.ts` | `revisionId` 필드, `addCommentForRevision()` |
| `src/services/userService.ts` | `compositorDept` 필드 처리, `setCompositorDept()` |
| `src/components/scenes/RevisionPanel.tsx` | 등록 폼 + 카드 전면 재설계 (우선순위/부서/프레임 제거 + re# + 알림 대상 + 댓글 스레드) |
| `src/components/scenes/CommentPanel.tsx` | `[re#]` 배지 표시 + 클릭 핸들러 + "re만" 필터 |
| `src/components/scenes/UnifiedSceneCard.tsx` | 카드에 리비전 시각 표시 (좌측 막대 + 우측 배지) |
| `src/components/scenes/UnifiedSceneSheetView.tsx` | 행 좌측 막대 + 셀 배지 |
| `src/components/scenes/UnifiedSceneDetailModal.tsx` | re# 배지 클릭 라우팅 (탭 전환 + 스크롤 + 강조) |
| `src/components/NotificationPanel.tsx` | `'revision'` 타입 분기 + 클릭 → 모달 라우팅 |
| `src/components/widgets/activity/constants.ts` | `revision_comment` 라벨/색 추가 |
| `src/constants/revision.ts` | `revisionNoToLabel(n)` 헬퍼 (`re${n}`), 우선순위 상수 deprecate |
| `electron/preload.ts` | `notifyUserIds` 인자 추가, `addCommentForRevision` 신규 |
| `electron/main.ts` | IPC 핸들러 시그니처 업데이트 |
| `electron/supabase.ts` | `notifyUserIds`/`revisionId` 컬럼 처리 |

---

## Chunk 1: DB 마이그레이션 + 타입 변경

### Task 1: 마이그레이션 SQL 작성

**Files:**
- Create: `DEVLOG/2026-05-03-revision-redesign-migration.sql`

- [ ] **Step 1: SQL 파일 작성**

```sql
-- 리비전 기능 전면 재설계 마이그레이션
-- 작성일: 2026-05-03
-- 멱등(IF NOT EXISTS) — 재실행 안전

-- 1. comments.revision_id (리비전 ↔ 댓글 단일 흐름 통합)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS revision_id TEXT NULL
  REFERENCES comp_revisions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_comments_revision_id
  ON comments(revision_id) WHERE revision_id IS NOT NULL;

-- 2. users.compositor_dept (부서별 컴포지터 지정)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS compositor_dept TEXT NULL
  CHECK (compositor_dept IN ('BG','ACT'));
CREATE INDEX IF NOT EXISTS idx_users_compositor_dept
  ON users(compositor_dept) WHERE compositor_dept IS NOT NULL;

-- 3. comp_revisions.notify_user_ids (알림 받을 사람 목록)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS notify_user_ids JSONB DEFAULT '[]'::jsonb;

-- 4. comments.scene_uuid (init.sql 누락 보강)
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 5. comp_revisions.scene_uuid (init.sql 누락 보강)
ALTER TABLE comp_revisions
  ADD COLUMN IF NOT EXISTS scene_uuid UUID NULL;

-- 6. 레거시 백필: 기존 리비전의 notify_user_ids에 등록자 포함
UPDATE comp_revisions
  SET notify_user_ids = jsonb_build_array(requester_id)
  WHERE notify_user_ids = '[]'::jsonb
    AND requester_id IS NOT NULL
    AND requester_id <> '';
```

- [ ] **Step 2: Supabase Studio에서 실행 (수동)**

한솔님이 Supabase 대시보드에 접속해서 SQL Editor에 붙여넣고 실행. 실행 결과: 5개 ALTER + 2개 CREATE INDEX + 1개 UPDATE 모두 OK.

- [ ] **Step 3: 컬럼 추가 확인 쿼리**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('comments', 'users', 'comp_revisions')
  AND column_name IN ('revision_id','compositor_dept','notify_user_ids','scene_uuid')
ORDER BY table_name, column_name;
```

기대 결과: 7개 행 (comments.revision_id, comments.scene_uuid, comp_revisions.notify_user_ids, comp_revisions.scene_uuid, users.compositor_dept). scene_uuid는 이미 ad-hoc 추가되어 있어 일부 중복일 수 있음 — 정상.

- [ ] **Step 4: 커밋**

```bash
git add DEVLOG/2026-05-03-revision-redesign-migration.sql
git commit -m "[v1.18.0-step-1] 리비전 재설계 DB 마이그레이션 SQL 추가"
```

---

### Task 2: TypeScript 타입 업데이트

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: CompRevision 타입에 notifyUserIds 추가**

`src/types/index.ts`의 `CompRevision` 인터페이스 찾기. 다음 필드 추가:

```ts
export interface CompRevision {
  // ... 기존 필드 유지
  notifyUserIds: string[];  // 알림 받을 사람 user.id 배열
}
```

- [ ] **Step 2: User 타입에 compositorDept 추가**

`User` 인터페이스에 추가:

```ts
export interface User {
  // ... 기존 필드 유지
  compositorDept?: 'BG' | 'ACT' | null;  // 부서별 컴포지터 표시
}
```

- [ ] **Step 3: Comment 타입에 revisionId 추가**

`Comment` 또는 `SceneComment` 인터페이스 찾아 추가:

```ts
export interface SceneComment {
  // ... 기존 필드 유지
  revisionId?: string | null;  // null/undefined = 일반 씬 댓글, 값 있음 = 리비전 맥락 댓글
}
```

- [ ] **Step 4: 타입 검증**

```bash
npx tsc --noEmit
```

기대: 타입 에러는 새 필드를 사용하지 않는 곳에서는 발생하지 않음. 새 필드를 사용해야 할 곳들이 미구현이면 후속 Task에서 채움. 이 단계에서는 컴파일만 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/types/index.ts
git commit -m "[v1.18.0-step-2] 리비전 재설계 타입 정의 (notifyUserIds, compositorDept, revisionId)"
```

---

### Task 3: NotificationType 확장 + revision 메타

**Files:**
- Modify: `src/stores/useNotificationStore.ts`

- [ ] **Step 1: NotificationType 확장**

```ts
export type NotificationType =
  | 'scene_change'
  | 'comment'
  | 'milestone'
  | 'system'
  | 'revision';  // 신규
```

- [ ] **Step 2: AppNotification.metadata 확장**

```ts
export interface AppNotificationMetadata {
  // ... 기존 필드
  revisionId?: string;
  revisionAction?: 'add' | 'in_progress' | 'resolve' | 'comment';
}
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/stores/useNotificationStore.ts
git commit -m "[v1.18.0-step-3] NotificationType에 'revision' 추가"
```

---

### Task 4: revision.ts 상수 — re# 라벨 헬퍼

**Files:**
- Modify: `src/constants/revision.ts`

- [ ] **Step 1: revisionNoToLabel 헬퍼 추가**

```ts
/**
 * 리비전 번호를 라벨로 변환. 1 → "re1", 2 → "re2", ...
 * 씬 모달, 카드, [re#] 배지, 알림 라벨 등 모든 표시에서 사용.
 */
export function revisionNoToLabel(n: number): string {
  return `re${n}`;
}
```

- [ ] **Step 2: 우선순위 상수에 deprecation 주석 추가**

PRIORITY_CONFIG 정의 위에 추가:

```ts
/**
 * @deprecated v1.18.0부터 우선순위 입력 UI 제거됨.
 * 기존 데이터 표시 호환성을 위해 상수만 유지. 신규 등록 시 항상 'normal'.
 */
export const PRIORITY_CONFIG = { /* 기존 그대로 */ };
```

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/constants/revision.ts
git commit -m "[v1.18.0-step-4] revisionNoToLabel 헬퍼 + 우선순위 deprecate 표시"
```

---

## Chunk 2: 컴포지터 헬퍼 + 알림 시스템

### Task 5: revisionRecipients 헬퍼 작성

**Files:**
- Create: `src/utils/revisionRecipients.ts`

- [ ] **Step 1: 헬퍼 작성**

```ts
import type { User, Scene, MergedScene } from '@/types';

/**
 * 새 리비전의 자동 알림 대상자 ID 목록을 계산한다.
 *
 * 규칙:
 *   - 해당 부서 컴포지터(들) (users.compositor_dept === dept)
 *   - 해당 씬의 모든 단계 담당자 (LO/완료/검수/PNG)
 *   - 등록자 본인은 제외
 *   - 중복 제거
 *
 * @param dept 'BG' 또는 'ACT'
 * @param scene 씬 객체 (담당자 정보 포함)
 * @param allUsers 전체 사용자 목록
 * @param excludeUserId 제외할 사용자 (보통 등록자 본인)
 */
export function calcDefaultRecipients(
  dept: 'BG' | 'ACT',
  scene: Pick<Scene | MergedScene, 'assignees' | 'bgAssignees' | 'actAssignees'>,
  allUsers: User[],
  excludeUserId: string,
): string[] {
  const compositors = allUsers
    .filter(u => u.compositorDept === dept)
    .map(u => u.id);

  // 씬 담당자 (부서별로 다른 필드일 수 있음 — 통합 모달 / 단일 모달 모두 대응)
  const sceneAssignees = (() => {
    const collected: string[] = [];
    if ('assignees' in scene && Array.isArray(scene.assignees)) {
      collected.push(...scene.assignees);
    }
    if (dept === 'BG' && 'bgAssignees' in scene && Array.isArray(scene.bgAssignees)) {
      collected.push(...scene.bgAssignees);
    }
    if (dept === 'ACT' && 'actAssignees' in scene && Array.isArray(scene.actAssignees)) {
      collected.push(...scene.actAssignees);
    }
    // assignee 단일 필드 호환
    return collected;
  })();

  const merged = [...new Set([...compositors, ...sceneAssignees])];
  return merged.filter(id => id && id !== excludeUserId);
}

/**
 * 부서별 컴포지터 사용자 목록 (어드민 설정 화면 등에서 사용).
 */
export function findCompositorsForDept(
  dept: 'BG' | 'ACT',
  allUsers: User[],
): User[] {
  return allUsers.filter(u => u.compositorDept === dept);
}
```

> 참고: 위 코드의 `scene` 파라미터 필드명은 실제 `Scene`/`MergedScene` 타입을 확인 후 미세 조정 필요. 핵심은 "씬에 등록된 모든 담당자 user.id 목록"을 뽑아내는 것.

- [ ] **Step 2: 타입 검증**

```bash
npx tsc --noEmit
```

타입 에러 발생 시 `Scene`/`MergedScene` 실제 필드명 확인 후 수정.

- [ ] **Step 3: 커밋**

```bash
git add src/utils/revisionRecipients.ts
git commit -m "[v1.18.0-step-5] 알림 자동 대상자 계산 헬퍼 추가"
```

---

### Task 6: useRevisionStore 알림 자체 발송 로직

**Files:**
- Modify: `src/stores/useRevisionStore.ts`

- [ ] **Step 1: Realtime 변경 감지에서 본인이 알림 대상이면 addNotification 호출**

기존 Realtime 콜백(`bflow:revisions-invalidated` 이벤트 핸들러 또는 `onRevisionChange`) 위치 찾기. 변경된 리비전 데이터 + 변경 종류(add/update/delete)를 받을 수 있도록 시그니처 확장.

새 리비전 등록 또는 상태 변경 감지 시:

```ts
import { useNotificationStore } from './useNotificationStore';
import { useUserStore } from './useUserStore'; // 또는 현재 사용자 가져오는 store
import { revisionNoToLabel } from '@/constants/revision';

function handleRevisionRealtimeChange(
  payload: { eventType: 'INSERT'|'UPDATE'|'DELETE'; new?: CompRevision; old?: CompRevision }
) {
  const currentUser = useUserStore.getState().currentUser;
  if (!currentUser) return;

  const rev = payload.new || payload.old;
  if (!rev) return;

  // 알림 대상 판단
  const recipients = rev.notifyUserIds || [];
  if (!recipients.includes(currentUser.id)) return;

  // 본인이 한 액션이면 본인에게는 안 보냄
  // (액션 수행자 정보는 활동 로그 또는 last-modified-by로 판단)
  // 여기서는 단순히 'updatedBy === currentUser.id'면 스킵
  // (해당 필드가 없으면 requester_id 등으로 보수적으로 판단)

  let action: 'add' | 'in_progress' | 'resolve' | 'comment' | null = null;
  let title = '';

  if (payload.eventType === 'INSERT') {
    action = 'add';
    title = `새 리비전 — ${rev.sceneLabel || rev.sceneId}`;
    // 등록자 본인이면 스킵
    if (rev.requesterId === currentUser.id) return;
  } else if (payload.eventType === 'UPDATE') {
    const oldStatus = payload.old?.status;
    const newStatus = payload.new?.status;
    if (oldStatus === newStatus) return;
    if (newStatus === 'in_progress') {
      action = 'in_progress';
      title = `리비전 진행중 — ${rev.sceneLabel || rev.sceneId}`;
    } else if (newStatus === 'resolved') {
      action = 'resolve';
      title = `리비전 완료 — ${rev.sceneLabel || rev.sceneId}`;
    }
  }

  if (!action) return;

  useNotificationStore.getState().addNotification({
    type: 'revision',
    title,
    body: `${revisionNoToLabel(rev.revisionNo)} · ${rev.description?.slice(0, 60) || ''}`,
    metadata: {
      episodeId: rev.episodeId,
      partId: rev.partId,
      sceneId: rev.sceneId,
      sceneName: rev.sceneLabel,
      revisionId: rev.id,
      revisionAction: action,
    },
  });
}
```

- [ ] **Step 2: createRevision 시그니처에 notifyUserIds 추가**

```ts
async createRevision(input: {
  sceneKey: string;
  description: string;
  imageUrl?: string;
  notifyUserIds: string[];   // 신규
  // priority/frameNo/department/assignee는 더 이상 받지 않음 (자동값으로 대체)
}) {
  // 낙관적 업데이트 → IPC → Supabase
  const id = generateId();
  const newRev: CompRevision = {
    id,
    revisionNo: nextRevisionNoForScene(input.sceneKey),
    status: 'open',
    priority: 'normal',         // 자동값 (폼에서 안 받음)
    frameNo: '',                // 자동값
    department: inferDepartmentFromSceneKey(input.sceneKey),  // 자동 추론
    description: input.description,
    imageUrl: input.imageUrl,
    notifyUserIds: input.notifyUserIds,
    requesterId: currentUser.id,
    requesterName: currentUser.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // ...
  };

  // 낙관적 추가
  set(state => ({ revisions: [...state.revisions, newRev] }));

  try {
    await window.electronAPI.supabaseAddRevision(/* ... */);
  } catch (err) {
    // 롤백
    set(state => ({ revisions: state.revisions.filter(r => r.id !== id) }));
    throw err;
  }
}
```

- [ ] **Step 3: 빌드**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/stores/useRevisionStore.ts
git commit -m "[v1.18.0-step-6] 리비전 변경 Realtime → 자체 알림 발송 + createRevision에 notifyUserIds"
```

---

### Task 7: revisionService + IPC 시그니처 업데이트

**Files:**
- Modify: `src/services/revisionService.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `electron/supabase.ts`

- [ ] **Step 1: revisionService.ts — createRevision 인자 변경**

기존 `createRevision({description, priority, frameNo, imageUrl, department, ...})` 시그니처를:

```ts
export async function createRevision(input: {
  sceneKey: string;
  description: string;
  imageUrl?: string;
  notifyUserIds: string[];
  // 자동값
  priority?: 'normal' | 'high' | 'urgent';  // 기본 'normal' (호환용)
}) {
  // ...
  return window.electronAPI.supabaseAddRevision(
    id, partUuid, sceneId, revisionNo,
    'open',                                  // status
    input.priority || 'normal',              // 항상 normal
    input.description,
    '',                                       // frameNo (빈 값)
    input.imageUrl || '',
    inferDepartmentFromSceneKey(input.sceneKey),  // department 자동
    inferDepartmentFromSceneKey(input.sceneKey),  // lookupDepartment
    currentUser.id, currentUser.name,
    '',                                       // assignee (deprecated, 사용 안 함)
    new Date().toISOString(),
    JSON.stringify(input.notifyUserIds),     // notifyUserIds JSONB (신규 마지막 인자)
  );
}
```

- [ ] **Step 2: electron/preload.ts — supabaseAddRevision 인자 추가**

기존 15개 positional args 마지막에 `notifyUserIdsJson` 추가:

```ts
supabaseAddRevision: (
  id: string, partUuid: string, sceneId: string, revisionNo: number,
  status: string, priority: string, description: string, frameNo: string,
  imageUrl: string, department: string, lookupDepartment: string,
  requesterId: string, requesterName: string, assignee: string, createdAt: string,
  notifyUserIdsJson: string,  // 신규
) => ipcRenderer.invoke('supabase:add-revision',
  id, partUuid, sceneId, revisionNo, status, priority, description, frameNo,
  imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt,
  notifyUserIdsJson,
),
```

- [ ] **Step 3: electron/main.ts — IPC 핸들러 시그니처 업데이트**

`ipcMain.handle('supabase:add-revision', async (_e, ...args) => { ... })` 부분에서 마지막 인자 `notifyUserIdsJson`를 받아 supabase.ts 함수에 전달.

- [ ] **Step 4: electron/supabase.ts — addRevision 함수에 notify_user_ids 컬럼 INSERT**

```ts
export async function addRevision(/* ... */ notifyUserIdsJson: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('comp_revisions').insert({
    id, part_id: partUuid, scene_id: sceneId, revision_no: revisionNo,
    status, priority, description, frame_no: frameNo,
    image_url: imageUrl, department, requester_id: requesterId,
    requester_name: requesterName, assignee,
    notify_user_ids: JSON.parse(notifyUserIdsJson),  // 신규
    created_at: createdAt, updated_at: createdAt,
  }).select().single();
  // ...
}
```

- [ ] **Step 5: 빌드 + 동작 확인**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: 커밋**

```bash
git add src/services/revisionService.ts electron/preload.ts electron/main.ts electron/supabase.ts
git commit -m "[v1.18.0-step-7] addRevision IPC에 notifyUserIds 전달 + 자동값(우선순위/부서/프레임) 처리"
```

---

### Task 8: NotificationPanel — 'revision' 타입 분기 + 클릭 라우팅

**Files:**
- Modify: `src/components/NotificationPanel.tsx`

- [ ] **Step 1: 타입별 아이콘/색 매핑에 'revision' 추가**

기존 NOTIFICATION_TYPE_CONFIG (또는 비슷한 매핑) 위치 찾기:

```ts
import { MessageSquareWarning } from 'lucide-react';

const NOTIFICATION_TYPE_CONFIG = {
  // ... 기존
  revision: {
    icon: MessageSquareWarning,
    color: 'rgb(var(--color-accent))',         // 테마 액센트 색
    bg: 'rgb(var(--color-accent) / 0.15)',
    label: '리비전',
  },
};
```

- [ ] **Step 2: 알림 클릭 → 모달 열기 + 라우팅 핸들러**

기존 알림 클릭 핸들러에 `'revision'` 타입 분기 추가:

```ts
function handleNotificationClick(notif: AppNotification) {
  if (notif.type === 'revision' && notif.metadata?.sceneId && notif.metadata?.revisionId) {
    // 1) 씬 모달 열기 (기존 패턴 재사용 — useSceneModalStore 등)
    openSceneModal({
      episodeId: notif.metadata.episodeId,
      partId: notif.metadata.partId,
      sceneId: notif.metadata.sceneId,
      // 신규 옵션
      initialTab: 'revisions',
      focusRevisionId: notif.metadata.revisionId,
    });
    markAsRead(notif.id);
    return;
  }
  // ... 기존 분기
}
```

> `openSceneModal` 또는 동등 함수에 `initialTab` + `focusRevisionId` 파라미터를 추가해야 함. 다음 Task에서 처리.

- [ ] **Step 3: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/NotificationPanel.tsx
git commit -m "[v1.18.0-step-8] 알림 패널에 'revision' 타입 분기 + 모달 라우팅"
```

---

### Task 9: UnifiedSceneDetailModal — focusRevisionId 처리

**Files:**
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`

- [ ] **Step 1: 모달 props에 initialTab + focusRevisionId 추가**

```ts
interface UnifiedSceneDetailModalProps {
  // ... 기존
  initialTab?: TabKey;
  focusRevisionId?: string;
}
```

- [ ] **Step 2: 모달 마운트 시 initialTab/focusRevisionId 처리**

`useEffect` 추가:

```ts
useEffect(() => {
  if (initialTab) setActiveTab(initialTab);
}, [initialTab]);

useEffect(() => {
  if (focusRevisionId && activeTab === 'revisions') {
    // 카드 마운트 후 스크롤 + 강조
    requestAnimationFrame(() => {
      const card = document.getElementById(`rev-card-${focusRevisionId}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('rev-pulse');
        void card.offsetWidth;  // reflow
        card.classList.add('rev-pulse');
        // 카드 댓글 스레드 자동 펼침 (다음 Chunk에서 컨트롤)
        const expandEvent = new CustomEvent('bflow:expand-revision', { detail: { revisionId: focusRevisionId } });
        window.dispatchEvent(expandEvent);
      }
    });
  }
}, [focusRevisionId, activeTab]);
```

- [ ] **Step 3: rev-pulse 클래스 정의 (전역 CSS)**

`src/index.css` 또는 적절한 전역 CSS 파일에:

```css
@keyframes rev-pulse-anim {
  0%, 100% {
    box-shadow:
      0 0 0 0 rgb(var(--color-accent) / 0.55),
      0 0 0 1px rgb(var(--color-accent) / 0.18),
      0 6px 14px rgb(var(--color-accent) / 0.10);
  }
  50% {
    box-shadow:
      0 0 0 4px rgb(var(--color-accent) / 0.45),
      0 0 0 1px rgb(var(--color-accent) / 0.7),
      0 6px 14px rgb(var(--color-accent) / 0.25);
  }
}
.rev-pulse { animation: rev-pulse-anim 1.2s ease-in-out 2; }
```

- [ ] **Step 4: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/scenes/UnifiedSceneDetailModal.tsx src/index.css
git commit -m "[v1.18.0-step-9] 씬 모달에 focusRevisionId 라우팅 + 강조 애니메이션"
```

---

## Chunk 3: 등록 폼 + 리비전 카드 재설계

### Task 10: RevisionRecipientPicker 컴포넌트 (재사용)

**Files:**
- Create: `src/components/scenes/RevisionRecipientPicker.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useState, useMemo } from 'react';
import { Plus, Check } from 'lucide-react';
import type { User } from '@/types';

interface Props {
  allUsers: User[];
  defaultCheckedIds: string[];   // 자동 체크된 사람들 (컴포지터 + 담당자 - 본인)
  excludeUserId: string;          // 등록자 본인 (목록에서도 숨김)
  onChange: (checkedIds: string[]) => void;
}

export function RevisionRecipientPicker({ allUsers, defaultCheckedIds, excludeUserId, onChange }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set(defaultCheckedIds));
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  // defaultCheckedIds + 추가로 체크된 사람을 union으로 표시
  const visibleIds = useMemo(() => {
    const union = new Set([...defaultCheckedIds, ...Array.from(checked)]);
    return Array.from(union).filter(id => id !== excludeUserId);
  }, [defaultCheckedIds, checked, excludeUserId]);

  const visibleUsers = useMemo(
    () => visibleIds.map(id => allUsers.find(u => u.id === id)).filter((u): u is User => !!u),
    [visibleIds, allUsers],
  );

  const searchableUsers = useMemo(() => {
    return allUsers
      .filter(u => u.id !== excludeUserId && !visibleIds.includes(u.id))
      .filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase()));
  }, [allUsers, excludeUserId, visibleIds, query]);

  function toggle(id: string) {
    const next = new Set(checked);
    if (defaultCheckedIds.includes(id)) {
      // 자동 체크된 사람도 해제 가능
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // 자동 체크된 사람의 경우 toggle 의미: 해제 시 명시적 unchecked 표시 필요
      // 단순화: defaultCheckedIds 항목은 항상 visible, 체크 상태는 별도 trackingunchecked Set
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    setChecked(next);
    onChange(Array.from(next));
  }

  function addRecipient(userId: string) {
    const next = new Set(checked);
    next.add(userId);
    setChecked(next);
    onChange(Array.from(next));
    setQuery('');
    setSearchOpen(false);
  }

  function isChecked(id: string): boolean {
    if (defaultCheckedIds.includes(id)) {
      // 사용자가 명시적으로 unchecked 한 경우만 false
      return checked.has(id) || !checked.has(`__uncheck:${id}`);
    }
    return checked.has(id);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleUsers.map(u => {
          const cked = isChecked(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-colors ${
                cked
                  ? 'bg-accent/15 border-accent/60 text-text-primary'
                  : 'border-bg-border/50 text-text-secondary hover:border-accent/40'
              }`}
            >
              <span
                className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: avatarColor(u.id) }}
              >
                {u.name.charAt(0)}
              </span>
              {u.name}
              {u.compositorDept && (
                <span className="text-[10px] text-text-secondary/60">{u.compositorDept} 컴포지터</span>
              )}
              {cked && (
                <span className="w-3.5 h-3.5 rounded-full bg-accent text-white inline-flex items-center justify-center">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setSearchOpen(!searchOpen)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-bg-border text-[12px] text-text-secondary hover:text-text-primary hover:border-accent/40"
        >
          <Plus className="w-3 h-3" strokeWidth={2.5} />
          다른 사람 추가
        </button>
      </div>

      {searchOpen && (
        <div className="mt-2 bg-bg-card border border-bg-border/60 rounded-lg p-2 max-w-md">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이름으로 검색..."
            className="w-full px-2 py-1.5 mb-1.5 bg-bg-primary/80 border border-bg-border/60 rounded text-[12px] focus:outline-none focus:border-accent/60"
            autoFocus
          />
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {searchableUsers.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => addRecipient(u.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-primary text-left"
              >
                <span
                  className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: avatarColor(u.id) }}
                >
                  {u.name.charAt(0)}
                </span>
                <span className="text-[12px] text-text-primary">{u.name}</span>
                {u.compositorDept && (
                  <span className="text-[10px] text-text-secondary/50">{u.compositorDept} 컴포지터</span>
                )}
              </button>
            ))}
            {searchableUsers.length === 0 && (
              <div className="text-[11px] text-text-secondary/50 px-2 py-1">검색 결과 없음</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 사용자 ID로부터 일관된 아바타 색 생성
function avatarColor(id: string): string {
  const colors = ['#6C5CE7', '#74B9FF', '#FDCB6E', '#E17055', '#A29BFE', '#00B894', '#FF6B6B', '#F9A8D4'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}
```

- [ ] **Step 2: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/scenes/RevisionRecipientPicker.tsx
git commit -m "[v1.18.0-step-10] RevisionRecipientPicker 컴포넌트 신규"
```

---

### Task 11: RevisionPanel 등록 폼 재설계

**Files:**
- Modify: `src/components/scenes/RevisionPanel.tsx` (lines 423-551 영역)

- [ ] **Step 1: 등록 폼 영역 — 우선순위/프레임번호 UI 제거**

기존 lines 437-459(우선순위 토글 + 프레임번호 input) 부분을 삭제. 부서 표시는 원래도 입력 UI 없으니 그대로.

- [ ] **Step 2: state 정리 + RevisionRecipientPicker 추가**

```tsx
import { RevisionRecipientPicker } from './RevisionRecipientPicker';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { useUserStore } from '@/stores/useUserStore';

// 컴포넌트 내부
const allUsers = useUserStore(s => s.users);
const currentUser = useUserStore(s => s.currentUser);
const [notifyIds, setNotifyIds] = useState<string[]>([]);

const defaultRecipients = useMemo(() => {
  if (!currentUser) return [];
  return calcDefaultRecipients(
    effectiveDepartment as 'BG' | 'ACT',
    scene,                  // 씬 객체
    allUsers,
    currentUser.id,
  );
}, [effectiveDepartment, scene, allUsers, currentUser]);

useEffect(() => {
  setNotifyIds(defaultRecipients);
}, [defaultRecipients]);

// 기존 priority/frameNo state 삭제
// const [priority, setPriority] = useState<RevisionPriority>('normal');  // 삭제
// const [frameNo, setFrameNo] = useState('');                              // 삭제
```

- [ ] **Step 3: 폼 마크업 — 본문 + 이미지 + 알림 받을 사람만**

기존 폼 마크업을 다음 구조로 교체:

```tsx
{showForm && (
  <motion.div /* ... */>
    <div className="bg-bg-primary/50 border border-accent/40 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquareWarning className="w-4 h-4 text-accent" />
          <span className="text-[13px] font-bold text-text-primary">새 리비전 등록</span>
        </div>
        <button onClick={() => setShowForm(false)} className="text-text-secondary hover:text-text-primary">×</button>
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
          내용 <span className="text-accent">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="어떤 부분을 수정해야 하는지, 또는 무엇이 변경되었는지 적어주세요."
          className="w-full min-h-[88px] p-2.5 bg-bg-primary/80 border border-bg-border/60 rounded-lg text-[13px] focus:outline-none focus:border-accent/60 resize-y"
        />
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
          이미지 첨부 (선택)
        </label>
        {/* 기존 이미지 첨부 UI 유지 */}
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
          알림 받을 사람 <span className="text-text-secondary/50 font-normal normal-case">— 컴포지터 + 그 씬 담당자 자동 체크 (클릭으로 토글)</span>
        </label>
        <RevisionRecipientPicker
          allUsers={allUsers}
          defaultCheckedIds={defaultRecipients}
          excludeUserId={currentUser?.id || ''}
          onChange={setNotifyIds}
        />
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-bg-border/40">
        <div className="text-[11px] text-text-secondary/50">
          등록자: {currentUser?.name} · 등록 즉시 선택된 사람들에게 알림이 발송됩니다.
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary">취소</button>
          <button onClick={handleSubmit} disabled={!description.trim()} className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white disabled:opacity-50 hover:opacity-90">
            리비전 등록
          </button>
        </div>
      </div>
    </div>
  </motion.div>
)}
```

- [ ] **Step 4: handleSubmit 변경**

```ts
async function handleSubmit() {
  if (!description.trim() || !currentUser) return;
  try {
    await createRevision({
      sceneKey,
      description: description.trim(),
      imageUrl: uploadedImageUrl,
      notifyUserIds: notifyIds,
    });
    // 폼 리셋
    setDescription('');
    setUploadedImageUrl(undefined);
    setShowForm(false);
  } catch (err) {
    // 에러 처리 (기존 toast 패턴 유지)
  }
}
```

- [ ] **Step 5: 빌드 + 동작 확인**

```bash
npx tsc --noEmit
npm run dev    # Electron dev mode
```

미리보기에서 씬 모달 → 리비전 탭 → "+ 새 리비전" 클릭 → 폼이 새 디자인으로 표시되는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/components/scenes/RevisionPanel.tsx
git commit -m "[v1.18.0-step-11] 리비전 등록 폼 재설계 (우선순위/부서/프레임 제거 + 알림 대상 칩)"
```

---

### Task 12: 리비전 카드 재설계 (re# 넘버링 + 시각 강조 + 댓글 스레드)

**Files:**
- Modify: `src/components/scenes/RevisionPanel.tsx` (카드 렌더링 영역)

- [ ] **Step 1: 카드 헤더 — re# 라벨 + 우선순위/부서/프레임 배지 제거**

기존 카드 헤더(lines 144-158 부근) 변경:

```tsx
import { revisionNoToLabel } from '@/constants/revision';

// 카드 내부
<div className="rev-card relative bg-bg-card border border-bg-border/60 rounded-xl p-4"
     id={`rev-card-${rev.id}`}
     data-status={rev.status}>
  {(rev.status === 'open' || rev.status === 'in_progress') && (
    <span className="rev-side-bar" />
  )}
  {rev.status === 'resolved' && (
    <span className="rev-side-bar" style={{ background: '#00B894' }} />
  )}

  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-bold text-accent-sub">{revisionNoToLabel(rev.revisionNo)}</span>
      <StatusBadge status={rev.status} />
      {/* 우선순위/부서/프레임번호 배지 제거 */}
    </div>
    <div className="flex items-center gap-1">
      <StatusDropdown rev={rev} onChange={(next) => updateStatus(rev.id, next)} />
      {(rev.requesterId === currentUser?.id || currentUser?.role === 'admin') && (
        <button onClick={() => deleteRevision(rev.id)} className="p-1 hover:bg-bg-primary/50 rounded">⋯</button>
      )}
    </div>
  </div>

  <div className="text-[13px] text-text-primary leading-relaxed mb-2">
    {rev.description}
  </div>

  {rev.imageUrl && (
    <div className="mb-2.5">
      <img src={rev.imageUrl} className="max-h-32 rounded-lg border border-bg-border/40" alt="" />
    </div>
  )}

  <div className="text-[11px] text-text-secondary/70 flex items-center gap-2 flex-wrap">
    <span>{rev.requesterName} 등록 · {formatRelative(rev.createdAt)}</span>
    <span className="text-text-secondary/50">·</span>
    <span className="flex items-center gap-1">
      <MessageCircle className="w-3 h-3" />
      댓글 {commentCountForRevision(rev.id)}
    </span>
  </div>

  <RevisionCommentThread revisionId={rev.id} sceneKey={sceneKey} />
</div>
```

- [ ] **Step 2: rev-side-bar CSS 추가**

`src/index.css`에:

```css
.rev-side-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  border-radius: 12px 0 0 12px;
  background: rgb(var(--color-accent));
}
.rev-card[data-status="resolved"] {
  opacity: 0.7;
}
.rev-card[data-status="resolved"] .rev-card-description {
  text-decoration: line-through;
  opacity: 0.6;
}
```

- [ ] **Step 3: 빌드**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/RevisionPanel.tsx src/index.css
git commit -m "[v1.18.0-step-12] 리비전 카드 — re# 넘버링 + 시각 강조 + 우선순위/부서/프레임 표시 제거"
```

---

### Task 13: 카드 내 댓글 스레드 컴포넌트

**Files:**
- Create: `src/components/scenes/RevisionCommentThread.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useState, useEffect } from 'react';
import { useCommentStore } from '@/stores/useCommentStore';
import { useUserStore } from '@/stores/useUserStore';
import type { SceneComment } from '@/types';

interface Props {
  revisionId: string;
  sceneKey: string;
}

export function RevisionCommentThread({ revisionId, sceneKey }: Props) {
  const allComments = useCommentStore(s => s.commentsBySceneKey[sceneKey] || []);
  const comments = allComments.filter(c => c.revisionId === revisionId);
  const currentUser = useUserStore(s => s.currentUser);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    function onExpand(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.revisionId === revisionId) setExpanded(true);
    }
    window.addEventListener('bflow:expand-revision', onExpand);
    return () => window.removeEventListener('bflow:expand-revision', onExpand);
  }, [revisionId]);

  async function send() {
    if (!draft.trim() || !currentUser) return;
    await useCommentStore.getState().addComment({
      sceneKey,
      text: draft.trim(),
      revisionId,  // 핵심: 이 댓글은 해당 리비전 맥락
    });
    setDraft('');
  }

  if (!expanded) {
    return (
      <button onClick={() => setExpanded(true)} className="mt-2 text-[11px] text-accent-sub hover:underline">
        댓글 {comments.length}개 보기 ▾
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-bg-border/40 pt-3 space-y-2.5">
      {comments.map(c => (
        <CommentBubble key={c.id} comment={c} isMe={c.userId === currentUser?.id} />
      ))}
      <div className="flex gap-2 pt-1">
        <span
          className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white shrink-0"
          style={{ background: 'rgb(var(--color-accent-sub))' }}
        >
          {currentUser?.name.charAt(0) || '?'}
        </span>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`${revisionNoToLabel(revisionNoFor(revisionId))} 댓글 남기기...`}
          className="flex-1 px-3 py-1.5 bg-bg-primary/80 border border-bg-border/60 rounded text-[12px] focus:outline-none focus:border-accent/60"
        />
        <button onClick={send} disabled={!draft.trim()} className="px-3 py-1.5 text-[11px] font-bold rounded-md bg-accent text-white disabled:opacity-50">전송</button>
      </div>
    </div>
  );
}

function CommentBubble({ comment, isMe }: { comment: SceneComment; isMe: boolean }) {
  return (
    <div className={`border rounded-lg px-3 py-2 ${isMe ? 'bg-accent/[0.10] border-accent/30' : 'bg-bg-primary/60 border-bg-border/40'}`}>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] font-bold ${isMe ? 'text-accent-sub' : 'text-text-primary'}`}>
            {comment.userName}
          </span>
        </div>
        <span className="text-[10px] text-text-secondary/50">{formatRelative(comment.createdAt)}</span>
      </div>
      <div className="text-[12px] text-text-primary whitespace-pre-wrap">{comment.text}</div>
    </div>
  );
}
```

> `revisionNoFor(revisionId)`: revisionId → revisionNo 변환은 useRevisionStore에서 lookup. 헬퍼 함수 추가 필요.

- [ ] **Step 2: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/scenes/RevisionCommentThread.tsx
git commit -m "[v1.18.0-step-13] 리비전 카드 내 댓글 스레드 컴포넌트"
```

---

## Chunk 4: 댓글 통합 + 씬 카드 시각 표시

### Task 14: commentService — revisionId 필드 처리

**Files:**
- Modify: `src/services/commentService.ts`
- Modify: `src/stores/useCommentStore.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `electron/supabase.ts`

- [ ] **Step 1: SceneComment 타입 + addComment 시그니처에 revisionId 추가**

`commentService.ts`:

```ts
export interface SceneComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images?: string[];
  revisionId?: string | null;  // 신규
  createdAt: string;
  editedAt?: string;
}

export async function addComment(input: {
  sceneKey: string;
  text: string;
  mentions?: string[];
  images?: string[];
  revisionId?: string;  // 신규
}) {
  // ... 기존 로직 + revisionId IPC 전달
}
```

- [ ] **Step 2: useCommentStore.addComment에 revisionId 전달**

```ts
addComment: async (input: { sceneKey: string; text: string; revisionId?: string }) => {
  const newComment: SceneComment = {
    id: generateId(),
    userId: currentUser.id,
    userName: currentUser.name,
    text: input.text,
    mentions: [],
    images: [],
    revisionId: input.revisionId || null,
    createdAt: new Date().toISOString(),
  };
  // 낙관적 추가
  set(state => ({
    commentsBySceneKey: {
      ...state.commentsBySceneKey,
      [input.sceneKey]: [...(state.commentsBySceneKey[input.sceneKey] || []), newComment],
    }
  }));

  try {
    await window.electronAPI.supabaseAddComment(/* ... */, input.revisionId || null);
  } catch (err) {
    // 롤백
  }
},
```

- [ ] **Step 3: IPC 시그니처 + supabase.ts INSERT에 revision_id 추가**

`electron/preload.ts`의 `supabaseAddComment` 마지막 인자로 `revisionId: string | null` 추가.
`electron/main.ts` IPC 핸들러도 동일.
`electron/supabase.ts`의 `addComment` INSERT 객체에 `revision_id: revisionId || null` 추가.

`readComments` (또는 동등 함수)도 `revision_id` SELECT에 포함시키고, 변환 시 camelCase `revisionId`로 매핑.

- [ ] **Step 4: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/services/commentService.ts src/stores/useCommentStore.ts electron/preload.ts electron/main.ts electron/supabase.ts
git commit -m "[v1.18.0-step-14] 댓글에 revisionId 필드 — 리비전 ↔ 씬 댓글 단일 흐름"
```

---

### Task 15: RevisionCommentBadge 컴포넌트 ([re#] 배지)

**Files:**
- Create: `src/components/scenes/RevisionCommentBadge.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useRevisionStore } from '@/stores/useRevisionStore';
import { revisionNoToLabel } from '@/constants/revision';

interface Props {
  revisionId: string;
  onJump?: (revisionId: string) => void;
}

export function RevisionCommentBadge({ revisionId, onJump }: Props) {
  const rev = useRevisionStore(s => s.revisionsById[revisionId]);
  if (!rev) return null;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onJump?.(revisionId); }}
      title={`${revisionNoToLabel(rev.revisionNo)} 리비전으로 이동`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-accent/15 text-accent-sub border-accent/30 hover:bg-accent/25 cursor-pointer transition-colors"
    >
      {revisionNoToLabel(rev.revisionNo)}
    </button>
  );
}
```

> `revisionsById`: useRevisionStore에 lookup용 derived state. 없으면 `revisions.find(r => r.id === revisionId)`로 대체.

- [ ] **Step 2: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/scenes/RevisionCommentBadge.tsx
git commit -m "[v1.18.0-step-15] [re#] 배지 컴포넌트 (씬 댓글 패널에서 재사용)"
```

---

### Task 16: CommentPanel — [re#] 배지 표시 + 클릭 라우팅 + "re만" 필터

**Files:**
- Modify: `src/components/scenes/CommentPanel.tsx`

- [ ] **Step 1: 댓글 항목에 RevisionCommentBadge 추가**

각 댓글 렌더링 부분에 작성자 이름 옆 배지:

```tsx
import { RevisionCommentBadge } from './RevisionCommentBadge';

// 댓글 렌더링 내부
<div className="flex items-center gap-1.5">
  <span className="text-[11px] font-bold text-text-primary">{comment.userName}</span>
  {comment.revisionId && (
    <RevisionCommentBadge
      revisionId={comment.revisionId}
      onJump={(revId) => {
        // 1) 모달의 탭을 'revisions'로 전환
        // 2) 카드로 스크롤 + 강조
        // 3) 카드 댓글 스레드 펼침 — 이미 UnifiedSceneDetailModal의 focusRevisionId 핸들러 재사용
        const event = new CustomEvent('bflow:jump-to-revision', { detail: { revisionId: revId } });
        window.dispatchEvent(event);
      }}
    />
  )}
</div>
```

- [ ] **Step 2: UnifiedSceneDetailModal에 jump-to-revision 이벤트 리스너 추가**

```tsx
useEffect(() => {
  function onJump(e: Event) {
    const { revisionId } = (e as CustomEvent).detail;
    setActiveTab('revisions');
    requestAnimationFrame(() => {
      const card = document.getElementById(`rev-card-${revisionId}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('rev-pulse');
        void card.offsetWidth;
        card.classList.add('rev-pulse');
        window.dispatchEvent(new CustomEvent('bflow:expand-revision', { detail: { revisionId } }));
      }
    });
  }
  window.addEventListener('bflow:jump-to-revision', onJump);
  return () => window.removeEventListener('bflow:jump-to-revision', onJump);
}, []);
```

- [ ] **Step 3: "re만" 필터 토글 헤더에 추가**

```tsx
const [reOnly, setReOnly] = useState(false);

const visibleComments = useMemo(() => {
  if (reOnly) return comments.filter(c => c.revisionId);
  return comments;
}, [comments, reOnly]);

// 헤더
<div className="flex items-center gap-1">
  <button
    onClick={() => setReOnly(!reOnly)}
    title="리비전 댓글만 보기"
    className={`text-[10px] px-2 py-1 rounded ${reOnly ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50'}`}
  >
    re만
  </button>
</div>
```

- [ ] **Step 4: 빌드 + 동작 확인**

dev 모드에서 씬 모달 → 댓글 패널 → 리비전 카드 안에서 댓글 작성 → 우측 패널에 [re#] 배지로 즉시 노출 확인. 배지 클릭 → 리비전 탭 전환 + 카드 스크롤 + 강조.

- [ ] **Step 5: 커밋**

```bash
git add src/components/scenes/CommentPanel.tsx src/components/scenes/UnifiedSceneDetailModal.tsx
git commit -m "[v1.18.0-step-16] CommentPanel에 [re#] 배지 + 클릭 라우팅 + re만 필터"
```

---

### Task 17: UnifiedSceneCard — 리비전 시각 표시

**Files:**
- Modify: `src/components/scenes/UnifiedSceneCard.tsx`

- [ ] **Step 1: 씬에 미해결 리비전이 있는지 계산**

```tsx
import { useRevisionStore } from '@/stores/useRevisionStore';
import { MessageSquareWarning } from 'lucide-react';

// 컴포넌트 내부
const sceneRevisions = useRevisionStore(s => s.getRevisionsForSceneKey(sceneKey));
const openCount = sceneRevisions.filter(r => r.status === 'open' || r.status === 'in_progress').length;
const resolvedCount = sceneRevisions.filter(r => r.status === 'resolved').length;
const hasOpenRev = openCount > 0;
```

- [ ] **Step 2: 카드에 좌측 막대 + 우측 상단 배지**

기존 카드 컨테이너에:

```tsx
<div className={`scene-card relative bg-bg-card border rounded-xl overflow-hidden ${hasOpenRev ? 'border-accent/60' : 'border-bg-border'}`}>
  {hasOpenRev && (
    <span className="absolute left-0 top-0 bottom-0 w-1 bg-accent rounded-l-xl" />
  )}
  {hasOpenRev && (
    <div className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-accent text-white"
         style={{ boxShadow: '0 0 14px rgb(var(--color-accent) / 0.55)' }}>
      <MessageSquareWarning className="w-2.5 h-2.5" strokeWidth={2.4} />
      {openCount}
    </div>
  )}
  {!hasOpenRev && resolvedCount > 0 && (
    <div className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-bg-card border border-bg-border/40 text-text-secondary/70">
      <Check className="w-2.5 h-2.5" strokeWidth={2.5} />
      {resolvedCount}
    </div>
  )}

  {/* 기존 카드 내용 그대로 */}
</div>
```

- [ ] **Step 3: 빌드 + 동작 확인**

```bash
npx tsc --noEmit
npm run dev
```

씬 카드에 리비전 표시가 나오는지 + 테마 색 변경 시 따라가는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/scenes/UnifiedSceneCard.tsx
git commit -m "[v1.18.0-step-17] 씬 카드(보드 뷰)에 리비전 시각 표시 (막대 + 배지)"
```

---

### Task 18: UnifiedSceneSheetView — 시트 뷰 표시

**Files:**
- Modify: `src/components/scenes/UnifiedSceneSheetView.tsx`

- [ ] **Step 1: 행 좌측 막대 + 셀 배지**

각 `<tr>`에 `relative` + 좌측 막대:

```tsx
<tr className="relative border-b border-bg-border/40 hover:bg-bg-primary/40 cursor-pointer">
  {hasOpenRev && (
    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" />
  )}

  <td className="px-3 py-2.5">
    <div className="flex items-center gap-2">
      <span className="text-[13px] font-mono font-bold">{sceneLabel}</span>
      {hasOpenRev && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-accent text-white">
          {openCount}
        </span>
      )}
    </div>
  </td>
  {/* ... 나머지 셀 */}
</tr>
```

- [ ] **Step 2: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/scenes/UnifiedSceneSheetView.tsx
git commit -m "[v1.18.0-step-18] 시트 뷰 행에 리비전 시각 표시 (좌측 막대 + 셀 배지)"
```

---

## Chunk 5: 어드민 설정 + 활동 로그 + 마무리

### Task 19: CompositorSection 어드민 설정 화면

**Files:**
- Create: `src/components/settings/CompositorSection.tsx`
- Modify: `src/components/settings/SettingsView.tsx` (또는 settings 진입점) — 섹션 등록
- Modify: `src/services/userService.ts` — `setCompositorDept(userId, dept)` 함수 추가
- Modify: `electron/preload.ts` + `electron/main.ts` + `electron/supabase.ts` — IPC

- [ ] **Step 1: setCompositorDept 함수 + IPC**

`src/services/userService.ts`:

```ts
export async function setCompositorDept(userId: string, dept: 'BG' | 'ACT' | null) {
  return window.electronAPI.supabaseUpdateUser(userId, { compositor_dept: dept });
}
```

`electron/preload.ts`에 `supabaseUpdateUser`가 이미 있으면 활용. 없으면 추가:

```ts
supabaseUpdateUser: (userId: string, updates: Record<string, any>) =>
  ipcRenderer.invoke('supabase:update-user', userId, updates),
```

`electron/main.ts` IPC 핸들러 + `electron/supabase.ts` updateUser 함수 작성.

- [ ] **Step 2: CompositorSection 컴포넌트**

```tsx
import { useUserStore } from '@/stores/useUserStore';
import { setCompositorDept } from '@/services/userService';
import { useState } from 'react';

export function CompositorSection() {
  const allUsers = useUserStore(s => s.users);
  const currentUser = useUserStore(s => s.currentUser);
  const refreshUsers = useUserStore(s => s.refresh);

  const [bgIds, setBgIds] = useState<Set<string>>(
    new Set(allUsers.filter(u => u.compositorDept === 'BG').map(u => u.id))
  );
  const [actIds, setActIds] = useState<Set<string>>(
    new Set(allUsers.filter(u => u.compositorDept === 'ACT').map(u => u.id))
  );

  if (currentUser?.role !== 'admin') return null;

  async function save() {
    const updates: Promise<unknown>[] = [];
    allUsers.forEach(u => {
      const isBg = bgIds.has(u.id);
      const isAct = actIds.has(u.id);
      const newDept: 'BG' | 'ACT' | null = isBg ? 'BG' : isAct ? 'ACT' : null;
      if (u.compositorDept !== newDept) {
        updates.push(setCompositorDept(u.id, newDept));
      }
    });
    await Promise.all(updates);
    await refreshUsers();
  }

  function toggleBg(id: string) {
    const next = new Set(bgIds);
    if (next.has(id)) next.delete(id);
    else { next.add(id); actIds.delete(id); setActIds(new Set(actIds)); }
    setBgIds(next);
  }
  function toggleAct(id: string) {
    const next = new Set(actIds);
    if (next.has(id)) next.delete(id);
    else { next.add(id); bgIds.delete(id); setBgIds(new Set(bgIds)); }
    setActIds(next);
  }

  return (
    <section className="bg-bg-card border border-bg-border/60 rounded-xl p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-text-primary mb-1">리비전 컴포지터 지정</h3>
        <p className="text-[11px] text-text-secondary/70">각 부서 컴포지터로 지정된 사람은 그 부서 씬의 새 리비전 등록 시 알림을 자동으로 받습니다.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">BG 컴포지터</div>
          <div className="space-y-1">
            {allUsers.map(u => (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-primary/50 cursor-pointer">
                <input type="checkbox" checked={bgIds.has(u.id)} onChange={() => toggleBg(u.id)} className="accent-accent" />
                <span className="text-[12px] text-text-primary">{u.name}</span>
                {u.role === 'admin' && <span className="text-[10px] text-accent-sub">(어드민)</span>}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">ACT 컴포지터</div>
          <div className="space-y-1">
            {allUsers.map(u => (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-primary/50 cursor-pointer">
                <input type="checkbox" checked={actIds.has(u.id)} onChange={() => toggleAct(u.id)} className="accent-accent" />
                <span className="text-[12px] text-text-primary">{u.name}</span>
                {u.role === 'admin' && <span className="text-[10px] text-accent-sub">(어드민)</span>}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={save} className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90">저장</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 설정 화면에 섹션 등록**

기존 설정 진입점(`src/components/settings/...` 폴더의 main view)에 `<CompositorSection />` 추가.

- [ ] **Step 4: 빌드 + 동작 확인**

dev 모드에서 어드민 계정으로 로그인 → 설정 → 리비전 컴포지터 섹션 보이는지. 일반 사용자는 보이지 않는지.

- [ ] **Step 5: 커밋**

```bash
git add src/components/settings/CompositorSection.tsx src/components/settings/*.tsx src/services/userService.ts electron/preload.ts electron/main.ts electron/supabase.ts
git commit -m "[v1.18.0-step-19] 어드민 설정 화면에 리비전 컴포지터 지정 섹션"
```

---

### Task 20: activity_log — revision_comment 액션 추가

**Files:**
- Modify: `src/components/widgets/activity/constants.ts`
- Modify: `electron/activityLogger.ts`
- Modify: `electron/main.ts` (댓글 추가 IPC 핸들러에서 sbRecordActivityLog 호출)

- [ ] **Step 1: constants.ts에 라벨/색 추가**

```ts
export const ACTIVITY_TYPE_CONFIG = {
  // ... 기존 4종
  revision_comment: {
    label: '리비전 댓글',
    color: 'rgb(var(--color-accent))',
    icon: MessageCircleMore,  // 또는 적절한 아이콘
  },
};
```

- [ ] **Step 2: activityLogger.ts에 키워드 매핑 추가**

기존 `'revision'` 키워드 매핑 위치 확인 후, `revision_comment` action_type이 `comp_revisions` 테이블 변경과 연관되도록 또는 별도 처리.

- [ ] **Step 3: 댓글 추가 IPC에서 revisionId 있으면 activity_log 기록**

`electron/main.ts`의 `supabase:add-comment` IPC 핸들러에서:

```ts
ipcMain.handle('supabase:add-comment', async (_e, /* ... */ revisionId: string | null) => {
  const result = await sbAddComment(/* ... */ revisionId);
  if (revisionId) {
    await sbRecordActivityLog({
      action_type: 'revision_comment',
      action_group: 'etc',
      // ... 추가 메타
      detail: { revisionId, commentText: text.slice(0, 100) },
    });
  }
  return result;
});
```

- [ ] **Step 4: 빌드 + 커밋**

```bash
npx tsc --noEmit
git add src/components/widgets/activity/constants.ts electron/activityLogger.ts electron/main.ts
git commit -m "[v1.18.0-step-20] activity_log에 revision_comment 액션 추가"
```

---

### Task 21: 검증 — 12개 체크리스트 통과

**Files:** (수정 없음)

- [ ] **Step 1: 빌드 검증**

```bash
npx tsc --noEmit
npm run build
```

기대: 둘 다 에러 없이 완료.

- [ ] **Step 2: dev 모드 실행 + 마이그레이션 SQL 적용 확인**

```bash
npm run dev
```

Supabase Studio에서 마이그레이션이 적용된 상태인지 한 번 더 확인 (Task 1 Step 3 SELECT 쿼리 재실행).

- [ ] **Step 3: spec의 검증 기준 12개 수동 통과**

미리보기 모드(`?preview=1`)로 mock 사용자 '배한솔' 로그인 후:

1. [ ] 마이그레이션 SQL 멱등하게 재실행 가능 (에러 없음)
2. [ ] 등록 폼에 우선순위/부서/프레임번호 UI 없음
3. [ ] 알림 받을 사람 자동 체크 = 컴포지터 + 담당자 - 등록자
4. [ ] "다른 사람 추가" 검색 → 클릭 → 칩 추가 동작
5. [ ] 리비전 등록 시 자동 체크된 사람들에게 벨/토스트/OS 알림 (등록자 본인 미수신)
6. [ ] 알림 클릭 → 모달 열림 → 리비전 탭 → 카드 스크롤 + 강조
7. [ ] 리비전 카드 안 댓글 작성 → 우측 댓글 패널에 [re#] 배지로 즉시 표시
8. [ ] 댓글 패널 [re#] 배지 클릭 → 리비전 탭 + 카드 스크롤 + 댓글 펼침 + 강조
9. [ ] "re만" 필터 토글 동작
10. [ ] 씬 카드/시트에 미해결 리비전 표시
11. [ ] 어드민 설정에서 BG/ACT 컴포지터 지정 가능
12. [ ] 테마 색 변경 시 모든 강조 색이 즉시 따라 변경

- [ ] **Step 4: 실패한 항목이 있으면 root cause 추적 후 수정 → 재검증**

실패 항목별로 별도 fix 커밋:

```bash
git add <fixed files>
git commit -m "[v1.18.0-step-21-fix] <검증 N번 항목 수정>"
```

---

### Task 22: package.json 버전 + 마지막 커밋

**Files:**
- Modify: `package.json` — version 1.17.0 → 1.18.0

- [ ] **Step 1: 버전 업**

```json
{
  "version": "1.18.0",
  ...
}
```

- [ ] **Step 2: 빌드 한 번 더 + 커밋**

```bash
npm run build
git add package.json package-lock.json
git commit -m "[v1.18.0] 리비전 기능 전면 재설계 — 알림·댓글 통합·컴포지터 역할 완성"
```

- [ ] **Step 3: ROADMAP.md / CLAUDE.md 갱신** (선택적)

ROADMAP.md에 v1.18.0 항목 완료 표시. CLAUDE.md "현재 상태" 섹션 갱신.

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "[v1.18.0] 문서 갱신 — 리비전 재설계 완료 표기"
```

---

## 끝.

모든 Task 완료 시 v1.18.0 릴리스 준비 완료. PR 생성은 별도 (`/pr-creator` 또는 한솔님 명시 요청 시).
