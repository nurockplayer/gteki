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

## Cloudflare setup

As confirmed by the owner on 2026-11-21 JST, the Pages project `gteki` uses
compatibility date `2026-10-20`, no flags, and had no other bindings or variables
in production or preview. `wrangler.jsonc` binds `FEEDBACK` to the
`gteki-feedback` KV namespace `2d3dfce144e044eeb0243067f070d4f3`.

The managed Turnstile widget permits `gteki.pages.dev` only. Its public sitekey
`0x4AAAAAAGLit66Rhdh-jRti` is the GitHub `production` environment variable
`VITE_TURNSTILE_SITEKEY` used by the production build. The private
`TURNSTILE_SECRET` is set in the Pages production environment and takes effect
on the next deploy. Preview has no secret and cannot accept feedback; the form
shows that feedback is unavailable. Do not put the secret in Vite or Git.

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

KV automatically deletes each record 90 days after submission. At the start of
each triage run, the command removes its own exports from the chosen directory
when their last modification was more than 90 days ago and their contents
match the recorded checksum in `.gteki-feedback-exports/`. Local downloads are
private developer copies. Delete them by the original submission deadline when
triage cleanup would run later or when a download has no matching checksum.
