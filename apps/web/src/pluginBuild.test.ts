import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { gtekiStations } from "../stations-plugin.ts";
import { createDemoFiles } from "./demo.ts";

/**
 * Real production builds of a throwaway app + station, so the publication allowlist is checked
 * against what Vite actually emits (scene imports, symlinks), not only the generated loader code.
 */
function project(scene: string, extraFiles: string[] = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-build-")));
  const app = path.join(root, "app");
  const station = path.join(root, "stations", "alpha");
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(path.join(station, "gteki", "assets"), { recursive: true });
  fs.mkdirSync(path.join(station, "private"), { recursive: true });
  fs.writeFileSync(path.join(app, "index.html"), `<script type="module" src="./main.js"></script>`);
  fs.writeFileSync(path.join(app, "main.js"), `import { stations } from "virtual:gteki-stations";
for (const s of stations) { s.scene?.(); for (const load of Object.values(s.assets)) load(); }`);
  const [m, g, p] = createDemoFiles();
  m.assets = [{ id: "b1", uri: "assets/b1.glb", format: "glb", floorIds: [], role: "visual", sourceIds: ["demo-synthetic"], files: extraFiles }];
  fs.writeFileSync(path.join(station, "gteki", "station.json"), JSON.stringify(m));
  fs.writeFileSync(path.join(station, "gteki", "graph.json"), JSON.stringify(g));
  fs.writeFileSync(path.join(station, "gteki", "pois.json"), JSON.stringify(p));
  fs.writeFileSync(path.join(station, "gteki", "assets", "b1.glb"), "glTF-declared");
  fs.writeFileSync(path.join(station, "private", "traced.png"), "png-undeclared");
  fs.writeFileSync(path.join(station, "gteki", "scene.ts"), scene);
  return { root, app, station };
}

const run = (p: { root: string; app: string }) => build({
  root: p.app, configFile: false, logLevel: "silent",
  plugins: [gtekiStations([path.join(p.root, "stations")])],
  build: { write: false, assetsInlineLimit: 0, outDir: path.join(p.root, "dist") },
});

const emitted = async (p: { root: string; app: string }) => {
  const out = await run(p);
  const bundles = Array.isArray(out) ? out : [out];
  return bundles.flatMap((b) => ("output" in b ? b.output : [])).filter((o) => o.type === "asset").map((o) => o.fileName);
};

describe("production build publication allowlist", () => {
  it("emits declared station files", async () => {
    const files = await emitted(project(`export const buildScene = () => null;`));
    expect(files.some((f) => /b1-.*\.glb$/.test(f))).toBe(true);
  }, 30_000);

  it("refuses a file a scene imports directly without declaring it", async () => {
    const p = project(`import url from "../private/traced.png?url";\nexport const buildScene = () => url;`);
    await expect(run(p)).rejects.toThrow(/refusing to publish undeclared files.*traced\.png/);
  }, 30_000);

  it("refuses an undeclared file reached through new URL(…, import.meta.url)", async () => {
    const p = project(`export const buildScene = () => new URL("../private/traced.png", import.meta.url).href;`);
    await expect(run(p)).rejects.toThrow(/refusing to publish undeclared files.*traced\.png/);
  }, 30_000);

  it("refuses a declared name whose symlink target contains ? or #", async () => {
    const p = project(`export const buildScene = () => null;`, ["assets/west.png"]);
    fs.writeFileSync(path.join(p.station, "private", "roof#west.png"), "png");
    fs.symlinkSync("../../private/roof#west.png", path.join(p.station, "gteki", "assets", "west.png"));
    await expect(run(p)).rejects.toThrow(/resolve to paths containing \? or #: assets\/west\.png/);
  }, 30_000);

  it("keeps app-owned stylesheets a scene imports, and refuses an undeclared file at the default inline limit too", async () => {
    const p = project(`import "../../../app/style.css";\nexport const buildScene = () => null;`);
    fs.writeFileSync(path.join(p.app, "style.css"), "body { color: red; }");
    await expect(run(p)).resolves.toBeDefined();
    const big = project(`import url from "../private/traced.png?url";\nexport const buildScene = () => url;`);
    fs.writeFileSync(path.join(big.station, "private", "traced.png"), Buffer.alloc(8192, 1));
    await expect(build({ root: big.app, configFile: false, logLevel: "silent", plugins: [gtekiStations([path.join(big.root, "stations")])], build: { write: false } }))
      .rejects.toThrow(/refusing to publish undeclared files.*traced\.png/);
  }, 30_000);

  it("checks emitted data files of any type, e.g. an SVG above the inline limit", async () => {
    const p = project(`import url from "../private/traced.svg?url";\nexport const buildScene = () => url;`);
    fs.writeFileSync(path.join(p.station, "private", "traced.svg"), `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(4000)}</svg>`);
    await expect(build({ root: p.app, configFile: false, logLevel: "silent", plugins: [gtekiStations([path.join(p.root, "stations")])], build: { write: false } }))
      .rejects.toThrow(/refusing to publish undeclared files.*traced\.svg/);
  }, 30_000);

  it("applies the publication rights rules to synthetic stations too", async () => {
    const p = project(`export const buildScene = () => null;`);
    const manifest = path.join(p.station, "gteki", "station.json");
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    expect(m.station.synthetic).toBe(true);
    m.sources[0].rights = "RESTRICTED";
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).rejects.toThrow(/asset\.rights \(b1\): asset derives from source demo-synthetic with rights RESTRICTED/);
    m.sources[0].rights = "REUSABLE_WITH_CONDITIONS";
    m.assets[0].sourceIds = [];
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).rejects.toThrow(/asset\.source \(b1\): asset without source provenance/);
  }, 30_000);

  it("refuses to publish sources without credit metadata, synthetic or not", async () => {
    const p = project(`export const buildScene = () => null;`);
    const manifest = path.join(p.station, "gteki", "station.json");
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    m.sources[0].license = null;
    m.sources[0].attribution = "";
    m.sources[0].url = "not a url";
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).rejects.toThrow(/source\.url \(demo-synthetic\).*source\.attribution \(demo-synthetic\)|source\.attribution \(demo-synthetic\).*source\.url \(demo-synthetic\)/);
    await expect(run(p)).rejects.toThrow(/source\.license \(demo-synthetic\)/);
  }, 30_000);

  it("refuses a synthetic station whose graph derives from a restricted source, even with no assets", async () => {
    const p = project(`export const buildScene = () => null;`);
    const dir = path.join(p.station, "gteki");
    const m = JSON.parse(fs.readFileSync(path.join(dir, "station.json"), "utf8"));
    const g = JSON.parse(fs.readFileSync(path.join(dir, "graph.json"), "utf8"));
    m.assets = [];
    fs.rmSync(path.join(dir, "assets", "b1.glb"));
    m.sources.push({ ...m.sources[0], id: "traced-plan", rights: "RESTRICTED" });
    fs.writeFileSync(path.join(dir, "station.json"), JSON.stringify(m));
    await run(p);
    g.nodes[0].sourceRefs = [{ sourceId: "traced-plan", featureId: "plan-1" }];
    fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify(g));
    await expect(run(p)).rejects.toThrow(new RegExp(`node\\.source\\.rights \\(${g.nodes[0].id}\\)`));
  }, 30_000);
});
