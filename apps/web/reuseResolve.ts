import fs from "node:fs";
import path from "node:path";

/**
 * A tiny reader for the repo's REUSE.toml (`[[annotations]]`), enough for the inline data gate.
 * Every annotation in this repo uses `precedence = "override"`, so for one path the LAST matching
 * annotation wins; that is what `resolveReuse` returns. Only `*` (does not cross `/`) and `**`
 * (does) are globbed; any other character is literal. No TOML dependency is pulled in for this.
 */
export interface ReuseAnnotation {
  paths: string[];
  /** Multi-valued `SPDX-FileCopyrightText` entries joined with " AND ", so a mixed value never equals the project-art one. */
  copyright: string;
  /** Same joining as `copyright` for a multi-valued `SPDX-License-Identifier`. */
  license: string;
}

/** Lane E project art is recorded as this exact copyright holder and licence (REUSE.toml header, Issue #123). */
export const PROJECT_ART_COPYRIGHT = "GTEki contributors";
export const PROJECT_ART_LICENSE = "CC-BY-4.0";
/** The only folder whose files a project-art record may exempt; a bare path is never allowlisted. */
export const PROJECT_ART_DIR = "assets/library/";

const ANNOTATIONS_HEADER = /^[ \t]*\[\[annotations\]\][ \t]*$/m;

/** Remove `#` comments outside double-quoted strings, keeping line structure. */
function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      out += ch;
      for (i++; i < text.length; i++) {
        out += text[i]!;
        if (text[i] === "\\") { out += text[++i] ?? ""; continue; }
        if (text[i] === '"') break;
      }
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

const tomlString = (raw: string): string => raw.replace(/\\(["\\])/g, "$1");

/** Index of the `]` closing an array that starts at `text[0] === "["`, ignoring brackets inside strings. */
function closingBracket(text: string): number {
  let inString = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "]") return i;
  }
  return text.length;
}

/** A key's value as a list of strings: `key = "x"`, `key = ["a", "b"]`, or a multi-line array. */
function readStrings(block: string, key: string): string[] {
  const match = new RegExp(`^[ \\t]*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*=[ \\t]*`, "m").exec(block);
  if (!match) return [];
  const rest = block.slice(match.index + match[0].length).replace(/^[ \t]*/, "");
  const body = rest.startsWith("[")
    ? rest.slice(1, closingBracket(rest))
    : (/^\s*"(?:\\.|[^"\\])*"/.exec(rest)?.[0] ?? "");
  return [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => tomlString(m[1]!));
}

/** `[[annotations]]` blocks in file order; comments are ignored, and a missing key becomes an empty value. */
export function parseReuseAnnotations(tomlText: string): ReuseAnnotation[] {
  return stripComments(tomlText)
    .split(ANNOTATIONS_HEADER)
    .slice(1)
    .map((block) => ({
      paths: readStrings(block, "path"),
      copyright: readStrings(block, "SPDX-FileCopyrightText").join(" AND "),
      license: readStrings(block, "SPDX-License-Identifier").join(" AND "),
    }));
}

/** `glob` as an anchored regular expression source: `**` crosses `/`, `*` does not, everything else is literal. */
function globSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i++; }
      else out += "[^/]*";
    } else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return `^${out}$`;
}

/** The last annotation matching a repo-relative POSIX path (all annotations are `override`), or null. */
export function resolveReuse(
  annotations: readonly ReuseAnnotation[],
  repoRelPath: string,
): ReuseAnnotation | null {
  const file = repoRelPath.replace(/\\/g, "/").replace(/^\.\//, "");
  let found: ReuseAnnotation | null = null;
  for (const annotation of annotations) {
    if (annotation.paths.some((glob) => new RegExp(globSource(glob)).test(file))) found = annotation;
  }
  return found;
}

/**
 * True only when `filePath` lies under `<repoRoot>/assets/library/` and REUSE records it, by the last
 * matching annotation, as project-authored art (copyright "GTEki contributors", licence "CC-BY-4.0").
 * Anything else — a third-party file placed there later, a partially matching record, or no annotations
 * at all — is not exempt, so `outsideStationData` keeps warning about it.
 */
export function isProjectArtFile(
  annotations: readonly ReuseAnnotation[] | null,
  repoRoot: string,
  filePath: string,
): boolean {
  if (!annotations) return false;
  const rel = path.relative(repoRoot, filePath).split(path.sep).join("/");
  if (!rel.startsWith(PROJECT_ART_DIR)) return false;
  const annotation = resolveReuse(annotations, rel);
  return annotation?.copyright === PROJECT_ART_COPYRIGHT && annotation.license === PROJECT_ART_LICENSE;
}

/** The repo's REUSE annotations, read once per build, or null when REUSE.toml cannot be read (fail closed). */
export function loadReuseAnnotations(repoRoot: string): ReuseAnnotation[] | null {
  try {
    return parseReuseAnnotations(fs.readFileSync(fs.realpathSync(path.join(repoRoot, "REUSE.toml")), "utf8"));
  } catch {
    return null;
  }
}
