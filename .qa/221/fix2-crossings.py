# 2026-11-04 JST: ideal cap plane intersections in the saved before-ray set.
import json, math, collections
from pathlib import Path
p=Path('.qa/221/escape/fix2-before-cf659b1a')
s=json.loads((p/'samples.json').read_text()); directions=json.loads((p/'directions.json').read_text()); escapes=json.loads((p/'escapes.json').read_text())
runs=collections.defaultdict(list)
for sample in s:
 if sample['mode']=='escalator': runs[sample['edgeId']].append(sample)
out=[]
for edge,arr in runs.items():
 center=sorted((v for v in arr if v['lateral']==0),key=lambda v:v['d']); a,b=(center[0]['point'],center[-1]['point'])
 f,g=arr[0]['point'],arr[1]['point'];half=math.hypot(f['x']-g['x'],f['y']-g['y'])/.6
 dx=b['x']-a['x'];dy=b['y']-a['y'];length=math.hypot(dx,dy);ux,uy=dx/length,dy/length;dz=b['z']-a['z']
 for name,end,sign in [('start',a,-1),('end',b,1)]:
  x=end['x']+sign*ux*.6;y=end['y']+sign*uy*.6;z0=end['z']+sign*dz/length*.6
  for i,j,*_ in escapes:
   q=s[i]['point'];v=directions[j];den=v[0]*ux-v[2]*uy
   if abs(den)<1e-9:continue
   t=((x-q['x'])*ux+(y-q['y'])*uy)/den
   if not 0<=t<=25:continue
   z=q['z']+1.62+v[1]*t;side=abs((q['x']+v[0]*t-x)*-uy+(q['y']-v[2]*t-y)*ux)
   if side<=half+.45 and z0+2.4<=z<=z0+3.4 and z<-.181:
    out.append({'edge':edge,'mouth':name,'sample':i,'direction':j,'distance':t,'lateral':side,'height':z,'landingHeadTop':end['z']+2.4,'fromInterior':den*sign>0})
Path('.qa/221/fix2-crossings.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'crossings':len(out),'withinLandingHeadBand':sum(x['height']<=x['landingHeadTop'] for x in out),'fromInterior':sum(x['fromInterior'] for x in out),'byMouth':dict(collections.Counter(x['edge']+':'+x['mouth'] for x in out))}))
