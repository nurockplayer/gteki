#!/bin/sh
set -eu
for variant in base head; do
  export S5_VARIANT="$variant"
  tar --exclude='.qa' --exclude='.qa/*' -xf ".qa/s5/r2-$variant.tar"
  python3 .qa/s5/r2-instrument.py
  for station in ikebukuro shinjuku; do
    dest=".qa/s5/r2-$variant/$station"
    mkdir -p "$dest"
    pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox --write "$dest/navmesh-fallback.json" --write-baseline "$dest/navmesh-clip-baseline.json" --write-suspect "$dest/navmesh-suspect.json" --write-paths "$dest/navmesh-paths.json"
  done
done
