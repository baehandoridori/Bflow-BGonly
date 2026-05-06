/**
 * v1.21.0 자동 업데이트 — 메인 창 로드 후 5초 뒤 한 번 호출.
 * G드라이브 manifest와 자기 버전 비교 → 새 버전이면 pending/으로 변경분 복사
 * + .ready 마커 생성. swap은 swapper.ts가 종료 시 처리.
 *
 * spec §4.2 일상 사용 시나리오 step 4.
 */
import { promises as fsp, existsSync } from 'fs';
import {
  findRemoteWinUnpacked,
  findRemoteManifest,
  localPendingDir,
  localReadyMarker,
  getOwnVersion,
} from './paths';
import { readManifest, compareVersions } from './manifest';
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
    await downloadToPending();
    console.log(`[autoUpdate] 다운로드 완료. 다음 종료 시 swap.`);
  } catch (err) {
    console.warn('[autoUpdate] 체크 실패:', err);
  }
}

async function downloadToPending(): Promise<void> {
  const remoteWinUnpacked = findRemoteWinUnpacked();
  if (!remoteWinUnpacked) throw new Error('원격 win-unpacked 없음');

  // pending이 .ready 상태(이전 다운로드 완료)인 경우는 그대로 둠 — swap만 기다림.
  // 사용자가 종료-재실행을 안 거친 사이에 또 새 버전 push되면 다음 cycle에서 pick.
  const ready = localReadyMarker();
  if (existsSync(ready)) {
    console.log('[autoUpdate] pending이 이미 ready 상태 — 추가 다운로드 skip');
    return;
  }

  const pending = localPendingDir();
  await fsp.mkdir(pending, { recursive: true });

  // mirror 복사 (변경된 파일만)
  await copyDirMirror(remoteWinUnpacked, pending);

  // .ready 마커 — swapper가 이걸 보고 swap 실행
  await fsp.writeFile(ready, new Date().toISOString(), 'utf-8');
}
