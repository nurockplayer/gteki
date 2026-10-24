# Ikebukuro merchant POI import contract (#212 M-A, batches 1–2)

- Tracking: #212 (parent #209); sources and rulings from #211 / #360 ([`../gaps/DR-merchant-sources.md`](../gaps/DR-merchant-sources.md)). Approved by the director (gteki-1b) on 2026-10-24.
- Writer of the station files: **ikb-route-15** only (one writer for `stations/ikebukuro/gteki/station.json` and `graph.src.json` → `pois.json`). This contract and [`ikebukuro-merchants.sample.json`](ikebukuro-merchants.sample.json) give the exact entries. Data research does not edit `stations/`.
- Schema: unchanged. Uses the existing `Poi` and `Source` types in `packages/schema/src/index.ts` (`gteki.station/0.1`).

## 1. This batch

Five rows: Tokyo Metro shop page 3 (shop-ikb-mr-001..003), Ikebukuro Shopping Park (ISP) 2 (shop-ikb-mr-004, 005). Sogo & Seibu (RF1, department store B2, not in the station) is left out of this batch (director, 2026-10-24). Names and labels were re-read on the source pages on 2026-10-24.

| id | Name (as printed) | Area (as printed) | Confidence | Source |
| --- | --- | --- | --- | --- |
| shop-ikb-mr-001 | Soup Stock Tokyo | not stated | SEARCH_ONLY | tokyometro-ikebukuro-shops-2026-10 |
| shop-ikb-mr-002 | Patio de METRO（パティオ ドゥ メトロ） | Echika池袋内 | AREA_ONLY | tokyometro-ikebukuro-shops-2026-10 |
| shop-ikb-mr-003 | Tabio | Echika池袋 | AREA_ONLY | tokyometro-ikebukuro-shops-2026-10 |
| shop-ikb-mr-004 | マツモトキヨシ | 南館 (ISP) | AREA_ONLY | isp-floorguide-2026-10 |
| shop-ikb-mr-005 | スターバックス コーヒー 南館店 | 南館 (ISP) | AREA_ONLY | isp-floorguide-2026-10 |

Correction to #360: the Metro page gives no facility label for Soup Stock Tokyo, so it is SEARCH_ONLY here, not AREA_ONLY in Echika. ISP prints a 薬 category marker before マツモトキヨシ; it is not part of the name.

## 2. Field mapping (`Poi`)

| Field | Rule |
| --- | --- |
| `id` | `shop-<stable id>` from the research file (e.g. `shop-ikb-mr-002`). Never reused or renumbered. |
| `category` | `"shop"`. |
| `names` | The name exactly as the source prints it, tagged `ja` (it is the name on a Japanese page, whatever the script). No translation, no invented English. |
| `aliases` | Only variants the source itself prints, including kana it prints (e.g. パティオ ドゥ メトロ as `ja-Hrkt`). No invented readings or romaji (director, 2026-10-24). |
| `floorId` | `null`. Echika and ISP are commercial facilities; their B1 is not the station's public `b1` floor, and floors are never equated by label (`docs/core/contract.md`). |
| `displayPosition` | `null`. No position evidence. |
| `connectorNodeIds` | `[]`. No entrance evidence, so search-only; the router answers `unknown_goal` ("destination has no verified entrance"), never a route. |
| `paid` | `null` unless the source states inside or outside the fare gate (none does in this batch). |
| `evidence` | `sourceIds`: the station source id below; `method`: `facts-only directory listing (<decision>), UNVERIFIED, <AREA_ONLY|SEARCH_ONLY>`; `checkedDate`: `2026-10-24`. |
| `notes` | ja and en: the area as printed (if any), then "location and entrance not verified (search only, no route); current status unknown". |
| hours | None in this batch: every source page is undated, so OD-32's 180-day test cannot be met. When a dated first-party source exists, hours go in `notes` with the source date and 出典日時点の情報です。変更されている場合があります / "As of the source date; may have changed". |
| current status | Not a field. Never stated as open; notes say it is unknown (OD-32). |

## 3. Station sources to add (`station.json` → `sources`)

Two entries, exactly as in the sample file: `tokyometro-ikebukuro-shops-2026-10` (Tokyo Metro shop page; `REFERENCE_ONLY`, `usage: "facts-only"`, decision #26) and `isp-floorguide-2026-10` (ISP floor guide; `REFERENCE_ONLY`, `usage: "facts-only"`, decision #360 comment 6377632614 = OD-23/OD-31). Both: `license: null`, `modified: false`, `retrievedAt: 2026-10-24`, `datasetDate: null` (pages undated). Facts-only sources may not feed node positions, edge geometry, display positions or assets.

## 4. Reject rules

Reject a row if any of these holds:
- no source id, or the name is not printed on the cited source;
- JR East scope (OD-02), or a Tobu station-map gate name (OD-01 B);
- a non-null `displayPosition` or a non-empty `connectorNodeIds` without entrance evidence aligned to GTEki geometry by GIS (ENTRANCE_VERIFIED);
- `floorId` set by label match only;
- hours without a dated first-party source within 180 days, or from an aggregator (OD-32);
- anything stating the shop is currently open;
- copied directory text, logos, photos, maps or layouts (OD-31).

## 5. Acceptance check (run 2026-10-24)

On a scratch copy of `origin/main` (as of 2026-10-24 04:42 JST) with the two sources and five POIs merged in, under `lockf -k /tmp/gteki-local-test.lock`, single worker:
- `parseStationFiles` + `validateBundle`: 0 errors; the only new issues are the expected `poi.unroutable` warnings ("search-only") for the five POIs.
- `route.ts ... jr-central-gate-2 shop-ikb-mr-002 --from-poi --goal-poi` (and `shop-ikb-mr-005`): `unknown_goal`, "destination has no verified entrance". No route is produced.
- `packages/cli/src/real-stations.test.ts`: 16/16 pass.
ikb-route-15 re-runs the station's own checks after merging into `graph.src.json` → `pois.json`.

## 6. Batch 2 (ISP, Tobu Hope Center, Echika池袋)

File: [`ikebukuro-merchants-batch2.json`](ikebukuro-merchants-batch2.json), 118 POIs; transcription log: [`ikebukuro-merchants-batch2-log.md`](ikebukuro-merchants-batch2-log.md). §2 and §4 apply unchanged. Differences from batch 1:

| Item | Batch 2 rule |
| --- | --- |
| IDs | Source code first: `shop-ikb-isp-<cd>` (ISP detail-page `cd`, 6 digits), `shop-ikb-echika-<shopid>` (Echika `shopid`). Hope Center prints no code, so `shop-ikb-hope-<NNN>` is a sequence in page order (South, Center, North zones; 001–043). IDs are never reused or renumbered, including the batch 1 `shop-ikb-mr-*` ids. |
| Removed shops | A shop that later leaves a directory goes into the file's top-level `removed` list (id + date + source), and its id is not reused. Batch 2 removes none (`"removed": []`). |
| Area | The zone or hall as printed (e.g. 池袋ショッピングパーク 南館, 東武ホープセンター サウスゾーン, エチカ池袋 改札外) goes in the ja/en `notes`; confidence `AREA_ONLY`. `floorId`, `displayPosition`, `paid` stay `null` and `connectorNodeIds` stays `[]`. 改札外 is printed by Echika but is not mapped to `paid: false`, because that would be a fare-gate claim this batch does not verify. |
| `evidence.method` | `facts-only directory listing (OD-23/OD-31), UNVERIFIED, AREA_ONLY` for ISP and Echika; `(OD-23/OD-33)` for Hope Center. |
| Aliases | Only kana printed on the shop's own detail page (10 Echika shops), tagged `ja-Hrkt`. |
| Closed shops | A shop whose own page prints a closure (e.g. ※7/14（火）営業終了) is not imported; Echika's フレッシュネスバーガー is left out for this reason. |
| Overlap with batch 1 | Not re-imported: マツモトキヨシ and スターバックス コーヒー 南館店 (ISP), Patio de METRO and Tabio (Echika). Echika's Soup Stock Tokyo (`shopid` 1099) is skipped as a likely duplicate of `shop-ikb-mr-001`. |

Sources to add to `station.json` → `sources`: `echika-ikebukuro-2026-10` (decision OD-31, [#360 comment 6377632614](https://github.com/nurockplayer/gteki/pull/360#issuecomment-6377632614)) and `tobu-hopecenter-floorguide-2026-10` (decision OD-33, [#377 comment 6378920311](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6378920311)), exactly as in the file. `isp-floorguide-2026-10` is already in the station data.

Acceptance check (run 2026-10-24, scratch copy of `origin/main`, both sources and the batch merged in, under `lockf -k /tmp/gteki-local-test.lock`, single worker; run with 120 POIs, before the lead dropped the Soup Stock duplicate and the closed shop and added 3 aliases):
- `parseStationFiles` + `validateBundle`: 0 errors; the only issues are `poi.unroutable` warnings for search-only POIs.
- `route.ts stations/ikebukuro c_w shop-ikb-hope-001 --goal-poi` (and an Echika POI): `unknown_goal`, "destination has no verified entrance".
- `packages/cli/src/real-stations.test.ts`: 21/21 pass.

### 6.1 Batch 3 (Tokyo Metro Ikebukuro shop page remainder)

File: [`ikebukuro-merchants-batch3.json`](ikebukuro-merchants-batch3.json), 2 POIs (`shop-ikb-metro-001` LAWSON METRO'S, `shop-ikb-metro-002` Wrapped Crepe Korot); log: [`ikebukuro-merchants-batch3-log.md`](ikebukuro-merchants-batch3-log.md). Source `tokyometro-ikebukuro-shops-2026-10` is already in the station data. Of 46 entries on the page, the rest are batch 1–2 shops, Echika shops, facilities (ATMs, lockers, photo booths and similar, for a later facilities batch), or places outside the station (駅周辺). IDs use a sequence (`shop-ikb-metro-<NNN>`) because the page has no store codes. Both are `SEARCH_ONLY`, with the same field rules as §2.
