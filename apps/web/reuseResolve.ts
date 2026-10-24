import fs from "node:fs";
import path from "node:path";

/**
 * A tiny reader for the repo's REUSE.toml (`[[annotations]]`), enough for the inline data gate.
 * Every annotation in this repo uses `precedence = "override"`, so for one path the LAST matching
 * annotation wins; that is what `resolveReuse` returns.
 *
 * The gate only ever exempts a file, so the parser fails closed: it returns null instead of guessing
 * whenever the text uses a construct it does not fully handle (multi-line strings, other table
 * headers, inline tables, `\u`/`\U` escapes, unreadable values, a block without `path`, or a
 * precedence other than "override"). No TOML dependency is pulled in for this.
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

type TomlValue =
  | { kind: "string"; value: string }
  | { kind: "array"; items: TomlValue[] }
  | { kind: "other" };

interface Cursor {
  readonly text: string;
  i: number;
}

/** TOML basic-string escapes the parser handles; `\u`/`\U` and anything else are refused. */
const BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\",
};

/** Skip spaces, tabs and `#` comments; newlines too when `newlines` is true. */
function skip(c: Cursor, newlines: boolean): void {
  for (;;) {
    const ch = c.text[c.i];
    if (ch === undefined) return;
    if (ch === " " || ch === "\t") { c.i++; continue; }
    if (newlines && (ch === "\n" || ch === "\r")) { c.i++; continue; }
    if (ch === "#") { while (c.i < c.text.length && c.text[c.i] !== "\n") c.i++; continue; }
    return;
  }
}

/** A bare TOML key; quoted keys and dotted keys are not supported, so the parser refuses them. */
function readKey(c: Cursor): string | null {
  const start = c.i;
  while (c.i < c.text.length && /[A-Za-z0-9_-]/.test(c.text[c.i]!)) c.i++;
  return c.i === start ? null : c.text.slice(start, c.i);
}

/** A basic string (`"…"`, with escapes) or literal string (`'…'`, no escapes); multi-line forms are refused. */
function readString(c: Cursor, quote: '"' | "'"): TomlValue | null {
  if (c.text[c.i + 1] === quote && c.text[c.i + 2] === quote) return null;
  c.i++;
  let value = "";
  for (;;) {
    const ch = c.text[c.i];
    if (ch === undefined || ch === "\n" || ch === "\r") return null;
    if (ch === quote) { c.i++; return { kind: "string", value }; }
    if (quote === '"' && ch === "\\") {
      const escaped = c.text[c.i + 1];
      const decoded = escaped === undefined ? undefined : BASIC_ESCAPES[escaped];
      if (decoded === undefined) return null;
      value += decoded;
      c.i += 2;
      continue;
    }
    value += ch;
    c.i++;
  }
}

function readArray(c: Cursor): TomlValue | null {
  c.i++;
  const items: TomlValue[] = [];
  for (;;) {
    skip(c, true);
    const ch = c.text[c.i];
    if (ch === undefined) return null;
    if (ch === "]") { c.i++; return { kind: "array", items }; }
    const item = readValue(c);
    if (!item) return null;
    items.push(item);
    skip(c, true);
    const separator = c.text[c.i];
    if (separator === ",") { c.i++; continue; }
    if (separator === "]") { c.i++; return { kind: "array", items }; }
    return null;
  }
}

function readValue(c: Cursor): TomlValue | null {
  skip(c, false);
  const ch = c.text[c.i];
  if (ch === undefined) return null;
  if (ch === '"' || ch === "'") return readString(c, ch);
  if (ch === "[") return readArray(c);
  if (ch === "{") return null; // inline table: not supported
  const start = c.i;
  while (c.i < c.text.length) {
    const x = c.text[c.i]!;
    if (x === "\n" || x === "\r" || x === "#" || x === "," || x === "]") break;
    c.i++;
  }
  return c.text.slice(start, c.i).trim() === "" ? null : { kind: "other" };
}

/** A non-empty string or list of strings, or null when the value is anything else. */
function stringList(value: TomlValue): string[] | null {
  const items = value.kind === "string" ? [value] : value.kind === "array" ? value.items : null;
  if (!items) return null;
  const strings: string[] = [];
  for (const item of items) {
    if (item.kind !== "string") return null;
    strings.push(item.value);
  }
  return strings.length ? strings : null;
}

interface Draft {
  paths: string[] | null;
  copyright: string[] | null;
  license: string[] | null;
  precedence: string | null;
  keys: Set<string>;
}

const KNOWN_KEYS = new Set(["path", "SPDX-FileCopyrightText", "SPDX-License-Identifier", "precedence"]);

/**
 * `[[annotations]]` blocks in file order, with comments ignored — or null when the text holds
 * anything this parser does not fully understand, so the caller exempts nothing.
 */
export function parseReuseAnnotations(tomlText: string): ReuseAnnotation[] | null {
  const c: Cursor = { text: tomlText, i: 0 };
  const annotations: ReuseAnnotation[] = [];
  let current: Draft | null = null;
  const finish = (): boolean => {
    if (!current) return true;
    // The caller resolves a path by "the last matching annotation wins", which is only correct for override.
    if (current.precedence !== "override" || !current.paths) return false;
    annotations.push({
      paths: current.paths,
      copyright: (current.copyright ?? []).join(" AND "),
      license: (current.license ?? []).join(" AND "),
    });
    return true;
  };

  for (;;) {
    skip(c, true);
    if (c.i >= c.text.length) break;
    if (c.text[c.i] === "[") {
      const start = c.i;
      while (c.i < c.text.length && c.text[c.i] !== "\n" && c.text[c.i] !== "#") c.i++;
      // Any other table header (sub-tables, [annotations]) is unsupported.
      if (c.text.slice(start, c.i).trim() !== "[[annotations]]") return null;
      if (!finish()) return null;
      current = { paths: null, copyright: null, license: null, precedence: null, keys: new Set() };
      continue;
    }
    const key = readKey(c);
    if (key === null) return null;
    skip(c, false);
    if (c.text[c.i] !== "=") return null;
    c.i++;
    const value = readValue(c);
    if (!value) return null;
    skip(c, false);
    const after = c.text[c.i];
    if (after !== undefined && after !== "\n" && after !== "\r") return null;
    if (current === null) continue; // a top-level key such as version = 1
    if (!KNOWN_KEYS.has(key)) continue;
    if (current.keys.has(key)) return null;
    current.keys.add(key);
    if (key === "precedence") {
      if (value.kind !== "string") return null;
      current.precedence = value.value;
      continue;
    }
    const strings = stringList(value);
    if (!strings) return null;
    if (key === "path") current.paths = strings;
    else if (key === "SPDX-FileCopyrightText") current.copyright = strings;
    else current.license = strings;
  }
  if (!finish()) return null;
  return annotations;
}

const escapeRe = (ch: string): string => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `glob` as an anchored regular expression source, with REUSE (fnmatch) semantics: a double star
 * crosses `/`, and one immediately before a slash also matches zero directories (so `a` + `/**` + `/b`
 * matches `a/b`); a single star stays within one segment; `\` makes the next character literal; and
 * everything else is literal.
 */
function globSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "\\" && i + 1 < glob.length) { out += escapeRe(glob[++i]!); continue; }
    if (ch !== "*") { out += escapeRe(ch); continue; }
    if (glob[i + 1] !== "*") { out += "[^/]*"; continue; }
    i++;
    if (glob[i + 1] === "/") { i++; out += "(?:.*/)?"; }
    else out += ".*";
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

/**
 * Whether a module Vite reports is project art. Both the reported path and its real path must be under
 * `assets/library/` and resolve to project art: a symlink may not borrow the library's licence, and a
 * path whose realpath cannot be resolved is not exempt.
 */
export function isProjectArtModule(
  annotations: readonly ReuseAnnotation[] | null,
  repoRoot: string,
  filePath: string,
  realpath: (file: string) => string = (file) => fs.realpathSync(file),
): boolean {
  if (!isProjectArtFile(annotations, repoRoot, filePath)) return false;
  let real: string;
  try { real = realpath(filePath); } catch { return false; }
  return isProjectArtFile(annotations, repoRoot, real);
}

/**
 * The repo's REUSE annotations, read once per build, or null when REUSE.toml cannot be read or the
 * parser refuses its text — in both cases nothing is exempt.
 */
export function loadReuseAnnotations(repoRoot: string): ReuseAnnotation[] | null {
  try {
    const text = fs.readFileSync(fs.realpathSync(path.join(repoRoot, "REUSE.toml")), "utf8");
    return parseReuseAnnotations(text);
  } catch {
    return null;
  }
}
