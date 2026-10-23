#!/usr/bin/env bash
set -euo pipefail

# G-5a: export the station snapshot and run the headless evidence walks (#164): for each scenario in the station's plan
# (run_evidence_tests.gd `PLANS`), the bridge's route compared with the web's routes golden and, where the golden has a
# route, the same route walked by the web-rule walker.
# Writes packages/godot/docs/evidence/g5-<station>.md (commit it with the change it describes).
# Usage: bash packages/godot/run-evidence.sh [stationId]      (default: ikebukuro; shinjuku is the other plan)
# Output (gitignored): packages/godot/.cache/scenes. GODOT_BIN overrides the executable.
# On the shared host run it through the lock:  lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-evidence.sh
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"
if [[ ! -x "$godot_bin" ]]; then
  echo "Godot executable not found: $godot_bin" >&2
  exit 1
fi
station="${1:-ikebukuro}"
scenes_dir="$repo_root/packages/godot/.cache/scenes"
mkdir -p "$scenes_dir"
echo "Godot: $("$godot_bin" --version)"
pnpm tsx packages/godot/src/export-scene.ts "$station" "$scenes_dir/$station"
# One headless Godot process at a time. The test calls the router itself through the bridge, so no route file is
# pre-baked here: every expectation comes from the web golden the test reads.
"$godot_bin" --headless --path packages/godot --script res://tests/run_evidence_tests.gd -- "$scenes_dir" "$station"
