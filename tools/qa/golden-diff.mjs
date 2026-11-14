#!/usr/bin/env node
// Compare golden camera PNGs: node golden-diff.mjs <base> <head> <out> --cameras <json>
// Writes diff.json and up to eight base | head | mask pictures for review.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const [baseDir, headDir, outDir, flag, camerasFile] = process.argv.slice(2);
if (!baseDir || !headDir || !outDir || flag !== "--cameras" || !camerasFile) throw new Error("usage: golden-diff.mjs <base> <head> <out> --cameras <json>");
const cameras = JSON.parse(fs.readFileSync(camerasFile, "utf8")).cameras;
const files = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
const ids = [...new Set([...files(baseDir), ...files(headDir)])].sort();
const read = (dir, id) => {
  const file = path.join(dir, `${id}.png`);
  return fs.existsSync(file) ? PNG.sync.read(fs.readFileSync(file)) : null;
};
fs.mkdirSync(outDir, { recursive: true });
const entries = ids.map((camera) => {
  const base = read(baseDir, camera), head = read(headDir, camera);
  const width = Math.max(base?.width ?? 0, head?.width ?? 0);
  const height = Math.max(base?.height ?? 0, head?.height ?? 0);
  const mismatch = !base || !head || base.width !== head.width || base.height !== head.height;
  const mask = new PNG({ width, height });
  let count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const different = mismatch || [0, 1, 2, 3].some((c) => Math.abs(base.data[i + c] - head.data[i + c]) > 24);
    if (different) count++;
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = different ? 255 : 0;
    mask.data[i + 3] = 255;
  }
  const diffRatio = count / (width * height);
  return { camera, expect: cameras.find((c) => c.id === camera)?.expect ?? "", diffRatio, changed: diffRatio > 0.01, base, head, mask, width, height };
});
fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify(entries.map(({ camera, expect, diffRatio, changed }) => ({ camera, expect, diffRatio, changed })), null, 2) + "\n");
const changed = entries.filter((e) => e.changed).sort((a, b) => b.diffRatio - a.diffRatio || a.camera.localeCompare(b.camera));
for (const e of changed.slice(0, 8)) {
  let image = new PNG({ width: e.width * 3, height: e.height });
  for (const [panel, source] of [e.base, e.head, e.mask].entries()) {
    if (source) PNG.bitblt(source, image, 0, 0, source.width, source.height, panel * e.width, 0);
  }
  let data = PNG.sync.write(image);
  while (data.length > 8 * 1024 * 1024) {
    const scaled = new PNG({ width: Math.max(1, Math.floor(image.width / 2)), height: Math.max(1, Math.floor(image.height / 2)) });
    for (let y = 0; y < scaled.height; y++) for (let x = 0; x < scaled.width; x++) {
      const from = ((y * 2) * image.width + x * 2) * 4, to = (y * scaled.width + x) * 4;
      image.data.copy(scaled.data, to, from, from + 4);
    }
    image = scaled;
    data = PNG.sync.write(image);
  }
  fs.writeFileSync(path.join(outDir, `${e.camera}.png`), data);
}
for (const e of changed) console.log(`${e.camera} ${e.diffRatio}`);
const ratios = entries.map((e) => e.diffRatio).sort((a, b) => a - b);
const middle = Math.floor(ratios.length / 2);
const median = ratios.length ? (ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2) : 0;
console.log(`changed: ${changed.length}; max: ${ratios.at(-1) ?? 0}; median: ${median}`);
