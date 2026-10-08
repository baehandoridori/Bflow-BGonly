import { validateBackgroundRequest } from '../src/features/backgrounds/domain';
import type { BackgroundRequest, BackgroundSnapshot } from '../src/features/backgrounds/types';

export interface BackgroundIpcDependencies {
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  onChanged(): void;
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  store: { read(actorId: string): Promise<BackgroundSnapshot>; execute(actorId: string, request: BackgroundRequest): Promise<BackgroundSnapshot> };
  uploadImage?(base64Data: string): Promise<{ ok: boolean; url?: string; error?: string }>;
  readImageFile?(filePath: string): Promise<{ dataUrl: string; filePath: string }>;
}

export function registerBackgroundIpc(deps: BackgroundIpcDependencies): void {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 변경되었습니다. 화면을 다시 열어 주세요.');
    return origin;
  }
  function current(origin: { userId: string; epoch: number }) {
    const now = deps.getSessionOriginOrThrow();
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error('로그인 세션이 변경되어 배경 응답을 폐기했습니다.');
  }
  deps.ipc.handle('background:read', async (_event, requestEpoch) => {
    const origin = originFor(requestEpoch);
    const result = await deps.store.read(origin.userId);
    current(origin);
    return result;
  });
  deps.ipc.handle('background:execute', async (_event, input, requestEpoch) => {
    const origin = originFor(requestEpoch);
    validateBackgroundRequest(input);
    const result = await deps.store.execute(origin.userId, input);
    // Commit has happened: other windows must refresh even if the initiator just logged out.
    try { deps.onChanged(); } catch (error) { console.warn('[background] 변경 알림 실패:', error); }
    current(origin);
    return result;
  });
  deps.ipc.handle('background:upload-image', async (_event, input, requestEpoch) => {
    const origin = originFor(requestEpoch);
    if (typeof input !== 'string' || input.length > 28_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input)) {
      throw new Error('올바른 이미지 파일이 필요합니다. 최대 20MB까지 업로드할 수 있습니다.');
    }
    // Canonical DB role, never the renderer's canManage flag or a stale local user object.
    const snapshot = await deps.store.read(origin.userId);
    current(origin);
    if (!snapshot.canManage) throw new Error('배경 이미지 업로드는 관리자만 할 수 있습니다.');
    if (!deps.uploadImage) throw new Error('배경 이미지 저장소가 준비되지 않았습니다.');
    const result = await deps.uploadImage(input);
    current(origin);
    return result;
  });
  deps.ipc.handle('background:read-image-file', async (_event, input, requestEpoch) => {
    const origin = originFor(requestEpoch);
    const snapshot = await deps.store.read(origin.userId);
    current(origin);
    if (!snapshot.canManage) throw new Error('배경 이미지 파일 연결은 관리자만 할 수 있습니다.');
    if (typeof input !== 'string') throw new Error('이미지 파일의 전체 경로를 입력해 주세요.');
    if (!deps.readImageFile) throw new Error('이미지 파일 읽기 기능이 준비되지 않았습니다.');
    const result = await deps.readImageFile(input);
    current(origin);
    const refreshed = await deps.store.read(origin.userId);
    current(origin);
    if (!refreshed.canManage) throw new Error('배경 이미지 파일 연결은 관리자만 할 수 있습니다.');
    return result;
  });
}
