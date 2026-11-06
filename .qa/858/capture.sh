#!/bin/sh
set -eu
rtk proxy git show origin/main:stations/shinjuku/scene/build.ts > stations/shinjuku/scene/build-858-base.ts
trap 'rm -f stations/shinjuku/scene/build-858-base.ts' EXIT
node .qa/858/capture.mjs
