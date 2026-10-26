// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSymbols, repoRoot } from "./gen-symbols.mjs";

const mapDir = path.join(repoRoot, "docs/map");
const INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g;
const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const SKIPPED_CHARS = ["*", "<", ">", "{", "}", "$"];

/** Lines outside fenced code blocks, joined per file. */
function proseLines(text) {
  const lines = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line);
  }
  return lines;
}

/** Repo-relative path a backticked token refers to, or null when it is not a path reference. */
function referencedPath(token) {
  if (!token.includes("/")) return null;
  if (/\s/.test(token)) return null;
  if (token.startsWith("http")) return null;
  if (SKIPPED_CHARS.some((char) => token.includes(char))) return null;
  return token.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");
}

describe("docs/map references", () => {
  it("every referenced path and wiki link exists", () => {
    const failures = [];
    const files = fs.readdirSync(mapDir).filter((name) => name.endsWith(".md")).sort();
    for (const name of files) {
      const text = fs.readFileSync(path.join(mapDir, name), "utf8");
      for (const line of proseLines(text)) {
        for (const match of line.matchAll(INLINE_CODE)) {
          const candidate = referencedPath(match[1]);
          if (candidate === null) continue;
          if (!fs.existsSync(path.join(repoRoot, candidate))) failures.push(`${name}: ${match[1]}`);
        }
        for (const match of line.matchAll(WIKI_LINK)) {
          const target = `docs/map/${match[1].trim()}.md`;
          if (!fs.existsSync(path.join(repoRoot, target))) failures.push(`${name}: ${match[0]}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("docs/map/symbols.tsv", () => {
  it("matches the generator output", () => {
    const actual = fs.readFileSync(path.join(mapDir, "symbols.tsv"), "utf8");
    expect(generateSymbols(repoRoot), "docs/map/symbols.tsv is stale; run pnpm map:gen").toBe(actual);
  });
});
