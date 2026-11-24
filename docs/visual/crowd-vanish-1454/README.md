# Shinjuku fast-tap crowd comparison (#1454)

Captured 2026-11-24 JST for J4/J5. Each lossless WebP pairs the same frame on main `bf0bd522` (left) and the fix `b4eb43cc` (right). Open the original image to see each complete, unscaled 960×600 desktop frame. The phone viewport is 412×839 at DPR 2, yielding 824×1678 pixels per side.

| Replay after tapping **Walk to the platform** | Pairs | Result |
| --- | --- | --- |
| [Desktop fast tap](desktop/) | Every frame 210–258 (3.500–4.300 s), then every sixth frame 264–480 (4.400–8.000 s) | Main first hides commuter 48 at [frame 231](desktop/231.webp) (3.850 s) and draws him again after frame 256. The fix draws him at full opacity on every update from frame 210 through 480. |
| [Early desktop tap](early/) | Frames 0–6 | Main hides commuter 2 on [frame 2](early/002.webp) (0.033 s). The fix draws him throughout the opening return fade. |
| [Phone viewport](phone/) | Frames 230, 231, 232, 258 and 480 | One load per revision. No matching disappearance on either load. |
| [Desktop `?next=1`](next/) | Frames 230, 231, 232, 258 and 480 | One load per revision. No matching disappearance on either load. |

The Ego Lite fast-tap replay places commuter 48 on the recorded opening-stair path and taps after 1.4 seconds. The early replay uses the earlier camera path on both revisions, places commuter 2 and taps after 0.6 seconds. Both commuters are farther from the camera than the cat during their respective crossings. The phone and `?next=1` runs use the regular crowd placement.

The tracked commuter's body never intersected the cat's world bounds from 3.500 to 8.000 s on either revision. See the [capture summary](summary.json) for the visibility and overlap measurements.

Credits: GTEki contributors. Shinjuku geometry derived from 国土交通省（ほこナビDP）. The E27 terms marker applies alongside the GTEki rendering license. Cat by guillaume bolis, modified by GTEki contributors (CC BY 4.0).
