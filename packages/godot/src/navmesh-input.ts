/** Public station data or a temporary, read-only copy of the private overlay inputs. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStationFiles, type StationBundle } from "@gteki/schema";

export async function navmeshBundle(station: string): Promise<{ bundle: StationBundle; privateBuild: boolean }> {
  if (station !== "ikebukuro" && station !== "shinjuku") throw new Error("station must be ikebukuro or shinjuku");
  const privateDir = process.env.GTEKI_PRIVATE_DIR;
  let tmp: string | undefined;
  try {
    let dir = path.join(process.cwd(), "stations", station, "gteki");
    if (privateDir) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-navmesh-"));
      fs.cpSync(path.join(privateDir, "additions"), path.join(tmp, "additions"), { recursive: true });
      const overlayModule = new URL("../../../tools/private-overlay/build-overlay.ts", import.meta.url).href;
      const { buildOverlay } = await import(overlayModule) as { buildOverlay: (o: { repoRoot: string; privateDir: string; stations: string[] }) => string[] };
      const built = buildOverlay({ repoRoot: process.cwd(), privateDir: tmp, stations: [station] });
      if (!built.includes(station)) throw new Error(`no private overlay for ${station}`);
      dir = path.join(tmp, "overlay", station, "gteki");
    }
    const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const tenantFile = path.join(dir, "tenants.json");
    const result = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), fs.existsSync(tenantFile) ? read("tenants.json") : undefined, { privateTier: !!privateDir });
    if (!result.ok) throw new Error(`${station}: bundle validation failed`);
    return { bundle: result.bundle, privateBuild: !!privateDir };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}
