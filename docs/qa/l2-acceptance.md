# GTEki — per-station L2 acceptance spec (Lane F)

**Status:** review aid. It turns the L2 definition and the four required L2 evidence items in [acceptance.md](../acceptance.md) into one rubric per station, says which row an automated check can speak to and which row only a person can judge, and fixes how an independent review is run. It grants nothing. The Owner's judgement is the L2 call, and the pack never says PASS for a human row. Harness and suites: [protocol.md](protocol.md).

## How a pack is made

```bash
tools/qa/l2-pack.sh ikebukuro "$TMPDIR/gteki-qa" origin/main            # or shinjuku; add refs to merge, then -- <playwright args>
node tools/qa/l2-pack.mjs tests/e2e/artifacts/evidence --station ikebukuro --candidate "$TMPDIR/gteki-qa/candidate"
```

`l2-pack.sh` wraps `run-candidate.sh` (exact candidate, `manifest.json`) and runs one station's tests from `01`, `02`, `03`, `04` (the "walls stop" probe only), `05`, `09`, `11`, `12` (Ikebukuro walks only) and `13` on `desktop-chromium` and `phone-webkit`, one worker, traces off. Add `--project=phone-chromium` after `--` to include the Pixel 7 profile; `L2_LOOK=1` adds `10-look-compare`. Then `l2-pack.mjs` writes `tests/e2e/artifacts/l2-pack-<station>/`:

- `l2-review.md`: this document's station table, automated rows pre-filled with values and the rule verdict, human rows marked `needs eyes` with the files to open, and an empty `Reviewer verdict / notes` column.
- `l2-pack.json`: the same rows, the measurements and the file groups, for diffing two runs.
- `sheets/`: one contact sheet per walk and project (`contact-sheet.sh`, needs ffmpeg; without it the frames are listed).
- `manifest.json`: a copy of the run manifest (candidate SHA, harness SHA, browser, host).

Evidence that is missing says `n/a (not run)`. A pack on software WebGL (SwiftShader, llvmpipe) is flagged invalid for performance and visuals. The script exits 0 even with missing evidence and non-zero only on bad usage.

## Verdict rules

- **PASS / GAP / FAIL** appear only for rows with a real automated rule, taken from the spec's own asserts or from [protocol.md](protocol.md). One failing check makes the row FAIL, missing or partly missing evidence makes it GAP or `n/a (not run)`, and PASS needs every check present and satisfied.
- **Human rows** say `needs eyes` (or `needs ears`) and are "reviewer judgement". No script scores them.
- **No FPS threshold** is invented. Acceptance forbids ungrounded FPS thresholds, texture-count targets and meter quotas. `05` records fps, frame ms and draw calls; the only limits in the pack are the near-black, luminance, framing, cue-gap, clamp and lens numbers already in `09`-`13`. The Shinjuku B-checks (`b-checks.md`, [protocol.md](protocol.md)) keep #61's own limits and are not an L2 gate.
- Phones are Playwright device emulation (iPhone 15 on WebKit, Pixel 7 on Chromium). Physical-device checks stay a **GAP**.

## Station materials

| | Ikebukuro | Shinjuku (Toei Oedo, E27) |
|---|---|---|
| Walks (`03`, `13`; `12` for Ikebukuro) | `jrc2-exit35` (JR Central Gate 2 to Exit 35, a stair climb), `westb1-exit4` (West Exit B1 to the foot of Exit 4, a long B1 passage) | `exit1-platform` (street Exit 1 down to the Oedo platform, escalators under hanging signs), `platform-exit2` (platform to Exit 2, the exit:2 street stair, #70) |
| Landmark list | `stations/ikebukuro/gteki/pois.json` (gates, exits), the signs in `stations/ikebukuro/scene/signage.json`, the survey-derived `accessFacts` in `stations/ikebukuro/data/graph.src.json` | `stations/shinjuku/gteki/pois.json` (exits, ticket gates, platform, lifts, toilets) and the plan facilities in `stations/shinjuku/data/plan.json` |
| Deliberate simplifications and gaps | `stations/ikebukuro/README.md` (Deliberate simplifications), `stations/ikebukuro/docs/coverage-gaps.md`, `coverage.gaps` in `gteki/station.json` | `docs/stations/shinjuku/README.md` (Deliberate simplifications, Coverage gaps), `coverage.gaps` in `stations/shinjuku/gteki/station.json` |
| Reference stills in the repo | `stations/ikebukuro/docs/evidence/*.jpg` and the two recorded walks there | none committed; the reviewer brings facts-only sources and names them |

**References.** Facts only: layout, counts, ordering, heights and what a sign says may be taken from official maps, photos and open data. Operator graphics, logos, sign artwork and typefaces are reference-only and are never copied into or shipped with the build (acceptance.md, G0). A reviewer states the source of every reference they compared against.

## Ikebukuro

| ID | Criterion | Automated evidence (spec and output file) | Human or independent reviewer must look at | Rule |
|---|---|---|---|---|
| C1 | Coherent architecture and scale | `01` `ikebukuro-smoke.json` (real scene, not the L0 fallback, no page errors); `04` `ikebukuro-wall-probe.json` (walls stop the walker) | Walk frames of both walks, `ikebukuro-wall-probe-*.png`, overview frames: ceilings, passage widths, stair proportions against the references | Automated: PASS when `01` is clean and every `04` run is under 95 m, inside the scene bounds, within 15 m of a walkable edge or inside a mapped unrestricted space, and the walker moves; FAIL on any miss. Human: reviewer judgement |
| C2 | Useful landmarks | `11` `ikebukuro-overview.json` (overview mode, routable label spread 50-80 % of the shorter side as a proxy, an exit label on screen, a hidden exit reachable by search); `09` `ikebukuro-label-fade.json` (half the poses show a label) | Overview frame, fade `-c.png` frames, walk frames, against the landmark list | Automated: the soft asserts of `09` and `11`. Human: reviewer judgement on whether each listed landmark is seen, recognisable and distinct |
| C3 | Distinct wayfinding | `12` `ikebukuro-cues-<walk>.json` (largest gap between sign or junction cues <= 30 m, leg covered, HUD instructions; stagnant runs and front-facing gaps recorded); `03` HUD instructions | `ikebukuro-cues-*.png`, walk frames, recordings: consecutive frames distinguishable, cues sourced from documented facts | Automated: `12`'s own rule (gap <= 30 m). Stagnant runs are listed, not judged. Human: reviewer judgement |
| C4 | Materials and light | `13` `ikebukuro-camera-<walk>.json` (worst near-black frame <= 0.10); `11` (overview near-black <= 0.30, mean luminance 40-200 of 255); `03` near-black listed; `10` `look-compare.json` RMSE if run (relative, never a gate) | Walk and camera frames: surfaces, repeated panels, baked light, black voids, blown highlights | Automated: the two limits above. Human: reviewer judgement |
| C5 | Movement and interaction feedback | `03`/`13` arrival within 2 m and the arrival toast; `13` camera held at the clamp <= 1.25 s, crowded frames (camera-to-head < 1.0 m) recorded, lens ease no FOV step > 5 deg and final FOV within 0.5 deg of the source's | Recordings: follow camera on the Exit 35 stair and the tight B1 corridor, avatar, arrival, mode switches; flagged `13` frames | Automated: those limits. Crowded frames are recorded only. Human: reviewer judgement |
| C6 | Readable interface | `01` and `11` (no POI label painted over UI, zero overlaps among visible non-faded labels) | Phone and desktop frames: HUD, route card (`ikebukuro-03-route-card.png`), coverage dialog (`-02-coverage.png`), instruction preview | Automated: those two asserts. Human: legibility and touch reach, reviewer judgement |
| U1 | Freshness notice on the route card (Ikebukuro only) | `02` `ikebukuro-navigation.json` records `route.stale` per scenario (true for the routed scenarios today: the source guide dates from 2022 and the core default window is 730 days). No spec captures whether the card shows the notice | `ikebukuro-03-route-card.png` per project: the "Possibly outdated" (ja: 情報が古い可能性) badge must be on the card, and the coverage dialog states the source date | Automated card check: **n/a (not captured)**. The row is GAP while `route.stale` is true and no spec reads the card. Human: reviewer judgement |
| C7 | Sound | None. No spec records audio and Playwright recordings are silent | A live desktop and phone session with sound on (the Ikebukuro ambience plays through the host audio hook, with a HUD mute) | No automated verdict. Reviewer judgement, and only where the audio is licensed. If none is present, say so |
| C8 | Desktop and phone checks (judgement) | Coverage is E3 | Desktop and phone sheets of the same walk side by side | Reviewer judgement |
| C9 | Rendering and performance issues (judgement) | Measurements are E4 | Walk, camera and recording frames: z-fighting, popping, black voids, flicker, missing geometry | Reviewer judgement |
| E1 | Evidence 1: walkthrough from an in-scene landmark to the destination, with turning and wayfinding | `03` `ikebukuro-walk-<walk>.json`; `13` arrival; `12` the sampled walk covers >= 90 % of the leg | The recordings of `jrc2-exit35` and `westb1-exit4`, start to arrival, and the walk contact sheets | Automated: arrived, within 2 m, more than one HUD instruction. Turning and wayfinding quality: reviewer judgement |
| E2 | Evidence 2: independent side-by-side review of reference-grounded features and the list of deliberate simplifications | None. `10` compares against Lane E renders, not against the station | Frames next to `stations/ikebukuro/docs/evidence/*.jpg` and any references the reviewer names; the simplification list in the README | Human only. Each distinctive feature is matched, simplified (listed) or a defect (not listed) |
| E3 | Evidence 3: desktop and phone interaction and visual checks | Inventory of which suites produced output on which project (`01`, `03`, `05`, `09`, `11`, `12`, `13`) | Desktop, iPhone 15 (WebKit) and Pixel 7 (Chromium) captures | GAP while phones are emulated. GAP if desktop or any phone project is missing. Never PASS |
| E4 | Evidence 4: rendering and performance issues and actual device and browser measurements | `05` `ikebukuro-perf.json`: renderer string, fps, frame ms p95/max, draw calls, heap; `manifest.json` browser and host | The recordings, for the issues behind the numbers | Automated: GAP (invalid) when the renderer is SwiftShader, llvmpipe or Software; FAIL when no frames or the product drew nothing in half the frames; otherwise PASS means valid evidence only, not good performance. No FPS threshold |

## Shinjuku

| ID | Criterion | Automated evidence (spec and output file) | Human or independent reviewer must look at | Rule |
|---|---|---|---|---|
| C1 | Coherent architecture and scale | `01` `shinjuku-smoke.json`; `04` `shinjuku-wall-probe.json` | Walk frames of both walks, `shinjuku-wall-probe-*.png`, overview frames: the B1 gate area, switchbacks, platform curve, stair and escalator proportions | As Ikebukuro C1 |
| C2 | Useful landmarks | `11` `shinjuku-overview.json`; `09` `shinjuku-label-fade.json` | Overview, fade `-c.png` and walk frames against `pois.json` (exits, gates, platform, lifts, toilets) | As Ikebukuro C2 |
| C3 | Distinct wayfinding | None for cue spacing (`12` is Ikebukuro only). `03` `shinjuku-walk-<walk>.json` lists the HUD instructions | Hanging and floor signs in the walk frames, recordings, the generated GTEki signs (original design, not operator signage) | No automated verdict. Reviewer judgement |
| C4 | Materials and light | `13` `shinjuku-camera-<walk>.json` (worst near-black <= 0.10); `11` (as Ikebukuro); `03` near-black max <= 0.10 (B2 in protocol.md); `10` if run | Walk and camera frames: tile, wall and ceiling materials, lit ceilings, platform, train and screen doors | Automated: the limits above. Human: reviewer judgement |
| C5 | Movement and interaction feedback | `03`/`13` as Ikebukuro C5; `13` `shinjuku-camera-fov-ease.json` | Recordings: escalators, the exit:2 street stair (camera crowding the avatar, #70), gate lines, arrival | As Ikebukuro C5 |
| C6 | Readable interface | `01` and `11` as Ikebukuro C6 | Phone and desktop frames of the HUD, route card, coverage dialog | As Ikebukuro C6 |
| C7 | Sound | None (no audio is recorded) | A live session with sound on; the lane app synthesises ambience with WebAudio, the shared explorer's audio hook decides what plays there | No automated verdict. Reviewer judgement, and only where licensed. If none is present, say so |
| C8 | Desktop and phone checks (judgement) | Coverage is E3 | Desktop and phone sheets of the same walk side by side | Reviewer judgement |
| C9 | Rendering and performance issues (judgement) | Measurements are E4 | Walk, camera and recording frames | Reviewer judgement |
| E1 | Evidence 1: walkthrough from an in-scene landmark to the destination, with turning and wayfinding | `03` `shinjuku-walk-<walk>.json`; `13` arrival | The recordings of `exit1-platform` and `platform-exit2`, start to arrival | Automated: arrived, within 2 m, more than one HUD instruction. Turning and wayfinding: reviewer judgement |
| E2 | Evidence 2: independent side-by-side review of reference-grounded features and the list of deliberate simplifications | None | Frames next to facts-only references the reviewer names (none are committed); the simplification list in `docs/stations/shinjuku/README.md` (heights symbolic, generic ceilings, gates, platform doors, train, signs, commuters) | Human only |
| E3 | Evidence 3: desktop and phone interaction and visual checks | As Ikebukuro E3 | As Ikebukuro E3 | As Ikebukuro E3 |
| E4 | Evidence 4: rendering and performance issues and actual device and browser measurements | `05` `shinjuku-perf.json` as Ikebukuro E4; the B-checks table `b-checks.md` (B4 overview draw calls, phone speed) when `shinjuku-b-checks.sh` was run | The recordings | As Ikebukuro E4. The B-checks limits belong to #61, not to L2 |

## Independent review procedure

1. **Reviewer.** The Owner, or a labelled fresh read-only Claude subagent that did not write the code under review. Astra and the Codex CLI are not used. A subagent reviewer must not check out or modify anything in the shared clone.
2. **Input.** The reviewer gets only the pack (`l2-review.md`, `l2-pack.json`, the contact sheets, frames and recordings it links, `manifest.json`) and the station's reference sources. No author notes, no verdict hints.
3. **Scoring.** Every `needs eyes` and `needs ears` row gets a verdict and a one-line reason in the `Reviewer verdict / notes` column, using the vocabulary of [protocol.md](protocol.md): PASS, GAP, HOLD or FAIL. Automated rows are read as evidence and can be disputed with a reason, never edited.
4. **Simplifications and defects.** The reviewer lists what differs from the references as either a deliberate simplification (it is in the station's list) or a defect (it is not). A simplification that hides a missing fact is a defect against G0.
5. **Provenance.** The reviewer records its model and effort only if that model actually ran. Lack of a model is never a reason to claim a review occurred.
6. **Decision.** The reviewer's table is an input. The Owner's judgement is the L2 call, and merge, release and any real-world navigation claim stay with the Owner.

## Not covered

- **Physical phones.** Emulation only; a physical-device pass is a GAP until someone runs it on hardware.
- **Godot.** No Godot client is exercised by this pack.
- **Sound.** The harness records no audio; the row is human-only and says so if no audio asset exists.
- **Whole-station completeness.** An L2 slice is a bounded scene. Coverage gaps (see the station sources above) are reported separately and unbuilt areas are not passed off as complete.
- **Anything not in the pack's file lists,** including runs on projects that were not requested.
