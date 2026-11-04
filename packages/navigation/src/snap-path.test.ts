import {expect,it} from "vitest";
import {assembleSnapPath} from "./snap-path.ts";

it.each([false,true])("canonicalizes measured Detour junctions without widening equality (reverse=%s)",reversed=>{
  const a={x:98.98575592041016,y:-16.0122127532959,z:27.139999389648438};
  const b={...a,y:-16.012210845947266};
  const forward=[[{...a,x:80},a],[b,{...b,x:100}]];
  const steps=reversed ? [...forward].reverse().map(line=>[...line].reverse()):forward;
  expect(assembleSnapPath(steps,()=>[a]).reason).toBe("join_gap");
  const canonical=(p:typeof a)=>p.x===a.x ? {...p,y:a.y}:p;
  const result=assembleSnapPath(steps,()=>[a],canonical);
  expect(result.reason).toBeNull();
  expect(result.points?.filter(p=>p.x===a.x)).toEqual([a]);
  expect(assembleSnapPath(steps,()=>null).reason).toBe("join_gap");
});

it("keeps suspect graph vertices and marks their boundary unmodelled",()=>{
  const suspect={x:3,y:3,z:7,suspectPolyline:true,sceneGap:true};
  const result=assembleSnapPath([[{x:0,y:0,z:0,suspectPolyline:false,sceneGap:false},{x:1,y:0,z:0,suspectPolyline:false,sceneGap:false}],[suspect,{...suspect,x:4}]],()=>null,p=>p.suspectPolyline ? null:p);
  expect(result.reason).toBeNull();
  expect(result.points?.some(p=>p.x===3 && p.suspectPolyline && p.sceneGap)).toBe(true);
});

it("fails when a canonical navmesh endpoint is missing",()=>{
  expect(assembleSnapPath([[{x:0,y:0,z:0},{x:1,y:0,z:0}]],()=>null,()=>null).reason).toBe("snap_failed");
});
