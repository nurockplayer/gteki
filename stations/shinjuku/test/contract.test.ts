import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import type { CoverageText } from "@gteki/schema";
import { loadShinjukuBundle } from "../data/bundle.ts";

function textOf(v: CoverageText | undefined, lang: string): string {
  return Array.isArray(v) ? (v.find((t) => t.lang === lang)?.text ?? "") : "";
}

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

  it("cites the render-only PLATEAU street context under the catalogue licence with the Owner's Option A credit (#161)", () => {
    const p = bundle.sources.find((s) => s.id === "plateau-13104-shinjuku-ku-2025");
    expect(p?.rights).toBe("REUSABLE_WITH_CONDITIONS");
    expect(p?.license?.name).toBe("PLATEAU Site Policy 「３．著作権について」に拠る");
    expect(p?.license?.url).toBe("https://www.mlit.go.jp/plateau/site-policy/");
    expect(p?.attribution).toBe("出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成（建物の基部を地表面の高さにそろえて表示）");
    expect(p?.modified).toBe(true);
    expect(Object.keys(p?.sha256 ?? {}).length).toBe(8);
  });

  it("ships both E27 resources under the Owner's recorded #16 override, never as a confirmed licence (#130, #39 Q11)", () => {
    const e27 = bundle.sources.filter((s) => s.id.startsWith("mlit-hokonavi-e27-"));
    expect(e27.map((s) => s.id).sort()).toEqual(["mlit-hokonavi-e27-nwd", "mlit-hokonavi-e27-stationmap"]);
    for (const s of e27) {
      expect(s.rights, s.id).toBe("PUBLISHED_UNDER_OWNER_OVERRIDE");
      expect(s.override, s.id).toEqual({ decision: "https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757", date: "2026-10-21" });
      expect(s.license?.name, s.id).toMatch(/unconfirmed/i);
      expect(s.license?.name, s.id).not.toMatch(/PDL|CC[ -]?BY/i);
    }
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

  it("gives every Shinjuku coverage gap exactly one en and one ja text, with plain ja and the reuse rights wording (#259)", () => {
    const gaps = bundle.coverage.gaps;
    expect(gaps.length).toBe(8);
    for (const g of gaps) {
      for (const key of ["zone", "missingFact", "approximateExtent", "fieldWorkNeeded"] as const) {
        const v = g[key];
        if (v === undefined) continue;
        expect(Array.isArray(v), `${g.id}.${key}`).toBe(true);
        if (!Array.isArray(v)) continue;
        expect(v.length, `${g.id}.${key}`).toBe(2);
        const en = v.filter((t) => t.lang === "en");
        const ja = v.filter((t) => t.lang === "ja");
        expect(en.length, `${g.id}.${key}`).toBe(1);
        expect(ja.length, `${g.id}.${key}`).toBe(1);
        expect(en[0]!.text.length, `${g.id}.${key} en`).toBeGreaterThan(0);
        expect(ja[0]!.text.length, `${g.id}.${key} ja`).toBeGreaterThan(0);
        expect(ja[0]!.text, `${g.id}.${key} ja`).not.toMatch(/\b(TP|EF_\d+|gap:)/);
      }
    }
    const reuse = gaps.find((g) => g.id === "gap:reuse-after-publication");
    const reuseJa = textOf(reuse?.missingFact, "ja");
    expect(reuseJa).toContain("「ライセンス根拠は未確認」");
    expect(reuseJa).not.toMatch(/PDL\s*1\.0\s*(で|に基づ)/);
  });
});
