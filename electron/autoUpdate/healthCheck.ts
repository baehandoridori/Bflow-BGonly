/**
 * v1.21.0 자가 검증 — 앱 시작 실패 시 backup/ 자동 롤백.
 *
 * 메커니즘 (Codex 6차 P1 수정 후):
 *   1. swap 직후 swapper가 .pending-verification 마커 작성 = "다음 실행은 검증 대상"
 *   2. 시작 시 .pending-verification 있으면 → 검증 모드 → .start-attempt 작성
 *   3. 메인 창 did-finish-load 도달 → 두 마커 모두 삭제
 *   4. 다음 시작 시 .pending-verification + .start-attempt 둘 다 잔존 → 이전 시작 실패 →
 *      backup → app 롤백 + .corrupt-<ts>로 손상 빌드 보존
 *
 * 주된 변화: 일반 강제 종료·시스템 kill·재부팅 등은 .pending-verification 없으니 검증
 * 비활성 → 의도치 않은 다운그레이드 방지.
 *
 * spec §6 "swap 실패 / 새 버전 깨짐" 처리.
 */
import { promises as fsp, existsSync, renameSync } from 'fs';
import path from 'path';
import {
  localAppDir, localBackupDir, localRoot, localPendingVerificationMarker,
} from './paths';

const ATTEMPT_MARKER = path.join(localRoot(), '.start-attempt');

export interface HealthResult {
  /** 이전 시작 실패 감지 → backup → app 롤백 했는지 */
  rolledBack: boolean;
}

/**
 * app.whenReady 직후 — 마커 검사 + (필요 시) 롤백 + 새 마커 작성.
 * 호출자: runFirstInstallIfNeeded 다음, 메인 창 생성 전.
 */
export async function checkLastStartAndRollback(): Promise<HealthResult> {
  const verificationMarker = localPendingVerificationMarker();
  const inVerificationMode = existsSync(verificationMarker);

  // Codex 6차 P1: 일반 실행은 검증 비활성 — 강제 종료/시스템 kill로 인한 의도치 않은
  // rollback 차단. swap 직후 첫 실행에만 (= .pending-verification 있을 때만) 검증.
  if (!inVerificationMode) {
    return { rolledBack: false };
  }

  const previousAttemptFailed = existsSync(ATTEMPT_MARKER);
  let rolledBack = false;

  if (previousAttemptFailed) {
    const app_ = localAppDir();
    const backup_ = localBackupDir();
    if (existsSync(backup_)) {
      try {
        // app/ → .corrupt-<ts>/ 로 보존 (진단용)
        const corrupt = path.join(localRoot(), '.corrupt-' + Date.now());
        if (existsSync(app_)) renameSync(app_, corrupt);
        renameSync(backup_, app_);
        await fsp.unlink(ATTEMPT_MARKER).catch(() => { /* noop */ });
        await fsp.unlink(verificationMarker).catch(() => { /* noop */ });
        console.warn(
          '[healthCheck] swap 직후 첫 실행 실패 감지 → backup/ 으로 롤백 완료. '
          + `손상된 빌드는 ${corrupt} 에 보존됨.`,
        );
        rolledBack = true;
        // 롤백된 backup은 이미 정상 검증된 빌드 → 새 .start-attempt 작성 X (정상 시작 가정)
        return { rolledBack };
      } catch (err) {
        console.error('[healthCheck] 롤백 실패:', err);
      }
    } else {
      console.warn('[healthCheck] swap 직후 첫 실행 실패 감지했으나 backup 없음 — 롤백 불가');
    }
  }

  // 검증 모드 + 이전 실패 없음 → 새 .start-attempt 작성. did-finish-load 시 삭제됨.
  try {
    await fsp.mkdir(localRoot(), { recursive: true });
    await fsp.writeFile(ATTEMPT_MARKER, new Date().toISOString(), 'utf-8');
  } catch (err) {
    console.warn('[healthCheck] .start-attempt 마커 쓰기 실패:', err);
  }

  return { rolledBack };
}

/**
 * 메인 창 did-finish-load 시 호출 — 정상 시작 표시.
 * .start-attempt + .pending-verification 모두 삭제 (검증 통과 표시).
 */
export async function markStartSucceeded(): Promise<void> {
  try {
    if (existsSync(ATTEMPT_MARKER)) await fsp.unlink(ATTEMPT_MARKER);
  } catch (err) {
    console.warn('[healthCheck] .start-attempt 삭제 실패:', err);
  }
  try {
    const v = localPendingVerificationMarker();
    if (existsSync(v)) await fsp.unlink(v);
  } catch (err) {
    console.warn('[healthCheck] .pending-verification 삭제 실패:', err);
  }
}
