# Shinjuku fast-tap crowd comparison (#1454)

Captured 2026-11-24 JST for J4/J5. Each row pairs the same frame on main `bf0bd522` (left) and the fix `030229c2` (right). The blue-coated commuter is ahead of the cat at the foot of the next flight. The 43 rows cover every frame from 3.500 through 4.200 seconds after tapping **Walk to the platform**.

| Time after tap | Frames |
| --- | --- |
| 3.500–3.617 s | [210–217](frames-210-217.jpg) |
| 3.633–3.750 s | [218–225](frames-218-225.jpg) |
| **3.767–3.883 s** | [**226–233, first frame of the disappearance**](frames-226-233.jpg) |
| 3.900–4.017 s | [234–241](frames-234-241.jpg) |
| 4.033–4.150 s | [242–249](frames-242-249.jpg) |
| 4.167–4.200 s | [250–252](frames-250-252.jpg) |

Ego Lite desktop viewport at 960×600, DPR 1, default Shinjuku mode, morning crowd. The QA replay starts commuter 48 on the recorded opening-stair path on both revisions, holds at poster lift, steps 1.4 seconds, taps the button, then renders each 1/60-second step. The camera, guide, walking and visibility run through the app. The commuter's sampled position and focus-line distance match across both captures.

At frame 230 the commuter is 4.67 m ahead and 45.4 cm from the camera-to-focus line. At frame 231 the distance to the line falls to 44.6 cm. Main zeros every body-part matrix on that update. The branch still draws the commuter with 92% dither coverage on frame 231, 83% at frame 232 and 50% at frame 236. The original camera path at `cd54eb29` triggers the same hide at frame 232 (3.867 s). A second replay of that revision recorded commuter 2 crossing the focus line for one update at frame 2 (0.033 s).

Credits: GTEki contributors. Shinjuku geometry derived from 国土交通省（ほこナビDP）. The E27 terms marker applies alongside the GTEki rendering license. Cat by guillaume bolis, modified by GTEki contributors (CC BY 4.0).
