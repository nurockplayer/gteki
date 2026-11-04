from pathlib import Path
p=Path('packages/godot/src/navmesh-bake.ts'); s=p.read_text()

old_cb='    (_id, _node, snapped) => { const reason=validateLinkEndpoint(bridgeProbe, snapped); if (reason) snapRejections[reason]++; return !reason; }, snapFallback ? fallback : undefined);'
assert s.count(old_cb)==1, s.count(old_cb)
new_cb='''    (_id, _node, snapped) => {
      const reason=validateLinkEndpoint(bridgeProbe, snapped); if (reason) snapRejections[reason]++;
      if (_id==="x26"||_id==="ne_j") { const g=globalThis as any; g.__x26=g.__x26||{}; g.__x26[_id]={node:_node,snapped,reason}; }
      return !reason; }, snapFallback ? fallback : undefined);'''
s=s.replace(old_cb,new_cb,1)

old_shape='''    const audit = auditPolyline(bridgeProbe, shape);
    if (!audit.wallHits && !audit.offFloor && !audit.noFloor) return true;'''
assert s.count(old_shape)==1, s.count(old_shape)
new_shape='''    const detail: any[] = [];
    const audit = auditPolyline(bridgeProbe, shape, candidate.edgeId==="ne_j__x26" ? {detail} : undefined);
    if (candidate.edgeId==="ne_j__x26") { const g=globalThis as any; g.__x26shape={builtPoints:built?.length ?? 0, built, shape, audit, hits:detail.filter((d:any)=>d.wallBefore||d.floor!=="ok").map((d:any)=>({...d,sample:shape[Math.min(d.i,shape.length-1)],wall: d.wallSegment!==undefined ? bridgeProbe.walls[d.wallSegment] : undefined, collider: d.wallCollider!==undefined ? (bridgeProbe.collider[d.wallCollider] as any)?.name : undefined}))}; }
    if (!audit.wallHits && !audit.offFloor && !audit.noFloor) return true;'''
s=s.replace(old_shape,new_shape,1)

old_push='  links.failed.push(...shapeRejected);'
assert s.count(old_push)==1, s.count(old_push)
new_push='''  links.failed.push(...shapeRejected);
  { const g=globalThis as any; fs.mkdirSync(".qa/809/diag",{recursive:true});
    fs.writeFileSync(".qa/809/diag/x26.json",JSON.stringify({endpoints:g.__x26,shape:g.__x26shape,failed:links.failed.filter((f:any)=>f.edgeId==="ne_j__x26"),admitted:links.candidates.filter((c:any)=>c.edgeId==="ne_j__x26").length},null,2)); }'''
s=s.replace(old_push,new_push,1)
p.write_text(s)
print('patched navmesh-bake.ts for x26 probe (new admission)',flush=True)
