#!/usr/bin/env sh
# Private build/dev (OD-35): build the overlay from $GTEKI_PRIVATE_DIR, then run the web app on it. Never used by CI or deploy.
set -eu
: "${GTEKI_PRIVATE_DIR:?set GTEKI_PRIVATE_DIR to the private data repo}"
# Absolute, so the web build (which runs in apps/web) finds the overlay.
GTEKI_PRIVATE_DIR=$(cd "$GTEKI_PRIVATE_DIR" && pwd)
export GTEKI_PRIVATE_DIR
cd "$(dirname "$0")/../.."
mode="${1:-}"; [ $# -gt 0 ] && shift
pnpm exec tsx tools/private-overlay/build-overlay.ts
export GTEKI_PRIVATE_OVERLAY="$GTEKI_PRIVATE_DIR/overlay"
case "$mode" in
  build) pnpm --filter @gteki/web build "$@" ;;
  dev) pnpm --filter @gteki/web dev "$@" ;;
  *) echo "usage: run.sh build|dev [args]" >&2; exit 2 ;;
esac
