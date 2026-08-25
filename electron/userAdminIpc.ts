export type UserAdminCreateInput = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  slackId: string;
  hireDate: string;
  birthday: string;
};

export type UserAdminUpdateInput = Partial<{
  name: string;
  role: 'admin' | 'user';
  slackId: string | null;
  hireDate: string | null;
  birthday: string | null;
  isCompositor: boolean;
  isActingSupervisor: boolean;
}>;

type IpcRegistrar = {
  handle(channel: string, handler: (_event: unknown, ...args: any[]) => unknown): void;
};

export type UserAdminIpcDeps = {
  getCanonicalUserIdOrThrow(): string;
  addUser(actorId: string, input: UserAdminCreateInput): Promise<void>;
  updateUser(actorId: string, userId: string, updates: UserAdminUpdateInput): Promise<void>;
  deleteUser(actorId: string, userId: string): Promise<void>;
  refreshCurrentUser(): Promise<unknown>;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 입력이 올바르지 않습니다`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} 값이 올바르지 않습니다`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${label} 값이 올바르지 않습니다`);
  return value;
}

export function safeUserAdminCreateInput(value: unknown): UserAdminCreateInput {
  const input = record(value, '사용자 추가');
  const role = input.role;
  if (role !== 'admin' && role !== 'user') throw new Error('사용자 역할이 올바르지 않습니다');
  return {
    id: requiredString(input.id, '사용자 ID'),
    name: requiredString(input.name, '사용자 이름'),
    role,
    slackId: optionalString(input.slackId, 'Slack ID'),
    hireDate: optionalString(input.hireDate, '입사일'),
    birthday: optionalString(input.birthday, '생일'),
  };
}

const USER_UPDATE_KEYS = new Set([
  'name', 'role', 'slackId', 'hireDate', 'birthday', 'isCompositor', 'isActingSupervisor',
]);

export function safeUserAdminUpdateInput(value: unknown): UserAdminUpdateInput {
  const input = record(value, '사용자 수정');
  const unknown = Object.keys(input).filter((key) => !USER_UPDATE_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`허용되지 않는 사용자 수정 필드: ${unknown.join(', ')}`);
  }

  const safe: UserAdminUpdateInput = {};
  if (input.name !== undefined) safe.name = requiredString(input.name, '사용자 이름');
  if (input.role !== undefined) {
    if (input.role !== 'admin' && input.role !== 'user') throw new Error('사용자 역할이 올바르지 않습니다');
    safe.role = input.role;
  }
  for (const key of ['slackId', 'hireDate', 'birthday'] as const) {
    const field = input[key];
    if (field !== undefined) {
      if (field !== null && typeof field !== 'string') throw new Error(`${key} 값이 올바르지 않습니다`);
      safe[key] = field as string | null;
    }
  }
  for (const key of ['isCompositor', 'isActingSupervisor'] as const) {
    const field = input[key];
    if (field !== undefined) {
      if (typeof field !== 'boolean') throw new Error(`${key} 값이 올바르지 않습니다`);
      safe[key] = field;
    }
  }
  return safe;
}

/** 사용자 관리 쓰기는 renderer가 보낸 actor/role을 신뢰하지 않는다.
 * main canonical session actor를 DB RPC에 전달하고, DB가 잠금 뒤 admin을 재검증한다. */
export function registerUserAdminIpc(ipc: IpcRegistrar, deps: UserAdminIpcDeps): void {
  ipc.handle('supabase:add-user', async (_event, rawInput: unknown) => {
    const actorId = deps.getCanonicalUserIdOrThrow();
    await deps.addUser(actorId, safeUserAdminCreateInput(rawInput));
  });

  ipc.handle('supabase:update-user', async (_event, rawUserId: unknown, rawUpdates: unknown) => {
    const actorId = deps.getCanonicalUserIdOrThrow();
    const userId = requiredString(rawUserId, '수정 대상 사용자 ID');
    await deps.updateUser(actorId, userId, safeUserAdminUpdateInput(rawUpdates));
    if (actorId === userId) await deps.refreshCurrentUser();
  });

  ipc.handle('supabase:delete-user', async (_event, rawUserId: unknown) => {
    const actorId = deps.getCanonicalUserIdOrThrow();
    const userId = requiredString(rawUserId, '삭제 대상 사용자 ID');
    await deps.deleteUser(actorId, userId);
    if (actorId === userId) await deps.refreshCurrentUser();
  });
}
