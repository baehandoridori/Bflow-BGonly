import type {
  MainCalendarTodoPatch,
  MainPersonalTodo,
  MainPersonalTodoCreateInput,
  MainPersonalTodoLabel,
  MainPersonalTodoLabelColorKey,
  MainPersonalTodoPatch,
  MainPersonalTodoStatus,
} from '../types/index.ts';
import type { PersonalTodo, PersonalTodoLabel } from '../components/widgets/my-tasks/types.ts';
import { normalizePersonalTodo } from '../components/widgets/my-tasks/personalTodoDomain.ts';

export interface PreviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(initial: Record<string, string> = {}): PreviewStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const TODO_KEY_PREFIX = 'bflow:preview:personal-todos:';
const LABEL_KEY_PREFIX = 'bflow:preview:personal-todo-labels:';
const PREVIEW_EPOCH_KEY = 'bflow:preview:canonical-session-epoch';
const SESSION_KEY = 'bflow:preview:canonical-session';
export const PERSONAL_TODO_PREVIEW_SESSION_KEY = 'bflow:preview:remembered-user';
const SEED_TIME = '2026-01-01T00:00:00.000Z';
const previewStorageKeys = new WeakMap<object, Set<string>>();

function keyPart(userId: string): string {
  return encodeURIComponent(userId || 'logged-out');
}

function browserStorage(): PreviewStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return createMemoryStorage();
}

function now(): string { return new Date().toISOString(); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function toMainTodo(todo: PersonalTodo, userId: string, sortOrder: number): MainPersonalTodo {
  const normalized = normalizePersonalTodo(todo);
  return {
    ...normalized,
    userId,
    startDate: normalized.startDate ?? null,
    endDate: normalized.endDate ?? null,
    addToCalendar: normalized.addToCalendar ?? false,
    sortOrder,
    updatedAt: now(),
  };
}

function toRendererTodo(todo: MainPersonalTodo): PersonalTodo {
  return normalizePersonalTodo({
    ...todo,
    startDate: todo.startDate ?? undefined,
    endDate: todo.endDate ?? undefined,
    addToCalendar: todo.addToCalendar,
  });
}

function defaultSeed(userId: string): MainPersonalTodo[] {
  return [
    toMainTodo({
      id: `preview-${userId}-todo-1`, title: '프리뷰 할일', memo: '', status: 'todo', completed: false,
      priority: 'medium', pinned: true, labelIds: [], createdAt: SEED_TIME,
    }, userId, 0),
    toMainTodo({
      id: `preview-${userId}-todo-2`, title: '완료된 프리뷰 할일', memo: '', status: 'done', completed: true,
      priority: 'none', pinned: false, labelIds: [], createdAt: SEED_TIME,
    }, userId, 1),
  ];
}

export interface PersonalTodoPreviewStore {
  userId: string;
  readTodos(): PersonalTodo[];
  readLabels(): PersonalTodoLabel[];
  replaceTodos(todos: PersonalTodo[]): void;
  replaceLabels(labels: PersonalTodoLabel[]): void;
  seedDeterministic(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  createTodo(input: MainPersonalTodoCreateInput): MainPersonalTodo[];
  patchTodo(todoId: string, patch: MainPersonalTodoPatch): MainPersonalTodo;
  applyCalendarToTodoPatch(todoId: string, patch: MainCalendarTodoPatch): MainPersonalTodo;
  mutateOrder(mutation: { type: 'reorder' } | { type: 'pin' | 'setPinned'; todoId: string; pinned: boolean } | { type: 'status' | 'setStatusAndOrder'; todoId: string; status: MainPersonalTodoStatus }, orderedIds: string[]): MainPersonalTodo[];
  deleteTodo(todoId: string): MainPersonalTodo[];
  createOrReuseLabelAndAttach(input: { todoId: string; name: string; colorKey: MainPersonalTodoLabelColorKey }): { label: MainPersonalTodoLabel; todo: MainPersonalTodo | null };
  updateLabel(labelId: string, patch: { name?: string; colorKey?: MainPersonalTodoLabelColorKey }): MainPersonalTodoLabel;
}

export function createPersonalTodoPreviewStore(
  storage: PreviewStorage = browserStorage(),
  userId: string,
): PersonalTodoPreviewStore {
  const todoKey = `${TODO_KEY_PREFIX}${keyPart(userId)}`;
  const labelKey = `${LABEL_KEY_PREFIX}${keyPart(userId)}`;
  const knownKeys = previewStorageKeys.get(storage) ?? new Set<string>();
  knownKeys.add(todoKey); knownKeys.add(labelKey);
  previewStorageKeys.set(storage, knownKeys);
  const listeners = new Set<() => void>();
  const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('bflow:preview:personal-todos')
    : null;
  const notify = () => {
    listeners.forEach((listener) => listener());
    channel?.postMessage({ userId, at: Date.now() });
  };
  const onMessage = (event: MessageEvent<{ userId?: string }>) => {
    if (event.data?.userId === userId) listeners.forEach((listener) => listener());
  };
  channel?.addEventListener('message', onMessage);

  const readRows = (): MainPersonalTodo[] => {
    try {
      const raw = storage.getItem(todoKey);
      const rows = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) return [];
      return rows.map((row, index) => ({
        ...toMainTodo(normalizePersonalTodo(row), userId, index),
        ...(row as Record<string, unknown>),
        userId,
        sortOrder: typeof (row as Record<string, unknown>).sortOrder === 'number' ? (row as Record<string, unknown>).sortOrder : index,
      })) as MainPersonalTodo[];
    } catch { return []; }
  };
  const writeRows = (rows: MainPersonalTodo[]) => {
    storage.setItem(todoKey, JSON.stringify(rows.map((row, index) => ({ ...row, userId, sortOrder: index, updatedAt: now() }))));
    notify();
  };
  const readLabelRows = (): MainPersonalTodoLabel[] => {
    try {
      const raw = storage.getItem(labelKey);
      const rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  };
  const writeLabelRows = (rows: MainPersonalTodoLabel[]) => {
    storage.setItem(labelKey, JSON.stringify(rows));
    notify();
  };

  return {
    userId,
    readTodos: () => readRows().sort((a, b) => a.sortOrder - b.sortOrder).map(toRendererTodo),
    readLabels: () => clone(readLabelRows()).map((row) => ({ id: row.id, name: row.name, colorKey: row.colorKey, createdAt: row.createdAt })),
    replaceTodos: (todos) => writeRows(todos.map((todo, index) => toMainTodo(todo, userId, index))),
    replaceLabels: (labels) => writeLabelRows(labels.map((label) => ({ ...label, updatedAt: now() }))),
    seedDeterministic: () => {
      if (readRows().length === 0) writeRows(defaultSeed(userId));
    },
    reset: () => { storage.removeItem(todoKey); storage.removeItem(labelKey); notify(); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    createTodo: (input) => {
      const rows = readRows();
      const todo = toMainTodo({
        id: input.id,
        title: input.title,
        memo: input.memo ?? '',
        status: input.status ?? 'todo',
        completed: input.status === 'done',
        priority: input.priority ?? 'none',
        pinned: input.pinned ?? false,
        labelIds: input.labelIds ?? [],
        createdAt: SEED_TIME,
        startDate: input.startDate ?? undefined,
        endDate: input.endDate ?? undefined,
        addToCalendar: input.addToCalendar,
      }, userId, rows.length);
      writeRows([...rows, todo]);
      return readRows();
    },
    patchTodo: (todoId, patch) => {
      const rows = readRows();
      const target = rows.find((row) => row.id === todoId);
      if (!target) throw new Error('not found');
      const next = toMainTodo(normalizePersonalTodo({ ...toRendererTodo(target), ...patch, startDate: patch.startDate ?? undefined, endDate: patch.endDate ?? undefined, status: patch.status ?? target.status, completed: (patch.status ?? target.status) === 'done' }), userId, target.sortOrder);
      writeRows(rows.map((row) => row.id === todoId ? next : row));
      return readRows().find((row) => row.id === todoId)!;
    },
    applyCalendarToTodoPatch: (todoId, patch) => {
      const allowed: MainPersonalTodoPatch = { title: patch.title, memo: patch.memo, startDate: patch.startDate, endDate: patch.endDate, addToCalendar: patch.addToCalendar };
      const rows = readRows();
      const target = rows.find((row) => row.id === todoId);
      if (!target) throw new Error('not found');
      const next = toMainTodo(normalizePersonalTodo({ ...toRendererTodo(target), ...allowed, startDate: allowed.startDate ?? undefined, endDate: allowed.endDate ?? undefined }), userId, target.sortOrder);
      writeRows(rows.map((row) => row.id === todoId ? next : row));
      return readRows().find((row) => row.id === todoId)!;
    },
    mutateOrder: (mutation, orderedIds) => {
      let rows = readRows();
      if (mutation.type === 'pin' || mutation.type === 'setPinned') {
        rows = rows.map((row) => row.id === mutation.todoId ? { ...row, pinned: mutation.pinned } : row);
      }
      if (mutation.type === 'status' || mutation.type === 'setStatusAndOrder') {
        rows = rows.map((row) => row.id === mutation.todoId ? { ...row, status: mutation.status, completed: mutation.status === 'done' } : row);
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered = [...orderedIds.map((id) => byId.get(id)).filter((row): row is MainPersonalTodo => Boolean(row)), ...rows.filter((row) => !orderedIds.includes(row.id))];
      writeRows(ordered);
      return readRows();
    },
    deleteTodo: (todoId) => {
      writeRows(readRows().filter((row) => row.id !== todoId));
      return readRows();
    },
    createOrReuseLabelAndAttach: (input) => {
      const labels = readLabelRows();
      const existing = labels.find((label) => label.name.trim() === input.name.trim());
      const label: MainPersonalTodoLabel = existing ?? { id: `preview-label-${Date.now()}`, name: input.name.trim(), colorKey: input.colorKey, createdAt: SEED_TIME, updatedAt: now() };
      if (!existing) writeLabelRows([...labels, label]);
      const todo = readRows().find((row) => row.id === input.todoId);
      const updatedTodo = todo ? (() => {
        const next = toMainTodo({ ...toRendererTodo(todo), labelIds: [...new Set([...todo.labelIds, label.id])] }, userId, todo.sortOrder);
        writeRows(readRows().map((row) => row.id === todo.id ? next : row));
        return next;
      })() : null;
      return { label, todo: updatedTodo };
    },
    updateLabel: (labelId, patch) => {
      const labels = readLabelRows();
      const target = labels.find((label) => label.id === labelId);
      if (!target) throw new Error('not found');
      const updated = { ...target, ...patch, updatedAt: now() };
      writeLabelRows(labels.map((label) => label.id === labelId ? updated : label));
      return updated;
    },
  };
}

export function resetPersonalTodoPreview(storage: PreviewStorage = browserStorage()): void {
  for (const key of [PREVIEW_EPOCH_KEY, SESSION_KEY, PERSONAL_TODO_PREVIEW_SESSION_KEY]) storage.removeItem(key);
  for (const key of previewStorageKeys.get(storage) ?? []) storage.removeItem(key);
}

export function createPreviewSessionController(storage: PreviewStorage = browserStorage()) {
  let currentUserId: string | null = null;
  const readEpoch = () => Number(storage.getItem(PREVIEW_EPOCH_KEY) ?? '0');
  const payload = () => ({
    user: currentUserId ? { id: currentUserId, name: currentUserId, role: 'user' as const } : null,
    session: currentUserId ? { userId: currentUserId, userName: currentUserId, loggedInAt: SEED_TIME } : null,
    epoch: readEpoch(),
  });
  const bump = () => storage.setItem(PREVIEW_EPOCH_KEY, String(readEpoch() + 1));
  return {
    ensure: () => {
      if (!currentUserId) currentUserId = storage.getItem(SESSION_KEY);
      return payload();
    },
    login: (userId: string, rememberMe = true) => {
      if (currentUserId !== userId) bump();
      currentUserId = userId;
      if (rememberMe) storage.setItem(SESSION_KEY, userId);
      else storage.removeItem(SESSION_KEY);
      return payload();
    },
    restore: () => {
      const remembered = storage.getItem(SESSION_KEY);
      if (remembered && remembered !== currentUserId) { bump(); currentUserId = remembered; }
      return payload();
    },
    logout: () => {
      if (currentUserId) bump();
      currentUserId = null;
      storage.removeItem(SESSION_KEY);
      return payload();
    },
  };
}
