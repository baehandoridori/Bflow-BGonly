import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('평소 전부 받기에는 보관한 에피소드가 빠지고, 보관함에서는 고른 한 편만 받는다', async () => {
  const supabase = await read('electron/supabase.ts');
  assert.match(supabase, /export async function readAllEpisodes\(options: \{ force\?: boolean \} = \{\}\): Promise<SupabaseEpisodeData\[\]> \{\s*return readEpisodesWithScenes\(\{ status: 'active' \}, options\);/);
  assert.match(supabase, /: await fetchScenesPaged\(partIds\);/, '보관함에서 연 한 편은 캐시를 거치지 않는다');
  assert.match(supabase, /export async function readArchivedEpisodeDetail\(episodeNumber: number\)[\s\S]*?readEpisodesWithScenes\(\{ status: 'archived', episodeNumber \}\)/);
  assert.match(supabase, /\.eq\('status', filter\.status\);\s*if \(filter\.episodeNumber !== undefined\) episodeQuery = episodeQuery\.eq\('episode_number', filter\.episodeNumber\);/);
});

test('보관한 에피소드 읽기 창구는 번호를 확인하고 renderer 까지 이어진다', async () => {
  const main = await read('electron/main.ts');
  assert.match(main, /ipcMain\.handle\('supabase:read-archived-episode', wrapIpc\(async \(_e: unknown, episodeNumber: unknown\) => \{\s*if \(typeof episodeNumber !== 'number' \|\| !Number\.isInteger\(episodeNumber\) \|\| episodeNumber < 0\)/);
  const preload = await read('electron/preload.ts');
  assert.match(preload, /supabaseReadArchivedEpisode: \(episodeNumber: number\) =>\s*ipcRenderer\.invoke\('supabase:read-archived-episode', episodeNumber\)/);
  const mock = await read('src/mocks/devElectronAPI.ts');
  assert.match(mock, /supabaseReadArchivedEpisode: async \(episodeNumber\) =>/, '미리보기도 같은 길');
});

test('보관함에서 고르면 보기 전용 창이 열린다', async () => {
  const nav = await read('src/components/scenes/EpisodeTreeNav.tsx');
  assert.match(nav, /onClick=\{\(\) => onOpen\?\.\(archived\.episodeNumber\)\}/);
  assert.doesNotMatch(nav, /text-amber-500\/40 italic/, '메모 글씨는 기울이지 않는다');
  const scenes = await read('src/views/ScenesView.tsx');
  assert.match(scenes, /onOpenArchivedEpisode=\{setOpenArchivedEpisode\}/);
  assert.match(scenes, /<ArchivedEpisodeViewer[\s\S]*?load=\{readArchivedEpisodeDetail\}/);
  const viewer = await read('src/components/scenes/ArchivedEpisodeViewer.tsx');
  assert.match(viewer, /보기만 할 수 있어요/);
  assert.doesNotMatch(viewer, /onToggle|onChange|supabaseUpdate|updateScene/, '보기 전용 — 고치는 길이 없다');
});

test('검색·알림으로 온 카드는 화면에 들어온 뒤 잠깐 크게 띄운다', async () => {
  const unified = await read('src/components/scenes/UnifiedSceneCard.tsx');
  const scenes = await read('src/views/ScenesView.tsx');
  assert.match(unified, /useHighlightPop\(cardRootRef, isHighlighted\);/);
  assert.match(scenes, /useHighlightPop\(highlightCardRef, Boolean\(isHighlighted\)\);/);
  for (const src of [unified, scenes]) {
    assert.doesNotMatch(src, /initial: \{ scale: 1\.06 \}/, '처음 그려질 때 한 번 커지던 방식은 뺐다');
  }
  const hook = await read('src/hooks/useHighlightPop.ts');
  assert.match(hook, /if \(!el \|\| prefersReducedMotion\(\)\) return;/, '동작 줄이기·최소면 띄우지 않는다');
  assert.match(hook, /window\.addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\);/, '스크롤이 멈춘 뒤 띄운다');
  assert.match(hook, /transform: 'scale\(1\.07\)'/);
  assert.match(scenes, /html\[data-motion-minimal\] \.scene-highlight \{ animation: none;/, '최소 설정에서는 정적 테두리');
  assert.doesNotMatch(scenes, /scene-glow-pulse/, '세 번 깜빡이던 빛은 뺐다');
});
