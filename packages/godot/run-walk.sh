#!/usr/bin/env bash
set -euo pipefail

# G-2: export the station snapshots and the Ikebukuro route (JR Central Gate 2 -> Exit 35, from the TypeScript router),
# then run the headless walk replay: web-rule walker, follow camera, wall/step rules, route polyline replay.
# Usage: bash packages/godot/run-walk.sh [stationId ...]      (default: ikebukuro shinjuku)
# Output (gitignored): packages/godot/.cache/{scenes,routes}. GODOT_BIN overrides the executable.
# On the shared host run it through the lock:  lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-walk.sh
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"
if [[ ! -x "$godot_bin" ]]; then
  echo "Godot executable not found: $godot_bin" >&2
  exit 1
fi
stations=("$@")
if [[ ${#stations[@]} -eq 0 ]]; then
  stations=(ikebukuro shinjuku)
fi
scenes_dir="$repo_root/packages/godot/.cache/scenes"
routes_dir="$repo_root/packages/godot/.cache/routes"
mkdir -p "$routes_dir"
rm -f "$routes_dir"/*.route.json
echo "Godot: $("$godot_bin" --version)"
for station in "${stations[@]}"; do
  pnpm tsx packages/godot/src/export-scene.ts "$station" "$scenes_dir/$station"
  if [[ "$station" == "ikebukuro" ]]; then
    pnpm tsx packages/cli/src/route.ts stations/ikebukuro g_jr_c2 x35 > "$routes_dir/ikebukuro.route.json"
  fi
done
# One headless Godot process at a time.
"$godot_bin" --headless --path packages/godot --script res://tests/run_walk_tests.gd -- "$scenes_dir" "$routes_dir" "${stations[@]}"
