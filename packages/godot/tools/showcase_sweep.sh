#!/usr/bin/env bash
set -euo pipefail

# G-5: sweep tools/showcase_compare.gd tuning overrides in one GPU slot without editing code between runs.
# Usage:
#   bash packages/godot/tools/showcase_sweep.sh <absolute.glb> <out_dir> <camera> <absolute reference image> \
#     <sweep file> [extra showcase arguments ...]
# Each non-empty line of the sweep file is "<tag> <--tune=... arguments...>"; '#' starts a comment. Every line runs
# the README's showcase command once, sequentially, under the shared host lock, and writes tagged PNGs and a
# <layout>_<tag>_report.json. The final table shows each tag's luminance ratios (godot / reference).
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
project_dir="$repo_root/packages/godot"
godot_bin="${GODOT_BIN:-/opt/homebrew/bin/godot}"

usage() {
  echo "usage: showcase_sweep.sh <absolute.glb> <out_dir> <camera> <absolute reference image> <sweep file> [extra args...]" >&2
  exit 2
}

if [[ $# -lt 5 ]]; then
  usage
fi
glb="$1"
out_dir="$2"
camera="$3"
reference="$4"
sweeps="$5"
shift 5
extra=("$@")

if [[ ! -f "$sweeps" ]]; then
  echo "showcase_sweep: sweep file not found: $sweeps" >&2
  exit 1
fi
if [[ ! -x "$godot_bin" ]]; then
  echo "showcase_sweep: Godot executable not found: $godot_bin" >&2
  exit 1
fi
mkdir -p "$out_dir"

tags=()
reports=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  words=()
  read -r -a words <<< "$line"
  if [[ ${#words[@]} -eq 0 ]]; then
    continue
  fi
  tag="${words[0]}"
  args=("$glb" "$out_dir" "--camera=$camera" "--ref=$camera=$reference" "--tag=$tag")
  if [[ ${#words[@]} -gt 1 ]]; then
    args+=("${words[@]:1}")
  fi
  if [[ ${#extra[@]} -gt 0 ]]; then
    args+=("${extra[@]}")
  fi
  echo "showcase_sweep: $tag"
  lockf -k /tmp/gteki-local-test.lock "$godot_bin" --path "$project_dir" --rendering-method forward_plus \
    --script res://tools/showcase_compare.gd -- "${args[@]}"
  # A tag suffixes the report name, so a rerun of one line replaces only its own report (the newest match).
  report="$(ls -t "$out_dir"/*_"${tag}"_report.json 2>/dev/null | head -n 1 || true)"
  if [[ -z "$report" ]]; then
    echo "showcase_sweep: no report written for tag $tag in $out_dir" >&2
    exit 1
  fi
  tags+=("$tag")
  reports+=("$report")
done < "$sweeps"

if [[ ${#reports[@]} -eq 0 ]]; then
  echo "showcase_sweep: no sweep lines in $sweeps" >&2
  exit 1
fi

pairs=()
index=0
while [[ $index -lt ${#reports[@]} ]]; do
  pairs+=("${tags[$index]}" "${reports[$index]}")
  index=$((index + 1))
done
python3 -I "$project_dir/tools/showcase_sweep_table.py" "$camera" "${pairs[@]}"
