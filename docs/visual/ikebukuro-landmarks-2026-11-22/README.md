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
