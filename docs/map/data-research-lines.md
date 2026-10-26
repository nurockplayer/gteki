---
area: data/research/lines
owner: data-research lead
updated: 2026-10-26 20:40 JST
---

# Lines research: gap table, field run, field receipts

## What it is

`docs/research/lines/` is the data lane's working record for the rail lines and department stores at Ikebukuro and Shinjuku: what is already in the game, what is still missing, and what only an on-site look can settle. It is docs plus small contract JSON; the station generators read the contract JSON, nothing else here is imported.

Three documents carry the state:

- **Gap table**: what exists (DONE / PARTIAL / NONE) for each line and store, and what blocks the rest.
- **Field run**: the residue the desk could not close, as numbered items with a "CLOSED when" test, in walking order for the Owner's visit.
- **Field receipts**: what the Owner actually read on site, in a fixed JSON format, which the importers apply.

Issue **#533** is the tracker for every field item: the field run is its checklist, receipts are its evidence, and each item closes on #533 when a receipt for it is imported.

## Main files

| Path | Role |
| --- | --- |
| `docs/research/lines/gap-table-2026-10-25.md` | Status block (top) + Table A lines, Table B stores, notes (Toei exit attribution, S03 HOLD), PENDING terms in Owner priority |
| `docs/research/lines/gap-table-2026-10-25-poi-ids.md` | POI id lists behind the table rows |
| `docs/research/lines/field-run-2026-10-26.md` | 55 items; "The whole visit, in order" = route, tickets, 2-day split |
| `docs/research/lines/{ikebukuro,shinjuku}-line-pois*.json` + `*-contract.md` | Line POI contracts read by the generators |
| `docs/research/lines/transfer-facts-wp11.json` | Transfer facts |
| `docs/research/lines/jr-corroboration-od34.json` | JR names held as corroboration only (OD-34 §1) |
| `docs/research/lines/ikebukuro-segments-online-2026-10-26.md` | Online pass on Ikebukuro segments: none closable (#540) |
| `docs/research/lines/s03-*-2026-10-26.md` | S03 desk residue: reason codes, `dz` locate, Check B control points |
| `docs/research/field/receipt-format.md` | Receipt schema and rules |
| `docs/research/field/*-field-checklist.md`, `*-online-closures-2026-10-25.md`, `*-route.md` | Original walking frame (#493) and online closures (#512) |
| `docs/research/merchants/store-entrances-2026-10-25.md` | Store entrance ties that became field items (#529) |

## How data flows

```
desk research (sources per OD-34) ─▶ contract JSON ─▶ generators ─▶ search-only POIs
          │                                                         │
          └─ gap table: what is missing ─▶ field run: what needs eyes (#533 items)
                                                   │ Owner visit
                                                   ▼
            docs/research/field/receipts/<YYYY-MM-DD>-<station>.json
                                                   │
       Shinjuku: import:e27 reads all receipts  ·  Ikebukuro: import_field_receipt.ts <file>
                                                   ▼
                     POI connectors / floor / position ─▶ routable; item closes on #533
```

- A receipt item is `CLOSED` or `OPEN`, with `observedText`, `observedAt` (zoned), and optional `poiId`, `nodeId`, `paid`, `floorLabel`, `stepFree`. `sourceKind` is `team_field`; `observer` is a role, never a name.
- Connectors are additive: every CLOSED item adds its node. A wrong tie is fixed by editing or deleting the earlier receipt item; a later receipt does not supersede it.
- A field note confirms what was seen; it does not raise a fact's public source count. The data lane decides what gets imported.
- No receipt exists yet (`docs/research/field/receipts/` is created by the first one); the visit date is the Owner's.

## Commands

No generator lives here. After a receipt lands, regenerate and test as in [station data](data-stations.md):

```sh
pnpm --filter @gteki/station-shinjuku import:e27 && pnpm --filter ./stations/shinjuku bake:surface
pnpm exec tsx stations/ikebukuro/pipeline/import_field_receipt.ts docs/research/field/receipts/<date>-ikebukuro.json
orb-test --memory 3g -- pnpm vitest run stations/shinjuku/test/field-receipts.test.ts stations/shinjuku
orb-test -- pnpm vitest run stations/ikebukuro/pipeline/import_field_receipt.test.ts apps/web/src/search-stations.test.ts
```

## Pitfalls

- **The gap table goes stale fast.** Its Status block names the basis SHA and time; refresh it in the same PR that changes POIs, or note the rows that are stale (Keio/Takashimaya/Subnade rows lagged #539).
- **Field-run items are numbered for good.** Add new items at the end (50–55 were added after the route was set); never renumber, receipts and #533 point at the numbers.
- **"Not closable online" is a result**, recorded with what was searched (#540), not a reason to retry.
- Store POIs from facts-only sources stay search-only: no floor, no position, no connector, until a receipt.
- Sign photos taken on site are private evidence: they never enter Git; the receipt holds the read text.
- Every time written in these docs carries a zone (JST); receipts use `observedAt` with offset.
- Tokyo Metro pages are cited via Wayback, even when the live URL answers.

## Related

- Tracker: #533 (field items 1–55)
- Gap table: #501, #535, #537, #544, #546, #555 · Field run: #529, #533, #540, #552, #555 · Receipt import: #554 (Ikebukuro), #556 (Shinjuku)
- Rights lane: #165 (ecomo transfer routes, ODPT: both pending)
- Notes: [station data](data-stations.md) · [GIS / S03](data-gis.md) · [rights](data-rights.md)
