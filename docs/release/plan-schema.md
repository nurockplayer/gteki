# Plan source and schema (version 1)

Edit only `docs/release/plan.yaml` for plan content. Run `pnpm plan:build` to regenerate
`journey.md` and `deploy/cloudflare-pages/dist/plan/index.html`. Commit the YAML and
journey document together. Root CI and the Pages build run `pnpm plan:check`, which
validates the schema and fails if the journey document is out of date. The Pages
build generates `/plan` after the app build; it is not linked from the game UI.

The schema is enforced by `validatePlan` in `tools/plan/build.mjs`:

- `version: 1`, `title`, `decisions`, `workstreams`, and `journey` are required.
- Workstreams have unique `id`, `title`, observable `goal`, `lead`, `phases`
  (`id` + `title`), `current_phase`, `open_prs` (label + HTTPS URL), `next_step`,
  and `criteria`. Optional `notes`, `sources` and `rulings` provide context.
- Criteria have globally unique, stable `id`, unchanged `requirement`, `judge`,
  `status`, `date`, and `evidence`. Allowed statuses: PASS, FAIL, REVIEW, BLOCKED,
  NOT JUDGED, STALE. Evidence entries have `label`, HTTPS `url`, `sha`, and `date`.
  Unknown historical SHAs and dates stay null and display as not recorded.
- PASS requires a non-empty judge, a zoned date and at least one evidence link.
  A merged PR or green CI alone is never PASS; the judge records acceptance.
  Date strings include JST, UTC or an explicit ISO timezone. Date-only historical
  records are labelled JST; no missing time or SHA is invented.
- RELEASE criteria also have `when` and verbatim `status_text` for the journey
  table. `journey` holds the original five `columns`, `separator`, and prose
  `before_table` / `after_table`, preserving the document byte for byte. Historic
  pass-count prose stays historic; the page calculates current counts from rows.
- STATIONS rows are reusable gates, not a claim that either station passed them.
  Record each station's independent acceptance before changing a status.
- DEPATO uses one set of shared art rules and judging items for both stations.
  Exterior is the current phase; the interior pilot and floor data run alongside it.

Owner decisions are shown only while `answer` is absent or null. Example (schema
illustration only; there is no pending decision in the live plan):

```yaml
decisions:
  - id: DEC-1
    question: Which station should receive the next accepted slice?
    options: [Shinjuku, Ikebukuro]
    recommendation: Shinjuku
    blocks: Selection of the next slice
    asked: 2026-11-22 JST
    answer: null
```

The Owner replies in chat `DEC-1: Shinjuku`; a lead records `answer: Shinjuku` in a
PR. The resolved record remains in the YAML and leaves the waiting section.

Migration snapshot: main `78fa4aec` (2026-11-22 JST). J12 is PASS in that snapshot,
so the current release count is 9/14; the older 8/14 prose is retained verbatim.
