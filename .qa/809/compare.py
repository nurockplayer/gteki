# #809 shrink-only comparison: committed station gate files (before) -> measured phase (after).
# Usage: python3 .qa/809/compare.py [diag|after]
import json, sys
from pathlib import Path
phase=sys.argv[1] if len(sys.argv)>1 else 'after'
root=Path('.qa/809')/phase
errors=[]
rows={}
def load(directory,name):
 return json.loads((directory/(name+'.json')).read_text())
for station in ['ikebukuro','shinjuku']:
 after=root/station
 if not after.exists(): continue
 before=Path('stations')/station
 old,new=[load(p,'navmesh-clip-baseline') for p in [before,after]]
 fa,fb=[load(p,'navmesh-fallback') for p in [before,after]]
 pa,pb=[load(p,'navmesh-paths') for p in [before,after]]
 graph=load(Path('stations')/station/'gteki','graph')
 pois=load(Path('stations')/station/'gteki','pois')
 exits={n for p in (pois if isinstance(pois,list) else pois['pois']) if p['category']=='exit' for n in p['connectorNodeIds']}
 edges={e['id']:e for e in graph['edges']}
 def exit_snap(entry):
  edge=edges[entry['edgeId']]
  return entry['mode']=='stairs' and entry['reason']=='snap_failed' and (edge['from'] in exits or edge['to'] in exits)
 values={'fallback':(len(fa),len(fb))}
 for field in ['unvalidatedJoins','invalidJoins','connectorWallHits','fallbackWallHits','navmeshWallHits','offFloor','failedRoutePairs']:
  values[field]=(old['total'][field],new['total'][field])
 values['detours']=(len(pa['detours']),len(pb['detours']))
 values['exit-stair snap_failed']=(sum(map(exit_snap,fa)),sum(map(exit_snap,fb)))
 values['routablePairs']=(old['total']['routablePairs'],new['total']['routablePairs'])
 rows[station]=values
 for name in ['navmesh-fallback','navmesh-suspect']:
  a,b=[{e['edgeId'] for e in load(p,name)} for p in [before,after]]
  if b-a:errors.append(f'{station} {name} added edges: {sorted(b-a)}')
 if set(pb['detours'])-set(pa['detours']):errors.append(f'{station} detours added: {sorted(set(pb["detours"])-set(pa["detours"]))}')
 for edge,counters in new.items():
  for field,value in counters.items():
   if field in ['suspectPolyline','suspectPolylineEdges']:continue
   was=old.get(edge,{}).get(field,0)
   if (value<was if field=='routablePairs' else value>was):errors.append(f'{station} {edge}.{field}: {was} -> {value}')
 audit=load(after,'audit')
 if audit['navPathsRejected']:errors.append(f'{station} rejected published paths: {audit["navPathsRejected"]}')
 if audit['completeAuditedRoutes']+audit['incompleteRoutes']+audit['suspectPolyline']['routes']!=audit['auditedRoutePairs']:errors.append(f'{station} route outcome partition mismatch')
 flagged={e for e,d in pb['edges'].items() if d.get('suspectPolyline')}
 if flagged!={e['edgeId'] for e in load(after,'navmesh-suspect')}:errors.append(f'{station} suspect flags disagree with list')
 for kind in ['navmesh','connector']:
  if audit['uniqueEdgeScene'][kind]['noFloor'] or audit['segmentTotals']['sceneRaycast'][kind]['noFloor']:errors.append(f'{station} {kind} samples without floor')
 if audit['fallbackAudit']['totals']['noFloor']:errors.append(f'{station} fallback samples without floor')
 print(station,'suspectPolyline:',audit['suspectPolyline'],'(excluded from pass)')
 print(station,'fallback after:',fb)
 print(station,'routes complete/incomplete/suspect:',audit['completeAuditedRoutes'],audit['incompleteRoutes'],audit['suspectPolyline']['routes'])
print('| Metric | Ikebukuro main -> head | Shinjuku main -> head |')
print('|---|---:|---:|')
for metric in rows['ikebukuro']:
 print('| '+metric+' | '+' | '.join(f'{rows[s][metric][0]} -> {rows[s][metric][1]}' for s in ['ikebukuro','shinjuku'])+' |')
print('SHRINK-ONLY '+('FAIL' if errors else 'PASS'))
for e in errors:print(e)
raise SystemExit(1 if errors else 0)
