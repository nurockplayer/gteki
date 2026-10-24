# Merchant self-service — Phase 1 spec (#438)

- Tracking: #438. Related: #212 (Ikebukuro merchant import contract), #419/#425 (tenant directory), #26 (per-source clearance), OD-31 (facts only, no directory copy), OD-32 (dated hours, current status unknown).
- Status: **spec only — no code, no outreach.** Nothing here authorises contacting a shop. The Owner decides whether Phase 2 starts.
- Owner: data-research-05. Schema fit: core-search-6a (reviewed, #440). Rights and consent text: core-rights-a9 (reviewed, #440 issuecomment-6382909140; P1 points applied). **§4 stays a DRAFT until core-rights-a9 signs off the final wording.**
- Schema baseline: `gteki.station/0.1` as in `packages/schema/src/index.ts`; contract rules in [`docs/core/contract.md`](../../core/contract.md). Tenant shape follows #425 (`gteki.tenants/0.1`), which was not yet on `main` when this was written.

## 1. Goal and non-goals

**Goal.** A shop in or beside a station can submit or confirm its own listing: name as printed, category, floor from the station's own floor list, a position, optional dated hours, official URL, one contact. In return the shop grants GTEki a licence (DRAFT, §4) that lets the approved facts ship. This gets us (a) names and entrance wording the shop itself vouches for, (b) hours that are first-party by construction, and (c) floor/position data that can later become routable once GIS aligns an entrance with verified graph nodes.

**Non-goals (Phase 1).**

- No outreach, no draft e-mails, no pilot shop selected.
- A submission never creates a route. `connectorNodeIds` stays `[]` until the station writer has entrance evidence aligned by GIS (same rule as #212).
- No current open/closed status, ever asserted (OD-32).
- No shop accounts, no shop-facing editing of `stations/**`, no self-published live data.
- No schema change in Phase 1 (core-search-6a). Gaps are listed in §9.
- No photos collected in Phase 1 (see §6).
- Promotional copy, logos, interior shots and map artwork are out of scope (OD-31).

## 2. Who submits, identity, retention

| Item | Rule |
| --- | --- |
| Who | A person acting for the shop (owner, manager, head office web/e-commerce team). One row per shop per submission. |
| Light identity check | (1) contact e-mail on the shop's official domain, or (2) the submission cites an official URL that names the shop and the same contact/branch — for chains, the branch page in the operator's own store locator, not the brand homepage. Neither present → queue as `IDENTITY_UNCONFIRMED`. |
| Contact data | One contact point (e-mail or phone). No name, postal address or employee ID required. Free-text "role" only (e.g. `店長`, `本部`). |
| Public repo | Contact data never enters `stations/**` or any public file. Public approval records carry no contact-derived value at all; a keyed HMAC (key kept private) and the timestamp live only in the private queue (§4). |
| Retention | Contact kept while the submission is open and 90 days after the decision, then deleted; deleted earlier on request. Withdrawal is logged without the contact. |
| Chain vs branch | A brand-domain contact proves the brand, not the branch. Branch-specific facts still need the branch page or a field check. |

## 3. Form fields

| Field | Required | Format | Maps to |
| --- | --- | --- | --- |
| Shop name as printed | yes | free text, one language as displayed on the shop's signage | `Poi.names` (`lang` as submitted; no translation) |
| Aliases / reading | no | free text, one per line | `Poi.aliases` (only what the shop states; no invented romaji) |
| Category | yes | one of the `PoiCategory` values; default `shop`, also `locker`, `atm`, `service`, `toilet` | `Poi.category` |
| Facility / building | optional | free text (e.g. `Echika池袋`, `南館`) | `Poi.notes` (a facility is not a `Floor`) |
| Floor | yes | picked from the station's own floor list, showing `Floor.displayNames`; stores `Floor.id` | `Poi.floorId` |
| Position — option A: tap | optional | tap on our own schematic floor plan → station-frame `x, y` on that floor | `Poi.displayPosition` (`z` from `Floor.elevationM`, else `null`) |
| Position — option B: anchor | optional | pick a nearby `exit` / `ticket_gate` POI + free-text entrance wording | `Poi.notes` only (`「〇〇改札付近（店舗申告）」`); **never** converted to `displayPosition` |
| Inside / outside fare gates | yes | inside / outside / not sure | `Poi.notes` as the shop's declaration (「改札内（店舗申告）」); `Poi.paid` stays `null` (core-search-6a) |
| Hours | optional | text + "as of" date | `Poi.notes` with the OD-32 wording (§6) |
| Official URL | optional | http(s) | `Source.url` (the shop's page) |
| Photo | **not in Phase 1** | — | — |
| Contact | yes | e-mail or phone | approval record only, never public (§2) |
| Consent | yes | checkbox, versioned terms (§4) | `Source` licence fields |

Position rules that follow from the schema and validator:

- `displayPosition` is a display centroid, never a routing target.
- `validateBundle` (`poi.position.rights`) requires at least one source in the POI's evidence with rights `REUSABLE_WITH_CONDITIONS` or `PUBLISHED_UNDER_OWNER_OVERRIDE` **and** `usage` not `facts-only`. So option A only works when the shop has accepted the reusable grant in §4; otherwise `displayPosition` stays `null`.
- Option A needs a schematic floor plan GTEki owns. None exists today: `stations/shinjuku/data/plan.json` is render-only geometry derived from MLIT 構内地図データ with an unconfirmed licence basis, and OD-31 forbids reusing map artwork. Authoring our own schematic is a prerequisite (see §8).
- Lat/lon is derivable through `station.origin` (`StationFrame.toGeodetic`) but is not a POI field; nothing extra is stored.
- Floors are operator-scoped: the picker shows `displayNames` but never equates floors across operators, and the submission's floor is stored as our `Floor.id` only.

## 4. Consent and licence — **DRAFT — needs core-rights-a9 review**

The submitter ticks a versioned consent with these effects (wording to be finalised by core-rights-a9):

1. **Grant (facts).** A worldwide, non-exclusive, royalty-free, irrevocable licence to GTEki and its users to include, modify, publish and sublicense the submitted facts (name, category, facility, floor, position, entrance wording, hours, official URL), for any purpose including commercial use, in any medium. The licence itself cannot be revoked. Withdrawal (item 5) is a separate promise by GTEki to drop the entry from future releases; it does not end the licence for copies already distributed.
2. **Licence name.** Registered in `REUSE`/`NOTICE` as `LicenseRef-GTEki-merchant-grant`. It is never resolved to Apache-2.0, CC BY 4.0 or CC0.
3. **Authority and warranty.** The submitter declares they are authorised to act for the shop, that the submitted facts are accurate to their knowledge, and that nothing submitted copies third-party text, images or floor plans. Recorded: role, a keyed HMAC of the contact (never a plain hash in any public record; the key and the contact stay in the private queue), timestamp, terms version.
4. **Display.** Facts display with the label 「店舗提供」 / "merchant-submitted" and the submission date, never as verified.
5. **Withdrawal.** On request GTEki commits to remove the entry from the next public release. Already-distributed releases and caches cannot be recalled; the form and spec say so. Withdrawals are logged.
6. **Photos (later).** If collected in a later phase: the shop's own copyright, credited to photographer and rights holder, no people and no third-party marks or works, project grant or CC BY 4.0 with an attribution string, no AI-generated images, nothing taken from the web.
7. **Not accepted.** CC0, GPL/SA-type licences, "automatic consent", shop-authored licence text. Rights labels in the UI come from i18n only.

## 5. Verification flow and states

| State | Entered when | Effect on station data |
| --- | --- | --- |
| `RECEIVED` | form accepted | nothing published; contact kept (§2) |
| `IDENTITY_UNCONFIRMED` | §2 check fails | nothing published; one follow-up attempt, then closed |
| `PENDING_REVIEW` | identity ok, in queue | nothing published |
| `APPROVED` | checked against the shop's own page (dated ≤180 days) or a field photo taken by us; still shown as merchant-submitted and UNVERIFIED | one `Source` added; POI created or updated (§6) |
| `REJECTED` | impersonation, no authority, banned content, duplicate of a different shop | nothing published; reason logged |
| `WITHDRAWN` | submitter asks | POI removed or reverted at the next merge |

Rules:

- **Ranking is source-type neutral.** Merchant-submitted entries get no bonus and no penalty; current ranking is text-match quality plus the routable +5 bonus (core-search-6a).
- **No route from a submission.** `connectorNodeIds` stays `[]` (router answers `unknown_goal`, "destination has no verified entrance") until GIS aligns an entrance to verified graph nodes.
- **Approved means "the shop said so, and we checked the shop's own page",** not verified or field-surveyed; the data stays UNVERIFIED and is labelled merchant-submitted. `Poi` has no verification enum; the wording lives in `evidence.method` (and the UI label).
- **Existing POIs.** Same shop, better facts → update the existing `Poi.id` in place; never renumber. Unclear whether it is the same shop → `PENDING_REVIEW`, never a silent second POI. A merchant submission never overwrites field-verified facts (`displayPosition`, `connectorNodeIds`, `paid`) without a Lead decision.
- **Single writer.** Only that station's writer merges data (ikb-route-15 for Ikebukuro, sjk-search-78 for Shinjuku); data research does not touch `stations/`.
- **Audit trail.** One `Source` per submission (or per verification batch), `decision` = the approval record URL under #26; the queue row keeps the submission id, reviewer, date, state history.

## 6. Data mapping

### Source record (one per submission)

| Field | Value |
| --- | --- |
| `id` | `msub-<stn>-<n>` (e.g. `msub-ikb-001`); never reused |
| `title` | `Merchant submission <submission id>` |
| `publisher` | the shop's official name |
| `url` | the shop's own page; when the shop has none, the public approval record URL for that submission (never empty) |
| `license` | `LicenseRef-GTEki-merchant-grant` (DRAFT, §4); `license.url` points to the public, versioned terms page |
| `rights` | `REUSABLE_WITH_CONDITIONS` once the grant is accepted (core-rights-a9) |
| `usage` | `data` for facts used as position data; never `facts-only` for a submission that feeds `displayPosition` |
| `decision` | the approval record (issue/comment URL + ISO date) |
| `attribution` | the shop name + 「店舗提供」 / "merchant-submitted", terms version |
| `modified` | `true` if we reword, translate or reposition; otherwise `false` |
| `retrievedAt` / `datasetDate` | submission date |

### POI fields

| Field | Value |
| --- | --- |
| `id` | existing id when the shop already exists; new ones `shop-<stn>-msub-<n>` |
| `category` | from the form (§3) |
| `names` / `aliases` | as submitted; no translation, no invented romaji |
| `floorId` | the picked `Floor.id`, else `null` |
| `displayPosition` | option A only (`x, y, z`); `null` for option B or no licence |
| `connectorNodeIds` | `[]` until entrance evidence is GIS-aligned |
| `paid` | `null`; the shop's declaration goes in `notes` (core-search-6a). A field check may set it later |
| `evidence.sourceIds` | the submission `Source.id` |
| `evidence.method` | `merchant-submitted (<submission id>, <date>), UNVERIFIED` (exact prefix; the UI keys its label on it) |
| `evidence.checkedDate` | date of the reviewer's check |
| `notes` | ja+en, first: 「店舗提供の情報（<date>）・GTEki 未確認」 / "Merchant-submitted (<date>), not verified by GTEki"; then hours (below), then the anchor wording |

**Hours.** `Poi` has no hours field; hours go in `notes` as text with the submission date and the OD-32 wording 「出典日時点の情報です。変更されている場合があります」 / "As of the source date; may have changed". The ≤180-day rule applies: a submission date older than 180 days drops the hours. Hours never imply current status.

**Tenants.** For a department store, the brand listing stays out of `pois.json` (#419): brands go to the station's tenant file with `poiId` = the store POI (research files call it `storePoiId`), `floorLabel` in the shop's own wording and no conversion. English names only if the shop supplies them. **Known blocker:** #425's `tenant.evidence` rule requires a facts-only source with a decision, but a merchant-submission Source has `usage: "data"`, so such tenant rows would fail CI. core-search-6a will relax that rule in a follow-up after #425 merges; until then merchant-submitted brands are not written to tenant files.

### IMDF mapping (structure, from gteki-1b)

The shop and its position are separate records, so a move only updates the anchor. Our format stays canonical; this table is for a future IMDF export.

| Ours | IMDF | Note |
| --- | --- | --- |
| Occupant part of a submission (name, aliases, category, hours, URL) | `occupant` + `address`/`hours` as available | no name/ID translation |
| Position part (floor + ENU point, or nearby connector) | `anchor` (`geometry` point + `unit_ids`) | anchor moves independently of the occupant |
| `Floor.id` (+ `displayNames`) | `level` (`id`, `ordinal`, `name`) | `ordinal` stays operator-scoped; never compared across operators |
| Merchant unit / area name from the form | `unit` | only when the shop names its unit; we do not invent one |
| `Poi.displayPosition` | anchor point in station ENU, converted through `station.origin` | display only, never a route target |
| `Source` + `evidence` | not exported | provenance stays in our format |

## 7. Privacy and abuse

- **Spam:** rate limit per contact and per IP (e.g. 3 submissions/day, 10/month); a shared-secret or invite link for a pilot batch; no bulk import from a shop.
- **Duplicate:** same name + floor + position within N metres → merged into one queue row for a reviewer, never auto-published twice.
- **Impersonation:** §2 identity check; a claim on a shop already approved for another contact is decided by the station lead (core-rights-a9 only if the grant's validity is questioned; the Owner if they disagree); no public "this shop claimed" badge until the rights owner approves it.
- **Banned content:** promotional copy, logos, prices, images with people, third-party marks; rejected at review, not silently edited.
- **Takedown:** anyone can request removal of a listing; removal from the next release, logged; corrections get the same route.
- **Data minimisation:** one contact, kept only in the private queue with a keyed HMAC; no analytics on the form beyond abuse counters.

## 8. MVP surface options

| Option | What ships | Rough cost | Notes |
| --- | --- | --- | --- |
| **A. Hosted form + manual queue** | a hosted form (e.g. a GitHub Issue Form or a form service posting to a private sheet) + a review queue in a GitHub issue / CSV | 1–2 days of setup, no app code | no floor-plan tap; position via anchor (option B) only; smallest surface, easiest to withdraw |
| **B. Small page in `apps/web`** | own form page with the schematic floor-plan picker, validation against the station's floor/POI lists, review queue view | ~2–3 weeks plus authoring one schematic floor plan per pilot station | depends on a GTEki-owned schematic (§3); the only way to get real `displayPosition` |
| **C. Shop accounts** | login, shop edits its own listing, audit history | months; needs the rights, abuse and moderation model first | out of scope beyond Phase 1 |

**Recommendation:** start with **A** as a pilot (small number of shops, anchor-based position, manual verification), and build **B** only after a pilot proves demand and a schematic floor plan exists. A keeps Phase 1 reversible and does not commit us to a review UI before the rights questions in §4 are settled.

## 9. Open questions

**Owner**

1. Approve Phase 2 at all, and if so which surface (§8 A vs B) and how many pilot shops.
2. ~~Does a self-declaration set `paid`?~~ — default per core-search-6a: no, `paid` stays `null` and the declaration is a note; the Owner may decide otherwise.
3. May a merchant submission ever replace field-verified facts on an existing POI?

**core-rights-a9**

4. Final wording of the grant (§4), including whether "irrevocable" plus separate withdrawal is acceptable, and the `LicenseRef` name.
5. ~~`Source.url` when a shop has no web page~~ — answered by core-rights-a9: use the submission's public approval record URL, never empty.
6. ~~Who signs off an impersonation claim~~ — answered by core-rights-a9: the station lead decides identity disputes; core-rights only when the validity of the grant is questioned; the Owner only if the two disagree.

**core-search-6a**

7. ~~Is the method prefix enough?~~ — core-search-6a: yes for Phase 1; Phase 2 should record the source type on the Source (e.g. `Source.kind`).
8. ~~Photo slot~~ — core-search-6a: a separate images schema proposal, not `Asset`.
9. ~~Tenant mapping~~ — confirmed by core-search-6a (`storePoiId` → `poiId`, `floorLabel` as worded); see the known blocker in §6.

**data-research-05**

10. Which station gets the first schematic floor plan if B is chosen, and who authors it.
