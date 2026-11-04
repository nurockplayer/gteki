#!/bin/sh
# Bake-only x26 admission probe. Container-only source instrumentation.
set -eu
python3 .qa/809/patch-bake.py
mkdir -p .qa/809/diag/bake
pnpm tsx packages/godot/src/navmesh-bake.ts --station ikebukuro --with-greybox --cell-size 0.1 --agent-radius 0.3 --walkable-climb 0.4 --tile-size 256 --out .qa/809/diag/bake
