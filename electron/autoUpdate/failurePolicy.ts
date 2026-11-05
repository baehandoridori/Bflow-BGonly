/**
 * Swap failure markers can survive a manual installer repair. If the leftover
 * pending payload is not newer than the currently installed app, it is stale
 * cleanup state, not a failure of the current version.
 */
export function isStaleSwapFailureForCurrentVersion(
  currentVersion: string,
  pendingVersion: string | null,
): boolean {
  return pendingVersion !== null && compareSimpleSemver(pendingVersion, currentVersion) <= 0;
}

/**
 * v1.149.1 — 자동 재시도 중단 표시(`.swap-suppressed`)에 '실패한 새 버전'도 함께 적는다.
 *
 * 첫 줄은 실패 당시 설치돼 있던 앱 버전(예전 형식과 같다), 둘째 줄은 `target=<실패한 새 버전>`.
 * 멈춤은 '같은 새 버전을 다시 설치하다 또 실패하는' 반복만 막으면 된다. 배포 쪽이 그보다 더 새 버전을
 * 내놓으면 한 번 더 시도한다 — 예전에는 표시가 남은 PC 가 옛 버전에 계속 머물렀다(v1.126.1 PC 사례).
 * 둘째 줄이 없는 예전 형식은 어떤 새 버전이 실패했는지 모르므로 예전처럼 같은 앱 버전 동안 계속 멈춘다.
 */
export interface SuppressionMarker {
  /** 실패 당시 설치돼 있던 앱 버전. */
  ownVersion: string;
  /** 설치에 실패한 새 버전. 예전 형식이거나 읽을 수 없으면 null. */
  failedTarget: string | null;
}

/** 'clear' = 다른 앱 버전의 표시라 지운다, 'suppress' = 계속 멈춘다, 'retry-newer-target' = 더 새 버전이라 한 번 더 시도. */
export type SuppressionDecision = 'clear' | 'suppress' | 'retry-newer-target';

const SUPPRESSION_TARGET_PREFIX = 'target=';
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/** 표시에 적을 만한 버전 문자열인가(`1.149.1` 꼴만). 설치 도우미 스크립트에도 들어가므로 좁게 받는다. */
export function isPlainVersion(value: unknown): value is string {
  return typeof value === 'string' && PLAIN_VERSION.test(value);
}

export function formatSuppressionMarker(ownVersion: string, failedTarget: string | null | undefined): string {
  const target = typeof failedTarget === 'string' ? failedTarget.trim() : '';
  return isPlainVersion(target) ? `${ownVersion}\n${SUPPRESSION_TARGET_PREFIX}${target}` : ownVersion;
}

export function parseSuppressionMarker(content: string): SuppressionMarker {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let failedTarget: string | null = null;
  for (const line of lines.slice(1)) {
    if (!line.startsWith(SUPPRESSION_TARGET_PREFIX)) continue;
    const value = line.slice(SUPPRESSION_TARGET_PREFIX.length).trim();
    if (isPlainVersion(value)) failedTarget = value;
  }
  return { ownVersion: lines[0] ?? '', failedTarget };
}

/**
 * @param offeredVersion 지금 받을 수 있는 새 버전(배포 쪽 manifest 또는 받아 둔 설치 파일). 모르면 null.
 */
export function decideSuppression(
  marker: SuppressionMarker,
  currentVersion: string,
  offeredVersion: string | null,
): SuppressionDecision {
  if (marker.ownVersion !== currentVersion) return 'clear';
  if (!marker.failedTarget || !offeredVersion) return 'suppress';
  return compareSimpleSemver(offeredVersion, marker.failedTarget) > 0 ? 'retry-newer-target' : 'suppress';
}

function compareSimpleSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
