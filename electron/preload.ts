import { contextBridge, ipcRenderer } from 'electron';

// 렌더러에 노출할 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 모드
  getMode: () => ipcRenderer.invoke('settings:get-mode'),
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

  // 개인 설정 (AppData)
  readSettings: (fileName: string) => ipcRenderer.invoke('settings:read', fileName),
  writeSettings: (fileName: string, data: unknown) =>
    ipcRenderer.invoke('settings:write', fileName, data),

  // 테스트 모드 로컬 시트 데이터
  testReadSheet: (filePath: string) => ipcRenderer.invoke('test:read-sheet', filePath),
  testWriteSheet: (filePath: string, data: unknown) =>
    ipcRenderer.invoke('test:write-sheet', filePath, data),
});
