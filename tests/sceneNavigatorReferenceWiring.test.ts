import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

test('scene filter controls stay sticky for card and sheet views', () => {
  assert.match(scenesView, /className="sticky top-0 z-30 flex flex-col gap-2 bg-bg-card\/95/);
  assert.match(scenesView, /sceneViewMode === 'card'/);
  assert.match(scenesView, /sceneViewMode === 'sheet'/);
});

test('expanded sidebar reserves enough label width for retake hub', () => {
  assert.match(sidebar, /const SIDEBAR_EXPANDED_WIDTH = 192/);
  assert.match(sidebar, /const SIDEBAR_LABEL_MAX_WIDTH = 120/);
  assert.match(sidebar, /label: '리테이크 허브'/);
  assert.doesNotMatch(sidebar, /width: isExpanded \? 168 : 64/);
  assert.doesNotMatch(sidebar, /maxWidth: isVisuallyExpanded \? 104 : 0/);
});

test('reference dock supports multiple pinned scene cards', () => {
  assert.match(scenesView, /const \[referencePins, setReferencePins\] = useState<SceneReferencePin\[\]>/);
  assert.match(scenesView, /const \[activeReferenceIndex, setActiveReferenceIndex\] = useState\(0\)/);
  assert.match(scenesView, /data-reference-pin-count=\{referencePins\.length\}/);
  assert.match(scenesView, /이전 참조 씬/);
  assert.match(scenesView, /다음 참조 씬/);
  assert.match(scenesView, /현재 참조 닫기/);
  assert.match(scenesView, /getReferencePinId\(target\)/);
});
