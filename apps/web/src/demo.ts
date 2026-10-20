import { SCHEMA_VERSION } from "@gteki/schema";
import type { Edge, EvidenceRef, GraphFile, Node, Poi, PoiFile, StationManifestFile } from "@gteki/schema";

/**
 * Core-owned SYNTHETIC demo station for exercising the shared explorer before/without station
 * data. Every coordinate, name and fact is invented; `synthetic: true` makes the explorer stamp
 * every route as non-navigational. It deliberately contains the hard cases: a paid gate, a
 * one-way escalator, an elevator, a closed passage, unknown hours, a windowed passage, unknown
 * wheelchair access and a cross-operator transfer.
 */

const ev = (checkedDate = "2026-10-20"): EvidenceRef => ({ sourceIds: ["demo-synthetic"], method: "synthetic-fixture", checkedDate });

function node(id: string, floorId: string, x: number, y: number, z: number, kind: Node["kind"] = "junction"): Node {
  return { id, floorId, position: { x, y, z }, kind, inOut: "inside", sourceRefs: [] };
}

function link(id: string, from: string, to: string, extra: Partial<Edge> = {}): Edge {
  return {
    id, from, to, direction: "both", mode: "walk", lengthM: null,
    paid: false, crossesFareBoundary: false, wheelchair: true, steps: false,
    hours: { kind: "always", evidence: ev() }, closed: false, verification: "synthetic",
    geometryEvidence: ev(), accessEvidence: ev(), ...extra,
  };
}

export function createDemoFiles(): [StationManifestFile, GraphFile, PoiFile] {
  const nodes: Node[] = [
    // Street level 1F (z = 0)
    node("exit-a", "d-1f", -64, 26, 0, "exit"), node("exit-b", "d-1f", 64, 26, 0, "exit"),
    node("plaza", "d-1f", 0, 34, 0), node("lift-1f", "d-1f", 6, 30, 0, "elevator"),
    // Unpaid concourse B1 (z = -6)
    node("b1-w", "d-b1", -64, 8, -6, "stair_end"), node("b1-w2", "d-b1", -40, 0, -6), node("b1-c", "d-b1", 0, 0, -6),
    node("b1-e2", "d-b1", 40, 0, -6), node("b1-e", "d-b1", 64, 8, -6, "stair_end"), node("lift-b1", "d-b1", 6, 6, -6, "elevator"),
    node("toilet-door", "d-b1", -20, 6, -6, "facility"), node("locker-door", "d-b1", 22, 6, -6, "facility"),
    node("gate-out", "d-b1", 0, -8, -6, "ticket_gate"),
    // Paid concourse B1 (z = -6)
    node("gate-in", "d-b1", 0, -14, -6, "ticket_gate"), node("paid-w", "d-b1", -30, -20, -6), node("paid-e", "d-b1", 30, -20, -6),
    node("esc-top", "d-b1", -30, -30, -6, "escalator_end"), node("st-top", "d-b1", 30, -30, -6, "stair_end"),
    // Platform B2 (z = -12)
    node("plat-w", "d-b2", -30, -50, -12, "platform"), node("plat-e", "d-b2", 30, -50, -12, "platform"), node("plat-c", "d-b2", 0, -50, -12, "platform"),
    // Other operator, transfer concourse (z = -6, operator-scoped floor)
    node("x-pass", "m-b1", 96, 0, -6), node("x-gate", "m-b1", 120, 0, -6, "ticket_gate"),
  ];
  const edges: Edge[] = [
    link("a-plaza", "exit-a", "plaza"), link("plaza-b", "plaza", "exit-b"), link("plaza-lift", "plaza", "lift-1f"),
    link("st-west", "exit-a", "b1-w", { mode: "stairs", wheelchair: false, steps: true }),
    link("st-east", "exit-b", "b1-e", { mode: "stairs", wheelchair: false, steps: true, hours: null }),
    link("lift", "lift-1f", "lift-b1", { mode: "elevator", lengthM: 6 }),
    link("w-w2", "b1-w", "b1-w2", { geometry: [{ x: -64, y: 8, z: -6 }, { x: -52, y: 0, z: -6 }, { x: -40, y: 0, z: -6 }] }),
    link("w2-toilet", "b1-w2", "toilet-door", { geometry: [{ x: -40, y: 0, z: -6 }, { x: -20, y: 0, z: -6 }, { x: -20, y: 6, z: -6 }] }),
    link("w2-c", "b1-w2", "b1-c"), link("c-e2", "b1-c", "b1-e2"),
    link("e2-e", "b1-e2", "b1-e", { geometry: [{ x: 40, y: 0, z: -6 }, { x: 52, y: 0, z: -6 }, { x: 64, y: 8, z: -6 }] }),
    link("c-lift", "b1-c", "lift-b1"), link("e2-locker", "b1-e2", "locker-door", { geometry: [{ x: 40, y: 0, z: -6 }, { x: 22, y: 0, z: -6 }, { x: 22, y: 6, z: -6 }] }),
    link("c-gate", "b1-c", "gate-out"),
    link("gate", "gate-out", "gate-in", { mode: "gate", paid: null, crossesFareBoundary: true }),
    link("in-w", "gate-in", "paid-w", { paid: true }), link("in-e", "gate-in", "paid-e", { paid: true }),
    link("w-esc", "paid-w", "esc-top", { paid: true }), link("e-st", "paid-e", "st-top", { paid: true }),
    link("esc-down", "esc-top", "plat-w", { mode: "escalator", direction: "forward", paid: true, wheelchair: false, steps: true, lengthM: 24 }),
    link("st-down", "st-top", "plat-e", { mode: "stairs", paid: true, wheelchair: false, steps: true, lengthM: 22 }),
    link("plat-1", "plat-w", "plat-c", { paid: true }), link("plat-2", "plat-c", "plat-e", { paid: true }),
    // Closed by an (invented) evidenced construction notice.
    link("closed-cut", "b1-w2", "gate-out", { closed: true }),
    // Transfer passage to another operator; access facts unknown, hours windowed.
    link("transfer", "b1-e", "x-pass", { wheelchair: null, hours: { kind: "window", open: "05:00", close: "24:30", evidence: ev() } }),
    link("x-walk", "x-pass", "x-gate", { wheelchair: null, hours: null }),
  ];
  // Straight links get their measured (invented) length; the router never guesses lengths.
  const byId = new Map(nodes.map((n) => [n.id, n.position]));
  for (const e of edges) {
    if (e.lengthM !== null || e.geometry) continue;
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    e.lengthM = Math.round(Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)) * 10) / 10;
  }
  const pois: Poi[] = [
    poi("exit-a", "exit", "A出口", "Exit A", ["えーでぐち", "a deguchi"], "d-1f", ["exit-a"], false),
    poi("exit-b", "exit", "B出口", "Exit B", ["びーでぐち", "b deguchi"], "d-1f", ["exit-b"], false),
    poi("toilet", "toilet", "トイレ（改札外）", "Restroom (outside gates)", ["といれ", "toire"], "d-b1", ["toilet-door"], false),
    poi("lockers", "locker", "コインロッカー", "Coin lockers", ["こいんろっかー"], "d-b1", ["locker-door"], false),
    poi("gate", "ticket_gate", "中央改札", "Central gate", ["ちゅうおうかいさつ", "chuo kaisatsu"], "d-b1", ["gate-out"], false),
    poi("elevator", "elevator", "エレベーター（地上⇔B1）", "Elevator (street ⇔ B1)", ["えれべーたー"], "d-1f", ["lift-1f"], false),
    poi("platform", "platform", "1・2番線ホーム", "Platforms 1 & 2", ["ほーむ", "platform 1"], "d-b2", ["plat-c"], true),
    poi("transfer", "transfer", "デモメトロ乗換口", "Demo Metro transfer", ["のりかえ", "transfer"], "m-b1", ["x-gate"], null),
    poi("kiosk", "shop", "デモ売店", "Demo kiosk", ["ばいてん"], "d-b1", [], false), // search-only: no verified entrance
  ];
  const floors: StationManifestFile["floors"] = [
    floor("d-1f", "demo-rail", "1F", 0, 0), floor("d-b1", "demo-rail", "B1", -1, -6),
    floor("d-b2", "demo-rail", "B2", -2, -12), floor("m-b1", "demo-metro", "B1", -1, -6),
  ];
  const manifest: StationManifestFile = {
    schema: SCHEMA_VERSION,
    station: {
      id: "synthetic-demo",
      names: [{ lang: "ja", text: "合成デモ駅（実在しません）" }, { lang: "en", text: "Synthetic demo station (not real)" }],
      operators: [
        { id: "demo-rail", names: [{ lang: "en", text: "Demo Rail (invented)" }] },
        { id: "demo-metro", names: [{ lang: "en", text: "Demo Metro (invented)" }] },
      ],
      origin: { lat: 35, lon: 139, hM: 0, datum: "JGD2011", crs: "EPSG:6668" },
      frame: "ENU", datasetVersion: "core-demo-1", generatedAt: "2026-10-20", synthetic: true,
    },
    sources: [{
      id: "demo-synthetic", title: "GTEki core synthetic demo (invented)", publisher: "GTEki shared core",
      url: "https://github.com/nurockplayer/gteki", license: null, rights: "REUSABLE_WITH_CONDITIONS",
      attribution: "GTEki synthetic demo — not real data", modified: false, retrievedAt: null, datasetDate: "2026-10-20",
    }],
    floors,
    coverage: {
      summary: [{ lang: "en", text: "Invented layout for exercising the explorer. Nothing here describes a real place." }],
      areas: [], gaps: [], freshness: "2026-10-20",
    },
    spawnNodeIds: ["exit-a", "exit-b", "b1-c"],
  };
  return [manifest, { schema: SCHEMA_VERSION, stationId: "synthetic-demo", nodes, edges }, { schema: SCHEMA_VERSION, stationId: "synthetic-demo", pois }];
}

function floor(id: string, operatorId: string, label: string, ordinal: number, z: number): StationManifestFile["floors"][number] {
  return {
    id, operatorId, sourceLabels: [{ operatorId, label, sourceId: "demo-synthetic" }], ordinal, intermediate: false,
    elevationM: z, elevationSource: "source-derived", renderElevationM: z,
  };
}

function poi(id: string, category: Poi["category"], ja: string, en: string, aliases: string[], floorId: string, connectorNodeIds: string[], paid: boolean | null): Poi {
  return {
    id, category, names: [{ lang: "ja", text: ja }, { lang: "en", text: en }],
    aliases: aliases.map((text) => ({ lang: /^[a-z0-9 ]+$/.test(text) ? "ja-Latn" : "ja-Hrkt", text })),
    floorId, displayPosition: null, connectorNodeIds, paid, evidence: ev(),
  };
}
