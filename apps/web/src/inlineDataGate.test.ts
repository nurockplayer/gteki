import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSyntheticBundle } from "../../../packages/navigation/src/fixtures.ts";
import { declaredStationFiles, discoverStations, factsOnlyDataLines, inlineDataGateMode, undeclaredInlinedData, type DeclaredStationFiles } from "../stations-plugin.ts";

const folder = path.join(path.sep, "repo", "stations", "alpha");
const at = (rel: string) => path.join(folder, rel);
const alpha: DeclaredStationFiles = {
  dir: "alpha",
  folder,
  declared: new Set([at("scene/signage.json"), at("gteki/assets/b1.meta.json")]),
  escapes: new Map(),
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

  it("does not truncate a real path at # or ? and strips only a trailing Vite query", () => {
    expect(undeclaredInlinedData([at("scene/plan#2.json")], [alpha])).toEqual(["alpha: scene/plan#2.json"]);
    expect(undeclaredInlinedData([at("scene/what?.json")], [alpha])).toEqual(["alpha: scene/what?.json"]);
    expect(undeclaredInlinedData([at("scene/plan#2.json") + "?raw"], [alpha])).toEqual(["alpha: scene/plan#2.json"]);
    expect(undeclaredInlinedData([at("scene/signage.json") + "?v=1.2&inline", at("scene/signage.json") + "?worker&url"], [alpha])).toEqual([]);
    // ?raw svg and shader text are data too (declarable in dataFiles).
    expect(undeclaredInlinedData([at("scene/sign.svg") + "?raw", at("scene/fog.glsl") + "?raw"], [alpha])).toEqual(["alpha: scene/fog.glsl", "alpha: scene/sign.svg"]);
  });

  it("refuses a file reached through a symlink that resolves outside the station folder, even when declared", () => {
    const outside = path.join(path.sep, "repo", "private");
    const linked: DeclaredStationFiles = {
      ...alpha,
      declared: new Set([...alpha.declared, path.join(outside, "linked.json")]),
      escapes: new Map([[path.join(outside, "linked.json"), "scene/linked.json"], [path.join(outside, "dir"), "scene/dir"]]),
    };
    expect(undeclaredInlinedData([path.join(outside, "linked.json"), path.join(outside, "dir", "a.json") + "?raw", path.join(outside, "other.json"), path.join(outside, "dir", "a.ts")], [linked])).toEqual([
      "alpha: scene/dir (symlink resolving outside the station folder)",
      "alpha: scene/linked.json (symlink resolving outside the station folder)",
    ]);
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
  it("fails by default: both stations have declared their files, so undeclared data is a real error", () => {
    expect(inlineDataGateMode({})).toBe("error");
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "" })).toBe("error");
    // Only an explicit warn downgrades it, for local debugging; a typo must not silently pass a build.
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "warn" })).toBe("warn");
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "ERROR" })).toBe("error");
    expect(inlineDataGateMode({ GTEKI_INLINE_DATA_GATE: "off" })).toBe("error");
  });
});

describe("declaredStationFiles", () => {
  it("resolves assets (relative to gteki/) and dataFiles (relative to the station folder) to real paths", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-gate-")));
    const st = path.join(root, "alpha");
    fs.mkdirSync(path.join(st, "gteki", "assets"), { recursive: true });
    fs.mkdirSync(path.join(st, "scene"), { recursive: true });
    fs.writeFileSync(path.join(st, "gteki", "assets", "b1.glb"), "x");
    fs.writeFileSync(path.join(st, "gteki", "assets", "b1.mobile.glb"), "x");
    fs.writeFileSync(path.join(st, "gteki", "assets", "b.mobile.glb"), "x");
    fs.writeFileSync(path.join(st, "gteki", "assets", "b1.meta.json"), "{}");
    fs.writeFileSync(path.join(st, "scene", "signage.json"), "{}");
    fs.writeFileSync(path.join(st, "scene", "undeclared.json"), "{}");
    fs.writeFileSync(path.join(st, "gteki", "station.json"), JSON.stringify({
      assets: [{ uri: "assets/b1.glb", uriMobile: "assets/b1.mobile.glb", files: ["assets/b1.meta.json"] }],
      dataFiles: [{ id: "signage", path: "scene/signage.json", sourceIds: ["s"], modified: false }, { id: "gone", path: "scene/missing.json", sourceIds: ["s"], modified: false }],
    }));
    const [declared] = declaredStationFiles(discoverStations([root]));
    expect(declared!.folder).toBe(st);
    expect([...declared!.declared].sort()).toEqual([
      path.join(st, "gteki/assets/b1.glb"), path.join(st, "gteki/assets/b1.meta.json"), path.join(st, "gteki/assets/b1.mobile.glb"), path.join(st, "scene/signage.json"),
    ]);
    const mobilePath = path.join(st, "gteki/assets/b1.mobile.glb");
    expect(declared!.declared.has(fs.realpathSync(mobilePath))).toBe(true);
    expect(undeclaredInlinedData([mobilePath + "?url"], [declared!])).toEqual([]);
    expect(undeclaredInlinedData([path.join(st, "gteki/assets/b.mobile.glb") + "?url"], [declared!])).toEqual([
      "alpha: gteki/assets/b.mobile.glb",
    ]);
    const ids = [path.join(st, "scene/signage.json"), path.join(st, "scene/undeclared.json"), path.join(st, "gteki/assets/b1.meta.json")];
    expect(undeclaredInlinedData(ids, [declared!])).toEqual(["alpha: scene/undeclared.json"]);
  });
});

describe("symlink fence and facts-only audit on a real folder", () => {
  it("collects symlinks leaving the station folder and ignores internal ones", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-fence-")));
    const st = path.join(root, "alpha");
    fs.mkdirSync(path.join(st, "gteki"), { recursive: true });
    fs.mkdirSync(path.join(st, "scene"), { recursive: true });
    fs.mkdirSync(path.join(root, "shared", "tables"), { recursive: true });
    fs.writeFileSync(path.join(st, "gteki", "station.json"), "{}");
    fs.writeFileSync(path.join(st, "scene", "inside.json"), "{}");
    fs.writeFileSync(path.join(root, "shared", "out.json"), "{}");
    fs.symlinkSync("inside.json", path.join(st, "scene", "alias.json"));
    fs.symlinkSync("../../shared/out.json", path.join(st, "scene", "out.json"));
    fs.symlinkSync("../../shared/tables", path.join(st, "scene", "tables"));
    const [declared] = declaredStationFiles(discoverStations([root]));
    expect(Object.fromEntries(declared!.escapes)).toEqual({
      [path.join(root, "shared", "out.json")]: "scene/out.json",
      [path.join(root, "shared", "tables")]: "scene/tables",
    });
    expect(undeclaredInlinedData([path.join(root, "shared", "out.json"), path.join(root, "shared", "tables", "t.json")], [declared!])).toEqual([
      "alpha: scene/out.json (symlink resolving outside the station folder)",
      "alpha: scene/tables (symlink resolving outside the station folder)",
    ]);
  });

  it("prints one audit line per data file that cites facts-only sources", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-audit-")));
    const st = path.join(root, "alpha");
    fs.mkdirSync(path.join(st, "gteki"), { recursive: true });
    const b = createSyntheticBundle();
    const { nodes, edges, pois, ...rest } = b;
    const facts = { ...b.sources[0]!, id: "guide-2022", usage: "facts-only" as const };
    const manifest = {
      schema: rest.schema, station: rest.station, sources: [...rest.sources, facts], floors: rest.floors, coverage: rest.coverage,
      dataFiles: [
        { id: "plain", path: "scene/plain.json", sourceIds: ["fixture-geometry"], modified: false },
        { id: "signage", path: "scene/signage.json", sourceIds: ["fixture-geometry", "guide-2022"], modified: true, derivation: "d" },
      ],
    };
    fs.writeFileSync(path.join(st, "gteki", "station.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(st, "gteki", "graph.json"), JSON.stringify({ schema: b.schema, stationId: b.station.id, nodes, edges }));
    fs.writeFileSync(path.join(st, "gteki", "pois.json"), JSON.stringify({ schema: b.schema, stationId: b.station.id, pois }));
    expect(factsOnlyDataLines(discoverStations([root]))).toEqual(["[gteki] alpha scene/signage.json cites facts-only: guide-2022"]);
  });
});
