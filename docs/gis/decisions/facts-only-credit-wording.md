# Facts-only credit wording (#122, from the #26 decision)

Lane D preparation for https://github.com/nurockplayer/gteki/issues/122. Lane D owns only `docs/gis/**` and `tools/gis/**`, so this file is a record plus **proposals** for core (`packages/schema/**`), Lane C (`apps/web/**`) and the Ikebukuro station lead (`stations/ikebukuro/**`). Nothing outside `docs/gis/**` was edited.

Status: **proposal, not applied.** Sources of every statement are named; where a record is missing it says UNKNOWN.

## 1. The rule

- **Decision:** https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404 (node id `IC_kwDOVQtatc8AAAABd60OXA`), posted by `nurockplayer` at 2026-10-20T22:05:04Z. The comment states the decision is dated 2026-10-21 and was relayed by the Ikebukuro lane from the Owner's instructions in that lane's session. The #26 issue body also says the facts-only policy decision was made by the Owner on 2026-10-21.
- **Quote (verbatim, from that comment):** 「採事實與著作物分離原則。允許使用可獨立核實的出口編號、改札名稱與通行事實」
- **Summary:** facts and copyrighted works are kept separate. Independently verifiable exit numbers, gate names and access facts may be used, without reproducing the works. JR East was traced and not used. Merge conditions were rights check, deployment isolation, Codex review and integration tests.
- **Credit follow-up (same comment, engineering, not an Owner question):** the credit should state 「ライセンスなし・事實のみ參照（複製なし）」 / "no licence — facts cited, not reproduced". The per-source clearance record (decision reference and date) is optional and must not become a merge gate.
- Secondary relay of the same clearance: https://github.com/nurockplayer/gteki/pull/14#issuecomment-6304956473 (`nurockplayer`, 2026-10-21T00:30:47Z, Lane B handoff: "relayed verbatim by the Ikebukuro lane; recorded on #26").
- Origin of the audit item: Lane F G0 audit, item 4, https://github.com/nurockplayer/gteki/issues/12#issuecomment-6324807437 (2026-10-21T19:35:18Z): the app shows only `[REFERENCE_ONLY, facts-only]` (`apps/web/src/ui/app.ts:720`) and per-source decision references are not added.

Spelling note: the #26 comment writes 事實 / 參照 (traditional glyphs); #122 specifies 事実のみ参照 (Japanese glyphs). The UI is Japanese, so use the #122 spelling below. This file does not decide the glyph question; core/Lane C may confirm with the Owner.

## 2. The exact wording

| Language | Text | Status |
|---|---|---|
| Japanese | `ライセンスなし・事実のみ参照（複製なし）` | As specified in #122 (done-when 1). |
| English | `No licence; cited for facts only (not reproduced)` | **Proposed translation.** The Owner's own English gloss in #26 is "no licence — facts cited, not reproduced". The proposal adds no claim beyond the Japanese line. |

## 3. Every facts-only source

Search: `usage: "facts-only"` and `REFERENCE_ONLY` over `stations/*/gteki/station.json`, `stations/*/data/*.json`, `tools/gis/sources/**` and `docs/gis/**` at base f8ce063. Result: **2 sources, both in Ikebukuro.** Shinjuku (`stations/shinjuku/gteki/station.json`) has 2 sources, both `REUSABLE_WITH_CONDITIONS` with no `usage` field. `tools/gis/sources/sources.yaml` has no facts-only or REFERENCE_ONLY entry (operator maps are "Not acquired", `docs/gis/HANDOFF.md:62`). The same two records are mirrored in `stations/ikebukuro/data/graph.src.json:153-178`.

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

Add two optional fields to `Source` in **`packages/schema/src/index.ts`** (core). Names follow the file's camelCase (`datasetDate`, `retrievedAt`); the issue's example name `credit_note` would be `creditNote` here.

```json
{
  "id": "toshima-underground-guide-2022",
  "usage": "facts-only",
  "license": null,
  "creditNote": [
    { "lang": "ja", "text": "ライセンスなし・事実のみ参照（複製なし）" },
    { "lang": "en", "text": "No licence; cited for facts only (not reproduced)" }
  ],
  "decision": {
    "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404",
    "date": "2026-10-21"
  }
}
```

Station data would be updated by the Ikebukuro station lead in `stations/ikebukuro/gteki/station.json` (and the mirror `stations/ikebukuro/data/graph.src.json`). Not applied here. Proposed diff (verified to apply to base f8ce063):

```diff
diff --git a/stations/ikebukuro/gteki/station.json b/stations/ikebukuro/gteki/station.json
index 1458b36..db71966 100644
--- a/stations/ikebukuro/gteki/station.json
+++ b/stations/ikebukuro/gteki/station.json
@@ -156,7 +156,12 @@
    "retrievedAt": "2026-10-20T10:52:00Z",
    "datasetDate": "2022-01",
    "notes": "Used only to identify which PLATEAU openings are which named passage, exit or gate. No image, layout or pictogram is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "creditNote": [
+    { "lang": "ja", "text": "ライセンスなし・事実のみ参照（複製なし）" },
+    { "lang": "en", "text": "No licence; cited for facts only (not reproduced)" }
+   ],
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   },
   {
    "id": "tokyometro-ikebukuro-yardmap-2026-03",
@@ -170,7 +175,12 @@
    "retrievedAt": "2026-10-20T10:49:00Z",
    "datasetDate": "2026-03",
    "notes": "Exit numbers and the public status of B1 passages were read from the official map. Nothing is reproduced.",
-   "usage": "facts-only"
+   "usage": "facts-only",
+   "creditNote": [
+    { "lang": "ja", "text": "ライセンスなし・事実のみ参照（複製なし）" },
+    { "lang": "en", "text": "No licence; cited for facts only (not reproduced)" }
+   ],
+   "decision": { "url": "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", "date": "2026-10-21" }
   }
  ],
  "floors": [
```

## 5. Proposed validation rule (not applied; core/Lane C to apply)

Today `packages/schema/src/validate.ts:109` exempts facts-only sources from the licence check (`s.usage !== "facts-only"`), and nothing requires any credit wording for them. #122 done-when 3 asks validation to require the wording **or** the decision reference. The rule below adds error `source.factsOnlyCredit` (real stations only) and validates the shape of `decision` whenever present (`source.decision`).

Mark: **not applied; core/Lane C to apply.**

```diff
diff --git a/packages/schema/src/index.ts b/packages/schema/src/index.ts
index 0788f0b..af945a2 100644
--- a/packages/schema/src/index.ts
+++ b/packages/schema/src/index.ts
@@ -46,6 +46,13 @@ export interface Source {
    * Omitted = "data" (contents or derivatives may ship).
    */
   usage?: "data" | "facts-only";
+  /**
+   * Credit wording recorded with the source. A real facts-only source carries the #26 line
+   * (ja: 「ライセンスなし・事実のみ参照（複製なし）」) or records a `decision`. The web UI renders the line from its own strings.
+   */
+  creditNote?: LocalizedText[];
+  /** The Owner decision that permits using this source (optional per-source clearance record, #26). */
+  decision?: { url: string; date: string };
   /** Credit line to display wherever derived data is shown. */
   attribution: string;
   /** True when GTEki modified/derived the data (must be disclosed for PDL/CC BY). */
```

```diff
diff --git a/packages/schema/src/validate.ts b/packages/schema/src/validate.ts
index a0a8b30..a0cb827 100644
--- a/packages/schema/src/validate.ts
+++ b/packages/schema/src/validate.ts
@@ -21,6 +21,8 @@ const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
 /** File types a station may publish next to its GLBs (same list the web build discovers). */
 export const ASSET_FILE_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|hdr|ogg|mp3|m4a|json)$/i;
 const CONTRACT_FILES = new Set(["station.json", "graph.json", "pois.json"]);
+/** The #26 credit line for facts-only sources (Japanese is canonical; an English equivalent is shown in the English UI). */
+export const FACTS_ONLY_CREDIT_JA = "ライセンスなし・事実のみ参照（複製なし）";
 const CANONICAL_MESSAGE = "asset paths must be canonical slash-separated relative paths inside the station folder (no ., .. or empty segments; no colon, backslash, ? or #)";
 
 /** Relative, canonical and URL-safe: `?` and `#` would be read as a query or fragment once served. */
@@ -108,6 +110,12 @@ export function validateBundle(b: StationBundle): ValidationIssue[] {
     if (!b.station.synthetic && !isHttpUrl(s.url)) err("source.url", "source without an http(s) landing URL", s.id);
     if (!b.station.synthetic && s.usage !== "facts-only" && !(s.license && s.license.name.trim() && isHttpUrl(s.license.url)))
       err("source.license", "data source without a licence name and http(s) licence link", s.id);
+    // #26/#122: a facts-only source has no licence to show, so its credit must say so, or point at the Owner decision that allows it.
+    const decisionOk = s.decision !== undefined && isHttpUrl(s.decision.url) && isIsoDate(s.decision.date);
+    if (s.decision !== undefined && !decisionOk) err("source.decision", "decision needs an http(s) url and a YYYY-MM-DD date", s.id);
+    const wordingOk = (s.creditNote ?? []).some((t) => t.lang === "ja" && t.text.includes(FACTS_ONLY_CREDIT_JA));
+    if (!b.station.synthetic && s.usage === "facts-only" && !wordingOk && !decisionOk)
+      err("source.factsOnlyCredit", `facts-only source needs creditNote with ja "${FACTS_ONLY_CREDIT_JA}" or a decision {url, date} (#26)`, s.id);
     if (!b.station.synthetic && s.rights !== "REUSABLE_WITH_CONDITIONS" && s.usage !== "facts-only")
       warn("source.rights", `source rights ${s.rights}; must not feed published geometry/data (mark usage:"facts-only" if only cited as evidence)`, s.id);
   }
```

Proposed unit test (also not applied), including the three existing fixtures that build real facts-only sources and expect `errors(...)` to equal `[]` (they need the `decision` line, or they would now fail):

```diff
diff --git a/packages/schema/src/contract.test.ts b/packages/schema/src/contract.test.ts
index e99cb5e..e4e3469 100644
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
@@ -383,6 +386,38 @@ describe("review regressions: nested fail-closed shape and rights", () => {
     expect(errors(b)).toContain("source.url");
   });
 
+  it("requires the #26 credit wording or a decision reference on a real facts-only source", () => {
+    const b = asRealStation(createSyntheticBundle());
+    b.edges = [];
+    const src = b.sources.find((s) => s.id === "fixture-access")!;
+    src.rights = "REFERENCE_ONLY";
+    src.license = null;
+    src.usage = "facts-only";
+    expect(errors(b)).toContain("source.factsOnlyCredit");
+    // The wording alone satisfies it...
+    src.creditNote = [{ lang: "ja", text: "ライセンスなし・事実のみ参照（複製なし）" }];
+    expect(errors(b)).not.toContain("source.factsOnlyCredit");
+    // ...but only the Japanese line counts, not an unrelated note.
+    src.creditNote = [{ lang: "en", text: "facts only" }];
+    expect(errors(b)).toContain("source.factsOnlyCredit");
+    // A decision reference also satisfies it.
+    src.creditNote = undefined;
+    src.decision = DECISION;
+    expect(errors(b)).not.toContain("source.factsOnlyCredit");
+    // A malformed decision is an error on its own, and no longer satisfies the rule.
+    for (const bad of [{ url: "javascript:alert(1)", date: "2026-10-21" }, { url: DECISION.url, date: "2026-10" }, { url: DECISION.url, date: "2026-02-30" }]) {
+      src.decision = bad;
+      expect(errors(b)).toEqual(expect.arrayContaining(["source.decision", "source.factsOnlyCredit"]));
+    }
+    // Synthetic stations and licensed data sources are not asked for it.
+    src.decision = undefined;
+    b.station.synthetic = true;
+    expect(errors(b)).not.toContain("source.factsOnlyCredit");
+    const data = asRealStation(createSyntheticBundle());
+    data.edges = [];
+    expect(errors(data)).not.toContain("source.factsOnlyCredit");
+  });
+
   it("rejects origin coordinates outside the geodetic range", () => {
     const b = createSyntheticBundle();
     expect(errors(b)).not.toContain("station.origin.range");
```

Ordering caution: with the rule as an error, `packages/schema/src/stations.test.ts` fails for Ikebukuro (2 errors, one per source) until the station data in section 4 lands. Land the data and the rule together, or ship the rule first as `warn`.

Verification done in a scratch copy of base f8ce063 (not in this worktree): with sections 4 and 5 and the UI diff below applied, `vitest run packages apps` passed 38 files / 507 tests, and `tsc -p tsconfig.json` was clean. Without the station data, 1 test fails exactly as described.

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
index 6b29b2d..8ca5e4d 100644
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
