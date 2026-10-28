---
area: web-merchant
owner: gteki-fa
updated: 2026-10-26 JST
---
# Web merchant form (self-service submission)

## What it does
A second Vite page, `apps/web/merchant.html`, lets a shop describe itself for a station: name, category, floor, nearest entrance anchor, hours, URL, contact and consent. It runs fully in the browser and builds a JSON file the shop downloads or copies; nothing is posted and nothing is stored. The receiving side assigns the source id later. The page does not load the explorer's bundle (a separate Rollup input in `apps/web/vite.config.ts`).

## Main files and functions
- `apps/web/merchant.html` — the page shell; the element `#merchant` is where `mount()` renders.
- `apps/web/src/merchant/main.ts:84-294` — mount(): the whole form, render and re-render, validation messages, copy and download buttons.
- `apps/web/src/merchant/main.ts:55-61` — choicesOf(): floors and anchors offered by a station's manifest and POIs.
- `apps/web/src/merchant/main.ts:63-77` — loadStations(): the station list from the same virtual module as the explorer.
- `apps/web/src/merchant/main.ts:80-82` — submissionFile(): the JSON text of a submission.
- `apps/web/src/merchant/main.ts:276-281` — the download handler: a Blob with a file name based on the station folder and request id.
- `apps/web/src/merchant/main.ts:24-44` — labelled(), textInput(), textArea(): form control helpers.
- `apps/web/src/merchant/form-state.ts:32-34` — newFormState(): one state per page (language, draft, clock).
- `apps/web/src/merchant/form-state.ts:37-43` — withLang(), withDraft(): immutable updates.
- `apps/web/src/merchant/form-state.ts:49-56` — withConsent(): stamps the consent time once, when the box is ticked.
- `apps/web/src/merchant/form-state.ts:62-65` — withStation(): changes the station and keeps the draft.
- `apps/web/src/merchant/form-state.ts:24-27` — newRequestId(): the client request id, made once per form session.
- `apps/web/src/merchant/submission.ts:12-28` — schema id, terms version (2026-10-24), license id, categories, inside-gate and contact kinds.
- `apps/web/src/merchant/submission.ts:57-63` — emptyDraft(stationId).
- `apps/web/src/merchant/submission.ts:110-140` — validateDraft(): returns the problem list (codes, not text).
- `apps/web/src/merchant/submission.ts:177-205` — buildSubmission(): the submission object; refuses a floor not offered by the station, and a missing consent time.
- `apps/web/src/merchant/labels.ts:118-120` — merchantLabels(lang): the ja and en strings.
- `apps/web/src/merchant/labels.ts:123-126` — problemText(lang, code); `129-131` consentText(lang, version).
- `apps/web/src/merchant/form.css` — the form's styles, loaded only by this page.

## Data flow
- Station and POI choices: `loadStations()` reads the registry's virtual module, then `choicesOf(manifest, pois)` builds the floor and anchor lists.
- Form: each control calls `withDraft` / `withConsent` / `withLang`, then `render()` re-draws from `state`. A re-render never resets the clock or the request id.
- Validation: `validateDraft(draft, choices)` gives problem codes; `problemText` turns them into text.
- Output: when valid, `buildSubmission(draft, choices, meta)` gives the object; `submissionFile` makes the JSON text; the copy and download buttons use it. The download handler (main.ts 276-281) makes a Blob and a link.
- Language: `initialLang()` from `apps/web/src/i18n.ts` picks the start language. The consent text is versioned by `MERCHANT_TERMS_VERSION`.

## Tests CI runs
- Root test job: `pnpm typecheck`, then `pnpm vitest run --maxWorkers=2`. Picks up the tests in apps/web/src/merchant (form-state, labels, submission) and `apps/web/src/ui/app.merchant.test.ts` (the wiring test for the card and the form).
- Local, one area only: `pnpm vitest run apps/web/src/merchant`. Run the full CI command first.
- Through the container: `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.
- The merchant page is built by `pnpm build` (two inputs in `apps/web/vite.config.ts`).

## Pitfalls
- No fetch, no post, no storage. The header comment in `main.ts` says so. Do not add a network call or localStorage without a product decision.
- The request id and the clock live in the state, not the render. A language switch re-creates every control, so state must be read, never regenerated (#438 review, `c943d165`).
- A submission can only name a floor the station lists (`buildSubmission` throws otherwise).
- Consent is stamped once, when ticked, and `consentAcceptedAt` must be set before a submission is built.
- A shop's own point is not a verified entrance. Do not treat the chosen anchor as a verified connector.
- Bump `MERCHANT_TERMS_VERSION` only with the legal text. The consent text is keyed by it.
- The page must not import the explorer. Keep it out of the explorer's modules to keep its bundle small.

## Related PRs and issues
- #438 — merchant self-service: spec (PR #440, Phase 1), client-side form and submission format (PR #473, Phase 2, `bbe87052`), clock and request id kept across re-renders (`c943d165`).
- #211 — merchant source inventory, Ikebukuro then Shinjuku (PR #360).
- #212 — Ikebukuro B1 merchant coverage audit (PR #472).
- #213 — shop category filter and merchant card (PR #480); shop point is not a verified entrance (`6c30c13d`).
- #441 — tenant evidence accepts a reusable data source (PR #456).
- OD-32 — printed shop hours, dated official pages only (PR #459).
- See [[web-ui]] for the shared app shell and cards, [[web-explorer]] for the 3D view, [[pkg-schema]] for the station files the submission targets, and [[INDEX]].
