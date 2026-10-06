/** scripts/vacation-token.cjs 의 타입 — vite.config.ts 가 가져다 쓴다 */
export interface ResolvedVacationToken {
  /** 찾은 토큰. 못 찾았으면 '' */
  token: string;
  source: 'env' | 'root' | 'main-checkout' | 'none';
  /** 토큰을 읽은 .env 파일 경로. 환경변수에서 왔거나 못 찾았으면 null */
  file: string | null;
}

export interface VacationTokenLookup {
  /** 빌드 폴더(레포 루트 또는 워크트리 루트) */
  root: string;
  env?: Record<string, string | undefined>;
  /** vite mode — `.env.<mode>` 파일을 고르는 데 쓴다. 기본 'production' */
  mode?: string;
}

export const TOKEN_KEY: 'BFLOW_VACATION_TOKEN';
export function parseEnvValue(text: string, key: string): string | null;
export function findMainCheckoutRoot(root: string): string | null;
export function resolveVacationToken(lookup: VacationTokenLookup): ResolvedVacationToken;
export function describeVacationTokenSource(resolved: ResolvedVacationToken): string;
export function missingVacationTokenMessage(root: string): string;
export function checkReleaseVacationToken(
  options: VacationTokenLookup & { distDir: string },
): { ok: boolean; message: string };
