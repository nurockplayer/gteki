# Shinjuku department stores — 2026-11-22 JST

Status (2026-11-22 JST): R9 corrects all four named contrast failures; PR #1511 stays draft. CI and lead visual acceptance remain pending.

[R9: eight replacement next/off frames and measurements](r9/README.md). The four recaptured next frames have contrast 6.83–7.01:1; measured facade/sky values are 0.590/0.683, with no sky visible in the other two. [R8: all 88 original images and measurements](r8/README.md) remains historical evidence; its four contrast failures are superseded by R9. The R6/R7 notes below describe historical runs.

`r6/` preserves the eleven desktop diagnostic frames and per-store draw proof. Every source building submitted its facade, street and sign mesh once. Eight names are occluded or outside the image, so those images cannot yield a target-letter contrast. The three visible names have a core-ink contrast proxy in the manifest: sign-quad rendered luminance P99/P10, with the WCAG 0.05 offset. This proxy is distinguished from r7's glyph-mask mean.

`r7/` contains six corrected desktop next frames captured at code candidate `04b4c62a`: Isetan Main, Isetan Men and Odakyu, walk and look. Both the facade and store name are visible in these six images. A previous partial run changed a shared texture source while making diagnostic masks; its images were replaced, and its measurements are invalid.

R7 measurements read the displayed framebuffer before making a separate red/blue glyph/band identification render. The mask texture owns its pixel source. Luminance uses linearized display RGB, and letter contrast is `(mean letter Y + 0.05) / (mean band Y + 0.05)`. Cap height is the visible Japanese glyph-mask pixel extent at device scale 1. The sign/reference ratio compares the visible sign mean with an isolated rendered Exit 1 sign at the same distance and lighting; no wayfinding sign is present in these main frames. Facade/sky compares the visible target facade and visible sky means. Camera coordinates use renderer x/y/z, with y up; all cameras are 1.6 m high. The pavement check uses the rendered ground and building footprints and does not establish a navigation connection.

The capture stopped at Keio: the same walk-pavement-pose search failed twice, first with the original sign selection and then with its west-wall selection. That path is stopped under the supplied instructions. No phone or flag-off r7 frames exist, and eight stores have no r7 frames. A concrete Keio sign/pavement pose is needed before continuing captures. Isetan Main's look facade/sky ratio (0.861) and Odakyu's (1.033) also fail the director's maximum 0.8; Isetan Men's is 0.493. Shinjuku's landmark materials already use `fog: false`; global station fog and exposure were not changed.

The evidence diff exceeds 300 lines when manifests are expanded because per-frame telemetry, draw proofs and PNGs are part of the requested handoff. No test suite was run: the brief specifies CI as the check.
