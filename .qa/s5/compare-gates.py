import json, sys
from pathlib import Path
errors=[]
print('| Station | fallback | unvalidatedJoins | invalidJoins | detours | offFloor | snap_failed exit stairs | suspectPolyline routes/edges |')
print('|---|---:|---:|---:|---:|---:|---:|---|')
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
 suspect_before=f"{a['total'].get('suspectPolyline','new')}/{a['total'].get('suspectPolylineEdges','new')}"
 suspect_after=f"{b['total']['suspectPolyline']}/{b['total']['suspectPolylineEdges']}"
 print('| '+station+' | '+' | '.join(f'{x} → {y}' for x,y in pairs)+f' | {suspect_before} → {suspect_after} |')
 for name in ['navmesh-fallback','navmesh-suspect']:
  old={e['edgeId'] for e in load(before,name)};new={e['edgeId'] for e in load(after,name)}
  if new-old:errors.append(f'{station} {name} grew: {sorted(new-old)}')
 if set(pb['detours'])-set(pa['detours']):errors.append(f'{station} detours grew')
 for edge,counters in b.items():
  for key,count in counters.items():
   if key in ['suspectPolyline','suspectPolylineEdges'] and key not in a.get(edge,{}):continue
   old=a.get(edge,{}).get(key,0)
   if (count<old if key=='routablePairs' else count>old):errors.append(f'{station} {edge}.{key}: {old} → {count}')
 limits=load(Path('stations')/station,'navmesh-clip-baseline')['total']
 for field in ['suspectPolyline','suspectPolylineEdges']:
  if field in limits and b['total'][field]>limits[field]:errors.append(f'{station} {field} exceeds admitted baseline: {limits[field]} → {b["total"][field]}')
 audit=load(after,'audit')
 print(station,'rejected paths',len(audit['navPathsRejected']),'junctions',len(audit.get('navJoins',{})))
 print(station,'failure edges',[(e['edgeId'],e['mode'],e['reason']) for e in fb])
 print(station,'uniqueEdgeScene',audit['uniqueEdgeScene'])
 flagged={edge for edge,paths in pb['edges'].items() if paths.get('suspectPolyline')}
 expected={e['edgeId'] for e in load(after,'navmesh-suspect')}
 if flagged!=expected:errors.append(f'{station} suspect guide flags disagree with station list')
 if not audit['completeAuditedRoutes'] or not audit['navPathsScene']['samples']:errors.append(f'{station} has no completed routes or checked navmesh path samples')
 if audit['navPathsRejected']:errors.append(f"{station} rejected published paths: {audit['navPathsRejected']}")
 if audit['completeAuditedRoutes']+audit['incompleteRoutes']+audit['suspectPolyline']['routes']!=audit['auditedRoutePairs']:errors.append(f'{station} route outcome partition is inconsistent')
 for kind in ['navmesh','connector']:
  if audit['uniqueEdgeScene'][kind]['noFloor'] or audit['segmentTotals']['sceneRaycast'][kind]['noFloor']:errors.append(f'{station} {kind} samples without floor')
 if audit['fallbackAudit']['totals']['noFloor']:errors.append(f'{station} fallback samples without floor')
print('SHRINK-ONLY '+('FAIL' if errors else 'PASS'))
for error in errors:print(error)
