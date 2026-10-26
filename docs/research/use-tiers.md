# Use tiers: private, public, commercial (OD-35)

Decided 2026-10-27 by the director (gteki-1b) at the Owner's request. It supersedes earlier rulings only where they treated every use as if GTEki were already a commercial product.

## Why

GTEki's first goal is the Owner's own tool: a 3D explorer and indoor navigator for finding walkable routes in large Japanese stations, starting with Ikebukuro and Shinjuku. It is non-commercial. Earlier rulings (#26, OD-01, OD-02, OD-34) were written for a public site and, in places, for a future business ("GTEki is meant to become a business", OD-34 round 2). That mixed three different uses and kept objective facts (exits, gates, floors, passages) out of the Owner's own navigator.

## Tiers

| Tier | Who sees it | Where the data lives | Built by |
| --- | --- | --- | --- |
| **P: private** | The Owner only | Private repo `nurockplayer/gteki-private` and local disk. Never in this public repo, its CI artifacts, PR text, or gteki.pages.dev | The shared engine with the private overlay (see Engineering) |
| **S: public, non-commercial** | Anyone | This public repo, gteki.pages.dev | The shared engine, public data only |
| **C: commercial** | Customers | Not a current goal | — |

Moving anything to C (ads, paid features, a company launch) triggers a re-read of every source marked `recheck-at-C` below. Nothing else needs a re-read.

## Source classes

| Source class | Examples | P | S |
| --- | --- | --- | --- |
| Open data with a licence | CC BY 4.0 (S03, S10, Toei open data, KSJ N02), PDL 1.0 (R1, S02), 政府標準利用規約 2.0 | Yes | Yes, with credit (unchanged) |
| Sites allowing private use and quotation | Tokyo Metro, Toei, Seibu Railway, LUMINE, NEWoMan, Toshima ward, ISP, Sunshine City, Marui, Isetan | Yes, as primary facts | Facts only, #26 (unchanged) |
| Sites that ban only business or profit use | Tobu Railway §8, そごう・西武 §2(8) | Yes, as primary facts | **Facts only (changed).** S is non-commercial, so these clauses don't apply to it. Marked `recheck-at-C`. Lifts OD-01 B for Tobu gate names and the Sogo-Seibu tenant limit in OD-34 round 3 |
| Sites that refuse every use | JR East, ecute, Odakyu Railway, Keio Railway, Odakyu SC, Keio SC | **Yes, and may be the sole source of a fact** | Corroboration only (unchanged). The same fact from another source, or from the Owner's own field reading, is used normally |
| The Owner's field readings and photos | #533 field run | Yes | Yes (OD-13, team_field) |
| Copies of official maps, PDFs, screenshots | Operator 構内図, ward guide maps | Reference copies for the Owner's private use (Copyright Act Art. 30), in the private repo only. Read for facts; never rendered, traced or shipped | Never |
| Data held for technical checks, not rights | S03 nav graph reason codes, R1 inferred CRS | Routable, labelled 「未検証」 | Existing gates (#557) |
| Data behind a sign-up | geospatial.jp downloads (OD-21), ODPT key | The Owner signs up personally; the data stays in P unless its terms allow redistribution | Per its terms |

Facts are not copyright works. What a terms-of-use clause can restrict is the use of the site's content, and the risk sits with distribution. P distributes nothing, so P uses every class. S keeps the existing facts-only rules except for the business-use row.

## Unchanged in every tier

- No logos, sign layouts, map drawings, photos or text copied into anything public.
- Workers do not sign up, log in, fill forms or contact anyone; no fake User-Agents.
- Unknown passages are never shown as walkable without a source. In P, "source" includes a private-tier source; the route says which.

## When rights are unclear

Record the source, the clause (quoted, with URL and date), and which tier it blocks. Then put the data in P, or find a substitute for S. Development does not stop. No new approval step: the data lead classifies new sources with this table, and the director rules only on a source that fits no row.

## Engineering

One engine and two data sets. A private overlay supplies `station.json`, `graph.json`, `pois.json` and `tenants.json` for a public station folder of the same name. Scene code and 3D assets stay public. A build with the overlay is a private build: it never runs in this repo's CI or deploy, and the public deploy refuses to run with an overlay set. Overlay data is generated in the private repo from the public bundle plus private additions, so public fixes carry over.

## Effect on earlier rulings

| Ruling | Change |
| --- | --- |
| #26 facts-only | Unchanged for S; P may also use flat-ban sites |
| OD-01 B (Tobu gate names) | S: facts only, `recheck-at-C`; P: yes |
| OD-02 A, OD-34 §1 (JR East) | S: unchanged; P: primary facts |
| OD-34 round 2 (Tobu §8), round 3 (そごう・西武) | S: facts only, `recheck-at-C` |
| OD-34 §3, round 5(a) (flat bans) | S: unchanged; P: primary facts |
| OD-17 (R1 context only) | P: routable with 「未検証」 |
| OD-21 (no sign-up) | Workers unchanged; the Owner may sign up and keep the data in P |
| #6, #342 | Unchanged; their "no public distribution of material without the right" rule is the S column |
