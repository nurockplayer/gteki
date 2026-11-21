# In-game feedback (J14)

The menu's Feedback entry opens a form. Only Send captures game state and posts
it to `/api/feedback`; Turnstile contacts Cloudflare when the form opens. Reports
include language, station, device/viewport/touch, guide/free and camera mode,
normalized `next` (boolean), cat ENU pose/heading, inferred floor (null between
floors), simulation time in seconds, build SHA and a canvas-only JPEG (long side
at most 960 px, ≤200,000 bytes). The URL includes only `station`, `from`, `to`,
`lang`, and `next=1`; fragments and other query parameters are removed on both
client and server. `?lang=zh` selects Traditional Chinese feedback strings.

The Function rejects Content-Length over 300,000 bytes before reading, cancels
stream reading as soon as the same byte ceiling is exceeded, and limits text
to 1–1000 characters. It verifies Turnstile using Siteverify before any KV write,
requiring success, the request's hostname and action `feedback`; verification
errors reject the report. IP is passed briefly to Siteverify when Cloudflare
provides it, and no IP or IP hash is stored. There is no KV cooldown marker.
A failed report write returns 503; retry obtains a fresh Turnstile token.

Each successful report is one JSON record in `FEEDBACK` KV, with server UTC
creation time, UUID, `status: new`, and `expirationTtl: 90 * 86400` (7,776,000
seconds). Only a completed write returns 201. The token is never persisted.
There is no public read endpoint. The ja/en/zh form notices use the review's
section 3 disclosure sentences; a privacy-details link needs an owner-supplied
destination and is not invented here.

## Owner setup (not performed by the worker)

1. Create the namespace using authorized Cloudflare credentials:

   ```sh
   pnpm dlx wrangler@4.131.1 kv namespace create gteki-feedback
   ```

2. Before deploying, reconcile the root `wrangler.jsonc` against the existing
   Pages project's dashboard configuration. It currently sets exactly:
   `name: gteki`, `pages_build_output_dir: deploy/cloudflare-pages/dist`,
   `compatibility_date: 2026-11-21`, and one KV binding `FEEDBACK` with a zero
   placeholder ID. It defines no vars, secrets, other bindings, compatibility
   flags or preview overrides. Adding this file makes it authoritative: compare
   current production **and preview** bindings/vars, compatibility date/flags,
   and build output settings; carry all required existing settings forward
   before applying it. Replace only the placeholder with the created namespace
   ID after reconciliation; ensure `FEEDBACK` binds to that namespace in the
   intended Pages environments. No production settings were read or changed by
   this worker. See [Cloudflare's Pages configuration reference](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

3. Create a managed Turnstile widget allowing `gteki.pages.dev` and only the
   exact preview/custom hostnames that will receive feedback. Do not add local
   domains to the production widget. Set its public sitekey as the GitHub
   `production` environment variable `VITE_TURNSTILE_SITEKEY`, used by the
   existing Actions build (this site is built in Actions, not the Pages
   dashboard). For example:

   ```sh
   gh variable set VITE_TURNSTILE_SITEKEY --env production --body '<public-sitekey>'
   ```

4. Add the widget's private secret only to Pages runtime as `TURNSTILE_SECRET`,
   including the intended preview environment if used:

   ```sh
   pnpm dlx wrangler@4.131.1 pages secret put TURNSTILE_SECRET --project-name gteki
   ```

   Never put this secret in Vite, GitHub's public build variables, or Git.
   Missing sitekey disables Send; missing/invalid secret rejects submissions.
   Keep the PR draft until setup is reconciled; do not deploy the placeholder.

## Local/CI use

Use [Cloudflare's published test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/):
public `1x00000000000000000000AA`, server secret
`1x0000000000000000000000000000000AA`. The E2E Actions build uses the public
test sitekey. For a local build set it explicitly:

```sh
VITE_TURNSTILE_SITEKEY=1x00000000000000000000AA pnpm build
```

Place the published test secret in local `.dev.vars` (not a production secret):

```sh
printf 'TURNSTILE_SECRET=1x0000000000000000000000000000000AA\n' > .dev.vars
pnpm dlx wrangler@4.131.1 pages dev deploy/cloudflare-pages/dist
```

Test Siteverify returns hostname `example.com` without an action. That exact
response is accepted only for the published passing test secret on loopback
`localhost`/`127.0.0.1`. Production always requires its hostname and `feedback`
action; the test keys do not enable a production verification bypass.
Opening/typing/closing sends no report; the widget itself connects to Cloudflare.

## List new reports and retention

Set `CLOUDFLARE_ACCOUNT_ID`, a private read-capable `CLOUDFLARE_API_TOKEN`, and
`FEEDBACK_NAMESPACE_ID` in the developer's local environment. The command reads
Cloudflare and writes local JSON/JPEG files plus a linked `index.md`. It does not
mark entries read or create GitHub issues. Pass the last triage time with zone:

```sh
node tools/feedback/list.mjs 2026-11-21T00:00:00Z .qa/feedback
```

KV automatically deletes each record 90 days after submission. Local downloads
are private developer copies: delete them by the same original submission +
90-day deadline, or earlier after triage; the generated index repeats this
retention reminder. This command does not automatically delete local files.
