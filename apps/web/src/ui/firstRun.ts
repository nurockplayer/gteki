import type { Poi } from "@gteki/schema";

export const FIRST_RUN_KEY = "gteki.firstRunDone";

/** Storage null/throwing → show; dismissing with unavailable storage lasts only for this session. */
export function shouldShowFirstRun(storage: Pick<Storage, "getItem"> | null): boolean {
  if (!storage) return true;
  try { return storage.getItem(FIRST_RUN_KEY) !== "1"; } catch { return true; }
}

export function markFirstRunDone(storage: Pick<Storage, "setItem"> | null): void {
  try { storage?.setItem(FIRST_RUN_KEY, "1"); } catch { /* unavailable storage lasts for this session */ }
}

/** Verified demo pairs per station key. Both POIs must be routable. */
export const DEMO_PAIRS: Record<string, { from: string; to: string }> = {
  ikebukuro: { from: "jr-central-gate-1", to: "shop-ikb-lumine" },
  shinjuku: { from: "poi:gate:1", to: "poi:platform:oedo" },
};

/** The pair's POIs from this bundle, or null if either POI is missing or non-routable. */
export function demoPair(stationKey: string, pois: readonly Poi[]): { from: Poi; to: Poi } | null {
  const pair = DEMO_PAIRS[stationKey];
  if (!pair) return null;
  const from = pois.find((poi) => poi.id === pair.from);
  const to = pois.find((poi) => poi.id === pair.to);
  if (!from || !to || from.connectorNodeIds.length === 0 || to.connectorNodeIds.length === 0) return null;
  return { from, to };
}
