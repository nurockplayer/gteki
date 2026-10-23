#!/bin/sh
# Lane F: one-command acceptance run for a Shinjuku candidate (#61): B1-B8, C3 (#70) and phone speed.
#
# usage: tools/qa/shinjuku-b-checks.sh <workdir> <base-ref> [merge-ref ...] [-- <extra playwright args>]
#   tools/qa/shinjuku-b-checks.sh "$TMPDIR/gteki-qa" origin/claude/shinjuku-e27-l2-stage2 origin/claude/core-c3-camera-blockers
#
# A thin wrapper: tools/qa/run-candidate.sh builds the exact candidate and runs Playwright on all three
# projects (desktop-chromium, phone-webkit, phone-chromium; the phone projects only run @phone tests),
# with workers 1 (config), traces off and the Shinjuku-relevant tests only. Then
# tools/qa/summarize-b-checks.mjs turns the evidence into the B-checks table
# (tests/e2e/artifacts/b-checks.md and b-checks.json). Exits with the Playwright / prerequisite status.
#
# Why each test is in the selection:
#   01-smoke   shinjuku: opens ...      page errors; sceneInfo cameraBlockers (B1/C3 context)
#   02-navigation  scenario goldens     B6 (step-free Exit 1 -> platform must be no_path); navigation goldens
#   03-guided-walkthrough  guided walk (both Shinjuku walks) B2 near-black and clipped white per frame,
#                                       the B1 and C3 frames a human must look at, arrival
#   04-free-walk   walls stop           B8 containment (wall probe); the long free walks are not needed
#   05-performance load, overview ...   B4 overview draw calls; phone walk fps. Run it on an IDLE host:
#                                       a running replay or other heavy job lowers phone fps and
#                                       invalidates the number (b511263 read 40.2 fps on a busy host)
#   08-step-probe  GTEKI_PROBE=S1,S2   B3 (S1 north switchback) and B7 (S2 second walkable surface);
#                                       desktop only, no @phone tag
# 09-label-fade and the other specs are not needed for these checks.
set -eu

here=$(cd "$(dirname "$0")/../.." && pwd)
[ $# -ge 2 ] || { sed -n '3,6p' "$0" >&2; exit 2; }
work=$1; base=$2; shift 2
refs=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do refs="$refs $1"; shift; done
[ "${1:-}" = "--" ] && shift

probes="shinjuku:poi:exit:1>poi:platform:oedo,shinjuku:poi:platform:oedo>poi:exit:2"
grep_re='shinjuku: (opens|scenario goldens|guided walk|walls stop|load, overview)|step probe'

status=0
# Evidence must come from this run: run-candidate.sh resets the artifacts only once it reaches the tests, so a
# run that stops earlier (merge, build, server) would otherwise summarize the previous run's files (#318).
stamp=$(mktemp "${TMPDIR:-/tmp}/b-checks-stamp.XXXXXX")
trap 'rm -f "$stamp"' EXIT
# shellcheck disable=SC2086
GTEKI_PROBE="$probes" "$here/tools/qa/run-candidate.sh" "$work" "$base" $refs -- --grep "$grep_re" --trace off "$@" || status=$?

art="$here/tests/e2e/artifacts"
fresh=$(find "$art/evidence" -type f -newer "$stamp" 2>/dev/null | head -n 1)
rm -f "$stamp"
if [ -n "$fresh" ]; then
  node "$here/tools/qa/summarize-b-checks.mjs" "$art/evidence" --candidate "$work/candidate" | tee "$art/b-checks.md"
else
  echo "no evidence from this run under $art/evidence: it stopped before the tests (see $work/logs)" >&2
  [ "$status" -ne 0 ] || status=1
fi
exit "$status"
