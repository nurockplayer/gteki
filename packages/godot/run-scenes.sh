#!/usr/bin/env bash
set -euo pipefail

# G-1: export each station's real buildScene to a Godot-loadable snapshot, then run the headless snapshot tests.
# Usage: bash packages/godot/run-scenes.sh [stationId ...]      (default: ikebukuro shinjuku)
# Output (gitignored): packages/godot/.cache/scenes/<stationId>/{scene.glb,scene.json}. GODOT_BIN overrides the executable.
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
echo "Godot: $("$godot_bin" --version)"
for station in "${stations[@]}"; do
  pnpm tsx packages/godot/src/export-scene.ts "$station" "$scenes_dir/$station"
done
# One headless Godot process at a time; the snapshots are loaded and freed one station after the other.
"$godot_bin" --headless --path packages/godot --script res://tests/run_scene_tests.gd -- "$scenes_dir" "${stations[@]}"
# G-4b: the look profile builds the Environment from the sidecar and the material table only touches mapped surfaces.
"$godot_bin" --headless --path packages/godot --script res://tests/run_look_tests.gd -- "$scenes_dir" "${stations[@]}"
