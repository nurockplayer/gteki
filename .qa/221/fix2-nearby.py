import json,math,collections
from pathlib import Path
p=Path('.qa/221/escape');before=json.loads((p/'fix2-before-cf659b1a/escapes.json').read_text());after=json.loads((p/'main-bdc602b2/escapes.json').read_text());samples=json.loads((p/'fix2-before-cf659b1a/samples.json').read_text());runs=collections.defaultdict(list)
for s in samples:
 if s['mode']=='escalator' and s['lateral']==0:runs[s['edgeId']].append(s)
def count(es,point):
 return sum(math.dist((samples[i]['point']['x'],samples[i]['point']['y'],samples[i]['point']['z']+1.62),point)<=3 for i,*_ in es)
lines=['# Nearby escape rays — 2026-11-04 JST','', '3-D radius 3 m around each run endpoint at eye height (+1.62 m). Counts include rays from all sampled flights; a ray may appear in more than one row.', '', '| Escalator edge | Start before → after | End before → after |','| --- | ---: | ---: |']
for edge,arr in runs.items():
 arr.sort(key=lambda x:x['d']);values=[]
 for s in (arr[0],arr[-1]):
  q=s['point'];point=(q['x'],q['y'],q['z']+1.62);values.append(f'{count(before,point)} → {count(after,point)}')
 lines.append(f'| `{edge}` | {values[0]} | {values[1]} |')
point=(-25.897965,127.21074,-20.81)
lines.extend(['',f'Shoulder sample near the upper wall-to-roof junction, ENU {point}: **{count(before,point)} → {count(after,point)}**.'])
Path('.qa/221/fix2-nearby.md').write_text('\n'.join(lines)+'\n')
