import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import type {
  MainCalendarTodoPatch,
  MainPersonalTodo,
  MainPersonalTodoLabel,
  MainPersonalTodoPatch,
  MainPersonalTodoResult,
  MainPersonalTodoStatus,
} from '@/types';
import type { PersonalTodo, PersonalTodoLabel, PersonalTodoPriority } from '../types';
import { applyPersonalTodoStatus, normalizePersonalTodo, splitPersonalTodos } from '../personalTodoDomain';
import {
  clearLegacyPersonalTodoStorage,
  collectLegacyPersonalTodos,
  hasPersonalTodoMigrationRun,
  markPersonalTodoMigrationDone,
} from '../personalTodoMigration';

interface ConfirmedBaseline {
  todos: PersonalTodo[];
  labels: PersonalTodoLabel[];
}

interface PersonalTodoMutationState {
  confirmedTodos: PersonalTodo[];
  confirmedLabels: PersonalTodoLabel[];
  pendingTodoIds: Set<string>;
  pendingLabelIds: Set<string>;
  orderSyncNeeded: boolean;
  sessionEpoch: number;
}

interface PendingIntent {
  key: string;
  serial: number;
  epoch: number;
  todos: PersonalTodo[];
  labels: PersonalTodoLabel[];
  order: boolean;
}

export interface UsePersonalTodosResult {
  todos: PersonalTodo[];
  labels: PersonalTodoLabel[];
  pinnedTodos: PersonalTodo[];
  normalTodos: PersonalTodo[];
  doneTodos: PersonalTodo[];
  loading: boolean;
  syncNeeded: boolean;
  addTodo: (todo: PersonalTodo) => Promise<void>;
  patchTodo: (todoId: string, patch: Partial<PersonalTodo>) => Promise<void>;
  setStatus: (todoId: string, status: MainPersonalTodoStatus) => Promise<void>;
  setPinned: (todoId: string, pinned: boolean) => Promise<void>;
  reorderGroup: (group: 'pinned' | 'normal' | 'done', reordered: PersonalTodo[]) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<void>;
  createAndAttachLabel: (input: { todoId: string; name: string; colorKey: PersonalTodoLabel['colorKey'] }) => Promise<void>;
  updateLabel: (labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabel['colorKey'] }) => Promise<void>;
  retrySync: () => Promise<void>;
}

function api() {
  return window.electronAPI;
}

function toRendererTodo(raw: MainPersonalTodo | PersonalTodo): PersonalTodo {
  return normalizePersonalTodo({
    ...raw,
    startDate: raw.startDate ?? undefined,
    endDate: raw.endDate ?? undefined,
    addToCalendar: raw.addToCalendar,
  });
}

function toRendererLabel(raw: MainPersonalTodoLabel | PersonalTodoLabel): PersonalTodoLabel {
  return { id: raw.id, name: raw.name, colorKey: raw.colorKey, createdAt: raw.createdAt };
}

function toMainInput(todo: PersonalTodo) {
  return {
    id: todo.id,
    title: todo.title,
    memo: todo.memo,
    status: todo.status,
    priority: todo.priority,
    pinned: todo.pinned,
    labelIds: todo.labelIds,
    startDate: todo.startDate ?? null,
    endDate: todo.endDate ?? null,
    addToCalendar: todo.addToCalendar ?? false,
  };
}

function asError(result: { message?: string; kind?: string; code?: string; retryable?: boolean }): Error & { kind?: string; code?: string; retryable?: boolean } {
  const error = new Error(result.message ?? '개인 할일 저장에 실패했어요.') as Error & { kind?: string; code?: string; retryable?: boolean };
  error.kind = result.kind; error.code = result.code; error.retryable = result.retryable;
  return error;
}

function isUnknown(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { kind?: string }).kind === 'unknown');
}

/** Renderer state owner for canonical, main-owned personal todos. */
export function usePersonalTodos(): UsePersonalTodosResult {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [todos, setTodos] = useState<PersonalTodo[]>([]);
  const [labels, setLabels] = useState<PersonalTodoLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncNeeded, setSyncNeeded] = useState(false);

  const confirmedBaselineRef = useRef<ConfirmedBaseline>({ todos: [], labels: [] });
  const mutationStateRef = useRef<PersonalTodoMutationState>({
    confirmedTodos: [], confirmedLabels: [], pendingTodoIds: new Set(), pendingLabelIds: new Set(), orderSyncNeeded: false, sessionEpoch: 0,
  });
  const pendingIntentsRef = useRef(new Map<string, PendingIntent>());
  const serialRef = useRef(0);
  const sessionEpochRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const userIdRef = useRef<string | null>(null);

  const publishBaseline = useCallback((baseline: ConfirmedBaseline, preservePending = true) => {
    confirmedBaselineRef.current = { todos: [...baseline.todos], labels: [...baseline.labels] };
    mutationStateRef.current.confirmedTodos = [...baseline.todos];
    mutationStateRef.current.confirmedLabels = [...baseline.labels];
    const intents = preservePending
      ? [...pendingIntentsRef.current.values()].sort((a, b) => a.serial - b.serial)
      : [];
    const latest = intents.at(-1);
    setTodos(latest ? latest.todos : baseline.todos);
    setLabels(latest ? latest.labels : baseline.labels);
  }, []);

  const readAuthoritative = useCallback(async (generation: number, epoch: number): Promise<ConfirmedBaseline | null> => {
    const [todoResult, labelResult] = await Promise.all([api().readPersonalTodos(), api().readPersonalTodoLabels()]);
    if (!todoResult.ok || !labelResult.ok) return null;
    if (generation !== loadGenerationRef.current || epoch !== sessionEpochRef.current || userIdRef.current !== currentUser?.id) return null;
    return {
      todos: todoResult.data.map(toRendererTodo),
      labels: labelResult.data.map(toRendererLabel),
    };
  }, [currentUser?.id]);

  const migrateLegacy = useCallback(async (userId: string, epoch: number) => {
    if (typeof localStorage === 'undefined' || hasPersonalTodoMigrationRun(localStorage, userId)) return;
    const legacyResult = await api().readLegacyTaskViews();
    const migration = collectLegacyPersonalTodos(localStorage, legacyResult.ok && legacyResult.data ? legacyResult.data.views : []);
    for (const todo of migration.todos) {
      const result = await api().createPersonalTodo(toMainInput(todo));
      if (!result.ok && result.kind !== 'rejected') throw asError(result);
    }
    if (migration.sceneKeys.length > 0) {
      const sceneResult = await api().upsertLegacyTaskViews([], migration.sceneKeys);
      if (!sceneResult.ok) throw asError(sceneResult);
    }
    if (epoch !== sessionEpochRef.current) return;
    markPersonalTodoMigrationDone(localStorage, userId);
    clearLegacyPersonalTodoStorage(localStorage);
  }, []);

  useEffect(() => {
    let disposed = false;
    const generation = ++loadGenerationRef.current;
    const userId = currentUser?.id ?? null;
    userIdRef.current = userId;
    pendingIntentsRef.current.clear();
    mutationStateRef.current.pendingTodoIds.clear();
    mutationStateRef.current.pendingLabelIds.clear();
    setSyncNeeded(false);
    setLoading(true);
    if (!userId) {
      sessionEpochRef.current++;
      publishBaseline({ todos: [], labels: [] }, false);
      setLoading(false);
      return () => { disposed = true; };
    }
    (async () => {
      const session = await api().ensureCanonicalSession();
      if (disposed || generation !== loadGenerationRef.current) return;
      const canonicalUserId = session.payload.user?.id ?? null;
      if (session.payload.epoch !== sessionEpochRef.current || canonicalUserId !== userIdRef.current) {
        sessionEpochRef.current = session.payload.epoch;
        mutationStateRef.current.sessionEpoch = session.payload.epoch;
      }
      if (canonicalUserId !== userId) {
        publishBaseline({ todos: [], labels: [] }, false);
        setLoading(false);
        return;
      }
      try {
        await migrateLegacy(userId, sessionEpochRef.current);
        const baseline = await readAuthoritative(generation, sessionEpochRef.current);
        if (!baseline || disposed) return;
        publishBaseline(baseline, false);
      } catch (error) {
        console.error('[MyTasks] 개인 할일 초기 로드 실패', error);
        publishBaseline({ todos: [], labels: [] }, false);
      } finally {
        if (!disposed && generation === loadGenerationRef.current) setLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, [currentUser?.id, migrateLegacy, publishBaseline, readAuthoritative]);

  useEffect(() => {
    const cleanup = api().onPersonalTodoCommit((payload) => {
      const event = (payload ?? {}) as { userId?: string; epoch?: number };
      if (event.userId && event.userId !== userIdRef.current) return;
      if (event.epoch !== undefined && event.epoch !== sessionEpochRef.current) return;
      const generation = loadGenerationRef.current;
      const epoch = sessionEpochRef.current;
      readAuthoritative(generation, epoch).then((baseline) => {
        if (baseline) publishBaseline(baseline, true);
      }).catch(() => { /* realtime reads are retried by the next commit/manual action */ });
    });
    return cleanup;
  }, [publishBaseline, readAuthoritative]);

  const runMutation = useCallback(async (
    key: string,
    optimisticTodos: PersonalTodo[],
    optimisticLabels: PersonalTodoLabel[],
    execute: () => Promise<MainPersonalTodoResult<unknown>>,
    order = false,
  ) => {
    const epoch = sessionEpochRef.current;
    const intent: PendingIntent = { key, serial: ++serialRef.current, epoch, todos: optimisticTodos, labels: optimisticLabels, order };
    pendingIntentsRef.current.set(key, intent);
    mutationStateRef.current.pendingTodoIds = new Set([...pendingIntentsRef.current.values()].filter((item) => !item.key.startsWith('label:')).map((item) => item.key));
    setTodos(optimisticTodos); setLabels(optimisticLabels);
    const accept = (result: MainPersonalTodoResult<unknown>) => {
      if (!result.ok) throw asError(result);
      let baseline = { ...confirmedBaselineRef.current };
      if (Array.isArray(result.data)) baseline.todos = result.data.map((row) => toRendererTodo(row as MainPersonalTodo));
      else if (result.data && typeof result.data === 'object' && 'todo' in result.data) {
        const todo = (result.data as { todo?: MainPersonalTodo | null }).todo;
        if (todo) baseline.todos = baseline.todos.map((item) => item.id === todo.id ? toRendererTodo(todo) : item);
        const label = (result.data as { label?: MainPersonalTodoLabel }).label;
        if (label) baseline.labels = [...baseline.labels.filter((item) => item.id !== label.id), toRendererLabel(label)];
      } else if (result.data && typeof result.data === 'object' && 'id' in result.data && key.startsWith('label:')) {
        const label = result.data as MainPersonalTodoLabel;
        baseline.labels = [...baseline.labels.filter((item) => item.id !== label.id), toRendererLabel(label)];
      } else if (result.data && typeof result.data === 'object' && 'id' in result.data) {
        const todo = toRendererTodo(result.data as MainPersonalTodo);
        baseline.todos = [...baseline.todos.filter((item) => item.id !== todo.id), todo];
      }
      return baseline;
    };
    try {
      let result = await execute();
      if (!result.ok && result.kind === 'unknown') result = await execute();
      if (!result.ok && result.kind === 'unknown') {
        const authoritative = await readAuthoritative(loadGenerationRef.current, epoch);
        if (authoritative) {
          if (epoch === sessionEpochRef.current) publishBaseline(authoritative, true);
        } else {
          mutationStateRef.current.orderSyncNeeded = order;
          setSyncNeeded(true);
        }
      } else {
        const baseline = accept(result);
        if (epoch === sessionEpochRef.current && userIdRef.current === currentUser?.id) publishBaseline(baseline, true);
      }
    } catch (error) {
      if (isUnknown(error)) {
        const authoritative = await readAuthoritative(loadGenerationRef.current, epoch);
        if (authoritative) publishBaseline(authoritative, true);
        else { mutationStateRef.current.orderSyncNeeded = order; setSyncNeeded(true); }
      } else if (epoch === sessionEpochRef.current) {
        publishBaseline(confirmedBaselineRef.current, true);
      }
    } finally {
      pendingIntentsRef.current.delete(key);
      mutationStateRef.current.pendingTodoIds = new Set([...pendingIntentsRef.current.keys()].filter((item) => !item.startsWith('label:')));
      mutationStateRef.current.pendingLabelIds = new Set([...pendingIntentsRef.current.keys()].filter((item) => item.startsWith('label:')));
      const latest = [...pendingIntentsRef.current.values()].sort((a, b) => a.serial - b.serial).at(-1);
      if (latest) { setTodos(latest.todos); setLabels(latest.labels); }
      else { setTodos(confirmedBaselineRef.current.todos); setLabels(confirmedBaselineRef.current.labels); }
    }
  }, [currentUser?.id, publishBaseline, readAuthoritative]);

  const addTodo = useCallback(async (todo: PersonalTodo) => {
    const next = [...todos, todo];
    await runMutation(`todo:${todo.id}:${serialRef.current + 1}`, next, labels, () => api().createPersonalTodo(toMainInput(todo)), false);
  }, [labels, runMutation, todos]);

  const patchTodo = useCallback(async (todoId: string, patch: Partial<PersonalTodo>) => {
    const current = todos.find((todo) => todo.id === todoId);
    if (!current) return;
    const nextTodo = normalizePersonalTodo({ ...current, ...patch, status: patch.status ?? current.status, completed: (patch.status ?? current.status) === 'done' });
    const next = todos.map((todo) => todo.id === todoId ? nextTodo : todo);
    const bridgePatch: MainPersonalTodoPatch = { ...patch, status: nextTodo.status, title: nextTodo.title, memo: nextTodo.memo, priority: nextTodo.priority as PersonalTodoPriority, labelIds: nextTodo.labelIds, startDate: nextTodo.startDate ?? null, endDate: nextTodo.endDate ?? null, addToCalendar: nextTodo.addToCalendar ?? false };
    await runMutation(`todo:${todoId}:${serialRef.current + 1}`, next, labels, () => api().patchPersonalTodo(todoId, bridgePatch), false);
  }, [labels, runMutation, todos]);

  const setStatus = useCallback(async (todoId: string, status: MainPersonalTodoStatus) => {
    const current = todos.find((todo) => todo.id === todoId);
    if (!current) return;
    const nextTodo = applyPersonalTodoStatus(current, status);
    const next = todos.map((todo) => todo.id === todoId ? nextTodo : todo);
    await runMutation(`todo:${todoId}:${serialRef.current + 1}`, next, labels, () => api().mutatePersonalTodoOrder({ type: 'setStatusAndOrder', todoId, status }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const setPinned = useCallback(async (todoId: string, pinned: boolean) => {
    const next = todos.map((todo) => todo.id === todoId ? { ...todo, pinned } : todo);
    await runMutation(`todo:${todoId}:${serialRef.current + 1}`, next, labels, () => api().mutatePersonalTodoOrder({ type: 'setPinned', todoId, pinned }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const reorderGroup = useCallback(async (group: 'pinned' | 'normal' | 'done', reordered: PersonalTodo[]) => {
    const groups = splitPersonalTodos(todos);
    // The legacy widget sends one combined pending list for the normal drag
    // surface. Split that list back into pinned/normal buckets before writing
    // the canonical order so a pinned row is never duplicated.
    if (group === 'normal') {
      groups.pinned = reordered.filter((todo) => todo.pinned);
      groups.normal = reordered.filter((todo) => !todo.pinned);
    } else {
      groups[group] = reordered;
    }
    const next = [...groups.pinned, ...groups.normal, ...groups.done];
    await runMutation('order', next, labels, () => api().mutatePersonalTodoOrder({ type: 'reorder' }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const deleteTodo = useCallback(async (todoId: string) => {
    await runMutation(`todo:${todoId}:${serialRef.current + 1}`, todos.filter((todo) => todo.id !== todoId), labels, () => api().deletePersonalTodo(todoId), false);
  }, [labels, runMutation, todos]);

  const createAndAttachLabel = useCallback(async (input: { todoId: string; name: string; colorKey: PersonalTodoLabel['colorKey'] }) => {
    const optimisticLabel: PersonalTodoLabel = { id: `pending-label-${Date.now()}`, name: input.name, colorKey: input.colorKey, createdAt: new Date().toISOString() };
    const nextLabels = [...labels, optimisticLabel];
    const nextTodos = todos.map((todo) => todo.id === input.todoId ? { ...todo, labelIds: [...new Set([...todo.labelIds, optimisticLabel.id])] } : todo);
    await runMutation(`label:${optimisticLabel.id}`, nextTodos, nextLabels, () => api().createOrReusePersonalTodoLabelAndAttach(input), false);
  }, [labels, runMutation, todos]);

  const updateLabel = useCallback(async (labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabel['colorKey'] }) => {
    const nextLabels = labels.map((label) => label.id === labelId ? { ...label, ...patch } : label);
    await runMutation(`label:${labelId}`, todos, nextLabels, () => api().updatePersonalTodoLabel(labelId, patch), false);
  }, [labels, runMutation, todos]);

  const retrySync = useCallback(async () => {
    const baseline = await readAuthoritative(loadGenerationRef.current, sessionEpochRef.current);
    if (!baseline) return;
    publishBaseline(baseline, false);
    mutationStateRef.current.orderSyncNeeded = false;
    setSyncNeeded(false);
  }, [publishBaseline, readAuthoritative]);

  const groups = useMemo(() => splitPersonalTodos(todos), [todos]);
  return {
    todos, labels,
    pinnedTodos: groups.pinned,
    normalTodos: groups.normal,
    doneTodos: groups.done,
    loading, syncNeeded,
    addTodo, patchTodo, setStatus, setPinned, reorderGroup, deleteTodo,
    createAndAttachLabel, updateLabel, retrySync,
  };
}
