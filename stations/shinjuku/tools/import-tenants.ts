/**
 * Build stations/shinjuku/gteki/tenants.json — the brand directory of 小田急百貨店 新宿店 — from the
 * facts-only research file docs/research/merchants/shinjuku-odakyu-dept-tenants.json (#419).
 *
 *   pnpm --filter @gteki/station-shinjuku import:tenants            # writes the file
 *   pnpm --filter @gteki/station-shinjuku import:tenants --check    # fails if the output would change
 *
 * Facts only: brand name, floor label and category exactly as the store prints them. The research file
 * carries nothing else (no hours, positions, logos or layouts), so nothing else is written. floorLabel is
 * the store's own wording (２階, 地下１階, 小田急エース北館) and is never mapped to a station floorId.
 * A row without a name or a floor label is skipped and counted; every id is kept exactly as researched,
 * so editing the research file alone can never renumber a listing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStationFiles, TENANTS_SCHEMA_VERSION, type EvidenceRef, type Tenant, type TenantFile } from "@gteki/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../gteki/tenants.json");
const RESEARCH = join(HERE, "../../../docs/research/merchants/shinjuku-odakyu-dept-tenants.json");
const POI = "shop-sjk-odakyudept";
const SOURCE = "odakyu-dept-shinjuku-2026-10";

interface ResearchTenant {
  id: string;
  name: string;
  aliases: string[];
  floorLabel: string;
  category: string | null;
}
interface ResearchFile {
  storePoiId: string;
  sourceId: string;
  retrievedAt: string;
  tenants: ResearchTenant[];
}

const research = JSON.parse(readFileSync(RESEARCH, "utf8")) as ResearchFile;
if (research.storePoiId !== POI) throw new Error(`research file is for ${research.storePoiId}, not ${POI}`);
if (research.sourceId !== SOURCE) throw new Error(`research file cites ${research.sourceId}, not ${SOURCE}`);

/** Date the directory was read (the research file's retrieval day); shown as the listing's as-of date. */
const CHECKED = research.retrievedAt.slice(0, 10);
const evidence = (): EvidenceRef => ({
  sourceIds: [SOURCE],
  method: "facts-only directory listing (OD-34), UNVERIFIED, SEARCH_ONLY",
  checkedDate: CHECKED,
});

const tenants: Tenant[] = [];
const skipped: { id: string; reason: string }[] = [];
let withoutCategory = 0;
for (const row of research.tenants) {
  const name = row.name.trim();
  const floor = row.floorLabel.trim();
  if (!name || !floor) {
    skipped.push({ id: row.id, reason: !name ? "no brand name printed" : "no floor label printed" });
    continue;
  }
  const category = row.category?.trim();
  if (category) tenants.push(tenant(row.id, name, row.aliases, floor, category));
  else {
    withoutCategory++;
    tenants.push(tenant(row.id, name, row.aliases, floor, null));
  }
}

function tenant(id: string, name: string, aliases: string[], floor: string, category: string | null): Tenant {
  return {
    id,
    poiId: POI,
    names: [{ lang: "ja", text: name }],
    aliases: aliases.map((text) => ({ lang: "ja", text })),
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
  read: research.tenants.length,
  written: tenants.length,
  skipped,
  withoutCategory,
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
