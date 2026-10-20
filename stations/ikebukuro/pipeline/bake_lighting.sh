#!/bin/sh
# Bake the B1 lightmap and write the shipped WebP files (Homebrew: blender, webp, imagemagick).
# The lossless PNG and the fixture record stay in build/ (not shipped, not committed).
set -eu
cd "$(dirname "$0")/../../.."
S=stations/ikebukuro
blender -b --factory-startup --python $S/pipeline/blender_bake_lighting.py -- \
  $S/gteki/assets/ikebukuro_b1.glb $S/gteki/assets/ikebukuro_b1_lit.glb \
  $S/build/ikebukuro_b1_lightmap.png --size 4096 --samples 64 --device "${DEVICE:-GPU}"
cwebp -quiet -q 90 -m 6 $S/build/ikebukuro_b1_lightmap.png -o $S/gteki/assets/ikebukuro_b1_lightmap.webp
magick $S/build/ikebukuro_b1_lightmap.png -resize 2048x2048 -define webp:method=6 -quality 90 \
  $S/gteki/assets/ikebukuro_b1_lightmap_2k.webp
python3 -I $S/pipeline/record_lightmaps.py
ls -l $S/gteki/assets/
