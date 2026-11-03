import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { PrivateFieldData } from "./src/field/route.ts";

export function readFieldPrivate(overlay: string | null): Record<string, PrivateFieldData> {
  const stations: Record<string, PrivateFieldData> = {};
  if (!overlay || !fs.existsSync(overlay)) return stations;
  for (const station of fs.readdirSync(overlay)) {
    const stopsFile = path.join(overlay, station, "field/private-stops.json");
    if (!fs.existsSync(path.join(overlay, station, "gteki/graph.json"))) continue;
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(overlay, station, "gteki", file), "utf8"));
    stations[station] = {
      stops: fs.existsSync(stopsFile) ? JSON.parse(fs.readFileSync(stopsFile, "utf8")) : [],
      nodeIds: read("graph.json").nodes.map((node: { id: string }) => node.id),
      edgeIds: read("graph.json").edges.map((edge: { id: string }) => edge.id),
      pois: read("pois.json").pois.filter((poi: { category: string }) => poi.category === "shop")
        .map((poi: { id: string; names: { text: string }[] }) => ({ id: poi.id, label: poi.names[0]?.text ?? poi.id })),
    };
  }
  return stations;
}

export function fieldPrivate(overlay: string | null): Plugin {
  const id = "virtual:gteki-field-private";
  return {
    name: "gteki-field-private",
    resolveId(source) { if (source === id) return "\0" + id; },
    load(source) { if (source === "\0" + id) return `export default ${JSON.stringify(readFieldPrivate(overlay))};`; },
  };
}
