import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clipBaselineDiff, type ClipBaseline } from "./navmesh-clip-baseline.ts";

/** What the public gate only lets shrink from the PR base: edge ids of the committed lists and the clip baseline. */
export type GateSnapshot = { fallback: string[]; suspect: string[]; detours: string[]; clipBaseline: ClipBaseline };
/** A one-time, reviewed reset of the shrink-only gate, committed next to the baseline it moves. */
export type GateReset = { version: 1; station: string; date: string; ruling: string; followUps: string[]; before: Partial<GateSnapshot>; after: GateSnapshot };

export const gateResetFile = (station: string) => `stations/${station}/navmesh-gate-reset.json`;

export function gateSnapshot(fallback: readonly { edgeId: string }[], suspect: readonly { edgeId: string }[], detours: readonly string[], clipBaseline: ClipBaseline): GateSnapshot {
  return { fallback: fallback.map(e => e.edgeId).sort(), suspect: suspect.map(e => e.edgeId).sort(), detours: [...detours].sort(), clipBaseline };
}

const added = (before: readonly string[], after: readonly string[]) => after.filter(id => !before.includes(id));

/** Growth from the PR base; a part missing at the base (a new station) is not compared. */
export function gateGrowth(base: Partial<GateSnapshot>, head: GateSnapshot): string[] {
  const errors: string[] = [];
  const grew = (label: string, ids: string[]) => { if (ids.length) errors.push(`${label} grew from PR base: ${ids.join(", ")}`); };
  if (base.fallback) grew("fallback list", added(base.fallback, head.fallback));
  if (base.clipBaseline) grew("clip baseline", clipBaselineDiff(base.clipBaseline, head.clipBaseline).increased);
  if (base.suspect) grew("suspect list", added(base.suspect, head.suspect));
  if (base.detours) grew("navmesh detour list", added(base.detours, head.detours));
  return errors;
}

/** JSON with sorted keys, so two snapshots compare by content. */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

/**
 * Growth from the PR base fails unless this PR adds (or replaces) the station's reset record, whose `before` is the PR
 * base and whose `after` is exactly the committed new baseline. An unchanged record from an earlier PR allows nothing.
 */
export function gateResetErrors(station: string, base: Partial<GateSnapshot>, head: GateSnapshot, reset: unknown, baseReset: unknown): string[] {
  const growth = gateGrowth(base, head);
  if (!growth.length) return [];
  if (reset == null || canonical(reset) === canonical(baseReset)) return [...growth, `a one-time reset needs a new ${gateResetFile(station)} (see navmesh-gate-reset.ts)`];
  const r = reset as Partial<GateReset>, problems: string[] = [];
  if (r.version !== 1) problems.push("version must be 1");
  if (r.station !== station) problems.push(`station must be ${station}`);
  if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push("date must be YYYY-MM-DD");
  if (typeof r.ruling !== "string" || !r.ruling.trim()) problems.push("ruling must name the ruling");
  if (!Array.isArray(r.followUps) || !r.followUps.length || !r.followUps.every(f => typeof f === "string" && /^#\d+$/.test(f))) problems.push("followUps must list the follow-up issues as #N");
  if (canonical(r.before) !== canonical(base)) problems.push("before must equal the PR base");
  if (canonical(r.after) !== canonical(head)) problems.push("after must equal the committed baseline");
  return problems.length ? [...growth, ...problems.map(p => `${gateResetFile(station)}: ${p}`)] : [];
}

/** The committed gate files of a station, read from the work tree or from a git revision. */
export function readGateSnapshot(station: string, read: (file: string) => unknown | null): Partial<GateSnapshot> {
  const fallback = read(`stations/${station}/navmesh-fallback.json`) as { edgeId: string }[] | null;
  const suspect = read(`stations/${station}/navmesh-suspect.json`) as { edgeId: string }[] | null;
  const paths = read(`stations/${station}/navmesh-paths.json`) as { detours?: string[] } | null;
  const clipBaseline = read(`stations/${station}/navmesh-clip-baseline.json`) as ClipBaseline | null;
  const snapshot: Partial<GateSnapshot> = {};
  if (fallback) snapshot.fallback = fallback.map(e => e.edgeId).sort();
  if (suspect) snapshot.suspect = suspect.map(e => e.edgeId).sort();
  if (paths) snapshot.detours = [...(paths.detours ?? [])].sort();
  if (clipBaseline) snapshot.clipBaseline = clipBaseline;
  return snapshot;
}

export function readAtRevision(revision: string) {
  return (file: string): unknown | null => {
    const git = (args: string[]) => { const result = spawnSync("git", args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(`cannot inspect ${revision}: git ${args[0]}`); return result.stdout; };
    return git(["ls-tree", "--name-only", revision, "--", file]).trim() ? JSON.parse(git(["show", `${revision}:${file}`])) : null;
  };
}
export const readWorkTree = (file: string): unknown | null => fs.existsSync(path.resolve(file)) ? JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) : null;

// Write a reset record after regenerating the gate files: --station <s> --base <rev> --date <YYYY-MM-DD> --ruling <text> --follow-ups #1,#2
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); if (i < 0 || !args[i + 1]) throw new Error(`missing ${flag}`); return args[i + 1]!; };
  const station = value("--station"), head = readGateSnapshot(station, readWorkTree) as GateSnapshot;
  const record: GateReset = { version: 1, station, date: value("--date"), ruling: value("--ruling"), followUps: value("--follow-ups").split(",").map(s => s.trim()), before: readGateSnapshot(station, readAtRevision(value("--base"))), after: head };
  fs.writeFileSync(path.resolve(gateResetFile(station)), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ station, wrote: gateResetFile(station) }));
}
