// Regenerates test/fixtures/station-enu-vectors.json from packages/geo's own StationFrame (the reference
// implementation of docs/core/contract.md "Frames"). Read-only use of packages/geo; run from tools/gis:
//   pnpm exec tsx scripts/make-station-enu-vectors.mts > test/fixtures/station-enu-vectors.json
// Points are placed at exact horizontal distances (0, 250, 435 m) and bearings by inverting StationFrame.toLocal
// (StationFrame.toGeodetic), then the expected x/y/z come from StationFrame.toLocal on the stored lat/lon/h.
import { StationFrame } from '../../../packages/geo/src/index.ts';

const origins = [
  { id: 'ikebukuro', note: 'stations/ikebukuro/gteki/station.json origin (hM 0, EPSG:6697)', lat: 35.7297, lon: 139.7114, hM: 0 },
  { id: 'synthetic-hM5', note: 'SYNTHETIC non-zero hM to pin z = h - hM and the height-independent horizontal part; Shinjuku coordinates, hM invented for the test only', lat: 35.687, lon: 139.6994, hM: 5 },
];
const placements: Array<[number, number, number]> = [
  [0, 0, 32.5], [250, 0, 31.9], [250, 90, 33.1], [250, 225, 27.9], [435, 45, 45.12], [435, 180, 0], [435, 300, -18.25],
];
const out = origins.map((o) => {
  const frame = new StationFrame({ lat: o.lat, lon: o.lon, h: o.hM });
  const points = placements.map(([distance, bearing, z]) => {
    const east = distance * Math.sin((bearing * Math.PI) / 180), north = distance * Math.cos((bearing * Math.PI) / 180);
    const g = frame.toGeodetic({ x: east, y: north, z: z - o.hM });
    const local = frame.toLocal(g);
    return { distance_m: distance, bearing_deg: bearing, lat: g.lat, lon: g.lon, h: g.h, expected: { x: local.x, y: local.y, z: local.z } };
  });
  return { id: o.id, note: o.note, origin: { lat: o.lat, lon: o.lon, hM: o.hM }, points };
});
console.log(JSON.stringify({
  produced_by: 'tools/gis/scripts/make-station-enu-vectors.mts running packages/geo/src/index.ts StationFrame.toLocal via tsx (commit e244d20); expected x/y/z are that code\'s outputs for the stored lat/lon/h',
  tolerance_m: 0.001,
  origins: out,
}, null, 2));
