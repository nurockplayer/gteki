from pathlib import Path
p=Path('packages/godot/src/navmesh-bake.ts'); s=p.read_text()
old='''    const audit = auditPolyline(bridgeProbe, shape);
    if (!audit.wallHits && !audit.offFloor && !audit.noFloor) return true;'''
assert s.count(old)==1, s.count(old)
# Measurement only: force-admit Exit 26 so the audit reports what its own shape accounting says.
new='''    if (candidate.edgeId==="ne_j__x26") return true;
    const audit = auditPolyline(bridgeProbe, shape);
    if (!audit.wallHits && !audit.offFloor && !audit.noFloor) return true;'''
p.write_text(s.replace(old,new,1))
print('forced admission of ne_j__x26 (container-only)',flush=True)
