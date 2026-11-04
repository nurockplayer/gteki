/** #826 diagnosis: does the Shinjuku scene layout carry floor between the failing edge endpoints? */
import fs from "node:fs";
import { buildLayout, pointInRings, type Layout, type Plan } from "../../stations/shinjuku/scene/layout.ts";
import { navmeshBundle } from "../../packages/godot/src/navmesh-input.ts";
import { planBundle } from "../../stations/shinjuku/gteki/scene.ts";

const edges = [
  "e:82c9a2c2cd704a348fbeb423d07cb125",
  "e:6ac033af77914fe5a9786676088b952c",
  "e:65edd7ca50844b609d4dcb25bd296936",
  "e:ed7e56a8e6234197be06280fcb24aecc",
];

const { bundle } = await navmeshBundle("shinjuku");
const sceneBundle = planBundle(bundle);
const plan = JSON.parse(fs.readFileSync("stations/shinjuku/data/plan.json", "utf8")) as Plan;
const layout: Layout = buildLayout(sceneBundle, plan);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const nodeZ = new Map<string, number>(Object.entries(plan.nodeRenderZ));
const zOf = (id: string) => nodeZ.get(id) ?? 0;
const edgeById = new Map(bundle.edges.map((e) => [e.id, e]));

const pt = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
const near = (a: number, b: number, t = 0.1) => Math.abs(a - b) <= t;
const slabsAt = (z: number) => [
  ...layout.levels.flatMap((lv) => lv.slabs.map((s) => ({ where: `level ${lv.floorId}`, s }))),
  ...layout.pads.map((s) => ({ where: "pad", s })),
  ...layout.linkStrips.map((s) => ({ where: "linkStrip", s })),
  ...layout.streetPads.map((s) => ({ where: "streetPad", s })),
].filter(({ s }) => near(s.z, z));

function cover(z: number, p: { x: number; y: number }) {
  return slabsAt(z).filter(({ s }) => pointInRings(p, s.rings)).map(({ where, s }) => `${where}:${s.spaceId}`);
}

console.log("== layout sanity: floors", layout.levels.map((l) => `${l.floorId}@${l.z}`).join(", "));
for (const id of edges) {
  const e = edgeById.get(id)!;
  const z = zOf(e.from);
  const a = pt(nodes.get(e.from)!.position), b = pt(nodes.get(e.to)!.position);
  console.log(`\n== ${id} mode=${e.mode} z=${z} from=${e.from} to=${e.to}`);
  console.log(`  endpoints cover: from=[${cover(z, a)}] to=[${cover(z, b)}]`);
  if (e.mode !== "elevator") {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(L / 0.25));
    const gaps: { t0: number; t1: number; samples: number }[] = [];
    let run: { t0: number; t1: number; samples: number } | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (cover(z, p).length) run = null;
      else {
        if (!run) { run = { t0: t, t1: t, samples: 0 }; gaps.push(run); }
        run.t1 = t; run.samples++;
      }
    }
    console.log(`  uncovered plan segments: ${gaps.length ? gaps.map((g) => `t ${g.t0.toFixed(3)}..${g.t1.toFixed(3)} (${g.samples} samples)`).join(", ") : "none"}`);
    const strips = layout.linkStrips.filter((s) => s.spaceId.startsWith(`link:${id}:`));
    console.log(`  link strips: ${strips.length} ${strips.map((s) => `z=${s.z} ring=${JSON.stringify(s.rings[0]!.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]))}`).join(" | ")}`);
    const myPads = layout.pads.filter((s) => s.spaceId.includes(id));
    console.log(`  own run-end pads: ${myPads.length}`);
    // clearSoffit cuts: flat passages 0.25..2.4 m below this strip, within reach 1.2 m of its bbox.
    const cx = [Math.min(a.x, b.x) - 1.4, Math.max(a.x, b.x) + 1.4], cy = [Math.min(a.y, b.y) - 1.4, Math.max(a.y, b.y) + 1.4];
    const below = sceneBundle.edges.filter((o) => ["walk", "gate", "ramp"].includes(o.mode) && o.id !== id && near(zOf(o.from), zOf(o.to), 0.05));
    for (const o of below) {
      const dz = z - zOf(o.from);
      if (!(dz > 0.25 && dz < 2.4)) continue;
      const pts = (o.geometry?.length ? o.geometry : [nodes.get(o.from)!.position, nodes.get(o.to)!.position]).map(pt);
      if (!pts.some((p) => p.x >= cx[0] && p.x <= cx[1] && p.y >= cy[0] && p.y <= cy[1])) continue;
      console.log(`  passage ${o.id} z=${zOf(o.from)} (${dz.toFixed(2)} m below) inside strip bbox: ${JSON.stringify(pts.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]))}`);
    }
  }
  // Walls near either endpoint.
  const walls = [...layout.levels.flatMap((lv) => lv.walls.map((w) => ({ ...w, where: `level ${lv.floorId}` }))), ...layout.runWalls.map((w) => ({ ...w, where: `run ${w.runEdgeId}` }))];
  for (const [name, p] of [["from", a], ["to", b]] as const) {
    const hits = walls.filter((w) => {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / L2));
      const d = Math.hypot(p.x - (w.a.x + t * dx), p.y - (w.a.y + t * dy));
      return d <= 1.2 && w.zMax > z + 0.05 && w.zMin < z + 1.7;
    });
    console.log(`  walls within 1.2 m of ${name}: ${hits.length}${hits.slice(0, 4).map((w) => ` [${w.where} z ${w.zMin.toFixed(2)}..${w.zMax.toFixed(2)} at ${(+w.a.x).toFixed(1)},${(+w.a.y).toFixed(1)}]`).join("")}`);
  }
}

// Elevator landing coverage by level slab and the lift cut.
for (const id of ["n:5b824a37524e4fd8abbe9cfa07654556", "n:e6feaa2cc7514b68be2758b956baeb28", "n:cbaeded02c114348a1bd8d0c0590584c"]) {
  const n = nodes.get(id)!;
  const z = zOf(id);
  console.log(`\n== ${id} floor=${n.floorId} kind=${n.kind} z=${z} pos=${n.position.x},${n.position.y}`);
  console.log(`  cover: [${cover(z, { x: n.position.x, y: n.position.y })}]`);
  const near1 = (p: { x: number; y: number }, cx: number, cy: number, r = 1.5) => Math.hypot(p.x - cx, p.y - cy) <= r;
  const around = layout.levels.flatMap((lv) => lv.slabs.filter((s) => near1({ x: n.position.x, y: n.position.y }, ...centroid(s.rings[0]!), 6)).map((s) => `${lv.floorId}@${s.z}`));
  console.log(`  slabs with centroid within 6 m: ${around.join(", ")}`);
  const walls = [...layout.levels.flatMap((lv) => lv.walls.map((w) => ({ ...w, where: `level ${lv.floorId}` }))), ...layout.runWalls.map((w) => ({ ...w, where: `run ${w.runEdgeId}` }))];
  const hits = walls.filter((w) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((n.position.x - w.a.x) * dx + (n.position.y - w.a.y) * dy) / L2));
    const d = Math.hypot(n.position.x - (w.a.x + t * dx), n.position.y - (w.a.y + t * dy));
    return d <= 1.5 && w.zMax > z + 0.05 && w.zMin < z + 1.7;
  });
  console.log(`  walls within 1.5 m: ${hits.length}${hits.slice(0, 5).map((w) => ` [${w.where} z ${w.zMin.toFixed(2)}..${w.zMax.toFixed(2)} ${(+w.a.x).toFixed(1)},${(+w.a.y).toFixed(1)}->${(+w.b.x).toFixed(1)},${(+w.b.y).toFixed(1)}]`).join("")}`);
}
function centroid(ring: { x: number; y: number }[]) {
  return [ring.reduce((s, p) => s + p.x, 0) / ring.length, ring.reduce((s, p) => s + p.y, 0) / ring.length] as const;
}

// Wall segments crossing the two walk edges' landing strips (navmesh splits there).
for (const id of ["e:82c9a2c2cd704a348fbeb423d07cb125", "e:6ac033af77914fe5a9786676088b952c"]) {
  const e = edgeById.get(id)!;
  const z = zOf(e.from);
  const strips = layout.linkStrips.filter((s) => s.spaceId.startsWith(`link:${id}:`));
  console.log(`\n== wall crossings for ${id} strip z=${z}`);
  const walls = [...layout.levels.flatMap((lv) => lv.walls.map((w) => ({ ...w, where: `level ${lv.floorId}` }))), ...layout.runWalls.map((w) => ({ ...w, where: `run ${w.runEdgeId}` }))];
  const crosses = (p: {x:number;y:number}, a: {x:number;y:number}, b: {x:number;y:number}) => {
    const cr = (o:{x:number;y:number},u:{x:number;y:number},v:{x:number;y:number}) => (u.x-o.x)*(v.y-o.y)-(u.y-o.y)*(v.x-o.x);
    const d1=cr(a,b,p), d2=cr(a,b,{x:p.x+1,y:p.y}), d3=cr(p,{x:p.x+1,y:p.y},a), d4=cr(p,{x:p.x+1,y:p.y},b);
    return (d1>0)!==(d2>0) && (d3>0)!==(d4>0);
  };
  for (const w of walls) {
    if (!(w.zMax > z + 0.05 && w.zMin < z + 1.7)) continue; // wall spans the walker body at that landing
    const ring = strips[0]?.rings[0]; if (!ring) continue;
    let hits = 0;
    for (let i = 1; i < ring.length; i++) {
      // segment-segment intersection
      const p1=ring[i-1]!, p2=ring[i]!, p3=w.a, p4=w.b;
      const den=(p2.x-p1.x)*(p4.y-p3.y)-(p2.y-p1.y)*(p4.x-p3.x);
      if (Math.abs(den)<1e-9) continue;
      const t=((p3.x-p1.x)*(p4.y-p3.y)-(p3.y-p1.y)*(p4.x-p3.x))/den;
      const u=((p3.x-p1.x)*(p2.y-p1.y)-(p3.y-p1.y)*(p2.x-p1.x))/den;
      if (t>=0 && t<=1 && u>=0 && u<=1) hits++;
    }
    if (hits) console.log(`  ${w.where} z ${w.zMin.toFixed(2)}..${w.zMax.toFixed(2)} (${w.a.x.toFixed(2)},${w.a.y.toFixed(2)})->(${w.b.x.toFixed(2)},${w.b.y.toFixed(2)}) ring crossings=${hits}`);
    void crosses;
  }
  console.log(`  (walls spanning the body at z=${z}: ${walls.filter((w) => w.zMax > z + 0.05 && w.zMin < z + 1.7).length})`);
}

// Does any wall cross the straight walk line between the two nodes (splitting the landing island)?
for (const id of ["e:82c9a2c2cd704a348fbeb423d07cb125", "e:6ac033af77914fe5a9786676088b952c"]) {
  const e = edgeById.get(id)!;
  const z = zOf(e.from);
  const A = pt(nodes.get(e.from)!.position), B = pt(nodes.get(e.to)!.position);
  const walls = [...layout.levels.flatMap((lv) => lv.walls.map((w) => ({ ...w, where: `level ${lv.floorId}` }))), ...layout.runWalls.map((w) => ({ ...w, where: `run ${w.runEdgeId}` }))];
  console.log(`\n== walk-line crossings ${id}`);
  for (const w of walls) {
    if (!(w.zMax > z + 0.05 && w.zMin < z + 1.7)) continue;
    const p1=A,p2=B,p3=w.a,p4=w.b;
    const den=(p2.x-p1.x)*(p4.y-p3.y)-(p2.y-p1.y)*(p4.x-p3.x);
    if (Math.abs(den)<1e-9) continue;
    const t=((p3.x-p1.x)*(p4.y-p3.y)-(p3.y-p1.y)*(p4.x-p3.x))/den;
    const u=((p3.x-p1.x)*(p2.y-p1.y)-(p3.y-p1.y)*(p2.x-p1.x))/den;
    if (t>0.001 && t<0.999 && u>=-0.0001 && u<=1.0001) {
      console.log(`  CROSS at t=${t.toFixed(3)} ${w.where} z ${w.zMin.toFixed(2)}..${w.zMax.toFixed(2)} (${w.a.x.toFixed(2)},${w.a.y.toFixed(2)})->(${w.b.x.toFixed(2)},${w.b.y.toFixed(2)})`);
    }
  }
}

// Headroom above the two failing landings: which ceiling/slab/soffit covers the walk line, and at what height.
for (const id of ["e:82c9a2c2cd704a348fbeb423d07cb125", "e:6ac033af77914fe5a9786676088b952c"]) {
  const e = edgeById.get(id)!;
  const z = zOf(e.from);
  const A = pt(nodes.get(e.from)!.position), B = pt(nodes.get(e.to)!.position);
  console.log(`\n== headroom ${id} z=${z}`);
  type Ceil = { where: string; s: { z: number; rings: { x: number; y: number }[][] } };
  const ceilings: Ceil[] = [
    ...layout.levels.flatMap((lv) => lv.ceilings.map((s) => ({ where: `level ceiling ${lv.floorId}@${s.z}`, s }))),
    ...layout.soffits.map((s) => ({ where: `soffit ${s.kind} ${s.spaceId}@${s.z}`, s })),
    ...layout.levels.flatMap((lv) => lv.slabs.filter((s) => s.z > z + 0.05).map((s) => ({ where: `slab ${lv.floorId}@${s.z}`, s }))),
    ...layout.pads.filter((s) => s.z > z + 0.05).map((s) => ({ where: `pad@${s.z}`, s })),
    ...layout.linkStrips.filter((s) => s.z > z + 0.05).map((s) => ({ where: `linkStrip@${s.z}`, s })),
  ];
  for (let i = 0; i <= 4; i++) {
    const t = 0.15 + 0.7 * (i / 4);
    const p = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
    const above = ceilings.filter(({ s }) => s.z > z + 0.2 && s.z < z + 4 && pointInRings(p, s.rings)).map(({ where, s }) => `${where} (+${(s.z - z).toFixed(2)} m)`);
    console.log(`  t=${t.toFixed(2)} at ${p.x.toFixed(2)},${p.y.toFixed(2)}: ${above.length ? above.join("; ") : "open above 4 m"}`);
  }
}
