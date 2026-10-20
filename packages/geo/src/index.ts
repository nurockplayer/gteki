/**
 * Coordinate frames.
 *
 * Source:   JGD2011 geographic lat/lon (EPSG:6668 / 6697) on the GRS80 ellipsoid.
 * Station:  local ENU tangent plane at `origin` — x east, y north, z up, metres.
 * Renderer: Three.js Y-up right-handed — X = east, Y = up, Z = -north.
 *
 * The ENU conversion is exact (geodetic → ECEF → ENU), not an equirectangular
 * approximation, so roundtrip error stays sub-millimetre at station scale.
 * Heights: when a source has no height, pass h = 0 for the horizontal transform
 * and keep the node's z as null — never treat the 0 as a real elevation.
 */

const A = 6378137.0; // GRS80 semi-major axis
const F = 1 / 298.257222101; // GRS80 flattening
const E2 = F * (2 - F);

export interface Geodetic {
  lat: number;
  lon: number;
  h: number;
}

export interface Enu {
  x: number;
  y: number;
  z: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function geodeticToEcef({ lat, lon, h }: Geodetic): [number, number, number] {
  const p = rad(lat);
  const l = rad(lon);
  const sp = Math.sin(p);
  const n = A / Math.sqrt(1 - E2 * sp * sp);
  return [(n + h) * Math.cos(p) * Math.cos(l), (n + h) * Math.cos(p) * Math.sin(l), (n * (1 - E2) + h) * sp];
}

export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * s * s);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return { lat: deg(lat), lon: deg(lon), h };
}

export class EnuFrame {
  private readonly o: [number, number, number];
  private readonly sl: number;
  private readonly cl: number;
  private readonly sp: number;
  private readonly cp: number;

  constructor(readonly origin: Geodetic) {
    this.o = geodeticToEcef(origin);
    this.sp = Math.sin(rad(origin.lat));
    this.cp = Math.cos(rad(origin.lat));
    this.sl = Math.sin(rad(origin.lon));
    this.cl = Math.cos(rad(origin.lon));
  }

  toEnu(g: Geodetic): Enu {
    const [x, y, z] = geodeticToEcef(g);
    const dx = x - this.o[0];
    const dy = y - this.o[1];
    const dz = z - this.o[2];
    return {
      x: -this.sl * dx + this.cl * dy,
      y: -this.sp * this.cl * dx - this.sp * this.sl * dy + this.cp * dz,
      z: this.cp * this.cl * dx + this.cp * this.sl * dy + this.sp * dz,
    };
  }

  toGeodetic(e: Enu): Geodetic {
    const dx = -this.sl * e.x - this.sp * this.cl * e.y + this.cp * this.cl * e.z;
    const dy = this.cl * e.x - this.sp * this.sl * e.y + this.cp * this.sl * e.z;
    const dz = this.cp * e.y + this.sp * e.z;
    return ecefToGeodetic(this.o[0] + dx, this.o[1] + dy, this.o[2] + dz);
  }
}

/** The one shared ENU → Three.js mapping. */
export function enuToThree(e: { x: number; y: number; z: number }): [number, number, number] {
  return [e.x, e.z, -e.y];
}

export function threeToEnu(t: [number, number, number]): Enu {
  return { x: t[0], y: -t[2], z: t[1] };
}

/** Horizontal distance in metres between two station-frame points. */
export function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
