/**
 * 브라우저 테스트용 window.electronAPI mock
 * Electron 없이 Vite dev server에서 앱을 실행할 때 사용
 */

const noop = () => () => {};

// localStorage 기반 settings 저장소
const settingsStore: Record<string, unknown> = {};

function readSettings(fileName: string): unknown {
  const key = `bflow-mock:${fileName}`;
  const raw = localStorage.getItem(key);
  if (raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return settingsStore[fileName] ?? null;
}

function writeSettings(fileName: string, data: unknown): void {
  settingsStore[fileName] = data;
  localStorage.setItem(`bflow-mock:${fileName}`, JSON.stringify(data));
}

// 더미 사용자
const MOCK_USERS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: '테스트유저',
    slackId: '',
    password: '1234',
    isInitialPassword: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    role: 'admin',
  },
];

// 더미 에피소드 데이터
function makeMockEpisodes() {
  const stages = ['lo', 'done', 'review', 'png'] as const;
  const assignees = ['김작가', '이감독', '박디자이너', '최원화'];
  const episodes = [];

  for (let ep = 1; ep <= 3; ep++) {
    const parts: { partId: string; department: string; sheetName: string; scenes: unknown[] }[] = [];
    for (const partId of ['A', 'B']) {
      for (const dept of ['bg', 'acting']) {
        const suffix = dept === 'bg' ? '_BG' : '_ACT';
        const sheetName = `EP${String(ep).padStart(2, '0')}_${partId}${suffix}`;
        const scenes = [];
        for (let s = 1; s <= 8; s++) {
          const scene: Record<string, unknown> = {
            no: s,
            sceneId: `S${String(s).padStart(3, '0')}`,
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: assignees[Math.floor(Math.random() * assignees.length)],
            layoutId: '',
          };
          for (const st of stages) {
            scene[st] = Math.random() > 0.5;
          }
          scenes.push(scene);
        }
        parts.push({ partId, department: dept, sheetName, scenes });
      }
    }
    episodes.push({
      episodeNumber: ep,
      title: `EP.${String(ep).padStart(2, '0')}`,
      parts,
    });
  }
  return episodes;
}

const mockEpisodes = makeMockEpisodes();

// Registry 더미
function makeMockRegistry() {
  const entries = [];
  for (let ep = 1; ep <= 3; ep++) {
    for (const partId of ['A', 'B']) {
      for (const dept of ['bg', 'acting']) {
        const suffix = dept === 'bg' ? '_BG' : '_ACT';
        entries.push({
          episodeNumber: ep,
          partId,
          department: dept,
          sheetName: `EP${String(ep).padStart(2, '0')}_${partId}${suffix}`,
          archived: false,
          archivedAt: '',
          archivedBy: '',
          archiveMemo: '',
        });
      }
    }
  }
  return entries;
}

export function installMockElectronAPI(): void {
  if (window.electronAPI) return; // 실제 Electron 환경이면 스킵

  console.log('[Mock] electronAPI mock 설치 (브라우저 테스트 모드)');

  (window as any).electronAPI = {
    // 앱 설정
    getDataPath: async () => '/mock/appdata',

    // 사용자
    usersRead: async () => ({ ok: true, data: MOCK_USERS }),
    usersWrite: async () => ({ ok: true }),

    // 개인 설정
    readSettings: async (fileName: string) => readSettings(fileName),
    writeSettings: async (fileName: string, data: unknown) => { writeSettings(fileName, data); },

    // 이벤트 리스너 (noop)
    onSheetChanged: noop,
    onRetryNotify: noop,
    onSavingBeforeQuit: noop,

    // 이미지
    imageSave: async () => 'mock://image.png',
    imageDelete: async () => true,
    imageGetDir: async () => '/mock/images',
    clipboardReadImage: async () => null,

    // Sheets 연동
    sheetsConnect: async () => ({ ok: true }),
    sheetsIsConnected: async () => true,
    sheetsReadAll: async () => ({ ok: true, data: mockEpisodes }),
    sheetsUpdateCell: async () => ({ ok: true }),
    sheetsAddEpisode: async () => ({ ok: true }),
    sheetsAddPart: async () => ({ ok: true }),
    sheetsAddScene: async () => ({ ok: true }),
    sheetsDeleteScene: async () => ({ ok: true }),
    sheetsUpdateSceneField: async () => ({ ok: true }),
    sheetsUploadImage: async () => ({ ok: true, url: '' }),

    // METADATA
    sheetsReadMetadata: async () => ({ ok: true, value: '' }),
    sheetsWriteMetadata: async () => ({ ok: true }),
    sheetsSoftDeletePart: async () => ({ ok: true }),
    sheetsSoftDeleteEpisode: async () => ({ ok: true }),

    // 아카이빙
    sheetsReadArchived: async () => ({ ok: true, data: [] }),
    sheetsArchiveEpisode: async () => ({ ok: true }),
    sheetsUnarchiveEpisode: async () => ({ ok: true }),

    // 배치
    sheetsBatch: async () => ({ ok: true, results: [] }),
    sheetsBulkUpdateCells: async () => ({ ok: true }),
    sheetsAddScenes: async () => ({ ok: true }),

    // 사용자 (시트)
    sheetsReadUsers: async () => ({ ok: true, data: MOCK_USERS }),
    sheetsAddUser: async () => ({ ok: true }),
    sheetsUpdateUser: async () => ({ ok: true }),
    sheetsDeleteUser: async () => ({ ok: true }),

    // 댓글
    sheetsReadComments: async () => ({ ok: true, data: [] }),
    sheetsAddComment: async () => ({ ok: true }),
    sheetsEditComment: async () => ({ ok: true }),
    sheetsDeleteComment: async () => ({ ok: true }),

    // Registry
    sheetsReadRegistry: async () => ({ ok: true, data: makeMockRegistry() }),
    sheetsArchiveEpisodeViaRegistry: async () => ({ ok: true }),
    sheetsUnarchiveEpisodeViaRegistry: async () => ({ ok: true }),
    sheetsNotifyChange: async () => {},

    // 휴가
    vacationConnect: async () => ({ ok: true }),
    vacationIsConnected: async () => false,
    vacationReadStatus: async () => ({ ok: true, data: null }),
    vacationReadLog: async () => ({ ok: true, data: [] }),
    vacationReadAllEvents: async () => ({ ok: true, data: [] }),
    vacationRegister: async () => ({ ok: true }),
    vacationCancel: async () => ({ ok: true }),
    vacationGrantDahyu: async () => ({ ok: true }),
    vacationReadAllNames: async () => ({ ok: true, data: [] }),
    vacationReadDahyuList: async () => ({ ok: true, data: [] }),
    vacationDeleteDahyu: async () => ({ ok: true }),

    // 화이트보드
    whiteboardReadShared: async () => ({ ok: true, data: null }),
    whiteboardWriteShared: async () => ({ ok: true }),

    // 위젯 팝업
    widgetOpenPopup: async () => {},
    widgetGetSavedState: async () => null,
    widgetSetOpacity: async () => {},
    widgetClosePopup: async () => {},
    widgetResize: async () => {},
    widgetGetSize: async () => null,
    widgetCaptureBehind: async () => null,
    onWidgetFocusChange: noop,
    widgetSetAlwaysOnTop: async () => {},
    widgetMinimizeToDock: async () => {},
    widgetRestoreFromDock: async () => {},
    widgetDockExpand: async () => {},
    widgetDockCollapse: async () => {},
    onWidgetDockChange: noop,
  };
}
