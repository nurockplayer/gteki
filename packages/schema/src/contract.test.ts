import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge as edge } from "../../navigation/src/fixtures.ts";
import { isOpenAt, parseHm, parseStationFiles, validateBundle } from "./index.ts";
import type { GraphFile, HoursSpec, PoiFile, StationBundle, StationManifestFile, Weekday } from "./index.ts";

const ev = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
const errors = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "error").map((i) => i.code);
const warnings = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "warning").map((i) => i.code);

function split(b: StationBundle): [StationManifestFile, GraphFile, PoiFile] {
  const { nodes, edges, pois, ...rest } = b;
  return [
    { schema: rest.schema, station: rest.station, sources: rest.sources, floors: rest.floors, coverage: rest.coverage },
    { schema: b.schema, stationId: b.station.id, nodes, edges },
    { schema: b.schema, stationId: b.station.id, pois },
  ];
}

describe("hours", () => {
  it("parses HH:MM including after-midnight service and rejects malformed text", () => {
    expect(parseHm("05:30")).toBe(330);
    expect(parseHm("25:10")).toBe(1510);
    for (const bad of ["5:30", "24:60", "48:00", "aa:bb", ""]) expect(parseHm(bad)).toBeNull();
  });

  const window = (open: string, close: string, days?: Weekday[]): HoursSpec =>
    days ? { kind: "window", open, close, days, evidence: ev } : { kind: "window", open, close, evidence: ev };

  it("keeps unknown hours unknown and always-open explicit", () => {
    expect(isOpenAt(null, { weekday: "mon", minutes: 600 })).toBeNull();
    expect(isOpenAt({ kind: "always", evidence: ev }, { weekday: "sun", minutes: 0 })).toBe(true);
  });

  it("evaluates a same-day window with an exclusive close", () => {
    const h = window("05:00", "24:00");
    expect(isOpenAt(h, { weekday: "tue", minutes: 299 })).toBe(false);
    expect(isOpenAt(h, { weekday: "tue", minutes: 300 })).toBe(true);
    expect(isOpenAt(h, { weekday: "tue", minutes: 1439 })).toBe(true);
  });

  it("carries a past-midnight window into the next calendar day only for listed service days", () => {
    const h = window("06:00", "25:30", ["sat"]);
    expect(isOpenAt(h, { weekday: "sat", minutes: 23 * 60 })).toBe(true);
    expect(isOpenAt(h, { weekday: "sun", minutes: 60 })).toBe(true); // Saturday service at 01:00 Sunday
    expect(isOpenAt(h, { weekday: "sun", minutes: 120 })).toBe(false);
    expect(isOpenAt(h, { weekday: "sun", minutes: 7 * 60 })).toBe(false); // Sunday not a service day
    expect(isOpenAt(window("22:00", "02:00"), { weekday: "mon", minutes: 60 })).toBe(true);
  });

  it("treats malformed windows as unknown, never as open", () => {
    expect(isOpenAt(window("x", "10:00"), { weekday: "mon", minutes: 300 })).toBeNull();
    expect(isOpenAt(window("10:00", "10:00"), { weekday: "mon", minutes: 600 })).toBeNull();
  });
});

describe("validator truth rules added in v0.1 core", () => {
  it("errors on a same-operator walk jump between unordered floors, warns at landings and transfers", () => {
    const bundle = createSyntheticBundle([edge("teleport", "a", "upper")]);
    expect(errors(bundle)).toContain("floor.change.walk");
    const landing = createSyntheticBundle([edge("landing", "a", "upper")]);
    landing.floors.find((f) => f.id === "upper")!.intermediate = true;
    expect(errors(landing)).not.toContain("floor.change.walk");
    expect(warnings(landing)).toContain("floor.change.walk");
    const transfer = createSyntheticBundle([edge("transfer", "start", "other")]);
    expect(errors(transfer)).toEqual([]);
    expect(warnings(transfer)).toContain("floor.change.walk");
  });

  it("warns when adjacent ordinals of one operator are joined by a walk edge", () => {
    const b = createSyntheticBundle([edge("ramp-like", "a", "upper")]);
    b.floors.find((f) => f.id === "concourse")!.ordinal = -1;
    b.floors.find((f) => f.id === "upper")!.ordinal = 0;
    expect(errors(b)).toEqual([]);
    b.floors.find((f) => f.id === "upper")!.ordinal = 1;
    expect(errors(b)).toContain("floor.change.walk");
  });

  it("allows vertical connectors to change floor", () => {
    for (const mode of ["stairs", "escalator", "elevator", "ramp"] as const)
      expect(errors(createSyntheticBundle([edge("v", "a", "upper", { mode, direction: "forward" })]))).toEqual([]);
  });

  it("rejects malformed hours, unknown enums and bad assets", () => {
    const b = createSyntheticBundle([
      edge("h", "start", "a", { hours: { kind: "window", open: "9:00", close: "18:00", evidence: ev } }),
      edge("d", "a", "goal", { direction: "sideways" as never }),
    ]);
    b.nodes[0]!.kind = "teleporter" as never;
    b.spawnNodeIds = ["nowhere"];
    b.assets = [
      { id: "glb", uri: "../escape.glb", format: "glb", floorIds: ["nope"], role: "visual", sourceIds: ["missing"], transform: [1, 2] },
      { id: "glb", uri: "https://cdn.example/x.glb", format: "glb", floorIds: [], role: "visual", sourceIds: [] },
    ];
    expect(new Set(errors(b))).toEqual(new Set([
      "edge.hours", "edge.direction", "node.kind", "spawn.node", "asset.uri", "asset.floor", "asset.source", "asset.transform", "asset.dup",
    ]));
  });

  it("blocks public assets derived from reference-only sources", () => {
    const b = createSyntheticBundle();
    b.station.synthetic = false;
    b.edges = [];
    b.sources[0]!.rights = "REFERENCE_ONLY";
    b.assets = [{ id: "traced", uri: "assets/traced.glb", format: "glb", floorIds: ["concourse"], role: "visual", sourceIds: ["fixture-geometry"] }];
    expect(errors(b)).toContain("asset.rights");
  });

  it("accepts reference-only sources cited as facts, but never as geometry or asset inputs", () => {
    const b = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
    b.station.synthetic = false;
    const ref = b.sources.find((s) => s.id === "fixture-access")!;
    ref.rights = "REFERENCE_ONLY";
    expect(warnings(b)).toContain("source.rights");
    ref.usage = "facts-only";
    expect(warnings(b)).not.toContain("source.rights");
    expect(errors(b)).toEqual([]);
    b.edges[0]!.geometryEvidence = { ...b.edges[0]!.geometryEvidence, sourceIds: ["fixture-access"] };
    b.assets = [{ id: "x", uri: "assets/x.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-access"] }];
    expect(errors(b)).toEqual(expect.arrayContaining(["edge.geometry.rights", "asset.rights"]));
  });

  it("flags fare crossings that are not gate edges and bidirectional escalators", () => {
    const b = createSyntheticBundle([
      edge("fare", "start", "a", { crossesFareBoundary: true, paid: null }),
      edge("esc", "a", "upper", { mode: "escalator" }),
    ]);
    expect(warnings(b)).toEqual(expect.arrayContaining(["edge.fare.mode", "edge.escalator.direction"]));
  });
});

describe("parseStationFiles (fail-closed JSON loading)", () => {
  it("loads the three station files into one bundle", () => {
    const parsed = parseStationFiles(...split(createSyntheticBundle()));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.edges).toHaveLength(3);
  });

  it("refuses a missing tri-state instead of defaulting it", () => {
    const [m, g, p] = split(createSyntheticBundle());
    delete (g.edges[0] as Partial<typeof g.edges[0]>).wheelchair;
    const parsed = parseStationFiles(m, g, p);
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]).toMatchObject({ code: "shape.missing" });
    expect(parsed.issues[0]!.message).toContain("wheelchair");
  });

  it("refuses wrong types, NaN coordinates and non-object files", () => {
    const [m, g, p] = split(createSyntheticBundle());
    (g.nodes[0]!.position as { x: unknown }).x = "10";
    (g.nodes[1]!.position as { y: unknown }).y = Number.NaN;
    expect(parseStationFiles(m, g, p).issues.map((i) => i.code)).toEqual(["shape.type", "shape.type"]);
    expect(parseStationFiles(null, [], "x").ok).toBe(false);
  });

  it("accepts optional floor displayNames and refuses malformed entries", () => {
    const [m, g, p] = split(createSyntheticBundle());
    m.floors[0]!.displayNames = [{ lang: "ja", text: "地下3階" }, { lang: "en", text: "B3" }];
    expect(parseStationFiles(m, g, p).ok).toBe(true);
    (m.floors[0]!.displayNames as unknown[]).push({ lang: "en" });
    expect(parseStationFiles(m, g, p).issues[0]).toMatchObject({ code: "shape.missing" });
  });

  it("refuses files from different stations or schema versions", () => {
    const [m, g, p] = split(createSyntheticBundle());
    g.stationId = "other";
    (p as { schema: string }).schema = "gteki.station/0.0";
    expect(parseStationFiles(m, g, p).issues.filter((i) => i.level === "error").map((i) => i.code)).toEqual(["file.station", "schema.version"]);
  });

  it("refuses bundles that pass shape but break truth rules", () => {
    const b = createSyntheticBundle([edge("teleport", "a", "upper")]);
    const parsed = parseStationFiles(...split(b));
    expect(parsed.ok).toBe(false);
    expect(parsed.bundle).toBeNull();
  });
});

describe("review regressions: nested fail-closed shape and rights", () => {
  it("refuses hours objects that are not a complete always/window union", () => {
    for (const hours of [{}, { kind: "window", open: "05:00" }, { kind: "sometimes", evidence: ev }, { kind: "always" }]) {
      const [m, g, p] = split(createSyntheticBundle());
      (g.edges[0] as { hours: unknown }).hours = hours;
      const parsed = parseStationFiles(m, g, p);
      expect(parsed.ok, JSON.stringify(hours)).toBe(false);
    }
  });

  it("refuses incomplete operator names, POI text, floor source labels and evidence source lists", () => {
    const cases: ((m: StationManifestFile, g: GraphFile, p: PoiFile) => void)[] = [
      (m) => { (m.station.operators[0] as { names: unknown }).names = [{ lang: "ja" }]; },
      (_m, _g, p) => { (p.pois[0]!.names as unknown[]) = [{ text: "x" }]; },
      (m) => { (m.floors[0]!.sourceLabels as unknown[]) = [{ operatorId: "operator-a" }]; },
      (_m, g) => { (g.edges[0]!.geometryEvidence.sourceIds as unknown[]) = [7]; },
      (_m, _g, p) => { (p.pois[0]!.connectorNodeIds as unknown[]) = [null]; },
    ];
    for (const mutate of cases) {
      const [m, g, p] = split(createSyntheticBundle());
      mutate(m, g, p);
      expect(parseStationFiles(m, g, p).ok).toBe(false);
    }
  });

  it("forbids facts-only geometry even in synthetic bundles", () => {
    const b = createSyntheticBundle();
    expect(b.station.synthetic).toBe(true);
    b.sources.find((s) => s.id === "fixture-geometry")!.usage = "facts-only";
    expect(errors(b)).toContain("edge.geometry.rights");
  });

  it("evaluates windows that spill two calendar days past their service day", () => {
    const w: HoursSpec = { kind: "window", open: "26:00", close: "25:00", days: ["mon"], evidence: ev };
    expect(isOpenAt(w, { weekday: "tue", minutes: 150 })).toBe(true);
    expect(isOpenAt(w, { weekday: "wed", minutes: 30 })).toBe(true);
    expect(isOpenAt(w, { weekday: "wed", minutes: 90 })).toBe(false);
    expect(isOpenAt(w, { weekday: "mon", minutes: 30 })).toBe(false);
  });
});
