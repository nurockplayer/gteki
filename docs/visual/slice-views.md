# Slice views: Shinjuku Oedo exit 1 → B6 platform

The slice for the 2026-11-22 gate (token-rules 25): from the exit 1 street entrance, through the B1 concourse and gates, down two escalators to the Oedo platform on B6. These are the fixed viewpoints the art direction is judged on. Four of them are hero moments (marked **H1–H4**), which get target frames and paint-overs in `references.md`.

How the list was made (2026-11-11 04:4x JST, main af4cbfa6): the route is the one the app walks for `poi:exit:1` → `poi:platform:oedo` (walk scan `shinjuku-exit1-platform`, 82 samples, 204 m, from #1112's recheck). Each sample's avatar position was matched to the nearest graph node on its floor (within 2 m). `headingDeg` is the walking direction at that node (clockwise from +y, the same frame as `tests/e2e/golden-cameras.json`). Headings are a first pass: they have not been checked against a render yet, and the first golden render may adjust them.

Route: exit 1 stairs (toei-nwd-0 → m0_5 → m1, 17 m) → B1 concourse with the sign-1ecbdf77 corridor → ticket gate → escalator m1 → m3 → B3 concourse past sign 453ea111 → long escalator m3 → m6 → B6 platform.

| # | id | floor | node | heading | moment | already a golden camera (#1170) |
|---|---|---|---|---|---|---|
| 1 | `slice-01-exit1-mouth` | toei-nwd-0 | `n:a06f3d19…` exit | 174 | **H1 first recognisable view**: the exit 1 mouth and its sign, looking down the stairs | no |
| 2 | `slice-02-exit1-landing` | toei-nwd-m0_5 | `n:49924b2c…` stair end | 174 | the mid-stair landing, street light behind | no |
| 3 | `slice-03-b1-arrival` | toei-nwd-m1 | `n:e764ee9d…` junction | 111 | foot of the exit stairs, the concourse opens | no |
| 4 | `slice-04-b1-corridor` | toei-nwd-m1 | `n:1ecbdf77…` junction | 70 | **H2 main corridor landmark**: the long B1 corridor with overhead sign 1ecbdf77 | near: `sj-sign-1ecbdf77` sits at `n:9ff85d09…` 250° (the reverse look) |
| 5 | `slice-05-gate` | toei-nwd-m1 | `n:d9cd1bb0…` ticket gate | 159 | the Oedo ticket gate line | no |
| 6 | `slice-06-to-escalator` | toei-nwd-m1 | `n:2d2bc35b…` junction | 84 | approach to the first escalator | near: `sj-sign-2d2bc35b` at `n:20014f52…` 266° |
| 7 | `slice-07-escalator1-top` | toei-nwd-m1 | `n:e4365ef2…` escalator end | 250 | top of escalator m1 → m3 | yes: `sj-escalator-top` |
| 8 | `slice-08-b3-arrival` | toei-nwd-m3 | `n:ea71c5f7…` escalator end | 244 | foot of escalator 1 on B3 | yes: `sj-escalator-bottom` (70°, the reverse look) |
| 9 | `slice-09-b3-sign` | toei-nwd-m3 | `n:180ce956…` junction | 148 | B3 concourse under sign 453ea111 (the minimap-yield sign, #1110) | yes: `sj-sign-453ea111` (334°, the reverse look) |
| 10 | `slice-10-escalator2-top` | toei-nwd-m3 | `n:9c7256cd…` escalator end | 165 | **H3 escalator transition**: the long Oedo escalator dropping 19 m to B6 | no |
| 11 | `slice-11-b6-arrival` | toei-nwd-m6 | `n:aa29caed…` escalator end | 159 | **H4 platform arrival**: stepping off onto the B6 platform | no |
| 12 | `slice-12-platform` | toei-nwd-m6 | `n:3c2d5864…` platform | 75 | along the platform and track | yes: `sj-sign-e31954cb` |

## Camera entries

In the golden-camera format of #1170 (`tests/e2e/golden-cameras.json`), ready to append once that PR lands. The `expect` lines are the technical check; the art acceptance is judged against the hero frames, not these strings.

```json
[
  { "id": "slice-01-exit1-mouth", "station": "shinjuku", "kind": "node", "node": "n:a06f3d191885497bac197b666c4daef9", "headingDeg": 174, "expect": "Exit 1 entrance stairs and their sign are visible from the street." },
  { "id": "slice-02-exit1-landing", "station": "shinjuku", "kind": "node", "node": "n:49924b2c3a1e4b6b8ebd802a6d137205", "headingDeg": 174, "expect": "The exit 1 stair landing and the next flight down are visible." },
  { "id": "slice-03-b1-arrival", "station": "shinjuku", "kind": "node", "node": "n:e764ee9de7834a9aae179ce41bbf2e9a", "headingDeg": 111, "expect": "The B1 concourse opens from the foot of the exit 1 stairs." },
  { "id": "slice-04-b1-corridor", "station": "shinjuku", "kind": "node", "node": "n:1ecbdf77f58f423fa3142d1b71e078bf", "headingDeg": 70, "expect": "The B1 corridor and its overhead sign are visible." },
  { "id": "slice-05-gate", "station": "shinjuku", "kind": "node", "node": "n:d9cd1bb0f76a440d83010e5b9f63ad65", "headingDeg": 159, "expect": "The Oedo ticket gate line is visible." },
  { "id": "slice-06-to-escalator", "station": "shinjuku", "kind": "node", "node": "n:2d2bc35b4043433da2914b2705ef69bb", "headingDeg": 84, "expect": "The paid concourse leading to the first escalator is visible." },
  { "id": "slice-07-escalator1-top", "station": "shinjuku", "kind": "node", "node": "n:e4365ef27b14448eb770343c8a024f80", "headingDeg": 250, "expect": "The escalator from B1 down to B3 is visible from its top." },
  { "id": "slice-08-b3-arrival", "station": "shinjuku", "kind": "node", "node": "n:ea71c5f746934d0a934c43782d861da5", "headingDeg": 244, "expect": "The B3 concourse is visible from the foot of the first escalator." },
  { "id": "slice-09-b3-sign", "station": "shinjuku", "kind": "node", "node": "n:180ce956ffb7470b9cc42ec7e75255d4", "headingDeg": 148, "expect": "The B3 concourse and its overhead sign are visible." },
  { "id": "slice-10-escalator2-top", "station": "shinjuku", "kind": "node", "node": "n:9c7256cd531a4154abd7353ace7797be", "headingDeg": 165, "expect": "The long escalator down to the B6 platform is visible from its top." },
  { "id": "slice-11-b6-arrival", "station": "shinjuku", "kind": "node", "node": "n:aa29caed939f47449d2b76b11043109b", "headingDeg": 159, "expect": "The B6 platform is visible from the foot of the long escalator." },
  { "id": "slice-12-platform", "station": "shinjuku", "kind": "node", "node": "n:3c2d58645c62448b8e4c97f010d9ce32", "headingDeg": 75, "expect": "The Oedo platform and track are visible." }
]
```
