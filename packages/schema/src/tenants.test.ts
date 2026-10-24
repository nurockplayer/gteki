import { describe, expect, it } from "vitest";
import { createTenantFixtureBundle, syntheticStorePoi } from "../../navigation/src/fixtures.ts";
import { parseStationFiles, TENANTS_SCHEMA_VERSION, validateBundle } from "./index.ts";
import type { GraphFile, PoiFile, StationBundle, StationManifestFile, Tenant, TenantFile } from "./index.ts";

/** Split a bundle back into the on-disk files, including the optional tenants file (#419). */
function files(b: StationBundle): [StationManifestFile, GraphFile, PoiFile, TenantFile] {
  const { nodes, edges, pois, tenants, ...rest } = b;
  return [
    { schema: rest.schema, station: rest.station, sources: rest.sources, floors: rest.floors, coverage: rest.coverage },
    { schema: b.schema, stationId: b.station.id, nodes, edges },
    { schema: b.schema, stationId: b.station.id, pois },
    { schema: TENANTS_SCHEMA_VERSION, tenants: tenants ?? [] },
  ];
}

const errors = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "error").map((i) => i.code);
const warnings = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "warning").map((i) => i.code);

/** The fixture bundle with its first tenant patched (and optionally one of its sources patched). */
function withTenant(patch: Partial<Tenant>): StationBundle {
  const b = createTenantFixtureBundle();
  b.tenants![0] = { ...b.tenants![0]!, ...patch };
  return b;
}

describe("tenants.json is optional (#419)", () => {
  it("loads the file when present and leaves the bundle unchanged when it is absent", () => {
    const b = createTenantFixtureBundle();
    const [m, g, p, t] = files(b);
    const withFile = parseStationFiles(m, g, p, t);
    expect(withFile.ok).toBe(true);
    expect(withFile.bundle?.tenants).toEqual(b.tenants);

    const withoutFile = parseStationFiles(m, g, p);
    expect(withoutFile.ok).toBe(true);
    expect(withoutFile.bundle).not.toHaveProperty("tenants");
    // Everything else is the same bundle it was before the file existed.
    expect(withoutFile.bundle?.pois).toEqual(withFile.bundle?.pois);
    expect(withoutFile.bundle?.edges).toEqual(withFile.bundle?.edges);
  });

  it("treats only a missing file as no directory: null or non-object content is a shape error", () => {
    const [m, g, p] = files(createTenantFixtureBundle());
    expect(parseStationFiles(m, g, p).ok).toBe(true);
    // A `tenants.json` whose content is JSON null is a broken file, never "the station has none".
    const parsed = parseStationFiles(m, g, p, null);
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.filter((i) => i.level === "error").map((i) => i.code)).toContain("shape.type");
    expect(parsed.issues.map((i) => i.message)).toContain("tenants.json: expected object, got null");
    for (const bad of [42, "text", []]) {
      const issues = parseStationFiles(m, g, p, bad).issues;
      expect(issues.filter((i) => i.level === "error").map((i) => i.code)).toContain("shape.type");
    }
  });

  it("rejects a malformed file instead of ignoring it", () => {
    const [m, g, p] = files(createTenantFixtureBundle());
    const issues = parseStationFiles(m, g, p, { tenants: [] }).issues;
    expect(issues.map((i) => i.code)).toContain("shape.missing");
    const badTenant = parseStationFiles(m, g, p, { schema: TENANTS_SCHEMA_VERSION, tenants: [{ id: "tenant-x" }] }).issues;
    expect(badTenant.filter((i) => i.level === "error").map((i) => i.code)).toContain("shape.missing");
  });

  it("rejects another tenants schema version", () => {
    const [m, g, p, t] = files(createTenantFixtureBundle());
    const parsed = parseStationFiles(m, g, p, { ...t, schema: "gteki.tenants/9.9" });
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toContain("schema.version");
  });
});

describe("tenant validation (#419)", () => {
  it("accepts the synthetic fixture and names no unroutable store", () => {
    const b = createTenantFixtureBundle();
    expect(errors(b)).toEqual([]);
    expect(warnings(b)).not.toContain("tenant.unroutable");
  });

  it("requires a registered shop POI as the store", () => {
    expect(errors(withTenant({ poiId: "no-such-poi" }))).toContain("tenant.poi");
    expect(errors(withTenant({ poiId: "toilet" }))).toContain("tenant.poi");
  });

  it("requires a non-empty name and floor label exactly as printed", () => {
    expect(errors(withTenant({ names: [] }))).toContain("tenant.text");
    expect(errors(withTenant({ floorLabel: [] }))).toContain("tenant.text");
    expect(errors(withTenant({ floorLabel: [{ lang: "ja", text: "  " }] }))).toContain("tenant.text");
  });

  it("rejects duplicate tenant ids", () => {
    const b = createTenantFixtureBundle();
    b.tenants!.push({ ...b.tenants![0]!, names: [{ lang: "ja", text: "別ブランド" }] });
    expect(errors(b)).toContain("tenant.dup");
  });

  it("requires a registered facts-only source with a decision, and an ISO checked date", () => {
    expect(errors(withTenant({ evidence: { sourceIds: ["no-such-source"], method: "field-survey", checkedDate: "2026-10-22" } }))).toContain("tenant.evidence");
    expect(errors(withTenant({ evidence: { sourceIds: [], method: "field-survey", checkedDate: "2026-10-22" } }))).toContain("tenant.evidence");
    // A data source may ship content; a printed brand name is a cited fact only.
    expect(errors(withTenant({ evidence: { sourceIds: ["fixture-geometry"], method: "field-survey", checkedDate: "2026-10-22" } }))).toContain("tenant.evidence");
    expect(errors(withTenant({ evidence: { sourceIds: ["fixture-tenants"], method: "field-survey", checkedDate: "2026/10/22" } }))).toContain("tenant.evidence");

    // A facts-only source without the Owner decision substantiates nothing.
    const b = withTenant({});
    b.sources.push({
      id: "fixture-tenants-undecided", title: "Undecided", publisher: "GTEki tests", url: "https://example.invalid/u",
      license: null, rights: "RESTRICTED", usage: "facts-only", attribution: "x", modified: false, retrievedAt: null, datasetDate: null,
    });
    b.tenants![0] = { ...b.tenants![0]!, evidence: { sourceIds: ["fixture-tenants-undecided"], method: "field-survey", checkedDate: "2026-10-22" } };
    expect(errors(b)).toContain("tenant.evidence");
  });

  it("warns, but still accepts, a listing whose store has no connector", () => {
    const b = createTenantFixtureBundle();
    b.pois.push(syntheticStorePoi("store-no-connector", "接続なし百貨店"));
    b.pois[b.pois.length - 1]!.connectorNodeIds = [];
    b.tenants![0] = { ...b.tenants![0]!, poiId: "store-no-connector" };
    expect(errors(b)).toEqual([]);
    expect(warnings(b)).toContain("tenant.unroutable");
  });
});
