/** Worker threads share immutable geometry captured from the actual scene hook in Vitest. */
import { Worker, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import type { BuiltStation } from "../scene/build.ts";
import { derivedRestrictedAccess, type RestrictedRegion } from "../scene/fare-fence.ts";
import { WalkWorld, type Layout, type Plan, type WallSeg } from "../scene/layout.ts";
import { accelerateRaycasts } from "./fare-replay-rays.ts";
import { APPROACHES, replayEnvironment, type End, type ReplayLeak, type Walker } from "./fare-replay-audit.ts";

const arrays = { Float32Array, Uint16Array, Uint32Array };
type Kind = keyof typeof arrays;
function typedArray(kind: Kind, buffer: SharedArrayBuffer) {
  switch (kind) {
    case "Float32Array": return new Float32Array(buffer);
    case "Uint16Array": return new Uint16Array(buffer);
    case "Uint32Array": return new Uint32Array(buffer);
  }
}
interface Buffer { kind: Kind; data: SharedArrayBuffer; itemSize: number; normalized: boolean }
interface MeshData { name: string; attributes: Record<string, Buffer>; index?: Buffer; side: THREE.Side; matrix: number[] }
interface Fixture { kind: "shinjuku-fare-replay"; failFast: boolean; regions: RestrictedRegion[]; layout: Layout; props: WallSeg[]; meshes: MeshData[]; walkable: number[]; colliders: number[]; walls: NonNullable<StationScene["walls"]>; plan: Plan }
export interface MatrixRow { walker: Walker; fps: number; run: boolean; approach: string; paths: number; passed: number }
interface Job { id: number; end: End; walker: Walker }
interface Result { id: number; rows: MatrixRow[]; frames: number; integratedFrames: number; seeds: number; fringeContacts: number; maxFringeM: number; groupDone?: boolean; leak?: ReplayLeak }
function capture(built: BuiltStation, scene: StationScene, plan: Plan): Fixture {
  const objects = [...new Set([...scene.walkable, ...(scene.colliders ?? [])])];
  const buffer = (attribute: THREE.BufferAttribute): Buffer => {
    const kind = attribute.array.constructor.name as Kind;
    if (!(kind in arrays)) throw new Error(`Unexpected proxy array ${kind}`);
    const data = new SharedArrayBuffer(attribute.array.byteLength);
    typedArray(kind, data).set(attribute.array);
    return { kind, data, itemSize: attribute.itemSize, normalized: attribute.normalized };
  };
  const meshes = objects.map(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.geometry.groups.length) throw new Error("Unexpected hook proxy structure");
    const attributes = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key, value]) => {
      if (!(value instanceof THREE.BufferAttribute)) throw new Error("Interleaved proxy attribute");
      return [key, buffer(value)];
    }));
    return { name: mesh.name, attributes, index: mesh.geometry.index ? buffer(mesh.geometry.index) : undefined,
      side: mesh.material.side, matrix: [...mesh.matrixWorld.elements] };
  });
  return { kind: "shinjuku-fare-replay", failFast: process.env.FARE_REPLAY_FAIL_FAST === "1", regions: derivedRestrictedAccess(built.layout)?.regions ?? [], layout: built.layout, props: built.propWalls, meshes, walkable: scene.walkable.map(o => objects.indexOf(o)),
    colliders: (scene.colliders ?? []).map(o => objects.indexOf(o)), walls: scene.walls ?? [], plan };
}

export async function replayMatrix(built: BuiltStation, scene: StationScene, plan: Plan, ends: End[], shard?: number) {
  const fixture = capture(built, scene, plan), shardJobs = ends.flatMap(end => (["lane", "explorer"] as const).map(walker => ({ end, walker }))).map((j, id) => ({ ...j, id }));
  // FARE_REPLAY_PREFIX=<n> runs only the first n jobs of this shard, in the caller's (conflict-first) order; default all.
  const prefix = Number(process.env.FARE_REPLAY_PREFIX) > 0 ? Math.floor(Number(process.env.FARE_REPLAY_PREFIX)) : 0;
  const jobs = prefix ? shardJobs.slice(0, prefix) : shardJobs;
  const matrix = new Map<string, MatrixRow>(), results: Result[] = [], workers: Worker[] = [];
  const groupsByKey = new Map<string, Job[]>();
  for (const job of jobs) { const p = job.end.p, key = `${job.walker}:${p.x},${p.y},${p.z}`, list = groupsByKey.get(key) ?? []; list.push(job); groupsByKey.set(key, list); }
  const groups = [...groupsByKey.values()], startedAt = Date.now(), start = performance.now();
  let next = 0, finished = 0;
  const report = () => ({ jobs: jobs.length, shardJobs: shardJobs.length, prefix: prefix || null, finished, failFast: fixture.failFast, startedAt, finishedAt: Date.now(), wallMs: performance.now() - start, integratedFrames: results.reduce((n, r) => n + r.integratedFrames, 0), frames: results.reduce((n, r) => n + r.frames, 0),
    failedPaths: [...matrix.values()].reduce((n, r) => n + r.paths - r.passed, 0),
    fringeContacts: results.reduce((n, r) => n + r.fringeContacts, 0), maxFringeM: Math.max(0, ...results.map(r => r.maxFringeM)),
    matrix: [...matrix.values()], zeroSeedJobs: results.filter(r => !r.seeds).map(r => jobs[r.id]!.end.id), leaks: results.flatMap(r => r.leak ? [r.leak] : []) });
  const save = () => { if (process.env.FARE_REPLAY_REPORT) writeFileSync(process.env.FARE_REPLAY_REPORT.replace(/\.json$/, shard === undefined ? ".json" : `-${shard + 1}.json`), JSON.stringify(report(), null, 2)); };
  // Each thread holds its own copy of the scene geometry (~0.8 GB); keep the default to two so a
  // 16 GB host stays responsive (issue #40). GTEKI_REPLAY_THREADS raises it on larger machines.
  const threads = Math.max(1, Math.min(Number(process.env.GTEKI_REPLAY_THREADS) || 2, availableParallelism()));
  const tasks = Array.from({ length: Math.min(threads, groups.length) }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./fare-replay-worker.ts", import.meta.url), { workerData: fixture, execArgv: ["--import", "tsx"] }); workers.push(worker);
    worker.on("error", reject);
    worker.on("message", (result: Result | "ready") => {
      if (result !== "ready") {
        results.push(result); finished++;
        for (const row of result.rows) {
          const key = `${row.walker}:${row.fps}:${row.run}:${row.approach}`, value = matrix.get(key);
          if (value) { value.paths += row.paths; value.passed += row.passed; } else matrix.set(key, { ...row });
        }
        save(); if (result.leak && fixture.failFast) { reject(new Error(JSON.stringify(result.leak))); return; }
        if (!result.groupDone) return;
      }
      if (next < groups.length) worker.postMessage(groups[next++]!); else resolve();
    });
    worker.on("exit", code => { if (code !== 0 && finished < jobs.length) reject(new Error(`Replay worker exited ${code}`)); });
  }));
  try { await Promise.all(tasks); save(); return report(); }
  finally { await Promise.all(workers.map(w => w.terminate())); }
}

if (parentPort && workerData?.kind === "shinjuku-fare-replay") {
  const fixture = workerData as Fixture;
  const world = new WalkWorld(fixture.layout); world.addWalls(fixture.props);
  const attribute = (b: Buffer) => new THREE.BufferAttribute(typedArray(b.kind, b.data), b.itemSize, b.normalized);
  const meshes = fixture.meshes.map(data => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(data.attributes)) geometry.setAttribute(name, attribute(a));
    if (data.index) geometry.setIndex(attribute(data.index));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: data.side, visible: false }));
    mesh.name = data.name; mesh.matrixWorld.fromArray(data.matrix); return mesh;
  });
  const scene: StationScene = { root: new THREE.Group(), dispose() {}, walkable: fixture.walkable.map(i => meshes[i]!), colliders: fixture.colliders.map(i => meshes[i]!), walls: fixture.walls };
  accelerateRaycasts(meshes);
  const built: BuiltStation = { root: new THREE.Group(), layout: fixture.layout, world, propWalls: fixture.props, escalators: [], signs: [], levelGroups: new Map(), update() {}, dispose() {}, trainStatus: () => [] };
  const env = replayEnvironment(built, scene, fixture.plan, fixture.regions);
  parentPort.on("message", (group: Job[]) => {
   for (const [groupIndex, job] of group.entries()) {
    const seeds = env.seeds(job.end), rows: MatrixRow[] = [], before = env.frames(), integratedBefore = env.integratedFrames(), fringeBefore = env.fringes().contacts;
    const result: Result = { id: job.id, rows, frames: 0, integratedFrames: 0, fringeContacts: 0, maxFringeM: 0, groupDone: groupIndex === group.length - 1, seeds: seeds.filter(s => s[job.walker]).length };
    outer: for (const fps of [30, 60]) for (const run of [false, true]) for (const approach of APPROACHES) {
      const row: MatrixRow = { walker: job.walker, fps, run, approach, paths: 0, passed: 0 }; rows.push(row);
      for (const seed of seeds) {
        const point = seed[job.walker]; if (!point) continue;
        const leak = env.replay(job.end, point, approach, job.walker, fps, run); row.paths++;
        if (leak) { result.leak ??= leak; if (fixture.failFast) break outer; } else row.passed++;
      }
    }
    result.frames = env.frames() - before; result.integratedFrames = env.integratedFrames() - integratedBefore;
    result.fringeContacts = env.fringes().contacts - fringeBefore; result.maxFringeM = env.fringes().maxM; parentPort!.postMessage(result);
    if (result.leak && fixture.failFast) break;
   }
  });
  parentPort.postMessage("ready");
}
