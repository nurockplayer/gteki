/**
 * Generates a whole-station sweep for tools/shoot.ts: every non-lift graph node, facing along each
 * incident edge (up to 3 distinct headings ≥ 40° apart), i.e. what a walker sees leaving that node.
 *
 *   pnpm --filter @gteki/station-shinjuku exec tsx tools/node-vantages.ts > .qa/sweep.json
 *   pnpm --filter @gteki/station-shinjuku shoot --vantages .qa/sweep.json --w 640 --h 360 --q low --crowd 0 --hud 0 --out .qa/sweep
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface XY { x: number; y: number }
interface Node { id: string; kind?: string; position: XY }
interface Edge { from: string; to: string; geometry?: XY[] | null }

const here = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(join(here, "../gteki/graph.json"), "utf8")) as { nodes: Node[]; edges: Edge[] };
const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
const vantages: { id: string; node: string; heading: number }[] = [];
for (const n of graph.nodes) {
  if (n.kind === "elevator") continue;
  const headings: number[] = [];
  for (const e of graph.edges) {
    if (e.from !== n.id && e.to !== n.id) continue;
    let pts = e.geometry?.length ? e.geometry : [nodes.get(e.from)!.position, nodes.get(e.to)!.position];
    if (e.from !== n.id) pts = [...pts].reverse();
    const a = pts[0]!, b = pts[1] ?? nodes.get(e.from === n.id ? e.to : e.from)!.position;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.2) continue;
    const h = ((Math.round((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI) % 360) + 360) % 360;
    if (headings.every((x) => Math.min(Math.abs(h - x), 360 - Math.abs(h - x)) > 40)) headings.push(h);
  }
  for (const h of headings.slice(0, 3)) vantages.push({ id: `${n.id.slice(2, 10)}-${String(h).padStart(3, "0")}`, node: n.id, heading: h });
}
process.stdout.write(JSON.stringify({ vantages }) + "\n");
