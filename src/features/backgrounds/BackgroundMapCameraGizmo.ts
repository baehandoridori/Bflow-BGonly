import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BoxGeometry, CylinderGeometry, Euler, Matrix4, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, TorusGeometry, Vector2 } from 'three';
import type { BufferGeometry, Camera, Object3D, Quaternion, Vector3 } from 'three';
import { applyNodeWorldPose } from './mapGeometry.ts';
import type { NodeWorldPoseInput } from './mapGeometry.ts';
import type { Map3DGizmoMode } from './mapCanvas.ts';
import type { BackgroundMap, BackgroundNode } from './types.ts';

/**
 * Gizmo glue for placed cameras, symbols and spaces: one TransformControls drag is one edit gesture
 * (begin, coalesced previews, then exactly one finish or one cancel), and the dragged root's
 * transform is turned back into node fields by applyNodeWorldPose from the map the drag started on.
 */
export type MapGizmoSetup = { mode: Map3DGizmoMode; space: 'world' | 'local'; showX: boolean; showY: boolean; showZ: boolean };

/**
 * Handles a node offers in a mode, or null when the mode does not apply: a camera has no size.
 * `flat`: the node has no height to size (a road), so the size handles leave the vertical axis out.
 */
export function mapGizmoSetup(type: BackgroundNode['type'], mode: Map3DGizmoMode, flat = false): MapGizmoSetup | null {
  if (mode === 'scale') return type === 'camera' ? null : { mode, space: 'local', showX: true, showY: !flat, showZ: true };
  // A space stays upright, so it only turns about the vertical axis.
  if (mode === 'rotate') return type === 'space' ? { mode, space: 'world', showX: false, showY: true, showZ: false } : { mode, space: 'local', showX: true, showY: true, showZ: true };
  return { mode, space: 'world', showX: true, showY: true, showZ: true };
}

/** Node roots sit directly under an untransformed group, so their own transform is the world pose. */
export function rootWorldPose(root: Object3D): NodeWorldPoseInput {
  const { position, quaternion, scale } = root;
  return { position: { x: position.x, y: position.y, z: position.z }, quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    scale: { x: scale.x, y: scale.y, z: scale.z } };
}
export function previewMapFromRoot(initialMap: BackgroundMap, id: string, root: Object3D): BackgroundMap {
  return applyNodeWorldPose(initialMap, id, rootWorldPose(root));
}

export type MapGizmoTarget = { id: string; type: BackgroundNode['type']; root: Object3D; flat?: boolean };
export type MapGizmoHost = {
  /** The editor's current draft: it becomes the initial map of a drag that starts now. */
  currentMap(): BackgroundMap;
  /** A drag took hold of this node's root: stop turning the world and stop writing to that root. */
  beginDrag(id: string): void;
  /** The drag is over. `map` is what the scene should show now: the last preview, or the initial map after a cancel. */
  endDrag(id: string, map: BackgroundMap): void;
  /** Run once before the next frame; previews are coalesced through it. */
  schedule(callback: () => void): number;
  unschedule(handle: number): void;
  onBeginGesture(): void;
  onPreview(map: BackgroundMap): void;
  onFinishGesture(): void;
  onCancelGesture(): void;
};
export type MapGizmoOptions = {
  /** Pointer travel in CSS pixels before a press on a handle changes anything, so a click or double click never nudges a node. */
  slop?: number;
};
type Drag = {
  id: string; root: Object3D; initialMap: BackgroundMap; shown: BackgroundMap; handle: number | null; pending: boolean;
  /** False until the pointer has travelled past the slop. */
  armed: boolean;
  position: Vector3; quaternion: Quaternion; scale: Vector3;
};

/**
 * Size of the transform handles for a viewport height. One size unit draws an arrow of about 0.119 of
 * the viewport height whatever the field of view, so this keeps the arrows near 72px, never below the
 * compact size used in tall viewports.
 */
export function mapGizmoSize(viewportHeight: number): number {
  return viewportHeight > 0 ? Math.min(2.2, Math.max(0.8, 72 / (0.11875 * viewportHeight))) : 0.8;
}

/**
 * Handle colours in the convention the team knows from Blender: red and green lie on the plan, blue is up.
 * The vertical axis is world Y here, so the controls' Y handles are the blue ones.
 */
export const MAP_GIZMO_COLORS = { planX: 0xff3352, up: 0x2890ff, planY: 0x8bdc00, active: 0xffd23f } as const;
/** Drawn handle sizes in gizmo units: an arrow is 0.5 long, about 72px on screen. */
export const MAP_GIZMO_SHAPE = { gap: 0.08, shaft: 0.0125, head: 0.048, headLength: 0.15, cube: 0.1, ring: 0.0125, centre: 0.045, rim: 0.005 } as const;

type GizmoMode = 'translate' | 'rotate' | 'scale';
type GizmoParts = { gizmo: Record<GizmoMode, Object3D>; picker: Record<GizmoMode, Object3D>; materialLib: Record<string, { color?: { isColor?: boolean } } | undefined> };
type GizmoHandle = Mesh<BufferGeometry, MeshBasicMaterial>;
type Axis = 'X' | 'Y' | 'Z';
const isAxis = (name: string): name is Axis => name === 'X' || name === 'Y' || name === 'Z';
/** Turns a shape built along +Y onto an axis. */
const AXIS_TURN: Record<Axis, Euler> = { X: new Euler(0, 0, -Math.PI / 2), Y: new Euler(0, 0, 0), Z: new Euler(Math.PI / 2, 0, 0) };
const turned = (geometry: BufferGeometry, turn: Euler): BufferGeometry => geometry.applyMatrix4(new Matrix4().makeRotationFromEuler(turn));
const gizmoParts = (controls: TransformControls): Partial<GizmoParts> | undefined => (controls as unknown as { _gizmo?: Partial<GizmoParts> })._gizmo;
/** A handle group as the restyle expects it: nothing but meshes with one material each. */
const isHandleGroup = (group: Object3D | undefined): boolean => !!group && Array.isArray(group.children) && group.children.every(child => {
  const { geometry, material } = child as Partial<GizmoHandle>;
  return !!geometry?.isBufferGeometry && !!material?.isMaterial;
});
/** The materials setColors() writes to. */
const GIZMO_MATERIALS = ['xAxis', 'yAxis', 'zAxis', 'active', 'xAxisTransparent', 'yAxisTransparent', 'zAxisTransparent', 'activeTransparent'];
/** The parts of the stock gizmo the restyle touches, or null unless all of them are there and not restyled yet. */
function stockGizmoParts(controls: TransformControls): GizmoParts | null {
  const { gizmo, picker, materialLib } = gizmoParts(controls) ?? {};
  if (!gizmo || !picker || !materialLib || typeof controls.setColors !== 'function') return null;
  if (![gizmo.translate, gizmo.rotate, gizmo.scale, picker.translate, picker.scale].every(isHandleGroup)) return null;
  if (!GIZMO_MATERIALS.every(name => materialLib[name]?.color?.isColor)) return null;
  // A second pass would add a second outline.
  return gizmo.rotate.children.some(child => child.name === 'OUTLINE') ? null : { gizmo, picker, materialLib };
}

/**
 * Blender-like handles: one bold arrow per axis instead of a hairline with heads on both ends, solid
 * turn rings with a faint outline, a clear centre dot, and Blender's axis colours.
 * Only what is drawn changes, plus the hit areas behind the removed negative ends and around the smaller
 * centre; the controls' own logic is untouched. Unknown internals (another three version) keep the stock
 * look: everything is checked before anything is changed, so a gizmo is never left half restyled.
 */
export function styleMapGizmo(controls: TransformControls): void {
  const parts = stockGizmoParts(controls);
  if (!parts) return;
  const drawn = parts.gizmo, pickers = parts.picker;
  controls.setColors(MAP_GIZMO_COLORS.planX, MAP_GIZMO_COLORS.up, MAP_GIZMO_COLORS.planY, MAP_GIZMO_COLORS.active);
  const shape = MAP_GIZMO_SHAPE;
  const swap = (handle: GizmoHandle, geometry: BufferGeometry) => { handle.geometry.dispose(); handle.geometry = geometry; };
  const drop = (group: Object3D, handle: GizmoHandle) => { group.remove(handle); handle.geometry.dispose(); };
  /** Where a handle sits along its own axis: the stock gizmo draws and picks both directions. */
  const side = (handle: GizmoHandle, axis: Axis): number => {
    handle.geometry.computeBoundingBox();
    const box = handle.geometry.boundingBox;
    return box ? (axis === 'X' ? box.min.x + box.max.x : axis === 'Y' ? box.min.y + box.max.y : box.min.z + box.max.z) : 0;
  };
  for (const mode of ['translate', 'scale'] as const) {
    for (const handle of [...drawn[mode].children] as GizmoHandle[]) {
      const name = handle.name;
      if (name === 'XYZ') {
        // The size gizmo has no centre handle (see onDraggingChanged); the move gizmo gets a solid dot.
        if (mode === 'scale') drop(drawn.scale, handle);
        else {
          swap(handle, new SphereGeometry(shape.centre, 20, 14));
          // The controls remember a handle's opacity from their first frame and put it back on every later one.
          const material = handle.material as MeshBasicMaterial & { _opacity?: number };
          material.opacity = 0.9;
          if (material._opacity) material._opacity = 0.9;
        }
        continue;
      }
      if (!isAxis(name)) continue;
      if (side(handle, name) < -1e-6) { drop(drawn[mode], handle); continue; }
      const kind = handle.geometry.type, tip = (handle.geometry as BufferGeometry & { parameters?: { radiusTop?: number } }).parameters?.radiusTop === 0;
      if (kind === 'BoxGeometry') swap(handle, turned(new BoxGeometry(shape.cube, shape.cube, shape.cube).translate(0, 0.5 + shape.cube / 2, 0), AXIS_TURN[name]));
      else if (kind === 'CylinderGeometry' && tip) swap(handle, turned(new CylinderGeometry(0, shape.head, shape.headLength, 20).translate(0, 0.5 + shape.headLength / 2, 0), AXIS_TURN[name]));
      else if (kind === 'CylinderGeometry') swap(handle, turned(new CylinderGeometry(shape.shaft, shape.shaft, 0.5 - shape.gap, 10).translate(0, shape.gap + (0.5 - shape.gap) / 2, 0), AXIS_TURN[name]));
    }
    for (const handle of [...pickers[mode].children] as GizmoHandle[]) {
      if (isAxis(handle.name) && side(handle, handle.name) < -1e-6) drop(pickers[mode], handle);
      // The stock free-move hit area is sized for the stock centre: around the small dot it would take
      // presses on bare pixels far from it. It now ends where the arrows begin.
      else if (mode === 'translate' && handle.name === 'XYZ') swap(handle, new SphereGeometry(shape.gap, 12, 8));
    }
  }
  // Half rings, laid out exactly like the stock ones so the controls keep turning them toward the viewer.
  const ring = (radius: number, tube: number, arc: number) => new TorusGeometry(radius, tube, 8, 72, arc).rotateY(Math.PI / 2).rotateX(Math.PI / 2);
  const RING_TURN: Record<Axis, Euler> = { X: new Euler(0, 0, 0), Y: new Euler(0, 0, -Math.PI / 2), Z: new Euler(0, Math.PI / 2, 0) };
  for (const handle of [...drawn.rotate.children] as GizmoHandle[]) {
    if (isAxis(handle.name)) swap(handle, turned(ring(0.5, shape.ring, Math.PI), RING_TURN[handle.name]));
  }
  // A thin circle facing the viewer makes the three rings read as one ball. Any name with an E is kept
  // facing the camera by the controls and shows only while all three rings do; it is never picked.
  const rim = new Mesh(turned(ring(0.5, shape.rim, Math.PI * 2), RING_TURN.Z),
    new MeshBasicMaterial({ color: 0xffffff, opacity: 0.4, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  rim.name = 'OUTLINE';
  rim.renderOrder = Infinity;
  drawn.rotate.add(rim);
}

const drawnRay = new Raycaster(), drawnPoint = new Vector2();
/**
 * The move or size handle drawn under the pointer, or null when none is.
 * The controls pick by wide unseen shapes, and those of the upright arrow, the squares and the centre lie
 * in front of a plan arrow that points away from the viewer: a press on that arrow would lift the node
 * instead of sliding it. What is drawn under the pointer therefore wins, from the start of a shaft to the
 * tip of its head; the wide shapes still catch a near miss. Turn rings are left to the controls.
 */
function drawnMapGizmoAxis(controls: TransformControls, pointer: { x: number; y: number } | null): TransformControls['axis'] {
  if (!pointer || controls.object === undefined || controls.dragging || controls.mode === 'rotate') return null;
  const handles = gizmoParts(controls)?.gizmo?.[controls.mode]?.children;
  if (!handles) return null;
  drawnRay.setFromCamera(drawnPoint.set(pointer.x, pointer.y), controls.camera);
  const hits = drawnRay.intersectObjects(handles, false).filter(item => item.object.visible);
  // The nearest one, except that the squares (two-letter names) are see-through: an arrow or the dot seen through one is what the press is for.
  const hit = hits.find(item => item.object.name.length !== 2) ?? hits[0];
  return hit ? hit.object.name as TransformControls['axis'] : null;
}

export class MapNodeGizmo {
  readonly controls: TransformControls;
  /** Visual part of the gizmo; the owner adds it to the scene. */
  readonly helper: Object3D;
  private readonly host: MapGizmoHost;
  private readonly element: HTMLElement | null;
  private readonly slop: number;
  private target: MapGizmoTarget | null = null;
  private drag: Drag | null = null;
  private cancelling = false;

  /** `element` may be null in tests that drive the controls directly. */
  constructor(camera: Camera, element: HTMLElement | null, host: MapGizmoHost, options: MapGizmoOptions = {}) {
    this.host = host;
    this.element = element;
    this.slop = options.slop ?? 0;
    this.controls = new TransformControls(camera, element);
    this.helper = this.controls.getHelper();
    // Only the three axis rings turn a node; the free and screen-space rotations are off.
    this.controls.showE = false;
    this.controls.showXYZE = false;
    // A little smaller than the default, so the handles cover less of what stands next to the selection.
    this.controls.setSize(0.8);
    styleMapGizmo(this.controls);
    // The controls hit-test their handles and read their drag plane as last drawn. Frames are drawn on
    // demand here, so a press can arrive before the frame after the hover (always on touch): the start
    // point would lie on a stale plane and the first move would jump. Bring both up to date first.
    // A handle drawn under the pointer is the one that is grabbed (see drawnMapGizmoAxis).
    type Pointer = { x: number; y: number } | null;
    const controls = this.controls as unknown as { pointerHover(pointer: Pointer): void; pointerDown(pointer: Pointer): void };
    const hover = controls.pointerHover.bind(this.controls), press = controls.pointerDown.bind(this.controls);
    controls.pointerHover = pointer => {
      this.helper.updateMatrixWorld(true);
      const drawn = drawnMapGizmoAxis(this.controls, pointer);
      if (drawn !== null) this.controls.axis = drawn;
      else hover(pointer);
    };
    controls.pointerDown = pointer => { this.helper.updateMatrixWorld(true); press(pointer); };
    this.controls.addEventListener('dragging-changed', this.onDraggingChanged);
    this.controls.addEventListener('objectChange', this.onObjectChange);
    element?.addEventListener('pointercancel', this.onInterrupted);
    element?.addEventListener('lostpointercapture', this.onInterrupted);
    // After the hover listener of the controls, which connected first.
    element?.addEventListener('pointermove', this.onHover);
  }

  /** Keep the handles easy to grab: at a fixed size they shrink to about 30px in a short viewport. */
  setViewportHeight(height: number): void {
    if (height > 0) this.controls.setSize(mapGizmoSize(height));
  }
  get dragging(): boolean { return this.drag !== null; }
  get draggedId(): string | null { return this.drag?.id ?? null; }
  /** The pointer is over a handle (or holding one). */
  get hovering(): boolean { return this.target !== null && this.controls.axis !== null; }
  get attachedId(): string | null { return this.target?.id ?? null; }

  /** Show the gizmo on this node, or hide it. Returns false when the mode offers nothing for the node. */
  setTarget(target: MapGizmoTarget | null, mode: Map3DGizmoMode): boolean {
    const setup = target ? mapGizmoSetup(target.type, mode, target.flat) : null;
    if (!target || !setup) { this.detach(); return false; }
    // A running drag keeps its handles; the owner cancels it first when the target must change.
    if (this.drag) return true;
    const controls = this.controls;
    controls.setMode(setup.mode);
    controls.setSpace(setup.space);
    controls.showX = setup.showX; controls.showY = setup.showY; controls.showZ = setup.showZ;
    if (this.target?.root !== target.root) controls.attach(target.root);
    this.target = target;
    return true;
  }
  detach(): void {
    this.cancel();
    if (this.target) this.controls.detach();
    this.target = null;
  }
  /** The owner reports how far the pointer is from where it was pressed. Past the slop the drag starts to count. */
  pointerTravel(pixels: number): void {
    const drag = this.drag;
    if (drag && !drag.armed && pixels >= this.slop) drag.armed = true;
  }

  /** End the running drag as a release of the handle: it commits once, like letting go of the button. */
  release(): void {
    if (this.drag) this.controls.pointerUp(null);
  }

  /** Put the root back where the drag started and end it without committing. Returns false when nothing was dragged. */
  cancel(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.cancelling = true;
    if (drag.handle !== null) this.host.unschedule(drag.handle);
    try {
      this.controls.reset();
      // TransformControls has no cancel call: clearing these two ends the interaction, and its move handler then ignores the pointer.
      this.controls.dragging = false;
      this.controls.axis = null;
    } finally {
      this.restore(drag);
      this.drag = null;
      this.cancelling = false;
    }
    this.host.endDrag(drag.id, drag.initialMap);
    this.host.onCancelGesture();
    return true;
  }

  dispose(): void {
    this.cancel();
    this.controls.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.controls.removeEventListener('objectChange', this.onObjectChange);
    this.element?.removeEventListener('pointercancel', this.onInterrupted);
    this.element?.removeEventListener('lostpointercapture', this.onInterrupted);
    this.element?.removeEventListener('pointermove', this.onHover);
    this.controls.detach();
    this.target = null;
    // dispose() also disconnects DOM listeners, which needs an element.
    if (this.element) this.controls.dispose();
    else (this.helper as Object3D & { dispose?: () => void }).dispose?.();
  }

  private readonly onDraggingChanged = (event: { value: unknown }): void => {
    if (event.value === true) {
      const target = this.target;
      if (!target || this.drag) return;
      // The centre of the size gizmo scales all three axes by the ratio to a start only a few pixels long,
      // so a tiny drag would multiply or collapse the node. A press there is not a drag.
      if (this.controls.mode === 'scale' && this.controls.axis === 'XYZ') {
        this.controls.dragging = false;
        this.controls.axis = null;
        return;
      }
      const root = target.root, initialMap = this.host.currentMap();
      this.drag = { id: target.id, root, initialMap, shown: initialMap, handle: null, pending: false, armed: this.slop <= 0,
        position: root.position.clone(), quaternion: root.quaternion.clone(), scale: root.scale.clone() };
      this.host.beginDrag(target.id);
      this.host.onBeginGesture();
      return;
    }
    const drag = this.drag;
    if (!drag || this.cancelling) return;
    if (drag.armed) this.flush();
    // A press that never left the slop was a click: the controls may have nudged the root, the data stays untouched.
    else this.restore(drag);
    this.drag = null;
    this.host.onFinishGesture();
    this.host.endDrag(drag.id, drag.shown);
  };

  private readonly onObjectChange = (): void => {
    const drag = this.drag;
    if (!drag || this.cancelling || !drag.armed) return;
    drag.pending = true;
    if (drag.handle !== null) return;
    drag.handle = this.host.schedule(() => {
      if (this.drag !== drag) return;
      drag.handle = null;
      this.flush();
    });
  };

  private readonly onInterrupted = (): void => { this.cancel(); };
  /** The unused centre of the size gizmo lights up nothing when the pointer passes over it. */
  private readonly onHover = (): void => {
    if (!this.controls.dragging && this.controls.mode === 'scale' && this.controls.axis === 'XYZ') this.controls.axis = null;
  };

  private restore(drag: Drag): void {
    drag.root.position.copy(drag.position);
    drag.root.quaternion.copy(drag.quaternion);
    drag.root.scale.copy(drag.scale);
  }

  /** Send the newest pose as one preview. */
  private flush(): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.handle !== null) { this.host.unschedule(drag.handle); drag.handle = null; }
    if (!drag.pending) return;
    drag.pending = false;
    drag.shown = previewMapFromRoot(drag.initialMap, drag.id, drag.root);
    this.host.onPreview(drag.shown);
  }
}
