# Fixed blocker frames

2026-11-23 JST. Runtime `4734f913ce52aca9870347ae0195797a18f15e60`. Capture timestamps in [receipt.json](receipt.json) use UTC (`Z`). The final commits add evidence only. These 26 frames repeat the rejected candidate's 22 poses and add B1 looking back from the far end and 1F looking down the well on both profiles. Desktop 1440×900, phone 390×844, DPR 1.

Both original 12-leg collision walks, both supplementary B1 walks, both search queries and the JR South Gate → store routes pass. All 26 frames have zero shader errors. All four blockers are absent in the captured views: shells remain visible through the well; temporary figures are omitted; ceilings face down for the normal/depth pass; shell walls remain lit beyond the station fog range. Lazy-loaded station nosings are cut after attachment.

Pure-black percentages below count RGB exactly `(0,0,0)` over the entire PNG, including UI, using Pillow. The receipt also records the broader `max(R,G,B) <= 8` count. This is a reproducible black-pixel proxy, not an automatic void classifier. Visual void assessment is **0% in every new frame**. Residual black pixels at the entrance/context are edges of existing station fixtures/signs; the matching flag-off frame also contains black pixels. Each state below applies separately to both linked desktop and phone frames.

| Frame | Desktop pure black, before → after | Phone pure black, before → after | State for blockers 1–4 (both profiles) |
| --- | ---: | ---: | --- |
| entrance-before | [1.329% → 0.036%](desktop-entrance-before.png) | [0.000% → 0.000%](phone-entrance-before.png) | Closed wall above doorway; lit B1 end; no figures or ghost lines. |
| entrance-context | [0.009% → 0.007%](desktop-entrance-context.png) | [0.000% → 0.000%](phone-entrance-context.png) | Closed wall behind wayfinding; no figures or ghost lines. |
| entrance-inside | [0.327% → 0.000%](desktop-entrance-inside.png) | [0.101% → 0.000%](phone-entrance-inside.png) | No black/orange nosings; lit B1 end; no figures or ghost lines. |
| food-hall-aisle | [0.000% → 0.000%](desktop-food-hall-aisle.png) | [0.000% → 0.000%](phone-food-hall-aisle.png) | Lit B1 aisle end; no figures or ghost lines. |
| counter | [0.000% → 0.000%](desktop-counter.png) | [0.000% → 0.000%](phone-counter.png) | No void, figures or ghost lines; close view, aisle end out of view. |
| escalator-boarding | [0.590% → 0.000%](desktop-escalator-boarding.png) | [0.000% → 0.000%](phone-escalator-boarding.png) | Enclosed, lit well; no figures or ghost lines. |
| arrival-1F | [1.865% → 0.000%](desktop-arrival-1F.png) | [0.000% → 0.000%](phone-arrival-1F.png) | Continuous landing view and lit far wall; no figures or ceiling outlines. |
| wide-1F | [0.000% → 0.000%](desktop-wide-1F.png) | [0.000% → 0.000%](phone-wide-1F.png) | Lit aisle end; no figures or ceiling outlines. |
| street-door-inside | [0.000% → 0.000%](desktop-street-door-inside.png) | [0.000% → 0.000%](phone-street-door-inside.png) | No void, figures or ghost lines; pale street panel unchanged. |
| street-door-outside | [0.000% → 0.000%](desktop-street-door-outside.png) | [0.000% → 0.000%](phone-street-door-outside.png) | No void, figures or ghost lines; exterior look unchanged. |
| far-end-B1 | [new view → 0.000%](desktop-far-end-B1.png) | [new view → 0.000%](phone-far-end-B1.png) | Looking back along B1 to a lit end wall; no figures or ghost lines. |
| well-from-1F | [new view → 0.000%](desktop-well-from-1F.png) | [new view → 0.000%](phone-well-from-1F.png) | Looking down into enclosed, lit well; no figures or ghost lines. |
| flag-off | [0.035% → 0.035%](desktop-flag-off.png) | [0.000% → 0.000%](phone-flag-off.png) | Base station at matching entrance pose; interior corrections not applicable. |

## Replay for the art director

From the repository root, serve the fixed head with dependencies installed:

```sh
nice -n 15 pnpm --dir apps/web exec vite --host 127.0.0.1 --port 5286 --strictPort
```

In another terminal run the committed [walk.mjs](../walk.mjs) through Ego-lite:

```sh
nice -n 15 ego-browser nodejs < docs/visual/evidence/2026-11-23-depato-interior/walk.mjs
```

Output: `/tmp/gteki-depato-walk/acceptance.json` and `frames/`. The twelve original legs are retained in `profiles[].legs`; the extra B1 walk is in `additionalLegs`. The added well view starts at the 1F upper landing. The driver uses the collision walker and existing walk camera. Its capture controls are camera yaw/pitch, viewport size, UI collapse and deterministic frame stepping; it does not change scene objects, lights, fog or postprocessing. This replay is for the AD's foreground GPU measurement; no new FPS certification is claimed. Stop the Vite process after the run.

2026-11-23 12:11 JST: `rtk gh pr checks 1510 --watch --interval 30` on runtime head completed through `job-run`: **16 passed, 0 failed**, exit 0. No local test suites run.

The four appearance items excluded by the brief remain for the art director: flat beige light, blank ceiling, grey escalator and street presentation. Keep the PR draft pending AD/Owner acceptance.

Credits and composite screenshot licensing: same as [the original receipt](../README.md).
