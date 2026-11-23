import type * as T from "three";
import type { SceneContext } from "@gteki/scene-api";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildEscalator } from "../../../../apps/web/src/explorer/greyboxConnectors.ts";
import type { DepatoLayout } from "./layout.ts";
import { LANDMARK_FACADE, LANDMARK_STREET_BAND, LANDMARK_SIGN } from "../landmark-style.ts";

/** AD 2026-11-22 JST: one neutral retail kit, baked pools, no scene lights. */
export function buildDepatoInterior(ctx: SceneContext, plan: DepatoLayout, envMap?: T.Texture) {
  const THREE = ctx.THREE, root = new THREE.Group(); root.name = `depato-interior:${plan.input.store.id}`;
  const walkable: T.Mesh[] = [], colliders: T.Mesh[] = [];
  const physicalGeometry: T.BufferGeometry[] = [];
  const collisionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const physical = (g: T.BufferGeometry, target: T.Mesh[], support = false) => {
    const mesh = new THREE.Mesh(g, collisionMaterial); mesh.visible = false;
    mesh.userData.gteki_role = target === walkable ? "floor" : "collider";
    if (support) mesh.userData.gtekiStairWalkSupport = true;
    physicalGeometry.push(g); target.push(mesh);
  };
  const shape = (y: number, hole: boolean) => {
    const s = new THREE.Shape(plan.input.footprint.map(([x,z]) => new THREE.Vector2(x,-z)));
    if (hole) {
      const { x, from, to, width } = plan.stair;
      s.holes.push(new THREE.Path([[x-width/2,-from],[x+width/2,-from],[x+width/2,-to],[x-width/2,-to]].map(([x,z]) => new THREE.Vector2(x!,z!))));
    }
    const g = new THREE.ShapeGeometry(s).toNonIndexed(); g.rotateX(-Math.PI/2); g.translate(0,y,0); return g;
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
    const floorG=shape(y,index>0), ceilingG=shape(y+clear,index+1<plan.floors.length), wallG=walls(floor.level,y,clear);
    physical(floorG.clone(),walkable); physical(ceilingG.clone(),colliders); physical(wallG.clone(),colliders);
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
    const normal=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize().multiplyScalar(2);
    const corners=[a.clone().add(normal),a.clone().sub(normal),b.clone().sub(normal),b.clone().add(normal)];
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i=>corners[i]!.toArray()),3));g.computeVertexNormals();
    physical(g.clone(),walkable);bridges.push(g);
  }
  let geometries:T.BufferGeometry[]=[], materials:T.Material[]=[], textures:T.Texture[]=[];
  let groups:T.Group[]=[], landingGroups:T.Group[]=[], flightGroups:T.Group[]=[], loaded=false;
  let people:{mesh:T.InstancedMesh;floor:number}[]=[];
  let avatar:{x:number;y:number;z:number}|null=null;
  const retain=<G extends T.BufferGeometry>(g:G)=>{geometries.push(g);return g;};
  const basic=(color:string)=>{const m=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide});materials.push(m);return m;};
  const standard=(color:string,roughness:number,emissive=0)=>{
    const m=new THREE.MeshStandardMaterial({color,roughness,envMap,envMapIntensity:0.8,emissive:color,emissiveIntensity:emissive,side:THREE.DoubleSide});materials.push(m);return m;
  };
  const glass=()=>{const m=standard("#b4c4c0",0.32);m.transparent=true;m.opacity=0.28;m.depthWrite=false;m.metalness=0.08;return m;};
  const load=()=>{
    // Allowed interim baked gradient: same 2.2 m tile as the downlight grid, no runtime pool lights.
    const pixels=new Uint8Array(64*64*4);
    for(let z=0;z<64;z++)for(let x=0;x<64;x++){
      const pool=Math.exp(-((x-32)**2+(z-32)**2)/420), value=0.78+0.22*pool;
      const at=(z*64+x)*4;pixels.set([255*value,241*value,222*value,255],at);
    }
    const pool=new THREE.DataTexture(pixels,64,64);pool.colorSpace=THREE.SRGBColorSpace;pool.wrapS=pool.wrapT=THREE.RepeatWrapping;pool.repeat.set(1/2.2,1/2.2);pool.needsUpdate=true;textures.push(pool);
    const counterMat=standard("#eee6d6",0.35,0.12), glassMat=glass(), bronze=standard(LANDMARK_FACADE.F4_darkBronze,0.5,0.12), glow=standard(LANDMARK_STREET_BAND.glow,0.5,0.35);
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
    let label=0;
    for(const l of levels){
      const group=new THREE.Group(), landing=new THREE.Group();groups.push(group);landingGroups.push(landing);root.add(group,landing);
      const fm=standard("#D6CFC2",l.food?0.3:0.24,l.food?0.24:0.32);fm.map=pool;
      fm.onBeforeCompile=shader=>{
        shader.vertexShader="varying vec3 retailPosition;\n"+shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nretailPosition = position;");
        shader.fragmentShader="varying vec3 retailPosition;\n"+shader.fragmentShader.replace("#include <map_fragment>",`#include <map_fragment>
 diffuseColor.rgb *= 1.0 + 0.2 * (1.0-smoothstep(2.0,5.0,abs(retailPosition.x-${plan.stair.x}))) * (1.0-smoothstep(7.0,12.0,abs(retailPosition.z-${(plan.stair.from+plan.stair.to)/2})));`);
      };
      group.add(new THREE.Mesh(l.floorG,fm),new THREE.Mesh(l.ceilingG,basic("#ded3c2")),new THREE.Mesh(l.wallG,basic("#d2c6b4")));
      const pad=cube(plan.aisleX,l.y-0.035,plan.stair.to+1,5,0.07,2);retain(pad);landing.add(new THREE.Mesh(pad,fm));
      const discs:{x:number;y:number;z:number}[]=[];
      for(let z=Math.ceil(plan.bounds.front/2.2)*2.2;z<plan.bounds.back;z+=2.2)for(let x=Math.ceil(plan.bounds.left/2.2)*2.2;x<plan.bounds.right;x+=2.2){
        if(plan.contains([x,z]) && !(Math.abs(x-plan.stair.x)<2.3 && z>plan.stair.from && z<plan.stair.to))discs.push({x,y:l.y+l.clear-0.025,z});
      }
      instance(group,new THREE.CylinderGeometry(0.075,0.075,0.025,8),basic("#f3e6d3"),discs);
      const positions=plan.counters.map(([x,z])=>({x,y:l.y+0.475,z}));
      instance(group,new THREE.BoxGeometry(1.1,l.food?0.58:0.95,4),counterMat,positions.map(p=>({...p,y:l.y+(l.food?0.29:0.475)})));
      const detail:T.BufferGeometry[]=[], frames:T.BufferGeometry[]=[], signs:T.BufferGeometry[]=[], glassPieces:T.BufferGeometry[]=[];
      const board=(x:number,y:number,z:number,row:number,yaw=0,width=3.8,height=0.6)=>{
        const slot=slots[row]!, labelHeight=height*0.6;
        const labelWidth=slot.width/40*labelHeight, scale=Math.min(1,(width-0.1)/labelWidth);
        for(const text of [false,true]){
          const g=new THREE.PlaneGeometry(text?labelWidth*scale:width,text?labelHeight*scale:height).toNonIndexed(),uv=g.getAttribute("uv");
          for(let i=0;i<uv.count;i++){
            uv.setX(i,(slot.x+(text?uv.getX(i)*slot.width:1))/1024);
            uv.setY(i,1-(slot.y+(text?(1-uv.getY(i))*40:1))/1024);
          }
          g.rotateY(yaw);g.translate(x+Math.sin(yaw)*(text?0.002:0),y,z+Math.cos(yaw)*(text?0.002:0));signs.push(g);
        }
      };
      const contents:{x:number;y:number;z:number}[]=[];
      plan.counters.forEach(([x,z],i)=>{
        const side=x<plan.aisleX?-1:1, front=x-side*0.56;
        if(l.food){
          glassPieces.push(cube(front,l.y+0.76,z,0.025,0.38,4));
          detail.push(cube(x,l.y+0.58,z,1.06,0.025,3.96),cube(x+side*0.48,l.y+1.2,z,0.12,2.4,4));
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
        board(e.point[0],l.y+2.55,e.point[1],label,yaw,3.8,1.0);
        // Bronze double doorway; clear centre remains walkable in either direction.
        for(const side of [-1,1])frames.push(cube(e.point[0]+(front?side*1.85:0),l.y+1.35,e.point[1]+(front?0:side*1.85),front?0.08:0.16,2.7,front?0.16:0.08));
        // Glazed leaves stand open against the jambs, never across the walk line.
        for(const side of [-1,1])glassPieces.push(cube(e.point[0]+(front?side*1.8:-0.65),l.y+1.3,e.point[1]+(front?0.65:side*1.8),front?0.025:1.3,2.6,front?1.3:0.025));
      }
      // Non-emissive floor directory; underline marks this floor without a colour code.
      board(plan.aisleX-3,l.y+2.15,plan.stair.from-2,boards.length-1,0,4,0.65);
      frames.push(cube(plan.aisleX-3,l.y+1.93-l.index*0.06,plan.stair.from-1.99,3.8,0.018,0.018));
      if(l.index>0)for(const side of [-1,1])glassPieces.push(cube(plan.aisleX+side*2.13,l.y+0.55,(plan.stair.from+plan.stair.to)/2,0.025,1.1,plan.stair.to-plan.stair.from));
      if(detail.length){const g=mergeGeometries(detail);retain(g);detail.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,counterMat));}
      if(frames.length){const g=mergeGeometries(frames);retain(g);frames.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,bronze));}
      if(glassPieces.length){const g=mergeGeometries(glassPieces);retain(g);glassPieces.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,glassMat));}
      if(signs.length){const g=mergeGeometries(signs);retain(g);signs.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,boardMaterial));}
      const figures=instance(group,new THREE.CapsuleGeometry(0.5,1,3,6),standard("#59554f",0.8,0.2),Array.from({length:42},()=>({x:0,y:-100,z:0})));
      people.push({mesh:figures,floor:l.index});
      label+=l.floor.tenants.length+1;
    }
    for(const lower of levels.slice(0,-1)){
      const pair=flights.filter(f=>f.lower===lower.index);
      const group=new THREE.Group();flightGroups.push(group);root.add(group);
      const solids:T.BufferGeometry[]=[], glasses:T.BufferGeometry[]=[];
      for(const flight of pair)for(const p of flight.parts.filter(p=>!p.walkableOnly)){
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p.position,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(p.normal,3));
        const colors=p.colour.slice();if(["lampOk","lampNo","light"].includes(p.material)){const c=new THREE.Color("#ddc9a4");for(let i=0;i<colors.length;i+=3)colors.splice(i,3,c.r,c.g,c.b);}
        g.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));(p.material==="glass"?glasses:solids).push(g);
      }
      for(const flight of pair)for(let i=0;i<=30;i++){
        const t=i/30,g=cube(flight.a.x,THREE.MathUtils.lerp(flight.a.y,flight.b.y,t)+0.012,THREE.MathUtils.lerp(flight.a.z,flight.b.z,t),0.98,0.015,0.025);
        g.deleteAttribute("uv");const color=new THREE.Color("#c8ad52");g.setAttribute("color",new THREE.Float32BufferAttribute(Array.from({length:g.getAttribute("position").count},()=>[color.r,color.g,color.b]).flat(),3));solids.push(g);
      }
      const solid=mergeGeometries(solids),glassG=mergeGeometries(glasses);retain(solid);retain(glassG);solids.forEach(g=>g.dispose());glasses.forEach(g=>g.dispose());
      const steel=standard("#ffffff",0.4,0.3);steel.vertexColors=true;group.add(new THREE.Mesh(solid,steel),new THREE.Mesh(glassG,glassMat));
    }
    bridges.forEach((g,i)=>groups[levels.findIndex(l=>l.floor.level===plan.input.entrances[i]!.level)]!.add(new THREE.Mesh(g,basic("#bdb5a7"))));
    root.userData.depato={atlasPx:1024,boardContrast:10.625628349541163,floorRoughness:[0.3,0.24],clearHeights:levels.map(l=>l.clear),drawCallsPerFloor:groups.map((g,i)=>g.children.length+2*levels.slice(0,-1).filter(l=>l.index===i||l.index+1===i).length),font:'GTEki Sign JP',jaCapHeightM:0.15};
  };
  const unload=()=>{root.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());geometries=[];materials=[];textures=[];groups=[];landingGroups=[];flightGroups=[];people=[];loaded=false;};
  return {root,walkable,colliders,setAvatar(p:typeof avatar){avatar=p?{...p,y:p.y-0.4}:null;},
    update(camera:T.Camera,elapsed:number){
      const cameraP=camera.getWorldPosition(new THREE.Vector3()),p=avatar??{x:cameraP.x,y:cameraP.y-2,z:cameraP.z};
      const near=(plan.contains([p.x,p.z]) && p.y>=levels[0]!.y-1 && p.y<=levels.at(-1)!.y+levels.at(-1)!.clear) || plan.input.entrances.some(e=>Math.hypot(p.x-e.point[0],p.z-e.point[1],p.y-plan.height(e.level))<40);
      if(!near){if(loaded)unload();return;}
      if(!loaded){loaded=true;load();}
      let floor=0;for(const l of levels)if(l.y<=p.y+0.2)floor=l.index;
      groups.forEach((g,i)=>g.visible=i===floor);landingGroups.forEach(g=>g.visible=false);
      const riding=p.y>levels[floor]!.y+0.25 && floor+1<levels.length;
      if(riding)landingGroups[floor+1]!.visible=true;
      flightGroups.forEach((g,i)=>g.visible=i===floor || i+1===floor);
      for(const peopleOnFloor of people){
        if(peopleOnFloor.floor!==floor)continue;
        const mesh=peopleOnFloor.mesh,y=levels[floor]!.y,matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
        for(let person=0;person<6;person++){
          const staff=person>=4,x=staff?plan.counters[(person-4)*9]![0]+1:plan.aisleX+1.05;
          const z=staff?plan.counters[(person-4)*9]![1]:plan.bounds.front+15+person*4+Math.sin(elapsed*0.22+person)*2;
          const gait=staff?0:Math.sin(elapsed*3.5+person*1.7)*0.35;
          const parts:[[number,number,number],[number,number,number],number][]=[[[0,1.55,0],[0.14,0.14,0.14],0],[[0,1.05,0],[0.23,0.3,0.15],0],[[-0.11,0.45,0],[0.07,0.23,0.07],gait],[[0.11,0.45,0],[0.07,0.23,0.07],-gait],[[-0.27,1,0],[0.055,0.22,0.055],-gait],[[0.27,1,0],[0.055,0.22,0.055],gait],[[0,0.8,0],[0.2,0.08,0.13],0]];
          parts.forEach(([offset,scale,angle],i)=>{q.setFromAxisAngle(new THREE.Vector3(1,0,0),angle);matrix.compose(new THREE.Vector3(x+offset[0],y+offset[1],z+offset[2]),q,new THREE.Vector3(...scale));mesh.setMatrixAt(person*7+i,matrix);});
        }
        mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
      }
    },
    dispose(){unload();for(const g of physicalGeometry)g.dispose();for(const l of levels){l.floorG.dispose();l.ceilingG.dispose();l.wallG.dispose();}bridges.forEach(g=>g.dispose());collisionMaterial.dispose();},
  };
}
