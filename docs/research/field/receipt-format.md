# Field receipt format

A receipt records text read from public signage during a field run. Store it at
`docs/research/field/receipts/<YYYY-MM-DD>-<station>.json`.

```json
{
 "version": 1,
 "station": "ikebukuro",
 "fieldRun": "docs/research/lines/field-run-2026-10-26.md",
 "items": [
  {
   "item": 25,
   "status": "CLOSED",
   "poiId": "shop-ikb-esola",
   "nodeId": "x4f",
   "paid": false,
   "observedText": "<plate wording exactly as read>",
   "observedAt": "2026-10-27T10:12+09:00",
   "floorLabel": "B1F",
   "stepFree": "level"
  }
 ]
}
```

- `observedAt` must include the `+09:00` offset. Bare times and `Z` timestamps are invalid.
- `status` is `CLOSED` or `OPEN`; only `CLOSED` items are applied to station data.
- `stepFree` is `level`, `steps:<n>`, `lift`, `escalator`, or `null`.
- `floorLabel` is optional or `null`.
- Photos are never committed under the field-run rules. Record only the text read from them.
