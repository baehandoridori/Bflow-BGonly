import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDefaultRevisionSlashRecipientIds,
  parseRevisionSlashCommand,
} from '../src/utils/revisionSlashCommand.ts';

const users = [
  { id: 'u-bg', name: '배한' },
  { id: 'u-act', name: '서연' },
  { id: 'u-owner', name: '한솔' },
  { id: 'u-extra', name: '민지' },
];

test('parseRevisionSlashCommand recognizes /re at the start only', () => {
  assert.deepEqual(parseRevisionSlashCommand('/re 그림자 경계 수정'), {
    isRevisionCommand: true,
    description: '그림자 경계 수정',
  });
  assert.deepEqual(parseRevisionSlashCommand('  /re   라인 정리 요청  '), {
    isRevisionCommand: true,
    description: '라인 정리 요청',
  });
  assert.deepEqual(parseRevisionSlashCommand('/re'), {
    isRevisionCommand: true,
    description: '',
  });
  assert.equal(parseRevisionSlashCommand('/reply 테스트').isRevisionCommand, false);
  assert.equal(parseRevisionSlashCommand('일반 댓글 /re 테스트').isRevisionCommand, false);
});

test('getDefaultRevisionSlashRecipientIds follows the approved BG/ACT/all policy', () => {
  assert.deepEqual(getDefaultRevisionSlashRecipientIds({
    context: 'bg',
    bgAssignee: '배한',
    actingAssignee: '서연',
    allUsers: users,
    excludeUserId: 'u-owner',
  }), ['u-bg']);

  assert.deepEqual(getDefaultRevisionSlashRecipientIds({
    context: 'acting',
    bgAssignee: '배한',
    actingAssignee: '서연',
    allUsers: users,
    excludeUserId: 'u-owner',
  }), ['u-act']);

  assert.deepEqual(getDefaultRevisionSlashRecipientIds({
    context: 'all',
    bgAssignee: '배한',
    actingAssignee: '서연',
    allUsers: users,
    excludeUserId: 'u-owner',
  }), ['u-bg', 'u-act']);
});

test('getDefaultRevisionSlashRecipientIds deduplicates assignees and excludes the requester', () => {
  assert.deepEqual(getDefaultRevisionSlashRecipientIds({
    context: 'all',
    bgAssignee: '배한, 민지',
    actingAssignee: '배한, 한솔, 없는사람',
    allUsers: users,
    excludeUserId: 'u-owner',
  }), ['u-bg', 'u-extra']);
});
