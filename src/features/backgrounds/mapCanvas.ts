import type { BackgroundMap, BackgroundPoint } from './types.ts';

/**
 * Contract between the map editor and every surface that shows its one editable draft
 * (plan SVG, 3D viewport, companion plan). Surfaces are controlled: they never keep their
 * own copy of the map, the selection or a camera.
 */
export type MapCanvasProps = {
  /** Current draft value, including the preview of a gesture that is still in progress. */
  map: BackgroundMap;
  selectedId: string | null;
  /** Editing is allowed right now: manager, draft open, nothing saving. */
  canEdit: boolean;
  onSelect(id: string | null): void;
  /** One gesture is one undo entry. Finishing commits history only; saving stays explicit. */
  onBeginGesture(): void;
  onPreview(map: BackgroundMap): void;
  onFinishGesture(): void;
  onCancelGesture(): void;
};

export type MapDisplayMode = 'plan' | '3d';
/** `select` picks and moves placements; `look` only orbits the world. */
export type Map3DTool = 'select' | 'look';
export type Map3DGizmoMode = 'translate' | 'rotate' | 'scale';

/** Orbit camera of the editor viewport. UI state only: never saved and never in undo history. */
export type Map3DViewState = {
  target: [number, number, number];
  position: [number, number, number];
};

export type Map3DProps = MapCanvasProps & {
  tool: Map3DTool;
  gizmoMode: Map3DGizmoMode;
  /** A symbol is waiting to be placed: the next click on the floor reports its plan point. */
  placing: boolean;
  onPlace(point: BackgroundPoint): void;
  /** Bring this node into view whenever the nonce changes, e.g. a camera spawned off screen. */
  focusRequest: { id: string; nonce: number } | null;
  /** Orbit pose to restore for `map.id`; null fits the whole map. Read when the map changes. */
  initialView: Map3DViewState | null;
  onViewChange(view: Map3DViewState): void;
  /** Explicit "look through this placed camera" preview; null is the free orbit view. */
  lookThroughId: string | null;
  onLookThroughChange(id: string | null): void;
  /** Double click on a space, the same as on the plan. */
  onOpenSpace(id: string): void;
  /** WebGL could not start or was lost: the editor returns to the plan and keeps the draft. */
  onUnavailable(reason: string): void;
};

/** Companion plan shown next to the 3D viewport. It reads the same in-progress draft. */
export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' | 'selectedId' | 'onSelect'>;
