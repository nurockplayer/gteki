# Procedural commuter artwork

All geometry, palettes, tailoring and the eight-pixel roughness atlas are original
procedural artwork. No third-party models, photos, fonts, textures, operator art,
brands or uniforms are used. No dependency was added. These are invented people
and outfits, not observations or demographic evidence about E27 passengers.
The existing simulated-crowd disclosure and graph data are preserved.

`mesh.ts` builds an indexed surface with smooth normals, vertex colours and
blended joints. The 23.6 cm head gives roughly 7.5-head adult proportions; height
and hairstyle volume vary between eight outfits. Hair includes a swept side
part, close crop, layered cut, bob, grey receding temples, textured crop,
shoulder-length fringe and a rear bun. Faces use small eyes/brows, a shaped jaw,
nose, ears and restrained skin tones. Hands have closed finger blocks and thumbs;
shoes have separate soles and rounded squared toes. Knit necks are raised loops;
suit shirts use collars, lapels and ties. Outfit 0 remains the blue field jacket,
trousers, sneakers and 26 × 36 cm backpack used by the player.

The 14-bone rig includes a shared garment bone so skirt/coat hems stay continuous.
Covered anatomy is fitted inside the garment. The hem sways and expands slightly
while walking; skirts use a shorter distance-driven stride. This is tailored
skinning, not cloth physics. Bags and hair are rigid attachments. Fingers and
faces have no expression/individual-finger animation. These are deliberate
visual simplifications, as are all clothing and passenger variety.

One shared opaque material uses vertex colour plus an original 8 × 1 linear-data
roughness atlas: matte fabric, softer skin, subdued hair sheen and semi-gloss
shoes. Geometry, material and atlas are reference-counted; the last avatar frees
them. Each skeleton releases its own bone texture. Near geometry is 2,734–3,272
triangles; far geometry is 1,062–1,272. There are no material groups.

`batch.ts` combines the crowd into one skinned draw per render pass, retaining
independent bones for each avatar. It rebases skin indices, merges geometry only
when the pool/outfit/LOD changes, and filters whole character index ranges by
visibility and camera frustum. The batch owns its merged buffers and skeleton,
not the shared source material. The optional borrowed player rig shares this draw; its lifetime and animation
remain owned by the caller. Two small main.ts wiring changes attach the player
and prepare the camera visibility before the render queue is built.
Whole-frame harness counters include station geometry and postprocessing.

`gait.ts` drives phase by travelled distance. Two-bone IK compensates pelvis
rotation and keeps stance feet planted, with smooth walk/run blends, heel/toe
roll, counter-rotating shoulders and idle breathing. Uphill/downhill hints change
knee lift and lean; individual tread contacts are not measured. LOD switches at
27/23 m around the 25 m target, and rig animation stops beyond 60 m while routing
continues. Public avatar and crowd creation/update signatures are unchanged.

For pools of at least six, up to six agents may start at interior positions on
existing directed POI routes, 7.2–25 m from the player and near their level. They
have two short invented waiting intervals on walk segments and recycle beyond
40 m. Other agents retain connector-origin spawning. This is staged ambient
presence, not crowd or timetable evidence. Edge direction, width, stairs,
escalators and elevator timing remain governed by the existing route simulation.
The count parameter and 80-agent cap remain in force.

Tests cover posed geometry, normalized weights, hem continuity, foot planting,
climbing sign, LOD/freezing, roughness and resource disposal. Batch tests compare
world-space posed vertices with the separate rigs and check frustum filtering,
empty pools and rebuilding. Crowd tests retain routing coverage and check local
presence at the actual B1 gate and B6 platform vantages.

QA artifacts are local under `.qa/`. Round 2 uses the lead's screenshot service
and the normal `shoot` harness at 1280 × 720, high quality, `crowd=24`. The before
report is `.qa/round2-before/report.json`; the final report and station PNGs are
in `.qa/shots/`. Ego-lite renders the original outfit/portrait galleries. The
close front/back free cameras rely on the preceding platform setup vantage.
NPC positions can vary with live browser frame timing; render counters are not
FPS or device performance claims. Scene screenshots retain the existing HUD.
