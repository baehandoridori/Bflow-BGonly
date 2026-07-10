import { createUuid } from '../../../utils/createUuid.ts';
import type { PersonalTodo, SceneKey, TaskView } from './types';
import { normalizePersonalTodo } from './personalTodoDomain.ts';

export const PERSONAL_TODO_MIGRATION_MARKER = 'bflow_personal_todo_migration_v2';
const LEGACY_ASSIGNED_TODOS_KEY = 'bflow_assigned_personal_todos';
const LEGACY_SCENE_KEYS_KEY = 'bflow_assigned_scene_keys';
const LEGACY_VIEWS_KEY = 'bflow_my_task_views';

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

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; } catch { return []; }
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
  storage: Pick<Storage, 'getItem'> | null | undefined,
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

  const seen = new Set<string>();
  const todos: PersonalTodo[] = [];
  for (const raw of candidates) {
    const normalized = normalizePersonalTodo(raw);
    const id = isCanonicalPersonalTodoId(normalized.id) ? normalized.id : createUuid();
    if (seen.has(id)) continue;
    seen.add(id);
    todos.push({ ...normalized, id });
  }
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
