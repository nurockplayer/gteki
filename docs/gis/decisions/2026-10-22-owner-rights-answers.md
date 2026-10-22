# Owner answers to the rights questions (2026-10-22)

- **Primary record:** https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321. It was posted on the Owner's account. The merge lead recorded the Owner's multiple-choice selections there verbatim.
- **Questions:** `docs/gis/decisions/owner-rights-questions.md` (#112).
- **Scope:** these are accepted interpretations and risks, not changes to the evidence. The rights records in `docs/gis/rights/` keep their UNKNOWN or reservation text. Nothing becomes routable or verified because of these answers.

| Q | Answer | What it means for what ships |
| --- | --- | --- |
| 1 | **Yes** | Tokyo S10 (都営「駅構内のお店」 CSV) publishes with credit. Plain names, times and locations only: no promotional prose, images, logos or trademarks. S10 has no coordinates, so nothing is placed from S10 alone. |
| 2 | **Yes** | Tokyo S03 (新宿駅周辺の施設情報等) publishes its neutral geometry and factual fields with credit, under the same limits as Q1. The CRS stays UNKNOWN, and level labels are not elevations. |
| 3 | **Yes** | For S03, the dataset's CC BY 4.0 grant is taken to control over the bureau site's general reservation (「無断で複製・転用することはできません。」). The reservation text stays visible in the evidence. |
| 4 | No | S03 promotional prose, linked content and PDF illustrations do not ship. |
| 5 | No | The PLATEAU related station, railway and border layers do not ship. |
| 6 | No | The PLATEAU related shelter, park and emergency-route layers (KSJ non-commercial) do not ship. |
| 7 | No | The PLATEAU related landmark layer does not ship. The GSI approval scope stays UNKNOWN. |
| 8 | **Accept** | Catalog-API PLATEAU files are accepted as the licensed release, on the basis that the files self-declare CC BY 4.0. The size and identity gap against the CKAN-listed upload stays recorded. |
| 9 | Yes | No textures ship. |
| 10 | Yes | The Shinjuku credit adds a notice that building bases are flattened to street level. The wording is Option A, decided by the Owner (see below). Shinjuku only. |
| 11 | No | The E27 package's PDL 1.0 is not taken to cover both E27 resources. |
| 12 | **Yes** | Road risk acceptance (b) extends to Shinjuku 13104 `tran`, on the same terms: geometry only, no attributes, with attribution (see `2026-10-22-plateau-tran-geometry-risk-acceptance.md`). Shinjuku roads are flattened to street z = 0 like its buildings. |

## Credits

- **S10:** 「出典：東京都交通局「駅構内のお店」」. A change notice is also needed wherever we edit, select or reformat the data.
- **S03:** 「出典：東京都都市整備局「新宿駅周辺の施設情報等」」, with a change notice on the same terms as S10.
- **PLATEAU:** 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」.

## Q10 wording: Option A, decided

The Owner replied 「照你建議」 when shown options A and B, which selects **Option A**. Primary record: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324813261 (relayed by the director session).

- **Shinjuku context credit**, shown as-is wherever that context renders: 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成（建物の基部を地表面の高さにそろえて表示）」
- **Ikebukuro context credit** stays 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」, with no parenthetical. Ikebukuro keeps real TP heights (frame hM 0, no base adjustment), so the flattening notice would be untrue there.
- **Rejected:** Option B (「…（建物基部の高さを調整）」).
