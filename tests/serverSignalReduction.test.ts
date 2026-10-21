import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applySceneCompletionMetadata,
  episodeLabelsFromMetadata,
  parseSceneCompletionMeta,
  SCENE_COMPLETION_META_TYPE,
} from '../src/utils/loadedMetadata.ts';
import type { Episode } from '../src/types/index.ts';

// 2026-10-20: 켜 두기만 해도 PC 마다 15초에 약 48건(하루 약 49만 건)을 보내던 것을 줄였다.
// 아래는 그 구조로 되돌아가지 않게 지키는 테스트다.

const read = (path: string) => readFileSync(path, 'utf8');

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} 를 찾지 못했습니다`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const scene = (id: string, extra: Record<string, unknown> = {}) => ({
  id, no: 1, sceneId: id, memo: '', storyboardUrl: '', guideUrl: '', assignee: '', layoutId: '',
  lo: true, done: true, review: true, png: true, ...extra,
});
const episodes = (): Episode[] => [{
  episodeNumber: 1, title: 'EP.01',
  parts: [{ partId: 'A', department: 'bg', sheetName: 'EP01_A_BG', scenes: [scene('s1'), scene('s2'), scene('')] }],
} as unknown as Episode];

test('씬 완료 기록은 전체 메타 목록에서 골라 붙이고, 깨지거나 빈 기록은 무시한다', () => {
  const result = applySceneCompletionMetadata(episodes(), [
    { type: SCENE_COMPLETION_META_TYPE, key: 's1', value: '{"completedBy":"배한솔","completedAt":"2026-10-20T01:00:00Z"}' },
    { type: SCENE_COMPLETION_META_TYPE, key: 's2', value: '' },
    { type: SCENE_COMPLETION_META_TYPE, key: '', value: '{"completedBy":"x","completedAt":"y"}' },
    { type: 'episode-title', key: 's2', value: '{"completedBy":"x","completedAt":"y"}' },
  ]);
  const [s1, s2, noId] = result[0].parts[0].scenes;
  assert.equal(s1.completedBy, '배한솔');
  assert.equal(s1.completedAt, '2026-10-20T01:00:00Z');
  assert.equal(s2.completedBy, undefined);
  assert.equal(noId.completedBy, undefined, 'id 없는(아직 저장 전) 씬에는 붙이지 않는다');
  assert.equal(parseSceneCompletionMeta('{"completedBy":"","completedAt":"t"}'), null);
  assert.equal(parseSceneCompletionMeta('not json'), null);
  const untouched = episodes();
  assert.equal(applySceneCompletionMetadata(untouched, []), untouched, '기록이 없으면 그대로 돌려준다');
});

test('에피소드 제목·메모도 같은 메타 목록에서 고른다', () => {
  assert.deepEqual(episodeLabelsFromMetadata([
    { type: 'episode-title', key: '5', value: '쾅 뉴럴링크' },
    { type: 'episode-memo', key: '5', value: '컴포지팅' },
    { type: 'episode-title', key: '6', value: '' },
    { type: 'part-memo', key: '5', value: 'x' },
  ]), { titles: { 5: '쾅 뉴럴링크' }, memos: { 5: '컴포지팅' } });
});

test('전부 다시 받기 한 번에 메타데이터는 한 번만, 씬과 동시에 읽는다', () => {
  const service = read('src/services/supabaseService.ts');
  const body = functionBody(service, 'readAllWithMetadata');
  assert.match(body, /Promise\.all\(\[\s*readAllFromSupabase\(options\),\s*readAllMetadataFromSupabase\(options\)/);
  assert.match(body, /applySceneCompletionMetadata\(episodes, metadata\)/);
  assert.match(body, /applyAssigneeProgressMetadata\(withCompletion, metadata\)/);

  const main = read('electron/supabase.ts');
  const start = main.indexOf('export async function readAllEpisodes(');
  const episodesBody = main.slice(start, main.indexOf('\nexport ', start + 1));
  assert.doesNotMatch(episodesBody, /from\('metadata'\)/, '씬 완료 기록을 씬 100개씩 끊어 따로 읽던 길로 되돌아갔습니다');

  const app = read('src/App.tsx');
  assert.match(app, /const \{ episodes, metadata \} = await readAllWithMetadata\(\{ force: options\.force === true \}\);/);
  assert.match(app, /\(kind\) => fetchAllDataRef\.current\(\{ force: kind === 'manual' \}\)/, '직접 새로고침만 전부 다시 받는다');
  assert.doesNotMatch(app, /readAllMetadataFromSupabase\(\)/, '본 창이 메타데이터를 또 읽으면 안 된다');

  const popup = read('src/views/WidgetPopup.tsx');
  assert.doesNotMatch(popup, /readAllMetadataFromSupabase\(\)/);
  assert.doesNotMatch(popup, /readMetadata\('episode-(title|memo)'/, '에피소드마다 한 건씩 읽지 않는다');
});

test('본 창의 자동 받기는 창 상태와 실시간 연결을 보는 스케줄러를 거친다', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /POLL_INTERVAL = 15_000/, '창 상태와 상관없는 15초 고정 폴링으로 되돌아갔습니다');
  assert.match(app, /createAutoSyncScheduler\(\{[\s\S]*?intervals: MAIN_WINDOW_SYNC_INTERVALS/);
  assert.match(app, /isVisible: \(\) => document\.visibilityState === 'visible'/);
  assert.match(app, /isBusy: \(\) => syncQueue\.getState\(\)\.syncing/);
  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  // 실시간 변경·구조 변경·재연결로 받는 길은 숨은 창에서 미뤄진다.
  assert.match(app, /console\.log\(`\[Supabase Realtime\] \$\{table\} \$\{payload\?\.eventType\} → reload`\);\s*reloadFromEvent\(\);/);
  assert.match(app, /console\.log\('\[Broadcast\] 구조 변경 감지 → reload'\);\s*reloadFromEvent\(\);/);
  assert.match(app, /installAppRealtimeCalendarReconnectCatchUp\(reloadFromEvent\)/);
});

test('위젯 창도 같은 스케줄러를 쓰고, 변경 알림은 묶어서 한 번만 받는다', () => {
  const popup = read('src/views/WidgetPopup.tsx');
  assert.doesNotMatch(popup, /setInterval\([\s\S]{0,80}120_000\)/, '창 상태와 상관없는 2분 고정 폴링으로 되돌아갔습니다');
  assert.match(popup, /intervals: POPUP_WINDOW_SYNC_INTERVALS/);
  assert.match(popup, /isBusy: \(\) => reloadsInFlight > 0 \|\| _reloadCooldown/);
  assert.match(popup, /eventTimer = setTimeout\(\(\) => \{\s*eventTimer = null;\s*scheduler\.requestFromEvent\(\);\s*\}, 300\);/);
  assert.match(popup, /table\.startsWith\('gantt_'\) \|\| table\.startsWith\('calendar'\)/, '간트·캘린더 변경으로 씬 전체를 다시 받지 않는다');
});

test('간트·배경 화면의 15초 확인은 창이 보일 때만 돈다', () => {
  assert.match(read('src/features/gantt/GanttView.tsx'), /setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'\)void useGanttStore\.getState\(\)\.refresh\(\);\},15000\)/);
  assert.match(read('src/features/backgrounds/BackgroundLibraryView.tsx'), /if \(document\.visibilityState === "visible"\) refresh\(\);\s*\}, 15000\)/);
});

test('캘린더 알림은 일정이 바뀌었다는 신호에 맞춰 다시 읽는다', () => {
  const main = read('electron/main.ts');
  assert.match(main, /const calendarReminders = registerCalendarReminders\(/);
  assert.match(main, /onCalendarDataMaybeChanged: \(\) => calendarReminders\.invalidate\(\),/);
  const realtime = read('electron/realtime.ts');
  // 캘린더 행 변경 · 간트 연결 변경 · 재연결 세 곳에서 알린다.
  assert.match(realtime, /callbacks\.onCalendarDataMaybeChanged\?\.\(\);\s*callbacks\.onCalendarChange\(table/);
  assert.match(realtime, /event: 'gantt-changed' \}, \(\) => \{\s*callbacks\.onCalendarDataMaybeChanged\?\.\(\);\s*callbacks\.onGanttChange\?\.\(\);/);
  assert.match(realtime, /if \(reconnected\) callbacks\.onCalendarDataMaybeChanged\?\.\(\);/);
});
