# Merchant submission format `gteki.merchant-submission/0.1`

The file a shop hands to GTEki after filling in the merchant form (#438 Phase 2). It carries the facts the
shop states, and nothing else. The design rationale is
[`docs/research/merchants/merchant-self-service-spec.md`](../research/merchants/merchant-self-service-spec.md);
this page is the shape that the form writes and the receiving side reads.

- Form: `apps/web/merchant.html` (`apps/web/src/merchant/`), a second Vite entry that loads none of the
  explorer. **It sends nothing**: no fetch, no storage, no endpoint. The shop saves the JSON and hands it over.
- Receiving side: not built yet. It assigns the submission id, runs the spec's §5 automatic checks and
  writes the station data at the next merge.

## The document

```json
{
  "schema": "gteki.merchant-submission/0.1",
  "clientRequestId": "<uuid the form generated>",
  "submittedAt": "<ISO timestamp from the shop's device; provisional>",
  "station": { "id": "shinjuku", "folder": "shinjuku" },
  "shop": {
    "names": [{ "lang": "ja", "text": "看板のとおりの店名" }],
    "aliases": [{ "lang": "ja", "text": "よみがな" }],
    "category": "shop",
    "facility": "南館"
  },
  "location": {
    "floorId": "toei-nwd-m1",
    "anchor": { "poiId": "poi:gate:1", "wording": "〇〇改札付近" },
    "insideGates": "outside"
  },
  "hours": { "text": "10:00–20:00", "asOf": "2026-10-24" },
  "url": "https://example.co.jp/shop",
  "contact": { "kind": "email", "value": "shop@example.co.jp" },
  "consent": { "termsVersion": "2026-10-24", "accepted": true, "acceptedAt": "<ISO timestamp>" }
}
```

| Field | Rule |
| --- | --- |
| `clientRequestId` | The form's own id, so a resent file can be recognised. **Never** used as the source id. Generated once per form session and kept through every re-render and language switch. |
| `submittedAt` | The device clock. The receiver records its own receipt time; a disagreement is an anomaly flag (§5.4). |
| `station.id` / `station.folder` | `station.id` from the station's `station.json`; `folder` names the directory, so the receiver finds the bundle. |
| `shop.names` | Exactly one entry: the language and the name as printed. No translation, no invented romaji. |
| `shop.aliases` | Only what the shop states, one entry per line. |
| `shop.category` | One of `shop`, `locker`, `atm`, `service`, `toilet` — the shop-like categories, never a station structure such as `exit` or `platform`. |
| `shop.facility` | A facility or building name as written; `null` when none. Stored as a note, never as a `Floor`. |
| `location.floorId` | A `Floor.id` picked from the station's own floor list (`Floor.displayNames`). Floors are operator-scoped; the picker never equates them. |
| `location.anchor` | A nearby `exit` / `ticket_gate` POI id plus the shop's own wording, or `null`. **Notes only**: never a `displayPosition`, never a connector. |
| `location.insideGates` | `inside` / `outside` / `not_sure`. It becomes a note; `Poi.paid` stays `null`. |
| `hours` | Free text plus the date it is from; `null` when the shop gives none. Text without a date, or a date without text, is a validation error: a dated statement is all we publish, never "open now" (OD-32). |
| `url` | The shop's own page, `http(s)` only, or `null`. |
| `contact` | One point: e-mail or phone. It must stay out of every public file; the receiver keeps it in the private acceptance record only. |
| `consent` | The terms version the shop ticked, and `acceptedAt`: the moment the box was ticked (kept through re-renders and language switches, cleared by unticking), never the preview time. The receiver refuses a version it does not hold. |

The document has no field for a position, a connector, a route, `paid`, or an open/closed status. A submission
never creates a route and never claims current status.

## From receipt to station data

The receiving side (not built) adds four values and derives the rest:

| Added by the receiver | Value |
| --- | --- |
| `submissionId` | `msub-<station>-<n>`, never reused. |
| Acceptance record | The public issue/comment URL and its date. |
| Terms page | The public, versioned terms page the grant points at. |
| Automatic checks | The spec §5 results, stored in the private queue. |

Building the `Source` entry, the `evidence.method` prefix and the submission receipt is the receiving side's
work (`docs/research/merchants/merchant-self-service-spec.md` §5–§6), not this form's.

The form never writes station files: the station writer merges the submission and leaves `connectorNodeIds`,
`displayPosition` and `paid` as they are until entrance evidence is aligned.

## Not in this version

- No back end, queue, rate limit or duplicate check: those are the receiver's, and their absence is why the
  page says plainly that nothing is sent.
- No floor-plan tap picker (spec §8 option B) — that needs a GTEki-owned schematic first.
- No photos, promotions, logos or prices (OD-31).
