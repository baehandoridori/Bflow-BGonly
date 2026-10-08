/** scripts/vacation-token.cjs 의 타입 — vite.config.ts 가 가져다 쓴다 */
export interface ResolvedVacationToken {
  /** 찾은 토큰. 못 찾았거나 읽을 수 없으면 '' */
  token: string;
  source: 'env' | 'root' | 'main-checkout' | 'none';
  /** 토큰(또는 읽을 수 없는 줄)이 있던 .env 파일 경로. 환경변수에서 왔거나 못 찾았으면 null */
  file: string | null;
  /** 값이 적혀 있지만 읽을 수 없는 꼴일 때의 이유(값은 들어 있지 않다). 그 밖에는 null */
  problem: string | null;
}

export interface VacationTokenLookup {
  /** 빌드 폴더(레포 루트 또는 워크트리 루트) */
  root: string;
  env?: Record<string, string | undefined>;
  /** vite mode — `.env.<mode>` 파일을 고르는 데 쓴다. 기본 'production' */
  mode?: string;
}

export const TOKEN_KEY: 'BFLOW_VACATION_TOKEN';
/** 키가 없으면 null. 값이 받지 않는 꼴(변수 확장·이스케이프·여러 줄 등)이면 예외를 던진다 */
export function parseEnvValue(text: string, key: string): string | null;
export function findMainCheckoutRoot(root: string): string | null;
export function resolveVacationToken(lookup: VacationTokenLookup): ResolvedVacationToken;
export function describeVacationTokenSource(resolved: ResolvedVacationToken): string;
export function vacationTokenProblemMessage(resolved: ResolvedVacationToken, root: string): string;
export function checkReleaseVacationToken(
  options: VacationTokenLookup & { distDir: string },
): { ok: boolean; message: string };
