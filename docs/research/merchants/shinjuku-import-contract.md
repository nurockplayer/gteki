# Shinjuku merchant POI import contract (batch 1)

Status: research hand-off, 2026-10-24. Single writer: sjk-search-78 (`stations/shinjuku`). This file changes no station data.

The field mapping (§2), reject rules (§4) and batch 2 additions (§6: code-based ids, `removed` list, closed shops not imported) of the [Ikebukuro contract](ikebukuro-import-contract.md) apply unchanged, with `shop-sjk-` ids. Floors are never equated by label: an Odakyu Ace 北館 or a Toei B3階 is not a GTEki floor id, so `floorId` stays `null`.

## 1. This batch

File: [`shinjuku-merchants-batch1.json`](shinjuku-merchants-batch1.json), 6 POIs; log: [`shinjuku-merchants-batch1-log.md`](shinjuku-merchants-batch1-log.md).

| Source id | Directory | POIs | Id rule |
| --- | --- | --- | --- |
| `toei-shinjuku-stores-2026-10` | Toei Shinjuku station stores page | 1 | `shop-sjk-toei-<NNN>` (no store code) |
| `toei-shinjuku-nishiguchi-stores-2026-10` | Toei open-data CSV, 新宿西口 (dataset updated 2025-01-30) | 1 | `shop-sjk-toeinishi-<NNN>` |
| `tokyometro-shinjuku-shops-2026-10` | Tokyo Metro Shinjuku shops page | 4 | `shop-sjk-metro-<NNN>` |

All three sources: `REFERENCE_ONLY`, `usage: "facts-only"`, decision OD-33 ([#377 comment 6378920311](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6378920311); the director's 2026-10-24 ruling extends OD-23/OD-31 to all commercial and station directories). OD-34 terms check: Tokyo Metro's terms ban use only beyond 私的使用 / 引用 (usable). The Toei store lists are also published as open data under CC BY 4.0: Tokyo open-data catalogue dataset `t000018d0000000039` 「駅構内のお店」, which includes `other_stores_shinjuku.csv` and `other_stores_shinjuku-nishiguchi.csv`, checked 2026-10-24. This batch still treats them as facts-only, which is stricter than the licence requires. Facilities on these pages (ATMs, lockers, photo booths, rental machines) are excluded here and belong to a later facilities batch. Unnamed 期間限定ショップ slots are not imported.

Every POI: `floorId`, `displayPosition`, `paid` null; `connectorNodeIds` `[]`; `AREA_ONLY` when the source prints an area (hall, zone, floor or exit label, or which of two sub-malls such as 京王モール / 京王モールアネックス, kept in notes as printed), otherwise `SEARCH_ONLY`. Printed 改札外 stays text in notes and is not mapped to `paid`.

Removed before import (OD-34, 2026-10-24): Odakyu Ace (43) and Keio Mall (29). Their sites' terms refuse every use of their content data, with no legal exception, so they get OD-02 A treatment. Their shops may be added later only from each chain's own store pages, with that page as the source.

## 2. Acceptance check (run 2026-10-24)

On a scratch copy of `origin/main` with the five sources and 78 POIs merged (before the OD-34 removal; the remaining 6 are a subset) into `stations/shinjuku/gteki`, under `lockf -k /tmp/gteki-local-test.lock`, single worker:
- `parseStationFiles` + `validateBundle`: 0 errors; 78 `poi.unroutable` warnings (search-only) and 2 existing `floor.change.walk` warnings that were already there.
- `route.ts stations/shinjuku <node> shop-sjk-odakyuace-103352 --goal-poi` (and `shop-sjk-toei-001`): `unknown_goal`, "destination has no verified entrance".
- `packages/cli/src/real-stations.test.ts`: 21/21 pass.
sjk-search-78 runs the station's own tests (`stations/shinjuku/test`, including the search truth tests) after merging and updates their goldens.
