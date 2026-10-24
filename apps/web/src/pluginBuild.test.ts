import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, type Logger } from "vite";
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

/** Run `fn` with `GTEKI_INLINE_DATA_GATE` set (`undefined`: unset), restoring the previous value afterwards. */
async function withMode(mode: string | undefined, fn: () => Promise<void>): Promise<void> {
  const before = process.env.GTEKI_INLINE_DATA_GATE;
  if (mode === undefined) delete process.env.GTEKI_INLINE_DATA_GATE; else process.env.GTEKI_INLINE_DATA_GATE = mode;
  try { await fn(); } finally { if (before === undefined) delete process.env.GTEKI_INLINE_DATA_GATE; else process.env.GTEKI_INLINE_DATA_GATE = before; }
}

describe("production build publication allowlist", () => {
  it("emits declared station files", async () => {
    const files = await emitted(project(`export const buildScene = () => null;`));
    expect(files.some((f) => /b1-.*\.glb$/.test(f))).toBe(true);
  }, 30_000);

  it("refuses a file a scene imports directly without declaring it", async () => {
    const p = project(`import url from "../private/traced.png?url";\nexport const buildScene = () => url;`);
    // The inline gate would fail this first (the ?url module is a module id too); warn lets the allowlist refuse it.
    await withMode("warn", async () => { await expect(run(p)).rejects.toThrow(/refusing to publish undeclared files.*traced\.png/); });
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
    await withMode("warn", async () => {
      await expect(build({ root: big.app, configFile: false, logLevel: "silent", plugins: [gtekiStations([path.join(big.root, "stations")])], build: { write: false } }))
        .rejects.toThrow(/refusing to publish undeclared files.*traced\.png/);
    });
  }, 30_000);

  it("checks emitted data files of any type, e.g. an SVG above the inline limit", async () => {
    const p = project(`import url from "../private/traced.svg?url";\nexport const buildScene = () => url;`);
    fs.writeFileSync(path.join(p.station, "private", "traced.svg"), `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(4000)}</svg>`);
    await withMode("warn", async () => {
      await expect(build({ root: p.app, configFile: false, logLevel: "silent", plugins: [gtekiStations([path.join(p.root, "stations")])], build: { write: false } }))
        .rejects.toThrow(/refusing to publish undeclared files.*traced\.svg/);
    });
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

  describe("inlined data gate (#121)", () => {
    /** A station whose scene inlines scene/declared.json (declared in dataFiles[]) and scene/undeclared.json (not). */
    function dataProject() {
      const p = project(`import declared from "../scene/declared.json";\nimport undeclared from "../scene/undeclared.json";\nexport const buildScene = () => [declared, undeclared];`);
      fs.mkdirSync(path.join(p.station, "scene"), { recursive: true });
      fs.writeFileSync(path.join(p.station, "scene", "declared.json"), JSON.stringify({ marker: "declared-bytes" }));
      fs.writeFileSync(path.join(p.station, "scene", "undeclared.json"), JSON.stringify({ marker: "undeclared-bytes" }));
      const manifest = path.join(p.station, "gteki", "station.json");
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
      m.sources.push({ ...m.sources[0], id: "guide", usage: "facts-only", rights: "REFERENCE_ONLY", license: null, decision: { url: "https://example.org/decision", date: "2026-10-22" } });
      m.dataFiles = [{ id: "declared", path: "scene/declared.json", sourceIds: ["demo-synthetic", "guide"], modified: true, derivation: "fixture: generated by the test" }];
      fs.writeFileSync(manifest, JSON.stringify(m));
      return p;
    }
    const logged = (p: { root: string; app: string }) => {
      const lines = { info: [] as string[], warn: [] as string[] };
      const customLogger = { ...({} as Logger), hasWarned: false, clearScreen() {}, hasErrorLogged: () => false, error() {}, warnOnce() {},
        info: (m: string) => { lines.info.push(m); }, warn: (m: string) => { lines.warn.push(m); } } as Logger;
      const options = { root: p.app, configFile: false as const, customLogger, plugins: [gtekiStations([path.join(p.root, "stations")])],
        build: { write: false, assetsInlineLimit: 0, outDir: path.join(p.root, "dist") } };
      return { lines, run: () => build(options) };
    };

    it("fails by default on an undeclared inlined JSON, naming only that file", async () => {
      const l = logged(dataProject());
      await withMode(undefined, async () => {
        await expect(l.run()).rejects.toThrow(/alpha: scene\/undeclared\.json/);
        await expect(l.run()).rejects.not.toThrow(/scene\/declared\.json/);
      });
    }, 30_000);

    it("only logs undeclared inlined JSON when the mode is explicitly warn; the declared one is silent", async () => {
      const l = logged(dataProject());
      await withMode("warn", async () => { await expect(l.run()).resolves.toBeDefined(); });
      const text = l.lines.warn.join("\n");
      expect(text).toMatch(/inlined into the bundle without a manifest declaration/);
      expect(text).toContain("alpha: scene/undeclared.json");
      expect(text).not.toContain("scene/declared.json");
      expect(text).toContain("GTEKI_INLINE_DATA_GATE=warn");
    }, 30_000);

    it("fails the build on an undeclared inlined JSON in error mode, naming only that file", async () => {
      const l = logged(dataProject());
      await withMode("error", async () => {
        await expect(l.run()).rejects.toThrow(/alpha: scene\/undeclared\.json/);
        await expect(l.run()).rejects.not.toThrow(/scene\/declared\.json/);
      });
    }, 30_000);

    it("passes in error mode once the file is declared, and logs the facts-only citation once per build", async () => {
      const p = dataProject();
      const manifest = path.join(p.station, "gteki", "station.json");
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
      m.dataFiles.push({ id: "undeclared", path: "scene/undeclared.json", sourceIds: ["demo-synthetic"], modified: false });
      fs.writeFileSync(manifest, JSON.stringify(m));
      const l = logged(p);
      await withMode("error", async () => { await expect(l.run()).resolves.toBeDefined(); });
      expect(l.lines.warn).toEqual([]);
      expect(l.lines.info.filter((x) => x.startsWith("[gteki]"))).toEqual(["[gteki] alpha scene/declared.json cites facts-only: guide"]);
    }, 30_000);

    it("refuses a modified data file with no derivation, and a ?raw svg until it is declared", async () => {
      const p = dataProject();
      const manifest = path.join(p.station, "gteki", "station.json");
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
      delete m.dataFiles[0].derivation;
      fs.writeFileSync(manifest, JSON.stringify(m));
      await expect(logged(p).run()).rejects.toThrow(/data\.derivation \(declared\)/);
      m.dataFiles[0].derivation = "fixture";
      fs.writeFileSync(manifest, JSON.stringify(m));
      fs.writeFileSync(path.join(p.station, "gteki", "scene.ts"), `import svg from "../scene/sign.svg?raw";\nexport const buildScene = () => svg;`);
      fs.writeFileSync(path.join(p.station, "scene", "sign.svg"), "<svg/>");
      const l = logged(p);
      await withMode("warn", async () => { await l.run(); });
      expect(l.lines.warn.join("\n")).toContain("alpha: scene/sign.svg");
      m.dataFiles.push({ id: "sign", path: "scene/sign.svg", sourceIds: ["demo-synthetic"], modified: false });
      fs.writeFileSync(manifest, JSON.stringify(m));
      const l2 = logged(p);
      await withMode("error", async () => { await expect(l2.run()).resolves.toBeDefined(); });
    }, 30_000);

    it("refuses inlined data reached through a symlink out of the station folder, even when declared", async () => {
      const p = dataProject();
      fs.mkdirSync(path.join(p.root, "shared"), { recursive: true });
      fs.writeFileSync(path.join(p.root, "shared", "linked.json"), JSON.stringify({ marker: "outside" }));
      fs.symlinkSync("../../../shared/linked.json", path.join(p.station, "scene", "linked.json"));
      fs.writeFileSync(path.join(p.station, "gteki", "scene.ts"), `import linked from "../scene/linked.json";\nexport const buildScene = () => linked;`);
      const manifest = path.join(p.station, "gteki", "station.json");
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
      m.dataFiles.push({ id: "linked", path: "scene/linked.json", sourceIds: ["demo-synthetic"], modified: false });
      fs.writeFileSync(manifest, JSON.stringify(m));
      await expect(logged(p).run()).rejects.toThrow(/declared data files resolve outside the station folder: scene\/linked\.json/);
      // Undeclared, the gate reports the link by its station path (Vite reports the target, which is outside every station).
      m.dataFiles.pop();
      fs.writeFileSync(manifest, JSON.stringify(m));
      const l = logged(p);
      await withMode("warn", async () => { await l.run(); });
      expect(l.lines.warn.join("\n")).toContain("alpha: scene/linked.json (symlink resolving outside the station folder)");
      // The default fails the build on the same link.
      const l2 = logged(p);
      await withMode(undefined, async () => { await expect(l2.run()).rejects.toThrow(/alpha: scene\/linked\.json/); });
    }, 30_000);
  });

  it("publishes a source under the Owner override only with its recorded decision (#130)", async () => {
    const p = project(`export const buildScene = () => null;`);
    const manifest = path.join(p.station, "gteki", "station.json");
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    m.sources[0].rights = "PUBLISHED_UNDER_OWNER_OVERRIDE";
    m.sources[0].license = { name: "Licence unconfirmed", url: "https://example.org/terms" };
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).rejects.toThrow(/source\.override \(demo-synthetic\)/);
    m.sources[0].override = { decision: "see chat", date: "2026-10-22" };
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).rejects.toThrow(/source\.override \(demo-synthetic\)/);
    m.sources[0].override = { decision: "https://github.com/nurockplayer/gteki/issues/130", date: "2026-10-22" };
    fs.writeFileSync(manifest, JSON.stringify(m));
    await expect(run(p)).resolves.toBeDefined();
  }, 30_000);
});
