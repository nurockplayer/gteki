# Hero target frame provenance

AI-assisted paint-overs (batch 2) made with the OpenAI built-in image_gen tool via Codex (`cx-exec`, session `01a1cc4d-d13d-7b23-aa03-872b8708dc00`). The tool does not expose a model identifier. Brief: `.claude/director/briefs/visual-hero-paintover-2.md`.

Each base is a GPU capture of the game, made 2026-11-12 05:19 JST on an Apple M2 Pro with ANGLE Metal. It shows PR #1184 at `a72cc24d`: light preset B, high tier, UI and route markers hidden, 1600×1000.

The worker's own provenance file lost the prompts, recording them as `undefined`. The prompts below were recovered verbatim from the Codex session log by gteki-visual on 2026-11-12 JST.

The committed files are 1280 px JPEG (quality 80) downscales of the 1586×992 PNG outputs. `variants-base-a-b.jpg` shows every frame as base | variant a | variant b, and the rejected variants are kept only there.

## h1-exit1-mouth.jpg

- Hero: H1, slice-01
- Chosen output: `po2-h1-b.png`
- Base: `h1-exit1-mouth.png`: route d = 0 m, the walker nearest `n:a06f3d19…`
- Generated: 2026-11-12 05:37:40 JST
- Retries: 1 (the first output added a magenta façade stripe)
- Exact prompt:

> RETRY 1 of 1. Faithfully edit this exact base only; no redraw. Lock camera, framing, perspective and exact geometry/positions/rhythm of walls, windows, openings, pillars, beams, canopy, rails, lights and paving. Keep cat exactly in place. Critical: base contains no magenta band; introduce no magenta pixels/design anywhere. No signage or text. Warmer overcast street daylight spills toward cooler brighter stairs. Slim brushed stainless rails and glass canopy; clean stylized PBR enamel and polished stone, roughness .35, soft fixture pools. One or two distinct pedestrians at different depths, featureless faces. No invented architecture, signs, ads, logos, machines, shops, arrows, doors/corridors or god rays.

## h2-b1-corridor.jpg

- Hero: H2, slice-04
- Chosen output: `po2-h2-b.png`
- Base: `h2-b1-corridor.png`: route d = 40.12 m, the walker nearest `n:1ecbdf77…`
- Generated: 2026-11-12 05:33:27 JST
- Retries: 0
- Exact prompt:

> Faithful edit of this exact base, variant b with stronger troffer pools. Lock camera, perspective, framing and every architectural edge/position/rhythm; preserve exact sign locations/sizes, light fixture directions, tactile paving only where shown, cat if shown, and existing magenta band only. Polished non-mirror stone floor roughness ~.35 catches soft elongated light pools along concourse. Overhead sign faces are the brightest objects and remain abstract blurred blocks. Enamel jointed panels, baseboard/shadow line, brushed stainless, faint glass rims, soft rubber rail. Three to five varied non-cloned walkers at varied stride/depth, faceless. No new signs or magenta, ads, brand, fake/readable text, machines, shops, arrows, added doors/corridors or god rays. Clean stylized Three.js PBR.

## h3-escalator-run.jpg

- Hero: H3, slice-10
- Chosen output: `po2-h3-a.png`
- Base: `h3-escalator-run.png`: the D6 mid pose (route d = 170 m) on the long escalator
- Generated: 2026-11-12 05:33:51 JST
- Retries: 0
- Exact prompt:

> Edit this exact base faithfully, variant a close to base. Keep camera, framing, perspective and every wall/opening/pillar/beam/sign/fixture in exact position and rhythm; retain exact tactile paving and only existing magenta band, preserve cat if present. Escalator has dark ribbed aluminium steps and yellow edges; black rubber handrails soft highlight, brushed stainless skirts with streak along run, nearly clear glass faint rim, readable jointed enamel panels/baseboard/shadow. Warm ~4000K shaft gradually dims at mid-run, far landing distinctly brighter cool ~5500K pool pulling the eye. Keep right lower wall dim but visible with readable panel joints, never black. Three to five distinct standing riders on adjacent escalator, no facial details. Soft floor/fixture light, no mirror, signs brightest and abstract. No added objects, signage, text, ads, god rays; stylized PBR.

## h4-b6-landing.jpg

- Hero: H4, slice-11
- Chosen output: `po2-h4-b.png`
- Base: `h4-landing.png`: the D6 dismount pose (route d = 195 m) above the B6 landing
- Generated: 2026-11-12 05:35:49 JST
- Retries: 0
- Exact prompt:

> Faithful edit of exact base, variant b with stronger lighting contrast. Lock camera, framing, perspective and all scene geometry, fixture and sign locations, tactile paving exact location, existing single magenta band only; keep existing landing figure and make it a clean faceless silhouette. Bright cool landing pool against warmer escalator foreground; far platform end visibly opens into empty space. Repaint only: dark ribbed aluminum steps yellow edges, brushed stainless skirt, black rubber soft highlight, clear faint-rim balustrade, enamel wall joints/baseboard/shadow line, polished nonmirror stone. Signs abstract and brightest. No invented train, ads, furniture, signage, logos, text, doors, corridors, god rays; no added magenta. Clean slightly stylized Three.js PBR.

