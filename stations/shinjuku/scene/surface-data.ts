export interface SurfaceBuilding {
  id: string;
  rings: [number, number][][];
  height: number;
  /** Source orthometric base, retained as evidence; rendering is flattened to street z=0. */
  groundHeight: number;
  heightSource: "measuredHeight" | "lod1Solid";
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
}
