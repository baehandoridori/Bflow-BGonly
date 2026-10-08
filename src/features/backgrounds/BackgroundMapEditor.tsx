import { Component, Fragment, Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Move3d, Orbit, Rotate3d, Scale3d } from 'lucide-react';
import type { BackgroundCamera, BackgroundCommand, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSnapshot, BackgroundSpace, BackgroundSymbol, BackgroundSymbolKind } from './types';
import { BackgroundModal, EmptyState, Field, uploadBackgroundImage } from './BackgroundUI';
import { BackgroundMapGallery } from './BackgroundMapGallery';
import { BackgroundMapPanels } from './BackgroundMapPanels';
import { BackgroundMapPlanPreview } from './BackgroundMapPlanPreview';
import { MapNodeHandles } from './BackgroundMapPlanOverlays';
import { addMapCamera, containsPoint, moveMapNode, polygonSpace, removeMapNode, resizeSpace, transformMapSpace } from './mapGeometry';
import { MAP_SPATIAL_DEFAULTS, MAP_SPATIAL_LIMITS, cameraAngles, cameraAspect, cameraPitchLabel, nodeAngles, nodeElevation, nodePlanOutline, nodeVolumeHeight, projectCameraToPlan } from './mapSpatial';
import { MAP_LABEL_SCALE_LIMITS, fieldEditStartMap, fitMapViewport, gestureStartMap, mapDraft, mapDraftChanged, mapScreenScale, mapViewport, revealPlanPoint, wheelZoomFactor, zoomMapViewport, zoomMapViewportAt } from './mapDocument';
import { MAP_EDIT_MARK } from './mapPlanEdit';
import { planNodeCovers, planStackUnder } from './mapPlanPreview';
import type { MapUpdateOptions, MapViewport } from './mapDocument';
import { useBackgroundMapDocument } from './useBackgroundMapDocument';
import type { Map3DGizmoMode, Map3DViewState, MapDisplayMode } from './mapCanvas';
import { backgroundMapPath } from './domain';
import { connectMap, createMapAndConnect, effectiveMaps, mapCanNest, moveMapChanges, saveMapChanges, type MapSaveCommand } from './mapWorkflow';
import { BackgroundSymbolGlyph, SymbolIcon } from './BackgroundSymbolGlyph';
import { getSymbolPreset, symbolCatalog } from './symbolCatalog';
import './backgrounds-map.css';

type Props = { snapshot: BackgroundSnapshot; pending: boolean; execute: (command: BackgroundCommand) => Promise<void>; onOpenView: (id: string, variantId?: string) => void; onOpenCatalog: () => void };
/** `hand` pans the plan and orbits the 3D world. The drawing tools exist on the plan only. */
type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'polygon' | 'symbol';
type CreateForm = { id: string; name: string; parentId: string | null; spaceId: string | null; placeId: string | null };
/** One pressed pointer on the plan. `pan` and `click` never touch the document. */
type PointerSession = {
  mode: 'pan' | 'click' | 'move' | 'resize' | 'rotate' | 'draw'; pointerId: number;
  mapId: string; initial: BackgroundMap; node?: BackgroundNode; start: BackgroundPoint;
  clientX: number; clientY: number; matrix: DOMMatrix; view: MapViewport; moved: boolean;
  /** Overlapping cameras and symbols under the press: a plain click steps to the next one. */
  stack: string[] | null;
};
const message = (error: unknown) => error instanceof Error ? error.message : '도면을 저장하지 못했습니다. 다시 시도해 주세요.';
const angle = (point: BackgroundPoint, center: BackgroundPoint) => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const uuid = () => crypto.randomUUID();
const round = (value: number) => Math.round(value * 100) / 100;
const isDrawTool = (tool: Tool) => tool === 'rect' || tool === 'ellipse' || tool === 'polygon';
/** Where a key is text. Both selectors below are built on it, so a new kind of text field reaches both. */
const textFields = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const interactive = `${textFields}, button`;
/** Where a key is text, or belongs to an open dialog: the plan shortcuts leave it alone. */
const textEntry = `${textFields}, dialog`;
const UNAVAILABLE_3D = '3D 화면을 사용할 수 없어 평면으로 돌아왔어요. 편집 내용은 그대로예요.';
const GIZMO_MODES: { id: Map3DGizmoMode; label: string; Icon: typeof Move3d; hint: string }[] = [
  { id: 'translate', label: '이동', Icon: Move3d, hint: '화살표를 끌어 옮기기' },
  { id: 'rotate', label: '회전', Icon: Rotate3d, hint: '고리를 끌어 돌리기' },
  { id: 'scale', label: '크기', Icon: Scale3d, hint: '손잡이를 끌어 크기 바꾸기' },
];
const ASPECT_PRESETS = [{ label: '16:9', value: 16 / 9 }, { label: '4:3', value: 4 / 3 }, { label: '1:1', value: 1 }, { label: '2.39:1', value: 2.39 }, { label: '9:16', value: 9 / 16 }];
const PITCH_PRESETS = [{ label: '수평', pitch: 0 }, { label: '수직 위', pitch: 90 }, { label: '수직 아래', pitch: -90 }];
/** Saved bounds of plan positions and sizes. */
const PLAN_LIMIT = 100000, MIN_PLAN_SIZE = 10;
/** What the plan draws for a camera or symbol lies under this point: the camera's dot (ring when vertical) or fan, the symbol's box. */
const onPlanMark = (node: BackgroundNode, point: BackgroundPoint) =>
  planNodeCovers(node, point, node.type !== 'camera' ? 0 : projectCameraToPlan(node).vertical ? 18 : 12, 80);

function mapPath(maps: BackgroundMap[], id: string): BackgroundMap[] {
  return backgroundMapPath({ maps, places: [], views: [], groups: [], usages: [], canManage: false }, id);
}

/** A stable function that always runs the handler of the latest render. */
function useEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler);
  latest.current = handler;
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * Number input that keeps what is being typed. A value inside the limits applies at once; an
 * unfinished or out-of-range entry ("-", or "1" on the way to "150") waits until the field is left.
 */
function NumberField({ label, value, onChange, onDone, min = -Infinity, max = Infinity, disabled = false }: { label: string; value: number; onChange: (value: number) => void; onDone?: () => void; min?: number; max?: number; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const parse = (raw: string) => { const next = raw.trim() === '' ? Number.NaN : Number(raw); return Number.isFinite(next) ? next : null; };
  return <Field label={label}><input type="number" step="any" value={text ?? round(value)} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} disabled={disabled}
    onChange={event => {
      const raw = event.target.value, next = parse(raw);
      setText(raw);
      if (next !== null && next >= min && next <= max && next !== value) onChange(next);
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={() => {
      const next = text === null ? null : parse(text), clamped = next === null ? value : Math.min(max, Math.max(min, next));
      // An entry outside the limits lands on the nearest limit; when that is the value it already has, nothing is edited.
      if (clamped !== next && clamped !== value) onChange(clamped);
      setText(null); onDone?.();
    }} /></Field>;
}

const load3D = () => import('./BackgroundMap3D');
/** three.js stays out of the main chunk until the 3D mode is opened. */
let Map3D = lazy(load3D);

/** Catches a failed chunk load or a render error of the 3D viewport, so the editor can return to the plan. */
class Map3DBoundary extends Component<{ onFail: (reason: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    // A rejected lazy import stays rejected: start a fresh one for the next attempt.
    Map3D = lazy(load3D);
    this.props.onFail(error instanceof Error ? error.message : String(error));
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const kindLabel = (node: BackgroundNode) => node.type === 'camera' ? '카메라' : node.type === 'space' ? '공간' : getSymbolPreset(node.symbol).label;

/** Every placement of the map, so items hidden under others (cameras on one spot) can each be picked. */
const ObjectList = memo(function ObjectList({ nodes, selectedId, onSelect }: { nodes: BackgroundNode[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const ordered = [...nodes.filter(node => node.type === 'camera'), ...nodes.filter(node => node.type === 'symbol'), ...nodes.filter(node => node.type === 'space')];
  return <section className="bmap-objects" aria-label="오브젝트 목록">
    <div className="bmap-section-heading"><strong>오브젝트</strong><span className="bmap-badge">{ordered.length}개</span></div>
    {ordered.length ? <ul className="bmap-node-list">{ordered.map(node => <li key={node.id}>
      <button type="button" className={node.id === selectedId ? 'is-selected' : ''} aria-current={node.id === selectedId ? 'true' : undefined} aria-label={`${node.name || '이름 없음'}, ${kindLabel(node)}${node.locked ? ', 잠김' : ''}`} onClick={() => onSelect(node.id)}>
        <span className={`bmap-node-kind is-${node.type}`} aria-hidden="true">{node.type === 'camera' ? '◉' : node.type === 'symbol' ? <SymbolIcon symbol={node.symbol} size={16} /> : node.shape === 'ellipse' ? '◯' : node.shape === 'polygon' ? '⬡' : '▭'}</span>
        <span className="bmap-node-name">{node.name || '이름 없음'}</span>
        {node.locked && <span className="bmap-node-lock" aria-hidden="true">🔒</span>}
        <span className="bmap-node-type" aria-hidden="true">{kindLabel(node)}</span>
      </button>
    </li>)}</ul> : <p className="bmap-hint">아직 배치된 것이 없어요.</p>}
  </section>;
});

export function BackgroundMapEditor({ snapshot, pending, execute, onOpenView, onOpenCatalog }: Props) {
  const doc = useBackgroundMapDocument();
  const { state } = doc, drafts = state.drafts;
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapDisplayMode>('plan');
  const [tool, setTool] = useState<Tool>('select');
  const [gizmoMode, setGizmoMode] = useState<Map3DGizmoMode>('translate');
  const [lookThrough, setLookThrough] = useState<{ mapId: string; id: string } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [symbolKind, setSymbolKind] = useState<BackgroundSymbolKind>('door');
  const [symbolPaletteOpen, setSymbolPaletteOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [polygon, setPolygon] = useState<BackgroundPoint[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [linkForm, setLinkForm] = useState<{ spaceId: string; mapId: string; search: string } | null>(null);
  const [settingsForm, setSettingsForm] = useState<BackgroundMap | null>(null);
  const settingsRevision = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<'discard' | 'delete-map' | 'delete-node' | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 680 });
  const pointerRef = useRef<PointerSession | null>(null);
  const lastDrag = useRef(0);
  /** Orbit pose of the 3D viewport per map. UI state only: never history, never a render. */
  const viewStates = useRef<Record<string, Map3DViewState>>({});
  const focusNonce = useRef(0);
  const handledEscape = useRef<Event | null>(null);
  const maps = useMemo(() => effectiveMaps(snapshot, drafts), [snapshot, drafts]);
  const current = maps.find(map => map.id === currentId) ?? maps[0];
  const draft = mapDraft(state, current?.id);
  const view = mapViewport(state, current?.id);
  const selected = current?.nodes.find(node => node.id === view.selectedId);
  const disabled = pending || busy;
  const editing = !!draft && snapshot.canManage;
  const canEdit = editing && !disabled;
  const gestureActive = state.gesture !== null;
  const lookThroughId = mode === '3d' && lookThrough && lookThrough.mapId === current?.id && selected?.type === 'camera' && lookThrough.id === selected.id ? lookThrough.id : null;
  const screenScale = mapScreenScale(view.zoom, canvasSize);
  const labelScale = Math.min(MAP_LABEL_SCALE_LIMITS.max, Math.max(MAP_LABEL_SCALE_LIMITS.min, screenScale));
  // The image grid reads the maps as they were when a gesture started, so it does not recompute on every frame.
  const settledMapsRef = useRef(maps);
  if (!gestureActive) settledMapsRef.current = maps;
  const settledMaps = settledMapsRef.current;
  const settledCurrent = current && (gestureStartMap(state, current.id) ?? current);
  const settledSelected = settledCurrent?.nodes.find(node => node.id === view.selectedId);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCanvasSize({ width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [current?.id, mode]);
  /**
   * The wheel over the plan zooms about the pointer. It is always swallowed, so a narrow window does not scroll
   * instead, and the view is read from the store: a fast wheel outruns the renders.
   */
  const onWheel = useEvent((event: WheelEvent) => {
    event.preventDefault();
    if (!current || pointerRef.current || doc.isGestureActive()) return;
    const anchor = pointFrom(event);
    if (!anchor) return;
    const live = mapViewport(doc.getState(), current.id);
    const zoomed = zoomMapViewportAt(live, wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey), anchor);
    if (zoomed !== live) updateView({ zoom: zoomed.zoom, x: zoomed.x, y: zoomed.y });
  });
  // A native listener, because React listens to the wheel passively. The plan SVG is replaced by the 3D mode,
  // so it is attached again on the dependencies of the size observer above.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [onWheel, current?.id, mode]);
  useEffect(() => { if (!snapshot.canManage) { setTool('select'); setPolygon([]); setSymbolPaletteOpen(false); } }, [snapshot.canManage]);

  /** Ends the pressed pointer and cancels the gesture in progress. Nothing of it reaches the history. */
  const abortGesture = useEvent(() => {
    const session = pointerRef.current;
    pointerRef.current = null;
    if (session && svgRef.current?.hasPointerCapture(session.pointerId)) svgRef.current.releasePointerCapture(session.pointerId);
    doc.cancelGesture();
  });
  // Another map, the other display mode, a save starting or lost edit rights never commit a half-done drag.
  useLayoutEffect(() => { abortGesture(); }, [abortGesture, current?.id, mode, canEdit]);
  useEffect(() => abortGesture, [abortGesture]);
  useEffect(() => {
    if (!gestureActive) return;
    // Escape cancels wherever the focus is; the 3D canvas does not have to hold it.
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { handledEscape.current = event; abortGesture(); } };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [gestureActive, abortGesture]);
  // Looking through a camera ends when the selection, the map or the mode moves away from it.
  useEffect(() => {
    setLookThrough(previous => previous && mode === '3d' && previous.mapId === current?.id && previous.id === view.selectedId ? previous : null);
  }, [view.selectedId, current?.id, mode]);

  /** Cancels a gesture in progress and returns the drafts and maps without its preview. */
  function settle() {
    abortGesture();
    const settledDrafts = doc.getState().drafts;
    return { drafts: settledDrafts, maps: effectiveMaps(snapshot, settledDrafts) };
  }
  function select(id: string | null, mapId = current?.id) { if (mapId) doc.select(mapId, id); }
  function updateView(changes: Partial<Pick<MapViewport, 'x' | 'y' | 'zoom'>>, mapId = current?.id) { if (mapId) doc.setViewport(mapId, changes); }
  function focusCanvas() { (mode === 'plan' ? svgRef.current : stageRef.current)?.focus({ preventScroll: true }); }
  function navigate(id: string) { if (disabled) return; abortGesture(); setCurrentId(id); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); setConfirmation(null); }
  function switchMode(next: MapDisplayMode) {
    if (next === mode) return;
    abortGesture();
    // Drawing a space is a plan tool: an unfinished polygon does not follow into 3D.
    if (mode === 'plan') { setPolygon([]); if (isDrawTool(tool)) setTool('select'); }
    if (next === '3d') setNotice('');
    setSymbolPaletteOpen(false); setLookThrough(null); setFocusRequest(null);
    setMode(next);
  }
  const leave3D = useEvent((reason: string) => {
    // A late report from a viewport that is already closed changes nothing.
    if (mode !== '3d') return;
    console.warn('[background-map] 3D view unavailable:', reason);
    abortGesture();
    setMode('plan'); setLookThrough(null); setFocusRequest(null); setSymbolPaletteOpen(false);
    setNotice(UNAVAILABLE_3D);
  });
  function expandPath(id: string) {
    const ancestors = mapPath(maps, id).map(map => map.id);
    setCollapsed(previous => new Set([...previous].filter(item => !ancestors.includes(item))));
  }
  function openCreate(parentId: string | null, space?: BackgroundSpace) {
    setError('');
    setCreateForm({ id: uuid(), name: space?.name ?? '', parentId, spaceId: space?.id ?? null, placeId: space?.placeId ?? null });
  }
  function openSettings() {
    if (!current || disabled) return;
    if (polygon.length) { setError('그리는 중인 다각형을 먼저 완성하거나 취소해 주세요.'); return; }
    const source = settle().maps.find(map => map.id === current.id);
    if (!source) return;
    settingsRevision.current = draft ? draft.baseRevision : source.revision;
    setSettingsForm(structuredClone(source)); setError('');
  }
  async function persistMaps(command: MapSaveCommand) {
    await execute(command);
    doc.dropDrafts(command.maps.map(item => item.entity.id));
  }
  function enterNewMap(map: BackgroundMap) {
    doc.enterNewMap(map);
    setCurrentId(map.id); setPolygon([]); setTool(mode === 'plan' ? 'rect' : 'select'); setError('');
    if (map.parentId) expandPath(map.parentId);
  }
  function updateMap(next: BackgroundMap, options?: MapUpdateOptions) {
    if (snapshot.canManage) doc.update(next, options);
  }
  /**
   * `field` joins the keystrokes of one input into one undo step. Each keystroke is applied to the map as it was when
   * that field edit began, so the members of a space are scaled once, from their real sizes, whatever was typed on the way.
   */
  function patchNode(changes: Partial<BackgroundNode>, field?: string) {
    if (!current || !selected || !canEdit) return;
    const key = field ? `${selected.id}:${field}` : undefined;
    const base = (key && fieldEditStartMap(doc.getState(), current.id, key)) || current;
    const next = { ...(base.nodes.find(node => node.id === selected.id) ?? selected), ...changes } as BackgroundNode;
    updateMap(next.type === 'space' ? transformMapSpace(base, next) : { ...base, nodes: base.nodes.map(node => node.id === next.id ? next : node) },
      key ? { coalesceKey: key } : undefined);
  }
  function moveSelected(delta: BackgroundPoint, field: string) {
    if (!current || !selected || !canEdit) return;
    updateMap(moveMapNode(current, selected.id, delta), { coalesceKey: `${selected.id}:${field}` });
  }
  function duplicateSymbol() {
    if (!current || selected?.type !== 'symbol' || !canEdit || pointerRef.current || doc.isGestureActive()) return;
    const copy: BackgroundSymbol = { ...selected, symbol: getSymbolPreset(selected.symbol).id, id: uuid(), x: selected.x + 24, y: selected.y + 24, locked: false };
    updateMap({ ...current, nodes: [...current.nodes, copy] });
    select(copy.id); setTool('select');
  }
  /** The new camera always starts at the fixed spot, whatever is clicked, selected or in view. */
  function addCamera() {
    if (!current || !canEdit || pointerRef.current || doc.isGestureActive()) return;
    const { map, camera } = addMapCamera(current, uuid());
    updateMap(map); select(camera.id);
    setTool('select'); setPolygon([]); setSymbolPaletteOpen(false); setError('');
    if (mode === 'plan') {
      // Only the view moves, and only when the fixed spot is out of sight.
      const revealed = revealPlanPoint(view, camera, 24);
      if (revealed !== view) updateView({ x: revealed.x, y: revealed.y });
    } else setFocusRequest({ id: camera.id, nonce: ++focusNonce.current });
  }
  function placeSymbol(point: BackgroundPoint, base = current) {
    if (!base || !canEdit || tool !== 'symbol' || doc.isGestureActive() || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const preset = getSymbolPreset(symbolKind);
    const containingSpace = [...base.nodes].reverse().find(candidate => candidate.type === 'space' && containsPoint(candidate, point));
    // It stands on the floor of its space. A floor on the ground writes no key, so older maps stay as they are.
    const level = containingSpace ? nodeElevation(containingSpace) : MAP_SPATIAL_DEFAULTS.symbolElevation;
    const symbol: BackgroundSymbol = { id: uuid(), type: 'symbol', name: preset.label, symbol: preset.id, x: point.x - preset.width / 2, y: point.y - preset.height / 2, width: preset.width, height: preset.height, rotation: 0, spaceId: containingSpace?.id ?? null, locked: false, hinge: 'left', swing: 'inward',
      ...(Number.isFinite(level) && level !== MAP_SPATIAL_DEFAULTS.symbolElevation ? { elevation: level } : {}) };
    updateMap({ ...base, nodes: [...base.nodes, symbol] }); select(symbol.id); setTool('select');
  }
  function beginEditing() {
    if (!current || !snapshot.canManage || disabled) return;
    doc.beginEditing(current);
    setTool('select'); setError('');
  }
  function undo(redo = false) {
    if (!current || !canEdit || pointerRef.current || doc.isGestureActive()) return;
    if (redo) doc.redo(current.id); else doc.undo(current.id);
    setPolygon([]);
  }
  async function saveMap() {
    if (!current || !draft || !canEdit) return;
    if (!current.name.trim()) { setError('도면 이름을 입력해 주세요.'); return; }
    if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); return; }
    const settled = settle(), captured = settled.maps.find(map => map.id === current.id);
    if (!captured) return;
    setBusy(true); setError('');
    try {
      await persistMaps(saveMapChanges(snapshot, settled.drafts, [captured]));
      setTool('select');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function confirmAction() {
    if (!current || disabled) return;
    if (confirmation === 'delete-node' && selected && canEdit) {
      const source = settle().maps.find(map => map.id === current.id);
      if (source) updateMap(removeMapNode(source, selected.id));
      select(null); setConfirmation(null); return;
    }
    if (confirmation === 'discard') {
      doc.discard(current.id);
      setPolygon([]); setTool('select'); setConfirmation(null); setError(''); return;
    }
    if (confirmation === 'delete-map' && snapshot.canManage) {
      if (draft?.baseRevision === null) {
        doc.discard(current.id);
        setCurrentId(current.parentId); setConfirmation(null); return;
      }
      setBusy(true); setError('');
      try {
        await execute({ type: 'delete', kind: 'map', id: current.id, expectedRevision: draft?.baseRevision ?? current.revision });
        doc.discard(current.id);
        setCurrentId(current.parentId); setConfirmation(null);
      } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
    }
  }
  async function createMap() {
    if (!createForm?.name.trim() || !snapshot.canManage || disabled) return;
    if (polygon.length) { setError('그리는 중인 다각형을 먼저 완성하거나 취소해 주세요.'); return; }
    // Retain the operation's ID, so an acknowledged-late save cannot create a duplicate on retry.
    const existing = snapshot.maps.find(map => map.id === createForm.id);
    if (existing) {
      const linked = !createForm.spaceId || snapshot.maps.find(map => map.id === createForm.parentId)?.nodes.some(node => node.type === 'space' && node.id === createForm.spaceId && node.childMapId === existing.id);
      if (!linked) { setError('도면은 생성되었지만 연결 상태가 바뀌었습니다. 기존 도면 연결에서 선택해 주세요.'); return; }
      if (createForm.parentId) doc.discard(createForm.parentId);
      enterNewMap(existing); setCreateForm(null); return;
    }
    const map: BackgroundMap = { id: createForm.id, revision: 0, name: createForm.name.trim(), parentId: createForm.parentId, placeId: createForm.placeId, imageUrl: '', nodes: [] };
    const settled = settle();
    setBusy(true); setError('');
    try {
      await persistMaps(createMapAndConnect(snapshot, settled.drafts, map, createForm.spaceId));
      enterNewMap({ ...map, revision: 1 }); setCreateForm(null);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function linkMap(childId: string | null, spaceId = linkForm?.spaceId) {
    if (!current || !spaceId || disabled || !snapshot.canManage) return;
    if (polygon.length) { setError('그리는 중인 다각형을 먼저 완성하거나 취소해 주세요.'); return; }
    const settled = settle();
    setBusy(true); setError('');
    try {
      await persistMaps(connectMap(snapshot, settled.drafts, current.id, spaceId, childId));
      if (childId) { expandPath(current.id); setCurrentId(childId); select(null, childId); }
      setLinkForm(null); setTool('select');
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function saveSettings() {
    if (!settingsForm?.name.trim() || disabled || !snapshot.canManage) return;
    const settled = settle();
    setBusy(true); setError('');
    try {
      const value = { ...settingsForm, name: settingsForm.name.trim() };
      await persistMaps(saveMapChanges(snapshot, { ...settled.drafts, [value.id]: { value, baseRevision: settingsRevision.current } }, moveMapChanges(settled.maps, value)));
      if (value.parentId) expandPath(value.parentId);
      setSettingsForm(null);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function uploadUnderlay(file: File) {
    if (!settingsForm || disabled || !snapshot.canManage) return;
    const id = settingsForm.id; setBusy(true); setError('');
    try {
      const imageUrl = await uploadBackgroundImage(file);
      setSettingsForm(previous => previous?.id === id ? { ...previous, imageUrl } : previous);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function newSpace(shape: BackgroundSpace['shape'], origin: BackgroundPoint): BackgroundSpace {
    return { id: uuid(), type: 'space', name: '새 공간', placeId: null, childMapId: null, x: origin.x, y: origin.y, width: 10, height: 10, rotation: 0, shape, points: [], locked: false };
  }
  function finishPolygon() {
    if (!current || !canEdit || doc.isGestureActive()) return;
    const geometry = polygonSpace(polygon);
    if (!geometry) { setError('가로와 세로 길이가 각각 10 이상이 되도록 서로 다른 점 3개 이상을 찍어 주세요.'); return; }
    const node = { ...newSpace('polygon', geometry), ...geometry };
    updateMap({ ...current, nodes: [...current.nodes, node] }); select(node.id); setPolygon([]); setTool('select'); setError('');
  }
  function openSpace(id: string) {
    const node = current?.nodes.find(item => item.id === id);
    if (node?.type === 'space' && node.childMapId && maps.some(map => map.id === node.childMapId)) navigate(node.childMapId);
  }
  function pointFrom(event: { clientX: number; clientY: number }, matrix?: DOMMatrix): BackgroundPoint | null {
    const inverse = matrix ?? svgRef.current?.getScreenCTM()?.inverse();
    if (!inverse) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    return { x: point.x, y: point.y };
  }
  function pointerDown(event: ReactPointerEvent<SVGElement>, node?: BackgroundNode, handle?: 'resize' | 'rotate') {
    if (!current || disabled || pointerRef.current || doc.isGestureActive() || (event.button !== 0 && event.button !== 1)) return;
    const point = pointFrom(event), matrix = svgRef.current?.getScreenCTM()?.inverse();
    if (!point || !matrix) return;
    event.preventDefault(); event.stopPropagation();
    setSymbolPaletteOpen(false);
    svgRef.current?.focus();
    // Taking the focus ends a number entry that was still open, and that may have edited the map just now:
    // everything below starts from the map as it is at this moment, not as it was drawn.
    const live = mapDraft(doc.getState(), current.id)?.value ?? current;
    let target = node && (live.nodes.find(item => item.id === node.id) ?? node), stack: string[] | null = null;
    if (event.button === 0 && tool !== 'hand' && !handle && (tool === 'select' || !editing)) {
      // The topmost item of a pile takes every press. The one already picked from the pile stays the target,
      // as long as it is really under the pointer: a camera on the centre of a table is no part of a press on the table's corner.
      const ids = node && node.type !== 'space' ? planStackUnder(live, node.id, undefined, item => onPlanMark(item, point)) : [];
      const picked = ids.length > 1 && view.selectedId && ids.includes(view.selectedId) ? live.nodes.find(item => item.id === view.selectedId) : undefined;
      if (picked) { target = picked; stack = ids; }
      else select(node?.id ?? null);
    }
    if (canEdit && event.button === 0 && !handle && tool === 'polygon') {
      setPolygon(previous => {
        const last = previous[previous.length - 1];
        return last && Math.hypot(last.x - point.x, last.y - point.y) < 1 ? previous : [...previous, point];
      }); setError(''); return;
    }
    if (canEdit && event.button === 0 && !handle && tool === 'symbol') { placeSymbol(point, live); return; }
    let mode: PointerSession['mode'] = 'pan';
    if (canEdit && event.button === 0 && tool !== 'hand') {
      if (tool === 'rect' || tool === 'ellipse') { mode = 'draw'; target = newSpace(tool, point); }
      else if (target) mode = target.locked ? 'click' : handle ?? 'move';
    } else if (node && tool !== 'hand' && event.button !== 1) mode = 'click';
    if (mode === 'click' && !stack) return;
    // One drag is one gesture of the shared document: previews until release, then at most one undo step.
    if (mode !== 'pan' && mode !== 'click' && !doc.beginGesture(current.id)) return;
    pointerRef.current = { mode, pointerId: event.pointerId, mapId: current.id, initial: live, node: target, start: point, clientX: event.clientX, clientY: event.clientY, matrix, view: { ...view }, moved: false, stack };
    svgRef.current?.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const session = pointerRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const point = pointFrom(event, session.matrix); if (!point) return;
    if (!session.moved && Math.hypot(event.clientX - session.clientX, event.clientY - session.clientY) < 4) return;
    session.moved = true;
    const delta = { x: point.x - session.start.x, y: point.y - session.start.y };
    if (session.mode === 'pan') { updateView({ x: session.view.x - delta.x, y: session.view.y - delta.y }, session.mapId); return; }
    if (session.mode === 'click' || !canEdit || !session.node) return;
    let next = session.initial;
    if (session.mode === 'move') next = moveMapNode(next, session.node.id, delta);
    if (session.mode === 'draw' && session.node.type === 'space') {
      const space = { ...session.node, x: Math.min(point.x, session.start.x), y: Math.min(point.y, session.start.y), width: Math.max(10, Math.abs(delta.x)), height: Math.max(10, Math.abs(delta.y)) };
      next = { ...next, nodes: [...next.nodes, space] };
    }
    if (session.mode === 'resize' && session.node.type !== 'camera') {
      const resized = resizeSpace(session.node, point);
      next = resized.type === 'space' ? transformMapSpace(next, resized) : { ...next, nodes: next.nodes.map(item => item.id === resized.id ? resized : item) };
    }
    if (session.mode === 'rotate') {
      // Only the horizontal direction changes: height, tilt and frame of a camera stay as they are.
      const node = session.node;
      const center = node.type !== 'camera' ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : node;
      const degrees = node.type === 'camera' ? normalizeAngle(angle(point, center)) : normalizeAngle(node.rotation + angle(point, center) - angle(session.start, center));
      next = node.type === 'space' ? transformMapSpace(next, { ...node, rotation: degrees }) : { ...next, nodes: next.nodes.map(item => item.id === node.id ? node.type === 'camera' ? { ...node, angle: degrees } : { ...node, rotation: degrees } : item) };
    }
    doc.previewGesture(next);
  }
  /** Also ends a drag as cancelled: pointercancel, or the canvas itself losing the pointer capture. */
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>, cancel = false) {
    const session = pointerRef.current; if (!session || session.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (session.moved) lastDrag.current = Date.now();
    if (session.mode === 'pan') return;
    if (session.mode !== 'click') {
      if (cancel || !canEdit || !session.moved) doc.cancelGesture();
      else {
        doc.finishGesture();
        if (session.node) select(session.node.id, session.mapId);
        if (session.mode === 'draw') setTool('select');
      }
    }
    if (!cancel && !session.moved && session.stack && session.node) {
      const ids = session.stack;
      select(ids[(ids.indexOf(session.node.id) + 1) % ids.length], session.mapId);
    }
  }
  function zoomBy(factor: number) {
    if (pointerRef.current) return;
    const zoomed = zoomMapViewport(view, factor);
    updateView({ zoom: zoomed.zoom, x: zoomed.x, y: zoomed.y });
  }
  /** Shows everything that is drawn on the map. */
  function fitView() {
    if (!current || pointerRef.current) return;
    updateView(fitMapViewport(current));
  }
  function keyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // A gesture in progress is cancelled first; the tool is left as it is.
      if (event.nativeEvent === handledEscape.current) return;
      if (doc.isGestureActive()) { abortGesture(); return; }
      setPolygon([]); setTool('select'); setSymbolPaletteOpen(false);
    }
    const target = event.target as HTMLElement;
    // Plan shortcuts. They come before the guard below, so they also work while a button has the focus.
    // Ctrl and Meta combinations are left to the app-wide zoom.
    if (mode === 'plan' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !target.closest(textEntry)) {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); return; }
      if (event.key === '-') { event.preventDefault(); zoomBy(0.8); return; }
      if (event.key === '0') { event.preventDefault(); fitView(); return; }
    }
    if (target.closest(interactive)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected?.type === 'symbol' && canEdit) { event.preventDefault(); duplicateSymbol(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); undo(true); }
    if (event.key === 'Delete' && selected && canEdit && !selected.locked && !pointerRef.current && !doc.isGestureActive()) { event.preventDefault(); setConfirmation('delete-node'); }
  }

  // Stable callbacks: the 3D viewport, the companion plan and the image grid must not re-subscribe on every preview.
  const selectNode = useEvent((id: string | null) => select(id));
  const clearSelection = useEvent(() => select(null));
  const openView = useEvent(onOpenView), openCatalog = useEvent(onOpenCatalog);
  const beginCanvasGesture = useEvent(() => { if (current && canEdit && !pointerRef.current) doc.beginGesture(current.id); });
  const previewCanvasGesture = useEvent((map: BackgroundMap) => { if (canEdit) doc.previewGesture(map); });
  const finishCanvasGesture = useEvent(() => { if (canEdit) doc.finishGesture(); else doc.cancelGesture(); });
  const cancelCanvasGesture = useEvent(() => doc.cancelGesture());
  const placeAt = useEvent((point: BackgroundPoint) => placeSymbol(point));
  const storeView = useEvent((next: Map3DViewState) => { if (current) viewStates.current[current.id] = next; });
  const changeLookThrough = useEvent((id: string | null) => {
    if (id && current) select(id);
    setLookThrough(id && current ? { mapId: current.id, id } : null);
  });
  const openSpaceFrom3D = useEvent((id: string) => { if (tool !== 'symbol') openSpace(id); });
  const gallery = useMemo(() => settledCurrent ? <BackgroundMapGallery key={settledCurrent.id} snapshot={snapshot} maps={settledMaps} current={settledCurrent} selected={settledSelected} onClearSelection={clearSelection} onOpenView={openView} onOpenCatalog={openCatalog} /> : null,
    [snapshot, settledMaps, settledCurrent, settledSelected, clearSelection, openView, openCatalog]);

  const treeRows: { map: BackgroundMap; depth: number }[] = [];
  const visited = new Set<string>();
  function tree(parentId: string | null, depth: number) {
    maps.filter(map => map.parentId === parentId).forEach(map => { if (visited.has(map.id)) return; visited.add(map.id); treeRows.push({ map, depth }); tree(map.id, depth + 1); });
  }
  tree(null, 0); maps.forEach(map => { if (!visited.has(map.id)) treeRows.push({ map, depth: 0 }); });
  const parentOptions = current ? maps.filter(map => mapCanNest(maps, current.id, map.id)) : maps;
  const childMaps = current ? maps.filter(map => map.parentId === current.id) : [];
  const linkedMap = selected?.type === 'space' ? maps.find(map => map.id === selected.childMapId) : undefined;
  const linkCandidates = current ? maps.filter(map => mapCanNest(maps, map.id, current.id) && mapPath(maps, map.id).map(item => item.name).join(' / ').toLocaleLowerCase().includes(linkForm?.search.trim().toLocaleLowerCase() ?? '')) : [];
  const linkTarget = maps.find(map => map.id === linkForm?.mapId);
  const movedLink = linkTarget && current && linkTarget.parentId !== current.id;
  const draftChanged = mapDraftChanged(draft);
  const fieldLocked = !canEdit || !!selected?.locked;
  const spaceName = (id: string | null) => current?.nodes.find(node => node.type === 'space' && node.id === id)?.name ?? '공간 미지정';
  // In 3D the two tools keep their names in view: picking placements and looking around are separate operations.
  const toolItems: { id: Tool; label: string; title: string; icon: ReactNode; named?: boolean }[] = mode === 'plan'
    ? [{ id: 'select', label: '선택', title: '선택', icon: '↖' }, { id: 'hand', label: '이동', title: '이동', icon: '✥' },
      ...(editing ? [{ id: 'rect' as const, label: '사각형', title: '사각형', icon: '▭' }, { id: 'ellipse' as const, label: '타원', title: '타원', icon: '◯' }, { id: 'polygon' as const, label: '다각형', title: '다각형', icon: '⬡' }] : [])]
    : [{ id: 'select', label: '선택', title: editing ? '선택: 클릭해 고르고 손잡이로 옮기기' : '선택: 클릭해 고르기', icon: '↖', named: true },
      { id: 'hand', label: '둘러보기', title: '둘러보기: 끌어서 돌려 보기만 하고 배치는 그대로 둬요', icon: <Orbit size={17} strokeWidth={1.8} aria-hidden="true" />, named: true }];
  const footerHint = tool === 'symbol' ? `${getSymbolPreset(symbolKind).label} 놓을 ${mode === 'plan' ? '곳' : '바닥'}을 클릭 · Esc 취소`
    : mode === 'plan' ? (tool === 'polygon' ? '점을 차례로 찍고 다각형 완성 · Esc 취소' : editing ? '선택 후 드래그 · 모서리로 크기 조절 · 위쪽 원으로 회전' : '클릭해서 선택 · 공간 더블클릭으로 상세 도면 열기')
      : tool === 'hand' ? '끌어서 둘러보기 · 휠로 확대 · 배치는 움직이지 않아요'
        : editing ? `클릭해 선택 · ${GIZMO_MODES.find(item => item.id === gizmoMode)!.hint} · 오른쪽 버튼으로 끌어 둘러보기 · 휠로 확대 · 공간 그리기는 평면에서`
          : '클릭해 선택 · 오른쪽 버튼으로 끌어 둘러보기 · 휠로 확대 · 공간 더블클릭으로 상세 도면 열기';

  return <div className="bmap-layout" onKeyDown={keyboard} tabIndex={-1}>
    <aside className="bmap-tree" aria-label="도면 트리">
      <div className="bmap-section-heading"><strong>도면</strong>{snapshot.canManage && <button type="button" className="bmap-new-root" disabled={disabled} onClick={() => openCreate(null)}>＋ 새 도면</button>}</div>
      <nav aria-label="도면 목록">{treeRows.filter(({ map }) => !mapPath(maps, map.id).slice(0, -1).some(parent => collapsed.has(parent.id))).map(({ map, depth }) => <div key={map.id} className={`bmap-tree-item ${map.id === current?.id ? 'is-active' : ''}`} style={{ paddingLeft: 6 + depth * 13 }}>
        {maps.some(child => child.parentId === map.id) ? <button type="button" className="bmap-tree-toggle" aria-label={`${map.name} ${collapsed.has(map.id) ? '펼치기' : '접기'}`} aria-expanded={!collapsed.has(map.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(map.id)) next.delete(map.id); else next.add(map.id); return next; })}>{collapsed.has(map.id) ? '›' : '⌄'}</button> : <span className="bmap-tree-spacer" />}
        <button type="button" className="bmap-tree-row" onClick={() => navigate(map.id)} aria-current={map.id === current?.id ? 'page' : undefined}><span>{map.name}</span>{mapDraftChanged(mapDraft(state, map.id)) && <span className="bmap-draft-dot" title="저장 전 변경사항">●</span>}</button>
      </div>)}</nav>
      {!maps.length && <p className="bmap-hint">등록된 도면이 없습니다.</p>}
      <div className="bmap-tree-footer">공간을 선택해 내부 도면을 만들고 이어가세요.</div>
    </aside>
    {!current ? <div className="bmap-main"><EmptyState title="첫 도면을 만들어 보세요" description={snapshot.canManage ? '이름을 정하고 공간을 그리면 시작할 수 있습니다.' : '관리자가 도면을 등록하면 이곳에서 탐색할 수 있습니다.'}>{snapshot.canManage && <button type="button" className="bg-button bg-primary" onClick={() => openCreate(null)}>도면 만들기</button>}</EmptyState></div> : <main className="bmap-main">
      <header className="bmap-header"><div><nav className="bmap-breadcrumb" aria-label="현재 도면 경로">{mapPath(maps, current.id).map((map, index) => <span key={map.id}>{index > 0 && <span className="bmap-crumb-separator">/</span>}<button type="button" onClick={() => navigate(map.id)} aria-current={map.id === current.id ? 'page' : undefined}>{map.name}</button></span>)}</nav><div className="bmap-title"><h2>{current.name}</h2>{editing && <span className="bmap-badge">{draftChanged ? '저장 전 변경사항' : '편집 중'}</span>}</div></div>
        <div className="bmap-actions"><button type="button" className="bg-button bmap-quiet" aria-expanded={inspectorOpen} aria-controls="bmap-selection-properties" onClick={() => setInspectorOpen(value => !value)}>{inspectorOpen ? '속성 접기' : '속성 열기'}</button>{snapshot.canManage && <><button type="button" className="bg-button bmap-quiet" disabled={disabled} onClick={openSettings}>도면 설정</button>{editing ? <><button type="button" className="bg-button bmap-quiet" disabled={disabled} onClick={() => { setError(''); setConfirmation('discard'); }}>취소</button><button type="button" className="bg-button bg-primary" disabled={disabled} onClick={() => void saveMap()}>{busy ? '저장 중…' : '도면 저장'}</button></> : <button type="button" className="bg-button bg-primary" disabled={disabled} onClick={() => { beginEditing(); setInspectorOpen(true); }}>공간 편집</button>}</>}</div>
      </header>
      {error && !confirmation && !createForm && !linkForm && !settingsForm && <div className="bg-error" role="alert">{error}</div>}
      {notice && <div className="bmap-notice" role="status"><span>{notice}</span><button type="button" aria-label="안내 닫기" title="안내 닫기" onClick={() => setNotice('')}>×</button></div>}
      <BackgroundMapPanels gallery={gallery}>
        <section className={`bmap-canvas-wrap${mode === '3d' ? ' is-3d' : ''}`} aria-label="도면 작업 영역">
          <div className="bmap-toolbar" role="toolbar" aria-label="도면 도구">
            <div className="bmap-mode" role="group" aria-label="도면 보기 방식">
              <button type="button" className={mode === 'plan' ? 'is-active' : ''} aria-pressed={mode === 'plan'} title="위에서 내려다본 평면 도면" onClick={() => switchMode('plan')}>평면</button>
              <button type="button" className={mode === '3d' ? 'is-active' : ''} aria-pressed={mode === '3d'} title="돌려 볼 수 있는 입체 도면" onClick={() => switchMode('3d')}>3D</button>
            </div>
            <span className="bmap-divider" />
            {toolItems.map(item => <button type="button" key={item.id} className={`${tool === item.id ? 'is-active' : ''}${item.named ? ' bmap-toolbar-named' : ''}`} title={item.title} aria-label={item.label} aria-pressed={tool === item.id} disabled={disabled} onClick={() => { setTool(item.id); setPolygon([]); setSymbolPaletteOpen(false); }}>{typeof item.icon === 'string' ? <span aria-hidden="true">{item.icon}</span> : item.icon}<span>{item.label}</span></button>)}
            {mode === '3d' && editing && <><span className="bmap-divider" /><div className="bmap-gizmo-modes" role="group" aria-label="선택한 배치를 조절하는 방식">
              {GIZMO_MODES.map(item => <button type="button" key={item.id} className={gizmoMode === item.id && tool === 'select' ? 'is-active' : ''} title={`${item.label}: ${item.hint}`} aria-label={item.label} aria-pressed={gizmoMode === item.id && tool === 'select'} disabled={disabled} onClick={() => { setGizmoMode(item.id); setTool('select'); setSymbolPaletteOpen(false); }}><item.Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></button>)}
            </div></>}
            {editing && <><span className="bmap-divider" /><button type="button" className="bmap-toolbar-named bmap-toolbar-camera" title="정해진 기본 위치에 새 카메라를 만들어요" aria-label="카메라 추가" disabled={!canEdit} onClick={addCamera}><span aria-hidden="true">◉</span><span>카메라 추가</span></button></>}
            {editing && <div className="bmap-symbol-picker">
              <button type="button" className={tool === 'symbol' || symbolPaletteOpen ? 'is-active' : ''} title="문과 사물 기호" aria-label="기호" aria-expanded={symbolPaletteOpen} aria-controls="bmap-symbol-palette" disabled={disabled} onClick={() => setSymbolPaletteOpen(value => !value)}><SymbolIcon symbol={symbolKind} size={20} /><span>기호</span><small>⌄</small></button>
              {symbolPaletteOpen && <div className="bmap-symbol-palette" id="bmap-symbol-palette" role="group" aria-label="배치할 기호">
                <div className="bmap-palette-heading">문과 사물</div>
                <div className="bmap-symbol-options">{symbolCatalog.map(item => <button key={item.id} type="button" aria-label={`${item.label} 배치`} disabled={!canEdit} onClick={() => { setSymbolKind(item.id); setTool('symbol'); setPolygon([]); setSymbolPaletteOpen(false); focusCanvas(); }}><SymbolIcon symbol={item.id} size={28} /><span>{item.label}</span></button>)}</div>
                <p>{mode === 'plan' ? '기호를 고른 뒤 도면을 클릭하세요.' : '기호를 고른 뒤 놓을 바닥을 클릭하세요.'}</p>
              </div>}
            </div>}
            {editing && <><span className="bmap-divider" /><button type="button" title="되돌리기 (Ctrl+Z)" aria-label="되돌리기" disabled={!draft?.past.length || disabled || gestureActive} onClick={() => undo()}>↶</button><button type="button" title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" disabled={!draft?.future.length || disabled || gestureActive} onClick={() => undo(true)}>↷</button></>}
          </div>
          {mode === 'plan' ? <svg ref={svgRef} className={`bmap-canvas tool-${tool}`} style={{ '--bmap-label-scale': labelScale } as CSSProperties} viewBox={`${view.x} ${view.y} ${1000 / view.zoom} ${680 / view.zoom}`} aria-label={`${current.name} 도면`} tabIndex={0} onPointerDown={event => pointerDown(event)} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)} onLostPointerCapture={event => { if (event.target === event.currentTarget) pointerUp(event, true); }} onDoubleClick={() => { if (tool === 'polygon' && Date.now() - lastDrag.current > 450) finishPolygon(); }}>
            {current.imageUrl && <image href={current.imageUrl} x="0" y="0" width="1000" height="680" preserveAspectRatio="xMidYMid meet" opacity="0.65" pointerEvents="none" />}
            {current.nodes.filter((node): node is BackgroundSpace => node.type === 'space').map(node => {
              const isSelected = node.id === selected?.id;
              return <g key={node.id} className={`bmap-space ${isSelected ? 'is-selected' : ''} ${node.locked ? 'is-locked' : ''}`} transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.width / 2} ${node.height / 2})`} role="button" aria-label={`${node.name}${node.childMapId ? ', 상세 도면 연결' : ''}`} tabIndex={0} onPointerDown={event => pointerDown(event, node)} onDoubleClick={event => { event.stopPropagation(); if (Date.now() - lastDrag.current > 450 && (tool === 'select' || tool === 'hand')) openSpace(node.id); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); select(node.id); } }}>
                {node.shape === 'ellipse' ? <ellipse cx={node.width / 2} cy={node.height / 2} rx={node.width / 2} ry={node.height / 2} /> : node.shape === 'polygon' ? <polygon points={node.points.map(point => `${point.x * node.width},${point.y * node.height}`).join(' ')} /> : <rect width={node.width} height={node.height} rx="4" />}
                <text x={node.width / 2} y={node.height / 2} textAnchor="middle" dominantBaseline="central" pointerEvents="none">{node.locked ? '🔒 ' : ''}{node.name}</text>
                {node.childMapId && <text className="bmap-space-detail" x={node.width / 2} y={node.height / 2 + 21} textAnchor="middle" pointerEvents="none">상세 도면 ↗</text>}
              </g>;
            })}
            {current.nodes.filter((node): node is BackgroundSymbol => node.type === 'symbol').map(node => {
              const isSelected = node.id === selected?.id, tilt = nodeAngles(node);
              return <Fragment key={node.id}>
                {/* A tilted object casts the outline of its whole box; its own plan size is untouched. */}
                {(tilt.pitch !== 0 || tilt.roll !== 0) && <polygon className={`bmap-symbol-tilt ${isSelected ? 'is-selected' : ''}`} points={nodePlanOutline(node).map(point => `${point.x},${point.y}`).join(' ')} pointerEvents="none" />}
                <g className={`bmap-symbol ${isSelected ? 'is-selected' : ''} ${node.locked ? 'is-locked' : ''}`} transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.width / 2} ${node.height / 2})`} role="button" aria-label={`${node.name}, 기호`} tabIndex={0} onPointerDown={event => pointerDown(event, node)} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); select(node.id); } }}>
                  <title>{`${node.name}${node.locked ? ' · 잠김' : ''}`}</title>
                  <rect className="bmap-symbol-hit" width={node.width} height={node.height} rx="3" />
                  <g transform={`scale(${node.width / 100} ${node.height / 100})`}><BackgroundSymbolGlyph symbol={node.symbol} hinge={node.hinge} swing={node.swing} /></g>
                  {(getSymbolPreset(node.symbol).id === 'custom' || isSelected) && <text x={node.width / 2} y={node.height + 18} textAnchor="middle" pointerEvents="none">{node.name}</text>}
                </g>
              </Fragment>;
            })}
            {current.nodes.filter((node): node is BackgroundCamera => node.type === 'camera').map(node => {
              // The fan and the line follow the horizontal part of the line of sight (cos pitch). Looking straight
              // up or down has no horizontal part, so a vertical mark replaces them. The fan is a direction reference.
              const plan = projectCameraToPlan(node), reach = Math.hypot(plan.direction.x, plan.direction.y);
              const half = node.fov / 2 * Math.PI / 180, radius = 80 * reach;
              const tilt = Math.abs(plan.pitch) >= 0.5 ? cameraPitchLabel(plan.pitch) : '';
              return <g key={node.id} className={`bmap-camera ${node.id === selected?.id ? 'is-selected' : ''} ${plan.vertical ? 'is-vertical' : ''}`} transform={`translate(${node.x} ${node.y})`} role="button" aria-label={`${node.name}, 카메라${tilt ? `, ${tilt}` : ''}`} tabIndex={0} onPointerDown={event => pointerDown(event, node)} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); select(node.id); } }}>
                {plan.vertical ? <>
                  <circle className="bmap-camera-ring" r="17" /><circle r="11" />
                  {plan.vertical === 'up' ? <circle className="bmap-camera-mark" r="3.5" /> : <path className="bmap-camera-mark" d="M -4.5 -4.5 L 4.5 4.5 M 4.5 -4.5 L -4.5 4.5" />}
                </> : <g transform={`rotate(${node.angle})`}><path className="bmap-camera-cone" d={`M 0 0 L ${radius * Math.cos(half)} ${-radius * Math.sin(half)} A ${radius} ${radius} 0 0 1 ${radius * Math.cos(half)} ${radius * Math.sin(half)} Z`} /><line x1="0" y1="0" x2={55 * reach} y2="0" /><circle r="11" /><path className="bmap-camera-arrow" d="M -3 -5 L 5 0 L -3 5 Z" /></g>}
                <text x="0" y={plan.vertical ? 35 : 29} textAnchor="middle" pointerEvents="none">{node.locked ? '🔒 ' : ''}{node.name}{tilt ? ` · ${tilt}` : ''}</text>
              </g>;
            })}
            {!!polygon.length && <g className="bmap-polygon-preview" pointerEvents="none"><polyline points={polygon.map(point => `${point.x},${point.y}`).join(' ')} />{polygon.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={MAP_EDIT_MARK.polygonDot * screenScale} />)}</g>}
            {/* Handles are drawn last, so an item picked from under others can still be turned and resized. */}
            {selected && canEdit && !selected.locked && <MapNodeHandles node={selected} scale={screenScale} vertexHandles={false} onHandleDown={(event, handle) => pointerDown(event, selected, handle)} />}
          </svg> : <div className="bmap-3d-split">
            <div className="bmap-3d-main" ref={stageRef} tabIndex={-1} onPointerDownCapture={event => {
              setSymbolPaletteOpen(false);
              // Keep the keyboard on the map after a click, so Delete and undo work without a detour.
              const stage = stageRef.current;
              if (stage && !stage.contains(document.activeElement) && !(event.target as HTMLElement).closest(interactive)) stage.focus({ preventScroll: true });
            }}>
              <Map3DBoundary onFail={leave3D}><Suspense fallback={<div className="bmap-3d-loading" role="status">3D 화면을 준비하고 있어요…</div>}>
                <Map3D map={current} selectedId={view.selectedId} canEdit={canEdit} onSelect={selectNode}
                  onBeginGesture={beginCanvasGesture} onPreview={previewCanvasGesture} onFinishGesture={finishCanvasGesture} onCancelGesture={cancelCanvasGesture}
                  tool={tool === 'hand' ? 'look' : 'select'} gizmoMode={gizmoMode} placing={tool === 'symbol' && canEdit} onPlace={placeAt}
                  focusRequest={focusRequest} initialView={viewStates.current[current.id] ?? null} onViewChange={storeView}
                  lookThroughId={lookThroughId} onLookThroughChange={changeLookThrough} onOpenSpace={openSpaceFrom3D} onUnavailable={leave3D} />
              </Suspense></Map3DBoundary>
            </div>
            <BackgroundMapPlanPreview map={current} selectedId={view.selectedId} onSelect={selectNode} />
          </div>}
          {mode === 'plan' && !current.nodes.length && !current.imageUrl && !polygon.length && <div className="bmap-canvas-empty"><strong>{editing ? '공간을 그려 도면을 채워보세요' : '아직 배치된 공간이 없습니다'}</strong><span>{editing ? '도형을 고르고 빈 곳을 드래그하거나 밑그림을 올려보세요.' : '도면 편집에서 공간·문·사물·카메라를 배치할 수 있습니다.'}</span></div>}
          <div className="bmap-canvas-footer"><span>{footerHint}</span>{mode === 'plan' && <div className="bmap-zoom"><button type="button" aria-label="도면 축소" title="축소 (−)" onClick={() => zoomBy(0.8)}>−</button><span>{Math.round(view.zoom * 100)}%</span><button type="button" aria-label="도면 확대" title="확대 (+)" onClick={() => zoomBy(1.25)}>＋</button><button type="button" title="그려 둔 것 전체가 보이게 맞춤 (0)" onClick={fitView}>맞춤</button></div>}</div>
          {mode === 'plan' && tool === 'polygon' && <div className="bmap-polygon-actions"><span>{polygon.length}개 점</span><button type="button" className="bg-button bg-primary" disabled={polygon.length < 3 || !canEdit} onClick={finishPolygon}>다각형 완성</button><button type="button" className="bg-button" onClick={() => { setPolygon([]); setTool('select'); }}>취소</button></div>}
        </section>
        <aside className="bmap-inspector" id="bmap-selection-properties" aria-label="선택 속성" hidden={!inspectorOpen}>
          {selected ? <>
            <div className="bmap-section-heading"><span className="bmap-eyebrow">{selected.type === 'space' ? '선택한 공간' : selected.type === 'symbol' ? '선택한 기호' : '선택한 카메라'}</span><button type="button" className="bmap-icon-button" aria-label="선택 해제" onClick={() => select(null)}>×</button></div>
            {editing ? <Field label="이름"><input value={selected.name} disabled={fieldLocked} onChange={event => patchNode({ name: event.target.value }, 'name')} onBlur={doc.endCoalescing} /></Field> : <h3 className="bmap-selected-name">{selected.name}</h3>}
            {selected.type === 'space' && <section className="bmap-connection" aria-label="공간의 상세 도면">
              <span className="bmap-eyebrow">이 공간 안으로</span>
              {linkedMap ? <><strong>{linkedMap.name}</strong><button type="button" className="bg-button bg-primary" disabled={disabled} onClick={() => navigate(linkedMap.id)}>상세 도면 열기 →</button><p>공간을 더블클릭해도 열립니다.</p></> : <><p>이 공간의 내부를 별도 도면으로 이어보세요.</p>{snapshot.canManage && <button type="button" className="bg-button bg-primary" disabled={disabled || selected.locked || !!polygon.length} onClick={() => openCreate(current.id, selected)}>내부 도면 만들기</button>}</>}
              {snapshot.canManage && <div className="bmap-link-actions"><button type="button" className="bmap-text-button" disabled={disabled || selected.locked || !!polygon.length} onClick={() => { setError(''); setLinkForm({ spaceId: selected.id, mapId: selected.childMapId ?? '', search: '' }); }}>{linkedMap ? '연결 변경' : '기존 도면 연결'}</button>{linkedMap && <button type="button" className="bmap-text-button" disabled={disabled || selected.locked || !!polygon.length} onClick={() => void linkMap(null, selected.id)}>연결 해제</button>}</div>}
              {selected.locked && <p>잠금을 해제하면 연결을 바꿀 수 있습니다.</p>}
              {draftChanged && <p className="bmap-save-note">연결할 때 현재 공간 편집 내용도 함께 저장됩니다.</p>}
            </section>}
            {selected.type === 'camera' && (() => {
              const angles = cameraAngles(selected), aspect = cameraAspect(selected), preset = ASPECT_PRESETS.find(item => Math.abs(item.value - aspect) < 0.005);
              return <>
                {editing ? <section className="bmap-camera-properties" key={`camera-${selected.id}`} aria-label="카메라 설정">
                  <div className="bmap-field-pair"><NumberField label="카메라 높이" value={nodeElevation(selected)} min={MAP_SPATIAL_LIMITS.elevation.min} max={MAP_SPATIAL_LIMITS.elevation.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={elevation => patchNode({ elevation }, 'elevation')} /><NumberField label="방향 (°)" value={selected.angle} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={angleValue => patchNode({ angle: normalizeAngle(angleValue) }, 'angle')} /></div>
                  <div className="bmap-field-pair"><NumberField label="위아래 각도 (°)" value={angles.pitch} min={MAP_SPATIAL_LIMITS.pitch.min} max={MAP_SPATIAL_LIMITS.pitch.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={pitch => patchNode({ pitch }, 'pitch')} /><NumberField label="기울기 (°)" value={angles.roll} min={MAP_SPATIAL_LIMITS.roll.min} max={MAP_SPATIAL_LIMITS.roll.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={roll => patchNode({ roll }, 'roll')} /></div>
                  <div className="bmap-pitch-presets" role="group" aria-label="위아래 방향 바로 맞추기">{PITCH_PRESETS.map(item => <button type="button" key={item.label} className="bg-button" aria-pressed={angles.pitch === item.pitch} disabled={fieldLocked} onClick={() => { if (angles.pitch !== item.pitch) patchNode({ pitch: item.pitch }); }}>{item.label}</button>)}</div>
                  <p className="bmap-hint">위를 보면 +, 아래를 보면 − 값이에요. 지금은 <strong>{cameraPitchLabel(angles.pitch)}</strong>. 위아래만 바꿔도 좌우 방향은 그대로예요.</p>
                  <div className="bmap-field-pair"><NumberField label="화각 (°)" value={selected.fov} min={10} max={170} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={fov => patchNode({ fov }, 'fov')} />
                    <Field label="화면 비율"><select value={preset ? preset.label : 'stored'} disabled={fieldLocked} onChange={event => { const next = ASPECT_PRESETS.find(item => item.label === event.target.value); if (next && next !== preset) patchNode({ aspect: next.value }); }}>{ASPECT_PRESETS.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}{!preset && <option value="stored">{round(aspect)}:1</option>}</select></Field></div>
                  <p className="bmap-hint">평면의 부채꼴은 카메라가 향한 쪽을 알려주는 표시예요. 실제로 화면에 담기는 범위와는 다를 수 있어요.</p>
                </section> : <p className="bmap-hint">{spaceName(selected.spaceId)} · 방향 {Math.round(selected.angle)}° · {cameraPitchLabel(angles.pitch)} · 높이 {Math.round(nodeElevation(selected))} · 화각 {Math.round(selected.fov)}°</p>}
                {mode === '3d' && <div className="bmap-look-through"><button type="button" className="bg-button" aria-pressed={lookThroughId === selected.id} onClick={() => setLookThrough(lookThroughId === selected.id ? null : { mapId: current.id, id: selected.id })}>{lookThroughId === selected.id ? '둘러보기로 돌아가기' : '이 카메라 시점으로 보기'}</button><p className="bmap-hint">{lookThroughId === selected.id ? '지금 이 카메라가 보는 구도를 미리 보고 있어요.' : '배치한 공간과 사물이 이 카메라에 어떻게 잡히는지 미리 볼 수 있어요.'}</p></div>}
              </>;
            })()}
            {selected.type === 'symbol' && <section className="bmap-symbol-properties" aria-label="기호 설정">
              <div className="bmap-symbol-preview"><svg viewBox="-8 -8 116 116" aria-hidden="true"><g transform={`rotate(${selected.rotation} 50 50)`}><BackgroundSymbolGlyph symbol={selected.symbol} hinge={selected.hinge} swing={selected.swing} /></g></svg><div><strong>{getSymbolPreset(selected.symbol).label}</strong><span>{Math.round(selected.rotation)}°{selected.locked ? ' · 잠김' : ''}</span></div></div>
              {editing && <>
                {selected.symbol === 'door' && <div className="bmap-symbol-actions"><button type="button" className="bg-button" disabled={fieldLocked} onClick={() => patchNode({ hinge: selected.hinge === 'left' ? 'right' : 'left' })}>경첩 반대쪽</button><button type="button" className="bg-button" disabled={fieldLocked} onClick={() => patchNode({ swing: selected.swing === 'inward' ? 'outward' : 'inward' })}>열림 방향 뒤집기</button></div>}
                <div className="bmap-symbol-actions"><button type="button" className="bg-button" disabled={fieldLocked} onClick={() => patchNode({ rotation: normalizeAngle(selected.rotation + 90) })}>90° 회전</button><button type="button" className="bg-button" title="기호 복제 (Ctrl+D)" disabled={!canEdit} onClick={duplicateSymbol}>기호 복제</button></div>
                <Field label="소속 공간"><select value={selected.spaceId ?? ''} disabled={fieldLocked} onChange={event => patchNode({ spaceId: event.target.value || null })}><option value="">공간 밖 / 미지정</option>{current.nodes.filter(node => node.type === 'space').map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></Field>
                <p className="bmap-hint">소속 공간을 옮기면 기호도 함께 움직입니다.</p>
              </>}
              {!editing && <p className="bmap-hint">{spaceName(selected.spaceId)}</p>}
            </section>}
            {editing && <>
              {selected.type === 'space' ? <details className="bmap-disclosure" key={`place-${selected.id}`}><summary>배경 장소 연결<span>{snapshot.places.find(place => place.id === selected.placeId)?.name ?? '선택 안 함'}</span></summary><Field label="배경 장소"><select value={selected.placeId ?? ''} disabled={fieldLocked} onChange={event => patchNode({ placeId: event.target.value || null })}><option value="">나중에 연결</option>{snapshot.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></Field><p className="bmap-hint">장소를 연결하면 해당 배경 이미지들을 여기서 볼 수 있습니다.</p></details> : selected.type === 'camera' ? <details className="bmap-disclosure" key={`views-${selected.id}`}><summary>시점 연결<span>{selected.viewIds.length}개</span></summary><Field label="카메라가 있는 공간"><select value={selected.spaceId ?? ''} disabled={fieldLocked} onChange={event => patchNode({ spaceId: event.target.value || null })}><option value="">공간 밖 / 미지정</option>{current.nodes.filter(node => node.type === 'space').map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></Field><fieldset className="bmap-view-select" disabled={fieldLocked}><legend>연결할 배경 시점</legend>{snapshot.views.map(item => <label key={item.id} className="bmap-check"><input type="checkbox" checked={selected.viewIds.includes(item.id)} onChange={event => patchNode({ viewIds: event.target.checked ? [...selected.viewIds, item.id] : selected.viewIds.filter(id => id !== item.id) })} />{item.name}</label>)}{!snapshot.views.length && <p className="bmap-hint">배경 목록에서 시점을 먼저 등록해 주세요.</p>}</fieldset></details> : null}
              {selected.type !== 'camera' && <details className="bmap-disclosure" open key={`vertical-${selected.id}`}><summary>{selected.type === 'space' ? '높이' : '높이·기울기'}<span>입체 {Math.round(nodeVolumeHeight(selected))}</span></summary>
                <div className="bmap-field-pair"><NumberField label="바닥 높이" value={nodeElevation(selected)} min={MAP_SPATIAL_LIMITS.elevation.min} max={MAP_SPATIAL_LIMITS.elevation.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={elevation => patchNode({ elevation }, 'elevation')} /><NumberField label="입체 높이" value={nodeVolumeHeight(selected)} min={MAP_SPATIAL_LIMITS.volumeHeight.min} max={MAP_SPATIAL_LIMITS.volumeHeight.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={volumeHeight => patchNode({ volumeHeight }, 'volumeHeight')} /></div>
                {selected.type === 'symbol' && <div className="bmap-field-pair"><NumberField label="앞뒤 기울기 (°)" value={nodeAngles(selected).pitch} min={MAP_SPATIAL_LIMITS.pitch.min} max={MAP_SPATIAL_LIMITS.pitch.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={pitch => patchNode({ pitch }, 'pitch')} /><NumberField label="좌우 기울기 (°)" value={nodeAngles(selected).roll} min={MAP_SPATIAL_LIMITS.roll.min} max={MAP_SPATIAL_LIMITS.roll.max} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={roll => patchNode({ roll }, 'roll')} /></div>}
                <p className="bmap-hint">{selected.type === 'space' ? '바닥 높이를 바꾸면 이 공간에 속한 카메라와 사물도 같은 만큼 함께 오르내려요. 입체 높이는 3D에서 보이는 벽 높이예요.' : '입체 높이는 3D에서 보이는 사물의 키예요. 기울여도 가로·세로 길이는 그대로예요.'}</p>
              </details>}
              <details className="bmap-disclosure" key={`geometry-${selected.id}`}><summary>위치·크기·잠금</summary>
                <label className="bmap-check"><input type="checkbox" checked={selected.locked} disabled={!canEdit} onChange={event => patchNode({ locked: event.target.checked })} />위치와 속성 잠금</label>
                <div className="bmap-field-pair"><NumberField label="가로 위치" value={selected.x} min={-PLAN_LIMIT} max={PLAN_LIMIT} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={x => moveSelected({ x: x - selected.x, y: 0 }, 'x')} /><NumberField label="세로 위치" value={selected.y} min={-PLAN_LIMIT} max={PLAN_LIMIT} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={y => moveSelected({ x: 0, y: y - selected.y }, 'y')} /></div>
                {selected.type !== 'camera' && <><div className="bmap-field-pair"><NumberField label="가로 길이" value={selected.width} min={MIN_PLAN_SIZE} max={PLAN_LIMIT} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={width => patchNode({ width }, 'width')} /><NumberField label="세로 길이" value={selected.height} min={MIN_PLAN_SIZE} max={PLAN_LIMIT} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={height => patchNode({ height }, 'height')} /></div><NumberField label="회전 (°)" value={selected.rotation} disabled={fieldLocked} onDone={doc.endCoalescing} onChange={rotation => patchNode({ rotation: normalizeAngle(rotation) }, 'rotation')} /></>}
                <button type="button" className="bmap-text-button bmap-danger" disabled={fieldLocked} onClick={() => { setError(''); setConfirmation('delete-node'); }}>이 배치 삭제</button>
              </details>
            </>}
          </> : <>
            <div className="bmap-section-heading"><strong>도면 구성</strong><span className="bmap-badge">{current.nodes.filter(node => node.type === 'space').length}개 공간</span></div>
            <p className="bmap-hint">공간을 선택하면 내부 도면을 만들거나 연결할 수 있습니다.</p>
            {snapshot.canManage && <button type="button" className="bg-button bmap-draw-action" disabled={disabled} title={mode === '3d' ? '공간은 평면에서 그려요. 평면으로 바꿔 드릴게요.' : undefined} onClick={() => { if (!editing) beginEditing(); if (mode !== 'plan') switchMode('plan'); setTool('rect'); }}>＋ 공간 그리기</button>}
            <section className="bmap-children"><div className="bmap-section-heading"><strong>하위 도면</strong><span>{childMaps.length}</span></div>
              {childMaps.map(map => <button type="button" key={map.id} className="bmap-child-row" disabled={disabled} onClick={() => navigate(map.id)}><span>{map.name}</span><span>→</span></button>)}
              {!childMaps.length && <p className="bmap-hint">필요한 만큼 안쪽 도면을 이어가세요.</p>}
              {snapshot.canManage && <button type="button" className="bmap-text-button" disabled={disabled || !!polygon.length} onClick={() => openCreate(current.id)}>＋ 하위 도면 만들기</button>}
            </section>
          </>}
          <ObjectList nodes={settledCurrent?.nodes ?? current.nodes} selectedId={view.selectedId} onSelect={selectNode} />
        </aside>
      </BackgroundMapPanels>
    </main>}
    {createForm && <BackgroundModal title={createForm.spaceId ? '이 공간의 내부 도면 만들기' : '새 도면 만들기'} onClose={() => { if (!busy) { setCreateForm(null); setError(''); } }}><form onSubmit={event => { event.preventDefault(); void createMap(); }}>
      <p className="bmap-dialog-context">{createForm.parentId ? `${mapPath(maps, createForm.parentId).map(map => map.name).join(' / ')} 안에 만듭니다.` : '새로운 최상위 도면으로 시작합니다.'}</p>
      <Field label="도면 이름"><input autoFocus data-autofocus required maxLength={120} disabled={disabled} value={createForm.name} onChange={event => setCreateForm({ ...createForm, name: event.target.value })} placeholder="예: 학교, 본관, 교실" /></Field>
      {!createForm.spaceId && <details className="bmap-disclosure"><summary>만들 위치 바꾸기</summary><Field label="만들 위치"><select value={createForm.parentId ?? ''} disabled={disabled} onChange={event => setCreateForm({ ...createForm, parentId: event.target.value || null })}><option value="">최상위</option>{maps.map(map => <option key={map.id} value={map.id}>{mapPath(maps, map.id).map(item => item.name).join(' / ')}</option>)}</select></Field></details>}
      <p className="bmap-hint">{createForm.spaceId ? '선택한 공간에 자동으로 연결한 뒤 새 도면으로 들어갑니다. 현재 공간의 편집 내용도 함께 저장됩니다.' : '만들고 들어가서 공간을 그리거나 밑그림을 올릴 수 있습니다.'}</p>
      {error && <p className="bg-error" role="alert">{error}</p>}
      <div className="bmap-modal-actions"><button type="button" className="bg-button" disabled={disabled} onClick={() => { setCreateForm(null); setError(''); }}>취소</button><button type="submit" className="bg-button bg-primary" disabled={!createForm.name.trim() || disabled}>{busy ? '만드는 중…' : '만들고 들어가기'}</button></div>
    </form></BackgroundModal>}
    {linkForm && current && <BackgroundModal title="기존 도면 연결" onClose={() => { if (!busy) { setLinkForm(null); setError(''); } }}><form onSubmit={event => { event.preventDefault(); void linkMap(linkForm.mapId); }}>
      <p className="bmap-dialog-context">‘{current.nodes.find(node => node.id === linkForm.spaceId)?.name}’ 공간에서 열 도면을 선택하세요.</p>
      <Field label="도면 찾기"><input autoFocus data-autofocus type="search" value={linkForm.search} disabled={disabled} onChange={event => setLinkForm({ ...linkForm, search: event.target.value })} placeholder="도면 이름으로 검색" /></Field>
      <div className="bmap-map-picker" aria-label="연결할 도면">{linkCandidates.map(map => <button type="button" key={map.id} className={linkForm.mapId === map.id ? 'is-selected' : ''} aria-pressed={linkForm.mapId === map.id} disabled={disabled} onClick={() => setLinkForm({ ...linkForm, mapId: map.id })}><strong>{map.name}</strong><span>{map.parentId ? mapPath(maps, map.parentId).map(item => item.name).join(' / ') : '최상위 도면'}</span></button>)}{!linkCandidates.length && <p className="bmap-hint">연결할 수 있는 도면이 없습니다. 현재 도면과 상위 도면은 제외됩니다.</p>}</div>
      {movedLink && <p className="bmap-move-note">‘{linkTarget.name}’ 도면을 ‘{current.name}’ 아래로 옮겨 연결합니다. 그 안의 하위 도면은 함께 유지되며 이전 공간에서 열던 연결은 해제됩니다.</p>}
      {draftChanged && <p className="bmap-hint">현재 공간의 편집 내용도 함께 저장됩니다.</p>}
      {error && <p className="bg-error" role="alert">{error}</p>}
      <div className="bmap-modal-actions"><button type="button" className="bmap-text-button" disabled={disabled} onClick={() => { const space = current.nodes.find(node => node.id === linkForm.spaceId); if (space?.type === 'space') { setLinkForm(null); openCreate(current.id, space); } }}>새 도면 만들기</button><button type="button" className="bg-button" disabled={disabled} onClick={() => { setLinkForm(null); setError(''); }}>취소</button><button type="submit" className="bg-button bg-primary" disabled={!linkForm.mapId || disabled}>{busy ? '연결 중…' : '연결하고 열기'}</button></div>
    </form></BackgroundModal>}
    {settingsForm && <BackgroundModal title="도면 설정" onClose={() => { if (!busy) { setSettingsForm(null); setError(''); } }}><form onSubmit={event => { event.preventDefault(); void saveSettings(); }}>
      <Field label="도면 이름"><input autoFocus data-autofocus required maxLength={120} value={settingsForm.name} disabled={disabled} onChange={event => setSettingsForm({ ...settingsForm, name: event.target.value })} /></Field>
      <Field label="도면 밑그림"><input aria-label="도면 밑그림 업로드" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadUnderlay(file); }} /></Field>
      {settingsForm.imageUrl && <div className="bmap-underlay-setting"><img className="bmap-underlay-preview" src={settingsForm.imageUrl} alt="도면 밑그림" /><button type="button" className="bmap-text-button" disabled={disabled} onClick={() => setSettingsForm({ ...settingsForm, imageUrl: '' })}>밑그림 제거</button></div>}
      <details className="bmap-disclosure"><summary>도면 위치와 배경 장소</summary><Field label="도면 위치"><select value={settingsForm.parentId ?? ''} disabled={disabled} onChange={event => setSettingsForm({ ...settingsForm, parentId: event.target.value || null })}><option value="">최상위</option>{parentOptions.map(map => <option key={map.id} value={map.id}>{mapPath(maps, map.id).map(item => item.name).join(' / ')}</option>)}</select></Field><Field label="대표 장소"><select value={settingsForm.placeId ?? ''} disabled={disabled} onChange={event => setSettingsForm({ ...settingsForm, placeId: event.target.value || null })}><option value="">나중에 연결</option>{snapshot.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></Field>{settingsForm.parentId !== current?.parentId && <p className="bmap-move-note">하위 도면도 함께 옮깁니다. 이전 공간에서 이 도면을 열던 연결은 해제됩니다.</p>}</details>
      {draftChanged && <p className="bmap-hint">현재 공간의 편집 내용도 함께 저장됩니다.</p>}
      {error && <p className="bg-error" role="alert">{error}</p>}
      <div className="bmap-modal-actions"><button type="button" className="bmap-text-button bmap-danger" disabled={disabled} onClick={() => { setSettingsForm(null); setError(''); setConfirmation('delete-map'); }}>도면 삭제</button><button type="button" className="bg-button" disabled={disabled} onClick={() => { setSettingsForm(null); setError(''); }}>취소</button><button type="submit" className="bg-button bg-primary" disabled={disabled || !settingsForm.name.trim()}>{busy ? '저장 중…' : '설정 저장'}</button></div>
    </form></BackgroundModal>}
    {confirmation && current && <BackgroundModal title={confirmation === 'discard' ? '도면 편집을 취소할까요?' : confirmation === 'delete-map' ? '도면을 삭제할까요?' : `${selected?.name ?? '선택한 배치'} 삭제`} onClose={() => { if (!busy) { setConfirmation(null); setError(''); } }}><p className="bmap-confirm-text">{confirmation === 'discard' ? '이 도면에서 저장하지 않은 변경사항은 사라집니다.' : confirmation === 'delete-map' ? '도면 배치만 삭제합니다. 장소와 배경 원본은 유지됩니다. 하위 도면이나 연결이 남아 있으면 먼저 해제해 주세요.' : '선택한 배치만 지웁니다. 공간에 속한 카메라와 사물 기호는 도면에 남으며 공간 연결만 해제됩니다. 원본 장소와 배경은 유지됩니다.'}</p>{error && <div className="bg-error" role="alert">{error}</div>}<div className="bmap-modal-actions"><button type="button" className="bg-button" disabled={disabled} onClick={() => { setConfirmation(null); setError(''); }}>돌아가기</button><button type="button" className="bg-button bmap-danger" disabled={disabled} onClick={() => void confirmAction()}>{confirmation === 'discard' ? '변경사항 버리기' : '삭제'}</button></div></BackgroundModal>}
  </div>;
}
