#!/usr/bin/env bash
# Headless Godot collider check for Ikebukuro (issue #35): see godot_colliders.gd.
# Usage: sh pipeline/godot_colliders.sh [report.json] [--control]     (GODOT_BIN overrides /opt/homebrew/bin/godot)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
station_dir="$(cd "$here/.." && pwd)"
repo_root="$(cd "$station_dir/../.." && pwd)"
godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"
if [[ ! -x "$godot_bin" ]]; then
  echo "Godot executable not found: $godot_bin" >&2
  exit 1
fi
echo "Godot: $("$godot_bin" --version)"
# The addon lives in packages/godot, so that is the project; the check script sits next to the station data.
exec "$godot_bin" --headless --path "$repo_root/packages/godot" \
  --script "$here/godot_colliders.gd" -- "$station_dir" "$@"
