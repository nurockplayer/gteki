#!/bin/sh
# Lane F #342 Q5: "recognition proxy" captures and table for both stations.
# usage: tools/qa/recognition.sh <workdir> <base-ref> [merge-ref ...] [-- <out-dir>]
#   tools/qa/recognition.sh "$TMPDIR/gteki-rec" origin/main                                   (baseline)
#   QA_REUSE=0 tools/qa/recognition.sh "$TMPDIR/gteki-rec" origin/main origin/<Q1/Q2 branch>  (candidate)
# Builds the candidate with run-candidate.sh, runs specs/20-recognition per project (desktop-chromium high tier,
# phone-chromium low tier; artifacts moved to <out>/<project>), OCRs the frames and writes
# <out>/proxy/recognition-proxy.{md,json}, one contact sheet per station × project (rows: spawn, junction, exit;
# 10 frames each, 0.5 s apart) and <out>/anon/ (anonymised frames, without the key). Needs a GPU slot.
set -eu

here=$(cd "$(dirname "$0")/../.." && pwd)
work=$1; base=$2; shift 2
merges=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do merges="$merges $1"; shift; done
[ "${1:-}" = "--" ] && shift
out=${1:-$work/recognition}
projects=${REC_PROJECTS:-desktop-chromium phone-chromium}
lock=${QA_LOCK:-/tmp/gteki-local-test.lock}
mkdir -p "$work" "$out"

gate() {
  free=$(memory_pressure 2>/dev/null | awk '/free percentage/ { gsub("%", "", $5); print $5 }')
  [ -z "$free" ] || [ "$free" -ge 20 ] || { echo "memory free ${free}% < 20%; stopping before $1" >&2; exit 3; }
  kb=$(df -Pk "$here" | awk 'NR == 2 { print $4 }')
  [ "$kb" -ge 3145728 ] || { echo "less than 3 GiB free; stopping before $1" >&2; exit 4; }
}
locked() { if command -v lockf >/dev/null 2>&1; then lockf -k "$lock" "$@"; else "$@"; fi; }

reuse=${QA_REUSE:-0}
status=0
dirs=""
for p in $projects; do
  gate "$p"
  echo "=== $p $(date +%H:%M:%S)"
  # shellcheck disable=SC2086
  # Clear the previous run's artifacts first: run-candidate.sh clears them only once its build and servers are up,
  # so after a setup failure the directory would still hold someone else's evidence.
  rm -rf "$here/tests/e2e/artifacts"
  GTEKI_RECOGNITION=1 QA_REUSE=$reuse QA_UNIT=0 locked sh "$here/tools/qa/run-candidate.sh" "$work" "$base" $merges -- \
    specs/20-recognition.spec.ts --project="$p" --trace=off || status=$?
  # A run that failed before Playwright leaves no artifacts: don't abort, and don't move stale ones.
  rm -rf "${out:?}/$p"
  if [ -d "$here/tests/e2e/artifacts" ]; then mv "$here/tests/e2e/artifacts" "$out/$p"; dirs="$dirs $out/$p"; else echo "no artifacts for $p" >&2; fi
  reuse=1
done

# shellcheck disable=SC2086
[ -n "$dirs" ] && node "$here/tools/qa/recognition/proxy.mjs" "$out/proxy" $dirs || status=$?

mkdir -p "$out/anon"
for p in $projects; do
  find "$out/$p" -path '*/anon/*.png' -exec cp {} "$out/anon/" \;
  if command -v ffmpeg >/dev/null 2>&1; then
    for st in ikebukuro shinjuku; do
      # One ls per view: a single ls would sort all three globs together (exit, junction, spawn).
      # shellcheck disable=SC2046
      set -- $(for v in spawn junction exit; do ls "$out/$p"/evidence/*/rec-"$st"-"$v"-*.png 2>/dev/null; done)
      [ $# -gt 0 ] && sh "$here/tools/qa/contact-sheet.sh" "$out/sheet-$st-$p.jpg" 10 "$@" || true
    done
  fi
done
echo "recognition proxy in $out (exit $status)"
exit "$status"
