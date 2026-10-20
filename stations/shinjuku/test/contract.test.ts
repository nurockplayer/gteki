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

  it("offers gate, platform and exit spawn points that exist", () => {
    const ids = new Set(bundle.nodes.map((n) => n.id));
    expect(bundle.spawnNodeIds?.length).toBe(3);
    for (const id of bundle.spawnNodeIds!) expect(ids.has(id)).toBe(true);
  });
});
