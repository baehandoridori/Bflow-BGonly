/**
 * 단순 semver 비교 — major.minor.patch 정수 비교. pre-release/build metadata 무시.
 * v1.27.0: 업데이트 완료 토스트 (`lastSeenVersion` vs `__APP_VERSION__`) 에서만 사용.
 * 본격적 semver 라이브러리는 필요할 때 도입.
 */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
