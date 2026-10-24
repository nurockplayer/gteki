// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import subsetFont from "subset-font";
import { create as readFont } from "fontkit";
import { repoRoot, requiredGlyphs } from "./sign-glyphs.mjs";
import { renameFont } from "./rename-font.mjs";

export async function generate(check = false) {
  const dir = path.join(repoRoot, "assets/fonts/noto-sans-jp");
  // The publication gate accepts app-owned assets. Legal/source records remain
  // shared; a station need not claim ownership of this core font.
  const fontFile = path.join(repoRoot, "apps/web/src/fonts/GTEkiSignJP-subset.woff2");
  const manifest = JSON.parse(await fs.readFile(path.join(dir, "source.json"), "utf8"));
  const license = await fs.readFile(path.join(dir, "OFL.txt"));
  if (createHash("sha256").update(license).digest("hex") !== manifest.licenseSha256) throw new Error("Pinned OFL.txt sha256 mismatch");
  const cache = path.join(repoRoot, ".cache/fonts", `${manifest.sha256}.ttf`);
  await fs.mkdir(path.dirname(cache), { recursive: true });
  let source;
  try { source = await fs.readFile(cache); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(manifest.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Font download failed: HTTP ${response.status}`);
    source = Buffer.from(await response.arrayBuffer());
  }
  if (source.length !== manifest.bytes || createHash("sha256").update(source).digest("hex") !== manifest.sha256) throw new Error("Pinned font size/sha256 mismatch");
  const original = readFont(source);
  if (original.name.records.version.en !== manifest.version || original.name.records.copyright.en !== manifest.copyright) throw new Error("Pinned font name records changed");
  await fs.writeFile(cache, source);
  const glyphs = requiredGlyphs();
  const unsupported = [...glyphs].filter((c) => !original.hasGlyphForCodePoint(c.codePointAt(0)));
  if (unsupported.length) throw new Error(`Pinned font lacks requested characters: ${unsupported.join("")}; choose supported sign text or explicitly review a new font pin`);
  const renamed = renameFont(source, license.toString("utf8"));
  const options = { targetFormat: "woff2", preserveNameIds: [0, 7, 8, 9, 10, 11, 13, 14] };
  // Sequential: a single HarfBuzz/WOFF2 worker under the host's shared lock.
  const variable = await subsetFont(renamed, glyphs, { ...options, variationAxes: { wght: { min: 500, max: 800, default: 500 } } });
  const mobile = await subsetFont(renamed, glyphs, { ...options, variationAxes: { wght: 700 } });
  const mobile600 = await subsetFont(renamed, glyphs, { ...options, variationAxes: { wght: 600 } });
  const mobile800 = await subsetFont(renamed, glyphs, { ...options, variationAxes: { wght: 800 } });
  const inspect = (bytes) => {
    const font = readFont(bytes);
    if (font.familyName !== manifest.family || font.postscriptName !== manifest.postscriptName) throw new Error("Subset family/PostScript alias mismatch");
    if (font.name.records.copyright.en !== manifest.copyright) throw new Error("Subset lost copyright");
    return { bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, brotliBytes: brotliCompressSync(bytes).length, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const outputFont = readFont(variable);
  if (outputFont.variationAxes.wght?.min !== 500 || outputFont.variationAxes.wght?.max !== 800) throw new Error("Subset lost weight range");
  const report = {
    glyphCount: [...glyphs].length,
    sourceBytes: source.length,
    full: inspect(variable),
    mobileStatic700: inspect(mobile),
    mobileStatic600: inspect(mobile600),
    mobileStatic800: inspect(mobile800),
    mobilePairBytes: mobile600.length + mobile800.length,
    unsupportedCodePoints: [],
    loadedByBothTiers: "GTEkiSignJP-subset.woff2",
  };
  const outputs = new Map([
    [path.join(dir, "glyphs.txt"), Buffer.from(glyphs + "\n")],
    [fontFile, variable],
    [path.join(dir, "bytes.json"), Buffer.from(JSON.stringify(report, null, 2) + "\n")],
  ]);
  for (const [name, bytes] of outputs) {
    if (check) {
      const committed = await fs.readFile(name).catch(() => null);
      if (!committed?.equals(bytes)) throw new Error(`${name} is stale; run pnpm fonts:subset`);
    } else {
      await fs.mkdir(path.dirname(name), { recursive: true });
      await fs.writeFile(name, bytes);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Usage: pnpm fonts:subset [--check]");
  await generate(process.argv.includes("--check"));
}
