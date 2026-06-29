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
const episodeAssetBoard = readFileSync('src/views/EpisodeAssetBoard.tsx', 'utf8');
const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
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
  assert.deepEqual(normalizeCharacterImageFit({ scale: -4, x: 'bad', y: 12, lockAspect: false }), {
    scale: 0.25,
    scaleX: 0.25,
    scaleY: 0.25,
    x: 0,
    y: 12,
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

test('character board is wired for image display, assignees, work links, and lightbox navigation', () => {
  for (const token of [
    'CharacterImageFrame',
    'CharacterImageContextMenu',
    'CharacterImageFitEditor',
    'CharacterImageLightbox',
    'AssigneeMultiSelect',
    '디자인 담당자',
    '리깅 담당자',
    '작업 폴더',
    '작업 파일',
    '이미지 복사',
  ]) {
    assert.match(characterBoard, new RegExp(token), `CharacterBoardView missing ${token}`);
  }
});

test('episode reel controls are available in episode assets, character board, and scenes view', () => {
  assert.match(episodeAssetBoard, /릴 파일/);
  assert.match(characterBoard, /릴 파일 보기/);
  assert.match(scenesView, /EpisodeReelButton/);
  assert.match(scenesView, /릴 보기/);
});
