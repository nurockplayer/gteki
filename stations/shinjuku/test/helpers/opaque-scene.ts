import * as T from "three";
import { currentBvh, prepareRayTrees } from '../../../../apps/web/src/explorer/meshBvh.ts';
import { castAll } from '../../../../apps/web/src/explorer/raycast.ts';
// Consolidate the actual draw triangles, preserving each material's cull side and
// instance transforms. This makes the exhaustive scan one BVH lookup per side.
export function opaqueScene(root:T.Object3D) {
 const source:T.Mesh[]=[], arrays=new Map<number,number[]>();
 root.updateMatrixWorld(true);
 root.traverseVisible(o=>{
  const m=o as T.Mesh;if(!m.isMesh || m.name==='walk proxies (invisible)' || m.name==='viewer probe (draws nothing)' || m.name.startsWith('greybox'))return;
  source.push(m);
  const g=m.geometry,p=g.getAttribute('position');if(!p)return;
  const index=g.index,total=index?.count??p.count;
  const groups=Array.isArray(m.material)?g.groups:[{start:0,count:total,materialIndex:0}];
  const matrix=new T.Matrix4(),instance=new T.Matrix4(),v=new T.Vector3();
  const inst=m as T.InstancedMesh, instances=inst.isInstancedMesh?inst.count:1;
  for(let n=0;n<instances;n++){
   if(inst.isInstancedMesh){inst.getMatrixAt(n,instance);matrix.multiplyMatrices(m.matrixWorld,instance);}else matrix.copy(m.matrixWorld);
   for(const group of groups){
    const mat=Array.isArray(m.material)?m.material[group.materialIndex??0]:m.material;
    if(!mat?.visible || mat.transparent || mat.opacity<=0)continue;
    const a=arrays.get(mat.side)??[];arrays.set(mat.side,a);
    const start=Math.max(group.start,g.drawRange.start),end=Math.min(total,group.start+group.count,g.drawRange.start+g.drawRange.count);
    for(let i=start;i<end;i++){v.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(matrix);a.push(v.x,v.y,v.z);}
   }
  }
 });
 const meshes=[...arrays].map(([side,a])=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a,3));return new T.Mesh(g,new T.MeshBasicMaterial({side}));});
 prepareRayTrees(meshes);prepareRayTrees(source);
 const candidates:number[]=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),point=new T.Vector3();
 const blockedBelowStreet=(ray:T.Raycaster)=>{
  const o=ray.ray.origin,d=ray.ray.direction;if(o.y>0.00001)return false;
  const far=d.y>0?Math.min(ray.far,(0.00001-o.y)/d.y):ray.far,near=ray.near;
  if(far<near)return false;
  // anyHit deliberately allows barycentric slack for label occlusion. Escape
  // classification needs an actual draw-triangle intersection, just like castAll.
  for(const m of meshes){
   candidates.length=0;
   currentBvh(m.geometry)!.rayCandidates(o.x,o.y,o.z,d.x,d.y,d.z,far,candidates);
   const p=m.geometry.getAttribute('position'),side=m.material.side;
   for(const t of candidates){
    a.fromBufferAttribute(p,t*3);b.fromBufferAttribute(p,t*3+1);c.fromBufferAttribute(p,t*3+2);
    const hit=ray.ray.intersectTriangle(side===T.BackSide?c:a,b,side===T.BackSide?a:c,side!==T.DoubleSide,point);
    if(hit){const distance=o.distanceToSquared(hit);if(distance>=near*near&&distance<=far*far)return true;}
   }
  }
  return false;
 };
 return {meshes,source,blockedBelowStreet,cast:(ray:T.Raycaster)=>castAll(ray,meshes)[0],original:(ray:T.Raycaster)=>castAll(ray,source).find(h=>{
  const m=h.object as T.Mesh,mat=Array.isArray(m.material)?m.material[h.face!.materialIndex]:m.material;return mat?.visible&&!mat.transparent&&mat.opacity>0;
 }),triangles:[...arrays.values()].reduce((n,a)=>n+a.length/9,0)};
}
