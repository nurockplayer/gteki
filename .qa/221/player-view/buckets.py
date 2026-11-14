# 2026-11-05 JST, #221 player-view re-check: bucket the saved camera-aware escape set by what a player can
# actually face. Inputs are read-only (the #221 main-recheck worktree) plus the station graph for floor ids.
#   bucket a: eye on a walkable flight and a view direction inside LOOK_PITCH (apps/web/src/explorer/identityFraming.ts:
#             min -1.1 rad, max 0.5 rad) -- the only directions a first-person camera can point at.
#   bucket b: the same eye position, but above the pitch ceiling (+28.6 deg), so no player can look there.
# `street` escapes leave through an opening at street level (the ray reaches geometry above the ground plane);
# `void` escapes hit nothing within 25 m, i.e. the ray leaves the built station with no surface in front of it.
import json, math, sys, collections, pathlib

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   '/Users/tachikoma/Developer/gteki/.claude/worktrees/p221f2/.qa/221/escape/main-bdc602b2')
CROSS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else
                    '/Users/tachikoma/Developer/gteki/.claude/worktrees/p221f2/.qa/221/fix2-crossings.json')
GRAPH = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else 'stations/shinjuku/gteki/graph.json')
PITCH_MAX = 0.5  # LOOK_PITCH.max, radians

S = json.loads((SRC / 'samples.json').read_text())
D = json.loads((SRC / 'directions.json').read_text())
E = json.loads((SRC / 'escapes.json').read_text())
X = {(r['sample'], r['direction']) for r in json.loads(CROSS.read_text())}
g = json.loads(GRAPH.read_text())
nodes = {n['id']: n for n in g['nodes']}
edges = {e['id']: e for e in g['edges']}

elev = [math.asin(max(-1.0, min(1.0, d[1]))) for d in D]
faceable = {i for i, e in enumerate(elev) if e <= PITCH_MAX + 1e-9}

rows = []
for i, j, hit in E:
    s = S[i]
    edge = edges.get(s['edgeId']) or {}
    end_floors = sorted({nodes.get(edge.get('from'), {}).get('floorId'), nodes.get(edge.get('to'), {}).get('floorId')} - {None})
    rows.append({
        'sample': i, 'direction': j, 'edgeId': s['edgeId'], 'mode': s['mode'], 'lateral': s['lateral'],
        'eyeZ': s['point']['z'], 'elevation': math.degrees(elev[j]),
        'excluded': (i, j) in X, 'faceable': j in faceable,
        'exit': 'void' if hit is None else ('street' if hit[1] > 1e-5 else 'below'),
        'hitY': None if hit is None else hit[1], 'floors': end_floors, 'lengthM': edge.get('lengthM'),
    })

kept = [r for r in rows if not r['excluded']]
a = [r for r in kept if r['faceable']]
b = [r for r in kept if not r['faceable']]
by_flight = collections.Counter((r['edgeId'], r['mode'], r['faceable']) for r in rows if not r['excluded'])


def summarise(rs):
    return {'rays': len(rs), 'void': sum(r['exit'] == 'void' for r in rs),
            'street': sum(r['exit'] == 'street' for r in rs),
            'lateral': dict(collections.Counter(r['lateral'] for r in rs)),
            'flights': len({r['edgeId'] for r in rs})}


out = {
    'src': str(SRC), 'escapes': len(E), 'excluded': len(X),
    'pitchMaxDeg': round(math.degrees(PITCH_MAX), 1),
    'a': summarise(a), 'b': summarise(b),
    'excludedInA': sum(r['excluded'] and r['faceable'] for r in rows),
    'excludedInB': sum(r['excluded'] and not r['faceable'] for r in rows),
    'topA': [{'edgeId': e, 'mode': next(r['mode'] for r in a if r['edgeId'] == e), 'rays': n,
              'void': sum(1 for r in a if r['edgeId'] == e and r['exit'] == 'void'),
              'street': sum(1 for r in a if r['edgeId'] == e and r['exit'] == 'street'),
              'eyeZ': [round(min(r['eyeZ'] for r in a if r['edgeId'] == e), 1),
                       round(max(r['eyeZ'] for r in a if r['edgeId'] == e), 1)],
              'floors': next(r['floors'] for r in a if r['edgeId'] == e)}
             for e, n in collections.Counter(r['edgeId'] for r in a).most_common(12)],
    'topB': [{'edgeId': e, 'rays': n} for e, n in
             collections.Counter(r['edgeId'] for r in b).most_common(10)],
}
print(json.dumps(out, indent=1))
