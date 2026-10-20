import { expect,it } from 'vitest';
import { grs80Distance,distanceConsistency } from '../src/geodesic.js';
it('matches the analytic GRS80 equatorial one-degree geodesic and identity',()=>{
  // Equatorial geodesic = semi-major axis * angle; GRS80 a=6378137 m (IAG 1980).
  expect(grs80Distance([0,0],[1,0])).toBeCloseTo(6378137*Math.PI/180,6);
  expect(grs80Distance([139,35],[139,35])).toBe(0);
  expect(grs80Distance([35,139],[35,140])).toBeNull();
  expect(grs80Distance([0,0],[180,0])).toBeNull();
});
it('sums supplied segments, applies the strict rounding threshold and leaves failed checks without verdict',()=>{
  const length=grs80Distance([0,0],[0.001,0])!;
  const link=(distance:unknown)=>({properties:{distance},geometry:{type:'LineString',coordinates:[[0,0],[0.0005,0],[0.001,0]]}});
  expect(distanceConsistency([link(length+0.05)])).toMatchObject({comparable_links:1,within_threshold:1,result:'CONSISTENT_WITH_LON_LAT_DEGREES'});
  expect(distanceConsistency([link(length+0.055),link(null)])).toMatchObject({comparable_links:1,above_threshold:1,skipped_links:1,result:'NO_VERDICT'});
  expect(distanceConsistency([]).absolute_delta_m.median).toBeNull();
});

it.each([
  {name:'false',value:false},{name:'true',value:true},{name:'empty array',value:[]},{name:'numeric array',value:[0]},
  {name:'object',value:{}},{name:'empty string',value:''},{name:'whitespace',value:' '},
  {name:'null',value:null},{name:'missing',value:undefined},{name:'hexadecimal',value:'0x0'},
  {name:'NaN',value:NaN},{name:'infinity',value:Infinity},{name:'overflow',value:'1e309'},
])('skips non-decimal distance: $name',({value})=>{
  const result=distanceConsistency([{properties:{distance:value},geometry:{type:'LineString',coordinates:[[0,0],[0,0]]}}]);
  expect(result).toMatchObject({comparable_links:0,skipped_links:1,within_threshold:0,result:'NO_VERDICT',absolute_delta_m:{median:null,p95:null,p99:null,max:null}});
});

it.each([0,'0','+0.0','0e0'])('accepts finite decimal distance %j',distance=>{
  expect(distanceConsistency([{properties:{distance},geometry:{type:'LineString',coordinates:[[0,0],[0,0]]}}])).toMatchObject({comparable_links:1,skipped_links:0,within_threshold:1});
});
