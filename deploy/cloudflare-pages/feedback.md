# In-game feedback (J14)

The menu's Feedback entry opens a form. Only Send captures state and posts to
`/api/feedback`. Reports include the complete URL (query included), language,
station, device/viewport/touch, guide/free and camera mode, `next` query value,
cat ENU pose/heading, inferred floor (null between floors), simulation time in
seconds, build SHA and a canvas-only JPEG (long side at most 960 px, ≤200,000 bytes).
The form supports ja/en; `?lang=zh` selects Traditional Chinese feedback strings.

The Function stores one JSON record per report in `FEEDBACK` KV, with server UTC
creation time, UUID and `status: new`. Body cap: 300,000 bytes; message: 1–1000
characters; JPEG cap: 200,000 bytes. Basic per-IP limit: one report per minute,
using a SHA-256 IP key expiring after 60 seconds. KV consistency makes this limit
best-effort across locations/concurrent requests. Reports do not expire.
There is no public read endpoint; screenshots stay in the report until triage.

## Lead setup (not performed by the worker)

Create one namespace with the lead's existing Cloudflare credentials:

```sh
pnpm dlx wrangler@4.131.1 kv namespace create gteki-feedback
```

Replace the zero placeholder in the root `wrangler.jsonc` with the returned ID.
The existing root `wrangler pages deploy` command discovers this config and
`functions/`. No new runtime secret is needed. Keep the PR draft until this
binding is ready; deploying the placeholder cannot store feedback.
The config shape follows [Cloudflare's Pages configuration reference](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

## Local use

After the normal build, run from the repo root (local KV, no account changes):

```sh
pnpm dlx wrangler@4.131.1 pages dev deploy/cloudflare-pages/dist
```

Open the local URL, open the menu, choose Feedback, enter text and press Send.
Opening, typing and closing the form do not send anything.

## List new reports

With the lead's existing token permitted to read this KV namespace, set
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `FEEDBACK_NAMESPACE_ID`.
The command reads Cloudflare and writes local records/screenshots plus a linked
`index.md`. It does not mark entries read or create GitHub issues. Use the last
triage time as the first argument (ISO timestamp with zone):

```sh
node tools/feedback/list.mjs 2026-11-21T00:00:00Z .qa/feedback
```
