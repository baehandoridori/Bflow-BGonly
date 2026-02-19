import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 모드
  getMode: () => ipcRenderer.invoke('settings:get-mode'),
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

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
});
