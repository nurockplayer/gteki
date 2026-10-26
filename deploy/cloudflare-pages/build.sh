#!/usr/bin/env bash
# Builds the static site for Cloudflare Pages into deploy/cloudflare-pages/dist/.
# Uses the Web workspace when main has one (root `build` script → apps/web/dist);
# otherwise publishes the placeholder landing page.
set -euo pipefail
cd "$(dirname "$0")/../.."

# The public deploy never builds with private data (OD-35, docs/research/use-tiers.md).
if [ -n "${GTEKI_PRIVATE_OVERLAY:-}" ] || [ -n "${GTEKI_STATION_ROOTS:-}" ]; then
  echo "refusing: GTEKI_PRIVATE_OVERLAY or GTEKI_STATION_ROOTS is set; the public deploy builds public data only" >&2; exit 1
fi

OUT=deploy/cloudflare-pages/dist
rm -rf "$OUT"

if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.build ? 0 : 1)'; then
  pnpm install --frozen-lockfile
  pnpm build
  cp -R apps/web/dist "$OUT"
  if [ -f "$OUT/private-build.txt" ]; then echo "refusing: dist is a private build" >&2; rm -rf "$OUT"; exit 1; fi
else
  cp -R deploy/cloudflare-pages/placeholder "$OUT"
fi

git rev-parse HEAD > "$OUT/version.txt"
echo "Built $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
