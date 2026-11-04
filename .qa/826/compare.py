# #826 shrink-only comparison, 2026-11-05 JST.
# before = the committed gate files (stations/<station>, i.e. main at this branch's base)
# after  = .qa/826/<phase>/<station> produced by regenerate-gates.sh
# usage: python3 .qa/826/compare.py <phase> [station...]
import json, subprocess, sys
from pathlib import Path
root = Path('.qa/826')
phase = sys.argv[1] if len(sys.argv) > 1 else 'diag'
stations = sys.argv[2:] or ['shinjuku', 'ikebukuro']
errors = []
rows = {}
TARGET = ['82c9a2c2cd704a348fbeb423d07cb125', '6ac033af77914fe5a9786676088b952c',
          '65edd7ca50844b609d4dcb25bd296936', 'ed7e56a8e6234197be06280fcb24aecc']

def load(directory, name):
    return json.loads((directory / (name + '.json')).read_text())

for station in stations:
    before, after = Path('stations') / station, root / phase / station
    if not after.exists():
        errors.append(f'{station}: no output directory {after}')
        continue
    old, new = [load(p, 'navmesh-clip-baseline') for p in [before, after]]
    fa, fb = [load(p, 'navmesh-fallback') for p in [before, after]]
    pa, pb = [load(p, 'navmesh-paths') for p in [before, after]]
    graph = load(Path('stations') / station / 'gteki', 'graph')
    pois = load(Path('stations') / station / 'gteki', 'pois')
    exits = {n for p in (pois if isinstance(pois, list) else pois['pois']) if p['category'] == 'exit' for n in p['connectorNodeIds']}
    edges = {e['id']: e for e in graph['edges']}

    def exit_snap(entry):
        edge = edges[entry['edgeId']]
        return entry['mode'] == 'stairs' and entry['reason'] == 'snap_failed' and (edge['from'] in exits or edge['to'] in exits)

    values = {'fallback': (len(fa), len(fb))}
    for field in ['unvalidatedJoins', 'invalidJoins', 'connectorWallHits', 'fallbackWallHits',
                  'navmeshWallHits', 'offFloor', 'failedRoutePairs']:
        values[field] = (old['total'][field], new['total'][field])
    values['detours'] = (len(pa['detours']), len(pb['detours']))
    values['exit-stair snap_failed'] = (sum(map(exit_snap, fa)), sum(map(exit_snap, fb)))
    values['routablePairs'] = (old['total']['routablePairs'], new['total']['routablePairs'])
    rows[station] = values
    for name in ['navmesh-fallback', 'navmesh-suspect']:
        a, b = [{e['edgeId'] for e in load(p, name)} for p in [before, after]]
        if b - a:
            errors.append(f'{station} {name} added edges: {sorted(b - a)}')
    if set(pb['detours']) - set(pa['detours']):
        errors.append(f'{station} detours added: {sorted(set(pb["detours"]) - set(pa["detours"]))}')
    for edge, counters in new.items():
        for field, value in counters.items():
            if field in ['suspectPolyline', 'suspectPolylineEdges']:
                continue
            was = old.get(edge, {}).get(field, 0)
            if (value < was if field == 'routablePairs' else value > was):
                errors.append(f'{station} {edge}.{field}: {was} -> {value}')
    audit = load(after, 'audit')
    if audit['navPathsRejected']:
        errors.append(f'{station} rejected published paths: {audit["navPathsRejected"]}')
    if audit['completeAuditedRoutes'] + audit['incompleteRoutes'] + audit['suspectPolyline']['routes'] != audit['auditedRoutePairs']:
        errors.append(f'{station} route outcome partition mismatch')
    flagged = {e for e, d in pb['edges'].items() if d.get('suspectPolyline')}
    if flagged != {e['edgeId'] for e in load(after, 'navmesh-suspect')}:
        errors.append(f'{station} suspect flags disagree with list')
    for kind in ['navmesh', 'connector']:
        if audit['uniqueEdgeScene'][kind]['noFloor'] or audit['segmentTotals']['sceneRaycast'][kind]['noFloor']:
            errors.append(f'{station} {kind} samples without floor')
    if audit['fallbackAudit']['totals']['noFloor']:
        errors.append(f'{station} fallback samples without floor')
    print(station, 'suspectPolyline:', audit['suspectPolyline'], '(excluded from pass)')
    print(station, 'fallback after:', fb)
    print(station, 'routes complete/incomplete/suspect:', audit['completeAuditedRoutes'],
          audit['incompleteRoutes'], audit['suspectPolyline']['routes'])
    print(station, 'links failed after:', audit['bakeProvenance']['links']['failed'])
    print(station, 'snapRejections:', audit['bakeProvenance'].get('snapRejections'))
    # #826: the four edges' before/after status.
    published = {e for d in (pa['edges'], pb['edges']) for e in d}
    for target in TARGET:
        eid = 'e:' + target
        if eid not in edges:
            continue
        fba = [e for e in fa if e['edgeId'] == eid]
        fbb = [e for e in fb if e['edgeId'] == eid]
        fe = [e for e in audit.get('failureEdges', []) if e.get('edgeId') in (eid, target)]
        print(f'{station} {eid} {edges[eid]["mode"]}: path {eid in published} (before {eid in pa["edges"]})',
              '| fallback', [(x['reason'], x.get('connectivity')) for x in fba], '->', [(x['reason'], x.get('connectivity')) for x in fbb],
              '| failureEdges', fe if len(fe) else 'none')
        print(f'   snapDiagnosis:', [d for d in audit.get('snapDiagnosis', []) if str(d).find(target) >= 0])
    print()

print('| Metric | ' + ' | '.join(f'{s} main -> {phase}' for s in rows) + ' |')
print('|---|' + '---:|' * len(rows))
for metric in rows[stations[0]] if stations[0] in rows else []:
    print('| ' + metric + ' | ' + ' | '.join(f'{rows[s][metric][0]} -> {rows[s][metric][1]}' for s in rows) + ' |')
print('SHRINK-ONLY ' + ('FAIL' if errors else 'PASS'))
for e in errors:
    print(e)
try:
    base = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
except OSError:
    base = 'UNKNOWN'
out = root / phase / 'comparison.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'phase': phase, 'base': base, 'counts': rows, 'errors': errors}, indent=2) + '\n')
raise SystemExit(1 if errors else 0)
