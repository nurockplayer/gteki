import json, sys
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else '.qa/809/diag/ikebukuro/audit.json')
a=json.loads(p.read_text())
print('routes complete/incomplete/suspect:',a['completeAuditedRoutes'],a['incompleteRoutes'],a['suspectPolyline'])
print('invalidJoinRoutes:',a['invalidJoinRoutes'],'auditedRoutePairs:',a['auditedRoutePairs'])
inc=a.get('qaIncomplete') or []
print('qaIncomplete records:',len(inc))
from collections import Counter
kinds=Counter(r['kind'] for r in inc)
print('kinds:',dict(kinds))
edges=Counter(f['edgeId'] for r in inc if r['kind']=='entry' for f in r['failures'])
reasons=Counter((f['edgeId'],f['mode'],f['reason'],f['connectivity'],f['fromSnapped'],f['toSnapped']) for r in inc if r['kind']=='entry' for f in r['failures'])
print('failing edges:',dict(edges))
print('failure keys:',dict(reasons))
assembly=Counter((r.get('reason'),tuple(r.get('edges') or [])) for r in inc if r['kind']=='assembly')
print('assembly:',{str(k):v for k,v in assembly.items()})
x26=Counter(any(e in ('ne_j__x26','ne_j__x26:forward','ne_j__x26:reverse') for e in (r.get('edges') or [])) or any(f['edgeId']=='ne_j__x26' for f in r.get('failures') or []) for r in inc)
print('records mentioning x26:',dict(x26))
bp=a['bakeProvenance']
print('bake snapRejections:',bp.get('snapRejections'))
print('linkAttachmentDiagnosis:',a.get('linkAttachmentDiagnosis'))
print('links.failed:',json.dumps([f for f in bp['links'].get('failed',[]) if f['edgeId']=='ne_j__x26']))
print('links.failed all:',json.dumps(bp['links'].get('failed')))
print('vertical stats for stairs:',json.dumps(bp.get('vertical',{}).get('stairs')))
print('linkPads:',bp.get('linkPads'))
fe=[f for f in a['failureEdges'] if f['edgeId']=='ne_j__x26']
print('failureEdges x26:',json.dumps(fe))
print('failureClasses:',json.dumps(a['failureClasses']))
print('snapDiagnosis:',json.dumps(a['snapDiagnosis']))
print('navPathsRejected:',a.get('navPathsRejected'))
print('fallbackEntries x26 present in fallback list:', [e for e in json.loads(Path('stations/ikebukuro/navmesh-fallback.json').read_text()) if e['edgeId']=='ne_j__x26'])
