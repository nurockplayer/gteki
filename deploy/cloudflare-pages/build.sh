#!/usr/bin/env bash
# Builds the static site for Cloudflare Pages into deploy/cloudflare-pages/dist/.
# Uses the Web workspace when main has one (root `build` script → apps/web/dist);
# otherwise publishes the placeholder landing page.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=deploy/cloudflare-pages/dist
rm -rf "$OUT"

if [ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.build ? 0 : 1)'; then
  pnpm install --frozen-lockfile
  pnpm build
  cp -R apps/web/dist "$OUT"
else
  cp -R deploy/cloudflare-pages/placeholder "$OUT"
fi

git rev-parse HEAD > "$OUT/version.txt"
echo "Built $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
