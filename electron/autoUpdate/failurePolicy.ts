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
