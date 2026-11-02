import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRoute } from "./route.ts";

for (const [station, prefix] of [["ikebukuro", "IK"], ["shinjuku", "SJ"]]) {
  describe(`${station} real route`, () => {
    const markdown = readFileSync(`docs/research/field/${station}-route.md`, "utf8");
    const graph = JSON.parse(readFileSync(`stations/${station}/gteki/graph.json`, "utf8")) as { nodes: { id: string }[]; edges: { id: string }[] };
    const stops = parseRoute(markdown);
    it("keeps all 16 stops in walk order, excluding coverage and dropped sections", () => {
      expect(stops.map((s) => s.id)).toEqual(Array.from({ length: 16 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`));
      expect(stops[0]!.id).toBe(`${prefix}-01`);
      expect(stops.at(-1)!.id).toBe(`${prefix}-16`);
      expect(stops.every((stop) => stop.title && stop.items.length)).toBe(true);
      expect(stops.at(-1)!.instructions).not.toContain("Coverage table");
    });
    it("keeps every public graph ID inside each stop's backticks, including arrow-separated runs", () => {
      const graphIds = new Set([...graph.nodes, ...graph.edges].map((entry) => entry.id));
      const walk = markdown.split("## Ordered walk")[1]!.split(/^## /m)[0]!;
      const sections = [...walk.matchAll(/^### (\S+) · .+\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
      for (const section of sections) {
        const stop = stops.find((entry) => entry.id === section[1])!;
        for (const backtick of section[2]!.matchAll(/`([^`]+)`/g)) {
          for (const id of graphIds) {
            if (backtick[1]!.split(/[^\w:.-]+/).includes(id)) expect(stop.ids).toContain(id);
          }
        }
      }
      if (station === "ikebukuro") {
        expect(stops[0]!.ids).toContain("c_w__w_c");
        expect(stops[1]!.ids).toEqual(expect.arrayContaining(["w_cj", "w_13j", "w_w", "w_nw"]));
      }
    });
  });
}
