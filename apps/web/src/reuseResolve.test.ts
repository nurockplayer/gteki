import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isProjectArtFile, loadReuseAnnotations, parseReuseAnnotations, resolveReuse } from "../reuseResolve.ts";
import { outsideStationData, type DiscoveredStation } from "../stations-plugin.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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

const annotation = (paths: string[], copyright: string, license: string) => ({ paths, copyright, license });
const annotations = parseReuseAnnotations(TOML);

describe("parseReuseAnnotations", () => {
  it("reads single and list paths in file order, ignoring comments", () => {
    expect(annotations).toEqual([
      annotation(["**"], "GTEki contributors", "Apache-2.0"),
      annotation(["assets/library/**", "docs/assets/img/**"], "GTEki contributors", "CC-BY-4.0"),
      annotation(["assets/library/vendor/**"], "Vendor Inc.", "LicenseRef-Foo"),
    ]);
  });

  it("ignores a commented-out block", () => {
    expect(parseReuseAnnotations(`# [[annotations]]\n# path = "a"\n[[annotations]]\npath = "b"\nSPDX-License-Identifier = "MIT"\n`)).toEqual([
      annotation(["b"], "", "MIT"),
    ]);
  });

  it("returns nothing for a file with no annotation blocks", () => {
    expect(parseReuseAnnotations("version = 1\n")).toEqual([]);
  });
});

describe("resolveReuse", () => {
  it("returns the last matching annotation, so a later third-party record overrides project art", () => {
    expect(resolveReuse(annotations, "assets/library/vendor/lib.json")).toEqual(annotation(["assets/library/vendor/**"], "Vendor Inc.", "LicenseRef-Foo"));
    const later = parseReuseAnnotations(`[[annotations]]
path = "assets/library/**"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"

[[annotations]]
path = "assets/library/**"
SPDX-FileCopyrightText = "Vendor Inc."
SPDX-License-Identifier = "LicenseRef-Foo"
`);
    expect(resolveReuse(later, "assets/library/manifest.json")?.license).toBe("LicenseRef-Foo");
  });

  it("globs with REUSE semantics: * stays inside one segment, ** crosses /", () => {
    const one = parseReuseAnnotations(`[[annotations]]
path = "assets/library/*"
SPDX-License-Identifier = "MIT"
`);
    expect(resolveReuse(one, "assets/library/manifest.json")?.license).toBe("MIT");
    expect(resolveReuse(one, "assets/library/mobile/manifest.json")).toBeNull();
    const deep = parseReuseAnnotations(`[[annotations]]
path = "assets/library/**"
SPDX-License-Identifier = "MIT"
`);
    expect(resolveReuse(deep, "assets/library/mobile/manifest.json")?.license).toBe("MIT");
    // A bare ** really matches everything, folder or not.
    expect(resolveReuse(annotations, "REUSE.toml")?.license).toBe("Apache-2.0");
    expect(resolveReuse(annotations, "elsewhere/data.json")?.license).toBe("Apache-2.0");
    // A dot is literal, not "any character".
    const dotted = parseReuseAnnotations(`[[annotations]]
path = "assets/library/*.json"
SPDX-License-Identifier = "MIT"
`);
    expect(resolveReuse(dotted, "assets/library/manifest.json")?.license).toBe("MIT");
    expect(resolveReuse(dotted, "assets/library/manifestXjson")).toBeNull();
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
    const mixed = parseReuseAnnotations(`[[annotations]]
path = "assets/library/**"
SPDX-FileCopyrightText = ["GTEki contributors", "国土交通省 Project PLATEAU"]
SPDX-License-Identifier = "CC-BY-4.0"
`);
    expect(isProjectArtFile(mixed, root, at("assets/library/manifest.json"))).toBe(false);
    const both = parseReuseAnnotations(`[[annotations]]
path = "assets/library/**"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0 AND LicenseRef-PLATEAU-site-policy"
`);
    expect(isProjectArtFile(both, root, at("assets/library/manifest.json"))).toBe(false);
  });

  it("fails closed when REUSE.toml cannot be read", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gteki-no-reuse-")));
    expect(loadReuseAnnotations(dir)).toBeNull();
    expect(isProjectArtFile(null, root, at("assets/library/manifest.json"))).toBe(false);
  });
});

describe("outsideStationData with the project-art exemption", () => {
  const root = path.join(path.sep, "repo");
  const at = (rel: string) => path.join(root, ...rel.split("/"));
  const stationFolder = at("stations/alpha");
  const scene = at("stations/alpha/scene/scene.ts");
  const station: DiscoveredStation = { dir: "alpha", folder: stationFolder, gtekiDir: path.join(stationFolder, "gteki"), scene, assets: [] };
  const art = at("assets/library/manifest.json");
  const vendor = at("assets/library/vendor/lib.json");
  const fonts = at("assets/fonts/JP.woff2");
  const graph = new Map([[scene, [art, vendor, fonts]], [art, []], [vendor, []], [fonts, []]]);
  const entries = new Map([["alpha", scene]]);

  it("does not warn about project art, but still warns about anything else under the folder", () => {
    const isProjectArt = (file: string) => isProjectArtFile(annotations, root, file);
    expect(outsideStationData(graph, entries, [station], isProjectArt)).toEqual([`alpha: ${fonts}`, `alpha: ${vendor}`]);
  });

  it("warns about everything when no REUSE text was read (fail closed)", () => {
    const isProjectArt = (file: string) => isProjectArtFile(null, root, file);
    expect(outsideStationData(graph, entries, [station], isProjectArt)).toEqual([`alpha: ${fonts}`, `alpha: ${art}`, `alpha: ${vendor}`]);
  });

  it("exempts nothing without the predicate, as before", () => {
    expect(outsideStationData(graph, entries, [station])).toEqual([`alpha: ${fonts}`, `alpha: ${art}`, `alpha: ${vendor}`]);
  });

  it("keeps warning when only the default Apache-2.0 annotation matches a library file", () => {
    const narrow = parseReuseAnnotations(`[[annotations]]
path = "**"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "Apache-2.0"

[[annotations]]
path = "assets/library/*.json"
SPDX-FileCopyrightText = "GTEki contributors"
SPDX-License-Identifier = "CC-BY-4.0"
`);
    const isProjectArt = (file: string) => isProjectArtFile(narrow, root, file);
    expect(isProjectArt(art)).toBe(true);
    const notes = at("assets/library/deep/notes.txt");
    expect(outsideStationData(new Map([[scene, [notes]], [notes, []]]), entries, [station], isProjectArt)).toEqual([`alpha: ${notes}`]);
  });
});

describe("the real REUSE.toml", () => {
  it("records the two Lane E manifests Shinjuku's kit imports as GTEki CC-BY-4.0", () => {
    const real = parseReuseAnnotations(fs.readFileSync(path.join(REPO, "REUSE.toml"), "utf8"));
    expect(real.length).toBeGreaterThan(0);
    for (const rel of ["assets/library/manifest.json", "assets/library/mobile/manifest.json"]) {
      expect(resolveReuse(real, rel)).toMatchObject({ copyright: "GTEki contributors", license: "CC-BY-4.0" });
      expect(isProjectArtFile(real, REPO, path.join(REPO, rel)), rel).toBe(true);
    }
    // Under the same folder, the AI-generated posters stay CC0 and third-party paths keep their own terms.
    expect(isProjectArtFile(real, REPO, path.join(REPO, "assets/library/source/posters/poster.jpg"))).toBe(false);
    expect(isProjectArtFile(real, REPO, path.join(REPO, "assets/library/source/art2d/batch1.jpg"))).toBe(false);
  });

  it("loads the same annotations from the repo root", () => {
    expect(loadReuseAnnotations(REPO)).toEqual(parseReuseAnnotations(fs.readFileSync(path.join(REPO, "REUSE.toml"), "utf8")));
  });
});
