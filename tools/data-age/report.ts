// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StationBundle } from "../../packages/schema/src/index.ts";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";

export interface AgeRow {
  station: string;
  poiId: string;
  name: string;
  hoursDate: string;
  tenantsDate: string;
  entranceDate: string;
  oldestDate: string | null;
  ageDays: number | null;
}

const dayMs = 86_400_000;
const oldest = (dates: string[]) => dates.sort()[0] ?? null;

export function ageRows(bundles: StationBundle[], now = new Date()): AgeRow[] {
  // Compare calendar dates, rather than elapsed hours, at the JST day boundary.
  const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const rows: { row: AgeRow; missing: boolean }[] = [];
  for (const bundle of bundles) {
    const sources = new Map(bundle.sources.map((source) => [source.id, source.retrievedAt]));
    const sourceDate = (ids: string[]): string | null => {
      const dates = ids.map((id) => sources.get(id)?.slice(0, 10));
      return dates.length && dates.every((date) => !!date) ? oldest(dates as string[]) : null;
    };
    for (const poi of bundle.pois.filter((poi) => poi.category === "shop")) {
      const tenants = (bundle.tenants ?? []).filter((tenant) => tenant.poiId === poi.id);
      // A building's printed hours apply only to an exactly named building POI.
      const buildingDates = (bundle.buildingHours ?? [])
        .filter((hours) => hours.building.some((name) => name.lang === "ja"
          && poi.names.some((candidate) => candidate.lang === "ja" && candidate.text === name.text)))
        .map((hours) => hours.retrievedAt);
      const hoursDate = poi.hours?.retrievedAt ?? oldest(buildingDates);
      const tenantsDate = sourceDate(tenants.flatMap((tenant) => tenant.evidence.sourceIds));
      // Same verified-point conditions as merchantPrecision; ties and map-read doors are unverified.
      const verifiedDoor = poi.displayPosition !== null && poi.connectorNodeIds.length > 0
        && !/\b(STATION_TIE|P_MAP_DOOR|SEARCH_ONLY|AREA_ONLY)\b/.test(poi.evidence.method);
      const entranceDate = verifiedDoor ? sourceDate(poi.evidence.sourceIds) : null;
      const oldestDate = oldest([hoursDate, tenantsDate, entranceDate].filter((date): date is string => !!date));
      rows.push({
        missing: !hoursDate || !entranceDate || (tenants.length > 0 && !tenantsDate),
        row: {
          station: bundle.station.id,
          poiId: poi.id,
          name: poi.names.find((name) => name.lang === "ja")?.text ?? poi.id,
          hoursDate: hoursDate ?? "—",
          tenantsDate: tenantsDate ?? "—",
          entranceDate: entranceDate ?? "未確認",
          oldestDate,
          ageDays: oldestDate ? Math.round((Date.parse(today) - Date.parse(oldestDate)) / dayMs) : null,
        },
      });
    }
  }
  return rows.sort((a, b) => Number(b.missing) - Number(a.missing)
    || (a.row.oldestDate ?? "").localeCompare(b.row.oldestDate ?? "")
    || a.row.station.localeCompare(b.row.station) || a.row.poiId.localeCompare(b.row.poiId))
    .map(({ row }) => row);
}

export function markdown(rows: AgeRow[]): string {
  const lines = [
    "| station | poi id | name (ja) | hours date | tenants date | entrance date | oldest date | age (days, JST) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const cells = [row.station, row.poiId, row.name, row.hoursDate, row.tenantsDate,
      row.entranceDate, row.oldestDate ?? "—", row.ageDays ?? "—"];
    lines.push(`| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")).join(" | ")} |`);
  }
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0); // A reader such as head has enough rows.
    throw error;
  });
  const stationsDir = fileURLToPath(new URL("../../stations/", import.meta.url));
  const bundles: StationBundle[] = [];
  for (const entry of readdirSync(stationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(stationsDir, entry.name, "gteki");
    if (!existsSync(resolve(dir, "station.json"))) continue;
    const read = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8"));
    const parsed = parseStationFiles(read("station"), read("graph"), read("pois"),
      existsSync(resolve(dir, "tenants.json")) ? read("tenants") : undefined);
    if (!parsed.ok) throw new Error(`${entry.name}: ${JSON.stringify(parsed.issues)}`);
    bundles.push(parsed.bundle);
  }
  const rows = ageRows(bundles);
  console.log(process.argv.includes("--json") ? JSON.stringify(rows, null, 2) : markdown(rows));
}
