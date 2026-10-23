# Shinjuku cultural properties: licence and field check

Status: evidence only. Source `tokyo-muni-shinjuku-cultural-properties-csv` stays `publish_gate: HOLD` in `tools/gis/sources/sources.yaml`; nothing is converted, placed or shipped. This note answers the director's go (2026-10-23) for point landmarks as visual context only (`gteki_role context`, `NOT_FOR_ROUTING`): check commercial use, modification, redistribution and attribution before any conversion PR. No row value is reproduced here; column names and counts come from `2026-10-22-municipal-evidence-profile.md`.

## Source identity

| Item | Value |
| --- | --- |
| Dataset | Tokyo open data catalogue `t131041d0000000114`, organisation 新宿区 |
| Resource | 文化財一覧（自治体標準データセット）, `https://www.city.shinjuku.lg.jp/content/000399966.csv` |
| Acquisition | `docs/gis/acquisitions/tokyo-muni-shinjuku-cultural-properties-csv.json`: 233,350 bytes, SHA-256 `c22c4b4a9d2094a4469abeffac10f2aad03f0bd5f7fb688b35cdea0194f648e4`, size MATCH |
| Rows / coordinates | 233 rows; `緯度` and `経度` filled in every row; axis check NOT_SWAPPED; 5 rows in the Shinjuku window, 31 within 1,000 m of the origin, 0 in the Ikebukuro window |
| CRS | Not declared in the file or the dataset record: UNKNOWN |
| Image fields | `画像` and `画像_ライセンス` are empty in all 233 rows: no photo or photo licence is involved |
| Text fields | `名称` filled in 233/233 rows, `説明` (free text) 233/233, `URL` 0/233 |

## Governing licence

The hashed `package-show` snapshot (SHA-256 `93c368170f20…`) records `license_id` `CC-BY-4.0`, licence title クリエイティブ・コモンズ 表示（CC BY）, licence URL `https://creativecommons.org/licenses/by/4.0/deed.ja`, organisation 新宿区. The resource-level licence field is absent, so the dataset-level grant is the one that applies. The dataset notes and the resource description carry no 「注」 and no individual rule.

The hashed `portal-terms` snapshot (東京都オープンデータ利用規約, 2017-03-24, SHA-256 `74e591bc…`) says content on the catalogue site is licensed under CC BY 4.0 「「注」があるものを除いて」, and may be 「複製、公衆送信、翻訳・変形等の翻案等、自由に利用できます。商用利用も可能です。」. Its credit rule for modified use: state the source credit (title, rights holders, licence name and link) plus that the work was edited, and never present the edited information as if the content provider (東京都又は都内区市町村) made it.

The CC BY 4.0 deed snapshot (`cc-by-4-deed-ja`, SHA-256 `cf5b3d5b…`) supplies the attribution, licence-link and change-indication conditions.

Verdicts below are under the dataset-level grant. The portal terms exclude content with its own individual rules (「個別に適用されるコンテンツを除き」); none is recorded for this dataset or resource.

| Item | Verdict | Evidence |
| --- | --- | --- |
| Commercial use | YES | portal-terms: 「商用利用も可能です」; CC BY 4.0 |
| Modification | YES | portal-terms: 「翻訳・変形等の翻案等、自由に利用できます」; CC BY 4.0 |
| Redistribution | YES, with credit | portal-terms: 「複製、公衆送信…自由に利用できます」; CC BY 4.0 |
| Attribution | REQUIRED | portal-terms credit format plus change notice; CC BY 4.0 §3(a) |

Proposed credit, following the portal-terms format for modified works: この【データ】は、以下の著作物を改変して利用しています。文化財一覧（自治体標準データセット）、新宿区、クリエイティブ・コモンズ・ライセンス 表示4.0国際（https://creativecommons.org/licenses/by/4.0/deed.ja）

## Ward pages (observed, not governing)

These were fetched on 2026-10-23 to check for conflicting terms. They are not in the store and are not acquisition evidence.

- `https://www.city.shinjuku.lg.jp/kusei/joho01_002008.html` (SHA-256 `76a10206561c…`) says 「本ページで公開されているデータ」 is under CC BY 2.1 JP and adds 「当ライセンスは、上記対象データのみに適用されます」. The page does not list this dataset.
- 新宿区オープンデータ利用規約 PDF `https://www.city.shinjuku.lg.jp/content/000199400.pdf` (SHA-256 `6d6e706c51f0…`, 2016-07-13, based on the government standard terms v2.0) covers content on the 新宿区オープンデータポータル. It allows commercial use, requires 出典 and a 加工 notice, puts third-party rights clearance on the user (§3) and is compatible with CC BY 2.1 JP (§6-3).
- The ward portal's culture category page (`opendata_category_00006.html`, SHA-256 `4a0f9459d651…`) links only an older `ckan.odp.jig.jp` 文化財情報 dataset (`jp-tokyo-shinjuku-723-odp`), whose CSV link returned HTTP 404 during research. It does not link the standard dataset above.

So the current standard dataset is published through the Tokyo catalogue under CC BY 4.0, and the ward's CC BY 2.1 JP statement does not cover it. Both are CC BY: the four items above would clear under either.

## Other candidates

- KSJ P12 観光資源 and P32 都道府県指定文化財: both product pages give 使用許諾条件 非商用 (checked 2026-10-23); P32 also withholds Tokyo. BLOCKED.
- 東京都教育委員会 文化財 database: no open licence or download found. Not usable.
- PLATEAU 13104 related: no cultural-property layer identified; its `landmark` layer is UNKNOWN in `poi-rights-s10-s03-related.md`.

## Open items for the director

1. **Text fields (UNKNOWN).** Portal-terms §2 asks users to respect third-party rights, and the ward terms §3 put clearance on the user. Nothing marks `説明` as third-party authored, but nothing clears it either. Recommendation: the conversion carries coordinates and `文化財分類` only, with `名称` shipped only if the director accepts plain names as factual labels (as for S10). `説明` and `URL` stay out.
2. **CRS (UNKNOWN).** No CRS is declared. JGD2011 and WGS84 differ by well under a metre here, so placement is unaffected at landmark scale; the conversion receipt will record the CRS as asserted-unknown, not as fact.
3. **Tokyo portal terms availability.** On 2026-10-23 at about 19:00 JST `https://portal.data.metro.tokyo.lg.jp/terms/` redirected to `/maintenance.html`, so a fresh acquisition is blocked for now. The 2026-10-22 hashed snapshot is the evidence used here; re-acquire before the conversion PR.
4. **Resource freshness.** The server file was modified on 2026-10-22, after the catalogue metadata date of 2025-12-12. The acquisition hash pins the bytes; re-acquiring may change them.
5. **The credit must name 新宿区; whether it must also name 東京都 is unclear.** The portal-terms template reads 「東京都・【その他の著作権者】」, but this dataset's rights holder is 新宿区. Naming both is harmless; the proposed credit names 新宿区, the publisher of record.

## Verdict

Every licence item clears under the dataset's CC BY 4.0 grant, with attribution and a change notice. The source is ready for a bounded conversion PR (coordinates and class only, context role) once the director accepts open items 1 and 5. Items 2 to 4 are recorded in the receipt and need no decision.
