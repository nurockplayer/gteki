import { SCHEMA_VERSION } from "@gteki/schema";
import type { Edge, EvidenceRef, StationBundle } from "@gteki/schema";

/** All coordinates, names and evidence in these fixtures are invented for tests. */
export function syntheticEvidence(sourceId = "fixture-geometry", checkedDate = "2026-10-18"): EvidenceRef {
  return { sourceIds: [sourceId], method: "synthetic-fixture", checkedDate };
}

export function syntheticEdge(id: string, from: string, to: string, overrides: Partial<Edge> = {}): Edge {
  // Access defaults follow the mode, so stairs/escalators never claim to be step-free.
  const mode = overrides.mode ?? "walk";
  return {
    id, from, to, direction: "both", mode: "walk", lengthM: 10,
    paid: false, crossesFareBoundary: false,
    wheelchair: mode !== "stairs" && mode !== "escalator", steps: mode === "stairs",
    hours: { kind: "always", evidence: syntheticEvidence("fixture-access", "2026-10-20") },
    closed: false, verification: "synthetic",
    geometryEvidence: syntheticEvidence(),
    accessEvidence: syntheticEvidence("fixture-access", "2026-10-20"),
    ...overrides,
  };
}

/** Marks a fixture as a real (non-synthetic) station, giving every node the position provenance that requires. */
export function asRealStation(bundle: StationBundle): StationBundle {
  bundle.station.synthetic = false;
  for (const n of bundle.nodes) if (n.sourceRefs.length === 0) n.sourceRefs = [{ sourceId: "fixture-geometry", featureId: n.id }];
  return bundle;
}

/** A fresh, explicitly synthetic bundle; optional edges let tests isolate each truth rule. */
export function createSyntheticBundle(edges?: Edge[]): StationBundle {
  return {
    schema: SCHEMA_VERSION,
    station: {
      id: "synthetic-station", names: [{ lang: "en", text: "Synthetic test station (not for navigation)" }],
      operators: [
        { id: "operator-a", names: [{ lang: "en", text: "Synthetic operator A" }] },
        { id: "operator-b", names: [{ lang: "en", text: "Synthetic operator B" }] },
      ],
      origin: { lat: 35, lon: 139, hM: null, datum: "JGD2011", crs: "EPSG:6668" },
      frame: "ENU", datasetVersion: "synthetic-1", generatedAt: "2026-10-20T00:00:00Z", synthetic: true,
    },
    sources: ["fixture-geometry", "fixture-access"].map((id) => ({
      id, title: "Invented synthetic fixture", publisher: "GTEki tests", url: "https://example.invalid/synthetic",
      license: { name: "GTEki synthetic data (invented; no third-party content)", url: "https://github.com/nurockplayer/gteki" }, rights: "REUSABLE_WITH_CONDITIONS", attribution: "GTEki synthetic test fixture",
      modified: false, retrievedAt: null, datasetDate: null,
    })),
    floors: [
      { id: "concourse", operatorId: "operator-a", label: "B1", elevationM: 0 },
      { id: "upper", operatorId: "operator-a", label: "1F", elevationM: 4 },
      // Identical labels and heights do not make operator-scoped floors equivalent.
      { id: "other-concourse", operatorId: "operator-b", label: "B1", elevationM: 0 },
    ].map(({ label, ...floor }) => ({
      ...floor, sourceLabels: [{ operatorId: floor.operatorId, label, sourceId: "fixture-geometry" }],
      ordinal: null, intermediate: false, elevationSource: "source-derived", renderElevationM: floor.elevationM,
    })),
    nodes: [
      { id: "start", floorId: "concourse", position: { x: 0, y: 0, z: 0 } },
      { id: "a", floorId: "concourse", position: { x: 10, y: 0, z: 0 } },
      { id: "b", floorId: "concourse", position: { x: 0, y: 10, z: 0 } },
      { id: "goal", floorId: "concourse", position: { x: 20, y: 0, z: 0 } },
      { id: "upper", floorId: "upper", position: { x: 10, y: 0, z: 4 } },
      { id: "upper-2", floorId: "upper", position: { x: 20, y: 0, z: 4 } },
      { id: "other", floorId: "other-concourse", position: { x: 20, y: 10, z: 0 } },
      { id: "isolated", floorId: "concourse", position: { x: 50, y: 50, z: 0 } },
    ].map((node) => ({ ...node, kind: "junction", inOut: null, sourceRefs: [] })),
    edges: edges ?? [
      syntheticEdge("start-a", "start", "a"),
      syntheticEdge("a-goal", "a", "goal"),
      syntheticEdge("long-direct", "start", "goal", { lengthM: 30 }),
    ],
    pois: [
      {
        id: "toilet", category: "toilet", names: [{ lang: "ja", text: "トイレ" }, { lang: "en", text: "Restroom" }],
        aliases: [{ lang: "ja-Hrkt", text: "といれ" }, { lang: "ja-Latn", text: "toire" }],
        floorId: "concourse", displayPosition: { x: 10, y: 0, z: 0 }, connectorNodeIds: ["a"], paid: false,
        evidence: syntheticEvidence(),
      },
      {
        id: "exit-a1", category: "exit", names: [{ lang: "ja", text: "Ａ１出口" }, { lang: "en", text: "Exit A1" }],
        aliases: [{ lang: "en", text: "A1" }, { lang: "ja-Latn", text: "a1 deguchi" }],
        floorId: "concourse", displayPosition: { x: 0, y: 0, z: 0 }, connectorNodeIds: ["start"], paid: false,
        evidence: syntheticEvidence(),
      },
      {
        id: "shop", category: "shop", names: [{ lang: "en", text: "Station Shop" }],
        aliases: [{ lang: "zh-Hant", text: "車站商店" }], floorId: "upper",
        displayPosition: { x: 10, y: 0, z: 4 }, connectorNodeIds: [], paid: null, evidence: syntheticEvidence(),
      },
    ],
    coverage: {
      summary: [{ lang: "en", text: "Synthetic fixture only; no real station coverage." }],
      areas: [], gaps: [], freshness: null,
    },
  };
}
