// kit_catalog.json / kit_placements.json: the Lane E station catalog for stair and escalator dressing, generated
// from dressing_anchors.json by pipeline/build_kit_catalog.py. Checks the catalog against the generator contract
// in tools/blender (PR #143; Blender is not needed here), the placements against the anchors, and determinism.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  ao_res: number;
  anchor: string;
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
  main_route?: boolean;
  tiers: Record<string, string[]>;
  quantisation_mm?: { riser_mm: number; top_height_mm: number };
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
  summary: {
    unique_ids: number;
    skipped: Skipped[];
    stair_flights: Record<string, number>;
    escalator_lanes: Record<string, number>;
    main_route: { flights: string[]; flight_count: number; rails_ids: number; routes: Record<string, { stairs_edge: boolean; flights: string[] }> };
  };
  placements: Placement[];
};
const station = JSON.parse(readFileSync(join(STATION, "gteki", "station.json"), "utf8")) as { sources: { id: string; sha256?: Record<string, string> }[] };
const gmlSha = station.sources.find((s) => s.id === "plateau-ubld-13116")!.sha256![anchors.source.gml]!;
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const WIDE_NOSINGS = [
  "gteki_ik_stair_n21_r142_t300_w3055_nosing",
  "gteki_ik_stair_n15_r164_t308_w8376_nosing",
  "gteki_ik_stair_n19_r168_t328_w4347_nosing",
  "gteki_ik_stair_n13_r165_t302_w8323_nosing",
  "gteki_ik_stair_n10_r147_t302_w10522_nosing",
];

describe("kit_catalog.json", () => {
  it("pins exactly the five wide nosings to 256 px AO and all other nosings to 128 px", () => {
    const nosings = catalog.assets.filter((a) => a.id.endsWith("_nosing"));
    expect(nosings.filter((a) => a.ao_res === 256).map((a) => a.id).sort()).toEqual([...WIDE_NOSINGS].sort());
    for (const a of nosings) expect(a.ao_res, a.id).toBe(WIDE_NOSINGS.includes(a.id) ? 256 : 128);
  });

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
      // Placement class (docs/assets/asset-contract.md): stairs and escalators are linear runs, so the Godot and
      // validate checks are the linear_run ones, not the generic floor-pivot defaults.
      expect(a.anchor, a.id).toBe("linear_run");
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
          expect(Number.isInteger(p.rail_segments) && (p.rail_segments as number) >= 6 && (p.rail_segments as number) <= 16).toBe(true);
          expect(p.rail_segments).toBe(6);
          expect(p.post_spacing_mm).toBeUndefined(); // generator default
        }
        for (const k of Object.keys(p)) expect(["step_count", "riser_mm", "tread_mm", "width_mm", "parts", "handrail_sides", "rail_mount", "rail_segments"]).toContain(k);
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

  it("keeps stair risers numeric and encodes the same value in each riser id", () => {
    for (const a of catalog.assets.filter((entry) => entry.generator === "stair_dressing")) {
      const riser = a.params.riser_mm as number;
      expect(typeof riser).toBe("number");
      expect(Number.isInteger(riser) || Number.isInteger(riser * 10)).toBe(true);
      const token = Number.isInteger(riser) ? String(riser) : String(Math.round(riser * 10));
      expect(a.id.match(/_r(\d+)_t/)?.[1], a.id).toBe(token);
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
    // the planner flags the 196 mm tread of stair068 and every flight where a surveyed nosing would sit more than the
    // 6 mm strip height off the strips the generator builds: stair013 has genuinely uneven risers (~21 mm) and stays
    // skipped after both riser precisions; four long flights are covered by the 0.1 mm fallback. stair057 (on a golden
    // route) sits at exactly 6.0 mm and stays. stair040 (two overlapping survey solids, once read as a
    // 19-step flight with an 82 mm riser) and the 1-step stair059 fragment are now one 10-step flight that is covered
    expect([...skipped]).toEqual(["stair013", "stair068"]);
    const reason = (id: string) => placed.summary.skipped.find((s: { anchor: string }) => s.anchor === id)!.reason;
    expect(reason("stair013")).toMatch(/^nosing mismatch:.*both tried/);
    expect(reason("stair068")).toMatch(/implausible tread 196 mm/);
    expect(placements.has("stair040")).toBe(true);
    expect(anchors.stair_flights.find((f) => f.id === "stair040")!.steps).toBe(10);
  });

  it("keeps every built stair's top drift within the 6 mm strip and the rescued flights under 6 mm", () => {
    for (const p of placed.placements.filter((placement) => placement.kind === "stair")) {
      expect(p.quantisation_mm!.top_height_mm).toBeLessThanOrEqual(6);
    }
    for (const id of ["stair011", "stair012", "stair014", "stair027"]) {
      const p = placements.get(id);
      expect(p).toBeDefined();
      expect(p!.quantisation_mm!.top_height_mm).toBeLessThan(6);
      const nosing = byId.get(p!.ids.nosing!)!;
      const riser = nosing.params.riser_mm as number;
      expect(Number.isInteger(riser)).toBe(false);
      expect(Number.isInteger(riser * 10)).toBe(true);
      expect(nosing.id.match(/_r(\d+)_t/)?.[1]).toBe(String(Math.round(riser * 10)));
    }
    expect(placements.has("stair013")).toBe(false);
    expect(skipped.has("stair013")).toBe(true);
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

describe("per-tier dressing subsets", () => {
  const stairs = placed.placements.filter((p) => p.kind === "stair");
  const mainFlights = placed.summary.main_route.flights;
  const goldens = JSON.parse(
    readFileSync(join(STATION, "..", "..", "tests", "e2e", "specs", "__goldens__", "02-navigation.spec.ts", "ikebukuro-routes.json"), "utf8"),
  ) as Record<string, { result?: { steps?: string[] } }>;
  const graph = JSON.parse(readFileSync(join(STATION, "gteki", "graph.json"), "utf8")) as { edges: { id: string; mode: string }[] };
  const mode = new Map(graph.edges.map((e) => [e.id, e.mode]));

  it("marks main-route flights among the covered ones, with nosings on both tiers and rails on high only", () => {
    const covered = new Set(stairs.map((p) => p.anchor));
    expect(mainFlights.length).toBe(placed.summary.main_route.flight_count);
    for (const id of mainFlights) expect(covered.has(id)).toBe(true);
    expect(stairs.filter((p) => p.main_route).map((p) => p.anchor).sort()).toEqual([...mainFlights].sort());
    for (const p of stairs) {
      expect(typeof p.main_route).toBe("boolean");
      expect(p.tiers.nosing).toEqual(["low", "high"]);
      expect(p.tiers.rails).toEqual(p.main_route ? ["high"] : []);
    }
    for (const p of placed.placements) for (const tiers of Object.values(p.tiers)) for (const tier of tiers) expect(["low", "high"]).toContain(tier);
    // no rails and no escalators on the low tier
    for (const p of placed.placements) {
      if (p.kind === "stair") expect(p.tiers.rails).not.toContain("low");
      else expect(p.tiers).toEqual({ dressing: ["high"] });
    }
    expect(new Set(stairs.filter((p) => p.main_route).map((p) => p.ids.rails)).size).toBe(placed.summary.main_route.rails_ids);
  });

  it("has a main-route flight for every golden route that walks a stairs edge", () => {
    const withStairs = Object.entries(goldens)
      .filter(([, r]) => (r.result?.steps ?? []).some((s) => mode.get(s.slice(1)) === "stairs"))
      .map(([id]) => id);
    expect(withStairs.length).toBeGreaterThan(0);
    for (const id of withStairs) {
      const route = placed.summary.main_route.routes[id]!;
      expect(route.stairs_edge).toBe(true);
      expect(route.flights.length).toBeGreaterThan(0);
      for (const f of route.flights) expect(mainFlights).toContain(f);
    }
    for (const [id, route] of Object.entries(placed.summary.main_route.routes)) if (!withStairs.includes(id)) expect(route.flights).toEqual([]);
  });
});

describe("build_kit_catalog.py", () => {
  it("fails before writing output if a survey no longer produces an AO override id", () => {
    const dir = mkdtempSync(join(tmpdir(), "kit-missing-ao-"));
    try {
      const missingId = WIDE_NOSINGS[0]!;
      const flights = new Set(placed.placements.filter((p) => p.ids.nosing === missingId).map((p) => p.anchor));
      const path = join(dir, "anchors.json");
      const outDir = join(dir, "out");
      writeFileSync(path, JSON.stringify({ ...anchors, stair_flights: anchors.stair_flights.filter((f) => !flights.has(f.id)) }));
      const r = spawnSync("python3", ["-I", SCRIPT, "--anchors", path, "--out-dir", outDir], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toContain(`AO override ids not produced: ${missingId}`);
      expect(existsSync(outDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
