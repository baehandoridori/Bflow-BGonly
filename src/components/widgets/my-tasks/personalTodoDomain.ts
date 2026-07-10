import type {
  PersonalTodo,
  PersonalTodoLabel,
  PersonalTodoLabelColorKey,
  PersonalTodoPriority,
  PersonalTodoStatus,
} from './types';

export interface PersonalTodoGroups {
  pinned: PersonalTodo[];
  normal: PersonalTodo[];
  done: PersonalTodo[];
}

export interface PersonalTodoNextAction {
  label: '시작하기' | '완료하기' | '다시 열기';
  nextStatus: PersonalTodoStatus;
}

export interface PersonalTodoLabelSummary {
  visible: PersonalTodoLabel[];
  hiddenCount: number;
}

export interface PersonalTodoPriorityPresentation {
  label: '높음' | '보통' | '낮음' | '없음';
  colorKey: PersonalTodoLabelColorKey;
}

export type PersonalTodoInput = Pick<PersonalTodo, 'id' | 'title'> &
  Partial<Omit<PersonalTodo, 'id' | 'title'>>;

const STATUSES: readonly PersonalTodoStatus[] = ['todo', 'doing', 'done'];
const PRIORITIES: readonly PersonalTodoPriority[] = ['high', 'medium', 'low', 'none'];

const NEXT_ACTIONS: Record<PersonalTodoStatus, PersonalTodoNextAction> = {
  todo: { label: '시작하기', nextStatus: 'doing' },
  doing: { label: '완료하기', nextStatus: 'done' },
  done: { label: '다시 열기', nextStatus: 'todo' },
};

const PRIORITY_PRESENTATIONS: Record<PersonalTodoPriority, PersonalTodoPriorityPresentation> = {
  high: { label: '높음', colorKey: 'red' },
  medium: { label: '보통', colorKey: 'orange' },
  low: { label: '낮음', colorKey: 'blue' },
  none: { label: '없음', colorKey: 'gray' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPersonalTodoStatus(value: unknown): value is PersonalTodoStatus {
  return typeof value === 'string' && STATUSES.includes(value as PersonalTodoStatus);
}

function isPersonalTodoPriority(value: unknown): value is PersonalTodoPriority {
  return typeof value === 'string' && PRIORITIES.includes(value as PersonalTodoPriority);
}

function uniqueLabelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string'))];
}

export function normalizePersonalTodo(raw: unknown): PersonalTodo {
  const value = isRecord(raw) ? raw : {};
  const hasStatusValue = Object.prototype.hasOwnProperty.call(value, 'status');
  const status = isPersonalTodoStatus(value.status)
    ? value.status
    : hasStatusValue
      ? 'todo'
      : value.completed === true
        ? 'done'
        : 'todo';

  const todo: PersonalTodo = {
    id: typeof value.id === 'string' ? value.id : '',
    title: typeof value.title === 'string' ? value.title : '',
    memo: typeof value.memo === 'string' ? value.memo : '',
    status,
    completed: status === 'done',
    priority: isPersonalTodoPriority(value.priority) ? value.priority : 'none',
    pinned: value.pinned === true,
    labelIds: uniqueLabelIds(value.labelIds),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
  };

  if (typeof value.startDate === 'string') todo.startDate = value.startDate;
  if (typeof value.endDate === 'string') todo.endDate = value.endDate;
  if (typeof value.addToCalendar === 'boolean') todo.addToCalendar = value.addToCalendar;

  return todo;
}

export function createPersonalTodo(input: PersonalTodoInput): PersonalTodo {
  return normalizePersonalTodo(input);
}

export function applyPersonalTodoStatus(todo: PersonalTodo, status: PersonalTodoStatus): PersonalTodo {
  return { ...todo, status, completed: status === 'done' };
}

export function splitPersonalTodos(todos: PersonalTodo[]): PersonalTodoGroups {
  const groups: PersonalTodoGroups = { pinned: [], normal: [], done: [] };

  for (const todo of todos) {
    if (todo.status === 'done') groups.done.push(todo);
    else if (todo.pinned) groups.pinned.push(todo);
    else groups.normal.push(todo);
  }

  return groups;
}

export function reassemblePersonalTodos(groups: PersonalTodoGroups): PersonalTodo[] {
  const seen = new Set<string>();
  const todos: PersonalTodo[] = [];

  for (const todo of [...groups.pinned, ...groups.normal, ...groups.done]) {
    if (seen.has(todo.id)) continue;
    seen.add(todo.id);
    todos.push(todo);
  }

  return todos;
}

/** Move one optimistic todo to the tail of the canonical target group. */
export function movePersonalTodoToGroupTail(todos: PersonalTodo[], updatedTodo: PersonalTodo): PersonalTodo[] {
  const groups = splitPersonalTodos(todos);
  groups.pinned = groups.pinned.filter((todo) => todo.id !== updatedTodo.id);
  groups.normal = groups.normal.filter((todo) => todo.id !== updatedTodo.id);
  groups.done = groups.done.filter((todo) => todo.id !== updatedTodo.id);

  const targetGroup = updatedTodo.status === 'done'
    ? groups.done
    : updatedTodo.pinned
      ? groups.pinned
      : groups.normal;
  targetGroup.push(updatedTodo);
  return reassemblePersonalTodos(groups);
}

export function personalTodoOrderMatches(actual: PersonalTodo[], expected: PersonalTodo[]): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((todo, index) => {
    const candidate = actual[index];
    return candidate.id === todo.id
      && candidate.status === todo.status
      && candidate.completed === todo.completed
      && candidate.pinned === todo.pinned;
  });
}

export function getTodoNextAction(status: PersonalTodoStatus): PersonalTodoNextAction {
  return NEXT_ACTIONS[status];
}

export function summarizeTodoLabels(
  labelIds: string[],
  labels: PersonalTodoLabel[],
  compact: boolean,
): PersonalTodoLabelSummary {
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const selected = [...new Set(labelIds)]
    .map((id) => labelsById.get(id))
    .filter((label): label is PersonalTodoLabel => label !== undefined);
  const visibleLimit = compact ? 1 : 2;

  return {
    visible: selected.slice(0, visibleLimit),
    hiddenCount: Math.max(0, selected.length - visibleLimit),
  };
}

export function getPriorityPresentation(priority: PersonalTodoPriority): PersonalTodoPriorityPresentation {
  return PRIORITY_PRESENTATIONS[priority];
}
