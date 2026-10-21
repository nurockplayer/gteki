import { describe, expect, it } from "vitest";
import { ASSET_SCHEME, BLOCKED_URL, fencedUrlResolver, joinStationPath, stationDir } from "./assetFence.ts";

describe("station asset fence for GLB dependencies", () => {
  const urls = new Map([
    ["assets/b1.glb", "/@fs/repo/stations/alpha/gteki/assets/b1.glb"],
    ["assets/b1.bin", "/@fs/repo/stations/alpha/gteki/assets/b1.bin"],
    ["assets/tex/floor.webp", "/@fs/repo/stations/alpha/gteki/assets/tex/floor.webp"],
  ]);

  it("resolves relative glTF URIs inside the station folder through the asset map", () => {
    const resolve = fencedUrlResolver(urls);
    const base = ASSET_SCHEME + stationDir("assets/b1.glb") + "/";
    expect(resolve(base + "b1.bin")).toBe(urls.get("assets/b1.bin"));
    expect(resolve(base + "./tex/floor.webp")).toBe(urls.get("assets/tex/floor.webp"));
    expect(resolve(base + "tex/../b1.bin")).toBe(urls.get("assets/b1.bin"));
    expect(resolve(urls.get("assets/b1.glb")!)).toBe(urls.get("assets/b1.glb"));
    expect(resolve("data:application/octet-stream;base64,AA==")).toMatch(/^data:/);
    expect(resolve("blob:http://localhost/123")).toBe("blob:http://localhost/123");
  });

  it("refuses escapes to other stations, absolute paths, remote URLs and unknown files", () => {
    const refused: string[] = [];
    const resolve = fencedUrlResolver(urls, refused);
    const base = ASSET_SCHEME + "assets/";
    for (const u of [
      base + "../../../beta/gteki/assets/outside.bin",
      base + "%2e%2e/%2e%2e/%2e%2e/beta/x.bin",
      base + "missing.bin",
      "/@fs/repo/stations/beta/gteki/assets/outside.bin",
      "https://example.com/x.bin",
      ASSET_SCHEME + "/etc/passwd",
    ]) expect(resolve(u), u).toBe(BLOCKED_URL);
    expect(refused).toHaveLength(6);
  });

  it("normalises paths without climbing above the station folder", () => {
    expect(joinStationPath("assets", "a/../b.bin")).toBe("assets/b.bin");
    expect(joinStationPath("", "../x")).toBeNull();
    expect(joinStationPath("assets", "https://x/y")).toBeNull();
    expect(joinStationPath("assets", "..\\x")).toBeNull();
  });
});
