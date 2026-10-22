# CI and review limits

What limits the GitHub checks and the review bots put on a PR, and how to work within them. The review policy itself lives on Issue #6; this page records the hard limits behind it. Last checked 2026-10-22.

## Rules for every PR

- **At most 100 changed files per PR** (Owner rule, #6). CodeRabbit skips anything larger, so split big work into stacked PRs. Check before opening or pushing: `git diff --name-only origin/main...HEAD | wc -l`. #61 is grandfathered.
- **Push once, when the PR is ready.** Each push to an open PR costs a CodeRabbit review event (see below). Squash local fix-ups into one push.
- **Required checks on `main`:** `test` and `root-test`. Branch protection is not strict, so a PR does not have to be up to date with `main`; the merge lead test-merges on current `main` instead.
- **Merge with `gh pr merge N --merge --match-head-commit <sha>`**, so an unreviewed push cannot slip in.

## GitHub checks

| Check | Workflow | Runs on | Timeout | Required | Notes |
| --- | --- | --- | --- | --- | --- |
| `test` | `gis-test.yml` | every PR; push to `main` (paths) | 10 min | yes | GIS tools tests, Node 26 |
| `root-test` | `root-test.yml` | every PR; push to `main` | 20 min | yes | frozen install, workspace typecheck, default vitest (`*.heavy.test.ts` excluded) |
| `e2e-smoke` | `e2e-smoke.yml` | PRs | job 20 min, test step 10 min | no | see below |
| `reuse` | `reuse.yml` | PRs; push | 10 min | no | REUSE licence lint |
| deploy | `deploy-pages.yml` | push to `main` | — | — | Cloudflare Pages; every merge to `main` deploys |

- **Heavy suites never run in CI.** `*.heavy.test.ts` (Shinjuku fare replay, Ikebukuro walker replay, ray BVH) run locally in an OrbStack box via `pnpm test:heavy:box`.
- **A PR opened before a workflow existed has no run of it.** Push or merge `main` into the branch to trigger it; a required check that never reports blocks the merge.
- **`e2e-smoke` runs WebGL on SwiftShader (software GL, about 7 fps).**
  - Under `CI=1` the desktop project uses 960×600, which puts the explorer on its low-quality path, and records no video.
  - Guided walks run flow-only (`GTEKI_GUIDE_FLOW_ONLY=1`): no screenshots or image statistics inside the walk loop (#118). Screenshots under SwiftShader time out at 15 s.
  - Arrival, distance and visual checks belong to GPU runs (local Brave/WebKit), not CI.
  - It becomes a required check after a week without flakes from the #118 merge (#76, check about 2026-10-29).

## CodeRabbit (free OSS plan)

gteki is a public repository with 0 stars, so it gets the **lowest open-source tier**. The limits below are from CodeRabbit's docs ([plans](https://docs.coderabbit.ai/management/plans), [review limits](https://docs.coderabbit.ai/management/rate-limits)) and from what the bot actually posted on this repo.

| Limit | Value for gteki | Source |
| --- | --- | --- |
| Auto review | **off**: public repos under 10 stars must trigger reviews by hand with `@coderabbitai review` | docs |
| PR reviews | **about 1 per hour per developer** (OSS range is 1–10, by star count) | docs; observed "Review limit reached … Next included review available in 59 minutes" (#118) |
| Files per review | **100**; larger PRs are skipped entirely | observed "This PR contains 111 files, which is 11 over the limit of 100" (#61) |
| Chat (`@coderabbitai` questions) | 25 | docs (OSS table) |
| IDE / CLI reviews | 1 / 3 per hour | docs (OSS table) |
| Refill | rolling window: an allowance comes back as an earlier review ages out, not at a fixed reset | docs |
| Adaptive throttling | heavy users get a slower refill; on paid plans "1 review/hour, one review at a time" after 60–80 reviews in 7 days | docs |

What counts as one review event:

- opening a PR;
- **each push** to an open PR, however many commits it carries (three commits in one push = 1; pushed one at a time = 3);
- `@coderabbitai review` or `@coderabbitai full review`;
- a GitHub web-UI edit, branch update (including "Update branch"), conflict resolution, force-push, rebase, reopen, or marking a draft ready.

**All lanes share one quota.** The limit is per developer, and every session pushes and comments as `nurockplayer`, so the whole project has about one CodeRabbit review an hour.

How we use it (#6):

1. The Codex review bot is the primary reviewer; CodeRabbit is the second opinion.
2. Trigger CodeRabbit **once, at the final head**, after Codex is clean and CI is green, and only for core/web, routing/walkability, rights/attribution or large station PRs. Skip docs, evidence, config and test-only PRs.
3. If it answers "Review limit reached" or "Review skipped", merge on the Codex result and say so in the PR. Do not re-trigger in a loop.
4. A P0/P1 from either bot blocks the merge; P2/P3 may become follow-ups.
5. CodeRabbit's run summary may say "Plan: Advanced"; the open-source review limits above still apply.

## Codex review bot

- It reviews automatically on PRs. Its state is in the `codex-review-state` marker in the PR comments; merge only when its `commit_sha` is the PR head and `has_unresolved_findings` is false (or the only open findings are accepted P2/P3 follow-ups).
- Re-trigger with `@codex review` only after fixing a P0/P1.
- If it is stuck for about 30 minutes, an independent read-only Claude review by a subagent that did not write the code may stand in, labelled as such on the PR.
