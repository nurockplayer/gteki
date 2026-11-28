# GTEki documentation placement — public repository

Status: document-location policy (2026-11-03). This file sets where to keep knowledge, not how to implement a feature.

- **Public `gteki/docs/`:** approved, publishable product vision, gameplay principles, non-spoiler world summaries, architecture, acceptance criteria, and reusable public research. Use plain Markdown in Git; keep related source and licensing evidence where the existing docs require it.
- **Private `gteki-private/docs/`:** unreleased plot details and endings, character backstories, story drafts, confidential business plans, and other material not approved for publication. If publication status is unclear, start private and ask the Owner before moving anything here.
- **One canonical location per document:** do not maintain competing full copies in GitHub Issues and Notion. Issues and PRs track decisions, implementation, reviews, and status, linking to the canonical Markdown document. Notion may be used as a working canvas, not the only authoritative copy.
- **Keep reality separate from fiction:** real station geometry, GIS, routes, POIs, source rights, and uncertainties remain evidence-based. Fictional cat routes, events, and locations must not become passenger navigation facts.
- **Publishing boundary:** do not copy private documents, restricted sources, personal data, spoilers, or unpublished assets into this public repo, a public PR/Issue, public CI artifacts, or deployments without an explicit release decision.
- **Portability:** keep a full local Git clone and an independent backup. GitHub Issues, PR discussions, and hosted attachments need separate exports if those histories must also survive a platform failure.

Related: [product vision](product-vision.md), [GTEki 2.0 tracking](https://github.com/nurockplayer/gteki/issues/625). Claude Code chooses implementation details from the current repo and product decisions; this policy does not prescribe an engineering plan.
