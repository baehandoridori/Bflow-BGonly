/**
 * v1.21.0 자동 업데이트 — before-quit hook에서 호출.
 * pending/.ready 가 있으면 app/ → backup/, pending/ → app/ 으로 swap.
 *
 * 락 안전성:
 *   app/ 내부 BFLOW.exe는 *현재 실행 중*이라 락 걸려있다고 생각하기 쉽지만,
 *   Windows의 directory rename은 자식 파일의 락과 무관하게 디렉토리 자체가 비어있지
 *   않으면 atomic rename. before-quit hook은 *renderer가 종료된 후 메인 프로세스 종료
 *   직전*에 발화하므로 BFLOW.exe 파일 자체는 여전히 실행 중이지만, 디렉토리 rename은
 *   가능 (Windows는 실행 중 exe의 부모 디렉토리 rename 허용).
 *
 *   그래도 일부 시나리오에서 락이 걸릴 수 있으므로(드물게 antivirus 등) 실패 시 graceful
 *   처리: app/ → backup 시도가 실패하면 그대로 두고 swap 안 함. 다음 종료 시 재시도.
 *
 * spec §4.2 step 6, §6 "swap 실패 / 새 버전 깨짐" 처리.
 */
import { promises as fsp, existsSync, renameSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import {
  localRoot, localAppDir, localPendingDir, localBackupDir, localReadyMarker,
  localInstalledMarker, localPendingVerificationMarker, localSwapAttemptedMarker,
  localSwapSuppressedMarker, getOwnVersion,
} from './paths';
import { copyDirMirror } from './copy';
import { compareVersions } from './manifest';

/**
 * v1.22.2 swap 단계별 진단 로그 — `%LOCALAPPDATA%\Bflow-BGonly\swap.log`.
 * swap이 어디서 실패했는지 사용자 환경에서도 추적 가능하도록 파일에 기록.
 * sync write — swap은 짧고 결정론적이어야 하므로 비동기 큐잉 X.
 *
 * v1.22.3 P1: NSIS 첫 설치 PC는 self-installer install() 흐름을 거치지 않아
 * `localRoot()` 디렉토리(`%LOCALAPPDATA%\Bflow-BGonly\`)가 미리 만들어져 있지 않을 수
 * 있음. 부모 dir 보장 후 write — 이게 없으면 ENOENT로 silent fail하고 진짜 swap 실패도
 * 추적 불가.
 */
function logSwap(line: string): void {
  try {
    const root = localRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const logPath = path.join(root, 'swap.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf-8');
  } catch {
    /* 로깅 실패는 swap 자체를 막지 않음 — best effort */
  }
}

/**
 * Codex 8차 P1: rename은 cross-device·AV race·partial file-lock 등에서 실패할 수 있어
 * fallback으로 copy + 원본 삭제. swap의 핵심 안전성을 보장 — rename 실패 시에도
 * app/ 디렉토리가 사라지지 않게.
 *
 * v1.22.2: rename 자체에 짧은 retry 추가 (file lock이 일시적 — Defender 검사 직후 등 —
 * 인 케이스 회피). copy fallback은 느리고 7000파일 통째로 다시 쓰므로 가능한 한 rename
 * 으로 해결.
 */
async function moveDirRobust(src: string, dst: string, label: string): Promise<void> {
  const RENAME_RETRIES = 3;
  const RENAME_DELAY_MS = 500;
  let lastRenameErr: unknown = null;
  for (let i = 0; i < RENAME_RETRIES; i++) {
    try {
      renameSync(src, dst);
      logSwap(`  ${label}: rename OK (try ${i + 1})`);
      return;
    } catch (renameErr) {
      lastRenameErr = renameErr;
      logSwap(`  ${label}: rename try ${i + 1} 실패 — ${(renameErr as Error).message}`);
      if (i < RENAME_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RENAME_DELAY_MS));
      }
    }
  }
  // rename retry 모두 실패 → copy fallback (느리지만 락에 robust)
  logSwap(`  ${label}: copy fallback 시작`);
  try {
    await copyDirMirror(src, dst);
    await fsp.rm(src, { recursive: true, force: true });
    logSwap(`  ${label}: copy fallback OK`);
  } catch (copyErr) {
    logSwap(`  ${label}: copy fallback 실패 — ${(copyErr as Error).message}`);
    throw new Error(
      `rename(${RENAME_RETRIES}회) 및 copy 모두 실패 (rename: ${(lastRenameErr as Error).message}, `
      + `copy: ${(copyErr as Error).message})`,
    );
  }
}

async function readPendingPackageVersion(): Promise<string | null> {
  try {
    const pkgPath = path.join(localPendingDir(), 'resources', 'app', 'package.json');
    const content = await fsp.readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content);
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

async function isSwapSuppressedForCurrentVersion(currentVersion: string): Promise<boolean> {
  const marker = localSwapSuppressedMarker();
  if (!existsSync(marker)) return false;
  try {
    const recordedVersion = (await fsp.readFile(marker, 'utf-8')).trim();
    if (recordedVersion === currentVersion) return true;
    await fsp.unlink(marker);
    logSwap(`  stale suppression marker 정리 (recorded=${recordedVersion}, current=${currentVersion})`);
  } catch (err) {
    logSwap(`  suppression marker 확인 실패 — ${(err as Error).message}`);
  }
  return false;
}

export async function hasPending(currentVersion = getOwnVersion()): Promise<boolean> {
  if (!existsSync(localReadyMarker())) return false;
  if (await isSwapSuppressedForCurrentVersion(currentVersion)) {
    logSwap(`  swap skip: suppression active (current=${currentVersion})`);
    return false;
  }

  const pendingVersion = await readPendingPackageVersion();
  if (!pendingVersion || compareVersions(pendingVersion, currentVersion) <= 0) {
    logSwap(
      `  stale pending ready 정리 (pending=${pendingVersion ?? 'unknown'}, current=${currentVersion})`,
    );
    try {
      await fsp.rm(localPendingDir(), { recursive: true, force: true });
    } catch (err) {
      logSwap(`  stale pending 정리 실패 — ${(err as Error).message}`);
    }
    return false;
  }
  return true;
}

export interface SwapResult {
  ok: boolean;
  reason?: string;
}

/**
 * pending → app swap. before-quit hook에서 호출.
 * 동기 rename 사용 — 짧고 결정론적이어야 함.
 *
 * v1.22.2: 단계별 진단 로그 + rename retry. swap 실패 사유를 사용자 환경에서도
 * 추적 가능 (`%LOCALAPPDATA%\Bflow-BGonly\swap.log`).
 */
export async function swapIfPending(): Promise<SwapResult> {
  const ready = localReadyMarker();
  if (!existsSync(ready)) return { ok: false, reason: 'no-pending' };

  const app_ = localAppDir();
  const pending_ = localPendingDir();
  const backup_ = localBackupDir();
  const attemptedMarker = localSwapAttemptedMarker();

  logSwap(`=== swap start ===`);
  logSwap(`  app=${app_}`);
  logSwap(`  pending=${pending_}`);
  logSwap(`  backup=${backup_}`);

  // v1.22.3: swap 진입 시점에 .swap-attempted 마커 작성. crash/kill로 종료된 케이스에서
  // .ready만 검사하면 false positive(swap 실제 시도 없었는데 실패로 오인)가 발생.
  // 이 마커가 함께 남아있어야 진짜 swap 실패. 정상 종료/복구 시 정리.
  //
  // Codex 2차 P1: NSIS 첫 설치 PC는 self-installer install() 흐름을 거치지 않아
  // localRoot() 디렉토리가 미리 만들어져 있지 않을 수 있음. write 전 mkdir 보장 —
  // 이게 없으면 ENOENT로 silent fail하고 진짜 swap 실패 시 dialog 안 떠서 retry loop.
  try {
    await fsp.mkdir(localRoot(), { recursive: true });
    await fsp.writeFile(attemptedMarker, new Date().toISOString() + '\n', 'utf-8');
  } catch (err) {
    logSwap(`  swap-attempted 마커 작성 실패 (무시) — ${(err as Error).message}`);
  }

  // 1. 이전 backup 정리 — 1개만 유지하니 통째로 지움 (실패해도 무시)
  try {
    if (existsSync(backup_)) {
      await fsp.rm(backup_, { recursive: true, force: true });
      logSwap(`  step1 backup 정리 OK`);
    } else {
      logSwap(`  step1 backup 없음 — skip`);
    }
  } catch (err) {
    logSwap(`  step1 backup 정리 실패 (무시) — ${(err as Error).message}`);
  }

  // v1.22.0: NSIS Uninstall.exe 보존. NSIS 인스톨러로 설치된 경우 install dir에
  // `Uninstall BFLOW.exe`가 있고, 그게 없으면 Windows "프로그램 추가/제거"의 BFLOW
  // 항목이 깨짐. swap = pending → app dir rename이라 새 app dir엔 Uninstall이 없음.
  // swap 직전에 pending으로 copy해 swap 후에도 보존.
  const uninstallName = 'Uninstall BFLOW.exe';
  const oldUninstall = path.join(app_, uninstallName);
  const newUninstall = path.join(pending_, uninstallName);
  if (existsSync(oldUninstall) && !existsSync(newUninstall)) {
    try {
      await fsp.copyFile(oldUninstall, newUninstall);
      logSwap(`  Uninstall.exe 보존 OK`);
    } catch (err) {
      logSwap(`  Uninstall.exe 보존 실패 (무시) — ${(err as Error).message}`);
    }
  }

  // 2. app/ → backup/  (rename + copy fallback)
  let movedToBackup = false;
  if (existsSync(app_)) {
    try {
      await moveDirRobust(app_, backup_, 'step2 app→backup');
      movedToBackup = true;
    } catch (err) {
      logSwap(`=== swap end: FAIL (app→backup) — ${(err as Error).message}`);
      return { ok: false, reason: `app→backup 실패: ${(err as Error).message}` };
    }
  } else {
    logSwap(`  step2 app 부재 — skip`);
  }

  // 3. pending/ → app/  (rename + copy fallback)
  try {
    await moveDirRobust(pending_, app_, 'step3 pending→app');
  } catch (pendingErr) {
    // Codex 8차 P1: pending→app 실패 시 backup→app 복구 시도. backup 복구도 robust하게.
    if (movedToBackup) {
      try {
        await moveDirRobust(backup_, app_, 'step3-recover backup→app');
        logSwap(`=== swap end: FAIL (pending→app, backup recovered) — ${(pendingErr as Error).message}`);
        return { ok: false, reason: `pending→app 실패 — backup 복구 완료: ${(pendingErr as Error).message}` };
      } catch (recoverErr) {
        logSwap(`=== swap end: CATASTROPHIC (app/ 부재) — pending: ${(pendingErr as Error).message}; backup recovery: ${(recoverErr as Error).message}`);
        return {
          ok: false,
          reason:
            `pending→app + backup→app 모두 실패. app/ 부재 가능성. `
            + `pending: ${(pendingErr as Error).message}; backup recovery: ${(recoverErr as Error).message}`,
        };
      }
    }
    logSwap(`=== swap end: FAIL (pending→app, backup 없음) — ${(pendingErr as Error).message}`);
    return { ok: false, reason: `pending→app 실패 (backup 없어 복구 없음): ${(pendingErr as Error).message}` };
  }

  // 4. .ready 마커 정리 — pending 안에 있던 마커가 swap으로 app/.ready가 됨
  try {
    const stale = path.join(app_, '.ready');
    if (existsSync(stale)) await fsp.unlink(stale);
  } catch { /* 무시 */ }

  // 5. .installed 마커 작성 — swap된 새 app/도 정상 설치 상태로 표시.
  //    이게 없으면 다음 실행 시 installer.ts가 partial install로 잘못 감지하고 G드라이브
  //    click 시 정리·재설치 흐름 진입. 마커는 pending에서는 안 만들었으니 swap 후 명시 작성.
  try {
    await fsp.writeFile(localInstalledMarker(), new Date().toISOString() + '\n', 'utf-8');
  } catch (err) {
    console.warn('[swapper] .installed 마커 작성 실패 (무시 — 다음 실행에서 재설치 트리거 가능):', err);
  }

  // 6. .pending-verification 마커 작성 — 새 빌드로 swap 직후이므로 *다음 실행*은 검증 모드.
  //    healthCheck가 이 마커가 있을 때만 .start-attempt를 트래킹해 rollback 트리거.
  //    그 외 일상 실행(평소 강제 종료·시스템 kill 등)은 검증 비활성으로 의도치 않은 롤백 X.
  //    Codex 6차 P1.
  try {
    await fsp.writeFile(localPendingVerificationMarker(), new Date().toISOString() + '\n', 'utf-8');
  } catch (err) {
    console.warn('[swapper] .pending-verification 마커 작성 실패 (무시 — 자가 검증 비활성, 안전):', err);
  }

  // v1.22.3: swap 끝까지 성공한 경우만 .swap-attempted 정리. 실패 경로(catastrophic 또는
  // 부분 실패)는 마커 유지 → 다음 시작 시 main.ts notifyAndCleanupOnSwapFailure가 dialog로
  // 안내. 부분 실패(backup 복구 성공)도 사용자 입장에선 "옛 버전 그대로"이므로 알림 필요.
  try {
    if (existsSync(attemptedMarker)) await fsp.unlink(attemptedMarker);
  } catch { /* 무시 */ }

  logSwap(`=== swap end: OK ===`);
  return { ok: true };
}
