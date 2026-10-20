import earcut, { deviation } from 'earcut';
import type { Point3 } from './crs.js';

const sub = (a: Point3, b: Point3): Point3 => a.map((v, i) => v - b[i]) as Point3;
const dot = (a: Point3, b: Point3) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a: Point3, b: Point3): Point3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (p: Point3): Point3 => p.map(v => v / Math.hypot(...p)) as Point3;
export interface Triangulation { positions: Point3[]; indices: number[]; normal: Point3; max_plane_deviation_m: number }
export function triangulate(rings: number[][][]): Triangulation | null {
  if (!rings.length) return null;
  const clean: Point3[][] = [];
  for (const ring of rings) {
    if (ring.length < 4 || ring.some(p => p.length !== 3 || !p.every(Number.isFinite)) || ring[0].some((v, i) => v !== ring.at(-1)![i])) return null;
    const points = ring.slice(0, -1) as Point3[];
    if (new Set(points.map(p => p.join(','))).size < 3) return null;
    clean.push(points);
  }
  const outer = clean[0], normal: Point3 = [0,0,0];
  for (let i=0; i<outer.length; i++) {
    const a=outer[i], b=outer[(i+1)%outer.length];
    normal[0]+=(a[1]-b[1])*(a[2]+b[2]); normal[1]+=(a[2]-b[2])*(a[0]+b[0]); normal[2]+=(a[0]-b[0])*(a[1]+b[1]);
  }
  if (Math.hypot(...normal) < 1e-10) return null;
  const n=unit(normal), origin=outer[0], edge=outer.slice(1).map(p=>sub(p,origin)).find(p=>Math.hypot(...p)>1e-9)!;
  const u=unit(sub(edge,n.map(v=>v*dot(edge,n)) as Point3)), v=cross(n,u);
  const positions=clean.flat(), flat:number[]=[], holes:number[]=[];
  let total=0;
  for (let r=0;r<clean.length;r++) { if(r) holes.push(total); for(const p of clean[r]) { const d=sub(p,origin); flat.push(dot(d,u),dot(d,v)); total++; } }
  const indices=earcut(flat,holes,2);
  if (!indices.length || !Number.isFinite(deviation(flat,holes,2,indices)) || deviation(flat,holes,2,indices)>1e-6) return null;
  // Earcut may reverse input winding. Reorient each triangle to the source Newell normal.
  for(let i=0;i<indices.length;i+=3) if(dot(cross(sub(positions[indices[i+1]],positions[indices[i]]),sub(positions[indices[i+2]],positions[indices[i]])),n)<0)
    [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  return { positions, indices, normal:n, max_plane_deviation_m:Math.max(...positions.map(p=>Math.abs(dot(sub(p,origin),n)))) };
}
