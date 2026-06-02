import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), 'utf8');
}

test('feedback hub main tree supports episode and part collapse from an all-collapsed entry state', () => {
  const view = read('src/views/CompositingView.tsx');
  const sceneTree = read('src/views/compositing/SceneGroupSection.tsx');
  const episodeGroup = read('src/views/compositing/EpisodeGroupSection.tsx');
  const utils = read('src/views/compositing/feedbackHubUtils.ts');

  assert.match(utils, /export function buildFeedbackHubPartCollapseKey/);
  assert.match(view, /const \[expandedScenes, setExpandedScenes\] = useState<Set<string>>\(new Set\(\)\)/);
  assert.match(view, /const \[expandedFeedbackEpisodes, setExpandedFeedbackEpisodes\] = useState<Set<number>>\(new Set\(\)\)/);
  assert.match(view, /const \[expandedFeedbackParts, setExpandedFeedbackParts\] = useState<Set<string>>\(new Set\(\)\)/);
  assert.doesNotMatch(view, /autoExpandedOnce/);
  assert.doesNotMatch(view, /setExpandedScenes\(new Set\(groupsToOpen/);
  assert.match(view, /expandedEpisodes=\{expandedFeedbackEpisodes\}/);
  assert.match(view, /expandedParts=\{expandedFeedbackParts\}/);
  assert.match(view, /onToggleEpisode=\{toggleFeedbackEpisode\}/);
  assert.match(view, /onTogglePart=\{toggleFeedbackPart\}/);
  assert.match(view, /setExpandedFeedbackEpisodes\(new Set\(feedbackTree\.map/);
  assert.match(view, /setExpandedFeedbackParts\(new Set\(/);

  assert.match(sceneTree, /aria-expanded=\{isEpisodeExpanded\}/);
  assert.match(sceneTree, /onToggleEpisode\(episodeTree\.episodeNumber\)/);
  assert.match(sceneTree, /aria-expanded=\{isPartExpanded\}/);
  assert.match(sceneTree, /onTogglePart\(episodeTree\.episodeNumber, partTree\.partId\)/);
  assert.match(sceneTree, /buildFeedbackHubPartCollapseKey\(episodeTree\.episodeNumber, partTree\.partId\)/);
  assert.match(sceneTree, /isEpisodeExpanded &&/);
  assert.match(sceneTree, /isPartExpanded &&/);

  assert.match(episodeGroup, /const \[expandedEps, setExpandedEps\] = useState<Set<number>>\(\(\) => new Set\(\)\)/);
});
