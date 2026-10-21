# Blender import checks (2026-10-20)

`tools/gis/scripts/blender_import_check.py` was run headless with Blender 5.2.2 LTS (Homebrew, macOS, `--factory-startup`) on the two full-file GLBs; their original receipts are in [history/conversions/pre-review-fix](../history/conversions/pre-review-fix/).

| Station | GLB run | Mesh objects | Max bbox error vs `bbox_local_ENU` | Status | Wall time / peak RSS (`/usr/bin/time -l`) |
| --- | --- | ---: | ---: | --- | --- |
| Ikebukuro | `…-ikebukuro-plateau-ubld-v0-8505a4f2d1cadc7233c0` (GLB SHA-256 `30ddfc71…`, byte-identical to current run `be6ac4becea01f288b44`) | 28 | 0.0039 mm | PASS | under 1 min |
| Shinjuku | `…-shinjuku-plateau-ubld-v0-4bdf223d5ebc9ceeca18` (GLB SHA-256 `c917f7cc…`, byte-identical to current run `8414309c5643be1f476e`) | 30,357 | 0.0055 mm | PASS | 631 s / 3.86 GB |

The errors are at float32 precision. The check confirms the glTF axis mapping (x=E, y=U, z=−N becomes Blender E, N, U) and that Blender's bundled importer reads the files. The rendered top and perspective review images are kept out of Git and stay in the lead's local evidence; they inherit the PLATEAU CC BY 4.0 attribution.

**Implication for runtime assets:** the Shinjuku GLB keeps one node per semantic object (30k+) for traceability, which makes interactive imports slow. Runtime or Web/Godot assets should merge geometry by Room or surface class and keep a sidecar `gml_id` mapping. That work belongs to the asset and station lanes.

These checks verify serialization and frame consistency only. They are not geometry-accuracy, currency or navigation evidence.
