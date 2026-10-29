import { describe, expect, it } from "vitest";
import { fallbackGate } from "./navmesh-fallback-audit.ts";

describe("fallback clip gate",()=>{
  const clean={offFloor:0,noFloor:0,wallHits:0};
  it("rejects a clipped fallback even when navmesh segments are clean",()=>{
    expect(fallbackGate({fallback:{failed:["edge"]},unlisted:[],navmesh:clean,incompleteRoutes:0}).ok).toBe(false);
  });
  it("rejects unlisted edges and navmesh clips",()=>{
    expect(fallbackGate({fallback:{failed:[]},unlisted:["edge"],navmesh:clean,incompleteRoutes:0}).ok).toBe(false);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:{...clean,wallHits:1},incompleteRoutes:0}).ok).toBe(false);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:clean,incompleteRoutes:0}).ok).toBe(true);
    expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:clean,incompleteRoutes:1}).ok).toBe(false);
  });
});
