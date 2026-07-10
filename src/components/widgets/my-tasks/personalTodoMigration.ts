import { createUuid } from '../../../utils/createUuid.ts';
import type { PersonalTodo, SceneKey, TaskView } from './types';
import { normalizePersonalTodo } from './personalTodoDomain.ts';

export const PERSONAL_TODO_MIGRATION_MARKER = 'bflow_personal_todo_migration_v2';
const LEGACY_ASSIGNED_TODOS_KEY = 'bflow_assigned_personal_todos';
const LEGACY_SCENE_KEYS_KEY = 'bflow_assigned_scene_keys';
const LEGACY_VIEWS_KEY = 'bflow_my_task_views';
const LEGACY_ID_MAP_KEY = 'bflow_personal_todo_legacy_id_map_v1';

export interface LegacyPersonalTodoMigration {
  todos: PersonalTodo[];
  sceneKeys: SceneKey[];
}

export interface PersonalTodoIntentIdentity {
  epoch: number;
  userId: string | null;
  generation: number;
}

export function isPersonalTodoIntentCurrent(
  intent: PersonalTodoIntentIdentity,
  current: PersonalTodoIntentIdentity,
): boolean {
  return intent.epoch === current.epoch
    && intent.userId === current.userId
    && intent.generation === current.generation;
}

export function makePersonalTodoMutationKey(kind: 'todo' | 'label' | 'order', id: string, serial: number): string {
  return `${kind}:${id}:${serial}`;
}

export function advancePersonalTodoSessionEpoch(previousUserId: string | null, nextUserId: string | null, epoch: number): number {
  return previousUserId === nextUserId ? epoch : epoch + 1;
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
}

function readLegacyIdMap(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  const raw = storage.getItem(LEGACY_ID_MAP_KEY);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, id]) => typeof key === 'string' && isCanonicalPersonalTodoId(id)));
  } catch { return {}; }
}

export function isCanonicalPersonalTodoId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

/**
 * Flatten the pre-canonical local/task-view formats exactly once. The normalizer
 * intentionally receives the original row so legacy completed/status precedence,
 * dates, and calendar links are not lost during migration.
 */
export function collectLegacyPersonalTodos(
  storage: (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>) | null | undefined,
  taskViews: unknown[] = [],
): LegacyPersonalTodoMigration {
  const candidates: unknown[] = [
    ...parseArray(storage?.getItem(LEGACY_ASSIGNED_TODOS_KEY) ?? null),
  ];
  const sceneKeys: SceneKey[] = [];
  for (const rawView of taskViews) {
    const view = (rawView && typeof rawView === 'object' ? rawView : {}) as Partial<TaskView>;
    candidates.push(...(Array.isArray(view.personalTodos) ? view.personalTodos : []));
    if (Array.isArray(view.sceneKeys)) sceneKeys.push(...view.sceneKeys.filter((key): key is string => typeof key === 'string'));
  }
  sceneKeys.push(...parseArray(storage?.getItem(LEGACY_SCENE_KEYS_KEY) ?? null).filter((key): key is string => typeof key === 'string'));

  const seenLegacyIds = new Set<string>();
  const legacyIdMap = readLegacyIdMap(storage ?? { getItem: () => null });
  let legacyIdMapChanged = false;
  const todos: PersonalTodo[] = [];
  for (const raw of candidates) {
    const normalized = normalizePersonalTodo(raw);
    const legacyId = normalized.id.trim();
    if (legacyId && seenLegacyIds.has(legacyId)) continue;
    if (legacyId) seenLegacyIds.add(legacyId);
    let id = normalized.id;
    if (!isCanonicalPersonalTodoId(id)) {
      const mapped = legacyIdMap[legacyId];
      id = mapped ?? createUuid();
      if (!mapped && legacyId) {
        legacyIdMap[legacyId] = id;
        legacyIdMapChanged = true;
      }
    }
    todos.push({ ...normalized, id });
  }
  if (legacyIdMapChanged) storage?.setItem?.(LEGACY_ID_MAP_KEY, JSON.stringify(legacyIdMap));
  return { todos, sceneKeys: [...new Set(sceneKeys)] };
}

export function migrationMarkerKey(userId: string): string {
  return `${PERSONAL_TODO_MIGRATION_MARKER}:${userId}`;
}

export function hasPersonalTodoMigrationRun(storage: Pick<Storage, 'getItem'> | null | undefined, userId: string): boolean {
  return storage?.getItem(migrationMarkerKey(userId)) === 'done';
}

export function markPersonalTodoMigrationDone(storage: Pick<Storage, 'setItem'> | null | undefined, userId: string): void {
  storage?.setItem(migrationMarkerKey(userId), 'done');
}

export function clearLegacyPersonalTodoStorage(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  storage?.removeItem(LEGACY_ASSIGNED_TODOS_KEY);
  storage?.removeItem(LEGACY_SCENE_KEYS_KEY);
  storage?.removeItem(LEGACY_VIEWS_KEY);
}
