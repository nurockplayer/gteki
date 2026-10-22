#!/bin/sh
# GTEki kit pipeline: generate -> validate -> Godot import -> Three.js load test.
#
#   tools/blender/build.sh            build + validate (writes assets/library)
#   tools/blender/build.sh all        build + validate + godot + web
#   tools/blender/build.sh validate|selftest|godot|web|repro
#   tools/blender/build.sh finishes   finish pack only: build + validate (build-finishes, validate-finishes, repro-finishes)
#
# Env: BLENDER (default blender), GODOT_BIN, CATALOG, OUT, TEX_RES, ONLY (comma ids),
#      PROFILE (full | mobile; mobile defaults OUT to assets/library/mobile).
# The finish pack (catalog/finishes_v0_1.json) goes to $OUT/finishes: build, validate, godot, web and
# repro cover it too. It is built with the kit's default catalog only, and not for ONLY subsets.
# Mobile finishes use half the texture size (512 at most).
# Installs only via Homebrew/pnpm (README); never npm/npx/yarn.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
BLENDER=${BLENDER:-blender}
CATALOG=${CATALOG:-$HERE/catalog/kit_v0_1.json}
PROFILE=${PROFILE:-full}
if [ "$PROFILE" = mobile ]; then OUT=${OUT:-$ROOT/assets/library/mobile}; else OUT=${OUT:-$ROOT/assets/library}; fi
case "$OUT" in /*) ;; *) OUT=$PWD/$OUT ;; esac  # steps below change directory (web)
TEX_RES=${TEX_RES:-1024}
REPORTS=$HERE/out
mkdir -p "$REPORTS"
FINISHES=${FINISHES:-$HERE/catalog/finishes_v0_1.json}
FINISH_OUT=$OUT/finishes
if [ "$PROFILE" = mobile ]; then FINISH_TEX_RES=${FINISH_TEX_RES:-$((TEX_RES / 2 > 512 ? 512 : TEX_RES / 2))}; else FINISH_TEX_RES=${FINISH_TEX_RES:-$TEX_RES}; fi

# the finish pack accompanies the default kit catalog (not a station catalog or an ONLY subset)
with_finishes() {
    [ -z "${ONLY:-}" ] && [ "$CATALOG" = "$HERE/catalog/kit_v0_1.json" ]
}

build_finishes() {
    set -- --catalog "$FINISHES" --out "$FINISH_OUT" --tex-res "$FINISH_TEX_RES" --profile "$PROFILE"
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$HERE/build.py" -- "$@"
}

build_kit() {
    set -- --catalog "$CATALOG" --out "$OUT" --tex-res "$TEX_RES" --profile "$PROFILE"
    if [ -n "${ONLY:-}" ]; then set -- "$@" --only "$ONLY"; fi
    "$BLENDER" -b --factory-startup --python-exit-code 1 -P "$HERE/build.py" -- "$@"
}

validate_kit() {
    # explicit returns: errexit is off inside a function called from an && list (`all`)
    python3 -I "$HERE/validate_glb.py" "$OUT"/glb/*.glb --report "$REPORTS/validate_report.json" || return $?
    # texture plan rules for any library; byte limits only for the library they describe
    budget=$HERE/catalog/budget.json
    if [ "$PROFILE" != full ]; then budget=$HERE/catalog/budget_$PROFILE.json; fi
    if python3 -I "$HERE/texture_budget.py" "$OUT" --check "$budget" \
        --json "$REPORTS/texture_budget.json" >"$REPORTS/texture_budget.txt"; then
        tail -n 3 "$REPORTS/texture_budget.txt"
    else
        cat "$REPORTS/texture_budget.txt" >&2
        return 1
    fi
}

validate_finishes() {
    python3 -I "$HERE/validate_glb.py" "$FINISH_OUT"/glb/*.glb --report "$REPORTS/validate_finishes_report.json" || return $?
    python3 -I "$HERE/validate_finish.py" "$FINISH_OUT" --report "$REPORTS/validate_finishes_pack.json"
}

selftest() {
    python3 -I "$HERE/validate_glb.py" --self-test || return $?
    python3 -I "$HERE/validate_finish.py" --self-test || return $?
    python3 -I "$HERE/texture_budget.py" --self-test || return $?
    python3 -I "$HERE/bundle_kit.py" --self-test || return $?
}

godot_kit() {
    sh "$HERE/godot_import/run_import_test.sh" "$OUT/glb" "$REPORTS/godot"
}

godot_finishes() {
    sh "$HERE/godot_import/run_import_test.sh" "$FINISH_OUT/glb" "$REPORTS/godot_finishes"
}

web_kit() {
    (cd "$HERE/web_preview" && pnpm install --frozen-lockfile && GTEKI_LIBRARY_DIR="$OUT" pnpm run load-test)
}

web_finishes() {
    (cd "$HERE/web_preview" && pnpm install --frozen-lockfile && GTEKI_LIBRARY_DIR="$FINISH_OUT" pnpm run load-test)
}

# kit steps, then the finish pack's (when it accompanies this build)
build() { build_kit && { ! with_finishes || build_finishes; }; }
validate() { validate_kit && { ! with_finishes || validate_finishes; }; }
godot() { godot_kit && { ! with_finishes || godot_finishes; }; }
web() { web_kit && { ! with_finishes || web_finishes; }; }

# The committed library is built with this Blender; GLBs embed the exporter
# version, so other versions are deterministic but produce different bytes.
CANONICAL_BLENDER=5.2
blender_version() {
    "$BLENDER" --version 2>/dev/null | sed -n '1s/^Blender \([0-9]*\.[0-9]*\).*/\1/p'
}

# sha256 of every file in a finish pack. The manifest's "catalog" line is a path relative to the
# output directory, so it differs between a temp build and the library: hash the manifest without it.
pack_sha() {
    (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
        if [ "$f" = ./manifest.json ]; then
            printf '%s  %s\n' "$(grep -v '^  "catalog":' "$f" | shasum -a 256 | cut -d' ' -f1)" "$f"
        else
            shasum -a 256 "$f"
        fi
    done)
}

repro_finishes() {
    # two clean builds of the finish pack: every file (maps, finish.json, sample GLBs, manifest)
    # must be byte-identical (bar the manifest's catalog path), and with the canonical Blender
    # identical to the checked-in pack
    tmp=$(mktemp -d)
    version=$(blender_version)
    committed=$FINISH_OUT  # the per-run FINISH_OUT assignments below may outlive the call
    for run in a b; do
        GTEKI_TEX_CACHE="$tmp/tex_$run" FINISH_OUT="$tmp/$run" build_finishes >/dev/null
        pack_sha "$tmp/$run" >"$tmp/$run.sha"
    done
    if [ "$version" = "$CANONICAL_BLENDER" ]; then
        pack_sha "$committed" >"$tmp/library.sha"
        against="two clean builds and $committed"
    else
        cp "$tmp/a.sha" "$tmp/library.sha"
        against="two clean builds (Blender $version; library comparison needs $CANONICAL_BLENDER)"
    fi
    if diff "$tmp/a.sha" "$tmp/b.sha" && diff "$tmp/a.sha" "$tmp/library.sha"; then
        echo "repro finishes: PASS ($(wc -l <"$tmp/a.sha" | tr -d ' ') files identical across $against)"
        rm -rf "$tmp"
    else
        echo "repro finishes: FAIL (outputs kept in $tmp)" >&2
        exit 1
    fi
}

repro_kit() {
    # two clean builds into temp dirs must produce byte-identical GLBs; with the
    # canonical Blender they must also match the checked-in library
    tmp=$(mktemp -d)
    version=$(blender_version)
    for run in a b; do
        GTEKI_TEX_CACHE="$tmp/tex_$run" OUT="$tmp/$run" build_kit >/dev/null
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

repro() {
    repro_kit
    if with_finishes; then repro_finishes; fi
}

case "${1:-default}" in
    default) build && validate ;;
    all) build && validate && godot && web ;;
    build) build ;;
    validate) validate ;;
    selftest) selftest ;;
    finishes) build_finishes && validate_finishes ;;
    build-finishes) build_finishes ;;
    validate-finishes) validate_finishes ;;
    repro-finishes) repro_finishes ;;
    godot) godot ;;
    web) web ;;
    repro) repro ;;
    *) echo "usage: $0 [all|build|validate|selftest|godot|web|repro|finishes|build-finishes|validate-finishes|repro-finishes]" >&2; exit 2 ;;
esac
