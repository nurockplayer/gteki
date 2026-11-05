#!/bin/sh
# #221 reshoot: the 3 UNCERTAIN views from 2 m back, native viewport. Run through orb-test --heavy --host.
set -eu
ROOT=$(pwd)
date '+%F %H:%M %Z'
pnpm install --frozen-lockfile
pnpm build
pnpm --dir tests/e2e install --frozen-lockfile
mkdir -p "$ROOT/.qa/221/player-view/shots-reshoot"
GTEKI_221_RESHOOT=1 GTEKI_ROOT="$ROOT" GTEKI_PORT=5772 \
GTEKI_221_RESHOOT_OUT="$ROOT/.qa/221/player-view/shots-reshoot" \
  pnpm --dir tests/e2e exec playwright test specs/22-221-player-reshoot.spec.ts --project=desktop-chromium
date '+%F %H:%M %Z'
ls -l "$ROOT/.qa/221/player-view/shots-reshoot"
