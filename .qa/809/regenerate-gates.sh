#!/bin/sh
# #809 measurement. Container-only source instrumentation (copied from .qa/s5/r5).
# Usage: sh .qa/809/regenerate-gates.sh <diag|after> [station...]
set -eu
phase=${1:?phase}; shift
python3 - "$phase" <<'PY'
import sys
from pathlib import Path
phase=sys.argv[1]
p=Path('packages/godot/src/navmesh-fallback.ts'); s=p.read_text()
assert s.count('timeout:180_000')==1
s=s.replace('timeout:180_000','timeout:900_000',1)
needle='  const result=measureFallbacks(station,undefined,!!baselineDest);'
assert s.count(needle)==1
s=s.replace(needle,needle+f'\n  fs.writeFileSync(`.qa/809/{phase}/${{station}}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)
if phase=='diag':
  p=Path('packages/godot/src/navmesh-audit.ts'); s=p.read_text()
  needle='  const edgePath = (route: RouteResult, step: RouteStep): Entry => {'
  assert s.count(needle)==1
  s=s.replace(needle,'  const qaIncomplete:unknown[]=[];\n'+needle,1)
  needle='''    if (entries.some(e => !e.points?.length)) {
      incomplete++;'''
  assert s.count(needle)==1
  s=s.replace(needle,needle+'''
      qaIncomplete.push({from:from.id,to:to.id,kind:"entry",failures:entries.filter(e=>!e.points?.length).map(e=>({edgeId:e.step.edgeId,mode:e.step.mode,reason:e.reason,connectivity:e.connectivity,fromSnapped:e.fromSnapped,toSnapped:e.toSnapped}))});''',1)
  needle='    if (!assembled.points) { incomplete++; if(assembled.reason==="join_gap") {invalidJoinRoutes++;} continue; }'
  assert s.count(needle)==1
  s=s.replace(needle,'''    if (!assembled.points) { incomplete++; if(assembled.reason==="join_gap") {invalidJoinRoutes++;} qaIncomplete.push({from:from.id,to:to.id,kind:"assembly",reason:assembled.reason,edges:entries.map(e=>e.step.edgeId)}); continue; }''',1)
  needle='JSON.stringify({ ...result, navPaths,'
  assert s.count(needle)==1
  s=s.replace(needle,'JSON.stringify({ ...result, qaIncomplete, navPaths,',1)
  p.write_text(s)
print(f'Container-only instrumentation for {phase}',flush=True)
PY
for station in "$@"; do
  dest=".qa/809/$phase/$station"
  mkdir -p "$dest"
  date '+%F %T %Z'
  pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox --write "$dest/navmesh-fallback.json" --write-baseline "$dest/navmesh-clip-baseline.json" --write-suspect "$dest/navmesh-suspect.json" --write-paths "$dest/navmesh-paths.json"
done
