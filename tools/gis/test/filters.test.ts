import { expect, it } from 'vitest';
import { parseBboxLocal, assertBboxLocal } from '../src/filters.js';
import { convertCityGmlFile } from '../src/convert.js';
import { CRS_6697, IX_PROJ, type Frame } from '../src/crs.js';

it('P3-8 rejects every blank bbox token instead of coercing it to zero', () => {
  for (const input of [',,-1,1', ',0,1,1', '0, ,1,1', '0,0,,1', '0,0,1,', '0,0,1', '0,0,1,1,2', '0,0,NaN,1', '0,0,Infinity,1'])
    expect(() => parseBboxLocal(input)).toThrow();
  expect(parseBboxLocal('-1,-2,3,4')).toEqual([-1,-2,3,4]);
});

it('P3-8 requires exactly four finite number values at the conversion API boundary', () => {
  for (const input of [[0,0,1], [0,0,1,1,2], ['',0,1,1], [0,0,NaN,1], [0,0,Infinity,1], [2,0,1,1], null])
    expect(() => assertBboxLocal(input)).toThrow();
  expect(() => assertBboxLocal([0,0,0,0])).not.toThrow();
});

it('P3-8 conversion rejects malformed bbox arrays before opening a source file', async () => {
  const frame: Frame = { frame_id:'synthetic', source_id:'synthetic', source_sha256:'a'.repeat(64), verification:'UNVERIFIED',
    origin_E:0,origin_N:0,origin_H:0,source_envelope:{lower:[35.7,139.7,0],upper:[35.71,139.71,3],srsName:CRS_6697},
    horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC test only' };
  for (const input of [[0,0,1], [0,0,1,1,2], ['',0,1,1], [0,0,NaN,1]]) {
    await expect(convertCityGmlFile({path:'SYNTHETIC-must-not-open.xml',sourceId:'synthetic',sourceSha256:frame.source_sha256,
      frame,outputPath:'SYNTHETIC-must-not-write.glb',attributionText:'SYNTHETIC',options:{bboxLocal:input as [number,number,number,number]}})).rejects.toThrow('bboxLocal');
  }
});
