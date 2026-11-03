# Eleven-ray diagnosis

2026-11-03 15:37:10 JST

Exact original-mesh and merged-mesh casts miss all 11 at both base 2cc6f264 and head 19ea5c43, before and after app live cuts. There is no base first-hit mesh to restore. The old anyHit shortcut falsely classifies all 11 as blocked at base.

| Sample | Direction | Exact base first hit | False blocker | Face |
| ---: | ---: | --- | --- | ---: |
| 474 | 122 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 474 | 123 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 474 | 124 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 474 | 125 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 474 | 126 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 474 | 127 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 475 | 121 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 475 | 122 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 475 | 123 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 476 | 120 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |
| 476 | 121 | none | surface-stone / surface-render-only / shinjuku-e27 | 8408 |

The real curb triangle bottom is renderer Y = -0.05999999865889549 m. The ray height is -1.68 + 1.62 m, about 1.34e-9 m lower. The BVH anyHit barycentric slack accepts it, while Three.js exact triangle intersection rejects it. Head does not lose rendered coverage: these rays already escape at base.

Correction: use the BVH only to select triangles, then call the same native Ray.intersectTriangle used by the normal render-mesh raycast. The regression contains the shipped triangle and exact ray, plus a ray at Y = -0.05 m which must hit the rendered curb. No production scene geometry or physical inputs change, so surface/recipe regeneration is not needed. The new test helper export does require map generation.

The helper moved from .qa/221/escape/opaque.ts to stations/shinjuku/test/helpers/opaque-scene.ts so the existing enclosure test and CLI audits share the exact classifier. The old path re-exports it.
