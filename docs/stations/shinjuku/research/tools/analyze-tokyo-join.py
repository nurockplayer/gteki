#!/usr/bin/env python3
"""Read-only source analysis; derived outputs only. Run with python3 -I.
No source archive extraction, datum-shift fitting, nearest-node snapping, or app edits.
"""
import collections, csv, hashlib, heapq, json, math, pathlib, statistics, zipfile

REPO = pathlib.Path(__file__).resolve().parents[5]
RAW = pathlib.Path.home() / 'Developer/gteki-raw/shinjuku'
WORK = RAW / 'w5-tokyo-join-2026-10-21'
WORK.mkdir(exist_ok=True)
DOC = REPO / 'docs/stations/shinjuku/research'

def read_json(p): return json.loads(p.read_text())
def write_json(p, d): p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def percentile(values, p):
    if not values: return None
    a=sorted(values); i=(len(a)-1)*p; lo=int(i); hi=math.ceil(i)
    return a[lo]+(a[hi]-a[lo])*(i-lo)
def stats(values):
    return {'count':len(values),'medianM':percentile(values,.5),'p90M':percentile(values,.9),'maxM':max(values) if values else None}
def enu(lat,lon):
    # Exact @gteki/geo EnuFrame GRS80 semantics with h=0. Source WGS84 geographic
    # values are provisionally used as JGD2011; this is NOT an epoch/datum correction.
    a=6378137.; f=1/298.257222101; e2=f*(2-f)
    def ecef(lat,lon):
        p,l=map(math.radians,(lat,lon)); s=math.sin(p); n=a/math.sqrt(1-e2*s*s)
        return n*math.cos(p)*math.cos(l), n*math.cos(p)*math.sin(l), n*(1-e2)*s
    p,l=map(math.radians,(35.687,139.6994)); o=ecef(35.687,139.6994)
    dx,dy,dz=[v-u for v,u in zip(ecef(lat,lon),o)]
    return [-math.sin(l)*dx+math.cos(l)*dy,
            -math.sin(p)*math.cos(l)*dx-math.sin(p)*math.sin(l)*dy+math.cos(p)*dz]

def dist(a,b):return math.hypot(a[0]-b[0],a[1]-b[1])
def affine(t,x,y):return [t[0]*x+t[2]*y+t[4],t[1]*x+t[3]*y+t[5]]
station=read_json(REPO/'stations/shinjuku/gteki/station.json')
graph=read_json(REPO/'stations/shinjuku/gteki/graph.json')
pois=read_json(REPO/'stations/shinjuku/gteki/pois.json')['pois']
floor_e={f['id']:f['ordinal'] for f in station['floors']}
enodes={n['id']:n for n in graph['nodes']}
xy_e={n['id']:[n['position']['x'],n['position']['y']] for n in graph['nodes']}
deg=collections.Counter(v for e in graph['edges'] for v in [e['from'],e['to']])
exit_pois=collections.defaultdict(list)
for p in pois:
    if p['category']=='exit':
        for n in p['connectorNodeIds']:exit_pois[n].append(p['id'])
primary={n['id'] for n in graph['nodes'] if n['kind']=='exit' or n['inOut'] in ('outside','boundary') or n['id'] in exit_pois}
structural={n for n in enodes if deg[n]==1}
ends=sorted(primary|structural)
archive=RAW/'w5-tokyo-routes/shisetsu_root.zip'
z=zipfile.ZipFile(archive);assert z.testzip() is None
members={pathlib.PurePosixPath(n).name:n for n in z.namelist()}
def zipjson(name):return json.loads(z.read(members[name]))
m=zipjson('com-map.geojson');nav=zipjson('v5_nav.json');ent=zipjson('com-entity.geojson')
levels={l['id']:l['properties'] for l in m['drawings'][0]['levels']}
# These are label-derived comparison ordinals, NOT a physical global floor mapping.
ordinal={'B5F':-5,'B4F':-4,'B3F':-3,'MB2F':-2.5,'B2F':-2,'B1F':-1,'M1F':-.5,'1F':1,'2F':2,'3F':3,'4F':4}
names=collections.defaultdict(list)
for e in ent['entities']:
    for gid,*_ in e['properties'].get('geometry',[]): names[gid].append(e['properties'].get('name',''))
features={}; feature_floor={}
for basename in members:
    if basename.startswith('geojson-level-geom-'):
        d=zipjson(basename)
        for f in d['features']:features[f['id']]=f;feature_floor[f['id']]=d['id']
tnodes={};bygid=collections.defaultdict(list)
for n in nav['n']:
    assert len(n['l'])==1, 'Multiple floor associations need explicit handling'
    ll=affine(m['drawings'][0]['ref_frame']['transform'],*affine(nav['d'][0]['t'],n['mx'],n['my']))
    lid=n['l'][0]['lid'];gid=n['l'][0].get('gid');fl=levels[lid]['name'];props=features.get(gid,{}).get('properties',{})
    tnodes[n['id']]={'id':n['id'],'lon':ll[0],'lat':ll[1],'xy':enu(ll[1],ll[0]),'floor':fl,'ordinal':ordinal[fl],'lid':lid,'gid':gid,'names':names[gid],'properties':props}
    bygid[gid].append(n['id'])
assert len(tnodes)==2506 and len(nav['l'])==2653

def floor_agree(ef,tf):
    eo=floor_e[ef];to=ordinal[tf]
    if eo==to:return 'label-equal'
    if eo==0 and to==1:return 'street-1F-equivalence'
    return 'label-mismatch'

def pair(eid,tid):
    e=enodes[eid];t=tnodes[tid];a=xy_e[eid];b=t['xy']
    return {'e27Node':eid,'tokyoNode':tid,'offsetM':dist(a,b),'eastDeltaM':b[0]-a[0],'northDeltaM':b[1]-a[1],
            'e27Floor':e['floorId'],'tokyoFloor':t['floor'],'floorAgreement':floor_agree(e['floorId'],t['floor']),
            'tokyoGeometryId':t['gid'],'tokyoNames':t['names']}
allpairs=[];end_results=[]
for eid in ends:
    pp=sorted((pair(eid,t) for t in tnodes if dist(xy_e[eid],tnodes[t]['xy'])<=60),key=lambda p:(p['offsetM'],p['tokyoNode']))
    allpairs+=pp;eq=[p for p in pp if p['floorAgreement']!='label-mismatch'];near=sorted((pair(eid,t) for t in tnodes),key=lambda p:(p['offsetM'],p['tokyoNode']))[0]
    end_results.append({'e27Node':eid,'floor':enodes[eid]['floorId'],'kind':enodes[eid]['kind'],'inOut':enodes[eid]['inOut'],'degree':deg[eid],'primaryExitOrBoundary':eid in primary,'exitPois':exit_pois[eid],
    'within60mCount':len(pp),'floorAgreementCounts':dict(collections.Counter(p['floorAgreement'] for p in pp)),'nearestAny':near,'nearestCompatible':eq[0] if eq else None,'nearestFive':pp[:5]})
write_json(WORK/'all-boundary-pairs-within-60m.json',allpairs)
write_json(WORK/'tokyo-transformed-nodes.json',list(tnodes.values()))

# Unbiased diagnostics first; selected matching population is separately named.
nearest_compatible=[]
for eid in enodes:
    pp=[pair(eid,tid) for tid,t in tnodes.items() if floor_agree(enodes[eid]['floorId'],t['floor'])!='label-mismatch']
    if pp:nearest_compatible.append(min(pp,key=lambda p:(p['offsetM'],p['tokyoNode'])))
# Reciprocal nearest same-label/equivalent-ground pairs; no fitted translation/rotation.
reciprocal=[]
for p in nearest_compatible:
    if p['offsetM']>5:continue
    eligible=[eid for eid,e in enodes.items() if floor_agree(e['floorId'],p['tokyoFloor'])!='label-mismatch']
    back=min(eligible,key=lambda eid:(dist(xy_e[eid],tnodes[p['tokyoNode']]['xy']),eid))
    if back==p['e27Node']:reciprocal.append(p)
# Source E27 reprojected coordinates vs rounded shipped x/y.
raw_e=read_json(RAW/'e27/nwd/node.geojson')['features']
raw_reprojection=[]
for f in raw_e:
    eid='n:'+f['properties']['node_id'];lon,lat=f['geometry']['coordinates'][:2]
    raw_reprojection.append(dist(xy_e[eid],enu(lat,lon)))
assert len(raw_reprojection)==233 and max(raw_reprojection)<.0072

adj=collections.defaultdict(list)
for e in nav['l']:
    assert e['n1'] in tnodes and e['n2'] in tnodes
    if e['d'] in (1,3):adj[e['n1']].append((e['n2'],e['dm'],e['id']))
    if e['d'] in (2,3):adj[e['n2']].append((e['n1'],e['dm'],e['id']))
def route(start,goals,predicate=lambda n:True):
    q=[(0,start,[],[start])];seen=set()
    while q:
        dd,n,edges,ns=heapq.heappop(q)
        if n in seen:continue
        seen.add(n)
        if n in goals:return {'dmSum':dd,'nodes':ns,'edges':edges}
        for nn,w,ei in adj[n]:
            if nn not in seen and predicate(tnodes[nn]):heapq.heappush(q,(dd+w,nn,edges+[ei],ns+[nn]))
    return None

targets={gid:{'names':names[gid],'nodeIds':bygid[gid],'floor':levels[feature_floor[gid]]['name']} for gid in [28993983,28993984,28993987,28993988,28993990,28993975,28993451,28993091,28993261]}
near_details={}
for er in end_results:
    p=er['nearestCompatible']
    if p and p['offsetM']<=10:
        t=tnodes[p['tokyoNode']];near_details[er['e27Node']]={'pair':p,'tokyoProperties':t['properties'],'outgoing':[{**tnodes[n],'edgeId':e,'dm':w} for n,w,e in adj[t['id']]],'pathsToNamedGates':{gid:route(t['id'],set(v['nodeIds'])) for gid,v in targets.items()}}
write_json(WORK/'near-endpoint-details.json',near_details)

summary={'schemaVersion':1,'reportDate':'2026-10-21','scope':'Research only: proximity candidates, not approved join edges',
 'inputSha256':{str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p):sha(p) for p in [archive,REPO/'stations/shinjuku/gteki/graph.json',REPO/'stations/shinjuku/gteki/station.json',REPO/'stations/shinjuku/gteki/pois.json',REPO/'packages/geo/src/index.ts']},
 'transform':{'origin':{'lat':35.687,'lon':139.6994,'h':0},'sourceDeclaredCrs':'WGS84 geographic for standard GeoJSON; nav uses published Mercator-to-map affine','navToMap':nav['d'][0]['t'],'mapToLonLat':m['drawings'][0]['ref_frame']['transform'],'target':'EnuFrame GRS80 x east / y north, z unknown','datumTreatment':'WGS84 coordinates provisionally reused as JGD2011; no epoch or geodetic datum transformation asserted','fittedCorrection':None,'renderer':'(x, symbolic-renderZ, -y); no measured Tokyo elevations'},
 'floors':[{'id':lid,'label':p['name'],'sourceZlevel':p['zlevel'],'comparisonOrdinal':ordinal[p['name']],'nodeCount':sum(n['lid']==lid for n in tnodes.values())} for lid,p in levels.items()],
 'counts':{'e27Nodes':len(enodes),'e27Edges':len(graph['edges']),'e27ExitPois':len([p for p in pois if p['category']=='exit']),'primaryBoundaryNodes':len(primary),'degreeOneNodes':len(structural),'boundaryUnionNodes':len(ends),'tokyoNodes':len(tnodes),'tokyoLinks':len(nav['l']),'pairsWithin60m':len(allpairs),'primaryPairsWithin60m':sum(p['e27Node'] in primary for p in allpairs),'primaryCandidateFloorAgreement':dict(collections.Counter(p['floorAgreement'] for p in allpairs if p['e27Node'] in primary)),'candidateFloorAgreement':dict(collections.Counter(p['floorAgreement'] for p in allpairs))},
 'metrics':{'e27RawReprojectionVsShippedRoundedXY':stats(raw_reprojection),'allBoundaryNearestAny':stats([r['nearestAny']['offsetM'] for r in end_results]),'allBoundaryNearestCompatibleWithin60m':stats([r['nearestCompatible']['offsetM'] for r in end_results if r['nearestCompatible']]),'primaryBoundaryNearestCompatibleWithin60m':stats([r['nearestCompatible']['offsetM'] for r in end_results if r['primaryExitOrBoundary'] and r['nearestCompatible']]),'allE27NearestCompatible':stats([p['offsetM'] for p in nearest_compatible]),'reciprocalCompatibleWithin5m':stats([p['offsetM'] for p in reciprocal])},
 'reciprocalPairs':reciprocal,'boundaryResults':end_results,'namedTokyoTargets':targets,
 'rawAnalysisFiles':{'allPairs':{'path':str(WORK/'all-boundary-pairs-within-60m.json'),'sha256':sha(WORK/'all-boundary-pairs-within-60m.json')},'transformedNodes':{'path':str(WORK/'tokyo-transformed-nodes.json'),'sha256':sha(WORK/'tokyo-transformed-nodes.json')}},
 'assertions':{'zipCrcPassed':True,'expectedCountsPassed':True,'allTokyoLinkEndpointsExist':True,'e27HorizontalReproductionBelow0_0072m':True}}
write_json(DOC/'2026-10-21-tokyo-terminal-join-summary.json',summary)
print(json.dumps({'counts':summary['counts'],'metrics':summary['metrics']},indent=2))
for r in end_results:
    p=r['nearestCompatible'];print(r['e27Node'][2:10],r['floor'],r['degree'],r['exitPois'],r['within60mCount'],'best compatible', (p['tokyoNode'],round(p['offsetM'],3),p['tokyoGeometryId'],p['tokyoNames']) if p else None)

# Inspect the proposed single-floor northern corridor, stopping before the next
# geometry/junction rather than extending through unknown fare gates or stores.
anchor='n:c01041e096fe4f6c8ed23520375ef2fd';start=11110367;end=11110419
corridor=route(start,{end},lambda n:n['gid']==28993486 and n['floor']=='B1F')
assert corridor is not None and len(corridor['nodes'])==18 and len(corridor['edges'])==17
bylink={e['id']:e for e in nav['l']}
assert all(bylink[e]['d']==3 and bylink[e].get('dz',0)==0 for e in corridor['edges'])
assert all(tnodes[n]['properties']=={'facility':'hallway'} for n in corridor['nodes'])

def ring_contains(p,ring):
    inside=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a[1]>p[1])!=(b[1]>p[1]) and p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:inside=not inside
    return inside

def polygon_contains(p,rings):return ring_contains(p,rings[0]) and not any(ring_contains(p,r) for r in rings[1:])
def geometry_polygons(geom):
    if geom['type']=='Polygon':return [geom['coordinates']]
    if geom['type']=='MultiPolygon':return geom['coordinates']
    return []
def xy_polygons(geom):return [[[enu(c[1],c[0]) for c in ring] for ring in poly] for poly in geometry_polygons(geom)]
def inside_any(p,polys):return any(polygon_contains(p,poly) for poly in polys)
polys_t=xy_polygons(features[28993486]['geometry'])
gsi=read_json(RAW/'e27/map/Shinjuku_B1_Space.geojson')['features']
polys_e=[(f['properties'],xy_polygons(f['geometry'])) for f in gsi]
a=xy_e[anchor];b=tnodes[start]['xy']
points=[[a[0]+(b[0]-a[0])*i/20,a[1]+(b[1]-a[1])*i/20] for i in range(21)]
approach=next(e for e in graph['edges'] if anchor in (e['from'],e['to']))
other=approach['to'] if approach['from']==anchor else approach['from'];u=[a[i]-xy_e[other][i] for i in (0,1)];v=[tnodes[corridor['nodes'][1]]['xy'][i]-b[i] for i in (0,1)]
angle=math.degrees(math.acos(max(-1,min(1,sum(x*y for x,y in zip(u,v))/(math.hypot(*u)*math.hypot(*v))))))
seam={'e27Node':anchor,'tokyoNode':start,'offsetM':dist(a,b),'e27ApproachEdge':approach['id'],'approachPaid':approach['paid'],'approachMode':approach['mode'],'headingDifferenceDegrees':angle,'samples':21,'samplesInsideTokyoHallway':sum(inside_any(p,polys_t) for p in points),'e27SpacesContainingAnchor':[props for props,polys in polys_e if inside_any(a,polys)],'status':'historical geometric candidate; not a current or accepted connector','heightDifferenceM':None,'hours':None}
# Floor polygon continuity at 0.5 m sampling, independent of feature gid references.
path_samples=[]
for n1,n2 in zip(corridor['nodes'],corridor['nodes'][1:]):
    a1=tnodes[n1]['xy'];b1=tnodes[n2]['xy'];k=max(1,math.ceil(dist(a1,b1)/.5))
    path_samples += [[a1[0]+(b1[0]-a1[0])*i/k,a1[1]+(b1[1]-a1[1])*i/k] for i in range(k+1)]
corridor.update({'floor':'B1F','comparisonOrdinal':-1,'hallwayGeometryId':28993486,'semanticFacility':'hallway','sourceDirectionsAllBidirectional':True,'sumHorizontalEnuLengthM':sum(dist(tnodes[n1]['xy'],tnodes[n2]['xy']) for n1,n2 in zip(corridor['nodes'],corridor['nodes'][1:])),'sampleCount':len(path_samples),'samplesInsideHallway':sum(inside_any(p,polys_t) for p in path_samples),'seam':seam,'candidateCombinedGraphCounts':{'nodes':233+18,'edges':263+17+1,'floors':9},'newHeightMeasurements':0})
assert seam['samplesInsideTokyoHallway']==21
assert corridor['samplesInsideHallway']==corridor['sampleCount']==220
assert any(p['category']=='B029' and p['toll']=='3' and p['restricted']=='2' and p['nonpublic']=='2' for p in seam['e27SpacesContainingAnchor'])
summary['recommendedSlice']=corridor
summary['metrics']['reciprocalWithin5mByFloor']={f:stats([p['offsetM'] for p in reciprocal if p['tokyoFloor']==f]) for f in sorted({p['tokyoFloor'] for p in reciprocal})}
summary['metrics']['reciprocalThresholdSensitivity']={str(th):stats([p['offsetM'] for p in reciprocal if p['offsetM']<=th]) for th in (1,2,3,5)}
summary['boundaryClassificationNote']='11 explicit exit/outside/boundary nodes plus all 20 degree-one nodes; union 24. Degree one is a possible clipped endpoint, not proof of public access.'
# Context-only paths retain gate destination IDs, not fabricated public connections.
summary['contextPathsFromNorthAnchor']={gid:{'nodeCount':len(p['nodes']),'edgeCount':len(p['edges']),'sourceDistanceM':p['dmSum'],'floors':sorted({tnodes[n]['floor'] for n in p['nodes']})} for gid in targets if (p:=route(start,set(targets[gid]['nodeIds'])))}
# E28 is a separate acquired network: inspect, but never infer the intervening passage.
e28=WORK/'e28-nwd.zip'
if e28.exists():
    zz=zipfile.ZipFile(e28);assert zz.testzip() is None
    nd=json.loads(zz.read(next(n for n in zz.namelist() if n.endswith('node.geojson'))));ld=json.loads(zz.read(next(n for n in zz.namelist() if n.endswith('link.geojson'))))
    coords=[f['geometry']['coordinates'][:2] for f in nd['features']]
    xy=[enu(lat,lon) for lon,lat in coords]
    closest=min((dist(ep,tp),eid,idx) for eid,ep in xy_e.items() for idx,tp in enumerate(xy))
    summary['E28']={'nodes':len(coords),'links':len(ld['features']),'crs':nd.get('crs'),'bboxLonLat':[min(c[0] for c in coords),min(c[1] for c in coords),max(c[0] for c in coords),max(c[1] for c in coords)],'floorCounts':dict(collections.Counter(str(f['properties']['floor']) for f in nd['features'])),'maintenanceDateCounts':dict(collections.Counter(f['properties'].get('maint_date') for f in ld['features'])),'minimumAnyNodeDistanceToE27M':closest[0],'nearestE27Node':closest[1],'nearestE28NodeId':nd['features'][closest[2]]['properties']['node_id'],'connectionVerified':False}
write_json(DOC/'2026-10-21-tokyo-terminal-join-summary.json',summary)
write_json(WORK/'plot-input.json',{'e27Nodes':[{**n,'xy':xy_e[n['id']]} for n in graph['nodes']],'e27Edges':graph['edges'],'tokyoNodes':list(tnodes.values()),'tokyoLinks':nav['l'],'reciprocal':reciprocal,'slice':corridor,'hallwayPolygons':polys_t})
print('SLICE',json.dumps(corridor,ensure_ascii=False));print('E28',summary.get('E28'))
