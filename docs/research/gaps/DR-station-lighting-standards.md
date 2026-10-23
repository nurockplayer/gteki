# DR-station-lighting-standards: public Japanese lighting references for station concourses, passages, stairs

- Tracking: #165 item R15 (GTEki data research, docs only, low priority)
- Requested by: Godot lighting lane (godot-hq-c4, G-4 lighting reference)
- Date researched: 2026-10-22
- Scope notice: GENERAL REFERENCE ONLY. Nothing here is station-specific evidence for any GTEki station.

## Summary

- JIS Z 9110 (lighting basics) was revised again on 2024-12-20 (JIS Z 9110:2024). The 2010 revision added quality items (uniformity, glare, colour rendering) and a 2011 amendment added ranges to the recommended values. The 2024 revision removed the indoor/outdoor/sports requirements; those now live in JIS Z 9125 (indoor, 2023), JIS Z 9126 (outdoor) and JIS Z 9127 (sports).
- The space-by-space recommended illuminance for stations (concourse, passage, stairs, platform) is in JIS Z 9125:2023. The JIS text could not be read (JISC is view-only, JSA preview was down for maintenance). No station value was obtained from a verified source. Do not invent one.
- General minimum colour rendering: Ra 20 in JIS Z 9110:2024 (secondary source, UNVERIFIED against JIS text). No station-specific Ra obtained.
- MLIT 移動等円滑化整備ガイドライン (旅客施設編, 令和7年9月 edition) is qualitative: no lux figures. It says to secure adequate illuminance on routes, concourses, passages and stairs, avoid extreme dark spots and glare, and for railway station buildings to refer to the illuminance given in JIS Z 9110. It gives stair-step-edge guidance as luminance contrast, not lux.
- The guideline cites one real-station design example (Fukuoka Subway Nanakuma line, 2006 paper): concourse average 400 lx, entrance canopy average 300 lx, platform 300 lx or more with 5000 K fluorescent lamps. This is one operator's design example from fluorescent era, not a standard.
- No Toei / Tokyo Metro / JR East public lighting statement with lux or colour temperature was found. Colour temperature examples found are vendor case studies from other operators (UNVERIFIED as general practice).

## Findings per question

### Q1. JIS Z 9110 / JIS Z 9125: illuminance and Ra for station spaces

- Edition history (from vendor and association summaries, not JIS text): 1979 version gave recommended illuminance only; 2010 revision renamed it 照明基準総則 and added uniformity, discomfort glare and colour rendering; 2011 amendment added ranges to recommended values; 2024-12-20 revision (JIS Z 9110:2024) is the latest found. Fact source: DR-LT-01 (read), DR-LT-05 (search summary).
- 2024 revision scope change: indoor, outdoor and sports lighting requirements removed from Z 9110 and left to Z 9125:2023, Z 9126:2021, Z 9127:2020. Illuminance step scale now tops out at 10,000 lx with a 0.5 lx minimum. General minimum Ra is 20. Emergency lighting now covered. Source: DR-LT-01 (PAGE_READ of the vendor explanation page, which itself is a secondary source).
- Station values: the vendor page says it lists no values for station, concourse or stairs; the specific-space table is in JIS Z 9125:2023. We could not read it. Searches for a secondary-source station figure returned only unrelated space types (office 750 lx, corridor 300 lx assumption in a ministry document, entrance hall 100 lx in an industry sheet). These are not station values and are not recorded as facts.
- Note: MLIT guideline refers to "JIS Z 9110 illuminance" for stations. Since the 2024 revision moved the per-space tables to Z 9125, older editions of Z 9110 (2010/2011) contained the table the guideline pointed to. Whether the guideline text has been updated to point to Z 9125 is not confirmed (the reading here still says Z 9110).
- Conclusion: no verified lux or Ra for station concourse, passage, stairs or platform. Lane should either buy/view JIS Z 9125:2023 via JISC read-only viewer manually or treat lux values as an art-direction choice labelled non-sourced.

### Q2. Typical colour temperature for station lighting

- No operator statement found (see Q4).
- MLIT guideline example (PAGE_READ, DR-LT-02): Fukuoka Subway Nanakuma line platform lighting used 5000 K fluorescent lamps, platform average 300 lx or more; concourse average 400 lx; entrance canopy average 300 lx. Source cited inside the guideline: a 2006 Illuminating Engineering Institute of Japan journal paper (not read directly). One example only.
- Vendor case studies (search summary only, UNVERIFIED as typical): Osaka Monorail Expo Park station concourse/platform dimmable colour scheduling from 5000 K 100% at first train to 2700 K 70% late night (Panasonic). JR East Ueno Park-exit station building exterior up-lighting seasonal 2700 K to 4000 K (exterior, not interior). A Panasonic Tokyo-area case shows a concourse base light set at 5000 K 100% (station not identified in the excerpt). Tokyu Jiyugaoka station simulation: average 214 lx fluorescent vs 221 lx LED (Panasonic, simulated, not a standard).
- Conclusion: no authoritative "typical". Observed values in examples cluster around neutral to cool white (about 4000 to 5000 K) with warm (2700 K) late-night schedules in one case. Mark as weak evidence.

### Q3. MLIT 移動等円滑化整備ガイドライン

- Latest edition found: 令和7年9月 (published 2025-09-30), part of the combined 旅客施設・車両等・役務の提供ガイドライン; the 旅客施設編 combined PDF is linked from the MLIT index page. Previous revision 令和6年3月.
- Read (PAGE_READ via local text extraction of the split PDFs, not downloaded to the repo): 第2部 1 移動経路 (DR-LT-02), 第3部 1 鉄軌道駅 (DR-LT-03), 第6部 役務 (DR-LT-04). Edition year in the PDF body not verified from text; the 令和7年9月 date is from the MLIT index page.
- Facts (paraphrased):
  - Routes for accessible movement: secure adequate brightness through daylight and lighting, account for glare sensitivity and night blindness, avoid extreme dark spots and glare, keep safe passage during power-saving; for railway station buildings, take the illuminance in JIS Z 9110 as a reference. No lux figure in the guideline.
  - Concourses and passages: lighting equipment is required (mandatory-level item); standard-level item is adequate brightness without extreme dark spots or glare, again referencing JIS Z 9110 for stations.
  - Stairs: when lighting is installed, use it to secure appropriate illuminance (mandatory-level item), maintain lighting for older and low-vision users, refer to JIS Z 9110 for stations, and keep stair illuminance even under power-saving (desirable). Step edges are addressed by luminance contrast (brightness, hue or chroma difference) and no protruding nosing, not by lux.
  - Platforms: lighting required; consider daylight and illuminance so that lighting reaches both platform ends.
  - A reference note says the right illuminance for low-vision and elderly users varies (too dark and too bright both hinder), and that research is still needed; floor and wall colours change glare and visibility.
- Conclusion: qualitative guidance only. The only numbers are from the Fukuoka example above.

### Q4. Operator public lighting statements (Toei, Tokyo Metro)

- Searches found no Toei, Tokyo Metro or JR East release giving station lux or colour temperature. Tokyo Metro Ginza station renewal (2020) uses line-colour lighting for wayfinding (search summary only, no figures). Nothing recorded as fact beyond that.
- Not exhausted: official operator sustainability reports, LED conversion releases and design manuals were not searched site-by-site (no site search tool, WebFetch only on given URLs).

## Source table

| ID | Title | Publisher | URL | Edition / date | Licence / terms | Read status | Fact |
|---|---|---|---|---|---|---|---|
| DR-LT-01 | JIS Z 9110 explanation page (照明基準総則 revision summary) | Panasonic (vendor, secondary) | https://www2.panasonic.biz/jp/lighting/plam/jis-z9110/ | JIS Z 9110:2024 revised 2024-12-20 | Vendor web content, paraphrased only | PAGE_READ via WebFetch (summarised by fetch tool) | 2024 revision moved indoor tables to Z 9125; min Ra 20; 0.5 to 10,000 lx scale; no station values. UNVERIFIED against JIS text |
| DR-LT-02 | バリアフリー整備ガイドライン 旅客施設編 第2部1 移動経路 | MLIT (国土交通省) | https://www.mlit.go.jp/sogoseisaku/barrierfree/content/001913507.pdf | 令和7年9月 edition (per MLIT index) | Government publication, paraphrased | PAGE_READ (pdftotext, keyword and section reads, not full read) | Qualitative brightness requirements; refers to JIS Z 9110 for stations; Fukuoka Nanakuma example values (400/300/300 lx, 5000 K) |
| DR-LT-03 | 同 第3部1 鉄軌道駅 | MLIT | https://www.mlit.go.jp/sogoseisaku/barrierfree/content/001913510.pdf | 令和7年9月 | as above | PAGE_READ (keyword hits and platform section) | Platform lighting required; no lux |
| DR-LT-04 | 同 第6部 役務の提供に関するガイドライン | MLIT | https://www.mlit.go.jp/sogoseisaku/barrierfree/content/001913539.pdf | edition not verified (file timestamp 2025-09-30) | as above | PAGE_READ (keyword hits) | Stairs/route illuminance wording, JIS Z 9110 reference, keep illuminance during power saving |
| DR-LT-05 | JIS Z 9110:2024 / Z 9125:2023 listing and previews | JSA / JISC | https://webdesk.jsa.or.jp/preview/pre_jis_z_09110_000_000_2024_j_ed10_ch.pdf and ..._z_09125_000_000_2023_j_ed10_ch.pdf | 2024 / 2023 | JIS text copyrighted; JISC view-only | NOT READ: both URLs returned a JSA maintenance notice (from 2026-10-22 16:00 JST) | Edition identities known from search summaries only |
| DR-LT-06 | MLIT guideline index page (旅客施設編) | MLIT | https://www.mlit.go.jp/sogoseisaku/barrierfree/sosei_barrierfree_mn_000001.html | 令和7年9月 version, combined PDF 001964852 | Government publication | PAGE_READ via WebFetch | Edition date and PDF list |
| DR-LT-07 | MLIT press: guideline revision announcements | MLIT | https://www.mlit.go.jp/report/press/sogo09_hh_000412.html (and related) | 2025-09-30 revision; 令和6年3月 previous | Government | Search summary only | Revision dates |
| DR-LT-08 | Station lighting case studies (Osaka Monorail, JR East Ueno, Tokyu Jiyugaoka) | Panasonic cases | https://www2.panasonic.biz/jp/lighting/plam/case/lighting_style10/field03.html and https://www2.panasonic.biz/jp/solution/works/jiyugaoka.html | various | Vendor, paraphrased | Search summary only | Colour temperature schedule examples. UNVERIFIED, vendor marketing |

## Gaps

- Actual JIS Z 9125:2023 recommended illuminance and Ra for station concourse, passage, stairs, platform. Not obtained; JSA preview down; JIS tables must not be copied anyway. A person can view via JISC read-only viewer.
- Whether the MLIT 令和7年 guideline text now points to Z 9125 rather than Z 9110 for stations; not confirmed.
- Combined 令和7年 PDF (001964852) not read in full; split parts read only by keyword.
- No operator (Toei, Tokyo Metro, JR East) statement on lux or colour temperature. Official sustainability reports and design manuals not searched.
- The Fukuoka example is fluorescent-era (2006) and a single station line.
- Per-source numeric values from vendors are unverified.

## Handoff for godot-hq-c4

- Treat all of this as general reference, not station evidence. Do not cite any lux or Kelvin value as "the standard" for stations.
- Safe statements: (1) Japanese accessibility guidance requires lighting in concourses, passages, stairs, platforms and calls for no extreme dark spots or glare (qualitative, MLIT 令和7年9月). (2) Step edges are made legible by brightness/hue contrast, so in the scene rendering, a luminance-contrast stair nosing matters more than raw intensity. (3) One documented design example: concourse about 400 lx average, platform 300 lx or more, 5000 K (Fukuoka, 2006, fluorescent).
- Suggested art-direction defaults, clearly labelled non-sourced: neutral-to-cool white around 4000 to 5000 K for concourse and platform, evenly lit with soft gradients and no hard dark pockets, brighter stairs than adjacent floor. Verify later with on-site photos only if the site policy allows (sign photos and on-site observations are private evidence per the earlier research decisions).
- If a defensible number is needed, someone with JISC viewer access should read JIS Z 9125:2023 for the station rows and record only the few needed values here with the source.
