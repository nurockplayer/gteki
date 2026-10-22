// kit_catalog.json / kit_placements.json: the Lane E station catalog for stair and escalator dressing, generated
// from dressing_anchors.json by pipeline/build_kit_catalog.py. Checks the catalog against the generator contract
// in tools/blender (PR #143; Blender is not needed here), the placements against the anchors, and determinism.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATION = join(HERE, "..");
const SCRIPT = join(STATION, "pipeline", "build_kit_catalog.py");
const read = (name: string) => readFileSync(join(HERE, name), "utf8");

type V3 = [number, number, number];
interface Entry {
  id: string;
  generator: string;
  params: Record<string, unknown>;
  dimension_basis: string;
  notes: string;
  tags: string[];
}
interface Placement {
  anchor: string;
  kind: "stair" | "escalator";
  ids: Record<string, string>;
  origin: V3;
  dir: [number, number];
  yaw_deg: number;
  mirror: boolean;
  incline_deg?: number;
}
interface Skipped { anchor: string; kind: string; reason: string }
interface Anchors {
  source: { gml: string; gml_sha256: string };
  stair_flights: { id: string; steps: number; rise_m: number; bottom: { position: V3 } }[];
  escalator_lanes: { id: string; rise_m: number; run_m: number; lower: { position: V3; dir: [number, number] } }[];
}

const anchors = JSON.parse(read("dressing_anchors.json")) as Anchors;
const anchorsSha = createHash("sha256").update(readFileSync(join(HERE, "dressing_anchors.json"))).digest("hex");
const catalog = JSON.parse(read("kit_catalog.json")) as { catalog: string; version: string; notes: string; assets: Entry[] };
const placed = JSON.parse(read("kit_placements.json")) as {
  source: { dressing_anchors_sha256: string; gml_sha256: string };
  summary: { unique_ids: number; skipped: Skipped[]; stair_flights: Record<string, number>; escalator_lanes: Record<string, number> };
  placements: Placement[];
};
const station = JSON.parse(readFileSync(join(STATION, "gteki", "station.json"), "utf8")) as { sources: { id: string; sha256?: Record<string, string> }[] };
const gmlSha = station.sources.find((s) => s.id === "plateau-ubld-13116")!.sha256![anchors.source.gml]!;
const byId = new Map(catalog.assets.map((a) => [a.id, a]));

describe("kit_catalog.json", () => {
  it("has the Lane E catalog shape, with valid unique ids", () => {
    expect(catalog.catalog).toBe("gteki-ikebukuro");
    expect(catalog.version).toBe("0.1.0");
    expect(catalog.notes.length).toBeGreaterThan(0);
    const ids = catalog.assets.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^gteki_[a-z0-9_]+$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(placed.summary.unique_ids).toBe(ids.length);
    for (const a of catalog.assets) {
      expect(["stair_dressing", "escalator_dressing"]).toContain(a.generator);
      expect(a.tags.length).toBeGreaterThan(0);
    }
  });

  it("cites the survey for every station-verified entry", () => {
    expect(gmlSha).toBe(anchors.source.gml_sha256);
    expect(placed.source.dressing_anchors_sha256).toBe(anchorsSha);
    for (const a of catalog.assets) {
      expect(a.dimension_basis).toBe("station-verified");
      expect(a.notes).toContain(anchorsSha);
      expect(a.notes).toContain(gmlSha);
      expect(a.notes).toContain("plateau-ubld-13116");
      const users = placed.placements.filter((p) => Object.values(p.ids).includes(a.id));
      expect(users.length).toBeGreaterThan(0);
      for (const p of users) expect(a.notes).toContain(p.anchor); // flight or lane id
    }
  });

  it("uses only parameters the generators accept", () => {
    for (const a of catalog.assets) {
      const p = a.params;
      const positive = (...keys: string[]) => keys.forEach((k) => expect(typeof p[k] === "number" && (p[k] as number) > 0).toBe(true));
      if (a.generator === "stair_dressing") {
        expect(Number.isInteger(p.step_count) && (p.step_count as number) >= 2 && (p.step_count as number) <= 80).toBe(true);
        positive("riser_mm", "tread_mm", "width_mm");
        expect(p.riser_mm as number).toBeGreaterThanOrEqual(100);
        expect(p.riser_mm as number).toBeLessThanOrEqual(225);
        expect(p.tread_mm as number).toBeGreaterThanOrEqual(200);
        // one bake role per GLB: a nosing-only piece (stairs_ramps) or a rail-only piece (barriers), never mixed
        expect([["nosing"], ["handrail"]]).toContainEqual(p.parts);
        if (a.id.endsWith("_nosing")) expect(p.parts).toEqual(["nosing"]);
        else {
          expect(a.id).toMatch(/_rails_(post|wall)$/);
          expect(p.handrail_sides).toBe("both");
          expect(p.rail_mount).toBe(a.id.endsWith("_wall") ? "wall" : "post");
        }
        for (const k of Object.keys(p)) expect(["step_count", "riser_mm", "tread_mm", "width_mm", "parts", "handrail_sides", "rail_mount"]).toContain(k);
      } else {
        positive("rise_mm", "width_mm", "angle_deg", "landing_mm");
        expect(p.run_mm).toBeUndefined(); // run_mm or angle_deg, not both: the surveyed quad gives the angle
        expect(p.direction).toBeUndefined(); // not surveyed
        expect(p.treads).toBe(true);
        expect(p.parts).toEqual(["balustrade", "handrail", "newel", "comb"]);
        expect(a.notes).toContain("Direction not surveyed");
        expect(a.notes).toContain("clear gap between surveyed truss plates");
        expect(p.angle_deg as number).toBeGreaterThanOrEqual(15);
        expect(p.angle_deg as number).toBeLessThanOrEqual(35);
        expect(a.id).toBe(`gteki_ik_escalator_w${p.width_mm}_rise${p.rise_mm}_a${Math.round((p.angle_deg as number) * 100)}`);
        for (const k of Object.keys(p)) expect(["rise_mm", "width_mm", "angle_deg", "landing_mm", "treads", "parts"]).toContain(k);
      }
    }
  });
});

/** The surveyed quad is the straight incline between the floors: angle = atan2(rise, horizontal run). */
function angleDeg(rise: number, run: number): number {
  return (Math.atan2(rise, run) * 180) / Math.PI;
}

/** Lane E: the bottom comb (asset origin) is 1.2 m before the quad's lower line along dir, at the lower floor height. */
const COMB_OFFSET_M = 1.2;

describe("kit_placements.json", () => {
  const placements = new Map(placed.placements.map((p) => [p.anchor, p]));
  const skipped = new Set(placed.summary.skipped.map((s) => s.anchor));

  it("maps every non-skipped flight and lane to existing ids, and every skip has a reason", () => {
    expect(placements.size).toBe(placed.placements.length);
    const all = [...anchors.stair_flights.map((f) => f.id), ...anchors.escalator_lanes.map((l) => l.id)];
    for (const id of all) expect(placements.has(id) !== skipped.has(id)).toBe(true); // exactly one of the two
    expect(placements.size + skipped.size).toBe(all.length);
    for (const s of placed.summary.skipped) expect(s.reason.length).toBeGreaterThan(10);
    for (const p of placed.placements) {
      for (const id of Object.values(p.ids)) expect(byId.has(id)).toBe(true);
      if (p.kind === "stair") expect(Object.keys(p.ids).sort()).toEqual(["nosing", "rails"]);
      else expect(Object.keys(p.ids)).toEqual(["dressing"]);
    }
    for (const id of catalog.assets.map((a) => a.id)) expect(placed.placements.some((p) => Object.values(p.ids).includes(id))).toBe(true);
    expect(placed.summary.stair_flights.covered).toBe(placed.placements.filter((p) => p.kind === "stair").length);
    expect(placed.summary.escalator_lanes.covered).toBe(placed.placements.filter((p) => p.kind === "escalator").length);
    // the flights the planner flagged as implausible stay out
    for (const id of ["stair040", "stair059"]) expect(skipped.has(id)).toBe(true);
  });

  it("puts each origin within 5 mm of the anchor's first-nosing floor point or bottom comb line", () => {
    for (const f of anchors.stair_flights) {
      const p = placements.get(f.id);
      if (!p) continue;
      // survey riser; the nosing line is one riser above the floor under it
      const riser = f.rise_m / (f.steps - 1);
      const expected: V3 = [f.bottom.position[0], f.bottom.position[1], f.bottom.position[2] - riser];
      for (let k = 0; k < 3; k++) expect(Math.abs(p.origin[k]! - expected[k]!)).toBeLessThanOrEqual(0.005);
      const entry = byId.get(p.ids.nosing!)!;
      expect(entry.params.step_count).toBe(f.steps);
    }
    for (const l of anchors.escalator_lanes) {
      const p = placements.get(l.id);
      if (!p) continue;
      const expected: V3 = [l.lower.position[0] - COMB_OFFSET_M * l.lower.dir[0], l.lower.position[1] - COMB_OFFSET_M * l.lower.dir[1], l.lower.position[2]];
      for (let k = 0; k < 3; k++) expect(Math.abs(p.origin[k]! - expected[k]!)).toBeLessThanOrEqual(0.005);
      const e = byId.get(p.ids.dressing!)!;
      expect(Math.abs((e.params.angle_deg as number) - angleDeg(l.rise_m, l.run_m))).toBeLessThanOrEqual(0.005);
    }
  });

  it("keeps escalator angles in 15-35 degrees and yaw consistent with dir", () => {
    for (const p of placed.placements) {
      expect(p.mirror).toBe(false);
      expect(Math.hypot(p.dir[0], p.dir[1])).toBeCloseTo(1, 3);
      const yaw = (p.yaw_deg * Math.PI) / 180; // local +Y rotated CCW about +Z
      expect(-Math.sin(yaw)).toBeCloseTo(p.dir[0], 2);
      expect(Math.cos(yaw)).toBeCloseTo(p.dir[1], 2);
      if (p.kind !== "escalator") continue;
      const e = byId.get(p.ids.dressing!)!;
      const angle = e.params.angle_deg as number;
      expect(p.incline_deg).toBe(angle);
      expect(angle).toBeGreaterThanOrEqual(15);
      expect(angle).toBeLessThanOrEqual(35);
    }
  });
});

describe("build_kit_catalog.py", () => {
  it("is deterministic and reproduces the committed files", () => {
    const dirs = [mkdtempSync(join(tmpdir(), "kit-a-")), mkdtempSync(join(tmpdir(), "kit-b-"))];
    try {
      for (const d of dirs) {
        const r = spawnSync("python3", ["-I", SCRIPT, "--out-dir", d], { encoding: "utf8" });
        expect(r.status, r.stderr).toBe(0);
      }
      for (const name of ["kit_catalog.json", "kit_placements.json"]) {
        const a = readFileSync(join(dirs[0]!, name), "utf8");
        expect(readFileSync(join(dirs[1]!, name), "utf8")).toBe(a);
        expect(a).toBe(read(name));
      }
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });
});
