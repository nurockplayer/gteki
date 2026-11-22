# Project plan schema

`docs/release/plan.yaml` is the Owner-facing source. `pnpm plan:build` generates
`/plan` and the release journey table; `pnpm plan:check` validates the source and
checks that the journey table is current. Preserve the prose in `journey.md`.

- Top level: `schema_version: 1`, `project` (name), `state` (`ACTIVE` or
  `DORMANT`), `workstreams`, and optional `owner_decisions`.
- Each workstream has `id`, `title`, observable `outcome`, `lead`, `phases`
  (each with `id` and `title`), `current_phase`, `next_step`, and `criteria`.
  Optional `context` and `references` give the Owner relevant background; a
  reference has `label` and HTTPS `url`.
- Each criterion has a unique `id`, `requirement`, `judge`, and `status`:
  `PASS`, `FAIL`, `REVIEW`, `BLOCKED`, `NOT JUDGED`, or `STALE`. Optional
  `context`, `status_detail`, `references`, and `evidence` provide timing,
  recorded judgement and links. Evidence is a list of `label` and HTTPS `url`.
  For PASS, `verified_at` (with timezone), `verified_sha`, and at least one
  evidence link are required. A merged PR or green CI alone is never PASS.
  The page derives counts from statuses; do not store counts in the YAML.
- An owner decision has `id`, `question`, `options`, `recommendation`,
  `deadline` (with timezone), and `state` (`OPEN` or `ANSWERED`). ANSWERED
  also requires `answer` (one of the options) and an HTTPS `answer_ref` link.
  Only OPEN decisions appear in the waiting section. Example:

```yaml
owner_decisions:
  - id: DEC-1
    question: Which outcome comes next?
    options: [A, B]
    recommendation: A
    deadline: 2026-11-30 JST
    state: OPEN
```

When answered, set `state: ANSWERED`, `answer`, and `answer_ref`. This example
is documentation only and does not appear on the page.
