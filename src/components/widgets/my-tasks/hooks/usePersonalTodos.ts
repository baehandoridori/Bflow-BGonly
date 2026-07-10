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
import { applyPersonalTodoStatus, movePersonalTodoToGroupTail, normalizePersonalTodo, personalTodoOrderMatches, splitPersonalTodos } from '../personalTodoDomain';
import {
  clearLegacyPersonalTodoStorage,
  collectLegacyPersonalTodos,
  advancePersonalTodoSessionEpoch,
  hasPersonalTodoMigrationRun,
  isPersonalTodoIntentCurrent,
  makePersonalTodoMutationKey,
  markPersonalTodoMigrationDone,
  type PersonalTodoIntentIdentity,
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
  pendingLabelIds: ReadonlySet<string>;
  pinnedTodos: PersonalTodo[];
  normalTodos: PersonalTodo[];
  doneTodos: PersonalTodo[];
  loading: boolean;
  syncNeeded: boolean;
  addTodo: (todo: PersonalTodo) => Promise<void>;
  patchTodo: (todoId: string, patch: Partial<PersonalTodo>) => Promise<void>;
  setStatus: (todoId: string, status: MainPersonalTodoStatus) => Promise<boolean>;
  setPinned: (todoId: string, pinned: boolean) => Promise<boolean>;
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
  const [pendingLabelIds, setPendingLabelIds] = useState<Set<string>>(new Set());
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
    const liveUserId = useAuthStore.getState().currentUser?.id ?? null;
    if (generation !== loadGenerationRef.current || epoch !== sessionEpochRef.current || userIdRef.current !== liveUserId) return null;
    return {
      todos: todoResult.data.map(toRendererTodo),
      labels: labelResult.data.map(toRendererLabel),
    };
  }, [currentUser?.id]);

  const migrateLegacy = useCallback(async (userId: string, epoch: number, generation: number) => {
    if (typeof localStorage === 'undefined' || hasPersonalTodoMigrationRun(localStorage, userId)) return;
    if (!isPersonalTodoIntentCurrent({ epoch, userId, generation }, {
      epoch: sessionEpochRef.current,
      userId: useAuthStore.getState().currentUser?.id ?? null,
      generation: loadGenerationRef.current,
    })) return;
    const legacyResult = await api().readLegacyTaskViews();
    if (!isPersonalTodoIntentCurrent({ epoch, userId, generation }, {
      epoch: sessionEpochRef.current,
      userId: useAuthStore.getState().currentUser?.id ?? null,
      generation: loadGenerationRef.current,
    })) return;
    if (!legacyResult.ok) return;
    const migration = collectLegacyPersonalTodos(localStorage, legacyResult.ok && legacyResult.data ? legacyResult.data.views : []);
    // Legacy storage predates user scoping. If another user already consumed
    // the global keys, do not mark this user as migrated from an empty read.
    if (migration.todos.length === 0 && migration.sceneKeys.length === 0) return;
    for (const todo of migration.todos) {
      if (!isPersonalTodoIntentCurrent({ epoch, userId, generation }, { epoch: sessionEpochRef.current, userId: useAuthStore.getState().currentUser?.id ?? null, generation: loadGenerationRef.current })) return;
      const result = await api().createPersonalTodo(toMainInput(todo));
      if (!result.ok) throw asError(result);
    }
    if (migration.sceneKeys.length > 0) {
      if (!isPersonalTodoIntentCurrent({ epoch, userId, generation }, { epoch: sessionEpochRef.current, userId: useAuthStore.getState().currentUser?.id ?? null, generation: loadGenerationRef.current })) return;
      const sceneResult = await api().upsertLegacyTaskViews([], migration.sceneKeys);
      if (!sceneResult.ok) throw asError(sceneResult);
    }
    if (!isPersonalTodoIntentCurrent({ epoch, userId, generation }, { epoch: sessionEpochRef.current, userId: useAuthStore.getState().currentUser?.id ?? null, generation: loadGenerationRef.current })) return;
    markPersonalTodoMigrationDone(localStorage, userId);
    clearLegacyPersonalTodoStorage(localStorage);
  }, []);

  useEffect(() => {
    let disposed = false;
    const userId = currentUser?.id ?? null;
    const previousUserId = userIdRef.current;
    const generation = ++loadGenerationRef.current;
    sessionEpochRef.current = advancePersonalTodoSessionEpoch(previousUserId, userId, sessionEpochRef.current);
    userIdRef.current = userId;
    pendingIntentsRef.current.clear();
    mutationStateRef.current.pendingTodoIds.clear();
    mutationStateRef.current.pendingLabelIds.clear();
    setPendingLabelIds(new Set());
    if (previousUserId !== userId) {
      confirmedBaselineRef.current = { todos: [], labels: [] };
      mutationStateRef.current.confirmedTodos = [];
      mutationStateRef.current.confirmedLabels = [];
      setTodos([]);
      setLabels([]);
    }
    setSyncNeeded(false);
    setLoading(true);
    if (!userId) {
      publishBaseline({ todos: [], labels: [] }, false);
      setLoading(false);
      return () => { disposed = true; };
    }
    (async () => {
      const session = await api().ensureCanonicalSession();
      if (disposed || generation !== loadGenerationRef.current) return;
      const canonicalUserId = session.payload.user?.id ?? null;
      if (session.payload.epoch > sessionEpochRef.current || canonicalUserId !== userIdRef.current) {
        sessionEpochRef.current = Math.max(sessionEpochRef.current, session.payload.epoch);
      }
      mutationStateRef.current.sessionEpoch = sessionEpochRef.current;
      if (canonicalUserId !== userId) {
        publishBaseline({ todos: [], labels: [] }, false);
        setLoading(false);
        return;
      }
      try {
        await migrateLegacy(userId, sessionEpochRef.current, generation);
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
      if (event.epoch !== undefined && event.epoch > sessionEpochRef.current) {
        sessionEpochRef.current = event.epoch;
        mutationStateRef.current.sessionEpoch = event.epoch;
      }
      const generation = loadGenerationRef.current;
      const epoch = sessionEpochRef.current;
      readAuthoritative(generation, epoch).then((baseline) => {
        if (baseline) publishBaseline(baseline, true);
      }).catch(() => { /* realtime reads are retried by the next commit/manual action */ });
    });
    return cleanup;
  }, [publishBaseline, readAuthoritative]);

  useEffect(() => {
    const cleanup = api().onCalendarChanged((payload) => {
      const event = (payload ?? {}) as { userId?: string; action?: string };
      if (event.userId && event.userId !== userIdRef.current) return;
      if (event.action !== 'sync-needed') return;
      mutationStateRef.current.orderSyncNeeded = true;
      setSyncNeeded(true);
    });
    return cleanup;
  }, []);

  const runMutation = useCallback(async (
    key: string,
    optimisticTodos: PersonalTodo[],
    optimisticLabels: PersonalTodoLabel[],
    execute: () => Promise<MainPersonalTodoResult<unknown>>,
    order = false,
  ) => {
    const intentIdentity: PersonalTodoIntentIdentity = {
      epoch: sessionEpochRef.current,
      userId: userIdRef.current,
      generation: loadGenerationRef.current,
    };
    const epoch = intentIdentity.epoch;
    const intent: PendingIntent = { key, serial: ++serialRef.current, epoch, todos: optimisticTodos, labels: optimisticLabels, order };
    pendingIntentsRef.current.set(key, intent);
    mutationStateRef.current.pendingTodoIds = new Set([...pendingIntentsRef.current.values()].filter((item) => !item.key.startsWith('label:')).map((item) => item.key));
    setPendingLabelIds(new Set([...pendingIntentsRef.current.keys()].filter((item) => item.startsWith('label:')).map((item) => item.slice('label:'.length))));
    setTodos(optimisticTodos); setLabels(optimisticLabels);
    let committed = false;
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
    const isCurrentIntent = () => isPersonalTodoIntentCurrent(intentIdentity, {
      epoch: sessionEpochRef.current,
      userId: useAuthStore.getState().currentUser?.id ?? null,
      generation: loadGenerationRef.current,
    });
    const authoritativeMatchesIntent = (baseline: ConfirmedBaseline) => !order || personalTodoOrderMatches(baseline.todos, optimisticTodos);
    try {
      let result: MainPersonalTodoResult<unknown>;
      let retried = false;
      try {
        result = await execute();
      } catch (error) {
        if (!isUnknown(error)) throw error;
        // IPC can reject instead of returning a typed unknown result. Treat
        // that shape exactly like the bridge result and retry once.
        retried = true;
        result = await execute();
      }
      if (!isCurrentIntent()) return committed;
      if (!result.ok && result.kind === 'unknown' && !retried) {
        retried = true;
        result = await execute();
      }
      if (!isCurrentIntent()) return committed;
      if (!result.ok && result.kind === 'unknown') {
        const authoritative = await readAuthoritative(loadGenerationRef.current, epoch);
        if (authoritative && isCurrentIntent() && authoritativeMatchesIntent(authoritative)) {
          publishBaseline(authoritative, true);
          committed = true;
        } else if (authoritative && isCurrentIntent()) {
          publishBaseline(authoritative, true);
          mutationStateRef.current.orderSyncNeeded = true;
          setSyncNeeded(true);
        } else if (!authoritative) {
          mutationStateRef.current.orderSyncNeeded = order;
          setSyncNeeded(true);
        }
      } else {
        const baseline = accept(result);
        if (isCurrentIntent()) {
          publishBaseline(baseline, true);
          committed = true;
        }
      }
    } catch (error) {
      if (isUnknown(error)) {
        const authoritative = await readAuthoritative(loadGenerationRef.current, epoch);
        if (!isCurrentIntent()) return committed;
        if (authoritative && authoritativeMatchesIntent(authoritative)) {
          publishBaseline(authoritative, true);
          committed = true;
        } else if (authoritative) {
          publishBaseline(authoritative, true);
          mutationStateRef.current.orderSyncNeeded = true;
          setSyncNeeded(true);
        } else { mutationStateRef.current.orderSyncNeeded = order; setSyncNeeded(true); }
      } else if (isCurrentIntent()) {
        publishBaseline(confirmedBaselineRef.current, true);
      }
    } finally {
      if (!isCurrentIntent()) return committed;
      if (pendingIntentsRef.current.get(key)?.serial === intent.serial) pendingIntentsRef.current.delete(key);
      mutationStateRef.current.pendingTodoIds = new Set([...pendingIntentsRef.current.keys()].filter((item) => !item.startsWith('label:')));
      mutationStateRef.current.pendingLabelIds = new Set([...pendingIntentsRef.current.keys()].filter((item) => item.startsWith('label:')));
      setPendingLabelIds(new Set([...pendingIntentsRef.current.keys()].filter((item) => item.startsWith('label:')).map((item) => item.slice('label:'.length))));
      const latest = [...pendingIntentsRef.current.values()].sort((a, b) => a.serial - b.serial).at(-1);
      if (latest) { setTodos(latest.todos); setLabels(latest.labels); }
      else { setTodos(confirmedBaselineRef.current.todos); setLabels(confirmedBaselineRef.current.labels); }
      return committed;
    }
  }, [currentUser?.id, publishBaseline, readAuthoritative]);

  const addTodo = useCallback(async (todo: PersonalTodo) => {
    const persistedTodo = todo.addToCalendar && !todo.startDate && !todo.endDate
      ? { ...todo, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) }
      : todo;
    const next = [...todos, persistedTodo];
    await runMutation(makePersonalTodoMutationKey('todo', persistedTodo.id, serialRef.current + 1), next, labels, () => api().createPersonalTodo(toMainInput(persistedTodo)), false);
  }, [labels, runMutation, todos]);

  const patchTodo = useCallback(async (todoId: string, patch: Partial<PersonalTodo>) => {
    const current = todos.find((todo) => todo.id === todoId);
    if (!current) return;
    const nextTodo = normalizePersonalTodo({ ...current, ...patch, status: patch.status ?? current.status, completed: (patch.status ?? current.status) === 'done' });
    const hasCalendarDateDefaults = nextTodo.addToCalendar && !nextTodo.startDate && !nextTodo.endDate;
    if (nextTodo.addToCalendar && !nextTodo.startDate && !nextTodo.endDate) {
      const today = new Date().toISOString().slice(0, 10);
      nextTodo.startDate = today;
      nextTodo.endDate = today;
    }
    const next = todos.map((todo) => todo.id === todoId ? nextTodo : todo);
    const has = (key: keyof PersonalTodo) => Object.prototype.hasOwnProperty.call(patch, key);
    const bridgePatch: MainPersonalTodoPatch = {};
    // Send only fields changed by this editor. Re-sending the whole stale row
    // could overwrite another window's edit, and status changes must go through
    // the order/status RPC so done-boundary rules remain intact.
    if (has('title')) bridgePatch.title = nextTodo.title;
    if (has('memo')) bridgePatch.memo = nextTodo.memo;
    if (has('priority')) bridgePatch.priority = nextTodo.priority as PersonalTodoPriority;
    if (has('labelIds')) bridgePatch.labelIds = [...nextTodo.labelIds];
    if (has('addToCalendar')) bridgePatch.addToCalendar = nextTodo.addToCalendar ?? false;
    if (has('startDate') || hasCalendarDateDefaults) bridgePatch.startDate = nextTodo.startDate ?? null;
    if (has('endDate') || hasCalendarDateDefaults) bridgePatch.endDate = nextTodo.endDate ?? null;
    if (Object.keys(bridgePatch).length === 0) return;
    await runMutation(makePersonalTodoMutationKey('todo', todoId, serialRef.current + 1), next, labels, () => api().patchPersonalTodo(todoId, bridgePatch), false);
  }, [labels, runMutation, todos]);

  const setStatus = useCallback(async (todoId: string, status: MainPersonalTodoStatus) => {
    const current = todos.find((todo) => todo.id === todoId);
    if (!current) return false;
    const nextTodo = applyPersonalTodoStatus(current, status);
    const next = movePersonalTodoToGroupTail(todos, nextTodo);
    return runMutation(makePersonalTodoMutationKey('todo', todoId, serialRef.current + 1), next, labels, () => api().mutatePersonalTodoOrder({ type: 'setStatusAndOrder', todoId, status }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const setPinned = useCallback(async (todoId: string, pinned: boolean) => {
    const current = todos.find((todo) => todo.id === todoId);
    if (!current) return false;
    const next = movePersonalTodoToGroupTail(todos, { ...current, pinned });
    return runMutation(makePersonalTodoMutationKey('todo', todoId, serialRef.current + 1), next, labels, () => api().mutatePersonalTodoOrder({ type: 'setPinned', todoId, pinned }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const reorderGroup = useCallback(async (group: 'pinned' | 'normal' | 'done', reordered: PersonalTodo[]) => {
    const groups = splitPersonalTodos(todos);
    // The legacy widget sends one combined pending list for the normal drag
    // surface. Split that list back into pinned/normal buckets before writing
    // the canonical order so a pinned row is never duplicated.
    if (group === 'normal') {
      // The current widget sends normalTodos only; preserve the pinned bucket
      // in that case. Keep the legacy combined-list compatibility when a
      // pinned item is present in the payload.
      if (reordered.some((todo) => todo.pinned)) groups.pinned = reordered.filter((todo) => todo.pinned);
      groups.normal = reordered.filter((todo) => !todo.pinned);
    } else {
      groups[group] = reordered;
    }
    const next = [...groups.pinned, ...groups.normal, ...groups.done];
    await runMutation(makePersonalTodoMutationKey('order', 'all', serialRef.current + 1), next, labels, () => api().mutatePersonalTodoOrder({ type: 'reorder' }, next.map((todo) => todo.id)), true);
  }, [labels, runMutation, todos]);

  const deleteTodo = useCallback(async (todoId: string) => {
    await runMutation(makePersonalTodoMutationKey('todo', todoId, serialRef.current + 1), todos.filter((todo) => todo.id !== todoId), labels, () => api().deletePersonalTodo(todoId), false);
  }, [labels, runMutation, todos]);

  const createAndAttachLabel = useCallback(async (input: { todoId: string; name: string; colorKey: PersonalTodoLabel['colorKey'] }) => {
    const optimisticLabel: PersonalTodoLabel = { id: `pending-label-${Date.now()}`, name: input.name, colorKey: input.colorKey, createdAt: new Date().toISOString() };
    const nextLabels = [...labels, optimisticLabel];
    const nextTodos = todos.map((todo) => todo.id === input.todoId ? { ...todo, labelIds: [...new Set([...todo.labelIds, optimisticLabel.id])] } : todo);
    await runMutation(makePersonalTodoMutationKey('label', optimisticLabel.id, serialRef.current + 1), nextTodos, nextLabels, () => api().createOrReusePersonalTodoLabelAndAttach(input), false);
  }, [labels, runMutation, todos]);

  const updateLabel = useCallback(async (labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabel['colorKey'] }) => {
    const nextLabels = labels.map((label) => label.id === labelId ? { ...label, ...patch } : label);
    await runMutation(makePersonalTodoMutationKey('label', labelId, serialRef.current + 1), todos, nextLabels, () => api().updatePersonalTodoLabel(labelId, patch), false);
  }, [labels, runMutation, todos]);

  const retrySync = useCallback(async () => {
    const calendarRetry = await api().retryPersonalTodoCalendar();
    if (!calendarRetry.ok) {
      setSyncNeeded(true);
      return;
    }
    const baseline = await readAuthoritative(loadGenerationRef.current, sessionEpochRef.current);
    if (!baseline) return;
    publishBaseline(baseline, false);
    mutationStateRef.current.orderSyncNeeded = false;
    setSyncNeeded(false);
  }, [publishBaseline, readAuthoritative]);

  // Effects run after render; hide the previous user's rows during that short
  // transition window instead of painting them under the new session.
  const sessionAligned = (currentUser?.id ?? null) === userIdRef.current;
  const visibleTodos = sessionAligned ? todos : [];
  const visibleLabels = sessionAligned ? labels : [];
  const groups = useMemo(() => splitPersonalTodos(visibleTodos), [visibleTodos]);
  return {
    todos: visibleTodos, labels: visibleLabels, pendingLabelIds,
    pinnedTodos: groups.pinned,
    normalTodos: groups.normal,
    doneTodos: groups.done,
    loading, syncNeeded,
    addTodo, patchTodo, setStatus, setPinned, reorderGroup, deleteTodo,
    createAndAttachLabel, updateLabel, retrySync,
  };
}
