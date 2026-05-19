import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLatestVersion, nextVersionNo, canDeleteVersion, generateImageFileName } from '../src/utils/imageVersionUtils.ts';

type V = {
  id: string;
  sceneId: string;
  imageType: 'storyboard' | 'guide';
  versionNo: number;
  url: string;
  kind: 'replace' | 'annotate';
  baseVersionNo: number | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
};

function v(no: number, kind: 'replace' | 'annotate', createdBy: string = 'u1'): V {
  return {
    id: 'iv-' + no, sceneId: 's1', imageType: 'storyboard',
    versionNo: no, url: 'https://...' + no, kind,
    baseVersionNo: kind === 'annotate' ? no - 1 : null,
    createdBy, createdByName: createdBy === 'u1' ? '한솔' : '박정인',
    createdAt: '2026-05-15T10:00:00Z',
  };
}

test('pickLatestVersion: 최대 version_no 반환', () => {
  const versions = [v(1, 'replace'), v(2, 'replace'), v(3, 'annotate')];
  assert.equal(pickLatestVersion(versions)?.versionNo, 3);
});

test('pickLatestVersion: 빈 배열 → null', () => {
  assert.equal(pickLatestVersion([]), null);
});

test('pickLatestVersion: 순서 무관 최대값', () => {
  const versions = [v(3, 'annotate'), v(1, 'replace'), v(2, 'replace')];
  assert.equal(pickLatestVersion(versions)?.versionNo, 3);
});

test('nextVersionNo: 다음 번호 = max + 1', () => {
  assert.equal(nextVersionNo([v(1, 'replace'), v(2, 'replace')]), 3);
  assert.equal(nextVersionNo([]), 1);
  assert.equal(nextVersionNo([v(5, 'replace')]), 6);
});

test('canDeleteVersion: 본인 = OK', () => {
  const ver = v(1, 'replace', 'u1');
  assert.equal(canDeleteVersion(ver, 'u1', false), true);
});

test('canDeleteVersion: 타인 + 일반 = X', () => {
  const ver = v(1, 'replace', 'u1');
  assert.equal(canDeleteVersion(ver, 'u2', false), false);
});

test('canDeleteVersion: 타인 + admin = OK', () => {
  const ver = v(1, 'replace', 'u1');
  assert.equal(canDeleteVersion(ver, 'u2', true), true);
});

test('canDeleteVersion: 마지막 1개는 삭제 불가 — onlyOne=true', () => {
  const ver = v(1, 'replace', 'u1');
  assert.equal(canDeleteVersion(ver, 'u1', false, true), false);
  assert.equal(canDeleteVersion(ver, 'u1', true, true), false);  // admin 도 불가
});

test('canDeleteVersion: 비로그인 = X', () => {
  const ver = v(1, 'replace', 'u1');
  assert.equal(canDeleteVersion(ver, null, false), false);
});

test('generateImageFileName: 파일명 규칙', () => {
  assert.equal(generateImageFileName('EP03_A_BG', 'a007', 'storyboard', 2), 'EP03_A_BG_a007_storyboard_v2.jpg');
  assert.equal(generateImageFileName('EP01_B_ACT', 'b015', 'guide', 1), 'EP01_B_ACT_b015_guide_v1.jpg');
});
