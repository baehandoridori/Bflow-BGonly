/**
 * 자동 업데이트 준비 단계.
 *
 * v1.22.14부터는 win-unpacked 폴더 전체를 직접 mirror/swap하지 않는다. G드라이브의
 * NSIS installer(BFLOW-Setup.exe)를 로컬 캐시에 받아두고, 적용 시 앱 종료 후 installer를
 * 실행한다. Windows가 실행 중 앱 폴더를 잠그는 문제를 installer 책임으로 넘기기 위함.
 */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fsp,
  statSync,
} from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import {
  INSTALLER_FILE_NAME,
  findRemoteInstaller,
  findRemoteManifest,
  localInstallerExePath,
  localInstallerManifestPath,
  localInstallerPendingDir,
  localInstallerReadyMarker,
  localPendingDir,
  localReadyMarker,
  localSwapSuppressedMarker,
  getOwnVersion,
} from './paths';
import { readManifest, compareVersions, type Manifest, type ReleaseNote } from './manifest';

export type UpdateStatus =
  | 'available'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'up-to-date'
  | 'failed'
  | 'suppressed';

export interface UpdateInfo {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string;
  buildAt: string;
  ready: boolean;
  releaseNotes: ReleaseNote[];
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

function buildUpdateInfo(
  status: UpdateStatus,
  currentVersion: string,
  manifest: Pick<Manifest, 'version' | 'buildAt' | 'releaseNotes' | 'installer'>,
  ready: boolean,
  extra: Pick<UpdateInfo, 'message' | 'downloadedBytes' | 'totalBytes'> = {},
): UpdateInfo {
  return {
    status,
    currentVersion,
    latestVersion: manifest.version,
    buildAt: manifest.buildAt,
    ready,
    releaseNotes: manifest.releaseNotes ?? [],
    downloadedBytes: extra.downloadedBytes,
    totalBytes: extra.totalBytes ?? manifest.installer?.sizeBytes,
    message: extra.message,
  };
}

/**
 * 백그라운드 체크. 실패는 앱 사용을 막지 않고 상태만 알린다.
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

  const suppressionMarker = localSwapSuppressedMarker();
  if (existsSync(suppressionMarker)) {
    try {
      const recordedVersion = (await fsp.readFile(suppressionMarker, 'utf-8')).trim();
      if (recordedVersion === own) {
        console.log(`[autoUpdate] 적용 실패 후 suppression 상태 (own=${own}) — fetch skip`);
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
      await fsp.unlink(suppressionMarker);
      console.log(`[autoUpdate] suppression marker 정리 (recorded=${recordedVersion}, own=${own})`);
    } catch (err) {
      console.warn('[autoUpdate] suppression marker 처리 실패 (무시):', err);
    }
  }

  await cleanupLegacyWinUnpackedPendingIfNeeded();

  const pendingInfo = await readPendingUpdateInfo(own);
  if (pendingInfo) {
    console.log(`[autoUpdate] installer pending이 이미 ready 상태 — v${pendingInfo.latestVersion}`);
    onState?.(pendingInfo);
    return pendingInfo;
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

  const available = buildUpdateInfo('available', own, remote, false, {
    message: '새 버전을 확인했습니다. 설치 파일을 로컬로 준비합니다.',
  });
  onState?.(available);
  console.log(`[autoUpdate] 새 버전 감지: ${own} → ${remote.version}. installer 다운로드 시작.`);

  onState?.(buildUpdateInfo('downloading', own, remote, false, {
    message: '설치 파일을 로컬로 받는 중입니다.',
    downloadedBytes: 0,
  }));

  let downloaded = false;
  try {
    downloaded = await downloadInstallerToPending(remote, own, onState);
  } catch (err) {
    console.warn('[autoUpdate] installer 다운로드 실패:', err);
  }

  if (downloaded) {
    console.log('[autoUpdate] installer 다운로드 완료. 적용 준비됨.');
    const readyInfo = await readPendingUpdateInfo(own)
      ?? buildUpdateInfo('ready', own, remote, true, {
        message: '업데이트 설치 파일이 준비되었습니다.',
      });
    onState?.(readyInfo);
    return readyInfo;
  }

  const failed = buildUpdateInfo('failed', own, remote, false, {
    message: 'G드라이브 동기화가 아직 끝나지 않아 다음 실행 또는 다음 체크에서 다시 시도합니다.',
  });
  onState?.(failed);
  return failed;
}

export async function readPendingUpdateInfo(currentVersion = getOwnVersion()): Promise<UpdateInfo | null> {
  if (!existsSync(localInstallerReadyMarker())) return null;
  if (!existsSync(localInstallerExePath())) {
    await cleanupInstallerPending('installer exe missing');
    return null;
  }

  const parsed = await readManifest(localInstallerManifestPath());
  if (!parsed) {
    await cleanupInstallerPending('manifest missing');
    return null;
  }
  if (compareVersions(parsed.version, currentVersion) <= 0) {
    await cleanupInstallerPending(`stale installer ${parsed.version}`);
    return null;
  }

  const localSize = safeFileSize(localInstallerExePath());
  const expectedSize = parsed.installer?.sizeBytes;
  if (expectedSize != null && localSize != null && localSize !== expectedSize) {
    await cleanupInstallerPending(`partial installer ${localSize}/${expectedSize}`);
    return null;
  }

  return buildUpdateInfo('ready', currentVersion, parsed, true, {
    message: '업데이트 설치 파일이 준비되었습니다. 적용하면 앱이 잠시 닫힌 뒤 최신 버전으로 열립니다.',
    downloadedBytes: localSize ?? expectedSize,
    totalBytes: expectedSize ?? localSize,
  });
}

async function downloadInstallerToPending(
  remoteManifest: Manifest,
  currentVersion: string,
  onState?: (info: UpdateInfo) => void,
): Promise<boolean> {
  const existingReady = await readPendingUpdateInfo(currentVersion);
  if (existingReady) return true;

  await cleanupInstallerPending('fresh download');

  const installerFileName = remoteManifest.installer?.fileName || INSTALLER_FILE_NAME;
  const remoteInstaller = findRemoteInstaller(installerFileName);
  if (!remoteInstaller) throw new Error(`원격 installer 없음: ${installerFileName}`);

  const remoteSize = safeFileSize(remoteInstaller);
  const expectedSize = remoteManifest.installer?.sizeBytes ?? remoteSize;
  if (expectedSize != null && remoteSize != null && remoteSize !== expectedSize) {
    console.log(
      `[autoUpdate] G드라이브 installer sync 미완료 `
      + `(manifest=${expectedSize}B, actual=${remoteSize}B). 다음 cycle에서 재시도.`,
    );
    return false;
  }

  const pendingDir = localInstallerPendingDir();
  await fsp.mkdir(pendingDir, { recursive: true });
  const localInstaller = localInstallerExePath();
  const partialInstaller = `${localInstaller}.part`;

  try {
    await copyInstallerFile(remoteInstaller, partialInstaller, expectedSize, (copied, total) => {
      onState?.(buildUpdateInfo('downloading', currentVersion, remoteManifest, false, {
        message: '설치 파일을 로컬로 받는 중입니다.',
        downloadedBytes: copied,
        totalBytes: total,
      }));
    });
    await fsp.rename(partialInstaller, localInstaller);
  } catch (err) {
    await fsp.rm(partialInstaller, { force: true }).catch(() => undefined);
    throw err;
  }

  const localSize = safeFileSize(localInstaller);
  if (expectedSize != null && localSize !== expectedSize) {
    console.warn(`[autoUpdate] installer copy partial — local=${localSize}B, expected=${expectedSize}B`);
    await cleanupInstallerPending('partial copy');
    return false;
  }

  const manifestForPending: Manifest = {
    ...remoteManifest,
    installer: {
      fileName: INSTALLER_FILE_NAME,
      sizeBytes: expectedSize,
    },
  };
  await fsp.writeFile(localInstallerManifestPath(), JSON.stringify(manifestForPending, null, 2) + '\n', 'utf-8');
  await fsp.writeFile(localInstallerReadyMarker(), new Date().toISOString(), 'utf-8');
  return true;
}

async function copyInstallerFile(
  src: string,
  dst: string,
  totalBytes: number | undefined,
  onProgress: (copiedBytes: number, totalBytes: number | undefined) => void,
): Promise<void> {
  let copiedBytes = 0;
  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    onProgress(copiedBytes, totalBytes);
  };

  const reader = createReadStream(src);
  reader.on('data', (chunk) => {
    copiedBytes += chunk.length;
    emit();
  });
  emit(true);
  await pipeline(reader, createWriteStream(dst));
  emit(true);
}

async function cleanupInstallerPending(reason: string): Promise<void> {
  if (!existsSync(localInstallerPendingDir())) return;
  console.log(`[autoUpdate] installer pending 정리 (${reason})`);
  await fsp.rm(localInstallerPendingDir(), { recursive: true, force: true });
}

async function cleanupLegacyWinUnpackedPendingIfNeeded(): Promise<void> {
  if (!existsSync(localReadyMarker())) return;
  console.log('[autoUpdate] legacy win-unpacked pending 감지 — installer 방식 전환을 위해 정리');
  await fsp.rm(localPendingDir(), { recursive: true, force: true });
}

function safeFileSize(filePath: string): number | undefined {
  try {
    return statSync(filePath).size;
  } catch {
    return undefined;
  }
}
