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
  station: { id: "string", names: "array", codes: "array?", operators: "array", origin: "object", frame: "string", datasetVersion: "string", generatedAt: "string", synthetic: "boolean" },
  origin: { lat: "number", lon: "number", hM: "number|null", datum: "string", crs: "string" },
  source: { id: "string", title: "string", publisher: "string", url: "string", license: "object|null", rights: "string", attribution: "string", modified: "boolean", retrievedAt: "string|null", datasetDate: "string|null", downloadUrls: "array?", usage: "string?", decision: "object?", sha256: "object?", validUntil: "string|null?", notes: "string?" },
  floor: { id: "string", operatorId: "string", sourceLabels: "array", ordinal: "number|null", intermediate: "boolean", elevationM: "number|null", elevationSource: "string", renderElevationM: "number", displayNames: "array?" },
  node: { id: "string", floorId: "string", position: "object", kind: "string", inOut: "string|null", sourceRefs: "array", renderZ: "number?" },
  position: { x: "number", y: "number", z: "number|null" },
  edge: { id: "string", from: "string", to: "string", direction: "string", mode: "string", lengthM: "number|null", paid: "tri", crossesFareBoundary: "tri", wheelchair: "tri", steps: "tri", hours: "object|null", closed: "boolean", verification: "string", geometryEvidence: "object", accessEvidence: "object|null", geometry: "array?", geometryZ: "string?", attributes: "object?" },
  evidence: { sourceIds: "array", method: "string", checkedDate: "string", note: "string?" },
  poi: { id: "string", category: "string", names: "array", aliases: "array", floorId: "string|null", displayPosition: "object|null", connectorNodeIds: "array", paid: "tri", evidence: "object", notes: "array?" },
  text: { lang: "string", text: "string" },
  operator: { id: "string", names: "array" },
  code: { operatorId: "string", code: "string" },
  license: { name: "string", url: "string" },
  decision: { url: "string", date: "string" },
  sourceLabel: { operatorId: "string", label: "string", sourceId: "string" },
  featureRef: { sourceId: "string", featureId: "string" },
  hoursAlways: { kind: "string", evidence: "object" },
  hoursWindow: { kind: "string", open: "string", close: "string", days: "array?", evidence: "object" },
  area: { id: "string", floorId: "string|null", status: "string", label: "array", polygon: "array?", sourceIds: "array", note: "string?" },
  gap: { id: "string", floorId: "string|null", zone: "string", missingFact: "string", fieldWorkNeeded: "string", approximateExtent: "string?", sourceDate: "string|null?" },
  point2: { x: "number", y: "number" },
  coverage: { summary: "array", areas: "array", gaps: "array", freshness: "string|null" },
  asset: { id: "string", uri: "string", format: "string", floorIds: "array", role: "string", sourceIds: "array", transform: "array?", derivation: "string?", files: "array?" },
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

  /** Every member of an (already type-checked) array must be a string. */
  strings(list: unknown, where: string): void {
    if (!Array.isArray(list)) return;
    list.forEach((v, i) => {
      if (typeof v !== "string") this.issues.push({ level: "error", code: "shape.type", message: `${where}[${i}]: expected string, got ${kindOf(v)}`, ref: where });
    });
  }

  texts(list: unknown, where: string): void {
    this.each(list, SPECS.text, where);
  }

  evidence(value: unknown, where: string): void {
    if (this.check(value, SPECS.evidence, where)) this.strings((value as Record<string, unknown>).sourceIds, `${where}.sourceIds`);
  }

  /** `hours` is a discriminated union: an unrecognised or incomplete object is an error, never "open". */
  hours(value: unknown, where: string): void {
    if (value === null) return;
    const kind = kindOf(value) === "object" ? (value as Record<string, unknown>).kind : undefined;
    if (kind === "always") {
      if (this.check(value, SPECS.hoursAlways, where)) this.evidence((value as Record<string, unknown>).evidence, `${where}.evidence`);
    } else if (kind === "window") {
      if (this.check(value, SPECS.hoursWindow, where)) {
        const h = value as Record<string, unknown>;
        this.strings(h.days, `${where}.days`);
        this.evidence(h.evidence, `${where}.evidence`);
      }
    } else {
      this.issues.push({ level: "error", code: "shape.type", message: `${where}: hours must be null, {kind:"always"} or {kind:"window"}; got kind ${JSON.stringify(kind)}`, ref: where });
    }
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
    if (c.check(m.station, SPECS.station, "station.json.station")) {
      const st = m.station as Record<string, unknown>;
      c.check(st.origin, SPECS.origin, "station.json.station.origin");
      c.texts(st.names, "station.names");
      c.each(st.operators, SPECS.operator, "station.operators", (op, where) => c.texts(op.names, `${where}.names`));
      c.each(st.codes, SPECS.code, "station.codes");
    }
    c.each(m.sources, SPECS.source, "sources", (src, where) => {
      if (src.license !== null) c.check(src.license, SPECS.license, `${where}.license`);
      if (src.decision !== undefined) c.check(src.decision, SPECS.decision, `${where}.decision`);
      c.strings(src.downloadUrls, `${where}.downloadUrls`);
      if (kindOf(src.sha256) === "object") c.strings(Object.values(src.sha256 as object), `${where}.sha256`);
    });
    c.each(m.floors, SPECS.floor, "floors", (floor, where) => {
      c.each(floor.sourceLabels, SPECS.sourceLabel, `${where}.sourceLabels`);
      c.texts(floor.displayNames, `${where}.displayNames`);
    });
    if (c.check(m.coverage, SPECS.coverage, "coverage")) {
      const cov = m.coverage as Record<string, unknown>;
      c.texts(cov.summary, "coverage.summary");
      c.each(cov.areas, SPECS.area, "coverage.areas", (area, where) => {
        c.texts(area.label, `${where}.label`);
        c.strings(area.sourceIds, `${where}.sourceIds`);
        c.each(area.polygon, SPECS.point2, `${where}.polygon`);
      });
      c.each(cov.gaps, SPECS.gap, "coverage.gaps");
    }
    c.strings(m.spawnNodeIds, "spawnNodeIds");
    c.each(m.assets, SPECS.asset, "assets", (asset, where) => {
      c.strings(asset.floorIds, `${where}.floorIds`);
      c.strings(asset.sourceIds, `${where}.sourceIds`);
      c.strings(asset.files, `${where}.files`);
      if (Array.isArray(asset.transform) && (asset.transform.length !== 16 || !asset.transform.every((v) => typeof v === "number" && Number.isFinite(v))))
        c.issues.push({ level: "error", code: "shape.type", message: `${where}.transform: expected 16 finite numbers`, ref: where });
    });
  }
  if (c.check(graph, { schema: "string", stationId: "string", nodes: "array", edges: "array" }, "graph.json")) {
    const g = graph as Record<string, unknown>;
    c.each(g.nodes, SPECS.node, "nodes", (node, where) => {
      c.check(node.position, SPECS.position, `${where}.position`);
      c.each(node.sourceRefs, SPECS.featureRef, `${where}.sourceRefs`);
    });
    c.each(g.edges, SPECS.edge, "edges", (edge, where) => {
      c.evidence(edge.geometryEvidence, `${where}.geometryEvidence`);
      if (edge.accessEvidence !== null) c.evidence(edge.accessEvidence, `${where}.accessEvidence`);
      c.hours(edge.hours, `${where}.hours`);
      if (kindOf(edge.attributes) === "object") {
        for (const [k, v] of Object.entries(edge.attributes as object)) {
          if (v !== null && !["string", "boolean"].includes(typeof v) && !(typeof v === "number" && Number.isFinite(v)))
            c.issues.push({ level: "error", code: "shape.type", message: `${where}.attributes.${k}: expected string|number|boolean|null`, ref: where });
        }
      }
      if (Array.isArray(edge.geometry)) edge.geometry.forEach((p, i) => c.check(p, SPECS.position, `${where}.geometry[${i}]`));
    });
  }
  if (c.check(pois, { schema: "string", stationId: "string", pois: "array" }, "pois.json")) {
    c.each((pois as Record<string, unknown>).pois, SPECS.poi, "pois", (poi, where) => {
      c.evidence(poi.evidence, `${where}.evidence`);
      c.texts(poi.names, `${where}.names`);
      c.texts(poi.aliases, `${where}.aliases`);
      c.texts(poi.notes, `${where}.notes`);
      c.strings(poi.connectorNodeIds, `${where}.connectorNodeIds`);
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
