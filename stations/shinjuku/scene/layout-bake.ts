import type { StationBundle } from "@gteki/schema";
import type { Layout, Plan } from "./layout.ts";
import type { FareProtection } from "./fare-fence.ts";
import restricted from "./fare-restricted.generated.json" with { type: "json" };
import { contentKey } from "./content-key.ts";
import { decodeLayoutSnapshot } from "./layout-codec.ts";
import source from "../data/layout-bake-key.json" with { type: "json" };

export type LayoutSnapshot = { layout: Layout; protection: FareProtection };
export interface LayoutBake { inputKey: string; sourceKey: string; verified: boolean; snapshot: string }

export function layoutInputKey(bundle: StationBundle, plan: Plan, pitchedCeilings = true): string {
  return contentKey("layout-bake-v1", bundle, plan, pitchedCeilings, restricted);
}

/** Header keys are checked before the large snapshot string is decoded. Neither text nor decoded data is retained here. */
export function readLayoutBake(text: string | null | undefined, inputKey: string, verify: boolean): LayoutSnapshot | null {
  if (!text) return null;
  try {
    const baked = JSON.parse(text) as LayoutBake;
    if (baked.inputKey !== inputKey || baked.sourceKey !== source.sourceKey || (verify && !baked.verified)) return null;
    return decodeLayoutSnapshot<LayoutSnapshot>(baked.snapshot);
  } catch { return null; }
}

/** Fetch a committed gzip asset, as for the explorer's precompressed GLBs. Start alongside the kit loads. */
export async function fetchLayoutBake(): Promise<string | null> {
  try {
    const response = await fetch(new URL("../data/layout-baked.bin", import.meta.url));
    if (!response.ok || !response.body) return null;
    const body = response.headers.get("Content-Encoding") === "gzip"
      ? response.body : response.body.pipeThrough(new DecompressionStream("gzip"));
    return await new Response(body).text();
  } catch { return null; }
}
