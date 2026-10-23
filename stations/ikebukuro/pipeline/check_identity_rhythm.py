"""CPU cue-anchor gaps along the two committed guided polylines (#342 Q3).

This is a spatial rhythm proxy, not visibility/recognition or a rendered 3 s
frame comparison. Signs need a readable face toward the leg and <= 4 m lateral
offset; junctions require verified degree >= 3. No draft aliases are read.
"""
import json
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_identity import ROOT, read

REPO = ROOT.parent.parent


def project(points, point):
    best = (math.inf, 0, (0, 0))
    acc = 0
    for a, b in zip(points, points[1:]):
        delta = tuple(b[k]-a[k] for k in ('x', 'y', 'z'))
        length = math.sqrt(sum(v*v for v in delta))
        if not length:
            continue
        t = max(0, min(1, sum((point[k]-a[k])*delta[i] for i, k in enumerate(('x', 'y', 'z')))/length**2))
        distance = math.sqrt(sum((point[k]-a[k]-t*delta[i])**2 for i, k in enumerate(('x', 'y', 'z'))))
        if distance < best[0]:
            horizontal = math.hypot(*delta[:2]) or 1
            best = distance, acc+t*length, (delta[0]/horizontal, delta[1]/horizontal)
        acc += length
    return best


def report(boards):
    graph, pois = read('gteki/graph.json'), read('gteki/pois.json')['pois']
    edges = {e['id']: e for e in graph['edges']}
    degree = {}
    for e in edges.values():
        if e['verification'] == 'verified':
            for n in (e['from'], e['to']):
                degree[n] = degree.get(n, 0)+1
    goldens = json.loads((REPO / 'tests/e2e/specs/__goldens__/02-navigation.spec.ts/ikebukuro-routes.json').read_text())
    result = {}
    for name, gid in [('westb1-exit4', 'I2'), ('jrc2-exit35', 'I1')]:
        points, node_offsets, offset, edge_ids = [], {}, 0, set()
        for step in goldens[gid]['result']['steps']:
            e = edges[step[1:]]
            assert e['verification'] == 'verified'
            edge_ids.add(e['id'])
            forward = step[0] == '>'
            geom = e['geometry'] if forward else list(reversed(e['geometry']))
            node_offsets[e['from'] if forward else e['to']] = offset
            offset += sum(math.dist(tuple(a[k] for k in ('x', 'y', 'z')), tuple(b[k] for k in ('x', 'y', 'z'))) for a, b in zip(geom, geom[1:]))
            node_offsets[e['to'] if forward else e['from']] = offset
            points.extend(geom if not points else geom[1:])
        cues = [(0, 'start'), (offset, 'end')]
        for nid, at in node_offsets.items():
            labels = [p['id'] for p in pois if p['category'] in {'ticket_gate', 'exit'} and nid in p['connectorNodeIds']]
            stairs = [e['id'] for e in edges.values() if e['verification'] == 'verified' and nid in (e['from'], e['to']) and e.get('mode') in {'stairs', 'escalator'}]
            if degree.get(nid, 0) >= 3 or labels or stairs:
                cues.append((at, 'node:'+nid))
        for b in read('scene/signage.json')['signs'] + boards:
            # Face is overhead; compare horizontal footprint at the route floor.
            p = {**b['position'], 'z': min(points, key=lambda p: math.hypot(p['x']-b['position']['x'], p['y']-b['position']['y']))['z']}
            lateral, at, direction = project(points, p)
            dot = sum(direction[i]*b['facing'][k] for i, k in enumerate(('x', 'y')))
            if lateral <= 4 and (abs(dot) >= 0.5 if b.get('back') else dot <= -0.5):
                cues.append((at, b['id']))
        cues.sort()
        # Co-located facts form one cue stop, not artificial zero-length intervals.
        stops = []
        for at, label in cues:
            if stops and abs(stops[-1]['atM']-at) < 0.05:
                stops[-1]['ids'].append(label)
            else:
                stops.append({'atM': at, 'ids': [label]})
        gaps = [{'from': a['ids'], 'to': b['ids'], 'fromM': round(a['atM'], 2), 'toM': round(b['atM'], 2), 'gapM': round(b['atM']-a['atM'], 2)} for a, b in zip(stops, stops[1:])]
        result[name] = {'lengthM': round(offset, 2), 'maxGapM': max(g['gapM'] for g in gaps), 'gaps': gaps}
    return result


if __name__ == '__main__':
    before = report([])
    after = report(read('scene/identity.json')['boards'])
    print(json.dumps({'before': before, 'after': after}, ensure_ascii=False, indent=2))
    assert all(r['maxGapM'] <= 30 for r in after.values()), 'Cue gap exceeds 30 m'
