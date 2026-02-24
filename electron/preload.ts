import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 설정
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

  // 사용자 파일 (base64 인코딩 JSON — exe 옆 또는 test-data/)
  usersRead: () => ipcRenderer.invoke('users:read'),
  usersWrite: (data: unknown) => ipcRenderer.invoke('users:write', data),

  // 개인 설정 (AppData)
  readSettings: (fileName: string) => ipcRenderer.invoke('settings:read', fileName),
  writeSettings: (fileName: string, data: unknown) =>
    ipcRenderer.invoke('settings:write', fileName, data),

  // 실시간 동기화: 다른 사용자가 시트 파일을 변경했을 때 알림
  onSheetChanged: (callback: () => void) => {
    ipcRenderer.on('sheet:changed', callback);
    // cleanup 함수 반환
    return () => ipcRenderer.removeListener('sheet:changed', callback);
  },

  // 이미지 파일 저장/삭제 (하이브리드 이미지 스토리지)
  imageSave: (fileName: string, base64Data: string) =>
    ipcRenderer.invoke('image:save', fileName, base64Data) as Promise<string>,
  imageDelete: (fileName: string) =>
    ipcRenderer.invoke('image:delete', fileName) as Promise<boolean>,
  imageGetDir: () => ipcRenderer.invoke('image:get-dir') as Promise<string>,
  clipboardReadImage: () =>
    ipcRenderer.invoke('clipboard:read-image') as Promise<string | null>,

  // Google Sheets 연동 (Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) =>
    ipcRenderer.invoke('sheets:connect', webAppUrl),
  sheetsIsConnected: () => ipcRenderer.invoke('sheets:is-connected'),
  sheetsReadAll: () => ipcRenderer.invoke('sheets:read-all'),
  sheetsUpdateCell: (
    sheetName: string,
    rowIndex: number,
    stage: string,
    value: boolean
  ) =>
    ipcRenderer.invoke('sheets:update-cell', sheetName, rowIndex, stage, value),
  sheetsAddEpisode: (episodeNumber: number, department?: string) =>
    ipcRenderer.invoke('sheets:add-episode', episodeNumber, department),
  sheetsAddPart: (episodeNumber: number, partId: string, department?: string) =>
    ipcRenderer.invoke('sheets:add-part', episodeNumber, partId, department),
  sheetsAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) =>
    ipcRenderer.invoke('sheets:add-scene', sheetName, sceneId, assignee, memo),
  sheetsDeleteScene: (sheetName: string, rowIndex: number) =>
    ipcRenderer.invoke('sheets:delete-scene', sheetName, rowIndex),
  sheetsUpdateSceneField: (sheetName: string, rowIndex: number, field: string, value: string) =>
    ipcRenderer.invoke('sheets:update-scene-field', sheetName, rowIndex, field, value),
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) =>
    ipcRenderer.invoke('sheets:upload-image', sheetName, sceneId, imageType, base64Data),

  // METADATA 시트 관련
  sheetsReadMetadata: (type: string, key: string) =>
    ipcRenderer.invoke('sheets:read-metadata', type, key),
  sheetsWriteMetadata: (type: string, key: string, value: string) =>
    ipcRenderer.invoke('sheets:write-metadata', type, key, value),
  sheetsSoftDeletePart: (sheetName: string) =>
    ipcRenderer.invoke('sheets:soft-delete-part', sheetName),
  sheetsSoftDeleteEpisode: (episodeNumber: number) =>
    ipcRenderer.invoke('sheets:soft-delete-episode', episodeNumber),

  // 아카이빙
  sheetsReadArchived: () =>
    ipcRenderer.invoke('sheets:read-archived'),
  sheetsArchiveEpisode: (episodeNumber: number) =>
    ipcRenderer.invoke('sheets:archive-episode', episodeNumber),
  sheetsUnarchiveEpisode: (episodeNumber: number) =>
    ipcRenderer.invoke('sheets:unarchive-episode', episodeNumber),

  // 배치 요청 (Phase 0: 여러 작업을 한 번에)
  sheetsBatch: (actions: { action: string; params: Record<string, string> }[]) =>
    ipcRenderer.invoke('sheets:batch', actions),

  // 대량 씬 추가 (Phase 0-5)
  sheetsAddScenes: (sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) =>
    ipcRenderer.invoke('sheets:add-scenes', sheetName, scenes),

  // _USERS (Phase 0-4: 사용자 동기화)
  sheetsReadUsers: () =>
    ipcRenderer.invoke('sheets:read-users'),
  sheetsAddUser: (user: unknown) =>
    ipcRenderer.invoke('sheets:add-user', user),
  sheetsUpdateUser: (userId: string, updates: Record<string, string>) =>
    ipcRenderer.invoke('sheets:update-user', userId, updates),
  sheetsDeleteUser: (userId: string) =>
    ipcRenderer.invoke('sheets:delete-user', userId),

  // _COMMENTS (Phase 0-3: 댓글 동기화)
  sheetsReadComments: (sheetName: string) =>
    ipcRenderer.invoke('sheets:read-comments', sheetName),
  sheetsAddComment: (commentId: string, sheetName: string, sceneId: string,
    userId: string, userName: string, text: string, mentions: string[], createdAt: string) =>
    ipcRenderer.invoke('sheets:add-comment', commentId, sheetName, sceneId, userId, userName, text, mentions, createdAt),
  sheetsEditComment: (commentId: string, text: string, mentions: string[]) =>
    ipcRenderer.invoke('sheets:edit-comment', commentId, text, mentions),
  sheetsDeleteComment: (commentId: string) =>
    ipcRenderer.invoke('sheets:delete-comment', commentId),

  // _REGISTRY (Phase 0-2: 에피소드/파트 중앙 관리)
  sheetsReadRegistry: () =>
    ipcRenderer.invoke('sheets:read-registry'),
  sheetsArchiveEpisodeViaRegistry: (episodeNumber: number, archivedBy: string, archiveMemo: string) =>
    ipcRenderer.invoke('sheets:archive-episode-via-registry', episodeNumber, archivedBy, archiveMemo),
  sheetsUnarchiveEpisodeViaRegistry: (episodeNumber: number) =>
    ipcRenderer.invoke('sheets:unarchive-episode-via-registry', episodeNumber),

  // 데이터 변경 알림 (다른 윈도우에 sheet:changed 브로드캐스트)
  sheetsNotifyChange: () => ipcRenderer.invoke('sheets:notify-change'),

  // 위젯 팝업 윈도우
  widgetOpenPopup: (widgetId: string, title: string) =>
    ipcRenderer.invoke('widget:open-popup', widgetId, title),
  widgetSetOpacity: (widgetId: string, opacity: number) =>
    ipcRenderer.invoke('widget:set-opacity', widgetId, opacity),
  widgetClosePopup: (widgetId: string) =>
    ipcRenderer.invoke('widget:close-popup', widgetId),
  widgetResize: (widgetId: string, width: number, height: number) =>
    ipcRenderer.invoke('widget:resize', widgetId, width, height),
  widgetGetSize: (widgetId: string) =>
    ipcRenderer.invoke('widget:get-size', widgetId) as Promise<{ width: number; height: number } | null>,
  widgetCaptureBehind: (widgetId: string) =>
    ipcRenderer.invoke('widget:capture-behind', widgetId) as Promise<string | null>,
  onWidgetFocusChange: (callback: (focused: boolean) => void) => {
    const handler = (_event: unknown, focused: boolean) => callback(focused);
    ipcRenderer.on('widget:focus-change', handler);
    return () => { ipcRenderer.removeListener('widget:focus-change', handler); };
  },

  // 위젯 AOT 토글
  widgetSetAlwaysOnTop: (widgetId: string, aot: boolean) =>
    ipcRenderer.invoke('widget:set-aot', widgetId, aot),

  // 위젯 독 모드 (최소화 → 플로팅 아이콘)
  widgetMinimizeToDock: (widgetId: string) =>
    ipcRenderer.invoke('widget:minimize-to-dock', widgetId),
  widgetRestoreFromDock: (widgetId: string) =>
    ipcRenderer.invoke('widget:restore-from-dock', widgetId),
  widgetDockExpand: (widgetId: string) =>
    ipcRenderer.invoke('widget:dock-expand', widgetId),
  widgetDockCollapse: (widgetId: string) =>
    ipcRenderer.invoke('widget:dock-collapse', widgetId),
  onWidgetDockChange: (callback: (isDocked: boolean) => void) => {
    const handler = (_event: unknown, isDocked: boolean) => callback(isDocked);
    ipcRenderer.on('widget:dock-change', handler);
    return () => { ipcRenderer.removeListener('widget:dock-change', handler); };
  },
});
