import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getParentFolderPath,
  getResolvedCharacterFolderAfterFilePick,
  normalizeCharacterImageFit,
} from '../src/utils/characterAssets.ts';

const typeSource = readFileSync('src/types/index.ts', 'utf8');
const rendererSupabase = readFileSync('src/services/supabaseService.ts', 'utf8');
const electronSupabase = readFileSync('electron/supabase.ts', 'utf8');
const characterBoard = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const characterStore = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
const episodeAssetBoard = readFileSync('src/views/EpisodeAssetBoard.tsx', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const characterImageLightbox = readFileSync('src/components/characters/CharacterImageLightbox.tsx', 'utf8');
const fitEditorSource = readFileSync('src/components/characters/CharacterImageFitEditor.tsx', 'utf8');
const devMock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
const migration = readFileSync('DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql', 'utf8');

test('character asset helpers derive parent folder and preserve existing character folder', () => {
  assert.equal(
    getParentFolderPath('G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\찜질방 사장 캐릭터\\main.moho'),
    'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\찜질방 사장 캐릭터',
  );
  assert.equal(
    getResolvedCharacterFolderAfterFilePick('', 'G:\\show\\char\\main.moho'),
    'G:\\show\\char',
  );
  assert.equal(
    getResolvedCharacterFolderAfterFilePick('G:\\show\\custom-folder', 'G:\\show\\char\\main.moho'),
    'G:\\show\\custom-folder',
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
    'setModalOpen',
    'placeholder="이름 입력"',
    'const shownCostume = activeCostume;',
    '디자인 담당자',
    '리깅 담당자',
    '작업 폴더',
    '작업 파일',
    '이미지 복사',
  ]) {
    assert.match(characterBoard, new RegExp(token), `CharacterBoardView missing ${token}`);
  }
  assert.doesNotMatch(characterBoard, /fallbackCostume/);
  assert.ok(characterBoard.includes("isPng ? 'image/png' : 'image/jpeg'"));
  assert.ok(characterBoard.includes('const saved = await updateCostumeField(targetCostume.id, { workFilePath: filePath });'));
  assert.ok(characterBoard.includes('if (!saved) return;'));
  assert.ok(characterBoard.includes('useCharacterBoardStore.getState().characters.find'));
  assert.match(readFileSync('src/components/characters/CharacterImageFrame.tsx', 'utf8'), /translate\(\$\{normalized\.x\}%, \$\{normalized\.y\}%\)/);
  assert.match(fitEditorSource, /stopImmediatePropagation/);
  assert.match(fitEditorSource, /data-fit-handle/);
  assert.match(fitEditorSource, /cropFrameRef/);
  assert.match(characterImageLightbox, /initialCostumeIdRef/);
  assert.match(characterImageLightbox, /currentCostumeId/);
  assert.match(characterImageLightbox, /findIndex\(\(entry\) => entry\.costumeId === currentCostumeId\)/);
  assert.doesNotMatch(characterImageLightbox, /setIndex\(initialIndex\)/);
  assert.match(characterStore, /Promise<boolean>/);
  assert.match(characterStore, /return true;/);
  assert.match(characterStore, /return false;/);
  assert.match(characterBoard, /\/\* 단계 레일 \+ 담당자 \*\//);
  assert.doesNotMatch(characterBoard, /\/\* 버전 \+ 담당자 \*\//);
  assert.ok(
    characterBoard.indexOf('label="디자인 단계"') < characterBoard.indexOf('label="디자인 담당자"'),
    'design assignee should live with the design stage lane, not the version controls',
  );
  assert.ok(
    characterBoard.indexOf('label="리깅 단계"') < characterBoard.indexOf('label="리깅 담당자"'),
    'rigging assignee should live with the rigging stage lane, not the version controls',
  );
});

test('episode reel controls are available in episode assets, character board, and scenes view', () => {
  assert.match(episodeAssetBoard, /릴 파일/);
  assert.match(characterBoard, /릴 파일 보기/);
  assert.match(scenesView, /EpisodeReelButton/);
  assert.match(scenesView, /릴 보기/);
  assert.match(characterBoard, /useDataStore\.getState\(\)\.episodes/);
  assert.match(episodeAssetBoard, /useDataStore\.getState\(\)\.episodes/);
  assert.match(scenesView, /useDataStore\.getState\(\)\.episodes/);
});

test('character costume tags support palette toggles, custom input, store updates, and Supabase persistence', () => {
  assert.match(characterBoard, /const extra = tags\.filter\(\(t\) => !palette\.includes\(t\)\)/);
  assert.match(characterBoard, /return \[\.\.\.palette, \.\.\.extra\];/);
  assert.match(characterBoard, /if \(tags\.includes\(tag\)\) onChange\(tags\.filter\(\(t\) => t !== tag\)\);/);
  assert.match(characterBoard, /else onChange\(\[\.\.\.tags, tag\]\);/);
  assert.match(characterBoard, /const t = input\.trim\(\);/);
  assert.match(characterBoard, /if \(!t \|\| tags\.includes\(t\)\) \{ setInput\(''\); return; \}/);
  assert.match(characterBoard, /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\)/);
  assert.match(characterBoard, /onBlur=\{addCustom\}/);
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
  assert.match(fitEditorSource, /handle === 'move'/);
  assert.match(fitEditorSource, /beginInteraction\('move', event\)/);
  assert.match(fitEditorSource, /filter: 'blur\(5px\) brightness\(0\.62\)'/);
  assert.match(fitEditorSource, /backdrop-blur-\[3px\]/);
  assert.match(fitEditorSource, /ref=\{cropFrameRef\}/);
  assert.match(fitEditorSource, /data-fit-handle/);
  assert.match(fitEditorSource, /setDraft\(nextFitFromDrag/);
  assert.doesNotMatch(fitEditorSource, /function resizeImageBox/);
  assert.doesNotMatch(fitEditorSource, /function imageBoxToFit/);
  assert.doesNotMatch(fitEditorSource, /startBox/);
});
