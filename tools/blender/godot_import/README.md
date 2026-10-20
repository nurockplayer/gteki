# Godot kit import check

This small Godot 4 project verifies that kit GLBs load through Godot's actual
glTF importer. `run_import_test.sh` copies the selected GLBs into the ignored
`kit/` directory, imports them, instantiates each `PackedScene`, and writes an
inspection report. Godot's default glTF import settings are retained, including
its `-colonly` collision-node handling. Each invocation clears this harness's
ignored `kit/` contents and `.godot/` cache to guarantee a fresh import and
recover cleanly from failed imports. Do not use either directory as input or
output, and run only one invocation at a time. Godot logs go to `out_dir`.

Run from the repository root:

```sh
tools/blender/godot_import/run_import_test.sh [glb_dir] [out_dir]
tools/blender/godot_import/run_import_test.sh --screenshot [glb_dir] [out_dir]
```

Both directory arguments are optional. The defaults are `assets/library/glb`
and `tools/blender/godot_import/out`. Set `GODOT_BIN` to override the default
`/opt/homebrew/bin/godot` executable.

The headless command writes `godot_import_report.json`, with Godot version and
per asset node count, `MeshInstance3D` count, surfaces and material names,
`StaticBody3D` and `CollisionShape3D` counts, `SOCKET_*` names and global
positions, merged mesh AABB, and checks for floor height and the `z=0` entry
edge extending along `-Z`. It prints a one-line summary for each imported GLB.
The screenshot command opens a Godot window and writes
`godot_kit_overview.png` plus one `godot_<id>.png` close-up per asset. Screenshots
use a procedural sky, AgX tonemapping, SSAO, glow, a shadow casting directional
light, and a camera framed from each mesh AABB.

The asset orientation checks are reported as warnings and do not fail the
process. A missing/unloadable GLB, failed instantiation, or failed output write
returns a non-zero status. Screenshot mode needs a working graphical session
and the Forward+ renderer; the headless import report does not need a display.
This harness measures Godot's imported scene, so its node/material names and
generated collision nodes can differ from the source glTF structure.
