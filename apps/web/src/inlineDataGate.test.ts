import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { declaredStationFiles, discoverStations, inlineDataGateMode, undeclaredInlinedData, type DeclaredStationFiles } from "../stations-plugin.ts";

const folder = path.join(path.sep, "repo", "stations", "alpha");
const at = (rel: string) => path.join(folder, rel);
const alpha: DeclaredStationFiles = {
  dir: "alpha",
  folder,
  declared: new Set([at("scene/signage.json"), at("gteki/assets/b1.meta.json")]),
};

describe("undeclaredInlinedData", () => {
  it("passes a declared inline and refuses an undeclared one", () => {
    expect(undeclaredInlinedData([at("scene/signage.json")], [alpha])).toEqual([]);
    expect(undeclaredInlinedData([at("scene/crowd_lanes.json"), at("data/plan.csv"), at("data/blob.bin")], [alpha])).toEqual([
      "alpha: data/blob.bin", "alpha: data/plan.csv", "alpha: scene/crowd_lanes.json",
    ]);
  });

  it("ignores a ?query on the id, so a declared file stays declared", () => {
    expect(undeclaredInlinedData([at("scene/signage.json") + "?raw"], [alpha])).toEqual([]);
    expect(undeclaredInlinedData([at("scene/other.json") + "?raw"], [alpha])).toEqual(["alpha: scene/other.json"]);
  });

  it("passes code and stylesheets", () => {
    expect(undeclaredInlinedData([at("scene/scene.ts"), at("gteki/scene.js"), at("scene/a.mjs"), at("scene/a.css"), at("scene/a.d.ts")], [alpha])).toEqual([]);
  });

  it("passes the contract files the loader reads", () => {
    expect(undeclaredInlinedData(["station.json", "graph.json", "pois.json"].map((f) => at(`gteki/${f}`)), [alpha])).toEqual([]);
    // A same-named file elsewhere is not the contract file.
    expect(undeclaredInlinedData([at("scene/graph.json")], [alpha])).toEqual(["alpha: scene/graph.json"]);
  });

  it("ignores files outside station folders, virtual ids and node_modules", () => {
    expect(undeclaredInlinedData([
      path.join(path.sep, "repo", "apps", "web", "src", "data.json"),
      path.join(path.sep, "repo", "stations", "alpha-other", "x.json"),
      "\0virtual:gteki-stations",
      at("node_modules/pkg/package.json"),
    ], [alpha])).toEqual([]);
  });
});

describe("inlineDataGateMode", () => {
  it("warns by default and fails only when set to error", () => {
    expect(inlineDataGateMode({})).toBe("warn");
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "warn" })).toBe("warn");
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "error" })).toBe("error");
  });
});

describe("declaredStationFiles", () => {
  it("resolves assets (relative to gteki/) and dataFiles (relative to the station folder) to real paths", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-gate-")));
    const st = path.join(root, "alpha");
    fs.mkdirSync(path.join(st, "gteki", "assets"), { recursive: true });
    fs.mkdirSync(path.join(st, "scene"), { recursive: true });
    fs.writeFileSync(path.join(st, "gteki", "assets", "b1.glb"), "x");
    fs.writeFileSync(path.join(st, "gteki", "assets", "b1.meta.json"), "{}");
    fs.writeFileSync(path.join(st, "scene", "signage.json"), "{}");
    fs.writeFileSync(path.join(st, "scene", "undeclared.json"), "{}");
    fs.writeFileSync(path.join(st, "gteki", "station.json"), JSON.stringify({
      assets: [{ uri: "assets/b1.glb", files: ["assets/b1.meta.json"] }],
      dataFiles: [{ id: "signage", path: "scene/signage.json", sourceIds: ["s"] }, { id: "gone", path: "scene/missing.json", sourceIds: ["s"] }],
    }));
    const [declared] = declaredStationFiles(discoverStations([root]));
    expect(declared!.folder).toBe(st);
    expect([...declared!.declared].sort()).toEqual([
      path.join(st, "gteki/assets/b1.glb"), path.join(st, "gteki/assets/b1.meta.json"), path.join(st, "scene/signage.json"),
    ]);
    const ids = [path.join(st, "scene/signage.json"), path.join(st, "scene/undeclared.json"), path.join(st, "gteki/assets/b1.meta.json")];
    expect(undeclaredInlinedData(ids, [declared!])).toEqual(["alpha: scene/undeclared.json"]);
  });
});
