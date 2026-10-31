import { expect, it } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { auditPolyline } from "./route-clip-audit.ts";

it("bakes the live scene: the probe holds the stairwell cut and the connectors (#676)", () => {
  const bundle = createSyntheticBundle([
    syntheticEdge("stair", "start", "upper", { mode: "stairs", geometry: [{ x: 0, y: 0, z: null }, { x: 5, y: 0, z: null }, { x: 10, y: 0, z: null }] }),
    syntheticEdge("upper-walk", "upper", "upper-2"),
  ]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  // The slab the flight passes under: the stairwell cut opens it and rails the upper floor.
  const upper = new THREE.Mesh(new THREE.PlaneGeometry(14, 4).rotateX(-Math.PI / 2).translate(8, 4, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const root = new THREE.Group().add(floor, upper); root.updateMatrixWorld(true);
  const scene = { root, walkable: [floor, upper], colliders: [], cameraBlockers: [], walls: [] } as never;
  const made = makeGreybox(bundle, scene, false);
  expect(made.stairwellCut.stats.wells).toBe(1);
  // The navigable probe is the live scene: the cut's rail colliders and the connector floor are in it.
  expect(made.stairwellCut.colliders.length).toBeGreaterThan(0);
  for (const collider of made.stairwellCut.colliders) expect(made.probe.collider).toContain(collider);
  expect(made.connectors.walkable.length).toBeGreaterThan(0);
  for (const walkable of made.connectors.walkable) expect(made.probe.ground).toContain(walkable);
  // buildLiveScene returns the lists the bake appends; the probe adds only its nav-floor mesh.
  // Greybox colliders reach the probe but not the bake targets: navmesh-bake appends them with its nav-floor skip.
  expect(made.probe.collider.slice(0, made.targets.collider.length)).toEqual(made.targets.collider);
  expect(made.probe.collider.slice(made.targets.collider.length)).toEqual(made.grey.colliders);
  expect(made.probe.ground.slice(0, -1)).toEqual(made.targets.ground);
});

it("audits the generated portal as open while leaving the surrounding collider solid", () => {
  const bundle = createSyntheticBundle([syntheticEdge("e","start","a")]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10,10).rotateX(-Math.PI/2).translate(-1,0,0),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.05,2.5,10),new THREE.MeshBasicMaterial()); wall.position.set(4,1.25,0);
  const root = new THREE.Group().add(floor,wall); root.updateMatrixWorld(true);
  const scene = {root,walkable:[floor],colliders:[wall],walls:[]} as never;
  const made = makeGreybox(bundle,scene,false);
  expect(made.grey.stats.runs).toBeGreaterThan(0);
  expect(made.grey.openings.length).toBeGreaterThan(0);
  const point = (x:number,y:number) => ({x,y,z:0,zKnown:true,stepIndex:0,floorId:"concourse"});
  expect(auditPolyline(made.probe,[point(3.5,0),point(4.5,0)]).wallHits).toBe(0);
  expect(auditPolyline(made.probe,[point(3.5,3),point(4.5,3)]).wallHits).toBeGreaterThan(0);
});

it("does not treat a greybox ceiling as floor", () => {
  const bundle = createSyntheticBundle([syntheticEdge("e","start","a")]);
  const root = new THREE.Group(); root.updateMatrixWorld(true);
  const made = makeGreybox(bundle,{root,walkable:[],colliders:[],walls:[]} as never,false);
  const details: import("./route-clip-audit.ts").SampleDetail[] = [];
  const p = {x:5,y:0,z:2.6,zKnown:true,stepIndex:0,floorId:"concourse"};
  auditPolyline(made.probe,[p],{detail:details});
  expect(details[0]!.floorZ).toBeCloseTo(0);
  expect(details[0]!.floor).toBe("off");
});

it("opens both portal colliders, matching the explorer rule", () => {
  const bundle = createSyntheticBundle([syntheticEdge("e","start","a")]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10,10).rotateX(-Math.PI/2).translate(-1,0,0),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const wall1 = new THREE.Mesh(new THREE.BoxGeometry(0.05,2.5,10),new THREE.MeshBasicMaterial()); wall1.position.set(4,1.25,0);
  const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.05,2.5,10),new THREE.MeshBasicMaterial()); wall2.position.set(4.1,1.25,0);
  const root = new THREE.Group().add(floor,wall1,wall2); root.updateMatrixWorld(true);
  const made = makeGreybox(bundle,{root,walkable:[floor],colliders:[wall1,wall2],walls:[]} as never,false);
  expect(made.grey.openings.length).toBeGreaterThan(0);
  const point = (x:number) => ({x,y:0,z:0,zKnown:true,stepIndex:0,floorId:"concourse"});
  expect(auditPolyline(made.probe,[point(3.5),point(4.5)]).wallHits).toBe(0);
});
