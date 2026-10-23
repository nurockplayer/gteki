export interface SurfaceBuilding {
  id: string;
  rings: [number, number][][];
  height: number;
  /** Source orthometric base, retained as evidence; rendering is flattened to street z=0. */
  groundHeight: number;
  heightSource: "measuredHeight" | "lod1Solid";
  /** PLATEAU bldg:usage code; null where the source omits the value. */
  usage: string | null;
  /** PLATEAU bldg:storeysAboveGround; null when absent or the source uses its unknown sentinel. */
  storeys: number | null;
}
export interface SurfaceRoad {
  id: string;
  rings: [number, number][][];
}
export interface SurfaceData {
  version: number;
  origin: { lat: number; lon: number; h: number };
  attribution: string;
  license: string;
  source: string;
  note: string;
  heightNote: string;
  buildings: SurfaceBuilding[];
  roads: SurfaceRoad[];
}
