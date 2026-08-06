/** 피드백 49 — bcostume 복장 태그: 직렬화/파싱/토큰화/후보 빌더 + 배선 앵커. */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeHashTag, parseHashTarget } from '../src/utils/hashEntity.ts';
import { tokenizeEntities } from '../src/utils/entityTokens.ts';
import { buildCostumeCandidates } from '../src/utils/hashtagCandidates.ts';

test('bcostume: serialize → parse round-trip', () => {
  const link = serializeHashTag({ kind: 'costume', label: '도윤 봄옷 v2', episodeNumber: 0, characterId: 'char-1', costumeId: 'cos-9', versionNo: 2 });
  assert.equal(link, '[#도윤 봄옷 v2](bcostume:char-1:cos-9:2)');
  const inner = link.slice(link.indexOf('(') + 1, link.lastIndexOf(')'));
  assert.deepEqual(parseHashTarget(inner), { kind: 'costume', characterId: 'char-1', costumeId: 'cos-9', versionNo: 2 });
});

test('bcostume: 손상 payload 는 null + 기존 kind 가드 회귀 없음', () => {
  assert.equal(parseHashTarget('bcostume:char-1:cos-9'), null); // 버전 세그먼트 없음
  assert.equal(parseHashTarget('bcostume:char-1:cos-9:2a'), null); // 버전이 숫자 아님
  assert.equal(parseHashTarget('bcostume::cos-9:2'), null); // characterId 없음
  assert.equal(parseHashTarget('bcostume:char-1:cos-9:0'), null); // 버전 <= 0
  assert.equal(parseHashTarget('bepisode:1abc'), null); // 기존 숫자 가드 유지
  assert.equal(parseHashTarget('bscene:1x:A:a001'), null);
});

test('bcostume: tokenizeEntities 가 hash 토큰으로 인식', () => {
  const link = serializeHashTag({ kind: 'costume', label: '봄옷 v2', episodeNumber: 0, characterId: 'c1', costumeId: 'k1', versionNo: 2 });
  const tokens = tokenizeEntities(`확인 ${link} 부탁`, []);
  const hash = tokens.find((t) => t.type === 'hash');
  assert.ok(hash, 'hash 토큰으로 인식되어야 함');
  if (hash && hash.type === 'hash') assert.equal(hash.target.kind, 'costume');
});

test('buildCostumeCandidates: 라벨·필터·태그 구성', () => {
  const costumes = [
    { id: 'k1', characterId: 'c1', name: '봄옷', versionNo: 2 },
    { id: 'k2', characterId: 'c1', name: '겨울옷', versionNo: 1 },
  ];
  const all = buildCostumeCandidates(costumes, '김도윤', '');
  assert.equal(all.length, 2);
  assert.equal(all[0].kind, 'costume');
  assert.equal(all[0].label, '봄옷 v2');
  assert.equal(all[0].context, '김도윤');
  assert.equal(all[0].tag.costumeId, 'k1');
  const filtered = buildCostumeCandidates(costumes, '김도윤', '겨울');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].tag.costumeId, 'k2');
});

test('피드백 49 배선: 정규식·칩·클릭 라우팅·자동완성 병합', () => {
  const entityTokens = readFileSync('src/utils/entityTokens.ts', 'utf8');
  assert.match(entityTokens, /b\(\?:scene\|part\|episode\|costume\)/);
  const entityText = readFileSync('src/components/common/EntityText.tsx', 'utf8');
  assert.match(entityText, /costume/);
  const nav = readFileSync('src/utils/hashNavigation.ts', 'utf8');
  assert.match(nav, /kind === 'costume'/);
  const panel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');
  assert.match(panel, /extraHashCandidates/);
  const modal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
  assert.match(modal, /buildCostumeCandidates/);
  assert.match(modal, /handleCommentHashClick/);
  assert.match(modal, /costumeRequest/);
});

test('피드백 49: 모달 밖 딥링크도 태그 버전을 싣고 보드가 삭제·버전 변경을 안내 (코덱스 1차 P2)', () => {
  const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
  assert.match(appStore, /pendingCharacterBoardRequest:\s*\{ characterId: string; costumeId\?: string; costumeVersionNo\?: number \} \| null/);
  const nav = readFileSync('src/utils/hashNavigation.ts', 'utf8');
  assert.match(nav, /costumeVersionNo: target\.versionNo/);
  const board = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
  // 삭제된 복장이면 안내 후 캐릭터만 열고(costumeId 를 비움), 버전이 다르면 기록 시점을 알린다.
  assert.match(board, /태그된 복장을 찾을 수 없어요 — 삭제되었을 수 있어요/);
  assert.match(board, /이 태그는 v\$\{pendingOpenCostumeVersionNo\} 때 남긴 기록이에요/);
  assert.match(board, /setPendingOpenCostumeVersionNo\(pendingCharacterBoardRequest\.costumeVersionNo\)/);
});
