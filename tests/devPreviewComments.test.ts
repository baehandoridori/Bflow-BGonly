import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MOCK_EPISODES } from '../src/mocks/compositingMockSeed.ts';
import {
  DEV_PREVIEW_RESOLVED_REVISION_ID,
  DEV_PREVIEW_UNREAD_COMMENT_IDS,
  DEV_PREVIEW_REVISION_COMMENT_ID,
  DEV_PREVIEW_REVISION_ID,
  buildDevPreviewLocalCommentStore,
  buildDevPreviewCommentReadStates,
  buildDevPreviewCommentRows,
  buildDevPreviewRevisionRows,
} from '../src/mocks/devPreviewComments.ts';

test('dev preview mock parts have ids so scene comments use the Supabase comment path', () => {
  const parts = MOCK_EPISODES.flatMap((episode) => episode.parts);

  assert.ok(parts.length > 0);
  assert.equal(parts.every((part) => typeof part.id === 'string' && part.id.length > 0), true);
});

test('dev preview comment rows include seen and unseen comments for the current preview user', () => {
  const rows = buildDevPreviewCommentRows(MOCK_EPISODES);
  const bgPart = MOCK_EPISODES[0].parts.find((part) => part.sheetName === 'EP05_A_BG');
  assert.ok(bgPart?.id);

  const a001Rows = rows.filter((row) => row.partId === bgPart.id && row.sceneId === '1');
  assert.ok(a001Rows.length >= 4);
  assert.ok(a001Rows.some((row) => row.id === 'dev-preview-comment'));
  assert.ok(DEV_PREVIEW_UNREAD_COMMENT_IDS.every((id) => a001Rows.some((row) => row.id === id)));
  assert.ok(a001Rows.some((row) => row.mentions.includes('배한솔')));
  assert.ok(a001Rows.some((row) =>
    row.id === 'dev-preview-comment-thread-followup'
    && row.parentCommentId === 'dev-preview-comment-unread-2'
    && row.text.startsWith('@김어진 '),
  ));

  const readStates = buildDevPreviewCommentReadStates('1', MOCK_EPISODES);
  const a001ReadState = readStates.find((row) => row.sceneThreadKey === 'EP05:A:a001');
  assert.ok(a001ReadState);

  const readMs = Date.parse(a001ReadState.lastReadAt);
  const unreadRows = a001Rows.filter((row) => DEV_PREVIEW_UNREAD_COMMENT_IDS.includes(row.id));
  assert.equal(unreadRows.every((row) => Date.parse(row.createdAt) > readMs), true);

  const seenRow = a001Rows.find((row) => row.id === 'dev-preview-comment-seen');
  assert.ok(seenRow);
  assert.equal(Date.parse(seenRow.createdAt) <= readMs, true);
});

test('browser preview Electron API exposes seeded comment rows and read states', () => {
  const mockApi = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');

  assert.match(mockApi, /buildDevPreviewCommentRows/);
  assert.match(mockApi, /buildDevPreviewCommentReadStates/);
  assert.match(mockApi, /buildDevPreviewLocalCommentStore/);
  assert.match(mockApi, /comments\.json/);
  assert.match(mockApi, /supabaseReadComments:\s*async \(partUuid\)/);
  assert.match(mockApi, /supabaseReadCommentReadStates:\s*async \(userId\)/);
});

test('dev preview revision alarm has a real revision card and revision comment target', () => {
  const rows = buildDevPreviewRevisionRows(MOCK_EPISODES);
  assert.ok(rows.length >= 2);

  const revision = rows.find((row) => row.id === DEV_PREVIEW_REVISION_ID);
  assert.ok(revision);
  assert.equal(revision.id, DEV_PREVIEW_REVISION_ID);
  assert.equal(revision.sceneKey, 'EP05:A:1');
  assert.equal(revision.status, 'in_progress');
  assert.ok(revision.notifyUserIds?.includes('1'));

  const resolvedRevision = rows.find((row) => row.id === DEV_PREVIEW_RESOLVED_REVISION_ID);
  assert.ok(resolvedRevision);
  assert.equal(resolvedRevision.sceneKey, 'EP05:A:1');
  assert.equal(resolvedRevision.status, 'resolved');
  assert.equal(resolvedRevision.resolvedBy, '배한솔');
  assert.match(resolvedRevision.resolvedNote, /라이트 모드/);

  const commentRows = buildDevPreviewCommentRows(MOCK_EPISODES);
  const revisionComment = commentRows.find((row) => row.id === DEV_PREVIEW_REVISION_COMMENT_ID);
  assert.ok(revisionComment);
  assert.equal(revisionComment.revisionId, DEV_PREVIEW_REVISION_ID);

  const mockApi = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.match(mockApi, /buildDevPreviewRevisionRows/);
  assert.match(mockApi, /supabaseReadRevisions:\s*async \(\) => \{\s*requireMockCalendarUser\(\);\s*return getMockRevisionRows\(\);/);
});

test('dev preview also seeds local comments fallback for disconnected browser preview', () => {
  const store = buildDevPreviewLocalCommentStore(MOCK_EPISODES);
  const a001 = store['EP05_A_BG:1'] ?? [];
  const actA001 = store['EP05_A_ACT:1'] ?? [];
  const b002 = store['EP05_B_BG:2'] ?? [];

  assert.ok(a001.length >= 4);
  assert.ok(a001.some((comment) => comment.id === 'dev-preview-comment'));
  assert.ok(a001.some((comment) => comment.id === 'dev-preview-comment-unread-reply' && comment.parentCommentId === 'dev-preview-comment-unread-2'));
  assert.ok(a001.some((comment) =>
    comment.id === 'dev-preview-comment-thread-followup'
    && comment.parentCommentId === 'dev-preview-comment-unread-2'
    && comment.text.startsWith('@김어진 '),
  ));
  assert.ok(actA001.some((comment) => comment.id === 'dev-preview-acting-comment-unread'));
  assert.ok(b002.some((comment) => comment.id === 'dev-preview-b002-comment'));
  assert.equal(DEV_PREVIEW_UNREAD_COMMENT_IDS.every((id) => a001.some((comment) => comment.id === id)), true);
});
