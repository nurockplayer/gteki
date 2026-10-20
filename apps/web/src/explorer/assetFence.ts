/**
 * Every URL a station scene's loaders request — the GLB itself and any external buffer/image it
 * references — must resolve through that station's fenced asset map. Anything else is refused.
 */

/** Pseudo-scheme used as GLTFLoader's resourcePath so relative glTF URIs stay station-relative. */
export const ASSET_SCHEME = "gteki-asset:/";
/** Returned for refused URLs: loading fails, so the scene falls back to L0 instead of fetching it. */
export const BLOCKED_URL = "data:application/x-gteki-blocked,";

/** Join a station-relative base directory with a glTF URI; null if it climbs out of the station folder. */
export function joinStationPath(baseDir: string, uri: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(uri); } catch { return null; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("/") || decoded.includes("\\")) return null;
  const out: string[] = [];
  for (const part of `${baseDir}/${decoded}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (out.length === 0) return null; out.pop(); continue; }
    out.push(part);
  }
  return out.join("/");
}

export function stationDir(uri: string): string {
  const i = uri.lastIndexOf("/");
  return i < 0 ? "" : uri.slice(0, i);
}

/** URL modifier for a THREE.LoadingManager. `refused` collects blocked requests for diagnostics. */
export function fencedUrlResolver(assetUrls: ReadonlyMap<string, string>, refused: string[] = []): (url: string) => string {
  const allowed = new Set(assetUrls.values());
  return (url) => {
    // Inline data, and blob URLs GLTFLoader creates for images embedded in the GLB itself.
    if (url.startsWith("data:") || url.startsWith("blob:") || allowed.has(url)) return url;
    if (url.startsWith(ASSET_SCHEME)) {
      const rel = joinStationPath("", url.slice(ASSET_SCHEME.length));
      const hit = rel === null ? undefined : assetUrls.get(rel);
      if (hit) return hit;
    }
    refused.push(url);
    return BLOCKED_URL;
  };
}
