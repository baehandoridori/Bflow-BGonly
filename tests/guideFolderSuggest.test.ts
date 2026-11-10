// tests/guideFolderSuggest.test.ts — 가이드 그림 작업 폴더 제안의 순수 규칙(설계 4.2·4.3·4.4·4.6·5.2).
// 이름 예는 실제 공유 드라이브(241 싱크홀 대축제 d파트)에서 그대로 가져왔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSharedDrivePath, normalizeWinPath } from '../src/shared/sharedDrivePath.ts';
import {
  displayPathParts,
  findPartFolderName,
  folderSceneKeys,
  guideFolderMismatchText,
  guideFolderSourceLine,
  guideFolderTitle,
  matchSceneFolders,
  pickBackgroundRoot,
  pickClipFile,
  pickPartFolder,
  resolveFolderFromImagePath,
  samePath,
} from '../src/utils/guideFolderSuggest.ts';

import { isWorkLinkFlashFor } from '../src/utils/workLinkFlash.ts';

const D = 'G:\\공유 드라이브\\사우스 코리안 파크\\241_싱크홀 대축제\\배경_싱크홀';

test('isWorkLinkFlashFor: 같은 씬·부서·칸만', () => {
  const detail = { sceneUuid: 'u1', department: 'bg' as const, kinds: ['folder' as const] };
  assert.equal(isWorkLinkFlashFor(detail, 'u1', 'bg', 'folder'), true);
  assert.equal(isWorkLinkFlashFor(detail, 'u1', 'bg', 'primary_file'), false);
  assert.equal(isWorkLinkFlashFor(detail, 'u2', 'bg', 'folder'), false);
  assert.equal(isWorkLinkFlashFor(detail, 'u1', 'acting', 'folder'), false);
  assert.equal(isWorkLinkFlashFor(detail, null, 'bg', 'folder'), false);
});
const scene = (id: string) => ({ sceneId: id, partId: 'D' });

test('normalizeWinPath: 슬래시·연속 역슬래시·끝 역슬래시', () => {
  assert.equal(normalizeWinPath(' G:/공유 드라이브//a\\b\\ '), 'G:\\공유 드라이브\\a\\b');
  assert.equal(normalizeWinPath('G:\\'), 'G:\\');
});

test('isSharedDrivePath: 루트·대소문자·슬래시', () => {
  assert.equal(isSharedDrivePath(`${D}\\d파트\\d054\\d054가이드.png`), true);
  assert.equal(isSharedDrivePath('g:/공유 드라이브/사우스 코리안 파크/x.png'), true);
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\'), false);
  assert.equal(isSharedDrivePath('C:\\Users\\me\\Desktop\\d054가이드.png'), false);
  assert.equal(isSharedDrivePath('G:\\내 드라이브\\d054.png'), false);
  assert.equal(isSharedDrivePath(''), false);
});

test('isSharedDrivePath: . / .. 조각으로 공유 드라이브 밖을 가리키면 거절', () => {
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\..\\내 드라이브'), false);
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\사우스 코리안 파크\\..\\..\\Windows'), false);
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\.\\사우스 코리안 파크'), false);
  assert.equal(isSharedDrivePath('G:\\공유 드라이브\\사우스 코리안 파크\\d054..png'), true);
});

test('samePath: 끝 역슬래시·대소문자·슬래시 무시, 빈 값끼리는 다르다', () => {
  assert.equal(samePath(`${D}\\d파트\\d054\\`, `${D.toLowerCase()}/d파트/d054`), true);
  assert.equal(samePath(`${D}\\d파트\\d054`, `${D}\\d파트\\d055`), false);
  assert.equal(samePath('', ''), false);
  assert.equal(samePath(null, undefined), false);
});

test('folderSceneKeys: . 과 , 를 나눔표로, 이 씬 가족 글자 목록만', () => {
  assert.deepEqual(folderSceneKeys('d050.052', scene('d052')), ['50', '52']);
  assert.deepEqual(folderSceneKeys('d013,015', scene('d013')), ['13', '15']);
  assert.deepEqual(folderSceneKeys('d022.024a', scene('d024a')), ['22', '24A']);
  assert.deepEqual(folderSceneKeys('d020.025.045.048', scene('d045')), ['20', '25', '45', '48']);
  assert.deepEqual(folderSceneKeys('D054', scene('d054')), ['54']);
  assert.equal(folderSceneKeys('png', scene('d054')), null);
  assert.equal(folderSceneKeys('png_052', scene('d052')), null);
  assert.equal(folderSceneKeys('d파트', scene('d054')), null);
  assert.equal(folderSceneKeys('241_싱크홀 대축제', scene('d241')), null);
  assert.equal(folderSceneKeys('b060', scene('d060')), null);
});

test('resolveFolderFromImagePath: 바로 위 폴더, 번호 불일치 경고, 거슬러 오르기', () => {
  assert.deepEqual(
    resolveFolderFromImagePath(`${D}\\d파트\\d054\\d054가이드.png`, scene('d054')),
    { folder: `${D}\\d파트\\d054`, mismatch: false },
  );
  assert.deepEqual(
    resolveFolderFromImagePath(`${D}\\d파트\\d054\\d054가이드.png`, scene('d055')),
    { folder: `${D}\\d파트\\d054`, mismatch: true },
  );
  assert.deepEqual(
    resolveFolderFromImagePath(`${D}\\d파트\\d050.052\\png\\x.png`, scene('d052')),
    { folder: `${D}\\d파트\\d050.052`, mismatch: false },
  );
  assert.deepEqual(
    resolveFolderFromImagePath(`${D}\\d파트\\d050.052\\png_052\\x.png`, scene('d052')),
    { folder: `${D}\\d파트\\d050.052`, mismatch: false },
  );
  assert.equal(resolveFolderFromImagePath(`${D}\\d파트\\x.png`, scene('d054')), null);
  assert.equal(resolveFolderFromImagePath(`${D}\\디자인 및 래퍼런스\\a\\b\\x.png`, scene('d054')), null);
  assert.equal(resolveFolderFromImagePath('C:\\Users\\me\\d054\\x.png', scene('d054')), null);
});

test('pickPartFolder: 위 폴더가 {파트}파트 인 것만, 가장 많은 것', () => {
  const ok = (name: string) => `${D}\\d파트\\${name}`;
  assert.equal(pickPartFolder([ok('d054'), ok('d055'), `${D}\\b파트\\b003`], 'D'), `${D}\\d파트`);
  assert.equal(pickPartFolder([`${D}\\b파트\\b003`], 'D'), null);
  assert.equal(pickPartFolder([`${D}\\D파트\\d054`], 'd'), `${D}\\D파트`);
  assert.equal(pickPartFolder([], 'D'), null);
});

test('pickBackgroundRoot / findPartFolderName', () => {
  assert.equal(pickBackgroundRoot([`${D}\\b파트\\b048`, `${D}\\b파트\\b060`]), D);
  assert.equal(pickBackgroundRoot([`${D}\\프랍\\떨어지는구조물`]), null);
  assert.equal(findPartFolderName(['a파트', 'D파트', '프랍'], 'd'), 'D파트');
  assert.equal(findPartFolderName(['a파트', '프랍'], 'd'), null);
});

test('matchSceneFolders: 이 씬이 든 폴더, 이름에 든 씬 수 적은 순 → 이름순', () => {
  const names = ['d028.043.046', 'd043.046', 'd040', 'png', 'd022.024a', 'd021.024.029'];
  assert.deepEqual(matchSceneFolders(names, scene('d043')), ['d043.046', 'd028.043.046']);
  assert.deepEqual(matchSceneFolders(names, scene('d024')), ['d021.024.029']);
  assert.deepEqual(matchSceneFolders(names, scene('d024a')), ['d022.024a']);
  assert.deepEqual(matchSceneFolders(names, scene('d099')), []);
});

test('pickClipFile: 하나뿐 / 번호 맞는 것 딱 하나 / 그 밖 null', () => {
  assert.equal(pickClipFile(['d054.clip', 'd054.png', 'd054가이드.png'], scene('d054')), 'd054.clip');
  assert.equal(pickClipFile(['d050.clip', 'd052.clip', 'd052_가이드.png'], scene('d052')), 'd052.clip');
  assert.equal(pickClipFile(['전체가이드.clip', '전체.clip'], scene('d045')), null);
  assert.equal(pickClipFile(['D054.CLIP'], scene('d054')), 'D054.CLIP');
  assert.equal(pickClipFile([], scene('d054')), null);
});

test('displayPathParts: 루트를 빼고 마지막 폴더를 따로', () => {
  assert.deepEqual(displayPathParts(`${D}\\d파트\\d054`), {
    head: ['사우스 코리안 파크', '241_싱크홀 대축제', '배경_싱크홀', 'd파트'],
    leaf: 'd054',
  });
});

test('문구: 설계 5.2 그대로', () => {
  assert.equal(guideFolderTitle('new', false), '이 그림이 있는 폴더를 작업 폴더로 넣을까요?');
  assert.equal(guideFolderTitle('new', true), '이 씬의 작업 폴더를 찾았어요');
  assert.equal(guideFolderTitle('change', true), '작업 폴더를 이 폴더로 바꿀까요?');
  assert.equal(guideFolderSourceLine({ method: 'drop', fileName: 'd054가이드.png', guessed: false }), '끌어다 놓은 그림 · d054가이드.png');
  assert.equal(guideFolderSourceLine({ method: 'pick', fileName: 'a.png', guessed: false }), '고른 그림 · a.png');
  assert.equal(guideFolderSourceLine({ method: 'paste', fileName: null, guessed: true }), '붙여넣은 그림이라 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.');
  assert.equal(guideFolderSourceLine({ method: 'drop', fileName: null, guessed: true }), '끌어다 놓은 그림에 경로가 없어서, 같은 파트 다른 씬들을 보고 찾았어요.');
  assert.equal(guideFolderMismatchText('d055'), '폴더 이름에 이 씬 번호(d055)가 없어요. 같은 배경을 같이 쓰는 씬이면 그대로 넣어도 돼요.');
});
