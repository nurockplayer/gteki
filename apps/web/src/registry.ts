import { parseStationFiles, type StationIdentity, type StationBundle, type ValidationIssue } from "@gteki/schema";
import type { StationSceneModule } from "@gteki/scene-api";
import { stations as discovered } from "virtual:gteki-stations";
import { identityNamesOf } from "./ui/identityCard.ts";
import { createDemoFiles } from "./demo.ts";

/** A station the explorer can open. Everything station-specific comes from its files. */
export interface StationEntry {
  key: string;
  label: string;
  synthetic: boolean;
  identity?: StationIdentity;
  load(): Promise<LoadedStation>;
}

export interface LoadedStation {
  key: string;
  bundle: StationBundle;
  issues: ValidationIssue[];
  scene: StationSceneModule | null;
  /** Why the optional scene module could not be imported; routing data is still usable (L0 view). */
  sceneImportError: string | null;
  assetUrls: Map<string, string>;
}

export class StationLoadError extends Error {
  constructor(readonly key: string, readonly issues: ValidationIssue[]) {
    super(`Station ${key} failed validation (${issues.filter((i) => i.level === "error").length} errors)`);
  }
}

/** Label a manifest before it is validated: any shape is tolerated here, since parsing comes later. */
export function nameOf(manifest: unknown, fallback: string): { label: string; synthetic: boolean } {
  const station = (manifest as { station?: unknown } | null)?.station as { names?: unknown; synthetic?: unknown } | undefined;
  const names = Array.isArray(station?.names) ? (station.names as unknown[]) : [];
  const text = (lang: string) => {
    const hit = names.find((n): n is { lang: string; text: string } =>
      typeof n === "object" && n !== null && (n as { lang?: unknown }).lang === lang && typeof (n as { text?: unknown }).text === "string");
    return hit?.text;
  };
  const ja = text("ja");
  const en = text("en");
  return { label: ja && en ? `${ja} · ${en}` : ja ?? en ?? fallback, synthetic: station?.synthetic === true };
}

function isSceneModule(m: unknown): m is StationSceneModule {
  return typeof (m as { buildScene?: unknown })?.buildScene === "function";
}

export async function listStations(): Promise<StationEntry[]> {
  const entries: StationEntry[] = [];
  for (const s of discovered) {
    // One unreadable station is listed but refused on load; it never takes the explorer down.
    let manifest: unknown;
    try {
      manifest = await s.manifest();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entries.push({ key: s.dir, label: `⚠ ${s.dir}`, synthetic: false, load: () => Promise.reject(new Error(`station.json could not be read: ${message}`)) });
      continue;
    }
    const { label, synthetic } = nameOf(manifest, s.dir);
    entries.push({
      key: s.dir,
      label,
      synthetic,
      identity: identityNamesOf(manifest),
      async load() {
        // The scene module is optional presentation: its failure must never block valid routing data.
        let sceneImportError: string | null = null;
        const scenePromise = s.scene
          ? s.scene().catch((err: unknown) => { sceneImportError = err instanceof Error ? err.message : String(err); return null; })
          : Promise.resolve(null);
        // `tenants` is optional (#419): undefined = the station ships no brand directory. A file whose content is
        // null or not an object is passed through and refused by `parseStationFiles`, never read as absent.
        const [graph, pois, tenants, sceneModule] = await Promise.all([
          s.graph(), s.pois(), s.tenants ? s.tenants() : Promise.resolve(undefined), scenePromise,
        ]);
        const parsed = parseStationFiles(manifest, graph, pois, tenants);
        if (!parsed.ok) throw new StationLoadError(s.dir, parsed.issues);
        if (sceneModule !== null && !isSceneModule(sceneModule)) sceneImportError = "scene module does not export buildScene(ctx)";
        const assetUrls = new Map<string, string>();
        await Promise.all(Object.entries(s.assets).map(async ([uri, url]) => assetUrls.set(uri, await url())));
        return { key: s.dir, bundle: parsed.bundle, issues: parsed.issues, scene: isSceneModule(sceneModule) ? sceneModule : null, sceneImportError, assetUrls };
      },
    });
  }
  // The core's own synthetic demo — clearly labelled; never a real station.
  entries.push({
    key: "_synthetic-demo",
    label: "Synthetic demo (not a real station)",
    synthetic: true,
    async load() {
      const [m, g, p] = createDemoFiles();
      const parsed = parseStationFiles(m, g, p);
      if (!parsed.ok) throw new StationLoadError("_synthetic-demo", parsed.issues);
      return { key: "_synthetic-demo", bundle: parsed.bundle, issues: parsed.issues, scene: null, sceneImportError: null, assetUrls: new Map() };
    },
  });
  return entries;
}
