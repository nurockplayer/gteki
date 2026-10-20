#!/usr/bin/env bash
# Fetch the licensed E27 inputs into the private raw directory (never into the repo) and verify hashes.
set -euo pipefail
RAW="${GTEKI_RAW_SHINJUKU:-$HOME/Developer/gteki-raw/shinjuku}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$RAW/e27"
fetch() { [ -f "$RAW/$1" ] || curl -fsSL "$2" -o "$RAW/$1"; }
fetch e27/nwd_oedo_shinjuku_geojson.zip "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/d4519a9a-917a-4de8-9104-83e21246c04c/download/nwd_oedo_shinjuku_geojson.zip"
fetch e27/stationmap_oedo_shinjuku_geojson.zip "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip"
cd "$RAW"
[ -f acquired_at.txt ] || date -u +%Y-%m-%dT%H:%M:%SZ > acquired_at.txt
python3 - "$HERE/sources/manifest.json" <<'PY'
import hashlib, json, sys
m = json.load(open(sys.argv[1]))
bad = 0
for f in m["files"]:
    if not f.get("sha256"): continue
    try: h = hashlib.sha256(open(f["path"], "rb").read()).hexdigest()
    except FileNotFoundError: print("missing (optional)", f["path"]); continue
    ok = h == f["sha256"]; bad += not ok
    print("OK " if ok else "MISMATCH", f["path"])
sys.exit(1 if bad else 0)
PY
mkdir -p e27/nwd e27/map
unzip -oq e27/nwd_oedo_shinjuku_geojson.zip -d e27/nwd
unzip -oq e27/stationmap_oedo_shinjuku_geojson.zip -d e27/map
echo "Raw inputs ready in $RAW — now: pnpm --filter @gteki/station-shinjuku import:e27"
