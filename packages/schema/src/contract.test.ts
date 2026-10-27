import { describe, expect, it } from "vitest";
import { asRealStation, createSyntheticBundle, syntheticEdge as edge } from "../../navigation/src/fixtures.ts";
import { dataFileFactsOnlySources, isOpenAt, parseHm, parseStationFiles, validateBundle } from "./index.ts";
import type { ApproximatePosition, BuildingHours, CoverageArea, CoverageText, DataFile, GraphFile, HoursSpec, HoursText, Poi, PoiFile, StationBundle, StationManifestFile, Weekday } from "./index.ts";

const ev = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
const DECISION = { url: "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", date: "2026-10-21" };
const errors = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "error").map((i) => i.code);
const warnings = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "warning").map((i) => i.code);

function split(b: StationBundle): [StationManifestFile, GraphFile, PoiFile] {
  const { nodes, edges, pois, ...rest } = b;
  return [
    {
      schema: rest.schema, station: rest.station, sources: rest.sources, floors: rest.floors, coverage: rest.coverage,
      ...(rest.spawnNodeIds ? { spawnNodeIds: rest.spawnNodeIds } : {}),
      ...(rest.spawnHeadings ? { spawnHeadings: rest.spawnHeadings } : {}),
      ...(rest.buildingHours ? { buildingHours: rest.buildingHours } : {}),
    },
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
    const b = asRealStation(createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]));
    const ref = b.sources.find((s) => s.id === "fixture-access")!;
    ref.rights = "REFERENCE_ONLY";
    expect(warnings(b)).toContain("source.rights");
    ref.usage = "facts-only";
    ref.decision = DECISION;
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
  it("relaxes publication rights only for private-tier parsing", () => {
    const b = asRealStation(createSyntheticBundle());
    const restricted = { ...b.sources[0]!, id: "restricted-source", rights: "RESTRICTED" as const };
    b.sources.push(restricted);
    b.nodes[0]!.sourceRefs = [{ sourceId: restricted.id, featureId: "restricted-plan" }];
    for (const e of b.edges) e.verification = "verified";
    const [m, g, p] = split(b);
    expect(parseStationFiles(m, g, p).ok).toBe(false);
    const privateParsed = parseStationFiles(m, g, p, undefined, { privateTier: true });
    expect(privateParsed.ok).toBe(true);
    expect(privateParsed.issues).toContainEqual(expect.objectContaining({ code: "node.source.rights", level: "warning" }));

    g.edges[0]!.to = "missing-node";
    expect(parseStationFiles(m, g, p, undefined, { privateTier: true }).ok).toBe(false);
  });

  it("loads the three station files into one bundle", () => {
    const parsed = parseStationFiles(...split(createSyntheticBundle()));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.edges).toHaveLength(3);
  });

  it("parses optional spawn headings and validates their spawn-node keys", () => {
    const b = createSyntheticBundle();
    b.spawnNodeIds = ["start"];
    b.spawnHeadings = { start: 90 };
    const parsed = parseStationFiles(...split(b));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.spawnHeadings).toEqual({ start: 90 });

    b.spawnHeadings = { missing: 90 };
    expect(parseStationFiles(...split(b)).issues.map((issue) => issue.code)).toContain("spawn.heading.node");
  });

  it("rejects non-number spawn headings and leaves absent headings absent", () => {
    const b = createSyntheticBundle();
    const [manifest, graph, pois] = split(b);
    const parsed = parseStationFiles(manifest, graph, pois);
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle).not.toHaveProperty("spawnHeadings");
    (manifest as unknown as { spawnHeadings: unknown }).spawnHeadings = { start: "east" };
    expect(parseStationFiles(manifest, graph, pois).issues.map((issue) => issue.code)).toContain("shape.type");
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

  it("accepts an optional string uriMobile on an asset and refuses other types", () => {
    const [m, g, p] = split(createSyntheticBundle());
    m.assets = [{ id: "a", uri: "assets/a.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"], uriMobile: "assets/a.mobile.glb" }];
    expect(parseStationFiles(m, g, p).ok).toBe(true);
    (m.assets[0] as { uriMobile: unknown }).uriMobile = 3;
    expect(parseStationFiles(m, g, p).issues[0]).toMatchObject({ code: "shape.type" });
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

describe("coverage text: a plain string or localized text (#259)", () => {
  const area = (sourceId: string, note?: CoverageText): CoverageArea => ({
    id: "area:test", floorId: null, status: "routable", label: [{ lang: "en", text: "Whole station" }], sourceIds: [sourceId],
    ...(note === undefined ? {} : { note }),
  });

  it("keeps legacy plain-string gap text and area notes validating and parsing unchanged", () => {
    const b = createSyntheticBundle();
    b.coverage.gaps = [{ id: "gap:test", floorId: null, zone: "All levels", missingFact: "Hours", fieldWorkNeeded: "Field check", approximateExtent: "Whole station" }];
    b.coverage.areas = [area(b.sources[0]!.id, "One language only")];
    expect(errors(b)).toEqual([]);
    expect(parseStationFiles(...split(b)).ok).toBe(true);
  });

  it("accepts localized gap text and area notes and carries them through parsing", () => {
    const b = createSyntheticBundle();
    b.coverage.gaps = [{
      id: "gap:test", floorId: null,
      zone: [{ lang: "ja", text: "全フロア" }, { lang: "en", text: "All levels" }],
      missingFact: [{ lang: "ja", text: "営業時間" }],
      approximateExtent: [{ lang: "ja", text: "駅全体" }],
      fieldWorkNeeded: [{ lang: "en", text: "Field check" }],
    }];
    b.coverage.areas = [area(b.sources[0]!.id, [{ lang: "ja", text: "補足" }])];
    expect(errors(b)).toEqual([]);
    const parsed = parseStationFiles(...split(b));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.coverage.gaps[0]?.zone).toEqual([{ lang: "ja", text: "全フロア" }, { lang: "en", text: "All levels" }]);
  });

  it("rejects gap text that is neither a string nor complete localized text", () => {
    for (const bad of [42, null, { lang: "ja", text: "an object, not an array" }, [{ lang: "ja" }], [{ text: "no lang" }], ["plain entry"]]) {
      const b = createSyntheticBundle();
      b.coverage.gaps = [{ id: "gap:test", floorId: null, zone: bad as never, missingFact: "Hours", fieldWorkNeeded: "Field check" }];
      expect(parseStationFiles(...split(b)).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an area note that is neither a string nor complete localized text", () => {
    for (const bad of [42, null, { lang: "ja", text: "an object, not an array" }, [{ lang: "ja" }]]) {
      const b = createSyntheticBundle();
      b.coverage.areas = [area(b.sources[0]!.id, bad as never)];
      const parsed = parseStationFiles(...split(b));
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
      // The checker names the exact defect: an incomplete text entry is shape.missing, a non-text value shape.type.
      expect(parsed.issues.map((i) => i.code)).toContain(Array.isArray(bad) ? "shape.missing" : "shape.type");
    }
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

  it("rejects public edge geometry derived from non-reusable sources, as for assets", () => {
    for (const rights of ["REFERENCE_ONLY", "RESTRICTED", "UNVERIFIED"] as const) {
      const b = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
      b.station.synthetic = false;
      b.sources.find((s) => s.id === "fixture-geometry")!.rights = rights;
      // Default `data` usage: the source warning alone used to let the geometry through.
      expect(errors(b)).toContain("edge.geometry.rights");
    }
    // A rights value outside the enum (even an empty string) is an error and never passes as reusable.
    const blank = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
    blank.station.synthetic = false;
    (blank.sources.find((s) => s.id === "fixture-geometry")! as { rights: string }).rights = "";
    blank.assets = [{ id: "x", uri: "assets/x.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"] }];
    expect(errors(blank)).toEqual(expect.arrayContaining(["source.rights.value", "edge.geometry.rights", "asset.rights"]));
    const synthetic = createSyntheticBundle();
    synthetic.sources.find((s) => s.id === "fixture-geometry")!.rights = "REFERENCE_ONLY";
    expect(errors(synthetic)).not.toContain("edge.geometry.rights");
  });

  it("rejects a drawn geometry with fewer than two points instead of drawing a straight fallback", () => {
    for (const geometry of [[], [{ x: 10, y: 0, z: 0 }]]) {
      const b = createSyntheticBundle([edge("v", "start", "goal", { geometry })]);
      expect(errors(b)).toContain("edge.geometry.points");
    }
    const ok = createSyntheticBundle([edge("v", "start", "goal", { geometry: [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }] })]);
    expect(errors(ok)).not.toContain("edge.geometry.points");
    expect(errors(createSyntheticBundle([edge("v", "start", "goal")]))).not.toContain("edge.geometry.points");
  });

  it("rejects evidence records that name no source", () => {
    const geometry = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
    geometry.edges[0]!.geometryEvidence = { ...geometry.edges[0]!.geometryEvidence, sourceIds: [] };
    expect(errors(geometry)).toContain("edge.evidence");
    const access = createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]);
    access.edges[0]!.accessEvidence = { ...access.edges[0]!.accessEvidence!, sourceIds: [] };
    expect(errors(access)).toContain("edge.evidence");
    const hours = createSyntheticBundle([edge("v", "start", "goal", { hours: { kind: "always", evidence: { sourceIds: [], method: "synthetic-fixture", checkedDate: "2026-10-20" } } })]);
    expect(errors(hours)).toContain("edge.evidence");
    const poi = createSyntheticBundle();
    poi.pois[0]!.evidence = { ...poi.pois[0]!.evidence, sourceIds: [] };
    expect(errors(poi)).toContain("poi.evidence");
    expect(errors(createSyntheticBundle())).toEqual([]);
  });

  it("applies the geometry rights gate to node position sources", () => {
    for (const rights of ["REFERENCE_ONLY", "RESTRICTED", "UNVERIFIED"] as const) {
      const b = createSyntheticBundle();
      b.station.synthetic = false;
      b.edges = [];
      b.sources.find((s) => s.id === "fixture-access")!.rights = rights;
      b.nodes[0]!.sourceRefs = [{ sourceId: "fixture-access", featureId: "n1" }];
      expect(errors(b)).toContain("node.source.rights");
      // The same source cited only as facts elsewhere is fine; only the node position is gated.
      b.nodes[0]!.sourceRefs = [{ sourceId: "fixture-geometry", featureId: "n1" }];
      expect(errors(b)).not.toContain("node.source.rights");
    }
    const factsOnly = createSyntheticBundle();
    factsOnly.sources.find((s) => s.id === "fixture-access")!.usage = "facts-only";
    factsOnly.nodes[0]!.sourceRefs = [{ sourceId: "fixture-access", featureId: "n1" }];
    expect(errors(factsOnly)).toContain("node.source.rights");
    const synthetic = createSyntheticBundle();
    synthetic.sources.find((s) => s.id === "fixture-access")!.rights = "REFERENCE_ONLY";
    synthetic.nodes[0]!.sourceRefs = [{ sourceId: "fixture-access", featureId: "n1" }];
    expect(errors(synthetic)).not.toContain("node.source.rights");
  });

  it("requires a JGD2011 station origin", () => {
    for (const datum of ["WGS84", "jgd2011", ""]) {
      const b = createSyntheticBundle();
      (b.station.origin as { datum: string }).datum = datum;
      expect(errors(b)).toContain("station.origin.datum");
    }
    expect(errors(createSyntheticBundle())).not.toContain("station.origin.datum");
  });

  it("requires position provenance for every node of a real station", () => {
    const b = createSyntheticBundle();
    b.station.synthetic = false;
    b.edges = [];
    for (const n of b.nodes) n.sourceRefs = [{ sourceId: "fixture-geometry", featureId: n.id }];
    expect(errors(b)).not.toContain("node.source");
    b.nodes[0]!.sourceRefs = [];
    expect(errors(b)).toContain("node.source");
    // Synthetic fixtures may stay without per-node references.
    expect(errors(createSyntheticBundle())).not.toContain("node.source");
  });

  it("needs a reusable geometric basis for POI display positions and coverage polygons", () => {
    const real = () => {
      const b = createSyntheticBundle();
      b.station.synthetic = false;
      b.edges = [];
      for (const n of b.nodes) n.sourceRefs = [{ sourceId: "fixture-geometry", featureId: n.id }];
      b.sources.find((s) => s.id === "fixture-access")!.usage = "facts-only";
      b.sources.find((s) => s.id === "fixture-access")!.decision = DECISION;
      b.sources.find((s) => s.id === "fixture-access")!.rights = "REFERENCE_ONLY";
      b.coverage.areas = [{ id: "area", floorId: "concourse", status: "routable", label: [], polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], sourceIds: ["fixture-geometry", "fixture-access"] }];
      return b;
    };
    // A reusable source alongside a facts-only citation is fine.
    expect(errors(real())).toEqual([]);
    const facts = real();
    facts.pois[0]!.evidence = { ...facts.pois[0]!.evidence, sourceIds: ["fixture-access"] };
    facts.coverage.areas[0]!.sourceIds = ["fixture-access"];
    expect(errors(facts)).toEqual(expect.arrayContaining(["poi.position.rights", "coverage.polygon.rights"]));
    // Without a drawn position or polygon, facts-only citations stay allowed.
    facts.pois[0]!.displayPosition = null;
    delete facts.coverage.areas[0]!.polygon;
    expect(errors(facts)).toEqual([]);
    const empty = real();
    empty.coverage.areas[0]!.sourceIds = [];
    expect(errors(empty)).toContain("coverage.source");
  });

  it("keeps approximate positions search-display-only: no connectors, no displayPosition, a reusable source (#463)", () => {
    const approximate = (over: Partial<ApproximatePosition> = {}): ApproximatePosition => ({
      east: 12.5, north: -3, uncertaintyM: 25, method: "area_weighted_centroid",
      navigationUse: "NOT_FOR_ROUTING", floor: "UNVERIFIED", ...over,
    });
    const place = (over: Partial<Poi> = {}) => {
      const b = createSyntheticBundle();
      Object.assign(b.pois[0]!, { connectorNodeIds: [], displayPosition: null, approximatePosition: approximate() }, over);
      return b;
    };
    // A well-formed approximate point round-trips through the shape check and validates clean.
    const parsed = parseStationFiles(...split(place()));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.pois[0]!.approximatePosition).toEqual(approximate());
    expect(errors(place())).toEqual([]);
    // Malformed values are shape errors, never silently kept.
    for (const bad of [
      { ...approximate(), east: Number.NaN },
      { ...approximate(), north: Number.POSITIVE_INFINITY },
      { ...approximate(), uncertaintyM: 0 },
      { ...approximate(), uncertaintyM: -1 },
      { ...approximate(), method: "" },
      { ...approximate(), method: "   " },
      { ...approximate(), navigationUse: "ROUTING" },
      { ...approximate(), floor: "VERIFIED" },
      { ...approximate(), uncertaintyM: "25" },
    ]) {
      const shaped = parseStationFiles(...split(place({ approximatePosition: bad as unknown as ApproximatePosition })));
      expect(shaped.ok, JSON.stringify(bad)).toBe(false);
      expect(shaped.issues.map((i) => i.code), JSON.stringify(bad)).toContain("shape.type");
    }
    // An approximate point can never be routed to or treated as a precise display position.
    expect(errors(place({ connectorNodeIds: ["a"] }))).toContain("poi.approximate.routing");
    expect(errors(place({ displayPosition: { x: 0, y: 0, z: 0 } }))).toContain("poi.approximate.display");
    // On a real station it needs a reusable data source, which may be REUSABLE_WITH_CONDITIONS.
    const real = (rights: "REUSABLE_WITH_CONDITIONS" | "REFERENCE_ONLY") => {
      const b = asRealStation(place());
      b.edges = [];
      b.sources.push({ ...b.sources[0]!, id: "approx-source", rights });
      b.pois[0]!.evidence = { sourceIds: ["approx-source"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
      return b;
    };
    expect(errors(real("REUSABLE_WITH_CONDITIONS"))).toEqual([]);
    expect(errors(real("REFERENCE_ONLY"))).toContain("poi.approximate.rights");
  });

  it("keeps printed hours honest: where they came from, when they were read, and whether anything was printed (OD-32)", () => {
    const hours = (over: Partial<HoursText> = {}): HoursText => ({
      text: "月～土 10:00～21:00\n日・祝 10:00～19:30", sourceUrl: "https://example.org/shop", retrievedAt: "2026-10-24",
      basis: "undated-official", status: "OK", ...over,
    });
    const place = (over: Partial<Poi> = {}) => {
      const b = createSyntheticBundle();
      Object.assign(b.pois[0]!, over);
      return b;
    };
    // A well-formed row round-trips through the shape check and validates clean.
    const parsed = parseStationFiles(...split(place({ hours: hours() })));
    expect(parsed.ok).toBe(true);
    expect(parsed.bundle?.pois[0]!.hours).toEqual(hours());
    expect(errors(place({ hours: hours() }))).toEqual([]);
    // A page that printed nothing says so; empty text passed off as hours is refused.
    expect(errors(place({ hours: hours({ status: "UNKNOWN", text: undefined }) }))).toEqual([]);
    expect(errors(place({ hours: hours({ text: "   " }) }))).toContain("hours.text");
    // The provenance the app shows with the text: a real date, a link to the page, and whose word it is.
    expect(errors(place({ hours: hours({ retrievedAt: "2026-10" }) }))).toContain("hours.date");
    expect(errors(place({ hours: hours({ sourceUrl: "example.org/shop" }) }))).toContain("hours.url");
    expect(errors(place({ hours: hours({ basis: "guess" as HoursText["basis"] }) }))).toContain("hours.basis");
    expect(errors(place({ hours: hours({ status: "MAYBE" as HoursText["status"] }) }))).toContain("hours.status");
    // Shape: a missing field is an error, never an implicit default.
    const shaped = parseStationFiles(...split(place({ hours: { text: "10:00～21:00" } as unknown as HoursText })));
    expect(shaped.ok).toBe(false);
    expect(shaped.issues.map((i) => i.code)).toContain("shape.missing");
    // Building-level rows are shared hours for many shops, so they need a building name and the same provenance.
    const building = (over: Partial<BuildingHours> = {}): BuildingHours => ({
      building: [{ lang: "ja", text: "ルミネ池袋" }], floorRange: "B1～7F", note: [{ lang: "ja", text: "店舗により異なる場合あり" }], ...hours(), ...over,
    });
    const shared = (over: Partial<BuildingHours> = {}) => {
      const b = createSyntheticBundle();
      b.buildingHours = [building(over)];
      return b;
    };
    const built = parseStationFiles(...split(shared()));
    expect(built.ok).toBe(true);
    expect(built.bundle?.buildingHours).toEqual([building()]);
    expect(errors(shared())).toEqual([]);
    expect(errors(shared({ building: [] }))).toContain("buildingHours.building");
    expect(errors(shared({ status: "OK", text: undefined }))).toContain("hours.text");
  });

  it("refuses a printed-hours reading dated in the future (OD-32)", () => {
    const b = createSyntheticBundle();
    Object.assign(b.pois[0]!, { hours: { text: "10:00～21:00", sourceUrl: "https://example.org/shop", retrievedAt: "2999-01-01", basis: "undated-official", status: "OK" } });
    expect(errors(b)).toContain("hours.date");
    // A reading from today is fine: only dates after today are refused.
    const today = new Date().toISOString().slice(0, 10);
    Object.assign(b.pois[0]!, { hours: { text: "10:00～21:00", sourceUrl: "https://example.org/shop", retrievedAt: today, basis: "undated-official", status: "OK" } });
    expect(errors(b)).not.toContain("hours.date");
  });

  it("keeps unknown and symbolic floor elevations null and rejects unknown elevation sources", () => {
    for (const elevationSource of ["unknown", "symbolic"] as const) {
      const b = createSyntheticBundle();
      b.floors[0]!.elevationSource = elevationSource;
      expect(errors(b)).toContain("floor.elevation");
    }
    const bad = createSyntheticBundle();
    (bad.floors[0] as { elevationSource: string }).elevationSource = "guessed";
    expect(errors(bad)).toContain("floor.elevation");
  });

  it("gives declared data files the asset source and rights gate, and refuses bad paths", () => {
    const withData = (dataFiles: DataFile[], real = false) => {
      const b = createSyntheticBundle();
      b.dataFiles = dataFiles;
      return errors(real ? asRealStation(b) : b);
    };
    const ok: DataFile = { id: "plan", path: "data/plan.json", sourceIds: ["fixture-geometry"], modified: false };
    expect(withData([ok])).toEqual([]);
    // dataFiles live outside gteki/ (any case: macOS is case-insensitive): contract files and anything else under it are refused (assets[] covers that folder).
    for (const bad of ["../x.json", "data//x.json", "data/x#1.json", "/abs.json", "data/x.ts", "gteki/station.json", "gteki/graph.json", "gteki/assets/b1.meta.json", "GTEKI/station.json", "Gteki/graph.json"])
      expect(withData([{ ...ok, path: bad }]), bad).toContain("data.path");
    // ?raw imports of svg/shader text can be declared.
    for (const good of ["scene/sign.svg", "scene/fog.glsl", "scene/a.vert", "scene/a.frag", "scene/a.wgsl"])
      expect(withData([{ ...ok, path: good }]), good).toEqual([]);
    expect(withData([ok, { ...ok, path: "data/other.json" }])).toContain("data.dup");
    expect(withData([ok, { ...ok, id: "plan2" }])).toContain("data.dup");
    expect(withData([{ ...ok, sourceIds: ["nope"] }])).toContain("data.source");
    // A real station's data needs a source, and public data cannot derive from a reference-only one.
    expect(withData([{ ...ok, sourceIds: [] }], true)).toContain("data.source");
    const traced = createSyntheticBundle();
    traced.station.synthetic = false;
    traced.edges = [];
    traced.sources[0]!.rights = "REFERENCE_ONLY";
    traced.dataFiles = [ok];
    expect(errors(traced)).toContain("data.rights");
  });

  it("accepts a source under the Owner override for data files, like isShippableRights elsewhere", () => {
    const b = createSyntheticBundle();
    b.station.synthetic = false;
    b.edges = [];
    const src = b.sources[0]!;
    src.rights = "PUBLISHED_UNDER_OWNER_OVERRIDE";
    src.override = { decision: "#130", date: "2026-10-22" };
    src.license = { name: "unconfirmed", url: "https://example.org/terms" };
    b.dataFiles = [{ id: "plan", path: "data/plan.json", sourceIds: [src.id], modified: false }];
    expect(errors(b)).not.toContain("data.rights");
  });

  it("lets data files cite facts-only sources, but only with a derivation (#186/#26)", () => {
    const real = () => {
      const b = createSyntheticBundle();
      b.station.synthetic = false;
      b.edges = [];
      b.sources.push({ ...b.sources[0]!, id: "facts", usage: "facts-only", rights: "REFERENCE_ONLY", decision: DECISION });
      b.sources.push({ ...b.sources[0]!, id: "ref", rights: "REFERENCE_ONLY" });
      return b;
    };
    const file: DataFile = { id: "signage", path: "scene/signage.json", sourceIds: ["fixture-geometry", "facts"], modified: true, derivation: "pipeline/build_signage.py: measured positions; labels are facts from the guide." };
    const b = real();
    b.dataFiles = [file];
    expect(errors(b)).not.toContain("data.rights");
    expect(errors(b)).not.toContain("data.derivation");
    // Derivation is required and non-empty when modified or when a facts-only source is cited.
    for (const derivation of [undefined, "", "  "]) {
      for (const modified of [true, false]) {
        b.dataFiles = [{ ...file, modified, derivation }];
        expect(errors(b), `${modified} ${JSON.stringify(derivation)}`).toContain("data.derivation");
      }
    }
    b.dataFiles = [{ id: "d", path: "scene/d.json", sourceIds: ["fixture-geometry"], modified: true }];
    expect(errors(b)).toContain("data.derivation");
    b.dataFiles = [{ id: "d", path: "scene/d.json", sourceIds: ["fixture-geometry"], modified: false }];
    expect(errors(b)).not.toContain("data.derivation");
    // Any other non-shippable source is still refused, alongside a facts-only one.
    b.dataFiles = [{ ...file, sourceIds: ["facts", "ref"] }];
    expect(errors(b).filter((c) => c === "data.rights")).toHaveLength(1);
  });

  it("lets an authored data file declare no source, but only with a derivation saying so (#252)", () => {
    const real = () => {
      const b = createSyntheticBundle();
      b.station.synthetic = false;
      b.edges = [];
      return b;
    };
    const authored: DataFile = { id: "finishes", path: "scene/finishes.json", sourceIds: [], modified: false, authored: true, derivation: "GTEki-authored scene config: not derived from any source." };
    const b = real();
    b.dataFiles = [authored];
    expect(errors(b)).not.toContain("data.source");
    expect(errors(b)).not.toContain("data.derivation");
    // Nothing to credit: it cites no source, so it cannot show up as citing a facts-only one.
    expect(dataFileFactsOnlySources(b)).toEqual([]);
    // Authored still means no sources at all.
    const cites = real();
    cites.dataFiles = [{ ...authored, sourceIds: ["fixture-geometry"] }];
    expect(errors(cites)).toContain("data.source");
    // The derivation is required and non-empty for an authored file, whatever `modified` says.
    for (const derivation of [undefined, "", "  "]) {
      for (const modified of [false, true]) {
        const missing = real();
        missing.dataFiles = [{ ...authored, modified, derivation }];
        expect(errors(missing), `${modified} ${JSON.stringify(derivation)}`).toContain("data.derivation");
      }
    }
    // A declared file that is not authored still needs provenance on a real station.
    const plain = real();
    plain.dataFiles = [{ id: "x", path: "scene/x.json", sourceIds: [], modified: false, derivation: "d" }];
    expect(errors(plain)).toContain("data.source");
    // And the field round-trips through parseStationFiles.
    const [manifest, graph, pois] = split(createSyntheticBundle());
    const roundTrip = parseStationFiles({ ...manifest, dataFiles: [authored] }, graph, pois);
    expect(roundTrip.ok && roundTrip.bundle.dataFiles).toEqual([authored]);
  });

  it("lists data files that cite facts-only sources for the build log", () => {
    const b = createSyntheticBundle();
    b.sources.push({ ...b.sources[0]!, id: "facts-a", usage: "facts-only" }, { ...b.sources[0]!, id: "facts-b", usage: "facts-only" });
    expect(dataFileFactsOnlySources(b)).toEqual([]);
    b.dataFiles = [
      { id: "plain", path: "scene/plain.json", sourceIds: ["fixture-geometry"], modified: false },
      { id: "signage", path: "scene/signage.json", sourceIds: ["fixture-geometry", "facts-a", "facts-b", "facts-a"], modified: true, derivation: "d" },
      { id: "lanes", path: "scene/lanes.json", sourceIds: ["facts-b"], modified: false, derivation: "d" },
    ];
    expect(dataFileFactsOnlySources(b)).toEqual([
      { dataFileId: "signage", path: "scene/signage.json", factsOnlySourceIds: ["facts-a", "facts-b"] },
      { dataFileId: "lanes", path: "scene/lanes.json", factsOnlySourceIds: ["facts-b"] },
    ]);
  });

  it("round-trips dataFiles through parseStationFiles and rejects malformed entries", () => {
    const b = createSyntheticBundle();
    const [manifest, graph, pois] = split(b);
    const withData = { ...manifest, dataFiles: [{ id: "plan", path: "data/plan.json", sourceIds: ["fixture-geometry"], modified: false }] };
    const ok = parseStationFiles(withData, graph, pois);
    expect(ok.ok && ok.bundle.dataFiles).toEqual(withData.dataFiles);
    expect(parseStationFiles({ ...manifest, dataFiles: [{ id: "plan", path: 3, sourceIds: [], modified: false }] }, graph, pois).ok).toBe(false);
    expect(parseStationFiles({ ...manifest, dataFiles: [{ id: "plan", path: "data/plan.json", sourceIds: [] }] }, graph, pois).ok).toBe(false);
    expect(parseStationFiles({ ...manifest, dataFiles: "plan.json" }, graph, pois).ok).toBe(false);
  });

  it("checks declared asset files like the asset uri, and refuses ? and # in either", () => {
    const withFiles = (uri: string, files: string[]) => {
      const b = createSyntheticBundle();
      b.assets = [{ id: "a", uri, format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"], files }];
      return errors(b);
    };
    expect(withFiles("assets/a.glb", ["assets/a_lightmap.webp", "assets/a.meta.json"])).toEqual([]);
    for (const bad of ["../x.webp", "assets//x.webp", "assets/x#1.webp", "assets/x?.webp", "/abs.webp", "station.json", "assets/x.exe"])
      expect(withFiles("assets/a.glb", [bad])).toContain("asset.files");
    for (const bad of ["assets/roof#west.glb", "assets/roof?west.glb"]) expect(withFiles(bad, [])).toContain("asset.uri");
  });

  it("checks uriMobile like the asset uri", () => {
    const withMobile = (uriMobile: string) => {
      const b = createSyntheticBundle();
      b.assets = [{ id: "a", uri: "assets/a.glb", uriMobile, format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"] }];
      return errors(b);
    };
    expect(withMobile("assets/mobile/a.glb")).toEqual([]);
    for (const bad of ["../a.glb", "assets//a.glb", "assets/a#1.glb", "/abs.glb", "assets/a.gltf", "assets/a.webp", "assets/a.glb"])
      expect(withMobile(bad), bad).toContain("asset.uri");
  });

  it("gates known floor heights on reusable sources and drawing them as known", () => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    expect(errors(b)).not.toContain("floor.elevation.rights");
    b.sources.push({ ...b.sources[0]!, id: "facts", usage: "facts-only" }, { ...b.sources[0]!, id: "ref", rights: "REFERENCE_ONLY" });
    for (const sourceId of ["facts", "ref"]) {
      b.floors[1]!.sourceLabels = [{ ...b.floors[1]!.sourceLabels[0]!, sourceId }];
      expect(errors(b)).toContain("floor.elevation.rights");
    }
    b.floors[1]!.elevationM = null;
    b.floors[1]!.elevationSource = "unknown";
    expect(errors(b)).not.toContain("floor.elevation.rights");

    const drawn = createSyntheticBundle();
    expect(errors(drawn)).not.toContain("floor.renderElevation");
    drawn.floors[1]!.renderElevationM = drawn.floors[1]!.elevationM! + 2;
    expect(errors(drawn)).toContain("floor.renderElevation");
    drawn.floors[1]!.elevationM = null;
    drawn.floors[1]!.elevationSource = "symbolic";
    expect(errors(drawn)).not.toContain("floor.renderElevation");
  });

  it("requires credit metadata on the sources of a real station", () => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    expect(errors(b)).not.toContain("source.attribution");
    expect(errors(b)).not.toContain("source.license");
    expect(errors(b)).not.toContain("source.url");
    for (const url of ["", "not a url", "ftp://example.org/data", "javascript:alert(1)"]) {
      b.sources[0]!.url = url;
      expect(errors(b)).toContain("source.url");
    }
    b.sources[0]!.url = "https://example.org/dataset";
    b.sources[0]!.attribution = "  ";
    b.sources[1]!.license = null;
    expect(errors(b)).toContain("source.attribution");
    expect(errors(b)).toContain("source.license");
    b.sources[1]!.license = { name: "CC BY 4.0", url: "javascript:alert(1)" };
    expect(errors(b)).toContain("source.license");
    // A facts-only source is cited as evidence, never redistributed: it needs a credit line, not a licence.
    b.sources[1]!.usage = "facts-only";
    b.sources[1]!.license = null;
    expect(errors(b).filter((c) => c === "source.license")).toEqual([]);
    // ...but it is still cited, so it still needs a landing URL.
    b.sources[1]!.url = "";
    expect(errors(b)).toContain("source.url");
  });

  it("accepts plain and localized licence names and rejects empty names", () => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    const src = b.sources.find((s) => s.id === "fixture-access")!;
    src.license = { name: "Legacy licence", url: "https://example.org/licence" };
    expect(errors(b)).not.toContain("source.license");
    src.license = { name: [{ lang: "ja", text: "日本語のライセンス" }, { lang: "en", text: "English licence" }], url: "https://example.org/licence" };
    expect(errors(b)).not.toContain("source.license");
    for (const name of ["", "  ", [], [{ lang: "ja", text: "" }], [{ lang: " ", text: "Licence" }]]) {
      src.license = { name: name as string | import("./index.ts").LocalizedText[], url: "https://example.org/licence" };
      expect(errors(b), JSON.stringify(name)).toContain("source.license");
    }
  });

  it("requires a full derivation record whenever an asset has a summary", () => {
    const b = createSyntheticBundle();
    b.assets = [{
      id: "summary-only", uri: "assets/summary-only.glb", format: "glb", floorIds: [], role: "visual",
      sourceIds: ["fixture-access"], derivationSummary: [{ lang: "en", text: "Model simplified for display" }],
    }];
    const [manifest, graph, pois] = split(b);
    manifest.assets = b.assets;
    const missing = parseStationFiles(manifest, graph, pois);
    expect(missing.ok).toBe(false);
    expect(missing.issues.map((issue) => issue.code)).toContain("asset.derivationSummary");

    for (const derivation of ["", "  "]) {
      manifest.assets![0]!.derivation = derivation;
      const parsed = parseStationFiles(manifest, graph, pois);
      expect(parsed.ok, JSON.stringify(derivation)).toBe(false);
      expect(parsed.issues.map((issue) => issue.code), JSON.stringify(derivation)).toContain("asset.derivationSummary");
    }
  });

  it("requires the #26 decision reference on a real facts-only source", () => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    const src = b.sources.find((s) => s.id === "fixture-access")!;
    src.rights = "REFERENCE_ONLY";
    src.license = null;
    src.usage = "facts-only";
    expect(errors(b)).toContain("source.decision");
    src.decision = DECISION;
    expect(errors(b)).not.toContain("source.decision");
    // A malformed decision is an error and no longer satisfies the rule.
    for (const bad of [{ url: "javascript:alert(1)", date: "2026-10-21" }, { url: DECISION.url, date: "2026-10" }, { url: DECISION.url, date: "2026-02-30" }]) {
      src.decision = bad;
      expect(errors(b)).toContain("source.decision");
    }
    // Synthetic stations and licensed data sources are not asked for it.
    src.decision = undefined;
    b.station.synthetic = true;
    expect(errors(b)).not.toContain("source.decision");
    const data = asRealStation(createSyntheticBundle());
    data.edges = [];
    expect(errors(data)).not.toContain("source.decision");
    // A decision on a non-facts-only source is still shape-checked.
    data.sources[0]!.decision = { url: "ftp://example.org/x", date: "2026-10-21" };
    expect(errors(data)).toContain("source.decision");
  });

  it("fails closed on a malformed source decision instead of throwing", () => {
    const parse = (decision: unknown) => {
      const [m, g, p] = split(createSyntheticBundle());
      (m.sources[0] as { decision?: unknown }).decision = decision;
      return parseStationFiles(m, g, p);
    };
    expect(parse(DECISION).ok).toBe(true);
    for (const bad of [null, "x", [], {}, { url: DECISION.url }, { url: 1, date: "2026-10-21" }, { url: DECISION.url, date: null }]) {
      const parsed = parse(bad);
      expect(parsed.ok).toBe(false);
      expect(parsed.issues.map((i) => i.code)).toEqual(expect.arrayContaining([expect.stringMatching(/^shape\./)]));
    }
    // validateBundle itself must not throw on a hand-built bundle with a wrong-typed decision.
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    for (const bad of [null, "x", 5]) {
      (b.sources[0] as { decision?: unknown }).decision = bad;
      expect(() => validateBundle(b)).not.toThrow();
      expect(errors(b)).toContain("source.decision");
    }
  });

  it("rejects origin coordinates outside the geodetic range", () => {
    const b = createSyntheticBundle();
    expect(errors(b)).not.toContain("station.origin.range");
    for (const [lat, lon] of [[139, 35], [35, 200], [-91, 0], [Number.NaN, 139]] as const) {
      const bad = createSyntheticBundle();
      bad.station.origin = { ...bad.station.origin, lat, lon };
      expect(errors(bad)).toContain("station.origin.range");
    }
  });

  it("requires a source for every floor of a real station", () => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    expect(errors(b)).not.toContain("floor.source");
    b.floors[1]!.sourceLabels = [];
    expect(errors(b)).toContain("floor.source");
    const synthetic = createSyntheticBundle();
    synthetic.floors[1]!.sourceLabels = [];
    expect(errors(synthetic)).not.toContain("floor.source");
  });

  it("rejects access flags that contradict the edge mode", () => {
    expect(errors(createSyntheticBundle([edge("s", "start", "a", { mode: "stairs", steps: false, wheelchair: false })]))).toContain("edge.access.mode");
    expect(errors(createSyntheticBundle([edge("s", "start", "a", { mode: "stairs", steps: true, wheelchair: true })]))).toContain("edge.access.mode");
    expect(errors(createSyntheticBundle([edge("e", "start", "a", { mode: "escalator", wheelchair: true })]))).toContain("edge.access.mode");
    expect(errors(createSyntheticBundle([edge("s", "start", "a", { mode: "stairs" }), edge("e", "a", "goal", { mode: "escalator", steps: null })]))).not.toContain("edge.access.mode");
  });

  it("rejects unknown coverage status values", () => {
    const b = createSyntheticBundle();
    b.coverage.areas = [{ id: "a", floorId: null, status: "routeable" as "routable", label: [], sourceIds: ["fixture-geometry"] }];
    expect(errors(b)).toContain("coverage.status");
    b.coverage.areas[0]!.status = "visual_only";
    expect(errors(b)).not.toContain("coverage.status");
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

describe("review round 2: optional nested fields fail closed", () => {
  it("refuses malformed optional notes, downloadUrls, sha256, attributes and usage", () => {
    const cases: ((m: StationManifestFile, g: GraphFile, p: PoiFile) => void)[] = [
      (_m, _g, p) => { (p.pois[0] as { notes?: unknown }).notes = [{ lang: "ja" }]; },
      (m) => { (m.sources[0] as { downloadUrls?: unknown }).downloadUrls = [{}]; },
      (m) => { (m.sources[0] as { sha256?: unknown }).sha256 = { "a.zip": 1 }; },
      (_m, g) => { (g.edges[0] as { attributes?: unknown }).attributes = { width: { m: 2 } }; },
      (m) => { (m.sources[0] as { usage?: unknown }).usage = "sometimes"; },
      (m) => { (m.station as { codes?: unknown }).codes = "E27"; },
    ];
    for (const mutate of cases) {
      const [m, g, p] = split(createSyntheticBundle());
      mutate(m, g, p);
      expect(parseStationFiles(m, g, p).ok).toBe(false);
    }
    const [m, g, p] = split(createSyntheticBundle());
    (p.pois[0] as { notes?: unknown }).notes = [{ lang: "ja", text: "始発〜終電" }];
    (m.sources[0] as { downloadUrls?: unknown }).downloadUrls = ["https://example.invalid/a.zip"];
    expect(parseStationFiles(m, g, p).ok).toBe(true);
  });
});

describe("PR #15 Codex review: validator gaps", () => {
  it("checks hours evidence sources like geometry and access evidence", () => {
    const missing = { ...ev, sourceIds: ["no-such-source"] };
    const always = createSyntheticBundle([edge("h", "start", "goal", { hours: { kind: "always", evidence: missing } })]);
    expect(errors(always)).toContain("edge.evidence");
    const window = createSyntheticBundle([edge("h", "start", "goal", { hours: { kind: "window", open: "09:00", close: "18:00", evidence: missing } })]);
    expect(errors(window)).toContain("edge.evidence");
    expect(errors(createSyntheticBundle([edge("h", "start", "goal", { hours: { kind: "always", evidence: ev } })]))).toEqual([]);
  });

  it("rejects known polyline endpoint heights that disagree with known node heights", () => {
    const line = (z0: number | null, z1: number | null, geometryZ?: "symbolic") => createSyntheticBundle([edge("p", "start", "goal", {
      lengthM: null, ...(geometryZ ? { geometryZ } : {}), geometry: [{ x: 0, y: 0, z: z0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: z1 }],
    })]);
    expect(errors(line(3, 0))).toContain("edge.geometry.endpoints.z");
    expect(errors(line(0, -0.5))).toContain("edge.geometry.endpoints.z");
    expect(errors(line(0.05, 0))).not.toContain("edge.geometry.endpoints.z");
    // Exactly at the tolerance passes at any absolute height (1.1 - 1 is 0.10000000000000009 in floating point).
    const raised = line(1.1, 0);
    raised.nodes.find((n) => n.id === "start")!.position.z = 1;
    expect(errors(raised)).not.toContain("edge.geometry.endpoints.z");
    raised.edges[0]!.geometry![0]!.z = 1.11;
    expect(errors(raised)).toContain("edge.geometry.endpoints.z");
    expect(errors(line(null, null))).not.toContain("edge.geometry.endpoints.z");
    expect(errors(line(3, 0, "symbolic"))).not.toContain("edge.geometry.endpoints.z");
    // An unknown node height is never contradicted.
    const unknownNode = line(3, 0);
    unknownNode.nodes.find((n) => n.id === "start")!.position.z = null;
    expect(errors(unknownNode)).not.toContain("edge.geometry.endpoints.z");
  });

  it("rejects projective asset transforms that Godot refuses", () => {
    const withTransform = (transform: number[]) => {
      const b = createSyntheticBundle();
      b.assets = [{ id: "glb", uri: "scene.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"], transform }];
      return errors(b);
    };
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    expect(withTransform(identity)).not.toContain("asset.transform");
    for (const i of [3, 7, 11]) {
      const m = [...identity]; m[i] = 0.5;
      expect(withTransform(m)).toContain("asset.transform");
    }
    const w = [...identity]; w[15] = 2;
    expect(withTransform(w)).toContain("asset.transform");
  });
});

describe("coverage provenance (PR #15 Codex review)", () => {
  it("rejects coverage areas that cite unknown sources", () => {
    const b = createSyntheticBundle();
    expect(errors(b)).not.toContain("coverage.source");
    b.coverage.areas.push({ id: "area-x", floorId: null, status: "unverified", label: [{ lang: "en", text: "x" }], sourceIds: ["no-such-source"] });
    expect(errors(b)).toContain("coverage.source");
  });
});

describe("fifth GitHub review round (PR #15): canonical asset paths and ISO dates", () => {
  const assetErrors = (uri: string) => {
    const b = createSyntheticBundle();
    b.assets = [{ id: "glb", uri, format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"] }];
    return errors(b);
  };

  it("accepts only canonical slash-separated relative .glb paths", () => {
    expect(assetErrors("assets/station.glb")).not.toContain("asset.uri");
    for (const bad of ["./assets/station.glb", "assets/./station.glb", "assets//station.glb", "assets\\station.glb", "a:b.glb", "/abs.glb", "../x.glb", "assets/station.gltf"])
      expect(assetErrors(bad), bad).toContain("asset.uri");
  });

  it("requires zero-padded YYYY-MM-DD evidence check dates", () => {
    const b = createSyntheticBundle([edge("e", "start", "goal", { geometryEvidence: { ...ev, checkedDate: "2026-9-30" } })]);
    expect(errors(b)).toContain("edge.evidence.date");
    const hours = createSyntheticBundle([edge("e", "start", "goal", { hours: { kind: "always", evidence: { ...ev, checkedDate: "2026-02-30" } } })]);
    expect(errors(hours)).toContain("edge.evidence.date");
    const poi = createSyntheticBundle();
    poi.pois[0]!.evidence = { ...poi.pois[0]!.evidence, checkedDate: "20261020" };
    expect(errors(poi)).toContain("poi.evidence.date");
    expect(errors(createSyntheticBundle())).toEqual([]);
  });

  it("allows a source to state only its year or month, but never a malformed date", () => {
    const withDate = (datasetDate: string | null) => {
      const b = createSyntheticBundle();
      b.sources[0]!.datasetDate = datasetDate;
      return errors(b);
    };
    for (const good of [null, "2023", "2022-01", "2026-09-17"]) expect(withDate(good), String(good)).not.toContain("source.date");
    for (const bad of ["2022-1", "2022-13", "2026-02-29", "Sept 2025", "2026-09-17T00:00Z"]) expect(withDate(bad), bad).toContain("source.date");
  });
});

describe("late-opening windows (PR #15 Codex review 6)", () => {
  const w = (open: string, close: string): HoursSpec => ({ kind: "window", open, close, evidence: ev });
  it("wraps a close before an after-midnight open as often as needed", () => {
    // 25:00–00:30 on Monday's service day: Tuesday 01:00 through Wednesday 00:30.
    expect(isOpenAt(w("25:00", "00:30"), { weekday: "tue", minutes: 60 })).toBe(true);
    expect(isOpenAt(w("25:00", "00:30"), { weekday: "tue", minutes: 23 * 60 })).toBe(true);
    expect(isOpenAt(w("25:00", "00:30"), { weekday: "wed", minutes: 15 })).toBe(true);
    expect(isOpenAt(w("25:00", "00:30"), { weekday: "tue", minutes: 15 })).toBe(true); // Sunday's window
    expect(isOpenAt(w("25:00", "00:30"), { weekday: "tue", minutes: 45 })).toBe(false); // between windows (exclusive close)
  });
  it("keeps an explicit 24-hour span such as 05:00–29:00", () => {
    expect(isOpenAt(w("05:00", "29:00"), { weekday: "tue", minutes: 60 })).toBe(true);
    expect(errors(createSyntheticBundle([edge("h", "start", "goal", { hours: w("05:00", "29:00") })]))).not.toContain("edge.hours");
  });

  it("treats clock-equal ends as UNKNOWN and rejects them in validation", () => {
    expect(isOpenAt(w("24:00", "00:00"), { weekday: "mon", minutes: 60 })).toBeNull();
    const b = createSyntheticBundle([edge("h", "start", "goal", { hours: w("24:00", "00:00") })]);
    expect(errors(b)).toContain("edge.hours");
  });
});

describe("PUBLISHED_UNDER_OWNER_OVERRIDE rights (#130)", () => {
  const OVERRIDE = { decision: "https://github.com/nurockplayer/gteki/issues/130", date: "2026-10-22" };
  const overridden = (override?: unknown, license: { name: string; url: string } | null = { name: "Licence unconfirmed", url: "https://example.org/terms" }) => {
    const b = asRealStation(createSyntheticBundle());
    b.edges = [];
    const src = b.sources.find((s) => s.id === "fixture-access")!;
    src.rights = "PUBLISHED_UNDER_OWNER_OVERRIDE";
    src.license = license;
    (src as { override?: unknown }).override = override;
    return b;
  };

  it("ships like REUSABLE_WITH_CONDITIONS when the override is recorded", () => {
    const b = overridden(OVERRIDE);
    expect(errors(b)).not.toContain("source.override");
    expect(errors(b)).not.toContain("source.rights.value");
    expect(warnings(b)).not.toContain("source.rights");
    // An issue reference is accepted as well as a URL.
    for (const decision of ["#130", "nurockplayer/gteki#130"]) expect(errors(overridden({ ...OVERRIDE, decision }))).not.toContain("source.override");
  });

  it("is an error without an override reference or with a malformed one", () => {
    expect(errors(overridden(undefined))).toContain("source.override");
    for (const bad of [null, "x", {}, { decision: "see chat", date: "2026-10-22" }, { decision: OVERRIDE.decision }, { decision: OVERRIDE.decision, date: "2026-10" }, { decision: OVERRIDE.decision, date: "2026-02-30" }])
      expect(errors(overridden(bad))).toContain("source.override");
  });

  it("needs licence text", () => {
    expect(errors(overridden(OVERRIDE, null))).toContain("source.override");
    expect(errors(overridden(OVERRIDE, { name: " ", url: "https://example.org/terms" }))).toContain("source.override");
  });

  it("lets geometry ship: nodes, edges, assets, POIs and coverage polygons derived from an override source validate clean", () => {
    const geometry = (rights: "PUBLISHED_UNDER_OWNER_OVERRIDE" | "UNVERIFIED") => {
      const b = asRealStation(createSyntheticBundle([edge("v", "start", "goal", { verification: "verified" })]));
      const src = b.sources.find((s) => s.id === "fixture-geometry")!;
      src.rights = rights;
      if (rights === "PUBLISHED_UNDER_OWNER_OVERRIDE") (src as { override?: unknown }).override = OVERRIDE;
      b.assets = [{ id: "x", uri: "assets/x.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["fixture-geometry"] }];
      b.coverage.areas = [{ id: "area", floorId: "concourse", status: "routable", label: [], polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], sourceIds: ["fixture-geometry"] }];
      return b;
    };
    expect(errors(geometry("PUBLISHED_UNDER_OWNER_OVERRIDE"))).toEqual([]);
    // The same bundle with an unverified source is refused at every geometry gate.
    expect(errors(geometry("UNVERIFIED"))).toEqual(expect.arrayContaining([
      "node.source.rights", "edge.geometry.rights", "asset.rights", "poi.position.rights", "coverage.polygon.rights",
    ]));
  });

  it("warns, without erroring, when an override is recorded on a source whose rights is not the override value", () => {
    const b = overridden(OVERRIDE);
    b.sources.find((s) => s.id === "fixture-access")!.rights = "REUSABLE_WITH_CONDITIONS";
    expect(errors(b)).toEqual([]);
    expect(warnings(b)).toContain("source.override");
    expect(warnings(overridden(OVERRIDE))).not.toContain("source.override");
    // A malformed record on a non-override source is still an error.
    const bad = overridden({ decision: "see chat", date: "2026-10-22" });
    bad.sources.find((s) => s.id === "fixture-access")!.rights = "REUSABLE_WITH_CONDITIONS";
    expect(errors(bad)).toContain("source.override");
  });

  it("fails closed on a wrong-shaped override at parse time", () => {
    const [m, g, p] = split(overridden(OVERRIDE));
    expect(parseStationFiles(m, g, p).ok).toBe(true);
    (m.sources.find((s) => s.id === "fixture-access") as { override?: unknown }).override = "x";
    expect(parseStationFiles(m, g, p).ok).toBe(false);
  });
});
