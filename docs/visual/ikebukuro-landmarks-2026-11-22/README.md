# Ikebukuro landmark captures

Captured 2026-11-22 JST from scene/data commit `d86fdf64`. These are work-in-progress evidence for a draft PR, not an acceptance PASS.

The desktop viewport is 1440×900; the phone viewport is 390×844. Both use the walk camera, morning lighting, pitch 0.5 rad and requested boom 2.25 m. Each default frame uses the corresponding next frame's graph node and heading. `captures.json` records camera values. The default page contains no landmark layer; CI golden comparison has not run.

## Store and source mapping

| Store | PLATEAU building | Existing source ID | Entrance/search attachment | Plain sign | Capture node |
|---|---|---|---|---|---|
| 西武池袋本店 | bldg_b42ec24e-73aa-4359-893c-3c1662d7d8b2 (north/south split) | 76 | shop-ikb-seibu-honten → g_jr_s (gate only) | 西武 / SEIBU | x38 |
| 東武百貨店 池袋店 | bldg_fb241b42-14ae-4785-bb97-134d2714d3a3 (north partition) | 76 | shop-ikb-tobudept — no connector | 東武 / TOBU | x17 |
| ルミネ池袋 | bldg_fb241b42-14ae-4785-bb97-134d2714d3a3 (south partition) | 76 | shop-ikb-lumine → g_jr_s (gate only) | ルミネ池袋 / LUMINE IKEBUKURO | x15* |
| エソラ池袋 | bldg_24c06550-4a51-4a0e-9fa0-1401ebd17b32 | 76 | shop-ikb-esola — no connector | エソラ池袋 / ESOLA IKEBUKURO | x15* |
| 池袋パルコ 本館 | bldg_b42ec24e-73aa-4359-893c-3c1662d7d8b2 (north partition) | 76 | shop-ikb-parco — no connector | パルコ / PARCO | x22 |
| P’PARCO | bldg_e4d518a9-7b83-49f1-8970-af38da31ecb8 | 76 | shop-ikb-pparco → x22 (provisional street exit) | P'パルコ / P'PARCO | x22 |
| サンシャインシティ | bldg_ac8d4b0e-6f5b-4caf-b9c8-9af3a82685ac + bldg_cdf8cbf9-0191-4792-ba8b-e63090cddedd | 77 | landmark-sunshine-city → x35 | サンシャイン60 / SUNSHINE 60 | x35 |

The Sunshine group retains both source feature meshes, including the Sunshine 60, Alpa, World Import Mart, Bunka Kaikan and Prince Hotel massing. Its search result describes east exit 35 / Sunshine 60 Street and explicitly ends at the station exit. The group is not a walkable street extension.

*Lumine and Esola use x15 as an available street pose, not their nearest exit. Exit 4 has only an unsurveyed B1 stair foot; its street top is absent from the current graph. The required nearest-exit frames remain missing.

## Frames

Each row supplies next and flag-off images at the same requested pose. Door frames from 3 m are missing because verified entrance positions/connectors are absent; no door positions were invented.

| Store | Desktop next | Phone next | Desktop default | Phone default |
|---|---|---|---|---|
| 西武池袋本店 | [desktop next](desktop-seibu-next.png) | [phone next](phone-seibu-next.png) | [desktop default](desktop-seibu-default.png) | [phone default](phone-seibu-default.png) |
| 東武百貨店 池袋店 | [desktop next](desktop-tobu-next.png) | [phone next](phone-tobu-next.png) | [desktop default](desktop-tobu-default.png) | [phone default](phone-tobu-default.png) |
| ルミネ池袋 | [desktop next](desktop-lumine-next.png) | [phone next](phone-lumine-next.png) | [desktop default](desktop-lumine-default.png) | [phone default](phone-lumine-default.png) |
| エソラ池袋 | [desktop next](desktop-esola-next.png) | [phone next](phone-esola-next.png) | [desktop default](desktop-esola-default.png) | [phone default](phone-esola-default.png) |
| 池袋パルコ 本館 | [desktop next](desktop-parco-next.png) | [phone next](phone-parco-next.png) | [desktop default](desktop-parco-default.png) | [phone default](phone-parco-default.png) |
| P’PARCO | [desktop next](desktop-pparco-next.png) | [phone next](phone-pparco-next.png) | [desktop default](desktop-pparco-default.png) | [phone default](phone-pparco-default.png) |
| サンシャインシティ | [desktop next](desktop-sunshine-next.png) | [phone next](phone-sunshine-next.png) | [desktop default](desktop-sunshine-default.png) | [phone default](phone-sunshine-default.png) |

## Observed checks and numbers

- Local browser exercised both flag states: seven preview landmark groups load without page errors; default landmark layer count is zero. Preview layer totals: 14 meshes/draws, 50,364 triangles, seven 512×128 sign atlases. Each group uses two draws (facade with procedural street band, and sign).
- Search exercised each listed name, P'PARCO, サンシャインシティ and Sunshine City. The existing department-store routing gaps are shown in the table. An actual route from exit 22 to Sunshine City succeeds and ends at exit 35 with the east / Sunshine 60 Street instruction.
- Project sign font glyph check: no missing characters, including 髙, ュ and the apostrophe. No fallback face is used.
- Ivory `#F2ECE0` against bronze `#3A3029`: computed sRGB relative-luminance contrast **10.92:1**. This is a colour calculation, not a rendered-pixel measurement.
- Letter emissive intensity 0.6; sign roughness 0.5; Japanese cap height 2 m (Sunshine 3 m); English ratio 0.45; no emissive upper floors. Values come from the shared style module.
- Rendered landmark-to-wayfinding mean-luminance ratio: **not measured** (required ≤0.85). Facade ≥20% darker than context/sky and 18 px / 14 px name visibility: **not certified**. Door names and entrance-distance views are missing. These remain acceptance gaps, not claimed passes.
- No test suite was run: brief says `Test: none`; CI root-test, golden and journey results are pending.

## Sources and rights

Source geometry is unchanged PLATEAU LOD2, using the station's existing source 76/77 inventory and TP coordinates. No new acquisition was necessary; `docs/gis/context/ikebukuro-landmarks-next.json` records the source SHA256 values, feature IDs, triangle counts and bounds. The existing source footprint is partitioned to assign store materials; it is not replaced with inferred boxes.

出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成。 Rendered frames also contain original GTEki work. See the repository PLATEAU attribution and REUSE annotations. No facade photos, map tiles, logos or wordmark artwork are used.

Current operation/access checked 2026-11-22 JST against [Sunshine access](https://sunshinecity.jp/information/access_train.html), [Sunshine floor map](https://sunshinecity.jp/information/floor_map/), [PARCO access](https://ikebukuro.parco.jp/info/?gcd=access), [Esola](https://www.metropro-sc.jp/esola-ikebukuro/), [Lumine access](https://www.lumine.ne.jp/ikebukuro/access/), [Tobu access](https://www.tobu-dept.jp/ikebukuro/access/) and [Seibu access](https://www.sogo-seibu.jp/ikebukuro/access/). These establish operation and access descriptions, not surveyed door coordinates. Google Maps place positions were consulted to identify Esola, Lumine and P'PARCO in existing geometry; source terms classification **UNKNOWN**. No imagery or map geometry was copied.

## Follow-up source evidence, 2026-11-22 JST

| Store | Official source and access statement | Current treatment |
|---|---|---|
| Seibu | [Access](https://www.sogo-seibu.jp/ikebukuro/access): 「池袋駅 東口直結」 | Door and door routing not yet placed. |
| Tobu | [Access](https://www.tobu-dept.jp/ikebukuro/access/): 「池袋駅西口 直結」 | Door and door routing not yet placed. |
| Lumine | [Access](https://www.lumine.ne.jp/ikebukuro/access/): 「JR池袋駅南改札、正面右手よりすぐ」 | Door and door routing not yet placed. |
| Esola | [Access](https://www.metropro-sc.jp/esola-ikebukuro/shop/page.jsp?id=2): 「有楽町線 南通路西改札から徒歩15秒」 | Door and door routing not yet placed. |
| PARCO main | [PARCO](https://www.parco.co.jp/parcomi/ikebukuro/media/01/): 「駅コンコース(東口・チェリーロード)に面した」 | Door and door routing not yet placed. |
| P’PARCO | [Access](https://ikebukuro.parco.jp/info/?gcd=access); [PARCO east-exit area](https://www.parco.co.jp/pdf/jp/store/storage/cname_20211026130032.pdf): 「池袋駅東口（北）方面」 | Provisional street-exit tie x22; no station-side door established. |
| Sunshine City | [Access](https://sunshinecity.jp/information/access_train.html): 「池袋駅（35番出口）から徒歩約8分」 | Route to x35; no station-side door. |

No surveyed coordinates have been supplied. Existing candidate shop openings near the south gate are approximately 13 m from the walk graph; wall-safe route geometry and compliant placement are still unresolved. The old x15 Lumine/Esola images are substitutes and do not establish the nearest modeled street-top frames. No additional door frames are claimed.

## Revised routing scope, 2026-11-22 JST

All routes below are provisional nearest modeled exits, chosen by horizontal geometric distance from each modeled street exit to the projected PLATEAU landmark geometry. They do not identify official entrances. No station-side door is established: an official connection within the model with a confident wall-safe reachable tie has not been established.

| Store | Nearest modeled exit | Frame status |
|---|---|---|
| Seibu | x38 (tied with x37 at 0 m) | Existing x38 frames |
| Tobu | x18 | x18 frames missing; existing frames use x17 |
| Lumine | x37 | x37 frames missing; existing frames use x15 |
| Esola | x15 | Existing x15 frames |
| PARCO | x22 | Existing x22 frames |
| P'PARCO | x22 | Existing x22 frames |
| Sunshine City | x35 | Existing x35 frames |

No door frames are required under the revised scope because no doors were placed. The missing x18 and x37 frames remain required. The model contains only part of the station and does not establish the official entrance connection.

### Revised nearest-exit captures, 2026-11-22 JST

The x18 and x37 poses replace the earlier x17 and x15 substitutes. Lumine's x37 camera is obstructed by the stair enclosure; the frame does not establish landmark visibility or visual acceptance. Pose and camera metadata are in `captures.json`.

| Store | Desktop next | Phone next | Desktop default | Phone default |
|---|---|---|---|---|
| Tobu, x18 | [next](desktop-tobu-next-nearest.png) | [next](phone-tobu-next-nearest.png) | [default](desktop-tobu-default-nearest.png) | [default](phone-tobu-default-nearest.png) |
| Lumine, x37 | [next](desktop-lumine-next-nearest.png) | [next](phone-lumine-next-nearest.png) | [default](desktop-lumine-default-nearest.png) | [default](phone-lumine-default-nearest.png) |

## AD capture correction, 2026-11-22 JST

The r4 attempt is rejected as visual evidence. Its 15 desktop next frames were inspected: several names are hidden by source geometry, so neither projected cap heights nor sampled pixels establish rendered lettering contrast. No replacement frame is submitted for art-direction acceptance. Earlier frame tables remain historical and do not satisfy the r4 spec.

[Draw readback and camera diagnosis](r4-diagnosis.json) records two facade callbacks and two sign callbacks for every store during its displayed composer render. This proves render submission, not visible pixels. The eye-level centre-sightline sweep samples 360 cameras per store: distances 60, 80, 100, 120 and 150 m, each at 72 azimuths. It includes the store itself among occluders, unlike the first capture recipe.

| Store | Facade / sign render callbacks | Clear sampled look cameras |
|---|---|---|
| Seibu | 2 / 2 | 0 / 360 |
| Tobu | 2 / 2 | 55 / 360 |
| Lumine | 2 / 2 | 0 / 360 |
| Esola | 2 / 2 | 0 / 360 |
| PARCO | 2 / 2 | 0 / 360 |
| P’PARCO | 2 / 2 | 32 / 360 |
| Sunshine | 2 / 2 | 107 / 360 |

At an 80 m offset along the sign normal, Seibu and PARCO hit their own facade before their signs; Lumine hits Tobu; Esola hits existing context. This sampled search does not prove that every continuous camera location is blocked. It does establish why the attempted normal-facing frames fail. The sign anchors currently originate from horizontal rays starting at station exits, which can lie inside the connected source building rather than outside its facade.

The capture recipe now counts self-occlusion and starts its own Vite server, addressing the server termination that interrupted the flag-off pass. It has not been rerun: changing four sign anchors requires the lead’s scope decision. Phone, flag-off, valid look/walk frames and rendered sign-to-wayfinding ratios remain outstanding. No graph or store data was changed in this follow-up.

## r5 capture result, 2026-11-22 JST

The lead authorized moving Seibu, Lumine, Esola and PARCO signs on existing exterior faces. Scene commit `f1154d6f` implements those four moves without changing sign construction, sizes, building geometry or graph edges. [Anchor selection evidence](r5-moves.json) records old and selected anchors; [r5 status](r5-status.json) records actual rendered anchors, attempted-frame measurements and remaining camera blockers.

The background job `depato-ikebukuro-capture-r5` exited 1 at P’PARCO: `No clear public-road look camera: pparco`. It produced 11 desktop next frames, inspected together at 1600 px. Seibu walk and the five attempted look frames show store names; the other five attempted walk frames do not. The incomplete set is rejected and its PNGs remain local, outside the submitted evidence. Phone, flag-off and Sunshine frames were not reached.

A finer P’PARCO search over 60–150 m offsets and front-facing angles from −1.55 to +1.55 rad at 0.05 rad intervals found no full-sign sightline above modeled public-road geometry. Its best road candidate has two of six sign samples blocked by `ctx_bldg_t01_01`. Four clear views at a fixed 34.1 m eye datum have no modeled ground within 10 m below them; they are not public-pavement evidence. These sampled results do not prove all continuous camera locations fail.

The walk recipe sampled only 13 centroids from station walkable triangles overlapping modeled roads. The other five attempted stores have no clear sign candidate in that limited set; Sunshine was not reached; broader public-road geometry is not established as navigable station pavement. Moving P’PARCO’s sign is outside the four-store authorization. A lead decision is needed on that relocation and on capture-only road poses beyond station walkable coverage. CI7 has not been started; no new CI result or complete AD evidence set is claimed.
