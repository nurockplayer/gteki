#!/bin/sh
# usage: tools/qa/collect-run.sh <dest-dir> <run-candidate.sh args...>
# One candidate run plus its evidence, meant to run under the shared QA lock as a whole: clears
# tests/e2e/artifacts, runs run-candidate.sh, then moves the artifacts to <dest-dir>. Holding the lock across all
# three steps means no other run can clear or replace the directory in between. A run that failed before
# Playwright leaves no artifacts, and no stale ones are moved. Exits with run-candidate.sh's status.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
art=$here/tests/e2e/artifacts
dest=$1; shift
rm -rf "${art:?}"
st=0; sh "$here/tools/qa/run-candidate.sh" "$@" || st=$?
rm -rf "${dest:?}"
if [ -d "$art" ]; then mv "$art" "$dest"; else echo "no artifacts for $dest" >&2; fi
exit "$st"
