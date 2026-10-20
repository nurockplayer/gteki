import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createRouter, describeRoute } from "@gteki/navigation";
import { createSearchIndex } from "@gteki/search";
import { createDemoFiles } from "./demo.ts";

const load = () => {
  const parsed = parseStationFiles(...createDemoFiles());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.bundle;
};

describe("synthetic demo station", () => {
  it("validates and is labelled synthetic", () => {
    const b = load();
    expect(b.station.synthetic).toBe(true);
    expect(b.edges.every((e) => e.verification === "synthetic")).toBe(true);
  });

  it("covers the key routing cases end to end", () => {
    const b = load();
    const r = createRouter(b);
    const toPlatform = r.route("exit-a", "plat-c");
    expect(toPlatform).toMatchObject({ ok: true, crossesFareBoundary: true, synthetic: true });
    expect(r.route("exit-a", "plat-c", { fare: "unpaid_only", stepFree: false })).toMatchObject({ ok: false, reason: "no_path" });
    // Step-free reaches the B1 toilet by elevator, never the stairs.
    const sf = r.route("plaza", "toilet-door", { fare: "ticketed", stepFree: true });
    expect(sf.ok && sf.steps.some((s) => s.mode === "elevator") && !sf.steps.some((s) => s.mode === "stairs")).toBe(true);
    // Platform is only reachable by stairs/escalator: step-free fails safely.
    expect(r.route("plaza", "plat-c", { fare: "ticketed", stepFree: true })).toMatchObject({ ok: false });
    // One-way escalator cannot be climbed.
    const up = r.route("plat-w", "esc-top", { fare: "ticketed", stepFree: false, avoidModes: ["stairs"] });
    expect(up).toMatchObject({ ok: false, reason: "no_path" });
    // Closed shortcut is never used.
    expect(toPlatform.ok && toPlatform.steps.some((s) => s.edgeId === "closed-cut")).toBe(false);
    // Transfer at 03:00 is outside its window.
    expect(r.route("b1-e", "x-gate", { fare: "ticketed", stepFree: false, at: { weekday: "tue", minutes: 180 } })).toMatchObject({ ok: false });
    const transfer = r.route("b1-e", "x-gate");
    expect(transfer.ok && transfer.operatorIds).toEqual(["demo-rail", "demo-metro"]);
    expect(transfer.ok && transfer.unknowns.map((u) => u.kind)).toEqual(expect.arrayContaining(["hours", "wheelchair"]));
    if (toPlatform.ok) expect(describeRoute(b, toPlatform, "en").map((i) => i.kind)).toContain("gate");
  });

  it("is searchable in Japanese, kana and romaji, with search-only POIs flagged", () => {
    const idx = createSearchIndex(load());
    expect(idx.search("改札")[0]?.poi.id).toBe("gate");
    expect(idx.search("といれ")[0]?.poi.id).toBe("toilet");
    expect(idx.search("chuo kaisatsu")[0]?.poi.id).toBe("gate");
    expect(idx.search("売店")[0]).toMatchObject({ routable: false });
  });
});
