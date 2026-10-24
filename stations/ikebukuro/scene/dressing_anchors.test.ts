// dressing_anchors.json: survey-derived stair nosing lines and escalator landings for the Lane E kit.
// The committed file is checked against the committed GLB (no git-ignored inputs): every anchor sits on
// stairs_ramps or transport triangles. The generator is checked on a small fixture, and against the real
// extract when build/ubld_enu.json exists locally.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATION = join(HERE, "..");
const SCRIPT = join(STATION, "pipeline", "build_dressing_anchors.py");
const COMMITTED = join(HERE, "dressing_anchors.json");

type V3 = [number, number, number];
interface Nosing { position: V3; dir: [number, number]; width_m: number; a: V3; b: V3 }
interface Flight { id: string; steps: number; rise_m: number; run_m: number | null; bottom: Nosing; top: Nosing; nosings: number[][] }
interface Lane { id: string; width_m: number; lower: { position: V3; dir: [number, number]; width_m: number }; upper: { position: V3; dir: [number, number]; width_m: number } }
interface Anchors {
  schema: string;
  source: { gml: string; gml_sha256: string };
  counts: Record<string, number>;
  stair_flights: Flight[];
  escalator_lanes: Lane[];
}
const anchors = JSON.parse(readFileSync(COMMITTED, "utf8")) as Anchors;

/** Triangles (ENU metres) of the meshes tagged `role` in a plain (uncompressed) GLB; glTF (x, y, z) is ENU (x, -z, y). */
function glbTriangles(path: string, roles: string[]): Record<string, V3[][]> {
  const b = readFileSync(path);
  const jsonLen = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
  const bin = b.subarray(20 + jsonLen + 8);
  const view = (acc: { bufferView: number; byteOffset?: number }) => {
    const bv = j.bufferViews[acc.bufferView];
    return (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  };
  const out: Record<string, V3[][]> = Object.fromEntries(roles.map((r) => [r, []]));
  for (const node of j.nodes) {
    const role = node.extras?.gteki_role as string | undefined;
    if (!role || !roles.includes(role) || node.mesh === undefined) continue;
    expect(node.matrix ?? node.translation ?? node.rotation ?? node.scale).toBeUndefined(); // identity: positions read as is
    for (const prim of j.meshes[node.mesh].primitives) {
      const pos = j.accessors[prim.attributes.POSITION];
      const idx = j.accessors[prim.indices];
      const p0 = view(pos);
      const i0 = view(idx);
      const point = (i: number): V3 => {
        const o = p0 + i * 12;
        return [bin.readFloatLE(o), -bin.readFloatLE(o + 8), bin.readFloatLE(o + 4)];
      };
      const read = idx.componentType === 5125 ? (n: number) => bin.readUInt32LE(i0 + n * 4) : (n: number) => bin.readUInt16LE(i0 + n * 2);
      for (let t = 0; t < idx.count; t += 3) out[role]!.push([point(read(t)), point(read(t + 1)), point(read(t + 2))]);
    }
  }
  return out;
}

/** Distance from point p to triangle abc (Ericson, Real-Time Collision Detection, closest point on triangle). */
function distToTri(p: V3, [a, b, c]: V3[]): number {
  const sub = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const add = (u: V3, v: V3, s: number): V3 => [u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s];
  const ab = sub(b!, a!), ac = sub(c!, a!), ap = sub(p, a!);
  let q: V3;
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const bp = sub(p, b!), d3 = dot(ab, bp), d4 = dot(ac, bp);
  const cp = sub(p, c!), d5 = dot(ab, cp), d6 = dot(ac, cp);
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) q = a!;
  else if (d3 >= 0 && d4 <= d3) q = b!;
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = add(a!, ab, d1 / (d1 - d3));
  else if (d6 >= 0 && d5 <= d6) q = c!;
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = add(a!, ac, d2 / (d2 - d6));
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = add(b!, sub(c!, b!), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  else {
    const den = 1 / (va + vb + vc);
    q = add(add(a!, ab, vb * den), ac, vc * den);
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function onGeometry(points: V3[], tris: V3[][], tol: number): V3[] {
  // Bounding boxes first: the stairs have a few thousand triangles and the anchors a few thousand points.
  const boxes = tris.map((t) => [0, 1, 2].map((k) => [Math.min(...t.map((v) => v[k]!)) - tol, Math.max(...t.map((v) => v[k]!)) + tol]));
  return points.filter((p) => !tris.some((t, i) => [0, 1, 2].every((k) => p[k]! >= boxes[i]![k]![0]! && p[k]! <= boxes[i]![k]![1]!) && distToTri(p, t) <= tol));
}

describe("committed dressing_anchors.json", () => {
  const station = JSON.parse(readFileSync(join(STATION, "gteki", "station.json"), "utf8")) as { sources: { sha256?: Record<string, string> }[] };

  it("is built from the GML that station.json pins", () => {
    expect(anchors.schema).toBe("gteki.ikebukuro.dressing-anchors/0");
    const pinned = Object.assign({}, ...station.sources.map((s) => s.sha256 ?? {})) as Record<string, string>;
    expect(pinned[anchors.source.gml]).toBe(anchors.source.gml_sha256);
  });

  it("counts match the lists, and every flight has consistent ends", () => {
    const c = anchors.counts;
    expect(anchors.stair_flights).toHaveLength(c.stair_flights!);
    expect(anchors.stair_flights.reduce((n, f) => n + f.nosings.length, 0)).toBe(c.stair_nosings);
    expect(anchors.escalator_lanes).toHaveLength(c.escalator_lanes!);
    expect(c.escalator_landings).toBe(2 * c.escalator_lanes!);
    expect(c.unresolved_nosings).toBe(0);
    expect(c.stair_flights).toBeGreaterThan(0);
    expect(c.escalator_lanes).toBeGreaterThan(0);
    for (const f of anchors.stair_flights) {
      expect(f.steps).toBe(f.nosings.length);
      const [bottom, top] = [f.nosings[0]!, f.nosings[f.nosings.length - 1]!];
      expect(f.bottom.a).toEqual([bottom[0], bottom[1], bottom[4]]);
      expect(f.top.b).toEqual([top[2], top[3], top[4]]);
      expect(f.rise_m).toBeCloseTo(top[4]! - bottom[4]!, 3);
      for (const n of [f.bottom, f.top]) {
        expect(Math.hypot(...n.dir)).toBeCloseTo(1, 3);
        expect(n.width_m).toBeGreaterThan(0.2);
      }
    }
    for (const l of anchors.escalator_lanes) {
      expect(l.upper.position[2]).toBeGreaterThan(l.lower.position[2]);
      expect(l.width_m).toBeGreaterThan(0.5);
      expect(Math.hypot(...l.lower.dir)).toBeCloseTo(1, 3);
    }
  });

  it("chains every flight one-to-one: nosings climb strictly, each step links to the next, and no step is modelled twice", () => {
    const mid = (n: number[]): [number, number] => [(n[0]! + n[2]!) / 2, (n[1]! + n[3]!) / 2];
    const dup: string[] = [];
    for (const f of anchors.stair_flights) {
      const [dx, dy] = f.bottom.dir;
      // the catalog's acceptance: mean riser 100-220 mm and a tread of at least 200 mm
      const accepted = f.steps > 1 && f.rise_m * 1000 / (f.steps - 1) >= 100 && f.rise_m * 1000 / (f.steps - 1) <= 220 && f.run_m! >= 0.2;
      for (let k = 1; k < f.nosings.length; k++) {
        const [p, q] = [f.nosings[k - 1]!, f.nosings[k]!];
        expect(q[4], `${f.id} step ${k} climbs`).toBeGreaterThan(p[4]!);
        const [mp, mq] = [mid(p), mid(q)];
        const along = (mq[0] - mp[0]) * dx + (mq[1] - mp[1]) * dy;
        const lateral = Math.abs(-(mq[0] - mp[0]) * dy + (mq[1] - mp[1]) * dx);
        // the generator's own link limits, for every flight; the plausible band for flights the catalog accepts
        expect(q[4]! - p[4]!, `${f.id} step ${k} rise`).toBeGreaterThanOrEqual(0.08);
        expect(q[4]! - p[4]!).toBeLessThanOrEqual(0.3);
        expect(along, `${f.id} step ${k} run`).toBeGreaterThanOrEqual(0.12);
        expect(along).toBeLessThanOrEqual(0.6);
        expect(lateral).toBeLessThanOrEqual(0.2);
        if (accepted) {
          expect(q[4]! - p[4]!, `${f.id} step ${k} rise`).toBeGreaterThanOrEqual(0.1);
          expect(q[4]! - p[4]!).toBeLessThanOrEqual(0.22);
          expect(along, `${f.id} step ${k} run`).toBeGreaterThanOrEqual(0.2);
          expect(along).toBeLessThanOrEqual(0.45);
          expect(lateral).toBeLessThanOrEqual(0.1);
        }
      }
      if (accepted) expect(f.run_m!, `${f.id} mean run`).toBeLessThanOrEqual(0.45);
    }
    // no branch: a nosing has exactly one possible successor inside its flight, and the flights share no step
    const all = anchors.stair_flights.flatMap((f) => f.nosings.map((n) => ({ id: f.id, n })));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i]!, all[j]!];
        const [ma, mb] = [mid(a.n), mid(b.n)];
        if (Math.abs(a.n[4]! - b.n[4]!) < 0.08 && Math.hypot(ma[0] - mb[0], ma[1] - mb[1]) < 0.06) dup.push(`${a.id}/${b.id}`);
      }
    }
    expect(dup).toEqual([]);
    // stair040 was two overlapping survey solids (10 + 10 nosings 1-35 mm apart) read as one 19-step flight with a 0.151 m run
    const s40 = anchors.stair_flights.find((f) => f.id === "stair040")!;
    expect(s40.steps).toBe(10);
    expect(s40.run_m!).toBeGreaterThan(0.29);
    expect(anchors.counts.duplicate_nosings_dropped).toBe(10);
  });

  it("puts every stair nosing line on stairs_ramps geometry and every landing on transport geometry", () => {
    const tris = glbTriangles(join(STATION, "gteki", "assets", "ikebukuro_b1.glb"), ["stairs_ramps", "transport"]);
    const stairPoints: V3[] = anchors.stair_flights.flatMap((f) => [
      ...f.nosings.flatMap((n) => [[n[0]!, n[1]!, n[4]!] as V3, [n[2]!, n[3]!, n[4]!] as V3]),
      f.bottom.position, f.top.position,
    ]);
    const escPoints: V3[] = anchors.escalator_lanes.flatMap((l) => [l.lower.position, l.upper.position]);
    expect(stairPoints.length).toBeGreaterThan(1000);
    expect(onGeometry(stairPoints, tris.stairs_ramps!, 0.005)).toEqual([]);
    expect(onGeometry(escPoints, tris.transport!, 0.005)).toEqual([]);
  });
});

const python = spawnSync("python3", ["-I", "--version"]).status === 0;

describe.skipIf(!python)("build_dressing_anchors.py", () => {
  const run = (dir: string, extract: string, station: string, out: string) =>
    spawnSync("python3", ["-I", SCRIPT, extract, out, "--station", station], { cwd: dir, encoding: "utf8" });

  /** Three steps climbing +x (risers at x = 0, 0.3, 0.6 under treads at z = 0.15, 0.30, 0.45) and one escalator lane. */
  function fixture(dir: string) {
    const quad = (a: V3, b: V3, c: V3, d: V3) => [{ outer: [a, b, c] }, { outer: [a, c, d] }];
    const riser = (x: number, z0: number, z1: number) => quad([x, 0, z0], [x, 2, z0], [x, 2, z1], [x, 0, z1]);
    const tread = (x0: number, x1: number, z: number) => quad([x0, 0, z], [x1, 0, z], [x1, 2, z], [x0, 2, z]);
    const strip = (y0: number, y1: number) => quad([0, y0, -0.5], [8, y0, 3.5], [8, y1, 3.5], [0, y1, -0.5]);
    const extract = {
      schema: "gteki.plateau-ubld-extract/0",
      source: { file: "fixture.gml", sha256: "ab".repeat(32) },
      frame: { origin: { lat: 35.7297, lon: 139.7114, h_m: 0 } },
      installations: [
        { id: "stairs", scope: "room1", function: "EF_35", polygons: [...riser(0, 0, 0.15), ...tread(0, 0.3, 0.15), ...riser(0.3, 0.15, 0.3), ...tread(0.3, 0.6, 0.3), ...riser(0.6, 0.3, 0.45), ...tread(0.6, 0.9, 0.45)] },
        // sloped walking quad (low edge z = 0 at x = 0, high edge z = 4 at x = 8) and two thin side plates 1 m apart
        { id: "esc", scope: "room1", function: "EF_80", polygons: [...quad([0, 0, 0], [0, 2.2, 0], [8, 2.2, 4], [8, 0, 4]), ...strip(0, 0.1), ...strip(1.1, 1.2)] },
      ],
    };
    writeFileSync(join(dir, "extract.json"), JSON.stringify(extract));
    writeFileSync(join(dir, "station.json"), JSON.stringify({ sources: [{ sha256: { "fixture.gml": "ab".repeat(32) } }] }));
  }

  it("is deterministic and finds the fixture's flight and lane", () => {
    const dir = mkdtempSync(join(tmpdir(), "gt-anchors-"));
    try {
      fixture(dir);
      const first = run(dir, join(dir, "extract.json"), join(dir, "station.json"), join(dir, "a.json"));
      const second = run(dir, join(dir, "extract.json"), join(dir, "station.json"), join(dir, "b.json"));
      expect(first.status, first.stderr).toBe(0);
      expect(second.status, second.stderr).toBe(0);
      const a = readFileSync(join(dir, "a.json"), "utf8");
      expect(readFileSync(join(dir, "b.json"), "utf8")).toBe(a);
      const out = JSON.parse(a) as Anchors;
      expect(out.counts).toMatchObject({ stair_flights: 1, stair_nosings: 3, unresolved_nosings: 0, escalator_lanes: 1, escalator_landings: 2 });
      const f = out.stair_flights[0]!;
      expect(f.steps).toBe(3);
      expect(f.rise_m).toBeCloseTo(0.3, 3);
      expect(f.bottom.position).toEqual([0, 1, 0.15]);
      expect(f.top.position).toEqual([0.6, 1, 0.45]);
      expect(f.bottom.dir).toEqual([1, 0]);
      expect(f.bottom.width_m).toBe(2);
      const l = out.escalator_lanes[0]!;
      expect(l.lower.position).toEqual([0, 0.6, 0]);
      expect(l.upper.position).toEqual([8, 0.6, 4]);
      expect(l.width_m).toBeCloseTo(1, 3);
      expect(l.lower.dir).toEqual([1, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chains a stair modelled twice (two overlapping solids, different pitch) into one one-to-one flight", () => {
    const dir = mkdtempSync(join(tmpdir(), "gt-anchors-"));
    try {
      fixture(dir);
      const extract = JSON.parse(readFileSync(join(dir, "extract.json"), "utf8"));
      const quad = (a: V3, b: V3, c: V3, d: V3) => [{ outer: [a, b, c] }, { outer: [a, c, d] }];
      // a second body of the same stair, 20 mm to the side and 6-18 mm higher (risers 0.156 m): the same three steps
      const zs = [0.156, 0.312, 0.468];
      const polys = zs.flatMap((z, k) => [
        ...quad([k * 0.3, 0.02, z - 0.156], [k * 0.3, 2.02, z - 0.156], [k * 0.3, 2.02, z], [k * 0.3, 0.02, z]),
        ...quad([k * 0.3, 0.02, z], [k * 0.3 + 0.3, 0.02, z], [k * 0.3 + 0.3, 2.02, z], [k * 0.3, 2.02, z]),
      ]);
      extract.installations[0].polygons.push(...polys);
      writeFileSync(join(dir, "extract.json"), JSON.stringify(extract));
      const r = run(dir, join(dir, "extract.json"), join(dir, "station.json"), join(dir, "a.json"));
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(readFileSync(join(dir, "a.json"), "utf8")) as Anchors;
      expect(out.counts).toMatchObject({ stair_flights: 1, stair_nosings: 3, duplicate_nosings_dropped: 3 });
      const f = out.stair_flights[0]!;
      expect(f.steps).toBe(3);
      expect(f.nosings.map((n) => n[4])).toEqual([0.15, 0.3, 0.45]); // one surveyed representation, nothing averaged
      expect(f.nosings.map((n) => n[1])).toEqual([2, 2, 2]); // the original body's nosings (y 0 to 2), not the shifted twin's
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses an extract whose GML is not the one station.json pins", () => {
    const dir = mkdtempSync(join(tmpdir(), "gt-anchors-"));
    try {
      fixture(dir);
      writeFileSync(join(dir, "station.json"), JSON.stringify({ sources: [{ sha256: { "fixture.gml": "cd".repeat(32) } }] }));
      const r = run(dir, join(dir, "extract.json"), join(dir, "station.json"), join(dir, "a.json"));
      expect(r.status).not.toBe(0);
      expect(existsSync(join(dir, "a.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const extract = join(STATION, "build", "ubld_enu.json");
  it.skipIf(!existsSync(extract))("regenerates the committed file byte for byte from build/ubld_enu.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "gt-anchors-"));
    try {
      const r = run(dir, extract, join(STATION, "gteki", "station.json"), join(dir, "out.json"));
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(join(dir, "out.json"), "utf8")).toBe(readFileSync(COMMITTED, "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
