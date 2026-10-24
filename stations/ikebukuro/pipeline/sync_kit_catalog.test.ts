// pipeline/sync_kit_catalog.py: the shipped batches (A: 5 escalators, B: 21 handrails, C: 61 nosing strips and their
// shared AO atlas) copy exactly the catalog GLBs some placement loads, on the tiers it loads them, and --check proves
// the committed copies still match the source record's pins. Batch C lands in two stacked changes: this one ships the
// desktop tier, so the phone copies are still absent (the follow-up widens the plan to both tiers). The negative
// controls run on a temporary copy of the catalog folder (and a temporary station.json), so the committed tree is
// never touched.
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const GTEKI = path.join(STATION, "gteki");
const CATALOG_REL = "kit/catalog";
const SCRIPT = path.join(HERE, "sync_kit_catalog.py");
const python = spawnSync("python3", ["-I", "--version"]).status === 0;

const plan = JSON.parse(fs.readFileSync(path.join(STATION, "scene/kit_placements.json"), "utf8")) as {
  placements: { anchor: string; kind: string; ids: Record<string, string>; tiers: Record<string, string[]> }[];
};
const catalog = JSON.parse(fs.readFileSync(path.join(STATION, "scene/kit_catalog.json"), "utf8")) as {
  assets: { id: string; generator: string }[];
};
const escalatorIds = catalog.assets.filter((a) => a.generator === "escalator_dressing").map((a) => a.id).sort();
/** The rail ids some placement draws (the catalog has 57; only the 21 `main_route` flights list a tier). */
const railIds = [
  ...new Set(plan.placements.flatMap((p) => (p.tiers.rails ?? []).map(() => p.ids.rails!))),
].sort();
/** The 61 nosing ids every stair flight draws (69 placements reuse them, and all list `low` and `high`). */
const nosingIds = [
  ...new Set(plan.placements.flatMap((p) => (p.tiers.nosing ?? []).map(() => p.ids.nosing!))),
].sort();
/** Every id the station ships today (batch A + B + C), all of them on the desktop tier only. */
const ids = [...escalatorIds, ...railIds, ...nosingIds].sort();
/** The packed AO atlas batch C's nosings sample, shipped next to the desktop tier's GLBs. */
const ATLAS = `${CATALOG_REL}/high/atlas/nosing_ao.png`;
/** Every file the source record pins: the planned GLBs and the atlas. */
const shipped = [...ids.map((id) => `${CATALOG_REL}/high/${id}.glb`), ATLAS].sort();
// The Lane E build output lives outside the repo; when this machine has it, the copy-mode checks can run.
const LANE_E = "/Users/tachikoma/Developer/gteki/.claude/worktrees/gteki-lane-e-int/tools/blender/.cache/c3_sample_cb3b29b";
const hasLaneE = fs.existsSync(path.join(LANE_E, "ike_full", "manifest.json"));

const stationJson = JSON.parse(fs.readFileSync(path.join(GTEKI, "station.json"), "utf8")) as {
  sources: { id: string; sha256?: Record<string, string> }[];
};
const record = stationJson.sources.find((s) => s.id === "gteki-ikb-catalog-0-1-0")!;

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
/** A temporary catalog folder holding a copy of the committed high/ tier folder. */
function copyDest(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-"));
  scratch.push(d);
  fs.cpSync(path.join(GTEKI, CATALOG_REL), d, { recursive: true });
  return d;
}
/** A temporary station.json whose copy may be edited without touching the committed one. */
function copyStation(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-json-"));
  scratch.push(d);
  fs.copyFileSync(path.join(GTEKI, "station.json"), path.join(d, "station.json"));
  return path.join(d, "station.json");
}
const run = (...args: string[]) => spawnSync("python3", ["-I", SCRIPT, ...args], { encoding: "utf8" });
/** A temporary copy of scene/kit_catalog_atlas.json, safe to tamper with. */
function copyAtlasFacts(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-atlas-"));
  scratch.push(d);
  const out = path.join(d, "kit_catalog_atlas.json");
  fs.copyFileSync(path.join(STATION, "scene/kit_catalog_atlas.json"), out);
  return out;
}
const glb = (dest: string, id: string) => path.join(dest, "high", `${id}.glb`);
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("the shipped batches", () => {
  it("plans the 5 escalators, the 21 handrails and the 61 nosing strips, all on the desktop tier", () => {
    expect(escalatorIds.length).toBe(5);
    expect(railIds.length).toBe(21);
    expect(nosingIds.length).toBe(61);
    expect(record.sha256).toBeDefined();
    expect(Object.keys(record.sha256!).sort()).toEqual(shipped);
    // Every escalator placement loads `high` alone and every rail part is `high` only, so there is no phone copy.
    const escalators = plan.placements.filter((p) => p.kind === "escalator");
    expect(escalators.length).toBe(5);
    for (const p of escalators) expect(p.tiers.dressing).toEqual(["high"]);
    const rails = plan.placements.filter((p) => "rails" in p.ids);
    expect(rails.length).toBe(69); // every stair flight has a rail id (65, +4 rescued by #315's 0.1 mm riser) ...
    expect(rails.filter((p) => (p.tiers.rails ?? []).includes("high")).length).toBe(21); // ... 21 draw it (main_route)
    for (const p of rails) expect(p.tiers.rails ?? []).not.toContain("low");
    // Batch C: every flight lists both tiers, but this change ships the desktop copies only.
    const nosings = plan.placements.filter((p) => "nosing" in p.ids);
    expect(nosings.length).toBe(69);
    for (const p of nosings) expect(p.tiers.nosing).toEqual(["low", "high"]);
  });

  it.skipIf(!python)("--check passes on the committed tree", () => {
    const r = run("--check");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.skipIf(!python)("each committed copy, the atlas included, hashes to the source record's pin", () => {
    for (const rel of shipped) expect(sha(path.join(GTEKI, rel)), rel).toBe(record.sha256![rel]);
  });

  it.skipIf(!python)("--check passes on a copy of the folder and changes nothing", () => {
    const dest = copyDest();
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(path.join(dest, "high")).sort()).toEqual([...ids.map((id) => `${id}.glb`), "atlas"].sort());
  });
});

describe("--check negative controls", () => {
  it.skipIf(!python)("fails when a copy no longer matches the pinned sha256", () => {
    const dest = copyDest();
    fs.appendFileSync(glb(dest, ids[0]!), "x");
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`kit/catalog/high/${ids[0]}.glb differs from the gteki-ikb-catalog-0-1-0 pin`);
  });

  it.skipIf(!python)("fails when a copy is missing", () => {
    const dest = copyDest();
    fs.rmSync(glb(dest, ids[1]!));
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${CATALOG_REL}/high/${ids[1]}.glb is missing`);
  });

  it.skipIf(!python)("fails when the nosing atlas no longer matches its pin or is missing", () => {
    const tampered = copyDest();
    fs.appendFileSync(path.join(tampered, "high", "atlas", "nosing_ao.png"), "x");
    const r = run("--check", "--dest", tampered);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${ATLAS} differs from the gteki-ikb-catalog-0-1-0 pin`);

    const missing = copyDest();
    fs.rmSync(path.join(missing, "high", "atlas", "nosing_ao.png"));
    const r2 = run("--check", "--dest", missing);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain(`gteki/${ATLAS} is missing`);
  });

  it.skipIf(!python)("fails when the atlas-facts file disagrees with the tier manifest or is missing", () => {
    const facts = copyAtlasFacts();
    const doc = JSON.parse(fs.readFileSync(facts, "utf8"));
    doc.nosing.tiers.high.max_isolated_mip += 1;
    fs.writeFileSync(facts, JSON.stringify(doc));
    const r = run("--check", "--atlas-json", facts);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("kit_catalog_atlas.json differs from the tier manifests' atlases.nosing");

    fs.rmSync(facts);
    const r2 = run("--check", "--atlas-json", facts);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("kit_catalog_atlas.json is missing");
  });

  it.skipIf(!python || !hasLaneE)("fails when a planned file has no entry in its tier manifest", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-src-"));
    scratch.push(src);
    fs.cpSync(path.join(LANE_E, "ike_full"), src, { recursive: true });
    const manifest = path.join(src, "manifest.json");
    const doc = JSON.parse(fs.readFileSync(manifest, "utf8"));
    doc.assets = doc.assets.filter((a: { id: string }) => a.id !== nosingIds[0]);
    fs.writeFileSync(manifest, JSON.stringify(doc));
    const r = run("--check", "--src-full", src);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${CATALOG_REL}/high/${nosingIds[0]}.glb has no entry in the high manifest`);
  });

  it.skipIf(!python)("fails on a copy no placement loads", () => {
    const dest = copyDest();
    fs.copyFileSync(glb(dest, ids[0]!), path.join(dest, "high", "gteki_ik_escalator_stale.glb"));
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("gteki_ik_escalator_stale.glb is not a catalog copy any placement loads");
  });

  it.skipIf(!python)("fails when the source record pins a file no placement loads", () => {
    const station = copyStation();
    const doc = JSON.parse(fs.readFileSync(station, "utf8")) as { sources: { id: string; sha256: Record<string, string> }[] };
    const rec = doc.sources.find((s) => s.id === "gteki-ikb-catalog-0-1-0")!;
    rec.sha256[`${CATALOG_REL}/high/gteki_ik_escalator_stale.glb`] = "0".repeat(64);
    fs.writeFileSync(station, JSON.stringify(doc));
    const r = run("--check", "--station", station);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pins kit/catalog/high/gteki_ik_escalator_stale.glb, but no placement loads it");
  });

  it.skipIf(!python)("fails when a copy is not pinned at all", () => {
    const station = copyStation();
    const doc = JSON.parse(fs.readFileSync(station, "utf8")) as { sources: { id: string; sha256: Record<string, string> }[] };
    const rec = doc.sources.find((s) => s.id === "gteki-ikb-catalog-0-1-0")!;
    delete rec.sha256[`${CATALOG_REL}/high/${ids[0]}.glb`];
    fs.writeFileSync(station, JSON.stringify(doc));
    const r = run("--check", "--station", station);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${CATALOG_REL}/high/${ids[0]}.glb is not pinned by gteki-ikb-catalog-0-1-0`);
  });

  it.skipIf(!python)("refuses an unknown kind without touching anything", () => {
    const dest = copyDest();
    const before = fs.readdirSync(path.join(dest, "high")).sort();
    const r = run("--kinds", "staircase", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown kind 'staircase'");
    expect(fs.readdirSync(path.join(dest, "high")).sort()).toEqual(before);
  });
});

// When the Lane E build is present, prove copy mode reproduces the committed bytes and a second run is a no-op.
describe.skipIf(!python || !hasLaneE)("copy mode against the Lane E C3 sample tree", () => {
  it("reproduces the committed copies byte for byte, the atlas included, and a second run copies nothing", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-copy-"));
    scratch.push(dest);
    const facts = copyAtlasFacts();
    fs.rmSync(facts); // copy mode rewrites it from the manifests
    const first = run("--dest", dest, "--atlas-json", facts);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(fs.readdirSync(path.join(dest, "high")).sort()).toEqual([...ids.map((id) => `${id}.glb`), "atlas"].sort());
    for (const rel of shipped) expect(sha(path.join(dest, rel.slice(CATALOG_REL.length + 1))), rel).toBe(record.sha256![rel]);
    const second = run("--dest", dest, "--atlas-json", facts);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("copied");
  });
});
