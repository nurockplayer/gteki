#!/bin/sh
set -eu
for variant in base head; do
  export S5_VARIANT="$variant"
  tar -xf ".qa/s5/r2-$variant.tar"
  python3 .qa/s5/r2-instrument.py
  for station in ikebukuro shinjuku; do
    pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox --write "stations/$station/navmesh-fallback.json" --write-baseline "stations/$station/navmesh-clip-baseline.json" --write-suspect "stations/$station/navmesh-suspect.json" --write-paths "stations/$station/navmesh-paths.json"
    for file in navmesh-fallback navmesh-clip-baseline navmesh-suspect navmesh-paths; do
      cp "stations/$station/$file.json" ".qa/s5/r2-$variant/$station/$file.json"
    done
  done
done
