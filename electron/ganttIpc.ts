import { ipcMain } from 'electron';
import { readGantt, executeGantt, validateGanttRequest } from './ganttStore';
import type { GanttRequest, GanttSnapshot } from '../src/features/gantt/types';

interface GanttIpcDependencies {
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  onChanged(): void;
  /** Injectable boundaries let persistence/session behavior run without Electron or a live DB. */
  ipc?: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  store?: { read(actorId: string): Promise<GanttSnapshot>; execute(actorId: string, request: GanttRequest): Promise<GanttSnapshot> };
}
export function registerGanttIpc(deps: GanttIpcDependencies): void {
  const ipc = deps.ipc ?? ipcMain;
  const store = deps.store ?? { read: readGantt, execute: executeGantt };
  function current(origin: { userId: string; epoch: number }) {
    const now = deps.getSessionOriginOrThrow();
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error('로그인 세션이 변경되어 간트 응답을 폐기했습니다.');
  }
  function checkRequestEpoch(requestEpoch: unknown, origin: { epoch: number }) {
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다. 화면을 다시 열어 주세요.');
  }
  ipc.handle('gantt:read', async (_event, requestEpoch) => {
    const origin = { ...deps.getSessionOriginOrThrow() };
    checkRequestEpoch(requestEpoch, origin);
    const result = await store.read(origin.userId);
    current(origin);
    return result;
  });
  ipc.handle('gantt:execute', async (_event, input, requestEpoch) => {
    const origin = { ...deps.getSessionOriginOrThrow() };
    checkRequestEpoch(requestEpoch, origin);
    validateGanttRequest(input);
    const result = await store.execute(origin.userId, input);
    // A committed change must invalidate other windows even when the initiating session changed.
    try { deps.onChanged(); } catch (error) { console.warn('[gantt] 변경 알림 실패:', error); }
    current(origin);
    return result;
  });
}
