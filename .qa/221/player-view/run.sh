#!/bin/sh
# #221 player-view re-check: build the checkout and shoot the 16 first-person views on the real GPU.
# Run through orb-test --heavy --host (GPU work, host run); outputs land in .qa/221/player-view/shots.
set -eu
ROOT=$(pwd)
date '+%F %H:%M %Z'
pnpm install --frozen-lockfile
pnpm build
pnpm --dir tests/e2e install --frozen-lockfile
mkdir -p "$ROOT/.qa/221/player-view/shots"
GTEKI_221_PLAYER_VIEW=1 GTEKI_ROOT="$ROOT" GTEKI_PORT=5771 \
GTEKI_221_OUT="$ROOT/.qa/221/player-view/shots" \
  pnpm --dir tests/e2e exec playwright test specs/22-221-player-view.spec.ts --project=desktop-chromium
date '+%F %H:%M %Z'
ls -l "$ROOT/.qa/221/player-view/shots"
