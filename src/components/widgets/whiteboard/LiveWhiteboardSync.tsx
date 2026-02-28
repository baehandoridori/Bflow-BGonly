import { useEffect, useRef } from 'react';
import { LiveObject } from '@liveblocks/client';
import { useMutation, useStorage, useUpdateMyPresence } from '@liveblocks/react';
import type { WhiteboardEngine } from './useWhiteboardEngine';
import type { LbStroke } from '@/liveblocks.config';
import type { WhiteboardStroke, StrokePoint, WhiteboardLayer } from '@/types/whiteboard';

// ─── 변환 유틸 ──────────────────────────────────────────────

function strokeToLb(s: WhiteboardStroke): LbStroke {
  const points: number[] = [];
  for (const p of s.points) points.push(p.x, p.y);
  return {
    id: s.id, points, color: s.color, width: s.width,
    layerId: s.layerId, tool: s.tool,
    userId: s.userId, userName: s.userName, timestamp: s.timestamp,
  };
}

// ─── Props ──────────────────────────────────────────────────

interface LiveWhiteboardSyncProps {
  engine: WhiteboardEngine;
  userId: string;
  userName: string;
}

/**
 * Liveblocks Storage ↔ useWhiteboardEngine 양방향 동기화 브릿지.
 *
 * 핵심 설계:
 * - useStorage 셀렉터는 반드시 **원시 문자열**만 반환 (새 객체/배열 생성 금지 → 무한 리렌더 방지)
 * - 실제 데이터 읽기는 useMutation 내에서 동기적으로 수행 (storage 직접 접근)
 * - 엔진→Liveblocks 방향은 ID diff 비교로 불필요한 푸시 자동 차단
 */
export function LiveWhiteboardSync({ engine, userId, userName }: LiveWhiteboardSyncProps) {
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const updateMyPresence = useUpdateMyPresence();

  const initializedRef = useRef(false);
  const lastSyncedStrokeIdsRef = useRef<Set<string>>(new Set());
  const lastSyncedLayerKeyRef = useRef('');

  // ── Presence ──
  useEffect(() => {
    updateMyPresence({
      activeTool: engine.state.tool,
      activeColor: engine.state.color,
      userName,
    });
  }, [engine.state.tool, engine.state.color, userName, updateMyPresence]);

  // ── 안정적 키 셀렉터 (원시 문자열만 반환!) ──
  // useStorage가 Object.is로 비교하므로, 같은 문자열이면 리렌더 안 됨

  const remoteStrokeKey = useStorage((root) => {
    const ids: string[] = [];
    root.strokes.forEach((_val, key) => ids.push(key));
    return ids.sort().join(',');
  });

  const remoteLayerKey = useStorage((root) => {
    const parts: string[] = [];
    root.layers.forEach((l, key) => parts.push(`${key}:${l.name}:${l.visible}:${l.order}`));
    const order = Array.from(root.layerOrder).join(',');
    return parts.sort().join('|') + ';' + order;
  });

  // ── 동기적 Storage 읽기 (useMutation으로 storage 직접 접근) ──

  const readRemoteData = useMutation(({ storage }) => {
    const strokes: WhiteboardStroke[] = [];
    storage.get('strokes').forEach((s) => {
      const flat = s.get('points');
      const points: StrokePoint[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        points.push({ x: flat[i], y: flat[i + 1] });
      }
      strokes.push({
        id: s.get('id'), points, color: s.get('color'), width: s.get('width'),
        layerId: s.get('layerId'), tool: s.get('tool'),
        userId: s.get('userId'), userName: s.get('userName'), timestamp: s.get('timestamp'),
      });
    });

    const orderList = Array.from(storage.get('layerOrder')) as string[];
    const orderMap = new Map(orderList.map((id, idx) => [id, idx]));
    const layers: WhiteboardLayer[] = [];
    storage.get('layers').forEach((l) => {
      layers.push({
        id: l.get('id'), name: l.get('name'),
        visible: l.get('visible'), order: l.get('order'),
      });
    });
    layers.sort((a, b) => (orderMap.get(a.id) ?? a.order) - (orderMap.get(b.id) ?? b.order));

    return { strokes, layers };
  }, []);

  // ── Liveblocks → 엔진: 원격 키가 변경될 때만 데이터 읽고 적용 ──

  useEffect(() => {
    if (remoteStrokeKey === null || remoteLayerKey === null) return;

    const data = readRemoteData();

    engineRef.current.setStrokes(data.strokes);
    if (data.layers.length > 0) engineRef.current.setLayers(data.layers);

    // 동기화 상태 갱신 — 엔진→LB 효과의 diff에서 "변경 없음"으로 판정되도록
    lastSyncedStrokeIdsRef.current = new Set(data.strokes.map((s) => s.id));
    lastSyncedLayerKeyRef.current = JSON.stringify(
      data.layers.map((l) => `${l.id}:${l.name}:${l.visible}:${l.order}`).sort(),
    );

    if (!initializedRef.current) initializedRef.current = true;
  }, [remoteStrokeKey, remoteLayerKey, readRemoteData]);

  // ── 쓰기 Mutations ──

  const pushStrokesToLb = useMutation(({ storage }, strokes: WhiteboardStroke[], toRemove: string[]) => {
    const strokeMap = storage.get('strokes');
    for (const id of toRemove) strokeMap.delete(id);
    for (const s of strokes) strokeMap.set(s.id, new LiveObject(strokeToLb(s)));
  }, []);

  const pushLayersToLb = useMutation(({ storage }, layers: WhiteboardLayer[]) => {
    const layerMap = storage.get('layers');
    const layerOrder = storage.get('layerOrder');

    const existingIds = new Set<string>();
    layerMap.forEach((_val, key) => existingIds.add(key));
    const newIds = new Set(layers.map((l) => l.id));

    // 삭제
    for (const id of existingIds) {
      if (!newIds.has(id)) {
        layerMap.delete(id);
        const strokeMap = storage.get('strokes');
        const toDelete: string[] = [];
        strokeMap.forEach((s, key) => {
          if (s.get('layerId') === id) toDelete.push(key);
        });
        for (const key of toDelete) strokeMap.delete(key);
      }
    }

    // 추가/업데이트
    for (const l of layers) {
      const existing = layerMap.get(l.id);
      if (existing) {
        existing.set('name', l.name);
        existing.set('visible', l.visible);
        existing.set('order', l.order);
      } else {
        layerMap.set(l.id, new LiveObject({ id: l.id, name: l.name, visible: l.visible, order: l.order }));
      }
    }

    // layerOrder 갱신
    while (layerOrder.length > 0) layerOrder.delete(0);
    const sorted = [...layers].sort((a, b) => a.order - b.order);
    for (const l of sorted) layerOrder.push(l.id);
  }, []);

  const clearAllLb = useMutation(({ storage }) => {
    const strokes = storage.get('strokes');
    const keys: string[] = [];
    strokes.forEach((_val, key) => keys.push(key));
    for (const key of keys) strokes.delete(key);
  }, []);

  // ── 엔진 → Liveblocks: ID diff 비교로 실제 변경분만 푸시 ──
  // (원격 동기화로 인한 setState는 diff가 0이므로 자동 차단됨)

  useEffect(() => {
    if (!initializedRef.current) return;

    const currentStrokes = engine.state.strokes;
    const currentIds = new Set(currentStrokes.map((s) => s.id));
    const lastIds = lastSyncedStrokeIdsRef.current;

    const added = currentStrokes.filter((s) => !lastIds.has(s.id));
    const removed: string[] = [];
    for (const id of lastIds) {
      if (!currentIds.has(id)) removed.push(id);
    }

    if (added.length === 0 && removed.length === 0) return;

    if (currentStrokes.length === 0 && lastIds.size > 0) {
      clearAllLb();
    } else {
      pushStrokesToLb(added, removed);
    }

    lastSyncedStrokeIdsRef.current = currentIds;
  }, [engine.state.strokes, pushStrokesToLb, clearAllLb]);

  useEffect(() => {
    if (!initializedRef.current) return;

    const layers = engine.state.layers;
    const key = JSON.stringify(layers.map((l) => `${l.id}:${l.name}:${l.visible}:${l.order}`).sort());
    if (key === lastSyncedLayerKeyRef.current) return;
    lastSyncedLayerKeyRef.current = key;

    pushLayersToLb(layers);
  }, [engine.state.layers, pushLayersToLb]);

  return null;
}
