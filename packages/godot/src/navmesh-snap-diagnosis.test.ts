import { expect, it } from "vitest";
import * as THREE from "three";
import type { NavMeshQuery } from "recast-navigation";
import { diagnoseVerticalSnap, planFallbackRoute, verticalLinkCandidates } from "./navmesh-links.ts";

it("classifies missing polygons, wrong heights, missing floor and wall crossings", () => {
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); floor.updateMatrixWorld(true);
  const ground={ground:[floor],collider:[],walls:[]}, node={x:-0.5,y:0,z:0};
  const query=(point:{x:number;y:number;z:number}, polyRef=1) => ({findClosestPoint:()=>({success:true,status:0,polyRef,point,isPointOverPoly:true})}) as unknown as Pick<NavMeshQuery,"findClosestPoint">;
  expect(diagnoseVerticalSnap(query(node,0),ground,node).reason).toBe("no_poly");
  expect(diagnoseVerticalSnap(query({...node,y:2}),ground,node).reason).toBe("height");
  expect(diagnoseVerticalSnap(query(node),{ground:[],collider:[],walls:[]},node).reason).toBe("floor");
  expect(diagnoseVerticalSnap(query(node),{ground:[],collider:[],walls:[]},node).floorRule).toBe("snap_no_floor");
  floor.userData.greybox=true;
  expect(diagnoseVerticalSnap(query({...node,y:2}),ground,node).greyboxFloorAtNode).toBe(true);
  floor.userData.greybox=false;
  const wall={...ground,walls:[{a:{x:0,y:-2},b:{x:0,y:2},zMin:0,zMax:2}]};
  expect(diagnoseVerticalSnap(query({x:0.5,y:0,z:0}),wall,node).reason).toBe("wall");
  expect(diagnoseVerticalSnap(query(node,0),ground,node).walkableWithin3m).toBe(true);
  floor.geometry.dispose(); floor.material.dispose();
});

it("reports the floor source and missing support along the approach", () => {
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1,2).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); floor.position.x=1.5; floor.updateMatrixWorld(true);
  const query={findClosestPoint:()=>({success:true,status:0,polyRef:1,point:{x:1.5,y:0,z:0},isPointOverPoly:true})} as unknown as Pick<NavMeshQuery,"findClosestPoint">;
  const result=diagnoseVerticalSnap(query,{ground:[floor],collider:[],walls:[]},{x:0,y:0,z:0});
  expect(result.reason).toBe("floor"); expect(result.floorSource).toBe("scene"); expect(result.floorRule).toBe("approach_no_floor");
  floor.userData.greybox=true;
  expect(diagnoseVerticalSnap(query,{ground:[floor],collider:[],walls:[]},{x:0,y:0,z:0}).floorSource).toBe("greybox");
  floor.geometry.dispose(); floor.material.dispose();
});

it("can replace a missing endpoint with a neighbour snap for a combined connector", () => {
  const points={a:{x:0,y:0,z:0},b:{x:0,y:3,z:0},neighbor:{x:1,y:0,z:0}};
  const query={findClosestPoint:(p:typeof points.a)=>({success:true,status:0,polyRef:p===points.a ? 0 : 1,point:p,isPointOverPoly:true})} as unknown as Pick<NavMeshQuery,"findClosestPoint">;
  const edges=[{id:"stair",mode:"stairs",from:"a",to:"b",direction:"both" as const}];
  const absent=verticalLinkCandidates(edges,id=>points[id as keyof typeof points],query,()=>true);
  expect(absent.candidates).toHaveLength(0);
  const recovered=verticalLinkCandidates(edges,id=>points[id as keyof typeof points],query,()=>true,(id)=>id==="a" ? {point:points.neighbor,neighborId:"neighbor",edgeId:"walk"} : null);
  expect(recovered.candidates[0]?.fallback?.from?.edgeId).toBe("walk");
  expect(recovered.candidates[0]?.connection.startPosition).toEqual(points.neighbor);
  const links=new Map([["stair",{fallback:{from:{neighborId:"neighbor",edgeId:"walk"}}}]]);
  const walk={edgeId:"walk",fromNodeId:"neighbor",toNodeId:"a",reversed:false}, stair={edgeId:"stair",fromNodeId:"a",toNodeId:"b",reversed:false};
  expect([...planFallbackRoute([walk,stair],links)!]).toEqual([0]);
  expect(planFallbackRoute([stair],links)).toBeNull();
  const reverseStair={...stair,fromNodeId:"b",toNodeId:"a",reversed:true}, reverseWalk={...walk,fromNodeId:"a",toNodeId:"neighbor",reversed:true};
  expect([...planFallbackRoute([reverseStair,reverseWalk],links)!]).toEqual([1]);
});
