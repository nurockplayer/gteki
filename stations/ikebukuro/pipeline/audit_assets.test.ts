// G0: the asset audit (pipeline/audit_assets.ts) passes on the committed tree, lists exactly the declared files with
// correct hashes, and fails on each kind of drift (negative controls run on a temporary copy of gteki/).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { INLINE_LIMIT_BYTES, STATION_DIR, audit, format } from "./audit_assets.ts";

const gteki = path.join(STATION_DIR, "gteki");
const station = JSON.parse(fs.readFileSync(path.join(gteki, "station.json"), "utf8")) as { assets: { id: string; uri: string; files?: string[] }[] };
const declared = station.assets.flatMap((a) => [a.uri, ...(a.files ?? [])]);
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
/** A temporary stations root holding a copy of Ikebukuro's gteki/ folder. */
function copyRoot(): { root: string; gteki: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-audit-"));
  scratch.push(root);
  const dest = path.join(root, "ikebukuro", "gteki");
  fs.cpSync(gteki, dest, { recursive: true });
  return { root, gteki: dest };
}

describe("audit_assets on the committed tree", () => {
  const result = audit();

  it("passes: every shipped file is declared and every declared file is present", () => {
    expect(result.problems).toEqual([]);
  });

  it("lists the contract files, the scene entry and exactly the declared assets, each with its real sha256 and size", () => {
    const files = result.files.map((f) => f.file).sort();
    expect(files).toEqual([...declared, "graph.json", "pois.json", "scene.ts", "station.json"].sort());
    expect(declared.length).toBe(45); // PLATEAU GLB + lit variant + sidecars + lightmaps (6), street-context GLBs (2, #110), the kit copies, both tiers: rail, gate array, two columns and a sign frame (10), the station catalog's 26 copies, desktop tier only: 5 escalators and 21 handrails, N02 context (1)
    for (const f of result.files) {
      expect(f.sha256, f.file).toBe(sha(path.join(gteki, f.file)));
      expect(f.bytes, f.file).toBe(fs.statSync(path.join(gteki, f.file)).size);
      expect(f.declaredBy, f.file).not.toBe("NOT DECLARED");
    }
  });

  it("names the manifest entry that declares each asset (uri vs files) and the sidecar that describes the GLBs", () => {
    const by = (name: string) => result.files.find((f) => f.file === name)!;
    expect(by("assets/ikebukuro_b1.glb").declaredBy).toBe("station.json assets[id=b1].uri");
    expect(by("assets/ikebukuro_b1_lit.glb").declaredBy).toBe("station.json assets[id=b1].files");
    expect(by("assets/ikebukuro_b1.glb").describedBy).toBe("assets/ikebukuro_b1.meta.json");
    expect(by("assets/ikebukuro_b1_lit.glb").describedBy).toBe("assets/ikebukuro_b1_lit.meta.json");
    expect(by("assets/ikebukuro_b1_lightmap_2k.webp").describedBy).toBe("assets/ikebukuro_b1_lit.meta.json");
  });

  it("checks derivation: the sidecar's source hash is station.json's pin, the recorded sizes are the files', and the lit GLB's recorded source GLB hash is reported honestly", () => {
    const fatal = result.derivation.filter((d) => d.fatal);
    expect(fatal.length).toBeGreaterThanOrEqual(4);
    expect(fatal.every((d) => d.ok)).toBe(true);
    const link = result.derivation.find((d) => d.claim.includes("source_glb_sha256"))!;
    expect(link.fatal).toBe(false);
    // Whatever the outcome, it must agree with the bytes: ok exactly when the recorded hash is the shipped GLB's.
    expect(link.actual).toBe(sha(path.join(gteki, "assets/ikebukuro_b1.glb")));
    const recorded = (JSON.parse(fs.readFileSync(path.join(gteki, "assets/ikebukuro_b1_lit.meta.json"), "utf8")) as { source_glb_sha256: string }).source_glb_sha256;
    expect(link.ok).toBe(recorded === link.actual);
    expect(result.warnings.length).toBe(link.ok ? 0 : 1);
  });

  it("prints one row per file", () => {
    const text = format(result);
    for (const f of result.files) expect(text).toContain(`${f.sha256}`);
    expect(text).toContain("ok: every shipped file is declared");
  });
});

describe("audit_assets negative controls (temporary copy of gteki/)", () => {
  it("fails on a shipped file that station.json does not declare", () => {
    const { root, gteki: g } = copyRoot();
    fs.writeFileSync(path.join(g, "assets", "stray.webp"), "not declared");
    const r = audit({ stationsRoot: root });
    expect(r.problems.some((p) => p.startsWith("shipped but undeclared: assets/stray.webp"))).toBe(true);
    expect(r.files.find((f) => f.file === "assets/stray.webp")!.declaredBy).toBe("NOT DECLARED");
    // the build gate agrees
    expect(r.problems.some((p) => p.startsWith("build gate refuses Ikebukuro"))).toBe(true);
  });

  it("fails on a declared file that is missing", () => {
    const { root, gteki: g } = copyRoot();
    fs.rmSync(path.join(g, "assets", "ikebukuro_b1_lightmap_2k.webp"));
    const r = audit({ stationsRoot: root });
    expect(r.problems.some((p) => p.startsWith("declared but missing: assets/ikebukuro_b1_lightmap_2k.webp"))).toBe(true);
  });

  it("fails when a sidecar contradicts the manifest or the bytes", () => {
    const { root, gteki: g } = copyRoot();
    const metaFile = path.join(g, "assets", "ikebukuro_b1.meta.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { source: { sha256: string } };
    meta.source.sha256 = "0".repeat(64);
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    expect(audit({ stationsRoot: root }).problems.some((p) => p.includes("source.sha256 equals station.json sources[].sha256"))).toBe(true);

    const litFile = path.join(g, "assets", "ikebukuro_b1_lit.meta.json");
    const lit = JSON.parse(fs.readFileSync(litFile, "utf8")) as { shipped_lightmaps: Record<string, { bytes: number }> };
    lit.shipped_lightmaps["ikebukuro_b1_lightmap.webp"]!.bytes += 1;
    fs.writeFileSync(litFile, JSON.stringify(lit));
    expect(audit({ stationsRoot: root }).problems.some((p) => p.includes("shipped_lightmaps[ikebukuro_b1_lightmap.webp].bytes"))).toBe(true);
  });

  it("--dist: passes when the deploy output carries every non-inlined declared file under hashed names, fails when one is absent or altered", () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-dist-"));
    scratch.push(dist);
    fs.mkdirSync(path.join(dist, "assets"));
    const big = declared.filter((f) => fs.statSync(path.join(gteki, f)).size >= INLINE_LIMIT_BYTES);
    expect(big.length).toBe(44); // 7 PLATEAU/context files + 10 kit GLBs (rail, gate array, two columns, sign frame; both tiers) + the 26 catalog copies (5 escalators, 21 handrails) + N02 context; the 1.5 KB lit sidecar is inlined by Vite
    big.forEach((f, i) => fs.copyFileSync(path.join(gteki, f), path.join(dist, "assets", `${path.basename(f, path.extname(f))}-hash${i}${path.extname(f)}`)));
    expect(audit({ dist }).problems).toEqual([]);

    fs.rmSync(path.join(dist, "assets", fs.readdirSync(path.join(dist, "assets")).find((n) => n.startsWith("ikebukuro_b1_lit-hash"))!));
    const missing = audit({ dist }).problems;
    expect(missing.some((p) => p.startsWith("not in the deploy output") && p.includes("assets/ikebukuro_b1_lit.glb"))).toBe(true);

    const glb = fs.readdirSync(path.join(dist, "assets")).find((n) => n.startsWith("ikebukuro_b1-hash"))!;
    fs.appendFileSync(path.join(dist, "assets", glb), "x");
    expect(audit({ dist }).problems.some((p) => p.includes("assets/ikebukuro_b1.glb"))).toBe(true);
  });
});
