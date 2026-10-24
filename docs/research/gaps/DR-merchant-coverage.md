# DR merchant coverage: Ikebukuro and Shinjuku (count only)

- Tracking: requested by gteki-1b for the Owner; refs #209 #211.
- Counts by a Haiku 5.5 worker; reviewed and corrected by the data-research lead (Hope Center rights status, coverage figures, denominator caveat).
- As of: 2026-10-24 (all pages read on this date unless stated).
- Scope: counts only. No store names, logos, photos, maps or copy are reproduced here. Official names were used in memory for matching against OSM and are not stored.
- Source ids follow `context-DR-merchant-sources.md` (DR-MR-01..17). New ids added here: DR-MR-18 to DR-MR-21.

## 1. Short answer

- **What the denominator is:** only shops listed in the official directories we could read. Shops not listed anywhere, JR East in-station shops (GAP) and the unreadable directories are not in it, so every coverage figure here is an upper bound on true coverage.
- **Can 70% be found by search?** Ikebukuro: **borderline, not yet.** Tokyo Metro, Echika and ISP are importable facts-only (OD-31 / #26); Tobu Hope Center's directory is **not** covered by OD-31 (its rights are UNKNOWN in DR-MR-03; OD-18 covers only simple connection facts), so its 43 entries are pending a decision. Searchable today: 110 of 153 raw (72%), or about 84 of about 127 after de-duplication (about 66%, estimate). With Hope Center given OD-31 treatment: 100% of the listed entries. Shinjuku: no. Only 8 of 51 known (a)-scope entries (16%) are importable today. Odakyu Ace (43 entries) is pending terms, and the Subnade and Keio Mall counts are GAPs.
- **Can a shop get an OSM point?** About 18% of the (a)-scope shops (36 of 200 by name match, estimate). Ikebukuro is about 17% and Shinjuku about 21%. The E27-scope list has one shop, and it matches by name (1 of 1, estimate).
- **70% target:** Ikebukuro is at about 66–72% of listed entries today and reaches 100% of listed entries if Hope Center gets OD-31 treatment (an Owner decision; completeness of the directory list is not established). **Not met** for Shinjuku (16% of the known listed entries; Odakyu Ace terms pending and Subnade / Keio Mall unread).
- **JR East in-station denominator:** GAP. The two search summaries gave no in-station shop counts, so the "including JR" coverage cannot be computed.

## 2. Per-station source tables

### 2.1 Ikebukuro

| Source id | Source | URL | Scope | Count | Read date | Method | Exact or estimate |
|---|---|---|---|---|---|---|---|
| DR-MR-01 | Tokyo Metro Ikebukuro station shops | https://www.tokyometro.jp/station/ikebukuro/shop/index.html | (a) station concourse, incl. 5 Echika-labelled entries | 29 entries listed (WebFetch summary reported 30) | 2026-10-24 | WebFetch | estimate (29 or 30) |
| DR-MR-02 | Echika Ikebukuro | https://www.metropro-sc.jp/echika-ikebukuro/ | (a) directly connected underground facility | 26 entries | 2026-10-24 | WebFetch | estimate (partial listing, no page date) |
| DR-MR-04 | ISP floor guide | https://www.web-isp.co.jp/floorguide/ | (a) underground, east side | 55 (South Hall 33, North Hall 20, Brick Street 2) | 2026-10-24 | WebFetch | exact per read (no pagination) |
| DR-MR-03 / DR-MR-18 | Tobu Hope Center zone pages | https://tobuhopecenter.jp/floorguide/south-zone/ , /center-zone/ , /north-zone/ | (a) underground, west side | 43 (South 23, Center 12, North 8) | 2026-10-24 | WebFetch per zone | exact per zone read; homepage says "about 50" (approximate) |
| DR-MR-05 | Seibu Ikebukuro floor guide | https://www.sogo-seibu.jp/ikebukuro/floor-guide?floor=B2 | (b) department store | not counted | not read | none | GAP |
| (Esola Ikebukuro) | Via Metro page text | not read | (b) nearby, not in-station | about 40 (from Metro page summary) | 2026-10-24 | summary only | estimate, excluded from (a) |

Denominator, (a) scope:
- Raw sum: 29 + 26 + 55 + 43 = **153** (152 named, excluding one placeholder slot).
- Estimated de-duplicated count: about **127**. Echika's page and the Metro page list about 24 of the same shops (estimate, by name). Two more names overlap ISP (estimate). Hope Center names are treated as separate.

Coverage (Ikebukuro):

| Measure | Searchable (importable facts-only) | Denominator | Coverage |
|---|---|---|---|
| Excluding JR, raw, today (Hope Center pending) | 110 (Metro 29, Echika 26, ISP 55) | 153 | 72% of listed (a) |
| Excluding JR, de-duplicated, today | about 84 | about 127 | about 66% (estimate) |
| Excluding JR, raw, if Hope Center gets OD-31 treatment | 153 | 153 | 100% of listed (a) |
| Including JR estimate | not computable | GAP | GAP |

### 2.2 Shinjuku

| Source id | Source | URL | Scope | Count | Read date | Method | Exact or estimate |
|---|---|---|---|---|---|---|---|
| DR-MR-08 | Toei Shinjuku S01 / Oedo E27 merchant list | https://www.kotsu.metro.tokyo.jp/other/kanren/stores/shinjuku.html | (a) station; S01/E27 not split on the page | 5 entries: 1 shop, 4 facilities (lockers, photo booth, ATM) | 2026-10-24 | ego-browser read-only (WebFetch returned an empty shell) | exact |
| DR-MR-09 (dataset f0609135) | S10 CSV, 新宿 | Tokyo Open Data catalog, resource other_stores_shinjuku.csv | same as DR-MR-08 | 5 records (duplicate of DR-MR-08; not added twice) | 2026-10-24 | curl to stdout, parsed in memory, not saved | exact |
| DR-MR-09 (dataset 327d3a06) | S10 CSV, 新宿西口 | other_stores_shinjuku-nishiguchi.csv | (a) station | 10 records, 1 shop, 9 facilities (18 CSV records, 8 blank) | 2026-10-24 | curl to stdout, parsed in memory, not saved | exact |
| DR-MR-15 / DR-MR-20 | Tokyo Metro Shinjuku station shops | https://www.tokyometro.jp/station/shinjuku/shop/index.html | (a) station passages | 6 shop-type entries (4 named, 2 limited-time slots); facilities excluded. Page did not show メトロプロムナード. | 2026-10-24 | WebFetch | exact per read |
| DR-MR-17 (redirects to odakyu-sc.com) | Odakyu Ace shop search category | https://www.odakyu-sc.com/odakyu-ace/shopsearch/category/ | (a) underground facility | 43 listed | 2026-10-24 | WebFetch | estimate (category listing may be partial) |
| DR-MR-10 | Shinjuku Subnade | https://www.subnade.co.jp/shop/ | (a) underground facility | GAP (connection refused) | attempted 2026-10-24 | WebFetch | GAP |
| DR-MR-16 | Keio Mall | https://www.keio-mall.jp/ | (a) underground facility | GAP (host did not resolve) | attempted 2026-10-24 | WebFetch | GAP |
| (Lumine) | Lumine Shinjuku | not read | (b) above-ground building (classification only) | GAP | not read | none | GAP |

Denominator, (a) scope, known sources: 1 + 1 + 6 + 43 = **51** (Subnade and Keio Mall not included; they are GAPs, so the denominator is understated).

Coverage (Shinjuku):

| Measure | Searchable | Denominator | Coverage |
|---|---|---|---|
| Excluding JR estimate | 8 (Toei 1, S10 西口 1, Metro 6) | 51 | **16%** |
| Odakyu Ace treated as searchable (if terms clear) | 51 | 51 | 100% of known, but Subnade and Keio GAPs keep it unreliable |
| Including JR estimate | 8 | GAP | GAP |

Odakyu Ace terms are UNKNOWN (pending terms). Its 43 entries are not searchable until terms are confirmed.

E27 scope: the Toei list has 1 shop, and the page does not split S01 from E27. The E27-scope share is 1 of 1 by name match.

## 3. OpenStreetMap positions

Overpass queries and retrieval times (UTC) are listed in section 4. Counts only. OSM data is ODbL and nothing is imported. Matching was by normalised name (NFKC, lower case, spaces and punctuation removed), counted as a match when names were equal or one contained the other (4 or more characters). Matching is name-only and within the box, so it does not confirm location. The box includes above-ground shops.

| Scope | Official names | Matched to an OSM point in the box | Share |
|---|---|---|---|
| Ikebukuro, Metro list | 28 named (plus 1 placeholder) | 5 | 18% (estimate) |
| Ikebukuro, Echika list | 26 | 6 | 23% (estimate) |
| Ikebukuro, ISP list | 55 | 10 | 18% (estimate) |
| Ikebukuro, Hope Center lists | 43 | 5 | 12% (estimate) |
| Ikebukuro, (a) total (raw, overlaps not removed) | 152 | 26 | 17% (estimate) |
| Shinjuku, Odakyu Ace list | 43 | 9 | 21% (estimate) |
| Shinjuku, Metro list | 4 | 0 | 0% (estimate) |
| Shinjuku, Toei (E27 scope) | 1 | 1 | 100% (estimate) |
| Shinjuku, (a) known total | 48 | 10 | 21% (estimate) |
| Both stations, (a) total | 200 | 36 | **18%** (estimate) |

OSM underground-tagged subsets (level below 0, or location=underground):
- Ikebukuro: 68 elements, of which 45 are named shop or amenity elements. 24 are indoor-tagged.
- Shinjuku: 3,231 elements, of which 182 are named shop or amenity elements. Most of the rest are indoor-tagged objects without names.

## 4. Overpass queries (read-only, endpoint https://overpass-api.de/api/interpreter)

Boxes: Ikebukuro lat 35.726–35.733, lon 139.707–139.715. Shinjuku lat 35.686–35.695, lon 139.695–139.705.

Q1, Ikebukuro, named shop or amenity in the box (`q_ikb_all`, file ikb_all.json, 505 elements, 402 unique names). Retrieved 2026-10-24 after 02:37:17 UTC (exact response time not logged; the OSM base timestamp is 2026-10-24T02:36:20Z).
```
[out:json][timeout:90];
(
  nwr["name"]["shop"](35.726,139.707,35.733,139.715);
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.726,139.707,35.733,139.715);
);
out tags center;
```

Q2, Ikebukuro, underground subset (`q_ikb_ug`, 68 elements, 45 named). Retrieved 2026-10-24T02:38:47Z.
```
[out:json][timeout:90];
(
  nwr["name"]["shop"](35.726,139.707,35.733,139.715)["level"~"^-"];
  nwr["name"]["shop"](35.726,139.707,35.733,139.715)["location"="underground"];
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.726,139.707,35.733,139.715)["level"~"^-"];
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.726,139.707,35.733,139.715)["location"="underground"];
  nwr["indoor"](35.726,139.707,35.733,139.715);
);
out tags center;
```

Q3, Shinjuku, named shop or amenity in the box (`q_sjk`, 989 elements). Retrieved 2026-10-24T02:39:07Z.
```
[out:json][timeout:90];
(
  nwr["name"]["shop"](35.686,139.695,35.695,139.705);
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.686,139.695,35.695,139.705);
);
out tags center;
```

Q4, Shinjuku, underground subset (`q_sjk_ug`, 3,231 elements, 182 named). Retrieved 2026-10-24T02:39:21Z.
```
[out:json][timeout:90];
(
  nwr["name"]["shop"](35.686,139.695,35.695,139.705)["level"~"^-"];
  nwr["name"]["shop"](35.686,139.695,35.695,139.705)["location"="underground"];
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.686,139.695,35.695,139.705)["level"~"^-"];
  nwr["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pharmacy|bank|atm)$"](35.686,139.695,35.695,139.705)["location"="underground"];
  nwr["indoor"](35.686,139.695,35.695,139.705);
);
out tags center;
```

The first attempts returned HTTP 406 (no Accept header) and HTTP 400 (filter syntax); both were fixed and reran. The JSON files are small (about 0.2 MB and under), kept in this directory.

## 5. Estimates and GAPs

Estimates:
- E1: Metro Ikebukuro list is 29 (names) or 30 (WebFetch summary).
- E2: Echika list (26) and Metro list overlap by about 24 names. De-duplicated (a) about 127.
- E3: Hope Center total is 43 (exact per zone). The homepage's "about 50" is approximate.
- E4: Odakyu Ace category listing (43) may be partial.
- E5: Esola Ikebukuro about 40 shops, nearby and not in-station, classed (b). Taken from the Metro page summary.
- E6: OSM match rates are name-only and box-wide. They do not confirm that a shop's point is in the station.
- E7: The E27 1-of-1 match is name-only.

GAPs:
- G1: JR East in-station shop count for Ikebukuro and Shinjuku. Search summaries gave no counts. The "including JR" coverage cannot be computed.
- G2: Shinjuku Subnade shop list (connection refused). Its (a)-scope count is missing, which understates the Shinjuku denominator.
- G3: Keio Mall (host did not resolve). Same issue.
- G4: Lumine Shinjuku not read. Classed (b) without verification.
- G5: Seibu Ikebukuro floor counts not read. Classed (b), so not in the denominator anyway.
- G6: Odakyu Ace and Keio Mall terms (pending terms). Odakyu Ace is excluded from searchable.
- G9: Tobu Hope Center directory rights (DR-MR-03 UNKNOWN; not in OD-31). Owner question: give it OD-31 treatment? That alone moves Ikebukuro from about 66–72% to 100% of listed entries.
- G7: Metro Shinjuku page does not mention メトロプロムナード; no separate count for it.
- G8: Exact retrieval time of the first successful Q1 response is not logged.

## 6. Method

- Official pages read with WebFetch on 2026-10-24. The Toei page returned an empty shell via WebFetch and was read with ego-browser (one tab, read-only, closed after reading). The Subnade and Keio Mall attempts failed with connection refused and DNS failures. Odakyu Ace redirected to odakyu-sc.com and was read at the new URL.
- S10 CSVs were pulled with curl to stdout and parsed in memory with Shift_JIS decoding. Nothing was saved to disk. Counts are records with any non-empty field.
- Store names were read for matching in context only. They are not written to this file or to any other file.
- Searchable status: Metro and Toei (#26 facts-only), ISP (OD-23), Echika, Subnade and chain pages (OD-31) are importable facts-only. Hope Center's directory (DR-MR-03, rights UNKNOWN, not in OD-31's list), Keio Mall and Odakyu Ace are pending. (The worker's brief wrongly listed Hope Center as importable; the lead corrected the figures.)
- No git, no oracle or ChatGPT, no contact. Browser used once, read-only. JR East: two web searches only (summaries only, no counts found).
