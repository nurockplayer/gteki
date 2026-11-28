# Acceptance measurements

2026-11-24 JST. Runtime `c34777040638485178dc9adc0379084989876a4c`. Full sample coordinates and projected sign polygons are in `receipt.json.acceptanceMeasurements`.

| Profile | Door / concourse Y (≥1.1×) | Clipped channel samples, door / concourse | Store / wayfinding Y (≤0.85×) | Rendered handrail Y (≥0.02) | Result |
| --- | --- | --- | --- | --- | --- |
| desktop | 0.442046 / 0.197139 = **2.242×** | 0 / 0 | 0.066436 / 0.131036 = **0.507×** | **0.031103** | PASS |
| phone | 0.488705 / 0.321322 = **1.521×** | 0 / 0 | 0.059094 / 0.102036 = **0.579×** | **0.022965** | PASS |

The upper-floor probe uses the authored 1F aisle → bypass edge with the approximate amber guide material named in AD comment 7106005972. Each pose records all 33 sampled guide points, projected pixels, slab ray hits and material depth testing in its `slabProbe`; matching `*-upper-guide.png` frames show the rendered result. The original route-free 26 poses are retained. A route visible through the open well is permitted; leakage through the slab is not.

| Pose | Slab hides upper ribbon | Leaks | In-frame occluded samples | Context |
| --- | --- | --- | --- | --- |
| desktop entrance-before | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| desktop entrance-context | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| desktop entrance-inside | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| desktop food-hall-aisle | yes | 0 | 0 | upper aisle guide depth-tested against slab |
| desktop counter | yes | 0 | 0 | upper aisle guide depth-tested against slab |
| desktop escalator-boarding | yes | 0 | 25 | upper aisle guide depth-tested against slab |
| desktop arrival-1F | yes | 0 | 0 | upper floor not above camera |
| desktop wide-1F | yes | 0 | 0 | upper floor not above camera |
| desktop street-door-inside | yes | 0 | 0 | upper floor not above camera |
| desktop street-door-outside | yes | 0 | 0 | upper floor not above camera |
| desktop far-end-B1 | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| desktop well-from-1F | yes | 0 | 0 | upper floor not above camera |
| desktop flag-off | yes | 0 | 0 | upper floor not above camera |
| phone entrance-before | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| phone entrance-context | yes | 0 | 0 | upper aisle guide depth-tested against slab |
| phone entrance-inside | yes | 0 | 28 | upper aisle guide depth-tested against slab |
| phone food-hall-aisle | yes | 0 | 0 | upper aisle guide depth-tested against slab |
| phone counter | yes | 0 | 0 | upper aisle guide depth-tested against slab |
| phone escalator-boarding | yes | 0 | 15 | upper aisle guide depth-tested against slab |
| phone arrival-1F | yes | 0 | 0 | upper floor not above camera |
| phone wide-1F | yes | 0 | 0 | upper floor not above camera |
| phone street-door-inside | yes | 0 | 0 | upper floor not above camera |
| phone street-door-outside | yes | 0 | 0 | upper floor not above camera |
| phone far-end-B1 | yes | 0 | 33 | upper aisle guide depth-tested against slab |
| phone well-from-1F | yes | 0 | 0 | upper floor not above camera |
| phone flag-off | yes | 0 | 0 | upper floor not above camera |
