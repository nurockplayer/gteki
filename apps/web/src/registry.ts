import { parseStationFiles, type StationBundle, type ValidationIssue } from "@gteki/schema";
import type { StationSceneModule } from "@gteki/scene-api";
import { stations as discovered } from "virtual:gteki-stations";
import { createDemoFiles } from "./demo.ts";

/** A station the explorer can open. Everything station-specific comes from its files. */
export interface StationEntry {
  key: string;
  label: string;
  synthetic: boolean;
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

function nameOf(manifest: unknown, fallback: string): { label: string; synthetic: boolean } {
  const station = (manifest as { station?: { names?: { lang: string; text: string }[]; synthetic?: boolean } })?.station;
  const ja = station?.names?.find((n) => n.lang === "ja")?.text;
  const en = station?.names?.find((n) => n.lang === "en")?.text;
  return { label: ja && en ? `${ja} · ${en}` : ja ?? en ?? fallback, synthetic: station?.synthetic === true };
}

function isSceneModule(m: unknown): m is StationSceneModule {
  return typeof (m as { buildScene?: unknown })?.buildScene === "function";
}

export async function listStations(): Promise<StationEntry[]> {
  const entries: StationEntry[] = [];
  for (const s of discovered) {
    const manifest = await s.manifest();
    const { label, synthetic } = nameOf(manifest, s.dir);
    entries.push({
      key: s.dir,
      label,
      synthetic,
      async load() {
        // The scene module is optional presentation: its failure must never block valid routing data.
        let sceneImportError: string | null = null;
        const scenePromise = s.scene
          ? s.scene().catch((err: unknown) => { sceneImportError = err instanceof Error ? err.message : String(err); return null; })
          : Promise.resolve(null);
        const [graph, pois, sceneModule] = await Promise.all([s.graph(), s.pois(), scenePromise]);
        const parsed = parseStationFiles(manifest, graph, pois);
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
