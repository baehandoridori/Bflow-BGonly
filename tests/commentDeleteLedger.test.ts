import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommentDeleteLedger, type CommentDeleteEntryBase } from '../src/utils/commentDeleteLedger.ts';

type Entry = CommentDeleteEntryBase & { comment: { id: string } };
const entry = (id: string, expire = () => {}): Entry => ({ comment: { id }, phase: 'waiting', undoWindow: { expire } });

test('같은 댓글을 두 번 지우지 않는다', () => {
  const ledger = createCommentDeleteLedger<Entry>();
  assert.equal(ledger.begin('c1', entry('c1')), true);
  assert.equal(ledger.begin('c1', entry('c1')), false);
  assert.equal(ledger.has('c1'), true);
});

test('되돌리기는 기다리는 동안만 — 되돌리면 장부에서 빠진다', () => {
  const ledger = createCommentDeleteLedger<Entry>();
  ledger.begin('c1', entry('c1'));
  const undone = ledger.takeForUndo('c1');
  assert.equal(undone?.comment.id, 'c1');
  assert.equal(ledger.has('c1'), false);
  assert.equal(ledger.takeForUndo('c1'), null);
});

test('확정은 한 번만, 보낸 뒤에는 되돌리지 않는다, 끝나면 장부에서 뺀다', () => {
  const ledger = createCommentDeleteLedger<Entry>();
  ledger.begin('c1', entry('c1'));
  const committing = ledger.beginCommit('c1');
  assert.equal(committing?.phase, 'deleting');
  assert.equal(ledger.beginCommit('c1'), null, '만료·창 숨김이 겹쳐도 서버 삭제는 한 번');
  assert.equal(ledger.takeForUndo('c1'), null, '서버로 보낸 뒤에는 되돌리지 않음');
  assert.equal(ledger.has('c1'), true, '지우는 동안에도 다시 불러온 목록에서 뺀다');
  ledger.finish('c1');
  assert.equal(ledger.has('c1'), false);
});

test('모두 지금 확정 — 기다리는 것마다 되돌리기 창을 만료시킨다', () => {
  const ledger = createCommentDeleteLedger<Entry>();
  const expired: string[] = [];
  ledger.begin('a', entry('a', () => expired.push('a')));
  ledger.begin('b', entry('b', () => { expired.push('b'); ledger.beginCommit('b'); }));
  ledger.expireAll();
  assert.deepEqual(expired, ['a', 'b']);
  assert.deepEqual(ledger.values().map((e) => e.phase), ['waiting', 'deleting']);
});
