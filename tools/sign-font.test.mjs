import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { create as readFont } from "fontkit";
import { describe, expect, it } from "vitest";
import { assertGlyphCoverage, JOYO_KANJI, repoRoot, requiredGlyphs } from "./fonts/sign-glyphs.mjs";
import { gtekiStations } from "../apps/web/stations-plugin.ts";

const dir = path.join(repoRoot, "assets/fonts/noto-sans-jp");
const glyphs = fs.readFileSync(path.join(dir, "glyphs.txt"), "utf8").trimEnd();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "source.json"), "utf8"));
const fontFile = path.join(repoRoot, "apps/web/src/fonts/GTEkiSignJP-subset.woff2");

describe("pinned sign font", () => {
  it("covers current station text; new characters require pnpm fonts:subset", () => {
    expect(() => assertGlyphCoverage(requiredGlyphs(), glyphs)).not.toThrow();
    expect([...glyphs]).toEqual([...new Set(glyphs)].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)));
  });

  it("commits the whole 常用漢字表, once each", () => {
    expect([...JOYO_KANJI]).toHaveLength(2136);
    expect(new Set(JOYO_KANJI).size).toBe(2136);
  });

  it("finds escaped literals and nested templates, JSON text and a new kanji", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-sign-glyphs-"));
    try {
      const scene = path.join(root, "stations/test/scene");
      fs.mkdirSync(scene, { recursive: true });
      fs.mkdirSync(path.join(root, "stations/test/gteki"));
      fs.writeFileSync(path.join(root, "stations/test/gteki/station.json"), JSON.stringify({ station: { names: [{ text: "龍" }] } }));
      fs.writeFileSync(path.join(scene, "labels.json"), JSON.stringify({ labels: ["龜"] }));
      fs.writeFileSync(path.join(scene, "signs.ts"), 'const text: string = `鶴${`麒${"麟"}`}鷹`; const escaped = "\\u9F8D"; // 齉 is a comment\n');
      const found = requiredGlyphs(root);
      for (const c of "龍龜鶴麒麟鷹") expect(found).toContain(c);
      expect(found).not.toContain("齉");
      expect(() => assertGlyphCoverage(found, found.replace("龍", ""))).toThrow(/龍.*run pnpm fonts:subset/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("records pin, source hash/size, and an overriding OFL annotation", () => {
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.bytes).toBeGreaterThan(0);
    expect(manifest.tag).toBe("Sans2.004");
    expect(createHash("sha256").update(fs.readFileSync(path.join(dir, "OFL.txt"))).digest("hex")).toBe(manifest.licenseSha256);
    const reuse = fs.readFileSync(path.join(repoRoot, "REUSE.toml"), "utf8");
    const annotations = reuse.split("[[annotations]]").filter((block) => block.includes('"assets/fonts/**"'));
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('precedence = "override"');
    expect(annotations[0]).toContain('SPDX-License-Identifier = "OFL-1.1"');
    expect(annotations[0]).toContain(manifest.copyright);
    expect(annotations[0]).toContain('"apps/web/src/fonts/**"');
    expect(reuse.indexOf('"assets/fonts/**"')).toBeGreaterThan(reuse.indexOf('path = "**"'));
    expect(fs.readFileSync(path.join(repoRoot, "LICENSES/OFL-1.1.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("ships the alias, legal notices, variable weights, and all upstream-supported requested glyphs", () => {
    const bytes = fs.readFileSync(fontFile);
    const report = JSON.parse(fs.readFileSync(path.join(dir, "bytes.json"), "utf8"));
    const font = readFont(bytes);
    expect(font.familyName).toBe(manifest.family);
    expect(font.postscriptName).toBe(manifest.postscriptName);
    expect(font.name.records.copyright.en).toBe(manifest.copyright);
    expect(font.name.records.license.en).toContain("SIL Open Font License");
    expect(font.name.records.license.en).toContain(fs.readFileSync(path.join(dir, "OFL.txt"), "utf8"));
    expect(font.variationAxes.wght).toMatchObject({ min: 500, max: 800 });
    const unsupported = new Set(report.unsupportedCodePoints);
    for (const c of glyphs) {
      const cp = c.codePointAt(0);
      const key = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      expect(font.hasGlyphForCodePoint(cp), key).toBe(!unsupported.has(key));
    }
    expect(bytes.length).toBe(report.full.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.full.sha256);
    expect([...glyphs].length).toBe(report.glyphCount);
  });

  it("passes the production publication gate as an app-owned asset", () => {
    const plugin = gtekiStations([]);
    plugin.configResolved({ command: "build", root: path.join(repoRoot, "apps/web"), logger: { info() {} } });
    const output = (file) => ({ font: { type: "asset", fileName: "assets/font.woff2", originalFileNames: [file] } });
    const context = { error(message) { throw new Error(message); } };
    expect(() => plugin.generateBundle.call(context, {}, output(fontFile))).not.toThrow();
    // Shared repo assets remain fenced: no broad font/file exemption was added.
    expect(() => plugin.generateBundle.call(context, {}, output(path.join(dir, "undeclared.woff2")))).toThrow(/refusing to publish undeclared files/);
  });
});
