# Ikebukuro merchant batch 4: LUMINE Ikebukuro, Esola Ikebukuro, Tobu Department Store

Status: research hand-off, 2026-10-24. Single writer: ikb-route-15 (`stations/ikebukuro`). This file changes no station data. The rules of [`ikebukuro-import-contract.md`](ikebukuro-import-contract.md) apply (§2 field mapping, §4 reject rules, and §6 from #407: code-based ids, `removed` list, closed shops not imported, printed kana only as `ja-Hrkt` aliases).

## 1. Files

| File | Contents |
| --- | --- |
| [`ikebukuro-merchants-batch4.json`](ikebukuro-merchants-batch4.json) | 11 sources and 210 POIs (LUMINE 1, Esola 9 floor pages `fid=b1,1f–8f`, Tobu 1): LUMINE Ikebukuro 176 (`shop-ikb-lumine-<scd>`), Esola Ikebukuro 33 (`shop-ikb-esola-<shopid>`), and one store POI `shop-ikb-tobudept` (東武百貨店　池袋店) |
| [`ikebukuro-tobu-dept-tenants.json`](ikebukuro-tobu-dept-tenants.json) | Tobu Department Store brand list, 860 entries (`tenant-ikb-tobudept-<shop id>`, name, floor label, category, and a `sourceId` for the floor directory page it came from; `removed` records carry the same `sourceId`). **Not POIs; not imported.** |
| [`ikebukuro-merchants-batch4-log.md`](ikebukuro-merchants-batch4-log.md) | Pages, UTC read times, counts, exclusions, lead review |

## 2. Rights

All 11 sources: `REFERENCE_ONLY`, `usage: "facts-only"`. OD-34 (2026-10-24, [#377 comment 6382700098](https://github.com/nurockplayer/gteki/pull/377#issuecomment-6382700098)) applies. The LUMINE and Tobu Department Store terms ban use only beyond private use or what the law allows, so facts only are allowed. Metro Properties (Esola) only restates the law. Sogo & Seibu stays excluded.

## 3. Department store rule

Following the director's 2026-10-24 ruling (OD-34 item 5), a department store is one POI. Its notes carry only shop/floor facts: location and entrance are unverified and current status is unknown. The store's station-connection label (池袋駅西口 直結 on the access page) is a connection claim outside those facts and is not carried into the notes. Brands are kept in a separate tenant dataset (`gteki.research.tenants/0.1`, `storePoiId` points to the store POI) until core-search designs tenant search; then a brand query returns the store with the floor. Event spaces, service counters and events are not brands and are left out (listed in the log).

## 4. Acceptance check (run 2026-10-24)

On a scratch copy of `origin/main` with #407's sources and POIs and this batch's sources and 210 POIs merged into `stations/ikebukuro/gteki`, under `lockf -k /tmp/gteki-local-test.lock`, single worker:
- `parseStationFiles` + `validateBundle`: 0 errors; only `poi.unroutable` warnings (search-only).
- `route.ts stations/ikebukuro c_w shop-ikb-tobudept --goal-poi`: `unknown_goal`, "destination has no verified entrance".
- `packages/cli/src/real-stations.test.ts`: 21/21 pass.
ikb-route-15 runs the station's own checks and updates the search golden after merging. Merge after #407/#423.
