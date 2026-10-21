/** Original street context. Geometry is merged per material; facade detail uses mipmaps.
 * Surface-only sun and haze are evaluated in these materials, so station lighting
 * and underground fog are untouched. Everything is explicitly render-only except
 * the exported obstacle segments, which the integration hook adds to WalkWorld.
 */
import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import type { Layout, XY, XYZ } from "./layout.ts";
import type { SurfaceData } from "./surface-data.ts";
import { surfaceBuildingFootprints, surfaceColumns, surfaceEntrances, surfaceGround, surfacePadWalls, surfaceCanopyWalls, surfaceRoofs, surfaceVisibleIn } from "./surface-layout.ts";
import { daylight, facadeTexture, hash, pavingTexture, skyMaterial } from "./surface-materials.ts";
import { inside, strip, surfaceStreets } from "./surface-street.ts";
export { surfaceWalls } from "./surface-layout.ts";
export type { SurfaceData } from "./surface-data.ts";

/** The legacy light batch spans all floors. Remove only its floating street
 * ceiling strips when replacing the generic level-0 cap with entrance roofs. */
export function trimSurfaceCeilingFixtures(root: THREE.Group, materials: THREE.Material[]) {
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || !materials.includes(child.material as THREE.Material)) continue;
    const g = child.geometry, index = g.index, positions = g.attributes.position!;
    if (!index) continue;
    const keep: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (!ids.every(id => positions.getY(id) > 2.3)) keep.push(...ids);
    }
    g.setIndex(keep); g.computeBoundingBox(); g.computeBoundingSphere();
  }
}

const pos = (p: XY, z: number) => new THREE.Vector3(p.x, z, -p.y);
function shape(rings: number[][][]) {
  const s = new THREE.Shape(rings[0]!.map((p) => new THREE.Vector2(p[0]!, p[1]!)));
  for (const r of rings.slice(1)) s.holes.push(new THREE.Path(r.map((p) => new THREE.Vector2(p[0]!, p[1]!))));
  return s;
}
function flat(rings: number[][][], z: number) {
  const g = new THREE.ShapeGeometry(shape(rings));
  g.rotateX(-Math.PI / 2); g.translate(0, z, 0);
  return g;
}
function quad(a: XY, b: XY, bottom: number, top: number, inset = 0) {
  const g = new THREE.BufferGeometry();
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = dy / L * inset, ny = -dx / L * inset;
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x + nx, bottom, -a.y - ny, b.x + nx, bottom, -b.y - ny, b.x + nx, top, -b.y - ny, a.x + nx, top, -a.y - ny], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L, 0, L, top - bottom, 0, top - bottom], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return g;
}
function beam(a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number) {
  const d = b.clone().sub(a), g = new THREE.BoxGeometry(width, d.length(), depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/** Builds the street layer and returns only what the live scene keeps. The construction lives in its own
 * function on purpose: any closure that survives (visibility update, setViewer, dispose, the sky hook)
 * keeps the whole scope it was defined in reachable, and this scope holds the street polygons, building
 * footprints and every source geometry (#72). The survivors are created in buildSurface, whose scope
 * holds nothing else. */
export function buildSurface(surface: SurfaceData, layout: Layout, opts: { bundle: StationBundle; quality: "low" | "high" }) {
  const { root, resources, visibility } = assembleSurface(surface, layout, opts);
  const dome = root.getObjectByName("surface-sky")!;
  dome.onBeforeRender = (_renderer, _scene, camera) => { dome.position.copy(camera.position); dome.updateMatrixWorld(); };
  let disposed = false, viewer: XYZ | null = null;
  const update = (_dt: number, _t: number) => { root.visible = viewer !== null && surfaceVisibleIn(visibility, viewer); };
  return { root, update, setViewer(p: XYZ) { viewer = { ...p }; update(0, 0); }, dispose() { if (disposed) return; disposed = true; for (const r of resources) r.dispose(); resources.clear(); root.clear(); } };
}
function assembleSurface(surface: SurfaceData, layout: Layout, opts: { bundle: StationBundle; quality: "low" | "high" }) {
  const root = new THREE.Group(); root.name = "surface-render-only"; root.visible = false;
  root.userData.attribution = surface.attribution;
  const resources = new Set<{ dispose(): void }>();
  const track = <T extends { dispose(): void }>(r: T) => (resources.add(r), r);
  const mats = {
    ground: track(daylight("#f2eee5", track(pavingTexture()))), asphalt: track(daylight("#ffffff",track(pavingTexture(true)))),
    stone: track(daylight("#b7b8b2")), steel: track(daylight("#aebcc2",null,.25)),
    glass: track(daylight("#8aafb9",null,.8)), roof: track(daylight("#899493")),
    paint: track(daylight("#dfdfd2")), tactile: track(daylight("#c7a64c")),
    leaf: track(daylight("#60754b")),
    facades: Array.from({length:5},(_,i)=>{const m=track(daylight("#ffffff",track(facadeTexture(i)),i===0?.65:.24));m.vertexColors=true;return m;}),
  };
  mats.glass.transparent = true; mats.glass.opacity = .38; mats.glass.depthWrite = false;
  const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  const add = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    let batch = batches.get(key); if (!batch) { batch = { material, geometries: [] }; batches.set(key, batch); } batch.geometries.push(geometry);
  };
  const texturedFlat=(rings:number[][][],z:number,scale:number)=>{const g=flat(rings,z),uv=g.attributes.uv!;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)/scale,uv.getY(i)/scale);return g;};
  const streets=surfaceStreets(surface,layout,opts.bundle);
  // Adjacent road/paving polygons, not nearly coplanar overlays: avoids distant
  // depth fighting and gives the asphalt a small, deliberate kerb depression.
  const paving=polygonClipping.difference(surfaceGround(layout,opts.bundle),streets.asphalt);
  for(const poly of paving)add("ground",texturedFlat(poly,-.012,3.2),mats.ground);
  for(const poly of streets.asphalt)add("asphalt",texturedFlat(poly,-.06,5),mats.asphalt);
  mats.paint.polygonOffset=true;mats.paint.polygonOffsetFactor=-1;mats.paint.polygonOffsetUnits=-1;
  for(const poly of streets.markings)add("paint",flat(poly,-.055),mats.paint);
  // Kerbs are context outside the evidence-limited pads, with breaks at openings.
  for(const poly of streets.asphalt)for(const ring of poly)for(let i=1;i<ring.length;i++){
    const a={x:ring[i-1]![0],y:ring[i-1]![1]},b={x:ring[i]![0],y:ring[i]![1]};
    if(Math.hypot(b.x-a.x,b.y-a.y)<.5)continue;
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(inside(mid,streets.pads)||inside(mid,streets.holes))continue;
    add("stone",quad(a,b,-.06,.11),mats.stone);
    add("stone",flat(strip(a,b,.13),.11),mats.stone);
  }
  for(const w of surfacePadWalls(layout,opts.bundle)){
    add("steel",beam(pos(w.a,1.04),pos(w.b,1.04),.042,.042),mats.steel);
    add("steel",beam(pos(w.a,.48),pos(w.b,.48),.028,.028),mats.steel);
    const count=Math.max(1,Math.ceil(Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y)/1.5));
    for(let i=0;i<=count;i++){
      const p={x:w.a.x+(w.b.x-w.a.x)*i/count,y:w.a.y+(w.b.y-w.a.y)*i/count};
      add("steel",beam(pos(p,0),pos(p,1.08),.045,.045),mats.steel);
    }
    add("stone",beam(pos(w.a,.05),pos(w.b,.05),.09,.1),mats.stone);
  }
  for(const w of surfaceColumns(layout,opts.bundle)){
    const p={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};
    add("steel",beam(pos(p,0),pos(p,w.zMax),.08,.08),mats.steel);
  }
  for(const w of surfaceCanopyWalls(layout,opts.bundle)){
    add("stone",quad(w.a,w.b,0,.28),mats.stone);
    add(w.canopyPart==="back"?"stone":"glass",quad(w.a,w.b,.28,2.94),w.canopyPart==="back"?mats.stone:mats.glass);
    add("steel",beam(pos(w.a,.95),pos(w.b,.95),.038,.038),mats.steel);
    add("steel",beam(pos(w.a,.28),pos(w.b,.28),.04,.04),mats.steel);
  }
  const entrances=surfaceEntrances(layout,opts.bundle);
  const atlas=document.createElement("canvas");atlas.width=2048;atlas.height=entrances.length*384;
  const ctx=atlas.getContext("2d")!;
  entrances.forEach((e,index)=>{
    const y=index*384;
    ctx.fillStyle="#edf0ee";ctx.fillRect(0,y,2048,384);
    ctx.fillStyle="#b6007a";ctx.fillRect(0,y+356,2048,28);
    ctx.fillStyle="#2b3439";ctx.font='600 105px sans-serif';ctx.fillText("大江戸線 新宿駅",280,y+122);
    ctx.font='60px sans-serif';ctx.fillText("Oedo Line Shinjuku",280,y+204);
    ctx.font='48px sans-serif';ctx.fillText(e.labelJa,280,y+280);
    ctx.font='32px sans-serif';ctx.fillText(e.labelEn,280,y+330);
    ctx.fillStyle="#b6007a";ctx.fillRect(38,y+74,184,184);
    ctx.fillStyle="#ffffff";ctx.font='600 80px sans-serif';ctx.fillText("E27",53,y+193);
    const at=(along:number,across:number,z:number)=>new THREE.Vector3(e.center.x+e.u.x*along-e.u.y*across,z,-(e.center.y+e.u.y*along+e.u.x*across));
    const glassRoof=new THREE.BoxGeometry(e.halfWidth*2,.028,e.halfLength*2);
    glassRoof.rotateY(Math.atan2(e.u.x,-e.u.y));glassRoof.translate(e.center.x,3.08,-e.center.y);add("glass",glassRoof,mats.glass);
    for(const side of [-1,1]){
      add("steel",beam(at(-e.halfLength,side*e.halfWidth,2.99),at(e.halfLength,side*e.halfWidth,2.99),.075,.09),mats.steel);
      add("steel",beam(at(side*e.halfLength,-e.halfWidth,2.99),at(side*e.halfLength,e.halfWidth,2.99),.075,.09),mats.steel);
    }
    for(let j=1;j<4;j++)add("steel",beam(at(-e.halfLength+e.halfLength*2*j/4,-e.halfWidth,3.08),at(-e.halfLength+e.halfLength*2*j/4,e.halfWidth,3.08),.038,.038),mats.steel);
    // Compact 0.60 m fascia above a 2.70 m entrance clearance, facing the street.
    const sign=new THREE.PlaneGeometry(e.halfWidth*2,.6),uv=sign.attributes.uv!;
    for(let i=0;i<uv.count;i++)uv.setY(i,1-(index+1-uv.getY(i))/entrances.length);
    sign.rotateY(Math.atan2(e.u.x,-e.u.y));const p=at(e.halfLength+.07,0,3.0);sign.translate(p.x,p.y,p.z);
    add("signs",sign,null as unknown as THREE.Material);
    const backing=new THREE.BoxGeometry(e.halfWidth*2,.6,.045);
    backing.rotateY(Math.atan2(e.u.x,-e.u.y));const back=at(e.halfLength,0,3);
    backing.translate(back.x,back.y,back.z);add("steel",backing,mats.steel);
    // Short decorative tactile approach; every stripe remains on existing ground.
    const a=at(e.halfLength+.4,0,0),b=at(e.halfLength+3.3,0,0);
    const stripPoly=strip({x:a.x,y:-a.z},{x:b.x,y:-b.z},.38);
    if(stripPoly[0]!.every(([x,y])=>inside({x,y},streets.pads)&&!inside({x,y},streets.holes))) {
      add("tactile",flat(stripPoly,.012),mats.tactile);
      for(const off of [-.12,0,.12]){const p=at(e.halfLength+.4,off,.018),q=at(e.halfLength+3.3,off,.018);add("tactile",beam(p,q,.017,.012),mats.tactile);}
    }
  });
  // Roofed (E27 roof = 2) runs open to the street beyond the canopies: plain glazing just under canopy height.
  for(const r of surfaceRoofs(layout,opts.bundle,entrances)){
    const at=(along:number,across:number,z:number)=>new THREE.Vector3(r.center.x+r.u.x*along-r.u.y*across,z,-(r.center.y+r.u.y*along+r.u.x*across));
    const roof=new THREE.BoxGeometry(r.halfWidth*2,.028,r.halfLength*2);
    roof.rotateY(Math.atan2(r.u.x,-r.u.y));roof.translate(r.center.x,3.05,-r.center.y);add("glass",roof,mats.glass);
    for(const side of [-1,1]){
      add("steel",beam(at(-r.halfLength,side*r.halfWidth,2.97),at(r.halfLength,side*r.halfWidth,2.97),.075,.09),mats.steel);
      add("steel",beam(at(side*r.halfLength,-r.halfWidth,2.97),at(side*r.halfLength,r.halfWidth,2.97),.075,.09),mats.steel);
    }
  }
  const signTexture=track(new THREE.CanvasTexture(atlas));signTexture.colorSpace=THREE.SRGBColorSpace;
  const signMaterial=track(daylight("#ffffff",signTexture,0,true));signMaterial.side=THREE.FrontSide;
  if(batches.has("signs"))batches.get("signs")!.material=signMaterial;

  const buildings=surfaceBuildingFootprints(surface,layout,opts.bundle);
  for(const b of buildings){
    const h=hash(b.id), style=b.height>65?0:b.usage==="401"?1:(h%4)+1;
    const tint=new THREE.Color().setRGB(.88+(h%9)/100,.88+((h>>>4)%8)/100,.87+((h>>>8)%9)/100);
    const storey=b.storeys&&b.storeys>0?Math.max(3.5,Math.min(4,b.height/b.storeys)):3.8;
    const paint=(g:THREE.BufferGeometry)=>{const n=g.attributes.position!.count,c=new Float32Array(n*3);for(let i=0;i<n;i++)tint.toArray(c,i*3);g.setAttribute("color",new THREE.Float32BufferAttribute(c,3));return g;};
    for(const ring of b.rings)for(let i=1;i<ring.length;i++){
      const a={x:ring[i-1]![0],y:ring[i-1]![1]},q={x:ring[i]![0],y:ring[i]![1]};
      const g=quad(a,q,0,b.height),uv=g.attributes.uv!;
      for(let j=0;j<uv.count;j++)uv.setXY(j,uv.getX(j)/11.2+(h%4)/4,uv.getY(j)/(storey*8)+(h%8)/8);
      add(`facade-${style}`,paint(g),mats.facades[style]!);
      // Slightly recessed-looking generic retail band, with no invented shop names.
      if(b.height>9){const band=quad(a,q,.3,3.5,.025),u=band.attributes.uv!;for(let j=0;j<u.count;j++)u.setXY(j,u.getX(j)/8,u.getY(j)/30.4);add("facade-0",paint(band),mats.facades[0]!);}
      add("roof",quad(a,q,b.height,b.height+.35),mats.roof);
    }
    add("roof",flat(b.rings,b.height+.015),mats.roof);
    if(b.height>35){
      const ring=b.rings[0]!,cx=ring.reduce((s,p)=>s+p[0],0)/ring.length,cy=ring.reduce((s,p)=>s+p[1],0)/ring.length;
      if(inside({x:cx,y:cy},[b.rings])){const g=new THREE.BoxGeometry(3.2,1.9,2.4);g.translate(cx,b.height+.95,-cy);add("roof",g,mats.roof);}
    }
  }
  // Repeated streetscape props use instances and remain outside every walk pad.
  const trees=streets.furniture.filter(f=>f.tree),lights=streets.furniture.filter(f=>!f.tree);
  const instance=(name:string,g:THREE.BufferGeometry,m:THREE.Material,matrices:THREE.Matrix4[],colors?:THREE.Color[])=>{
    if(!matrices.length){g.dispose();return;}
    const mesh=track(new THREE.InstancedMesh(track(g),m,matrices.length));mesh.name=name;
    matrices.forEach((matrix,i)=>{mesh.setMatrixAt(i,matrix);if(colors)mesh.setColorAt(i,colors[i]!);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);
  };
  const matrix=(p:XY,z:number,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(pos(p,z),new THREE.Quaternion(),new THREE.Vector3(sx,sy,sz));
  const foliage:THREE.Matrix4[]=[];const treeColors:THREE.Color[]=[];
  trees.forEach(({p},i)=>{for(let j=0;j<3;j++){foliage.push(matrix({x:p.x+(j-1)*.7,y:p.y+(j%2)*.4},3.5+(j%2)*.6,1.25,1.6,1.25));treeColors.push(new THREE.Color().setRGB(.85+(i%3)*.05,.9,.8));}
    // Planter blocks are original visual context, safely outside walkable pads.
    const box=new THREE.BoxGeometry(1.8,.45,1.8);box.translate(p.x,.225,-p.y);add("stone",box,mats.stone);
  });
  instance("surface-tree-crowns",new THREE.IcosahedronGeometry(1,1),mats.leaf,foliage,treeColors);
  instance("surface-tree-trunks",new THREE.CylinderGeometry(.12,.17,3,6),mats.stone,trees.map(({p})=>matrix(p,1.6)),trees.map(()=>new THREE.Color("#75685b")));
  const lampParts=[new THREE.CylinderGeometry(.055,.095,6,8),new THREE.BoxGeometry(.85,.12,.28)];lampParts[0]!.translate(0,3,0);lampParts[1]!.translate(.32,6,0);
  const lamp=mergeGeometries(lampParts,false)!;lampParts.forEach(g=>g.dispose());instance("surface-streetlights",lamp,mats.steel,lights.map(({p})=>matrix(p,0)));
  for(const {p,u} of lights){
    const safe=(q:XY)=>!inside(q,streets.pads)&&!inside(q,streets.holes)&&!inside(q,streets.asphalt)&&!inside(q,surface.buildings.map(b=>b.rings));
    const a={x:p.x+u.x*2,y:p.y+u.y*2},b={x:p.x+u.x*5,y:p.y+u.y*5};
    const samples=Array.from({length:31},(_,i)=>({x:a.x+(b.x-a.x)*i/30,y:a.y+(b.y-a.y)*i/30}));
    if(!samples.every(q=>[-.15,0,.15].every(dx=>[-.15,0,.15].every(dy=>safe({x:q.x+dx,y:q.y+dy})))))continue;
    add("steel",beam(pos(a,.85),pos(b,.85),.04,.04),mats.steel);
    for(const q of [a,b]){
      const bollard=new THREE.CylinderGeometry(.065,.065,.9,8);bollard.translate(q.x,.45,-q.y);add("steel",bollard,mats.steel);
      const cap=new THREE.CylinderGeometry(.067,.067,.08,8);cap.translate(q.x,.78,-q.y);add("paint",cap,mats.paint);
    }
  }

  for(const [name,batch] of batches){
    const gs=batch.geometries;if(!gs.length)continue;const color=name.startsWith("facade-");
    for(const g of gs){
      if(!g.index)g.setIndex(Array.from({length:g.attributes.position!.count},(_,i)=>i));
      for(const n of Object.keys(g.attributes))if(!["position","normal","uv",...(color?["color"]:[])].includes(n))g.deleteAttribute(n);
      if(!g.attributes.normal)g.computeVertexNormals();
      if(!g.attributes.uv)g.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count*2),2));
    }
    const merged=mergeGeometries(gs,false)!;gs.forEach(g=>g.dispose());
    const mesh=new THREE.Mesh(track(merged),batch.material);mesh.name=`surface-${name}`;root.add(mesh);
  }
  const dome=new THREE.Mesh(track(new THREE.SphereGeometry(300,24,12)),track(skyMaterial()));dome.name="surface-sky";dome.frustumCulled=false;dome.renderOrder=-1000;root.add(dome);
  root.userData.drawCallBudget=batches.size+4;root.userData.buildingParts=buildings.length;
  batches.clear();
  return {root,resources,visibility:{entrances,openings:streets.holes}};
}
