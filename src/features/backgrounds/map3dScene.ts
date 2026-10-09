import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Group,
  LineBasicMaterial, LineDashedMaterial, LineSegments, LinearFilter, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, RingGeometry,
  SRGBColorSpace, Scene, Shape, ShapeGeometry, SphereGeometry, Sprite, SpriteMaterial, TextureLoader, Vector2,
} from 'three';
import type { Material, Object3D } from 'three';
import type { BackgroundCamera, BackgroundMap, BackgroundNode, BackgroundPoint, BackgroundSpace, BackgroundSymbol } from './types.ts';
import type { Map3DViewState } from './mapCanvas.ts';
import { MAP_PLAN_EXTENT, MAP_SPATIAL_DEFAULTS, cameraAspect, isRoadSpace, mapPlanBounds, nodeElevation, nodeVolumeHeight, nodeWorldPose, roadCentreLine, spaceOutline,
  spaceWallHeight, verticalFov } from './mapSpatial.ts';
import type { Vec3 } from './mapSpatial.ts';
import { stackedMapNodeIds } from './mapGeometry.ts';
import { spaceStackRanks, spacesOverlap } from './mapStack.ts';
import { getSymbolPreset } from './symbolCatalog.ts';

/**
 * three.js scene graph of one map draft. Every node gets one root object placed from nodeWorldPose,
 * all roots are siblings (spaceId is membership, never a parent transform), and nothing here touches
 * the DOM at import time, so the graph and the picking rules run in node tests.
 */
export type Map3DPalette = {
  light: boolean;
  background: number; card: number; border: number;
  accent: number; accentSub: number; symbol: number; camera: number; cameraLens: number;
  /** A road and the dashed line along its centre. */
  road: number; roadMark: number;
  /** CSS colours and font of the name labels. */
  text: string; halo: string; font: string;
};
export const MAP3D_DARK_PALETTE: Map3DPalette = {
  light: false, background: 0x0f1117, card: 0x1a1d27, border: 0x2d3041, accent: 0x6c5ce7, accentSub: 0xa29bfe,
  symbol: 0x89b8bf, camera: 0xe6b578, cameraLens: 0x372715, road: 0x9aa1ad, roadMark: 0xe3e6ec,
  text: 'rgb(232, 232, 238)', halo: 'rgb(15, 17, 23)', font: 'sans-serif',
};
export function sameMap3DPalette(a: Map3DPalette, b: Map3DPalette): boolean {
  return (Object.keys(a) as (keyof Map3DPalette)[]).every(key => a[key] === b[key]);
}

/** Vertical field of view of the viewer camera that looks around the world. */
export const MAP3D_VIEW_FOV = 45;
export type Map3DSyncOptions = {
  /** Node whose root is being dragged by the gizmo: its transform and geometry are left alone. */
  holdId?: string | null;
  /** Node hidden while the viewer looks through it. */
  hiddenId?: string | null;
};
export type Map3DResourceCount = { geometries: number; materials: number; textures: number };

type NodeKind = BackgroundNode['type'];
type Disposable = { dispose(): void };
type MaterialKey = 'floor' | 'floorLine' | 'spaceFloor' | 'spaceFloorOn' | 'spaceWall' | 'spaceWallOn' | 'spaceLine' | 'spaceLineOn' | 'spaceDash' | 'spaceDashOn'
  | 'roadFloor' | 'roadFloorOn' | 'roadLine' | 'roadLineLocked' | 'roadCentre'
  | 'symbol' | 'symbolOn' | 'symbolLine' | 'symbolLineOn' | 'symbolArc' | 'symbolArcOn' | 'symbolDash' | 'symbolDashOn' | 'symbolFill' | 'symbolFillOn' | 'symbolBound'
  | 'camera' | 'cameraLens' | 'cameraLine' | 'cameraLineOn' | 'cameraFar' | 'cameraFarOn' | 'cameraRing' | 'proxy';
type GeometryKey = 'box' | 'lens' | 'cameraProxy' | 'ring' | 'drop' | 'floor' | 'floorLine';
type Entry = {
  id: string; type: NodeKind; node: BackgroundNode | null; selected: boolean; shape: string; dirty: boolean; valid: boolean;
  /** Placed from nodeWorldPose; the gizmo attaches here. */
  root: Group;
  /** Unrotated companions that follow the root: the name label and a camera's drop line. */
  aux: Group; parts: Group;
  own: ResourceBag; picks: Object3D[];
  label: Sprite | null; labelKey: string; labelBag: ResourceBag; lift: number; drop: Object3D | null;
};

const RADIANS = Math.PI / 180;
const ELLIPSE_SEGMENTS = 48;
const LABEL_LIMIT = 28;
const finite = (...values: number[]) => values.every(Number.isFinite);

class ResourceBag {
  readonly items = new Set<Disposable>();
  track<T extends Disposable>(item: T): T { this.items.add(item); return item; }
  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }
}

function segments(positions: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
/** What a click target is to its node: the floor or a wall of a space, a solid part of an object, or the see-through box around it. */
type PickPart = 'floor' | 'wall' | 'solid' | 'box';
function tag(object: Object3D, id: string, kind: NodeKind, part?: PickPart): void {
  object.userData.nodeId = id;
  object.userData.nodeKind = kind;
  if (part) object.userData.pickPart = part;
}
/** Everything that changes a node's meshes. Position, level and turn are applied to the root instead. */
function shapeKey(node: BackgroundNode, selected: boolean): string {
  const flags = `${selected ? 1 : 0}${node.locked ? 1 : 0}`;
  if (node.type === 'camera') return `camera|${flags}|${node.fov}|${cameraAspect(node)}`;
  if (node.type === 'symbol') return `symbol|${flags}|${getSymbolPreset(node.symbol).id}|${node.width}|${node.height}|${nodeVolumeHeight(node)}|${node.hinge}|${node.swing}`;
  const points = node.shape === 'polygon' ? node.points.map(point => `${point.x},${point.y}`).join(';') : '';
  return `space|${flags}|${node.shape}|${node.width}|${node.height}|${nodeVolumeHeight(node)}|${points}|${isRoadSpace(node) ? 'road' : ''}`;
}
function labelSpec(node: BackgroundNode, selected: boolean): { text: string; sub: string; size: number } | null {
  const name = node.name.length > LABEL_LIMIT ? `${node.name.slice(0, LABEL_LIMIT - 1)}…` : node.name;
  const text = `${node.locked ? '🔒 ' : ''}${name}`.trim();
  if (node.type === 'space') return text || node.childMapId ? { text, sub: node.childMapId ? '상세 도면 ↗' : '', size: 13 } : null;
  if (!text) return null;
  if (node.type === 'camera') return { text, sub: '', size: 11 };
  return selected || getSymbolPreset(node.symbol).id === 'custom' ? { text, sub: '', size: 11 } : null;
}
/** Name label drawn with a 2D canvas. There is no label without a document (node tests). */
function makeLabel(spec: { text: string; sub: string; size: number }, palette: Map3DPalette, bag: ResourceBag): Sprite | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) return null;
  const ratio = 2, pad = 5, subSize = 10, mainFont = `600 ${spec.size}px ${palette.font}`, subFont = `400 ${subSize}px ${palette.font}`;
  context.font = mainFont;
  const mainWidth = spec.text ? context.measureText(spec.text).width : 0;
  context.font = subFont;
  const subWidth = spec.sub ? context.measureText(spec.sub).width : 0;
  const mainHeight = spec.text ? Math.ceil(spec.size * 1.3) : 0, subHeight = spec.sub ? Math.ceil(subSize * 1.4) : 0;
  const width = Math.ceil(Math.max(mainWidth, subWidth)) + pad * 2, height = mainHeight + subHeight + pad * 2;
  canvas.width = width * ratio; canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
  context.lineWidth = 4; context.strokeStyle = palette.halo; context.fillStyle = palette.text;
  const draw = (value: string, font: string, y: number, alpha: number) => {
    context.font = font; context.globalAlpha = 1;
    context.strokeText(value, width / 2, y);
    context.globalAlpha = alpha;
    context.fillText(value, width / 2, y);
  };
  if (spec.text) draw(spec.text, mainFont, pad + mainHeight / 2, 1);
  if (spec.sub) draw(spec.sub, subFont, pad + mainHeight + subHeight / 2, 0.78);
  const texture = bag.track(new CanvasTexture(canvas));
  texture.colorSpace = SRGBColorSpace; texture.minFilter = LinearFilter; texture.generateMipmaps = false;
  const sprite = new Sprite(bag.track(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false })));
  sprite.center.set(0.5, 0); sprite.renderOrder = 20; sprite.frustumCulled = false;
  sprite.userData.labelWidth = width; sprite.userData.labelHeight = height;
  return sprite;
}

export class Map3DScene {
  readonly scene = new Scene();
  private readonly nodes = new Group();
  private readonly companions = new Group();
  private readonly floor = new Group();
  private readonly lights: Disposable[] = [];
  private readonly shared = new ResourceBag();
  private readonly materials = new Map<MaterialKey, Material>();
  private readonly geometries = new Map<GeometryKey, BufferGeometry>();
  private readonly entries = new Map<string, Entry>();
  private readonly onInvalidate: () => void;
  private palette: Map3DPalette;
  private paletteVersion = 0;
  private labelScale = 0.002;
  private picks: Object3D[] | null = null;
  private last: { map: BackgroundMap; selectedId: string | null; options: Map3DSyncOptions } | null = null;
  private underlayUrl = '';
  private underlayRequest = 0;
  private underlay: { mesh: Mesh; bag: ResourceBag } | null = null;
  private disposed = false;
  /** Called when the underlay image cannot be used in 3D. */
  onUnderlayError: (() => void) | null = null;

  /** `onInvalidate` asks for a new frame after something changed outside sync, e.g. the underlay finished loading. */
  constructor(palette: Map3DPalette = MAP3D_DARK_PALETTE, onInvalidate: () => void = () => {}) {
    this.palette = palette;
    this.onInvalidate = onInvalidate;
    const ambient = new AmbientLight(0xffffff, 2.2), sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.35, 1, 0.55);
    this.lights.push(ambient, sun);
    this.nodes.name = 'map-nodes'; this.companions.name = 'map-companions'; this.floor.name = 'map-floor';
    this.scene.add(ambient, sun, this.floor, this.nodes, this.companions);
    this.buildFloor();
  }

  /** Diff by node id and object identity: an unchanged node keeps its objects, a moved one only gets a new pose. */
  sync(map: BackgroundMap, selectedId: string | null, options: Map3DSyncOptions = {}): void {
    if (this.disposed) return;
    const holdId = options.holdId ?? null, hiddenId = options.hiddenId ?? null;
    this.last = { map, selectedId, options: { holdId, hiddenId } };
    const seen = new Set<string>();
    for (const node of map.nodes) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      let entry = this.entries.get(node.id);
      if (entry && entry.type !== node.type) { this.remove(entry); entry = undefined; }
      if (!entry) entry = this.create(node);
      const selected = node.id === selectedId;
      if (node.id !== holdId) {
        if (entry.dirty || entry.node !== node || entry.selected !== selected) this.refresh(entry, node, selected);
      } else if (entry.dirty && entry.node) {
        // A theme change in the middle of a drag: repaint the held node as it was when the drag began, under the gizmo's transform.
        this.redraw(entry, entry.node, entry.selected);
        entry.dirty = false;
      }
      const visible = entry.valid && node.id !== hiddenId;
      if (entry.root.visible !== visible) { entry.root.visible = visible; entry.aux.visible = visible; this.picks = null; }
      this.place(entry);
    }
    for (const entry of [...this.entries.values()]) if (!seen.has(entry.id)) this.remove(entry);
  }

  /** Root object of a node: base centre of a space or symbol, lens of a camera. */
  root(id: string): Object3D | null {
    return this.entries.get(id)?.root ?? null;
  }
  /** Meshes a click can land on. Hidden nodes are left out; three's raycaster does not test visibility. */
  pickTargets(): Object3D[] {
    if (!this.picks) this.picks = [...this.entries.values()].filter(entry => entry.root.visible).flatMap(entry => entry.picks);
    return this.picks;
  }
  /** Keep a node's label and drop line with its root while a gizmo moves that root. */
  follow(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.place(entry);
  }
  /** Rebuild this node from its data on the next sync, e.g. after a gizmo left its root scaled. */
  invalidate(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.dirty = true;
  }
  setPalette(palette: Map3DPalette): void {
    if (this.disposed || sameMap3DPalette(palette, this.palette)) return;
    this.palette = palette; this.paletteVersion++;
    for (const material of this.materials.values()) { this.shared.items.delete(material); material.dispose(); }
    this.materials.clear();
    for (const entry of this.entries.values()) entry.dirty = true;
    this.buildFloor();
    if (this.last) this.sync(this.last.map, this.last.selectedId, this.last.options);
  }
  /** World units per CSS pixel at distance 1, so labels keep one size on screen. */
  setLabelScale(unitsPerPixel: number): void {
    if (!(unitsPerPixel > 0) || !Number.isFinite(unitsPerPixel) || unitsPerPixel === this.labelScale) return;
    this.labelScale = unitsPerPixel;
    for (const entry of this.entries.values()) if (entry.label) this.scaleLabel(entry.label);
  }
  /** Map underlay on the floor, contain-fitted into the base extent like the plan's image. */
  setUnderlay(url: string): void {
    if (this.disposed || url === this.underlayUrl) return;
    this.underlayUrl = url;
    // Each request has its own number: an answer to an earlier one is dropped, also when it asked for the same address.
    const request = ++this.underlayRequest;
    this.clearUnderlay();
    if (!url || typeof document === 'undefined') return;
    new TextureLoader().load(url, texture => {
      const image = texture.image as { width?: number; height?: number } | null, width = image?.width ?? 0, height = image?.height ?? 0;
      if (this.disposed || this.underlayRequest !== request || !(width > 0 && height > 0)) { texture.dispose(); return; }
      this.clearUnderlay();
      const bag = new ResourceBag(), scale = Math.min(MAP_PLAN_EXTENT.width / width, MAP_PLAN_EXTENT.height / height);
      texture.colorSpace = SRGBColorSpace;
      bag.track(texture);
      const mesh = new Mesh(bag.track(new PlaneGeometry(width * scale, height * scale).rotateX(-Math.PI / 2)),
        bag.track(new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.65, depthWrite: false })));
      mesh.position.set(MAP_PLAN_EXTENT.width / 2, 0, MAP_PLAN_EXTENT.height / 2);
      mesh.renderOrder = -2;
      mesh.name = 'floor-underlay';
      this.floor.add(mesh);
      this.underlay = { mesh, bag };
      this.onInvalidate();
    }, undefined, () => { if (!this.disposed && this.underlayRequest === request) this.onUnderlayError?.(); });
  }
  /** Live GPU-side resources this scene still owns. All zero after dispose(). */
  resourceCount(): Map3DResourceCount {
    const count = { geometries: 0, materials: 0, textures: 0 };
    const add = (bag: ResourceBag) => {
      for (const item of bag.items) {
        const flags = item as { isBufferGeometry?: boolean; isMaterial?: boolean; isTexture?: boolean };
        if (flags.isBufferGeometry) count.geometries++;
        else if (flags.isMaterial) count.materials++;
        else if (flags.isTexture) count.textures++;
      }
    };
    add(this.shared);
    if (this.underlay) add(this.underlay.bag);
    for (const entry of this.entries.values()) { add(entry.own); add(entry.labelBag); }
    return count;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.entries.values()]) this.remove(entry);
    this.clearUnderlay();
    this.floor.clear();
    this.shared.dispose();
    this.materials.clear(); this.geometries.clear();
    for (const light of this.lights) light.dispose();
    this.scene.clear();
    this.picks = []; this.last = null;
  }

  private create(node: BackgroundNode): Entry {
    const root = new Group(), aux = new Group(), parts = new Group();
    tag(root, node.id, node.type);
    aux.add(parts);
    this.nodes.add(root); this.companions.add(aux);
    const entry: Entry = { id: node.id, type: node.type, node: null, selected: false, shape: '', dirty: true, valid: true, root, aux, parts,
      own: new ResourceBag(), picks: [], label: null, labelKey: '', labelBag: new ResourceBag(), lift: 0, drop: null };
    this.entries.set(node.id, entry);
    return entry;
  }
  private remove(entry: Entry): void {
    this.clear(entry);
    this.dropLabel(entry);
    this.nodes.remove(entry.root); this.companions.remove(entry.aux);
    this.entries.delete(entry.id);
    this.picks = null;
  }
  private clear(entry: Entry): void {
    entry.root.clear(); entry.parts.clear();
    entry.own.dispose();
    entry.picks = []; entry.drop = null;
  }
  private dropLabel(entry: Entry): void {
    if (entry.label) entry.aux.remove(entry.label);
    entry.labelBag.dispose();
    entry.label = null; entry.labelKey = '';
  }
  /** Meshes and label of a node. The root's own transform is not touched here. */
  private redraw(entry: Entry, node: BackgroundNode, selected: boolean): void {
    const shape = shapeKey(node, selected);
    if (entry.dirty || shape !== entry.shape) {
      this.clear(entry);
      if (node.type === 'space') this.buildSpace(entry, node, selected);
      else if (node.type === 'symbol') this.buildSymbol(entry, node, selected);
      else this.buildCamera(entry, node, selected);
      entry.shape = shape;
      this.picks = null;
    }
    const spec = labelSpec(node, selected), key = spec ? `${this.paletteVersion}|${spec.size}|${spec.text}|${spec.sub}` : '';
    if (key !== entry.labelKey) {
      this.dropLabel(entry);
      if (spec) {
        entry.label = makeLabel(spec, this.palette, entry.labelBag);
        if (entry.label) { this.scaleLabel(entry.label); entry.aux.add(entry.label); }
      }
      entry.labelKey = key;
    }
  }
  private refresh(entry: Entry, node: BackgroundNode, selected: boolean): void {
    this.redraw(entry, node, selected);
    const pose = nodeWorldPose(node), valid = finite(pose.position.x, pose.position.y, pose.position.z, pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    if (valid) {
      entry.root.position.set(pose.position.x, pose.position.y, pose.position.z);
      entry.root.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    }
    entry.root.scale.set(1, 1, 1);
    if (valid !== entry.valid) this.picks = null;
    entry.valid = valid; entry.node = node; entry.selected = selected; entry.dirty = false;
  }
  private place(entry: Entry): void {
    const { root, aux, label } = entry, position = root.position;
    if (entry.type === 'camera') {
      aux.position.set(position.x, 0, position.z);
      if (entry.drop) entry.drop.scale.y = Math.abs(position.y) < 1e-4 ? 1e-4 : position.y;
      if (label) label.position.set(0, position.y + entry.lift, 0);
      return;
    }
    aux.position.copy(position);
    if (label) label.position.set(0, entry.lift * Math.abs(root.scale.y), 0);
  }
  private scaleLabel(label: Sprite): void {
    label.scale.set(Number(label.userData.labelWidth) * this.labelScale, Number(label.userData.labelHeight) * this.labelScale, 1);
  }
  private clearUnderlay(): void {
    if (!this.underlay) return;
    this.floor.remove(this.underlay.mesh);
    this.underlay.bag.dispose();
    this.underlay = null;
  }

  private material(key: MaterialKey): Material {
    const cached = this.materials.get(key);
    if (cached) return cached;
    const palette = this.palette;
    const flat = (color: number, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide });
    const wall = (opacity: number) => new MeshLambertMaterial({ color: palette.accent, transparent: true, opacity, depthWrite: false, side: DoubleSide, forceSinglePass: true });
    // Lines are drawn with the see-through surfaces, after the floor, so a line lying on the floor is not dimmed by it.
    const line = (color: number, opacity: number) => new LineBasicMaterial({ color, transparent: true, opacity });
    const dash = (color: number, opacity: number, dashSize: number, gapSize: number) => new LineDashedMaterial({ color, transparent: true, opacity, dashSize, gapSize });
    const make = (): Material => {
      switch (key) {
        case 'floor': return flat(palette.card, palette.light ? 0.9 : 0.72);
        case 'floorLine': return line(palette.border, 1);
        case 'spaceFloor': return flat(palette.accent, 0.09);
        case 'spaceFloorOn': return flat(palette.accent, 0.2);
        case 'spaceWall': return wall(0.12);
        case 'spaceWallOn': return wall(0.27);
        case 'spaceLine': return line(palette.accentSub, 0.55);
        case 'spaceLineOn': return line(palette.accentSub, 1);
        case 'spaceDash': return dash(palette.accentSub, 0.55, 12, 7);
        case 'spaceDashOn': return dash(palette.accentSub, 1, 12, 7);
        case 'roadFloor': return flat(palette.road, 0.28);
        case 'roadFloorOn': return flat(palette.road, 0.44);
        case 'roadLine': return line(palette.road, 0.75);
        case 'roadLineLocked': return dash(palette.road, 0.75, 12, 7);
        case 'roadCentre': return dash(palette.roadMark, 0.9, 14, 10);
        case 'symbol': return new MeshLambertMaterial({ color: palette.symbol });
        case 'symbolOn': return new MeshLambertMaterial({ color: palette.accentSub });
        case 'symbolLine': return line(palette.symbol, 0.9);
        case 'symbolLineOn': return line(palette.accentSub, 1);
        case 'symbolArc': return dash(palette.symbol, 0.75, 0.05, 0.05);
        case 'symbolArcOn': return dash(palette.accentSub, 0.9, 0.05, 0.05);
        case 'symbolDash': return dash(palette.symbol, 1, 8, 6);
        case 'symbolDashOn': return dash(palette.accentSub, 1, 8, 6);
        case 'symbolFill': return flat(palette.symbol, 0.08);
        case 'symbolFillOn': return flat(palette.accentSub, 0.16);
        case 'symbolBound': return dash(palette.accentSub, 0.85, 5, 4);
        case 'camera': return new MeshLambertMaterial({ color: palette.camera });
        case 'cameraLens': return new MeshLambertMaterial({ color: palette.cameraLens });
        case 'cameraLine': return line(palette.camera, 0.6);
        case 'cameraLineOn': return line(palette.camera, 1);
        case 'cameraFar': return flat(palette.camera, 0.1);
        case 'cameraFarOn': return flat(palette.camera, 0.24);
        case 'cameraRing': return flat(palette.camera, 0.8);
        case 'proxy': return new MeshBasicMaterial({ visible: false, side: DoubleSide });
      }
    };
    const made = this.shared.track(make());
    this.materials.set(key, made);
    return made;
  }
  private geometry(key: GeometryKey): BufferGeometry {
    const cached = this.geometries.get(key);
    if (cached) return cached;
    const { width, height } = MAP_PLAN_EXTENT;
    const make = (): BufferGeometry => {
      switch (key) {
        // Unit box standing on its base: x and z in [-0.5, 0.5], y in [0, 1].
        case 'box': return new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
        // Wide end at the lens (origin), narrowing back toward the body on +Z.
        case 'lens': return new CylinderGeometry(4, 7, 8, 16).rotateX(Math.PI / 2).translate(0, 0, 4);
        case 'cameraProxy': return new SphereGeometry(20, 12, 8).translate(0, 0, 12);
        case 'ring': return new RingGeometry(6, 8.5, 28).rotateX(-Math.PI / 2);
        case 'drop': return segments([0, 0, 0, 0, 1, 0]);
        case 'floor': return new PlaneGeometry(width, height).rotateX(-Math.PI / 2);
        case 'floorLine': return segments([0, 0, 0, width, 0, 0, width, 0, 0, width, 0, height, width, 0, height, 0, 0, height, 0, 0, height, 0, 0, 0]);
      }
    };
    const made = this.shared.track(make());
    this.geometries.set(key, made);
    return made;
  }

  /** The base extent as a quiet filled rectangle with an outline. No dot grid. */
  private buildFloor(): void {
    for (const child of [...this.floor.children]) if (child !== this.underlay?.mesh) this.floor.remove(child);
    const fill = new Mesh(this.geometry('floor'), this.material('floor'));
    const outline = new LineSegments(this.geometry('floorLine'), this.material('floorLine'));
    fill.position.set(MAP_PLAN_EXTENT.width / 2, 0, MAP_PLAN_EXTENT.height / 2);
    fill.renderOrder = -3;
    fill.name = 'floor-fill'; outline.name = 'floor-outline';
    this.floor.add(fill, outline);
  }

  /** Open-top box along the real outline: floor fill, translucent walls, outline at the bottom and the top. A road is its floor alone. */
  private buildSpace(entry: Entry, node: BackgroundSpace, selected: boolean): void {
    const outline = spaceOutline(node, ELLIPSE_SEGMENTS).filter(point => finite(point.x, point.y)), count = outline.length;
    const road = isRoadSpace(node), height = spaceWallHeight(node); // 0 for a road
    entry.lift = (Number.isFinite(height) ? height : 0) + 4;
    if (count < 3 || !Number.isFinite(height)) return;
    const floor = new Mesh(entry.own.track(new ShapeGeometry(new Shape(outline.map(point => new Vector2(point.x, point.y)))).rotateX(Math.PI / 2)),
      this.material(road ? (selected ? 'roadFloorOn' : 'roadFloor') : (selected ? 'spaceFloorOn' : 'spaceFloor')));
    // Under the floors of the rooms, over the underlay: where a road and a room overlap the order never depends on the view.
    floor.renderOrder = road ? -1.5 : -1;
    if (road) {
      // A wall-less floor: its outline on the floor, and the dashed centre line where the shape has one.
      const edges = new LineSegments(entry.own.track(segments(outline.flatMap((a, index) => { const b = outline[(index + 1) % count]; return [a.x, 0, a.y, b.x, 0, b.y]; }))),
        this.material(node.locked ? (selected ? 'spaceDashOn' : 'roadLineLocked') : (selected ? 'spaceLineOn' : 'roadLine')));
      if (node.locked) edges.computeLineDistances();
      floor.name = 'space-floor'; edges.name = 'space-outline';
      tag(floor, node.id, 'space', 'floor'); entry.picks.push(floor);
      entry.root.add(floor, edges);
      const line = roadCentreLine(node);
      if (line) {
        const centre = new LineSegments(entry.own.track(segments(line.slice(1).flatMap((to, index) => [line[index].x, 0, line[index].y, to.x, 0, to.y]))), this.material('roadCentre'));
        centre.computeLineDistances(); centre.name = 'road-centre';
        entry.root.add(centre);
      }
      return;
    }
    const wallPositions: number[] = [], linePositions: number[] = [];
    // An ellipse reads as a cylinder with four uprights; a rectangle or polygon gets one per corner.
    const stride = node.shape === 'ellipse' ? Math.max(1, Math.round(count / 4)) : Math.max(1, Math.ceil(count / 32));
    outline.forEach((a: BackgroundPoint, index) => {
      const b = outline[(index + 1) % count];
      wallPositions.push(a.x, 0, a.y, b.x, 0, b.y, b.x, height, b.y, a.x, 0, a.y, b.x, height, b.y, a.x, height, a.y);
      linePositions.push(a.x, 0, a.y, b.x, 0, b.y, a.x, height, a.y, b.x, height, b.y);
      if (index % stride === 0) linePositions.push(a.x, 0, a.y, a.x, height, a.y);
    });
    const wallGeometry = entry.own.track(segments(wallPositions));
    wallGeometry.computeVertexNormals();
    const walls = new Mesh(wallGeometry, this.material(selected ? 'spaceWallOn' : 'spaceWall'));
    const edges = new LineSegments(entry.own.track(segments(linePositions)),
      this.material(node.locked ? (selected ? 'spaceDashOn' : 'spaceDash') : (selected ? 'spaceLineOn' : 'spaceLine')));
    if (node.locked) edges.computeLineDistances();
    floor.name = 'space-floor'; walls.name = 'space-walls'; edges.name = 'space-outline';
    for (const mesh of [floor, walls]) { tag(mesh, node.id, 'space', mesh === floor ? 'floor' : 'wall'); entry.picks.push(mesh); }
    entry.root.add(floor, walls, edges);
  }

  /** Simple solids inside a unit box scaled to (width, volumeHeight, height). Plan top is -Z. */
  private buildSymbol(entry: Entry, node: BackgroundSymbol, selected: boolean): void {
    const kind = getSymbolPreset(node.symbol).id, volume = nodeVolumeHeight(node);
    entry.lift = (Number.isFinite(volume) ? volume : 0) + 6;
    if (!finite(node.width, node.height, volume)) return;
    const width = Math.max(0.001, node.width), depth = Math.max(0.001, node.height), tall = Math.max(0.001, volume);
    const box = this.geometry('box'), solid = this.material(selected ? 'symbolOn' : 'symbol');
    const body = new Group();
    body.scale.set(width, tall, depth);
    const part = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material = solid) => {
      const mesh = new Mesh(box, material);
      mesh.name = name;
      mesh.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
      mesh.scale.set(x1 - x0, y1 - y0, z1 - z0);
      body.add(mesh);
      // What is drawn solid is what a click lands on.
      if (material === solid) { tag(mesh, node.id, 'symbol', 'solid'); entry.picks.push(mesh); }
    };
    if (kind === 'door') {
      // Same reading as the plan glyph: the leaf stands open at the hinge side and an arc on the floor shows the swing.
      const hingeX = node.hinge === 'right' ? 0.42 : -0.42, hingeZ = node.swing === 'outward' ? -0.42 : 0.42, radius = 0.84, steps = 16;
      part('door-leaf', hingeX - 0.03, hingeX + 0.03, 0, 1, -0.42, 0.42);
      part('door-sill', -0.42, 0.42, 0, 0.015, hingeZ - 0.025, hingeZ + 0.025);
      const arc: number[] = [], toClosed = hingeX > 0 ? -1 : 1, toOpen = hingeZ > 0 ? -1 : 1;
      const at = (turn: number) => [hingeX + toClosed * radius * Math.cos(turn), 0.02, hingeZ + toOpen * radius * Math.sin(turn)];
      for (let index = 0; index < steps; index++) arc.push(...at(index / steps * Math.PI / 2), ...at((index + 1) / steps * Math.PI / 2));
      const swing = new LineSegments(entry.own.track(segments(arc)), this.material(selected ? 'symbolArcOn' : 'symbolArc'));
      swing.computeLineDistances();
      swing.name = 'door-swing';
      body.add(swing);
    } else if (kind === 'chair') {
      part('chair-seat', -0.34, 0.34, 0.42, 0.52, -0.18, 0.36);
      part('chair-back', -0.36, 0.36, 0.42, 1, -0.43, -0.33);
      for (const x of [-0.3, 0.3]) for (const z of [-0.38, 0.31]) part('chair-leg', x - 0.03, x + 0.03, 0, 0.42, z - 0.03, z + 0.03);
    } else if (kind === 'table') {
      part('table-top', -0.45, 0.45, 0.88, 1, -0.41, 0.41);
      for (const x of [-0.38, 0.38]) for (const z of [-0.34, 0.34]) part('table-leg', x - 0.035, x + 0.035, 0, 0.88, z - 0.035, z + 0.035);
    } else if (kind === 'bed') {
      part('bed-frame', -0.41, 0.41, 0, 0.3, -0.37, 0.45);
      part('bed-mattress', -0.39, 0.39, 0.3, 0.62, -0.35, 0.43);
      part('bed-headboard', -0.41, 0.41, 0, 1, -0.45, -0.37);
      part('bed-pillow', -0.32, -0.05, 0.62, 0.76, -0.31, -0.16);
      part('bed-pillow', 0.05, 0.32, 0.62, 0.76, -0.31, -0.16);
    } else if (kind === 'stairs') {
      // Solid steps from the floor up, the lowest at the plan bottom (+Z) and the highest at the plan top (-Z), where the plan arrow points.
      const steps = Math.min(16, Math.max(3, Math.round(tall / 18)));
      for (let index = 0; index < steps; index++) part('stairs-step', -0.5, 0.5, 0, (index + 1) / steps, 0.5 - (index + 1) / steps, 0.5 - index / steps);
    } else {
      // Generic object: a dashed outline box. Its lines are built at real size so the dashes stay even.
      part('object-fill', -0.5, 0.5, 0, 1, -0.5, 0.5, this.material(selected ? 'symbolFillOn' : 'symbolFill'));
      const outline = new LineSegments(entry.own.track(boxEdges(width, tall, depth)), this.material(selected ? 'symbolDashOn' : 'symbolDash'));
      outline.computeLineDistances();
      outline.name = 'object-outline';
      entry.root.add(outline);
    }
    if (selected && kind !== 'custom') {
      const bound = new LineSegments(entry.own.track(boxEdges(width, tall, depth)), this.material('symbolBound'));
      bound.computeLineDistances();
      bound.name = 'selection-outline';
      entry.root.add(bound);
    }
    // The box around the solids is clickable too, so the gap between table legs still selects the table, but it never
    // beats something solid on the same ray. A door's box is mostly air: only its footprint on the floor counts.
    const proxy = new Mesh(box, this.material('proxy'));
    if (kind === 'door') proxy.scale.y = 0.03;
    proxy.name = 'symbol-proxy'; body.name = 'symbol-body';
    tag(proxy, node.id, 'symbol', 'box');
    body.add(proxy);
    entry.picks.push(proxy);
    entry.root.add(body);
  }

  /** Amber body looking down local -Z, with sight line, frustum outline, and a drop line to the floor. */
  private buildCamera(entry: Entry, node: BackgroundCamera, selected: boolean): void {
    const box = this.geometry('box'), solid = this.material('camera'), lineMaterial = this.material(selected ? 'cameraLineOn' : 'cameraLine');
    const body = new Mesh(box, solid), finder = new Mesh(box, solid), lens = new Mesh(this.geometry('lens'), this.material('cameraLens'));
    body.scale.set(16, 12, 20); body.position.set(0, -6, 18);
    finder.scale.set(5, 4, 9); finder.position.set(0, 6, 15);
    const rawAspect = cameraAspect(node), aspect = Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : MAP_SPATIAL_DEFAULTS.aspect;
    const fov = Math.min(170, Math.max(1, Number.isFinite(node.fov) ? node.fov : 60));
    // `fov` is horizontal; the frame height comes from the same conversion the look-through view uses.
    const reach = Math.min(80, 150 / Math.tan(fov * RADIANS / 2)), halfWidth = reach * Math.tan(fov * RADIANS / 2);
    const halfHeight = reach * Math.tan(verticalFov(fov, aspect) * RADIANS / 2);
    const corners = [[-halfWidth, halfHeight], [halfWidth, halfHeight], [halfWidth, -halfHeight], [-halfWidth, -halfHeight]];
    const lines: number[] = [0, 0, 0, 0, 0, -reach];
    corners.forEach(([x, y], index) => {
      const [nextX, nextY] = corners[(index + 1) % 4];
      lines.push(0, 0, 0, x, y, -reach, x, y, -reach, nextX, nextY, -reach);
    });
    // A small roof on the top edge shows which way is up when the camera is rolled.
    lines.push(-halfWidth * 0.3, halfHeight, -reach, 0, halfHeight * 1.35, -reach, 0, halfHeight * 1.35, -reach, halfWidth * 0.3, halfHeight, -reach);
    const frustum = new LineSegments(entry.own.track(segments(lines)), lineMaterial);
    const far = new Mesh(entry.own.track(segments([-halfWidth, halfHeight, -reach, halfWidth, halfHeight, -reach, halfWidth, -halfHeight, -reach,
      -halfWidth, halfHeight, -reach, halfWidth, -halfHeight, -reach, -halfWidth, -halfHeight, -reach])), this.material(selected ? 'cameraFarOn' : 'cameraFar'));
    const proxy = new Mesh(this.geometry('cameraProxy'), this.material('proxy'));
    body.name = 'camera-body'; finder.name = 'camera-finder'; lens.name = 'camera-lens'; frustum.name = 'camera-frustum'; far.name = 'camera-frame'; proxy.name = 'camera-proxy';
    tag(proxy, node.id, 'camera');
    entry.picks.push(proxy);
    entry.root.add(body, finder, lens, frustum, far, proxy);
    const drop = new LineSegments(this.geometry('drop'), lineMaterial), ring = new Mesh(this.geometry('ring'), this.material('cameraRing'));
    ring.position.y = 0.3;
    drop.name = 'camera-drop'; ring.name = 'camera-ring';
    entry.parts.add(drop, ring);
    entry.drop = drop; entry.lift = 16;
  }
}

/** Twelve edges of a box standing on its base centre. */
function boxEdges(width: number, height: number, depth: number): BufferGeometry {
  const x = width / 2, z = depth / 2, positions: number[] = [];
  const corners = [[-x, -z], [x, -z], [x, z], [-x, z]];
  corners.forEach(([ax, az], index) => {
    const [bx, bz] = corners[(index + 1) % 4];
    positions.push(ax, 0, az, bx, 0, bz, ax, height, az, bx, height, bz, ax, 0, az, ax, height, az);
  });
  return segments(positions);
}

export type MapPickHit = { distance: number; point?: Vec3; object: { userData: Record<string, unknown> } };
function hitNode(hit: MapPickHit): { id: string; kind: NodeKind; part: unknown } | null {
  const { nodeId, nodeKind, pickPart } = hit.object.userData;
  if (typeof nodeId !== 'string' || !Number.isFinite(hit.distance)) return null;
  return nodeKind === 'space' || nodeKind === 'symbol' || nodeKind === 'camera' ? { id: nodeId, kind: nodeKind, part: pickPart } : null;
}
/**
 * The space floor a ray lands on: the nearest one. Floors on one level (a room drawn inside another)
 * are told apart as the plan stacks them: the smaller space is on top.
 */
export function pickMapFloor(hits: readonly MapPickHit[], map?: BackgroundMap): MapPickHit | null {
  let nearest: MapPickHit | null = null;
  const floors = hits.filter(hit => { const node = hitNode(hit); return node?.kind === 'space' && node.part === 'floor'; });
  for (const hit of floors) if (!nearest || hit.distance < nearest.distance) nearest = hit;
  if (!nearest || !map) return nearest;
  const ranks = spaceStackRanks(map);
  const level = nearest.distance + 1e-6 * Math.max(1, nearest.distance), order = (hit: MapPickHit) => ranks.get(String(hit.object.userData.nodeId)) ?? -1;
  let top = nearest, topOrder = order(nearest);
  for (const hit of floors) {
    const at = hit.distance <= level ? order(hit) : -1;
    if (at > topOrder) { top = hit; topOrder = at; }
  }
  return top;
}
/** The roads on a ray that lie under a room on the same ray: the two share ground on the plan (spacesOverlap). */
function roadsUnderRooms(hits: readonly MapPickHit[], map: BackgroundMap): Set<string> {
  const onRay = new Set<string>();
  for (const hit of hits) { const node = hitNode(hit); if (node?.kind === 'space') onRay.add(node.id); }
  const spaces = map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && onRay.has(node.id));
  const rooms = spaces.filter(space => !isRoadSpace(space));
  return new Set(spaces.filter(space => isRoadSpace(space) && rooms.some(room => spacesOverlap(room, space))).map(space => space.id));
}
/**
 * Node a ray selects. A camera or a solid part of an object comes first, the nearest one. The see-through box around
 * an object only counts when nothing solid is on the ray. Then the space whose floor is under the pointer, and a wall
 * only when no floor is: walls and boxes never swallow a click on what stands inside or behind them. But the floor of
 * a road under a room on the ray takes no part at all: it is set aside before anything else (below).
 * `map` settles floors on the same level and tells which roads lie under a room: without it no road is set aside.
 */
export function pickMapNode(hits: readonly MapPickHit[], map?: BackgroundMap): string | null {
  // A road lies under the rooms that stand on it: where the ray also meets such a room, on its floor or on a wall and
  // at any height, the floor of that road takes no part in the click. Beside a room a road is a floor like any other.
  const under = map ? roadsUnderRooms(hits, map) : null;
  const list = under?.size ? hits.filter(hit => !under.has(String(hit.object.userData.nodeId))) : hits;
  type Near = { id: string; distance: number } | null;
  let solid: Near = null, box: Near = null, surface: Near = null;
  const nearer = (pick: Near, id: string, distance: number): Near => !pick || distance < pick.distance ? { id, distance } : pick;
  for (const hit of list) {
    const node = hitNode(hit);
    if (!node) continue;
    if (node.kind === 'space') surface = nearer(surface, node.id, hit.distance);
    else if (node.kind === 'symbol' && node.part === 'box') box = nearer(box, node.id, hit.distance);
    else solid = nearer(solid, node.id, hit.distance);
  }
  const floor = solid || box ? null : pickMapFloor(list, map);
  return solid?.id ?? box?.id ?? (floor ? String(floor.object.userData.nodeId) : surface?.id ?? null);
}
/** The spaces whose floor a ray lands on, in the order a click picks them: the nearest level first, and floors on one level as the plan stacks them, the smaller first. */
export function mapFloorPile(hits: readonly MapPickHit[], map: BackgroundMap): string[] {
  const ranks = spaceStackRanks(map), order = (hit: MapPickHit) => ranks.get(String(hit.object.userData.nodeId)) ?? -1;
  const floors = hits.filter(hit => { const node = hitNode(hit); return node?.kind === 'space' && node.part === 'floor'; }).sort((a, b) => a.distance - b.distance);
  const pile: string[] = [];
  for (let from = 0, to = 0; from < floors.length; from = to) {
    // One level is what pickMapFloor takes for one: every floor within the same margin of the nearest of them.
    const level = floors[from].distance + 1e-6 * Math.max(1, floors[from].distance);
    while (to < floors.length && floors[to].distance <= level) to++;
    for (const hit of floors.slice(from, to).sort((a, b) => order(b) - order(a))) {
      const id = String(hit.object.userData.nodeId);
      if (!pile.includes(id)) pile.push(id);
    }
  }
  return pile;
}
/**
 * The spaces a slow second click on one spot takes turns through: the floors under the pointer as mapFloorPile lists
 * them, and in front of them the room that the click picks on a wall when every floor behind that wall is a road
 * under a room on the ray. Without it such a road could not be reached there: the room takes every click.
 */
export function mapSpacePile(hits: readonly MapPickHit[], map: BackgroundMap): string[] {
  const pile = mapFloorPile(hits, map), picked = pickMapNode(hits, map);
  // A picked space that is no floor under the pointer was hit on a wall, and then every floor there is a road set
  // aside by pickMapNode: any other floor would have been picked instead. A camera or an object on top is no part of
  // a pile of spaces.
  return picked !== null && pile.length > 0 && !pile.includes(picked) && map.nodes.some(node => node.id === picked && node.type === 'space') ? [picked, ...pile] : pile;
}
/**
 * One click, as resolveMapClick and mapClickAim both read it: what the ray picks, what the click leaves selected, and
 * whether it got there by stepping on from the selected node. Only the part of a pile that is under the pointer takes
 * part: an item on the same plan spot at another height is clicked where it stands, and stepping onto it would leave
 * the others out of reach.
 */
function mapClickStep(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again: boolean, repeat: boolean): { picked: string | null; next: string | null; stepped: boolean } {
  const picked = pickMapNode(hits, map), plain = { picked, next: picked, stepped: false };
  if (!picked || !selectedId) return plain;
  const under = new Set<string>();
  for (const hit of hits) {
    const node = hitNode(hit);
    if (node) under.add(node.id);
  }
  if (!under.has(selectedId)) return plain;
  let pile: string[];
  if (map.nodes.some(node => node.id === selectedId && node.type === 'space')) {
    // A space has a pile only on the same spot again: a first click there takes what is on top.
    if (!again) return plain;
    pile = mapSpacePile(hits, map);
    // A repeated click neither steps on nor goes back to the top one. It keeps the selected space only while it and
    // what the click picks are both in the pile: with a camera or an object on top, or with the selected space
    // hit on a wall only, it is a plain pick (nextPlanSelection reads the pile first in the same way).
    if (repeat) return pile.includes(selectedId) && pile.includes(picked) ? { picked, next: selectedId, stepped: false } : plain;
  } else pile = stackedMapNodeIds(map, selectedId).filter(id => under.has(id));
  // A space hit on a wall only is no part of the pile, but for the room picked on a wall in front of the roads under it (mapSpacePile).
  if (pile.length < 2 || !pile.includes(selectedId) || !pile.includes(picked)) return plain;
  return { picked, next: pile[(pile.indexOf(selectedId) + 1) % pile.length], stepped: true };
}
/**
 * Selection after a click. `again`: the same spot clicked again (the caller remembers its last click). `repeat`: the
 * click is a repeated one of its click sequence (the second click of a double click, and on). A selected camera or
 * symbol steps through its pile as before, whatever the two say. A selected space steps on to the floor under it only
 * with `again` and without `repeat`: a repeated click on the same spot leaves it selected.
 */
export function resolveMapClick(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again = false, repeat = false): string | null {
  return mapClickStep(map, selectedId, hits, again, repeat).next;
}
/** The node a click is aimed at: the pile member that is already selected when the click steps on from it, else what the click picks. */
export function mapClickAim(map: BackgroundMap, selectedId: string | null, hits: readonly MapPickHit[], again = false): string | null {
  const click = mapClickStep(map, selectedId, hits, again, false);
  return click.stepped ? selectedId : click.picked;
}

/** World box around the base extent and everything placed on the map. */
export function mapWorldBounds(map: BackgroundMap): { min: Vec3; max: Vec3 } {
  const plan = mapPlanBounds(map);
  let low = 0, high = 0;
  for (const node of map.nodes) {
    // A road has no walls: only its floor level is in the box, whatever height is stored.
    const base = nodeElevation(node), top = node.type === 'camera' ? base : base + (node.type === 'space' ? spaceWallHeight(node) : nodeVolumeHeight(node));
    if (!finite(base, top)) continue;
    low = Math.min(low, base, top); high = Math.max(high, base, top);
  }
  return { min: { x: plan.x, y: low, z: plan.y }, max: { x: plan.x + plan.width, y: high, z: plan.y + plan.height } };
}
/** Three-quarter view that holds the whole map. The far side of the screen is the top of the plan. */
export function fitMapView(map: BackgroundMap, aspect: number, fov: number = MAP3D_VIEW_FOV): Map3DViewState {
  const { min, max } = mapWorldBounds(map);
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const radius = Math.max(60, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2);
  const halfVertical = fov * RADIANS / 2, halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(0.2, Number.isFinite(aspect) ? aspect : 1));
  const polar = 52 * RADIANS, azimuth = 24 * RADIANS;
  // Unit vector from the target to the viewer, and the screen axes of a viewer looking back along it.
  const away = { x: Math.sin(polar) * Math.sin(azimuth), y: Math.cos(polar), z: Math.sin(polar) * Math.cos(azimuth) };
  const right = { x: Math.cos(azimuth), y: 0, z: -Math.sin(azimuth) };
  const up = { x: away.y * right.z - away.z * right.y, y: away.z * right.x - away.x * right.z, z: away.x * right.y - away.y * right.x };
  const tanV = Math.tan(halfVertical), tanH = Math.tan(halfHorizontal), margin = 0.94;
  const corners = [min.x, max.x].flatMap(x => [min.y, max.y].flatMap(y => [min.z, max.z].map(z => ({ x: x - center.x, y: y - center.y, z: z - center.z }))));
  const holds = (distance: number) => corners.every(corner => {
    const depth = distance - (corner.x * away.x + corner.y * away.y + corner.z * away.z);
    if (depth <= 0) return false;
    const across = corner.x * right.x + corner.y * right.y + corner.z * right.z, upward = corner.x * up.x + corner.y * up.y + corner.z * up.z;
    return Math.abs(across) <= depth * tanH * margin && Math.abs(upward) <= depth * tanV * margin;
  });
  // The bounding sphere always fits but leaves a flat map small on screen: come as close as the box allows.
  let far = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.02, close = far * 0.2;
  if (holds(far)) {
    for (let step = 0; step < 24; step++) {
      const middle = (close + far) / 2;
      if (holds(middle)) far = middle; else close = middle;
    }
  }
  const distance = far;
  return { target: [center.x, center.y, center.z], position: [center.x + distance * away.x, center.y + distance * away.y, center.z + distance * away.z] };
}
/** Straight down, turned like the plan: plan top at the top of the screen, plan left at the left. */
export function topDownMapView(map: BackgroundMap, aspect: number, fov: number = MAP3D_VIEW_FOV): Map3DViewState {
  const { min, max } = mapWorldBounds(map), tangent = Math.tan(fov * RADIANS / 2), ratio = Math.max(0.2, Number.isFinite(aspect) ? aspect : 1);
  const distance = Math.max(120, (max.z - min.z) / (2 * tangent), (max.x - min.x) / (2 * tangent * ratio)) * 1.08;
  const x = (min.x + max.x) / 2, z = (min.z + max.z) / 2, height = Math.max(0, max.y) + distance;
  // A hair toward +Z keeps the screen's up direction on -Z instead of leaving it undefined.
  return { target: [x, 0, z], position: [x, height, z + height * 1e-4] };
}
