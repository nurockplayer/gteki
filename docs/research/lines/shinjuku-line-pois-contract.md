# Shinjuku line POI import contract (WP1, first batch)

- **Tracking:** lines-lead Phase 1, package WP1 ([`lines-inventory.md`](lines-inventory.md), PR #408). Rulings: Owner Q2/Q3 ([#39 comment 6324726321](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321)); gteki-1b R-1 and R-2 (2026-10-24). GIS (Lane D) confirmed on 2026-10-24 that plain S03 names may ship in station data under Q2 with the conditions below.
- **Writer:** **sjk-search-78** only. It adds these entries in `stations/shinjuku/tools/import-e27.ts` and regenerates `station.json` / `pois.json` / `graph.json` (CI checks `import:e27 --check`). lines-lead does not edit `stations/`.
- **Data:** [`shinjuku-line-pois.json`](shinjuku-line-pois.json): 1 source and 45 POIs, plus a `held` list that is not imported.
- **Schema:** unchanged. The entries map onto the existing `Poi` / `Source` types (`gteki.station/0.1`). `operatorIds`, `line` and `s03` are provenance fields for the writer. They are not `Poi` fields.

## 1. This batch

| Operator | ticket_gate | transfer | platform |
| --- | --- | --- | --- |
| JR East (`jreast`) | 10 | 3 (shared) | 14 (1–4, 7–16 as S03 lists them) |
| Odakyu (`odakyu`) | 3 | 2 of the 3 shared transfers | 5 (2–6) |
| Keio (`keio`: `line` keio 5, keio-new 3) | 8 | 1 of the 3 shared transfers | 0 |
| Tokyo Metro M08 (`tokyometro`) | 2 | 0 | 0 |

Transfers: `poi:jreast-keio-transfer:1`, `poi:jreast-odakyu-transfer:1` and `:2`. The category `transfer` exists in the schema. If the writer prefers `ticket_gate` for search grouping, that is fine: these are gates.

Every name is copied exactly as `com-entity.geojson` prints it, including full-width spaces. A check script compared each name with the entity it came from (0 mismatches). Each POI's `s03.entityId` (`$id N`) equals the `id` of exactly one level feature, and that feature lists the entity back. `s03.levels` is that feature's level file (B1F 16, 1F 20, 2F 7, B2F 2; JR and Odakyu platforms are on S03 1F).

**Held, not imported (27 → 14 after review; the data file keeps only each entry's S03 id and reason, no name):** 5 Toei gate entities (E27 or E01 unknown; never merged into E27 by name), the M08 station entity, one M08 entity whose linked feature is a hallway point rather than a gate (`$id 29062555`), one commercial-unit entry that duplicates a Keio gate name (`Unit B1F-551`), and 6 shops, ticket offices and department stores. Shops and ticket offices belong to data-research-05.

## 2. Field mapping (`Poi`)

| Field | Rule |
| --- | --- |
| `id` | `poi:<operator>-<kind>:<n>` as in the file. Platforms use the platform number as printed. Never renumber. |
| `category` | `ticket_gate`, `transfer` or `platform`. |
| `names` | One `ja` entry, exactly as printed. No translation, no invented English. |
| `aliases` | Empty. No invented readings or romaji. |
| `floorId` | `null`. S03 level labels are S03's own; they are not E27 floors and not elevations. |
| `displayPosition` | `null`. S03's CRS is UNKNOWN in the GIS record, so nothing is placed. |
| `connectorNodeIds` | `[]`. Search only; the router answers `unknown_goal`. |
| `paid` | `null`. The source does not say. |
| `evidence` | `sourceIds: ["tokyo-s03-zip"]`; `method` as in the file (`… UNVERIFIED, AREA_ONLY (S03 level X)`); `checkedDate: 2026-10-24`. |
| `notes` | ja and en, as in the file: 「2020年3月時点のデータです。現在は変更されている場合があります。…」 / "As of March 2020 data; may have changed. …", the S03 level label, "search only", "current status unknown" (R-2). |

## 3. Source entry (`station.json` → `sources`)

Exactly the `sources[0]` object in the data file: id `tokyo-s03-zip`, `rights: REUSABLE_WITH_CONDITIONS`, `license: "CC BY 4.0"`, attribution 「出典：東京都都市整備局「新宿駅周辺の施設情報等」」 (verbatim), `modified: true` with the change notice, `datasetDate: "2020-03"`, ZIP sha256 `fc3466270c08593a300e652c7997021f85151bf0f435e17ee9fcb7935ed4ba31` (GIS condition 4: provenance for later revisions).

## 4. Conditions (GIS, from Q2–Q4 and `docs/gis/rights/tokyo-s03-zip.json`)

1. Plain factual names only: no promotional prose, linked content, PDF illustration, logos or brand artwork (Q4 = No; CC BY 4.0 §2(b)(2)).
2. Nothing from S03 becomes routable or verified. Level labels are not elevations.
3. The credit is verbatim, plus the change notice.
4. Provenance: the ZIP sha256 is kept in the source entry.
5. REUSE/NOTICE: this PR annotates the data file as `LicenseRef-S03` (REUSE.toml 4k, NOTICE 4.7). **The station files that carry the names after import need their own exact-path annotation** in the import PR. Lane D drafts it and rights-reviews that PR.
6. When the names ship, GIS proposes moving `tokyo-s03-zip` in `sources.yaml` from `publish_gate: HOLD` to CONDITIONAL.

## 5. Notes for the writer (from core-search-6a, 2026-10-24)

- `stations/shinjuku/test/guided-walk.test.ts:51` targets every `exit|ticket_gate` POI and expects `res.ok`. Add `&& p.connectorNodeIds.length > 0` in the import PR, or the test fails.
- Append the new POIs at the **end** of the `pois` array. The empty-query list shows `pois.slice(0, 8)`, and unroutable POIs would otherwise fill it.
- The names of `poi:jreast-platform:1` to `:4` contain the station name inside a line name, as printed, so a bare 「新宿」 query will match them. Add a search test that the top hit for 「新宿」 is still a routable POI. The names stay verbatim.
- The existing E27 platform POI note says other operators are not modelled, and `docs/stations/shinjuku/search-expected.md` encodes that. Both change in the import PR.
- The unroutable label stays 「検索のみ（入口未確認）」. No `apps/web` or `packages/search` change.

## 6. Reject rules

Reject an entry if any of these holds:
- its name is not printed on the cited S03 entity;
- it carries a position, floor, connector or `paid` value;
- it is a Toei gate assigned to E27 by name;
- it states the gate or platform is open or currently in use;
- it carries anything other than a plain name (e.g. promotional or linked text).

## 7. Rights review record

GIS Lane D (Claude Opus 5.5) reviewed head `28cda53b` on 2026-10-24, sent the review to lines-lead by message, and found **one P1 and two P2**:

- **Checked against** Owner Q2/Q3/Q4 and `docs/gis/rights/tokyo-s03-zip.json`.
- **Found in order:** factual names only; null positions and floors; nothing routable; no Q4 material; the credit verbatim; the source sha256 matching the acquisition receipt; REUSE 4k exact-path; `reuse lint` 1715/1715.
- **P1:** this contract quoted S03 names while it resolves to Apache-2.0.
- **P2-1:** `held[]` carried names that do not ship.
- **P2-2:** `retrievedAt` must be the receipt's `requested_at`.

All three were fixed in `4e2102ce`: the contract uses ids, `held[]` keeps only `entityId` and `reason`, and `retrievedAt` is `2026-10-21T00:13:55.097Z`, with the receipt path and the resolved URL added. GIS notes this is the record's reading under Q2/Q3 and R-1/R-2, **not a rights PASS**.
