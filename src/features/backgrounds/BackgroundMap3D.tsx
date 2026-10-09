import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MOUSE, PerspectiveCamera, Plane, Raycaster, TOUCH, Vector2, Vector3, WebGLRenderer } from 'three';
import type { Scene } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Map3DProps, Map3DViewState } from './mapCanvas';
import type { BackgroundCamera, BackgroundMap, BackgroundPoint } from './types';
import { MAP3D_DARK_PALETTE, MAP3D_VIEW_FOV, Map3DScene, fitMapView, mapClickAim, mapFloorPile, mapWorldBounds, pickMapFloor, pickMapNode, resolveMapClick, sameMap3DPalette, topDownMapView } from './map3dScene';
import type { Map3DPalette, MapPickHit } from './map3dScene';
import { MapNodeGizmo, mapGizmoSetup } from './BackgroundMapCameraGizmo';
import { stackedMapNodeIds } from './mapGeometry';
import { MAP_SPATIAL_DEFAULTS, cameraAspect, nodeWorldPose, verticalFov } from './mapSpatial';
import './backgrounds-map-3d.css';

const UNAVAILABLE_AT_START = '이 PC에서는 3D 화면을 열 수 없어 평면 도면으로 보여 드립니다. 편집하던 내용은 그대로 있습니다.';
const UNAVAILABLE_LOST = '3D 화면이 멈춰서 평면 도면으로 돌아왔습니다. 편집하던 내용은 그대로 있습니다.';
const RADIANS = Math.PI / 180;
const PLAN_LIMIT = 100000;
const CLICK_SLOP = 4;
const DOUBLE_CLICK_GUARD = 450;

type ViewRect = { x: number; y: number; width: number; height: number };
type Press = { pointerId: number; x: number; y: number; moved: boolean; gizmo: boolean; /** The second click of a double click, and on. */ repeat: boolean };
type Map3DDevHandle = {
  scene: Scene; camera: PerspectiveCamera; renderer: WebGLRenderer; orbit: OrbitControls; transform: TransformControls;
  /** Client pixel position of a node's root: base centre of a space or symbol, lens of a camera. */
  nodeScreenPoint(id: string): BackgroundPoint | null;
  render(): void;
};
declare global {
  interface Window { __bflowMap3d?: Map3DDevHandle }
}

function readPalette(element: HTMLElement): Map3DPalette {
  const style = getComputedStyle(element), base = MAP3D_DARK_PALETTE;
  const triple = (name: string): number[] | null => {
    const parts = style.getPropertyValue(name).trim().split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) ? parts.map(value => Math.min(255, Math.max(0, Math.round(value)))) : null;
  };
  const hex = (name: string, fallback: number) => { const value = triple(name); return value ? (value[0] << 16) | (value[1] << 8) | value[2] : fallback; };
  const css = (name: string, fallback: string) => { const value = triple(name); return value ? `rgb(${value[0]}, ${value[1]}, ${value[2]})` : fallback; };
  const light = document.documentElement.getAttribute('data-color-mode') === 'light';
  return {
    light, background: hex('--color-bg-primary', base.background), card: hex('--color-bg-card', base.card), border: hex('--color-bg-border', base.border),
    accent: hex('--color-accent', base.accent), accentSub: hex('--color-accent-sub', base.accentSub),
    symbol: light ? 0x4f8f9a : base.symbol, camera: base.camera, cameraLens: base.cameraLens,
    text: css('--color-text-primary', base.text), halo: css('--color-bg-primary', base.halo), font: style.fontFamily || base.font,
  };
}
function validView(view: Map3DViewState | null): Map3DViewState | null {
  if (!view || view.target.length !== 3 || view.position.length !== 3) return null;
  return [...view.target, ...view.position].every(Number.isFinite) ? view : null;
}
const sameView = (a: Map3DViewState, b: Map3DViewState) =>
  a.target.every((value, index) => Math.abs(value - b.target[index]) < 1e-3) && a.position.every((value, index) => Math.abs(value - b.position[index]) < 1e-3);
const findCamera = (map: BackgroundMap, id: string | null): BackgroundCamera | null => {
  const node = id ? map.nodes.find(item => item.id === id) : undefined;
  return node?.type === 'camera' ? node : null;
};

/**
 * The WebGL side of the 3D map: one renderer for the component's life, drawn on demand.
 * It is controlled by props like the plan: it keeps no map, selection or placed camera of its own.
 */
class Map3DViewport {
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(MAP3D_VIEW_FOV, 1, 1, 20000);
  private scene3d!: Map3DScene;
  private gizmo!: MapNodeGizmo;
  private orbit!: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly hit = new Vector3();
  private readonly onNotice: (text: string) => void;
  private readonly beforeFrame = new Map<number, () => void>();
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private devHandle: Map3DDevHandle | null = null;
  private props: Map3DProps;
  private palette: Map3DPalette;
  private shown: { map: BackgroundMap; selectedId: string | null; holdId: string | null; hiddenId: string | null } | null = null;
  private look: { id: string; saved: Map3DViewState } | null = null;
  private lookMissing: string | null = null;
  private reported: Map3DViewState | null = null;
  private press: Press | null = null;
  /** What the last pick landed on (the node on top there) and what it left selected: the same spot clicked again is told from it. */
  private turn: { hitId: string; pickedId: string | null } | null = null;
  /** The node the last first click (mousedown detail 1) with the select tool was aimed at. Null after any other click. */
  private aimed: string | null = null;
  private focusSeen: Map3DProps['focusRequest'];
  private pendingFocus: string | null = null;
  private boundsMap: BackgroundMap | null = null;
  private ratioQuery: MediaQueryList | null = null;
  private mapId: string | null = null;
  private radius = 1000;
  private width = 0;
  private height = 0;
  private ratio = 0;
  private frame = 0;
  private nextHandle = 1;
  private lastDragAt = Number.NEGATIVE_INFINITY;
  private fitPending = false;
  /** The view as last fitted automatically. While nobody has moved it, a reshaped pane is fitted again. */
  private autoFit: Map3DViewState | null = null;
  private lost = false;
  private disposed = false;

  /** Throws when WebGL cannot start; nothing is left behind in that case. */
  constructor(host: HTMLElement, stage: HTMLElement, props: Map3DProps, onNotice: (text: string) => void) {
    this.host = host; this.props = props; this.onNotice = onNotice;
    this.focusSeen = props.focusRequest;
    // A fresh canvas per start: a context that was force-lost on cleanup can never be reused.
    const canvas = document.createElement('canvas');
    canvas.className = 'bmap-3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    this.canvas = canvas;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch (error) {
      canvas.remove();
      throw error;
    }
    if (renderer.getContext().isContextLost()) {
      renderer.dispose();
      canvas.remove();
      throw new Error('WebGL context is not available.');
    }
    this.renderer = renderer;
    this.palette = readPalette(host);
    try {
      this.start(canvas, onNotice);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  /** Everything after the renderer exists. A failure here is cleaned up like a normal dispose. */
  private start(canvas: HTMLCanvasElement, onNotice: (text: string) => void): void {
    const host = this.host, renderer = this.renderer;
    renderer.setClearColor(this.palette.background, 1);
    this.scene3d = new Map3DScene(this.palette, this.requestRender);
    this.scene3d.onUnderlayError = () => onNotice('밑그림 이미지는 3D에서 불러오지 못했어요. 평면에서는 그대로 보여요.');
    // The gizmo listens before OrbitControls, so pressing a handle turns world orbiting off before it can start.
    this.gizmo = new MapNodeGizmo(this.camera, canvas, {
      currentMap: () => this.props.map,
      beginDrag: () => {
        this.orbit.enabled = false;
        if (this.press) this.press.gizmo = true;
        window.addEventListener('keydown', this.onDragKey, { capture: true });
      },
      endDrag: (id, map) => {
        window.removeEventListener('keydown', this.onDragKey, { capture: true });
        // The root may be left scaled or ahead of the data: rebuild it from the map the drag ended on.
        this.scene3d.invalidate(id);
        this.shown = null;
        this.syncScene(map);
        this.applyGizmo();
        this.applyOrbit();
        this.requestRender();
      },
      schedule: callback => {
        const handle = this.nextHandle++;
        this.beforeFrame.set(handle, callback);
        this.requestRender();
        return handle;
      },
      unschedule: handle => { this.beforeFrame.delete(handle); },
      onBeginGesture: () => this.props.onBeginGesture(),
      // Members of a dragged space follow in the same frame; the props catch up with the same map object.
      onPreview: map => { this.syncScene(map); this.props.onPreview(map); },
      onFinishGesture: () => this.props.onFinishGesture(),
      // The pointer may still be down: its late release is not a click. A cancelled drag ends the memory of the spot, as on the plan.
      onCancelGesture: () => { if (this.press) this.press.moved = true; this.turn = null; this.props.onCancelGesture(); },
    }, { slop: CLICK_SLOP });
    this.scene3d.scene.add(this.gizmo.helper);
    this.gizmo.controls.addEventListener('change', this.requestRender);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = false;
    this.orbit.screenSpacePanning = false;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    // A full turn per viewport height is too twitchy in the short split view.
    this.orbit.rotateSpeed = 0.6;
    this.orbit.minDistance = 20;
    this.orbit.maxDistance = 20000;
    this.orbit.addEventListener('change', this.requestRender);
    this.orbit.addEventListener('end', this.onOrbitEnd);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    window.addEventListener('pointerdown', this.onPressElsewhere, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.themeObserver = new MutationObserver(() => this.refreshPalette());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] });
    this.resize();
    if (import.meta.env.DEV) {
      this.devHandle = { scene: this.scene3d.scene, camera: this.camera, renderer, orbit: this.orbit, transform: this.gizmo.controls,
        nodeScreenPoint: id => this.nodeScreenPoint(id), render: () => this.renderFrame() };
      window.__bflowMap3d = this.devHandle;
    }
  }

  /** Apply the newest props. Called after every render of the component. */
  update(props: Map3DProps): void {
    if (this.disposed) return;
    const previous = this.props, mapChanged = this.mapId !== props.map.id;
    this.props = props;
    // A drag only lives while everything it started with still holds; otherwise it is undone, never committed.
    if (this.gizmo.dragging && (mapChanged || props.gizmoMode !== previous.gizmoMode || !this.gizmoAllowed(props, this.gizmo.draggedId))) this.gizmo.cancel();
    // A selection made some other way (the object list, the companion plan, the plan): the next click here is a first press.
    if (this.turn && props.selectedId !== this.turn.pickedId) this.turn = null;

    const lookNode = findCamera(props.map, props.lookThroughId);
    if (props.lookThroughId && !lookNode) {
      if (this.lookMissing !== props.lookThroughId) { this.lookMissing = props.lookThroughId; props.onLookThroughChange(null); }
    } else this.lookMissing = null;
    if (lookNode && !this.look) this.look = { id: lookNode.id, saved: this.currentView() };
    else if (lookNode && this.look) this.look.id = lookNode.id;
    else if (!lookNode && this.look) {
      const saved = this.look.saved;
      this.look = null;
      this.applyView(saved);
    }

    this.syncScene(props.map);
    this.scene3d.setUnderlay(props.map.imageUrl ?? '');
    if (props.map !== this.boundsMap && !this.gizmo.dragging) {
      const { min, max } = mapWorldBounds(props.map);
      this.boundsMap = props.map;
      this.radius = Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2;
      this.orbit.maxDistance = Math.max(20000, this.radius * 12);
    }
    if (mapChanged) {
      this.mapId = props.map.id;
      this.pendingFocus = null;
      this.aimed = null; this.turn = null;
      this.openView(props.initialView);
    }
    this.applyGizmo();
    this.applyOrbit();

    const request = props.focusRequest, seen = this.focusSeen;
    this.focusSeen = request;
    if (request && (request.nonce !== seen?.nonce || request.id !== seen?.id)) this.focus(request.id);
    else if (this.pendingFocus) this.focus(this.pendingFocus);
    // A newly opened map is drawn in the same turn, so its first painted frame already has the right view.
    if (mapChanged) this.renderFrame();
    else this.requestRender();
  }

  zoom(factor: number): void {
    if (this.disposed || this.look || this.gizmo.dragging) return;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.setLength(Math.min(this.orbit.maxDistance, Math.max(this.orbit.minDistance, offset.length() * factor)));
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
    this.requestRender();
    this.reportView();
  }
  fit(): void {
    if (this.disposed || this.look || this.gizmo.dragging || !this.width || !this.height) return;
    this.applyView(fitMapView(this.props.map, this.width / this.height));
    this.autoFit = this.currentView();
    this.reportView();
  }
  topDown(): void {
    if (this.disposed || this.look || this.gizmo.dragging || !this.width || !this.height) return;
    this.applyView(topDownMapView(this.props.map, this.width / this.height));
    this.reportView();
  }

  /** Also runs for a start that failed half way, so every part may still be missing. */
  dispose(): void {
    if (this.disposed) return;
    // An unfinished drag is undone and reported to the editor once, before anything is torn down.
    this.gizmo?.cancel();
    this.disposed = true;
    if (this.frame > 0) cancelAnimationFrame(this.frame);
    this.beforeFrame.clear();
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.ratioQuery?.removeEventListener('change', this.onRatioChange);
    window.removeEventListener('keydown', this.onDragKey, { capture: true });
    const canvas = this.canvas;
    // Removed before the context is dropped on purpose below, so leaving the view never reports a failure.
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('pointerdown', this.onPressElsewhere, true);
    this.orbit?.removeEventListener('change', this.requestRender);
    this.orbit?.removeEventListener('end', this.onOrbitEnd);
    this.orbit?.dispose();
    if (this.gizmo) {
      this.gizmo.controls.removeEventListener('change', this.requestRender);
      this.scene3d.scene.remove(this.gizmo.helper);
      this.gizmo.dispose();
    }
    this.scene3d?.dispose();
    this.renderer.dispose();
    // A context that is already lost has no lose-context extension left; asking again only logs a warning.
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    canvas.remove();
    if (this.devHandle && window.__bflowMap3d === this.devHandle) delete window.__bflowMap3d;
  }

  private readonly requestRender = (): void => {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.renderFrame);
  };
  /** One frame: queued previews first, then a single draw. */
  private readonly renderFrame = (): void => {
    if (this.frame > 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.disposed) return;
    if (this.beforeFrame.size) {
      const callbacks = [...this.beforeFrame.values()];
      this.beforeFrame.clear();
      // Whatever the previews ask for is covered by the draw right below.
      this.frame = -1;
      try {
        for (const callback of callbacks) callback();
      } finally {
        this.frame = 0;
      }
    }
    this.draw();
  };
  private draw(): void {
    // Nothing is drawn while the tab is hidden (0 x 0); the next resize draws again.
    if (this.disposed || this.lost || this.width === 0 || this.height === 0) return;
    const draggedId = this.gizmo.draggedId;
    if (draggedId) this.scene3d.follow(draggedId);
    const renderer = this.renderer, view = this.frameView(), letterboxed = view.width !== this.width || view.height !== this.height;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.width, this.height);
    if (letterboxed) {
      renderer.setClearColor(this.palette.light ? this.palette.border : 0x000000, 1);
      renderer.clear();
      const bottom = this.height - view.y - view.height;
      renderer.setViewport(view.x, bottom, view.width, view.height);
      renderer.setScissor(view.x, bottom, view.width, view.height);
      renderer.setScissorTest(true);
    }
    renderer.setClearColor(this.palette.background, 1);
    this.scene3d.setLabelScale(2 * Math.tan(this.camera.fov * RADIANS / 2) / view.height);
    renderer.render(this.scene3d.scene, this.camera);
  }
  /** Set up the viewer camera for this frame and return the part of the canvas it draws into (CSS pixels from the top left). */
  private frameView(): ViewRect {
    const camera = this.camera, width = Math.max(1, this.width), height = Math.max(1, this.height);
    const node = this.look ? findCamera(this.shown?.map ?? this.props.map, this.look.id) : null;
    if (node) {
      // Looking through a placed camera: its pose, its frame shape, and the vertical angle that matches its horizontal one.
      const pose = nodeWorldPose(node), rawAspect = cameraAspect(node), aspect = Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : MAP_SPATIAL_DEFAULTS.aspect;
      const horizontal = Math.min(170, Math.max(1, Number.isFinite(node.fov) ? node.fov : 60));
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
      camera.fov = Math.min(175, Math.max(1, verticalFov(horizontal, aspect)));
      camera.aspect = aspect; camera.near = 1; camera.far = Math.max(20000, this.radius * 8);
      camera.updateProjectionMatrix();
      const frameWidth = Math.min(width, height * aspect), frameHeight = frameWidth / aspect;
      return { x: (width - frameWidth) / 2, y: (height - frameHeight) / 2, width: frameWidth, height: frameHeight };
    }
    const distance = camera.position.distanceTo(this.orbit.target);
    camera.fov = MAP3D_VIEW_FOV; camera.aspect = width / height;
    camera.near = Math.min(50, Math.max(0.5, distance / 400)); camera.far = Math.max(20000, distance * 12, this.radius * 8);
    camera.updateProjectionMatrix();
    return { x: 0, y: 0, width, height };
  }
  private resize(): void {
    if (this.disposed) return;
    const width = Math.floor(this.host.clientWidth), height = Math.floor(this.host.clientHeight), ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (ratio !== this.ratio) this.watchRatio();
    if (width === this.width && height === this.height && ratio === this.ratio) return;
    this.width = width; this.height = height; this.ratio = ratio;
    if (width === 0 || height === 0) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.gizmo.setViewportHeight(height);
    if (this.fitPending) {
      this.fitPending = false;
      this.setView(fitMapView(this.props.map, width / height));
      this.autoFit = this.look ? null : this.currentView();
    } else if (this.autoFit && !this.look && !this.gizmo.dragging && this.mapId !== null && sameView(this.currentView(), this.autoFit)) {
      // Still the fitted view: keep the whole map in sight when the pane changes shape (small window, folded panel).
      this.applyView(fitMapView(this.props.map, width / height));
      this.autoFit = this.currentView();
    }
    // Resizing clears the canvas, so draw in the same turn instead of leaving one blank frame.
    if (this.mapId !== null) this.draw();
  }
  private watchRatio(): void {
    this.ratioQuery?.removeEventListener('change', this.onRatioChange);
    this.ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.ratioQuery.addEventListener('change', this.onRatioChange);
  }
  private readonly onRatioChange = (): void => { this.resize(); };
  private refreshPalette(): void {
    if (this.disposed) return;
    const palette = readPalette(this.host);
    if (sameMap3DPalette(palette, this.palette)) return;
    this.palette = palette;
    this.scene3d.setPalette(palette);
    this.requestRender();
  }

  private syncScene(map: BackgroundMap): void {
    const selectedId = this.props.selectedId, holdId = this.gizmo.draggedId, hiddenId = this.look?.id ?? null, shown = this.shown;
    if (shown && shown.map === map && shown.selectedId === selectedId && shown.holdId === holdId && shown.hiddenId === hiddenId) return;
    this.scene3d.sync(map, selectedId, { holdId, hiddenId });
    this.shown = { map, selectedId, holdId, hiddenId };
  }
  /** A gizmo is offered only for an unlocked selection, while editing, with the select tool, outside look-through and placing. */
  private gizmoAllowed(props: Map3DProps, id: string | null): boolean {
    if (!id || props.selectedId !== id || !props.canEdit || props.tool !== 'select' || props.placing || props.lookThroughId !== null) return false;
    const node = props.map.nodes.find(item => item.id === id);
    return !!node && !node.locked && mapGizmoSetup(node.type, props.gizmoMode) !== null;
  }
  private applyGizmo(): void {
    const props = this.props, id = props.selectedId;
    const node = id ? props.map.nodes.find(item => item.id === id) : undefined, root = id ? this.scene3d.root(id) : null;
    this.gizmo.setTarget(node && root && this.gizmoAllowed(props, id) ? { id: node.id, type: node.type, root } : null, props.gizmoMode);
  }
  /** `select`: the left button belongs to picking and the gizmo. `look`: the left button turns the world. */
  private applyOrbit(): void {
    const orbit = this.orbit, looking = this.props.tool === 'look';
    orbit.enabled = !this.look && !this.gizmo.dragging;
    orbit.mouseButtons = looking ? { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN } : { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
    orbit.touches = looking ? { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN } : { ONE: null, TWO: TOUCH.DOLLY_PAN };
  }

  private currentView(): Map3DViewState {
    return { target: [this.orbit.target.x, this.orbit.target.y, this.orbit.target.z], position: [this.camera.position.x, this.camera.position.y, this.camera.position.z] };
  }
  private applyView(view: Map3DViewState): void {
    this.orbit.target.set(view.target[0], view.target[1], view.target[2]);
    this.camera.position.set(view.position[0], view.position[1], view.position[2]);
    this.orbit.maxDistance = Math.max(this.orbit.maxDistance, this.camera.position.distanceTo(this.orbit.target) * 4);
    this.orbit.update();
    this.requestRender();
  }
  /** View for a newly opened map. While looking through a camera it becomes the view to return to. */
  private setView(view: Map3DViewState): void {
    if (this.look) { this.look.saved = view; return; }
    this.applyView(view);
    this.reported = this.currentView();
  }
  private openView(initial: Map3DViewState | null): void {
    const view = validView(initial);
    this.fitPending = false;
    this.autoFit = null;
    if (view) this.setView(view);
    else if (this.width > 0 && this.height > 0) { this.setView(fitMapView(this.props.map, this.width / this.height)); this.autoFit = this.look ? null : this.currentView(); }
    else this.fitPending = true;
  }
  private reportView(): void {
    if (this.disposed || this.look) return;
    const view = this.currentView();
    if (this.reported && sameView(view, this.reported)) return;
    this.reported = view;
    this.props.onViewChange(view);
  }
  private readonly onOrbitEnd = (): void => { this.reportView(); };
  /** Bring a node into view by moving the orbit target to it; the viewing offset stays. */
  private focus(id: string): void {
    const root = this.scene3d.root(id);
    this.pendingFocus = root ? null : id;
    if (!root || this.look || !this.width || !this.height) return;
    this.frameView();
    this.camera.updateMatrixWorld();
    const projected = root.position.clone().project(this.camera);
    if (Math.abs(projected.x) <= 0.9 && Math.abs(projected.y) <= 0.9 && projected.z > -1 && projected.z < 1) return;
    const shift = root.position.clone().sub(this.orbit.target);
    this.orbit.target.add(shift);
    this.camera.position.add(shift);
    this.orbit.update();
    this.requestRender();
    this.reportView();
  }

  private aim(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !this.width || !this.height) return false;
    this.frameView();
    this.camera.updateMatrixWorld();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }
  private cast(clientX: number, clientY: number): MapPickHit[] {
    if (!this.aim(clientX, clientY)) return [];
    this.scene3d.scene.updateMatrixWorld();
    return this.raycaster.intersectObjects(this.scene3d.pickTargets(), false);
  }
  /**
   * Plan point under the pointer: on the floor of a space when one is there, whatever its level, otherwise on the
   * ground (y = 0). Null when the pointer is over neither.
   */
  private floorPoint(clientX: number, clientY: number): BackgroundPoint | null {
    const floor = pickMapFloor(this.cast(clientX, clientY), this.props.map)?.point;
    if (!floor && (!this.aim(clientX, clientY) || !this.raycaster.ray.intersectPlane(this.floorPlane, this.hit))) return null;
    const { x, z } = floor ?? this.hit;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > PLAN_LIMIT || Math.abs(z) > PLAN_LIMIT) return null;
    return { x: Math.round(x * 100) / 100, y: Math.round(z * 100) / 100 };
  }
  private nodeScreenPoint(id: string): BackgroundPoint | null {
    const root = this.scene3d.root(id), rect = this.canvas.getBoundingClientRect();
    if (!root || !this.width || !this.height) return null;
    const view = this.frameView();
    this.camera.updateMatrixWorld();
    const projected = root.position.clone().project(this.camera);
    return { x: rect.left + view.x + (projected.x + 1) / 2 * view.width, y: rect.top + view.y + (1 - projected.y) / 2 * view.height };
  }

  private click(clientX: number, clientY: number, repeat: boolean): void {
    const props = this.props;
    // Only a pick with the select tool is remembered. After any other click a double click falls back to what is under the pointer.
    if (this.look || props.placing || props.tool !== 'select') { this.aimed = null; this.turn = null; }
    // The camera preview is for looking only.
    if (this.look) return;
    if (props.placing) {
      const point = this.floorPoint(clientX, clientY);
      if (point) props.onPlace(point);
      else this.onNotice('바닥이 보이는 곳을 클릭해 주세요.');
      return;
    }
    if (props.tool !== 'select') return;
    this.pick(clientX, clientY, repeat, false);
  }
  /** A press on a handle that never moved. The handles cover the selected item, so there only a step on from it is taken. */
  private clickHandle(clientX: number, clientY: number, repeat: boolean): void { this.pick(clientX, clientY, repeat, true); }
  private pick(clientX: number, clientY: number, repeat: boolean, onHandle: boolean): void {
    const props = this.props, selectedId = props.selectedId, hits = this.cast(clientX, clientY);
    // A handle press counts only while the selected item is under the pointer (as before).
    if (onHandle && !(selectedId && hits.some(hit => hit.object.userData.nodeId === selectedId))) { this.aimed = null; return; }
    const top = pickMapNode(hits, props.map);
    // The same spot again: the last pick landed on this same top node, and what it left selected is still the selection.
    const again = top !== null && this.turn?.hitId === top && this.turn.pickedId === selectedId;
    if (!repeat) this.aimed = mapClickAim(props.map, selectedId, hits, again);
    // The second click of a double click that opens a space steps nowhere.
    else if (this.opens(this.doubleClickNode(hits))) return;
    // A repeated click never steps through spaces, whether or not the double click does anything: with `again` and
    // `repeat` the selected space stays (resolveMapClick). Cameras and symbols step on every click, as before.
    const next = resolveMapClick(props.map, selectedId, hits, again, repeat);
    if (onHandle) {
      // Never a fresh pick from a handle: only the next of the pile the selected item is in.
      const selected = props.map.nodes.find(node => node.id === selectedId);
      const pile = !selected ? [] : selected.type !== 'space' ? stackedMapNodeIds(props.map, selected.id) : again ? mapFloorPile(hits, props.map) : [];
      if (!selected || next === null || next === selected.id || !pile.includes(selected.id) || !pile.includes(next)) return;
    }
    this.turn = top === null ? null : { hitId: top, pickedId: next };     // before onSelect: the props that come back must find it
    props.onSelect(next);
  }
  /** Whether a double click on this node enters a detail map: a space with one. */
  private opens(id: string | null): boolean {
    return id !== null && this.props.map.nodes.some(node => node.id === id && node.type === 'space' && !!node.childMapId);
  }
  /** The node a double click here is about: what its first click was aimed at while that is a linked space still under the pointer, else what is on top. */
  private doubleClickNode(hits: MapPickHit[]): string | null {
    const aimed = this.aimed;
    return aimed !== null && this.opens(aimed) && hits.some(hit => hit.object.userData.nodeId === aimed) ? aimed : pickMapNode(hits, this.props.map);
  }
  /** A press anywhere but on the canvas (the bar over it, the companion plan, the inspector, the object list, the toolbar, a dialog): the same spot is pressed anew after it. */
  private readonly onPressElsewhere = (event: PointerEvent): void => { if (event.target !== this.canvas) this.turn = null; };
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.host.focus({ preventScroll: true });
    // TransformControls has already seen this press, so its hover state tells whether a handle is under the pointer.
    this.press = event.isPrimary && event.button === 0
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, gizmo: this.gizmo.hovering || this.gizmo.dragging, repeat: false } : null;
    // Any other button (the right one turns the world, the wheel button pans it) and any other pointer picks nothing.
    if (!this.press) this.turn = null;
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (travel >= CLICK_SLOP) press.moved = true;
    // This runs before the move handler of the controls for the same event, so a drag counts from the first move past the slop.
    this.gizmo.pointerTravel(travel);
    // Letting go of the left button while another one is still down arrives as a move, not as a release.
    if (this.gizmo.dragging && (event.buttons & 1) === 0) {
      this.press = null;
      this.lastDragAt = performance.now();
      this.gizmo.release();
    }
  };
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId || event.button !== 0) return;
    this.press = null;
    if (press.moved || Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_SLOP) {
      this.lastDragAt = performance.now();
      // A left drag that was no gizmo drag turned the world (the look tool) or did nothing at all: it picked nothing.
      // A gizmo drag keeps the memory, like a move on the plan.
      if (!press.gizmo) this.turn = null;
      return;
    }
    if (press.gizmo) this.clickHandle(event.clientX, event.clientY, press.repeat);
    else this.click(event.clientX, event.clientY, press.repeat);
  };
  private readonly onPointerCancel = (): void => { this.press = null; this.turn = null; };
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const props = this.props;
    if (event.button !== 0 || this.look || props.placing || this.gizmo.dragging || performance.now() - this.lastDragAt < DOUBLE_CLICK_GUARD) return;
    // The first click may have put the gizmo under the pointer; opening a space still works there.
    const id = this.doubleClickNode(this.cast(event.clientX, event.clientY));
    if (id && props.map.nodes.some(node => node.id === id && node.type === 'space')) props.onOpenSpace(id);
  };
  private readonly onContextMenu = (event: Event): void => { event.preventDefault(); };
  private readonly onMouseDown = (event: MouseEvent): void => {
    // No browser auto-scroll on a middle-button drag: that button pans the view.
    if (event.button === 1) event.preventDefault();
    // A release carries no click count; the mousedown of the same press does.
    if (event.button === 0 && this.press) this.press.repeat = event.detail >= 2;
  };
  private readonly onDragKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.gizmo.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    this.gizmo.cancel();
  };
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed || this.lost) return;
    this.lost = true;
    this.gizmo.cancel();
    this.props.onUnavailable(UNAVAILABLE_LOST);
  };
}

/**
 * Why the selected item shows no handles. General how-to hints belong to the editor's own hint line,
 * so this stays empty unless the viewport has something of its own to explain.
 */
function hintFor({ map, selectedId, canEdit, tool, gizmoMode, placing }: Map3DProps): string {
  if (!canEdit || tool !== 'select' || placing) return '';
  const selected = selectedId ? map.nodes.find(node => node.id === selectedId) : undefined;
  if (!selected) return '';
  if (selected.locked) return '잠긴 항목은 옮길 수 없어요 · 잠금을 풀면 손잡이가 나와요';
  if (!mapGizmoSetup(selected.type, gizmoMode)) return '카메라에는 크기가 없어요 · 이동이나 회전을 골라 주세요';
  return '';
}

export default function BackgroundMap3D(props: Map3DProps) {
  const { map, tool, placing, lookThroughId, onLookThroughChange } = props;
  const hostRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Map3DViewport | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [notice, setNotice] = useState('');

  useLayoutEffect(() => {
    const host = hostRef.current, stage = stageRef.current;
    if (!host || !stage) return;
    let viewport: Map3DViewport | null = null, failure = 0;
    try {
      viewport = new Map3DViewport(host, stage, latest.current, setNotice);
    } catch {
      // Deferred, and dropped by the cleanup below, so a development double mount still reports once.
      failure = window.setTimeout(() => latest.current.onUnavailable(UNAVAILABLE_AT_START), 0);
    }
    viewportRef.current = viewport;
    return () => {
      window.clearTimeout(failure);
      viewportRef.current = null;
      viewport?.dispose();
    };
  }, []);
  useLayoutEffect(() => { viewportRef.current?.update(props); });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const lookNode = findCamera(map, lookThroughId);
  const className = `bmap-3d${tool === 'look' ? ' is-look' : ''}${placing ? ' is-placing' : ''}${lookNode ? ' is-looking' : ''}`;
  return <div ref={hostRef} className={className} role="application" aria-label={`${map.name} 3D 도면`} tabIndex={0}>
    <div ref={stageRef} className="bmap-3d-stage" />
    <div className="bmap-3d-bar">
      {lookNode
        ? <p className="bmap-3d-hint bmap-3d-look" role="status" aria-live="polite"><strong>카메라 시점 미리보기</strong><span>{lookNode.name}</span></p>
        : <p className="bmap-3d-hint" role="status" aria-live="polite">{notice || hintFor(props)}</p>}
      {lookNode
        ? <button type="button" className="bmap-3d-return" onClick={() => onLookThroughChange(null)}>둘러보기로 돌아가기</button>
        : <div className="bmap-3d-controls" role="group" aria-label="3D 보기 조절">
          <button type="button" aria-label="축소" title="축소" onClick={() => viewportRef.current?.zoom(1.25)}>−</button>
          <button type="button" aria-label="확대" title="확대" onClick={() => viewportRef.current?.zoom(0.8)}>＋</button>
          <button type="button" aria-label="맞춤" title="도면 전체가 보이게 맞춤" onClick={() => viewportRef.current?.fit()}>맞춤</button>
          <button type="button" aria-label="위에서 보기" title="평면 도면처럼 위에서 내려다보기" onClick={() => viewportRef.current?.topDown()}>위에서 보기</button>
        </div>}
    </div>
  </div>;
}
