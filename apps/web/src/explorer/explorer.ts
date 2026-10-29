import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LightProbeGenerator } from "three/examples/jsm/lights/LightProbeGenerator.js";
import { ASSET_SCHEME, fencedUrlResolver, stationDir } from "./assetFence.ts";
import { enuToRenderer } from "@gteki/geo";
import type { Router, PolylinePoint, RouteStep } from "@gteki/navigation";
import { DEFAULT_PROFILE, nodeDisplayZ } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import { WALKER_BODY, WALKER_SPEED, glbPrimitivePlugin, seeThroughMeshes } from "@gteki/scene-api";
import type { LoadedStation } from "../registry.ts";
import { loadSignFont } from "../signFont.ts";
import { R, chevronTexture, dashTexture, ribbonGeometry } from "./geometry.ts";
import { floorProbe, unmodelledRuns } from "./routeGaps.ts";
import { buildConnectors, withinGreyboxBudget } from "./greyboxConnectors.ts";
import { buildGreybox, splitWallsAtOpenings, unmodelledRunsByEdge, type Box, type GreyboxStats } from "./greybox.ts";
import { greyboxPathSegments, greyboxSceneProbes, insideGreyboxOpening, nearGreybox, routeUsesGreybox, type GreyboxSegment } from "./greyboxScene.ts";
import { darkSampleDistances, routeGroundCounts, sceneMeshNear } from "./routeGroundQa.ts";
import { bodyBlock, hitNormal, slideAlong, type BodyBlock } from "./bodyCollision.ts";
import { CameraCut } from "./cameraCut.ts";
import { manifestScene, type LoadedAsset } from "./manifestScene.ts";
import { castAll, castCamera, cuttableSigns, explorerTargets } from "./raycast.ts";
import { DEFAULT_GUIDE_TIER, guideOnStairs, pacedDistance, type GuideTierId, type PaceSpan } from "./guidePace.ts";
import { advanceGuide, seekGuideState } from "./guideStops.ts";
import { PostFx, qaPostFxSettings } from "./postfx.ts";
import { applyBakedAo, type BakedAoCounts } from "./bakedAo.ts";
import { resolveLighting, type LightingEnv } from "./lighting.ts";
import { FOLLOW, FOV, NO_SLOPE, SLOPE, approachBoom, approachFov, avatarFade, boomSqueezed, descentAimDrop, easeRaise, fadeHold, followDistance, followPose, patchCameraHold, solveRaisedBoom, stepAvatarFade, stepSlope, targetFov, type CameraHold, type SlopeState } from "./followCamera.ts";
import { OverviewLook } from "./overviewLook.ts";
import { CAMERA_FAR_M, OVERVIEW_MIN_VIEWPORT_SHARE, OVERVIEW_OFFSET, boxCorners, extentShare, frameBounds, freeArea, overviewFar, pointsBounds, routablePoints, screenBox, type ViewRect } from "./overviewFraming.ts";
import { declutter, estimateLabelBox, labelClass, revealedUnmeasured, type DeclutterItem, type LabelClass } from "./labelDeclutter.ts";
import { collectIdentityBoards, identityBoardObjects, identityFront, identityNameBehind, identityNameCentre, identityNameCorners, identityNameSamples, identityRegionRect, intersectsRect, protectIdentityChip, withinObject, type IdentityBoard, type ScreenRect } from "./identityBoards.ts";
import { IDENTITY_RANGE_M, LOOK_PITCH, identityFraming } from "./identityFraming.ts";
import { StationCaches } from "./stationCaches.ts";
import { STREET, STREET_SURFACE_FLAG, StreetBackdrop, atStreetTop, footingLevel, isOutdoors, roleOf } from "./streetBackdrop.ts";
import { createAvatarRig, type AvatarSelection } from "./avatarSelection.ts";
import { avatarMotion } from "./avatarMotion.ts";
import { contactShadow } from "./contactShadow.ts";
import { followShadow, type FollowShadowInfo } from "./followShadow.ts";
import { SHADOW_HALF_EXTENT_M, SHADOW_MAP_SIZE, SHADOW_NORMAL_BIAS, SHADOW_RADIUS, applyStationShadows, needsCasterRetune, setCasters, shadowFitRange, type ShadowCandidate } from "./shadows.ts";
import { buildGraphView, type GraphView } from "./graphView.ts";
import { Input } from "./input.ts";
import { headingFromYaw } from "./pose.ts";
import { DEFAULT_GROUND, acceptGround, angleDelta, cumulativeLengths, resolveWalls, samplePolyline, wallToRenderer, type Segment2 } from "./walker.ts";
import { OcclusionSweep, SIGN_BACKDROP_M, labelState, onFocusFloor, type LabelOcclusion, type LabelState } from "./labelVisibility.ts";
import { TriangleBvh, segmentHitsBox, type Cull } from "./triangleBvh.ts";
import { cacheBvh, currentBvh, prepareRayTrees } from "./meshBvh.ts";
import { occludedLineStyle, type OccludedLineStyle } from "./occludedLine.ts";
import { BLOOM_HEADROOM, OVERLAY_INPUT_MIN, compensate, linearToSrgb, type Vec3 } from "./toneComp.ts";

export type ExplorerMode = "overview" | "walk" | "guide";

export interface ExplorerPose { east: number; north: number; up: number; headingDeg: number; mode: ExplorerMode }

export interface ExplorerOptions { avatarGlbUrl?: string }

/** The walker-following sun shadow's fixed inputs (set at attach) and what it currently holds. */
interface ShadowFit {
  /** World Y span of the station's drawn meshes, padded. */
  yRange: [number, number];
  /** Walking half-extent of the frustum. */
  walkHalf: number;
  /** Casting candidates (fixed at attach), how many cast now, and the floor Y that mask was computed at (NaN: never). */
  candidates: ShadowCandidate[];
  /** Candidates taller than TALL_CANDIDATE_SPAN_M (merged meshes spanning several levels); a diagnostic. */
  tallCandidates: number;
  casters: number;
  castFloorY: number;
  receivers: number;
  /** "follow": the frustum tracks the walker; "off": overview, sun not casting (fit untouched); null: not fitted yet. */
  fitted: "follow" | "off" | null;
  /** Pinned focus and floor Y (QA harness) instead of the walker's position and feet. */
  focus: THREE.Vector3 | null;
  floorY: number | null;
}

export interface ExplorerEvents {
  onMode?(mode: ExplorerMode): void;
  onGreyboxLegend?(visible: boolean): void;
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
/** Let the initial station identity framing remain readable before guide yaw steering resumes. */
const IDENTITY_HOLD_S = 4;
/** The guide hold stops following the framed board once the look would turn this far from the route heading. */
const IDENTITY_TRACK_MAX_RAD = THREE.MathUtils.degToRad(100);
/** Instanced meshes with more instances than this occlude only as registered proxies. */
const MAX_OCCLUDER_INSTANCES = 1024;
/** The phone layout's breakpoint (CSS px) in styles.css (`@media (max-width: 720px)`); #109 uses it for framing. */
const PHONE_MAX_PX = 720;

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

/** The chevron texture's dominant texel colour, linear (geometry.ts chevronTexture default). */
const CHEVRON = new THREE.Color(0x5ef0ff);

/** A `toneMapped: false` overlay: authored (uncompensated) colour, its map's texel colour, and the display sRGB it should show. */
interface OverlayTint { mat: THREE.MeshBasicMaterial | THREE.LineBasicMaterial; authored: THREE.Color; texel: THREE.Color; target: Vec3 }

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
  occluded: LabelOcclusion;
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
  identityHidden: boolean;
  identityOffsetY: number;
}

export class Explorer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV.overview, 1, 0.05, CAMERA_FAR_M);
  private readonly labels = new CSS2DRenderer();
  private readonly orbit: OrbitControls;
  private composer: PostFx | null = null;
  private readonly overviewLook = new OverviewLook();
  /** Vertical-speed detection plus explicit guide stair/escalator spans; widens the follow lens (see targetFov). */
  private slope: SlopeState = NO_SLOPE;
  /** Extra downward aim while descending; the boom and ordinary pose stay unchanged. */
  private descentDrop = 0;
  /** The boom is squeezed under its comfortable distance (walls, ceilings); also widens the follow lens (see boomSqueezed). */
  private squeezed = false;
  private slopeY = 0;
  private readonly street = new StreetBackdrop();
  /** Render height of the station's street floor when it is an underground (scene-lit) station, else null. */
  private streetY: number | null = null;
  /** Set by each discrete placement (walkFrom, startGuide, seekGuide); consumed by the next frame outside overview. */
  private teleported = false;
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
  private readonly qaSignBounds = new THREE.Box3();
  private readonly qaSignExpanded = new THREE.Box3();
  private qaSignCount = 0;
  private qaSignInside = false;
  private qaSignNearestName = "";
  private qaSignNearestGap = Infinity;

  private station: LoadedStation | null = null;
  private stationScene: StationScene | null = null;
  private greybox: ReturnType<typeof buildGreybox> | null = null;
  private connectors: ReturnType<typeof buildConnectors> | null = null;
  private greyboxOpenings: Box[] = [];
  private sceneColliderTargets = new Set<THREE.Object3D>();
  private greyboxSegments: GreyboxSegment[] = [];
  private greyboxLegendVisible = false;
  private sceneGroundTargets: THREE.Object3D[] = [];
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
  /** All camera surfaces collide from both sides, independent of source winding. Rebuilt with the targets. */
  private cameraSides: ReadonlySet<THREE.Object3D> = new Set();
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
  private bakedAo: BakedAoCounts = { materials: 0, scaled: 0, disabled: 0, textureBytes: 0 };
  /** Manifest assets as loaded (tier variant and uri); empty for scene-module stations, which load their own GLBs. */
  private loadedAssets: LoadedAsset[] = [];
  private readonly cameraCut = new CameraCut();
  private routeTexture: THREE.CanvasTexture | null = null;
  private routeLines: OccludedLineStyle | null = null;
  /** Shared by every route's "no model" bands; kept for the explorer's lifetime. */
  private noModelTexture: THREE.CanvasTexture | null = null;
  /** QA hook state: the start/destination beacons follow it, including across route recomputes. */
  private routeMarkersVisible = true;
  /** `toneMapped: false` overlays whose colour is pre-compensated for the high tier's OutputPass (see applyOverlayTone). */
  private overlayTints: OverlayTint[] = [];
  /** Max modelled display error (0..255) over the compensated overlays; null on the low tier or with no overlays. */
  private overlayResidual: number | null = null;

  private readonly avatar = new THREE.Group();
  private avatarRig: AvatarSelection | null = null;
  /** Where the body faces (it turns toward travel; the camera keeps `yaw`). */
  private bodyYaw = 0;
  private readonly lastAvatarPos = new THREE.Vector3();
  /** Core hemisphere + sun; hidden when a scene declares `environment.lighting: "scene"`. */
  private readonly coreLights: THREE.Light[] = [];
  private hemi: THREE.HemisphereLight | null = null;
  /** PMREM of RoomEnvironment, built lazily on first use: `scene.environment` on the high tier, the avatar's envMap in scene lighting. */
  private coreEnvMap: THREE.Texture | null = null;
  /** Low tier: SH probe baked from the same RoomEnvironment. It replaces `scene.environment` (diffuse only) and is hidden until baked. */
  private readonly envProbe = new THREE.LightProbe();
  private probeBake: "idle" | "baking" | "ready" | "failed" = "idle";
  /** What the latest lighting plan wants, read when the async bake resolves so a station switch in between wins. */
  private probeWanted = false;
  private lighting: "default" | "scene" = "default";
  private sun: THREE.DirectionalLight | null = null;
  /**
   * The walker-following sun shadow (high tier, default lighting, a station attached); null leaves the sun's
   * default ±150 m frustum. `fitted` is what the frustum currently holds, so overview can switch it off without losing the follow fit.
   */
  private shadowFit: ShadowFit | null = null;
  private readonly shadowOut: FollowShadowInfo = { texelM: 0, near: 0, far: 0, centre: new THREE.Vector3() };
  private bloomThreshold = resolveLighting().bloomThreshold;
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
  private boomActual = 0;
  private cameraFade = 1;
  /** Set when the follow camera resumes after the overview: the fade left from before it is stale, so it snaps once. */
  private fadeStale = false;
  /** Empty/null until the QA hooks are explicitly called. */
  private qaCamera: CameraHold = {};
  private qaCameraSnap = false;
  private qaAvatarFade: number | null = null;
  private firstPerson = false;
  private mode: ExplorerMode = "overview";
  private guide: { pts: THREE.Vector3[]; cum: number[]; steps: number[]; s: number; paused: boolean; stops: { s: number; index: number }[]; holding: boolean; spans: readonly PaceSpan[] } | null = null;
  /** Every stop of the running guide (`guide.stops` is consumed as they are reached; a seek restores the ones still ahead). */
  private guideAllStops: { s: number; index: number }[] = [];
  private guideIdentityHoldS = 0;
  /** The framed board's name centre, and the framed look's offset from that board's bearing: the hold keeps the board in view. */
  private readonly guideIdentityCentre = new THREE.Vector3();
  private readonly guideIdentityOffset = { yaw: 0, pitch: 0 };
  private readonly identityHead = new THREE.Vector3();
  private readonly identityToward = new THREE.Vector3();
  /** The user's guide speed tier; kept across instruction changes and later guides. */
  private tier: GuideTierId = DEFAULT_GUIDE_TIER;
  private poiLabels: PoiLabel[] = [];
  private readonly labelSweep = new OcclusionSweep();
  private occluders: Occluder[] = [];
  /** The walker's and follow camera's ray targets (castTargets), fixed at load like them. */
  private proxies = new Set<THREE.Object3D>();
  private labelSweepDoneAt = -Infinity;
  /** Scratch for a label's world position each frame. */
  private readonly labelAt = new THREE.Vector3();
  /** The station's sign meshes (see-through role, not solid): a label they alone block hides instead of fading. */
  private signMeshes: ReadonlySet<THREE.Object3D> = new Set();
  private identityBoards: IdentityBoard[] = [];
  /** Consumed by the first successful walker placement, including when no board qualifies. */
  private identityPlaced = false;
  private identityLabelsDirty = true;
  private labelMode: ExplorerMode | null = null;
  private labelCamFov = NaN;
  private labelCamAspect = NaN;
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
  /** The route sheet: a full-width bottom sheet on a phone, so the overview keeps clear of it there (#385). */
  private sheetEl: HTMLElement | null = null;
  private minimapEl: HTMLElement | null = null;
  /** Refits the overview when an occluder's size changes: the panel collapsing, the credit line wrapping. */
  private occluderResize: ResizeObserver | null = null;
  private quality: "low" | "high";
  /** Why the station's own scene could not be shown (L0 fallback is in use), if any. */
  sceneError: string | null = null;
  private disposed = false;

  constructor(private readonly host: HTMLElement, private readonly events: ExplorerEvents = {}, options: ExplorerOptions = {}) {
    this.quality = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700 ? "low" : "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === "high" ? 2 : 1.5));
    // Set before any material compiles. The high tier's OutputPass reads it; the low tier tone-maps in the material shaders.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = resolveLighting().toneMappingExposure;
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
    this.envProbe.visible = false;
    this.scene.add(this.world, this.overlays, this.avatar, this.street.group, this.envProbe);
    this.overlays.add(this.routeGroup, this.poiGroup);
    this.buildAvatar(options.avatarGlbUrl);
    this.defaultEnvironment();
    this.applyLighting();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get currentMode(): ExplorerMode {
    return this.mode;
  }

  /** Follow-camera diagnostics for the QA hook. Angles are radians, distances metres. */
  cameraInfo(): { fov: number; far: number; slopeOn: boolean; boomWanted: number; boomActual: number; raise: number; pitch: number; yaw: number; avatarFade: number; reflections: boolean; mode: ExplorerMode } {
    return {
      fov: this.camera.fov, far: this.camera.far, slopeOn: this.slope.on,
      boomWanted: this.camDistance, boomActual: this.boomActual, raise: this.boomRaise,
      pitch: this.pitch, yaw: this.yaw, avatarFade: this.cameraFade,
      reflections: this.composer?.settings.reflections ?? false, mode: this.mode,
    };
  }

  /** QA-only: hold supplied controls across guide steering/input; null releases all held controls. */
  setCamera(patch: CameraHold | null): void {
    this.qaCamera = patchCameraHold(this.qaCamera, patch);
    this.qaCameraSnap = patch !== null;
  }

  /** QA-only: hold the shared body/postprocessing fade; null restores the automatic value. */
  holdAvatarFade(value: number | null): void {
    this.qaAvatarFade = fadeHold(value);
    this.applyAvatarFade(0, true);
  }

  private applyAvatarFade(dt: number, snap: boolean): void {
    this.cameraFade = this.qaAvatarFade ?? stepAvatarFade(this.cameraFade, avatarFade(this.boomActual), dt, snap || this.fadeStale || this.reducedMotion);
    this.fadeStale = false;
    this.avatarRig?.setFade(this.cameraFade);
    this.composer?.setAvatarFade(this.avatarRig?.root ?? null, this.cameraFade);
  }

  get qualityLevel(): "low" | "high" {
    return this.quality;
  }

  /** Bounding boxes (renderer frame) for automated visual sanity checks. */
  sceneInfo(): { greybox: (GreyboxStats & { connectors: { escalator: number; stairs: number } }) | null; world: number[]; route: number[]; routeChildren: number; walkable: number; colliders: number; cameraBlockers: number; seeThrough: number; rayTrees: { trees: number; triangles: number; bytes: number; buildMs: number }; camera: number[]; fov: number; far: number; aspect: number; mode: ExplorerMode; lighting: "default" | "scene"; coreLightsOn: number; environment: "envMap" | "probe" | null; environmentIntensity: number | null; exposure: number; overlayToneResidual: number | null; bakedAo: BakedAoCounts; assets: LoadedAsset[]; street: { active: boolean; opacity: number }; shadows: { following: boolean; fit: "follow" | "off" | null; texelM: number; halfExtent: number; casters: number; candidates: number; tallCandidates: number; receivers: number } } {
    const box = (o: THREE.Object3D) => { const b = new THREE.Box3().setFromObject(o); return b.isEmpty() ? [] : [...b.min.toArray(), ...b.max.toArray()].map((v) => Math.round(v * 10) / 10); };
    return {
      greybox: this.greybox ? { ...this.greybox.stats, overBudget: this.connectors?.stats.overBudget ?? this.greybox.stats.overBudget, connectors: this.connectors?.stats.connectors ?? { escalator: 0, stairs: 0 } } : null, world: box(this.world), route: box(this.routeGroup), routeChildren: this.routeGroup.children.length,
      walkable: this.walkable.length, colliders: this.colliders.length, cameraBlockers: this.cameraBlockers.length, seeThrough: this.seeThrough.length,
      rayTrees: { ...this.rayTrees, buildMs: Math.round(this.rayTrees.buildMs * 10) / 10 },
      bakedAo: { ...this.bakedAo }, assets: this.loadedAssets.map((a) => ({ ...a })),
      camera: this.camera.position.toArray().map((v) => Math.round(v * 10) / 10), fov: Math.round(this.camera.fov * 100) / 100, far: this.camera.far, aspect: Math.round(this.camera.aspect * 1000) / 1000, mode: this.mode,
      lighting: this.lighting, coreLightsOn: this.coreLights.filter((l) => l.visible).length,
      environment: this.envProbe.visible ? "probe" : this.scene.environment ? "envMap" : null,
      environmentIntensity: this.envProbe.visible || this.scene.environment ? this.scene.environmentIntensity : null, exposure: this.renderer.toneMappingExposure, overlayToneResidual: this.overlayResidual === null ? null : Math.round(this.overlayResidual * 100) / 100,
      street: { active: this.street.active, opacity: Math.round(this.street.opacity * 1000) / 1000 },
      shadows: { following: this.shadowFit !== null, fit: this.shadowFit?.fitted ?? null, texelM: this.shadowFit?.fitted === "follow" ? this.shadowOut.texelM : 0, halfExtent: this.shadowFit?.walkHalf ?? 0, casters: this.shadowFit?.casters ?? 0, candidates: this.shadowFit?.candidates.length ?? 0, tallCandidates: this.shadowFit?.tallCandidates ?? 0, receivers: this.shadowFit?.receivers ?? 0 },
    };
  }

  /** QA probe: project station-ENU points to canvas CSS pixels with the camera as last rendered. `behind`: not in front of the camera. */
  projectEnu(points: { x: number; y: number; z: number }[]): { x: number; y: number; behind: boolean }[] {
    this.camera.updateMatrixWorld();
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    return points.map((p) => {
      const world = R(p.x, p.y, p.z);
      const behind = world.clone().applyMatrix4(this.camera.matrixWorldInverse).z >= 0;
      const v = world.project(this.camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind };
    });
  }

  /** QA probe: face sizes recorded by the sign builder (empty when the station has no signs). */
  signFaces(): unknown[] {
    const out: unknown[] = [];
    this.scene.traverse((o) => {
      const faces = o.userData?.faces;
      if (o.userData?.gteki_role === "sign" && Array.isArray(faces)) out.push(...faces);
    });
    return out;
  }

  /** Live recognition-proxy evidence in page CSS pixels; no renderer or label state is changed. */
  identity(): { id: string; inFrame: boolean; frontFacing: boolean; facingDeg: number; nameRect: ScreenRect | null; nameHeightPx: number | null; coveredByChip: boolean; occluded: LabelOcclusion }[] {
    this.camera.updateMatrixWorld();
    this.refreshOccluders();
    const host = this.host.getBoundingClientRect();
    const { w, h } = this.viewSize;
    return this.identityBoards.map((board) => {
      board.object.updateWorldMatrix(true, false);
      const centre = identityNameCentre(board);
      const facing = THREE.MathUtils.clamp(identityFront(board).dot(this.camera.position.clone().sub(centre).normalize()), -1, 1);
      const visible = inScene(board.object, this.scene) && objectVisible(board.object);
      const rects = board.regions.map((region) => ({ kind: region.kind, rect: visible ? identityRegionRect(region.box, board.object, this.camera, w, h) : null }));
      const names = rects.filter((r) => r.kind === "name");
      const visibleNames = names.flatMap((r) => r.rect ? [r.rect] : []);
      const name = visibleNames.length ? {
        x0: Math.min(...visibleNames.map((r) => r.x0)), y0: Math.min(...visibleNames.map((r) => r.y0)),
        x1: Math.max(...visibleNames.map((r) => r.x1)), y1: Math.max(...visibleNames.map((r) => r.y1)),
      } : null;
      const pageRect = (r: ScreenRect): ScreenRect => ({ x0: r.x0 + host.left, y0: r.y0 + host.top, x1: r.x1 + host.left, y1: r.y1 + host.top });
      const coveredByChip = this.poiLabels.some((l) => {
        if (!l.obj.visible || l.obj.element.style.display === "none") return false;
        const chip = l.obj.element.getBoundingClientRect();
        if (!chip.width || !chip.height) return false;
        return rects.some((r) => r.rect && intersectsRect(pageRect(r.rect), { x0: chip.left, y0: chip.top, x1: chip.right, y1: chip.bottom }));
      });
      // A name corner behind the camera projects to a meaningless rect; report no size then.
      const inFrame = !identityNameBehind(board, this.camera) &&
        names.length === visibleNames.length && name !== null && name.x0 >= 0 && name.y0 >= 0 && name.x1 <= w && name.y1 <= h;
      return {
        id: board.object.name || board.object.uuid,
        inFrame,
        frontFacing: facing > 0.2, facingDeg: THREE.MathUtils.radToDeg(Math.acos(facing)),
        nameRect: inFrame && name ? pageRect(name) : null, nameHeightPx: inFrame && name ? name.y1 - name.y0 : null, coveredByChip,
        occluded: this.identityOccluded(identityNameSamples(board, this.camera.getWorldPosition(new THREE.Vector3())), identityBoardObjects(board, this.identityBoards)),
      };
    });
  }

  /**
   * Identity occlusion over the name rect: the centre ray decides, else a majority (3 of 4) of the inset
   * corner rays; among the rays that block, geometry beats sign. Each ray stops at the name's visible face.
   */
  private identityOccluded(samples: readonly THREE.Vector3[], ignore: readonly THREE.Object3D[]): LabelOcclusion {
    const at = (p: THREE.Vector3) => this.labelOccluded({ obj: { getWorldPosition: (target) => target.copy(p) }, occluded: "none" }, { ignore, segmentOnly: true });
    const centre = at(samples[0]!);
    if (centre !== "none") return centre;
    const corners = samples.slice(1).map(at).filter((r) => r !== "none");
    if (corners.length < 3) return "none";
    return corners.includes("geometry") ? "geometry" : "sign";
  }

  /**
   * Whether the camera actually sees the board's name face. Only a visible board reserves room on screen;
   * one behind a wall must not displace POI chips that the user can read (#342).
   */
  private identityBoardVisible(board: IdentityBoard): boolean {
    return this.identityOccluded(identityNameSamples(board, this.camera.getWorldPosition(new THREE.Vector3())), identityBoardObjects(board, this.identityBoards)) === "none";
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
   * after the fit: the fit sizes the same network points). `viewportShare` is the same larger side over
   * the VIEWPORT's shorter side — #109's acceptance measure: on an occluded phone the fit deliberately
   * reaches past the free band, so `extentShare` then reads over 1 while `viewportShare` stays at half.
   * `fitShare` is the share of the AABB of those points, which is what the fit is fed; its 8 corners
   * project outside a diagonal point band, so it can read larger than `extentShare`. `visibleRect` is
   * that free area itself (page CSS px, so it excludes the panel and the credit strip), so a spec can
   * check `bbox` lies outside both. Null outside overview or without a routable network.
   */
  overviewFrame(): { extentShare: number; viewportShare: number; fitShare: number | null; bbox: { x0: number; y0: number; x1: number; y1: number }; visibleRect: { x: number; y: number; w: number; h: number } } | null {
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
      viewportShare: extentShare(net, w, h),
      fitShare: fit ? extentShare(fit, free.w, free.h) : null,
      bbox: { x0: net.x0 + at.left, y0: net.y0 + at.top, x1: net.x1 + at.left, y1: net.y1 + at.top },
      visibleRect: { x: free.x + at.left, y: free.y + at.top, w: free.w, h: free.h },
    };
  }

  /** Avatar position in station ENU (a virtual position, never the user's real location). */
  get avatarEnu(): { x: number; y: number; z: number } {
    return { x: this.pos.x, y: -this.pos.z, z: this.pos.y };
  }

  /** Read-only walker pose for 2D HUD overlays (ENU metres, body heading clockwise from north). Null before a station loads. */
  getPose(): ExplorerPose | null {
    if (!this.station) return null;
    const { x, y, z } = this.avatarEnu;
    return { east: x, north: y, up: z, headingDeg: headingFromYaw(this.bodyYaw), mode: this.mode };
  }

  private defaultEnvironment(): void {
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 60, 420);
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a1e26, resolveLighting().hemiIntensity);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.castShadow = this.quality === "high";
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    sun.shadow.radius = SHADOW_RADIUS;
    sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun = sun;
    this.resetSun();
    this.scene.add(hemi, sun);
    this.coreLights.push(hemi, sun);
  }

  /** The sun as the L0 graph view (and any scene-lit or low-tier station) has it: one fixed ±150 m shadow frustum. */
  private resetSun(): void {
    const sun = this.sun;
    if (!sun) return;
    sun.position.set(40, 120, 60);
    sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 0.5, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  /**
   * Sets cast/receive on the station's drawn meshes (shadows.ts) and, if any take part, starts the sun's shadow
   * following the walker over the station's floor-to-roof height. Once per attach; `updateShadows` does the per-frame fit.
   * `focus` and `floorY` pin the frustum and the caster floor to a point instead of the walker (the QA harness has none).
   */
  private attachShadows(root: THREE.Object3D, focus: THREE.Vector3 | null = null, halfExtentM = SHADOW_HALF_EXTENT_M, floorY: number | null = focus ? focus.y : null): { casters: number; receivers: number } {
    this.shadowFit = null;
    // The caster mask is applied at attach (shadows.ts), with the walker's feet: no frame has the ceilings casting.
    const feetY = floorY ?? this.pos.y;
    const r = applyStationShadows(root, this.quality, this.lighting, feetY);
    const yRange = shadowFitRange(r.bounds);
    // Nothing to fit (no drawn geometry), or a non-finite box (a mesh with NaN positions): following it would throw every frame.
    if (!yRange) return r;
    this.shadowFit = { yRange, candidates: r.candidates, tallCandidates: r.tallCandidates, casters: r.casters, castFloorY: feetY, receivers: r.receivers, fitted: null, walkHalf: halfExtentM, focus, floorY };
    return r;
  }

  /**
   * QA harness only (apps/web/qa/look.ts): shadows for `root` outside any loaded station, framed on `focus`
   * in place of the walker. Same policy and frustum as a station; returns the cast/receive counts.
   */
  devShadows(root: THREE.Object3D, focus: THREE.Vector3, halfExtentM = SHADOW_HALF_EXTENT_M, floorY = focus.y): { casters: number; receivers: number } {
    return this.attachShadows(root, focus.clone(), halfExtentM, floorY);
  }

  /**
   * Per frame: keep the sun's shadow frustum on the walker (or the pinned focus), texel-snapped and allocation-free.
   * Overview renders no sun shadows: a 300 m half-extent at 2048 px is ~29 cm texels, and the cutaway removes
   * geometry only from the colour pass, so cut geometry would still cast into the slice. It clears the caster mask
   * rather than the sun's castShadow, which is in three's lights hash and would recompile every material on each
   * switch (mesh castShadow is not); leaving overview recomputes the mask and the next frame refits.
   */
  private updateShadows(): void {
    if (!this.sun) return;
    const f = this.shadowFit;
    if (!f) return;
    if (this.mode === "overview") {
      if (f.fitted !== "off") { f.casters = setCasters(f.candidates, -Infinity); f.castFloorY = NaN; f.fitted = "off"; }
      return;
    }
    // Only geometry starting below the walker's head casts (shadows.ts). Recomputed on a floor change, not per frame.
    const floorY = f.floorY ?? this.pos.y; // pos is the feet
    // A non-finite feet Y would retune the mask to "nothing casts" every frame; skip the frame instead.
    if (!Number.isFinite(floorY)) return;
    if (needsCasterRetune(floorY, f.castFloorY)) { f.castFloorY = floorY; f.casters = setCasters(f.candidates, floorY); }
    f.fitted = "follow";
    const at = f.focus ?? this.pos;
    // followShadow throws on a non-finite target; skip the frame rather than throw every frame.
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return;
    followShadow(this.sun, at, f.walkHalf, SHADOW_MAP_SIZE, f.yRange, this.shadowOut);
  }

  /**
   * Applies `resolveLighting(env)`. "scene": the station's baked/own lights are the only scene lights (no
   * double lighting of lightmaps) and `scene.environment` stays unset unless the station sets `envIntensity`.
   * Three.js lights cannot be masked per object, so the avatar then keeps a per-material environment map.
   * Called with no env for the L0 graph view, which gets default lighting.
   */
  private applyLighting(env?: LightingEnv): void {
    const plan = resolveLighting(env, this.quality);
    this.lighting = plan.mode;
    for (const l of this.coreLights) l.visible = plan.coreLights;
    if (this.hemi) this.hemi.intensity = plan.hemiIntensity;
    this.renderer.toneMappingExposure = plan.toneMappingExposure;
    this.bloomThreshold = plan.bloomThreshold;
    this.composer?.setBloomThreshold(plan.bloomThreshold);
    this.applyOverlayTone();
    // The PMREM is only built when something samples it: the high tier's scene.environment, or a scene-lit station's avatar.
    const envMap = plan.environmentVia === "envMap" || plan.avatarEnvMap ? this.coreEnv() : null;
    this.scene.environment = plan.environmentVia === "envMap" ? envMap : null;
    this.scene.environmentIntensity = plan.environmentIntensity;
    this.probeWanted = plan.environmentVia === "probe";
    this.envProbe.intensity = plan.environmentIntensity;
    this.envProbe.visible = this.probeWanted && this.probeBake === "ready";
    if (this.probeWanted && this.probeBake === "idle") this.bakeEnvProbe();
    this.avatarRig?.setEnvMap(plan.avatarEnvMap ? envMap : null);
  }

  private coreEnv(): THREE.Texture {
    if (!this.coreEnvMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.coreEnvMap = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    }
    return this.coreEnvMap;
  }

  /**
   * Low tier: bakes `envProbe` once from RoomEnvironment (one tiny cube render, then an async readback; ~ms). Tries a
   * HalfFloat target first because the room's light boxes exceed 1.0 and a byte target would clip them, then Float, then bytes;
   * a readback that throws or comes back black is skipped. Until it resolves the station is lit without the environment;
   * on resolve the probe shows only if the current plan still wants it. A failed bake leaves the probe off for good.
   */
  private bakeEnvProbe(): void {
    this.probeBake = "baking";
    void (async () => {
      const room = new RoomEnvironment();
      try {
        for (const type of [THREE.HalfFloatType, THREE.FloatType, THREE.UnsignedByteType]) {
          if (this.disposed) return;
          const target = new THREE.WebGLCubeRenderTarget(PROBE_FACE_PX, { type });
          try {
            new THREE.CubeCamera(0.1, 100, target).update(this.renderer, room);
            const baked = await LightProbeGenerator.fromCubeRenderTarget(this.renderer, target);
            const dc = baked.sh.coefficients[0]?.toArray().reduce((a, v) => a + v, 0) ?? 0;
            if (this.disposed || !(dc > 0) || !Number.isFinite(dc)) continue;
            this.envProbe.sh.copy(baked.sh);
            this.probeBake = "ready";
            this.envProbe.visible = this.probeWanted;
            return;
          } catch { /* unreadable on this GPU: try the next type */ } finally { target.dispose(); }
        }
        this.probeBake = "failed";
      } finally { room.dispose(); }
    })();
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.applyOverlayTone();
  }

  /** Tracks `mat` (a `toneMapped: false` overlay) so the high tier can pre-compensate its colour; `texel` is the map's dominant colour. */
  private trackOverlay<M extends THREE.MeshBasicMaterial | THREE.LineBasicMaterial>(mat: M, texel?: THREE.Color): M {
    const authored = mat.color.clone();
    const tex = texel ?? new THREE.Color(1, 1, 1);
    // What the overlay should read as on screen: authored colour x map texel, in display sRGB.
    const target = [authored.r * tex.r, authored.g * tex.g, authored.b * tex.b].map(linearToSrgb) as Vec3;
    this.overlayTints.push({ mat, authored, texel: tex, target });
    this.applyOverlayTone();
    return mat;
  }

  /**
   * High tier only: OutputPass AgX-tone-maps and grades the whole frame, `toneMapped: false` or not, which
   * desaturates the overlays. Writes into each material the linear colour whose pipeline output is its authored
   * display colour (toneComp.ts). Always derived from the stored authored colour, never from the current one, so
   * repeated calls do not compound; the low tier honours `toneMapped: false`, so there it restores the authored colours.
   * A mapped overlay (the route ribbon) gets compensated / texel per channel: exact for the texel colour only.
   * Each colour's luma is capped below the bloom threshold (a lit overlay must not glow); the cap follows the lighting plan.
   * Runs on exposure/composer/plan changes and route creation, never per frame.
   */
  private applyOverlayTone(): void {
    const comp = this.composer;
    let worst = 0;
    for (const t of this.overlayTints) {
      if (!comp) { t.mat.color.copy(t.authored); continue; }
      const c = compensate(t.target, this.renderer.toneMappingExposure, { grade: comp.settings.grade, min: OVERLAY_INPUT_MIN, maxLuma: BLOOM_HEADROOM * this.bloomThreshold });
      t.mat.color.setRGB(c.linear[0] / Math.max(t.texel.r, 1e-3), c.linear[1] / Math.max(t.texel.g, 1e-3), c.linear[2] / Math.max(t.texel.b, 1e-3));
      worst = Math.max(worst, c.residual);
    }
    this.overlayResidual = comp && this.overlayTints.length > 0 ? worst : null;
  }

  /** Built once: the composer only references this explorer's scene and camera, so stations reuse it. */
  private setupComposer(): void {
    if (this.composer || this.quality !== "high") return;
    this.composer = new PostFx(this.renderer, this.scene, this.camera, qaPostFxSettings(location.search));
    this.composer.setBloomThreshold(this.bloomThreshold);
    this.applyOverlayTone();
  }

  private buildAvatar(glbUrl?: string): void {
    this.avatarRig = createAvatarRig({ quality: this.quality, glbUrl });
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
  cancelPendingLoad(nextId: string): void {
    this.loadGeneration++;
    this.releaseStationCaches(nextId);
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
    void this.avatarRig?.loadGlb();
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
      this.applyLighting(env);
      const streets = station.bundle.floors.filter((f) => f.ordinal === 0 && !f.intermediate);
      this.streetY = env?.lighting === "scene" && streets.length ? Math.max(...streets.map((f) => f.renderElevationM)) : null;
      this.streetTops = station.bundle.nodes
        .filter((n) => streets.some((f) => f.id === n.floorId))
        .map((n) => R(n.position.x, n.position.y, nodeDisplayZ(n, streets.find((f) => f.id === n.floorId)).z));
      this.stationScene.root.updateMatrixWorld(true);
      this.street.attach(this.stationScene.root);
      this.world.updateMatrixWorld(true);
      const originalTargets = explorerTargets(this.walkable, this.colliders, this.cameraBlockers);
      prepareRayTrees(originalTargets.camera);
      this.sceneGroundTargets = originalTargets.ground;
      const scene = greyboxSceneProbes(originalTargets.collider, this.walls);
      const probe = floorProbe(new THREE.Raycaster(), originalTargets.ground, true);
      const floorCache = new Map<string, boolean>();
      const hasFloor = (p: { x: number; y: number; z: number }) => {
        const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
        let value = floorCache.get(key);
        if (value === undefined) { value = probe(p); floorCache.set(key, value); }
        return value;
      };
      const traversable = (edge: StationBundle["edges"][number]) => router.isTraversable(edge, DEFAULT_PROFILE);
      this.greybox = buildGreybox(bundle, traversable, hasFloor, scene, this.quality);
      this.greyboxSegments = greyboxPathSegments(unmodelledRunsByEdge(bundle, traversable, hasFloor));
      this.greyboxOpenings = this.greybox.openings;
      this.sceneColliderTargets = new Set(originalTargets.collider);
      this.world.add(this.greybox.root);
      this.walkable = [...this.walkable, ...this.greybox.walkable];
      this.colliders = [...this.colliders, ...this.greybox.colliders];
      this.connectors = buildConnectors(bundle, traversable, { hasFloor, nearMesh: (p, radius) => sceneMeshNear([this.stationScene!.root], p, radius) }, this.quality);
      withinGreyboxBudget(this.greybox.stats, this.connectors.stats, this.quality);
      this.world.add(this.connectors.root);
      this.walkable = [...this.walkable, ...this.connectors.walkable];
      this.colliders = [...this.colliders, ...this.connectors.colliders];
      this.walls = splitWallsAtOpenings([...this.walls, ...this.greybox.wallSegments, ...this.connectors.wallSegments], this.greyboxOpenings);
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
    this.cameraSides = new Set(targets.camera);
    this.blockerTargets = targets.blockers;
    // Every ray target is in the camera set (walls, floors, blockers); trees are built here, never mid-frame.
    this.rayTrees = prepareRayTrees(targets.camera);
    if (this.stationScene) {
      // A sign that stands, or sits under a listed group, among the walkable/collider/camera targets is never cut:
      // a mesh that is both a sign and a camera blocker stops the camera and stays solid.
      const signs = cuttableSigns(seeThroughMeshes(this.stationScene.root), [this.walkable, this.colliders, this.cameraBlockers, this.cameraTargets]);
      this.seeThrough = this.cameraCut.apply(this.stationScene.root, signs);
      this.signMeshes = new Set(signs);
      this.identityBoards = collectIdentityBoards(this.stationScene.root);
      // After the cut: shadows read the materials as they will be drawn. Frustum fit runs in the next step().
      this.attachShadows(this.stationScene.root);
    }
    this.buildOccluders(this.stationScene?.root ?? this.graph.root);
    // Baked aoMaps (kit GLBs and stations' own): per-tier intensity, once per attach (idempotent per material).
    this.bakedAo = this.stationScene ? applyBakedAo(this.stationScene.root, this.quality) : { materials: 0, scaled: 0, disabled: 0, textureBytes: 0 };
    this.loadedAssets = [];
    this.stationScene?.root.traverse((o) => { if (o.userData.gtekiAsset) this.loadedAssets.push(o.userData.gtekiAsset as LoadedAsset); });
    this.phase = "composer";
    this.setupComposer();
    this.frameAll();
    this.overviewLook.set(this.scene, this.world, this.mode === "overview");
    this.phase = "ready";
    return true;
  }

  private async buildStationScene(station: LoadedStation, ctx: SceneContext): Promise<StationScene | null> {
    if (station.sceneImportError) throw new Error(`scene module failed to load: ${station.sceneImportError}`);
    await loadSignFont();
    if (station.scene) return await station.scene.buildScene(ctx);
    const assets = station.bundle.assets ?? [];
    if (assets.length === 0) return null;
    // No scene module: load manifest GLBs and classify by gteki_role.
    return await manifestScene(assets, ctx);
  }

  private clearStation(): void {
    this.avatarRig?.cancelPendingLoad();
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
    if (this.greybox) {
      this.world.remove(this.greybox.root);
      const materials = new Set<THREE.Material>();
      this.greybox.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      });
      for (const material of materials) material.dispose();
      this.greybox = null;
    }
    if (this.connectors) {
      this.world.remove(this.connectors.root);
      const materials = new Set<THREE.Material>(), meshes = new Set<THREE.Mesh>();
      const dispose = (object: THREE.Object3D) => { const mesh = object as THREE.Mesh; if (!mesh.isMesh || meshes.has(mesh)) return; meshes.add(mesh); mesh.geometry.dispose(); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material); };
      this.connectors.root.traverse(dispose);
      for (const object of [...this.connectors.walkable, ...this.connectors.colliders]) object.traverse(dispose);
      for (const material of materials) material.dispose();
      this.connectors = null;
    }
    this.greyboxOpenings = [];
    this.sceneColliderTargets = new Set();
    this.greyboxSegments = [];
    this.sceneGroundTargets = [];
    this.updateGreyboxLegend();
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
    this.cameraSides = new Set();
    this.skyTargets = [];
    this.blockerTargets = new Set();
    this.rayTrees = { trees: 0, triangles: 0, bytes: 0, buildMs: 0 };
    this.walls = [];
    this.seeThrough = [];
    this.signMeshes = new Set();
    this.identityBoards = [];
    this.identityPlaced = false;
    this.identityLabelsDirty = true;
    this.cameraCut.clear();
    this.occluders = [];
    this.proxies.clear();
    this.loadedAssets = [];
    this.shadowFit = null;
    this.resetSun();
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 60, 420);
    this.applyLighting();
  }

  setGraphOverlay(visible: boolean): void {
    if (this.graph && this.stationScene) this.graph.overlay.visible = visible;
  }

  get graphOverlayOn(): boolean {
    return Boolean(this.graph && this.stationScene && this.graph.overlay.visible);
  }

  /**
   * Frame a box (default: the routable slice, else the station scene without the street surfaces it
   * draws) in overview mode, so it fills about OVERVIEW_FILL of the viewport's shorter side (see
   * overviewFraming.ts). The viewing direction is kept; a resize refits until the user moves the camera.
   */
  frameAll(box?: THREE.Box3): void {
    const b = (box ?? this.routableBox ?? this.contextBox()).clone();
    if (b.isEmpty()) b.set(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(50, 10, 50));
    this.setMode("overview");
    this.framed = b;
    this.framedPts = box ? null : this.routablePts;
    this.camera.near = 0.1;
    this.fitOverview();
  }

  /**
   * Bounds of the station scene without the street surfaces it draws itself (#109): those describe the
   * roads around the station (hundreds of metres across here), so framing them would shrink the station
   * into a speck on the routeless fallback. Objects carrying STREET_SURFACE_FLAG are skipped whole.
   */
  private contextBox(): THREE.Box3 {
    const box = new THREE.Box3();
    this.world.updateMatrixWorld(true);
    const visit = (o: THREE.Object3D): void => {
      if (o.userData[STREET_SURFACE_FLAG] === true) return;
      // Per object, the maths Box3.setFromObject does: the geometry's bounds through the world matrix, or
      // an InstancedMesh's own bounds over every instance (an instance can sit outside its geometry's box).
      // Only the walk differs — a flagged subtree is skipped instead of added to the union.
      const instanced = o as THREE.InstancedMesh;
      const geometry = (o as Partial<THREE.Mesh>).geometry;
      if (instanced.isInstancedMesh) {
        if (!instanced.boundingBox) instanced.computeBoundingBox();
        if (instanced.boundingBox) box.union(instanced.boundingBox.clone().applyMatrix4(o.matrixWorld));
      } else if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox) box.union(geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
      for (const c of o.children) visit(c);
    };
    visit(this.world);
    return box;
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

  /**
   * Name the route sheet. On a phone it opens as a bottom sheet spanning the canvas width, so the overview
   * must keep clear of it (#385); a desktop sheet is a left column narrower than the canvas and is ignored,
   * and while it is closed (or transparent in walk/guide) it blocks nothing. A resize of it refits too.
   */
  setSheet(el: HTMLElement | null): void {
    this.sheetEl = el;
    this.watchOccluders();
    this.refitOverview();
  }

  /** Name the top-right minimap occluder; hidden maps leave the canvas free. */
  setMinimap(el: HTMLElement | null): void {
    this.minimapEl = el;
    this.watchOccluders();
    this.refitOverview();
  }

  /** Observe the occluders on one observer, so size changes refit through the same path. */
  private watchOccluders(): void {
    this.occluderResize?.disconnect();
    this.occluderResize = null;
    const els = [this.panelEl, this.creditEl, this.sheetEl, this.minimapEl].filter((e): e is HTMLElement => e !== null);
    if (els.length === 0 || typeof ResizeObserver === "undefined") return;
    this.occluderResize = new ResizeObserver(() => this.refitOverview());
    for (const e of els) this.occluderResize.observe(e);
  }

  /** Re-measure the occluders and refit an automatic overview (never a camera the user has moved). */
  refitOverview(): void {
    if (this.mode === "overview" && this.framed) this.fitOverview();
  }

  /**
   * The canvas area no UI covers (CSS px, canvas-relative): panel, the bottom band (credit line and the
   * phone's open route sheet) and minimap. Their page rects are measured here, on a resize or an occluder
   * change — never per frame.
   */
  private freeRect(): ViewRect {
    const { w, h } = this.viewSize;
    const el = this.panelEl;
    // display:none (walk/guide on a phone), a collapsed element or none at all leaves the canvas free.
    const measured = el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
    const cornerRect = this.minimapEl && this.minimapEl.getClientRects().length > 0 ? this.minimapEl.getBoundingClientRect() : null;
    const host = (measured || this.creditEl || this.sheetEl || cornerRect) ? this.host.getBoundingClientRect() : null;
    const panel = measured && host ? { x: measured.left - host.left, y: measured.top - host.top, w: measured.width, h: measured.height } : null;
    const corner = cornerRect && host ? { x: cornerRect.left - host.left, y: cornerRect.top - host.top, w: cornerRect.width, h: cornerRect.height } : null;
    // Both are full-width bands along the same canvas bottom: the taller one sets where the free area ends.
    const bottom = Math.max(this.creditInset(host), this.sheetInset(host));
    return freeArea({ w, h }, panel, bottom, corner);
  }

  /** The canvas-bottom band the credit line blocks (CSS px): it spans the width, so only its top edge counts. */
  private creditInset(host: DOMRect | null): number {
    const el = this.creditEl;
    if (!host || !el || el.getClientRects().length === 0) return 0;
    const p = el.getBoundingClientRect();
    return Math.min(this.viewSize.h, Math.max(0, host.bottom - Math.max(host.top, p.top)));
  }

  /**
   * The canvas-bottom band the route sheet blocks (CSS px), by the same rule as the credit line. Only an open
   * sheet in overview counts (walk and guide hide it), and only when it spans the canvas width — the phone's
   * bottom sheet. A desktop sheet is a narrow left column, so desktop framing is unchanged.
   */
  private sheetInset(host: DOMRect | null): number {
    const el = this.sheetEl;
    if (!host || !el || this.mode !== "overview" || el.getClientRects().length === 0) return 0;
    const p = el.getBoundingClientRect();
    // 1 px of slack for sub-pixel layout: left:0/right:0 still rounds to the canvas width.
    if (p.width < host.width - 1) return 0;
    return Math.min(this.viewSize.h, Math.max(0, host.bottom - Math.max(host.top, p.top)));
  }

  /** Put the camera on the fit of `framed` for the current aspect, inside the panel-free area. */
  private fitOverview(): void {
    if (!this.framed) return;
    const { w, h } = this.viewSize;
    const free = this.freeRect();
    // #109: with the panel or the open route card covering a phone, the free band is short and the plain
    // fill leaves the station at 0.26 of the viewport's shorter side. There, keep at least half of it.
    const share = w <= PHONE_MAX_PX && (free.w < w || free.h < h) ? OVERVIEW_MIN_VIEWPORT_SHARE : 0;
    const pose = frameBounds(
      this.framed,
      { fovDeg: this.camera.fov, aspect: this.camera.aspect, near: this.camera.near, viewport: { w, h }, free, points: this.framedPts ?? undefined, minViewportShare: share },
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
    this.guideIdentityHoldS = 0;
    if (this.mode === "overview") this.fadeStale = true;
    this.mode = mode;
    this.labelSweepDoneAt = -Infinity;
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
    if (mode === "overview") { this.street.restore(this.scene); this.setFov(FOV.overview, true); }
    this.overviewLook.set(this.scene, this.world, mode === "overview");
    this.events.onMode?.(mode);
    this.updateGreyboxLegend();
  }

  get firstPersonOn(): boolean {
    return this.firstPerson;
  }

  toggleFirstPerson(): boolean {
    this.firstPerson = !this.firstPerson;
    this.avatar.visible = this.mode !== "overview" && !this.firstPerson;
    return this.firstPerson;
  }

  /** Initial placement only: camera look changes, never the body heading or subsequent seeks. */
  private frameInitialIdentity(guideHeading?: number): boolean {
    if (this.identityPlaced) return false;
    this.identityPlaced = true;
    const head = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    // Signs stay transparent to this placement probe, including solid sign materials.
    const signs = new Set(this.stationScene ? seeThroughMeshes(this.stationScene.root) : []);
    const boards = this.identityBoards.filter((b) => inScene(b.object, this.scene) && objectVisible(b.object)).map((board) => {
      board.object.updateWorldMatrix(true, false);
      const centre = identityNameCentre(board);
      const targets = this.cameraTargets.filter((o) => !signs.has(o) && !withinObject(o, board.object));
      const visible = (from: THREE.Vector3, to: THREE.Vector3): boolean => {
        const direction = to.clone().sub(from);
        this.ray.set(from, direction.clone().normalize());
        this.ray.near = 0;
        this.ray.far = Math.max(0, direction.length() - 0.05);
        return castAll(this.ray, targets).length === 0;
      };
      return { centre, front: identityFront(board), nameCorners: identityNameCorners(board), blocked: head.distanceTo(centre) > IDENTITY_RANGE_M || !visible(head, centre), visible };
    });
    if (boards.length === 0) return false;
    const { w, h } = this.viewSize;
    const free = this.freeRect();
    const ndcFree = { x0: 2 * free.x / w - 1, x1: 2 * (free.x + free.w) / w - 1, y0: 1 - 2 * (free.y + free.h) / h, y1: 1 - 2 * free.y / h };
    const look = identityFraming(head, this.yaw, this.pitch, boards, this.camera.aspect, FOV.follow, guideHeading, ndcFree);
    if (!look) return false;
    this.yaw = look.yaw;
    this.pitch = look.pitch;
    // The framed look lands as a snap on the next frame: the camera and slope must not pan from the old pose.
    this.teleported = true;
    const toward = look.centre.clone().sub(head);
    this.guideIdentityCentre.copy(look.centre);
    this.guideIdentityOffset.yaw = angleDelta(Math.atan2(-toward.x, -toward.z), look.yaw);
    this.guideIdentityOffset.pitch = look.pitch - Math.atan2(toward.y, Math.hypot(toward.x, toward.z));
    return true;
  }

  /** Start free walking at a station ENU point (nearest walkable ground below/above it). */
  walkFrom(enu: { x: number; y: number; z: number }, headingDeg = 0): boolean {
    const p = R(enu.x, enu.y, enu.z);
    const ground = this.groundAt(p.x, p.y + 1.5, p.z, 4);
    if (ground === null) return false;
    this.pos.set(p.x, ground, p.z);
    this.teleported = true;
    this.yaw = (-headingDeg * Math.PI) / 180;
    // The avatar appears at the new spot facing the new heading (no run blend from the old one).
    this.lastAvatarPos.copy(this.pos);
    this.bodyYaw = this.yaw;
    this.stopGuide();
    this.setMode("walk");
    this.frameInitialIdentity();
    return true;
  }

  walkFromNode(bundle: StationBundle, nodeId: string, headingDeg: number): boolean {
    const n = bundle.nodes.find((x) => x.id === nodeId);
    if (!n) return false;
    const z = nodeDisplayZ(n, bundle.floors.find((f) => f.id === n.floorId)).z;
    return this.walkFrom({ x: n.position.x, y: n.position.y, z }, headingDeg);
  }

  private groundAt(x: number, fromY: number, z: number, maxDrop: number): number | null {
    if (this.walkable.length === 0) return null;
    this.ray.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = maxDrop;
    const hit = castAll(this.ray, this.groundTargets)[0];
    return hit ? hit.point.y : null;
  }

  /** QA for the current route: the same ground ray used by the walker, plus connector and image checks. */
  routeGroundCheck(polyline: readonly PolylinePoint[], steps: readonly RouteStep[], guideStopsM: readonly number[] = []) {
    const roots = [this.stationScene?.root, this.greybox?.root, this.connectors?.root].filter((root): root is THREE.Object3D => Boolean(root));
    const counts = routeGroundCounts(polyline, (p) => this.groundAt(p.x, p.y + DEFAULT_GROUND.stepUp + 0.05, p.z, DEFAULT_GROUND.stepUp + DEFAULT_GROUND.stepDown + 0.1), steps, this.station?.bundle ?? null, (p, radius, edgeId) => sceneMeshNear(roots, p, radius, edgeId));
    return { ...counts, darkShare: async (stops?: readonly number[]): Promise<number> => {
      const points = polyline.map((p) => R(p.x, p.y, p.z));
      if (points.length < 2) return 0;
      const cum = cumulativeLengths(points), total = cum.at(-1)!;
      const positions = darkSampleDistances(total, stops ?? guideStopsM);
      const cameraPosition = this.camera.position.clone(), cameraRotation = this.camera.quaternion.clone(), cameraFov = this.camera.fov;
      const avatarPosition = this.avatar.position.clone(), avatarVisible = this.avatar.visible;
      const gl = this.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const x = Math.floor(width * 0.2), y = Math.floor(height * 0.2), w = Math.max(1, Math.floor(width * 0.6)), h = Math.max(1, Math.floor(height * 0.6));
      const pixels = new Uint8Array(w * h * 4);
      let dark = 0, count = 0;
      const overview = this.mode === "overview";
      const xray = this.routeGroup.getObjectByName("route-xray");
      const xrayVisible = xray?.visible;
      try {
        if (overview) {
          this.overviewLook.set(this.scene, this.world, false);
          this.graph?.setXray(false); this.routeLines?.setXray(false);
          if (xray) xray.visible = false;
        }
        this.avatar.visible = true;
        this.camera.fov = FOV.follow; this.camera.updateProjectionMatrix();
        for (const distance of positions) {
          const p = samplePolyline(points, cum, distance);
          const head = new THREE.Vector3(p.x, p.y + EYE, p.z);
          const direction = p.tx || p.tz ? new THREE.Vector3(p.tx, 0, p.tz).normalize() : new THREE.Vector3(0, 0, -1);
          this.avatar.position.set(p.x, p.y, p.z);
          const cameraOffset = direction.clone().multiplyScalar(-this.camDistance).add(new THREE.Vector3(0, 0.3, 0));
          const length = cameraOffset.length();
          this.ray.set(head, cameraOffset.clone().divideScalar(length)); this.ray.far = length;
          const hit = castCamera(this.ray, this.cameraTargets, this.cameraSides)[0];
          this.camera.position.copy(head).addScaledVector(cameraOffset, hit ? Math.max(0, hit.distance - FOLLOW.clearance) / length : 1);
          this.camera.lookAt(head.clone().add(direction)); this.camera.updateMatrixWorld();
          if (this.composer) this.composer.render(0); else this.renderer.render(this.scene, this.camera);
          gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (let i = 0; i < pixels.length; i += 4) {
            if ((0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255 < 0.06) dark++;
            count++;
          }
        }
      } finally {
        if (overview) {
          this.overviewLook.set(this.scene, this.world, true);
          this.graph?.setXray(true); this.routeLines?.setXray(true);
          if (xray && xrayVisible !== undefined) xray.visible = xrayVisible;
        }
        this.avatar.position.copy(avatarPosition); this.avatar.visible = avatarVisible;
        this.camera.position.copy(cameraPosition); this.camera.quaternion.copy(cameraRotation); this.camera.fov = cameraFov;
        this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
        if (this.composer) this.composer.render(0); else this.renderer.render(this.scene, this.camera);
      }
      return count ? dark / count : 0;
    } };
  }

  /** The collider surface that stops the walker's body going from `from` to `to`, or null when the move is free. */
  private blockedByColliders(from: THREE.Vector3, to: THREE.Vector3): BodyBlock | null {
    if (this.colliders.length === 0) return null;
    return bodyBlock(from, to, (origin, dir, far) => {
      this.ray.set(origin, dir);
      this.ray.far = far;
      const hit = castAll(this.ray, this.colliderTargets).find((h) => {
        if (h.object.userData.greybox || !h.face) return true;
        const normal = hitNormal(h, dir);
        return !this.greyboxOpenings.some((box) => this.sceneColliderTargets.has(h.object) && insideGreyboxOpening(h.point, box) && Math.abs(normal.y) <= 0.5);
      });
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
    const mat = this.trackOverlay(new THREE.MeshBasicMaterial({ map: this.routeTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), CHEVRON);
    const ribbon = new THREE.Mesh(ribbonGeometry(pts, 1.1, 0.07), mat);
    ribbon.renderOrder = 5;
    // Depth-tested glow plus a faint dashed pass where a wall hides it; overview keeps the always-on-top look.
    this.routeLines = occludedLineStyle(0x5ef0ff, 0.9);
    this.trackOverlay(this.routeLines.visible);
    this.trackOverlay(this.routeLines.occluded);
    this.routeLines.setXray(this.mode === "overview");
    const glow = this.routeLines.lines(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.12, 0)))), 6);
    // Symbolic (unknown) heights are drawn dashed above the ribbon so they read as approximate.
    const symbolic = polyline.some((p) => !p.zKnown);
    // X-ray copy so the route stays readable through ceilings/slabs in overview.
    const xrayMat = this.trackOverlay(new THREE.MeshBasicMaterial({ map: this.routeTexture, color: 0xb8f8ff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), CHEVRON);
    const xray = new THREE.Mesh(ribbon.geometry, xrayMat);
    xray.renderOrder = 20;
    xray.name = "route-xray";
    xray.visible = this.mode === "overview";
    this.routeGroup.add(ribbon, ...glow, xray);
    // Stretches with no scene floor under them (the graph runs through space the scene doesn't model):
    // an always-on-top dashed amber band, so they read as "not modelled" rather than as a route in the void.
    const routeGround = this.stationScene ? this.sceneGroundTargets : this.groundTargets;
    const gaps = routeGround.length === 0 ? [] : unmodelledRuns(polyline, floorProbe(this.ray, routeGround));
    if (gaps.length > 0) {
      this.noModelTexture ??= dashTexture();
      this.noModelTexture.repeat.set(1 / 1.6, 1);
      const gapMat = this.trackOverlay(new THREE.MeshBasicMaterial({ map: this.noModelTexture, color: 0xffb547, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      for (const run of gaps) {
        const band = new THREE.Mesh(ribbonGeometry(run.map((p) => R(p.x, p.y, p.z)), 0.5, 0.15), gapMat);
        band.renderOrder = 21;
        band.name = "route-no-model";
        this.routeGroup.add(band);
      }
    }
    this.routeGroup.add(this.beacon(pts[0]!, 0x7dffa0, 2.2), this.beacon(pts[pts.length - 1]!, 0xffc857, 5));
    this.routeGroup.userData = { symbolicHeights: symbolic, noModelRuns: gaps.length, greybox: routeUsesGreybox(polyline, this.greyboxSegments) };
    this.updateGreyboxLegend();
  }

  private beacon(at: THREE.Vector3, color: number, height: number): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, height, 20, 1, true), this.trackOverlay(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.FrontSide, toneMapped: false })));
    col.position.y = height / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 40).rotateX(-Math.PI / 2), this.trackOverlay(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false })));
    ring.position.y = 0.08;
    g.add(col, ring);
    g.position.copy(at);
    g.userData = { pulse: ring, routeMarker: true };
    g.visible = this.routeMarkersVisible;
    return g;
  }

  /** QA hook: show or hide the route's start/destination beacons; the route and guidance are untouched. */
  setRouteMarkersVisible(visible: boolean): void {
    this.routeMarkersVisible = visible;
    for (const g of this.routeGroup.children) if (g.userData.routeMarker) g.visible = visible;
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
    this.overlayTints = [];
    this.overlayResidual = null;
    this.routeGroup.userData = {};
    this.updateGreyboxLegend();
  }

  private updateGreyboxLegend(): void {
    const visible = Boolean(this.routeGroup.userData.greybox) || (this.mode === "overview" && this.greyboxSegments.length > 0) || (this.mode === "walk" && nearGreybox(this.pos, this.greyboxSegments, 15));
    if (visible !== this.greyboxLegendVisible) {
      this.greyboxLegendVisible = visible;
      this.events.onGreyboxLegend?.(visible);
    }
  }

  /** Floating labels at each POI's verified entrance (or display position when search-only). */
  showPois(bundle: StationBundle, label: (poi: Poi) => string, selected: string[] = []): void {
    // Rebuilt labels keep their last occlusion result until re-checked, so they do not flash.
    const wasOccluded = new Map(this.poiLabels.map((l) => [l.poiId, l.occluded]));
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
      this.poiLabels.push({ poiId: poi.id, obj, groundY: at.y, selected: isSelected, occluded: wasOccluded.get(poi.id) ?? "none", state: "shown", decluttered: false, klass: labelClass(isSelected, poi.category), routable: Boolean(node), size: null, measureTries: 0, identityHidden: false, identityOffsetY: 0 });
    }
    this.poiGroup.updateMatrixWorld(true);
    this.identityLabelsDirty = true;
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
    const camMoved = cam.position.distanceToSquared(this.labelCamPos) > 1e-4 || cam.quaternion.angleTo(this.labelCamQuat) > 1e-3 || cam.fov !== this.labelCamFov || cam.aspect !== this.labelCamAspect || this.labelMode !== this.mode;
    if (camMoved) {
      this.labelCamPos.copy(cam.position);
      this.labelCamQuat.copy(cam.quaternion);
      this.labelMode = this.mode;
      this.labelCamFov = cam.fov;
      this.labelCamAspect = cam.aspect;
      this.declutterDirty = true;
    }
    const now = performance.now();
    // The periodic re-check waits LABEL_RECHECK_MS after the previous sweep completed.
    const recheck = camMoved || (!this.labelSweep.pending && now - this.labelSweepDoneAt >= LABEL_RECHECK_MS);
    if (recheck) this.labelSweep.invalidate(labels.length);
    if (recheck || this.identityLabelsDirty) this.updateIdentityLabels();
    if (this.labelSweep.pending) {
      this.refreshOccluders();
      const budget = LABEL_RAYS[this.quality];
      const deadline = now + budget.ms;
      cam.updateMatrixWorld();
      for (let k = 0; k < budget.count && this.labelSweep.pending; k++) {
        const l = labels[this.labelSweep.take(labels.length)]!;
        l.occluded = l.selected ? "none" : this.labelOccluded(l);
        if (performance.now() > deadline) break;
      }
      if (!this.labelSweep.pending) this.labelSweepDoneAt = performance.now();
    }
    const focusY = this.mode === "overview" ? null : this.pos.y;
    for (const l of labels) {
      const distance = this.labelAt.setFromMatrixPosition(l.obj.matrixWorld).distanceTo(cam.position);
      const state = l.identityHidden ? "hidden" : labelState({ occluded: l.occluded, distance, onFocusFloor: onFocusFloor(l.groundY, focusY), selected: l.selected, overview: this.mode === "overview" });
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

  /** CSS2D's transform stays renderer-owned; the separate CSS translate is the chip's pixel offset. */
  private updateIdentityLabels(): void {
    this.identityLabelsDirty = false;
    const { w, h } = this.viewSize;
    this.camera.updateMatrixWorld();
    const regions: ScreenRect[] = [];
    if (this.identityBoards.length) {
      // Visibility rays read occluder bounds: bring them current even when no POI sweep is pending.
      this.refreshOccluders();
      for (const board of this.identityBoards) {
        if (!inScene(board.object, this.scene) || !objectVisible(board.object)) continue;
        board.object.updateWorldMatrix(true, false);
        // A name that faces away is not readable, so it reserves no screen (#400).
        if (identityFront(board).dot(this.camera.position.clone().sub(identityNameCentre(board))) <= 0) continue;
        const rects = board.regions.map((region) => identityRegionRect(region.box, board.object, this.camera, w, h)).filter((r): r is ScreenRect => r !== null);
        // A board no ray reaches still projects a rect, but it protects empty screen: skip it (#342).
        if (!rects.length || !this.identityBoardVisible(board)) continue;
        regions.push(...rects);
      }
    }
    regions.sort((a, b) => a.y0 - b.y0);
    // Measure unmeasured labels in one read-only batch before changing any chip's translate.
    if (regions.length) for (const l of this.poiLabels) {
      const el = l.obj.element;
      if (l.size || !el.isConnected || el.style.display === "none") continue;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w > 0 && h > 0) l.size = { w, h };
    }
    for (const l of this.poiLabels) {
      const el = l.obj.element;
      if (!regions.length) {
        if (l.identityHidden) l.identityHidden = false;
        if (l.identityOffsetY) { l.identityOffsetY = 0; el.style.translate = ""; }
        continue;
      }
      if (!l.size && l.measureTries++ < MEASURE_TRIES) this.identityLabelsDirty = true;
      const size = l.size ?? estimateLabelBox(el.textContent ?? "");
      const p = l.obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
      const x = (p.x + 1) * w / 2, y = (1 - p.y) * h / 2;
      const chip = { x0: x - size.w / 2, x1: x + size.w / 2, y0: y - size.h / 2, y1: y + size.h / 2 };
      const result = Math.abs(p.z) <= 1 ? protectIdentityChip(chip, l.selected, regions, h) : { hidden: false, offsetY: 0 };
      if (l.identityHidden !== result.hidden) l.identityHidden = result.hidden;
      if (l.identityOffsetY !== result.offsetY) {
        l.identityOffsetY = result.offsetY;
        el.style.translate = result.offsetY ? `0 ${result.offsetY}px` : "";
      }
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
      // The chip is drawn nudged off identity boards, so declutter must use where it actually lands.
      // The chip is drawn nudged off identity boards, so declutter must use where it actually lands.
      const x = (p.x * 0.5 + 0.5) * vw, y = (-p.y * 0.5 + 0.5) * vh + l.identityOffsetY;
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

  /**
   * What blocks the camera's view of `label`: "geometry" when any non-sign occluder does, "sign" when only
   * signs do, including a backdrop within SIGN_BACKDROP_M behind the anchor or inside its 0.3 m margin,
   * else "none". Identity probes only the name rect (`identityOccluded`), stopping at its visible face,
   * and ignores all faces of the same board.
   */
  private labelOccluded(label: { obj: Pick<THREE.Object3D, "getWorldPosition">; occluded: LabelOcclusion }, options: { ignore?: readonly THREE.Object3D[]; segmentOnly?: boolean } = {}): LabelOcclusion {
    if (this.occluders.length === 0) return "none";
    const at = label.obj.getWorldPosition(new THREE.Vector3());
    // Labels behind the camera or past its far plane are hidden by the CSS2D renderer; keep their last
    // result. One whose anchor is just off the screen's side can still show part of its text, so it counts.
    if (Math.abs(at.clone().project(this.camera).z) > 1) return label.occluded;
    const from = this.camera.getWorldPosition(new THREE.Vector3());
    const dist = from.distanceTo(at);
    if (dist < (options.segmentOnly ? 1e-6 : 0.5)) return "none";
    // POI geometry stops short of its anchor; identity probes the full camera-to-name segment.
    const margin = options.segmentOnly ? 0 : 0.3;
    const to = at.lerp(from, margin / dist);
    const ray = new THREE.Ray(from, to.clone().sub(from).normalize());
    let far = dist - margin;
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
    let drawn = this.cameraCut.drawnSpans(from, to);
    const blocks = (proxy: boolean, bvh: TriangleBvh, parts: MeshPart[], m: THREE.Matrix4, mirrored = false) =>
      parts.some((p) => (proxy || blocksView(p.material)) && (proxy || !this.cameraCut.cuts(p.material) ? whole : drawn).some(([t0, t1]) => {
        segmentIn(m, t0, t1);
        return bvh.anyHit(a.x, a.y, a.z, d.x, d.y, d.z, proxy ? "both" : cullOf(p.material, mirrored), p.start, p.count);
      }));
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1 && this.signMeshes.size === 0) break;
      if (pass === 1) {
        // POI signs include the backdrop; identity signs stop exactly at the name.
        far = dist + (options.segmentOnly ? 0 : SIGN_BACKDROP_M);
        to.copy(from).addScaledVector(ray.direction, far);
        drawn = this.cameraCut.drawnSpans(from, to);
      }
      for (const o of this.occluders) {
        if (options.ignore?.some((root) => withinObject(o.mesh, root))) continue;
        if (this.signMeshes.has(o.mesh) !== (pass === 1)) continue;
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
          if (blocks(proxy, bvh, parts, toLocal)) return pass === 0 ? "geometry" : "sign";
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
          if (blocks(proxy, bvh, parts, instance.invert().multiply(toLocal), mirrored)) return pass === 0 ? "geometry" : "sign";
        }
      }
    }
    return "none";
  }

  // ---- Guide ---------------------------------------------------------------------

  /**
   * Walk the polyline. `stopAtPoints` are polyline point indices where the guide must stop and pause (waits
   * for opening hours): it never moves past one before being resumed, including several at one spot.
   * `paceSpans` cap speed and carry connector modes for the stair lens (see guidePace.ts).
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
    if (first.tx || first.tz) this.yaw = Math.atan2(-first.tx, -first.tz);
    this.lastAvatarPos.copy(this.pos);
    this.bodyYaw = this.yaw;
    this.setMode("guide");
    this.guideIdentityHoldS = this.frameInitialIdentity(this.yaw) ? IDENTITY_HOLD_S : 0;
  }

  /**
   * Jump the running guide to distance `s` (m) along its path as a teleport: stepGuide places the avatar there and the
   * follow camera snaps with it, as for any placement made while guiding. Pause state is kept. Stops numbered below
   * `firstStop` count as passed; the others (including one at `s`) apply, again if they were reached before.
   */
  seekGuide(s: number, firstStop = 0): void {
    this.guideIdentityHoldS = 0;
    const g = this.guide;
    if (!g) return;
    const total = g.cum[g.cum.length - 1]!;
    seekGuideState(g, this.guideAllStops, total, s, firstStop);
    const p = samplePolyline(g.pts, g.cum, g.s);
    this.pos.set(p.x, p.y, p.z);
    this.teleported = true;
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
    this.guideIdentityHoldS = 0;
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

  /**
   * Walk renderer-space points (x/z, optional y in metres) in the explorer world frame, through normal walk input.
   * A point is reached when its horizontal distance is within 0.35 m and, if it carries `y`, the feet are within 0.6 m of it vertically.
   * stuck: no waypoint advanced and under 0.1 m of 3D displacement over the last second. timedOut: maxSeconds ran out while still moving.
   */
  walkPath(
    points: { x: number; z: number; y?: number }[],
    opts: { speed?: "walk" | "run"; dt?: number; maxSeconds?: number; onStep?: (i: number) => void } = {},
  ): { done: boolean; stuck: boolean; timedOut: boolean; steps: number } {
    if (this.mode !== "walk") return { done: false, stuck: false, timedOut: false, steps: 0 };
    const dt = opts.dt ?? 1 / 60;
    const maxSeconds = opts.maxSeconds ?? 60;
    if (!(dt > 0) || !Number.isFinite(dt) || !(maxSeconds >= 0) || !Number.isFinite(maxSeconds)) {
      throw new RangeError("walkPath dt must be positive and maxSeconds must be non-negative");
    }
    if (points.length === 0) return { done: true, stuck: false, timedOut: false, steps: 0 };
    this.input.virtualKeys.clear();
    const reached = (p: { x: number; z: number; y?: number }): boolean =>
      Math.hypot(p.x - this.pos.x, p.z - this.pos.z) <= 0.35 && (p.y === undefined || Math.abs(this.pos.y - p.y) <= 0.6);
    const checkpointPos = this.pos.clone();
    let point = 0;
    let steps = 0;
    let elapsed = 0;
    let checkpointT = 0;
    let done = false;
    let stuck = false;
    let timedOut = false;
    const maxSteps = Math.floor(maxSeconds / dt + 1e-9);
    const t0 = this.timer.getElapsed();
    // Moves past every waypoint already reached; true once the last one is reached.
    const advance = (): boolean => {
      while (reached(points[point]!)) {
        if (point === points.length - 1) return true;
        point++;
        checkpointT = elapsed;
        checkpointPos.copy(this.pos);
      }
      return false;
    };
    try {
      for (;;) {
        if (advance()) { done = true; break; }
        if (elapsed - checkpointT >= 1 - 1e-9) {
          if (this.pos.distanceTo(checkpointPos) < 0.1) { stuck = true; break; }
          checkpointT = elapsed;
          checkpointPos.copy(this.pos);
        }
        if (steps >= maxSteps) { timedOut = true; break; }
        const target = points[point]!;
        const dx = target.x - this.pos.x;
        const dz = target.z - this.pos.z;
        this.yaw = Math.atan2(-dx, -dz);
        this.input.virtualKeys.add("KeyW");
        if (opts.speed === "run") this.input.virtualKeys.add("ShiftLeft");
        this.step(dt, t0 + elapsed);
        steps++;
        elapsed += dt;
        opts.onStep?.(steps - 1);
      }
    } finally {
      this.input.virtualKeys.clear();
    }
    this.render(dt);
    return { done, stuck, timedOut, steps };
  }

  /**
   * QA sign clearance around the camera, by box distance (not a frustum test). Counts camera blockers and cuttable sign boxes
   * within radiusM horizontally whose top reaches 0.3 m below the camera or higher (hanging signs; floor props are ignored).
   * gapM = box bottom minus camera Y (positive means above the camera). inside = camera within the box grown by near plane + 0.05 m.
   */
  signClearance(radiusM = 6): { nearest: { name: string; gapM: number } | null; inside: boolean; count: number } {
    this.qaSignCount = 0;
    this.qaSignInside = false;
    this.qaSignNearestName = "";
    this.qaSignNearestGap = Infinity;
    const camera = this.camera.position;
    for (const mesh of this.blockerTargets) this.measureSignClearance(mesh, camera, radiusM);
    for (const mesh of this.signMeshes) if (!this.blockerTargets.has(mesh)) this.measureSignClearance(mesh, camera, radiusM);
    return {
      nearest: this.qaSignCount ? { name: this.qaSignNearestName, gapM: this.qaSignNearestGap } : null,
      inside: this.qaSignInside,
      count: this.qaSignCount,
    };
  }

  private measureSignClearance(mesh: THREE.Object3D, camera: THREE.Vector3, radiusM: number): void {
    this.qaSignBounds.setFromObject(mesh);
    const dx = Math.max(this.qaSignBounds.min.x - camera.x, 0, camera.x - this.qaSignBounds.max.x);
    const dz = Math.max(this.qaSignBounds.min.z - camera.z, 0, camera.z - this.qaSignBounds.max.z);
    // Only boxes reaching into the band the near plane can touch when pitched down are clearance; floor-standing props are not.
    if (Math.hypot(dx, dz) > radiusM || this.qaSignBounds.max.y <= camera.y - 0.3) return;
    this.qaSignCount++;
    if (!this.qaSignInside) {
      this.qaSignInside = this.qaSignExpanded.copy(this.qaSignBounds).expandByScalar(this.camera.near + 0.05).containsPoint(camera);
    }
    const gapM = this.qaSignBounds.min.y - camera.y;
    if (gapM < this.qaSignNearestGap) {
      this.qaSignNearestName = mesh.name;
      this.qaSignNearestGap = gapM;
    }
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
    // The camera still holds last frame's pose here (fine for distance culling; see the scene hook contract).
    this.stationScene?.update?.(dt, t, this.camera);

    if (this.mode === "walk") this.stepWalk(dt);
    else if (this.mode === "guide") this.stepGuide(dt);
    else this.orbit.update();
    this.updateGreyboxLegend();

    if (this.mode !== "overview") {
      this.placeCamera(dt, this.teleported);
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
    this.updateShadows();
  }

  private stepWalk(dt: number): void {
    const look = this.input.consumeLook();
    this.yaw -= look.dx * 0.0042;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy * 0.0032, LOOK_PITCH.min, LOOK_PITCH.max);
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
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy * 0.0032, LOOK_PITCH.min, LOOK_PITCH.max);
    const mv = this.input.move();
    if (look.dx || look.dy || look.zoom || mv.x || mv.y) this.guideIdentityHoldS = 0;
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
    // During the hold the look follows the framed board instead of the route; the rest of the frame steers as usual.
    const holdDt = Math.min(dt, this.guideIdentityHoldS);
    const steeringDt = holdDt > 0 && this.trackGuideIdentity(p, holdDt) ? dt - holdDt : dt;
    this.guideIdentityHoldS = Math.max(0, this.guideIdentityHoldS - dt);
    if (p.tx || p.tz) {
      const targetYaw = Math.atan2(-p.tx, -p.tz);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, steeringDt * 4);
    }
    this.yaw -= look.dx * 0.0042;
    const stepIndex = g.steps[Math.min(g.steps.length - 1, p.segment + 1)] ?? -1;
    this.events.onGuideProgress?.({ s: g.s, total, stepIndex, done: g.s >= total && !g.holding });
    if (stopped !== null) this.events.onGuideStop?.(stopped);
  }

  /**
   * Re-aim the guide look at the framed board for `dt` of hold, keeping the framed offset from its bearing. Ends the hold
   * (returns false) when the board is out of range, behind the walker, or would turn the look too far from the route.
   */
  private trackGuideIdentity(p: { tx: number; tz: number }, dt: number): boolean {
    const toward = this.identityToward.copy(this.guideIdentityCentre).sub(this.identityHead.set(this.pos.x, this.pos.y + EYE, this.pos.z));
    const bearingYaw = Math.atan2(-toward.x, -toward.z);
    const bearingPitch = Math.atan2(toward.y, Math.hypot(toward.x, toward.z));
    const targetYaw = bearingYaw + this.guideIdentityOffset.yaw;
    if (toward.length() > IDENTITY_RANGE_M || ((p.tx || p.tz) && this.routeTurnTooFar(p, bearingYaw, targetYaw))) {
      this.guideIdentityHoldS = 0;
      return false;
    }
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 4);
    this.yaw += angleDelta(this.yaw, targetYaw) * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (bearingPitch + this.guideIdentityOffset.pitch - this.pitch) * k, LOOK_PITCH.min, LOOK_PITCH.max);
    return true;
  }

  /** The board is behind the walker, or the tracked look is more than IDENTITY_TRACK_MAX_RAD from the route heading. */
  private routeTurnTooFar(p: { tx: number; tz: number }, bearingYaw: number, targetYaw: number): boolean {
    const routeYaw = Math.atan2(-p.tx, -p.tz);
    return Math.cos(bearingYaw - routeYaw) < 0 || Math.abs(angleDelta(routeYaw, targetYaw)) > IDENTITY_TRACK_MAX_RAD;
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

  /** Move the lens toward `target`; the projection is rebuilt only while the FOV actually changes. */
  private setFov(target: number, snap: boolean, dt = 0): void {
    const next = snap || this.reducedMotion ? target : approachFov(this.camera.fov, target, dt);
    if (next === this.camera.fov) return;
    this.camera.fov = next;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(dt: number, snap = false): void {
    if (this.qaCamera.yaw !== undefined) this.yaw = this.qaCamera.yaw;
    if (this.qaCamera.pitch !== undefined) this.pitch = this.qaCamera.pitch;
    if (this.qaCamera.distance !== undefined) this.camDistance = this.qaCamera.distance;
    snap ||= this.qaCameraSnap;
    this.qaCameraSnap = false;
    // The slope state follows the walker's height; a large one-frame jump, snap, or stopped clock restarts it instead of reading a teleport as a climb.
    const onStairs = this.mode === "guide" && this.guide !== null && guideOnStairs(this.guide.s, this.guide.spans);
    const resetSlope = snap || dt <= 0 || Math.abs(this.pos.y - this.slopeY) > SLOPE.jump;
    this.slope = stepSlope(resetSlope ? NO_SLOPE : this.slope, resetSlope ? 0 : this.pos.y - this.slopeY, resetSlope ? 0 : dt, onStairs);
    this.slopeY = this.pos.y;
    this.descentDrop = this.firstPerson ? 0 : easeRaise(this.descentDrop, descentAimDrop(this.slope), dt, snap || this.reducedMotion);
    const head = this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.firstPerson) {
      this.boomActual = 0;
      this.boomRaise = 0;
      this.applyAvatarFade(dt, snap);
      this.camera.position.copy(head);
      this.camera.lookAt(head.clone().add(dir));
      this.setFov(targetFov(this.mode, this.firstPerson, this.slope.on || this.squeezed), snap, dt);
      return;
    }
    // Over-the-shoulder framing; the pivot itself is pulled in if a wall is closer than the shoulder offset.
    // Signs (visual-only) are never camera targets and never pull the camera in; cameraCut sees through them instead.
    const cameraSides = this.cameraSides;
    let shoulder: number = FOLLOW.shoulder;
    if (this.cameraTargets.length) {
      this.ray.set(head, new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)));
      this.ray.far = FOLLOW.shoulder + 0.25;
      const side = castCamera(this.ray, this.cameraTargets, cameraSides)[0];
      if (side) shoulder = Math.max(0, side.distance - 0.25);
    }
    const pose = followPose(head, this.yaw, this.pitch, shoulder);
    if (this.descentDrop > 0) pose.target.y -= this.descentDrop;
    let back = pose.back;
    let dist = this.camDistance;
    let raisedClear = false;
    if (!this.cameraTargets.length) this.boomRaise = 0;
    const cast = (b: THREE.Vector3, length = this.camDistance) => {
      this.ray.set(pose.pivot, b);
      this.ray.far = length + FOLLOW.clearance;
      return castCamera(this.ray, this.cameraTargets, cameraSides).map((h) => ({ distance: h.distance, cameraOnly: this.blockerTargets.has(h.object) }));
    };
    if (this.cameraTargets.length) {
      const solved = solveRaisedBoom(this.camDistance, pose.back, cast, this.boomRaise, dt, snap || this.reducedMotion);
      // A lip-clearing raise also needs to move the camera now; interpolating from below the slab
      // would recreate the same obstruction even though the target boom has already cleared it.
      raisedClear = solved.raise > this.boomRaise && solved.distance >= Math.min(FOLLOW.comfortDistance, this.camDistance);
      back = solved.back;
      dist = solved.distance;
      this.boomRaise = solved.raise;
    }
    this.squeezed = this.cameraTargets.length
      ? (snap ? dist < FOLLOW.comfortDistance : boomSqueezed(this.squeezed, dist))
      : false;
    this.setFov(targetFov(this.mode, this.firstPerson, this.slope.on || this.squeezed), snap, dt);
    // Use the last frame's actual boom, measured against its own pivot. Measuring the old
    // camera against the new pivot would rate-limit the walker's movement as contraction.
    const previousDistance = this.boomActual;
    const desired = pose.pivot.clone().addScaledVector(back, dist);
    this.camera.position.lerp(desired, snap || this.reducedMotion || raisedClear ? 1 : 1 - Math.exp(-dt * 10));
    // Preserve angular/extension damping, but control contraction separately. Cast the actual interpolated
    // direction as well: a yaw change can sweep a different wall from the solved boom's ray.
    const offset = this.camera.position.clone().sub(pose.pivot);
    const length = offset.length();
    if (length > 1e-9) {
      offset.divideScalar(length);
      const hits = this.cameraTargets.length ? cast(offset, Math.max(length, this.camDistance)) : [];
      const target = Math.min(length, dist, followDistance(this.camDistance, hits));
      const actual = approachBoom(previousDistance, target, hits[0]?.distance ?? null, this.camera.near, dt, snap || this.reducedMotion);
      this.camera.position.copy(pose.pivot).addScaledVector(offset, actual);
    }
    this.camera.lookAt(pose.target);
    // A camera crowding the walker dithers the body out (uniform only); the contact shadow and shadow pass are untouched.
    this.boomActual = this.camera.position.distanceTo(pose.pivot);
    this.applyAvatarFade(dt, snap);
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

/** Face size of the cube the environment probe is baked from: 9 SH coefficients need little more. */
const PROBE_FACE_PX = 32;

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

/** Visibility inherited from groups, also used by tagged identity meshes/groups. */
function objectVisible(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Rendered at all for this camera (the mesh and its ancestors visible, on a camera layer). */
function meshDrawn(mesh: THREE.Mesh, camera: THREE.Camera): boolean {
  if (!mesh.layers.test(camera.layers)) return false;
  return objectVisible(mesh);
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
