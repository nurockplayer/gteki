import { describe,expect,it } from 'vitest';
import { assertAxis,project,unproject,toGltf,fromGltf,toLocal,fromLocal,IX_PROJ,type Frame,type Point3 } from '../src/crs.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('CRS: serialized axis and station-local frame',()=>{
  // EPSG:6677 parameter origin: latitude of natural origin 36°, longitude 139°50′.
  // Definition reference: https://www.gsi.go.jp/LAW/heimencho.html (system IX).
  it('maps the explicit natural origin to (0,0), preserving TP height',()=>{
    const p=project([36,139+50/60,12.34]);expect(Math.abs(p[0])).toBeLessThan(1e-7);expect(Math.abs(p[1])).toBeLessThan(1e-7);expect(p[2]).toBe(12.34);
  });
  it('matches the two checked-in GSI JGD2011 zone IX controls within 0.5 mm without network access',async()=>{
    const fixture=JSON.parse(await readFile(join(import.meta.dirname,'fixtures','gsi-bl2xy-controls.json'),'utf8')) as { controls:Array<{ latitude:number; longitude:number; response:{ publicX:string; publicY:string } }> };
    for(const control of fixture.controls){
      const [easting,northing]=project([control.latitude,control.longitude,0]);
      expect(Math.abs(easting-Number(control.response.publicY))).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(northing-Number(control.response.publicX))).toBeLessThanOrEqual(0.0005);
    }
  });
  it('roundtrips both angular and projected coordinates at station-scale sample points',()=>{
    for(const p of [[35.729,139.71,22.2],[35.69,139.7,-4],[36,139+50/60,0]] as Point3[]){
      const metric=project(p),inverse=unproject(metric),metric2=project(inverse);
      expect(Math.hypot(metric2[0]-metric[0],metric2[1]-metric[1])).toBeLessThan(1e-6);
      expect(Math.max(Math.abs(p[0]-inverse[0]),Math.abs(p[1]-inverse[1]))).toBeLessThan(1e-9);expect(inverse[2]).toBe(p[2]);
    }
  });
  it('fails rather than guessing swapped axes, absent heights or wrong CRS',()=>{
    expect(()=>assertAxis([139.7,35.7,0])).toThrow();expect(()=>assertAxis([35.7,139.7])).toThrow();expect(()=>assertAxis([35.7,139.7,0],'EPSG:4326')).toThrow();
  });
  it('uses x=East, y=Up, z=-North without changing height datum',()=>{
    const frame={origin_E:10,origin_N:20,origin_H:30} as Frame,p:Point3=[35.72,139.71,25];
    const local=toLocal(p,frame);expect(local[2]).toBe(-5);expect(toGltf([1,2,3])).toEqual([1,3,-2]);expect(fromGltf(toGltf(local))).toEqual(local);
    const inverse=fromLocal(local,frame);expect(inverse[0]).toBeCloseTo(p[0],9);expect(inverse[1]).toBeCloseTo(p[1],9);expect(inverse[2]).toBe(p[2]);
  });
});
