#!/usr/bin/env bash
# Fetch the open-data inputs for the Ikebukuro lane into the git-ignored cache
# and verify them against the hashes recorded in docs/G0-source-audit.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/data-cache/ikebukuro"
mkdir -p "$OUT"
B=https://assets.cms.plateau.reearth.io/assets

fetch() { # name url sha256
  if [[ ! -f "$OUT/$1" ]]; then curl -fsS -o "$OUT/$1" "$2"; fi
  echo "$3  $OUT/$1" | shasum -a 256 -c -
}

fetch 53394576_ubld_6697_op.gml \
  "$B/cc/d90677-ae87-4718-8899-f6131004cfa5/13116_toshima-ku_pref_2025_citygml_1_op/udx/ubld/53394576_ubld_6697_op.gml" \
  38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09
fetch metadata.zip \
  "$B/23/b8d8c3-dbe0-4bf1-b74a-3c18b6a087c1/13116_toshima-ku_pref_2025_citygml_1_op_metadata.zip" \
  9c75c7135d5b1693db5474c0756eeb5632496d9d1fbcfd8ca7882c4cbea7d624
fetch codelists.zip \
  "$B/82/77b46c-5983-448a-9d89-c0663ddc0652/13116_toshima-ku_pref_2025_citygml_1_op_codelists.zip" \
  183a3f554d816837f92c865124fa3cd2605e1c8f6ca7c58318b0241e718c5600
