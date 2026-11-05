import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 씬 댓글 서버 알림(씬 댓글 B안 PR 6)의 이름 사슬 — 서버 신호 이름 → realtime 구독 → main 이 본 창에만 보내는 채널 →
// preload 구독 → App 이 내 줄을 다시 읽음. 어느 한 고리의 글자가 어긋나면 서버 줄이 화면에 닿지 않는데 다른 시험으로는 안 잡힌다.
// 동작 자체는 commentNotificationInbox/Present/ServerDecision/StoreIpc/Database 시험이 맡는다(여기는 연결 이름만).
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const sql = read('DEVLOG/migrations/2026-11-05-comment-notifications.sql');
const realtime = read('electron/realtime.ts');
const main = read('electron/main.ts');
const preload = read('electron/preload.ts');
const app = read('src/App.tsx');
const mock = read('src/mocks/devElectronAPI.ts');

test('신호 이름: SQL 이 보내는 이벤트를 realtime 이 듣고, 재연결 성공 때도 한 번 다시 알린다', () => {
  assert.match(sql, /'comment-notifications-changed', 'bflow-realtime', false/);
  assert.match(realtime, /built\.on\('broadcast', \{ event: 'comment-notifications-changed' \}, \(\) => callbacks\.onCommentNotificationsChange\?\.\(\)\);/);
  assert.match(realtime, /if \(reconnected\) callbacks\.onCommentNotificationsChange\?\.\(\);/);
});

test('main 은 본 창에만 보내고, preload 가 같은 채널을 듣고, App 이 묶어서 내 줄을 다시 읽는다', () => {
  const handlerStart = main.indexOf('onCommentNotificationsChange: () => {');
  assert.ok(handlerStart > 0);
  const handler = main.slice(handlerStart, main.indexOf('\n    },', handlerStart));
  assert.match(handler, /mainWindow\.webContents\.send\('comment-notifications:changed'\)/);
  assert.doesNotMatch(handler, /broadcastToAllWindows|widgetWindows/, '위젯 창은 알림을 만들지 않는다');
  assert.match(main, /registerCommentNotificationIpc\(\{ getSessionOriginOrThrow \}\);/);
  assert.match(main, /setCommentNotificationSessionTokenResolver\(\{ tokenFor: \(actorId\) => sessionManager\.getSessionTokenFor\(actorId\) \}\);/);
  assert.match(preload, /ipcRenderer\.on\('comment-notifications:changed', listener\)/);
  assert.match(preload, /ipcRenderer\.invoke\('comment-notifications:list', cursor, limit, canonicalSessionEpoch\)/);
  assert.match(preload, /ipcRenderer\.invoke\('comment-notifications:mark-read', target, canonicalSessionEpoch\)/);
  assert.match(app, /window\.electronAPI\?\.onCommentNotificationsChanged/);
  assert.match(app, /pullLiveServerCommentNotifications\(getNotiSettings, MENTION_CATCHUP_OVERLAP_MS\)/);
  // 놓친 알림 모으기는 서버 줄이 있으면 내 줄 목록, 없으면(DB 적용 전) 예전 훑기.
  assert.match(app, /if \(serverCommentNotificationsAvailable\(\) !== false\) \{[\s\S]*?pullServerCommentNotifications\([\s\S]*?'catchup'[\s\S]*?if \(server\.status === 'done'\)[\s\S]*?return 'done';[\s\S]*?supabaseFetchMissedMentions/);
});

test('미리보기: 댓글 쓰기·고치기·지우기가 실서버 트리거처럼 줄을 만들고 고치고 지운다, 보관한 에피소드는 활성 아님', () => {
  const add = mock.slice(mock.indexOf('supabaseAddComment: async'), mock.indexOf('supabaseEditComment: async'));
  assert.match(add, /commentNotificationPreviewStore\(\)\.fanoutAdd\(\s*mockRecipientWorld\(\), commentId, mockNotificationComment\(added\)/);
  const edit = mock.slice(mock.indexOf('supabaseEditComment: async'), mock.indexOf('supabaseDeleteComment: async'));
  assert.match(edit, /const previousMentions = \[\.\.\.\(target\.mentions \?\? \[\]\)\];[\s\S]*commentNotificationPreviewStore\(\)\.fanoutEdit\(mockRecipientWorld\(\), commentId, previousMentions, mockNotificationComment\(target\)\)/);
  const remove = mock.slice(mock.indexOf('supabaseDeleteComment: async'), mock.indexOf('supabaseDeleteComment: async') + 900);
  assert.match(remove, /commentNotificationPreviewStore\(\)\.removeComment\(commentId\)/);
  assert.match(mock, /for \(const archived of getMockArchivedEpisodes\(\)\) addEpisode\(archived\.episode, `ep-archived-\$\{archived\.episode\.episodeNumber\}`, false\);/);
  assert.match(mock, /commentNotificationsList: async \(cursor, limit\) => \{[\s\S]*?requireMockCalendarUser\(\)[\s\S]*?\(commentId\) => existing\.has\(commentId\)/);
  assert.match(mock, /commentNotificationsMarkRead: async \(target\) => commentNotificationPreviewStore\(\)\.markRead\(requireMockCalendarUser\(\)\.id, target\)/);
  assert.match(mock, /onCommentNotificationsChanged: \(callback\) => commentNotificationPreviewStore\(\)\.subscribe\(callback\)/);
});
