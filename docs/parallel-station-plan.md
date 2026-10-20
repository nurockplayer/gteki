# GTEki — Two independent Opus 5.5 station sessions

Status: **Owner adopted 2026-10-20.** Supersedes the earlier proposed 70% Ikebukuro / 30% Shinjuku **development allocation** and 72-hour deadline. Does not rewrite the historically dated 70/30 **research** dossier.

## Aim

Run **both stations independently and concurrently**, with equal ambition but progress driven by the evidence, complexity, and craft demands of each station. No forced 50/50 resource accounting, no clock-based "done" label.

## Isolated write ownership

| Lane | Decision-maker | Primary file ownership |
| --- | --- | --- |
| Ikebukuro | Opus 5.5 Session A | `stations/ikebukuro/**`, station-specific tests, art and source-gap reports |
| Shinjuku | Opus 5.5 Session B | `stations/shinjuku/**`, station-specific tests, art and source-gap reports |
| Shared core | One nominated maintainer, preferably with GPT-6.1 Sol xHigh as collaborator | `packages/**`, `apps/web/**`, shared search/navigation/coordinate and scene contracts |

Both Opus sessions hold station-scoped engineering authority; they agree changes to interfaces through brief, reviewed PRs. **There is one owner for each shared file at any point**, not two independent, competing routing engines. Sol xHigh and Astra High are preferred resources, not unverified guaranteed invocations or mandatory committee vetoes. Astra High may be consulted for architecture, rights, performance and independent quality critique.

Each station uses a separate Claude Code Session, Git worktree and feature branch. A third isolated worktree may be used for shared core. Integration reads merged `main`; do not overwrite another lane or treat an unmerged proposal as production truth.

Example local setup (only if branch names are free and worktree path does not exist):

```bash
git fetch origin
git worktree add -b feat/ikebukuro-m0 ../gteki-ikebukuro origin/main
git worktree add -b feat/shinjuku-m0 ../gteki-shinjuku origin/main
git worktree add -b feat/shared-core-m0 ../gteki-core origin/main
```

## Product quality and station coverage

- Target **L2** for accepted, bounded, evidence-backed and playable scenes: recognizable station identity and proportions; high-quality lighting, materials and wayfinding; responsive 3D walking, search and route feedback, with genuine desktop/phone visual and interaction checks.
- **L0/L1 are implementation stages, not finish lines.** L3 is the long-term high-fidelity digital-twin goal, including the optional Godot path.
- Grow validated station graph and searchable POI/level/exit coverage over successive deliverables. Never pronounce the whole station complete based on one polished corridor.
- Prioritize end-to-end **playability + navigation validity + visual quality + coverage honesty**, rather than maximizing mesh area or minimizing elapsed hours.

## Absolute boundaries

- Browser-first access and renderer-neutral source/routing/POI and coordinate contracts; keep eventual Godot conversion feasible.
- No AI-invented public passage, floor height, vertical connector, accessibility, hours or paid-area shortcut may become a production route. Unknown remains unknown/unroutable.
- License and redistribution gates apply to the **public** GitHub and Web bundle, including models, textures, signs, source map graphics and generated derivatives. Do not copy protected GTA/game brand assets.
- Only pnpm and Homebrew; no npm/npx/yarn. Do not alter other game repositories.
- Stage reports and proof of actual play/visual review in GitHub; independent review before publishing navigation claims; Owner approval for merges/releases as already governed.

## Coordination without over-management

1. Resolve only the smallest shared data/coordinate interface needed for two stations to proceed. Station work can start with rights-cleared scaffolding and clearly non-navigational prototypes while genuine topology is being verified.
2. Each Opus chooses the most promising vertical slice and delegates independently, escalating genuine shared-file conflicts through the nominated integrator.
3. Deliver small PRs and evidence-rich station handoffs. Re-read merged `main` before each new stage.
4. Stop only for material legal/safety/Owner approval gates or exhausted viable paths; otherwise iterate toward accepted quality and broader station completeness.

Related acceptance contract: [acceptance.md](acceptance.md). Historical research evidence: [2026-10-20 dossier](research/GTEki_Public_Data_Research_2026-10-20.md).
