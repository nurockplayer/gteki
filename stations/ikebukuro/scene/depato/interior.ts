import type * as T from "three";
import type { SceneContext } from "@gteki/scene-api";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildEscalator } from "../../../../apps/web/src/explorer/greyboxConnectors.ts";
import { cutRegions, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import { buildCrowd, type Lane } from "../crowd.ts";
import type { DepatoLayout } from "./layout.ts";
import { LANDMARK_FACADE, LANDMARK_STREET_BAND, LANDMARK_SIGN } from "../landmark-style.ts";

/** AD 2026-11-22 JST: one neutral retail kit, baked pools, no scene lights. */
export function buildDepatoInterior(ctx: SceneContext, plan: DepatoLayout, envMap?: T.Texture) {
  const THREE = ctx.THREE, root = new THREE.Group(), connectorRoot = new THREE.Group(); root.name = `depato-interior:${plan.input.store.id}`;
  const phone = ctx.quality === "low";
  const fullStore = plan.input.lift !== undefined;
  const directoryX = plan.aisleX - 6;
  const directoryStops = [plan.stair.from - 2, plan.stair.to + 2];
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
    const rooftop=fullStore && floor.category==="rooftop";
    const wallHeight=rooftop?1.1:index+1<plan.floors.length?plan.height(plan.floors[index+1]!.level)-y:clear;
    const floorG=shape(y,index>0), ceilingMesh=new THREE.Mesh(shape(y+clear,index+1<plan.floors.length,true)), wallG=walls(floor.level,y,wallHeight);
    if(plan.input.store.id==="tobu-ikebukuro" && floor.level==="B1"){
      // The x18 station stairs cross Tobu's illustrative B1 ceiling.
      const left=-111, right=-90, front=-159.5, back=-148;
      const resources:PortalCutResources={geometries:[],materials:[],portalMeshes:new Map(),originals:new Map(),clippedMeshes:[],instances:[]};
      cutRegions(ceilingMesh,[{key:{},bounds:new THREE.Box3(new THREE.Vector3(left,y,front),new THREE.Vector3(right,y+clear+1,back)),clip:null,
        planes:[p=>p.x-left,p=>right-p.x,p=>p.z-front,p=>back-p.z],accepts:()=>true}],resources,new Set(),false);
      if(resources.geometries.length) resources.originals.get(ceilingMesh)!.geometry.dispose();
    }
    const ceilingG=ceilingMesh.geometry;
    physical(floorG.clone(),walkable);
    if(!rooftop)physical(ceilingG.clone(),colliders);
    physical(wallG.clone(),colliders);
    if(index>0){
      // The follow boom must clear the upper floor even while its endpoint is over the well.
      physical(cube(plan.stair.x,y+0.08,(plan.stair.from+plan.stair.to)/2,plan.stair.width,0.16,plan.stair.to-plan.stair.from),cameraBlockers);
      cameraBlockers.at(-1)!.userData.gtekiCameraTargetOnly=true;
    }
    if(index>0)for(const side of [-1,1])physical(cube(plan.aisleX+side*2.13,y+0.55,(plan.stair.from+plan.stair.to)/2,0.025,1.1,plan.stair.to-plan.stair.from),colliders);
    for(const [x,z] of plan.counters) physical(cube(x,y+0.48,z,1.1,0.96,4),colliders);
    if(fullStore)for(const z of directoryStops)physical(directoryStand(y,z),colliders);
    return {floor,index,y,food,clear,rooftop,floorG,ceilingG,wallG};
  });
  function directoryStand(y:number,z:number) {
    return cube(directoryX-0.17,y+0.925,z,0.32,1.85,4);
  }
  const flights=levels.slice(1).flatMap((upper,i)=>{
    const lower=levels[i]!, {x,from,to}=plan.stair;
    return [-1,1].map(side=>{
      const a=new THREE.Vector3(x+side*0.95,side<0?lower.y:upper.y,from);
      const b=new THREE.Vector3(x+side*0.95,side<0?upper.y:lower.y,to);
      const parts=buildEscalator(a,b,ctx.quality);
      for(const part of parts.filter(p=>p.role)) {
        const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(part.position,3)); g.computeVertexNormals();
        physical(g,part.role==="walkable"?walkable:colliders,part.walkableOnly===true);
        if(part.role==="walkable"){
          const mesh=walkable.at(-1)!; mesh.userData.gteki_role="escalator"; connectorRoot.add(mesh);
        }
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
  let groups:T.Group[]=[], shellGroups:T.Group[]=[], landingGroups:T.Group[]=[], flightGroups:T.Group[]=[], loaded=false;
  let avatar:{x:number;y:number;z:number}|null=null;
  let crowds:(ReturnType<typeof buildCrowd>|null)[]=[];
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
      const pool=Math.exp(-((x-32)**2+(z-32)**2)/170), value=0.70+0.30*pool;
      const at=(z*64+x)*4;pixels.set([255*value,252*value,246*value,255],at);
    }
    const pool=new THREE.DataTexture(pixels,64,64);pool.colorSpace=THREE.SRGBColorSpace;pool.wrapS=pool.wrapT=THREE.RepeatWrapping;pool.repeat.set(1/4.4,1/4.4);pool.offset.set(0.5,0.5);pool.needsUpdate=true;textures.push(pool);
    const counterMat=basic("#e6ddcd"), glassMat=glass(), bronze=standard(LANDMARK_FACADE.F4_darkBronze,0.5,0.12), glow=basic(LANDMARK_STREET_BAND.glow);
    glassMat.forceSinglePass=phone;
    counterMat.color.multiplyScalar(fullStore?0.65:0.9);
    const atlasPx=1024, signFont=(px:number)=>`600 ${px}px "GTEki Sign JP"`;
    const measure=typeof document==="undefined"?null:document.createElement("canvas").getContext("2d")!;
    const newPage=()=>{
      const canvas=typeof document==="undefined"?null:document.createElement("canvas");
      const material=basic("#ffffff");
      material.side=THREE.FrontSide;
      if(canvas){
        canvas.width=canvas.height=atlasPx;
        const texture=new THREE.CanvasTexture(canvas);
        texture.colorSpace=THREE.SRGBColorSpace;
        material.map=texture;textures.push(texture);
      }
      const paint=canvas?.getContext("2d");
      if(paint)paint.textAlign="center";
      return {material,paint,pieces:[] as T.BufferGeometry[],x:0,y:0,lineHeight:0};
    };
    const textWidth=(text:string,px:number)=>{
      if(!measure)return text.length*px;
      measure.font=signFont(px);
      return measure.measureText(text).width;
    };
    const wrap=(text:string,px:number,width:number)=>{
      const lines:string[]=[];
      let line="";
      for(const char of text){
        if(textWidth(line+char,px)>width){lines.push(line.trimEnd());line="";}
        line+=char;
      }
      if(line.trim())lines.push(line.trim());
      return lines;
    };
    const directoryPage=fullStore?newPage():null;
    let directoryHeight=48;
    if(directoryPage?.paint){
      const paint=directoryPage.paint,half=Math.ceil(levels.length/2);
      paint.fillStyle="#EFE9DD";paint.fillRect(0,0,atlasPx,atlasPx);
      paint.fillStyle=LANDMARK_SIGN.band;paint.textAlign="left";
      for(const [column,rows] of [levels.slice(0,half),levels.slice(half)].entries()){
        let y=24;
        for(const {floor} of rows){
          const left=column*512+12,gap=Math.max(0,floor.tenants.length-plan.counters.length);
          paint.font=signFont(18);paint.fillText(floor.level,left,y);
          const labels=[floor.label.ja+(gap?` / 未配置 ${gap} 件`:""),
            (floor.label.en===floor.label.ja?"":floor.label.en)+(gap?` / ${gap} listings without bays`:"")];
          for(const [language,label] of labels.entries()){
            const px=language===0?17:13;
            paint.font=signFont(px);
            for(const line of wrap(label,px,440)){paint.fillText(line,left+48,y);y+=19;}
          }
          y+=6;
        }
        directoryHeight=Math.max(directoryHeight,y);
      }
      if(directoryHeight>atlasPx)throw new Error(`Department-store directory exceeds 1024px: ${plan.input.store.id}`);
    }
    const instance=(group:T.Group,g:T.BufferGeometry,m:T.Material,positions:{x:number;y:number;z:number}[])=>{
      retain(g);const mesh=new THREE.InstancedMesh(g,m,positions.length),matrix=new THREE.Matrix4();
      positions.forEach(({x,y,z},i)=>mesh.setMatrixAt(i,matrix.makeTranslation(x,y,z)));mesh.computeBoundingSphere();group.add(mesh);return mesh;
    };
    const matteNormal=new THREE.MeshNormalMaterial({side:THREE.DoubleSide,blending:THREE.NoBlending,transparent:true,opacity:0});
    matteNormal.allowOverride=false;
    materials.push(matteNormal);
    const matte=(mesh:T.Mesh)=>{depthTwins.push({mesh,twin:matteNormal,original:mesh.material as T.Material});return mesh;};
    for(const l of levels){
      const group=new THREE.Group(), landing=new THREE.Group();groups.push(group);landingGroups.push(landing);root.add(group,landing);
      const fm=basic("#d6cfc2");
      if(fullStore){
        fm.lightMap=pool;fm.lightMapIntensity=3.3;
      }else{
        fm.map=pool;
        const floorPositions=l.floorG.getAttribute("position");
        l.floorG.setAttribute("uv",new THREE.Float32BufferAttribute(Array.from({length:floorPositions.count},(_,i)=>[floorPositions.getX(i),floorPositions.getZ(i)]).flat(),2));
      }
      const shell=l.rooftop?[l.wallG.clone()]:[l.ceilingG.clone(),l.wallG.clone()];
      shell.forEach((g,i)=>{
        const positions=g.getAttribute("position"), normals=g.getAttribute("normal"), colors:number[]=[];
        for(let v=0;v<positions.count;v++){
          // Keep the concourse-facing portal wall at its original station value.
          const stationSide=i===1 && positions.getZ(v)<plan.bounds.front && normals.getZ(v)<-0.9;
          const c=new THREE.Color(i===0&&!l.rooftop?"#fff2dc":stationSide?"#9daaa7":fullStore?"#9e8c72":"#776c60");colors.push(c.r,c.g,c.b);
        }
        g.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
      });
      // Finish the slab's well reveals between the lower ceiling and upper floor.
      if(l.index+1<levels.length){
        const top=levels[l.index+1]!.y,bottom=l.y+l.clear,h=top-bottom,{x,from,to,width}=plan.stair;
        const reveals=[...[-1,1].map(side=>cube(x+side*(width/2+0.04),(top+bottom)/2,(from+to)/2,0.08,h,to-from)),
          ...[from-0.04,to+0.04].map(z=>cube(x,(top+bottom)/2,z,width+0.16,h,0.08))];
        for(const g of reveals){const c=new THREE.Color("#c1b9aa");g.setAttribute("color",new THREE.Float32BufferAttribute(Array.from({length:g.getAttribute("position").count},()=>[c.r,c.g,c.b]).flat(),3));shell.push(g);}
      }
      const shellG=retain(mergeGeometries(shell));shell.forEach(g=>g.dispose());const shellMat=basic("#ffffff");shellMat.vertexColors=true;
      shellMat.fog=false; // The station's 90 m fog must not turn the aisle end walls black.
      // Both store shells remain visible through the well and behind the landing camera.
      const floorMesh=matte(new THREE.Mesh(l.floorG,fm)),shellMesh=new THREE.Mesh(shellG,shellMat);
      floorMesh.name=`retail-floor-${l.floor.level}`;shellMesh.name=`retail-shell-${l.floor.level}`;
      const shellGroup=new THREE.Group();shellGroups.push(shellGroup);shellGroup.add(floorMesh,shellMesh);root.add(shellGroup);
      const pad=cube(plan.aisleX,l.y-0.035,plan.stair.to+1,5,0.07,2);retain(pad);landing.add(matte(new THREE.Mesh(pad,fm)));
      const discs:{x:number;y:number;z:number}[]=[];
      for(let z=Math.ceil(plan.bounds.front/4.4)*4.4;z<plan.bounds.back;z+=4.4)for(let x=Math.ceil(plan.bounds.left/4.4)*4.4;x<plan.bounds.right;x+=4.4){
        if(plan.contains([x,z]) && !(Math.abs(x-plan.stair.x)<2.3 && z>plan.stair.from && z<plan.stair.to))discs.push({x,y:l.y+l.clear-0.025,z});
      }
      if(!l.rooftop){
        const downlight=phone?new THREE.CircleGeometry(0.12,8).rotateX(Math.PI/2):new THREE.CylinderGeometry(0.12,0.12,0.025,8);
        instance(group,downlight,glow,discs);
      }
      const counters=plan.counters.map(([x,z])=>({x,z,side:x<plan.aisleX?-1:1}));
      instance(group,new THREE.BoxGeometry(1.1,l.food?0.58:0.95,4),counterMat,counters.map(({x,z})=>({x,z,y:l.y+(l.food?0.29:0.475)})));
      if(l.rooftop){
        instance(group,new THREE.BoxGeometry(1.08,0.12,3.98),basic("#587449"),counters.map(({x,z})=>({x,z,y:l.y+0.99})));
      }else{
        instance(group,new THREE.BoxGeometry(l.food?0.12:0.04,l.food?2.4:0.55,l.food?4:2.8),counterMat,
          counters.map(({x,z,side})=>({x:x+side*(l.food?0.48:0.3),z,y:l.y+(l.food?1.2:1.25)})));
      }
      const frames:T.BufferGeometry[]=[], glassPieces:T.BufferGeometry[]=[], bays:T.BufferGeometry[]=[], lit:T.BufferGeometry[]=[];
      // Repeated shallow bays and a warm cove frame the main aisle without runtime lights.
      if(!plan.input.entrances.some(e=>e.inward)) {
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
      }
      const pages:ReturnType<typeof newPage>[]=[];
      const sections=new Map<number,ReturnType<typeof newPage>>();
      const slot=(section:number,width:number,height:number)=>{
        let page=sections.get(section);
        if(page && page.x+width>atlasPx){page.x=0;page.y+=page.lineHeight;page.lineHeight=0;}
        if(!page || page.y+height>atlasPx){
          page=newPage();pages.push(page);sections.set(section,page);
        }
        const x=page.x,y=page.y;
        page.x+=width;page.lineHeight=Math.max(page.lineHeight,height);
        return {page,x,y,width,height};
      };
      const quad=(s:ReturnType<typeof slot>,x:number,y:number,z:number,yaw:number,width:number,height:number,text=true)=>{
        const g=new THREE.PlaneGeometry(width,height).toNonIndexed(),uv=g.getAttribute("uv");
        for(let i=0;i<uv.count;i++){
          uv.setX(i,(s.x+(text?1+uv.getX(i)*(s.width-2):1))/atlasPx);
          uv.setY(i,1-(s.y+(text?1+(1-uv.getY(i))*(s.height-2):1))/atlasPx);
        }
        g.rotateY(yaw);g.translate(x,y,z);s.page.pieces.push(g);
      };
      const storeName={
        ja:fullStore&&l.floor.level!=="1F"?`${l.floor.level}  ${l.floor.label.ja}`:`${plan.input.store.name.ja} ${l.floor.level}`,
        en:fullStore&&l.floor.label.en===l.floor.label.ja?"":l.floor.label.en,
      };
      const gap=Math.max(0,l.floor.tenants.length-counters.length);
      const wayfinding=(name:typeof storeName,header:boolean)=>{
        const ja=fullStore?18:36,en=ja*LANDMARK_SIGN.enScale,padding=12,height=fullStore?36:80;
        const s=slot(-1,Math.min(atlasPx,Math.ceil(Math.max(textWidth(name.ja,ja),textWidth(name.en,en)))+padding),height);
        const paint=s.page.paint;
        if(paint){
          paint.fillStyle=header?LANDMARK_SIGN.band:"#EFE9DD";paint.fillRect(s.x,s.y,s.width,s.height);
          paint.fillStyle=header?LANDMARK_SIGN.letters:LANDMARK_SIGN.band;
          paint.font=signFont(ja);paint.fillText(name.ja,s.x+s.width/2,s.y+height/2,s.width-padding);
          paint.font=signFont(en);paint.fillText(name.en,s.x+s.width/2,s.y+height*0.825,s.width-padding);
        }
        return s;
      };
      const headerSlot=wayfinding(storeName,true);
      const directorySlots=fullStore?[]:plan.floors.map(f=>{
        const unplaced=f.level===l.floor.level?gap:0;
        return wayfinding({
          ja:`${f.level} ${f.label.ja}`+(unplaced?` / 未配置 ${unplaced} 件`:""),
          en:`${f.level} ${f.label.en}`+(unplaced?` / ${unplaced} listings without bays`:""),
        },false);
      });
      const directorySlot=directoryPage?{page:{...directoryPage,pieces:[] as T.BufferGeometry[]},x:0,y:0,width:atlasPx,height:directoryHeight}:null;
      if(directorySlot)pages.push(directorySlot.page);
      const board=(x:number,y:number,z:number,s:typeof headerSlot,yaw=0,width=3.8,height=0.6)=>{
        // The B1 approach sees PARCO's header at a steep angle from the guide.
        const large=s===headerSlot&&plan.input.store.id==="ikebukuro-parco"&&l.floor.level==="B1";
        const labelHeight=height*(large?0.9:0.6);
        const labelWidth=s.width/s.height*labelHeight, scale=Math.min(1,(width-0.1)/labelWidth);
        for(const face of [0,1,-1]){
          const text=face!==0;
          quad(s,x+Math.sin(yaw)*face*0.002,y,z+Math.cos(yaw)*face*0.002,yaw+(face<0?Math.PI:0),
            text?labelWidth*scale:width,text?labelHeight*scale:height,text);
        }
      };
      const placed=l.rooftop?0:Math.min(l.floor.tenants.length,counters.length);
      for(let i=0;i<placed;i++){
        const name=l.floor.tenants[i]!,{x,z,side}=counters[Math.floor(i*counters.length/placed)]!;
        const pxPerMetre=192,maxWidth=224,padding=16,ja=32,en=ja*LANDMARK_SIGN.enScale;
        const lines=[
          ...wrap(name.ja,ja,maxWidth-padding).map(text=>({text,px:ja,step:36})),
          ...wrap(name.en===name.ja?"":name.en,en,maxWidth-padding).map(text=>({text,px:en,step:20})),
        ];
        const width=Math.ceil(Math.max(...lines.map(line=>textWidth(line.text,line.px))))+padding;
        const height=lines.reduce((h,line)=>h+line.step,padding);
        // Keep the bays and their signs together along three counter rows of an aisle.
        const s=slot(Math.floor((z-plan.bounds.front)/21),width,height);
        const paint=s.page.paint;
        if(paint){
          paint.fillStyle="#EFE9DD";paint.fillRect(s.x,s.y,s.width,s.height);
          paint.fillStyle=LANDMARK_SIGN.band;paint.textBaseline="middle";
          let top=s.y+padding/2;
          for(const line of lines){
            paint.font=signFont(line.px);paint.fillText(line.text,s.x+width/2,top+line.step/2);
            top+=line.step;
          }
        }
        const front=x-side*0.58,yaw=-side*Math.PI/2;
        quad(s,front,l.y+1.95,z,yaw,width/pxPerMetre,height/pxPerMetre);
        quad(s,front+side*0.004,l.y+1.95,z,yaw+Math.PI,width/pxPerMetre,height/pxPerMetre);
      }
      const contents:{x:number;y:number;z:number}[]=[];
      if(l.food)for(const {x,z,side} of counters){
        const front=x-side*0.56;
        lit.push(cube(x,l.y+0.58,z,1.06,0.025,3.96));
        if(!phone){
          glassPieces.push(cube(front,l.y+0.76,z,0.025,0.38,4));
          lit.push(cube(x+side*0.43,l.y+0.76,z,0.025,0.34,3.96),cube(front,l.y+0.95,z,0.06,0.035,3.96));
          const rows=fullStore?3:10,spacing=fullStore?1.65:0.37;
          for(let j=0;j<rows;j++)for(let k=0;k<2;k++)contents.push({x:x-0.3+k*0.32,y:l.y+0.68,z:z-1.7+j*spacing});
        }else{
          for(let j=-1;j<=1;j++)contents.push({x,y:l.y+0.64,z:z+j*1.15});
        }
      }
      if(contents.length){
        const food=phone?new THREE.BoxGeometry(0.48,0.10,0.72):new THREE.CapsuleGeometry(0.065,0.06,3,5).scale(1,0.7,1.4);
        const foodMesh=instance(group,food,glow,contents);
        const tones=["#d8c8a3","#b99b74","#8e745e","#9caa88"];
        contents.forEach((_,i)=>foodMesh.setColorAt(i,new THREE.Color(tones[i%4])));
      }
      for(const e of plan.input.entrances.filter(e=>e.level===l.floor.level)){
        if(e.inward){
          const [nx,nz]=e.inward,yaw=Math.atan2(nx,nz),tx=nz,tz=-nx;
          board(e.point[0],l.y+2.45,e.point[1],headerSlot,yaw,3.8,0.6);
          frames.push(cube(e.point[0],l.y+2.76,e.point[1],4,0.12,0.3,yaw));
          for(const side of [-1,1]){
            frames.push(cube(e.point[0]+tx*side*1.85,l.y+1.35,e.point[1]+tz*side*1.85,0.08,2.7,0.3,yaw));
            glassPieces.push(cube(e.point[0]+nx*0.65+tx*side*1.8,l.y+1.3,e.point[1]+nz*0.65+tz*side*1.8,0.025,2.6,1.3,yaw));
          }
          continue;
        }
        const front=e.point[1]===plan.bounds.front,yaw=front?0:Math.PI/2;
        board(e.point[0],l.y+2.45,e.point[1],headerSlot,yaw,3.8,0.6);
        // Identical bronze lintel/reveals on every entrance, inside and outside.
        frames.push(cube(e.point[0],l.y+2.76,e.point[1],front?4:0.3,0.12,front?0.3:4));
        // Bronze double doorway; clear centre remains walkable in either direction.
        for(const side of [-1,1])frames.push(cube(e.point[0]+(front?side*1.85:0),l.y+1.35,e.point[1]+(front?0:side*1.85),front?0.08:0.3,2.7,front?0.3:0.08));
        // Glazed leaves stand open against the jambs, never across the walk line.
        for(const side of [-1,1])glassPieces.push(cube(e.point[0]+(front?side*1.8:-0.65),l.y+1.3,e.point[1]+(front?0.65:side*1.8),front?0.025:1.3,2.6,front?1.3:0.025));
      }
      // Non-emissive floor directory; underline marks this floor without a colour code.
      for(const [i,z] of directoryStops.entries()){
        if(fullStore){
          board(directoryX,l.y+1.05,z,directorySlot!,Math.PI/2,3.9,1.55);
          frames.push(directoryStand(l.y,z));
        }else{
          const yaw=i===0?0:Math.PI, x=plan.aisleX-3,rowHeight=Math.min(1,2/plan.floors.length);
          plan.floors.forEach((_,row)=>board(x,l.y+2.3-row*rowHeight,z,directorySlots[row]!,yaw,3.8,0.95*rowHeight));
          const bottom=2.3-(plan.floors.length-1)*rowHeight-0.475*rowHeight;
          for(const side of [-1,1])frames.push(cube(x+side*1.8,l.y+bottom/2,z,0.055,bottom,0.08));
          frames.push(cube(x,l.y+2.3-(l.index+0.25)*rowHeight,z+0.01,3.6,0.025,0.025));
        }
      }
      // Keep Seibu's B2 arrival sign below the HUD in the follow-camera view.
      const seibuB2=plan.input.store.id==="seibu-ikebukuro" && l.floor.level==="B2";
      board(plan.aisleX,l.y+l.clear-(seibuB2?0.83:0.48),plan.stair.to+(seibuB2?6:5),headerSlot,0,3.4,0.45);
      if(l.index>0)for(const side of [-1,1])glassPieces.push(cube(plan.aisleX+side*2.13,l.y+0.55,(plan.stair.from+plan.stair.to)/2,0.025,1.1,plan.stair.to-plan.stair.from));
      if(bays.length){const g=retain(mergeGeometries(bays));bays.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,basic("#e5d9c4")));}
      if(lit.length){const g=retain(mergeGeometries(lit));lit.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,glow));}
      let crowd:ReturnType<typeof buildCrowd>|null=null;
      if(!phone){
        // Station whole-body people use short, narrow counter-side paths, away from circulation.
        const lanes:Record<string,Lane>={};
        const paths=counters.filter(({x})=>Math.abs(x-plan.aisleX)>6).map(({x,z,side},i)=>{
          const id=`retail-${i}`,px=x+side*1.3;
          lanes[id]={stepM:3,left:[0.2],right:[0.2]};
          return {id,from:`${id}-a`,to:`${id}-b`,verification:"verified",geometry:[{x:px,y:-z+1.3,z:l.y},{x:px,y:-z-1.3,z:l.y}]};
        }).filter(p=>p.geometry.every(p=>plan.contains([p.x,-p.y])));
        crowd=buildCrowd(THREE,paths,(x,y,z)=>new THREE.Vector3(x,z,-y),8,envMap!,lanes);
        group.add(crowd.group);
      }
      crowds.push(crowd);
      if(frames.length){const g=mergeGeometries(frames);retain(g);frames.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,bronze));}
      if(glassPieces.length){const g=mergeGeometries(glassPieces);retain(g);glassPieces.forEach(g=>g.dispose());group.add(new THREE.Mesh(g,glassMat));}
      for(const page of pages){
        const g=retain(mergeGeometries(page.pieces));page.pieces.forEach(g=>g.dispose());
        const mesh=new THREE.Mesh(g,page.material);mesh.name=`retail-signs-${l.floor.level}`;group.add(mesh);
      }
    }
    for(const lower of levels.slice(0,-1)){
      const pair=flights.filter(f=>f.lower===lower.index);
      const group=new THREE.Group();flightGroups.push(group);root.add(group);
      const solids:T.BufferGeometry[]=[], glasses:T.BufferGeometry[]=[];
      for(const flight of pair)for(const p of flight.parts.filter(p=>!p.walkableOnly&&!p.soffit)){
        const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p.position,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(p.normal,3));
        const finish={tread:"#30383c",riser:"#30383c",nosing:"#f2c94c",escStep:"#30383c",rubber:fullStore?"#283136":"#2d3032",escTruss:fullStore?"#b49e7e":"#a6b2b5",steel:"#889fa4",glass:"#b4ccd1",light:"#ffe0a1",lampOk:"#89a37b",lampNo:"#b27565"}[p.material];
        const c=new THREE.Color(finish),colors=Array.from({length:p.position.length/3},()=>[c.r,c.g,c.b]).flat();
        g.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));(p.material==="glass"?glasses:solids).push(g);
      }
      // Closely spaced steel panel joints finish the underside, rather than isolated light rectangles.
      for(const flight of pair){
        const dz=flight.b.z-flight.a.z,dy=flight.b.y-flight.a.y,angle=Math.atan2(dy,dz),length=Math.hypot(dz,dy);
        for(let d=0.6;d<length;d+=0.9){
          const g=new THREE.BoxGeometry(1.5,0.018,0.025).toNonIndexed();g.rotateX(-angle);
          g.translate(flight.a.x,flight.a.y+Math.sin(angle)*d-1.15*Math.cos(angle)**2,flight.a.z+Math.cos(angle)*d+1.15*Math.cos(angle)*Math.sin(angle));
          g.deleteAttribute("uv");const c=new THREE.Color("#72878b");g.setAttribute("color",new THREE.Float32BufferAttribute(Array.from({length:g.getAttribute("position").count},()=>[c.r,c.g,c.b]).flat(),3));solids.push(g);
        }
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
    root.userData.depato={atlasPx,boardContrast:10.625628349541163,floorRoughness:[0.85,0.85],clearHeights:levels.map(l=>l.clear),drawCallsPerFloor:groups.map((g,i)=>g.children.length+2*levels.slice(0,-1).filter(l=>l.index===i||l.index+1===i).length),font:'GTEki Sign JP',jaCapHeightM:0.15,
      capacity:levels.map(({floor})=>({level:floor.level,listings:floor.tenants.length,bays:plan.counters.length,gap:Math.max(0,floor.tenants.length-plan.counters.length)}))};
  };
  const unload=()=>{depthTwins.length=0;crowds.forEach(c=>c?.dispose());crowds=[];root.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());geometries=[];materials=[];textures=[];groups=[];shellGroups=[];landingGroups=[];flightGroups=[];loaded=false;};
  return {root,connectorRoot,walkable,colliders,cameraBlockers,setAvatar(p:typeof avatar){avatar=p;},
    update(camera:T.Camera,dt=0,elapsed=0,active=true){
      if(!active){if(loaded)unload();return;}
      const cameraP=camera.getWorldPosition(new THREE.Vector3()),p=avatar??{x:cameraP.x,y:cameraP.y-2,z:cameraP.z};
      const near=(plan.contains([p.x,p.z]) && p.y>=levels[0]!.y-1 && p.y<=levels.at(-1)!.y+levels.at(-1)!.clear) || plan.input.entrances.some(e=>Math.hypot(p.x-e.point[0],p.z-e.point[1],p.y-plan.height(e.level))<40);
      if(!near){if(loaded)unload();return;}
      if(!loaded){loaded=true;load();}
      let floor=0;for(const l of levels)if(l.y<=p.y+0.2)floor=l.index;
      groups.forEach((g,i)=>{g.visible=i===floor;if(g.visible)crowds[i]?.update(dt,elapsed);});landingGroups.forEach(g=>g.visible=false);
      if(fullStore)shellGroups.forEach((g,i)=>{g.visible=Math.abs(i-floor)<=1;});
      const riding=p.y>levels[floor]!.y+0.25 && floor+1<levels.length;
      if(riding)landingGroups[floor+1]!.visible=true;
      flightGroups.forEach((g,i)=>g.visible=i===floor || i+1===floor);
    },
    dispose(){unload();for(const g of physicalGeometry)g.dispose();for(const l of levels){l.floorG.dispose();l.ceilingG.dispose();l.wallG.dispose();}bridges.forEach(g=>g.dispose());collisionMaterial.dispose();},
  };
}
