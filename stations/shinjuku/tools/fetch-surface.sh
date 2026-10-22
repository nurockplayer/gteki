#!/bin/sh
# Fetch the pinned official PLATEAU inputs outside the repository. Never refresh silently.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 - "$HERE/../sources/surface-manifest.json" "${GTEKI_RAW_SHINJUKU:-$HOME/Developer/gteki-raw/shinjuku}/plateau-bldg" <<'PY'
import hashlib, json, pathlib, sys, urllib.request
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
root = pathlib.Path(sys.argv[2]); root.mkdir(parents=True, exist_ok=True)
for f in manifest['files']:
    target = root / f['path']
    def valid(p):
        return p.exists() and p.stat().st_size == f['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest() == f['sha256']
    if not valid(target):
        temp = target.with_suffix(target.suffix + '.part')
        try:
            urllib.request.urlretrieve(f['url'], temp)
            if not valid(temp):
                raise SystemExit('Source changed: hash/bytes mismatch for ' + f['url'])
            temp.replace(target)
        finally:
            temp.unlink(missing_ok=True)
    print('verified', f['path'], f['sha256'])
PY
