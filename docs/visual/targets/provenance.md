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

## s3-platform-arrival.jpg

- Hero: S3
- Chosen output: `po3-s3-b.png`
- Base: `m7-platform-arrival-clean.png`, main SHA `03dff211`, captured 2026-11-28 18:57 JST
- Generated: 2026-11-28 19:06:27 JST
- Retries: 1. The first attempt added glazing and seams across existing opaque door panels. The retry is the selected result.
- Rejected variant a is kept only in `s3-variants-base-a-b.jpg`.
- Codex session: `01a2219b-cc76-7782-ae23-6fb986ce427a`
- The committed file is a 1280 px downscale.
- Exact prompt of selected attempt:

```text
Retry 1 of 1. Edit the original Image 1 as a minimal geometry-registered paint-over. Do not reinterpret the rough platform doors as a continuous wall of glass. Treat solid foreground and middle leaves as one broad opaque panel each in their existing positions, with existing narrower glazed pairs between them, and do not introduce new seams across broad solid panels. On the left, at 1600x1000, the near solid panel runs from the left edge to x=315, a glazed pair spans x=325 to 465 with the original seam at x=395, a solid panel spans x=480 to 610, then a very narrow visible glazed section. On the right, keep the broad solid panel around x=1404 to 1533, its pink cap line and adjacent bays at their original coordinates. Keep the broad solid panels dark brushed stainless and show through existing glazed bays only. Keep all the original door-row tops, bases, existing posts and seams in place. Maintain the original floor seam directions, cat contour and block bottom including its original slight tilt. Preserve the exact original sign face, including the small line at the bottom, as source image pixels. If any characters would have to be redrawn, blur the sign face into an abstract block with no fake lettering, without shifting its frame.

Edit Image 1, the exact 1600 by 1000 game capture, as a registered paint-over. Image 2 is a reference for the cool B6 landing light and Image 3 is a reference for the non-mirror stone floor only. Trace Image 1's existing edges in place. Keep the exact 8:5 frame, camera, perspective, vanishing geometry, wall and centre block silhouettes, both rows of half-height platform screen doors and their existing bays and posts, ceiling grid and every troffer. Keep the centre block spanning roughly x=628–1320 from its sloped roof edge down to y=523–535, the original sign at x=879–1068 and y=183–291, and the rear-facing blue-grey cat at x=660–742 and y=606–787. Keep the entire original sign face and lettering as image pixels; leave its glyphs, marks, size and position intact, without retyping or recreating any of the text. If faithful preservation is impossible, leave only an abstract blurred sign face in that same rectangle. Keep exactly the base's perspective, tactile line, and single wall band, and reduce the existing pink door caps to thin magenta lines in the same places. Remove the cyan UI ring completely, maintaining the cat's exact pose, tail to the left, position and scale. Give the cat a soft troffer rim for readable ears and silhouette, and a small grounded contact shadow.

Paint cool bright 5500 K platform light in the clean slightly stylised real-time Three.js PBR style. The station name sign face is the brightest object. The existing troffers cast soft elongated pools and broken soft reflection hints on polished grey stone tiles, roughness 0.35, never mirror reflections. Ground the walls, doors and block at their original floor contacts; add fine enamel panel joints, a baseboard/shadow line and a dark jointed stone or enamel plinth on the centre block's existing dark base. Surface the original half-height doors with brushed stainless frames, glazed sliding leaves with faint rims, and slim headers; preserve every existing footprint, bay width and outer contour. Both platform edges run into a slightly darker cooler distance, with no fog or shafts. Place three to five distinct waiting human passengers at different existing doors and depths, restrained real-time character styling without facial detail, none covering the sign or cat. No ads, logos, brands, new readable or fake text, machines, shops, furniture, extra signs, arrows, added doors or corridors. Make a same-size, pixel-registered finish on Image 1, preserving all unedited shapes at the same coordinates.

Variant B. Behind the left-hand doors only, a stopped train with a dark undecorated body and a horizontal lit window band, seen through the door glazing and integrated behind it. On the right, only the dark tunnel void. No train livery, markings, text or extra line colour. Push the lighting with stronger elongated pools and a darker cooler distance, retaining the bright sign, soft reflections and real-time PBR style. Show the train only through the existing narrow left-side glazing; it must disappear behind each broad opaque panel.
```
