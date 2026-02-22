import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 모드
  getMode: () => ipcRenderer.invoke('settings:get-mode'),
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

  // 사용자 파일 (base64 인코딩 JSON — exe 옆 또는 test-data/)
  usersRead: () => ipcRenderer.invoke('users:read'),
  usersWrite: (data: unknown) => ipcRenderer.invoke('users:write', data),

  // 개인 설정 (AppData)
  readSettings: (fileName: string) => ipcRenderer.invoke('settings:read', fileName),
  writeSettings: (fileName: string, data: unknown) =>
    ipcRenderer.invoke('settings:write', fileName, data),

  // 테스트 모드 로컬 시트 데이터
  testGetSheetPath: () => ipcRenderer.invoke('test:get-sheet-path'),
  testReadSheet: (filePath: string) => ipcRenderer.invoke('test:read-sheet', filePath),
  testWriteSheet: (filePath: string, data: unknown) =>
    ipcRenderer.invoke('test:write-sheet', filePath, data),

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

  // 위젯 팝업 윈도우
  widgetOpenPopup: (widgetId: string, title: string) =>
    ipcRenderer.invoke('widget:open-popup', widgetId, title),
  widgetSetOpacity: (widgetId: string, opacity: number) =>
    ipcRenderer.invoke('widget:set-opacity', widgetId, opacity),
  widgetClosePopup: (widgetId: string) =>
    ipcRenderer.invoke('widget:close-popup', widgetId),
});
