# Lane D — GIS data factory handoff

Updated: 2026-10-20 · Issue: [#10](https://github.com/nurockplayer/gteki/issues/10) · Lead: Opus 5.5 (architecture, integration, review, delivery) · Implementation and tests: Codex GPT-6.1 Sol (xhigh, fast tier) · Independent review: separate read-only Codex GPT-6 Astra (high) sessions.

**Status:** this is a reproducible, tested ingestion and inspection run on real public sources. **Nothing here is accepted station topology, a verified route, current-world geometry or a publication approval.** Every normalized record is `UNVERIFIED`, every GLB is `NOT_FOR_ROUTING` and every candidate graph has `routable: false`.

## What exists

`tools/gis/` is a standalone pnpm package (its own `pnpm-workspace.yaml` and lockfile, outside any future root workspace). It has these commands:

| Command | Purpose |
| --- | --- |
| `acquire <id…> \| --all [--offline]` | Resolves PLATEAU URLs from the **live** data-catalog API and saves the API response with its hash. Streams downloads into a content-addressed store outside Git and records URL, headers, bytes, SHA-256 and timestamps in `docs/gis/acquisitions/`. `--offline` re-verifies the hashes. |
| `inspect-citygml` | Streaming (bounded-memory, no DTD/entity resolution) inventory of PLATEAU CityGML: CRS/axis order, envelope, semantic tree, xlink polygon references with `OrientableSurface` sign, and codelist labels resolved from the actual codelist ZIP. Also produces `PRESENT / ABSENT_IN_FILE / UNKNOWN` semantic-presence answers. |
| `crs-roundtrip` | EPSG:6697 (lat, lon, TP height) → JGD2011 / Plane Rectangular CS IX (EPSG:6677) → station-local ENU → glTF (x=E, y=U, z=−N), plus the inverse transforms. |
| `citygml-to-glb` | Bounded or full conversion to GLB. Node name = `gml:id` and extras carry the source/frame/codelist provenance. Writes a provenance sidecar and checks the result by reading it back (node count, triangle count, bbox ≤ 1 mm). |
| `inspect-network` | MLIT 歩行空間ネットワーク CSV/GeoJSON inspection: literal fields, encodings, category distributions, duplicate/dangling/self-loop/component checks and endpoint-geometry checks. Exports a candidate graph that keeps raw attributes verbatim and adds **no edges**. |
| `overlap` | Bbox-only spatial relation between acquired layers, with projected separation. Explicitly not evidence of feature alignment or connectivity. |
| `gap-packet` | Per-station UNKNOWN/HOLD packets computed from the reports. |
| `scripts/blender_import_check.py` | Headless Blender glTF import. Compares the imported bbox with the recorded one and renders review images. |

Reproduce the full run with `pnpm --dir tools/gis install --frozen-lockfile`, then `pnpm --dir tools/gis gis acquire --all` and `pnpm --dir tools/gis exec tsx src/real-run.ts`. Details are in [tools/gis/README.md](../../tools/gis/README.md). Raw bytes, full feature-detail tables, GLBs and candidate graphs stay in `$GTEKI_GIS_STORE` (default `~/.gteki/gis-store`, mode 700). Only small, auditable records are committed.

## Verified checks (this candidate)

- `typecheck` 0 · `test` **82/82** · `test:real` **3/3** · `acquire --all --offline` **13/13** hashes · real run **16/16** CLI invocations exit 0. The Opus lead re-ran these independently.
- CRS: two independent controls from the official GSI 測量計算サイト `bl2xy` (JGD2011, zone IX, retrieved 2026-10-20) match within **0.05 mm**. Envelope-corner roundtrips are below 1e-6 m.
- GLB readback: bbox error ≤ **0.006 mm**. Independent Blender 5.2.2 import of both full-file GLBs reproduces the recorded local bbox to within float32 precision (see [evidence/](evidence/)).

## Station results

### Ikebukuro — PLATEAU `13116` ubld mesh `53394576` (CC BY 4.0, 2023 東京都 LidarSLAM source)

- SHA-256 `38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09`, 35,427,963 bytes. 1 `uro:UndergroundBuilding`, **1 group literally named 「池袋駅_B1地下通路」**, 3 Rooms, 3 Door objects, 7 installations (EF_25 壁・バリア, EF_35 階段・スロープ category, EF_80 輸送機能, EF_30 屋根・床・舗装; labels come from the acquired codelist).
- Footprint about **360 m × 369 m**, vertical extent **7.7 m** (TP 25.50–33.17 m). The literal group name and the narrow height range are consistent with a **single B1 passage level only**. No Metro B2/B4 levels, platforms, gates or paid boundaries are present as explicit elements. Do not assume that further levels exist elsewhere in this file.
- 98,173 polygon uses = 58,761 definitions + 39,412 xlink reuses (23,954 reversed). The full GLB has 58,761 polygons and 64,811 triangles.
- R1 walking network (PDL 1.0, content 2019-01-28): 1,887 nodes / 2,196 links, one weak component, 0 anomalies. Every node has `in_out=1`, elevation is blank everywhere and **no CRS is declared**. As a result, its spatial relation to the PLATEAU geometry is **UNKNOWN** (no metric comparison is made from an assumed CRS). `rt_struct` (8 codes) and `lev_diff` (4 codes) distributions are reported but deliberately **not** decoded.
- Packet: [gaps/ikebukuro.md](gaps/ikebukuro.md).

### Shinjuku — PLATEAU `13104` ubld mesh `53394536` (CC BY 4.0) + Toei Oedo E27 (PDL 1.0, published until 2027-03-12)

- SHA-256 `013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977`, 43,830,765 bytes. 1 `uro:UndergroundBuilding` named 「新宿駅周辺エリア」, 153 Rooms, 1,364 Doors, 1,911 FloorSurfaces, 1 installation. **No explicit floor labels** are present.
- Footprint about **506 m × 479 m**, vertical extent **30.2 m** (TP 15.32–45.49 m). The full GLB has 65,013 polygons, 148,950 triangles and 30,358 nodes. The per-object node granularity makes the Blender import slow (measured in [evidence/](evidence/)), so runtime assets should be merged per Room or surface class by the asset lane.
- E27 network: 233 nodes / 263 links, one weak component, 0 anomalies, all 263 endpoints checked. Literal `floor` values: −6 … 1. Station map: 18 layers, 465 features, literal labels 1階 / 地下1・2・3・5・6階.
- **Key finding: the only PLATEAU underground file for 新宿区 is spatially DISJOINT from every acquired E27 layer, about 184–237 m apart (bbox-based).** The E27 data therefore cannot be paired with the PLATEAU ubld geometry. Any E27 3D scene needs another geometry source or a field survey. This pairing is on **HOLD**.
- Packet: [gaps/shinjuku.md](gaps/shinjuku.md).

## Rights / publication gate

| Output | Gate |
| --- | --- |
| PLATEAU-derived GLB/renders | CC BY 4.0 permits commercial use, modification and redistribution with attribution plus a modification notice (text in the manifest). **Not yet published.** The station lead decides on inclusion after verifying geometry, and the Owner approves release. |
| Hokonavi-derived candidate graphs | PDL 1.0 with attribution and a processing notice, and no implication of government authorship. Stay internal because they are `UNVERIFIED`. |
| PLATEAU codelists/schemas | Rights recorded as `unknown`. Labels are used internally for inspection only. |
| Operator maps (JR, Metro, Tobu, Seibu, Keio, Odakyu, Toei pages …) | Not acquired. Reference-only per the dossier. |

## Handoff to station leads (A/B), shared core (C) and assets (E)

1. **Ikebukuro (A):** the PLATEAU B1 passage is the only open 3D geometry acquired. Use it as a geometry candidate for a B1 slice after verifying it against permitted references or a field survey. It has no route graph, no gates and no other levels. R1 is an outdoor/peripheral 2019 network with an undeclared CRS, not an indoor graph.
2. **Shinjuku (B):** E27 is the only open indoor graph, and it does not overlap the PLATEAU ubld file. Choose between (a) an E27-first slice whose geometry is derived from the E27 station-map polygons (PDL 1.0) with **no invented heights** (only literal floor values) and (b) a PLATEAU-area slice with no open graph. Both are HOLD for verified routing.
3. **Shared core (C):** the frames `ikebukuro-plateau-ubld-v0` / `shinjuku-plateau-ubld-v0` are arbitrary processing origins, not station reference points. They are a proposal for the #2 coordinate contract and are not imposed. Field names follow the source-register schema.
4. **Assets (E):** GLB nodes carry `gml_id` extras for traceability. Merging for runtime should keep a sidecar mapping back to the IDs.

## Known gaps / next steps

- Decode MLIT network code tables (`rt_struct`, `lev_diff`, `direction` …) from the official spec PDF, with the spec version recorded, rather than guessing.
- Acquire the R1 GeoJSON variant, which may declare a CRS, to make the R1↔PLATEAU relation computable.
- Next targeted acquisitions: S10 Toei shop CSV (CC BY, version to verify), S03 Tokyo 2023 Shinjuku facility ZIP (resource-level licence still to verify), and the Shinjuku `related` POI ZIP (rights unknown).
- Use the operator-permission/field-survey template: [gaps/operator-survey-questions.md](gaps/operator-survey-questions.md).

## Review trail

The fresh read-only Codex review sessions are recorded in [fix-pass.md](fix-pass.md). Round 1 returned REQUEST_CHANGES with 1×P1 and 6×P2: nested ownership, `OrientableSurface` sign plus xlink reuse, namespace URIs, export membership, `linkID`, dictionary identity and categorical fields. Round 2 confirmed all of those fixed and raised 4×P2 + 1×P3 new edge cases, which were fixed in phase 3. Round 3 (closure) verified all five fixes with code, tests and in-memory probes, found no P0/P1 issues and returned **APPROVE** with no blocking items for tool digest `4b67d0bf4bd9d8ef9c8244416ce4f2c537e2307f6ac04bc151a1fae091f412fe`. An earlier ChatGPT-browser review that the implementer ran on its own initiative is kept, sanitized, under [history/](history/README.md). That route is not a channel the lead approved, and the Codex reviews supersede it.

PR [#18](https://github.com/nurockplayer/gteki/pull/18) automated Codex review raised two P2 findings, both fixed with regressions in tool digest `67f398610e32e391b9622bf25706f9456adbb6c8499381a49e6ad1ecc87a3716`:
- Geographic endpoint checks now skip out-of-range (for example, axis-swapped) positions, which makes coverage PARTIAL instead of CHECKED.
- Acquisition provenance now calls `git` directly rather than through a wrapper.

The real run was regenerated. The GLB bytes are unchanged, and the superseded conversion receipts are in `history/conversions/pre-review-fix/`.

A second automated review raised two more P2 findings, both fixed with digest `9dcf9e0b5afbeb726412dd3ea06aeea50fde82dc70ab7933f262f6f6ffcda876`:
- `real-run` now aborts when fresh acquisition fails, instead of continuing against older stored records.
- Conversion receipts from other tool fingerprints are moved to `history/conversions/tool-<digest>/` automatically, and `summarize` reads only current-fingerprint receipts.

A third automated review raised two more P2 findings, fixed with digest `12983496b3eb750a0698fa3ac6069a240546e63ddc98fc26a97b4e0eb864f4f4`:
- `real-run` converts only after both the frame step and the CRS roundtrip succeed. `overlap`/`gap-packet` run only when every prerequisite command succeeded in the same run.
- A multi-position `MultiPoint` node no longer supplies an arbitrary endpoint coordinate; that endpoint check stays PARTIAL.

The real reports are unchanged.

A fourth automated review found that `real-run` bound its receipt to the pre-frame fingerprint. The receipt is now rebound after frame generation, before conversions and stale-receipt archiving. The run, validation, summary and all 6 conversion receipts now share digest `8b4664ecf4019e146d6adc77f4d65d425b269396f206e7e5b7973b8b2b8306b5`.

A fifth automated review asked that `summarize` refuse incomplete runs. It now exits without writing unless three conditions hold: `real-run.json` is completed with every command at exit 0, the receipt fingerprint equals the current tool fingerprint, and every inventory and network report's source hash matches the recorded acquisition. Current digest: `8cc78e45f9de57cf12133d00beb2e07f5995f43c09c7e356ec6cb221370a4352`.

A sixth automated review raised two more P2 findings, fixed with digest `989c2ae8622867722741daced5f06c253de4493fc88e9fe60e1ab21a6a96592e`:
- A missing bounded-Room conversion is recorded as a failed command, so `real-run` and `summarize` fail.
- Every store-writing entry point (`cli`, `real-run`, `validate`) calls `ensurePrivateStore()`, which sets umask 077 and forces the store root to 0700. New store files are created 0600 and new directories 0700. The existing local store was tightened to match, and no group- or world-readable entries remain.

A seventh automated review raised three more P2 findings, fixed with digest `6d4c26c7ea75dc3b8838a31190d5419ba5584e2bb27a430e620073ccc244df8d`:
- Any report-writing CLI command run outside `real-run` marks `real-run.json` as `invalidated`, and `summarize` refuses invalidated receipts. `summarize` also checks the conversion and CRS-report source hashes against the acquisitions.
- `acquire --offline` compares the stored size against the current manifest's `expected_bytes`.
- Polygon and other unsupported geometries never take node or edge roles.

An eighth automated review raised two more P2 findings, fixed with digest `097463f4985249a454efa867615dcf533516b53eaacb8985584d30a704c500f8`. All 6 GLB outputs are byte-identical to the previous run.
- An endpoint check runs on a `MultiLineString` link only if it has one part or every part starts exactly where the previous one ended. Otherwise the link is skipped and coverage is reported as partial.
- `acquire --offline` no longer rejects a stored object just because its old record says `size_check: MISMATCH`. It still checks SHA-256 and byte count, then compares the size with the current manifest, so an object whose manifest has been corrected comes back as `MATCH` without a new download.
