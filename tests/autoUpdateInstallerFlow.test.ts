import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function readRepoFile(...parts: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...parts), 'utf-8');
}

test('auto-update downloads the NSIS installer instead of mirroring win-unpacked', async () => {
  const checker = await readRepoFile('electron', 'autoUpdate', 'checker.ts');

  assert.match(checker, /downloadInstallerToPending/);
  assert.match(checker, /localInstallerReadyMarker/);
  assert.doesNotMatch(checker, /findRemoteWinUnpacked/);
  assert.doesNotMatch(checker, /copyDirMirror/);
});

test('update apply path uses installer helper, not directory swap helper', async () => {
  const main = await readRepoFile('electron', 'main.ts');

  assert.match(main, /spawnInstallerUpdateHelper/);
  assert.match(main, /hasPendingInstallerUpdate/);
  assert.doesNotMatch(main, /spawnSwapHelper\(\{ relaunch: updateRelaunchScheduled \}\)/);
});

test('installer helper waits for BFLOW to exit before running setup', async () => {
  const helper = await readRepoFile('electron', 'autoUpdate', 'installerApply.ts');

  assert.match(helper, /\$parentPid/);
  assert.match(helper, /Wait-ForBflowExit/);
  assert.match(helper, /Wait-ForParentExit/);
  assert.match(
    helper,
    /if \(-not \(Wait-ForParentExit\)\)[\s\S]*if \(-not \(Wait-ForBflowExit\)\)[\s\S]*Start-Process -FilePath \$installer/,
  );
});

test('installer helper uses cmd wrapper file launch and records start marker', async () => {
  const helper = await readRepoFile('electron', 'autoUpdate', 'installerApply.ts');

  assert.match(helper, /cmd\.exe/);
  assert.match(helper, /cmd wrapper spawn OK/);
  assert.match(helper, /-File', helperPs1/);
  assert.match(helper, /Set-Content -Path \$attemptedMarker/);
});

test('startup update gate waits for installer helper start before exiting', async () => {
  const main = await readRepoFile('electron', 'main.ts');

  assert.match(main, /waitForInstallerHelperStart/);
  assert.match(
    main,
    /spawnInstallerUpdateHelper\(\{ relaunch: true \}\);[\s\S]*await waitForInstallerHelperStart\(\)[\s\S]*app\.exit\(0\)/,
  );
});

test('auto-update user-facing copy describes first-launch update without restart wording', async () => {
  const main = await readRepoFile('electron', 'main.ts');
  const checker = await readRepoFile('electron', 'autoUpdate', 'checker.ts');
  const helper = await readRepoFile('electron', 'autoUpdate', 'installerApply.ts');
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  assert.match(main, /설치가 끝나면 최신 버전으로 열립니다/);
  assert.match(checker, /최신 버전으로 열립니다/);
  assert.match(helper, /최신 버전 앱이 자동으로 열립니다/);
  assert.match(modal, /최신 버전으로 열립니다/);

  assert.doesNotMatch(main, /설치가 끝나면 앱이 다시 열립니다/);
  assert.doesNotMatch(checker, /앱이 잠시 닫힌 뒤 다시 열립니다/);
  assert.doesNotMatch(helper, /앱이 자동으로 다시 열립니다/);
  assert.doesNotMatch(modal, /새 버전으로 다시 열립니다/);
});

test('pending installer is applied on the next app launch while normal quit keeps it pending', async () => {
  const main = await readRepoFile('electron', 'main.ts');
  const startupGate = main.slice(
    main.indexOf('async function runStartupUpdateGate'),
    main.indexOf('function startRuntimeUpdateChecks'),
  );
  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("process.on('exit'"));

  assert.match(startupGate, /const result = await Promise\.race\(\[updatePromise, timeout\]\)/);
  assert.match(startupGate, /if \(result\?\.ready\)[\s\S]*spawnInstallerUpdateHelper\(\{ relaunch: true \}\)/);
  assert.match(startupGate, /await waitForInstallerHelperStart\(\)[\s\S]*app\.exit\(0\)/);
  assert.match(beforeQuit, /if \(updateRelaunchScheduled && await hasPendingInstallerUpdate\(\)\)[\s\S]*spawnInstallerUpdateHelper\(\{ relaunch: true \}\)/);
  assert.match(beforeQuit, /pending installer kept for next launch auto apply/);
  assert.doesNotMatch(beforeQuit, /spawnInstallerUpdateHelper\(\{ relaunch: updateRelaunchScheduled \}\)/);
});

test('startup failure handling includes installer pending markers', async () => {
  const main = await readRepoFile('electron', 'main.ts');

  assert.match(main, /notifyAndCleanupOnInstallerFailure/);
  assert.match(main, /localInstallerReadyMarker/);
  assert.match(main, /localInstallerAttemptedMarker/);
  assert.match(main, /localInstallerPendingDir/);
});

test('manifest records installer metadata for sync validation', async () => {
  const generator = await readRepoFile('scripts', 'generate-manifest.js');
  const manifest = await readRepoFile('electron', 'autoUpdate', 'manifest.ts');

  assert.match(generator, /BFLOW-Setup\.exe/);
  assert.match(generator, /installer/);
  assert.match(generator, /allow-missing-installer/);
  assert.match(generator, /process\.exit\(1\)/);
  assert.match(manifest, /installer\?:/);
  assert.match(manifest, /sizeBytes\?: number/);
});

test('remote dist root can be discovered from installer artifacts', async () => {
  const paths = await readRepoFile('electron', 'autoUpdate', 'paths.ts');
  const rootBody = paths.slice(
    paths.indexOf('export function findRemoteDistRoot'),
    paths.indexOf('/** G드라이브 dist의 win-unpacked 경로'),
  );

  assert.match(rootBody, /manifest\.json/);
  assert.match(rootBody, /INSTALLER_FILE_NAME/);
  assert.doesNotMatch(rootBody, /win-unpacked/);
});

test('renderer update state can represent installer applying progress', async () => {
  const checker = await readRepoFile('electron', 'autoUpdate', 'checker.ts');
  const types = await readRepoFile('src', 'types', 'index.ts');

  assert.match(checker, /'applying'/);
  assert.match(types, /'applying'/);
  assert.match(types, /downloadedBytes\?: number/);
  assert.match(types, /totalBytes\?: number/);
});

test('version center is always reachable and can refresh update state', async () => {
  const sidebar = await readRepoFile('src', 'components', 'layout', 'Sidebar.tsx');
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');
  const preload = await readRepoFile('electron', 'preload.ts');
  const types = await readRepoFile('src', 'types', 'index.ts');
  const main = await readRepoFile('electron', 'main.ts');

  assert.match(sidebar, /setUpdateCenterOpen\(true\)/);
  assert.doesNotMatch(sidebar, /if \(updateInfo\) setUpdateCenterOpen\(true\)/);
  assert.match(modal, /checkForUpdates/);
  assert.match(preload, /checkForUpdates/);
  assert.match(types, /checkForUpdates\?: \(\) => Promise<UpdateInfo \| null>/);
  assert.match(main, /update:check-now/);
});

test('version center can recover from a suppressed/failed state via retry', async () => {
  const main = await readRepoFile('electron', 'main.ts');
  const preload = await readRepoFile('electron', 'preload.ts');
  const types = await readRepoFile('src', 'types', 'index.ts');
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  // retry IPC wipes the stale installer-pending first; only AFTER cleanup succeeds does it
  // drop suppression and re-check. A locked/undeletable pending short-circuits to a failed
  // status (no suppression release, no stale re-schedule) and asks the user to retry/install.
  const retryBody = main.slice(
    main.indexOf("ipcMain.handle('update:retry'"),
    main.indexOf("ipcMain.handle('update:retry'") + 1200,
  );
  assert.match(retryBody, /const pendingCleared = await cleanupInstallerPendingAndAttemptedMarker\(\)/);
  assert.match(retryBody, /if \(!pendingCleared\)[\s\S]*status:\s*'failed'[\s\S]*return info/);
  // suppression is only cleared on the success path, which sits after the early failed return
  assert.match(retryBody, /if \(!pendingCleared\)[\s\S]*localSwapSuppressedMarker\(\), \{ force: true \}[\s\S]*runManualUpdateCheck\(\)/);

  // the shared cleanup reports whether the pending dir actually went away, and only drops the
  // attempted marker once it did — so a locked pending still gets reported + cleaned next launch
  const cleanupBody = main.slice(
    main.indexOf('async function cleanupInstallerPendingAndAttemptedMarker'),
    main.indexOf('async function cleanupInstallerPendingAndAttemptedMarker') + 800,
  );
  assert.match(cleanupBody, /Promise<boolean>/);
  assert.match(cleanupBody, /localInstallerPendingDir\(\), \{ recursive: true, force: true \}/);
  assert.match(cleanupBody, /if \(pendingCleaned\)[\s\S]*localInstallerAttemptedMarker/);
  assert.match(cleanupBody, /return pendingCleaned/);

  // exposed through preload + types + the modal action
  assert.match(preload, /update:retry/);
  assert.match(types, /retryUpdate\?: \(\) => Promise<UpdateInfo \| null>/);
  assert.match(modal, /retryUpdate/);
  assert.match(modal, /onClick=\{handleRetry\}/);
  assert.match(modal, /다시 시도/);
});

test('version center only checks updates from the refresh button', async () => {
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  assert.match(modal, /onClick=\{handleRefresh\}/);
  assert.doesNotMatch(
    modal,
    /useEffect\(\(\) => \{[\s\S]*void handleRefresh\(\);[\s\S]*\}, \[handleRefresh, updateCenterOpen, updateInfo\]\);/,
  );
});

test('version center keeps its visible content stable while refresh is running', async () => {
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  // 응답 도착 전 기존 표시 정보 유지
  assert.match(modal, /frozenUpdateInfoRef/);
  assert.match(modal, /isRefreshing\s*\?\s*frozenUpdateInfoRef\.current/);
  // v1.23.0: 모달 외형 안정화는 86vh 고정 + flex-col + 내부 영역 분할로 보장
  assert.match(modal, /height:\s*'86vh'/);
  assert.match(modal, /flex flex-col/);
});

test('version center can expand previous release notes', async () => {
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  assert.match(modal, /showAllReleaseNotes/);
  assert.match(modal, /visibleNotes/);
  assert.match(modal, /hiddenReleaseNoteCount/);
  // v1.23.0: PR 타임라인 스타일로 변경 — '이전 버전 N개 더 보기'
  assert.match(modal, /이전 버전/);
});

test('version center renders categorized release note items', async () => {
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  assert.match(modal, /RELEASE_NOTE_CATEGORY_META/);
  assert.match(modal, /normalizeReleaseNoteItem/);
  assert.match(modal, /summary/);
  assert.match(modal, /description/);
});

test('manifest generation keeps full release note history for the version center', async () => {
  const generator = await readRepoFile('scripts', 'generate-manifest.js');

  assert.match(generator, /releaseNotes/);
  assert.doesNotMatch(generator, /\.slice\(0,\s*3\)[\s\S]*\.map\(\(note\)/);
});

test('manifest generation preserves categorized release note items', async () => {
  const generator = await readRepoFile('scripts', 'generate-manifest.js');

  assert.match(generator, /category/);
  assert.match(generator, /summary/);
  assert.match(generator, /description/);
});
