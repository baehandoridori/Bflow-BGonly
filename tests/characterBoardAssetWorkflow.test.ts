import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHARACTER_IMAGE_BACKGROUND,
  getCharacterImageFitTransformStyle,
  getPathBaseName,
  getParentFolderPath,
  getResolvedCharacterFolderAfterFilePick,
  normalizeCharacterImageBackground,
  normalizeCharacterImageFit,
  resolveCharacterImageFitScales,
} from '../src/utils/characterAssets.ts';
import { resolveChildFolderPath, sanitizeWindowsFolderName } from '../electron/pathCreateFolder.ts';

const typeSource = readFileSync('src/types/index.ts', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rendererSupabase = readFileSync('src/services/supabaseService.ts', 'utf8');
const electronSupabase = readFileSync('electron/supabase.ts', 'utf8');
const electronMain = readFileSync('electron/main.ts', 'utf8');
const electronPreload = readFileSync('electron/preload.ts', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const spotlight = readFileSync('src/components/spotlight/SpotlightSearch.tsx', 'utf8');
const characterBoard = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const stageRailSource = readFileSync('src/components/characters/StageRail.tsx', 'utf8');
const tagChipsSource = readFileSync('src/components/characters/TagChips.tsx', 'utf8');
const characterCardSource = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const featuredImageSlotSource = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
const costumeDetailSource = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
const characterDetailModalSource = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
const addCharacterModalSource = readFileSync('src/components/characters/AddCharacterModal.tsx', 'utf8');
// 캐릭터 현황판 UI 전체(뷰 + 분리된 컴포넌트 파일) — 모놀리스 시절의 파일 전역 검사(금지 패턴 부재 등)를 보존하기 위한 결합 소스.
const characterBoardAll = [
  characterBoard,
  stageRailSource,
  tagChipsSource,
  characterCardSource,
  featuredImageSlotSource,
  costumeDetailSource,
  characterDetailModalSource,
  addCharacterModalSource,
].join('\n');
const characterStore = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
const characterStoreHelpers = readFileSync('src/stores/characterBoardStoreHelpers.ts', 'utf8');
const characterStageMeta = readFileSync('src/utils/characterStageMeta.ts', 'utf8');
const characterStageConstants = readFileSync('src/constants/characterStages.ts', 'utf8');
const characterLayerConstants = readFileSync('src/constants/characterLayers.ts', 'utf8');
const themeSource = readFileSync('src/themes.ts', 'utf8');
const indexHtml = readFileSync('index.html', 'utf8');
const sidebarSource = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const characterFolderService = readFileSync('src/services/characterFolderService.ts', 'utf8');
const characterFolderRootSection = readFileSync('src/components/settings/CharacterFolderRootSection.tsx', 'utf8');
const settingsView = readFileSync('src/views/SettingsView.tsx', 'utf8');
const episodeAssetBoard = readFileSync('src/views/EpisodeAssetBoard.tsx', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const myTasksWidget = readFileSync('src/components/widgets/MyTasksWidget.tsx', 'utf8');
const myTasksData = readFileSync('src/components/widgets/my-tasks/hooks/useMyTasksData.ts', 'utf8');
const myCharacterTasks = readFileSync('src/components/widgets/my-tasks/hooks/useMyCharacterTasks.ts', 'utf8');
const myTaskStats = readFileSync('src/components/widgets/my-tasks/statsUtils.ts', 'utf8');
const characterTaskRow = readFileSync('src/components/widgets/my-tasks/components/CharacterTaskRow.tsx', 'utf8');
const confirmDialog = readFileSync('src/components/common/ConfirmDialog.tsx', 'utf8');
const modalFocusHook = readFileSync('src/hooks/useModalFocus.ts', 'utf8');
const accessHookSource = readFileSync('src/hooks/useCharacterBoardAccess.ts', 'utf8');
const characterImageLightbox = readFileSync('src/components/characters/CharacterImageLightbox.tsx', 'utf8');
const fitEditorSource = readFileSync('src/components/characters/CharacterImageFitEditor.tsx', 'utf8');
const imageFrameSource = readFileSync('src/components/characters/CharacterImageFrame.tsx', 'utf8');
const imageContextMenuSource = readFileSync('src/components/characters/CharacterImageContextMenu.tsx', 'utf8');
const assigneeNamePickerSource = readFileSync('src/components/characters/AssigneeNamePicker.tsx', 'utf8');
const episodeReelActionsSource = readFileSync('src/services/episodeReelActions.ts', 'utf8');
const userColorSource = readFileSync('src/utils/userColor.ts', 'utf8');
const indexCss = readFileSync('src/index.css', 'utf8');
const devMock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
const migration = readFileSync('DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql', 'utf8');
const backgroundDefaultMigration = readFileSync('DEVLOG/migrations/2026-07-03-character-image-background-default.sql', 'utf8');

test('character asset helpers derive parent folder and preserve existing character folder', () => {
  assert.equal(
    getParentFolderPath('G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\찜질방 사장 캐릭터\\main.moho'),
    'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\찜질방 사장 캐릭터',
  );
  assert.equal(
    getPathBaseName('G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\찜질방 사장 캐릭터\\'),
    '찜질방 사장 캐릭터',
  );
  assert.equal(getPathBaseName('G:\\show\\char\\main.moho'), 'main.moho');
  assert.equal(getPathBaseName(''), '');
  assert.equal(
    getResolvedCharacterFolderAfterFilePick('', 'G:\\show\\char\\main.moho'),
    'G:\\show\\char',
  );
  assert.equal(
    getResolvedCharacterFolderAfterFilePick('G:\\show\\custom-folder', 'G:\\show\\char\\main.moho'),
    'G:\\show\\custom-folder',
  );
});

test('character folder create path sanitizes names and never escapes the parent folder', () => {
  assert.equal(sanitizeWindowsFolderName('A/B: C?'), 'AB C');
  assert.equal(sanitizeWindowsFolderName('CON'), 'CON_');
  assert.equal(sanitizeWindowsFolderName('bad. '), 'bad');
  assert.equal(sanitizeWindowsFolderName('...'), '');

  assert.equal(resolveChildFolderPath('G:\\show\\characters', '..'), null);
  const resolved = resolveChildFolderPath('G:\\show\\characters', '..\\outside');
  assert.ok(resolved);
  assert.ok(
    resolved.fullPath.toLowerCase().startsWith('g:\\show\\characters\\'),
    `created path should stay under parent, got ${resolved.fullPath}`,
  );
});

test('character image fit defaults are stable and clamp unsafe values', () => {
  assert.deepEqual(normalizeCharacterImageFit(null), {
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    x: 0,
    y: 0,
    lockAspect: true,
  });
  assert.deepEqual(normalizeCharacterImageFit({ scale: -4, x: 'bad', y: 120, lockAspect: false }), {
    scale: 0.25,
    scaleX: 0.25,
    scaleY: 0.25,
    x: 0,
    y: 100,
    lockAspect: false,
  });
  assert.deepEqual(
    resolveCharacterImageFitScales({ scale: 2, scaleX: 3, scaleY: 4, x: 0, y: 0, lockAspect: true }),
    { scaleX: 2, scaleY: 2 },
  );
  assert.deepEqual(
    resolveCharacterImageFitScales({ scale: 2, scaleX: 3, scaleY: 4, x: 0, y: 0, lockAspect: false }),
    { scaleX: 3, scaleY: 4 },
  );
  assert.deepEqual(
    getCharacterImageFitTransformStyle({ scale: 2, scaleX: 3, scaleY: 4, x: 10, y: -20, lockAspect: false }),
    { transform: 'translate(10%, -20%) scale(3, 4)', transformOrigin: 'center center' },
  );
});

test('character image background defaults to transparent for new image workflows', () => {
  assert.equal(DEFAULT_CHARACTER_IMAGE_BACKGROUND, 'transparent');
  assert.equal(normalizeCharacterImageBackground('bad-value'), 'transparent');
  assert.match(backgroundDefaultMigration, /ALTER COLUMN image_background SET DEFAULT 'transparent'/);
  assert.match(imageFrameSource, /background = DEFAULT_CHARACTER_IMAGE_BACKGROUND/);
  assert.match(featuredImageSlotSource, /background=\{selectedImage\.imageBackground\}/);
  assert.match(devMock, /image_background: 'transparent'/);
  assert.ok(
    imageContextMenuSource.indexOf("{ value: 'transparent', label: '투명' }") <
      imageContextMenuSource.indexOf("{ value: 'black', label: '검정' }"),
    'transparent should be the first background menu option',
  );
});

test('character and costume domain types expose asset workflow fields', () => {
  for (const token of [
    'workFolderPath',
    'workFilePath',
    'imageBackground',
    'imageFit',
    'designAssignee',
    'riggingAssignee',
    'reelFilePath',
  ]) {
    assert.match(typeSource, new RegExp(token), `missing type field: ${token}`);
  }
});

test('shared user color helper is separated from assignee input UI', () => {
  assert.match(userColorSource, /export function getUserColor\(name: string\): string/);
  assert.match(assigneeNamePickerSource, /import \{ getUserColor \} from '@\/utils\/userColor'/);
  assert.doesNotMatch(characterBoardAll, /getUserColor/);
  assert.match(imageFrameSource, /getCharacterImageFitTransformStyle/);
});

test('renderer and electron Supabase mapping include new snake_case fields', () => {
  for (const token of [
    'work_folder_path',
    'work_file_path',
    'image_background',
    'image_fit',
    'design_assignee',
    'rigging_assignee',
    'reel_file_path',
  ]) {
    assert.match(rendererSupabase, new RegExp(token), `renderer mapping missing ${token}`);
    assert.match(electronSupabase, new RegExp(token), `electron mapping missing ${token}`);
    assert.match(migration, new RegExp(token), `migration missing ${token}`);
  }
});

test('character costume IPC channels use explicit character-costume names', () => {
  for (const channel of [
    'supabase:add-character-costume',
    'supabase:update-character-costume',
    'supabase:delete-character-costume',
  ]) {
    assert.match(electronMain, new RegExp(channel), `main IPC missing ${channel}`);
    assert.match(electronPreload, new RegExp(channel), `preload IPC missing ${channel}`);
  }
  // 복장(costume) 엔티티는 반드시 명시적 character-costume 네이밍을 쓴다 — 애매한 bare `costume` 금지.
  // 단, 별도 엔티티인 복장 이미지(costume-image) 채널은 예외로 허용(negative lookahead).
  assert.doesNotMatch(electronMain, /supabase:(add|update|delete)-costume(?!-image)/);
  assert.doesNotMatch(electronPreload, /supabase:(add|update|delete)-costume(?!-image)/);
});

test('character episode mapping realtime merges single links when episode metadata is present', () => {
  assert.match(electronSupabase, /enrichEpisodeCharacterMappingPayload/);
  assert.match(electronSupabase, /\.from\('episodes'\)[\s\S]*?\.select\('episode_number'\)/);
  assert.match(electronSupabase, /episode_number: episodeNumber as number/);
  // enrich 는 채널 단위 promise 체인으로 직렬화 — 도착 순서 = 브로드캐스트 순서 (H-5).
  assert.match(electronSupabase, /broadcastQueue = broadcastQueue\.then/);
  assert.match(electronSupabase, /episodeNumberCache/);

  assert.match(characterStoreHelpers, /function rowToRealtimeMapping/);
  assert.match(characterStore, /const mapping = rowToRealtimeMapping\(eventType === 'DELETE' \? old : row\)/);
  assert.match(characterStore, /if \(!mapping\) \{[\s\S]*?void reloadEpisodeMappings\(set, get\)/);
  assert.match(characterStore, /eventType === 'DELETE'[\s\S]*?removeLink\(s\.episodeLinks, mapping\.characterId, mapping\.episodeNumber\)/);
  assert.match(characterStore, /upsertLink\(\s*s\.episodeLinks,\s*mapping\.characterId,\s*mapping\.episodeNumber/);
});

test('legacy costume assignee remains visible in split assignee fields', () => {
  assert.match(rendererSupabase, /hasDesignAssigneeColumn\s*=\s*Object\.prototype\.hasOwnProperty\.call\(row,\s*'design_assignee'\)/);
  assert.match(rendererSupabase, /hasRiggingAssigneeColumn\s*=\s*Object\.prototype\.hasOwnProperty\.call\(row,\s*'rigging_assignee'\)/);
  assert.match(rendererSupabase, /designAssignee:\s*hasDesignAssigneeColumn\s*\?\s*row\.design_assignee\s*\?\?\s*null\s*:\s*row\.assignee\s*\?\?\s*null/);
  assert.match(rendererSupabase, /riggingAssignee:\s*hasRiggingAssigneeColumn\s*\?\s*row\.rigging_assignee\s*\?\?\s*null\s*:\s*row\.assignee\s*\?\?\s*null/);
  assert.match(migration, /design_assignee\s*=\s*COALESCE\(design_assignee,\s*assignee\)/);
  assert.match(migration, /rigging_assignee\s*=\s*COALESCE\(rigging_assignee,\s*assignee\)/);
  assert.match(migration, /UPDATE character_costumes\r?\n\s+SET design_assignee/, 'June migration must refresh delete_user_cascade for design assignees');
  assert.match(migration, /UPDATE character_costumes\r?\n\s+SET rigging_assignee/, 'June migration must refresh delete_user_cascade for rigging assignees');
  assert.ok(migration.includes("regexp_split_to_array(design_assignee, '[[:space:]]*,[[:space:]]*')"), 'June migration must handle comma-separated design assignees');
  assert.ok(migration.includes("regexp_split_to_array(rigging_assignee, '[[:space:]]*,[[:space:]]*')"), 'June migration must handle comma-separated rigging assignees');
});

test('character board is wired for image display, assignees, work links, and lightbox navigation', () => {
  for (const token of [
    'CharacterImageFrame',
    'CharacterImageContextMenu',
    'CharacterImageFitEditor',
    'CharacterImageLightbox',
    'AssigneeNamePicker',
    '디자인 담당자',
    '리깅 담당자',
    '작업 폴더',
    '작업 파일',
    '이미지 복사',
  ]) {
    assert.match(characterBoardAll, new RegExp(token), `character board sources missing ${token}`);
  }
  assert.match(assigneeNamePickerSource, /setModalOpen/);
  assert.match(assigneeNamePickerSource, /placeholder="이름 입력"/);
  assert.doesNotMatch(characterBoardAll, /fallbackCostume/);
  assert.ok(featuredImageSlotSource.includes("isPng ? 'image/png' : 'image/jpeg'"));
  assert.ok(characterDetailModalSource.includes('const saved = await updateCostumeField(targetCostume.id, { workFilePath: filePath });'));
  assert.ok(characterDetailModalSource.includes('if (!saved) return;'));
  assert.ok(characterDetailModalSource.includes('useCharacterBoardStore.getState().characters.find'));
  assert.match(imageFrameSource, /getCharacterImageFitTransformStyle\(normalized\)/);
  assert.match(characterCardSource, /aspect-\[3\/4\] bg-bg-border\/30 flex items-center justify-center overflow-hidden/);
  assert.doesNotMatch(characterBoardAll, /aspect-\[4\/3\]/);
  assert.match(fitEditorSource, /stopImmediatePropagation/);
  // 이미지 로드 실패 시 안내가 있어야 편집기가 조용히 미초기화 상태로 남지 않는다 (GAP-A).
  assert.match(fitEditorSource, /onError=\{\(\) => setLoadFailed\(true\)\}/);
  assert.match(fitEditorSource, /이미지를 불러오지 못했어요/);
  assert.match(fitEditorSource, /cropFrameRef/);
  assert.match(characterImageLightbox, /initialCostumeIdRef/);
  assert.match(characterImageLightbox, /currentCostumeId/);
  assert.match(characterImageLightbox, /findIndex\(\(entry\) => entry\.costumeId === currentCostumeId\)/);
  assert.doesNotMatch(characterImageLightbox, /setIndex\(initialIndex\)/);
  assert.match(characterStore, /Promise<boolean>/);
  assert.match(characterStore, /return true;/);
  assert.match(characterStore, /return false;/);
  assert.match(costumeDetailSource, /\/\* 단계 레일 \+ 담당자 \*\//);
  assert.doesNotMatch(characterBoardAll, /\/\* 버전 \+ 담당자 \*\//);
  assert.ok(
    costumeDetailSource.indexOf('label="디자인 단계"') < costumeDetailSource.indexOf('label="디자인 담당자"'),
    'design assignee should live with the design stage lane, not the version controls',
  );
  assert.ok(
    costumeDetailSource.indexOf('label="리깅 단계"') < costumeDetailSource.indexOf('label="리깅 담당자"'),
    'rigging assignee should live with the rigging stage lane, not the version controls',
  );
});

test('character board creates a first costume automatically and keeps image actions focused', () => {
  // 첫 복장은 공용 유틸의 기본 명칭('기본 복장'), 이후 복장은 costumeNameForNew 로 '복장 N'.
  assert.match(characterStore, /svcAddCostume\(\{ characterId: created\.id, name: DEFAULT_COSTUME_NAME, createdBy \}\)/);
  assert.match(characterStore, /import \{ DEFAULT_COSTUME_NAME \} from '@\/utils\/characterCostumeName'/);
  assert.match(characterStore, /console\.warn\('\[character-board\] 첫 복장 자동 생성 실패:'/);
  assert.match(characterDetailModalSource, /import \{ costumeNameForNew \} from '@\/utils\/characterCostumeName'/);
  assert.match(characterDetailModalSource, /await addCostume\(character\.id, costumeNameForNew\(costumes\)\)/);
  assert.match(characterDetailModalSource, /const ensureCostume = useCallback\(async \(\) => \{/);
  assert.match(characterDetailModalSource, /targetCostume = targetCostume \?\? await ensureCostume\(\);/);
  assert.doesNotMatch(characterBoardAll, /먼저 디자인\(복장\)/);

  const featuredSlot = featuredImageSlotSource.match(/function FeaturedImageSlot\([\s\S]*?\r?\n}\r?\n\r?\n\/\*\* 복장 메모/);
  assert.ok(featuredSlot, 'FeaturedImageSlot should remain locally inspectable');
  assert.match(featuredSlot[0], /grid grid-cols-\[1fr_1fr_auto\]/);
  assert.match(featuredSlot[0], /이미지 추가/);
  assert.match(featuredSlot[0], /대표/);
  assert.match(featuredSlot[0], /복사/);
  const visibleButtonArea = featuredSlot[0].slice(
    featuredSlot[0].indexOf('grid grid-cols-[1fr_1fr_auto]'),
    featuredSlot[0].indexOf('<input'),
  );
  assert.doesNotMatch(visibleButtonArea, /작업 폴더/);
  assert.doesNotMatch(visibleButtonArea, /작업 파일/);
});

test('character board can create and link a work folder from the configured team root', () => {
  assert.match(electronMain, /import \{ resolveChildFolderPath \} from '\.\/pathCreateFolder'/);
  assert.match(electronMain, /ipcMain\.handle\('path:create-folder'/);
  assert.match(electronMain, /code: 'parent-missing'/);
  assert.match(electronMain, /code: 'invalid-name'/);
  assert.match(electronMain, /code: 'permission'/);
  assert.match(electronMain, /existed: true/);

  assert.match(electronPreload, /pathCreateFolder: \(parentPath: string, folderName: string\)/);
  assert.match(typeSource, /pathCreateFolder\?: \(/);
  assert.match(devMock, /key: 'work-folder-root'/);
  assert.match(devMock, /pathCreateFolder: async \(parentPath: string, folderName: string\)/);

  assert.match(characterFolderService, /CHARACTER_FOLDER_ROOT_META[\s\S]*type: 'character-board'[\s\S]*key: 'work-folder-root'/);
  assert.match(characterFolderService, /function unwrapMetadataValue/);
  assert.match(characterFolderService, /readMetadataFromSupabase\(CHARACTER_FOLDER_ROOT_META\.type, CHARACTER_FOLDER_ROOT_META\.key\)/);
  assert.match(characterFolderService, /window\.electronAPI\.pathCreateFolder\(root, character\.name\)/);
  assert.match(characterFolderService, /updateCharacterFolder\(character\.id, result\.path\)/);

  assert.match(characterFolderRootSection, /readCharacterWorkFolderRoot/);
  assert.match(characterFolderRootSection, /saveCharacterWorkFolderRoot/);
  assert.match(characterFolderRootSection, /chooseFolderPath/);
  assert.match(settingsView, /CharacterFolderRootSection/);

  assert.match(characterStore, /updateCharacterFolder: \(id: string, workFolderPath: string \| null\) => Promise<boolean>/);
  assert.match(characterStore, /applyCharacterUpdate\(set, get, id, \{ workFolderPath \}, \{ work_folder_path: workFolderPath \}/);
  assert.match(characterStore, /await svcUpdateCharacter\(id, dbUpdates\)/);
  assert.match(characterDetailModalSource, /createAndLinkCharacterFolder/);
  assert.match(characterDetailModalSource, /const \[creatingFolder, setCreatingFolder\]/);
  assert.match(characterDetailModalSource, /onCreateFolder=\{handleCreateFolder\}/);
  assert.match(costumeDetailSource, /title="기준 경로에 캐릭터 이름으로 폴더를 만들어 연결"/);
  assert.match(costumeDetailSource, /!path && onCreate/);
});

test('character card right click opens the compact work menu instead of opening a folder immediately', () => {
  assert.match(characterBoard, /const \[cardMenu, setCardMenu\]/);
  assert.match(characterBoard, /setCardMenu\(\{ characterId, x: event\.clientX, y: event\.clientY, costumeId \}\)/);
  assert.doesNotMatch(characterBoard, /if \(c\.workFolderPath\) void openStoredPath\(c\.workFolderPath, '작업 폴더'\)/);
  assert.match(characterBoard, /variant="card"/);
  assert.match(characterBoard, /imageCostume=\{cardMenuFeatured\}/);
  assert.match(characterBoard, /fileCostume=\{cardMenuFileCostume\}/);

  assert.match(imageContextMenuSource, /variant\?: 'full' \| 'card'/);
  assert.match(imageContextMenuSource, /variant === 'card'/);
  assert.match(imageContextMenuSource, /copyCharacterImage\(imageCostume\?\.featuredImageUrl\)/);
  assert.match(imageContextMenuSource, /openStoredCharacterPath\(character\.workFolderPath, '작업 폴더'\)/);
  assert.ok(
    imageContextMenuSource.indexOf('label="작업 폴더 열기"') <
      imageContextMenuSource.indexOf('label="작업 파일 열기"'),
  );
  assert.ok(
    imageContextMenuSource.indexOf('label="작업 파일 열기"') <
      imageContextMenuSource.indexOf('label="이미지 복사"'),
  );
});

test('spotlight opens character board entries through a store-backed pending request', () => {
  assert.match(appStore, /pendingCharacterBoardRequest:\s*\{ characterId: string \} \| null/);
  assert.match(appStore, /setPendingCharacterBoardRequest:\s*\(req: AppState\['pendingCharacterBoardRequest'\]\) => void/);
  assert.match(appStore, /pendingCharacterBoardRequest:\s*null/);
  assert.match(appStore, /pendingCharacterBoardRequest:\s*null,\r?\n\s*highlightSceneId:\s*null/);

  assert.match(characterStore, /load:\s*\(opts\?: \{ silent\?: boolean \}\) => Promise<void>/);
  assert.match(characterStore, /load:\s*async\s*\(opts\)\s*=>/);
  assert.match(characterStore, /if \(!opts\?\.silent\) toast\.error\('캐릭터 현황판을 불러오지 못했어요'\)/);

  assert.match(spotlight, /type ResultCategory = 'scene' \| 'assignee' \| 'character'/);
  assert.match(spotlight, /useCharacterBoardAccess\(\)/);
  // 오픈당 1회만 로드 시도 — 실패 시 열려 있는 동안 무한 재시도 금지 (C-1).
  assert.match(spotlight, /if \(!isOpen\) \{ characterLoadAttemptedRef\.current = false; return; \}/);
  assert.match(spotlight, /if \(!hasCharacterBoardAccess \|\| characterBoardLoaded \|\| characterBoardLoading\) return;/);
  assert.match(spotlight, /if \(characterLoadAttemptedRef\.current\) return;/);
  assert.match(spotlight, /void loadCharacterBoard\(\{ silent: true \}\)/);
  assert.match(spotlight, /CATEGORY_ORDER[\s\S]*'character'/);
  assert.match(spotlight, /character\.status === 'archived'/);
  assert.match(spotlight, /fuzzyScore\(q, tag\) \* 0\.8/);
  assert.match(spotlight, /setPendingCharacterBoardRequest\(\{ characterId: character\.id \}\)/);
  assert.match(spotlight, /placeholder=\{hasCharacterBoardAccess \? '씬번호, 담당자, 캐릭터, 에피소드 검색\.\.\.'/);

  assert.match(characterBoard, /pendingCharacterBoardRequest/);
  assert.match(characterBoard, /if \(!pendingCharacterBoardRequest \|\| !loaded\) return;/);
  assert.match(characterBoard, /setPendingOpenId\(pendingCharacterBoardRequest\.characterId\)/);
  assert.match(characterBoard, /setPendingCharacterBoardRequest\(null\)/);
  assert.ok(characterBoard.includes('key={`${detailCharacter.id}:${detailRequest.nonce}`}'));
});

test('my tasks widget includes assigned character design and rigging work', () => {
  assert.match(characterStageConstants, /export const DESIGN_STAGE_META/);
  assert.match(characterStageConstants, /export const RIGGING_STAGE_META/);
  assert.match(characterStageConstants, /export function characterStageColor/);
  assert.match(characterStageMeta, /export function parseAssigneeNames/);
  assert.match(assigneeNamePickerSource, /import \{ parseAssigneeNames \} from '@\/utils\/characterStageMeta'/);
  assert.match(characterCardSource, /import \{ DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor/);
  assert.match(myCharacterTasks, /characterStageColor\(meta\)/);

  assert.match(characterStore, /ensureLoadedAndRealtime: \(opts\?: \{ silent\?: boolean \}\) => \(\) => void/);
  assert.match(characterStore, /let characterBoardRealtimeRefCount = 0/);
  assert.match(characterStore, /if \(!state\.loaded && !state\.loading\)[\s\S]*?void state\.load\(opts\)/);
  assert.match(characterStore, /stopCharacterBoardRealtime\?\.\(\)/);

  assert.match(myCharacterTasks, /useCharacterBoardAccess\(\)/);
  assert.match(myCharacterTasks, /if \(!hasCharacterBoardAccess \|\| !currentUser\) return;/);
  assert.match(myCharacterTasks, /ensureLoadedAndRealtime\(\{ silent: true \}\)/);
  assert.match(myCharacterTasks, /character\.status !== 'archived'/);
  assert.ok(myCharacterTasks.includes('parseAssigneeNames(costume.designAssignee).some((name) => name === userName)'));
  assert.ok(myCharacterTasks.includes('parseAssigneeNames(costume.riggingAssignee).some((name) => name === userName)'));
  assert.match(myCharacterTasks, /key: `char:\$\{costume\.id\}:design`/);
  assert.match(myCharacterTasks, /key: `char:\$\{costume\.id\}:rigging`/);

  assert.match(myTasksData, /useMyCharacterTasks\(\)/);
  assert.match(myTasksData, /\[\.\.\.pendingCharacterTasks, \.\.\.doneCharacterTasks\]/);
  assert.match(myTaskStats, /characterTotal = characterTasks\.length/);
  assert.match(myTaskStats, /doneCharacterCount = characterTasks\.reduce/);
  assert.match(myTaskStats, /const total = sceneTotal \+ personalTotal \+ characterTotal/);

  assert.match(myTasksWidget, /pendingScenes\.length \+ pendingPersonalTodos\.length \+ pendingCharacterTasks\.length/);
  assert.match(myTasksWidget, /doneScenes\.length \+ donePersonalTodos\.length \+ doneCharacterTasks\.length/);
  assert.match(myTasksWidget, /setPendingCharacterBoardRequest\(\{ characterId: task\.characterId \}\)/);
  assert.match(myTasksWidget, /setView\('character-board'\)/);
  assert.match(myTasksWidget, /renderCharacterTasks\(pendingCharacterTasks\)/);
  assert.match(myTasksWidget, /renderCharacterTasks\(doneCharacterTasks\)/);
  assert.match(characterTaskRow, /캐릭터 현황판에서 열기/);
});

test('character board cards, rows, and costume thumbs are memoized with stable callbacks', () => {
  // CQ-6 2단계: memo 래핑 (store 의 rebuildByCharacter 구조적 공유가 전제).
  assert.match(characterCardSource, /const CharacterCard = memo\(function CharacterCard\(/);
  assert.match(characterDetailModalSource, /const CharacterListRow = memo\(function CharacterListRow\(/);
  assert.match(characterDetailModalSource, /const CostumeThumbCard = memo\(function CostumeThumbCard\(/);
  // memo 실효 조건: map 안 항목별 인라인 클로저 대신 id 인자 안정 콜백 + 빈 배열 안정 참조.
  assert.match(characterCardSource, /const EMPTY_COSTUMES: CharacterCostume\[\] = \[\]/);
  assert.match(characterBoard, /costumes=\{byCharacter\.get\(c\.id\) \?\? EMPTY_COSTUMES\}/);
  assert.match(characterDetailModalSource, /costumes=\{byCharacter\.get\(c\.id\) \?\? EMPTY_COSTUMES\}/);
  assert.doesNotMatch(characterBoardAll, /byCharacter\.get\(c\.id\) \?\? \[\]\}/);
  assert.match(characterBoard, /onOpen=\{openCharacterDetail\}/);
  assert.match(characterBoard, /onContextMenu=\{openCardContextMenu\}/);
  assert.match(characterDetailModalSource, /onSelect=\{setSelectedId\}/);
  assert.match(characterDetailModalSource, /onSelect=\{setActiveCostumeId\}/);
  assert.match(characterDetailModalSource, /onDelete=\{deleteCostume\}/);
  assert.match(characterDetailModalSource, /onImageContextMenu=\{openCostumeImageMenu\}/);
});

test('character board motion sticks to transform/opacity, 200ms ease-out, and reduce guards', () => {
  // MO-11/F-2: transition-all·width 트랜지션 금지 — 실제 바뀌는 속성만 애니메이션.
  assert.doesNotMatch(characterBoardAll, /transition-all/);
  assert.doesNotMatch(characterBoardAll, /transition-\[width\]/);
  assert.match(tagChipsSource, /transition-colors duration-200 ease-out/);
  assert.match(stageRailSource, /transition-\[background-color,border-color,box-shadow\] duration-200 ease-out/);
  // 목록 행 진행바 — width 대신 transform(scaleX + origin-left) 채움.
  assert.match(characterDetailModalSource, /origin-left transition-transform duration-200 ease-out/);
  assert.match(characterDetailModalSource, /scaleX\(\$\{ratio\}\)/);
  // 상세 모달·라이트박스 진입 모션 + motion-reduce 가드. exit 모션 없음.
  assert.match(indexCss, /@keyframes char-overlay-in/);
  assert.match(indexCss, /@keyframes char-modal-in/);
  assert.match(characterDetailModalSource, /animate-\[char-overlay-in_200ms_ease-out\] motion-reduce:animate-none/);
  assert.match(characterDetailModalSource, /animate-\[char-modal-in_200ms_ease-out\] motion-reduce:animate-none/);
  assert.match(characterImageLightbox, /animate-\[char-overlay-in_200ms_ease-out\] motion-reduce:animate-none/);
  assert.match(characterImageLightbox, /animate-\[char-modal-in_200ms_ease-out\] motion-reduce:animate-none/);
});

test('sidebar keeps the character menu reachable for retry when the access lookup fails', () => {
  // GAP-H/I-A5: error 시 숨김 대신 흐림 + 경고 점 + floating 툴팁 + 클릭=retry. 정상 차단·로딩은 기존대로 숨김.
  assert.match(sidebarSource, /useCharacterBoardAccessState/);
  assert.doesNotMatch(sidebarSource, /useCharacterBoardAccess\(\)/);
  assert.match(sidebarSource, /characterAccess\.error && !characterAccess\.allowed/);
  assert.match(sidebarSource, /item\.id !== 'character-board' \|\| characterAccess\.allowed \|\| characterAccessFailed/);
  assert.match(sidebarSource, /characterAccess\.retry\(\)/);
  assert.match(sidebarSource, /CharacterAccessRetryTip/);
  assert.match(sidebarSource, /권한 정보를 확인하지 못했어요 — 클릭해서 다시 확인/);
  // native title 금지 — 실패 상태에서는 title 을 비우고 floating 툴팁만 쓴다.
  assert.match(sidebarSource, /title=\{isAccessRetryItem \|\| isVisuallyExpanded \? undefined : item\.label\}/);
  // 경고 점 색은 하드코딩 hex 대신 캐릭터 경고 토큰.
  assert.match(sidebarSource, /rgb\(var\(--char-stage-feedback\)\)/);
});

test('character board safety and accessibility interactions use app-native guards', () => {
  assert.doesNotMatch(characterBoardAll, /window\.confirm/);
  assert.doesNotMatch(episodeAssetBoard, /window\.confirm/);
  assert.match(featuredImageSlotSource, /ConfirmDialog\.show/);
  assert.match(characterDetailModalSource, /ConfirmDialog\.show/);
  assert.match(episodeAssetBoard, /ConfirmDialog\.show/);
  assert.match(confirmDialog, /window\.addEventListener\('keydown', onKey, \{ capture: true \}\)/);
  assert.match(confirmDialog, /stopImmediatePropagation/);

  assert.match(characterStore, /archiveCharacter: \(id: string\) => Promise<void>/);
  assert.match(characterStore, /restoreCharacter: \(id: string\) => Promise<void>/);
  assert.match(characterStore, /status: 'archived'/);
  assert.match(characterStore, /status: 'active'/);
  assert.match(characterDetailModalSource, /보관 목록에서 다시 복원/);
  assert.match(characterBoard, /보관 \{archivedCharacters\.length\}/);
  assert.match(characterDetailModalSource, /영구 삭제/);

  assert.match(modalFocusHook, /FOCUSABLE_SELECTOR/);
  assert.match(characterDetailModalSource, /useModalFocus/);
  assert.match(addCharacterModalSource, /useModalFocus/);
  assert.match(characterDetailModalSource, /role="dialog"/);
  assert.match(addCharacterModalSource, /role="dialog"/);
  assert.match(characterDetailModalSource, /aria-modal="true"/);
  assert.match(addCharacterModalSource, /aria-modal="true"/);
  assert.match(characterDetailModalSource, /event\.target === event\.currentTarget/);
  assert.match(addCharacterModalSource, /event\.target === event\.currentTarget/);
  assert.match(featuredImageSlotSource, /claimReactKey\(e\)/);
  assert.match(characterDetailModalSource, /claimReactKey\(e\)/);
  assert.match(characterImageLightbox, /window\.addEventListener\('keydown', onKey, \{ capture: true \}\)/);
  assert.match(characterImageLightbox, /stopImmediatePropagation/);
  assert.match(imageContextMenuSource, /window\.addEventListener\('keydown', onKey, \{ capture: true \}\)/);
  assert.match(imageContextMenuSource, /window\.addEventListener\('wheel', close/);
  assert.match(imageContextMenuSource, /role="menu"/);
  assert.match(imageContextMenuSource, /canSetBackground/);

  assert.match(costumeDetailSource, /VersionNumberInput/);
  assert.match(costumeDetailSource, /onBlur=\{commit\}/);
  assert.match(costumeDetailSource, /h-8 w-8 rounded-md/);
  assert.match(characterDetailModalSource, /group-focus-within:opacity-100/);
  assert.match(characterDetailModalSource, /에피소드 연결을 해제했어요/);
  assert.match(featuredImageSlotSource, /이미지 놓기/);
  assert.match(featuredImageSlotSource, /window\.addEventListener\('paste', onPaste\)/);
  assert.match(fitEditorSource, /focus-visible:ring-2 focus-visible:ring-accent\/70/);
});

test('character board visual tokens support light mode and consistent layers', () => {
  assert.match(indexCss, /--char-stage-progress: 116 185 255/);
  assert.match(indexCss, /\[data-color-mode="light"\][\s\S]*--char-stage-progress: 46 134 222/);
  assert.match(themeSource, /const mode = colorMode \?\? 'dark'/);
  assert.match(themeSource, /root\.classList\.toggle\('dark', mode === 'dark'\)/);
  assert.match(themeSource, /root\.style\.colorScheme = mode/);
  assert.match(indexHtml, /#root \{[\s\S]*background: rgb\(var\(--color-bg-primary, 15 17 23\)\)/);
  assert.match(characterStageConstants, /cssVar: '--char-stage-complete'/);
  assert.match(characterCardSource, /characterStageColor\(DESIGN_STAGE_META\.done/);
  assert.match(characterCardSource, /characterStageColor\(RIGGING_STAGE_META\.done/);
  assert.match(episodeAssetBoard, /import \{ RIGGING_STAGE_META, characterStageColor \} from '@\/constants\/characterStages'/);
  assert.match(episodeAssetBoard, /characterStageColor\(RIGGING_STAGE_META\[rigging\]\)/);
  assert.doesNotMatch(characterBoardAll, /#A29BFE22|#00B89422|#FF6B6B/);
  assert.doesNotMatch(episodeAssetBoard, /#8B8DA3|#74B9FF|#6C5CE7|#FDCB6E|#00B894|#FF6B6B/);

  assert.match(characterLayerConstants, /modal: 'z-50'/);
  assert.match(characterDetailModalSource, /CHARACTER_LAYER_CLASS\.modal/);
  assert.match(addCharacterModalSource, /CHARACTER_LAYER_CLASS\.modal/);
  assert.match(imageContextMenuSource, /CHARACTER_LAYER_CLASS\.menu/);
  assert.match(fitEditorSource, /CHARACTER_LAYER_CLASS\.editor/);
  assert.match(characterImageLightbox, /CHARACTER_LAYER_CLASS\.lightbox/);

  assert.match(fitEditorSource, /rgba\(0,0,0,0\.72\)/);
  assert.match(fitEditorSource, /rgba\(255,255,255,0\.78\)/);
  assert.match(characterDetailModalSource, /목록 검색/);
  assert.match(characterBoard, /검색·필터 초기화/);
  assert.match(characterBoard, /motion-reduce:animate-none/);
});

test('global button label wrapping is prevented while multiline button content stays available', () => {
  assert.match(indexCss, /button\s*\{\s*white-space:\s*nowrap;\s*\}/);
  assert.match(indexCss, /button \[class\*="line-clamp-"\],\s*\n\s*button p\s*\{\s*white-space:\s*normal;\s*\}/);
  assert.match(featuredImageSlotSource, /whitespace-nowrap/);
});

test('character image lightbox shows costume versions and a bottom costume thumbnail strip', () => {
  const displayFrame = characterImageLightbox.match(/<CharacterImageFrame\s+url=\{current\.url\}[\s\S]*?\/>/);
  assert.ok(displayFrame, 'lightbox display frame should render the current image');
  assert.doesNotMatch(displayFrame[0], /fit=\{current\.fit\}/);
  assert.match(displayFrame[0], /\beager\b/);
  assert.match(characterImageLightbox, /<CharacterImageFitEditor[\s\S]*?fit=\{current\.fit\}/);
  assert.match(characterImageLightbox, /versionNo:\s*number/);
  assert.match(characterDetailModalSource, /versionNo:\s*c\.versionNo/);
  assert.match(characterImageLightbox, /복장 버전/);
  assert.match(characterImageLightbox, /v\{current\.versionNo\}/);
  assert.match(characterImageLightbox, /aria-label="복장 썸네일 목록"/);
  // 스트립 썸네일은 fit 저작 비율(3:4) 프레임이어야 편집기 구도가 재현된다 (R2/T1).
  const stripFrame = characterImageLightbox.match(/<CharacterImageFrame\s+url=\{entry\.url\}[\s\S]*?\/>/);
  assert.ok(stripFrame, 'lightbox strip frame should render entry thumbnails');
  assert.match(stripFrame[0], /fit=\{entry\.fit\}/);
  assert.match(stripFrame[0], /aspect-\[3\/4\]/);
  assert.match(characterImageLightbox, /aria-label="이전 복장 썸네일"/);
  assert.match(characterImageLightbox, /aria-label="다음 복장 썸네일"/);
  assert.match(characterImageLightbox, /entry\.versionNo/);
  assert.match(characterImageLightbox, /setIndex\(entryIndex\)/);
  assert.match(imageFrameSource, /loading=\{eager \? 'eager' : 'lazy'\}/);
  assert.match(imageFrameSource, /decoding=\{eager \? 'auto' : 'async'\}/);
});

test('episode reel controls are available in episode assets, character board, and scenes view', () => {
  assert.match(episodeAssetBoard, /릴 파일/);
  assert.match(characterDetailModalSource, /릴 파일 보기/);
  assert.match(scenesView, /EpisodeReelButton/);
  assert.match(scenesView, /릴 보기/);
  assert.match(characterDetailModalSource, /openOrRegisterEpisodeReel/);
  assert.match(episodeAssetBoard, /openOrRegisterEpisodeReel/);
  assert.match(episodeReelActionsSource, /chooseWorkFile/);
  assert.match(episodeReelActionsSource, /openWorkPath/);
  assert.match(episodeReelActionsSource, /updateEpisodeReelPath/);
  assert.match(characterDetailModalSource, /useDataStore\.getState\(\)\.episodes/);
  assert.match(episodeAssetBoard, /useDataStore\.getState\(\)\.episodes/);
  assert.match(scenesView, /useDataStore\.getState\(\)\.episodes/);
});

test('character costume tags support palette toggles, custom input, store updates, and Supabase persistence', () => {
  assert.match(tagChipsSource, /const extra = tags\.filter\(\(t\) => !palette\.includes\(t\)\)/);
  assert.match(tagChipsSource, /return \[\.\.\.palette, \.\.\.extra\];/);
  assert.match(tagChipsSource, /if \(tags\.includes\(tag\)\) onChange\(tags\.filter\(\(t\) => t !== tag\)\);/);
  assert.match(tagChipsSource, /else onChange\(\[\.\.\.tags, tag\]\);/);
  assert.match(tagChipsSource, /const t = input\.trim\(\);/);
  assert.match(tagChipsSource, /if \(!t \|\| tags\.includes\(t\)\) \{ setInput\(''\); return; \}/);
  assert.match(tagChipsSource, /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\)/);
  assert.match(tagChipsSource, /onBlur=\{addCustom\}/);
  assert.match(characterStore, /setCostumeTags:\s*async\s*\(id,\s*kind,\s*tags\)\s*=>/);
  assert.match(characterStore, /kind === 'structure' \? \{ structureTags: tags \} : \{ assetTags: tags \}/);
  assert.match(rendererSupabase, /snake\.structure_tags = updates\.structureTags/);
  assert.match(rendererSupabase, /snake\.asset_tags = updates\.assetTags/);
  assert.match(electronSupabase, /structure_tags: string\[\];/);
  assert.match(electronSupabase, /asset_tags: string\[\];/);
  assert.match(electronSupabase, /\.from\('character_costumes'\)[\s\S]*?\.update\(\{ \.\.\.updates, updated_at:/);
});

test('character image fit editor keeps a fixed crop frame and moves/scales the image inside it', () => {
  assert.match(devMock, /MOCK_CHARACTER_IMAGE_URL = '\/splash\/opening_image_cropped\.png'/);
  assert.match(fitEditorSource, /function nextFitFromDrag/);
  assert.match(fitEditorSource, /onPointerDown=\{beginInteraction\}/);
  assert.match(fitEditorSource, /filter: 'blur\(10px\) saturate\(0\.8\) brightness\(0\.58\)'/);
  assert.match(fitEditorSource, /backdrop-blur-\[5px\]/);
  assert.match(fitEditorSource, /ref=\{cropFrameRef\}/);
  assert.match(fitEditorSource, /setDraft\(nextFitFromDrag/);
  assert.match(fitEditorSource, /type="range"/);
  assert.match(fitEditorSource, /aria-label="확대"/);
  assert.match(fitEditorSource, /aria-label="가로 위치"/);
  assert.match(fitEditorSource, /aria-label="세로 위치"/);
  assert.match(fitEditorSource, /aria-pressed=\{draft\.lockAspect\}/);
  assert.match(fitEditorSource, /getCharacterImageFitTransformStyle\(draft\)/);
  assert.match(fitEditorSource, /resolveCharacterImageFitScales\(draft\)/);
  assert.doesNotMatch(fitEditorSource, /function getFitImageTransformStyle/);
  assert.match(fitEditorSource, /object-contain/);
  assert.doesNotMatch(fitEditorSource, /data-fit-handle/);
  assert.doesNotMatch(fitEditorSource, /HANDLE_META/);
  assert.doesNotMatch(fitEditorSource, /function resizeImageBox/);
  assert.doesNotMatch(fitEditorSource, /function imageBoxToFit/);
  assert.doesNotMatch(fitEditorSource, /function fitToImageBox/);
  assert.doesNotMatch(fitEditorSource, /object-fill/);
  assert.doesNotMatch(fitEditorSource, /startBox/);
});

test('character board hardening covers image failures, drafts, realtime races, and access gate states', () => {
  assert.match(imageFrameSource, /const \[failed, setFailed\] = useState\(false\)/);
  assert.match(imageFrameSource, /function withRetryNonce/);
  assert.match(imageFrameSource, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(imageFrameSource, /이미지를 불러오지 못했어요/);
  assert.match(imageFrameSource, /클릭해서 다시 시도/);

  assert.match(featuredImageSlotSource, /const costumeMemoDraftCache = new Map<string, string>\(\)/);
  assert.match(featuredImageSlotSource, /function CostumeMemoInput\(\{[\s\S]*?draftKey/);
  assert.match(featuredImageSlotSource, /focused\.current && latestDraft !== valueRef\.current/);
  assert.match(featuredImageSlotSource, /costumeMemoDraftCache\.get\(draftKey\) === next[\s\S]*?costumeMemoDraftCache\.delete\(draftKey\)/);
  assert.match(featuredImageSlotSource, /onBlur=\{commit\}/);
  assert.match(featuredImageSlotSource, /key=\{costume\.id\}/);

  assert.match(characterStore, /const pendingCharacterFields = new Map/);
  assert.match(characterStore, /const pendingCostumeFields = new Map/);
  assert.match(characterStore, /const pendingEpisodeLinkFields = new Map/);
  assert.match(characterStoreHelpers, /function mergeIncomingWithPending/);
  assert.match(characterStore, /const merged = mergeIncomingWithPending\(pendingCharacterFields[\s\S]*?return \{ \.\.\.merged, episodeIds: withEpisodes\.episodeIds \}/);
  assert.match(characterStore, /trackPendingFields\(pendingCharacterFields, id, updates as Record<string, unknown>\)/);
  assert.match(characterStore, /trackPendingFields\(pendingCostumeFields, id, updates as Record<string, unknown>\)/);
  assert.match(characterStore, /trackPendingEpisodeLinkField\(characterId, episodeNumber, 'memo', memo\)/);
  assert.match(characterStore, /trackPendingEpisodeLinkField\(characterId, episodeNumber, 'costumeId', costumeId\)/);
  assert.match(characterStore, /mergeEpisodeLinkPatchWithPending/);
  assert.match(characterStore, /window\.electronAPI\?\.onSupabaseStatus/);
  assert.match(characterStore, /window\.addEventListener\('online', catchUp\)/);
  assert.match(electronSupabase, /status === 'CLOSED' \|\| status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT'/);

  assert.match(characterStoreHelpers, /function compareCharacters/);
  assert.match(characterStoreHelpers, /function compareCostumes/);
  assert.match(characterStoreHelpers, /function sortCharacters/);
  assert.match(characterStoreHelpers, /function sortCostumes/);
  assert.match(characterStoreHelpers, /sortOrder - b\.sortOrder[\s\S]*?compareNullableText\(a\.createdAt, b\.createdAt\)/);

  assert.match(accessHookSource, /export interface CharacterBoardAccessState/);
  assert.match(accessHookSource, /export function useCharacterBoardAccessState/);
  assert.match(accessHookSource, /loading: boolean/);
  assert.match(accessHookSource, /error: boolean/);
  assert.match(accessHookSource, /retry: \(\) => void/);
  assert.match(accessHookSource, /export function useCharacterBoardAccess\(\): boolean/);
  assert.match(appSource, /CharacterBoardAccessFallback/);
  assert.match(appSource, /권한 정보를 확인하지 못했어요/);
  assert.match(appSource, /다시 확인/);
  assert.match(appSource, /useCharacterBoardAccessState/);
  assert.doesNotMatch(appSource, /hasCharacterBoardAccess \? <CharacterBoardView \/> : <Dashboard \/>/);

  assert.match(characterDetailModalSource, /실제 원본 작업 파일은 삭제하지 않아요/);
  assert.match(characterDetailModalSource, /실제 작업 폴더와 원본 작업 파일은 삭제하지 않아요/);
});
