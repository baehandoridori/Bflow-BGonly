# Issue #22: 로컬 데이터 안전성 개선 + GCal 연동 — 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 전용 데이터(할일, 메모)를 Supabase로 이관하고, 캘린더를 Google Calendar SSOT로 전환하며, 이미지 캐시 안전성을 개선한다.

**Architecture:** 할일/메모는 기존 Supabase IPC 패턴(낙관적 업데이트)을 그대로 따르고, 캘린더는 Google Calendar API를 Electron 메인 프로세스에서 직접 호출하며, Edge Function webhook으로 실시간 변경 알림을 수신한다.

**Tech Stack:** Supabase (PostgreSQL), Google Calendar API (googleapis), Supabase Edge Functions (Deno), OAuth2 (loopback redirect)

**Spec:** `docs/superpowers/specs/2026-03-25-issue22-data-safety-design.md`

---

## 파일 구조

### 신규 생성 파일

| 파일 | 역할 |
|------|------|
| `electron/googleCalendar.ts` | Google Calendar API CRUD, OAuth2 인증, Watch 관리, syncToken 기반 동기화 |
| `src/services/googleCalendarService.ts` | GCal IPC 래퍼 (렌더러 → 메인) |
| `supabase/functions/gcal-webhook/index.ts` | Edge Function: GCal Push Notification 수신 → Realtime Broadcast |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `electron/supabase.ts` | `personal_todos`, `task_views`, `memos` CRUD 함수 추가 |
| `electron/main.ts` | 할일/메모/GCal IPC 핸들러 추가 |
| `src/services/supabaseService.ts` | 할일/메모 IPC 래퍼 추가 |
| `src/components/widgets/MyTasksWidget.tsx` | localStorage → supabaseService, 마이그레이션 로직 |
| `src/components/widgets/MemoWidget.tsx` | settings:read/write → supabaseService, 마이그레이션 로직 |
| `src/services/calendarService.ts` | GCal 서비스로 위임하도록 리팩토링 (또는 deprecated) |
| `src/types/calendar.ts` | GCal 연동 타입 추가 |
| `electron/broadcast.ts` | GCal 변경 Broadcast 이벤트 추가 |
| `electron/preload.ts` | 신규 IPC 채널 expose |

---

## Chunk 1: 할일(MyTasks) Supabase 이관

### Task 1.1: Supabase 테이블 생성 (personal_todos + task_views)

**Files:**
- Supabase Dashboard 또는 SQL Editor에서 실행

- [ ] **Step 1: personal_todos 테이블 생성**

```sql
CREATE TABLE personal_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
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

- [ ] **Step 2: task_views 테이블 생성**

```sql
CREATE TABLE task_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) UNIQUE,  -- user_id UNIQUE (upsert용)
  views JSONB NOT NULL DEFAULT '[]',
  assigned_scene_keys JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_task_views_user ON task_views(user_id);
```

- [ ] **Step 3: 테이블 생성 확인**

Supabase Dashboard → Table Editor에서 `personal_todos`, `task_views` 테이블이 보이는지 확인.

---

### Task 1.2: electron/supabase.ts — 할일 CRUD 함수 추가

**Files:**
- Modify: `electron/supabase.ts` (파일 끝에 추가)

- [ ] **Step 1: PersonalTodo 타입 및 CRUD 함수 추가**

`electron/supabase.ts` 파일 끝에 다음을 추가:

```typescript
// ─── Personal Todos ──────────────────────────────

export interface SupabaseTodo {
  id: string;
  userId: string;
  title: string;
  memo: string;
  completed: boolean;
  startDate: string | null;
  endDate: string | null;
  addToCalendar: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function readTodos(userId: string): Promise<SupabaseTodo[]> {
  const { data, error } = await supabase
    .from('personal_todos')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order');
  throwIfError(error);
  return (data || []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    memo: r.memo || '',
    completed: r.completed,
    startDate: r.start_date,
    endDate: r.end_date,
    addToCalendar: r.add_to_calendar,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function upsertTodo(
  userId: string,
  todo: {
    id?: string;
    title: string;
    memo: string;
    completed: boolean;
    startDate?: string | null;
    endDate?: string | null;
    addToCalendar?: boolean;
    sortOrder?: number;
    createdAt?: string;
  },
): Promise<string> {
  const now = new Date().toISOString();
  const row = {
    ...(todo.id ? { id: todo.id } : {}),
    user_id: userId,
    title: todo.title,
    memo: todo.memo,
    completed: todo.completed,
    start_date: todo.startDate ?? null,
    end_date: todo.endDate ?? null,
    add_to_calendar: todo.addToCalendar ?? false,
    sort_order: todo.sortOrder ?? 0,
    created_at: todo.createdAt ?? now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('personal_todos')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single();
  throwIfError(error);
  return data!.id;
}

export async function deleteTodo(todoId: string): Promise<void> {
  const { error } = await supabase
    .from('personal_todos')
    .delete()
    .eq('id', todoId);
  throwIfError(error);
}

// ─── Task Views ──────────────────────────────

export async function readTaskViews(userId: string): Promise<{ views: unknown[]; assignedSceneKeys: unknown[] } | null> {
  const { data, error } = await supabase
    .from('task_views')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return {
    views: data.views || [],
    assignedSceneKeys: data.assigned_scene_keys || [],
  };
}

export async function upsertTaskViews(
  userId: string,
  views: unknown[],
  assignedSceneKeys: unknown[],
): Promise<void> {
  const { error } = await supabase
    .from('task_views')
    .upsert(
      {
        user_id: userId,
        views,
        assigned_scene_keys: assignedSceneKeys,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  throwIfError(error);
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add electron/supabase.ts
git commit -m "feat: personal_todos + task_views CRUD 함수 추가"
```

---

### Task 1.3: electron/main.ts — 할일 IPC 핸들러 추가

**Files:**
- Modify: `electron/main.ts` (supabase IPC 핸들러 섹션에 추가)
- Modify: `electron/preload.ts` (IPC 채널 expose)

- [ ] **Step 1: main.ts에 IPC 핸들러 추가**

기존 `supabase:*` 핸들러 블록 뒤에 추가:

```typescript
// ─── Personal Todos IPC ──────────────────────────────

ipcMain.handle('supabase:read-todos', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadTodos(userId);
}));

ipcMain.handle('supabase:upsert-todo', wrapIpc(async (_e: unknown, userId: string, todo: unknown) => {
  return sbUpsertTodo(userId, todo as Parameters<typeof sbUpsertTodo>[1]);
}));

ipcMain.handle('supabase:delete-todo', wrapIpc(async (_e: unknown, todoId: string) => {
  return sbDeleteTodo(todoId);
}));

ipcMain.handle('supabase:read-task-views', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadTaskViews(userId);
}));

ipcMain.handle('supabase:upsert-task-views', wrapIpc(async (_e: unknown, userId: string, views: unknown[], sceneKeys: unknown[]) => {
  return sbUpsertTaskViews(userId, views, sceneKeys);
}));
```

상단 import에 추가:
```typescript
import {
  // ... 기존 import ...
  readTodos as sbReadTodos,
  upsertTodo as sbUpsertTodo,
  deleteTodo as sbDeleteTodo,
  readTaskViews as sbReadTaskViews,
  upsertTaskViews as sbUpsertTaskViews,
} from './supabase';
```

- [ ] **Step 2: preload.ts에 IPC 채널 expose**

`preload.ts`의 `electronAPI` 객체에 추가:

```typescript
supabaseReadTodos: (userId: string) => ipcRenderer.invoke('supabase:read-todos', userId),
supabaseUpsertTodo: (userId: string, todo: unknown) => ipcRenderer.invoke('supabase:upsert-todo', userId, todo),
supabaseDeleteTodo: (todoId: string) => ipcRenderer.invoke('supabase:delete-todo', todoId),
supabaseReadTaskViews: (userId: string) => ipcRenderer.invoke('supabase:read-task-views', userId),
supabaseUpsertTaskViews: (userId: string, views: unknown[], sceneKeys: unknown[]) =>
  ipcRenderer.invoke('supabase:upsert-task-views', userId, views, sceneKeys),
```

- [ ] **Step 3: ElectronAPI 타입 정의 업데이트**

`src/types/index.ts` (또는 `electron.d.ts` — 프로젝트의 `ElectronAPI` 인터페이스가 정의된 파일)에 추가:

```typescript
supabaseReadTodos: (userId: string) => Promise<any[]>;
supabaseUpsertTodo: (userId: string, todo: unknown) => Promise<string>;
supabaseDeleteTodo: (todoId: string) => Promise<void>;
supabaseReadTaskViews: (userId: string) => Promise<any>;
supabaseUpsertTaskViews: (userId: string, views: unknown[], sceneKeys: unknown[]) => Promise<void>;
```

- [ ] **Step 4: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add electron/main.ts electron/preload.ts src/types/
git commit -m "feat: 할일/뷰 IPC 핸들러 + preload expose + 타입 정의"
```

---

### Task 1.4: src/services/supabaseService.ts — 할일 IPC 래퍼

**Files:**
- Modify: `src/services/supabaseService.ts`

- [ ] **Step 1: 래퍼 함수 추가**

파일 끝에 추가:

```typescript
// ─── Personal Todos ──────────────────────────────

export async function readTodos(userId: string) {
  return window.electronAPI.supabaseReadTodos(userId);
}

export async function upsertTodo(userId: string, todo: {
  id?: string;
  title: string;
  memo: string;
  completed: boolean;
  startDate?: string | null;
  endDate?: string | null;
  addToCalendar?: boolean;
  sortOrder?: number;
  createdAt?: string;
}): Promise<string> {
  return window.electronAPI.supabaseUpsertTodo(userId, todo);
}

export async function deleteTodo(todoId: string): Promise<void> {
  return window.electronAPI.supabaseDeleteTodo(todoId);
}

export async function readTaskViews(userId: string) {
  return window.electronAPI.supabaseReadTaskViews(userId);
}

export async function upsertTaskViews(
  userId: string,
  views: unknown[],
  assignedSceneKeys: unknown[],
): Promise<void> {
  return window.electronAPI.supabaseUpsertTaskViews(userId, views, assignedSceneKeys);
}
```

- [ ] **Step 2: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add src/services/supabaseService.ts
git commit -m "feat: 할일/뷰 supabaseService 래퍼 추가"
```

---

### Task 1.5: MyTasksWidget.tsx — localStorage → Supabase 전환 + 마이그레이션

**Files:**
- Modify: `src/components/widgets/MyTasksWidget.tsx`

- [ ] **Step 1: import 추가 및 마이그레이션 플래그 상수 정의**

파일 상단에 추가:
```typescript
import * as supabaseService from '@/services/supabaseService';
```

기존 localStorage 키 상수 아래에 마이그레이션 플래그 추가:
```typescript
const MIGRATION_DONE_KEY = 'bflow_migration_todos_done';
```

- [ ] **Step 2: localStorage 함수를 Supabase 기반으로 교체**

기존 `loadViews`, `saveViews`, `loadAssignedTodos`, `saveAssignedTodos`, `loadAssignedSceneKeys`, `saveAssignedSceneKeys` 함수를 다음으로 교체:

```typescript
// ─── Supabase 기반 로드/저장 ──────────────────────────

async function loadTodosFromSupabase(userId: string): Promise<PersonalTodo[]> {
  try {
    const rows = await supabaseService.readTodos(userId);
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      memo: r.memo,
      completed: r.completed,
      createdAt: r.createdAt,
      startDate: r.startDate ?? undefined,
      endDate: r.endDate ?? undefined,
      addToCalendar: r.addToCalendar,
    }));
  } catch (err) {
    console.error('[MyTasks] Supabase 할일 로드 실패:', err);
    return [];
  }
}

async function saveTodoToSupabase(userId: string, todo: PersonalTodo, sortOrder?: number): Promise<void> {
  await supabaseService.upsertTodo(userId, {
    id: todo.id,
    title: todo.title,
    memo: todo.memo,
    completed: todo.completed,
    startDate: todo.startDate ?? null,
    endDate: todo.endDate ?? null,
    addToCalendar: todo.addToCalendar,
    sortOrder: sortOrder ?? 0,
    createdAt: todo.createdAt,
  });
}

async function deleteTodoFromSupabase(todoId: string): Promise<void> {
  await supabaseService.deleteTodo(todoId);
}

async function loadTaskViewsFromSupabase(userId: string): Promise<{
  views: TaskView[];
  sceneKeys: SceneKey[];
}> {
  try {
    const data = await supabaseService.readTaskViews(userId);
    if (!data) return { views: [], sceneKeys: [] };
    return {
      views: (data.views as TaskView[]).map((v) => ({ ...v, personalTodos: v.personalTodos ?? [] })),
      sceneKeys: data.assignedSceneKeys as SceneKey[],
    };
  } catch (err) {
    console.error('[MyTasks] Supabase 뷰 로드 실패:', err);
    return { views: [], sceneKeys: [] };
  }
}

async function saveTaskViewsToSupabase(
  userId: string,
  views: TaskView[],
  sceneKeys: SceneKey[],
): Promise<void> {
  await supabaseService.upsertTaskViews(userId, views, sceneKeys);
}
```

- [ ] **Step 3: 마이그레이션 함수 추가**

```typescript
async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return;

  console.log('[MyTasks] localStorage → Supabase 마이그레이션 시작');

  try {
    // 1. 기존 할일 마이그레이션
    const rawTodos = localStorage.getItem(ASSIGNED_TODOS_KEY);
    if (rawTodos) {
      const todos: PersonalTodo[] = JSON.parse(rawTodos);
      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        await supabaseService.upsertTodo(userId, {
          id: todo.id,
          title: todo.title,
          memo: todo.memo,
          completed: todo.completed,
          startDate: todo.startDate ?? null,
          endDate: todo.endDate ?? null,
          addToCalendar: todo.addToCalendar,
          sortOrder: i,
          createdAt: todo.createdAt,
        });
      }
    }

    // 2. 뷰 + 씬 키 마이그레이션
    const rawViews = localStorage.getItem(VIEWS_KEY);
    const rawSceneKeys = localStorage.getItem(ASSIGNED_SCENES_KEY);
    const views = rawViews ? JSON.parse(rawViews) : [];
    const sceneKeys = rawSceneKeys ? JSON.parse(rawSceneKeys) : [];
    if (views.length > 0 || sceneKeys.length > 0) {
      await supabaseService.upsertTaskViews(userId, views, sceneKeys);
    }

    // 3. 완료 플래그 설정 + 원본 삭제
    localStorage.setItem(MIGRATION_DONE_KEY, 'true');
    localStorage.removeItem(ASSIGNED_TODOS_KEY);
    localStorage.removeItem(VIEWS_KEY);
    localStorage.removeItem(ASSIGNED_SCENES_KEY);

    console.log('[MyTasks] 마이그레이션 완료');
  } catch (err) {
    console.error('[MyTasks] 마이그레이션 실패 (다음 실행 시 재시도):', err);
  }
}
```

- [ ] **Step 4: 컴포넌트 초기화 로직 수정**

위젯 초기화 useEffect에서 기존 localStorage 로드를 Supabase 로드로 교체.
`currentUser`가 있을 때만 데이터 로드하도록 수정:

```typescript
useEffect(() => {
  if (!currentUser?.id) return;

  (async () => {
    // 마이그레이션 먼저
    await migrateLocalStorageToSupabase(currentUser.id);

    // Supabase에서 로드
    const todos = await loadTodosFromSupabase(currentUser.id);
    setAssignedTodos(todos);

    const { views, sceneKeys } = await loadTaskViewsFromSupabase(currentUser.id);
    setCustomViews(views);
    setAssignedSceneKeys(sceneKeys);

    setLoaded(true);
  })();
}, [currentUser?.id]);
```

- [ ] **Step 5: 저장 로직 수정**

할일 추가/수정/삭제 시 `saveAssignedTodos()` 호출을 `saveTodoToSupabase()` 호출로 교체.
뷰 변경 시 `saveViews()` 호출을 `saveTaskViewsToSupabase()` 호출로 교체.

> **낙관적 업데이트 패턴**: state를 먼저 업데이트한 뒤 비동기로 Supabase 저장. 실패 시 console.error (rollback은 향후 필요 시 추가).

- [ ] **Step 6: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit && npx vite build
git add src/components/widgets/MyTasksWidget.tsx
git commit -m "feat: MyTasks localStorage → Supabase 전환 + 마이그레이션"
```

---

## Chunk 2: 메모 위젯 Supabase 이관

### Task 2.1: Supabase 테이블 생성 (memos)

- [ ] **Step 1: memos 테이블 생성**

```sql
CREATE TABLE memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  widget_id TEXT NOT NULL,
  tabs JSONB NOT NULL DEFAULT '[]',
  active_tab_id TEXT,
  font_size INT DEFAULT 14,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, widget_id)
);

CREATE INDEX idx_memos_user ON memos(user_id);
```

---

### Task 2.2: electron/supabase.ts — 메모 CRUD 함수

**Files:**
- Modify: `electron/supabase.ts`

- [ ] **Step 1: 메모 CRUD 함수 추가**

```typescript
// ─── Memos ──────────────────────────────

export async function readMemo(userId: string, widgetId: string): Promise<{
  tabs: unknown[];
  activeTabId: string | null;
  fontSize: number;
} | null> {
  const { data, error } = await supabase
    .from('memos')
    .select('*')
    .eq('user_id', userId)
    .eq('widget_id', widgetId)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return {
    tabs: data.tabs || [],
    activeTabId: data.active_tab_id,
    fontSize: data.font_size ?? 14,
  };
}

export async function upsertMemo(
  userId: string,
  widgetId: string,
  memoData: { tabs: unknown[]; activeTabId: string | null; fontSize: number },
): Promise<void> {
  const { error } = await supabase
    .from('memos')
    .upsert(
      {
        user_id: userId,
        widget_id: widgetId,
        tabs: memoData.tabs,
        active_tab_id: memoData.activeTabId,
        font_size: memoData.fontSize,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,widget_id' },
    );
  throwIfError(error);
}

export async function readAllMemos(userId: string): Promise<Array<{
  widgetId: string;
  tabs: unknown[];
  activeTabId: string | null;
  fontSize: number;
}>> {
  const { data, error } = await supabase
    .from('memos')
    .select('*')
    .eq('user_id', userId);
  throwIfError(error);
  return (data || []).map((r) => ({
    widgetId: r.widget_id,
    tabs: r.tabs || [],
    activeTabId: r.active_tab_id,
    fontSize: r.font_size ?? 14,
  }));
}
```

- [ ] **Step 2: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/supabase.ts
git commit -m "feat: memos CRUD 함수 추가"
```

---

### Task 2.3: IPC 핸들러 + preload + 래퍼

**Files:**
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/services/supabaseService.ts`

- [ ] **Step 1: main.ts IPC 핸들러**

```typescript
ipcMain.handle('supabase:read-memo', wrapIpc(async (_e: unknown, userId: string, widgetId: string) => {
  return sbReadMemo(userId, widgetId);
}));

ipcMain.handle('supabase:upsert-memo', wrapIpc(async (_e: unknown, userId: string, widgetId: string, memoData: unknown) => {
  return sbUpsertMemo(userId, widgetId, memoData as Parameters<typeof sbUpsertMemo>[2]);
}));

ipcMain.handle('supabase:read-all-memos', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadAllMemos(userId);
}));
```

import 추가:
```typescript
import {
  readMemo as sbReadMemo,
  upsertMemo as sbUpsertMemo,
  readAllMemos as sbReadAllMemos,
} from './supabase';
```

- [ ] **Step 2: preload.ts expose**

```typescript
supabaseReadMemo: (userId: string, widgetId: string) =>
  ipcRenderer.invoke('supabase:read-memo', userId, widgetId),
supabaseUpsertMemo: (userId: string, widgetId: string, data: unknown) =>
  ipcRenderer.invoke('supabase:upsert-memo', userId, widgetId, data),
supabaseReadAllMemos: (userId: string) =>
  ipcRenderer.invoke('supabase:read-all-memos', userId),
```

- [ ] **Step 3: supabaseService.ts 래퍼**

```typescript
// ─── Memos ──────────────────────────────

export async function readMemo(userId: string, widgetId: string) {
  return window.electronAPI.supabaseReadMemo(userId, widgetId);
}

export async function upsertMemo(
  userId: string,
  widgetId: string,
  memoData: { tabs: unknown[]; activeTabId: string | null; fontSize: number },
): Promise<void> {
  return window.electronAPI.supabaseUpsertMemo(userId, widgetId, memoData);
}
```

- [ ] **Step 4: ElectronAPI 타입 정의에 메모 함수 추가**

```typescript
supabaseReadMemo: (userId: string, widgetId: string) => Promise<any>;
supabaseUpsertMemo: (userId: string, widgetId: string, data: unknown) => Promise<void>;
supabaseReadAllMemos: (userId: string) => Promise<any[]>;
```

- [ ] **Step 5: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts electron/preload.ts src/services/supabaseService.ts src/types/
git commit -m "feat: 메모 IPC 핸들러 + preload + 래퍼 + 타입 정의"
```

---

### Task 2.4: MemoWidget.tsx — Supabase 전환 + 마이그레이션

**Files:**
- Modify: `src/components/widgets/MemoWidget.tsx`

- [ ] **Step 1: import 추가**

```typescript
import * as supabaseService from '@/services/supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';
```

- [ ] **Step 2: 로드 로직 수정**

기존 `settings:read` 기반 로드 (라인 233~244) 를 Supabase 기반으로 교체:

```typescript
useEffect(() => {
  const userId = useAuthStore.getState().currentUser?.id;
  if (!userId) {
    setLoaded(true);
    return;
  }

  (async () => {
    // 마이그레이션 먼저
    await migrateMemoToSupabase(userId);

    try {
      const data = await supabaseService.readMemo(userId, memoKey);
      if (data) {
        setMemoData(migrateMemoData(data as MemoData));
      }
    } catch (err) {
      console.error('[MemoWidget] Supabase 로드 실패:', err);
    }
    setLoaded(true);
  })();
}, [memoKey]);
```

- [ ] **Step 3: 저장 로직 수정**

기존 `settings:write` 기반 저장을 Supabase로 교체:

```typescript
const save = useCallback((data: MemoData) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(async () => {
    const userId = useAuthStore.getState().currentUser?.id;
    if (!userId) return;
    try {
      await supabaseService.upsertMemo(userId, memoKey, {
        tabs: data.tabs,
        activeTabId: data.activeTabId,
        fontSize: data.fontSize,
      });
    } catch (err) {
      console.error('[MemoWidget] Supabase 저장 실패:', err);
    }
  }, SAVE_DEBOUNCE_MS);
}, [memoKey]);
```

- [ ] **Step 4: 마이그레이션 함수**

```typescript
const MEMO_FILE = 'memo.json';
const MEMO_MIGRATION_KEY = 'bflow_migration_memo_done';

async function migrateMemoToSupabase(userId: string): Promise<void> {
  if (localStorage.getItem(MEMO_MIGRATION_KEY)) return;

  try {
    const store = await window.electronAPI?.readSettings(MEMO_FILE);
    if (!store || typeof store !== 'object') {
      localStorage.setItem(MEMO_MIGRATION_KEY, 'true');
      return;
    }

    for (const [key, value] of Object.entries(store)) {
      if (!value || typeof value !== 'object') continue;
      const data = value as MemoData;
      await supabaseService.upsertMemo(userId, key, {
        tabs: data.tabs || [],
        activeTabId: data.activeTabId || null,
        fontSize: data.fontSize ?? 14,
      });
    }

    localStorage.setItem(MEMO_MIGRATION_KEY, 'true');

    // 원본 파일을 백업으로 이름 변경
    try {
      await window.electronAPI?.writeSettings('memo.json.bak', store);
    } catch { /* 백업 실패는 무시 */ }

    console.log('[MemoWidget] memo.json → Supabase 마이그레이션 완료');
  } catch (err) {
    console.error('[MemoWidget] 마이그레이션 실패 (다음 실행 시 재시도):', err);
  }
}
```

- [ ] **Step 5: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit && npx vite build
git add src/components/widgets/MemoWidget.tsx
git commit -m "feat: MemoWidget memo.json → Supabase 전환 + 마이그레이션"
```

---

## Chunk 3: Google Calendar 연동 — OAuth2 + API 기반

### Task 3.1: electron/googleCalendar.ts — OAuth2 + CRUD

**Files:**
- Create: `electron/googleCalendar.ts`

- [ ] **Step 1: 파일 생성 — OAuth2 인증 모듈**

```typescript
/**
 * Google Calendar API 연동 모듈
 * - OAuth2 인증 (loopback redirect)
 * - 이벤트 CRUD
 * - syncToken 기반 incremental sync
 * - Watch 채널 관리
 */

import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { URL } from 'url';
import { shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── 설정 ──────────────────────────────

const CLIENT_ID = 'YOUR_CLIENT_ID';        // TODO: Google Cloud Console에서 발급
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET'; // TODO: Google Cloud Console에서 발급
const LOOPBACK_PORT = 8089;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const TOKENS_FILE = 'google-tokens.json';
const SYNC_STATE_FILE = 'gcal-sync-state.json';
const WATCH_STATE_FILE = 'gcal-watch-state.json';

// ─── Edge Function webhook URL ──────────────────────────────
// TODO: Supabase 프로젝트 배포 후 실제 URL로 교체
const WEBHOOK_URL = 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/gcal-webhook';
const WEBHOOK_TOKEN = 'bflow-gcal-webhook-secret'; // Edge Function과 공유하는 검증 토큰

function getDataPath(): string {
  return app.getPath('userData');
}

function readJsonFile<T>(fileName: string): T | null {
  try {
    const filePath = path.join(getDataPath(), fileName);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(fileName: string, data: unknown): void {
  const filePath = path.join(getDataPath(), fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── OAuth2 클라이언트 ──────────────────────────────

let oauth2Client: OAuth2Client | null = null;
let calendarApi: calendar_v3.Calendar | null = null;

function getOAuth2Client(): OAuth2Client {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.on('tokens', (tokens) => {
      const saved = readJsonFile<Record<string, unknown>>(TOKENS_FILE) || {};
      writeJsonFile(TOKENS_FILE, { ...saved, ...tokens });
    });
  }
  return oauth2Client;
}

function getCalendarApi(): calendar_v3.Calendar {
  if (!calendarApi) {
    calendarApi = google.calendar({ version: 'v3', auth: getOAuth2Client() });
  }
  return calendarApi;
}

/** 저장된 토큰 복원. 성공 시 true */
export function restoreTokens(): boolean {
  const tokens = readJsonFile<Record<string, unknown>>(TOKENS_FILE);
  if (tokens) {
    getOAuth2Client().setCredentials(tokens);
    return true;
  }
  return false;
}

/** OAuth2 인증 여부 */
export function isAuthenticated(): boolean {
  const client = getOAuth2Client();
  return !!client.credentials?.access_token || !!client.credentials?.refresh_token;
}

/** OAuth2 인증 시작 (시스템 브라우저 열기) */
export function startAuth(): Promise<void> {
  const client = getOAuth2Client();
  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://127.0.0.1:${LOOPBACK_PORT}`);
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          if (!code) throw new Error('No authorization code');

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>B flow 인증 완료! 이 창을 닫아도 됩니다.</h1>');
          server.close();

          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          writeJsonFile(TOKENS_FILE, tokens);
          calendarApi = null; // 재생성 강제

          resolve();
        }
      } catch (err) {
        res.writeHead(500);
        res.end('Authentication failed');
        server.close();
        reject(err);
      }
    });

    server.listen(LOOPBACK_PORT, '127.0.0.1', () => {
      shell.openExternal(authorizeUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out (120s)'));
    }, 120_000);
  });
}

/** 인증 해제 */
export function signOut(): void {
  const tokenPath = path.join(getDataPath(), TOKENS_FILE);
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  oauth2Client = null;
  calendarApi = null;
}

// ─── 캘린더 목록 ──────────────────────────────

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const res = await getCalendarApi().calendarList.list();
  return (res.data.items || []).map((c) => ({
    id: c.id!,
    summary: c.summary || c.id!,
    primary: c.primary || false,
  }));
}

// ─── 이벤트 CRUD ──────────────────────────────

export interface GCalEventInput {
  summary: string;
  description?: string;
  startDate: string;       // YYYY-MM-DD (종일) 또는 ISO datetime
  endDate: string;
  colorId?: string;
  extendedProperties?: Record<string, string>;
}

export async function insertEvent(calendarId: string, input: GCalEventInput): Promise<string> {
  const isAllDay = input.startDate.length === 10; // YYYY-MM-DD
  const res = await getCalendarApi().events.insert({
    calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: isAllDay ? { date: input.startDate } : { dateTime: input.startDate },
      end: isAllDay ? { date: input.endDate } : { dateTime: input.endDate },
      colorId: input.colorId,
      extendedProperties: input.extendedProperties
        ? { private: input.extendedProperties }
        : undefined,
    },
  });
  return res.data.id!;
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: Partial<GCalEventInput>,
): Promise<void> {
  const body: calendar_v3.Schema$Event = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.startDate !== undefined) {
    const isAllDay = input.startDate.length === 10;
    body.start = isAllDay ? { date: input.startDate } : { dateTime: input.startDate };
  }
  if (input.endDate !== undefined) {
    const isAllDay = input.endDate.length === 10;
    body.end = isAllDay ? { date: input.endDate } : { dateTime: input.endDate };
  }
  if (input.extendedProperties) {
    body.extendedProperties = { private: input.extendedProperties };
  }
  await getCalendarApi().events.patch({ calendarId, eventId, requestBody: body });
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await getCalendarApi().events.delete({ calendarId, eventId });
}

// ─── Incremental Sync ──────────────────────────────

interface SyncState {
  [calendarId: string]: string; // syncToken
}

function loadSyncState(): SyncState {
  return readJsonFile<SyncState>(SYNC_STATE_FILE) || {};
}

function saveSyncState(state: SyncState): void {
  writeJsonFile(SYNC_STATE_FILE, state);
}

/** 전체 동기화 (최초 또는 syncToken 만료 시) */
export async function fullSync(calendarId: string): Promise<calendar_v3.Schema$Event[]> {
  const cal = getCalendarApi();
  let pageToken: string | undefined;
  const allEvents: calendar_v3.Schema$Event[] = [];
  let syncToken: string | undefined;

  do {
    const res = await cal.events.list({
      calendarId,
      maxResults: 250,
      singleEvents: true,
      pageToken,
    });
    allEvents.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken || undefined;
    syncToken = res.data.nextSyncToken || undefined;
  } while (pageToken);

  if (syncToken) {
    const state = loadSyncState();
    state[calendarId] = syncToken;
    saveSyncState(state);
  }

  return allEvents;
}

/** Incremental 동기화 (변경분만) */
export async function incrementalSync(
  calendarId: string,
): Promise<{ updated: calendar_v3.Schema$Event[]; deleted: string[] }> {
  const state = loadSyncState();
  const syncToken = state[calendarId];

  if (!syncToken) {
    const events = await fullSync(calendarId);
    return { updated: events, deleted: [] };
  }

  try {
    const cal = getCalendarApi();
    let pageToken: string | undefined;
    const changes: calendar_v3.Schema$Event[] = [];
    let newSyncToken: string | undefined;

    do {
      const res = await cal.events.list({ calendarId, syncToken, pageToken });
      changes.push(...(res.data.items || []));
      pageToken = res.data.nextPageToken || undefined;
      newSyncToken = res.data.nextSyncToken || undefined;
    } while (pageToken);

    if (newSyncToken) {
      state[calendarId] = newSyncToken;
      saveSyncState(state);
    }

    const deleted = changes.filter((e) => e.status === 'cancelled').map((e) => e.id!);
    const updated = changes.filter((e) => e.status !== 'cancelled');

    return { updated, deleted };
  } catch (err: any) {
    if (err?.code === 410) {
      // syncToken 만료 → full sync
      const events = await fullSync(calendarId);
      return { updated: events, deleted: [] };
    }
    throw err;
  }
}

// ─── Watch 채널 관리 ──────────────────────────────

interface WatchState {
  [calendarId: string]: {
    channelId: string;
    resourceId: string;
    expiration: number; // ms timestamp
  };
}

function loadWatchState(): WatchState {
  return readJsonFile<WatchState>(WATCH_STATE_FILE) || {};
}

function saveWatchState(state: WatchState): void {
  writeJsonFile(WATCH_STATE_FILE, state);
}

/** Watch 채널 등록/갱신 */
export async function ensureWatch(calendarId: string, userId: string): Promise<void> {
  const state = loadWatchState();
  const existing = state[calendarId];

  // 만료 3시간 전까지는 스킵
  if (existing && existing.expiration > Date.now() + 3 * 60 * 60 * 1000) {
    return;
  }

  // 기존 채널 중지 (있으면)
  if (existing) {
    try {
      await getCalendarApi().channels.stop({
        requestBody: { id: existing.channelId, resourceId: existing.resourceId },
      });
    } catch { /* 이미 만료되었을 수 있음 */ }
  }

  const channelId = crypto.randomUUID();
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7일

  const res = await getCalendarApi().events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: WEBHOOK_URL,
      token: `${WEBHOOK_TOKEN}:${userId}`,
      expiration: String(expiration),
    },
  });

  state[calendarId] = {
    channelId,
    resourceId: res.data.resourceId!,
    expiration: Number(res.data.expiration!),
  };
  saveWatchState(state);
}

/** 모든 Watch 채널 중지 */
export async function stopAllWatches(): Promise<void> {
  const state = loadWatchState();
  for (const [, watch] of Object.entries(state)) {
    try {
      await getCalendarApi().channels.stop({
        requestBody: { id: watch.channelId, resourceId: watch.resourceId },
      });
    } catch { /* ignore */ }
  }
  writeJsonFile(WATCH_STATE_FILE, {});
}
```

- [ ] **Step 2: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/googleCalendar.ts
git commit -m "feat: Google Calendar OAuth2 + CRUD + sync + watch 모듈"
```

---

### Task 3.2: GCal IPC 핸들러 + preload + 렌더러 서비스

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Create: `src/services/googleCalendarService.ts`

- [ ] **Step 1: main.ts — GCal IPC 핸들러**

```typescript
import * as gcal from './googleCalendar';

// ─── Google Calendar IPC ──────────────────────────────

ipcMain.handle('gcal:isAuthenticated', wrapIpc(async () => {
  return gcal.isAuthenticated();
}));

ipcMain.handle('gcal:startAuth', wrapIpc(async () => {
  await gcal.startAuth();
}));

ipcMain.handle('gcal:signOut', wrapIpc(async () => {
  gcal.signOut();
}));

ipcMain.handle('gcal:listCalendars', wrapIpc(async () => {
  return gcal.listCalendars();
}));

ipcMain.handle('gcal:fullSync', wrapIpc(async (_e: unknown, calendarId: string) => {
  return gcal.fullSync(calendarId);
}));

ipcMain.handle('gcal:incrementalSync', wrapIpc(async (_e: unknown, calendarId: string) => {
  return gcal.incrementalSync(calendarId);
}));

ipcMain.handle('gcal:insertEvent', wrapIpc(async (_e: unknown, calendarId: string, input: unknown) => {
  return gcal.insertEvent(calendarId, input as gcal.GCalEventInput);
}));

ipcMain.handle('gcal:updateEvent', wrapIpc(async (_e: unknown, calendarId: string, eventId: string, input: unknown) => {
  return gcal.updateEvent(calendarId, eventId, input as Partial<gcal.GCalEventInput>);
}));

ipcMain.handle('gcal:deleteEvent', wrapIpc(async (_e: unknown, calendarId: string, eventId: string) => {
  return gcal.deleteEvent(calendarId, eventId);
}));

ipcMain.handle('gcal:ensureWatch', wrapIpc(async (_e: unknown, calendarId: string, userId: string) => {
  return gcal.ensureWatch(calendarId, userId);
}));
```

앱 시작 시 토큰 복원 추가 (createWindow 전후):
```typescript
gcal.restoreTokens();
```

- [ ] **Step 2: preload.ts expose**

```typescript
gcalIsAuthenticated: () => ipcRenderer.invoke('gcal:isAuthenticated'),
gcalStartAuth: () => ipcRenderer.invoke('gcal:startAuth'),
gcalSignOut: () => ipcRenderer.invoke('gcal:signOut'),
gcalListCalendars: () => ipcRenderer.invoke('gcal:listCalendars'),
gcalFullSync: (calendarId: string) => ipcRenderer.invoke('gcal:fullSync', calendarId),
gcalIncrementalSync: (calendarId: string) => ipcRenderer.invoke('gcal:incrementalSync', calendarId),
gcalInsertEvent: (calendarId: string, input: unknown) => ipcRenderer.invoke('gcal:insertEvent', calendarId, input),
gcalUpdateEvent: (calendarId: string, eventId: string, input: unknown) => ipcRenderer.invoke('gcal:updateEvent', calendarId, eventId, input),
gcalDeleteEvent: (calendarId: string, eventId: string) => ipcRenderer.invoke('gcal:deleteEvent', calendarId, eventId),
gcalEnsureWatch: (calendarId: string, userId: string) => ipcRenderer.invoke('gcal:ensureWatch', calendarId, userId),
```

- [ ] **Step 3: src/services/googleCalendarService.ts 생성**

```typescript
/**
 * Google Calendar IPC 래퍼 (렌더러 → 메인)
 * calendarService.ts를 대체
 */

export async function isAuthenticated(): Promise<boolean> {
  return window.electronAPI.gcalIsAuthenticated();
}

export async function startAuth(): Promise<void> {
  return window.electronAPI.gcalStartAuth();
}

export async function signOut(): Promise<void> {
  return window.electronAPI.gcalSignOut();
}

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  return window.electronAPI.gcalListCalendars();
}

export async function fullSync(calendarId: string) {
  return window.electronAPI.gcalFullSync(calendarId);
}

export async function incrementalSync(calendarId: string) {
  return window.electronAPI.gcalIncrementalSync(calendarId);
}

export async function insertEvent(calendarId: string, input: {
  summary: string;
  description?: string;
  startDate: string;
  endDate: string;
  colorId?: string;
  extendedProperties?: Record<string, string>;
}): Promise<string> {
  return window.electronAPI.gcalInsertEvent(calendarId, input);
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: Partial<{
    summary: string;
    description?: string;
    startDate: string;
    endDate: string;
    extendedProperties?: Record<string, string>;
  }>,
): Promise<void> {
  return window.electronAPI.gcalUpdateEvent(calendarId, eventId, input);
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  return window.electronAPI.gcalDeleteEvent(calendarId, eventId);
}

export async function ensureWatch(calendarId: string, userId: string): Promise<void> {
  return window.electronAPI.gcalEnsureWatch(calendarId, userId);
}
```

- [ ] **Step 4: ElectronAPI 타입 정의에 GCal 함수 추가**

```typescript
gcalIsAuthenticated: () => Promise<boolean>;
gcalStartAuth: () => Promise<void>;
gcalSignOut: () => Promise<void>;
gcalListCalendars: () => Promise<Array<{ id: string; summary: string; primary: boolean }>>;
gcalFullSync: (calendarId: string) => Promise<any[]>;
gcalIncrementalSync: (calendarId: string) => Promise<{ updated: any[]; deleted: string[] }>;
gcalInsertEvent: (calendarId: string, input: unknown) => Promise<string>;
gcalUpdateEvent: (calendarId: string, eventId: string, input: unknown) => Promise<void>;
gcalDeleteEvent: (calendarId: string, eventId: string) => Promise<void>;
gcalEnsureWatch: (calendarId: string, userId: string) => Promise<void>;
```

- [ ] **Step 5: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts electron/preload.ts src/services/googleCalendarService.ts src/types/
git commit -m "feat: GCal IPC 핸들러 + preload + 렌더러 서비스 + 타입 정의"
```

---

### Task 3.3: Supabase Edge Function — GCal Webhook 수신

**Files:**
- Create: `supabase/functions/gcal-webhook/index.ts`

- [ ] **Step 1: Edge Function 작성**

```typescript
// supabase/functions/gcal-webhook/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const resourceState = req.headers.get('X-Goog-Resource-State');
  const channelToken = req.headers.get('X-Goog-Channel-Token') || '';
  const channelId = req.headers.get('X-Goog-Channel-ID');
  const resourceId = req.headers.get('X-Goog-Resource-ID');

  // 토큰 형식: "secret:userId"
  const [secret, userId] = channelToken.split(':');
  const expectedSecret = Deno.env.get('GCAL_WEBHOOK_TOKEN');

  if (secret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  // sync 알림은 채널 생성 확인용
  if (resourceState === 'sync') {
    console.log(`[gcal-webhook] sync received for channel ${channelId}`);
    return new Response('OK', { status: 200 });
  }

  // 변경 발생 → Realtime Broadcast
  if (resourceState === 'exists') {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const channel = supabase.channel('gcal-sync');

    await channel.send({
      type: 'broadcast',
      event: 'calendar-changed',
      payload: {
        userId: userId || null,
        channelId,
        resourceId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[gcal-webhook] broadcast sent for user ${userId}`);
  }

  return new Response('OK', { status: 200 });
});
```

- [ ] **Step 2: 배포 (Supabase CLI 또는 Dashboard)**

```bash
# Supabase CLI가 설치되어 있는 경우:
supabase functions deploy gcal-webhook --no-verify-jwt

# 시크릿 설정:
supabase secrets set GCAL_WEBHOOK_TOKEN=bflow-gcal-webhook-secret
```

> **참고**: JWT 검증을 비활성화한 이유: Google에서 Supabase JWT를 보내지 않으므로 `X-Goog-Channel-Token`으로 직접 검증.

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/gcal-webhook/
git commit -m "feat: GCal webhook Edge Function (Push Notification → Broadcast)"
```

---

### Task 3.4: 캘린더 위젯/서비스 리팩토링 — GCal 기반

**Files:**
- Modify: `src/services/calendarService.ts` (GCal 서비스로 위임)
- Modify: `src/types/calendar.ts` (GCal 설정 타입 추가)
- Modify: 캘린더 관련 컴포넌트들

- [ ] **Step 1: calendar.ts 타입 수정**

`src/types/calendar.ts`에 GCal 설정 타입 추가:

```typescript
/** Google Calendar 연동 설정 */
export interface GCalSettings {
  teamCalendarId: string | null;     // 팀 공유 캘린더 ID
  personalCalendarId: string | null; // 개인 캘린더 ID (보통 'primary')
  lastSyncAt: string | null;         // 마지막 동기화 시각
}

/** GCal 이벤트의 extendedProperties에 저장하는 B flow 메타데이터 */
export interface BflowEventMeta {
  bflow_type: CalendarEventType;
  bflow_linked_episode?: string;
  bflow_linked_part?: string;
  bflow_linked_scene_id?: string;
  bflow_department?: 'bg' | 'acting';
  bflow_linked_todo_id?: string;
  bflow_vacation_type?: string;
  bflow_vacation_user?: string;
}
```

- [ ] **Step 2: calendarService.ts를 GCal 위임 래퍼로 리팩토링**

기존 파일의 로컬 JSON 로직을 제거하고, `googleCalendarService`로 위임하는 어댑터로 변환.
기존 `CalendarEvent` 인터페이스는 유지하여 UI 코드 변경을 최소화:

```typescript
/**
 * 캘린더 서비스 (어댑터)
 * Google Calendar API를 기존 CalendarEvent 인터페이스로 래핑
 */
import type { CalendarEvent, CalendarEventType, BflowEventMeta, GCalSettings } from '@/types/calendar';
import * as gcalService from './googleCalendarService';

const GCAL_SETTINGS_KEY = 'bflow_gcal_settings';

export function getGCalSettings(): GCalSettings {
  try {
    const raw = localStorage.getItem(GCAL_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { teamCalendarId: null, personalCalendarId: null, lastSyncAt: null };
}

export function saveGCalSettings(settings: GCalSettings): void {
  localStorage.setItem(GCAL_SETTINGS_KEY, JSON.stringify(settings));
}

/** GCal 이벤트 → B flow CalendarEvent 변환 */
function toCalendarEvent(gcalEvent: any, calendarId: string): CalendarEvent {
  const meta = (gcalEvent.extendedProperties?.private || {}) as Partial<BflowEventMeta>;
  const isAllDay = !!gcalEvent.start?.date;
  const startDate = isAllDay ? gcalEvent.start.date : gcalEvent.start?.dateTime?.slice(0, 10);
  const endDate = isAllDay ? gcalEvent.end.date : gcalEvent.end?.dateTime?.slice(0, 10);

  return {
    id: gcalEvent.id,
    title: gcalEvent.summary || '',
    memo: gcalEvent.description || '',
    color: '#6C5CE7', // TODO: GCal colorId → 색상 매핑
    type: (meta.bflow_type as CalendarEventType) || 'custom',
    startDate: startDate || '',
    endDate: endDate || '',
    createdBy: gcalEvent.creator?.email || '',
    createdAt: gcalEvent.created || new Date().toISOString(),
    linkedEpisode: meta.bflow_linked_episode ? Number(meta.bflow_linked_episode) : undefined,
    linkedPart: meta.bflow_linked_part,
    linkedSceneId: meta.bflow_linked_scene_id,
    linkedDepartment: meta.bflow_department,
    linkedTodoId: meta.bflow_linked_todo_id,
    vacationType: meta.bflow_vacation_type,
    vacationUserName: meta.bflow_vacation_user,
    isReadOnly: !meta.bflow_type, // B flow에서 만들지 않은 이벤트는 읽기 전용
  };
}

/** B flow CalendarEvent → GCal extendedProperties */
function toBflowMeta(event: Partial<CalendarEvent>): Record<string, string> {
  const meta: Record<string, string> = {};
  if (event.type) meta.bflow_type = event.type;
  if (event.linkedEpisode !== undefined) meta.bflow_linked_episode = String(event.linkedEpisode);
  if (event.linkedPart) meta.bflow_linked_part = event.linkedPart;
  if (event.linkedSceneId) meta.bflow_linked_scene_id = event.linkedSceneId;
  if (event.linkedDepartment) meta.bflow_department = event.linkedDepartment;
  if (event.linkedTodoId) meta.bflow_linked_todo_id = event.linkedTodoId;
  if (event.vacationType) meta.bflow_vacation_type = event.vacationType;
  if (event.vacationUserName) meta.bflow_vacation_user = event.vacationUserName;
  return meta;
}

/** 이벤트 타입에 따라 대상 캘린더 결정 */
function getTargetCalendar(type: CalendarEventType): string | null {
  const settings = getGCalSettings();
  if (type === 'custom') return settings.personalCalendarId;
  return settings.teamCalendarId; // episode, part, scene, vacation
}

// ─── 공개 API (기존 인터페이스 유지) ──────────────────────────

let eventCache: CalendarEvent[] = [];

export async function loadAllEvents(): Promise<CalendarEvent[]> {
  return eventCache;
}

export async function getEvents(): Promise<CalendarEvent[]> {
  return eventCache;
}

/** 전체 동기화 (앱 시작 시 호출) */
export async function syncAll(): Promise<CalendarEvent[]> {
  const settings = getGCalSettings();
  const events: CalendarEvent[] = [];

  for (const calId of [settings.teamCalendarId, settings.personalCalendarId]) {
    if (!calId) continue;
    const gcalEvents = await gcalService.fullSync(calId);
    events.push(...gcalEvents.map((e: any) => toCalendarEvent(e, calId)));
  }

  eventCache = events;
  broadcastCalendarChange();
  return events;
}

/** Incremental 동기화 (webhook 알림 시 호출) */
export async function syncIncremental(): Promise<void> {
  const settings = getGCalSettings();

  for (const calId of [settings.teamCalendarId, settings.personalCalendarId]) {
    if (!calId) continue;
    const { updated, deleted } = await gcalService.incrementalSync(calId);

    // 삭제
    eventCache = eventCache.filter((e) => !deleted.includes(e.id));
    // 업데이트/추가
    for (const gcalEvent of updated) {
      const converted = toCalendarEvent(gcalEvent, calId);
      const idx = eventCache.findIndex((e) => e.id === converted.id);
      if (idx >= 0) eventCache[idx] = converted;
      else eventCache.push(converted);
    }
  }

  broadcastCalendarChange();
}

export async function addEvent(event: CalendarEvent): Promise<void> {
  const calId = getTargetCalendar(event.type);
  if (!calId) throw new Error('캘린더가 설정되지 않았습니다');

  const gcalId = await gcalService.insertEvent(calId, {
    summary: event.title,
    description: event.memo,
    startDate: event.startDate,
    endDate: event.endDate,
    extendedProperties: toBflowMeta(event),
  });

  eventCache.push({ ...event, id: gcalId });
  broadcastCalendarChange({ eventId: gcalId, action: 'add' });
}

export async function updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
  const existing = eventCache.find((e) => e.id === eventId);
  if (!existing) return;

  const calId = getTargetCalendar(existing.type);
  if (!calId) return;

  await gcalService.updateEvent(calId, eventId, {
    summary: updates.title,
    description: updates.memo,
    startDate: updates.startDate,
    endDate: updates.endDate,
    extendedProperties: toBflowMeta({ ...existing, ...updates }),
  });

  eventCache = eventCache.map((e) => (e.id === eventId ? { ...e, ...updates } : e));
  broadcastCalendarChange({ eventId, action: 'update' });
}

export async function deleteEvent(eventId: string): Promise<void> {
  const existing = eventCache.find((e) => e.id === eventId);
  if (!existing) return;

  const calId = getTargetCalendar(existing.type);
  if (!calId) return;

  await gcalService.deleteEvent(calId, eventId);
  eventCache = eventCache.filter((e) => e.id !== eventId);
  broadcastCalendarChange({ eventId, action: 'delete' });
}

function broadcastCalendarChange(detail?: { eventId?: string; action?: 'add' | 'update' | 'delete' }) {
  window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail }));
}

export function filterEventsByRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  return events.filter((e) => e.endDate >= rangeStart && e.startDate <= rangeEnd);
}

export function getEventsForDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.startDate <= date && e.endDate >= date);
}

export async function findEventByTodoId(todoId: string): Promise<CalendarEvent | undefined> {
  return eventCache.find((e) => e.linkedTodoId === todoId);
}
```

- [ ] **Step 3: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add src/services/calendarService.ts src/types/calendar.ts
git commit -m "feat: calendarService GCal 어댑터로 리팩토링"
```

---

### Task 3.5: Broadcast에 GCal 동기화 수신 추가

**Files:**
- Modify: `electron/broadcast.ts`
- Modify: `electron/main.ts` (Broadcast 수신 → 렌더러 전달)

- [ ] **Step 1: broadcast.ts에 gcal-sync 채널 구독 추가**

`setupBroadcast` 함수에 `gcal-sync` 채널 구독 추가:

```typescript
.on('broadcast', { event: 'calendar-changed' }, ({ payload }) => {
  onReceive('calendar-changed', payload);
})
```

- [ ] **Step 2: main.ts에서 Broadcast 수신 → 렌더러 전달**

```typescript
// broadcast 수신 핸들러 내:
if (event === 'calendar-changed') {
  mainWindow?.webContents.send('broadcast:calendar-changed', payload);
}
```

- [ ] **Step 3: 렌더러에서 수신 → incremental sync 트리거**

기존 `onSupabaseBroadcast` 패턴을 활용하여 캘린더 변경 이벤트를 수신.
main.ts의 broadcast 수신부에서 `calendar-changed` 이벤트를 `supabase:broadcast-event`로 전달하므로,
렌더러에서는 기존 `onSupabaseBroadcast` 리스너에서 이벤트 타입을 필터링:

```typescript
useEffect(() => {
  const cleanup = window.electronAPI?.onSupabaseBroadcast?.((event: any) => {
    if (event?.type === 'calendar-changed') {
      // webhook 알림 수신 → incremental sync
      syncIncremental();
    }
  });
  return () => cleanup?.();
}, []);
```

- [ ] **Step 4: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/broadcast.ts electron/main.ts
git commit -m "feat: GCal webhook → Broadcast → incremental sync 파이프라인"
```

---

### Task 3.6: 설정 UI — Google Calendar 연동 섹션

**Files:**
- Modify: 설정 컴포넌트 (기존 설정 탭에 섹션 추가)

- [ ] **Step 1: GCal 연동 설정 섹션 구현**

설정 탭에 다음 요소 추가:
- Google 계정 연결/해제 버튼
- 연결 상태 표시 (연결됨/미연결 + 계정 이메일)
- 팀 캘린더 선택 드롭다운 (연결 후 접근 가능한 캘린더 목록)
- 동기화 상태 표시 (마지막 동기화 시각)

> 구현 상세는 기존 설정 탭의 UI 패턴을 따르되, 정확한 컴포넌트 파일은 구현 시 확인.

- [ ] **Step 2: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit && npx vite build
git add -A
git commit -m "feat: 설정 탭에 Google Calendar 연동 섹션 추가"
```

---

## Chunk 4: 이미지 캐시 정리

### Task 4.1: 이미지 메타데이터 manifest + Drive 업로드 보장

**Files:**
- Modify: `electron/main.ts` (`image:save` 핸들러)

- [ ] **Step 1: manifest.json 관리 로직 추가**

```typescript
const IMAGES_DIR = path.join(getDataPath(), 'images');
const MANIFEST_FILE = path.join(IMAGES_DIR, 'manifest.json');

interface ImageManifest {
  [filename: string]: {
    driveUrl?: string;
    uploadedAt?: string;
    size: number;
  };
}

function loadImageManifest(): ImageManifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveImageManifest(manifest: ImageManifest): void {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
}
```

- [ ] **Step 2: image:save 핸들러에 Drive 업로드 보장 + manifest 기록**

기존 `image:save` 핸들러를 수정하여:
1. 로컬 저장 후 manifest에 기록 (driveUrl 없음)
2. Drive 업로드 시도 (기존 GAS 경유 로직 활용)
3. 성공 시 manifest에 driveUrl 기록
4. 실패 시 재시도 큐에 추가

- [ ] **Step 3: 앱 시작 시 캐시 크기 확인 + 자동 정리**

```typescript
function cleanupImageCache(maxSizeMB: number = 500): void {
  const manifest = loadImageManifest();
  const imagesDir = IMAGES_DIR;

  if (!fs.existsSync(imagesDir)) return;

  const files = fs.readdirSync(imagesDir)
    .filter((f) => f !== 'manifest.json')
    .map((f) => ({
      name: f,
      path: path.join(imagesDir, f),
      stat: fs.statSync(path.join(imagesDir, f)),
    }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs); // 오래된 것 먼저

  let totalSize = files.reduce((sum, f) => sum + f.stat.size, 0);
  const maxSize = maxSizeMB * 1024 * 1024;

  for (const file of files) {
    if (totalSize <= maxSize) break;

    const meta = manifest[file.name];
    if (meta?.driveUrl) {
      // Drive에 원본이 있으면 삭제 가능
      fs.unlinkSync(file.path);
      delete manifest[file.name];
      totalSize -= file.stat.size;
    }
  }

  saveImageManifest(manifest);
}
```

앱 시작 시 호출:
```typescript
cleanupImageCache();
```

- [ ] **Step 4: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts
git commit -m "feat: 이미지 캐시 manifest + Drive 업로드 보장 + 자동 정리"
```

---

## Chunk 5: 최종 통합 + 빌드 검증

### Task 5.1: 전체 빌드 검증

- [ ] **Step 1: TypeScript 검증**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 2: Vite 빌드**

```bash
npx vite build
```

Expected: 빌드 성공

- [ ] **Step 3: Electron 빌드 (선택)**

```bash
npm run build
```

---

### Task 5.2: 최종 커밋 + 버전 업데이트

- [ ] **Step 1: package.json 버전 업데이트**

마이너 버전 올리기: `1.7.0` → `1.8.0`

- [ ] **Step 2: 최종 커밋**

```bash
git add package.json
git commit -m "chore: v1.8.0 — Supabase 데이터 이관 + GCal 연동"
```

---

## 요약

| Chunk | 내용 | 난이도 | 예상 Task 수 |
|-------|------|--------|-------------|
| **1** | 할일 → Supabase | 낮음 | 5 |
| **2** | 메모 → Supabase | 낮음 | 4 |
| **3** | 캘린더 → GCal | **높음** | 6 |
| **4** | 이미지 캐시 | 중간 | 1 |
| **5** | 통합 + 빌드 | 낮음 | 3 |
