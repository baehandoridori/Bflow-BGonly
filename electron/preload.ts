import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult } from './supabase';

contextBridge.exposeInMainWorld('electronAPI', {
  // 앱 설정
  getDataPath: () => ipcRenderer.invoke('settings:get-path'),

  // 파일탐색기에서 경로 열기
  shellShowItem: (filePath: string) =>
    ipcRenderer.invoke('shell:show-item', filePath) as Promise<{ ok: boolean; error?: string }>,
  shellOpenPath: (targetPath: string) =>
    ipcRenderer.invoke('shell:open-path', targetPath) as Promise<{ ok: boolean; error?: string }>,
  chooseFolderPath: () =>
    ipcRenderer.invoke('path:choose-folder') as Promise<string | null>,
  chooseFilePath: () =>
    ipcRenderer.invoke('path:choose-file') as Promise<string | null>,
  pathCreateFolder: (parentPath: string, folderName: string) =>
    ipcRenderer.invoke('path:create-folder', parentPath, folderName) as Promise<{
      ok: boolean;
      path?: string;
      existed?: boolean;
      error?: string;
      code?: 'parent-missing' | 'invalid-name' | 'permission' | 'unknown';
    }>,
  pathDirname: (targetPath: string) =>
    ipcRenderer.invoke('path:dirname', targetPath) as Promise<string>,
  pathExists: (targetPath: string) =>
    ipcRenderer.invoke('path:exists', targetPath) as Promise<boolean>,

  // 외부 URL 을 기본 브라우저로 열기 (메모 링크)
  openExternal: (url: string) =>
    ipcRenderer.invoke('shell:open-external', url) as Promise<{ ok: boolean; error?: string }>,

  // 사용자 파일 (base64 인코딩 JSON — exe 옆 또는 test-data/)
  usersRead: () => ipcRenderer.invoke('users:read'),
  usersWrite: (data: unknown) => ipcRenderer.invoke('users:write', data),

  // 개인 설정 (AppData)
  readSettings: (fileName: string) => ipcRenderer.invoke('settings:read', fileName),
  writeSettings: (fileName: string, data: unknown) =>
    ipcRenderer.invoke('settings:write', fileName, data),

  // v1.20.0: 사용자 폰트 (OTF/TTF/WOFF/WOFF2 추가/삭제)
  fontAdd: () => ipcRenderer.invoke('font:add'),
  fontAddByPath: (filePaths: string[]) => ipcRenderer.invoke('font:add-by-path', filePaths),
  fontDelete: (font: { id: string; filename: string }) => ipcRenderer.invoke('font:delete', font),
  // v1.20.0: 드래그앤드롭에서 File → 절대 경로 (Electron 32+에선 File.path 제거 → webUtils 사용 필수)
  fontGetPathForFile: (file: File) => webUtils.getPathForFile(file),

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

  // v1.22.1: 자동 업데이트 알림 — 백그라운드 fetch 완료 시 토스트 띄우기
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check-now'),
  // v1.44.2: '자동 중단' 상태에서 사용자가 직접 빠져나오기 — 차단 표식 정리 후 재확인
  retryUpdate: () => ipcRenderer.invoke('update:retry'),
  onUpdateState: (callback: (state: unknown | null) => void) => {
    const handler = (_event: unknown, state: unknown | null) => callback(state);
    ipcRenderer.on('update:state', handler);
    return () => { ipcRenderer.removeListener('update:state', handler); };
  },
  onUpdateReady: (callback: (version: string, state?: unknown) => void) => {
    const handler = (_event: unknown, version: string, state?: unknown) => callback(version, state);
    ipcRenderer.on('update:ready', handler);
    return () => { ipcRenderer.removeListener('update:ready', handler); };
  },
  // 사용자가 토스트의 "지금 업데이트" 클릭 시 — main이 installer 적용 후 최신 버전으로 열기
  applyUpdateNow: () => ipcRenderer.invoke('update:apply-now') as Promise<void>,

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
  supabaseUpdateEpisodeReelPath: (episodeNumber: number, reelFilePath: string | null) =>
    ipcRenderer.invoke('supabase:update-episode-reel-path', episodeNumber, reelFilePath),
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
  // v1.25.0~ 액팅 단계 토글 (sceneState + workRound + feedbackRound 한 번에)
  supabaseUpdateScenePhase: (
    sceneUuid: string,
    sceneState: 'wait' | 'work' | 'feedback' | 'done',
    workRound: number,
    feedbackRound: number,
    updatedBy?: string,
  ) =>
    ipcRenderer.invoke('supabase:update-scene-phase', sceneUuid, sceneState, workRound, feedbackRound, updatedBy),
  supabaseReadSceneWorkLinks: (sceneUuids?: string[]) =>
    ipcRenderer.invoke('supabase:read-scene-work-links', sceneUuids),
  supabaseUpsertSceneWorkLink: (input: unknown) =>
    ipcRenderer.invoke('supabase:upsert-scene-work-link', input),
  supabaseDeleteSceneWorkLink: (sceneUuid: string, department: 'bg' | 'acting', linkKind: 'folder' | 'primary_file') =>
    ipcRenderer.invoke('supabase:delete-scene-work-link', sceneUuid, department, linkKind),
  // v1.25.0~ 액팅 피드백 알림 디스패치
  supabaseDispatchFeedbackNotification: (payload: unknown) =>
    ipcRenderer.invoke('supabase:dispatch-feedback-notification', payload),
  // 리테이크 담당 완료 알림 디스패치
  supabaseDispatchRetakeAssigneeCompletionNotification: (payload: unknown) =>
    ipcRenderer.invoke('supabase:dispatch-retake-assignee-completion-notification', payload),
  // v1.25.5 로그인 catch-up — last_seen_at 이후 미읽음 액팅 피드백 알림 일괄 조회.
  //  before 옵션: 페이지네이션용 (created_at < before).
  supabaseFetchMissedFeedbackNotifications: (userId: string, since: string, limit?: number, before?: string) =>
    ipcRenderer.invoke('supabase:fetch-missed-feedback-notifications', userId, since, limit, before),
  // v1.25.5 알림 읽음 처리
  supabaseMarkFeedbackNotificationRead: (notificationId: string) =>
    ipcRenderer.invoke('supabase:mark-feedback-notification-read', notificationId),
  // v1.25.8 씬 담당자 배정 알림 catch-up — 한솔 보고: 미접속 시 알림이 사라짐.
  //  acting_feedback 과 동일 패턴 (DB row INSERT + broadcast + 로그인 catch-up).
  supabaseFetchMissedAssignmentNotifications: (userId: string, since: string, limit?: number, before?: string) =>
    ipcRenderer.invoke('supabase:fetch-missed-assignment-notifications', userId, since, limit, before),
  supabaseMarkAssignmentNotificationRead: (notificationId: string) =>
    ipcRenderer.invoke('supabase:mark-assignment-notification-read', notificationId),
  // v1.29.0 댓글 이모지 반응 알림 — catch-up / refetch / 읽음 처리.
  supabaseFetchCommentReactionNotifications: (args: {
    recipientId: string;
    since?: string;
    before?: string;
    limit?: number;
    ids?: string[];
  }) =>
    ipcRenderer.invoke('supabase:fetch-comment-reaction-notifications', args),
  supabaseMarkCommentReactionRead: (notificationId: string) =>
    ipcRenderer.invoke('supabase:mark-comment-reaction-read', notificationId),
  supabaseMarkAllCommentReactionsRead: (recipientId: string) =>
    ipcRenderer.invoke('supabase:mark-all-comment-reactions-read', recipientId),
  // v1.25.0~ Windows 네이티브 토스트 + 클릭 시 씬으로 점프
  notifyFeedbackToast: (payload: unknown) =>
    ipcRenderer.invoke('notify:feedback-toast', payload),
  supabaseBulkUpdateSceneStages: (updates: BulkStageUpdate[], updatedBy: string) =>
    ipcRenderer.invoke('supabase:bulk-update-scene-stages', updates, updatedBy) as Promise<BulkUpdateResult[]>,
  supabaseBulkDeleteScenes: (sceneUuids: string[], deletedBy: string) =>
    ipcRenderer.invoke('supabase:bulk-delete-scenes', sceneUuids, deletedBy) as Promise<BulkUpdateResult[]>,
  supabaseBulkUpdateSceneFields: (updates: BulkFieldUpdate[], updatedBy: string) =>
    ipcRenderer.invoke('supabase:bulk-update-scene-fields', updates, updatedBy) as Promise<BulkUpdateResult[]>,
  supabaseUpdateSceneField: (sceneUuid: string, field: string, value: string, senderId?: string) =>
    ipcRenderer.invoke('supabase:update-scene-field', sceneUuid, field, value, senderId),
  supabaseReadUsers: () =>
    ipcRenderer.invoke('supabase:read-users'),
  supabaseAddUser: (user: unknown) =>
    ipcRenderer.invoke('supabase:add-user', user),
  supabaseUpdateUser: (userId: string, updates: Record<string, string | boolean | null>) =>
    ipcRenderer.invoke('supabase:update-user', userId, updates),
  supabaseDeleteUser: (userId: string) =>
    ipcRenderer.invoke('supabase:delete-user', userId),
  supabaseReadComments: (partUuid: string) =>
    ipcRenderer.invoke('supabase:read-comments', partUuid),
  supabaseReadCommentsForCharacter: (characterId: string) =>
    ipcRenderer.invoke('supabase:read-comments-for-character', characterId),
  supabaseReadCommentReadStates: (userId: string) =>
    ipcRenderer.invoke('supabase:read-comment-read-states', userId),
  supabaseUpsertCommentReadState: (userId: string, sceneThreadKey: string, lastReadAt: string) =>
    ipcRenderer.invoke('supabase:upsert-comment-read-state', userId, sceneThreadKey, lastReadAt),
  // 한솔 결정 (v1.15.5): 로그인 catch-up
  supabaseFetchMissedMentions: (userId: string, userName: string, since: string, limit?: number) =>
    ipcRenderer.invoke('supabase:fetch-missed-mentions', userId, userName, since, limit),
  supabaseAddComment: (commentId: string, partUuid: string, sceneId: string,
    userId: string, userName: string, text: string, mentions: string[], createdAt: string, images: string[] = [],
    revisionId: string | null = null, parentCommentId: string | null = null,
    characterId: string | null = null, costumeId: string | null = null) =>
    ipcRenderer.invoke('supabase:add-comment', commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images, revisionId, parentCommentId, characterId, costumeId),
  supabaseEditComment: (commentId: string, text: string, mentions: string[], images?: string[]) =>
    ipcRenderer.invoke('supabase:edit-comment', commentId, text, mentions, images),
  supabaseDeleteComment: (commentId: string) =>
    ipcRenderer.invoke('supabase:delete-comment', commentId),
  // v1.26.0: 댓글 이모지 리액션
  supabaseAddCommentReaction: (commentId: string, emoji: string, userId: string, userName: string) =>
    ipcRenderer.invoke('supabase:add-comment-reaction', commentId, emoji, userId, userName),
  supabaseRemoveCommentReaction: (commentId: string, emoji: string, userId: string) =>
    ipcRenderer.invoke('supabase:remove-comment-reaction', commentId, emoji, userId),
  supabaseGetCommentReactionsBulk: (commentIds: string[]) =>
    ipcRenderer.invoke('supabase:get-comment-reactions-bulk', commentIds),
  // v1.26.0: 이미지 버전 관리
  supabaseListImageVersions: (sceneId: string, imageType: 'storyboard' | 'guide') =>
    ipcRenderer.invoke('supabase:list-image-versions', sceneId, imageType),
  supabaseAddImageVersion: (params: {
    sceneId: string;
    imageType: 'storyboard' | 'guide';
    kind: 'replace' | 'annotate';
    url: string;
    baseVersionNo?: number;
    createdBy: string;
    description?: string | null;
  }) => ipcRenderer.invoke('supabase:add-image-version', params),
  supabaseDeleteImageVersion: (versionId: string) =>
    ipcRenderer.invoke('supabase:delete-image-version', versionId),
  // 비공개 캘린더 이벤트 (Supabase 전용, Google Calendar 비연동)
  supabaseReadPrivateEvents: (userId: string) =>
    ipcRenderer.invoke('supabase:read-private-events', userId),
  supabaseAddPrivateEvent: (input: unknown) =>
    ipcRenderer.invoke('supabase:add-private-event', input),
  supabaseUpdatePrivateEvent: (id: string, updates: unknown) =>
    ipcRenderer.invoke('supabase:update-private-event', id, updates),
  supabaseDeletePrivateEvent: (id: string) =>
    ipcRenderer.invoke('supabase:delete-private-event', id),
  supabaseReadRevisions: () =>
    ipcRenderer.invoke('supabase:read-revisions'),
    supabaseAddRevision: (
      id: string, partUuid: string, sceneId: string, revisionNo: number, status: string,
      priority: string, description: string, frameNo: string, imageUrl: string,
      department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
      notifyUserIdsJson: string, assigneeIdsJson?: string, setId?: string,
    ) =>
      ipcRenderer.invoke('supabase:add-revision', id, partUuid, sceneId, revisionNo, status,
        priority, description, frameNo, imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt,
        notifyUserIdsJson, assigneeIdsJson, setId),
  supabaseUpdateRevision: (id: string, updates: Record<string, string>) =>
    ipcRenderer.invoke('supabase:update-revision', id, updates),
  supabaseDeleteRevision: (id: string) =>
    ipcRenderer.invoke('supabase:delete-revision', id),
  // 리테이크 세트 (comp_revision_sets)
  supabaseReadRevisionSets: () =>
    ipcRenderer.invoke('supabase:read-revision-sets'),
  supabaseAddRevisionSet: (input: unknown) =>
    ipcRenderer.invoke('supabase:add-revision-set', input),
  supabaseUpdateRevisionSet: (id: string, fields: unknown) =>
    ipcRenderer.invoke('supabase:update-revision-set', id, fields),
  supabaseDeleteRevisionSet: (id: string) =>
    ipcRenderer.invoke('supabase:delete-revision-set', id),
  supabaseReadAllMetadata: () =>
    ipcRenderer.invoke('supabase:read-all-metadata'),
  supabaseReadMetadata: (type: string, key: string) =>
    ipcRenderer.invoke('supabase:read-metadata', type, key),
  supabaseWriteMetadata: (type: string, key: string, value: string) =>
    ipcRenderer.invoke('supabase:write-metadata', type, key, value),
  supabaseGetActivity: (opts: { table?: string; action?: 'read' | 'write'; rangeMs: number; buckets: number }) =>
    ipcRenderer.invoke('supabase:get-activity', opts) as Promise<Array<{ startTs: number; count: number }>>,
  supabaseGetRealtimeStatus: () =>
    ipcRenderer.invoke('supabase:get-realtime-status') as Promise<string>,
  // ─── Personal Todos / Task Views ──────────────────
  supabaseReadTodos: (userId: string) => ipcRenderer.invoke('supabase:read-todos', userId),
  supabaseUpsertTodo: (userId: string, todo: unknown) => ipcRenderer.invoke('supabase:upsert-todo', userId, todo),
  supabaseDeleteTodo: (todoId: string) => ipcRenderer.invoke('supabase:delete-todo', todoId),
  supabaseReadTaskViews: (userId: string) => ipcRenderer.invoke('supabase:read-task-views', userId),
  supabaseUpsertTaskViews: (userId: string, views: unknown[], sceneKeys: unknown[]) =>
    ipcRenderer.invoke('supabase:upsert-task-views', userId, views, sceneKeys),
  supabaseReadMemo: (userId: string, widgetId: string) =>
    ipcRenderer.invoke('supabase:read-memo', userId, widgetId),
  supabaseUpsertMemo: (userId: string, widgetId: string, data: unknown) =>
    ipcRenderer.invoke('supabase:upsert-memo', userId, widgetId, data),
  supabaseReadAllMemos: (userId: string) =>
    ipcRenderer.invoke('supabase:read-all-memos', userId),

  // 활동 기록 — 메인에 currentUser 알리기 (mutation 자동 기록 시 사용)
  authSetCurrentUser: (user: { id: string; name: string } | null) =>
    ipcRenderer.invoke('auth:set-current-user', user),

  // 활동 기록 (activity_log)
  activityList: (opts: {
    before?: string;
    limit?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
    sceneIds?: string[];
    rangeStart?: string;
    rangeEnd?: string;
  }) => ipcRenderer.invoke('activity:list', opts),
  activityStats: (opts: {
    days?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
  }) => ipcRenderer.invoke('activity:stats', opts),
  // v1.23.0
  activityStatsV2: (opts: {
    rangeStart: string;
    rangeEnd: string;
    granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
    department?: 'bg' | 'acting' | null;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  }) => ipcRenderer.invoke('activity:stats-v2', opts),
  activityInsights: (opts: {
    rangeStart: string;
    rangeEnd: string;
    department?: 'bg' | 'acting' | null;
  }) => ipcRenderer.invoke('activity:insights', opts),
  activityBackfill: (since: string) => ipcRenderer.invoke('activity:backfill', since),
  activityStorageInfo: () => ipcRenderer.invoke('activity:storage-info'),
  onActivityRealtimeInsert: (callback: (row: unknown) => void) => {
    const handler = (_event: unknown, row: unknown) => callback(row);
    ipcRenderer.on('activity:realtime-insert', handler);
    return () => ipcRenderer.removeListener('activity:realtime-insert', handler);
  },

  // 슬랙 웹훅
  sendSlackWebhook: (payload: Record<string, string>) =>
    ipcRenderer.invoke('slack:send-webhook', payload),

  // 딥링크 수신 (bflow://scene/...)
  onDeepLink: (callback: (data: { sheetName: string; sceneId: string }) => void) => {
    const handler = (_event: unknown, data: { sheetName: string; sceneId: string }) => callback(data);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },

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

  // v1.25.0~ 액팅 피드백 토스트 클릭 → 씬 점프 신호 수신
  // v1.25.8 코덱스 3차 P2: notificationId/kind 도 함께 전달 — 클릭 후 read_at 처리.
  onFeedbackJumpToScene: (
    callback: (payload: {
      sheetName: string; sceneId: string; sceneUuid: string;
      notificationId?: string;
      kind?: 'feedback' | 'assignment';
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: {
        sheetName: string; sceneId: string; sceneUuid: string;
        notificationId?: string;
        kind?: 'feedback' | 'assignment';
      },
    ) => callback(data);
    ipcRenderer.on('feedback:jump-to-scene', handler);
    return () => ipcRenderer.removeListener('feedback:jump-to-scene', handler);
  },

  // GAS 연결 (이미지 업로드용 Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) =>
    ipcRenderer.invoke('sheets:connect', webAppUrl),
  sheetsIsConnected: () => ipcRenderer.invoke('sheets:is-connected'),

  // 이미지 업로드 (GAS → Google Drive)
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) =>
    ipcRenderer.invoke('sheets:upload-image', sheetName, sceneId, imageType, base64Data),

  // ─── Supabase Storage ──────────────────────────────
  storageUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) =>
    ipcRenderer.invoke('storage:upload-image', sheetName, sceneId, imageType, base64Data),
  storageDeleteImage: (url: string) => ipcRenderer.invoke('storage:delete-image', url),

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

  // ─── Google Calendar ──────────────────────────────
  gcalIsAuthenticated: () => ipcRenderer.invoke('gcal:is-authenticated'),
  gcalStartAuth: () => ipcRenderer.invoke('gcal:start-auth'),
  gcalSaveCredentials: (clientId: string, clientSecret: string) =>
    ipcRenderer.invoke('gcal:save-credentials', clientId, clientSecret),
  gcalHasCredentials: () => ipcRenderer.invoke('gcal:has-credentials') as Promise<boolean>,
  gcalSignOut: () => ipcRenderer.invoke('gcal:sign-out'),
  gcalListCalendars: () => ipcRenderer.invoke('gcal:list-calendars'),
  gcalFullSync: (calendarId: string) => ipcRenderer.invoke('gcal:full-sync', calendarId),
  gcalIncrementalSync: (calendarId: string) => ipcRenderer.invoke('gcal:incremental-sync', calendarId),
  gcalInsertEvent: (calendarId: string, input: unknown) => ipcRenderer.invoke('gcal:insert-event', calendarId, input),
  gcalUpdateEvent: (calendarId: string, eventId: string, input: unknown) => ipcRenderer.invoke('gcal:update-event', calendarId, eventId, input),
  gcalDeleteEvent: (calendarId: string, eventId: string) => ipcRenderer.invoke('gcal:delete-event', calendarId, eventId),
  gcalEnsureWatch: (calendarId: string, userId: string) => ipcRenderer.invoke('gcal:ensure-watch', calendarId, userId),

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
  widgetResize: (widgetId: string, width: number, height: number, x?: number, y?: number) =>
    ipcRenderer.invoke('widget:resize', widgetId, width, height, x, y),
  // 위젯 팝업 → 본체 씬 상세 이동 (feedback:jump-to-scene 패턴 미러링)
  widgetNavigateMain: (payload: unknown) =>
    ipcRenderer.invoke('widget:navigate-main', payload),
  onWidgetNavigateMain: (callback: (payload: {
    sheetName: string; sceneId: string; sceneUuid: string;
    episodeNumber?: number; partId?: string;
  }) => void) => {
    const handler = (_event: unknown, data: {
      sheetName: string; sceneId: string; sceneUuid: string;
      episodeNumber?: number; partId?: string;
    }) => callback(data);
    ipcRenderer.on('widget:navigate-main', handler);
    return () => ipcRenderer.removeListener('widget:navigate-main', handler);
  },
  widgetGetSize: (widgetId: string) =>
    ipcRenderer.invoke('widget:get-size', widgetId) as Promise<{ x: number; y: number; width: number; height: number } | null>,
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

  // ─── 설정/세션 변경 브로드캐스트 ─────────────────
  preferencesBroadcastChange: (payload?: unknown) =>
    ipcRenderer.invoke('preferences:broadcast-change', payload),

  onPreferencesChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('preferences:changed', listener);
    return () => ipcRenderer.removeListener('preferences:changed', listener);
  },

  sessionBroadcastChange: (payload?: unknown) =>
    ipcRenderer.invoke('session:broadcast-change', payload),

  // 구독 등록 후 메인에 현재 세션 재전송 요청 (ready-to-show 타이밍 miss 방어)
  sessionRequestCurrent: () =>
    ipcRenderer.invoke('session:request-current'),

  onSessionChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('session:changed', listener);
    return () => ipcRenderer.removeListener('session:changed', listener);
  },

  themeBroadcastChange: (payload?: unknown) =>
    ipcRenderer.invoke('theme:broadcast-change', payload),

  onThemeChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },

  // ─── 캘린더 변경 브로드캐스트 ─────────────────────
  calendarBroadcastChange: (payload?: unknown) =>
    ipcRenderer.invoke('calendar:broadcast-change', payload),

  onCalendarChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('calendar:changed', listener);
    return () => ipcRenderer.removeListener('calendar:changed', listener);
  },

  // ─── 휴가 pending 상태 + 브로드캐스트 ─────────────
  vacationPendingLoad: () =>
    ipcRenderer.invoke('vacation:pending:load'),
  vacationPendingSave: (list: unknown) =>
    ipcRenderer.invoke('vacation:pending:save', list),
  vacationBroadcastRegistered: (payload?: unknown) =>
    ipcRenderer.invoke('vacation:broadcast-registered', payload),
  vacationBroadcastFailed: (payload?: unknown) =>
    ipcRenderer.invoke('vacation:broadcast-failed', payload),
  vacationBroadcastPendingChanged: (payload?: unknown) =>
    ipcRenderer.invoke('vacation:broadcast-pending-changed', payload),

  onVacationRegistered: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('vacation:registered', listener);
    return () => ipcRenderer.removeListener('vacation:registered', listener);
  },
  onVacationFailed: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('vacation:failed', listener);
    return () => ipcRenderer.removeListener('vacation:failed', listener);
  },
  onVacationPendingChanged: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('vacation:pending-changed', listener);
    return () => ipcRenderer.removeListener('vacation:pending-changed', listener);
  },

  // ─── v1.30.0: 컴포지팅 단계 상태 ───
  // spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
  supabaseLoadCompositingStates: (episodeNumber: number) =>
    ipcRenderer.invoke('supabase:load-compositing-states', episodeNumber),
  supabaseSetCompositingState: (input: {
    episodeNumber: number;
    sceneId: string;
    partId: string;
    status: 'batch' | 'combine' | 'aggregated' | 'adjust' | 'error' | 'done';
    errorKind?: 'missing_file' | 'fix_blemish' | 'retake' | 'canceled_scene' | 'other' | null;
    errorNote?: string | null;
    progressPercent?: number;
    updatedBy: string;
  }) => ipcRenderer.invoke('supabase:set-compositing-state', input),
  onCompositingStatesRealtime: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('compositing-states:realtime', listener);
    return () => ipcRenderer.removeListener('compositing-states:realtime', listener);
  },

  // ─── 캐릭터 현황판 ───
  supabaseLoadCharacters: () => ipcRenderer.invoke('supabase:load-characters'),
  supabaseLoadCharacterCostumes: () => ipcRenderer.invoke('supabase:load-character-costumes'),
  supabaseLoadEpisodeCharacterMap: () => ipcRenderer.invoke('supabase:load-episode-character-map'),
  supabaseAddCharacter: (input: { name: string; memo?: string | null; createdBy?: string | null }) =>
    ipcRenderer.invoke('supabase:add-character', input),
  supabaseUpdateCharacter: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('supabase:update-character', id, updates),
  supabaseDeleteCharacter: (id: string) =>
    ipcRenderer.invoke('supabase:delete-character', id),
  supabaseAddCostume: (input: { characterId: string; name: string; createdBy?: string | null }) =>
    ipcRenderer.invoke('supabase:add-costume', input),
  supabaseUpdateCostume: (id: string, updates: Record<string, unknown>, logContext?: unknown) =>
    ipcRenderer.invoke('supabase:update-costume', id, updates, logContext),
  supabaseDeleteCostume: (id: string) =>
    ipcRenderer.invoke('supabase:delete-costume', id),
  supabaseLinkCharacterEpisode: (episodeNumber: number, characterId: string, createdBy?: string | null) =>
    ipcRenderer.invoke('supabase:link-character-episode', episodeNumber, characterId, createdBy),
  supabaseUnlinkCharacterEpisode: (episodeNumber: number, characterId: string) =>
    ipcRenderer.invoke('supabase:unlink-character-episode', episodeNumber, characterId),
  supabaseUpdateEpisodeCharacterMap: (
    episodeNumber: number,
    characterId: string,
    updates: { memo?: string | null; costumeId?: string | null },
  ) => ipcRenderer.invoke('supabase:update-episode-character-map', episodeNumber, characterId, updates),
  storageUploadCharacterImage: (characterId: string, costumeId: string, base64Data: string) =>
    ipcRenderer.invoke('storage:upload-character-image', characterId, costumeId, base64Data),
  onCharacterBoardRealtime: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('character-board:realtime', listener);
    return () => ipcRenderer.removeListener('character-board:realtime', listener);
  },
});
