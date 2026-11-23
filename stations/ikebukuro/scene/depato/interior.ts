import type * as T from "three";
import type { SceneContext } from "@gteki/scene-api";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildEscalator } from "../../../../apps/web/src/explorer/greyboxConnectors.ts";
import { buildCrowd, type Lane } from "../crowd.ts";
import type { DepatoLayout } from "./layout.ts";
import { LANDMARK_FACADE, LANDMARK_STREET_BAND, LANDMARK_SIGN } from "../landmark-style.ts";

/** AD 2026-11-22 JST: one neutral retail kit, baked pools, no scene lights. */
export function buildDepatoInterior(ctx: SceneContext, plan: DepatoLayout, envMap?: T.Texture) {
  const THREE = ctx.THREE, root = new THREE.Group(); root.name = `depato-interior:${plan.input.store.id}`;
  const depthTwins:{mesh:T.Mesh;twin:T.Material;original:T.Material}[]=[];
  root.userData.gteki_gtao_depth_twins=depthTwins;
  const walkable: T.Mesh[] = [], colliders: T.Mesh[] = [], cameraBlockers: T.Mesh[] = [];
  const physicalGeometry: T.BufferGeometry[] = [];
  const collisionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const physical = (g: T.BufferGeometry, target: T.Mesh[], support = false) => {
    const mesh = new THREE.Mesh(g, collisionMaterial); mesh.visible = false;
    mesh.userData.gteki_role = target === walkable ? "floor" : "collider";
    if (support) mesh.userData.gtekiStairWalkSupport = true;
    physicalGeometry.push(g); target.push(mesh);
  };
  const shape = (y: number, hole: boolean, ceiling = false) => {
    const s = new THREE.Shape(plan.input.footprint.map(([x,z]) => new THREE.Vector2(x,-z)));
    if (hole) {
      const { x, from, to, width } = plan.stair;
      s.holes.push(new THREE.Path([[x-width/2,-from],[x+width/2,-from],[x+width/2,-to],[x-width/2,-to]].map(([x,z]) => new THREE.Vector2(x!,z!))));
    }
    const g = new THREE.ShapeGeometry(s).toNonIndexed(); g.rotateX(-Math.PI/2); g.translate(0,y,0);
    if(ceiling){
      // GTAO's front-face depth pass must see the underside, just like the main render.
      g.setIndex(Array.from({length:g.getAttribute("position").count},(_,i)=>i%3===0?i:i%3===1?i+1:i-1));
      const down=g.toNonIndexed();g.dispose();down.computeVertexNormals();return down;
    }
    return g;
  };
  const cube = (x:number,y:number,z:number,w:number,h:number,d:number,yaw=0) => {
    const g = new THREE.BoxGeometry(w,h,d).toNonIndexed(); g.rotateY(yaw); g.translate(x,y,z); return g;
  };
  const walls = (level:string, y:number, clear:number) => {
    const pieces:T.BufferGeometry[]=[];
    for (let i=0;i<plan.input.footprint.length;i++) {
      const a=plan.input.footprint[i]!, b=plan.input.footprint[(i+1)%plan.input.footprint.length]!;
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const cuts=plan.input.entrances.filter(e=>e.level===level).flatMap(e=>{
        const t=((e.point[0]-a[0])*(b[0]-a[0])+(e.point[1]-a[1])*(b[1]-a[1]))/length**2;
        return t>=0 && t<=1 && Math.hypot(e.point[0]-a[0]-t*(b[0]-a[0]),e.point[1]-a[1]-t*(b[1]-a[1]))<0.1 ? [t*length] : [];
      }).sort((a,b)=>a-b);
      const part=(from:number,to:number,bottom=y,height=clear)=>{
        const t=(from+to)/2/length;
        pieces.push(cube(a[0]+(b[0]-a[0])*t,bottom+height/2,a[1]+(b[1]-a[1])*t,to-from,height,0.16,-Math.atan2(b[1]-a[1],b[0]-a[0])));
      };
      let start=0;
      for(const door of cuts){part(start,door-2);part(door-2,door+2,y+2.8,clear-2.8);start=door+2;}
      part(start,length);
    }
    const merged=mergeGeometries(pieces); pieces.forEach(g=>g.dispose()); return merged;
  };
  const levels=plan.floors.map((floor,index)=>{
    const y=plan.height(floor.level), food=floor.category==="food-hall" || floor.category==="sweets", clear=food?3.1:3.8;
    const wallHeight=index+1<plan.floors.length?plan.height(plan.floors[index+1]!.level)-y:clear;
    const floorG=shape(y,index>0), ceilingG=shape(y+clear,index+1<plan.floors.length,true), wallG=walls(floor.level,y,wallHeight);
    physical(floorG.clone(),walkable); physical(ceilingG.clone(),colliders); physical(wallG.clone(),colliders);
    if(index>0){
      // The follow boom must clear the upper floor even while its endpoint is over the well.
      physical(cube(plan.stair.x,y+0.08,(plan.stair.from+plan.stair.to)/2,plan.stair.width,0.16,plan.stair.to-plan.stair.from),cameraBlockers);
      cameraBlockers.at(-1)!.userData.gtekiCameraTargetOnly=true;
    }
    if(index>0)for(const side of [-1,1])physical(cube(plan.aisleX+side*2.13,y+0.55,(plan.stair.from+plan.stair.to)/2,0.025,1.1,plan.stair.to-plan.stair.from),colliders);
    for(const [x,z] of plan.counters) physical(cube(x,y+0.48,z,1.1,0.96,4),colliders);
    return {floor,index,y,food,clear,floorG,ceilingG,wallG};
  });
  const flights=levels.slice(1).flatMap((upper,i)=>{
    const lower=levels[i]!, {x,from,to}=plan.stair;
    return [-1,1].map(side=>{
      const a=new THREE.Vector3(x+side*0.95,side<0?lower.y:upper.y,from);
      const b=new THREE.Vector3(x+side*0.95,side<0?upper.y:lower.y,to);
      const parts=buildEscalator(a,b,ctx.quality);
      for(const part of parts.filter(p=>p.role)) {
        const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(part.position,3)); g.computeVertexNormals();
        physical(g,part.role==="walkable"?walkable:colliders,part.walkableOnly===true);
      }
      // The shared family supplies steps, skirts, glass and rubber. Yellow nosings are store-neutral.
      return {lower:i,upper:i+1,a,b,parts};
    });
  });
  const bridges:T.BufferGeometry[]=[];
  for(const e of plan.input.entrances){
    const n=ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!;
    const a=new THREE.Vector3(...ctx.enuToRenderer({...n.position,z:n.position.z!})), b=new THREE.Vector3(e.point[0],plan.height(e.level),e.point[1]);
    // Overlap the footprint: an entrance point rounded off the sloping edge must not leave a floor crack.
    b.add(new THREE.Vector3(b.x-a.x,0,b.z-a.z).normalize().multiplyScalar(0.5));
    const normal=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize().multiplyScalar(2);
    const corners=[a.clone().add(normal),a.clone().sub(normal),b.clone().sub(normal),b.clone().add(normal)];
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i=>corners[i]!.toArray()),3));g.computeVertexNormals();
    physical(g.clone(),walkable);bridges.push(g);
  }
  let geometries:T.BufferGeometry[]=[], materials:T.Material[]=[], textures:T.Texture[]=[];
  let groups:T.Group[]=[], landingGroups:T.Group[]=[], flightGroups:T.Group[]=[], loaded=false;
  let avatar:{x:number;y:number;z:number}|null=null;
  let crowds:ReturnType<typeof buildCrowd>[]=[];
  const retain=<G extends T.BufferGeometry>(g:G)=>{geometries.push(g);return g;};
  const basic=(color:string)=>{const m=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,fog:false});materials.push(m);return m;};
  const standard=(color:string,roughness:number,emissive=0)=>{
    const m=new THREE.MeshStandardMaterial({color,roughness,envMap,envMapIntensity:0.8,emissive:color,emissiveIntensity:emissive,side:THREE.DoubleSide,fog:false});materials.push(m);return m;
  };
  const glass=()=>{const m=standard("#b4c4c0",0.32);m.transparent=true;m.opacity=0.28;m.depthWrite=false;m.metalness=0.08;return m;};
  const load=()=>{
    // Allowed interim baked gradient: same 4.4 m tile as the downlight grid, no runtime pool lights.
    const pixels=new Uint8Array(64*64*4);
    for(let z=0;z<64;z++)for(let x=0;x<64;x++){
      const pool=Math.exp(-((x-32)**2+(z-32)**2)/170), value=0.88+0.12*pool;
      const at=(z*64+x)*4;pixels.set([255*value,252*value,246*value,255],at);
    }
    const pool=new THREE.DataTexture(pixels,64,64);pool.colorSpace=THREE.SRGBColorSpace;pool.wrapS=pool.wrapT=THREE.RepeatWrapping;pool.repeat.set(1/4.4,1/4.4);pool.offset.set(0.5,0.5);pool.needsUpdate=true;textures.push(pool);
    const counterMat=basic("#e6ddcd"), glassMat=glass(), bronze=standard(LANDMARK_FACADE.F4_darkBronze,0.5,0.12), glow=basic(LANDMARK_STREET_BAND.glow);
    const boards=levels.flatMap(l=>[{ja:`${plan.input.store.name.ja} ${l.floor.level}`,en:l.floor.label.en},...l.floor.tenants]);
    const directoryJa=plan.floors.map(f=>`${f.level} ${f.label.ja}`).join(" / ");
    const directoryEn=plan.floors.map(f=>`${f.level} ${f.label.en}`).join(" / ");
    boards.push({ja:directoryJa,en:directoryEn});
    const canvas=typeof document!=="undefined"?document.createElement("canvas"):null;
    const slots:{x:number;y:number;width:number}[]=[];
    let atlas:T.CanvasTexture|null=null;
    if(canvas){
      canvas.width=canvas.height=1024;const paint=canvas.getContext("2d")!;
      paint.fillStyle="#EFE9DD";paint.fillRect(0,0,1024,1024);paint.textAlign="center";
      const storeRows=levels.map((_,i)=>levels.slice(0,i).reduce((n,l)=>n+l.floor.tenants.length+1,0));
      let x=0,y=0;
      boards.forEach((b,i)=>{
        paint.font='600 18px "GTEki Sign JP"';const ja=paint.measureText(b.ja).width;
        paint.font=`600 ${18*LANDMARK_SIGN.enScale}px "GTEki Sign JP"`;const en=paint.measureText(b.en).width;
        const width=Math.min(1024,Math.ceil(Math.max(ja,en))+12);
        if(x+width>1024){x=0;y+=40;}
        if(y+40>1024)throw new Error(`Department-store board atlas exceeds 1024px: ${plan.input.store.id}`);
        slots.push({x,y,width});const door=storeRows.includes(i);
        paint.fillStyle=door?LANDMARK_SIGN.band:"#EFE9DD";paint.fillRect(x,y,width,40);paint.fillStyle=door?LANDMARK_SIGN.letters:LANDMARK_SIGN.band;
        paint.font='600 18px "GTEki Sign JP"';paint.fillText(b.ja,x+width/2,y+20,width-12);
        paint.font=`600 ${18*LANDMARK_SIGN.enScale}px "GTEki Sign JP"`;paint.fillText(b.en,x+width/2,y+33,width-12);
        x+=width;
      });
      atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;textures.push(atlas);
    }
    const boardMaterial=basic("#ffffff");boardMaterial.map=atlas;
    const instance=(group:T.Group,g:T.BufferGeometry,m:T.Material,positions:{x:number;y:number;z:number;scale?:[number,number,number]}[])=>{
      retain(g);const mesh=new THREE.InstancedMesh(g,m,positions.length),matrix=new THREE.Matrix4();
      positions.forEach((p,i)=>{matrix.compose(new THREE.Vector3(p.x,p.y,p.z),new THREE.Quaternion(),new THREE.Vector3(...(p.scale??[1,1,1])));mesh.setMatrixAt(i,matrix);});mesh.computeBoundingSphere();group.add(mesh);return mesh;
    };
    const matteNormal=new THREE.MeshNormalMaterial({side:THREE.DoubleSide,blending:THREE.NoBlending,transparent:true,opacity:0});
    matteNormal.allowOverride=false;
    materials.push(matteNormal);
    const matte=(mesh:T.Mesh)=>{depthTwins.push({mesh,twin:matteNormal,original:mesh.material as T.Material});return mesh;};
    let label=0;
    for(const l of levels){
      const group=new THREE.Group(), landing=new THREE.Group();groups.push(group);landingGroups.push(landing);root.add(group,landing);
      const fm=basic("#d6cfc2");fm.lightMap=pool;fm.lightMapIntensity=1.12;
      const shell=[l.ceilingG.clone(),l.wallG.clone()];
      shell.forEach((g,i)=>{const c=new THREE.Color(i===0?"#fff2dc":"#9e8c72");g.setAttribute("color",new THREE.Float32BufferAttribute(Array.from({length:g.getAttribute("position").count},()=>[c.r,c.g,c.b]).flat(),3));});
      const shellG=retain(mergeGeometries(shell));shell.forEach(g=>g.dispose());const shellMat=basic("#ffffff");shellMat.vertexColors=true;
      shellMat.fog=false; // The station's 90 m fog must not turn the aisle end walls black.
      // Both store shells remain visible through the well and behind the landing camera.
      const floorMesh=matte(new THREE.Mesh(l.floorG,fm)),shellMesh=new THREE.Mesh(shellG,shellMat);
      floorMesh.name=`retail-floor-${l.floor.level}`;shellMesh.name=`retail-shell-${l.floor.level}`;
      root.add(floorMesh,shellMesh);
      const pad=cube(plan.aisleX,l.y-0.035,plan.stair.to+1,5,0.07,2);retain(pad);landing.add(matte(new THREE.Mesh(pad,fm)));
      const discs:{x:number;y:number;z:number}[]=[];
      for(let z=Math.ceil(plan.bounds.front/4.4)*4.4;z<plan.bounds.back;z+=4.4)for(let x=Math.ceil(plan.bounds.left/4.4)*4.4;x<plan.bounds.right;x+=4.4){
        if(plan.contains([x,z]) && !(Math.abs(x-plan.stair.x)<2.3 && z>plan.stair.from && z<plan.stair.to))discs.push({x,y:l.y+l.clear-0.025,z});
      }
      instance(group,new THREE.CylinderGeometry(0.12,0.12,0.025,8),glow,discs);
      const positions=plan.counters.map(([x,z])=>({x,y:l.y+0.475,z}));
      instance(group,new THREE.BoxGeometry(1.1,l.food?0.58:0.95,4),counterMat,positions.map(p=>({...p,y:l.y+(l.food?0.29:0.475)})));
      const detail:T.BufferGeometry[]=[], frames:T.BufferGeometry[]=[], signs:T.BufferGeometry[]=[], glassPieces:T.BufferGeometry[]=[], bays:T.BufferGeometry[]=[], lit:T.BufferGeometry[]=[];
      // Repeated shallow bays and a warm cove frame the main aisle without runtime lights.
      for(const axis of [0,1] as const){
        const cross=axis===0?1:0, lo=axis===0?plan.bounds.front:plan.bounds.left, hi=axis===0?plan.bounds.back:plan.bounds.right;
        for(let v=Math.ceil(lo/4.4)*4.4-2.2;v<hi;v+=4.4){
          if(v<=lo)continue;
          const ends=plan.input.footprint.flatMap((a,i)=>{
            const b=plan.input.footprint[(i+1)%plan.input.footprint.length]!;
            return (a[cross]<=v&&b[cross]>v)||(b[cross]<=v&&a[cross]>v)?[a[axis]+(b[axis]-a[axis])*(v-a[cross])/(b[cross]-a[cross])]:[];
          }).sort((a,b)=>a-b);
          for(let i=0;i<ends.length;i+=2){
            const from=ends[i]!,to=ends[i+1]!, cut=axis===0?[plan.stair.x-plan.stair.width/2,plan.stair.x+plan.stair.width/2]:[plan.stair.from,plan.stair.to];
            const overWell=axis===0?v>plan.stair.from&&v<plan.stair.to:Math.abs(v-plan.stair.x)<plan.stair.width/2;
            const spans=l.index+1<levels.length&&overWell?[[from,Math.min(to,cut[0]!)],[Math.max(from,cut[1]!),to]]:[[from,to]];
            for(const [a,b] of spans)if(b!>a!)bays.push(cube(axis===0?(a!+b!)/2:v,l.y+l.clear-0.08,axis===0?v:(a!+b!)/2,axis===0?b!-a!:0.1,0.16,axis===0?0.1:b!-a!));
          }
        }
      }
      for(const side of [-1,1])for(const [from,to] of [[plan.bounds.front+0.5,plan.stair.from],[plan.stair.to,plan.bounds.back-0.5]]){
        bays.push(cube(plan.aisleX+side*1.6,l.y+l.clear-0.18,(from!+to!)/2,0.18,0.36,to!-from!));
        lit.push(cube(plan.aisleX+side*1.48,l.y+l.clear-0.13,(from!+to!)/2,0.08,0.05,to!-from!));
      }
      const board=(x:number,y:number,z:number,row:number,yaw=0,width=3.8,height=0.6)=>{
        const slot=slots[row]!, labelHeight=height*0.6;
        const labelWidth=slot.width/40*labelHeight, scale=Math.min(1,(width-0.1)/labelWidth);
        for(const face of [0,1,-1]){
          const text=face!==0;
          const g=new THREE.PlaneGeometry(text?labelWidth*scale:width,text?labelHeight*scale:height).toNonIndexed(),uv=g.getAttribute("uv");
          for(let i=0;i<uv.count;i++){
            uv.setX(i,(slot.x+(text?uv.getX(i)*slot.width:1))/1024);
            uv.setY(i,1-(slot.y+(text?(1-uv.getY(i))*40:1))/1024);
          }
          g.rotateY(yaw+(face<0?Math.PI:0));g.translate(x+Math.sin(yaw)*face*0.002,y,z+Math.cos(yaw)*face*0.002);signs.push(g);
        }
      };
      const contents:{x:number;y:number;z:number}[]=[];
      plan.counters.forEach(([x,z],i)=>{
        const side=x<plan.aisleX?-1:1, front=x-side*0.56;
        if(l.food){
          glassPieces.push(cube(front,l.y+0.76,z,0.025,0.38,4));
          detail.push(cube(x+side*0.48,l.y+1.2,z,0.12,2.4,4));
          lit.push(cube(x,l.y+0.58,z,1.06,0.025,3.96),cube(x+side*0.43,l.y+0.76,z,0.025,0.34,3.96),cube(front,l.y+0.95,z,0.06,0.035,3.96));
          for(let j=0;j<10;j++)for(let k=0;k<2;k++)contents.push({x:x-0.3+k*0.32,y:l.y+0.68,z:z-1.7+j*0.37});
        }else detail.push(cube(x+side*0.3,l.y+1.25,z,0.04,0.55,2.8));
        board(x-side*0.58,l.y+2.2,z,label+(l.floor.tenants.length?1+i%l.floor.tenants.length:0),side<0?Math.PI/2:-Math.PI/2);
      });
      if(contents.length){
        const foodMesh=instance(group,new THREE.CapsuleGeometry(0.065,0.06,3,5),glow,contents.map(p=>({...p,scale:[1,0.7,1.4] as [number,number,number]})));
        const tones=["#d8c8a3","#b99b74","#8e745e","#9caa88"];
        contents.forEach((_,i)=>foodMesh.setColorAt(i,new THREE.Color(tones[i%4])));
      }
      for(const e of plan.input.entrances.filter(e=>e.level===l.floor.level)){
        const front=e.point[1]===plan.bounds.front,yaw=front?0:Math.PI/2;
        board(e.point[0],l.y+2.45,e.point[1],label,yaw,3.8,0.6);
        // Identical bronze lintel/reveals on every entrance, inside and outside.
        frames.push(cube(e.point[0],l.y+2.76,e.point[1],front?4:0.3,0.12,front?0.3:4));
        // Bronze double doorway; clear centre remains walkable in either direction.
        for(const side of [-1,1])frames.push(cube(e.point[0]+(front?side*1.85:0),l.y+1.35,e.point[1]+(front?0:side*1.85),front?0.08:0.3,2.7,front?0.3:0.08));
        // Glazed leaves stand open against the jambs, never across the walk line.
        for(const side of [-1,1])glassPieces.push(cube(e.point[0]+(front?side*1.8:-0.65),l.y+1.3,e.point[1]+(front?0.65:side*1.8),front?0.025:1.3,2.6,front?1.3:0.025));
      }
      // Non-emissive floor directory; underline marks this floor without a colour code.
      for(const [z,yaw] of [[plan.stair.from-2,0],[plan.stair.to+2,Math.PI]]){
        board(plan.aisleX-3,l.y+2.15,z!,boards.length-1,yaw!,4,0.65);
        frames.push(cube(plan.aisleX-3,l.y+1.93-l.index*0.06,z!+0.01,3.8,0.018,0.018));
      }
      board(plan.aisleX,l.y+l.clear-0.48,plan.stair.to+5,label,0,3.4,0.45);
      if(l.index>0)for(const side of [-1,1])glassPieces.push(cube(plan.aisleX+side*2.13,l.y+0.55,(plan.stair.from+plan.stair.to)/2,0.025,1.1,plan.stair.to-plan.stair.from));
      if(bays.length){const g=retain(mergeGeometries(bays));bays.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,basic("#e5d9c4")));}
      if(lit.length){const g=retain(mergeGeometries(lit));lit.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,glow));}
      // Station whole-body people use short, narrow counter-side paths, away from circulation.
      const lanes:Record<string,Lane>={};
      const paths=plan.counters.filter(([x])=>Math.abs(x-plan.aisleX)>6).map(([x,z],i)=>{
        const id=`retail-${i}`,side=x<plan.aisleX?-1:1,px=x+side*1.3;
        lanes[id]={stepM:3,left:[0.2],right:[0.2]};
        return {id,from:`${id}-a`,to:`${id}-b`,verification:"verified",geometry:[{x:px,y:-z+1.3,z:l.y},{x:px,y:-z-1.3,z:l.y}]};
      }).filter(p=>p.geometry.every(p=>plan.contains([p.x,-p.y])));
      const crowd=buildCrowd(THREE,paths,(x,y,z)=>new THREE.Vector3(x,z,-y),8,envMap!,lanes);
      crowds.push(crowd);group.add(crowd.group);
      if(detail.length){const g=mergeGeometries(detail);retain(g);detail.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,counterMat));}
      if(frames.length){const g=mergeGeometries(frames);retain(g);frames.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,bronze));}
      if(glassPieces.length){const g=mergeGeometries(glassPieces);retain(g);glassPieces.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,glassMat));}
      if(signs.length){const g=mergeGeometries(signs);retain(g);signs.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,boardMaterial));}
      label+=l.floor.tenants.length+1;
    }
    for(const lower of levels.slice(0,-1)){
      const pair=flights.filter(f=>f.lower===lower.index);
      const group=new THREE.Group();flightGroups.push(group);root.add(group);
      const solids:T.BufferGeometry[]=[], glasses:T.BufferGeometry[]=[];
      for(const flight of pair)for(const p of flight.parts.filter(p=>!p.walkableOnly)){
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p.position,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(p.normal,3));
        const finish={tread:"#30383c",riser:"#30383c",nosing:"#f2c94c",escStep:"#30383c",rubber:"#14191b",escTruss:"#b49e7e",steel:"#889fa4",glass:"#b4ccd1",light:"#ffe0a1",lampOk:"#89a37b",lampNo:"#b27565"}[p.material];
        const c=new THREE.Color(finish),colors=Array.from({length:p.position.length/3},()=>[c.r,c.g,c.b]).flat();
        g.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));(p.material==="glass"?glasses:solids).push(g);
      }
      for(const flight of pair)for(let i=0;i<=30;i++){
        const t=i/30,g=cube(flight.a.x,THREE.MathUtils.lerp(flight.a.y,flight.b.y,t)+0.012,THREE.MathUtils.lerp(flight.a.z,flight.b.z,t),0.98,0.015,0.025);
        g.deleteAttribute("uv");const color=new THREE.Color("#f2c94c");g.setAttribute("color",new THREE.Float32BufferAttribute(Array.from({length:g.getAttribute("position").count},()=>[color.r,color.g,color.b]).flat(),3));solids.push(g);
      }
      const solid=mergeGeometries(solids),glassG=mergeGeometries(glasses);retain(solid);retain(glassG);solids.forEach(g=>g.dispose());glasses.forEach(g=>g.dispose());
      const steel=basic("#ffffff");steel.vertexColors=true;const finishMesh=new THREE.Mesh(solid,steel);finishMesh.name=`retail-escalators-${lower.floor.level}`;
      group.add(finishMesh,new THREE.Mesh(glassG,glassMat));
    }
    bridges.forEach((g,i)=>groups[levels.findIndex(l=>l.floor.level===plan.input.entrances[i]!.level)]!.add(new THREE.Mesh(g,basic("#bdb5a7"))));
    root.userData.depato={atlasPx:1024,boardContrast:10.625628349541163,floorRoughness:[0.85,0.85],clearHeights:levels.map(l=>l.clear),drawCallsPerFloor:groups.map((g,i)=>g.children.length+2*levels.slice(0,-1).filter(l=>l.index===i||l.index+1===i).length),font:'GTEki Sign JP',jaCapHeightM:0.15};
  };
  const unload=()=>{depthTwins.length=0;crowds.forEach(c=>c.dispose());crowds=[];root.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());geometries=[];materials=[];textures=[];groups=[];landingGroups=[];flightGroups=[];loaded=false;};
  return {root,walkable,colliders,cameraBlockers,setAvatar(p:typeof avatar){avatar=p;},
    update(camera:T.Camera,dt=0,elapsed=0){
      const cameraP=camera.getWorldPosition(new THREE.Vector3()),p=avatar??{x:cameraP.x,y:cameraP.y-2,z:cameraP.z};
      const near=(plan.contains([p.x,p.z]) && p.y>=levels[0]!.y-1 && p.y<=levels.at(-1)!.y+levels.at(-1)!.clear) || plan.input.entrances.some(e=>Math.hypot(p.x-e.point[0],p.z-e.point[1],p.y-plan.height(e.level))<40);
      if(!near){if(loaded)unload();return;}
      if(!loaded){loaded=true;load();}
      let floor=0;for(const l of levels)if(l.y<=p.y+0.2)floor=l.index;
      groups.forEach((g,i)=>{g.visible=i===floor;if(g.visible)crowds[i]!.update(dt,elapsed);});landingGroups.forEach(g=>g.visible=false);
      const riding=p.y>levels[floor]!.y+0.25 && floor+1<levels.length;
      if(riding)landingGroups[floor+1]!.visible=true;
      flightGroups.forEach((g,i)=>g.visible=i===floor || i+1===floor);
    },
    dispose(){unload();for(const g of physicalGeometry)g.dispose();for(const l of levels){l.floorG.dispose();l.ceilingG.dispose();l.wallG.dispose();}bridges.forEach(g=>g.dispose());collisionMaterial.dispose();},
  };
}
