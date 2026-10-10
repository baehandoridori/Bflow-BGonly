/** Canonical places/assets are independent of their visual placements on maps. */
export interface BackgroundEntity { id: string; revision: number }
export interface BackgroundPlace extends BackgroundEntity {
  name: string; parentId: string | null; folderPath: string;
}
export interface BackgroundPoint { x: number; y: number }
/**
 * Plan and 3D share one node list. x/y/width/height/rotation/angle stay the plan values:
 * `height` is the plan depth, never the vertical size. The optional fields below add the
 * vertical axis; maps saved before the 3D editor omit them and read as mapSpatial defaults.
 */
export interface BackgroundSpace extends BackgroundPoint {
  id: string; type: 'space'; name: string; placeId: string | null; childMapId: string | null;
  width: number; height: number; rotation: number; shape: 'rect' | 'ellipse' | 'polygon';
  /** Normalized coordinates within the space bounds. */
  points: BackgroundPoint[]; locked: boolean;
  /** Floor level on the vertical axis. */
  elevation?: number;
  /** Vertical extent of the box. */
  volumeHeight?: number;
  /** What the space is besides a room. Omitted = a room: written only for a road, and removed (never null) when it is a room again. */
  surface?: BackgroundSpaceSurface;
}
export interface BackgroundCamera extends BackgroundPoint {
  id: string; type: 'camera'; name: string; spaceId: string | null;
  angle: number; fov: number; viewIds: string[]; locked: boolean;
  /** Lens height on the vertical axis. */
  elevation?: number;
  /** Degrees above (+) or below (-) the horizon, -90..90. `angle` stays the horizontal direction. */
  pitch?: number;
  /** Degrees of tilt around the viewing axis, -180..180. */
  roll?: number;
  /** Frame width / height. `fov` is the horizontal field of view. */
  aspect?: number;
  /** Name of a colour of the camera palette. Omitted = the default amber: written only when one is picked, and removed (never null) for the default. */
  color?: BackgroundCameraColor;
}
/** desk/sofa/cabinet/plant are retained for saved-map compatibility and render as custom. */
export type BackgroundSymbolKind = 'door' | 'desk' | 'chair' | 'table' | 'sofa' | 'bed' | 'cabinet' | 'plant' | 'custom' | 'stairs';
export type BackgroundSpaceSurface = 'road';
export type BackgroundCameraColor = 'red' | 'lime' | 'green' | 'teal' | 'blue' | 'pink';
export interface BackgroundSymbol extends BackgroundPoint {
  id: string; type: 'symbol'; name: string; symbol: BackgroundSymbolKind; spaceId: string | null;
  width: number; height: number; rotation: number; locked: boolean;
  /** Stored for every symbol so changing its kind retains the door configuration. */
  hinge: 'left' | 'right'; swing: 'inward' | 'outward';
  /** Base level on the vertical axis. */
  elevation?: number;
  /** Vertical extent of the object. width/height stay its untilted plan size. */
  volumeHeight?: number;
  /** Degrees of tilt around the object's width axis, -90..90. */
  pitch?: number;
  /** Degrees of tilt around the object's plan-depth axis, -180..180. */
  roll?: number;
}
export type BackgroundNode = BackgroundSpace | BackgroundCamera | BackgroundSymbol;
export interface BackgroundMap extends BackgroundEntity {
  name: string; parentId: string | null; placeId: string | null; imageUrl: string;
  nodes: BackgroundNode[];
}
export interface BackgroundImageRevision {
  id: string; imageUrl: string; filePath: string; createdAt: string;
  /** Linked source image; filePath remains the legacy work-file link. */
  sourceImagePath?: string;
}
export interface BackgroundVariant {
  id: string; name: string; time: 'day' | 'night' | 'other';
  revisions: BackgroundImageRevision[]; activeRevisionId: string;
  /** Omission preserves legacy fallback; an empty string explicitly unlinks it. */
  workFilePath?: string;
}
export interface BackgroundView extends BackgroundEntity {
  name: string; placeId: string; cameraPlaceId: string | null;
  visiblePlaceIds: string[]; relatedPlaceIds: string[];
  shot: 'wide' | 'medium' | 'closeup' | 'detail'; tags: string[]; memo: string;
  variants: BackgroundVariant[];
}
export interface BackgroundGroup extends BackgroundEntity {
  name: string; placeId: string; variantIds: string[];
}
export interface BackgroundUsage extends BackgroundEntity {
  episodeNumber: number; placeId: string; variantIds: string[]; memo: string;
}
export interface BackgroundEntities {
  place: BackgroundPlace; map: BackgroundMap; view: BackgroundView;
  group: BackgroundGroup; usage: BackgroundUsage;
}
export type BackgroundKind = keyof BackgroundEntities;
export interface BackgroundSnapshot {
  places: BackgroundPlace[]; maps: BackgroundMap[]; views: BackgroundView[];
  groups: BackgroundGroup[]; usages: BackgroundUsage[];
  /** Computed from canonical server session, never accepted in writes. */
  canManage: boolean;
}
export type BackgroundCommand = {
  [K in BackgroundKind]: { type: 'save'; kind: K; entity: BackgroundEntities[K]; expectedRevision: number | null }
}[BackgroundKind] | { type: 'delete'; kind: BackgroundKind; id: string; expectedRevision: number }
  | { type: 'save-maps'; maps: Array<{ entity: BackgroundMap; expectedRevision: number | null }> };
export interface BackgroundRequest { requestId: string; command: BackgroundCommand }
export interface BackgroundGateway {
  read(): Promise<BackgroundSnapshot>;
  execute(request: BackgroundRequest): Promise<BackgroundSnapshot>;
  subscribe?(listener: () => void): () => void;
}
export interface BackgroundActor { canManage: boolean; episodeNumbers?: number[] }
