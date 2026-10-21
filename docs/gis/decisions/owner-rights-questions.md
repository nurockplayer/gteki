# Owner rights questions (yes/no)

Open rights questions from Issues #39 and #26 and the committed rights records. Only the Owner can decide these. Each is yes/no. Answer in the issue and the lead will record it under `docs/gis/decisions/`.

- **Nothing here blocks visual prototyping.** The default for every item is the conservative one and is what applies today.
- **Evidence is reuse terms only.** It never makes data routable or verified, and every verdict is a statement about the acquired text, not a legal conclusion.
- Evidence IDs are `<source>#<label>` in `docs/gis/rights/*.json`. Comment links are on `nurockplayer/gteki`.
- Items 1 to 6 and 11 do not come from an issue comment. They come from the rights records and `docs/gis/HANDOFF.md` ("Still open (rights)"), because #39 and #26 never asked them. Items 7 to 10 and 12 do come from #39 comments.

## Quick table

| # | Question (short) | Default if unanswered |
| --- | --- | --- |
| 1 | Ship Tokyo S10 factual fields? | No |
| 2 | Ship Tokyo S03 geometry and factual fields? | No |
| 3 | Does the S03 dataset grant control over the bureau site reservation? | No |
| 4 | Ship S03 promotional prose, links and PDF illustration? | No |
| 5 | Ship PLATEAU related station, railway and border layers? | No |
| 6 | Ship PLATEAU related shelter, park and emergency-route layers? | No |
| 7 | Ship PLATEAU related landmark layer? | No |
| 8 | Accept catalog-API PLATEAU files as the release the licence covers? | No (nothing new ships on it) |
| 9 | Keep textures out of every ship? | Yes |
| 10 | Add the "building bases flattened" notice to the Shinjuku credit? | Yes |
| 11 | Treat the E27 package PDL 1.0 as covering both E27 resources? | No |
| 12 | Does road risk acceptance (b) also cover Shinjuku (13104) tran? | No |

## Questions

### 1. Tokyo S10 factual fields (都営 stores CSV, 新宿 and 新宿西口)

- **Question:** Do we ship the S10 factual fields (plain store names, literal location/time text, URL strings as pointers) with the credit 「出典：東京都交通局「駅構内のお店」」?
- **Yes:** the fields may appear in published station data with that credit and a modification statement. Logos, photos, linked pages and trademarks stay out. No coordinates exist, so nothing is placed from S10 alone.
- **No:** S10 stays internal evidence.
- **Evidence:** `docs/gis/rights/tokyo-s10-shinjuku-csv.json` and `tokyo-s10-shinjuku-nishiguchi-csv.json` (CLEARED_WITH_CONDITIONS, DATASET). IDs `tokyo-s10-catalog#licence`, `#tokyo-exclusions`, `plateau-related-provenance#trademarks-excluded`. Source: rights record and HANDOFF "Rights / publication gate"; not raised in #39 or #26.
- **Default:** No. The publish gate is HOLD until the Owner approves.

### 2. Tokyo S03 geometry and factual fields

- **Question:** Do we ship the S03 neutral geometry and factual fields (plain names, literal location/time, URL strings as pointers) with the credit 「出典：東京都都市整備局「新宿駅周辺の施設情報等」」?
- **Yes:** that subset may be published with the credit. Nothing from it becomes routable or verified; its CRS is UNKNOWN and level labels are not elevations.
- **No:** S03 stays internal evidence.
- **Evidence:** `docs/gis/rights/tokyo-s03-zip.json` (subset record CLEARED_WITH_CONDITIONS, whole ZIP UNKNOWN), `tokyo-s03-spec.json`, `tokyo-s03-reference.json` (text only). IDs `tokyo-s03-catalog#licence`, `#resource`, `tokyo-s03-zip#linked-field`. Source: rights record and HANDOFF; not raised in #39 or #26.
- **Default:** No (HOLD).

### 3. S03: dataset grant versus the bureau site reservation

- **Question:** Do we accept the reading that the S03 dataset's CC BY 4.0 grant controls over the bureau site's general copy reservation?
- **Yes:** item 2 can proceed on the record's reading. This is an interpretation we make, and the reservation text stays visible in the evidence.
- **No:** S03 does not ship until the bureau clarifies. The record cannot settle it.
- **Evidence:** `tokyo-s03-catalog#site-reservation` quotes 「無断で複製・転用することはできません。」 from `https://www.toshiseibi.metro.tokyo.lg.jp/policy`. The record treats it as general-site evidence that does not override the dataset grant. The clause was re-checked against the current page snapshot `cbcbf616…9fbe` (re-bound in this lane). Source: rights record; not raised in #39 or #26.
- **Default:** No.

### 4. S03 promotional prose, linked content and PDF illustration

- **Question:** Do we ship S03 promotional shop `description` text, linked-page content, or the 参考資料 PDF illustration?
- **Yes:** we would ship content whose clearance is UNKNOWN. Third-party shop prose and linked content may carry their own rights.
- **No:** only the item 2 subset ships. Prose, linked content and the illustration are excluded.
- **Evidence:** `tokyo-s03-zip.json` (promotional and linked-content record UNKNOWN), `tokyo-s03-reference.json` (illustration record UNKNOWN). IDs `tokyo-s03-zip#promotional-field`, `#linked-field`. Source: rights record; not raised in #39 or #26.
- **Default:** No.

### 5. PLATEAU related layers cleared with conditions (station, railway, border)

- **Question:** Do we ship the Shinjuku (13104) and Toshima (13116) related station, railway and border layers with per-layer attribution?
- **Yes:** these layers may ship. The border layer must keep its 測量法 approval notice.
- **No:** they stay internal.
- **Evidence:** `docs/gis/rights/plateau-13104-related.json` and `plateau-13116-related.json` (ORIGIN_DATASET, CLEARED_WITH_CONDITIONS). IDs `plateau-related-provenance#ksj-n02-2024`, `#ksj-n03-2025`, `#border-approval`. Source: rights record and HANDOFF; not raised in #39 or #26.
- **Default:** No (HOLD).

### 6. PLATEAU related layers restricted (shelter, park, emergency route)

- **Question:** Do we ship the related shelter, park and emergency-route layers (KSJ non-commercial origin) on the public deploy?
- **Yes:** we would publish data whose acquired origin terms are non-commercial. The Owner's guidance on https://github.com/nurockplayer/gteki/issues/26 (body) says non-commercial use does not automatically give a right to publish.
- **No:** the three layers stay out of public deploys.
- **Evidence:** same two records (ORIGIN_DATASET, RESTRICTED). IDs `plateau-related-provenance#non-commercial`, `#no-copy-redistribution`, `#ksj-old-rule`, `#ksj-p20`, `#ksj-p13`, `#ksj-n10-2024`. Source: rights record and HANDOFF; not raised in #39 or #26.
- **Default:** No.

### 7. PLATEAU related landmark layer

- **Question:** Do we ship the related landmark layer (GSI origin), accepting the unconfirmed approval scope?
- **Yes:** same style of accepted risk as roads (b). The approval number is not a confirmed permission.
- **No:** the landmark layer stays out. This matches the treatment recorded on #34 per the #39 deploy decision.
- **Evidence:** both related records (ORIGIN_DATASET, UNKNOWN). IDs `plateau-related-provenance#gsi-origin`, `#gsi-survey`, `#approval-distinction`, `#approval-wording`, and `plateau-related-provenance#plateau-13104-related-landmark-asset-approval` (a 13116 counterpart exists). Comment: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323832068 (merge lead).
- **Default:** No.

### 8. Catalog-API PLATEAU files versus the CKAN-listed upload

- **Question:** Do we accept the catalog-API CityGML files (bldg, tran, ubld) as the 2025 release the licence covers, although they are not shown to be the CKAN-listed upload?
- **Yes:** we record an accepted identity risk. The CC BY 4.0 label for these files rests on the research dossier and one file-embedded declaration.
- **No:** the gap stays open. The lead may test whether the ZIP members are byte-equal to the served files, which needs large downloads.
- **Evidence:** HANDOFF "Open questions (d)" and the rights-resource-scope bullet (`docs/gis/HANDOFF.md`). The served files have `Last-Modified` 2026-03-27 and the catalog `fileSize` disagrees with the served size for bldg. `docs/gis/rights/plateau-13104-related-catalog.json` lists "Explicit coverage of the exact resource" as missing. Comments: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6321533688 (raised), https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323832068 (unchanged).
- **Default:** No. Ikebukuro buildings already shipped under the merge lead's 2026-10-22 decision stay as decided. Nothing new, such as Shinjuku, ships on this basis until answered.

### 9. Textures

- **Question:** Do we keep textures out of every ship until their licence is assessed?
- **Yes:** flat per-class colours only. This is today's behaviour.
- **No:** textured context would need a licence assessment first. Textures derive from aerial photography and are unassessed.
- **Evidence:** HANDOFF "Open questions (e)"; no rights record exists. Comments: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6321533688, https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323832068 ("textures are not shipped").
- **Default:** Yes.

### 10. Shinjuku "building bases flattened" modification notice

- **Question:** Do we add a flattened-bases line to the Shinjuku credit, next to 「出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成」?
- **Yes:** the credit also says "building bases flattened to street level", because flattening is a modification. The lead drafts the Japanese wording and the Owner approves or edits it. The wording is not yet written.
- **No:** only the standard credit shows. Lane B said the notice must also state the flattening, so a no is a departure from that decision.
- **Evidence:** `plateau-related-provenance#legal-modifications`, `#plateau-credit`. Comment: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324045059 (Lane B).
- **Default:** Yes (add it).

### 11. E27 (Hokonavi) package licence

- **Question:** Do we treat the CKAN package's PDL 1.0 as covering both E27 resources, although each resource-level licence is `null`?
- **Yes:** E27-derived candidate graphs have a licence basis, still needing attribution and a processing notice. They also stay `UNVERIFIED`.
- **No:** E27 data stays internal. Nothing ships either way today.
- **Conflict, pending Owner confirmation (recorded 2026-10-22 JST).** The Owner answered Q11 **No** (#39 comment 6324726321, 2026-10-21T19:31:08Z) against the option text above. Earlier, the Owner had already merged PR #16 (Owner comment 2026-10-21T10:31:49Z), overriding its HOLD and accepting publication of the Shinjuku slice, which includes E27-derived data. A literal reading of "No" conflicts with E27 already shipping. **Lead's reading (not an Owner statement):** the #16 override stands as the shipping basis, and "No" means only that the package PDL 1.0 is not taken as a licence basis for the two resources. Not a rights PASS. Owner confirmation has been requested on #39. Open: `gap:reuse-after-publication` (ほこナビDP inquiry about reuse after 2027-03-12).
- **Evidence:** HANDOFF "Open question (rights, Hokonavi E27 scope)". Answered in #39 comment 6324726321 (see the conflict note above).
- **Default:** No.

### 12. Roads (b) and Shinjuku

- **Question:** Does the 2026-10-22 risk acceptance for roads (b) also cover Shinjuku (13104) tran geometry?
- **Yes:** Shinjuku road geometry may ship under the same terms, geometry only and flattened to z = 0.
- **No:** road geometry ships for Ikebukuro only. Shinjuku roads are optional, since the #61 surface layer already draws roads.
- **Evidence:** the (b) comment names the 13116 tran meshes only as examples and the GSI lineage was checked for those. The 13104 tran lineage was not checked here, so it is UNKNOWN. Comments: https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323977745 (Owner), https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324045059 (Lane B, "`tran` is optional for Shinjuku").
- **Default:** No.

## DECIDED (not questions)

| Topic | Decision | Link |
| --- | --- | --- |
| Roads (tran), geometry only | Owner chose (b) on 2026-10-22: accept the risk, ship with attribution, GSI approval treated as attributes-only, no tran attributes shipped. The UNKNOWN evidence stays visible. | https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323977745 ; record: `docs/gis/decisions/2026-10-22-plateau-tran-geometry-risk-acceptance.md` (#104) |
| Facts-only sources | Owner decided on 2026-10-21: independently verifiable exit numbers, gate names and access facts may be used without reproducing the works. | https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404 |
| JR East trace | Resolved: not used. The JR map images returned HTTP 403 and were never read. | same #26 comment |
| Buildings first deploy | Merge lead decided on 2026-10-22: ship buildings with the attribution as-is. The roads half was replaced by (b). | https://github.com/nurockplayer/gteki/issues/39#issuecomment-6323832068 |
| Shinjuku origin and vertical anchor | Lane B decided: station frame, each building flattened to street z = 0. This is not a rights question. | https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324045059 |

## Engineering follow-ups from #26 (not Owner questions)

- Make the facts-only credit say 「ライセンスなし・事實のみ參照（複製なし）」 explicitly.
- Optional per-source clearance record with a decision reference and date. The issue says not to make it a merge gate.
