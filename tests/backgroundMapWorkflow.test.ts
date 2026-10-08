import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectMap, createMapAndConnect, mapCanNest, mapSaveWasApplied, moveMapChanges, saveMapChanges } from '../src/features/backgrounds/mapWorkflow.ts';
import { applyBackgroundCommand, emptyBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import type { BackgroundCamera, BackgroundMap, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';

const map = (name: string, parentId: string | null = null): BackgroundMap => ({ id: randomUUID(), revision: 1, name, parentId, placeId: null, imageUrl: '', nodes: [] });
const space = (childMapId: string | null = null): BackgroundSpace => ({ id: randomUUID(), name: '공간', type: 'space', childMapId, placeId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, shape: 'rect', points: [], locked: false });

test('공간에서 상세 도면을 만들면 부모의 작성 중 내용과 연결을 함께 저장한다', () => {
  const parent = map('학교'), entrance = space();
  parent.nodes = [entrance];
  const snapshot = { ...emptyBackgroundSnapshot(true), maps: [parent] };
  const edited = { ...parent, name: '학교 수정 중' };
  const child = { ...map('자료실', parent.id), revision: 0 };
  const command = createMapAndConnect(snapshot, { [parent.id]: { value: edited, baseRevision: 1 } }, child, entrance.id);
  const result = applyBackgroundCommand(snapshot, command, { canManage: true });
  assert.equal(result.maps.find(item => item.id === parent.id)?.name, '학교 수정 중');
  assert.equal((result.maps.find(item => item.id === parent.id)?.nodes[0] as BackgroundSpace).childMapId, child.id);
  assert.equal(result.maps.find(item => item.id === child.id)?.revision, 1);
});

test('기존 도면을 다른 공간에 연결하면 이전 입구만 해제하고 자손과 다른 초안을 보존한다', () => {
  const oldParent = map('학교'), newParent = map('별관'), child = map('교실', oldParent.id), descendant = map('창고', child.id);
  oldParent.nodes = [space(child.id), space(child.id)]; newParent.nodes = [space()]; child.nodes = [space(descendant.id)];
  const snapshot = { ...emptyBackgroundSnapshot(true), maps: [oldParent, newParent, child, descendant] };
  const drafts = { [oldParent.id]: { value: { ...oldParent, name: '학교 편집 중' }, baseRevision: 1 } };
  const command = connectMap(snapshot, drafts, newParent.id, newParent.nodes[0].id, child.id);
  const result = applyBackgroundCommand(snapshot, command, { canManage: true });
  assert.equal(result.maps.find(item => item.id === oldParent.id)?.name, '학교 편집 중');
  assert.ok(result.maps.find(item => item.id === oldParent.id)?.nodes.every(node => node.type === 'space' && node.childMapId === null));
  assert.equal(result.maps.find(item => item.id === child.id)?.parentId, newParent.id);
  assert.deepEqual(result.maps.find(item => item.id === descendant.id), descendant);
  assert.equal(mapCanNest(snapshot.maps, oldParent.id, descendant.id), false);
});

test('같은 부모의 추가 연결과 연결 해제는 다른 입구나 원본 도면을 바꾸지 않는다', () => {
  const parent = map('학교'), child = map('교실', parent.id);
  parent.nodes = [space(child.id), space()];
  const snapshot = { ...emptyBackgroundSnapshot(true), maps: [parent, child] };
  const command = connectMap(snapshot, {}, parent.id, parent.nodes[1].id, child.id);
  assert.equal(command.maps.length, 1);
  const linked = applyBackgroundCommand(snapshot, command, { canManage: true });
  const result = applyBackgroundCommand(linked, connectMap(linked, {}, parent.id, parent.nodes[0].id, null), { canManage: true });
  assert.equal((result.maps[0].nodes[1] as BackgroundSpace).childMapId, child.id);
  assert.deepEqual(result.maps[1], child);
});

test('아직 저장하지 않은 부모도 포함하며 이동 순환과 잠긴 공간 연결을 막는다', () => {
  const parent = map('학교'), child = map('교실', parent.id);
  parent.nodes = [space(child.id)];
  const drafts = { [parent.id]: { value: parent, baseRevision: null }, [child.id]: { value: child, baseRevision: null } };
  const command = saveMapChanges(emptyBackgroundSnapshot(true), drafts, [child]);
  assert.equal(command.maps.length, 2);
  assert.ok(command.maps.every(item => item.expectedRevision === null));
  assert.doesNotThrow(() => applyBackgroundCommand(emptyBackgroundSnapshot(true), command, { canManage: true }));
  assert.throws(() => moveMapChanges([parent, child], { ...parent, parentId: child.id }), /하위 도면/);
  parent.nodes[0].locked = true;
  assert.throws(() => connectMap({ ...emptyBackgroundSnapshot(true), maps: [parent, child] }, {}, parent.id, parent.nodes[0].id, null), /잠금/);
});

const spatialKeys = ['elevation', 'volumeHeight', 'pitch', 'roll', 'aspect'];
const camera = (): BackgroundCamera => ({ id: randomUUID(), name: '카메라', type: 'camera', spaceId: null, x: 500, y: 340, angle: 90, fov: 60, viewIds: [], locked: false });
const prop = (): BackgroundSymbol => ({ id: randomUUID(), name: '책상', type: 'symbol', symbol: 'table', spaceId: null, x: 200, y: 200, width: 120, height: 60, rotation: 15, locked: false, hinge: 'left', swing: 'inward' });
/** Rebuild every object with its keys in the opposite order, as a server is free to return them. */
const reversed = <T>(value: T): T => (Array.isArray(value) ? value.map(reversed)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)])) : value) as T;

test('응답 유실 복구는 높이·기울기·화면 비율까지 보낸 값 그대로일 때만 저장 완료로 본다', () => {
  const entity: BackgroundMap = { ...map('입체 도면'), revision: 0, nodes: [
    { ...space(), elevation: -12.5, volumeHeight: 260.75 },
    { ...camera(), elevation: 120.25, pitch: -90, roll: -33.5, aspect: 16 / 9 },
    { ...prop(), elevation: 35.125, volumeHeight: 80.5, pitch: -45.5, roll: 12.25 },
    camera(),
  ] };
  const command = { type: 'save-maps' as const, maps: [{ entity, expectedRevision: null }] };
  const stored = applyBackgroundCommand(emptyBackgroundSnapshot(true), command, { canManage: true });
  assert.equal(mapSaveWasApplied(stored, command), true);
  // Key order is not part of the comparison, in either direction or after a JSON roundtrip.
  assert.notEqual(JSON.stringify(reversed(stored.maps)), JSON.stringify(stored.maps));
  assert.equal(mapSaveWasApplied({ ...stored, maps: reversed(stored.maps) }, command), true);
  assert.equal(mapSaveWasApplied(stored, reversed(command)), true);
  assert.equal(mapSaveWasApplied(JSON.parse(JSON.stringify(reversed(stored))), command), true);
  let compared = 0;
  for (const [index, node] of entity.nodes.entries()) for (const key of spatialKeys) if (key in node) {
    const changed = structuredClone(stored), dropped = structuredClone(stored);
    (changed.maps[0].nodes[index] as unknown as Record<string, number>)[key] += 0.25;
    delete (dropped.maps[0].nodes[index] as unknown as Record<string, number>)[key];
    assert.equal(mapSaveWasApplied(changed, command), false, `${node.type}.${key} changed`);
    assert.equal(mapSaveWasApplied(dropped, command), false, `${node.type}.${key} dropped`);
    compared++;
  }
  assert.equal(compared, 10);
  // A store that filled in a default for the plain camera would no longer match what was sent.
  const filled = structuredClone(stored);
  Object.assign(filled.maps[0].nodes[3], { elevation: 120, pitch: 0, roll: 0, aspect: 16 / 9 });
  assert.equal(mapSaveWasApplied(filled, command), false);
  assert.equal(mapSaveWasApplied({ ...stored, maps: stored.maps.map(item => ({ ...item, revision: 2 })) }, command), false);
});

test('도면 연결과 초안 저장은 공간·카메라·사물의 높이 값을 그대로 실어 보낸다', () => {
  const parent = map('학교'), child = map('교실');
  const entrance = { ...space(), elevation: 40, volumeHeight: 300 }, lens = { ...camera(), elevation: 150.5, pitch: 90, roll: 7.25, aspect: 2.39 };
  const desk = { ...prop(), elevation: 12.5, volumeHeight: 75, pitch: 30, roll: -15 };
  parent.nodes = [entrance, lens, desk];
  const snapshot = { ...emptyBackgroundSnapshot(true), maps: [parent, child] };
  const linked = connectMap(snapshot, {}, parent.id, entrance.id, child.id);
  assert.deepEqual(linked.maps.find(item => item.entity.id === parent.id)?.entity.nodes, [{ ...entrance, childMapId: child.id }, lens, desk]);
  const result = applyBackgroundCommand(snapshot, linked, { canManage: true });
  assert.deepEqual(result.maps.find(item => item.id === parent.id)?.nodes, [{ ...entrance, childMapId: child.id }, lens, desk]);
  assert.equal(mapSaveWasApplied(result, linked), true);
  // An edited draft is sent exactly as edited, and only that draft's values count as saved.
  const draft = { ...parent, nodes: [entrance, { ...lens, pitch: -90 }, desk] };
  const saved = saveMapChanges(snapshot, { [parent.id]: { value: draft, baseRevision: 1 } }, [draft]);
  assert.deepEqual(saved.maps, [{ entity: draft, expectedRevision: 1 }]);
  const after = applyBackgroundCommand(snapshot, saved, { canManage: true });
  assert.equal(mapSaveWasApplied(after, saved), true);
  assert.equal(mapSaveWasApplied(after, saveMapChanges(snapshot, {}, [parent])), false);
});
