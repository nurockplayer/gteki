/** Road geometry from PLATEAU; markings and furniture positions are explicitly decorative. */
import polygonClipping, { type Polygon, type MultiPolygon } from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import { pointInRings, type Layout, type XY } from "./layout.ts";
import type { SurfaceData } from "./surface-data.ts";
import { streetFootprint, surfaceOpenings } from "./surface-layout.ts";
export function inside(p: XY, polys: number[][][][]) {
  return polys.some((poly) => pointInRings(p, poly.map((r) => r.map(([x,y]) => ({ x: x!, y: y! })))));
}
export function strip(a: XY, b: XY, width: number): Polygon {
  const L = Math.hypot(b.x-a.x,b.y-a.y) || 1, nx = -(b.y-a.y)/L*width/2, ny=(b.x-a.x)/L*width/2;
  return [[[a.x+nx,a.y+ny],[b.x+nx,b.y+ny],[b.x-nx,b.y-ny],[a.x-nx,a.y-ny],[a.x+nx,a.y+ny]]];
}
export function surfaceStreets(surface: SurfaceData, layout: Layout, bundle: StationBundle) {
  // Millimetre construction grid avoids near-zero sweep-line segments where
  // buffered road corners meet the independently quantised station pads.
  const snap = (polys: MultiPolygon): MultiPolygon => polys.map(poly => poly.map(r => r.map(([x,y]) => [Math.round(x*1000)/1000,Math.round(y*1000)/1000] as [number,number])));
  const roads = surface.roads.map((r) => r.rings), pads = streetFootprint(layout), holes = surfaceOpenings(layout,bundle);
  const full = roads.length ? polygonClipping.union(roads[0]!,...roads.slice(1)) : [];
  // LOD1 has no reliable carriageway/sidewalk distinction. Reserve 1.6 m on the
  // inside of each road outline as generic sidewalk, retaining the source outline.
  const margins: Polygon[] = [];
  for (const poly of full) for (const ring of poly) for (let i=1;i<ring.length;i++) {
    const a={x:ring[i-1]![0],y:ring[i-1]![1]}, b={x:ring[i]![0],y:ring[i]![1]};
    margins.push(strip(a,b,3.2));
  }
  const margin = margins.length ? polygonClipping.union(margins[0]!,...margins.slice(1)) : [];
  const asphalt: MultiPolygon = full.length ? polygonClipping.difference(snap(full), snap(margin), snap(pads), snap(holes)) : [];
  const markings: Polygon[] = [];
  const markedZones: XY[] = [];
  for (const road of roads) {
    const ring=road[0]!; let longest=0, a:XY={x:0,y:0}, b=a;
    for(let i=1;i<ring.length;i++){const p=ring[i-1]!,q=ring[i]!,L=Math.hypot(q[0]-p[0],q[1]-p[1]); if(L>longest){longest=L;a={x:p[0],y:p[1]};b={x:q[0],y:q[1]};}}
    if(longest<20) continue;
    const ux=(b.x-a.x)/longest, uy=(b.y-a.y)/longest;
    const along=ring.map(([x,y])=>x*ux+y*uy), across=ring.map(([x,y])=>-x*uy+y*ux);
    const lo=Math.min(...along),hi=Math.max(...along),side=(Math.min(...across)+Math.max(...across))/2,width=Math.max(...across)-Math.min(...across);
    if(width<9 || width>28 || (hi-lo)/width<2.5)continue;
    const at=(u:number,v:number):XY=>({x:u*ux-v*uy,y:u*uy+v*ux});
    const center=at((lo+hi)/2,side);
    if(markedZones.some(p=>Math.hypot(p.x-center.x,p.y-center.y)<25))continue;
    markedZones.push(center);
    const add=(p:Polygon)=>{if(p[0]!.every(([x,y])=>inside({x,y},asphalt)))markings.push(p);};
    for(let d=lo+6;d<hi-5;d+=12)add(strip(at(d,side),at(d+3,side),.14));
    // A sparse generic zebra band on long/wide polygons, not a sourced crossing.
    if(longest>45 && width>12)for(let w=-3;w<=3;w+=1)add(strip(at(lo+9,side+w),at(lo+12,side+w),.42));
  }
  const furniture: { p: XY; u: XY; tree: boolean }[]=[];
  for (const poly of asphalt) for (const ring of poly) for(let i=1;i<ring.length;i++){
    const a={x:ring[i-1]![0],y:ring[i-1]![1]}, b={x:ring[i]![0],y:ring[i]![1]},L=Math.hypot(b.x-a.x,b.y-a.y);
    if(L<18)continue;
    const u={x:(b.x-a.x)/L,y:(b.y-a.y)/L};
    for(let d=8;d<L-5;d+=28){
      for(const side of [-1,1]){
        const p={x:a.x+u.x*d-u.y*1.05*side,y:a.y+u.y*d+u.x*1.05*side};
        if(Math.hypot(p.x+30,p.y-100)>290 || inside(p,asphalt)||inside(p,pads)||inside(p,holes)||inside(p,surface.buildings.map(b=>b.rings)))continue;
        // Furniture stays at least 2 m from any walkable slab or opening.
        if([-2,0,2].some(dx=>[-2,0,2].some(dy=>inside({x:p.x+dx,y:p.y+dy},pads)||inside({x:p.x+dx,y:p.y+dy},holes))))continue;
        if(furniture.some(f=>Math.hypot(f.p.x-p.x,f.p.y-p.y)<12))continue;
        furniture.push({p,u,tree:furniture.length%3!==0});break;
      }
    }
  }
  // Keep the small number of props nearest the actual entrances. This is
  // a visual density choice, never a claim about real equipment/tree counts.
  const exits=bundle.pois.filter(p=>p.category==="exit").flatMap(p=>p.connectorNodeIds).map(id=>bundle.nodes.find(n=>n.id===id)!).filter(n=>Math.abs(layout.nodeZ.get(n.id)??-100)<.1);
  const nearest=(p:XY)=>Math.min(...exits.map(n=>Math.hypot(n.position.x-p.x,n.position.y-p.y)));
  furniture.sort((a,b)=>nearest(a.p)-nearest(b.p));
  return {asphalt,markings:markings.length?polygonClipping.union(markings[0]!,...markings.slice(1)):[],furniture:furniture.slice(0,45),pads,holes};
}
