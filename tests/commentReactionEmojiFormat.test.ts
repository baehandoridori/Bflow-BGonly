import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReactionEmojiList,
  lastReactionEmoji,
} from '../src/utils/commentReactionEmojiFormat.ts';

test('formatReactionEmojiList: 5개 이하면 전부 이어붙임', () => {
  assert.equal(formatReactionEmojiList(['❤️', '🔥']), '❤️🔥');
  assert.equal(formatReactionEmojiList(['❤️', '🔥', '👏', '🎉', '💯']), '❤️🔥👏🎉💯');
});

test('formatReactionEmojiList: 5개 초과면 첫 5개 + "+N"', () => {
  assert.equal(
    formatReactionEmojiList(['❤️', '🔥', '👏', '🎉', '💯', '✨', '🙌']),
    '❤️🔥👏🎉💯+2',
  );
  assert.equal(
    formatReactionEmojiList(['❤️', '🔥', '👏', '🎉', '💯', '✨']),
    '❤️🔥👏🎉💯+1',
  );
});

test('formatReactionEmojiList: 빈 배열 → 빈 문자열', () => {
  assert.equal(formatReactionEmojiList([]), '');
});

test('formatReactionEmojiList: maxVisible 옵션 — 3 으로 줄이기', () => {
  assert.equal(
    formatReactionEmojiList(['❤️', '🔥', '👏', '🎉'], 3),
    '❤️🔥👏+1',
  );
});

test('lastReactionEmoji: 마지막 원소 반환', () => {
  assert.equal(lastReactionEmoji(['❤️', '🔥', '👏']), '👏');
  assert.equal(lastReactionEmoji(['❤️']), '❤️');
});

test('lastReactionEmoji: 빈 배열 → fallback', () => {
  assert.equal(lastReactionEmoji([]), '💬');
  assert.equal(lastReactionEmoji([], '😶'), '😶');
});
