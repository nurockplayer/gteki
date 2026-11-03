// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StationBundle } from "../../packages/schema/src/index.ts";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";
import { createRouter, DEFAULT_PROFILE, explainNoPathWith, floorDisplayName } from "../../packages/navigation/src/index.ts";
import { createSearchIndex } from "../../packages/search/src/index.ts";
import { loadShinjukuBundle } from "../../stations/shinjuku/data/bundle.ts";
import { rowMap, type RowSpec } from "./rows.ts";

export interface CoverageRow {
  label: string;
  counts: Record<string, number>;
  searchable: boolean;
  routable: boolean;
  stepFree: {
    passed: number;
    total: number;
    pairs: {
      from: string; to: string; ok: boolean;
      blocker?: { station: string; edgeId: string; floors: string; near: string;
        reason: string; evidence: string; vertical: boolean };
    }[];
  };
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
    const stepFreeProfile = { ...DEFAULT_PROFILE, stepFree: true };
    const edges = new Map(bundle.edges.map((edge) => [edge.id, edge]));
    const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
    const name = (poi: StationBundle["pois"][number]) =>
      `${poi.names.find((name) => name.lang === "ja")?.text ?? poi.names[0]?.text ?? poi.id} (${poi.id})`;
    const endpoints = bundle.pois.filter((poi) => reachable.has(poi.id)
      && (poi.category === "exit" || poi.category === "platform"));
    // Shared rows reuse the same directed POI queries; directions are never collapsed.
    const pairCache = new Map<string, CoverageRow["stepFree"]["pairs"][number] | null>();
    const pair = (from: StationBundle["pois"][number], to: StationBundle["pois"][number]) => {
      const key = JSON.stringify([from.id, to.id]);
      if (pairCache.has(key)) return pairCache.get(key)!;
      const ordinary = router.route(from.connectorNodeIds, to.connectorNodeIds, DEFAULT_PROFILE);
      // Includes coincident connectors: start_equals_goal is not a default-profile route.
      if (!ordinary.ok) { pairCache.set(key, null); return null; }
      const result: CoverageRow["stepFree"]["pairs"][number] = {
        from: name(from), to: name(to), ok: router.route(from.connectorNodeIds, to.connectorNodeIds, stepFreeProfile).ok,
      };
      if (!result.ok) {
        const step = ordinary.steps.find((step) => !router.isTraversable(edges.get(step.edgeId)!, stepFreeProfile))!;
        const edge = edges.get(step.edgeId)!;
        const a = nodes.get(edge.from)!;
        const b = nodes.get(edge.to)!;
        const floor = (id: string) => `${floorDisplayName(bundle.floors.find((floor) => floor.id === id))} (${id})`;
        const nearest = (node: typeof a) => bundle.pois.flatMap((poi) => poi.connectorNodeIds.flatMap((id) => {
          const connector = nodes.get(id);
          return connector?.floorId === node.floorId
            ? [{ poi, distance: Math.hypot(connector.position.x - node.position.x, connector.position.y - node.position.y) }] : [];
        })).sort((a, b) => a.distance - b.distance)[0]?.poi;
        const near = [...new Set([nearest(a), nearest(b)].filter((poi) => poi !== undefined).map(name))].join(" / ");
        // Reuse the navigation explanation's known/unknown/mixed classification on the default route.
        const cause = explainNoPathWith(() => ordinary, stepFreeProfile, { router, bundle });
        const evidence = cause.kind === "option" ? cause.options[0]!.evidence : null;
        const reason = edge.mode === "stairs" || edge.mode === "escalator" ? `known step (${edge.mode})`
          : !edge.accessEvidence ? "unsurveyed (missing accessEvidence)"
          : edge.wheelchair === null ? "unsurveyed (wheelchair null)"
          : "known not step-free (wheelchair false / steps true)";
        result.blocker = { station: bundle.station.id, edgeId: edge.id,
          floors: `${floor(a.floorId)} and ${floor(b.floorId)}`, near: `${near}; nodes ${edge.from} / ${edge.to}`,
          reason, evidence: evidence ?? "unknown", vertical: a.floorId !== b.floorId };
      }
      pairCache.set(key, result);
      return result;
    };
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
      const routablePois = pois.filter((poi) => reachable.has(poi.id));
      const pairs = new Map<string, CoverageRow["stepFree"]["pairs"][number]>();
      for (const from of routablePois) for (const to of [...routablePois, ...endpoints]) {
        if (from.id === to.id) continue;
        for (const [a, b] of [[from, to], [to, from]]) {
          const result = pair(a!, b!);
          if (result) pairs.set(JSON.stringify([a!.id, b!.id]), result);
        }
      }
      const values = [...pairs.values()];
      return { label: spec.label, counts, searchable, routable: counts.routed > 0,
        stepFree: { passed: values.filter((pair) => pair.ok).length, total: values.length, pairs: values } };
    });
  }).sort((a, b) => specs.findIndex((spec) => spec.label === a.label) - specs.findIndex((spec) => spec.label === b.label));
}

export function markdown(rows: CoverageRow[]): string {
  return ["| Station · line/store | Walk graph | POIs (building POIs separate from shop POIs) | Tenants | Search / route |",
    "|---|---|---|---|---|", ...rows.map(({ label, counts, searchable, routable, stepFree }) => {
      const pois = ["POIs", ...Object.values(kinds)].filter((kind) => counts[kind])
        .map((kind) => `${counts[kind]} ${kind}`).join(" + ") || "0 POIs";
      return `| ${label} | ${counts.nodes === undefined ? "—" : `${counts.nodes} nodes / ${counts.edges} edges`} | ${pois} | ${counts.tenants} tenants | search ${searchable ? "y" : "n"}; route ${routable ? "y" : "n"}; step-free ${stepFree.passed}/${stepFree.total} |`;
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
    const mentions = [...`${walk}; ${searchRoute}`.matchAll(/step-free\s+(\d+)\/(\d+)\b/g)];
    if (!mentions.length && row.stepFree.total > 0) mismatches.push(`${row.label}: missing step-free k/n`);
    for (const stated of mentions) {
      if (Number(stated[1]) !== row.stepFree.passed || Number(stated[2]) !== row.stepFree.total)
        mismatches.push(`${row.label}: step-free: matrix ${stated[1]}/${stated[2]}, derived ${row.stepFree.passed}/${row.stepFree.total}`);
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

function gapMarkdown(rows: CoverageRow[]): string {
  const stations = new Map<string, Map<string, { blocker: NonNullable<CoverageRow["stepFree"]["pairs"][number]["blocker"]>; pairs: Set<string> }>>();
  for (const row of rows) for (const pair of row.stepFree.pairs) {
    const blocker = pair.blocker;
    if (!blocker) continue;
    if (!stations.has(blocker.station)) stations.set(blocker.station, new Map());
    const groups = stations.get(blocker.station)!;
    if (!groups.has(blocker.edgeId)) groups.set(blocker.edgeId, { blocker, pairs: new Set() });
    groups.get(blocker.edgeId)!.pairs.add(`${pair.from} → ${pair.to} (route evidence: ${blocker.evidence})`);
  }
  return [...stations].map(([station, groups]) => {
    const count = [...groups.values()].reduce((sum, group) => sum + group.pairs.size, 0);
    return [`## Step-free gaps: ${station}`, `${count} distinct failing ordered pairs; ${groups.size} first-blocking links.`,
      "First blockers on default-profile routes only; later barriers may remain. Same-floor UNKNOWN links need an access survey, not an inferred lift.",
      ...[...groups.values()].map(({ blocker, pairs }) =>
        `### ${blocker.edgeId} — ${pairs.size} pairs\n${blocker.reason}; ${blocker.vertical ? "needs a lift between" : "needs an access survey between"} ${blocker.floors} near ${blocker.near}.\n\n${[...pairs].map((pair) => `- ${pair}`).join("\n")}`)].join("\n\n");
  }).join("\n\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = performance.now();
  const rows = coverageRows(loadPublicBundles());
  console.log(markdown(rows));
  console.log("\n" + gapMarkdown(rows));
  console.log(`\nCoverage generated in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
  if (process.argv.includes("--check")) {
    const mismatches = checkMatrix(readFileSync(new URL("../../docs/research/coverage-matrix.md", import.meta.url), "utf8"), rows);
    console.log("\n" + (mismatches.length ? mismatches.map((line) => `- ${line}`).join("\n") : "No coverage-matrix drift."));
    // Drift is informational in CI, never an exit-status gate.
  }
}
