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
} from './paths';

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

  // 2. app/ → backup/
  try {
    if (existsSync(app_)) {
      renameSync(app_, backup_);
    }
  } catch (err) {
    return { ok: false, reason: `app→backup rename 실패: ${(err as Error).message}` };
  }

  // 3. pending/ → app/
  try {
    renameSync(pending_, app_);
  } catch (err) {
    // 복구 시도: backup → app으로 되돌림
    try { renameSync(backup_, app_); } catch {
      // 더 할 게 없음 — 사용자가 옛 바로가기로 self-installer 재진입
    }
    return { ok: false, reason: `pending→app rename 실패: ${(err as Error).message}` };
  }

  // 4. .ready 마커 정리 — pending 안에 있던 마커가 swap으로 app/.ready가 됨
  try {
    const stale = path.join(app_, '.ready');
    if (existsSync(stale)) await fsp.unlink(stale);
  } catch { /* 무시 */ }

  return { ok: true };
}
