# GTEki — Product Vision (2026-10-20)

Status: Owner-approved direction; individual technical choices are working defaults pending prototype evidence.

## The problem

A traveler should be able to search for a desired place within a large Japanese rail station and understand how to get there. Conventional diagrams are hard to align with a person's current surroundings. GTEki combines a searchable indoor routing experience with game-like 3D exploration.

## Experience pillars

1. **Find**: Enter an exit, shop, platform, gate, lift, accessible route or nearby destination; support Japanese and common aliases over time.
2. **Trust**: Distinguish verified walkable edges, uncertain edges, temporarily closed paths, paid/unpaid gate boundaries and accessibility constraints.
3. **Explore**: Browser-first, free walk, with a guided path and a fast non-game route-view option.
4. **Expand**: Each station is a dataset, not a fork of application code; preserve a high-fidelity Godot option.

## M0 boundary

- Station slice: Ikebukuro East Exit to West Exit, exact entrances and graph edges chosen from verified evidence.
- Concurrent station: Shinjuku dataset audit + isolated partial 3D proof, not full-scale replication.
- Don't rely on underground GPS accuracy. M0 allows a user-selected starting position.
- No claim of live accuracy, full accessibility, or real-time construction updates without evidence.

## Team and authority

Opus 5.5: engineering director; Codex: implementation; ChatGPT: public-source research; Owner: final product approval, on-site evidence gathering as needed. Decisions recorded in GitHub.

## Staged outcome

M0: verifiable web vertical slice. M1+: increase station coverage, source precision, search reliability, accessibility, freshness, and mobile quality. Longer-term: multiple stations and optional Godot premium visuals.

See [architecture](architecture.md), [source register](research/source-register.md), [acceptance](acceptance.md).
