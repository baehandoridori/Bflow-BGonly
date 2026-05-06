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
  getOwnVersion,
} from './paths';
import { readManifest, compareVersions, countFilesAndBytes, type Manifest } from './manifest';
import { copyDirMirror } from './copy';

/**
 * 백그라운드 체크 — 한 번만 실행. 실패는 console.warn만 (사용자 알림 X — UX 패턴 A).
 *
 * 호출자: main.ts의 mainWindow.webContents.once('did-finish-load') → setTimeout 5초 후.
 */
export async function scheduleUpdateCheck(): Promise<void> {
  try {
    const remoteManifestPath = findRemoteManifest();
    if (!remoteManifestPath) {
      console.log('[autoUpdate] G드라이브 manifest 없음 — skip');
      return;
    }
    const remote = await readManifest(remoteManifestPath);
    if (!remote) {
      console.log('[autoUpdate] G드라이브 manifest 읽기 실패 — skip');
      return;
    }
    const own = getOwnVersion();
    const cmp = compareVersions(remote.version, own);
    if (cmp <= 0) {
      console.log(`[autoUpdate] 최신 (own=${own}, remote=${remote.version})`);
      return;
    }
    console.log(`[autoUpdate] 새 버전 감지: ${own} → ${remote.version}. 백그라운드 다운로드 시작.`);
    await downloadToPending(remote);
    console.log(`[autoUpdate] 다운로드 완료. 다음 종료 시 swap.`);
  } catch (err) {
    console.warn('[autoUpdate] 체크 실패:', err);
  }
}

async function downloadToPending(remoteManifest: Manifest): Promise<void> {
  const remoteWinUnpacked = findRemoteWinUnpacked();
  if (!remoteWinUnpacked) throw new Error('원격 win-unpacked 없음');

  // pending이 .ready 상태(이전 다운로드 완료)인 경우는 그대로 둠 — swap만 기다림.
  const ready = localReadyMarker();
  if (existsSync(ready)) {
    console.log('[autoUpdate] pending이 이미 ready 상태 — 추가 다운로드 skip');
    return;
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
      return; // .ready 작성 X
    }
  }
  // 호환 폴백 — 옛 manifest(fileCount 없음)는 핵심 파일 (BFLOW.exe) 존재만 검증
  if (!expected && !existsSync(path.join(remoteWinUnpacked, 'BFLOW.exe'))) {
    console.log('[autoUpdate] G드라이브 win-unpacked에 BFLOW.exe 없음 — sync 미완료, 다음 cycle 재시도');
    return;
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
      return; // .ready 작성 X
    }
  }

  // .ready 마커 — swapper가 이걸 보고 swap 실행
  await fsp.writeFile(ready, new Date().toISOString(), 'utf-8');
}
