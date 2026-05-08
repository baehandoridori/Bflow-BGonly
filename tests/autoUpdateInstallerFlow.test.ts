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

  assert.match(modal, /frozenUpdateInfoRef/);
  assert.match(modal, /isRefreshing\s*\?\s*frozenUpdateInfoRef\.current/);
  assert.match(modal, /min-h-\[210px\]/);
});

test('version center can expand previous release notes', async () => {
  const modal = await readRepoFile('src', 'components', 'update', 'UpdateCenterModal.tsx');

  assert.match(modal, /showAllReleaseNotes/);
  assert.match(modal, /visibleNotes/);
  assert.match(modal, /hiddenReleaseNoteCount/);
  assert.match(modal, /이전 업데이트 내역/);
});

test('manifest generation keeps full release note history for the version center', async () => {
  const generator = await readRepoFile('scripts', 'generate-manifest.js');

  assert.match(generator, /releaseNotes/);
  assert.doesNotMatch(generator, /\.slice\(0,\s*3\)[\s\S]*\.map\(\(note\)/);
});
