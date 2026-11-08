#!/bin/sh
# Lane F: clear a candidate run's artifacts without deleting another station's finished L2 pack (#1017).
#
# usage: tools/qa/clear-artifacts.sh <artifacts-dir>
#
# Creates the directory when missing, then removes every entry in it except directories named l2-pack-*.
# Kept packs keep l2-review.md, l2-pack.json, sheets/ and manifest.json; their l2-review.md links to
# ../evidence/... paths that the next run deletes, so those links dangle (accepted in #1017).
set -eu

dir=${1:?usage: tools/qa/clear-artifacts.sh <artifacts-dir>}
# A symlinked artifacts dir is removed as a link, as the old rm -rf did; its target is never emptied.
if [ -L "$dir" ]; then rm -f "$dir"; fi
mkdir -p "$dir"
for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name=${entry##*/}
  case "$name" in
    l2-pack-*) if [ -d "$entry" ] && [ ! -L "$entry" ]; then continue; fi ;;
  esac
  rm -rf "$entry"
done
