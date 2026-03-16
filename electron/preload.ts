import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 설정
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

  // 파일탐색기에서 경로 열기
  shellShowItem: (filePath: string) =>
    ipcRenderer.invoke('shell:show-item', filePath) as Promise<{ ok: boolean; error?: string }>,

  // 사용자 파일 (base64 인코딩 JSON — exe 옆 또는 test-data/)
  usersRead: () => ipcRenderer.invoke('users:read'),
  usersWrite: (data: unknown) => ipcRenderer.invoke('users:write', data),

  // 개인 설정 (AppData)
  readSettings: (fileName: string) => ipcRenderer.invoke('settings:read', fileName),
  writeSettings: (fileName: string, data: unknown) =>
    ipcRenderer.invoke('settings:write', fileName, data),

  // 실시간 동기화: 다른 창이 데이터를 변경했을 때 델타 알림
  onDataChanged: (callback: (delta?: unknown) => void) => {
    const handler = (_event: unknown, delta?: unknown) => callback(delta);
    ipcRenderer.on('data:changed', handler);
    return () => ipcRenderer.removeListener('data:changed', handler);
  },
  // 호환성 alias (레거시)
  onSheetChanged: (callback: (delta?: unknown) => void) => {
    const handler = (_event: unknown, delta?: unknown) => callback(delta);
    ipcRenderer.on('data:changed', handler);
    return () => ipcRenderer.removeListener('data:changed', handler);
  },

  // 재시도 알림: 동기화 재시도 시 토스트 표시용
  onRetryNotify: (callback: (message: string) => void) => {
    const handler = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on('sheets:retry-notify', handler);
    return () => { ipcRenderer.removeListener('sheets:retry-notify', handler); };
  },

  // 종료 대기 알림: 미완료 작업 저장 중 표시용
  onSavingBeforeQuit: (callback: (pendingCount: number) => void) => {
    const handler = (_event: unknown, count: number) => callback(count);
    ipcRenderer.on('app:saving-before-quit', handler);
    return () => { ipcRenderer.removeListener('app:saving-before-quit', handler); };
  },

  // 네이티브 알림 (OS 데스크톱 알림)
  showNativeNotification: (title: string, body: string) =>
    ipcRenderer.invoke('notification:show-native', title, body),

  // 이미지 파일 저장/삭제 (하이브리드 이미지 스토리지)
  imageSave: (fileName: string, base64Data: string) =>
    ipcRenderer.invoke('image:save', fileName, base64Data) as Promise<string>,
  imageDelete: (fileName: string) =>
    ipcRenderer.invoke('image:delete', fileName) as Promise<boolean>,
  imageGetDir: () => ipcRenderer.invoke('image:get-dir') as Promise<string>,
  clipboardReadImage: () =>
    ipcRenderer.invoke('clipboard:read-image') as Promise<string | null>,

  // ─── Supabase ──────────────────────────────────
  supabaseTestConnection: () =>
    ipcRenderer.invoke('supabase:test-connection') as Promise<{ ok: boolean; error?: string }>,
  supabaseReadAll: () =>
    ipcRenderer.invoke('supabase:read-all'),
  supabaseAddEpisode: (episodeNumber: number, department?: string) =>
    ipcRenderer.invoke('supabase:add-episode', episodeNumber, department),
  supabaseSoftDeleteEpisode: (episodeNumber: number) =>
    ipcRenderer.invoke('supabase:soft-delete-episode', episodeNumber),
  supabaseArchiveEpisode: (episodeNumber: number, archivedBy: string, archiveMemo: string) =>
    ipcRenderer.invoke('supabase:archive-episode', episodeNumber, archivedBy, archiveMemo),
  supabaseUnarchiveEpisode: (episodeNumber: number) =>
    ipcRenderer.invoke('supabase:unarchive-episode', episodeNumber),
  supabaseReadArchived: () =>
    ipcRenderer.invoke('supabase:read-archived'),
  supabaseAddPart: (episodeNumber: number, partId: string, department?: string) =>
    ipcRenderer.invoke('supabase:add-part', episodeNumber, partId, department),
  supabaseSoftDeletePart: (sheetName: string) =>
    ipcRenderer.invoke('supabase:soft-delete-part', sheetName),
  supabaseAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) =>
    ipcRenderer.invoke('supabase:add-scene', sheetName, sceneId, assignee, memo),
  supabaseAddScenes: (sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) =>
    ipcRenderer.invoke('supabase:add-scenes', sheetName, scenes),
  supabaseDeleteScene: (sceneUuid: string) =>
    ipcRenderer.invoke('supabase:delete-scene', sceneUuid),
  supabaseUpdateSceneStage: (sceneUuid: string, stage: string, value: boolean, updatedBy?: string) =>
    ipcRenderer.invoke('supabase:update-scene-stage', sceneUuid, stage, value, updatedBy),
  supabaseBulkUpdateSceneStages: (updates: { sceneUuid: string; stage: string; value: boolean }[], updatedBy?: string) =>
    ipcRenderer.invoke('supabase:bulk-update-scene-stages', updates, updatedBy),
  supabaseUpdateSceneField: (sceneUuid: string, field: string, value: string, senderId?: string) =>
    ipcRenderer.invoke('supabase:update-scene-field', sceneUuid, field, value, senderId),
  supabaseReadUsers: () =>
    ipcRenderer.invoke('supabase:read-users'),
  supabaseAddUser: (user: unknown) =>
    ipcRenderer.invoke('supabase:add-user', user),
  supabaseUpdateUser: (userId: string, updates: Record<string, string>) =>
    ipcRenderer.invoke('supabase:update-user', userId, updates),
  supabaseDeleteUser: (userId: string) =>
    ipcRenderer.invoke('supabase:delete-user', userId),
  supabaseReadComments: (partUuid: string) =>
    ipcRenderer.invoke('supabase:read-comments', partUuid),
  supabaseAddComment: (commentId: string, partUuid: string, sceneId: string,
    userId: string, userName: string, text: string, mentions: string[], createdAt: string) =>
    ipcRenderer.invoke('supabase:add-comment', commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt),
  supabaseEditComment: (commentId: string, text: string, mentions: string[]) =>
    ipcRenderer.invoke('supabase:edit-comment', commentId, text, mentions),
  supabaseDeleteComment: (commentId: string) =>
    ipcRenderer.invoke('supabase:delete-comment', commentId),
  supabaseReadRevisions: () =>
    ipcRenderer.invoke('supabase:read-revisions'),
  supabaseAddRevision: (
    id: string, partUuid: string, sceneId: string, revisionNo: number, status: string,
    priority: string, description: string, frameNo: string, imageUrl: string,
    department: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
  ) =>
    ipcRenderer.invoke('supabase:add-revision', id, partUuid, sceneId, revisionNo, status,
      priority, description, frameNo, imageUrl, department, requesterId, requesterName, assignee, createdAt),
  supabaseUpdateRevision: (id: string, updates: Record<string, string>) =>
    ipcRenderer.invoke('supabase:update-revision', id, updates),
  supabaseReadAllMetadata: () =>
    ipcRenderer.invoke('supabase:read-all-metadata'),
  supabaseReadMetadata: (type: string, key: string) =>
    ipcRenderer.invoke('supabase:read-metadata', type, key),
  supabaseWriteMetadata: (type: string, key: string, value: string) =>
    ipcRenderer.invoke('supabase:write-metadata', type, key, value),
  // 슬랙 웹훅
  sendSlackWebhook: (payload: Record<string, string>) =>
    ipcRenderer.invoke('slack:send-webhook', payload),

  // Realtime 이벤트 수신 (메인 프로세스 → 렌더러)
  onSupabaseRealtime: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('supabase:realtime-event', handler);
    return () => ipcRenderer.removeListener('supabase:realtime-event', handler);
  },
  onSupabaseStatus: (callback: (status: string) => void) => {
    const handler = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on('supabase:status', handler);
    return () => ipcRenderer.removeListener('supabase:status', handler);
  },
  // Broadcast 이벤트 수신 (즉시 동기화용)
  onSupabaseBroadcast: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('supabase:broadcast-event', handler);
    return () => ipcRenderer.removeListener('supabase:broadcast-event', handler);
  },

  // GAS 연결 (이미지 업로드용 Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) =>
    ipcRenderer.invoke('sheets:connect', webAppUrl),
  sheetsIsConnected: () => ipcRenderer.invoke('sheets:is-connected'),

  // 이미지 업로드 (GAS → Google Drive)
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) =>
    ipcRenderer.invoke('sheets:upload-image', sheetName, sceneId, imageType, base64Data),

  // Sheets fallback (Supabase 장애 시)
  sheetsReadComments: (sheetName: string) =>
    ipcRenderer.invoke('sheets:read-comments', sheetName),
  sheetsReadRevisions: () =>
    ipcRenderer.invoke('sheets:read-revisions'),
  sheetsReadAllMetadata: () =>
    ipcRenderer.invoke('sheets:read-all-metadata'),

  // 데이터 변경 알림 (다른 윈도우에 data:changed 브로드캐스트)
  dataNotifyChange: (delta?: unknown) => ipcRenderer.invoke('data:notify-change', delta),
  // 호환성 alias (레거시)
  sheetsNotifyChange: (delta?: unknown) => ipcRenderer.invoke('data:notify-change', delta),

  // 스냅샷 릴레이 (같은 PC 내 다른 창에 전체 데이터 전달)
  onSnapshotRelay: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('sheet:snapshot-relay', handler);
    return () => ipcRenderer.removeListener('sheet:snapshot-relay', handler);
  },
  sheetsRelaySnapshot: (data: unknown) =>
    ipcRenderer.invoke('sheets:relay-snapshot', data),

  // 휴가 관리 (vacation-repo WebApi)
  vacationConnect: (webAppUrl: string) =>
    ipcRenderer.invoke('vacation:connect', webAppUrl),
  vacationIsConnected: () =>
    ipcRenderer.invoke('vacation:is-connected'),
  vacationReadStatus: (name: string) =>
    ipcRenderer.invoke('vacation:read-status', name),
  vacationReadLog: (name: string, year?: number, limit?: number) =>
    ipcRenderer.invoke('vacation:read-log', name, year, limit),
  vacationReadAllEvents: (year?: number) =>
    ipcRenderer.invoke('vacation:read-all-events', year),
  vacationRegister: (name: string, type: string, startDate: string, endDate: string, reason: string) =>
    ipcRenderer.invoke('vacation:register', name, type, startDate, endDate, reason),
  vacationCancel: (name: string, rowIndex: number) =>
    ipcRenderer.invoke('vacation:cancel', name, rowIndex),
  vacationGrantDahyu: (targets: string[], reason: string, grantDate: string) =>
    ipcRenderer.invoke('vacation:grant-dahyu', targets, reason, grantDate),
  vacationReadAllNames: () =>
    ipcRenderer.invoke('vacation:read-all-names'),
  vacationReadDahyuList: () =>
    ipcRenderer.invoke('vacation:read-dahyu-list'),
  vacationDeleteDahyu: (rowIndices: number[]) =>
    ipcRenderer.invoke('vacation:delete-dahyu', rowIndices),

  // 화이트보드 (공유 드라이브 파일)
  whiteboardReadShared: () =>
    ipcRenderer.invoke('whiteboard:read-shared') as Promise<{ ok: boolean; data: unknown; error?: string }>,
  whiteboardWriteShared: (data: unknown) =>
    ipcRenderer.invoke('whiteboard:write-shared', data) as Promise<{ ok: boolean; error?: string }>,

  // 위젯 팝업 윈도우
  widgetOpenPopup: (widgetId: string, title: string, extra?: Record<string, string>) =>
    ipcRenderer.invoke('widget:open-popup', widgetId, title, extra),
  widgetGetSavedState: (widgetId: string) =>
    ipcRenderer.invoke('widget:get-saved-state', widgetId) as Promise<{
      x: number; y: number; width: number; height: number;
      opacity: number; alwaysOnTop: boolean;
    } | null>,
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
