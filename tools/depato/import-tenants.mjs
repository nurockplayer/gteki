// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../stations/", import.meta.url);

// Coverage follows the two depato-tenants/SOURCES.md registers. Floors with
// source rows are complete unless the register describes a partial roster.
const partial = {
  "odakyu-shinjuku": ["B3", "MB3", "1F", "7F"],
  "takashimaya-shinjuku": ["B1", "1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F", "9F", "10F", "11F"],
  "esola-ikebukuro": ["9F"],
};

function matchingFloor(store, row) {
  let level = row.level.normalize("NFKC")
    .replace(/^地下(\d+)階$/, "B$1")
    .replace(/^(\d+)階$/, "$1F")
    .replace(/^(B\d+)(?:F|階)$/, "$1")
    .replace(/^MB階$/, "MB");
  if (store.id === "keio-shinjuku" && level === "屋上") level = "RF";
  if (store.id === "odakyu-shinjuku" && level === "R") level = "RF";
  if (store.id === "sunshine-city-world-import-mart") {
    if (level === "屋上(10F)") level = "10F";
    if (level === "屋上") level = "RF";
  }
  if (store.id === "newoman-shinjuku") {
    const floorCode = new URL(row.source).searchParams.get("floor");
    return store.floors.find(floor => new URL(floor.source).searchParams.get("floor") === floorCode);
  }
  const floors = store.floors.filter(floor => floor.level === level);
  if (store.id === "seibu-ikebukuro") {
    return floors.find(floor => !floor.source.endsWith("/annex-bookstore"));
  }
  if (store.id === "ikebukuro-parco") {
    // SOURCES.md assigns the separately listed B2 pop-up to the main building.
    const wing = new URL(row.source).searchParams.get("ft") ?? "type1";
    return floors.find(floor => new URL(floor.source).searchParams.get("ft") === wing);
  }
  return floors[0];
}

const key = text => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const sameJa = (a, b) => key(a.ja) === key(b.ja);
const sameEn = (a, b) => a.en && b.en && key(a.en) === key(b.en);

function importFloor(rows, floor, report) {
  const shops = rows.filter(row => row.kind === "shop");
  const aliases = new Set();
  for (const row of rows.filter(row => row.kind === "brand")) {
    const matches = shops.filter(shop => sameJa(row, shop) || sameEn(row, shop));
    if (matches.length !== 1) continue;
    const [shop] = matches;
    // A brand stocked at another named shop can also have its own storefront.
    const otherShop = row.zone && shops.some(other => other !== shop && key(other.ja) === key(row.zone));
    if (otherShop && key(row.zone) !== key(shop.zone)) continue;
    report.merged.push([row.line, row.level, row.ja, shop.line, shop.ja]);
    aliases.add(row);
    shop.en ||= row.en;
    shop.category ||= row.category;
    shop.zone ||= row.zone;
  }

  // Pair source rows with existing entries one-to-one. Match the original
  // Japanese label before Latin aliases, and keep the original order.
  const listings = rows.filter(row => !aliases.has(row));
  const existing = new Set(floor.tenants);
  const matched = new Map();
  for (const sameName of [sameJa, sameEn]) {
    for (const row of listings) {
      if (matched.has(row)) continue;
      const candidates = [...existing].filter(tenant => sameName(row, tenant));
      const tenant = candidates.find(t => t.zone_text === row.zone) ?? candidates[0];
      if (tenant) {
        matched.set(row, tenant);
        existing.delete(tenant);
      }
    }
  }

  for (const row of listings) {
    const tenant = matched.get(row) ?? { ja: row.ja, en: row.en || row.ja };
    if (row.en && tenant.en === tenant.ja) tenant.en = row.en;
    if (row.category) tenant.category ??= row.category;
    if (row.zone) tenant.zone_text ??= row.zone;
    if (!matched.has(row)) floor.tenants.push(tenant);
  }
  return { source: listings.length, existingOnly: existing.size };
}

const report = {};
for (const station of readdirSync(root).sort()) {
  const input = new URL(`${station}/data/depato-tenants/`, root);
  if (!existsSync(input)) continue;
  const output = new URL(`${station}/data/depato-floors.json`, root);
  const data = JSON.parse(readFileSync(output, "utf8"));

  for (const file of readdirSync(input).filter(name => name.endsWith(".tsv")).sort()) {
    const id = file.slice(0, -4);
    const store = data.stores.find(item => item.id === id);
    const totals = report[id] = { raw: 0, merged: [], gaps: [], floors: [] };
    const byFloor = new Map();
    const lines = readFileSync(new URL(file, input), "utf8").trimEnd().split(/\r?\n/);
    if (lines.shift() !== "floor_label\tname_ja\tname_latin\tcategory\tzone_text\tsource_url\tfetched_jst") {
      throw new Error(`Unexpected columns in ${join(station, file)}`);
    }
    for (const [index, line] of lines.entries()) {
      const [level, ja, en, category, zone, source] = line.split("\t");
      const kind = category.match(/\[kind=(brand|shop)\]$/)?.[1];
      const row = { line: index + 2, level, ja, en, category: category.replace(/\s*\[kind=(?:brand|shop)\]$/, ""), kind, zone, source };
      totals.raw++;
      const floor = store && matchingFloor(store, row);
      if (!floor) {
        totals.gaps.push([row.line, row.level, row.ja]);
        continue;
      }
      if (!byFloor.has(floor)) byFloor.set(floor, []);
      byFloor.get(floor).push(row);
    }

    for (const floor of store?.floors ?? []) {
      const rows = byFloor.get(floor) ?? [];
      const counts = importFloor(rows, floor, totals);
      const hasFullList = rows.length > 0 && !partial[id]?.includes(floor.level);
      floor.tenant_coverage = hasFullList ? "complete" : floor.tenants.length ? "partial" : "unknown";
      totals.floors.push({ level: floor.level, label: floor.label.en, ...counts });
    }
  }
  writeFileSync(output, JSON.stringify(data, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
