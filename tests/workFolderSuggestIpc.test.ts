// tests/workFolderSuggestIpc.test.ts — 가이드 작업 폴더 제안의 메인 통로(폴더 목록·클립보드 경로, 설계 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORK_FOLDER_CHANNELS,
  registerWorkFolderSuggestIpc,
  type WorkFolderSuggestIpcDeps,
} from '../electron/workFolderSuggestIpc.ts';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const dir = (name: string) => ({ name, isDirectory: () => true, isFile: () => false });
const file = (name: string) => ({ name, isDirectory: () => false, isFile: () => true });

function register(over: Partial<Omit<WorkFolderSuggestIpcDeps, 'ipc'>>): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  registerWorkFolderSuggestIpc({
    ipc: { handle: (channel, listener) => { handlers[channel] = listener; } },
    readClipboardFilePath: () => null,
    readDir: async () => [],
    isAllowedPath: () => true,
    ...over,
  });
  return handlers;
}

test('채널 이름', () => {
  assert.equal(WORK_FOLDER_CHANNELS.listDir, 'work-folder:list-dir');
  assert.equal(WORK_FOLDER_CHANNELS.clipboardImagePath, 'work-folder:clipboard-image-path');
});

test('list-dir: 허용 경로만, dirs/files 나눠, 이름순', async () => {
  const h = register({
    readDir: async () => [dir('d054'), file('a.clip'), dir('d043.046')],
    isAllowedPath: (path) => path.startsWith('G:'),
  });
  const listDir = h['work-folder:list-dir'];
  assert.deepEqual(await listDir(null, 'G:\\x', 'dirs'), ['d043.046', 'd054']);
  assert.deepEqual(await listDir(null, 'G:\\x', 'files'), ['a.clip']);
  assert.equal(await listDir(null, 'C:\\x', 'dirs'), null);
  assert.equal(await listDir(null, 42, 'dirs'), null);
  assert.equal(await listDir(null, 'G:\\x', 'all'), null);
});

test('list-dir: 시간 제한을 넘기면 null', async () => {
  const h = register({ readDir: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal(await h['work-folder:list-dir'](null, 'G:\\x', 'dirs'), null);
});

test('list-dir: readDir 오류는 null', async () => {
  const h = register({ readDir: async () => { throw new Error('EACCES'); } });
  assert.equal(await h['work-folder:list-dir'](null, 'G:\\x', 'dirs'), null);
});

test('clipboard-image-path: 그대로 돌려주고 오류는 null', async () => {
  assert.equal(await register({ readClipboardFilePath: () => 'G:\\a.png' })['work-folder:clipboard-image-path'](null), 'G:\\a.png');
  assert.equal(await register({ readClipboardFilePath: () => { throw new Error('x'); } })['work-folder:clipboard-image-path'](null), null);
});

test('배선: main 이 등록하고 preload 가 두 채널을 연다', () => {
  const main = read('electron/main.ts');
  assert.ok(main.includes('registerWorkFolderSuggestIpc({'));
  assert.ok(main.includes("from '../src/shared/sharedDrivePath'"));
  const preload = read('electron/preload.ts');
  assert.ok(preload.includes("ipcRenderer.invoke('work-folder:list-dir', dir, kind)"));
  assert.ok(preload.includes("ipcRenderer.invoke('work-folder:clipboard-image-path')"));
  const types = read('src/types/index.ts');
  assert.ok(types.includes('workFolderListDir?: (dir: string, kind:'));
  assert.ok(types.includes('workFolderClipboardImagePath?: () => Promise<string | null>;'));
});
