# WP11 — transfer facts (Metro, Toei, Seibu at Ikebukuro and Shinjuku)

Date: 2026-10-24. Worker: DeepSeek (ds-core). Review pending by lines-lead.
Output: `docs/research/lines/transfer-facts-wp11.json` (40 transfer facts, 5 sources).

## Pages read

| Source | Page | Browser needed? |
| --- | --- | --- |
| `tokyometro-yardmap-other-lines-2026-10` | https://www.tokyometro.jp/library/station/include/yardmap_other_lines.html — the shared table behind the station page's のりかえ出口案内 tab | yes (the site returns 403 to curl) |
| `tokyometro-ikebukuro-index-2026-10` | https://www.tokyometro.jp/station/ikebukuro/index.html | yes |
| `tokyometro-shinjuku-index-2026-10` | https://www.tokyometro.jp/station/shinjuku/index.html | yes |
| `toei-shinjuku-2026-10` | https://www.kotsu.metro.tokyo.jp/subway/stations/shinjuku.html | yes (Incapsula blocks curl) |
| `seibu-ikebukuro-station-2026-10` | https://www.seiburailway.jp/railway/station/ikebukuro/ | no (plain HTML fetched and read as text) |

Browser work used ego-lite in one own task space, read-only: navigation and
reading the rendered DOM only. No sign-in, form, post, upload or download.
Tabs closed at the end of the session.

Also opened but not used as a source (nothing usable in text): the per-line
`position.html?station=ikebukuro` transfer-exit pages for 丸ノ内線, 有楽町線 and
副都心線, and `station/ikebukuro/yardmap/index_print.html`.

## Counts

| Station | Operator | Facts |
| --- | --- | --- |
| ikebukuro | Tokyo Metro (丸ノ内線 / 有楽町線 / 副都心線) | 15 |
| ikebukuro | Seibu (池袋線) | 7 |
| shinjuku | Tokyo Metro (丸ノ内線) | 4 |
| shinjuku | Toei (新宿線 + 大江戸線) | 14 |
| **total** | | **40** |

Every fact has empty `viaLabels` and `viaPoiIds`. That is the finding, not an
omission: see the next two sections.

## The blocker: gate-level transfer names exist only inside diagrams

Both operators print the transfer gates as **diagram images**, not as text:

- Tokyo Metro `のりかえ出口案内` (`figure_platform_m25_a|b.png`, `y09_*`, `f09_*`):
  the gate/passage wording for each transfer sits inside the picture. The page's
  own text only says the diagram is a guide to boarding position, and carries no
  list of gate names.
- Seibu `駅構内のご案内` and Toei `構内図` are likewise images.

I could not read those images. Screenshot capture in this session fails every
time (`Page.captureScreenshot` times out, on the existing page and on a fresh
one), and downloading images was outside the limits of the brief. So no gate,
passage or exit name is recorded for any fact, rather than guessing from the
diagrams or from a route I know.

**For the lead:** if the images need to become facts, that is a separate task
with a working display; a viewer that can see `figure_platform_f09_a.png` and
friends would turn the empty `viaLabels` into real data.

## Printed gate names seen, but not tied to a transfer by the page

Recorded here instead of as `viaLabels`, because in each case the page prints
the name somewhere other than in a transfer statement.

- **Toei 新宿, 出入口一覧** (station level, both lines):
  `A1出口【マインズタワー方面改札】`, `3出口【京王新線口】`,
  `4出口【京王新線口】 6:00～23:00`, `5出口【京王新線口】 6:00～23:00`,
  `6出口【新都心口】 6:00～23:00`, `7出口【新都心口】 6:00～23:00`,
  `8出口【新都心口】 7:00～23:00`, `1出口 閉鎖中`, `2出口 閉鎖中`.
  The bracket is a gate name. `京王新線口` sits against the 京王線 line in the
  same page's 乗り換え案内, but the page never says the gate serves that
  transfer, and it prints 京王線 and 京王新線口 as different names. The lead may
  decide that the name alone is enough; I did not.
- **Tokyo Metro 新宿, 出口案内 table** (改定日 2023年12月), 近隣施設・建物 column:
  `A8` and `A9` are listed with `JR新宿駅 東口・中央東口・東南口`,
  `JR新宿駅 南口・新南改札・甲州街道改札`, `JR新宿駅 ミライナタワー改札`;
  `A12` with `JR新宿駅 西口・中央西口` and `新宿駅（小田急線）`.
  These are street exits and the column is "nearby places", so using them as
  transfer gates would turn a facility label into a walking route. Not recorded.
- **Tokyo Metro 池袋, 出口案内 table**: only shops are named near the exits
  (`東武百貨店 池袋店`, `西武百貨店`). These are department stores, not the
  Tobu or Seibu stations; they are not transfer evidence.

## notFound

- Gate, passage or exit name for every transfer at both stations (see above).
- Walking times: no page states one for these stations. The only
  移動時間目安 block on the Tokyo Metro station pages is inside a commented-out
  template that belongs to another station (its rows name 丸ノ内線 / 東西線 /
  千代田線 / 半蔵門線 with 4-minute entries) and was ignored.
- Platform positions and car numbers were present in the diagrams and are
  deliberately not recorded.

## Conflicts and ambiguities

1. **Asymmetry, not contradiction.** Tokyo Metro's 新宿 row lists 都営大江戸線
   (with the printed note `[新宿駅・新宿西口駅]`) but not 都営新宿線. The Toei
   乗り換え案内 at the same station lists the JR lines, 京王線 and 小田急線 but
   no 東京メトロ line. Each page is silent about lines the other names; both are
   recorded exactly as printed and no transfer was added to fill the gap.
2. **一 list for two lines.** The Toei 乗り換え案内 is printed once for the
   station and is not split between 新宿線 (S01) and 大江戸線 (E27). I recorded
   the same targets under both `fromLine` values, and every such fact says so in
   its `fact` text. If the lead prefers one row per station, drop one of the two
   sets (7 entries).
3. **Line naming.** The Seibu page prints `池袋線` for its own line; Tokyo Metro
   prints `西武池袋線`. Seibu prints `東京メトロ有楽町線` / `東京メトロ副都心線` /
   `東京メトロ丸ノ内線`; Tokyo Metro prints bare `有楽町線` / `副都心線` /
   `丸ノ内線`. Each entry keeps its own source's wording, so the same physical
   line appears under two names across stations — a normalisation step belongs to
   whoever merges these into POIs.
4. **`JR線` vs named JR lines.** Tokyo Metro prints the single label `JR線` at
   both stations; Toei and Seibu print named JR lines (`JR山手線`, `JR埼京線`,
   …). Recorded as printed.

## Method notes

- Only `池袋` and `新宿` rows of the shared Tokyo Metro table were taken, and the
  line tabs that were opened are 丸ノ内線, 有楽町線 and 副都心線. The hidden
  template rows for other stations (e.g. 大手町) were not used.
- The Tokyo Metro index pages' `のりかえ鉄道会社` rows corroborate the table:
  池袋 → JR東日本 / 東武鉄道 / 西武鉄道; 新宿 → 都営地下鉄 / JR東日本 /
  京王電鉄 / 小田急電鉄.
- No `quote` field anywhere; gate, exit and line names appear only as printed
  labels, and every statement is in my own words.

## lines-lead additions from the images (2026-10-24, gteki-1b instruction)

DeepSeek could not read the diagrams, so lines-lead (Claude Opus 5.5) read them with vision. Images were fetched through ego-lite (read-only) into a scratch folder outside the repo and are not committed. Only facts are taken:
- printed line labels, direction labels and hours;
- the direction label that each transfer group points to;
- the Seibu platform legend.

No car positions, relative placement or layout are taken (OD-03).

- **Tokyo Metro 池袋 (M25, Y09, F09 diagrams)** — 27 entries:
  - each transfer group with the direction label it points to: 中央通路 (linked to `central-passage`), 東京芸術劇場 / 東武百貨店, 西武百貨店 / サンシャインシティ(方面), Esola池袋, 立教大学;
  - printed hours: 副都心線連絡通路 始発～0:06 (from M25); F09 routes 始発～23:55 and 始発～0:05.
- **Tokyo Metro 新宿 (M08 diagrams)** — 6 entries. The key fact is a footnote saying the 都営大江戸線 transfer is a **connection with 新宿西口駅 (E01)**, not with the Toei 新宿 station. The 西武線 label carries the Seibu Shinjuku Line mark (西武新宿 is a separate station; no connection is modelled).
- **Toei 新宿 (構内図 image)** — 5 entries:
  - the S01 ↔ E27 transfer (in the map's transfer guide; not in the page text);
  - direction labels 南口方面 (JR, Odakyu) and 京王線新宿駅へ (Keio).
- **Seibu 池袋 (station map dated 2026.8.1)** — 8 transfer entries from two B1F direction arrows, and **7 platform POIs** (`newPois`, `seibu-platform-1` to `-7`): 1, 4 and 6 are alighting-only; 2, 3, 5 and 7 depart toward 所沢・飯能・西武秩父. This answers WP3's "Seibu platform numbers not printed": they are printed, but only in the image.
- **Toei station-level list de-duplicated:** the 7 entries per Toei line became one entry per target line under 「都営新宿線・都営大江戸線（駅全体）」, because the page gives one list for the station.
- **Source ids** for the Toei and Seibu pages are distinct from #421's and #414's records of the same URLs (`toei-shinjuku-norikae-2026-10`, `seibu-ikebukuro-norikae-2026-10`). Each import then keeps one record per id (sjk-search-78's request).
- **Candidates for the writers, not applied:**
  - The Toei map prints the gate name 新都心口 with hours 6:45～22:00. That name is already a tag on Toei exits 6–8 in #421, so it could become a Toei gate POI.
  - The Seibu map draws 西武南口 in the same style as the 東口 exit labels. In #414 it is `other`, because the text page does not say what it is.
