type IpcRegistrar = {
  handle(channel: string, handler: (_event: unknown, ...args: any[]) => unknown): void;
};

export type LegacyPrivateEventIpcDeps = {
  getSessionUserIdOrThrow(): string;
  assertLiveUser(userId: string): Promise<void>;
  readEvents(userId: string): Promise<unknown[]>;
  addEvent(input: Record<string, unknown>): Promise<unknown>;
  getEventOwner(eventId: string): Promise<string | null>;
  updateEvent(eventId: string, updates: Record<string, unknown>): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
};

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}가 올바르지 않습니다`);
  }
  return value;
}

function objectInput(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 입력이 올바르지 않습니다`);
  }
  return value as Record<string, unknown>;
}

/** migration 전 legacy private table도 매 요청마다 canonical actor가 users에 살아 있는지
 * 확인한다. receipt settlement는 별도 capability 경로라 이 live-user gate에 포함하지 않는다. */
export function registerLegacyPrivateEventIpc(
  ipc: IpcRegistrar,
  deps: LegacyPrivateEventIpcDeps,
): void {
  const liveUserId = async (): Promise<string> => {
    const userId = deps.getSessionUserIdOrThrow();
    await deps.assertLiveUser(userId);
    return userId;
  };

  const ownedEvent = async (rawId: unknown): Promise<{ eventId: string; userId: string }> => {
    const userId = await liveUserId();
    const eventId = requiredId(rawId, '비공개 일정 ID');
    const ownerId = await deps.getEventOwner(eventId);
    if (!ownerId) throw new Error('해당 비공개 일정을 찾을 수 없습니다');
    if (ownerId !== userId) throw new Error('이 비공개 일정에 대한 권한이 없습니다');
    return { eventId, userId };
  };

  ipc.handle('supabase:read-private-events', async () => {
    const userId = await liveUserId();
    return deps.readEvents(userId);
  });

  ipc.handle('supabase:add-private-event', async (_event, rawInput: unknown) => {
    const userId = await liveUserId();
    return deps.addEvent({ ...objectInput(rawInput, '비공개 일정 추가'), user_id: userId });
  });

  ipc.handle('supabase:update-private-event', async (_event, rawId: unknown, rawUpdates: unknown) => {
    const { eventId } = await ownedEvent(rawId);
    await deps.updateEvent(eventId, objectInput(rawUpdates, '비공개 일정 수정'));
  });

  ipc.handle('supabase:delete-private-event', async (_event, rawId: unknown) => {
    const { eventId } = await ownedEvent(rawId);
    await deps.deleteEvent(eventId);
  });
}
