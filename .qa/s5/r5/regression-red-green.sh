#!/bin/sh
# Container-only replay of the removed fallback argument, 2026-11-04 JST.
set -eu
python3 - <<'PY'
from pathlib import Path
p=Path('packages/godot/src/navmesh-audit.ts');s=p.read_text()
Path('/tmp/s5-r5-audit-fixed.ts').write_text(s)
needle='return routePolyline(bundle,route,connectorPaths);'
assert s.count(needle)==1
p.write_text(s.replace(needle,'return routePolyline(bundle,route);',1))
PY
set +e
pnpm vitest run packages/godot/src/navmesh-audit.test.ts --maxWorkers=1 -t 'keeps a snap_failed stair fallback' > /tmp/s5-r5-red.log 2>&1
red_status=$?
set -e
python3 - <<'PY'
from pathlib import Path
Path('packages/godot/src/navmesh-audit.ts').write_text(Path('/tmp/s5-r5-audit-fixed.ts').read_text())
s=Path('/tmp/s5-r5-red.log').read_text()
assert 'AssertionError' in s and 'offFloor' in s, s[-2000:]
PY
if [ "$red_status" -eq 0 ]; then
  echo 'Regression did not fail without the fix'
  exit 1
fi
tail -n 25 /tmp/s5-r5-red.log
printf 'REGRESSION RED: old fallback construction rejected, exit %s\n' "$red_status"
pnpm vitest run packages/godot/src/navmesh-audit.test.ts --maxWorkers=1 -t 'keeps a snap_failed stair fallback'
