# OSM coverage and ODbL fit for Shinjuku and Ikebukuro (#437)

Date: 2026-10-24. Issue #437, GIS Lane D. Status: evidence only. Nothing here is a rights PASS and no gate moves: both Overpass sources stay `publish_gate: HOLD` with `license_name: unknown`, as `evidence` sources that are not a source for the graph, a route or a shipping POI list. No OSM object, name or contributor identity is reproduced in this note or in any committed file. Tag keys are named; the only tag values shown are the vocabulary names of the tagging scheme itself (§6), never values read out of the extract. Raw extracts and every list that carries OSM names stay in the private store (`~/.gteki/gis-store/`).

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

`pnpm --dir tools/gis gis osm-coverage <station>` (`src/osm-coverage.ts`, policy `osm-coverage-v1`) re-hashes the stored extract, then:

- Parses it through an allow-list copy: `type`, `id`, `tags`, `timestamp`, `version`, `lat`, `lon`, `geometry`, `members`. `user`, `uid` and `changeset` are never copied anywhere, including the private store, so contributor identity does not exist downstream of the parser.
- Projects every object into the station ENU frame (GRS80, horizontal; Shinjuku has no station-enu frame, so the origin-only projector at height 0 is used).
- Computes counts, shares, histograms and our own derived categories, never source strings. Category names are namespaced `cat:*` and kind names `kind:*` because words such as `shop` and `retail` are themselves tag values of this extract.
- Compares our lists with the named OSM objects. Matching is exact on a normalised name (NFKC, lower case, whitespace and punctuation removed, trailing 店/店舗 removed); a pair is *strict* only when we hold coordinates for the entry and the OSM point is within 150 m, otherwise it is counted as *name-only*.
- Guards the committed receipt with `assertNoSourceValues` against every tag value in the extract before anything is written; a tripped guard writes nothing at all.

Outputs: public receipt `docs/gis/osm/coverage-shinjuku-ce2c63247f14080f5055.json` and `docs/gis/osm/coverage-ikebukuro-f9d4314e1b4d1aa4236c.json`; private store `out/osm/coverage-<digest>.objects.json`, `.matches.json` and, for Shinjuku, `shinjuku-leads-odakyu-keio-ce2c63247f14080f5055.json` / `.csv`.

## 1. What OSM holds within 900 m

| Measure | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| Objects returned (parse rejects) | 7,695 (0) | 2,502 (0) |
| Distinct tag keys seen | 538 | 428 |
| `shop` objects | 571 | 461 |
| `amenity` objects | 1,998 | 1,352 |
| `indoor` objects | 3,255 (42.3 %) | 36 (1.4 %) |
| Objects with a parseable `level` | 4,965 of 4,986 with the key (68 unparseable) | 691 of 693 (4 unparseable) |
| Station buildings | 2 | 3 |
| Entrances | 244 | 100 |
| Named objects | 3,149 (40.9 %) | 1,877 (75.0 %) |
| Objects with `brand` | 562 (7.3 %) | 521 (20.8 %) |
| Objects with `opening_hours` | 473 (6.1 %) | 336 (13.4 %) |

Level histogram (objects with a parsed ordinal, first entries): Shinjuku −7:7, −5:14, −4:25, −3:154, −2:577, −1:2,518, 0:1,517, 1:408, 2:129, 3:81, 7:95; Ikebukuro −4:2, −3:2, −2:44, −1:231, 0:165, 1:124, 2:64, 3:33, 4:29, 5:23, 6:18, 7:10. A long tail (Shinjuku to ordinal 51, Ikebukuro to 60) is buildings, not station floors.

Our derived categories, top entries: Shinjuku `cat:food_and_drink` 904, `cat:retail` 481, `cat:street_furniture` 392, `cat:other` 330, `cat:transport` 201, `cat:health` 68, `cat:money` 50, `cat:culture` 43, `cat:public_service` 41, `cat:education` 18; Ikebukuro `cat:food_and_drink` 524, `cat:retail` 356, `cat:other` 300, `cat:transport` 217, `cat:street_furniture` 164, `cat:health` 60, `cat:education` 51, `cat:public_service` 49, `cat:culture` 42, `cat:money` 37, `cat:office` 1.

Two numbers decide the indoor question:

| Indoor relevance | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| `shop`/`amenity` objects with any `level` | 625 of 2,543 (24.58 %) | 446 of 1,803 (24.74 %) |
| `shop`/`amenity` objects inside a station-building polygon | 16 of 2,543 (0.63 %; 2 polygons) | 59 of 1,803 (3.27 %; 3 polygons) |

Containment is by geometry, not by category: a node counts as inside when it lies in the ring, an area only when at least 90 % of its own vertices do, so a street-level way that merely overlaps an underground outline is excluded. The 900 m disc is mostly street; the mapped indoor detail that exists near both stations is drawn as `indoor` polygons and area features, and almost none of our merchant-level objects is being described at that detail.

## 2. How good it is

| Quality measure | Shinjuku | Ikebukuro |
| --- | ---: | ---: |
| Last edit before 2021 | 1,494 of 7,695 (19.42 %) | 513 of 2,502 (20.50 %) |
| Objects with a `source` tag | 882 | 622 |
| — survey | 78 | 77 |
| — GSI (national mapping) | 3 | 26 |
| — aerial imagery | 3 | 0 |
| — possibly non-free (named maps, directories, URLs) | 650 | 325 |
| — other / unmapped | 205 | 194 |
| Objects carrying `fixme` | 2 | 10 |
| Objects carrying `note` | 50 | 84 |

The source classes are ours, not OSM's: every `source` value is classified once (non-free names such as map services and directories, then GSI, survey, aerial imagery, other) and only the class counts are published.

Two readings matter for our use:

- Recency is good: 78.4 % of Shinjuku objects (6,035 of 7,695) and 70.5 % of Ikebukuro objects (1,765 of 2,502) were touched in 2023 or later. A single recent edit is not a re-survey, though — a bulk tag change moves the timestamp without changing the shop.
- Provenance is the weak part. Of the objects that name a source at all, the largest class is *possibly non-free*: 650 of 882 at Shinjuku (73.7 %) and 325 of 622 at Ikebukuro (52.3 %). OSM's own note says contributors must not add data from copyrighted sources without permission, and its takedown procedure exists for exactly this. We cannot verify any of those values, and importing them would put our product behind a chain we do not control. This is independent of ODbL.

## 3. How it compares with the lists we hold

| List | Entries | Matched | Strict (≤150 m) | Name-only | Ours only | OSM only | Floor agreement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Shinjuku `main-pois` | 16 | 0 | 0 | 0 | 16 | 3,149 | — |
| Shinjuku `merchants-batch1` | 6 | 0 | 0 | 0 | 6 | 3,149 | — |
| Shinjuku `merchants-batch2` | 576 | 24 | 0 | 24 | 552 | 3,114 | — |
| Ikebukuro `main-pois` | 58 | 1 | 0 | 1 | 57 | 1,873 | — |
| Ikebukuro `merchants-batch2` | 118 | 14 | 0 | 14 | 104 | 1,845 | — |
| Ikebukuro `merchants-batch3` | 2 | 0 | 0 | 0 | 2 | 1,877 | — |
| Ikebukuro `merchants-batch4` | 210 | 3 | 0 | 3 | 207 | 1,870 | — |
| Ikebukuro `tobu-dept-tenants` | 864 | 8 | 0 | 8 | 856 | 1,867 | 0 of 7 |

Reading:

- **Strict matches are zero everywhere.** Our merchant lists carry names and floors but no coordinates, so a correct name match cannot be confirmed by position. The comparison says "same string", not "same shop". No entry gains evidence from this.
- **Name overlap is small.** Where it exists it is chains and well-known brands, which are the names most likely to collide across several shops at one station. The private match table keeps the OSM ids; the note keeps the counts.
- **Floors do not agree where they can be compared.** Ikebukuro's department-store tenants are the only list with a floor label on both sides: 7 pairs had a comparable floor and 0 agree. Where a tenant's name also exists at another level in the mall, the name-only match may sit on the wrong node; where the pair is the same shop, the two numbering conventions differ by one or two levels (OSM `level` is relative to the building's own reference floor; our department-store labels come from the store's floor scheme). Either way, an OSM floor value is not usable without manual review, which is what the mapping table below says.
- **Our lists stay the source of truth for identity.** OSM adds nothing to a POI's id, name or floor that we can verify; see §5 for what it could add.

## 4. What ODbL 1.0 would require

Quotes are clause fragments of at most 30 characters, each tied to the text at `odbl-1-0-text` (`b8d8aebb…`). The OSM copyright page (`377505cb…`) states the same in summary form.

- **The database and its licence (§3.1).** Rights granted include `commercial use`, so a commercial product is not excluded by the licence itself. §3.1(c) grants `Creation of Derivative Databases`.
- **Definitions that decide the case.** `Derivative Database` (a database based upon it, including any `Extraction or Re-utilisation` of a substantial part into a new database), `Produced Work` (a work such as an image or text made from the contents via a query), `Substantial` (quantity or quality, including repeated systematic use of small parts), `Publicly` (to persons outside your control).
- **Notices on sharing a database (§4.2).** If we `Publicly Convey this Database`, a derivative or a collective including it, we must do so `only under the terms of this License` (or a §4.4 permitted licence), `Include a copy of this License` or its URI in the database and the documentation, `Keep intact any copyright` and database-right notices, and put them where users look if the file structure prevents it.
- **Notice for output (§4.3).** A Produced Work needs no §4.2 notice, but if we `Publicly Use` it we must say plainly that `Content was obtained` from the database and that it is `available under this License`; the licence gives an example sentence and the copyright page adds that a data distribution should `name and link directly` to the licence.
- **Share alike (§4.4).** `Any Derivative Database` that we publicly use `must be only under the terms` of ODbL or a compatible licence. Extraction of a `Substantial` part into a new database is a Derivative Database by definition (§4.4 b).
- **Limits of share alike (§4.5).** A Collective Database does not force the other members into ODbL, internal use `within an organisation` is not public, and a Produced Work does not become a Derivative Database.
- **Access to the derivative (§4.6).** If we publicly use a Derivative Database or a Produced Work from one, we must also offer the recipients `The entire Derivative Database` or an alteration file, in `machine readable form`, free over the internet.
- **No extra restrictions (§4.7).** We may not add terms that restrict the rights the licence grants to the database part.

Translate to GTEki:

1. **Our station bundles cannot absorb OSM values.** A bundle that carried OSM shop attributes object by object would be a Derivative Database if the part taken is substantial; that would force ODbL onto that layer, which is why the share-alike question is open and why nothing was imported.
2. **A separate layer is the only clean shape.** OSM data in its own layer, with each object's `type`/`id`/`version`, a `LicenseRef-ODbL` identifier, the ODbL text or URI, the OSM attribution and its own NOTICE section, could satisfy §4.2/§4.4/§4.6 while the station bundle (our own coordinates, ids, names and floors) stays Apache-2.0. The two would form a Collective Database (§4.5 a) only if the separation survives into what we ship; a join that copies OSM attributes into our rows destroys it.
3. **Our licences do not take OSM in.** Apache-2.0 cannot carry share-alike content; CC BY 4.0 is not a §4.4 compatible licence for a Derivative Database; CC0 dedications cannot be made over text we do not own. The separate layer is the only route, and even then a rights PASS would be the director's to give, not this note's.

## 5. Options

Numbers below are from §§1–3 of this note; none of them is a recommendation to ship.

| Option | What it would take | What it would buy | Cost and risk |
| --- | --- | --- | --- |
| A. Import an ODbL layer | Separate DB layer, per-object OSM id+version, LicenseRef-ODbL, attribution and §4.6 offer, NOTICE; a rights ruling | 3,255 `indoor` objects and 4,965 level'd objects at Shinjuku, 36 and 691 at Ikebukuro; 244 / 100 entrances | Only 0.63 % / 3.27 % of `shop`/`amenity` sit inside a station building, and 0 strict match exists against our lists, so the practical indoor gain is small; 73.7 % / 52.3 % of sourced objects come from possibly non-free sources; the layer can never be merged into the Apache-2.0 bundle |
| B. Private lead list only | Keep the extract in the private store and a curated row list next to it; no OSM value in any committed file or in the product | Shinjuku: 3 polygon outlines, 3 rows inside them, no group missing — all at level −1. Ikebukuro: not built (the pattern is Shinjuku-only) | Nothing ships, so no ODbL obligation arises beyond internal use (§4.5 c); each row still needs a human to visit and record it as our own observation |
| C. Skip | Nothing further; the extract stays an evidence snapshot | Removes the option of an OSM-derived indoor layer | The open `indoor`/level detail stays unused; the station graph keeps relying on our own surveys and the MLIT walk network |

B was delivered as the private list `~/.gteki/gis-store/out/osm/shinjuku-leads-odakyu-keio-ce2c63247f14080f5055.json` (and `.csv`): polygons whose name identifies the 小田急エース 北館/南館 or 京王モール アネックス, and the `shop`/`amenity` objects that lie at least 90 % inside them. The three polygon rings and three rows carry OSM names, so they exist only in the private store. They are a to-visit list, not evidence.

## 6. Mapping OSM Simple Indoor Tagging to GTEki fields

Read-only crosswalk. Our internal format stays canonical; OSM keys are named below and no OSM value appears. "Automatic" means a parser could set the field from the tag without a human; "manual" means a human must confirm against our own evidence before the value enters the graph.

| OSM tag (key; values are vocabulary names, not extract values) | GTEki target | Automatic or manual | Why |
| --- | --- | --- | --- |
| `indoor` (room / corridor / area / level) | POI `category` candidates; `coverageAreas[].status`; a room polygon as an area, never as an edge | Manual | The value classifies the object, not our product: a corridor is a walkable area for us and a room is a POI host. Nothing in the tag says whether the space is inside the paid area, open at our service hours, or reachable from our nodes. |
| `level` | `floorId` via the station's floor `ordinal` | Manual | The ordinal is comparable only inside one building's own reference scheme. §3 measured 0 of 7 agreements where both sides had a floor. A `level` value never becomes a `floorId` without a human mapping per building. |
| `level:ref` | Floor `displayNames` / `sourceLabels` (display text only) | Manual | It is the operator's own floor label; it is display text, and the schema forbids using display text to equate floors across operators. |
| `repeat_on` | Extra `floorId` entries for the same POI, one per listed ordinal | Manual | Repeating a shop across levels is a real multi-floor shop in some malls and a tagging convenience in others; our schema would need one POI per access point or a deliberate multi-floor entry. |
| `door` | A connector candidate for `Poi.connectorNodeIds` | Manual | A door is a point on a wall, not a graph node; it identifies where access is possible, and our connector rule needs the node that physically gives access, verified on site. |
| `entrance` | `Poi` of category `exit`/`ticket_gate`, and `Node.kind = "exit"` | Manual | Entrances are the most reliable indoor feature in the extract (244 / 100) but still mix building, platform and station entrances; the kind and the paid/unpaid state must be ours. |
| `shop` / `amenity` | `Poi.category` through our own `cat:*` vocabulary | Manual | The mapping is ours (food, retail, money, health, …), the shop's existence is unverified (§2), and the name can collide across a station (§3). Useful as a to-visit list, not as a record. |
| `highway` steps / elevator / footway with `indoor=yes` | `Edge.mode` = `stairs` / `elevator` / `walk`; `Node.kind` = `stair_end` / `elevator` | Manual | Geometry and mode shape match, but an OSM stairway inside a station is rarely tied to the nodes at both ends, and a lift needs its served floors, which the tag does not give. |
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
- Nothing about whether an OSM-derived layer is substantial enough to trigger §4.4; that depends on what would be taken, and nothing was taken.
- Nothing about the legal status of facts restated in our own words, or about the provenance of the *possibly non-free* tag values. We cannot verify those and did not try.
- No POI, floor, entrance, corridor or lift from OSM is evidence that anything exists today, or is reachable, open, paid or wheelchair-accessible. Every OSM figure here is UNVERIFIED and NOT_FOR_ROUTING.
- No claim that OSM's indoor detail near these two stations is complete: it is bounded by the 900 m query, and the query window is the station origin disc, not the underground complexes.
- The comparison radius (900 m) and the strict radius (150 m) are policy choices of `osm-coverage-v1`; another radius gives other counts.
- ODbL reading is a summary of the snapshot, not legal advice; the paragraphs quoted are fragments and the full text governs.
