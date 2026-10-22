# Owner risk acceptance: PLATEAU road (tran) geometry in station context

- **Date:** 2026-10-22
- **Decided by:** the Owner, option (b).
- **Primary record:** https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323977745. It was posted on the Owner's account and quotes the Owner's reply verbatim, together with the options the merge lead put to them.
- **Owner's words:**「(b) 接受風險：一樣加上出處就放道路，把國土地理院的承認視為只涵蓋屬性。」
- **Applies to:** `gis context-glb` road meshes (`ctx_road_*`) built from PLATEAU `tran` sources, for example `plateau-13116-tran-53394576` and `plateau-13116-tran-53394577`.

## What is accepted

1. **Geometry only.** Roads ship as triangulated LOD3 TrafficArea and Road surfaces (POSITION and NORMAL) plus our own provenance extras. No `tran` attribute is shipped: not `tran:function`, `usage`, `class`, or any other code value or attribute value. `tools/gis/test/context.test.ts` ("road meshes are geometry only") enforces this.
2. **GSI approval scope assumed.** The PLATEAU resource lineage cites 国土基本情報（2025年度）（国土地理院長承認（使用）令7関公第296号） as the source of `tran:function` and TrafficArea. **The project treats that approval as covering the attributes only, and so as not applying to geometry we ship without attributes.** This is an assumption the Owner accepts as a risk. It has not been verified.
3. **Attribution.** Wherever the context renders, the app shows 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」 exactly as written. 「加工」 serves as the modification notice that the PLATEAU site policy §3 requires.

## What is NOT changed

- **The evidence is unchanged.** The UNKNOWN analysis in `docs/gis/rights/plateau-13104-related.json` and its 13116 counterpart still stands: "an approval number alone is not permission", and the approved scope and required wording are unconfirmed. This record is an explicit accepted risk. It is not an upgraded rights verdict.
- **Routing is unchanged.** Context remains `gteki_role=context`, `NOT_FOR_ROUTING` and `visual_only`. Road geometry is never navigation evidence.
- **Reopening.** If the GSI approval's scope or required wording turns up and does not fit this reading, roads go back to HOLD. The command `--kinds bldg` produces the buildings-only files.

## History

The merge lead first decided (a), buildings only with roads on HOLD; that is recorded on #39. PR #101 made buildings-only the Ikebukuro default while that decision stood. The Owner then chose (b), which replaces (a). The Ikebukuro default is both kinds again.
