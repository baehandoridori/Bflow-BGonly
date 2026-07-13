import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('local browser preview installs the Electron API mock outside Electron', async () => {
  const main = await readRepoFile('src', 'main.tsx');

  assert.match(main, /function shouldInstallBrowserElectronMock/);
  assert.match(main, /hasUsableElectronAPI\(window\.electronAPI\)/);
  assert.match(main, /if \(import\.meta\.env\.DEV\) return true;/);
  assert.match(main, /'localhost'/);
  assert.match(main, /'127\.0\.0\.1'/);
  assert.match(main, /'::1'/);
  assert.match(main, /import \{ hasUsableElectronAPI, installDevElectronAPI \} from '\.\/mocks\/devElectronAPI';/);
  assert.doesNotMatch(main, /await import\('\.\/mocks\/devElectronAPI'\)/);
});

test('browser preview Electron API mock supports preview login writes', async () => {
  const mockApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(mockApi, /function hasUsableElectronAPI/);
  assert.match(mockApi, /usersRead/);
  assert.match(mockApi, /usersWrite:\s*async \(\) => true/);
  assert.match(mockApi, /readSettings:\s*async/);
  assert.match(mockApi, /supabaseTestConnection:\s*async/);
  assert.match(mockApi, /dataset\.devElectronApi = 'installed'/);
});

test('browser preview Electron API mock persists added scenes across readAll sync', async () => {
  const mockApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(mockApi, /function getMockEpisodes\(/);
  assert.match(mockApi, /function addMockScene\(/);
  assert.match(mockApi, /supabaseReadAll:\s*async \(\) => getMockEpisodes\(\)/);
  assert.match(mockApi, /supabaseAddScene:\s*async \(sheetName, sceneId, assignee, memo\)/);
  assert.match(mockApi, /addMockScene\(sheetName, sceneId, assignee, memo\)/);
  assert.match(mockApi, /supabaseAddScenes:\s*async \(sheetName, scenes\)/);
});

test('browser preview mirrors work-activity point awards so the header badge updates', async () => {
  const mockApi = await readRepoFile('src', 'mocks', 'devElectronAPI.ts');

  assert.match(mockApi, /function maybeAwardPreviewActivity/);
  assert.match(mockApi, /function findMockSceneDepartment/);
  assert.match(mockApi, /function findMockSceneState/);
  assert.match(mockApi, /function findMockSceneStageValue/);
  // 이미 done 인 씬의 첫 호출 오적립을 막도록 phase Map 을 mock 씬 현재 상태로 시드한다.
  assert.match(mockApi, /previewScenePhaseByUuid\.get\(sceneUuid\) \?\? findMockSceneState\(sceneUuid\)/);
  // 프로덕션 훅과 같은 조건으로 4개 활동을 미러링한다. scene-stage 는 실제 BG 씬의 false→true 전이만.
  assert.match(mockApi, /findMockSceneDepartment\(sceneUuid\) === 'bg'/);
  assert.match(mockApi, /findMockSceneStageValue\(sceneUuid, stage\) === false/);
  assert.match(mockApi, /maybeAwardPreviewActivity\('scene-stage', sceneUuid, stage\)/);
  assert.match(mockApi, /if \(sceneState === 'done' && previousState !== 'done'\) \{\s*maybeAwardPreviewActivity\('scene-phase-done', sceneUuid\);/);
  assert.match(mockApi, /maybeAwardPreviewActivity\('comment', commentId\)/);
  assert.match(mockApi, /maybeAwardPreviewActivity\('retake-done', id\)/);
  // 적립되면 지갑 push 로 헤더 배지 획득 연출까지 재현한다.
  assert.match(mockApi, /useArcadeStore\.getState\(\)\.applyWalletPush/);
});

test('browser preview starts directly at the login form after the mock is installed', async () => {
  const loginScreen = await readRepoFile('src', 'components', 'auth', 'LoginScreen.tsx');

  assert.match(loginScreen, /function isLocalBrowserPreview/);
  assert.match(loginScreen, /dataset\.devElectronApi === 'installed'/);
  assert.match(loginScreen, /mode === 'login' && isLocalBrowserPreview\(\) \? 'login' : 'landing'/);
});

test('Codex browser preview auto logs in with the stable preview account', async () => {
  const loginScreen = await readRepoFile('src', 'components', 'auth', 'LoginScreen.tsx');

  assert.match(loginScreen, /function isCodexBrowserPreview/);
  assert.match(loginScreen, /new URLSearchParams\(window\.location\.search\)\.has\('codex'\)/);
  assert.match(loginScreen, /login\('배한솔', '1234', true\)/);
  assert.match(loginScreen, /setCurrentUser\(result\.user\)/);
});
