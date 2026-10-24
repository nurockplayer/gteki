# Shinjuku merchant batch 2: LUMINE EST, LUMINE Shinjuku, NEWoMan

Status: research hand-off, 2026-10-24. Single writer: sjk-search-78 (`stations/shinjuku`). This file changes no station data. The rules of [`shinjuku-import-contract.md`](shinjuku-import-contract.md) apply, and through it those of [`ikebukuro-import-contract.md`](ikebukuro-import-contract.md).

| Source id | Directory | POIs | Id rule |
| --- | --- | --- | --- |
| `lumine-est-shinjuku-floorguide-2026-10` | ルミネエスト新宿 floor guide | 245 | `shop-sjk-lumineest-<scd>` |
| `lumine-shinjuku-floorguide-2026-10` | ルミネ新宿 (ルミネ1, ルミネ2) floor guide | 230 | `shop-sjk-lumine-<scd>` |
| `newoman-shinjuku-floorguide-2026-10` | ニュウマン新宿 floor guide | 101 | `shop-sjk-newoman-<scd>` |

File: [`shinjuku-merchants-batch2.json`](shinjuku-merchants-batch2.json), 576 POIs; log: [`shinjuku-merchants-batch2-log.md`](shinjuku-merchants-batch2-log.md). Rights: OD-34, facts only. Floors (B2F … 8F) and NEWoMan zones (e.g. エキナカ) stay as printed text in notes. They are not GTEki floor ids, and エキナカ is not mapped to `paid`. Printed kana readings are `ja-Hrkt` aliases.

Acceptance (2026-10-24, scratch copy of `origin/main` with #418's first transcription and this batch merged into `stations/shinjuku/gteki`, `lockf`, single worker): 0 validation errors (only `poi.unroutable` warnings and the 2 existing `floor.change.walk` warnings), `unknown_goal` for `shop-sjk-newoman-001851`, `real-stations.test.ts` 21/21. Merge after #418.
