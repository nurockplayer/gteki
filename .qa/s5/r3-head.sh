#!/bin/sh
# Lead 2026-11-03 21:3x JST: head-only gate regen at the PR head; base = committed gate files (main f3e4e27e).
set -eu
pnpm typecheck
export S5_VARIANT=head4; python3 .qa/s5/r2-instrument.py
for station in ikebukuro shinjuku; do
  dest=".qa/s5/r3-final/$station"; mkdir -p "$dest"
  pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox --write "$dest/navmesh-fallback.json" --write-baseline "$dest/navmesh-clip-baseline.json" --write-suspect "$dest/navmesh-suspect.json" --write-paths "$dest/navmesh-paths.json"
  cp ".qa/s5/r2-head4/$station/audit.json" "$dest/audit.json"
done
