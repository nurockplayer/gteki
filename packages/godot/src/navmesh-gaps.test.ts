import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { gapClass, dataWidth, diagnoseGaps } from "./navmesh-gaps.ts";
import { auditFallbackSegments, fallbackGate } from "./navmesh-fallback-audit.ts";
import { sceneProbe } from "./route-clip-audit.ts";

describe("gap diagnosis and fallback clips",()=>{
  it("uses data width and reserves narrow for widths below 0.8 m",()=>{
    expect(dataWidth({mode:"walk",attributes:{width:{m:1}}})).toBe(1);
    expect(dataWidth({mode:"walk"})).toBe(2.6);
    expect(gapClass(0.79,0.59,0,0.4,false)).toBe("narrow");
    expect(gapClass(0.8,0.59,0,0.4,false)).toBe("scene_obstruction");
    expect(gapClass(1,null,0.41,0.4,false)).toBe("step");
    expect(gapClass(1,null,0,0.4,true)).toBe("missing_floor");
  });
  it("samples disconnected navmesh gaps at no more than 0.25 m",()=>{
    const calls:number[]=[];
    const query={findClosestPoint:({x,y,z}:{x:number;y:number;z:number})=>{ calls.push(x); return {success:true,polyRef:x<0.5 || x>1.5 ? 1:0,point:{x,y,z}}; }};
    const root=new THREE.Group(), probe=sceneProbe({root,walkable:[],colliders:[],walls:[]} as never);
    const point=(x:number)=>({x,y:0,z:0,floorId:"f",zKnown:true,stepIndex:0});
    const gaps=diagnoseGaps(query as never,probe,[point(0),point(2)],2,0.4);
    expect(calls).toEqual([0,0.25,0.5,0.75,1,1.25,1.5,1.75,2]);
    expect(gaps).toHaveLength(1); expect(gaps[0]!.class).toBe("missing_floor"); expect(gaps[0]!.lengthM).toBe(1.5);
  });
  it("fails clipped fallback segments and accepts a clear segment",()=>{
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,4).rotateX(-Math.PI/2).translate(4,0,2),new THREE.MeshBasicMaterial());
    const wall=new THREE.Mesh(new THREE.BoxGeometry(0.1,2,4),new THREE.MeshBasicMaterial()); wall.position.set(4,1,2);
    const root=new THREE.Group().add(floor,wall); root.updateMatrixWorld(true);
    const probe=sceneProbe({root,walkable:[floor],colliders:[wall],walls:[]} as never);
    const point=(x:number)=>({x,y:-2,z:0,floorId:"f",zKnown:true,stepIndex:0});
    const result=auditFallbackSegments(probe,[{edgeId:"clear",points:[point(1),point(2)]},{edgeId:"blocked",points:[point(2),point(6)]},{edgeId:"off",points:[{...point(1),z:1},{...point(2),z:1}]}]);
    expect(result.failed).toEqual(["blocked","off"]); expect(result.totals.wallHits).toBeGreaterThan(0); expect(result.totals.offFloor).toBeGreaterThan(0);
    expect(fallbackGate({fallback:result,unlisted:[],navmesh:{offFloor:0,noFloor:0,wallHits:0},incompleteRoutes:0}).ok).toBe(false);
  });
});
