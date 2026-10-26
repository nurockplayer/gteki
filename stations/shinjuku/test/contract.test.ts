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

  it("gives every E27 POI a distinct ja and en name, and every S03 or shop POI a ja name (search results stay distinguishable)", () => {
    // #411: S03 search-only POIs have ja names only, and one source name is printed twice (kept as printed).
    // #214: merchant listings are printed names as well (no invented English), and shops are not E27 POIs.
    // #501: the WP4 line POIs (Toei exits, Metro exits/lifts/escalators) are printed names too, ja only.
    const WP4_SOURCES = new Set([
      "tokyometro-shinjuku-station-2026-10",
      "tokyometro-shinjuku-accessibility-2026-10",
      "tokyometro-shinjuku-yardmap-print-2026-10",
      "toei-shinjuku-station-2026-10",
      "tokyometro-shinjuku-station-en-2026-10",
    ]);
    const e27 = bundle.pois.filter((p) => !p.evidence.sourceIds.includes("tokyo-s03-zip") && p.category !== "shop" && !p.evidence.sourceIds.every((id) => WP4_SOURCES.has(id)));
    for (const p of bundle.pois.filter((p) => p.category === "shop")) expect(p.names.some((n) => n.lang === "ja" && n.text.trim() !== ""), p.id).toBe(true);
    for (const lang of ["ja", "en"]) {
      const names = e27.map((p) => p.names.find((n) => n.lang === lang)?.text);
      expect(names.every(Boolean)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
    const s03 = bundle.pois.filter((p) => p.evidence.sourceIds.includes("tokyo-s03-zip"));
    const s03Ja = s03.map((p) => p.names.find((n) => n.lang === "ja")?.text);
    expect(s03Ja.every(Boolean)).toBe(true);
    // One S03 name is printed for two gates; asserted by id (S03 names stay out of Apache-2.0 files).
    expect(s03.filter((p, i) => s03Ja.indexOf(s03Ja[i]) !== s03Ja.lastIndexOf(s03Ja[i])).map((p) => p.id)).toEqual(["poi:keio-gate:1", "poi:keio-gate:2"]);
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
      // #297: every language states the same unconfirmed status, and none claims PDL or CC BY.
      for (const [lang, status] of [["ja", /未確認/], ["en", /unconfirmed/i]] as const) {
        const text = textOf(s.license?.name, lang);
        expect(text, `${s.id} ${lang}`).toMatch(status);
        expect(text, `${s.id} ${lang}`).not.toMatch(/PDL|CC[ -]?BY/i);
      }
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
        // approximateExtent is optional in the schema; the other three are required and must not vanish
        if (key === "approximateExtent" && v === undefined) continue;
        expect(v, `${g.id}.${key}`).toBeDefined();
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
    expect(reuseJa).toContain("ライセンス根拠は未確認");
    expect(reuseJa).toContain("オーナー判断により公開");
    expect(textOf(reuse?.fieldWorkNeeded, "ja")).toContain("ほこナビDP窓口");
    expect(reuseJa).not.toMatch(/PDL\s*1\.0\s*(で|に基づ|に準拠|が適用)/);
    // the post-period reuse question stays open with the provider, commercial use included
    expect(reuseJa).toContain("2027-03-12");
    expect(reuseJa).toContain("提供者の確認待ち");
    expect(reuseJa).toContain("商用を含む");
    expect(reuseJa).toContain("PDL 1.0 の対象とはみなしていない");
    const reuseWorkJa = textOf(reuse?.fieldWorkNeeded, "ja");
    expect(reuseWorkJa).toContain("確認が取れるまで、これに依拠する他の公開は保留");
    // no Japanese gap text may claim a licence was obtained or granted
    for (const g of gaps) for (const key of ["missingFact", "fieldWorkNeeded"] as const) {
      expect(textOf(g[key], "ja"), `${g.id}.${key} ja`).not.toMatch(/(許諾|ライセンス)(を)?(取得|付与)|許諾済|取得済み/);
    }
    // a missing fact is not yet known: the transfers gap must not call the passages confirmed
    expect(textOf(gaps.find((g) => g.id === "gap:transfers")?.missingFact, "ja")).not.toContain("確認済");
    const heightsJa = textOf(gaps.find((g) => g.id === "gap:heights")?.fieldWorkNeeded, "ja");
    expect(heightsJa).toContain("推定値");
    expect(heightsJa).toContain("実測したものではない");
  });
});
