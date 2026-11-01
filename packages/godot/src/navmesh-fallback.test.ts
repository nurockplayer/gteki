import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fallbackDestination, fallbackEntries } from "./navmesh-fallback.ts";

it("deduplicates directions and prefers a diagnosed gap",()=>{
  expect(fallbackEntries([
    {edgeId:"b",mode:"walk",reason:"no_path",connectivity:"disconnected",gaps:[]},
    {edgeId:"b",mode:"walk",reason:"no_path",connectivity:"disconnected",gaps:[{class:"scene_obstruction"}]},
    {edgeId:"a",mode:"stairs",reason:"snap_failed",connectivity:"unknown_snap",gaps:[]},
  ])).toEqual([{edgeId:"a",mode:"stairs",reason:"snap_failed"},{edgeId:"b",mode:"walk",reason:"scene_obstruction"}]);
});

it("rejects private writes outside the private directory, including symlinks",()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"gteki-fallback-")),privateDir=path.join(base,"private"),outside=path.join(base,"outside");
  try {
    fs.mkdirSync(privateDir); fs.mkdirSync(outside); fs.symlinkSync(outside,path.join(privateDir,"escape"));
    expect(fallbackDestination(path.join(privateDir,"list.json"),privateDir)).toBe(path.join(fs.realpathSync(privateDir),"list.json"));
    expect(()=>fallbackDestination(path.join(outside,"list.json"),privateDir)).toThrow();
    expect(()=>fallbackDestination(path.join(privateDir,"escape","list.json"),privateDir)).toThrow();
  } finally {fs.rmSync(base,{recursive:true,force:true});}
});
