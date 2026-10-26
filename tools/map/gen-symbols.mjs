// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@babel/parser";

export const repoRoot = path.resolve(import.meta.dirname, "../..");

const SOURCE_ROOTS = ["packages", "apps/web/src", "tools", "stations"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs"]);
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "build", "vendor"]);

const HEADER = "symbol\tkind\tpath\tline";

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function walkFiles(root, pathspecs) {
  // Fallback for checkouts without .git (orb-test copies the worktree without it).
  const files = [];
  const visit = (relDir) => {
    for (const entry of fs.readdirSync(path.join(root, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || EXCLUDED_SEGMENTS.has(entry.name)) continue;
        visit(rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  for (const spec of pathspecs.length ? pathspecs : [""]) visit(spec);
  return files;
}

function trackedFiles(root, pathspecs) {
  try {
    const out = execFileSync("git", ["ls-files", ...pathspecs], { cwd: root, encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return walkFiles(root, pathspecs);
  }
}

function hasExcludedSegment(relPath) {
  return relPath.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function isSourceFile(relPath) {
  const basename = path.posix.basename(relPath);
  if (basename.endsWith(".d.ts")) return false;
  if (basename.includes(".test.") || basename.includes(".spec.")) return false;
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(relPath))) return false;
  return !hasExcludedSegment(relPath);
}

function kindForDeclaration(type) {
  switch (type) {
    case "FunctionDeclaration":
      return "function";
    case "ClassDeclaration":
      return "class";
    case "TSTypeAliasDeclaration":
      return "type";
    case "TSInterfaceDeclaration":
      return "interface";
    case "TSEnumDeclaration":
      return "enum";
    default:
      return null;
  }
}

function rowsForDeclaration(declaration, relPath) {
  if (!declaration) return [];
  const kind = kindForDeclaration(declaration.type);
  if (kind) {
    if (!declaration.id) return [];
    return [[declaration.id.name, kind, relPath, declaration.loc.start.line]];
  }
  if (declaration.type === "VariableDeclaration") {
    const rows = [];
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      rows.push([declarator.id.name, declaration.kind, relPath, declaration.loc.start.line]);
    }
    return rows;
  }
  return [];
}

function sourceRows(root, relPath) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  const plugins = relPath.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins });
  } catch (error) {
    throw new Error(`failed to parse ${relPath}: ${error.message}`);
  }
  const rows = [];
  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration") {
      rows.push(...rowsForDeclaration(node.declaration, relPath));
    } else if (node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;
      if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
        rows.push(...rowsForDeclaration(declaration, relPath));
      }
    }
  }
  return rows;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scriptRows(root, relPath) {
  const text = fs.readFileSync(path.join(root, relPath), "utf8");
  const pkg = JSON.parse(text);
  if (!pkg.scripts || typeof pkg.scripts !== "object") return [];
  const dir = path.posix.dirname(relPath);
  const owner = typeof pkg.name === "string" && pkg.name ? pkg.name : dir;
  const lines = text.split("\n");
  const scriptsLine = lines.findIndex((line) => /"scripts"\s*:/.test(line));
  const rows = [];
  for (const key of Object.keys(pkg.scripts)) {
    let line = 0;
    if (scriptsLine >= 0) {
      const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:`);
      for (let i = scriptsLine; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          line = i + 1;
          break;
        }
      }
    }
    rows.push([`${owner}:${key}`, "script", relPath, line]);
  }
  return rows;
}

/** TSV text for docs/map/symbols.tsv: top-level exports plus package.json scripts. */
export function generateSymbols(root = repoRoot) {
  const rows = [];

  for (const relPath of trackedFiles(root, SOURCE_ROOTS).filter(isSourceFile)) {
    rows.push(...sourceRows(root, relPath));
  }

  const packageFiles = trackedFiles(root, [])
    .filter((relPath) => path.posix.basename(relPath) === "package.json")
    .filter((relPath) => !hasExcludedSegment(relPath));
  for (const relPath of packageFiles) {
    rows.push(...scriptRows(root, relPath));
  }

  rows.sort(
    (a, b) => compare(a[2], b[2]) || a[3] - b[3] || compare(a[0], b[0]),
  );
  return [HEADER, ...rows.map((row) => row.join("\t"))].join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = path.join(repoRoot, "docs/map/symbols.tsv");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generateSymbols(repoRoot));
}
