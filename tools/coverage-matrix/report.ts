// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StationBundle } from "../../packages/schema/src/index.ts";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";
import { createRouter, DEFAULT_PROFILE } from "../../packages/navigation/src/index.ts";
import { createSearchIndex } from "../../packages/search/src/index.ts";
import { loadShinjukuBundle } from "../../stations/shinjuku/data/bundle.ts";
import { rowMap, type RowSpec } from "./rows.ts";

export interface CoverageRow {
  label: string;
  counts: Record<string, number>;
  searchable: boolean;
  routable: boolean;
}

const kinds = { ticket_gate: "gates", platform: "platforms", exit: "exits", elevator: "lifts",
  escalator: "escalators", shop: "shop POIs", toilet: "toilets", transfer: "transfers" } as const;

export function loadPublicBundles(): StationBundle[] {
  const dir = new URL("../../stations/ikebukuro/gteki/", import.meta.url);
  const read = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, dir), "utf8"));
  const parsed = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return [parsed.bundle, loadShinjukuBundle().bundle];
}

export function coverageRows(bundles: StationBundle[], specs: RowSpec[] = rowMap): CoverageRow[] {
  return bundles.flatMap((bundle) => {
    const router = createRouter(bundle);
    const index = createSearchIndex(bundle);
    // A connector must be reachable from a distinct node. Checking an actual incoming route also
    // excludes dangling/unmeasurable edges; a connector or floor alone is not routing evidence.
    const incoming = new Map<string, string[]>();
    const add = (to: string, from: string) => incoming.set(to, [...(incoming.get(to) ?? []), from]);
    for (const edge of bundle.edges.filter((edge) => router.isTraversable(edge, DEFAULT_PROFILE))) {
      add(edge.to, edge.from);
      if (edge.direction === "both") add(edge.from, edge.to);
    }
    const reachable = new Set(bundle.pois.filter((poi) => poi.connectorNodeIds.some((node) =>
      (incoming.get(node) ?? []).some((from) => from !== node && router.route(from, node).ok)))
      .map((poi) => poi.id));
    return specs.filter((spec) => spec.station === bundle.station.id).map((spec) => {
      const buildings = new Set(spec.buildings ?? []);
      const pois = bundle.pois.filter((poi) => buildings.has(poi.id) || spec.ids?.includes(poi.id)
        || spec.prefixes?.some((prefix) => poi.id.startsWith(prefix)));
      const ids = new Set(pois.map((poi) => poi.id));
      const tenants = (bundle.tenants ?? []).filter((tenant) => ids.has(tenant.poiId));
      const counts: Record<string, number> = Object.fromEntries(Object.values(kinds).map((kind) => [kind, 0]));
      for (const poi of pois) {
        if (buildings.has(poi.id)) continue; // Building POIs are separate from their shop POIs.
        const kind = kinds[poi.category as keyof typeof kinds];
        if (kind) counts[kind]!++;
      }
      counts.POIs = pois.filter((poi) => buildings.has(poi.id)).length;
      counts.tenants = tenants.length;
      counts.routed = pois.filter((poi) => reachable.has(poi.id)).length;
      counts["routed gates"] = pois.filter((poi) => poi.category === "ticket_gate" && reachable.has(poi.id)).length;
      if (spec.graph) { counts.nodes = bundle.nodes.length; counts.edges = bundle.edges.length; }
      const searchable = pois.some((poi) => [...poi.names, ...poi.aliases].some(({ text }) =>
        index.search(text, { limit: bundle.pois.length }).some((hit) => hit.poi.id === poi.id)))
        || tenants.some((tenant) => tenant.names.some(({ text }) => index.search(text, { limit: bundle.pois.length })
          .some((hit) => hit.poi.id === tenant.poiId)));
      return { label: spec.label, counts, searchable, routable: counts.routed > 0 };
    });
  }).sort((a, b) => specs.findIndex((spec) => spec.label === a.label) - specs.findIndex((spec) => spec.label === b.label));
}

export function markdown(rows: CoverageRow[]): string {
  return ["| Station · line/store | Walk graph | POIs (building POIs separate from shop POIs) | Tenants | Search / route |",
    "|---|---|---|---|---|", ...rows.map(({ label, counts, searchable, routable }) => {
      const pois = ["POIs", ...Object.values(kinds)].filter((kind) => counts[kind])
        .map((kind) => `${counts[kind]} ${kind}`).join(" + ") || "0 POIs";
      return `| ${label} | ${counts.nodes === undefined ? "—" : `${counts.nodes} nodes / ${counts.edges} edges`} | ${pois} | ${counts.tenants} tenants | search ${searchable ? "y" : "n"}; route ${routable ? "y" : "n"} |`;
    })].join("\n");
}

/** Only count assertions in the three derived cells; floor/platform numbers and issue ids are prose. */
export function checkMatrix(text: string, rows: CoverageRow[]): string[] {
  const mismatches: string[] = [];
  const cellsByLabel = new Map(text.split("\n").filter((line) => line.startsWith("| "))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map((cells) => [cells[0]!, cells]));
  for (const row of rows) {
    const cells = cellsByLabel.get(row.label);
    if (!cells) { mismatches.push(`${row.label}: missing matrix row`); continue; }
    const compare = (kind: string, stated: number) => {
      if ((kind === "nodes" || kind === "edges") && row.counts[kind] === undefined) {
        mismatches.push(`${row.label}: ${kind}: matrix ${stated}, derived unavailable (no public row graph)`);
        return;
      }
      const actual = row.counts[kind] ?? 0;
      if (actual !== stated) mismatches.push(`${row.label}: ${kind}: matrix ${stated}, derived ${actual}`);
    };
    const walk = cells[3] ?? "";
    for (const match of walk.matchAll(/([\d,]+)[- ](node|edge)s?\b/g))
      compare(`${match[2]}s`, Number(match[1]!.replaceAll(",", "")));
    const pois = cells[4] ?? "";
    for (const match of pois.matchAll(/([\d,]+)\s+((?:[\p{L}\p{M}][\p{L}\p{M}\p{N}_-]*\s+)*?)(shop POIs?|POIs?|gates?|platforms?|exits?|lifts?|escalators?|toilets?|transfers?|tenants?|routed)\b/gu)) {
      const raw = match[3]!;
      const kind = raw === "routed" ? raw : raw.endsWith("s") ? raw : `${raw}s`;
      if (match[2] && row.counts[kind] === undefined) {
        mismatches.push(`${row.label}: ${match[0]}: not compared (no derived ${kind})`);
        continue;
      }
      compare(kind, Number(match[1]!.replaceAll(",", "")));
    }
    if (/no platforms?(?: POIs)?\b/.test(pois)) compare("platforms", 0);
    const transfers = pois.match(/(\d+)\s+JR連絡/);
    if (transfers) compare("transfers", Number(transfers[1]));
    // Isetan's directory is stored as tenants, comprising both sections and brands.
    const directory = [...pois.matchAll(/([\d,]+)\s+(?:sections|brands)\b/g)];
    if (directory.length) compare("tenants", directory.reduce((sum, match) => sum + Number(match[1]!.replaceAll(",", "")), 0));
    const searchRoute = cells[5] ?? "";
    for (const [name, actual] of [["search", row.searchable], ["route", row.routable]] as const) {
      const stated = searchRoute.match(new RegExp(`\\b${name}\\s+([yn])\\b`));
      if (stated && (stated[1] === "y") !== actual)
        mismatches.push(`${row.label}: ${name}: matrix ${stated[1]}, derived ${actual ? "y" : "n"}`);
    }
    const routedGates = searchRoute.match(/route to (\d+) gates/);
    if (routedGates) compare("routed gates", Number(routedGates[1]));
  }
  for (const label of cellsByLabel.keys()) {
    if (!label.startsWith("Station") && !rows.some((row) => row.label === label))
      mismatches.push(`${label}: missing row map entry`);
  }
  return mismatches;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = coverageRows(loadPublicBundles());
  console.log(markdown(rows));
  if (process.argv.includes("--check")) {
    const mismatches = checkMatrix(readFileSync(new URL("../../docs/research/coverage-matrix.md", import.meta.url), "utf8"), rows);
    console.log("\n" + (mismatches.length ? mismatches.map((line) => `- ${line}`).join("\n") : "No coverage-matrix drift."));
    // Drift is informational in CI, never an exit-status gate.
  }
}
