# #826 round 3: one walk remains disconnected

2026-11-05 16:56 JST. Candidate `0bb37e8c`; regeneration job `826-regen2` (orb-test, 2026-11-05 16:30–16:55 JST).

Shinjuku regeneration completed. `python3 .qa/826/compare.py after shinjuku` reports SHRINK-ONLY PASS: fallback 4 → 3, fallbackWallHits 6 → 2, routablePairs 238 → 238. Walk `e:6ac033af77914fe5a9786676088b952c` now has a path and is absent from fallback. Walk `e:82c9a2c2cd704a348fbeb423d07cb125` remains in fallback: both endpoints snap, but both directions have `no_path` / `disconnected`; its sampled wall cross-section is 2.41589821382329 m. The audit does not establish which wall or floor condition causes the remaining disconnect, so the mechanism is not yet diagnosed. Evidence: `.qa/826/after/shinjuku/audit.json` and `navmesh-fallback.json`.

Ikebukuro regeneration did not finish: `Error: navmesh-audit.ts failed: spawnSync pnpm ETIMEDOUT` after the 900 s container-only timeout. No two-station comparison or acceptance result exists. The brief requires stopping before further changes because the first walk remains in fallback. The two elevator edges remain blocked by the missing 1F plan floor.
