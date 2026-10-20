/// <reference types="vite/client" />

declare module "virtual:gteki-stations" {
  export interface DiscoveredStationModule {
    dir: string;
    manifest: () => Promise<unknown>;
    graph: () => Promise<unknown>;
    pois: () => Promise<unknown>;
    scene: (() => Promise<unknown>) | null;
    assets: Record<string, () => Promise<string>>;
  }
  export const stations: DiscoveredStationModule[];
}
