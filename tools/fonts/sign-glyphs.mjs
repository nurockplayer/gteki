// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

/** Deliberately conservative: all JSON string values and TS literal/template text,
 * including non-sign metadata. No execution, regex literal parsing, or station writes. */
export function requiredGlyphs(root = repoRoot) {
  const chars = new Set();
  const add = (text) => { for (const c of text) if (!/[\p{Cc}\p{Cf}]/u.test(c)) chars.add(c); };
  const range = (lo, hi) => { for (let n = lo; n <= hi; n++) add(String.fromCodePoint(n)); };
  range(0x20, 0x7e); // Printable ASCII.
  range(0x3000, 0x303f); // CJK symbols and punctuation.
  range(0x3041, 0x3096); range(0x3099, 0x30ff); // Assigned hiragana/katakana, including ー.
  range(0xff01, 0xff60); range(0xff61, 0xff9f); // Fullwidth ASCII and halfwidth kana.
  range(0xffe0, 0xffe6); // Fullwidth forms.
  add("←↑→↓↔↕↖↗↘↙⇒⇔⇦⇧⇨⇩★☆○●◎◇◆□■△▲▽▼※〒〓");
  const visitJson = (value) => {
    if (typeof value === "string") add(value);
    else if (Array.isArray(value)) value.forEach(visitJson);
    else if (value && typeof value === "object") Object.values(value).forEach(visitJson);
  };
  for (const station of fs.readdirSync(path.join(root, "stations"), { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const dir = path.join(root, "stations", station.name);
    const manifest = path.join(dir, "gteki/station.json");
    if (fs.existsSync(manifest)) visitJson(JSON.parse(fs.readFileSync(manifest, "utf8")));
    const scene = path.join(dir, "scene");
    if (!fs.existsSync(scene)) continue;
    for (const file of fs.readdirSync(scene).sort()) {
      const full = path.join(scene, file);
      if (file.endsWith(".json")) visitJson(JSON.parse(fs.readFileSync(full, "utf8")));
      else if (file.endsWith(".ts")) {
        const source = parse(fs.readFileSync(full, "utf8"), { sourceType: "module", plugins: ["typescript"] });
        const visit = (node) => {
          if (!node || typeof node !== "object") return;
          if (node.type === "StringLiteral") add(node.value);
          if (node.type === "TemplateElement") add(node.value.cooked ?? node.value.raw);
          for (const [key, value] of Object.entries(node)) {
            if (["loc", "start", "end", "extra", "comments", "leadingComments", "trailingComments", "innerComments", "tokens"].includes(key)) continue;
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
          }
        };
        visit(source);
      }
    }
  }
  return [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join("");
}

export function assertGlyphCoverage(required, committed) {
  const available = new Set(committed);
  const missing = [...required].filter((c) => !available.has(c));
  if (missing.length) throw new Error(`Sign font glyphs missing ${missing.join("")}; run pnpm fonts:subset`);
}
