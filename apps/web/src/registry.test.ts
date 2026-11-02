import { describe, expect, it, vi } from "vitest";

const { scene, asset } = vi.hoisted(() => ({ scene: vi.fn(), asset: vi.fn() }));

// Real directory data alongside an unreadable station and a malformed manifest.
vi.mock("virtual:gteki-stations", async () => ({
  privateBuild: false,
  stations: [
    { dir: "broken-import", manifest: () => Promise.reject(new Error("boom")), graph: async () => ({}), pois: async () => ({}), assets: {} },
    {
      dir: "ikebukuro",
      manifest: async () => (await import("../../../stations/ikebukuro/gteki/station.json")).default,
      graph: async () => (await import("../../../stations/ikebukuro/gteki/graph.json")).default,
      pois: async () => (await import("../../../stations/ikebukuro/gteki/pois.json")).default,
      tenants: async () => (await import("../../../stations/ikebukuro/gteki/tenants.json")).default,
      scene, assets: { "asset.glb": asset },
    },
    { dir: "bad-names", manifest: async () => ({ station: { names: "not-an-array" } }), graph: async () => ({}), pois: async () => ({}), assets: {} },
  ],
}));

const { listStations, nameOf } = await import("./registry.ts");

describe("station listing survives malformed stations (PR #15 Codex review 7)", () => {
  it("labels any manifest shape without throwing", () => {
    expect(nameOf({ station: { names: "x" } }, "dir")).toEqual({ label: "dir", synthetic: false });
    expect(nameOf(null, "dir").label).toBe("dir");
    expect(nameOf({ station: { names: [null, 3, { lang: "ja", text: "池袋" }, { lang: "en", text: "Ikebukuro" }] } }, "d").label).toBe("池袋 · Ikebukuro");
  });

  it("lists every station plus the synthetic demo, refusing broken ones only on load", async () => {
    const entries = await listStations();
    expect(entries.map((e) => e.key)).toEqual(["broken-import", "ikebukuro", "bad-names", "_synthetic-demo"]);
    await expect(entries[0]!.load()).rejects.toThrow(/station.json could not be read: boom/);
    await expect(entries[2]!.load()).rejects.toThrow(/failed validation/);
    await expect(entries[3]!.load()).resolves.toMatchObject({ key: "_synthetic-demo" });
  });
});

describe("directory-only loading", () => {
  it("passes the real tenants through without importing scenes or assets", async () => {
    const entries = await listStations();
    const bundle = await entries[1]!.loadDirectory();
    const tenants = (await import("../../../stations/ikebukuro/gteki/tenants.json")).default.tenants;
    expect(bundle.tenants).toEqual(tenants);
    expect(bundle.nodes.length).toBeGreaterThan(0);
    expect(bundle.pois.length).toBeGreaterThan(0);
    expect(scene).not.toHaveBeenCalled();
    expect(asset).not.toHaveBeenCalled();
  });

  it("rejects unreadable and invalid stations and returns the demo's own bundle", async () => {
    const entries = await listStations();
    await expect(entries[0]!.loadDirectory()).rejects.toThrow(/station.json could not be read: boom/);
    await expect(entries[2]!.loadDirectory()).rejects.toThrow(/failed validation/);
    expect(await entries[3]!.loadDirectory()).toEqual((await entries[3]!.load()).bundle);
  });
});
