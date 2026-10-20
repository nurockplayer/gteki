#!/usr/bin/env bash
set -euo pipefail

# May be invoked from any directory; only the temporary directory holds fixture data.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
proof_dir="$(mktemp -d "${TMPDIR:-/tmp}/gteki-godot-proof.XXXXXX")"
trap 'rm -rf "$proof_dir"' EXIT
cd "$repo_root"

godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"
if [[ ! -x "$godot_bin" ]]; then
  echo "Godot executable not found: $godot_bin" >&2
  exit 1
fi
echo "Godot: $("$godot_bin" --version)"
pnpm tsx packages/cli/src/export-fixture.ts "$proof_dir"
pnpm tsx packages/cli/src/route.ts "$proof_dir" start goal > "$proof_dir/route.json"
pnpm tsx packages/godot/src/export-reference.ts "$proof_dir" "$proof_dir/reference.json"
# The test removes its generated user:// GLB; logs and station JSON stay temporary.
"$godot_bin" --headless --path packages/godot \
  --log-file "$proof_dir/godot.log" --script res://tests/run_tests.gd \
  -- "$proof_dir" "$proof_dir/route.json" "$proof_dir/reference.json" "$@"
