---
area: web-field
owner: merchant
updated: 2026-11-03 JST
---
# Web field recorder

`apps/web/field.html` is the Owner's phone recorder for the two public station walks. Its separate Vite entry imports public route Markdown, graph IDs and store POIs plus an optional build-time private overlay; no explorer or runtime data requests.

- `apps/web/src/field/route.ts` parses only Ordered walk stops, item lists and backtick IDs (including arrow-separated runs), stopping before the coverage table.
- `apps/web/src/field/data.ts` binds both real route files and public graph/store choices, unions overlay choices, and inserts private stops after their public anchor in file order.
- `apps/web/field-private.ts` serves `virtual:gteki-field-private`: empty without an overlay, otherwise reads each station's field/private-stops.json and overlay graph/shop choices.
- `apps/web/src/field/main.ts` renders station selection, prev/next and progress, editable records, localStorage on every edit, and station receipt Blob downloads. Private stops have a visible badge and saved observations retain their private marker.
- `apps/web/src/field/submission.ts` fills JST times and builds receipt-format v1. Unknown targets are flagged. CLOSED importer items require a known node, store POI and fare side; other confirmations remain OPEN with the original confirmation in an extra key. Unnumbered/FC observations go in fieldNotes; public-only export requires at least one numbered observation. Private-stop observations export separately with private: true, including GAP-only fieldNotes; they never enter the public receipt. No numeric item IDs are invented.
- `apps/web/src/field/style.css` provides the phone layout and 48px controls.
- `apps/web/field-offline.ts` emits field-sw.js from the built field HTML and its dependencies. The worker caches only this page and those assets, including both stations' data. Offline readiness is displayed after installation; open once online before a field run. Records stay in localStorage after export.

Validation: route and submission unit specs beside the source; phone export, offline reload and station isolation in `tests/e2e/specs/24-field-recorder.spec.ts`. Existing importers accept extra keys; private receipts may contain only fieldNotes. See [[web-merchant]], [[e2e]] and [[INDEX]].
