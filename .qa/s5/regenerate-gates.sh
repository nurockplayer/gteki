#!/bin/sh
set -eu
python3 - <<'PY'
from pathlib import Path
p = Path('packages/godot/src/navmesh-fallback.ts')
s = p.read_text()
assert s.count('timeout:180_000') == 1
s = s.replace('timeout:180_000', 'timeout:600_000', 1)
s = s.replace('const result=measureFallbacks(station,undefined,!!baselineDest);', 'const result=measureFallbacks(station,undefined,!!baselineDest); fs.mkdirSync(`.qa/s5/regen-output/${station}`,{recursive:true}); fs.writeFileSync(`.qa/s5/regen-output/${station}/audit.json`,JSON.stringify(result.audit));')
p.write_text(s)
PY
for s in ikebukuro shinjuku; do
  pnpm tsx packages/godot/src/navmesh-fallback.ts --station "$s" --with-greybox --write "stations/$s/navmesh-fallback.json" --write-baseline "stations/$s/navmesh-clip-baseline.json" --write-suspect "stations/$s/navmesh-suspect.json" --write-paths "stations/$s/navmesh-paths.json"
  mkdir -p ".qa/s5/regen-output/$s"
  for f in navmesh-fallback navmesh-clip-baseline navmesh-suspect navmesh-paths; do
    cp "stations/$s/$f.json" ".qa/s5/regen-output/$s/$f.json"
  done
done
