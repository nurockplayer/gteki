/**
 * Build stations/shinjuku/gteki/tenants.json — the brand directories of 小田急百貨店 新宿店, the three
 * 新宿マルイ buildings and the 売場 sections of 伊勢丹新宿店 本館/メンズ館 — from the facts-only research files
 * under docs/research/merchants/ (#419; 伊勢丹 promoted under OD-35).
 *
 *   pnpm --filter @gteki/station-shinjuku import:tenants            # writes the file
 *   pnpm --filter @gteki/station-shinjuku import:tenants --check    # fails if the output would change
 *
 * Facts only: brand name, floor label and category exactly as the store prints them. The research files
 * carry nothing else (no hours, positions, logos or layouts), so nothing else is written. floorLabel is
 * the store's own wording (２階, 地下１階, 小田急エース北館, 3F) and is never mapped to a station floorId.
 * A row without a name or a floor label is skipped and counted; every id is kept exactly as researched,
 * so editing the research file alone can never renumber a listing.
 *
 * One research file may cover several buildings (マルイ 本館 / アネックス / メン); each row then names its
 * store POI, which must be one of the buildings that file covers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStationFiles, TENANTS_SCHEMA_VERSION, type EvidenceRef, type LocalizedText, type Tenant, type TenantFile } from "@gteki/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../gteki/tenants.json");

const SOURCES = [
  {
    file: join(HERE, "../../../docs/research/merchants/shinjuku-odakyu-dept-tenants.json"),
    sourceId: "odakyu-dept-shinjuku-2026-10",
    storePoiIds: ["shop-sjk-odakyudept"],
  },
  {
    file: join(HERE, "../../../docs/research/merchants/shinjuku-marui-tenants.json"),
    sourceId: "marui-shinjuku-floorguide-2026-10",
    storePoiIds: ["shop-sjk-marui-honkan", "shop-sjk-marui-annex", "shop-sjk-marui-men"],
  },
  {
    file: join(HERE, "../../../docs/research/merchants/shinjuku-isetan-sections.json"),
    sourceId: "isetan-shinjuku-floorguide-2026-10",
    storePoiIds: ["shop-sjk-isetan-honkan", "shop-sjk-isetan-mens"],
  },
];

interface ResearchTenant {
  id: string;
  name: string;
  /** Odakyu prints bare kana strings; Marui tags each reading with its language. */
  aliases: (string | LocalizedText)[];
  floorLabel: string;
  category: string | null;
  /** Per-row store POI when one file covers several buildings (Marui). */
  storePoiId?: string;
}
interface ResearchFile {
  storePoiId?: string;
  storePoiIds?: string[];
  sourceId: string;
  retrievedAt: string;
  tenants: ResearchTenant[];
}

const tenants: Tenant[] = [];
const skipped: { id: string; reason: string }[] = [];
const bySource: { sourceId: string; read: number; written: number; skipped: number; withoutCategory: number }[] = [];
let withoutCategory = 0;

for (const source of SOURCES) {
  const research = JSON.parse(readFileSync(source.file, "utf8")) as ResearchFile;
  if (research.sourceId !== source.sourceId) throw new Error(`research file cites ${research.sourceId}, not ${source.sourceId}`);
  const declared = research.storePoiIds ?? (research.storePoiId === undefined ? [] : [research.storePoiId]);
  if (declared.length !== source.storePoiIds.length || declared.some((id) => !source.storePoiIds.includes(id)))
    throw new Error(`${source.sourceId} covers ${declared.join(", ") || "no store"}, not ${source.storePoiIds.join(", ")}`);

  /** Date the directory was read (the research file's retrieval day); shown as the listing's as-of date. */
  const CHECKED = research.retrievedAt.slice(0, 10);
  const evidence = (): EvidenceRef => ({
    sourceIds: [source.sourceId],
    method: "facts-only directory listing (OD-34), UNVERIFIED, SEARCH_ONLY",
    checkedDate: CHECKED,
  });

  let written = 0;
  let sourceSkipped = 0;
  let sourceWithoutCategory = 0;
  for (const row of research.tenants) {
    const poiId = row.storePoiId ?? research.storePoiId;
    if (poiId === undefined || !source.storePoiIds.includes(poiId))
      throw new Error(`${row.id} belongs to ${poiId ?? "no store"}, which ${source.sourceId} does not cover`);
    const name = row.name.trim();
    const floor = row.floorLabel.trim();
    if (!name || !floor) {
      skipped.push({ id: row.id, reason: !name ? "no brand name printed" : "no floor label printed" });
      sourceSkipped++;
      continue;
    }
    const category = row.category?.trim();
    if (category) tenants.push(tenant(row.id, poiId, name, row.aliases, floor, category, evidence));
    else {
      withoutCategory++;
      sourceWithoutCategory++;
      tenants.push(tenant(row.id, poiId, name, row.aliases, floor, null, evidence));
    }
    written++;
  }
  bySource.push({ sourceId: source.sourceId, read: research.tenants.length, written, skipped: sourceSkipped, withoutCategory: sourceWithoutCategory });
}

function tenant(
  id: string,
  poiId: string,
  name: string,
  aliases: (string | LocalizedText)[],
  floor: string,
  category: string | null,
  evidence: () => EvidenceRef,
): Tenant {
  return {
    id,
    poiId,
    names: [{ lang: "ja", text: name }],
    aliases: aliases.map((alias) => (typeof alias === "string" ? { lang: "ja", text: alias } : alias)),
    floorLabel: [{ lang: "ja", text: floor }],
    ...(category === null ? {} : { category: [{ lang: "ja", text: category }] }),
    evidence: evidence(),
  };
}

const file: TenantFile = { schema: TENANTS_SCHEMA_VERSION, tenants };

// Validate the directory in place against the station's own files before writing it.
const read = (name: string) => JSON.parse(readFileSync(join(HERE, "../gteki", name), "utf8"));
const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), file);
const errors = parsed.issues.filter((i) => i.level === "error");
if (errors.length) {
  console.error(errors);
  process.exit(1);
}

const report = {
  read: bySource.reduce((n, s) => n + s.read, 0),
  written: tenants.length,
  skipped,
  withoutCategory,
  sources: bySource,
  warnings: parsed.issues.filter((i) => i.level === "warning").length,
};
console.log(JSON.stringify(report, null, 2));

const text = JSON.stringify(file) + "\n";
if (process.argv.includes("--check")) {
  let old = "";
  try {
    old = readFileSync(OUT, "utf8");
  } catch {}
  if (old !== text) {
    console.error("tenants.json is out of date");
    process.exit(1);
  }
} else writeFileSync(OUT, text);
