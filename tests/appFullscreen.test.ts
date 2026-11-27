import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-11-27 한솔 '가끔 전체 화면이 되고, 최소화/전체/X 창이 안 보여': 화면 속 전체 화면(F11 → requestFullscreen)이 '전체 화면'으로 기억되어
// 다음 실행 때 창 전체 화면으로 되살아났고, 그때 F11 은 화면 속 전체 화면만 켰다 껐다 해서 빠져나올 수 없었다.
const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the app never restores fullscreen at start and never remembers it', () => {
  const main = src('electron/main.ts');
  const create = main.slice(main.indexOf('function createWindow(): void {'), main.indexOf("mainWindow.on('resize', scheduleSaveMainWindowBounds);"));
  assert.doesNotMatch(create, /setFullScreen\(true\)/);
  assert.match(create, /if \(b\?\.isMaximized \|\| b\?\.isFullScreen\) mainWindow\.maximize\(\);/);   // 예전 기억은 최대화로
  const save = main.slice(main.indexOf('function scheduleSaveMainWindowBounds'), main.indexOf('function createWindow(): void {'));
  assert.match(save, /isFullScreen: false,/);
});

test('a remembered window whose title bar sits above the screen loses its position (buttons stay visible)', () => {
  const main = src('electron/main.ts');
  const load = main.slice(main.indexOf('async function loadMainWindowBounds'), main.indexOf('async function preloadMainWindowBounds'));
  assert.match(load, /const inside = pointIn\(cx, cy\) && pointIn\(cx, ty\);/);
});

test('F11 toggles only the window fullscreen, and the top edge bar can always leave it', () => {
  const keys = src('src/hooks/useGlobalShortcuts.ts');
  assert.doesNotMatch(keys, /requestFullscreen/);
  assert.match(keys, /if \(!e\.repeat\) void toggleAppFullscreen\(\);/);
  const fs = src('src/utils/appFullscreen.ts');
  assert.match(fs, /set\('toggle'\)/);
  // 끝내기는 화면 속 전체 화면과 창 전체 화면을 둘 다 푼다
  const leave = fs.slice(fs.indexOf('export async function leaveAppFullscreen'), fs.indexOf('export async function toggleAppFullscreen'));
  assert.match(leave, /await exitDocumentFullscreen\(\);/);
  assert.match(leave, /setWindowFullscreen\?\.\(false\)/);
  const main = src('electron/main.ts');
  assert.match(main, /ipcMain\.handle\('window:set-fullscreen'/);
  assert.match(main, /win\.on\('enter-full-screen', send\);/);
  const preload = src('electron/preload.ts');
  assert.match(preload, /setWindowFullscreen: \(want: boolean \| 'toggle'\) => ipcRenderer\.invoke\('window:set-fullscreen', want\)/);
  assert.match(preload, /ipcRenderer\.on\('window:fullscreen-changed', handler\)/);
  const entry = src('src/main.tsx');
  assert.match(entry, /<App \/>\s*\{\/\*[^*]*\*\/\}\s*<FullscreenExitBar \/>/);
  const bar = src('src/components/layout/FullscreenExitBar.tsx');
  assert.match(bar, /onClick=\{\(\) => \{ void leaveAppFullscreen\(\); \}\}/);
});
