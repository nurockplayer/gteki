// Issue #1433, row J6: replay the actual exit-1 walk, live stair cuts and shipped cat.
// Measurement protocol: gteki-visual, 2026-11-17 JST.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadShinjukuBundle } from '../../../../stations/shinjuku/data/bundle.ts';
import { assembleScene } from '../../../../stations/shinjuku/gteki/scene.ts';
import { installHeadlessDom, newShimUsage, headlessThree } from '../../../../packages/godot/src/headless-dom.ts';
import { createRouter, DEFAULT_PROFILE, routeBetween, routePolyline, describeRoute, nodeDisplayZ } from '@gteki/navigation';
import { Explorer } from '../../../../apps/web/src/explorer/explorer.ts';
import { loadGlbAvatar } from '../../../../apps/web/src/explorer/avatarGlb.ts';
import { buildGreybox } from '../../../../apps/web/src/explorer/greybox.ts';
import { greyboxSceneProbes } from '../../../../apps/web/src/explorer/greyboxScene.ts';
import { floorProbe } from '../../../../apps/web/src/explorer/routeGaps.ts';
import { buildLiveScene } from '../../../../apps/web/src/explorer/liveScene.ts';
import { cutPortals } from '../../../../apps/web/src/explorer/portalCut.ts';
import { explorerTargets, castAll, castCamera } from '../../../../apps/web/src/explorer/raycast.ts';
import { prepareRayTrees } from '../../../../apps/web/src/explorer/meshBvh.ts';
import { cumulativeLengths, wallToRenderer, samplePolyline } from '../../../../apps/web/src/explorer/walker.ts';
import { guidePaceSpans } from '../../../../apps/web/src/explorer/guidePace.ts';
import { NO_SLOPE } from '../../../../apps/web/src/explorer/followCamera.ts';
import { avatarMotion, CAT_TURN_RATE, stepCatBodyPitch } from '../../../../apps/web/src/explorer/avatarMotion.ts';

const R = (p: any) => new T.Vector3(p.x,p.z,-p.y);

it('keeps the exit-1 cat visible through descent, stops and restarts without camera snaps', async () => {
  const usage = newShimUsage(); installHeadlessDom(usage);
  const { bundle } = loadShinjukuBundle();
  const router = createRouter(bundle);
  const traversable = (e:any) => router.isTraversable(e, DEFAULT_PROFILE);
  const scene = assembleScene({THREE:headlessThree(usage),bundle,quality:'low'} as any);
  const original = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
  prepareRayTrees(original.camera);
  const walls = (scene.walls ?? []).map(wallToRenderer);
  const floor = floorProbe(new T.Raycaster(),original.ground,true);
  const cache = new Map();
  const hasFloor = (p:any) => { const k=[p.x,p.y,p.z].map(x=>Math.round(x*100)).join(','); if(!cache.has(k))cache.set(k,floor(p));return cache.get(k); };
  const grey = buildGreybox(bundle,traversable,hasFloor,greyboxSceneProbes(original.collider,walls),'low',false,[]);
  grey.root.updateMatrixWorld(true);
  const cuts:any={geometries:[],materials:[],portalMeshes:new Map(),originals:new Map(),clippedMeshes:[],instances:[]};
  cutPortals(scene.root,grey.openings,cuts,new Set(original.ground));
  const live = buildLiveScene({root:scene.root,bundle,traversable,hasFloor,greybox:grey,openings:grey.openings,originalTargets:original,walkable:scene.walkable,colliders:scene.colliders??[],cameraBlockers:scene.cameraBlockers??[],walls,tier:'low',recipe:null,portalInstances:cuts.instances});
  if(live.stairwellCut.finish)grey.root.add(live.stairwellCut.finish);
  const world = new T.Scene(); world.add(scene.root,grey.root,live.connectors.root); world.updateMatrixWorld(true);
  const targets = explorerTargets(live.walkable,live.colliders,live.cameraBlockers);
  prepareRayTrees(targets.camera);
  const catBytes=fs.readFileSync('apps/web/public/avatars/cat.glb');
  const gltf:any=await new Promise((ok,fail)=>new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(catBytes.buffer.slice(catBytes.byteOffset,catBytes.byteOffset+catBytes.byteLength),'',ok,fail));
  const avatarRig=await loadGlbAvatar('scratch',{quality:'low',cat:true,heightM:.345,loader:{loadAsync:async()=>gltf}});
  const exit=bundle.pois.find(p=>p.id==='poi:exit:1')!,dest=bundle.pois.find(p=>p.id==='poi:platform:oedo')!;
  const route:any=routeBetween(router,{kind:'poi',poi:exit},dest,DEFAULT_PROFILE);expect(route.ok).toBe(true);
  const nav=JSON.parse(fs.readFileSync('stations/shinjuku/navmesh-paths.json','utf8'));
  const edgePaths=new Map([...live.connectors.pathByEdge].map(([id,path])=>[id,path.map(p=>({x:p.x,y:-p.z,z:p.y}))]));
  const poly=routePolyline(bundle,route,edgePaths,nav.edges,nav.joins);
  expect(poly.length).toBeGreaterThan(1);
  const spans=guidePaceSpans(poly,route.steps,describeRoute(bundle,route));
  const pts=poly.map(R),cum=cumulativeLengths(pts);
  const node=bundle.nodes.find(n=>n.id==='n:a06f3d191885497bac197b666c4daef9')!;
  const pos=R({...node.position,z:nodeDisplayZ(node,bundle.floors.find(f=>f.id===node.floorId)).z});
  const initialGroundRay=new T.Raycaster(pos.clone().add(new T.Vector3(0,1.5,0)),new T.Vector3(0,-1,0),0,4);
  const initialGround=castAll(initialGroundRay,targets.ground)[0];expect(initialGround).toBeDefined();pos.y=initialGround.point.y;
  function stand(aspect:number,mode:string,next:boolean){
    const avatar=new T.Group();avatar.add(avatarRig.root);
    const e:any=Object.assign(Object.create(Explorer.prototype),{
      stationScene:scene,
      camera:new T.PerspectiveCamera(next?(aspect<1?65:55):50,aspect,.05,1000),pos:pos.clone(),yaw:-174*Math.PI/180,pitch:0,camDistance:next?2.25:2.4,
      mode,previewNext:next,firstPerson:false,catAvatar:true,reducedMotion:false,qaCamera:{},qaCameraSnap:false,
      slope:{...NO_SLOPE},slopeY:pos.y,descentDrop:0,walkStairAngle:0,stairsFraming:{progress:0,weight:0},stairsLens:false,
      escalatorProgress:0,escalatorWeight:0,escalatorAxis:new T.Vector3(0,0,-1),bodyRaiseHold:{seconds:0,target:0},
      boomActual:0,boomRaise:0,squeezed:false,openingState:'ended',openingRelease:null,arrivalState:'waiting',arrivalElapsed:0,arrivalDestination:null,
      cameraTargets:targets.camera,cameraSides:new Set(targets.camera),blockerTargets:targets.blockers,ray:new T.Raycaster(),
      walkable:live.walkable,groundTargets:targets.ground,colliders:live.colliders,colliderTargets:targets.collider,walls:live.walls,
      sceneColliderTargets:live.sceneColliderTargets,greyboxOpenings:grey.openings,portalExemptions:0,
      avatar,avatarRig,bodyYaw:-174*Math.PI/180,catBodyPitch:0,lastAvatarPos:pos.clone(),
      guide:mode==='guide'?{pts,cum,steps:poly.map(p=>p.stepIndex),s:0,paused:false,stops:[],holding:false,spans}:null,
      guideIdentityHoldS:0,guideSigns:[],tier:'run',events:{},
      input:{consumeLook:()=>({dx:0,dy:0,zoom:0}),move:()=>({x:0,y:mode==='walk'?1:0,run:false})},
      identityPlaced:true,frameInitialIdentity:()=>false,stopGuide(){this.guide=null;},setMode(m:any){this.mode=m;},
      publishInteraction:()=>{},interactionController:{update:()=>({})},
      applyAvatarFade:()=>{},setCameraFocus(p:any){this.measuredTarget=p?.clone();},
    });
    if(mode==='guide'){const p=samplePolyline(pts,cum,0);e.pos.set(p.x,p.y,p.z);e.yaw=Math.atan2(-p.tx,-p.tz);e.lastAvatarPos.copy(e.pos);e.bodyYaw=e.yaw;}
    e.moving = true;
    e.input.move = () => ({x:0,y:e.moving ? 1 : 0,run:false});
    e.avatar.position.copy(e.pos);e.avatar.rotation.y=e.bodyYaw;e.avatar.updateMatrixWorld(true);return e;
  }
  function tick(e:any){
    const before=e.pos.clone();if(e.mode==='guide')e.stepGuide(1/60);else e.stepWalk(1/60);
    e.placeCamera(1/60,false);
    const motion=avatarMotion(e.lastAvatarPos,e.pos,1/60,e.bodyYaw,e.yaw,CAT_TURN_RATE);e.bodyYaw=motion.yaw;e.lastAvatarPos.copy(e.pos);
    e.avatarRig.setLookPitch?.(e.pitch);e.avatarRig.update(1/60,motion.speed);e.avatar.position.copy(e.pos);e.avatar.rotation.y=e.bodyYaw;
    e.catBodyPitch=stepCatBodyPitch(e.catBodyPitch,e.slope.velocity,e.catRidingEscalator()?0:motion.speed,1/60);e.avatarRig.root.rotation.x=e.catBodyPitch;e.avatar.updateMatrixWorld(true);
    return e.pos.distanceTo(before);
  }

  const ray = new T.Raycaster();
  function measure(e: any) {
    e.camera.updateMatrixWorld(true);
    const box = e.catWorldBox();
    const projected: T.Vector3[] = [];
    let blocked = 0;
    for (const x of [0.1, 0.9]) for (const y of [0.1, 0.9]) for (const z of [0.1, 0.9]) {
      const point = new T.Vector3(T.MathUtils.lerp(box.min.x,box.max.x,x),T.MathUtils.lerp(box.min.y,box.max.y,y),T.MathUtils.lerp(box.min.z,box.max.z,z));
      ray.set(e.camera.position,point.clone().sub(e.camera.position).normalize());
      ray.far=e.camera.position.distanceTo(point)-0.05;
      if (castCamera(ray,e.cameraTargets,e.cameraSides).length) blocked++;
    }
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) projected.push(new T.Vector3(x,y,z).project(e.camera));
    const direction=e.camera.getWorldDirection(new T.Vector3());
    return {
      height:e.camera.position.y-e.pos.y, pitch:T.MathUtils.radToDeg(Math.asin(-direction.y)),
      top:(1-Math.max(...projected.map(p=>p.y)))/2, bottom:(1-Math.min(...projected.map(p=>p.y)))/2,
      left:(1+Math.min(...projected.map(p=>p.x)))/2, right:(1+Math.max(...projected.map(p=>p.x)))/2,
      blocked, boom:e.boomActual, relative:e.camera.position.clone().sub(e.pos),
    };
  }
  for (const [w,h] of [[960,600],[412,839]]) {
    for (const stops of [false,true]) {
      const e=stand(w/h,'walk',false);
      e.placeCamera(1/60,true);
      let previous=measure(e), maxMove=0, maxPitch=0, maxBoom=0;
      const poses: any[]=[];
      let cropped=0, maxFlightBoom=0;
      for (let walked=1;walked<=810;walked++) {
        tick(e);
        const current=measure(e);
        maxMove=Math.max(maxMove,current.relative.distanceTo(previous.relative));
        maxPitch=Math.max(maxPitch,Math.abs(current.pitch-previous.pitch));
        maxBoom=Math.max(maxBoom,Math.abs(current.boom-previous.boom));
        if(e.slope.velocity < -0.12) {
          maxFlightBoom=Math.max(maxFlightBoom,Math.abs(current.boom-previous.boom));
          if(current.top<0 || current.bottom>1 || current.left<0 || current.right>1) cropped++;
        }
        previous=current;
        if (stops && poses.length < 2 && e.pos.y <= [-3.73,-6.52][poses.length]!) {
          e.moving=false;
          for(let idle=0;idle<180;idle++) {
            tick(e);
            const current=measure(e);
            maxMove=Math.max(maxMove,current.relative.distanceTo(previous.relative));
            maxPitch=Math.max(maxPitch,Math.abs(current.pitch-previous.pitch));
            maxBoom=Math.max(maxBoom,Math.abs(current.boom-previous.boom));
            previous=current;
          }
          const {relative,...pose}=previous;
          poses.push({walked,z:e.pos.y,...pose});
          expect.soft(pose.top).toBeGreaterThanOrEqual(0);
          expect.soft(pose.bottom).toBeLessThanOrEqual(1);
          expect.soft(pose.left).toBeGreaterThanOrEqual(0);
          expect.soft(pose.right).toBeLessThanOrEqual(1);
          expect.soft(pose.blocked).toBe(0);
          e.moving=true;
        }
      }
      console.info('1433 metrics',JSON.stringify({viewport:`${w}x${h}`,stops,maxMove,maxPitch,maxBoom,maxFlightBoom,cropped,poses}));
      expect.soft(poses.length).toBe(stops ? 2 : 0);
      expect.soft(cropped).toBe(0);
      expect.soft(maxFlightBoom).toBeLessThanOrEqual(0.03);
      expect.soft(maxMove).toBeLessThanOrEqual(0.15);
      expect.soft(maxBoom).toBeLessThanOrEqual(0.15);
      expect.soft(maxPitch).toBeLessThanOrEqual(1);
    }
    // Record the accepted guide path to compare with main in the before/after replay.
    for(const next of [false,true]) {
      const e=stand(w/h,'guide',next);
      e.placeCamera(1/60,true);
      const frames=[];
      for(let frame=0;frame<1200;frame++) {
        tick(e);
        frames.push([...e.camera.position.toArray(),...e.camera.quaternion.toArray(),e.camera.fov,e.boomActual]);
      }
      const {createHash}=await import('node:crypto');
      console.info('1433 guide',JSON.stringify({viewport:`${w}x${h}`,next,sha256:createHash('sha256').update(JSON.stringify(frames)).digest('hex')}));
    }
  }
},300000);
