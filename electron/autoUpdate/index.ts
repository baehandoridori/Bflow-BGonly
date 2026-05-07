/**
 * v1.21.0 자동 업데이트 — main.ts가 import하는 단일 진입점.
 * 다른 모듈은 main.ts가 직접 import하지 않음 — index만 import.
 */
export { runFirstInstallIfNeeded } from './installer';
export type { InstallResult } from './installer';
export { scheduleUpdateCheck } from './checker';
export { swapIfPending, hasPending } from './swapper';
export type { SwapResult } from './swapper';
export { spawnSwapHelper } from './helperSwap';
export type { SwapHelperOptions } from './helperSwap';
export { checkLastStartAndRollback, markStartSucceeded } from './healthCheck';
export type { HealthResult } from './healthCheck';
