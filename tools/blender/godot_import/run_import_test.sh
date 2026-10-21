#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
GODOT_BIN=${GODOT_BIN:-/opt/homebrew/bin/godot}
MODE=report
if [ "${1:-}" = "--screenshot" ]; then
    MODE=screenshot
    shift
fi
GLB_DIR=${1:-"$REPO_ROOT/assets/library/glb"}
OUT_DIR=${2:-"$SCRIPT_DIR/out"}

if [ ! -x "$GODOT_BIN" ]; then
    echo "Godot executable not found: $GODOT_BIN" >&2
    exit 2
fi
if [ ! -d "$GLB_DIR" ]; then
    echo "GLB directory not found: $GLB_DIR" >&2
    exit 2
fi

# Reject the staging directory as input before clearing it.
GLB_DIR=$(CDPATH= cd -- "$GLB_DIR" && pwd -P)
mkdir -p "$SCRIPT_DIR/kit" "$OUT_DIR"
KIT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/kit" && pwd -P)
case "$GLB_DIR" in
    "$KIT_DIR"|"$KIT_DIR"/*|"$SCRIPT_DIR/.godot"|"$SCRIPT_DIR/.godot"/*)
        echo "Input directory must be outside the disposable kit/import cache" >&2
        exit 2
        ;;
esac
OUT_DIR=$(CDPATH= cd -- "$OUT_DIR" && pwd)
set -- "$GLB_DIR"/*.glb
if [ ! -f "$1" ]; then
    echo "No .glb files found in $GLB_DIR" >&2
    exit 2
fi
case "$OUT_DIR" in
    "$KIT_DIR"|"$KIT_DIR"/*|"$SCRIPT_DIR/.godot"|"$SCRIPT_DIR/.godot"/*)
        echo "Output directory must be outside the disposable kit/import cache" >&2
        exit 2
        ;;
esac
# Godot may retain valid=false import metadata after a failed import, even when
# the source is restored. Always prove a fresh import with default settings.
# Both paths below are generated, ignored directories owned by this harness.
find "$KIT_DIR" -type f -delete
rm -rf -- "$SCRIPT_DIR/.godot"
for source in "$GLB_DIR"/*.glb; do
    cp "$source" "$SCRIPT_DIR/kit/"
done

export GTEKI_GODOT_OUT="$OUT_DIR"
# Expected collision/socket data; the manifest normally sits next to glb/.
if [ -z "${GTEKI_MANIFEST:-}" ] && [ -f "$GLB_DIR/../manifest.json" ]; then
    GTEKI_MANIFEST=$(CDPATH= cd -- "$GLB_DIR/.." && pwd -P)/manifest.json
fi
export GTEKI_MANIFEST="${GTEKI_MANIFEST:-}"
export GTEKI_GODOT_MODE="$MODE"
"$GODOT_BIN" --headless --path "$SCRIPT_DIR" --log-file "$OUT_DIR/godot_editor.log" --import
if [ "$MODE" = screenshot ]; then
    "$GODOT_BIN" --path "$SCRIPT_DIR" --log-file "$OUT_DIR/godot_screenshot.log" --script res://import_test.gd
else
    rm -f "$OUT_DIR/godot_import_report.json"
    "$GODOT_BIN" --headless --path "$SCRIPT_DIR" --log-file "$OUT_DIR/godot_report.log" --script res://import_test.gd
    # Godot exits 0 when the test script itself fails to parse; require its report.
    if [ ! -f "$OUT_DIR/godot_import_report.json" ]; then
        echo "Godot import test produced no report (script error?)" >&2
        exit 1
    fi
fi
