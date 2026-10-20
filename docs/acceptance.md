# GTEki M0 — 72-hour Acceptance Contract

Status: kickoff target, **not completed**.

## 72-hour split

- Ikebukuro (70%): browser route-search and walkable scene for one evidence-supported East→West connection.
- Shinjuku (30%): source/rights/coverage audit, station folder and independently viewable small-area geometry/import feasibility. Do not block Ikebukuro on Shinjuku art scope.

## Pass criteria

- [ ] Publicly reachable Web demo runs in current desktop and mobile browser, with keyboard and touch controls; report device/browser tested and limitations.
- [ ] User chooses a known start location and searches for West Exit, receiving a routed path through verified graph nodes and edges.
- [ ] Demonstrate a continuous walk through the scene on that same path without wall/floor clipping and without undocumented gate crossings.
- [ ] Stairs/elevators/gates/floor changes modelled as explicit typed graph edges; unknown/closed/restricted routes excluded.
- [ ] Clear UI labels separate verified, approximate and missing data; demo disclaims readiness for safety-critical, accessibility or real-time use.
- [ ] Search/routing tests run without Three.js/Godot; tests cover start=goal, no route, opposite directions, paid boundary, closed edge and invalid floor linkage.
- [ ] Source register records actual file URLs, data dates, licensing and coverage for material imported to the demo.
- [ ] Shinjuku independently produces a rights/coverage report and a bounded import/geometry evidence package (or precisely documented infeasibility).
- [ ] Small Godot compatibility spike imports agreed GLB plus shared station-coordinate metadata; attach proof or blocking evidence.
- [ ] Repo contains build/test commands, screenshots or recording, test results, commit identifiers and final handoff.

## Gates

**G0 Evidence**: have a documented, verified pilot path OR mark any speculative segments as toy fixtures and label demo as non-navigational.

**G1 Geometry**: units, axis, floors, 2D alignment and collision pass.

**G2 Navigation**: algorithmic route obeys verified topology; manual review proves its visual instructions.

**G3 Delivery**: browser and phone exercise, legal/provenance review, independent read-only code review where practical, and Owner approval before calling it real-user ready.

A failed gate is a FAIL or GAP, not a green test. 72 hours are a timebox, not a guarantee that unavailable public station data can be recreated accurately.
