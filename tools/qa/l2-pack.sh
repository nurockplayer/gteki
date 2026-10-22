#!/bin/sh
# Lane F: one-command L2 evidence run and review pack for one station.
#
# usage: tools/qa/l2-pack.sh <station> <workdir> <base-ref> [merge-ref ...] [-- <extra playwright args>]
#   tools/qa/l2-pack.sh ikebukuro "$TMPDIR/gteki-qa" origin/main
#   tools/qa/l2-pack.sh shinjuku "$TMPDIR/gteki-qa" origin/main origin/claude/some-pr -- --project=phone-chromium
#
# A thin wrapper: tools/qa/run-candidate.sh builds the exact candidate and runs only the tests of <station>
# (ikebukuro or shinjuku) with workers 1 (config) and traces off, on desktop-chromium and phone-webkit. Add
# --project=phone-chromium (or any --project) after `--` to choose the projects yourself. Then
# tools/qa/l2-pack.mjs builds tests/e2e/artifacts/l2-pack-<station>/ (l2-review.md, l2-pack.json, contact sheets).
# The pack is evidence for a human or independent reviewer, never an acceptance (docs/qa/l2-acceptance.md).
# Exits with the Playwright / prerequisite status.
#
# The selection is each suite's tests for the station:
#   01-smoke (opens)  02-navigation (goldens, deep link, search UI)  03-guided-walkthrough (both walks)
#   04-free-walk ("walls stop" probe only, not the long free walks)  05-performance  09-label-fade
#   11-overview  12-wayfinding-cues (Ikebukuro walks only)  13-follow-camera (both walks and the lens test)
# 06-08 are repro and probe suites and 10-look-compare is not station-specific: L2_LOOK=1 adds it (needs the
# look harness the candidate serves). Run it on an idle host: a busy host lowers fps and the SwiftShader
# check in the pack only catches software rendering, not load.
set -eu

here=$(cd "$(dirname "$0")/../.." && pwd)
[ $# -ge 3 ] || { sed -n '4,5p' "$0" >&2; exit 2; }
station=$1; work=$2; base=$3; shift 3
case "$station" in ikebukuro | shinjuku) ;; *) echo "station must be ikebukuro or shinjuku, got: $station" >&2; exit 2 ;; esac
refs=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do refs="$refs $1"; shift; done
[ "${1:-}" = "--" ] && shift

grep_re="$station: (opens|scenario goldens|deep link|search UI|guided walk|walls stop|load, overview|POI label fade|overview frames|follow camera|lens ease|wayfinding cues)"
[ "${L2_LOOK:-0}" = 1 ] && grep_re="$grep_re|look compare:"
projects="--project=desktop-chromium --project=phone-webkit"
for a in "$@"; do case "$a" in --project | --project=*) projects="" ;; esac; done

status=0
# shellcheck disable=SC2086
"$here/tools/qa/run-candidate.sh" "$work" "$base" $refs -- --grep "$grep_re" --trace off $projects "$@" || status=$?

art="$here/tests/e2e/artifacts"
if [ -d "$art/evidence" ]; then
  node "$here/tools/qa/l2-pack.mjs" "$art/evidence" --station "$station" --candidate "$work/candidate" --out "$art/l2-pack-$station" || status=$?
else
  echo "no evidence under $art/evidence: the run stopped before the tests (see $work/logs)" >&2
  [ "$status" -ne 0 ] || status=1
fi
exit "$status"
