# GTEki — Product Vision (2026-10-20)

Status: Owner-approved product direction; engineering methods remain at Opus 5.5's discretion inside the shared-data and safety constraints.

## The experience

A person unfamiliar with Ikebukuro or Shinjuku should eventually be able to **search any supported destination**, see an understandable route through the complex station, and follow it by freely exploring a convincing 3D station. Browser access must be immediate and usable from a phone; a high-fidelity Godot client remains possible.

GTEki takes the **freedom, energy and immersion** of open-world games as inspiration while prioritizing real-world navigation. It is not merely a CAD visualization, route algorithm demo, or lesson in railway geography.

## Four product pillars

1. **Find:** useful name and alias search for exits, ticket gates, platforms, shops, toilets, lifts, services and POIs; an endpoint attaches to a *verified accessible entrance*, not blindly to a centroid.
2. **Trust:** evidence-backed paths, operator and paid-area boundaries, closures, hours, accessibility constraints and dated provenance; unknown must remain unknown.
3. **Feel present:** recognizable architecture, believable proportions, signs and landmarks, considered materials and lighting, readable wayfinding, audio/interaction where appropriate, comfortable motion and responsive controls. No unauthorized visual copying.
4. **Grow to completeness:** continually expand validated area/POI/route coverage per station; keep missing and stale areas explicit. Completing one showcase route is a milestone, not fulfilling the entire GTEki vision.

## Quality levels

| Level | Interpretation | Use |
| --- | --- | --- |
| L0 | Engineering blockout: topology, collision and transforms | Temporary internal validation |
| L1 | Recognizable architecture and principal wayfinding | In-progress prototype |
| L2 | Polished, coherent, commercial-game-feel slice: convincing place identity, lighting, materials, landmarks, tactile navigation and mobile usability | **Target for an accepted playable station slice** |
| L3 | High-fidelity digital twin with dense, source-validated physical/detail coverage and a stronger render path | Long-term goal, preserve Godot option |

L2 describes an **observable quality bar**, not photorealism by assumption. L3 is an aspiration, not a gate that can be met by hallucinated details. Truth, provenance and legal reuse remain non-negotiable even when a visually rich depiction would be easier.

## Execution strategy

- **Two parallel station owners:** Opus 5.5 session A (Ikebukuro) and Opus 5.5 session B (Shinjuku), independent Git worktrees, stage reports, station-specific evidence and acceptance.
- **No imposed 70/30 split or 72-hour cutoff.** Quality and cumulative station completeness determine pacing. Historical research organized around 70/30 remains untouched in its original report.
- Shared core is implemented once under a nominated shared-file maintainer; Sol xHigh is a preferred collaborator, and Astra High is a preferred specialist reviewer/adviser, subject to genuine availability.
- Each station starts from the strongest legitimate public datasets, with focused, permitted owner field-surveys only for identified data gaps.
- Opus decides the choice of modeling tools, engine details, asset strategy, level sequencing and orchestration, recording consequential changes in GitHub rather than requiring recurring Owner approvals.

## Milestones, not a deadline

A station's first accepted vertical slice must demonstrate its own **search → trustworthy route → 3D guided/free walk → visual and mobile review**, in an evidence-backed, geographically bounded area at L2 quality. The slice may be expanded in stages until these criteria pass. An art-only scene or a synthetic-but-unlabeled path is not enough.

Next milestones increase validated station coverage, accurate/updated POIs, additional accessible transitions and realistic appearance. **Both whole-station reconstructions remain ongoing goals until independently demonstrated and accepted**, not until the first preview works.

See [acceptance](acceptance.md), [station-lane plan](parallel-station-plan.md), [architecture](architecture.md), and [research evidence](research/GTEki_Public_Data_Research_2026-10-20.md).
