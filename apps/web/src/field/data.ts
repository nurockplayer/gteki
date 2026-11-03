import ikebukuroRoute from "../../../../docs/research/field/ikebukuro-route.md?raw";
import shinjukuRoute from "../../../../docs/research/field/shinjuku-route.md?raw";
import ikebukuroGraph from "../../../../stations/ikebukuro/gteki/graph.json";
import shinjukuGraph from "../../../../stations/shinjuku/gteki/graph.json";
import ikebukuroPois from "../../../../stations/ikebukuro/gteki/pois.json";
import shinjukuPois from "../../../../stations/shinjuku/gteki/pois.json";
import { parseRoute, type Stop } from "./route.ts";

export interface FieldStation {
  id: string; title: string; fieldRun: string; stops: Stop[];
  nodeIds: string[]; edgeIds: string[]; pois: { id: string; label: string }[];
}

export const stations: FieldStation[] = [
  { id: "ikebukuro", title: "池袋 / Ikebukuro", route: ikebukuroRoute, graph: ikebukuroGraph, pois: ikebukuroPois },
  { id: "shinjuku", title: "新宿 / Shinjuku", route: shinjukuRoute, graph: shinjukuGraph, pois: shinjukuPois },
].map(({ id, title, route, graph, pois }) => ({
  id, title, fieldRun: `docs/research/field/${id}-route.md`, stops: parseRoute(route),
  nodeIds: graph.nodes.map((n) => n.id), edgeIds: graph.edges.map((e) => e.id),
  pois: pois.pois.filter((p) => p.category === "shop").map((p) => ({ id: p.id, label: p.names[0]?.text ?? p.id })),
}));
