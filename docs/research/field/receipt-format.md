# Field receipt format

A receipt records text read from public signage during a field run. Store it at
`docs/research/field/receipts/<YYYY-MM-DD>-<station>.json`.

```json
{
 "version": 1,
 "station": "ikebukuro",
 "fieldRun": "docs/research/lines/field-run-2026-10-26.md", "sourceKind": "team_field", "observer": "owner",
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
- `sourceKind` must be `team_field`: the GTEki team's own reading of public signage, published as facts only under the project's CC BY 4.0 (director ruling 2026-10-26 19:1x JST). Crowd or third-party contributions are rejected until a contributor licence and a rights review exist.
- `observer` is a role (for example `owner`), never a person's name.
- Only the facts copied from a plate (its text, the gate↔opening tie, the floor plate) are published. Photos stay private evidence: never shipped or committed, EXIF GPS stripped before storage, and faces blurred if a photo is ever shown.
- Connectors are additive: every CLOSED item adds its node, because a store can have several entrances. To correct a wrong tie, edit or delete the earlier receipt item; a later receipt does not supersede it.
