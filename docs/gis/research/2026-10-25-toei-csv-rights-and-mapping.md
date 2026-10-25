# Toei CSVs: rights record and POI mapping (2026-10-25)

Date: 2026-10-25. Status: rights record and mapping only. Nothing is imported into `stations/`, nothing is converted or placed, and the only CSV cell values reproduced here are the printed station names and station numbers used for the mapping in §4 — no other row value is quoted.

Director's ruling, 2026-10-25 ([#501 comment 6394872033](https://github.com/nurockplayer/gteki/issues/501#issuecomment-6394872033), relayed by data-research-05):

- The three Toei CSV sets (駅基本情報, 障害者設備一覧, EV点検) are **accepted** under the dataset-level CC BY 4.0 claim of the Tokyo open-data portal.
- **`連絡先` does not ship.**
- Credit holder: **東京都交通局**. Role: **attributes only, never geometry or route evidence.**

Method: `curl` only, default User-Agent, no added headers, requests spaced ≥0.8 s apart, **11 requests** in total (7 in the first pass, plus two re-fetches of the EV-point-inspection pair with timestamps; the two files were byte-identical). Raw bytes are kept in the external store (`~/.gteki/gis-store/raw/<sha256>/…`), never in the repository, matching the existing pattern for the small CC BY CSVs already under `docs/gis/acquisitions/`. No page was behind a login. No 403, challenge or JS-only page was hit.

## 1. Acquisitions

| source_id | URL | Retrieved (UTC) | HTTP | Bytes | sha256 |
| --- | --- | --- | --- | --- | --- |
| `tokyo-toei-barrierfree-oedo-csv` | `https://www.opendata.metro.tokyo.lg.jp/kotsu/subway_barrierfree_oedo.csv` | 2026-10-25T07:44:43.679Z | 200 | 5,142 | `83962d45a32b560f7b2628ea6d1b1b11758ec0042c905373ce0ef4c6e0f70e98` |
| `tokyo-toei-barrierfree-shinjuku-line-csv` | `https://www.opendata.metro.tokyo.lg.jp/kotsu/subway_barrierfree_shinjyuku.csv` | 2026-10-25T07:44:45.369Z | 200 | 3,058 | `44c21add0b32cf43be616280b44ae6e5c0c3902592a4d58c58e7595436178903` |
| `tokyo-toei-station-info-csv` | `https://www.opendata.metro.tokyo.lg.jp/kotsu/080_001b.csv` | 2026-10-25T07:44:46.601Z | 200 | 11,405 | `8800e11685b525450a0307236fc1d321a19582be564ead551938f636cbdfaba0` |
| `tokyo-toei-elevator-inspection-csv` | `https://www.opendata.metro.tokyo.lg.jp/kotsu/130001_bureau-of-transportation.csv` | 2026-10-25T07:49:01.807Z | 200 | 31,047 | `0475121e8a9416d3bc71fe55028664aa788a46bceb281511f7658a72863af59a` |

The first three are byte-identical to the snapshots recorded on 2026-10-22 / 2026-10-24 (same sha256). The EV-point-inspection CSV was not acquired before; its catalogue resource is the monthly edition for October 2026 (`last_modified` 2026-09-30; the file's `last-modified` 2026-10-15), and the same URL is overwritten every month, so its sha256 is edition-specific.

Supporting documents (all fetched 2026-10-25, each hashed in the acquisition records):

| id | URL | sha256 | Bytes |
| --- | --- | --- | --- |
| `package-show` (barrier-free, `t000018d0000000028`) | `https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t000018d0000000028` | `59f493b1cb9f6b5c8e068b29a0ef0630fabf4b518eb971cbbcc51b135e18e0b6` | 5,718 |
| `package-show` (station info, `t000018d0000000053`) | `https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t000018d0000000053` | `71f570907df903a1c8bf1b84d4a92e38e12031dbf5e3f75654d966f4cd3e28c4` | 3,537 |
| `package-show` (EV inspection, `t000018d0000000051`) | `https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_show?id=t000018d0000000051` | `78003dbda91168ec0e785486462371709f48456781d1f7bf11c1fcf4f0de45c6` | 4,445 |
| `portal-terms` | `https://portal.data.metro.tokyo.lg.jp/terms/` | `74e591bc0092beaed0921015d3b2b0b9bf90c70e67508b036155f6e5400cd67a` | 44,403 |
| `cc-by-4-deed-ja` | `https://creativecommons.org/licenses/by/4.0/deed.ja` | `cf5b3d5b092076f0c146b9c41d7bca8a5ad5171660b7033cd8125ba5ac6d0382` | 33,449 |

The portal terms page answered normally on 2026-10-25 and its sha256 is unchanged from the 2026-10-22 and 2026-10-24 reads.

All three datasets carry `license_id: CC-BY-4.0` (title クリエイティブ・コモンズ 表示（CC BY）) at dataset level, with a null resource-level `license` on every resource, organisation 東京都交通局, and no 「注」 and no individual use rule in the notes or extras.

## 2. Licence line quoted from the portal page

From `portal-terms` (`74e591bc…`):

> 「本サイトに存在する著作物（掲載されている情報等を含みます。）の著作権は、「注」があるものを除いて、クリエイティブ・コモンズ・ライセンス表示 4.0 国際のもとでライセンスされています。」

> 「コンテンツは、本利用規約以外の別の利用ルールが個別に適用されるコンテンツを除き、どなたでも本利用規約に従って複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。」

The credit templates the same page gives are:

> 「【ライセンスされている著作物のタイトル】、東京都・【その他の著作権者】、クリエイティブ・コモンズ・ライセンス 表示4.0国際（ https://creativecommons.org/licenses/by/4.0/deed.ja ）」 (unmodified use)

> 「この【作品・アプリ・データベース等】は、以下の著作物を改変して利用しています。」 plus the same credit (modified use; edited information must not be presented as if the provider made it).

## 3. Rights record (as entered in `tools/gis/sources/sources.yaml`)

Four sources: the two barrier-free files, the station-info file and the EV-point-inspection file. Each has `license_name: CC BY 4.0`, `license_url: https://creativecommons.org/licenses/by/4.0/legalcode.ja`, commercial use / modification / redistribution recorded as `conditional` (credit and change notice required), and `publish_gate: CONDITIONAL` — a gate, not a rights PASS: the data ships only under the director's field, credit and role conditions.

Credit (per ruling: the holder is 東京都交通局, following the 2026-10-23 cultural-properties precedent that names the actual holder rather than 東京都 alone):

- `出典：東京都交通局『地下鉄関連情報　バリアフリー情報』（CC BY 4.0、東京都オープンデータカタログサイト経由）。GTEki が加工して作成` (both barrier-free files)
- `出典：東京都交通局『都営地下鉄駅基本情報』（CC BY 4.0、東京都オープンデータカタログサイト経由）。GTEki が加工して作成`
- the same template with the dataset title of `t000018d0000000051` for the EV-point-inspection CSV (the exact string is `attribution_text` in `sources.yaml`)

Role and exclusions:

- **Attributes only.** None of the four files is geometry, a route or route evidence. They may annotate a station; they may never place anything, create an edge or justify a path.
- **`連絡先` does not ship.** The column exists in both barrier-free files (one distinct value per station row, 38 and 21 values); the values are not reproduced in this note or anywhere else in the repository.
- **EV coordinates never ship.** The EV-point-inspection CSV has `緯度` and `経度` columns. Every one of its 167 rows has both empty in the 2026-10 edition; the ruling's "attributes only, never geometry" means those columns are excluded regardless, so a later edition that populates them changes nothing.
- Station names and station numbers are identifiers (as in the 2026-10-23 cultural-properties ruling). `停止階` and `設置場所` are wording attributes, kept verbatim if ever shipped, never read as positions.

Field inventory (headers and counts only):

| File | Encoding | Data rows | Columns |
| --- | --- | --- | --- |
| 大江戸線 バリアフリー設備一覧 | Shift_JIS (cp932), CRLF, no BOM | 38 | 10 |
| 新宿線 バリアフリー設備一覧 | Shift_JIS (cp932), CRLF, no BOM | 21 | 10 |
| 都営地下鉄駅基本情報 | Shift_JIS (cp932), CRLF, no BOM | 106 (title row, blank row, header row, then 106) | 13 |
| EV-point-inspection schedule (October 2026) | UTF-8 with BOM, CRLF | 167 | 20 |

The 2026-10-22 profile note recorded 108 station-info data rows; the file actually holds 106 data rows, and the correct count is recorded here.

Ship roles per field (no import in this PR):

| File | Field | Role if shipped |
| --- | --- | --- |
| barrier-free | `駅名` | identifier (station name, printed with its number prefix `（E-01）` / `（S-01）`) |
| barrier-free | the six escalator / elevator / toilet / platform / one-route / station-type columns | attributes, verbatim |
| barrier-free | `連絡先` | **excluded** |
| station info | `項番` `路線` `駅ナンバー` `駅名` `よみ` `英語名` `駅管理者` `住所` `高さ1` `高さ2` `高さ1備考` `高さ2備考` `情報更新日` | attributes / identifiers |
| EV inspection | route ID, route code, route name (ja/en), station ID, station code, station order, station name (ja/en), lift ID, stopped floor span, installation location, weight limit, inspection time band, inspection date, start time, end time, barrier-free one-route flag (20 columns, Japanese headers; the exact header row is in the stored file) | attributes / identifiers, verbatim |
| EV inspection | latitude, longitude | **excluded** |

## 4. Mapping to existing search-only Toei POIs

Rule applied (from the brief): **printed-name equality only.** A CSV printed station name is compared, character for character, with the printed Japanese name of an existing search-only Toei POI, after removing the CSV's own printed station-number prefix (`（E-01）`-style). No alias, reading, transliteration, substring or fuzzy match was used, and no row was placed by inference. Anything not exactly equal is listed as unmatched.

Target inventory — existing search-only Toei POIs (`displayPosition: null`, evidence citing a Toei source), 23 in total:

| Set | POIs | What they are |
| --- | --- | --- |
| Shipped data, `stations/shinjuku/gteki/pois.json` | `shop-sjk-toei-001`, `shop-sjk-toeinishi-001` | two shops |
| Lines draft, `docs/research/lines/shinjuku-line-pois-wp4.json` | `poi:toei-exit:a1`, `poi:toei-exit:1` … `poi:toei-exit:8` (9) | street-level exits, labelled A1 and 1–8 |
| Facilities draft, `docs/research/facilities/shinjuku-facilities-batch1.json` | `locker-sjk-toei-001/-002`, `service-sjk-toei-001`, `atm-sjk-toei-001`, and the `…-toeinishi-…` equivalents (12) | lockers, photo booths, ATMs and a rental service for baby equipment |

The printed names of the shipped and drafted POIs are class (b) values (their evidence cites the operator's station pages, not these CC BY CSVs); they stay hashed in the committed data and are deliberately not reproduced here. Only their ids are listed.

Result — every covered row is unmatched:

| CSV | Row as printed | Station number | Matching POI |
| --- | --- | --- | --- |
| 大江戸線 バリアフリー設備一覧 | （E-01）新宿西口 | E-01 | none — unmatched |
| 大江戸線 バリアフリー設備一覧 | （E-27）新宿 | E-27 | none — unmatched |
| 新宿線 バリアフリー設備一覧 | （S-01）新宿 | S-01 | none — unmatched |
| 新宿線 バリアフリー設備一覧 | （S-02）新宿三丁目 | S-02 | none — unmatched |
| 都営地下鉄駅基本情報 | 新宿 | S-01 | none — unmatched |
| 都営地下鉄駅基本情報 | 新宿 | E-27 | none — unmatched |
| 都営地下鉄駅基本情報 | 新宿三丁目 | S-02 | none — unmatched |
| 都営地下鉄駅基本情報 | 新宿西口 | E-01 | none — unmatched |
| EV-point-inspection schedule | 新宿西口 (E-01) | E-01 | none — unmatched |
| EV-point-inspection schedule | 新宿 (E-27) | E-27 | none — unmatched |
| EV-point-inspection schedule | 新宿三丁目 (S-02), 2 rows | S-02 | none — unmatched |

Why nothing matches: the existing search-only Toei POIs are exits, lockers, ATMs, photo booths and two shops. Their printed names are exit numbers and facility names, and none of them is a station record, so no CSV row — all of which are station-level — can carry the same printed name. The 23 POIs above are therefore all unmatched by this rule as well.

Near misses, listed so nobody joins them later by inference:

- EV `設置場所` on the E-27 row (a span naming a ground entrance and the gate it leads to) against the exit POI `poi:toei-exit:a1`: the CSV cell is a span between an entrance and a gate, the POI printed name is the bare entrance label; different printed names, **not** a match.
- EV `設置場所` on an S-02 row (an entrance-to-gate span): no exit POI printed name carries that entrance label; **not** a match.
- Station rows `新宿西口` / `新宿三丁目` against the 12 `…-toeinishi-…` facility POIs: those POIs are located at 新宿西口, but their printed names are facility names; **not** a name match.

Consequence for a later import (not done here): station-level attributes need a station-level target. No such Toei POI exists in the shipped data today.

## 5. Gaps

| ID | Gap | Detail |
| --- | --- | --- |
| TOEI-GAP-1 | 池袋 has no Toei row | Toei operates no station at Ikebukuro. The station appears in none of the four files (checked by station name), so there is nothing to map — an absent record, not UNKNOWN. |
| TOEI-GAP-2 | EV-point-inspection file is a rolling monthly edition | The single resource URL is overwritten each month; the sha256 recorded here is the 2026-10 edition only, and the acquisition record has to be refreshed to follow it. |
| TOEI-GAP-3 | `連絡先` content not described | Its values are per-station and are excluded by the ruling; the note records only that the column exists and its value count. |
| TOEI-GAP-4 | Station-info row count differs from the earlier note | 106 data rows here against 108 recorded on 2026-10-22 (which counted the title and blank rows). The file bytes and sha256 are unchanged since then, so this is a counting correction, not a data change. |
