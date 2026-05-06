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
import { promises as fsp, existsSync, renameSync } from 'fs';
import path from 'path';
import {
  localAppDir, localPendingDir, localBackupDir, localReadyMarker,
  localInstalledMarker, localPendingVerificationMarker,
} from './paths';
import { copyDirMirror } from './copy';

/**
 * Codex 8차 P1: rename은 cross-device·AV race·partial file-lock 등에서 실패할 수 있어
 * fallback으로 copy + 원본 삭제. swap의 핵심 안전성을 보장 — rename 실패 시에도
 * app/ 디렉토리가 사라지지 않게.
 */
async function moveDirRobust(src: string, dst: string): Promise<void> {
  try {
    renameSync(src, dst);
    return;
  } catch (renameErr) {
    // rename 실패 → copy fallback (느리지만 락에 robust)
    try {
      await copyDirMirror(src, dst);
      await fsp.rm(src, { recursive: true, force: true });
    } catch (copyErr) {
      throw new Error(
        `rename 및 copy 모두 실패 (rename: ${(renameErr as Error).message}, `
        + `copy: ${(copyErr as Error).message})`,
      );
    }
  }
}

export async function hasPending(): Promise<boolean> {
  return existsSync(localReadyMarker());
}

export interface SwapResult {
  ok: boolean;
  reason?: string;
}

/**
 * pending → app swap. before-quit hook에서 호출.
 * 동기 rename 사용 — 짧고 결정론적이어야 함.
 */
export async function swapIfPending(): Promise<SwapResult> {
  const ready = localReadyMarker();
  if (!existsSync(ready)) return { ok: false, reason: 'no-pending' };

  const app_ = localAppDir();
  const pending_ = localPendingDir();
  const backup_ = localBackupDir();

  // 1. 이전 backup 정리 — 1개만 유지하니 통째로 지움 (실패해도 무시)
  try {
    if (existsSync(backup_)) {
      await fsp.rm(backup_, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[swapper] 이전 backup 정리 실패 (무시):', err);
  }

  // 2. app/ → backup/  (rename + copy fallback)
  let movedToBackup = false;
  if (existsSync(app_)) {
    try {
      await moveDirRobust(app_, backup_);
      movedToBackup = true;
    } catch (err) {
      return { ok: false, reason: `app→backup 실패: ${(err as Error).message}` };
    }
  }

  // 3. pending/ → app/  (rename + copy fallback)
  try {
    await moveDirRobust(pending_, app_);
  } catch (pendingErr) {
    // Codex 8차 P1: pending→app 실패 시 backup→app 복구 시도. backup 복구도 robust하게.
    if (movedToBackup) {
      try {
        await moveDirRobust(backup_, app_);
        return { ok: false, reason: `pending→app 실패 — backup 복구 완료: ${(pendingErr as Error).message}` };
      } catch (recoverErr) {
        // 양쪽 모두 실패 — app/ 부재 가능성. 다음 실행은 옛 G드라이브 BFLOW.exe로 self-installer
        // 재진입하면 자동 복구됨 (기존 partial install 정리 → mirror copy 새로 받음).
        return {
          ok: false,
          reason:
            `pending→app + backup→app 모두 실패. app/ 부재 가능성 — `
            + `옛 G드라이브 BFLOW.exe 클릭으로 자동 복구 가능. `
            + `pending: ${(pendingErr as Error).message}; backup recovery: ${(recoverErr as Error).message}`,
        };
      }
    }
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

  return { ok: true };
}
