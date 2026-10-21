// Free walking stays on verified floor, and exits are only called exits where the route reaches street level.
import { WALKER_BODY } from "@gteki/scene-api";
import { describe, expect, it } from "vitest";
import { type Fence, WALKER, bake, checkOutline, checkSeal, glbRoles, heightsAt, read } from "../pipeline/access_seal.ts";

describe("ikebukuro access fences", () => {
  it("mirror the explorer's walker body", () => {
    expect(WALKER).toMatchObject({ radiusM: WALKER_BODY.radiusM, stepUpM: WALKER_BODY.stepUpM, stepDownM: WALKER_BODY.stepDownM });
  });

  it("cover the outline wherever floor lies next to it, with no gap and at every ray height", async () => {
    expect(await checkOutline()).toEqual([]);
  }, 120_000);

  it("leave no gap the outline check misses (negative controls: a 1 cm cut, a short panel)", async () => {
    const fences = read("scene/access_fences.json").fences as Fence[];
    const f = fences[0]!, m = [(f.a[0]! + f.b[0]!) / 2, (f.a[1]! + f.b[1]!) / 2];
    const L = Math.hypot(f.b[0]! - f.a[0]!, f.b[1]! - f.a[1]!), u = [(f.b[0]! - f.a[0]!) / L, (f.b[1]! - f.a[1]!) / L];
    const at = (s: number) => [m[0]! + u[0]! * s, m[1]! + u[1]! * s];
    expect(await checkOutline([{ ...f, b: at(-0.005) }, { ...f, a: at(0.005) }, ...fences.slice(1)])).not.toEqual([]);
    expect(await checkOutline([{ ...f, z1: f.z0 + 1 }, ...fences.slice(1)])).not.toEqual([]);
  }, 120_000);

  it("keep the walker inside the routable areas from every graph node", async () => {
    const r = await checkSeal(0.25);
    expect(r.flooded).toBeGreaterThan(100_000);
    expect(r.escapes).toEqual([]);
  }, 120_000);

  it("are what keeps it there (negative control: without them it escapes)", async () => {
    const r = await checkSeal(0.25, [], 1);
    expect(r.escapes.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("ikebukuro exit connectors", () => {
  const graph = read("gteki/graph.json") as { nodes: { id: string; kind: string; position: { x: number; y: number; z: number } }[] };
  const pois = read("gteki/pois.json").pois as { id: string; category: string; names: { text: string }[]; connectorNodeIds: string[] }[];
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const exits = pois.filter((p) => p.category === "exit");

  it("an exit node is the top of its surveyed stairs; a route that stops lower is named for it", async () => {
    const roles = await glbRoles();
    const stairs = bake(roles.get("stairs_ramps")!), closures = bake(roles.get("portals")!);
    for (const p of exits) {
      for (const id of p.connectorNodeIds) {
        const n = node.get(id)!;
        if (n.kind === "exit") {
          const { x, y, z } = n.position;
          let top = -Infinity;
          for (let i = -40; i <= 40; i += 2)
            for (let j = -40; j <= 40; j += 2)
              if (Math.hypot(i, j) <= 40) top = Math.max(top, ...heightsAt(stairs, x + i / 10, y + j / 10, z - 1.5, z + 3));
          expect(top, `${p.id} (${id}): treads above the node`).toBeLessThanOrEqual(z + 0.05);
          // The stairwell's street-level closure is just overhead (not a wall closure mid-flight, as at Exit 36).
          let cap = false;
          for (let i = -10; i <= 10 && !cap; i++)
            for (let j = -10; j <= 10 && !cap; j++) cap = heightsAt(closures, x + i / 10, y + j / 10, z - 0.05, z + 0.3).length > 0;
          expect(cap, `${p.id} (${id}): no street-level closure overhead`).toBe(true);
        } else {
          expect(n.kind, `${p.id} (${id})`).toBe("stair_end");
          expect(p.names.map((t) => t.text).join(" | "), p.id).toMatch(/階段下.*stair foot|stair foot.*階段下/s);
        }
      }
    }
  }, 120_000);
});
