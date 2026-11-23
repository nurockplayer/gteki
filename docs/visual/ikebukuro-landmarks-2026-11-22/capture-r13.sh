#!/bin/sh
# origin/main and candidate capture, 2026-11-24 JST.
set -eu
cd /Users/tachikoma/Developer/gteki-wt/depato-ikebukuro
snapshot="$PWD/node_modules/.cache/depato-main"
mkdir -p "$snapshot"
git archive origin/main | tar -xf - -C "$snapshot"
ln -s "$PWD/node_modules" "$snapshot/node_modules"
ln -s "$PWD/apps/web/node_modules" "$snapshot/apps/web/node_modules"
nice -n 15 ego-browser nodejs --session ikb-package-ai-r13 --timeout-ms 1500000 < docs/visual/ikebukuro-landmarks-2026-11-22/capture-r13.mjs
nice -n 15 ego-browser nodejs --session ikb-package-ai-r13-finish -e "const entry=(await listTaskSpaces()).find(s=>s.id===50||s.name==='Ikebukuro Package A-I follow-up');if(entry)await(await taskSpace(entry.id)).finish({keep:[]});"
