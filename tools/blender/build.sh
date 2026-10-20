#!/bin/sh
# GTEki kit pipeline: generate -> validate -> Godot import -> Three.js load test.
#
#   tools/blender/build.sh            build + validate (writes assets/library)
#   tools/blender/build.sh all        build + validate + godot + web
#   tools/blender/build.sh validate|godot|web|repro
#
# Env: BLENDER (default blender), GODOT_BIN, CATALOG, OUT, TEX_RES, ONLY (comma ids).
# Installs only via Homebrew/pnpm (README); never npm/npx/yarn.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
BLENDER=${BLENDER:-blender}
CATALOG=${CATALOG:-$HERE/catalog/kit_v0_1.json}
OUT=${OUT:-$ROOT/assets/library}
TEX_RES=${TEX_RES:-1024}
REPORTS=$HERE/out
mkdir -p "$REPORTS"

build() {
    set -- --catalog "$CATALOG" --out "$OUT" --tex-res "$TEX_RES"
    if [ -n "${ONLY:-}" ]; then set -- "$@" --only "$ONLY"; fi
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$HERE/build.py" -- "$@"
}

validate() {
    python3 -I "$HERE/validate_glb.py" "$OUT"/glb/*.glb --report "$REPORTS/validate_report.json"
}

godot() {
    sh "$HERE/godot_import/run_import_test.sh" "$OUT/glb" "$REPORTS/godot"
}

web() {
    (cd "$HERE/web_preview" && pnpm install --frozen-lockfile && pnpm run load-test)
}

# The committed library is built with this Blender; GLBs embed the exporter
# version, so other versions are deterministic but produce different bytes.
CANONICAL_BLENDER=5.2
blender_version() {
    "$BLENDER" --version 2>/dev/null | sed -n '1s/^Blender \([0-9]*\.[0-9]*\).*/\1/p'
}

repro() {
    # two clean builds into temp dirs must produce byte-identical GLBs; with the
    # canonical Blender they must also match the checked-in library
    tmp=$(mktemp -d)
    version=$(blender_version)
    for run in a b; do
        GTEKI_TEX_CACHE="$tmp/tex_$run" OUT="$tmp/$run" build >/dev/null
        (cd "$tmp/$run/glb" && shasum -a 256 *.glb) >"$tmp/$run.sha"
    done
    if [ "$version" = "$CANONICAL_BLENDER" ]; then
        (cd "$OUT/glb" && shasum -a 256 *.glb) >"$tmp/library.sha"
        against="two clean builds and $OUT/glb"
    else
        cp "$tmp/a.sha" "$tmp/library.sha"
        against="two clean builds (Blender $version; library comparison needs $CANONICAL_BLENDER)"
    fi
    if diff "$tmp/a.sha" "$tmp/b.sha" && diff "$tmp/a.sha" "$tmp/library.sha"; then
        echo "repro: PASS ($(wc -l <"$tmp/a.sha" | tr -d ' ') GLBs identical across $against)"
        rm -rf "$tmp"
    else
        echo "repro: FAIL (outputs kept in $tmp)" >&2
        exit 1
    fi
}

case "${1:-default}" in
    default) build && validate ;;
    all) build && validate && godot && web ;;
    build) build ;;
    validate) validate ;;
    godot) godot ;;
    web) web ;;
    repro) repro ;;
    *) echo "usage: $0 [all|build|validate|godot|web|repro]" >&2; exit 2 ;;
esac
