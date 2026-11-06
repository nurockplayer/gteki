#!/bin/sh
# #826 gate regeneration / diagnosis, 2026-11-05 JST. Container-only source instrumentation.
# usage: sh .qa/826/regenerate-gates.sh <phase> <station>...
#   phase names the output directory: .qa/826/<phase>/<station>/{audit,...}.json
#   The audit dump is the diagnosis input (failureEdges, snapDiagnosis, bakeProvenance.links).
set -eu
phase="${1:?usage: regenerate-gates.sh <phase> <station>...}"
shift
[ "$#" -ge 1 ] || { echo "no station given" >&2; exit 2; }
export QA_OUT=".qa/826/$phase"
mkdir -p "$QA_OUT"
python3 - <<'PY'
import os
from pathlib import Path
out = os.environ["QA_OUT"]
p = Path('packages/godot/src/navmesh-fallback.ts'); s = p.read_text()
assert s.count('timeout:900_000') == 1
needle = '  const result=measureFallbacks(station,undefined,!!baselineDest);'
assert s.count(needle) == 1
s = s.replace(needle, needle + '\n  fs.mkdirSync(`${process.env.QA_OUT}/${station}`,{recursive:true}); fs.writeFileSync(`${process.env.QA_OUT}/${station}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)
p = Path('packages/godot/src/navmesh-audit.ts'); s = p.read_text()
needle = '  const edgePath = (route: RouteResult, step: RouteStep): Entry => {'
assert s.count(needle) == 1
s = s.replace(needle, '  const qaUnexpectedLinks=new Map<string,number[]>();\n' + needle, 1)
needle = 'if (path?.some(p=>p.link)) { pathRejection="unexpected_link"; path=null; }'
assert s.count(needle) == 1
s = s.replace(needle, 'if (path?.some(p=>p.link)) { qaUnexpectedLinks.set(key,path.flatMap(p=>p.link ? [p.link.userId] : [])); pathRejection="unexpected_link"; path=null; }', 1)
needle = 'JSON.stringify({ ...result, navPaths,'
assert s.count(needle) == 1
s = s.replace(needle, 'JSON.stringify({ ...result, qaFallbackPolylines:[...cache.values()].filter(e=>e.missing).map(e=>{const before=routePolyline(bundle,{nodeIds:[e.step.fromNodeId,e.step.toNodeId],steps:[e.step]} as RouteResult),detail:SampleDetail[]=[];const beforeAudit=auditPolyline(probe,before,{detail}),samples=resampleAudit(before);return {edgeId:e.step.edgeId,reversed:e.step.reversed,before,after:e.graph,beforeAudit,afterAudit:auditPolyline(probe,e.graph),offFloorBefore:detail.filter(d=>d.floor==="off").map(d=>({point:samples[d.i],floorZ:d.floorZ}))};}), qaUnexpectedLinks:[...qaUnexpectedLinks], qaEntries:[...cache.values()].map(e=>({step:e.step,missing:e.missing,reason:e.reason,suspect:e.suspect,pathRejection:e.pathRejection,connectivity:e.connectivity})), qaJoins:[...joinChecks], navPaths,', 1)
p.write_text(s)
print('Container-only: spawnSync timeout 900 s; audit diagnostics retained', flush=True)
PY
for station in "$@"; do
  dest="$QA_OUT/$station"
  mkdir -p "$dest"
  date '+%F %T %Z'
  echo "== $phase $station"
  pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox \
    --write "$dest/navmesh-fallback.json" \
    --write-baseline "$dest/navmesh-clip-baseline.json" \
    --write-suspect "$dest/navmesh-suspect.json" \
    --write-paths "$dest/navmesh-paths.json"
done
date '+%F %T %Z'
