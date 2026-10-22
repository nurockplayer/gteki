# Historical GIS evidence

These receipts and reports are superseded snapshots retained for comparison, not current validation or acceptance. The phase sections identify their boundaries. The first lead Codex review returned REQUEST_CHANGES (one P1, six P2, two P3) and superseded the earlier external review; the second lead review confirmed those nine closed and requested the Phase 3 fixes.

- `phase1/`: acquisition, inventory, CRS, network, gap and summary snapshots plus the old current run/validation receipts.
- `conversions/`: the seven retained Phase 1 conversion receipts; corresponding artifacts remain in the external store.
- `runs/`: older ordered runs, initial failures, smoke/audit receipts and pre-frame naming history.
- `reviews/` and `review-request.md`: superseded external-review text. `../review.json` preserves its sanitized historical receipt.

Use `../README.md` for exactly one current real-run receipt, one current validation receipt and current reports. Relative store pointers remain relative to the GIS store, not this history directory.

## Phase 2 baseline

`phase2/` retains the reports, six conversion receipts, ordered run, validation and handoff before the Phase 3 fixes. The second fresh lead Codex review confirmed the original nine findings closed and requested changes for four P2 and one P3 synthetic-input defects. These files are historical; current receipts remain at the paths linked from `../README.md`.

## Source literals in these snapshots (#129)

Class (b) source literals (unclear or no-release terms) in these snapshots were replaced by `value_sha256:<hex>` tokens with `gis scrub-literals`. Class (a) values that remain (PLATEAU ubld `gml:id` and `gml:name` text, CC BY 4.0) keep the credit recorded in [../rights/non-poi-literals.md](../rights/non-poi-literals.md): 出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成.
