import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMP_CHARACTER_NAME_BASE,
  buildCharacterFolderConfirmMessage,
  characterNameKey,
  deriveCharacterNameFromFileName,
  findDuplicateCharacters,
  isTempCharacterName,
  nextTempCharacterName,
  suggestSimilarCharacters,
} from '../src/utils/characterName.ts';

test('임시 이름은 겹치지 않게 번호를 붙인다', () => {
  assert.equal(TEMP_CHARACTER_NAME_BASE, '새 캐릭터');
  assert.equal(nextTempCharacterName([]), '새 캐릭터');
  assert.equal(nextTempCharacterName(['한솔']), '새 캐릭터');
  assert.equal(nextTempCharacterName(['새 캐릭터']), '새 캐릭터 2');
  assert.equal(nextTempCharacterName(['새 캐릭터', '새 캐릭터 2']), '새 캐릭터 3');
  assert.equal(nextTempCharacterName(['새 캐릭터', '새 캐릭터 3']), '새 캐릭터 2');
});

test('isTempCharacterName 은 자동 부여 이름만 참', () => {
  assert.equal(isTempCharacterName('새 캐릭터'), true);
  assert.equal(isTempCharacterName('새 캐릭터 2'), true);
  assert.equal(isTempCharacterName('  새 캐릭터 12 '), true);
  assert.equal(isTempCharacterName('한솔'), false);
  assert.equal(isTempCharacterName('새 캐릭터들'), false);
  assert.equal(isTempCharacterName(''), false);
  assert.equal(isTempCharacterName(null), false);
});

test('파일명에서 이름을 뽑되 일반명은 제외', () => {
  assert.equal(deriveCharacterNameFromFileName('한솔.png'), '한솔');
  assert.equal(deriveCharacterNameFromFileName('한솔 SWver12.png'), '한솔 SWver12');
  assert.equal(deriveCharacterNameFromFileName('a.b.png'), 'a.b');
  assert.equal(deriveCharacterNameFromFileName('찜질방 사장.jpg'), '찜질방 사장');
  // 일반/기본 저장명 → null
  assert.equal(deriveCharacterNameFromFileName('image.png'), null);
  assert.equal(deriveCharacterNameFromFileName('IMAGE.PNG'), null);
  assert.equal(deriveCharacterNameFromFileName('clipboard.png'), null);
  assert.equal(deriveCharacterNameFromFileName('스크린샷 2026-07-08.png'), null);
  assert.equal(deriveCharacterNameFromFileName('Screenshot 2026.png'), null);
  assert.equal(deriveCharacterNameFromFileName('20260708.png'), null);
  assert.equal(deriveCharacterNameFromFileName('2026-07-08_12-00.png'), null);
  assert.equal(deriveCharacterNameFromFileName(''), null);
  assert.equal(deriveCharacterNameFromFileName('.png'), null);
});

test('피드백 55: 중복 판정 키 — 공백·대소문자·유니코드 정규화 무시', () => {
  assert.equal(characterNameKey('찜질방 사장'), '찜질방사장');
  assert.equal(characterNameKey('  찜질방  사장 '), '찜질방사장');
  assert.equal(characterNameKey('Kim'), 'kim');
  assert.equal(characterNameKey('한솔'.normalize('NFD')), '한솔');
  assert.equal(characterNameKey(''), '');
  assert.equal(characterNameKey('   '), '');
  assert.equal(characterNameKey(null), '');
});

test('피드백 55: 같은 이름 찾기 — 활성 우선, 보관은 활성이 없을 때만', () => {
  const list = [
    { id: 'a', name: '찜질방 사장', status: 'active' as const },
    { id: 'b', name: '찜질방사장', status: 'archived' as const },
    { id: 'c', name: '미영', status: 'archived' as const },
  ];
  assert.deepEqual(findDuplicateCharacters(list, '찜질방사장'), { active: list[0], archived: null });
  assert.deepEqual(findDuplicateCharacters(list, ' 미영 '), { active: null, archived: list[2] });
  assert.deepEqual(findDuplicateCharacters(list, '도윤'), { active: null, archived: null });
  assert.deepEqual(findDuplicateCharacters(list, '   '), { active: null, archived: null });
  // 이름이 비어 있는 카드끼리 서로 중복으로 잡히면 안 된다(임시 이름 부여 전 상태).
  const withBlank = [{ id: 'x', name: '   ', status: 'active' as const }, ...list];
  assert.deepEqual(findDuplicateCharacters(withBlank, '   '), { active: null, archived: null });
  assert.deepEqual(findDuplicateCharacters(withBlank, ''), { active: null, archived: null });
});

test('피드백 55: 비슷한 이름 제안 — 활성만, 정확히 같은 이름 제외, 양방향 포함, 최대 3개', () => {
  const list = [
    { id: 'a', name: '찜질방 사장', status: 'active' as const },
    { id: 'b', name: '찜질방 알바', status: 'active' as const },
    { id: 'c', name: '찜질방 손님 1', status: 'active' as const },
    { id: 'd', name: '찜질방 손님 2', status: 'active' as const },
    { id: 'e', name: '찜질방 유령', status: 'archived' as const },
    { id: 'f', name: '미영', status: 'active' as const },
  ];
  // 이름 순 정렬 + 상위 3개를 id 로 못박는다(every 로 술어만 확인하면 정렬·필터가 빠져도 통과한다).
  assert.deepEqual(suggestSimilarCharacters(list, '찜질방').map((c) => c.id), ['a', 'c', 'd']);
  // 보관본이 정렬 맨 앞에 오는 경우 — limit 에 가려지지 않게 제외 필터를 직접 검증한다.
  const archivedFirst = [
    { id: 'z', name: '찜질방 가짜', status: 'archived' as const },
    { id: 'a', name: '찜질방 사장', status: 'active' as const },
  ];
  assert.deepEqual(suggestSimilarCharacters(archivedFirst, '찜질방').map((c) => c.id), ['a']);
  // 입력이 기존 이름보다 길어도(접미사·오타) 제안한다.
  assert.deepEqual(suggestSimilarCharacters(list, '찜질방 사장님').map((c) => c.id), ['a']);
  // 정확히 같은 이름은 제외 — 그건 중복 차단 쪽에서 처리한다.
  assert.deepEqual(suggestSimilarCharacters(list, '미영'), []);
  assert.deepEqual(suggestSimilarCharacters(list, ''), []);
  assert.equal(suggestSimilarCharacters(list, '찜질방', 1).length, 1);
});

test('피드백 57-1: 폴더 만들기 확인 문구 — 경로·이름 + 임시 이름 경고', () => {
  const root = 'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅';
  const msg = buildCharacterFolderConfirmMessage(root, '희선');
  // 줄 구조까지 고정한다 — 한 줄로 뭉개지거나 경로가 두 번 나와도 includes 만으로는 통과한다.
  const lines = msg.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "아래 위치에 '희선' 폴더를 만들고 작업 폴더로 연결할까요?");
  assert.equal(lines[1], root);
  assert.equal(msg.split(root).length - 1, 1);
  assert.match(lines[2], /이미 같은 이름의 폴더가 있으면/);
  assert.ok(!msg.includes('임시 이름'));
  const tempLines = buildCharacterFolderConfirmMessage(root, '새 캐릭터 2').split('\n');
  assert.equal(tempLines.length, 4);
  assert.match(tempLines[3], /임시 이름/);
});

test('피드백 55·57 배선 테스트 파일이 test:character 게이트에 등록돼 있다', () => {
  // 이 확인을 characterFeedback5.test.ts 안에 두면, 그 파일이 스크립트에서 빠졌을 때
  //   실행 자체가 안 돼 7개가 조용히 사라진 채 초록불이 된다 — 그래서 여기서 감시한다.
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.match(scripts['test:character'], /\.\/tests\/characterFeedback5\.test\.ts/);
});
