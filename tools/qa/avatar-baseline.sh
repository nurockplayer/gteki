#!/bin/sh
# Lane F #339: player-avatar baseline (F0 on the procedural avatar; F1 reruns it on the rigged character).
# usage: tools/qa/avatar-baseline.sh <workdir> <base-ref> [merge-ref ...] [-- <out-dir>]
#   tools/qa/avatar-baseline.sh "$TMPDIR/gteki-avatar" origin/main
# Builds the candidate with run-candidate.sh, runs specs/19-avatar-baseline once per project (captures,
# frame time, in-explorer slide cross-check; artifacts moved to <out>/<project>), then the headless
# fixed-step slide harness (tools/qa/avatar-baseline/slide.ts) on the same checkout for both quality
# tiers (<out>/slide), and tiles the capture frames into contact sheets when ffmpeg is present.
# Env: AVATAR_PROJECTS (default "desktop-chromium phone-chromium phone-webkit"), QA_REUSE=1 to keep an
# existing candidate, GTEKI_AVATAR_PROBES / GTEKI_AVATAR_STATIONS (see the spec), AVATAR_ADAPTER for
# slide.ts. Needs a GPU slot: one browser at a time, nothing else heavy on the host. Each browser run
# takes the shared host lock when lockf is available.
set -eu

here=$(cd "$(dirname "$0")/../.." && pwd)
work=$1; base=$2; shift 2
merges=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do merges="$merges $1"; shift; done
[ "${1:-}" = "--" ] && shift
out=${1:-$work/avatar-baseline}
projects=${AVATAR_PROJECTS:-desktop-chromium phone-chromium phone-webkit}
lock=${QA_LOCK:-/tmp/gteki-local-test.lock}
mkdir -p "$work" "$out"

gate() { # live memory pressure and disk, per the host rules; stop rather than run into swap or ENOSPC
  free=$(memory_pressure 2>/dev/null | awk '/free percentage/ { gsub("%", "", $5); print $5 }')
  [ -z "$free" ] || [ "$free" -ge 20 ] || { echo "memory free ${free}% < 20%; stopping before $1" >&2; exit 3; }
  kb=$(df -Pk "$here" | awk 'NR == 2 { print $4 }')
  [ "$kb" -ge 3145728 ] || { echo "less than 3 GiB free; stopping before $1" >&2; exit 4; }
}
locked() { if command -v lockf >/dev/null 2>&1; then lockf -k "$lock" "$@"; else "$@"; fi; }

reuse=${QA_REUSE:-0}
status=0
for p in $projects; do
  gate "$p"
  echo "=== $p $(date +%H:%M:%S)"
  # shellcheck disable=SC2086
  GTEKI_AVATAR_BASELINE=1 QA_REUSE=$reuse QA_UNIT=0 locked sh "$here/tools/qa/run-candidate.sh" "$work" "$base" $merges -- \
    specs/19-avatar-baseline.spec.ts --project="$p" --trace=off || status=$?
  rm -rf "${out:?}/$p"; mv "$here/tests/e2e/artifacts" "$out/$p"
  reuse=1
done

gate slide
mkdir -p "$out/slide"
for q in high low; do
  node --experimental-transform-types "$here/tools/qa/avatar-baseline/slide.ts" --root "$work/candidate" --quality "$q" \
    --adapter "${AVATAR_ADAPTER:-procedural}" --out "$out/slide" || status=$?
done

if command -v ffmpeg >/dev/null 2>&1; then
  for p in $projects; do
    for seq in walk-side walk-back run-side run-back turn90 stop; do
      # shellcheck disable=SC2046
      set -- $(ls "$out/$p"/evidence/*/*-avatar-"$seq"-*.png 2>/dev/null | sort -V)
      [ $# -gt 0 ] && sh "$here/tools/qa/contact-sheet.sh" "$out/$p/sheet-$seq.jpg" 4 "$@" || true
    done
  done
fi
echo "avatar baseline in $out (exit $status)"
exit "$status"
