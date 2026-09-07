import type { ElectronAPI, UpdateInfo } from '@/types';

type PreviewUpdaterApi = Required<Pick<ElectronAPI,
  'getUpdateState' | 'checkForUpdates' | 'retryUpdate' | 'onUpdateState' | 'onUpdateReady' | 'applyUpdateNow'
>>;

/** Browser-only update rehearsal. No filesystem, installer, network, or login access. */
export function createDevPreviewUpdater(currentVersion: string): PreviewUpdaterApi {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(currentVersion);
  const virtualVersion = version
    ? `${version[1]}.${version[2]}.${Number(version[3]) + 1}-preview`
    : `${currentVersion}-preview`;
  const stateListeners = new Set<Parameters<PreviewUpdaterApi['onUpdateState']>[0]>();
  const readyListeners = new Set<Parameters<PreviewUpdaterApi['onUpdateReady']>[0]>();
  let state: UpdateInfo = {
    status: 'up-to-date', currentVersion, latestVersion: currentVersion,
    buildAt: '', ready: false, preview: true,
    message: '프리뷰 전용입니다. 새로고침을 누르면 가상 업데이트를 준비합니다. 실제 앱을 설치하거나 종료하지 않습니다.',
    releaseNotes: [{
      version: virtualVersion,
      title: '[프리뷰 전용] 가상 업데이트',
      items: ['업데이트 준비와 적용 화면을 확인하는 모의 동작입니다. 실제 배포 파일, 현재 앱 버전과 사용자 데이터는 바뀌지 않습니다.'],
    }],
  };
  let pendingCheck: Promise<UpdateInfo> | null = null;
  const snapshot = () => structuredClone(state);
  const emit = (patch: Partial<UpdateInfo>) => {
    state = { ...state, ...patch };
    for (const listener of stateListeners) listener(snapshot());
  };
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 200));

  const checkForUpdates = (): Promise<UpdateInfo> => {
    if (state.status === 'applying') return Promise.resolve(snapshot());
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      emit({ status: 'downloading', latestVersion: virtualVersion, ready: false, message: '프리뷰 전용 가상 업데이트를 준비하고 있습니다. 파일은 다운로드하지 않습니다.' });
      await pause();
      emit({ status: 'ready', ready: true, message: '프리뷰 전용 가상 버전이 준비되었습니다. 모의 업데이트로 적용 화면을 확인하며, 실제 설치나 앱 종료는 하지 않습니다.' });
      for (const listener of readyListeners) listener(virtualVersion, snapshot());
      return snapshot();
    })().finally(() => { pendingCheck = null; });
    return pendingCheck;
  };

  return {
    getUpdateState: async () => snapshot(),
    checkForUpdates,
    retryUpdate: checkForUpdates,
    onUpdateState(callback) {
      stateListeners.add(callback);
      return () => { stateListeners.delete(callback); };
    },
    onUpdateReady(callback) {
      readyListeners.add(callback);
      return () => { readyListeners.delete(callback); };
    },
    async applyUpdateNow() {
      if (!state.ready || state.status !== 'ready') return;
      emit({ status: 'applying', ready: false, message: '프리뷰 전용 모의 업데이트를 적용하고 있습니다. 실제 앱은 종료되지 않습니다.' });
      await pause();
      emit({ status: 'up-to-date', latestVersion: currentVersion, message: '프리뷰 적용 완료. 실제 앱 버전은 그대로이며 파일 설치나 사용자 데이터 변경은 없었습니다. 새로고침으로 다시 확인할 수 있습니다.' });
    },
  };
}
