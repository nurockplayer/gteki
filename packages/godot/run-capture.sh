#!/usr/bin/env bash
set -euo pipefail

# G-5b: headless checks of the capture pose list, the --perf argument rules and the performance report generator.
# The capture itself is windowed and runs in the lead's GPU slot (README, "GPU slot runbook"); nothing here renders, so
# no frame time is measured here.
# Usage: bash packages/godot/run-capture.sh [stationId ...]      (default: ikebukuro shinjuku)
# Output (gitignored): packages/godot/.cache/scenes. GODOT_BIN overrides the executable.
# The poses ask the real router for the evidence routes, so this needs `pnpm install` (like run-guide.sh).
# On the shared host run it through the lock:  lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-capture.sh
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
tmp="$(mktemp -d "${TMPDIR:-/tmp}/gteki-capture-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
echo "Godot: $("$godot_bin" --version)"
for station in "${stations[@]}"; do
  pnpm tsx packages/godot/src/export-scene.ts "$station" "$scenes_dir/$station"
done
# One headless Godot process at a time. Godot exits 0 even when a script fails to parse, so the PASS line is the gate.
"$godot_bin" --headless --path packages/godot --script res://tests/run_capture_tests.gd -- "$scenes_dir" "${stations[@]}" 2>&1 | tee "$tmp/capture-tests.log"
grep -q "^PASS: GTEki Godot capture checks" "$tmp/capture-tests.log" || { echo "FAIL: the capture checks did not pass" >&2; exit 1; }

# The client's own refusals, in the real client: no display means no perf figures (exit 0, nothing written), and a flag
# that makes no sense is an argument error (exit 2) before a station is even loaded.
client() { "$godot_bin" --headless --path packages/godot res://hq/hq.tscn -- "$@"; }
status=0
if out="$(client --capture="$tmp/refused" --perf=5 2>&1)"; then
  if ! grep -q "perf needs a display" <<<"$out"; then
    echo "FAIL: --perf on a headless display did not say 'perf needs a display': $out" >&2
    status=1
  fi
  if [[ -e "$tmp/refused/report.json" ]]; then
    echo "FAIL: --perf on a headless display wrote $tmp/refused/report.json" >&2
    status=1
  fi
else
  echo "FAIL: --perf on a headless display exited non-zero: $out" >&2
  status=1
fi
# Each case is a whole argument list on purpose, so the shell splits it into separate arguments.
for bad_args in "--perf=5" "--perf=soon --capture=$tmp/invalid" "--perf=0 --capture=$tmp/invalid"; do
  set +e
  out="$(client $bad_args 2>&1)"
  code=$?
  set -e
  if [[ "$code" != 2 ]]; then
    echo "FAIL: '-- $bad_args' exited $code, not 2: $out" >&2
    status=1
  fi
done
if [[ -e "$tmp/invalid/report.json" ]]; then
  echo "FAIL: a rejected argument list wrote $tmp/invalid/report.json" >&2
  status=1
fi
[[ "$status" == 0 ]] && echo "PASS: capture argument rules and the headless perf refusal"
exit "$status"
