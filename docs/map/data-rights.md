---
area: data/rights
owner: data-research lead
updated: 2026-10-26 20:26 JST
---

# Data rights: OD-34 precedents and source classes

## What it does

A quick reference for "may we use this source, and how?". The rulings themselves live in `docs/research/owner-decisions-pending.md` (OD-02, OD-23, OD-31, OD-32, OD-33, **OD-34** with five rounds) and, for GIS sources, in the generated `docs/gis/rights/README.md`. Rights and truth rulings belong to the director (the Owner where reserved); this page only applies them. New questions go to the rights lane on **#165**.

## Precedents for a new source (OD-34)

Read the site's own terms, quote the clause with URL and retrieval time (zoned), then:

| Terms say | Class | Precedent |
| --- | --- | --- |
| Use beyond private use / what the law allows is banned | **Facts only** | §2 (LUMINE type): facts are not copyright works |
| Only a copyright line, no use clause | **Facts only** | round 2 (小田急百貨店) |
| A request (「…ないようお願い」), not a ban | **Facts only** | round 2 (Seibu shop portal) |
| Ban on business / profit-making use | **Corroboration only** | round 2 (Tobu Railway §8), round 3 (そごう・西武): GTEki is meant to become a business |
| Rail operator prints a flat reuse refusal | **Corroboration only**, rights UNKNOWN until the terms check is accepted | round 5(a) |
| Flat ban with no legal exception | **Not used (OD-02 A)**, not even as a cross-check | §3 (ecute type), round 4 |
| Terms page could not be read | **UNKNOWN**, nothing imported | round 5(d) |
| Government dataset | Judged **per dataset**: CC BY → primary evidence with credit; non-commercial → not used | round 5(b) |
| Shop name from a source outside excluded sites (chain's own page, ward material) | Allowed | §4 |

A ban counts **only with a quoted clause**; "may be risky" without a quote is not a ban. Login-gated pages are never fetched (GAP). Default curl User-Agent only.

## What each class allows

- **Primary evidence** (open licence): data may be imported, transformed and shipped with the recorded credit.
- **Facts only** (OD-23 / OD-31 / OD-33 treatment): name, category, floor or zone, the entrance as the source words it. UNVERIFIED, POI attributes only, **never route evidence**. No copied text, logos, photos, maps or layouts. Keep source id + retrieval date.
- **Corroboration only**: may be cited as "consistent with <page> (URL, time)" for a fact from another source. No transcription, aliases, screenshots or sole-source use.
- **Not used**: not imported, not cross-checked. Such chains are candidates for the merchant self-service form (#438).
- **Field receipts** (`team_field`): the team's own sign readings; only the read text is published. Photos stay private evidence, never committed.

## Source classes

| Source | Class | Basis |
| --- | --- | --- |
| PLATEAU 3D city model (bldg, ubld, tran) | Primary (PDL 1.0 / CC BY 4.0) | `docs/gis/rights/README.md` |
| PLATEAU related: station, railway, border | Primary, with conditions | same |
| PLATEAU related: shelter, park, emergency route (KSJ P20/P13/N10, non-commercial) | RESTRICTED: internal only | same |
| PLATEAU related: landmark | UNKNOWN | same |
| KSJ N02 / N03 (CC BY 4.0) | Primary with credit; context lines only | OD-34 round 5(b) |
| Tokyo S10 store CSVs (Toei 駅構内のお店) | Primary, with conditions | `docs/gis/rights/README.md` |
| Tokyo S03 新宿駅周辺: geometry + factual fields | Primary, with conditions | same |
| Tokyo S03: `description` / `url` prose, reference-PDF illustration | UNKNOWN | same |
| Toei open-data CSVs (barrier-free, EV inspection, station info) | Primary (CC BY 4.0) | #501 ruling 2026-10-25 16:27 JST |
| MLIT ほこナビ E-27 (Shinjuku station data) | Published under Owner override; licence unconfirmed | #16 |
| Toei site (kotsu.metro.tokyo.jp) | Facts only | OD-34 round 2 |
| Tokyo Metro site | Facts only, cited via Wayback | OD-34 §2 |
| Metro Properties (Echika, Esola), ISP, LUMINE, LUMINE EST, NEWoMan, atré | Facts only | OD-34 §2, OD-23 |
| 東武百貨店, Tobu Hope Center, 小田急百貨店, Seibu shop portal, 豊島区 | Facts only | OD-34 §2, rounds 2 and 5(c) |
| JR East (jreast.co.jp) | Corroboration only | OD-02 A + OD-34 §1 |
| Tobu Railway, そごう・西武 (西武池袋本店 site) | Corroboration only | OD-34 rounds 2–3 |
| 小田急電鉄, 京王電鉄 | Corroboration only; UNKNOWN | OD-34 round 5(a) |
| ecute / JR Cross (incl. NewDays), 小田急エース, 京王モール, doutor, 眼鏡市場 | Not used | OD-34 §3, round 4 |
| 京王百貨店 site, 新宿サブナード site, メトロプロムナード | UNKNOWN (read failed) | OD-34 round 5(d) |
| 交通エコロジー・モビリティ財団 transfer routes | UNKNOWN, pending | #165 (issuecomment-6407037124) |
| ODPT | GAP: developer registration required | #165 (issuecomment-6413383137) |
| JCSC SC list (西武池袋本店 store POI) | Facts only | #538 |

Department stores: one store POI each; brand lists are a facts-only **tenant dataset** (`tenants.json`), not POIs (§5). Hours: OD-32 (first-party, dated, "may have changed" label).

## Pitfalls

- A permissive reading by ChatGPT is a draft; check it against the quoted clause before relying on it.
- Corroboration-only and not-used sites must not appear as `source` on any POI; review rejects it.
- Nothing from a POI source may be committed literally under `docs/gis/**` (#124).
- When a rights class changes, update this table and the gap table's PENDING terms in the same PR.

## Related PRs and issues

- OD-34: [decision, #377 comment 6382700098](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6382700098); terms reads [#415](https://github.com/nurockplayer/gteki/pull/415); Odakyu Dept #429, #439; chain pages #451
- OD-31 / OD-32: [#360 comment 6377632614](https://github.com/nurockplayer/gteki/pull/360#issuecomment-6377632614) · OD-33: [#377 comment 6378920311](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6378920311)
- Rights lane: [#165](https://github.com/nurockplayer/gteki/issues/165)
- Notes: [[data-stations]] · [[data-research-lines]] · [[data-gis]]
