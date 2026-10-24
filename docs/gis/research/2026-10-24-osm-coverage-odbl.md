# OSM coverage and ODbL fit for Shinjuku and Ikebukuro (#437)

Date: 2026-10-24. Issue #437, GIS Lane D. Status: evidence only. Nothing here is a rights PASS and no gate moves: both Overpass sources stay `publish_gate: HOLD` with `license_name: unknown`, as `evidence` sources that are not a source for the graph, a route or a shipping POI list. No OSM object, name or free-text tag value is reproduced in this note or in any committed file: tag keys are named, and the only tag values shown are the vocabulary names of the tagging scheme itself (§6), never values read out of the extract. `gis osm-coverage` audits that claim on every run against the union of both extracts' tag values — this note, `tools/gis/README.md`, `tools/gis/src/osm-coverage.ts`, the test file, `tools/gis/sources/sources.yaml` and both stations' committed receipts — and writes nothing if a value leaks. The two mall names in §5 are not from the extract: they are the complexes named in the #437 brief and in the Owner's question (OD-34).

Privacy, precisely: the raw Overpass responses in `~/.gteki/gis-store/` do contain contributor metadata (`user`, `uid`, `changeset`), because a raw response is the source as acquired. Nothing downstream of the parser does. Every parsed output — the private object table, the match tables, the lead list, the receipt — is written from an allow-listed copy that never reads those three fields, and this note never looked at them. Raw extracts and every list that carries OSM names stay in the private store.

Method follows `2026-10-24-lines-wp6-terms.md`: every snapshot was re-hashed against its acquisition record before reading, terms are quoted in clauses of at most 30 characters, and no network was used for this reading.

Scope: what OSM holds around the two stations, how good it is, how it compares with the POI lists we already hold, and what ODbL 1.0 would oblige us to do if any of it entered the product. Two mapping tables requested by the GIS lead close the note.

## Sources

| source_id | URL | Snapshot sha256 | Bytes | Retrieved (UTC) |
| --- | --- | --- | ---: | --- |
| `osm-overpass-shinjuku` | `https://overpass-api.de/api/interpreter?data=…` | `06fc414e4ff564c7ae65a037b185cca3c62e2a2a760665df5898e2bf7e6e9322` | 6,616,532 | 2026-10-24T10:11:38Z |
| `osm-overpass-ikebukuro` | `https://overpass-api.de/api/interpreter?data=…` | `2b8a9e795e11eb5277cfa6a591b19fd06fa669115fceb7a4718df5a20ccfb182` | 1,659,849 | 2026-10-24T10:12:21Z |
| `osm-copyright-page` | https://www.openstreetmap.org/copyright | `377505cba7f141cfefd29bb96fba385dfbe575a30adc2ac9315b59b39a6ee1d6` | 21,314 | 2026-10-24T10:13:13Z |
| `odbl-1-0-text` | https://opendatacommons.org/licenses/odbl/1-0/ | `b8d8aebb21bf405f93f6e21bbf0d8f0a749844f9812ec58692f189add6402b47` | 51,176 | 2026-10-24T10:14:14Z |

The two extracts are the query result only; the query itself is the `data` parameter recorded in `tools/gis/sources/sources.yaml` (sha256 in each receipt). Overpass QL: `[out:json][timeout:120];` then `nwr(around:900,<lat>,<lon>)` over `["shop"]`, `["amenity"]`, `["indoor"]`, `["level"]`, `["level:ref"]`, `["repeat_on"]`, `["railway"="station"]`, `["public_transport"="station"]`, `["building"="train_station"]`, `["railway"="subway_entrance"]`, `["entrance"]`, plus named `way`/`relation` `["building"]`; `out meta geom;`. Origin is the `station.json` origin: Shinjuku 35.687 / 139.6994, Ikebukuro 35.7297 / 139.7114.

Acquisition notes: a key filter must be quoted, so `["level:ref"]` — the first attempt used a bare `level:ref` and the server answered HTTP 400, which delivered nothing; one retry met HTTP 502 and, after a 60 s wait, the second retry succeeded. No further acquisitions were made. OSM was read only: GET, no login, no account, no edit. Google Maps was not read or stored at any point. The 小田急エース and 京王モール official shop directories were not read, not even as a cross-check (OD-34).

## How the numbers were produced

`pnpm --dir tools/gis gis osm-coverage <station>` (`src/osm-coverage.ts`, policy `osm-coverage-v2`) re-hashes the stored extract, then:

- Parses it through an allow-list copy: `type`, `id`, `tags`, `timestamp`, `version`, `lat`, `lon`, `geometry`, `members`. `user`, `uid` and `changeset` are stripped at parse, so contributor identity does not exist downstream of the parser: it is not in the private outputs, not in the match tables and not in the receipt.
- Projects every object into the station ENU frame (GRS80, horizontal; Shinjuku has no station-enu frame, so the origin-only projector at height 0 is used).
- Computes counts, shares, histograms and our own derived categories, never source strings. Category names are namespaced `cat:*` and kind names `kind:*` because words such as `shop` and `retail` are themselves tag values of this extract.
- Reads a polygon only from geometry that closes: a way must repeat its first node, and a multipolygon relation's member ways are joined by shared endpoints. A chain that does not close is counted as `unassembled` and left out; the tool never draws the missing segment, and a relation with any unclosed chain — inner or outer — is excluded whole rather than returned without that hole. Points on a ring count as inside, so a tenant that shares a wall with the building is not excluded by rounding.
- Measures two different things. **2D footprint overlap** asks how many `shop`/`amenity` objects lie in plan view inside a station-building outline (an area counts when at least 90 % of its vertices do). **Floor-aware overlap** asks the narrower question, and only where both the object and the building carry a parseable level; with nothing comparable the answer is UNKNOWN, not zero agreement.
- Compares our lists with the named OSM objects. Matching is exact on a normalised name (NFKC, lower case, whitespace and punctuation removed; a trailing 店 counts as a branch suffix only after a space or in a positive branch ending such as 〜駅前店 / 〜池袋店 / 〜西口店, and never in a compound noun such as 百貨店, 書店, 商店 or 理髪店). A pair is *strict* only when we hold coordinates for the entry and an OSM point of that name is within 150 m; *name-only* when we hold no coordinates; *distant* when we hold coordinates and every OSM object of that name is further away; *unlocatable* when we hold coordinates and the name matches an OSM object that has no usable position. `matched = strict + name-only + distant + unlocatable`. Candidates are ranked nearest first, then by OSM type and id, so a pair list is stable; floor agreement is counted only where exactly one OSM object carries the name, and the ambiguous pairs are counted as excluded, never voted.
- Guards every committed output twice before writing. `assertNoSourceValues` holds the receipt to the strict rule that no OSM tag value appears as a JSON string at all; the committed-text audit then scans this note, `tools/gis/README.md`, `tools/gis/src/osm-coverage.ts`, the test file, the source manifest and both stations' committed receipts as text against the union of both extracts' tag values — 11,196 audited values — and exempts a hit only when it is a namespaced identifier of ours (`cat:`, `kind:`, `key:`, `srcclass:`), an allowlisted word of the tagging schemes or of our own station data, or text already present in `tools/gis/sources/sources.yaml` on `origin/main` (that last exemption applies to the manifest file only, never to another file). Values of two or three characters are audited as well; only a single character and a value with no free text (a pure number or punctuation) are skipped. A leak writes nothing at all; the receipt records the audit's counts in `leak_guard`.

Outputs: public receipt `docs/gis/osm/coverage-shinjuku-fcc0ee5fda61b50368d9.json` and `docs/gis/osm/coverage-ikebukuro-cae13100ae065f802f6a.json`; private store `out/osm/coverage-<digest>.objects.json`, `.matches.json` and, for Shinjuku, `shinjuku-leads-odakyu-keio-fcc0ee5fda61b50368d9.json` / `.csv`. The run digest covers the tool fingerprint, each comparison list's ref, path and byte hash, and the full comparison array, so a code, list or result change cannot reuse an earlier receipt name.

## 1. What OSM holds within 900 m

| Measure | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| Objects returned (parse rejects) | 7,695 (0) | 2,502 (0) |
| Distinct tag keys seen | 538 | 428 |
| `shop` objects | 571 | 461 |
| `amenity` objects | 1,998 | 1,352 |
| `indoor` objects | 3,255 (42.3 %) | 36 (1.4 %) |
| Objects with a `level` key | 4,965 | 691 |
| — whose value parsed (a list or a range) | 4,963 | 691 |
| — whose value did not parse | 2 | 0 |
| Objects with any level key (`level`, `level:ref`, `repeat_on`) | 4,986 | 693 |
| Station buildings | 2 | 3 |
| Entrances | 244 | 100 |
| Named objects | 3,149 (40.9 %) | 1,877 (75.0 %) |
| Objects with `brand` | 562 (7.3 %) | 521 (20.8 %) |
| Objects with `opening_hours` | 473 (6.1 %) | 336 (13.4 %) |

Level histogram (objects with a parsed ordinal, first entries): Shinjuku −7:7, −5:14, −4:25, −3:157, −2:588, −1:2,553, 0:1,574, 1:467, 2:187, 3:133, 7:128; Ikebukuro −4:2, −3:2, −2:44, −1:231, 0:167, 1:128, 2:66, 3:34, 4:29, 5:23, 6:18, 7:10, 8:14. Fractional ordinals exist in small numbers (Shinjuku −0.5:3, −0.25:4, 0.25:10, 0.5:49; Ikebukuro −1.5:1): a level value can be a number between two floors, and the histogram keeps it rather than rounding it into one. A long tail (Shinjuku to ordinal 51, Ikebukuro to 60) is buildings, not station floors.

Our derived categories, top entries: Shinjuku `cat:food_and_drink` 904, `cat:retail` 481, `cat:street_furniture` 392, `cat:other` 330, `cat:transport` 201, `cat:health` 68, `cat:money` 50, `cat:culture` 43, `cat:public_service` 41, `cat:education` 18; Ikebukuro `cat:food_and_drink` 524, `cat:retail` 356, `cat:other` 300, `cat:transport` 217, `cat:street_furniture` 164, `cat:health` 60, `cat:education` 51, `cat:public_service` 49, `cat:culture` 42, `cat:money` 37, `cat:office` 1.

The indoor question has two parts, and only the first one has a number:

| Indoor relevance | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| `shop`/`amenity` objects with a `level` key | 625 of 2,543 (24.58 %) | 446 of 1,803 (24.74 %) |
| — whose value parsed | 624 (24.54 %) | 446 (24.74 %) |
| 2D footprint overlap with a station-building outline | 17 of 2,543 (0.67 %; 2 polygons) | 59 of 1,803 (3.27 %; 3 polygons) |
| Floor-aware overlap (both the object and the building name a level) | UNKNOWN — 0 comparable | UNKNOWN — 0 comparable |

**The overlap is horizontal, not indoor.** The 17 of 2,543 and 59 of 1,803 are approximate plan-view overlaps: a node counts when it lies in the ring, an area only when at least 90 % of its own vertices do, and a point on the boundary counts as inside. They say how often a shop's mapped position sits over a station-building outline, nothing more — two outlines can overlap and still be different floors. The narrower question had **no comparable pair at either station**: not one overlapping shop and its building both named a parseable level, so there is nothing to agree or disagree about. The honest reading is not "OSM covers only 0.67 % of Shinjuku's shops": it is that this measurement cannot tell indoor coverage apart from street-level coincidence, and that **floor-aware containment is UNKNOWN** for both stations.

What the numbers do say is narrow: only 625 of 2,543 (24.58 %) and 446 of 1,803 (24.74 %) `shop`/`amenity` objects carry a `level` key, and the plan-view overlap is small. Neither number establishes that OSM's indoor detail is thin — they establish that this measurement cannot show either way. Every station-building outline in both extracts closed (`unassembled_polygons` 0 at both stations), so the small counts are not a geometry failure either.

## 2. How good it is

| Quality measure | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| Last edit before 2021 | 1,494 of 7,695 (19.42 %) | 513 of 2,502 (20.50 %) |
| Objects with a `source` tag | 882 | 622 |
| — permitted tracing (survey, GSI, or a named provider's aerial imagery) | 81 (9.2 %) | 103 (16.6 %) |
| — known restricted (Google, Zenrin, Yahoo, MapFan, Apple Maps, shop directories) | 0 | 0 |
| — unresolved (a bare URL, a vendor mention without the imagery wording, generic aerial wording, anything else) | 806 (91.4 %) | 519 (83.4 %) |
| Objects naming at least one restricted source (exclusive count) | 0 | 0 |
| Objects naming only permitted tracing (exclusive count) | 76 | 103 |
| Objects carrying `fixme` | 2 | 10 |
| Objects carrying `note` | 50 | 84 |

The source classes are ours, not OSM's. Three of them: `permitted_tracing`, `known_restricted` and `unresolved`. A value is classified on its own — survey and GSI naming the permitted source itself; a vendor name counting as tracing permission only when the value also says aerial/imagery (Bing aerial yes, Bing alone no), while generic aerial wording that names no provider is not a permission; Google, Zenrin, Yahoo, MapFan, Apple Maps and the shop directories `known_restricted`; and a bare URL or anything else the tool cannot place `unresolved`. The per-class counts **overlap**: an object with two source tags counts in both classes, which is why 81 + 0 + 806 does not sum to 882. The exclusive counts are the ones that partition: how many objects name at least one restricted source (0 at both stations) and how many name permitted tracing and nothing else (76 / 103) — an object that also names an unresolved source is not permitted-only.

Two readings matter for our use:

- Recency is good: 78.4 % of Shinjuku objects (6,035 of 7,695) and 70.5 % of Ikebukuro objects (1,765 of 2,502) were touched in 2023 or later. A single recent edit is not a re-survey, though — a bulk tag change moves the timestamp without changing the shop.
- Provenance is the weak part, but not in the way it first looks. No object at either station names a known-restricted vendor as its source — 0 of 882 and 0 of 622 — so the extract is not visibly built on Google, Zenrin, Yahoo, MapFan, Apple Maps or shop-directory listings. What dominates is *unresolved*: 806 of 882 (91.4 %) and 519 of 622 (83.4 %), overwhelmingly bare URLs that point somewhere we have not opened and cannot classify. Unresolved is not a finding of a problem; it is a finding that the provenance is unknown — and OSM's own copyright page reminds contributors `never to add data from any copyrighted sources` without permission, with a takedown procedure for when that goes wrong, so an unresolved sourcing chain is exactly what a rights ruling would have to look at. Nothing here was verified, and importing it would put our product behind a chain we do not control. This is independent of ODbL.

## 3. How it compares with the lists we hold

| List | Entries | Matched | Strict (≤150 m) | Name-only | Distant (>150 m) | Unlocatable | Ours only | OSM only | Floor agreement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Shinjuku `main-pois` | 16 | 0 | 0 | 0 | 0 | 0 | 16 | 3,149 | — |
| Shinjuku `merchants-batch1` | 6 | 0 | 0 | 0 | 0 | 0 | 6 | 3,149 | — |
| Shinjuku `merchants-batch2` | 576 | 24 | 0 | 24 | 0 | 0 | 552 | 3,114 | — |
| Ikebukuro `main-pois` | 58 | 1 | 0 | 1 | 0 | 0 | 57 | 1,873 | — |
| Ikebukuro `merchants-batch2` | 118 | 14 | 0 | 14 | 0 | 0 | 104 | 1,845 | — |
| Ikebukuro `merchants-batch3` | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 1,877 | — |
| Ikebukuro `merchants-batch4` | 210 | 3 | 0 | 3 | 0 | 0 | 207 | 1,870 | — |
| Ikebukuro `tobu-dept-tenants` | 864 | 8 | 0 | 8 | 0 | 0 | 856 | 1,867 | 0 of 6 (1 pair excluded) |

Reading:

- **Strict matches are zero everywhere — and the distant and unlocatable buckets are empty too.** Every entry in these lists carries a name and a floor but no coordinates, so no match could be tested by position at all: `name-only` is the only bucket with entries. (The unlocatable bucket is the separate case where we do hold coordinates but the OSM object of that name has none; nothing landed there.) Strict 0 means there is **no coordinate-confirmed match**; it does not mean there is no real-world overlap. The comparison says "same string", not "same shop", and no entry gains evidence from this.
- **Name overlap is small.** Where it exists it is chains and well-known brands, which are the names most likely to collide across several shops at one station. The private match table keeps the OSM ids; the note keeps the counts.
- **Floors do not agree where they can be compared, and one pair could not be compared honestly.** Ikebukuro's department-store tenants are the only list with a floor label on both sides: 6 pairs had exactly one OSM object of that name and so a comparable floor, and 0 agree; a 7th matching name is carried by more than one OSM object, so it was excluded as ambiguous rather than voted. Where the pair is the same shop, the two numbering conventions differ by one or two levels (OSM `level` is relative to the building's own reference floor; our department-store labels come from the store's floor scheme). Either way, an OSM floor value is not usable without manual review, which is what the mapping table below says.
- **Our lists stay the source of truth for identity.** OSM adds nothing to a POI's id, name or floor that we can verify; see §5 for what it could add.

## 4. What ODbL 1.0 would require

Quotes are clause fragments of at most 30 characters, each tied to the text at `odbl-1-0-text` (`b8d8aebb…`). The OSM copyright page (`377505cb…`) states the same in summary form.

- **The database and its licence (§3.1).** Rights granted `explicitly include commercial use`, so a commercial product is not excluded by the licence itself. §3.1 grants (a) `Extraction and Re-utilisation` of a Substantial part, **(b) `Creation of Derivative Databases`** and (c) creation of Collective Databases. It is (b), not (c), that would describe a data layer built from OSM contents: (c) is the collection that holds databases side by side.
- **Definitions that decide the case (§1.0).** `Derivative Database` (a database based upon it, including any `Extraction or Re-utilisation` of a substantial part into a new database), `Produced Work` (a work such as an image or text made from the contents via a query), `Substantial` (quantity or quality, including repeated systematic use of small parts), `Publicly` (to persons outside your control).
- **Insubstantial extraction (§6.2).** The licence `does not affect any rights of lawful users` to extract and re-use insubstantial parts, `evaluated quantitatively or qualitatively`, for any purpose, including creating a Derivative Database. The same section warns that repeated extraction of insubstantial parts may amount to extracting a Substantial part. Where our counts fall on that line is an open question (§4 below).
- **Notices on sharing a database (§4.2).** If we `Publicly Convey this Database`, a derivative or a collective including it, we must do so `only under the terms of this License` (or a §4.4 permitted licence), `Include a copy of this License` or its URI in the database and the documentation, `Keep intact any copyright` and database-right notices, and put them where users look if the file structure prevents it.
- **Notice for output (§4.3).** A Produced Work needs no §4.2 notice, but if we `Publicly Use` it we must say plainly that `Content was obtained` from the database and that it is `available under this License`; the licence gives an example sentence and the copyright page adds that a data distribution should `name and link directly` to the licence.
- **Share alike (§4.4).** `Any Derivative Database` that we publicly use `must be only under the terms` of ODbL or a compatible licence. Extracting a `Substantial` part into a new database is a Derivative Database by the §1.0 definition, so §4.4 reaches the new database, not only an altered copy of the original.
- **Limits of share alike (§4.5).** A Collective Database does not force the other members into ODbL, internal use `within an organisation` is not public, and a Produced Work does not become a Derivative Database.
- **Access to the derivative (§4.6).** If we publicly use a Derivative Database or a Produced Work from one, we must also offer the recipients `The entire Derivative Database` or an alteration file, in `machine readable form`, free over the internet.
- **No extra restrictions (§4.7).** We may not add terms that restrict the rights the licence grants to the database part.

Translate to GTEki:

1. **Our station bundles cannot absorb OSM values.** A bundle that carried OSM shop attributes object by object would be a Derivative Database if the part taken is substantial; that would force ODbL onto that layer, which is why the share-alike question is open and why nothing was imported.
2. **A separate layer is the most likely clean shape, not the only possible one.** If OSM data sits in its own layer — each object's `type`/`id`/`version`, a `LicenseRef-ODbL` identifier, the ODbL text or URI, the OSM attribution and its own NOTICE section — it can satisfy §4.2/§4.4/§4.6 on its own while the station bundle (our own coordinates, ids, names and floors) stays Apache-2.0. The OSMF Collective Database guidance for exactly this arrangement describes independent datasets distributed side by side, each under its own licence and joined by the user, which §4.5 (a) does not force under ODbL. The condition is that the separation survives into what we ship: if the join copies OSM attributes into our rows, the layers are no longer independent and the clean shape is gone. Which arrangement we would ship is a decision for the director, with the guidance read in full; this note only says the condition is not automatic.
3. **Our licences do not take OSM in.** Apache-2.0 cannot carry share-alike content; CC BY 4.0 is not a §4.4 compatible licence for a Derivative Database; CC0 dedications cannot be made over text we do not own. Even with a separate layer, a rights PASS would be the director's to give, not this note's.
4. **This note and the receipts are not exempt.** They restate counts computed by querying the database. Whether that is a Produced Work (§1.0: `a work … made from the contents`), whether §4.3's notice would then apply, and whether the extraction behind these numbers is substantial or insubstantial under §6.2 are **open questions**. The fact that they contain counts instead of names is not by itself an answer: a count-only extraction can still be substantial in quantity, and repeated small extractions can add up (§6.2). Only the director's ruling, not this note, can settle it; until then nothing here is an exemption and nothing is a PASS.

## 5. Options

Numbers below are from §§1–3 of this note; none of them is a recommendation to ship.

| Option | What it would take | What it would buy | Cost and risk |
| --- | --- | --- | --- |
| A. Import an ODbL layer | Separate DB layer, per-object OSM id+version, LicenseRef-ODbL, attribution and §4.6 offer, NOTICE; a rights ruling | 3,255 `indoor` objects and 4,963 level'd objects at Shinjuku, 36 and 691 at Ikebukuro; 244 / 100 entrances | Whether the indoor gain would be large or small is **unverified**: plan-view overlap is only 0.67 % / 3.27 %, and no comparison is coordinate-confirmed (strict 0, and none of our lists has coordinates), so these numbers cannot estimate it; 91.4 % / 83.4 % of sourced objects have unresolved provenance; the layer can never be merged into the Apache-2.0 bundle |
| B. Private lead list only | Keep the extract in the private store and a curated row list next to it; no OSM value in any committed file or in the product | Shinjuku: 3 polygon outlines, 3 rows inside them, no group missing — all at level −1. Ikebukuro: not built (the pattern is Shinjuku-only) | Nothing ships, so no ODbL obligation arises beyond internal use (§4.5 c); each row still needs a human to visit and record it as our own observation |
| C. Skip | Nothing further; the extract stays an evidence snapshot | Removes the option of an OSM-derived indoor layer | The open `indoor`/level detail stays unused; the station graph keeps relying on our own surveys and the MLIT walk network |

B was delivered as the private list `~/.gteki/gis-store/out/osm/shinjuku-leads-odakyu-keio-fcc0ee5fda61b50368d9.json` (and `.csv`): polygons whose name identifies the 小田急エース 北館/南館 or 京王モール アネックス, and the `shop`/`amenity` objects that lie at least 90 % inside them. The three polygon rings and three rows carry OSM names, so they exist only in the private store. They are a to-visit list, not evidence.

## 6. Mapping OSM Simple Indoor Tagging to GTEki fields

Read-only crosswalk. Our internal format stays canonical; OSM keys are named below and no OSM value appears. "Automatic" means a parser could set the field from the tag without a human; "manual" means a human must confirm against our own evidence before the value enters the graph.

| OSM tag (key; values are vocabulary names, not extract values) | GTEki target | Automatic or manual | Why |
| --- | --- | --- | --- |
| `indoor` (room / corridor / area / level) | POI `category` candidates; `coverageAreas[].status`; a room polygon as an area, never as an edge | Manual | The value classifies the object, not our product: a corridor is a walkable area for us and a room is a POI host. Nothing in the tag says whether the space is inside the paid area, open at our service hours, or reachable from our nodes. |
| `level` | `floorId` via the station's floor `ordinal` | Manual | The ordinal is comparable only inside one building's own reference scheme. §3 measured 0 of 6 agreements where both sides had a floor, with a 7th pair excluded as ambiguous. A `level` value never becomes a `floorId` without a human mapping per building. |
| `level` list / range (`1;2`, `0-2`, `-4--2`) | One feature spanning several levels: a `floorId` per level, or an entry that says "spans" | Manual | A range is not a stack of separate objects; it says one feature occupies all of them (a void, an atrium, a long escalator). The parser expands both ends inclusively and normalises the direction; with a fractional end (`0-0.25`, `-0.5-1`) it keeps the two ends and every integer between them, and invents no intermediate step. The product still needs a human to decide how a multi-level feature is drawn. |
| `level:ref` | Floor `displayNames` / `sourceLabels` (display text only) | Manual | It is the operator's own floor label; it is display text, and the schema forbids using display text to equate floors across operators. |
| `repeat_on` | The same feature repeated on other levels — e.g. one toilet block per floor mapped once: a `floorId` entry per listed level of the *same* feature | Manual | It is the opposite of a range: `repeat_on` means identical instances on several levels, `level` with a list means one instance spanning them. Merging the two into one "multi-floor" field would hide the difference; a human decides which one a mall's feature really is. |
| `door` | A connector candidate for `Poi.connectorNodeIds` | Manual | A door is a point on a wall, not a graph node; it identifies where access is possible, and our connector rule needs the node that physically gives access, verified on site. |
| `entrance` | `Poi` of category `exit`/`ticket_gate`, and `Node.kind = "exit"` | Manual | Entrances are the most reliable indoor feature in the extract (244 / 100) but still mix building, platform and station entrances; the kind and the paid/unpaid state must be ours. |
| `shop` / `amenity` | `Poi.category` through our own `cat:*` vocabulary | Manual | The mapping is ours (food, retail, money, health, …), the shop's existence is unverified (§2), and the name can collide across a station (§3). Useful as a to-visit list, not as a record. |
| `highway` footway with `indoor=yes` | `Edge.mode` = `walk` | Manual | It is a walkable line without a mode claim; whether it is inside the paid area or open at our hours is not in the tag. |
| `highway` = steps, and `stairs` = yes areas | `Edge.mode` = `stairs`; `Node.kind` = `stair_end` | Manual | Geometry and mode shape match, but an OSM stairway inside a station is rarely tied to the nodes at both ends, and a stair *area* has no direction at all. |
| `highway` = elevator | `Edge.mode` = `elevator`; `Node.kind` = `elevator` | Manual | A lift needs its served floors and its accessibility, and the tag gives neither; a lift mapped as a node is a location, not the ride. |
| `highway` = steps with `conveying` = yes | `Edge.mode` = `escalator` (`direction` from the way's own order) | Manual | The moving-stair distinction is in `conveying`, not in `highway`; our `escalator` mode also needs the one-way rule, which the tag states only for some mappers. |
| `access` | Nothing automatic; any `Edge` or `Poi` access flag stays UNKNOWN until a human confirms | Manual | `access`, `wheelchair` and `opening_hours` are all claims about the present that OSM may hold without a survey; no value becomes a routing fact without our own verification. |
| `incline` | `Edge.attributes` (raw), `Edge.lengthM` sanity | Manual | A ratio or a direction word; our `slope_class` comes from the MLIT codes (§7), and a raw incline cannot be compared without the survey method. |
| `width` | `Edge.attributes.width_class` (raw number kept separately) | Manual | OSM width is a measurement of unknown provenance; our `width_class` is the MLIT bucket. Keeping both is possible, equating them is not. |
| `wheelchair` | `Edge.wheelchair` / `Poi` accessibility (`true` / `false` / unknown) | Manual | `Tri` in our schema means *evidenced*: a tag is evidence only of what a mapper believed, and the source class (§2) decides how much of it is survey. Automatic import would turn an unverified claim into a routing fact. |

Rules that follow from the table: OSM keys never become our field names; the exchange format stays latitude/longitude plus a level ordinal (and, for a POI, our own id); a level ordinal travels as a number and never as a floor label; and no OSM value is written into `stations/*/gteki/*.json`.

## 7. Mapping MLIT walk-network attributes to our edges

From the codebook we already hold (`tools/gis/codebooks/mlit-walk-network-2024-07.json`, which is the transcription of the acquired 2024-07 specification, spec sha256 `963f2f85…`) and the aliases in `tools/gis/src/network.ts`. Nothing new was acquired for this table.

| MLIT field (link unless marked node) | GTEki target | Automatic or manual | Why |
| --- | --- | --- | --- |
| `route_type` = stairs / moving_walkway / elevator / escalator / ramp | `Edge.mode` = `stairs` / `moving_walkway` / `elevator` / `escalator` / `ramp` | Automatic | One code, one mode; the codes exist for exactly this distinction. `route_type` = none / crossing / unknown leaves the mode UNKNOWN rather than `walk`. |
| `lev_diff` (steps) | `Edge.steps` and `Edge.attributes.step_class` | Automatic for `steps`, manual for the class | `lev_diff` = 0 cm means `steps: false`; any other known code means `steps: true`. The class bucket stays a raw attribute, because the threshold our schema calls a step is our decision. |
| `vtcl_slope` (gradient) | `Edge.attributes.slope_class`; `Edge.steps` never derived from it | Automatic as an attribute | The codes carry sign (uphill / downhill from start to end), which our `direction` already expresses; the class is kept raw so no percentage is invented. |
| `width` | `Edge.attributes.width_class` | Automatic | The four buckets are the source's own; our schema stores the code, not a metre value. |
| `elevator` (presence and accessibility) | `Edge.wheelchair`, `Node.kind = "elevator"`, `Edge.mode = "elevator"` | Manual | The code says a lift exists nearby and what it is equipped for, not that this link is the lift ride; the mode comes from `route_type` and the accessibility confirms `wheelchair: true` only when the code includes the wheelchair case. |
| `escalator` — no separate field | `Edge.mode = "escalator"` from `route_type` | Automatic | The specification carries escalators in `route_type`, so there is no separate escalator code to read; `direction` gives the one-way rule. |
| `direction` | `Edge.direction` (`both` / `forward`) | Automatic | Three codes map onto two of our values; the reversed code needs the edge's end order, which the link endpoints already fix. |
| `roof` (node `in_out`, link `roof`) | `Edge.attributes.roof` only | Automatic as an attribute | The schema has no roof concept; keeping the code preserves the fact without inventing an indoor/outdoor field. |
| `floor` (node) | `floorId` via the station's floor `ordinal` | Manual | The spec's rule is an ordinal with 0 = outdoor ground, −1 = first basement and 0.5 / 0.1 intermediate steps; our station floors are our own list. The conversion is per station and is checked by hand; the ordinal is never read as a height. |
| `in_out` (node) | `Node.inOut` (`outside` / `boundary` / `inside`) | Automatic | The three codes are the same three concepts. |

Our graph stays canonical: the MLIT codes are retained in `Edge.attributes` for audit, while `mode`, `steps`, `wheelchair`, `direction` and the node `floorId` / `inOut` are the fields the router reads, and each of them is `verified` only when a human has confirmed the geometry and the access.

## What this note does not establish

- No licence fit, no rights PASS, no gate change. The four sources stay `HOLD` / `license_name: unknown`.
- Nothing about whether an OSM-derived layer is substantial enough to trigger §4.4, whether this note or the receipts are Produced Works, or what §4.3 would then require. Those are the questions §4 leaves with gteki-1b.
- Nothing about the legal status of facts restated in our own words, or about the unresolved source values. We cannot verify those and did not try.
- Nothing about whether OSM's indoor detail is thin, or about how much an imported layer would help: 0.67 % / 3.27 % measure plan-view overlap only, two outlines can belong to different floors, and no match is coordinate-confirmed because none of our lists has coordinates. Floor-aware containment is UNKNOWN for both stations.
- The committed-text audit proves no exact tag value of these two extracts was copied into the note, `tools/gis/README.md`, `tools/gis/src/osm-coverage.ts`, the test file, the manifest or the committed receipts. It cannot prove a negative: it does not catch a paraphrase, a name re-typed from somewhere other than the extract, or a word that was allowlisted as generic vocabulary. The allowlist lives in `src/osm-coverage.ts` (`AUDIT_ALLOWLIST`) so that every exemption is visible in review; it now also carries the OSM shop/amenity vocabulary our classifier names and the station names and ids of our own data.
- No POI, floor, entrance, corridor or lift from OSM is evidence that anything exists today, or is reachable, open, paid or wheelchair-accessible. Every OSM figure here is UNVERIFIED and NOT_FOR_ROUTING.
- No claim that OSM's indoor detail near these two stations is complete: it is bounded by the 900 m query, and the query window is the station origin disc, not the underground complexes.
- The comparison radius (900 m) and the strict radius (150 m) are policy choices of `osm-coverage-v2`; another radius gives other counts.
- ODbL reading is a summary of the snapshot, not legal advice; the paragraphs quoted are fragments and the full text governs.
