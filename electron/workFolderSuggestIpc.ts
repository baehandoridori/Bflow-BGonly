// electron/workFolderSuggestIpc.ts — 가이드 그림 작업 폴더 제안의 메인 통로(설계 6).
// 공유 드라이브 폴더의 한 단계 목록과, 탐색기에서 '파일 복사'한 그림의 경로만 준다. 파일 내용은 읽지 않는다.
// 테스트가 직접 import 한다 — 런타임 import 를 두지 않는다(허용 경로 판정·디스크 읽기는 main.ts 가 넣어 준다).

/** 구글 드라이브가 느리거나 끊겼을 때 목록을 이보다 오래 기다리지 않는다. 넘기면 '없음' — 제안하지 않는다. */
export const WORK_FOLDER_LIST_TIMEOUT_MS = 3000;

export const WORK_FOLDER_CHANNELS = {
  clipboardImagePath: 'work-folder:clipboard-image-path',
  listDir: 'work-folder:list-dir',
} as const;

export interface WorkFolderSuggestIpcDeps {
  ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void };
  /** 클립보드의 그림 파일 경로(탐색기 '파일 복사'). 없으면 null. */
  readClipboardFilePath(): string | null;
  readDir(dir: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  /** 목록을 읽어도 되는 경로인가 — 공유 드라이브 안만. 아무 폴더나 훑는 통로가 되지 않게. */
  isAllowedPath(path: string): boolean;
  timeoutMs?: number;
}

export function registerWorkFolderSuggestIpc(deps: WorkFolderSuggestIpcDeps): void {
  const timeoutMs = deps.timeoutMs ?? WORK_FOLDER_LIST_TIMEOUT_MS;

  deps.ipc.handle(WORK_FOLDER_CHANNELS.clipboardImagePath, () => {
    try {
      return deps.readClipboardFilePath();
    } catch (err) {
      console.warn('[work-folder] 클립보드 경로 읽기 실패', err);
      return null;
    }
  });

  deps.ipc.handle(WORK_FOLDER_CHANNELS.listDir, async (_event, dir, kind) => {
    if (typeof dir !== 'string' || (kind !== 'dirs' && kind !== 'files')) return null;
    if (!deps.isAllowedPath(dir)) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    try {
      const entries = await Promise.race([deps.readDir(dir), timeout]);
      if (!entries) {
        console.warn('[work-folder] 폴더 목록 시간 초과', dir);
        return null;
      }
      return entries
        .filter((entry) => (kind === 'dirs' ? entry.isDirectory() : entry.isFile()))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      console.warn('[work-folder] 폴더 목록 읽기 실패', dir, err);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
