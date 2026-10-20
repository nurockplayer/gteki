/** Diagnose guided-walk blockages: for each POI pair, walk and report where/why the walker stops. */
import { createRouter } from "@gteki/navigation";
import { buildLayout, WalkWorld, type Plan } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { Player, type GuidePoint } from "../app/src/player.ts";
import planJson from "../data/plan.json" with { type: "json" };

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const world = new WalkWorld(layout);
const router = createRouter(bundle);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const edges = new Map(bundle.edges.map((e) => [e.id, e]));
const nodeZ = (id: string) => layout.nodeZ.get(id) ?? 0;
const seen = new Set<string>();
const pois = bundle.pois.filter((p) => ["exit", "ticket_gate", "platform"].includes(p.category));
for (const a of pois)
  for (const b of pois) {
    if (a === b) continue;
    const r = router.route(a.connectorNodeIds[0]!, b.connectorNodeIds, { fare: "ticketed", stepFree: false });
    if (!r.ok) continue;
    const pts: GuidePoint[] = r.nodeIds.map((id, i) => ({ ...nodes.get(id)!.position, z: nodeZ(id), nodeId: id, elevator: i > 0 && r.steps[i - 1]!.mode === "elevator" }));
    const p = new Player(world, pts[0]!);
    let arrived = false;
    p.onGuideEvent = (e) => void (e.type === "arrived" && (arrived = true));
    p.startGuide(pts);
    for (let t = 0; t < r.totalLengthM + 60 && !arrived; t += 1 / 30) p.update(1 / 30, { forward: 0, strafe: 0, run: false }, p.heading);
    if (arrived) continue;
    const i = p.guideIndex;
    const prev = pts[i - 1]!;
    const next = pts[i]!;
    const step = r.steps[i - 1]!;
    const key = `${prev.nodeId}>${next.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = edges.get(step.edgeId)!;
    const here = { x: p.x, y: p.y };
    const wall = world.firstWallHit(here, next, p.z + 0.5);
    const dir = { x: next.x - p.x, y: next.y - p.y };
    const L = Math.hypot(dir.x, dir.y) || 1;
    const ahead = { x: p.x + (dir.x / L) * 0.3, y: p.y + (dir.y / L) * 0.3 };
    const ws = (world as unknown as { walls: { a: { x: number; y: number }; b: { x: number; y: number }; zMin: number; zMax: number; kind: string }[] }).walls;
    const zb = p.z + 0.5;
    const blocking = ws
      .filter((w) => zb >= w.zMin && zb <= w.zMax)
      .filter((w) => {
        const rx = next.x - p.x, ry = next.y - p.y, sx = w.b.x - w.a.x, sy = w.b.y - w.a.y;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) return false;
        const t = ((w.a.x - p.x) * sy - (w.a.y - p.y) * sx) / den, u = ((w.a.x - p.x) * ry - (w.a.y - p.y) * rx) / den;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
      })
      .map((w) => `${w.kind} (${w.a.x.toFixed(1)},${w.a.y.toFixed(1)})-(${w.b.x.toFixed(1)},${w.b.y.toFixed(1)}) z[${w.zMin.toFixed(2)},${w.zMax.toFixed(2)}]`);
    console.log(
      JSON.stringify({
        pair: `${a.id}→${b.id}`,
        edge: step.edgeId,
        mode: e.mode,
        from: [prev.x.toFixed(1), prev.y.toFixed(1), prev.z.toFixed(2), nodes.get(prev.nodeId)!.floorId],
        to: [next.x.toFixed(1), next.y.toFixed(1), next.z.toFixed(2), nodes.get(next.nodeId)!.floorId],
        at: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(2)],
        wallHit: wall,
        heightsAhead: world.heightsAt(ahead).map((h) => +h.toFixed(2)),
        groundAhead: world.groundAt(ahead, p.z),
        blocking,
      }),
    );
  }
