# DR-imagery-materials: reference imagery and material sources (R4)

## 1. Header

- **Gap refs:** M0-01 rank 4 (`docs/gis/research/m0-01-coverage-gaps.md`), rows IK-12 and SJ-17 (imagery, photos, textures: "no reference imagery or real material source is recorded"). Dossier cards `DOS:X4` (Wikimedia per-file photos), `DOS:X5` (Mapillary), `DOS:X6` (Poly Haven CC0), `DOS:X7` (Google, excluded). Tracking issue #165, item R4. Art direction: Issue #94.
- **Checked:** 2026-10-22.
- **Owner rules applied:** public sources only; no external party contacted (no uploader, Mapillary support or operator was written to); PLATEAU textures excluded (Q9); no third-party photo, map, logo or texture enters the repo (links, licence metadata and short neutral descriptions only).
- **Method:** (a) Wikimedia Commons MediaWiki API, read-only: category listings, `categoryinfo` counts and per-file `extmetadata` (author, licence short name, date, description). (b) Terms and licence pages read with WebFetch (Poly Haven, ambientCG, Mapillary terms, Creative Commons deeds, Commons reuse guidance). (c) One read of Poly Haven's public asset list (`api.polyhaven.com/assets?t=textures`, 869 textures) and ambientCG's public search API, for names and slugs only. (d) **No image was downloaded or opened.** Every "people/logos" cell is therefore inferred from the file description and the subject (for example a ticket-gate photo shows operator signage by nature), never from looking at the pixels; each cell says "not inspected" where it is not described. Whoever picks a file must open its Commons page and reject any with identifiable faces or prominent brand/ad content.
- **Status words:** all sources here are `REFERENCE_ONLY` or `REUSABLE_WITH_CONDITIONS` in the vocabulary of `docs/research/source-register.md`; none is imported, hashed or accepted. Nothing in this file is a legal clearance.

## 2. Summary

| Need | Candidate source | Licence | Can ship as texture? | Reference-only OK? |
| --- | --- | --- | --- | --- |
| Look of real Ikebukuro B1 passages, gates, signage style | Commons per-file photos (section 3, IK) | per file: CC0, CC BY 2.0/3.0/4.0, CC BY-SA 3.0/4.0 | CC0 files: yes after a content check (logos, people). CC BY: Owner decision (credit in `NOTICE`). CC BY-SA: Owner decision, share-alike (see below). Photos are not tileable and carry signage, so a photo is a poor texture in any case | Yes, as a viewing aid for artists |
| Look of real Shinjuku (E27, E01, Keio New Line, west underground plaza, Subnade) | Commons per-file photos (section 3, SJ) | same | same | Yes |
| East/west underground plazas of Ikebukuro | none found on Commons (no category or file described as such) | n/a | n/a | gap: see section 7 |
| Metro Promenade | none found on Commons by name | n/a | n/a | gap: see section 7 |
| Generic PBR materials: tile, terrazzo, granite, concrete, plaster, rubber, linoleum, painted metal | Poly Haven (section 4) | CC0 (site licence page) | Yes (CC0: commercial use, modification, redistribution; no credit needed) | Yes |
| Same, more variety (terrazzo x many, office ceiling, rubber, metal) | ambientCG (section 4) | CC0 1.0 Universal | Yes | Yes |
| Stainless panel, ceiling-tile grid, tactile paving as photographic materials | not found by name in Poly Haven; ambientCG has `OfficeCeiling001`-`006`, `Metal*`, no tactile | CC0 | Yes, but Lane E procedural packs already target these (section 6) | Yes |
| Street-level imagery | Mapillary | CC BY-SA 4.0 (per its Terms and help centre, wording partly via search snippet) | Owner decision, share-alike; **coverage of underground areas not established** | Yes, if a frame exists; not checked |
| Street-level imagery | Google Maps / Street View | service terms (dossier `DOS:X7`) | No | Not as a data source; ordinary viewing is not prohibited |
| PLATEAU aerial-derived textures | MLIT PLATEAU | n/a | No (Owner Q9 = Yes: excluded) | n/a |

**Reference-only versus derivative.** Looking at a CC BY-SA photo to learn what terrazzo or a ceiling grid looks like, then painting or synthesising a new surface from scratch, is a reference use; the licence conditions attach to copying or adapting the photo itself. Cropping, re-colouring, tiling or baking a share-alike photo into a texture or model is an adaptation, so the result must be offered under the same or a compatible licence. The README licence split puts Lane E original art under CC BY 4.0; a CC BY-SA 4.0 derivative cannot be folded into that without a decision. That is why every share-alike file is marked "Owner decision" for derivative use.

## 3. Per-file photos (Wikimedia Commons)

Id convention: after section 1, a bare IK-nn or SJ-nn in prose means file record DR-IMG-IK-nn or DR-IMG-SJ-nn. It is not the gap-matrix row of the same number (rows IK-12 and SJ-17 are named only in section 1).

Column notes. *Licence* is the Commons `LicenseShortName` string at check time and is uploader-asserted. *Date taken* is Commons `DateTimeOriginal`/`DateTime`. *Area as described* is the file description, truncated to 110 characters, unchanged otherwise; where the description is only an address or a camera name, the area is "as categorised" (see the note in the row). *People/logos*: "not inspected" means unknown. Files are linked, never copied. File page URL contains the full per-file author, licence and history.

### 3a. Ikebukuro (池袋駅)

Selection note: Commons holds few photos of the public B1 passages. The `panoramio` series (IK-03 to IK-06) carries only a street address as its description; its categories are `Ikebukuro Station South Passage`, `Azalea Road (Ikebukuro Station)`, `Entrance 28/29/35 of Ikebukuro Station` and `Ikebukuro Station South Gate (JR East)`. Which area each frame shows must be read from the file page and cannot be assumed. Gate photos (IK-10 to IK-15) show ticket gates, which are the paid-area boundary; the passage in front of them is the public side. IK-12 and IK-13 carry descriptions that name the opposite gate from the file name; treat the description as unreliable and check the file page.

| id | file page URL | author | licence | date taken | area as described | people/logos | useful for |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-IMG-IK-01 | <https://commons.wikimedia.org/wiki/File:Fire_alarm_-Ikebukuro.jpg> | midorisyu | CC BY 2.0 | 12 April 2010, 14:50 | A fire alarm button and emergency phone on an underground path of Ikebukuro Station, Tokyo, Japan.(Nikon D40x  | close-up of device; not inspected for people | fixtures, signage style |
| DR-IMG-IK-02 | <https://commons.wikimedia.org/wiki/File:Safety_first_whilst_boarding_the_trains_(11905525516).jpg> | George Alexander Ishida Newman | CC BY 2.0 | 5 March 2011, 10:00 | An underground passageway in Ikebukuro Station in Tokyo, Japan | likely passers-by (commuter scene); not inspected | ceiling, lighting, wall finish |
| DR-IMG-IK-03 | <https://commons.wikimedia.org/wiki/File:1_Chome-1_Nishiikebukuro,_Toshima-ku,_T%C5%8Dky%C5%8D-to_171-0021,_Japan_-_panoramio_(3).jpg> | 運転太郎 | CC BY 3.0 | 23 November 2015 | 1 Chome-1 Nishiikebukuro, Toshima-ku, Tōkyō-to 171-0021, Japan | not inspected | floor, ceiling, wall panels |
| DR-IMG-IK-04 | <https://commons.wikimedia.org/wiki/File:1_Chome_Nishiikebukuro,_Toshima-ku,_T%C5%8Dky%C5%8D-to_171-0021,_Japan_-_panoramio_(11).jpg> | 運転太郎 | CC BY 3.0 | 23 November 2015 | 1 Chome Nishiikebukuro, Toshima-ku, Tōkyō-to 171-0021, Japan | not inspected | floor, ceiling, columns |
| DR-IMG-IK-05 | <https://commons.wikimedia.org/wiki/File:1_Chome_Nishiikebukuro,_Toshima-ku,_T%C5%8Dky%C5%8D-to_171-0021,_Japan_-_panoramio_(13).jpg> | 運転太郎 | CC BY 3.0 | 23 November 2015 | 1 Chome Nishiikebukuro, Toshima-ku, Tōkyō-to 171-0021, Japan | not inspected | floor, ceiling, columns |
| DR-IMG-IK-06 | <https://commons.wikimedia.org/wiki/File:1_Chome_Nishiikebukuro,_Toshima-ku,_T%C5%8Dky%C5%8D-to_171-0021,_Japan_-_panoramio_(7).jpg> | 運転太郎 | CC BY 3.0 | 23 November 2015 | 1 Chome Nishiikebukuro, Toshima-ku, Tōkyō-to 171-0021, Japan | not inspected | wall finish, signage |
| DR-IMG-IK-07 | <https://commons.wikimedia.org/wiki/File:Ikebukuro_Station_(49820263363).jpg> | Dick Thomas Johnson from Tokyo, Japan | CC BY 2.0 | 2019-12-20 03:48 | 池袋駅 | not inspected | floor tile, ceiling panels |
| DR-IMG-IK-08 | <https://commons.wikimedia.org/wiki/File:Ikebukuro_Station_(49820808286).jpg> | Dick Thomas Johnson from Tokyo, Japan | CC BY 2.0 | 2019-12-20 03:47 | 池袋駅 | not inspected | floor tile, ceiling panels |
| DR-IMG-IK-09 | <https://commons.wikimedia.org/wiki/File:%E5%8C%97_%E6%94%B9%E6%9C%AD(49820805901).jpg> | Dick Thomas Johnson from Tokyo, Japan | CC BY 2.0 | 20 December 2019, 03:48 | 池袋駅 | not inspected; hanging signs and ads probable | signage style, gate-line finishes |
| DR-IMG-IK-10 | <https://commons.wikimedia.org/wiki/File:Ikebukuro-STA_Central-passage-central-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-05-29 | Central passage central ticket gate of Ikebukuro Station on the Tokyo Metro Marunouchi Line | not inspected; operator signage visible by nature of subject | ceiling, lighting, signage style |
| DR-IMG-IK-11 | <https://commons.wikimedia.org/wiki/File:Tokyo-Metro_Ikebukuro-STA_Central-passage-West-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2023-04-22 | Central passage west ticket gates of Tokyo Metro Ikebukuro Station (Marunouchi Line and Fukutoshin Line ticket | not inspected; operator signage visible by nature of subject | ceiling, columns, signage style |
| DR-IMG-IK-12 | <https://commons.wikimedia.org/wiki/File:Tokyo-Metro_Ikebukuro-STA_South-passage-West-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-10-22 | Tokyo Metro Ikebukuro Station south passage west ticket gate (Yurakucho Line ticket gate) | not inspected; operator signage visible by nature of subject | ceiling, lighting, signage style |
| DR-IMG-IK-13 | <https://commons.wikimedia.org/wiki/File:Tokyo-Metro_Ikebukuro-STA_South-passage-East-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-10-22 | Tokyo Metro Ikebukuro Station South Passage East ticket gate (Yurakucho Line ticket gate) | not inspected; operator signage visible by nature of subject | ceiling, lighting, signage style |
| DR-IMG-IK-14 | <https://commons.wikimedia.org/wiki/File:JR_East_Ikebukuro_Station_Central_Gate_2_20221203.jpg> | Mister0124 | CC BY-SA 4.0 | 2022-12-03 05:52:45 | Central Gate 2 of JR East Ikebukuro Station | not inspected; operator signage visible by nature of subject; taken 05:52 (few people likely) | gate-line finishes, signage style, lighting |
| DR-IMG-IK-15 | <https://commons.wikimedia.org/wiki/File:JR_East_Ikebukuro_Station_Metropolitan_Gate_20221127.jpg> | Mister0124 | CC BY-SA 4.0 | 2022-11-27 20:32:02 | Metropolitan Gate of JR East Ikebukuro Station | not inspected; operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-IK-16 | <https://commons.wikimedia.org/wiki/File:Ikebukuro_Station_Metropolitan_concourse_20160323.JPG> | DAJF | CC BY-SA 4.0 | 2016-03-23 11:16:53 | The Metropolitan entrance concourse at Ikebukuro Station in Tokyo, Japan | not inspected | floor, ceiling, lighting |
| DR-IMG-IK-17 | <https://commons.wikimedia.org/wiki/File:Ikebukuro_shopping_park_entrance_toshima_tokyo_2009.JPG> | User:Kentin | CC BY-SA 3.0 | 2009-08 | An entrance of Ikebukuro Shopping Park (an underground mall at Ikebukuro Station), in Minamiikebukuro, Toshima | mall name signage prominent by nature of subject | entrance portal, stair finishes, signage |
| DR-IMG-IK-18 | <https://commons.wikimedia.org/wiki/File:Ikebukuro_Shopping_Park_001.JPG> | 第四京浜 | CC BY-SA 3.0 | 17 December 2010, 15:02 | 池袋ショッピングパークの地階入口 | mall name signage prominent by nature of subject | basement entrance finishes |
| DR-IMG-IK-19 | <https://commons.wikimedia.org/wiki/File:Seibu_Ikebukuro_station_2020-05-05_(1)_sa.jpg> | Araisyohei | CC BY 4.0 | 5 May 2020, 16:14:12 | Ikebukuro Station, Seibu Line Underground Gate | operator/shop signage possible; not inspected | underground gate area finishes |
| DR-IMG-IK-20 | <https://commons.wikimedia.org/wiki/File:East_entrance_of_Ikebukuro_Station_2023-11-09.jpg> | Asanagi | CC0 | 9 November 2023, 10:56:13 | East entrance of Ikebukuro Station and Seibu Ikebukuro Main Store (department store in Tokyo, Japan) | department-store signage prominent by nature of subject; pedestrians possible | exterior facade (above ground; dossier DOS:X4 card) |

### 3b. Shinjuku (新宿駅)

Selection note: SJ-01 to SJ-05 are the west underground plaza/basement material (西口地下広場); SJ-02 has a description date (Oct. 2023) that disagrees with its date taken (2012), so its state is uncertain. SJ-09/10 are Keio Mall (underground mall). SJ-11 to SJ-17 cover the Toei Oedo lines at E27 Shinjuku and E01 Shinjuku-Nishiguchi, SJ-19/20 the Keio New Line gates (Toei Shinjuku Line shares them). SJ-18 and SJ-25 are platforms (paid side) kept only because they show E27/Odakyu platform finishes. No Commons file is named "Metro Promenade"; the one search hit (`Iitomo AD at Shinjuku underpass`) is an advertisement and is not listed.

| id | file page URL | author | licence | date taken | area as described | people/logos | useful for |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DR-IMG-SJ-01 | <https://commons.wikimedia.org/wiki/File:Guide_board_of_Shinjuku_station_west_entrance_underground_square.jpg> | Sashimi02224 | CC BY-SA 4.0 | 4 January 2017, 17:57:14 | Guide board(2017) | sign content is the subject; not inspected for people | signage style, wayfinding graphics |
| DR-IMG-SJ-02 | <https://commons.wikimedia.org/wiki/File:Shinjuku_west_basement.JPG> | Kellykaneshiro | CC BY-SA 3.0 | 2012-05-16 | The west basement hall of Shinjuku station under renovation, Oct. 2023. | not inspected; description date (Oct. 2023) disagrees with date taken (2012) | floor, ceiling, columns |
| DR-IMG-SJ-03 | <https://commons.wikimedia.org/wiki/File:Screenshot_from_2023-01-03_11-12-54.jpg> | 福地健太郎 | CC BY-SA 4.0 | 2022-12-31 | 新宿駅西口地下広場にあった、禁止事項の掲示 | low resolution; notice text is the subject | notice-board style (text notice) |
| DR-IMG-SJ-04 | <https://commons.wikimedia.org/wiki/File:Shinjuku_Station_(53147627874).jpg> | Dick Thomas Johnson from Tokyo, Japan | CC BY 2.0 | 2023-07-08 14:24 | 新宿駅 | not inspected | ceiling, lighting, signage |
| DR-IMG-SJ-05 | <https://commons.wikimedia.org/wiki/File:Passage_in_Nishishinjuku.jpg> | Syced | CC0 | 22 December 2024 (according to Exif data | Passage in Nishishinjuku | not inspected | floor, ceiling, wall finish |
| DR-IMG-SJ-06 | <https://commons.wikimedia.org/wiki/File:OER_Shinjuku_station_West_Underground.jpg> | Lover of Romance | CC BY-SA 3.0 | 2007-11-02 | Odakyu Shinjuku Station West Exit on the Basement Floor | not inspected; old state, pre-renovation | floor, ceiling, signage (2007 state) |
| DR-IMG-SJ-07 | <https://commons.wikimedia.org/wiki/File:Odakyu_Shinjuku-STA_West-Underground-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-03 | Odakyu Electric Railway / Shinjuku Station West Exit Underground Ticket Gate | operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-SJ-08 | <https://commons.wikimedia.org/wiki/File:Keio-Shinjyuku-STA_West-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2021-11-20 17:39:54 | West exit ticket gate of Keio Line Shinjuku Station | operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-SJ-09 | <https://commons.wikimedia.org/wiki/File:Keio_mall_from_Shinjuku_1.jpg> | ITA-ATU | CC BY-SA 3.0 | 2010-02-28 | Keio mall from Shinjuku station. | mall signage likely; not inspected | mall passage materials, ceiling |
| DR-IMG-SJ-10 | <https://commons.wikimedia.org/wiki/File:Keio_mall_shinjuku_tokyo_2009.JPG> | User:Kentin | CC BY-SA 3.0 | 2009-09 | A photo of an entrance of Keio Mall (an underground mall at Shinjuku Sta.), Nishi-Shinjuku, Shinjuku-ku, Tokyo | mall name signage prominent by nature of subject | mall entrance finishes |
| DR-IMG-SJ-11 | <https://commons.wikimedia.org/wiki/File:Toei-Oedo-line_Shinjuku-STA_Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-01 | Ticket gate for JR Shinjuku Station at Shinjuku Station on the Tokyo Metropolitan Transportation Bureau Oedo L | operator signage visible by nature of subject | gate-line finishes, signage style, lighting |
| DR-IMG-SJ-12 | <https://commons.wikimedia.org/wiki/File:Toei-Shinjuku-STA_Maynds-Tower-District-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-09 | Tokyo Metropolitan Government Bureau of Transportation Oedo Line/Shinjuku Station toward Maynds Tower | operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-SJ-13 | <https://commons.wikimedia.org/wiki/File:Oedo_line_-_Shinjuku_stn_-_entrance_-_Jan_14_2018.jpg> | nesnad | CC BY 3.0 | 15 January 2018 (according to Exif data) | 大江戸線、新宿駅の改札 (ticket gates for Oedo line, Shinjuku Station) | operator signage visible by nature of subject; not inspected for people | gate-line finishes, wall colour |
| DR-IMG-SJ-14 | <https://commons.wikimedia.org/wiki/File:Toei_Shinjuku-Nishiguchi-STA_Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-05-16 08:09:57 | Ticket gate of Shinjuku West Exit Station on the Tokyo Metropolitan Bureau of Transportation / Oedo Line (clos | operator signage visible by nature of subject | gate-line finishes, signage style, lighting |
| DR-IMG-SJ-15 | <https://commons.wikimedia.org/wiki/File:Shinjuku-Nishiguchi_Station_Concourse_2018.jpg> | Wpcpey | CC BY-SA 4.0 | 2018-05-29 | Shinjuku-Nishiguchi Station | not inspected | concourse floor, ceiling, columns |
| DR-IMG-SJ-16 | <https://commons.wikimedia.org/wiki/File:Shinjuku-Nishiguchi_stn_ticket_gates_-_Nov_17_2018_04-54PM.jpeg> | Nesnad | CC BY 4.0 | 2018-11-17 16:54:05 | 新宿西口駅の改札 (Shinjuku-Nishiguchi station ticket gates) | not inspected for people; operator signage visible | wide gate-line view, ceiling, lighting |
| DR-IMG-SJ-17 | <https://commons.wikimedia.org/wiki/File:Toei-Shinjuku-STA_A1-Entrance.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-11 | Shinjuku Station A1 Exit (Tokyo Metropolitan Transportation Bureau/Keio New Line Entrance/Exit) | operator signage visible by nature of subject | exit portal finishes, exit sign style |
| DR-IMG-SJ-18 | <https://commons.wikimedia.org/wiki/File:Toei-Oedo-line_Shinjuku-STA_Platform.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-01 | Tokyo Metropolitan Transportation Bureau Oedo Line Shinjuku Station Platform (platforms 6 and 7) | not inspected; paid-area, not a public passage | platform (paid side) wall, ceiling, floor |
| DR-IMG-SJ-19 | <https://commons.wikimedia.org/wiki/File:Keio-new-line_Shinjuku-STA_Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2022-11-03 | Ticket gates of the Keio New Line and Tokyo Metropolitan Transportation Bureau Shinjuku Line at Shinjuku Stati | operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-SJ-20 | <https://commons.wikimedia.org/wiki/File:Keio-new-line_Shinjuku-STA_Shintoshin-Gate.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 14 September 2023, 20:35 | Shintoshin Ticket gates of the Keio New Line and Tokyo Metropolitan Transportation Bureau Shinjuku Line at Shi | operator signage visible by nature of subject | gate-line finishes, signage style |
| DR-IMG-SJ-21 | <https://commons.wikimedia.org/wiki/File:Shinjuku_Station_Underground_Concourse.jpg> | Max Timchenko | CC BY-SA 4.0 | 2008-04-29 | Underground concourse of Shinjuku Station in Tokyo | not inspected; pedestrians likely | concourse floor, ceiling, columns (2008 state) |
| DR-IMG-SJ-22 | <https://commons.wikimedia.org/wiki/File:JRE-Shinjuku-STA_Connecting-passage.jpg> | MaedaAkihiko | CC BY-SA 4.0 | 2021-11-21 08:46:44 | East-West connecting passage in JR East / Shinjuku Station | not inspected | passage floor, ceiling, lighting |
| DR-IMG-SJ-23 | <https://commons.wikimedia.org/wiki/File:Shinjuku_Station_East_%E2%87%94_West_Free_Passage_01.jpg> | 番記者 | CC BY-SA 4.0 | 2020-07-19 14:12:04 | 2020年(令和2年)7月19日（日）に開通したJR東日本新宿駅地下1階の東西自由通路。 | not inspected | passage floor, ceiling, lighting (opened 2020) |
| DR-IMG-SJ-24 | <https://commons.wikimedia.org/wiki/File:SHINJUKU_SUBNADE_201306.jpg> | Wpcpey | CC BY-SA 4.0 | 2013-06-21 | SHINJUKU SUBNADE | mall name signage prominent by nature of subject | underground-mall finishes |
| DR-IMG-SJ-25 | <https://commons.wikimedia.org/wiki/File:Odakyu-Shinjuku-STA_Platform10.jpg> | MaedaAkihiko | CC0 | 17 November 2023, 20:12 | Odakyu Line, Shinjuku Station underground platform (get off only, platform 10) | not inspected; paid-area, not a public passage | underground platform finishes (paid side; dossier DOS:X4 card) |

## 3c. Commons category pages for browsing

File counts are direct members (files in that category, not its sub-categories), from the API on 2026-10-22. Sub-category counts in brackets.

| Station | Category (URL) | Direct files (subcats) | Use |
| --- | --- | --- | --- |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Ikebukuro_Station> | 20 (15) | root |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Interior_of_Ikebukuro_Station> | 1 (10) | interior tree: JR East, Seibu, Tobu, Tokyo Metro, Passageways, Signs, Shops |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Passageways_in_Ikebukuro_Station> | 0 (5) | Central, South, North passages, Azalea Road, Cherry Road |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Ikebukuro_Station_Central_Passage> | 2 (6) | gate sub-categories |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Ikebukuro_Station_South_Passage> | 3 (2) | Tokyo Metro south passage gates |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Ikebukuro_Station_North_Passage> | 2 (1) | |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Entrances_of_Ikebukuro_Station> | 0 (4) | Entrances 28, 29, 34, 35 |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Interior_of_Ikebukuro_Station_(JR_East)> | 6 (2) | |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Ticket_barriers_of_Ikebukuro_Station_(JR_East)> | 1 (5) | JR gate photos by Mister0124 |
| Ikebukuro | <https://commons.wikimedia.org/wiki/Category:Signs_in_Ikebukuro_Station> | 6 (0) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station> | 1 (19) | root |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Interior_of_Shinjuku_Station> | 9 (13) | interior tree |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_West_Concourse> | 19 (0) | west underground plaza material |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_West_Underground_Gate> | 3 (0) | Odakyu west underground gate |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_East_-_West_Free_Passage> | 17 (3) | JR east-west free passage (opened 2020) |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_Central_Passage> | 8 (0) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_North_Passage> | 10 (0) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_(Toei_Oedo_Line)> | 0 (6) | E27: ticket barriers, platforms, entrance A1 |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku-Nishiguchi_Station> | 5 (3) | E01 |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Ticket_barriers_of_Shinjuku-Nishiguchi_Station> | 6 (0) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_(Keio)> | 10 (9) | Keio Mall, gates |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Keio_Mall> | 5 (1) | underground mall |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Subnade> | 2 (0) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station_(Odakyu)> | 19 (8) | |
| Shinjuku | <https://commons.wikimedia.org/wiki/Category:Entrances_of_Shinjuku_Station> | 6 (8) | |

Keio New Line has no `Shinjuku Station (Keio New Line-Shinjuku Line)` category page (the API returns no `categoryinfo`); its photos sit under `Ticket barriers of Shinjuku Station (Keiō New Line-Shinjuku Line)` and `Platforms of Shinjuku Station (Keiō New Line-Shinjuku Line)` (11 files).

## 4. Source records and generic materials

### 4a. Source records

All `checked` = 2026-10-22. "Update date" is the date the page itself shows; "none shown" means the page shows none. Rights class uses the `source-register.md` vocabulary. None is acquired or imported.

| source_id | title | publisher | URL | update date | terms / licence (URL) | modification allowed | redistribution allowed | availability | rights class | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DR-IMG-01 | Wikimedia Commons per-file photos (section 3) | Wikimedia Commons; each file by its own author | <https://commons.wikimedia.org/> | per file (upload date not captured) | per file: CC0 1.0, CC BY 2.0/3.0/4.0, CC BY-SA 2.0/2.1 jp/3.0/4.0 (file page; deeds at <https://creativecommons.org/licenses/>) | yes, subject to the licence (BY: credit and change notice; BY-SA: share-alike) | yes, same conditions; CC0 none | DISCOVERED (metadata read; no image fetched) | CC0 files `REUSABLE_WITH_CONDITIONS`; BY and BY-SA files `REFERENCE_ONLY` until an Owner decision | licence is uploader-asserted; copyright licence only (trademark, personality, privacy separate) |
| DR-IMG-02 | Commons category pages (section 3c) | Wikimedia Commons | <https://commons.wikimedia.org/wiki/Category:Ikebukuro_Station>, <https://commons.wikimedia.org/wiki/Category:Shinjuku_Station> | live; counts as of 2026-10-22 | Commons text is CC BY-SA; files carry their own licence | n/a (navigation aid) | n/a | DISCOVERED | `REFERENCE_ONLY` | browse tool for artists |
| DR-IMG-03 | Commons guidance on reusing content | Wikimedia Commons | <https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia> | none shown | guidance: credit the author, name the licence, licence BY-SA derivatives the same way; other rights (trademark, personality, privacy) remain | n/a | n/a | page read | n/a | source of the attribution format in 6a |
| DR-IMG-04 | Creative Commons deeds CC0 1.0, CC BY 4.0, CC BY-SA 4.0 | Creative Commons | <https://creativecommons.org/publicdomain/zero/1.0/deed.en>, <https://creativecommons.org/licenses/by/4.0/deed.en>, <https://creativecommons.org/licenses/by-sa/4.0/deed.en> | none shown | CC0: no conditions; BY 4.0: credit, licence link, change notice; BY-SA 4.0: also share adaptations under the same or a compatible licence. All allow commercial use. Publicity, privacy and moral rights are not granted (BY, CC0); CC0 leaves patents and trademarks untouched | yes | yes | page read | n/a | deeds are summaries; legal code governs |
| DR-IMG-05 | Poly Haven licence | Poly Haven | <https://polyhaven.com/license> | none shown | CC0 for HDRIs, textures, models; any purpose; no credit required. Site content (logos, avatars, example and user renders, copy) excluded; scraping and data mining need permission | yes | yes | DOWNLOAD_CONFIRMED (dossier `DOS:X6`, `floor_tiles_06`); no file downloaded here | `REUSABLE_WITH_CONDITIONS` (the only condition is to keep to the asset files) | generic, not station-specific |
| DR-IMG-06 | Poly Haven public API | Poly Haven | <https://github.com/Poly-Haven/Public-API> | none shown | free for any purpose; "Powered by Poly Haven" credit when building on the live API; separate API terms (ToS file not read) | n/a | n/a | one list read (869 textures) | n/a | do not bulk-pull; use names only |
| DR-IMG-07 | ambientCG licence | ambientCG | <https://docs.ambientcg.com/license/> | none shown | CC0 1.0 Universal for all assets and preview renders; no credit required (suggested line given) | yes | yes | search API read for names; no file downloaded | `REUSABLE_WITH_CONDITIONS` | generic |
| DR-IMG-08 | Mapillary Terms of Use | Mapillary | <https://www.mapillary.com/terms> | effective 2024-02-15 | other users' imagery under CC BY-SA unless Mapillary specifies otherwise (Section 3(b)); some datasets differ (for example CC BY-NC-SA); commercial use only for stated purposes (improving or developing products, services, maps, datasets; serving clients); automated scraping not approved is prohibited; derived-data licensing not addressed; data extracted from images must credit Mapillary with logo and link | yes for imagery, under CC BY-SA (credit; share-alike) | yes, same | page read; underground coverage UNKNOWN | `REFERENCE_ONLY` | commercial purposes in the Terms are limited; do not treat as general commercial licence |
| DR-IMG-09 | Mapillary help: CC BY-SA licence for open data | Mapillary | <https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data> | none shown | CC BY-SA on imagery; credit the creator with title, link, username and licence | yes (share-alike) | yes | direct fetch returned HTTP 403; content known from search-result snippet only | `REFERENCE_ONLY` | not independently confirmed here |
| DR-IMG-10 | Google Maps / Street View (excluded) | Google | <https://www.google.com/help/terms_maps/> | 2026-01-27 per dossier (not re-read) | service terms restrict copying, redistribution, bulk download and derived maps/navigation | no | no | n/a | `RESTRICTED` | `DOS:X7`; viewing is not prohibited |

### 4b. Poly Haven

Licence (page <https://polyhaven.com/license>, read 2026-10-22): all assets (HDRIs, textures, models) are CC0; usable for any purpose including commercial work and redistribution; no credit required (appreciated). The CC0 covers the assets only: site content such as logos, avatars, example renders, user-submitted renders and copy is not CC0; the Terms of Service forbid web scraping or data mining without permission; the public API has its own terms (the API repository README says free for any purpose, with a "Powered by Poly Haven" credit if building on the live API). The page shows no date. Poly Haven's CC0 says nothing about trademarks or people; these textures show none.

Candidates (URL pattern `https://polyhaven.com/a/<slug>`; names, categories and authors from the public asset list; real-world scale is material scale, not station scale). Look is described from the asset's own tags/categories, not checked visually.

| # | slug (URL) | what it is (per Poly Haven tags) | author | for |
| --- | --- | --- | --- | --- |
| 1 | `terrazzo_tiles` <https://polyhaven.com/a/terrazzo_tiles> | terrazzo, speckled decorative tiles | Amal Kumar | terrazzo floor |
| 2 | `old_mosaic_floor` <https://polyhaven.com/a/old_mosaic_floor> | weathered terrazzo/mosaic | Amal Kumar | worn terrazzo variation |
| 3 | `floor_tiles_06` <https://polyhaven.com/a/floor_tiles_06> | indoor clean marble checkerboard tiles (dossier `DOS:X6` card) | Rob Tuytel | tile floor |
| 4 | `floor_tiles_08` <https://polyhaven.com/a/floor_tiles_08> | beige ceramic square grid | Rob Tuytel | 600-type tile floor |
| 5 | `floor_tiles_02` <https://polyhaven.com/a/floor_tiles_02> | marble square tiles, smooth | Rob Tuytel | tile floor, wall |
| 6 | `interior_tiles` <https://polyhaven.com/a/interior_tiles> | indoor floor tiles, grout lines | Charlotte Baglioni | concourse floor |
| 7 | `granite_tile` <https://polyhaven.com/a/granite_tile> | granite floor tile | Charlotte Baglioni | granite floor / border |
| 8 | `granite_tile_03` <https://polyhaven.com/a/granite_tile_03> | granite wall tile, speckled | Charlotte Baglioni | wall cladding |
| 9 | `marble_01` <https://polyhaven.com/a/marble_01> | indoor clean marble | Rob Tuytel | cladding, floor |
| 10 | `rubber_tiles` <https://polyhaven.com/a/rubber_tiles> | smooth rubber tiles | Amal Kumar | rubber flooring |
| 11 | `linoleum_brown` <https://polyhaven.com/a/linoleum_brown> | linoleum/vinyl flooring | Rob Tuytel | resilient floor |
| 12 | `concrete_floor_worn_001` <https://polyhaven.com/a/concrete_floor_worn_001> | worn indoor concrete floor | Dimitrios Savva, Rico Cilliers | service/back-of-house floor |
| 13 | `concrete_wall_004` <https://polyhaven.com/a/concrete_wall_004> | painted concrete wall, worn | Dario Barresi, Charlotte Baglioni | painted concrete |
| 14 | `blue_metal_plate` <https://polyhaven.com/a/blue_metal_plate> | painted, scratched metal sheet | Rob Tuytel | painted steel panel, kick plate |
| 15 | `ceiling_interior` <https://polyhaven.com/a/ceiling_interior> | painted interior ceiling (aged) | Dimitrios Savva | ceiling paint |

Not found by name or tag in the 869-texture list: stainless/brushed-steel panel, suspended ceiling tile grid, tactile paving, terrazzo with a station-typical fine grain (item 1 is the nearest). Most listed metal is rusty or industrial.

### 4c. ambientCG

Licence page <https://docs.ambientcg.com/license/> (read 2026-10-22): "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License"; copy, modify, distribute, commercial use, no permission, no credit required (suggested credit line given). No restrictions listed, no date shown. Public search API queried for names only (counts of results for the query word, creation method mostly `PBRProcedural`):

| Material need | Search (results) | Example assets (URL `https://ambientcg.com/a/<id>`) |
| --- | --- | --- |
| Terrazzo | Terrazzo (28) | `Terrazzo004`, `Terrazzo005`, `Terrazzo011`, `Terrazzo013`, `Terrazzo018` |
| Tile floors | Tiles (222) | `Tiles040`, `Tiles043`, `Tiles107`, `Tiles110`, `Tiles138` (photogrammetry) |
| Suspended ceiling | Ceiling (6) | `OfficeCeiling001` to `OfficeCeiling006` |
| Rubber | Rubber (4) | `Rubber001` to `Rubber004` |
| Metal sheet / brushed | Brushed metal (10); Metal plates (20) | `Metal009` to `Metal012`, `MetalPlates001`, `MetalPlates004` |
| Painted plaster | Painted plaster (18) | `PaintedPlaster001`, `PaintedPlaster006`, `PaintedPlaster017` (photogrammetry) |
| Granite | Granite (14) | `Granite001A`, `Granite002A`, `Granite005A` |

Other CC0 libraries (3dtextures.me, sharetextures.com and similar) are not verified: the one licence URL tried returned HTTP 404. They are not recorded as sources.

## 5. What this does not establish

- A photo is not evidence of a passage, exit, connection, layout, dimension or current finish. Nothing here describes a route from a photo, and no photo is used to place anything. Several files are old (2007 to 2013); the west underground plaza was under renovation (SJ-02, SJ-06, SJ-21 show earlier states).
- Per-file licences on Commons are asserted by the uploader. Commons does not verify that the uploader is the author, nor that signage, artworks or people in the frame are cleared. CC licences cover copyright only; trademark, personality and privacy rights remain separate (CC deeds; Commons reuse guidance). Commons restriction tags seen: `personality` and `trademarked` on files I did not list (IK mroach pair, "Outside the Ikebukuro station").
- Version differences matter: CC BY 2.0/3.0/4.0 and CC BY-SA 2.0/2.1 jp/3.0/4.0 differ in attribution and compatibility details. The licence short name alone is not a compatibility ruling.
- I did not open any image. People and logo cells are inferences. Dates are camera or upload dates, not "today's state".
- Poly Haven and ambientCG materials are generic; they say nothing about the actual finishes in either station.
- Mapillary: whether any frame exists inside or under either station was **not established**. Search found nothing, and the Mapillary map app is a JavaScript viewer I did not scrape. Treat coverage as UNKNOWN. The Mapillary help article returned HTTP 403 to a direct fetch; its CC BY-SA content here comes from the Terms page (Section 3(b)) and search-result snippets.
- Google Maps / Street View: the dossier's `DOS:X7` ruling (excluded as redistributable raw material) was not re-read.

## 6. Handoff

### 6a. Lane E (#133 / #135 check) and station leads

| What Lane E has | State 2026-10-22 | Overlap with this file |
| --- | --- | --- |
| PR #133, draft: `gteki-finish/0.1` format and 8 procedural finishes (terrazzo, granite tile, 600 tile, enamel panel, wainscot blue, kick plate, spandrel ceiling, `line_accent` band) | open, build pending | These are original, generated textures, so they need no third-party source. Poly Haven/ambientCG items 1-9 and the ambientCG terrazzo set are **reference or comparison** for #133, not required inputs. Gap list items F1 not in #133's eight: panel-grid ceiling and tactile finish; ambientCG `OfficeCeiling*` is a CC0 comparison for the former |
| PR #135, merged: 31 Owner-approved AI 2D images, CC0 (light boxes, posters, murals, mascots) | merged | No overlap: AI art with fictional brands, not material references and not real-station reference imagery. Neither PR closes rank 4 for **real** station reference |

For station leads, by visual aspect (open the file page first; reject any with identifiable faces):

| Aspect | Look at |
| --- | --- |
| Ceiling and lighting | IK-02, IK-10 to IK-13, IK-16; SJ-04, SJ-14, SJ-15, SJ-22, SJ-23 |
| Floor tile / terrazzo | IK-07, IK-08, IK-03 to IK-05; SJ-05, SJ-15, SJ-21 |
| Columns, wall cladding | IK-04, IK-05, IK-11; SJ-02, SJ-15 |
| Gate-line finishes, exit portals | IK-14, IK-15; SJ-11, SJ-12, SJ-14, SJ-17, SJ-19, SJ-20 |
| Signage style and wayfinding graphics (style only; do not copy operator marks) | IK-01, IK-09; SJ-01, SJ-03 |
| Underground mall entrance finishes | IK-17, IK-18; SJ-09, SJ-10, SJ-24 |
| CC0, lowest-friction reference | IK-20 (exterior), SJ-05, SJ-25 |

**Attribution text for CC BY (and BY-SA) files that ship or are quoted in docs**, one line per file, in `NOTICE`: `"<Title>" by <Author>, <file page URL>, licensed under <CC BY 4.0 | CC BY 3.0 | CC BY 2.0> (<licence deed URL>). <Changes: none | cropped | colour-adjusted>.` Credit the author listed on the file page, not the uploader (Commons guidance). CC0 files need no credit; a courtesy credit is still recorded in provenance.

**Share-alike caveat.** CC BY-SA files (every file below marked `CC BY-SA`) are reference-only unless the Owner approves derivatives: see section 8.

### 6b. GIS

Nothing to acquire. No file in this document is to be downloaded into `tools/gis` or registered in `sources.yaml`. If the Owner later approves shipping a specific photo, GIS (or Lane E) records it in `assets/library/PROVENANCE.md` and `NOTICE` per the repo licence split.

## 7. Field-collection items for the Owner

Owner-owned photos of public areas only, no faces, no ads in frame where avoidable. Licence of these photos is the Owner's decision (section 8). No contact with any operator or third party is part of any item. Operator photography rules were not checked in this lane; reference-only photos need not leave the Owner's device.

| id | place (public area) | what to photograph | est. minutes | paid area needed? |
| --- | --- | --- | --- | --- |
| FC-IMG-01 | Ikebukuro B1 free passages (Central, South, North) | Floor tile close-ups, flat and straight down, with a ruler or coin for scale; one wide floor-and-ceiling frame per passage | 15 | No |
| FC-IMG-02 | same | Ceiling: panel grid, joints, luminaire type, any slot; shoot straight up, no ads | 10 | No |
| FC-IMG-03 | same | Walls and columns: cladding panel size and joints, chair rail/skirting profile, wainscot band height against a known object | 10 | No |
| FC-IMG-04 | Ikebukuro east-side and west-side underground exit halls (any free B1 hall at the east and west exits) and one exit stair | Floor, ceiling, handrail and stair nosing details. This also fills the "east/west underground plaza" photo gap: none found on Commons | 20 | No |
| FC-IMG-05 | Shinjuku west underground plaza (free side) | Floor, ceiling, column cladding; note renovation state in the filename | 15 | No |
| FC-IMG-06 | Shinjuku JR east-west free passage | Floor, ceiling, lighting strip | 10 | No |
| FC-IMG-07 | Shinjuku E27/E01 free-side concourse (Toei Oedo outside paid gates) | Floor, kick plate, line-colour band (Oedo magenta), exit stair | 15 | No |
| FC-IMG-08 | Both stations, free passages | Tactile paving (bars and dots) close-up, at the junction with floor tile | 10 | No |
| FC-IMG-09 | Both stations | Wayfinding sign style from an angle that shows the form, not the faces (style reference) | 10 | No |
| FC-IMG-10 | E27 platform (optional) | Platform wall and floor finish, screen-door base | 20 plus fare | **Yes** (paid; optional) |

Order by value for the fewest minutes: FC-IMG-01, 02, 03, 08 (≈ 45 minutes in Ikebukuro), then FC-IMG-07, 05, 06 (≈ 40 minutes in Shinjuku).

## 8. Owner decisions needed

1. **Photo-as-texture policy.** Allow any third-party photo (CC0, CC BY, CC BY-SA) to become a shipped texture, or keep all as reference only? Recommendation: reference only; use Lane E procedural packs, with Poly Haven/ambientCG CC0 only if a pack needs a base.
2. **Share-alike derivatives.** If any CC BY-SA photo (or Mapillary frame) is ever adapted, are share-alike terms acceptable for the result, given the README's CC BY 4.0 split for original art? The Owner decides per file.
3. **CC BY attribution.** Is a per-file credit line in `NOTICE` acceptable for CC BY files?
4. **Mapillary.** Confirm reference-only status; no derived-data use (map features, detections) without an Owner decision, because its Terms say data in the services belongs to Mapillary or its licensors apart from the CC BY-SA imagery, and the terms do not address detections.
5. **CC0 libraries.** May Lane E take Poly Haven / ambientCG textures as inputs (licence permits it; credit not needed)? Record each in `PROVENANCE.md` and `NOTICE` if so.
6. **Licence of the Owner's own photos** (section 7): CC0, CC BY 4.0 (the README art licence), or kept private as reference.
7. **Content rules for the Owner's photos:** whether operator marks or ads in frame may ship, or reference-only.
