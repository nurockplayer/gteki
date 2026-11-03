import json, sys
from pathlib import Path
errors=[]
print('| Station | fallback | unvalidatedJoins | invalidJoins | detours | offFloor | snap_failed exit stairs |')
print('|---|---:|---:|---:|---:|---:|---:|')
for station in ['ikebukuro','shinjuku']:
 before=Path(sys.argv[2] if len(sys.argv)>2 else '.qa/s5/before')/station
 after=Path(sys.argv[1] if len(sys.argv)>1 else '.qa/s5/regen-output')/station
 def load(root,name): return json.loads((root/(name+'.json')).read_text())
 a,b=[load(root,'navmesh-clip-baseline') for root in [before,after]]
 fa,fb=[load(root,'navmesh-fallback') for root in [before,after]]
 pa,pb=[load(root,'navmesh-paths') for root in [before,after]]
 graph=json.loads((Path('stations')/station/'gteki/graph.json').read_text())
 pois=json.loads((Path('stations')/station/'gteki/pois.json').read_text())
 exits={n for p in (pois if isinstance(pois,list) else pois['pois']) if p['category']=='exit' for n in p['connectorNodeIds']}
 edges={e['id']:e for e in graph['edges']}
 def exit_snap(e):
  edge=edges[e['edgeId']]
  return e['mode']=='stairs' and e['reason']=='snap_failed' and (edge['from'] in exits or edge['to'] in exits)
 pairs=[(len(fa),len(fb)),(a['total']['unvalidatedJoins'],b['total']['unvalidatedJoins']),(a['total']['invalidJoins'],b['total']['invalidJoins']),(len(pa['detours']),len(pb['detours'])),(a['total']['offFloor'],b['total']['offFloor']),(sum(exit_snap(e) for e in fa),sum(exit_snap(e) for e in fb))]
 print('| '+station+' | '+' | '.join(f'{x} → {y}' for x,y in pairs)+' |')
 for name in ['navmesh-fallback','navmesh-suspect']:
  old={e['edgeId'] for e in load(before,name)};new={e['edgeId'] for e in load(after,name)}
  if new-old:errors.append(f'{station} {name} grew: {sorted(new-old)}')
 if set(pb['detours'])-set(pa['detours']):errors.append(f'{station} detours grew')
 for edge,counters in b.items():
  for key,count in counters.items():
   old=a.get(edge,{}).get(key,0)
   if (count<old if key=='routablePairs' else count>old):errors.append(f'{station} {edge}.{key}: {old} → {count}')
 audit=load(after,'audit')
 print(station,'rejected paths',len(audit['navPathsRejected']),'junctions',len(audit.get('navJoins',{})))
 print(station,'failure edges',[(e['edgeId'],e['mode'],e['reason']) for e in fb])
 print(station,'uniqueEdgeScene',audit['uniqueEdgeScene'])
print('SHRINK-ONLY '+('FAIL' if errors else 'PASS'))
for error in errors:print(error)
