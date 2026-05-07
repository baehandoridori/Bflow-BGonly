/**
 * v1.21.0 자동 업데이트 — 메인 창 로드 후 5초 뒤 한 번 호출.
 * G드라이브 manifest와 자기 버전 비교 → 새 버전이면 pending/으로 변경분 복사
 * + .ready 마커 생성. swap은 swapper.ts가 종료 시 처리.
 *
 * spec §4.2 일상 사용 시나리오 step 4.
 */
import { promises as fsp, existsSync } from 'fs';
import path from 'path';
import {
  findRemoteWinUnpacked,
  findRemoteManifest,
  localPendingDir,
  localReadyMarker,
  localSwapSuppressedMarker,
  getOwnVersion,
} from './paths';
import { readManifest, compareVersions, countFilesAndBytes, type Manifest, type ReleaseNote } from './manifest';
import { copyDirMirror } from './copy';

export type UpdateStatus = 'available' | 'downloading' | 'ready' | 'up-to-date' | 'failed' | 'suppressed';

export interface UpdateInfo {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string;
  buildAt: string;
  ready: boolean;
  releaseNotes: ReleaseNote[];
  message?: string;
}

function buildUpdateInfo(
  status: UpdateStatus,
  currentVersion: string,
  manifest: Pick<Manifest, 'version' | 'buildAt' | 'releaseNotes'>,
  ready: boolean,
  message?: string,
): UpdateInfo {
  return {
    status,
    currentVersion,
    latestVersion: manifest.version,
    buildAt: manifest.buildAt,
    ready,
    releaseNotes: manifest.releaseNotes ?? [],
    message,
  };
}

function pendingManifestPath(): string {
  return path.join(localPendingDir(), '.update-manifest.json');
}

/**
 * 백그라운드 체크 — 한 번만 실행. 실패는 console.warn만.
 *
 * 호출자: main.ts의 mainWindow.webContents.once('did-finish-load') → setTimeout 5초 후.
 *
 * v1.22.1: 다운로드 + .ready 마커 작성이 완료되면 onReady 콜백 호출. main.ts가
 * 이를 받아 renderer에 'update:ready' IPC 송신 → 토스트 띄움.
 *
 * Codex 1차 P2: pending이 이미 ready인 케이스에서 *현재 fetch한 manifest version*을
 * 토스트로 알리면 misleading — pending에 들어있는 실제 build version과 다를 수 있음
 * (옛 다운로드 + 그 사이 새 manifest push 시나리오). 실제 pending payload의 version을
 * 읽어 알려준다.
 */
export async function scheduleUpdateCheck(
  onReady?: (info: UpdateInfo) => void,
  onState?: (info: UpdateInfo) => void,
): Promise<void> {
  try {
    const result = await prepareUpdate(onState);
    if (result?.ready) onReady?.(result);
  } catch (err) {
    console.warn('[autoUpdate] 체크 실패:', err);
  }
}

export async function prepareUpdate(onState?: (info: UpdateInfo) => void): Promise<UpdateInfo | null> {
  const own = getOwnVersion();

  // v1.22.3 P2 #2: suppression marker 검사. 직전에 swap 실패해서 사용자에게 안내한
  // 상태면 자동 재시도 중단. own version과 marker version이 다르면(사용자가 NSIS Setup
  // 등으로 갱신) marker 정리 후 자동업데이트 재개.
  const suppressionMarker = localSwapSuppressedMarker();
  if (existsSync(suppressionMarker)) {
    try {
      const recordedVersion = (await fsp.readFile(suppressionMarker, 'utf-8')).trim();
      if (recordedVersion === own) {
        console.log(`[autoUpdate] swap 실패 후 suppression 상태 (own=${own}) — fetch skip`);
        const info: UpdateInfo = {
          status: 'suppressed',
          currentVersion: own,
          latestVersion: own,
          buildAt: '',
          ready: false,
          releaseNotes: [],
          message: '이전 업데이트 적용 실패 후 자동 재시도가 중단된 상태입니다.',
        };
        onState?.(info);
        return info;
      }
      // own이 갱신됨 → marker 정리, 자동업데이트 재개
      await fsp.unlink(suppressionMarker);
      console.log(`[autoUpdate] suppression marker 정리 (recorded=${recordedVersion}, own=${own})`);
    } catch (err) {
      console.warn('[autoUpdate] suppression marker 처리 실패 (무시):', err);
    }
  }

  const pendingInfo = await readPendingUpdateInfo(own);
  if (pendingInfo) {
    console.log(`[autoUpdate] pending이 이미 ready 상태 — v${pendingInfo.latestVersion}`);
    onState?.(pendingInfo);
    return pendingInfo;
  }
  if (existsSync(localReadyMarker())) {
    console.log('[autoUpdate] stale pending ready 감지 — 원격 비교 전 pending 정리');
    await fsp.rm(localPendingDir(), { recursive: true, force: true });
  }

  const remoteManifestPath = findRemoteManifest();
  if (!remoteManifestPath) {
    console.log('[autoUpdate] G드라이브 manifest 없음 — skip');
    return null;
  }
  const remote = await readManifest(remoteManifestPath);
  if (!remote) {
    console.log('[autoUpdate] G드라이브 manifest 읽기 실패 — skip');
    return null;
  }
  const cmp = compareVersions(remote.version, own);
  if (cmp <= 0) {
    console.log(`[autoUpdate] 최신 (own=${own}, remote=${remote.version})`);
    const info = buildUpdateInfo('up-to-date', own, remote, false);
    onState?.(info);
    return info;
  }

  const available = buildUpdateInfo('available', own, remote, false);
  onState?.(available);
  console.log(`[autoUpdate] 새 버전 감지: ${own} → ${remote.version}. 백그라운드 다운로드 시작.`);

  onState?.(buildUpdateInfo('downloading', own, remote, false));
  const downloaded = await downloadToPending(remote);
  if (downloaded) {
    console.log(`[autoUpdate] 다운로드 완료. 다음 종료 시 swap.`);
    const readyInfo = await readPendingUpdateInfo(own)
      ?? buildUpdateInfo('ready', own, remote, true);
    onState?.(readyInfo);
    return readyInfo;
  }

  const failed = buildUpdateInfo(
    'failed',
    own,
    remote,
    false,
    'G드라이브 동기화가 아직 끝나지 않아 다음 실행 또는 다음 체크에서 다시 시도합니다.',
  );
  onState?.(failed);
  return failed;
}

/**
 * pending 폴더 안의 실제 빌드 version 읽기 — `pending/resources/app/package.json`.
 * pending이 옛 fetch 결과라면 fresh manifest와 version이 다를 수 있어, 토스트 표시는
 * 이 함수 결과를 우선 사용해야 swap 후 실제 적용될 version과 일치.
 */
async function readPendingVersion(): Promise<string | null> {
  try {
    const pkgPath = path.join(localPendingDir(), 'resources', 'app', 'package.json');
    const content = await fsp.readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content);
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function readPendingUpdateInfo(currentVersion = getOwnVersion()): Promise<UpdateInfo | null> {
  if (!existsSync(localReadyMarker())) return null;
  const pendingVer = await readPendingVersion();
  if (!pendingVer) return null;
  if (compareVersions(pendingVer, currentVersion) <= 0) return null;
  let manifest: Pick<Manifest, 'version' | 'buildAt' | 'releaseNotes'> = {
    version: pendingVer,
    buildAt: '',
    releaseNotes: [],
  };
  try {
    const parsed = await readManifest(pendingManifestPath());
    if (parsed) {
      manifest = {
        version: parsed.version === pendingVer ? parsed.version : pendingVer,
        buildAt: parsed.buildAt,
        releaseNotes: parsed.releaseNotes ?? [],
      };
    }
  } catch {
    // 옛 pending payload와 호환: package.json version만으로도 준비 상태를 표시한다.
  }
  return buildUpdateInfo('ready', currentVersion, manifest, true);
}

async function downloadToPending(remoteManifest: Manifest): Promise<boolean> {
  const remoteWinUnpacked = findRemoteWinUnpacked();
  if (!remoteWinUnpacked) throw new Error('원격 win-unpacked 없음');

  // pending이 .ready 상태(이전 다운로드 완료)여도 실제 pending payload가 현재 버전보다
  // 최신인지 확인한다. .ready만 남은 stale/무효 pending을 그대로 두면 토스트는 뜨지만
  // helper가 교체할 새 앱이 없어 "감지는 되는데 업데이트가 안 됨" 상태가 반복된다.
  const ready = localReadyMarker();
  if (existsSync(ready)) {
    const readyInfo = await readPendingUpdateInfo(getOwnVersion());
    if (readyInfo) {
      console.log(`[autoUpdate] pending이 이미 ready 상태 — 추가 다운로드 skip (v${readyInfo.latestVersion})`);
      return true;
    }
    console.log('[autoUpdate] stale pending ready 감지 — pending 정리 후 새로 다운로드');
    await fsp.rm(localPendingDir(), { recursive: true, force: true });
  }

  // Codex 9차 P1: 원격 sync 완전성 사전 검증.
  // Drive sync는 비동기 — manifest.json이 win-unpacked의 큰 파일들보다 먼저 도착 가능.
  // partial 상태에서 mirror copy + .ready 작성하면 broken app으로 swap됨.
  const expected = remoteManifest.fileCount != null && remoteManifest.totalBytes != null
    ? { fileCount: remoteManifest.fileCount, totalBytes: remoteManifest.totalBytes }
    : null;

  if (expected) {
    const remoteActual = countFilesAndBytes(remoteWinUnpacked);
    if (remoteActual.fileCount !== expected.fileCount || remoteActual.totalBytes !== expected.totalBytes) {
      console.log(
        `[autoUpdate] G드라이브 sync 미완료 (manifest: ${expected.fileCount}files/`
        + `${expected.totalBytes}B, 실제: ${remoteActual.fileCount}files/${remoteActual.totalBytes}B). `
        + `다음 체크 cycle에서 재시도.`,
      );
      return false; // .ready 작성 X
    }
  }
  // 호환 폴백 — 옛 manifest(fileCount 없음)는 핵심 파일 (BFLOW.exe) 존재만 검증
  if (!expected && !existsSync(path.join(remoteWinUnpacked, 'BFLOW.exe'))) {
    console.log('[autoUpdate] G드라이브 win-unpacked에 BFLOW.exe 없음 — sync 미완료, 다음 cycle 재시도');
    return false;
  }

  const pending = localPendingDir();
  await fsp.mkdir(pending, { recursive: true });

  // mirror 복사 (변경된 파일만)
  await copyDirMirror(remoteWinUnpacked, pending);

  // 사후 검증: 로컬 pending이 원격 manifest와 일치하는지 — copy 도중 네트워크 끊김 등 partial 케이스 차단.
  if (expected) {
    const localActual = countFilesAndBytes(pending);
    if (localActual.fileCount !== expected.fileCount || localActual.totalBytes !== expected.totalBytes) {
      console.warn(
        `[autoUpdate] mirror copy partial — 로컬 pending(${localActual.fileCount}files/`
        + `${localActual.totalBytes}B) ≠ manifest(${expected.fileCount}files/`
        + `${expected.totalBytes}B). .ready 작성 skip — 다음 cycle 재시도.`,
      );
      return false; // .ready 작성 X
    }
  }

  // .ready 마커 — swapper가 이걸 보고 swap 실행
  await fsp.writeFile(pendingManifestPath(), JSON.stringify(remoteManifest, null, 2) + '\n', 'utf-8');
  await fsp.writeFile(ready, new Date().toISOString(), 'utf-8');
  return true;
}
