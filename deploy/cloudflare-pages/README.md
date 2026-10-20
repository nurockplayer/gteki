# GTEki — Cloudflare Pages

Deployment-only candidate. No product PR is merged and no navigation, rights, L2 or acceptance HOLD is lifted here.

## Current blockers (2026-10-20 UTC)

- Live main at inspection: `eeaf317775f3ecd3f84cbc07fc1e162c41e451a3`. It has docs/GIS, **no root Web workspace**. #15 (`1ba8186993c0a7d24beb4b8d87cde108b9ed79cf`) is open. Owner/product lanes must handle any product merges separately.
- No existing Cloudflare API credentials, Wrangler login or Cloudflare connector is available in the execution environment. Dashboard account/project/Git integration state is unverified. No credential or OAuth grant was created. Parent may inspect the already signed-in cloud browser.
- The exact #15 core candidate `1ba8186` has a [blocking final merge gate FAIL](https://github.com/nurockplayer/gteki/pull/15#issuecomment-6301032088): timed-route labels, narration and required credit metadata remain incorrect. Its local artifact is **internal build evidence only**, not publication-eligible, including as a public demo. No failing unmerged core is adopted or deployed here.
- Station content is not automatically cleared by a code merge. `release-policy.json` initially admits **no real stations**. Ikebukuro #14 and Shinjuku #16, QA #20 and acceptance #6 retain their respective HOLD/GAP/FAIL states. Never edit this policy as a substitute for the missing publication decision.

## Existing authorized Git integration: desired dashboard configuration

Inspect the existing Pages project first. Use the existing permitted GitHub integration for **only** `nurockplayer/gteki`. If adding an installation, repository permission or new persistent access is requested, stop for action-time approval. Do not create a same-name Direct Upload project as a workaround.

| Setting | Value |
| --- | --- |
| Product | **Pages**, static site (not Workers) |
| Production branch | `main` |
| Production automatic deployments | Enabled |
| Preview branch deployments | Disabled (unreviewed station branches must not become public previews) |
| Framework preset | None |
| Root directory | Repository root |
| Build command | `node deploy/cloudflare-pages/build.mjs` |
| Build output directory | `apps/web/dist` |
| Build system | v3 |
| `NODE_VERSION` | `24.19.0` |
| `PNPM_VERSION` | `12.11.2` |
| `SKIP_DEPENDENCY_INSTALL` | `1` |
| `GTEKI_STATION_ROOTS` | Unset |
| Build watch paths | Default/all paths; no accidental deployment exclusion |

No secrets, paid services, plan upgrades, R2 storage or Functions are needed. Do not add `wrangler.jsonc`: a static Git-integrated Pages build is configured in its project settings, and this change needs no Wrangler dependency or account IDs in Git.

The script uses **only `corepack pnpm@12.11.2`**, a frozen lockfile, then typecheck, single-worker Vitest and the existing Web build. It reads actual cgroup limits/usage before every command and during execution. Missing monitoring, low headroom, a non-main Cloudflare checkout or any rejection stops the operation. A process-group stop terminates active children. A temporary lock serializes this deployment runner; coordinate with other lanes so no independent heavy job is running. An existing lock is a stop condition; inspect its owner instead of deleting it blindly.

Cloudflare's image must expose the required cgroup files. This is intentionally **unverified until a real Pages build**. If unavailable, stop and report the monitoring gap; do not disable monitoring to force a successful build.

## Publication boundary

The existing `apps/web/stations-plugin.ts` remains the only station build/asset implementation; this deployment branch does not modify it. Its production validation and declared-asset fence still apply. External station roots and an unreviewed `apps/web/public` directory are refused. A station additionally needs a policy record keyed by folder, matching `git rev-parse HEAD:stations/<folder>`:

```json
{
  "treeSha": "<exact approved Git tree SHA>",
  "publicationApproved": true,
  "evidence": "https://github.com/nurockplayer/gteki/issues/<number>#issuecomment-<id>",
  "expiresAt": "<explicit approval validity boundary in ISO-8601 UTC>"
}
```

Only add such a record after the station/content owner supplies that actual publication decision and rights evidence. Changes to any file in the station tree require fresh admission. An expiry is an approval recheck boundary, **not a claim that the underlying reuse licence expires**. Unknown/unapproved stations fail the whole build; no content is silently dropped. The core's built-in synthetic demo is labelled as fictional and non-navigational by the existing UI. Build success does not establish L2, valid real-world routes, or Owner acceptance.

`core` is initially `null` because the shared candidate's merge/publication gate is FAIL. A real Cloudflare build also requires a core approval record with `publicationApproved`, `evidence`, `expiresAt` and `trees: {web, packages, lockfile, rootConfigHash, deploymentToolHash}`. The first three match `git rev-parse HEAD:apps/web`, `HEAD:packages` and `HEAD:pnpm-lock.yaml`. `rootConfigHash` is SHA-256 of root blob entries from `git ls-tree HEAD` (except `README.md`), joined by newlines without a trailing newline: it binds package scripts, workspace selection, TypeScript/Vitest config and other root build inputs. `deploymentToolHash` binds this runner's bytes. Use the exact preflight/receipt values; never guess them. This permits documentation-only main updates after admission while requiring readmission of changed product/build code or dependencies. Local builds may produce **internal evidence** with `coreApproved: false`; their receipt explicitly prohibits deployment. Do not fill in core approval from build/test success or from a code merge alone.

Deployment adds `THIRD_PARTY_NOTICES.txt` from the installed three.js and Vite licences plus the meshoptimizer decoder's own copyright and MIT permission notice. Minified JavaScript alone does not retain those notices. These notices do not clear the core's remaining source-attribution FAIL.

The output verifier enforces Free-plan limits (20,000 files including receipt, 25 MiB per file), refuses output symlinks/Worker code and checks relative HTML asset references. Vite already uses `base: "./"`; no `/gteki/` GitHub Pages prefix or catch-all rewrite is needed. Only `apps/web/dist` is published: never upload the repository, GIS store, raw datasets, QA evidence or source worktrees.

`apps/web/dist/deployment-build.json` binds the output file SHA-256 inventory to the source commit, deployment script hash, policy hash and monitored resources. It is a **build receipt**, never a Cloudflare deployment receipt. Local validation can run from a clean, isolated core worktree using this script's absolute path; that artifact remains an **unmerged candidate**, and its receipt explicitly says deployment is unverified.

## Final runtime verification and handoff

After an authorized product merge and this deployment configuration reach main, use the above existing permitted Git integration. Each main push triggers a build and updates production only if all publication/resource/build checks pass. A rejected build must retain the prior deployment; do not retry by omitting a gate.

Read back and retain the Cloudflare project ID/name, deployment ID, deployment URL, production alias, `main` source SHA and final success status. Fetch `/deployment-build.json` from both URLs and compare `sourceSha` and file hashes. Load the actual page in a browser; verify the visible demo/unverified warning, JavaScript/CSS requests and absence of leaked held stations. Record a separate real main-triggered deployment before claiming automatic updates are verified. Do not push a fake product change just to trigger it.

If no authorized account integration or publishable main exists, report HOLD with those exact missing conditions, and preserve this branch, artifact and evidence using the supported Library upload flow. No invented `gteki.pages.dev` URL and no acceptance execution claim.

Official references checked 2026-10-20: [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [build image / version and install overrides](https://developers.cloudflare.com/pages/configuration/build-image/), [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
