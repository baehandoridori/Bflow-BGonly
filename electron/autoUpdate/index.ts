/**
 * 자동 업데이트 모듈 진입점.
 *
 * 현재 적용 경로는 BFLOW-Setup.exe를 로컬 installer-pending에 준비한 뒤
 * installerApply.ts helper가 앱 종료 후 실행하는 방식이다. helperSwap/swapper export는
 * v1.21~v1.22.13 레거시 복구/호환 코드용으로 남아있다.
 */
export { runFirstInstallIfNeeded } from './installer';
export type { InstallResult } from './installer';
export { scheduleUpdateCheck, prepareUpdate, readPendingUpdateInfo } from './checker';
export type { UpdateInfo, UpdateStatus } from './checker';
export { hasPendingInstallerUpdate, spawnInstallerUpdateHelper } from './installerApply';
export type { InstallerUpdateHelperOptions } from './installerApply';
export { swapIfPending, hasPending } from './swapper';
export type { SwapResult } from './swapper';
export { spawnSwapHelper } from './helperSwap';
export type { SwapHelperOptions } from './helperSwap';
export { checkLastStartAndRollback, markStartSucceeded } from './healthCheck';
export type { HealthResult } from './healthCheck';
