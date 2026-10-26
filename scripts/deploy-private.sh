#!/usr/bin/env bash
set -euo pipefail
# Private build (OD-35) to the Cloudflare Pages preview branch "private" (private.gteki.pages.dev, behind Access).
# Owner's Mac only: never CI, never production. Usage: GTEKI_PRIVATE_DIR=<private repo> pnpm deploy:private

for arg in "$@"; do
  case "$arg" in
    --branch|--branch=*)
      echo "refusing: deploy branch is fixed to private; --branch is not allowed (main, master, and production are forbidden)" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${GTEKI_DEPLOY_BRANCH+x}" && "$GTEKI_DEPLOY_BRANCH" != private ]]; then
  echo "refusing: GTEKI_DEPLOY_BRANCH must be private (main, master, and production are forbidden)" >&2
  exit 1
fi
if [[ -n "${CI+x}" || -n "${GITHUB_ACTIONS+x}" ]]; then
  echo "refusing: private deploy must not run from CI" >&2
  exit 1
fi
if [[ -z "${GTEKI_PRIVATE_DIR:-}" || ! -d "$GTEKI_PRIVATE_DIR" ]]; then
  echo "refusing: GTEKI_PRIVATE_DIR must be set to a directory" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
BRANCH=private
sh tools/private-overlay/run.sh build
if [[ ! -f apps/web/dist/private-build.txt ]]; then
  echo "refusing: apps/web/dist/private-build.txt is missing" >&2
  exit 1
fi
printf '\n/*\n  X-Robots-Tag: noindex, nofollow\n' >> apps/web/dist/_headers

if [[ "${GTEKI_PRIVATE_FIRST_DEPLOY:-}" == 1 ]]; then
  echo "warning: skipping Access check for first private deploy"
else
  http_code=$(curl -s -o /dev/null -w '%{http_code}' https://private.gteki.pages.dev/ || true)
  case "$http_code" in
    302|401|403) ;;
    *) echo "refusing: private.gteki.pages.dev is not behind Access (HTTP $http_code)" >&2; exit 1 ;;
  esac
fi

wrangler pages deploy apps/web/dist --project-name=gteki --branch="$BRANCH" --commit-dirty=true
