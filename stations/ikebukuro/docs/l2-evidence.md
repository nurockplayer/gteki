# Ikebukuro: L2 acceptance evidence pack

**Compiled at main `dc59b38`, 2026-10-22.** This pack lists what evidence exists for each of the four observed-L2 items in `docs/acceptance.md`, what is missing, and the exact capture plan to fill it. **It does not claim L2 is met.** L2 is judged by independent visual and interaction review on actual desktop and phone captures (Lane F reports, the Owner decides). Gate-by-gate status: [g0-g4-status.md](g0-g4-status.md).

The four required items (`docs/acceptance.md`, "Required observed L2 evidence"):

1. a walkthrough from at least one actual in-scene landmark to the destination, including turning and wayfinding;
2. independent side-by-side review of distinctive reference-grounded features, and a list of deliberate simplifications;
3. desktop and phone interaction and visual checks;
4. rendering and performance issues, and actual device and browser measurements (no ungrounded FPS threshold, texture count or meter quota).

| Item | What exists | What is missing | Who |
|---|---|---|---|
| 1 Walkthrough | Two recorded walks (2026-10-20 and 21), 34 stills, Lane F guided walks on `b511263` | A recording on current main, including wayfinding cues (#126) and, if merged, street arrival (#110) | Lane F (GPU slot) |
| 2 Side-by-side | Deliberate-simplifications list (below); an Astra review at `08d4668` (stale, model retired); a Blender-versus-game look report for the kit only | A fresh independent review of current frames; the checklist below filled in | Lane F; Owner for the real reference |
| 3 Desktop and phone | Desktop recordings; Lane F phone emulation (iPhone 15, Pixel 7); one emulated phone still | Any physical phone; phone emulation re-run on current main | Owner, Lane F |
| 4 Measurements | README draw and triangle counts; Lane F desktop and emulation timings at `a5a555c`; #110 and #126 slot measurements (2026-10-22) | Phone hardware numbers; one combined measurement of main plus #110 plus #126; the 641 ms WebKit frame re-measured | Lane F (GPU), Owner (phone) |

Rights note: every screenshot and video of the scene shows PLATEAU-derived geometry (CC BY 4.0, modified); the credit and what the images contain are in [evidence/README.md](evidence/README.md).

## 1. Walkthrough from a landmark to the destination, with turning and wayfinding

### What exists

| Evidence | Where | Notes |
|---|---|---|
| Recorded walk, JR Central Gate 2 to Exit 35, 121 s, 199 m, with the stairs down to `e_low`, a turn, and the stairs up to street level | [walk-jr-central-gate2-to-exit35.mp4](evidence/walk-jr-central-gate2-to-exit35.mp4) (2026-10-20) | Landmark: JR Central Gate 2. Predates #38, #48, #54, #56, #81, #85. |
| Recorded walk, West Exit (B1) to Exit 4 stair foot, 117 s, 187 m, slices 4-5, one long "Turn left" leg | [walk-west-exit-to-exit4.mp4](evidence/walk-west-exit-to-exit4.mp4) (2026-10-21) | Ends at the stair foot by design. This is the walk with the A4 repetition finding (#108). |
| Stills along all five slices (landmarks, junction signs, stairs) | `evidence/01-...` to `evidence/29-...`; index in the README "Evidence stills" | Captured in the preview harness, not in the shared explorer. |
| Explorer route card and instructions | [explorer-route-jrc2-exit35.jpg](evidence/explorer-route-jrc2-exit35.jpg) | |
| A3 before and after at the Exit 35 stair top and arrival | `evidence/30-` to `evidence/33-a3-exit35-*.jpg` | Shared explorer, desktop, high quality. |
| Lane F guided walks in the shared explorer | `docs/qa/reports/2026-10-21-lane-f-first-pass.md` (§0 pass 2, §4.2, §5, §6); frames in `docs/qa/reports/2026-10-21-evidence/` (`ikebukuro-walk-jrc2-exit35.jpg`, `ikebukuro-walk-westb1-exit4.jpg`, `ikebukuro-exit18-blocked-6e361d6.jpg` (the fixed defect)); full frame sets stay in Lane F's local `b511263` run | Both guided walks arrive (distance 0 m) on desktop, iPhone 15 and Pixel 7 emulation. |
| Route correctness for the walks | `scene/routing.test.ts:39` (golden), `:49` (optimal), `:207` (narration with the real stair dip) | Desk evidence, not visual. |
| Wayfinding cues | Existing signage: `scene/signage.json` (100 signs, content computed from the verified graph). Repeaters: #126, five signs, spacing about 23.9 m versus a largest gap of 143.1 m before, independent review on `23662c9` | #126 is a draft and is not on main. |

### What is missing

- A recording of both landmark walks on current main. The two MP4s are older than most of the camera, lighting, collision and avatar fixes, and the Lane F frame sets are not committed.
- A judgement of #108 acceptance 1 on a recording: at least one distinct, reference-grounded cue about every 30 m, and no two consecutive 3 s frames interchangeable. Lane F's review of #126 says the five repeaters might not count as distinct, since only the "~N m" numbers change.
- A walk that starts at a landmark and ends at street level with the street context (#110), which is the user's destination moment.

### Capture plan

Run by the lead on the host, one heavy job at a time, memory gate first. Candidate: main plus #126 head `23662c9` plus #110 head `d3e248a` (Lane F's `1b49562` was cut for this), or main alone for the baseline; name the SHA in the report.

| Walk | URL (shared explorer) | Viewpoints and frames | Tier and device |
|---|---|---|---|
| W1 JR Central Gate 2 to Exit 35 (199 m, 9 edges, 1 floor change) | `?station=ikebukuro&from=jr-central-gate-2&to=exit-35` | Guided walk at the fast tier, full recording; a frame every 3 s; extra stills: the Gate 2 sign cluster, the stairs down at `e_hall`, the turn at `e_low`, the stair climb from below, the stair top, the arrival frame | desktop-chromium at 1440x900 (Brave, ANGLE Metal), then phone-webkit (iPhone 15 profile) and phone-chromium (Pixel 7 profile) |
| W2 West Exit (B1) to Exit 4 stair foot (187 m) | `?station=ikebukuro&from=west-exit-b1&to=exit-4` | Same; read both faces of each repeater when walking south; stills at the three leg changes | same |
| W3 JR Central Gate 1 to Exit 22 (187 m, Lane F I3) | `?station=ikebukuro&from=jr-central-gate-1&to=exit-22` | One more route with a different turn pattern | desktop only |
| W4 JR South Gate to Exit 18 (288 m, Lane F I4) | `?station=ikebukuro&from=jr-south-gate&to=exit-18` | The three-flight U-stair; full descent from the top as well (Lane F's open item) | desktop only |

Record on each: the `__gteki.sceneInfo()` camera blocker count, the `jrc2-exit35-07` frame (is the camera ever above the stair cover), and whether the route card shows the stale flag (the route is stale under core's 730-day default today, `routing.test.ts:241`).

## 2. Independent side-by-side review, and the deliberate simplifications

### What exists

- Astra High visual review of baseline contact sheets at `08d4668` (Lane F report §7). It rated Ikebukuro GAP (bloom washing out exits, camera blocked by pillars, repetitive passages). It is stale, and that model is no longer used.
- `docs/qa/reports/2026-10-22-art-94-look-gap.md`: a Blender-render-versus-game measurement for the **kit** only (RMSE 0.450 escalators, 0.325 gates; proposal 0.102 and 0.169). It does not review the station scene.
- Lane F's plan (#3, interim list): a fresh read-only Claude subagent reviews current frames and video against the reference-only documents, labelled as that, plus the simplifications list. The Owner's own visual judgement stays the real L2 call.

### What is missing

- The review itself, on current main.
- A real-world reference. The Toshima 2022 guide and the Tokyo Metro 2026-03 yard map are reference-only (`facts-only`) and are **not stored in the repo**, so a desk review compares facts (which exit, which gate, order, level changes), not appearance. Appearance needs the field visit (HOLD, Owner), with the photo rules in the field checklist (public areas, no faces, no staff zones, operator signage for facts only and never published).

### Review checklist: distinctive features, each with its source

For each row: capture the same view, compare against the named source, record MATCH / DIFFERS / CANNOT TELL, and note what the reviewer compared against. "Where to look" gives the existing still or the node id.

| # | Feature (what a reviewer should check) | Source of the fact | Where to look |
|---|---|---|---|
| F1 | JR Central Gates 1 and 2 on the Central Passage, with the signs naming them | PLATEAU openings; gate names from the Toshima guide and the Tokyo Metro map (`facts-only`); nodes `g_jr_c1`, `g_jr_c2` | `02-jr-central-gate2.jpg`, `03-east-hall.jpg` |
| F2 | The Central Passage as a long straight east-west B1 spine with a regular column grid | PLATEAU geometry (`c_w` to `c_e2`) | `01-central-passage-east.jpg` |
| F3 | East hall, then a real stair down to a low point, then the Exit 35 stair up (TP 27.0 to 30.1 m) with an escalator beside it | PLATEAU EF_35 and EF_80 stairs and transport; the dip is asserted by `routing.test.ts:207` | `04-exit35-stairs.jpg`, `30-` to `33-` |
| F4 | South Passage level changes: TP 27.6 up to 29.1, then down to 25.9 m; exit stairs to TP 32.2-32.6 m | PLATEAU floor heights (README G1) | `07-south-passage-east.jpg`, `12-exit39-stairs.jpg` |
| F5 | Junction decisions just outside each JR gate: Exit 38 left, Exits 41 / 40 / 39 right | graph nodes `s38_j`, `s41_j`; exit numbers from the official maps (facts only) | `08-exit38-junction.jpg`, `09-exit41-junction.jpg`, `10-se-corridor.jpg` |
| F6 | North Passage and Exit 22 (東口（北）); the drop between the Ikebukuro Shopping Park blocks; Exit 28's U-shaped stair via a TP 29.0 m landing | PLATEAU geometry; names from the Toshima guide | `15-north-passage-exit22.jpg` to `18-exit28.jpg` |
| F7 | West Exit (西口) underground hall at TP 27.9 m with exits 10, 11, 15, 17, 18 | PLATEAU geometry; exit numbers as facts | `19-west-exit-hall.jpg`, `22-exits-10-11.jpg`, `23-exit17-stairs.jpg` |
| F8 | Exit 18 three-flight stair, landings TP 29.1 and 30.5 m, the top flight passing over the bottom one | PLATEAU stair geometry; fixed in Lane F A1 | `21-exit18-ustair.jpg` |
| F9 | Exits 4, 13 and 36 end at the foot of the stairs, at the wall opening the official map places the exit at; no climb is shown | README simplification; map position (facts only) versus the PLATEAU opening | `27-exit4-foot.jpg`, `29-exit13-foot.jpg` |
| F10 | Area names as searchable places: 北通路, 南通路, 東口（地下）, 西口（地下）, 西口（南）（地下） | Toshima guide area names (facts only) | search UI; `pois.json` |
| F11 | The JR South Gate and the West Exit (South) hall; the passage north from there | PLATEAU geometry; gate name as fact | `24-` to `26-`, `28-` |
| F12 | "Access unverified" panels where surveyed floor continues outside the routable areas (JR-Tobu passage, Yurakucho gate area, west of slice 3) | `coverage.gaps` in `station.json`; `scene/access_fences.json` | Lane F `ikebukuro-walk-westb1-exit4` last frames |
| F13 | Exit-number signage: dark panel, white arrow, yellow rounded number chips, with the right numbers per direction | Numbers and gate names computed from the verified graph (facts only); GTEki's own design | `08-`, `09-`, `18-exit28.jpg` |
| F14 | Repeater signs on the Exit 4 passage with a distance countdown (#126, if merged) | Graph edge lengths; each sign's `basis` names the edge, the access fact and the POI ids | #126 head `23662c9` |

What the review must **not** count as a reference-grounded feature: sign positions, light fixtures, materials, shopfront glow, crowd (all in the next list).

### Deliberate simplifications (from the README, kept in sync with it)

- **Light fixtures**: generated on a regular 2.4 x 3.0 m grid under surveyed ceilings. They are not surveyed positions; the 4000 K colour is art direction.
- **Materials**: generic procedural finishes (tiles, enamel panels, ceiling grid, granite stairs). They are not the station's actual finishes. The Lane E finish-pack loader (#144) is in, with an empty manifest, so nothing changes at runtime yet.
- **Shopfronts**: anonymous glowing glazing in PLATEAU window and door openings; no names or brands.
- **Signs**: GTEki's own design, about 4 m along each verified edge from junctions. Content is computed from the verified graph; positions are not real sign locations. Gate names carry a plain line-colour chip, not an operator logo.
- **Crowd**: ambient decoration on verified edges, clamped to surveyed walkable lanes. Not a pedestrian-flow model.
- **Openings into unmodelled space** (fare areas, shops): block movement and render as a fogged continuation of the opening's floor and ceiling heights. They show that space continues, not what is there.
- **Exit stairs** end in a daylight portal; there is no street-level model on main yet (#110 adds context at exits).
- **Single risers** modelled as two floor levels are passable on stair edges only.
- **An exit node is the top of its surveyed stairs**, under the stairwell's street-level closure.
- **Exits whose stairs are outside the survey** (Exit 4; Exits 13 and 36 only the lower flight) are routed to the stair foot; the climb is not modelled or claimed.
- **Free walking stays on verified floor**: surveyed floor outside the routable areas is visible but cannot be entered, with an "Access unverified" panel.
- **Scene coverage**: five B1 slices, not the whole station; 20 exits and gates are search-only (#185 adds a 21st; see [coverage-gaps.md](coverage-gaps.md)).
- **Godot** is not access-fenced and has different door semantics from the web.

## 3. Desktop and phone interaction and visual checks

### What exists

| Evidence | Where | Notes |
|---|---|---|
| Desktop recordings and stills | `evidence/` (above); Lane F's `b511263` run (desktop-chromium on Brave 155, ANGLE Metal, Apple M2 Pro) | Search, route card, Start guide, HUD speed, view toggle driven by real clicks; free walk by real mouse-look plus `simulate()` |
| Phone, emulated | Lane F report §4.5 (first pass: labels over the UI blocked the search flow, fixed by #30); pass 2: phone searches pass, guided walks arrive, clipped white 0.04 %, near-black 0.003 on phones | Playwright iPhone 15 (WebKit, 393x659) and Pixel 7 (Chromium, 412x839). Touch, viewport and user agent are emulated; the GPU and CPU are the desktop's. |
| Phone still | [m01-central-passage-mobile.jpg](evidence/m01-central-passage-mobile.jpg); `docs/qa/reports/2026-10-21-evidence/phone-webkit-ikebukuro-labels-over-search.jpg` (the defect that #30 fixed) | Both emulated. |
| Phone POI labels over signs | #126 comment: "Exit 13" and "West Exit South (B1)" labels draw over the repeater panel on the phone tier | Explorer HUD layering; #158 fixes it (Lane C). |

### What is missing

- **Any physical phone.** No touch, thermal, real GPU, browser UI chrome, safe-area or real-network check exists.
- A phone-emulation re-run on current main (every fix since `b511263`: #81 body collision, #85/#90 camera, #78 floor fallback, #83 route occlusion, #79 toasts, #54 lighting).
- Sound by ear (procedural ambience; headless capture cannot judge it).

### Capture plan

| Check | Device and tier | Route and views | Record |
|---|---|---|---|
| Open, choose the station, search, route, guided walk, free walk | Physical iPhone (Safari) and physical Android (Chrome); note model, OS, browser version; the app picks the `low` tier | W1 and W2 above, plus free walk in the Central Passage with the touch joystick (left half) | Screen recording of each; whether the labels stay below the UI; whether the toolbar covers the joystick zone; arrival toast; any visible stutter (note where) |
| Same on emulation, current main | phone-webkit (iPhone 15) and phone-chromium (Pixel 7) in Lane F's harness | specs `01`, `02`, `03` at the SHA under test | Pass or fail per spec; clipped-white and near-black per frame |
| Desktop reference | desktop-chromium 1440x900, high tier | W1 to W4 | Frames and recordings as in item 1 |
| Sound | Desktop speakers and a phone, mute toggle, volume at first open | 60 s in the Central Passage, 60 s on the Exit 35 stairs | Owner's listening notes (comfort, loops, loudness); this is a judgement, not a measurement |

## 4. Rendering and performance issues, and measurements

### What exists (all measurements are observations; no threshold is claimed)

**Station scene budget, preview harness** (README "Measured"; Apple Silicon, Chromium): quality `low` at most 28 draw calls and 129k triangles per frame (56 crowd agents, 100 signs, 16 views). **Caveat from the 2026-10-22 slot:** that count covers the scene pass only. Counted at the WebGL boundary across all passes, main's low tier is 44-53 draws and 132-136k triangles underground, and the old absolute assertion fails on main too (53 / 136k). Shipped assets: 9.5 MB at high; lightmap WebP 1.1 MB (4k) or 0.5 MB (2k). The deploy build today ships 10 files, the largest `ikebukuro_b1_lit.glb` 5.30 MB and `ikebukuro_b1.glb` 2.95 MB ([g0-g4-status.md](g0-g4-status.md), G0 row 6).

**Lane F, shared explorer, desktop** (report §6, ANGLE Metal, Apple M2 Pro, Chromium headless 1440x900): Ikebukuro at `a5a555c`: load 906 ms, 6.6 MB over 15 requests, overview 60 fps with 70 draws, guide 60 fps with 80-85 draws, walk 60 fps with 76 draws, JS heap 28 MB. Pass 2 (`b511263`): overview draw calls 279 desktop and 127 phone, Shinjuku-heavy; 60 fps on desktop and Pixel 7; near-black frame fraction max 0.061 desktop and 0.003 phones.

**Phone emulation** (report §4.5, M2 Pro GPU, not phone hardware): iPhone 15 WebKit guide frame max **641 ms** once, 0-4 frames over 50 ms per window; Pixel 7 60 fps, worst frame 49.9 ms. Pass 2: iPhone 15 emulation on the Shinjuku walk 40.2 fps while a replay ran in a container (to be re-run idle); Ikebukuro not separately listed.

**#110 street context vs main, low tier** (PR #110 comment, 2026-10-22 11:40-11:49, head `695f124`; ANGLE Metal on an Apple M2 Pro via Brave and Playwright; `phone-chromium` probe):

| | main, draws p50 / triangles | #110, draws p50 / triangles |
|---|---|---|
| Underground, 16 views | 44-53 / 132-136k | 44-53 / 132-136k (context not attached underground) |
| Street (x35, x39, x11, x38), 16 views | 49-56 / 122-137k | 51-64 / 129-168k |

Context cost at street level: about +5-9 draws and +20-30k triangles. One outlier frame (59 draws, 163k triangles on the first row) is probably the context drawn once during the fly-in; not verified. Godot: `check:godot` passes; the context loads as 8 `context` meshes with no colliders. Independent review: context GLBs low 8 draws / 30.4k triangles, high 8 draws / 139.5k.

**#126 repeater signs** (PR #126 comment, 2026-10-22 11:44-11:46, head `23662c9`): the low-tier sign atlas stays one 4096x2048 page; lightmap 2048^2; the "~N m" text is legible on the phone profile at a 6 m stand-off at the same size as existing secondary text. Both faces of all five repeaters on low and high were captured to `.qa/ikebukuro-repeaters/{low,high}/` (local, not committed).

**Kit versus game look** (`docs/qa/reports/2026-10-22-art-94-look-gap.md`, main `15cf589`, ego-lite on an M2 Pro, kit scenes only): relative frame times (desktop GPU) 11.0 / 15.1 ms (escalators / gates) today versus 9.1 / 14.4 ms with the proposal; phone tier 2.2 / 2.4 ms. Not a station-scene measurement.

**Known rendering and performance issues** (from the sources above): C5 overview opens 79 % near-black on desktop (#109, #114); labels overlapping signs (#158); roads possibly hidden under the explorer's pavement plane at exits x10, x11, x15, x39, x42 (Lane F P2 on #110); follow camera inside buildings at x39-x42 (P3); #110 awaits the context GLB before the scene resolves (2.3 MB low, 9.5 MB high, P3); the 641 ms iPhone-WebKit frame; the "Fast 6.8 m/s" label (#92).

### What is missing

- Measurements on **physical phones**: none exist.
- One measurement of the candidate that would ship: main plus #110 plus #126, on desktop and both emulated phones, with draw calls and triangles counted at the WebGL boundary across all passes (the old 28 / 129k figure is not comparable).
- The Lane F 15:05-16:05 slot on `1b49562` (main + #110 + #126) had not reported at compile time; if it has, its numbers supersede the ones above.
- First-open load time with #110 (context GLB awaited).
- Idle-host re-run of the iPhone WebKit frame times.

### Capture plan

Host with a real GPU, one job at a time, `memory_pressure` free at least 20 %, `vm_stat` showing no sustained swapouts, Brave. Disk headroom first (Playwright traces filled the disk before). Run spec `05-performance` (WebGL draw probe, renderer string recorded) and the budget probe.

| What | Where and how | Record |
|---|---|---|
| Draw calls, triangles, frame time p50 / p95 / max, all passes | Four spots x four headings in the Central, West, South-West and North areas (the README's 16 views), underground; plus the street views at x35, x39, x11, x38 and, for the roads question, x10, x15, x42; on desktop-chromium high, phone-chromium low and phone-webkit low; main alone, then main + #110 + #126 | Per-view table; the renderer string; `__gteki.sceneInfo()` |
| First-open load | Cold cache, throttled 4G profile and unthrottled, W1 URL | Time to ready, transfer bytes and request count (the deploy ships about 9.9 MB for Ikebukuro) |
| Guide walks | W1 and W2, 60 s windows | Frame-time max and the count over 50 ms; 641 ms recurrence on iPhone WebKit |
| Heap and GPU texture memory | After W2 | JS heap; the sign atlas page count (expect one 4096x2048 on low) |
| Physical phone | The Owner's iPhone and Android: Safari or Chrome remote Web Inspector (Mac Safari for iOS) or `chrome://inspect`; open W1 and W2, 60 s each | Frame rate from the Performance tab or the in-page probe; thermal state after 5 minutes; device model, OS, browser version |
| Visual quality per frame | Every captured frame | Clipped-white fraction (expected 0 % at the stair top and arrival), near-black max (expected at most 0.047 per Lane F's baseline) |

Expected values to compare against (Lane F baseline, not thresholds): clipped white 0 % at the Exit 35 stair top and arrival; near-black max 0.047; low tier 44-53 draws and 132-136k triangles underground at the WebGL boundary; routes 63 of 63 edges, 1,744 m.

## What would let the Owner and Lane F call this

Nothing above is a verdict. To give Lane F everything it needs, the lead schedules, in this order, one GPU job each: (a) the candidate build and `05-performance` plus the draw probe (item 4); (b) W1 to W4 recordings and phone-emulation specs `01`-`03` (items 1 and 3); (c) the independent review over those frames, filling the F1-F14 table (item 2). Items needing a person with a phone or on site: the physical phone checks, the sound check, the field visit, and the real-reference side-by-side.
