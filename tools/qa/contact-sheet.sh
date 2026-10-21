#!/bin/sh
# Tile a sequence of walkthrough frames into one review image.
# usage: tools/qa/contact-sheet.sh <out.jpg> <columns> <frame.png>...
# Frames are tiled in argument order at 480 px wide; needs Homebrew ffmpeg.
set -eu
out=$1; cols=$2; shift 2
n=$#
[ "$n" -gt 0 ] || { echo "no frames" >&2; exit 1; }
rows=$(( (n + cols - 1) / cols ))
list=$(mktemp)
trap 'rm -f "$list"' EXIT
for f in "$@"; do printf "file '%s'\n" "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" >> "$list"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$list" -vf "scale=480:-1,tile=${cols}x${rows}:padding=4:color=black" -frames:v 1 -q:v 3 "$out"
echo "$out ($n frames, ${cols}x${rows})"
