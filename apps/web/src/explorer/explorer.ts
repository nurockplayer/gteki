import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ASSET_SCHEME, fencedUrlResolver, stationDir } from "./assetFence.ts";
import { enuToRenderer } from "@gteki/geo";
import type { Router, PolylinePoint } from "@gteki/navigation";
import { nodeDisplayZ } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { WALKER_BODY } from "@gteki/scene-api";
import type { LoadedStation } from "../registry.ts";
import { R, chevronTexture, ribbonGeometry } from "./geometry.ts";
import { manifestScene } from "./manifestScene.ts";
import { castAll, castTargets } from "./raycast.ts";
import { advanceGuide } from "./guideStops.ts";
import { PostFx } from "./postfx.ts";
import { FOLLOW, clampDistance, followPose } from "./followCamera.ts";
import { OverviewLook } from "./overviewLook.ts";
import { STREET, StreetBackdrop, isOutdoors } from "./streetBackdrop.ts";
import { createAvatar, type AvatarRig } from "./avatar.ts";
import { avatarMotion } from "./avatarMotion.ts";
import { contactShadow } from "./contactShadow.ts";
import { buildGraphView, type GraphView } from "./graphView.ts";
import { Input } from "./input.ts";
import { DEFAULT_GROUND, acceptGround, angleDelta, cumulativeLengths, resolveWalls, samplePolyline, wallToRenderer, type Segment2 } from "./walker.ts";

export type ExplorerMode = "overview" | "walk" | "guide";

export interface ExplorerEvents {
  onMode?(mode: ExplorerMode): void;
  onGuideProgress?(p: { s: number; total: number; stepIndex: number; done: boolean }): void;
  /** The guide stopped (and paused) at `stops[index]` given to startGuide. */
  onGuideStop?(index: number): void;
  onPoiClick?(poiId: string): void;
}

const EYE = WALKER_BODY.eyeM;
const RADIUS = WALKER_BODY.radiusM;
const WALK = 1.45;
const RUN = 3.4;
const GUIDE_SPEED = 1.6;

export class Explorer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
  private readonly labels = new CSS2DRenderer();
  private readonly orbit: OrbitControls;
  private composer: PostFx | null = null;
  private readonly overviewLook = new OverviewLook();
  private readonly street = new StreetBackdrop();
  /** Render height of the station's street floor when it is an underground (scene-lit) station, else null. */
  private streetY: number | null = null;
  private readonly timer = new THREE.Timer();
  private readonly input: Input;
  private readonly ray = new THREE.Raycaster();

  private station: LoadedStation | null = null;
  private stationScene: StationScene | null = null;
  private graph: GraphView | null = null;
  private readonly world = new THREE.Group();
  private readonly overlays = new THREE.Group();
  private readonly routeGroup = new THREE.Group();
  private readonly poiGroup = new THREE.Group();
  private walkable: THREE.Object3D[] = [];
  /** Meshes actually ray-tested for ground, walls and the follow camera (see castTargets). */
  private groundTargets: THREE.Object3D[] = [];
  private colliderTargets: THREE.Object3D[] = [];
  private cameraTargets: THREE.Object3D[] = [];
  private colliders: THREE.Object3D[] = [];
  private walls: Segment2[] = [];
  private routeTexture: THREE.CanvasTexture | null = null;

  private readonly avatar = new THREE.Group();
  private avatarRig: AvatarRig | null = null;
  /** Where the body faces (it turns toward travel; the camera keeps `yaw`). */
  private bodyYaw = 0;
  private readonly lastAvatarPos = new THREE.Vector3();
  /** Core hemisphere + sun; hidden when a scene declares `environment.lighting: "scene"`. */
  private readonly coreLights: THREE.Light[] = [];
  /** Image-based light applied only to core-owned materials (avatar) when the scene owns lighting. */
  private coreEnvMap: THREE.Texture | null = null;
  private lighting: "default" | "scene" = "default";
  /** Host-owned WebAudio for station scenes; created lazily, resumed on the first user gesture. */
  private audio: { context: AudioContext; master: GainNode } | null = null;
  /**
   * Per-load bus between a station scene and the master gain. Cancelling or clearing a station
   * disconnects its bus at once, so a superseded (even still-building) scene can never stay audible.
   */
  private stationAudio: GainNode | null = null;
  private audioUnlock: (() => void) | null = null;
  private muted = readMuted();
  private readonly pos = new THREE.Vector3();
  private yaw = 0; // radians; 0 = facing north (-Z)
  private pitch = -0.12;
  private camDistance: number = FOLLOW.defaultDistance;
  private firstPerson = false;
  private mode: ExplorerMode = "overview";
  private guide: { pts: THREE.Vector3[]; cum: number[]; steps: number[]; s: number; paused: boolean; speed: number; stops: { s: number; index: number }[]; holding: boolean } | null = null;
  private quality: "low" | "high";
  /** Why the station's own scene could not be shown (L0 fallback is in use), if any. */
  sceneError: string | null = null;
  private disposed = false;

  constructor(private readonly host: HTMLElement, private readonly events: ExplorerEvents = {}) {
    this.quality = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700 ? "low" : "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === "high" ? 2 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality === "high";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add("gteki-canvas");
    this.labels.domElement.classList.add("gteki-labels");
    host.appendChild(this.labels.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.screenSpacePanning = false;

    this.input = new Input(this.renderer.domElement, host);
    this.scene.add(this.world, this.overlays, this.avatar, this.street.group);
    this.overlays.add(this.routeGroup, this.poiGroup);
    this.buildAvatar();
    this.defaultEnvironment();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get currentMode(): ExplorerMode {
    return this.mode;
  }

  get qualityLevel(): "low" | "high" {
    return this.quality;
  }

  /** Bounding boxes (renderer frame) for automated visual sanity checks. */
  sceneInfo(): { world: number[]; route: number[]; routeChildren: number; walkable: number; colliders: number; camera: number[]; mode: ExplorerMode; lighting: "default" | "scene"; coreLightsOn: number } {
    const box = (o: THREE.Object3D) => { const b = new THREE.Box3().setFromObject(o); return b.isEmpty() ? [] : [...b.min.toArray(), ...b.max.toArray()].map((v) => Math.round(v * 10) / 10); };
    return {
      world: box(this.world), route: box(this.routeGroup), routeChildren: this.routeGroup.children.length,
      walkable: this.walkable.length, colliders: this.colliders.length,
      camera: this.camera.position.toArray().map((v) => Math.round(v * 10) / 10), mode: this.mode,
      lighting: this.lighting, coreLightsOn: this.coreLights.filter((l) => l.visible).length,
    };
  }

  /** Avatar position in station ENU (a virtual position, never the user's real location). */
  get avatarEnu(): { x: number; y: number; z: number } {
    return { x: this.pos.x, y: -this.pos.z, z: this.pos.y };
  }

  private defaultEnvironment(): void {
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 60, 420);
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a1e26, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 120, 60);
    sun.castShadow = this.quality === "high";
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, far: 400 });
    this.scene.add(hemi, sun);
    this.coreLights.push(hemi, sun);
  }

  /**
   * "scene": the station's baked/own lights are the only scene lights (no double lighting of lightmaps).
   * Three.js lights cannot be masked per object, so the avatar keeps a per-material environment map
   * instead (scene.environment stays unset, so station materials are unaffected).
   */
  private applyLighting(mode: "default" | "scene"): void {
    this.lighting = mode;
    for (const l of this.coreLights) l.visible = mode === "default";
    if (mode === "scene" && !this.coreEnvMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.coreEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.avatar.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.MeshStandardMaterial) { m.envMap = mode === "scene" ? this.coreEnvMap : null; m.needsUpdate = true; }
    });
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
  }

  /** Built once: the composer only references this explorer's scene and camera, so stations reuse it. */
  private setupComposer(): void {
    if (this.composer || this.quality !== "high") return;
    this.composer = new PostFx(this.renderer, this.scene, this.camera);
  }

  private buildAvatar(): void {
    this.avatarRig = createAvatar({ quality: this.quality });
    // A slim marker ring keeps "this is you" readable without outshining the character.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.5, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5ef0ff, transparent: true, opacity: 0.38, depthWrite: false }));
    ring.position.y = 0.02;
    this.avatar.add(this.avatarRig.root, contactShadow(0.42), ring);
    this.avatar.visible = false;
  }

  /** Loading phase, exposed for diagnosing stalled station scenes. */
  phase = "idle";

  private loadGeneration = 0;

  /**
   * Abandon any in-flight load and show nothing: called as soon as another station is selected, so a
   * slow previous station can never appear under the new selection (even if the new one fails to load).
   */
  cancelPendingLoad(): void {
    this.loadGeneration++;
    this.clearStation();
    this.station = null;
    this.phase = "idle";
  }

  /** Resolves false when a later loadStation call superseded this one (its scene is disposed, nothing shown). */
  async loadStation(station: LoadedStation, router: Router): Promise<boolean> {
    const generation = ++this.loadGeneration;
    this.phase = "graph";
    this.clearStation();
    this.station = station;
    const bundle = station.bundle;
    this.graph = buildGraphView(bundle, router);
    // One loading manager per station: every request (GLB, its external buffers/images, textures)
    // must resolve through this station's fenced asset map.
    const refused: string[] = [];
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(fencedUrlResolver(station.assetUrls, refused));
    const fenceError = (err: unknown) => refused.length ? new Error(`blocked asset request outside station folder: ${refused.join(", ")}`) : err;
    const audioBus = this.ensureAudio() ? this.newStationAudioBus() : null;
    const ctx: SceneContext = {
      THREE,
      bundle,
      enuToRenderer: (p) => enuToRenderer(p),
      assetUrl: (uri) => station.assetUrls.get(uri) ?? null,
      loadGlb: (uri) => {
        const url = station.assetUrls.get(uri);
        if (!url) return Promise.reject(new Error(`asset not found in station folder: ${uri}`));
        const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).setResourcePath(`${ASSET_SCHEME}${stationDir(uri)}/`);
        return loader.loadAsync(url).catch((err: unknown) => { throw fenceError(err); });
      },
      loadTexture: async (uri, opts = {}) => {
        const url = station.assetUrls.get(uri);
        if (!url) throw new Error(`asset not found in station folder: ${uri}`);
        const tex = await new THREE.TextureLoader(manager).loadAsync(url);
        tex.colorSpace = opts.colorSpace === "linear" ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
        tex.flipY = opts.flipY ?? true;
        tex.needsUpdate = true;
        return tex;
      },
      quality: this.quality,
      renderer: this.renderer,
      ...(audioBus ? { audio: { context: this.audio!.context, destination: audioBus } } : {}),
    };

    this.sceneError = null;
    this.phase = "scene";
    let built: StationScene | null = null;
    let sceneError: string | null = null;
    try {
      built = await this.buildStationScene(station, ctx);
    } catch (err) {
      // A broken visual scene never hides valid routing data: fall back to the L0 graph view.
      console.warn("[gteki] station scene failed; using L0 graph view", err);
      sceneError = err instanceof Error ? err.message : String(err);
      // A failed build returns no disposer, so silence anything it already connected.
      if (audioBus) { audioBus.disconnect(); if (this.stationAudio === audioBus) this.stationAudio = null; }
    }
    if (generation !== this.loadGeneration || this.disposed) {
      built?.dispose();
      return false;
    }
    this.stationScene = built;
    this.sceneError = sceneError;

    // Overview may have been entered while loading (against an empty world): restore first, so the new
    // scene's fog and materials are the ones saved, then re-apply once the scene is attached.
    this.overviewLook.set(this.scene, this.world, false);
    this.street.restore(this.scene);
    if (this.stationScene) {
      this.world.add(this.stationScene.root);
      this.overlays.add(this.graph.overlay);
      this.graph.overlay.visible = false;
      this.walkable = this.stationScene.walkable;
      this.colliders = this.stationScene.colliders ?? [];
      this.walls = (this.stationScene.walls ?? []).map(wallToRenderer);
      const env = this.stationScene.environment;
      if (env?.background !== undefined) this.scene.background = new THREE.Color(env.background);
      if (env?.fog) this.scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
      if (env?.exposure !== undefined) this.renderer.toneMappingExposure = env.exposure;
      this.applyLighting(env?.lighting === "scene" ? "scene" : "default");
      const streets = station.bundle.floors.filter((f) => f.ordinal === 0 && !f.intermediate);
      this.streetY = env?.lighting === "scene" && streets.length ? Math.max(...streets.map((f) => f.renderElevationM)) : null;
      this.stationScene.root.updateMatrixWorld(true);
    } else {
      this.world.add(this.graph.root);
      this.walkable = this.graph.walkable;
    }
    this.world.updateMatrixWorld(true);
    this.groundTargets = castTargets(this.walkable, this.colliders);
    this.colliderTargets = castTargets(this.colliders, this.walkable);
    this.cameraTargets = [...new Set([...this.colliderTargets, ...this.groundTargets])];
    this.phase = "composer";
    this.setupComposer();
    this.frameAll();
    this.overviewLook.set(this.scene, this.world, this.mode === "overview");
    this.phase = "ready";
    return true;
  }

  private async buildStationScene(station: LoadedStation, ctx: SceneContext): Promise<StationScene | null> {
    if (station.sceneImportError) throw new Error(`scene module failed to load: ${station.sceneImportError}`);
    if (station.scene) return await station.scene.buildScene(ctx);
    const assets = station.bundle.assets ?? [];
    if (assets.length === 0) return null;
    // No scene module: load manifest GLBs and classify by gteki_role.
    return await manifestScene(assets, ctx);
  }

  private clearStation(): void {
    this.street.restore(this.scene);
    this.streetY = null;
    this.overviewLook.set(this.scene, this.world, false);
    this.disconnectStationAudio();
    this.stopGuide();
    this.clearRoute();
    this.clearPois();
    if (this.stationScene) { this.world.remove(this.stationScene.root); this.stationScene.dispose(); this.stationScene = null; }
    if (this.graph) { this.world.remove(this.graph.root); this.overlays.remove(this.graph.overlay); this.graph.dispose(); this.graph = null; }
    this.walkable = [];
    this.colliders = [];
    this.groundTargets = [];
    this.colliderTargets = [];
    this.cameraTargets = [];
    this.walls = [];
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 60, 420);
    this.renderer.toneMappingExposure = 1;
    this.applyLighting("default");
  }

  setGraphOverlay(visible: boolean): void {
    if (this.graph && this.stationScene) this.graph.overlay.visible = visible;
  }

  /** Frame the whole station (or a box) from above in overview mode. */
  frameAll(box?: THREE.Box3): void {
    const b = box ?? new THREE.Box3().setFromObject(this.world);
    if (b.isEmpty()) b.set(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(50, 10, 50));
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = Math.max(20, Math.hypot(size.x, size.z) * 0.62);
    this.setMode("overview");
    this.orbit.target.copy(center);
    this.camera.position.set(center.x + radius * 0.55, center.y + radius * 0.85, center.z + radius * 0.75);
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  setMode(mode: ExplorerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.orbit.enabled = mode === "overview";
    this.avatar.visible = mode !== "overview" && !this.firstPerson;
    this.input.enabled = mode !== "overview";
    if (mode === "overview") this.orbit.target.copy(this.pos);
    const xray = this.routeGroup.getObjectByName("route-xray");
    if (xray) xray.visible = mode === "overview";
    if (mode === "overview") this.street.restore(this.scene);
    this.overviewLook.set(this.scene, this.world, mode === "overview");
    this.events.onMode?.(mode);
  }

  toggleFirstPerson(): boolean {
    this.firstPerson = !this.firstPerson;
    this.avatar.visible = this.mode !== "overview" && !this.firstPerson;
    return this.firstPerson;
  }

  /** Start free walking at a station ENU point (nearest walkable ground below/above it). */
  walkFrom(enu: { x: number; y: number; z: number }, headingDeg = 0): boolean {
    const p = R(enu.x, enu.y, enu.z);
    const ground = this.groundAt(p.x, p.y + 1.5, p.z, 4);
    if (ground === null) return false;
    this.pos.set(p.x, ground, p.z);
    this.yaw = (-headingDeg * Math.PI) / 180;
    this.stopGuide();
    this.setMode("walk");
    return true;
  }

  walkFromNode(bundle: StationBundle, nodeId: string): boolean {
    const n = bundle.nodes.find((x) => x.id === nodeId);
    if (!n) return false;
    const z = nodeDisplayZ(n, bundle.floors.find((f) => f.id === n.floorId)).z;
    return this.walkFrom({ x: n.position.x, y: n.position.y, z });
  }

  private groundAt(x: number, fromY: number, z: number, maxDrop: number): number | null {
    if (this.walkable.length === 0) return null;
    this.ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = maxDrop;
    const hit = castAll(this.ray, this.groundTargets)[0];
    return hit ? hit.point.y : null;
  }

  private blockedByColliders(from: THREE.Vector3, to: THREE.Vector3): boolean {
    if (this.colliders.length === 0) return false;
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-6) return false;
    dir.divideScalar(len);
    for (const h of [0.5, 1.2]) {
      this.ray.set(from.clone().add(new THREE.Vector3(0, h, 0)), dir);
      this.ray.far = len + RADIUS;
      if (castAll(this.ray, this.colliderTargets).length > 0) return true;
    }
    return false;
  }

  // ---- Routes & POIs -------------------------------------------------------------

  showRoute(polyline: PolylinePoint[]): void {
    this.clearRoute();
    const pts = polyline.map((p) => R(p.x, p.y, p.z));
    if (pts.length < 2) return;
    this.routeTexture = chevronTexture();
    this.routeTexture.repeat.set(1 / 1.8, 1);
    const mat = new THREE.MeshBasicMaterial({ map: this.routeTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const ribbon = new THREE.Mesh(ribbonGeometry(pts, 1.1, 0.07), mat);
    ribbon.renderOrder = 5;
    const glowMat = new THREE.LineBasicMaterial({ color: 0x5ef0ff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    const glow = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.12, 0)))), glowMat);
    glow.renderOrder = 6;
    // Symbolic (unknown) heights are drawn dashed above the ribbon so they read as approximate.
    const symbolic = polyline.some((p) => !p.zKnown);
    // X-ray copy so the route stays readable through ceilings/slabs in overview.
    const xrayMat = new THREE.MeshBasicMaterial({ map: this.routeTexture, color: 0xb8f8ff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const xray = new THREE.Mesh(ribbon.geometry, xrayMat);
    xray.renderOrder = 20;
    xray.name = "route-xray";
    xray.visible = this.mode === "overview";
    this.routeGroup.add(ribbon, glow, xray);
    this.routeGroup.add(this.beacon(pts[0]!, 0x7dffa0, 2.2), this.beacon(pts[pts.length - 1]!, 0xffc857, 5));
    this.routeGroup.userData = { symbolicHeights: symbolic };
  }

  private beacon(at: THREE.Vector3, color: number, height: number): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, height, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.FrontSide, toneMapped: false }));
    col.position.y = height / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false }));
    ring.position.y = 0.08;
    g.add(col, ring);
    g.position.copy(at);
    g.userData.pulse = ring;
    return g;
  }

  /** Removing the route also ends any guidance along it: a recomputed or failed route never keeps the old guide. */
  clearRoute(): void {
    this.stopGuide();
    for (const child of [...this.routeGroup.children]) {
      this.routeGroup.remove(child);
      child.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); const m = (o as THREE.Mesh).material; if (m && !Array.isArray(m)) m.dispose(); });
    }
    this.routeTexture?.dispose();
    this.routeTexture = null;
  }

  /** Floating labels at each POI's verified entrance (or display position when search-only). */
  showPois(bundle: StationBundle, label: (poi: Poi) => string, selected: string[] = []): void {
    this.clearPois();
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const floors = new Map(bundle.floors.map((f) => [f.id, f]));
    for (const poi of bundle.pois) {
      const node = poi.connectorNodeIds.map((id) => nodes.get(id)).find(Boolean);
      let at: THREE.Vector3 | null = null;
      if (node) at = R(node.position.x, node.position.y, nodeDisplayZ(node, floors.get(node.floorId)).z);
      else if (poi.displayPosition) at = R(poi.displayPosition.x, poi.displayPosition.y, poi.displayPosition.z ?? floors.get(poi.floorId ?? "")?.renderElevationM ?? 0);
      if (!at) continue;
      const el = document.createElement("button");
      el.className = `poi-label cat-${poi.category}${selected.includes(poi.id) ? " selected" : ""}${node ? "" : " search-only"}`;
      el.textContent = label(poi);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); this.events.onPoiClick?.(poi.id); });
      const obj = new CSS2DObject(el);
      obj.position.copy(at).add(new THREE.Vector3(0, 2.4, 0));
      this.poiGroup.add(obj);
    }
  }

  clearPois(): void {
    for (const c of [...this.poiGroup.children]) { this.poiGroup.remove(c); (c as CSS2DObject).element?.remove(); }
  }

  // ---- Guide ---------------------------------------------------------------------

  /**
   * Walk the polyline. `stopAtPoints` are polyline point indices where the guide must stop and pause (waits
   * for opening hours): it never moves past one before being resumed, including several at one spot.
   */
  startGuide(polyline: PolylinePoint[], fromS = 0, stopAtPoints: readonly number[] = []): void {
    const pts = polyline.map((p) => R(p.x, p.y, p.z));
    if (pts.length < 2) return;
    const cum = cumulativeLengths(pts);
    const stops = stopAtPoints.map((point, index) => ({ s: cum[point] ?? 0, index })).filter((x) => x.s >= fromS).sort((a, b) => a.s - b.s || a.index - b.index);
    this.guide = { pts, cum, steps: polyline.map((p) => p.stepIndex), s: fromS, paused: false, speed: GUIDE_SPEED, stops, holding: false };
    const first = samplePolyline(pts, this.guide.cum, fromS);
    this.pos.set(first.x, first.y, first.z);
    if (first.tx || first.tz) this.yaw = Math.atan2(-first.tx, -first.tz);
    this.setMode("guide");
  }

  setGuidePaused(paused: boolean): void {
    if (!this.guide) return;
    this.guide.paused = paused;
    if (!paused) this.guide.holding = false;
  }

  get guidePaused(): boolean {
    return this.guide?.paused ?? false;
  }

  setGuideSpeed(multiplier: number): void {
    if (this.guide) this.guide.speed = GUIDE_SPEED * multiplier;
  }

  stopGuide(): void {
    this.guide = null;
    if (this.mode === "guide") this.setMode("walk");
  }

  /** Fly the overview camera to a polyline index range (instruction preview). */
  focusPoints(polyline: PolylinePoint[]): void {
    if (polyline.length === 0) return;
    const box = new THREE.Box3();
    for (const p of polyline) box.expandByPoint(R(p.x, p.y, p.z));
    box.expandByScalar(6);
    this.frameAll(box);
  }

  // ---- Loop ----------------------------------------------------------------------

  private resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  /**
   * Deterministic stepping for automation: hold `keys` for `seconds` at a fixed 60 Hz timestep,
   * then render once. Independent of requestAnimationFrame (works in hidden/background tabs).
   */
  simulate(seconds: number, keys: string[] = []): { x: number; y: number; z: number } {
    this.input.virtualKeys.clear();
    for (const k of keys) this.input.virtualKeys.add(k);
    const steps = Math.round(seconds * 60);
    const t0 = this.timer.getElapsed();
    for (let i = 0; i < steps; i++) this.step(1 / 60, t0 + i / 60);
    this.input.virtualKeys.clear();
    this.render(1 / 60);
    return this.avatarEnu;
  }

  private frame(): void {
    if (this.disposed) return;
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.step(dt, this.timer.getElapsed());
    this.render(dt);
  }

  private render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private step(dt: number, t: number): void {
    if (this.routeTexture) this.routeTexture.offset.x -= dt * 0.9;
    for (const g of this.routeGroup.children) {
      const ring = g.userData.pulse as THREE.Mesh | undefined;
      if (ring) ring.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
    }
    this.stationScene?.update?.(dt, t);

    if (this.mode === "walk") this.stepWalk(dt);
    else if (this.mode === "guide") this.stepGuide(dt);
    else this.orbit.update();

    if (this.mode !== "overview") {
      this.placeCamera(dt);
      this.street.update(this.scene, this.camera, this.pos, isOutdoors(this.pos.y, this.streetY, this.coveredOverhead()), dt);
    }
    const motion = avatarMotion(this.lastAvatarPos, this.pos, dt, this.bodyYaw, this.yaw);
    this.bodyYaw = motion.yaw;
    this.lastAvatarPos.copy(this.pos);
    this.avatarRig?.update(dt, this.mode === "overview" ? 0 : motion.speed);
    this.avatar.position.copy(this.pos);
    this.avatar.rotation.y = this.bodyYaw;
  }

  private stepWalk(dt: number): void {
    const look = this.input.consumeLook();
    this.yaw -= look.dx * 0.0042;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy * 0.0032, -1.1, 0.5);
    this.camDistance = THREE.MathUtils.clamp(this.camDistance + look.zoom * 0.004, 1.8, 9);
    const mv = this.input.move();
    if (mv.x === 0 && mv.y === 0) return;
    const speed = mv.run ? RUN : WALK;
    // Camera-relative: forward = -Z rotated by yaw.
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const step = speed * dt;
    const nx = this.pos.x + (fx * mv.y + rx * mv.x) * step;
    const nz = this.pos.z + (fz * mv.y + rz * mv.x) * step;
    const pushed = resolveWalls(nx, nz, RADIUS, this.pos.y, WALKER_BODY.bodyTopM, this.walls);
    const target = new THREE.Vector3(pushed.x, this.pos.y, pushed.z);
    if (this.blockedByColliders(this.pos, target)) return;
    const ground = this.groundAt(target.x, this.pos.y + DEFAULT_GROUND.stepUp + 0.05, target.z, DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + 0.1);
    if (!acceptGround(this.pos.y, ground)) return;
    this.pos.set(target.x, THREE.MathUtils.damp(this.pos.y, ground!, 18, dt), target.z);
  }

  private stepGuide(dt: number): void {
    const g = this.guide;
    if (!g) return;
    const look = this.input.consumeLook();
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy * 0.0032, -1.1, 0.5);
    const mv = this.input.move();
    if (mv.x !== 0 || mv.y !== 0) {
      // Taking the controls hands over to free walking at the current spot.
      this.guide = null;
      this.setMode("walk");
      return;
    }
    const total = g.cum[g.cum.length - 1]!;
    // Arrive at a stop, never beyond it, and wait there until resumed.
    const stopped = g.paused ? null : advanceGuide(g, g.speed * dt, total);
    if (stopped !== null) g.paused = g.holding = true;
    const p = samplePolyline(g.pts, g.cum, g.s);
    this.pos.set(p.x, p.y, p.z);
    if (p.tx || p.tz) {
      const targetYaw = Math.atan2(-p.tx, -p.tz);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, dt * 4);
    }
    this.yaw -= look.dx * 0.0042;
    const stepIndex = g.steps[Math.min(g.steps.length - 1, p.segment + 1)] ?? -1;
    this.events.onGuideProgress?.({ s: g.s, total, stepIndex, done: g.s >= total && !g.holding });
    if (stopped !== null) this.events.onGuideStop?.(stopped);
  }

  /** Anything (ceiling, slab, canopy) above the walker's head within the sky-clearance distance. */
  private coveredOverhead(): boolean {
    if (this.streetY === null || !this.cameraTargets.length) return true;
    this.ray.set(this.pos.clone().add(new THREE.Vector3(0, EYE, 0)), new THREE.Vector3(0, 1, 0));
    this.ray.far = STREET.skyClearance;
    return castAll(this.ray, this.cameraTargets).length > 0;
  }

  private placeCamera(dt: number): void {
    const head = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) {
      this.camera.position.copy(head);
      this.camera.lookAt(head.clone().add(dir));
      return;
    }
    // Over-the-shoulder framing; the pivot itself is pulled in if a wall is closer than the shoulder offset.
    let shoulder: number = FOLLOW.shoulder;
    if (this.cameraTargets.length) {
      this.ray.set(head, new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)));
      this.ray.far = FOLLOW.shoulder + 0.25;
      const side = castAll(this.ray, this.cameraTargets)[0];
      if (side) shoulder = Math.max(0, side.distance - 0.25);
    }
    const pose = followPose(head, this.yaw, this.pitch, shoulder);
    let dist = this.camDistance;
    if (this.cameraTargets.length) {
      this.ray.set(pose.pivot, pose.back);
      this.ray.far = dist + FOLLOW.clearance;
      dist = clampDistance(dist, castAll(this.ray, this.cameraTargets)[0]?.distance ?? null);
    }
    const desired = pose.pivot.clone().addScaledVector(pose.back, dist);
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(pose.target);
  }

  private ensureAudio(): boolean {
    if (this.audio) return true;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return false;
    try {
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(context.destination);
      this.audio = { context, master };
    } catch {
      return false;
    }
    // Browsers keep audio suspended until a user gesture.
    const unlock = () => {
      void this.audio?.context.resume();
      this.removeAudioUnlock();
    };
    this.audioUnlock = unlock;
    for (const type of AUDIO_UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true });
    return true;
  }

  private removeAudioUnlock(): void {
    if (!this.audioUnlock) return;
    for (const type of AUDIO_UNLOCK_EVENTS) window.removeEventListener(type, this.audioUnlock, { capture: true });
    this.audioUnlock = null;
  }

  private newStationAudioBus(): GainNode {
    this.disconnectStationAudio();
    const bus = this.audio!.context.createGain();
    bus.connect(this.audio!.master);
    this.stationAudio = bus;
    return bus;
  }

  private disconnectStationAudio(): void {
    this.stationAudio?.disconnect();
    this.stationAudio = null;
  }

  get audioMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem("gteki.muted", muted ? "1" : "0"); } catch { /* storage unavailable */ }
    if (this.audio) this.audio.master.gain.setTargetAtTime(muted ? 0 : 1, this.audio.context.currentTime, 0.05);
  }

  audioInfo(): { available: boolean; state: string | null; muted: boolean; stationBus: boolean } {
    return { available: this.audio !== null, state: this.audio?.context.state ?? null, muted: this.muted, stationBus: this.stationAudio !== null };
  }

  dispose(): void {
    this.disposed = true;
    this.removeAudioUnlock();
    this.disconnectStationAudio();
    void this.audio?.context.close();
    this.audio = null;
    this.renderer.setAnimationLoop(null);
    this.clearStation();
    this.input.dispose();
    this.disposeComposer();
    this.avatarRig?.dispose();
    this.street.dispose();
    this.avatar.traverse((o) => {
      // The rig disposed its own parts; the shadow and marker ring are explorer-owned.
      const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      if (!m.isMesh || !(m.material instanceof THREE.MeshBasicMaterial)) return;
      m.geometry.dispose();
      m.material.map?.dispose();
      m.material.dispose();
    });
    this.coreEnvMap?.dispose();
    this.renderer.dispose();
  }
}

const AUDIO_UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

function readMuted(): boolean {
  try { return localStorage.getItem("gteki.muted") === "1"; } catch { return false; }
}
