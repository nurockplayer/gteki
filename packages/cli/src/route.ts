import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Node, StationBundle, Vec3N } from "@gteki/schema";
import { parseStationFiles } from "@gteki/schema";
import { createRouter, describeRoute, routeBetween, routePolyline, type RouteEndpoint, type RouteFailure, type RouteProfile, type RouteResult, type Router } from "@gteki/navigation";
import { enuToRenderer } from "@gteki/geo";

interface CliOptions {
  stationDir: string;
  from: string;
  goals: string[];
  profile: RouteProfile;
  /** `from` is a POI id (routed via its connector nodes) instead of a node id. */
  fromPoi: boolean;
  /** The single goal is a POI id (routed via its connector nodes) instead of node ids. */
  goalPoi: boolean;
}

function usage(): string {
  return "Usage: route.ts <stationDir> <from> <comma-separated goals> [--step-free] [--unpaid-only] [--strict-hours] [--today YYYY-MM-DD] [--from-poi] [--goal-poi]";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseArgs(args: string[]): CliOptions | string {
  if (args.length < 3) return usage();
  const [stationDir, from, rawGoals] = args;
  if (!stationDir || !from || !rawGoals) return usage();
  const profile: RouteProfile = { fare: "ticketed", stepFree: false };
  let fromPoi = false;
  let goalPoi = false;
  for (let i = 3; i < args.length; i++) {
    switch (args[i]) {
      case "--step-free": profile.stepFree = true; break;
      case "--unpaid-only": profile.fare = "unpaid_only"; break;
      case "--strict-hours": profile.hours = "require_known"; break;
      case "--from-poi": fromPoi = true; break;
      case "--goal-poi": goalPoi = true; break;
      case "--today": {
        const value = args[++i];
        if (!value || !validDate(value)) return "--today requires a valid YYYY-MM-DD date";
        profile.today = value;
        break;
      }
      default: return `Unknown option: ${args[i]}`;
    }
  }
  const goals = rawGoals.split(",").map((goal) => goal.trim()).filter(Boolean);
  if (goals.length === 0) return "At least one goal node is required";
  if (goalPoi && goals.length !== 1) return "--goal-poi takes exactly one POI id";
  return { stationDir, from, goals, profile, fromPoi, goalPoi };
}

async function loadStation(stationDir: string): Promise<StationBundle | null> {
  const names = ["station.json", "graph.json", "pois.json"] as const;
  const values: unknown[] = [];
  const issues: string[] = [];
  for (const name of names) {
    try {
      values.push(JSON.parse(await readFile(resolve(stationDir, "gteki", name), "utf8")) as unknown);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      issues.push(`${name}: ${detail}`);
      values.push(undefined);
    }
  }
  if (issues.length > 0) {
    process.stderr.write(`${issues.join("\n")}\n`);
    return null;
  }

  const parsed = parseStationFiles(values[0], values[1], values[2]);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.issues.map(({ level, code, message }) => `${level} ${code}: ${message}`).join("\n")}\n`);
    return null;
  }
  return parsed.bundle;
}

interface PathNode {
  nodeId: string;
  enu: Vec3N;
  renderer: [number, number, number];
  heightSymbolic: boolean;
}

export function renderPath(bundle: StationBundle, route: RouteResult): PathNode[] {
  const nodes = new Map<string, Node>(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  return route.nodeIds.map((nodeId) => {
    const node = nodes.get(nodeId)!;
    const { x, y, z } = node.position;
    const renderZ = z ?? node.renderZ ?? floors.get(node.floorId)!.renderElevationM;
    return {
      nodeId,
      enu: { x, y, z },
      renderer: enuToRenderer({ x, y, z: renderZ }),
      heightSymbolic: z === null,
    };
  });
}

/** POI endpoints resolve to connector nodes through the shared `routeBetween` (the rule the web explorer uses). */
function routeByPoi(bundle: StationBundle, router: Router, options: CliOptions): RouteResult | RouteFailure {
  const pois = new Map(bundle.pois.map((poi) => [poi.id, poi]));
  let from: RouteEndpoint = { kind: "node", nodeId: options.from };
  if (options.fromPoi) {
    const poi = pois.get(options.from);
    if (!poi) return { ok: false, reason: "unknown_start", message: `unknown origin POI ${options.from}` };
    from = { kind: "poi", poi };
  }
  if (options.goalPoi) {
    const goal = pois.get(options.goals[0]!);
    if (!goal) return { ok: false, reason: "unknown_goal", message: `unknown destination POI ${options.goals[0]}` };
    return routeBetween(router, from, goal, options.profile);
  }
  // POI origin, node goals: resolve the origin's connectors only (a POI never routes from a bare display position).
  if (from.kind !== "poi" || from.poi.connectorNodeIds.length === 0) return { ok: false, reason: "unknown_start", message: "origin has no verified entrance" };
  // Same origin fare rule as `routeBetween` (packages/navigation/src/poi.ts; it needs a Poi goal, so it cannot be called
  // here): under `unpaid_only` a POI that is not known to be outside the paid area fails closed.
  if (options.profile.fare === "unpaid_only" && from.poi.paid !== false)
    return { ok: false, reason: "no_path", message: `origin ${from.poi.id} is ${from.poi.paid === true ? "inside" : "not known to be outside"} the paid area` };
  return router.route(from.poi.connectorNodeIds, options.goals, options.profile, [from.poi.evidence]);
}

export async function runRoute(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (typeof options === "string") {
    process.stderr.write(`${options}\n${usage()}\n`);
    return 2;
  }
  const bundle = await loadStation(options.stationDir);
  if (!bundle) return 2;

  const router = createRouter(bundle);
  const result = options.fromPoi || options.goalPoi ? routeByPoi(bundle, router, options) : router.route(options.from, options.goals, options.profile);
  const path = result.ok ? renderPath(bundle, result) : [];
  // Same renderer-neutral presentation the web explorer uses: edge-geometry polyline and ja/en instructions.
  const polyline = result.ok
    ? routePolyline(bundle, result).map((p) => ({ ...p, renderer: enuToRenderer({ x: p.x, y: p.y, z: p.z }) }))
    : [];
  const instructions = result.ok ? { ja: describeRoute(bundle, result, "ja"), en: describeRoute(bundle, result, "en") } : { ja: [], en: [] };
  process.stdout.write(`${JSON.stringify({ contract: "gteki.route/0.1", stationId: bundle.station.id, result, path, polyline, instructions }, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRoute(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
