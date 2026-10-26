// pipeline/sync_kit_catalog.py: the shipped batches (A: 5 escalators and B: 21 handrails on the desktop tier, C: the
// 61 nosing strips on both tiers, with batch A's escalator atlas on the desktop tier and batch C's nosing atlas per
// tier) copy exactly the catalog GLBs some placement loads, on the tiers it loads them, and --check proves the
// committed copies still match the source record's pins.
// The negative controls run on a temporary copy of the catalog folder (and a temporary station.json), so the
// committed tree is never touched.
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
/** What each tier folder holds: batches A and B are desktop-only, batch C draws on both tiers. */
const TIERS = { high: [...escalatorIds, ...railIds, ...nosingIds].sort(), low: [...nosingIds].sort() };
/** The packed AO atlas batch C's nosings sample: one per tier, shipped next to that tier's GLBs. */
const ATLAS = (tier: keyof typeof TIERS) => `${CATALOG_REL}/${tier}/atlas/nosing_ao.png`;
/** Batch A's escalators sample a packed atlas too, and they draw on the desktop tier alone. */
const ESCALATOR_ATLAS = `${CATALOG_REL}/high/atlas/escalator_ao.png`;
/** Every file the source record pins: the planned GLBs and each tier's atlases. */
const shipped = [
  ...TIERS.high.map((id) => `${CATALOG_REL}/high/${id}.glb`),
  ATLAS("high"),
  ESCALATOR_ATLAS,
  ...TIERS.low.map((id) => `${CATALOG_REL}/low/${id}.glb`),
  ATLAS("low"),
].sort();
// The Lane E build output lives outside the repo; when this machine has it, the copy-mode checks can run.
const LANE_E = "/Users/tachikoma/Developer/gteki/.claude/worktrees/gteki-lane-e-int/tools/blender/.cache/c3_ike_cb3b29b_54007755";
const hasLaneE = ["ike_full", "ike_mobile"].every((d) => fs.existsSync(path.join(LANE_E, d, "manifest.json")));

const stationJson = JSON.parse(fs.readFileSync(path.join(GTEKI, "station.json"), "utf8")) as {
  sources: { id: string; sha256?: Record<string, string> }[];
};
const record = stationJson.sources.find((s) => s.id === "gteki-ikb-catalog-0-1-0")!;

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
/** A temporary catalog folder holding a copy of the committed high/ and low/ tier folders. */
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
const glb = (dest: string, id: string, tier: keyof typeof TIERS = "high") => path.join(dest, tier, `${id}.glb`);
const listing = (dest: string, tier: keyof typeof TIERS) =>
  fs.readdirSync(path.join(dest, tier)).filter((n) => n.endsWith(".glb")).map((n) => n.slice(0, -4))
    .concat(fs.existsSync(path.join(dest, tier, "atlas")) ? ["atlas"] : [])
    .sort();
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("the shipped batches", () => {
  it("plans the 5 escalators and the 21 handrails on the desktop tier, the 61 nosing strips on both tiers", () => {
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
    // Batch C: every flight lists both tiers, so both tier folders hold the nosings and their atlas.
    const nosings = plan.placements.filter((p) => "nosing" in p.ids);
    expect(nosings.length).toBe(69);
    for (const p of nosings) expect(p.tiers.nosing).toEqual(["low", "high"]);
  });

  it.skipIf(!python || !hasLaneE)("records each atlas's size and mip limit from the tier manifests", () => {
    const facts = JSON.parse(fs.readFileSync(path.join(STATION, "scene/kit_catalog_atlas.json"), "utf8"));
    const expected: Record<string, { path: string; tiers: Record<string, Record<string, unknown>> }> = {};
    for (const [tier, dir] of [["high", "ike_full"], ["low", "ike_mobile"]] as const) {
      const doc = JSON.parse(fs.readFileSync(path.join(LANE_E, dir, "manifest.json"), "utf8")) as {
        atlases: Record<string, { path: string; size_px: number[]; bytes: number; max_isolated_mip: number }>;
      };
      for (const [kind, a] of Object.entries(doc.atlases))
        (expected[kind] ??= { path: a.path, tiers: {} }).tiers[tier] =
          { size_px: a.size_px, bytes: a.bytes, max_isolated_mip: a.max_isolated_mip };
    }
    expect(facts).toEqual(expected);
    expect(Object.keys(facts).sort()).toEqual(["escalator", "nosing"]);
  });

  it.skipIf(!python)("--check passes on the committed tree", () => {
    const r = run("--check");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.skipIf(!python)("each committed copy, both atlases included, hashes to the source record's pin", () => {
    for (const rel of shipped) expect(sha(path.join(GTEKI, rel)), rel).toBe(record.sha256![rel]);
  });

  it.skipIf(!python)("--check passes on a copy of the folders and changes nothing", () => {
    const dest = copyDest();
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(0);
    expect(listing(dest, "high")).toEqual([...TIERS.high, "atlas"].sort());
    expect(listing(dest, "low")).toEqual([...TIERS.low, "atlas"].sort()); // the phone tier holds batch C alone
  });
});

describe("--check negative controls", () => {
  it.skipIf(!python)("fails when a copy no longer matches the pinned sha256", () => {
    const dest = copyDest();
    fs.appendFileSync(glb(dest, TIERS.high[0]!), "x");
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`kit/catalog/high/${TIERS.high[0]}.glb differs from the gteki-ikb-catalog-0-1-0 pin`);
  });

  it.skipIf(!python)("fails when a copy is missing, on either tier", () => {
    const high = copyDest();
    fs.rmSync(glb(high, TIERS.high[1]!));
    const r = run("--check", "--dest", high);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${CATALOG_REL}/high/${TIERS.high[1]}.glb is missing`);

    const low = copyDest();
    fs.rmSync(glb(low, TIERS.low[0]!, "low"));
    const r2 = run("--check", "--dest", low);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain(`gteki/${CATALOG_REL}/low/${TIERS.low[0]}.glb is missing`);
  });

  it.skipIf(!python)("fails when the escalator atlas no longer matches its pin or is missing", () => {
    const tampered = copyDest();
    fs.appendFileSync(path.join(tampered, "high", "atlas", "escalator_ao.png"), "x");
    const r = run("--check", "--dest", tampered);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${ESCALATOR_ATLAS} differs from the gteki-ikb-catalog-0-1-0 pin`);

    const missing = copyDest();
    fs.rmSync(path.join(missing, "high", "atlas", "escalator_ao.png"));
    const r2 = run("--check", "--dest", missing);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain(`gteki/${ESCALATOR_ATLAS} is missing`);

    // The desktop-only atlas has no phone copy, and a stray one is not a file the plan produces.
    const stray = copyDest();
    fs.copyFileSync(path.join(stray, "high", "atlas", "escalator_ao.png"), path.join(stray, "low", "atlas", "escalator_ao.png"));
    const r3 = run("--check", "--dest", stray);
    expect(r3.status).toBe(1);
    expect(r3.stderr).toContain("low/atlas/escalator_ao.png is not a catalog copy any placement loads");
  });

  it.skipIf(!python)("fails when either tier's nosing atlas no longer matches its pin or is missing", () => {
    for (const tier of ["high", "low"] as const) {
      const tampered = copyDest();
      fs.appendFileSync(path.join(tampered, tier, "atlas", "nosing_ao.png"), "x");
      const r = run("--check", "--dest", tampered);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`gteki/${ATLAS(tier)} differs from the gteki-ikb-catalog-0-1-0 pin`);

      const missing = copyDest();
      fs.rmSync(path.join(missing, tier, "atlas", "nosing_ao.png"));
      const r2 = run("--check", "--dest", missing);
      expect(r2.status).toBe(1);
      expect(r2.stderr).toContain(`gteki/${ATLAS(tier)} is missing`);
    }
  });

  // The script only compares the facts file when every atlas tier's manifest is at hand, so this needs Lane E too.
  it.skipIf(!python || !hasLaneE)("fails when the atlas-facts file disagrees with the tier manifest or is missing", () => {
    const facts = copyAtlasFacts();
    const doc = JSON.parse(fs.readFileSync(facts, "utf8"));
    doc.nosing.tiers.high.max_isolated_mip += 1;
    fs.writeFileSync(facts, JSON.stringify(doc));
    const r = run("--check", "--atlas-json", facts);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("kit_catalog_atlas.json differs from the tier manifests' atlases");

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
    fs.copyFileSync(glb(dest, TIERS.high[0]!), path.join(dest, "high", "gteki_ik_escalator_stale.glb"));
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("gteki_ik_escalator_stale.glb is not a catalog copy any placement loads");
  });

  it.skipIf(!python)("fails on a phone copy of a desktop-only part", () => {
    const dest = copyDest();
    fs.copyFileSync(glb(dest, escalatorIds[0]!), glb(dest, escalatorIds[0]!, "low"));
    const r = run("--check", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`low/${escalatorIds[0]}.glb is not a catalog copy any placement loads`);
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
    delete rec.sha256[`${CATALOG_REL}/low/${nosingIds[0]}.glb`];
    fs.writeFileSync(station, JSON.stringify(doc));
    const r = run("--check", "--station", station);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`gteki/${CATALOG_REL}/low/${nosingIds[0]}.glb is not pinned by gteki-ikb-catalog-0-1-0`);
  });

  it.skipIf(!python)("refuses an unknown kind without touching anything", () => {
    const dest = copyDest();
    const before = listing(dest, "high");
    const r = run("--kinds", "staircase", "--dest", dest);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown kind 'staircase'");
    expect(listing(dest, "high")).toEqual(before);
  });
});

// When the Lane E build is present, prove copy mode reproduces the committed bytes and a second run is a no-op.
describe.skipIf(!python || !hasLaneE)("copy mode against the Lane E C3 tree", () => {
  it("reproduces the committed copies byte for byte on both tiers, and a second run copies nothing", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-catalog-copy-"));
    scratch.push(dest);
    const facts = copyAtlasFacts();
    fs.rmSync(facts); // copy mode rewrites it from the manifests
    const first = run("--dest", dest, "--atlas-json", facts);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(listing(dest, "high")).toEqual([...TIERS.high, "atlas"].sort());
    expect(listing(dest, "low")).toEqual([...TIERS.low, "atlas"].sort());
    for (const rel of shipped) expect(sha(path.join(dest, rel.slice(CATALOG_REL.length + 1))), rel).toBe(record.sha256![rel]);
    const second = run("--dest", dest, "--atlas-json", facts);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain("copied");
  });
});
