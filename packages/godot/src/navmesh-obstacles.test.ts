import { expect, it } from "vitest";
import * as THREE from "three";
import { ceilingAbove, corridorBlockers } from "./navmesh-obstacles.ts";

it("identifies a tagged pillar intersecting the walker corridor",()=>{
  const root=new THREE.Group(); root.name="kit-room";
  const pillar=new THREE.Mesh(new THREE.BoxGeometry(0.2,2,0.2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); pillar.name="pillar";pillar.position.set(0.2,1,0);root.add(pillar);root.updateMatrixWorld(true);
  const blockers=corridorBlockers({ground:[],collider:[pillar],walls:[]},new THREE.Vector3(0,0,0));
  expect(blockers[0]).toMatchObject({name:"pillar",source:"kit",facing:"wall-like"});
  pillar.geometry.dispose();
});

it("identifies a dipping upper floor slab by its upward face",()=>{
  const slab=new THREE.Mesh(new THREE.PlaneGeometry(4,4).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));slab.name="upper floor";slab.position.y=1.5;slab.updateMatrixWorld(true);
  const hit=ceilingAbove({ground:[slab],collider:[],walls:[]},new THREE.Vector3(0,0,0));
  expect(hit).toMatchObject({name:"upper floor",isUpperFloorSlab:true,height:1.5});slab.geometry.dispose();
});
