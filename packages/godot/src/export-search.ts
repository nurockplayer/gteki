/**
 * Writes the search data a Godot search box needs: `gteki.search/0.1` JSON for one station.
 * Normalised keys come from `@gteki/search` (`normalizeJa`); Godot never decides what a name is.
 * Usage: export-search.ts <stationDir> <outFile>
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { enuToRenderer } from "../../geo/src/index.ts";
import { nodeDisplayZ } from "../../navigation/src/index.ts";
import { normalizeJa } from "../../search/src/index.ts";
import type { LocalizedText, Poi, StationBundle } from "../../schema/src/index.ts";
import { loadBundle } from "./load-bundle.ts";

export const DISPLAY_LANGS = ["ja", "en", "zh-Hant"] as const;

export const NORMALIZATION = {
  id: "gteki.search.normalizeJa/1",
  // Mirrors packages/search/src/search.ts `normalizeJa`; golden vectors live in search-goldens.json.
  steps: [
    "NFKC normalise",
    "lower-case",
    "katakana U+30A1..U+30F6 -> hiragana (code point - 0x60)",
    "delete every whitespace, Unicode punctuation (\\p{P}), U+2212, U+301C, U+FF5E, '~', '<', '>' and U+30FC (long-vowel mark)",
  ],
} as const;

export const SCORING = {
  note: "Tiers of @gteki/search for one normalised key: exact 100, startsWith 80, endsWith 70, contains 60. A POI scores its best key, +5 when routable. Ordered subsequence, script-run and multi-token matches (<= 40) exist only in the TS index: use search-query.ts for those.",
  exact: 100, prefix: 80, suffix: 70, contains: 60, routableBonus: 5,
} as const;

type Names = Record<(typeof DISPLAY_LANGS)[number], string | null>;

function displayNames(poi: Poi): Names {
  const pick = (lang: string) => poi.names.find((n) => n.lang === lang)?.text ?? poi.aliases.find((n) => n.lang === lang)?.text ?? null;
  return { ja: pick("ja"), en: pick("en"), "zh-Hant": pick("zh-Hant") };
}

// Our own descriptive text (#595): a subtitle for the row, never its name.
function displayDescriptions(poi: Poi): Names {
  const pick = (lang: string) => poi.descriptions?.find((n) => n.lang === lang)?.text ?? null;
  return { ja: pick("ja"), en: pick("en"), "zh-Hant": pick("zh-Hant") };
}

function keys(poi: Poi): { lang: string; text: string; norm: string }[] {
  const seen = new Set<string>();
  const out: { lang: string; text: string; norm: string }[] = [];
  for (const { lang, text } of [...poi.names, ...poi.aliases, ...(poi.descriptions ?? [])] as LocalizedText[]) {
    const norm = normalizeJa(text);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ lang, text, norm });
  }
  return out;
}

export function buildSearchExport(bundle: StationBundle) {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));

  const position = (poi: Poi) => {
    const node = poi.connectorNodeIds.map((id) => nodes.get(id)).find(Boolean);
    if (node) {
      const { z, known } = nodeDisplayZ(node, floors.get(node.floorId));
      return { source: "connector_node" as const, nodeId: node.id, renderer: enuToRenderer({ x: node.position.x, y: node.position.y, z }), zKnown: known };
    }
    if (poi.displayPosition) {
      const { x, y, z } = poi.displayPosition;
      const renderZ = z ?? floors.get(poi.floorId ?? "")?.renderElevationM ?? 0;
      return { source: "display_position" as const, nodeId: null, renderer: enuToRenderer({ x, y, z: renderZ }), zKnown: z !== null };
    }
    return null;
  };

  return {
    contract: "gteki.search/0.1",
    stationId: bundle.station.id,
    stationNames: bundle.station.names,
    synthetic: bundle.station.synthetic,
    normalization: NORMALIZATION,
    scoring: SCORING,
    floors: bundle.floors.map((f) => ({
      id: f.id,
      displayNames: f.displayNames ?? [],
      sourceLabels: f.sourceLabels.map((l) => l.label),
      renderElevationM: f.renderElevationM,
      elevationKnown: f.elevationM !== null,
    })),
    entries: bundle.pois.map((poi) => ({
      poiId: poi.id,
      category: poi.category,
      floorId: poi.floorId,
      names: displayNames(poi),
      descriptions: displayDescriptions(poi),
      // true only when the data lists at least one connector node; false = search-only, never route to it.
      routable: poi.connectorNodeIds.length > 0,
      nodeIds: poi.connectorNodeIds,
      // true / false / null (null = unknown, never guessed).
      paid: poi.paid,
      position: position(poi),
      // An approximate point is search display only (#463): the ± radius and the two fixed markers, never
      // coordinates (they would be mistaken for a renderer position) and never a route.
      approximate: poi.approximatePosition
        ? {
            uncertaintyM: poi.approximatePosition.uncertaintyM,
            navigationUse: poi.approximatePosition.navigationUse,
            floor: poi.approximatePosition.floor,
          }
        : null,
      keys: keys(poi),
      evidence: { sourceIds: poi.evidence.sourceIds, method: poi.evidence.method, checkedDate: poi.evidence.checkedDate, note: poi.evidence.note ?? null },
      notes: poi.notes ?? [],
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [stationDir, outFile] = process.argv.slice(2);
  if (!stationDir || !outFile) throw new Error("Usage: export-search.ts <stationDir> <outFile>");
  await writeFile(outFile, `${JSON.stringify(buildSearchExport(await loadBundle(stationDir)), null, 2)}\n`);
}
