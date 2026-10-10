// tests/sceneLinkIndex.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
// 이 확인을 test:scene-links의 파일 안에 두면 그 스크립트가 빌드에서 빠질 때 감시도 함께 사라진다 — 그래서 test:presence의 이 파일이 지킨다.
test('씬 작업 링크 테스트가 빌드에 들어 있다', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.match(scripts['test:scene-links'], /\.\/tests\/sceneWorkLinks\.test\.ts/);
  assert.match(scripts['test:scene-links'], /\.\/tests\/sceneWorkLinkCardBadges\.test\.ts/);
  assert.match(scripts['test:scene-links'], /\.\/tests\/sceneFileNameList\.test\.ts/);
  assert.match(scripts['test:scene-links'], /\.\/tests\/sceneBulkWorkLink\.test\.ts/);
  assert.match(scripts['test:scene-links'], /\.\/tests\/sceneBulkWorkLinkWiring\.test\.ts/);
  assert.match(scripts.build, /npm run test:scene-links &&/);
  assert.match(scripts['build:vite'], /npm run test:scene-links &&/);
});
