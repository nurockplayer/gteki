#!/bin/sh
# Sources in these archives are pinned when queued; extraction is container-only.
set -eu
test "$(pwd)" = /w
case "$1" in
  escape)
    tar -xf .qa/221/queued/base-source.tar
    pnpm exec tsx .qa/221/escape/scan.ts viewer-base
    tar -xf .qa/221/queued/head-source.tar
    pnpm exec tsx .qa/221/escape/scan.ts viewer-final
    python3 .qa/221/escape/compare.py viewer-final viewer-base
    python3 -c 'import json; r=json.load(open(".qa/221/escape/viewer-final-comparison.json")); assert r["new"] == 0, r'
    ;;
  views)
    tar -xf .qa/221/queued/head-source.tar
    pnpm exec tsx .qa/221/diagnose.ts --live
    ;;
  *) exit 2 ;;
esac
