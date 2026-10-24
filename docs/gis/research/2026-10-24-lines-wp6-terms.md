# Lines WP6: operator-site terms and Toei / Hokonavi licence check

Date: 2026-10-24. Status: evidence only; findings for the director (gteki-1b) to rule on. Nothing here is a rights PASS, nothing is converted or shipped, and no `sources.yaml` gate changes. Method follows `2026-10-23-shinjuku-cultural-properties-rights.md`: every file was hashed against its receipt before reading (all matched), HTML was tag-stripped locally, and no network was used. Terms pages are quoted in clauses of at most 30 characters, each tied to the snapshot sha256. No CSV cell value or data name is reproduced; only column headers (field names) and counts.

Scope: the nine sources the lines lead asked about for WP6: Keio and Odakyu site terms, だれでも東京, the two Toei barrier-free CSVs, the Toei station-info CSV, and the Hokonavi 渋谷・千駄ヶ谷・新宿 package.

## Sources

| source_id | URL | Snapshot sha256 | Bytes | Retrieved (receipt `requested_at`) |
| --- | --- | --- | --- | --- |
| `keio-site-terms` | https://www.keio.co.jp/contact/site/ | `3eb3ee6bd471e0fb8bc9ff5c72fde3d8d6b9f30acfe36366882982a59c5c8a4b` | 107,589 | 2026-10-24T08:58:04Z |
| `odakyu-site-policy` | https://www.odakyu.jp/policy/ | `f2532d9c677c3a018b3f218904db01a451784d48d8b809545b961e246609fb8d` | 19,544 | 2026-10-24T08:58:04Z |
| `daredemo-tokyo-site` | https://www.daredemo-tokyo.metro.tokyo.lg.jp/ | `baf2d03e4a7705a9d5170fe9793b3597e9343a23c471782d4dfaf6f4a57a9629` | 403 | 2026-10-24T08:58:04Z |
| `tokyo-toei-barrierfree-oedo-csv` | https://www.opendata.metro.tokyo.lg.jp/kotsu/subway_barrierfree_oedo.csv | `83962d45a32b560f7b2628ea6d1b1b11758ec0042c905373ce0ef4c6e0f70e98` | 5,142 | 2026-10-24T08:58:03Z |
| `tokyo-toei-barrierfree-shinjuku-line-csv` | https://www.opendata.metro.tokyo.lg.jp/kotsu/subway_barrierfree_shinjyuku.csv | `44c21add0b32cf43be616280b44ae6e5c0c3902592a4d58c58e7595436178903` | 3,058 | 2026-10-24T08:58:04Z |
| `tokyo-toei-station-info-csv` | https://www.opendata.metro.tokyo.lg.jp/kotsu/080_001b.csv | `8800e11685b525450a0307236fc1d321a19582be564ead551938f636cbdfaba0` | 11,405 | 2026-10-22T12:22:37Z |
| `hokonavi-shibuya-sendagaya-shinjuku-package` | https://ckan.hokonavi.go.jp/api/3/action/package_show?id=nwd_shibuya_sendagaya_shinjuku | `18a9a0c4ac726f2082244918113b58e993f2e1343c3083aca53183f712f0b350` | 5,950 | 2026-10-22T12:22:42Z |

Supporting documents used (all sha256 verified against the receipts):

| Document | Receipt | sha256 | Bytes |
| --- | --- | --- | --- |
| Toei barrier-free `package_show` (`t000018d0000000028`; shared by both barrier-free sources) | oedo and shinjuku-line receipts, id `package-show` | `59f493b1cb9f6b5c8e068b29a0ef0630fabf4b518eb971cbbcc51b135e18e0b6` | 5,718 |
| Toei station-info `package_show` (`t000018d0000000053`) | `tokyo-toei-station-info-csv`, id `package-show` | `71f570907df903a1c8bf1b84d4a92e38e12031dbf5e3f75654d966f4cd3e28c4` | 3,537 |
| Tokyo portal terms (`portal-terms`) | all three Toei receipts | `74e591bc0092beaed0921015d3b2b0b9bf90c70e67508b036155f6e5400cd67a` | 44,403 |
| Hokonavi site terms (`hokonavi-site-terms`) | Hokonavi package receipt | `479ce0b33324fc6dd3ee7ba75fdb9de2a2a5f2095ab1cbacc790ad1cfe4a9aa6` | 55,246 |
| PDL 1.0 text (`pdl-1-0-text`) | Hokonavi package receipt | `4d4c4cc5e8ac952f640cdf9c8242de648e36995667a361302589d468fd1e12a0` | 59,216 |
| Hokonavi dataset page (`dataset-page`) | Hokonavi package receipt | `7e3db55e8ccd8e84c4673ef85cd3b3716ed61c31a6ff459c050a0a0d708e6c62` | 21,695 |

The CC BY 4.0 deed snapshot (`cf5b3d5b…`) was not re-read; the CC BY conditions are taken from the portal terms and from the 2026-10-23 note.

Classification vocabulary: FACTS_ONLY_POSSIBLE (site content restricted; facts restated in GTEki's own words are not addressed or not prohibited), RESTRICTED (the page prohibits even that, or commercial use of anything derived), UNKNOWN (cannot tell).

## 1. Keio (`keio-site-terms`)

Snapshot `3eb3ee6b…`, page サイトのご利用にあたって, last-update markers on the page read 2021年11月 and 2024年7月 (it is not clear which section each belongs to).

- Copyright section: says copyright in site content 「原則として当社が有して」います, and that use of 「全ての写真、社名ロゴ、画像、文章等」 data, 「複製・転用・転載・電磁的加工・送信・頒布・二次的使用」 and similar acts, is declined 「一切お断り」. The object of the prohibition is the site's content data (photos, logos, images, text and the like).
- Commercial use: there is no general commercial-use clause. The only commercial wording is in the link rules: links from sites made for 「商行為」 using Keio's content are refused. That governs linking, not the reuse of facts. There is no equivalent of the Tobu §7–8 commercial-use prohibition on this page.
- Facts: the page does not mention facts, data, or information restated in other words. It has a disclaimer that accuracy and currency are not guaranteed, and that information may change without notice.
- Other: no licence grant, no credit format, no API or open-data offer on this page.

Classification: **FACTS_ONLY_POSSIBLE**. The page broadly refuses reproduction, processing and secondary use of its text, images and logos, and is silent on station, line or facility facts restated independently. This is the same class the director gave Seibu (OD-25: no copying or modification beyond private use, no commercial-use ban). It does not clear copying of any wording, layout, image or logo, and gives no licence to rely on. Whether a fact is protectable is a legal question this note does not decide.

## 2. Odakyu (`odakyu-site-policy`)

Snapshot `f2532d9c…`, page ご利用にあたって, dated 2022年3月 on the page.

- Section 1 (著作権): near-identical in effect to Keio's. Copyright in site content belongs 「原則として当社」; use of 「全ての写真、社名ロゴ、画像、文章等」 content data, 「複製・転用・転載・電磁的加工・送信・頒布・二次的使用」 and similar acts, is declined without prior permission (「一切お断り」).
- Commercial use: no general commercial-use clause. The link rules refuse links from sites intended to carry out commerce using the site (for example supplying its information for a fee). That is a linking rule, not a Tobu §7–8 equivalent.
- Facts: not addressed. A disclaimer says posted information is as of posting and may differ from reality over time.
- Other: scope clause applies the terms to all data on the servers; no licence grant or credit format.

Classification: **FACTS_ONLY_POSSIBLE**, on the same reasoning as Keio: content data is closed to reuse without permission, and independent facts are neither prohibited nor released. The requirement of prior permission for 「文章等コンテンツデータ」 means any text taken from the page needs permission, so only own-words facts could be used.

## 3. だれでも東京 (`daredemo-tokyo-site`)

Snapshot `baf2d03e…` is a 403-byte page that says the site is unavailable for maintenance (「サイトメンテナンスのためご利用いただけません」). It has an empty title, no links, no terms URL and no content. The `last-modified` header was 2026-10-22T12:20:07Z. A terms or usage page was not found because none is reachable from this snapshot; no other URL was tried (no network).

Classification: **UNKNOWN**. OD-26 stays open: the terms need to be read once the site is back, before any use. Nothing about the site's content or licence is established.

## 4. Toei barrier-free CSVs (Oedo line, Shinjuku line)

Both resources belong to one dataset, `t000018d0000000028` (organisation 東京都交通局), `package_show` snapshot `59f493b1…`.

### Licence fields

| Level | Value |
| --- | --- |
| Dataset `license_id` | `CC-BY-4.0` (title クリエイティブ・コモンズ 表示（CC BY）, URL `https://creativecommons.org/licenses/by/4.0/deed.ja`) |
| Resource `license` (all four resources, including the two here) | `null` |
| Dataset notes / extras | notes state only the theme 【東京都交通局】地下鉄関連情報 バリアフリー情報; extras: 更新頻度 随時; no 「注」 and no individual rule |
| Resource descriptions | one line each naming the line, no licence text |
| Catalogue metadata | created 2024-04-22, modified 2025-12-12; resource `last_modified` 2024-01-21 (files served with `last-modified` 2026-01-15) |

The package page also lists 浅草線 and 三田線 resources; they are not in WP6.

### Portal terms (`74e591bc…`)

- Content is licensed under CC BY 4.0 「「注」があるものを除いて」 and may be used freely, including 「商用利用も可能です」, with translation and modification (the same clauses used in the 2026-10-23 note). Content with its own individually applied rules is excluded; none is recorded here.
- Credit template (unmodified): 【title】、東京都・【その他の著作権者】、クリエイティブ・コモンズ・ライセンス 表示4.0国際 (with the deed URL).
- Modified use: the same credit plus a statement that the work was edited, introduced by a template sentence saying the work uses the listed works in modified form (「…を改変して利用しています」); and it is forbidden to present edited information as if the content provider (東京都 or a municipality) made it. Portal §2 also asks users to respect third-party rights.

### Structure (headers and counts only; no cell values read into this note)

| Item | Oedo CSV | Shinjuku-line CSV |
| --- | --- | --- |
| Encoding | Shift_JIS (cp932), no BOM, CRLF | same |
| Data rows (excluding header) | 38 | 21 |
| Columns | 10, constant on every row | 10, constant on every row |
| Headers | 駅名; エスカレーター（地上～改札階）; エレベーター（地上～改札階）; エスカレーター（改札階～ホーム階）; エレベーター（改札階～ホーム階）; バリアフリートイレ（車椅子使用者対応トイレ）; ホーム形式; 1ルート確保（エレベーター等）; 駅タイプ; 連絡先 | identical headers |
| Latitude / longitude / CRS columns | none | none |
| Floor or level-label columns | none; the headers name the span of an installation (street-to-gate level, gate-to-platform level) as part of the column title | same |
| Position within station (gate, exit, platform number, side) | none | none |

Reading: these are per-station availability records (installation type by span, toilet, platform type, step-free route flag, station type, a contact column), not geometry. The files cannot place anything on a map and carry no position within a station. The contents of the `連絡先` column were not inspected for this note; whether it holds an organisational contact or something else needs a look before it is ever listed as a shipped field.

### Station info (`tokyo-toei-station-info-csv`)

Dataset `t000018d0000000053`, `package_show` snapshot `71f57090…`: `license_id` `CC-BY-4.0` (same title and URL as above), organisation 東京都交通局, resource-level `license` `null` for both resources (XLSX and CSV), notes describe station name, number, reading, English name and address basic information, no 「注」. Metadata modified 2025-12-12; resource `last_modified` 2017-03-24. The structure (11,405 bytes, Shift_JIS, 108 data rows, 13 columns, no latitude/longitude/CRS columns, NO_COORDINATES) is as recorded in `2026-10-22-municipal-evidence-profile.md`; it was not re-profiled here.

### Finding

All three sources carry a dataset-level CC BY 4.0 claim with a null resource-level field, and the portal terms apply CC BY 4.0 to catalogue content unless a 「注」 or individual rule says otherwise. This is the same pattern as the Shinjuku cultural-properties dataset, whose director ruling (2026-10-23) accepted the dataset-level grant with credit and a change notice.

Candidate classification: **CONDITIONAL, subject to a director ruling** on shipped fields and the credit string. The ruling would need to decide:

1. Which fields may ship: the factual per-station availability columns are the natural candidates. `連絡先` is undecided (see above). Station names are plain identifiers, as in the cultural-properties ruling, but the director should say so.
2. The credit holder: the dataset organisation is 東京都交通局, so the credit should name 東京都交通局, not 東京都 alone. The portal template reads 「東京都・【その他の著作権者】」; as in the 2026-10-23 ruling, whether to name 東京都 as well as the actual holder is for the director.
3. Role: these are availability facts and not geometry, so they would be non-placing context or attributes; they do not add anything routable.
4. A fresh re-acquisition of the portal terms before any conversion (the portal terms page was in maintenance on 2026-10-23 evening; the 2026-10-22 and 2026-10-24 snapshots share the same sha256 `74e591bc…`).

Proposed credit, modelled on the portal template for modified works, for the director to rule on and not yet adopted:

- ja: 出典：東京都交通局『バリアフリー設備一覧』（CC BY 4.0、東京都オープンデータカタログサイト経由）。GTEki が加工して作成
- For station info, replace the title with 『都営地下鉄駅基本情報』.
- en: Source: Tokyo Metropolitan Bureau of Transportation, "<dataset title>" (CC BY 4.0, via the Tokyo Open Data Catalog). Modified by GTEki.

The Oedo and Shinjuku-line files are different resource titles inside the same dataset, so the credit would likely name the dataset-level title (地下鉄関連情報 バリアフリー情報) or each resource's title; which is a ruling point. Whether the file's embedded dates (last-modified 2026-01-15 against catalogue 2024-01-21) matter for the credit is also not established.

## 5. Hokonavi 渋谷・千駄ヶ谷・新宿 (`hokonavi-shibuya-sendagaya-shinjuku-package`)

Dataset `nwd_shibuya_sendagaya_shinjuku` (id `eaf1695b…`), organisation 国土交通省, `package_show` snapshot `18a9a0c4…`.

| Field | Value |
| --- | --- |
| Package `license_id` | `pdl-jp-1.0` (公共データ利用規約(第1.0版）), URL `https://www.digital.go.jp/resources/open_data/public_data_license_v1.0` |
| Resource `license` | `null` for all four resources: link.csv, link.geojson, node.csv, node.geojson |
| Notes | describes the data as MLIT-built 歩行空間ネットワークデータ for 渋谷駅・千駄ヶ谷駅周辺 and 新宿駅周辺; points to the 2024-07 specification; states 最終更新日 2021/05/26 |
| Catalogue dates | created 2025-09-09, modified 2025-10-28 |
| Resource sizes | link.csv 1,335,090 bytes; link.geojson 6,207,526; node.csv 1,023,161; node.geojson 3,457,737 |
| Dataset page (`7e3db55e…`) | shows the licence as 公共データ利用規約(第1.0版）; the stripped text contains no limited-publication or 2027 notice (the Oedo-line E27 snapshots carry one; this page does not) |

The CSVs and GeoJSON were not opened; the receipt also lists `link.csv` and `node.csv` as hashed supporting documents, and their structure is outside this note's scope.

### Site terms (`479ce0b3…`, 令和7年9月30日)

- Section 2 says the site's content has copyright held by MLIT 「又は第三者」 and may be used under the 公共データ利用規約 (PDL 1.0), with the site's own credit format and 「本利用ルールの適用を受けないコンテンツ」 left to a separate 「重要情報」 page. That page was not acquired; its content is UNKNOWN.
- Credit format: 出典 naming the site (MLIT) and the page URL; for modified use, an additional statement that the content was edited or processed (for example, 「…を加工して作成」), and no presentation of edited information as if the government made it.
- It states the rules are compatible with CC BY 4.0.

### PDL 1.0 text (`4d4c4cc5…`)

- Free use including commercial use, with 出典, an edit notice, and no presentation as an unmodified government product.
- §1.2 puts third-party-held rights on the user to clear 「特に権利処理済であることが明示されているもの」 excepted; §1.4 excludes symbols, logos and content with a stated separate rule; §1.7 says it does not restrict statutory quotation.
- The PDL's own preface notes that numerical data and simple tables and graphs are not protected by copyright and so fall outside its rules.

### Comparison with prior decisions

| Reference | Position | This package |
| --- | --- | --- |
| Ikebukuro Hokonavi decision (i) (PR #147, comment 6330792563) | Package-level PDL 1.0 accepted, with attribution and a processing notice and no implication of government authorship; Ikebukuro only | Same structure (package `pdl-jp-1.0`, resources `null`), but the decision was confined to Ikebukuro by its own terms; it does not extend by analogy to this package |
| Q11 (E27 package PDL, Owner answered No, then option (a) on 2026-10-22) | Package PDL 1.0 is not treated as covering the two E27 resources; E27 ships only under the #16 override, which is not a licence finding | Same structure as E27 (package PDL, resources `null`), so Q11's reasoning points the other way from decision (i); which of the two applies here is the open question |

The package shows the identical licence pattern to both precedents and so cannot by itself select between them. The geography (渋谷・千駄ヶ谷・新宿) overlaps the Shinjuku E27 area rather than Ikebukuro. No Owner decision names this package.

Classification: **context-only candidate, needs a director ruling**. Nothing routable. If the director treats it like Ikebukuro decision (i), a credit would follow the Hokonavi site format with a processing notice; if like Q11, it stays internal evidence. Proposed credit if accepted (not adopted): 「歩行空間ナビゲーションデータプラットフォームオープンデータサイト」（国土交通省）（<dataset page URL>）を加工して作成. The ruling would also need to say whether the Hokonavi 重要情報 page must be acquired first.

## Summary

| Source | Verdict | What a ruling would need |
| --- | --- | --- |
| `keio-site-terms` | FACTS_ONLY_POSSIBLE | Director confirms the Seibu / Metro class (OD-25) applies; no copying of text, images, layouts, logos |
| `odakyu-site-policy` | FACTS_ONLY_POSSIBLE | Same as Keio |
| `daredemo-tokyo-site` | UNKNOWN | Terms page must be read once the site is back (OD-26 stays open) |
| `tokyo-toei-barrierfree-oedo-csv` | CONDITIONAL candidate (dataset CC BY 4.0; resource licence null) | Field list (including `連絡先`), credit holder and title, fresh portal terms |
| `tokyo-toei-barrierfree-shinjuku-line-csv` | CONDITIONAL candidate (same dataset) | Same as above |
| `tokyo-toei-station-info-csv` | CONDITIONAL candidate (dataset CC BY 4.0; resource licences null) | Same, with the title 都営地下鉄駅基本情報 |
| `hokonavi-shibuya-sendagaya-shinjuku-package` | Context-only candidate | Decision (i) or Q11 treatment; the 重要情報 page; credit with processing notice |

## What this note does not establish

- Any rights PASS, or that facts from Keio, Odakyu, Toei or Hokonavi may be used in GTEki without separate review; the classifications describe what the pages say, not copyright law.
- The content of だれでも東京's terms (nothing was read).
- The Hokonavi 公共データ利用規約（第1.0版）に関する重要情報 page, any individual rule attached to a Toei dataset beyond the metadata read here, or whether Toei or Hokonavi resources contain third-party material.
- Whether the Keio or Odakyu terms are meant to apply to data restated in another form; they are silent.
- What the Toei CSV cell values are, whether `連絡先` is shippable, or whether the files agree with the operators' current pages.
- The CRS, geometry or routing fitness of anything here (the Toei CSVs have no coordinates; the Hokonavi files were not examined).
- Freshness: the Tokyo portal terms snapshot is the same bytes on both acquisition days, but later changes are not checked. All checks were against local, hashed snapshots; no network was used.
