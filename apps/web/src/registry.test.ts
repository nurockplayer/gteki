import { describe, expect, it, vi } from "vitest";

// Two discovered stations: one whose manifest import rejects, one with a malformed names shape.
vi.mock("virtual:gteki-stations", () => ({
  stations: [
    { dir: "broken-import", manifest: () => Promise.reject(new Error("boom")), graph: async () => ({}), pois: async () => ({}), assets: {} },
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
    expect(entries.map((e) => e.key)).toEqual(["broken-import", "bad-names", "_synthetic-demo"]);
    await expect(entries[0]!.load()).rejects.toThrow(/station.json could not be read: boom/);
    await expect(entries[1]!.load()).rejects.toThrow(/failed validation/);
    await expect(entries[2]!.load()).resolves.toMatchObject({ key: "_synthetic-demo" });
  });
});
