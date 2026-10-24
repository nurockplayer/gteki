import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isProjectArtFile, isProjectArtModule, loadReuseAnnotations, parseReuseAnnotations, resolveReuse } from "../reuseResolve.ts";
import { outsideStationData, type DiscoveredStation } from "../stations-plugin.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Parse text the parser is expected to understand. */
function parse(text: string) {
  const annotations = parseReuseAnnotations(text);
  expect(annotations).not.toBeNull();
  return annotations!;
}

const annotation = (paths: string[], copyright: string, license: string) => ({ paths, copyright, license });
const block = (body: string, precedence = '"override"') => `[[annotations]]\nprecedence = ${precedence}\n${body}\n`;
const withGlob = (glob: string) => parse(block(`path = ${glob}\nSPDX-License-Identifier = "MIT"`));

/** A small REUSE.toml in the repo's shape: default first, project art next, third-party last. */
const TOML = `
version = 1

# --- default ---
[[annotations]]
path = "**"
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "Apache-2.0"

# --- project art: a list spanning lines, and a comment inside the array ---
[[annotations]]
path = [
  "assets/library/**",   # Lane E original art
  "docs/assets/img/**",
]
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"

# --- third-party material placed in the library later ---
[[annotations]]
path = "assets/library/vendor/**"
precedence = "override"
SPDX-FileCopyrightText = "Vendor Inc."
SPDX-License-Identifier = "LicenseRef-Foo"
`;

const annotations = parse(TOML);

describe("parseReuseAnnotations", () => {
  it("reads single and list paths in file order, ignoring comments", () => {
    expect(annotations).toEqual([
      annotation(["**"], "GTEki contributors", "Apache-2.0"),
      annotation(["assets/library/**", "docs/assets/img/**"], "GTEki contributors", "CC-BY-4.0"),
      annotation(["assets/library/vendor/**"], "Vendor Inc.", "LicenseRef-Foo"),
    ]);
  });

  it("supports single-quoted literal strings, and they take part in last-wins", () => {
    const literal = parse(`
[[annotations]]
path = 'assets/library/**'
precedence = 'override'
SPDX-FileCopyrightText = 'GTEki contributors'
SPDX-License-Identifier = 'CC-BY-4.0'

[[annotations]]
path = ['assets/library/vendor/**']
precedence = 'override'
SPDX-FileCopyrightText = 'Vendor Inc.'
SPDX-License-Identifier = 'LicenseRef-Foo'
`);
    expect(literal[0]).toEqual(annotation(["assets/library/**"], "GTEki contributors", "CC-BY-4.0"));
    expect(resolveReuse(literal, "assets/library/vendor/lib.json")).toEqual(annotation(["assets/library/vendor/**"], "Vendor Inc.", "LicenseRef-Foo"));
    expect(resolveReuse(literal, "assets/library/manifest.json")?.license).toBe("CC-BY-4.0");
  });

  it("ignores a commented-out block", () => {
    expect(parse(`# [[annotations]]\n# path = "a"\n${block('path = "b"\nSPDX-License-Identifier = "MIT"')}`)).toEqual([
      annotation(["b"], "", "MIT"),
    ]);
  });

  it("returns nothing for a file with no annotation blocks", () => {
    expect(parseReuseAnnotations("version = 1\n")).toEqual([]);
  });

  it("returns null, so nothing is exempt, for a construct it does not fully understand", () => {
    const refused: [string, string][] = [
      ["a multi-line basic string", block(`path = """assets/library/**"""`)],
      ["a multi-line literal string", block(`path = '''assets/library/**'''`)],
      ["a sub-table header", `${block('path = "**"')}[annotations.meta]\nkey = 1\n`],
      ["another table header", `[annotations]\npath = "**"\n`],
      ["an inline table value", block(`path = { glob = "assets/library/**" }`)],
      ["a \\u escape", block(String.raw`path = "assets/library/\u0041*"`)],
      ["a \\U escape", block(String.raw`path = "assets/library/\U00000041*"`)],
      ["an unknown escape", block(String.raw`path = "assets/library/\q*"`)],
      ["an unreadable path", block("path = 42")],
      ["a non-string in a path list", block(`path = ["assets/library/**", 7]`)],
      ["an empty path list", block("path = []")],
      ["an unreadable copyright", block('path = "assets/library/**"\nSPDX-FileCopyrightText = 42')],
      ["an unreadable licence", block('path = "assets/library/**"\nSPDX-License-Identifier = ["CC-BY-4.0", 1]')],
      ["a block with no path", block('SPDX-License-Identifier = "CC-BY-4.0"')],
      ["a precedence other than override", block('path = "**"', '"aggregate"')],
      ["an unterminated array", block('path = ["assets/library/**"')],
      ["a key with no value", block("path =")],
      ["a duplicate path", block('path = "a"\npath = "b"')],
    ];
    for (const [name, text] of refused) expect(parseReuseAnnotations(text), name).toBeNull();
  });
});

describe("resolveReuse", () => {
  it("returns the last matching annotation, so a later third-party record overrides project art", () => {
    expect(resolveReuse(annotations, "assets/library/vendor/lib.json")).toEqual(annotation(["assets/library/vendor/**"], "Vendor Inc.", "LicenseRef-Foo"));
    const later = parse(`[[annotations]]
path = "assets/library/**"
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"

[[annotations]]
path = "assets/library/**"
precedence = "override"
SPDX-FileCopyrightText = "Vendor Inc."
SPDX-License-Identifier = "LicenseRef-Foo"
`);
    expect(resolveReuse(later, "assets/library/manifest.json")?.license).toBe("LicenseRef-Foo");
  });

  it("globs with REUSE semantics: * stays inside one segment, ** crosses /", () => {
    const one = withGlob('"assets/library/*"');
    expect(resolveReuse(one, "assets/library/manifest.json")?.license).toBe("MIT");
    expect(resolveReuse(one, "assets/library/mobile/manifest.json")).toBeNull();
    const deep = withGlob('"assets/library/**"');
    expect(resolveReuse(deep, "assets/library/mobile/manifest.json")?.license).toBe("MIT");
    // A bare ** really matches everything, folder or not.
    expect(resolveReuse(annotations, "REUSE.toml")?.license).toBe("Apache-2.0");
    expect(resolveReuse(annotations, "elsewhere/data.json")?.license).toBe("Apache-2.0");
    // A dot is literal, not "any character".
    const dotted = withGlob('"assets/library/*.json"');
    expect(resolveReuse(dotted, "assets/library/manifest.json")?.license).toBe("MIT");
    expect(resolveReuse(dotted, "assets/library/manifestXjson")).toBeNull();
  });

  it("matches zero directories with **/, so a/**/b matches a/b", () => {
    const zero = withGlob('"a/**/b"');
    expect(resolveReuse(zero, "a/b")?.license).toBe("MIT");
    expect(resolveReuse(zero, "a/x/b")?.license).toBe("MIT");
    expect(resolveReuse(zero, "a/x/y/b")?.license).toBe("MIT");
    expect(resolveReuse(zero, "a/x/b/c")).toBeNull();
  });

  it("treats \\* as a literal asterisk", () => {
    const literal = withGlob(String.raw`'assets/library/lit\*eral.json'`);
    expect(resolveReuse(literal, "assets/library/lit*eral.json")?.license).toBe("MIT");
    expect(resolveReuse(literal, "assets/library/literal.json")).toBeNull();
    // The same glob in a basic string spells the backslash twice.
    expect(resolveReuse(withGlob(String.raw`"assets/library/lit\\*eral.json"`), "assets/library/lit*eral.json")?.license).toBe("MIT");
  });

  it("lets a third-party **/vendor/*.json override win over project art at any depth", () => {
    const override = parse(`[[annotations]]
path = "assets/library/**"
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"

[[annotations]]
path = "assets/library/**/vendor/*.json"
precedence = "override"
SPDX-FileCopyrightText = "Vendor Inc."
SPDX-License-Identifier = "LicenseRef-Foo"
`);
    expect(resolveReuse(override, "assets/library/vendor/x.json")?.license).toBe("LicenseRef-Foo");
    expect(resolveReuse(override, "assets/library/deep/vendor/x.json")?.license).toBe("LicenseRef-Foo");
    expect(resolveReuse(override, "assets/library/vendor/deep/x.json")?.license).toBe("CC-BY-4.0");
    expect(resolveReuse(override, "assets/library/manifest.json")?.license).toBe("CC-BY-4.0");
  });

  it("returns null when nothing matches", () => {
    expect(resolveReuse([annotation(["docs/**"], "GTEki contributors", "CC-BY-4.0")], "assets/library/manifest.json")).toBeNull();
  });
});

describe("isProjectArtFile", () => {
  const root = path.join(path.sep, "repo");
  const at = (rel: string) => path.join(root, ...rel.split("/"));

  it("accepts only a file under assets/library/ recorded as GTEki CC-BY-4.0", () => {
    expect(isProjectArtFile(annotations, root, at("assets/library/manifest.json"))).toBe(true);
    expect(isProjectArtFile(annotations, root, at("assets/library/mobile/manifest.json"))).toBe(true);
    // A third-party file under the same folder keeps its own record, so it is not exempt.
    expect(isProjectArtFile(annotations, root, at("assets/library/vendor/lib.json"))).toBe(false);
    // Project-authored art outside the library is still a finding for this gate.
    expect(isProjectArtFile(annotations, root, at("docs/assets/img/hero.jpg"))).toBe(false);
  });

  it("does not accept a mixed copyright or a licence that only partly matches", () => {
    const mixed = parse(block('path = "assets/library/**"\nSPDX-FileCopyrightText = ["GTEki contributors", "国土交通省 Project PLATEAU"]\nSPDX-License-Identifier = "CC-BY-4.0"'));
    expect(isProjectArtFile(mixed, root, at("assets/library/manifest.json"))).toBe(false);
    const both = parse(block('path = "assets/library/**"\nSPDX-FileCopyrightText = "GTEki contributors"\nSPDX-License-Identifier = "CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy"'));
    expect(isProjectArtFile(both, root, at("assets/library/manifest.json"))).toBe(false);
  });

  it("fails closed when REUSE.toml cannot be read", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-no-reuse-")));
    expect(loadReuseAnnotations(dir)).toBeNull();
    expect(isProjectArtFile(null, root, at("assets/library/manifest.json"))).toBe(false);
  });
});

describe("isProjectArtModule", () => {
  const root = path.join(path.sep, "repo");
  const at = (rel: string) => path.join(root, ...rel.split("/"));
  const art = at("assets/library/manifest.json");

  it("exempts only when both the reported path and its real path are project art", () => {
    expect(isProjectArtModule(annotations, root, art, () => art)).toBe(true);
    expect(isProjectArtModule(annotations, root, art, () => at("assets/library/mobile/manifest.json"))).toBe(true);
    expect(isProjectArtModule(annotations, root, art)).toBe(false); // the synthetic path does not exist
  });

  it("does not exempt a real path that leaves the library or keeps third-party terms", () => {
    expect(isProjectArtModule(annotations, root, art, () => at("assets/library/vendor/lib.json"))).toBe(false);
    expect(isProjectArtModule(annotations, root, art, () => at("docs/assets/img/hero.jpg"))).toBe(false);
    expect(isProjectArtModule(annotations, root, art, () => path.join(path.sep, "elsewhere", "manifest.json"))).toBe(false);
  });

  it("does not exempt a symlink outside the library that points at project art", () => {
    const link = at("stations/alpha/scene/manifest.json");
    expect(isProjectArtModule(annotations, root, link, () => art)).toBe(false);
  });

  it("does not exempt anything when realpath fails or no REUSE text was read", () => {
    expect(isProjectArtModule(annotations, root, art, () => { throw new Error("ENOENT"); })).toBe(false);
    expect(isProjectArtModule(null, root, art, () => art)).toBe(false);
  });
});

describe("outsideStationData with the project-art exemption", () => {
  const root = path.join(path.sep, "repo");
  const at = (rel: string) => path.join(root, ...rel.split("/"));
  const stationFolder = at("stations/alpha");
  const scene = at("stations/alpha/scene/scene.ts");
  const station: DiscoveredStation = { dir: "alpha", folder: stationFolder, gtekiDir: path.join(stationFolder, "gteki"), scene, tenants: null, assets: [] };
  const art = at("assets/library/manifest.json");
  const vendor = at("assets/library/vendor/lib.json");
  const fonts = at("assets/fonts/JP.woff2");
  const graph = new Map([[scene, [art, vendor, fonts]], [art, []], [vendor, []], [fonts, []]]);
  const entries = new Map([["alpha", scene]]);
  const identity = (file: string) => file;

  it("does not warn about project art, but still warns about anything else under the folder", () => {
    const isProjectArt = (file: string) => isProjectArtModule(annotations, root, file, identity);
    expect(outsideStationData(graph, entries, [station], isProjectArt)).toEqual([`alpha: ${fonts}`, `alpha: ${vendor}`]);
  });

  it("warns about everything when no REUSE text was read (fail closed)", () => {
    const isProjectArt = (file: string) => isProjectArtModule(null, root, file, identity);
    expect(outsideStationData(graph, entries, [station], isProjectArt)).toEqual([`alpha: ${fonts}`, `alpha: ${art}`, `alpha: ${vendor}`]);
  });

  it("exempts nothing without the predicate, as before", () => {
    expect(outsideStationData(graph, entries, [station])).toEqual([`alpha: ${fonts}`, `alpha: ${art}`, `alpha: ${vendor}`]);
  });

  it("keeps warning when only the default Apache-2.0 annotation matches a library file", () => {
    const narrow = parse(`[[annotations]]
path = "**"
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "Apache-2.0"

[[annotations]]
path = "assets/library/*.json"
precedence = "override"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"
`);
    const isProjectArt = (file: string) => isProjectArtModule(narrow, root, file, identity);
    expect(isProjectArt(art)).toBe(true);
    const notes = at("assets/library/deep/notes.txt");
    expect(outsideStationData(new Map([[scene, [notes]], [notes, []]]), entries, [station], isProjectArt)).toEqual([`alpha: ${notes}`]);
  });
});

describe("the real REUSE.toml", () => {
  it("records the two Lane E manifests Shinjuku's kit imports as GTEki CC-BY-4.0", () => {
    const real = parse(fs.readFileSync(path.join(REPO, "REUSE.toml"), "utf8"));
    expect(real.length).toBeGreaterThan(0);
    for (const rel of ["assets/library/manifest.json", "assets/library/mobile/manifest.json"]) {
      expect(resolveReuse(real, rel)).toMatchObject({ copyright: "GTEki contributors", license: "CC-BY-4.0" });
      expect(isProjectArtFile(real, REPO, path.join(REPO, rel)), rel).toBe(true);
      expect(isProjectArtModule(real, REPO, path.join(REPO, rel)), rel).toBe(true);
    }
    // Under the same folder, the AI-generated posters stay CC0 and third-party paths keep their own terms.
    expect(isProjectArtFile(real, REPO, path.join(REPO, "assets/library/source/posters/poster.jpg"))).toBe(false);
    expect(isProjectArtFile(real, REPO, path.join(REPO, "assets/library/source/art2d/batch1.jpg"))).toBe(false);
  });

  it("loads the same annotations from the repo root", () => {
    expect(loadReuseAnnotations(REPO)).toEqual(parse(fs.readFileSync(path.join(REPO, "REUSE.toml"), "utf8")));
  });
});
