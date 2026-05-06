/**
 * v1.21.0 자가 검증 — 앱 시작 실패 시 backup/ 자동 롤백.
 *
 * 메커니즘:
 *   시작 시 .start-attempt 마커 작성 → 메인 창 did-finish-load 시점에 마커 삭제.
 *   다음 시작 때 마커가 *남아있으면* = 이전 시작이 도중 실패 → backup → app 롤백.
 *
 * spec §6 "swap 실패 / 새 버전 깨짐" 처리.
 */
import { promises as fsp, existsSync, renameSync } from 'fs';
import path from 'path';
import { localAppDir, localBackupDir, localRoot } from './paths';

const ATTEMPT_MARKER = path.join(localRoot(), '.start-attempt');

export interface HealthResult {
  /** 이전 시작 실패 감지 → backup → app 롤백 했는지 */
  rolledBack: boolean;
}

/**
 * app.whenReady 직후 — 마커 검사 + (필요 시) 롤백 + 새 마커 작성.
 * 호출자: runFirstInstallIfNeeded 다음, 메인 창 생성 전.
 *
 * 주의: 롤백은 *다음 실행*용. 현재 main process는 이미 새(깨진) 코드로 시작됐을 가능성이
 * 있어, 메인 창 생성 시점까지 못 가면 어차피 다음 실행에서 영향. 이 함수가 만든 새 마커
 * 가 다음 시작 시 또 발견되면 backup도 깨졌다는 뜻이라 롤백 무한 루프 방지를 위해
 * backup이 없으면 그냥 진행.
 */
export async function checkLastStartAndRollback(): Promise<HealthResult> {
  const hadFailure = existsSync(ATTEMPT_MARKER);
  let rolledBack = false;

  if (hadFailure) {
    const app_ = localAppDir();
    const backup_ = localBackupDir();
    if (existsSync(backup_)) {
      try {
        // app/ → .corrupt-<ts>/ 로 보존 (진단용, 다음 swap 시 정리됨)
        const corrupt = path.join(localRoot(), '.corrupt-' + Date.now());
        if (existsSync(app_)) renameSync(app_, corrupt);
        renameSync(backup_, app_);
        await fsp.unlink(ATTEMPT_MARKER).catch(() => { /* noop */ });
        console.warn(
          '[healthCheck] 이전 시작 실패 감지 → backup/ 으로 롤백 완료. '
          + `손상된 빌드는 ${corrupt} 에 보존됨.`,
        );
        rolledBack = true;
      } catch (err) {
        console.error('[healthCheck] 롤백 실패:', err);
      }
    } else {
      console.warn('[healthCheck] 이전 시작 실패 감지했으나 backup 없음 — 롤백 불가');
    }
  }

  // 새 마커 작성 — markStartSucceeded()가 메인 창 로드 시 삭제.
  // 마커 못 쓰면 자가 검증 비활성 — 그냥 진행.
  try {
    await fsp.mkdir(localRoot(), { recursive: true });
    await fsp.writeFile(ATTEMPT_MARKER, new Date().toISOString(), 'utf-8');
  } catch (err) {
    console.warn('[healthCheck] 마커 쓰기 실패:', err);
  }

  return { rolledBack };
}

/** 메인 창 did-finish-load 시 호출 — 정상 시작 표시. */
export async function markStartSucceeded(): Promise<void> {
  try {
    if (existsSync(ATTEMPT_MARKER)) await fsp.unlink(ATTEMPT_MARKER);
  } catch (err) {
    console.warn('[healthCheck] 마커 삭제 실패:', err);
  }
}
