import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { floorLabel, narrate } from "../app/src/narrate.ts";

// An exit's name states its level; the arrival must never claim street level for an exit below it.
const { bundle } = loadShinjukuBundle();
const floors = new Map(bundle.floors.map((f) => [f.id, f]));
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
// Only routable exits (#411, #214 and #501 POIs are search-only and carry no connector).
const exits = bundle.pois.filter((p) => p.category === "exit" && p.connectorNodeIds.length > 0);
const name = (p: (typeof exits)[number], lang: string) => (lang === "en" ? p.descriptions : p.names)!.find((n) => n.lang === lang)!.text;

describe("exit arrival truth", () => {
  it("names every exit by the level its connectors are on", () => {
    expect(exits.length).toBeGreaterThan(0);
    for (const p of exits) {
      const ordinal = floors.get(p.floorId!)!.ordinal!;
      for (const id of p.connectorNodeIds) expect(nodes.get(id)!.floorId, p.id).toBe(p.floorId);
      const ja = name(p, "ja"), en = name(p, "en");
      if (ordinal >= 0) {
        expect(ja, p.id).toMatch(/地上/);
        expect(en, p.id).toMatch(/street level/);
      } else {
        expect(ja, p.id).toContain(`地下${-ordinal}階`);
        expect(en, p.id).toContain(`B${-ordinal}`);
        expect(`${ja} ${en}`, p.id).not.toMatch(/地上|street/i);
      }
    }
  });

  it("ends routes to below-street exits without any street-level claim", () => {
    const router = createRouter(bundle);
    const below = exits.filter((p) => floors.get(p.floorId!)!.ordinal! < 0);
    expect(below.length).toBeGreaterThan(0);
    for (const to of below)
      for (const from of bundle.pois) {
        if (from === to) continue;
        const r = router.route(from.connectorNodeIds, to.connectorNodeIds, { fare: "ticketed", stepFree: false, today: "2026-10-21" });
        if (!r.ok) continue;
        const ms = narrate(bundle, r);
        expect(ms.at(-1)!.kind).toBe("arrive");
        for (const m of ms.slice(-2)) expect(`${m.ja} ${m.en}`, `${from.id} → ${to.id}`).not.toMatch(/地上|street|GL/i);
        expect(floors.get(r.steps.at(-1)!.toFloorId)!.ordinal).toBe(floors.get(to.floorId!)!.ordinal);
        expect(floorLabel(floors.get(to.floorId!)).short).not.toBe("GL");
      }
  });
});
