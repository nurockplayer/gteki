// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// Geometry only, from the already acquired, hash-pinned PLATEAU source. No appearances.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { surfaceEnu } from "./import-surface.ts";

const path = new URL("../data/department-stores.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../sources/surface-manifest.json", import.meta.url), "utf8"));
const raw = join(process.env.GTEKI_RAW_SHINJUKU ?? join(homedir(), "Developer/gteki-raw/shinjuku"), "plateau-bldg");
for (const file of manifest.files.filter((f: { kind: string }) => f.kind === "bldg")) {
  const bytes = readFileSync(join(raw, file.path));
  if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`PLATEAU hash mismatch: ${file.path}`);
  const xml = bytes.toString("utf8");
  for (const building of data.buildings) {
    const id = building.id.split(":")[0];
    const start = xml.indexOf(`gml:id="${id}"`);
    if (start < 0) continue; // Each source building belongs to exactly one of the four tiles.
    const feature = xml.slice(start, xml.indexOf("</bldg:Building>", start));
    building.sourceTile = file.path;
    building.surfaces = [];
    for (const match of feature.matchAll(/<bldg:(WallSurface|RoofSurface)\b[^>]*>([\s\S]*?)<\/bldg:\1>/g)) {
      for (const polygon of match[2]!.matchAll(/<gml:Polygon\b[^>]*>([\s\S]*?)<\/gml:Polygon>/g)) {
        const rings = [...polygon[1]!.matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)].map((r) => {
          const numbers = r[1]!.trim().split(/\s+/).map(Number);
          const ring = [];
          for (let i = 0; i < numbers.length; i += 3) {
            const p = surfaceEnu(numbers[i]!, numbers[i + 1]!, numbers[i + 2]!);
            ring.push([p.x, p.y, p.z - building.groundHeight].map(n => Math.round(n * 100) / 100));
          }
          return ring.slice(0, -1);
        });
        building.surfaces.push({ kind: match[1] === "RoofSurface" ? "roof" : "wall", rings });
      }
    }
    if (!building.surfaces.length) throw new Error(`Missing LOD2 surfaces: ${id}`);
  }
}
for (const building of data.buildings) if (!building.sourceTile) throw new Error(`Missing source building: ${building.id}`);
writeFileSync(path, JSON.stringify(data) + "\n");
console.log(`Imported ${data.buildings.length} LOD2 buildings for ${data.stores.length} stores (PLATEAU, 2026-11-22 JST)`);
