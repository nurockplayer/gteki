import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ASSET_SCHEME, fencedUrlResolver, stationDir } from "./assetFence.ts";
import { enuToRenderer } from "@gteki/geo";
import type { Router, PolylinePoint } from "@gteki/navigation";
import { DEFAULT_PROFILE, nodeDisplayZ } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { WALKER_BODY, WALKER_SPEED, glbPrimitivePlugin, seeThroughMeshes } from "@gteki/scene-api";
import type { LoadedStation } from "../registry.ts";
import { R, chevronTexture, ribbonGeometry } from "./geometry.ts";
import { bodyBlock, hitNormal, slideAlong, type BodyBlock } from "./bodyCollision.ts";
import { CameraCut } from "./cameraCut.ts";
import { manifestScene } from "./manifestScene.ts";
import { castAll, castCamera, cuttableSigns, explorerTargets, keepBelowBlockers } from "./raycast.ts";
import { DEFAULT_GUIDE_TIER, pacedDistance, type GuideTierId, type PaceSpan } from "./guidePace.ts";
import { advanceGuide, seekGuideState } from "./guideStops.ts";
import { PostFx } from "./postfx.ts";
import { FOLLOW, avatarFade, constrainedPitch, easeRaise, followBoom, followDistance, followPose, raisedBack } from "./followCamera.ts";
import { OverviewLook } from "./overviewLook.ts";
import { CAMERA_FAR_M, OVERVIEW_OFFSET, boxCorners, extentShare, frameBounds, freeArea, overviewFar, pointsBounds, routablePoints, screenBox, type ViewRect } from "./overviewFraming.ts";
import { declutter, estimateLabelBox, labelClass, revealedUnmeasured, type DeclutterItem, type LabelClass } from "./labelDeclutter.ts";
import { StationCaches } from "./stationCaches.ts";
import { STREET, StreetBackdrop, atStreetTop, footingLevel, isOutdoors, roleOf } from "./streetBackdrop.ts";
import { createAvatar, type AvatarRig } from "./avatar.ts";
import { avatarMotion } from "./avatarMotion.ts";
import { contactShadow } from "./contactShadow.ts";
import { buildGraphView, type GraphView } from "./graphView.ts";
import { Input } from "./input.ts";
import { DEFAULT_GROUND, acceptGround, angleDelta, cumulativeLengths, resolveWalls, samplePolyline, wallToRenderer, type Segment2 } from "./walker.ts";
import { OcclusionSweep, labelState, onFocusFloor, type LabelState } from "./labelVisibility.ts";
import { TriangleBvh, segmentHitsBox, type Cull } from "./triangleBvh.ts";
import { cacheBvh, currentBvh, prepareRayTrees } from "./meshBvh.ts";
import { occludedLineStyle, type OccludedLineStyle } from "./occludedLine.ts";

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
const WALK = WALKER_SPEED.walkMps;
const RUN = WALKER_SPEED.runMps;
/** POI labels float this high above their entrance. */
const LABEL_LIFT = 2.4;

/** Per-frame occlusion budget: at most this many label rays, and stop once this time (ms) is spent. */
const LABEL_RAYS = { low: { count: 6, ms: 0.6 }, high: { count: 16, ms: 1.5 } } as const;
/**
 * Labels are re-checked this often (ms) even with a still camera, so moving parts (doors, escalator
 * steps) and render-state changes (hidden, faded or relayered meshes) are followed.
 */
const LABEL_RECHECK_MS = 1000;
/** Overview declutter runs at most this often (ms) while the view changes. */
const DECLUTTER_MS = 80;
/** A revealed label that still cannot be measured (never laid out) is re-checked this many times, then left on its estimate. */
const MEASURE_TRIES = 5;
/** Instanced meshes with more instances than this occlude only as registered proxies. */
const MAX_OCCLUDER_INSTANCES = 1024;

/** A mesh that can hide labels behind it. */
interface Occluder {
  mesh: THREE.Mesh;
  /** The geometry at load; the mesh stops occluding while it shows any other one. */
  geometry: THREE.BufferGeometry;
  /** World bounds (all instances), recomputed before each sweep frame when the mesh or its instances moved. */
  box: THREE.Box3;
  /** Mesh-space bounds (all instances). */
  localBox: THREE.Box3;
  /** Instanced meshes: each instance's mesh-space bounds (min xyz, max xyz). */
  instanceBoxes: Float32Array | null;
  seenMatrix: THREE.Matrix4;
  /** Instance buffer, its version and the count the bounds were computed for. */
  seenInstanceMatrix: THREE.InstancedBufferAttribute | null;
  seenInstances: string;
}

/** A drawn part of a mesh: its material and the index (or vertex) range it draws. */
interface MeshPart { material: THREE.Material; start: number; count: number }

/**
 * The triangles each material draws, as three's renderer picks them (groups only with a material
 * array). Resolved per query, so swapped materials and changed draw ranges count; BVHs stay cached.
 */
function meshParts(mesh: THREE.Mesh): MeshPart[] {
  const range = mesh.geometry.drawRange;
  const clip = (material: THREE.Material, start: number, count: number): MeshPart => {
    const s = Math.max(start, range.start);
    return { material, start: s, count: Math.max(0, Math.min(start + count, range.start + range.count) - s) };
  };
  if (!Array.isArray(mesh.material)) return [clip(mesh.material, 0, Infinity)];
  const parts: MeshPart[] = [];
  for (const group of mesh.geometry.groups) {
    const material = mesh.material[group.materialIndex ?? 0];
    if (material) parts.push(clip(material, group.start, group.count));
  }
  return parts;
}

/** Geometry the GPU deforms or assembles per draw, which a static triangle BVH cannot follow. */
function deforming(mesh: THREE.Mesh): boolean {
  return Boolean((mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.BatchedMesh).isBatchedMesh
    || mesh.morphTargetInfluences?.length || (mesh as THREE.InstancedMesh).morphTexture);
}

interface PoiLabel {
  poiId: string;
  obj: CSS2DObject;
  /** Floor height under the label (renderer Y). */
  groundY: number;
  selected: boolean;
  occluded: boolean;
  state: LabelState;
  /** Overview only: dropped by the screen-space declutter (hidden on top of `state`, never instead of it). */
  decluttered: boolean;
  klass: LabelClass;
  /** Backed by a graph node (not search-only). */
  routable: boolean;
  /** Measured box of the label element (px), cached; null until it has been laid out. */
  size: { w: number; h: number } | null;
  /** Passes that revealed this label while it was still unmeasured. */
  measureTries: number;
}

export class Explorer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, CAMERA_FAR_M);
  private readonly labels = new CSS2DRenderer();
  private readonly orbit: OrbitControls;
  private composer: PostFx | null = null;
  private readonly overviewLook = new OverviewLook();
  private readonly street = new StreetBackdrop();
  /** Render height of the station's street floor when it is an underground (scene-lit) station, else null. */
  private streetY: number | null = null;
  /** Set by each discrete placement (walkFrom, startGuide); consumed by the next frame outside overview. */
  private teleported = false;
  /** A teleport made while already walking/guiding: the follow camera jumps with the walker instead of gliding. */
  private snapCamera = false;
  /** prefers-reduced-motion: the follow camera and orbit damping cut instead of gliding, and decorative route motion stops. */
  private reducedMotion = false;
  private readonly streetProbe = { at: new THREE.Vector3(Infinity, 0, 0), wait: 0, outdoors: false, level: true };
  private readonly probeDown = new THREE.Vector3(0, -1, 0);
  private readonly probeNormal = new THREE.Vector3();
  private readonly probeNormalMatrix = new THREE.Matrix3();
  /** Street-level graph nodes (exit tops) in renderer space. */
  private streetTops: THREE.Vector3[] = [];
  private readonly probeOrigin = new THREE.Vector3();
  private readonly probeUp = new THREE.Vector3(0, 1, 0);
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
  /** Meshes actually ray-tested for ground, walls and the follow camera (see explorerTargets). */
  private groundTargets: THREE.Object3D[] = [];
  private colliderTargets: THREE.Object3D[] = [];
  private cameraTargets: THREE.Object3D[] = [];
  /** Walls and floors only: the street probe's sky test (camera-only blockers such as signs never hide the sky). */
  private skyTargets: THREE.Object3D[] = [];
  private blockerTargets: ReadonlySet<THREE.Object3D> = new Set();
  /** What the ray targets' trees cost to build at load (see prepareRayTrees). */
  private rayTrees = { trees: 0, triangles: 0, bytes: 0, buildMs: 0 };
  private colliders: THREE.Object3D[] = [];
  /** Camera-only blockers (ceilings): stop the follow camera, never the walker. */
  private cameraBlockers: THREE.Object3D[] = [];
  private walls: Segment2[] = [];
  /** Visual-only signage the follow camera sees through (never walkable or a collider), as actually cut. */
  private seeThrough: THREE.Object3D[] = [];
  private readonly cameraCut = new CameraCut();
  private routeTexture: THREE.CanvasTexture | null = null;
  private routeLines: OccludedLineStyle | null = null;

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
  /** Smoothed extra boom elevation (radians) raised over a wall/slab squeeze; see constrainedPitch. */
  private boomRaise = 0;
  private readonly raiseScratch = new THREE.Vector3();
  private readonly raisedBoom = new THREE.Vector3();
  private firstPerson = false;
  private mode: ExplorerMode = "overview";
  private guide: { pts: THREE.Vector3[]; cum: number[]; steps: number[]; s: number; paused: boolean; stops: { s: number; index: number }[]; holding: boolean; spans: readonly PaceSpan[] } | null = null;
  /** Every stop of the running guide (`guide.stops` is consumed as they are reached; a seek restores the ones still ahead). */
  private guideAllStops: { s: number; index: number }[] = [];
  /** The user's guide speed tier; kept across instruction changes and later guides. */
  private tier: GuideTierId = DEFAULT_GUIDE_TIER;
  private poiLabels: PoiLabel[] = [];
  private readonly labelSweep = new OcclusionSweep();
  private occluders: Occluder[] = [];
  /** The walker's and follow camera's ray targets (castTargets), fixed at load like them. */
  private proxies = new Set<THREE.Object3D>();
  private labelSweepDoneAt = -Infinity;
  /** Camera pose at the last occlusion sweep. */
  private readonly labelCamPos = new THREE.Vector3(Infinity, 0, 0);
  private readonly labelCamQuat = new THREE.Quaternion();
  /** Overview declutter: runs when the view, label states or sizes change (see updateDeclutter). */
  private declutterDirty = true;
  private declutterAt = -Infinity;
  /** Some label may carry `decluttered` (set by an overview pass, cleared when leaving overview). */
  private declutterActive = false;
  private readonly viewSize = { w: 1, h: 1 };
  /** The routable slice's bounds (renderer frame), or null when the bundle has no usable edge. */
  private routableBox: THREE.Box3 | null = null;
  /** The routable network's points (the bounds' source), for the overviewFrame QA hook. */
  private routablePts: THREE.Vector3[] = [];
  /** What the overview is framed on, so a resize can refit; cleared by the user's own orbit/zoom/pan. */
  private framed: THREE.Box3 | null = null;
  /**
   * The points the fit sizes itself on: the routable network (the set `overviewFrame().bbox` measures), so
   * the reported extent is what the fit targeted. Null when an explicit box is framed (its 8 corners).
   */
  private framedPts: readonly THREE.Vector3[] | null = null;
  /** The HUD/search panel the overview must not frame under; its rect is read, never drawn. */
  private panelEl: HTMLElement | null = null;
  /** The persistent credit line along the canvas bottom; the overview keeps clear of it too. */
  private creditEl: HTMLElement | null = null;
  /** Refits the overview when an occluder's size changes: the panel collapsing, the credit line wrapping. */
  private occluderResize: ResizeObserver | null = null;
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
    // Any user orbit, pan or zoom ends automatic refitting on resize.
    this.orbit.addEventListener("start", () => { this.framed = null; this.framedPts = null; });

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
  sceneInfo(): { world: number[]; route: number[]; routeChildren: number; walkable: number; colliders: number; cameraBlockers: number; seeThrough: number; rayTrees: { trees: number; triangles: number; bytes: number; buildMs: number }; camera: number[]; mode: ExplorerMode; lighting: "default" | "scene"; coreLightsOn: number; street: { active: boolean; opacity: number } } {
    const box = (o: THREE.Object3D) => { const b = new THREE.Box3().setFromObject(o); return b.isEmpty() ? [] : [...b.min.toArray(), ...b.max.toArray()].map((v) => Math.round(v * 10) / 10); };
    return {
      world: box(this.world), route: box(this.routeGroup), routeChildren: this.routeGroup.children.length,
      walkable: this.walkable.length, colliders: this.colliders.length, cameraBlockers: this.cameraBlockers.length, seeThrough: this.seeThrough.length,
      rayTrees: { ...this.rayTrees, buildMs: Math.round(this.rayTrees.buildMs * 10) / 10 },
      camera: this.camera.position.toArray().map((v) => Math.round(v * 10) / 10), mode: this.mode,
      lighting: this.lighting, coreLightsOn: this.coreLights.filter((l) => l.visible).length,
      street: { active: this.street.active, opacity: Math.round(this.street.opacity * 1000) / 1000 },
    };
  }

  /** POI label states for automated visual checks. */
  labelInfo(): { shown: number; faded: number; hidden: number; decluttered: number } {
    const n = { shown: 0, faded: 0, hidden: 0, decluttered: 0 };
    // A label dropped by the overview declutter is off screen: counted there, not as shown or faded.
    for (const l of this.poiLabels) { if (l.decluttered && l.state !== "hidden") n.decluttered++; else n[l.state]++; }
    return n;
  }

  /**
   * Where the routable network sits on screen now (CSS px, page coordinates like label rects) and how
   * big it is, measured against the FREE area — the part of the canvas neither the search panel nor the
   * credit line covers: `extentShare` = larger bbox side / the free area's shorter side (about 0.65 right
   * after the fit: the fit sizes the same network points). `fitShare` is the share of the AABB of those
   * points, which is what the fit is fed; its 8 corners project outside a diagonal point band, so it can
   * read larger than `extentShare`. `visibleRect` is that free area itself (page CSS px, so it excludes
   * the panel and the credit strip), so a spec can check `bbox` lies outside both. Null outside overview
   * or without a routable network.
   */
  overviewFrame(): { extentShare: number; fitShare: number | null; bbox: { x0: number; y0: number; x1: number; y1: number }; visibleRect: { x: number; y: number; w: number; h: number } } | null {
    if (this.mode !== "overview" || this.routablePts.length === 0) return null;
    const { w, h } = this.viewSize;
    this.camera.updateMatrixWorld();
    const net = screenBox(this.routablePts, this.camera, w, h);
    if (!net) return null;
    const slice = this.framed ?? this.routableBox;
    const fit = slice ? screenBox(boxCorners({ min: slice.min, max: slice.max }), this.camera, w, h) : null;
    const free = this.freeRect();
    const at = this.host.getBoundingClientRect();
    return {
      extentShare: extentShare(net, free.w, free.h),
      fitShare: fit ? extentShare(fit, free.w, free.h) : null,
      bbox: { x0: net.x0 + at.left, y0: net.y0 + at.top, x1: net.x1 + at.left, y1: net.y1 + at.top },
      visibleRect: { x: free.x + at.left, y: free.y + at.top, w: free.w, h: free.h },
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

  /** The station module whose retained caches must be dropped when the explorer leaves it (see StationCaches). */
  private readonly stationCaches = new StationCaches();

  /** Run the previous station's cache-release hook when `nextId` is a different station (null: disposing). */
  private releaseStationCaches(nextId: string | null): void {
    this.stationCaches.releaseFor(nextId);
  }

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
    // Leaving another station drops its retained caches first; the same station reopening keeps them.
    this.releaseStationCaches(station.key);
    this.clearStation();
    this.station = station;
    this.stationCaches.remember(station.key, station.scene);
    const bundle = station.bundle;
    this.graph = buildGraphView(bundle, router);
    this.routablePts = routablePoints(bundle, (e) => router.isTraversable(e, DEFAULT_PROFILE));
    this.routableBox = toBox3(pointsBounds(this.routablePts));
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
        const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).setResourcePath(`${ASSET_SCHEME}${stationDir(uri)}/`).register(glbPrimitivePlugin);
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
      this.graph.setXray(this.mode === "overview");
      this.walkable = this.stationScene.walkable;
      this.colliders = this.stationScene.colliders ?? [];
      this.cameraBlockers = this.stationScene.cameraBlockers ?? [];
      this.walls = (this.stationScene.walls ?? []).map(wallToRenderer);
      const env = this.stationScene.environment;
      if (env?.background !== undefined) this.scene.background = new THREE.Color(env.background);
      if (env?.fog) this.scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
      if (env?.exposure !== undefined) this.renderer.toneMappingExposure = env.exposure;
      this.applyLighting(env?.lighting === "scene" ? "scene" : "default");
      const streets = station.bundle.floors.filter((f) => f.ordinal === 0 && !f.intermediate);
      this.streetY = env?.lighting === "scene" && streets.length ? Math.max(...streets.map((f) => f.renderElevationM)) : null;
      this.streetTops = station.bundle.nodes
        .filter((n) => streets.some((f) => f.id === n.floorId))
        .map((n) => R(n.position.x, n.position.y, nodeDisplayZ(n, streets.find((f) => f.id === n.floorId)).z));
      this.stationScene.root.updateMatrixWorld(true);
      this.street.attach(this.stationScene.root);
    } else {
      this.world.add(this.graph.root);
      this.walkable = this.graph.walkable;
    }
    this.world.updateMatrixWorld(true);
    const targets = explorerTargets(this.walkable, this.colliders, this.cameraBlockers);
    this.groundTargets = targets.ground;
    this.colliderTargets = targets.collider;
    this.skyTargets = targets.sky;
    this.cameraTargets = targets.camera;
    this.blockerTargets = targets.blockers;
    // Every ray target is in the camera set (walls, floors, blockers); trees are built here, never mid-frame.
    this.rayTrees = prepareRayTrees(targets.camera);
    if (this.stationScene) {
      // A sign that stands, or sits under a listed group, among the walkable/collider/camera targets is never cut:
      // a mesh that is both a sign and a camera blocker stops the camera and stays solid.
      const signs = cuttableSigns(seeThroughMeshes(this.stationScene.root), [this.walkable, this.colliders, this.cameraBlockers, this.cameraTargets]);
      this.seeThrough = this.cameraCut.apply(this.stationScene.root, signs);
    }
    this.buildOccluders(this.stationScene?.root ?? this.graph.root);
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
    this.street.attach(null);
    this.streetY = null;
    this.streetTops = [];
    this.streetProbe.at.set(Infinity, 0, 0);
    this.overviewLook.set(this.scene, this.world, false);
    this.disconnectStationAudio();
    this.stopGuide();
    this.clearRoute();
    this.clearPois();
    if (this.stationScene) { this.world.remove(this.stationScene.root); this.stationScene.dispose(); this.stationScene = null; }
    if (this.graph) { this.world.remove(this.graph.root); this.overlays.remove(this.graph.overlay); this.graph.dispose(); this.graph = null; }
    this.routableBox = null;
    this.routablePts = [];
    this.framed = null;
    this.framedPts = null;
    this.walkable = [];
    this.colliders = [];
    this.cameraBlockers = [];
    this.groundTargets = [];
    this.colliderTargets = [];
    this.cameraTargets = [];
    this.skyTargets = [];
    this.blockerTargets = new Set();
    this.rayTrees = { trees: 0, triangles: 0, bytes: 0, buildMs: 0 };
    this.walls = [];
    this.seeThrough = [];
    this.cameraCut.clear();
    this.occluders = [];
    this.proxies.clear();
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 60, 420);
    this.renderer.toneMappingExposure = 1;
    this.applyLighting("default");
  }

  setGraphOverlay(visible: boolean): void {
    if (this.graph && this.stationScene) this.graph.overlay.visible = visible;
  }

  get graphOverlayOn(): boolean {
    return Boolean(this.graph && this.stationScene && this.graph.overlay.visible);
  }

  /**
   * Frame a box (default: the routable slice, else the whole scene) in overview mode, so it fills
   * about OVERVIEW_FILL of the viewport's shorter side (see overviewFraming.ts). The viewing direction
   * is kept; a resize refits until the user moves the camera.
   */
  frameAll(box?: THREE.Box3): void {
    const b = (box ?? this.routableBox ?? new THREE.Box3().setFromObject(this.world)).clone();
    if (b.isEmpty()) b.set(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(50, 10, 50));
    this.setMode("overview");
    this.framed = b;
    this.framedPts = box ? null : this.routablePts;
    this.camera.near = 0.1;
    this.fitOverview();
  }

  /**
   * Name the UI panel the overview must stay clear of (the app's search panel). The fit then fills the
   * unobstructed area — below the panel on a phone, to the right of it on a desktop — and a panel that
   * collapses, expands or changes size refits an overview the user has not moved. Null: the whole view.
   */
  setPanel(el: HTMLElement | null): void {
    this.panelEl = el;
    this.watchOccluders();
    this.refitOverview();
  }

  /**
   * Name the persistent credit line along the canvas bottom (the app's `.credit-line` footer, shown when
   * `.app` has `has-credit`). It blocks the whole width, so the free area ends above it: the overview keeps
   * clear of it, and its height changes (a longer string wrapping) refit a user-untouched overview. Null
   * while there is no credit line: the whole viewport height is free.
   */
  setCreditLine(el: HTMLElement | null): void {
    this.creditEl = el;
    this.watchOccluders();
    this.refitOverview();
  }

  /** Observe both occluders on one observer, so a size change of either refits through the same path. */
  private watchOccluders(): void {
    this.occluderResize?.disconnect();
    this.occluderResize = null;
    const els = [this.panelEl, this.creditEl].filter((e): e is HTMLElement => e !== null);
    if (els.length === 0 || typeof ResizeObserver === "undefined") return;
    this.occluderResize = new ResizeObserver(() => this.refitOverview());
    for (const e of els) this.occluderResize.observe(e);
  }

  /** Re-measure the occluders and refit an automatic overview (never a camera the user has moved). */
  refitOverview(): void {
    if (this.mode === "overview" && this.framed) this.fitOverview();
  }

  /**
   * The canvas area no UI covers (CSS px, canvas-relative): neither the panel nor the credit line. Both page
   * rects are measured here, on a resize or an occluder change — never per frame.
   */
  private freeRect(): ViewRect {
    const { w, h } = this.viewSize;
    const el = this.panelEl;
    // display:none (walk/guide on a phone), a collapsed element or none at all leaves the canvas free.
    const measured = el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
    const host = (measured || this.creditEl) ? this.host.getBoundingClientRect() : null;
    const panel = measured && host ? { x: measured.left - host.left, y: measured.top - host.top, w: measured.width, h: measured.height } : null;
    return freeArea({ w, h }, panel, this.creditInset(host));
  }

  /** The canvas-bottom band the credit line blocks (CSS px): it spans the width, so only its top edge counts. */
  private creditInset(host: DOMRect | null): number {
    const el = this.creditEl;
    if (!host || !el || el.getClientRects().length === 0) return 0;
    const p = el.getBoundingClientRect();
    return Math.min(this.viewSize.h, Math.max(0, host.bottom - Math.max(host.top, p.top)));
  }

  /** Put the camera on the fit of `framed` for the current aspect, inside the panel-free area. */
  private fitOverview(): void {
    if (!this.framed) return;
    const { w, h } = this.viewSize;
    const pose = frameBounds(
      this.framed,
      { fovDeg: this.camera.fov, aspect: this.camera.aspect, near: this.camera.near, viewport: { w, h }, free: this.freeRect(), points: this.framedPts ?? undefined },
      undefined,
      OVERVIEW_OFFSET,
    );
    this.orbit.target.copy(pose.target);
    this.camera.position.copy(pose.position);
    // A short free area (a phone below its sheet and credit line) puts the pose kilometres out: deepen the
    // far plane so the slice is not culled, or the overview would show nothing.
    this.camera.far = overviewFar(pose.distance, this.framed.getSize(new THREE.Vector3()).length() / 2);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  setMode(mode: ExplorerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // The overview may have deepened the far plane for its pose; the walking camera keeps its own.
    if (mode !== "overview" && this.camera.far !== CAMERA_FAR_M) { this.camera.far = CAMERA_FAR_M; this.camera.updateProjectionMatrix(); }
    this.orbit.enabled = mode === "overview";
    this.avatar.visible = mode !== "overview" && !this.firstPerson;
    this.input.enabled = mode !== "overview";
    if (mode === "overview") this.orbit.target.copy(this.pos);
    const xray = this.routeGroup.getObjectByName("route-xray");
    if (xray) xray.visible = mode === "overview";
    this.routeLines?.setXray(mode === "overview");
    this.graph?.setXray(mode === "overview");
    if (mode === "overview") { this.street.restore(this.scene); this.snapCamera = false; }
    this.overviewLook.set(this.scene, this.world, mode === "overview");
    this.events.onMode?.(mode);
  }

  get firstPersonOn(): boolean {
    return this.firstPerson;
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
    this.teleported = true;
    this.snapCamera = this.mode !== "overview";
    this.yaw = (-headingDeg * Math.PI) / 180;
    // The avatar appears at the new spot facing the new heading (no run blend from the old one).
    this.lastAvatarPos.copy(this.pos);
    this.bodyYaw = this.yaw;
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

  /** The collider surface that stops the walker's body going from `from` to `to`, or null when the move is free. */
  private blockedByColliders(from: THREE.Vector3, to: THREE.Vector3): BodyBlock | null {
    if (this.colliders.length === 0) return null;
    return bodyBlock(from, to, (origin, dir, far) => {
      this.ray.set(origin, dir);
      this.ray.far = far;
      const hit = castAll(this.ray, this.colliderTargets)[0];
      return hit ? { distance: hit.distance, normal: hitNormal(hit, dir) } : null;
    }, RADIUS);
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
    // Depth-tested glow plus a faint dashed pass where a wall hides it; overview keeps the always-on-top look.
    this.routeLines = occludedLineStyle(0x5ef0ff, 0.9);
    this.routeLines.setXray(this.mode === "overview");
    const glow = this.routeLines.lines(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.12, 0)))), 6);
    // Symbolic (unknown) heights are drawn dashed above the ribbon so they read as approximate.
    const symbolic = polyline.some((p) => !p.zKnown);
    // X-ray copy so the route stays readable through ceilings/slabs in overview.
    const xrayMat = new THREE.MeshBasicMaterial({ map: this.routeTexture, color: 0xb8f8ff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const xray = new THREE.Mesh(ribbon.geometry, xrayMat);
    xray.renderOrder = 20;
    xray.name = "route-xray";
    xray.visible = this.mode === "overview";
    this.routeGroup.add(ribbon, ...glow, xray);
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
    this.routeLines = null;
  }

  /** Floating labels at each POI's verified entrance (or display position when search-only). */
  showPois(bundle: StationBundle, label: (poi: Poi) => string, selected: string[] = []): void {
    // Rebuilt labels keep their last occlusion result until re-checked, so they do not flash.
    const wasOccluded = new Set(this.poiLabels.filter((l) => l.occluded).map((l) => l.poiId));
    this.clearPois();
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const floors = new Map(bundle.floors.map((f) => [f.id, f]));
    for (const poi of bundle.pois) {
      const node = poi.connectorNodeIds.map((id) => nodes.get(id)).find(Boolean);
      let at: THREE.Vector3 | null = null;
      if (node) at = R(node.position.x, node.position.y, nodeDisplayZ(node, floors.get(node.floorId)).z);
      else if (poi.displayPosition) at = R(poi.displayPosition.x, poi.displayPosition.y, poi.displayPosition.z ?? floors.get(poi.floorId ?? "")?.renderElevationM ?? 0);
      if (!at) continue;
      const isSelected = selected.includes(poi.id);
      const el = document.createElement("button");
      el.className = `poi-label cat-${poi.category}${isSelected ? " selected" : ""}${node ? "" : " search-only"}`;
      el.textContent = label(poi);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); this.events.onPoiClick?.(poi.id); });
      const obj = new CSS2DObject(el);
      obj.position.copy(at).add(new THREE.Vector3(0, LABEL_LIFT, 0));
      this.poiGroup.add(obj);
      this.poiLabels.push({ poiId: poi.id, obj, groundY: at.y, selected: isSelected, occluded: wasOccluded.has(poi.id), state: "shown", decluttered: false, klass: labelClass(isSelected, poi.category), routable: Boolean(node), size: null, measureTries: 0 });
    }
    this.poiGroup.updateMatrixWorld(true);
    this.labelSweep.invalidate(this.poiLabels.length);
    this.declutterDirty = true;
  }

  clearPois(): void {
    for (const c of [...this.poiGroup.children]) { this.poiGroup.remove(c); (c as CSS2DObject).element?.remove(); }
    this.poiLabels = [];
  }

  /**
   * Candidate occluders, fixed at load (trees are never built mid-frame): every station mesh plus the
   * walkable/collider meshes. Whether and how each one blocks is decided per sweep frame:
   * - proxies (the walkable/collider meshes the walker ray-tests, see explorerTargets; never camera-only
   *   blockers) block even when hidden or detached, from either side;
   * - other meshes block while drawn under this scene with an opaque, filled material;
   * - deforming meshes (skinned, morphed, batched) never block, since a static BVH cannot follow them;
   * - instanced crowds (DynamicDrawUsage) and instance sets above MAX_OCCLUDER_INSTANCES block only as
   *   proxies. Nothing outside the station root (route, avatar) is a candidate.
   */
  private buildOccluders(root: THREE.Object3D): void {
    const seen = new Set<THREE.Object3D>();
    const add = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || seen.has(mesh) || !mesh.geometry?.getAttribute("position") || deforming(mesh)) return;
      seen.add(mesh);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      cacheBvh(mesh.geometry);
      this.occluders.push({
        mesh, geometry: mesh.geometry,
        box: new THREE.Box3(), localBox: new THREE.Box3(), instanceBoxes: null,
        seenMatrix: new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        seenInstanceMatrix: null, seenInstances: "",
      });
    };
    root.traverse(add);
    // Walls and floors only: a camera-only blocker is hidden geometry and never hides a label (a drawn one
    // still occludes as a visual mesh above).
    this.proxies = new Set(this.skyTargets);
    for (const p of this.proxies) add(p);
    this.labelSweepDoneAt = -Infinity;
  }

  /** Bring occluder bounds up to date with mesh and instance transforms. */
  private refreshOccluders(): void {
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    for (const o of this.occluders) {
      const proxy = this.proxies.has(o.mesh);
      // The renderer only updates attached objects; a detached proxy keeps its own transform current here.
      if (proxy && !inScene(o.mesh, this.scene)) o.mesh.updateWorldMatrix(true, false);
      const inst = o.mesh as THREE.InstancedMesh;
      const instancedOut = inst.isInstancedMesh && !proxy && (inst.count > MAX_OCCLUDER_INSTANCES || inst.instanceMatrix.usage === THREE.DynamicDrawUsage);
      if (o.mesh.geometry !== o.geometry || !currentBvh(o.geometry) || !o.geometry.boundingBox || instancedOut) {
        // Not an occluder now (geometry swapped or edited after load, a crowd, too many instances): an
        // empty box keeps every ray, and any further bounds work, away.
        o.box.makeEmpty();
        o.localBox.makeEmpty();
        o.instanceBoxes = null;
        o.seenInstanceMatrix = null;
        o.seenInstances = "";
        continue;
      }
      const instances = inst.isInstancedMesh ? `${inst.instanceMatrix.version}:${inst.count}` : "";
      const instancesMoved = inst.isInstancedMesh &&
        (o.seenInstanceMatrix !== inst.instanceMatrix || o.seenInstances !== instances || !o.instanceBoxes);
      if (o.seenMatrix.equals(o.mesh.matrixWorld) && !instancesMoved && !o.localBox.isEmpty()) continue;
      if (!inst.isInstancedMesh) o.localBox.copy(o.geometry.boundingBox!);
      else if (instancesMoved || o.localBox.isEmpty()) {
        o.instanceBoxes = new Float32Array(inst.count * 6);
        o.localBox.makeEmpty();
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          box.copy(o.geometry.boundingBox!).applyMatrix4(m);
          box.min.toArray(o.instanceBoxes, i * 6);
          box.max.toArray(o.instanceBoxes, i * 6 + 3);
          o.localBox.union(box);
        }
      }
      o.seenMatrix.copy(o.mesh.matrixWorld);
      o.seenInstanceMatrix = inst.isInstancedMesh ? inst.instanceMatrix : null;
      o.seenInstances = instances;
      o.box.copy(o.localBox).applyMatrix4(o.mesh.matrixWorld);
    }
  }

  /**
   * Fade labels behind floors/walls and, while walking or guided, hide labels on other floors. Rays
   * are budgeted per frame (count and time): a sweep runs when the camera moves, and otherwise once
   * every LABEL_RECHECK_MS.
   */
  private updateLabels(): void {
    const labels = this.poiLabels;
    if (labels.length === 0) return;
    const cam = this.camera;
    const camMoved = cam.position.distanceToSquared(this.labelCamPos) > 1e-4 || cam.quaternion.angleTo(this.labelCamQuat) > 1e-3;
    if (camMoved) {
      this.labelCamPos.copy(cam.position);
      this.labelCamQuat.copy(cam.quaternion);
      this.declutterDirty = true;
    }
    const now = performance.now();
    // The periodic re-check waits LABEL_RECHECK_MS after the previous sweep completed.
    if (camMoved || (!this.labelSweep.pending && now - this.labelSweepDoneAt >= LABEL_RECHECK_MS)) this.labelSweep.invalidate(labels.length);
    if (this.labelSweep.pending) {
      this.refreshOccluders();
      const budget = LABEL_RAYS[this.quality];
      const deadline = now + budget.ms;
      cam.updateMatrixWorld();
      for (let k = 0; k < budget.count && this.labelSweep.pending; k++) {
        const l = labels[this.labelSweep.take(labels.length)]!;
        l.occluded = !l.selected && this.labelOccluded(l);
        if (performance.now() > deadline) break;
      }
      if (!this.labelSweep.pending) this.labelSweepDoneAt = performance.now();
    }
    const focusY = this.mode === "overview" ? null : this.pos.y;
    for (const l of labels) {
      const state = labelState({ occluded: l.occluded, onFocusFloor: onFocusFloor(l.groundY, focusY), selected: l.selected });
      if (state === l.state) continue;
      l.state = state;
      l.obj.element.classList.toggle("occluded", state === "faded");
      this.declutterDirty = true;
    }
    this.updateDeclutter(now);
    for (const l of labels) {
      const shown = l.state !== "hidden" && !l.decluttered;
      if (l.obj.visible !== shown) l.obj.visible = shown;
    }
  }

  /**
   * Overview only: hide labels whose screen rectangle meets a higher-priority one (see labelDeclutter.ts).
   * Candidates are the labels the floor and occlusion rules leave on screen, so this only ever hides more.
   * Runs when the camera, sizes or label states changed, at most every DECLUTTER_MS. Label boxes are
   * measured once (a batched read, no per-frame layout) and cached.
   */
  private updateDeclutter(now: number): void {
    const labels = this.poiLabels;
    if (this.mode !== "overview") {
      // Walk and guide never declutter; undo an earlier overview pass once.
      if (this.declutterActive) for (const l of labels) l.decluttered = false;
      this.declutterActive = false;
      this.declutterDirty = true;
      return;
    }
    if (!this.declutterDirty || now - this.declutterAt < DECLUTTER_MS) return;
    this.declutterDirty = false;
    this.declutterAt = now;
    this.declutterActive = true;
    // Measure labels the browser has laid out and not yet measured: reads only, so one layout at most.
    for (const l of labels) {
      const el = l.obj.element;
      if (l.size || !el.isConnected || el.style.display === "none") continue;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w > 0 && h > 0) { l.size = { w, h }; this.declutterDirty = true; }
    }
    const { w: vw, h: vh } = this.viewSize;
    const items: DeclutterItem[] = [];
    const byId = new Map<string, PoiLabel>();
    const p = new THREE.Vector3();
    for (const l of labels) {
      l.decluttered = false;
      if (l.state === "hidden") continue;
      p.setFromMatrixPosition(l.obj.matrixWorld).project(this.camera);
      if (p.z < -1 || p.z > 1) continue; // behind the camera or past far: the CSS2D renderer hides it
      const size = l.size ?? estimateLabelBox(l.obj.element.textContent ?? "");
      const x = (p.x * 0.5 + 0.5) * vw, y = (-p.y * 0.5 + 0.5) * vh;
      if (x + size.w / 2 < 0 || x - size.w / 2 > vw || y + size.h / 2 < 0 || y - size.h / 2 > vh) continue;
      items.push({ id: l.poiId, x, y, w: size.w, h: size.h, klass: l.klass, routable: l.routable, faded: l.state === "faded", wasVisible: l.obj.visible, measured: l.size !== null });
      byId.set(l.poiId, l);
    }
    const keep = declutter(items);
    for (const [id, l] of byId) l.decluttered = !keep.has(id);
    // A label shown on an estimate gets its real size once the CSS2D renderer has laid it out: run again then.
    // Bounded: a label that never lays out is retried MEASURE_TRIES times, then left on its estimate.
    for (const id of revealedUnmeasured(items, keep)) {
      if (byId.get(id)!.measureTries++ < MEASURE_TRIES) this.declutterDirty = true;
    }
  }

  private labelOccluded(label: PoiLabel): boolean {
    if (this.occluders.length === 0) return false;
    const at = label.obj.getWorldPosition(new THREE.Vector3());
    // Labels behind the camera or past its far plane are hidden by the CSS2D renderer; keep their last
    // result. One whose anchor is just off the screen's side can still show part of its text, so it counts.
    if (Math.abs(at.clone().project(this.camera).z) > 1) return label.occluded;
    const from = this.camera.getWorldPosition(new THREE.Vector3());
    const dist = from.distanceTo(at);
    if (dist < 0.5) return false;
    // End just short of the label, so the surface right at its anchor does not count.
    const to = at.lerp(from, 0.3 / dist);
    const ray = new THREE.Ray(from, to.clone().sub(from).normalize());
    const far = dist - 0.3;
    const entry = new THREE.Vector3();
    const toLocal = new THREE.Matrix4();
    const instance = new THREE.Matrix4();
    const a = new THREE.Vector3();
    const d = new THREE.Vector3();
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    /** Puts the part t0..t1 of the segment into the space `m` maps world points to, as a (start) and d (direction). */
    const segmentIn = (m: THREE.Matrix4, t0 = 0, t1 = 1) => {
      a.copy(p0.lerpVectors(from, to, t0)).applyMatrix4(m);
      d.copy(p1.lerpVectors(from, to, t1)).applyMatrix4(m).sub(a);
    };
    // Sign materials the follow camera cuts open (cameraCut) only block where they are still drawn.
    const whole: [number, number][] = [[0, 1]];
    const drawn = this.cameraCut.drawnSpans(from, to);
    const blocks = (proxy: boolean, bvh: TriangleBvh, parts: MeshPart[], m: THREE.Matrix4, mirrored = false) =>
      parts.some((p) => (proxy || blocksView(p.material)) && (proxy || !this.cameraCut.cuts(p.material) ? whole : drawn).some(([t0, t1]) => {
        segmentIn(m, t0, t1);
        return bvh.anyHit(a.x, a.y, a.z, d.x, d.y, d.z, proxy ? "both" : cullOf(p.material, mirrored), p.start, p.count);
      }));
    for (const o of this.occluders) {
      // World-box prefilter: skip meshes the segment does not reach.
      if (!o.box.containsPoint(from) && !(ray.intersectBox(o.box, entry) && entry.distanceTo(from) <= far)) continue;
      // Proxies always count, as for the walker (they need not hang under the station root); visual meshes only
      // while drawn under this scene.
      const proxy = this.proxies.has(o.mesh);
      if (deforming(o.mesh) || (!proxy && (!inScene(o.mesh, this.scene) || !meshDrawn(o.mesh, this.camera)))) continue;
      const inst = o.mesh as THREE.InstancedMesh;
      if (o.mesh.geometry !== o.geometry || (inst.isInstancedMesh && !o.instanceBoxes)) continue;
      // No tree is ever built mid-frame (see bvhCache).
      const bvh = currentBvh(o.geometry);
      if (!bvh) continue;
      const parts = meshParts(o.mesh);
      toLocal.copy(o.mesh.matrixWorld).invert();
      segmentIn(toLocal);
      if (!inst.isInstancedMesh) {
        if (blocks(proxy, bvh, parts, toLocal)) return true;
        continue;
      }
      // Per-instance mesh-space bounds first: only instances the segment reaches pay for a BVH query.
      const boxes = o.instanceBoxes!;
      const n = Math.min(inst.count, boxes.length / 6);
      const ax = a.x, ay = a.y, az = a.z, dx = d.x, dy = d.y, dz = d.z;
      for (let i = 0; i < n; i++) {
        if (!segmentHitsBox(ax, ay, az, dx, dy, dz, boxes, i * 6)) continue;
        inst.getMatrixAt(i, instance);
        // The renderer offsets a mirrored matrixWorld (gl.frontFace) but not a mirrored instance matrix,
        // whose local back faces are then drawn as front faces.
        const mirrored = instance.determinant() < 0;
        if (blocks(proxy, bvh, parts, instance.invert().multiply(toLocal), mirrored)) return true;
      }
    }
    return false;
  }

  // ---- Guide ---------------------------------------------------------------------

  /**
   * Walk the polyline. `stopAtPoints` are polyline point indices where the guide must stop and pause (waits
   * for opening hours): it never moves past one before being resumed, including several at one spot.
   * `paceSpans` cap the speed where connectors or short instructions need it (see guidePace.ts).
   */
  startGuide(polyline: PolylinePoint[], fromS = 0, stopAtPoints: readonly number[] = [], paceSpans: readonly PaceSpan[] = []): void {
    const pts = polyline.map((p) => R(p.x, p.y, p.z));
    if (pts.length < 2) return;
    const cum = cumulativeLengths(pts);
    const stops = stopAtPoints.map((point, index) => ({ s: cum[point] ?? 0, index })).filter((x) => x.s >= fromS).sort((a, b) => a.s - b.s || a.index - b.index);
    this.guide = { pts, cum, steps: polyline.map((p) => p.stepIndex), s: fromS, paused: false, stops, holding: false, spans: paceSpans };
    this.guideAllStops = stops.slice();
    const first = samplePolyline(pts, this.guide.cum, fromS);
    this.pos.set(first.x, first.y, first.z);
    this.teleported = true;
    this.snapCamera = this.mode !== "overview";
    if (first.tx || first.tz) this.yaw = Math.atan2(-first.tx, -first.tz);
    this.lastAvatarPos.copy(this.pos);
    this.bodyYaw = this.yaw;
    this.setMode("guide");
  }

  /**
   * Jump the running guide to distance `s` (m) along its path as a teleport: stepGuide places the avatar there and the
   * follow camera snaps with it, as for any placement made while guiding. Pause state is kept. Stops numbered below
   * `firstStop` count as passed; the others (including one at `s`) apply, again if they were reached before.
   */
  seekGuide(s: number, firstStop = 0): void {
    const g = this.guide;
    if (!g) return;
    const total = g.cum[g.cum.length - 1]!;
    seekGuideState(g, this.guideAllStops, total, s, firstStop);
    const p = samplePolyline(g.pts, g.cum, g.s);
    this.pos.set(p.x, p.y, p.z);
    this.teleported = true;
    this.snapCamera = true;
    if (p.tx || p.tz) this.yaw = Math.atan2(-p.tx, -p.tz);
    this.lastAvatarPos.copy(this.pos);
    this.bodyYaw = this.yaw;
  }

  setGuidePaused(paused: boolean): void {
    if (!this.guide) return;
    this.guide.paused = paused;
    if (!paused) this.guide.holding = false;
  }

  get guidePaused(): boolean {
    return this.guide?.paused ?? false;
  }

  setGuideTier(id: GuideTierId): void {
    this.tier = id;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.orbit.enableDamping = !on;
  }

  /** The user's guide speed tier, so a re-rendered HUD shows the real state. */
  get guideTier(): GuideTierId {
    return this.tier;
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
    this.viewSize.w = w;
    this.viewSize.h = h;
    this.declutterDirty = true;
    if (this.mode === "overview") this.fitOverview();
    // A new aspect brings other labels on screen without the camera moving.
    this.labelSweep.invalidate(this.poiLabels.length);
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
    this.updateLabels();
    this.labels.render(this.scene, this.camera);
  }

  private step(dt: number, t: number): void {
    if (this.routeTexture && !this.reducedMotion) this.routeTexture.offset.x -= dt * 0.9;
    for (const g of this.routeGroup.children) {
      const ring = g.userData.pulse as THREE.Mesh | undefined;
      if (ring) ring.scale.setScalar(this.reducedMotion ? 1 : 1 + 0.25 * Math.sin(t * 3));
    }
    this.stationScene?.update?.(dt, t);

    if (this.mode === "walk") this.stepWalk(dt);
    else if (this.mode === "guide") this.stepGuide(dt);
    else this.orbit.update();

    if (this.mode !== "overview") {
      this.placeCamera(dt, this.snapCamera);
      this.snapCamera = false;
      // A teleport re-probes at once and snaps the backdrop to its target (no daylight carried underground).
      const snap = this.teleported;
      this.teleported = false;
      if (snap) this.streetProbe.at.set(Infinity, 0, 0);
      this.updateStreetProbe(dt);
      this.street.update(this.scene, this.camera, this.pos, this.streetProbe.outdoors, dt, this.streetProbe.level, snap);
    }
    // Signs between the follow camera and the avatar (or inside its near distance) are cut, never collided with.
    this.camera.updateMatrixWorld();
    this.cameraCut.update(this.camera, this.pos.clone().add(new THREE.Vector3(0, EYE, 0)), this.mode !== "overview");
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
    let target = new THREE.Vector3(pushed.x, this.pos.y, pushed.z);
    const block = this.blockedByColliders(this.pos, target);
    if (block) {
      // Slide along the surface that stopped the move rather than sticking to it.
      const slid = slideAlong(this.pos, target, block.normal);
      if (!slid) return;
      const along = resolveWalls(slid.x, slid.z, RADIUS, this.pos.y, WALKER_BODY.bodyTopM, this.walls);
      target = new THREE.Vector3(along.x, this.pos.y, along.z);
      if (this.blockedByColliders(this.pos, target)) return;
    }
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
    const stopped = g.paused ? null : advanceGuide(g, pacedDistance(g.s, dt, this.tier, g.spans), total);
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

  /**
   * Outdoors/level-ground probe for the street backdrop. Skipped entirely below street range; otherwise
   * refreshed when the walker has moved 0.25 m (raycasts are not free on large stations).
   */
  private updateStreetProbe(dt: number): void {
    const p = this.streetProbe;
    if (this.streetY === null || this.pos.y < this.streetY - STREET.maxBelowStreet || !this.skyTargets.length) {
      p.outdoors = false;
      p.level = false;
      p.at.set(Infinity, 0, 0);
      return;
    }
    // Every 0.25 m walked, plus once shortly after stopping, so the footing where the walker halts is used.
    // While the pavement shows, every step: stepping down off the top must hide it on the first tread.
    p.wait -= dt;
    const moved = p.at.distanceToSquared(this.pos);
    const due = moved >= 0.0625 || (moved > 1e-6 && (p.level || p.wait <= 0));
    if (!due) return;
    p.at.copy(this.pos);
    p.wait = 0.25;
    this.ray.set(this.probeOrigin.set(this.pos.x, this.pos.y + EYE, this.pos.z), this.probeUp);
    this.ray.far = STREET.skyClearance;
    p.outdoors = isOutdoors(this.pos.y, this.streetY, castAll(this.ray, this.skyTargets).length > 0);
    this.ray.set(this.probeOrigin.set(this.pos.x, this.pos.y + 0.4, this.pos.z), this.probeDown);
    this.ray.far = 1.2;
    const hit = castAll(this.ray, this.groundTargets)[0];
    const normalY = hit?.face
      ? this.probeNormal.copy(hit.face.normal).applyNormalMatrix(this.probeNormalMatrix.getNormalMatrix(hit.object.matrixWorld)).y
      : null;
    // Single-sided winding varies across source polygons: only the tilt matters.
    const footing = footingLevel(hit ? roleOf(hit.object) : null, normalY === null ? null : Math.abs(normalY), p.level);
    // The surface actually underfoot, not the walker's smoothed height, decides which tread this is.
    p.level = atStreetTop(hit ? hit.point : this.pos, this.streetTops, footing);
  }

  private placeCamera(dt: number, snap = false): void {
    const head = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) {
      this.camera.position.copy(head);
      this.camera.lookAt(head.clone().add(dir));
      return;
    }
    // Over-the-shoulder framing; the pivot itself is pulled in if a wall is closer than the shoulder offset.
    // Signs (visual-only) are never camera targets and never pull the camera in; cameraCut sees through them instead.
    let shoulder: number = FOLLOW.shoulder;
    if (this.cameraTargets.length) {
      this.ray.set(head, new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)));
      this.ray.far = FOLLOW.shoulder + 0.25;
      const side = castCamera(this.ray, this.cameraTargets, this.blockerTargets)[0];
      if (side) shoulder = Math.max(0, side.distance - 0.25);
    }
    const pose = followPose(head, this.yaw, this.pitch, shoulder);
    let back = pose.back;
    let dist = this.camDistance;
    if (this.cameraTargets.length) {
      const cast = (b: THREE.Vector3) => {
        this.ray.set(pose.pivot, b);
        this.ray.far = this.camDistance + FOLLOW.clearance;
        return castCamera(this.ray, this.cameraTargets, this.blockerTargets).map((h) => ({ distance: h.distance, cameraOnly: this.blockerTargets.has(h.object) }));
      };
      // Under a camera-only blocker (a hanging sign box, a low cap) the boom slides lower before the camera is pulled in.
      ({ back, distance: dist } = this.blockerTargets.size ? followBoom(this.camDistance, pose.back, cast) : { back: pose.back, distance: followDistance(this.camDistance, cast(pose.back)) });
      // Squeezed under the comfortable distance (a shaft wall behind, a slab above): look over the shoulder from
      // higher up if some raised boom clears it (at most FOLLOW.raiseSteps raise casts + 1 recast = 6 extra rays, none when open).
      const wantedRaise = constrainedPitch(this.camDistance, back, dist, cast, this.raiseScratch);
      this.boomRaise = easeRaise(this.boomRaise, wantedRaise, dt, snap);
      if (this.boomRaise > 0) {
        back = raisedBack(back, this.boomRaise, this.raisedBoom);
        dist = followDistance(this.camDistance, cast(back));
      }
    }
    const desired = pose.pivot.clone().addScaledVector(back, dist);
    this.camera.position.lerp(desired, snap || this.reducedMotion ? 1 : 1 - Math.exp(-dt * 10));
    // The smoothed position, not only the target, stays below camera-only blockers.
    if (this.blockerTargets.size) keepBelowBlockers(pose.pivot, this.camera.position, [...this.blockerTargets], FOLLOW.clearance, this.ray);
    this.camera.lookAt(pose.target);
    // A camera crowding the walker dithers the body out (uniform only); the contact shadow and shadow pass are untouched.
    const fade = avatarFade(this.camera.position.distanceTo(pose.pivot));
    this.avatarRig?.setFade(fade);
    this.composer?.setAvatarFade(this.avatarRig?.root ?? null, fade);
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
    this.occluderResize?.disconnect();
    this.occluderResize = null;
    this.removeAudioUnlock();
    this.disconnectStationAudio();
    void this.audio?.context.close();
    this.audio = null;
    this.renderer.setAnimationLoop(null);
    this.releaseStationCaches(null);
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

/**
 * The faces a label ray can hit in mesh-local space, as three's material.side. The renderer flips
 * gl.frontFace for a mirrored matrixWorld, so local winding decides the side there; `mirrored` swaps
 * the sides for a mirrored transform it does not offset (an instance matrix).
 */
function cullOf(material: THREE.Material, mirrored = false): Cull {
  if (material.side === THREE.DoubleSide) return "both";
  return (material.side === THREE.BackSide) !== mirrored ? "back-only" : "front-only";
}

/** Still attached under `scene` (a mesh removed from the station no longer occludes). */
function inScene(mesh: THREE.Object3D, scene: THREE.Scene): boolean {
  let o: THREE.Object3D = mesh;
  while (o.parent) o = o.parent;
  return o === scene;
}

/** Rendered at all for this camera (the mesh and its ancestors visible, on a camera layer). */
function meshDrawn(mesh: THREE.Mesh, camera: THREE.Camera): boolean {
  if (!mesh.layers.test(camera.layers)) return false;
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Drawn as filled, opaque enough surfaces (clear or transmissive glass and wireframes are not). */
function blocksView(material: THREE.Material): boolean {
  const m = material as THREE.MeshPhysicalMaterial;
  return m.visible && m.colorWrite && !m.wireframe && !(m.transparent && m.opacity < 0.5) && (m.transmission ?? 0) < 0.5;
}

/** A pure Aabb (see overviewFraming.ts) as a three Box3; null stays null. */
function toBox3(a: { min: THREE.Vector3; max: THREE.Vector3 } | null): THREE.Box3 | null {
  return a ? new THREE.Box3(a.min.clone(), a.max.clone()) : null;
}
