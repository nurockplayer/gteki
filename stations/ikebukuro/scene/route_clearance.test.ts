// Every verified edge polyline can be walked by the explorer's body (#227): the web walker's own `bodyBlock`
// (apps/web/src/explorer/bodyCollision.ts, radius WALKER_BODY.radiusM), run against the collision world this scene
// produces (pipeline/walker_replay.ts `buildWorld`, the same one walker_replay.test.ts uses), refuses no step
// between consecutive 0.25 m samples. The pipeline keeps polylines 0.35 m from colliders (build_station.py
// EDGE_CLEAR); this checks that against the real colliders rather than the pipeline's 2D wall pieces.
// Within END_ALLOW of a dead-end node (a ticket gate whose gate line is the routable outline) the access fences may
// close in, as pipeline/build_access.py `route_clearance` allows; there the steps are tested against the scene with
// no fences, so walls and every other collider still count.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bodyBlock, hitNormal } from "../../../apps/web/src/explorer/bodyCollision.ts";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { read } from "../pipeline/access_seal.ts";
import { RADIUS, ReplayWalker, buildWorld, nearby } from "../pipeline/walker_replay.ts";

const STEP = 0.25;
const END_ALLOW = 0.6; // m, = build_access.py END_ALLOW
type P3 = { x: number; y: number; z: number };
interface Edge { id: string; from: string; to: string; verification: string; geometry: P3[] }

/** Points every <= STEP m (in plan) along a polyline, both ends included. */
function samples(g: P3[]): P3[] {
  const out: P3[] = [g[0]!];
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1]!, b = g[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

// #227's guard in CI, so it stays out of *.heavy.test.ts (not run in CI): measured 1.7-4.6 s per file run (the test itself
// about 1.5 s), single worker under the shared test lock on a loaded host (2026-10-23).
describe("verified polylines clear the walker's body (#227)", () => {
  const all = read("gteki/graph.json").edges as Edge[];
  const edges = all.filter((e) => e.verification === "verified");
  const degree = new Map<string, number>();
  for (const e of all) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);

  it("bodyBlock refuses no 0.25 m step along any verified edge", async () => {
    const world = await buildWorld();
    const unfenced = await buildWorld([]);
    const ray = new THREE.Raycaster();
    const blocked: string[] = [];
    let steps = 0;
    for (const e of edges) {
      const pts = samples(e.geometry).map((p) => new THREE.Vector3(...enuToRenderer(p)));
      const box = new THREE.Box3().setFromPoints(pts);
      const centre = box.getCenter(new THREE.Vector3());
      const reach = box.getSize(new THREE.Vector3()).length() / 2 + RADIUS + 2;
      const local = nearby(world, centre, reach);
      const open = nearby(unfenced, centre, reach);
      const walker = new ReplayWalker(local);
      // Feet on the ground the walker would stand on (a straight polyline runs below stair treads).
      const feet = pts.map((p) => new THREE.Vector3(p.x, walker.groundAt(p.x, p.y + 0.6, p.z, 1.2) ?? p.y, p.z));
      const caster = (targets: THREE.Object3D[]) => (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => {
        ray.set(origin, dir);
        ray.far = far;
        const hit = castAll(ray, targets)[0];
        return hit ? { distance: hit.distance, normal: hitNormal(hit, dir) } : null;
      };
      const cast = caster(local.collider), castOpen = caster(open.collider);
      const ends = [...(degree.get(e.from) === 1 ? [feet[0]!] : []), ...(degree.get(e.to) === 1 ? [feet.at(-1)!] : [])];
      const nearEnd = (p: THREE.Vector3) => ends.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < END_ALLOW);
      for (let i = 1; i < feet.length; i++) {
        steps++;
        if (bodyBlock(feet[i - 1]!, feet[i]!, nearEnd(feet[i]!) ? castOpen : cast, RADIUS)) {
          const [x, y, z] = [feet[i]!.x, -feet[i]!.z, feet[i]!.y].map((v) => v.toFixed(2));
          blocked.push(`${e.id} step ${i} at ENU (${x}, ${y}, ${z})`);
        }
      }
    }
    expect(edges.map((e) => e.id)).toContain("ne_j__x26"); // the stair head whose wall top is the street edge
    expect(steps).toBeGreaterThan(6000);
    expect(blocked).toEqual([]);
  }, 60_000);
});
