import type { GraphFile, PoiFile, StationBundle, StationManifestFile } from "./index.ts";
import { SCHEMA_VERSION } from "./index.ts";
import { validateBundle, type ValidationIssue } from "./validate.ts";

/**
 * Fail-closed loading of station JSON. TypeScript types do not exist at runtime, so every
 * file read from disk/network passes a structural check before any truth-rule validation.
 * A missing tri-state field is an error, not an implicit `null`/`false`: stations must
 * state UNKNOWN explicitly.
 */

type Kind = "string" | "number" | "boolean" | "array" | "object" | "tri" | "string|null" | "number|null" | "object|null";

type Spec = Record<string, Kind | `${Kind}?`>;

const SPECS = {
  station: { id: "string", names: "array", operators: "array", origin: "object", frame: "string", datasetVersion: "string", generatedAt: "string", synthetic: "boolean" },
  origin: { lat: "number", lon: "number", hM: "number|null", datum: "string", crs: "string" },
  source: { id: "string", title: "string", publisher: "string", url: "string", license: "object|null", rights: "string", attribution: "string", modified: "boolean", retrievedAt: "string|null", datasetDate: "string|null" },
  floor: { id: "string", operatorId: "string", sourceLabels: "array", ordinal: "number|null", intermediate: "boolean", elevationM: "number|null", elevationSource: "string", renderElevationM: "number", displayNames: "array?" },
  node: { id: "string", floorId: "string", position: "object", kind: "string", inOut: "string|null", sourceRefs: "array", renderZ: "number?" },
  position: { x: "number", y: "number", z: "number|null" },
  edge: { id: "string", from: "string", to: "string", direction: "string", mode: "string", lengthM: "number|null", paid: "tri", crossesFareBoundary: "tri", wheelchair: "tri", steps: "tri", hours: "object|null", closed: "boolean", verification: "string", geometryEvidence: "object", accessEvidence: "object|null", geometry: "array?", geometryZ: "string?" },
  evidence: { sourceIds: "array", method: "string", checkedDate: "string" },
  poi: { id: "string", category: "string", names: "array", aliases: "array", floorId: "string|null", displayPosition: "object|null", connectorNodeIds: "array", paid: "tri", evidence: "object" },
  text: { lang: "string", text: "string" },
  coverage: { summary: "array", areas: "array", gaps: "array", freshness: "string|null" },
  asset: { id: "string", uri: "string", format: "string", floorIds: "array", role: "string", sourceIds: "array", transform: "array?" },
} satisfies Record<string, Spec>;

function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matches(value: unknown, kind: Kind): boolean {
  const actual = kindOf(value);
  if (actual === "number" && !Number.isFinite(value)) return false;
  switch (kind) {
    case "tri": return actual === "boolean" || actual === "null";
    case "string|null": return actual === "string" || actual === "null";
    case "number|null": return actual === "number" || actual === "null";
    case "object|null": return actual === "object" || actual === "null";
    default: return actual === kind;
  }
}

class ShapeChecker {
  readonly issues: ValidationIssue[] = [];

  check(value: unknown, spec: Spec, where: string): value is Record<string, unknown> {
    if (kindOf(value) !== "object") {
      this.issues.push({ level: "error", code: "shape.type", message: `${where}: expected object, got ${kindOf(value)}`, ref: where });
      return false;
    }
    const record = value as Record<string, unknown>;
    let ok = true;
    for (const [key, raw] of Object.entries(spec)) {
      const optional = raw.endsWith("?");
      const kind = (optional ? raw.slice(0, -1) : raw) as Kind;
      if (!(key in record) || record[key] === undefined) {
        if (!optional) {
          this.issues.push({ level: "error", code: "shape.missing", message: `${where}.${key}: required (${kind}); state UNKNOWN explicitly as null`, ref: where });
          ok = false;
        }
        continue;
      }
      if (!matches(record[key], kind)) {
        this.issues.push({ level: "error", code: "shape.type", message: `${where}.${key}: expected ${kind}, got ${kindOf(record[key])}`, ref: where });
        ok = false;
      }
    }
    return ok;
  }

  each(list: unknown, spec: Spec, label: string, nested?: (item: Record<string, unknown>, where: string) => void): void {
    if (!Array.isArray(list)) return;
    list.forEach((item, i) => {
      const where = `${label}[${i}${idOf(item)}]`;
      if (this.check(item, spec, where)) nested?.(item, where);
    });
  }
}

function idOf(item: unknown): string {
  return kindOf(item) === "object" && typeof (item as { id?: unknown }).id === "string" ? `=${(item as { id: string }).id}` : "";
}

/** Structural check of the three station files. Returns issues; empty = shape-valid. */
export function checkShape(manifest: unknown, graph: unknown, pois: unknown): ValidationIssue[] {
  const c = new ShapeChecker();
  if (c.check(manifest, { schema: "string", station: "object", sources: "array", floors: "array", coverage: "object", spawnNodeIds: "array?", assets: "array?" }, "station.json")) {
    const m = manifest as Record<string, unknown>;
    if (c.check(m.station, SPECS.station, "station.json.station")) c.check((m.station as Record<string, unknown>).origin, SPECS.origin, "station.json.station.origin");
    c.each(m.sources, SPECS.source, "sources");
    c.each(m.floors, SPECS.floor, "floors", (floor, where) => {
      if (Array.isArray(floor.displayNames)) floor.displayNames.forEach((t, i) => c.check(t, SPECS.text, `${where}.displayNames[${i}]`));
    });
    c.check(m.coverage, SPECS.coverage, "coverage");
    c.each(m.assets, SPECS.asset, "assets");
  }
  if (c.check(graph, { schema: "string", stationId: "string", nodes: "array", edges: "array" }, "graph.json")) {
    const g = graph as Record<string, unknown>;
    c.each(g.nodes, SPECS.node, "nodes", (node, where) => c.check(node.position, SPECS.position, `${where}.position`));
    c.each(g.edges, SPECS.edge, "edges", (edge, where) => {
      c.check(edge.geometryEvidence, SPECS.evidence, `${where}.geometryEvidence`);
      if (edge.accessEvidence !== null) c.check(edge.accessEvidence, SPECS.evidence, `${where}.accessEvidence`);
      if (Array.isArray(edge.geometry)) edge.geometry.forEach((p, i) => c.check(p, SPECS.position, `${where}.geometry[${i}]`));
    });
  }
  if (c.check(pois, { schema: "string", stationId: "string", pois: "array" }, "pois.json")) {
    c.each((pois as Record<string, unknown>).pois, SPECS.poi, "pois", (poi, where) => {
      c.check(poi.evidence, SPECS.evidence, `${where}.evidence`);
      if (poi.displayPosition !== null) c.check(poi.displayPosition, SPECS.position, `${where}.displayPosition`);
    });
  }
  return c.issues;
}

/** Join the three files. Caller must have passed `checkShape`. */
export function composeBundle(manifest: StationManifestFile, graph: GraphFile, pois: PoiFile): StationBundle {
  const bundle: StationBundle = {
    schema: manifest.schema,
    station: manifest.station,
    sources: manifest.sources,
    floors: manifest.floors,
    nodes: graph.nodes,
    edges: graph.edges,
    pois: pois.pois,
    coverage: manifest.coverage,
  };
  if (manifest.spawnNodeIds) bundle.spawnNodeIds = manifest.spawnNodeIds;
  if (manifest.assets) bundle.assets = manifest.assets;
  return bundle;
}

export type ParseResult =
  | { ok: true; bundle: StationBundle; issues: ValidationIssue[] }
  | { ok: false; bundle: null; issues: ValidationIssue[] };

/**
 * Shape check → compose → truth-rule validation. Any error yields `ok: false` and no bundle,
 * so a malformed or rule-breaking station never reaches the router (fail closed).
 */
export function parseStationFiles(manifest: unknown, graph: unknown, pois: unknown): ParseResult {
  const shape = checkShape(manifest, graph, pois);
  if (shape.length > 0) return { ok: false, bundle: null, issues: shape };
  const m = manifest as StationManifestFile;
  const g = graph as GraphFile;
  const p = pois as PoiFile;
  const issues: ValidationIssue[] = [];
  for (const [label, file] of [["graph.json", g], ["pois.json", p]] as const) {
    if (file.schema !== SCHEMA_VERSION) issues.push({ level: "error", code: "schema.version", message: `${label}: expected ${SCHEMA_VERSION}, got ${file.schema}` });
    if (file.stationId !== m.station.id) issues.push({ level: "error", code: "file.station", message: `${label}: stationId ${file.stationId} ≠ ${m.station.id}` });
  }
  const bundle = composeBundle(m, g, p);
  issues.push(...validateBundle(bundle));
  return issues.some((i) => i.level === "error") ? { ok: false, bundle: null, issues } : { ok: true, bundle, issues };
}
