// Shared validation of GeoJSON `crs` members: only {type:"name"} with a plain string name counts.
// Linked (href), typed, malformed or absent declarations never yield a name.
export function geographicCrs(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const normalized = name.trim().toUpperCase();
  const codes = ['4326', '4612', '6668'];
  if (codes.some(code => normalized === `EPSG:${code}` || normalized === `HTTP://WWW.OPENGIS.NET/DEF/CRS/EPSG/0/${code}` || normalized === `URN:OGC:DEF:CRS:EPSG::${code}`)) return true;
  return ['OGC:CRS84', 'CRS84', 'HTTP://WWW.OPENGIS.NET/DEF/CRS/OGC/1.3/CRS84', 'URN:OGC:DEF:CRS:OGC:1.3:CRS84'].includes(normalized);
}

export function crsName(declaration: unknown): unknown {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration) || !Object.hasOwn(declaration, 'type') || (declaration as Record<string, unknown>).type !== 'name' || !Object.hasOwn(declaration, 'properties')) return null;
  const properties = (declaration as Record<string, unknown>).properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties) && !Object.hasOwn(properties, 'href') && !Object.hasOwn(properties, 'type') && Object.hasOwn(properties, 'name') && typeof (properties as Record<string, unknown>).name === 'string'
    ? (properties as Record<string, unknown>).name : null;
}
