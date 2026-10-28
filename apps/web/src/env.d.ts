/// <reference types="vite/client" />

declare module "virtual:gteki-stations" {
  export interface DiscoveredStationModule {
    dir: string;
    manifest: () => Promise<unknown>;
    graph: () => Promise<unknown>;
    pois: () => Promise<unknown>;
    /** The optional gteki/tenants.json (store brand directory, #419); null when the station has none. */
    tenants?: (() => Promise<unknown>) | null;
    scene: (() => Promise<unknown>) | null;
    assets: Record<string, () => Promise<string>>;
  }
  export const stations: DiscoveredStationModule[];
  export const privateBuild: boolean;
}
