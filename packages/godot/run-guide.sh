#!/usr/bin/env bash
set -euo pipefail

# G-3: headless checks of the search/route bridge, the route ribbon, the guided walk and the HUD state.
# The tests call the TypeScript CLIs through OS.execute (pnpm tsx), so run `pnpm install` once first.
# On the shared host run it through the lock:  lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-guide.sh
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"
if [[ ! -x "$godot_bin" ]]; then
  echo "Godot executable not found: $godot_bin" >&2
  exit 1
fi
echo "Godot: $("$godot_bin" --version)"
"$godot_bin" --headless --path packages/godot --script res://tests/run_guide_tests.gd
