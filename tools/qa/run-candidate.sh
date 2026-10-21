#!/bin/sh
# Lane F: build an exact candidate and run the browser QA harness against it.
#
# usage: tools/qa/run-candidate.sh <workdir> <base-ref> [merge-ref ...] [-- <playwright args>]
#   tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" origin/main
#   tools/qa/run-candidate.sh "$TMPDIR/gteki-qa" origin/claude/gteki-shinjuku-station-on-core origin/feat/ikebukuro-g0-slice -- --project=desktop-chromium
#
# Creates a detached worktree at <workdir>/candidate (never pushed), merges each extra ref locally,
# installs with pnpm, runs typecheck/tests/build, serves the explorer (plus the dev-only look harness
# on port+1 when the candidate has apps/web/qa/look.html) and each lane app on ports it owns, runs
# tests/e2e, and writes manifest.json with every SHA so evidence is tied to exact code.
# A conflicting merge stops the run: resolve it in the worktree by hand, commit, and rerun with
# QA_REUSE=1 (the manifest then records the worktree's dirty state). Exits non-zero if any stage
# fails. Only pnpm/Homebrew tooling is used.
set -eu

here=$(cd "$(dirname "$0")/../.." && pwd)
work=$1; base=$2; shift 2
merges=""
while [ $# -gt 0 ] && [ "$1" != "--" ]; do merges="$merges $1"; shift; done
[ "${1:-}" = "--" ] && shift
cand="$work/candidate"
mkdir -p "$work"
# A full desktop run writes ~0.5 GB of video and frames (under $here) and the candidate, build and
# logs (under $work); a full disk silently corrupts evidence. Check both filesystems.
for d in "$here" "$work"; do
  free_kb=$(df -Pk "$d" | awk 'NR == 2 { print $4 }')
  [ "$free_kb" -ge 2097152 ] || { echo "less than 2 GB free on $(df -P "$d" | awk 'NR == 2 { print $6 }') (for $d); refusing to run" >&2; exit 1; }
done

if [ "${QA_REUSE:-0}" != 1 ]; then
  git -C "$here" fetch origin --quiet
  [ -e "$cand" ] && git -C "$here" worktree remove --force "$cand"
  git -C "$here" worktree add --detach "$cand" "$base"
  for ref in $merges; do
    git -C "$cand" -c user.name=gteki-qa -c user.email=qa@localhost merge --no-edit "$ref"
  done
fi

log="$work/logs"; rm -rf "$log"; mkdir -p "$log"
failed=""
# Frozen first: an out-of-date lockfile is itself a finding (recorded), then install to keep going.
if ( cd "$cand" && pnpm install --frozen-lockfile ) > "$log/install.log" 2>&1; then lock=frozen
else lock=out-of-date; ( cd "$cand" && pnpm install ) >> "$log/install.log" 2>&1; fi
( cd "$cand" && pnpm -r --include-workspace-root typecheck ) > "$log/typecheck.log" 2>&1 && tc=pass || { tc=fail; failed="$failed typecheck"; }
# Default suites only (heavy ones run in the box via test:heavy:box); one worker on a shared 16 GB host.
( cd "$cand" && pnpm vitest run --maxWorkers=1 ) > "$log/unit.log" 2>&1 && unit=pass || { unit=fail; failed="$failed unit"; }
( cd "$cand" && pnpm build ) > "$log/build.log" 2>&1 || { echo "build failed: $log/build.log" >&2; exit 1; }

pids=""
cleanup() { for p in $pids; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM
serve() { # name dir port cmd...
  name=$1; dir=$2; p=$3; shift 3
  if curl -s -o /dev/null "http://127.0.0.1:$p/"; then echo "port $p already serves something; refusing to test a server this run does not own" >&2; exit 1; fi
  ( cd "$dir" && exec "$@" --port "$p" --strictPort --host 127.0.0.1 ) > "$log/serve-$name.log" 2>&1 &
  pids="$pids $!"
  i=0; until curl -sf -o /dev/null "http://127.0.0.1:$p/"; do
    i=$((i + 1)); [ $i -le 60 ] || { echo "$name did not come up on :$p (see $log/serve-$name.log)" >&2; exit 1; }
    sleep 1
  done
}
port=${GTEKI_PORT:-5270}
serve explorer "$cand/apps/web" "$port" pnpm exec vite preview
# The explorer must be serving this candidate's build, byte for byte.
curl -sf "http://127.0.0.1:$port/" | cmp -s - "$cand/apps/web/dist/index.html" || { echo "served explorer is not this candidate's dist/index.html" >&2; exit 1; }
# look.html (the #94 look-compare harness) is dev-only: `pnpm build` emits index.html alone, so only the Vite dev server serves it.
look_url=""
if [ -f "$cand/apps/web/qa/look.html" ]; then serve look-dev "$cand/apps/web" $((port + 1)) pnpm exec vite; look_url="http://127.0.0.1:$((port + 1))"; fi
shinjuku_url=""; ikebukuro_url=""
if [ -f "$cand/stations/shinjuku/vite.config.ts" ]; then serve shinjuku-app "$cand/stations/shinjuku" $((port + 2)) pnpm exec vite; shinjuku_url="http://127.0.0.1:$((port + 2))"; fi
if [ -f "$cand/stations/ikebukuro/vite.config.ts" ]; then serve ikebukuro-preview "$cand/stations/ikebukuro" $((port + 3)) pnpm exec vite; ikebukuro_url="http://127.0.0.1:$((port + 3))"; fi

e2e="$here/tests/e2e"
[ -d "$e2e/node_modules" ] || ( cd "$e2e" && pnpm install --ignore-workspace --frozen-lockfile )
rm -rf "$e2e/artifacts"; mkdir -p "$e2e/artifacts"
pw=$(cd "$e2e" && pnpm exec playwright --version)
brave="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
browser=${GTEKI_BROWSER:-}; [ -n "$browser" ] || { [ -x "$brave" ] && browser=$brave || browser="playwright bundled chromium"; }
browser_version=$([ -x "$browser" ] && "$browser" --version 2>/dev/null || echo "$browser")
harness_dirty=$(git -C "$here" status --porcelain -- tests/e2e tools/qa | grep -v '^??.*artifacts' | wc -l | tr -d ' ')
cat > "$e2e/artifacts/manifest.json" <<EOF
{
  "candidateSha": "$(git -C "$cand" rev-parse HEAD)",
  "candidateDirtyFiles": $(git -C "$cand" status --porcelain | grep -vc '^??' || true),
  "refs": "$(for r in $base $merges; do sha=$(git -C "$cand" rev-parse "$r"); git -C "$cand" merge-base --is-ancestor "$sha" HEAD && in=contained || in=NOT-contained; printf '%s %s %s; ' "$r" "$sha" "$in"; done)",
  "candidateParents": "$(git -C "$cand" log --merges --format='%h %p %s' -5 | tr '\n' ';' | tr '"' "'")",
  "lockfile": "$lock",
  "typecheck": "$tc", "unitTests": "$unit",
  "harnessSha": "$(git -C "$here" rev-parse HEAD)", "harnessDirtyFiles": $harness_dirty,
  "playwright": "$pw", "chromiumProjectsBrowser": "$browser_version",
  "host": "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), macOS $(sw_vers -productVersion 2>/dev/null || uname -r)",
  "node": "$(node -v)", "pnpm": "$(pnpm -v)",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
cat "$e2e/artifacts/manifest.json"

status=0
( cd "$e2e" && GTEKI_ROOT="$cand" GTEKI_BASE_URL="http://127.0.0.1:$port" \
  GTEKI_SHINJUKU_APP_URL="$shinjuku_url" GTEKI_IKEBUKURO_PREVIEW_URL="$ikebukuro_url" GTEKI_LOOK_URL="$look_url" \
  pnpm exec playwright test "$@" ) || status=$?
[ -z "$failed" ] || { echo "prerequisite stages failed:$failed (logs in $log)" >&2; [ "$status" -ne 0 ] || status=1; }
exit "$status"
