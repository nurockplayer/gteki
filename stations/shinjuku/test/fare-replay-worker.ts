/** Worker threads share immutable geometry captured from the actual scene hook in Vitest. */
import { Worker, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import type { BuiltStation } from "../scene/build.ts";
import { WalkWorld, type Layout, type Plan, type WallSeg } from "../scene/layout.ts";
import { accelerateRaycasts } from "./fare-replay-rays.ts";
import { APPROACHES, replayEnvironment, type End, type ReplayLeak, type Walker } from "./fare-replay-audit.ts";

const arrays = { Float32Array, Uint16Array, Uint32Array };
type Kind = keyof typeof arrays;
interface Buffer { kind: Kind; data: SharedArrayBuffer; itemSize: number; normalized: boolean }
interface MeshData { name: string; attributes: Record<string, Buffer>; index?: Buffer; side: THREE.Side; matrix: number[] }
interface Fixture { kind: "shinjuku-fare-replay"; layout: Layout; props: WallSeg[]; meshes: MeshData[]; walkable: number[]; colliders: number[]; walls: NonNullable<StationScene["walls"]>; plan: Plan }
export interface MatrixRow { walker: Walker; fps: number; run: boolean; approach: string; paths: number; passed: number }
interface Job { id: number; end: End; walker: Walker }
interface Result { id: number; rows: MatrixRow[]; frames: number; seeds: number; leak?: ReplayLeak }
function capture(built: BuiltStation, scene: StationScene, plan: Plan): Fixture {
  const objects = [...new Set([...scene.walkable, ...(scene.colliders ?? [])])];
  const buffer = (attribute: THREE.BufferAttribute): Buffer => {
    const kind = attribute.array.constructor.name as Kind;
    if (!(kind in arrays)) throw new Error(`Unexpected proxy array ${kind}`);
    const data = new SharedArrayBuffer(attribute.array.byteLength);
    new arrays[kind](data).set(attribute.array);
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
  return { kind: "shinjuku-fare-replay", layout: built.layout, props: built.propWalls, meshes, walkable: scene.walkable.map(o => objects.indexOf(o)),
    colliders: (scene.colliders ?? []).map(o => objects.indexOf(o)), walls: scene.walls ?? [], plan };
}

export async function replayMatrix(built: BuiltStation, scene: StationScene, plan: Plan, ends: End[]) {
  const fixture = capture(built, scene, plan), jobs = ends.flatMap(end => (["lane", "explorer"] as const).map(walker => ({ end, walker }))).map((j, id) => ({ ...j, id }));
  const matrix = new Map<string, MatrixRow>(), results: Result[] = [], workers: Worker[] = [];
  let next = 0, finished = 0;
  const report = () => ({ jobs: jobs.length, finished, frames: results.reduce((n, r) => n + r.frames, 0),
    matrix: [...matrix.values()], zeroSeedJobs: results.filter(r => !r.seeds).map(r => jobs[r.id]!.end.id), leaks: results.flatMap(r => r.leak ? [r.leak] : []) });
  const save = () => { if (process.env.FARE_REPLAY_REPORT) writeFileSync(process.env.FARE_REPLAY_REPORT, JSON.stringify(report(), null, 2)); };
  const tasks = Array.from({ length: Math.min(2, availableParallelism(), jobs.length) }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./fare-replay-worker.ts", import.meta.url), { workerData: fixture, execArgv: ["--import", "tsx"] }); workers.push(worker);
    worker.on("error", reject);
    worker.on("message", (result: Result | "ready") => {
      if (result !== "ready") {
        results.push(result); finished++;
        for (const row of result.rows) {
          const key = `${row.walker}:${row.fps}:${row.run}:${row.approach}`, value = matrix.get(key);
          if (value) { value.paths += row.paths; value.passed += row.passed; } else matrix.set(key, { ...row });
        }
        save(); if (result.leak) { reject(new Error(JSON.stringify(result.leak))); return; }
      }
      if (next < jobs.length) worker.postMessage(jobs[next++]!); else resolve();
    });
    worker.on("exit", code => { if (code !== 0 && finished < jobs.length) reject(new Error(`Replay worker exited ${code}`)); });
  }));
  try { await Promise.all(tasks); save(); return report(); }
  finally { await Promise.all(workers.map(w => w.terminate())); }
}

if (parentPort && workerData?.kind === "shinjuku-fare-replay") {
  const fixture = workerData as Fixture;
  const world = new WalkWorld(fixture.layout); world.addWalls(fixture.props);
  const attribute = (b: Buffer) => new THREE.BufferAttribute(new arrays[b.kind](b.data), b.itemSize, b.normalized);
  const meshes = fixture.meshes.map(data => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(data.attributes)) geometry.setAttribute(name, attribute(a));
    if (data.index) geometry.setIndex(attribute(data.index));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: data.side, visible: false }));
    mesh.name = data.name; mesh.matrixWorld.fromArray(data.matrix); return mesh;
  });
  const scene = { walkable: fixture.walkable.map(i => meshes[i]!), colliders: fixture.colliders.map(i => meshes[i]!), walls: fixture.walls } as StationScene;
  accelerateRaycasts(meshes);
  const env = replayEnvironment({ layout: fixture.layout, world, propWalls: fixture.props } as BuiltStation, scene, fixture.plan);
  parentPort.on("message", (job: Job) => {
    const seeds = env.seeds(job.end), rows: MatrixRow[] = [], before = env.frames();
    const result: Result = { id: job.id, rows, frames: 0, seeds: seeds.filter(s => s[job.walker]).length };
    outer: for (const fps of [30, 60]) for (const run of [false, true]) for (const approach of APPROACHES) {
      const row: MatrixRow = { walker: job.walker, fps, run, approach, paths: 0, passed: 0 }; rows.push(row);
      for (const seed of seeds) {
        const point = seed[job.walker]; if (!point) continue;
        const leak = env.replay(job.end, point, approach, job.walker, fps, run); row.paths++;
        if (leak) { result.leak = leak; break outer; } row.passed++;
      }
    }
    result.frames = env.frames() - before; parentPort!.postMessage(result);
  });
  parentPort.postMessage("ready");
}
