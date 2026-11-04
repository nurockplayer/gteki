#!/bin/sh
# Round 4 measurement, 2026-11-04 JST. Container-only source instrumentation.
set -eu
python3 - <<'PY'
from pathlib import Path
p=Path('packages/godot/src/navmesh-fallback.ts'); s=p.read_text()
assert s.count('timeout:180_000')==1
s=s.replace('timeout:180_000','timeout:900_000',1)
needle='  const result=measureFallbacks(station,undefined,!!baselineDest);'
assert s.count(needle)==1
s=s.replace(needle,needle+'\n  fs.writeFileSync(`.qa/s5/r4/${station}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)
p=Path('packages/godot/src/navmesh-audit.ts');s=p.read_text()
needle='  const edgePath = (route: RouteResult, step: RouteStep): Entry => {'
assert s.count(needle)==1
s=s.replace(needle,'  const qaUnexpectedLinks=new Map<string,number[]>();\n'+needle,1)
needle='if (path?.some(p=>p.link)) { pathRejection="unexpected_link"; path=null; }'
assert s.count(needle)==1
s=s.replace(needle,'if (path?.some(p=>p.link)) { qaUnexpectedLinks.set(key,path.flatMap(p=>p.link ? [p.link.userId] : [])); pathRejection="unexpected_link"; path=null; }',1)
needle='JSON.stringify({ ...result, navPaths,'
assert s.count(needle)==1
s=s.replace(needle,'JSON.stringify({ ...result, qaUnexpectedLinks:[...qaUnexpectedLinks], qaEntries:[...cache.values()].map(e=>({step:e.step,missing:e.missing,reason:e.reason,suspect:e.suspect,pathRejection:e.pathRejection,connectivity:e.connectivity})), qaJoins:[...joinChecks], navPaths,',1)
p.write_text(s)
print('Container-only spawnSync timeout: 900 s; retained audit diagnostics',flush=True)
PY
for station in ikebukuro shinjuku; do
  dest=".qa/s5/r4/$station"
  mkdir -p "$dest"
  date '+%F %T %Z'
  pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$station" --with-greybox --write "$dest/navmesh-fallback.json" --write-baseline "$dest/navmesh-clip-baseline.json" --write-suspect "$dest/navmesh-suspect.json" --write-paths "$dest/navmesh-paths.json"
done
