import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const devElectronApi = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');

test('dev preview quick revision emits revision activity for the comment feed', () => {
  assert.match(devElectronApi, /const activityRealtimeCallbacks = new Set/);
  assert.match(devElectronApi, /function emitMockActivityRealtime/);
  assert.match(devElectronApi, /function createMockRevisionActivityRow/);
  assert.match(devElectronApi, /import \{ normalizeSceneIdKey \} from '@\/utils\/sceneIdKey'/);
  assert.match(devElectronApi, /const normalizedSceneId = normalizeSceneIdKey\(sceneId, partKey\)/);
  assert.match(devElectronApi, /const canonicalSceneId = normalizeSceneIdKey\(scene\.sceneId, part\.partId\)/);
  assert.match(devElectronApi, /action_type:\s*'revision_add'/);
  assert.match(devElectronApi, /descriptionPreview:\s*description\.slice\(0,\s*60\)/);
  assert.match(devElectronApi, /supabaseAddRevision:[\s\S]*emitMockActivityRealtime\(activity\)/);
  assert.match(devElectronApi, /activityList:\s*async \(opts\) => filterMockActivities\(opts\)/);
  assert.match(devElectronApi, /onActivityRealtimeInsert:\s*\(callback\) => \{/);
});
