# Owner decisions on the R1 to R5 research files

Consolidated 2026-10-22 from section 8 of the five research files: [`gaps/DR-IK-station-facts.md`](gaps/DR-IK-station-facts.md) (IK), [`gaps/DR-SJ-station-facts.md`](gaps/DR-SJ-station-facts.md) (SJ), [`gaps/DR-changes-since-2023.md`](gaps/DR-changes-since-2023.md) (CH), [`gaps/DR-imagery-materials.md`](gaps/DR-imagery-materials.md) (IMG), [`gaps/DR-rights-lineage.md`](gaps/DR-rights-lineage.md) (RL). Duplicates are merged. A recommendation (marked **Rec**) appears only where the source file gives one. The questions below were collected as pending; **all were decided on 2026-10-22** (next section). Items already covered by a recorded decision are in "Already decided" and are not re-asked. The matching on-site work is in [field-collection-list.md](field-collection-list.md).

## Decided 2026-10-22

Decided by the director (gteki-80) under the Owner's delegation of 2026-10-22: [#165 comment 6335071234](https://github.com/nurockplayer/gteki/issues/165#issuecomment-6335071234). The Owner wants as much data shipped as rights allow, within clear limits. The question tables further down are kept as the record of what was asked.

| Id | Decision |
| --- | --- |
| OD-01 | Split. **Toei** station-page plain facts (exit numbers, closures, hours, lift counts) are covered by the #26 facts-only reference, with no copied text or layout (A). **Tobu** station-map gate names are **not** used (B), because Tobu terms §7–8 prohibit commercial use. |
| OD-02 | A. No JR East data. |
| OD-03 | Layout, not fact. Relative label placement stays in the research files only. |
| OD-04 | Withdrawn (research work, item R8). |
| OD-05 | Third-party aggregators are indicators only and never enter data. |
| OD-06 | A. S10 only for Shinjuku store location text. |
| OD-07 | Not needed. |
| OD-08 | A. Third-party photos are reference only, never shipped textures. |
| OD-09 | Moot under OD-08 A: no CC BY-SA material ships. |
| OD-10 | Yes: per-file CC BY attribution in `NOTICE` (applies only if a CC BY file ever ships). |
| OD-11 | Mapillary is reference only; no derived data. |
| OD-12 | Yes: Poly Haven and ambientCG **CC0** materials may be Lane E inputs, with provenance recorded per file. |
| OD-13 | B. Owner photos ship as **CC BY 4.0** (attribution "GTEki contributors"), matching the project's own assets. The Owner may override. |
| OD-14 | Photos showing operator logos or ads do not ship unless those regions are removed or blurred. |
| OD-15 | A. Keep roads risk acceptance (b) (the Owner accepted it knowingly); add the GSI Q1-24 note to `docs/gis/HANDOFF.md` (GIS lane). |
| OD-16 | A. Keep Q8; add a `HANDOFF` note on the confirmed catalog-versus-CKAN divergence (GIS lane). |
| OD-17 | R1 (Ikebukuro walk network) stays context-only. |

## Questions as asked (pending until 2026-10-22)

### Top decisions as ranked before the decisions (most work unblocked first)

1. **OD-01** Operator-page text facts under #26 (Toei, Tobu): unblocks the whole Shinjuku station-lead handoff (exit 2, tags, hours, lift counts) and the Tobu gate names.
2. **OD-08** Photo-as-texture policy: decides whether any third-party photo can ship, and sets the frame for OD-09 to OD-12.
3. **OD-13** Licence of the Owner's own photos (with OD-14, content rules): gates the use of all ten FC-IMG items (about 75 min Ikebukuro, 60 min Shinjuku).
4. **OD-15** Roads: accepted risk (b) read against GSI Q1-24: affects the shipped road geometry at both stations.
5. **OD-16** Q8 identity: the catalog ZIP and the CKAN-listed ZIP are confirmed to differ; does that change the Q8 Accept?

## Rights and terms of sources

| id | Question | Options (★ = lane recommendation) | Why it matters / unblocks | Source | Already decided? |
|---|---|---|---|---|---|
| OD-01 | Does the #26 facts-only rule cover text facts from Toei station pages (exit numbers, tags, closed status, hours, lift counts) and the Tobu inside map (4 to 5 gate names; terms 第7条 and 第8条, no commercial use)? | A. Yes, covered. B. No, keep out of data. | Toei facts are the SJ handoff (a); Tobu gate names serve checklist A2. Class is FACTS_ONLY_REFERENCE meanwhile | SJ §8.1; IK §8.3 | No (#26 is the general rule; neither file says it settles these) |
| OD-02 | May the three JR East lift hours (centre lift 6:10-23:00; east-side Metro-side lift 4:45-0:30; lift behind the West Exit stairs 5:00-0:30) be used under #26? | A. Keep "JR East not used" (decision of 2026-10-21 stands). B. Allow these facts. | JR terms bar every use. Facts stay in findings, not in handoff, until decided; relates to FC-IK-01 | IK §8.1 | Partly (2026-10-21: JR East not used); the source asks whether it stands for these facts |
| OD-03 | Is "9 is drawn immediately south of 10" a fact, or layout (the work)? | A. Layout; keep in the research file only (lane default). B. Fact; may go in data. | Toshima notice forbids altered marks and unauthorised reuse; Metro and Tobu terms are stricter. Data carries exit numbers, names and landmarks | IK §8.2 | No |
| OD-04 | ~~Read the 東武百貨店 and 東武ホープセンター 利用規約?~~ **Withdrawn by the lead:** reading public terms pages is research work, not an Owner decision. Item R8 on #165 retries them (and ISP/PARCO). If the terms then restrict use, a new decision is raised. | n/a | DR-IK-07/08 stay UNKNOWN until R8 reads the terms | IK §8.4 | Not an Owner decision |
| OD-05 | Third-party aggregators (DR-SJ-13, DR-SJ-14): pointers only, or excluded? | A. Pointers only. B. Excluded. | Their floor and gate hints for toilets are unofficial; terms restrictive or not retrieved | SJ §8.3 | No |
| OD-06 | Which basis ships for Shinjuku store location text: Toei's page or the S10 CSV? | A. S10 only ★. B. Toei page text. C. Both. | Rank 7 text; comparison basis for FC-SJ-06. S10 is already cleared (Q1) so the question is whether Toei's restricted page is also used | SJ §8.4 | Partly (Q1 clears S10, CC BY 4.0) |
| OD-07 | If the lane wants to reuse Tokyo, Toshima or operator drawings, route diagrams, videos or longer text, may it? Terms of those sources were not read. | A. Not wanted (no decision needed). B. Wanted; terms to be read first (see OD-04). | Conditional: needed only if reuse is wanted | CH §8 | No (conditional) |

## Imagery and the Owner's own photos

| id | Question | Options (★ = lane recommendation) | Why it matters / unblocks | Source | Already decided? |
|---|---|---|---|---|---|
| OD-08 | May any third-party photo (CC0, CC BY, CC BY-SA) become a shipped texture, or are all reference only? | A. Reference only ★ (use Lane E procedural packs; CC0 libraries only if a pack needs a base). B. Allow. | Rank 4. Photos are not tileable and carry signage; sets the frame for OD-09 to OD-12 | IMG §8.1 | No (PLATEAU textures already excluded, Q9) |
| OD-09 | If a CC BY-SA photo or Mapillary frame is ever adapted, are share-alike terms acceptable for the result, given the README's CC BY 4.0 split for original art? | A. Acceptable, per file. B. Not acceptable. | Only matters if OD-08 allows shipping | IMG §8.2 | No |
| OD-10 | Is a per-file credit line in `NOTICE` acceptable for CC BY files? | A. Yes. B. No. | Needed before any CC BY file ships or is quoted | IMG §8.3 | No |
| OD-11 | Mapillary: confirm reference-only; any derived-data use (map features, detections) needs an Owner decision. | A. Reference only, no derived data. B. Allow derived use. | Terms say the data belongs to Mapillary or its licensors apart from the CC BY-SA imagery; underground coverage not established | IMG §8.4 | No |
| OD-12 | May Lane E take Poly Haven or ambientCG CC0 textures as inputs? | A. Yes; record each in `PROVENANCE.md` and `NOTICE`. B. No. | Licence permits it, credit not needed; relates to PR #133. The OD-08 recommendation allows them only if a pack needs a base | IMG §8.5 | No |
| OD-13 | Licence of the Owner's own photos (FC-IMG-01 to 10). | A. CC0. B. CC BY 4.0 (the README art licence). C. Kept private as reference. | Gates every FC-IMG item; the field list tells the Owner to keep photos private until decided | IMG §8.6 | No |
| OD-14 | Content rules for the Owner's photos: may operator marks or ads in frame ship? | A. May ship. B. Reference only. | Same items as OD-13; operator photography rules were not checked | IMG §8.7 | No |

## Process

No pending item. The two process questions raised by the sources are answered under "Already decided" (ODPT key sign-up; contact with Toshima ward).

## Risk re-reads

| id | Question | Options (★ = lane recommendation) | Why it matters / unblocks | Source | Already decided? |
|---|---|---|---|---|---|
| OD-15 | Roads: should accepted risk (b) for `tran` geometry be re-read in light of GSI Q1-24 (a 使用承認 product needs no new application, but the approval holder's permission is the premise)? | A. Leave as is. B. Re-read; decide whether the holder's permission is needed. | Neither GSI nor PLATEAU text says who holds 令7関公第296号 or its scope; the PLATEAU credit wording carries no GSI approval notice. Bears on roads at both stations (rank 12, IK-03, SJ-03) | RL §8 (a); RL §3, §6 | No |
| OD-16 | Q8 identity: does the confirmed divergence between the catalog `url` ZIP and the CKAN-listed ZIP (different size and Last-Modified for 13116 and 13104) change anything under Q8 (Accept)? | A. Q8 stands; add a note to `HANDOFF` only. B. Revisit Q8. | Rank 16. The identity gap is now a confirmed divergence, not only unproven; byte comparison needs about 1.2 GB and 0.8 GB downloads per ward | RL §8 (b); RL §6 | Partly (Q8 = Accept stands unless revisited) |
| OD-17 | Does R1 (Ikebukuro walk network) stay context-only? | A. Stays context-only (no change implied). B. Take an Owner rights decision for R1 use. | Rank 15. Portal terms are PDL 1.0; per-resource licence null; CRS stays INFERRED_FROM_SPEC | RL §8 (c); M0-01 rank 15 | No |

## Already decided (not re-asked)

| Topic | Decision | Reference |
|---|---|---|
| Toei per-exit coordinate feed (SJ §8.2) | Not to be used. | Owner decision relayed by director gteki-80, 2026-10-22, tracked on #165 |
| ODPT key sign-up (IK §8.5) | The Owner registers for the key personally. Until then, use public documentation only. This answers "does a key sign-up count as contacting an external party?". Redistribution of ODPT data or recoverable derivatives stays barred without written consent (DR-IK-15). | Owner decision relayed by director gteki-80, 2026-10-22, tracked on #165 |
| 南通路西改札 to 4番出入口 (Yurakucho west-gate POI) | Addition approved; the Ikebukuro lane handles it. Field item F2 still gives the gate's side and column. | Owner decision relayed by director gteki-80, 2026-10-22, tracked on #165 |
| External inquiries for M0-01 ranks 5 (Shinjuku MLIT R2) and 11 (E27 after 2027-03-12) | Will not be made; research uses public sources only and contacts no one. Nothing pending for these ranks (RL §8). | Owner decision relayed 2026-10-22, recorded on #165 |
| Rank 12 (GSI, 令7関公第296号) and rank 15 (ほこナビDP) contact pages | Listed as information only; no authorisation requested and none used (RL §8). | Covered by the 2026-10-22 no-external-contact decision |
| Toshima ward consultation for a 3D-derivative permission (IK §8.6) | Not used. Recorded only because it is the stated route. | Covered by the 2026-10-22 no-external-contact decision |
| S10 licence label: manifest entry says PDL 1.0 (SJ §8.5) | CC BY 4.0 is the recorded label (Q1 = Yes, CLEARED_WITH_CONDITIONS); PR #127 covers the manifest. Housekeeping for the lead, no Owner question. | Q1-Q12 on [#39 comment 6324726321](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321); M0-01 §3 rights table |
| PLATEAU aerial-derived textures | Excluded (IMG §1). | Q9 |
| E27 slice | Ships under the #16 override, not a rights PASS. | [#39 comment 6325100917](https://github.com/nurockplayer/gteki/issues/39#issuecomment-6325100917) |
| Facts-only rule | Applies to every source here. OD-01 and OD-02 ask only whether it reaches specific operator pages. | #26 |

No decision needed: re-checking Keio and Odakyu pages once Keio's site is back (public pages only, no contact; SJ §8.6); the fetch-tool process note (IK §8.7); the CH file has no decision of its own beyond OD-07.

Not collected here: M0-01 §3 also lists Owner authorisations for ranks 2, 3, 6, 12 (Q5 re-ask) and 14. They are not in the section 8s of the five files.
