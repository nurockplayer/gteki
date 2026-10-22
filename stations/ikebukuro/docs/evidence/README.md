# Ikebukuro QA evidence images

出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成

Contains PLATEAU data (MLIT), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), modified by GTEki (reprojected to a local ENU frame, triangulated and re-encoded; see `station.json` source `plateau-ubld-13116`).

## What these are

The images and videos in this folder are renders of GTEki's processed PLATEAU geometry, captured from GTEki builds as QA evidence. They are not photographs and not maps.

Everything in the 3D views is either the PLATEAU-derived station geometry or content GTEki generates itself:

- the PLATEAU-derived floor, walls, pillars, stairs and ceiling (plain grey surfaces, no photographic textures);
- GTEki's own overhead wayfinding signs (`scene/signage.json`, built from the verified graph and POIs by `pipeline/build_signage.py`);
- generated ceiling light fixtures (GTEki art direction, not surveyed) and placeholder shopfront glow panels;
- the capsule-figure walker and ambient crowd.

`explorer-route-jrc2-exit35.jpg` is a screenshot of the GTEki explorer UI over the same geometry. `33-a3-exit35-top-first-person.jpg` is a before/after comparison with GTEki's own labels.

## Review of the images

Checked by eye, 12 of the 34 JPEGs (`02`, `06`, `11`, `13`, `16`, `19`, `22`, `25`, `28`, `33`, `explorer-route-jrc2-exit35`, `m01-central-passage-mobile`) and one frame from each of the two MP4s:

- No real photographs.
- No operator maps (Toshima, Tokyo Metro, JR or other) and no operator logos or pictograms.
- No operator signage is reproduced. The signs in the frames are the GTEki-generated ones listed above: a dark panel with an arrow, 出口 / Exit, and yellow rounded exit-number chips, or a "JR 南改札"-style label. Their text comes from GTEki's verified graph (facts only).

Follow-up, 2026-10-22 (checked by a Claude subagent; model and effort not recorded; not an independent review; main `dc59b38`): the other 22 JPEGs (`01`, `03`, `04`, `05`, `07`-`10`, `12`, `15`, `17`, `18`, `20`, `21`, `23`, `24`, `26`, `27`, `29`-`32`) were opened one by one as well, so all 34 JPEGs have now been checked by eye with the same result: no real photographs, no operator maps, logos or typefaces, and the signs are GTEki's own. The MP4s are still covered by one frame each. One distant sign in `24-south-passage-west.jpg` carries a pictogram too small to read at this resolution; it belongs to the open point below.

Open point for a human: the generated signs use a generic dark-panel, yellow-chip wayfinding look. They have not been compared against operator signage styles. If a reviewer judges the styling too close to a specific operator's, that is a design call for the Ikebukuro lane, not a PLATEAU credit matter.

## Files

34 JPEGs (`01`-`33` with `14` unused, `explorer-route-jrc2-exit35.jpg`, `m01-central-passage-mobile.jpg`) and 2 MP4 walkthroughs (`walk-jr-central-gate2-to-exit35.mp4`, `walk-west-exit-to-exit4.mp4`), 36 files in all.
