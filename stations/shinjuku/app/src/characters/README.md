# Procedural commuter artwork

Original generated geometry only: no models, photographs, textures, fonts,
operator graphics or other third-party artwork. No new dependency is used.
These are invented people and outfits, not observations of E27 passengers.
The existing crowd disclosure and graph routing remain in place.

`mesh.ts` makes one indexed, vertex-coloured surface per outfit/LOD. Its torso,
sleeves and trousers are lofts, with blended elbows and knees; lower coat/skirt
vertices follow the hips. Face details, four hair silhouettes and small bags
share the same draw. The reference height is about 1.77 m (roughly 7.6 heads),
with eight height/palette/outfit combinations. Outfit 0 is the player: blue
field jacket, trousers, sneakers and a 26 × 36 cm backpack. The others mix
suits, coats, knitwear, skirts, trousers, totes and shoulder bags; one has
original thin glasses and one a plain mask. There are no brands or uniforms.

The avatar owns a 13-bone skeleton. Outfit/LOD geometry and the single opaque
material are reference-counted across live avatars, and the final owner disposes
them; each skeleton releases its own GPU bone texture. Near geometry is
2,571–2,944 triangles; far geometry is 1,115–1,344. There is one main-pass draw
per person, with no multi-material groups. Whole-frame counters also include
station geometry, lighting/shadow passes and postprocessing.

`gait.ts` samples a distance-driven stance/swing cycle. In stance, the foot moves
backward at travel speed; two-bone IK compensates pelvis rotation and keeps the
sole level. Stride accounts for each outfit's height scale. Walk/run blending,
heel/toe roll, knee clearance, shoulder counter-rotation and idle breathing are
procedural. `climbing` controls the extra uphill lift and torso lean. The public
`createAvatar` and `update(dt, speed, { onStairs, climbing })` calls are preserved;
`setDistance(m)` adds a crowd-only hint, with 27/23 m LOD hysteresis and rig
animation disabled beyond 60 m. Crowd route simulation continues at all distances.

Deliberate simplifications: all anatomy, clothes, faces and passenger variety
are invented. One rough material approximates skin, hair, cloth and shoes using
vertex colours. Hands are relaxed mitten-like forms with thumbs, without finger
animation. Hair, packs and garments have no physics simulation. Skirts/coats
use skin weights and a matching underskirt lining rather than cloth simulation. Stair poses follow the player
root and the signed climbing hint, without measuring individual tread contacts.
Far characters retain a frozen rig beyond 60 m while their existing routes
continue. None of this is station or demographic evidence.

Validation includes actual skinned bounds, normalized joint weights, sole
clearance during gait blends, world-space foot planting at 1.45 m/s for two
height scales, stance timing at walking/running speeds, climbing sign, LOD
hysteresis/freezing, sharing/disposal and unchanged crowd routing tests.

QA evidence is local to this worktree under `.qa/`. The required `shoot` command
was attempted; Chrome aborted during launch under the filesystem sandbox.
Ego-lite was used to invoke the same `__gteki` QA hooks and export the actual
WebGL canvas as PNG. `.qa/baseline-1280/report.json` and `.qa/shots/report.json`
record before/after whole-frame counters at 1280×720, DPR 1, high quality,
`crowd=24`. Canvas exports omit the HUD. NPC positions can vary with live frame
timing; these measurements are not deterministic FPS/device performance claims.
The original twelve vantages are retained, followed by a platform setup and
two close views (front and back). Those free views rely on the preceding setup.
