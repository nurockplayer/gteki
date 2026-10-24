#!/usr/bin/env bash
set -euo pipefail

# G-5: sweep tools/showcase_compare.gd tuning overrides in one GPU slot without editing code between runs.
# Usage:
#   bash packages/godot/tools/showcase_sweep.sh <absolute.glb> <out_dir> <camera> <absolute reference image> \
#     <sweep file> [extra showcase arguments ...]
# Each non-empty line of the sweep file is "<tag> <--tune=... arguments...>"; '#' starts a comment. Every line runs
# the README's showcase command once, sequentially, under the shared host lock. Each run writes its report to
# <out_dir>/sweep_<tag>_report.json (passed with --report), so a run cannot pick up another run's report. The final
# table shows each tag's luminance ratios (godot / reference).
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
out_dir="$(cd "$out_dir" && pwd)"

# Read every line before running anything: a malformed or repeated tag must fail here, not halfway through a sweep.
lines=()
seen_tags=" "
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  words=()
  read -r -a words <<< "$line"
  if [[ ${#words[@]} -eq 0 ]]; then
    continue
  fi
  tag="${words[0]}"
  if [[ ! "$tag" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "showcase_sweep: tag must be letters, digits, '_', '.' or '-': $tag" >&2
    exit 1
  fi
  if [[ "$seen_tags" == *" $tag "* ]]; then
    echo "showcase_sweep: duplicate tag in $sweeps: $tag" >&2
    exit 1
  fi
  seen_tags="$seen_tags$tag "
  lines+=("$line")
done < "$sweeps"

if [[ ${#lines[@]} -eq 0 ]]; then
  echo "showcase_sweep: no sweep lines in $sweeps" >&2
  exit 1
fi

tags=()
reports=()
for line in "${lines[@]}"; do
  words=()
  read -r -a words <<< "$line"
  tag="${words[0]}"
  report="$out_dir/sweep_${tag}_report.json"
  args=("$glb" "$out_dir" "--camera=$camera" "--ref=$camera=$reference" "--tag=$tag" "--report=$report")
  if [[ ${#words[@]} -gt 1 ]]; then
    args+=("${words[@]:1}")
  fi
  if [[ ${#extra[@]} -gt 0 ]]; then
    args+=("${extra[@]}")
  fi
  echo "showcase_sweep: $tag"
  # Delete first: a run that exits 0 without writing (the headless early exit) must not pass off a stale report.
  rm -f "$report"
  lockf -k /tmp/gteki-local-test.lock "$godot_bin" --path "$project_dir" --rendering-method forward_plus \
    --script res://tools/showcase_compare.gd -- "${args[@]}"
  if [[ ! -f "$report" ]]; then
    echo "showcase_sweep: no report written for tag $tag: $report" >&2
    exit 1
  fi
  tags+=("$tag")
  reports+=("$report")
done

pairs=()
index=0
while [[ $index -lt ${#reports[@]} ]]; do
  pairs+=("${tags[$index]}" "${reports[$index]}")
  index=$((index + 1))
done
python3 -I "$project_dir/tools/showcase_sweep_table.py" "$camera" "${pairs[@]}"
