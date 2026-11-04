#!/bin/sh
set -eu
unset GTEKI_PRIVATE_OVERLAY GTEKI_STATION_ROOTS GTEKI_BASE_URL
pnpm install --frozen-lockfile > .qa/minimap-install.log 2>&1
pnpm build > .qa/minimap-build.log 2>&1
pnpm --dir tests/e2e install --ignore-workspace --frozen-lockfile > .qa/minimap-e2e-install.log 2>&1
export GTEKI_ROOT="$PWD"
export GTEKI_PORT=5278
pnpm --dir tests/e2e exec playwright test specs/22-minimap-audit.spec.ts --project=phone-iphone15-chromium --project=desktop-chromium --trace=off --workers=1
