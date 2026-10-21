# Facts-only credit wording (#122, from the #26 decision)

Lane D preparation for https://github.com/nurockplayer/gteki/issues/122. Lane D owns only `docs/gis/**` and `tools/gis/**`, so this file is a record plus **proposals** for core (`packages/schema/**`), Lane C (`apps/web/**`) and the Ikebukuro station lead (`stations/ikebukuro/**`). Nothing outside `docs/gis/**` was edited.

Status: **proposal, not applied.** Sources of every statement are named; where a record is missing it says UNKNOWN.

## 1. The rule

- **Decision:** https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404 (node id `IC_kwDOVQtatc8AAAABd60OXA`), posted by `nurockplayer` at 2026-10-20T22:05:04Z. The comment states the decision is dated 2026-10-21 and was relayed by the Ikebukuro lane from the Owner's instructions in that lane's session. The #26 issue body also says the facts-only policy decision was made by the Owner on 2026-10-21.
- **Quote (verbatim, from that comment):** 「採事實與著作物分離原則。允許使用可獨立核實的出口編號、改札名稱與通行事實」
- **Summary:** facts and copyrighted works are kept separate. Independently verifiable exit numbers, gate names and access facts may be used, without reproducing the works. JR East was traced and not used. Merge conditions were rights check, deployment isolation, Codex review and integration tests.
- **Credit follow-up (same comment, engineering, not an Owner question):** the credit should state 「ライセンスなし・事實のみ參照（複製なし）」 / "no licence — facts cited, not reproduced"; "optionally, a per-source clearance record at publication: decision reference and date".
- **Not a merge gate (from the #26 issue body, not from the comment above):** the optional per-source decision reference should "not turn into an extra PR merge gate or delay visual prototype work".
- Secondary relay of the same clearance: https://github.com/nurockplayer/gteki/pull/14#issuecomment-6304956473 (`nurockplayer`, 2026-10-21T00:30:47Z, Lane B handoff: "relayed verbatim by the Ikebukuro lane; recorded on #26").
- Origin of the audit item: Lane F G0 audit, item 4, https://github.com/nurockplayer/gteki/issues/12#issuecomment-6324807437 (2026-10-21T19:35:18Z): the app shows only `[REFERENCE_ONLY, facts-only]` (`apps/web/src/ui/app.ts:720`) and per-source decision references are not added.

Spelling note: the #26 comment writes 事實 / 參照 (traditional glyphs); #122 specifies 事実のみ参照 (Japanese glyphs). The #26 spelling appears inside a Chinese-language relay of the Owner's words, so it is weak evidence for which glyphs the Japanese UI should use. The UI is Japanese, so use the #122 spelling below. This file does not decide the glyph question; core/Lane C may confirm with the Owner.

## 2. The exact wording

| Language | Text | Status |
|---|---|---|
| Japanese | `ライセンスなし・事実のみ参照（複製なし）` | As specified in #122 (done-when 1). |
| English | `No licence; cited for facts only (not reproduced)` | **Proposed translation.** The Owner's own English gloss in #26 is "no licence — facts cited, not reproduced". The proposal adds no claim beyond the Japanese line. |

## 3. Every facts-only source

Search: `usage: "facts-only"` and `REFERENCE_ONLY` over `stations/*/gteki/station.json`, `stations/*/data/*.json`, `tools/gis/sources/**` and `docs/gis/**` at base f8ce063. Result: **2 sources, both in Ikebukuro.** Shinjuku (`stations/shinjuku/gteki/station.json`) has 2 sources, both `REUSABLE_WITH_CONDITIONS` with no `usage` field. `tools/gis/sources/sources.yaml` has no facts-only or REFERENCE_ONLY entry (operator maps are "Not acquired", `docs/gis/HANDOFF.md:62`). The same two records are in `stations/ikebukuro/data/graph.src.json:153-178`, which is the hand-authored source of truth; `stations/ikebukuro/gteki/station.json` is generated from it by `stations/ikebukuro/pipeline/build_station.py` (line 395 copies `src["sources"]`).

Common to both: `license: null`, `rights: "REFERENCE_ONLY"`, `usage: "facts-only"`, `modified: false`. #26 decision reference to attach to each: https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404, date **2026-10-21**.

| Field | Source 1 | Source 2 |
|---|---|---|
| id | `toshima-underground-guide-2022` | `tokyometro-ikebukuro-yardmap-2026-03` |
| title (as recorded) | 池袋駅地下空間案内図 (2022年1月版) | 東京メトロ 池袋駅構内立体図 (2026.3現在) |
| publisher (as recorded) | 豊島区 | 東京地下鉄 |
| url | https://www.city.toshima.lg.jp/405/1705251510.html | https://www.tokyometro.jp/station/ikebukuro/yardmap/index.html |
| attribution (as recorded) | 豊島区「池袋駅地下空間案内図」(facts only; not reproduced) | 東京メトロ 池袋駅構内図 (facts only; not reproduced) |
| datasetDate / retrievedAt | 2022-01 / 2026-10-20T10:52:00Z | 2026-03 / 2026-10-20T10:49:00Z |
| recorded use (`notes`) | "Used only to identify which PLATEAU openings are which named passage, exit or gate. No image, layout or pictogram is reproduced." | "Exit numbers and the public status of B1 passages were read from the official map. Nothing is reproduced." |
| facts it supports, counted in `pois.json` evidence | 52 POIs: 38 exits (exit numbers 4, 5, 6a, 6b, 7-11, 13-19, 22-43 as recorded), 8 ticket gates (JR 中央1/2改札, JR 南改札, 丸ノ内線 中央通路西/中央/東改札, 東武東上線 中央1/2改札), 6 area names (中央通路, 北通路, 南通路, 東口（地下）, 西口（地下）, 西口（南）（地下）) | 39 POIs: 38 exits (the same 38 exit numbers) and 1 area name (中央通路) |
| facts it supports, in `graph.json` | 63 of the edges list it in `accessEvidence.sourceIds` (method "official-map-reading (facts only)": the passage is public) | 42 edges list it in `accessEvidence.sourceIds` |
| Owner statement specific to this source | **None recorded.** Covered only by the general #26 decision. The G0 audit (`stations/ikebukuro/docs/G0-source-audit.md:45`) records the lane's own note that the PDF is kept in git-ignored `data-cache/ikebukuro/reference_only/`; that is a lane statement, not an Owner statement. | **None recorded.** Same general decision. The G0 audit records that the map images returned "Access Denied", so its facts were read from the official page (lane statement, not Owner). |

Notes:
- Per-source Owner statements: `docs/gis/decisions/owner-rights-questions.md` and `docs/gis/rights/README.md` hold none for these two sources. The first only lists the #26 decision (DECIDED table) and the two engineering follow-ups. The second covers Lane D's own acquired sources. Per-source Owner statement is therefore UNKNOWN for both.
- The "facts supported" counts come from `evidence.sourceIds` in `pois.json` and `accessEvidence.sourceIds` in `graph.json`; each is as recorded, not independently re-verified here. Many exit POIs say "not yet connected in GTEki graph".
- JR East has no source entry; per #26 it was traced and not used.

## 4. Proposed data shape

Add one optional field to `Source` in **`packages/schema/src/index.ts`** (core): `decision?: { url: string; date: string }`, the per-source #26 clearance record. The UI always renders the #26 line for a `usage: "facts-only"` source from its own strings (section 6), so no per-source credit text is stored. (An earlier draft also proposed a `creditNote` field; it was dropped because nothing would read it.)

```json
{
  "id": "toshima-underground-guide-2022",
  "usage": "facts-only",
  "license": null,
  "decision": {
    "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404",
    "date": "2026-10-21"
  }
}
```

Station data for the Ikebukuro station lead. **The edit target is `stations/ikebukuro/data/graph.src.json`** (source of truth, per `stations/ikebukuro/README.md` and `pipeline/build_station.py`); `stations/ikebukuro/gteki/station.json` is regenerated from it, so it must carry the same hunk and will also get a new `generatedAt` when rebuilt. The diff below patches both files so the committed generated file is consistent before a rebuild. Not applied here. Also stored as `proposals/122-ikebukuro-station.diff`; verified to apply to base f8ce063.

```diff
diff --git a/stations/ikebukuro/data/graph.src.json b/stations/ikebukuro/data/graph.src.json
index 2f4b0df..c0f24ef 100644
--- a/stations/ikebukuro/data/graph.src.json
+++ b/stations/ikebukuro/data/graph.src.json
@@ -161,7 +161,8 @@
    "retrievedAt": "2026-10-20T10:52:00Z",
    "datasetDate": "2022-01",
    "notes": "Used only to identify which PLATEAU openings are which named passage, exit or gate. No image, layout or pictogram is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   },
   {
    "id": "tokyometro-ikebukuro-yardmap-2026-03",
@@ -175,7 +176,8 @@
    "retrievedAt": "2026-10-20T10:49:00Z",
    "datasetDate": "2026-03",
    "notes": "Exit numbers and the public status of B1 passages were read from the official map. Nothing is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   }
  ],
  "floors": [
diff --git a/stations/ikebukuro/gteki/station.json b/stations/ikebukuro/gteki/station.json
index 1458b36..2be5161 100644
--- a/stations/ikebukuro/gteki/station.json
+++ b/stations/ikebukuro/gteki/station.json
@@ -156,7 +156,8 @@
    "retrievedAt": "2026-10-20T10:52:00Z",
    "datasetDate": "2022-01",
    "notes": "Used only to identify which PLATEAU openings are which named passage, exit or gate. No image, layout or pictogram is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   },
   {
    "id": "tokyometro-ikebukuro-yardmap-2026-03",
@@ -170,7 +171,8 @@
    "retrievedAt": "2026-10-20T10:49:00Z",
    "datasetDate": "2026-03",
    "notes": "Exit numbers and the public status of B1 passages were read from the official map. Nothing is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   }
  ],
  "floors": [
```

## 5. Proposed validation rule (not applied; core/Lane C to apply)

Today `packages/schema/src/validate.ts:109` exempts facts-only sources from the licence check (`s.usage !== "facts-only"`), and nothing requires any credit wording or decision for them. #122 done-when 3 asks validation to require the wording **or** the decision reference. Because the web UI always renders the wording for facts-only sources (section 6), the data-level requirement is the decision reference. Note the tension: #26 calls the per-source record optional and not a merge gate; #122 done-when 2-3 makes it required for facts-only sources. The rule below follows #122; core may downgrade it to `warn` if the Owner wants it optional.

Rule (real, non-synthetic stations only): a `usage: "facts-only"` source without `decision` is error `source.decision`. A `decision` that is present on any source, but is not `{url: http(s) URL, date: YYYY-MM-DD}`, is also `source.decision`.

Fail-closed shape (`packages/schema/src/parse.ts`, `SPECS.source`): the diff adds `decision: "object?"` and a `{ url: "string", date: "string" }` spec checked per source, so `"decision": null`, `"x"` or `{}` is a `shape.type` / `shape.missing` error instead of a TypeError inside `validateBundle`. `validate.ts` also guards `typeof s.decision === "object" && s.decision !== null`, because `validateBundle` can be called directly.

Mark: **not applied; core/Lane C to apply.** The whole core and UI change is also stored as `docs/gis/decisions/proposals/122-core-ui.diff`.

`packages/schema/src/index.ts`:

```diff
diff --git a/packages/schema/src/index.ts b/packages/schema/src/index.ts
index 0788f0b..8bc98b6 100644
--- a/packages/schema/src/index.ts
+++ b/packages/schema/src/index.ts
@@ -46,6 +46,11 @@ export interface Source {
    * Omitted = "data" (contents or derivatives may ship).
    */
   usage?: "data" | "facts-only";
+  /**
+   * The Owner decision that permits using this source (#26 per-source clearance record). A real
+   * facts-only source must carry one; the web UI shows the #26 credit line for every facts-only source.
+   */
+  decision?: { url: string; date: string };
   /** Credit line to display wherever derived data is shown. */
   attribution: string;
   /** True when GTEki modified/derived the data (must be disclosed for PDL/CC BY). */
```

`packages/schema/src/parse.ts`:

```diff
diff --git a/packages/schema/src/parse.ts b/packages/schema/src/parse.ts
index f268afd..14f1e35 100644
--- a/packages/schema/src/parse.ts
+++ b/packages/schema/src/parse.ts
@@ -16,7 +16,7 @@ type Spec = Record<string, Kind | `${Kind}?`>;
 const SPECS = {
   station: { id: "string", names: "array", codes: "array?", operators: "array", origin: "object", frame: "string", datasetVersion: "string", generatedAt: "string", synthetic: "boolean" },
   origin: { lat: "number", lon: "number", hM: "number|null", datum: "string", crs: "string" },
-  source: { id: "string", title: "string", publisher: "string", url: "string", license: "object|null", rights: "string", attribution: "string", modified: "boolean", retrievedAt: "string|null", datasetDate: "string|null", downloadUrls: "array?", usage: "string?", sha256: "object?", validUntil: "string|null?", notes: "string?" },
+  source: { id: "string", title: "string", publisher: "string", url: "string", license: "object|null", rights: "string", attribution: "string", modified: "boolean", retrievedAt: "string|null", datasetDate: "string|null", downloadUrls: "array?", usage: "string?", decision: "object?", sha256: "object?", validUntil: "string|null?", notes: "string?" },
   floor: { id: "string", operatorId: "string", sourceLabels: "array", ordinal: "number|null", intermediate: "boolean", elevationM: "number|null", elevationSource: "string", renderElevationM: "number", displayNames: "array?" },
   node: { id: "string", floorId: "string", position: "object", kind: "string", inOut: "string|null", sourceRefs: "array", renderZ: "number?" },
   position: { x: "number", y: "number", z: "number|null" },
@@ -27,6 +27,7 @@ const SPECS = {
   operator: { id: "string", names: "array" },
   code: { operatorId: "string", code: "string" },
   license: { name: "string", url: "string" },
+  decision: { url: "string", date: "string" },
   sourceLabel: { operatorId: "string", label: "string", sourceId: "string" },
   featureRef: { sourceId: "string", featureId: "string" },
   hoursAlways: { kind: "string", evidence: "object" },
@@ -144,6 +145,7 @@ export function checkShape(manifest: unknown, graph: unknown, pois: unknown): Va
     }
     c.each(m.sources, SPECS.source, "sources", (src, where) => {
       if (src.license !== null) c.check(src.license, SPECS.license, `${where}.license`);
+      if (src.decision !== undefined) c.check(src.decision, SPECS.decision, `${where}.decision`);
       c.strings(src.downloadUrls, `${where}.downloadUrls`);
       if (kindOf(src.sha256) === "object") c.strings(Object.values(src.sha256 as object), `${where}.sha256`);
     });
```

`packages/schema/src/validate.ts`:

```diff
diff --git a/packages/schema/src/validate.ts b/packages/schema/src/validate.ts
index a0a8b30..35c581a 100644
--- a/packages/schema/src/validate.ts
+++ b/packages/schema/src/validate.ts
@@ -108,6 +108,11 @@ export function validateBundle(b: StationBundle): ValidationIssue[] {
     if (!b.station.synthetic && !isHttpUrl(s.url)) err("source.url", "source without an http(s) landing URL", s.id);
     if (!b.station.synthetic && s.usage !== "facts-only" && !(s.license && s.license.name.trim() && isHttpUrl(s.license.url)))
       err("source.license", "data source without a licence name and http(s) licence link", s.id);
+    // #26/#122: a facts-only source has no licence to show; the UI says so, and the source records the Owner decision that allows it.
+    const decisionOk = typeof s.decision === "object" && s.decision !== null && isHttpUrl(s.decision.url) && typeof s.decision.date === "string" && isIsoDate(s.decision.date);
+    if (s.decision !== undefined && !decisionOk) err("source.decision", "decision needs an http(s) url and a YYYY-MM-DD date", s.id);
+    if (!b.station.synthetic && s.usage === "facts-only" && s.decision === undefined)
+      err("source.decision", "facts-only source without a decision {url, date} (the #26 Owner decision)", s.id);
     if (!b.station.synthetic && s.rights !== "REUSABLE_WITH_CONDITIONS" && s.usage !== "facts-only")
       warn("source.rights", `source rights ${s.rights}; must not feed published geometry/data (mark usage:"facts-only" if only cited as evidence)`, s.id);
   }
```

Proposed unit tests (also not applied): one for the rule, one for malformed inputs (`null`, `"x"`, `[]`, `{}`, missing or wrong-typed `url` / `date`) that must be refused by `parseStationFiles` and must not make `validateBundle` throw. The two existing fixtures that build real facts-only sources and expect `errors(...)` to equal `[]` (`contract.test.ts:113` and `:295`) get a `decision` line, or they would now fail.

```diff
diff --git a/packages/schema/src/contract.test.ts b/packages/schema/src/contract.test.ts
index e99cb5e..c1410fc 100644
--- a/packages/schema/src/contract.test.ts
+++ b/packages/schema/src/contract.test.ts
@@ -4,6 +4,7 @@ import { isOpenAt, parseHm, parseStationFiles, validateBundle } from "./index.ts
 import type { GraphFile, HoursSpec, PoiFile, StationBundle, StationManifestFile, Weekday } from "./index.ts";
 
 const ev = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
+const DECISION = { url: "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", date: "2026-10-21" };
 const errors = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "error").map((i) => i.code);
 const warnings = (b: StationBundle) => validateBundle(b).filter((i) => i.level === "warning").map((i) => i.code);
 
@@ -111,6 +112,7 @@ describe("validator truth rules added in v0.1 core", () => {
     ref.rights = "REFERENCE_ONLY";
     expect(warnings(b)).toContain("source.rights");
     ref.usage = "facts-only";
+    ref.decision = DECISION;
     expect(warnings(b)).not.toContain("source.rights");
     expect(errors(b)).toEqual([]);
     b.edges[0]!.geometryEvidence = { ...b.edges[0]!.geometryEvidence, sourceIds: ["fixture-access"] };
@@ -293,6 +295,7 @@ describe("review regressions: nested fail-closed shape and rights", () => {
       b.edges = [];
       for (const n of b.nodes) n.sourceRefs = [{ sourceId: "fixture-geometry", featureId: n.id }];
       b.sources.find((s) => s.id === "fixture-access")!.usage = "facts-only";
+      b.sources.find((s) => s.id === "fixture-access")!.decision = DECISION;
       b.sources.find((s) => s.id === "fixture-access")!.rights = "REFERENCE_ONLY";
       b.coverage.areas = [{ id: "area", floorId: "concourse", status: "routable", label: [], polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], sourceIds: ["fixture-geometry", "fixture-access"] }];
       return b;
@@ -383,6 +386,55 @@ describe("review regressions: nested fail-closed shape and rights", () => {
     expect(errors(b)).toContain("source.url");
   });
 
+  it("requires the #26 decision reference on a real facts-only source", () => {
+    const b = asRealStation(createSyntheticBundle());
+    b.edges = [];
+    const src = b.sources.find((s) => s.id === "fixture-access")!;
+    src.rights = "REFERENCE_ONLY";
+    src.license = null;
+    src.usage = "facts-only";
+    expect(errors(b)).toContain("source.decision");
+    src.decision = DECISION;
+    expect(errors(b)).not.toContain("source.decision");
+    // A malformed decision is an error and no longer satisfies the rule.
+    for (const bad of [{ url: "javascript:alert(1)", date: "2026-10-21" }, { url: DECISION.url, date: "2026-10" }, { url: DECISION.url, date: "2026-02-30" }]) {
+      src.decision = bad;
+      expect(errors(b)).toContain("source.decision");
+    }
+    // Synthetic stations and licensed data sources are not asked for it.
+    src.decision = undefined;
+    b.station.synthetic = true;
+    expect(errors(b)).not.toContain("source.decision");
+    const data = asRealStation(createSyntheticBundle());
+    data.edges = [];
+    expect(errors(data)).not.toContain("source.decision");
+    // A decision on a non-facts-only source is still shape-checked.
+    data.sources[0]!.decision = { url: "ftp://example.org/x", date: "2026-10-21" };
+    expect(errors(data)).toContain("source.decision");
+  });
+
+  it("fails closed on a malformed source decision instead of throwing", () => {
+    const parse = (decision: unknown) => {
+      const [m, g, p] = split(createSyntheticBundle());
+      (m.sources[0] as { decision?: unknown }).decision = decision;
+      return parseStationFiles(m, g, p);
+    };
+    expect(parse(DECISION).ok).toBe(true);
+    for (const bad of [null, "x", [], {}, { url: DECISION.url }, { url: 1, date: "2026-10-21" }, { url: DECISION.url, date: null }]) {
+      const parsed = parse(bad);
+      expect(parsed.ok).toBe(false);
+      expect(parsed.issues.map((i) => i.code)).toEqual(expect.arrayContaining([expect.stringMatching(/^shape\./)]));
+    }
+    // validateBundle itself must not throw on a hand-built bundle with a wrong-typed decision.
+    const b = asRealStation(createSyntheticBundle());
+    b.edges = [];
+    for (const bad of [null, "x", 5]) {
+      (b.sources[0] as { decision?: unknown }).decision = bad;
+      expect(() => validateBundle(b)).not.toThrow();
+      expect(errors(b)).toContain("source.decision");
+    }
+  });
+
   it("rejects origin coordinates outside the geodetic range", () => {
     const b = createSyntheticBundle();
     expect(errors(b)).not.toContain("station.origin.range");
```

Docs: `docs/core/contract.md:47` (the `Source.usage: "facts-only"` row) should gain a line for the new rule (`source.decision`: a real facts-only source carries the #26 decision `{url, date}`, and any `decision` is shape-checked). Not edited here (core owns it).

Ordering caution: with the rule as an error, `packages/schema/src/stations.test.ts` and `packages/navigation/src/timed-search.test.ts` (Ikebukuro) fail until the station data in section 4 lands. Land the data and the rule together, or ship the rule first as `warn`.

Verification, done in a scratch copy of base f8ce063 (not in this worktree), installed with `pnpm install --frozen-lockfile --offline --ignore-scripts`, vitest single-worker under the shared lock:
- With the core and UI diff but **without** the station data: `vitest run packages apps` gives 2 failed / 506 passed (508 tests; 38 files, 2 failed): the two Ikebukuro tests above, each with 2 `source.decision` errors.
- With the core, UI and station diffs applied: `vitest run packages apps` passes 38 files / 508 tests; the full default `vitest run` passes 49 files / 615 tests; `tsc -p tsconfig.json` exits 0.
- `git apply --check` passes for each diff alone and for both together against the worktree.

## 6. Proposed UI strings (Lane C)

Current text, `apps/web/src/ui/app.ts:717-722` (Coverage dialog; the tag is on line 720), at base f8ce063:

```ts
// Every source, including those cited only by assets or coverage: link, licence and modification notice.
for (const s of b.sources) {
  const li = this.creditItem(s);
  li.append(el("span", "muted", ` [${s.rights}${s.usage === "facts-only" ? ", facts-only" : ""}]`));
  src.append(li);
}
```

The route card's 出典 (`apps/web/src/ui/app.ts:526-538`) calls the same `creditItem(s)` and appends only `datasetDate`, so it shows **no** facts-only marker at all today. Putting the sentence inside `creditItem` (`app.ts:678-693`) fixes both places. The `[REFERENCE_ONLY, facts-only]` tag in the Coverage dialog can stay.

| Key (`apps/web/src/i18n.ts`) | ja | en |
|---|---|---|
| `factsOnly` | ライセンスなし・事実のみ参照（複製なし） | No licence; cited for facts only (not reproduced) *(proposed translation)* |
| `rightsDecision` (link text before the date, only when `decision` is present) | 権利判断 | Rights decision *(proposed)* |

Rendered, for example: `池袋駅地下空間案内図 (2022年1月版) — 豊島区「池袋駅地下空間案内図」(facts only; not reproduced) · ライセンスなし・事実のみ参照（複製なし） (権利判断 2026-10-21) [REFERENCE_ONLY, facts-only]`.

Proposed diff:

```diff
diff --git a/apps/web/src/ui/app.ts b/apps/web/src/ui/app.ts
index 84661a0..b44b8fd 100644
--- a/apps/web/src/ui/app.ts
+++ b/apps/web/src/ui/app.ts
@@ -9,7 +9,7 @@ import { DEFAULT_GUIDE_TIER, guidePaceSpans, guideTierSpeed, isGuideTier, nextGu
 import { initialLang, pick, strings, type Lang } from "../i18n.ts";
 import { listStations, StationLoadError, type LoadedStation, type StationEntry } from "../registry.ts";
 import { stationClock } from "../stationClock.ts";
-import { sourceCredit } from "../credits.ts";
+import { safeHref, sourceCredit } from "../credits.ts";
 
 /** IANA time zone of the supported stations; routes are timed in it and waits name it. */
 const STATION_TIME_ZONE = "Asia/Tokyo";
@@ -689,6 +689,18 @@ export class App {
     li.append(link(c.title, c.href), el("span", "muted", ` — ${c.attribution}`));
     if (c.license) li.append(el("span", "muted", " ("), link(c.license.name, c.license.href), el("span", "muted", ")"));
     if (c.modified) li.append(el("span", "muted", ` · ${this.t.modified}`));
+    // Facts-only sources have no licence to show: say so (Coverage dialog and the route card's 出典 both use this).
+    if (s.usage === "facts-only") {
+      li.append(el("span", "muted", ` · ${this.t.factsOnly}`));
+      const href = safeHref(s.decision?.url);
+      if (s.decision && href) {
+        const a = el("a", undefined, `${this.t.rightsDecision} ${s.decision.date}`);
+        a.href = href;
+        a.target = "_blank";
+        a.rel = "noopener noreferrer";
+        li.append(el("span", "muted", " ("), a, el("span", "muted", ")"));
+      }
+    }
     return li;
   }
 
```

```diff
diff --git a/apps/web/src/i18n.ts b/apps/web/src/i18n.ts
index 6b29b2d..f18cf5e 100644
--- a/apps/web/src/i18n.ts
+++ b/apps/web/src/i18n.ts
@@ -63,6 +63,9 @@ const STRINGS = {
     sources: "出典",
     /** Modification disclosure required by PDL / CC BY when a source was processed. */
     modified: "加工して作成",
+    /** #26 / #122: facts-only sources have no licence to show; the wording specified in #122. */
+    factsOnly: "ライセンスなし・事実のみ参照（複製なし）",
+    rightsDecision: "権利判断",
     assetDerivations: "3D素材の加工内容",
     symbolicHeight: "高さは表示用の推定です",
     coverage: "カバー範囲",
@@ -135,6 +138,9 @@ const STRINGS = {
     freshness: "Data as of",
     sources: "Sources",
     modified: "modified",
+    /** Proposed English equivalent of the #26 line; adds no claim beyond the Japanese. */
+    factsOnly: "No licence; cited for facts only (not reproduced)",
+    rightsDecision: "Rights decision",
     assetDerivations: "3D asset derivations",
     symbolicHeight: "Heights are display estimates",
     coverage: "Coverage",
```

Open for Lane C: the existing `attribution` strings already contain the English phrase "(facts only; not reproduced)"; once the new sentence shows, that phrase repeats it. Whether to drop the phrase from `attribution` in station data is a station-lead / Lane C call.

## 7. GIS tooling check

`tools/gis/src/validate.ts` is a runner that executes install, typecheck, test, test:real and acquire and writes `docs/gis/validation.json`; it does not read station bundles or sources. No file under `tools/gis` mentions `facts-only` or `REFERENCE_ONLY`; `tools/gis/src/station-enu.ts` reads `station.json` only for the origin. A facts-only credit check would be a new, unrelated feature in Lane D tooling and would duplicate the core rule, so none was added.
