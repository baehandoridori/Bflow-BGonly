import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

import {
  decideSuppression,
  formatSuppressionMarker,
  isStaleSwapFailureForCurrentVersion,
  parseSuppressionMarker,
} from '../electron/autoUpdate/failurePolicy.ts';

test('manual repair treats older leftover pending as stale cleanup state', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.11'), true);
});

test('same-version pending is stale and must not suppress future updates', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.12'), true);
});

test('newer pending still represents a real failed update attempt', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', '1.22.13'), false);
});

test('unknown pending version is handled conservatively as a real failure', () => {
  assert.equal(isStaleSwapFailureForCurrentVersion('1.22.12', null), false);
});

// ─── v1.149.1: 멈춤 표시에 실패한 새 버전을 함께 적는다 ───

test('멈춤 표시는 첫 줄에 앱 버전, 둘째 줄에 실패한 새 버전을 적고 그대로 읽힌다', () => {
  const text = formatSuppressionMarker('1.149.1', '1.150.0');
  assert.equal(text, '1.149.1\ntarget=1.150.0');
  assert.deepEqual(parseSuppressionMarker(text), { ownVersion: '1.149.1', failedTarget: '1.150.0' });
  // 설치 도우미(PowerShell)가 적는 CRLF·끝 줄바꿈도 같다.
  assert.deepEqual(parseSuppressionMarker('1.149.1\r\ntarget=1.150.0\r\n'), { ownVersion: '1.149.1', failedTarget: '1.150.0' });
});

test('실패한 새 버전을 모르면 예전 형식(앱 버전 한 줄)으로 적는다', () => {
  assert.equal(formatSuppressionMarker('1.149.1', null), '1.149.1');
  assert.equal(formatSuppressionMarker('1.149.1', undefined), '1.149.1');
  assert.equal(formatSuppressionMarker('1.149.1', "1.150.0'; Remove-Item"), '1.149.1', '버전 꼴이 아니면 적지 않는다');
  assert.deepEqual(parseSuppressionMarker('1.149.1'), { ownVersion: '1.149.1', failedTarget: null });
  assert.deepEqual(parseSuppressionMarker('1.149.1\n'), { ownVersion: '1.149.1', failedTarget: null });
  assert.deepEqual(parseSuppressionMarker('1.149.1\ntarget=garbage'), { ownVersion: '1.149.1', failedTarget: null });
  assert.deepEqual(parseSuppressionMarker(''), { ownVersion: '', failedTarget: null });
});

test('예전 형식 표시는 예전처럼 같은 앱 버전 동안 계속 멈춘다', () => {
  const old = parseSuppressionMarker('1.126.1');
  assert.equal(decideSuppression(old, '1.126.1', '1.149.1'), 'suppress');
  assert.equal(decideSuppression(old, '1.126.1', null), 'suppress');
  assert.equal(decideSuppression(old, '1.127.0', '1.149.1'), 'clear', '다른 앱 버전이 설치되면 지운다');
});

test('같은 새 버전에 대한 반복은 막고, 더 새 버전이 나오면 한 번 더 시도한다', () => {
  const marker = parseSuppressionMarker('1.149.1\ntarget=1.150.0');
  assert.equal(decideSuppression(marker, '1.149.1', '1.150.0'), 'suppress', '같은 새 버전');
  assert.equal(decideSuppression(marker, '1.149.1', '1.149.5'), 'suppress', '더 옛 버전');
  assert.equal(decideSuppression(marker, '1.149.1', null), 'suppress', '배포 쪽 버전을 모르면 멈춤');
  assert.equal(decideSuppression(marker, '1.149.1', '1.150.1'), 'retry-newer-target');
  assert.equal(decideSuppression(marker, '1.150.0', '1.150.1'), 'clear');
});

// ─── 실제 업데이트 확인·설치 직전 확인이 표시를 어떻게 다루는가(임시 폴더) ───

const HARNESS = '__autoUpdateSuppressionHarness';

function pathsStub(): Plugin {
  const names = {
    localInstallerPendingDir: "p.join(h().root, 'installer-pending')",
    localInstallerReadyMarker: "p.join(h().root, 'installer-pending', '.ready')",
    localInstallerManifestPath: "p.join(h().root, 'installer-pending', '.update-manifest.json')",
    localInstallerExePath: "p.join(h().root, 'installer-pending', 'BFLOW-Setup.exe')",
    localInstallerAttemptedMarker: "p.join(h().root, '.installer-attempted')",
    localSwapSuppressedMarker: "p.join(h().root, '.swap-suppressed')",
    localPendingDir: "p.join(h().root, 'legacy-pending')",
    localReadyMarker: "p.join(h().root, 'legacy-pending', '.ready')",
    localRoot: 'h().root',
    localBackupDir: "p.join(h().root, 'backup')",
    localBflowExe: "p.join(h().root, 'BFLOW.exe')",
    findRemoteManifest: "(fs.existsSync(p.join(h().remote, 'manifest.json')) ? p.join(h().remote, 'manifest.json') : null)",
    findRemoteInstaller: "(fs.existsSync(p.join(h().remote, 'BFLOW-Setup.exe')) ? p.join(h().remote, 'BFLOW-Setup.exe') : null)",
    getOwnVersion: 'h().own',
  };
  return {
    name: 'auto-update-paths-stub',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/paths$/ }, () => ({ path: 'paths', namespace: 'auto-update-stub' }));
      builder.onLoad({ filter: /^paths$/, namespace: 'auto-update-stub' }, () => ({
        contents: [
          "import p from 'path'; import fs from 'fs';",
          `const h = () => globalThis.${HARNESS};`,
          "export const INSTALLER_FILE_NAME = 'BFLOW-Setup.exe';",
          ...Object.entries(names).map(([name, body]) => `export function ${name}() { return ${body}; }`),
        ].join('\n'),
      }));
    },
  };
}

let bundleNonce = 0;
async function loadAutoUpdate(): Promise<Record<string, any>> {
  const result = await build({
    stdin: {
      contents: "export { prepareUpdate } from './electron/autoUpdate/checker.ts'; export { hasPendingInstallerUpdate } from './electron/autoUpdate/installerApply.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'auto-update-suppression-entry.ts',
    },
    bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false, plugins: [pathsStub()],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#suppression-${bundleNonce++}`);
}

function setup(own: string, remoteVersion: string | null) {
  const base = mkdtempSync(path.join(tmpdir(), 'bflow-suppression-'));
  const root = path.join(base, 'local');
  const remote = path.join(base, 'remote');
  mkdirSync(root, { recursive: true });
  mkdirSync(remote, { recursive: true });
  if (remoteVersion) {
    const installer = Buffer.from(`installer ${remoteVersion}`);
    writeFileSync(path.join(remote, 'BFLOW-Setup.exe'), installer);
    writeFileSync(path.join(remote, 'manifest.json'), JSON.stringify({
      version: remoteVersion, buildAt: '2026-11-05T00:00:00Z', installer: { fileName: 'BFLOW-Setup.exe', sizeBytes: installer.length },
    }));
  }
  (globalThis as Record<string, unknown>)[HARNESS] = { root, remote, own };
  const marker = path.join(root, '.swap-suppressed');
  const pending = path.join(root, 'installer-pending');
  return {
    root, marker, pending,
    attempted: path.join(root, '.installer-attempted'),
    writeMarker: (text: string) => writeFileSync(marker, text),
    leaveFailedInstaller: (version: string) => {
      mkdirSync(pending, { recursive: true });
      writeFileSync(path.join(pending, 'BFLOW-Setup.exe'), 'failed installer');
      writeFileSync(path.join(pending, '.update-manifest.json'), JSON.stringify({ version, buildAt: '', installer: { fileName: 'BFLOW-Setup.exe' } }));
      writeFileSync(path.join(pending, '.ready'), 'ready');
    },
    pendingVersion: () => existsSync(path.join(pending, '.update-manifest.json'))
      ? JSON.parse(readFileSync(path.join(pending, '.update-manifest.json'), 'utf-8')).version : null,
    cleanup: () => { delete (globalThis as Record<string, unknown>)[HARNESS]; rmSync(base, { recursive: true, force: true }); },
  };
}

test('업데이트 확인: 예전 형식 표시는 더 새 배포가 있어도 멈춘 채 받지 않는다', async () => {
  const { prepareUpdate } = await loadAutoUpdate();
  const h = setup('1.149.1', '1.150.1');
  try {
    h.writeMarker('1.149.1');
    const info = await prepareUpdate();
    assert.equal(info.status, 'suppressed');
    assert.equal(readFileSync(h.marker, 'utf-8'), '1.149.1', '표시는 그대로');
    assert.equal(existsSync(h.pending), false, '설치 파일을 받지 않는다');
  } finally { h.cleanup(); }
});

test('업데이트 확인: 실패했던 그 새 버전만 배포돼 있으면 계속 멈춘다', async () => {
  const { prepareUpdate } = await loadAutoUpdate();
  const h = setup('1.149.1', '1.150.0');
  try {
    h.writeMarker('1.149.1\ntarget=1.150.0');
    const info = await prepareUpdate();
    assert.equal(info.status, 'suppressed');
    assert.ok(existsSync(h.marker));
    assert.equal(existsSync(h.pending), false);
  } finally { h.cleanup(); }
});

test('업데이트 확인: 더 새 버전이 나오면 실패 흔적을 치우고 한 번 더 받는다', async () => {
  const { prepareUpdate } = await loadAutoUpdate();
  const h = setup('1.149.1', '1.150.1');
  try {
    h.writeMarker('1.149.1\ntarget=1.150.0');
    h.leaveFailedInstaller('1.150.0');
    writeFileSync(h.attempted, 'stale start marker');
    const info = await prepareUpdate();
    assert.equal(info.status, 'ready');
    assert.equal(info.latestVersion, '1.150.1');
    assert.equal(h.pendingVersion(), '1.150.1', '실패했던 1.150.0 설치 파일을 다시 쓰지 않는다');
    assert.equal(existsSync(h.marker), false, '멈춤 표시를 지운다(또 실패하면 도우미가 1.150.1 로 다시 적는다)');
    assert.equal(existsSync(h.attempted), false, '옛 시작 표시가 남아 다음 적용의 시작 확인을 건너뛰지 않게');
  } finally { h.cleanup(); }
});

test('업데이트 확인: 옛 시작 표시를 치우지 못하면 더 새 버전이어도 멈춤을 유지한다', async () => {
  const { prepareUpdate } = await loadAutoUpdate();
  const h = setup('1.149.1', '1.150.1');
  try {
    h.writeMarker('1.149.1\ntarget=1.150.0');
    // 시작 표시 자리에 지울 수 없는 것(내용 있는 폴더)을 둬 '잠긴 파일'을 흉내 낸다.
    mkdirSync(path.join(h.attempted, 'locked'), { recursive: true });
    const info = await prepareUpdate();
    assert.equal(info.status, 'suppressed');
    assert.ok(existsSync(h.marker));
    assert.equal(existsSync(h.pending), false);
  } finally { h.cleanup(); }
});

test('업데이트 확인: 다른 앱 버전이 설치되면 표시를 지우고 예전처럼 진행한다', async () => {
  const { prepareUpdate } = await loadAutoUpdate();
  const h = setup('1.149.1', '1.149.1');
  try {
    h.writeMarker('1.148.0\ntarget=1.149.0');
    const info = await prepareUpdate();
    assert.equal(info.status, 'up-to-date');
    assert.equal(existsSync(h.marker), false);
  } finally { h.cleanup(); }
});

test('설치 직전 확인: 같은 새 버전·예전 형식은 막고, 더 새 설치 파일만 통과시킨다', async () => {
  const { hasPendingInstallerUpdate } = await loadAutoUpdate();
  for (const [markerText, pendingVersion, expected] of [
    ['1.149.1\ntarget=1.150.0', '1.150.0', false],
    ['1.149.1', '1.150.1', false],
    ['1.149.1\ntarget=1.150.0', '1.150.1', true],
  ] as const) {
    const h = setup('1.149.1', null);
    try {
      h.writeMarker(markerText);
      h.leaveFailedInstaller(pendingVersion);
      assert.equal(await hasPendingInstallerUpdate('1.149.1'), expected, `${JSON.stringify(markerText)} / ${pendingVersion}`);
      assert.ok(existsSync(h.marker), '설치 직전 확인은 표시를 지우지 않는다');
    } finally { h.cleanup(); }
  }
});
