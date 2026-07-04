// tests/sceneLinkIndex.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from '../electron/presence/sceneLinkIndex.ts';
import type { SupabaseSceneWorkLink } from '../electron/supabase.ts';

let seq = 0;
function lnk(p: Partial<SupabaseSceneWorkLink> & Pick<SupabaseSceneWorkLink, 'sceneUuid' | 'linkKind' | 'path'>): SupabaseSceneWorkLink {
  return {
    id: `id-${seq++}`, department: 'bg', label: null, sortOrder: 0,
    createdBy: null, createdAt: '', updatedBy: null, updatedAt: '',
    ...p,
  } as SupabaseSceneWorkLink;
}

test('primary_file만 인덱싱하고 basename 소문자 키', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\show\\EP2\\B030.moho' }),
    lnk({ sceneUuid: 's1', linkKind: 'folder', path: 'G:\\show\\EP2' }),
  ]);
  assert.deepEqual([...(idx.get('b030.moho') ?? [])], ['s1']);
  assert.equal(idx.has('ep2'), false);
});
test('해석: basename → sceneUuid 유니크', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\a\\b030.moho' }),
    lnk({ sceneUuid: 's2', linkKind: 'primary_file', path: 'G:\\a\\b031.moho' }),
  ]);
  const r = resolveScenesForBasenames(idx, ['b030.moho', 'nomatch.moho']);
  assert.deepEqual(r.sceneUuids, ['s1']);
  assert.deepEqual(r.collisions, []);
});
test('콜리전: 동명 파일 다른 폴더 → 전 sceneUuid + collision 보고', () => {
  const idx = buildPrimaryFileBasenameIndex([
    lnk({ sceneUuid: 's1', linkKind: 'primary_file', path: 'G:\\ep1\\b030.moho' }),
    lnk({ sceneUuid: 's2', linkKind: 'primary_file', path: 'G:\\ep2\\b030.moho' }),
  ]);
  const r = resolveScenesForBasenames(idx, ['b030.moho']);
  assert.deepEqual(r.sceneUuids.sort(), ['s1', 's2']);
  assert.deepEqual(r.collisions, ['b030.moho']);
});
