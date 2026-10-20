import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";

describe("Shinjuku gteki/ contract files", () => {
  const { bundle, issues } = loadShinjukuBundle();

  it("parse fail-closed with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(bundle.station.synthetic).toBe(false);
    expect((bundle.station.codes ?? []).map((c) => c.code)).toContain("E27");
  });

  it("gives every POI a distinct display name in each language (search results stay distinguishable)", () => {
    for (const lang of ["ja", "en"]) {
      const names = bundle.pois.map((p) => p.names.find((n) => n.lang === lang)?.text);
      expect(names.every(Boolean)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("cites the render-only PLATEAU street context as a reusable CC BY 4.0 source", () => {
    const p = bundle.sources.find((s) => s.id === "plateau-13104-shinjuku-ku-2025");
    expect(p?.rights).toBe("REUSABLE_WITH_CONDITIONS");
    expect(p?.license?.name).toBe("CC BY 4.0");
    expect(p?.modified).toBe(true);
    expect(Object.keys(p?.sha256 ?? {}).length).toBe(8);
  });

  it("never claims measured heights", () => {
    for (const f of bundle.floors) expect(f.elevationM).toBeNull();
    for (const n of bundle.nodes) {
      expect(n.position.z).toBeNull();
      expect(typeof n.renderZ).toBe("number");
    }
  });

  it("keeps unknown hours unknown and routes with a warning", () => {
    expect(bundle.edges.every((e) => e.hours === null)).toBe(true);
    const r = createRouter(bundle);
    const [a, b] = bundle.spawnNodeIds!;
    const res = r.route(a!, b!, { fare: "ticketed", stepFree: false });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.unknowns.map((u) => u.kind)).toContain("hours");
    const strict = r.route(a!, b!, { fare: "ticketed", stepFree: false, hours: "require_known" });
    expect(strict.ok).toBe(false);
  });

  it("keeps the publication period separate from navigation freshness (Owner policy A)", () => {
    // 2027-03-12 is the provider's publication period, not data validity: it never makes routes stale
    expect(bundle.sources.every((s) => (s.validUntil ?? null) === null)).toBe(true);
    const hokonavi = bundle.sources.filter((s) => s.id.startsWith("mlit-hokonavi-"));
    expect(hokonavi.length).toBe(2);
    expect(hokonavi.every((s) => s.notes?.includes("2027-03-12"))).toBe(true);
    expect(bundle.coverage.gaps.some((g) => g.id === "gap:reuse-after-publication")).toBe(true);
    const r = createRouter(bundle);
    const [a, b] = bundle.spawnNodeIds!;
    const after = r.route(a!, b!, { fare: "ticketed", stepFree: false, today: "2027-03-13" });
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.expiredSourceIds).toEqual([]);
      expect(after.stale).toBe(false);
    }
    // freshness comes from the dataset date (router staleAfterDays)
    const later = r.route(a!, b!, { fare: "ticketed", stepFree: false, today: "2030-01-01" });
    if (later.ok) expect(later.stale).toBe(true);
  });

  it("offers gate, platform and exit spawn points that exist", () => {
    const ids = new Set(bundle.nodes.map((n) => n.id));
    expect(bundle.spawnNodeIds?.length).toBe(3);
    for (const id of bundle.spawnNodeIds!) expect(ids.has(id)).toBe(true);
  });
});
