/**
 * Headless snapshot of a station's real `buildScene` for the Godot HQ client:
 *   pnpm tsx packages/godot/src/export-scene.ts <stationId> <outDir>
 * writes <outDir>/scene.glb (binary glTF, roles in node extras `gteki_role`) and <outDir>/scene.json (sidecar).
 *
 * Godot implements no station truth: geometry, walls, spawn points and environment all come from the station's
 * own TypeScript. The browser-only pieces of that code run against shims (see headless-dom.ts); every shim the
 * scene relied on, and everything dropped or degraded, is listed in the sidecar `warnings`.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { enuToRenderer } from "@gteki/geo";
import { parseStationFiles } from "@gteki/schema";
import { glbPrimitivePlugin, type SceneContext, type StationScene, type StationSceneModule } from "@gteki/scene-api";
import { headlessThree, installHeadlessDom, newShimUsage, stubRenderer, type ShimUsage } from "./headless-dom.ts";
import { bakeInstancedMeshes, categoryOf, dropDynamicObjects, stripTextures, tagLightmaps, tagSceneRoles, type LightmapInfo, type RoleSummary } from "./scene-roles.ts";

export const SIDECAR_SCHEMA = "gteki.godot-scene/0.1" as const;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface SceneSidecar {
  schema: typeof SIDECAR_SCHEMA;
  stationId: string;
  sourceCommit: string;
  /** True when the working tree differs from sourceCommit. */
  sourceDirty: boolean;
  quality: "high";
  /** ENU metres, exactly as the station's buildScene returned them (Godot maps ENU to (x, z, -y)). */
  walls: StationScene["walls"];
  /** ENU, as returned. */
  spawnPoints: StationScene["spawnPoints"];
  environment: StationScene["environment"];
  counts: Omit<RoleSummary, "warnings">;
  /** Materials in the same order as the GLB material array; null means the source material was unnamed. */
  materials: { index: number; name: string | null }[];
  /** TypeScript-computed renderer-frame values the Godot tests compare against (an oracle, not scene truth). */
  reference: {
    spawnPointsRenderer: [number, number, number][];
    /** First, middle and last wall: endpoints at zMin, renderer frame. */
    wallSamplesRenderer: { index: number; a: [number, number, number]; b: [number, number, number] }[];
    /** World AABB (renderer frame) of all meshes whose exported role is walkable / collider. */
    bounds: { walkable: Bounds | null; collider: Bounds | null };
  };
  /** The scene's baked lightmap, when it has one (three material state recorded before textures are stripped). */
  lightmap?: LightmapInfo;
  /** Everything a shim degraded or the exporter dropped. Empty only if nothing was. */
  warnings: string[];
}

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

function boundsOf(root: THREE.Object3D, behaviour: "walkable" | "collider"): Bounds | null {
  const box = new THREE.Box3();
  root.traverse((o) => {
    const role = (o as THREE.Mesh).isMesh ? o.userData.gteki_role : undefined;
    if (typeof role === "string" && categoryOf(role) === behaviour) box.expandByObject(o, true);
  });
  return box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
}

export interface ExportResult {
  sidecar: SceneSidecar;
  glb: Uint8Array;
  seconds: number;
}

/** Read the canonical material order and names back from GLB's JSON chunk. */
export function materialsFromGlb(glb: ArrayBuffer): { materials: { index: number; name: string | null }[]; duplicates: string[] } {
  const view = new DataView(glb);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("invalid GLB header");
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > view.byteLength) throw new Error("invalid GLB chunk length");
    if (type === 0x4e4f534a) {
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, offset + 8, length))) as { materials?: { name?: unknown }[] };
      const materials = (json.materials ?? []).map((material, index) => ({
        index,
        name: typeof material.name === "string" && material.name.length > 0 ? material.name : null,
      }));
      const counts = new Map<string, number>();
      for (const { name } of materials) if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
      return { materials, duplicates: [...counts].filter(([, count]) => count > 1).map(([name]) => name).sort() };
    }
    offset += 8 + length;
  }
  throw new Error("GLB has no JSON chunk");
}

export function duplicateMaterialWarning(duplicates: string[]): string | null {
  return duplicates.length > 0 ? `duplicate GLB material names: ${duplicates.join(", ")}` : null;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

/** Console warnings GLTFExporter emits while exporting (unsupported materials etc.), de-duplicated. */
async function captureWarnings<T>(run: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
  const seen = new Set<string>();
  const original = console.warn;
  console.warn = (...args: unknown[]) => { seen.add(args.map(String).join(" ")); };
  try {
    return { value: await run(), warnings: [...seen] };
  } finally {
    console.warn = original;
  }
}

export async function exportStationScene(stationId: string): Promise<ExportResult> {
  const started = performance.now();
  const gtekiDir = resolve(REPO, "stations", stationId, "gteki");
  const read = async (name: string) => JSON.parse(await readFile(resolve(gtekiDir, name), "utf8")) as unknown;
  const parsed = parseStationFiles(await read("station.json"), await read("graph.json"), await read("pois.json"));
  if (!parsed.ok) throw new Error(`station ${stationId} failed validation: ${JSON.stringify(parsed.issues)}`);

  const usage: ShimUsage = newShimUsage();
  installHeadlessDom(usage);
  const inStation = (uri: string) => {
    const path = resolve(gtekiDir, uri);
    if (!path.startsWith(gtekiDir + sep)) throw new Error(`asset outside station folder: ${uri}`);
    return path;
  };
  const ctx: SceneContext = {
    THREE: headlessThree(usage),
    bundle: parsed.bundle,
    enuToRenderer: (p) => enuToRenderer(p),
    assetUrl: (uri) => pathToFileURL(inStation(uri)).href,
    // Same loader set-up as the explorer's (Meshopt, glbPrimitivePlugin), minus the browser fetch.
    loadGlb: async (uri): Promise<GLTF> => {
      const buf = await readFile(inStation(uri));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(glbPrimitivePlugin);
      return new Promise<GLTF>((ok, fail) => loader.parse(ab, "", ok, fail));
    },
    // Image decoding needs a browser: a blank texture stands in (the file must still exist). The URI is kept on the
    // placeholder so tagLightmaps can record which file the scene put on a material (the lightmap).
    loadTexture: async (uri, opts = {}) => {
      await readFile(inStation(uri));
      usage.placeholderTextures.push(uri);
      const tex = new THREE.Texture();
      tex.userData.gteki_uri = uri;
      tex.colorSpace = opts.colorSpace === "linear" ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
      tex.flipY = opts.flipY ?? true;
      return tex;
    },
    quality: "high",
    renderer: stubRenderer(),
  };

  const sceneFile = resolve(gtekiDir, "scene.ts");
  const module = (await import(pathToFileURL(sceneFile).href)) as Partial<StationSceneModule>;
  if (typeof module.buildScene !== "function") throw new Error(`${sceneFile} does not export buildScene(ctx)`);
  const scene = await module.buildScene(ctx);
  scene.root.updateMatrixWorld(true);

  const warnings: string[] = [];
  // Dynamic state (escalator steps, doors, crowd) is posed by update(); run it once so the snapshot is the t=0 pose.
  scene.update?.(0, 0);
  scene.root.updateMatrixWorld(true);
  const dropped = dropDynamicObjects(scene.root);
  if (dropped.length > 0) warnings.push(`ambient/skinned objects not exported (animated content, no static meaning): ${[...new Set(dropped)].join(", ")}`);
  const baked = bakeInstancedMeshes(scene.root);
  if (baked > 0) warnings.push(`${baked} InstancedMesh object(s) (escalator steps, platform-door leaves) baked into static merged meshes at their update(0, 0) pose; Godot 4.7 has no EXT_mesh_gpu_instancing import, per-instance colours and per-frame animation are not exported`);
  const roles = tagSceneRoles(scene);
  warnings.push(...roles.warnings);
  // Before stripTextures: the lightmap lives on the material and would otherwise vanish with every other texture.
  const lightmap = tagLightmaps(scene.root);
  const stripped = stripTextures(scene.root);
  warnings.push(`all material textures omitted (${stripped} slot(s)); only base colours, names and UVs (incl. TEXCOORD_1) are kept, so the snapshot is untextured and unlit${lightmap === null ? "" : "; the baked lightmap is described in the lightmap block and re-applied by the Godot client (G-4a)"}`);
  if (usage.canvases > 0) warnings.push(`${usage.canvases} canvas(es) were no-op 2D contexts (blank): procedural textures and sign faces are placeholders, and ${usage.measuredTexts} measureText call(s) used an em-width estimate that may size signs differently from the browser`);
  if (usage.imageDataReads > 0) warnings.push(`${usage.imageDataReads} canvas getImageData read(s) returned zeros`);
  if (usage.pmremEnvironments > 0) warnings.push(`${usage.pmremEnvironments} PMREM environment map(s) stubbed (no GPU): reflections absent`);
  if (usage.placeholderTextures.length > 0) warnings.push(`textures loaded via ctx.loadTexture are blank placeholders, not decoded: ${usage.placeholderTextures.join(", ")}`);
  warnings.push("ctx.audio undefined: no station audio");
  if (roles.replacedByCollision > 0) warnings.push(`${roles.replacedByCollision} drawn mesh(es) carry walkable/collider roles in the source but the scene collides through its own proxies; exported as role "visual" (original in extras.gteki_source_role)`);

  const exporter = new GLTFExporter();
  const exported = await captureWarnings(() =>
    exporter.parseAsync(scene.root, { binary: true, onlyVisible: false, includeCustomExtensions: true }) as Promise<ArrayBuffer>);
  for (const w of exported.warnings) warnings.push(`GLTFExporter: ${w.replace(/^THREE\.GLTFExporter:\s*/, "")}`);
  const glbMaterials = materialsFromGlb(exported.value);
  const duplicateWarning = duplicateMaterialWarning(glbMaterials.duplicates);
  if (duplicateWarning !== null) warnings.push(duplicateWarning);

  const { warnings: _omit, ...counts } = roles;
  const dirty = git("status", "--porcelain", "--", "stations", "packages", "apps").length > 0;
  const walls = scene.walls ?? [];
  const spawns = scene.spawnPoints ?? [];
  const wallSamples = walls.length === 0 ? [] : [...new Set([0, Math.floor(walls.length / 2), walls.length - 1])].map((index) => {
    const w = walls[index]!;
    return { index, a: enuToRenderer({ x: w.a.x, y: w.a.y, z: w.zMin }), b: enuToRenderer({ x: w.b.x, y: w.b.y, z: w.zMin }) };
  });
  const sidecar: SceneSidecar = {
    schema: SIDECAR_SCHEMA,
    stationId: parsed.bundle.station.id,
    sourceCommit: git("rev-parse", "HEAD"),
    sourceDirty: dirty,
    quality: "high",
    walls,
    spawnPoints: spawns,
    environment: scene.environment ?? {},
    counts,
    materials: glbMaterials.materials,
    ...(lightmap === null ? {} : { lightmap }),
    reference: {
      spawnPointsRenderer: spawns.map((p) => enuToRenderer(p)),
      wallSamplesRenderer: wallSamples,
      bounds: { walkable: boundsOf(scene.root, "walkable"), collider: boundsOf(scene.root, "collider") },
    },
    warnings,
  };
  scene.dispose();
  return { sidecar, glb: new Uint8Array(exported.value), seconds: (performance.now() - started) / 1000 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stationId, outDir] = process.argv.slice(2);
  if (!stationId || !outDir) throw new Error("Usage: export-scene.ts <stationId> <outDir>");
  const result = await exportStationScene(stationId);
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, "scene.glb"), result.glb);
  await writeFile(resolve(dir, "scene.json"), `${JSON.stringify(result.sidecar, null, 2)}\n`);
  const c = result.sidecar.counts;
  console.log(`${stationId}: ${(result.glb.byteLength / 1048576).toFixed(2)} MiB GLB, ${c.meshes} meshes (walkable ${c.walkable}, collider ${c.collider}, camera_blocker ${c.camera_blocker}, see_through ${c.see_through}), ${result.sidecar.walls?.length ?? 0} walls, ${result.sidecar.spawnPoints?.length ?? 0} spawns, ${result.sidecar.warnings.length} warnings, ${result.seconds.toFixed(1)} s -> ${dir}`);
}
