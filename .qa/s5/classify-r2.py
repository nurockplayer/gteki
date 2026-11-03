"""Classify route-set growth from two measurements of the same public scene."""
import json, math
from collections import defaultdict
from pathlib import Path
ROOT=Path('.qa/s5')
def dist(a,b): return math.dist([a[k] for k in ('x','y','z')],[b[k] for k in ('x','y','z')])
def direction(s): return s['edgeId']+(' reverse' if s['reversed'] else ' forward')
def key(s): return (s['edgeId'],s['reversed'])
def jkey(a,b): return direction(a).replace(' ',':')+'>'+direction(b).replace(' ',':')
def renderer(p): return dict(x=p['x'],y=p['z'],z=-p['y'])
def load(variant,station,name='audit'):return json.loads((ROOT/f'r2-{variant}'/station/f'{name}.json').read_text())
rows=[]; details=[]; fallback_rows=[]
for station in ('ikebukuro','shinjuku'):
 base,head=[load(v,station) for v in ('base','head')]
 routes=[{r['pairKey']:r for r in a['qaRoutes']} for a in (base,head)]
 entries={key(e['step']):e for e in head['qaEntries']};joins=dict(head['qaJoins'])
 queries={(tuple(q['from'].values()),tuple(q['to'].values())):q for q in head['qaQueries']}
 def query_for(p,q):return queries.get((tuple(renderer(p).values()),tuple(renderer(q).values())))
 def join_cause(a,b):
  p,q=a['last'],b['first'];line=joins.get(jkey(a['step'],b['step']))
  raw=query_for(p,q)
  if line:
   mismatch=max(dist(line[0],p),dist(line[-1],q))
   if mismatch>=1e-6:return 'query endpoint projection',f'accepted query endpoints differ from chain snaps by {mismatch:.9f} m'
   return None,None
  if not raw:return 'join query absent','no matching query recorded'
  result=raw['result']
  if result is None and raw.get('candidate'):
   candidate=raw['candidate'];return 'Detour endpoint projection exceeds 0.01 m',f"start {dist(candidate['first'],renderer(p)):.9f} m, end {dist(candidate['last'],renderer(q)):.9f} m"
  if result is None:return 'no complete walking corridor',f"polys {raw['a']['poly']} → {raw['b']['poly']}; {raw.get('stage','')}"
  if result['links']:return 'join borrows off-mesh link',str([l['userId'] for l in result['links']])
  return 'junction local-length bound',f"path {result['length']:.6f} m, snap gap {dist(p,q):.6f} m"
 def route_cause(r):
  es=[entries[key(s)] for s in r['steps']]
  missing=[e for e in es if e['missing']]
  if missing:
   classes=sorted(set('suspect height (no link)' if e['suspect'] else f"missing {e['step']['mode']} {e['reason']} ({e['connectivity']})" for e in missing))
   i=next(i for i,e in enumerate(es) if e['missing']);pair=es[max(0,i-1):min(len(es),i+2)]
   return ' + '.join(classes),' / '.join(direction(e['step']) for e in pair),'missing steps: '+', '.join(direction(e['step']) for e in missing)
  for a,b in zip(es,es[1:]):
   if dist(a['last'],b['first'])<1e-6:continue
   c,cause=join_cause(a,b)
   if c:return c,direction(a['step'])+' → '+direction(b['step']),cause
  return 'unclassified',direction(es[0]['step']),'no failing segment found'
 for field in ('incomplete','invalid'):
  before={k for k,r in routes[0].items() if r[field]};after={k for k,r in routes[1].items() if r[field]}
  groups=defaultdict(list)
  for pair in sorted(after-before):
   c,example,cause=route_cause(routes[1][pair]);record=dict(station=station,metric=field,pair=pair,classification=c,edgePair=example,cause=cause)
   groups[c].append(record);details.append(record)
  for c,items in sorted(groups.items()):rows.append((station,field,c,len(items),items[0]['edgePair'],items[0]['cause']+f"; {len({v['edgePair'] for v in items})} distinct first-failing edge pairs"))
  print(station,field,'base',len(before),'head',len(after),'new',len(after-before),'resolved',len(before-after))
  assert len(before)==base['incompleteRoutes' if field=='incomplete' else 'invalidJoinRoutes']
  assert len(after)==head['incompleteRoutes' if field=='incomplete' else 'invalidJoinRoutes']
 old={e['edgeId']:e for e in load('base',station,'navmesh-fallback')}
 suspect={e['edgeId']:e for e in head['bakeProvenance']['suspectEdges']}
 for e in load('head',station,'navmesh-fallback'):
  if e['edgeId'] in old:continue
  es=[v for v in entries.values() if v['step']['edgeId']==e['edgeId']]
  if e['edgeId'] in suspect: c='suspect height excluded from bake';cause=suspect[e['edgeId']]['detail']
  else:c=f"{e['mode']} {e['reason']}";cause='; '.join(sorted(set(v['connectivity']+' / '+str(v.get('pathRejection')) for v in es)))
  first=es[0]['step'];pair=next((r['steps'][max(0,i-1):i+2] for r in head['qaRoutes'] for i,s in enumerate(r['steps']) if s['edgeId']==e['edgeId']),[first])
  fallback_rows.append((station,'fallback',c,1,' → '.join(direction(s) for s in pair),cause))
lines=['# Round 2 growth classes','', 'Measured 2026-11-03 (JST); base and head use the same merged public scene. Counts are new route identities, not a subtraction of aggregate totals. Invalid routes are also incomplete, so those metric rows overlap.','', '| Station | Metric | Class | Count | Example edge pair | Cause |','|---|---|---|---:|---|---|']
for row in rows+fallback_rows:lines.append('| '+' | '.join(str(v).replace('|','/') for v in row)+' |')
(ROOT/'classes.md').write_text('\n'.join(lines)+'\n')
(ROOT/'r2-classified.json').write_text(json.dumps(details,indent=2)+'\n')
