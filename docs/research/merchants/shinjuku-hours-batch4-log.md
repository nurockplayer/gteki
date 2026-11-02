# Shinjuku building-card hours — batch 4 log (OD-32)

Recorded 2026-11-03 JST for data-research-05 (w6:pH). Base: `origin/main` at `8e4f9e4377ae39def55e1c840c6f113203a6e7ff`.
Facts only; no current open/closed status is asserted. No tenant hours, POIs, routes or entrances are added.

## Building inventory before this batch

The 610 `category: shop` POIs were checked by ID/name against their merchant research inputs. The initial inventory contained thirteen building/store-card candidates; the 2026-11-03 JST lead ruling excludes the existing サブナード search-only facility POI from eligible building cards, leaving twelve eligible building/store cards. Other shop rows are individual shops/tenants. `OK` below means imported printed hours, not present operating status.

| Store / building | POI id | Before | Research coverage | Batch 4 |
| --- | --- | --- | --- | --- |
| ルミネ新宿 ルミネ1 | shop-sjk-lumine1 | no hours | batch 1 has a separate ルミネ新宿 buildingHours row only | UNKNOWN: no date |
| ルミネ新宿 ルミネ2 | shop-sjk-lumine2 | no hours | same separate buildingHours row; no card hours | UNKNOWN: no date |
| ルミネエスト新宿 | shop-sjk-lumineest | no hours | batch 1 buildingHours only | UNKNOWN: no date |
| ニュウマン新宿 | shop-sjk-newoman | no hours | batch 1 buildingHours only | UNKNOWN: no date |
| 京王百貨店 | shop-sjk-keio | no hours | no previous hours row | OK: updated official page |
| 小田急百貨店 新宿店 | shop-sjk-odakyudept | UNKNOWN | batch 1 card UNKNOWN; separate buildingHours OK | OK: updated official page; lead ruling 2026-11-03 JST |
| サブナード | shop-sjk-subnade | no hours | no previous hours row | GAP: no eligible building card (existing search-only facility POI retained) |
| 新宿マルイ 本館 | shop-sjk-marui-honkan | OK | batch 3 | existing hours retained |
| 新宿マルイ アネックス | shop-sjk-marui-annex | OK | batch 3 | existing hours retained |
| 新宿マルイ メン | shop-sjk-marui-men | OK | batch 3 | existing hours retained |
| 伊勢丹新宿店 本館 | shop-sjk-isetan-honkan | OK | batch 3 | existing hours retained |
| 伊勢丹新宿店 メンズ館 | shop-sjk-isetan-mens | OK | batch 3 | existing hours retained |
| 高島屋タイムズスクエア | shop-sjk-takashimaya | OK | batch 3 | existing hours retained |

小田急エース, 京王モール, 京王モールアネックス and メトロプロムナード have **no building-level POI** on this base. The 小田急エース / 京王モール names on `shop-sjk-rec-*` are tenant names, not mall cards. These four requested checks are recorded below; no new building POI is invented.

## Method and OD-32

All requests used plain `curl -s`, its default User-Agent, no custom headers, a 25-second timeout and sequential GETs. Response bodies were read locally; no raw HTML, headers or raw E27 inputs are committed. No browser was used for source research.

The brief's dated/period-or-update-within-180-days rule takes precedence over #709's undated-official amendment **for this batch only**. Existing batch 1/3 hours stay unchanged except that the obsolete 小田急百貨店 UNKNOWN card row moves from batch 1 to its approved dated batch 4 row. Reading time and copyright year do not date the hours; unrelated news dates do not qualify.

**Lead-accepted rule (2026-11-03 JST):** an origin's HTTP `Last-Modified` value is its page update date under the brief's second OD-32 condition. This is distinguished from a printed effective date. 京王百貨店 returns `Last-Modified: Sun, 01 Nov 2026 13:00:02 GMT` (UTC), within 180 days of the read. Its hours have no printed effective period. `pageDate: 2026-11-01`, `basis: dated-official`; the card still labels the UTC reading date, 2026-11-02.

The 京王百貨店 page's two 新宿店の営業時間 blocks print:

- B1～2階: `午前10時～午後8時30分`, `※日・祝は午後8時まで`.
- 3階以上: `午前10時～午後8時`.

Those labels and lines, in order, are the single card's hours text. Separate restaurant/cafe tenant schedules are not substituted for building hours. No building-wide closed day is printed. Rights: 京王百貨店 is expressly in use-tiers.md's private-use-and-quotation class; it is distinct from 京王電鉄 / 京王SC. The existing source `keio-shinjuku-shopsearch-2026-11` is reused, as #709 reused store sources.

## GAP — UNKNOWN

- **ルミネ新宿 ルミネ1 / ルミネ2** — https://www.lumine.ne.jp/shinjuku/information/hours/; read 2026-11-02T20:48:06Z (UTC): Hours exist, but no printed effective date/period or page update date; HTTP response has no Last-Modified. No card hours imported.
- **ルミネエスト新宿** — https://www.lumine.ne.jp/est/information/hours/; read 2026-11-02T20:48:06Z (UTC): Hours exist, but no printed effective date/period or page update date; HTTP response has no Last-Modified. No card hours imported.
- **ニュウマン新宿** — https://www.newoman.jp/shinjuku/information/hours/; read 2026-11-02T20:48:06Z (UTC): Hours exist, but no printed effective date/period or page update date; HTTP response has no Last-Modified. No card hours imported.
- **メトロプロムナード (no building POI)** — https://www.tokyometro.jp/station/shinjuku/shop/index.html; read 2026-11-02T20:48:07Z (UTC): Tokyo Metro Shinjuku shop page is HTTP 403; no readable official hours/date evidence. Metro Properties guessed path is 404 and its home is 403. No import.

## GAP — refuse every use

Classification is the lead's settled use-tiers.md decision (Odakyu SC / Keio SC); it is not re-decided here. Only availability of hours is noted, with no hours transcribed or imported.

- **小田急エース (no building POI)** — https://www.odakyu-sc.com/odakyu-ace/guide/; read 2026-11-02T20:48:49Z (UTC): Official guide has an 営業時間 section. refuse every use; no import.
- **京王モール / 京王モールアネックス (neither has a building POI)** — https://ekishop.keio-sc.jp/keiomall-keiomallannex/; read 2026-11-02T20:48:49Z (UTC): Their official shared directory prints shop hours; no mall-wide hours inferred. refuse every use; no import.

## 小田急百貨店 — approved dated hours

The lead's 2026-11-03 JST ruling confirms the earlier 2026-11-02 JST admission of `odakyu-dept.co.jp`: its policy contains no reuse clause, only a copyright line. This is distinct from the refuse-every-use Odakyu SC / Railway sites. Policy https://www.odakyu-dept.co.jp/sitepolicy/index.html, read 2026-11-02T20:49:09Z (UTC):

> Copyright© 2026 Odakyu Department Store Co.,Ltd. All rights reserved.

Hours https://www.odakyu-dept.co.jp/shinjuku/hour_acces/, re-read 2026-11-02T21:27:25Z (UTC), HTTP 200, 21,493 bytes; SHA-256 `76330008b558b1b4e80582a1df704d0157f9d499bdbc0d9c0af3782be159efb4`. HTTP `Last-Modified: Sun, 16 Aug 2026 14:59:51 GMT` (UTC) dates the page within 180 days. `pageDate: 2026-08-16`, `basis: dated-official`. The 2025-01-15 printed parking notice is not used as an hours date.

The printed store-wide blocks are `■地下2階～2階`, `10：00→20：30`, `※日曜・祝日は20：00まで`, `■7階`, `10：00→20：00`, kept in that order. Separate tenant/cafe exceptions are not substituted for those building hours. No building-wide closed day is printed. The old batch 1 UNKNOWN card row is removed so each poiId still occurs exactly once across the hours files; its separate buildingHours row is retained.

## GAP — no building card

- **サブナード — no building card (lead ruling, 2026-11-03 JST).** https://www.subnade.co.jp/; read 2026-11-02T20:48:24Z (UTC). Hours exist on the home page (#ftHour); HTTP Last-Modified 2026-10-28T07:12:36Z (UTC). Rights are settled: private use and quotation, data lead 2026-11-02 JST, terms https://www.subnade.co.jp/legal/ §1, read 2026-11-02T20:48:59Z (UTC):

  > 私的利用など法律によって認められる範囲を超えて、当サイトに掲載されている内容を無断使用することはできません。

  **Scope assumption:** “no building card” excludes the existing search-only facility POI `shop-sjk-subnade` (name サブナード, sourced from Metro's exit list) from this batch's eligible building cards. That POI still exists in this checkout and retains no hours; it is not deleted. The GAP records the lead's scope decision, not physical absence of that existing POI.

## Source receipts

Body sizes/hashes below are of the exact curl response bytes, including unsuccessful discovery requests. All times are UTC. SHA-256 of an empty body is recorded for the DNS failure; it is not a page-content receipt. Redirects were not silently followed; the Location target was read separately. Initial incorrect paths contributed no evidence.

| Source | URL | Read UTC | HTTP / curl exit | Bytes | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| lumine | https://www.lumine.ne.jp/shinjuku/information/hours/ | 2026-11-02T20:48:06Z | 200 / 0 | 24,447 | `3353ad9d563593da60c25ca121daea22a11501b99cd3d762354969d202e594bc` |
| est | https://www.lumine.ne.jp/est/information/hours/ | 2026-11-02T20:48:06Z | 200 / 0 | 23,296 | `a09e1d2f844c882a05332ed532d843eac4bfd9934c05593a4a3ab1e8a9737b49` |
| newoman | https://www.newoman.jp/shinjuku/information/hours/ | 2026-11-02T20:48:06Z | 200 / 0 | 24,505 | `a1e0a5698d41df845bb03c591a7d2e261a296d9b1f382b7b9012cf543d51d6d9` |
| keio | https://www.keionet.com/info/shinjuku/businesshours.html | 2026-11-02T20:48:06Z | 404 / 0 | 1,998 | `82a36265fc8dbb942960217e1ecf120f40514b316cac0943cd41e2fda1e7cb2e` |
| odakyu | https://www.odakyu-dept.co.jp/shinjuku/hour_acces/ | 2026-11-02T20:48:07Z | 200 / 0 | 21,493 | `76330008b558b1b4e80582a1df704d0157f9d499bdbc0d9c0af3782be159efb4` |
| subnade | https://www.subnade.co.jp/info/ | 2026-11-02T20:48:07Z | 404 / 0 | 322 | `ccb32a9d710de69fa0efe78284cfd2f73493b92d89fcc9fa7b16e6b7c4d955f3` |
| ace | https://www.odakyu-ace.jp/info/ | 2026-11-02T20:48:07Z | 301 / 0 | 245 | `6a7b816a7a6e516b7bea790908a3347b832087a1f8ed4f2f41b1619b15248fc4` |
| keiomall | https://www.keio-mall.com/info/ | 2026-11-02T20:48:07Z | 000 / 6 | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| metro | https://www.tokyometro.jp/station/shinjuku/shop/index.html | 2026-11-02T20:48:07Z | 403 / 0 | 419 | `33cdaada09ef2a847a0d1b795df2f82ebe7c001e5406d876f4013b9167ddd0b0` |
| keio-home | https://www.keionet.com/info/shinjuku/ | 2026-11-02T20:48:24Z | 200 / 0 | 176,974 | `72cbb49795c6e1ba1e8e3db9c2ca45ba30b70d50d140291b005b18aa3fc98663` |
| subnade-home | https://www.subnade.co.jp/ | 2026-11-02T20:48:24Z | 200 / 0 | 33,489 | `e72e3df94ae1fab33ad9341de7247b2ce7dab900646bbc3f14a0e8e4571caa5c` |
| ace-info | https://www.odakyu-sc.com/odakyu-ace/information/ | 2026-11-02T20:48:24Z | 200 / 0 | 30,917 | `280e02f79e2824b767e3a05fb113d316e3a1c8ee3386d2a4cc7faadf6c6c1ebd` |
| keiomall-home | https://www.keio-sc.jp/ | 2026-11-02T20:48:25Z | 200 / 0 | 60,624 | `0693495da69cab93606df217b9913f4bc0af4fa1a266b163883ff83b87fab0ce` |
| metro-properties | https://www.metro-pro.co.jp/business/shopping/metro-promenade.html | 2026-11-02T20:48:25Z | 404 / 0 | 2,814 | `47737d49f136ca1daf9db6c48d4591576dd05b1f467946ed6633d9347a3f5014` |
| subnade-terms | https://www.subnade.co.jp/policy/ | 2026-11-02T20:48:49Z | 200 / 0 | 34,433 | `3803fa617969ca36cdf67f812618418627b8afbc550eab6610876a25e7530847` |
| odakyu-terms | https://www.odakyu-dept.co.jp/guide/ | 2026-11-02T20:48:49Z | 403 / 0 | 8,980 | `aef79058ef72c606380d4ca48ac3ae9850f053dd667626d82477b82bcec876d3` |
| ace-guide | https://www.odakyu-sc.com/odakyu-ace/guide/ | 2026-11-02T20:48:49Z | 200 / 0 | 39,494 | `6530b463a07b9ad7d9310cdad80473989d58c6877e440896eb3d3444fa07fcd8` |
| keiomall-directory | https://ekishop.keio-sc.jp/keiomall-keiomallannex/ | 2026-11-02T20:48:49Z | 200 / 0 | 98,146 | `e41b703f369913a1ae9deaac8e1ad5e5a88d87906029df0023dd62ffbb84a006` |
| metro-properties-home | https://www.metro-pro.co.jp/ | 2026-11-02T20:48:49Z | 403 / 0 | 2,843 | `f00a8ff5625da21255b80afe2773c7705d5e2aec37e58ec2fa203b09323a8115` |
| keio-hours | https://www.keionet.com/info/shinjuku/hours/ | 2026-11-02T20:48:59Z | 200 / 0 | 17,304 | `e2709f28c9756d0973a50cfbf3a7ce7d625e4f0111da9412b51620058b345619` |
| subnade-legal | https://www.subnade.co.jp/legal/ | 2026-11-02T20:48:59Z | 200 / 0 | 25,320 | `7cfee41aa4985e78ec084c8ec4494c244ae18c8ac43e1533dfca61b7c5bd902a` |
| odakyu-policy | https://www.odakyu-dept.co.jp/sitepolicy/index.html | 2026-11-02T20:49:09Z | 200 / 0 | 29,854 | `3332008614cbdbec5943ed0e96830af05a29d0060046167f5434f2865cc026ad` |
| keiomall-access | https://ekishop.keio-sc.jp/keiomall-keiomallannex/access/ | 2026-11-02T20:49:09Z | 404 / 0 | 2,981 | `7866a9e5160b3b40430f7f93030e8edbc5e57b14a9a32f3bbbe2cb32d4c497e9` |

## Result and handoff

2 new OK hours rows: 京王百貨店 and 小田急百貨店. 6 existing OK building cards unchanged; 4 eligible building cards remain UNKNOWN/no hours (LUMINE 1/2, LUMINE EST, NEWoMan); the existing サブナード search-only facility POI stays outside this batch's eligible building cards, with no hours. Four named malls/promenades have no building cards; their availability/rights gaps are recorded above. Existing batch 1 buildingHours rows remain separate and unchanged.

Import follows #709: add batch 4 to import-e27's hours inputs (including its existing duplicate-POI check), regenerate through `import:e27`, then `bake:surface`. Raw E27 files are supplied via `.qa/raw` and `GTEKI_RAW_SHINJUKU`. The destination-card test next to the existing OD-32 tests uses the committed real Shinjuku bundle, checking the printed open/close lines and reading-date label together. #709 itself did not add a dedicated test.

Generation completed 2026-11-03 05:57 JST, exit 0, using existing local pnpm 12.11.2 dependencies after the container generation queue stayed occupied (no test suite ran on the host): `GTEKI_RAW_SHINJUKU="$PWD/.qa/raw" pnpm --filter @gteki/station-shinjuku import:e27`, then `pnpm --filter @gteki/station-shinjuku bake:surface`. Semantic POI comparison found exactly one changed field: `shop-sjk-keio.hours`. `graph.json` and `station.json` equal the base, so no SOURCE_DATE_EPOCH rebuild was needed. `surface-baked.json` was regenerated (399,287 → 399,286 bytes).

`coverage-matrix.md` is not edited. Proposed matrix delta: add 京王百貨店 and 小田急百貨店 dated printed hours; keep the four remaining eligible building-card hours gaps and the サブナード no-building-card GAP and the four missing mall/promenade cards above. Subnade rights are settled; its no-building-card GAP label follows the lead ruling with the existing search-only facility POI retained as noted above. Exact check commands and Oracle result are in the PR body.

Validation 2026-11-03 JST: `orb-test -- pnpm exec vitest run apps/web/src/ui/app.notes.test.ts` passed, exit 0 (06:15–06:17 JST), result `Tests 15 passed (15)`. `orb-test -- pnpm --filter @gteki/station-shinjuku check` was queued 06:17–06:24 JST and cancelled before execution, exit 143. Last diagnostic: `orb-test: waiting for a gteki slot (2 light run(s) at a time inside the work window)`. Cumulative busy-slot waiting across generation/card-test/package-check exceeded 30 minutes (~7 + 18 + 7 minutes); the brief's CI allowance is applied to that total. No station package result or TS2307 result is claimed. One oracle-ego review completed 2026-11-03 05:58 JST, exit 0: **No blocking findings.** Exact commands and local review run path are in the PR body.

Follow-up 2026-11-03 JST: the lead accepted HTTP Last-Modified, admitted 小田急百貨店, and classified サブナード as a no-building-card GAP. No second Oracle review is run on this bounded correction; the original 05:58 JST verdict covers the earlier candidate only. Follow-up generation and touched-check results will be recorded in the PR body.

Follow-up generation 2026-11-03 JST: `import:e27` and `bake:surface` both exited 0; only 小田急百貨店 card hours changed from the initial PR candidate, plus the required surface snapshot. Graph and station.json remain unchanged; no SOURCE_DATE_EPOCH rebuild was needed. Batch 4 now has two dated rows; the obsolete batch 1 小田急百貨店 UNKNOWN row was moved rather than duplicated.

Follow-up validation 2026-11-03 06:53–06:56 JST, one serial container: `orb-test -- sh -c 'pnpm exec vitest run apps/web/src/ui/app.notes.test.ts && pnpm --filter @gteki/station-shinjuku check'`. Card test result: `Tests 15 passed (15)`, including both store assertions. The station package check exited 1 during typecheck, before its Vitest phase: `scene/stairwell-recipe-high.ts(6,18): error TS2307: Cannot find module './stairwell-cut.high.b64.txt?raw' or its corresponding type declarations.` and `scene/stairwell-recipe-low.ts(6,18): error TS2307: Cannot find module './stairwell-cut.low.b64.txt?raw' or its corresponding type declarations.` Last failure summary: `× "pnpm recursive run" failed in /w/stations/shinjuku`. This is the brief's known container-only issue; CI decides. No full root suite or second Oracle review was run.
