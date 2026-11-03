---
area: web-field
owner: merchant
updated: 2026-11-03 JST
---
# Web field recorder

`apps/web/field.html` is the Owner's phone recorder for the two public station walks. Its separate Vite entry imports public route Markdown, graph IDs and store POIs only; no explorer, private station roots or runtime data requests.

- `apps/web/src/field/route.ts` parses only Ordered walk stops, item lists and backtick IDs (including arrow-separated runs), stopping before the coverage table.
- `apps/web/src/field/data.ts` binds both real route files and public graph/store choices.
- `apps/web/src/field/main.ts` renders station selection, prev/next and progress, editable records, localStorage on every edit, and a station receipt Blob download.
- `apps/web/src/field/submission.ts` fills JST times and builds receipt-format v1. Unknown targets are flagged. CLOSED importer items require a known node, store POI and fare side; other confirmations remain OPEN with the original confirmation in an extra key. Unnumbered/FC observations go in fieldNotes; at least one numbered observation is required for an importer-compatible receipt. No numeric item IDs are invented.
- `apps/web/src/field/style.css` provides the phone layout and 48px controls.
- `apps/web/field-offline.ts` emits field-sw.js from the built field HTML and its dependencies. The worker caches only this page and those assets, including both stations' data. Offline readiness is displayed after installation; open once online before a field run. Records stay in localStorage after export.

Validation: route and submission unit specs beside the source; phone export, offline reload and station isolation in `tests/e2e/specs/24-field-recorder.spec.ts`. Existing importers accept extra keys; neither importer is changed. See [[web-merchant]], [[e2e]] and [[INDEX]].
